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

test('static plans evidence: JS disabled shows plans, JS enabled still switches', async ({ browser }) => {
  const off = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 }, recordVideo: artifacts ? { dir: artifacts } : undefined });
  const p1 = await off.newPage();
  await p1.goto(`${base}/#pricing`);
  await p1.locator('#plans').scrollIntoViewIfNeeded();
  await pause(p1);
  await expect(p1.locator('#plans .plan')).toHaveCount(4);
  await expect(p1.locator('#plans .price .amount')).toHaveText(['$99', '$349', '$999', 'Custom']);
  await expect(p1.locator('#pricing noscript p')).toContainText('billed monthly');
  if (artifacts) await p1.screenshot({ path: path.join(artifacts, '01-no-js-plans.png') });
  await pause(p1, 2000);
  await off.close();

  const on = await browser.newContext({ timezoneId: 'America/New_York', locale: 'en-US', viewport: { width: 1280, height: 900 } });
  const p2 = await on.newPage();
  await p2.goto(`${base}/#pricing`);
  await expect(p2.locator('[data-plan=developer] .price')).toContainText('$99');
  await p2.locator('#interval-switch label', { hasText: 'Annual' }).click();
  await pause(p2);
  await expect(p2.locator('[data-plan=developer] .price')).toContainText('$990');
  if (artifacts) await p2.screenshot({ path: path.join(artifacts, '02-js-yearly.png') });
  await on.close();
});
