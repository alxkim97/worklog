// One-off utility: renders an emoji into a multi-resolution Windows .ico
// using Electron's Chromium renderer (so real color-emoji fonts are used).
// Usage: node_modules\.bin\electron scripts\generate-icon.js

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const EMOJI = '🌱';
const OUT_PATH = path.join(__dirname, '..', 'assets', 'icon.ico');
const CANVAS_SIZE = 256;
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];

function buildIco(pngBuffersBySize) {
  const sizes = Object.keys(pngBuffersBySize).map(Number).sort((a, b) => a - b);
  const count = sizes.length;
  const headerSize = 6 + 16 * count;
  let offset = headerSize;

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  const imageBuffers = [];

  for (const size of sizes) {
    const png = pngBuffersBySize[size];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height (0 = 256)
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bit count
    entry.writeUInt32LE(png.length, 8); // bytes in resource
    entry.writeUInt32LE(offset, 12); // offset
    offset += png.length;
    dirEntries.push(entry);
    imageBuffers.push(png);
  }

  return Buffer.concat([header, ...dirEntries, ...imageBuffers]);
}

async function main() {
  await app.whenReady();

  const win = new BrowserWindow({
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    show: false,
    transparent: true,
    webPreferences: { offscreen: false },
  });

  const html = `
    <html>
      <body style="margin:0;width:${CANVAS_SIZE}px;height:${CANVAS_SIZE}px;
        display:flex;align-items:center;justify-content:center;background:transparent;">
        <div style="font-size:${CANVAS_SIZE * 0.8}px;line-height:1;">${EMOJI}</div>
      </body>
    </html>`;

  await win.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 200));

  const image = await win.webContents.capturePage();

  const pngBuffersBySize = {};
  for (const size of ICON_SIZES) {
    const resized = image.resize({ width: size, height: size, quality: 'best' });
    pngBuffersBySize[size] = resized.toPNG();
  }

  const ico = buildIco(pngBuffersBySize);
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, ico);
  console.log('Wrote', OUT_PATH, ico.length, 'bytes, sizes:', ICON_SIZES.join(','));

  app.quit();
}

main().catch((err) => {
  console.error(err);
  app.exit(1);
});
