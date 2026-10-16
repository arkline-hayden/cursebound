// Fate card art (procedural pixel art, ui/pixelSkin.ts style). Every Fate card wears the ornament of the dungeon its
// door leads to: a themed 9-slice frame, corner pieces, a crest with the theme sigil in a rarity medallion, a foot
// plinth for the key numeral, an optional fringe along the top edge, a dark text-panel texture and a "vista" (the
// actual door of that dungeon, ui art from game/art/doors.ts buildDoorPortrait, set in its wall with its props).
// Plus the dungeon-agnostic card back, the wax seal stamped on a bound card, rarity rules, the sheen, the cursor glare
// and the burn-away dissolve masks.
//
// Everything is drawn at 1x into Px buffers (no DOM until `url()`), so Node can preview it and tests can check it.
// The UI shows each sprite at an integer scale (--ps: 2 / 3 / 4) with image-rendering: pixelated.
//
// Geometry (art px): a card is FA.CARD_W wide; its frame is a FA.TILE x FA.TILE 9-slice with FA.SLICE px borders.

import { Px, PAL, dither, hash, ramp, type RGB } from './pixelSkin';
import { DOOR_PORTRAIT_FRAMES, buildDoorPortrait } from '../game/art/doors';

export const FA = {
  CARD_W: 160,
  SLICE: 12,
  TILE: 36,
  CORNER: 32,
  /** the corner sprite's card-corner point (sprite px): the sprite overhangs the card by this much */
  CORNER_OFF: 8,
  CREST_W: 112,
  CREST_H: 44,
  /** crest rows above the card's top edge */
  CREST_RISE: 26,
  MEDAL: 28,
  SIGIL: 15,
  FOOT_W: 88,
  FOOT_H: 22,
  /** foot rows below the card's bottom edge */
  FOOT_DROP: 12,
  FRINGE_W: 24,
  FRINGE_H: 12,
  VISTA_W: 128,
  VISTA_H: 104,
  SEAL: 48,
  EMBLEM_W: 72,
  EMBLEM_H: 96,
  PANEL: 32,
  RULE: 12,
} as const;

export type Rarity = 'common' | 'rare' | 'mythic';
type Ramp = readonly RGB[];
const R = (...c: RGB[]): Ramp => Object.freeze(c);
const K = PAL.K;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function mixRGB(a: RGB, b: RGB, t: number): RGB {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
export const cssHex = (c: RGB) => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;

// ---------------------------------------------------------------------------------------------------------------
// palettes (from the door styles in game/art/doors.ts, so a card matches the door it opens)
// ---------------------------------------------------------------------------------------------------------------

export interface ThemePal {
  /** frame band material, dark -> light */
  stone: Ramp;
  /** rim metal, dark -> light */
  trim: Ramp;
  /** a third material (wood, bone, lava, ice, feathers, ...) */
  alt: Ramp;
  /** emissive accent (the theme's light) and a second one */
  glow: RGB;
  glow2: RGB;
  /** very dark text-panel ramp */
  panel: Ramp;
  /** wax colour of the bound seal */
  wax: Ramp;
}

const IRON = R(0x141418, 0x2a2a32, 0x44444e, 0x6a6a76, 0x9a9aa6);
const BONE = R(0x3e322c, 0x7c6e5e, 0xbcae94, 0xe8dec4, 0xfffaf0);
const GOLD = R(0x4a3008, 0x8a6418, 0xc89a30, 0xf0d070, 0xfff4c0);
const BRONZE = R(PAL.br0, PAL.br1, PAL.br2, PAL.br3, PAL.br4, PAL.br5);
const SILVER = R(0x2a2e36, 0x48505e, 0x6e7a8c, 0x9aa8bc, 0xd0dcec);

export const THEME_PAL: Record<string, ThemePal> = {
  catacombs: {
    stone: R(0x171210, 0x2a211c, 0x40332b, 0x58463a, 0x74604e), trim: BRONZE, alt: BONE,
    glow: 0xffa04a, glow2: 0xffe08a, panel: R(0x0a0706, 0x110c0a, 0x18120e, 0x201812), wax: R(0x2a0a04, 0x5a1a08, 0x8a3010, 0xc05a20, 0xf09a50),
  },
  flooded: {
    stone: R(0x0e161a, 0x1a272e, 0x283a42, 0x3a5058, 0x587078), trim: R(0x0a2014, 0x14381e, 0x24582a, 0x3e7a3a, 0x6aa850), alt: R(0x0c2416, 0x18402a, 0x2a6a3a, 0x4a9a48, 0x86c860),
    glow: 0x30d0c0, glow2: 0x9af4e8, panel: R(0x04090b, 0x070e11, 0x0b1418, 0x0f1a1e), wax: R(0x031418, 0x08303a, 0x10606a, 0x30a0a0, 0x80e0d8),
  },
  ossuary: {
    stone: R(0x3a3026, 0x6a5e4a, 0xa09276, 0xccc0a2, 0xf0e8d0), trim: R(0x050303, 0x16110d, 0x2c241c, 0x4a3e30, 0x6a5c48), alt: BONE,
    glow: 0xbfe8ff, glow2: 0x6ab8ff, panel: R(0x0a0908, 0x110f0d, 0x181512, 0x201c17), wax: R(0x0a121c, 0x1c2a3a, 0x3a5470, 0x6a90b0, 0xb8daf0),
  },
  sanctum: {
    stone: R(0x3a2a2c, 0x7a686a, 0xbcaeae, 0xe6dcdc, 0xffffff), trim: GOLD, alt: R(0x1e0406, 0x3a080c, 0x5e1016, 0x84202a, 0xb04048, 0xe86060),
    glow: 0xff4a30, glow2: 0xffc060, panel: R(0x0c0405, 0x140708, 0x1c0a0c, 0x260e10), wax: R(0x200204, 0x4a0608, 0x80101a, 0xb82030, 0xf05060),
  },
  fungal: {
    stone: R(0x150f0b, 0x251b13, 0x392b1d, 0x4f3f2e, 0x6a5842), trim: R(0x0a1a10, 0x163020, 0x245032, 0x3e7a48, 0x68a868), alt: R(0x24161a, 0x432a24, 0x684632, 0x926c48, 0xb08a60),
    glow: 0x40f0b0, glow2: 0xff9ae8, panel: R(0x07080a, 0x0b0c0c, 0x0f1110, 0x141714), wax: R(0x04140e, 0x0a362a, 0x147060, 0x3ab898, 0x9af0d8),
  },
  forge: {
    stone: R(0x0d0b0d, 0x191619, 0x252125, 0x332e32, 0x4c4448), trim: IRON, alt: R(0x2a1008, 0x5a2008, 0x8a3a10, 0xc06020, 0xff9a40, 0xfff0a0),
    glow: 0xff7a20, glow2: 0xfff0a0, panel: R(0x080606, 0x0e0a0a, 0x140e0d, 0x1a1210), wax: R(0x1a0602, 0x4a1404, 0x8a2e08, 0xd06018, 0xffb050),
  },
  frost: {
    stone: R(0x141e2a, 0x243446, 0x384e66, 0x546e8a, 0x88aed0), trim: R(0x3a5a7a, 0x5a86aa, 0x8ac0e8, 0xc8ecff, 0xffffff), alt: R(0x3a5a7a, 0x5a86aa, 0x8ac0e8, 0xc8ecff, 0xf4fbff),
    glow: 0x8ac8ff, glow2: 0xe0f6ff, panel: R(0x05080d, 0x080d14, 0x0c131c, 0x101924), wax: R(0x0a1830, 0x1a3a6a, 0x3a70b0, 0x7ab0e8, 0xd0ecff),
  },
  sky: {
    stone: R(0x4a4030, 0x6c604a, 0x948668, 0xbcae8c, 0xe0d4b0), trim: GOLD, alt: R(0x7a7468, 0xaaa496, 0xd6d2c4, 0xf2f0e8, 0xffffff),
    glow: 0xffe0a0, glow2: 0x8ac8ff, panel: R(0x060a12, 0x0a1019, 0x0e1622, 0x131c2b), wax: R(0x2a1a04, 0x6a4a10, 0xb08a30, 0xe8c060, 0xfff0b0),
  },
  moon: {
    stone: R(0x22232a, 0x34363e, 0x4a4c56, 0x666874, 0x8a8c9a), trim: SILVER, alt: R(0x0a1a3a, 0x1a3a7a, 0x3a78c8, 0x7ab4f0, 0xd0e8ff),
    glow: 0xcfe4ff, glow2: 0xff4a30, panel: R(0x040508, 0x07080d, 0x0a0c12, 0x0e1018), wax: R(0x10141c, 0x2a3040, 0x4a5468, 0x7a88a0, 0xc8d4e8),
  },
  server: {
    stone: R(0x0e1016, 0x1a1e28, 0x282e3c, 0x3a4256, 0x56607a), trim: R(0x14171e, 0x262c38, 0x3a4256, 0x56607a, 0x8a96b0), alt: R(0x04303a, 0x08606e, 0x10a8b8, 0x50f0ff, 0xc8ffff),
    glow: 0x40e8ff, glow2: 0xff70f0, panel: R(0x030407, 0x05070b, 0x080a10, 0x0b0e16), wax: R(0x200828, 0x501060, 0x9020a0, 0xd050e0, 0xffb0ff),
  },
  courtyard: {
    stone: R(0x2a2620, 0x4a4438, 0x6e6654, 0x968c74, 0xc0b498), trim: R(0x2a1606, 0x4c2c0c, 0x764916, 0xa46f24, 0xd29d3e), alt: R(0x16300e, 0x285018, 0x3e7a22, 0x5ea432, 0x8ccc50),
    glow: 0xffd070, glow2: 0x9ce070, panel: R(0x080706, 0x0e0c0a, 0x14110e, 0x1a1612), wax: R(0x2a0a04, 0x5a1a08, 0x8a3010, 0xc05a20, 0xf09a50),
  },
};

export const FATE_THEMES = ['catacombs', 'flooded', 'ossuary', 'sanctum', 'fungal', 'forge', 'frost', 'sky', 'moon', 'server'] as const;
export const artTheme = (t: string): string => (THEME_PAL[t] ? t : 'catacombs');
export const themePal = (t: string): ThemePal => THEME_PAL[artTheme(t)]!;

/** Rarity metals for medallion rings and rules: [dark, mid, light, highlight] + gem. Mythic cycles 4 prism gems. */
export const RARITY_METAL: Record<Rarity, { r: Ramp; gem: Ramp }> = {
  common: { r: R(0x3e424a, 0x8c929c, 0xc8ccd4, 0xf4f6fa), gem: R(0x4a5a78, 0x8ca6d8, 0xdce8ff) },
  rare: { r: R(0x6a4410, 0xb8862a, 0xf0cf78, 0xfff4c8), gem: R(0x7a0a1c, 0xe0303e, 0xffb0b8) },
  mythic: { r: R(0x4a0612, 0xa8142c, 0xff3d5a, 0xffb0bc), gem: R(0x7a0a1c, 0xff3d5a, 0xffd0d8) },
};
const PRISM: readonly Ramp[] = [R(0x7a0a1c, 0xff3d5a, 0xffd0d8), R(0x6a0a5a, 0xff4fd8, 0xffd0f4), R(0x7a4a08, 0xffc531, 0xfff0b0), R(0x0a4a6a, 0x6ae6ff, 0xd8faff)];

// ---------------------------------------------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------------------------------------------

/** Shaded ellipse lit from the upper left, dithered between ramp tones. */
function orb(px: Px, cx: number, cy: number, rx: number, ry: number, r: Ramp, bias = 0) {
  for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, d2 = dx * dx + dy * dy;
    if (d2 > 1) continue;
    const z = Math.sqrt(1 - d2);
    px.p(x, y, ramp(r, clamp01(0.42 + (-dx * 0.5 - dy * 0.62 + z * 0.5) * 0.62 + bias), x, y));
  }
}

/** Thick shaded stroke along a polyline (cylinder shading across the stroke). */
function stroke(px: Px, pts: readonly (readonly [number, number])[], w: number, r: Ramp, bias = 0) {
  for (let k = 0; k < pts.length - 1; k++) {
    const [x0, y0] = pts[k]!, [x1, y1] = pts[k + 1]!;
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    const nx = -(y1 - y0), ny = x1 - x0, nl = Math.hypot(nx, ny) || 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n, cx = lerp(x0, x1, t), cy = lerp(y0, y1, t);
      for (let s = -w / 2; s <= w / 2; s += 0.5) {
        const x = cx + (nx / nl) * s, y = cy + (ny / nl) * s;
        // lit side faces the upper left
        const side = ((nx / nl) * s * -0.7 + (ny / nl) * s * -0.7) / (w / 2 + 0.01);
        px.p(x, y, ramp(r, clamp01(0.55 + side * 0.35 + bias), Math.floor(x), Math.floor(y)));
      }
    }
  }
}

/** Single-pixel line in one colour. */
function line(px: Px, x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1) { px.line(x0, y0, x1, y1, c, a); }

function rivet(px: Px, x: number, y: number, r: Ramp) {
  px.p(x, y, r[r.length - 1]!); px.p(x + 1, y, r[2]!); px.p(x, y + 1, r[2]!); px.p(x + 1, y + 1, r[0]!);
}

/** Diamond stud with a gem (rarity / theme jewel). */
function stud(px: Px, cx: number, cy: number, rad: number, metal: Ramp, gem: Ramp) {
  for (let y = Math.floor(cy - rad - 1); y <= cy + rad + 1; y++) for (let x = Math.floor(cx - rad - 1); x <= cx + rad + 1; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, m = Math.abs(dx) + Math.abs(dy);
    if (m > rad + 0.5) continue;
    if (m > rad - 0.5) { px.p(x, y, K); continue; }
    if (m < rad - 1.5) { px.p(x, y, dx + dy < -0.5 ? gem[2]! : dx + dy < 0.5 ? gem[1]! : gem[0]!); continue; }
    px.p(x, y, dx + dy < 0 ? metal[metal.length - 1]! : dx + dy < 1 ? metal[2]! : metal[1]!);
  }
}

/** A glowing point with a soft (dithered) halo: emissive details. */
function glint(px: Px, x: number, y: number, c: RGB, halo = 1) {
  if (halo > 0) for (let yy = -halo; yy <= halo; yy++) for (let xx = -halo; xx <= halo; xx++) {
    if (Math.abs(xx) + Math.abs(yy) > halo || (xx === 0 && yy === 0)) continue;
    if (!px.al(x + xx, y + yy)) px.p(x + xx, y + yy, c, 0.45);
  }
  px.p(x, y, mixRGB(c, 0xffffff, 0.55));
}

/** Pixel map from strings; legend chars -> colours, '.' / ' ' transparent. */
function map(px: Px, x0: number, y0: number, rows: readonly string[], legend: Record<string, RGB>, fx = false) {
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const c = legend[ch];
    if (c !== undefined) px.p(x0 + (fx ? row.length - 1 - x : x), y0 + y, c);
  }));
}

/** Mirror the left half (x < w/2) onto the right half. */
function mirror(px: Px): Px {
  const w = px.w;
  for (let y = 0; y < px.h; y++) for (let x = 0; x < Math.floor(w / 2); x++) {
    const a = px.al(x, y), tx = w - 1 - x;
    px.clear(tx, y);
    if (a) px.p(tx, y, px.col(x, y), a / 255);
  }
  return px;
}

/** Compose `src` into `dst` with a 1px black outline drawn around `src` first (separates overlapping parts). */
function layer(dst: Px, src: Px, dx = 0, dy = 0, outline = true) {
  if (outline) src.outline(K);
  dst.blit(src, dx, dy);
}

// ---------------------------------------------------------------------------------------------------------------
// motifs (small drawings reused by frames, corners, crests and vistas)
// ---------------------------------------------------------------------------------------------------------------

function skull(px: Px, x0: number, y0: number, bone: Ramp, eye: RGB | null, size: 'sm' | 'lg' = 'lg') {
  if (size === 'sm') {
    map(px, x0, y0, [
      '.KKKKK.',
      'K43332K',
      'K4E3E2K',
      'K33K32K',
      '.K2K2K.',
      '..KKK..',
    ], { K, '4': bone[4]!, '3': bone[3]!, '2': bone[2]!, E: eye ?? 0x0a0606 });
    return;
  }
  map(px, x0, y0, [
    '..KKKKKKK..',
    '.K4444333K.',
    'K444443332K',
    'K443333332K',
    'K4KKK3KKK2K',
    'K4KEK3KEK2K',
    'K3KKK3KKK2K',
    '.K333K3322K.',
    '..K32K232K.',
    '...K2222K..',
    '...K2K2K2K.',
    '....KKKKK..',
  ], { K, '4': bone[4]!, '3': bone[3]!, '2': bone[2]!, E: eye ?? 0x0a0606 });
}

function candle(px: Px, x: number, yBase: number, h: number, wax: Ramp, flame: RGB, f = 0) {
  for (let y = 0; y < h; y++) {
    px.p(x - 1, yBase - y, wax[3]!); px.p(x, yBase - y, wax[2]!); px.p(x + 1, yBase - y, wax[1]!);
  }
  // wax drips
  px.p(x - 1, yBase - h + 2, wax[4]!); px.p(x + 1, yBase - h + 3, wax[2]!); px.p(x + 1, yBase - h + 4, wax[2]!);
  px.p(x, yBase - h, wax[4]!);
  px.p(x, yBase - h - 1, 0x2a1a10);   // wick
  const sway = [0, 1, 0, -1][f % 4]!;
  const tall = f % 2 ? 3 : 4;
  for (let k = 0; k < tall; k++) {
    const yy = yBase - h - 2 - k, xx = x + (k >= 2 ? sway : 0);
    px.p(xx, yy, k === 0 ? mixRGB(flame, 0xffffff, 0.7) : k === tall - 1 ? mixRGB(flame, 0xff3000, 0.3) : flame);
    if (k <= 1) { px.p(xx - 1, yy, mixRGB(flame, 0xff4000, 0.35), 0.9); px.p(xx + 1, yy, mixRGB(flame, 0xff4000, 0.35), 0.9); }
  }
}

function bone(px: Px, x0: number, y0: number, x1: number, y1: number, r: Ramp) {
  stroke(px, [[x0, y0], [x1, y1]], 2, r);
  for (const [x, y] of [[x0, y0], [x1, y1]] as const) {
    const ax = x1 - x0, ay = y1 - y0, al = Math.hypot(ax, ay) || 1;
    const nx = -ay / al, ny = ax / al;
    orb(px, x + nx * 1.2, y + ny * 1.2, 1.4, 1.4, r);
    orb(px, x - nx * 1.2, y - ny * 1.2, 1.4, 1.4, r);
  }
}

function mushroom(px: Px, x: number, yBase: number, h: number, capR: number, cap: RGB, stalk: Ramp, glow = true) {
  for (let y = 0; y < h; y++) { px.p(x, yBase - y, stalk[3]!); px.p(x + 1, yBase - y, stalk[2]!); if (h > 5) px.p(x - 1, yBase - y, stalk[3]!); }
  const capRamp = R(mixRGB(cap, 0x000000, 0.65), mixRGB(cap, 0x000000, 0.35), cap, mixRGB(cap, 0xffffff, 0.45), mixRGB(cap, 0xffffff, 0.8));
  const cy = yBase - h;
  for (let yy = -Math.ceil(capR * 0.75); yy <= 0; yy++) for (let xx = -capR - 1; xx <= capR + 1; xx++) {
    const dx = (xx + 0.5) / (capR + 0.5), dy = yy / (capR * 0.75 + 0.3);
    if (dx * dx + dy * dy > 1) continue;
    px.p(x + xx, cy + yy, ramp(capRamp, clamp01(0.7 - dx * 0.3 - dy * 0.4), x + xx, cy + yy));
  }
  // gills
  for (let xx = -capR; xx <= capR; xx++) px.p(x + xx, cy + 1, mixRGB(cap, 0x000000, 0.7));
  if (glow) for (const [sx, sy] of [[-Math.floor(capR / 2), -1], [Math.ceil(capR / 2), -Math.max(1, Math.floor(capR / 2))]] as const) px.p(x + sx, cy + sy, 0xffffff);
}

function icicle(px: Px, x: number, y: number, len: number, r: Ramp) {
  for (let k = 0; k < len; k++) {
    const w = k < len * 0.35 ? 2 : 1;
    px.p(x, y + k, ramp(r, clamp01(0.95 - k / len * 0.5), x, y + k));
    if (w === 2) px.p(x + 1, y + k, r[1]!);
  }
  px.p(x, y + len - 1, 0xffffff);
}

/** Ice shard pointing along (dx, dy) from (x, y). */
function shard(px: Px, x: number, y: number, len: number, w: number, dx: number, dy: number, r: Ramp) {
  const l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
  for (let t = 0; t <= len; t += 0.5) {
    const half = w * (1 - t / len);
    for (let s = -half; s <= half; s += 0.5) {
      const px_ = x + ux * t + nx * s, py_ = y + uy * t + ny * s;
      const lit = s < 0 ? 0.85 : 0.45;
      px.p(px_, py_, ramp(r, clamp01(lit + t / len * 0.2), Math.floor(px_), Math.floor(py_)));
    }
  }
  px.p(Math.round(x + ux * len), Math.round(y + uy * len), 0xffffff);
}

function feather(px: Px, x: number, y: number, len: number, ang: number, r: Ramp, tip: RGB) {
  const ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
  for (let t = 0; t <= len; t += 0.5) {
    const tt = t / len;
    const grow = Math.sin(Math.min(1, tt * 1.8) * Math.PI / 2);
    const half = 0.3 + 1.7 * grow * (tt > 0.82 ? Math.max(0.2, (1 - tt) / 0.18) : 1);
    for (let s = -half; s <= half; s += 0.5) {
      const qx = x + ux * t + nx * s, qy = y + uy * t + ny * s;
      const vane = Math.abs(s) > half - 0.7 ? 1 : s < 0 ? 3 : 2;
      px.p(qx, qy, t > len - 3 ? tip : r[vane]!);
    }
    px.p(x + ux * t, y + uy * t, r[4] ?? r[3]!);   // the shaft
  }
}

/**
 * Heraldic wing: feathers hang from an arm running A -> B (B = the wing tip), each outlined on its own so they read
 * as separate feathers; outer primaries first (underneath), then a row of short gold-edged coverts along the arm.
 */
function wing(px: Px, ax: number, ay: number, bx: number, by: number, n: number, len0: number, len1: number, ang0: number, ang1: number, r: Ramp, tip: RGB, covert: Ramp | null) {
  for (let k = n - 1; k >= 0; k--) {
    const u = k / (n - 1);
    const f = new Px(px.w, px.h);
    feather(f, lerp(ax, bx, u), lerp(ay, by, u), lerp(len0, len1, u), lerp(ang0, ang1, u), r, tip);
    f.outline(K);
    px.blit(f, 0, 0);
  }
  if (!covert) return;
  const m = Math.max(3, Math.round(n * 0.75));
  for (let k = m - 1; k >= 0; k--) {
    const u = k / (m - 1);
    const f = new Px(px.w, px.h);
    feather(f, lerp(ax, bx, u * 0.92), lerp(ay, by, u * 0.92), lerp(len0, len1, u) * 0.38 + 2, lerp(ang0, ang1, u) - 0.15, covert, covert[covert.length - 1]!);
    f.outline(K);
    px.blit(f, 0, 0);
  }
}

function cloud(px: Px, cx: number, cy: number, w: number, r: Ramp) {
  const puffs = [[-w * 0.36, 0.5, w * 0.24], [0, -w * 0.12, w * 0.32], [w * 0.36, 0.6, w * 0.22], [-w * 0.12, w * 0.14, w * 0.26], [w * 0.16, w * 0.16, w * 0.24]];
  for (const [ox, oy, rr] of puffs) orb(px, cx + ox!, cy + oy!, rr!, rr! * 0.8, r, 0.1);
}

function kelp(px: Px, x: number, y: number, len: number, phase: number, r: Ramp) {
  for (let k = 0; k < len; k++) {
    const xx = x + Math.round(Math.sin(k * 0.45 + phase) * 1.3);
    px.p(xx, y + k, r[2]!); px.p(xx + 1, y + k, r[1]!);
    if (k % 4 === 1) px.p(xx - 1, y + k, r[3]!);
    if (k % 5 === 3) px.p(xx + 2, y + k, r[2]!);
  }
}

function barnacle(px: Px, x: number, y: number, r: Ramp) {
  map(px, x, y, ['.KKK.', 'K434K', 'K3K2K', 'K323K', '.KKK.'], { K, '4': r[4]!, '3': r[3]!, '2': r[1]! });
}

function crescent(px: Px, cx: number, cy: number, rad: number, r: Ramp, cut = 0.45) {
  for (let y = Math.floor(cy - rad - 1); y <= cy + rad + 1; y++) for (let x = Math.floor(cx - rad - 1); x <= cx + rad + 1; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    if (dx * dx + dy * dy > rad * rad) continue;
    const ox = dx - rad * cut, oy = dy + rad * cut * 0.4;
    if (ox * ox + oy * oy < (rad * 0.86) ** 2) continue;
    const lit = clamp01(0.75 - (dx + dy) / (rad * 3));
    px.p(x, y, ramp(r, lit, x, y));
  }
}

function sparkle(px: Px, x: number, y: number, c: RGB, big = false) {
  px.p(x, y, 0xffffff);
  px.p(x - 1, y, c); px.p(x + 1, y, c); px.p(x, y - 1, c); px.p(x, y + 1, c);
  if (big) { px.p(x - 2, y, c, 0.6); px.p(x + 2, y, c, 0.6); px.p(x, y - 2, c, 0.6); px.p(x, y + 2, c, 0.6); }
}

function led(px: Px, x: number, y: number, c: RGB, on = true) {
  px.p(x, y, on ? mixRGB(c, 0xffffff, 0.5) : mixRGB(c, 0x000000, 0.7));
  if (on) { px.p(x + 1, y, c); px.p(x, y + 1, mixRGB(c, 0x000000, 0.3)); px.p(x + 1, y + 1, mixRGB(c, 0x000000, 0.5)); }
  else { px.p(x + 1, y, mixRGB(c, 0x000000, 0.8)); px.p(x, y + 1, mixRGB(c, 0x000000, 0.8)); px.p(x + 1, y + 1, 0x050506); }
}

/** Right-angle circuit trace through the points, with a via (glow) at the end. */
function trace(px: Px, pts: readonly (readonly [number, number])[], c: RGB, via: RGB) {
  for (let k = 0; k < pts.length - 1; k++) line(px, pts[k]![0], pts[k]![1], pts[k + 1]![0], pts[k + 1]![1], c);
  const [ex, ey] = pts[pts.length - 1]!;
  px.p(ex, ey, via); px.p(ex - 1, ey, mixRGB(via, 0, 0.5)); px.p(ex + 1, ey, mixRGB(via, 0, 0.5)); px.p(ex, ey - 1, mixRGB(via, 0, 0.5)); px.p(ex, ey + 1, mixRGB(via, 0, 0.5));
}

// ---------------------------------------------------------------------------------------------------------------
// sigils: one 15x15 mark per dungeon (crest medallion, seal, mini cards)
// ---------------------------------------------------------------------------------------------------------------

const SIGILS: Record<string, readonly string[]> = {
  catacombs: [
    '.......W.......',
    '......WGW......',
    '......GWG......',
    '.....GGWGG.....',
    '......GGG......',
    '.......K.......',
    '.....KKKKK.....',
    '.....K432K.....',
    '....KK432K.....',
    '....K3432K.....',
    '.....K432K.....',
    '.....K432KK....',
    '..KKKKKKKKKKK..',
    '..K444333221K..',
    '..KKKKKKKKKKK..',
  ],
  flooded: [
    '.......K.......',
    '......K4K......',
    '......K4K......',
    '.....K443K.....',
    '....K4W433K....',
    '....K44333K....',
    '....K43332K....',
    '.....K322K.....',
    '......KKK......',
    '...............',
    '.KK...KK...KK..',
    'K44K.K44K.K44K.',
    '2..K43..K43..K4',
    '....K...K...K..',
    '...............',
  ],
  ossuary: [
    '...KKKKKKKKK...',
    '..K444444433K..',
    '.K44444444333K.',
    '.K44444443333K.',
    '.K4KKKK4KKKK3K.',
    '.K4KGGK4KGGK3K.',
    '.K4KKKK3KKKK3K.',
    '.K34444K44433K.',
    '..K333KKK333K..',
    '...K3333333K...',
    '...K3K3K3K3K...',
    '...KKKKKKKKK...',
    '...............',
    '...............',
    '...............',
  ],
  sanctum: [
    '.......G.......',
    '......GWG......',
    '.......G.......',
    '..KKKKKKKKKKK..',
    '..K444444443K..',
    '..KK4GGGGG3KK..',
    '...K44GGG43K...',
    '....K44433K....',
    '.....KK3KK.....',
    '......K3K......',
    '......K3K......',
    '.....KK3KK.....',
    '...KK44433KK...',
    '...K4443332K...',
    '...KKKKKKKKK...',
  ],
  fungal: [
    '.....KKKKK.....',
    '...KK44G44KK...',
    '..K44W444444K..',
    '.K444444G4443K.',
    'K4G44444444G33K',
    'K44444G4444333K',
    'KK33333333333KK',
    '.KKKKKKKKKKKKK.',
    '.....K443K.....',
    '.....K443K.....',
    '.....K443K.....',
    '....KK443KK....',
    '...K4444333K...',
    '...KKKKKKKKK...',
    '...............',
  ],
  forge: [
    '...G.......G...',
    '.....G...G.....',
    '...G..GWG..G...',
    '.......G.......',
    'KKKKKKKKKKKKK..',
    'K44444444443KKK',
    'KK44444444433K.',
    '.KK333333332K..',
    '...KK3333KK....',
    '....K3332K.....',
    '...KK3332KK....',
    '..K44444333K...',
    '..K43333322K...',
    '..KKKKKKKKKK...',
    '...............',
  ],
  frost: [
    '.......K.......',
    '.....K.4.K.....',
    '......K4K......',
    '..K....4....K..',
    '...4K..4..K4...',
    '....44.4.44....',
    '.K....444....K.',
    'K44444GWG44444K',
    '.K....444....K.',
    '....44.4.44....',
    '...4K..4..K4...',
    '..K....4....K..',
    '......K4K......',
    '.....K.4.K.....',
    '.......K.......',
  ],
  sky: [
    '.........KKK...',
    '.......KK444K..',
    '......K44443K..',
    '.....K4443K3K..',
    '....K4443K33K..',
    '...K4443K333K..',
    '..K4443K3332K..',
    '..K443K3332K...',
    '.K443K33322K...',
    '.K43K33322K....',
    'K43K3332KK.....',
    'K4K3322K.......',
    'KK322KK........',
    'K2KKK..........',
    'KK.............',
  ],
  moon: [
    '.....KKKK......',
    '...KK444K......',
    '..K4443K.......',
    '.K4443K....W...',
    '.K443K....WGW..',
    'K4443K.....W...',
    'K4433K.........',
    'K4433K.........',
    'K44333K........',
    '.K44333KK....K.',
    '.K443333KKKKK..',
    '..K4433333K....',
    '...KK33332K....',
    '.....KKKKK.....',
    '...............',
  ],
  server: [
    '...K.K.K.K.K...',
    '...K.K.K.K.K...',
    '.KKKKKKKKKKKKK.',
    'KK44444444443KK',
    '.K4KKKKKKKK33K.',
    'KK4KGG.GGGK33KK',
    '.K4K.G..G.K33K.',
    'KK4KGG.GGGK33KK',
    '.K4KKKKKKKK33K.',
    'KK433333333G3KK',
    '.KKKKKKKKKKKKK.',
    '...K.K.K.K.K...',
    '...K.K.K.K.K...',
    '...............',
    '...............',
  ],
  courtyard: [
    'K.............K',
    'KK...........KK',
    '.K4.........4K.',
    '..K4.......4K..',
    '...K4.....4K...',
    '....K4...4K....',
    '.....K4.4K.....',
    '......K4K......',
    '.....K4K4K.....',
    '...GK4K.K4KG...',
    '...GGK...KGG...',
    '..KGK.....KGK..',
    '.KKK.......KKK.',
    '.KK.........KK.',
    '...............',
  ],
};

/** The theme's sigil, 15x15, in the theme's colours (glow accents) with a hard outline. */
export function sigil(theme: string, tone: 'theme' | 'gold' | 'emboss' = 'theme'): Px {
  const t = artTheme(theme), pal = themePal(t);
  const rows = SIGILS[t] ?? SIGILS.catacombs!;
  const base = tone === 'gold' ? GOLD : tone === 'emboss' ? pal.wax : R(mixRGB(pal.glow, 0, 0.75), mixRGB(pal.glow, 0, 0.5), mixRGB(pal.glow, 0, 0.2), pal.glow, mixRGB(pal.glow, 0xffffff, 0.6));
  const px = new Px(FA.SIGIL, FA.SIGIL);
  const g = tone === 'emboss' ? pal.wax[4]! : mixRGB(pal.glow2, 0xffffff, 0.2);
  map(px, 0, 0, rows, {
    K: tone === 'emboss' ? pal.wax[0]! : K, '1': base[0]!, '2': base[1]!, '3': base[2]!, '4': base[3]!,
    G: g, W: tone === 'emboss' ? pal.wax[4]! : 0xffffff,
  });
  return px;
}

// ---------------------------------------------------------------------------------------------------------------
// the frame: a 36px 9-slice tile, 12px borders (rim, themed band, inner trim, shadow)
// ---------------------------------------------------------------------------------------------------------------

interface BandCtx { x: number; y: number; i: number; along: number; light: boolean; across: boolean }

/** Theme band texture: i = row inside the 5px band (0 outer .. 4 inner), along = coordinate along the edge. */
function bandPixel(theme: string, pal: ThemePal, c: BandCtx): RGB {
  const { x, y, i, along, light } = c;
  const n = hash(x, y, 17);
  const s = pal.stone, a = pal.alt, t = pal.trim;
  switch (theme) {
    case 'catacombs': {
      // brick courses, offset joints, worn top
      if (along % 7 === 0 || (i === 2 && along % 7 !== 0 && false)) return s[0]!;
      if (i === 0) return light ? s[4]! : s[3]!;
      if (i === 4) return s[1]!;
      return n < 0.18 ? s[1]! : n > 0.86 ? s[4]! : light ? s[3]! : s[2]!;
    }
    case 'flooded': {
      const run = Math.floor(hash(along, 3, 5) * 6);
      if (hash(along, 1, 9) > 0.55 && i <= run) return i === 0 ? t[4]! : n < 0.5 ? t[3]! : t[2]!;
      if (i === 0) return light ? s[4]! : s[3]!;
      return n < 0.2 ? s[1]! : n > 0.9 ? s[4]! : s[2]!;
    }
    case 'ossuary': {
      // femurs laid end to end: knobbed ends, shaft between, dark crypt behind
      const k = along % 9;
      if (k === 8) return t[1]!;
      const knob = k <= 1 || k >= 6;
      if (knob) return i === 0 || i === 4 ? (k === 0 || k === 7 ? t[2]! : a[i === 0 ? 3 : 1]!) : a[i === 1 ? 4 : i === 2 ? 3 : 2]!;
      if (i === 0 || i === 4) return t[1]!;
      return a[i === 1 ? 4 : i === 2 ? 3 : 1]!;
    }
    case 'sanctum': {
      // a gold arcade over red stained glass
      if (i === 0) return t[light ? 3 : 2]!;
      if (i === 4) return t[1]!;
      const k = along % 6;
      if (k === 0) return t[light ? 3 : 2]!;
      if (i === 1 && (k === 1 || k === 5)) return t[2]!;
      if (i === 1) return a[5] ?? a[4]!;
      return dither(x, y, 0.5) ? a[4]! : a[3]!;
    }
    case 'fungal': {
      const r1 = 2 + Math.round(Math.sin(along * 0.62) * 1.6);
      const r2 = 2 + Math.round(Math.sin(along * 0.62 + 2.4) * 1.6);
      if (i === r1) return a[4]!;
      if (i === r2) return a[3]!;
      if (i === 0 && n > 0.55) return t[3]!;
      if (i === 0) return s[4]!;
      return n < 0.2 ? s[1]! : n > 0.88 ? t[2]! : s[2]!;
    }
    case 'forge': {
      const k = along % 12;
      if (k === 0) return i === 0 || i === 4 ? s[0]! : a[3 + (i % 2)]!;   // molten seam between plates
      if ((k === 3 || k === 9) && i === 1) return t[4]!;
      if ((k === 4 || k === 10) && i === 1) return t[2]!;
      if ((k === 3 || k === 9) && i === 2) return t[2]!;
      if ((k === 4 || k === 10) && i === 2) return t[0]!;
      if (i === 0) return light ? t[3]! : t[2]!;
      if (i === 4) return s[1]!;
      return n < 0.15 ? s[3]! : light ? t[2]! : t[1]!;
    }
    case 'frost': {
      const crust = 1 + Math.floor(hash(along, 2, 7) * 3);
      if (i < crust) return n > 0.92 ? 0xffffff : i === 0 ? a[4]! : a[3]!;
      if (i === crust) return a[2]!;
      return (along + i * 2) % 9 === 0 ? a[1]! : n < 0.25 ? s[2]! : s[3]!;
    }
    case 'sky': {
      if (i === 2) return along % 4 === 0 ? t[1]! : t[light ? 3 : 2]!;
      if (i === 0) return light ? s[4]! : s[3]!;
      if (i === 4) return s[1]!;
      return n < 0.2 ? s[2]! : s[3]!;
    }
    case 'moon': {
      const k = along % 11, cxk = 5 + Math.floor(hash(Math.floor(along / 11), 4, 2) * 2);
      const dd = (k - cxk) ** 2 + (i - 2) ** 2;
      if (dd <= 1) return s[1]!;
      if (dd <= 3) return k < cxk ? s[0]! : s[4]!;
      if (i === 0) return light ? t[3]! : t[2]!;
      return n < 0.2 ? s[1]! : n > 0.85 ? s[4]! : s[2]!;
    }
    case 'server': {
      if (i === 0) return t[light ? 3 : 2]!;
      if (i === 4) return s[0]!;
      if ((i === 1 || i === 3) && hash(Math.floor(along / 5), i, 3) > 0.35) return i === 1 ? a[1]! : a[0]!;
      if (i === 2 && along % 6 === 3) return hash(along, 9, 1) > 0.5 ? pal.glow : pal.glow2;
      return s[1]!;
    }
    case 'courtyard': {
      // weathered wood planks with brass nails
      if (along % 10 === 0) return t[0]!;
      if (i === 1 && along % 10 === 5) return t[4]!;
      if (i === 0) return t[light ? 3 : 2]!;
      return n < 0.25 ? t[1]! : t[2]!;
    }
  }
  return s[2]!;
}

/** The themed card frame: 36x36 tile, 12px slice. */
export function frameTile(theme: string): Px {
  const t = artTheme(theme), pal = themePal(t);
  const S = FA.TILE, px = new Px(S, S), tr = pal.trim;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dl = x, dt = y, dr = S - 1 - x, db = S - 1 - y;
    const d = Math.min(dl, dt, dr, db);
    if (d >= FA.SLICE) continue;
    const cx = Math.min(dl, dr), cy = Math.min(dt, db);
    if (cx + cy <= 2) continue;
    if (cx + cy === 3) { px.p(x, y, K); continue; }
    const light = d === dt || d === dl;
    const across = d === dt || d === db;
    const along = across ? x : y;
    let c: RGB;
    switch (d) {
      case 0: c = K; break;
      case 1: c = light ? tr[4]! : tr[1]!; break;
      case 2: c = light ? tr[3]! : tr[2]!; break;
      case 3: c = K; break;
      case 4: case 5: case 6: case 7: case 8: c = bandPixel(t, pal, { x, y, i: d - 4, along, light, across }); break;
      case 9: c = light ? tr[3]! : tr[1]!; break;
      case 10: c = K; break;
      default: px.p(x, y, 0x000000, light ? 0.55 : 0.3); continue;
    }
    px.p(x, y, c);
  }
  // corner bosses (the big corner sprites cover these on the card; they show on mini cards)
  for (const [bx, by] of [[5.5, 5.5], [S - 5.5, 5.5], [5.5, S - 5.5], [S - 5.5, S - 5.5]] as const) stud(px, bx, by, 3.5, tr, R(mixRGB(pal.glow, 0, 0.6), pal.glow, mixRGB(pal.glow, 0xffffff, 0.6)));
  return px;
}

/** Dark text-panel texture: 32x32 tile in the theme's panel ramp (stays under 6% luminance for text contrast). */
export function panelTile(theme: string): Px {
  const t = artTheme(theme), pal = themePal(t), p = pal.panel;
  const S = FA.PANEL, px = new Px(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = hash(x, y, 31), m = hash(Math.floor(x / 4), Math.floor(y / 4), 7);
    let c = ramp(p, clamp01(0.25 + m * 0.4 + (n - 0.5) * 0.3), x, y);
    switch (t) {
      case 'catacombs': if (y % 8 === 0 || (x + (Math.floor(y / 8) % 2) * 8) % 16 === 0) c = p[0]!; break;   // faint brick
      case 'sanctum': if (Math.abs(((x * 0.6 + y) % 23) - 11) < 0.6) c = p[3]!; break;                         // marble veins
      case 'server': if ((y % 8 === 3 && x % 16 < 11) || (x % 16 === 11 && y % 8 >= 3)) c = p[3]!; break;      // faint traces
      case 'moon': case 'sky': if (n > 0.985) c = mixRGB(p[3]!, 0xffffff, t === 'moon' ? 0.18 : 0.08); break;    // a few stars
      case 'fungal': if (n > 0.992) c = mixRGB(p[3]!, pal.glow, 0.25); break;
      case 'forge': if (n > 0.993) c = mixRGB(p[3]!, pal.glow, 0.3); break;
      case 'frost': if ((x + y * 3) % 29 === 0) c = p[3]!; break;
      case 'ossuary': if (n > 0.97) c = p[3]!; break;
    }
    px.p(x, y, c);
  }
  return px;
}

/** The crest medallion: a rarity-metal ring with the theme sigil set inside. `prism` 0..3 = mythic shimmer frame. */
export function medallion(theme: string, rarity: Rarity, prism = -1): Px {
  const S = FA.MEDAL, px = new Px(S, S), c = S / 2;
  const metal = RARITY_METAL[rarity].r;
  const pal = themePal(theme);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x + 0.5 - c, dy = y + 0.5 - c, r = Math.hypot(dx, dy);
    if (r > 13.5) continue;
    const lit = clamp01(0.5 - (dx + dy) / (r * 2.4 + 0.001));
    let col: RGB;
    if (r > 12.6) col = K;
    else if (r > 10.4) col = ramp(metal, lit * 1.15, x, y);
    else if (r > 9.6) col = K;
    else col = ramp(R(mixRGB(pal.panel[0]!, pal.glow, 0.05), mixRGB(pal.panel[2]!, pal.glow, 0.12), mixRGB(pal.panel[3]!, pal.glow, 0.22)), clamp01(0.7 - r / 12 - (dx + dy) / 40), x, y);
    px.p(x, y, col);
  }
  // rarity gems at the cardinal points
  const gem = prism >= 0 ? PRISM[prism % 4]! : RARITY_METAL[rarity].gem;
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 - Math.PI / 2;
    stud(px, c + Math.cos(a) * 11.5, c + Math.sin(a) * 11.5, 2.5, metal, gem);
  }
  if (prism >= 0) {
    // a glint travelling round the ring
    const a0 = (prism / 4) * Math.PI * 2;
    for (let s = -0.35; s <= 0.35; s += 0.05) { const a = a0 + s; px.p(c + Math.cos(a) * 11.4, c + Math.sin(a) * 11.4, 0xffffff); }
  }
  px.blit(sigil(theme), Math.floor(c - FA.SIGIL / 2), Math.floor(c - FA.SIGIL / 2));
  return px;
}

// ---------------------------------------------------------------------------------------------------------------
// corner ornaments: 32x32, the card's corner point at (8, 8) for the top pieces (TL; TR is the mirror) and at (8, 23)
// for the bottom pieces (BL; BR is the mirror). Animated themes draw CORNER_FRAMES frames (flames, eyes, LEDs, kelp).
// ---------------------------------------------------------------------------------------------------------------

export const CORNER_FRAMES = 4;

/** Metal L bracket hugging a corner (top: card corner at (8,8); bottom: at (8,23)). */
function bracket(px: Px, metal: Ramp, bottom: boolean, len = 18) {
  const part = new Px(32, 32);
  const y0 = bottom ? 23 : 8;
  const sy = bottom ? -1 : 1;
  const tone = (w: number) => (w === 0 ? metal[3]! : w === 3 ? metal[0]! : w === 1 ? metal[2]! : metal[1]!);
  for (let k = 0; k < len; k++) for (let w = 0; w < 4; w++) {
    part.p(6 + k, y0 - 2 * sy + w * sy, tone(w));
    part.p(6 + w, y0 - 2 * sy + k * sy, tone(w));
  }
  layer(px, part);
  rivet(px, 7, bottom ? 19 : 11, metal); rivet(px, 15, bottom ? 21 : 7, metal);
}

const CANDLE_WAX = R(0x8a7a6a, 0xc8b8a0, 0xe8dcc4, 0xfff8ea, 0xffffff);

function cornerArt(theme: string, bottom: boolean, f: number): Px {
  const t = artTheme(theme), pal = themePal(t);
  const px = new Px(FA.CORNER, FA.CORNER);
  const g = pal.glow, g2 = pal.glow2;
  const pulse = [0.55, 0.8, 1, 0.8][f % 4]!;
  switch (t) {
    case 'catacombs': {
      if (!bottom) {
        const bones = new Px(32, 32);
        bone(bones, 3, 22, 22, 3, pal.alt);
        bone(bones, 4, 4, 24, 24, pal.alt);
        layer(px, bones);
        const sk = new Px(32, 32);
        skull(sk, 6, 6, pal.alt, mixRGB(0x2a0a04, g, pulse * 0.8));
        layer(px, sk);
      } else {
        bracket(px, pal.trim, true, 16);
        const c = new Px(32, 32);
        candle(c, 9, 20, 11, CANDLE_WAX, g, f);
        candle(c, 15, 20, 7, CANDLE_WAX, g, f + 2);
        for (let x = 6; x < 19; x++) c.p(x, 21, x % 3 ? 0xe8dcc4 : 0xc8b8a0);   // the wax puddle running over the frame
        c.p(7, 22, 0xe8dcc4); c.p(12, 22, 0xc8b8a0); c.p(12, 23, 0xc8b8a0); c.p(17, 22, 0xe8dcc4);
        layer(px, c);
        const sk = new Px(32, 32);
        skull(sk, 18, 15, pal.alt, null, 'sm');
        layer(px, sk);
      }
      break;
    }
    case 'flooded': {
      if (!bottom) {
        const cap = new Px(32, 32);
        orb(cap, 11, 11, 8, 7, pal.trim);
        layer(px, cap);
        barnacle(px, 5, 5, pal.stone); barnacle(px, 12, 3, pal.stone); barnacle(px, 3, 12, pal.stone);
        const k = new Px(32, 32);
        kelp(k, 10, 16, 15, f * 0.9, pal.alt);
        kelp(k, 21, 13, 11, f * 0.9 + 1.7, pal.alt);
        kelp(k, 15, 15, 7, f * 0.9 + 3, pal.alt);
        layer(px, k);
        const dy = [0, 2, 4, 6][f % 4]!;   // a drip falling from the kelp
        px.p(21, 25 + dy, mixRGB(g2, 0xffffff, 0.3)); if (dy < 6) px.p(21, 26 + dy, g, 0.7);
      } else {
        const rock = new Px(32, 32);
        orb(rock, 11, 23, 10, 6, pal.stone);
        layer(px, rock);
        const sh = new Px(32, 32);   // a conch shell
        orb(sh, 16, 18, 5, 4, R(0x3e1e10, 0x6a3418, 0x9a5428, 0xc07a40, 0xf0b070));
        for (let k = 0; k < 4; k++) sh.p(13 + k * 2, 18 - (k % 2), 0x3e1e10);
        sh.p(21, 17, 0xf0b070); sh.p(22, 16, 0xc07a40);
        layer(px, sh);
        barnacle(px, 3, 17, pal.stone); barnacle(px, 7, 21, pal.trim);
        const k2 = new Px(32, 32);
        kelp(k2, 4, 6, 12, f * 0.9 + 0.5, pal.alt);
        layer(px, k2);
        const b = (f * 3) % 12;   // bubbles rising from the shell
        px.p(19, 13 - b, g2); px.p(18, 12 - b, g, 0.6);
        if (b > 4) px.p(22, 18 - b, g2);
      }
      break;
    }
    case 'ossuary': {
      const eye = mixRGB(0x10202a, g, pulse);
      if (!bottom) {
        const bones = new Px(32, 32);
        bone(bones, 2, 21, 21, 2, pal.alt);
        bone(bones, 3, 3, 25, 25, pal.alt);
        layer(px, bones);
        const spine = new Px(32, 32);   // vertebrae trailing along both edges
        for (let k = 0; k < 4; k++) { orb(spine, 21 + k * 3, 9, 1.6, 2, pal.alt); orb(spine, 9, 21 + k * 3, 2, 1.6, pal.alt); }
        layer(px, spine);
        const sk = new Px(32, 32);
        skull(sk, 6, 5, pal.stone, eye);
        layer(px, sk);
      } else {
        const pile = new Px(32, 32);
        bone(pile, 2, 24, 22, 20, pal.alt);
        bone(pile, 4, 19, 20, 25, pal.alt);
        layer(px, pile);
        const s1 = new Px(32, 32); skull(s1, 2, 14, pal.stone, eye, 'sm'); layer(px, s1);
        const s2 = new Px(32, 32); skull(s2, 10, 15, pal.stone, eye, 'sm'); layer(px, s2);
        const s3 = new Px(32, 32); skull(s3, 6, 9, pal.stone, eye, 'sm'); layer(px, s3);
      }
      break;
    }
    case 'sanctum': {
      if (!bottom) {
        const sp = new Px(32, 32);   // a gilded gothic pinnacle rising from the corner
        for (let y = 0; y < 13; y++) {
          const half = Math.max(0, Math.floor((y - 1) / 3));
          for (let x = -half; x <= half; x++) sp.p(10 + x, y, ramp(pal.trim, clamp01(0.75 - x * 0.12 - y * 0.01), 10 + x, y));
          if (y > 2 && y % 3 === 0) { sp.p(10 - half - 1, y, pal.trim[3]!); sp.p(10 + half + 1, y, pal.trim[2]!); }   // crockets
        }
        for (let y = 12; y < 22; y++) for (let x = 4; x < 17; x++) sp.p(x, y, ramp(pal.stone, clamp01(0.8 - (x - 4) * 0.03 - (y - 12) * 0.02), x, y));
        const br = new Px(32, 32);   // a gilded bracket along the top edge
        for (let x = 16; x < 30; x++) { br.p(x, 9, pal.trim[3]!); br.p(x, 10, pal.trim[1]!); }
        for (let x = 22; x < 27; x++) br.p(x, 8, pal.trim[2]!);
        layer(px, br);
        layer(px, sp);
        // the base block's stained-glass lancet
        for (let y = 14; y < 20; y++) for (let x = 8; x < 13; x++) if (!(y === 14 && (x === 8 || x === 12))) px.p(x, y, (x + y) % 2 ? pal.alt[4]! : mixRGB(pal.alt[3]!, g, pulse * 0.3));
        for (let y = 15; y < 20; y++) px.p(10, y, pal.trim[2]!);
        px.p(10, 14, pal.trim[3]!);
        glint(px, 10, 0, pal.trim[4]!, 0);
        stud(px, 10, 23, 2.5, pal.trim, R(pal.alt[2]!, pal.alt[4]!, 0xffd0c0));
      } else {
        const base = new Px(32, 32);
        for (let x = 3; x < 22; x++) { base.p(x, 21, pal.trim[3]!); base.p(x, 22, pal.trim[2]!); base.p(x, 23, pal.trim[1]!); }
        for (let x = 6; x < 19; x++) base.p(x, 20, pal.trim[2]!);
        layer(px, base);
        const wax = R(0x3a080c, 0x5e1016, 0x84202a, 0xb04048, 0xe86060);
        const c = new Px(32, 32);
        candle(c, 8, 19, 12, wax, g2, f);
        candle(c, 13, 19, 8, wax, g2, f + 1);
        candle(c, 18, 19, 5, wax, g2, f + 3);
        layer(px, c);
        px.p(9, 21, wax[3]!); px.p(9, 22, wax[2]!); px.p(14, 21, wax[3]!); px.p(14, 22, wax[3]!); px.p(14, 23, wax[2]!);
      }
      break;
    }
    case 'fungal': {
      const cap = (k: number) => (k % 2 ? g2 : g);
      const glowCap = (c: RGB) => mixRGB(mixRGB(c, 0x000000, 0.3), c, pulse);
      if (!bottom) {
        const roots = new Px(32, 32);
        stroke(roots, [[2, 24], [6, 14], [9, 8], [16, 5], [27, 4]], 2.2, pal.alt);
        stroke(roots, [[8, 28], [9, 18], [13, 11], [20, 9]], 1.6, pal.alt);
        layer(px, roots);
        const m = new Px(32, 32);
        mushroom(m, 6, 11, 4, 3, glowCap(cap(0)), pal.alt);
        mushroom(m, 18, 8, 3, 2, glowCap(cap(1)), pal.alt);
        layer(px, m);
        for (const [x, y] of [[4, 4], [24, 13], [13, 2]] as const) if ((x + y + f) % 3) px.p(x, y - (f % 2), cap(x), 0.9);
      } else {
        const moss = new Px(32, 32);
        orb(moss, 11, 23, 10, 4, pal.trim);
        layer(px, moss);
        const m = new Px(32, 32);
        mushroom(m, 8, 21, 11, 5, glowCap(cap(0)), pal.alt);
        mushroom(m, 16, 22, 6, 3, glowCap(cap(1)), pal.alt);
        mushroom(m, 3, 22, 4, 2, glowCap(cap(2)), pal.alt);
        layer(px, m);
        for (let k = 0; k < 3; k++) { const yy = 6 - ((f * 2 + k * 3) % 6); px.p(6 + k * 5, yy, cap(k), 0.85); }
      }
      break;
    }
    case 'forge': {
      const hot = (k: number) => [pal.alt[3]!, pal.alt[4]!, pal.alt[5]!, pal.alt[4]!][(f + k) % 4]!;
      if (!bottom) {
        const horn = new Px(32, 32);
        for (let k = 0; k < 13; k++) {
          const tt = k / 12, x = 9 - tt * 8 + Math.sin(tt * 2.6) * 2, y = 9 - tt * 8.5;
          const r = 2.6 * (1 - tt) + 0.5;
          orb(horn, x, y, r, r, R(0x0d0b0d, 0x252125, 0x4c4448, 0x6e6468, 0xa09498));
        }
        layer(px, horn);
        const plate = new Px(32, 32);
        for (let y = 5; y < 22; y++) for (let x = 5; x < 22; x++) {
          if (x + y > 34 || (x > 10 && y > 10)) continue;
          plate.p(x, y, ramp(pal.trim, clamp01(0.7 - (x + y) * 0.012), x, y));
        }
        layer(px, plate);
        rivet(px, 7, 7, pal.trim); rivet(px, 15, 6, pal.trim); rivet(px, 6, 15, pal.trim); rivet(px, 19, 7, pal.trim); rivet(px, 7, 19, pal.trim);
        for (const [x, y, k] of [[9, 9, 0], [10, 10, 1], [10, 11, 2], [9, 12, 3], [9, 13, 1], [11, 9, 2], [12, 8, 3], [13, 8, 0]] as const) px.p(x, y, hot(k));   // a molten crack
        px.p(1, 1, hot(2)); px.p(2, 1, hot(1), 0.6); px.p(1, 2, hot(1), 0.6);   // the horn's glowing tip
      } else {
        const plate = new Px(32, 32);
        for (let y = 12; y < 26; y++) for (let x = 4; x < 22; x++) {
          if (x > 10 && y < 19) continue;
          plate.p(x, y, ramp(pal.trim, clamp01(0.65 - (y - 12) * 0.02), x, y));
        }
        layer(px, plate);
        rivet(px, 6, 14, pal.trim); rivet(px, 6, 22, pal.trim); rivet(px, 15, 22, pal.trim);
        const coals = new Px(32, 32);   // glowing coals on the bracket's lip
        for (let k = 0; k < 6; k++) orb(coals, 12 + k * 2, 17 - (k % 2), 1.6, 1.4, R(0x2a1008, 0x5a2008, 0x8a3a10, 0xc06020));
        layer(px, coals);
        for (let k = 0; k < 6; k++) px.p(12 + k * 2, 16 - (k % 2), hot(k));
        for (let k = 0; k < 2; k++) { const yy = 12 - ((f * 3 + k * 5) % 11); px.p(14 + k * 5, yy, pal.alt[5]!); }
      }
      break;
    }
    case 'frost': {
      const ice = pal.alt;
      const spark = (x: number, y: number, k: number) => { if ((f + k) % 4 === 0) sparkle(px, x, y, g2); };
      if (!bottom) {
        const sh = new Px(32, 32);
        shard(sh, 10, 10, 11, 2.6, -1, -1, ice);
        shard(sh, 13, 9, 9, 2, 0.15, -1, ice);
        shard(sh, 9, 13, 9, 2, -1, 0.15, ice);
        shard(sh, 17, 8, 6, 1.6, 0.6, -1, ice);
        layer(px, sh);
        const ic = new Px(32, 32);
        for (const [x, len] of [[14, 7], [17, 11], [20, 6], [23, 9], [27, 5]] as const) icicle(ic, x, 19, len, ice);
        for (const [y, len] of [[24, 4], [28, 3]] as const) icicle(ic, 19, y, len, ice);
        layer(px, ic);
        spark(4, 4, 0); spark(14, 3, 1); spark(3, 14, 2); spark(17, 28, 3);
      } else {
        const snow = new Px(32, 32);
        orb(snow, 12, 24, 11, 4, R(0x8a9ab0, 0xb8c8dc, 0xe0ecf8, 0xf4faff, 0xffffff));
        layer(px, snow);
        const sh = new Px(32, 32);
        shard(sh, 8, 22, 14, 2.6, -0.25, -1, ice);
        shard(sh, 13, 22, 9, 2, 0.4, -1, ice);
        shard(sh, 4, 22, 7, 1.6, -0.6, -1, ice);
        layer(px, sh);
        spark(5, 9, 0); spark(15, 12, 2); spark(2, 16, 1);
      }
      break;
    }
    case 'sky': {
      if (!bottom) {
        // a small wing sweeping out to the upper left: long primaries under a row of gold-edged coverts
        const flutter = [0, 0.05, 0.09, 0.05][f % 4]!;
        wing(px, 15, 15, 5, 3, 5, 7, 13, 1.75 + flutter, 2.75 + flutter, pal.alt, pal.trim[3]!, R(pal.trim[1]!, pal.trim[2]!, pal.trim[3]!, pal.trim[4]!));
        stud(px, 15, 15, 3.5, pal.trim, R(0x1a4a8a, 0x7ab4e8, 0xe0f4ff));
      } else {
        for (let k = 0; k < 6; k++) { px.p(20 + k, 14 - k, pal.trim[3]!); px.p(21 + k, 14 - k, pal.trim[1]!); }   // a gold ray
        const c = new Px(32, 32);
        cloud(c, 12, 21, 20, R(0x7a8aa4, 0xaab8cc, 0xdce6f2, 0xf6faff, 0xffffff));
        layer(px, c);
        if (f % 2) glint(px, 25, 9, pal.trim[4]!, 1);
      }
      break;
    }
    case 'moon': {
      const tw = (x: number, y: number, k: number, big = false) => { if ((f + k) % 4 < 2) sparkle(px, x, y, g, big); else px.p(x, y, mixRGB(g, 0, 0.3)); };
      if (!bottom) {
        const m = new Px(32, 32);
        crescent(m, 11, 11, 9, pal.trim, 0.45);
        layer(px, m);
        tw(23, 4, 0, true); tw(3, 23, 2); tw(27, 14, 1); tw(16, 24, 3);
      } else {
        const mast = new Px(32, 32);   // the outpost's antenna with its red beacon
        for (let y = 5; y < 19; y++) mast.p(17, y, pal.trim[y % 3 === 0 ? 3 : 2]!);
        line(mast, 14, 18, 17, 9, pal.trim[1]!); line(mast, 20, 18, 17, 9, pal.trim[1]!);
        layer(px, mast);
        const rock = new Px(32, 32);
        orb(rock, 12, 22, 11, 5, pal.stone);
        layer(px, rock);
        for (const [x, y, c] of [[8, 21, pal.stone[0]!], [9, 21, pal.stone[0]!], [10, 21, pal.stone[1]!], [8, 22, pal.stone[1]!], [11, 22, pal.stone[4]!], [10, 23, pal.stone[4]!]] as const) px.p(x, y, c);
        if (f % 4 < 2) glint(px, 17, 4, g2, 1); else px.p(17, 4, mixRGB(g2, 0, 0.6));
        tw(5, 8, 1);
      }
      break;
    }
    case 'server': {
      const a = pal.alt;
      const ledOn = (k: number) => ((k * 5 + f * 3) % 7) < 4;
      if (!bottom) {
        const blk = new Px(32, 32);
        for (let y = 4; y < 18; y++) for (let x = 4; x < 18; x++) blk.p(x, y, ramp(pal.stone, clamp01(0.6 - (x + y) * 0.01), x, y));
        layer(px, blk);
        for (let k = 0; k < 4; k++) { px.p(5 + k * 4, 2, pal.trim[3]!); px.p(2, 5 + k * 4, pal.trim[3]!); px.p(5 + k * 4, 1, pal.trim[2]!); px.p(1, 5 + k * 4, pal.trim[2]!); }   // pins
        trace(px, [[7, 7], [7, 12], [12, 12]], a[2]!, g);
        trace(px, [[10, 6], [15, 6], [15, 10]], a[2]!, g2);
        trace(px, [[18, 10], [29, 10]], a[1]!, ledOn(1) ? g : a[1]!);
        trace(px, [[10, 18], [10, 29]], a[1]!, ledOn(2) ? g2 : a[1]!);
        led(px, 6, 15, g, ledOn(0)); led(px, 9, 15, g2, ledOn(3)); led(px, 12, 15, g, ledOn(4));
      } else {
        const cab = new Px(32, 32);   // a drooping red cable
        stroke(cab, [[18, 14], [22, 9], [24, 4]], 2, R(0x200608, 0x40100e, 0x6a1c18, 0x983028, 0xc04c40));
        layer(px, cab);
        const blk = new Px(32, 32);
        for (let y = 14; y < 26; y++) for (let x = 3; x < 22; x++) blk.p(x, y, ramp(pal.stone, clamp01(0.55 - (y - 14) * 0.02), x, y));
        layer(px, blk);
        for (let k = 0; k < 5; k++) { px.p(6 + k * 3, 13, pal.trim[4]!); px.p(6 + k * 3, 12, pal.trim[2]!); }
        led(px, 5, 17, g, ledOn(1)); led(px, 8, 17, g, ledOn(2)); led(px, 11, 17, g2, ledOn(5));
        for (let x = 5; x < 20; x += 2) px.p(x, 21, 0x040508);
      }
      break;
    }
    case 'courtyard': {
      if (!bottom) {
        bracket(px, pal.trim, false, 20);
        const pen = new Px(32, 32);
        for (let y = 0; y < 10; y++) for (let x = 0; x < 9 - y; x++) pen.p(13 + x + Math.round(Math.sin((y + f) * 0.8) * 0.6), 12 + y, x === 0 ? 0x5a0a10 : y === 0 ? 0xff8a6a : 0xac1d29);
        layer(px, pen);
      } else {
        const grass = new Px(32, 32);
        for (let k = 0; k < 9; k++) { const x = 3 + k * 2, h = 4 + ((k * 7) % 5); for (let y = 0; y < h; y++) grass.p(x + (y > h / 2 ? (k % 2 ? 1 : -1) : 0), 24 - y, pal.alt[2 + (y % 2)]!); }
        layer(px, grass);
      }
      break;
    }
  }
  return px;
}

/** A corner piece as a horizontal strip of CORNER_FRAMES frames (32 * frames x 32). */
export function cornerStrip(theme: string, which: 'top' | 'bottom'): Px {
  const out = new Px(FA.CORNER * CORNER_FRAMES, FA.CORNER);
  for (let f = 0; f < CORNER_FRAMES; f++) out.blit(cornerArt(theme, which === 'bottom', f), f * FA.CORNER, 0);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// crest: FA.CREST_W x FA.CREST_H, centred on the card's top edge (which runs along row FA.CREST_RISE). The rarity
// medallion (FA.MEDAL) sits on top of it, centred at (56, 22). Drawn as a left half and mirrored, plus extras.
// ---------------------------------------------------------------------------------------------------------------

function crestArt(theme: string, f: number): Px {
  const t = artTheme(theme), pal = themePal(t);
  const W = FA.CREST_W, H = FA.CREST_H, top = FA.CREST_RISE;
  const px = new Px(W, H);
  const g = pal.glow, g2 = pal.glow2;
  const pulse = [0.55, 0.8, 1, 0.8][f % 4]!;
  const after: ((p: Px) => void)[] = [];
  switch (t) {
    case 'catacombs': {
      // a stepped brick pediment behind the medallion, a bone laid along the card's top, candles on the steps
      const ped = new Px(W, H);
      for (let y = 4; y < top + 4; y++) for (let x = 24; x < 56; x++) {
        const step = Math.floor((x - 24) / 6);
        if (y < top - 4 - step * 4) continue;
        const brick = (y % 4 === 0) || ((x + (Math.floor(y / 4) % 2) * 3) % 6 === 0);
        ped.p(x, y, brick ? pal.stone[0]! : ramp(pal.stone, clamp01(0.75 - (y - 4) * 0.012 + hash(x, y, 3) * 0.2 - 0.1), x, y));
      }
      layer(px, ped);
      for (let s = 0; s < 6; s++) for (let x = 24 + s * 6; x < 30 + s * 6; x++) { const y = top - 4 - s * 4; px.p(x, y, pal.trim[4]!); px.p(x, y + 1, pal.trim[2]!); }
      const bn = new Px(W, H);
      bone(bn, 4, top + 2, 40, top + 1, pal.alt);
      layer(px, bn);
      const c = new Px(W, H);
      candle(c, 26, top - 5, 9, CANDLE_WAX, g, f);
      candle(c, 13, top - 1, 6, CANDLE_WAX, g, f + 2);
      layer(px, c);
      break;
    }
    case 'flooded': {
      // a broken slate arch with kelp draping over the card's edge; barnacles and drips
      const arch = new Px(W, H);
      for (let y = 0; y < H; y++) for (let x = 0; x < 56; x++) {
        const r = Math.hypot(x + 0.5 - 56, (y + 0.5 - 40) * 1.15);
        if (r < 30 || r > 38 || y > top + 2 || x < 18) continue;
        if (x < 24 && y < 14) continue;   // the broken end
        arch.p(x, y, ramp(pal.stone, clamp01(0.85 - (r - 30) / 10 + hash(x, y, 2) * 0.2 - 0.1), x, y));
      }
      layer(px, arch);
      for (const [x, y] of [[26, 13], [33, 6], [41, 3]] as const) barnacle(px, x, y, pal.trim);
      const k = new Px(W, H);
      kelp(k, 22, 14, 22, f * 0.9, pal.alt);
      kelp(k, 30, 9, 26, f * 0.9 + 1.4, pal.alt);
      kelp(k, 39, 5, 18, f * 0.9 + 2.8, pal.alt);
      layer(px, k);
      const dy = [0, 3, 6, 9][f % 4]!;
      px.p(31, 35 + dy, mixRGB(g2, 0xffffff, 0.3)); px.p(23, 37 + ((dy + 4) % 8), g2);
      break;
    }
    case 'ossuary': {
      // a ribcage arch: curved ribs fanning from behind the medallion; a skull watches from above
      const ribs = new Px(W, H);
      for (let k = 0; k < 5; k++) {
        const pts: [number, number][] = [];
        for (let s = 0; s <= 10; s++) {
          const u = s / 10;
          const x = 50 - u * (26 + k * 4), y = 8 + k * 4 + Math.sin(u * Math.PI * 0.9) * -6 + u * u * (10 - k);
          pts.push([x, y]);
        }
        stroke(ribs, pts, 2.2 - k * 0.15, pal.alt);
      }
      layer(px, ribs);
      after.push((p) => {
        const sk = new Px(W, H);
        skull(sk, 51, -1, pal.stone, mixRGB(0x10202a, g, pulse));
        sk.outline(K);
        p.blit(sk, 0, 0);
      });
      break;
    }
    case 'sanctum': {
      // a marble gable with gold crockets rising to a finial; a flanking pinnacle; red glass lancets
      const gab = new Px(W, H);
      for (let y = 2; y < top + 3; y++) for (let x = 22; x < 56; x++) {
        if (x < 56 - (y - 2) * 1.45) continue;
        gab.p(x, y, ramp(pal.stone, clamp01(0.85 - (56 - x) * 0.008 - y * 0.006), x, y));
      }
      layer(px, gab);
      for (let y = 2; y < top + 3; y++) { const x = Math.round(56 - (y - 2) * 1.45); px.p(x, y, pal.trim[3]!); px.p(x + 1, y, pal.trim[2]!); if (y % 4 === 0) { px.p(x - 1, y, pal.trim[4]!); px.p(x - 1, y - 1, pal.trim[3]!); } }
      for (const lx of [36, 44]) for (let y = 16; y < top + 1; y++) for (let x = lx; x < lx + 4; x++) {
        if (y === 16 && (x === lx || x === lx + 3)) continue;
        px.p(x, y, x === lx || x === lx + 3 || y === 16 ? pal.trim[2]! : (x + y) % 2 ? pal.alt[4]! : mixRGB(pal.alt[3]!, g, 0.3 * pulse));
      }
      const pin = new Px(W, H);
      for (let y = 0; y < top + 4; y++) {
        const half = y < 10 ? Math.floor(y / 3) : 3;
        for (let x = -half; x <= half; x++) pin.p(14 + x, y, ramp(y < 10 ? pal.trim : pal.stone, clamp01(0.75 - x * 0.1), 14 + x, y));
      }
      layer(px, pin);
      glint(px, 14, 0, pal.trim[4]!, 0);
      const c = new Px(W, H);
      candle(c, 22, top + 1, 6, R(0x3a080c, 0x5e1016, 0x84202a, 0xb04048, 0xe86060), g2, f + 1);
      layer(px, c);
      after.push((p) => { glint(p, 55, 0, pal.trim[4]!, 1); glint(p, 56, 0, pal.trim[4]!, 0); });
      break;
    }
    case 'fungal': {
      // a great glowing cap and a smaller one, roots along the card's top, spores
      const roots = new Px(W, H);
      stroke(roots, [[2, top + 4], [14, top + 1], [30, top + 3], [50, top]], 2.4, pal.alt);
      stroke(roots, [[20, top + 2], [26, top - 4], [30, top - 10]], 2, pal.alt);
      layer(px, roots);
      const m = new Px(W, H);
      mushroom(m, 30, top - 2, 9, 10, mixRGB(mixRGB(g, 0, 0.3), g, pulse), pal.alt);
      mushroom(m, 12, top + 1, 5, 5, mixRGB(mixRGB(g2, 0, 0.3), g2, pulse), pal.alt);
      mushroom(m, 44, top - 1, 4, 3, mixRGB(mixRGB(g2, 0, 0.3), g2, pulse), pal.alt);
      layer(px, m);
      for (let k = 0; k < 4; k++) { const yy = 10 - ((f * 2 + k * 3) % 10); px.p(18 + k * 9, yy, k % 2 ? g2 : g, 0.9); }
      break;
    }
    case 'forge': {
      // great iron horns sweep up from behind the medallion over a riveted plate with molten seams
      const horn = new Px(W, H);
      for (let k = 0; k <= 24; k++) {
        const u = k / 24, x = 46 - u * 36 - Math.sin(u * Math.PI) * 2, y = 24 - u * 22 + Math.sin(u * Math.PI) * -4 + u * u * 6;
        const r = 4.2 * (1 - u) + 0.6;
        orb(horn, x, y, r, r, R(0x0d0b0d, 0x252125, 0x4c4448, 0x6e6468, 0xa09498));
      }
      layer(px, horn);
      const plate = new Px(W, H);
      for (let y = top - 6; y < top + 6; y++) for (let x = 22; x < 56; x++) {
        if (x < 22 + (top + 6 - y) * 0.8) continue;
        plate.p(x, y, ramp(pal.trim, clamp01(0.65 - (y - top) * 0.03 + hash(x, y, 4) * 0.12), x, y));
      }
      layer(px, plate);
      for (const x of [30, 38, 46]) rivet(px, x, top - 3, pal.trim);
      const hot = (k: number) => [pal.alt[3]!, pal.alt[4]!, pal.alt[5]!, pal.alt[4]!][(f + k) % 4]!;
      for (let x = 28; x < 56; x++) if (x % 5 !== 0) px.p(x, top + 2, hot(x));
      px.p(10, 4, hot(1)); px.p(11, 4, hot(2), 0.6);
      break;
    }
    case 'frost': {
      // an ice crown fanning up behind the medallion, icicles hanging over the card's top edge
      const ice = pal.alt;
      const sh = new Px(W, H);
      shard(sh, 48, 22, 20, 3.4, -0.2, -1, ice);
      shard(sh, 42, 24, 16, 3, -0.55, -1, ice);
      shard(sh, 34, 26, 13, 2.6, -0.95, -1, ice);
      shard(sh, 27, 27, 10, 2.2, -1, -0.55, ice);
      shard(sh, 20, 28, 7, 1.8, -1, -0.3, ice);
      layer(px, sh);
      after.push((p) => { const c = new Px(W, H); shard(c, 56, 20, 20, 3.6, 0, -1, ice); shard(c, 55, 20, 20, 3.6, 0, -1, ice); c.outline(K); p.blit(c, 0, 0); });
      const ic = new Px(W, H);
      for (const [x, len] of [[12, 6], [16, 10], [21, 7], [26, 12], [31, 8], [36, 11], [41, 6], [46, 9]] as const) icicle(ic, x, top + 2, len, ice);
      layer(px, ic);
      for (const [x, y, k] of [[38, 8, 0], [26, 16, 1], [46, 4, 2], [18, 24, 3]] as const) if ((f + k) % 4 === 0) sparkle(px, x, y, g2);
      break;
    }
    case 'sky': {
      // gold rays behind; a great wing of three feather rows spreading from the medallion
      for (let k = 0; k < 6; k++) {
        const a = Math.PI + 0.2 + k * 0.42;
        for (let r = 15; r < 28 + (k % 2) * 6; r++) px.p(56 + Math.cos(a) * r, 22 + Math.sin(a) * r * 0.8, k % 2 ? pal.trim[3]! : pal.trim[2]!, 0.9);
      }
      const flutter = [0, 0.03, 0.06, 0.03][f % 4]!;
      wing(px, 50, 22, 18, 7, 9, 9, 21, 1.85 + flutter, 2.7 + flutter, pal.alt, pal.trim[3]!, R(pal.alt[1]!, pal.alt[2]!, pal.alt[3]!, pal.alt[4]!, pal.trim[3]!));
      break;
    }
    case 'moon': {
      // a great crescent cradling the medallion; stars; the cold blue Earth (asymmetric, after the mirror)
      const m = new Px(W, H);
      for (let y = 0; y < H; y++) for (let x = 0; x < 56; x++) {
        const dx = x + 0.5 - 56, dy = y + 0.5 - 24;
        const r = Math.hypot(dx, dy);
        if (r > 25 || r < 16.5 || y > top + 4) continue;
        const inner = Math.hypot(dx, dy + 4) < 19.5;
        if (inner) continue;
        m.p(x, y, ramp(pal.trim, clamp01(0.85 - (r - 16) / 14 - (dy > 0 ? 0.2 : 0)), x, y));
      }
      layer(px, m);
      for (const [x, y] of [[40, 6], [44, 9], [36, 12]] as const) { px.p(x, y, pal.stone[1]!); px.p(x + 1, y, pal.stone[2]!); }
      after.push((p) => {
        const e = new Px(W, H);
        orb(e, 14, 12, 7, 7, pal.alt, 0.1);
        for (const [x, y] of [[11, 9], [12, 9], [12, 10], [16, 13], [17, 13], [17, 14], [13, 15]] as const) e.p(x, y, 0x3e7a3a);   // continents
        e.outline(K);
        p.blit(e, 0, 0);
        const tw = (x: number, y: number, k: number) => { if ((f + k) % 4 < 2) sparkle(p, x, y, g, k === 0); else p.p(x, y, mixRGB(g, 0, 0.35)); };
        tw(96, 6, 0); tw(30, 3, 1); tw(84, 14, 2); tw(4, 24, 3); tw(106, 22, 1);
      });
      break;
    }
    case 'server': {
      // an IC chip behind the medallion; traces with LEDs run out to both sides; an antenna (after the mirror)
      const chip = new Px(W, H);
      for (let y = 8; y < top + 6; y++) for (let x = 32; x < 56; x++) chip.p(x, y, ramp(pal.stone, clamp01(0.6 - (y - 8) * 0.012 - (56 - x) * 0.004), x, y));
      layer(px, chip);
      for (let x = 34; x < 56; x += 3) { px.p(x, 6, pal.trim[4]!); px.p(x, 7, pal.trim[2]!); }
      const a = pal.alt;
      const ledOn = (k: number) => ((k * 5 + f * 3) % 7) < 4;
      trace(px, [[32, 14], [12, 14], [12, 10], [4, 10]], a[2]!, ledOn(0) ? g : a[1]!);
      trace(px, [[32, 20], [20, 20], [20, 25], [8, 25]], a[1]!, ledOn(1) ? g2 : a[1]!);
      trace(px, [[32, 26], [26, 26], [26, 30]], a[1]!, ledOn(2) ? g : a[1]!);
      for (let k = 0; k < 4; k++) led(px, 36 + k * 4, 28, k % 3 === 2 ? g2 : g, ledOn(k + 3));
      after.push((p) => {
        for (let y = 0; y < 6; y++) { p.p(55, y, pal.trim[3]!); p.p(56, y, pal.trim[1]!); }
        if (ledOn(7)) glint(p, 55, 0, g2, 1); else p.p(55, 0, mixRGB(g2, 0, 0.5));
      });
      break;
    }
    case 'courtyard': {
      const beam = new Px(W, H);
      for (let y = top - 4; y < top + 2; y++) for (let x = 6; x < 56; x++) beam.p(x, y, ramp(pal.trim, clamp01(0.7 - (y - top + 4) * 0.1 + hash(x, y, 2) * 0.15), x, y));
      layer(px, beam);
      for (const x of [10, 26, 42]) rivet(px, x, top - 3, R(0x6a4410, 0xb8862a, 0xf0cf78, 0xfff4c8));
      const pen = new Px(W, H);
      for (const [x0, col] of [[16, 0xac1d29], [34, 0xd29d3e]] as const) for (let y = 0; y < 12; y++) for (let x = 0; x < 7 - Math.floor(y / 2); x++) pen.p(x0 + x + Math.round(Math.sin((y + f) * 0.7) * 0.7), top + 2 + y, x === 0 ? mixRGB(col, 0, 0.4) : col);
      layer(px, pen);
      break;
    }
  }
  mirror(px);
  for (const fn of after) fn(px);
  return px;
}

export function crestStrip(theme: string): Px {
  const out = new Px(FA.CREST_W * CORNER_FRAMES, FA.CREST_H);
  for (let f = 0; f < CORNER_FRAMES; f++) out.blit(crestArt(theme, f), f * FA.CREST_W, 0);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// foot: FA.FOOT_W x FA.FOOT_H plinth centred on the card's bottom edge (row FA.FOOT_H - FA.FOOT_DROP), with a dark
// socket in the middle where the key numeral is written (DOM text).
// ---------------------------------------------------------------------------------------------------------------

export function footArt(theme: string): Px {
  const t = artTheme(theme), pal = themePal(t);
  const W = FA.FOOT_W, H = FA.FOOT_H, edge = H - FA.FOOT_DROP;
  const px = new Px(W, H);
  const g = pal.glow, g2 = pal.glow2;
  switch (t) {
    case 'catacombs': { const b = new Px(W, H); bone(b, 6, edge + 2, 30, edge + 3, pal.alt); layer(px, b); break; }
    case 'flooded': {
      for (const [x, y] of [[14, edge - 1], [20, edge + 1], [26, edge - 2]] as const) barnacle(px, x, y, pal.trim);
      const k = new Px(W, H); kelp(k, 9, edge, 11, 1, pal.alt); layer(px, k);
      px.p(17, edge + 9, g2); px.p(17, edge + 10, g, 0.6);
      break;
    }
    case 'ossuary': {
      const sp = new Px(W, H);
      for (let k = 0; k < 7; k++) orb(sp, 8 + k * 3.4, edge + 2, 1.8, 2.2, pal.alt);
      layer(px, sp);
      break;
    }
    case 'sanctum': {
      const s = new Px(W, H);
      stroke(s, [[30, edge], [20, edge + 2], [12, edge + 1], [8, edge - 2], [11, edge - 4], [14, edge - 2]], 2, pal.trim);
      layer(px, s);
      stud(px, 22, edge + 2, 2.5, pal.trim, R(pal.alt[2]!, pal.alt[4]!, 0xffd0c0));
      break;
    }
    case 'fungal': {
      const r = new Px(W, H); stroke(r, [[30, edge + 1], [18, edge + 3], [6, edge + 1]], 2, pal.alt); layer(px, r);
      const m = new Px(W, H); mushroom(m, 14, edge + 1, 4, 3, g, pal.alt); mushroom(m, 22, edge + 2, 3, 2, g2, pal.alt); layer(px, m);
      break;
    }
    case 'forge': {
      const ch = new Px(W, H);
      for (let k = 0; k < 4; k++) {
        const cx = 9 + k * 6, cy = edge + 2 + (k % 2);
        for (let a = 0; a < 16; a++) { const an = (a / 16) * Math.PI * 2; ch.p(cx + Math.cos(an) * (k % 2 ? 1.5 : 3), cy + Math.sin(an) * (k % 2 ? 2.4 : 1.6), a < 8 ? pal.trim[3]! : pal.trim[1]!); }
      }
      layer(px, ch);
      break;
    }
    case 'frost': {
      const ic = new Px(W, H);
      for (const [x, len] of [[8, 5], [12, 9], [16, 6], [21, 10], [26, 7]] as const) icicle(ic, x, edge + 1, len, pal.alt);
      layer(px, ic);
      break;
    }
    case 'sky': { const c = new Px(W, H); cloud(c, 18, edge + 2, 22, R(0x7a8aa4, 0xaab8cc, 0xdce6f2, 0xf6faff, 0xffffff)); layer(px, c); break; }
    case 'moon': {
      const r = new Px(W, H); orb(r, 14, edge + 3, 7, 4, pal.stone); orb(r, 25, edge + 3, 4, 3, pal.stone); layer(px, r);
      px.p(12, edge + 2, pal.stone[0]!); px.p(13, edge + 2, pal.stone[0]!); px.p(14, edge + 3, pal.stone[4]!);
      break;
    }
    case 'server': {
      const pins = new Px(W, H);
      for (let k = 0; k < 7; k++) for (let y = 0; y < 6; y++) pins.p(8 + k * 3, edge + y, y === 5 ? pal.trim[4]! : pal.trim[2]!);
      layer(px, pins);
      led(px, 4, edge, g, true);
      break;
    }
    case 'courtyard': { const gr = new Px(W, H); for (let k = 0; k < 8; k++) for (let y = 0; y < 3 + (k % 3); y++) gr.p(8 + k * 3, edge + 4 - y, pal.alt[2 + (y % 2)]!); layer(px, gr); break; }
  }
  mirror(px);
  // the socket: a carved plaque with a dark recess for the numeral
  const sock = new Px(W, H);
  const x0 = 30, x1 = W - 30;
  for (let y = 1; y < H - 2; y++) for (let x = x0; x < x1; x++) {
    const e = Math.min(x - x0, x1 - 1 - x, y - 1, H - 3 - y);
    if (e === 0 && (x === x0 || x === x1 - 1) && (y === 1 || y === H - 3)) continue;
    sock.p(x, y, e === 0 ? (y < H / 2 ? pal.trim[3]! : pal.trim[1]!) : e === 1 ? pal.trim[2]! : e === 2 ? K : pal.panel[1]!);
  }
  layer(px, sock);
  stud(px, x0 - 1, H / 2 - 1, 2.5, pal.trim, R(mixRGB(g, 0, 0.6), g, mixRGB(g, 0xffffff, 0.6)));
  stud(px, x1, H / 2 - 1, 2.5, pal.trim, R(mixRGB(g, 0, 0.6), g, mixRGB(g, 0xffffff, 0.6)));
  return px;
}

// ---------------------------------------------------------------------------------------------------------------
// fringe: an FA.FRINGE_W x FA.FRINGE_H tile repeated along the inside of the top edge (null: the theme has none)
// ---------------------------------------------------------------------------------------------------------------

export function fringeArt(theme: string): Px | null {
  const t = artTheme(theme), pal = themePal(t);
  const W = FA.FRINGE_W, H = FA.FRINGE_H;
  const px = new Px(W, H);
  switch (t) {
    case 'frost': {
      const ic = new Px(W, H);
      for (const [x, len] of [[1, 5], [4, 9], [7, 4], [10, 11], [14, 6], [17, 8], [21, 4]] as const) icicle(ic, x, 0, len, pal.alt);
      layer(px, ic);
      return px;
    }
    case 'flooded': {
      const k = new Px(W, H);
      for (const [x, len] of [[2, 6], [9, 10], [16, 5], [20, 8]] as const) kelp(k, x, 0, len, x, pal.alt);
      layer(px, k);
      px.p(13, 3, pal.glow2); px.p(13, 4, pal.glow, 0.6);
      return px;
    }
    case 'fungal': {
      const m = new Px(W, H);
      for (let x = 0; x < W; x++) { const len = 1 + Math.floor(hash(x, 1, 4) * 4) + (x % 7 === 3 ? 4 : 0); for (let y = 0; y < len; y++) m.p(x, y, pal.trim[y === 0 ? 3 : y < 2 ? 2 : 1]!); }
      layer(px, m, 0, 0, false);
      px.p(3, 7, pal.glow); px.p(15, 5, pal.glow2);
      return px;
    }
    case 'sanctum': {
      // gold lace: a little pointed arcade hanging from the top edge
      for (let x = 0; x < W; x++) {
        const k = x % 8;
        px.p(x, 0, pal.trim[3]!); px.p(x, 1, pal.trim[1]!);
        const arch = [5, 3, 2, 2, 2, 2, 3, 5][k]!;
        px.p(x, arch, pal.trim[k === 0 || k === 7 ? 2 : 3]!);
        if (k === 0) for (let y = 2; y < 7; y++) px.p(x, y, pal.trim[2]!);
        if (k === 0) px.p(x, 7, pal.trim[4]!);
      }
      return px;
    }
    case 'courtyard': {
      // bunting: alternating pennants on a cord
      for (let x = 0; x < W; x++) px.p(x, 0, 0x5a3a1a);
      for (const [x0, c] of [[1, 0xac1d29], [9, 0xd29d3e], [17, 0x3a62e4]] as const) for (let y = 1; y < 7; y++) for (let x = 0; x < 6 - (y - 1); x++) px.p(x0 + Math.floor((y - 1) / 2) + x, y, x === 0 ? mixRGB(c, 0, 0.35) : c);
      return px;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// vista: the card's art window. The real door of the destination (game/art/doors.ts) set into its own wall, with the
// theme's props and the portal's light spilling over the floor. FA.VISTA_W x FA.VISTA_H, DOOR_PORTRAIT_FRAMES frames.
// ---------------------------------------------------------------------------------------------------------------

export const VISTA_FRAMES = DOOR_PORTRAIT_FRAMES;
const FLOOR_Y = FA.VISTA_H - 7;

function vistaBackdrop(t: string, pal: ThemePal, px: Px, f: number) {
  const W = FA.VISTA_W, H = FA.VISTA_H;
  const s = pal.stone;
  const dark = (c: RGB, k = 0.45) => mixRGB(c, 0x050404, k);
  // the wall
  for (let y = 0; y < FLOOR_Y; y++) for (let x = 0; x < W; x++) {
    const n = hash(x, y, 13);
    let c: RGB;
    switch (t) {
      case 'sky': {
        // open sky: dithered bands paling toward the horizon
        const k = y / FLOOR_Y;
        c = ramp(R(0x1a3a7a, 0x2a5aa4, 0x4a86cc, 0x7ab4e8, 0xb8dcf6), clamp01(k * 1.05), x, y);
        break;
      }
      case 'moon': c = n > 0.992 ? 0xd0dcf0 : n > 0.985 ? 0x5a6478 : ramp(R(0x020308, 0x05070f, 0x0a0e1a), clamp01(y / FLOOR_Y), x, y); break;
      case 'ossuary': {
        // a wall of stacked skulls
        const cx = x % 8, cy = y % 7, row = Math.floor(y / 7);
        const sx = (x + (row % 2) * 4) % 8;
        const inSkull = (sx - 3.5) ** 2 / 12 + (cy - 3) ** 2 / 9 < 1;
        if (inSkull) {
          const eye = cy === 3 && (sx === 2 || sx === 5);
          c = eye ? 0x0a0806 : dark(ramp(pal.alt, clamp01(0.75 - cy * 0.08 - (sx - 3.5) * 0.04), x, y), 0.5);
        } else c = dark(s[0]!, 0.3);
        void cx;
        break;
      }
      case 'server': {
        // server racks: bays of LEDs and vents
        const bay = x % 32, row = y % 12;
        if (bay < 2 || bay > 29 || row === 0) c = dark(s[2]!, 0.3);
        else if (row >= 3 && row <= 4 && bay > 4 && bay < 27 && (bay % 3 === 0)) {
          const on = hash(Math.floor(x / 3) + f, Math.floor(y / 12), 5) > 0.45;
          c = on ? (hash(x, y, 2) > 0.7 ? pal.glow2 : pal.glow) : dark(s[1]!, 0.4);
        } else if (row >= 7 && row <= 9 && (x % 2 === 0)) c = 0x040508;
        else c = dark(ramp(s, 0.35 + n * 0.15, x, y), 0.35);
        break;
      }
      case 'fungal': {
        c = dark(ramp(s, clamp01(0.3 + n * 0.3 + Math.sin(x * 0.15 + y * 0.05) * 0.1), x, y), 0.4);
        break;
      }
      case 'frost': {
        const brick = y % 9 === 0 || (x + (Math.floor(y / 9) % 2) * 9) % 18 === 0;
        c = brick ? dark(s[0]!, 0.2) : dark(ramp(s, clamp01(0.45 + n * 0.25), x, y), 0.25);
        if (n > 0.985) c = pal.alt[3]!;
        break;
      }
      case 'sanctum': {
        const brick = y % 10 === 0 || (x + (Math.floor(y / 10) % 2) * 8) % 16 === 0;
        c = brick ? dark(pal.alt[0]!, 0.2) : dark(ramp(R(pal.alt[1]!, pal.alt[2]!, pal.alt[3]!), clamp01(0.35 + n * 0.3), x, y), 0.35);
        if (Math.abs(((x * 0.7 + y) % 31) - 15) < 0.5) c = dark(pal.alt[3]!, 0.2);
        break;
      }
      case 'forge': {
        const brick = y % 8 === 0 || (x + (Math.floor(y / 8) % 2) * 7) % 14 === 0;
        c = brick ? 0x060405 : dark(ramp(s, clamp01(0.4 + n * 0.3), x, y), 0.15);
        break;
      }
      case 'courtyard': {
        const k = y / FLOOR_Y;
        c = y < FLOOR_Y * 0.55 ? ramp(R(0x4a86cc, 0x7ab4e8, 0xb8dcf6), clamp01(k * 1.6), x, y) : dark(ramp(s, clamp01(0.4 + n * 0.3), x, y), 0.2);
        break;
      }
      default: {
        const brick = y % 7 === 0 || (x + (Math.floor(y / 7) % 2) * 6) % 12 === 0;
        c = brick ? dark(s[0]!, 0.3) : dark(ramp(s, clamp01(0.4 + n * 0.3), x, y), 0.3);
      }
    }
    px.p(x, y, c);
  }
  // the floor
  for (let y = FLOOR_Y; y < H; y++) for (let x = 0; x < W; x++) {
    const n = hash(x, y, 21), k = (y - FLOOR_Y) / (H - FLOOR_Y);
    let c: RGB;
    switch (t) {
      case 'flooded': {
        // black water with ripples
        const rip = (x + f * 2 + (y % 2) * 5) % 13 < 2;
        c = rip ? mixRGB(pal.alt[0]!, pal.glow, 0.25) : ramp(R(0x02080a, 0x06141a, 0x0a2028), clamp01(k + n * 0.2), x, y);
        break;
      }
      case 'forge': {
        const hotRow = y === FLOOR_Y + 3 || y === FLOOR_Y + 4;
        c = hotRow ? [pal.alt[3]!, pal.alt[4]!, pal.alt[5]!, pal.alt[4]!][(Math.floor(x / 3) + f) % 4]! : ramp(s, clamp01(0.3 + n * 0.2), x, y);
        break;
      }
      case 'frost': c = ramp(R(0x8a9ab0, 0xb8c8dc, 0xe0ecf8, 0xf4faff), clamp01(0.6 - k * 0.3 + n * 0.25), x, y); break;
      case 'sky': c = y === FLOOR_Y ? 0x5ea432 : ramp(R(0x2a1e12, 0x44321e, 0x60482c), clamp01(0.7 - k + n * 0.2), x, y); break;
      case 'moon': c = ramp(R(0x34363e, 0x4a4c56, 0x666874, 0x8a8c9a), clamp01(0.55 - k * 0.3 + n * 0.3), x, y); break;
      case 'server': c = (x % 6 === 0 || y === FLOOR_Y) ? 0x0a0c12 : ramp(R(0x14171e, 0x1c2028, 0x262c36), clamp01(0.4 + n * 0.3), x, y); break;
      case 'fungal': c = ramp(R(0x0a1a10, 0x163020, 0x245032), clamp01(0.5 - k * 0.3 + n * 0.4), x, y); break;
      case 'courtyard': c = (x + (y % 2) * 3) % 6 === 0 ? s[0]! : ramp(s, clamp01(0.5 + n * 0.3), x, y); break;
      default: c = (x + (y % 2) * 4) % 8 === 0 ? s[0]! : ramp(s, clamp01(0.45 - k * 0.2 + n * 0.25), x, y);
    }
    px.p(x, y, c);
  }
}

/** Props either side of the door (left half drawn, then mirrored by the caller where symmetric). */
function vistaProps(t: string, pal: ThemePal, px: Px, f: number) {
  const g = pal.glow, g2 = pal.glow2;
  switch (t) {
    case 'catacombs': {
      // wall torches in iron sconces
      for (const x of [12]) {
        const sc = new Px(px.w, px.h);
        for (let y = 50; y < 58; y++) sc.p(x, y, IRON[2]!);
        for (let k = -2; k <= 2; k++) sc.p(x + k, 50, IRON[3]!);
        sc.p(x - 2, 49, IRON[2]!); sc.p(x + 2, 49, IRON[2]!);
        layer(px, sc);
        const fl = [[0, 0], [1, 0], [0, -1], [-1, 0]][f % 4]!;
        for (let k = 0; k < 6; k++) { const w = k < 2 ? 2 : k < 4 ? 1 : 0; for (let dx = -w; dx <= w; dx++) px.p(x + dx + (k > 2 ? fl[0]! : 0), 48 - k, k < 2 ? 0xfff0c0 : k < 4 ? g : 0xc04010); }
      }
      // cobwebs in the top corners
      for (let k = 0; k < 10; k++) { px.p(k, 0, 0x8a7a6a, 0.5); px.p(0, k, 0x8a7a6a, 0.5); px.p(k, 10 - k, 0x8a7a6a, 0.45); }
      for (let k = 0; k < 6; k++) px.p(k, 6 - k, 0x8a7a6a, 0.35);
      break;
    }
    case 'flooded': {
      const k = new Px(px.w, px.h);
      kelp(k, 6, 0, 28, f * 0.5, pal.alt); kelp(k, 22, 0, 16, f * 0.5 + 2, pal.alt);
      layer(px, k);
      for (let x = 4; x < 30; x += 7) { const dy = (f * 3 + x) % 24; px.p(x, 30 + dy, pal.glow2); }
      break;
    }
    case 'ossuary': {
      // candles burning on a skull shelf
      for (let x = 2; x < 32; x++) { px.p(x, 70, IRON[1]!); px.p(x, 71, IRON[0]!); }
      const c = new Px(px.w, px.h);
      candle(c, 10, 69, 7, CANDLE_WAX, g, f); candle(c, 20, 69, 5, CANDLE_WAX, g, f + 1);
      layer(px, c);
      break;
    }
    case 'sanctum': {
      // a tall candelabrum and a hanging crimson banner
      const st = new Px(px.w, px.h);
      for (let y = 60; y < FLOOR_Y; y++) st.p(14, y, GOLD[2]!);
      for (let x = 8; x < 21; x++) st.p(x, 60, GOLD[3]!);
      for (const x of [8, 14, 20]) for (let y = 56; y < 60; y++) st.p(x, y, GOLD[2]!);
      layer(px, st);
      const c = new Px(px.w, px.h);
      for (const [x, k] of [[8, 0], [14, 1], [20, 2]] as const) candle(c, x, 55, 6, R(0x3a080c, 0x5e1016, 0x84202a, 0xb04048, 0xe86060), g2, f + k);
      layer(px, c);
      const ban = new Px(px.w, px.h);
      for (let y = 0; y < 34; y++) for (let x = 24; x < 33; x++) {
        if (y > 28 && Math.abs(x - 28.5) < (y - 28) * 0.9) continue;
        ban.p(x, y, x === 24 ? pal.alt[1]! : x === 32 ? pal.alt[2]! : ramp(R(pal.alt[2]!, pal.alt[3]!, pal.alt[4]!), clamp01(0.7 - (x - 24) * 0.06), x, y));
      }
      for (let x = 24; x < 33; x++) ban.p(x, 3, GOLD[3]!);
      layer(px, ban);
      glint(px, 28, 14, GOLD[4]!, 0);
      break;
    }
    case 'fungal': {
      const m = new Px(px.w, px.h);
      mushroom(m, 8, FLOOR_Y + 1, 9, 5, [g, g2][f % 2 ? 0 : 0]!, pal.alt);
      mushroom(m, 18, FLOOR_Y + 2, 5, 3, g2, pal.alt);
      mushroom(m, 26, FLOOR_Y + 1, 3, 2, g, pal.alt);
      layer(px, m);
      const r = new Px(px.w, px.h);
      stroke(r, [[0, 10], [8, 18], [6, 30], [14, 44]], 1.6, pal.alt);
      layer(px, r);
      for (let k = 0; k < 5; k++) { const yy = 80 - ((f * 4 + k * 13) % 60); px.p(4 + k * 6, yy, k % 2 ? g2 : g, 0.8); }
      break;
    }
    case 'forge': {
      // a hanging chain and lava seeping from a crack
      for (let y = 0; y < 40; y++) px.p(10, y, y % 3 === 0 ? IRON[1]! : IRON[3]!);
      const hook = new Px(px.w, px.h); stroke(hook, [[10, 40], [10, 44], [13, 46], [15, 43]], 1.4, IRON); layer(px, hook);
      for (const [x, y, k] of [[22, 30, 0], [23, 31, 1], [23, 32, 2], [24, 33, 3], [24, 34, 0], [25, 35, 1]] as const) px.p(x, y, [pal.alt[3]!, pal.alt[4]!, pal.alt[5]!, pal.alt[4]!][(f + k) % 4]!);
      break;
    }
    case 'frost': {
      const ic = new Px(px.w, px.h);
      for (const [x, len] of [[3, 12], [8, 18], [13, 9], [18, 15], [24, 10], [29, 13]] as const) icicle(ic, x, 0, len, pal.alt);
      layer(px, ic);
      for (let k = 0; k < 6; k++) { const yy = (f * 5 + k * 17) % FLOOR_Y; px.p(3 + k * 5 + ((f + k) % 2), yy, 0xffffff, 0.8); }
      break;
    }
    case 'sky': {
      const c = new Px(px.w, px.h);
      cloud(c, 12 + (f % 12) * 0.25, 22, 22, R(0x8a9ab4, 0xbac8dc, 0xe4ecf6, 0xf8fbff, 0xffffff));
      layer(px, c, 0, 0, false);
      const c2 = new Px(px.w, px.h);
      cloud(c2, 22, 58, 14, R(0x8a9ab4, 0xbac8dc, 0xe4ecf6, 0xf8fbff, 0xffffff));
      layer(px, c2, 0, 0, false);
      break;
    }
    case 'moon': {
      // the cold blue Earth and a ruined outpost mast
      const e = new Px(px.w, px.h);
      orb(e, 14, 16, 9, 9, pal.alt, 0.15);
      for (const [x, y] of [[10, 12], [11, 12], [11, 13], [12, 13], [17, 18], [18, 18], [18, 19], [14, 21], [9, 17]] as const) e.p(x, y, 0x3e7a3a);
      layer(px, e);
      const m = new Px(px.w, px.h), mx = px.w - 20;
      for (let y = 58; y < FLOOR_Y; y++) m.p(mx, y, SILVER[y % 3 ? 2 : 3]!);
      for (let k = -4; k <= 4; k++) m.p(mx + k, 62, SILVER[2]!);
      line(m, mx - 4, FLOOR_Y, mx, 70, SILVER[1]!); line(m, mx + 4, FLOOR_Y, mx, 70, SILVER[1]!);
      layer(px, m);
      if (f % 4 < 2) glint(px, mx, 57, g2, 1); else px.p(mx, 57, mixRGB(g2, 0, 0.6));
      for (const [x, y, k] of [[40, 8, 0], [100, 20, 1], [92, 6, 2], [34, 30, 3]] as const) if ((f + k) % 4 < 2) sparkle(px, x, y, g, k === 1);
      break;
    }
    case 'server': {
      // cable bundles hanging from the ceiling
      const cab = new Px(px.w, px.h);
      stroke(cab, [[2, 0], [6, 10], [12, 14], [20, 10], [24, 0]], 1.8, R(0x200608, 0x40100e, 0x6a1c18, 0x983028, 0xc04c40));
      stroke(cab, [[8, 0], [12, 7], [18, 6]], 1.4, R(0x04202a, 0x083a48, 0x10606e, 0x2a90a0));
      layer(px, cab);
      break;
    }
    case 'courtyard': {
      const p = new Px(px.w, px.h);
      for (let y = 60; y < FLOOR_Y; y++) { p.p(12, y, pal.trim[2]!); p.p(13, y, pal.trim[1]!); }
      for (let x = 7; x < 19; x++) { p.p(x, 66, pal.trim[3]!); }
      orb(p, 12, 57, 3.5, 3.5, R(0x6a5010, 0xa08030, 0xd0b050, 0xf0d880));
      layer(px, p);
      break;
    }
  }
}

function vistaFrame(theme: string, f: number, door: { w: number; h: number; frames: Uint8ClampedArray[] }): Px {
  const t = artTheme(theme), pal = themePal(t);
  const W = FA.VISTA_W, H = FA.VISTA_H;
  const px = new Px(W, H);
  vistaBackdrop(t, pal, px, f);
  const props = new Px(W, H);
  vistaProps(t, pal, props, f);
  if (t !== 'moon') mirror(props);   // the moon's Earth and mast stand alone, on opposite sides
  px.blit(props, 0, 0);
  // the portal's light on the wall and the floor around the door (dithered, additive-looking)
  const cx = W / 2, cy = 80;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x + 0.5 - cx) / 46, dy = (y + 0.5 - cy) / (y >= FLOOR_Y ? 10 : 40);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d >= 1) continue;
    const k = (1 - d) * (y >= FLOOR_Y ? 0.5 : 0.26);
    if (dither(x, y, k * 1.5)) px.p(x, y, mixRGB(px.col(x, y), pal.glow, 0.3 + k * 0.4));
  }
  // the door itself
  const fr = door.frames[f % door.frames.length]!;
  const ox = Math.floor((W - door.w) / 2), oy = H - door.h;
  for (let y = 0; y < door.h; y++) for (let x = 0; x < door.w; x++) {
    const i = (y * door.w + x) * 4, a = fr[i + 3]!;
    if (a) px.p(ox + x, oy + y, (fr[i]! << 16) | (fr[i + 1]! << 8) | fr[i + 2]!, a / 255);
  }
  // edge vignette (dithered) so the door holds the eye
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = Math.min(x, W - 1 - x, y * 1.4, (H - 1 - y) * 3);
    if (e < 14 && dither(x, y, (1 - e / 14) * 0.75)) px.p(x, y, mixRGB(px.col(x, y), 0x000000, 0.55));
  }
  return px;
}

/** The art window strip: VISTA_FRAMES frames of FA.VISTA_W x FA.VISTA_H side by side. */
export function vistaStrip(theme: string): Px {
  const door = buildDoorPortrait(artTheme(theme));
  const out = new Px(FA.VISTA_W * VISTA_FRAMES, FA.VISTA_H);
  for (let f = 0; f < VISTA_FRAMES; f++) out.blit(vistaFrame(theme, f, door), f * FA.VISTA_W, 0);
  return out;
}

/** The art window's inset frame: a 12px tile, 4px slice, in the theme trim. */
export function windowTile(theme: string): Px {
  const pal = themePal(theme), S = FA.RULE, px = new Px(S, S), tr = pal.trim;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.min(x, y, S - 1 - x, S - 1 - y);
    if (d >= 4) continue;
    const light = d === y || d === x;
    px.p(x, y, d === 0 ? K : d === 1 ? (light ? tr[3]! : tr[1]!) : d === 2 ? (light ? tr[2]! : tr[0]!) : K);
  }
  return px;
}

/** The rarity rule framing the text panel: a 12px tile, 4px slice; gems on the corners (mythic: prism frame 0..3). */
export function rarityRule(rarity: Rarity, prism = -1): Px {
  const S = FA.RULE, px = new Px(S, S), m = RARITY_METAL[rarity].r;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.min(x, y, S - 1 - x, S - 1 - y);
    if (d >= 3) continue;
    const light = d === y || d === x;
    px.p(x, y, d === 1 ? (light ? m[3]! : m[1]!) : K);
  }
  const gem = prism >= 0 ? PRISM[prism % 4]! : RARITY_METAL[rarity].gem;
  for (const [cx, cy] of [[1.5, 1.5], [S - 1.5, 1.5], [1.5, S - 1.5], [S - 1.5, S - 1.5]] as const) stud(px, cx, cy, 1.6, m, gem);
  return px;
}

/** Rarity rule strip: one frame (common, rare) or four prism frames (mythic), 12px tiles side by side. */
export function rarityRuleStrip(rarity: Rarity): Px {
  const n = rarity === 'mythic' ? 4 : 1, out = new Px(FA.RULE * n, FA.RULE);
  for (let f = 0; f < n; f++) out.blit(rarityRule(rarity, rarity === 'mythic' ? f : -1), f * FA.RULE, 0);
  return out;
}

/** Medallion strip: one frame, or four prism frames for mythic. */
export function medallionStrip(theme: string, rarity: Rarity): Px {
  const n = rarity === 'mythic' ? 4 : 1, out = new Px(FA.MEDAL * n, FA.MEDAL);
  for (let f = 0; f < n; f++) out.blit(medallion(theme, rarity, rarity === 'mythic' ? f : -1), f * FA.MEDAL, 0);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// the wax seal stamped on a bound card: wax in the theme's colour with its sigil embossed at 2x
// ---------------------------------------------------------------------------------------------------------------

export function sealArt(theme: string): Px {
  const t = artTheme(theme), pal = themePal(t), w = pal.wax;
  const S = FA.SEAL, px = new Px(S, S), c = S / 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x + 0.5 - c, dy = y + 0.5 - c, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const edge = 19.5 + Math.sin(a * 7 + 1) * 1.1 + Math.sin(a * 13) * 0.6 + (hash(Math.round(a * 20), 1, 3) - 0.5) * 1.2;
    const drip = dy > 0 && Math.abs(dx - 6) < 2 && dy < 23 ? 1 : 0;
    if (r > edge && !drip) continue;
    // glossy wax: flat bands of light (no dither), a darker pressed field inside the stamp's rim
    const lit = 0.5 - (dx + dy) / 50;
    const band = (v: number) => (v < 0.22 ? w[1]! : v < 0.5 ? w[2]! : v < 0.78 ? w[3]! : w[4]!);
    let col: RGB;
    if (r > edge - 1 && !drip) col = w[0]!;
    else if (r > 15.5 && r < 17.5) col = (dx + dy) < -2 ? w[4]! : (dx + dy) < 6 ? w[3]! : w[1]!;   // the raised rim of the stamp
    else if (r > 17.5 || drip) col = band(lit + 0.12);
    else col = band(lit - 0.12);
    px.p(x, y, col);
  }
  for (const [x, y] of [[12, 10], [13, 10], [11, 11], [12, 11], [10, 13]] as const) px.p(x, y, 0xffffff, 0.85);   // the gloss
  // emboss the sigil at 2x: highlight up-left of each mark pixel, shadow down-right
  const sg = sigil(t, 'emboss');
  const ox = Math.floor(c - FA.SIGIL), oy = Math.floor(c - FA.SIGIL);
  const mark = (x: number, y: number) => sg.al(x, y) > 0 && sg.col(x, y) !== w[0];
  for (let y = 0; y < FA.SIGIL; y++) for (let x = 0; x < FA.SIGIL; x++) {
    if (!mark(x, y)) continue;
    for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) {
      const X = ox + x * 2 + xx, Y = oy + y * 2 + yy;
      // raised mark: lit where the edge faces up/left, shaded where it faces down/right
      const lit = (yy === 0 && !mark(x, y - 1)) || (xx === 0 && !mark(x - 1, y));
      const shade = (yy === 1 && !mark(x, y + 1)) || (xx === 1 && !mark(x + 1, y));
      px.p(X, Y, lit ? w[4]! : shade ? w[1]! : w[3]!);
    }
  }
  px.outline(K);
  return px;
}

// ---------------------------------------------------------------------------------------------------------------
// the dungeon-agnostic card back: a gilded oxblood frame spun with three threads, a lattice field, the Fate emblem
// ---------------------------------------------------------------------------------------------------------------

const OX = R(0x12030a, 0x24060e, 0x3a0a14, 0x561020, 0x7a1a2c);

export function backFrameTile(): Px {
  const S = FA.TILE, px = new Px(S, S), tr = GOLD;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dl = x, dt = y, dr = S - 1 - x, db = S - 1 - y;
    const d = Math.min(dl, dt, dr, db);
    if (d >= FA.SLICE) continue;
    const cx = Math.min(dl, dr), cy = Math.min(dt, db);
    if (cx + cy <= 2) continue;
    if (cx + cy === 3) { px.p(x, y, K); continue; }
    const light = d === dt || d === dl;
    const along = d === dt || d === db ? x : y;
    let c: RGB;
    switch (d) {
      case 0: case 3: case 10: c = K; break;
      case 1: c = light ? tr[4]! : tr[1]!; break;
      case 2: c = light ? tr[3]! : tr[2]!; break;
      case 9: c = light ? tr[3]! : tr[1]!; break;
      case 11: px.p(x, y, 0x000000, 0.5); continue;
      default: {
        // three threads twisting through the band
        const i = d - 4;
        const th = [2 + Math.round(Math.sin(along * 0.52) * 2), 2 + Math.round(Math.sin(along * 0.52 + 2.1) * 2), 2 + Math.round(Math.sin(along * 0.52 + 4.2) * 2)];
        c = th[0] === i ? tr[3]! : th[1] === i ? 0xe8dec4 : th[2] === i ? OX[4]! : OX[1 + (i % 2)]!;
      }
    }
    px.p(x, y, c);
  }
  for (const [bx, by] of [[5.5, 5.5], [S - 5.5, 5.5], [5.5, S - 5.5], [S - 5.5, S - 5.5]] as const) stud(px, bx, by, 3.5, tr, R(0x3a0414, 0xc0203a, 0xff8090));
  return px;
}

export function backLatticeTile(): Px {
  const S = 16, px = new Px(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + y) % 16, v = (x - y + 32) % 16;
    const onLine = u === 0 || v === 0;
    const n = hash(x, y, 77);
    px.p(x, y, onLine ? OX[3]! : ramp(R(OX[0]!, OX[1]!, OX[2]!), clamp01(0.3 + n * 0.25), x, y));
  }
  for (const [x, y] of [[0, 0], [8, 8]] as const) { px.p(x, y, GOLD[3]!); }
  return px;
}

export function backEmblem(): Px {
  const W = FA.EMBLEM_W, H = FA.EMBLEM_H, px = new Px(W, H), cx = W / 2, cy = 44;
  // radiant rays behind the wheel
  const rays = new Px(W, H);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, long = k % 2 === 0;
    for (let r = 22; r < (long ? 34 : 29); r++) {
      const w = (long ? 2.2 : 1.4) * (1 - (r - 22) / 14);
      for (let s = -w; s <= w; s += 0.5) rays.p(cx + Math.cos(a) * r - Math.sin(a) * s, cy + Math.sin(a) * r + Math.cos(a) * s, s < 0 ? GOLD[3]! : GOLD[2]!);
    }
  }
  layer(px, rays);
  // the wheel of fate: a gilt ring with twelve spokes
  const wheel = new Px(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const lit = clamp01(0.55 - (dx + dy) / (r * 2.6 + 0.01));
    if (r <= 22 && r > 18.5) wheel.p(x, y, ramp(GOLD, lit * 1.1, x, y));
    else if (r <= 18.5 && r > 17.5) wheel.p(x, y, K);
    else if (r <= 17.5) {
      const spoke = Math.abs(((a / (Math.PI * 2)) * 12 + 12.5) % 1 - 0.5) < 0.06 && r > 11;
      wheel.p(x, y, spoke ? GOLD[2]! : ramp(OX, clamp01(0.5 - r / 40 - (dx + dy) / 60), x, y));
    }
  }
  layer(px, wheel);
  // the eye
  const eye = new Px(W, H);
  for (let y = -6; y <= 6; y++) for (let x = -11; x <= 11; x++) {
    const lid = Math.abs(y) <= 6 * (1 - (x / 11.5) ** 2);
    if (!lid) continue;
    const r = Math.hypot(x, y);
    eye.p(cx + x, cy + y, r < 2.2 ? K : r < 5.2 ? ramp(R(0x7a0a1c, 0xc0203a, 0xff5a6a, 0xffb0b8), clamp01(0.6 - (x + y) / 14), cx + x, cy + y) : ramp(BONE, clamp01(0.8 - y / 14), cx + x, cy + y));
  }
  layer(px, eye);
  px.p(cx - 2, cy - 2, 0xffffff); px.p(cx - 1, cy - 2, 0xffffff, 0.6);
  // the crescent crowning the wheel
  const moon = new Px(W, H);
  crescent(moon, cx, 10, 7, R(GOLD[1]!, GOLD[2]!, GOLD[3]!, GOLD[4]!), 0);
  layer(px, moon);
  // three threads falling from the wheel to a diamond knot
  const thr = new Px(W, H);
  for (let y = cy + 22; y < H - 8; y++) {
    const u = (y - cy - 22) / (H - 8 - cy - 22);
    for (let k = 0; k < 3; k++) {
      const x = cx + (k - 1) * (5 * (1 - u)) + Math.sin(y * 0.5 + k * 2.1) * 1.4 * (1 - u * 0.6);
      thr.p(x, y, [GOLD[3]!, 0xe8dec4, 0xc0203a][k]!);
    }
  }
  layer(px, thr);
  stud(px, cx, H - 6, 4.5, GOLD, R(0x3a0414, 0xc0203a, 0xff8090));
  return px;
}

// ---------------------------------------------------------------------------------------------------------------
// effect sprites: sheen band, cursor glare, burn-away dissolve (mask + ember edge)
// ---------------------------------------------------------------------------------------------------------------

/** A diagonal dithered light band (white), swept across the card face. 48 x 96. */
export function sheenArt(): Px {
  const W = 48, H = 96, px = new Px(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = ((x - W / 2) + (y - H / 2) * 0.5) / 10;
    const k = Math.max(0, 1 - Math.abs(u));
    if (k > 0 && dither(x, y, k * 0.9)) px.p(x, y, 0xffffff, k > 0.7 ? 1 : 0.7);
  }
  return px;
}

/** The table the cards land on: a wide pool of warm candlelight on dark wood, ordered-dithered. 360 x 150. */
export function tableArt(): Px {
  const W = 360, H = 150, px = new Px(W, H);
  const tones = [0x1a110b, 0x2a1b11, 0x3c2718, 0x523521];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x + 0.5 - W / 2) / (W / 2), dy = (y + 0.5 - H / 2) / (H / 2);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d >= 1) continue;
    // wood grain: long horizontal streaks that waver
    const grain = Math.sin(y * 0.9 + Math.sin(x * 0.045 + y * 0.3) * 2.2) * 0.06 + (hash(Math.floor(x / 9), y, 5) - 0.5) * 0.05;
    const v = (1 - d) ** 1.25 * 3.1 + grain;
    const i = Math.floor(v);
    const t = v - i;
    const k = Math.min(3, Math.max(0, i + (dither(x, y, t) ? 1 : 0)) - 1);
    if (k < 0) { if (dither(x, y, 0.5 * (1 - d) * 2)) px.p(x, y, tones[0]!); continue; }
    px.p(x, y, tones[k]!);
  }
  return px;
}

/** A dithered round highlight that follows the cursor. 48 x 48. */
export function glareArt(): Px {
  const S = 48, px = new Px(S, S), c = S / 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / c;
    if (d < 1 && dither(x, y, (1 - d) ** 1.6)) px.p(x, y, 0xffffff);
  }
  return px;
}

export const DISSOLVE_FRAMES = 8;
const DIS_W = 40, DIS_H = 60;

/** 0 burns first .. 1 burns last: a ragged front rising from the bottom edge. */
function dissolveField(x: number, y: number): number {
  const n = hash(x, y, 91) * 0.6 + hash(x >> 2, y >> 2, 17) * 0.4;
  return clamp01((1 - y / DIS_H) * 0.62 + n * 0.38);
}
const dissolveAt = (f: number) => (f / (DISSOLVE_FRAMES - 1)) * 1.04;

/** Burn-away mask strip (DISSOLVE_FRAMES frames of 40 x 60): opaque where the card still stands. */
export function dissolveMaskStrip(): Px {
  const out = new Px(DIS_W * DISSOLVE_FRAMES, DIS_H);
  for (let f = 0; f < DISSOLVE_FRAMES; f++) {
    const th = dissolveAt(f);
    for (let y = 0; y < DIS_H; y++) for (let x = 0; x < DIS_W; x++) if (f === 0 || dissolveField(x, y) > th) out.p(f * DIS_W + x, y, 0xffffff);
  }
  return out;
}

/** The burning edge just ahead of the burn front (white; tinted with the theme's light in CSS). */
export function dissolveEdgeStrip(): Px {
  const out = new Px(DIS_W * DISSOLVE_FRAMES, DIS_H);
  for (let f = 1; f < DISSOLVE_FRAMES - 1; f++) {
    const th = dissolveAt(f);
    for (let y = 0; y < DIS_H; y++) for (let x = 0; x < DIS_W; x++) {
      const v = dissolveField(x, y);
      if (v > th && v < th + 0.1) out.p(f * DIS_W + x, y, 0xffffff);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// URLs for the DOM (cached; client only: Px.url() needs a canvas)
// ---------------------------------------------------------------------------------------------------------------

export interface FateThemeArt {
  theme: string;
  frame: string; panel: string; window: string;
  cornerTop: string; cornerBottom: string; crest: string; foot: string; fringe: string | null; vista: string;
  seal: string; sigil: string;
  /** CSS colours: the theme's light and second light, the wax, the panel */
  glow: string; glow2: string; waxHi: string; panelHex: string;
}

const themeCache = new Map<string, FateThemeArt>();
const medalCache = new Map<string, string>();
let installed = false;

export function fateThemeArt(theme: string): FateThemeArt {
  const t = artTheme(theme);
  let a = themeCache.get(t);
  if (a) return a;
  const pal = themePal(t);
  const fr = fringeArt(t);
  a = {
    theme: t,
    frame: frameTile(t).url(), panel: panelTile(t).url(), window: windowTile(t).url(),
    cornerTop: cornerStrip(t, 'top').url(), cornerBottom: cornerStrip(t, 'bottom').url(), crest: crestStrip(t).url(), foot: footArt(t).url(),
    fringe: fr ? fr.url() : null, vista: vistaStrip(t).url(), seal: sealArt(t).url(), sigil: sigil(t).url(),
    glow: cssHex(pal.glow), glow2: cssHex(pal.glow2), waxHi: cssHex(pal.wax[3]!), panelHex: cssHex(pal.panel[1]!),
  };
  themeCache.set(t, a);
  return a;
}

export function fateMedalArt(theme: string, rarity: Rarity): string {
  const k = `${artTheme(theme)}:${rarity}`;
  let u = medalCache.get(k);
  if (!u) { u = medallionStrip(theme, rarity).url(); medalCache.set(k, u); }
  return u;
}

/**
 * The theme-independent sprites as document-level custom properties (once per page, like the pixel skin):
 * --fa-back-frame, --fa-back-lattice, --fa-back-emblem, --fa-sheen, --fa-table, --fa-glare, --fa-dissolve, --fa-dissolve-edge,
 * --fa-rule-common, --fa-rule-rare and the four mythic rule frames --fa-rule-m0..3.
 */
export function installFateArt() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const root = document.documentElement.style;
  const set = (k: string, px: Px) => root.setProperty(k, px.url());
  set('--fa-back-frame', backFrameTile());
  set('--fa-back-lattice', backLatticeTile());
  set('--fa-back-emblem', backEmblem());
  set('--fa-sheen', sheenArt());
  set('--fa-table', tableArt());
  set('--fa-glare', glareArt());
  set('--fa-dissolve', dissolveMaskStrip());
  set('--fa-dissolve-edge', dissolveEdgeStrip());
  set('--fa-rule-common', rarityRule('common'));
  set('--fa-rule-rare', rarityRule('rare'));
  for (let f = 0; f < 4; f++) set(`--fa-rule-m${f}`, rarityRule('mythic', f));
}

/** Warm a theme's sprites off the critical path (an idle callback per theme), so the deal never waits on drawing. */
export function prewarmFateArt(themes: readonly string[]) {
  if (typeof window === 'undefined') return;
  const idle = (window as unknown as { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number }).requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 1));
  for (const t of themes) idle(() => { fateThemeArt(t); }, { timeout: 400 });
}
