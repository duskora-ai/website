// Screenshots and a screen recording for blog/a-new-look-for-duskora/: the site before and after the redesign.
//
//   node scripts/new-look/capture.mjs            capture everything into blog/a-new-look-for-duskora/raw/ (git-ignored)
//   node scripts/new-look/capture.mjs video      record only the screen recording again
//   node scripts/new-look/encode.mjs             write the WebP/AVIF/PNG images, the MP4 and its poster next to the post
//
// "Before" is served from git history (OLD_REF, the last commit before the redesign) and "after" from OLD's successor
// NEW_REF, so the pictures stay the same however the site changes later. Both are checked out into a temporary
// directory with `git worktree` and removed afterwards. Needs `ffmpeg` only for encode.mjs.
// Set CHROMIUM_PATH to use a browser other than the one Playwright installed.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OLD_REF = '2673e0d'; // "Replace the Platform section screenshots with the new app UI": the old design
const NEW_REF = '2b6d147'; // "Redesign the site around a dusk sky, with scroll and typing animations"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const raw = path.join(root, 'blog/a-new-look-for-duskora/raw');
fs.mkdirSync(raw, { recursive: true });

const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2' };
function serve(dir) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split(/[?#]/)[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(dir, p);
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
function checkout(ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duskora-look-'));
  git('worktree', 'add', '--detach', '--force', dir, ref);
  return dir;
}

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
// The site picks its currency from the timezone and locale; pin them so prices are in USD.
const context = (viewport, extra = {}) => browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: 'light', timezoneId: 'UTC', locale: 'en-US', ...extra });
// Put the top of `selector` just under the sticky header, without the smooth scroll.
const scrollTo = (page, selector, gap = 76) =>
  page.evaluate(([s, g]) => window.scrollTo({ top: s ? window.scrollY + document.querySelector(s).getBoundingClientRect().top - g : 0, behavior: 'instant' }), [selector, gap]);
// On the new site, the hero's example run has reached the approval gate (the old site has no such card).
const settled = async (page) => {
  if (await page.locator('#run-approve').count()) await page.locator('#run-approve.ready').waitFor();
  await page.waitForTimeout(2500);
};

const only = process.argv[2]; // `video` re-records the tour without retaking the stills
const dirs = only === 'video' ? { new: checkout(NEW_REF) } : { old: checkout(OLD_REF), new: checkout(NEW_REF) };
try {
  for (const [side, dir] of Object.entries(dirs)) {
    const { server, url } = await serve(dir);

    let ctx, page;
    if (only !== 'video') {
    // The pairs for the before/after sliders: the same place on the page, old and new.
    ctx = await context(DESKTOP);
    page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await settled(page);
    await page.screenshot({ path: path.join(raw, `hero-${side}.png`) });
    for (const [name, selector] of [['platform', '#platform'], ['roadmap', '#coming-soon'], ['pipeline', '#how']]) {
      await scrollTo(page, selector);
      await page.waitForTimeout(3500); // lazy images and the scroll reveals
      await page.screenshot({ path: path.join(raw, `${name}-${side}.png`) });
    }
    await ctx.close();

    ctx = await context(PHONE);
    page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await settled(page);
    await page.screenshot({ path: path.join(raw, `phone-${side}.png`) });
    await ctx.close();

    }

    if (side === 'new' && only !== 'video') {
      // Stills of things only the new site has.
      ctx = await context(DESKTOP);
      page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'networkidle' });
      await settled(page);
      await page.locator('#run-approve').click();
      await page.getByRole('button', { name: 'Run it again' }).waitFor();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(800);
      await page.locator('.hero-demo').screenshot({ path: path.join(raw, 'run-shipped.png') });
      await scrollTo(page, '.closer', 140);
      await page.waitForTimeout(3000);
      await page.screenshot({ path: path.join(raw, 'closer.png') });
      await ctx.close();
    }

    if (side === 'new') {
      // Screen recording: the headline typing in, the example run, Approve, then scrolling so the sun sets.
      // Chrome's screencast frames are saved with their timestamps (raw/tour/frames.txt) and encode.mjs joins them.
      const frames = path.join(raw, 'tour');
      fs.rmSync(frames, { recursive: true, force: true });
      fs.mkdirSync(frames);
      ctx = await browser.newContext({ viewport: DESKTOP, colorScheme: 'light', timezoneId: 'UTC', locale: 'en-US' });
      page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      const stamps = [];
      cdp.on('Page.screencastFrame', (frame) => {
        const file = `${String(stamps.length).padStart(5, '0')}.jpg`;
        fs.writeFileSync(path.join(frames, file), Buffer.from(frame.data, 'base64'));
        stamps.push([file, frame.metadata.timestamp]);
        cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.locator('#run-approve.ready').waitFor();
      await page.waitForTimeout(1200);
      await page.mouse.move(1085, 612, { steps: 30 });
      await page.waitForTimeout(500);
      await page.locator('#run-approve').click();
      await page.getByRole('button', { name: 'Run it again' }).waitFor();
      await page.waitForTimeout(1500);
      // A slow, even scroll down to the screenshots.
      const end = await page.evaluate(() => window.scrollY + document.querySelector('.shots').getBoundingClientRect().top - 120);
      for (let i = 1; i <= 260; i++) {
        const t = i / 260;
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), end * (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)));
        await page.waitForTimeout(28);
      }
      await page.waitForTimeout(3500);
      await cdp.send('Page.stopScreencast');
      await ctx.close();
      // ffmpeg's concat format: each frame with how long it stays on screen.
      const list = stamps.map(([file, t], i) => `file '${file}'\nduration ${((stamps[i + 1]?.[1] ?? t + 0.04) - t).toFixed(4)}`);
      fs.writeFileSync(path.join(frames, 'frames.txt'), list.join('\n') + `\nfile '${stamps[stamps.length - 1][0]}'\n`);
    }
    server.close();
  }
} finally {
  await browser.close();
  for (const dir of Object.values(dirs)) git('worktree', 'remove', '--force', dir);
}
console.log('captured into', path.relative(root, raw));
