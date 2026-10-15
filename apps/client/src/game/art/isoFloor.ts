/**
 * Native iso FLOORS for every dungeon theme (framework-free).
 *
 * The floor of each theme is one seamless world-space macro texture, MACRO x MACRO tiles (32x32 texels per
 * tile), generated with real masonry: irregular stones of mixed sizes that cross tile boundaries, grout,
 * bevels, sunken / cracked / missing stones and theme materials. Every tile of the macro becomes one 64x32
 * diamond frame (frame = (x mod MACRO) + (y mod MACRO) * MACRO), with a matching Light2D normal map built
 * from the same height field, and (for glowing themes) an unlit emissive frame.
 *
 * On top of that come tile-aligned overlay frames ("deco", 64x40 = 8 px headroom + the diamond): cracks,
 * broken patches, grates, puddles, wall-base accumulation, 2x1 slabs, 2x2 centrepieces, runners (carpets,
 * water channels, rails), a raised dais and small scatter. The dressing planner places them per map.
 */
import { MATERIALS } from './palette';
import { Painter, PixelBuffer, bayer, hash2, rng, type Ramp } from './draw/pixel';
import {
  DIAMOND_TEXEL,
  diamondAB,
  DW,
  DH,
  FLAT_NORMAL,
  TILE,
  bevel,
  encodeNormal,
  fbmField,
  floorNormals,
  hashi,
  jointDistance,
  luma,
  mixc,
  noiseField,
  packStones,
  pnoiseP,
  scalec,
  stoneField,
  tone,
} from './isoKit';
import type { ThemeId } from './dungeonThemes';

export const MACRO = 8;
const S = MACRO * TILE; // 256 texels
const R = (...c: number[]): Ramp => Object.freeze(c);

/** Overlay frame names (index = frame). Same list for every theme; content is themed. */
export const DECO_NAMES = [
  'crack0', 'crack1', 'crack2',
  'hole0', 'hole1',
  'grate',
  'wet0', 'wet1',
  'edgeN0', 'edgeN1', 'edgeW0', 'edgeW1', 'edgeNW',
  'edgeS', 'edgeE',
  'slabX0', 'slabX1', 'slabY0', 'slabY1',
  'cp0', 'cp1', 'cp2', 'cp3',
  'runX', 'runY', 'runX0', 'runX1', 'runY0', 'runY1',
  'dais', 'daisS', 'daisE', 'daisSE',
  'scatter0', 'scatter1',
  'stepsX', 'stepsY',
] as const;
export type DecoName = (typeof DECO_NAMES)[number];
export const DECO: Record<DecoName, number> = Object.fromEntries(DECO_NAMES.map((n, i) => [n, i])) as Record<DecoName, number>;
export const DECO_W = 64;
export const DECO_H = 40;
/** Rows of headroom above the diamond in a deco frame (raised dais lips). */
export const DECO_TOP = 8;
/** Raised dais height in screen px. */
const RISE = 4;

/** Which themes have unlit glowing floor pixels (lava seams, mycelium, sigils). */
export const FLOOR_GLOW_THEMES: readonly ThemeId[] = ['forge', 'fungal', 'sanctum', 'server'];

// ---------------------------------------------------------------- theme floor materials

export interface FloorMat {
  stone: Ramp;
  alt: Ramp;
  mortar: number;
  dust: number;
  growth: Ramp;
  water: Ramp;
  /** surface glaze: extra specular pixels on lit bevels (wet / polished / iced) */
  gloss: number;
  /** grout depth (normal strength) */
  groutDepth: number;
}

export const FLOOR_MATS: Record<ThemeId, FloorMat> = {
  catacombs: {
    stone: R(0x16120f, 0x231d18, 0x332a23, 0x453930, 0x5a4b3e),
    alt: R(0x131315, 0x1e1d20, 0x2b292d, 0x3b383d, 0x4f4b51),
    mortar: 0x090706,
    dust: 0x2a2420,
    growth: MATERIALS.mossDark,
    water: R(0x070c10, 0x0e1a20, 0x1c3038, 0x46707e, 0x9cc4cc),
    gloss: 0,
    groutDepth: 2.4,
  },
  flooded: {
    stone: R(0x0a1013, 0x131c20, 0x1d2a30, 0x2a3c44, 0x40585f),
    alt: R(0x0c110e, 0x161e19, 0x222c24, 0x313f33, 0x46574a),
    mortar: 0x040809,
    dust: 0x0e1c18,
    growth: R(0x0a2014, 0x14381e, 0x24582a, 0x3e7a3a, 0x6aa850),
    water: R(0x050f18, 0x0b1c28, 0x15303e, 0x3a6a7e, 0x9cd0e0),
    gloss: 0.7,
    groutDepth: 2.2,
  },
  ossuary: {
    stone: R(0x2a2218, 0x433727, 0x5d4e39, 0x786950, 0x948466),
    alt: R(0x1d1711, 0x2f261b, 0x423727, 0x574a36, 0x6f5f47),
    mortar: 0x120d08,
    dust: 0x5a4c38,
    growth: R(0x1c140c, 0x2e2216, 0x443322, 0x5a4630),
    water: R(0x0c0a08, 0x1a1612, 0x2c261e, 0x5a5040, 0x8a8070),
    gloss: 0,
    groutDepth: 1.8,
  },
  sanctum: {
    stone: R(0x070509, 0x100c11, 0x1a141a, 0x282026, 0x3c3038),
    alt: R(0x110305, 0x1d0508, 0x2b080d, 0x3f1016, 0x581c22),
    mortar: 0x050304,
    dust: 0x1a0c0e,
    growth: R(0x4a3008, 0x8a6418, 0xc89a30, 0xf0d070, 0xfff4c0),
    water: R(0x180204, 0x380509, 0x660d13, 0x9c1e26, 0xe05a5a),
    gloss: 0.9,
    groutDepth: 1.2,
  },
  fungal: {
    stone: R(0x1a1612, 0x2a241d, 0x3c342a, 0x524638, 0x6a5c4a),
    alt: R(0x150f09, 0x22180f, 0x322316, 0x42301e, 0x564028),
    mortar: 0x070402,
    dust: 0x1f160e,
    growth: R(0x091409, 0x112311, 0x1a3618, 0x284e20, 0x3c6c2a),
    water: R(0x061210, 0x0e2420, 0x184038, 0x34887a, 0x9af0d8),
    gloss: 0,
    groutDepth: 2.6,
  },
  forge: {
    stone: R(0x09090b, 0x121215, 0x1c1b20, 0x28262d, 0x39353f),
    alt: R(0x0d0b0b, 0x171313, 0x231d1c, 0x312827, 0x433634),
    mortar: 0x030203,
    dust: 0x2a2626,
    growth: R(0x5a0e02, 0xb02a04, 0xff6a0e, 0xffb040, 0xfff0a0),
    water: R(0x5a0e02, 0xb02a04, 0xff6a0e, 0xffb040, 0xfff0a0),
    gloss: 0.15,
    groutDepth: 2.8,
  },
  frost: {
    stone: R(0x1d2838, 0x2a394d, 0x3b4f66, 0x526a86, 0x7690ae),
    alt: R(0x222a36, 0x303b4a, 0x425062, 0x5a6a82, 0x7c8ea6),
    mortar: 0x0a121c,
    dust: 0x9aaac0,
    growth: R(0x8a9ab0, 0xb4c4d8, 0xdce8f6, 0xf6faff),
    water: R(0x2a4a6a, 0x4a7aa0, 0x8ac0e8, 0xc8ecff, 0xffffff),
    gloss: 0.8,
    groutDepth: 2,
  },
  sky: {
    stone: R(0x3a3428, 0x5a5040, 0x7c705a, 0xa09478, 0xc8bc9c),
    alt: R(0x2e3424, 0x485238, 0x667050, 0x88926a, 0xaab48a),
    mortar: 0x182010,
    dust: 0x4a5a26,
    growth: R(0x1a2a10, 0x2c4418, 0x44661e, 0x64902a, 0x90bc44),
    water: R(0x163a5a, 0x2a6a94, 0x4a9ac4, 0x8ad0ee, 0xe0f8ff),
    gloss: 0,
    groutDepth: 1.6,
  },
  moon: {
    stone: R(0x2a2b30, 0x3e4046, 0x56585f, 0x70727a, 0x9496a2),
    alt: R(0x1e1f24, 0x2e3036, 0x42444c, 0x5a5c66, 0x787a86),
    mortar: 0x0e0f13,
    dust: 0x6a6c74,
    growth: R(0x4a4c54, 0x6a6c76, 0x8e909a, 0xb4b6c0, 0xdcdee6),
    water: R(0x10203a, 0x1c3a66, 0x3a6aa0, 0x7aa8d8, 0xc8e4ff),
    gloss: 0.1,
    groutDepth: 1.2,
  },
  server: {
    stone: R(0x101318, 0x1a1e26, 0x262c38, 0x36404e, 0x4e5a6e),
    alt: R(0x0c0d12, 0x14161c, 0x1e2128, 0x2a2e38, 0x3c4250),
    mortar: 0x020304,
    dust: 0x1a1e26,
    growth: R(0x04303a, 0x08606e, 0x10a8b8, 0x50f0ff, 0xc8ffff),
    water: R(0x02181e, 0x063a44, 0x0e7080, 0x30c8d8, 0xb0fcff),
    gloss: 0.5,
    groutDepth: 1.4,
  },
};

export const LAVA = R(0x4a0a02, 0x9a2204, 0xf05a0a, 0xffa838, 0xfff0a0);
export const MYCELIUM = R(0x123a34, 0x1e7064, 0x3ab8a0, 0x9af4dc, 0xe8fff8);
export const GOLD = R(0x4a3008, 0x8a6418, 0xc89a30, 0xf0d070, 0xfff4c0);
/** Riveted deck plate for the themes built of metal rather than stone (slabs, dais, steps, risers). */
const PLATE: Partial<Record<ThemeId, Ramp>> = {
  moon: R(0x2a2e36, 0x48505e, 0x6e7a8c, 0x9aa8bc, 0xd0dcec),
  server: R(0x14171e, 0x262c38, 0x3a4256, 0x56607a, 0x8a96b0),
};
/** The server room's magenta curse-light (glyphs, warning marks). */
export const CURSE = R(0x3a0838, 0x7a1070, 0xd020c0, 0xff70f0, 0xffd0ff);

export interface FloorMacro {
  col: Uint32Array;
  h: Float32Array;
  glow: Uint32Array | null;
}

const W = (x: number): number => ((x % S) + S) % S;

const nfCache = new Map<number, Float32Array>();
const fbCache = new Map<number, Float32Array>();
/** Memoised periodic noise field over the macro (cleared after each macro build). */
function N(cell: number, seed: number): Float32Array {
  const k = cell * 1e6 + seed;
  let f = nfCache.get(k);
  if (!f) {
    f = noiseField(S, cell, seed);
    nfCache.set(k, f);
  }
  return f;
}
function FB(seed: number, cells: readonly number[]): Float32Array {
  const k = seed * 10000 + cells[0]! * 10 + cells.length;
  let f = fbCache.get(k);
  if (!f) {
    f = fbmField(S, seed, cells);
    fbCache.set(k, f);
  }
  return f;
}

function crackWalk(m: FloorMacro, rnd: () => number, x: number, y: number, len: number, dark: number, hi: number, depth: number, glow?: Ramp): void {
  let a = rnd() * Math.PI * 2;
  for (let k = 0; k < len; k++) {
    a += (rnd() - 0.5) * 0.9;
    x += Math.cos(a);
    y += Math.sin(a);
    const i = W(Math.round(y)) * S + W(Math.round(x));
    m.col[i] = glow ? glow[2 + (k % 3 === 0 ? 1 : 0)]! : dark;
    m.h[i] = m.h[i]! - depth;
    if (glow && m.glow) {
      m.glow[i] = (0xff000000 | glow[k % 4 === 0 ? 4 : 3]!) >>> 0;
      const j = W(Math.round(y) - 1) * S + W(Math.round(x));
      if (!m.glow[j]) m.glow[j] = (0x70000000 | glow[2]!) >>> 0;
    } else if (k % 2) {
      const j = W(Math.round(y) - 1) * S + W(Math.round(x));
      m.col[j] = mixc(m.col[j]!, hi, 0.5);
    }
    if (rnd() < 0.08) a += (rnd() < 0.5 ? 1 : -1) * 1.2;
  }
}

function stoneSizes(kind: 'mixed' | 'big' | 'small'): (r: number) => [number, number] {
  if (kind === 'big') return (r) => (r < 0.1 ? [2, 1] : r < 0.2 ? [1, 2] : r < 0.45 ? [2, 2] : r < 0.65 ? [3, 2] : r < 0.85 ? [2, 3] : [3, 3]);
  if (kind === 'small') return (r) => (r < 0.5 ? [1, 1] : r < 0.75 ? [2, 1] : r < 0.95 ? [1, 2] : [2, 2]);
  return (r) => (r < 0.16 ? [1, 1] : r < 0.38 ? [2, 1] : r < 0.58 ? [1, 2] : r < 0.76 ? [2, 2] : r < 0.87 ? [3, 2] : r < 0.95 ? [2, 3] : [3, 3]);
}

/** Generic flagstone floor: mixed stones, bevels, grout, sunken/cracked/missing stones. */
function flagstones(theme: ThemeId, seed: number, opts: { sizes: 'mixed' | 'big' | 'small'; wobble: number; altP: number; sunkP: number; missP: number; crackP: number; water?: boolean }): FloorMacro {
  const M = FLOOR_MATS[theme];
  const rnd = rng(seed);
  const cell = 8;
  const n = S / cell;
  const { owner, stones } = packStones(n, rnd, stoneSizes(opts.sizes));
  const { id, dist } = stoneField(S, cell, owner, opts.wobble, seed + 11);
  const m: FloorMacro = { col: new Uint32Array(S * S), h: new Float32Array(S * S), glow: null };
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const st = stones[id[i]!]!;
      const d = dist[i]!;
      const sunk = st.r1 < opts.sunkP;
      const miss = st.r1 > 1 - opts.missP;
      const tilt = ((st.r3 - 0.5) * (x - st.cx * cell) + (st.r2 - 0.5) * (y - st.cy * cell)) * 0.035;
      let h = bevel(d, M.groutDepth) + (sunk ? -1.1 : 0) + tilt + (N(4, seed + 5)[i]! - 0.5) * 0.35;
      if (miss) h = -M.groutDepth - 0.6 + N(4, seed + 6)[i]! * 0.9;
      m.h[i] = h;
    }
  // colour with baked NW light from the height field
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const st = stones[id[i]!]!;
      const d = dist[i]!;
      const ramp = st.r0 < opts.altP ? M.alt : M.stone;
      const sunk = st.r1 < opts.sunkP;
      const miss = st.r1 > 1 - opts.missP;
      const gx = m.h[y * S + W(x + 1)]! - m.h[y * S + W(x - 1)]!;
      const gy = m.h[W(y + 1) * S + x]! - m.h[W(y - 1) * S + x]!;
      const shade = (gx + gy) * 0.45;
      let c: number;
      if (miss) {
        // a stone is gone: packed dirt and pebbles in the hole
        const pn = N(4, seed + 21)[i]!;
        c = pn > 0.66 ? tone(M.stone, 1 + pn * 1.4 + bayer(x, y) * 0.4) : mixc(M.mortar, M.dust, 0.25 + N(8, seed + 22)[i]! * 0.45 + bayer(x, y) * 0.08);
      } else if (d === 0) {
        const g = N(8, seed + 31)[i]!;
        c = g > 0.72 ? tone(M.growth, 1 + (g - 0.72) * 6) : mixc(M.mortar, M.dust, N(4, seed + 32)[i]! * 0.55);
      } else {
        let v = 1.55 + st.r2 * 1.05 + (FB(seed + 41, [16, 8, 4])[i]! - 0.5) * 1.1 + bayer(x, y) * 0.32 + shade + (sunk ? -0.45 : 0);
        if (d === 1 && shade > 0.2) v += 0.35;
        c = tone(ramp, v);
        if (M.gloss > 0 && d <= 2 && shade > 0.25 && hashi(x, y, seed + 51) < M.gloss * 0.5) c = mixc(c, 0xdcecf4, 0.35 * M.gloss);
      }
      m.col[i] = c;
    }
  // grime: low-frequency darkening + light dust drifts
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const g = FB(seed + 61, [64, 32, 16])[i]!;
      if (g > 0.6) m.col[i] = mixc(m.col[i]!, 0x050403, Math.min(0.55, (g - 0.6) * 2.2));
      else if (g < 0.3) m.col[i] = mixc(m.col[i]!, M.dust, (0.3 - g) * 0.8);
    }
  // cracks across some stones
  for (const st of stones) {
    if (st.r2 >= opts.crackP) continue;
    const cx = st.cx * cell + st.w * cell * 0.5;
    const cy = st.cy * cell + st.h * cell * 0.5;
    crackWalk(m, rnd, cx, cy, 6 + Math.floor(st.r3 * 10), M.mortar, tone(M.stone, 3), 0.9);
  }
  // standing water in sunken stones
  if (opts.water) {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const st = stones[id[i]!]!;
        if (!(st.r1 < opts.sunkP && st.r0 > 0.35)) continue;
        const ripple = Math.sin((x + y * 0.5) * 0.9 + N(8, seed + 72)[i]! * 6);
        let c = tone(M.water, 0.9 + N(8, seed + 73)[i]! * 1.3 + bayer(x, y) * 0.3);
        if (ripple > 0.985) c = M.water[3]!;
        else if (dist[i]! === 1) c = M.water[0]!;
        if (hashi(x, y, seed + 74) > 0.995) c = M.water[4]!;
        m.col[i] = c;
        m.h[i] = -1.4;
      }
  }
  return m;
}

function macroCatacombs(): FloorMacro {
  const seed = 9101;
  const m = flagstones('catacombs', seed, { sizes: 'mixed', wobble: 1.5, altP: 0.22, sunkP: 0.14, missP: 0.035, crackP: 0.2 });
  const rnd = rng(seed + 5);
  // bone grit and pebbles in the dirt
  for (let k = 0; k < 90; k++) {
    const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S);
    const c = rnd() < 0.4 ? MATERIALS.boneDry[1]! : FLOOR_MATS.catacombs.stone[3]!;
    m.col[y * S + x] = c;
    m.col[y * S + W(x + 1)] = mixc(c, 0x000000, 0.4);
  }
  return m;
}

function macroFlooded(): FloorMacro {
  const seed = 9202;
  const m = flagstones('flooded', seed, { sizes: 'big', wobble: 1.8, altP: 0.3, sunkP: 0.3, missP: 0.03, crackP: 0.14, water: true });
  const M = FLOOR_MATS.flooded;
  // algae creeping out of the joints across the stone edges
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (m.h[i]! < -1.3) continue;
      const g = FB(seed + 81, [32, 16, 8])[i]!;
      if (g > 0.6 && m.h[i]! < -0.2) m.col[i] = tone(M.growth, 0.8 + (g - 0.6) * 9 + bayer(x, y) * 0.5);
      else if (g > 0.7) m.col[i] = mixc(m.col[i]!, M.growth[2]!, 0.35);
    }
  return m;
}

function macroOssuary(): FloorMacro {
  const seed = 9303;
  const M = FLOOR_MATS.ossuary;
  const cell = 16;
  const n = S / cell;
  const owner = new Int32Array(n * n);
  for (let k = 0; k < n * n; k++) owner[k] = k;
  const { id, dist } = stoneField(S, cell, owner, 0.6, seed);
  const m: FloorMacro = { col: new Uint32Array(S * S), h: new Float32Array(S * S), glow: null };
  const band = (v: number): number => {
    const p = ((v % 128) + 128) % 128;
    return p >= 60 && p < 68 ? p - 60 : -1;
  };
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const sid = id[i]!;
      const sx = sid % n, sy = (sid / n) | 0;
      const ramp = (sx + sy) % 2 ? M.alt : M.stone;
      const d = dist[i]!;
      m.h[i] = bevel(d, M.groutDepth) + (N(4, seed + 3)[i]! - 0.5) * 0.3;
      const v = 1.7 + hashi(sx, sy, seed) * 0.8 + (FB(seed + 4, [16, 8, 4])[i]! - 0.5) * 0.9 + bayer(x, y) * 0.3 + (d === 1 ? 0.25 : 0);
      m.col[i] = d === 0 ? M.mortar : tone(ramp, v);
    }
  // bone mosaic bands every four tiles, tiny skulls where the bands cross
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const bx = band(x), by = band(y);
      if (bx < 0 && by < 0) continue;
      const i = y * S + x;
      const tx = Math.floor(x / 2), ty = Math.floor(y / 2);
      const edge = (bx === 0 || bx === 7) && by < 0 ? true : (by === 0 || by === 7) && bx < 0;
      const groove = x % 2 === 1 || y % 2 === 1;
      if (edge) {
        m.col[i] = 0x0e0a07;
        m.h[i] = -1.2;
        continue;
      }
      const pale = hashi(tx, ty, seed + 9) > 0.35;
      m.col[i] = groove ? mixc(M.mortar, M.dust, 0.3) : pale ? tone(MATERIALS.boneDry, 2 + hashi(tx, ty, seed + 10) * 1.6) : tone(M.alt, 1.5);
      m.h[i] = groove ? -0.7 : 0.15;
    }
  const p = new Painter(new PixelBuffer(S, S));
  for (const cx of [64, 192])
    for (const cy of [64, 192]) {
      p.ellipse(cx, cy - 0.5, 4.6, 4.2).fill(MATERIALS.boneDry, { mode: 'sphere' });
      p.rect(cx - 2.4, cy + 2.6, 4.8, 2.2).fill(MATERIALS.boneDry, { mode: 'emboss', light: -0.2 });
      p.px(cx - 2, cy, 0x140c08).px(cx - 1, cy, 0x140c08).px(cx + 1, cy, 0x140c08).px(cx + 2, cy, 0x140c08).px(cx, cy + 2, 0x241810);
    }
  const r = rng(seed + 20);
  for (let k = 0; k < 60; k++) {
    const x = 4 + r() * (S - 8), y = 4 + r() * (S - 8);
    if (band(Math.round(x)) >= 0 || band(Math.round(y)) >= 0) continue;
    const a = r() * Math.PI;
    const L = 1.2 + r() * 2.2;
    p.capsule(x - Math.cos(a) * L, y - Math.sin(a) * L, x + Math.cos(a) * L, y + Math.sin(a) * L, 0.6, 0.6).fill(MATERIALS.boneDry, { mode: 'emboss', inner: false, light: -0.1 });
  }
  stampPainted(m, p.buf, 1.1);
  return m;
}

function macroSanctum(): FloorMacro {
  const seed = 9404;
  const M = FLOOR_MATS.sanctum;
  const m: FloorMacro = { col: new Uint32Array(S * S), h: new Float32Array(S * S), glow: new Uint32Array(S * S) };
  const id = new Int32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) id[y * S + x] = Math.floor(W(y + 16) / 32) * 8 + Math.floor(W(x + 16) / 32);
  const dist = jointDistance(id, S, 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const sid = id[i]!;
      const sx = sid % 8, sy = (sid / 8) | 0;
      const ramp = (sx + sy) % 2 ? M.alt : M.stone;
      const d = dist[i]!;
      if (d === 0) {
        m.col[i] = (x + y) % 3 === 0 ? GOLD[3]! : GOLD[2]!;
        m.h[i] = 0.1;
        continue;
      }
      if (d === 1) {
        m.col[i] = 0x040203;
        m.h[i] = -0.9;
        continue;
      }
      const vein = Math.abs(Math.sin((x * 0.35 + y * 0.2 + (N(32, seed + 1)[i]! * 1.4 + N(8, seed + 2)[i]! * 0.5 + hashi(sid, 5, seed)) * 7) * 0.8));
      let v = 1.9 + hashi(sx, sy, seed) * 0.6 + (FB(seed + 4, [32, 16, 8])[i]! - 0.5) * 0.7 + bayer(x, y) * 0.22;
      // polished slab: a soft reflection band across each slab
      const lx = W(x + 16) % 32, ly = W(y + 16) % 32;
      if (Math.abs(lx - ly - 6) < 2.5 && lx > 4 && ly < 28) v += 0.35;
      let c = tone(ramp, v);
      if (vein > 0.992 && hashi(sid, 6, seed) > 0.3) c = mixc(c, 0xc0a8b0, 0.28);
      m.col[i] = c;
      m.h[i] = (N(8, seed + 7)[i]! - 0.5) * 0.12;
    }
  // gold four-point stars where slab corners meet
  for (let cy = 0; cy < 8; cy++)
    for (let cx = 0; cx < 8; cx++) {
      const ox = cx * 32 + 16 - 0.5, oy = cy * 32 + 16 - 0.5;
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          if (Math.abs(dx) + Math.abs(dy) * 2.2 > 4.2 && Math.abs(dy) + Math.abs(dx) * 2.2 > 4.2) continue;
          const i = W(Math.round(oy + dy)) * S + W(Math.round(ox + dx));
          m.col[i] = dx + dy < 0 ? GOLD[3]! : GOLD[1]!;
          m.h[i] = 0.3;
        }
    }
  return m;
}

function macroFungal(): FloorMacro {
  const seed = 9505;
  const M = FLOOR_MATS.fungal;
  const rnd = rng(seed);
  const cell = 8;
  const n = S / cell;
  const { owner, stones } = packStones(n, rnd, stoneSizes('small'));
  const { id, dist } = stoneField(S, cell, owner, 3, seed + 1, 5);
  const m: FloorMacro = { col: new Uint32Array(S * S), h: new Float32Array(S * S), glow: new Uint32Array(S * S) };
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const st = stones[id[i]!]!;
      const isStone = st.r0 < 0.36 && dist[i]! >= 1;
      const loam = FB(seed + 3, [32, 16, 8, 4])[i]!;
      const moss = FB(seed + 4, [64, 32, 16])[i]!;
      if (isStone) {
        const d = dist[i]!;
        m.h[i] = 0.6 + Math.min(d, 4) * 0.35;
        m.col[i] = tone(M.stone, 1.3 + st.r2 + (d <= 1 ? -0.5 : 0) + (loam - 0.5) + bayer(x, y) * 0.3);
        if (moss > 0.62) m.col[i] = tone(M.growth, 1.2 + (moss - 0.62) * 7 + bayer(x, y) * 0.5);
      } else {
        m.h[i] = (loam - 0.5) * 1.2;
        m.col[i] = tone(M.alt, 1.2 + loam * 2 + bayer(x, y) * 0.35);
        if (moss > 0.58) m.col[i] = tone(M.growth, 0.7 + (moss - 0.58) * 7 + bayer(x, y) * 0.5);
      }
    }
  // glowing mycelium threads wandering through the loam
  for (let k = 0; k < 7; k++) {
    let x = rnd() * S, y = rnd() * S;
    let a = rnd() * Math.PI * 2;
    const len = 18 + rnd() * 30;
    for (let s = 0; s < len; s++) {
      a += (rnd() - 0.5) * 0.7;
      x += Math.cos(a);
      y += Math.sin(a);
      const i = W(Math.round(y)) * S + W(Math.round(x));
      m.col[i] = MYCELIUM[s % 5 === 0 ? 3 : 2]!;
      m.glow![i] = ((s % 5 === 0 ? 0xa0000000 : 0x58000000) | MYCELIUM[s % 5 === 0 ? 3 : 2]!) >>> 0;
      if (rnd() < 0.05) {
        let bx = x, by = y, ba = a + (rnd() < 0.5 ? 1.2 : -1.2);
        for (let t = 0; t < 8; t++) {
          bx += Math.cos(ba);
          by += Math.sin(ba);
          ba += (rnd() - 0.5) * 0.6;
          const j = W(Math.round(by)) * S + W(Math.round(bx));
          m.col[j] = MYCELIUM[1]!;
          m.glow![j] = (0x40000000 | MYCELIUM[2]!) >>> 0;
        }
      }
    }
  }
  for (let k = 0; k < 70; k++) {
    const i = Math.floor(rnd() * S) * S + Math.floor(rnd() * S);
    const pink = rnd() < 0.3;
    m.col[i] = pink ? 0xff9ae8 : MYCELIUM[3]!;
    m.glow![i] = (0x90000000 | (pink ? 0xd040b8 : MYCELIUM[2]!)) >>> 0;
  }
  return m;
}

function macroForge(): FloorMacro {
  const seed = 9606;
  const M = FLOOR_MATS.forge;
  const m: FloorMacro = { col: new Uint32Array(S * S), h: new Float32Array(S * S), glow: new Uint32Array(S * S) };
  const G = 16;
  const centers: [number, number][] = [];
  for (let j = 0; j < G; j++)
    for (let i = 0; i < G; i++) centers.push([i * 16 + (j % 2) * 8 + (hashi(i, j, seed) - 0.5) * 5, j * 16 + (hashi(i, j, seed + 1) - 0.5) * 5]);
  const id = new Int32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const j0 = Math.floor(y / 16), i0 = Math.floor(x / 16);
      let best = 0, bd = 1e9;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const j = (j0 + dj + G) % G, i = (i0 + di + G) % G;
          const c = centers[j * G + i]!;
          let dx = x - c[0], dy = y - c[1];
          if (dx > S / 2) dx -= S;
          if (dx < -S / 2) dx += S;
          if (dy > S / 2) dy -= S;
          if (dy < -S / 2) dy += S;
          const d = dx * dx + dy * dy * 1.1;
          if (d < bd) {
            bd = d;
            best = j * G + i;
          }
        }
      id[y * S + x] = best;
    }
  const dist = jointDistance(id, S, 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const sid = id[i]!;
      const d = dist[i]!;
      const hot = FB(seed + 5, [64, 32, 16])[i]!;
      const lift = (hashi(sid, 0, seed + 2) - 0.5) * 1.2;
      m.h[i] = bevel(d, M.groutDepth) + lift;
      if (d === 0) {
        if (hot > 0.64) {
          const c = tone(LAVA, 1.4 + (hot - 0.64) * 9 + bayer(x, y) * 0.4);
          m.col[i] = c;
          m.glow![i] = ((hot > 0.7 ? 0xc0000000 : 0x70000000) | LAVA[2]!) >>> 0;
          m.h[i] = -M.groutDepth - 0.4;
        } else m.col[i] = M.mortar;
        continue;
      }
      let v = 1.6 + hashi(sid, 1, seed + 3) * 0.9 + (FB(seed + 6, [16, 8, 4])[i]! - 0.5) * 0.9 + bayer(x, y) * 0.3 + (d === 1 ? -0.35 : 0);
      if (lift > 0.35 && d === 1) v += 0.6;
      let c = tone(hashi(sid, 2, seed) < 0.25 ? M.alt : M.stone, v);
      if (hot > 0.62 && d <= 2) c = mixc(c, LAVA[1]!, (hot - 0.62) * 1.5);
      const soot = FB(seed + 7, [32, 16])[i]!;
      if (soot > 0.62) c = mixc(c, 0x020202, (soot - 0.62) * 2);
      if (hashi(x, y, seed + 8) > 0.992) c = M.dust;
      m.col[i] = c;
    }
  return m;
}

function macroFrost(): FloorMacro {
  const seed = 9707;
  const M = FLOOR_MATS.frost;
  const m = flagstones('frost', seed, { sizes: 'mixed', wobble: 1.3, altP: 0.25, sunkP: 0.16, missP: 0.02, crackP: 0.22 });
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const sn = FB(seed + 91, [64, 32, 16, 8])[i]! + (m.h[i]! < -1 ? 0.14 : m.h[i]! < -0.3 ? 0.07 : 0);
      if (sn > 0.69) {
        const k = Math.min(1, (sn - 0.69) * 4);
        m.col[i] = mixc(m.col[i]!, tone(M.growth, 0.2 + k * 1.7 + bayer(x, y) * 0.5), 0.45 + k * 0.5);
        m.h[i] = m.h[i]! * (1 - k) + 0.4 * k;
      } else if (sn > 0.62 && hashi(x, y, seed + 92) > 0.75) m.col[i] = mixc(m.col[i]!, M.growth[0]!, 0.35);
      const ice = FB(seed + 93, [64, 32])[i]!;
      if (ice > 0.76 && sn <= 0.69) {
        m.col[i] = mixc(m.col[i]!, 0x8abce0, 0.26);
        m.h[i] = m.h[i]! * 0.3;
        if (hashi(x, y, seed + 94) > 0.985) m.col[i] = 0xe8f8ff;
      }
      if (hashi(x, y, seed + 95) > 0.997) m.col[i] = 0xffffff;
    }
  return m;
}

/** Sky shard: windblown turf over the old sandstone paving that still breaks through in patches, wildflowers, bare earth. */
function macroSky(): FloorMacro {
  const seed = 9808;
  const M = FLOOR_MATS.sky;
  const m = flagstones('sky', seed, { sizes: 'big', wobble: 1.6, altP: 0.4, sunkP: 0.1, missP: 0.06, crackP: 0.2 });
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const pave = FB(seed + 11, [64, 32, 16])[i]!;
      const turf = FB(seed + 12, [32, 16, 8, 4])[i]!;
      const blade = hashi(x, y, seed + 13);
      // paving shows where the turf is thin; grass always fills its joints
      const grassy = pave < 0.52 || m.h[i]! < -0.4 || (pave < 0.58 && blade > 0.55);
      if (!grassy) continue;
      let v = 0.9 + turf * 2.5 + bayer(x, y) * 0.4;
      // blades: a lit tip over a dark root, leaning with the wind (period 4 texels)
      if (blade > 0.8) v += 1.1;
      else if (blade < 0.12) v -= 0.8;
      let c = tone(M.growth, v);
      const bare = FB(seed + 14, [64, 32])[i]!;
      if (bare > 0.7) c = mixc(c, tone(R(0x2a1e12, 0x44321e, 0x60482c, 0x7c623e, 0x9a7e54), 1.4 + turf * 2), Math.min(1, (bare - 0.7) * 5));
      m.col[i] = c;
      m.h[i] = (turf - 0.5) * 0.9 + (blade > 0.8 ? 0.5 : blade < 0.12 ? -0.4 : 0);
    }
  // wildflowers and clover in the turf
  const rnd = rng(seed + 20);
  for (let k = 0; k < 160; k++) {
    const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S);
    const i = y * S + x;
    if (FB(seed + 11, [64, 32, 16])[i]! >= 0.52) continue;
    const c = rnd() < 0.45 ? 0xfff4b8 : rnd() < 0.5 ? 0xf0b0d8 : 0xffffff;
    m.col[i] = c;
    m.col[y * S + W(x + 1)] = mixc(c, 0x000000, 0.25);
    m.col[W(y + 1) * S + x] = M.growth[1]!;
    m.h[i] = 0.8;
  }
  return m;
}

/** Moon: regolith fine-grained and grey, dark mare basalt, impact craters with lit rims and shadowed bowls, scattered rocks. */
function macroMoon(): FloorMacro {
  const seed = 9909;
  const M = FLOOR_MATS.moon;
  const m: FloorMacro = { col: new Uint32Array(S * S), h: new Float32Array(S * S), glow: null };
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const g = FB(seed + 1, [32, 16, 8, 4])[i]!;
      const mare = FB(seed + 2, [128, 64, 32])[i]!;
      m.h[i] = (g - 0.5) * 1.2;
      const ramp = mare > 0.6 ? M.alt : M.stone;
      let c = tone(ramp, 1.5 + g * 2 + bayer(x, y) * 0.45 + (hashi(x, y, seed + 3) - 0.5) * 0.6);
      if (mare > 0.56 && mare <= 0.6) c = mixc(c, M.alt[2]!, 0.5);
      m.col[i] = c;
    }
  // craters (wrapping, so the macro stays seamless); the light comes from the north-west
  const rnd = rng(seed + 10);
  const craters: [number, number, number][] = [];
  for (let k = 0; k < 14; k++) craters.push([rnd() * S, rnd() * S, k < 3 ? 14 + rnd() * 10 : 3 + rnd() * 7]);
  for (const [cx, cy, r] of craters) {
    const R0 = Math.ceil(r * 1.5);
    for (let dy = -R0; dy <= R0; dy++)
      for (let dx = -R0; dx <= R0; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d > 1.45) continue;
        const i = W(Math.round(cy + dy)) * S + W(Math.round(cx + dx));
        const lit = (dx + dy) / (Math.hypot(dx, dy) + 0.001);   // + faces the light inside the bowl's far wall
        if (d < 0.9) {
          // the bowl: the near (north-west) inner wall in shadow, the far wall catching the light
          const v = 1.2 + lit * 0.9 * (d / 0.9) + bayer(dx & 31, dy & 31) * 0.3 - (1 - d) * 0.5;
          m.col[i] = tone(M.alt, v);
          m.h[i] = -1.6 * (1 - d * d);
        } else if (d < 1.12) {
          m.col[i] = tone(M.stone, (lit < 0 ? 3.6 : 2.3) + bayer(dx & 31, dy & 31) * 0.4);
          m.h[i] = 0.9;
        } else {
          // ejecta: pale dust thrown out in rays
          const ray = Math.abs(Math.sin(Math.atan2(dy, dx) * 5 + cx)) > 0.7;
          if (ray && hashi(dx, dy, seed + 11) > 0.4) m.col[i] = mixc(m.col[i]!, M.growth[3]!, 0.35);
        }
      }
  }
  // loose rocks: a lit top, a dark shadow to the south-east
  for (let k = 0; k < 120; k++) {
    const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S);
    const big = rnd() < 0.25;
    m.col[y * S + x] = M.stone[4]!;
    m.h[y * S + x] = 1;
    if (big) { m.col[y * S + W(x + 1)] = M.stone[3]!; m.h[y * S + W(x + 1)] = 0.8; }
    m.col[W(y + 1) * S + W(x + (big ? 2 : 1))] = M.mortar;
  }
  return m;
}

/** Server room: a raised access floor of 16-texel steel panels: perforated vents, cable cutouts, glowing seams below. */
function macroServer(): FloorMacro {
  const seed = 10010;
  const M = FLOOR_MATS.server;
  const m: FloorMacro = { col: new Uint32Array(S * S), h: new Float32Array(S * S), glow: new Uint32Array(S * S) };
  const P = 16;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const px = Math.floor(x / P), py = Math.floor(y / P), lx = x % P, ly = y % P;
      const e = Math.min(lx, ly, P - 1 - lx, P - 1 - ly);
      const kind = hashi(px, py, seed);
      const ramp = hashi(px, py, seed + 1) < 0.3 ? M.alt : M.stone;
      if (e === 0) {
        // the seam: dark, and on some rows a strip of cyan light under the floor
        const lightRow = (ly === 0 && hashi(Math.floor(x / 64), py, seed + 2) < 0.18) || (lx === 0 && hashi(px, Math.floor(y / 64), seed + 3) < 0.12);
        m.col[i] = lightRow ? M.growth[3]! : M.mortar;
        m.h[i] = -1.2;
        if (lightRow) m.glow![i] = (0xc0000000 | M.growth[3]!) >>> 0;
        continue;
      }
      let v = 2 + (FB(seed + 4, [32, 16])[i]! - 0.5) * 0.5 + bayer(x, y) * 0.22 + (e === 1 ? (lx === 1 || ly === 1 ? 0.9 : -0.6) : 0);
      let h = e === 1 ? 0.3 : 0.6;
      if (kind < 0.22 && e >= 3) {
        // perforated vent panel: a grid of holes over the dark plenum
        if ((lx - 3) % 2 === 0 && (ly - 3) % 2 === 0) { v = 0.2; h = -0.8; }
      } else if (kind < 0.3 && e >= 3 && lx >= 4 && lx <= 11 && ly >= 5 && ly <= 10) {
        // cable cutout with a brush grommet; the cables run on under the floor
        v = 0.3;
        h = -1;
        if (ly === 7 || ly === 8) { m.col[i] = (lx % 3 === 0 ? 0x6a1c18 : lx % 3 === 1 ? 0x164a62 : 0x2a2a32); m.h[i] = -0.6; continue; }
      } else if (kind > 0.93 && e >= 4 && lx >= 5 && lx <= 10 && ly >= 5 && ly <= 10) {
        // a glowing grille: cold air rising through the floor
        if ((lx + ly) % 2 === 0) { m.col[i] = M.growth[2]!; m.glow![i] = (0x70000000 | M.growth[2]!) >>> 0; m.h[i] = -0.6; continue; }
        v = 0.4;
      }
      let c = tone(ramp, v);
      // rivets in the panel corners, scuffs where boots and carts go
      if ((lx === 2 || lx === P - 3) && (ly === 2 || ly === P - 3)) { c = M.stone[4]!; h = 0.9; }
      const scuff = FB(seed + 5, [64, 32, 16])[i]!;
      if (scuff > 0.66) c = mixc(c, 0x040506, (scuff - 0.66) * 1.6);
      if (hashi(x, y, seed + 6) > 0.995) c = M.stone[4]!;
      m.col[i] = c;
      m.h[i] = h;
    }
  return m;
}

/** Blend a painted texel buffer (bones, skulls) into a macro, raising its height by luminance. */
function stampPainted(m: FloorMacro, buf: PixelBuffer, k: number): void {
  for (let i = 0; i < S * S; i++) {
    const c = buf.data[i]!;
    const a = c >>> 24;
    if (!a) continue;
    m.col[i] = a >= 255 ? c & 0xffffff : mixc(m.col[i]!, c & 0xffffff, a / 255);
    m.h[i] = Math.max(m.h[i]!, 0.3 + luma(c & 0xffffff) * k);
  }
}

const MACROS: Record<ThemeId, () => FloorMacro> = {
  catacombs: macroCatacombs,
  flooded: macroFlooded,
  ossuary: macroOssuary,
  sanctum: macroSanctum,
  fungal: macroFungal,
  forge: macroForge,
  frost: macroFrost,
  sky: macroSky,
  moon: macroMoon,
  server: macroServer,
};

const macroCache = new Map<ThemeId, FloorMacro>();
export function floorMacro(theme: ThemeId): FloorMacro {
  let m = macroCache.get(theme);
  if (!m) {
    m = MACROS[theme]();
    nfCache.clear();
    fbCache.clear();
    macroCache.set(theme, m);
  }
  return m;
}

// ---------------------------------------------------------------- frames

export interface FloorFrames {
  /** MACRO*MACRO diamond frames, ARGB */
  col: PixelBuffer[];
  nrm: PixelBuffer[];
  /** emissive frames (only for FLOOR_GLOW_THEMES) */
  glow: PixelBuffer[] | null;
}

/** The floor frame for world tile (x, y). */
export function isoFloorFrame(x: number, y: number): number {
  return (((x % MACRO) + MACRO) % MACRO) + (((y % MACRO) + MACRO) % MACRO) * MACRO;
}

export function buildFloorFrames(theme: ThemeId): FloorFrames {
  const m = floorMacro(theme);
  const nm = floorNormals(m.h, S, 0.55);
  const col: PixelBuffer[] = [];
  const nrm: PixelBuffer[] = [];
  const glow: PixelBuffer[] | null = m.glow ? [] : null;
  for (let ty = 0; ty < MACRO; ty++)
    for (let tx = 0; tx < MACRO; tx++) {
      const c = new PixelBuffer(DW, DH);
      const n = new PixelBuffer(DW, DH);
      const g = m.glow ? new PixelBuffer(DW, DH) : null;
      for (let v = 0; v < DH; v++)
        for (let u = 0; u < DW; u++) {
          const k = (v * DW + u) * 2;
          const sx = DIAMOND_TEXEL[k]!;
          if (sx < 0) continue;
          const sy = DIAMOND_TEXEL[k + 1]!;
          const i = (ty * TILE + sy) * S + tx * TILE + sx;
          c.set(u, v, m.col[i]!);
          n.set(u, v, nm[i]!);
          if (g && m.glow![i]) g.set(u, v, m.glow![i]! & 0xffffff, m.glow![i]! >>> 24);
        }
      col.push(c);
      nrm.push(n);
      if (glow && g) glow.push(g);
    }
  return { col, nrm, glow };
}

// ---------------------------------------------------------------- overlays (deco)

/** A texel-space canvas of tw x th tiles: colour (ARGB), height, emissive. */
export class TexCanvas {
  readonly w: number;
  readonly h: number;
  readonly buf: PixelBuffer;
  readonly hgt: Float32Array;
  readonly glow: PixelBuffer;
  readonly p: Painter;
  constructor(tw: number, th: number) {
    this.w = tw * TILE;
    this.h = th * TILE;
    this.buf = new PixelBuffer(this.w, this.h);
    this.hgt = new Float32Array(this.w * this.h);
    this.glow = new PixelBuffer(this.w, this.h);
    this.p = new Painter(this.buf);
  }
  set(x: number, y: number, c: number, h: number, a = 255): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.buf.set(x, y, c, a);
    this.hgt[y * this.w + x] = h;
  }
  glowAt(x: number, y: number, c: number, a = 255): void {
    this.glow.set(x, y, c, a);
  }
  /** Raise every painted pixel without an explicit height by luminance (objects drawn with the Painter). */
  liftPainted(before: Uint32Array, base: number, k: number): void {
    for (let i = 0; i < this.buf.data.length; i++) {
      if (this.buf.data[i] === before[i]) continue;
      const c = this.buf.data[i]!;
      if (!(c >>> 24)) continue;
      this.hgt[i] = base + luma(c & 0xffffff) * k;
    }
  }
  snapshot(): Uint32Array {
    return this.buf.data.slice();
  }
}

export interface DecoFrame {
  col: PixelBuffer;
  nrm: PixelBuffer;
  glow: PixelBuffer;
}

/** Resample tile (ix, iy) of a canvas into a 64x40 deco frame (diamond at rows DECO_TOP..), with normals. */
export function canvasTile(cv: TexCanvas, ix: number, iy: number, lift = 0): DecoFrame {
  const col = new PixelBuffer(DECO_W, DECO_H);
  const nrm = new PixelBuffer(DECO_W, DECO_H);
  const glow = new PixelBuffer(DECO_W, DECO_H);
  const hs = 0.55;
  const hAt = (x: number, y: number): number => cv.hgt[Math.max(0, Math.min(cv.h - 1, y)) * cv.w + Math.max(0, Math.min(cv.w - 1, x))]!;
  for (let v = 0; v < DH; v++)
    for (let u = 0; u < DW; u++) {
      const k = (v * DW + u) * 2;
      const tx = DIAMOND_TEXEL[k]!;
      if (tx < 0) continue;
      const x = ix * TILE + tx, y = iy * TILE + DIAMOND_TEXEL[k + 1]!;
      const c = cv.buf.get(x, y);
      const a = c >>> 24;
      const oy = v + DECO_TOP - lift;
      if (a) {
        col.set(u, oy, c & 0xffffff, a);
        const gx = (hAt(x + 1, y) - hAt(x - 1, y)) * 0.5 * hs;
        const gy = (hAt(x, y + 1) - hAt(x, y - 1)) * 0.5 * hs;
        nrm.set(u, oy, encodeNormal(-(gx * 0.894 - gy * 0.894), -(-gx * 0.447 - gy * 0.447), 1), a);
      }
      const g = cv.glow.get(x, y);
      if (g >>> 24) glow.set(u, oy, g & 0xffffff, g >>> 24);
    }
  return { col, nrm, glow };
}

/** Theme painters for the overlay frames. Every function paints into fresh canvases. */
export interface DecoKit {
  M: FloorMat;
  theme: ThemeId;
  seed: number;
}

function paintCrack(cv: TexCanvas, k: DecoKit, v: number): void {
  const r = rng(k.seed + 100 + v);
  const glow = k.theme === 'forge';
  const frost = k.theme === 'frost';
  for (let b = 0; b < 2 + (v % 2); b++) {
    let x = 16 + (r() - 0.5) * 8, y = 16 + (r() - 0.5) * 8;
    let a = r() * Math.PI * 2;
    for (let s = 0; s < 14 + v * 4; s++) {
      a += (r() - 0.5) * 0.8;
      x += Math.cos(a);
      y += Math.sin(a);
      if (x < 1 || y < 1 || x > 30 || y > 30) break;
      const xi = Math.round(x), yi = Math.round(y);
      if (glow) {
        cv.set(xi, yi, LAVA[2 + (s % 3 === 0 ? 1 : 0)]!, -1.4);
        cv.glowAt(xi, yi, LAVA[3]!, 255);
        cv.glowAt(xi, yi - 1, LAVA[2]!, 90);
      } else if (frost) {
        cv.set(xi, yi, 0xc8ecff, -0.6, 230);
        if (s % 2) cv.set(xi + 1, yi, 0x6a9ac8, -0.3, 160);
      } else {
        cv.set(xi, yi, 0x050403, -1.4, 235);
        if (s % 2) cv.set(xi, yi - 1, tone(k.M.stone, 3.4), 0.2, 120);
      }
    }
  }
}

function paintHole(cv: TexCanvas, k: DecoKit, v: number): void {
  const r = rng(k.seed + 200 + v);
  const cx = 16 + (r() - 0.5) * 4, cy = 16 + (r() - 0.5) * 4;
  const rx = 9 + r() * 3, ry = 8 + r() * 3;
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry) + (pnoiseP(x, y, 4, 32, k.seed + v) - 0.5) * 0.45;
      if (d > 1) continue;
      let c: number;
      let h: number;
      if (k.theme === 'forge') {
        c = d < 0.55 ? tone(LAVA, 2.2 + (0.55 - d) * 4 + bayer(x, y) * 0.5) : d < 0.8 ? tone(k.M.stone, 0.6) : 0x050303;
        h = d < 0.55 ? -2 : -1;
        if (d < 0.55) cv.glowAt(x, y, c, 255);
        else if (d < 0.8) cv.glowAt(x, y, LAVA[1]!, 110);
      } else if (k.theme === 'flooded' || k.theme === 'frost') {
        c = d > 0.86 ? 0x050608 : tone(k.M.water, 0.8 + (1 - d) * 1.6 + bayer(x, y) * 0.4);
        if (k.theme === 'frost' && hashi(x, y, v) > 0.95) c = 0xffffff;
        h = d > 0.86 ? -1 : -1.6;
      } else if (k.theme === 'fungal') {
        c = d > 0.85 ? 0x080503 : tone(k.M.growth, 0.6 + (1 - d) * 2 + bayer(x, y) * 0.5);
        h = -0.8 + (1 - d);
      } else if (k.theme === 'sky') {
        // a hole clean through the shard: earth and roots round the rim, open sky (and a cloud) far below
        const cloud = pnoiseP(x, y, 8, 32, k.seed + 7 + v) > 0.6;
        c = d > 0.86 ? tone(R(0x1e140c, 0x34241a, 0x4c3626, 0x684c36, 0x86664a), 1 + (1 - d) * 8) : cloud ? 0xe8f4ff : mixc(0x5a9ad8, 0xa8d4f4, (y / 32) * 0.7 + bayer(x, y) * 0.1);
        h = d > 0.86 ? -0.8 : -3;
        if (d > 0.7 && d <= 0.86 && hashi(x, y, v + 3) > 0.8) c = MATERIALS.root[2]!;
      } else if (k.theme === 'moon') {
        // a deep pit: shadowed to the north-west, the far wall lit
        c = d > 0.88 ? tone(k.M.stone, y > cy ? 3.4 : 1.2) : tone(k.M.alt, 0.4 + Math.max(0, (x - cx + y - cy) / 12) * 1.6 + bayer(x, y) * 0.3);
        h = d > 0.88 ? 0.4 : -2.4 * (1 - d);
      } else if (k.theme === 'server') {
        // a lifted floor panel: the plenum below, cable runs and a status light
        const run = Math.floor(y / 3) % 4;
        c = d > 0.84 ? 0x040508 : run === 1 ? 0x6a1c18 : run === 3 ? 0x164a62 : 0x0a0c10;
        h = d > 0.84 ? -1.2 : -2.2;
        if (hashi(x, y, v + 5) > 0.985 && d < 0.8) { c = k.M.growth[3]!; cv.glowAt(x, y, c, 230); }
      } else {
        // broken flagstone: dark gap ring, rubble and grit inside
        const pn = pnoiseP(x, y, 4, 32, k.seed + 3 + v);
        c = d > 0.86 ? 0x050403 : pn > 0.58 ? tone(k.M.stone, 1 + pn * 2.2 + bayer(x, y) * 0.4) : mixc(k.M.mortar, k.M.dust, 0.3 + pn * 0.4);
        h = d > 0.86 ? -2 : pn > 0.58 ? -1 + pn : -1.8;
      }
      cv.set(x, y, c, h);
    }
  if (k.theme === 'catacombs' || k.theme === 'ossuary') {
    const before = cv.snapshot();
    for (let i = 0; i < 3; i++) {
      const x = cx + (r() - 0.5) * rx, y = cy + (r() - 0.5) * ry;
      const a = r() * Math.PI;
      cv.p.capsule(x - Math.cos(a) * 2, y - Math.sin(a) * 2, x + Math.cos(a) * 2, y + Math.sin(a) * 2, 0.7, 0.7);
    }
    cv.p.fill(MATERIALS.boneDry, { mode: 'emboss', inner: false });
    cv.liftPainted(before, -0.6, 1);
  }
}

function paintGrate(cv: TexCanvas, k: DecoKit): void {
  const iron = k.theme === 'frost' ? R(0x24344a, 0x3e5878, 0x6a8cb0, 0xa8c8e8, 0xe0f4ff) : k.theme === 'sanctum' ? GOLD : k.theme === 'sky' ? R(0x1c120e, 0x34221a, 0x523626, 0x725036, 0x8e6844) : k.theme === 'server' ? R(0x14171e, 0x262c38, 0x3a4256, 0x56607a, 0x8a96b0) : MATERIALS.iron;
  const glow = k.theme === 'forge';
  const wet = k.theme === 'flooded';
  for (let y = 4; y < 28; y++)
    for (let x = 4; x < 28; x++) {
      const frame = x < 6 || x > 25 || y < 6 || y > 25;
      const bar = (x - 6) % 4 === 0 || (y - 6) % 6 === 0;
      if (frame || bar) {
        const v = 2 + (frame && (x < 6 || y < 6) ? 0.9 : 0) + (frame && (x > 25 || y > 25) ? -0.8 : 0) + bayer(x, y) * 0.3;
        cv.set(x, y, tone(iron, v), frame ? 0.8 : 0.4);
      } else if (glow) {
        const c = tone(LAVA, 2 + pnoiseP(x, y, 4, 32, k.seed) * 2);
        cv.set(x, y, c, -2.5);
        cv.glowAt(x, y, c, 220);
      } else if (k.theme === 'server') {
        const c = tone(k.M.growth, 1 + pnoiseP(x, y, 4, 32, k.seed) * 2.2);
        cv.set(x, y, c, -2.5);
        cv.glowAt(x, y, c, 170);
      } else if (k.theme === 'sky') cv.set(x, y, mixc(0x5a9ad8, 0xc8e4f8, pnoiseP(x, y, 8, 32, k.seed) * 0.8), -2.5);
      else if (wet) cv.set(x, y, tone(k.M.water, 0.5 + pnoiseP(x, y, 4, 32, k.seed) * 1.5), -2.5);
      else cv.set(x, y, 0x030303, -2.5);
    }
  // rivets + rust bleeding
  for (const [x, y] of [[5, 5], [26, 5], [5, 26], [26, 26]] as const) cv.set(x, y, iron[4] ?? iron[3]!, 1);
  if (k.theme !== 'sanctum' && k.theme !== 'frost' && k.theme !== 'sky' && k.theme !== 'server')
    for (let i = 0; i < 6; i++) {
      const x = 4 + Math.floor(hashi(i, 1, k.seed) * 24), y = 27 + Math.floor(hashi(i, 2, k.seed) * 3);
      cv.set(x, y, MATERIALS.rust[1]!, 0, 180);
    }
}

function paintWet(cv: TexCanvas, k: DecoKit, v: number): void {
  const r = rng(k.seed + 300 + v);
  const cx = 16 + (r() - 0.5) * 6, cy = 16 + (r() - 0.5) * 6;
  const rx = 10 + r() * 4, ry = 8 + r() * 4;
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry) + (pnoiseP(x, y, 8, 32, k.seed + v + 3) - 0.5) * 0.5;
      if (d > 1) continue;
      switch (k.theme) {
        case 'forge': {
          // ash and clinker heap
          const pn = pnoiseP(x, y, 4, 32, k.seed + v);
          cv.set(x, y, pn > 0.6 ? 0x3a3434 : pn > 0.35 ? 0x1e1a1a : 0x0e0c0c, 0.3 + pn * 0.8, Math.round(255 * Math.min(1, (1 - d) * 3)));
          if (hashi(x, y, v + 4) > 0.97) {
            cv.set(x, y, LAVA[3]!, 0.5);
            cv.glowAt(x, y, LAVA[3]!, 255);
          }
          break;
        }
        case 'fungal': {
          const pn = pnoiseP(x, y, 4, 32, k.seed + v);
          cv.set(x, y, tone(k.M.growth, 1 + pn * 3 + bayer(x, y) * 0.5), 0.3 + pn * 0.6, Math.round(255 * Math.min(1, (1 - d) * 2.5)));
          break;
        }
        case 'frost': {
          const c = d > 0.85 ? 0xb4d8f0 : mixc(0x8ab8dc, 0xd8f0ff, pnoiseP(x, y, 8, 32, v) * 0.6);
          cv.set(x, y, hashi(x, y, v) > 0.96 ? 0xffffff : c, 0.05, 235);
          break;
        }
        case 'ossuary': {
          const pn = pnoiseP(x, y, 4, 32, k.seed + v);
          if (pn > 0.45) cv.set(x, y, tone(MATERIALS.boneDry, 1 + pn * 2.4), 0.2, Math.round(200 * Math.min(1, (1 - d) * 2)));
          break;
        }
        case 'sanctum': {
          const c = d > 0.8 ? k.M.water[1]! : tone(k.M.water, 1 + (1 - d) * 1.5);
          cv.set(x, y, hashi(x, y, v) > 0.97 ? k.M.water[4]! : c, -0.2, 235);
          break;
        }
        case 'moon': {
          // a drift of fine pale dust, thickest in the middle
          const pn = pnoiseP(x, y, 4, 32, k.seed + v);
          cv.set(x, y, tone(k.M.growth, 1 + (1 - d) * 2 + pn + bayer(x, y) * 0.4), 0.2 + (1 - d) * 0.5, Math.round(255 * Math.min(1, (1 - d) * 2.2)));
          break;
        }
        case 'server': {
          // a coolant spill: glowing at its deepest, a dull film at the edge
          const c = d > 0.8 ? k.M.water[1]! : tone(k.M.water, 1.4 + (1 - d) * 2);
          cv.set(x, y, hashi(x, y, v) > 0.975 ? k.M.water[4]! : c, -0.3, 235);
          if (d < 0.6) cv.glowAt(x, y, k.M.water[3]!, Math.round(150 * (1 - d / 0.6)));
          break;
        }
        default: {
          const c = d > 0.85 ? k.M.water[1]! : tone(k.M.water, 0.6 + (1 - d) * 1.2);
          const ripple = Math.sin((x * 0.8 + y * 0.4) + pnoiseP(x, y, 8, 32, v) * 5) > 0.9;
          cv.set(x, y, ripple ? k.M.water[3]! : hashi(x, y, v + 9) > 0.985 ? k.M.water[4]! : c, -0.4, 230);
        }
      }
    }
}

/** Wall-base accumulation along tile edges. side: N (b=0 row), W (a=0 column), S, E. */
function paintEdge(cv: TexCanvas, k: DecoKit, sides: string, v: number): void {
  const r = rng(k.seed + 400 + v * 7 + sides.length);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      let d = 99;
      if (sides.includes('N')) d = Math.min(d, y);
      if (sides.includes('W')) d = Math.min(d, x);
      if (sides.includes('S')) d = Math.min(d, 31 - y);
      if (sides.includes('E')) d = Math.min(d, 31 - x);
      const front = sides === 'S' || sides === 'E';
      const reach = (front ? 4 : 8) + pnoiseP(x, y, 8, 32, k.seed + v) * (front ? 3 : 6);
      if (d > reach) continue;
      const t = d / reach;
      const pn = pnoiseP(x, y, 4, 32, k.seed + v + 1);
      let c: number;
      let a = Math.round(255 * Math.min(1, (1 - t) * 2.2));
      let h = 0.3 * (1 - t) + pn * 0.4;
      switch (k.theme) {
        case 'frost':
          c = tone(k.M.growth, 1 + (1 - t) * 2.4 + bayer(x, y) * 0.5);
          h = 1.2 * (1 - t);
          break;
        case 'flooded':
          c = t < 0.35 ? tone(k.M.growth, 1.5 + pn * 2) : t < 0.7 ? tone(k.M.growth, 0.6 + pn) : tone(k.M.water, 1 + pn);
          a = Math.round(a * 0.9);
          break;
        case 'fungal':
          c = tone(k.M.growth, 0.8 + (1 - t) * 2.6 + pn + bayer(x, y) * 0.4);
          break;
        case 'forge':
          c = pn > 0.6 ? 0x2e2828 : pn > 0.3 ? 0x161212 : 0x080606;
          if (t < 0.25 && hashi(x, y, v) > 0.94) {
            c = LAVA[2]!;
            cv.glowAt(x, y, LAVA[2]!, 200);
          }
          break;
        case 'ossuary':
          c = pn > 0.5 ? tone(MATERIALS.boneDry, 1.2 + pn * 2) : tone(k.M.dust === 0 ? k.M.stone : k.M.alt, 1 + pn);
          break;
        case 'sanctum':
          // a gilt skirting line + dark dust
          if (d <= 1 && !front) {
            c = d === 0 ? GOLD[1]! : GOLD[3]!;
            a = 255;
            h = 0.4;
          } else c = mixc(k.M.mortar, k.M.dust, pn);
          break;
        case 'sky':
          // long grass and clover banked against the rim
          c = tone(k.M.growth, 1 + (1 - t) * 2.6 + pn + (hashi(x, y, v + 2) > 0.8 ? 0.8 : 0) + bayer(x, y) * 0.4);
          if (hashi(x, y, v + 3) > 0.985) c = 0xfff4b8;
          h = 0.9 * (1 - t) + pn * 0.3;
          break;
        case 'moon':
          // regolith drifted against the rock
          c = tone(k.M.growth, 0.6 + (1 - t) * 2.4 + pn * 0.8 + bayer(x, y) * 0.4);
          h = 0.8 * (1 - t);
          break;
        case 'server': {
          // a cable bundle hugging the wall, one strand lit
          const lane = Math.floor(d / 2);
          if (d < 6 && !front) {
            c = lane === 0 ? 0x0a0c10 : lane === 1 ? 0x2a2a32 : 0x164a62;
            a = 255;
            h = 0.6;
            if (lane === 1 && hashi(Math.floor((x + y) / 6), v, 4) > 0.8) { c = k.M.growth[3]!; cv.glowAt(x, y, c, 200); }
          } else c = mixc(k.M.mortar, k.M.dust, pn);
          break;
        }
        default:
          c = pn > 0.62 ? tone(k.M.stone, 2 + pn * 1.5 + bayer(x, y) * 0.4) : mixc(k.M.mortar, k.M.dust, 0.3 + pn * 0.6);
          if (pn > 0.75 && t > 0.3) c = tone(k.M.growth, 1.5 + pn);
      }
      cv.set(x, y, c, h, a);
    }
  if (k.theme === 'catacombs' || k.theme === 'ossuary') {
    const before = cv.snapshot();
    for (let i = 0; i < 2; i++) {
      const along = 6 + r() * 20, off = 1.5 + r() * 3;
      const [x, y] = sides.includes('N') ? [along, off] : sides.includes('W') ? [off, along] : sides.includes('S') ? [along, 31 - off] : [31 - off, along];
      if (r() < 0.5) cv.p.ellipse(x, y, 1.9, 1.6).fill(MATERIALS.boneDry, { mode: 'sphere', inner: false });
      else cv.p.ellipse(x, y, 1.7 + r(), 1.2 + r()).fill(k.M.stone, { mode: 'sphere', light: 0.15, inner: false });
    }
    cv.liftPainted(before, 0.4, 1.2);
  }
}

/** A 2x1-tile slab painted along x (64x32 texels). */
function paintSlab(cv: TexCanvas, k: DecoKit): void {
  const W2 = cv.w, H2 = cv.h;
  const horiz = W2 > H2;
  const ramp = k.theme === 'sanctum' ? k.M.alt : k.theme === 'forge' ? MATERIALS.iron : PLATE[k.theme] ? PLATE[k.theme]! : k.theme === 'frost' ? k.M.alt : k.M.stone;
  for (let y = 0; y < H2; y++)
    for (let x = 0; x < W2; x++) {
      const e = Math.min(x, y, W2 - 1 - x, H2 - 1 - y);
      if (e < 2) {
        cv.set(x, y, e === 0 ? 0x050403 : 0x0e0b09, e === 0 ? -1.8 : -0.9);
        continue;
      }
      let v = 2 + (pnoiseP(x % 32, y % 32, 8, 32, k.seed + 7) - 0.5) * 0.9 + bayer(x, y) * 0.3 + (e === 2 ? (x < W2 / 2 || y < H2 / 2 ? 0.7 : -0.6) : 0);
      if (k.theme === 'catacombs' || k.theme === 'ossuary') v += 0.3;
      cv.set(x, y, tone(ramp, v), e === 2 ? 0.4 : 0.6);
    }
  // engraving
  const cx = W2 / 2, cy = H2 / 2;
  const groove = (x: number, y: number): void => {
    const xi = Math.round(x), yi = Math.round(y);
    cv.set(xi, yi, k.theme === 'sanctum' ? GOLD[2]! : 0x0a0807, k.theme === 'sanctum' ? 0.2 : -0.6);
    if (k.theme === 'sanctum') cv.glowAt(xi, yi, GOLD[3]!, 90);
    else cv.set(xi + 1, yi + 1, tone(ramp, 3.4), 0.7);
  };
  if (k.theme === 'forge' || PLATE[k.theme]) {
    for (let i = 0; i < (horiz ? 6 : 3); i++) for (let j = 0; j < (horiz ? 3 : 6); j++) groove(6 + i * 10, 6 + j * 10);
    return;
  }
  // a cross / an ankh-like grave mark and a few letters along the long axis
  const L = (horiz ? W2 : H2) * 0.32;
  for (let t = -L; t <= L; t++) groove(horiz ? cx + t : cx, horiz ? cy : cy + t);
  for (let t = -5; t <= 5; t++) groove(horiz ? cx - L * 0.45 : cx + t, horiz ? cy + t : cy - L * 0.45);
  for (let i = 0; i < 6; i++) {
    const p = (horiz ? cx + L * 0.25 : cy + L * 0.25) + i * 3;
    if (horiz) groove(p, cy + 5 + (i % 2));
    else groove(cx + 5 + (i % 2), p);
  }
  if (k.theme === 'catacombs') {
    const before = cv.snapshot();
    const sx = horiz ? cx - L * 0.8 : cx, sy = horiz ? cy : cy - L * 0.8;
    cv.p.ellipse(sx, sy, 3, 2.7).fill(MATERIALS.boneDry, { mode: 'sphere', inner: false });
    cv.p.px(sx - 1, sy, 0x140c08).px(sx + 1, sy, 0x140c08);
    cv.liftPainted(before, 0.6, 1);
  }
}

/** 2x2 centrepiece (64x64 texels). */
function paintCentre(cv: TexCanvas, k: DecoKit): void {
  const c = 32;
  const P = cv.p;
  switch (k.theme) {
    case 'sanctum': {
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
          if (d > 30) continue;
          if (Math.abs(d - 28) < 1 || Math.abs(d - 21) < 0.8) {
            cv.set(x, y, GOLD[d > 24 ? 3 : 2]!, 0.3);
            cv.glowAt(x, y, k.M.water[3]!, 120);
          } else if (d < 21 && d > 20) cv.set(x, y, 0x040203, -0.6);
          else cv.set(x, y, tone(k.M.alt, 1.8 + (pnoiseP(x % 32, y % 32, 8, 32, 5) - 0.5) + bayer(x, y) * 0.25), 0);
        }
      for (let s = 0; s < 5; s++) {
        const a = (s / 5) * Math.PI * 2 - Math.PI / 2, b = ((s + 2) / 5) * Math.PI * 2 - Math.PI / 2;
        for (let t = 0; t <= 1; t += 0.02) {
          const x = c + Math.cos(a) * 20 * (1 - t) + Math.cos(b) * 20 * t, y = c + Math.sin(a) * 20 * (1 - t) + Math.sin(b) * 20 * t;
          cv.set(Math.round(x), Math.round(y), k.M.water[3]!, 0.2);
          cv.glowAt(Math.round(x), Math.round(y), k.M.water[3]!, 230);
        }
      }
      for (let s = 0; s < 12; s++) {
        const a = (s / 12) * Math.PI * 2;
        const x = Math.round(c + Math.cos(a) * 24.5), y = Math.round(c + Math.sin(a) * 24.5);
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
          cv.set(x + dx, y + dy, GOLD[3]!, 0.3);
          cv.glowAt(x + dx, y + dy, GOLD[3]!, 150);
        }
      }
      break;
    }
    case 'ossuary': {
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
          if (d > 30) continue;
          const ring = Math.floor(d / 4);
          const groove = x % 2 === 1 || y % 2 === 1;
          const tone2 = ring % 2 === 0 ? tone(MATERIALS.boneDry, 2.4 + hashi(x >> 1, y >> 1, 3) * 1.4) : tone(k.M.alt, 1.2 + hashi(x >> 1, y >> 1, 4));
          cv.set(x, y, groove ? 0x1a140e : tone2, groove ? -0.6 : 0.15);
        }
      const before = cv.snapshot();
      for (let s = 0; s < 8; s++) {
        const a = (s / 8) * Math.PI * 2;
        const x = c + Math.cos(a) * 18, y = c + Math.sin(a) * 18;
        P.ellipse(x, y - 0.4, 3, 2.7).fill(MATERIALS.boneDry, { mode: 'sphere' });
        P.px(x - 1, y, 0x140c08).px(x + 1, y, 0x140c08);
      }
      P.ellipse(c, c - 1, 6.5, 6).fill(MATERIALS.boneDry, { mode: 'sphere' });
      P.rect(c - 3.5, c + 4, 7, 3).fill(MATERIALS.boneDry, { mode: 'emboss', light: -0.2 });
      P.ellipse(c - 2.4, c, 1.5, 1.7).ellipse(c + 2.4, c, 1.5, 1.7).fill([0x0c0806, 0x0c0806, 0x160e0a, 0x1e1410], { mode: 'flat', tone: 1, inner: false });
      cv.liftPainted(before, 0.5, 1.2);
      break;
    }
    case 'forge': {
      for (let y = 2; y < 62; y++)
        for (let x = 2; x < 62; x++) {
          const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
          if (d > 29.5) continue;
          const rim = d > 26;
          const bar = !rim && ((x - 2) % 5 === 0 || Math.abs(d - 13) < 1.2);
          if (rim || bar) cv.set(x, y, tone(MATERIALS.iron, 2 + (rim ? (y < c ? 1 : -0.6) : 0.4) + bayer(x, y) * 0.3), rim ? 1 : 0.5);
          else {
            const cc = tone(LAVA, 1.6 + (1 - d / 26) * 2.4 + pnoiseP(x % 32, y % 32, 4, 32, 9) + bayer(x, y) * 0.4);
            cv.set(x, y, cc, -3);
            cv.glowAt(x, y, cc, 235);
          }
        }
      break;
    }
    case 'fungal': {
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
          if (d > 29) continue;
          const pn = pnoiseP(x % 32, y % 32, 8, 32, 11);
          if (d > 22 && d < 27) cv.set(x, y, tone(k.M.growth, 1.6 + pn * 2 + bayer(x, y) * 0.4), 0.4, 240);
          else if (d < 20 && pn > 0.55) cv.set(x, y, tone(k.M.growth, 0.6 + pn * 1.5), 0.2, 200);
        }
      const before = cv.snapshot();
      for (let s = 0; s < 11; s++) {
        const a = (s / 11) * Math.PI * 2 + 0.2;
        const x = c + Math.cos(a) * 24.5, y = c + Math.sin(a) * 24.5;
        const pink = s % 3 === 0;
        P.ellipse(x, y, 2.6, 2.2).fill(pink ? MATERIALS.magenta : MYCELIUM, { mode: 'sphere', glow: pink ? 0xd040b8 : MYCELIUM[2]!, inner: false });
        cv.glowAt(Math.round(x), Math.round(y), pink ? 0xff9ae8 : MYCELIUM[3]!, 255);
        cv.glowAt(Math.round(x) - 1, Math.round(y), pink ? 0xd040b8 : MYCELIUM[2]!, 160);
      }
      cv.liftPainted(before, 0.8, 1.2);
      break;
    }
    case 'frost': {
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const d = Math.hypot((x + 0.5 - c) / 1.0, (y + 0.5 - c) / 0.92) + (pnoiseP(x % 32, y % 32, 8, 32, 13) - 0.5) * 3;
          if (d > 29) continue;
          const cc = d > 27 ? 0xdcecf8 : mixc(0x2a4a6a, 0x8ac0e8, 0.25 + (1 - d / 27) * 0.5 + pnoiseP(x % 32, y % 32, 8, 32, 14) * 0.2);
          cv.set(x, y, hashi(x, y, 15) > 0.985 ? 0xffffff : cc, d > 27 ? 0.6 : 0);
        }
      // a body frozen under the ice
      const before = cv.snapshot();
      P.ellipse(c - 6, c - 4, 4, 3.6).fill(MATERIALS.boneDry, { mode: 'sphere', alpha: 150, inner: false });
      P.capsule(c - 3, c - 1, c + 9, c + 7, 4, 3).capsule(c, c + 2, c + 7, c - 6, 1.6, 1.2).capsule(c + 7, c + 5, c + 15, c + 3, 1.6, 1.3).fill(MATERIALS.sinew, { mode: 'emboss', alpha: 130, inner: false });
      cv.liftPainted(before, -0.2, 0.2);
      for (let s = 0; s < 4; s++) {
        let x = c + (hashi(s, 1, 16) - 0.5) * 30, y = c + (hashi(s, 2, 16) - 0.5) * 30;
        let a = hashi(s, 3, 16) * 6.3;
        for (let t = 0; t < 14; t++) {
          a += (hashi(s, t, 17) - 0.5) * 0.8;
          x += Math.cos(a);
          y += Math.sin(a);
          cv.set(Math.round(x), Math.round(y), 0xe8f8ff, 0.1);
        }
      }
      break;
    }
    case 'flooded': {
      // a round sump: stone ring, dark water, an iron grate in the middle
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
          if (d > 29) continue;
          if (d > 24) cv.set(x, y, tone(k.M.stone, 2 + (y < c ? 0.8 : -0.4) + (pnoiseP(x % 32, y % 32, 4, 32, 18) - 0.5) + bayer(x, y) * 0.3), 0.8);
          else if (d > 23) cv.set(x, y, 0x040708, -1);
          else if (d < 8 && ((x - c + 8) % 4 === 0 || (y - c + 8) % 4 === 0)) cv.set(x, y, tone(MATERIALS.iron, 2.4), -0.4);
          else {
            const ripple = Math.sin(d * 1.3 - pnoiseP(x % 32, y % 32, 8, 32, 19) * 3) > 0.85;
            cv.set(x, y, ripple ? k.M.water[3]! : tone(k.M.water, 0.6 + (d / 23) * 1.4 + bayer(x, y) * 0.3), -1.6);
          }
        }
      break;
    }
    case 'sky': {
      // a sun mosaic laid into the turf: gold rays round a pale sandstone disc
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const dx = x + 0.5 - c, dy = y + 0.5 - c;
          const d = Math.hypot(dx, dy);
          if (d > 30) continue;
          const a = Math.atan2(dy, dx);
          const ray = Math.abs(((a / (Math.PI * 2)) * 16 + 16) % 1 - 0.5) < 0.18;
          if (d < 9) cv.set(x, y, tone(GOLD, 2.2 + (1 - d / 9) * 1.6 + bayer(x, y) * 0.3), 0.4);
          else if (d < 10.5) cv.set(x, y, 0x3a2a14, -0.5);
          else if (ray && d < 27) cv.set(x, y, tone(GOLD, 1.6 + (1 - d / 27) * 1.6 + bayer(x, y) * 0.3), 0.3);
          else if (d > 27.5) cv.set(x, y, tone(k.M.stone, 2 + (dy < 0 ? 0.8 : -0.4) + bayer(x, y) * 0.3), 0.6);
          else cv.set(x, y, tone(k.M.stone, 2.6 + (pnoiseP(x % 32, y % 32, 8, 32, 22) - 0.5) + bayer(x, y) * 0.3), 0.2);
        }
      break;
    }
    case 'moon': {
      // a fresh crater two tiles across, its rim catching the light
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const dx = x + 0.5 - c, dy = y + 0.5 - c;
          const d = Math.hypot(dx, dy * 1.05) / 25 + (pnoiseP(x % 32, y % 32, 8, 32, 23) - 0.5) * 0.08;
          if (d > 1.18) continue;
          const lit = (dx + dy) / (Math.hypot(dx, dy) + 0.001);
          if (d < 0.86) cv.set(x, y, tone(k.M.alt, 0.6 + lit * 1.1 * (d / 0.86) + bayer(x, y) * 0.3 + (1 - d) * 0.3), -2.2 * (1 - d * d));
          else cv.set(x, y, tone(k.M.stone, (lit < 0 ? 3.6 : 2.4) + bayer(x, y) * 0.4), 0.9, d > 1.08 ? 170 : 255);
        }
      break;
    }
    case 'server': {
      // the data core's floor hatch: a ring of cyan light, a magenta curse-glyph burned into the lid
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const dx = x + 0.5 - c, dy = y + 0.5 - c;
          const d = Math.hypot(dx, dy);
          if (d > 29.5) continue;
          const PL = PLATE.server!;
          if (d > 26) cv.set(x, y, tone(PL, 2 + (dy < 0 ? 1 : -0.6) + bayer(x, y) * 0.3), 1);
          else if (d > 23.5) { const g = k.M.growth[3]!; cv.set(x, y, g, 0.2); cv.glowAt(x, y, g, 220); }
          else {
            const seg = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * 8);
            const seam = Math.abs(((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * 8 - Math.round(((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * 8)) < 0.06;
            cv.set(x, y, seam ? 0x040508 : tone(PL, 1.6 + (seg % 2) * 0.4 + bayer(x, y) * 0.3), seam ? -0.6 : 0.4);
          }
        }
      // the glyph: a broken triangle and an eye
      const A = CURSE;
      for (let s = 0; s < 3; s++) {
        const a0 = (s / 3) * Math.PI * 2 - Math.PI / 2, a1 = ((s + 1) / 3) * Math.PI * 2 - Math.PI / 2;
        for (let t = 0.08; t <= 0.92; t += 0.02) {
          if (s === 1 && t > 0.42 && t < 0.58) continue;
          const x = Math.round(c + Math.cos(a0) * 15 * (1 - t) + Math.cos(a1) * 15 * t), y = Math.round(c + Math.sin(a0) * 15 * (1 - t) + Math.sin(a1) * 15 * t);
          cv.set(x, y, A[3]!, 0.2);
          cv.glowAt(x, y, A[3]!, 230);
        }
      }
      for (let a = 0; a < Math.PI * 2; a += 0.12) { const x = Math.round(c + Math.cos(a) * 4.5), y = Math.round(c + Math.sin(a) * 2.6); cv.set(x, y, A[2]!, 0.2); cv.glowAt(x, y, A[2]!, 200); }
      cv.set(c, c, A[4]!, 0.3);
      cv.glowAt(c, c, A[4]!, 255);
      break;
    }
    default: {
      // catacombs: a great engraved seal stone over a crypt
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
          if (d > 29.5) continue;
          if (d > 27.5) {
            cv.set(x, y, 0x050403, -2);
            continue;
          }
          let v = 2.1 + (pnoiseP(x % 32, y % 32, 8, 32, 20) - 0.5) * 0.9 + bayer(x, y) * 0.3;
          if (d > 26) v += y < c ? 0.8 : -0.6;
          let h = 0.5;
          if (Math.abs(d - 22) < 0.7 || Math.abs(d - 12) < 0.7) {
            v = 0.3;
            h = -0.6;
          }
          if (Math.abs(x - c) < 1 && d < 20) {
            v = 0.3;
            h = -0.6;
          }
          if (Math.abs(y - c + 3) < 1 && Math.abs(x - c) < 9) {
            v = 0.3;
            h = -0.6;
          }
          cv.set(x, y, tone(k.M.stone, v), h);
        }
      for (let s = 0; s < 16; s++) {
        const a = (s / 16) * Math.PI * 2;
        const x = Math.round(c + Math.cos(a) * 17), y = Math.round(c + Math.sin(a) * 17);
        cv.set(x, y, 0x0a0807, -0.6);
        cv.set(x + 1, y, 0x0a0807, -0.6);
      }
      // cracked through
      let x = 8, y = 40;
      for (let t = 0; t < 46; t++) {
        x += 1;
        y += (hashi(t, 1, 21) - 0.6) * 2;
        cv.set(Math.round(x), Math.round(y), 0x050403, -1.2);
      }
    }
  }
}

/** Runner strip along x (horizontal) painted into a 32x32 tile; ends cap at x=0 (start) or x=31 (end). */
function paintRun(cv: TexCanvas, k: DecoKit, cap: 0 | 1 | 2, alongY: boolean): void {
  const half = 9;
  for (let yy = 0; yy < 32; yy++)
    for (let xx = 0; xx < 32; xx++) {
      const along = alongY ? yy : xx;
      const across = (alongY ? xx : yy) - 15.5;
      const ac = Math.abs(across);
      if (ac > half + 2) continue;
      if (cap === 1 && along < 3) continue;
      if (cap === 2 && along > 28) continue;
      const endT = cap === 1 ? along - 3 : cap === 2 ? 28 - along : 99;
      const x = xx, y = yy;
      switch (k.theme) {
        case 'sanctum': {
          // crimson runner with a gold border and a fringed end
          if (ac > half) continue;
          let c: number;
          if (endT < 2) c = (along + Math.round(across)) % 2 ? GOLD[2]! : 0x3a0a0e;
          else if (ac > half - 1.5) c = GOLD[ac > half - 0.7 ? 1 : 3]!;
          else if (ac > half - 3) c = 0x2a0408;
          else {
            const motif = (Math.floor(along / 4) + Math.floor((across + 16) / 4)) % 2 === 0 && ac < 5;
            c = motif ? 0x8e1a24 : tone(R(0x2a0408, 0x40070c, 0x5c0c14, 0x7a1820), 1.8 + pnoiseP(x, y, 8, 32, 31) + bayer(x, y) * 0.3);
            if (pnoiseP(x, y, 8, 32, 32) > 0.72) c = mixc(c, 0x0a0204, 0.4);
          }
          cv.set(x, y, c, 0.35);
          break;
        }
        case 'flooded': {
          // shallow channel with stone curbs
          if (ac > half - 2) cv.set(x, y, tone(k.M.stone, 2.2 + (across < 0 ? 0.7 : -0.5) + bayer(x, y) * 0.3), 0.6);
          else if (ac > half - 3) cv.set(x, y, 0x040708, -1);
          else {
            const ripple = Math.sin(along * 0.9 + across * 0.3 + pnoiseP(x, y, 8, 32, 33) * 5) > 0.88;
            const bottom = pnoiseP(x, y, 4, 32, 34) > 0.6;
            cv.set(x, y, ripple ? k.M.water[3]! : bottom ? tone(k.M.water, 2) : tone(k.M.water, 1.1 + bayer(x, y) * 0.4), -1.4);
          }
          if (endT < 2 && ac <= half) cv.set(x, y, tone(k.M.stone, 2.4), 0.6);
          break;
        }
        case 'forge': {
          // mine-cart rails on sleepers
          if (ac > half) continue;
          const rail = Math.abs(ac - 6) < 1;
          const sleeper = along % 6 < 3 && ac < half;
          if (rail) cv.set(x, y, across < 0 ? MATERIALS.iron[3]! : MATERIALS.iron[2]!, 0.8);
          else if (sleeper) cv.set(x, y, tone(MATERIALS.darkWood, 1.4 + (along % 6 === 0 ? 1 : 0) + bayer(x, y) * 0.4), 0.4);
          break;
        }
        case 'frost': {
          // a frozen rill: glossy ice strip
          if (ac > half - 1) continue;
          const c = mixc(0x4a7aa0, 0xc8ecff, 0.2 + (1 - ac / half) * 0.4 + pnoiseP(x, y, 8, 32, 35) * 0.25);
          cv.set(x, y, hashi(x, y, 36) > 0.97 ? 0xffffff : c, 0, 240);
          break;
        }
        case 'fungal': {
          // a creeping root with mycelium
          const w = 2.6 + Math.sin(along * 0.4) * 0.8;
          if (ac < w) cv.set(x, y, tone(MATERIALS.root, 1.4 + (across < 0 ? 1 : 0) + bayer(x, y) * 0.4), 0.9 - ac * 0.2);
          else if (ac < w + 3 && pnoiseP(x, y, 4, 32, 37) > 0.55) {
            cv.set(x, y, MYCELIUM[2]!, 0.1, 200);
            cv.glowAt(x, y, MYCELIUM[2]!, 150);
          }
          break;
        }
        case 'sky': {
          // a footpath worn into the turf: bare packed earth, grass crowding its edges
          const t = ac / (half + 1);
          if (pnoiseP(x, y, 8, 32, 40) < t * 1.1) continue;
          cv.set(x, y, tone(R(0x2a1e12, 0x44321e, 0x60482c, 0x7c623e, 0x9a7e54), 2 + pnoiseP(x, y, 4, 32, 41) * 1.6 + bayer(x, y) * 0.3), -0.2, Math.round(235 * (1 - t * 0.5)));
          break;
        }
        case 'moon': {
          // rover tracks: two treaded ruts pressed into the regolith
          const rut = Math.abs(ac - 5.5);
          if (rut > 2) continue;
          const tread = (along + (across < 0 ? 0 : 2)) % 4 < 2;
          cv.set(x, y, tone(k.M.alt, (tread ? 1.2 : 2) + (rut > 1.4 ? 0.8 : 0) + bayer(x, y) * 0.3), tread ? -0.6 : -0.3);
          break;
        }
        case 'server': {
          // a light strip let into the floor between steel kerbs
          if (ac > 4) continue;
          if (ac > 2.5) cv.set(x, y, tone(PLATE.server!, ac > 3.5 ? 3.4 : 1.4), 0.4);
          else {
            const pulse = along % 8 < 1;
            const c = pulse ? k.M.growth[4]! : k.M.growth[ac < 1 ? 3 : 2]!;
            cv.set(x, y, c, 0.1);
            cv.glowAt(x, y, c, pulse ? 255 : 190);
          }
          break;
        }
        case 'ossuary': {
          // a bone mosaic border strip
          if (ac > half - 2) continue;
          const groove = x % 2 === 1 || y % 2 === 1;
          const edge = ac > half - 3;
          cv.set(x, y, edge ? 0x140e09 : groove ? 0x1a140e : tone(MATERIALS.boneDry, 2 + hashi(x >> 1, y >> 1, 38) * 1.6), groove || edge ? -0.6 : 0.15);
          break;
        }
        default: {
          // catacombs: a worn path of smoothed, paler stone
          const t = ac / (half + 2);
          if (pnoiseP(x, y, 8, 32, 39) < t) continue;
          cv.set(x, y, mixc(tone(k.M.stone, 2.6 + bayer(x, y) * 0.3), k.M.dust, 0.15), 0.1, Math.round(150 * (1 - t)));
        }
      }
    }
}

/** Raised platform top (one big slab per tile). */
function paintDais(cv: TexCanvas, k: DecoKit): void {
  const ramp = k.theme === 'sanctum' ? k.M.stone : k.theme === 'forge' ? MATERIALS.iron : PLATE[k.theme] ? PLATE[k.theme]! : k.theme === 'frost' ? R(0x4a6a8a, 0x6a8cb0, 0x8cb0d0, 0xb8d4ec, 0xe4f2ff) : k.M.stone;
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const e = Math.min(x, y, 31 - x, 31 - y);
      let v = 2.3 + (pnoiseP(x, y, 8, 32, k.seed + 41) - 0.5) * 0.8 + bayer(x, y) * 0.3;
      let h = 0.6;
      if (e === 0) {
        v = x === 0 || y === 0 ? 3.4 : 1.2;
        h = 0.3;
      } else if (e === 1) v += x === 1 || y === 1 ? 0.5 : -0.4;
      let c = tone(ramp, v);
      if (k.theme === 'sanctum' && e === 2) c = GOLD[2]!;
      if (k.theme === 'ossuary' && e >= 3 && e <= 4) c = (x + y) % 2 ? tone(MATERIALS.boneDry, 2.6) : 0x2a2016;
      if (k.theme === 'forge' && e === 3 && (x + y) % 4 === 0) c = MATERIALS.iron[4]!;
      cv.set(x, y, c, h);
    }
}

/** Small scatter: bones / coins / pebbles / bits per theme. */
function paintScatter(cv: TexCanvas, k: DecoKit, v: number): void {
  const r = rng(k.seed + 500 + v);
  const before = cv.snapshot();
  const P = cv.p;
  for (let i = 0; i < 5; i++) {
    const x = 6 + r() * 20, y = 6 + r() * 20;
    const a = r() * Math.PI;
    switch (k.theme) {
      case 'forge':
        P.ellipse(x, y, 1.3 + r(), 1 + r() * 0.6).fill(i % 2 ? MATERIALS.iron : R(0x1a1414, 0x2a2222, 0x3a3030, 0x4a3e3e), { mode: 'sphere', inner: false });
        break;
      case 'frost':
        P.poly([x + Math.cos(a) * 2.4, y + Math.sin(a) * 1.6, x - Math.cos(a) * 2.4, y - Math.sin(a) * 1.6, x + 0.8, y - 1.6]).fill(R(0x3a6a9a, 0x6aa8e0, 0xb0e0ff, 0xe8f8ff, 0xffffff), { mode: 'facet', facets: 3, inner: false });
        break;
      case 'sanctum':
        if (i < 3) P.ellipse(x, y, 1.6, 1.1).fill(MATERIALS.wax, { mode: 'sphere', inner: false });
        else P.circle(x, y, 0.9).fill(GOLD, { mode: 'sphere', inner: false });
        break;
      case 'fungal':
        P.ellipse(x, y, 1.6 + r(), 1.2).fill(i % 2 ? MATERIALS.magenta : MYCELIUM, { mode: 'sphere', inner: false });
        break;
      case 'flooded':
        P.ellipse(x, y, 1.6 + r(), 1.1 + r() * 0.6).fill(FLOOR_MATS.flooded.growth, { mode: 'sphere', inner: false, dither: true });
        break;
      case 'sky':
        if (i % 2) P.ellipse(x, y, 1.4 + r(), 1 + r() * 0.5).fill(FLOOR_MATS.sky.stone, { mode: 'sphere', light: 0.2, inner: false });
        else P.circle(x, y, 0.9).fill(R(0x8a6a10, 0xc09a20, 0xf0d040, 0xfff090, 0xffffff), { mode: 'sphere', inner: false });
        break;
      case 'moon':
        P.ellipse(x, y, 1.2 + r() * 1.6, 0.9 + r()).fill(FLOOR_MATS.moon.stone, { mode: 'sphere', light: 0.25, inner: false });
        break;
      case 'server':
        if (i % 2) P.rect(x - 1.5, y - 1, 3, 2).fill(R(0x06200c, 0x0e3a18, 0x1a5a28, 0x2a7a3a, 0x48a058), { mode: 'emboss', inner: false });
        else P.circle(x, y, 0.8).fill(PLATE.server!, { mode: 'sphere', inner: false });
        break;
      default: {
        const L = 1.6 + r() * 2.2;
        if (v === 0 || i % 2) P.capsule(x - Math.cos(a) * L, y - Math.sin(a) * L, x + Math.cos(a) * L, y + Math.sin(a) * L, 0.75, 0.75).fill(MATERIALS.boneDry, { mode: 'emboss', inner: false, light: -0.1 });
        else P.ellipse(x, y, 1.5 + r(), 1.1 + r() * 0.6).fill(k.M.stone, { mode: 'sphere', light: 0.15, inner: false });
      }
    }
  }
  cv.liftPainted(before, 0.4, 1.2);
}

/** Three worn steps across a corridor mouth (alongY: the corridor runs along world y). */
function paintSteps(cv: TexCanvas, k: DecoKit, alongY: boolean): void {
  const ramp = k.theme === 'sanctum' ? k.M.alt : k.theme === 'forge' ? MATERIALS.iron : PLATE[k.theme] ? PLATE[k.theme]! : k.M.stone;
  for (let yy = 0; yy < 32; yy++)
    for (let xx = 0; xx < 32; xx++) {
      const along = alongY ? yy : xx;
      const across = alongY ? xx : yy;
      const step = Math.min(3, Math.floor((along + 2) / 9));
      const ls = (along + 2) % 9;
      // worn: the middle of each tread is dished and paler where feet have gone
      const wear = Math.max(0, 1 - Math.abs(across - 15.5) / 10);
      let v = 1.8 + step * 0.25 + (pnoiseP(xx, yy, 8, 32, k.seed + 61) - 0.5) * 0.7 + bayer(xx, yy) * 0.3 + wear * 0.35;
      let h = step * 0.9 - wear * 0.25;
      if (ls === 0) {
        v = 3.4 + wear * 0.3;
        h += 0.3;
      } else if (ls === 1) v += 0.5;
      else if (ls === 8) {
        v = 0.4;
        h -= 0.6;
      } else if (ls === 7) v -= 0.7;
      let col = tone(ramp, v);
      if (k.theme === 'sanctum' && ls === 0) col = GOLD[2]!;
      if (k.theme === 'frost' && ls >= 7 && pnoiseP(xx, yy, 4, 32, 63) > 0.5) col = tone(k.M.growth, 1.2);
      if ((k.theme === 'flooded' || k.theme === 'fungal') && ls >= 6 && pnoiseP(xx, yy, 4, 32, 64) > 0.55) col = tone(k.M.growth, 1.4);
      const edgeFade = Math.min(across, 31 - across);
      cv.set(xx, yy, col, h, edgeFade < 2 ? 170 : 255);
    }
}

/** Screen-space risers below the shifted dais top. */
function addRiser(f: DecoFrame, k: DecoKit, south: boolean, east: boolean): void {
  const ramp = k.theme === 'sanctum' ? k.M.alt : k.theme === 'forge' ? MATERIALS.iron : PLATE[k.theme] ? PLATE[k.theme]! : k.theme === 'frost' ? R(0x2a4058, 0x3e5a78, 0x5a7c9c, 0x84a4c4, 0xc0d8f0) : k.M.stone;
  for (let u = 1; u < DW - 1; u++) {
    const left = u < 32;
    if ((left && !south) || (!left && !east)) continue;
    const uu = left ? u : 63 - u;
    const edge = DECO_TOP + Math.ceil(15.75 + uu / 2) - 1; // bottom row of the diamond at this column
    for (let r = 0; r < RISE; r++) {
      const y = edge - RISE + 1 + r;
      if (!diamondAB(u, y - DECO_TOP)) continue;
      let c = tone(ramp, (left ? 1.6 : 1.1) + (r === 0 ? 0.9 : 0) - r * 0.2 + bayer(u, y) * 0.3);
      if ((left ? u : 63 - u) % 12 === 0) c = scalec(c, 0.6);
      if (k.theme === 'sanctum' && r === 0) c = GOLD[left ? 3 : 2]!;
      f.col.set(u, y, c);
      f.nrm.set(u, y, encodeNormal(left ? -0.35 : 0.35, -0.55, 0.75));
    }
  }
}

const decoCache = new Map<ThemeId, DecoFrame[]>();

/** All overlay frames of a theme, in DECO_NAMES order. */
export function buildDecoFrames(theme: ThemeId): DecoFrame[] {
  const hit = decoCache.get(theme);
  if (hit) return hit;
  const k: DecoKit = { M: FLOOR_MATS[theme], theme, seed: 12000 + theme.length * 97 + theme.charCodeAt(0) };
  const one = (fn: (cv: TexCanvas) => void): DecoFrame => {
    const cv = new TexCanvas(1, 1);
    fn(cv);
    return canvasTile(cv, 0, 0);
  };
  const out: DecoFrame[] = [];
  out.push(one((cv) => paintCrack(cv, k, 0)), one((cv) => paintCrack(cv, k, 1)), one((cv) => paintCrack(cv, k, 2)));
  out.push(one((cv) => paintHole(cv, k, 0)), one((cv) => paintHole(cv, k, 1)));
  out.push(one((cv) => paintGrate(cv, k)));
  out.push(one((cv) => paintWet(cv, k, 0)), one((cv) => paintWet(cv, k, 1)));
  out.push(one((cv) => paintEdge(cv, k, 'N', 0)), one((cv) => paintEdge(cv, k, 'N', 1)), one((cv) => paintEdge(cv, k, 'W', 0)), one((cv) => paintEdge(cv, k, 'W', 1)), one((cv) => paintEdge(cv, k, 'NW', 2)));
  out.push(one((cv) => paintEdge(cv, k, 'S', 3)), one((cv) => paintEdge(cv, k, 'E', 4)));
  const sx = new TexCanvas(2, 1);
  paintSlab(sx, k);
  const sy = new TexCanvas(1, 2);
  paintSlab(sy, k);
  out.push(canvasTile(sx, 0, 0), canvasTile(sx, 1, 0), canvasTile(sy, 0, 0), canvasTile(sy, 0, 1));
  const cp = new TexCanvas(2, 2);
  paintCentre(cp, k);
  out.push(canvasTile(cp, 0, 0), canvasTile(cp, 1, 0), canvasTile(cp, 0, 1), canvasTile(cp, 1, 1));
  out.push(one((cv) => paintRun(cv, k, 0, false)), one((cv) => paintRun(cv, k, 0, true)));
  out.push(one((cv) => paintRun(cv, k, 1, false)), one((cv) => paintRun(cv, k, 2, false)), one((cv) => paintRun(cv, k, 1, true)), one((cv) => paintRun(cv, k, 2, true)));
  const dais = new TexCanvas(1, 1);
  paintDais(dais, k);
  for (const [s, e] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    const f = canvasTile(dais, 0, 0, RISE);
    addRiser(f, k, s, e);
    out.push(f);
  }
  out.push(one((cv) => paintScatter(cv, k, 0)), one((cv) => paintScatter(cv, k, 1)));
  out.push(one((cv) => paintSteps(cv, k, false)), one((cv) => paintSteps(cv, k, true)));
  decoCache.set(theme, out);
  return out;
}

/** True if any deco frame of the theme has emissive pixels. */
export function decoHasGlow(theme: ThemeId): boolean {
  return buildDecoFrames(theme).some((f) => f.glow.data.some((c) => c >>> 24 !== 0));
}

/** Debug: encoded flat normal for empty normal pixels. */
export const DECO_FLAT = FLAT_NORMAL;
void hash2;
