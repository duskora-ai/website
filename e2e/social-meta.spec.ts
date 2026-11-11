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

const ORIGIN = 'https://duskora.ai';
const IMAGE = `${ORIGIN}/og-image.png`;
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
  '/blog/',
  '/blog/welcome-to-duskora/',
  '/blog/getting-started-with-duskora/',
];
// the 404 page has no URL of its own, so it shares the home page's
const OG_URL: Record<string, string> = { '/404.html': '/' };
// blog posts are articles; every other page is a website
const ogType = (p: string) => (/^\/blog\/[^/]+\/$/.test(p) ? 'article' : 'website');

const nonEmpty = /\S/;
const og = (name: string) => `meta[property="og:${name}"]`;
const tw = (name: string) => `meta[name="twitter:${name}"]`;

for (const p of PAGES) {
  test(`${p} has complete Open Graph and Twitter card tags`, async ({ page }) => {
    await page.goto(`${base}${p}`);
    const head = page.locator('head');
    const one = async (selector: string, value: string | RegExp) => {
      await expect(head.locator(selector)).toHaveCount(1);
      await expect(head.locator(selector)).toHaveAttribute('content', value);
    };
    await one(og('title'), nonEmpty);
    await one(og('description'), nonEmpty);
    await one(og('url'), `${ORIGIN}${OG_URL[p] ?? p}`);
    await one(og('type'), ogType(p));
    await one(og('site_name'), 'Duskora.ai');
    await one(og('image'), IMAGE);
    await one(og('image:width'), '1200');
    await one(og('image:height'), '630');
    await one(og('image:alt'), nonEmpty);
    await one(tw('card'), 'summary_large_image');
    await one(tw('image'), IMAGE);
    // the Twitter card says the same as the Open Graph tags
    await one(tw('title'), (await head.locator(og('title')).getAttribute('content'))!);
    await one(tw('description'), (await head.locator(og('description')).getAttribute('content'))!);
  });
}

test('subpages use their own share title and description, and titles are unique', async ({ page }) => {
  const read = async (p: string) => {
    await page.goto(`${base}${p}`);
    return {
      title: await page.locator(og('title')).getAttribute('content'),
      description: await page.locator(og('description')).getAttribute('content'),
    };
  };
  const home = await read('/');
  const titles = [home.title];
  for (const p of PAGES.filter((p) => p !== '/')) {
    const sub = await read(p);
    expect(sub.title, p).not.toBe(home.title);
    expect(sub.description, p).not.toBe(home.description);
    titles.push(sub.title);
  }
  expect(new Set(titles).size).toBe(titles.length);
});

test('og-image.png is a 1200×630 PNG under 300 KB and is served', async ({ request }) => {
  const file = path.join(root, 'og-image.png');
  const buf = fs.readFileSync(file);
  // PNG signature, then the IHDR chunk holds width and height as big-endian uint32s
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  expect(buf.toString('ascii', 12, 16)).toBe('IHDR');
  expect(buf.readUInt32BE(16)).toBe(1200);
  expect(buf.readUInt32BE(20)).toBe(630);
  expect(buf.length).toBeLessThan(300 * 1024);

  const res = await request.get(`${base}/og-image.png`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/png');
});
