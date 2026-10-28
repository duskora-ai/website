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

for (const [w, cols] of [[1280, 4], [1000, 2], [700, 2], [400, 1]] as const) {
  test(`plan cards form an even grid at ${w}px (no 3+1 orphan)`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(url);
    const tops = await page.locator('.plan').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(tops).toHaveLength(4);
    expect(new Set(tops).size).toBe(4 / cols);
    if (artifacts) {
      await page.locator('#plans').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(artifacts, `grid-${w}.png`) });
    }
  });
}

test('Slack, Linear and Jira are still marketed outside the table', async ({ page }) => {
  await page.goto(url);
  const text = await page.locator('body').innerText();
  for (const n of ['Slack', 'Linear', 'Jira']) expect(text).toContain(n);
  await expect(page.locator('#plans')).not.toContainText(/Slack|Linear|Jira|Trial/);
});
