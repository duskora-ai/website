import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
let server: http.Server;
let base = '';
const out = process.env.QA_ARTIFACTS_DIR;
const pause = (page: import('@playwright/test').Page, ms = 1000) => (out ? page.waitForTimeout(ms) : Promise.resolve());

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

test('footer shows GitHub after Instagram and LinkedIn with rel="me" on every page', async ({ page }) => {
  test.slow(!!out);
  for (const [slug, url] of [['home', '/'], ['404', '/404.html'], ['beta', '/beta/'], ['terms', '/terms/'], ['jira', '/integrations/jira/']]) {
    await page.goto(`${base}${url}`);
    const legal = page.locator('footer nav[aria-label="Legal"]');
    await legal.scrollIntoViewIfNeeded();
    const gh = legal.getByRole('link', { name: 'GitHub' });
    await expect(gh).toHaveAttribute('href', 'https://github.com/duskora-ai');
    await expect(gh).toHaveAttribute('rel', 'me');
    await expect(legal.locator('a').nth(-3)).toHaveText('Instagram');
    await expect(legal.locator('a').nth(-2)).toHaveText('LinkedIn');
    await pause(page);
    if (out) await legal.screenshot({ path: path.join(out, `github-footer-${slug}.png`) });
  }
});
