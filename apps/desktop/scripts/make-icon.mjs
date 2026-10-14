#!/usr/bin/env node
// Procedural app icon (the repo ships no binary art): a 32x32 pixel-art skull with ember eyes on a bronze-framed stone
// tile, scaled 32x with hard edges and written as build/icon.png (1024x1024). electron-builder derives the Windows .ico,
// the macOS .icns and the Linux icon set from it.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png');
const N = 32;
const SCALE = 32;

const PAL = {
  k: [5, 4, 4], s: [28, 22, 20], S: [40, 32, 28], b: [164, 111, 36], B: [210, 157, 62],
  w: [232, 220, 196], W: [255, 241, 194], g: [154, 141, 120], e: [236, 148, 30], E: [255, 201, 74], r: [138, 26, 26],
};

// left half of the skull (columns 0-15), mirrored onto 16-31; spaces leave the tile underneath
const SKULL = {
  5: '            kkkk',
  6: '          kkwwww',
  7: '         kwwwwww',
  8: '        kwwWWwww',
  9: '       kwwWWwwww',
  10: '       kwWwwwwww',
  11: '      kwwwwwwwww',
  12: '      kwwwwwwwww',
  13: '      kwwkkkkkww',
  14: '      kwkkkEekkw',
  15: '      kwkkEEEekw',
  16: '      kwkkkeekkw',
  17: '      kgwkkkkkww',
  18: '      kgwwwwwwwk',
  19: '       kgwwwwwkk',
  20: '        kgwwwwww',
  21: '        kkgwwwww',
  22: '         kwkwkwk',
  23: '         kwkwkwk',
  24: '         kkgwwww',
  25: '          kkkkkk',
};

const grid = Array.from({ length: N }, () => Array(N).fill(null));
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const ring = Math.min(x, y, N - 1 - x, N - 1 - y);
    const corner = Math.min(x, N - 1 - x) + Math.min(y, N - 1 - y);
    if (corner < 2) continue;                       // rounded corners stay transparent
    if (ring === 0 || corner === 2) grid[y][x] = 'k';
    else if (ring === 1) grid[y][x] = x < N - 2 && y < N - 2 && (x === 1 || y === 1) ? 'B' : 'b';
    else if (ring === 2) grid[y][x] = 'b';
    else if (ring === 3) grid[y][x] = 'k';
    else grid[y][x] = (x + y) % 2 === 0 && (x * 7 + y * 3) % 5 === 0 ? 'S' : 's';   // dithered stone
  }
}
for (const [row, half] of Object.entries(SKULL)) {
  const y = Number(row);
  for (let x = 0; x < 16; x++) {
    const c = half[x];
    if (!c || c === ' ') continue;
    grid[y][x] = c;
    grid[y][N - 1 - x] = c;
  }
}
// a forehead crack and rising embers break the symmetry
for (const [x, y, c] of [[17, 7, 'k'], [18, 8, 'k'], [17, 9, 'k'], [18, 10, 'g'], [6, 8, 'e'], [5, 6, 'E'], [25, 11, 'e'], [26, 9, 'E'], [24, 6, 'e'], [7, 27, 'r'], [24, 27, 'r']]) grid[y][x] = c;

const W = N * SCALE;
const raw = Buffer.alloc((W * 4 + 1) * W);
for (let py = 0; py < W; py++) {
  const rowStart = py * (W * 4 + 1);
  raw[rowStart] = 0;                                  // filter: none
  for (let px = 0; px < W; px++) {
    const c = grid[Math.floor(py / SCALE)][Math.floor(px / SCALE)];
    const o = rowStart + 1 + px * 4;
    if (!c) continue;                                 // transparent (buffer is zeroed)
    const [r, g, b] = PAL[c];
    raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(W, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`[desktop] icon written to ${out} (${W}x${W}, ${Math.round(png.length / 1024)} KB)`);
