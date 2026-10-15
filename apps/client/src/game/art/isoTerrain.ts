/**
 * Native 2:1 isometric terrain for every dungeon theme (framework-free).
 *
 * Projection: sim tile (x, y) -> 64x32 diamond, sx = (x - y) * 32, sy = (x + y) * 16. World +x runs to
 * screen lower-right, +y to screen lower-left. The camera sees each block's SW face (screen lower-left,
 * "left face", L) and SE face (screen lower-right, "right face", R). Baked torchlight: top lightest, left
 * face medium, right face darker; Light2D normal maps add the moving relief.
 *
 * Textures (per theme; every colour sheet listed with `normal` also carries a Light2D normal map):
 *   iso:floor:<theme>      64 x 64x32  seamless world-space macro floor (see isoFloor.ts), + normal
 *   iso:floorglow:<theme>  64 x 64x32  unlit emissive floor pixels (forge / fungal / sanctum only)
 *   iso:deco:<theme>       35 x 64x40  tile-aligned floor overlays (DECO_NAMES), + normal
 *   iso:decoglow:<theme>   35 x 64x40  their emissive pixels (themes with glowing overlays)
 *   iso:wall:<theme>       30 x 64x96  full blocks: top diamond rows 0..31, footprint rows 64..95, + normal
 *                                      frames 0-3 plain; then per face variant v: 4 + 2v (L face), 5 + 2v (R face)
 *   iso:wallglow:<theme>   30 x 64x96  unlit emissive wall pixels (lava, runes, candles), same layout
 *   iso:stub:<theme>        4 x 64x48  cut-down front wall: 16 px tall, rough broken top, + normal
 *   iso:cliff:<theme>       6 x 64x88  the floor slab's side face hanging into the chasm under front walls:
 *                                      frames 0-2 under the L face, 3-5 under the R face
 *   iso:void:<theme>        1 x 64x32  very dark diamond
 *   iso:room:<theme>        n x 64x40  per-room floor treatments (isoRoomFloor.ts: rugs, pools, planks, marble, sand,
 *                                      bones, medallions, bridge decks), + normal
 *   iso:roomglow:<theme>    n x 64x40  their emissive pixels (lava pools, sigils, glowing water) where a theme has them
 */
import { MATERIALS, PALETTES } from './palette';
import { Painter, PixelBuffer, Sheet, bayer, hash2, lighten, mix, rng, type Ramp } from './draw/pixel';
import { capTexture, voidFrame } from './dungeonData';
import { STYLES, THEME_IDS, paintShrooms, type Style, type ThemeId } from './dungeonThemes';
import { DIAMOND_TEXEL, LAST_TOP, diamondAB, encodeNormal, faceNormals, luma, mixc, scalec } from './isoKit';
import { DECO_H, DECO_NAMES, DECO_W, FLOOR_GLOW_THEMES, MACRO, buildDecoFrames, buildFloorFrames } from './isoFloor';
import { ROOM_FLOOR_NAMES, buildRoomFloorFrames, roomFloorHasGlow } from './isoRoomFloor';

export { DECO, DECO_NAMES, DECO_TOP, MACRO, isoFloorFrame, type DecoName } from './isoFloor';

/** Face variants shared by every theme (structural rhythm); theme details follow (ISO_WALL_DETAILS). */
export const WALL_STRUCT = ['pilaster', 'archL', 'archR', 'soot', 'damp'] as const;
const PLAIN_FRAMES = 4;
const VARIANT_COUNT = WALL_STRUCT.length + 8;

export const ISO_FRAMES = {
  floor: { w: 64, h: 32, frames: MACRO * MACRO },
  deco: { w: DECO_W, h: DECO_H, frames: DECO_NAMES.length },
  room: { w: DECO_W, h: DECO_H, frames: ROOM_FLOOR_NAMES.length },
  wall: { w: 64, h: 96, frames: PLAIN_FRAMES + VARIANT_COUNT * 2 },
  stub: { w: 64, h: 48, frames: 4 },
  cliff: { w: 64, h: 88, frames: 6 },
  void: { w: 64, h: 32, frames: 1 },
} as const;

export interface IsoKeys {
  floorKey: string;
  wallKey: string;
  stubKey: string;
  voidKey: string;
  decoKey: string;
  cliffKey: string;
  floorGlowKey: string;
  decoGlowKey: string;
  wallGlowKey: string;
  roomKey: string;
  roomGlowKey: string;
}

export function isoKeys(theme: ThemeId): IsoKeys {
  return {
    floorKey: `iso:floor:${theme}`,
    wallKey: `iso:wall:${theme}`,
    stubKey: `iso:stub:${theme}`,
    voidKey: `iso:void:${theme}`,
    decoKey: `iso:deco:${theme}`,
    cliffKey: `iso:cliff:${theme}`,
    floorGlowKey: `iso:floorglow:${theme}`,
    decoGlowKey: `iso:decoglow:${theme}`,
    wallGlowKey: `iso:wallglow:${theme}`,
    roomKey: `iso:room:${theme}`,
    roomGlowKey: `iso:roomglow:${theme}`,
  };
}

/** Normal-map companion key of an iso colour texture. */
export const normalKey = (key: string): string => `${key}:n`;

/** Themes whose wall details include emissive pixels (wallglow sheet exists). */
const WALL_GLOW_THEMES: readonly ThemeId[] = ['catacombs', 'flooded', 'ossuary', 'sanctum', 'fungal', 'forge', 'frost', 'sky', 'moon', 'server'];
/** Themes whose overlays include emissive pixels. */
const DECO_GLOW_THEMES: readonly ThemeId[] = ['sanctum', 'fungal', 'forge', 'server'];

/** Every iso texture key for every theme (manifest), including normal maps. */
export const ISO_TEXTURE_KEYS: readonly string[] = THEME_IDS.flatMap((t) => {
  const k = isoKeys(t);
  const out = [k.floorKey, normalKey(k.floorKey), k.decoKey, normalKey(k.decoKey), k.roomKey, normalKey(k.roomKey), k.wallKey, normalKey(k.wallKey), k.stubKey, normalKey(k.stubKey), k.cliffKey, k.voidKey];
  if (FLOOR_GLOW_THEMES.includes(t)) out.push(k.floorGlowKey);
  if (DECO_GLOW_THEMES.includes(t)) out.push(k.decoGlowKey);
  if (WALL_GLOW_THEMES.includes(t)) out.push(k.wallGlowKey);
  if (roomFloorHasGlow(t)) out.push(k.roomGlowKey);
  return out;
});

const DW = 64;
const DH = 32;
const FW = 32; // face texture width (one face)
const FH = 64; // face texture height (full wall)
const PLINTH = 54; // first plinth row in face texture space
const CORNICE = 5; // rows of the projecting top course
const EDGE_DARK = 0x0b0809;
const D = PALETTES.dungeon;

const CATACOMBS_STYLE: Style = {
  floor: D.floor,
  mortar: D.mortar,
  growth: D.moss,
  pool: D.water,
  wall: D.brick,
  cap: D.cap,
  accent: D.rust,
  void: D.void,
};

function styleOf(theme: ThemeId): Style {
  return theme === 'catacombs' ? CATACOMBS_STYLE : STYLES[theme];
}

const R = (...c: number[]): Ramp => Object.freeze(c);

/** Masonry ramps of the wall faces (a touch lighter than the floors so walls read as walls). */
const WALL_RAMP: Record<ThemeId, Ramp> = {
  catacombs: R(0x1a1411, 0x2c231d, 0x40342b, 0x584739, 0x74604c),
  flooded: R(0x0d1518, 0x18252a, 0x26383e, 0x384e56, 0x566e76),
  ossuary: R(0x2a2218, 0x463b2a, 0x63553e, 0x806f52, 0xa08e6c),
  sanctum: R(0x0a0608, 0x150e11, 0x22181c, 0x342529, 0x504048),
  fungal: R(0x140f0b, 0x241b13, 0x382a1d, 0x4e3e2d, 0x685640),
  forge: R(0x0c0a0c, 0x181518, 0x242024, 0x332d32, 0x4a4248),
  frost: R(0x152030, 0x233448, 0x364c66, 0x52708c, 0x86aac8),
  sky: R(0x3a3020, 0x5a4c34, 0x7c6c4c, 0xa08e68, 0xc4b48a),
  moon: R(0x26272e, 0x3a3c44, 0x52545e, 0x6e707c, 0x92949e),
  server: R(0x10131a, 0x1c2230, 0x2a3244, 0x3e485e, 0x5a667e),
};

const PLINTH_RAMP: Record<ThemeId, Ramp> = {
  catacombs: R(0x14100d, 0x241e19, 0x382f27, 0x4d4237, 0x665848),
  flooded: R(0x0a1215, 0x152328, 0x223439, 0x324850, 0x4a6268),
  ossuary: R(0x241c14, 0x3e3426, 0x5a4e3a, 0x7a6c52, 0x9c8e70),
  sanctum: R(0x1a0406, 0x30080c, 0x4a1016, 0x661a20, 0x8a2c30),
  fungal: R(0x120c08, 0x221810, 0x362618, 0x4a3622, 0x624a30),
  forge: MATERIALS.iron,
  frost: R(0x1a2636, 0x2c3e56, 0x425876, 0x607a98, 0x90acca),
  sky: R(0x2a1e12, 0x44321e, 0x60482c, 0x7c623e, 0x9a7e54),
  moon: R(0x2e3036, 0x46484f, 0x60626a, 0x7e8088, 0xa2a4ac),
  server: R(0x0a0c10, 0x14171e, 0x1e222c, 0x2c323e, 0x404858),
};

/** Brightness gain applied to cap textures so wall tops read as the most lit surface. */
const TOP_GAIN: Record<ThemeId, [number, number]> = {
  catacombs: [2.1, 10],
  flooded: [1.9, 8],
  ossuary: [1.55, 8],
  sanctum: [1.7, 6],
  fungal: [1.9, 8],
  forge: [1.8, 8],
  frost: [1.25, 10],
  sky: [1.35, 6],
  moon: [1.45, 8],
  server: [1.6, 4],
};

/** Growth that creeps over a theme's masonry (moss, algae, rime, turf, regolith dust, oil grime). */
function mossOf(theme: ThemeId): Ramp {
  if (theme === 'flooded' || theme === 'frost' || theme === 'sky' || theme === 'moon') return styleOf(theme).growth;
  if (theme === 'server') return R(0x040506, 0x08090c, 0x0e1014, 0x14171c, 0x1c2026);
  return D.moss;
}

// ---------------------------------------------------------------- small helpers

/** Top-face brightening that also mutes saturation a little (keeps moss/flecks from glowing). */
function topGain(c: number, k: number, add: number): number {
  const g = gain(c, k, add);
  const l = Math.round(((g >> 16) & 255) * 0.3 + ((g >> 8) & 255) * 0.55 + (g & 255) * 0.15);
  return mix(g, (l << 16) | (l << 8) | l, 0.45);
}

function gain(c: number, k: number, add = 0): number {
  return scalec(c, k, add);
}

function tone(ramp: Ramp, v: number): number {
  return ramp[Math.max(0, Math.min(ramp.length - 1, Math.floor(v)))] as number;
}

/** Periodic (32) value noise. */
function pnoise(x: number, y: number, cell: number, seed: number): number {
  const n = 32 / cell;
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const v = (i: number, j: number): number => hash2(((i % n) + n) % n, ((j % n) + n) % n, seed);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
  const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

/** Resample a 32x32 square texture into the diamond at row offset oy of `out`. */
function resampleDiamond(src: PixelBuffer, out: PixelBuffer, oy: number, map?: (c: number, a: number, b: number) => number, orient = 0): void {
  for (let v = 0; v < DH; v++) {
    for (let u = 0; u < DW; u++) {
      const k = (v * DW + u) * 2;
      let sx = DIAMOND_TEXEL[k]!;
      if (sx < 0) continue;
      let sy = DIAMOND_TEXEL[k + 1]!;
      if (orient & 1) sx = 31 - sx;
      if (orient & 2) sy = 31 - sy;
      if (orient & 4) [sx, sy] = [sy, sx];
      const c = src.get(sx, sy);
      const alpha = c >>> 24;
      if (!alpha) continue;
      out.set(u, v + oy, map ? map(c & 0xffffff, (sx + 0.5) / 32, (sy + 0.5) / 32) : c & 0xffffff, alpha);
    }
  }
}

function isoVoid(theme: ThemeId): PixelBuffer {
  const out = new PixelBuffer(DW, DH);
  resampleDiamond(voidFrame(theme), out, 0, (c) => gain(c, 0.85));
  return out;
}

// ---------------------------------------------------------------- wall faces (32 x 64 per face, with height + glow)

interface Face {
  col: PixelBuffer;
  h: Float32Array;
  glow: PixelBuffer;
}

function newFace(): Face {
  return { col: new PixelBuffer(FW, FH), h: new Float32Array(FW * FH), glow: new PixelBuffer(FW, FH) };
}

function cloneFace(f: Face): Face {
  return { col: f.col.clone(), h: f.h.slice(), glow: f.glow.clone() };
}

/** Course layout of a theme's masonry: course start rows and joint positions (period 32, so runs tile). */
interface Courses {
  rows: number[];
  cuts: number[][];
}

const courseCache = new Map<string, Courses>();
function courses(theme: ThemeId, kind: 'rubble' | 'ashlar' | 'brick'): Courses {
  const key = theme + kind;
  const hit = courseCache.get(key);
  if (hit) return hit;
  const r = rng(4400 + theme.length * 31 + kind.length);
  const rows: number[] = [];
  const cuts: number[][] = [];
  let y = CORNICE + 1;
  let k = 0;
  while (y < PLINTH - 3) {
    rows.push(y);
    const hgt = kind === 'brick' ? 6 : kind === 'ashlar' ? 9 + (k % 2) : 6 + Math.floor(r() * 4);
    const n = kind === 'brick' ? 2 : kind === 'ashlar' ? 2 : 2 + Math.floor(r() * 2);
    const off = kind === 'brick' ? (k % 2) * 8 : kind === 'ashlar' ? (k % 2) * 16 : Math.floor(r() * 32);
    const c: number[] = [];
    for (let i = 0; i < n; i++) c.push((off + Math.round((i * 32) / n + (kind === 'rubble' ? (r() - 0.5) * 6 : 0)) + 32) % 32);
    cuts.push(c.sort((a, b) => a - b));
    y += hgt;
    k++;
  }
  rows.push(PLINTH);
  const out = { rows, cuts };
  courseCache.set(key, out);
  return out;
}

/** Joint distance helpers for a course block at (x, y). */
function courseAt(cs: Courses, x: number, y: number): { c: number; b: number; d: number; ly: number; lx: number } | null {
  let c = -1;
  for (let i = 0; i + 1 < cs.rows.length; i++) if (y >= cs.rows[i]! && y < cs.rows[i + 1]!) c = i;
  if (c < 0) return null;
  const y0 = cs.rows[c]!, y1 = cs.rows[c + 1]! - 1;
  const cut = cs.cuts[c]!;
  let b = 0;
  let left = 99, right = 99;
  for (let i = 0; i < cut.length; i++) {
    const dl = (x - cut[i]! + 32) % 32;
    const dr = (cut[i]! - 1 - x + 64) % 32;
    if (dl < left) {
      left = dl;
      b = i;
    }
    if (dr < right) right = dr;
  }
  const ly = y - y0;
  const d = Math.min(left, right, ly, y1 - y);
  return { c, b, d, ly, lx: left };
}

/** Paint the masonry body (rows CORNICE..PLINTH) with seamless courses; per-frame block tones. */
function masonry(f: Face, theme: ThemeId, ramp: Ramp, mortar: number, kind: 'rubble' | 'ashlar' | 'brick', seed: number, depth = 2): void {
  const cs = courses(theme, kind);
  for (let y = CORNICE; y < PLINTH; y++)
    for (let x = 0; x < FW; x++) {
      const i = y * FW + x;
      const q = courseAt(cs, x, y);
      if (!q) {
        f.col.set(x, y, mortar);
        f.h[i] = -depth;
        continue;
      }
      if (q.d === 0) {
        f.col.set(x, y, mortar);
        f.h[i] = -depth;
        continue;
      }
      const bh = hash2(q.c * 7 + q.b, seed, 3);
      let v = 1.55 + bh * 1.2 + (pnoise(x, y, 8, seed + q.c) - 0.5) * 0.8 + bayer(x, y) * 0.3;
      if (q.ly === 1) v += 0.75;
      else if (q.lx === 1) v += 0.35;
      if (q.d === 1 && q.ly !== 1 && q.lx !== 1) v -= 0.45;
      let c = tone(ramp, v);
      if (hash2(x, y, seed + 7) > 0.982) c = ramp[0]!;
      f.col.set(x, y, c);
      f.h[i] = (q.d === 1 ? -depth * 0.4 : 0) + (bh - 0.5) * 0.8 + (pnoise(x, y, 4, seed + 11) - 0.5) * 0.4;
    }
}

/** The projecting top course and its shadow. */
function cornice(f: Face, ramp: Ramp, seed: number): void {
  for (let y = 0; y < CORNICE; y++)
    for (let x = 0; x < FW; x++) {
      const joint = (x + 5) % 16 === 0 && y < CORNICE - 1;
      let v = 2.4 + (pnoise(x, y, 8, seed) - 0.5) * 0.6 + bayer(x, y) * 0.3;
      if (y === 0) v += 1.1;
      else if (y === CORNICE - 2) v -= 0.8;
      let c = tone(ramp, v);
      let h = 1.6;
      if (y === CORNICE - 1) {
        c = 0x060404;
        h = -1.2;
      }
      if (joint) {
        c = mixc(c, 0x050404, 0.7);
        h = 0.6;
      }
      f.col.set(x, y, c);
      f.h[y * FW + x] = h;
    }
}

/** The base course: bigger, darker blocks; ambient occlusion where it meets the floor. */
function plinth(f: Face, theme: ThemeId, seed: number): void {
  const ramp = PLINTH_RAMP[theme];
  const S = styleOf(theme);
  for (let y = PLINTH; y < FH; y++) {
    const ly = y - PLINTH;
    for (let x = 0; x < FW; x++) {
      const lx = (x + 4) % 16;
      let c: number;
      let h = 0.8;
      if (lx === 15 && theme !== 'forge' && theme !== 'server') {
        c = S.mortar;
        h = -1.5;
      } else {
        let v = 2 + hash2(Math.floor((x + 4) / 16), 3, seed) * 0.8 + (pnoise(x, y, 8, seed) - 0.5) * 0.7 + bayer(x, y) * 0.3;
        if (ly === 0) {
          v += 1.4;
          h = 1.4;
        } else if (ly === 1) v += 0.6;
        c = tone(ramp, v);
      }
      if (theme === 'forge' && ly === 4 && x % 8 === 4) c = MATERIALS.iron[4]!;
      if (theme === 'sanctum' && ly === 1) c = S.growth[2]!;
      if (theme === 'frost' && ly < 3 + Math.round(Math.sin(x * 0.4) * 1.2)) c = tone(S.growth, 2 + (ly === 0 ? 1 : 0));
      if ((theme === 'flooded' || theme === 'fungal') && ly > 2 && pnoise(x, y, 4, seed + 1) > 0.74) c = tone(theme === 'flooded' ? S.growth : D.moss, 0.6 + bayer(x, y) * 1.6);
      // sky: turf spilling over the rock foot; moon: regolith banked against it; server: a status light strip
      if (theme === 'sky' && (ly < 2 + Math.round(pnoise(x, 0, 8, seed) * 2) || pnoise(x, y, 4, seed + 2) > 0.78)) c = tone(S.growth, 1.4 + bayer(x, y) * 1.4 + (ly === 0 ? 1 : 0));
      if (theme === 'moon' && ly > 6 - Math.round(pnoise(x, 0, 8, seed + 3) * 3)) c = tone(S.growth, 1.2 + bayer(x, y) * 1.2);
      if (theme === 'server' && ly === 3 && x % 8 < 5) {
        c = x % 8 === 4 ? S.accent[3]! : S.growth[3]!;
        f.glow.set(x, y, c, 220);
      }
      f.col.set(x, y, c);
      f.h[y * FW + x] = h;
    }
  }
}

/** Theme masonry + material features for one face (frame/side seeded). */
function material(theme: ThemeId, f: Face, seed: number): void {
  const S = styleOf(theme);
  const ramp = WALL_RAMP[theme];
  switch (theme) {
    case 'catacombs':
      masonry(f, theme, ramp, 0x090706, 'rubble', seed);
      break;
    case 'flooded': {
      masonry(f, theme, ramp, S.mortar, 'ashlar', seed);
      const line = 36;
      for (let y = line - 2; y < PLINTH; y++)
        for (let x = 0; x < FW; x++) {
          let c = f.col.get(x, y) & 0xffffff;
          if (y >= line) c = mix(c, 0x061418, 0.4);
          const edge = line + Math.round(hash2(x, 0, seed) * 1.6);
          if (y === edge || y === edge + 1) c = S.growth[y === edge ? 3 : 2]!;
          else if (y > edge && pnoise(x, y, 4, seed + 2) > 0.7) c = tone(S.growth, 0.8 + bayer(x, y) * 2);
          f.col.set(x, y, c);
        }
      // wet sheen on the upper block edges
      for (let y = CORNICE; y < line; y++) for (let x = 0; x < FW; x++) if (f.h[y * FW + x]! > -0.2 && f.h[(y - 1) * FW + x]! < -0.5 && hash2(x, y, seed + 3) > 0.55) f.col.set(x, y, 0x8ab0b8);
      break;
    }
    case 'ossuary': {
      for (let y = CORNICE; y < PLINTH; y++)
        for (let x = 0; x < FW; x++) {
          f.col.set(x, y, tone(S.accent, 1 + bayer(x, y)));
          f.h[y * FW + x] = -1.5;
        }
      const p = new Painter(f.col);
      const before = f.col.data.slice();
      const rows = [10, 24, 38, 50];
      rows.forEach((y, i) => {
        for (let k = -1; k <= 4; k++) skullAt(p, k * 8 + (i % 2) * 4 + (hash2(k, i, seed) > 0.8 ? 1 : 0), y, 1.15, S.wall, S.accent[0]!);
      });
      [17, 31, 45].forEach((y, i) => {
        for (let k = -1; k <= 2; k++) {
          const x0 = k * 16 + (i % 2) * 8;
          p.capsule(x0, y, x0 + 13, y, 1, 1).capsule(x0 + 2, y + 2.4, x0 + 15, y + 2.4, 1, 1);
          p.circle(x0, y, 1.6).circle(x0 + 13, y, 1.6).circle(x0 + 2, y + 2.4, 1.6).circle(x0 + 15, y + 2.4, 1.6);
        }
        p.fill(S.wall, { mode: 'emboss', light: -0.05 });
      });
      liftChanged(f, before, 0, 2.2);
      break;
    }
    case 'sanctum': {
      const red = S.floor2 ?? S.wall;
      masonry(f, theme, WALL_RAMP.sanctum, 0x050304, 'ashlar', seed, 1.6);
      for (let y = CORNICE; y < PLINTH; y++)
        for (let x = 0; x < FW; x++) {
          const q = courseAt(courses(theme, 'ashlar'), x, y);
          if (q && q.d > 0 && (q.c + q.b) % 2 === 1) f.col.set(x, y, tone(red, 1.4 + (pnoise(x, y, 8, seed) - 0.5) * 0.6 + bayer(x, y) * 0.25 + (q.ly === 1 ? 0.7 : 0)));
          const vein = Math.abs(Math.sin((x * 0.5 - y * 0.8 + pnoise(x, y, 8, seed + 5) * 8) * 0.8));
          if (vein > 0.982 && q && q.d > 0) f.col.set(x, y, mix(f.col.get(x, y) & 0xffffff, 0xc8b0b8, 0.3));
        }
      // gilded string course
      for (let x = 0; x < FW; x++) {
        f.col.set(x, 29, S.growth[3]!);
        f.col.set(x, 30, S.growth[1]!);
        f.h[29 * FW + x] = 1;
        f.h[30 * FW + x] = 0.5;
      }
      break;
    }
    case 'fungal': {
      const r = rng(seed);
      const pts: [number, number][] = [];
      for (let k = 0; k < 11; k++) pts.push([r() * FW, CORNICE + r() * (PLINTH - CORNICE)]);
      for (let y = CORNICE; y < PLINTH; y++)
        for (let x = 0; x < FW; x++) {
          let d1 = 1e9;
          let d2 = 1e9;
          let best = 0;
          pts.forEach(([px, py], k) => {
            for (const ox of [-FW, 0, FW]) {
              const dd = Math.hypot(x - px - ox, (y - py) * 1.1);
              if (dd < d1) {
                d2 = d1;
                d1 = dd;
                best = k;
              } else if (dd < d2) d2 = dd;
            }
          });
          const py = pts[best]![1];
          const edge = d2 - d1;
          const vv = edge < 1.2 ? 0.2 : 1.6 + hash2(best, seed, 1) + (py - y) * 0.08 + (pnoise(x, y, 8, seed) - 0.5) * 0.7 + bayer(x, y) * 0.3;
          f.col.set(x, y, tone(ramp, vv));
          f.h[y * FW + x] = edge < 1.2 ? -2 : Math.min(2.5, edge * 0.5) - 1 + (pnoise(x, y, 4, seed + 3) - 0.5) * 0.6;
        }
      for (let k = 0; k < 9; k++) {
        const x = Math.floor(r() * FW);
        const y = Math.floor(8 + r() * 44);
        f.col.set(x, y, S.growth[2]!);
        f.glow.set(x, y, S.growth[2]!, 200);
      }
      break;
    }
    case 'forge': {
      for (let x = 0; x < FW; x++) {
        const col = Math.floor(x / 8);
        const lx = x % 8;
        const off = Math.floor(hash2(col, 1, seed) * 12);
        for (let y = CORNICE; y < PLINTH; y++) {
          let c: number;
          let h = 0;
          if (lx === 7) {
            c = 0x040304;
            h = -2;
          } else if ((y + off) % 14 === 0) {
            c = 0x060506;
            h = -1.6;
          } else {
            const vv = 1.8 + hash2(col, Math.floor((y + off) / 14), seed) * 0.8 + (lx === 0 ? 0.9 : lx === 1 ? 0.4 : lx === 6 ? -0.5 : 0) + (pnoise(x, y, 8, seed) - 0.5) * 0.6 + bayer(x, y) * 0.25;
            c = tone(ramp, vv);
            h = lx === 0 || lx === 6 ? -0.6 : 0.2;
          }
          if (y > 5 && y < 22 && pnoise(x, y, 8, seed + 9) > 0.55) c = mix(c, 0x000000, 0.45);
          f.col.set(x, y, c);
          f.h[y * FW + x] = h;
        }
      }
      for (let y = 26; y < 32; y++)
        for (let x = 0; x < FW; x++) {
          let c = tone(MATERIALS.iron, 2 + (y === 26 ? 1.2 : y === 31 ? -1.2 : 0) + bayer(x, y) * 0.3);
          if (y === 28 && x % 8 === 3) c = MATERIALS.iron[4]!;
          if (y === 29 && x % 8 === 3) c = MATERIALS.iron[0]!;
          f.col.set(x, y, c);
          f.h[y * FW + x] = y === 28 && x % 8 === 3 ? 2 : 1.2;
        }
      break;
    }
    case 'frost':
      masonry(f, theme, ramp, S.mortar, 'brick', seed);
      for (let y = CORNICE; y < PLINTH; y++)
        for (let x = 0; x < FW; x++) {
          const rime = pnoise(x, y, 4, seed + 3) * 0.55 + Math.max(0, 1 - (y - CORNICE) / 14) * 0.5;
          if (rime > 0.9) {
            f.col.set(x, y, tone(S.growth, (rime - 0.84) * 12 + bayer(x, y)));
            f.h[y * FW + x] = 0.5;
          } else if ((f.col.get(x, y) & 0xffffff) === S.mortar && hash2(x, y, seed) > 0.5) f.col.set(x, y, S.growth[0]!);
        }
      break;
    case 'sky': {
      // weathered sandstone strata: long uneven beds, softer bands eroded back, tufts rooted in the joints
      masonry(f, theme, ramp, 0x1a140c, 'rubble', seed, 1.6);
      for (let y = CORNICE; y < PLINTH; y++)
        for (let x = 0; x < FW; x++) {
          const bed = Math.floor((y + pnoise(x, y, 8, seed + 4) * 5) / 7);
          if (bed % 3 === 1) {
            f.col.set(x, y, mix(f.col.get(x, y) & 0xffffff, 0x2a1e12, 0.25));
            f.h[y * FW + x] = f.h[y * FW + x]! - 0.6;
          }
          if ((f.col.get(x, y) & 0xffffff) === 0x1a140c && hash2(x, y, seed + 5) > 0.82) f.col.set(x, y, S.growth[2 + (hash2(x, y, seed) > 0.5 ? 1 : 0)]!);
        }
      break;
    }
    case 'moon': {
      // layered grey basalt and breccia; pale regolith settled on every ledge
      masonry(f, theme, ramp, S.mortar, 'rubble', seed, 2.2);
      for (let y = CORNICE; y < PLINTH; y++)
        for (let x = 0; x < FW; x++) {
          const i = y * FW + x;
          if (f.h[i]! > -0.2 && f.h[(y - 1) * FW + x]! < -0.6 && hash2(x, y, seed + 3) > 0.35) f.col.set(x, y, tone(S.growth, 2 + bayer(x, y)));
          if (hash2(x, y, seed + 4) > 0.97) f.col.set(x, y, tone(ramp, 3.6));
        }
      break;
    }
    case 'server': {
      // rack bays: a steel frame every 16 texels, vented doors between, rails and the odd status light
      for (let y = CORNICE; y < PLINTH; y++)
        for (let x = 0; x < FW; x++) {
          const i = y * FW + x;
          const lx = x % 16;
          let c: number;
          let h = 0;
          if (lx === 0 || lx === 15) {
            c = tone(ramp, lx === 0 ? 3.2 : 1.2);
            h = 1.4;
          } else if (lx === 1 || lx === 14) {
            c = 0x040508;
            h = -1.2;
          } else {
            const slot = (y - CORNICE) % 3 === 1 && lx >= 3 && lx <= 12;
            c = slot ? 0x06070a : tone(ramp, 1.7 + (pnoise(x, y, 8, seed) - 0.5) * 0.4 + bayer(x, y) * 0.25);
            h = slot ? -1 : 0.2;
          }
          f.col.set(x, y, c);
          f.h[i] = h;
        }
      const r = rng(seed);
      for (let k = 0; k < 6; k++) {
        const x = 3 + Math.floor(r() * 10) + (k % 2) * 16, y = CORNICE + 2 + Math.floor(r() * 40);
        const c = k % 3 === 0 ? S.accent[3]! : k % 3 === 1 ? S.growth[3]! : 0x7aff9a;
        f.col.set(x, y, c);
        f.glow.set(x, y, c, 230);
      }
      break;
    }
    default:
      break;
  }
}

/** Pixels a painter changed get a luminance-derived height (protruding details / dark recesses). */
function liftChanged(f: Face, before: Uint32Array, base: number, k: number): void {
  for (let i = 0; i < f.col.data.length; i++) {
    if (f.col.data[i] === before[i]) continue;
    const c = f.col.data[i]!;
    if (!(c >>> 24)) continue;
    f.h[i] = base + (luma(c & 0xffffff) - 0.25) * k * 4;
  }
}

/** Lighting pass in face space: overhang shadow under the cornice, AO above/at the plinth foot. */
function shadeFace(f: Face): void {
  const buf = f.col;
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      let c = buf.get(x, y) & 0xffffff;
      if (y >= CORNICE && y < CORNICE + 4) c = mix(c, 0x030202, 0.45 - (y - CORNICE) * 0.11);
      else if (y >= 44 && y < PLINTH) c = mix(c, 0x030202, (y - 44) * 0.025);
      if (y >= FH - 4) c = mix(c, 0x030202, 0.12 + (y - (FH - 4)) * 0.14);
      if (y === FH - 1) c = mix(c, 0x030202, 0.7);
      buf.set(x, y, c);
    }
  }
}

const baseFaceCache = new Map<string, Face>();

function baseFace(theme: ThemeId, seed: number): Face {
  const key = theme + ':' + seed;
  let b = baseFaceCache.get(key);
  if (!b) {
    b = newFace();
    material(theme, b, seed);
    cornice(b, WALL_RAMP[theme], 4500 + theme.length);
    plinth(b, theme, 4300 + theme.length);
    baseFaceCache.set(key, b);
  }
  return b;
}

// ---------------------------------------------------------------- face details (texture space)

function skullAt(p: Painter, x: number, y: number, s: number, ramp: Ramp, dark: number): void {
  p.ellipse(x, y, 2.7 * s, 2.5 * s).fill(ramp, { mode: 'sphere' });
  p.rect(x - 1.4 * s, y + 1.6 * s, 2.8 * s, 1.3 * s).fill(ramp, { mode: 'emboss', light: -0.2, inner: false });
  p.px(x - s, y, dark).px(x + s, y, dark).px(x, y + s, mix(dark, ramp[1]!, 0.5));
}

type Detail = (p: Painter, buf: PixelBuffer, S: Style, r: () => number) => void;

const flameAt = (p: Painter, x: number, y: number): void => {
  p.gpx(x, y, MATERIALS.flame[3]!, MATERIALS.flame[2]!).gpx(x, y - 1, MATERIALS.flame[2]!, MATERIALS.flame[2]!);
};

const DETAILS: Record<string, Detail> = {
  banner: (p) => {
    const pts = [8, 8, 24, 8, 24, 34, 21, 38, 18, 34, 15, 39, 12, 34, 8, 37];
    p.poly(pts).fill(MATERIALS.bloodRed, { mode: 'cyl', dither: true });
    p.line(12, 10, 12, 33).line(19, 10, 19, 33).fill(MATERIALS.bloodRed, { mode: 'flat', tone: 0, inner: false, alpha: 170 });
    p.rect(7, 7, 18, 2).fill(MATERIALS.darkWood, { mode: 'emboss' });
    p.poly([16, 15, 19, 19, 16, 24, 13, 19]).fill(MATERIALS.brass, { mode: 'flat', tone: 2, inner: false });
    p.px(16, 19, MATERIALS.brass[4]!);
  },
  ring: (p) => {
    p.rect(14, 18, 4, 3).fill(MATERIALS.iron, { mode: 'emboss' });
    p.ellipse(16, 25, 4.8, 4.8).minus().ellipse(16, 25, 3.1, 3.1).fill(MATERIALS.rust, { mode: 'emboss', dither: true });
  },
  alcove: (p, buf) => {
    for (let y = 16; y < 42; y++)
      for (let x = 8; x < 25; x++) {
        const dx = (x + 0.5 - 16) / 8.5;
        const dy = y < 23 ? (23 - y) / 7 : 0;
        if (dx * dx + dy * dy > 1) continue;
        buf.set(x, y, mix(0x070404, 0x2a1810, Math.max(0, 1 - Math.abs(dx)) * (y > 30 ? 0.9 : 0.4)));
      }
    for (let x = 8; x < 25; x++) {
      buf.set(x, 42, 0x5c5046);
      buf.set(x, 43, 0x2a241f);
    }
    for (const [cx, h] of [[12, 5], [16, 8], [20, 4]] as const) {
      p.rect(cx - 1, 42 - h, 2.2, h).fill(MATERIALS.wax, { mode: 'cyl', inner: false });
      flameAt(p, cx, 40 - h);
    }
  },
  skulls: (p, _b, S) => {
    for (const [x, y] of [[9, 18], [23, 15], [15, 34]] as const) {
      p.ellipse(x, y, 5, 4.6).fill([0x050303, 0x0a0606, 0x100a08, 0x160e0c], { mode: 'flat', tone: 1, inner: false });
      skullAt(p, x, y - 0.3, 1.45, MATERIALS.boneDry, 0x0a0606);
    }
    void S;
  },
  crack: (_p, buf, S, r) => {
    let x = 9 + r() * 12;
    for (let y = 5; y < 50; y++) {
      x += (r() - 0.5) * 2;
      buf.set(Math.round(x), y, S.mortar === 0x5a4416 ? 0x020102 : 0x040303);
      if (y % 3 === 0) buf.set(Math.round(x) + 1, y, lighten(buf.get(Math.round(x) + 2, y) & 0xffffff, 0.25));
      if (y % 9 === 0) {
        const bx = Math.round(x);
        for (let k = 1; k < 5; k++) buf.set(bx - k, y + k, 0x040303);
      }
    }
  },
  growth: (p, _b, S, r) => {
    for (let k = 0; k < 9; k++) p.ellipse(r() * 32, 46 + r() * 8, 2.5 + r() * 3, 2 + r() * 2);
    for (let k = 0; k < 4; k++) {
      const x = 3 + r() * 26;
      p.capsule(x, 50, x + (r() - 0.5) * 4, 22 + r() * 16, 1, 0.5);
    }
    p.fill(S === STYLES.flooded ? S.growth : D.moss, { mode: 'sphere', dither: true, light: 0.05 });
  },
  stain: (_p, buf, S, r) => {
    const sx = 10 + r() * 12;
    for (let y = 4; y < 52; y++) {
      const w = 2 + Math.sin(y * 0.3) + y * 0.05;
      for (let x = Math.floor(sx - w); x <= sx + w; x++) buf.set(x, y, mix(buf.get(x, y) & 0xffffff, 0x0a1216, 0.45));
    }
    for (let k = 0; k < 4; k++) {
      const x = Math.round(sx + (r() - 0.5) * 6);
      const y = 12 + Math.floor(r() * 36);
      buf.set(x, y, S.pool[3]!);
      buf.set(x, y + 1, S.pool[2]!);
    }
  },
  grate: (p, _b, S) => {
    const glow = S === STYLES.forge;
    p.rect(8, 18, 16, 14).fill(MATERIALS.iron, { mode: 'emboss' });
    for (let k = 0; k < 4; k++) p.rect(10 + k * 3.6, 20, 1.8, 10);
    p.fill(glow ? S.pool : [0x020202, 0x040404, 0x060606, 0x080808], { mode: glow ? 'sphere' : 'flat', tone: 0, glow: glow ? S.pool[3]! : undefined, inner: false });
  },
  beam: (p, _b, S) => {
    p.rect(11, 0, 10, 54).fill(S.accent, { mode: 'cyl', dither: true });
    p.line(14, 2, 14, 52).line(18, 6, 17, 50).fill(S.accent, { mode: 'flat', tone: 0, inner: false });
    p.ellipse(16, 40, 5, 4).ellipse(13, 47, 3, 2).fill(S.growth, { mode: 'sphere', dither: true, inner: false });
  },
  pipe: (p, _b, S) => {
    p.ellipse(16, 18, 5.5, 4.5).fill(MATERIALS.iron, { mode: 'sphere' });
    p.ellipse(16, 18.5, 3.4, 2.6).fill([0x020202, 0x040404, 0x060606, 0x080808], { mode: 'flat', inner: false });
    for (let y = 21; y < 56; y++) p.rect(15 + Math.sin(y * 0.7) * 0.5, y, 2.4, 1);
    p.fill(S.pool, { mode: 'flat', tone: 3, alpha: 210, inner: false });
    p.ellipse(16, 55, 6, 1.6).fill(S.pool, { mode: 'flat', tone: 4, alpha: 200, inner: false });
  },
  slimeNiche: (p, _b, S, r) => {
    p.ellipse(16, 28, 8, 9).fill([0x040808, 0x081010, 0x0c1818, 0x122020], { mode: 'flat', tone: 1, inner: false });
    for (let k = 0; k < 6; k++) p.ellipse(10 + r() * 12, 30 + r() * 8, 1.5 + r() * 1.5, 1.2 + r());
    p.fill(S.growth, { mode: 'sphere', glow: S.growth[3]!, inner: false });
  },
  bigSkull: (p, _b, S) => {
    p.ellipse(16, 26, 9.5, 10).fill([0x020101, 0x050303, 0x080505, 0x0c0807], { mode: 'flat', tone: 1, inner: false });
    skullAt(p, 16, 25, 2.3, S.wall, 0x050303);
  },
  skullCandle: (p, _b, S) => {
    skullAt(p, 16, 32, 1.8, S.wall, 0x050303);
    p.rect(15, 21, 2.2, 6).fill(MATERIALS.wax, { mode: 'cyl', inner: false });
    flameAt(p, 16, 19);
    p.px(14, 26, MATERIALS.wax[3]!).px(18, 25, MATERIALS.wax[3]!);
  },
  boneArch: (p, _b, S) => {
    p.ellipse(16, 38, 8, 14).fill([0x020101, 0x050303, 0x080505, 0x0c0807], { mode: 'flat', tone: 1, inner: false });
    for (let a = Math.PI; a <= Math.PI * 2.001; a += 0.32) skullAt(p, 16 + Math.cos(a) * 10.5, 38 + Math.sin(a) * 16, 0.95, S.wall, 0x050303);
  },
  cobweb: (p) => {
    for (let k = 0; k <= 5; k++) p.line(0, 0, Math.cos((k / 5) * (Math.PI / 2)) * 22, Math.sin((k / 5) * (Math.PI / 2)) * 22);
    for (const rr of [7, 13, 19]) {
      let px = rr;
      let py = 0;
      for (let k = 1; k <= 5; k++) {
        const a = (k / 5) * (Math.PI / 2);
        const nx = Math.cos(a) * rr;
        const ny = Math.sin(a) * rr;
        p.line(px, py, (px + nx) * 0.43, (py + ny) * 0.43).line((px + nx) * 0.43, (py + ny) * 0.43, nx, ny);
        px = nx;
        py = ny;
      }
    }
    p.fill([0xcfcac0, 0xcfcac0, 0xcfcac0, 0xcfcac0], { mode: 'flat', alpha: 120, inner: false });
  },
  rune: (p, _b, S) => {
    const col = S.growth;
    for (let a = 0; a < Math.PI * 2; a += 0.1) p.dot(16 + Math.cos(a) * 8, 26 + Math.sin(a) * 8);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 - Math.PI / 2;
      const b = a + (Math.PI * 2) / 3;
      p.line(16 + Math.cos(a) * 7, 26 + Math.sin(a) * 7, 16 + Math.cos(b) * 7, 26 + Math.sin(b) * 7);
    }
    p.fill(col, { mode: 'flat', tone: 2, glow: col[2]!, inner: false });
  },
  sigil: (p, _b, S) => {
    for (let a = 0; a < Math.PI * 2; a += 0.08) p.dot(16 + Math.cos(a) * 9, 26 + Math.sin(a) * 9);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
      const b = ((k + 2) / 5) * Math.PI * 2 - Math.PI / 2;
      p.line(16 + Math.cos(a) * 8, 26 + Math.sin(a) * 8, 16 + Math.cos(b) * 8, 26 + Math.sin(b) * 8);
    }
    p.fill(S.accent, { mode: 'flat', tone: 2, glow: S.accent[2]!, inner: false });
  },
  bloodDrips: (_p, buf, S, r) => {
    for (let k = 0; k < 7; k++) {
      const x = Math.round(3 + r() * 26);
      const len = 5 + Math.floor(r() * 18);
      for (let y = 8; y < 8 + len; y++) buf.set(x, y, mix(buf.get(x, y) & 0xffffff, S.pool[2]!, 0.75));
      buf.set(x, 8 + len, S.pool[3]!);
    }
  },
  goldCandles: (p, _b, S) => {
    p.capsule(16, 44, 16, 30, 1.2, 1.2).capsule(9, 30, 23, 30, 1, 1).fill(S.growth, { mode: 'cyl' });
    p.ellipse(16, 44, 5, 1.6).fill(S.growth, { mode: 'emboss' });
    for (const [cx, h] of [[9, 6], [16, 8], [23, 6]] as const) {
      p.rect(cx - 1, 29 - h, 2.2, h).fill(MATERIALS.wax, { mode: 'cyl', inner: false });
      flameAt(p, cx, 27 - h);
    }
  },
  shroomsTeal: (p, _b, S) => {
    paintShrooms(p, 12, 52, S.growth, 5, 9, 1.1);
    paintShrooms(p, 22, 34, S.growth, 3, 10, 0.8);
  },
  shroomsPink: (p, _b, S) => {
    paintShrooms(p, 18, 52, S.accent, 4, 11, 1.2);
    paintShrooms(p, 9, 30, S.accent, 2, 12, 0.8);
  },
  roots: (p, _b, _S, r) => {
    for (let k = 0; k < 5; k++) {
      const x = 3 + k * 6.5 + r() * 2;
      p.capsule(x, 0, x + (r() - 0.5) * 5, 14 + r() * 26, 1.6, 0.5);
    }
    p.fill(MATERIALS.root, { mode: 'cyl', dither: true });
  },
  mycelium: (_p, buf, S, r) => {
    for (let k = 0; k < 4; k++) {
      let x = 4 + r() * 24;
      for (let y = 6 + Math.floor(r() * 10); y < 52; y++) {
        x += (r() - 0.5) * 2.2;
        buf.set(Math.round(x), y, S.growth[2]!);
        if (y % 4 === 0) buf.blend(Math.round(x) + 1, y, S.growth[3]!, 140);
      }
    }
  },
  sporePods: (p, _b, S, r) => {
    for (let k = 0; k < 6; k++) p.ellipse(8 + r() * 16, 18 + r() * 24, 1.8 + r() * 1.6, 1.6 + r() * 1.4);
    p.fill(MATERIALS.broodFlesh, { mode: 'sphere', glow: S.accent[2]!, dither: true });
  },
  mossDrip: (p, _b, _S, r) => {
    for (let k = 0; k < 8; k++) p.ellipse(r() * 32, 6 + r() * 6, 2 + r() * 2.5, 1.6 + r());
    for (let k = 0; k < 5; k++) {
      const x = 3 + r() * 26;
      p.capsule(x, 9, x, 16 + r() * 18, 0.8, 0.4);
    }
    p.fill(D.moss, { mode: 'sphere', dither: true });
  },
  lavaCrack: (_p, buf, S, r) => {
    let x = 8 + r() * 14;
    for (let y = 4; y < 52; y++) {
      x += (r() - 0.5) * 2.4;
      buf.set(Math.round(x), y, S.pool[2]!);
      buf.blend(Math.round(x) + 1, y, S.pool[3]!, 150);
      buf.blend(Math.round(x) - 1, y, S.pool[1]!, 140);
    }
  },
  ironPlate: (p) => {
    p.rect(5, 10, 22, 30).fill(MATERIALS.iron, { mode: 'emboss', dither: true });
    for (const [x, y] of [[7, 12], [24, 12], [7, 37], [24, 37], [16, 12], [16, 37]] as const) p.px(x, y, MATERIALS.iron[4]!);
  },
  chains: (p) => {
    for (const cx of [10, 22]) {
      for (let k = 0; k < 13; k++) {
        const y = 4 + k * 3.2;
        if (k % 2) p.ellipse(cx, y, 1.9, 1.2);
        else p.ellipse(cx, y, 1.2, 1.9);
      }
    }
    p.fill(MATERIALS.iron, { mode: 'sphere', light: 0.15 });
  },
  vent: (p, _b, S) => {
    p.rect(7, 20, 18, 14).fill(MATERIALS.iron, { mode: 'emboss' });
    for (let k = 0; k < 4; k++) p.rect(9 + k * 4, 22, 2, 10);
    p.fill(S.pool, { mode: 'sphere', glow: S.pool[3]!, inner: false });
  },
  lavaSeep: (p, buf, S, r) => {
    DETAILS['lavaCrack']!(p, buf, S, r);
    for (let y = 26; y < 54; y++) p.rect(14 + Math.sin(y * 0.6), y, 3, 1);
    p.fill(S.pool, { mode: 'cyl', glow: S.pool[3]!, inner: false });
  },
  furnace: (p, _b, S) => {
    p.ellipse(16, 38, 10, 11).minus().rect(0, 44, 32, 12).fill(MATERIALS.iron, { mode: 'emboss' });
    p.ellipse(16, 39, 7, 8).minus().rect(0, 44, 32, 12).fill(S.pool, { mode: 'sphere', glow: S.pool[3]!, light: 0.2, inner: false });
  },
  soot: (_p, buf) => {
    for (let y = 0; y < 50; y++) for (let x = 0; x < FW; x++) if (pnoise(x, y, 8, 91) * (1 - y / 60) > 0.32) buf.set(x, y, mix(buf.get(x, y) & 0xffffff, 0x000000, 0.6));
  },
  icicles: (p, _b, S, r) => {
    for (let k = 0; k < 7; k++) {
      const x = 2 + k * 4.4 + r() * 1.5;
      const L = 7 + r() * 16;
      p.poly([x - 1.7, 3, x + 1.7, 3, x, 3 + L]);
    }
    p.fill(S.accent, { mode: 'facet', facets: 3, glow: S.accent[3]! });
  },
  frozenCorpse: (p, _b, S) => {
    p.rect(6, 10, 20, 38).fill(S.pool, { mode: 'emboss', alpha: 235 });
    p.ellipse(16, 18, 3.2, 3).fill(MATERIALS.paleSkin, { mode: 'sphere', alpha: 190, inner: false });
    p.capsule(16, 22, 16, 36, 2.8, 2.4).capsule(13, 23, 10, 32, 1, 0.9).capsule(19, 23, 22, 15, 1, 0.9).capsule(15, 36, 14, 45, 1.1, 1).capsule(17, 36, 18, 45, 1.1, 1).fill(MATERIALS.chain, { mode: 'emboss', alpha: 170, inner: false });
    p.px(15, 18, 0x202838).px(17, 18, 0x202838);
    p.line(8, 12, 13, 17).fill(S.accent, { mode: 'flat', tone: 4, inner: false, alpha: 220 });
  },
  rime: (_p, buf, S) => {
    for (let y = 0; y < PLINTH; y++) for (let x = 0; x < FW; x++) if (pnoise(x, y, 4, 92) * 0.7 + (1 - y / PLINTH) * 0.45 > 0.6) buf.set(x, y, tone(S.growth, 1 + bayer(x, y) * 2));
  },
  frozenFall: (_p, buf, S) => {
    for (let y = 0; y < PLINTH; y++) {
      const w = 3.5 + Math.sin(y * 0.25) * 1.4;
      for (let x = Math.floor(16 - w); x <= 16 + w; x++) buf.set(x, y, tone(S.pool, 2 + (x === Math.floor(16 - w) ? 1.5 : 0) + bayer(x, y) * 0.8));
    }
  },
  iceCrystals: (p, _b, S) => {
    for (const [x, h, lean] of [[10, 12, -0.3], [15, 18, 0], [21, 10, 0.4]] as const) p.poly([x - 2.4, 54, x + 2.4, 54, x + lean * 8 + 0.6, 54 - h, x + lean * 8 - 0.6, 54 - h - 1.5]);
    p.fill(S.accent, { mode: 'facet', facets: 3, glow: S.accent[3]!, rot: 0.4 });
  },
};

// sky island, moon and server room wall details
const OPEN_DETAILS: Record<string, Detail> = {
  // ---- sky
  ivy: (p, _b, S, r) => {
    for (let k = 0; k < 3; k++) {
      let x = 6 + k * 9 + r() * 4;
      for (let y = 3; y < 46 + r() * 8; y += 1.4) {
        x += (r() - 0.5) * 1.8;
        p.dot(x, y);
        if (r() < 0.45) p.ellipse(x + (r() < 0.5 ? -1.8 : 1.8), y + 0.5, 1.6, 1.1);
      }
    }
    p.fill(S.growth, { mode: 'sphere', dither: true, light: 0.1 });
  },
  hangRoots: (p, _b, _S, r) => {
    for (let k = 0; k < 6; k++) {
      const x = 2 + k * 5.4 + r() * 2;
      const L = 18 + r() * 30;
      p.capsule(x, 0, x + (r() - 0.5) * 6, L * 0.55, 1.5, 0.9).capsule(x + (r() - 0.5) * 6, L * 0.55, x + (r() - 0.5) * 8, L, 0.9, 0.3);
    }
    p.fill(MATERIALS.root, { mode: 'cyl', dither: true });
  },
  windShrine: (p, buf, S) => {
    // a little niche with a carved bird and a wind-worn offering bowl
    for (let y = 18; y < 40; y++)
      for (let x = 9; x < 24; x++) {
        const dx = (x + 0.5 - 16.5) / 7.5, dy = y < 25 ? (25 - y) / 7 : 0;
        if (dx * dx + dy * dy <= 1) buf.set(x, y, mix(0x1a140c, 0x4a3c28, Math.max(0, 1 - Math.abs(dx)) * 0.5));
      }
    p.poly([12, 30, 16, 26, 21, 30, 16, 29]).fill(S.wall, { mode: 'emboss', light: 0.3 });
    p.ellipse(16, 37, 4, 1.6).fill(S.accent, { mode: 'sphere', inner: false });
    p.gpx(16, 35, S.accent[4]!, S.accent[3]!);
  },
  prayerFlags: (p, _b, _S, r) => {
    const cols: Ramp[] = [MATERIALS.bloodRed, R(0x14306a, 0x2050a0, 0x3a78d0, 0x6aa8f0, 0xb0d8ff), R(0x6a5a10, 0xa08a20, 0xd0b838, 0xf0e070, 0xfff8c0), R(0x1a4a1a, 0x2a7a2a, 0x3aa83a, 0x70d070, 0xb0f0b0), R(0xa0a0a0, 0xc8c8c8, 0xe8e8e8, 0xf8f8f8, 0xffffff)];
    p.line(0, 12, 32, 18).fill(R(0x2a2216, 0x4a3c26, 0x6e5a3a, 0x948054, 0xb8a272), { mode: 'flat', tone: 2, inner: false });
    for (let k = 0; k < 6; k++) {
      const x = 2 + k * 5.2, y = 12 + x * 0.19;
      p.poly([x, y, x + 4, y + 0.8, x + 4 + (r() - 0.5), y + 6.5, x + (r() - 0.5), y + 6]).fill(cols[k % cols.length]!, { mode: 'cyl', inner: false });
    }
  },
  nest: (p, _b, S, r) => {
    p.ellipse(16, 30, 9, 3.4).fill(R(0x2a1e10, 0x4a3820, 0x6e5832, 0x927a4a, 0xb49c66), { mode: 'sphere', dither: true });
    for (let k = 0; k < 9; k++) p.line(8 + r() * 4, 29 + r() * 3, 20 + r() * 5, 28 + r() * 4);
    p.fill(R(0x2a1e10, 0x4a3820, 0x6e5832, 0x927a4a, 0xb49c66), { mode: 'flat', tone: 3, inner: false });
    for (const x of [13, 16, 19]) p.ellipse(x, 28, 1.6, 1.3).fill(R(0x7a8ca0, 0xa8bccc, 0xcce0ec, 0xe8f4fa, 0xffffff), { mode: 'sphere', inner: false });
    void S;
  },
  sunGlyph: (p, _b, S) => {
    for (let a = 0; a < Math.PI * 2; a += 0.12) p.dot(16 + Math.cos(a) * 5, 26 + Math.sin(a) * 5);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      p.line(16 + Math.cos(a) * 7, 26 + Math.sin(a) * 7, 16 + Math.cos(a) * 10, 26 + Math.sin(a) * 10);
    }
    p.fill(S.accent, { mode: 'flat', tone: 3, glow: S.accent[3]!, inner: false });
  },
  // ---- moon
  hullPanel: (p, buf, S) => {
    p.rect(3, 10, 26, 36).fill(S.accent, { mode: 'emboss', dither: true });
    for (const y of [18, 30]) p.rect(3, y, 26, 1);
    p.fill(S.accent, { mode: 'flat', tone: 0, inner: false });
    for (const [x, y] of [[5, 12], [26, 12], [5, 43], [26, 43], [16, 12], [16, 43]] as const) buf.set(x, y, S.accent[4]!);
    for (let x = 3; x < 29; x++) for (let y = 38; y < 42; y++) buf.set(x, y, (x + y) % 6 < 3 ? 0xd8a020 : 0x18181c);
  },
  porthole: (p, _b, S) => {
    p.ellipse(16, 26, 9, 9).fill(S.accent, { mode: 'emboss' });
    p.ellipse(16, 26, 6.5, 6.5).fill(R(0x0a1830, 0x183a6a, 0x3a70b0, 0x7ab0e8, 0xd0ecff), { mode: 'sphere', glow: 0x7ab0e8, light: 0.2, inner: false });
    p.px(13, 23, 0xe8f6ff).px(14, 23, 0xb8dcf8);
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; p.px(16 + Math.cos(a) * 8, 26 + Math.sin(a) * 8, S.accent[4]!); }
  },
  airlock: (p, buf, S) => {
    p.rect(6, 12, 20, 42).fill(S.accent, { mode: 'emboss' });
    p.rect(9, 16, 14, 38).fill(R(0x14161c, 0x22262e, 0x343a46, 0x4a5262, 0x646e82), { mode: 'emboss', dither: true });
    for (let y = 16; y < 54; y++) buf.set(16, y, 0x08090c);
    for (let y = 44; y < 54; y++) for (let x = 9; x < 23; x++) if (x !== 16) buf.set(x, y, (x - y + 64) % 6 < 3 ? 0xd8a020 : 0x18181c);
    p.gpx(16, 9, 0xff3a2a, 0xa01414);
  },
  antenna: (p, _b, S) => {
    p.capsule(16, 50, 16, 16, 0.9, 0.7).fill(S.accent, { mode: 'cyl' });
    p.ellipse(12, 16, 7, 4.5).minus().ellipse(10, 15, 6, 3.5).fill(S.accent, { mode: 'emboss', light: 0.3 });
    p.line(12, 16, 17, 12).fill(S.accent, { mode: 'flat', tone: 3, inner: false });
    p.gpx(17, 11, 0xff3a2a, 0xa01414);
  },
  hazard: (_p, buf) => {
    for (let y = 30; y < 38; y++) for (let x = 0; x < FW; x++) buf.set(x, y, (x + y) % 8 < 4 ? 0xd8a020 : 0x18181c);
    for (let x = 0; x < FW; x++) { buf.set(x, 29, 0x0a0a0c); buf.set(x, 38, 0x0a0a0c); }
  },
  dustDrift: (_p, buf, S) => {
    for (let y = 28; y < PLINTH; y++) for (let x = 0; x < FW; x++) {
      const top = 40 + Math.sin(x * 0.35) * 4 + pnoise(x, 0, 8, 7) * 6;
      if (y >= top) buf.set(x, y, tone(S.growth, 1.4 + (y - top < 1 ? 1.6 : 0) + bayer(x, y) * 0.8));
    }
  },
  beacon: (p, _b, S) => {
    p.rect(12, 20, 8, 10).fill(S.accent, { mode: 'emboss' });
    p.ellipse(16, 18, 3, 2.4).fill(R(0x3a0808, 0x7a1010, 0xc81e1e, 0xff5a4a, 0xffc0b0), { mode: 'sphere', glow: 0xff3a2a, inner: false });
    p.capsule(16, 30, 16, 50, 0.8, 0.8).fill(R(0x0a0a0c, 0x18181c, 0x26262c, 0x36363e, 0x4a4a54), { mode: 'cyl', inner: false });
  },
  // ---- server
  ledRack: (p, buf, S, r) => {
    p.rect(4, 8, 24, 44).fill(R(0x06070a, 0x0c0e12, 0x14171c, 0x1c2028, 0x262c36), { mode: 'emboss' });
    for (let y = 10; y < 50; y += 4) {
      for (let x = 6; x < 26; x++) buf.set(x, y + 2, 0x020203);
      for (let k = 0; k < 4; k++) {
        const x = 7 + Math.floor(r() * 18);
        const c = r() < 0.6 ? 0x5aff7a : r() < 0.5 ? S.growth[3]! : 0xffb030;
        p.gpx(x, y, c, c);
      }
    }
  },
  cableTray: (p, _b, _S, r) => {
    p.rect(0, 6, 32, 4).fill(R(0x14171e, 0x262c38, 0x3a4256, 0x56607a, 0x8a96b0), { mode: 'emboss' });
    const cols: Ramp[] = [R(0x060608, 0x101014, 0x1c1c22, 0x2a2a32, 0x3c3c46), R(0x200608, 0x40100e, 0x6a1c18, 0x983028, 0xc04c40), R(0x06141e, 0x0c2a3a, 0x164a62, 0x2a7090, 0x4a9ac0)];
    for (let k = 0; k < 7; k++) {
      const x = 2 + k * 4.2 + r() * 1.5;
      const L = 14 + r() * 32;
      p.capsule(x, 10, x + Math.sin(k) * 2, 10 + L * 0.6, 1, 1).capsule(x + Math.sin(k) * 2, 10 + L * 0.6, x + Math.sin(k) * 3.5, 10 + L, 1, 0.8).fill(cols[k % 3]!, { mode: 'cyl', inner: false });
    }
  },
  ventGrille: (p, buf, S) => {
    p.rect(6, 18, 20, 18).fill(R(0x14171e, 0x262c38, 0x3a4256, 0x56607a, 0x8a96b0), { mode: 'emboss' });
    for (let y = 20; y < 34; y += 2) for (let x = 8; x < 24; x++) buf.set(x, y, mix(S.growth[1]!, 0x020304, 0.5));
    for (let y = 21; y < 34; y += 2) for (let x = 8; x < 24; x++) buf.set(x, y, S.growth[2]!);
  },
  terminal: (p, buf, S, r) => {
    p.rect(5, 14, 22, 18).fill(R(0x14171e, 0x262c38, 0x3a4256, 0x56607a, 0x8a96b0), { mode: 'emboss' });
    for (let y = 16; y < 30; y++) for (let x = 7; x < 25; x++) buf.set(x, y, mix(0x021014, S.growth[1]!, (y % 2) * 0.25));
    for (let y = 17; y < 29; y += 2) {
      const len = 4 + Math.floor(r() * 12);
      for (let x = 8; x < 8 + len; x++) buf.set(x, y, y === 27 ? S.accent[3]! : S.growth[3]!);
    }
    p.rect(9, 33, 14, 3).fill(R(0x0a0c10, 0x14171e, 0x1e222c, 0x2c323e, 0x404858), { mode: 'emboss' });
  },
  warningGlyph: (p, _b, S) => {
    p.poly([16, 14, 26, 34, 6, 34]).minus().poly([16, 18, 23, 32, 9, 32]).fill(S.accent, { mode: 'flat', tone: 3, glow: S.accent[3]!, inner: false });
    p.rect(15, 21, 2, 6).rect(15, 29, 2, 1.6).fill(S.accent, { mode: 'flat', tone: 4, glow: S.accent[3]!, inner: false });
  },
  glitch: (_p, buf, S, r) => {
    for (let k = 0; k < 9; k++) {
      const y0 = CORNICE + Math.floor(r() * 44), h = 1 + Math.floor(r() * 3), sh = Math.floor((r() - 0.5) * 10);
      const tint = k % 3 === 0 ? S.accent[3]! : k % 3 === 1 ? S.growth[3]! : -1;
      for (let y = y0; y < Math.min(PLINTH, y0 + h); y++) {
        const row: number[] = [];
        for (let x = 0; x < FW; x++) row.push(buf.get(((x + sh) % FW + FW) % FW, y) & 0xffffff);
        for (let x = 0; x < FW; x++) buf.set(x, y, tint < 0 ? row[x]! : mix(row[x]!, tint, 0.55));
      }
    }
  },
};

// extra wall details (iron-barred cell, skull / candle niche)
const EXTRA_DETAILS: Record<string, Detail> = {
  ...OPEN_DETAILS,
  bars: (p, buf, S, r) => {
    for (let y = 16; y < 38; y++)
      for (let x = 8; x < 25; x++) {
        const edge = y === 16 || y === 37 || x === 8 || x === 24;
        buf.set(x, y, edge ? 0x0a0707 : mix(0x020101, 0x0e0808, (y - 16) / 40));
      }
    for (let x = 6; x < 27; x++) {
      buf.set(x, 14, lighten(tone(S.wall, 3), 0.1));
      buf.set(x, 15, tone(S.wall, 2));
      buf.set(x, 38, tone(S.wall, 3.4));
      buf.set(x, 39, tone(S.wall, 1));
    }
    // a skeletal hand clutching the bars
    if (r() < 0.6) {
      p.ellipse(15, 27, 1.6, 1.2).fill(MATERIALS.boneDry, { mode: 'sphere', inner: false });
      p.line(14, 26, 14, 24).line(16, 26, 16, 24).fill(MATERIALS.boneDry, { mode: 'flat', tone: 2, inner: false });
    }
    for (const x of [10.5, 14.5, 18.5, 22.5]) p.rect(x, 16, 1.4, 22);
    p.rect(8, 24, 17, 1.4);
    p.fill(MATERIALS.iron, { mode: 'cyl', light: 0.15 });
    for (let k = 0; k < 4; k++) {
      const x = 10 + k * 4;
      for (let y = 40; y < 40 + 3 + Math.floor(r() * 6); y++) buf.set(x, y, mix(buf.get(x, y) & 0xffffff, MATERIALS.rust[1]!, 0.55));
    }
  },
  niche: (p, buf, S, r) => {
    for (let y = 18; y < 36; y++)
      for (let x = 10; x < 23; x++) {
        const dx = (x + 0.5 - 16.5) / 6.5;
        const dy = y < 24 ? (24 - y) / 6 : 0;
        if (dx * dx + dy * dy > 1) continue;
        buf.set(x, y, mix(0x050303, 0x1e120c, Math.max(0, 1 - Math.abs(dx)) * 0.5));
      }
    for (let x = 9; x < 24; x++) {
      buf.set(x, 36, tone(S.wall, 3.6));
      buf.set(x, 37, tone(S.wall, 1));
    }
    if (S === STYLES.sanctum || S === STYLES.fungal || r() < 0.4) {
      p.rect(15, 29, 2.4, 7).fill(MATERIALS.wax, { mode: 'cyl', inner: false });
      flameAt(p, 16, 27);
      p.px(14, 35, MATERIALS.wax[3]!).px(18, 35, MATERIALS.wax[2]!);
    } else {
      skullAt(p, 16.5, 32, 1.6, MATERIALS.boneDry, 0x0a0606);
    }
  },
};

/** Details whose bright pixels are light sources (copied to the unlit glow layer). */
const GLOWING = new Set(['alcove', 'skullCandle', 'goldCandles', 'rune', 'sigil', 'slimeNiche', 'shroomsTeal', 'shroomsPink', 'mycelium', 'sporePods', 'lavaCrack', 'lavaSeep', 'furnace', 'vent', 'niche', 'iceCrystals',
  'windShrine', 'sunGlyph', 'porthole', 'airlock', 'antenna', 'beacon', 'ledRack', 'ventGrille', 'terminal', 'warningGlyph', 'glitch']);

/** The 8 theme detail variants per theme (face variants WALL_STRUCT.length .. +7). */
export const ISO_WALL_DETAILS: Record<ThemeId, string[]> = {
  catacombs: ['banner', 'alcove', 'skulls', 'bars', 'ring', 'grate', 'niche', 'crack'],
  flooded: ['beam', 'pipe', 'slimeNiche', 'stain', 'ring', 'grate', 'growth', 'bars'],
  ossuary: ['bigSkull', 'skullCandle', 'boneArch', 'cobweb', 'alcove', 'skulls', 'niche', 'crack'],
  sanctum: ['banner', 'rune', 'sigil', 'goldCandles', 'bloodDrips', 'alcove', 'ring', 'niche'],
  fungal: ['shroomsTeal', 'shroomsPink', 'roots', 'mycelium', 'sporePods', 'mossDrip', 'alcove', 'crack'],
  forge: ['lavaCrack', 'ironPlate', 'chains', 'vent', 'lavaSeep', 'furnace', 'pipe', 'grate'],
  frost: ['icicles', 'frozenCorpse', 'rime', 'frozenFall', 'iceCrystals', 'ring', 'bars', 'banner'],
  sky: ['ivy', 'hangRoots', 'windShrine', 'prayerFlags', 'nest', 'sunGlyph', 'crack', 'growth'],
  moon: ['hullPanel', 'porthole', 'airlock', 'antenna', 'hazard', 'dustDrift', 'crack', 'beacon'],
  server: ['ledRack', 'cableTray', 'ventGrille', 'terminal', 'warningGlyph', 'glitch', 'crack', 'pipe'],
};

/** All face variants of a theme, in frame order. */
export function wallVariants(theme: ThemeId): string[] {
  return [...WALL_STRUCT, ...ISO_WALL_DETAILS[theme]];
}

// ---------------------------------------------------------------- structural face variants

function pilaster(f: Face, theme: ThemeId, seed: number): void {
  const ramp = theme === 'sanctum' ? (STYLES.sanctum.floor2 ?? WALL_RAMP.sanctum) : WALL_RAMP[theme];
  for (let y = CORNICE; y < PLINTH; y++) {
    const joint = (y - CORNICE) % 10 === 9;
    for (let x = 0; x < 13; x++) {
      const i = y * FW + x;
      let c: number;
      let h: number;
      if (x === 9) {
        c = 0x050303;
        h = -1.4;
      } else if (x >= 10) {
        c = mix(f.col.get(x, y) & 0xffffff, 0x030202, x === 10 ? 0.6 : x === 11 ? 0.4 : 0.2);
        h = f.h[i]!;
      } else {
        let v = 2.9 + (pnoise(x, y, 8, seed) - 0.5) * 0.6 + bayer(x, y) * 0.3;
        if (x === 0) v += 1.3;
        else if (x === 1) v += 0.6;
        else if (x === 7) v -= 0.8;
        else if (x === 8) v -= 1.5;
        if (joint) v = 0.6;
        c = tone(ramp, v);
        h = joint ? 1.4 : x === 0 || x === 8 ? 1.8 : 2.6;
        if (theme === 'forge' && (y - CORNICE) % 14 < 2) c = tone(MATERIALS.iron, x === 0 ? 3.4 : 2);
        if (theme === 'frost' && pnoise(x, y, 4, seed + 1) > 0.72) c = tone(STYLES.frost.growth, 1.5);
      }
      f.col.set(x, y, c);
      f.h[i] = h;
    }
  }
  // capital and base blocks, a little wider than the shaft
  for (const [y0, y1] of [[CORNICE, CORNICE + 4], [PLINTH - 5, PLINTH]] as const)
    for (let y = y0; y < y1; y++)
      for (let x = 0; x < 12; x++) {
        const v = 3 + (y === y0 ? 1 : y === y1 - 1 ? -1.2 : 0) + (x === 0 ? 0.6 : x === 11 ? -1 : 0) + bayer(x, y) * 0.3;
        let c = tone(ramp, v);
        if (theme === 'sanctum' && y === y0) c = STYLES.sanctum.growth[3]!;
        f.col.set(x, y, c);
        f.h[y * FW + x] = 2.8;
      }
}

/** Half of a blind arch spanning two faces (half 0 = screen-left face). */
function arch(f: Face, theme: ThemeId, half: 0 | 1, seed: number): void {
  const S = styleOf(theme);
  const ramp = WALL_RAMP[theme];
  const cx = 32, spring = 27, rx = 24, ry = 16;
  for (let y = CORNICE; y < PLINTH; y++)
    for (let xx = 0; xx < FW; xx++) {
      const x = xx + half * FW;
      const dx = (x + 0.5 - cx) / rx;
      // machine-built themes recess a square bay instead of a round arch
      const square = theme === 'server' || theme === 'moon';
      const inside = square ? Math.abs(dx) < 1 && y >= spring - ry + 4 : y >= spring ? Math.abs(dx) < 1 : (dx * dx + ((spring - y - 0.5) / ry) ** 2) < 1;
      const outer = square ? Math.abs((x + 0.5 - cx) / (rx + 3)) < 1 && y >= spring - ry + 1 : y >= spring ? Math.abs((x + 0.5 - cx) / (rx + 3)) < 1 : (((x + 0.5 - cx) / (rx + 3)) ** 2 + ((spring - y - 0.5) / (ry + 3)) ** 2) < 1;
      const i = y * FW + xx;
      if (inside) {
        // recessed panel: small dark bricks
        const row = Math.floor((y - CORNICE) / 5);
        const joint = (y - CORNICE) % 5 === 4 || (x + (row % 2) * 4) % 8 === 7;
        const depthShade = y < spring ? 0.35 : 0.2 + Math.max(0, 1 - Math.abs(dx)) * 0.2;
        let c = joint ? 0x050303 : tone(ramp, 1.1 + hash2(Math.floor((x + (row % 2) * 4) / 8), row, seed) * 0.8 + bayer(x, y) * 0.3);
        c = mix(c, 0x020101, depthShade + (Math.abs(dx) > 0.85 ? 0.25 : 0));
        if (theme === 'flooded' && y > 40) c = mix(c, S.growth[1]!, 0.25);
        if (theme === 'frost' && pnoise(xx, y, 4, seed + 4) > 0.74) c = mix(c, S.accent[1]!, 0.35);
        f.col.set(xx, y, c);
        f.h[i] = joint ? -3 : -2;
      } else if (outer) {
        // voussoirs: radial joints round the arch, square jambs below the springline
        let joint: boolean;
        if (y >= spring || square) joint = (y - spring + 63) % 7 === 6;
        else {
          const a = Math.atan2((spring - y) / (ry + 1.5), (x + 0.5 - cx) / (rx + 1.5));
          joint = Math.abs(((a / Math.PI) * 9) % 1) < 0.12;
        }
        const keystone = y < spring - ry + 1 && Math.abs(x + 0.5 - cx) < 2.5;
        let v = 2.6 + (pnoise(xx, y, 8, seed + 2) - 0.5) * 0.5 + bayer(x, y) * 0.3 + (keystone ? 0.8 : 0);
        if (joint) v = 0.5;
        let c = tone(ramp, v);
        if (theme === 'sanctum' && !joint) c = mix(c, S.growth[2]!, 0.35);
        if (theme === 'forge' && !joint) c = tone(MATERIALS.iron, v - 0.3);
        f.col.set(xx, y, c);
        f.h[i] = joint ? 0.4 : 1.6;
      }
    }
  // a sill at the plinth
  for (let xx = 0; xx < FW; xx++) {
    const x = xx + half * FW;
    if (Math.abs(x + 0.5 - cx) > rx + 3) continue;
    f.col.set(xx, PLINTH - 1, tone(ramp, 3.6));
    f.h[(PLINTH - 1) * FW + xx] = 1.4;
  }
}

/** Soot plume and scorch above a mounted torch (faces that carry one). */
function soot(f: Face, seed: number): void {
  for (let y = CORNICE; y < 40; y++) {
    const w = 3 + (40 - y) * 0.28;
    for (let x = 0; x < FW; x++) {
      const d = Math.abs(x + 0.5 - 16) / w + (pnoise(x, y, 4, seed) - 0.5) * 0.5;
      if (d > 1) continue;
      const k = (1 - d) * 0.75 + (y > 30 ? 0.25 : 0.1);
      f.col.set(x, y, mix(f.col.get(x, y) & 0xffffff, 0x020101, Math.min(0.92, k)));
    }
  }
}

/** Damp: water runs, white efflorescence and mould at the foot. */
function damp(f: Face, theme: ThemeId, seed: number): void {
  const S = styleOf(theme);
  const r = rng(seed);
  for (let k = 0; k < 5; k++) {
    const x0 = Math.floor(2 + r() * 28);
    const len = 14 + Math.floor(r() * 30);
    for (let y = CORNICE; y < CORNICE + len && y < PLINTH; y++) {
      const x = x0 + Math.round(Math.sin(y * 0.3 + k) * 0.6);
      f.col.set(x, y, mix(f.col.get(x, y) & 0xffffff, theme === 'forge' || theme === 'server' ? 0x000000 : 0x0a1418, 0.45));
      if (y % 7 === 0) f.col.set(x, y, mix(f.col.get(x, y) & 0xffffff, 0xb8c8c8, 0.25));
    }
  }
  for (let y = 38; y < PLINTH; y++)
    for (let x = 0; x < FW; x++) {
      if (hash2(x, y, seed + 1) > 0.94 && theme !== 'forge' && theme !== 'server') f.col.set(x, y, mix(f.col.get(x, y) & 0xffffff, 0xd8dccc, 0.45));
      const m = pnoise(x, y, 4, seed + 2) + (y - 38) * 0.02;
      if (m > 0.8) f.col.set(x, y, tone(mossOf(theme), 0.6 + (m - 0.8) * 8 + bayer(x, y)));
    }
}

/** Subtle everyday variation (plain frames and the plain partner face). */
function everyday(theme: ThemeId, f: Face, frame: number, side: number): void {
  const S = styleOf(theme);
  const buf = f.col;
  const r = rng(5000 + frame * 37 + side * 11 + theme.length);
  const kind = (frame + side * 3) % 6;
  if (kind === 1 || kind === 4) {
    for (let y = CORNICE; y < PLINTH; y++) for (let x = 0; x < FW; x++) if (pnoise(x, y, 8, 600 + frame + side) > 0.68) buf.set(x, y, mix(buf.get(x, y) & 0xffffff, 0x020101, 0.3));
  } else if (kind === 2) {
    let x = 6 + r() * 20;
    for (let y = 10 + Math.floor(r() * 10); y < 30 + Math.floor(r() * 16); y++) {
      x += (r() - 0.5) * 1.6;
      buf.set(Math.round(x), y, 0x040303);
      f.h[y * FW + Math.round(x)] = -1.5;
    }
  } else if (kind === 3 && theme !== 'ossuary') {
    const p = new Painter(buf);
    const before = buf.data.slice();
    for (let k = 0; k < 4; k++) p.ellipse(r() * 32, 50 + r() * 4, 1.8 + r() * 2, 1.4 + r());
    p.fill(mossOf(theme), { mode: 'sphere', dither: true });
    liftChanged(f, before, 0.4, 1);
  } else if (kind === 5) {
    for (let k = 0; k < 3; k++) {
      const x = Math.round(3 + r() * 26);
      for (let y = CORNICE + 1; y < CORNICE + 6 + Math.floor(r() * 12); y++) buf.set(x, y, mix(buf.get(x, y) & 0xffffff, theme === 'forge' ? 0x000000 : 0x0c1216, 0.4));
    }
  }
}

/** One face texture: plain (variant null) or with a structural / theme variant. */
function faceTexture(theme: ThemeId, frame: number, side: 0 | 1, variant: string | null): Face {
  const f = cloneFace(baseFace(theme, 4100 + ((frame + side * 2) % 4) * 17));
  everyday(theme, f, frame, side);
  const seed = 7000 + frame * 13 + side * 5 + theme.length;
  if (variant === 'pilaster') pilaster(f, theme, seed);
  else if (variant === 'archL') arch(f, theme, 0, 4600 + theme.length);
  else if (variant === 'archR') arch(f, theme, 1, 4600 + theme.length);
  else if (variant === 'soot') soot(f, seed);
  else if (variant === 'damp') damp(f, theme, seed);
  else if (variant) {
    const fn = DETAILS[variant] ?? EXTRA_DETAILS[variant];
    if (fn) {
      const before = f.col.data.slice();
      const p = new Painter(f.col);
      fn(p, f.col, styleOf(theme), rng(seed));
      p.finish(PALETTES.outline, 0.85);
      liftChanged(f, before, 0.3, 1.2);
      if (GLOWING.has(variant) || (variant === 'grate' && theme === 'forge')) {
        for (let i = 0; i < f.col.data.length; i++) {
          if (f.col.data[i] === before[i]) continue;
          const c = f.col.data[i]! & 0xffffff;
          const l = luma(c);
          const sat = Math.max((c >> 16) & 255, (c >> 8) & 255, c & 255) - Math.min((c >> 16) & 255, (c >> 8) & 255, c & 255);
          if (l > 0.42 && sat > 60) f.glow.data[i] = (0xff000000 | c) >>> 0;
        }
      }
    }
  }
  shadeFace(f);
  return f;
}

// ---------------------------------------------------------------- blocks

/** Lit-lip / dark-upper-edge treatment for a top diamond pixel. */
function topEdge(c: number, a: number, b: number): number {
  const ea = a * 32;
  const eb = b * 32;
  if (ea < 1 || eb < 1) return mix(c, EDGE_DARK, 0.42);
  if (ea >= 31 || eb >= 31) return lighten(c, 0.3);
  if (ea >= 30 || eb >= 30) return lighten(c, 0.12);
  return c;
}

/** Normals of a 32x32 top texture by luminance relief, resampled into the diamond rows 0..31 of `out`. */
function topNormals(src: PixelBuffer, out: PixelBuffer, oy: number, k: number): void {
  const h = (x: number, y: number): number => luma(src.get(Math.max(0, Math.min(31, x)), Math.max(0, Math.min(31, y))) & 0xffffff) * k;
  for (let v = 0; v < DH; v++)
    for (let u = 0; u < DW; u++) {
      const kk = (v * DW + u) * 2;
      const sx = DIAMOND_TEXEL[kk]!;
      if (sx < 0) continue;
      const sy = DIAMOND_TEXEL[kk + 1]!;
      const gx = (h(sx + 1, sy) - h(sx - 1, sy)) * 0.5;
      const gy = (h(sx, sy + 1) - h(sx, sy - 1)) * 0.5;
      out.set(u, v + oy, encodeNormal(-(gx * 0.894 - gy * 0.894), -(-gx * 0.447 - gy * 0.447), 1));
    }
}

interface Block {
  col: PixelBuffer;
  nrm: PixelBuffer;
  glow: PixelBuffer;
}

/** Rubble and broken masonry on a wall top (cut / ruined tops). */
function roughenCap(cap: PixelBuffer, theme: ThemeId, seed: number, amount: number): void {
  const S = styleOf(theme);
  const r = rng(seed);
  const p = new Painter(cap);
  for (let n = 0; n < Math.round(7 * amount); n++) p.ellipse(3 + r() * 26, 3 + r() * 26, 1.6 + r() * 2.6, 1.3 + r() * 2);
  p.fill(PLINTH_RAMP[theme], { mode: 'sphere', dither: true, light: -0.1 });
  for (let n = 0; n < Math.round(3 * amount); n++) {
    let x = 4 + r() * 24;
    let y = 4 + r() * 24;
    for (let s = 0; s < 8; s++) {
      x += (r() - 0.5) * 2;
      y += (r() - 0.5) * 2;
      cap.set(Math.round(x), Math.round(y), 0x050404);
    }
  }
  if (theme === 'frost' || theme === 'ossuary' || theme === 'fungal' || theme === 'sky' || theme === 'moon') {
    for (let n = 0; n < 4; n++) p.ellipse(4 + r() * 24, 4 + r() * 24, 2.4 + r() * 3, 1.8);
    p.fill(theme === 'frost' || theme === 'sky' || theme === 'moon' ? S.growth : theme === 'ossuary' ? MATERIALS.boneDry : D.moss, { mode: 'sphere', dither: true, inner: false });
  }
}

function composeBlock(theme: ThemeId, frame: number, left: Face, right: Face, faceH: number, capSeed: number, rough: number): Block {
  const H = DH + faceH;
  const col = new PixelBuffer(DW, H);
  const nrm = new PixelBuffer(DW, H);
  const glow = new PixelBuffer(DW, H);
  const [k, add] = TOP_GAIN[theme];
  const cap = capTexture(theme, capSeed % 2).clone();
  if (rough > 0) roughenCap(cap, theme, 8000 + frame * 17 + theme.length, rough);
  const orient = (capSeed * 5) % 8;
  const kk = faceH < FH ? k * 0.62 : k;
  const aa = faceH < FH ? add * 0.5 : add;
  resampleDiamond(cap, col, 0, (c, a, b) => {
    if (faceH < FH) {
      const ea = a * 32;
      const eb = b * 32;
      const g = topGain(c, kk, aa);
      if (ea < 1 || eb < 1) return mix(g, EDGE_DARK, 0.55);
      if (ea >= 30.5 || eb >= 30.5) return hash2(Math.floor(a * 64), Math.floor(b * 64), frame) > 0.35 ? lighten(g, 0.3) : mix(g, 0x000000, 0.5);
      return g;
    }
    return topEdge(topGain(c, kk, aa), a, b);
  }, orient);
  topNormals(cap, nrm, 0, 2.2);
  const nl = faceNormals(left.h, FW, FH, 0, 0.5);
  const nr = faceNormals(right.h, FW, FH, 1, 0.5);
  for (let u = 0; u < DW; u++) {
    const top = LAST_TOP[u]! + 1;
    for (let hh = 0; hh < faceH; hh++) {
      const th = FH - faceH + hh;
      let c: number;
      let n: number;
      let g: number;
      if (u < 32) {
        c = left.col.get(u, th) & 0xffffff;
        if (u === 31) c = lighten(c, 0.14);
        n = nl[th * FW + u]!;
        g = left.glow.get(u, th);
      } else {
        c = gain(right.col.get(u - 32, th) & 0xffffff, 0.72);
        n = nr[th * FW + u - 32]!;
        g = right.glow.get(u - 32, th);
      }
      if (faceH < FH && hh === 0) c = mix(c, 0x000000, 0.35);
      if (faceH < FH && u === 31 && hh > 0) c = lighten(c, 0.12);
      col.set(u, top + hh, c);
      nrm.set(u, top + hh, n);
      if (g >>> 24) glow.set(u, top + hh, g & 0xffffff, g >>> 24);
    }
  }
  return { col, nrm, glow };
}

/** Face variant of each side for a wall frame: [L, R] (null = plain). */
export function wallFrameFaces(theme: ThemeId, frame: number): [string | null, string | null] {
  if (frame < PLAIN_FRAMES) return [null, null];
  const v = wallVariants(theme)[Math.floor((frame - PLAIN_FRAMES) / 2)] ?? null;
  return (frame - PLAIN_FRAMES) % 2 === 0 ? [v, null] : [null, v];
}

/** Wall frame index for a face variant on one side. */
export function wallFrameFor(theme: ThemeId, variant: string, side: 'L' | 'R'): number {
  const v = wallVariants(theme).indexOf(variant);
  if (v < 0) return 0;
  return PLAIN_FRAMES + v * 2 + (side === 'R' ? 1 : 0);
}

function isoWall(theme: ThemeId, frame: number): Block {
  const [lv, rv] = wallFrameFaces(theme, frame);
  const left = faceTexture(theme, frame, 0, lv);
  const right = faceTexture(theme, frame, 1, rv);
  return composeBlock(theme, frame, left, right, FH, frame, frame % 7 === 6 ? 0.6 : 0);
}

function isoStub(theme: ThemeId, frame: number): Block {
  const left = faceTexture(theme, frame, 0, null);
  const right = faceTexture(theme, frame + 1, 1, null);
  return composeBlock(theme, frame, left, right, 16, frame, 1);
}

// ---------------------------------------------------------------- cliff faces (the slab edge over the chasm)

const CLIFF_H = 56;

/** Strata of the floor slab's side face: foundation course, then theme earth/rock, fading into the dark. */
function isoCliff(theme: ThemeId, idx: number): PixelBuffer {
  const out = new PixelBuffer(DW, DH + CLIFF_H);
  const S = styleOf(theme);
  const side = idx < 3 ? 0 : 1;
  const seed = 9900 + idx * 31 + theme.length;
  const r = rng(seed);
  const foundation = PLINTH_RAMP[theme];
  const earth: Record<ThemeId, Ramp> = {
    catacombs: R(0x16110d, 0x241c16, 0x34291f, 0x463729, 0x5c4836),
    flooded: R(0x0c1418, 0x162226, 0x223036, 0x304248, 0x44585e),
    ossuary: R(0x1e1810, 0x30271c, 0x443828, 0x5a4a36, 0x766248),
    sanctum: R(0x140708, 0x220b0e, 0x321216, 0x441a1e, 0x5c2a2e),
    fungal: R(0x140e09, 0x22180f, 0x322416, 0x44321e, 0x5a4428),
    forge: R(0x100e0e, 0x1a1616, 0x262020, 0x332b2b, 0x463c3c),
    frost: R(0x182232, 0x243248, 0x34465e, 0x4a6080, 0x6a84a4),
    sky: R(0x2a1c10, 0x44301c, 0x5e4428, 0x7a5a36, 0x987448),
    moon: R(0x1c1d22, 0x2c2e34, 0x40424a, 0x585a64, 0x767884),
    server: R(0x06070a, 0x0e1014, 0x181b22, 0x242a34, 0x343c4a),
  };
  const E = earth[theme];
  const p = new Painter(new PixelBuffer(FW, CLIFF_H));
  const strata = p.buf;
  for (let y = 0; y < CLIFF_H; y++)
    for (let x = 0; x < FW; x++) {
      let c: number;
      if (y < 7) {
        const joint = y === 6 || (x + (side ? 9 : 3)) % 16 === 15;
        c = joint ? 0x050404 : tone(foundation, 1.4 + (y === 0 ? 1 : 0) + (pnoise(x, y, 8, seed) - 0.5) * 0.6 + bayer(x, y) * 0.3);
      } else {
        const band = Math.floor((y + pnoise(x, y, 8, seed + 1) * 4) / 6);
        c = tone(E, 1 + hash2(band, side, seed) * 1.6 + (pnoise(x, y, 4, seed + band) - 0.5) * 0.9 + bayer(x, y) * 0.3);
      }
      strata.set(x, y, c);
    }
  // embedded stones / bones / roots / ice per theme
  for (let k = 0; k < 6; k++) {
    const x = r() * FW, y = 10 + r() * 30;
    p.ellipse(x, y, 1.6 + r() * 2.4, 1.2 + r() * 1.6);
  }
  p.fill(theme === 'ossuary' ? MATERIALS.boneDry : theme === 'frost' ? R(0x3a5a7a, 0x5a84aa, 0x8ab4d8, 0xc0e0f8) : foundation, { mode: 'sphere', light: -0.1, inner: false, dither: true });
  if (theme === 'catacombs' || theme === 'fungal' || theme === 'flooded') {
    for (let k = 0; k < 3; k++) {
      const x = 3 + r() * 26;
      p.capsule(x, 7, x + (r() - 0.5) * 5, 14 + r() * 14, 0.9, 0.3);
    }
    p.fill(R(0x100a08, 0x1e1410, 0x2e2018, 0x3e2c20), { mode: 'cyl', dither: true, inner: false });
  }
  if (theme === 'frost')
    for (let k = 0; k < 6; k++) {
      const x = 2 + k * 5 + r() * 2;
      p.poly([x - 1.4, 7, x + 1.4, 7, x, 16 + r() * 18]);
    }
  if (theme === 'frost') p.fill(STYLES.frost.accent, { mode: 'facet', facets: 3, inner: false });
  const glowPts: [number, number][] = [];
  if (theme === 'forge')
    for (let k = 0; k < 2; k++) {
      let x = 4 + r() * 24;
      for (let y = 8; y < CLIFF_H - 6; y++) {
        x += (r() - 0.5) * 2;
        glowPts.push([Math.round(x), y]);
      }
    }
  for (const [x, y] of glowPts) strata.set(x, y, y % 4 ? 0xff6a0e : 0xffb040);
  if (theme === 'flooded')
    for (let k = 0; k < 4; k++) {
      const x = Math.floor(r() * FW);
      for (let y = 7; y < 7 + 10 + Math.floor(r() * 30); y++) strata.set(x, y, mix(strata.get(x, y) & 0xffffff, S.pool[3]!, 0.45));
    }
  if (theme === 'sky') {
    // the shard's underside: a turf lip over the dirt, roots trailing down into the open air
    for (let y = 0; y < 7; y++) for (let x = 0; x < FW; x++) strata.set(x, y, tone(S.growth, (y < 2 ? 3 : 1.6) + bayer(x, y) * 0.8 - y * 0.15));
    for (let k = 0; k < 5; k++) {
      const x = 2 + r() * 28;
      p.capsule(x, 6, x + (r() - 0.5) * 6, 22 + r() * 30, 1, 0.3);
    }
    p.fill(MATERIALS.root, { mode: 'cyl', dither: true, inner: false });
  }
  if (theme === 'moon') for (let y = 0; y < 3; y++) for (let x = 0; x < FW; x++) strata.set(x, y, tone(S.growth, 2.4 - y * 0.6 + bayer(x, y) * 0.6));
  if (theme === 'server') {
    // the raised floor's steel edge, the plenum's pedestals and cable runs below it
    for (let y = 0; y < 7; y++) for (let x = 0; x < FW; x++) strata.set(x, y, tone(PLINTH_RAMP.server, y === 0 ? 4 : y === 6 ? 0.5 : 2.2 + bayer(x, y) * 0.3));
    for (let y = 7; y < CLIFF_H; y++) for (const px of [6, 22]) for (let dx = 0; dx < 2; dx++) strata.set(px + dx, y, tone(PLINTH_RAMP.server, dx ? 1.4 : 2.6));
    for (let k = 0; k < 4; k++) {
      const x = 3 + k * 7 + r() * 3;
      p.capsule(x, 8, x + (r() - 0.5) * 4, 20 + r() * 26, 1, 0.8);
    }
    p.fill(R(0x200608, 0x40100e, 0x6a1c18, 0x983028, 0xc04c40), { mode: 'cyl', inner: false });
  }
  for (let u = 0; u < DW; u++) {
    if ((u < 32 ? 0 : 1) !== side) continue;
    const top = LAST_TOP[u]! + 1;
    const fx = u < 32 ? u : u - 32;
    const reach = CLIFF_H - 4 - Math.round(pnoise(fx, 0, 8, seed + 5) * 8 + hash2(fx, 1, seed) * 3);
    for (let y = 0; y < CLIFF_H; y++) {
      if (y > reach) break;
      const t = y / reach;
      let c = strata.get(fx, y) & 0xffffff;
      c = gain(c, (side ? 0.95 : 1.35) * (1 - t * 0.8));
      if (y === 0) c = lighten(c, 0.35);
      else if (y === 1) c = lighten(c, 0.12);
      // ragged, dithered bottom edge
      if (t > 0.8 && bayer(fx, y) + 0.47 < (t - 0.8) * 5) continue;
      const glowing = theme === 'forge' && glowPts.some(([gx, gy]) => gx === fx && gy === y);
      if (glowing) c = strata.get(fx, y) & 0xffffff;
      out.set(u, top + y, c);
    }
  }
  return out;
}

// ---------------------------------------------------------------- picker

/** Is this wall block a plain run piece whose only visible face is `side`? */
function runFace(isWall: (x: number, y: number) => boolean, x: number, y: number, side: 'L' | 'R'): boolean {
  if (!isWall(x, y)) return false;
  return side === 'L' ? !isWall(x, y + 1) && isWall(x + 1, y) && isWall(x + 1, y + 1) : !isWall(x + 1, y) && isWall(x, y + 1) && isWall(x + 1, y + 1);
}

/**
 * Frame of a full wall block: architectural rhythm along runs (a pilaster every fourth block, blind arches
 * spanning two blocks), soot over torches, damp, theme details, plain stone. Deterministic.
 */
export function pickIsoWall(theme: ThemeId, isWall: (x: number, y: number) => boolean, x: number, y: number, seed: number, torch: { L?: boolean; R?: boolean } = {}): number {
  const L = !isWall(x, y + 1);
  const Rv = !isWall(x + 1, y);
  const h = (a: number, b: number, s: number): number => hash2(a, b, seed + s);
  const plain = Math.floor(h(x, y, 2) * PLAIN_FRAMES);
  if (L && Rv) return plain;
  if (!L && !Rv) return plain;
  const side: 'L' | 'R' = L ? 'L' : 'R';
  // position along the run: x for north walls (L faces), y for west walls (R faces)
  const along = side === 'L' ? x : y;
  const off = Math.floor(h(side === 'L' ? y : x, 7, 3) * 4);
  const ph = (((along + off) % 4) + 4) % 4;
  if (ph === 0) return wallFrameFor(theme, 'pilaster', side);
  // blind arch over two blocks (both must be plain run pieces)
  if (ph === 1 || ph === 2) {
    const ax = side === 'L' ? (ph === 1 ? x : x - 1) : x;
    const ay = side === 'L' ? y : ph === 1 ? y : y - 1;
    const bx = side === 'L' ? ax + 1 : ax;
    const by = side === 'L' ? ay : ay + 1;
    if (h(ax, ay, 11) < 0.45 && runFace(isWall, ax, ay, side) && runFace(isWall, bx, by, side) && !(side === 'L' ? torch.L : torch.R)) {
      // L runs: lower x is screen-left; R runs: higher y is screen-left
      const leftHalf = side === 'L' ? ph === 1 : ph === 2;
      return wallFrameFor(theme, leftHalf ? 'archL' : 'archR', side);
    }
  }
  if (side === 'L' ? torch.L : torch.R) return wallFrameFor(theme, 'soot', side);
  const r = h(x, y, 1);
  if (r < 0.34) return wallFrameFor(theme, ISO_WALL_DETAILS[theme][Math.floor(h(x, y, 5) * 8)]!, side);
  if (r < 0.46) return wallFrameFor(theme, 'damp', side);
  return plain;
}

/** Stub (cut front wall) frame. */
export function pickIsoStub(x: number, y: number, seed: number): number {
  return Math.floor(hash2(x, y, seed + 1) * ISO_FRAMES.stub.frames);
}

// ---------------------------------------------------------------- build + validation

export interface IsoSheet {
  key: string;
  frameW: number;
  frameH: number;
  frames: number;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  /** Light2D normal map with the same layout (registered as the texture's data source and as `${key}:n`) */
  normal?: Uint8ClampedArray;
}

function pack(key: string, frames: PixelBuffer[], fw: number, fh: number, normals?: PixelBuffer[]): IsoSheet {
  const sheet = new Sheet(fw, fh, frames.length, 1024);
  for (const f of frames) sheet.add(f);
  const out: IsoSheet = { key, frameW: fw, frameH: fh, frames: frames.length, width: sheet.buf.w, height: sheet.buf.h, rgba: sheet.buf.toRGBA() };
  if (normals) {
    const ns = new Sheet(fw, fh, normals.length, 1024);
    normals.forEach((n, i) => {
      // normal alpha follows the colour alpha so blended stamps keep their relief
      const c = frames[i]!;
      const m = new PixelBuffer(fw, fh);
      for (let k = 0; k < m.data.length; k++) {
        const a = c.data[k]! >>> 24;
        if (a) m.data[k] = ((a << 24) | ((n.data[k]! >>> 24 ? n.data[k]! : 0xff8080ff) & 0xffffff)) >>> 0;
      }
      ns.add(m);
    });
    out.normal = ns.buf.toRGBA();
  }
  return out;
}

export interface IsoFrames {
  floor: PixelBuffer[];
  floorN: PixelBuffer[];
  floorGlow: PixelBuffer[] | null;
  deco: PixelBuffer[];
  decoN: PixelBuffer[];
  decoGlow: PixelBuffer[] | null;
  wall: PixelBuffer[];
  wallN: PixelBuffer[];
  wallGlow: PixelBuffer[] | null;
  stub: PixelBuffer[];
  stubN: PixelBuffer[];
  cliff: PixelBuffer[];
  void: PixelBuffer[];
  room: PixelBuffer[];
  roomN: PixelBuffer[];
  roomGlow: PixelBuffer[] | null;
}

const wallGlowCache = new Map<ThemeId, boolean[]>();

/** Which wall frames of a theme have emissive pixels (valid once the theme's iso set was built). */
export function isoWallGlowFrames(theme: ThemeId): boolean[] {
  return wallGlowCache.get(theme) ?? [];
}

/** Raw frames (for tooling/validation). */
export function buildIsoFrames(theme: ThemeId): IsoFrames {
  const fl = buildFloorFrames(theme);
  const dc = buildDecoFrames(theme);
  const rf = buildRoomFloorFrames(theme);
  const walls = Array.from({ length: ISO_FRAMES.wall.frames }, (_, f) => isoWall(theme, f));
  const stubs = Array.from({ length: ISO_FRAMES.stub.frames }, (_, f) => isoStub(theme, f));
  const glowFlags = walls.map((w) => w.glow.data.some((c) => c >>> 24 !== 0));
  wallGlowCache.set(theme, glowFlags);
  return {
    floor: fl.col,
    floorN: fl.nrm,
    floorGlow: FLOOR_GLOW_THEMES.includes(theme) ? fl.glow : null,
    deco: dc.map((d) => d.col),
    decoN: dc.map((d) => d.nrm),
    decoGlow: DECO_GLOW_THEMES.includes(theme) ? dc.map((d) => d.glow) : null,
    wall: walls.map((w) => w.col),
    wallN: walls.map((w) => w.nrm),
    wallGlow: WALL_GLOW_THEMES.includes(theme) ? walls.map((w) => w.glow) : null,
    stub: stubs.map((s) => s.col),
    stubN: stubs.map((s) => s.nrm),
    cliff: Array.from({ length: ISO_FRAMES.cliff.frames }, (_, i) => isoCliff(theme, i)),
    void: [isoVoid(theme)],
    room: rf.map((d) => d.col),
    roomN: rf.map((d) => d.nrm),
    roomGlow: roomFloorHasGlow(theme) ? rf.map((d) => d.glow) : null,
  };
}

export function buildIsoSheets(theme: ThemeId): IsoSheet[] {
  const f = buildIsoFrames(theme);
  const k = isoKeys(theme);
  const out = [
    pack(k.floorKey, f.floor, ISO_FRAMES.floor.w, ISO_FRAMES.floor.h, f.floorN),
    pack(k.decoKey, f.deco, ISO_FRAMES.deco.w, ISO_FRAMES.deco.h, f.decoN),
    pack(k.wallKey, f.wall, ISO_FRAMES.wall.w, ISO_FRAMES.wall.h, f.wallN),
    pack(k.stubKey, f.stub, ISO_FRAMES.stub.w, ISO_FRAMES.stub.h, f.stubN),
    pack(k.cliffKey, f.cliff, ISO_FRAMES.cliff.w, ISO_FRAMES.cliff.h),
    pack(k.voidKey, f.void, ISO_FRAMES.void.w, ISO_FRAMES.void.h),
    pack(k.roomKey, f.room, ISO_FRAMES.room.w, ISO_FRAMES.room.h, f.roomN),
  ];
  if (f.roomGlow) out.push(pack(k.roomGlowKey, f.roomGlow, ISO_FRAMES.room.w, ISO_FRAMES.room.h));
  if (f.floorGlow) out.push(pack(k.floorGlowKey, f.floorGlow, ISO_FRAMES.floor.w, ISO_FRAMES.floor.h));
  if (f.decoGlow) out.push(pack(k.decoGlowKey, f.decoGlow, ISO_FRAMES.deco.w, ISO_FRAMES.deco.h));
  if (f.wallGlow) out.push(pack(k.wallGlowKey, f.wallGlow, ISO_FRAMES.wall.w, ISO_FRAMES.wall.h));
  return out;
}

/**
 * Contract checks for every theme: frame sizes/counts, floor/void diamonds opaque inside and transparent
 * outside, perfect tiling of the diamond rule, wall/stub silhouettes fully opaque over the footprint and
 * transparent above the top diamond, overlays and cliffs never spilling where they must not, normal maps
 * matching their colour sheets. Returns problems (empty = OK).
 */
export function validateIso(themes: readonly ThemeId[] = THEME_IDS): string[] {
  const problems: string[] = [];
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 128; x++) {
      let hits = 0;
      for (let ty = -3; ty <= 3; ty++)
        for (let tx = -3; tx <= 3; tx++) {
          const ox = (tx - ty) * 32 + 32;
          const oy = (tx + ty) * 16 + 16;
          const u = x - ox;
          const v = y - oy;
          if (u >= 0 && u < DW && v >= 0 && v < DH && diamondAB(u, v)) hits++;
        }
      if (hits !== 1) {
        problems.push(`diamond rule does not tile at (${x},${y}) [${hits} hits]`);
        y = 999;
        break;
      }
    }
  for (const theme of themes) {
    const f = buildIsoFrames(theme);
    const check = (name: keyof typeof ISO_FRAMES, list: PixelBuffer[] | null, label = name as string): void => {
      if (!list) return;
      const spec = ISO_FRAMES[name];
      if (list.length !== spec.frames) problems.push(`iso:${label}:${theme} has ${list.length} frames, expected ${spec.frames}`);
      list.forEach((b, i) => {
        if (b.w !== spec.w || b.h !== spec.h) problems.push(`iso:${label}:${theme} frame ${i} is ${b.w}x${b.h}, expected ${spec.w}x${spec.h}`);
      });
    };
    check('floor', f.floor);
    check('floor', f.floorN, 'floor:n');
    check('floor', f.floorGlow, 'floorglow');
    check('deco', f.deco);
    check('deco', f.decoN, 'deco:n');
    check('deco', f.decoGlow, 'decoglow');
    check('wall', f.wall);
    check('wall', f.wallN, 'wall:n');
    check('wall', f.wallGlow, 'wallglow');
    check('stub', f.stub);
    check('stub', f.stubN, 'stub:n');
    check('cliff', f.cliff);
    check('void', f.void);
    for (const [name, list] of [['floor', f.floor], ['void', f.void]] as const) {
      list.forEach((b, i) => {
        let bad = 0;
        for (let v = 0; v < DH; v++)
          for (let u = 0; u < DW; u++) {
            const inside = diamondAB(u, v) !== null;
            const a = b.alpha(u, v);
            if (inside !== (a === 255)) bad++;
          }
        if (bad) problems.push(`iso:${name}:${theme} frame ${i}: ${bad} pixels violate the diamond mask`);
      });
    }
    // floor overlays may only draw over their own tile (plus the dais lip headroom)
    f.deco.forEach((b, i) => {
      let spill = 0;
      for (let v = 0; v < DECO_H; v++)
        for (let u = 0; u < DW; u++) {
          if (!b.alpha(u, v)) continue;
          const inDiamond = v >= 8 && diamondAB(u, v - 8) !== null;
          const inLip = v >= 4 && diamondAB(u, v - 4) !== null;
          if (!inDiamond && !inLip) spill++;
        }
      if (spill) problems.push(`iso:deco:${theme} frame ${i} (${DECO_NAMES[i]}): ${spill} pixels outside the tile`);
    });
    const solid = (b: PixelBuffer, i: number, kind: string, liftRows: number): void => {
      let holes = 0;
      let spill = 0;
      for (let u = 0; u < DW; u++) {
        const first = u === 0 || u === 63 ? LAST_TOP[u]! + 1 : (() => {
          for (let v = 0; v < DH; v++) if (diamondAB(u, v)) return v;
          return 0;
        })();
        const last = LAST_TOP[u]! + liftRows;
        for (let v = 0; v < b.h; v++) {
          const a = b.alpha(u, v);
          if (v >= first && v <= last && a !== 255) holes++;
          if ((v < first || v > last) && a !== 0) spill++;
        }
      }
      if (holes || spill) problems.push(`iso:${kind}:${theme} frame ${i}: ${holes} holes, ${spill} pixels outside the block silhouette`);
    };
    f.wall.forEach((b, i) => solid(b, i, 'wall', 64));
    f.stub.forEach((b, i) => solid(b, i, 'stub', 16));
    // cliffs hang strictly below the tile's diamond: never over floor
    f.cliff.forEach((b, i) => {
      let bad = 0;
      for (let u = 0; u < DW; u++) for (let v = 0; v <= LAST_TOP[u]! && v < b.h; v++) if (b.alpha(u, v)) bad++;
      if (bad) problems.push(`iso:cliff:${theme} frame ${i}: ${bad} pixels over the tile diamond`);
    });
  }
  return problems;
}
