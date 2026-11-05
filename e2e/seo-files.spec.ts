import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const root = path.resolve(__dirname, '..');
const types: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
};
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
const CANONICAL = [
  `${ORIGIN}/`,
  `${ORIGIN}/terms/`,
  `${ORIGIN}/privacy/`,
  `${ORIGIN}/refunds/`,
  `${ORIGIN}/integrations/`,
  `${ORIGIN}/integrations/github/`,
  `${ORIGIN}/integrations/linear/`,
  `${ORIGIN}/integrations/jira/`,
];

test('robots.txt allows all crawlers and points at the sitemap', async ({ request }) => {
  const res = await request.get(`${base}/robots.txt`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/plain');
  const lines = (await res.text()).split(/\r?\n/).map((l) => l.trim());
  expect(lines).toContain('User-agent: *');
  expect(lines).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  // nothing is blocked: in particular /beta/ must stay crawlable so its noindex tag is seen
  expect(lines.filter((l) => /^Disallow:\s*\S/i.test(l))).toEqual([]);
});

test('sitemap.xml lists the canonical pages, each with lastmod, and each one is served', async ({ request }) => {
  const res = await request.get(`${base}/sitemap.xml`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('xml');
  const xml = await res.text();
  expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
  const locs = entries.map((e) => e.match(/<loc>([^<]+)<\/loc>/)?.[1]);
  expect(locs).toEqual(CANONICAL);
  expect(xml).not.toContain('/beta/');
  for (const e of entries) expect(e).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);

  for (const loc of CANONICAL) {
    const page = await request.get(loc.replace(ORIGIN, base));
    expect(page.status(), `${loc} should be served`).toBe(200);
    expect(page.headers()['content-type']).toContain('text/html');
  }
});
