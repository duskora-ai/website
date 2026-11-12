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

// Every same-origin a[href] and link[href] on the public pages must resolve. mailto:, external
// URLs and bare #fragments are skipped; /#how is checked as /.
test('no internal link on any page returns 404', async ({ page }) => {
  const checked = new Set<string>();
  for (const start of ['/', '/beta/', '/terms/', '/privacy/', '/refunds/', '/integrations/', '/integrations/github/', '/integrations/linear/', '/integrations/jira/', '/blog/', '/blog/welcome-to-duskora/', '/blog/getting-started-with-duskora/', '/blog/how-budgets-work-in-duskora/', '/404.html']) {
    await page.goto(`${base}${start}`);
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('a[href], link[href]')]
        .map((el) => el.getAttribute('href')!)
        .filter((h) => !h.startsWith('#'))
        .map((h) => {
          const u = new URL(h, location.href);
          return { href: h, url: u.origin === location.origin ? u.origin + u.pathname + u.search : '' };
        })
        .filter((l) => l.url),
    );
    expect(hrefs.length, `${start} has no internal links`).toBeGreaterThan(0);
    for (const { href, url } of hrefs) {
      if (checked.has(url)) continue;
      checked.add(url);
      const res = await page.request.get(url);
      expect(res.status(), `broken link on ${start}: ${href}`).not.toBe(404);
    }
  }
});
