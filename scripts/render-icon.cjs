'use strict';
const { _electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Include 125%/150%/200% Windows display sizes, avoiding shell resampling.
const iconSizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

(async () => {
  const root = path.resolve(__dirname, '..');
  const assets = path.join(root, 'source/ui/assets');
  const env = { ...process.env, MUSIC_TOOLS_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'music-icon-')) };
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.MUSIC_TOOLS_ELECTRON || require('electron');
  const app = await _electron.launch({ executablePath, args: [root], env });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.brand-mark');
    const svg = fs.readFileSync(path.join(assets, 'icon.svg'), 'utf8');
    async function render(size) {
      // Rasterize each size from the vector at 4x resolution for smooth edges.
      const data = await page.evaluate(async ({ svg, size }) => {
        const image = new Image();
        image.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size * 4;
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png').split(',')[1];
      }, { svg, size });
      const png = await app.evaluate(({ nativeImage }, { data, size }) =>
        nativeImage.createFromBuffer(Buffer.from(data, 'base64'))
          .resize({ width: size, height: size, quality: 'best' }).toPNG().toString('base64'), { data, size });
      return Buffer.from(png, 'base64');
    }
    fs.writeFileSync(path.join(assets, 'icon.png'), await render(512));
    // ICO directory with PNG payload per size; accepted by Windows Vista+ and rcedit.
    const images = [];
    for (const size of iconSizes) images.push({ size, buffer: await render(size) });
    const header = Buffer.alloc(6 + 16 * images.length);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(images.length, 4);
    let offset = header.length;
    images.forEach(({ size, buffer }, index) => {
      const start = 6 + 16 * index;
      header[start] = header[start + 1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, start + 4);
      header.writeUInt16LE(32, start + 6);
      header.writeUInt32LE(buffer.length, start + 8);
      header.writeUInt32LE(offset, start + 12);
      offset += buffer.length;
    });
    fs.writeFileSync(path.join(assets, 'icon.ico'), Buffer.concat([header, ...images.map(x => x.buffer)]));
    console.log('Rendered SVG to PNG 512 and ICO ' + iconSizes.join('/') + '.');
  } finally {
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
