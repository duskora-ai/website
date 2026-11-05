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

test('home title and descriptions use search keywords', async ({ page }) => {
  await page.goto(url);
  const title = await page.title();
  expect(title.length).toBeLessThanOrEqual(60);
  expect(title).toMatch(/^Duskora: AI agents that turn tickets into/);
  const description = await page.locator('meta[name="description"]').getAttribute('content');
  expect(description!.length).toBeLessThanOrEqual(155);
  for (const word of ['AI coding agents', 'GitHub', 'Linear', 'Jira', 'pull requests']) expect(description).toContain(word);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', title);
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', description!);
});

test('hero and section headings use descriptive phrases', async ({ page }) => {
  await page.goto(url);
  await expect(page.locator('.hero .eyebrow')).toHaveText('Now in early access');
  await expect(page.locator('h1')).toHaveText('AI coding agents that ship your tickets');
  await expect(page.locator('.hero .lede')).toContainText('your software team, staffed by agents');
  await expect(page.locator('#how-title')).toHaveText('How AI agents take a ticket to production');
  await expect(page.locator('#platform-title')).toHaveText('Autonomous software engineering, end to end');
});

for (const width of [400, 1280]) {
  test(`hero fits without horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    const h1 = await page.locator('h1').boundingBox();
    expect(h1!.x + h1!.width).toBeLessThanOrEqual(width);
  });
}
