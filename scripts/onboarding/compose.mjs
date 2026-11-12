// Renders the finished walkthrough from capture.mjs's screencast (raw/frames + raw/timeline.json):
// the app framed in a window on the site's dusk background, an eased camera that zooms toward each
// step, a chapter caption, sped-up waits, and title cards at the start and end. The post's stills
// are rendered from the same frames and camera, without the caption.
//
//   node scripts/onboarding/compose.mjs            video and stills
//   node scripts/onboarding/compose.mjs stills     stills only (quick to iterate on)
//   node scripts/onboarding/compose.mjs preview 12.5 30   single frames at those output seconds
//
// Writes raw/walkthrough.mp4, raw/poster.png and raw/NN-<name>.png; encode.mjs takes it from there.
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const raw = path.join(root, 'blog/getting-started-with-duskora/raw');
const timeline = JSON.parse(fs.readFileSync(path.join(raw, 'timeline.json'), 'utf8'));
const FPS = 30;
const STAGE = { width: 1600, height: 1000 };
const VIDEO_SCALE = 1.2; // 1920x1200
const STILL_SCALE = 2; // 3200x2000, encoded down to 1520 and 760 wide
const INTRO = 2.6; // seconds of title card before the app appears
const OUTRO = 3.2;

// ─── Source timing ───────────────────────────────────────────────────────────
const t0 = timeline.frames[0].t;
// A page that is still loading shows as a near-empty frame (a tiny JPEG). Leave those out: the
// previous screen holds until the next one has drawn, and the two crossfade (see navs).
const BLANK_BYTES = 30_000;
const all = timeline.frames.map((f) => ({ ...f, t: f.t - t0, blank: fs.statSync(path.join(raw, 'frames', f.file)).size < BLANK_BYTES }));
const frames = all.filter((f, i) => i === 0 || !f.blank);
const navs = []; // { t, from }: a new screen after a load, and the frame it replaces
for (let i = 1; i < all.length; i++) {
  if (!all[i].blank && all[i - 1].blank) {
    const from = [...all.slice(0, i)].reverse().find((f) => !f.blank);
    if (from) navs.push({ t: all[i].t, from: from.file });
  }
}
const marks = timeline.marks.map((m) => ({ ...m, t: m.t - t0 }));
const srcEnd = Math.max(frames.at(-1).t, ...marks.map((m) => m.t)) + 1.6;
const stillAt = (name) => marks.find((m) => m.type === 'still' && m.name === name).t;

// Playback rate over source time: the agents' run on the board plays faster, and long quiet
// stretches (nothing on screen changing, nothing marked) are squeezed.
const fast = [[stillAt('board-plan') + 1.2, stillAt('board-approval') - 1.4, 2.6]];
const events = [...new Set([...frames.map((f) => f.t), ...marks.map((m) => m.t), srcEnd])].sort((a, b) => a - b);
const rateAt = (s) => {
  for (const [a, b, r] of fast) if (s >= a && s < b) return r;
  return 1;
};
// Map source time to output time by integrating in small steps (quiet gaps over 1.4 s run at 3x).
const STEP = 1 / 240;
const map = []; // [srcTime, outTime]
{
  let out = 0;
  let e = 0;
  for (let s = 0; s <= srcEnd; s += STEP) {
    while (e < events.length - 1 && events[e + 1] <= s) e++;
    const gapStart = events[e];
    const gapEnd = events[e + 1] ?? srcEnd;
    const quiet = gapEnd - gapStart > 1.4 && s - gapStart > 0.9 && gapEnd - s > 0.5;
    map.push([s, out]);
    out += STEP / (rateAt(s) * (quiet ? 3 : 1));
  }
}
const appDuration = map.at(-1)[1];
const total = INTRO + appDuration + OUTRO;
const srcAtOut = (o) => {
  // binary search map by output time
  let lo = 0;
  let hi = map.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (map[mid][1] <= o) lo = mid;
    else hi = mid - 1;
  }
  return map[lo][0];
};
const outAtSrc = (s) => map[Math.min(map.length - 1, Math.round(s / STEP))][1];
const frameAt = (s) => {
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= s) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo].file;
};

// ─── Camera ──────────────────────────────────────────────────────────────────
const VP = timeline.viewport; // 1280x800 page pixels
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const cameraFor = (box, exact = false) => {
  if (!box) return { z: 1, cx: VP.width / 2, cy: VP.height / 2 };
  const z = Math.max(1, Math.min(1.55, Math.min(VP.width / box.width, VP.height / box.height) * (exact ? 1 : 0.94)));
  const halfW = VP.width / 2 / z;
  const halfH = VP.height / 2 / z;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  return {
    z,
    cx: clamp(box.x + box.width / 2, halfW, VP.width - halfW),
    cy: clamp(box.y + box.height / 2, halfH, VP.height - halfH),
  };
};
const cameraMarks = marks.filter((m) => m.type === 'camera');
const MOVE = 1.0; // seconds of output time per camera move
const lerp = (a, b, k) => a + (b - a) * k;
const cameraAt = (s) => {
  let cam = cameraFor(null);
  for (const m of cameraMarks) {
    if (m.t > s) break;
    const target = cameraFor(m.box, m.exact);
    const k = ease(Math.min(1, (outAtSrc(s) - outAtSrc(m.t)) / MOVE));
    // Zoom out and in along a gentle arc rather than a straight line, like a hand-held camera.
    cam = { z: lerp(cam.z, target.z, k), cx: lerp(cam.cx, target.cx, k), cy: lerp(cam.cy, target.cy, k) };
  }
  return cam;
};

// ─── Chapters ────────────────────────────────────────────────────────────────
const chapters = marks.filter((m) => m.type === 'chapter');
const chapterAt = (s) => {
  let i = -1;
  for (const [n, c] of chapters.entries()) if (c.t <= s + 1e-6) i = n;
  return i;
};

// ─── Stage ───────────────────────────────────────────────────────────────────
const fileUrl = (p) => pathToFileURL(p).href;
const stageHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Inter; src: url('${fileUrl(path.join(root, 'fonts/inter-latin-variable.woff2'))}') format('woff2'); font-weight: 100 900; }
html, body { margin: 0; width: ${STAGE.width}px; height: ${STAGE.height}px; overflow: hidden; background: #0b0c0f; font-family: Inter, sans-serif; }
#bg { position: absolute; inset: -80px; background:
  radial-gradient(48% 55% at var(--g1x, 50%) 34%, rgba(124, 58, 237, 0.42), transparent 70%),
  radial-gradient(38% 45% at 94% 108%, rgba(245, 158, 11, 0.26), transparent 70%),
  radial-gradient(42% 48% at var(--g3x, 2%) 0%, rgba(79, 70, 229, 0.34), transparent 70%), #0b0c0f; }
#grid { position: absolute; inset: 0; opacity: 0.3;
  background-image: linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px);
  background-size: 40px 40px; background-position: 0 var(--gy, 0px);
  mask-image: radial-gradient(62% 62% at 50% 45%, #000, transparent 78%); }
#win { position: absolute; left: 144px; top: 40px; width: 1312px; border-radius: 16px; overflow: hidden; background: #111216;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.09), 0 50px 120px rgba(76, 29, 149, 0.5), 0 24px 48px rgba(0,0,0,0.55);
  transform-origin: 50% 60%; }
#bar { height: 34px; display: flex; align-items: center; padding: 0 14px; gap: 8px; background: #16171c; border-bottom: 1px solid rgba(255,255,255,0.06); }
#bar i { width: 11px; height: 11px; border-radius: 50%; background: #3a3c44; }
#bar i:nth-child(1) { background: #ff5f57; } #bar i:nth-child(2) { background: #febc2e; } #bar i:nth-child(3) { background: #28c840; }
#url { position: absolute; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 6px; height: 22px; padding: 0 14px;
  border-radius: 7px; background: rgba(255,255,255,0.06); color: #a1a1aa; font-size: 12px; letter-spacing: 0.01em; }
#view { position: relative; width: 1312px; height: 820px; overflow: hidden; background: #0b0c0f; }
#view img { position: absolute; left: 0; top: 0; width: 1312px; height: 820px; transform-origin: 0 0; }
.cap { position: absolute; left: 50%; top: 912px; display: flex; align-items: center; gap: 12px; padding: 10px 20px 10px 10px; border-radius: 999px;
  background: rgba(22, 23, 28, 0.78); border: 1px solid rgba(255,255,255,0.12); backdrop-filter: blur(12px); color: #f4f4f5;
  font-size: 19px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; box-shadow: 0 10px 30px rgba(0,0,0,0.35); }
.cap b { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg, #8b5cf6, #6366f1); font-size: 14px; color: #fff; }
.cap small { color: #a1a1aa; font-weight: 500; font-size: 15px; }
#dots { position: absolute; left: 50%; top: 972px; transform: translateX(-50%); display: flex; gap: 6px; }
#dots span { width: 6px; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.22); transition: none; }
#dots span.on { width: 22px; background: #a78bfa; }
#title, #end { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; text-align: center; color: #fff; }
#title img, #end img { width: 92px; margin-bottom: 26px; filter: drop-shadow(0 10px 30px rgba(124,58,237,0.6)); }
#title h1, #end h1 { margin: 0; font-size: 64px; font-weight: 700; letter-spacing: -0.035em; }
#title p, #end p { margin: 16px 0 0; font-size: 24px; color: #c4c4cc; }
#title .flow { display: flex; gap: 10px; margin-top: 34px; font-size: 17px; font-weight: 600; }
#title .flow span { padding: 8px 16px; border-radius: 999px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.16); }
#end .btn { margin-top: 30px; padding: 14px 26px; border-radius: 12px; background: #7c6cf2; font-size: 20px; font-weight: 600; }
</style></head><body>
<div id="bg"></div><div id="grid"></div>
<div id="win"><div id="bar"><i></i><i></i><i></i><div id="url"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>factory.duskora.ai</div></div>
<div id="view"><img id="a"><img id="b"></div></div>
<div class="cap" id="c0"><b></b><span></span></div><div class="cap" id="c1"><b></b><span></span></div>
<div id="dots">${chapters.map(() => '<span></span>').join('')}</div>
<div id="title"><img src="${fileUrl(path.join(root, 'logo.svg'))}"><h1>Getting started with Duskora</h1><p>Every screen, from sign-up to a shipped ticket</p>
  <div class="flow"><span>Sign up</span><span>Anthropic key</span><span>GitHub</span><span>First ticket</span><span>Shipped</span></div></div>
<div id="end"><img src="${fileUrl(path.join(root, 'logo.svg'))}"><h1>Ship your first ticket</h1><p>Agents do the work. You keep the judgement calls.</p><div class="btn">duskora.ai</div></div>
<script>
const $ = (id) => document.getElementById(id);
const decoded = new Map();
async function setImg(el, src, opacity) {
  if (el.dataset.src !== src) { el.dataset.src = src; el.src = src; await el.decode().catch(() => {}); }
  el.style.opacity = opacity;
}
window.render = async (s) => {
  document.body.style.setProperty('--g1x', s.g1x + '%');
  document.body.style.setProperty('--g3x', s.g3x + '%');
  document.body.style.setProperty('--gy', s.gy + 'px');
  const win = $('win');
  win.style.opacity = s.win.o; win.style.transform = 'translateY(' + s.win.y + 'px) scale(' + s.win.s + ')';
  win.style.filter = s.win.blur ? 'blur(' + s.win.blur + 'px)' : 'none';
  const k = 1312 / ${VP.width};
  const tf = (c) => 'translate(' + -(c.cx * k * c.z - 656) + 'px,' + -(c.cy * k * c.z - 410) + 'px) scale(' + c.z + ')';
  $('a').style.transform = tf(s.cam); $('b').style.transform = tf(s.cam);
  await setImg($('a'), s.src, 1);
  if (s.fade) await setImg($('b'), s.fade.src, s.fade.o);
  else $('b').style.opacity = 0;
  for (const [i, c] of s.caps.entries()) {
    const el = $('c' + i);
    el.style.opacity = c ? c.o : 0;
    if (c) {
      el.querySelector('b').textContent = c.n;
      el.querySelector('span').innerHTML = c.title;
      el.style.transform = 'translate(-50%, ' + c.y + 'px)';
    }
  }
  $('dots').style.opacity = s.dotsO;
  [...$('dots').children].forEach((d, i) => d.classList.toggle('on', i === s.chapter));
  $('title').style.opacity = s.title.o; $('title').style.transform = 'translateY(' + s.title.y + 'px)';
  $('end').style.opacity = s.end.o; $('end').style.transform = 'translateY(' + s.end.y + 'px)';
};
</script></body></html>`;

// ─── State at an output time ─────────────────────────────────────────────────
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const stateAt = (o, { captions = true } = {}) => {
  const a = o - INTRO; // app time (output seconds)
  const s = srcAtOut(Math.max(0, Math.min(appDuration, a)));
  const inK = ease(clamp01((o - (INTRO - 0.9)) / 1.1));
  const outK = ease(clamp01((o - (INTRO + appDuration)) / 1.0));
  const titleO = 1 - ease(clamp01((o - (INTRO - 1.0)) / 0.7));
  const titleIn = ease(clamp01(o / 0.8));
  const endK = ease(clamp01((o - (INTRO + appDuration + 0.5)) / 0.9));
  const ch = chapterAt(s);
  const caps = [null, null];
  if (captions && a >= 0 && a <= appDuration && ch >= 0) {
    const since = a - outAtSrc(chapters[ch].t);
    const k = ease(clamp01(since / 0.5));
    caps[ch % 2] = { n: ch + 1, title: chapters[ch].title, o: k * (1 - outK), y: (1 - k) * 18 };
    if (ch > 0 && since < 0.35) {
      const p = 1 - clamp01(since / 0.3);
      caps[(ch - 1) % 2] = { n: ch, title: chapters[ch - 1].title, o: p, y: -(1 - p) * 14 };
    }
  }
  return {
    g1x: 50 + Math.sin(o / 6) * 8,
    g3x: 2 + Math.cos(o / 7) * 6,
    gy: (o * 6) % 40,
    src: fileUrl(path.join(raw, 'frames', frameAt(s))),
    fade: (() => {
      const nav = [...navs].reverse().find((n) => n.t <= s);
      const k = nav ? (a - outAtSrc(nav.t)) / 0.45 : 1;
      return nav && k < 1 ? { src: fileUrl(path.join(raw, 'frames', nav.from)), o: 1 - ease(clamp01(k)) } : null;
    })(),
    cam: cameraAt(s),
    win: { o: inK * (1 - outK), y: (1 - inK) * 60 + outK * -30, s: 0.94 + 0.06 * inK - 0.06 * outK, blur: (1 - inK) * 8 + outK * 10 },
    caps,
    chapter: ch,
    dotsO: captions ? inK * (1 - outK) : 0,
    title: { o: titleO * titleIn, y: (1 - titleIn) * 20 - (1 - titleO) * 30 },
    end: { o: endK, y: (1 - endK) * 24 },
  };
};

// ─── Render ──────────────────────────────────────────────────────────────────
const browser = await chromium.launch(
  fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {},
);
const mode = process.argv[2] ?? 'all';
const newStage = async (scale) => {
  const page = await browser.newPage({ viewport: STAGE, deviceScaleFactor: scale });
  const html = path.join(raw, 'stage.html');
  fs.writeFileSync(html, stageHtml);
  await page.goto(fileUrl(html));
  await page.evaluate(() => document.fonts.ready);
  return page;
};

if (mode === 'preview') {
  const page = await newStage(1);
  for (const o of process.argv.slice(3).map(Number)) {
    await page.evaluate((st) => window.render(st), stateAt(o));
    const file = path.join(raw, `preview-${o}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
}

if (mode === 'all' || mode === 'stills') {
  const page = await newStage(STILL_SCALE);
  const stills = marks.filter((m) => m.type === 'still');
  for (const [i, m] of stills.entries()) {
    await page.evaluate((st) => window.render(st), stateAt(INTRO + outAtSrc(m.t), { captions: false }));
    const file = path.join(raw, `${String(i + 1).padStart(2, '0')}-${m.name}.png`);
    await page.screenshot({ path: file });
    console.log(`still ${path.basename(file)}`);
  }
  await page.evaluate((st) => window.render(st), stateAt(1.4));
  await page.screenshot({ path: path.join(raw, 'poster.png') });
  await page.close();
}

if (mode === 'all') {
  const page = await newStage(VIDEO_SCALE);
  const dir = path.join(raw, 'out');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir);
  const n = Math.ceil(total * FPS);
  for (let i = 0; i < n; i++) {
    await page.evaluate((st) => window.render(st), stateAt(i / FPS));
    await page.screenshot({ path: path.join(dir, `${String(i).padStart(6, '0')}.jpg`), type: 'jpeg', quality: 93 });
    if (i % 300 === 0) console.log(`frame ${i}/${n}`);
  }
  const video = path.join(raw, 'walkthrough.mp4');
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%06d.jpg'),
    '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg failed');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`video ${path.relative(root, video)} (${total.toFixed(1)} s)`);
}
await browser.close();
