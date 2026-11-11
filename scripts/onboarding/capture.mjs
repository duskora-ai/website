// Records the "Getting started with Duskora" walkthrough for the blog: one continuous run through
// the real app (sign up, create the organization, add an Anthropic key, connect GitHub, pick a
// repository, write a ticket and approve it), saving a still at each step and a video of it all.
//
// Needs, all on this machine (see README.md in this folder):
//   - the Duskora web app in dev auth mode on APP_URL (default http://localhost:5173)
//   - the web app in Cognito mode on SIGNUP_URL (default http://localhost:5175), only for the
//     sign-up screen, so it shows the real "Create your account" page rather than the dev form
//   - demo-api.mts on port 4000, against a freshly migrated, empty database
//
//   node scripts/onboarding/capture.mjs
//
// Writes the screencast to blog/getting-started-with-duskora/raw/ (git-ignored): frames/*.jpg and
// timeline.json, which lists each frame's time plus marks for compose.mjs: chapter starts, where
// the camera should look, and the moments the post's stills are taken from.
// `node scripts/onboarding/compose.mjs` then renders the finished video and stills.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = process.env.APP_URL ?? 'http://localhost:5173';
const SIGNUP = process.env.SIGNUP_URL ?? 'http://localhost:5175';
const out = path.join(root, 'blog/getting-started-with-duskora/raw');
const frames = path.join(out, 'frames');
const VIEWPORT = { width: 1280, height: 800 };
const EMAIL = 'alex@acme-labs.dev';

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(frames, { recursive: true });

const browser = await chromium.launch(
  fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: 'dark' });

// Signed in as the demo user in the dev-auth app (the sign-up screen itself is the Cognito build).
await context.addInitScript(
  ({ app, email }) => {
    if (location.origin === app) localStorage.setItem('duskora.devEmail', email);
  },
  { app: new URL(APP).origin, email: EMAIL },
);

// A visible cursor and click ripple: headless screencasts don't draw the pointer.
await context.addInitScript(() => {
  const install = () => {
    if (document.getElementById('demo-cursor')) return;
    const style = document.createElement('style');
    style.textContent = `
      #demo-cursor { position: fixed; z-index: 2147483647; left: 0; top: 0; width: 22px; height: 22px;
        pointer-events: none; transform: translate(var(--x, -50px), var(--y, -50px)); transition: transform 40ms linear;
        filter: drop-shadow(0 2px 3px rgba(0,0,0,.5)); }
      .demo-ripple { position: fixed; z-index: 2147483646; width: 34px; height: 34px; margin: -17px 0 0 -17px;
        border-radius: 50%; border: 2px solid #a78bfa; background: rgba(167,139,250,.25); pointer-events: none;
        animation: demo-ripple .5s ease-out forwards; }
      @keyframes demo-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }`;
    document.head.appendChild(style);
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    cursor.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2l15 11.5-6.6.9 3.9 7.4-2.9 1.5-3.9-7.5L4 20z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cursor);
    const saved = sessionStorage.getItem('demo-cursor');
    if (saved) cursor.style.cssText = saved;
    addEventListener('mousemove', (e) => {
      cursor.style.setProperty('--x', `${e.clientX - 3}px`);
      cursor.style.setProperty('--y', `${e.clientY - 2}px`);
      sessionStorage.setItem('demo-cursor', cursor.style.cssText);
    }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.className = 'demo-ripple';
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.body) install();
  else addEventListener('DOMContentLoaded', install);
});

const page = await context.newPage();

// Video: Chrome's screencast (lossless-ish JPEG frames with timestamps), assembled by ffmpeg.
// Sharper than Playwright's built-in recorder, which encodes VP8 at a low bitrate.
const cdp = await context.newCDPSession(page);
const shotTimes = [];
let frameNo = 0;
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  const file = path.join(frames, `${String(frameNo++).padStart(6, '0')}.jpg`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  shotTimes.push({ file, t: metadata.timestamp });
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
const startCast = () =>
  cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 2560, maxHeight: 1600, everyNthFrame: 1 });

const pause = (ms) => page.waitForTimeout(ms);
// Marks share the screencast frames' clock (seconds since the epoch).
const marks = [];
const mark = (type, data = {}) => marks.push({ t: Date.now() / 1000, type, ...data });
const chapter = (title) => mark('chapter', { title });
// Where the camera should frame from now on: a box in page pixels (or none for the whole screen).
const look = async (target, pad = 40) => {
  if (!target) return mark('camera', { box: null });
  // { main: y } frames the content area beside the sidebar exactly, so the crop falls on its border.
  if (target.main !== undefined) return mark('camera', { box: { x: 236, y: target.main, width: 1044, height: 653 }, exact: true });
  const b = typeof target.boundingBox === 'function' ? await target.boundingBox() : target;
  if (b) mark('camera', { box: { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 } });
};
const shot = async (name) => {
  await pause(500);
  mark('still', { name });
  console.log(`still ${name}`);
};
let mouse = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
const moveTo = async (locator, { steps = 22 } = {}) => {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const target = { x: box.x + Math.min(box.width / 2, 60), y: box.y + box.height / 2 };
  await page.mouse.move(target.x, target.y, { steps });
  mouse = target;
  await pause(150);
};
const click = async (locator) => {
  await moveTo(locator);
  await page.mouse.down();
  await pause(80);
  await page.mouse.up();
};
const type = async (locator, text, delay = 28) => {
  await click(locator);
  await locator.pressSequentially(text, { delay });
};

// 1. Sign up
await page.goto(`${SIGNUP}/signup`);
await page.getByRole('button', { name: 'Create your account' }).waitFor();
await page.mouse.move(mouse.x, mouse.y);
await startCast();
await pause(300);
chapter('Sign up');
await look(null);
await pause(1600);
await shot('signup');
await click(page.getByRole('button', { name: 'Create your account' }));
await pause(500);

// 2. Create the organization (the app after sign-up, signed in as the demo user)
await page.goto(`${APP}/onboarding`);
await page.getByPlaceholder('Acme Inc.').waitFor();
await page.mouse.move(mouse.x, mouse.y);
chapter('Name your organization');
await look(null);
await pause(800);
await type(page.getByPlaceholder('Acme Inc.'), 'Acme Labs', 70);
await shot('create-org');
await look(null);
await pause(600);
await click(page.getByRole('button', { name: 'Create organization' }));

// 3. Model vendor: Anthropic
const dialog = page.getByRole('dialog');
await dialog.waitFor();
chapter('Add your Anthropic key');
await pause(1200);
await look(dialog, 10);
await click(dialog.getByText('Anthropic', { exact: true }));
await pause(400);
await type(dialog.getByPlaceholder(/sk-ant/), 'sk-ant-api03-demo0000000000000000000000000000000000000000x7Qe', 10);
await click(dialog.getByRole('button', { name: 'Save key' }));
await dialog.getByText(/key ending/).waitFor();
await shot('anthropic-key');

// 4. Connect GitHub (the demo API stands in for GitHub's install screen and returns straight away)
chapter('Connect GitHub');
await click(dialog.getByRole('button', { name: 'Connect GitHub' }));
await page.waitForURL(/github=connected/);
await dialog.getByText('GitHub connected').waitFor();
await page.mouse.move(mouse.x, mouse.y);
await pause(600);
await dialog.getByRole('heading', { name: 'GitHub' }).evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
await pause(700);
await shot('github-connected');
await click(dialog.getByRole('button', { name: 'Done' }));
await dialog.waitFor({ state: 'hidden' });
chapter('Pick a repository');
await look(null);

// 5. Pick the repository for the project
await click(page.getByRole('link', { name: 'Project settings' }));
await click(page.getByRole('button', { name: 'Integrations' }).or(page.getByRole('tab', { name: 'Integrations' })).first());
const repoSelect = page.getByLabel('Repository to add');
await moveTo(repoSelect);
await repoSelect.selectOption({ label: 'acme-labs/storefront · private' });
await pause(500);
await click(page.getByRole('button', { name: 'Add', exact: true }));
await page.getByText('acme-labs/storefront').first().waitFor();
await look({ main: 110 });
await moveTo(page.getByText('acme-labs/storefront').first());
await pause(600);
await shot('repository');

// 6. Write the first ticket
chapter('Write your first ticket');
await look(null);
await click(page.getByRole('link', { name: /^Main/ }).first());
await page.getByRole('button', { name: 'New ticket' }).first().waitFor();
await pause(700);
await click(page.getByRole('button', { name: 'New ticket' }).first());
await page.getByRole('dialog').waitFor();
await look(page.getByRole('dialog'), 10);
const TITLE = 'Add a "Save for later" button to the cart';
await type(page.getByPlaceholder('Add rate limiting to the login endpoint'), TITLE, 22);
await type(
  page.getByRole('dialog').locator('textarea'),
  'Shoppers want to move items out of the cart without losing them.\n\nAcceptance criteria:\n- Each cart line has a "Save for later" button\n- Saved items show in a list under the cart and can be moved back\n- Saved items persist across sessions for signed-in users',
  6,
);
await shot('new-ticket');
await look(null);
await pause(500);
await click(page.getByRole('button', { name: 'Create ticket' }));
await page.getByRole('dialog').waitFor({ state: 'hidden' });
chapter('Agents take it across the board');
await pause(900);

// 7. Drag it into Plan and watch the agents take it across the board
const card = page.locator('main').getByText(TITLE);
await moveTo(card);
await page.mouse.down();
const drop = page.getByText('Drop tickets here').first();
const box = await drop.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
await page.mouse.up();
mouse = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
// Follow the card as it moves right across the board, saving a still in Plan and in Build.
const status = () => card.locator('xpath=ancestor::*[contains(@class, "card") or self::article][1]').innerText().catch(() => '');
const taken = new Set();
let column = '';
const deadline = Date.now() + 120_000;
for (;;) {
  if (Date.now() > deadline) throw new Error('The ticket never reached Approval');
  const text = await status();
  const now = text.match(/(\w+) agent working|Awaiting your approval/)?.[0] ?? '';
  if (now !== column) {
    column = now;
    await card.evaluate((el) => el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })).catch(() => {});
  }
  for (const [role, name] of [['Plan', 'board-plan'], ['Build', 'board-build']]) {
    if (!taken.has(name) && text.includes(`${role} agent working`)) {
      taken.add(name);
      await pause(role === 'Build' ? 2200 : 900);
      await shot(name);
    }
  }
  if (text.includes('Awaiting your approval')) break;
  await pause(250);
}
await pause(1500);
await shot('board-approval');
chapter('Review the trail, then approve');

// 8. Open the ticket: plan, agent activity, QA evidence and the approval gate
await click(card);
const planCard = page.getByRole('heading', { name: 'Plan' });
await planCard.waitFor();
await pause(1200);
const showPlan = page.locator('.card', { has: planCard }).getByRole('button', { name: 'Show' });
if (await showPlan.isVisible()) await click(showPlan);
await planCard.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'smooth' }));
await pause(900);
await look({ main: 40 });
await pause(900);
await shot('ticket-plan');
const qa = page.getByRole('button', { name: /QA agent/ });
await moveTo(qa, { steps: 30 });
await page.mouse.wheel(0, 0);
if ((await qa.getAttribute('aria-expanded')) !== 'true') await click(qa);
await pause(800);
await page.getByRole('heading', { name: 'Activity' }).evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'smooth' }));
await pause(900);
await look({ main: Math.round((await page.locator('.card', { has: page.getByRole('heading', { name: 'Activity' }) }).boundingBox()).y + 500 - 653) });
await pause(900);
await shot('qa-evidence');
const approve = page.getByRole('button', { name: 'Approve & deploy' });
await look(null);
await approve.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
await pause(900);
await look({ main: 50 });
await pause(500);
await moveTo(approve);
await shot('approval');
await click(approve);

// 9. Shipped
chapter('Approved, merged and shipped');
await pause(400);
await look(null);
await page.getByText('merged', { exact: true }).first().waitFor({ timeout: 60_000 });
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await pause(900);
await look({ main: 50 });
await pause(1200);
await shot('shipped');
await pause(1500);

await cdp.send('Page.stopScreencast');
await browser.close();

fs.writeFileSync(
  path.join(out, 'timeline.json'),
  JSON.stringify({ viewport: VIEWPORT, scale: 2, frames: shotTimes.map((f) => ({ file: path.basename(f.file), t: f.t })), marks }, null, 1),
);
console.log(`${shotTimes.length} frames, ${marks.length} marks in ${path.relative(root, out)}`);
