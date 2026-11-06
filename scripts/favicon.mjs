// Rasterises favicon.svg into favicon.ico (16, 32 and 48px) and favicon-48x48.png, the raster
// fallbacks that search engines and older browsers use. The SVG's corners are transparent, so the
// rasters are flattened onto the tile colour to look solid on light and dark backgrounds.
// Run once after editing the SVG and commit all three files: node scripts/favicon.mjs
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = path.join(root, 'favicon.svg');
const ICO_SIZES = [16, 32, 48];

// render well above the 64px viewBox, then downsample, so the small sizes stay crisp
const render = (size) =>
  sharp(svg, { density: 384 })
    .resize(size, size)
    .flatten({ background: '#0b0f24' })
    .png({ compressionLevel: 9 })
    .toBuffer();

const write = (name, buf) => {
  const out = path.join(root, name);
  fs.writeFileSync(out, buf);
  console.log(`wrote ${name} (${(buf.length / 1024).toFixed(1)} KB)`);
};

const pngs = await Promise.all(ICO_SIZES.map(render));

// ICO container: a 6-byte ICONDIR, a 16-byte ICONDIRENTRY per image, then the PNG payloads
const header = Buffer.alloc(6 + 16 * pngs.length);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(pngs.length, 4);
let offset = header.length;
pngs.forEach((png, i) => {
  const entry = 6 + 16 * i;
  header.writeUInt8(ICO_SIZES[i], entry); // width
  header.writeUInt8(ICO_SIZES[i], entry + 1); // height
  header.writeUInt8(0, entry + 2); // palette size
  header.writeUInt8(0, entry + 3); // reserved
  header.writeUInt16LE(1, entry + 4); // colour planes
  header.writeUInt16LE(32, entry + 6); // bits per pixel
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
write('favicon.ico', Buffer.concat([header, ...pngs]));
write('favicon-48x48.png', pngs[ICO_SIZES.indexOf(48)]);
