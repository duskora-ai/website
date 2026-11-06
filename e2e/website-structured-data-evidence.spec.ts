import { test, expect } from '@playwright/test';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const art = process.env.QA_ARTIFACTS_DIR;
const pause = (page: import('@playwright/test').Page, ms = 1000) => (art ? page.waitForTimeout(ms) : Promise.resolve());
let server: http.Server;
let url = '';

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
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
test.afterAll(() => server.close());

test('WebSite structured data evidence: home page JSON-LD names the site Duskora.ai', async ({ page }) => {
  test.slow(!!art);
  await page.goto(url);
  await pause(page, 1500);
  if (art) {
    fs.mkdirSync(art, { recursive: true });
    await page.screenshot({ path: path.join(art, '01-home.png') });
  }

  const data = JSON.parse((await page.locator('head script[type="application/ld+json"]').first().textContent()) as string);
  const site = data['@graph'].find((n: any) => n['@type'] === 'WebSite');
  expect(site.name).toBe('Duskora.ai');
  expect(site.alternateName).toEqual(['Duskora AI', 'Duskora']);

  // Render only the WebSite node over the page so it is visible in the recording.
  await page.evaluate((text) => {
    const pre = document.createElement('pre');
    pre.id = 'website-node-view';
    pre.textContent = text;
    pre.style.cssText = 'position:fixed;inset:0;z-index:99999;margin:0;padding:24px;background:#fff;color:#000;font:16px monospace';
    document.body.appendChild(pre);
  }, JSON.stringify(site, null, 2));
  await expect(page.locator('#website-node-view')).toContainText('"name": "Duskora.ai"');
  await pause(page, 2000);
  if (art) await page.screenshot({ path: path.join(art, '02-website-node.png') });

  const video = page.video();
  await page.close();
  if (art) await video?.saveAs(path.join(art, 'website-structured-data.webm'));
});
