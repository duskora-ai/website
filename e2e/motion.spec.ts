import { test, expect } from '@playwright/test';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';

// Motion added by site.js: scroll reveals, the typed headline, the hero's example run, the phone menu and the image viewer.
const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2' };
const PAGES = ['/', '/beta/', '/privacy/', '/refunds/', '/terms/', '/integrations/', '/integrations/github/', '/integrations/linear/', '/integrations/jira/', '/blog/', '/blog/welcome-to-duskora/', '/blog/getting-started-with-duskora/', '/blog/how-budgets-work-in-duskora/', '/blog/a-new-look-for-duskora/', '/404.html'];
let server: http.Server;
let base = '';

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

// Elements that are still waiting to be revealed.
const hidden = (page: import('@playwright/test').Page) =>
  page.locator('[data-reveal], .stage, .plan').evaluateAll((els) => els.filter((e) => getComputedStyle(e).opacity === '0').length);

for (const p of PAGES) {
  test(`${p} loads /site.js deferred and marks JavaScript as available`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + p);
    await expect(page.locator('head script[src="/site.js"]')).toHaveAttribute('defer', '');
    await expect(page.locator('html')).toHaveClass(/\bjs\b/);
    expect(await page.evaluate(() => (window as any).duskoraMotion)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('sections below the fold start hidden and appear when scrolled to', async ({ page }) => {
  await page.goto(`${base}/`);
  const feature = page.locator('.feature').first();
  await expect(feature).toHaveCSS('opacity', '0');
  await feature.scrollIntoViewIfNeeded();
  await expect(feature).toHaveClass(/\bin\b/);
  await expect(feature).toHaveCSS('opacity', '1');
});

test('nothing is hidden without JavaScript', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(`${base}/`);
  expect(await hidden(page)).toBe(0);
  await expect(page.locator('h1 em')).toBeVisible();
  await expect(page.locator('#run')).toContainText('Waiting for your approval.');
  await expect(page.locator('#run-approve')).toBeHidden();
  await ctx.close();
});

test('nothing is hidden or typed with reduced motion', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(`${base}/`);
  expect(await hidden(page)).toBe(0);
  await expect(page.locator('h1 .ch')).toHaveCount(0);
  await expect(page.locator('#run-approve')).toBeEnabled();
  await page.locator('#run-approve').click();
  await expect(page.locator('#run-badge')).toHaveText('Shipped');
  await ctx.close();
});

test('the headline keeps its full text while the highlighted words are typed in', async ({ page }) => {
  await page.goto(`${base}/`);
  await expect(page.locator('h1 em.typing')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('AI coding agents that ship your tickets');
  const letters = 'ship your tickets'.length;
  await expect(page.locator('h1 .ch')).toHaveCount(letters);
  await expect(page.locator('h1 .ch.on')).toHaveCount(letters);
});

test('the example run waits for Approve, ships, and can run again', async ({ page }) => {
  await page.goto(`${base}/`);
  const approve = page.locator('#run-approve');
  await expect(approve).toBeDisabled();
  await expect(approve).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('#run-badge')).toHaveText('Approval');
  await expect(page.locator('.run-steps li.done')).toHaveCount(4);
  await approve.click();
  await expect(page.locator('#run-badge')).toHaveText('Shipped', { timeout: 10000 });
  await expect(page.locator('.run-steps li.done')).toHaveCount(6);
  await expect(page.locator('#run-status')).toHaveText('Shipped to production.');
  await page.getByRole('button', { name: 'Run it again' }).click();
  await expect(page.locator('#run-badge')).toHaveText('Plan');
});

test('the phone menu opens the page links and closes after one is chosen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${base}/`);
  const pricing = page.locator('header a[href="#pricing"]');
  await expect(pricing).toBeHidden();
  const menu = page.getByRole('button', { name: 'Menu' });
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(pricing).toBeVisible();
  await pricing.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#pricing')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('clicking a platform screenshot opens it large, and Escape closes it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}/`);
  const shot = page.getByRole('button', { name: /^Enlarge image: Plan artifact/ });
  await shot.scrollIntoViewIfNeeded();
  await expect(shot).toHaveClass(/\bin\b/);
  await shot.click();
  const viewer = page.locator('dialog.lightbox');
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('img')).toHaveAttribute('src', /\/screenshots\/plan-1200\.(avif|webp)$/);
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
});

test('before/after sliders move with the keyboard and by dragging', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}/blog/a-new-look-for-duskora/`);
  const sliders = page.locator('.compare');
  await expect(sliders).toHaveCount(4);
  const slider = sliders.first();
  const range = slider.getByRole('slider', { name: 'Slide between the old and the new home page' });
  const pos = () => slider.evaluate((el) => parseFloat((el as HTMLElement).style.getPropertyValue('--pos')));
  await slider.scrollIntoViewIfNeeded();
  await range.focus();
  await page.keyboard.press('ArrowRight');
  expect(await pos()).toBe(51);
  // the old picture is clipped to the left of the handle
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await pos()).toBeLessThan(25);
  const handle = (await slider.locator('.compare-handle').boundingBox())!;
  expect(Math.abs(handle.x + handle.width / 2 - (box.x + box.width * 0.2))).toBeLessThan(8);
  // both pictures are the same size, so they line up
  for (const side of ['old', 'new']) await expect(slider.locator(`.compare-${side} img`)).toHaveAttribute('width', '1520');
});

test('before/after sliders show both pictures without JavaScript', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(`${base}/blog/a-new-look-for-duskora/`);
  const slider = page.locator('.compare').first();
  const oldBox = (await slider.locator('.compare-old').boundingBox())!;
  const newBox = (await slider.locator('.compare-new').boundingBox())!;
  expect(oldBox.y).toBeGreaterThanOrEqual(newBox.y + newBox.height - 1);
  await expect(slider.locator('.compare-range')).toBeHidden();
  await ctx.close();
});
