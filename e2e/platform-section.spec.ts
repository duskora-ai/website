import { test, expect } from '@playwright/test';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif' };
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

test('platform screenshots are served as responsive AVIF/WebP with the PNG as fallback', async ({ page }) => {
  await page.goto(url);
  const pictures = page.locator('#platform figure picture');
  await expect(pictures).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    const pic = pictures.nth(i);
    const img = pic.locator('img');
    const src = (await img.getAttribute('src')) || '';
    expect(src).toMatch(/^\/screenshots\/[a-z-]+\.png$/);
    await expect(img).toHaveAttribute('loading', 'lazy');
    const name = src.replace(/^\/screenshots\/|\.png$/g, '');
    const sources = pic.locator('source');
    await expect(sources).toHaveCount(2);
    for (const [j, ext] of ['avif', 'webp'].entries()) {
      const source = sources.nth(j);
      await expect(source).toHaveAttribute('type', `image/${ext}`);
      await expect(source).toHaveAttribute('srcset', `/screenshots/${name}-600.${ext} 600w, /screenshots/${name}-1200.${ext} 1200w`);
      await expect(source).toHaveAttribute('sizes', /\S/);
      for (const w of [600, 1200]) expect(fs.existsSync(path.join(root, `screenshots/${name}-${w}.${ext}`))).toBe(true);
    }
  }
});

// The four 2400x1500 PNGs total ~3.7 MB; desktop browsers should download at least 80% less.
for (const [dpr, file] of [[1, '600'], [2, '1200']] as const) {
  test(`platform screenshots download the ${file}w AVIF at a 1280px desktop width and DPR ${dpr}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    await page.goto(url);
    const imgs = page.locator('#platform figure img');
    for (let i = 0; i < 4; i++) {
      const img = imgs.nth(i);
      await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth)).toBeGreaterThan(0);
    }
    const current = await imgs.evaluateAll((els) => els.map((e) => new URL((e as HTMLImageElement).currentSrc).pathname));
    for (const p of current) expect(p).toMatch(new RegExp(`-${file}\\.avif$`));
    const pngBytes = current.reduce((n, p) => n + fs.statSync(path.join(root, p.replace(/-\d+\.avif$/, '.png'))).size, 0);
    const bytes = current.reduce((n, p) => n + fs.statSync(path.join(root, p)).size, 0);
    console.log(`DPR ${dpr}: ${bytes} bytes for the four platform images (PNG baseline ${pngBytes}, ${(100 - (100 * bytes) / pngBytes).toFixed(1)}% smaller)`);
    expect(bytes).toBeLessThanOrEqual(pngBytes * 0.2);
    await context.close();
  });
}
