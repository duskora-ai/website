import { test, expect, type Page } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const artifacts = process.env.QA_ARTIFACTS_DIR;
const pause = (page: Page, ms = 1000) => (artifacts ? page.waitForTimeout(ms) : Promise.resolve());
const shot = async (page: Page, name: string) => {
  if (artifacts) await page.screenshot({ path: path.join(artifacts, name), fullPage: true });
};
let server: http.Server;
let base = '';

test.use({ video: 'on' });
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

test('QA walkthrough: pricing desktop, switches, FAQ and mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}/`);
  await pause(page);
  await page.locator('header a', { hasText: 'Pricing' }).click();
  await pause(page);
  await shot(page, '01-pricing-usd-monthly.png');
  await page.locator('#interval-switch label', { hasText: 'Annual' }).click();
  await pause(page);
  await expect(page.locator('[data-plan=team] .price')).toContainText('$3,490');
  await page.locator('#currency-switch label', { hasText: 'GBP' }).click();
  await pause(page);
  await expect(page.locator('[data-plan=team] .price')).toContainText('£2,790');
  await expect(page.locator('[data-plan=team] .price')).toContainText('+ VAT');
  await shot(page, '02-pricing-gbp-annual.png');
  await page.locator('.faq summary', { hasText: 'Can I cancel' }).click();
  await pause(page);
  const faq = await page.locator('.faq').innerText();
  expect(faq).toMatch(/at the end of the current billing period/);
  await expect(page.locator('footer a[href="/terms/"]')).toHaveCount(1);
  await expect(page.locator('footer a[href="/privacy/"]')).toHaveCount(1);
  await expect(page.locator('footer a[href="/refunds/"]')).toHaveCount(1);
  await expect(page.locator('footer a[href="mailto:hello@duskora.ai"]')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await shot(page, '03-faq.png');
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`${base}/#pricing`);
  await pause(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await shot(page, '04-mobile.png');
  await page.close();
  await page.video()?.saveAs(path.join(artifacts || '/dev/null', 'pricing-walkthrough.webm')).catch(() => {});
});
