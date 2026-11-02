import { test, expect, type Page } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const artifacts = process.env.QA_ARTIFACTS_DIR;
const pause = (page: Page, ms = 1000) => (artifacts ? page.waitForTimeout(ms) : Promise.resolve());
const shot = async (page: Page, name: string) => {
  if (artifacts) await page.screenshot({ path: path.join(artifacts, name), fullPage: true });
};

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
test.use({ video: 'on' });
test.slow(!!artifacts);

const HEADINGS: Record<string, string[]> = {
  terms: ['The service', 'Accounts', 'Your code and content', 'Bring your own keys and third-party model vendors', 'Fees and billing', 'Cancellation', 'Acceptable use', 'Liability', 'Governing law', 'Contact'],
  privacy: ['What we collect', 'How we use it', 'Third parties and model vendors', 'Payments (Stripe)', 'Retention', 'Your rights', 'Cookies and analytics', 'Security', 'Changes to this policy', 'Contact'],
  refunds: ['Plans', 'Cancellation', 'Refunds'],
};
const TITLES = new Set<string>();

for (const [slug, headings] of Object.entries(HEADINGS)) {
  test(`${slug} page: headings, text, updated date, meta, nav`, async ({ page }) => {
    await page.goto(`${base}/${slug}/`);
    await pause(page);
    const h2s = await page.locator('main.doc h2').allTextContents();
    expect(h2s).toEqual(headings);
    // every section has its text; no DRAFT placeholders remain
    await expect(page.locator('main.doc .todo')).toHaveCount(0);
    for (const h of await page.locator('main.doc h2').all()) {
      await expect(h.locator('xpath=following-sibling::*[1]')).toHaveText(/\w{3,}/);
    }
    await expect(page.locator('main.doc .updated')).toHaveText(/^Last updated: .+\d{4}/);
    const title = await page.title();
    expect(title).toContain('Duskora.ai');
    expect(TITLES.has(title)).toBe(false);
    TITLES.add(title);
    expect((await page.locator('meta[name=description]').getAttribute('content'))?.length).toBeGreaterThan(10);
    await expect(page.locator('header a.brand')).toHaveAttribute('href', '/');
    await expect(page.locator('header a', { hasText: 'How it works' })).toHaveAttribute('href', '/#how');
    await expect(page.locator('header a', { hasText: 'Features' })).toHaveAttribute('href', '/#features');
    await shot(page, `01-${slug}-desktop.png`);
    await pause(page);
  });
}

test('refunds page states plan facts without prices', async ({ page }) => {
  await page.goto(`${base}/refunds/`);
  const plans = await page.locator('main.doc h2', { hasText: 'Plans' }).locator('+ p').textContent();
  expect(plans).toMatch(/monthly or annual/i);
  expect(plans).toMatch(/cancel at any time/i);
  expect(plans).toMatch(/end of the current billing period/i);
  expect(await page.locator('main.doc').textContent()).not.toMatch(/[$€£]/);
});

// The drafts mark facts only the owner can supply (company details, retention periods, the
// refund window) with .fill. Per the README, the pages don't merge until every one is replaced.
test('no unfilled facts remain', async ({ page }) => {
  for (const slug of ['terms', 'privacy', 'refunds']) {
    await page.goto(`${base}/${slug}/`);
    const left = await page.locator('main.doc .fill').allTextContents();
    expect(left, `${slug} still has unfilled facts`).toEqual([]);
  }
});

test('footer links on every page work, using clean URLs', async ({ page }) => {
  for (const start of ['/', '/terms/', '/privacy/', '/refunds/']) {
    await page.goto(`${base}${start}`);
    const links = page.locator('footer a');
    for (const [name, href] of [['Terms', '/terms/'], ['Privacy', '/privacy/'], ['Refunds', '/refunds/']]) {
      await expect(links.filter({ hasText: name })).toHaveAttribute('href', href);
    }
    await expect(page.locator('footer a[href^="mailto:"]')).toHaveCount(1);
  }
  await page.goto(`${base}/`);
  await pause(page);
  await shot(page, '02-index-footer.png');
  for (const [name, slug] of [['Terms', 'terms'], ['Privacy', 'privacy'], ['Refunds', 'refunds']]) {
    await page.goto(`${base}/`);
    await page.locator('footer a', { hasText: name }).click();
    await expect(page).toHaveURL(`${base}/${slug}/`);
    await expect(page.locator('h1')).toBeVisible();
    await pause(page);
    // from the subpage to another one
    await page.locator('footer a', { hasText: 'Terms' }).click();
    await expect(page).toHaveURL(`${base}/terms/`);
    await page.locator('header a.brand').click();
    await expect(page).toHaveURL(`${base}/`);
  }
  await page.goto(`${base}/terms/`);
  await page.locator('header a', { hasText: 'How it works' }).click();
  await expect(page).toHaveURL(`${base}/#how`);
});

for (const scheme of ['light', 'dark'] as const) {
  for (const [w, h] of [[375, 800], [1280, 800]]) {
    test(`pages readable without horizontal scroll: ${scheme} ${w}px`, async ({ browser }) => {
      const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: w, height: h }, recordVideo: undefined });
      const page = await ctx.newPage();
      for (const slug of ['', 'terms', 'privacy', 'refunds']) {
        await page.goto(`${base}/${slug ? slug + '/' : ''}`);
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        expect(m.sw).toBeLessThanOrEqual(m.cw);
        if (slug) {
          const para = page.locator('main.doc p:not(.updated)').first();
          const box = await para.boundingBox();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(w);
          const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
          const dark = scheme === 'dark';
          expect(bg).toBe(dark ? 'rgb(11, 12, 15)' : 'rgb(246, 247, 249)');
        }
        await shot(page, `03-${slug || 'index'}-${scheme}-${w}.png`);
      }
      // footer wraps at 560 and below
      if (w === 375) {
        await page.goto(`${base}/terms/`);
        await pause(page);
      }
      await ctx.close();
    });
  }
}

test('index footer wraps cleanly at 560px', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 560, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/`);
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(m.sw).toBeLessThanOrEqual(m.cw);
  await ctx.close();
});
