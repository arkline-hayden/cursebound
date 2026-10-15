/**
 * Props of the sky island, moon and server room themes (framework-free): floor clutter, room furniture that stands
 * in for the blocking pieces the simulation carved, wall fixtures and the lights each theme mounts on its walls.
 * Same conventions as clutter.ts / roomProps.ts:
 *  - Light from the top-left; every prop gets the indigo outline pass unless `outline: false`.
 *  - BLOCKERS (`blocks: true`) stand on ONE tile: origin at the centre of its ground diamond, footprint inside it.
 *    `rack_free` spans one tile along world x like `bookcase_free`, so neighbouring racks butt into one long row.
 *  - `hug` props are authored against a NORTH wall (the renderer mirrors them for west walls), at most 48px wide.
 *  - `glow` layers hold only emissive pixels (LEDs, screens, flames, crystals); the body stays lit by Light2D, and a
 *    glow layer with several frames animates (blinking racks, flickering screens) only when animated decor is on.
 *  - Wall props are authored front-facing; the renderer shears them onto block faces.
 */
import { MATERIALS } from './palette';
import { Painter, hash2, rng, type Ramp } from './draw/pixel';
import { STYLES } from './dungeonThemes';
import { DARK, IRON, ROPE, SHADOW, STONE, WOOD, isoBox, onL, onR, onTop, seg, shadow, spec, stone, tinyFlame, wallSpec, type BoxPts, type ClutterSpec, type Pt } from './clutter';

const R = (...c: number[]): Ramp => Object.freeze(c);

// ---------------------------------------------------------------- ramps

const SKY = STYLES.sky, MOON = STYLES.moon, SRV = STYLES.server;
const SANDSTONE = SKY.wall;
const TURF = SKY.growth;
const LEAF = R(0x16300e, 0x285018, 0x3e7a22, 0x5ea432, 0x8ccc50);
const BARK = R(0x1e140c, 0x342416, 0x4e3820, 0x6a4e2e, 0x8a6a40);
const PETALS = R(0x6a2a4a, 0xa04a72, 0xd07aa0, 0xf0b0d0, 0xfff0f8);
const SUN = SKY.accent;
const CRYSTAL = R(0x1a3a6a, 0x2a64a8, 0x58a0e0, 0xa8dcff, 0xf0faff);
const REGOLITH = MOON.floor;
const BASALT = MOON.floor2!;
const ALU = MOON.accent;
const SUIT = R(0x4a4c54, 0x7a7e88, 0xaab0bc, 0xd4dae4, 0xf4f8ff);
const VISOR = R(0x2a1a04, 0x5a3a08, 0x9a6a14, 0xd8a838, 0xfff0a8);
const HAZARD_Y = 0xd8a020, HAZARD_K = 0x18181c;
const BEACON = R(0x3a0606, 0x7a1010, 0xd02a1e, 0xff7a5a, 0xffd8c8);
const STEEL = R(0x14171e, 0x262c38, 0x3a4256, 0x56607a, 0x8a96b0);
const GUNMETAL = R(0x06070a, 0x0c0e12, 0x14171c, 0x1c2028, 0x262c36);
const CYAN = SRV.growth;
const MAGENTA = SRV.accent;
const COOLANT = SRV.pool;
const LED_G = 0x5aff7a, LED_A = 0xffb030;
const CABLES: Ramp[] = [R(0x060608, 0x101014, 0x1c1c22, 0x2a2a32, 0x3c3c46), R(0x200608, 0x40100e, 0x6a1c18, 0x983028, 0xc04c40), R(0x06141e, 0x0c2a3a, 0x164a62, 0x2a7090, 0x4a9ac0), R(0x1a1a06, 0x3a3a0e, 0x6a6a18, 0x9a9a2a, 0xc8c84a)];
const PCB = R(0x06200c, 0x0e3a18, 0x1a5a28, 0x2a7a3a, 0x48a058);

/** The points of a 2:1 iso box without drawing it (for glow layers that must line up with their body). */
function boxPts(fx: number, fy: number, a: number, b: number, h: number): BoxPts {
  return { F: { x: fx, y: fy }, L: { x: fx - a, y: fy - a / 2 }, R: { x: fx + b, y: fy - b / 2 }, B: { x: fx - a + b, y: fy - a / 2 - b / 2 }, h };
}

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// ---------------------------------------------------------------- server racks

interface RackGeom { F: Pt; A: number; Bd: number; H: number }
const RACK_FREE: RackGeom = { F: { x: 33, y: 75 }, A: 32, Bd: 16, H: 50 };
const RACK_HUG: RackGeom = { F: { x: 32, y: 71 }, A: 28, Bd: 10, H: 52 };
const RACK_SMALL: RackGeom = { F: { x: 18, y: 33 }, A: 12, Bd: 9, H: 22 };

/** A server rack: a steel cabinet whose long lit face is a perforated door over blinking units. */
function rackDraw(p: Painter, g: RackGeom, seed: number, toppled = false): BoxPts {
  const { F, A, Bd, H } = g;
  p.poly([F.x, F.y + 2, F.x - A - 1, F.y - A / 2 + 1, F.x - A + Bd, F.y - (A + Bd) / 2, F.x + Bd + 1, F.y - Bd / 2 + 1]).fill(SHADOW, { mode: 'flat', tone: 0, inner: false, alpha: 80 });
  const b = isoBox(p, F.x, F.y, A, Bd, H, GUNMETAL, { left: STEEL, ll: -0.1, rl: -0.55, tl: 0.25 });
  // the door: a dark inset mesh between the frame posts, unit rails across it
  const i0 = onL(b, 0.07, 3), i1 = onL(b, 0.93, 3), i2 = onL(b, 0.93, H - 3), i3 = onL(b, 0.07, H - 3);
  p.poly([i0.x, i0.y, i1.x, i1.y, i2.x, i2.y, i3.x, i3.y]).fill(GUNMETAL, { mode: 'flat', tone: 1, inner: false });
  for (let z = 6; z < H - 4; z += 5) seg(p, onL(b, 0.08, z), onL(b, 0.92, z));
  p.fill(GUNMETAL, { mode: 'flat', tone: 3, inner: false });
  const r = rng(seed);
  for (let z = 5; z < H - 4; z += 2) for (let s = 0.12; s < 0.9; s += 0.07) if (((z + Math.round(s * 30)) & 1) === 0 && r() < 0.75) {
    const q = onL(b, s, z);
    p.px(q.x, q.y, 0x020203);
  }
  // frame posts, handle, label strip and the end panel's vent slots
  for (const s of [0.02, 0.98]) seg(p, onL(b, s, 1), onL(b, s, H - 1));
  p.fill(STEEL, { mode: 'flat', tone: 3, inner: false });
  seg(p, onL(b, 0.86, H * 0.4), onL(b, 0.86, H * 0.6)).fill(STEEL, { mode: 'flat', tone: 4, inner: false });
  for (let z = 6; z < H - 6; z += 3) seg(p, onR(b, 0.25, z), onR(b, 0.75, z));
  p.fill(GUNMETAL, { mode: 'flat', tone: 0, inner: false });
  const t = onTop(b, 0.5, 0.5);
  if (!toppled) p.px(t.x, t.y, STEEL[4]!);
  return b;
}

/** Blinking LED dots on a rack's door (glow layer; frame f decides which are lit). */
function rackLeds(p: Painter, g: RackGeom, seed: number, f: number): void {
  const b = boxPts(g.F.x, g.F.y, g.A, g.Bd, g.H);
  for (let z = 8, row = 0; z < g.H - 4; z += 5, row++) {
    for (let k = 0; k < 4; k++) {
      const s = 0.14 + k * 0.05 + (hash2(row, k, seed) > 0.5 ? 0.02 : 0);
      const q = onL(b, s, z);
      const on = hash2(row * 7 + k, f, seed + 3) > (k === 0 ? 0.15 : 0.45);
      if (!on) continue;
      const c = k === 0 ? LED_G : hash2(row, k, seed + 1) > 0.8 ? LED_A : hash2(row, k, seed + 2) > 0.85 ? MAGENTA[3]! : CYAN[3]!;
      p.gpx(q.x, q.y, c, c);
    }
    // a status bar per unit near the handle
    if (hash2(row, f, seed + 9) > 0.3) {
      const q = onL(b, 0.72, z - 1);
      p.gpx(q.x, q.y, CYAN[2]!, CYAN[1]!).gpx(q.x + 1, q.y + 0.5, CYAN[3]!, CYAN[1]!);
    }
  }
}

const RACK_GLOW = (g: RackGeom, seed: number) => ({ frames: 4, durations: [260, 180, 320, 220], draw: (p: Painter, i: number) => rackLeds(p, g, seed, i) });

// ---------------------------------------------------------------- sky

function tuftDraw(p: Painter, cx: number, by: number, n: number, seed: number, h = 7): void {
  const r = rng(seed);
  for (let k = 0; k < n; k++) {
    const x = cx + (r() - 0.5) * 12;
    const lean = (r() - 0.3) * 3;
    p.line(x, by, x + lean, by - h * (0.5 + r() * 0.6));
  }
  p.fill(TURF, { mode: 'flat', tone: 2, inner: false });
  for (let k = 0; k < n; k++) {
    const x = cx + (r() - 0.5) * 11;
    p.line(x, by, x + (r() - 0.2) * 2, by - h * (0.3 + r() * 0.5));
  }
  p.fill(TURF, { mode: 'flat', tone: 4, inner: false });
}

function boulderDraw(p: Painter, cx: number, by: number, s: number, ramp: Ramp, moss: boolean, seed: number): void {
  shadow(p, cx + 1, by, 11 * s, 3.5 * s, 85);
  const r = rng(seed);
  p.poly([cx - 10 * s, by, cx - 8 * s, by - 7 * s, cx - 3 * s, by - 11 * s, cx + 4 * s, by - 10 * s, cx + 9 * s, by - 5 * s, cx + 10 * s, by]).fill(ramp, { mode: 'sphere', dither: true, light: 0.1 });
  p.poly([cx - 3 * s, by - 11 * s, cx + 4 * s, by - 10 * s, cx + 2 * s, by - 6 * s, cx - 4 * s, by - 7 * s]).fill(ramp, { mode: 'emboss', light: 0.45, inner: false });
  seg(p, { x: cx + 1 * s, y: by - 6 * s }, { x: cx + 3 * s, y: by - 1 }).fill(ramp, { mode: 'flat', tone: 0, inner: false });
  if (moss) {
    for (let k = 0; k < 4; k++) p.ellipse(cx - 6 * s + r() * 8 * s, by - 9 * s + r() * 3 * s, 2.2 * s, 1.2 * s);
    p.fill(TURF, { mode: 'sphere', dither: true, inner: false });
  }
}

function treeDraw(p: Painter): void {
  // a wind-bent tree rooted in the rock: the trunk leans with the gale, the crown streams away from it
  shadow(p, 22, 81, 18, 5, 90);
  p.capsule(18, 80, 22, 60, 3.2, 2.4).capsule(22, 60, 30, 40, 2.4, 1.6).capsule(26, 50, 14, 38, 1.4, 0.8).fill(BARK, { mode: 'cyl', dither: true });
  p.capsule(16, 80, 8, 84, 1.6, 0.8).capsule(20, 80, 30, 85, 1.6, 0.8).fill(BARK, { mode: 'cyl' });
  const r = rng(77);
  for (let k = 0; k < 16; k++) p.ellipse(30 + (r() - 0.35) * 26, 32 + (r() - 0.5) * 22, 5 + r() * 4, 3.5 + r() * 3);
  p.fill(LEAF, { mode: 'sphere', dither: true, light: 0.05 });
  for (let k = 0; k < 9; k++) p.ellipse(32 + (r() - 0.3) * 18, 26 + (r() - 0.5) * 12, 3 + r() * 2, 2 + r() * 1.5);
  p.fill(LEAF, { mode: 'sphere', dither: true, light: 0.45, inner: false });
  for (let k = 0; k < 6; k++) p.px(26 + r() * 26, 22 + r() * 22, PETALS[3]!);
}

function obeliskStoneDraw(p: Painter): void {
  shadow(p, 16, 57, 13, 4.5, 90);
  const b = isoBox(p, 21, 62, 12, 10, 4, SANDSTONE, { dither: true });
  const t = onTop(b, 0.5, 0.5);
  p.poly([t.x - 6, t.y + 2, t.x + 6, t.y + 2, t.x + 4, t.y - 40, t.x, t.y - 46, t.x - 4, t.y - 40]).fill(SANDSTONE, { mode: 'cyl', dither: true, cx: t.x - 1 });
  p.poly([t.x, t.y - 46, t.x + 4, t.y - 40, t.x + 6, t.y + 2, t.x + 2, t.y + 2]).fill(SANDSTONE, { mode: 'emboss', light: -0.45, inner: false });
  for (let k = 0; k < 4; k++) p.ellipse(t.x - 4 + k * 2.5, t.y - 2 - k * 1.5, 2, 1.2);
  p.fill(TURF, { mode: 'sphere', dither: true, inner: false });
}

function obeliskStoneGlow(p: Painter, f: number): void {
  const t = { x: 16, y: 55 };
  const lit = [0, 1, 2, 1][f % 4]!;
  for (let a = 0; a < Math.PI * 2; a += 0.5) p.gpx(t.x - 1 + Math.cos(a) * 2.6, t.y - 28 + Math.sin(a) * 2.6, SUN[3 + (lit > 1 ? 1 : 0)]!, SUN[2]!);
  for (let k = 0; k < 3; k++) p.gpx(t.x - 1, t.y - 18 - k * 4, SUN[k === lit ? 4 : 3]!, SUN[2]!);
}

function crystalDraw(p: Painter, f: number): void {
  // a sky shard crystal hovering over its socket stone, bobbing a pixel as it turns
  shadow(p, 12, 30, 7, 2, 70);
  stone(p, 12, 28, 6, 2.6, SANDSTONE, 0.2);
  const lift = [0, -1, -1, 0][f % 4]!;
  p.poly([12, 4 + lift, 17, 13 + lift, 12, 23 + lift, 7, 13 + lift]).fill(CRYSTAL, { mode: 'facet', facets: 4, rot: 0.3 });
  p.poly([12, 4 + lift, 14, 13 + lift, 12, 23 + lift]).fill(CRYSTAL, { mode: 'flat', tone: 4, inner: false, alpha: 120 });
}

function lanternSkyDraw(p: Painter): void {
  // a brass lantern hung from an iron bracket
  p.line(2, 4, 10, 4).line(9, 4, 9, 8).fill(IRON, { mode: 'flat', tone: 2, inner: false });
  p.rect(5, 8, 8, 11).fill(MATERIALS.brass, { mode: 'emboss' });
  p.rect(6.5, 10, 5, 7).fill(R(0x5a3a08, 0x9a6a14, 0xe0a83a, 0xffd878, 0xfff4c8), { mode: 'flat', tone: 3, inner: false });
  p.poly([5, 8, 9, 5, 13, 8]).fill(MATERIALS.brass, { mode: 'emboss', light: 0.3 });
  p.rect(6, 19, 6, 1.6).fill(MATERIALS.brass, { mode: 'emboss' });
}

function flagsDraw(p: Painter, f: number): void {
  const cols: Ramp[] = [MATERIALS.bloodRed, R(0x14306a, 0x2050a0, 0x3a78d0, 0x6aa8f0, 0xb0d8ff), R(0x6a5a10, 0xa08a20, 0xd0b838, 0xf0e070, 0xfff8c0), R(0x1a4a1a, 0x2a7a2a, 0x3aa83a, 0x70d070, 0xb0f0b0), R(0x8a8a8a, 0xb4b4b4, 0xdadada, 0xf0f0f0, 0xffffff)];
  p.line(0, 2, 30, 6).fill(ROPE, { mode: 'flat', tone: 3, inner: false });
  for (let k = 0; k < 6; k++) {
    const x = 1 + k * 5, y = 2 + x * 0.13;
    const sw = Math.sin((f + k) * 1.6) * 1.2;
    p.poly([x, y, x + 4, y + 0.6, x + 4 + sw, y + 7, x + sw * 0.5, y + 6.4]).fill(cols[k % cols.length]!, { mode: 'cyl', inner: false });
  }
}

// ---------------------------------------------------------------- moon

function moonrockDraw(p: Painter, i: number): void {
  boulderDraw(p, 14, 20, i === 1 ? 0.8 : 1, i === 2 ? BASALT : REGOLITH, false, 41 + i);
  p.ellipse(10, 11 + (i === 1 ? 2 : 0), 4, 1.4).fill(MOON.growth, { mode: 'flat', tone: 3, inner: false, alpha: 150 });
}

function monolithDraw(p: Painter): void {
  // the black monolith: a slab of perfect dark that should not be here
  shadow(p, 16, 61, 13, 4, 110);
  const b = isoBox(p, 22, 66, 14, 6, 50, R(0x020203, 0x050507, 0x0a0a0e, 0x121218, 0x1c1c26), { ll: 0.05, rl: -0.6, tl: 0.6 });
  seg(p, onL(b, 0.02, 1), onL(b, 0.02, 49)).fill(R(0x2a2a3a, 0x3a3a50, 0x50506a, 0x6a6a88, 0x9090b0), { mode: 'flat', tone: 3, inner: false });
}

function monolithGlow(p: Painter, f: number): void {
  const b = boxPts(22, 66, 14, 6, 50);
  const z = 8 + ((f * 9) % 34);
  for (const s of [0.3, 0.5, 0.7]) { const q = onL(b, s, z); p.gpx(q.x, q.y, 0x9ab0ff, 0x3a4a9a); }
}

function suitDraw(p: Painter): void {
  // an empty pressure suit slumped on its rack, visor cracked
  shadow(p, 12, 41, 9, 3, 85);
  p.rect(4, 6, 1.6, 36).rect(19, 6, 1.6, 36).rect(4, 6, 17, 1.6).fill(ALU, { mode: 'cyl' });
  p.capsule(9, 38, 9, 28, 2.4, 2.2).capsule(15, 38, 15, 28, 2.4, 2.2).fill(SUIT, { mode: 'cyl' });
  p.poly([6, 28, 18, 28, 19, 15, 16, 12, 8, 12, 5, 15]).fill(SUIT, { mode: 'cyl', dither: true });
  p.rect(9, 18, 6, 5).fill(R(0x2a2e36, 0x48505e, 0x6e7a8c, 0x9aa8bc, 0xd0dcec), { mode: 'emboss' });
  p.px(10, 19, BEACON[3]!).px(13, 19, 0x5aff7a);
  p.capsule(6, 15, 4, 25, 1.8, 1.6).capsule(18, 15, 20, 25, 1.8, 1.6).fill(SUIT, { mode: 'cyl' });
  p.ellipse(12, 8.5, 5, 4.6).fill(SUIT, { mode: 'sphere' });
  p.ellipse(12.5, 9, 3.4, 2.8).fill(VISOR, { mode: 'sphere', light: 0.2, inner: false });
  p.line(11, 8, 14, 10.5).fill(R(0x0a0a0a, 0x0a0a0a, 0x0a0a0a, 0x0a0a0a, 0x0a0a0a), { mode: 'flat', inner: false });
}

function roverDraw(p: Painter): void {
  // a dead six-wheeled rover with its mast folded, dust on every surface
  shadow(p, 24, 30, 22, 5, 90);
  for (const [x, y] of [[8, 28], [18, 31], [28, 33], [22, 22], [32, 25], [42, 27]] as const) p.ellipse(x, y, 3.2, 2.6);
  p.fill(R(0x0c0c0e, 0x18181c, 0x26262c, 0x36363e, 0x4a4a54), { mode: 'sphere' });
  const b = isoBox(p, 30, 28, 22, 12, 7, ALU, { tl: 0.4, dither: true });
  const t = onTop(b, 0.3, 0.6);
  p.rect(t.x - 1, t.y - 14, 2, 14).fill(ALU, { mode: 'cyl' });
  p.rect(t.x - 4, t.y - 18, 8, 4).fill(R(0x10203a, 0x1c3a66, 0x3a6aa0, 0x7aa8d8, 0xc8e4ff), { mode: 'emboss' });
  const sp = onTop(b, 0.75, 0.3);
  p.poly([sp.x - 9, sp.y, sp.x + 3, sp.y - 6, sp.x + 9, sp.y - 3, sp.x - 3, sp.y + 3]).fill(R(0x0a1428, 0x14284a, 0x22427a, 0x3a64a8, 0x6a94d0), { mode: 'emboss', light: 0.3 });
  for (let k = 0; k < 3; k++) seg(p, { x: sp.x - 7 + k * 4, y: sp.y + 1 - k * 2 }, { x: sp.x - 4 + k * 4, y: sp.y - 2 - k * 2 });
  p.fill(R(0x2a3a5a, 0x2a3a5a, 0x2a3a5a, 0x2a3a5a, 0x2a3a5a), { mode: 'flat', inner: false });
  p.ellipse(18, 21, 6, 1.2).fill(MOON.growth, { mode: 'flat', tone: 3, inner: false, alpha: 140 });
}

function solarDraw(p: Painter): void {
  shadow(p, 16, 25, 13, 3.5, 80);
  p.rect(15, 14, 2, 11).fill(ALU, { mode: 'cyl' });
  p.poly([2, 14, 20, 5, 30, 10, 12, 19]).fill(R(0x0a1428, 0x14284a, 0x22427a, 0x3a64a8, 0x6a94d0), { mode: 'emboss', light: 0.35 });
  for (let k = 1; k < 4; k++) seg(p, { x: 2 + k * 4.5, y: 14 - k * 2.25 + k * 0 }, { x: 12 + k * 4.5, y: 19 - k * 2.25 });
  for (let k = 1; k < 3; k++) seg(p, lerp({ x: 2, y: 14 }, { x: 12, y: 19 }, k / 3), lerp({ x: 20, y: 5 }, { x: 30, y: 10 }, k / 3));
  p.fill(R(0x6a7a9a, 0x6a7a9a, 0x6a7a9a, 0x6a7a9a, 0x6a7a9a), { mode: 'flat', inner: false, alpha: 160 });
  p.poly([20, 5, 30, 10, 28, 12, 22, 9]).fill(R(0x060a14, 0x060a14, 0x060a14, 0x060a14, 0x060a14), { mode: 'flat', inner: false, alpha: 120 });
}

function canisterDraw(p: Painter, i: number): void {
  shadow(p, 9, 22, 7, 2.2, 85);
  const body = i === 1 ? R(0x3a0a08, 0x6a1610, 0x9a2a1a, 0xc8482e, 0xe8784e) : ALU;
  p.ellipse(9, 21, 6, 2.2).rect(3, 7, 12, 14).fill(body, { mode: 'cyl', dither: true });
  p.ellipse(9, 7, 6, 2.2).fill(body, { mode: 'emboss', light: 0.35 });
  for (let x = 3; x < 15; x++) for (let y = 13; y < 16; y++) p.px(x, y + (x - 3) * 0, (x + y) % 4 < 2 ? HAZARD_Y : HAZARD_K);
  p.rect(7.5, 3, 3, 4).fill(IRON, { mode: 'cyl' });
}

function debrisPanelDraw(p: Painter, i: number): void {
  const r = rng(91 + i);
  p.poly([3, 10 + r() * 2, 18, 3 + r() * 2, 29, 8, 14, 15]).fill(ALU, { mode: 'emboss', light: 0.3, dither: true });
  for (let k = 0; k < 3; k++) p.px(8 + k * 6, 9 - k * 2, ALU[4]!);
  seg(p, { x: 6, y: 11 }, { x: 25, y: 7 }).fill(ALU, { mode: 'flat', tone: 1, inner: false });
  if (i === 1) for (let x = 14; x < 24; x++) p.px(x, 12 - (x - 14) * 0.45, (x % 4 < 2) ? HAZARD_Y : HAZARD_K);
  p.ellipse(22, 12, 4, 1.2).fill(MOON.growth, { mode: 'flat', tone: 2, inner: false, alpha: 150 });
}

function landerDraw(p: Painter): void {
  // the wreck of a lander on three splayed legs, gold foil peeling off its descent stage
  shadow(p, 24, 46, 22, 5, 95);
  const FOIL = R(0x4a3008, 0x8a6418, 0xc89a30, 0xf0d070, 0xfff4c0);
  for (const [x0, x1] of [[8, 14], [40, 32], [26, 24]] as const) p.capsule(x0, 46, x1, 28, 1, 1);
  p.fill(ALU, { mode: 'cyl' });
  for (const x of [8, 40, 26]) p.ellipse(x, 46, 3, 1.2).fill(ALU, { mode: 'emboss' });
  const b = isoBox(p, 30, 36, 16, 12, 12, FOIL, { dither: true, tl: 0.4 });
  for (let k = 0; k < 5; k++) { const q = onL(b, 0.15 + k * 0.17, 6 + (k % 2) * 3); p.px(q.x, q.y, FOIL[4]!); }
  const t = onTop(b, 0.5, 0.5);
  p.poly([t.x - 9, t.y, t.x - 6, t.y - 14, t.x + 6, t.y - 14, t.x + 9, t.y]).fill(ALU, { mode: 'cyl', dither: true });
  p.ellipse(t.x - 2, t.y - 8, 2.6, 2.6).fill(R(0x0a1830, 0x183a6a, 0x3a70b0, 0x7ab0e8, 0xd0ecff), { mode: 'sphere', inner: false });
  p.capsule(t.x + 4, t.y - 14, t.x + 7, t.y - 22, 0.6, 0.5).fill(ALU, { mode: 'cyl' });
  p.ellipse(t.x + 7, t.y - 23, 3, 1.6).fill(ALU, { mode: 'emboss', light: 0.3 });
}

function lampPostDraw(p: Painter): void {
  shadow(p, 8, 45, 6, 2, 80);
  p.rect(7, 10, 2, 35).fill(ALU, { mode: 'cyl' });
  for (let y = 36; y < 44; y++) for (let x = 6; x < 10; x++) p.px(x, y, (x + y) % 4 < 2 ? HAZARD_Y : HAZARD_K);
  p.poly([3, 10, 13, 10, 11, 5, 5, 5]).fill(ALU, { mode: 'emboss', light: 0.3 });
  p.rect(4, 10, 8, 2).fill(R(0x8a9ab0, 0xb8c8dc, 0xe0ecf8, 0xf4faff, 0xffffff), { mode: 'flat', tone: 3, inner: false });
}

function flagPoleDraw(p: Painter, f: number): void {
  // a planted flag, bleached and torn, held out stiff on its wire as there is no wind to move it
  shadow(p, 6, 61, 5, 1.6, 80);
  p.rect(5, 6, 1.6, 55).fill(ALU, { mode: 'cyl' });
  p.line(6, 7, 22, 7).fill(ALU, { mode: 'flat', tone: 3, inner: false });
  const FLAG = R(0x5a5a64, 0x8a8a96, 0xb4b4c0, 0xd8d8e2, 0xf4f4fa);
  p.poly([7, 8, 22, 8, 22, 18, 17, 17, 15, 19, 7, 18]).fill(FLAG, { mode: 'cyl', dither: true });
  p.rect(8, 9, 5, 4).fill(R(0x14204a, 0x1e3070, 0x2c4498, 0x4a64c0, 0x7a90e0), { mode: 'emboss' });
  for (let k = 0; k < 3; k++) p.line(13, 13 + k * 2, 21, 13 + k * 2);
  p.fill(BEACON, { mode: 'flat', tone: 2, inner: false, alpha: 180 });
  void f;
}

function drillDraw(p: Painter): void {
  // a core drill rig on a tripod, its bit sunk into the ice beneath the regolith
  shadow(p, 16, 41, 14, 4, 90);
  for (const [x0, x1] of [[4, 14], [28, 18], [16, 16]] as const) p.capsule(x0, 41, x1, 10, 1, 0.8);
  p.fill(ALU, { mode: 'cyl' });
  p.rect(13, 12, 6, 12).fill(R(0x3a0a08, 0x6a1610, 0x9a2a1a, 0xc8482e, 0xe8784e), { mode: 'emboss' });
  p.rect(15, 24, 2, 16).fill(IRON, { mode: 'cyl' });
  p.ellipse(16, 40, 5, 1.6).fill(MOON.pool, { mode: 'sphere', inner: false });
}

function flareDraw(p: Painter): void {
  p.capsule(4, 9, 14, 6, 1.4, 1.2).fill(BEACON, { mode: 'cyl' });
  p.ellipse(9, 9, 6, 1.6).fill(R(0x3a0606, 0x3a0606, 0x3a0606, 0x3a0606, 0x3a0606), { mode: 'flat', inner: false, alpha: 60 });
}

// ---------------------------------------------------------------- server

function terminalDraw(p: Painter): void {
  // a standing console: steel pedestal, slanted keyboard, a tall screen whose light is the glow layer
  shadow(p, 13, 33, 11, 3, 90);
  const b = isoBox(p, 18, 34, 12, 8, 14, STEEL, { tl: 0.35, rl: -0.55 });
  const t = onTop(b, 0.5, 0.5);
  p.poly([t.x - 9, t.y + 1, t.x + 4, t.y - 5, t.x + 7, t.y - 3, t.x - 6, t.y + 3]).fill(GUNMETAL, { mode: 'emboss', light: 0.3 });
  for (let k = 0; k < 6; k++) p.px(t.x - 6 + k * 2, t.y + 1 - k, STEEL[3]!);
  p.poly([t.x - 8, t.y - 4, t.x + 4, t.y - 10, t.x + 4, t.y - 26, t.x - 8, t.y - 20]).fill(STEEL, { mode: 'emboss', dither: true });
  p.poly([t.x - 6.5, t.y - 6, t.x + 2.5, t.y - 10.5, t.x + 2.5, t.y - 24, t.x - 6.5, t.y - 19.5]).fill(R(0x010406, 0x021014, 0x04202a, 0x063040, 0x084058), { mode: 'flat', tone: 1, inner: false });
}

function terminalGlow(p: Painter, f: number): void {
  const t = { x: 13, y: 25 };
  const r = rng(300 + f);
  for (let row = 0; row < 6; row++) {
    const len = 2 + Math.floor(r() * 7);
    for (let k = 0; k < len; k++) {
      const x = t.x - 5.5 + k, y = t.y - 18.5 + row * 2 - k * 0.5;
      const c = row === 5 && f % 2 ? MAGENTA[3]! : CYAN[row === 0 ? 4 : 3]!;
      p.gpx(x, y, c, CYAN[1]!);
    }
  }
  if (f === 3) for (let k = 0; k < 8; k++) p.gpx(t.x - 6 + k, t.y - 13 - k * 0.5, MAGENTA[4]!, MAGENTA[2]!);
}

function holoPylonDraw(p: Painter): void {
  // a projector pylon: a steel post whose emitter casts a turning glyph into the air (glow layer)
  shadow(p, 8, 45, 7, 2.2, 85);
  p.rect(6, 22, 4, 23).fill(STEEL, { mode: 'cyl' });
  p.ellipse(8, 44, 5, 1.8).fill(STEEL, { mode: 'emboss' });
  p.ellipse(8, 22, 4, 1.6).fill(GUNMETAL, { mode: 'emboss', light: 0.2 });
}

function holoPylonGlow(p: Painter, f: number, col: Ramp = CYAN): void {
  const cx = 8, cy = 12;
  const a0 = (f / 4) * Math.PI * 0.5;
  for (let k = 0; k < 4; k++) {
    const a = a0 + (k / 4) * Math.PI * 2;
    p.gpx(cx + Math.cos(a) * 5, cy + Math.sin(a) * 2.2, col[3]!, col[1]!);
  }
  for (let y = 15; y < 21; y++) p.gpx(cx, y, col[2]!, col[1]!);
  p.gpx(cx, cy, col[4]!, col[2]!).gpx(cx, cy - 2 - (f % 2), col[3]!, col[1]!);
}

function corePylonDraw(p: Painter): void {
  // the vault's cursed core: a black housing round a column of magenta light, cables feeding it from the floor
  shadow(p, 16, 61, 14, 4.5, 110);
  const b = isoBox(p, 23, 67, 14, 12, 8, STEEL, { tl: 0.3 });
  const t = onTop(b, 0.5, 0.5);
  p.rect(t.x - 6, t.y - 46, 12, 46).fill(GUNMETAL, { mode: 'cyl', dither: true });
  p.rect(t.x - 2.5, t.y - 42, 5, 38).fill(R(0x1a0418, 0x3a0838, 0x6a1060, 0x9a1890, 0xc020b0), { mode: 'cyl', inner: false });
  for (const y of [t.y - 46, t.y - 24, t.y - 2]) p.rect(t.x - 7, y - 1, 14, 3);
  p.fill(STEEL, { mode: 'cyl', inner: false });
  for (let k = 0; k < 4; k++) p.capsule(t.x - 10 + k * 6, t.y + 6 - k, t.x - 4 + k * 2.6, t.y - 2, 1, 1).fill(CABLES[k % 4]!, { mode: 'cyl', inner: false });
}

function corePylonGlow(p: Painter, f: number): void {
  const cx = 16, top = 13, bot = 51;
  for (let y = top; y < bot; y++) {
    const pulse = ((y - top + f * 6) % 12) < 3;
    p.gpx(cx, y, pulse ? MAGENTA[4]! : MAGENTA[3]!, MAGENTA[2]!);
    if (pulse) p.gpx(cx - 1, y, MAGENTA[3]!, MAGENTA[1]!);
  }
}

function coldStorageDraw(p: Painter, v: number): void {
  // a cryo cabinet laid flat like a coffin: frosted window over a shape you would rather not see
  const F = { x: 33, y: 47 };
  p.poly([F.x, F.y + 2, F.x - 33, F.y - 15.5, F.x - 32 + 14, F.y - 23, F.x + 15, F.y - 6]).fill(SHADOW, { mode: 'flat', tone: 0, inner: false, alpha: 80 });
  const b = isoBox(p, F.x, F.y, 32, 14, 12, STEEL, { tl: 0.35, rl: -0.5 });
  const w0 = onTop(b, 0.15, 0.25), w1 = onTop(b, 0.85, 0.25), w2 = onTop(b, 0.85, 0.75), w3 = onTop(b, 0.15, 0.75);
  p.poly([w0.x, w0.y, w1.x, w1.y, w2.x, w2.y, w3.x, w3.y]).fill(R(0x0a1a24, 0x14303e, 0x285a6e, 0x5a94a8, 0xb0dcea), { mode: 'emboss', light: 0.2, dither: true });
  if (v === 0) { const c = onTop(b, 0.35, 0.5); p.ellipse(c.x, c.y, 2.6, 1.6).fill(R(0x3a4a52, 0x5a6e78, 0x7e949e, 0xa6bac2, 0xd0e0e6), { mode: 'sphere', inner: false, alpha: 170 }); }
  for (let k = 0; k < 3; k++) { const q = onL(b, 0.2 + k * 0.3, 6); p.px(q.x, q.y, STEEL[4]!); }
}

function coldStorageGlow(p: Painter, f: number): void {
  const b = boxPts(33, 47, 32, 14, 12);
  const q = onL(b, 0.9, 8);
  p.gpx(q.x, q.y, f % 3 === 0 ? MAGENTA[3]! : CYAN[3]!, CYAN[1]!);
  const q2 = onL(b, 0.82, 8);
  p.gpx(q2.x, q2.y, LED_G, LED_G);
}

function powerCoreDraw(p: Painter): void {
  // a UPS / power core: a squat cabinet with a heat-sink crown and a glowing gauge (glow layer)
  shadow(p, 17, 37, 15, 4.5, 100);
  const b = isoBox(p, 25, 44, 16, 13, 22, STEEL, { tl: 0.3, dither: true });
  for (let z = 4; z < 20; z += 3) seg(p, onR(b, 0.15, z), onR(b, 0.85, z));
  p.fill(GUNMETAL, { mode: 'flat', tone: 0, inner: false });
  const t = onTop(b, 0.5, 0.5);
  for (let k = -3; k <= 3; k++) p.rect(t.x + k * 2 - 0.5, t.y - 5 + Math.abs(k) * 0.4, 1, 5);
  p.fill(STEEL, { mode: 'cyl', inner: false });
  const g0 = onL(b, 0.25, 12), g1 = onL(b, 0.75, 12), g2 = onL(b, 0.75, 18), g3 = onL(b, 0.25, 18);
  p.poly([g0.x, g0.y, g1.x, g1.y, g2.x, g2.y, g3.x, g3.y]).fill(R(0x010406, 0x021014, 0x04202a, 0x063040, 0x084058), { mode: 'flat', tone: 1, inner: false });
}

function powerCoreGlow(p: Painter, f: number): void {
  const b = boxPts(25, 44, 16, 13, 22);
  const n = 2 + (f % 4);
  for (let k = 0; k < 5; k++) {
    const q = onL(b, 0.3 + k * 0.1, 15);
    p.gpx(q.x, q.y, k < n ? (k > 3 ? LED_A : CYAN[3]!) : CYAN[1]!, CYAN[1]!);
  }
  const s = onL(b, 0.85, 6);
  p.gpx(s.x, s.y, f % 2 ? LED_G : 0x2a6a3a, LED_G);
}

function containmentDraw(p: Painter): void {
  // a containment pod: a glass cylinder of glowing fluid with something curled inside
  shadow(p, 16, 57, 12, 4, 100);
  p.ellipse(16, 56, 11, 4).fill(STEEL, { mode: 'emboss' });
  p.rect(7, 14, 18, 40).fill(R(0x02181e, 0x063a44, 0x0e7080, 0x30c8d8, 0xb0fcff), { mode: 'cyl', dither: true, alpha: 210 });
  p.ellipse(16, 34, 4, 6).capsule(15, 28, 13, 40, 2, 1.4).fill(R(0x10201e, 0x1e3a36, 0x2e5650, 0x46766e, 0x6a9a90), { mode: 'sphere', inner: false, alpha: 200 });
  p.ellipse(16, 14, 10, 3.6).fill(STEEL, { mode: 'emboss', light: 0.3 });
  p.rect(6, 52, 20, 3).rect(6, 10, 20, 4).fill(STEEL, { mode: 'cyl', inner: false });
  p.line(10, 18, 10, 48).fill(R(0xd0fcff, 0xd0fcff, 0xd0fcff, 0xd0fcff, 0xd0fcff), { mode: 'flat', inner: false, alpha: 120 });
}

function containmentGlow(p: Painter, f: number): void {
  for (let k = 0; k < 6; k++) {
    const x = 9 + ((k * 5 + f * 3) % 14), y = 50 - ((f * 7 + k * 9) % 34);
    p.gpx(x, y, COOLANT[4]!, COOLANT[2]!);
  }
}

function rackToppledDraw(p: Painter, v: number): void {
  // a rack that came down: lying on its back, door torn open, cards spilled across the floor
  shadow(p, 18, 18, 17, 5, 95);
  const b = isoBox(p, 30, 24, 26, 12, 10, GUNMETAL, { left: STEEL, tl: 0.2, rl: -0.5 });
  const t0 = onTop(b, 0.1, 0.2), t1 = onTop(b, 0.9, 0.2), t2 = onTop(b, 0.9, 0.8), t3 = onTop(b, 0.1, 0.8);
  p.poly([t0.x, t0.y, t1.x, t1.y, t2.x, t2.y, t3.x, t3.y]).fill(GUNMETAL, { mode: 'flat', tone: 1, inner: false });
  for (let k = 0; k < 4; k++) seg(p, onTop(b, 0.2 + k * 0.2, 0.25), onTop(b, 0.2 + k * 0.2, 0.75));
  p.fill(STEEL, { mode: 'flat', tone: 3, inner: false });
  const r = rng(71 + v);
  for (let k = 0; k < 4; k++) p.rect(2 + r() * 12, 22 + r() * 6, 4, 2).fill(PCB, { mode: 'emboss', inner: false });
}

function upsDraw(p: Painter, v: number): void {
  shadow(p, 14, 24, 12, 3.5, 90);
  const b = isoBox(p, 20, 27, 13, 9, 12, STEEL, { tl: 0.35 });
  for (let z = 3; z < 11; z += 2) seg(p, onR(b, 0.2, z), onR(b, 0.8, z));
  p.fill(GUNMETAL, { mode: 'flat', tone: 0, inner: false });
  const q = onL(b, 0.3, 8);
  p.px(q.x, q.y, v ? LED_A : LED_G);
}

function serverCartDraw(p: Painter): void {
  shadow(p, 16, 28, 14, 4, 85);
  for (const [x, y] of [[6, 26], [18, 30], [26, 25], [14, 21]] as const) p.ellipse(x, y, 1.8, 1.4);
  p.fill(GUNMETAL, { mode: 'sphere' });
  const b = isoBox(p, 20, 26, 14, 10, 4, STEEL, { tl: 0.4 });
  const t = onTop(b, 0.5, 0.5);
  isoBox(p, t.x + 4, t.y + 2, 10, 7, 6, GUNMETAL, { left: STEEL, tl: 0.3 });
  p.capsule(t.x + 8, t.y - 1, t.x + 12, t.y - 12, 0.7, 0.7).fill(STEEL, { mode: 'cyl' });
}

function cableCoilDraw(p: Painter, i: number): void {
  const r = rng(51 + i);
  for (let k = 0; k < 3; k++) {
    const cx = 14 + (r() - 0.5) * 8, cy = 10 + (r() - 0.5) * 3, rx = 6 + r() * 4, ry = 2.6 + r() * 1.4;
    for (let a = 0; a < Math.PI * 2; a += 0.12) p.circle(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 0.9);
    p.fill(CABLES[(k + i) % 4]!, { mode: 'cyl', inner: false });
  }
  p.capsule(22, 11, 30, 14, 0.9, 0.9).fill(CABLES[(i + 1) % 4]!, { mode: 'cyl', inner: false });
  p.rect(28, 13, 3, 2).fill(STEEL, { mode: 'emboss', inner: false });
}

function chipDebrisDraw(p: Painter, i: number): void {
  const r = rng(61 + i);
  for (let k = 0; k < 4; k++) {
    const x = 4 + r() * 18, y = 4 + r() * 8;
    p.poly([x, y + 2, x + 5, y, x + 8, y + 1.5, x + 3, y + 3.5]).fill(PCB, { mode: 'emboss', light: 0.2, inner: false });
    p.px(x + 4, y + 1.5, k % 2 ? STEEL[4]! : 0x101010);
  }
  for (let k = 0; k < 5; k++) p.px(3 + r() * 22, 3 + r() * 10, STEEL[3]!);
}

function floorVentDraw(p: Painter): void {
  p.poly([2, 10, 16, 3, 30, 10, 16, 17]).fill(STEEL, { mode: 'emboss', light: 0.3 });
  for (let k = 1; k < 7; k++) seg(p, { x: 2 + k * 2, y: 10 - k }, { x: 16 + k * 2, y: 17 - k });
  p.fill(R(0x010406, 0x021014, 0x04202a, 0x063040, 0x084058), { mode: 'flat', tone: 2, inner: false });
}

function floorVentGlow(p: Painter, f: number): void {
  for (let k = 1; k < 7; k++) {
    const t = (k + f) % 3 === 0;
    const a = { x: 4 + k * 2, y: 11 - k }, b = { x: 14 + k * 2, y: 16 - k };
    for (let s = 0.1; s < 0.95; s += 0.25) { const q = lerp(a, b, s); p.gpx(q.x, q.y, t ? CYAN[3]! : CYAN[2]!, CYAN[1]!); }
  }
}

function dataCrateDraw(p: Painter): void {
  shadow(p, 14, 23, 12, 3.5, 90);
  const b = isoBox(p, 20, 26, 14, 10, 12, GUNMETAL, { left: STEEL, tl: 0.35 });
  for (const z of [3, 9]) seg(p, onL(b, 0.04, z), onL(b, 0.96, z));
  p.fill(GUNMETAL, { mode: 'flat', tone: 0, inner: false });
  for (const s of [0.1, 0.9]) seg(p, onL(b, s, 1), onL(b, s, 11));
  p.fill(STEEL, { mode: 'flat', tone: 4, inner: false });
}

function dataCrateGlow(p: Painter, f: number): void {
  const b = boxPts(20, 26, 14, 10, 12);
  for (let s = 0.2; s < 0.85; s += 0.08) { const q = onL(b, s, 6); p.gpx(q.x, q.y, (Math.round(s * 12) + f) % 4 === 0 ? MAGENTA[3]! : CYAN[2]!, CYAN[1]!); }
}

function coolantTankDraw(p: Painter): void {
  shadow(p, 12, 41, 10, 3, 90);
  p.ellipse(12, 40, 9, 3).rect(3, 10, 18, 30).fill(STEEL, { mode: 'cyl', dither: true });
  p.ellipse(12, 10, 9, 3).fill(STEEL, { mode: 'emboss', light: 0.35 });
  p.rect(10, 16, 4, 20).fill(R(0x02181e, 0x063a44, 0x0e7080, 0x30c8d8, 0xb0fcff), { mode: 'cyl', inner: false });
  for (const y of [14, 38]) p.rect(3, y, 18, 1.6);
  p.fill(STEEL, { mode: 'flat', tone: 1, inner: false });
  p.capsule(20, 18, 24, 24, 1.2, 1.2).fill(STEEL, { mode: 'cyl' });
}

function holoStatueDraw(p: Painter): void {
  // a hologram projector against the wall; the figure itself flickers in the glow layer
  shadow(p, 14, 51, 11, 3.5, 90);
  const b = isoBox(p, 20, 56, 13, 7, 6, STEEL, { tl: 0.35 });
  const t = onTop(b, 0.5, 0.5);
  p.ellipse(t.x, t.y, 4, 1.6).fill(GUNMETAL, { mode: 'emboss', light: 0.3 });
}

function holoStatueGlow(p: Painter, f: number): void {
  const cx = 14, by = 48;
  const shift = f === 2 ? 1 : 0;
  const rows: [number, number][] = [];
  // a hooded figure of scanlines: head, shoulders, robe
  for (let y = by - 34; y < by; y++) {
    const t = (y - (by - 34)) / 34;
    const w = t < 0.15 ? 2.4 : t < 0.25 ? 1.6 : 2.5 + (t - 0.25) * 6;
    rows.push([y, w]);
  }
  for (const [y, w] of rows) {
    if ((y + f) % 2 === 0 && f !== 3) continue;
    for (let x = Math.round(cx - w); x <= Math.round(cx + w); x++) p.gpx(x + (y % 7 === f ? shift : 0), y, (y + f) % 5 === 0 ? CYAN[4]! : CYAN[2]!, CYAN[1]!);
  }
  for (const x of [cx - 1, cx + 1]) p.gpx(x, by - 31, MAGENTA[4]!, MAGENTA[2]!);
}

// ---------------------------------------------------------------- wall fixtures

function neonDraw(p: Painter, col: Ramp): void {
  p.rect(1, 3, 22, 4).fill(GUNMETAL, { mode: 'emboss' });
  p.rect(2, 4, 20, 2).fill(col, { mode: 'flat', tone: 2, inner: false });
  for (const x of [2, 20]) p.rect(x, 2, 2, 6).fill(STEEL, { mode: 'emboss' });
}

function rackWallDraw(p: Painter): void {
  p.rect(1, 1, 26, 34).fill(GUNMETAL, { mode: 'emboss' });
  for (let y = 4; y < 33; y += 4) p.rect(3, y, 22, 1);
  p.fill(STEEL, { mode: 'flat', tone: 2, inner: false });
  for (const x of [1, 26]) p.rect(x, 1, 1, 34);
  p.fill(STEEL, { mode: 'flat', tone: 4, inner: false });
}

function rackWallGlow(p: Painter, f: number): void {
  for (let row = 0; row < 7; row++) for (let k = 0; k < 5; k++) {
    if (hash2(row * 5 + k, f, 801) < 0.45) continue;
    const c = k === 0 ? LED_G : hash2(row, k, 802) > 0.8 ? LED_A : hash2(row, k, 803) > 0.85 ? MAGENTA[3]! : CYAN[3]!;
    p.gpx(4 + k * 3, 6 + row * 4, c, c);
  }
}

function cableWallDraw(p: Painter): void {
  p.rect(0, 0, 24, 3).fill(STEEL, { mode: 'emboss' });
  const r = rng(33);
  for (let k = 0; k < 5; k++) {
    const x = 2 + k * 4.5;
    const L = 16 + r() * 22;
    p.capsule(x, 3, x + Math.sin(k * 1.7) * 2.5, L * 0.6, 1, 1).capsule(x + Math.sin(k * 1.7) * 2.5, L * 0.6, x + Math.sin(k) * 3.5, L, 1, 0.8).fill(CABLES[k % 4]!, { mode: 'cyl', inner: false });
  }
}

function warningDraw(p: Painter): void {
  p.rect(1, 1, 20, 16).fill(GUNMETAL, { mode: 'emboss' });
  for (let x = 2; x < 20; x++) for (const y of [2, 15]) p.px(x, y, (x % 4 < 2) ? HAZARD_Y : HAZARD_K);
}

function warningGlow(p: Painter, f: number): void {
  const on = f !== 2;
  p.poly([11, 4, 16, 13, 6, 13]).minus().poly([11, 6.5, 14, 12, 8, 12]).fill(MAGENTA, { mode: 'flat', tone: on ? 3 : 2, glow: MAGENTA[3]!, inner: false });
  p.gpx(11, 8.5, MAGENTA[4]!, MAGENTA[2]!).gpx(11, 9.5, MAGENTA[4]!, MAGENTA[2]!).gpx(11, 11, MAGENTA[4]!, MAGENTA[2]!);
}

function portholeDraw(p: Painter): void {
  p.ellipse(11, 11, 10, 10).fill(ALU, { mode: 'emboss' });
  p.ellipse(11, 11, 7, 7).fill(R(0x02040a, 0x060a14, 0x0a1220, 0x101a2c, 0x182438), { mode: 'flat', tone: 1, inner: false });
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; p.px(11 + Math.cos(a) * 8.6, 11 + Math.sin(a) * 8.6, ALU[4]!); }
}

function portholeGlow(p: Painter, f: number): void {
  // the stars beyond the glass, and the Earth sliding past
  for (const [x, y] of [[7, 8], [14, 6], [9, 15], [15, 13], [12, 10]] as const) if ((x + y + f) % 3) p.gpx(x, y, 0xe8f0ff, 0x6a7aa0);
  const ex = 6 + f;
  p.gpx(ex, 12, 0x5a9ae8, 0x2a4a8a).gpx(ex + 1, 12, 0x7ac0ff, 0x2a4a8a).gpx(ex, 13, 0x4a9a5a, 0x2a4a8a);
}

function hullVentDraw(p: Painter): void {
  p.rect(1, 1, 22, 16).fill(ALU, { mode: 'emboss' });
  for (let y = 4; y < 15; y += 2) p.rect(3, y, 18, 1);
  p.fill(R(0x0a0b0e, 0x0a0b0e, 0x0a0b0e, 0x0a0b0e, 0x0a0b0e), { mode: 'flat', inner: false });
  for (const [x, y] of [[2, 2], [21, 2], [2, 15], [21, 15]] as const) p.px(x, y, ALU[4]!);
}

function lampMoonDraw(p: Painter): void {
  // a floodlight on a bracket, angled down at the floor
  p.rect(9, 0, 2, 6).fill(ALU, { mode: 'cyl' });
  p.poly([3, 6, 17, 6, 15, 13, 5, 13]).fill(ALU, { mode: 'emboss', light: 0.25 });
  p.rect(5, 11, 10, 2.4).fill(R(0x8a9ab0, 0xb8c8dc, 0xe0ecf8, 0xf4faff, 0xffffff), { mode: 'flat', tone: 4, inner: false });
}

function ivyDraw(p: Painter): void {
  const r = rng(19);
  for (let k = 0; k < 4; k++) {
    let x = 3 + k * 6 + r() * 2;
    for (let y = 0; y < 30 + r() * 12; y += 1.5) {
      x += (r() - 0.5) * 1.6;
      p.dot(x, y);
      if (r() < 0.5) p.ellipse(x + (r() < 0.5 ? -1.6 : 1.6), y, 1.5, 1.1);
    }
  }
  p.fill(LEAF, { mode: 'sphere', dither: true });
}

// ---------------------------------------------------------------- specs

const blocker = { blocks: true } as const;

const SKY_PROPS: Record<string, ClutterSpec> = {
  grass_tuft: spec('grass_tuft', 24, 14, [12, 12], { low: true, variants: true, frames: 3, outline: false }, (p, i) => tuftDraw(p, 12, 12, 9 + i * 3, 11 + i * 7, 8 + i)),
  wildflowers: spec('wildflowers', 26, 14, [13, 11], { low: true, variants: true, frames: 2, outline: false }, (p, i) => {
    tuftDraw(p, 13, 12, 8, 31 + i, 6);
    const r = rng(41 + i);
    for (let k = 0; k < 7; k++) {
      const x = 4 + r() * 18, y = 4 + r() * 6;
      p.px(x, y, k % 3 === 0 ? 0xfff4b8 : i ? PETALS[3]! : 0xffffff).px(x + 1, y, k % 3 === 0 ? SUN[3]! : PETALS[2]!);
    }
  }),
  boulder: spec('boulder', 28, 22, [14, 19], { variants: true, frames: 2 }, (p, i) => boulderDraw(p, 14, 19, i ? 0.8 : 1, SANDSTONE, true, 21 + i)),
  bush: spec('bush', 30, 24, [15, 21], {}, (p) => {
    shadow(p, 15, 21, 12, 3.5, 80);
    const r = rng(29);
    for (let k = 0; k < 10; k++) p.ellipse(15 + (r() - 0.5) * 18, 13 + (r() - 0.5) * 8, 4 + r() * 2, 3 + r() * 2);
    p.fill(LEAF, { mode: 'sphere', dither: true });
    for (let k = 0; k < 5; k++) p.px(6 + r() * 18, 8 + r() * 8, PETALS[3]!);
  }),
  sky_crystal: spec(
    'sky_crystal', 24, 32, [12, 29],
    { light: { color: 0x8ad0ff, radius: 70, intensity: 0.5, flicker: 0.08 }, glow: { frames: 4, durations: [360, 300, 360, 300], draw: (p, i) => { const l = [0, -1, -1, 0][i]!; p.gpx(12, 8 + l, CRYSTAL[4]!, CRYSTAL[2]!).gpx(11, 12 + l, CRYSTAL[3]!, CRYSTAL[2]!).gpx(13, 16 + l, CRYSTAL[3]!, CRYSTAL[2]!); } }, anim: 'prop:sky_crystal', frames: 4, durations: [360, 300, 360, 300] },
    (p, i) => crystalDraw(p, i),
  ),
  lantern_post: spec(
    'lantern_post', 18, 46, [9, 43],
    { light: { color: 0xffd890, radius: 80, intensity: 0.55, flicker: 0.25 }, glow: { frames: 3, durations: [120, 150, 110], draw: (p, i) => { tinyFlame(p, 12, 12, i); p.gpx(11, 13, 0xffe8a0, 0xd08020); } } },
    (p) => {
      shadow(p, 9, 43, 6, 2, 80);
      p.rect(7, 6, 2.4, 37).fill(BARK, { mode: 'cyl' });
      p.line(8, 6, 14, 6).fill(IRON, { mode: 'flat', tone: 2, inner: false });
      p.rect(9.5, 8, 5, 8).fill(MATERIALS.brass, { mode: 'emboss' });
      p.rect(10.5, 9.5, 3, 5).fill(R(0x5a3a08, 0x9a6a14, 0xe0a83a, 0xffd878, 0xfff4c8), { mode: 'flat', tone: 2, inner: false });
      tuftDraw(p, 8, 43, 5, 61, 5);
    },
  ),
  // blockers
  sky_tree: spec('sky_tree', 56, 90, [22, 76], blocker, (p) => treeDraw(p)),
  sky_obelisk: spec('sky_obelisk', 32, 70, [16, 56], { ...blocker, light: { color: 0xffd060, radius: 70, intensity: 0.45, flicker: 0.12 }, glow: { frames: 4, durations: [400, 360, 400, 360], draw: (p, i) => obeliskStoneGlow(p, i) } }, (p) => obeliskStoneDraw(p)),
  standing_stone: spec('standing_stone', 30, 58, [15, 44], { ...blocker, variants: true, frames: 2 }, (p, i) => {
    shadow(p, 15, 44, 12, 4, 90);
    const lean = i ? 2 : -1;
    p.poly([7, 46, 22, 46, 21 + lean, 14, 16 + lean, 6, 10 + lean, 10]).fill(SANDSTONE, { mode: 'cyl', dither: true, cx: 13 });
    p.poly([16 + lean, 6, 21 + lean, 14, 22, 46, 18, 46]).fill(SANDSTONE, { mode: 'emboss', light: -0.5, inner: false });
    for (let k = 0; k < 5; k++) p.ellipse(10 + k * 2, 44 - k * 3 + (k % 2), 2.2, 1.3);
    p.fill(TURF, { mode: 'sphere', dither: true, inner: false });
    tuftDraw(p, 15, 47, 8, 71 + i, 6);
  }),
  boulder_big: spec('boulder_big', 40, 32, [20, 18], { ...blocker, variants: true, frames: 2 }, (p, i) => boulderDraw(p, 20, 28, 1.5, i ? REGOLITH : SANDSTONE, !i, 31 + i)),
  ruin_wall: spec('ruin_wall', 40, 52, [21, 44], { hug: true, hugDepth: 0.24 }, (p) => {
    const b = isoBox(p, 34, 50, 30, 6, 30, SANDSTONE, { dither: true });
    for (let z = 6; z < 30; z += 7) seg(p, onL(b, 0.02, z), onL(b, 0.98, z));
    p.fill(SANDSTONE, { mode: 'flat', tone: 1, inner: false });
    const t0 = onL(b, 0.55, 30), t1 = onL(b, 1, 30);
    p.poly([t0.x, t0.y - 1, t1.x, t1.y - 1, t1.x, t1.y - 12, t0.x + 4, t0.y - 6]).fill(SANDSTONE, { mode: 'emboss', light: 0.2 });
    // ivy spilling down the broken face
    const r = rng(23);
    for (let k = 0; k < 3; k++) {
      let s = 0.2 + k * 0.25, z = 28;
      for (let n = 0; n < 16; n++) {
        s += (r() - 0.5) * 0.04;
        z -= 1.5;
        const q = onL(b, s, z);
        p.dot(q.x, q.y);
        if (r() < 0.5) p.ellipse(q.x + (r() < 0.5 ? -1.4 : 1.4), q.y, 1.4, 1);
      }
    }
    p.fill(LEAF, { mode: 'sphere', dither: true, inner: false });
  }),
  // walls
  lantern_sky: wallSpec('lantern_sky', 18, 22, [0.5, 0], { mount: 52, light: { color: 0xffd890, radius: 120, intensity: 0.6, flicker: 0.2 }, glow: { frames: 3, durations: [130, 150, 120], draw: (p, i) => { tinyFlame(p, 9, 15, i); p.gpx(9, 16, 0xffe8a0, 0xd08020); } } }, (p) => lanternSkyDraw(p)),
  ivy: wallSpec('ivy', 28, 44, [0.5, 0], { outline: false }, (p) => ivyDraw(p)),
  prayer_flags: wallSpec('prayer_flags', 32, 16, [0.5, 0], { mount: 58, anim: 'prop:prayer_flags', frames: 3, durations: [300, 260, 320], sway: true }, (p, i) => flagsDraw(p, i)),
};

const MOON_PROPS: Record<string, ClutterSpec> = {
  moonrock: spec('moonrock', 28, 22, [14, 19], { variants: true, frames: 3 }, (p, i) => moonrockDraw(p, i)),
  moonrock_big: spec('moonrock_big', 40, 32, [20, 18], { ...blocker, variants: true, frames: 2 }, (p, i) => boulderDraw(p, 20, 28, 1.5, i ? BASALT : REGOLITH, false, 51 + i)),
  debris_panel: spec('debris_panel', 32, 18, [16, 10], { low: true, variants: true, frames: 2 }, (p, i) => debrisPanelDraw(p, i)),
  canister: spec('canister', 18, 24, [9, 21], { variants: true, frames: 2 }, (p, i) => canisterDraw(p, i)),
  solar_panel: spec('solar_panel', 32, 28, [16, 25], {}, (p) => solarDraw(p)),
  spacesuit: spec('spacesuit', 24, 44, [12, 41], { hug: true, hugDepth: 0.22 }, (p) => suitDraw(p)),
  rover: spec('rover', 48, 36, [24, 29], {}, (p) => roverDraw(p)),
  lander: spec('lander', 48, 50, [24, 44], {}, (p) => landerDraw(p)),
  drill_rig: spec('drill_rig', 32, 44, [16, 41], {}, (p) => drillDraw(p)),
  flag_pole: spec('flag_pole', 24, 64, [6, 61], {}, (p, i) => flagPoleDraw(p, i)),
  lamp_post_moon: spec('lamp_post_moon', 16, 48, [8, 45], { light: { color: 0xd8ecff, radius: 90, intensity: 0.6, flicker: 0.04 }, glow: { frames: 1, draw: (p) => { for (let x = 5; x < 12; x++) p.gpx(x, 11, 0xf4faff, 0xa8c8f0); } } }, (p) => lampPostDraw(p)),
  flare: spec('flare', 18, 12, [9, 8], { light: { color: 0xff4a30, radius: 70, intensity: 0.6, flicker: 0.4 }, fx: [{ kind: 'smoke', dx: 5, dy: -4, rate: 1.4 }], glow: { frames: 3, durations: [90, 110, 80], draw: (p, i) => { p.gpx(14, 6 - (i % 2), 0xffd0b0, 0xff3a2a).gpx(15, 5, 0xff8a6a, 0xff3a2a); if (i === 1) p.gpx(16, 4, 0xff6a4a, 0xa01414); } } }, (p) => flareDraw(p)),
  monolith: spec('monolith', 32, 74, [16, 60], { ...blocker, glow: { frames: 4, durations: [500, 500, 500, 500], draw: (p, i) => monolithGlow(p, i) } }, (p) => monolithDraw(p)),
  // walls
  lamp_moon: wallSpec('lamp_moon', 20, 14, [0.5, 0], { mount: 56, light: { color: 0xcfe4ff, radius: 130, intensity: 0.7, flicker: 0.03 }, glow: { frames: 1, draw: (p) => { for (let x = 5; x < 15; x++) p.gpx(x, 12, 0xffffff, 0xa8c8f0); } } }, (p) => lampMoonDraw(p)),
  porthole: wallSpec('porthole', 22, 22, [0.5, 1], { mount: 22, glow: { frames: 4, durations: [700, 700, 700, 700], draw: (p, i) => portholeGlow(p, i) } }, (p) => portholeDraw(p)),
  hull_vent: wallSpec('hull_vent', 24, 18, [0.5, 1], { mount: 20 }, (p) => hullVentDraw(p)),
};

const SERVER_PROPS: Record<string, ClutterSpec> = {
  rack_free: spec('rack_free', 50, 80, [25, 63], { ...blocker, glow: RACK_GLOW(RACK_FREE, 501) }, (p) => { rackDraw(p, RACK_FREE, 501); }),
  rack_hug: spec('rack_hug', 44, 76, [23, 61.5], { hug: true, hugDepth: 0.3, glow: RACK_GLOW(RACK_HUG, 511) }, (p) => { rackDraw(p, RACK_HUG, 511); }),
  rack_small: spec('rack_small', 30, 40, [15, 30], { glow: RACK_GLOW(RACK_SMALL, 521) }, (p) => { shadow(p, 14, 31, 10, 3, 85); rackDraw(p, RACK_SMALL, 521); }),
  rack_toppled: spec('rack_toppled', 40, 32, [20, 18], { ...blocker, variants: true, frames: 2, fx: [{ kind: 'sparks', dx: -4, dy: -10, rate: 0.5 }] }, (p, i) => rackToppledDraw(p, i)),
  terminal: spec('terminal', 26, 36, [13, 31], { light: { color: 0x40e8ff, radius: 60, intensity: 0.5, flicker: 0.15 }, glow: { frames: 4, durations: [400, 120, 380, 90], draw: (p, i) => terminalGlow(p, i) } }, (p) => terminalDraw(p)),
  holo_pylon: spec('holo_pylon', 16, 48, [8, 45], { light: { color: 0x40e8ff, radius: 70, intensity: 0.5, flicker: 0.12 }, glow: { frames: 4, durations: [160, 160, 160, 160], draw: (p, i) => holoPylonGlow(p, i) } }, (p) => holoPylonDraw(p)),
  holo_pylon_m: spec('holo_pylon_m', 16, 48, [8, 45], { light: { color: 0xff40e0, radius: 70, intensity: 0.5, flicker: 0.12 }, glow: { frames: 4, durations: [160, 160, 160, 160], draw: (p, i) => holoPylonGlow(p, i, MAGENTA) } }, (p) => holoPylonDraw(p)),
  holo_statue: spec('holo_statue', 28, 58, [14, 50], { hug: true, hugDepth: 0.3, light: { color: 0x40e8ff, radius: 70, intensity: 0.45, flicker: 0.2 }, glow: { frames: 4, durations: [300, 90, 260, 70], draw: (p, i) => holoStatueGlow(p, i) } }, (p) => holoStatueDraw(p)),
  core_pylon: spec('core_pylon', 32, 74, [16, 60], { ...blocker, light: { color: 0xff40e0, radius: 90, intensity: 0.6, flicker: 0.15 }, glow: { frames: 4, durations: [140, 140, 140, 140], draw: (p, i) => corePylonGlow(p, i) } }, (p) => corePylonDraw(p)),
  cold_storage: spec('cold_storage', 50, 50, [25, 35], { ...blocker, variants: true, frames: 2, glow: { frames: 3, durations: [600, 600, 600], draw: (p, i) => coldStorageGlow(p, i) } }, (p, i) => coldStorageDraw(p, i)),
  power_core: spec('power_core', 34, 50, [17, 36], { ...blocker, light: { color: 0x40e8ff, radius: 70, intensity: 0.45, flicker: 0.1 }, fx: [{ kind: 'steam', dx: 0, dy: -30, rate: 0.6 }], glow: { frames: 4, durations: [220, 220, 220, 220], draw: (p, i) => powerCoreGlow(p, i) } }, (p) => powerCoreDraw(p)),
  containment_pod: spec('containment_pod', 32, 62, [16, 50], { ...blocker, light: { color: 0x30c8d8, radius: 70, intensity: 0.5, flicker: 0.1 }, glow: { frames: 4, durations: [200, 200, 200, 200], draw: (p, i) => containmentGlow(p, i) } }, (p) => containmentDraw(p)),
  ups_unit: spec('ups_unit', 28, 30, [14, 21], { variants: true, frames: 2 }, (p, i) => upsDraw(p, i)),
  server_cart: spec('server_cart', 32, 32, [16, 27], {}, (p) => serverCartDraw(p)),
  data_crate: spec('data_crate', 28, 30, [14, 23], { glow: { frames: 4, durations: [200, 200, 200, 200], draw: (p, i) => dataCrateGlow(p, i) } }, (p) => dataCrateDraw(p)),
  coolant_tank: spec('coolant_tank', 26, 44, [12, 41], { fx: [{ kind: 'steam', dx: 10, dy: -24, rate: 0.5 }] }, (p) => coolantTankDraw(p)),
  cable_coil: spec('cable_coil', 32, 18, [16, 10], { low: true, variants: true, frames: 3 }, (p, i) => cableCoilDraw(p, i)),
  chip_debris: spec('chip_debris', 30, 16, [15, 9], { low: true, variants: true, frames: 2 }, (p, i) => chipDebrisDraw(p, i)),
  floor_vent: spec('floor_vent', 32, 20, [16, 10], { flat: true, glow: { frames: 3, durations: [240, 240, 240], draw: (p, i) => floorVentGlow(p, i) } }, (p) => floorVentDraw(p)),
  // walls
  neon_cyan: wallSpec('neon_cyan', 24, 10, [0.5, 0], { mount: 56, light: { color: 0x40e8ff, radius: 130, intensity: 0.75, flicker: 0.06 }, glow: { frames: 2, durations: [900, 70], draw: (p, i) => { for (let x = 2; x < 22; x++) p.gpx(x, 4 + (x % 2), i ? CYAN[2]! : CYAN[4]!, CYAN[2]!); } } }, (p) => neonDraw(p, CYAN)),
  neon_magenta: wallSpec('neon_magenta', 24, 10, [0.5, 0], { mount: 50, light: { color: 0xff40e0, radius: 110, intensity: 0.6, flicker: 0.1 }, glow: { frames: 3, durations: [700, 60, 500], draw: (p, i) => { for (let x = 2; x < 22; x++) if (i !== 1 || x % 3) p.gpx(x, 4 + (x % 2), MAGENTA[4]!, MAGENTA[2]!); } } }, (p) => neonDraw(p, MAGENTA)),
  rack_wall: wallSpec('rack_wall', 28, 36, [0.5, 1], { mount: 44, glow: { frames: 4, durations: [260, 180, 320, 220], draw: (p, i) => rackWallGlow(p, i) } }, (p) => rackWallDraw(p)),
  cable_wall: wallSpec('cable_wall', 24, 44, [0.5, 0], {}, (p) => cableWallDraw(p)),
  warning_sign: wallSpec('warning_sign', 22, 18, [0.5, 1], { mount: 30, glow: { frames: 3, durations: [600, 80, 400], draw: (p, i) => warningGlow(p, i) } }, (p) => warningDraw(p)),
};

/** Every prop of the three themes (keys are `prop:<id>`). */
export const THEME_EXTRA_PROP_SPECS: Record<string, ClutterSpec> = { ...SKY_PROPS, ...MOON_PROPS, ...SERVER_PROPS };

/** Props drawn without the outline pass. */
export const THEME_EXTRA_NO_OUTLINE: readonly string[] = Object.values(THEME_EXTRA_PROP_SPECS)
  .filter((s) => s.outline === false)
  .map((s) => s.key);

void STONE;
void WOOD;
void DARK;
