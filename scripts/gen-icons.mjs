// Generate PNG icons from favicon.svg for PWA install (Android Chrome)
// and Apple touch icon. Run once when the favicon changes:
//   node scripts/gen-icons.mjs
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const svg = readFileSync(resolve(root, 'public/favicon.svg'));

const targets = [
  { out: 'public/icon-192.png', size: 192 },
  { out: 'public/icon-512.png', size: 512 },
  { out: 'public/apple-touch-icon.png', size: 180 },
];

await Promise.all(
  targets.map(async ({ out, size }) => {
    await sharp(svg, { density: 384 })
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toFile(resolve(root, out));
    console.log(`wrote ${out} (${size}x${size})`);
  }),
);
