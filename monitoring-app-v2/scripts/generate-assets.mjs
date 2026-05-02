/**
 * - Logo: `leet.png` at project root → `public/leet.png`
 * - Tab icon: place `favicon.png` at project root (e.g. same file as
 *   `/mnt/c/Users/.../monitoring-app-v2/favicon.png` under WSL). It is copied to `public/`
 *   and used to build 16/32/180/192/512. If missing, favicons are generated from `leet.png`.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pub = path.join(root, 'public');
const masterLeet = path.join(root, 'leet.png');
const masterFavicon = path.join(root, 'favicon.png');

const iconBg = { r: 12, g: 15, b: 20, alpha: 1 };

async function main() {
  if (!fs.existsSync(masterLeet)) {
    console.error('Missing', masterLeet, '— place leet.png at the project root.');
    process.exit(1);
  }
  const leetInput = fs.readFileSync(masterLeet);

  const outLogo = path.join(pub, 'leet.png');
  await sharp(leetInput)
    .resize(512, 512, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png()
    .toFile(outLogo);
  console.log('wrote', path.relative(root, outLogo));

  let faviconInput;
  if (fs.existsSync(masterFavicon)) {
    fs.copyFileSync(masterFavicon, path.join(pub, 'favicon.png'));
    console.log('wrote', path.relative(root, path.join(pub, 'favicon.png')), '(from root favicon.png)');
    faviconInput = fs.readFileSync(masterFavicon);
  } else {
    faviconInput = await sharp(leetInput)
      .resize(32, 32, {
        fit: 'contain',
        position: 'centre',
        background: iconBg,
      })
      .png()
      .toBuffer();
    fs.writeFileSync(path.join(pub, 'favicon.png'), faviconInput);
    console.log('wrote', path.relative(root, path.join(pub, 'favicon.png')), '(from leet.png)');
  }

  const sizes = [
    ['favicon-32.png', 32],
    ['favicon-16.png', 16],
    ['apple-touch-icon.png', 180],
    ['favicon-192.png', 192],
    ['favicon-512.png', 512],
  ];
  for (const [name, size] of sizes) {
    const buf = await sharp(faviconInput)
      .resize(size, size, {
        fit: 'contain',
        position: 'centre',
        background: iconBg,
      })
      .png()
      .toBuffer();
    fs.writeFileSync(path.join(pub, name), buf);
    console.log('wrote', path.relative(root, path.join(pub, name)));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
