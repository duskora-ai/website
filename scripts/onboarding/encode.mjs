// Turns compose.mjs's output (blog/getting-started-with-duskora/raw/) into the files the post
// serves, next to its index.html:
//   <name>-760.webp/.avif and <name>-1520.webp/.avif  for <picture> srcset (1x and 2x of the ~712px column)
//   <name>.png                                          1520px fallback for browsers without WebP/AVIF
//   walkthrough.mp4 + walkthrough-poster.jpg            the screen recording, 1440x900 H.264
//
//   node scripts/onboarding/encode.mjs
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'blog/getting-started-with-duskora');
const raw = path.join(dir, 'raw');
const WIDTHS = [760, 1520];
const FORMATS = { webp: { quality: 82 }, avif: { quality: 55 } };
// Stills the post doesn't use.
const SKIP = new Set(['board-plan', 'poster']);

for (const file of fs.readdirSync(raw).filter((f) => f.endsWith('.png')).sort()) {
  const name = file.replace(/^\d+-/, '').replace(/\.png$/, '');
  if (SKIP.has(name)) continue;
  const src = path.join(raw, file);
  for (const width of WIDTHS) {
    for (const [format, options] of Object.entries(FORMATS)) {
      await sharp(src).resize({ width })[format](options).toFile(path.join(dir, `${name}-${width}.${format}`));
    }
  }
  await sharp(src).resize({ width: 1520 }).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(path.join(dir, `${name}.png`));
  console.log(`encoded ${name}`);
}

const run = (args) => {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed`);
};
run(['-i', path.join(raw, 'walkthrough.mp4'), '-vf', 'scale=1440:900:flags=lanczos', '-c:v', 'libx264', '-crf', '23',
  '-preset', 'slow', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', path.join(dir, 'walkthrough.mp4')]);
await sharp(path.join(raw, 'poster.png')).resize({ width: 1440 }).jpeg({ quality: 82, mozjpeg: true })
  .toFile(path.join(dir, 'walkthrough-poster.jpg'));
console.log('encoded walkthrough.mp4 and walkthrough-poster.jpg');
