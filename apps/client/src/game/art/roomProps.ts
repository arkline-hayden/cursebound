/**
 * Room furniture for the multi-tier dungeon rooms (framework-free): free-standing blockers that sit on a single tile,
 * cosmetic floor pieces and a few wall fixtures. Plain pixel generation (no Phaser, no DOM), same conventions as
 * clutter.ts:
 *  - Light from the top-left; every prop gets the indigo outline pass unless `outline: false`.
 *  - BLOCKERS (`blocks: true`) stand on ONE tile: the origin is the centre of that tile's ground diamond and the base
 *    footprint stays inside it (|dx| <= 26, |dy| <= 12), with the origin at least 14px above the sprite bottom.
 *    A square iso footprint of side s centred on the origin has its front corner at origin + (0, s/2).
 *  - `bookcase_free` spans exactly one tile along world x, so two on adjacent tiles butt into one long case.
 *  - `glow` layers hold only emissive pixels (flames, coals, runes, glowing caps); the body stays lit by Light2D.
 *  - Wall props are authored front-facing; the renderer shears them onto block faces.
 */
import { MATERIALS } from './palette';
import { OUTLINE, Painter, rng, type Ramp } from './draw/pixel';
import {
  ASH, BLUE, BONE, BRASS, CANVAS, DARK, FLAME, GOLD, GREEN, IRON, LAVA, LEATHER, MAGENTA, MOSS, OLDWOOD, PAPER, RED, ROPE, RUST, SHADOW, SOUL,
  STALK, STATUE, STONE, STRAW, TEAL, WAX, WOOD,
  barrelBody, candleBody, isoBox, onL, onR, onTop, seg, shadow, shelfBooks, skull, spec, stone, tinyFlame, wallSpec,
  type BoxPts, type ClutterSpec, type Pt,
} from './clutter';

const R = (...c: number[]): Ramp => Object.freeze(c);

// ---------------------------------------------------------------- ramps

const STEEL = MATERIALS.steel;
const BRONZE = MATERIALS.bronze;
const BASALT = R(0x0e0d12, 0x1e1b26, 0x332e40, 0x4e475e, 0x72698a);
const CLAY = R(0x2a120a, 0x5a2814, 0x8a4424, 0xb46a3a, 0xd89a64);
const VERDIGRIS = R(0x12302a, 0x22584a, 0x3a8a72, 0x62b89a, 0x9ae0c4);
const WATER = R(0x060c12, 0x0c1822, 0x16304a, 0x2a5476, 0x7ab0d4);
const STREAM = R(0x1a3a52, 0x3a6a8a, 0x6aa0c0, 0xa8d4ec, 0xeaf8ff);
const LILY = R(0x0a1c0e, 0x183a1a, 0x2a5a28, 0x467e38, 0x72a854);
const PETAL = R(0x4a1a36, 0x8a3462, 0xc8668e, 0xeea6c4, 0xfff0f6);
const OLDBONE = R(0x2a2016, 0x5e5040, 0x968266, 0xc4b290, 0xe6dabb);
const BLOODY =R(0x1a0404, 0x2c0606, 0x420a0a, 0x5a1010);
const RIVET = IRON[4] as number;

// ---------------------------------------------------------------- local helpers

/** Iso footprint corners of a square of side s (horizontal px) centred on c. */
function square(c: Pt, s: number): { F: Pt; L: Pt; R: Pt; B: Pt } {
  return { F: { x: c.x, y: c.y + s / 2 }, L: { x: c.x - s, y: c.y }, R: { x: c.x + s, y: c.y }, B: { x: c.x, y: c.y - s / 2 } };
}

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** A big licking flame (for glow layers): emissive body plus a white-hot core. */
function fire(p: Painter, cx: number, by: number, h: number, w: number, sway: number): void {
  p.poly([cx - w, by, cx + w, by, cx + w * 0.6 + sway * 0.4, by - h * 0.45, cx + sway, by - h, cx - w * 0.6 + sway * 0.3, by - h * 0.5]).fill(FLAME, {
    mode: 'emboss',
    glow: FLAME[3] as number,
    light: 0.35,
    inner: false,
  });
  p.poly([cx - w * 0.45, by, cx + w * 0.45, by, cx + sway * 0.6, by - h * 0.55]).fill(FLAME, { mode: 'flat', tone: 4, inner: false });
}

/** Glowing coal bed scattered inside an ellipse (glow layers). */
function coals(p: Painter, cx: number, cy: number, rx: number, ry: number, seed: number, n: number): void {
  const r = rng(seed);
  for (let k = 0; k < n; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r());
    const c = r() < 0.3 ? LAVA[4] : r() < 0.6 ? LAVA[3] : LAVA[2];
    p.gpx(cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, c as number, LAVA[2] as number);
  }
}

/**
 * Little mushrooms split in two passes so the stems stay lit in the body and only the caps glow:
 * call once with 'stem' (body) and once with 'cap' (glow layer) using the same seed.
 */
function shrooms(p: Painter, cx: number, by: number, n: number, seed: number, scale: number, part: 'stem' | 'cap', ramp: Ramp = TEAL): void {
  const r = rng(seed);
  for (let k = 0; k < n; k++) {
    const x = cx + (r() - 0.5) * 9 * scale;
    const h = (2 + r() * 4) * scale;
    const lean = r() - 0.5;
    const cw = (1.6 + r()) * scale;
    if (part === 'stem') p.capsule(x, by, x + lean, by - h, 0.6 * scale, 0.5 * scale).fill(STALK, { mode: 'cyl', inner: false });
    else {
      p.ellipse(x + lean, by - h - 0.5, cw, 1.1 * scale).fill(ramp, { mode: 'sphere', glow: ramp[3] as number, light: 0.2, inner: false });
      p.gpx(x + lean - cw * 0.4, by - h - 1, ramp[4] as number, ramp[3] as number);
    }
  }
}

/** A dressed stone block: iso box with a chiselled margin and a chipped corner. */
function block(p: Painter, fx: number, fy: number, a: number, b: number, h: number, ramp: Ramp = STONE): BoxPts {
  const bx = isoBox(p, fx, fy, a, b, h, ramp, { dither: true });
  seg(p, onL(bx, 0.08, h - 1), onL(bx, 0.92, h - 1)).fill(ramp, { mode: 'flat', tone: 3, inner: false });
  seg(p, onL(bx, 0.08, 1), onL(bx, 0.92, 1)).fill(ramp, { mode: 'flat', tone: 1, inner: false });
  p.px(bx.F.x, bx.F.y - h, ramp[4] as number);
  return bx;
}

/** Clay / bronze urn standing at (cx, by); `s` scales it. cracked = chipped lip, crack and shards. */
function urnBody(p: Painter, cx: number, by: number, s: number, ramp: Ramp, kind: 'clay' | 'bronze' | 'cracked'): void {
  // handles first, the belly overlaps their roots
  for (const side of [-1, 1]) p.ellipse(cx + side * 4.6 * s, by - 13 * s, 1.7 * s, 2.6 * s).minus().ellipse(cx + side * 4.6 * s, by - 13 * s, 0.7 * s, 1.5 * s).plus();
  p.fill(ramp, { mode: 'emboss', light: -0.1, inner: false });
  p.ellipse(cx, by - 8 * s, 6 * s, 6.4 * s).ellipse(cx, by - 2.6 * s, 3.8 * s, 2.4 * s).rect(cx - 2.6 * s, by - 18 * s, 5.2 * s, 7 * s);
  if (kind === 'cracked') p.minus().poly([cx + 1 * s, by - 19.5 * s, cx + 4 * s, by - 19.5 * s, cx + 4 * s, by - 15 * s, cx + 2 * s, by - 16.5 * s]).plus();
  p.fill(ramp, { mode: 'cyl', dither: true });
  p.ellipse(cx, by - 1, 3.6 * s, 1.3 * s).fill(ramp, { mode: 'emboss', light: -0.2 });
  // flared lip and the dark mouth
  p.ellipse(cx, by - 18.2 * s, 3.8 * s, 1.5 * s).fill(ramp, { mode: 'emboss', light: 0.35 });
  p.ellipse(cx, by - 18.3 * s, 2.3 * s, 0.75 * s).fill(DARK, { mode: 'flat', tone: 1, inner: false });
  if (kind === 'cracked') p.poly([cx + 1 * s, by - 18.5 * s, cx + 3.5 * s, by - 18.5 * s, cx + 2 * s, by - 16.5 * s]).fill(DARK, { mode: 'flat', tone: 1, inner: false });
  // painted band around the belly
  const bandY = by - 9.5 * s;
  if (kind !== 'bronze') {
    p.line(cx - 5.4 * s, bandY, cx + 5.4 * s, bandY).line(cx - 5.4 * s, bandY + 2.5 * s, cx + 5.4 * s, bandY + 2.5 * s).fill(DARK, { mode: 'flat', tone: 2, inner: false, alpha: 210 });
    for (let x = -4; x <= 4; x += 2) p.px(cx + x * s, bandY + 1.2 * s + ((x / 2) % 2 ? 0.6 : -0.4), DARK[2] as number, 210);
  } else {
    p.line(cx - 5.6 * s, bandY + 1, cx + 5.6 * s, bandY + 1).fill(GOLD, { mode: 'flat', tone: 2, inner: false, alpha: 200 });
    const r = rng(17 + Math.round(cx));
    for (let k = 0; k < 7; k++) p.px(cx + (r() - 0.6) * 9 * s, by - 3 - r() * 13 * s, VERDIGRIS[2 + (k % 2)] as number, 220);
  }
  if (kind === 'cracked') {
    p.line(cx + 2 * s, by - 16 * s, cx + 0.5 * s, by - 12 * s).line(cx + 0.5 * s, by - 12 * s, cx + 1.8 * s, by - 8 * s).line(cx + 1.8 * s, by - 8 * s, cx, by - 4 * s);
    p.fill(DARK, { mode: 'flat', tone: 0, inner: false });
  }
}

/** Scatter of coins inside an ellipse (pixels with a dark edge so they read on gold heaps). */
function coinScatter(p: Painter, cx: number, cy: number, rx: number, ry: number, n: number, seed: number): void {
  const r = rng(seed);
  for (let k = 0; k < n; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r());
    const x = Math.round(cx + Math.cos(a) * rx * d), y = Math.round(cy + Math.sin(a) * ry * d);
    p.px(x, y, GOLD[r() < 0.4 ? 4 : 3] as number).px(x + 1, y, GOLD[2] as number).px(x, y + 1, GOLD[1] as number);
  }
}

// ---------------------------------------------------------------- blockers

/** Double-sided free-standing bookcase: exactly one tile along world x so neighbours read as one long case. */
function bookcaseDraw(p: Painter, v: number): void {
  const A = 32, Bd = 16, H = 40;
  const F = { x: 33, y: 67 };
  // contact shadow hugging the footprint (kept inside its own tile so joined cases don't double it)
  p.poly([F.x, F.y + 2, F.x - A - 1, F.y - A / 2 + 1, F.x - A + Bd, F.y - (A + Bd) / 2, F.x + Bd + 1, F.y - Bd / 2 + 1]).fill(SHADOW, { mode: 'flat', tone: 0, inner: false, alpha: 70 });
  const b = isoBox(p, F.x, F.y, A, Bd, H, WOOD, { dither: true, tl: 0.3, rl: -0.45 });
  // recessed shelf backs, books, shelf boards
  const i0 = onL(b, 0.03, 3), i1 = onL(b, 0.97, 3), i2 = onL(b, 0.97, 37), i3 = onL(b, 0.03, 37);
  p.poly([i0.x, i0.y, i1.x, i1.y, i2.x, i2.y, i3.x, i3.y]).fill(DARK, { mode: 'flat', tone: 1, inner: false });
  const shelfZ = [3, 14.5, 26];
  shelfZ.forEach((z, k) => {
    const a0 = onL(b, 0.04, z + 1), a1 = onL(b, 0.96, z + 1);
    shelfBooks(p, Math.round(a1.x) + 1, Math.round(a0.x) - 1, a1.y - 0.5, 9.5, 211 + k * 17 + v * 101);
  });
  for (const z of [...shelfZ, 37]) {
    const a0 = onL(b, 0.0, z), a1 = onL(b, 1, z);
    p.poly([a1.x, a1.y, a0.x, a0.y, a0.x, a0.y + 1.6, a1.x, a1.y + 1.6]);
  }
  p.fill(WOOD, { mode: 'flat', tone: 3, inner: false });
  // plinth and cornice bands
  p.poly([b.L.x, b.L.y - 2, b.F.x, b.F.y - 2, b.F.x, b.F.y, b.L.x, b.L.y]).fill(WOOD, { mode: 'flat', tone: 1, inner: false });
  p.poly([b.L.x, b.L.y - 40, b.F.x, b.F.y - 40, b.F.x, b.F.y - 38, b.L.x, b.L.y - 38]).fill(WOOD, { mode: 'flat', tone: 4, inner: false });
  // end uprights (1px each so a joined pair shows one bolted seam) and the centre stile
  for (const s of [0.015, 0.985]) seg(p, onL(b, s, 1), onL(b, s, 39));
  p.fill(WOOD, { mode: 'flat', tone: 2, inner: false });
  seg(p, onL(b, 0.5, 2), onL(b, 0.5, 38)).fill(WOOD, { mode: 'flat', tone: 3, inner: false });
  // iron corner brackets on the cornice
  for (const s of [0.06, 0.94]) {
    const q = onL(b, s, 38);
    p.px(q.x, q.y, RIVET).px(q.x, q.y + 1, IRON[2] as number);
  }
  // end panel (only the last case in a row shows it): a raised field
  const e0 = onR(b, 0.18, 5), e1 = onR(b, 0.82, 5), e2 = onR(b, 0.82, 35), e3 = onR(b, 0.18, 35);
  p.poly([e0.x, e0.y, e1.x, e1.y, e2.x, e2.y, e3.x, e3.y]).fill(WOOD, { mode: 'emboss', light: -0.3, dither: true });
  // dressing on and in the shelves
  if (v === 0) {
    const t = onTop(b, 0.3, 0.5);
    isoBox(p, t.x + 3, t.y + 1, 7, 4, 2, RED, { left: PAPER, ll: 0.3 });
    isoBox(p, t.x + 2, t.y - 1, 6, 4, 2, BLUE, { left: PAPER, ll: 0.3 });
    const c = onTop(b, 0.75, 0.45);
    candleBody(p, Math.round(c.x), Math.round(c.y), 3);
    p.ellipse(c.x, c.y, 2, 0.8).fill(WAX, { mode: 'flat', tone: 2, inner: false });
  } else {
    const t = onTop(b, 0.62, 0.5);
    skull(p, t.x, t.y - 2, 0.9, BONE, -1);
    const sc = onTop(b, 0.22, 0.5);
    p.capsule(sc.x - 3, sc.y + 1, sc.x + 3, sc.y - 2, 1.3).fill(PAPER, { mode: 'cyl' });
    // a fallen book leaning in a gap and a cobweb in the top corner
    const lb = onL(b, 0.7, 15.5);
    p.poly([lb.x - 4, lb.y - 1, lb.x + 2, lb.y + 2, lb.x + 2, lb.y + 3.5, lb.x - 4, lb.y + 0.5]).fill(GREEN, { mode: 'emboss' });
    const cw = onL(b, 0.93, 36);
    p.line(cw.x, cw.y, cw.x + 4, cw.y + 4).line(cw.x, cw.y + 2, cw.x + 3, cw.y + 1).fill(R(0xcfcac0, 0xcfcac0, 0xcfcac0, 0xcfcac0), { mode: 'flat', alpha: 100, inner: false });
  }
}

function ironMaidenDraw(p: Painter): void {
  shadow(p, 21, 47, 14, 4.5, 90);
  const b = isoBox(p, 24, 52, 14, 10, 32, IRON, { dither: true });
  // open front: a dark spiked interior
  const q0 = onL(b, 0.1, 2), q1 = onL(b, 0.92, 2), q2 = onL(b, 0.92, 29), q3 = onL(b, 0.1, 29);
  p.poly([q0.x, q0.y, q1.x, q1.y, q2.x, q2.y, q3.x, q3.y]).fill(DARK, { mode: 'flat', tone: 1, inner: false });
  for (let z = 6; z <= 26; z += 5) for (const s of [0.28, 0.5, 0.72]) {
    const q = onL(b, s, z);
    p.px(q.x, q.y, IRON[1] as number).px(q.x + 1, q.y, IRON[3] as number);
  }
  const bl = onL(b, 0.5, 4);
  p.ellipse(bl.x, bl.y + 1, 3, 1).fill(BLOODY, { mode: 'flat', tone: 3, inner: false });
  // iron bands and rivets on the frame
  for (const z of [1, 15, 30]) {
    seg(p, onR(b, 0, z), onR(b, 1, z)).fill(RUST, { mode: 'flat', tone: 2, inner: false });
    for (const s of [0.2, 0.55, 0.9]) p.px(onR(b, s, z).x, onR(b, s, z).y - 1, IRON[3] as number);
  }
  for (const z of [3, 10, 17, 24, 31]) p.px(b.F.x - 1, b.F.y - z, RIVET);
  // rust weeping down the side
  const r = rng(61);
  for (let k = 0; k < 6; k++) {
    const s = 0.1 + r() * 0.8, z = 6 + r() * 22;
    const q = onR(b, s, z);
    p.rect(q.x, q.y, 1, 2 + r() * 5);
  }
  p.fill(RUST, { mode: 'flat', tone: 1, inner: false, alpha: 200 });
  // domed head with a stern iron face on its front
  const t = onTop(b, 0.5, 0.5);
  p.ellipse(t.x, t.y - 2, 10, 6.5).minus().rect(t.x - 12, t.y + 2.5, 24, 6).plus().fill(IRON, { mode: 'sphere', light: 0.1, dither: true });
  p.ellipse(t.x, t.y + 1.8, 10.2, 2).minus().ellipse(t.x, t.y + 0.8, 9, 1.4).fill(RUST, { mode: 'emboss', inner: false });
  // a cast mask: pale brow and cheeks, hollow eyes, a grim down-turned mouth
  const fx = t.x - 3, fy = t.y - 2.5;
  p.ellipse(fx, fy, 4, 4.8).fill(STEEL, { mode: 'sphere', light: -0.25 });
  p.rect(fx - 3, fy - 1.5, 2, 1.4).rect(fx + 0.5, fy - 1, 2, 1.4).fill(DARK, { mode: 'flat', tone: 0, inner: false });
  p.line(fx - 3.4, fy - 2.6, fx + 2.6, fy - 2).fill(STEEL, { mode: 'flat', tone: 3, inner: false });
  p.line(fx, fy - 1, fx - 0.4, fy + 1.4).fill(STEEL, { mode: 'flat', tone: 1, inner: false });
  p.line(fx - 2.2, fy + 3.2, fx - 1, fy + 2.4).line(fx - 1, fy + 2.4, fx + 1, fy + 2.6).line(fx + 1, fy + 2.6, fx + 2, fy + 3.4).fill(DARK, { mode: 'flat', tone: 0, inner: false });
  // the door, hinged on the far edge and swung out toward the viewer: its spiked inner side shows
  const L0 = onL(b, 1, 1);
  const D = { x: -7.2, y: 7.4 };
  p.poly([L0.x, L0.y, L0.x + D.x, L0.y + D.y, L0.x + D.x, L0.y + D.y - 29, L0.x, L0.y - 29]).fill(IRON, { mode: 'emboss', light: -0.12, dither: true });
  p.line(L0.x + D.x, L0.y + D.y, L0.x + D.x, L0.y + D.y - 29).fill(IRON, { mode: 'flat', tone: 3, inner: false });
  for (const u of [0.3, 0.62]) for (let z = 6; z <= 26; z += 5) {
    const x = L0.x + D.x * u, y = L0.y + D.y * u - z;
    p.px(x, y, IRON[1] as number).px(x + 1, y, IRON[3] as number).px(x + 2, y, STEEL[3] as number);
    p.px(x, y + 1, RUST[2] as number, 180);
  }
  for (const z of [5, 24]) p.rect(L0.x - 1, L0.y - z - 1, 2, 2).fill(RUST, { mode: 'flat', tone: 3, inner: false });
}

function pilloryDraw(p: Painter): void {
  shadow(p, 16, 39, 13, 4, 85);
  const base = isoBox(p, 16, 44, 12, 12, 3, OLDWOOD, { dither: true });
  seg(p, onL(base, 0.5, 0), onL(base, 0.5, 3)).fill(OLDWOOD, { mode: 'flat', tone: 0, inner: false });
  // post and braces
  p.capsule(11, 35, 14.5, 28, 0.9).capsule(21, 35, 17.5, 28, 0.9).fill(WOOD, { mode: 'cyl' });
  p.rect(14, 5, 4, 31).fill(OLDWOOD, { mode: 'cyl', dither: true });
  p.poly([13.5, 5, 18.5, 5, 16, 2.5]).fill(OLDWOOD, { mode: 'emboss', light: 0.3 });
  for (const y of [12, 31]) p.px(15, y, RIVET);
  // the stocks board, split along the holes
  const bd = isoBox(p, 26, 31, 24, 4, 8, WOOD, { dither: true, tl: 0.35 });
  seg(p, onL(bd, 0, 4), onL(bd, 1, 4)).fill(WOOD, { mode: 'flat', tone: 0, inner: false });
  for (const [s, rr] of [[0.2, 1.6], [0.5, 2.6], [0.8, 1.6]] as const) {
    const q = onL(bd, s, 4);
    p.ellipse(q.x, q.y, rr, rr * 1.05).fill(DARK, { mode: 'flat', tone: 0, inner: false });
    p.px(q.x - rr + 0.5, q.y - rr * 0.5, WOOD[4] as number);
  }
  // grain, hinge straps and a padlock hanging off the front end
  for (const s of [0.34, 0.66]) seg(p, onL(bd, s, 6.5), onL(bd, s + 0.08, 6.5));
  p.fill(WOOD, { mode: 'flat', tone: 1, inner: false });
  for (const z of [2, 6]) seg(p, onL(bd, 0.93, z), onL(bd, 1, z));
  p.fill(IRON, { mode: 'flat', tone: 3, inner: false });
  const lk = onL(bd, 0.02, 4);
  p.ellipse(lk.x + 1, lk.y + 1, 1.2, 1.2).minus().ellipse(lk.x + 1, lk.y + 1, 0.5, 0.5).fill(IRON, { mode: 'flat', tone: 2, inner: false });
  p.rect(lk.x, lk.y + 2, 2.4, 2.4).fill(BRASS, { mode: 'emboss', light: 0.2 });
  // dropped rotten vegetables and straw underfoot
  p.circle(6, 43, 1.4).fill(GREEN, { mode: 'sphere' });
  p.circle(25, 44, 1.2).fill(RED, { mode: 'sphere', light: -0.2 });
  for (const [x, y] of [[9, 45], [22, 46], [12, 47], [27, 42]] as const) p.px(x, y, STRAW[3] as number).px(x + 1, y, STRAW[2] as number);
}

function guardianDraw(p: Painter): void {
  shadow(p, 16, 57, 15, 5, 90);
  const s1 = block(p, 16, 63, 14, 14, 5);
  const s2 = block(p, 16, 56, 10, 10, 4);
  // carved name plate on the lower step
  const n0 = onL(s1, 0.3, 2.5), n1 = onL(s1, 0.7, 2.5);
  seg(p, n0, n1).fill(DARK, { mode: 'flat', tone: 2, inner: false, alpha: 200 });
  const c = onTop(s2, 0.5, 0.5);
  const cx = c.x, by = c.y;
  // cloak behind the figure
  p.poly([cx - 7, by - 1, cx + 8, by - 1, cx + 7, by - 27, cx - 6, by - 27]).fill(STATUE, { mode: 'cyl', dither: true, light: -0.35 });
  // greaves and sabatons
  p.rect(cx - 4.5, by - 14, 3.5, 13).rect(cx + 1, by - 14, 3.5, 13).fill(STATUE, { mode: 'cyl' });
  p.ellipse(cx - 3, by - 1, 2.6, 1.3).ellipse(cx + 3, by - 1, 2.6, 1.3).fill(STATUE, { mode: 'emboss', light: 0.1 });
  p.px(cx - 3, by - 8, STATUE[4] as number).px(cx + 2.5, by - 8, STATUE[3] as number);
  // tassets and breastplate
  p.poly([cx - 6, by - 12, cx + 6, by - 12, cx + 5, by - 18, cx - 5, by - 18]).fill(STATUE, { mode: 'emboss', light: 0.05 });
  p.line(cx - 5.5, by - 15, cx + 5.5, by - 15).fill(STATUE, { mode: 'flat', tone: 1, inner: false });
  p.poly([cx - 6, by - 18, cx + 6, by - 18, cx + 7, by - 27, cx + 5, by - 30, cx - 5, by - 30, cx - 7, by - 27]).fill(STATUE, { mode: 'cyl', dither: true, light: 0.05 });
  p.line(cx, by - 29, cx, by - 19).fill(STATUE, { mode: 'flat', tone: 3, inner: false });
  // pauldrons and arms reaching to the sword grip
  p.ellipse(cx - 7, by - 28, 3.4, 2.7).ellipse(cx + 7, by - 28, 3.4, 2.7).fill(STATUE, { mode: 'sphere', light: 0.1 });
  p.capsule(cx - 7.5, by - 26, cx - 3, by - 22, 1.7, 1.4).capsule(cx + 7.5, by - 26, cx + 3, by - 22, 1.7, 1.4).fill(STATUE, { mode: 'cyl' });
  // the sword, point resting on the plinth
  p.poly([cx - 1.8, by - 20, cx + 1.8, by - 20, cx + 1, by - 3, cx, by + 0.5, cx - 1, by - 3]).fill(STATUE, { mode: 'cyl', light: 0.45 });
  p.line(cx + 0.5, by - 19, cx + 0.5, by - 3).fill(STATUE, { mode: 'flat', tone: 2, inner: false });
  p.rect(cx - 6.5, by - 22, 13, 2).fill(STATUE, { mode: 'emboss', light: 0.3 });
  p.px(cx - 6.5, by - 22.5, STATUE[4] as number).px(cx + 6, by - 22.5, STATUE[3] as number);
  p.ellipse(cx, by - 23.5, 3.2, 2.1).fill(STATUE, { mode: 'sphere', light: 0.15 });
  p.circle(cx, by - 26.5, 1.4).fill(STATUE, { mode: 'sphere', light: 0.3 });
  // great helm with a visor slit
  p.ellipse(cx, by - 31, 4, 1.6).fill(STATUE, { mode: 'emboss' });
  p.rect(cx - 4, by - 40, 8, 9).ellipse(cx, by - 40, 4, 2.6).fill(STATUE, { mode: 'cyl', light: 0.05 });
  p.line(cx - 3, by - 36, cx + 3, by - 36).fill(DARK, { mode: 'flat', tone: 0, inner: false });
  p.line(cx, by - 42, cx, by - 37).fill(STATUE, { mode: 'flat', tone: 4, inner: false });
  for (const [x, y] of [[cx + 1.5, by - 33], [cx + 2.5, by - 33.5], [cx + 1.5, by - 34.5]] as const) p.px(x, y, STATUE[1] as number);
  // moss in the crevices and a crack through the breastplate
  for (const [x, y, rx] of [[cx - 6, by - 1, 2.2], [cx + 6.5, by - 30, 1.6], [cx - 3.5, by - 41, 1.4], [s1.L.x + 3, s1.L.y - 1, 2]] as const) p.ellipse(x, y, rx, rx * 0.6);
  p.fill(MOSS, { mode: 'sphere', dither: true, inner: false });
  p.line(cx + 3, by - 27, cx + 2, by - 23).line(cx + 2, by - 23, cx + 3.5, by - 20).fill(DARK, { mode: 'flat', tone: 0, inner: false, alpha: 220 });
}

// obelisk geometry (shared by the body and its glow layer)
const OB = { c0: { x: 14, y: 54 }, s0: 9, c1: { x: 14, y: 12 }, s1: 5, apex: { x: 14, y: 4 } };
const OB_GLYPHS = ['010011010110010', '100110101100100', '001011101001001', '110101110100100', '101010010010101', '010110011010010', '100101111100100'];

/** Pixels of the carved rune column on the obelisk's lit face (and a short one on the dark face). */
function obeliskRunes(): { x: number; y: number; row: number; dim: boolean }[] {
  const b0 = square(OB.c0, OB.s0), b1 = square(OB.c1, OB.s1);
  const out: { x: number; y: number; row: number; dim: boolean }[] = [];
  const carve = (face: 'L' | 'R', rows: number[], dim: boolean): void => {
    rows.forEach((t, row) => {
      const bot = lerp(b0.F, face === 'L' ? b0.L : b0.R, 0.5), top = lerp(b1.F, face === 'L' ? b1.L : b1.R, 0.5);
      const c = lerp(bot, top, t);
      const g = OB_GLYPHS[(row * 3 + (dim ? 2 : 0)) % OB_GLYPHS.length] as string;
      const slope = face === 'L' ? 0.5 : -0.5;
      for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
        if (g[gy * 3 + gx] !== '1') continue;
        out.push({ x: Math.round(c.x - 1 + gx), y: Math.round(c.y - 2.5 + gy + (gx - 1) * slope), row, dim });
      }
    });
  };
  carve('L', [0.1, 0.27, 0.44, 0.61, 0.78], false);
  carve('R', [0.3, 0.6], true);
  return out;
}

function obeliskDraw(p: Painter): void {
  shadow(p, 14, 61, 13, 5, 90);
  const base = block(p, 14, 66, 12, 12, 6, STONE);
  seg(p, onL(base, 0.15, 3), onL(base, 0.85, 3)).fill(DARK, { mode: 'flat', tone: 2, inner: false, alpha: 180 });
  const b0 = square(OB.c0, OB.s0), b1 = square(OB.c1, OB.s1);
  p.poly([b0.F.x, b0.F.y, b0.L.x, b0.L.y, b1.L.x, b1.L.y, b1.F.x, b1.F.y]).fill(BASALT, { mode: 'emboss', light: 0.12, dither: true, inner: false });
  p.poly([b0.F.x, b0.F.y, b0.R.x, b0.R.y, b1.R.x, b1.R.y, b1.F.x, b1.F.y]).fill(BASALT, { mode: 'emboss', light: -0.45, dither: true, inner: false });
  // pyramidion
  p.poly([b1.F.x, b1.F.y, b1.L.x, b1.L.y, OB.apex.x, OB.apex.y]).fill(BASALT, { mode: 'emboss', light: 0.35, inner: false });
  p.poly([b1.F.x, b1.F.y, b1.R.x, b1.R.y, OB.apex.x, OB.apex.y]).fill(BASALT, { mode: 'emboss', light: -0.3, inner: false });
  seg(p, b0.F, b1.F).fill(BASALT, { mode: 'flat', tone: 4, inner: false, alpha: 200 });
  seg(p, b1.L, b1.F).fill(BASALT, { mode: 'flat', tone: 3, inner: false });
  // carved grooves (the glow layer lights them)
  for (const q of obeliskRunes()) p.px(q.x, q.y, 0x08070c);
  // chips and a crack down the dark face
  p.line(b0.R.x - 3, b0.R.y - 6, b0.R.x - 4, b0.R.y - 14).line(b0.R.x - 4, b0.R.y - 14, b0.R.x - 2.5, b0.R.y - 19).fill(DARK, { mode: 'flat', tone: 0, inner: false });
  p.ellipse(b0.L.x + 3, b0.L.y + 1, 2.4, 1.2).fill(MOSS, { mode: 'sphere', dither: true, inner: false });
}

function bonePillarDraw(p: Painter): void {
  shadow(p, 15, 65, 13, 5, 90);
  // scattered bones round the foot
  p.capsule(3, 66, 10, 68, 1).capsule(20, 68, 27, 65, 1).capsule(6, 63, 2, 61, 0.9).fill(OLDBONE, { mode: 'cyl' });
  for (const [x, y] of [[3, 66], [10, 68], [20, 68], [27, 65]] as const) p.circle(x, y, 1.5);
  p.fill(OLDBONE, { mode: 'sphere' });
  // dark packed core, a little wider at the foot
  p.poly([4, 65, 26, 65, 22.5, 15, 7.5, 15]).fill(R(0x0a0706, 0x16100c, 0x221812, 0x2e2118), { mode: 'cyl', inner: false });
  const halfW = (y: number): number => 10.5 - (64 - y) * 0.06;
  // long-bone courses: staggered femurs of uneven length with knobbed ends
  [61.5, 52, 42.5, 33, 24.5].forEach((y, j) => {
    const hw = halfW(y);
    const bones: [number, number, number][] = j % 2
      ? [[15 - hw, 15 + hw * 0.35, y - 1.2], [15 - hw * 0.25, 15 + hw, y + 1.2]]
      : [[15 - hw * 0.4, 15 + hw, y - 1.2], [15 - hw, 15 + hw * 0.2, y + 1.2]];
    for (const [x0, x1, by] of bones) p.capsule(x0 + 1, by, x1 - 1, by, 1.2);
    p.fill(OLDBONE, { mode: 'cyl', light: -0.15 });
    for (const [x0, x1, by] of bones) p.circle(x0 + 0.8, by - 0.3, 1.4).circle(x0 + 0.8, by + 0.6, 1.2).circle(x1 - 0.8, by - 0.3, 1.4).circle(x1 - 0.8, by + 0.6, 1.2);
    p.fill(OLDBONE, { mode: 'sphere', light: 0.05 });
  });
  // skull courses between them, peering out of the dark
  const rows: [number, number][] = [[57, 3], [47.5, 3], [38, 3], [28.5, 2], [19.5, 2]];
  rows.forEach(([y, n], j) => {
    const sp = n === 3 ? 6.2 : 6.6;
    for (let k = 0; k < n; k++) skull(p, 15 + (k - (n - 1) / 2) * sp + (j % 2 ? 0.5 : -0.5), y - 1, 1.08, OLDBONE, ((k + j) % 3) - 1);
  });
  // crowning skull with a tallow stub
  p.capsule(9, 15.5, 21, 15.5, 1).fill(OLDBONE, { mode: 'cyl' });
  skull(p, 15, 12, 1.2, OLDBONE, 0);
  candleBody(p, 15, 9, 4);
  p.px(14, 9, WAX[3] as number).px(13, 10, WAX[2] as number).px(16, 9, WAX[2] as number);
  p.px(15, 5, 0x1a1210);
}

/** Stalagmite rock column as stacked lumpy ellipses. */
function spire(p: Painter, cx: number, by: number, n: number, r0: number, seed: number): void {
  const r = rng(seed);
  for (let k = 0; k < n; k++) {
    const t = k / n;
    const rr = r0 * Math.pow(1 - t, 0.85) + 0.8;
    const x = cx + Math.sin(k * 1.3 + seed) * 1.1 * (1 - t) + t * 1.5;
    p.ellipse(x, by - k * 2.2, rr, rr * 0.7 + 0.8);
    if (r() < 0.35 && rr > 2) p.ellipse(x + (r() < 0.5 ? -rr : rr) * 0.8, by - k * 2.2, 1.6, 1.4);
  }
}

function stalagmiteDraw(p: Painter): void {
  shadow(p, 15, 43, 13, 4.5, 90);
  p.ellipse(15, 43, 12, 3.6).fill(STONE, { mode: 'sphere', dither: true, light: -0.1 });
  spire(p, 15, 43, 18, 8.5, 7);
  p.fill(STONE, { mode: 'cyl', dither: true, cx: 14 });
  spire(p, 6, 45, 8, 4, 3);
  p.fill(STONE, { mode: 'cyl', dither: true });
  spire(p, 24, 45, 6, 3.4, 11);
  p.fill(STONE, { mode: 'cyl', dither: true, light: -0.1 });
  // wet sheen and drip rings
  const r = rng(19);
  for (let k = 0; k < 8; k++) p.px(11 + r() * 3, 12 + r() * 26, STONE[4] as number);
  for (const y of [20, 29]) p.line(11, y, 18, y + 0.5);
  p.fill(STONE, { mode: 'flat', tone: 1, inner: false, alpha: 170 });
  for (const [x, y] of [[9, 46], [20, 46.5], [14, 47]] as const) stone(p, x, y, 1.6, 1.1);
  shrooms(p, 7, 47, 3, 11, 0.6, 'stem');
  shrooms(p, 22, 47, 3, 17, 0.55, 'stem');
  shrooms(p, 16, 46, 2, 23, 0.45, 'stem');
}

function stalagmiteGlow(p: Painter): void {
  shrooms(p, 7, 47, 3, 11, 0.6, 'cap');
  shrooms(p, 22, 47, 3, 17, 0.55, 'cap', MAGENTA);
  shrooms(p, 16, 46, 2, 23, 0.45, 'cap');
  for (const [x, y] of [[12, 33], [18, 25], [10, 40]] as const) p.gpx(x, y, TEAL[3] as number, TEAL[2] as number);
}

function masonryDraw(p: Painter, v: number): void {
  shadow(p, 18, 17, 16, 5.5, 90);
  const r = rng(401 + v * 17);
  for (let k = 0; k < 9; k++) stone(p, 4 + r() * 28, 20 + r() * 7, 1.2 + r() * 1.4, 1 + r(), STONE, 0.1);
  /** Upright broken column stump (fluted, jagged top) standing on the floor at (cx, by). */
  const stump = (cx: number, by: number, rr: number, hgt: number): void => {
    const top = by - hgt;
    p.ellipse(cx, by, rr, rr * 0.42).rect(cx - rr, top, rr * 2, hgt);
    p.poly([cx - rr, top, cx - rr * 0.4, top - 3, cx + rr * 0.1, top - 1, cx + rr * 0.6, top - 4, cx + rr, top - 1.5, cx + rr, top + 1, cx - rr, top + 1]);
    p.fill(STATUE, { mode: 'cyl', dither: true });
    for (const dx of [-0.55, -0.1, 0.35, 0.75]) p.line(cx + dx * rr, top + 2, cx + dx * rr, by - 1);
    p.fill(STATUE, { mode: 'flat', tone: 1, inner: false, alpha: 150 });
    p.poly([cx - rr + 1, top + 0.5, cx - rr * 0.4, top - 2, cx + rr * 0.1, top, cx + rr * 0.6, top - 3, cx + rr - 1, top - 0.5, cx, top + 2]).fill(STATUE, { mode: 'emboss', light: 0.45, inner: false });
  };
  if (v === 0) {
    // a broken column stump behind two fallen blocks, a third toppled across them
    stump(10, 17, 5, 11);
    block(p, 14, 26, 10, 8, 7);
    block(p, 28, 24, 7, 7, 6);
    const c = block(p, 22, 19, 8, 7, 6);
    seg(p, onL(c, 0.4, 0), onL(c, 0.55, 6)).fill(DARK, { mode: 'flat', tone: 0, inner: false });
  } else {
    // a fallen ionic capital: round echinus under a square abacus with scrolled volutes, a block and chips
    p.ellipse(15, 22, 7.5, 3.4).rect(7.5, 17, 15, 5).fill(STATUE, { mode: 'cyl', dither: true });
    p.line(8, 20, 22, 20).fill(STATUE, { mode: 'flat', tone: 1, inner: false });
    const ab = isoBox(p, 15, 19, 9, 9, 3, STATUE, { dither: true, tl: 0.45 });
    for (const s of [0.12, 0.88]) {
      const q = onL(ab, s, 0.5);
      p.circle(q.x, q.y + 1.5, 2.3).fill(STATUE, { mode: 'sphere', light: 0.2 });
      p.px(q.x, q.y + 1.5, STATUE[0] as number).px(q.x + 1, q.y + 1.5, STATUE[1] as number).px(q.x, q.y + 2.5, STATUE[1] as number);
    }
    const qr = onR(ab, 0.75, 0.5);
    p.circle(qr.x, qr.y + 1.5, 2).fill(STATUE, { mode: 'sphere', light: -0.3 });
    // the broken corner and its chunk
    const bc = onTop(ab, 0.95, 0.9);
    p.poly([bc.x - 3, bc.y, bc.x + 1, bc.y - 1, bc.x + 2, bc.y + 3]).fill(DARK, { mode: 'flat', tone: 1, inner: false });
    block(p, 29, 25, 5, 5, 5);
    block(p, 7, 25, 4, 4, 3, STATUE);
  }
  for (let k = 0; k < 10; k++) p.px(5 + r() * 26, 21 + r() * 6, ASH[3] as number, 180);
}

function bellPostDraw(p: Painter): void {
  shadow(p, 14, 67, 12, 4.5, 90);
  block(p, 14, 71, 10, 10, 4);
  const post = isoBox(p, 14, 65, 6, 6, 56, OLDWOOD, { dither: true });
  // grain, then iron bands with rivets
  for (const s of [0.35, 0.7]) seg(p, onL(post, s, 4), onL(post, s, 46));
  p.fill(OLDWOOD, { mode: 'flat', tone: 1, inner: false, alpha: 170 });
  for (const z of [6, 28, 47]) {
    for (const dz of [0, 1]) {
      seg(p, onL(post, 0, z + dz), onL(post, 1, z + dz));
      seg(p, onR(post, 0, z + dz), onR(post, 1, z + dz));
    }
    p.fill(IRON, { mode: 'flat', tone: 2, inner: false });
    p.px(onL(post, 0.5, z).x, onL(post, 0.5, z).y - 0.5, RIVET).px(onR(post, 0.5, z).x, onR(post, 0.5, z).y - 0.5, IRON[3] as number);
  }
  // iron cap
  const t = onTop(post, 0.5, 0.5);
  p.poly([t.x - 7, t.y, t.x, t.y + 3.5, t.x + 7, t.y, t.x, t.y - 6]).fill(IRON, { mode: 'facet', facets: 4, rot: 0.8 });
  // brace under the stub
  const z0 = 50;
  const pc = { x: 14, y: 62 - z0 };
  const LB = { x: pc.x + 1, y: pc.y + 2.5 };
  p.capsule(onR(post, 0.5, 34).x, onR(post, 0.5, 34).y, LB.x + 7, LB.y + 4.5, 1.1, 0.9).fill(WOOD, { mode: 'cyl' });
  // broken crossbeam stub poking out toward +x, splintered end
  const beam = isoBox(p, LB.x + 13, LB.y + 6.5, 12, 4, 5, WOOD, { dither: true, tl: 0.35 });
  seg(p, onL(beam, 0.1, 2.5), onL(beam, 0.9, 2.5)).fill(WOOD, { mode: 'flat', tone: 1, inner: false, alpha: 170 });
  const e = beam.F;
  p.poly([e.x, e.y - 5, e.x + 2, e.y - 4, e.x + 1, e.y - 3, e.x + 3, e.y - 2, e.x + 1, e.y - 1, e.x + 2, e.y + 0.5, e.x, e.y]).fill(WOOD, { mode: 'emboss', light: 0.25 });
  p.px(e.x + 2, e.y - 4, WOOD[4] as number).px(e.x + 3, e.y - 2, WOOD[4] as number);
  // chain hanging from the stub, the bell long gone
  const h0 = onL(beam, 0.25, 0);
  for (let k = 0; k < 7; k++) {
    const y = h0.y + 1.5 + k * 2.4;
    if (k % 2) p.ellipse(h0.x, y, 1.5, 0.9);
    else p.ellipse(h0.x, y, 0.8, 1.5);
  }
  p.fill(IRON, { mode: 'sphere', light: 0.1 });
  const hy = h0.y + 1.5 + 7 * 2.4;
  p.ellipse(h0.x, hy + 1, 2, 2.4).minus().ellipse(h0.x + 0.6, hy + 0.6, 1, 1.4).minus().rect(h0.x, hy + 1.5, 3, 3).plus().fill(RUST, { mode: 'emboss', light: 0.2 });
  // bell rope frayed round the base
  p.capsule(5, 69, 11, 70.5, 0.8).capsule(11, 70.5, 9, 72, 0.7).fill(ROPE, { mode: 'cyl' });
}

// brazier column geometry
const BC = { cx: 13, bowlY: 17 };

function brazierColumnDraw(p: Painter): void {
  shadow(p, 13, 53, 12, 4.5, 90);
  block(p, 13, 58, 12, 12, 4);
  const cx = BC.cx;
  p.ellipse(cx, 47.5, 5.6, 2.2).rect(cx - 5.5, 27, 11, 21).fill(STONE, { mode: 'cyl', dither: true });
  for (const dx of [-3, -0.5, 2, 4.5]) p.line(cx + dx, 29, cx + dx, 46);
  p.fill(STONE, { mode: 'flat', tone: 1, inner: false, alpha: 150 });
  p.ellipse(cx, 47, 6.6, 2.2).minus().ellipse(cx, 45.8, 5.6, 1.6).fill(STONE, { mode: 'emboss', light: 0.15, inner: false });
  // capital
  p.ellipse(cx, 27, 7.4, 2.6).rect(cx - 7.4, 23.5, 14.8, 3.5).fill(STONE, { mode: 'cyl' });
  p.ellipse(cx, 23.5, 8.2, 2.8).fill(STONE, { mode: 'emboss', light: 0.35 });
  // the fire bowl
  p.ellipse(cx, BC.bowlY + 1, 11, 6).minus().rect(0, 0, 26, BC.bowlY + 1).plus().fill(IRON, { mode: 'sphere', dither: true, light: 0.05 });
  p.ellipse(cx, BC.bowlY, 11, 3.2).minus().ellipse(cx, BC.bowlY - 0.2, 9.2, 2.2).fill(BRONZE, { mode: 'emboss', light: 0.15, inner: false });
  p.ellipse(cx, BC.bowlY - 0.2, 9.2, 2.2).fill(R(0x0a0606, 0x1a0e0a, 0x2a160e, 0x3a2012), { mode: 'flat', tone: 1, inner: false });
  for (const dx of [-8, -4, 0, 4, 8]) p.px(cx + dx, BC.bowlY + 4 - Math.abs(dx) * 0.25, RIVET);
  // scorch on the capital
  p.ellipse(cx + 1, 22, 4, 1).fill(ASH, { mode: 'flat', tone: 0, inner: false, alpha: 160 });
}

function brazierColumnGlow(p: Painter, i: number): void {
  const cx = BC.cx, by = BC.bowlY;
  coals(p, cx, by - 0.3, 8.5, 1.8, 31 + i, 16);
  const sw = [0, 1, -1][i] as number;
  const hs = [12, 15, 13][i] as number;
  fire(p, cx - 4.5, by, hs * 0.6, 2.8, -sw);
  fire(p, cx + 4.5, by, hs * 0.7, 2.8, sw);
  fire(p, cx, by, hs, 4, sw * 1.4);
}

// furnace geometry
const FU = { F: { x: 17, y: 43 }, s: 14, h: 18 };
/** Furnace mouth: front-facing arch (u across, v up) mapped onto the lit left face around m. */
function mouthPx(m: Pt, fn: (x: number, y: number, u: number, v: number) => void): void {
  for (let v = 0; v <= 10; v++) for (let u = -4; u <= 4; u++) {
    const inside = v <= 6 || u * u + (v - 6) * (v - 6) <= 17;
    if (inside) fn(Math.round(m.x + u), Math.round(m.y - v + u * 0.5), u, v);
  }
}

function furnaceDraw(p: Painter): void {
  shadow(p, 17, 37, 15, 5, 95);
  const b = isoBox(p, FU.F.x, FU.F.y, FU.s, FU.s, FU.h, STONE, { dither: true, top: ASH, tl: 0.25 });
  // brick courses
  for (let row = 1; row < 4; row++) {
    const z = row * 4.5;
    seg(p, onL(b, 0, z), onL(b, 1, z));
    seg(p, onR(b, 0, z), onR(b, 1, z));
    for (let s = (row % 2) * 0.12 + 0.1; s < 1; s += 0.24) {
      seg(p, onL(b, s, z), onL(b, s, z + 4.5));
      seg(p, onR(b, s, z), onR(b, s, z + 4.5));
    }
  }
  p.fill(STONE, { mode: 'flat', tone: 1, inner: false, alpha: 170 });
  // the arched mouth with a soot-black surround and voussoir highlights
  const m = onL(b, 0.5, 1);
  mouthPx(m, (x, y) => p.px(x, y, 0x0a0505));
  for (let k = 0; k <= 6; k++) {
    const a = Math.PI + (k / 6) * Math.PI;
    const u = Math.cos(a) * 5.4, v = 6 - Math.sin(a) * 5.4;
    p.px(m.x + u, m.y - v + u * 0.5, STONE[k % 2 ? 4 : 3] as number);
  }
  p.ellipse(m.x, m.y - 12, 5, 2).fill(DARK, { mode: 'flat', tone: 2, inner: false, alpha: 150 });
  // iron lintel bar across the mouth
  p.line(m.x - 6, m.y - 1 - 3, m.x + 6, m.y - 1 + 3).fill(IRON, { mode: 'flat', tone: 2, inner: false });
  // chimney at the back of the top
  const cc = onTop(b, 0.62, 0.62);
  const ch = isoBox(p, cc.x, cc.y + 3, 6, 6, 11, STONE, { dither: true, top: DARK });
  for (const z of [3.5, 7]) seg(p, onL(ch, 0, z), onL(ch, 1, z));
  p.fill(STONE, { mode: 'flat', tone: 1, inner: false, alpha: 170 });
  const rim = isoBox(p, cc.x, cc.y + 3 - 10, 7, 7, 1.5, STONE, { top: DARK, tl: 0 });
  p.px(onTop(rim, 0.5, 0.5).x, onTop(rim, 0.5, 0.5).y, 0x2a160e);
  // ash and clinker spilling out onto the floor
  p.ellipse(m.x - 2, m.y + 5, 4, 1.3).fill(ASH, { mode: 'sphere', dither: true });
  p.px(m.x - 4, m.y + 5, ASH[4] as number).px(m.x, m.y + 6, LAVA[0] as number);
}

function furnaceGlow(p: Painter, i: number): void {
  const m = onL({ F: FU.F, L: { x: FU.F.x - FU.s, y: FU.F.y - FU.s / 2 }, R: FU.F, B: FU.F, h: FU.h }, 0.5, 1);
  mouthPx(m, (x, y, u, v) => {
    const n = (u * 7 + v * 13 + i * 5) % 9;
    const lick = v < 3 + ((u + i) % 3 === 0 ? 3 : 0) + (Math.abs(u) < 2 ? 2 : 0);
    if (v <= 1) p.gpx(x, y, (n < 4 ? LAVA[4] : LAVA[3]) as number, LAVA[2] as number);
    else if (lick) p.gpx(x, y, (v < 4 ? FLAME[3] : FLAME[2]) as number, FLAME[1] as number);
    else if (n < 2) p.gpx(x, y, LAVA[1] as number, LAVA[0] as number);
  });
}

// ---------------------------------------------------------------- cosmetic floor pieces

function readingTableDraw(p: Painter): void {
  shadow(p, 17, 23, 14, 4, 90);
  for (const [x, y] of [[20, 27], [4, 19], [31, 21.5]] as const) p.rect(x - 1, y - 9, 2, 9);
  p.fill(WOOD, { mode: 'cyl' });
  const b = isoBox(p, 20, 18, 16, 11, 2, WOOD, { dither: true, tl: 0.35 });
  for (const s of [0.33, 0.66]) seg(p, onTop(b, s, 0.03), onTop(b, s, 0.97));
  p.fill(WOOD, { mode: 'flat', tone: 2, inner: false });
  // open tome lying along the table
  p.poly([6, 10, 12, 7, 15, 8.5, 9, 11.5]).fill(PAPER, { mode: 'emboss', light: 0.55 });
  p.poly([9, 11.5, 15, 8.5, 18, 10, 12, 13]).fill(PAPER, { mode: 'emboss', light: 0.4 });
  p.line(9, 11.5, 15, 8.5).fill(PAPER, { mode: 'flat', tone: 0, inner: false });
  p.line(8, 10, 11, 8.5).line(9, 10.5, 12, 9).line(12, 11.5, 15, 10).line(13, 12, 16, 10.5).fill(PAPER, { mode: 'flat', tone: 0, inner: false, alpha: 170 });
  p.poly([5.5, 10.2, 9, 12, 12, 13.5, 12, 14, 8.5, 12.4, 5.5, 10.8]).fill(RED, { mode: 'emboss', light: -0.1 });
  // inkpot and quill
  p.rect(18, 10, 3, 3).fill(BLUE, { mode: 'cyl' });
  p.ellipse(19.5, 10, 1.5, 0.6).fill(DARK, { mode: 'flat', tone: 0, inner: false });
  p.line(19, 10, 22, 3).fill(PAPER, { mode: 'flat', tone: 3, inner: false });
  p.line(20, 7, 21, 7).line(21, 5, 22, 5).px(22, 3, PAPER[4] as number).fill(PAPER, { mode: 'flat', tone: 2, inner: false });
  // candle in a drip dish
  p.ellipse(26, 12, 2.6, 1).fill(BRASS, { mode: 'emboss', light: 0.2 });
  candleBody(p, 26, 12, 5);
  p.px(25, 8, WAX[3] as number).px(27, 10, WAX[3] as number).px(27, 11, WAX[2] as number);
  p.px(26, 6, 0x1a1210);
}

function chestGoldDraw(p: Painter): void {
  shadow(p, 14, 21, 11, 3.5, 90);
  const b = isoBox(p, 16, 23, 12, 9, 7, WOOD, { dither: true, top: GOLD, tl: 0.1 });
  for (const s of [0.15, 0.85]) seg(p, onL(b, s, 0), onL(b, s, 7));
  seg(p, onR(b, 0.5, 0), onR(b, 0.5, 7));
  p.fill(IRON, { mode: 'flat', tone: 2, inner: false });
  for (const s of [0.15, 0.85]) p.px(onL(b, s, 3.5).x, onL(b, s, 3.5).y, RIVET);
  const lk = onL(b, 0.5, 5);
  p.rect(lk.x - 1, lk.y - 1, 2, 2.5).fill(BRASS, { mode: 'flat', tone: 3, inner: false });
  // lid flung back
  const r0 = { x: b.R.x, y: b.R.y - 7 }, b0 = { x: b.B.x, y: b.B.y - 7 };
  p.poly([r0.x, r0.y, b0.x, b0.y, b0.x + 2, b0.y - 9, r0.x + 2, r0.y - 9]).fill(WOOD, { mode: 'emboss', dither: true, light: -0.1 });
  p.line(r0.x + 1, r0.y - 4, b0.x + 1, b0.y - 4).fill(IRON, { mode: 'flat', tone: 2, inner: false });
  // heaped gold over the rim
  const c = onTop(b, 0.5, 0.5);
  p.ellipse(c.x, c.y - 1, 8.5, 3.6).ellipse(c.x - 1, c.y - 3, 5, 2.4).fill(GOLD, { mode: 'sphere', dither: true, light: 0.05 });
  coinScatter(p, c.x - 1, c.y - 2, 7, 2.6, 9, 41);
  p.px(c.x + 2, c.y - 3, RED[4] as number).px(c.x + 3, c.y - 3, RED[3] as number).px(c.x - 4, c.y - 1, BLUE[4] as number);
  // a goblet in the hoard and coins spilled at the front
  p.rect(c.x + 3.5, c.y - 7, 3, 2.5).fill(GOLD, { mode: 'cyl', light: 0.1 });
  p.line(c.x + 5, c.y - 5, c.x + 5, c.y - 3).fill(GOLD, { mode: 'flat', tone: 2, inner: false });
  coinScatter(p, 7, 23, 5, 1.6, 4, 43);
  coinScatter(p, 21, 25, 3, 1, 2, 47);
}

function coinHeapDraw(p: Painter, v: number): void {
  const mound = (x: number, y: number, rx: number, ry: number, hy: number, seed: number): void => {
    p.ellipse(x, y, rx, ry).ellipse(x, y - hy, rx * 0.55, ry * 0.8).fill(GOLD, { mode: 'sphere', dither: true });
    coinScatter(p, x, y - hy * 0.6, rx * 0.8, ry * 0.8 + hy * 0.4, Math.round(rx * 1.4), seed);
  };
  if (v === 0) {
    mound(14, 9, 8, 3.4, 2.5, 51);
    coinScatter(p, 15, 10, 13, 4, 10, 53);
    // a short stack of coins
    for (let k = 0; k < 3; k++) p.ellipse(24, 10 - k * 1.2, 2, 0.9).fill(GOLD, { mode: 'emboss', light: 0.2 - k * 0.05 });
  } else {
    mound(9, 9, 5.5, 2.6, 1.8, 57);
    mound(20, 8, 4.5, 2.2, 1.5, 59);
    coinScatter(p, 15, 10, 12, 4, 8, 61);
    // toppled goblet with a gem
    p.poly([18, 13, 23, 11, 24, 13, 19, 15]).fill(GOLD, { mode: 'cyl' });
    p.ellipse(24, 12, 1, 1.4).fill(GOLD, { mode: 'emboss', light: 0.3 });
    p.capsule(17, 14, 15.5, 14.5, 0.6).fill(GOLD, { mode: 'cyl' });
    p.px(21, 12, RED[4] as number).px(5, 11, GREEN[4] as number);
  }
}

function cotDraw(p: Painter): void {
  const frame = isoBox(p, 25, 17, 21, 9, 4, WOOD, { dither: true, tl: 0.2 });
  for (const s of [0.02, 0.98]) p.px(onL(frame, s, 2).x, onL(frame, s, 2).y, WOOD[1] as number);
  // straw mattress, a rough blanket over the foot, a rolled pillow at the head
  const m = isoBox(p, onTop(frame, 0.04, 0.08).x, onTop(frame, 0.04, 0.08).y, 19, 7.5, 2, STRAW, { dither: true, ll: 0.1 });
  const b0 = onTop(m, 0, 0), b1 = onTop(m, 0.55, 0), b2 = onTop(m, 0.55, 1), b3 = onTop(m, 0, 1);
  p.poly([b0.x, b0.y + 2, b1.x, b1.y + 2, b1.x, b1.y - 0.5, b2.x, b2.y - 0.5, b3.x, b3.y, b0.x, b0.y]).fill(BLUE, { mode: 'emboss', dither: true, light: 0.05 });
  seg(p, onTop(m, 0.53, 0.05), onTop(m, 0.53, 0.95)).fill(BLUE, { mode: 'flat', tone: 3, inner: false });
  seg(p, onTop(m, 0.2, 0.1), onTop(m, 0.2, 0.9)).fill(BLUE, { mode: 'flat', tone: 1, inner: false });
  const h0 = onTop(m, 0.86, 0.12), h1 = onTop(m, 0.86, 0.88);
  p.capsule(h0.x, h0.y - 1, h1.x, h1.y - 1, 1.8).fill(CANVAS, { mode: 'cyl' });
  for (const [x, y] of [[3, 15], [33, 15], [7, 17]] as const) p.px(x, y, STRAW[3] as number).px(x + 1, y, STRAW[2] as number);
}

function armorStandDraw(p: Painter): void {
  shadow(p, 11, 40.5, 8, 2.5, 85);
  p.capsule(5, 37, 17, 43, 1).capsule(17, 37, 5, 43, 1).fill(OLDWOOD, { mode: 'cyl' });
  p.rect(10, 8, 2, 32).fill(WOOD, { mode: 'cyl' });
  p.capsule(3, 16, 19, 16, 1).fill(WOOD, { mode: 'cyl' });
  // red tabard under the plate
  p.poly([7.5, 26, 14.5, 26, 15, 37, 11, 35, 7, 37]).fill(RED, { mode: 'cyl', dither: true });
  p.line(11, 27, 11, 34).fill(GOLD, { mode: 'flat', tone: 2, inner: false });
  // cuirass, faulds, pauldrons
  p.poly([5, 16.5, 17, 16.5, 16, 26, 13, 29, 9, 29, 6, 26]).fill(IRON, { mode: 'cyl', light: 0.1 });
  p.line(11, 18, 11, 28).fill(IRON, { mode: 'flat', tone: 4, inner: false });
  p.line(6.5, 22, 15.5, 22).fill(IRON, { mode: 'flat', tone: 1, inner: false });
  for (const [x, y] of [[7, 18], [15, 18], [8, 27], [14, 27]] as const) p.px(x, y, BRASS[3] as number);
  for (let k = 0; k < 2; k++) p.rect(7.5 + k * 0.5, 29 + k * 2, 7 - k, 2);
  p.fill(IRON, { mode: 'emboss', light: 0.1 });
  p.ellipse(4.5, 17.5, 3, 2.4).ellipse(17.5, 17.5, 3, 2.4).fill(IRON, { mode: 'sphere', light: 0.15 });
  // great helm on the pole top with a short crest
  p.capsule(11, 4, 15, 2, 0.9).fill(RED, { mode: 'cyl' });
  p.rect(7.5, 6, 7, 8).ellipse(11, 6, 3.5, 2.4).fill(IRON, { mode: 'cyl', light: 0.05 });
  p.line(8.5, 9.5, 13.5, 9.5).fill(DARK, { mode: 'flat', tone: 0, inner: false });
  p.line(11, 5, 11, 13).fill(IRON, { mode: 'flat', tone: 4, inner: false });
  p.px(12.5, 11.5, IRON[0] as number).px(13.5, 11.5, IRON[0] as number);
}

function weaponBarrelDraw(p: Painter): void {
  shadow(p, 11, 33, 9, 2.8, 90);
  barrelBody(p, 11, 34, 8, 17, WOOD);
  p.ellipse(11, 17.5, 7, 2.6).fill(DARK, { mode: 'flat', tone: 1, inner: false });
  // spear, sword hilt, axe and a second spear rising out of the barrel
  p.capsule(7, 18, 3.5, 6, 0.7).fill(WOOD, { mode: 'cyl' });
  p.poly([2.8, 7, 4.6, 7.5, 3.2, 1]).fill(STEEL, { mode: 'facet', facets: 3 });
  p.capsule(10, 18, 9, 9, 0.6).fill(OLDWOOD, { mode: 'cyl' });
  p.poly([8, 10, 10, 10, 9.3, 5.5]).fill(IRON, { mode: 'facet', facets: 3 });
  p.capsule(13, 18, 13.6, 11, 0.9).fill(STEEL, { mode: 'cyl' });
  p.capsule(10.5, 11, 16.5, 10.2, 0.8).fill(BRASS, { mode: 'cyl' });
  p.capsule(13.7, 10, 14.2, 6, 0.7).fill(LEATHER, { mode: 'cyl' });
  p.circle(14.3, 5.5, 1.2).fill(BRASS, { mode: 'sphere' });
  p.capsule(16, 18, 18.5, 7, 0.7).fill(WOOD, { mode: 'cyl' });
  p.poly([17.2, 6, 21, 4, 21.5, 10.5, 18.2, 9]).fill(IRON, { mode: 'emboss', light: 0.25 });
  p.line(21, 4.5, 21.3, 10).fill(STEEL, { mode: 'flat', tone: 3, inner: false });
  // front lip of the barrel over the hafts
  p.ellipse(11, 17.6, 8.2, 3).minus().ellipse(11, 16.9, 7.2, 2.6).fill(WOOD, { mode: 'emboss', light: 0.3, inner: false });
}

const BG = { cx: 17, bowlY: 18 };
function brazierGreatDraw(p: Painter): void {
  shadow(p, 17, 46.5, 12, 3.5, 90);
  p.capsule(15, 24, 6, 45, 1.5, 1).capsule(19, 24, 28, 45, 1.5, 1).capsule(17, 26, 17, 47, 1.5, 1).fill(IRON, { mode: 'cyl' });
  for (const [x, y] of [[6, 45.5], [28, 45.5], [17, 47.5]] as const) p.ellipse(x, y, 2.2, 1.2);
  p.fill(BRONZE, { mode: 'sphere' });
  p.ellipse(17, 36, 7, 2.4).minus().ellipse(17, 35.6, 5.6, 1.4).fill(IRON, { mode: 'emboss', light: 0.2, inner: false });
  // deep bowl with a bronze rim
  p.ellipse(17, BG.bowlY + 1, 14, 8).minus().rect(0, 0, 34, BG.bowlY + 1).plus().fill(IRON, { mode: 'sphere', dither: true, light: 0.05 });
  p.ellipse(17, BG.bowlY + 9, 3, 1.6).fill(BRONZE, { mode: 'sphere' });
  for (const dx of [-10, -5, 0, 5, 10]) p.px(17 + dx, BG.bowlY + 5 - Math.abs(dx) * 0.2, BRONZE[3] as number);
  p.ellipse(17, BG.bowlY, 14, 4).minus().ellipse(17, BG.bowlY - 0.3, 12, 2.9).fill(BRONZE, { mode: 'emboss', light: 0.2, inner: false });
  p.ellipse(17, BG.bowlY - 0.3, 12, 2.9).fill(R(0x0a0606, 0x1a0e0a, 0x2a160e, 0x3a2012), { mode: 'flat', tone: 1, inner: false });
  // rim teeth
  for (const dx of [-13, -7, 7, 13]) p.poly([17 + dx - 1, BG.bowlY - 0.5, 17 + dx + 1, BG.bowlY - 0.5, 17 + dx, BG.bowlY - 3]);
  p.fill(BRONZE, { mode: 'emboss', light: 0.3 });
}

function brazierGreatGlow(p: Painter, i: number): void {
  const cx = BG.cx, by = BG.bowlY;
  coals(p, cx, by - 0.3, 11, 2.4, 71 + i, 22);
  const sw = [0, 1, -1][i] as number;
  const hs = [14, 17, 15][i] as number;
  fire(p, cx - 7, by, hs * 0.55, 3, -sw);
  fire(p, cx + 7, by, hs * 0.6, 3, sw);
  fire(p, cx - 3, by, hs * 0.8, 3.4, -sw * 0.5);
  fire(p, cx + 3, by, hs * 0.75, 3.4, sw);
  fire(p, cx, by, hs, 4.4, sw * 1.4);
}

function candleStandDraw(p: Painter): void {
  shadow(p, 8, 41.5, 5, 1.6, 85);
  p.capsule(8, 38, 3, 42, 0.8).capsule(8, 38, 13, 42, 0.8).capsule(8, 38, 8, 43, 0.8).fill(IRON, { mode: 'cyl' });
  p.rect(7, 14, 2, 25).fill(IRON, { mode: 'cyl' });
  p.ellipse(8, 28, 1.8, 1.1).ellipse(8, 37, 1.6, 1).fill(IRON, { mode: 'sphere' });
  p.capsule(3, 16, 13, 16, 0.8).capsule(3, 16, 3, 13.5, 0.7).capsule(13, 16, 13, 13.5, 0.7).fill(IRON, { mode: 'cyl' });
  p.rect(7, 10, 2, 5).fill(IRON, { mode: 'cyl' });
  for (const [x, y] of [[3, 13], [13, 13], [8, 10]] as const) p.ellipse(x, y, 2.2, 0.9);
  p.fill(BRASS, { mode: 'emboss', light: 0.2 });
  for (const [x, by, h] of [[3, 13, 5], [8, 10, 7], [13, 13, 4]] as const) {
    candleBody(p, x, by, h);
    p.px(x - 2, by, WAX[2] as number).px(x + 1, by - 1, WAX[3] as number).px(x - 1, by - h + 2, WAX[4] as number);
    p.px(x, by - h, 0x1a1210);
  }
  // wax run down the shaft
  p.rect(9, 17, 1, 3).fill(WAX, { mode: 'flat', tone: 3, inner: false });
}

function wellDraw(p: Painter): void {
  shadow(p, 19, 34, 17, 6.5, 90);
  p.ellipse(19, 33, 14, 7).rect(5, 24, 28, 9).fill(STONE, { mode: 'cyl', dither: true });
  // stone courses following the curve, staggered joints
  for (let row = 0; row < 3; row++) {
    const y0 = 26.5 + row * 3;
    for (let x = 5; x <= 33; x++) {
      const dx = (x - 19) / 14;
      const yy = y0 + 7 * Math.sqrt(Math.max(0, 1 - dx * dx)) - 1;
      p.dot(x, yy);
      if ((x + row * 3) % 6 === 0 && row < 2) p.dot(x, yy + 1).dot(x, yy + 2);
    }
  }
  p.fill(STONE, { mode: 'flat', tone: 1, inner: false, alpha: 190 });
  // rim, dark shaft, water
  p.ellipse(19, 24, 14, 7).minus().ellipse(19, 24.5, 10.5, 4.6).fill(STONE, { mode: 'emboss', light: 0.3, inner: false });
  p.ellipse(19, 24.5, 10.5, 4.6).fill(DARK, { mode: 'flat', tone: 1, inner: false });
  p.ellipse(19, 26.2, 8, 2.8).fill(WATER, { mode: 'flat', tone: 2, inner: false });
  p.px(16, 26, WATER[4] as number).px(17, 26, WATER[3] as number).px(22, 27, WATER[3] as number);
  p.ellipse(10, 26, 2.2, 1.2).ellipse(28, 21, 1.6, 1).fill(MOSS, { mode: 'sphere', dither: true, inner: false });
  // winch frame: posts on the rim, roller with rope, a bucket hanging over the water
  p.rect(4, 5, 3, 22).rect(31, 5, 3, 22).fill(OLDWOOD, { mode: 'cyl', dither: true });
  for (const x of [5.5, 32.5]) p.poly([x - 2.5, 5.5, x, 2.5, x + 2.5, 5.5]);
  p.fill(OLDWOOD, { mode: 'emboss', light: 0.3 });
  p.capsule(6, 9, 32, 9, 1.6).fill(WOOD, { mode: 'cyl' });
  p.rect(15, 7, 8, 4).fill(ROPE, { mode: 'cyl' });
  for (const x of [16, 18, 20, 22]) p.line(x, 7, x - 1, 10.5);
  p.fill(ROPE, { mode: 'flat', tone: 1, inner: false });
  p.line(19, 11, 19, 17).fill(ROPE, { mode: 'flat', tone: 3, inner: false });
  p.line(16.5, 18, 19, 16).line(19, 16, 21.5, 18).fill(IRON, { mode: 'flat', tone: 2, inner: false });
  p.ellipse(19, 21.5, 3, 1.1).rect(16, 18, 6, 3.5).fill(WOOD, { mode: 'cyl' });
  p.rect(15.8, 19, 6.4, 1).fill(IRON, { mode: 'flat', tone: 2, inner: false });
  p.ellipse(19, 18, 3, 1).fill(WOOD, { mode: 'emboss', light: 0.3 });
  // crank on the right post
  p.capsule(34, 9, 36, 9, 0.7).capsule(36, 9, 36, 13, 0.6).fill(IRON, { mode: 'cyl' });
  p.capsule(36, 13, 37.4, 13, 0.7).fill(WOOD, { mode: 'cyl' });
}

function liliesDraw(p: Painter, v: number): void {
  const pad = (x: number, y: number, r: number, notch: number): void => {
    p.ellipse(x, y + 0.7, r, r * 0.5).fill(LILY, { mode: 'flat', tone: 0, inner: false });
    p.ellipse(x, y, r, r * 0.5).minus().poly([x, y, x + Math.cos(notch) * (r + 1) - 1, y + Math.sin(notch) * (r + 1) * 0.5, x + Math.cos(notch) * (r + 1) + 1, y + Math.sin(notch) * (r + 1) * 0.5]).plus();
    p.fill(LILY, { mode: 'sphere', dither: true, light: 0.1 });
    p.line(x, y, x - r * 0.6, y - r * 0.15).fill(LILY, { mode: 'flat', tone: 1, inner: false, alpha: 170 });
  };
  if (v === 0) {
    pad(8, 9, 5, 0.6);
    pad(18, 6, 4, 2.4);
    pad(21, 11, 3.4, -0.4);
    pad(4, 4.5, 2.6, 1.2);
    // a pale water lily on the big pad
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      p.ellipse(9 + Math.cos(a) * 1.6, 7.5 + Math.sin(a) * 0.8 - 0.5, 1.4, 1.2);
    }
    p.fill(PETAL, { mode: 'sphere', light: 0.15 });
    p.ellipse(9, 6.5, 1.1, 1.4).fill(PETAL, { mode: 'sphere', light: 0.4 });
    p.px(9, 6, GOLD[3] as number).px(8, 7, GOLD[2] as number);
  } else {
    pad(20, 10, 4.4, 2.6);
    // reed clump with cattails
    const r = rng(83);
    for (let k = 0; k < 9; k++) {
      const x = 6 + r() * 9, h = 6 + r() * 7, lean = (r() - 0.5) * 3;
      p.line(x, 13, x + lean, 13 - h);
      if (k % 3 === 0) p.capsule(x + lean, 13 - h + 1.5, x + lean * 0.95, 13 - h + 4, 0.8).fill(LEATHER, { mode: 'cyl', inner: false });
    }
    p.fill(LILY, { mode: 'flat', tone: 3, inner: false });
    for (let k = 0; k < 6; k++) p.px(5 + r() * 11, 9 + r() * 4, LILY[2] as number);
    p.ellipse(10, 13.5, 6, 1.5).fill(LILY, { mode: 'flat', tone: 1, inner: false, alpha: 160 });
  }
}

function mushroomRingDraw(p: Painter, i: number): void {
  // trampled dark grass ring under the caps
  for (let a = 0; a < Math.PI * 2; a += 0.06) p.dot(17 + Math.cos(a) * 14, 10 + Math.sin(a) * 6);
  p.fill(MOSS, { mode: 'flat', tone: 1, inner: false, alpha: 170 });
  const n = 11;
  const order: number[] = [];
  for (let k = 0; k < n; k++) order.push(k);
  // back half first so front caps overlap
  order.sort((a, b) => Math.sin((a / n) * Math.PI * 2 + 0.4) - Math.sin((b / n) * Math.PI * 2 + 0.4));
  for (const k of order) {
    const a = (k / n) * Math.PI * 2 + 0.4;
    const x = 17 + Math.cos(a) * 14, y = 10.5 + Math.sin(a) * 6;
    const h = 2 + ((k * 5) % 3);
    const ramp = k % 4 === 1 ? MAGENTA : TEAL;
    const bright = (k + i) % 3 === 0;
    p.capsule(x, y, x, y - h, 0.6, 0.5).fill(STALK, { mode: 'cyl', inner: false });
    p.ellipse(x, y - h - 0.5, 1.8 + (k % 2) * 0.6, 1.1).fill(ramp, { mode: 'sphere', glow: ramp[3] as number, light: bright ? 0.3 : 0.05, inner: false });
    if (bright) p.gpx(x - 0.6, y - h - 1, ramp[4] as number, ramp[3] as number);
  }
}

function kneelerDraw(p: Painter): void {
  const b = isoBox(p, 22, 13, 16, 6, 3, WOOD, { dither: true, tl: 0.25 });
  // book rest along the back edge
  const r0 = { x: b.R.x, y: b.R.y - 3 }, b0 = { x: b.B.x, y: b.B.y - 3 };
  p.poly([r0.x, r0.y, b0.x, b0.y, b0.x, b0.y - 4, r0.x, r0.y - 4]).fill(WOOD, { mode: 'emboss', light: 0.05 });
  p.line(r0.x, r0.y - 4, b0.x, b0.y - 4).fill(WOOD, { mode: 'flat', tone: 4, inner: false });
  // worn red cushion with tufts
  const c0 = onTop(b, 0.06, 0.12), c1 = onTop(b, 0.94, 0.12), c2 = onTop(b, 0.94, 0.8), c3 = onTop(b, 0.06, 0.8);
  p.poly([c0.x, c0.y, c1.x, c1.y, c2.x, c2.y, c3.x, c3.y]).fill(RED, { mode: 'sphere', dither: true, light: 0.1 });
  for (const s of [0.3, 0.7]) p.px(onTop(b, s, 0.45).x, onTop(b, s, 0.45).y, RED[0] as number);
  // a prayer book left on the rest
  p.poly([b0.x + 3, b0.y - 3, b0.x + 7, b0.y - 5, b0.x + 9, b0.y - 4, b0.x + 5, b0.y - 2]).fill(PAPER, { mode: 'emboss', light: 0.2 });
}

function skullPyramidDraw(p: Painter): void {
  shadow(p, 14, 22, 12, 3.4, 90);
  p.capsule(2, 23, 12, 25, 0.9).capsule(16, 25, 26, 22.5, 0.9).fill(BONE, { mode: 'cyl' });
  for (const [x, y] of [[2, 23], [12, 25], [16, 25], [26, 22.5]] as const) p.circle(x, y, 1.4);
  p.fill(BONE, { mode: 'sphere' });
  const rows: [number, number][] = [[4, 21], [3, 16], [2, 11], [1, 6]];
  for (const [n, y] of rows) for (let k = 0; k < n; k++) skull(p, 14 + (k - (n - 1) / 2) * 5.8, y - 1, 1.05, BONE, ((k * 2 + n) % 3) - 1);
  // a jawless one rolled off, dried blood on the top skull
  skull(p, 25, 18.5, 0.8, BONE, 1);
  p.px(13, 3, RED[1] as number).px(14, 3, RED[2] as number).px(14, 4, RED[1] as number);
}

function bannerPoleDraw(p: Painter, i: number): void {
  shadow(p, 10, 58.5, 7, 2.4, 85);
  block(p, 10, 61, 6, 6, 4);
  p.rect(9, 6, 2, 50).fill(WOOD, { mode: 'cyl' });
  p.rect(8.5, 51, 3, 1.4).fill(IRON, { mode: 'flat', tone: 2, inner: false });
  p.poly([8.4, 5.5, 11.6, 5.5, 10, 0.5]).fill(GOLD, { mode: 'facet', facets: 3 });
  p.rect(8.5, 5, 3, 1.5).fill(GOLD, { mode: 'cyl' });
  p.capsule(2, 9, 18, 9, 0.9).fill(WOOD, { mode: 'cyl' });
  p.circle(1.8, 9, 1.3).circle(18.2, 9, 1.3).fill(GOLD, { mode: 'sphere' });
  // the banner (bottom swings a pixel between frames)
  const sw = i === 0 ? 0 : 1;
  p.poly([3, 10, 17, 10, 17 + sw, 38, 15 + sw, 44, 10 + sw, 39, 5 + sw * 0.5, 44, 3, 38]).fill(RED, { mode: 'cyl', dither: true });
  for (const x of [7, 13]) p.line(x, 12, x + sw * 0.6, 38);
  p.fill(RED, { mode: 'flat', tone: 1, inner: false, alpha: 170 });
  // gold trim and fringe
  p.line(4, 11, 4, 38).line(16, 11, 16 + sw, 37).line(4, 12, 16, 12).fill(GOLD, { mode: 'flat', tone: 2, inner: false });
  for (const [x, y] of [[4, 39], [5, 41], [6, 43], [14 + sw, 43], [15 + sw, 41], [16 + sw, 39], [11 + sw, 39], [9 + sw, 39]] as const) p.px(x, y, GOLD[3] as number);
  // emblem: a crowned skull
  const ex = 10 + sw * 0.4;
  skull(p, ex, 26, 1, GOLD, 0);
  p.poly([ex - 3, 22, ex + 3, 22, ex + 3, 19, ex + 1.5, 20.5, ex, 18.5, ex - 1.5, 20.5, ex - 3, 19]).fill(GOLD, { mode: 'emboss', light: 0.25 });
  p.line(ex - 3.5, 32, ex + 3.5, 32).fill(GOLD, { mode: 'flat', tone: 1, inner: false });
}

// ---------------------------------------------------------------- wall fixtures

function pipeOutletDraw(p: Painter, i: number): void {
  // drawn without the outline pass so the water stays a thin translucent ribbon; the head gets a hand-drawn rim
  // thin stream falling from the spout to the floor, highlights running down
  for (let y = 13; y <= 31; y++) {
    const t = (y + 30 - i * 2) % 4;
    p.px(8, y, STREAM[t === 0 ? 4 : 2] as number, 200).px(9, y, STREAM[t === 2 ? 3 : 1] as number, 170);
  }
  const sp = [[6, 31], [11, 31], [5, 31], [12, 31], [7, 30], [10, 30]] as const;
  sp.forEach(([x, y], k) => {
    if ((k + i) % 3 !== 0) p.px(x, y, STREAM[3 + ((k + i) % 2)] as number, 200);
  });
  // bronze lion head: mane, face, open jaws round the spout
  const mane = (grow: number): Painter => {
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      p.ellipse(9 + Math.cos(a) * 5.4, 8 + Math.sin(a) * 5.2, 2 + grow, 2 + grow);
    }
    return p.circle(9, 8, 5.6 + grow);
  };
  mane(1).fill(R(OUTLINE, OUTLINE, OUTLINE, OUTLINE), { mode: 'flat', inner: false });
  mane(0).fill(BRONZE, { mode: 'sphere', dither: true, light: -0.35, inner: false });
  p.ellipse(9, 8.5, 3.6, 4.2).fill(BRONZE, { mode: 'sphere', light: 0.2 });
  p.px(7.5, 7, 0x120a04).px(10.5, 7, 0x120a04).px(9, 9, BRONZE[1] as number);
  p.line(7, 5.8, 8, 6.2).line(10, 6.2, 11, 5.8).fill(BRONZE, { mode: 'flat', tone: 0, inner: false });
  p.ellipse(9, 11.4, 2.2, 1.5).fill(DARK, { mode: 'flat', tone: 0, inner: false });
  p.px(8, 10.5, BONE[3] as number).px(10, 10.5, BONE[3] as number);
  p.ellipse(8.5, 12.6, 1.6, 0.8).fill(BRONZE, { mode: 'emboss', light: 0.3 });
  for (const [x, y] of [[4, 10], [13, 5], [6, 13], [12, 12]] as const) p.px(x, y, VERDIGRIS[2] as number);
}

function portcullisDraw(p: Painter): void {
  // stone arch with jambs
  p.rect(0, 14, 30, 34).ellipse(15, 15, 15, 14.5).fill(STONE, { mode: 'emboss', dither: true });
  const open = (x: number): number => 16 - Math.sqrt(Math.max(0, 100 - (x - 15) * (x - 15)));
  p.rect(5, 16, 20, 31).ellipse(15, 16, 10, 10).fill(DARK, { mode: 'flat', tone: 0, inner: false });
  // faint floor receding into the dark
  p.rect(5, 43, 20, 4).fill(DARK, { mode: 'flat', tone: 2, inner: false });
  // voussoirs, keystone, jamb courses
  for (let k = 1; k < 8; k++) {
    const a = Math.PI + (k / 8) * Math.PI;
    p.line(15 + Math.cos(a) * 10.5, 16 + Math.sin(a) * 10.5, 15 + Math.cos(a) * 14.5, 16 + Math.sin(a) * 14.5);
  }
  for (const y of [24, 32, 40]) p.line(0, y, 4, y).line(26, y + 2, 30, y + 2);
  p.fill(STONE, { mode: 'flat', tone: 0, inner: false, alpha: 200 });
  p.poly([13, 1, 17, 1, 16.5, 6.5, 13.5, 6.5]).fill(STONE, { mode: 'emboss', light: 0.35 });
  // the grille: bars clipped to the arch, spiked feet held a little off the floor
  for (const x of [6.5, 10, 13.5, 17, 20.5, 24]) {
    const top = Math.ceil(open(x + 0.5));
    p.rect(x - 0.5, top, 1.6, 44 - top);
    p.poly([x - 0.6, 44, x + 1.2, 44, x + 0.3, 46.5]);
  }
  p.fill(IRON, { mode: 'cyl' });
  for (const y of [22, 31, 39]) p.rect(5, y, 20, 1.6);
  p.fill(IRON, { mode: 'emboss', light: 0.15 });
  for (const x of [6.5, 10, 13.5, 17, 20.5, 24]) for (const y of [22, 31, 39]) p.px(x, y, RIVET);
  const r = rng(29);
  for (let k = 0; k < 10; k++) p.px(5 + r() * 20, 20 + r() * 24, RUST[2 + (k % 2)] as number, 220);
  p.rect(0, 46, 30, 2).fill(STONE, { mode: 'emboss', light: 0.2 });
}

function shieldCrestDraw(p: Painter): void {
  // crossed swords behind
  for (const side of [-1, 1]) {
    const tx = 12 + side * 10, hx = 12 - side * 8;
    p.capsule(tx, 2, hx, 21, 0.9, 1.1).fill(STEEL, { mode: 'cyl' });
    p.capsule(hx - side * 0.5 - 2.6, 20, hx - side * 0.5 + 2.6, 22.4, 0.8).fill(BRASS, { mode: 'cyl' });
    p.capsule(hx - side * 0.8, 22, hx - side * 2, 25, 0.7).fill(LEATHER, { mode: 'cyl' });
    p.circle(hx - side * 2.3, 25.8, 1.2).fill(BRASS, { mode: 'sphere' });
  }
  // heater shield: iron rim, red field, gold chevron and crown
  p.poly([4, 3, 20, 3, 20, 13, 18, 19.5, 12, 25, 6, 19.5, 4, 13]).fill(IRON, { mode: 'emboss', light: 0.15 });
  p.poly([5.5, 4.5, 18.5, 4.5, 18.5, 13, 16.8, 18.6, 12, 23, 7.2, 18.6, 5.5, 13]).fill(RED, { mode: 'cyl', dither: true });
  p.poly([6, 17, 12, 11, 18, 17, 18, 19.5, 12, 13.5, 6, 19.5]).fill(GOLD, { mode: 'emboss', light: 0.15 });
  p.poly([9, 9, 15, 9, 15, 6, 13.5, 7.5, 12, 5.5, 10.5, 7.5, 9, 6]).fill(GOLD, { mode: 'emboss', light: 0.3 });
  for (const [x, y] of [[5, 4], [19, 4], [12, 24]] as const) p.px(x, y, RIVET);
  p.line(7, 6, 8, 12).fill(RED, { mode: 'flat', tone: 3, inner: false, alpha: 150 });
}

function nicheUrnsDraw(p: Painter): void {
  p.rect(1, 7, 22, 16).ellipse(12, 8, 11, 7.5).fill(STONE, { mode: 'emboss', dither: true });
  p.rect(4, 9, 16, 15).ellipse(12, 9.5, 8, 6.5).fill(DARK, { mode: 'flat', tone: 1, inner: false });
  p.ellipse(12, 9.5, 6.5, 5).rect(5.5, 9.5, 13, 8).fill(DARK, { mode: 'flat', tone: 0, inner: false, alpha: 140 });
  for (let k = 1; k < 6; k++) {
    const a = Math.PI + (k / 6) * Math.PI;
    p.line(12 + Math.cos(a) * 8.5, 9.5 + Math.sin(a) * 7, 12 + Math.cos(a) * 11, 9.5 + Math.sin(a) * 8.5);
  }
  p.fill(STONE, { mode: 'flat', tone: 0, inner: false, alpha: 180 });
  p.rect(1, 23, 22, 3).fill(STONE, { mode: 'emboss', light: 0.3 });
  urnBody(p, 7, 23, 0.6, CLAY, 'clay');
  urnBody(p, 17, 23, 0.54, BRONZE, 'bronze');
  candleBody(p, 12, 23, 4);
  p.px(11, 23, WAX[2] as number).px(13, 22, WAX[3] as number);
  p.px(12, 19, 0x1a1210);
}

// ---------------------------------------------------------------- specs

const blocker = { blocks: true } as const;

const BLOCKERS: Record<string, ClutterSpec> = {
  bookcase_free: spec('bookcase_free', 50, 70, [25, 55], { ...blocker, variants: true, frames: 2 }, (p, i) => bookcaseDraw(p, i)),
  iron_maiden: spec('iron_maiden', 38, 60, [22, 46], { ...blocker, fx: [{ kind: 'flies', dx: -6, dy: -14 }] }, (p) => ironMaidenDraw(p)),
  pillory: spec('pillory', 32, 52, [16, 38], blocker, (p) => pilloryDraw(p)),
  guardian: spec('guardian', 32, 70, [16, 56], blocker, (p) => guardianDraw(p)),
  obelisk: spec(
    'obelisk',
    28,
    74,
    [14, 60],
    {
      ...blocker,
      light: { color: 0x7ab8ff, radius: 60, intensity: 0.4, flicker: 0.1 },
      glow: {
        frames: 4,
        durations: [420, 360, 420, 360],
        draw: (p, i) => {
          for (const q of obeliskRunes()) {
            const lv = (q.row + i) % 4;
            const c = q.dim ? SOUL[lv === 0 ? 3 : 2] : SOUL[lv === 0 ? 4 : lv === 1 ? 3 : 2];
            p.gpx(q.x, q.y, c as number, SOUL[1] as number);
          }
        },
      },
    },
    (p) => obeliskDraw(p),
  ),
  bone_pillar: spec(
    'bone_pillar',
    30,
    78,
    [15, 64],
    { ...blocker, fx: [{ kind: 'flies', dx: 0, dy: -30 }], glow: { frames: 3, durations: [140, 120, 150], draw: (p, i) => tinyFlame(p, 15, 4, i) } },
    (p) => bonePillarDraw(p),
  ),
  stalagmite: spec('stalagmite', 30, 56, [15, 42], { ...blocker, glow: { frames: 1, draw: (p) => stalagmiteGlow(p) } }, (p) => stalagmiteDraw(p)),
  masonry_heap: spec('masonry_heap', 36, 30, [18, 16], { ...blocker, variants: true, frames: 2 }, (p, i) => masonryDraw(p, i)),
  bell_post: spec('bell_post', 34, 80, [14, 66], blocker, (p) => bellPostDraw(p)),
  brazier_column: spec(
    'brazier_column',
    26,
    66,
    [13, 52],
    {
      ...blocker,
      light: { color: 0xffa040, radius: 110, intensity: 0.8, flicker: 0.3 },
      fx: [{ kind: 'smoke', dx: 0, dy: -46, rate: 2 }, { kind: 'embers', dx: 0, dy: -40, rate: 1.2 }],
      glow: { frames: 3, durations: [100, 120, 90], draw: (p, i) => brazierColumnGlow(p, i) },
    },
    (p) => brazierColumnDraw(p),
  ),
  furnace: spec(
    'furnace',
    34,
    50,
    [17, 36],
    {
      ...blocker,
      light: { color: 0xff7a2a, radius: 90, intensity: 0.7, flicker: 0.25 },
      fx: [{ kind: 'smoke', dx: 0, dy: -33, rate: 1.6 }],
      glow: { frames: 3, durations: [130, 110, 140], draw: (p, i) => furnaceGlow(p, i) },
    },
    (p) => furnaceDraw(p),
  ),
};

const COSMETIC: Record<string, ClutterSpec> = {
  reading_table: spec(
    'reading_table',
    34,
    30,
    [17, 22],
    { light: { color: 0xffc070, radius: 60, intensity: 0.45, flicker: 0.3 }, glow: { frames: 3, durations: [120, 140, 110], draw: (p, i) => tinyFlame(p, 26, 6, i) } },
    (p) => readingTableDraw(p),
  ),
  chest_gold: spec('chest_gold', 28, 26, [14, 20], {}, (p) => chestGoldDraw(p)),
  coin_heap: spec('coin_heap', 30, 16, [15, 9], { low: true, variants: true, frames: 2 }, (p, i) => coinHeapDraw(p, i)),
  urn: spec('urn', 16, 26, [8, 23], { variants: true, frames: 3 }, (p, i) => {
    shadow(p, 8, 23.5, 6, 2, 85);
    urnBody(p, 8, 24, 1, i === 1 ? BRONZE : CLAY, i === 0 ? 'clay' : i === 1 ? 'bronze' : 'cracked');
    if (i === 2) {
      p.poly([12, 24, 15, 23, 14.5, 25]).poly([1, 24, 3.5, 23.5, 3, 25.5]).fill(CLAY, { mode: 'emboss', light: 0.2 });
    }
  }),
  cot: spec('cot', 36, 20, [18, 11], { low: true }, (p) => cotDraw(p)),
  armor_stand: spec('armor_stand', 22, 44, [11, 40], {}, (p) => armorStandDraw(p)),
  weapon_barrel: spec('weapon_barrel', 22, 36, [11, 32], {}, (p) => weaponBarrelDraw(p)),
  brazier_great: spec(
    'brazier_great',
    34,
    50,
    [17, 46],
    {
      light: { color: 0xffa040, radius: 120, intensity: 0.85, flicker: 0.32 },
      fx: [{ kind: 'smoke', dx: 0, dy: -42, rate: 2.6 }, { kind: 'embers', dx: 0, dy: -34, rate: 1.4 }],
      glow: { frames: 3, durations: [100, 120, 90], draw: (p, i) => brazierGreatGlow(p, i) },
    },
    (p) => brazierGreatDraw(p),
  ),
  candle_stand: spec(
    'candle_stand',
    16,
    44,
    [8, 41],
    {
      light: { color: 0xffc070, radius: 55, intensity: 0.4, flicker: 0.3 },
      glow: { frames: 3, durations: [120, 150, 130], draw: (p, i) => { tinyFlame(p, 3, 7, i); tinyFlame(p, 8, 2, i + 1); tinyFlame(p, 13, 8, i + 2); } },
    },
    (p) => candleStandDraw(p),
  ),
  well: spec('well', 38, 42, [19, 33], {}, (p) => wellDraw(p)),
  lilies: spec('lilies', 28, 16, [14, 8], { low: true, outline: false, variants: true, frames: 2 }, (p, i) => liliesDraw(p, i)),
  mushroom_ring: spec(
    'mushroom_ring',
    34,
    18,
    [17, 10],
    {
      flat: true,
      emissive: true,
      anim: 'prop:mushroom_ring',
      frames: 3,
      durations: [420, 360, 420],
      light: { color: 0x5af0c8, radius: 50, intensity: 0.35, flicker: 0.1 },
      fx: [{ kind: 'spores', dx: 0, dy: -4, rate: 0.7 }],
    },
    (p, i) => mushroomRingDraw(p, i),
  ),
  kneeler: spec('kneeler', 30, 16, [15, 9], { low: true }, (p) => kneelerDraw(p)),
  skull_pyramid: spec('skull_pyramid', 28, 26, [14, 22], { fx: [{ kind: 'flies', dx: 0, dy: -10 }] }, (p) => skullPyramidDraw(p)),
  banner_pole: spec('banner_pole', 20, 62, [10, 58], { anim: 'prop:banner_pole', frames: 2, durations: [700, 640], sway: true }, (p, i) => bannerPoleDraw(p, i)),
};

const WALL: Record<string, ClutterSpec> = {
  // origin at the spout (26px up the wall); the stream runs down to the floor line
  pipe_outlet: wallSpec('pipe_outlet', 18, 32, [0.5, 8 / 32], { mount: 26, outline: false, anim: 'prop:pipe_outlet', frames: 3, durations: [110, 110, 110] }, (p, i) => pipeOutletDraw(p, i)),
  portcullis: wallSpec('portcullis', 30, 48, [0.5, 1], { mount: 1 }, (p) => portcullisDraw(p)),
  shield_crest: wallSpec('shield_crest', 24, 28, [0.5, 1], { mount: 36 }, (p) => shieldCrestDraw(p)),
  niche_urns: wallSpec('niche_urns', 24, 26, [0.5, 1], { mount: 18, glow: { frames: 3, durations: [130, 150, 120], draw: (p, i) => tinyFlame(p, 12, 18, i) } }, (p) => nicheUrnsDraw(p)),
};

/** Room furniture props (blockers, cosmetic floor pieces, wall fixtures). Keys are `prop:<id>`. */
export const ROOM_PROP_SPECS: Record<string, ClutterSpec> = { ...BLOCKERS, ...COSMETIC, ...WALL };

/** Room props drawn without the outline pass. */
export const ROOM_NO_OUTLINE: readonly string[] = Object.values(ROOM_PROP_SPECS)
  .filter((s) => s.outline === false)
  .map((s) => s.key);
