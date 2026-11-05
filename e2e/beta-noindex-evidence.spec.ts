import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const artifacts = process.env.QA_ARTIFACTS_DIR;
const pause = (page: { waitForTimeout(ms: number): Promise<void> }, ms = 1000) =>
  artifacts ? page.waitForTimeout(ms) : Promise.resolve();
let server: http.Server;
let base = '';

test.use({ video: 'on' });

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split(/[?#]/)[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return void res.writeHead(404).end();
    const type = path.extname(f) === '.html' ? 'text/html' : path.extname(f) === '.css' ? 'text/css' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(fs.readFileSync(f));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => server.close());

test('beta page evidence: noindex tag, canonical, not in sitemap', async ({ page }) => {
  test.slow(!!artifacts);
  await page.goto(`${base}/beta/`);
  await pause(page);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://duskora.ai/beta/');
  if (artifacts) await page.screenshot({ path: path.join(artifacts, '01-beta-page.png') });
  await pause(page, 1500);

  // Show the head tags as visible text so the evidence is readable.
  const tags = await page.evaluate(() =>
    ['meta[name="robots"]', 'link[rel="canonical"]'].map((s) => document.querySelector(s)!.outerHTML).join('\n'));
  await page.setContent(`<pre style="font-size:20px;padding:24px"></pre>`);
  await page.locator('pre').evaluate((el, t) => { el.textContent = t; }, tags);
  await pause(page, 1500);
  if (artifacts) await page.screenshot({ path: path.join(artifacts, '02-head-tags.png') });

  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  expect(sitemap).not.toContain('/beta');
  await page.close();
  if (artifacts) await page.video()?.saveAs(path.join(artifacts, 'beta-noindex.webm'));
});
