import { test, expect, type Page } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
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

const PAGES = ['/', '/404.html', '/beta/', '/terms/', '/privacy/', '/refunds/', '/integrations/', '/integrations/github/', '/integrations/linear/', '/integrations/jira/', '/blog/', '/blog/welcome-to-duskora/', '/blog/getting-started-with-duskora/'];
const GTM = /^https:\/\/www\.googletagmanager\.com\//;
const TEST_ID = 'G-TEST123';

const ID_LINE = /var GA_ID = '[^']*';/;
const HOST_CHECK = "location.hostname !== 'duskora.ai'";

// Serve analytics.js with the given measurement ID and the duskora.ai-only check lifted, so it runs on the test server.
async function serveAnalytics(page: Page, id: string) {
  const src = fs.readFileSync(path.join(root, 'analytics.js'), 'utf8');
  expect(src).toMatch(ID_LINE);
  expect(src).toContain(HOST_CHECK);
  await page.route('**/analytics.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: src.replace(ID_LINE, `var GA_ID = '${id}';`).replace(HOST_CHECK, 'false') }));
}

// Serve analytics.js with a test measurement ID, and record (but never send) gtag.js requests. Unless `fresh` is set,
// the visitor has already accepted cookies, so the consent banner stays out of the way of the click tests.
async function withId(page: Page, { fresh = false } = {}) {
  const gtm: string[] = [];
  await serveAnalytics(page, TEST_ID);
  await page.route(GTM, (route) => { gtm.push(route.request().url()); return route.fulfill({ contentType: 'text/javascript', body: '' }); });
  if (!fresh) await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('duskora-consent', 'granted'); sessionStorage.setItem('seeded', '1'); } });
  return gtm;
}

const SIGNALS = ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage'];
const all = (v: string) => Object.fromEntries(SIGNALS.map((k) => [k, v]));
// Every gtag() call made so far, as arrays.
const calls = (page: Page) => page.evaluate(() => ((window as any).dataLayer || []).map((a: IArguments) => Array.from(a)).filter((a: unknown[]) => typeof a[0] === 'string').map((a: unknown[]) => a[0] === 'js' ? ['js'] : a));
const banner = (page: Page) => page.getByRole('region', { name: 'Cookie consent' });

// gtag() pushes its arguments objects onto dataLayer
test('analytics.js has the live measurement ID', () => {
  expect(fs.readFileSync(path.join(root, 'analytics.js'), 'utf8')).toContain("var GA_ID = 'G-CGBBLYCXMM';");
});

const events = (page: Page) =>
  page.evaluate(() => ((window as any).dataLayer || []).map((a: IArguments) => Array.from(a)).filter((a: unknown[]) => a[0] === 'event'));

for (const p of PAGES) {
  test(`${p} loads /analytics.js deferred in <head>, after the stylesheet`, async ({ page }) => {
    await page.goto(base + p);
    const script = page.locator('head script[src="/analytics.js"]');
    await expect(script).toHaveCount(1);
    await expect(script).toHaveAttribute('defer', '');
    const order = await page.locator('head link[rel="stylesheet"], head script[src="/analytics.js"]').evaluateAll((els) => els.map((el) => el.tagName));
    expect(order).toEqual(['LINK', 'SCRIPT']);
  });

  test(`${p} makes no Google Analytics requests and throws nothing off duskora.ai`, async ({ page }) => {
    const requests: string[] = [];
    const errors: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + p, { waitUntil: 'networkidle' });
    expect(requests.filter((u) => GTM.test(u) || /google-analytics\.com/.test(u))).toEqual([]);
    expect(await page.evaluate(() => typeof (window as any).gtag)).toBe('undefined');
    expect(errors).toEqual([]);
    await expect(banner(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cookie settings' })).toHaveCount(0);
  });

  test(`${p} asks for cookie consent with everything denied until the visitor chooses`, async ({ page, context }) => {
    await withId(page, { fresh: true });
    await page.goto(base + p, { waitUntil: 'networkidle' });
    await expect(banner(page)).toBeVisible();
    await expect(banner(page).getByRole('button', { name: 'Accept' })).toBeVisible();
    await expect(banner(page).getByRole('button', { name: 'Reject' })).toBeVisible();
    await expect(banner(page).getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy/#cookies');
    expect((await calls(page)).slice(0, 2)).toEqual([['consent', 'default', all('denied')], ['set', 'ads_data_redaction', true]]);
    expect((await calls(page)).filter((c) => c[0] === 'consent' && c[1] === 'update')).toEqual([]);
    expect((await context.cookies()).filter((c) => c.name.startsWith('_ga'))).toEqual([]);
  });

  test(`${p} footer "Cookie settings" reopens the consent banner`, async ({ page }) => {
    await withId(page);
    await page.goto(base + p);
    await expect(banner(page)).toBeHidden();
    const settings = page.locator('footer nav[aria-label="Legal"]').getByRole('button', { name: 'Cookie settings' });
    await expect(settings).toHaveCount(1);
    await settings.click();
    await expect(banner(page)).toBeVisible();
  });

  test(`${p} makes no Google Analytics requests while the ID is empty`, async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await serveAnalytics(page, '');
    await page.goto(base + p, { waitUntil: 'networkidle' });
    expect(requests.filter((u) => GTM.test(u) || /google-analytics\.com/.test(u))).toEqual([]);
    expect(await page.evaluate(() => typeof (window as any).gtag)).toBe('undefined');
  });

  test(`${p} loads gtag.js and configures GA with IP anonymisation once the ID is set`, async ({ page }) => {
    const gtm = await withId(page);
    await page.goto(base + p, { waitUntil: 'networkidle' });
    expect(gtm).toEqual([`https://www.googletagmanager.com/gtag/js?id=${TEST_ID}`]);
    const config = await page.evaluate(() => (window as any).dataLayer.map((a: IArguments) => Array.from(a)).filter((a: unknown[]) => a[0] === 'config'));
    expect(config).toEqual([['config', TEST_ID, { anonymize_ip: true }]]);
  });
}

test('sign-up and pricing buttons on the home page send sign_up_click', async ({ page }) => {
  await withId(page);
  await page.goto(`${base}/`);
  // stay on the page so dataLayer survives the clicks
  await page.evaluate(() => document.addEventListener('click', (e) => e.preventDefault()));
  await page.locator('.hero a[data-signup]').click();
  await page.locator('.closer a[data-signup]').click();
  await page.locator('a[data-cta="team"]').click();
  const team = await page.locator('a[data-cta="team"]').evaluate((a: HTMLAnchorElement) => a.href);
  expect(await events(page)).toEqual([
    ['event', 'sign_up_click', { link_url: `${base}/beta/`, page_path: '/' }],
    ['event', 'sign_up_click', { link_url: `${base}/beta/`, page_path: '/' }],
    ['event', 'sign_up_click', { link_url: team, page_path: '/', plan: 'team' }],
  ]);
});

test('other links do not send sign_up_click', async ({ page }) => {
  await withId(page);
  await page.goto(`${base}/`);
  await page.evaluate(() => document.addEventListener('click', (e) => e.preventDefault()));
  await page.locator('header a[href="#pricing"]').click();
  expect(await events(page)).toEqual([]);
});

async function submitBeta(page: Page) {
  await page.getByLabel('Name', { exact: true }).fill('Ada Lovelace');
  await page.getByLabel('Work email').fill('ada@example.com');
  await page.locator('input[value=gitlab]').check();
  await page.getByLabel('What do you want to use Duskora for?').fill('Extend our API');
  await page.getByRole('button', { name: 'Request access' }).click();
}

test('a successful beta request sends beta_request_submitted with the code host only', async ({ page }) => {
  await withId(page);
  await page.route('**/beta-requests', (route) => route.fulfill({ status: 201, body: '{}', contentType: 'application/json' }));
  await page.goto(`${base}/beta/`);
  await submitBeta(page);
  await expect(page.locator('#beta-done')).toBeVisible();
  const sent = await events(page);
  expect(sent).toEqual([['event', 'beta_request_submitted', { code_host: 'gitlab' }]]);
  expect(JSON.stringify(sent)).not.toMatch(/Ada|ada@example\.com|Extend our API/);
});

test('a failed beta request sends no beta_request_submitted', async ({ page }) => {
  await withId(page);
  await page.route('**/beta-requests', (route) => route.fulfill({ status: 500, body: 'x' }));
  await page.goto(`${base}/beta/`);
  await submitBeta(page);
  await expect(page.locator('#e-form')).toHaveText('Something went wrong. Please try again.');
  expect(await events(page)).toEqual([]);
});

test('the beta form still works while analytics is off', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/beta-requests', (route) => route.fulfill({ status: 201, body: '{}', contentType: 'application/json' }));
  await page.goto(`${base}/beta/`);
  await submitBeta(page);
  await expect(page.getByRole('status')).toHaveText("Thanks, we'll be in touch.");
  expect(errors).toEqual([]);
});

test('accepting cookies grants every consent signal and is remembered', async ({ page }) => {
  await withId(page, { fresh: true });
  await page.goto(`${base}/`);
  await banner(page).getByRole('button', { name: 'Accept' }).click();
  await expect(banner(page)).toBeHidden();
  expect((await calls(page)).filter((c) => c[0] === 'consent')).toEqual([['consent', 'default', all('denied')], ['consent', 'update', all('granted')]]);
  expect(await page.evaluate(() => localStorage.getItem('duskora-consent'))).toBe('granted');

  await page.reload({ waitUntil: 'networkidle' });
  await expect(banner(page)).toHaveCount(0);
  // the stored choice is applied before GA is configured
  expect((await calls(page)).slice(0, 5)).toEqual([
    ['consent', 'default', all('denied')], ['set', 'ads_data_redaction', true], ['consent', 'update', all('granted')], ['js'], ['config', TEST_ID, { anonymize_ip: true }],
  ]);
});

test('rejecting cookies keeps every consent signal denied and is remembered', async ({ page }) => {
  await withId(page, { fresh: true });
  await page.goto(`${base}/`);
  await banner(page).getByRole('button', { name: 'Reject' }).click();
  await expect(banner(page)).toBeHidden();
  expect((await calls(page)).filter((c) => c[0] === 'consent')).toEqual([['consent', 'default', all('denied')], ['consent', 'update', all('denied')]]);
  expect(await page.evaluate(() => localStorage.getItem('duskora-consent'))).toBe('denied');

  await page.reload({ waitUntil: 'networkidle' });
  await expect(banner(page)).toHaveCount(0);
  expect((await calls(page)).filter((c) => c[0] === 'consent')).toEqual([['consent', 'default', all('denied')]]);
});

test('a visitor can change their mind from the footer', async ({ page }) => {
  await withId(page, { fresh: true });
  await page.goto(`${base}/`);
  await banner(page).getByRole('button', { name: 'Reject' }).click();
  await page.getByRole('button', { name: 'Cookie settings' }).click();
  await banner(page).getByRole('button', { name: 'Accept' }).click();
  await expect(banner(page)).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('duskora-consent'))).toBe('granted');
});

test('the consent banner can be used with the keyboard', async ({ page }) => {
  await withId(page, { fresh: true });
  await page.goto(`${base}/privacy/`);
  await banner(page).getByRole('button', { name: 'Accept' }).focus();
  await page.keyboard.press('Enter');
  await expect(banner(page)).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('duskora-consent'))).toBe('granted');
});

test('the consent banner still works when storage is blocked', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await withId(page, { fresh: true });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  await page.goto(`${base}/`);
  await expect(banner(page)).toBeVisible();
  await banner(page).getByRole('button', { name: 'Accept' }).click();
  await expect(banner(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test('the privacy page explains the cookie banner and how to change your choice', async ({ page }) => {
  await page.goto(`${base}/privacy/`);
  const section = page.locator('#cookies + p');
  await expect(section).toContainText('only sets cookies if you accept them in the cookie banner');
  await expect(section).toContainText('Cookie settings');
});
