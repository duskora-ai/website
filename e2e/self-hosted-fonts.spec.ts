import { test, expect } from '@playwright/test';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
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
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => server.close());

for (const p of ['/', '/beta/', '/privacy/', '/refunds/', '/terms/']) {
  test(`${p} uses self-hosted Inter and makes no Google Fonts requests`, async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto(url + p, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);

    expect(requests.filter((u) => /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u))).toEqual([]);
    expect(requests.filter((u) => u.endsWith('/fonts/inter-latin-variable.woff2'))).toHaveLength(1);
    await expect(page.locator('link[rel="preload"][as="font"][type="font/woff2"][crossorigin]')).toHaveAttribute('href', '/fonts/inter-latin-variable.woff2');
    const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/['"]/g, '') === 'Inter' && f.status === 'loaded').length);
    expect(loaded).toBeGreaterThan(0);
  });
}
