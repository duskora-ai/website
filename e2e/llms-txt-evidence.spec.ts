import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml' };
let server: http.Server;
let base = '';
const dir = process.env.QA_ARTIFACTS_DIR;
const pause = (page: import('@playwright/test').Page, ms = 1000) => (dir ? page.waitForTimeout(ms) : Promise.resolve());

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

test('llms.txt in the browser, and the pricing section it mirrors', async ({ page }) => {
  test.slow(!!dir);
  await page.goto(`${base}/llms.txt`);
  await expect(page.locator('body')).toContainText('# Duskora.ai');
  await expect(page.locator('body')).toContainText('Duskora.ai Ltd (UK)');
  await pause(page, 2000);
  if (dir) await page.screenshot({ path: path.join(dir, '01-llms-txt.png'), fullPage: true });

  await page.goto(`${base}/#pricing`);
  await pause(page);
  await expect(page.locator('#pricing')).toBeVisible();
  await page.locator('#pricing').scrollIntoViewIfNeeded();
  await pause(page, 2000);
  if (dir) await page.screenshot({ path: path.join(dir, '02-home-pricing.png') });

  await page.close();
  if (dir) await page.video()?.saveAs(path.join(dir, 'llms-txt.webm'));
});
