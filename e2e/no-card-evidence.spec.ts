import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const artifacts = process.env.QA_ARTIFACTS_DIR;
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

const pause = (page: import('@playwright/test').Page, ms = 1000) => (artifacts ? page.waitForTimeout(ms) : Promise.resolve());

for (const [name, width, height] of [['desktop', 1280, 900], ['phone', 375, 800]] as const) {
  test(`evidence: no-card notes at ${name} width`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height }, recordVideo: artifacts ? { dir: artifacts, size: { width, height } } : undefined });
    const page = await ctx.newPage();
    await page.goto(`${base}/`);
    await expect(page.locator('.hero .cta-note')).toBeVisible();
    await pause(page, 1500);
    if (artifacts) await page.screenshot({ path: path.join(artifacts, `01-hero-${name}.png`) });
    await page.locator('.trial-note').scrollIntoViewIfNeeded();
    await expect(page.locator('.trial-note')).toContainText('No card needed');
    await expect(page.locator('[data-plan=team] .plan-trial')).toContainText('No card needed');
    await pause(page, 1500);
    if (artifacts) await page.screenshot({ path: path.join(artifacts, `02-pricing-${name}.png`) });
    await page.locator('.closer .cta-note').scrollIntoViewIfNeeded();
    await expect(page.locator('.closer .cta-note')).toBeVisible();
    await pause(page, 1500);
    if (artifacts) await page.screenshot({ path: path.join(artifacts, `03-closer-${name}.png`) });
    await page.close();
    if (artifacts) await page.video()?.saveAs(path.join(artifacts, `no-card-${name}.webm`));
    await ctx.close();
  });
}
