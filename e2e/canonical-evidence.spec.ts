import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
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

const PAGES: Record<string, string> = {
  '/': 'https://duskora.ai/',
  '/beta/': 'https://duskora.ai/beta/',
  '/terms/': 'https://duskora.ai/terms/',
  '/privacy/': 'https://duskora.ai/privacy/',
  '/refunds/': 'https://duskora.ai/refunds/',
};

test('canonical link in the rendered DOM of every page', async ({ page }) => {
  test.slow(!!dir);
  let i = 1;
  for (const [p, expected] of Object.entries(PAGES)) {
    await page.goto(base + p);
    await pause(page);
    const links = page.locator('head link[rel="canonical"]');
    await expect(links).toHaveCount(1);
    await expect(links).toHaveAttribute('href', expected);
    if (dir) await page.screenshot({ path: path.join(dir, `0${i}-canonical${p.replace(/\//g, '-')}png`) });
    i++;
    await pause(page);
  }
  await page.close();
  if (dir) await page.video()?.saveAs(path.join(dir, 'canonical.webm'));
});
