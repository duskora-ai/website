import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
let server: http.Server;
let base = '';
const art = process.env.QA_ARTIFACTS_DIR;
const pause = (page: import('@playwright/test').Page, ms = 1000) => (art ? page.waitForTimeout(ms) : Promise.resolve());

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

test.use({ video: 'on' });

test('404 page renders and the home link leads back to the home page', async ({ page }) => {
  test.slow(!!art);
  await page.goto(`${base}/404.html`);
  await expect(page.locator('a[href="/"]').first()).toBeVisible();
  await pause(page);
  if (art) await page.screenshot({ path: path.join(art, '01-404.png') });
  await page.locator('main a[href="/"]').click();
  await expect(page).toHaveURL(`${base}/`);
  await pause(page);
  if (art) await page.screenshot({ path: path.join(art, '02-home.png') });
  await page.close();
  if (art) await page.video()?.saveAs(path.join(art, '404.webm'));
});
