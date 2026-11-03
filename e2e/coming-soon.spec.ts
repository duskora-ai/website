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

test('coming soon timeline lists the planned integrations in order', async ({ page }) => {
  await page.goto(url);
  const items = page.locator('#coming-soon .tl-item');
  await expect(items).toHaveCount(7);
  await expect(items.locator('h3')).toHaveText(['Azure', 'Google Cloud (GCP)', 'Azure DevOps', 'GitLab', 'Bitbucket', 'Trello', 'Figma']);
  for (let i = 0; i < 7; i++) await expect(items.nth(i)).toContainText('Coming soon');
  await expect(page.locator('#coming-soon mark.fill')).toHaveCount(0);
});

test('coming soon sits between features and pricing', async ({ page }) => {
  await page.goto(url);
  const ids = await page.locator('section[id]').evaluateAll((els) => els.map((e) => e.id));
  const i = ids.indexOf('coming-soon');
  expect(i).toBeGreaterThan(-1);
  expect(ids[i - 1]).toBe('features');
  expect(ids[i + 1]).toBe('pricing');
});

for (const w of [400, 1280]) {
  test(`no horizontal overflow with timeline at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(url);
    await expect(page.locator('#coming-soon .tl-item').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
