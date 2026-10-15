/**
 * Ground-storytelling decals, critters and ambient motion textures for the lived-in dungeon pass
 * (framework-free). Critters are deliberately tiny, dark and low-contrast so they never read as enemies.
 *
 * Keys:
 *   decal:coins (3)  decal:wax (2)  decal:claw (2)  decal:chalk (2)  decal:edge (20 = 10 growth kinds x 2)
 *   critter:rat (10: run down-left 0-3, run up-left 4-7, sniff 8/9)  critter:bat (4)  critter:flies (4)  critter:spider (2)
 *   critter:bird (4)
 *   amb:wisp (3)  amb:ripple  amb:drop  amb:mote  amb:streak
 */
import { MATERIALS, PALETTES } from './palette';
import { Painter, PixelBuffer, bayer, hash2, outlinePass, rng, type Ramp } from './draw/pixel';
import { STYLES } from './dungeonThemes';

const R = (...c: number[]): Ramp => Object.freeze(c);

export interface FlatSpec {
  key: string;
  w: number;
  h: number;
  frames: number;
  /** run the indigo outline pass after drawing */
  outline?: boolean;
  draw: (buf: PixelBuffer, i: number) => void;
}

/** Edge growth kinds baked along floor/wall seams: frame = kind * 2 + variant. */
export const EDGE_KINDS = ['moss', 'algae', 'dust', 'wax', 'mycel', 'soot', 'rime', 'turf', 'regolith', 'cable'] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

function noise(x: number, y: number, cell: number, seed: number): number {
  const gx = x / cell, gy = y / cell;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = gx - x0, fy = gy - y0;
  const v = (i: number, j: number): number => hash2(i, j, seed);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
  const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

function tone(ramp: Ramp, v: number): number {
  return ramp[Math.max(0, Math.min(ramp.length - 1, Math.floor(v)))] as number;
}

const EDGE_PAL: Record<EdgeKind, { ramp: Ramp; alpha: number; reach: number; speck?: number }> = {
  moss: { ramp: MATERIALS.mossDark, alpha: 225, reach: 8 },
  algae: { ramp: STYLES.flooded.growth, alpha: 215, reach: 9, speck: STYLES.flooded.pool[3] as number },
  dust: { ramp: MATERIALS.boneDry, alpha: 150, reach: 7, speck: MATERIALS.boneDry[4] as number },
  wax: { ramp: R(0x4a3020, 0x7a5a3a, 0xb89a6a, 0xe0caa0), alpha: 190, reach: 5, speck: MATERIALS.gold[3] as number },
  mycel: { ramp: R(0x0e2a24, 0x1c4a40, 0x2e7a6a, 0x5ac8b0, 0xb0fff0), alpha: 200, reach: 10, speck: STYLES.fungal.growth[3] as number },
  soot: { ramp: R(0x040303, 0x0c0909, 0x161212, 0x221c1c), alpha: 200, reach: 9, speck: 0x7a2a0a },
  rime: { ramp: STYLES.frost.growth, alpha: 220, reach: 9, speck: 0xffffff },
  turf: { ramp: STYLES.sky.growth, alpha: 230, reach: 9, speck: 0xfff4b8 },
  regolith: { ramp: STYLES.moon.growth, alpha: 200, reach: 8, speck: STYLES.moon.floor[4] as number },
  cable: { ramp: R(0x040506, 0x0a0c10, 0x14171e, 0x1e222c, 0x2a303c), alpha: 210, reach: 5, speck: STYLES.server.growth[3] as number },
};

function edgeDecal(buf: PixelBuffer, i: number): void {
  const kind = EDGE_KINDS[Math.floor(i / 2)] as EdgeKind;
  const P = EDGE_PAL[kind];
  const seed = 900 + i * 31;
  // the seam runs from (4,4) to (36,20) through the centre; growth spreads onto the floor below it
  for (let y = 0; y < buf.h; y++) for (let x = 2; x < buf.w - 2; x++) {
    const lineY = 4 + (x - 4) / 2;
    const d = y - lineY;
    if (d < -0.5 || d > P.reach) continue;
    const ends = Math.min(1, Math.min(x - 2, buf.w - 3 - x) / 6);
    const n = noise(x, y, 5, seed) * 0.65 + noise(x, y, 2.5, seed + 3) * 0.35;
    const thr = 0.28 + (d / P.reach) * 0.62 + (1 - ends) * 0.4;
    if (n < thr) continue;
    let c = tone(P.ramp, 0.5 + (n - thr) * 5 + bayer(x, y) * 0.6 + (d < 1.5 ? -0.6 : 0));
    if (P.speck !== undefined && hash2(x, y, seed + 7) > 0.94) c = P.speck;
    if (kind === 'mycel' && hash2(x, y, seed + 9) > 0.975) c = 0xd0fff8;
    buf.set(x, y, c, Math.round(P.alpha * Math.min(1, 0.55 + (n - thr) * 3)));
  }
  if (kind === 'mycel') {
    // fine threads reaching out of the seam
    const r = rng(seed);
    for (let k = 0; k < 4; k++) {
      let x = 6 + r() * 28, y = 4 + (x - 4) / 2;
      for (let s = 0; s < 7; s++) {
        x += (r() - 0.5) * 2;
        y += 1;
        buf.blend(Math.round(x), Math.round(y), 0x5ac8b0, 150);
      }
    }
  }
  if (kind === 'algae') {
    // a wet line where water stood against the wall
    for (let x = 4; x < 36; x++) if (hash2(x, i, 5) > 0.3) buf.blend(x, Math.round(4 + (x - 4) / 2) + 1, STYLES.flooded.pool[3] as number, 150);
  }
}

const COIN = MATERIALS.gold;

export const STORY_DECAL_SPECS: FlatSpec[] = [
  {
    key: 'decal:coins',
    w: 24,
    h: 14,
    frames: 3,
    draw: (b, i) => {
      const r = rng(400 + i * 11);
      const n = 5 + i * 2;
      for (let k = 0; k < n; k++) {
        const x = Math.round(4 + r() * 16), y = Math.round(3 + r() * 8);
        b.set(x, y, COIN[2] as number);
        b.set(x + 1, y, COIN[3] as number);
        b.set(x, y + 1, COIN[1] as number);
        b.set(x + 1, y + 1, COIN[0] as number, 200);
        if (r() < 0.35) b.set(x + 1, y - 1, COIN[4] as number, 220);
      }
      if (i === 2) {
        // a spilled purse
        const p = new Painter(b);
        p.ellipse(6, 9, 3, 2).fill(R(0x1c120c, 0x382218, 0x58382a, 0x7a5038), { mode: 'sphere' });
        p.finish(PALETTES.outline, 0);
      }
    },
  },
  {
    key: 'decal:wax',
    w: 16,
    h: 10,
    frames: 2,
    draw: (b, i) => {
      const W = MATERIALS.wax;
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
        const d = Math.hypot((x - 8) / 6.5, (y - 5) / 3.4) + (noise(x, y, 3, 70 + i) - 0.5) * 0.5;
        if (d > 1) continue;
        b.set(x, y, tone(W, 1 + (1 - d) * 2.4 + bayer(x, y) * 0.4), 230);
      }
      b.set(6, 4, W[3] as number);
      b.set(10, 5, 0x1a1210, 230);
    },
  },
  {
    key: 'decal:claw',
    w: 26,
    h: 16,
    frames: 2,
    draw: (b, i) => {
      for (let k = 0; k < 3; k++) {
        const x0 = 4 + k * 4 + i, y0 = 3 + k;
        for (let s = 0; s < 14; s++) {
          const x = x0 + s, y = y0 + Math.round(s * 0.5);
          b.set(x, y, 0xa49884, 170);
          b.set(x, y + 1, 0x0a0806, 170);
        }
      }
    },
  },
  {
    key: 'decal:chalk',
    w: 32,
    h: 20,
    frames: 2,
    draw: (b, i) => {
      const c = 0xd8d0c0;
      if (i === 0) {
        for (let a = 0; a < Math.PI * 1.85; a += 0.06) b.blend(Math.round(16 + Math.cos(a) * 12), Math.round(10 + Math.sin(a) * 6), c, 150);
        for (let s = -6; s <= 6; s++) b.blend(16 + s, 10 + Math.round(s * 0.5), c, 140);
        b.blend(15, 7, c, 140);
        b.blend(17, 13, c, 140);
      } else {
        // an arrow and a warning mark scratched by someone who did not make it out
        for (let s = 0; s < 18; s++) b.blend(4 + s, 12 - Math.round(s * 0.5), c, 150);
        for (let s = 0; s < 4; s++) {
          b.blend(22 - s, 3 + s, c, 150);
          b.blend(20 - s, 3, c, 150);
        }
        for (let s = 0; s < 5; s++) {
          b.blend(24 + s, 12 + s * 0.5, c, 140);
          b.blend(28 - s, 12 + s * 0.5, c, 140);
        }
      }
    },
  },
  { key: 'decal:edge', w: 40, h: 24, frames: EDGE_KINDS.length * 2, draw: edgeDecal },
];

// ---------------------------------------------------------------- critters

const FUR = R(0x100c0e, 0x221c20, 0x342c30, 0x4a4044, 0x5e5458);
const TAIL = 0x5a3e46;
const BAT = R(0x08060c, 0x140e1a, 0x221828, 0x30243a);
const SPIDER = R(0x080606, 0x161010, 0x241a1a, 0x342828);

// Rat pixel maps (14x8). The body lies along the iso run direction: heading down-left the snout is low-left and the
// tail trails up-right; heading up-left we see its back, snout high-left, tail trailing down-right.
// o outline, d dark fur, m fur, L lit fur, e eye, p nose / ear, t tail
const RAT_DOWN = [
  '..............',
  '......oooo....',
  '....ooLLmmo...',
  '..ooLmmmmdo...',
  '.oeLmmmmddo...',
  'opmmmmddoo....',
  '.oodddoo......',
  '..............',
];
const RAT_UP = [
  '.op...........',
  'oLmoo.........',
  'pmmmmoo.......',
  '.ommLLmoo.....',
  '..oommmmmoo...',
  '....oodddddo..',
  '......oodddo..',
  '..............',
];
const RAT_COL: Record<string, number> = { o: 0x0e0a0c, d: FUR[1] as number, m: FUR[2] as number, L: FUR[4] as number, e: 0x020102, p: 0x7a4e56, t: TAIL };

function rat(buf: PixelBuffer, i: number): void {
  const up = (i >= 4 && i < 8) || i === 9;
  const run = i < 8;
  const f = i % 4;
  const rows = up ? RAT_UP : RAT_DOWN;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x]!;
      if (c !== '.') buf.set(x, y + (run && f % 2 ? 0 : 0), RAT_COL[c] as number);
    }
  });
  // scurrying legs: two pairs alternating under the belly
  const legs = up
    ? (run ? [[5, 8], [6, 9], [5, 9], [6, 8]][f]! : [5, 9]).map((x) => [x, 7] as const)
    : (run ? [[2, 6], [3, 5], [2, 5], [3, 6]][f]! : [3, 6]).map((x) => [x, 7] as const);
  for (const [x, y] of legs) buf.set(x, y, RAT_COL.d as number);
  // the tail whips as it runs (sniffing: raised head, still tail)
  const wag = run ? [0, 1, 0, -1][f]! : 0;
  const tail: [number, number][] = up
    ? [[11, 6], [12, 7], [13, 7 + Math.min(0, wag)]]
    : [[10, 3], [11, 2], [12, 1 + Math.max(0, wag)], [13, 1 + wag]];
  for (const [x, y] of tail) buf.set(x, Math.max(0, Math.min(7, y)), TAIL);
  if (!run) {
    // sniffing: nose twitches up a pixel
    if (up) buf.set(0, 0, RAT_COL.p as number);
    else { buf.set(0, 4, RAT_COL.p as number); buf.set(0, 5, 0); }
  }
}

function bat(buf: PixelBuffer, i: number): void {
  const p = new Painter(buf);
  const tip = [[1, 0, 11, 0], [0, 3, 12, 3], [1, 7, 11, 7], [0, 4, 12, 4]][i]!;
  p.poly([6, 3, tip[0]!, tip[1]!, 3, 4.5, 5, 5]).poly([6, 3, tip[2]!, tip[3]!, 9, 4.5, 7, 5]).fill(BAT, { mode: 'flat', tone: 2, inner: false });
  p.ellipse(6, 4, 1.3, 1.8).fill(BAT, { mode: 'sphere', light: 0.2 });
  buf.set(5, 2, BAT[2] as number);
  buf.set(7, 2, BAT[2] as number);
}

/** A gull-like sky bird: pale body, wings beating through four frames (the sky island's answer to the bat). */
function bird(buf: PixelBuffer, i: number): void {
  const p = new Painter(buf);
  const W = R(0x5a5e66, 0x8a909a, 0xbcc2ca, 0xe4e8ee, 0xffffff);
  const tip = [[1, 0, 13, 0], [0, 3, 14, 3], [1, 6, 13, 6], [0, 4, 14, 4]][i]!;
  p.poly([7, 4, tip[0]!, tip[1]!, 3, 4, 5, 5]).poly([7, 4, tip[2]!, tip[3]!, 11, 4, 9, 5]).fill(W, { mode: 'flat', tone: 3, inner: false });
  p.ellipse(7, 4.5, 2, 1.2).fill(W, { mode: 'sphere', light: 0.3 });
  buf.set(9, 4, 0xd8a020);
  buf.set(tip[0]!, tip[1]!, W[1] as number);
  buf.set(tip[2]!, tip[3]!, W[1] as number);
}

function flies(buf: PixelBuffer, i: number): void {
  const r = rng(77);
  for (let k = 0; k < 7; k++) {
    const a0 = r() * Math.PI * 2, rad = 2 + r() * 4, sp = 0.7 + r() * 0.9;
    const a = a0 + i * sp * 1.4;
    const x = Math.round(8 + Math.cos(a) * rad * 1.4), y = Math.round(6 + Math.sin(a) * rad * 0.8);
    buf.set(x, y, 0x120e0c, 255);
    if ((k + i) % 2) buf.set(x, y - 1, 0x9a9aa4, 140);
  }
}

function spider(buf: PixelBuffer, i: number): void {
  const p = new Painter(buf);
  for (let k = 0; k < 3; k++) {
    const y = 2 + k + (i && k === 1 ? 1 : 0);
    buf.set(0, y, SPIDER[1] as number);
    buf.set(6, y + (i ? -1 : 0), SPIDER[1] as number);
    buf.set(1, y - (k === 0 ? 1 : 0), SPIDER[2] as number);
    buf.set(5, y - (k === 0 ? 1 : 0), SPIDER[2] as number);
  }
  p.ellipse(3.5, 3.4, 1.7, 1.6).fill(SPIDER, { mode: 'sphere', light: 0.15, inner: false });
  buf.set(3, 2, SPIDER[3] as number);
}

export const CRITTER_SPECS: FlatSpec[] = [
  { key: 'critter:rat', w: 14, h: 8, frames: 10, draw: rat },
  { key: 'critter:bat', w: 12, h: 8, frames: 4, draw: bat },
  { key: 'critter:flies', w: 16, h: 12, frames: 4, draw: flies },
  { key: 'critter:spider', w: 7, h: 6, frames: 2, draw: spider },
  { key: 'critter:bird', w: 14, h: 8, frames: 4, draw: bird },
];

// ---------------------------------------------------------------- ambient motion textures (white; tinted at runtime)

export const AMBIENT_FX_SPECS: FlatSpec[] = [
  {
    key: 'amb:wisp',
    w: 12,
    h: 12,
    frames: 3,
    draw: (b, i) => {
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
        const d = Math.hypot(x + 0.5 - 6, y + 0.5 - 6) / 5.6;
        const n = noise(x, y, 3, 500 + i * 13);
        const a = (1 - d) * 1.4 - (1 - n) * 0.7;
        if (a <= 0.05) continue;
        b.set(x, y, 0xffffff, Math.round(Math.min(1, a) * 200 * (0.8 + bayer(x, y) * 0.3)));
      }
    },
  },
  {
    key: 'amb:ripple',
    w: 20,
    h: 10,
    frames: 1,
    draw: (b) => {
      for (let a = 0; a < Math.PI * 2; a += 0.02) {
        const x = Math.round(10 + Math.cos(a) * 8.6), y = Math.round(5 + Math.sin(a) * 3.6);
        b.set(x, y, 0xffffff, Math.sin(a) < 0 ? 150 : 230);
      }
    },
  },
  {
    key: 'amb:drop',
    w: 2,
    h: 4,
    frames: 1,
    draw: (b) => {
      b.set(0, 0, 0xd8f0ff, 140);
      b.set(0, 1, 0xd8f0ff, 220);
      b.set(0, 2, 0xffffff, 255);
      b.set(1, 2, 0xa8c8e0, 200);
      b.set(0, 3, 0xa8c8e0, 220);
    },
  },
  {
    key: 'amb:mote',
    w: 3,
    h: 3,
    frames: 1,
    draw: (b) => {
      b.set(1, 1, 0xffffff, 255);
      for (const [x, y] of [[0, 1], [2, 1], [1, 0], [1, 2]] as const) b.set(x, y, 0xffffff, 110);
    },
  },
  {
    key: 'amb:streak',
    w: 8,
    h: 2,
    frames: 1,
    draw: (b) => {
      for (let x = 0; x < 8; x++) b.set(x, 0, 0xffffff, Math.round(40 + x * 26));
      b.set(7, 1, 0xffffff, 120);
    },
  },
];

/** Every texture key produced here (for the manifest). */
export const AMBIENT_TEXTURE_KEYS: readonly string[] = [...STORY_DECAL_SPECS, ...CRITTER_SPECS, ...AMBIENT_FX_SPECS].map((s) => s.key);
