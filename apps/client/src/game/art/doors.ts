/**
 * Themed dungeon doors (framework-free pixel generator + lazy Phaser registration).
 *
 * A door is a tall archway set into one visible wall face of the 2:1 iso view. It is painted flat in "face space"
 * (DOOR_FW x DOOR_FH, the wall face is the bottom 64 rows; the crown rises above the wall line), then sheared onto
 * the face exactly like wall-mounted props: the L face (wall's south face, screen lower-left) slopes down to the
 * right, the R face (east face, screen lower-right) slopes down to the left. Face columns
 * [0, 12) / [12, 44) / [44, 56) lie over three neighbouring wall tiles so the renderer can depth-split them.
 *
 * Layers per theme and side (all frames share one geometry):
 *   door:<theme>:<side>:frame   1 frame   lit stone/bone/marble frame, ornaments, dark doorway
 *   door:<theme>:<side>:portal  6 frames  unlit portal sheet in the opening (the dungeon beyond)
 *   door:<theme>:<side>:leaves  6 frames  lit door leaves: 0 closed (a glowing seam) -> 5 open
 *   door:<theme>:<side>:glow    4 frames  unlit emissive details: eyes, candles, lava, drips, glints
 *   door:sigil:<theme>          1 frame   flat floor sigil (iso ellipse) for the plaque in front
 *
 * Client-only registration touches `document` inside functions, never at import time.
 */
import type Phaser from 'phaser';
import { PixelBuffer, bayer, hash2, mix } from './draw/pixel';
import { addFramedTexture } from './texutil';

type Ramp = readonly number[];
const R = (...c: number[]): Ramp => Object.freeze(c);

export type DoorSide = 'L' | 'R';
export type DoorLayer = 'frame' | 'portal' | 'leaves' | 'glow';

/** Face-space geometry shared with the renderer. */
export const DOOR_GEOM = {
  /** face-space width / height */
  FW: 56,
  FH: 104,
  /** first face column over the door's own wall tile, and its width */
  TILE_COL: 12,
  TILE_W: 32,
  /** sheared texture height (FH + max shear + 1) */
  TEX_H: 104 + 29,
  /** opening: columns [OPEN_X0, OPEN_X1), straight below SPRING, semicircle of radius R_IN above */
  OPEN_X0: 18,
  OPEN_X1: 38,
  SPRING: 70,
  R_IN: 10,
  R_OUT: 16,
  CX: 28,
} as const;

export const DOOR_FRAMES = { frame: 1, portal: 6, leaves: 6, glow: 4 } as const;

const { FW, FH, TEX_H, OPEN_X0, OPEN_X1, SPRING, R_IN, R_OUT, CX } = DOOR_GEOM;
const FLOOR = FH - 1;

type Crown = 'stepped' | 'broken' | 'skull' | 'spire' | 'mound' | 'horns' | 'peak' | 'wings' | 'crescent' | 'chip';
type LeafPattern = 'planks' | 'rotted' | 'lattice' | 'panels' | 'roots' | 'plates' | 'ice' | 'sail' | 'hatch' | 'circuit';

interface DoorStyle {
  stone: Ramp;
  trim: Ramp;
  leaf: Ramp;
  band: Ramp;
  portal: Ramp;
  /** light colour (Light2D + PointLight) and emissive accent */
  light: number;
  glow: number;
  glow2?: number;
  crown: Crown;
  leafPattern: LeafPattern;
}

const IRON = R(0x141418, 0x2a2a32, 0x44444e, 0x6a6a76, 0x9a9aa6);
const BONE = R(0x3e322c, 0x7c6e5e, 0xbcae94, 0xe8dec4, 0xfffaf0);
const GOLD = R(0x4a3008, 0x8a6418, 0xc89a30, 0xf0d070, 0xfff4c0);

const STYLES: Record<string, DoorStyle> = {
  catacombs: {
    stone: R(0x171210, 0x2a211c, 0x40332b, 0x58463a, 0x74604e), trim: IRON,
    leaf: R(0x1c120e, 0x34221a, 0x523626, 0x725036, 0x8e6844), band: IRON,
    portal: R(0x1a0a04, 0x4a2008, 0x9a4a12, 0xf09a3a, 0xfff0c0),
    light: 0xffa04a, glow: 0xffb050, crown: 'stepped', leafPattern: 'planks',
  },
  flooded: {
    stone: R(0x0e161a, 0x1a272e, 0x283a42, 0x3a5058, 0x587078), trim: R(0x0a2014, 0x14381e, 0x24582a, 0x3e7a3a, 0x6aa850),
    leaf: R(0x0c1210, 0x18221c, 0x26342a, 0x364838, 0x4a5e48), band: R(0x1e0e08, 0x3e1e10, 0x6a3418, 0x9a5428, 0xc07a40),
    portal: R(0x031216, 0x08303a, 0x14707a, 0x40c8c0, 0xc8fff4),
    light: 0x30d0c0, glow: 0x9af4e8, crown: 'broken', leafPattern: 'rotted',
  },
  ossuary: {
    stone: R(0x3a3026, 0x6a5e4a, 0xa09276, 0xccc0a2, 0xf0e8d0), trim: R(0x050303, 0x16110d, 0x2c241c, 0x4a3e30, 0x6a5c48),
    leaf: R(0x100c0a, 0x201812, 0x30261c, 0x463828, 0x5e4c38), band: R(0x3a3026, 0x6a5e4a, 0xa09276, 0xccc0a2, 0xf0e8d0),
    portal: R(0x0a0e14, 0x1c2a38, 0x4a7088, 0xa8d8ee, 0xffffff),
    light: 0xbfe8ff, glow: 0xd8f6ff, crown: 'skull', leafPattern: 'lattice',
  },
  sanctum: {
    stone: R(0x3a2a2c, 0x7a686a, 0xbcaeae, 0xe6dcdc, 0xffffff), trim: GOLD,
    leaf: R(0x1e0406, 0x3a080c, 0x5e1016, 0x84202a, 0xb04048), band: GOLD,
    portal: R(0x1a0204, 0x4a0608, 0xa01418, 0xff5a3a, 0xffd8a8),
    light: 0xff4a30, glow: 0xffc060, glow2: 0xfff4c0, crown: 'spire', leafPattern: 'panels',
  },
  fungal: {
    stone: R(0x150f0b, 0x251b13, 0x392b1d, 0x4f3f2e, 0x6a5842), trim: R(0x0a1a10, 0x163020, 0x245032, 0x3e7a48, 0x68a868),
    leaf: R(0x24161a, 0x432a24, 0x684632, 0x926c48, 0xb08a60), band: R(0x0a1a10, 0x163020, 0x245032, 0x3e7a48, 0x68a868),
    portal: R(0x03120e, 0x08362c, 0x15806a, 0x5ae8c0, 0xe0fff6),
    light: 0x40f0b0, glow: 0x7af0d0, glow2: 0xff9ae8, crown: 'mound', leafPattern: 'roots',
  },
  forge: {
    stone: R(0x0d0b0d, 0x191619, 0x252125, 0x332e32, 0x4c4448), trim: IRON,
    leaf: R(0x161418, 0x26232a, 0x3a3640, 0x544e5a, 0x76707e), band: R(0x2a1008, 0x5a2008, 0x8a3a10, 0xc06020, 0xff9a40),
    portal: R(0x2a0602, 0x7a1a04, 0xe0500c, 0xffa030, 0xfff0a0),
    light: 0xff7a20, glow: 0xffa030, glow2: 0xfff0a0, crown: 'horns', leafPattern: 'plates',
  },
  frost: {
    stone: R(0x141e2a, 0x243446, 0x384e66, 0x546e8a, 0x88aed0), trim: R(0x8a9ab0, 0xb8c8dc, 0xe0ecf8, 0xf4faff, 0xffffff),
    leaf: R(0x18202a, 0x2a3644, 0x3e4e60, 0x5a7086, 0x86a2bc), band: R(0x3a5a7a, 0x5a86aa, 0x8ac0e8, 0xc8ecff, 0xffffff),
    portal: R(0x061428, 0x10305a, 0x3a78c0, 0x9ad0ff, 0xf0faff),
    light: 0x8ac8ff, glow: 0xd0f0ff, crown: 'peak', leafPattern: 'ice',
  },
  // weathered sandstone under spread stone wings, ivy, canvas-and-rib leaves; open sky through the opening
  sky: {
    stone: R(0x4a4030, 0x6c604a, 0x948668, 0xbcae8c, 0xe0d4b0), trim: GOLD,
    leaf: R(0x5a4a34, 0x84704e, 0xae9a70, 0xd6c49a, 0xf4e8c4), band: R(0x2a1e12, 0x44321e, 0x60482c, 0x7c623e, 0x9a7e54),
    portal: R(0x1a4a8a, 0x3a78c8, 0x7ab4e8, 0xd0ecfa, 0xffffff),
    light: 0xffe0a0, glow: 0xfff0c0, glow2: 0xffffff, crown: 'wings', leafPattern: 'sail',
  },
  // an outpost airlock in grey basalt: a crescent crown, hazard-striped hatch leaves; the starfield beyond
  moon: {
    stone: R(0x22232a, 0x34363e, 0x4a4c56, 0x666874, 0x8a8c9a), trim: R(0x2a2e36, 0x48505e, 0x6e7a8c, 0x9aa8bc, 0xd0dcec),
    leaf: R(0x2a2e36, 0x48505e, 0x6e7a8c, 0x9aa8bc, 0xd0dcec), band: R(0x18181c, 0x6a5010, 0xb08a1c, 0xd8a020, 0xf0cc58),
    portal: R(0x010208, 0x060c22, 0x1a3a7a, 0x6a9ae0, 0xe0ecff),
    light: 0xcfe4ff, glow: 0xff4a30, glow2: 0xe0ecff, crown: 'crescent', leafPattern: 'hatch',
  },
  // a rack chassis crowned with a chip, circuit-traced leaves, LEDs and a magenta curse-light; static beyond
  server: {
    stone: R(0x0e1016, 0x1a1e28, 0x282e3c, 0x3a4256, 0x56607a), trim: R(0x14171e, 0x262c38, 0x3a4256, 0x56607a, 0x8a96b0),
    leaf: R(0x06070a, 0x0c0e12, 0x14171c, 0x1c2028, 0x262c36), band: R(0x04303a, 0x08606e, 0x10a8b8, 0x50f0ff, 0xc8ffff),
    portal: R(0x0a0418, 0x3a0838, 0xa0189a, 0x40e0ff, 0xe0ffff),
    light: 0x40e8ff, glow: 0x50f0ff, glow2: 0xff70f0, crown: 'chip', leafPattern: 'circuit',
  },
};

export const DOOR_THEMES = Object.keys(STYLES);

function styleOf(theme: string): DoorStyle {
  return STYLES[theme] ?? STYLES.catacombs;
}

/** Light colour / emissive accent of a theme's door (renderer lights, plaque, ring, UI accents). */
export function doorColors(theme: string): { light: number; glow: number; portal: Ramp } {
  const s = styleOf(theme);
  return { light: s.light, glow: s.glow, portal: s.portal };
}

export function doorKey(theme: string, side: DoorSide, layer: DoorLayer): string {
  return `door:${theme}:${side}:${layer}`;
}

export function sigilKey(theme: string): string {
  return `door:sigil:${theme}`;
}

// ---------------------------------------------------------------- face-space shapes

const pc = (v: number) => v + 0.5;

export function inOpening(x: number, y: number): boolean {
  const px = pc(x), py = pc(y);
  if (py >= SPRING) return px >= OPEN_X0 && px < OPEN_X1 && y <= FLOOR;
  return (px - CX) ** 2 + (py - SPRING) ** 2 <= R_IN * R_IN;
}

function inRing(x: number, y: number): boolean {
  const px = pc(x), py = pc(y);
  if (py > SPRING) return false;
  const r2 = (px - CX) ** 2 + (py - SPRING) ** 2;
  return r2 > R_IN * R_IN && r2 <= R_OUT * R_OUT;
}

function inJamb(x: number, y: number): boolean {
  const px = pc(x), py = pc(y);
  return py >= SPRING && y <= FLOOR && ((px >= 12 && px < OPEN_X0) || (px >= OPEN_X1 && px < 44));
}

function inImpost(x: number, y: number): boolean {
  return y >= SPRING - 2 && y <= SPRING + 1 && ((x >= 11 && x <= 18) || (x >= 37 && x <= 44));
}

function inButtress(x: number, y: number): boolean {
  if (y > FLOOR) return false;
  const left = x >= 1 && x <= 10, right = x >= 45 && x <= 54;
  if (!left && !right) return false;
  if (y >= 74) return true;
  if (y >= 60) return left ? x >= 3 && x <= 9 : x >= 46 && x <= 52;
  return false;
}

function inThreshold(x: number, y: number): boolean {
  return y >= FLOOR - 2 && y <= FLOOR && x >= 9 && x <= 46;
}

function inCrown(crown: Crown, x: number, y: number): boolean {
  const px = pc(x), py = pc(y), dx = Math.abs(px - CX);
  switch (crown) {
    case 'stepped': {
      if (py < 34 || py > 60) return false;
      const step = Math.floor((py - 34) / 5);
      return dx <= 5 + step * 3;
    }
    case 'broken': {
      if (py < 36 || py > 60) return false;
      if (px > CX + 4 && py < 44 + (px - CX - 4) * 0.4) return false;   // a chunk fell away
      return dx <= 4 + (py - 36) * 0.62;
    }
    case 'skull':
      return py >= 40 && py <= 60 && dx <= 7 + (py - 40) * 0.5;
    case 'spire':
      return py >= 22 && py <= 60 && dx <= 2 + (py - 22) * 0.38;
    case 'mound':
      return py <= 60 && ((px - CX) / 17) ** 2 + ((py - 60) / 20) ** 2 <= 1;
    case 'horns': {
      if (py >= 40 && py <= 60 && dx <= 6 + (py - 40) * 0.55) return true;
      // horns curling up from the shoulders
      for (const s of [-1, 1]) {
        const t = (py - 28) / 20;   // 0 at the tip, 1 where the horn grows out of the crown's shoulder
        if (t >= 0 && t <= 1 && Math.abs(px - (CX + s * (8.5 + (1 - t) * (1 - t) * 6))) <= 0.7 + t * 2.2) return true;
      }
      return false;
    }
    case 'peak':
      return py >= 26 && py <= 60 && dx <= 1.5 + (py - 26) * 0.5;
    case 'wings': {
      // a keystone block with stone wings spread from it, feathers stepping down to the shoulders
      if (py >= 44 && py <= 60 && dx <= 5) return true;
      if (py < 30 || py > 60) return false;
      const reach = 4 + (60 - py) * 0.9;
      const feather = Math.floor(dx / 4) % 2 === 0 ? 0 : 2;
      return dx <= Math.min(27, reach) && py >= 34 + dx * 0.55 - feather;
    }
    case 'crescent': {
      // a crescent moon standing on a short plinth
      if (py >= 52 && py <= 60 && dx <= 6) return true;
      const r1 = Math.hypot(px - CX, py - 38), r2 = Math.hypot(px - CX - 4, py - 35);
      return r1 <= 12 && r2 > 10;
    }
    case 'chip': {
      // a square chip on the lintel, its pins running down each side
      if (py >= 36 && py <= 58 && dx <= 9) return true;
      return py >= 38 && py <= 56 && (py - 38) % 4 < 2 && dx <= 12;
    }
  }
}

// ---------------------------------------------------------------- painting helpers

function tone(ramp: Ramp, t: number, x: number, y: number): number {
  const i = Math.max(0, Math.min(ramp.length - 1, Math.floor(t + bayer(x, y) * 0.55)));
  return ramp[i] as number;
}

type Test = (x: number, y: number) => boolean;

/** Lit fill: top edges highlight, bottom/right edges shade, coursed (or radial) block joints in mortar tone. */
function fillLit(buf: PixelBuffer, inside: Test, ramp: Ramp, seed: number, joints: 'course' | 'radial' | 'none', base = 2) {
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    if (!inside(x, y)) continue;
    let t = base;
    if (!inside(x, y - 1)) t += 1.5;
    else if (!inside(x - 1, y)) t += 0.7;
    if (!inside(x, y + 1)) t -= 0.9;
    if (!inside(x + 1, y)) t -= 0.8;
    t += (hash2(x, y, seed) - 0.5) * 0.7;
    if (joints === 'course') {
      const row = Math.floor((y + 1) / 5);
      const off = row % 2 ? 3 : 0;
      if ((y + 1) % 5 === 0 || (x + off) % 7 === 0) t = 0.7 + hash2(x, y, seed + 1) * 0.3;
      else if ((y + 1) % 5 === 1) t += 0.5;   // block top lip
    } else if (joints === 'radial') {
      const a = Math.atan2(pc(y) - SPRING, pc(x) - CX);
      const seg = ((a + Math.PI) / Math.PI) * 9;
      if (Math.abs(seg - Math.round(seg)) < 0.09) t = 0.7;
      const r = Math.hypot(pc(x) - CX, pc(y) - SPRING);
      if (r > R_OUT - 1.2) t += 0.4;
    }
    buf.set(x, y, tone(ramp, t, x, y));
  }
}

/** Darken silhouette pixels (an opaque pixel with a transparent 4-neighbour) to a deep outline. */
function outline(buf: PixelBuffer, color: number) {
  const edge: number[] = [];
  for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
    if (!buf.alpha(x, y)) continue;
    if (!buf.alpha(x - 1, y) || !buf.alpha(x + 1, y) || !buf.alpha(x, y - 1) || !buf.alpha(x, y + 1)) edge.push(y * buf.w + x);
  }
  for (const i of edge) buf.set(i % buf.w, (i / buf.w) | 0, mix(buf.get(i % buf.w, (i / buf.w) | 0) & 0xffffff, color, 0.7));
}

function dot(buf: PixelBuffer, x: number, y: number, c: number, a = 255) {
  buf.blend(x, y, c, a);
}

/** Small skull (5x5 + jaw) in bone, sockets left transparent-dark for the glow layer. */
function skull(buf: PixelBuffer, x0: number, y0: number, bone: Ramp, big = false) {
  const w = big ? 9 : 5, h = big ? 8 : 5;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + 0.5 - w / 2) / (w / 2), dy = (y + 0.5 - h * 0.45) / (h * 0.55);
    if (dx * dx + dy * dy > 1.05) continue;
    let t = 2.6 - dy * 0.9 - dx * 0.5;
    if (y === 0) t += 0.6;
    buf.set(x0 + x, y0 + y, tone(bone, t, x0 + x, y0 + y));
  }
  // jaw
  const jw = big ? 5 : 3, jx = x0 + Math.floor((w - jw) / 2);
  for (let x = 0; x < jw; x++) buf.set(jx + x, y0 + h, tone(bone, 1.6, jx + x, y0 + h));
  if (big) for (let x = 0; x < jw; x += 2) buf.set(jx + x, y0 + h + 1, bone[1] as number);
  // sockets and nose
  const s = big ? 2 : 1, ey = y0 + (big ? 3 : 2);
  const ex = big ? [x0 + 2, x0 + 5] : [x0 + 1, x0 + 3];
  for (const e of ex) for (let k = 0; k < s; k++) for (let j = 0; j < s; j++) buf.set(e + k, ey + j, 0x0a0606);
  buf.set(x0 + Math.floor(w / 2), ey + s + (big ? 1 : 0), 0x1a1210);
}

function skullEyes(x0: number, y0: number, big = false): [number, number][] {
  const ey = y0 + (big ? 3 : 2);
  return big ? [[x0 + 2, ey], [x0 + 3, ey], [x0 + 5, ey], [x0 + 6, ey], [x0 + 2, ey + 1], [x0 + 6, ey + 1]] : [[x0 + 1, ey], [x0 + 3, ey]];
}

function mushroom(buf: PixelBuffer, x: number, yBase: number, h: number, cap: number, stalk: Ramp) {
  for (let y = 0; y < h; y++) buf.set(x, yBase - y, tone(stalk, 3 - y * 0.2, x, yBase - y));
  const cw = h >= 4 ? 2 : 1;
  for (let dx = -cw; dx <= cw; dx++) buf.set(x + dx, yBase - h, mix(cap, 0x000000, 0.35));
  for (let dx = -cw + 1; dx <= cw - 1; dx++) buf.set(x + dx, yBase - h - 1, mix(cap, 0x000000, 0.2));
}

// ---------------------------------------------------------------- layers (face space)

function paintFrame(theme: string): PixelBuffer {
  const s = styleOf(theme);
  const b = new PixelBuffer(FW, FH);
  const seed = theme.length * 97 + theme.charCodeAt(0);
  // dark doorway: depth falls off toward the top of the arch
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    if (!inOpening(x, y)) continue;
    const k = Math.max(0, Math.min(1, (y - (SPRING - R_IN)) / (FLOOR - SPRING + R_IN)));
    b.set(x, y, mix(0x040304, s.portal[0] as number, 0.35 + k * 0.4));
  }
  const crownTest: Test = (x, y) => inCrown(s.crown, x, y) && !inOpening(x, y) && !inRing(x, y);
  fillLit(b, inButtress, s.stone, seed, 'course', 1.8);
  fillLit(b, crownTest, s.crown === 'chip' ? s.leaf : s.stone, seed + 3, s.crown === 'skull' || s.crown === 'mound' || s.crown === 'crescent' || s.crown === 'chip' ? 'none' : 'course', 2);
  fillLit(b, inJamb, s.stone, seed + 5, 'course', 2.2);
  fillLit(b, inRing, s.crown === 'skull' ? s.stone : s.stone, seed + 7, 'radial', 2.4);
  fillLit(b, inImpost, s.trim, seed + 9, 'none', 2.4);
  fillLit(b, inThreshold, s.stone, seed + 11, 'none', 2.6);
  // buttress caps (trim) and plinths
  fillLit(b, (x, y) => inButtress(x, y) && (y === 60 || y === 61 || y === 74 || y === 75) && !inButtress(x, y - (y === 60 || y === 74 ? 1 : 2)), s.trim, seed + 13, 'none', 2.6);
  // keystone
  const keyTest: Test = (x, y) => y >= SPRING - R_OUT - 2 && y <= SPRING - R_IN + 1 && Math.abs(pc(x) - CX) <= 3 - (y - (SPRING - R_OUT - 2)) * 0.12;
  if (theme !== 'catacombs' && theme !== 'ossuary') fillLit(b, keyTest, s.trim, seed + 15, 'none', 2.7);
  ornamentFrame(b, theme, s, seed);
  outline(b, 0x050304);
  return b;
}

function ornamentFrame(b: PixelBuffer, theme: string, s: DoorStyle, seed: number) {
  switch (theme) {
    case 'catacombs': {
      // iron bands across the jambs, studs, and a skull keystone
      for (const y of [80, 92]) for (let x = 12; x < 44; x++) if (inJamb(x, y)) { b.set(x, y, tone(IRON, 2.4, x, y)); b.set(x, y + 1, IRON[1] as number); }
      for (const [x, y] of [[13, 80], [16, 80], [39, 80], [42, 80], [13, 92], [16, 92], [39, 92], [42, 92]]) b.set(x, y, IRON[4] as number);
      skull(b, CX - 5, SPRING - R_OUT - 3, BONE, true);
      break;
    }
    case 'flooded': {
      // algae stains running down from the ring and the crown, water marks low on the stone
      for (let x = 2; x < FW - 2; x++) {
        const run = Math.floor(hash2(x, 7, seed) * 14);
        let started = false;
        for (let y = 40; y < FH; y++) {
          const a = b.alpha(x, y);
          if (!a || inOpening(x, y)) { started = false; continue; }
          if (!started && b.alpha(x, y - 1) === 0) started = true;
          if (started && y < 40 + run + 20 && hash2(x, y, seed + 2) < 0.7) b.set(x, y, tone(s.trim, 1.4 + hash2(x, y, 5) * 1.6, x, y));
        }
      }
      for (let x = 1; x < FW - 1; x++) for (let y = 92; y < FH; y++) if (b.alpha(x, y) && !inOpening(x, y) && y === 92 + (x % 3 === 0 ? 1 : 0)) b.set(x, y, s.stone[4] as number);
      break;
    }
    case 'ossuary': {
      // the arch is built from skulls; femur jambs; a great skull crown with crossed bones
      for (let k = 0; k < 9; k++) {
        const a = Math.PI + (k + 0.5) * (Math.PI / 9);
        const r = (R_IN + R_OUT) / 2;
        skull(b, Math.round(CX + Math.cos(a) * r) - 2, Math.round(SPRING + Math.sin(a) * r) - 2, s.stone);
      }
      for (const jx of [14, 40]) for (let y = SPRING + 2; y < FLOOR - 2; y++) {
        b.set(jx, y, tone(s.stone, 3.2, jx, y)); b.set(jx + 1, y, tone(s.stone, 2.4, jx + 1, y));
        if ((y - SPRING) % 11 === 0) { b.set(jx - 1, y, s.stone[3] as number); b.set(jx + 2, y, s.stone[2] as number); }
      }
      for (let t = 0; t < 18; t++) {
        b.set(CX - 9 + t, 38 + Math.floor(t * 0.55), tone(s.stone, 3, t, 1));
        b.set(CX + 8 - t, 38 + Math.floor(t * 0.55), tone(s.stone, 2.6, t, 2));
      }
      skull(b, CX - 5, 40, s.stone, true);
      break;
    }
    case 'sanctum': {
      // gilded edging on the ring, gold finial, candles standing on the buttress tops
      for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
        if (!inRing(x, y)) continue;
        const r = Math.hypot(pc(x) - CX, pc(y) - SPRING);
        if (r > R_OUT - 1 || r < R_IN + 1) b.set(x, y, tone(GOLD, 2.8, x, y));
      }
      for (let y = 15; y <= 22; y++) for (let x = CX - 3; x <= CX + 2; x++) if ((pc(x) - CX) ** 2 + (pc(y) - 18.5) ** 2 <= 7) b.set(x, y, tone(GOLD, 3.4 - (y - 15) * 0.25, x, y));
      for (const cx of [3, 6, 9, 46, 49, 52]) {
        const top = (cx < 20 ? 60 : 60) - 1 - (cx === 6 || cx === 49 ? 3 : 0);
        for (let y = top; y < 60; y++) b.set(cx, y, tone(R(0x8a7a6a, 0xc8b8a0, 0xf0e4cc, 0xfff8ea, 0xffffff), 2.6, cx, y));
      }
      break;
    }
    case 'fungal': {
      // roots creeping over the stone, mushroom stalks (caps glow in the glow layer)
      for (let k = 0; k < 9; k++) {
        let x = 4 + Math.floor(hash2(k, 1, seed) * 48), y = 40 + Math.floor(hash2(k, 2, seed) * 10);
        for (let n = 0; n < 40 && y < FH; n++) {
          if (b.alpha(x, y) && !inOpening(x, y)) b.set(x, y, tone(R(0x24161a, 0x432a24, 0x684632, 0x926c48), 2 + hash2(x, y, 3), x, y));
          y++; if (hash2(k, n, seed) < 0.35) x += hash2(n, k, seed) < 0.5 ? -1 : 1;
        }
      }
      for (const [x, y, h] of FUNGAL_SHROOMS) mushroom(b, x, y, h, 0x3a3030, R(0x5a5040, 0x8a7c66, 0xc0b296, 0xe8dcc0));
      break;
    }
    case 'forge': {
      // iron straps on the jambs and crown; lava cracks are emissive (glow layer)
      for (const y of [78, 90]) for (let x = 12; x < 44; x++) if (inJamb(x, y)) b.set(x, y, tone(IRON, 2.6, x, y));
      for (const [x, y] of FORGE_CRACKS) b.set(x, y, 0x1a0804);
      break;
    }
    case 'frost': {
      // rime on every top edge, icicles hanging from the ring, crown and buttress caps
      for (let y = 1; y < FH; y++) for (let x = 0; x < FW; x++) {
        if (b.alpha(x, y) && !inOpening(x, y) && !b.alpha(x, y - 1)) { b.set(x, y, s.trim[3] as number); if (b.alpha(x, y + 1) && hash2(x, y, seed) < 0.6) b.set(x, y + 1, s.trim[1] as number); }
      }
      for (const [x, y, len] of FROST_ICICLES) for (let k = 0; k < len; k++) b.set(x, y + k, tone(R(0x5a86aa, 0x8ac0e8, 0xc8ecff, 0xf0faff, 0xffffff), 3.4 - k * 0.5, x, y + k));
      break;
    }
    case 'sky': {
      // feather grooves in the wings, a gold sun boss on the keystone, ivy climbing both buttresses
      for (let y = 30; y < 60; y++) for (let x = 0; x < FW; x++) {
        if (!b.alpha(x, y) || inOpening(x, y) || inRing(x, y)) continue;
        const dx = Math.abs(pc(x) - CX);
        if (dx > 6 && Math.floor(dx) % 4 === 0) b.set(x, y, tone(s.stone, 1, x, y));
      }
      for (let y = 48; y <= 54; y++) for (let x = CX - 3; x <= CX + 2; x++) if ((pc(x) - CX) ** 2 + (pc(y) - 51) ** 2 <= 8) b.set(x, y, tone(GOLD, 3.2 - (y - 48) * 0.2, x, y));
      for (const bx of [3, 49]) {
        let x = bx;
        for (let y = FLOOR - 1; y > 56; y--) {
          x += hash2(bx, y, seed) < 0.3 ? (hash2(y, bx, seed) < 0.5 ? -1 : 1) : 0;
          x = Math.max(bx - 2, Math.min(bx + 4, x));
          if (b.alpha(x, y)) b.set(x, y, tone(R(0x16300e, 0x285018, 0x3e7a22, 0x5ea432, 0x8ccc50), 2 + hash2(x, y, 3) * 1.6, x, y));
          if (y % 3 === 0 && b.alpha(x + 1, y)) b.set(x + 1, y, 0x3e7a22);
        }
      }
      break;
    }
    case 'moon': {
      // riveted metal jamb plates, a hazard-striped threshold, regolith banked against the buttresses
      for (const y of [76, 88]) for (let x = 12; x < 44; x++) if (inJamb(x, y)) b.set(x, y, tone(s.trim, 3, x, y));
      for (let x = 9; x <= 46; x++) for (let y = FLOOR - 2; y <= FLOOR; y++) b.set(x, y, (x + y) % 6 < 3 ? 0xd8a020 : 0x18181c);
      for (let x = 0; x < FW; x++) for (let y = FLOOR - 4; y <= FLOOR; y++) if (b.alpha(x, y) && inButtress(x, y) && y > FLOOR - 4 + Math.sin(x * 0.7) * 1.5) b.set(x, y, tone(R(0x4a4c54, 0x6a6c76, 0x8e909a, 0xb4b6c0, 0xdcdee6), 2.4, x, y));
      break;
    }
    case 'server': {
      // cable bundles drooping over the frame, vent slots in the buttresses, a circuit trace round the ring
      for (let y = 62; y < FH; y += 3) for (let x = 2; x < FW - 2; x++) if (inButtress(x, y) && x % 9 > 1 && x % 9 < 8) b.set(x, y, 0x040508);
      for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
        if (!inRing(x, y)) continue;
        const r = Math.hypot(pc(x) - CX, pc(y) - SPRING);
        if (Math.abs(r - (R_IN + R_OUT) / 2) < 0.6) b.set(x, y, 0x06303a);
      }
      for (const [x0, len] of [[10, 9], [16, 6], [40, 8], [46, 11]] as const) for (let k = 0; k < len; k++) {
        const x = x0 + Math.round(Math.sin(k * 0.6) * 1.2), y = 60 + k;
        if (b.alpha(x, y) || k < 3) b.set(x, y, tone(R(0x200608, 0x40100e, 0x6a1c18, 0x983028, 0xc04c40), 2.4, x, y));
      }
      break;
    }
  }
}

const FUNGAL_SHROOMS: [number, number, number][] = [[4, 73, 4], [7, 73, 2], [48, 73, 5], [52, 73, 3], [18, 58, 3], [38, 57, 4], [CX - 6, 44, 3], [CX + 5, 46, 4], [10, 59, 2], [45, 59, 2]];
const FORGE_CRACKS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (const [sx, sy, len] of [[5, 76, 18], [49, 80, 16], [CX - 3, 44, 9], [CX + 4, 48, 8], [14, 84, 10], [41, 82, 12]] as const) {
    let x: number = sx, y: number = sy;
    for (let k = 0; k < len; k++) { out.push([x, y]); y++; if (hash2(sx, k, 9) < 0.45) x += hash2(k, sy, 4) < 0.5 ? -1 : 1; }
  }
  return out;
})();
const FROST_ICICLES: [number, number, number][] = [[14, SPRING - 1, 4], [17, SPRING - 1, 2], [40, SPRING - 1, 3], [43, SPRING - 1, 5], [CX - 10, 61, 3], [CX + 9, 61, 4], [CX - 3, 52, 2], [3, 61, 3], [8, 61, 2], [47, 61, 4], [52, 61, 2], [5, 75, 3], [50, 75, 3]];

function paintPortal(theme: string, f: number): PixelBuffer {
  const s = styleOf(theme);
  const b = new PixelBuffer(FW, FH);
  const ph = f / DOOR_FRAMES.portal;
  const vx = CX, vy = SPRING + 8;   // vanishing point, a little below the spring line
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    if (!inOpening(x, y)) continue;
    const dx = (pc(x) - vx) / 10, dy = (pc(y) - vy) / 26;
    const r = Math.hypot(dx, dy * 1.25);
    const a = Math.atan2(dy, dx);
    const ring = (((r * 2.4 - ph) % 1) + 1) % 1;
    const swirl = Math.sin(a * 3 + r * 7 - ph * Math.PI * 2);
    let t = 3.6 * Math.max(0, 1 - r) ** 0.85 + (ring < 0.22 ? 0.9 : 0) + swirl * 0.35 + 0.35;
    if (y > FLOOR - 6) t += (y - (FLOOR - 6)) * 0.18;   // light pooling on the threshold
    b.set(x, y, tone(s.portal, t, x, y));
  }
  // the dungeon beyond: receding arches in silhouette
  for (const k of [0.62, 0.38]) {
    const w = (OPEN_X1 - OPEN_X0) * k, top = vy - (vy - (SPRING - R_IN)) * k, rr = w / 2;
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      if (!inOpening(x, y)) continue;
      const px = pc(x), py = pc(y);
      const inside = py >= top + rr ? Math.abs(px - vx) <= rr && py <= vy + (FLOOR - vy) * k : (px - vx) ** 2 + (py - top - rr) ** 2 <= rr * rr;
      const inner = py >= top + rr ? Math.abs(px - vx) <= rr - 1 && py <= vy + (FLOOR - vy) * k - 1 : (px - vx) ** 2 + (py - top - rr) ** 2 <= (rr - 1) ** 2;
      if (inside && !inner) b.set(x, y, mix(b.get(x, y) & 0xffffff, s.portal[1] as number, 0.55));
    }
  }
  // motes of the place beyond
  for (let k = 0; k < 14; k++) {
    const x0 = OPEN_X0 + 1 + Math.floor(hash2(k, 1, theme.length) * (OPEN_X1 - OPEN_X0 - 2));
    const span = 44;
    const y0 = hash2(k, 2, theme.length) * span;
    const speed = theme === 'frost' ? -1 : theme === 'flooded' || theme === 'forge' || theme === 'fungal' ? 1 : theme === 'server' ? 2.5 : theme === 'sky' ? -0.6 : theme === 'moon' ? 0.15 : 0.5;
    const yy = SPRING - R_IN + ((((y0 - ph * span * speed * (0.6 + hash2(k, 3, 1) * 0.6)) % span) + span) % span);
    const xx = x0 + (theme === 'fungal' || theme === 'ossuary' ? Math.round(Math.sin(ph * Math.PI * 2 + k) * 1.5) : 0);
    const y = Math.floor(yy);
    if (inOpening(xx, y)) b.set(xx, y, s.portal[4] as number);
    if (theme === 'ossuary' && inOpening(xx, y + 1)) b.set(xx, y + 1, s.portal[3] as number);
  }
  return b;
}

/** Leaf width per frame (columns per leaf; 0 = closed with a glowing seam, 5 = open). */
const LEAF_W = [10, 8, 6, 4, 2, 1];

function paintLeaves(theme: string, f: number): PixelBuffer {
  const s = styleOf(theme);
  const b = new PixelBuffer(FW, FH);
  const w = LEAF_W[f] ?? 1;
  const turn = f / (DOOR_FRAMES.leaves - 1);
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    if (!inOpening(x, y)) continue;
    const fromL = x - OPEN_X0, fromR = OPEN_X1 - 1 - x;
    let side: 0 | 1 | -1 = -1, u = 0;
    if (fromL < w) { side = 0; u = fromL; } else if (fromR < w) { side = 1; u = fromR; }
    if (side < 0) continue;
    if (f === 0 && x === CX - 1) continue;                 // the seam: portal light leaks through
    if (f <= 2 && y === FLOOR) continue;                   // and under the leaves
    // foreshortened leaf-local column (0 at the hinge .. 9 at the meeting edge)
    const lu = Math.min(9, Math.floor((u * 10) / w));
    const c = leafPixel(s, lu, y, side, x);
    const k = 1 - turn * 0.55 - (lu === 9 && f > 0 ? 0.2 : 0);
    b.set(x, y, mix(0x000000, c, Math.max(0.2, k)));
  }
  outline(b, 0x050304);
  return b;
}

function leafPixel(s: DoorStyle, u: number, y: number, side: number, x: number): number {
  const L = s.leaf, B = s.band;
  const edge = u === 9 ? -0.8 : u === 0 ? 0.6 : 0;
  const strap = y === 77 || y === 78 || y === 93 || y === 94;
  switch (s.leafPattern) {
    case 'planks':
    case 'rotted': {
      if (strap) return tone(B, u % 3 === 1 && (y === 77 || y === 93) ? 4 : 2.4, x, y);
      const plank = u % 3 === 2 ? 0.6 : 2 + hash2(Math.floor(u / 3) + side * 5, Math.floor(y / 9), 4) * 0.9;
      let c = tone(L, plank + edge + (y % 7 === 0 && u % 3 === 0 ? 0.6 : 0), x, y);
      if (s.leafPattern === 'rotted' && hash2(u + side * 11, Math.floor(y / 3), 9) < 0.18) c = mix(c, 0x24582a, 0.6);
      if (u === 7 && y === 86 && s.leafPattern === 'planks') c = B[4] as number;   // ring pull
      return c;
    }
    case 'lattice': {
      const diag = (u + y) % 5 === 0 || (u - y + 100) % 5 === 0;
      return diag ? tone(B, 2.6 + edge, x, y) : tone(L, 1.5 + edge, x, y);
    }
    case 'panels': {
      const border = u === 0 || u === 9 || y === SPRING + 2 || y === 86 || y === FLOOR - 2 || (u === 1 || u === 8);
      if (border) return tone(B, 2.8 + edge * 0.5, x, y);
      if (u >= 3 && u <= 6 && (y === 78 || y === 94)) return B[3] as number;   // gilt sigil
      return tone(L, 2.2 + (y % 2 ? 0.2 : 0) + edge, x, y);
    }
    case 'roots': {
      const wave = Math.round(Math.sin(y / 5 + u) * 1.2);
      const root = (u + wave) % 3 === 0;
      return root ? tone(L, 3 + edge, x, y) : tone(L, 1.2 + edge, x, y);
    }
    case 'plates': {
      const seam = y % 12 === 0 || u === 5;
      if (seam) return tone(B, 2.2, x, y);
      const rivet = (y % 12 === 2 || y % 12 === 10) && (u === 1 || u === 8);
      return rivet ? (L[4] as number) : tone(L, 2.2 + edge - (y % 12) * 0.05, x, y);
    }
    case 'ice': {
      if (strap) return tone(B, 2.6, x, y);
      const plank = u % 3 === 2 ? 0.8 : 2.2;
      const c = tone(L, plank + edge, x, y);
      const frost = hash2(u + side * 7, y, 3) < 0.25 || (u + y) % 9 === 0;
      return frost ? mix(c, B[3] as number, 0.6) : mix(c, B[2] as number, 0.18);
    }
    case 'sail': {
      // stretched canvas on wooden ribs, bellying a little in the wind
      if (y % 10 === 0 || u === 0) return tone(B, 2.4 + edge, x, y);
      return tone(L, 2.4 + Math.sin((y % 10) / 10 * Math.PI) * 0.8 + edge, x, y);
    }
    case 'hatch': {
      // an airlock leaf: plate with a porthole, hazard stripes at the foot
      if (y > FLOOR - 9) return (u + y) % 6 < 3 ? (B[3] as number) : (B[0] as number);
      if (u >= 3 && u <= 6 && y >= 78 && y <= 84) return (u === 3 || u === 6 || y === 78 || y === 84) ? (L[4] as number) : 0x0a1830;
      return tone(L, 2.2 + edge - (y % 16 === 0 ? 1 : 0), x, y);
    }
    case 'circuit': {
      // black panels traced in cyan
      const trace = (u === 4 && y % 12 < 8) || (y % 12 === 7 && u >= 2 && u <= 7) || (u === 7 && y % 12 > 7);
      if (trace) return tone(B, 2.6, x, y);
      return tone(L, 2 + edge + (y % 24 === 0 ? 1 : 0), x, y);
    }
  }
}

function paintGlow(theme: string, f: number): PixelBuffer {
  const s = styleOf(theme);
  const b = new PixelBuffer(FW, FH);
  const pulse = 0.65 + 0.35 * Math.sin((f / DOOR_FRAMES.glow) * Math.PI * 2);
  const halo = (x: number, y: number, c: number, a: number) => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!b.alpha(x + dx, y + dy)) b.set(x + dx, y + dy, c, Math.round(a * 0.35));
  };
  const lit = (x: number, y: number, c: number, a = 255) => { b.set(x, y, c, a); halo(x, y, c, a); };
  switch (theme) {
    case 'catacombs':
      for (const [x, y] of skullEyes(CX - 5, SPRING - R_OUT - 3, true)) lit(x, y, mix(0xff6a1a, s.glow, pulse), 255);
      break;
    case 'flooded':
      for (let k = 0; k < 4; k++) {
        const x = [16, 25, 33, 41][k], y0 = [SPRING - 2, SPRING - R_OUT, SPRING - R_OUT + 1, SPRING - 1][k];
        const y = y0 + ((f + k * 2) % 4) * 3;
        lit(x, y, s.glow, 230); b.set(x, y + 1, s.glow, 150);
      }
      for (const [x, y] of [[6, 66], [50, 70], [CX - 7, 50], [CX + 8, 54]]) if ((x + f) % 2 === 0) lit(x, y, 0x7af0d0, 200);
      break;
    case 'ossuary':
      for (let k = 0; k < 9; k++) {
        const a = Math.PI + (k + 0.5) * (Math.PI / 9), r = (R_IN + R_OUT) / 2;
        const x0 = Math.round(CX + Math.cos(a) * r) - 2, y0 = Math.round(SPRING + Math.sin(a) * r) - 2;
        if ((k + f) % 3 !== 0) for (const [x, y] of skullEyes(x0, y0)) b.set(x, y, s.glow, Math.round(200 * pulse + 40));
      }
      for (const [x, y] of skullEyes(CX - 5, 40, true)) lit(x, y, s.glow, 255);
      break;
    case 'sanctum':
      for (const cx of [3, 6, 9, 46, 49, 52]) {
        const top = 59 - (cx === 6 || cx === 49 ? 3 : 0);
        const flick = (f + cx) % 4;
        lit(cx, top - 1, s.glow, 255);
        b.set(cx, top - 2, flick < 2 ? (s.glow2 ?? 0xffffff) : s.glow, 230);
        if (flick === 1) b.set(cx + (cx % 2 ? 1 : -1), top - 3, s.glow, 140);
      }
      for (const [x, y] of [[CX - 1, 17], [CX, 16]]) b.set(x, y, 0xffffff, Math.round(255 * pulse));
      break;
    case 'fungal':
      FUNGAL_SHROOMS.forEach(([x, yb, h], i) => {
        const cap = i % 3 === 1 ? (s.glow2 ?? s.glow) : s.glow;
        const cw = h >= 4 ? 2 : 1;
        const a = Math.round(255 * (0.6 + 0.4 * Math.sin(((f + i) / 4) * Math.PI * 2)));
        for (let dx = -cw; dx <= cw; dx++) lit(x + dx, yb - h, cap, a);
        for (let dx = -cw + 1; dx <= cw - 1; dx++) lit(x + dx, yb - h - 1, mix(cap, 0xffffff, 0.4), a);
      });
      for (let k = 0; k < 5; k++) { const x = 10 + ((k * 11 + f * 3) % 36), y = 56 - ((f * 2 + k * 5) % 14); if (!b.alpha(x, y)) b.set(x, y, s.glow, 160); }
      break;
    case 'forge':
      FORGE_CRACKS.forEach(([x, y], i) => {
        const hot = (i + f * 3) % 9;
        b.set(x, y, hot < 2 ? (s.glow2 ?? 0xffffff) : hot < 5 ? s.glow : 0xb83a08, Math.round(255 * (0.7 + 0.3 * pulse)));
      });
      for (let k = 0; k < 4; k++) { const x = CX - 9 + ((k * 7 + f * 2) % 18), y = 40 - ((f * 3 + k * 4) % 12); b.set(x, y, k % 2 ? s.glow : (s.glow2 ?? s.glow), 200); }
      break;
    case 'frost':
      FROST_ICICLES.forEach(([x, y, len], i) => { if ((i + f) % 4 === 0) lit(x, y + len - 1, 0xffffff, 255); });
      for (const [x, y] of [[CX, SPRING - R_OUT - 1], [CX - 1, SPRING - R_OUT], [CX + 1, SPRING - R_OUT]]) b.set(x, y, s.glow, Math.round(255 * pulse));
      break;
    case 'sky':
      // the sun boss catches the light; motes of pollen drift up past the wings
      for (const [x, y] of [[CX - 1, 50], [CX, 50], [CX - 1, 51], [CX, 51]]) lit(x, y, s.glow2 ?? 0xffffff, Math.round(255 * pulse));
      for (let k = 0; k < 5; k++) { const x = 6 + ((k * 13 + f * 2) % 44), y = 56 - ((f * 3 + k * 7) % 22); if (!b.alpha(x, y)) b.set(x, y, s.glow, 170); }
      break;
    case 'moon':
      // beacon lights blinking on the buttress caps, in turn
      for (const [i, x] of [[0, 6], [1, 49]] as const) if ((f + i * 2) % 4 < 2) { lit(x, 59, s.glow, 255); b.set(x, 58, 0xffb0a0, 220); }
      for (const [x, y] of [[CX - 4, 40], [CX + 2, 34]]) if (f % 2) b.set(x, y, s.glow2 ?? 0xffffff, 200);
      break;
    case 'server': {
      // LED rows on the chip crown blinking, the circuit trace round the ring pulsing, a magenta warning eye
      for (let k = 0; k < 6; k++) { const x = CX - 6 + k * 2, on = ((k * 5 + f * 3) % 7) < 4; if (on) lit(x, 46, k % 3 === 0 ? (s.glow2 ?? s.glow) : s.glow, 255); }
      for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
        if (!inRing(x, y)) continue;
        const a = Math.atan2(pc(y) - SPRING, pc(x) - CX);
        const r = Math.hypot(pc(x) - CX, pc(y) - SPRING);
        if (Math.abs(r - (R_IN + R_OUT) / 2) < 0.6 && Math.abs(((a / Math.PI + 1) * 2 + f * 0.25) % 1 - 0.5) < 0.2) b.set(x, y, s.glow, 230);
      }
      lit(CX, 41, s.glow2 ?? s.glow, Math.round(255 * pulse));
      break;
    }
  }
  return b;
}

/** Flat floor sigil (iso ellipse 56x28) in the theme's glow colour; white-ish so the renderer can tint. */
function paintSigil(theme: string): PixelBuffer {
  const s = styleOf(theme);
  const W = 56, H = 28, b = new PixelBuffer(W, H);
  const cx = W / 2, cy = H / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x + 0.5 - cx) / 26, dy = (y + 0.5 - cy) / 13;
    const r = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx);
    if (r <= 1 && r > 0.86) b.set(x, y, s.glow, 230);
    else if (r <= 0.7 && r > 0.6) b.set(x, y, s.light, 200);
    else if (r <= 0.86 && r > 0.7) {
      const tick = Math.abs(((a / (Math.PI * 2)) * 12 + 12) % 1 - 0.5) < 0.12;
      if (tick) b.set(x, y, s.glow, 210);
    } else if (r <= 0.22) b.set(x, y, mix(s.glow, 0xffffff, 0.5), 220);
    else if (r < 0.6 && Math.abs(Math.sin(a * 3)) < 0.12 && r > 0.3) b.set(x, y, s.light, 150);
  }
  return b;
}

// ---------------------------------------------------------------- shear & sheets

/** Shear a face-space buffer onto the L or R wall face (and shade R, the darker face, for lit layers). */
export function shearToFace(src: PixelBuffer, side: DoorSide, lit: boolean): PixelBuffer {
  const out = new PixelBuffer(FW, TEX_H);
  const k = lit && side === 'R' ? 0.78 : 1;
  for (let x = 0; x < FW; x++) {
    const dy = side === 'L' ? Math.floor(x / 2) : Math.floor((FW - x) / 2);
    for (let y = 0; y < FH; y++) {
      const c = src.get(x, y);
      const a = c >>> 24;
      if (!a) continue;
      out.set(x, y + dy, k === 1 ? c & 0xffffff : mix(0x000000, c & 0xffffff, k), a);
    }
  }
  return out;
}

export interface DoorSheet { key: string; width: number; height: number; rgba: Uint8ClampedArray; frameW: number; frameH: number; frames: number }

function strip(frames: PixelBuffer[], key: string): DoorSheet {
  const fw = frames[0]!.w, fh = frames[0]!.h;
  const all = new PixelBuffer(fw * frames.length, fh);
  frames.forEach((f, i) => f.copyTo(all, i * fw, 0));
  return { key, width: all.w, height: all.h, rgba: all.toRGBA(), frameW: fw, frameH: fh, frames: frames.length };
}

/** Every sheet for one theme (both faces + sigil). Pure: usable in Node previews. */
export function buildDoorSheets(theme: string): DoorSheet[] {
  const frame = paintFrame(theme);
  const portal = Array.from({ length: DOOR_FRAMES.portal }, (_, f) => paintPortal(theme, f));
  const leaves = Array.from({ length: DOOR_FRAMES.leaves }, (_, f) => paintLeaves(theme, f));
  const glow = Array.from({ length: DOOR_FRAMES.glow }, (_, f) => paintGlow(theme, f));
  const out: DoorSheet[] = [];
  for (const side of ['L', 'R'] as const) {
    out.push(strip([shearToFace(frame, side, true)], doorKey(theme, side, 'frame')));
    out.push(strip(portal.map((p) => shearToFace(p, side, false)), doorKey(theme, side, 'portal')));
    out.push(strip(leaves.map((p) => shearToFace(p, side, true)), doorKey(theme, side, 'leaves')));
    out.push(strip(glow.map((p) => shearToFace(p, side, false)), doorKey(theme, side, 'glow')));
  }
  out.push(strip([paintSigil(theme)], sigilKey(theme)));
  return out;
}

/** Register a theme's door textures (idempotent, lazy: only the three themes on offer are ever built). */
export function ensureDoorArt(scene: Phaser.Scene, theme: string): void {
  const t = STYLES[theme] ? theme : 'catacombs';
  if (scene.textures.exists(doorKey(t, 'L', 'frame')) && scene.textures.exists(sigilKey(t))) return;
  for (const s of buildDoorSheets(t)) addFramedTexture(scene, s.key, s.width, s.height, s.rgba, s.frameW, s.frameH, s.frames);
}

/** The theme id the art actually uses (unknown ids fall back to catacombs). */
export function doorArtTheme(theme: string): string {
  return STYLES[theme] ? theme : 'catacombs';
}

/** Frames in a door portrait loop: lcm of the portal (6) and glow (4) cycles. */
export const DOOR_PORTRAIT_FRAMES = 12;

/**
 * Flat, front-on frames of a theme's door for UI art (the Fate cards' destination window, ui/fateArt.ts): the animated
 * portal behind the lit frame with the leaves thrown wide open, emissive details on top. DOOR_PORTRAIT_FRAMES RGBA
 * buffers of DOOR_GEOM.FW x DOOR_GEOM.FH. Pure (no DOM), so it also runs in Node previews.
 */
export function buildDoorPortrait(theme: string): { w: number; h: number; frames: Uint8ClampedArray[] } {
  const t = doorArtTheme(theme);
  const frame = paintFrame(t);
  const leaves = paintLeaves(t, DOOR_FRAMES.leaves - 1);
  const frames: Uint8ClampedArray[] = [];
  for (let f = 0; f < DOOR_PORTRAIT_FRAMES; f++) {
    const b = new PixelBuffer(FW, FH);
    frame.drawTo(b, 0, 0);
    paintPortal(t, f % DOOR_FRAMES.portal).drawTo(b, 0, 0);
    leaves.drawTo(b, 0, 0);
    paintGlow(t, f % DOOR_FRAMES.glow).drawTo(b, 0, 0);
    frames.push(b.toRGBA());
  }
  return { w: FW, h: FH, frames };
}
