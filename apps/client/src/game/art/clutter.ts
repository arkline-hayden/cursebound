/**
 * Lived-in set dressing for every dungeon theme (framework-free): clutter props, vignette pieces and wall
 * dressing. Everything here is plain pixel generation (no Phaser, no DOM) so the asset validator and the art
 * viewer can import it.
 *
 * Conventions (shared with dungeonData PROP_SPECS):
 *  - Light comes from the top-left; every prop gets the indigo outline pass unless `outline: false`.
 *  - Iso boxes: `isoBox` draws a 2:1 box from its front-bottom corner. The lit "left" face faces world +y (screen
 *    south-west), the darker "right" face faces world +x (screen south-east).
 *  - `hug` props are authored standing against a NORTH wall (their long lit face is parallel to the wall's south-west
 *    face). The renderer mirrors them (flipX) to stand against a WEST wall. They are at most ~30px wide so they fit
 *    in front of a single wall tile.
 *  - `low` props are flat enough to be baked straight into the lit floor render texture.
 *  - `glow` layers hold only the emissive pixels (flames, embers) of a lit prop: the body stays lit by Light2D and
 *    the glow sprite is drawn unlit on top, so a table can sit in shadow while its candle burns.
 *  - Wall props (`placement: 'wallFace'`) are authored front-facing; the renderer shears them onto block faces.
 */
import { MATERIALS, PALETTES } from './palette';
import { Painter, PixelBuffer, rng, type Ramp } from './draw/pixel';
import { STYLES, paintShrooms, type ThemePropSpec } from './dungeonThemes';

const R = (...c: number[]): Ramp => Object.freeze(c);

/** Ambient emitter hint attached to a prop (offsets in sprite px from the prop origin). */
export interface PropFx {
  kind: 'smoke' | 'steam' | 'spores' | 'embers' | 'flies' | 'wisp' | 'sparks';
  dx: number;
  dy: number;
  rate?: number;
}

export interface ClutterSpec extends ThemePropSpec {
  /** frames are static variants (pick one per placement), not an animation */
  variants?: boolean;
  /** flat enough to bake into the floor texture */
  low?: boolean;
  /** flat but animated / emissive: drawn as a sprite below actors */
  flat?: boolean;
  /** tall: must stand against a back wall (authored against a north wall, mirrored for west walls) */
  hug?: boolean;
  /** hug props: footprint depth from the wall plane, in tiles */
  hugDepth?: number;
  /** wall props: origin height above the floor line, px */
  mount?: number;
  /** render unlit (the whole sprite glows) */
  emissive?: boolean;
  /** hanging piece: animation gets a random rate so neighbours never sway in step */
  sway?: boolean;
  /** draw without the outline pass (scratches, flat growth) */
  outline?: boolean;
  fx?: PropFx[];
  /** emissive overlay layer: same size/origin as the prop, drawn unlit on top */
  glow?: { frames: number; durations?: number[]; draw: (p: Painter, i: number, n: number) => void };
}

// ---------------------------------------------------------------- ramps

export const WOOD = R(0x1e130d, 0x3a261a, 0x5c3e29, 0x80593a, 0xa47c52);
export const OLDWOOD = R(0x181512, 0x312a23, 0x4d4337, 0x6c5e4c, 0x8e7d64);
export const IRON = MATERIALS.iron;
export const RUST = MATERIALS.rust;
export const STONE = R(0x1a1816, 0x34302c, 0x544e47, 0x7a7268, 0xa0978a);
export const STATUE = R(0x1c1a1a, 0x383432, 0x5c5652, 0x857e76, 0xb4ab9e);
export const BONE = MATERIALS.boneDry;
export const PAPER = R(0x4e4536, 0x8c7c60, 0xc4b48e, 0xe6d9b6, 0xfaf2dc);
export const CANVAS = R(0x2a231c, 0x4c4032, 0x726048, 0x9a8462, 0xbca680);
export const LEATHER = R(0x1c120c, 0x382218, 0x58382a, 0x7a5038, 0x9a6a48);
export const RED = MATERIALS.bloodRed;
export const BLUE = R(0x0e1426, 0x1a2848, 0x2a3e6a, 0x42608e, 0x6a88b0);
export const GREEN = R(0x0e180e, 0x1c3020, 0x2c4a30, 0x426a44, 0x5e8a5a);
export const PLUM = MATERIALS.plum;
export const GOLD = MATERIALS.gold;
export const BRASS = MATERIALS.brass;
export const WAX = MATERIALS.wax;
export const FLAME = MATERIALS.flame;
export const STRAW = R(0x4a3a14, 0x7a6224, 0xaa8a3a, 0xd4b45a, 0xf0d88a);
export const ASH = R(0x141212, 0x2a2626, 0x423c3a, 0x5e5654, 0x7c7470);
const GLASS_G = R(0x0c2416, 0x16442a, 0x2a6e44, 0x52a070, 0xa8e8c0);
export const GLASS_B = R(0x0c1830, 0x183058, 0x2c5488, 0x5a88c0, 0xb0d8ff);
const GLASS_A = R(0x2a1606, 0x4e2c0e, 0x7a4a1a, 0xa8742e, 0xe0b060);
const ICE = R(0x2a5078, 0x5a90c0, 0x9ccaf0, 0xd8f0ff, 0xffffff);
const SNOW = STYLES.frost.growth;
export const SOUL = R(0x10204a, 0x2a4c9a, 0x5a8ae8, 0xa8ccff, 0xeef6ff);
export const TEAL = STYLES.fungal.growth;
export const MAGENTA = STYLES.fungal.accent;
export const STALK = R(0x2c2c24, 0x56564a, 0x86866e, 0xb6b698, 0xe0e0c8);
export const ROOT = MATERIALS.root;
export const LAVA = STYLES.forge.pool;
const ORE = R(0x121014, 0x26222a, 0x3e3844, 0x5c5464, 0x847a8e);
export const ROPE = R(0x2a2216, 0x4a3c26, 0x6e5a3a, 0x948054, 0xb8a272);
export const DARK = R(0x050404, 0x0a0807, 0x120e0c, 0x1a1512);
export const SHADOW = R(0x000000, 0x000000, 0x000000, 0x000000);
export const RED_WAX = R(0x3a0808, 0x6a1010, 0xa01e1e, 0xd04040, 0xf08080);
const RED_FLAME = R(0x5a0606, 0xb01414, 0xff3a2a, 0xffa080, 0xfff0e0);
const BRICK = PALETTES.dungeon.brick;
export const MOSS = MATERIALS.mossDark;

// ---------------------------------------------------------------- helpers

export type Pt = { x: number; y: number };
export interface BoxPts { F: Pt; L: Pt; R: Pt; B: Pt; h: number }
interface BoxOpts { top?: Ramp; left?: Ramp; right?: Ramp; dither?: boolean; tl?: number; ll?: number; rl?: number; noTop?: boolean; alpha?: number }

/**
 * 2:1 iso box from its front-bottom corner F. `a` = horizontal px span of the lit left face (+y facing, rises to the
 * upper-left), `b` = span of the dark right face (+x facing, rises to the upper-right), `h` = height.
 */
export function isoBox(p: Painter, fx: number, fy: number, a: number, b: number, h: number, ramp: Ramp, o: BoxOpts = {}): BoxPts {
  const F = { x: fx, y: fy };
  const L = { x: fx - a, y: fy - a / 2 };
  const Rt = { x: fx + b, y: fy - b / 2 };
  const B = { x: fx - a + b, y: fy - a / 2 - b / 2 };
  const alpha = o.alpha;
  if (h > 0) {
    p.poly([F.x, F.y, L.x, L.y, L.x, L.y - h, F.x, F.y - h]).fill(o.left ?? ramp, { mode: 'emboss', light: o.ll ?? 0.08, dither: o.dither, inner: false, alpha });
    p.poly([F.x, F.y, Rt.x, Rt.y, Rt.x, Rt.y - h, F.x, F.y - h]).fill(o.right ?? ramp, { mode: 'emboss', light: o.rl ?? -0.5, dither: o.dither, inner: false, alpha });
  }
  if (!o.noTop) p.poly([F.x, F.y - h, L.x, L.y - h, B.x, B.y - h, Rt.x, Rt.y - h]).fill(o.top ?? ramp, { mode: 'emboss', light: o.tl ?? 0.42, dither: o.dither, inner: false, alpha });
  return { F, L, R: Rt, B, h };
}

/** Point on the left face: s from F (0) to L (1), z above the box bottom. */
export function onL(b: BoxPts, s: number, z: number): Pt {
  return { x: b.F.x + (b.L.x - b.F.x) * s, y: b.F.y + (b.L.y - b.F.y) * s - z };
}
/** Point on the right face: s from F (0) to R (1). */
export function onR(b: BoxPts, s: number, z: number): Pt {
  return { x: b.F.x + (b.R.x - b.F.x) * s, y: b.F.y + (b.R.y - b.F.y) * s - z };
}
/** Point on the top face: s along the left edge, t along the right edge. */
export function onTop(b: BoxPts, s: number, t: number): Pt {
  return { x: b.F.x + (b.L.x - b.F.x) * s + (b.R.x - b.F.x) * t, y: b.F.y + (b.L.y - b.F.y) * s + (b.R.y - b.F.y) * t - b.h };
}
export function seg(p: Painter, a: Pt, b: Pt): Painter {
  return p.line(a.x, a.y, b.x, b.y);
}

/** Front-facing drawing sheared onto a wall-parallel plane (slope 1/2, falling to the right), blitted at (dx, dy). */
export function sheared(p: Painter, w: number, h: number, dx: number, dy: number, draw: (q: Painter) => void): void {
  const tmp = new PixelBuffer(w, h);
  draw(new Painter(tmp));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = tmp.data[y * w + x] as number;
    if (c >>> 24) p.buf.blend(dx + x, dy + y + Math.floor(x / 2), c & 0xffffff, c >>> 24);
  }
}

/** Soft contact shadow under a prop (below the outline threshold, so it stays soft). */
export function shadow(p: Painter, cx: number, cy: number, rx: number, ry: number, a = 80): void {
  p.ellipse(cx, cy, rx, ry).fill(SHADOW, { mode: 'flat', tone: 0, inner: false, alpha: a });
}

/** A tiny candle flame (wick top at x,y). */
export function tinyFlame(p: Painter, x: number, y: number, f: number, ramp: Ramp = FLAME): void {
  const sway = [0, 1, 0, -1][f % 4] as number;
  p.gpx(x, y, (ramp[4] ?? ramp[3]) as number, ramp[2] as number);
  p.gpx(x, y - 1, ramp[3] as number, ramp[2] as number);
  p.gpx(x + (sway > 0 ? 1 : 0), y - 2, ramp[3] as number, ramp[1] as number);
  if (f % 3 !== 2) p.gpx(x + sway, y - 3, ramp[2] as number, ramp[1] as number);
}

/** A cold ghost-flame: pale core, blue tongue. */
export function soulFlame(p: Painter, x: number, y: number, f: number): void {
  const sway = [0, 1, 0, -1][f % 4] as number;
  p.gpx(x, y, 0xeef6ff, SOUL[2] as number);
  p.gpx(x, y - 1, SOUL[3] as number, SOUL[2] as number);
  p.gpx(x - 1, y - 1, SOUL[2] as number, SOUL[1] as number);
  p.gpx(x + (sway > 0 ? 1 : 0), y - 2, SOUL[3] as number, SOUL[1] as number);
  p.gpx(x + sway, y - 3, SOUL[2] as number, SOUL[1] as number);
  if (f % 3 !== 1) p.gpx(x + sway, y - 4, SOUL[1] as number, SOUL[0] as number);
}

/** Wax candle body (bottom at by), no flame. */
export function candleBody(p: Painter, x: number, by: number, h: number, wax: Ramp = WAX): void {
  p.rect(x - 1, by - h, 2, h).fill(wax, { mode: 'cyl', inner: false });
  p.px(x - 1, by - h + 1, wax[3] as number);
  p.px(x, by - 1, wax[1] as number);
}

export function skull(p: Painter, x: number, y: number, s = 1, ramp: Ramp = BONE, look = 0): void {
  p.ellipse(x, y, 3.2 * s, 2.9 * s).fill(ramp, { mode: 'sphere', inner: true });
  p.rect(x - 1.6 * s + look, y + 1.7 * s, 3.2 * s, 1.5 * s).fill(ramp, { mode: 'emboss', light: -0.2, inner: true });
  const e = 0x120a0a;
  p.px(x - 1.2 * s + look * 0.6, y + 0.3, e).px(x + 1.2 * s + look * 0.6, y + 0.3, e).px(x + look * 0.6, y + 1.5 * s, 0x2a1e18);
}

/** A loose plank lying on the floor along an iso axis (dir 1 = rising to the upper-right). */
export function floorPlank(p: Painter, x: number, y: number, len: number, dir: 1 | -1, ramp: Ramp = WOOD): void {
  const ex = x + dir * len;
  const ey = y - len / 2;
  p.poly([x, y, ex, ey, ex, ey + 2, x, y + 2]).fill(ramp, { mode: 'emboss', light: 0.15, inner: false });
}

/** Small round stone. */
export function stone(p: Painter, x: number, y: number, rx: number, ry: number, ramp: Ramp = STONE, light = 0): void {
  p.ellipse(x, y, rx, ry).fill(ramp, { mode: 'sphere', light, inner: true });
}

export function spec(
  key: string,
  w: number,
  h: number,
  foot: [number, number],
  extra: Partial<ClutterSpec>,
  draw: (p: Painter, i: number, n: number) => void,
): ClutterSpec {
  return {
    key: `prop:${key}`,
    placement: 'floor',
    blocks: false,
    frames: 1,
    ...extra,
    w,
    h,
    originX: foot[0] / w,
    originY: foot[1] / h,
    draw,
  };
}

/** Wall prop: front-facing art; origin at (originX, originY), mounted `mount` px above the floor line (hang = top). */
export function wallSpec(key: string, w: number, h: number, origin: [number, number], extra: Partial<ClutterSpec>, draw: (p: Painter, i: number, n: number) => void): ClutterSpec {
  return { key: `prop:${key}`, placement: 'wallFace', blocks: false, frames: 1, ...extra, w, h, originX: origin[0], originY: origin[1], draw };
}

// ---------------------------------------------------------------- reusable pieces

export function barrelBody(p: Painter, cx: number, by: number, rx: number, hgt: number, ramp: Ramp = WOOD): void {
  p.ellipse(cx, by - 2, rx, 2.6).rect(cx - rx, by - hgt, rx * 2, hgt - 2).ellipse(cx, by - hgt * 0.55, rx + 0.7, hgt * 0.3).fill(ramp, { mode: 'cyl', dither: true });
  for (const k of [0.25, 0.75]) p.rect(cx - rx - 0.3, by - 2 - (hgt - 3) * k, rx * 2 + 0.6, 1.3);
  p.fill(IRON, { mode: 'cyl', inner: false });
  for (let s = -1; s <= 1; s += 2) p.line(cx + s * rx * 0.45, by - hgt + 2, cx + s * rx * 0.45, by - 2);
  p.fill(ramp, { mode: 'flat', tone: 1, inner: false, alpha: 150 });
}

/** Books standing on a sloped shelf line (left-face orientation): from x0 to x1, base y at x0 is by0, falling 1/2 per px to the right. */
export function shelfBooks(p: Painter, x0: number, x1: number, by0: number, maxH: number, seed: number): void {
  const r = rng(seed);
  const cols: Ramp[] = [RED, BLUE, GREEN, LEATHER, PLUM, OLDWOOD];
  let x = x0;
  while (x < x1 - 1) {
    const bw = r() < 0.3 ? 3 : 2;
    if (r() < 0.12) {
      x += bw + 1;
      continue;
    }
    const bh = Math.max(3, Math.round(maxH - r() * 3));
    const base = by0 + (x - x0) / 2;
    const ramp = cols[Math.floor(r() * cols.length)] as Ramp;
    p.rect(x, Math.round(base - bh + 1), bw, bh).fill(ramp, { mode: 'cyl', inner: false });
    if (r() < 0.4) p.px(x + (bw > 2 ? 1 : 0), Math.round(base - bh + 3), GOLD[2] as number);
    x += bw;
  }
}

// ---------------------------------------------------------------- props

const PROPS_A: Record<string, ClutterSpec> = {
  // ---------------- signs of past adventurers
  barrel_broken: spec('barrel_broken', 26, 26, [12, 22], {}, (p) => {
    shadow(p, 13, 22, 10, 3, 90);
    p.ellipse(11, 12, 7.2, 2.8).fill(DARK, { mode: 'flat', tone: 1, inner: false });
    const tops = [13, 9, 12, 8, 11, 15, 12];
    tops.forEach((t, k) => p.rect(4 + k * 2.1, t, 2.1, 22 - t));
    p.ellipse(11.3, 20.4, 7.4, 2.4);
    p.fill(WOOD, { mode: 'cyl', dither: true, cx: 10 });
    tops.forEach((t, k) => p.px(4 + k * 2.1, t, WOOD[4] as number));
    for (let k = 1; k < 7; k++) p.line(4 + k * 2.1, tops[k]! + 2, 4 + k * 2.1, 21);
    p.fill(WOOD, { mode: 'flat', tone: 0, inner: false, alpha: 140 });
    p.rect(3.6, 17, 15.2, 1.4).fill(IRON, { mode: 'cyl', inner: false });
    // loose staves and a sprung hoop
    p.capsule(16, 23, 23, 19.5, 1.1, 0.9).fill(WOOD, { mode: 'cyl' });
    p.capsule(1.5, 22.5, 6.5, 24, 1, 0.8).fill(WOOD, { mode: 'cyl' });
    p.ellipse(20, 23.6, 4.5, 1.6).minus().ellipse(20, 23.6, 3.3, 0.8).fill(RUST, { mode: 'emboss', inner: false });
  }),
  crate_broken: spec('crate_broken', 30, 26, [15, 20], {}, (p) => {
    shadow(p, 15, 21, 12, 3.5, 90);
    const b = isoBox(p, 16, 23, 12, 11, 9, WOOD, { dither: true });
    // caved-in lid: dark hollow with splintered boards
    const t0 = onTop(b, 0.12, 0.12), t1 = onTop(b, 0.88, 0.12), t2 = onTop(b, 0.88, 0.88), t3 = onTop(b, 0.12, 0.88);
    p.poly([t0.x, t0.y, t1.x, t1.y, t2.x, t2.y, t3.x, t3.y]).fill(DARK, { mode: 'flat', tone: 1, inner: false });
    for (const z of [3, 6]) {
      seg(p, onL(b, 0, z), onL(b, 1, z));
      seg(p, onR(b, 0, z), onR(b, 1, z));
    }
    p.fill(WOOD, { mode: 'flat', tone: 0, inner: false, alpha: 170 });
    // a board snapped upward out of the lid
    const s0 = onTop(b, 0.35, 0.4);
    p.poly([s0.x, s0.y, s0.x + 2, s0.y - 1, s0.x + 5, s0.y - 7, s0.x + 3, s0.y - 7]).fill(WOOD, { mode: 'emboss', light: 0.3 });
    floorPlank(p, 2, 24, 9, 1);
    floorPlank(p, 21, 25, 7, 1);
    for (const [x, y] of [[9, 22], [11, 24], [6, 23], [24, 22], [13, 25]] as const) p.px(x, y, STRAW[3] as number).px(x + 1, y, STRAW[2] as number);
  }),
  table_over: spec('table_over', 38, 32, [19, 25], {}, (p) => {
    shadow(p, 18, 26, 14, 4, 90);
    const F = { x: 27, y: 28 };
    const a = 24;
    // legs poking out of the far side (drawn first; the slab hides their roots)
    for (const [s, z] of [[0.12, 11], [0.88, 11], [0.12, 2], [0.88, 2]] as const) {
      const bx = F.x - a * s + 3, by = F.y - (a * s) / 2 - 1.5 - z;
      p.capsule(bx, by, bx + 10, by - 5, 1.3, 1.1);
    }
    p.fill(WOOD, { mode: 'cyl' });
    const b = isoBox(p, F.x, F.y, a, 3, 14, WOOD, { dither: true, ll: 0.12 });
    for (const s of [0.34, 0.67]) seg(p, onL(b, s, 1), onL(b, s, 13));
    p.fill(WOOD, { mode: 'flat', tone: 1, inner: false });
    p.px(onL(b, 0.5, 7).x, onL(b, 0.5, 7).y, WOOD[1] as number);
    // snapped leg + a dropped tankard
    p.capsule(4, 28, 12, 30, 1.2, 1.1).fill(WOOD, { mode: 'cyl' });
    p.rect(29, 26, 3, 3).fill(OLDWOOD, { mode: 'cyl' });
    p.ellipse(30.5, 26, 1.6, 0.8).fill(DARK, { mode: 'flat', tone: 0, inner: false });
  }),
  stool: spec('stool', 14, 16, [7, 13], {}, (p) => {
    shadow(p, 7, 13.5, 5, 1.8, 80);
    p.capsule(4, 14, 5, 8, 0.8).capsule(10, 14, 9, 8, 0.8).capsule(7.5, 15, 7, 9, 0.8).fill(WOOD, { mode: 'cyl' });
    p.ellipse(7, 8.4, 5.4, 2.2).fill(WOOD, { mode: 'emboss', light: -0.3 });
    p.ellipse(7, 7.2, 5.4, 2.4).fill(WOOD, { mode: 'sphere', light: 0.2 });
  }),
  bookshelf: spec('bookshelf', 44, 66, [23, 53.5], { hug: true, hugDepth: 0.32 }, (p) => {
    const b = isoBox(p, 32, 63, 28, 10, 40, WOOD, { dither: true, tl: 0.3 });
    // recessed back of the shelves
    const i0 = onL(b, 0.07, 2), i1 = onL(b, 0.93, 2), i2 = onL(b, 0.93, 38), i3 = onL(b, 0.07, 38);
    p.poly([i0.x, i0.y, i1.x, i1.y, i2.x, i2.y, i3.x, i3.y]).fill(DARK, { mode: 'flat', tone: 1, inner: false });
    const shelfZ = [2, 14, 26];
    shelfZ.forEach((z, k) => {
      const a0 = onL(b, 0.07, z + 1);
      const a1 = onL(b, 0.93, z + 1);
      // books stand on the shelf: x runs left (L side) to right (F side)
      shelfBooks(p, Math.round(a1.x) + 1, Math.round(a0.x) - 1, a1.y - 0.5, 10, 77 + k * 13);
    });
    for (const z of [...shelfZ, 38]) {
      const a0 = onL(b, 0.04, z), a1 = onL(b, 0.96, z);
      p.poly([a1.x, a1.y, a0.x, a0.y, a0.x, a0.y + 1.6, a1.x, a1.y + 1.6]);
    }
    p.fill(WOOD, { mode: 'flat', tone: 3, inner: false });
    // uprights
    for (const s of [0.02, 0.5, 0.98]) seg(p, onL(b, s, 1), onL(b, s, 39));
    p.fill(WOOD, { mode: 'flat', tone: 2, inner: false });
    seg(p, b.F, { x: b.F.x, y: b.F.y - 40 }).fill(WOOD, { mode: 'flat', tone: 4, inner: false });
    // a book lying flat and a skull on top
    const t = onTop(b, 0.35, 0.5);
    skull(p, t.x, t.y - 2, 0.9);
    const lb = onL(b, 0.75, 15);
    p.poly([lb.x - 4, lb.y - 1, lb.x + 2, lb.y + 2, lb.x + 2, lb.y + 3.5, lb.x - 4, lb.y + 0.5]).fill(RED, { mode: 'emboss' });
    // dust and a cobweb strand on the top corner
    const tc = onTop(b, 0.95, 0.1);
    p.line(tc.x, tc.y, tc.x + 4, tc.y + 5).fill(R(0xcfcac0, 0xcfcac0, 0xcfcac0, 0xcfcac0), { mode: 'flat', alpha: 110, inner: false });
  }),
  books_spilled: spec('books_spilled', 28, 16, [14, 10], { low: true }, (p) => {
    const book = (fx: number, fy: number, a: number, b: number, cover: Ramp): void => {
      isoBox(p, fx, fy, a, b, 2, cover, { left: PAPER, right: cover, top: cover, ll: 0.3 });
    };
    book(9, 12, 6, 4, RED);
    book(21, 13, 4, 6, BLUE);
    book(15, 8, 5, 4, GREEN);
    book(10, 9, 3, 5, LEATHER);
    // open book with lines of script
    p.poly([14, 13, 19, 10.5, 22, 12, 17, 14.5]).fill(PAPER, { mode: 'emboss', light: 0.3 });
    p.poly([9, 12.5, 14, 13, 17, 14.5, 12, 15]).fill(PAPER, { mode: 'emboss', light: 0.15 });
    p.line(15, 12.5, 18, 11).line(16, 13.5, 19, 12).line(11, 13, 13, 13.4).fill(PAPER, { mode: 'flat', tone: 0, inner: false, alpha: 200 });
  }),
  parchment: spec('parchment', 26, 14, [13, 7], { low: true, variants: true, frames: 3 }, (p, i) => {
    const sheet = (x: number, y: number, s = 1, lines = 2): void => {
      p.poly([x, y, x + 6 * s, y - 3 * s, x + 10 * s, y - 1 * s, x + 4 * s, y + 2 * s]).fill(PAPER, { mode: 'emboss', light: 0.25 });
      for (let k = 0; k < lines; k++) p.line(x + 2 + k, y - 0.5 + k * 0.8, x + 5 * s + k, y - 2.5 * s + k * 0.8);
      p.fill(PAPER, { mode: 'flat', tone: 0, inner: false, alpha: 170 });
    };
    if (i === 0) {
      sheet(3, 8);
      sheet(12, 9, 1.1, 3);
      sheet(9, 4, 0.8, 1);
    } else if (i === 1) {
      p.capsule(4, 9, 14, 4, 1.6, 1.6).fill(PAPER, { mode: 'cyl' });
      p.rect(8.5, 5.5, 1.5, 2.5).fill(RED, { mode: 'flat', tone: 2, inner: false });
      sheet(13, 10, 1, 2);
    } else {
      // a torn map, X marks the spot
      p.poly([3, 8, 13, 3, 23, 7, 13, 12]).fill(PAPER, { mode: 'emboss', light: 0.15 });
      p.line(7, 8, 11, 6).line(11, 6, 15, 7).line(15, 7, 18, 6).fill(LEATHER, { mode: 'flat', tone: 1, inner: false });
      p.px(17, 8, RED[3] as number).px(18, 9, RED[3] as number).px(18, 8, RED[2] as number).px(17, 9, RED[2] as number);
      p.px(22, 7, 0).px(21, 6, 0);
    }
  }),
  sacks: spec('sacks', 30, 24, [15, 20], {}, (p) => {
    shadow(p, 15, 20, 12, 3.4, 90);
    // back sack
    p.ellipse(19, 15.5, 6.2, 5.8).ellipse(19, 10.5, 4.2, 3.6).rect(17.5, 6, 3, 3).fill(CANVAS, { mode: 'sphere', dither: true });
    p.rect(17, 7.5, 4, 1.2).fill(ROPE, { mode: 'flat', tone: 1, inner: false });
    // front standing sack
    p.ellipse(10, 16, 6, 6.2).ellipse(10, 10.5, 4.5, 4).rect(8.5, 5, 3, 4).fill(CANVAS, { mode: 'sphere', dither: true, light: 0.08 });
    p.rect(8, 7, 4, 1.2).fill(ROPE, { mode: 'flat', tone: 1, inner: false });
    p.px(9, 4, CANVAS[3] as number).px(11, 4, CANVAS[2] as number);
    p.line(7, 14, 9, 17).fill(CANVAS, { mode: 'flat', tone: 1, inner: false });
    // lying sack, split open, grain spilling
    p.capsule(14, 20.5, 24, 18.5, 3.6, 3.2).fill(CANVAS, { mode: 'sphere', dither: true });
    p.line(21, 18, 24, 19).fill(DARK, { mode: 'flat', tone: 1, inner: false });
    const r = rng(23);
    for (let k = 0; k < 22; k++) {
      const x = 22 + r() * 7, y = 20 + r() * 3.5;
      p.px(x, y, (r() < 0.5 ? STRAW[2] : STRAW[3]) as number);
    }
  }),
  cartwheel: spec('cartwheel', 26, 36, [13, 32], { hug: true, hugDepth: 0.14 }, (p) => {
    shadow(p, 13, 32, 8, 2.2, 70);
    sheared(p, 22, 22, 2, 2, (q) => {
      q.ellipse(11, 11, 10, 10).minus().ellipse(11, 11, 7.6, 7.6).fill(IRON, { mode: 'cyl' });
      q.ellipse(11, 11, 9, 9).minus().ellipse(11, 11, 7.6, 7.6).fill(WOOD, { mode: 'cyl', dither: true });
      for (let k = 0; k < 6; k++) {
        if (k === 4) continue;
        const a = (k / 6) * Math.PI * 2 + 0.3;
        q.line(11 + Math.cos(a) * 2, 11 + Math.sin(a) * 2, 11 + Math.cos(a) * 7.6, 11 + Math.sin(a) * 7.6);
      }
      q.fill(WOOD, { mode: 'flat', tone: 3, inner: false });
      q.capsule(11 + Math.cos(4.5) * 2, 11 + Math.sin(4.5) * 2, 11 + Math.cos(4.5) * 4.5, 11 + Math.sin(4.5) * 4.5, 0.6).fill(WOOD, { mode: 'flat', tone: 2, inner: false });
      q.circle(11, 11, 2.6).fill(IRON, { mode: 'sphere' });
      // missing rim chunk
      q.minus().rect(17, 13, 4, 4).plus();
      q.rect(18, 14, 3, 3).fill(DARK, { mode: 'flat', tone: 0, inner: false, alpha: 0 });
    });
  }),
  weaponrack: spec('weaponrack', 32, 50, [16, 45], { hug: true, hugDepth: 0.16 }, (p) => {
    shadow(p, 15, 45, 12, 3, 70);
    sheared(p, 28, 34, 2, 1, (q) => {
      // weapons behind the bars
      q.capsule(7, 2, 7, 33, 0.7).fill(WOOD, { mode: 'cyl' });
      q.poly([5.5, 3, 8.5, 3, 7, -1]).fill(MATERIALS.steel, { mode: 'facet', facets: 3 });
      q.rect(12, 5, 2.2, 19).fill(MATERIALS.steel, { mode: 'cyl' });
      q.poly([12, 5, 14.2, 5, 13.1, 2]).fill(MATERIALS.steel, { mode: 'cyl' });
      q.rect(10, 24, 6.2, 1.6).fill(BRASS, { mode: 'cyl' });
      q.rect(12.3, 25.5, 1.6, 6).fill(LEATHER, { mode: 'cyl' });
      q.circle(13.1, 32, 1.1).fill(BRASS, { mode: 'sphere' });
      q.capsule(20, 6, 20, 33, 0.8).fill(WOOD, { mode: 'cyl' });
      q.poly([20, 6, 25, 4, 26, 11, 20, 10]).fill(IRON, { mode: 'emboss', light: 0.2 });
      // rack frame
      q.rect(2, 6, 2.4, 28).rect(23.6, 6, 2.4, 28).fill(WOOD, { mode: 'cyl' });
      q.rect(1, 9, 26, 2.2).rect(1, 26, 26, 2.2).fill(WOOD, { mode: 'emboss', light: 0.15 });
    });
  }),
  shield_lean: spec('shield_lean', 24, 30, [11, 26], { hug: true, hugDepth: 0.12 }, (p) => {
    shadow(p, 11, 26, 8, 2.2, 70);
    sheared(p, 20, 20, 1, 3, (q) => {
      q.capsule(17, 1, 17, 19, 0.8).fill(MATERIALS.steel, { mode: 'cyl' });
      q.rect(15, 5, 4, 1.4).fill(BRASS, { mode: 'cyl' });
      q.circle(9, 11, 8.2).fill(IRON, { mode: 'sphere' });
      q.circle(9, 11, 7).fill(BLUE, { mode: 'sphere', dither: true });
      q.poly([9, 4, 16, 11, 9, 18, 2, 11]).fill(GOLD, { mode: 'flat', tone: 1, inner: false, alpha: 200 });
      q.circle(9, 11, 2.2).fill(IRON, { mode: 'sphere', light: 0.3 });
      q.line(3, 7, 6, 9).fill(DARK, { mode: 'flat', tone: 1, inner: false });
    });
  }),
  bedroll: spec('bedroll', 36, 22, [18, 12], { low: true }, (p) => {
    const b = isoBox(p, 25, 19, 22, 10, 2, RED, { dither: true, top: RED, left: RED, right: RED });
    for (const s of [0.42, 0.5]) seg(p, onTop(b, s, 0), onTop(b, s, 1));
    p.fill(CANVAS, { mode: 'flat', tone: 2, inner: false });
    // rolled pillow at the head
    const h0 = onTop(b, 0.92, 0.05), h1 = onTop(b, 0.92, 0.95);
    p.capsule(h0.x, h0.y - 1, h1.x, h1.y - 1, 2.4).fill(CANVAS, { mode: 'cyl' });
    // turned-back corner
    const c0 = onTop(b, 0, 0), c1 = onTop(b, 0.25, 0), c2 = onTop(b, 0, 0.5);
    p.poly([c0.x, c0.y, c1.x, c1.y, c2.x, c2.y]).fill(CANVAS, { mode: 'emboss', light: 0.25 });
  }),
  campfire: spec(
    'campfire',
    30,
    30,
    [15, 24],
    {
      light: { color: 0xff7a2a, radius: 80, intensity: 0.55, flicker: 0.35 },
      fx: [{ kind: 'smoke', dx: 0, dy: -4, rate: 2.2 }],
      glow: {
        frames: 4,
        durations: [140, 120, 150, 110],
        draw: (p, i) => {
          const e = [LAVA[3], LAVA[2], LAVA[4], LAVA[3]] as number[];
          const pts: [number, number][] = [[12, 23], [15, 24], [18, 23], [14, 22], [17, 22], [13, 24]];
          pts.forEach(([x, y], k) => p.gpx(x, y, e[(k + i) % 4] as number, LAVA[2] as number));
          const fh = [3, 4, 2, 5][i] as number;
          p.gpx(15, 22 - fh, FLAME[2] as number, FLAME[1] as number);
          for (let k = 0; k < fh; k++) p.gpx(15 + (k === fh - 1 ? ((i % 2) * 2 - 1) : 0), 22 - k, (k < 2 ? FLAME[3] : FLAME[2]) as number, FLAME[1] as number);
          p.gpx(13, 21 - (i % 2), FLAME[2] as number, FLAME[1] as number);
        },
      },
    },
    (p) => {
      p.ellipse(15, 23, 9, 3.6).fill(ASH, { mode: 'flat', tone: 1, inner: false });
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        stone(p, 15 + Math.cos(a) * 9, 23 + Math.sin(a) * 3.8, 2.1, 1.6, STONE, Math.sin(a) < 0 ? -0.2 : 0.1);
      }
      p.capsule(10, 24, 19, 21, 1.4).capsule(11, 21, 20, 24, 1.3).fill(R(0x0a0806, 0x1a1210, 0x2c1e16, 0x3e2c20), { mode: 'cyl' });
      // tripod and cooking pot
      p.line(7, 27, 15, 4).line(23, 27, 15, 4).line(16, 25, 15, 4).fill(WOOD, { mode: 'flat', tone: 2, inner: false });
      p.line(15, 5, 15, 11).fill(IRON, { mode: 'flat', tone: 2, inner: false });
      p.ellipse(15, 14.5, 5, 4).fill(IRON, { mode: 'sphere', light: 0.1 });
      p.ellipse(15, 11.6, 4.2, 1.4).fill(DARK, { mode: 'flat', tone: 2, inner: false });
      p.px(12, 13, IRON[4] as number);
    },
  ),
  campfire_cold: spec('campfire_cold', 30, 30, [15, 24], { fx: [{ kind: 'wisp', dx: 0, dy: -4, rate: 0.5 }] }, (p) => {
    p.ellipse(15, 23, 9, 3.6).fill(ASH, { mode: 'flat', tone: 2, inner: false });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      stone(p, 15 + Math.cos(a) * 9, 23 + Math.sin(a) * 3.8, 2.1, 1.6, STONE, Math.sin(a) < 0 ? -0.2 : 0.1);
    }
    p.capsule(10, 24, 19, 21, 1.4).capsule(11, 21, 20, 24, 1.3).fill(ASH, { mode: 'cyl' });
    p.px(14, 22, ASH[4] as number).px(17, 23, ASH[4] as number);
    p.line(7, 27, 15, 4).line(23, 27, 15, 4).line(16, 25, 15, 4).fill(WOOD, { mode: 'flat', tone: 1, inner: false });
    p.line(15, 5, 15, 11).fill(IRON, { mode: 'flat', tone: 2, inner: false });
    p.ellipse(15, 14.5, 5, 4).fill(IRON, { mode: 'sphere' });
    p.ellipse(15, 11.6, 4.2, 1.4).fill(ASH, { mode: 'flat', tone: 3, inner: false });
  }),
  pack: spec('pack', 18, 18, [9, 15], {}, (p) => {
    shadow(p, 9, 15.5, 7, 2.2, 80);
    p.ellipse(9, 11, 6, 5).rect(3, 9, 12, 6).fill(LEATHER, { mode: 'sphere', dither: true });
    p.poly([4, 8, 14, 8, 13, 12, 5, 12]).fill(CANVAS, { mode: 'emboss', light: 0.2 });
    p.capsule(4, 6, 14, 6, 2.2).fill(RED, { mode: 'cyl' });
    p.line(6, 4, 6, 8).line(12, 4, 12, 8).fill(LEATHER, { mode: 'flat', tone: 0, inner: false });
    p.px(9, 11, BRASS[3] as number).px(9, 12, BRASS[2] as number);
  }),
  skeleton_slump: spec('skeleton_slump', 28, 28, [15, 22], { hug: true, hugDepth: 0.3, variants: true, frames: 2, fx: [{ kind: 'flies', dx: -1, dy: -8 }] }, (p, i) => {
    shadow(p, 14, 22, 10, 3, 80);
    // rags
    p.poly([11, 18, 19, 17, 20, 23, 14, 24, 10, 22]).fill(i ? RED : CANVAS, { mode: 'emboss', dither: true, light: -0.2 });
    // legs: one knee up, one stretched out
    p.capsule(14, 21, 8, 17, 1.2, 1).capsule(8, 17, 4, 23, 1, 0.9).capsule(17, 22, 11, 25, 1.2, 1).capsule(11, 25, 5, 26.5, 1, 0.9);
    p.fill(BONE, { mode: 'cyl' });
    p.ellipse(15, 20, 3.4, 2.2).fill(BONE, { mode: 'sphere' });
    // spine, ribs against the wall
    p.capsule(15.5, 19, 17, 11, 0.9).fill(BONE, { mode: 'cyl' });
    p.ellipse(16, 13.5, 4.2, 3.6).fill(BONE, { mode: 'sphere', inner: true });
    for (let k = 0; k < 3; k++) p.line(12.5, 12.5 + k * 1.6, 19.5, 12 + k * 1.6);
    p.fill(DARK, { mode: 'flat', tone: 1, inner: false, alpha: 210 });
    // arms resting
    p.capsule(13, 11, 10.5, 17, 0.9).capsule(10.5, 17, 7.5, 21, 0.8).capsule(19.5, 11, 21, 17, 0.9).capsule(21, 17, 20, 21.5, 0.8).fill(BONE, { mode: 'cyl' });
    // drooped skull
    skull(p, 13, 7.5, 1, BONE, -1);
    if (i === 1) {
      p.ellipse(13, 5.5, 3.8, 2.3).fill(IRON, { mode: 'sphere', light: 0.2 });
      p.rect(9.2, 6, 7.6, 1.2).fill(IRON, { mode: 'flat', tone: 1, inner: false });
    } else {
      p.capsule(3, 27, 18, 25, 0.7).fill(RUST, { mode: 'cyl' });
      p.rect(15, 24, 1.4, 3).fill(BRASS, { mode: 'flat', tone: 2, inner: false });
    }
  }),
  skeleton_lying: spec('skeleton_lying', 32, 18, [16, 10], { low: true, variants: true, frames: 2, fx: [{ kind: 'flies', dx: 0, dy: -4 }] }, (p, i) => {
    const flip = i === 1;
    const X = (x: number): number => (flip ? 32 - x : x);
    p.capsule(X(8), 7, X(18), 11, 0.9).fill(BONE, { mode: 'cyl' });
    p.ellipse(X(11.5), 8.5, 4.2, 2.6).fill(BONE, { mode: 'sphere' });
    p.line(X(9), 8, X(14), 10).line(X(9), 9.5, X(13), 11).fill(DARK, { mode: 'flat', tone: 1, inner: false, alpha: 200 });
    p.capsule(X(10), 6.5, X(6), 12, 0.8).capsule(X(13), 10, X(18), 15, 0.8);
    p.capsule(X(18), 11, X(25), 13, 1).capsule(X(25), 13, X(30), 15, 0.9).capsule(X(19), 12, X(23), 16.5, 1).capsule(X(23), 16.5, X(28), 17, 0.9);
    p.fill(BONE, { mode: 'cyl' });
    p.ellipse(X(18.5), 11.5, 2.6, 1.8).fill(BONE, { mode: 'sphere' });
    skull(p, X(5), 6, 1, BONE, flip ? 1 : -1);
  }),
  cage: spec('cage', 24, 60, [12, 56], { hug: true, hugDepth: 0.4, sway: true, anim: 'prop:cage', frames: 4, durations: [420, 380, 420, 380] }, (p, i) => cageDraw(p, i, false)),
  cage_skel: spec(
    'cage_skel',
    24,
    60,
    [12, 56],
    { hug: true, hugDepth: 0.4, sway: true, anim: 'prop:cage_skel', frames: 4, durations: [460, 400, 460, 400], fx: [{ kind: 'flies', dx: 0, dy: -24 }] },
    (p, i) => cageDraw(p, i, true),
  ),
  skull_spike: spec('skull_spike', 14, 34, [7, 31], {}, (p) => {
    shadow(p, 7, 31, 5, 1.6, 80);
    for (const [x, y] of [[4, 31], [10, 31], [7, 32.5]] as const) stone(p, x, y, 2, 1.4);
    p.capsule(7, 32, 7, 5, 1.5, 0.6).fill(WOOD, { mode: 'cyl' });
    skull(p, 7, 20, 1.05, BONE, 1);
    skull(p, 7, 9, 1.1, BONE, 0);
    p.poly([6.2, 6, 7.8, 6, 7, 1]).fill(OLDWOOD, { mode: 'cyl' });
    p.rect(5, 14, 4, 2).fill(RED, { mode: 'flat', tone: 1, inner: false });
    p.px(9, 15, RED[1] as number).px(9, 16, RED[1] as number);
  }),
  rack: spec('rack', 40, 30, [20, 22], { fx: [{ kind: 'flies', dx: 0, dy: -10 }] }, (p) => {
    shadow(p, 20, 23, 15, 4, 90);
    const lift = 7;
    // legs
    for (const [x, y] of [[24, 24], [6, 15], [33, 19.5]] as const) p.rect(x - 1, y - lift - 1, 2.2, lift + 1);
    p.fill(WOOD, { mode: 'cyl' });
    const b = isoBox(p, 24, 24 - lift, 20, 11, 3, WOOD, { dither: true });
    // dark stain and ropes on the bed
    const c = onTop(b, 0.5, 0.5);
    p.ellipse(c.x, c.y, 6, 2.6).fill(R(0x1a0404, 0x2a0606, 0x3a0808, 0x4a0a0a), { mode: 'flat', tone: 2, inner: false, alpha: 210 });
    for (const t of [0.3, 0.7]) seg(p, onTop(b, 0.05, t), onTop(b, 0.95, t));
    p.fill(ROPE, { mode: 'flat', tone: 3, inner: false });
    // rollers with spokes at both ends
    for (const s of [0.02, 0.98]) {
      const r0 = onTop(b, s, -0.05), r1 = onTop(b, s, 1.05);
      p.capsule(r0.x, r0.y - 1.5, r1.x, r1.y - 1.5, 1.8).fill(OLDWOOD, { mode: 'cyl' });
      p.capsule(r0.x, r0.y - 1.5, r0.x - 2, r0.y - 5, 0.6).capsule(r0.x, r0.y - 1.5, r0.x - 3, r0.y + 0.5, 0.6).fill(WOOD, { mode: 'cyl' });
    }
  }),
  altar_blood: spec(
    'altar_blood',
    36,
    34,
    [18, 26],
    {
      light: { color: 0xff3a2a, radius: 75, intensity: 0.5, flicker: 0.28 },
      glow: { frames: 3, durations: [130, 150, 120], draw: (p, i) => { tinyFlame(p, 25, 8, i); tinyFlame(p, 28, 10, i + 1); } },
    },
    (p) => {
      shadow(p, 18, 27, 14, 4, 90);
      const b = isoBox(p, 22, 30, 16, 13, 11, STONE, { dither: true });
      const t = isoBox(p, 22, 20, 17, 14, 2, STONE, { tl: 0.5 });
      // blood pooled on top, running down the front
      const c = onTop(t, 0.45, 0.45);
      p.ellipse(c.x, c.y, 6, 2.4).fill(RED, { mode: 'sphere' });
      for (const [s, len] of [[0.25, 8], [0.4, 5], [0.62, 10], [0.8, 4]] as const) {
        const a0 = onL(b, s, 11);
        p.rect(a0.x, a0.y, 1, len);
      }
      p.fill(RED, { mode: 'flat', tone: 1, inner: false });
      skull(p, onTop(t, 0.8, 0.5).x, onTop(t, 0.8, 0.5).y - 2, 0.85);
      candleBody(p, 25, 13, 4, RED_WAX);
      candleBody(p, 28, 14, 3, RED_WAX);
      p.ellipse(18, 31, 5, 1.5).fill(RED, { mode: 'flat', tone: 0, inner: false, alpha: 200 });
    },
  ),
  candle_circle: spec(
    'candle_circle',
    46,
    30,
    [23, 15],
    { flat: true, emissive: true, outline: false, anim: 'prop:candle_circle', frames: 3, durations: [140, 120, 160], light: { color: 0xff4a32, radius: 90, intensity: 0.5, flicker: 0.3 } },
    (p, i) => {
      // a double ring painted in blood, a five-point star between them, faintly smouldering
      for (let a = 0; a < Math.PI * 2; a += 0.025) p.dot(23 + Math.cos(a) * 19, 15 + Math.sin(a) * 9.5);
      p.fill(RED, { mode: 'flat', tone: 2, inner: false, alpha: 235 });
      for (let a = 0; a < Math.PI * 2; a += 0.03) p.dot(23 + Math.cos(a) * 16, 15 + Math.sin(a) * 8);
      p.fill(RED, { mode: 'flat', tone: 1, inner: false, alpha: 200 });
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
        const b2 = ((k + 2) / 5) * Math.PI * 2 - Math.PI / 2;
        p.line(23 + Math.cos(a) * 15, 15 + Math.sin(a) * 7.5, 23 + Math.cos(b2) * 15, 15 + Math.sin(b2) * 7.5);
      }
      p.fill(RED, { mode: 'flat', tone: 3 - (i % 2), inner: false, alpha: 170 });
      p.gpx(23, 15, RED[4] as number, RED[3] as number);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.3;
        const x = Math.round(23 + Math.cos(a) * 19), y = Math.round(15 + Math.sin(a) * 9.5);
        const hgt = 3 + ((k * 7) % 3);
        candleBody(p, x, y + 1, hgt, k % 2 ? RED_WAX : WAX);
        tinyFlame(p, x, y - hgt, i + k, RED_FLAME);
      }
    },
  ),
  bucket: spec('bucket', 16, 16, [8, 13], { variants: true, frames: 2 }, (p, i) => {
    shadow(p, 8, 13.5, 6, 2, 80);
    if (i === 0) {
      p.ellipse(8, 13, 4.6, 1.8).rect(3.4, 6, 9.2, 7).fill(WOOD, { mode: 'cyl', dither: true });
      p.rect(3.2, 8, 9.6, 1.2).rect(3.2, 11.5, 9.6, 1.2).fill(IRON, { mode: 'cyl', inner: false });
      p.ellipse(8, 6, 4.6, 1.8).fill(WOOD, { mode: 'emboss', light: 0.3 });
      p.ellipse(8, 6.2, 3.6, 1.1).fill(GLASS_B, { mode: 'flat', tone: 1, inner: false });
      p.line(3, 6, 8, 1).line(8, 1, 13, 6).fill(IRON, { mode: 'flat', tone: 2, inner: false });
    } else {
      p.ellipse(10, 13, 5, 1.6).fill(GLASS_B, { mode: 'flat', tone: 1, inner: false, alpha: 160 });
      p.capsule(4, 11, 10, 9, 3.4, 3.8).fill(WOOD, { mode: 'cyl', dither: true });
      p.ellipse(10.5, 9.2, 2, 3.5).fill(DARK, { mode: 'flat', tone: 1, inner: false });
      p.line(6, 7.5, 6, 13).fill(IRON, { mode: 'flat', tone: 2, inner: false });
    }
  }),
  chest_open: spec('chest_open', 26, 28, [13, 22], {}, (p) => {
    shadow(p, 13, 23, 10, 3, 90);
    const b = isoBox(p, 15, 25, 12, 9, 7, WOOD, { dither: true, top: DARK });
    for (const s of [0.15, 0.85]) seg(p, onL(b, s, 0), onL(b, s, 7));
    seg(p, onR(b, 0.5, 0), onR(b, 0.5, 7));
    p.fill(IRON, { mode: 'flat', tone: 2, inner: false });
    const lk = onL(b, 0.5, 5);
    p.rect(lk.x - 1, lk.y - 1, 2, 2).fill(BRASS, { mode: 'flat', tone: 3, inner: false });
    // a couple of coins left behind
    p.px(onTop(b, 0.4, 0.5).x, onTop(b, 0.4, 0.5).y, GOLD[3] as number).px(onTop(b, 0.6, 0.3).x, onTop(b, 0.6, 0.3).y, GOLD[2] as number);
    // lid flung open against the back edge
    const r0 = { x: b.R.x, y: b.R.y - 7 }, b0 = { x: b.B.x, y: b.B.y - 7 };
    p.poly([r0.x, r0.y, b0.x, b0.y, b0.x + 2, b0.y - 9, r0.x + 2, r0.y - 9]).fill(WOOD, { mode: 'emboss', dither: true, light: -0.1 });
    p.line(r0.x + 1, r0.y - 4, b0.x + 1, b0.y - 4).fill(IRON, { mode: 'flat', tone: 2, inner: false });
  }),
  statue: spec('statue', 28, 58, [14, 50], { hug: true, hugDepth: 0.36 }, (p) => {
    const pl = isoBox(p, 17, 55, 13, 11, 7, STONE, { dither: true });
    const top = onTop(pl, 0.5, 0.5);
    const cx = top.x, by = top.y;
    p.poly([cx - 6.5, by, cx + 6.5, by, cx + 5, by - 14, cx + 4.5, by - 26, cx - 4.5, by - 26, cx - 5.5, by - 14]).fill(STATUE, { mode: 'cyl', dither: true });
    for (const dx of [-2.5, 0.5, 3]) p.line(cx + dx, by - 1, cx + dx * 0.7, by - 16);
    p.fill(STATUE, { mode: 'flat', tone: 1, inner: false, alpha: 180 });
    p.ellipse(cx, by - 30, 4.6, 5.2).fill(STATUE, { mode: 'sphere', light: 0.1 });
    p.ellipse(cx - 0.6, by - 29, 2.6, 3.2).fill(DARK, { mode: 'flat', tone: 1, inner: false });
    p.ellipse(cx, by - 18, 2.8, 2.4).fill(STATUE, { mode: 'sphere', light: 0.3 });
    p.line(cx - 4, by - 24, cx - 1.5, by - 19).line(cx + 4, by - 24, cx + 1.5, by - 19).fill(STATUE, { mode: 'flat', tone: 1, inner: false });
    for (const [x, y] of [[cx - 5, by - 2], [cx + 3, by - 25], [cx - 3, by - 34]] as const) p.ellipse(x, y, 2, 1.2);
    p.fill(MOSS, { mode: 'sphere', dither: true, inner: false });
    p.line(cx + 2, by - 10, cx + 3, by - 4).fill(DARK, { mode: 'flat', tone: 0, inner: false });
  }),
  statue_broken: spec('statue_broken', 30, 44, [13, 37], { hug: true, hugDepth: 0.36 }, (p) => {
    const pl = isoBox(p, 16, 42, 13, 11, 7, STONE, { dither: true });
    const top = onTop(pl, 0.5, 0.5);
    const cx = top.x, by = top.y;
    p.poly([cx - 6.5, by, cx + 6.5, by, cx + 5, by - 12, cx + 3, by - 15, cx + 1, by - 12, cx - 1, by - 16, cx - 3.5, by - 13, cx - 5.5, by - 14]).fill(STATUE, { mode: 'cyl', dither: true });
    p.line(cx - 2, by - 1, cx - 1.6, by - 11).line(cx + 2.5, by - 1, cx + 2, by - 10).fill(STATUE, { mode: 'flat', tone: 1, inner: false });
    // fallen head and arm
    p.ellipse(25, 40, 4, 3.6).fill(STATUE, { mode: 'sphere', light: 0.1 });
    p.ellipse(24, 40.5, 2, 2).fill(DARK, { mode: 'flat', tone: 1, inner: false });
    p.capsule(2, 41, 7, 43, 1.6).fill(STATUE, { mode: 'cyl' });
    for (const [x, y] of [[21, 42], [9, 43], [28, 42]] as const) stone(p, x, y, 1.4, 1, STATUE);
  }),
  offering: spec('offering', 20, 14, [10, 8], { low: true }, (p) => {
    p.ellipse(10, 8, 6, 2.6).fill(BRASS, { mode: 'sphere' });
    p.ellipse(10, 7.4, 4.6, 1.6).fill(DARK, { mode: 'flat', tone: 2, inner: false });
    p.px(8, 7, GOLD[3] as number).px(10, 8, GOLD[2] as number).px(12, 7, GOLD[3] as number);
    p.capsule(14, 11, 18, 10, 0.7).fill(BONE, { mode: 'cyl' });
    for (const [x, y, c] of [[4, 10, RED[3]], [3, 9, RED[2]], [5, 9, RED[3]], [4, 11, GREEN[2]]] as const) p.px(x, y, c as number);
    candleBody(p, 16, 9, 3);
  }),
  rubble_big: spec('rubble_big', 36, 24, [18, 18], {}, (p) => {
    shadow(p, 18, 19, 15, 4, 90);
    const r = rng(311);
    for (let k = 0; k < 12; k++) {
      const a = r() * Math.PI * 2, d = r();
      stone(p, 18 + Math.cos(a) * d * 13, 17 + Math.sin(a) * d * 4.5 - (1 - d) * 4, 1.8 + r() * 2.6, 1.4 + r() * 1.8, STONE, 0.1);
    }
    isoBox(p, 10, 19, 5, 4, 3, BRICK, { dither: true });
    isoBox(p, 26, 18, 4, 5, 3, BRICK, { dither: true });
    isoBox(p, 18, 13, 4, 4, 3, BRICK);
    for (let k = 0; k < 14; k++) p.px(4 + r() * 28, 19 + r() * 4, ASH[3] as number, 180);
  }),
  beam_broken: spec('beam_broken', 34, 40, [14, 34], { hug: true, hugDepth: 0.3 }, (p) => {
    shadow(p, 13, 35, 10, 3, 80);
    // timber leaning from the wall top down to the floor
    const A = { x: 28, y: 3 }, B = { x: 9, y: 33 };
    p.poly([A.x - 3, A.y - 1, B.x - 3, B.y - 1, B.x, B.y, A.x, A.y]).fill(OLDWOOD, { mode: 'emboss', light: 0.35 });
    p.poly([A.x, A.y, B.x, B.y, B.x + 1, B.y + 4, A.x + 1, A.y + 4]).fill(OLDWOOD, { mode: 'emboss', light: -0.35, dither: true });
    p.line(A.x - 1.5, A.y + 2, B.x - 0.5, B.y + 1.5).fill(OLDWOOD, { mode: 'flat', tone: 1, inner: false });
    // splintered foot
    p.poly([B.x - 3, B.y - 1, B.x - 4, B.y + 2, B.x - 2, B.y + 1, B.x - 1, B.y + 4, B.x + 1, B.y + 4]).fill(OLDWOOD, { mode: 'emboss', light: 0.2 });
    for (const [x, y, rx] of [[5, 35, 2.2], [17, 35, 2], [21, 36, 1.6], [13, 37, 1.8]] as const) stone(p, x, y, rx, rx * 0.7, STONE, 0.1);
    isoBox(p, 25, 36, 4, 4, 2.5, BRICK);
  }),
  bricks: spec('bricks', 24, 14, [12, 8], { low: true }, (p) => {
    isoBox(p, 7, 11, 5, 3, 2, BRICK, { dither: true });
    isoBox(p, 17, 12, 3, 5, 2, BRICK, { dither: true });
    isoBox(p, 13, 6, 4, 3, 2, BRICK);
    for (const [x, y] of [[3, 12], [21, 9], [10, 13], [19, 5]] as const) stone(p, x, y, 1.2, 0.9, STONE);
  }),
  table: spec(
    'table',
    32,
    30,
    [16, 22],
    { light: { color: 0xffc070, radius: 70, intensity: 0.5, flicker: 0.3 }, glow: { frames: 3, durations: [120, 140, 110], draw: (p, i) => tinyFlame(p, 21, 7, i) } },
    (p) => {
      shadow(p, 16, 23, 13, 4, 90);
      for (const [x, y] of [[19, 27], [3, 19], [30, 21.5]] as const) p.rect(x - 1, y - 9, 2, 9);
      p.fill(WOOD, { mode: 'cyl' });
      const b = isoBox(p, 19, 18, 16, 11, 2, WOOD, { dither: true, tl: 0.35 });
      for (const s of [0.33, 0.66]) seg(p, onTop(b, s, 0.03), onTop(b, s, 0.97));
      p.fill(WOOD, { mode: 'flat', tone: 2, inner: false });
      // plate, tankard, candle stub, a torn page
      const pl = onTop(b, 0.65, 0.35);
      p.ellipse(pl.x, pl.y, 2.8, 1.2).fill(OLDWOOD, { mode: 'sphere', light: 0.3 });
      const mg = onTop(b, 0.35, 0.65);
      p.rect(mg.x - 1, mg.y - 3, 2.6, 3).fill(OLDWOOD, { mode: 'cyl' });
      candleBody(p, 21, 12, 4);
      p.poly([8, 11, 12, 9, 14, 10, 10, 12]).fill(PAPER, { mode: 'emboss', light: 0.3 });
    },
  ),
  lectern: spec('lectern', 22, 32, [11, 28], {}, (p) => {
    shadow(p, 11, 28.5, 6, 2, 80);
    p.ellipse(11, 28, 5, 2).fill(WOOD, { mode: 'emboss' });
    p.rect(9, 14, 4, 14).fill(WOOD, { mode: 'cyl', dither: true });
    p.poly([2, 12, 16, 7, 20, 12, 6, 17]).fill(WOOD, { mode: 'emboss', light: 0.1 });
    // open tome
    p.poly([4, 11.5, 11, 9, 13, 11.5, 6, 14]).fill(PAPER, { mode: 'emboss', light: 0.3 });
    p.poly([11, 9, 17, 7, 18.5, 9.5, 13, 11.5]).fill(PAPER, { mode: 'emboss', light: 0.2 });
    p.line(6, 12, 10, 10.5).line(7, 13, 11, 11.5).line(13, 9.5, 16, 8.5).line(14, 10.5, 17, 9.5).fill(PAPER, { mode: 'flat', tone: 0, inner: false, alpha: 190 });
    p.line(12, 11, 11, 16).fill(RED, { mode: 'flat', tone: 3, inner: false });
  }),
  pew: spec('pew', 46, 32, [22, 22], {}, (p) => {
    shadow(p, 22, 23, 17, 4, 80);
    const lift = 6;
    // end panels
    for (const s of [0.03, 0.97]) {
      const x = 32 - 28 * s, y = 26 - 14 * s;
      p.poly([x, y, x + 7, y - 3.5, x + 7, y - 3.5 - lift - 12, x, y - lift - 2]);
    }
    p.fill(WOOD, { mode: 'emboss', light: -0.25, dither: true });
    const b = isoBox(p, 32, 26 - lift, 28, 7, 2, WOOD, { dither: true, tl: 0.3 });
    // back rest on the far edge
    const r0 = { x: b.R.x, y: b.R.y - 2 }, b0 = { x: b.B.x, y: b.B.y - 2 };
    p.poly([r0.x, r0.y, b0.x, b0.y, b0.x, b0.y - 11, r0.x, r0.y - 11]).fill(WOOD, { mode: 'emboss', dither: true, light: 0.05 });
    p.line(r0.x, r0.y - 11, b0.x, b0.y - 11).fill(WOOD, { mode: 'flat', tone: 4, inner: false });
    p.line(r0.x, r0.y - 6, b0.x, b0.y - 6).fill(WOOD, { mode: 'flat', tone: 1, inner: false });
  }),
  lantern: spec(
    'lantern',
    12,
    20,
    [6, 18],
    {
      light: { color: 0xffc070, radius: 95, intensity: 0.6, flicker: 0.14 },
      glow: {
        frames: 4,
        durations: [160, 140, 170, 130],
        draw: (p, i) => {
          p.rect(4, 9, 4, 6).fill(R(0x8a4a10, 0xc08020, 0xf0b040, 0xffe080), { mode: 'flat', tone: 1 + (i % 2), inner: false, alpha: 150 });
          tinyFlame(p, 6, 13, i);
        },
      },
    },
    (p) => {
      shadow(p, 6, 18, 4, 1.4, 80);
      p.ellipse(6, 17, 4, 1.6).fill(IRON, { mode: 'emboss' });
      p.rect(3, 8, 1.2, 9).rect(7.8, 8, 1.2, 9).fill(IRON, { mode: 'cyl' });
      p.poly([2, 8, 10, 8, 8, 5, 4, 5]).fill(IRON, { mode: 'emboss', light: 0.2 });
      p.ellipse(6, 3, 2, 2).minus().ellipse(6, 3, 1, 1).fill(IRON, { mode: 'flat', tone: 2, inner: false });
    },
  ),
};

function cageDraw(p: Painter, i: number, skel: boolean): void {
  const off = [0, 1, 0, -1][i] as number;
  shadow(p, 12, 56, 7, 2.4, 85);
  const cx = 12 + off;
  // chain from the ceiling
  for (let k = 0; k < 8; k++) {
    const y = 1 + k * 2.4;
    const x = 12 + (off * k) / 8;
    if (k % 2) p.ellipse(x, y, 1.6, 1);
    else p.ellipse(x, y, 0.9, 1.5);
  }
  p.fill(IRON, { mode: 'sphere', light: 0.1 });
  // back bars
  for (const dx of [-5, -1.7, 1.7, 5]) p.line(cx + dx, 24, cx + dx, 44);
  p.fill(IRON, { mode: 'flat', tone: 1, inner: false });
  if (skel) {
    p.capsule(cx + 1, 38, cx - 2, 43, 1.1).capsule(cx - 2, 43, cx + 3, 51, 0.9).fill(BONE, { mode: 'cyl' });
    p.ellipse(cx, 35, 3.4, 3).fill(BONE, { mode: 'sphere' });
    p.line(cx - 2.5, 34.5, cx + 2.5, 34.5).line(cx - 2.5, 36, cx + 2.5, 36).fill(DARK, { mode: 'flat', tone: 1, inner: false });
    p.capsule(cx + 3, 33, cx + 7, 40, 0.8).capsule(cx + 7, 40, cx + 8, 47, 0.7).fill(BONE, { mode: 'cyl' });
    skull(p, cx - 1, 29, 1, BONE, -1);
  }
  // dome, rings and front bars
  p.ellipse(cx, 24, 7, 4.5).minus().rect(cx - 8, 24, 16, 6).plus().fill(IRON, { mode: 'sphere', light: 0.2 });
  p.ellipse(cx, 24, 7.4, 2.2).minus().ellipse(cx, 24, 6.2, 1.2).fill(IRON, { mode: 'emboss', inner: false });
  for (const dx of [-7, -3.5, 0, 3.5, 7]) p.line(cx + dx, 24 + Math.abs(dx) * -0.1 + 1.5, cx + dx, 45);
  p.fill(IRON, { mode: 'flat', tone: 3, inner: false });
  p.ellipse(cx, 45, 7.4, 2.4).fill(RUST, { mode: 'emboss' });
  p.ellipse(cx, 19.5, 1.4, 1.4).minus().ellipse(cx, 19.5, 0.6, 0.6).fill(IRON, { mode: 'flat', tone: 2, inner: false });
}

const PROPS_B: Record<string, ClutterSpec> = {
  // ---------------- flooded
  rowboat: spec('rowboat', 54, 32, [27, 19], {}, (p) => {
    shadow(p, 27, 20, 22, 6, 80);
    const cx = 27, cy = 15, Lh = 0.78, Wh = 0.3;
    const P = (u: number, w: number, z = 0): Pt => ({ x: cx + (u - w) * 32, y: cy + (u + w) * 16 - z });
    const rim: Pt[] = [];
    const N = 24;
    for (let k = 0; k <= N; k++) {
      const u = -Lh + (2 * Lh * k) / N;
      const t = u / Lh;
      const w = Wh * Math.sqrt(Math.max(0, 1 - t * t)) * (t < 0 ? 1 - 0.25 * t * t : 1);
      rim.push(P(u, w, 7));
    }
    const rimB: Pt[] = [];
    for (let k = N; k >= 0; k--) {
      const u = -Lh + (2 * Lh * k) / N;
      const t = u / Lh;
      const w = Wh * Math.sqrt(Math.max(0, 1 - t * t)) * (t < 0 ? 1 - 0.25 * t * t : 1);
      rimB.push(P(u, -w, 7));
    }
    // outer hull (near side) dropped to the floor
    const hull: number[] = [];
    for (const q of rim) hull.push(q.x, q.y);
    for (let k = rim.length - 1; k >= 0; k--) hull.push(rim[k]!.x, rim[k]!.y + 7 - Math.abs(k - N / 2) * 0.35);
    p.poly(hull).fill(OLDWOOD, { mode: 'emboss', dither: true, light: 0.05 });
    // interior
    const inner: number[] = [];
    for (const q of [...rim, ...rimB]) inner.push(q.x, q.y);
    p.poly(inner).fill(DARK, { mode: 'flat', tone: 2, inner: false });
    // ribs, thwarts, bilge water
    for (const u of [-0.45, -0.15, 0.15, 0.45]) {
      const a = P(u, 0.22, 6), b = P(u, -0.22, 6);
      seg(p, a, b);
    }
    p.fill(OLDWOOD, { mode: 'flat', tone: 1, inner: false });
    for (const u of [-0.3, 0.3]) {
      const a = P(u, 0.26, 6), b = P(u, -0.26, 6);
      p.poly([a.x, a.y, b.x, b.y, b.x + 2, b.y + 1, a.x + 2, a.y + 1]);
    }
    p.fill(OLDWOOD, { mode: 'emboss', light: 0.3 });
    const wq = P(0.1, 0, 2);
    p.ellipse(wq.x, wq.y, 8, 2.4).fill(STYLES.flooded.pool, { mode: 'flat', tone: 2, inner: false, alpha: 200 });
    // planking seams and algae on the hull
    for (let k = 2; k < N - 2; k += 3) {
      const q = rim[k]!;
      p.line(q.x, q.y + 2, q.x + 1, q.y + 5);
    }
    p.fill(OLDWOOD, { mode: 'flat', tone: 0, inner: false, alpha: 150 });
    for (let k = 4; k < N - 3; k += 2) p.px(rim[k]!.x, rim[k]!.y + 6, STYLES.flooded.growth[2 + (k % 2)] as number);
    // broken gunwale and a hole
    const hb = rim[16]!;
    p.poly([hb.x - 2, hb.y + 1, hb.x + 3, hb.y + 2, hb.x + 2, hb.y + 5, hb.x - 1, hb.y + 4]).fill(DARK, { mode: 'flat', tone: 0, inner: false });
    // oar alongside
    p.capsule(6, 27, 30, 30, 0.7).fill(OLDWOOD, { mode: 'cyl' });
    p.ellipse(33, 30.3, 3.6, 1.4).fill(OLDWOOD, { mode: 'emboss', light: 0.2 });
  }),
  nets: spec('nets', 34, 20, [17, 11], { low: true }, (p) => {
    p.ellipse(17, 12, 14, 5.5).ellipse(12, 10, 7, 4).fill(ROPE, { mode: 'sphere', dither: true, light: -0.25 });
    for (let k = -14; k < 16; k += 3) p.line(17 + k, 6, 17 + k + 6, 17).line(17 + k + 6, 6, 17 + k, 17);
    p.fill(ROPE, { mode: 'flat', tone: 3, inner: false, alpha: 130 });
    p.minus().rect(0, 0, 34, 5).plus();
    for (const [x, y, c] of [[9, 9, RED], [22, 13, CANVAS], [27, 10, CANVAS]] as const) p.circle(x, y, 1.6).fill(c, { mode: 'sphere', light: 0.2 });
    p.capsule(28, 15, 33, 18, 0.6).fill(ROPE, { mode: 'cyl' });
  }),
  piling: spec('piling', 14, 40, [7, 37], {}, (p) => {
    shadow(p, 7, 37, 5, 1.6, 80);
    p.rect(3.5, 6, 7, 31).ellipse(7, 37, 3.5, 1.3).fill(OLDWOOD, { mode: 'cyl', dither: true });
    p.ellipse(7, 6, 3.5, 1.4).fill(OLDWOOD, { mode: 'emboss', light: 0.3 });
    p.rect(3.2, 16, 7.6, 1.2).rect(3.2, 18.5, 7.6, 1.2).fill(ROPE, { mode: 'cyl', inner: false });
    const r = rng(91);
    for (let k = 0; k < 16; k++) p.px(4 + r() * 6, 25 + r() * 11, (r() < 0.5 ? 0xd8d4c8 : 0x8a8a80) as number);
    p.rect(3.4, 33, 7.2, 4).fill(STYLES.flooded.growth, { mode: 'cyl', dither: true, inner: false, alpha: 220 });
  }),
  // ---------------- ossuary
  bonethrone: spec('bonethrone', 42, 72, [21, 58], { hug: true, hugDepth: 0.44 }, (p) => {
    const seat = isoBox(p, 26, 68, 22, 14, 10, BONE, { dither: true, tl: 0.25 });
    for (const s of [0.2, 0.5, 0.8]) {
      const q = onL(seat, s, 5);
      skull(p, q.x, q.y - 0.5, 0.9);
    }
    // high back on the far edge: a dark frame packed with long bones and rows of skulls
    const r0 = { x: seat.R.x, y: seat.R.y - 10 }, b0 = { x: seat.B.x, y: seat.B.y - 10 };
    const H = 30;
    p.poly([r0.x, r0.y, b0.x, b0.y, b0.x, b0.y - H, (r0.x + b0.x) / 2, (r0.y + b0.y) / 2 - H - 8, r0.x, r0.y - H]).fill(R(0x0a0706, 0x16100c, 0x221812, 0x2e2118), { mode: 'emboss', light: -0.1 });
    for (const t of [0.04, 0.96]) {
      const x = b0.x + (r0.x - b0.x) * t, y = b0.y + (r0.y - b0.y) * t;
      p.capsule(x, y, x, y - H - 2, 1.6, 1.3);
      p.circle(x, y - H - 3, 2);
    }
    p.fill(BONE, { mode: 'cyl', light: 0.1 });
    for (let k = 0; k < 4; k++) {
      const t = 0.2 + k * 0.2;
      const x = b0.x + (r0.x - b0.x) * t, y = b0.y + (r0.y - b0.y) * t;
      p.capsule(x, y - 1, x, y - 11, 0.9);
    }
    p.fill(BONE, { mode: 'cyl', light: -0.15 });
    for (let j = 0; j < 2; j++) for (let k = 0; k < (j ? 3 : 4); k++) {
      const t = (j ? 0.3 : 0.2) + k * 0.2;
      const x = b0.x + (r0.x - b0.x) * t, y = b0.y + (r0.y - b0.y) * t - 15 - j * 8;
      skull(p, x, y, 0.8, BONE, k % 2 ? 1 : -1);
    }
    const apex = { x: (r0.x + b0.x) / 2, y: (r0.y + b0.y) / 2 - H - 3 };
    skull(p, apex.x, apex.y, 1.4);
    p.capsule(apex.x - 3, apex.y - 2, apex.x - 7, apex.y - 7, 1, 0.5).capsule(apex.x + 3, apex.y - 2, apex.x + 7, apex.y - 7, 1, 0.5).fill(BONE, { mode: 'cyl' });
    // crowned skull on the seat
    const c = onTop(seat, 0.5, 0.45);
    skull(p, c.x, c.y - 2, 1.05);
    p.poly([c.x - 3, c.y - 4, c.x + 3, c.y - 4, c.x + 3, c.y - 7, c.x + 1.5, c.y - 5.5, c.x, c.y - 7.5, c.x - 1.5, c.y - 5.5, c.x - 3, c.y - 7]).fill(GOLD, { mode: 'emboss', light: 0.2 });
  }),
  skulls_tall: spec(
    'skulls_tall',
    32,
    36,
    [16, 31],
    { glow: { frames: 3, durations: [150, 130, 160], draw: (p, i) => tinyFlame(p, 16, 4, i, SOUL) }, fx: [{ kind: 'flies', dx: 0, dy: -10 }] },
    (p) => {
      shadow(p, 16, 32, 13, 3.5, 90);
      const rows: [number, number][] = [[1, 10], [2, 15.5], [3, 21], [4, 26.5], [5, 31]];
      for (const [n, y] of rows) for (let k = 0; k < n; k++) skull(p, 16 + (k - (n - 1) / 2) * 5.6, y - 2, 1.1, BONE, ((k + n) % 3) - 1);
      candleBody(p, 16, 9, 4, WAX);
    },
  ),
  reliquary: spec('reliquary', 28, 28, [14, 22], {}, (p) => {
    shadow(p, 14, 23, 11, 3.2, 90);
    const b = isoBox(p, 16, 25, 13, 10, 9, MATERIALS.darkWood, { dither: true });
    const t = isoBox(p, 16, 16, 13, 10, 2, MATERIALS.darkWood, { tl: 0.5 });
    seg(p, b.F, onL(b, 0, 9)).fill(GOLD, { mode: 'flat', tone: 3, inner: false });
    seg(p, onL(t, 0, 2), onL(t, 1, 2)).fill(GOLD, { mode: 'flat', tone: 2, inner: false });
    seg(p, onR(t, 0, 2), onR(t, 1, 2)).fill(GOLD, { mode: 'flat', tone: 1, inner: false });
    seg(p, onL(b, 0, 0.5), onL(b, 1, 0.5)).fill(GOLD, { mode: 'flat', tone: 1, inner: false });
    const c = onL(b, 0.5, 5);
    skull(p, c.x, c.y - 1, 0.85);
    const lt = onTop(t, 0.5, 0.5);
    p.poly([lt.x, lt.y - 5, lt.x + 1.6, lt.y - 2, lt.x, lt.y + 0.5, lt.x - 1.6, lt.y - 2]).fill(GOLD, { mode: 'emboss', light: 0.3 });
    p.rect(lt.x - 2.5, lt.y - 3, 5, 1).fill(GOLD, { mode: 'flat', tone: 3, inner: false });
  }),
  soulcandles: spec(
    'soulcandles',
    22,
    24,
    [11, 20],
    {
      light: { color: 0x8ab4ff, radius: 85, intensity: 0.6, flicker: 0.25 },
      fx: [{ kind: 'wisp', dx: 0, dy: -16, rate: 0.6 }],
      glow: {
        frames: 3,
        durations: [150, 130, 170],
        draw: (p, i) => {
          for (const [x, h, k] of [[5, 7, 0], [11, 11, 1], [17, 6, 2]] as const) soulFlame(p, x, 19 - h, i + k);
        },
      },
    },
    (p) => {
      // old tallow candles in a skull-dish puddle of their own wax
      const TALLOW = R(0x3e3a30, 0x6e6654, 0xa49a7e, 0xcac0a0, 0xe8e0c4);
      p.ellipse(11, 20, 9, 2.8).fill(TALLOW, { mode: 'sphere', light: -0.15 });
      for (const [x, h] of [[5, 7], [11, 11], [17, 6]] as const) {
        p.rect(x - 1.5, 20 - h, 3, h).fill(TALLOW, { mode: 'cyl', inner: false });
        p.px(x - 2, 21 - h + 2, TALLOW[3] as number).px(x - 2, 21 - h + 3, TALLOW[2] as number).px(x + 1, 20 - 2, TALLOW[1] as number);
        p.px(x, 20 - h, 0x1a1210);
      }
      skull(p, 8, 20, 0.7, BONE, 1);
    },
  ),
  // ---------------- sanctum
  candelabra: spec(
    'candelabra',
    18,
    38,
    [9, 35],
    {
      light: { color: 0xff4a3a, radius: 95, intensity: 0.6, flicker: 0.3 },
      glow: { frames: 3, durations: [120, 150, 130], draw: (p, i) => { tinyFlame(p, 3, 6, i, RED_FLAME); tinyFlame(p, 9, 3, i + 1, RED_FLAME); tinyFlame(p, 15, 6, i + 2, RED_FLAME); } },
    },
    (p) => {
      shadow(p, 9, 35, 5, 1.6, 80);
      p.capsule(9, 32, 5, 36, 0.8).capsule(9, 32, 13, 36, 0.8).capsule(9, 32, 9, 37, 0.8).fill(IRON, { mode: 'cyl' });
      p.rect(8, 12, 2, 21).fill(IRON, { mode: 'cyl' });
      p.ellipse(9, 22, 2, 1.2).fill(IRON, { mode: 'sphere' });
      p.capsule(3, 14, 15, 14, 0.8).capsule(3, 14, 3, 11, 0.7).capsule(15, 14, 15, 11, 0.7).fill(IRON, { mode: 'cyl' });
      for (const x of [3, 15]) p.ellipse(x, 11, 2, 0.9);
      p.ellipse(9, 9, 2, 0.9).fill(BRASS, { mode: 'emboss' });
      candleBody(p, 3, 11, 4, RED_WAX);
      candleBody(p, 9, 9, 5, RED_WAX);
      candleBody(p, 15, 11, 4, RED_WAX);
    },
  ),
  // ---------------- fungal
  shroom_giant: spec(
    'shroom_giant',
    36,
    46,
    [18, 42],
    { emissive: true, anim: 'prop:shroom_giant', frames: 4, durations: [360, 300, 360, 300], light: { color: 0x3ae8c0, radius: 130, intensity: 0.75, flicker: 0.08 }, fx: [{ kind: 'spores', dx: 0, dy: -30, rate: 1.4 }] },
    (p, i) => {
      const pulse = [0, 0.12, 0.24, 0.12][i] as number;
      p.capsule(18, 42, 17, 16, 3.8, 3).fill(STALK, { mode: 'cyl', dither: true });
      p.capsule(14, 41, 9, 43, 1.2, 0.6).capsule(22, 41, 27, 43.5, 1.2, 0.6).fill(STALK, { mode: 'cyl' });
      p.ellipse(18, 18, 13.5, 3.4).fill(R(0x062e26, 0x0c4a3e, 0x167a66, 0x2ab094), { mode: 'flat', tone: 1, inner: false });
      for (let k = -5; k <= 5; k++) p.line(18, 17, 18 + k * 2.4, 20);
      p.fill(R(0x062e26, 0x0c4a3e, 0x167a66, 0x2ab094), { mode: 'flat', tone: 2, inner: false, alpha: 200 });
      p.ellipse(18, 13, 15, 7).minus().rect(0, 17, 36, 10).plus().fill(TEAL, { mode: 'sphere', glow: TEAL[3] as number, light: 0.05 + pulse });
      const r = rng(55);
      for (let k = 0; k < 9; k++) {
        const a = Math.PI + r() * Math.PI, d = 0.3 + r() * 0.6;
        p.gpx(18 + Math.cos(a) * 13 * d, 14 + Math.sin(a) * 6 * d, TEAL[4] as number, TEAL[3] as number);
      }
      paintShrooms(p, 9, 43, TEAL, 2, 3, 0.7);
      paintShrooms(p, 27, 43, MAGENTA, 2, 9, 0.6);
    },
  ),
  shroom_tiny: spec('shroom_tiny', 16, 12, [8, 10], { emissive: true, flat: true, variants: true, frames: 3 }, (p, i) => {
    const ramp = i === 1 ? MAGENTA : TEAL;
    paintShrooms(p, 8, 11, ramp, 3 + i, 20 + i * 7, 0.55);
  }),
  sporepod: spec(
    'sporepod',
    18,
    24,
    [9, 21],
    { emissive: true, anim: 'prop:sporepod', frames: 4, durations: [320, 280, 320, 280], light: { color: 0xe050c8, radius: 60, intensity: 0.4, flicker: 0.1 }, fx: [{ kind: 'spores', dx: 0, dy: -12, rate: 0.9 }] },
    (p, i) => {
      p.ellipse(9, 21, 6, 2).fill(ROOT, { mode: 'sphere' });
      const pods: [number, number, number][] = [[5, 15, 3.4], [11, 11, 4.2], [14, 17, 2.8]];
      for (const [x, y] of pods) p.capsule(9, 21, x, y + 2, 0.9, 0.6);
      p.fill(ROOT, { mode: 'cyl' });
      pods.forEach(([x, y, rr], k) => {
        const pr = rr + (((i + k) % 4) === 2 ? 0.4 : 0);
        p.ellipse(x, y, pr * 0.85, pr).fill(MAGENTA, { mode: 'sphere', glow: MAGENTA[3] as number, light: -0.1, alpha: 235 });
        p.gpx(x - 1, y - 1, MAGENTA[4] as number, MAGENTA[3] as number);
        if ((i + k) % 2) p.gpx(x, y + 1, 0xffffff, MAGENTA[3] as number);
      });
    },
  ),
  roots_floor: spec('roots_floor', 36, 20, [18, 10], { low: true }, (p) => {
    const r = rng(203);
    for (let k = 0; k < 6; k++) {
      let x = 3 + r() * 6, y = 6 + r() * 8;
      const vx = 2 + r() * 1.5, vy = (r() - 0.5) * 1.5;
      for (let s = 0; s < 8; s++) {
        const nx = x + vx, ny = Math.max(3, Math.min(17, y + vy + (r() - 0.5) * 2));
        p.capsule(x, y, nx, ny, 1.3 - s * 0.12, 1.2 - s * 0.12);
        x = nx;
        y = ny;
      }
    }
    p.fill(ROOT, { mode: 'cyl', dither: true });
    for (let k = 0; k < 4; k++) p.gpx(6 + r() * 24, 6 + r() * 8, TEAL[3] as number, TEAL[2] as number);
  }),
  // ---------------- forge
  quench: spec('quench', 22, 28, [11, 24], { fx: [{ kind: 'steam', dx: 0, dy: -18, rate: 1.1 }] }, (p) => {
    shadow(p, 11, 24.5, 8, 2.4, 90);
    barrelBody(p, 11, 26, 8, 18, OLDWOOD);
    p.ellipse(11, 8, 8, 3).fill(OLDWOOD, { mode: 'emboss', light: 0.3 });
    p.ellipse(11, 8.4, 6.6, 2.2).fill(R(0x0a1014, 0x16222a, 0x2a3c46, 0x5e7e8a, 0xa8c4cc), { mode: 'sphere', light: 0.1 });
    p.px(9, 8, 0xc8dce4).px(10, 8, 0x8aa4b0);
    p.line(13, 9, 17, 1).line(14, 9, 19, 2).fill(IRON, { mode: 'flat', tone: 3, inner: false });
  }),
  chainhooks: wallSpec('chainhooks', 18, 46, [0.5, 0], { anim: 'prop:chainhooks', frames: 4, durations: [380, 340, 380, 340], sway: true }, (p, i) => {
    p.rect(1, 0, 16, 3).fill(OLDWOOD, { mode: 'emboss' });
    const off = [0, 1, 0, -1][i] as number;
    const chain = (x0: number, len: number, o: number): void => {
      for (let k = 0; k < len; k++) {
        const y = 4 + k * 3;
        const x = x0 + (o * k) / len;
        if (k % 2) p.ellipse(x, y, 1.6, 1);
        else p.ellipse(x, y, 0.9, 1.6);
      }
      p.fill(IRON, { mode: 'sphere', light: 0.1 });
      const hx = x0 + o, hy = 4 + len * 3;
      p.ellipse(hx, hy + 3, 2.6, 3).minus().ellipse(hx + 0.8, hy + 2.4, 1.6, 2.2).minus().rect(hx, hy - 1, 4, 3).plus().fill(IRON, { mode: 'emboss', light: 0.2 });
      p.px(hx + 2, hy + 1, IRON[4] as number);
    };
    chain(5, 9, off);
    chain(13, 12, -off);
  }),
  minecart: spec('minecart', 36, 32, [18, 25], {}, (p) => {
    shadow(p, 18, 26, 15, 4, 90);
    for (const [x, y] of [[19, 28], [8, 22.5], [26, 25]] as const) p.ellipse(x, y, 2.6, 3).fill(IRON, { mode: 'sphere' });
    const b = isoBox(p, 20, 26, 16, 12, 11, RUST, { dither: true, top: DARK });
    for (const z of [2, 9]) seg(p, onL(b, 0, z), onL(b, 1, z));
    p.fill(IRON, { mode: 'flat', tone: 3, inner: false });
    for (const s of [0.1, 0.5, 0.9]) for (const z of [2, 9]) p.px(onL(b, s, z).x, onL(b, s, z).y, IRON[4] as number);
    // ore heaped above the rim
    const r = rng(71);
    for (let k = 0; k < 10; k++) {
      const q = onTop(b, 0.15 + r() * 0.7, 0.15 + r() * 0.7);
      stone(p, q.x, q.y - 1.5, 1.6 + r() * 1.4, 1.3 + r(), ORE, 0.15);
    }
    for (let k = 0; k < 4; k++) {
      const q = onTop(b, 0.2 + r() * 0.6, 0.2 + r() * 0.6);
      p.px(q.x, q.y - 2, (k % 2 ? GOLD[3] : RUST[4]) as number);
    }
  }),
  orepile: spec('orepile', 30, 18, [15, 13], { low: true }, (p) => {
    const r = rng(83);
    for (let k = 0; k < 14; k++) {
      const a = r() * Math.PI * 2, d = r();
      stone(p, 15 + Math.cos(a) * d * 11, 12 + Math.sin(a) * d * 3.6 - (1 - d) * 4, 1.6 + r() * 1.8, 1.2 + r() * 1.3, k % 4 === 0 ? ASH : ORE, 0.15);
    }
    for (let k = 0; k < 7; k++) p.px(5 + r() * 20, 6 + r() * 8, (k % 3 ? RUST[4] : GOLD[3]) as number);
  }),
  forge_hearth: spec(
    'forge_hearth',
    30,
    34,
    [15, 27],
    {
      light: { color: 0xff7a2a, radius: 130, intensity: 0.85, flicker: 0.3 },
      fx: [{ kind: 'embers', dx: 0, dy: -12, rate: 2 }, { kind: 'smoke', dx: 1, dy: -14, rate: 1.4 }],
      glow: {
        frames: 4,
        durations: [130, 110, 140, 120],
        draw: (p, i) => {
          // coal bed on top and the glowing mouth
          const r = rng(5 + i);
          for (let k = 0; k < 14; k++) p.gpx(10 + r() * 11, 10 + r() * 4, (r() < 0.4 ? LAVA[4] : r() < 0.6 ? LAVA[3] : LAVA[2]) as number, LAVA[2] as number);
          p.ellipse(10, 25, 3, 3.6).fill(LAVA, { mode: 'flat', tone: 2 + (i % 2), glow: LAVA[3] as number, inner: false, alpha: 230 });
          p.gpx(10, 26, LAVA[4] as number, LAVA[3] as number);
          const fh = [3, 5, 4, 6][i] as number;
          for (let k = 0; k < fh; k++) p.gpx(15 + (k > 2 ? (i % 2 ? 1 : -1) : 0), 11 - k, (k < 2 ? FLAME[3] : FLAME[2]) as number, FLAME[1] as number);
        },
      },
    },
    (p) => {
      shadow(p, 15, 28, 12, 3.5, 90);
      const b = isoBox(p, 17, 31, 13, 12, 13, STONE, { dither: true, top: R(0x0a0606, 0x1a0e0a, 0x2a160e, 0x3a2012) });
      // arched mouth on the front
      const m = onL(b, 0.55, 1);
      p.ellipse(m.x, m.y - 4, 3.8, 4.6).minus().rect(m.x - 5, m.y, 10, 6).plus().fill(DARK, { mode: 'flat', tone: 0, inner: false });
      for (let k = 0; k < 5; k++) {
        const a = Math.PI + (k / 4) * Math.PI;
        p.px(m.x + Math.cos(a) * 4.8, m.y - 4 + Math.sin(a) * 5.6, STONE[4] as number);
      }
      // bellows leaning on the side
      p.poly([27, 30, 33, 26, 32, 22, 26, 25]).fill(LEATHER, { mode: 'emboss', light: -0.2 });
      p.capsule(29, 24, 25, 18, 0.7).fill(WOOD, { mode: 'cyl' });
    },
  ),
  // ---------------- frost
  frozencorpse: spec('frozencorpse', 32, 50, [17, 38], { hug: true, hugDepth: 0.32 }, (p) => {
    shadow(p, 16, 39, 13, 3.5, 80);
    // the figure frozen inside, arm raised
    p.ellipse(13, 34, 4.5, 2).fill(DARK, { mode: 'flat', tone: 2, inner: false });
    p.poly([9, 35, 17, 35, 16, 22, 10, 22]).fill(BLUE, { mode: 'cyl', dither: true });
    p.capsule(10, 23, 6, 13, 1.3).capsule(16, 23, 18, 30, 1.2).fill(BLUE, { mode: 'cyl' });
    p.ellipse(13, 18.5, 3, 3.3).fill(R(0x3a4652, 0x5e6e7e, 0x8a9aaa, 0xb4c2d0), { mode: 'sphere' });
    p.px(12, 18, 0x10141a).px(14, 18, 0x10141a);
    p.ellipse(6, 11.5, 1.6, 1.6).fill(R(0x3a4652, 0x5e6e7e, 0x8a9aaa, 0xb4c2d0), { mode: 'sphere' });
    // the ice block over it
    const b = isoBox(p, 21, 47, 17, 10, 33, ICE, { alpha: 150, tl: 0.6, ll: 0.25, rl: -0.2 });
    seg(p, b.F, { x: b.F.x, y: b.F.y - 33 }).fill(ICE, { mode: 'flat', tone: 4, inner: false, alpha: 220 });
    seg(p, onL(b, 0, 33), onL(b, 1, 33)).fill(ICE, { mode: 'flat', tone: 4, inner: false, alpha: 200 });
    p.line(b.F.x - 4, b.F.y - 26, b.F.x - 9, b.F.y - 18).line(b.F.x - 12, b.F.y - 12, b.F.x - 14, b.F.y - 7).fill(ICE, { mode: 'flat', tone: 4, inner: false, alpha: 180 });
    p.ellipse(17, 43, 12, 3).ellipse(10, 41, 5, 2.4).fill(SNOW, { mode: 'sphere', dither: true });
  }),
  iciclecluster: spec('iciclecluster', 28, 30, [14, 26], {}, (p) => {
    shadow(p, 14, 26.5, 11, 3, 80);
    const shards: [number, number, number, number][] = [[14, 27, 22, 0.05], [8, 27, 14, -0.35], [20, 27, 17, 0.35], [11, 28, 9, -0.1], [18, 28, 10, 0.15]];
    for (const [x, by, hgt, lean] of shards) p.poly([x - 2.6, by, x + 2.6, by, x + lean * 7 + 0.5, by - hgt, x + lean * 7 - 0.5, by - hgt - 1]);
    p.fill(ICE, { mode: 'facet', facets: 3, rot: 0.3 });
    p.ellipse(14, 27, 10, 2.4).fill(SNOW, { mode: 'sphere', dither: true });
  }),
  crate_snow: spec('crate_snow', 30, 36, [15, 30], {}, (p) => {
    shadow(p, 15, 31, 12, 3.5, 90);
    const b = isoBox(p, 17, 33, 13, 11, 11, OLDWOOD, { dither: true });
    for (const z of [4, 8]) {
      seg(p, onL(b, 0, z), onL(b, 1, z));
      seg(p, onR(b, 0, z), onR(b, 1, z));
    }
    p.fill(OLDWOOD, { mode: 'flat', tone: 0, inner: false, alpha: 160 });
    const t = isoBox(p, 15, 21, 10, 9, 9, OLDWOOD, { dither: true });
    seg(p, onL(t, 0, 4.5), onL(t, 1, 4.5)).fill(OLDWOOD, { mode: 'flat', tone: 0, inner: false, alpha: 160 });
    // snow caps and icicles
    const tc = onTop(t, 0.5, 0.5);
    p.ellipse(tc.x, tc.y, 8.5, 3.6).ellipse(tc.x - 3, tc.y - 1, 4, 2.4).fill(SNOW, { mode: 'sphere', dither: true });
    const bc = onTop(b, 0.75, 0.3);
    p.ellipse(bc.x, bc.y, 4, 1.8).fill(SNOW, { mode: 'sphere' });
    for (const s of [0.2, 0.45, 0.7]) {
      const q = onL(t, s, 9);
      p.poly([q.x - 0.8, q.y, q.x + 0.8, q.y, q.x, q.y + 3]);
    }
    p.fill(ICE, { mode: 'flat', tone: 3, inner: false });
    p.ellipse(13, 33, 10, 2.6).fill(SNOW, { mode: 'sphere', dither: true });
  }),
};

// ---------------------------------------------------------------- wall dressing (front-facing, sheared at runtime)

const WALL_PROPS: Record<string, ClutterSpec> = {
  shelf_jars: wallSpec('shelf_jars', 28, 22, [0.5, 1], { mount: 30, variants: true, frames: 2 }, (p, i) => {
    p.rect(1, 16, 26, 3).fill(WOOD, { mode: 'emboss', light: 0.2 });
    p.poly([4, 19, 7, 19, 4, 22]).poly([21, 19, 24, 19, 24, 22]).fill(IRON, { mode: 'emboss' });
    if (i === 0) {
      p.rect(3, 9, 5, 7).ellipse(5.5, 9, 2.5, 1).fill(GLASS_G, { mode: 'cyl' });
      p.rect(4, 7, 3, 2).fill(LEATHER, { mode: 'flat', tone: 2, inner: false });
      p.rect(10.5, 7, 3, 9).rect(11.4, 3, 1.4, 4).fill(GLASS_A, { mode: 'cyl' });
      skull(p, 18, 13, 0.9);
      p.rect(22, 11, 4, 5).fill(GLASS_B, { mode: 'cyl' });
      p.px(23, 12, 0xd8f0ff);
    } else {
      for (let k = 0; k < 7; k++) p.rect(2 + k * 2.4, 6 + (k % 3), 2.2, 10 - (k % 3)).fill(([RED, BLUE, GREEN, LEATHER, PLUM] as Ramp[])[k % 5] as Ramp, { mode: 'cyl', inner: false });
      p.poly([20, 16, 26, 11, 27, 12, 21, 16]).fill(RED, { mode: 'emboss' });
      candleBody(p, 24, 16, 3);
    }
  }),
  tapestry: wallSpec('tapestry', 24, 42, [0.5, 0], { anim: 'prop:tapestry', frames: 2, durations: [700, 640], sway: true }, (p, i) => tapestryDraw(p, i, BLUE, GOLD)),
  tapestry_red: wallSpec('tapestry_red', 24, 42, [0.5, 0], { anim: 'prop:tapestry_red', frames: 2, durations: [700, 640], sway: true }, (p, i) => tapestryDraw(p, i, RED, GOLD)),
  mount_skull: wallSpec('mount_skull', 26, 24, [0.5, 1], { mount: 34 }, (p) => {
    p.poly([6, 4, 20, 4, 20, 14, 13, 21, 6, 14]).fill(WOOD, { mode: 'emboss', dither: true });
    p.capsule(9, 8, 3, 3, 1.4, 0.6).capsule(3, 3, 1, 8, 0.6, 0.3).capsule(17, 8, 23, 3, 1.4, 0.6).capsule(23, 3, 25, 8, 0.6, 0.3).fill(BONE, { mode: 'cyl' });
    p.ellipse(13, 10, 4.5, 3.6).capsule(13, 12, 13, 18, 2.2, 1.4).fill(BONE, { mode: 'sphere' });
    p.px(11, 10, 0x120a0a).px(15, 10, 0x120a0a).px(12, 17, 0x2a1e18).px(14, 17, 0x2a1e18);
  }),
  antlers: wallSpec('antlers', 28, 20, [0.5, 1], { mount: 38 }, (p) => {
    p.ellipse(14, 14, 4, 4.6).fill(WOOD, { mode: 'emboss' });
    p.capsule(12, 12, 5, 4, 1, 0.6).capsule(8, 8, 3, 9, 0.7, 0.4).capsule(6, 5, 7, 1, 0.6, 0.3).capsule(16, 12, 23, 4, 1, 0.6).capsule(20, 8, 25, 9, 0.7, 0.4).capsule(22, 5, 21, 1, 0.6, 0.3);
    p.fill(BONE, { mode: 'cyl' });
    p.ellipse(14, 13.5, 2.2, 2.6).fill(BONE, { mode: 'sphere' });
  }),
  sconce: wallSpec(
    'sconce',
    12,
    20,
    [0.5, 1],
    { mount: 26, emissive: true, anim: 'prop:sconce', frames: 3, durations: [120, 150, 110], light: { color: 0xffc070, radius: 70, intensity: 0.55, flicker: 0.32 } },
    (p, i) => {
      p.rect(5, 12, 2, 8).fill(IRON, { mode: 'cyl' });
      p.capsule(6, 15, 9, 12, 0.7).fill(IRON, { mode: 'cyl' });
      p.ellipse(6, 12, 4, 1.4).fill(IRON, { mode: 'emboss', light: 0.2 });
      candleBody(p, 6, 12, 5);
      p.px(5, 7, WAX[3] as number).px(7, 9, WAX[3] as number);
      tinyFlame(p, 6, 6, i);
    },
  ),
  crack_roots: wallSpec('crack_roots', 24, 48, [0.5, 0], { outline: false }, (p) => {
    const r = rng(141);
    let x = 12, y = 0;
    const pts: Pt[] = [];
    for (let k = 0; k < 22; k++) {
      x += (r() - 0.5) * 3;
      y += 2;
      p.dot(x, y).dot(x + (k % 3 === 0 ? 1 : 0), y + 1);
      pts.push({ x, y });
      if (k % 6 === 3) {
        let bx = x, by = y;
        const dir = r() < 0.5 ? -1 : 1;
        for (let j = 0; j < 4; j++) {
          bx += dir * (1 + r());
          by += 1.4;
          p.dot(bx, by);
        }
      }
    }
    p.fill(DARK, { mode: 'flat', tone: 0, inner: false, alpha: 235 });
    for (const q of pts) p.px(q.x + 1, q.y, 0x6a5e52, 120);
    for (const k of [4, 10, 15]) {
      const q = pts[k]!;
      p.capsule(q.x, q.y, q.x + (r() - 0.5) * 6, q.y + 6 + r() * 6, 1.1, 0.4).capsule(q.x, q.y, q.x + (r() - 0.5) * 8, q.y + 3 + r() * 4, 0.8, 0.3);
    }
    p.fill(ROOT, { mode: 'cyl' });
    for (const k of [2, 12]) p.ellipse(pts[k]!.x + 1, pts[k]!.y + 1, 2.4, 1.6);
    p.fill(MOSS, { mode: 'sphere', dither: true, inner: false });
  }),
  tally: wallSpec('tally', 22, 14, [0.5, 1], { mount: 22, outline: false }, (p) => {
    const scratch = 0xb8ac98;
    for (let g = 0; g < 2; g++) {
      for (let k = 0; k < 4; k++) {
        const x = 2 + g * 10 + k * 2;
        p.line(x, 3 + (k % 2), x, 11);
      }
      p.line(1 + g * 10, 9, 10 + g * 10, 4);
    }
    p.line(20, 4, 20, 11);
    p.fill(R(scratch, scratch, scratch, scratch), { mode: 'flat', alpha: 150, inner: false });
    for (let x = 1; x < 22; x++) for (let y = 3; y < 13; y++) if (p.buf.alpha(x, y) > 0 && p.buf.alpha(x + 1, y + 1) === 0) p.buf.set(x + 1, y + 1, 0x0a0806, 150);
  }),
  runes: wallSpec('runes', 24, 16, [0.5, 1], { mount: 28, outline: false, variants: true, frames: 2 }, (p, i) => {
    const col = i === 1 ? 0xc83a38 : 0xb8ac98;
    const glyphs: number[][] = [
      [2, 2, 2, 13, 2, 7, 6, 3],
      [8, 13, 10, 2, 12, 13, 9, 8, 11, 8],
      [15, 2, 15, 13, 15, 2, 19, 6, 15, 8],
      [21, 3, 21, 13, 19, 9, 23, 9],
    ];
    for (const g of glyphs) for (let k = 0; k + 3 < g.length; k += 2) p.line(g[k]!, g[k + 1]!, g[k + 2]!, g[k + 3]!);
    p.fill(R(col, col, col, col), { mode: 'flat', alpha: 165, inner: false });
    for (let x = 0; x < 24; x++) for (let y = 0; y < 15; y++) if (p.buf.alpha(x, y) > 0 && p.buf.alpha(x + 1, y + 1) === 0) p.buf.set(x + 1, y + 1, 0x0a0806, 140);
  }),
  manacles: wallSpec('manacles', 22, 36, [0.5, 0], { anim: 'prop:manacles', frames: 4, durations: [400, 360, 400, 360], sway: true }, (p, i) => {
    const off = [0, 1, 0, -1][i] as number;
    p.rect(8, 0, 6, 4).fill(IRON, { mode: 'emboss' });
    p.ellipse(11, 5.5, 2, 2).minus().ellipse(11, 5.5, 1, 1).fill(IRON, { mode: 'flat', tone: 2, inner: false });
    for (const side of [-1, 1]) {
      for (let k = 0; k < 8; k++) {
        const t = k / 8;
        const x = 11 + side * t * 6 + off * t;
        const y = 8 + k * 2.8;
        if (k % 2) p.ellipse(x, y, 1.4, 0.9);
        else p.ellipse(x, y, 0.8, 1.4);
      }
      p.fill(IRON, { mode: 'sphere', light: 0.1 });
      const cx = 11 + side * 6 + off, cy = 32;
      p.ellipse(cx, cy, 3.4, 2.6).minus().ellipse(cx, cy, 2, 1.4).fill(RUST, { mode: 'emboss', light: 0.15 });
    }
  }),
  bonecandle: wallSpec(
    'bonecandle',
    14,
    22,
    [0.5, 1],
    { mount: 26, emissive: true, anim: 'prop:bonecandle', frames: 3, durations: [130, 150, 120], light: { color: 0xffb060, radius: 60, intensity: 0.45, flicker: 0.32 } },
    (p, i) => {
      p.rect(2, 19, 10, 2.4).fill(OLDWOOD, { mode: 'emboss' });
      skull(p, 7, 15, 1.1);
      candleBody(p, 7, 12, 4);
      p.px(6, 9, WAX[3] as number).px(8, 11, WAX[3] as number);
      tinyFlame(p, 7, 7, i);
    },
  ),
  glowmoss: wallSpec(
    'glowmoss',
    26,
    22,
    [0.5, 1],
    { mount: 14, emissive: true, outline: false, anim: 'prop:glowmoss', frames: 3, durations: [500, 420, 500], light: { color: 0x40e0c8, radius: 70, intensity: 0.45, flicker: 0.06 } },
    (p, i) => {
      const G = STYLES.flooded.growth;
      const r = rng(313);
      for (let k = 0; k < 10; k++) p.ellipse(3 + r() * 20, 6 + r() * 14, 2 + r() * 3.5, 1.5 + r() * 2.5);
      p.fill(G, { mode: 'sphere', dither: true, alpha: 230 });
      const r2 = rng(317);
      for (let k = 0; k < 9; k++) {
        const x = 3 + r2() * 20, y = 6 + r2() * 14;
        if ((k + i) % 3 !== 0) p.gpx(x, y, 0x9afff0, 0x2ad8c0);
      }
    },
  ),
  wallshrooms: wallSpec(
    'wallshrooms',
    24,
    24,
    [0.5, 1],
    { mount: 24, emissive: true, anim: 'prop:wallshrooms', frames: 3, durations: [420, 360, 420], light: { color: 0x3ae8c0, radius: 65, intensity: 0.45, flicker: 0.06 } },
    (p, i) => {
      const shelves: [number, number, number][] = [[8, 8, 6], [15, 14, 7], [7, 19, 5]];
      shelves.forEach(([x, y, rr], k) => {
        p.ellipse(x, y, rr, rr * 0.5).minus().rect(x - rr - 1, y + 0.5, rr * 2 + 2, rr).plus().fill(TEAL, { mode: 'sphere', glow: TEAL[3] as number, light: (k + i) % 3 === 0 ? 0.25 : 0.05 });
        p.ellipse(x, y + 0.6, rr - 0.5, 0.9).fill(R(0x062e26, 0x0c4a3e, 0x167a66, 0x2ab094), { mode: 'flat', tone: 1, inner: false });
      });
    },
  ),
  frostcrystal_wall: wallSpec(
    'frostcrystal_wall',
    22,
    26,
    [0.5, 1],
    { mount: 20, emissive: true, light: { color: 0x9ad8ff, radius: 70, intensity: 0.5, flicker: 0.05 } },
    (p) => {
      const shards: [number, number, number, number][] = [[11, 24, 18, 0], [6, 24, 12, -0.6], [16, 24, 13, 0.6], [9, 24, 8, -0.2]];
      for (const [x, by, hgt, lean] of shards) p.poly([x - 2.2, by, x + 2.2, by, x + lean * 6 + 0.5, by - hgt, x + lean * 6 - 0.5, by - hgt - 1]);
      p.fill(ICE, { mode: 'facet', facets: 3, glow: ICE[3] as number, rot: 0.4 });
    },
  ),
  toolrack: wallSpec('toolrack', 26, 26, [0.5, 1], { mount: 28 }, (p) => {
    p.rect(1, 2, 24, 3).fill(OLDWOOD, { mode: 'emboss' });
    for (const x of [5, 13, 20]) p.px(x, 5, IRON[3] as number);
    // hammer, tongs, file
    p.rect(4, 5, 1.6, 15).fill(WOOD, { mode: 'cyl' });
    p.rect(1.5, 19, 7, 4).fill(IRON, { mode: 'emboss', light: 0.2 });
    p.line(12, 5, 11, 22).line(14, 5, 15, 22).fill(IRON, { mode: 'flat', tone: 3, inner: false });
    p.ellipse(13, 6, 2, 1.4).minus().ellipse(13, 6, 1, 0.6).fill(IRON, { mode: 'flat', tone: 2, inner: false });
    p.rect(19.5, 5, 1.6, 7).fill(WOOD, { mode: 'cyl' });
    p.rect(19.6, 12, 1.4, 11).fill(IRON, { mode: 'cyl' });
  }),
};

function tapestryDraw(p: Painter, i: number, cloth: Ramp, trim: Ramp): void {
  p.capsule(1, 2, 23, 2, 1.1).fill(WOOD, { mode: 'cyl' });
  p.circle(1.5, 2, 1.6).circle(22.5, 2, 1.6).fill(BRASS, { mode: 'sphere' });
  const sw = i === 0 ? 0 : 1;
  const pts = [3, 3, 21, 3, 21 + sw, 30, 20 + sw, 36, 17 + sw, 33, 15 + sw, 39, 12 + sw * 0.5, 34, 9, 38, 7, 33, 4, 37, 3, 31];
  p.poly(pts).fill(cloth, { mode: 'cyl', dither: true });
  p.line(5, 5, 5, 31).line(19, 5, 19 + sw, 30).line(5, 5, 19, 5).fill(trim, { mode: 'flat', tone: 1, inner: false });
  // emblem: a sunburst over a skull
  p.circle(12, 15, 4.2).fill(trim, { mode: 'sphere', light: -0.1, inner: false });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    p.px(12 + Math.cos(a) * 6, 15 + Math.sin(a) * 6, trim[2] as number);
  }
  skull(p, 12, 14.5, 0.8);
  p.line(9 + sw * 0.5, 22, 15 + sw * 0.5, 22).fill(trim, { mode: 'flat', tone: 1, inner: false });
  // moth holes
  p.px(16, 26, 0x050404).px(8, 29, 0x050404).px(9, 29, 0x050404);
}

/** Every new prop (floor clutter, vignette pieces, wall dressing). Keys are `prop:<id>`. */
export const CLUTTER_PROP_SPECS: Record<string, ClutterSpec> = { ...PROPS_A, ...PROPS_B, ...WALL_PROPS };

/** Props that are drawn without the outline pass. */
export const CLUTTER_NO_OUTLINE: readonly string[] = Object.values(CLUTTER_PROP_SPECS)
  .filter((s) => s.outline === false)
  .map((s) => s.key);
