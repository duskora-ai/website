import { test, expect } from '@playwright/test';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif' };
const artifacts = process.env.QA_ARTIFACTS_DIR;
const pause = (page: import('@playwright/test').Page, ms = 1000) => (artifacts ? page.waitForTimeout(ms) : Promise.resolve());
const shot = async (page: import('@playwright/test').Page, name: string) => {
  if (!artifacts) return;
  fs.mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, name) });
};

test.use({ video: 'on' });

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

test('evidence: platform section shows responsive screenshots', async ({ page }) => {
  test.slow(!!artifacts);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(url);
  await pause(page);
  const imgs = page.locator('#platform figure img');
  await expect(imgs).toHaveCount(4);
  await page.locator('#platform').scrollIntoViewIfNeeded();
  await pause(page);
  for (let i = 0; i < 4; i++) {
    const img = imgs.nth(i);
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth)).toBeGreaterThan(0);
    await pause(page);
    await shot(page, `0${i + 1}-platform-image-${i + 1}.png`);
  }
  const current = await imgs.evaluateAll((els) => els.map((e) => (e as HTMLImageElement).currentSrc));
  for (const c of current) expect(c).toMatch(/-(600|1200)\.(avif|webp)$/);
  await pause(page, 2000);
  await page.close();
  if (artifacts) await page.video()?.saveAs(path.join(artifacts, 'platform-section.webm'));
});
