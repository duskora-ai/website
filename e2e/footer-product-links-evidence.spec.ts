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

for (const [name, width] of [['desktop', 1280], ['mobile', 375]] as const) {
  test(`footer screenshots at ${name}`, async ({ browser }) => {
    test.slow(!!out);
    const ctx = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await ctx.newPage();
    for (const [slug, url] of [['home', '/'], ['terms', '/terms/'], ['jira', '/integrations/jira/']]) {
      await page.goto(`${base}${url}`);
      const footer = page.locator('footer');
      await footer.scrollIntoViewIfNeeded();
      await expect(footer.locator('nav[aria-label="Product"] a')).toHaveCount(6);
      await pause(page);
      if (out) await footer.screenshot({ path: path.join(out, `footer-${name}-${slug}.png`) });
    }
    await ctx.close();
  });
}
