import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const artifacts = process.env.QA_ARTIFACTS_DIR;
const pause = (page: import('@playwright/test').Page, ms = 1000) => (artifacts ? page.waitForTimeout(ms) : Promise.resolve());
let server: http.Server;
let base = '';

test.slow(!!artifacts);

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
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => server.close());

test('structured data evidence: JSON-LD matches visible pricing and FAQ', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: artifacts ? { dir: artifacts } : undefined });
  const page = await ctx.newPage();
  await page.goto(`${base}/#pricing`);
  await page.locator('#plans').scrollIntoViewIfNeeded();
  await pause(page);
  if (artifacts) await page.screenshot({ path: path.join(artifacts, '01-pricing-plans.png') });

  const data = JSON.parse(await page.locator('head script[type="application/ld+json"]').first().textContent() as string);
  const app = data['@graph'].find((n: any) => n['@type'] === 'SoftwareApplication');
  const usd = await page.evaluate(() => (window as any).PRICES.usd);
  const shown = await page.locator('#plans .price .amount').allTextContents();
  expect(app.offers.map((o: any) => `$${o.price}`)).toEqual(shown.slice(0, 3));
  expect(usd.developer[0]).toBe(app.offers[0].price);

  await page.locator('.faq').scrollIntoViewIfNeeded();
  await page.locator('.faq details').first().locator('summary').click();
  await pause(page);
  if (artifacts) await page.screenshot({ path: path.join(artifacts, '02-pricing-faq.png') });

  // Show the JSON-LD block itself on the page so the markup is visible in the recording.
  const json = JSON.stringify(data, null, 2);
  await page.evaluate((text) => {
    const pre = document.createElement('pre');
    pre.id = 'ldjson-view';
    pre.textContent = text;
    pre.style.cssText = 'position:fixed;inset:0;z-index:99999;margin:0;padding:16px;overflow:auto;background:#fff;color:#000;font:12px monospace';
    document.body.appendChild(pre);
  }, json);
  await pause(page, 2000);
  if (artifacts) await page.screenshot({ path: path.join(artifacts, '03-json-ld-markup.png') });
  await expect(page.locator('#ldjson-view')).toContainText('hello@duskora.ai');
  await ctx.close();
});
