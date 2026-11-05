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

const ORIGIN = 'https://duskora.ai';
// path -> the name its h1 must contain
const PAGES: Record<string, string> = {
  '/integrations/': 'integrations',
  '/integrations/github/': 'GitHub',
  '/integrations/linear/': 'Linear',
  '/integrations/jira/': 'Jira',
};
const TITLES = new Set<string>();
const DESCRIPTIONS = new Set<string>();

for (const [p, name] of Object.entries(PAGES)) {
  test(`${p} loads with its own meta and links back to home, pricing and the beta form`, async ({ page }) => {
    const res = await page.goto(`${base}${p}`);
    expect(res?.status()).toBe(200);

    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('main.doc h1')).toContainText(name);

    const title = await page.title();
    expect(title).toContain('Duskora.ai');
    expect(TITLES.has(title), `duplicate title: ${title}`).toBe(false);
    TITLES.add(title);
    const description = (await page.locator('meta[name=description]').getAttribute('content')) || '';
    expect(description.length).toBeGreaterThan(10);
    expect(DESCRIPTIONS.has(description), `duplicate description on ${p}`).toBe(false);
    DESCRIPTIONS.add(description);

    await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', `${ORIGIN}${p}`);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `${ORIGIN}${p}`);
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website');
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /\w{3,}/);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', /\w{3,}/);

    await expect(page.locator('header a.brand')).toHaveAttribute('href', '/');
    await expect(page.locator('main.doc a[href="/#pricing"]')).toHaveCount(1);
    await expect(page.locator('main.doc a[href="/beta/"]')).toHaveCount(1);
    if (p !== '/integrations/') await expect(page.locator('main.doc a[href="/integrations/"]')).toHaveCount(1);

    // the site's font subset has no arrow glyph
    expect(await page.locator('body').innerText()).not.toContain('→');

    await page.locator('header a.brand').click();
    await expect(page).toHaveURL(`${base}/`);
  });
}

test('the GitHub page describes pull requests, not issue sync', async ({ page }) => {
  await page.goto(`${base}/integrations/github/`);
  const text = await page.locator('main.doc').innerText();
  expect(text).toMatch(/pull request/i);
  expect(text).not.toMatch(/two-way|sync/i);
});

test('the index links to each integration page', async ({ page }) => {
  await page.goto(`${base}/integrations/`);
  for (const slug of ['github', 'linear', 'jira']) {
    await expect(page.locator(`main.doc a[href="/integrations/${slug}/"]`)).toHaveCount(1);
  }
});

test('home page chips link GitHub, Linear and Jira to their pages, and only those', async ({ page }) => {
  await page.goto(`${base}/`);
  const chips = page.locator('.integrations .chip');
  for (const [name, slug] of [['GitHub', 'github'], ['Linear', 'linear'], ['Jira', 'jira']]) {
    await expect(chips.filter({ hasText: name })).toHaveAttribute('href', `/integrations/${slug}/`);
  }
  for (const name of ['Slack', 'Anthropic', 'OpenAI', 'Google']) {
    await expect(page.locator('.integrations span.chip', { hasText: name })).toHaveCount(1);
  }
  await expect(page.locator('.integrations a.chip')).toHaveCount(3);

  await chips.filter({ hasText: 'Linear' }).click();
  await expect(page).toHaveURL(`${base}/integrations/linear/`);
  await expect(page.locator('h1')).toHaveText('Duskora with Linear');
});
