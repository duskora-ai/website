import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
let server: http.Server;
let base = '';
const dir = process.env.QA_ARTIFACTS_DIR;
const pause = (page: import('@playwright/test').Page, ms = 1000) => (dir ? page.waitForTimeout(ms) : Promise.resolve());

test.use({ video: 'on' });
test.slow(!!dir);

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

test('favicon files render on light and dark backgrounds (evidence)', async ({ page }) => {
  await page.setContent(`<body style="margin:0;display:flex">
    <div style="background:#fff;padding:24px"><img src="${base}/favicon-48x48.png" width="48"><img src="${base}/favicon.ico" width="16"><img src="${base}/favicon.ico" width="48"></div>
    <div style="background:#000;padding:24px"><img src="${base}/favicon-48x48.png" width="48"><img src="${base}/favicon.ico" width="16"><img src="${base}/favicon.ico" width="48"></div></body>`);
  await pause(page, 2000);
  const ok = await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().then(() => i.naturalWidth > 0, () => false))));
  expect(ok.every(Boolean)).toBe(true);
  if (dir) await page.screenshot({ path: path.join(dir, '01-icons.png') });
  for (const p of ['/', '/beta/', '/404.html', '/integrations/jira/']) {
    await page.goto(`${base}${p}`);
    await expect(page.locator('head link[rel="icon"]').first()).toHaveAttribute('href', '/favicon.ico');
    await pause(page);
  }
  if (dir) await page.screenshot({ path: path.join(dir, '02-page.png') });
  await page.close();
  if (dir) await page.video()?.saveAs(path.join(dir, 'favicon.webm'));
});
