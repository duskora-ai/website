import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
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

// 404.html is served at an unknown URL by GitHub Pages; here it is loaded directly.
const PAGES = ['/', '/beta/', '/terms/', '/privacy/', '/refunds/', '/404.html', '/integrations/', '/integrations/github/', '/integrations/linear/', '/integrations/jira/', '/blog/', '/blog/welcome-to-duskora/', '/blog/getting-started-with-duskora/'];

const PRODUCT = [
  ['Integrations', '/integrations/'],
  ['GitHub', '/integrations/github/'],
  ['Linear', '/integrations/linear/'],
  ['Jira', '/integrations/jira/'],
  ['Pricing', '/#pricing'],
  ['Blog', '/blog/'],
];
const LEGAL = [
  ['Terms', '/terms/'],
  ['Privacy', '/privacy/'],
  ['Refunds', '/refunds/'],
  ['hello@duskora.ai', 'mailto:hello@duskora.ai'],
  ['Instagram', 'https://www.instagram.com/duskora_ai/'],
  ['LinkedIn', 'https://www.linkedin.com/company/duskora-ai/'],
  ['GitHub', 'https://github.com/duskora-ai'],
];
const SAME_AS = [
  'https://www.instagram.com/duskora_ai/',
  'https://www.linkedin.com/company/duskora-ai/',
  'https://github.com/duskora-ai',
];

for (const start of PAGES) {
  test(`footer on ${start} links the product and legal pages`, async ({ page }) => {
    await page.goto(`${base}${start}`);
    for (const [label, links] of [['Product', PRODUCT], ['Legal', LEGAL]] as const) {
      const nav = page.locator(`footer nav[aria-label="${label}"]`);
      await expect(nav).toHaveCount(1);
      const a = nav.locator('a');
      await expect(a).toHaveText(links.map(([name]) => name));
      for (const [i, [, href]] of links.entries()) await expect(a.nth(i)).toHaveAttribute('href', href);
    }
    // Profiles we own carry rel="me"; the Organization sameAs lists the same URLs (e2e/structured-data.spec.ts).
    for (const href of SAME_AS) await expect(page.locator(`footer nav[aria-label="Legal"] a[href="${href}"]`)).toHaveAttribute('rel', 'me');
    for (const [, href] of PRODUCT.slice(0, 4)) {
      const res = await page.request.get(`${base}${href}`);
      expect(res.status(), href).toBe(200);
    }
  });
}

test('footer link targets: pricing anchor exists on the home page', async ({ page }) => {
  await page.goto(`${base}/`);
  await page.locator('footer a[href="/#pricing"]').click();
  await expect(page.locator('#pricing')).toBeInViewport();
});

test('every page fits 375px with no horizontal scroll and the footer inside the viewport', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await ctx.newPage();
  for (const start of PAGES) {
    await page.goto(`${base}${start}`);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(m.sw, start).toBeLessThanOrEqual(m.cw);
    for (const a of await page.locator('footer a').all()) {
      const box = await a.boundingBox();
      expect(box!.x, start).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, start).toBeLessThanOrEqual(375);
    }
  }
  await ctx.close();
});
