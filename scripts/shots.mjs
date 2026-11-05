// Captures the Duskora app screens shown in the #platform section and frames each one
// in a laptop on a dusk-coloured background, writing screenshots/<name>.png plus smaller
// WebP and AVIF copies (screenshots/<name>-600.webp, -1200.webp, -600.avif, -1200.avif).
//
//   node scripts/shots.mjs login     sign in once in a real browser window; the session is saved to .auth/
//   node scripts/shots.mjs capture   screenshot each page in shots.config.json into screenshots/raw/
//   node scripts/shots.mjs frame     frame every screenshots/raw/*.png into screenshots/<name>.png and its variants
//   node scripts/shots.mjs variants  rebuild only the WebP/AVIF variants from the framed screenshots/*.png
//   node scripts/shots.mjs           capture, then frame
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'scripts/shots.config.json'), 'utf8'));
const authFile = path.join(root, '.auth/duskora.json');
const rawDir = path.join(root, 'screenshots/raw');
const outDir = path.join(root, 'screenshots');

// The <img> slots in index.html are 1200x750; frames are rendered at 2x for retina screens.
const OUT = { width: 1200, height: 750, scale: 2 };
// The images show at ~500px wide, so index.html serves these widths via <picture>/srcset: 600w for 1x, 1200w for 2x.
// The 2400px PNG stays as the fallback for browsers without WebP/AVIF support.
const VARIANT_WIDTHS = [600, 1200];
const VARIANT_FORMATS = { webp: { quality: 80 }, avif: { quality: 50 } };

async function login() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: config.viewport, colorScheme: config.colorScheme });
  const page = await context.newPage();
  await page.goto(config.appUrl);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const appOrigin = new URL(config.appUrl).origin;
  // Sign-in bounces through a separate auth host; only save once the app itself has the session.
  for (;;) {
    await rl.question('Sign in to the demo workspace in the browser window, then press Enter here. ');
    const page = context.pages().find((p) => p.url().startsWith(appOrigin)) || context.pages().at(-1);
    if (page && page.url().startsWith(appOrigin)) {
      await page.waitForLoadState('networkidle');
      // storageState() skips sessionStorage, which some auth libraries keep tokens in.
      const sessionStorage = await page.evaluate(() => JSON.stringify(window.sessionStorage));
      const state = await context.storageState({ indexedDB: true });
      fs.mkdirSync(path.dirname(authFile), { recursive: true });
      fs.writeFileSync(authFile, JSON.stringify({ ...state, sessionStorage: { origin: appOrigin, data: sessionStorage } }));
      break;
    }
    console.log(`The browser is on ${page ? new URL(page.url()).host : 'no page'}, not ${new URL(appOrigin).host} yet. Finish signing in first.`);
  }
  rl.close();
  await browser.close();
  console.log(`Saved session to ${path.relative(root, authFile)}`);
}

async function capture() {
  if (!fs.existsSync(authFile)) throw new Error('No saved session. Run `node scripts/shots.mjs login` first.');
  const shots = config.shots.filter((s) => !s.url.includes('REPLACE'));
  const unset = config.shots.filter((s) => !shots.includes(s));
  if (!shots.length) throw new Error('Set the demo URLs in scripts/shots.config.json first.');
  if (unset.length) console.warn(`Skipping shots with no URL yet: ${unset.map((s) => s.name).join(', ')}`);

  fs.mkdirSync(rawDir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    storageState: authFile,
    viewport: config.viewport,
    deviceScaleFactor: 2,
    colorScheme: config.colorScheme,
  });
  const { sessionStorage } = JSON.parse(fs.readFileSync(authFile, 'utf8'));
  if (sessionStorage) {
    await context.addInitScript(({ origin, data }) => {
      if (location.origin !== origin) return;
      for (const [k, v] of Object.entries(JSON.parse(data))) window.sessionStorage.setItem(k, v);
    }, sessionStorage);
  }
  const page = await context.newPage();
  for (const shot of shots) {
    await page.goto(new URL(shot.url, config.appUrl).href, { waitUntil: 'networkidle' });
    if (shot.waitFor) await page.locator(shot.waitFor).first().waitFor();
    // Open or collapse sections (Playwright selectors), then bring the part that matters to the top.
    for (const sel of shot.click || []) {
      await page.locator(sel).first().click();
      await page.waitForTimeout(500);
    }
    // Swap text that shouldn't appear on the public site, such as the signed-in user's email.
    if (config.replaceText) {
      await page.evaluate((map) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n; (n = walker.nextNode()); ) {
          const t = n.textContent.trim();
          if (Object.hasOwn(map, t)) n.textContent = n.textContent.replace(t, map[t]);
        }
      }, config.replaceText);
    }
    if (shot.scrollTo) {
      await page.locator(shot.scrollTo).first().evaluate((el, offset) => {
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - offset);
      }, shot.scrollOffset ?? 96);
    }
    // Let entrance animations settle so nothing is captured half-faded.
    await page.waitForTimeout(800);
    const file = path.join(rawDir, `${shot.name}.png`);
    await page.screenshot({
      path: file,
      animations: 'disabled',
      caret: 'hide',
      mask: (shot.mask || []).map((s) => page.locator(s)),
      maskColor: '#1a1b22',
    });
    console.log(`Captured ${path.relative(root, file)}`);
  }
  await browser.close();
}

function frameHtml(src) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${OUT.width}px; height: ${OUT.height}px; overflow: hidden; }
  body {
    background:
      radial-gradient(55% 60% at 50% 38%, rgba(124, 58, 237, 0.45), transparent 70%),
      radial-gradient(40% 45% at 92% 105%, rgba(245, 158, 11, 0.28), transparent 70%),
      radial-gradient(45% 50% at 0% 0%, rgba(79, 70, 229, 0.35), transparent 70%),
      #0b0c0f;
    display: flex; align-items: center; justify-content: center;
  }
  .grid {
    position: absolute; inset: 0; opacity: 0.35;
    background-image: linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
                      linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px);
    background-size: 40px 40px;
    mask-image: radial-gradient(60% 60% at 50% 45%, #000, transparent 75%);
  }
  .laptop { position: relative; margin-top: 18px; }
  .lid {
    width: 900px; padding: 14px 14px 18px; border-radius: 22px 22px 6px 6px;
    background: linear-gradient(180deg, #2a2c33, #16171c);
    box-shadow: 0 0 0 1px rgba(255,255,255,0.08) inset, 0 40px 90px rgba(76, 29, 149, 0.55), 0 20px 40px rgba(0,0,0,0.6);
  }
  .screen {
    position: relative; aspect-ratio: 16 / 10; border-radius: 6px; overflow: hidden; background: #000;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.8);
  }
  .screen img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top left; }
  .screen::after {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(115deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 30%, transparent 45%);
  }
  .cam { position: absolute; top: 5px; left: 50%; width: 5px; height: 5px; margin-left: -2.5px; border-radius: 50%; background: #0d0e11; box-shadow: 0 0 0 1px #33353d; }
  .base {
    position: relative; width: 1040px; height: 20px; margin-left: -56px;
    border-radius: 2px 2px 16px 16px;
    background: linear-gradient(180deg, #3a3c44 0%, #24252b 45%, #121317 100%);
    box-shadow: 0 24px 40px rgba(0,0,0,0.55);
  }
  .base::before {
    content: ''; position: absolute; top: 0; left: 50%; width: 150px; height: 8px; margin-left: -75px;
    border-radius: 0 0 10px 10px; background: #17181c;
  }
  </style></head><body><div class="grid"></div>
  <div class="laptop"><div class="lid"><div class="cam"></div><div class="screen"><img src="${src}"></div></div><div class="base"></div></div>
  </body></html>`;
}

async function frame() {
  const raws = fs.existsSync(rawDir) ? fs.readdirSync(rawDir).filter((f) => f.endsWith('.png')) : [];
  if (!raws.length) throw new Error(`No PNGs in ${path.relative(root, rawDir)}. Run capture, or drop 16:10 screenshots there.`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: OUT.width, height: OUT.height }, deviceScaleFactor: OUT.scale });
  for (const f of raws) {
    const src = `data:image/png;base64,${fs.readFileSync(path.join(rawDir, f)).toString('base64')}`;
    await page.setContent(frameHtml(src));
    await page.locator('.screen img').evaluate((img) => img.decode());
    const file = path.join(outDir, f);
    await page.screenshot({ path: file });
    console.log(`Framed ${path.relative(root, file)}`);
    await writeVariants(file);
  }
  await browser.close();
}

// Writes <name>-<width>.<format> next to a framed <name>.png.
async function writeVariants(file) {
  const base = file.replace(/\.png$/, '');
  for (const width of VARIANT_WIDTHS) {
    for (const [format, options] of Object.entries(VARIANT_FORMATS)) {
      const out = `${base}-${width}.${format}`;
      await sharp(file).resize({ width, withoutEnlargement: true })[format](options).toFile(out);
      console.log(`Wrote ${path.relative(root, out)}`);
    }
  }
}

async function variants() {
  const framed = fs.readdirSync(outDir).filter((f) => f.endsWith('.png'));
  if (!framed.length) throw new Error(`No framed PNGs in ${path.relative(root, outDir)}. Run frame first.`);
  for (const f of framed) await writeVariants(path.join(outDir, f));
}

const cmd = process.argv[2] || 'all';
const commands = { login, capture, frame, variants, all: async () => { await capture(); await frame(); } };
if (!commands[cmd]) {
  console.error(`Unknown command "${cmd}". Use one of: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}
await commands[cmd]();
