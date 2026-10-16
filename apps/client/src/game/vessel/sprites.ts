/**
 * Sprites for the Vessel Select stage, as flat ARGB pixel arrays ready for the software renderer: each hero's
 * front-facing idle / cast / attack frames straight from the procedural hero rig, the Warden's spirit wolf, class
 * effect sprites borrowed from the in-game effect sheets (art/fx), and the stage's own pieces (plinths, braziers,
 * flames, runes, chains and padlock). Framework-free; heroes build on demand and are cached for the session.
 */
import { actorStateSpecs } from '../art/actors';
import { renderCreatureFrame } from '../art/draw/creatures';
import { renderHeroFrame, type HeroState } from '../art/draw/humanoid';
import { Painter, PixelBuffer, hash2, mix, polishActor } from '../art/draw/pixel';
import { PILLAR_H, paintTallPillar } from '../art/dungeonThemes';
import { CLASS_FX_SPECS } from '../art/fx';
import { HERO_FEET, HERO_FRAME } from './layout';
import type { VesselClass } from './palette';

export interface Spr {
  w: number;
  h: number;
  /** ARGB (0xAARRGGBB) */
  px: Uint32Array;
  /** silhouette edge flags per pixel: 1 top, 2 left, 4 right, 8 bottom */
  edge: Uint8Array;
  /** opaque bounds (inclusive) */
  x0: number; y0: number; x1: number; y1: number;
}

export function sprFrom(buf: PixelBuffer): Spr {
  const { w, h } = buf;
  const px = buf.data.slice();
  const edge = new Uint8Array(w * h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && (px[y * w + x]! >>> 24) >= 128;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!(px[i]! >>> 24)) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (!solid(x, y)) continue;
      edge[i] = (solid(x, y - 1) ? 0 : 1) | (solid(x - 1, y) ? 0 : 2) | (solid(x + 1, y) ? 0 : 4) | (solid(x, y + 1) ? 0 : 8);
    }
  if (x1 < 0) { x0 = 0; y0 = 0; }
  return { w, h, px, edge, x0, y0, x1, y1 };
}

export interface Anim { frames: Spr[]; durations: number[] }
export interface HeroArt { idle: Anim; cast: Anim; attack: Anim }

const heroCache = new Map<VesselClass, HeroArt>();

function heroAnim(cls: VesselClass, state: HeroState, painter: Painter): Anim {
  const spec = actorStateSpecs(cls)[state];
  const durations = (spec?.durations ?? [200]).slice();
  const n = durations.length;
  const frames: Spr[] = [];
  for (let i = 0; i < n; i++) {
    const buf = renderHeroFrame(cls, state, 's', i, n, painter);
    polishActor(buf, { hero: true, groundY: HERO_FEET });
    frames.push(sprFrom(buf));
  }
  return { frames, durations };
}

/** Front-facing hero frames (built once per class, ~5-10 ms). */
export function heroArt(cls: VesselClass): HeroArt {
  let a = heroCache.get(cls);
  if (!a) {
    const p = new Painter(new PixelBuffer(HERO_FRAME, HERO_FRAME));
    a = { idle: heroAnim(cls, 'idle', p), cast: heroAnim(cls, 'cast', p), attack: heroAnim(cls, 'attack', p) };
    heroCache.set(cls, a);
  }
  return a;
}

export function heroArtCached(cls: VesselClass): HeroArt | null {
  return heroCache.get(cls) ?? null;
}

let wolfCache: Spr[] | null = null;
/** The Warden's spirit wolf, running east (mirrored at draw time for west). */
export function wolfFrames(): Spr[] {
  if (!wolfCache) {
    const p = new Painter(new PixelBuffer(48, 48));
    wolfCache = Array.from({ length: 6 }, (_, i) => sprFrom(renderCreatureFrame('spiritwolf', 'run', 'e', i, 6, p)));
  }
  return wolfCache;
}

// ---------------------------------------------------------------- borrowed effect sprites

const fxCache = new Map<string, Spr[]>();
/** Frames of an in-game class effect sprite (art/fx). Empty if the key is unknown. */
export function fxFrames(key: string): Spr[] {
  let f = fxCache.get(key);
  if (!f) {
    const spec = CLASS_FX_SPECS.find((s) => s.key === key);
    f = spec ? Array.from({ length: spec.frames }, (_, i) => { const b = new PixelBuffer(spec.w, spec.h); spec.draw(b, i, spec.frames); return sprFrom(b); }) : [];
    fxCache.set(key, f);
  }
  return f;
}

// ---------------------------------------------------------------- stage pieces

function stamp(rows: readonly string[], pal: Record<string, number>): Spr {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const b = new PixelBuffer(w, h);
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) { const c = pal[r[x]!]; if (c !== undefined) b.set(x, y, c & 0xffffff, c >>> 24 || 255); } });
  return sprFrom(b);
}

const A = (c: number, a = 255) => ((a << 24) | c) >>> 0;

/** Leaves (two greens and a blossom petal), each with a flipped twin for tumbling. */
export const LEAVES: Spr[] = [
  stamp([' gG', 'gGd', 'Gd '], { g: A(0x9ad86a), G: A(0x6b8f3a), d: A(0x3a5a1e) }),
  stamp(['Gg ', 'dGg', ' dG'], { g: A(0x9ad86a), G: A(0x6b8f3a), d: A(0x3a5a1e) }),
  stamp([' lL', 'lLd', 'Ld '], { l: A(0xc8f08a), L: A(0x8fc850), d: A(0x4a7a2a) }),
  stamp(['pP', 'Pp'], { p: A(0xffc8e8), P: A(0xff9ad0) }),
];

/** Feathers (green fletching with a pale quill), two tumble frames. */
export const FEATHERS: Spr[] = [
  stamp(['  gGg', 'qqqqG', '  gG '], { g: A(0xc8f0a8), G: A(0x8fd86a), q: A(0xf4ecd8) }),
  stamp([' gGg ', 'Gqqqq', ' Gg  '], { g: A(0xc8f0a8), G: A(0x8fd86a), q: A(0xf4ecd8) }),
  stamp(['  yYy', 'qqqqY', '  yY '], { y: A(0xffe0a0), Y: A(0xd8a850), q: A(0xf4ecd8) }),
];

/** Brass gears, two rotation frames each, small and large. */
export const GEARS: Spr[] = [
  stamp([' b b ', 'bBBBb', ' BoB ', 'bBBBb', ' b b '], { b: A(0xd8a850), B: A(0xb08038), o: A(0x3a2a18) }),
  stamp(['b   b', ' BBB ', ' BoB ', ' BBB ', 'b   b'], { b: A(0xd8a850), B: A(0xb08038), o: A(0x3a2a18) }),
  stamp(['  h h  ', ' hBBBh ', 'hBBbBBh', ' Bb.bB ', 'hBBbBBh', ' hBBBh ', '  h h  '], { h: A(0xfff2c0), B: A(0xd8a850), b: A(0x8a6432), '.': A(0x2a1e12) }),
  stamp([' h   h ', 'hhBBBhh', ' BBbBB ', ' Bb.bB ', ' BBbBB ', 'hhBBBhh', ' h   h '], { h: A(0xfff2c0), B: A(0xd8a850), b: A(0x8a6432), '.': A(0x2a1e12) }),
];

/** Snowflakes / frost glints. */
export const FLAKES: Spr[] = [
  stamp([' w ', 'wWw', ' w '], { w: A(0xd8f6ff, 200), W: A(0xffffff) }),
  stamp(['w w', ' W ', 'w w'], { w: A(0xd8f6ff, 180), W: A(0xffffff) }),
  stamp(['  w  ', ' w w ', 'w W w', ' w w ', '  w  '], { w: A(0xbfeaff, 200), W: A(0xffffff) }),
];

/** Little holy crosses (tintable white). */
export const CROSSES: Spr[] = [
  stamp([' W ', 'WWW', ' W ', ' W '], { W: A(0xffffff) }),
  stamp(['  W  ', ' WWW ', 'WWWWW', ' WWW ', '  W  ', '  W  '], { W: A(0xffffff) }),
];

/** Rune glyphs for the summoning circles (tintable white, 3x4). */
export const RUNES: Spr[] = [
  ['W.W', 'WWW', '.W.', '.W.'], ['WW.', 'W.W', 'WW.', 'W..'], ['.W.', 'W.W', 'WWW', 'W.W'], ['W..', 'WWW', '..W', 'WWW'],
  ['WWW', '.W.', 'W.W', 'W.W'], ['W.W', '.W.', 'W.W', 'WWW'], ['.WW', 'W..', 'W..', '.WW'], ['WWW', 'W.W', '.W.', '.W.'],
].map((rows) => stamp(rows, { W: A(0xffffff) }));

/** Padlock (iron with a brass keyhole), hung on the chains of a locked hero. */
export const PADLOCK: Spr = stamp([
  ' .dd. ',
  ' d..d ',
  ' d..d ',
  'kIIIIk',
  'IHhhIk',
  'Ih yIk',
  'IhhhIk',
  'kkkkkk',
], { '.': A(0x000000, 0), d: A(0x8a8890), k: A(0x1a181e), I: A(0x6a6872), H: A(0xc8c4d0), h: A(0x8e8a96), y: A(0xd8a850) });

/** A chain link pair (iron), tiled along a diagonal. */
export const CHAIN_LIGHT = A(0x8a8890), CHAIN_DARK = A(0x3a3840);

// ---------------------------------------------------------------- plinth

export const PLINTH_W = 38, PLINTH_H = 26;
/** Top-surface centre inside the plinth sprite (the hero's feet). */
export const PLINTH_CX = 19, PLINTH_CY = 8;
export const PLINTH_RX = 17, PLINTH_RY = 8.5, PLINTH_SIDE = 7;
/** Inscribed portal ring on the plinth top (relative to the top centre). */
export const RING_RX = 12, RING_RY = 6;
/** Rune slots carved into the plinth's front face (x offsets from the centre, row below the top). */
export const PLINTH_RUNES: readonly number[] = [-10, -4, 4, 10];

const STONE = [0x16121a, 0x221c24, 0x302830, 0x40363c, 0x544a4c, 0x6e625e] as const;

/** A round stone plinth with a carved ring and rune slots; `dormant` cracks and chips it. */
export function plinthSprite(dormant: boolean): Spr {
  const b = new PixelBuffer(PLINTH_W, PLINTH_H);
  const cx = PLINTH_CX - 0.5, cy = PLINTH_CY - 0.5, rx = PLINTH_RX, ry = PLINTH_RY;
  const tone = (k: number) => {
    const c = STONE[Math.max(0, Math.min(STONE.length - 1, k))]!;
    return dormant ? mix(c, 0x0e0c10, 0.35) : c;
  };
  // side wall: a cylinder band below the top ellipse, lit from the front-left
  for (let x = 0; x < PLINTH_W; x++) {
    const dx = (x + 0.5 - (cx + 0.5)) / rx;
    if (Math.abs(dx) > 1) continue;
    const yEdge = cy + 0.5 + ry * Math.sqrt(1 - dx * dx);
    const shade = Math.cos(Math.asin(Math.max(-1, Math.min(1, dx + 0.25)))) ;
    for (let y = Math.floor(yEdge); y < yEdge + PLINTH_SIDE; y++) {
      const v = y - yEdge;
      let k = Math.round(1 + shade * 2.6 - (v > PLINTH_SIDE - 2 ? 1 : 0));
      if ((x + (y > yEdge + 3 ? 3 : 0)) % 7 === 0 && v > 0.5 && v < PLINTH_SIDE - 1) k = 0;   // mortar joints
      if (Math.abs(v - 3.2) < 0.5) k = Math.max(0, k - 1);                                    // course line
      if (hash2(x, y, 7) < 0.08) k = Math.max(0, k - 1);
      b.set(x, y, tone(k));
    }
    b.set(x, Math.floor(yEdge + PLINTH_SIDE - 1), tone(0));
  }
  // top face: rim band, carved ring groove, dark inner disc
  for (let y = 0; y < PLINTH_H; y++)
    for (let x = 0; x < PLINTH_W; x++) {
      const d = Math.hypot((x + 0.5 - (cx + 0.5)) / rx, (y + 0.5 - (cy + 0.5)) / ry);
      if (d > 1) continue;
      const lit = (x - cx) * -0.04 + (y - cy) * -0.07;
      let k: number;
      if (d > 0.86) k = d > 0.96 ? 3 : 4;                            // bevelled rim
      else if (d > 0.62 && d < 0.78) k = 0;                           // ring groove (glows when lit)
      else k = d > 0.78 ? 3 : 2;
      k += lit > 0.25 ? 1 : lit < -0.3 ? -1 : 0;
      if (hash2(x, y, 3) < 0.07) k -= 1;
      b.set(x, y, tone(k));
    }
  // rune slots on the front face
  for (const ox of PLINTH_RUNES) {
    const x = Math.round(cx + ox), yTop = Math.round(cy + ry * Math.sqrt(Math.max(0, 1 - (ox / rx) ** 2))) + 2;
    for (let k = 0; k < 3; k++) b.set(x, yTop + k, tone(0));
  }
  if (dormant) {
    // cracks across the top and down the face, a chipped rim, moss in the joints
    const crack = (x0: number, y0: number, steps: number, dir: number, seed: number) => {
      let x = x0, y = y0;
      for (let k = 0; k < steps; k++) {
        b.set(Math.round(x), Math.round(y), 0x08060a);
        x += dir * (hash2(k, seed, 1) < 0.6 ? 1 : 0); y += hash2(k, seed, 2) < 0.55 ? 1 : 0;
      }
    };
    crack(cx - 7, cy - 6, 11, 1, 1); crack(cx + 4, cy - 3, 9, -1, 2); crack(cx + 9, cy + 7, 8, 1, 3); crack(cx - 12, cy + 5, 7, -1, 4);
    for (const [x, y] of [[cx - 15, cy - 2], [cx - 14, cy - 3], [cx + 13, cy - 4], [cx + 14, cy - 3], [cx + 15, cy - 2]] as const) b.set(Math.round(x), Math.round(y), 0, 0);
    for (let k = 0; k < 9; k++) { const x = Math.floor(hash2(k, 5, 9) * PLINTH_W), y = Math.floor(PLINTH_CY + 6 + hash2(k, 6, 9) * 9); if (b.alpha(x, y)) b.set(x, y, hash2(k, 1, 1) < 0.5 ? 0x2f4a22 : 0x24361c); }
  }
  return sprFrom(b);
}

// ---------------------------------------------------------------- braziers and flames

/** Iron brazier on a tripod (bowl rim at row 7, feet at the bottom row). Origin: bottom centre. */
export function brazierSprite(): Spr {
  return stamp([
    '  kIIIIIIIIIIk  ',
    ' kIHHhhhhhhHHIk ',
    'kIIhhIIIIIIhhIIk',
    ' kIIIIIIIIIIIIk ',
    '  kkIIIIIIIIkk  ',
    '    kkIIIIkk    ',
    '      kIIk      ',
    '      kIIk      ',
    '     kI  Ik     ',
    '     kI  Ik     ',
    '    kI    Ik    ',
    '    kI    Ik    ',
    '   kI      Ik   ',
    '   kI      Ik   ',
    '  kIk      kIk  ',
    '  kk        kk  ',
  ], { k: A(0x0e0c10), I: A(0x3a3438), H: A(0x8a7a6a), h: A(0x5a4e48) });
}

/** Banded fire frames (14x18), additive. */
export function flameFrames(n = 6): Spr[] {
  const out: Spr[] = [];
  const RAMP = [0x7a1804, 0xd8400a, 0xff8a1a, 0xffc848, 0xfff2b0] as const;
  for (let f = 0; f < n; f++) {
    const b = new PixelBuffer(14, 18);
    for (let y = 0; y < 18; y++)
      for (let x = 0; x < 14; x++) {
        const t = (17 - y) / 17;                                  // 0 bottom .. 1 top
        const sway = Math.sin(y * 0.55 + f * (Math.PI * 2 / n)) * 1.4 * t;
        const w = 6.2 * (1 - t) ** 0.8 + 0.4;
        const d = Math.abs(x + 0.5 - 7 - sway) / w;
        const n2 = hash2(x, y + f * 19, 11) * 0.45 + Math.sin((y + f * 3) * 0.9 + x) * 0.12;
        const v = (1 - d) * (1.25 - t * 0.9) + n2 - 0.35;
        if (v <= 0.12) continue;
        const k = Math.min(RAMP.length - 1, Math.floor(v * 4.2));
        b.set(x, y, RAMP[k]!);
      }
    out.push(sprFrom(b));
  }
  return out;
}

/** A tall dungeon pillar (the in-game theme pillar art) for the framing foreground. */
export function pillarSprite(): Spr {
  const p = new Painter(new PixelBuffer(32, PILLAR_H));
  p.reset();
  paintTallPillar(p, 'catacombs');
  p.finish(0x050405, 0);
  return sprFrom(p.buf);
}
