import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
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

// every HTML page the site serves
const PAGES = [
  '/',
  '/404.html',
  '/beta/',
  '/terms/',
  '/privacy/',
  '/refunds/',
  '/integrations/',
  '/integrations/github/',
  '/integrations/linear/',
  '/integrations/jira/',
];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// the IHDR chunk holds width and height as big-endian uint32s
const pngSize = (buf: Buffer) => {
  expect(buf.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  expect(buf.toString('ascii', 12, 16)).toBe('IHDR');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
};

test('favicon.ico is served and holds 16, 32 and 48px icons', async ({ request }) => {
  const res = await request.get(`${base}/favicon.ico`);
  expect(res.status()).toBe(200);
  const buf = await res.body();
  // ICONDIR: reserved 0, type 1 (icon), then the image count
  expect(buf.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))).toBe(true);
  const count = buf.readUInt16LE(4);
  expect(count).toBe(3);
  const sizes: number[] = [];
  for (let i = 0; i < count; i++) {
    const entry = 6 + 16 * i;
    const [w, h] = [buf.readUInt8(entry), buf.readUInt8(entry + 1)];
    expect(h).toBe(w);
    // each entry is a PNG whose real size matches the directory
    const length = buf.readUInt32LE(entry + 8);
    const offset = buf.readUInt32LE(entry + 12);
    expect(pngSize(buf.subarray(offset, offset + length))).toEqual([w, h]);
    sizes.push(w);
  }
  expect(sizes.sort((a, b) => a - b)).toEqual([16, 32, 48]);
});

test('favicon-48x48.png is served and is 48×48', async ({ request }) => {
  const res = await request.get(`${base}/favicon-48x48.png`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/png');
  expect(pngSize(await res.body())).toEqual([48, 48]);
});

for (const p of PAGES) {
  test(`${p} declares the ICO, then the SVG favicon, then the touch icon`, async ({ page }) => {
    await page.goto(`${base}${p}`);
    const icons = page.locator('head link[rel="icon"], head link[rel="apple-touch-icon"]');
    const hrefs = await icons.evaluateAll((els) => els.map((el) => el.getAttribute('href')));
    expect(hrefs).toEqual(['/favicon.ico', '/favicon.svg', '/apple-touch-icon.png']);
    await expect(icons.nth(0)).toHaveAttribute('sizes', '48x48');
    await expect(icons.nth(1)).toHaveAttribute('type', 'image/svg+xml');
  });
}
