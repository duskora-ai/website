import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const artifacts = process.env.QA_ARTIFACTS_DIR;
const pause = (page: { waitForTimeout(ms: number): Promise<void> }, ms = 1000) =>
  artifacts ? page.waitForTimeout(ms) : Promise.resolve();
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
let server: http.Server;
let base = '';

test.use({ video: 'on' });

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split(/[?#]/)[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => server.close());

test('analytics evidence: beta signup flow sends events', async ({ page }) => {
  test.slow(!!artifacts);
  const src = fs.readFileSync(path.join(root, 'analytics.js'), 'utf8');
  await page.route('**/analytics.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: src.replace("var GA_ID = '';", "var GA_ID = 'G-TEST123';") }));
  await page.route(/^https:\/\/www\.googletagmanager\.com\//, (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('**/beta-requests', (route) => route.fulfill({ status: 201, body: '{}', contentType: 'application/json' }));

  await page.goto(`${base}/`);
  await pause(page);
  if (artifacts) await page.screenshot({ path: path.join(artifacts, '01-home.png') });
  await page.evaluate(() => document.addEventListener('click', (e) => e.preventDefault()));
  await page.locator('.hero a[data-signup]').click();
  await pause(page);
  const events = () => page.evaluate(() => ((window as any).dataLayer || []).map((a: IArguments) => Array.from(a)).filter((a: unknown[]) => a[0] === 'event'));
  expect(await events()).toEqual([['event', 'sign_up_click', { link_url: `${base}/beta/`, page_path: '/' }]]);

  await page.goto(`${base}/beta/`);
  await pause(page);
  await page.getByLabel('Name', { exact: true }).fill('Ada Lovelace');
  await page.getByLabel('Work email').fill('ada@example.com');
  await page.locator('input[value=gitlab]').check();
  await page.getByLabel('What do you want to use Duskora for?').fill('Extend our API');
  await pause(page);
  if (artifacts) await page.screenshot({ path: path.join(artifacts, '02-beta-form.png') });
  await page.getByRole('button', { name: 'Request access' }).click();
  await expect(page.locator('#beta-done')).toBeVisible();
  await pause(page, 1500);
  if (artifacts) await page.screenshot({ path: path.join(artifacts, '03-beta-submitted.png') });
  expect(await events()).toEqual([['event', 'beta_request_submitted', { code_host: 'gitlab' }]]);

  await page.close();
  if (artifacts) await page.video()?.saveAs(path.join(artifacts, 'analytics-beta-flow.webm'));
});
