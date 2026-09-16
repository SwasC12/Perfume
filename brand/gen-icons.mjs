// Regenerate favicons + app icons from brand/icon-source.png.
// One-off tool — the generated files in public/ are committed, so this isn't
// needed for normal builds. To run it:
//   npm i -D sharp png-to-ico
//   node brand/gen-icons.mjs
//   npm remove sharp png-to-ico   (keep the app's deps lean)
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import fs from 'fs';

const SRC = 'brand/icon-source.png';
const OUT = 'public';

async function make(size, pad, file, bg = '#ffffff') {
  const inner = Math.round(size * (1 - 2 * pad));
  const bottle = await sharp(SRC)
    .trim()
    .resize({ width: inner, height: inner, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: bottle, gravity: 'center' }])
    .png()
    .toFile(`${OUT}/${file}`);
  console.log('wrote', file, `${size}px pad ${pad}`);
}

await make(512, 0.14, 'icon-512.png');
await make(192, 0.14, 'icon-192.png');
await make(180, 0.12, 'apple-touch-icon.png');
await make(48, 0.08, 'favicon-48.png');
await make(32, 0.08, 'favicon-32.png');
await make(16, 0.06, 'favicon-16.png');

const ico = await pngToIco([`${OUT}/favicon-16.png`, `${OUT}/favicon-32.png`, `${OUT}/favicon-48.png`]);
fs.writeFileSync(`${OUT}/favicon.ico`, ico);
console.log('wrote favicon.ico');
