import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
let server: http.Server;
let base = '';
const pause = (page: import('@playwright/test').Page, ms = 1000) =>
  process.env.QA_ARTIFACTS_DIR ? page.waitForTimeout(ms) : Promise.resolve();

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

test('privacy DPA sentence is available on request by email', async ({ page }) => {
  test.slow(!!process.env.QA_ARTIFACTS_DIR);
  await page.goto(`${base}/privacy/`);
  const para = page.locator('p', { hasText: 'Our data processing agreement' });
  await expect(para).toContainText('Our data processing agreement applies to all customers and is available on request from hello@duskora.ai.');
  await expect(para.locator('a')).toHaveAttribute('href', 'mailto:hello@duskora.ai');
  await expect(page.locator('a[href="/dpa"]')).toHaveCount(0);
  await expect(page.locator('.updated')).toHaveText('Last updated: 5 November 2026');
  await para.scrollIntoViewIfNeeded();
  await pause(page);
  if (process.env.QA_ARTIFACTS_DIR) await page.screenshot({ path: path.join(process.env.QA_ARTIFACTS_DIR, '01-dpa-sentence.png') });
});
