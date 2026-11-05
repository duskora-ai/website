import { test, expect } from '@playwright/test';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const art = process.env.QA_ARTIFACTS_DIR;
const pause = (page: import('@playwright/test').Page, ms = 1000) => (art ? page.waitForTimeout(ms) : Promise.resolve());
let server: http.Server;
let url = '';

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
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
test.afterAll(() => server.close());

test('home page hero and section headings evidence', async ({ page }) => {
  test.slow(!!art);
  await page.goto(url);
  await expect(page.locator('h1')).toHaveText('AI coding agents that ship your tickets');
  await pause(page, 1500);
  if (art) {
    fs.mkdirSync(art, { recursive: true });
    await page.screenshot({ path: path.join(art, '01-hero.png') });
  }
  await page.locator('#how-title').scrollIntoViewIfNeeded();
  await expect(page.locator('#how-title')).toHaveText('How AI agents take a ticket to production');
  await pause(page, 1500);
  if (art) await page.screenshot({ path: path.join(art, '02-how-section.png') });
  await page.locator('#platform-title').scrollIntoViewIfNeeded();
  await expect(page.locator('#platform-title')).toHaveText('Autonomous software engineering, end to end');
  await pause(page, 1500);
  if (art) await page.screenshot({ path: path.join(art, '03-platform-section.png') });
  const video = page.video();
  await page.close();
  if (art) await video?.saveAs(path.join(art, 'home-seo.webm'));
});
