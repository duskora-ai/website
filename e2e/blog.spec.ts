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
  '.xml': 'application/xml',
  '.woff2': 'font/woff2',
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
// Every post, newest first. Add new posts here, to the listing, to /blog/feed.xml, sitemap.xml and llms.txt.
const POSTS = [
  { path: '/blog/welcome-to-duskora/', title: 'Welcome to Duskora: your software team, staffed by agents', date: '2026-11-10' },
];

test('the blog listing features the newest post and lists every post, newest first', async ({ page }) => {
  await page.goto(`${base}/blog/`);
  await expect(page.locator('h1')).toHaveText('Notes from the Duskora team');
  await expect(page.locator('a.featured')).toHaveAttribute('href', POSTS[0].path);
  await expect(page.locator('a.featured h2')).toHaveText(POSTS[0].title);
  const rows = page.locator('.post-list a.post-row');
  await expect(rows).toHaveCount(POSTS.length);
  for (const [i, p] of POSTS.entries()) {
    await expect(rows.nth(i)).toHaveAttribute('href', p.path);
    await expect(rows.nth(i).locator('h3')).toHaveText(p.title);
    await expect(rows.nth(i).locator('time')).toHaveAttribute('datetime', p.date);
  }
  // the listing invites readers to the beta
  await expect(page.locator('.closer a[href="/beta/"]')).toHaveText('Request beta access');
});

test('the blog is linked from the header and footer of every page', async ({ page }) => {
  for (const p of ['/', '/integrations/', '/terms/', '/beta/', ...POSTS.map((x) => x.path)]) {
    await page.goto(`${base}${p}`);
    await expect(page.locator('header nav a[href="/blog/"]'), p).toHaveText('Blog');
    await expect(page.locator('footer nav[aria-label="Product"] a[href="/blog/"]'), p).toHaveText('Blog');
  }
});

for (const post of POSTS) {
  test(`${post.path} has a dated header, a beta call to action and share links`, async ({ page }) => {
    await page.goto(`${base}${post.path}`);
    await expect(page.locator('article.post h1')).toHaveText(post.title);
    await expect(page.locator('.post-header time')).toHaveAttribute('datetime', post.date);
    await expect(page.locator('meta[property="article:published_time"]')).toHaveAttribute('content', post.date);
    await expect(page.locator('a.back-link')).toHaveAttribute('href', '/blog/');

    // at least one beta call to action, tracked as a sign-up click
    const ctas = page.locator('.post-cta a[href="/beta/"]');
    expect(await ctas.count()).toBeGreaterThanOrEqual(1);
    for (const a of await ctas.all()) {
      await expect(a).toHaveText('Request beta access');
      await expect(a).toHaveAttribute('data-signup', '');
    }
    await ctas.first().click();
    await expect(page).toHaveURL(`${base}/beta/`);
    await page.goBack();

    // share links carry the post's canonical URL
    const url = encodeURIComponent(`${ORIGIN}${post.path}`);
    await expect(page.locator('.share a', { hasText: 'LinkedIn' })).toHaveAttribute('href', new RegExp(`url=${url.replace(/[.%]/g, '\\$&')}`));
    await expect(page.locator('.share a', { hasText: 'X' })).toHaveAttribute('href', new RegExp(`url=${url.replace(/[.%]/g, '\\$&')}`));
    await expect(page.locator('#copy-link')).toHaveAttribute('data-url', `${ORIGIN}${post.path}`);

    // BlogPosting structured data matches the page
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
    expect(ld['@type']).toBe('BlogPosting');
    expect(ld.headline).toBe(post.title);
    expect(ld.url).toBe(`${ORIGIN}${post.path}`);
    expect(ld.datePublished).toBe(post.date);
    expect(ld.publisher['@id']).toBe(`${ORIGIN}/#organization`);
  });
}

test('the copy-link button copies the post URL', async ({ page }) => {
  // record what the page writes instead of using the real clipboard, which needs focus and permissions
  await page.addInitScript(() => {
    (window as any).copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (t: string) => { (window as any).copied.push(t); return Promise.resolve(); } },
    });
  });
  await page.goto(`${base}${POSTS[0].path}`);
  await page.locator('#copy-link').click();
  await expect(page.locator('#copy-link')).toHaveText('Link copied');
  expect(await page.evaluate(() => (window as any).copied)).toEqual([`${ORIGIN}${POSTS[0].path}`]);
});

test('the RSS feed lists every post and is linked from the blog pages', async ({ page, request }) => {
  const res = await request.get(`${base}/blog/feed.xml`);
  expect(res.status()).toBe(200);
  const xml = await res.text();
  expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  const links = [...xml.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>/g)].map((m) => m[1]);
  expect(links).toEqual(POSTS.map((p) => `${ORIGIN}${p.path}`));
  for (const p of ['/blog/', ...POSTS.map((x) => x.path)]) {
    await page.goto(`${base}${p}`);
    await expect(page.locator('link[rel="alternate"][type="application/rss+xml"]')).toHaveAttribute('href', '/blog/feed.xml');
  }
});

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [375, 1280]) {
    test(`blog pages fit ${width}px without horizontal scroll (${scheme})`, async ({ browser }) => {
      const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width, height: 800 } });
      const page = await ctx.newPage();
      for (const p of ['/blog/', ...POSTS.map((x) => x.path)]) {
        await page.goto(`${base}${p}`);
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        expect(m.sw, p).toBeLessThanOrEqual(m.cw);
      }
      await ctx.close();
    });
  }
}
