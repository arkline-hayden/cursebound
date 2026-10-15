import { crescent, fill, line, type FxSpec } from '../fxPrims';
import { lighten, outlinePass, rng, sparkle, type PixelBuffer } from '../draw/pixel';

// Berserker effect sheets (projectiles, signature shapes). Framework-free pixel art; keys use the fx:berserker:* prefix.
// Palette: blood crimson, rage orange, hot iron and dread purple. Hard bands only.

const OUT = 0x1a080a;
const GORE = 0x5a0810;
const BLOOD = 0xb81a24;
const RED = 0xe8302c;
const RAGE = 0xff5a2a;
const EMBER = 0xffa040;
const HOT = 0xffe6a8;
const IRON_D = 0x3a3a48;
const IRON = 0x6c6e80;
const STEEL = 0xa9b4cc;
const EDGE = 0xeef4ff;
const WOOD_D = 0x4a2c1c;
const WOOD = 0x7e4e2c;
const GRIP = 0x3a2230;
const DREAD = 0x8a3aa0;
const DREAD_L = 0xd08af0;

/** Thrown axe (spun at runtime): a bearded iron head with a bright cutting edge on a wrapped haft, blood on the bit. */
function drawAxe(b: PixelBuffer) {
  // haft: diagonal from bottom-left to the head
  line(b, 3, 16, 10, 6, WOOD_D, 255, 1);
  line(b, 3, 15, 10, 5, WOOD, 255, 0);
  for (const [x, y] of [[4, 14], [5, 13], [4, 15]] as const) b.blend(x, y, GRIP, 255);
  b.blend(2, 17, IRON, 255); b.blend(3, 17, IRON, 255);
  // head: a crescent bit centred up-right of the haft top
  fill(b, (x, y) => {
    const dx = x + 0.5 - 8.5, dy = y + 0.5 - 6.5;
    // rotate into the head frame (the haft runs along (-0.6, 0.8))
    const u = dx * 0.8 + dy * 0.6;      // along the blade (away from the haft)
    const v = -dx * 0.6 + dy * 0.8;     // along the haft
    if (u < 0.6 || u > 8.6) return null;
    const half = 1.6 + (u - 0.6) * 0.62;
    if (Math.abs(v) > half) return null;
    const edgeD = 8.6 - u - (Math.abs(v) / half) ** 2 * 1.4;
    if (edgeD < 0) return null;
    if (edgeD < 1.1) return [EDGE, 255];
    if (edgeD < 2.2) return [STEEL, 255];
    if (u < 2) return [IRON_D, 255];
    return [v < -0.5 ? STEEL : IRON, 255];
  });
  // back spike
  line(b, 7, 6, 5, 4, IRON, 255, 0);
  b.blend(5, 3, IRON_D, 255);
  // blood on the bit
  for (const [x, y] of [[14, 9], [13, 10], [14, 10], [12, 11], [15, 7]] as const) b.blend(x, y, BLOOD, 255);
  b.blend(13, 11, RED, 255);
  outlinePass(b, OUT, 255);
  sparkle(b, 15, 4, 0xffffff, 1, 255);
}

/** Rage aura (loops behind an enlarged hero): banded blood flames licking upward, hollow-ish so the hero reads. */
function drawRage(b: PixelBuffer, i: number, n: number) {
  const ph = (i / n) * Math.PI * 2;
  fill(b, (x, y) => {
    const u = (x + 0.5 - b.w / 2) / (b.w / 2);
    const v = (b.h - 1 - y) / (b.h - 1);
    const wv = 0.95 - v * 0.55;
    const edge = 1 - Math.abs(u) / wv;
    if (edge <= 0) return null;
    const tongue = 0.32 * Math.sin(v * 13 - ph * 2 + u * 4) * v + 0.18 * Math.sin(u * 11 + ph + v * 3);
    const I = edge * 1.1 - v * 0.95 + tongue + 0.2 * (1 - v);
    // hollow core (where the hero stands) stays dimmer
    const core = Math.abs(u) < 0.32 && v > 0.12 && v < 0.78;
    const k = core ? I - 0.45 : I;
    if (k > 0.85) return [HOT, 255];
    if (k > 0.62) return [EMBER, 255];
    if (k > 0.42) return [RAGE, 240];
    if (k > 0.22) return [RED, 210];
    if (k > 0.06) return [GORE, 150];
    return null;
  });
  // rising sparks
  const r = rng(77 + i);
  for (let k = 0; k < 4; k++) {
    const sx = Math.round(4 + r() * (b.w - 8));
    const sy = Math.round(((r() * b.h + (i / n) * b.h * -1) % b.h + b.h) % b.h);
    b.blend(sx, sy, HOT, 255);
    b.blend(sx, sy + 1, RAGE, 200);
  }
}

/** Ground cracks bursting open (foreshortened 2:1): hot fissures that cool to dark scars, a crater and flung chips. */
function drawQuake(b: PixelBuffer, i: number, n: number) {
  const cx = b.w / 2, cy = b.h / 2;
  const S = b.w / 96;
  const grow = Math.min(1, (i + 1) / 3);
  const cool = i / (n - 1);
  const fade = i >= n - 2 ? 0.55 : 1;
  // crater
  fill(b, (x, y) => {
    const d = Math.hypot((x + 0.5 - cx) / (11 * S), (y + 0.5 - cy) / (5.5 * S));
    if (d > 1) return null;
    return d > 0.7 ? [0x2a1410, Math.round(200 * fade)] : [cool < 0.4 ? EMBER : 0x3a1a10, Math.round((cool < 0.4 ? 230 : 200) * fade)];
  });
  const hotC = cool < 0.25 ? HOT : cool < 0.5 ? EMBER : cool < 0.75 ? RAGE : BLOOD;
  const r = rng(4242);
  const rays = 11;
  for (let k = 0; k < rays; k++) {
    const a0 = (k / rays) * Math.PI * 2 + r() * 0.4;
    const len = (0.55 + r() * 0.45) * grow;
    let px = cx, py = cy, a = a0;
    const segs = 5;
    for (let s = 1; s <= segs; s++) {
      a += (r() - 0.5) * 0.7;
      const rr = (s / segs) * len * (cx - 2);
      const nx = cx + Math.cos(a) * rr, ny = cy + Math.sin(a) * rr * 0.5;
      line(b, px, py, nx, ny, 0x1c0c08, Math.round(230 * fade), s < 4 ? 1 : 0);
      line(b, px, py, nx, ny, hotC, Math.round(255 * fade), s < 2 ? 1 : 0);
      // a branch off the middle segment
      if (s === 3 && r() < 0.7) {
        const ba = a + (r() < 0.5 ? 0.8 : -0.8);
        const bl = len * (cx - 2) * 0.22;
        line(b, nx, ny, nx + Math.cos(ba) * bl, ny + Math.sin(ba) * bl * 0.5, hotC, Math.round(200 * fade), 0);
      }
      px = nx; py = ny;
    }
  }
  // flung chips in the first frames
  if (i < 3) {
    const rc = rng(99 + i);
    for (let k = 0; k < 22; k++) {
      const a = rc() * Math.PI * 2, d = (6 + rc() * 30) * S * (0.5 + i * 0.35);
      const x = Math.round(cx + Math.cos(a) * d), y = Math.round(cy + Math.sin(a) * d * 0.5 - (i * 3 + rc() * 4) * S);
      b.blend(x, y, k % 3 ? 0x6a5444 : EMBER, 255);
      b.blend(x, y + 1, 0x4a3a30, 255);
      if (k % 2) { b.blend(x + 1, y, 0x4a3a30, 255); b.blend(x + 1, y + 1, 0x2a1e18, 255); }
    }
  }
}

/** Whirling steel on the ground plane: three blades with red-smeared trails sweeping a 2:1 ellipse (loops). */
function drawWhirl(b: PixelBuffer, i: number, n: number) {
  const cx = b.w / 2, cy = b.h / 2;
  const S = b.w / 64;
  const R = b.w / 2 - 4 * S;
  const base = (i / n) * ((Math.PI * 2) / 3);
  for (let k = 0; k < 3; k++) {
    const a1 = base + (k * Math.PI * 2) / 3;
    crescent(b, cx, cy, R - S, 1.6 * S, a1 - 1.3, a1 - 0.35, BLOOD, 0.55, 0.5);
    crescent(b, cx, cy, R, 1.7 * S, a1 - 0.75, a1, STEEL, 1, 0.5);
    crescent(b, cx, cy, R + S * 0.9, 0.5 * S, a1 - 0.5, a1, EDGE, 1, 0.5);
    const tx = Math.round(cx + Math.cos(a1) * R), ty = Math.round(cy + Math.sin(a1) * R * 0.5);
    sparkle(b, tx, ty, EDGE, 2, 255);
  }
  // faint inner gust ring
  fill(b, (x, y) => {
    const d = Math.hypot((x + 0.5 - cx) / (R * 0.62), (y + 0.5 - cy) / (R * 0.31));
    if (Math.abs(d - 1) > 0.05) return null;
    const ang = Math.atan2((y - cy) * 2, x - cx);
    return Math.sin(ang * 3 - base * 3) > 0.3 ? [lighten(IRON, 0.3), 120] : null;
  });
}

/** Heavy blood cleave (east-facing): a thick crimson crescent with a white-hot leading edge flinging drops. */
function drawCleave(b: PixelBuffer, i: number, n: number) {
  const t = i / (n - 1);
  const lead = Math.min(1.7, -1.7 + t * 4.4);
  const tail = Math.max(-1.7, lead - 2.6);
  const fade = i >= 3 ? 1 - (i - 2) * 0.33 : 1;
  const S = b.w / 72;
  const cx = 26 * S, cy = b.h / 2;
  crescent(b, cx, cy, 30 * S, 5 * S, tail - 0.3, lead - 0.25, GORE, fade * 0.7);
  crescent(b, cx, cy, 27 * S, 6 * S, tail, lead - 0.1, BLOOD, fade);
  crescent(b, cx, cy, 30 * S, 3 * S, tail + 0.4, lead, RAGE, fade);
  crescent(b, cx, cy, 31.5 * S, 1.1 * S, tail + 0.8, lead, HOT, fade);
  if (i <= 3) {
    const r = rng(31 + i);
    for (let k = 0; k < 18; k++) {
      const a = lead - 0.2 - r() * 0.9;
      const rad = (27 + r() * 10 + i * 2) * S;
      const x = Math.round(cx + Math.cos(a) * rad), y = Math.round(cy + Math.sin(a) * rad);
      const big = k % 3 === 0;
      b.blend(x, y, k % 3 ? BLOOD : RED, Math.round(255 * fade));
      b.blend(x, y + 1, GORE, Math.round(220 * fade));
      if (big) { b.blend(x + 1, y, BLOOD, Math.round(255 * fade)); b.blend(x + 1, y + 1, GORE, Math.round(220 * fade)); b.blend(x, y + 2, GORE, Math.round(160 * fade)); }
    }
    sparkle(b, Math.round(cx + Math.cos(lead) * 31 * S), Math.round(cy + Math.sin(lead) * 31 * S), HOT, 3, 255);
  }
}

/** Fear mark: a little dread skull that blinks over a fleeing enemy (loops). */
function drawFear(b: PixelBuffer, i: number) {
  const rows = [
    '  .###.  ',
    ' #######.',
    '##########',
    '#oo###oo#',
    '#oo###oo#',
    '####.####',
    ' ##.#.## ',
    '  #.#.#  ',
  ];
  const eye = i === 0 ? 0xffe0ff : DREAD;
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y]!.length; x++) {
    const c = rows[y]![x]!;
    if (c === '#') b.blend(x + 1, y + 1, DREAD_L, 255);
    else if (c === '.') b.blend(x + 1, y + 1, DREAD, 255);
    else if (c === 'o') b.blend(x + 1, y + 1, eye, 255);
  }
  outlinePass(b, 0x1a0820, 255);
}

export const SPECS: FxSpec[] = [
  { key: 'fx:berserker:axe', w: 20, h: 20, frames: 1, durations: [100], loop: false, anim: false, draw: (b) => drawAxe(b) },
  { key: 'fx:berserker:rage', w: 40, h: 52, frames: 6, durations: [70, 70, 70, 70, 70, 70], loop: true, draw: drawRage },
  { key: 'fx:berserker:quake', w: 192, h: 96, frames: 6, durations: [40, 50, 70, 110, 160, 200], loop: false, draw: drawQuake },
  { key: 'fx:berserker:whirl', w: 176, h: 88, frames: 6, durations: [32, 32, 32, 32, 32, 32], loop: true, draw: drawWhirl },
  { key: 'fx:berserker:cleave', w: 144, h: 144, frames: 5, durations: [30, 35, 45, 60, 80], loop: false, draw: drawCleave },
  { key: 'fx:berserker:fear', w: 12, h: 10, frames: 2, durations: [160, 420], loop: true, draw: drawFear },
];
