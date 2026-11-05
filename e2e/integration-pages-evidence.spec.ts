import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const artifacts = process.env.QA_ARTIFACTS_DIR;
let server: http.Server;
let base = '';

test.use({ video: 'on' });
test.slow(!!artifacts);

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

const pause = (page: import('@playwright/test').Page, ms = 1000) => (artifacts ? page.waitForTimeout(ms) : Promise.resolve());

test('evidence: home chips lead to integration pages and back', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: artifacts ? { dir: artifacts, size: { width: 1280, height: 900 } } : undefined });
  const page = await ctx.newPage();
  await page.goto(`${base}/`);
  await page.locator('.integrations').scrollIntoViewIfNeeded();
  await pause(page, 1500);
  if (artifacts) await page.screenshot({ path: path.join(artifacts, '01-home-chips.png') });
  let i = 2;
  for (const [slug, name] of [['github', 'GitHub'], ['linear', 'Linear'], ['jira', 'Jira']]) {
    await page.locator(`.integrations a.chip[href="/integrations/${slug}/"]`).click();
    await expect(page).toHaveURL(new RegExp(`/integrations/${slug}/$`));
    await expect(page.locator('h1')).toContainText(name);
    await pause(page, 1500);
    if (artifacts) await page.screenshot({ path: path.join(artifacts, `0${i++}-${slug}.png`), fullPage: true });
    await page.locator('a[href="/"]').first().click();
    await expect(page).toHaveURL(`${base}/`);
    await pause(page);
  }
  await page.goto(`${base}/integrations/`);
  await expect(page.locator('h1')).toBeVisible();
  await pause(page, 1500);
  if (artifacts) await page.screenshot({ path: path.join(artifacts, '05-index.png'), fullPage: true });
  await page.close();
  if (artifacts) await page.video()?.saveAs(path.join(artifacts, 'integrations-flow.webm'));
});
