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
  `${ORIGIN}/blog/`,
  `${ORIGIN}/blog/welcome-to-duskora/`,
  `${ORIGIN}/blog/getting-started-with-duskora/`,
  `${ORIGIN}/blog/how-budgets-work-in-duskora/`,
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

// every HTML page, including /beta/ (which is left out of the sitemap)
const PAGE_CANONICALS: Record<string, string> = {
  '/': `${ORIGIN}/`,
  '/beta/': `${ORIGIN}/beta/`,
  '/terms/': `${ORIGIN}/terms/`,
  '/privacy/': `${ORIGIN}/privacy/`,
  '/refunds/': `${ORIGIN}/refunds/`,
  '/blog/': `${ORIGIN}/blog/`,
  '/blog/welcome-to-duskora/': `${ORIGIN}/blog/welcome-to-duskora/`,
  '/blog/getting-started-with-duskora/': `${ORIGIN}/blog/getting-started-with-duskora/`,
  '/blog/how-budgets-work-in-duskora/': `${ORIGIN}/blog/how-budgets-work-in-duskora/`,
};

test('every page declares its absolute canonical URL', async ({ request }) => {
  for (const [p, expected] of Object.entries(PAGE_CANONICALS)) {
    const res = await request.get(`${base}${p}`);
    expect(res.status(), `${p} should be served`).toBe(200);
    const html = await res.text();
    const tags = [...html.matchAll(/<link\b[^>]*\brel="canonical"[^>]*>/g)].map((m) => m[0]);
    expect(tags, `${p} should have exactly one canonical link`).toHaveLength(1);
    expect(tags[0].match(/\bhref="([^"]*)"/)?.[1], `${p} canonical href`).toBe(expected);
  }
});

test('llms.txt is served as text, summarises the site and links to each integration page', async ({ request }) => {
  const res = await request.get(`${base}/llms.txt`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/plain');
  const txt = await res.text();
  const lines = txt.split(/\r?\n/);
  expect(lines[0]).toBe('# Duskora.ai');
  expect(lines.filter((l) => l.startsWith('> '))).toHaveLength(1);
  expect(txt).toContain('Duskora.ai Ltd (UK)');

  for (const p of ['/', '/integrations/', '/integrations/github/', '/integrations/linear/', '/integrations/jira/', '/#pricing', '/beta/', '/terms/', '/privacy/', '/refunds/', '/blog/', '/blog/welcome-to-duskora/', '/blog/getting-started-with-duskora/', '/blog/how-budgets-work-in-duskora/']) {
    expect(txt, `llms.txt should link to ${p}`).toContain(`](${ORIGIN}${p})`);
  }
});

test('llms.txt prices match PRICES.usd monthly', async ({ page, request }) => {
  const txt = await (await request.get(`${base}/llms.txt`)).text();
  await page.goto(`${base}/`);
  const usd = await page.evaluate(() => (window as any).PRICES.usd);
  const plans = await page.evaluate(() => (window as any).PLANS as { id: string; name: string }[]);
  for (const p of plans) {
    if (usd[p.id]) expect(txt, `${p.name} price`).toContain(`- ${p.name}: $${usd[p.id][0]}/month`);
    else expect(txt, `${p.name} should be custom`).toContain(`- ${p.name}: custom`);
  }
});

// llms.txt may only repeat what the site already says
test('llms.txt only states facts the site already states', async ({ request }) => {
  const txt = await (await request.get(`${base}/llms.txt`)).text();
  const html = async (p: string) => (await (await request.get(`${base}${p}`)).text()).replace(/\s+/g, ' ');

  // each link note is the linked page's own meta description (the pricing note is copied from the integrations pages)
  const links = [...txt.matchAll(/^- \[[^\]]+\]\(https:\/\/duskora\.ai([^)]*)\): (.+)$/gm)];
  expect(links.length).toBeGreaterThanOrEqual(10);
  for (const [, p, note] of links) {
    const page = await html(p === '/#pricing' ? '/integrations/' : p);
    if (p === '/#pricing') expect(page, 'pricing note').toContain(note);
    else expect(page.match(/<meta name="description"\s+content="([^"]*)"/)?.[1], `note for ${p}`).toBe(note);
  }

  // each claim in the blockquote, and where the site makes it
  const quote = txt.split(/\r?\n/).find((l) => l.startsWith('> '))!;
  const sources: [string, string, string][] = [
    ['by Duskora.ai Ltd (UK)', '/terms/', 'Duskora.ai Ltd, 66 Paul Street, London'],
    ['AI coding agents', '/', 'AI coding agents that turn Linear and Jira tickets into reviewed GitHub pull requests'],
    ['plan, build, review, QA and deploy', '/', '<h3>QA</h3>'],
    ['reviewed GitHub pull requests in your repo', '/', 'Real pull requests in your repo'],
    ['human approval gate', '/terms/', 'human approval'],
    ['Every change waits at a', '/', 'Every change waits at an approval gate'],
    ['nothing ships without you', '/', 'Nothing ships without you'],
  ];
  for (const [claim, p, onSite] of sources) {
    expect(quote, 'blockquote claim').toContain(claim);
    expect(await html(p), `${p} should say "${onSite}"`).toContain(onSite);
  }
});

test('llms.txt is not listed in sitemap.xml', async ({ request }) => {
  expect(await (await request.get(`${base}/sitemap.xml`)).text()).not.toContain('llms.txt');
});
