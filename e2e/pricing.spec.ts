import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
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

const price = (page: import('@playwright/test').Page, id: string) => page.locator(`[data-plan=${id}] .price`).innerText();
const pick = (page: import('@playwright/test').Page, group: string, label: string) =>
  page.locator(`#${group}-switch label`, { hasText: label }).click();

test('pricing section, header links and plan table', async ({ page }) => {
  await page.goto(`${base}/`);
  await expect(page.locator('#pricing')).toBeVisible();
  await expect(page.locator('#pricing .plan')).toHaveCount(5);
  for (const [start, href] of [['/', '#pricing'], ['/terms/', '/#pricing'], ['/privacy/', '/#pricing'], ['/refunds/', '/#pricing']]) {
    await page.goto(`${base}${start}`);
    await expect(page.locator('header a', { hasText: 'Pricing' })).toHaveAttribute('href', href);
    await expect(page.locator('header a', { hasText: 'Sign in' })).toHaveAttribute('href', 'https://dev.factory.duskora.ai');
  }
  await page.goto(`${base}/`);
  const team = page.locator('[data-plan=team]');
  await expect(team).toContainText('200');
  await expect(team).toContainText('$2.50 each (opt-in)');
  await expect(page.locator('[data-plan=developer]')).not.toContainText('each (opt-in)');
  await expect(page.locator('[data-plan=enterprise]')).toContainText('Contract');
  await expect(page.locator('.faq details')).toHaveCount(4);
  await expect(page.locator('#pricing a[href="/terms/"]')).toHaveCount(1);
  await expect(page.locator('#pricing a[href="/privacy/"]')).toHaveCount(1);
});

test('interval and currency switches update prices and VAT labels', async ({ page }) => {
  await page.goto(`${base}/`);
  expect(await price(page, 'team')).toContain('$349');
  expect(await price(page, 'team')).not.toMatch(/VAT/);
  await pick(page, 'interval', 'Annual');
  expect(await price(page, 'developer')).toContain('$990');
  expect(await price(page, 'business')).toContain('$9,990');
  await pick(page, 'interval', 'Monthly');
  await pick(page, 'currency', 'GBP');
  expect(await price(page, 'team')).toContain('£279');
  expect(await price(page, 'team')).toContain('+ VAT');
  await expect(page.locator('[data-plan=team]')).toContainText('£2.00 each');
  await pick(page, 'interval', 'Annual');
  expect(await price(page, 'business')).toContain('£7,990');
  await pick(page, 'currency', 'EUR');
  expect(await price(page, 'developer')).toContain('€890');
  expect(await price(page, 'developer')).toContain('excl. VAT');
  await expect(page.locator('[data-plan=business]')).toContainText('€2.25 each');
  await pick(page, 'interval', 'Monthly');
  expect(await price(page, 'business')).toContain('€899');
});

test.describe('default currency', () => {
  for (const [tz, locale, expected] of [
    ['Europe/London', 'en-US', '£'],
    ['Europe/Paris', 'en-US', '€'],
    ['Europe/Dublin', 'en-GB', '€'],
    ['America/New_York', 'en-US', '$'],
    ['America/New_York', 'en-GB', '£'],
  ]) {
    test(`${tz} / ${locale} -> ${expected}`, async ({ browser }) => {
      const ctx = await browser.newContext({ timezoneId: tz, locale });
      const page = await ctx.newPage();
      await page.goto(`${base}/`);
      expect(await price(page, 'team')).toContain(`${expected}`);
      await ctx.close();
    });
  }

  test('saved choice persists and overrides default', async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: 'Europe/London' });
    const page = await ctx.newPage();
    await page.goto(`${base}/`);
    await pick(page, 'currency', 'EUR');
    await page.reload();
    expect(await price(page, 'team')).toContain('€319');
    await expect(page.locator('input[name=currency][value=eur]')).toBeChecked();
    await ctx.close();
  });

  test('throwing localStorage does not break the page', async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new Error('denied'); };
      Storage.prototype.setItem = () => { throw new Error('denied'); };
    });
    await page.goto(`${base}/`);
    await pick(page, 'currency', 'GBP');
    expect(await price(page, 'team')).toContain('£279');
  });
});

test('CTAs point at app sign-up with the right parameters', async ({ page }) => {
  await page.goto(`${base}/`);
  const check = async (sel: string, plan: string, interval: string, currency: string) => {
    const u = new URL((await page.locator(sel).getAttribute('href'))!);
    expect(u.origin).toBe('https://dev.factory.duskora.ai');
    expect(u.pathname).toBe('/signup');
    expect(Object.fromEntries(u.searchParams)).toEqual({ plan, interval, currency });
  };
  for (const id of ['trial', 'developer', 'team', 'business']) await check(`[data-cta=${id}]`, id, 'month', 'usd');
  await pick(page, 'interval', 'Annual');
  await pick(page, 'currency', 'EUR');
  for (const id of ['trial', 'developer', 'team', 'business']) await check(`[data-cta=${id}]`, id, 'year', 'eur');
  await expect(page.locator('[data-cta=enterprise]')).toHaveAttribute('href', 'mailto:hello@duskora.ai');
  for (const sel of ['.hero a.btn-primary', '.closer a.btn']) {
    await expect(page.locator(sel)).toHaveText('Start free trial');
    await expect(page.locator(sel)).toHaveAttribute('href', 'https://dev.factory.duskora.ai/signup');
  }
  await expect(page.locator('.hero a.btn-ghost')).toHaveAttribute('href', '#pricing');
  for (const href of await page.locator('a[href^="mailto:"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!))) {
    expect(href.toLowerCase()).not.toContain('early');
  }
  await expect(page.locator('body')).not.toContainText(/request early access/i);
});

test('pricing cards stack on mobile without horizontal scroll', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/`);
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(m.sw).toBeLessThanOrEqual(m.cw);
  const a = (await page.locator('[data-plan=trial]').boundingBox())!;
  const b = (await page.locator('[data-plan=developer]').boundingBox())!;
  expect(b.y).toBeGreaterThan(a.y + a.height - 1);
  expect(Math.abs(a.x - b.x)).toBeLessThan(1);
  await ctx.close();
});
