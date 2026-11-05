import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
let server: http.Server;
let base = '';

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split(/[?#]/)[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => server.close());

// GitHub Pages serves 404.html (with a 404 status) for any unknown path, so it must not be indexed
// and must work at any depth. This static server has no fallback, so only the file itself is checked.
test('404 page is branded, noindex and links back to home and pricing', async ({ page }) => {
  const res = await page.goto(`${base}/404.html`);
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle('Page not found · Duskora.ai');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.locator('link[rel="stylesheet"]')).toHaveAttribute('href', '/styles.css');
  await expect(page.locator('header .brand img')).toHaveAttribute('src', '/logo.svg');
  await expect(page.locator('footer a[href="/terms/"]')).toBeVisible();

  await expect(page.locator('main a[href="/"]')).toBeVisible();
  await expect(page.locator('main a[href="/#pricing"]')).toBeVisible();
  // the stylesheet actually applied: .doc centres the main column
  expect(await page.locator('main.doc').evaluate((el) => getComputedStyle(el).maxWidth)).toBe('720px');
});

test('every path on the 404 page is absolute, so it renders at any depth', async ({ page }) => {
  await page.goto(`${base}/404.html`);
  const paths = await page.evaluate(() =>
    [...document.querySelectorAll('[href], [src]')].map((el) => el.getAttribute('href') ?? el.getAttribute('src')!),
  );
  expect(paths.length).toBeGreaterThan(0);
  for (const p of paths) expect(p, `relative path: ${p}`).toMatch(/^(\/|https:\/\/|mailto:)/);
});
