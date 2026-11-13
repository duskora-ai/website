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

type Node = Record<string, any>;

async function graph(page: import('@playwright/test').Page): Promise<Node[]> {
  await page.goto(`${base}/`);
  const blocks = await page.locator('head script[type="application/ld+json"]').allTextContents();
  expect(blocks).toHaveLength(1);
  const data = JSON.parse(blocks[0]);
  expect(data['@context']).toBe('https://schema.org');
  return data['@graph'];
}

function byType(nodes: Node[], type: string): Node {
  const found = nodes.filter((n) => n['@type'] === type);
  expect(found, type).toHaveLength(1);
  return found[0];
}

test('Organization names Duskora with a PNG logo and contact email', async ({ page }) => {
  const org = byType(await graph(page), 'Organization');
  expect(org.name).toBe('Duskora.ai');
  expect(org.url).toBe('https://duskora.ai/');
  expect(org.email).toBe('hello@duskora.ai');
  expect(org.logo).toMatch(/^https:\/\/duskora\.ai\/[\w-]+\.png$/);
  // The logo must exist in the repo and be at least 112px square (Google's minimum).
  const png = fs.readFileSync(path.join(root, new URL(org.logo).pathname));
  expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(112);
  expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(112);
});

test('Organization sameAs lists exactly our confirmed profiles, each linked rel="me" in the footer', async ({ page }) => {
  const org = byType(await graph(page), 'Organization');
  // Only confirmed Duskora.ai profiles: these tell Google we are not duskora.com.
  expect(org.sameAs).toEqual([
    'https://www.linkedin.com/company/duskora-ai/',
    'https://github.com/duskora-ai',
    'https://www.youtube.com/@duskora-ai',
  ]);
  const me = await page.locator('footer a[rel~="me"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(me).toEqual(org.sameAs);
});

test('WebSite names the site Duskora.ai to match og:site_name and the Organization', async ({ page }) => {
  const nodes = await graph(page);
  const site = byType(nodes, 'WebSite');
  const org = byType(nodes, 'Organization');
  expect(site['@id']).toBe('https://duskora.ai/#website');
  expect(site.url).toBe('https://duskora.ai/');
  expect(site.name).toBe('Duskora.ai');
  expect(site.name).toBe(org.name);
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute('content', site.name);
  expect(site.alternateName).toEqual(['Duskora AI', 'Duskora']);
  expect(site.publisher).toEqual({ '@id': org['@id'] });
  // The site has no search, so no SearchAction.
  expect(site).not.toHaveProperty('potentialAction');
});

test('SoftwareApplication offers match PRICES.usd monthly', async ({ page }) => {
  const nodes = await graph(page);
  const app = byType(nodes, 'SoftwareApplication');
  expect(app.applicationCategory).toBe('DeveloperApplication');
  expect(app.operatingSystem).toBe('Web');
  expect(app.publisher['@id']).toBe(byType(nodes, 'Organization')['@id']);

  const usd = await page.evaluate(() => (window as any).PRICES.usd);
  const plans = await page.evaluate(() => (window as any).PLANS as { id: string; name: string }[]);
  const paid = plans.filter((p) => usd[p.id]);
  expect(paid.map((p) => p.name)).toEqual(['Developer', 'Team', 'Business']);
  expect(app.offers.map((o: Node) => o.name)).toEqual(paid.map((p) => p.name));
  app.offers.forEach((o: Node, i: number) => {
    const monthly = usd[paid[i].id][0];
    expect(o['@type']).toBe('Offer');
    expect(o.price, o.name).toBe(monthly);
    expect(o.priceCurrency).toBe('USD');
    expect(o.priceSpecification.price, o.name).toBe(monthly);
    expect(o.priceSpecification.priceCurrency).toBe('USD');
    expect(o.priceSpecification.billingDuration).toBe('P1M');
  });
});

test('FAQPage repeats the pricing FAQ word for word', async ({ page }) => {
  const faq = byType(await graph(page), 'FAQPage');
  const questions = (await page.locator('.faq details summary').allTextContents()).map((s) => s.trim());
  const answers = (await page.locator('.faq details p').allTextContents()).map((s) => s.trim());
  expect(questions).toHaveLength(4);
  expect(faq.mainEntity.map((q: Node) => q.name)).toEqual(questions);
  expect(faq.mainEntity.map((q: Node) => q.acceptedAnswer.text)).toEqual(answers);
  faq.mainEntity.forEach((q: Node) => {
    expect(q['@type']).toBe('Question');
    expect(q.acceptedAnswer['@type']).toBe('Answer');
  });
});

test('pricing script reminds editors to update the JSON-LD with PRICES', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  expect(html).toMatch(/\/\/ The JSON-LD offers in <head> repeat PRICES\.usd[^\n]*\n\s*var PRICES = \{/);
});
