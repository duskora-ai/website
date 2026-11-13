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

test.use({ video: 'on' });

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

for (const scheme of ['light', 'dark'] as const) {
  test(`follow links are legible on a phone in ${scheme} mode`, async ({ page }) => {
    test.slow(!!out);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.route('**/beta-requests', (route) => route.fulfill({ status: 201, body: '{}', contentType: 'application/json' }));
    await page.goto(`${base}/beta/`);
    await expect(page.locator('#beta-follow')).toBeHidden();
    await page.getByLabel('Name', { exact: true }).fill('Ada Lovelace');
    await page.getByLabel('Work email').fill('ada@example.com');
    await page.locator('input[name=codeHost]').first().check({ force: true });
    await page.locator('textarea[name=useCase]').fill('Extend our API');
    await pause(page);
    await page.getByRole('button', { name: 'Request access' }).click();
    await expect(page.getByRole('status')).toHaveText("Thanks, we'll be in touch.");
    const follow = page.locator('#beta-follow');
    await expect(follow).toBeVisible();
    await expect(follow.getByRole('link')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const colors = await follow.evaluate((el) => {
      const bg = getComputedStyle(document.body).backgroundColor;
      return [bg, getComputedStyle(el.querySelector('p')!).color, getComputedStyle(el.querySelector('a')!).color];
    });
    for (const c of colors.slice(1)) expect(c).not.toBe(colors[0]);
    await pause(page, 2000);
    if (out) await page.screenshot({ path: path.join(out, `beta-follow-${scheme}.png`) });
    await page.close();
    if (out) await page.video()?.saveAs(path.join(out, `beta-follow-${scheme}.webm`));
  });
}
