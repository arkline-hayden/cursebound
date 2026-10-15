import { line, pix, ring, type FxSpec } from '../fxPrims';
import { lighten, outlinePass, sparkle, type PixelBuffer } from '../draw/pixel';

// Ranger effect sheets (projectiles, signature shapes). Framework-free pixel art; keys use the fx:ranger:* prefix.
// Forest green fletching, oiled wood, bright steel and a red hunter's reticle. Projectiles point east (+x).

const OUT = 0x140e0a;

/** Fill a triangle (pixel-centre test). */
function tri(b: PixelBuffer, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, col: number, a = 255): void {
  const x0 = Math.floor(Math.min(ax, bx, cx)), x1 = Math.ceil(Math.max(ax, bx, cx));
  const y0 = Math.floor(Math.min(ay, by, cy)), y1 = Math.ceil(Math.max(ay, by, cy));
  const s = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const d1 = s(px, py, ax, ay, bx, by), d2 = s(px, py, bx, by, cx, cy), d3 = s(px, py, cx, cy, ax, ay);
      const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(neg && pos)) b.blend(x, y, col, a);
    }
}

function ellipse(b: PixelBuffer, cx: number, cy: number, rx: number, ry: number, col: number, a = 255): void {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++)
      if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) b.blend(x, y, col, a);
}

// ---------------------------------------------------------------- arrow (22x8)

const ARROW_PAL: Record<string, readonly [number, number]> = {
  w: [0xfff4d8, 55], W: [0xfff4d8, 120],
  c: [0xf4e8c0, 255], f: [0xa8f07a, 255], F: [0x4e9a2e, 255], g: [0x74c046, 255], G: [0x2f5e1c, 255],
  S: [0xd09a58, 255], s: [0x6a4422, 255],
  H: [0xeef2f8, 255], h: [0x8a94a2, 255], '#': [0xffffff, 255], o: [OUT, 220],
};
const ARROW_BODY = [
  '  cfF',
  '   cffF          oH',
  '    cffF         hHHo',
  '     ccSSSSSSSSSSHHH##',
  '     ccsssssssssshhhHo',
  '    cggG         hhho',
  '   cggG          oh',
  '  cgG',
];
const ARROW_WIND = [
  ['', ' w', 'ww', 'WWW', 'WWW', 'ww', ' w', ''],
  ['', 'w', ' ww', 'WW W', 'W WW', ' ww', 'w', ''],
];

// ---------------------------------------------------------------- heavy arrow (30x10)

function heavyArrow(b: PixelBuffer, i: number): void {
  // wind wake: three streaks peeling off the fletching, shifting per frame
  for (let k = 0; k < 3; k++) {
    const y = [2, 5, 8][k]!;
    const off = (i * 3 + k * 2) % 7;
    line(b, 0 + off * 0.3, y, 6 - off * 0.5, y, 0xfff0c0, k === 1 ? 150 : 80, 0);
  }
  // shaft
  for (let x = 8; x <= 22; x++) { b.blend(x, 4, 0xe0aa64, 255); b.blend(x, 5, 0x7a4a20, 255); }
  b.blend(14, 4, 0xc8303a, 255); b.blend(14, 5, 0x8a1a20, 255); b.blend(15, 4, 0xc8303a, 255); b.blend(15, 5, 0x8a1a20, 255);
  // gold fletching with a red stripe
  tri(b, 2, 0, 11, 4.5, 5, 4.5, 0xffd060);
  tri(b, 2, 10, 11, 5.5, 5, 5.5, 0xb07a20);
  tri(b, 3, 1.2, 8, 4.4, 5.2, 4.4, 0xfff0a0);
  line(b, 6, 2.6, 6, 7.4, 0xc83a2a, 255, 0);
  b.blend(3, 4, 0xfff6d8, 255); b.blend(3, 5, 0xfff6d8, 255);
  // broadhead
  tri(b, 21, 0.5, 29.6, 5, 21, 9.5, 0x9aa4b2);
  tri(b, 21.5, 1.6, 29, 5, 21.5, 5, 0xeef2f8);
  line(b, 22, 4.5, 28, 4.5, 0xffffff, 255, 0);
  b.blend(21, 0, OUT, 200); b.blend(21, 9, OUT, 200);
  outlinePass(b, OUT, 150);
  if (i === 1) sparkle(b, 27, 4, 0xfff6d8, 1, 220);
}

// ---------------------------------------------------------------- gust (40x18, tintable)

function gust(b: PixelBuffer, i: number, n: number): void {
  const t = i / (n - 1);
  const fade = i === n - 1 ? 0.45 : 1;
  const rows: [number, number, number][] = [[9, 1, 1], [5, 0.7, 0.75], [13, 0.7, 0.75], [2, 0.45, 0.5], [16, 0.45, 0.5]];
  for (const [y, len, al] of rows) {
    const head = 8 + t * 30 * len + (1 - len) * 6;
    const tail = Math.max(0, head - (18 - i * 3) * len);
    line(b, tail, y, head, y, 0xb8b8b8, Math.round(140 * al * fade), 0);
    line(b, Math.max(tail, head - 6), y, head, y, 0xffffff, Math.round(255 * al * fade), 0);
  }
  // a little curl of air peeling off the main streak
  if (i >= 1 && i <= 2) {
    for (let k = 0; k < 7; k++) {
      const a = -Math.PI / 2 + k * 0.5;
      b.blend(Math.round(14 + i * 6 + Math.cos(a) * 3), Math.round(9 + Math.sin(a) * 3), 0xffffff, 160);
    }
  }
}

// ---------------------------------------------------------------- reticle (32x32)

function reticle(b: PixelBuffer): void {
  const cx = 16, cy = 16;
  const RED = 0xff3a2a, HOT = 0xffb0a0;
  // ring broken by the four cardinal ticks
  for (let k = 0; k < 220; k++) {
    const a = (k / 220) * Math.PI * 2;
    const m = Math.abs(((a + Math.PI / 4) % (Math.PI / 2)) - Math.PI / 4);
    if (m < 0.22) continue;
    for (const [r, c, al] of [[10.6, HOT, 255], [11.6, RED, 255], [12.5, 0x8a1010, 200]] as const)
      b.blend(Math.round(cx - 0.5 + Math.cos(a) * r), Math.round(cy - 0.5 + Math.sin(a) * r), c, al);
  }
  // cardinal ticks reaching in, white cores
  for (let q = 0; q < 4; q++) {
    const ux = Math.round(Math.cos((q * Math.PI) / 2)), uy = Math.round(Math.sin((q * Math.PI) / 2));
    for (let r = 6; r <= 15; r++) {
      const x = cx + (ux > 0 ? r - 1 : ux < 0 ? -r : 0), y = cy + (uy > 0 ? r - 1 : uy < 0 ? -r : 0);
      const px = uy !== 0 ? 1 : 0, py = ux !== 0 ? 1 : 0;
      b.blend(x - px, y - py, RED, 255);
      b.blend(x, y, r < 13 ? 0xffffff : HOT, 255);
    }
  }
  // diagonal chevrons
  for (let q = 0; q < 4; q++) {
    const sx = q % 2 ? 1 : -1, sy = q < 2 ? -1 : 1;
    const bx = cx + sx * 9 + (sx > 0 ? -1 : 0), by = cy + sy * 9 + (sy > 0 ? -1 : 0);
    b.blend(bx, by, RED, 255); b.blend(bx - sx, by, RED, 220); b.blend(bx, by - sy, RED, 220);
  }
  // centre pip
  for (const [x, y] of [[15, 15], [16, 15], [15, 16], [16, 16]] as const) b.blend(x, y, 0xffffff, 255);
  for (const [x, y] of [[15, 14], [16, 14], [14, 15], [14, 16], [17, 15], [17, 16], [15, 17], [16, 17]] as const) b.blend(x, y, RED, 255);
}

// ---------------------------------------------------------------- hawk (26x24, top-down, facing east)

function hawk(b: PixelBuffer, i: number): void {
  const cx = 13, cy = 12;
  const dive = i === 4;
  const span = dive ? 3.5 : [6.5, 9, 10.5, 9][i]!;
  const sweep = dive ? 6 : [2, 0.5, 0, 0.5][i]!;
  for (const side of [-1, 1]) {
    // broad wing: leading edge, a wide chord and splayed primary "fingers" at the tip
    const lx = 14 - sweep * 0.6, ty = cy + side * span;
    const pts = [15.5, cy, 15.2, cy + side * span * 0.5, lx, ty, 11.6 - sweep, ty - side * 0.4, 9.4 - sweep * 0.5, cy + side * span * 0.55, 9.5, cy + side];
    for (let k = 0; k < 5; k++) tri(b, 12.5, cy, pts[k * 2]!, pts[k * 2 + 1]!, pts[k * 2 + 2]!, pts[k * 2 + 3]!, k >= 2 ? 0x7a5430 : 0x9a6c3e);
    tri(b, 15.5, cy, 12.5, cy + side * 0.8, 14.8, cy + side * span * 0.6, 0xd8b880);
    line(b, 15.5, cy + side * 0.6, lx, ty, 0x4a3018, 255, 0);
    if (!dive) {
      for (let k = 0; k < 4; k++) {
        const fx = lx - k * 1.4, fy = ty - side * k * 0.25;
        line(b, fx, fy, fx - 0.6 - k * 0.3, fy + side * (1.6 - k * 0.2), 0x24160a, 255, 0);
      }
      // barred secondaries
      for (let k = 1; k < 3; k++) line(b, 11, cy + side * (span * k / 3), 13.5 - sweep * 0.3, cy + side * (span * k / 3), 0x5a3a1e, 200, 0);
    }
  }
  // fanned tail with banding
  tri(b, 8.5, cy - 1, 1.5, cy - 4, 1.5, cy + 4, 0x6a4422);
  tri(b, 8.5, cy + 1, 1.5, cy - 4, 1.5, cy + 4, 0x6a4422);
  for (let y = cy - 3; y <= cy + 3; y++) { b.blend(4, y, 0x2a1a0c, 255); b.blend(1, y, 0xe8d0a0, 255); }
  // body and back stripe
  ellipse(b, dive ? 13.5 : 13, cy, dive ? 6.5 : 5.2, 2.2, 0x7a5230);
  line(b, 9, cy - 1, 17, cy - 1, 0xc8a06a, 255, 0);
  // head, eyes and a gold hooked beak
  ellipse(b, 19.5, cy, 2.4, 2.2, 0xf0e0c0);
  line(b, 18, cy - 1.5, 20, cy - 1.5, 0x6a4422, 255, 0);
  b.blend(20, cy - 2, 0x1a0e06, 255); b.blend(20, cy + 1, 0x1a0e06, 255);
  b.blend(22, cy - 1, 0xffc040, 255); b.blend(22, cy, 0xffc040, 255); b.blend(23, cy, 0xd88a20, 255);
  outlinePass(b, OUT, 160);
}

// ---------------------------------------------------------------- trap (22x12): 0 arming, 1 armed

function trap(b: PixelBuffer, i: number): void {
  const armed = i === 1;
  const cx = 10.5, cy = 6;
  const steel = armed ? 0xc0c8d4 : 0x7a808a, dark = armed ? 0x40444e : 0x2a2c32, tooth = armed ? 0xffffff : 0xa8acb4;
  ring(b, cx, cy, 8.4, 4.2, 1, steel, 255, lighten(steel, 0.35));
  for (let x = 2; x <= 19; x++) {
    const t = (x + 0.5 - cx) / 8.6;
    if (Math.abs(t) < 1) b.blend(x, Math.round(cy + 4.4 * Math.sqrt(1 - t * t)) + 1, dark, 230);
  }
  // teeth pointing inward
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.3;
    const bx = cx + Math.cos(a) * 7.6, by = cy + Math.sin(a) * 3.8;
    const tx = cx + Math.cos(a) * 4.6, ty = cy + Math.sin(a) * 2.2 - 1;
    tri(b, bx - 1.1, by, bx + 1.1, by, tx, ty, tooth);
  }
  // pressure plate and chain
  ellipse(b, cx, cy, 2.6, 1.3, armed ? 0xffd860 : 0x8a7030);
  if (armed) b.blend(10, 5, 0xffffff, 255);
  for (const x of [19, 21]) { b.blend(x, 8, dark, 255); b.blend(x + 1, 9, steel, 255); }
  outlinePass(b, OUT, 140);
}

// ---------------------------------------------------------------- snap (28x20): jaws slam shut

function snap(b: PixelBuffer, i: number, n: number): void {
  const px = 14, py = 15;
  const k = Math.min(1, i / 2);            // 0 flat open jaws -> 1 shut (a standing half-ring)
  const fade = i >= n - 1 ? 0.5 : 1;
  ellipse(b, px, py + 1, 10, 2.4, 0x2a2420, Math.round(200 * fade));
  for (let s = 0; s <= 48; s++) {
    const a = (s / 48) * Math.PI;
    const c = Math.cos(a), sn = Math.sin(a) * Math.max(0.12, k);
    b.blend(Math.round(px - 0.5 + c * 9), Math.round(py - sn * 9), 0x5a606a, Math.round(255 * fade));
    b.blend(Math.round(px - 0.5 + c * 8), Math.round(py - sn * 8), 0xdfe4ec, Math.round(255 * fade));
    if (s % 4 === 2) b.blend(Math.round(px - 0.5 + c * 6.6), Math.round(py - sn * 6.6), 0xffffff, Math.round(255 * fade));
  }
  if (i >= 2) {
    const s = i === 2 ? 2 : 3;
    sparkle(b, px, py - 9, 0xffd890, s, Math.round(255 * fade));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + i;
      const r = 3 + i * 2;
      b.blend(Math.round(px + Math.cos(a) * r), Math.round(py - 9 + Math.sin(a) * r * 0.7), 0xfff0c0, Math.round(220 * fade));
    }
  }
}

// ---------------------------------------------------------------- bait (12x10)

function bait(b: PixelBuffer): void {
  ellipse(b, 5, 5.5, 4.2, 3.4, 0x8a1a1a);
  ellipse(b, 4.5, 5, 3.2, 2.4, 0xc0383a);
  ellipse(b, 4, 4.2, 1.6, 1, 0xf07a6a);
  line(b, 8, 4, 10, 2.5, 0xf0e6d0, 255, 0);
  line(b, 8, 5, 10, 3.5, 0xd8c8a8, 255, 0);
  b.blend(10, 2, 0xffffff, 255); b.blend(11, 3, 0xffffff, 255);
  b.blend(3, 9, 0x8a1a1a, 255);
  outlinePass(b, OUT, 160);
}

export const SPECS: FxSpec[] = [
  { key: 'fx:ranger:arrow', w: 22, h: 8, frames: 2, durations: [70, 70], loop: true,
    draw: (b, i) => { pix(b, ARROW_WIND[i]!, ARROW_PAL); pix(b, ARROW_BODY, ARROW_PAL); } },
  { key: 'fx:ranger:heavy', w: 30, h: 10, frames: 3, durations: [60, 60, 60], loop: true, draw: heavyArrow },
  { key: 'fx:ranger:gust', w: 40, h: 18, frames: 4, durations: [30, 35, 45, 60], loop: false, draw: gust },
  { key: 'fx:ranger:reticle', w: 32, h: 32, frames: 1, durations: [100], loop: false, anim: false, draw: reticle },
  { key: 'fx:ranger:hawk', w: 26, h: 24, frames: 5, durations: [80, 80, 80, 80, 80], loop: false, anim: false, draw: hawk },
  { key: 'fx:ranger:trap', w: 22, h: 12, frames: 2, durations: [100, 100], loop: false, anim: false, draw: trap },
  { key: 'fx:ranger:snap', w: 28, h: 20, frames: 5, durations: [30, 30, 50, 70, 90], loop: false, draw: snap },
  { key: 'fx:ranger:bait', w: 12, h: 10, frames: 1, durations: [100], loop: false, anim: false, draw: bait },
];

