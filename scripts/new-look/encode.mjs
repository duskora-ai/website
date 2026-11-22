// Encode what capture.mjs recorded into the files the post serves, next to blog/a-new-look-for-duskora/index.html:
//   <name>-<w>.webp / .avif at full and half width, and <name>.png as the fallback (1520 wide, or 780 for the phone shots)
//   tour.mp4 + tour-poster.jpg, the screen recording, 1280x800 H.264
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../blog/a-new-look-for-duskora');
const raw = path.join(dir, 'raw');
const FORMATS = { webp: { quality: 82 }, avif: { quality: 55 } };

for (const file of fs.readdirSync(raw).filter((f) => f.endsWith('.png')).sort()) {
  const name = file.replace(/\.png$/, '');
  const src = path.join(raw, file);
  const { width } = await sharp(src).metadata();
  const full = Math.min(1520, width);
  for (const w of [full / 2, full]) {
    for (const [format, options] of Object.entries(FORMATS)) {
      await sharp(src).resize({ width: w })[format](options).toFile(path.join(dir, `${name}-${w}.${format}`));
    }
  }
  await sharp(src).resize({ width: full }).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(path.join(dir, `${name}.png`));
  const meta = await sharp(path.join(dir, `${name}.png`)).metadata();
  console.log(`${name}: ${meta.width}x${meta.height}`);
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed`);
}
// The recording is a folder of screencast frames with their timings; the poster is the settled hero.
ffmpeg(['-f', 'concat', '-safe', '0', '-i', path.join(raw, 'tour/frames.txt'), '-vf', 'scale=1280:800:flags=lanczos', '-r', '30', '-c:v', 'libx264', '-crf', '24', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', path.join(dir, 'tour.mp4')]);
await sharp(path.join(raw, 'hero-new.png')).resize({ width: 1280 }).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(dir, 'tour-poster.jpg'));
console.log('encoded tour.mp4 and tour-poster.jpg');
