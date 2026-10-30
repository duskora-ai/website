import { test, expect } from '@playwright/test';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';

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

test('platform section has four captioned screenshots that load', async ({ page }) => {
  await page.goto(url);
  await page.waitForLoadState('load');
  const figs = page.locator('#platform figure');
  await expect(figs).toHaveCount(4);
  const imgs = page.locator('#platform figure img');
  for (let i = 0; i < 4; i++) {
    const img = imgs.nth(i);
    await img.scrollIntoViewIfNeeded();
    expect((await img.getAttribute('alt')) || '').not.toBe('');
    await expect(img).toHaveAttribute('width', /\d+/);
    await expect(img).toHaveAttribute('height', /\d+/);
    await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBeGreaterThan(0);
  }
  await expect(figs.locator('figcaption')).toHaveCount(4);
  await expect(page.locator('a[href="#features"]').first()).toHaveText('Features');
  await expect(page.locator('nav a[href="#platform"]')).toHaveCount(1);
});

for (const [w, cols] of [[1280, 2], [1000, 2], [700, 1], [400, 1]] as const) {
  test(`platform figures use ${cols} column(s) with no overflow at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(url);
    const tops = await page.locator('#platform figure').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(tops).toHaveLength(4);
    expect(new Set(tops).size).toBe(4 / cols);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
