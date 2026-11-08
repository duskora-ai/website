import { test, expect, type Page } from '@playwright/test';
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
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => server.close());

const DONE = "Thanks, we'll be in touch.";

async function expectFollowLinks(page: Page) {
  const follow = page.locator('#beta-follow');
  await expect(follow).toBeVisible();
  await expect(follow).toContainText('Follow along while you wait:');
  for (const [name, href] of [['LinkedIn', 'https://www.linkedin.com/company/duskora-ai/'], ['Instagram', 'https://www.instagram.com/duskora_ai/']]) {
    const link = follow.getByRole('link', { name, exact: true });
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener');
  }
}

async function fillValid(page: Page) {
  await page.getByLabel('Name', { exact: true }).fill('Ada Lovelace');
  await page.getByLabel('Work email').fill('ada@example.com');
  await page.locator('input[value=gitlab]').check();
  await page.getByLabel('What do you want to use Duskora for?').fill('Extend our API');
}

test('beta page is kept out of search results but keeps its canonical URL', async ({ page }) => {
  await page.goto(`${base}/beta/`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://duskora.ai/beta/');
});

for (const [name, width, height] of [['desktop', 1280, 900], ['phone', 375, 800]] as const) {
  test.describe(`beta form at ${name} width`, () => {
    test.use({ viewport: { width, height } });
    let requests: { body: unknown }[];
    test.beforeEach(async ({ page }) => {
      requests = [];
      await page.route('**/beta-requests', async (route) => {
        requests.push({ body: route.request().postDataJSON() });
        await route.fulfill({ status: 201, body: '{}' , contentType: 'application/json' });
      });
      await page.goto(`${base}/beta/`);
    });

    test('has no horizontal overflow and the exact placeholder', async ({ page }) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await expect(page.locator('textarea[name=useCase]')).toHaveAttribute('placeholder', 'Extend our Nest.js API with new endpoints, Postgres via Prisma.');
      await expect(page.locator('input[name=codeHost]')).toHaveCount(6);
      await expect(page.locator('.beta-privacy a')).toHaveAttribute('href', '/privacy/');
    });

    test('sign-up links on the home page go to the form', async ({ page }) => {
      await page.goto(`${base}/`);
      await expect(page.locator('.hero a[data-signup]')).toHaveAttribute('href', '/beta/');
      await expect(page.locator('.closer a[data-signup]')).toHaveAttribute('href', '/beta/');
    });

    test('empty submit shows errors, focuses the first field and sends nothing', async ({ page }) => {
      await page.getByRole('button', { name: 'Request access' }).click();
      await expect(page.locator('.field-error:not(:empty)')).toHaveCount(4);
      await expect(page.locator('input[name=name]')).toBeFocused();
      expect(requests).toHaveLength(0);
    });

    test('invalid email is rejected', async ({ page }) => {
      await fillValid(page);
      await page.getByLabel('Work email').fill('nope');
      await page.getByRole('button', { name: 'Request access' }).click();
      await expect(page.locator('#e-email')).toHaveText('Enter a valid email address.');
      expect(requests).toHaveLength(0);
    });

    test('Other shows a required text box', async ({ page }) => {
      await expect(page.locator('input[name=hostOther]')).toBeHidden();
      await fillValid(page);
      await page.locator('input[value=other]').check();
      await expect(page.locator('input[name=hostOther]')).toBeVisible();
      await page.getByRole('button', { name: 'Request access' }).click();
      await expect(page.locator('#e-host-other')).not.toBeEmpty();
      expect(requests).toHaveLength(0);
      await page.locator('input[name=hostOther]').fill('Gitea');
      await page.getByRole('button', { name: 'Request access' }).click();
      await expect(page.getByRole('status')).toHaveText(DONE);
      expect(requests[0].body).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com', codeHost: 'other', codeHostOther: 'Gitea', useCase: 'Extend our API' });
    });

    test('valid submit posts the fields and shows the confirmation', async ({ page }) => {
      await expect(page.locator('#beta-follow')).toBeHidden();
      await fillValid(page);
      await page.getByRole('button', { name: 'Request access' }).click();
      await expect(page.getByRole('status')).toHaveText(DONE);
      await expect(page.locator('#beta-form')).toBeHidden();
      await expectFollowLinks(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect(requests).toHaveLength(1);
      expect(requests[0].body).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com', codeHost: 'gitlab', useCase: 'Extend our API' });
    });

    test('button is disabled while sending', async ({ page }) => {
      await page.unroute('**/beta-requests');
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let count = 0;
      await page.route('**/beta-requests', async (route) => { count++; await gate; await route.fulfill({ status: 200, body: '{}' }); });
      await fillValid(page);
      await page.getByRole('button', { name: 'Request access' }).click();
      await expect(page.locator('#beta-submit')).toBeDisabled();
      await page.locator('#beta-form').evaluate((f: HTMLFormElement) => f.requestSubmit());
      release();
      await expect(page.getByRole('status')).toHaveText(DONE);
      expect(count).toBe(1);
    });

    test('same message for a repeat email (200)', async ({ page }) => {
      await page.unroute('**/beta-requests');
      await page.route('**/beta-requests', (route) => route.fulfill({ status: 200, body: '{}' }));
      await fillValid(page);
      await page.getByRole('button', { name: 'Request access' }).click();
      await expect(page.getByRole('status')).toHaveText(DONE);
      await expectFollowLinks(page);
    });

    test('500 and network failure show an error and allow retry', async ({ page }) => {
      await page.unroute('**/beta-requests');
      await page.route('**/beta-requests', (route) => route.fulfill({ status: 500, body: 'x' }));
      await fillValid(page);
      await page.getByRole('button', { name: 'Request access' }).click();
      await expect(page.locator('#e-form')).toHaveText('Something went wrong. Please try again.');
      await expect(page.locator('#beta-submit')).toBeEnabled();
      await page.unroute('**/beta-requests');
      await page.route('**/beta-requests', (route) => route.abort());
      await page.getByRole('button', { name: 'Request access' }).click();
      await expect(page.locator('#e-form')).toHaveText('Something went wrong. Please try again.');
      await expect(page.locator('#beta-submit')).toBeEnabled();
      await expect(page.locator('#beta-follow')).toBeHidden();
    });
  });
}
