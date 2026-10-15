/**
 * The Sunken Catacombs: framework-free terrain, prop and decal generators + tile pickers.
 * (The Phaser registration lives in dungeon.ts; this module never touches Phaser or the DOM so the
 * Node asset validator can import its metadata.)
 *
 * Wall frames are 32x64: top 32 px = cap (the wall's top surface, drawn one tile "up"), bottom 32 px =
 * south face (only when the tile to the south is floor). Bottom of the frame aligns to the tile bottom.
 *
 * dungeon:wall frame layout:
 *   0..31   face frames: faceVariant * 4 + (west edge ? 1 : 0) + (east edge ? 2 : 0)
 *           face variants: 0 bricks, 1 cracked, 2 moss, 3 water stain + drips, 4 iron ring, 5 tattered banner,
 *                          6 candle alcove, 7 skulls in the wall
 *   32..47  cap-only frames (transparent lower half): 32 + edgeMask * 2 + variant,
 *           edgeMask bits: 1 = floor to the N, 2 = floor to the W, 4 = floor to the E (lit rims)
 */
import { MATERIALS, PALETTES } from './palette';
import { Painter, PixelBuffer, Sheet, bayer, hash2, lighten, mix, outlinePass, rng, type Ramp } from './draw/pixel';
import { PILLAR_H, THEME_DECAL_SPECS, THEME_PROP_SPECS, VARIANT_THEMES, buildThemeFrames, fadePillarTop, paintTallPillar, themeCapTexture, themeFloorFrame, themeVoidFrame, type ThemeId } from './dungeonThemes';
import { CLUTTER_NO_OUTLINE, CLUTTER_PROP_SPECS, type ClutterSpec, type PropFx } from './clutter';
import { ROOM_NO_OUTLINE, ROOM_PROP_SPECS } from './roomProps';
import { THEME_EXTRA_NO_OUTLINE, THEME_EXTRA_PROP_SPECS } from './themeProps';
import { AMBIENT_FX_SPECS, AMBIENT_TEXTURE_KEYS, CRITTER_SPECS, STORY_DECAL_SPECS } from './ambientArt';

export type { PropFx } from './clutter';

export const WALL_HEIGHT = 32;

const T = 32;
const D = PALETTES.dungeon;

export const DUNGEON_FRAMES = {
  floorCount: 12,
  faceVariants: 8,
  faceBase: 0,
  capBase: 32,
  wallTotal: 48,
} as const;

// ---------------------------------------------------------------- pickers

const FLOOR_PICK = [0, 1, 2, 0, 1, 2, 0, 1, 3, 4, 5, 7, 8, 9, 10, 11, 2, 0, 1, 6, 0, 1, 2, 3, 0, 1, 2, 4, 9, 11, 0, 1, 2, 3, 7, 1, 0, 2, 8, 10];
const FACE_PICK = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 0, 1, 2, 0, 3, 7];

export function pickFloor(x: number, y: number, hash: number): number {
  const h = (hash >>> 0) ^ Math.floor(hash2(x, y, 7) * 1e6);
  return FLOOR_PICK[(h >>> 0) % FLOOR_PICK.length] as number;
}

export function pickWall(isWall: (x: number, y: number) => boolean, x: number, y: number, hash: number): { frame: number; face: boolean } {
  const h = hash >>> 0;
  if (!isWall(x, y + 1)) {
    const v = FACE_PICK[h % FACE_PICK.length] as number;
    const w = !isWall(x - 1, y) ? 1 : 0;
    const e = !isWall(x + 1, y) ? 2 : 0;
    return { frame: DUNGEON_FRAMES.faceBase + v * 4 + w + e, face: true };
  }
  const mask = (!isWall(x, y - 1) ? 1 : 0) | (!isWall(x - 1, y) ? 2 : 0) | (!isWall(x + 1, y) ? 4 : 0);
  return { frame: DUNGEON_FRAMES.capBase + mask * 2 + ((h >>> 2) & 1), face: false };
}

// ---------------------------------------------------------------- props & decals metadata

export interface PropLight {
  color: number;
  radius: number;
  intensity: number;
  flicker: number;
}

export interface PropDef {
  key: string;
  anim?: string;
  originX: number;
  originY: number;
  placement: 'wallFace' | 'floor' | 'corner';
  blocks: boolean;
  light?: PropLight;
  // ---- set-dressing metadata (all optional; see clutter.ts for the conventions)
  /** frame size and count of the prop sheet */
  w?: number;
  h?: number;
  frames?: number;
  /** frames are static variants, not an animation */
  variants?: boolean;
  /** flat enough to bake into the floor texture */
  low?: boolean;
  /** flat but animated / emissive: sprite drawn below actors */
  flat?: boolean;
  /** tall: stands against a back wall (authored for a north wall, mirrored for west walls) */
  hug?: boolean;
  hugDepth?: number;
  /** wall props: origin height above the floor line in px */
  mount?: number;
  /** drawn unlit */
  emissive?: boolean;
  /** hanging: randomised animation rate */
  sway?: boolean;
  /** ambient emitters (offsets in sprite px from the origin) */
  fx?: PropFx[];
  /** unlit overlay holding the prop's flames / embers (same frame size and origin) */
  glowKey?: string;
  glowAnim?: string;
}

interface PropSpec extends PropDef {
  w: number;
  h: number;
  frames: number;
  durations?: number[];
  draw: (p: Painter, i: number, n: number) => void;
  /** runs on each frame after the outline pass */
  post?: (buf: PixelBuffer) => void;
}

export const DECALS: { blood: string; scorch: string; ichor: string; slime: string; grime: string[] } = {
  blood: 'decal:blood',
  scorch: 'decal:scorch',
  ichor: 'decal:ichor',
  slime: 'decal:slime',
  grime: ['decal:puddle', 'decal:crack', 'decal:moss', 'decal:stain'],
};

// ---------------------------------------------------------------- noise

/** Seamless (period 32) value noise. */
function pnoise(x: number, y: number, cell: number, seed: number): number {
  const n = T / cell;
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

function tone(ramp: Ramp, v: number): number {
  const i = Math.max(0, Math.min(ramp.length - 1, Math.floor(v)));
  return ramp[i] as number;
}

// ---------------------------------------------------------------- floors

type Rect = [number, number, number, number];
const LAYOUTS: Rect[][] = [
  [[0, 0, 16, 16], [16, 0, 16, 16], [0, 16, 16, 16], [16, 16, 16, 16]],
  [[0, 0, 32, 14], [0, 14, 13, 18], [13, 14, 19, 18]],
  [[0, 0, 20, 11], [20, 0, 12, 11], [0, 11, 9, 10], [9, 11, 23, 10], [0, 21, 18, 11], [18, 21, 14, 11]],
  [[0, 0, 32, 32]],
];

function flagstones(buf: PixelBuffer, layout: Rect[], seed: number, mossy: number): void {
  const F = D.floor;
  layout.forEach(([rx, ry, rw, rh], si) => {
    const base = 1.75 + hash2(si, seed, 3) * 1.0;
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        const lx = x - rx;
        const ly = y - ry;
        const mortar = lx === rw - 1 || ly === rh - 1;
        const corner = (lx === 0 || lx === rw - 2) && (ly === 0 || ly === rh - 2);
        if (mortar || (corner && hash2(x, y, seed) > 0.4)) {
          const m = mossy > 0 && pnoise(x, y, 8, seed + 9) > 1 - mossy ? mix(D.moss[1]!, D.mortar, 0.3) : D.mortar;
          buf.set(x, y, m);
          continue;
        }
        let v = base + (pnoise(x, y, 8, seed) - 0.5) * 0.9 + (pnoise(x, y, 4, seed + 1) - 0.5) * 0.5 + bayer(x, y) * 0.35;
        if (ly === 0) v += 0.9;
        else if (lx === 0) v += 0.45;
        if (ly === rh - 2) v -= 0.8;
        else if (lx === rw - 2) v -= 0.4;
        let c = tone(F, v);
        const grime = pnoise(x, y, 16, seed + 4);
        if (grime > 0.66) c = mix(c, 0x060504, (grime - 0.66) * 1.4);
        if (mossy > 0 && (ly <= 1 || lx <= 1 || ly >= rh - 3) && pnoise(x, y, 4, seed + 9) > 1 - mossy * 0.9) c = tone(D.moss, 1 + pnoise(x, y, 4, seed + 2) * 2);
        buf.set(x, y, c);
      }
    }
  });
}

function crackLine(buf: PixelBuffer, r: () => number, x: number, y: number, len: number, col: number = D.mortar, hi: number = D.floor[3]!): void {
  let a = r() * Math.PI * 2;
  for (let k = 0; k < len; k++) {
    a += (r() - 0.5) * 0.9;
    x += Math.cos(a);
    y += Math.sin(a);
    if (x < 1 || y < 1 || x > T - 2 || y > T - 2) break;
    buf.set(Math.round(x), Math.round(y), col);
    if (k % 2) buf.set(Math.round(x), Math.round(y) - 1, hi);
  }
}

function puddle(buf: PixelBuffer, cx: number, cy: number, rx: number, ry: number, seed: number): void {
  const W = D.water;
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry) + (hash2(x, y, seed) - 0.5) * 0.15;
      if (d > 1) continue;
      let c = d > 0.85 ? W[1]! : W[0]!;
      // reflected highlights (torch glints)
      if (hash2(x, y, seed + 1) > 0.93 && d < 0.8) c = W[3]!;
      if ((x + y * 3) % 11 === 0 && d < 0.6) c = W[2]!;
      buf.set(x, y, mix(buf.get(x, y) & 0xffffff, c, 0.85));
    }
  }
  buf.set(Math.round(cx - rx * 0.4), Math.round(cy - ry * 0.3), W[4]!);
  buf.set(Math.round(cx - rx * 0.4) + 1, Math.round(cy - ry * 0.3), W[3]!);
}

function boneChips(p: Painter, r: () => number, n: number): void {
  const B = D.bone;
  for (let k = 0; k < n; k++) {
    const x = 4 + r() * 24;
    const y = 4 + r() * 24;
    const a = r() * Math.PI;
    const L = 1.5 + r() * 2.5;
    p.capsule(x - Math.cos(a) * L, y - Math.sin(a) * L, x + Math.cos(a) * L, y + Math.sin(a) * L, 0.7, 0.7);
  }
  p.fill(B, { mode: 'emboss', inner: false, light: -0.25 });
}

function rubble(p: Painter, r: () => number, n: number, cx = 16, cy = 18, spread = 11): void {
  for (let k = 0; k < n; k++) {
    const x = cx + (r() - 0.5) * spread * 2;
    const y = cy + (r() - 0.5) * spread;
    p.ellipse(x, y, 1.4 + r() * 2.2, 1 + r() * 1.5);
  }
  p.fill(D.floor, { mode: 'sphere', light: 0.15 });
}

function drawFloor(v: number): PixelBuffer {
  const buf = new PixelBuffer(T, T);
  const r = rng(300 + v * 41);
  const seed = 10 + v * 7;
  const p = new Painter(buf);
  switch (v) {
    case 0:
      flagstones(buf, LAYOUTS[0]!, seed, 0);
      break;
    case 1:
      flagstones(buf, LAYOUTS[1]!, seed, 0);
      break;
    case 2:
      flagstones(buf, LAYOUTS[2]!, seed, 0);
      break;
    case 3: // cracked
      flagstones(buf, LAYOUTS[0]!, seed, 0);
      crackLine(buf, r, 8, 8, 14);
      crackLine(buf, r, 22, 20, 10);
      break;
    case 4: // mossy
      flagstones(buf, LAYOUTS[1]!, seed, 0.45);
      break;
    case 5: // wet with puddle
      flagstones(buf, LAYOUTS[2]!, seed, 0.1);
      puddle(buf, 15, 18, 9, 5, seed);
      break;
    case 6: {
      // drain grate
      flagstones(buf, LAYOUTS[3]!, seed, 0.15);
      p.rect(7, 9, 18, 14).fill(D.iron, { mode: 'emboss' });
      for (let k = 0; k < 5; k++) p.rect(9 + k * 3, 11, 1.6, 10);
      p.fill([0x020202, 0x040404, 0x060606, 0x080808], { mode: 'flat', tone: 0, inner: false });
      p.px(9, 10, D.iron[4]!).px(23, 10, D.iron[3]!);
      p.finish(PALETTES.outline, 0);
      break;
    }
    case 7: // bone chips
      flagstones(buf, LAYOUTS[0]!, seed, 0);
      boneChips(p, r, 6);
      break;
    case 8: // rubble patch
      flagstones(buf, LAYOUTS[2]!, seed, 0);
      rubble(p, r, 9);
      outlinePass(buf, D.mortar, 240);
      break;
    case 9: // big cracked slab with a stain
      flagstones(buf, LAYOUTS[3]!, seed, 0);
      crackLine(buf, r, 6, 20, 22);
      for (let y = 6; y < 26; y++) for (let x = 6; x < 26; x++) if (pnoise(x, y, 8, seed + 30) > 0.62) buf.set(x, y, mix(buf.get(x, y) & 0xffffff, 0x1a0806, 0.35));
      break;
    case 10: // mossy crack + small puddle
      flagstones(buf, LAYOUTS[0]!, seed, 0.3);
      crackLine(buf, r, 10, 6, 12, D.moss[1]!, D.moss[2]!);
      puddle(buf, 22, 22, 5, 3, seed);
      break;
    default: // grimy dark
      flagstones(buf, LAYOUTS[1]!, seed, 0.05);
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (pnoise(x, y, 16, seed + 50) > 0.55) buf.set(x, y, mix(buf.get(x, y) & 0xffffff, 0x050403, 0.3));
      break;
  }
  return buf;
}

// ---------------------------------------------------------------- walls

function capSurface(buf: PixelBuffer, oy: number, variant: number, mask: number, faceBelow: boolean): void {
  const C = D.cap;
  const seed = 70 + variant * 13;
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      // slab seams every 16 px with offset rows
      const seamY = y % 16 === 15;
      const seamX = (x + (Math.floor(y / 16) % 2) * 8) % 16 === 15;
      let v = 2 + (pnoise(x, y, 8, seed) - 0.5) * 1.1 + (pnoise(x, y, 4, seed + 3) - 0.5) * 0.6 + bayer(x, y) * 0.3;
      if (seamY || seamX) v = 0.4;
      else if (y % 16 === 0) v += 0.6;
      let c = tone(C, v);
      if (pnoise(x, y, 8, seed + 7) > 0.76) c = tone(D.moss, 0.6 + pnoise(x, y, 4, seed) * 1.8);
      buf.set(x, y + oy, c);
    }
  }
  // pebbles / grit
  const r = rng(seed + mask);
  for (let k = 0; k < 5; k++) {
    const x = Math.floor(2 + r() * 28);
    const y = Math.floor(2 + r() * 26);
    buf.set(x, y + oy, C[3]!);
    buf.set(x, y + oy + 1, C[0]!);
  }
  // lit rims where the cap meets open floor
  const rim = (x: number, y: number, c: number): void => buf.set(x, y + oy, c);
  if (mask & 1) {
    for (let x = 0; x < T; x++) {
      rim(x, 0, PALETTES.outline);
      rim(x, 1, C[4]!);
      rim(x, 2, mix(C[3]!, C[2]!, 0.5));
    }
  }
  if (mask & 2) {
    for (let y = 0; y < T; y++) {
      rim(0, y, PALETTES.outline);
      rim(1, y, C[4]!);
    }
  }
  if (mask & 4) {
    for (let y = 0; y < T; y++) {
      rim(T - 1, y, PALETTES.outline);
      rim(T - 2, y, C[1]!);
    }
  }
  if (faceBelow) {
    // front lip of the cap, lit from the torch-lit room
    for (let x = 0; x < T; x++) {
      rim(x, T - 3, C[3]!);
      rim(x, T - 2, C[4]!);
      rim(x, T - 1, C[2]!);
    }
  }
}

function bricks(buf: PixelBuffer, oy: number, variant: number): void {
  const Bk = D.brick;
  const seed = 120 + variant * 5;
  for (let y = 0; y < T; y++) {
    const row = Math.floor(y / 8);
    const ly = y % 8;
    for (let x = 0; x < T; x++) {
      const off = (row % 2) * 8;
      const bx = Math.floor((x + off) / 16);
      const lx = (x + off) % 16;
      const mortar = ly === 7 || lx === 15;
      let c: number;
      if (mortar) {
        c = D.mortar;
      } else {
        let v = 1.6 + hash2(bx + row * 7, variant, 11) * 1.4 + (pnoise(x, y, 8, seed) - 0.5) * 0.9 + bayer(x, y) * 0.3;
        if (ly === 0) v += 0.9;
        if (ly === 6) v -= 0.7;
        if (lx === 0) v += 0.3;
        if (lx === 14) v -= 0.3;
        c = tone(Bk, v);
        if (hash2(x, y, seed) > 0.97) c = Bk[0]!;
      }
      // vertical light falloff: overhang shadow at the top, ambient occlusion at the foot
      if (y < 3) c = mix(c, 0x050404, 0.55 - y * 0.15);
      if (y > 22) c = mix(c, 0x050404, (y - 22) * 0.045);
      buf.set(x, y + oy, c);
    }
  }
  // contact line with the floor
  for (let x = 0; x < T; x++) buf.set(x, oy + T - 1, 0x060505);
}

function faceDetail(p: Painter, buf: PixelBuffer, oy: number, v: number): void {
  const r = rng(900 + v * 17);
  const y0 = oy;
  switch (v) {
    case 1: {
      // cracked bricks
      let x = 9 + r() * 6;
      let y = y0 + 3;
      for (let k = 0; k < 24; k++) {
        x += (r() - 0.5) * 2.2;
        y += 1;
        buf.set(Math.round(x), Math.round(y), D.mortar);
        if (k % 3 === 0) buf.set(Math.round(x) + 1, Math.round(y), D.brick[3]!);
      }
      break;
    }
    case 2: {
      // moss creeping up from the base + a few vines
      for (let k = 0; k < 7; k++) p.ellipse(r() * 32, y0 + 28 + r() * 3, 2.5 + r() * 3, 2 + r() * 2);
      for (let k = 0; k < 3; k++) {
        const x = 4 + r() * 24;
        p.capsule(x, y0 + 29, x + (r() - 0.5) * 4, y0 + 12 + r() * 8, 1, 0.6);
      }
      p.fill(D.moss, { mode: 'sphere', dither: true, light: 0.05 });
      break;
    }
    case 3: {
      // water stain streak + drips + damp foot
      const sx = 10 + r() * 12;
      for (let y = 2; y < 30; y++) {
        const w = 2 + Math.sin(y * 0.4) * 1 + y * 0.06;
        for (let x = Math.floor(sx - w); x <= sx + w; x++) {
          buf.set(x, y0 + y, mix(buf.get(x, y0 + y) & 0xffffff, 0x0c1418, 0.45));
        }
      }
      for (let k = 0; k < 3; k++) {
        const dx = Math.round(sx + (r() - 0.5) * 5);
        const dy = y0 + 10 + Math.floor(r() * 16);
        buf.set(dx, dy, D.water[3]!);
        buf.set(dx, dy + 1, D.water[2]!);
      }
      buf.set(Math.round(sx), y0 + 30, D.water[4]!);
      break;
    }
    case 4: {
      // rusted iron ring on a staple
      const cx = 16;
      const cy = y0 + 13;
      p.rect(cx - 2, cy - 4, 4, 3).fill(D.iron, { mode: 'emboss' });
      p.ellipse(cx, cy + 3, 4.6, 4.6).minus().ellipse(cx, cy + 3, 3, 3).fill(D.rust, { mode: 'emboss', dither: true });
      for (let k = 0; k < 3; k++) buf.set(cx - 1 + k, cy + 9 + k * 2, mix(D.rust[1]!, buf.get(cx, cy + 9) & 0xffffff, 0.4));
      break;
    }
    case 5: {
      // tattered red banner hanging from the top of the face
      const top = y0 + 1;
      const bot = y0 + 24;
      const pts: number[] = [8, top, 24, top];
      for (let k = 0; k <= 6; k++) {
        const x = 24 - k * (16 / 6);
        const y = bot - (k % 2 ? 4 : 0) - r() * 3;
        pts.push(x, y);
      }
      p.poly(pts).fill(D.banner, { mode: 'cyl', dither: true });
      p.rect(7, top - 1, 18, 2).fill(D.wood, { mode: 'emboss' });
      // folds + faded brass sigil
      p.line(12, top + 2, 12, bot - 6).line(19, top + 2, 19, bot - 5).fill(D.banner, { mode: 'flat', tone: 0, inner: false, alpha: 180 });
      p.poly([16, y0 + 8, 18.5, y0 + 11, 16, y0 + 15, 13.5, y0 + 11]).fill(MATERIALS.brass, { mode: 'flat', tone: 1, inner: false });
      p.px(16, y0 + 11, MATERIALS.brass[3]!);
      break;
    }
    case 6: {
      // arched alcove with candles
      const ax = 16;
      for (let y = 6; y < 28; y++) {
        for (let x = 7; x < 25; x++) {
          const dx = (x + 0.5 - ax) / 9;
          const dy = y < 13 ? (13 - y) / 7 : 0;
          if (dx * dx + dy * dy > 1) continue;
          const depth = Math.min(1, (1 - (dx * dx + dy * dy)) * 1.4);
          buf.set(x, y0 + y, mix(0x0a0606, 0x241612, 1 - depth));
        }
      }
      for (let x = 8; x < 24; x++) buf.set(x, y0 + 28, D.cap[3]!);
      for (let x = 8; x < 24; x++) buf.set(x, y0 + 29, D.cap[1]!);
      // arch voussoir highlight
      for (let a = Math.PI; a <= Math.PI * 2; a += 0.08) {
        const x = Math.round(ax + Math.cos(a) * 9.5);
        const y = Math.round(y0 + 13 + Math.sin(a) * 7.5);
        buf.set(x, y, D.brick[4]!);
      }
      // candles
      const cs: [number, number][] = [[12, 5], [16, 8], [20, 4]];
      for (const [cx, h] of cs) {
        p.rect(cx - 1, y0 + 28 - h, 2.2, h).fill(D.wax, { mode: 'cyl', inner: false });
        p.gpx(cx, y0 + 26 - h, D.flame[3]!, D.flame[2]!).gpx(cx, y0 + 25 - h, D.flame[2]!, D.flame[2]!);
      }
      // warm glow on the alcove walls
      for (let y = 10; y < 28; y++) for (let x = 9; x < 23; x++) {
        const d = Math.hypot(x - 16, (y - 22) * 1.3);
        if (d < 8 && (buf.get(x, y0 + y) & 0xffffff) !== D.flame[3]) buf.set(x, y0 + y, mix(buf.get(x, y0 + y) & 0xffffff, 0x7a3a10, 0.35 * (1 - d / 8)));
      }
      break;
    }
    case 7: {
      // skulls mortared into the wall
      const spots: [number, number][] = [[8, 9], [23, 7], [15, 19]];
      for (const [sx, sy] of spots) {
        p.ellipse(sx, y0 + sy, 3.4, 3.1).fill([0x060404, 0x0c0808, 0x140c0a, 0x1a100e], { mode: 'flat', tone: 1, inner: false });
        p.ellipse(sx, y0 + sy - 0.3, 2.7, 2.5).fill(D.bone, { mode: 'sphere' });
        p.rect(sx - 1.4, y0 + sy + 1.6, 2.8, 1.4).fill(D.bone, { mode: 'emboss', light: -0.2 });
        buf.set(sx - 1, y0 + sy, 0x0a0606);
        buf.set(sx + 1, y0 + sy, 0x0a0606);
        buf.set(sx, y0 + sy + 1, 0x241a16);
      }
      break;
    }
    default:
      break;
  }
}

function drawWallFrame(faceVariant: number | null, mask: number, capVariant: number): PixelBuffer {
  const buf = new PixelBuffer(T, T * 2);
  capSurface(buf, 0, capVariant, mask, faceVariant !== null);
  if (faceVariant !== null) {
    bricks(buf, T, faceVariant);
    const p = new Painter(buf);
    faceDetail(p, buf, T, faceVariant);
    p.finish(PALETTES.outline, 0.8);
    // wall ends: dark corner line + a faint highlight so free-standing walls read as solid blocks
    const wEdge = (mask & 2) !== 0;
    const eEdge = (mask & 4) !== 0;
    for (let y = T; y < T * 2; y++) {
      if (wEdge) {
        buf.set(0, y, PALETTES.outline);
        buf.set(1, y, mix(buf.get(1, y) & 0xffffff, 0xffe0b0, 0.2));
      }
      if (eEdge) {
        buf.set(T - 1, y, PALETTES.outline);
        buf.set(T - 2, y, mix(buf.get(T - 2, y) & 0xffffff, 0x000000, 0.35));
      }
    }
  }
  return buf;
}

export function drawVoid(): PixelBuffer {
  const buf = new PixelBuffer(T, T);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const n = pnoise(x, y, 8, 501) * 0.6 + pnoise(x, y, 4, 502) * 0.4;
    buf.set(x, y, mix(D.void, 0x110d10, n * 0.6 + bayer(x, y) * 0.1));
  }
  return buf;
}

// ---------------------------------------------------------------- props

const P_OUT = PALETTES.outline;

function flame(p: Painter, cx: number, by: number, h: number, w: number, sway: number, ramp: Ramp = D.flame): void {
  p.poly([cx - w, by, cx + w, by, cx + w * 0.6 + sway * 0.4, by - h * 0.45, cx + sway, by - h, cx - w * 0.6 + sway * 0.3, by - h * 0.5]).fill(ramp, {
    mode: 'emboss',
    glow: ramp[3]!,
    light: 0.35,
    inner: false,
  });
  p.poly([cx - w * 0.45, by, cx + w * 0.45, by, cx + sway * 0.6, by - h * 0.55]).fill(ramp, { mode: 'flat', tone: 4, inner: false });
}

const PROP_SPECS: Record<string, PropSpec> = {
  torch: {
    key: 'prop:torch',
    anim: 'prop:torch',
    originX: 0.5,
    originY: 1,
    placement: 'wallFace',
    blocks: false,
    light: { color: D.torchLight, radius: 140, intensity: 0.9, flicker: 0.22 },
    w: 16,
    h: 32,
    frames: 4,
    durations: [90, 110, 80, 120],
    draw: (p, i) => {
      p.rect(5, 26, 6, 3).fill(D.iron, { mode: 'emboss' });
      p.capsule(8, 27, 8, 18, 1.4, 1.2).fill(D.iron, { mode: 'cyl' });
      p.capsule(8, 21, 8, 13, 1.6, 2).fill(D.wood, { mode: 'cyl' });
      p.ellipse(8, 13, 2.6, 1.4).fill(D.iron, { mode: 'sphere' });
      const h = [9, 11, 10, 12][i] ?? 10;
      const sway = [0, 1, -1, 0.5][i] ?? 0;
      flame(p, 8, 13, h, 3, sway);
    },
  },
  brazier: {
    key: 'prop:brazier',
    anim: 'prop:brazier',
    originX: 0.5,
    originY: 0.95,
    placement: 'floor',
    blocks: false,
    light: { color: 0xff8a3a, radius: 220, intensity: 1, flicker: 0.28 },
    w: 32,
    h: 40,
    frames: 4,
    durations: [90, 100, 85, 110],
    draw: (p, i) => {
      for (const [x0, x1] of [[8, 11], [24, 21], [16, 16]] as const) p.capsule(x0, 37, x1, 26, 1.2, 1);
      p.fill(D.iron, { mode: 'cyl' });
      p.ellipse(16, 25, 11, 4.5).fill(D.iron, { mode: 'sphere' });
      p.ellipse(16, 21, 11, 3.6).fill(D.iron, { mode: 'emboss', light: 0.2 });
      // glowing coals
      p.ellipse(16, 21, 9, 2.6).fill(MATERIALS.amberCore, { mode: 'sphere', dither: true, glow: MATERIALS.amberCore[2]!, inner: false });
      const sw = [0, 1, -1, 0.5][i] ?? 0;
      const hs = [12, 15, 13, 16][i] ?? 13;
      flame(p, 11, 21, hs * 0.7, 3, -sw);
      flame(p, 21, 21, hs * 0.75, 3, sw);
      flame(p, 16, 21, hs, 4.4, sw * 1.4);
    },
  },
  candles: {
    key: 'prop:candles',
    anim: 'prop:candles',
    originX: 0.5,
    originY: 0.9,
    placement: 'floor',
    blocks: false,
    light: { color: D.candleLight, radius: 64, intensity: 0.6, flicker: 0.3 },
    w: 16,
    h: 16,
    frames: 3,
    durations: [120, 140, 110],
    draw: (p, i) => {
      p.ellipse(8, 14, 6.5, 1.8).fill(D.wax, { mode: 'sphere', light: -0.2 });
      const cs: [number, number][] = [[5, 5], [9, 8], [12, 4]];
      for (const [cx, h] of cs) p.rect(cx - 1, 14 - h, 2.2, h);
      p.fill(D.wax, { mode: 'cyl' });
      cs.forEach(([cx, h], k) => {
        const f = (i + k) % 3;
        p.gpx(cx + (f === 1 ? 1 : 0), 12 - h, D.flame[3]!, D.flame[2]!).gpx(cx, 11 - h - (f === 2 ? 1 : 0), D.flame[2]!, D.flame[2]!);
      });
    },
  },
  bones: {
    key: 'prop:bones',
    originX: 0.5,
    originY: 0.75,
    placement: 'floor',
    blocks: false,
    w: 24,
    h: 16,
    frames: 1,
    draw: (p) => {
      p.capsule(4, 10, 15, 7, 1.1, 1.1).capsule(10, 13, 20, 12, 1, 1).fill(D.bone, { mode: 'cyl' });
      for (const [x, y] of [[4, 10], [15, 7], [10, 13], [20, 12]] as const) p.circle(x, y, 1.6);
      p.fill(D.bone, { mode: 'sphere' });
      p.ellipse(18, 6, 3, 2.6).fill(D.bone, { mode: 'sphere' });
      p.px(17, 6, P_OUT).px(19, 6, P_OUT);
    },
  },
  skullpile: {
    key: 'prop:skullpile',
    originX: 0.5,
    originY: 0.85,
    placement: 'floor',
    blocks: false,
    w: 32,
    h: 24,
    frames: 1,
    draw: (p) => {
      const skulls: [number, number][] = [[8, 18], [16, 19], [24, 18], [12, 12], [20, 12], [16, 6]];
      for (const [x, y] of skulls) {
        p.ellipse(x, y, 4, 3.6).fill(D.bone, { mode: 'sphere' });
        p.rect(x - 1.8, y + 2, 3.6, 1.6).fill(D.bone, { mode: 'emboss', light: -0.2 });
        p.px(x - 1.5, y, 0x0e0808).px(x + 1.5, y, 0x0e0808).px(x, y + 1.5, 0x2a1e18);
      }
    },
  },
  barrel: {
    key: 'prop:barrel',
    originX: 0.5,
    originY: 0.92,
    placement: 'floor',
    blocks: false,
    w: 20,
    h: 26,
    frames: 1,
    draw: (p) => {
      p.ellipse(10, 21, 8, 3.4).rect(2, 7, 16, 14).ellipse(10, 13, 8.6, 6).fill(D.wood, { mode: 'cyl', dither: true });
      p.ellipse(10, 6.5, 8, 3.2).fill(D.wood, { mode: 'emboss', light: 0.15 });
      for (const y of [9, 18]) p.rect(1.6, y, 16.8, 1.6);
      p.fill(D.iron, { mode: 'cyl', inner: false });
      p.line(7, 5, 13, 8).fill(D.wood, { mode: 'flat', tone: 0, inner: false });
    },
  },
  crate: {
    key: 'prop:crate',
    originX: 0.5,
    originY: 0.92,
    placement: 'floor',
    blocks: false,
    w: 22,
    h: 24,
    frames: 1,
    draw: (p) => {
      p.rect(2, 9, 18, 13).fill(D.wood, { mode: 'emboss', dither: true });
      p.poly([2, 9, 6, 3, 21, 3, 20, 9]).fill(D.wood, { mode: 'emboss', light: 0.25 });
      p.line(3, 10, 19, 21).line(3, 21, 19, 10).fill(D.wood, { mode: 'flat', tone: 0, inner: false });
      p.rect(2, 9, 18, 1.2).fill(D.iron, { mode: 'flat', tone: 2, inner: false });
    },
  },
  chains: {
    key: 'prop:chains',
    anim: 'prop:chains',
    originX: 0.5,
    originY: 0,
    placement: 'wallFace',
    blocks: false,
    w: 12,
    h: 40,
    frames: 4,
    durations: [420, 380, 420, 380],
    draw: (p, i) => {
      // a slow pendulum: the top link is fixed, the lower links drift up to 1.5px
      const swing = [0, 1, 0, -1][i] ?? 0;
      p.rect(3, 0, 6, 3).fill(D.iron, { mode: 'emboss' });
      for (let k = 0; k < 11; k++) {
        const y = 4 + k * 3.2;
        const x = 6 + Math.sin(k * 0.5) * 0.8 + (swing * k) / 7;
        if (k % 2) p.ellipse(x, y, 1.9, 1.2);
        else p.ellipse(x, y, 1.1, 1.9);
      }
      p.fill(D.iron, { mode: 'sphere', light: 0.15 });
      p.ellipse(6 + swing * 1.5, 37.5, 2.6, 2).minus().ellipse(6 + swing * 1.5, 37.5, 1.2, 0.8).fill(D.rust, { mode: 'emboss' });
    },
  },
  cobweb: {
    key: 'prop:cobweb',
    originX: 0,
    originY: 0,
    placement: 'corner',
    blocks: false,
    w: 32,
    h: 32,
    frames: 1,
    draw: (p) => {
      const col = 0xcfcac0;
      for (let k = 0; k <= 5; k++) {
        const a = (k / 5) * (Math.PI / 2);
        p.line(0, 0, Math.cos(a) * 30, Math.sin(a) * 30);
      }
      for (const rr of [8, 15, 22, 28]) {
        let px = rr;
        let py = 0;
        for (let k = 1; k <= 5; k++) {
          const a = (k / 5) * (Math.PI / 2);
          const sag = 0.85;
          const nx = Math.cos(a) * rr;
          const ny = Math.sin(a) * rr;
          const mx = ((px + nx) / 2) * sag;
          const my = ((py + ny) / 2) * sag;
          p.line(px, py, mx, my).line(mx, my, nx, ny);
          px = nx;
          py = ny;
        }
      }
      p.fill([col, col, col, col], { mode: 'flat', alpha: 120, inner: false });
    },
  },
  grate: {
    key: 'prop:grate',
    originX: 0.5,
    originY: 0.5,
    placement: 'floor',
    blocks: false,
    w: 32,
    h: 32,
    frames: 1,
    draw: (p) => {
      p.rect(4, 7, 24, 18).fill(D.iron, { mode: 'emboss' });
      for (let k = 0; k < 6; k++) p.rect(6.5 + k * 3.6, 9, 1.8, 14);
      p.fill([0x020202, 0x030303, 0x050505, 0x070707], { mode: 'flat', tone: 0, inner: false });
      p.px(6, 8, D.iron[4]!).px(26, 8, D.iron[3]!);
    },
  },
  rubble: {
    key: 'prop:rubble',
    originX: 0.5,
    originY: 0.8,
    placement: 'floor',
    blocks: false,
    w: 28,
    h: 18,
    frames: 1,
    draw: (p) => {
      const r = rng(77);
      for (let k = 0; k < 9; k++) p.ellipse(14 + (r() - 0.5) * 20, 11 + (r() - 0.5) * 6, 2 + r() * 3, 1.6 + r() * 2);
      p.fill(D.cap, { mode: 'sphere', dither: true });
      p.ellipse(10, 8, 4, 3).fill(D.brick, { mode: 'sphere' });
    },
  },
  banner: {
    key: 'prop:banner',
    anim: 'prop:banner',
    originX: 0.5,
    originY: 0,
    placement: 'wallFace',
    blocks: false,
    w: 20,
    h: 36,
    frames: 2,
    durations: [600, 600],
    draw: (p, i) => {
      p.capsule(1, 2, 19, 2, 1.2, 1.2).fill(D.wood, { mode: 'cyl' });
      const sw = i === 0 ? 0 : 1;
      p.poly([3, 3, 17, 3, 17 + sw, 26, 15 + sw, 33, 12 + sw, 28, 9 + sw * 0.5, 34, 6, 27, 3, 31]).fill(D.banner, { mode: 'cyl', dither: true });
      p.line(7, 5, 7 + sw * 0.5, 26).line(13, 5, 13 + sw, 26).fill(D.banner, { mode: 'flat', tone: 0, inner: false, alpha: 160 });
      p.poly([10, 10, 13, 14, 10, 19, 7, 14]).fill(MATERIALS.brass, { mode: 'flat', tone: 2, inner: false });
      p.px(10, 14, MATERIALS.brass[4]!);
    },
  },
  pillar: {
    key: 'prop:pillar',
    originX: 0.5,
    originY: 1,
    placement: 'floor',
    blocks: true,
    w: 32,
    h: PILLAR_H,
    frames: 1,
    draw: (p) => paintTallPillar(p, 'catacombs'),
    post: (buf) => fadePillarTop(buf),
  },
};

const ALL_PROP_SPECS: Record<string, PropSpec & Partial<ClutterSpec>> = { ...PROP_SPECS, ...THEME_PROP_SPECS, ...CLUTTER_PROP_SPECS, ...ROOM_PROP_SPECS, ...THEME_EXTRA_PROP_SPECS };

/** Set-dressing hints for the original props (how the renderer bakes, layers and animates them). */
const LEGACY_HINTS: Record<string, Partial<PropDef>> = {
  bones: { low: true, fx: [{ kind: 'flies', dx: 0, dy: -6 }] },
  grate: { low: true },
  puddle: { flat: true },
  ritual: { flat: true, emissive: true },
  lavacrack: { flat: true, emissive: true, fx: [{ kind: 'embers', dx: 0, dy: -2, rate: 0.9 }] },
  brazier: { fx: [{ kind: 'smoke', dx: 0, dy: -22, rate: 2.4 }, { kind: 'embers', dx: 0, dy: -18, rate: 1.2 }] },
  skullpile: { fx: [{ kind: 'flies', dx: 0, dy: -10 }] },
  bonepile2: { fx: [{ kind: 'flies', dx: 0, dy: -8 }] },
  shroom: { fx: [{ kind: 'spores', dx: 0, dy: -14, rate: 0.6 }] },
  shroom2: { fx: [{ kind: 'spores', dx: 0, dy: -14, rate: 0.5 }] },
  snowpile: { low: true },
  chains: { sway: true },
  banner: { sway: true },
};

/** Clutter props are generated lazily (per map, on first use) by the Phaser layer; see buildPropSheets(). */
export const CLUTTER_PROP_IDS: readonly string[] = [...Object.keys(CLUTTER_PROP_SPECS), ...Object.keys(THEME_EXTRA_PROP_SPECS)];

export const PROPS: Record<string, PropDef> = Object.fromEntries(
  Object.entries(ALL_PROP_SPECS).map(([name, s]) => {
    const def: PropDef = { key: s.key, originX: s.originX, originY: s.originY, placement: s.placement, blocks: s.blocks, w: s.w, h: s.h, frames: s.frames };
    if (s.anim) def.anim = s.anim;
    if (s.light) def.light = { ...s.light };
    for (const k of ['variants', 'low', 'flat', 'hug', 'hugDepth', 'mount', 'emissive', 'sway'] as const) if (s[k] !== undefined) (def as unknown as Record<string, unknown>)[k] = s[k];
    if (s.fx) def.fx = s.fx.map((f) => ({ ...f }));
    if (s.glow) {
      def.glowKey = `${s.key}:glow`;
      if (s.glow.frames > 1) def.glowAnim = `${s.key}:glow`;
    }
    Object.assign(def, LEGACY_HINTS[name] ?? {});
    return [name, def];
  }),
);

// ---------------------------------------------------------------- decals

function splat(buf: PixelBuffer, seed: number, opts: { blobs: number; drops: number; streaks: number; gray: boolean; color?: number; size: number }): void {
  const r = rng(seed);
  const cx = buf.w / 2;
  const cy = buf.h / 2;
  const S = opts.size;
  const blobs: [number, number, number][] = [[cx, cy, S * 0.32]];
  for (let k = 0; k < opts.blobs; k++) {
    const a = r() * Math.PI * 2;
    const d = r() * S * 0.3;
    blobs.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7, S * (0.08 + r() * 0.14)]);
  }
  for (let k = 0; k < opts.drops; k++) {
    const a = r() * Math.PI * 2;
    const d = S * (0.3 + r() * 0.22);
    blobs.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7, 0.8 + r() * 1.4]);
  }
  const shade = (v: number): number => (opts.gray ? mix(0x9a9a9a, 0xffffff, v) : mix(opts.color ?? 0x7a1010, lighten(opts.color ?? 0x7a1010, 0.3), v));
  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      let inside = 0;
      for (const [bx, by, br] of blobs) {
        const d = Math.hypot(x + 0.5 - bx, (y + 0.5 - by) * 1.3) / br;
        if (d < 1) inside = Math.max(inside, 1 - d);
      }
      if (inside <= 0) continue;
      const v = Math.min(1, inside * 1.6 + bayer(x, y) * 0.15);
      buf.set(x, y, shade(v * 0.6), Math.round(200 + 55 * Math.min(1, inside * 3)));
    }
  }
  // streaks (drag marks)
  for (let k = 0; k < opts.streaks; k++) {
    const a = r() * Math.PI * 2;
    for (let s = S * 0.2; s < S * 0.48; s += 0.5) {
      const x = Math.round(cx + Math.cos(a) * s);
      const y = Math.round(cy + Math.sin(a) * s * 0.7);
      buf.blend(x, y, shade(0.4), 220);
    }
  }
  // glossy highlight
  buf.blend(Math.round(cx - S * 0.1), Math.round(cy - S * 0.08), opts.gray ? 0xffffff : lighten(opts.color ?? 0x7a1010, 0.6), 230);
}

interface DecalSpec {
  key: string;
  w: number;
  h: number;
  frames: number;
  draw: (buf: PixelBuffer, i: number) => void;
}

const BASE_DECAL_SPECS: DecalSpec[] = [
  { key: 'decal:blood', w: 40, h: 40, frames: 4, draw: (b, i) => splat(b, 10 + i * 7, { blobs: 5 + i, drops: 7, streaks: i % 2 ? 2 : 0, gray: true, size: 36 }) },
  { key: 'decal:ichor', w: 40, h: 40, frames: 3, draw: (b, i) => splat(b, 50 + i * 9, { blobs: 3 + i, drops: 12, streaks: 3, gray: true, size: 34 }) },
  {
    key: 'decal:scorch',
    w: 44,
    h: 44,
    frames: 3,
    draw: (b, i) => {
      const r = rng(70 + i);
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
        const d = Math.hypot(x - 22, (y - 22) * 1.35) / 20 + (hash2(x, y, i) - 0.5) * 0.2;
        if (d > 1) continue;
        const c = d < 0.45 ? 0x070504 : d < 0.75 ? 0x14100c : 0x241c16;
        b.set(x, y, c, Math.round(235 * (1 - Math.max(0, d - 0.7) / 0.3)));
      }
      for (let k = 0; k < 5; k++) b.set(Math.round(12 + r() * 20), Math.round(14 + r() * 16), k % 2 ? 0xff8a3a : 0x7a2a0a, 220);
    },
  },
  {
    key: 'decal:slime',
    w: 40,
    h: 40,
    frames: 3,
    draw: (b, i) => {
      splat(b, 90 + i * 5, { blobs: 4 + i, drops: 5, streaks: 0, gray: false, color: 0x3e7a12, size: 34 });
      const r = rng(95 + i);
      for (let k = 0; k < 4; k++) {
        const x = Math.round(12 + r() * 16);
        const y = Math.round(14 + r() * 12);
        b.set(x, y, 0xb8f05a, 230);
        b.set(x + 1, y, 0x8ec83a, 200);
      }
    },
  },
  {
    key: 'decal:puddle',
    w: 32,
    h: 24,
    frames: 3,
    draw: (b, i) => {
      const W = D.water;
      const rx = 12 + i * 1.5;
      const ry = 7 + (i % 2);
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
        const d = Math.hypot((x + 0.5 - 16) / rx, (y + 0.5 - 12) / ry) + (hash2(x, y, i + 3) - 0.5) * 0.12;
        if (d > 1) continue;
        let c = d > 0.82 ? W[1]! : W[0]!;
        if (hash2(x, y, i + 9) > 0.94 && d < 0.75) c = W[3]!;
        b.set(x, y, c, 215);
      }
      b.set(11, 9, W[4]!);
      b.set(12, 9, W[3]!);
    },
  },
  {
    key: 'decal:crack',
    w: 32,
    h: 32,
    frames: 3,
    draw: (b, i) => {
      const r = rng(140 + i);
      for (let br = 0; br < 3; br++) {
        let x = 16;
        let y = 16;
        let a = r() * Math.PI * 2;
        for (let k = 0; k < 14; k++) {
          a += (r() - 0.5) * 0.8;
          x += Math.cos(a);
          y += Math.sin(a) * 0.8;
          b.set(Math.round(x), Math.round(y), 0x050404, 230);
          if (k % 2) b.set(Math.round(x), Math.round(y) - 1, D.floor[3]!, 150);
        }
      }
    },
  },
  {
    key: 'decal:moss',
    w: 32,
    h: 32,
    frames: 3,
    draw: (b, i) => {
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
        const d = Math.hypot(x - 16, (y - 16) * 1.3) / 13;
        const n = pnoise(x, y, 8, 200 + i) * 0.6 + pnoise(x, y, 4, 210 + i) * 0.4;
        if (d > 1 || n < 0.35 + d * 0.4) continue;
        b.set(x, y, tone(D.moss, 0.6 + n * 2.6 + bayer(x, y) * 0.4), 210);
      }
    },
  },
  {
    key: 'decal:stain',
    w: 40,
    h: 40,
    frames: 3,
    draw: (b, i) => {
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
        const d = Math.hypot(x - 20, (y - 20) * 1.3) / 18;
        const n = pnoise(x, y, 8, 300 + i);
        if (d > 1 || n < 0.3 + d * 0.5) continue;
        b.set(x, y, i === 2 ? 0x1a0a06 : 0x0a0806, Math.round(120 * (1 - d * 0.6)));
      }
    },
  },
];

// ---------------------------------------------------------------- backdrop

function drawBackdrop(): PixelBuffer {
  const W = 480;
  const H = 270;
  const buf = new PixelBuffer(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = y / H;
      let c = mix(0x050406, 0x14101a, Math.min(1, t * 1.3 + bayer(x, y) * 0.05));
      // drifting fog bands
      const fog = Math.sin(x * 0.012 + y * 0.03) * 0.5 + 0.5;
      const n = hash2(x >> 3, y >> 3, 17) * 0.3;
      const f = Math.max(0, fog * 0.5 + n - 0.45) * (0.4 + t * 0.6);
      if (f + bayer(x, y) * 0.12 > 0.12) c = mix(c, D.fog, Math.min(0.4, f));
      buf.set(x, y, c);
    }
  }
  // faint distant arches
  for (let k = 0; k < 6; k++) {
    const ax = 40 + k * 80;
    for (let a = Math.PI; a <= Math.PI * 2; a += 0.01) {
      const x = Math.round(ax + Math.cos(a) * 30);
      const y = Math.round(150 + Math.sin(a) * 40);
      buf.set(x, y, mix(buf.get(x, y) & 0xffffff, 0x2a2430, 0.5));
    }
    for (let y = 150; y < 270; y++) {
      buf.set(ax - 30, y, mix(buf.get(ax - 30, y) & 0xffffff, 0x221e28, 0.5));
      buf.set(ax + 30, y, mix(buf.get(ax + 30, y) & 0xffffff, 0x221e28, 0.5));
    }
  }
  return buf;
}

// ---------------------------------------------------------------- build

export interface DungeonSheet {
  key: string;
  frameW: number;
  frameH: number;
  frames: number;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  anim?: { key: string; durations: number[]; loop: boolean };
}

function pack(key: string, frames: PixelBuffer[], fw: number, fh: number, anim?: DungeonSheet['anim']): DungeonSheet {
  const sheet = new Sheet(fw, fh, frames.length, 2048);
  for (const f of frames) sheet.add(f);
  const out: DungeonSheet = { key, frameW: fw, frameH: fh, frames: frames.length, width: sheet.buf.w, height: sheet.buf.h, rgba: sheet.buf.toRGBA() };
  if (anim) out.anim = anim;
  return out;
}

const DECAL_SPECS: DecalSpec[] = [...BASE_DECAL_SPECS, ...THEME_DECAL_SPECS, ...STORY_DECAL_SPECS];

/** Story decals baked into the floor by the renderer (coins, wax, claw marks, chalk, edge growth). */
export const STORY_DECALS = { coins: 'decal:coins', wax: 'decal:wax', claw: 'decal:claw', chalk: 'decal:chalk', edge: 'decal:edge' } as const;

/** Runs the glow-halo pass but drops the plain outline pixels (for flat floor overlays). */
function glowOnly(buf: PixelBuffer, p: Painter): void {
  const before = buf.data.slice();
  p.finish(P_OUT, 0.9);
  const solidOutline = (0xff000000 | P_OUT) >>> 0;
  for (let i = 0; i < buf.data.length; i++) {
    if ((before[i] as number) >>> 24 === 0 && buf.data[i] === solidOutline) buf.data[i] = 0;
  }
}

/** Flat floor overlays that read better without the sprite outline. */
const NO_OUTLINE = new Set(['prop:cobweb', 'prop:puddle', 'prop:ritual', 'prop:lavacrack', ...CLUTTER_NO_OUTLINE, ...ROOM_NO_OUTLINE, ...THEME_EXTRA_NO_OUTLINE]);

/** Keys of every texture produced by buildDungeonSheets + buildThemeSheets for all themes (for the manifest). */
export const DUNGEON_TEXTURE_KEYS: readonly string[] = [
  'dungeon:floor',
  'dungeon:wall',
  'dungeon:void',
  'bg:catacombs',
  ...['catacombs', ...VARIANT_THEMES].flatMap((t) => [`dungeon:floor:${t}`, `dungeon:wall:${t}`, `dungeon:void:${t}`]),
  ...Object.values(ALL_PROP_SPECS).map((s) => s.key),
  ...Object.values(ALL_PROP_SPECS).filter((s) => s.glow).map((s) => `${s.key}:glow`),
  ...DECAL_SPECS.map((dd) => dd.key),
  ...AMBIENT_TEXTURE_KEYS.filter((k) => !k.startsWith('decal:')),
];

function catacombsFrames(): { floors: PixelBuffer[]; walls: PixelBuffer[]; voids: PixelBuffer[] } {
  const floors = Array.from({ length: DUNGEON_FRAMES.floorCount }, (_, v) => drawFloor(v));
  const walls: PixelBuffer[] = [];
  for (let v = 0; v < DUNGEON_FRAMES.faceVariants; v++) {
    for (let e = 0; e < 4; e++) walls.push(drawWallFrame(v, ((e & 1) ? 2 : 0) | ((e & 2) ? 4 : 0), v % 2));
  }
  for (let mask = 0; mask < 8; mask++) for (let v = 0; v < 2; v++) walls.push(drawWallFrame(null, mask, v));
  return { floors, walls, voids: [drawVoid()] };
}

/**
 * Shared dungeon textures: catacombs terrain under the legacy keys (dungeon:floor / :wall / :void),
 * the backdrop, every prop (all themes) and every decal.
 */
export function buildDungeonSheets(opts: { clutter?: boolean } = {}): DungeonSheet[] {
  const out: DungeonSheet[] = [];
  const cat = catacombsFrames();
  out.push(pack('dungeon:floor', cat.floors, T, T));
  out.push(pack('dungeon:wall', cat.walls, T, T * 2));
  out.push(pack('dungeon:void', cat.voids, T, T));
  const bg = drawBackdrop();
  out.push(pack('bg:catacombs', [bg], bg.w, bg.h));
  const withClutter = opts.clutter !== false;
  for (const [name, s] of Object.entries(ALL_PROP_SPECS)) {
    if (!withClutter && name in CLUTTER_PROP_SPECS) continue;
    out.push(...propSheets(s));
  }
  for (const dd of [...DECAL_SPECS, ...CRITTER_SPECS, ...AMBIENT_FX_SPECS]) out.push(flatSheet(dd));
  return out;
}

/** Sheets for the given prop ids (the prop texture plus its glow layer, if any). Unknown ids are skipped. */
export function buildPropSheets(ids: readonly string[]): DungeonSheet[] {
  const out: DungeonSheet[] = [];
  for (const id of ids) {
    const s = ALL_PROP_SPECS[id];
    if (s) out.push(...propSheets(s));
  }
  return out;
}

function propSheets(s: PropSpec & Partial<ClutterSpec>): DungeonSheet[] {
  const frames: PixelBuffer[] = [];
  for (let i = 0; i < s.frames; i++) {
    const buf = new PixelBuffer(s.w, s.h);
    const p = new Painter(buf);
    s.draw(p, i, s.frames);
    if (!NO_OUTLINE.has(s.key)) p.finish(P_OUT, 0.9);
    else glowOnly(buf, p);
    s.post?.(buf);
    frames.push(buf);
  }
  const out = [pack(s.key, frames, s.w, s.h, s.anim ? { key: s.anim, durations: s.durations ?? frames.map(() => 100), loop: true } : undefined)];
  if (s.glow) {
    const g = s.glow;
    const gf: PixelBuffer[] = [];
    for (let i = 0; i < g.frames; i++) {
      const buf = new PixelBuffer(s.w, s.h);
      const p = new Painter(buf);
      g.draw(p, i, g.frames);
      glowOnly(buf, p);
      gf.push(buf);
    }
    const key = `${s.key}:glow`;
    out.push(pack(key, gf, s.w, s.h, g.frames > 1 ? { key, durations: g.durations ?? gf.map(() => 120), loop: true } : undefined));
  }
  return out;
}

function flatSheet(dd: { key: string; w: number; h: number; frames: number; outline?: boolean; draw: (buf: PixelBuffer, i: number) => void }): DungeonSheet {
  const frames: PixelBuffer[] = [];
  for (let i = 0; i < dd.frames; i++) {
    const buf = new PixelBuffer(dd.w, dd.h);
    dd.draw(buf, i);
    if (dd.outline) outlinePass(buf, P_OUT);
    frames.push(buf);
  }
  return pack(dd.key, frames, dd.w, dd.h);
}

/** Theme terrain: dungeon:floor:<theme> (12 frames), dungeon:wall:<theme> (48 frames), dungeon:void:<theme>. */
export function buildThemeSheets(theme: ThemeId): DungeonSheet[] {
  if (theme === 'catacombs') {
    const cat = catacombsFrames();
    return [
      pack('dungeon:floor:catacombs', cat.floors, T, T),
      pack('dungeon:wall:catacombs', cat.walls, T, T * 2),
      pack('dungeon:void:catacombs', cat.voids, T, T),
    ];
  }
  return buildThemeFrames(theme).map((f) => pack(f.key, f.frames, f.frameW, f.frameH));
}

// ---------------------------------------------------------------- raw frame access (used by the isometric terrain builder)

/** One 32x32 floor frame (frame semantics of dungeon:floor) for any theme. */
export function floorFrame(theme: ThemeId, v: number, iso = false): PixelBuffer {
  return theme === 'catacombs' ? drawFloor(v) : themeFloorFrame(theme, v, iso);
}

/** The 32x32 top surface of a wall block for any theme (no rims). */
export function capTexture(theme: ThemeId, variant: number): PixelBuffer {
  if (theme !== 'catacombs') return themeCapTexture(theme, variant);
  const buf = new PixelBuffer(T, T);
  capSurface(buf, 0, variant, 0, false);
  return buf;
}

export function voidFrame(theme: ThemeId): PixelBuffer {
  return theme === 'catacombs' ? drawVoid() : themeVoidFrame(theme);
}
