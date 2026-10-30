import { test, expect } from '@playwright/test';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';

const artifacts = process.env.QA_ARTIFACTS_DIR;
const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
let server: http.Server;
let url = '';

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
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
test.afterAll(() => server.close());

for (const scheme of ['light', 'dark'] as const) {
  test(`platform section is legible with bordered images in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url);
    const img = page.locator('#platform .shot img').first();
    await img.scrollIntoViewIfNeeded();
    const s = await img.evaluate((e) => { const c = getComputedStyle(e); return { w: c.borderTopWidth, st: c.borderTopStyle, col: c.borderTopColor }; });
    expect(s.w).toBe('1px');
    expect(s.st).toBe('solid');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(s.col).not.toBe(bg);
    const h3 = await page.locator('#platform .shot h3').first().evaluate((e) => getComputedStyle(e).color);
    expect(h3).not.toBe(bg);
    if (artifacts) {
      await page.locator('#platform').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(artifacts, `platform-${scheme}.png`) });
    }
  });
}
