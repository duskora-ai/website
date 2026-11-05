// Rasterises scripts/og-image.svg into og-image.png, the 1200×630 Open Graph / Twitter share image.
// Run once after editing the SVG and commit both files: node scripts/og-image.mjs
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'og-image.png');

await sharp(path.join(root, 'scripts', 'og-image.svg'))
  .resize(1200, 630)
  .png({ compressionLevel: 9, palette: true, quality: 90 })
  .toFile(out);
console.log(`wrote ${path.relative(root, out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
