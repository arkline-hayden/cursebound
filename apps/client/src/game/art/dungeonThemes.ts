/**
 * Themed variants of the Sunken Catacombs dungeon art (framework-free).
 *
 * Every theme provides `dungeon:floor:<theme>` (12 x 32x32 frames, same semantics as `dungeon:floor`),
 * `dungeon:wall:<theme>` (48 x 32x64 frames, same layout as `dungeon:wall`, so pickFloor/pickWall work
 * unchanged) and `dungeon:void:<theme>`. Catacombs keys are produced by dungeonData.ts.
 *
 * Floor frame semantics (all themes): 0-2 plain layouts, 3 cracked, 4 overgrown/accent, 5 pool,
 * 6 grate, 7 scattered bits, 8 rubble, 9 feature slab, 10 mixed accent + small pool, 11 grimy.
 * Wall face variants are theme specific (8 each); see FACE_NOTES.
 */
import { MATERIALS, PALETTES } from './palette';
import { Painter, PixelBuffer, bayer, hash2, lighten, mix, outlinePass, rng, type Ramp } from './draw/pixel';

export type ThemeId = 'catacombs' | 'flooded' | 'ossuary' | 'sanctum' | 'fungal' | 'forge' | 'frost' | 'sky' | 'moon' | 'server';
export type VariantTheme = Exclude<ThemeId, 'catacombs'>;

export const THEME_IDS: readonly ThemeId[] = ['catacombs', 'flooded', 'ossuary', 'sanctum', 'fungal', 'forge', 'frost', 'sky', 'moon', 'server'];
export const VARIANT_THEMES: readonly VariantTheme[] = ['flooded', 'ossuary', 'sanctum', 'fungal', 'forge', 'frost', 'sky', 'moon', 'server'];

const T = 32;
const OUT = PALETTES.outline;
const R = (...c: number[]): Ramp => Object.freeze(c);

export interface Style {
  floor: Ramp;
  /** second floor ramp (checker / alternate stones) */
  floor2?: Ramp;
  mortar: number;
  growth: Ramp;
  pool: Ramp;
  /** pools glow (lava, spores) */
  poolGlow?: boolean;
  wall: Ramp;
  cap: Ramp;
  accent: Ramp;
  void: number;
}

export const STYLES: Record<VariantTheme, Style> = {
  flooded: {
    floor: R(0x0c1216, 0x16222a, 0x22323c, 0x30444e, 0x445a64),
    mortar: 0x05090c,
    growth: R(0x0a2014, 0x14381e, 0x24582a, 0x3e7a3a, 0x6aa850),
    pool: R(0x061220, 0x0e2638, 0x1c4258, 0x5a8aa0, 0xb0d8e8),
    wall: R(0x0e161a, 0x1a272e, 0x283a42, 0x3a5058, 0x587078),
    cap: R(0x080e10, 0x10191d, 0x1a262b, 0x283840, 0x5a7880),
    accent: R(0x18120c, 0x2c2216, 0x443420, 0x5c482e, 0x7a6244),
    void: 0x03070a,
  },
  ossuary: {
    floor: R(0x221d13, 0x393223, 0x4f4632, 0x665c43, 0x807458),
    floor2: R(0x1b160e, 0x2f281b, 0x433a27, 0x574c36, 0x6e624a),
    mortar: 0x120d08,
    growth: R(0x1c140c, 0x2e2216, 0x443322, 0x5a4630),
    pool: R(0x0c0a08, 0x1a1612, 0x2c261e, 0x5a5040, 0x8a8070),
    wall: R(0x3a3026, 0x6a5e4a, 0xa09276, 0xccc0a2, 0xf0e8d0),
    cap: R(0x14100c, 0x221c16, 0x302820, 0x443a2e, 0x8a7a60),
    accent: R(0x050303, 0x0c0907, 0x16110d, 0x221a14),
    void: 0x060403,
  },
  sanctum: {
    floor: R(0x09060a, 0x130d11, 0x1d1519, 0x2a1f24, 0x3e3036),
    floor2: R(0x1e0406, 0x34080c, 0x4e1016, 0x6a1a20, 0x8e2c30),
    mortar: 0x5a4416,
    growth: R(0x4a3008, 0x8a6418, 0xc89a30, 0xf0d070, 0xfff4c0),
    pool: R(0x180204, 0x380509, 0x660d13, 0x9c1e26, 0xe05a5a),
    wall: R(0x0b0708, 0x170f11, 0x24191c, 0x362528, 0x5a4246),
    cap: R(0x090506, 0x130b0d, 0x1d1315, 0x2b1d20, 0x8a6a30),
    accent: R(0x5a0606, 0xa01010, 0xff3030, 0xff9a8a, 0xffffff),
    void: 0x080203,
  },
  fungal: {
    floor: R(0x110b07, 0x1d150e, 0x2b2016, 0x392c1e, 0x4c3c2a),
    mortar: 0x070402,
    growth: R(0x063028, 0x0e5a4c, 0x22b094, 0x7af0d0, 0xe0fff6),
    pool: R(0x061210, 0x0e2420, 0x184038, 0x34887a, 0x9af0d8),
    poolGlow: true,
    wall: R(0x150f0b, 0x251b13, 0x392b1d, 0x4f3f2e, 0x6a5842),
    cap: R(0x0b0705, 0x150f0b, 0x211910, 0x2f2519, 0x5a4a34),
    accent: R(0x3a0838, 0x701868, 0xd040b8, 0xff9ae8, 0xffffff),
    void: 0x050302,
  },
  forge: {
    floor: R(0x0b0a0b, 0x151315, 0x1f1c1f, 0x2b2729, 0x3b3537),
    mortar: 0x040304,
    growth: R(0x040304, 0x0a0808, 0x121010, 0x1c1818),
    pool: R(0x5a0e02, 0xb02a04, 0xff6a0e, 0xffb040, 0xfff0a0),
    poolGlow: true,
    wall: R(0x0d0b0d, 0x191619, 0x252125, 0x332e32, 0x4c4448),
    cap: R(0x070607, 0x0f0d0f, 0x191617, 0x252123, 0x6a4030),
    accent: MATERIALS.iron,
    void: 0x070302,
  },
  frost: {
    floor: R(0x182634, 0x283a4e, 0x3a526c, 0x546e8c, 0x88a6c6),
    mortar: 0x0c141e,
    growth: R(0x8a9ab0, 0xb8c8dc, 0xe0ecf8, 0xffffff),
    pool: R(0x2a4a6a, 0x4a7aa0, 0x8ac0e8, 0xc8ecff, 0xffffff),
    wall: R(0x141e2a, 0x243446, 0x384e66, 0x546e8a, 0x88aed0),
    cap: R(0x34445a, 0x50627c, 0x7486a2, 0x9cb0ca, 0xdce8f6),
    accent: R(0x3a6a9a, 0x6aa8e0, 0xb0e0ff, 0xe8f8ff, 0xffffff),
    void: 0x04070c,
  },
  // turf and pale sandstone flags on a shard of earth in open sky; sun-gold accents, clear rain pools
  sky: {
    floor: R(0x1a2a12, 0x2c4418, 0x44641e, 0x62882a, 0x8ab040),
    floor2: R(0x3a3428, 0x5a5040, 0x7c705a, 0xa09478, 0xc8bc9c),
    mortar: 0x1a1a10,
    growth: R(0x2a4a14, 0x447020, 0x66982c, 0x94c444, 0xc8e878),
    pool: R(0x163a5a, 0x2a6a94, 0x4a9ac4, 0x8ad0ee, 0xe0f8ff),
    wall: R(0x3a3226, 0x5c503c, 0x807256, 0xa69676, 0xcabc9a),
    cap: R(0x1e3410, 0x30521a, 0x4a7424, 0x6c9a32, 0x9ac650),
    accent: R(0x6a4a10, 0xa07820, 0xd0a838, 0xf0d070, 0xfff4c0),
    void: 0x7ab4e8,
  },
  // grey regolith and dark mare basalt, dust-frost highlights, ice in the crater floors, aluminium wreckage
  moon: {
    floor: R(0x26272c, 0x3a3c42, 0x52545c, 0x6e7078, 0x9294a0),
    floor2: R(0x1c1d22, 0x2c2e34, 0x40424a, 0x585a64, 0x767884),
    mortar: 0x101116,
    growth: R(0x3a4458, 0x56647e, 0x7a8ca8, 0xa8bcd4, 0xdce8f6),
    pool: R(0x10203a, 0x1c3a66, 0x3a6aa0, 0x7aa8d8, 0xc8e4ff),
    wall: R(0x22232a, 0x34363e, 0x4a4c56, 0x666874, 0x8a8c9a),
    cap: R(0x2e3036, 0x44464e, 0x5e6068, 0x7c7e88, 0xa4a6b0),
    accent: R(0x2a2e36, 0x48505e, 0x6e7a8c, 0x9aa8bc, 0xd0dcec),
    void: 0x020308,
  },
  // gunmetal raised floor and rack steel; cyan neon traces, glowing coolant, magenta curse-light
  server: {
    floor: R(0x0c0e14, 0x161a22, 0x222834, 0x323a4a, 0x48526a),
    floor2: R(0x08090c, 0x101218, 0x1a1d26, 0x262a36, 0x363c4c),
    mortar: 0x030406,
    growth: R(0x04303a, 0x08606e, 0x10a8b8, 0x50f0ff, 0xc8ffff),
    pool: R(0x02181e, 0x063a44, 0x0e7080, 0x30c8d8, 0xb0fcff),
    poolGlow: true,
    wall: R(0x0e1016, 0x1a1e28, 0x282e3c, 0x3a4256, 0x56607a),
    cap: R(0x0a0c10, 0x14171e, 0x1e222c, 0x2c323e, 0x404858),
    accent: R(0x3a0838, 0x7a1070, 0xd020c0, 0xff70f0, 0xffd0ff),
    void: 0x020204,
  },
};

/** Human notes for wall face variants per theme (manifest/debug). */
export const FACE_NOTES: Record<VariantTheme, string[]> = {
  flooded: ['wet bricks', 'cracked', 'algae + slime', 'heavy drips', 'rusted ring', 'rotting wood beam', 'outflow pipe', 'slime niche'],
  ossuary: ['skull rows', 'stacked femurs', 'skulls + bones', 'grand skull niche', 'skull candle', 'cracked skulls', 'bone arch', 'yellowed + web'],
  sanctum: ['black marble', 'cracked marble', 'gold rune', 'blood weeping', 'gold ring', 'crimson banner', 'gold candle alcove', 'blood sigil'],
  fungal: ['cave rock', 'cracked rock', 'teal shrooms', 'magenta shrooms', 'hanging roots', 'mycelium veins', 'spore pods', 'dripping moss'],
  forge: ['basalt columns', 'lava crack', 'soot stains', 'riveted iron plate', 'hanging chains', 'glowing vent', 'lava seep', 'furnace mouth'],
  frost: ['icy bricks', 'cracked ice', 'thick rime', 'frozen fall', 'frosted ring', 'great icicles', 'frozen corpse', 'snow drift'],
  sky: ['strata rock', 'cracked rock', 'ivy', 'hanging roots', 'wind shrine', 'prayer flags', 'nest', 'sun glyph'],
  moon: ['regolith rock', 'cracked basalt', 'dust drift', 'hull panel', 'porthole', 'airlock', 'antenna', 'hazard stripes'],
  server: ['rack panel', 'cracked panel', 'cable tray', 'LED rack', 'vent grille', 'terminal', 'warning glyph', 'glitch'],
};

// ---------------------------------------------------------------- helpers

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
  return ramp[Math.max(0, Math.min(ramp.length - 1, Math.floor(v)))] as number;
}

type Rect = [number, number, number, number];
const LAYOUTS: Rect[][] = [
  [[0, 0, 16, 16], [16, 0, 16, 16], [0, 16, 16, 16], [16, 16, 16, 16]],
  [[0, 0, 32, 14], [0, 14, 13, 18], [13, 14, 19, 18]],
  [[0, 0, 20, 11], [20, 0, 12, 11], [0, 11, 9, 10], [9, 11, 23, 10], [0, 21, 18, 11], [18, 21, 14, 11]],
  [[0, 0, 32, 32]],
];
const SMALL_TILES: Rect[] = Array.from({ length: 16 }, (_, k) => [(k % 4) * 8, Math.floor(k / 4) * 8, 8, 8] as Rect);

/** Rect-stone floor with theme ramps. `veins` adds marble veining; checker alternates floor2. */
function stones(buf: PixelBuffer, rects: Rect[], S: Style, seed: number, opts: { growth?: number; veins?: boolean; checker?: boolean; noise?: number } = {}): void {
  const growth = opts.growth ?? 0;
  const noise = opts.noise ?? 1;
  rects.forEach(([rx, ry, rw, rh], si) => {
    const ramp = opts.checker && S.floor2 && ((Math.floor(rx / rw) + Math.floor(ry / rh)) % 2 === 1) ? S.floor2 : S.floor;
    const base = 1.75 + hash2(si, seed, 3) * 1.0;
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        const lx = x - rx;
        const ly = y - ry;
        if (lx === rw - 1 || ly === rh - 1) {
          let m = growth > 0 && pnoise(x, y, 8, seed + 9) > 1 - growth ? mix(S.growth[1]!, S.mortar, 0.3) : S.mortar;
          if (S === STYLES.flooded) m = hash2(x, y, seed) > 0.9 ? S.pool[3]! : S.pool[1]!;
          buf.set(x, y, m);
          continue;
        }
        let v = base + ((pnoise(x, y, 8, seed) - 0.5) * 0.9 + (pnoise(x, y, 4, seed + 1) - 0.5) * 0.5) * noise + bayer(x, y) * 0.3;
        if (ly === 0) v += 0.9;
        else if (lx === 0) v += 0.45;
        if (ly === rh - 2) v -= 0.8;
        else if (lx === rw - 2) v -= 0.4;
        let c = tone(ramp, v);
        if (opts.veins) {
          const vein = Math.abs(Math.sin((x * 0.7 + y * 0.35 + pnoise(x, y, 8, seed + 5) * 9) * 0.9));
          if (vein > 0.985) c = mix(c, 0xb8a8b0, 0.25);
        }
        const grime = pnoise(x, y, 16, seed + 4);
        if (grime > 0.68) c = mix(c, 0x050404, (grime - 0.68) * 1.3);
        if (growth > 0 && (ly <= 1 || lx <= 1 || ly >= rh - 3) && pnoise(x, y, 4, seed + 9) > 1 - growth * 0.9) c = tone(S.growth, 1 + pnoise(x, y, 4, seed + 2) * 2);
        buf.set(x, y, c);
      }
    }
  });
}

/** Irregular cave floor: periodic Voronoi stones with soft dark gaps. */
function caveStones(buf: PixelBuffer, S: Style, seed: number): void {
  const r = rng(seed);
  const pts: [number, number][] = [];
  for (let k = 0; k < 6; k++) pts.push([r() * T, r() * T]);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      let d1 = 1e9;
      let d2 = 1e9;
      let best = 0;
      pts.forEach(([px, py], k) => {
        for (let ox = -1; ox <= 1; ox++)
          for (let oy = -1; oy <= 1; oy++) {
            const dx = x - (px + ox * T);
            const dy = y - (py + oy * T);
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < d1) {
              d2 = d1;
              d1 = d;
              best = k;
            } else if (d < d2) d2 = d;
          }
      });
      const edge = d2 - d1;
      if (edge < 1.1) {
        buf.set(x, y, S.mortar);
        continue;
      }
      const [px, py] = pts[best]!;
      const lit = (py - y) * 0.08 + (px - x) * 0.04;
      const v = 1.8 + hash2(best, seed, 2) * 0.9 + lit + (pnoise(x, y, 8, seed) - 0.5) * 0.8 + bayer(x, y) * 0.3 + (edge < 2.2 ? -0.6 : 0);
      buf.set(x, y, tone(S.floor, v));
    }
  }
}

function crack(buf: PixelBuffer, r: () => number, x: number, y: number, len: number, col: number, hi: number, glow = false): void {
  let a = r() * Math.PI * 2;
  for (let k = 0; k < len; k++) {
    a += (r() - 0.5) * 0.9;
    x += Math.cos(a);
    y += Math.sin(a);
    if (x < 1 || y < 1 || x > T - 2 || y > T - 2) break;
    buf.set(Math.round(x), Math.round(y), col);
    if (glow) {
      buf.blend(Math.round(x) + 1, Math.round(y), hi, 110);
      buf.blend(Math.round(x), Math.round(y) - 1, hi, 110);
    } else if (k % 2) buf.set(Math.round(x), Math.round(y) - 1, hi);
  }
}

function pool(buf: PixelBuffer, cx: number, cy: number, rx: number, ry: number, ramp: Ramp, seed: number, glow = false): void {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry) + (hash2(x, y, seed) - 0.5) * 0.15;
      if (d > 1) continue;
      let c: number;
      if (glow) c = d > 0.85 ? ramp[0]! : d > 0.6 ? ramp[1]! : d > 0.3 ? ramp[2]! : ramp[3]!;
      else {
        c = d > 0.85 ? ramp[1]! : ramp[0]!;
        if (hash2(x, y, seed + 1) > 0.93 && d < 0.8) c = ramp[3]!;
        if ((x + y * 3) % 11 === 0 && d < 0.6) c = ramp[2]!;
      }
      buf.set(x, y, mix(buf.get(x, y) & 0xffffff, c, 0.9));
    }
  }
  if (!glow) {
    buf.set(Math.round(cx - rx * 0.4), Math.round(cy - ry * 0.3), ramp[4] ?? ramp[3]!);
    buf.set(Math.round(cx - rx * 0.4) + 1, Math.round(cy - ry * 0.3), ramp[3]!);
  }
}

function blobs(p: Painter, r: () => number, n: number, ramp: Ramp, sizes: [number, number], area: [number, number, number, number] = [4, 4, 24, 24], glow?: number): void {
  for (let k = 0; k < n; k++) p.ellipse(area[0] + r() * area[2], area[1] + r() * area[3], sizes[0] + r() * sizes[1], (sizes[0] + r() * sizes[1]) * 0.75);
  p.fill(ramp, { mode: 'sphere', glow, inner: false, dither: true });
}

function bones(p: Painter, r: () => number, n: number, ramp: Ramp, area: [number, number, number, number] = [4, 4, 24, 24]): void {
  for (let k = 0; k < n; k++) {
    const x = area[0] + r() * area[2];
    const y = area[1] + r() * area[3];
    const a = r() * Math.PI;
    const L = 1.5 + r() * 2.5;
    p.capsule(x - Math.cos(a) * L, y - Math.sin(a) * L, x + Math.cos(a) * L, y + Math.sin(a) * L, 0.7, 0.7);
  }
  p.fill(ramp, { mode: 'emboss', inner: false, light: -0.2 });
}

function shroomCluster(p: Painter, cx: number, by: number, ramp: Ramp, n: number, seed: number, scale = 1): void {
  const r = rng(seed);
  for (let k = 0; k < n; k++) {
    const x = cx + (r() - 0.5) * 9 * scale;
    const h = (2 + r() * 4) * scale;
    p.capsule(x, by, x + (r() - 0.5), by - h, 0.6 * scale, 0.5 * scale).fill(MATERIALS.wax, { mode: 'cyl', inner: false });
    p.ellipse(x, by - h - 0.5, (1.6 + r()) * scale, 1.1 * scale).fill(ramp, { mode: 'sphere', glow: ramp[3]!, light: 0.2, inner: false });
  }
}

function skull(p: Painter, x: number, y: number, s: number, ramp: Ramp, dark: number): void {
  p.ellipse(x, y, 2.7 * s, 2.5 * s).fill(ramp, { mode: 'sphere' });
  p.rect(x - 1.4 * s, y + 1.6 * s, 2.8 * s, 1.3 * s).fill(ramp, { mode: 'emboss', light: -0.2, inner: false });
  p.px(x - s, y, dark).px(x + s, y, dark).px(x, y + s, mix(dark, ramp[1]!, 0.5));
}

// ---------------------------------------------------------------- floors

/** @param iso skip upright decorations (mushroom stems) so the frame can be resampled to a 2:1 diamond */
function themeFloor(id: VariantTheme, v: number, iso = false): PixelBuffer {
  const S = STYLES[id];
  const buf = new PixelBuffer(T, T);
  const r = rng(700 + v * 31 + id.length * 97);
  const seed = 40 + v * 11 + id.length * 5;
  const p = new Painter(buf);
  const base = (layout: number, growth = 0): void => {
    if (id === 'fungal') caveStones(buf, S, seed + layout * 13);
    else if (id === 'ossuary') stones(buf, layout === 3 ? LAYOUTS[3]! : layout === 1 ? LAYOUTS[0]! : SMALL_TILES, S, seed, { growth, checker: true, noise: 0.7 });
    else if (id === 'sanctum') stones(buf, layout === 3 ? LAYOUTS[3]! : LAYOUTS[0]!, S, seed, { growth, veins: true, checker: layout !== 1, noise: 0.5 });
    else stones(buf, LAYOUTS[layout % 4]!, S, seed, { growth });
  };
  switch (v) {
    case 0:
    case 1:
    case 2:
      base(v);
      break;
    case 3: // cracked
      base(0);
      if (id === 'forge') {
        crack(buf, r, 6, 10, 18, S.pool[2]!, S.pool[3]!, true);
        crack(buf, r, 22, 22, 10, S.pool[1]!, S.pool[2]!, true);
      } else if (id === 'frost') {
        crack(buf, r, 8, 8, 16, S.pool[3]!, S.pool[4]!);
      } else {
        crack(buf, r, 8, 8, 14, S.mortar, S.floor[3]!);
        crack(buf, r, 22, 20, 10, S.mortar, S.floor[3]!);
      }
      break;
    case 4: // overgrown / accent
      if (id === 'frost') {
        base(1);
        for (let y = 0; y < T; y++)
          for (let x = 0; x < T; x++) {
            const n = pnoise(x, y, 16, seed + 3) * 0.7 + pnoise(x, y, 4, seed + 4) * 0.3;
            if (n > 0.55) buf.set(x, y, tone(S.growth, (n - 0.55) * 9 + bayer(x, y) * 0.5));
          }
      } else if (id === 'fungal') {
        base(1);
        for (let k = 0; k < 9; k++) {
          const x = Math.round(3 + r() * 26);
          const y = Math.round(3 + r() * 26);
          p.gpx(x, y, S.growth[3]!, S.growth[2]!);
          if (k % 3 === 0) p.gpx(x + 1, y, S.growth[2]!, S.growth[2]!);
        }
        p.finish(OUT, 0.8);
      } else if (id === 'sanctum') {
        base(0);
        for (let x = 2; x < 30; x++) {
          buf.set(x, 15, S.growth[2]!);
          buf.set(x, 16, S.growth[1]!);
        }
        for (let y = 2; y < 30; y++) {
          buf.set(15, y, S.growth[2]!);
          buf.set(16, y, S.growth[1]!);
        }
      } else if (id === 'ossuary') {
        base(0, 0);
        bones(p, r, 9, MATERIALS.boneDry);
      } else if (id === 'forge') {
        base(1);
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (pnoise(x, y, 8, seed + 20) > 0.6) buf.set(x, y, mix(buf.get(x, y) & 0xffffff, 0x020202, 0.55));
      } else {
        base(1, 0.55);
      }
      break;
    case 5: // pool
      base(2, id === 'flooded' ? 0.2 : 0);
      if (id === 'frost') {
        pool(buf, 15, 17, 11, 7, S.pool, seed);
        crack(buf, r, 10, 16, 8, S.pool[4]!, S.pool[3]!);
      } else pool(buf, 15, 18, id === 'flooded' ? 11 : 8, id === 'flooded' ? 7 : 5, S.pool, seed, S.poolGlow);
      break;
    case 6: {
      // grate
      base(3, 0.1);
      const glowUnder = id === 'forge';
      p.rect(7, 9, 18, 14).fill(id === 'frost' ? S.accent : MATERIALS.iron, { mode: 'emboss' });
      for (let k = 0; k < 5; k++) p.rect(9 + k * 3, 11, 1.6, 10);
      p.fill(glowUnder ? S.pool : [0x020202, 0x040404, 0x060606, 0x080808], { mode: glowUnder ? 'sphere' : 'flat', tone: 0, inner: false, glow: glowUnder ? S.pool[3]! : undefined });
      if (id === 'flooded') p.px(12, 22, S.pool[3]!).px(18, 23, S.pool[3]!);
      p.finish(OUT, 0.8);
      break;
    }
    case 7: // scattered bits
      base(0);
      if (id === 'ossuary') bones(p, r, 12, MATERIALS.boneDry);
      else if (id === 'flooded') blobs(p, r, 6, S.growth, [1, 1.5]);
      else if (id === 'sanctum') {
        for (let k = 0; k < 4; k++) {
          const x = 5 + r() * 22;
          const y = 6 + r() * 20;
          p.ellipse(x, y, 1.8, 1.2).fill(MATERIALS.wax, { mode: 'sphere', inner: false });
          p.px(x, y - 1, MATERIALS.wax[3]!);
        }
      } else if (id === 'fungal') {
        if (!iso) {
          shroomCluster(p, 10, 14, S.growth, 3, seed);
          shroomCluster(p, 22, 26, S.accent, 2, seed + 1, 0.8);
        }
        p.finish(OUT, 0.8);
      } else if (id === 'forge') {
        for (let k = 0; k < 7; k++) {
          const x = Math.round(4 + r() * 24);
          const y = Math.round(4 + r() * 24);
          buf.set(x, y, k % 3 === 0 ? S.pool[3]! : 0x1a1414);
          buf.set(x + 1, y, k % 3 === 0 ? S.pool[2]! : 0x2a2222);
        }
      } else if (id === 'frost') {
        for (let k = 0; k < 6; k++) {
          const x = 5 + r() * 22;
          const y = 6 + r() * 20;
          const a = r() * Math.PI;
          p.poly([x + Math.cos(a) * 2.6, y + Math.sin(a) * 1.6, x - Math.cos(a) * 2.6, y - Math.sin(a) * 1.6, x + 0.8, y - 1.6]);
        }
        p.fill(S.accent, { mode: 'facet', facets: 3, inner: false });
      }
      break;
    case 8: // rubble
      base(2);
      for (let k = 0; k < 9; k++) p.ellipse(16 + (r() - 0.5) * 22, 18 + (r() - 0.5) * 11, 1.4 + r() * 2.2, 1 + r() * 1.5);
      p.fill(id === 'ossuary' ? MATERIALS.boneDry : id === 'frost' ? S.growth : S.wall, { mode: 'sphere', light: 0.15 });
      outlinePass(buf, S.mortar, 240);
      break;
    case 9: // feature slab
      base(3);
      if (id === 'sanctum') {
        // ritual circle with glowing runes
        for (let a = 0; a < Math.PI * 2; a += 0.05) {
          buf.set(Math.round(16 + Math.cos(a) * 12), Math.round(16 + Math.sin(a) * 12), S.growth[2]!);
          buf.set(Math.round(16 + Math.cos(a) * 9), Math.round(16 + Math.sin(a) * 9), S.accent[1]!);
        }
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
          const b = ((k + 2) / 5) * Math.PI * 2 - Math.PI / 2;
          p.line(16 + Math.cos(a) * 9, 16 + Math.sin(a) * 9, 16 + Math.cos(b) * 9, 16 + Math.sin(b) * 9);
        }
        p.fill(S.accent, { mode: 'flat', tone: 2, glow: S.accent[2]!, inner: false });
        p.finish(OUT, 0.6);
      } else if (id === 'ossuary') {
        skull(p, 16, 15, 2, MATERIALS.boneDry, S.accent[0]!);
        bones(p, r, 4, MATERIALS.boneDry, [4, 22, 24, 6]);
      } else if (id === 'frost') {
        // a corpse frozen under the ice
        p.ellipse(16, 16, 12, 9).fill(S.pool, { mode: 'sphere', alpha: 230, inner: false });
        p.ellipse(14, 13, 2.6, 2.3).fill(MATERIALS.boneDry, { mode: 'sphere', alpha: 170, inner: false });
        p.capsule(14, 16, 19, 21, 2.2, 1.8).capsule(16, 18, 22, 15, 0.8, 0.7).fill(MATERIALS.sinew, { mode: 'emboss', alpha: 160, inner: false });
        p.px(10, 10, 0xffffff).px(11, 10, S.pool[3]!);
      } else if (id === 'forge') {
        p.rect(5, 5, 22, 22).fill(MATERIALS.iron, { mode: 'emboss', dither: true });
        for (const [x, y] of [[7, 7], [24, 7], [7, 24], [24, 24]] as const) p.px(x, y, MATERIALS.iron[4]!);
        crack(buf, r, 10, 18, 10, S.pool[2]!, S.pool[3]!, true);
      } else if (id === 'fungal') {
        p.capsule(1, 20, 14, 14, 2.4, 1.8).capsule(14, 14, 31, 18, 1.8, 2.2).fill(MATERIALS.root, { mode: 'cyl' });
        if (!iso) shroomCluster(p, 14, 13, S.growth, 3, seed + 4);
        p.finish(OUT, 0.8);
      } else {
        crack(buf, r, 6, 20, 20, S.mortar, S.floor[3]!);
        pool(buf, 22, 10, 5, 3, S.pool, seed);
      }
      break;
    case 10: // mixed
      base(0, id === 'flooded' || id === 'fungal' ? 0.3 : 0);
      crack(buf, r, 10, 6, 12, id === 'forge' ? S.pool[2]! : S.growth[1]!, id === 'forge' ? S.pool[3]! : S.growth[2]!, id === 'forge');
      pool(buf, 22, 22, 5, 3, S.pool, seed, S.poolGlow);
      break;
    default:
      base(1, 0.05);
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (pnoise(x, y, 16, seed + 50) > 0.55) buf.set(x, y, mix(buf.get(x, y) & 0xffffff, 0x040303, 0.3));
      break;
  }
  return buf;
}

// ---------------------------------------------------------------- walls

function falloff(buf: PixelBuffer, oy: number): void {
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      let c = buf.get(x, y + oy) & 0xffffff;
      if (y < 3) c = mix(c, 0x040404, 0.55 - y * 0.15);
      if (y > 22) c = mix(c, 0x040404, (y - 22) * 0.045);
      buf.set(x, y + oy, c);
    }
  for (let x = 0; x < T; x++) buf.set(x, oy + T - 1, 0x050505);
}

function brickFace(buf: PixelBuffer, oy: number, ramp: Ramp, mortar: number, seed: number, bw = 16, bh = 8): void {
  for (let y = 0; y < T; y++) {
    const row = Math.floor(y / bh);
    const ly = y % bh;
    for (let x = 0; x < T; x++) {
      const off = (row % 2) * (bw / 2);
      const bx = Math.floor((x + off) / bw);
      const lx = (x + off) % bw;
      let c: number;
      if (ly === bh - 1 || lx === bw - 1) c = mortar;
      else {
        let v = 1.6 + hash2(bx + row * 7, seed, 11) * 1.4 + (pnoise(x, y, 8, seed) - 0.5) * 0.9 + bayer(x, y) * 0.3;
        if (ly === 0) v += 0.9;
        if (ly === bh - 2) v -= 0.7;
        if (lx === 0) v += 0.3;
        c = tone(ramp, v);
      }
      buf.set(x, y + oy, c);
    }
  }
}

function themeFaceBase(id: VariantTheme, buf: PixelBuffer, oy: number, v: number): void {
  const S = STYLES[id];
  const seed = 300 + v * 7 + id.length;
  if (id === 'flooded' || id === 'frost') {
    brickFace(buf, oy, S.wall, S.mortar, seed);
    if (id === 'flooded') {
      // waterline: darker, slick lower course with algae
      for (let y = 19; y < T; y++)
        for (let x = 0; x < T; x++) {
          let c = mix(buf.get(x, y + oy) & 0xffffff, 0x081820, 0.35);
          if (y === 19 || (y === 20 && hash2(x, y, 3) > 0.5)) c = S.growth[2]!;
          else if (pnoise(x, y, 4, seed + 2) > 0.72) c = tone(S.growth, 1 + bayer(x, y) * 2);
          buf.set(x, y + oy, c);
        }
    } else {
      // frost rime: pale crystals clinging near the top and on brick edges
      for (let y = 0; y < T; y++)
        for (let x = 0; x < T; x++) {
          const rime = pnoise(x, y, 4, seed + 3) * 0.6 + (1 - y / T) * 0.6;
          if (rime > 0.78) buf.set(x, y + oy, tone(S.growth, (rime - 0.78) * 14 + bayer(x, y)));
        }
    }
  } else if (id === 'ossuary') {
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) buf.set(x, y + oy, tone(S.accent, 1 + bayer(x, y)));
    const p = new Painter(buf);
    for (let row = 0; row < 4; row++) {
      const y = oy + 4 + row * 8;
      if ((row + v) % 2 === 0) {
        for (let k = 0; k < 6; k++) skull(p, (k * 6 + (row % 2) * 3 + 2) % 34, y, 1, S.wall, S.accent[0]!);
      } else {
        for (let k = 0; k < 3; k++) {
          const x0 = k * 11 + (row % 3) * 2;
          p.capsule(x0, y - 1, x0 + 9, y - 1, 1, 1).capsule(x0 + 1, y + 1.5, x0 + 10, y + 1.5, 1, 1);
          p.circle(x0, y - 1, 1.5).circle(x0 + 9, y - 1, 1.5).circle(x0 + 1, y + 1.5, 1.5).circle(x0 + 10, y + 1.5, 1.5);
        }
        p.fill(S.wall, { mode: 'emboss', light: -0.05 });
      }
    }
  } else if (id === 'sanctum') {
    brickFace(buf, oy, S.wall, 0x050304, seed, 16, 13);
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        const vein = Math.abs(Math.sin((x * 0.5 - y * 0.8 + pnoise(x, y, 8, seed + 5) * 8) * 0.8));
        if (vein > 0.985) buf.set(x, y + oy, mix(buf.get(x, y + oy) & 0xffffff, 0xb8a0a8, 0.3));
      }
    // gold trim bands
    for (let x = 0; x < T; x++) {
      buf.set(x, oy + 1, S.growth[3]!);
      buf.set(x, oy + 2, S.growth[1]!);
      buf.set(x, oy + 27, S.growth[3]!);
      buf.set(x, oy + 28, S.growth[2]!);
      buf.set(x, oy + 29, S.growth[0]!);
    }
  } else if (id === 'fungal') {
    const r = rng(seed);
    const pts: [number, number][] = [];
    for (let k = 0; k < 7; k++) pts.push([r() * T, r() * T]);
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        let d1 = 1e9;
        let d2 = 1e9;
        let best = 0;
        pts.forEach(([px, py], k) => {
          for (const ox of [-T, 0, T]) {
            const d = Math.hypot(x - px - ox, (y - py) * 1.2);
            if (d < d1) {
              d2 = d1;
              d1 = d;
              best = k;
            } else if (d < d2) d2 = d;
          }
        });
        const [, py] = pts[best]!;
        const vv = d2 - d1 < 1.2 ? 0.2 : 1.6 + hash2(best, seed, 1) + (py - y) * 0.09 + (pnoise(x, y, 8, seed) - 0.5) * 0.7 + bayer(x, y) * 0.3;
        buf.set(x, y + oy, tone(S.wall, vv));
      }
  } else {
    // forge: vertical basalt columns
    for (let x = 0; x < T; x++) {
      const col = Math.floor(x / 6);
      const lx = x % 6;
      for (let y = 0; y < T; y++) {
        const topCut = Math.floor(hash2(col, v, 9) * 3);
        let c: number;
        if (lx === 5 || y < topCut) c = 0x040304;
        else {
          let vv = 1.8 + hash2(col, seed, 2) * 0.8 + (lx === 0 ? 0.9 : lx === 1 ? 0.4 : lx === 4 ? -0.5 : 0) + (pnoise(x, y, 8, seed) - 0.5) * 0.6 + bayer(x, y) * 0.25;
          if ((y + col * 5) % 13 === 0) vv = 0.4;
          c = tone(S.wall, vv);
        }
        buf.set(x, y + oy, c);
      }
    }
  }
  falloff(buf, oy);
}

function themeFaceDetail(id: VariantTheme, p: Painter, buf: PixelBuffer, oy: number, v: number): void {
  const S = STYLES[id];
  const r = rng(1500 + v * 19 + id.length * 7);
  const y0 = oy;
  const crackDown = (col: number, hi: number, glow = false): void => {
    let x = 9 + r() * 12;
    let y = y0 + 3;
    for (let k = 0; k < 24; k++) {
      x += (r() - 0.5) * 2.2;
      y += 1;
      buf.set(Math.round(x), Math.round(y), col);
      if (glow) buf.blend(Math.round(x) + 1, Math.round(y), hi, 140);
      else if (k % 3 === 0) buf.set(Math.round(x) + 1, Math.round(y), hi);
    }
  };
  const drips = (col: number, hi: number, n: number): void => {
    for (let k = 0; k < n; k++) {
      const x = Math.round(3 + r() * 26);
      const len = 3 + Math.floor(r() * 9);
      for (let y = 3; y < 3 + len; y++) buf.set(x, y0 + y, mix(buf.get(x, y0 + y) & 0xffffff, col, 0.6));
      buf.set(x, y0 + 3 + len, hi);
    }
  };
  if (v === 0) return;
  switch (id) {
    case 'flooded':
      if (v === 1) crackDown(S.mortar, S.wall[3]!);
      else if (v === 2) blobs(p, r, 8, S.growth, [1.5, 2.5], [0, 14, 32, 16]);
      else if (v === 3) drips(S.pool[2]!, S.pool[4]!, 7);
      else if (v === 4) {
        p.rect(14, y0 + 9, 4, 3).fill(MATERIALS.iron, { mode: 'emboss' });
        p.ellipse(16, y0 + 16, 4.6, 4.6).minus().ellipse(16, y0 + 16, 3, 3).fill(MATERIALS.rust, { mode: 'emboss', dither: true });
      } else if (v === 5) {
        p.rect(11, y0, 10, 31).fill(S.accent, { mode: 'cyl', dither: true });
        p.line(14, y0 + 2, 14, y0 + 29).line(18, y0 + 4, 17, y0 + 28).fill(S.accent, { mode: 'flat', tone: 0, inner: false });
        blobs(p, r, 4, S.growth, [1, 1.6], [10, 20, 12, 10]);
      } else if (v === 6) {
        p.ellipse(16, y0 + 12, 5, 4).fill(MATERIALS.iron, { mode: 'sphere' });
        p.ellipse(16, y0 + 12, 3, 2.4).fill([0x020202, 0x040404, 0x060606, 0x080808], { mode: 'flat', inner: false });
        for (let y = 15; y < 31; y++) p.rect(15 + Math.sin(y) * 0.5, y0 + y, 2, 1);
        p.fill(S.pool, { mode: 'flat', tone: 3, alpha: 200, inner: false });
      } else {
        p.ellipse(16, y0 + 15, 7, 6).fill([0x040808, 0x081010, 0x0c1818, 0x122020], { mode: 'flat', tone: 1, inner: false });
        blobs(p, r, 6, S.growth, [1.2, 2], [9, 14, 14, 8], S.growth[3]!);
      }
      break;
    case 'ossuary':
      if (v === 3) {
        p.ellipse(16, y0 + 15, 8, 8).fill([0x020101, 0x050303, 0x080505, 0x0c0807], { mode: 'flat', tone: 1, inner: false });
        skull(p, 16, y0 + 15, 2, S.wall, 0x050303);
      } else if (v === 4) {
        skull(p, 16, y0 + 18, 1.6, S.wall, 0x050303);
        p.rect(15, y0 + 9, 2.2, 5).fill(MATERIALS.wax, { mode: 'cyl', inner: false });
        p.gpx(16, y0 + 8, MATERIALS.flame[3]!, MATERIALS.flame[2]!).gpx(16, y0 + 7, MATERIALS.flame[2]!, MATERIALS.flame[2]!);
      } else if (v === 5) crackDown(0x050303, S.wall[3]!);
      else if (v === 6) {
        for (let a = Math.PI; a <= Math.PI * 2; a += 0.35) skull(p, 16 + Math.cos(a) * 10, y0 + 22 + Math.sin(a) * 13, 0.9, S.wall, 0x050303);
        p.ellipse(16, y0 + 24, 6, 7).fill([0x020101, 0x050303, 0x080505, 0x0c0807], { mode: 'flat', tone: 1, inner: false });
      } else if (v === 7) {
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) buf.set(x, y0 + y, mix(buf.get(x, y0 + y) & 0xffffff, 0x8a6a2a, 0.18));
        for (let k = 0; k <= 4; k++) p.line(0, y0, Math.cos((k / 4) * Math.PI / 2) * 14, y0 + Math.sin((k / 4) * Math.PI / 2) * 14);
        p.fill([0xd0c8b8, 0xd0c8b8, 0xd0c8b8, 0xd0c8b8], { mode: 'flat', alpha: 130, inner: false });
      }
      break;
    case 'sanctum':
      if (v === 1) crackDown(0x020102, S.wall[3]!);
      else if (v === 2 || v === 7) {
        const col = v === 2 ? S.growth : S.accent;
        const cx = 16;
        const cy = y0 + 14;
        for (let a = 0; a < Math.PI * 2; a += 0.12) p.dot(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7);
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 - Math.PI / 2;
          const b = a + (Math.PI * 2) / 3;
          p.line(cx + Math.cos(a) * 6, cy + Math.sin(a) * 6, cx + Math.cos(b) * 6, cy + Math.sin(b) * 6);
        }
        p.fill(col, { mode: 'flat', tone: 2, glow: col[2]!, inner: false });
      } else if (v === 3) drips(S.pool[2]!, S.pool[3]!, 6);
      else if (v === 4) {
        p.rect(14, y0 + 9, 4, 3).fill(S.growth, { mode: 'emboss' });
        p.ellipse(16, y0 + 16, 4.4, 4.4).minus().ellipse(16, y0 + 16, 2.9, 2.9).fill(S.growth, { mode: 'emboss' });
      } else if (v === 5) {
        const pts = [8, y0 + 3, 24, y0 + 3, 24, y0 + 22, 16, y0 + 26, 8, y0 + 22];
        p.poly(pts).fill(MATERIALS.bloodRed, { mode: 'cyl', dither: true });
        p.rect(7, y0 + 2, 18, 2).fill(S.growth, { mode: 'emboss' });
        p.poly([16, y0 + 8, 19, y0 + 12, 16, y0 + 17, 13, y0 + 12]).fill(S.growth, { mode: 'flat', tone: 2, inner: false });
      } else if (v === 6) {
        p.ellipse(16, y0 + 16, 8, 10).fill([0x050203, 0x0a0405, 0x100708, 0x160a0c], { mode: 'flat', tone: 1, inner: false });
        for (let a = Math.PI; a <= Math.PI * 2; a += 0.1) p.dot(16 + Math.cos(a) * 8.5, y0 + 16 + Math.sin(a) * 10.5);
        p.fill(S.growth, { mode: 'flat', tone: 2, inner: false });
        for (const [cx, h] of [[12, 6], [16, 9], [20, 5]] as const) {
          p.rect(cx - 1, y0 + 25 - h, 2.2, h).fill(MATERIALS.wax, { mode: 'cyl', inner: false });
          p.gpx(cx, y0 + 23 - h, MATERIALS.flame[3]!, MATERIALS.flame[2]!);
        }
        for (let k = 0; k < 3; k++) p.px(11 + k * 4, y0 + 26, MATERIALS.wax[3]!);
      }
      break;
    case 'fungal':
      if (v === 1) crackDown(S.mortar, S.wall[3]!);
      else if (v === 2) shroomCluster(p, 16, y0 + 29, S.growth, 5, 9);
      else if (v === 3) shroomCluster(p, 14, y0 + 29, S.accent, 4, 11, 1.2);
      else if (v === 4) {
        for (let k = 0; k < 4; k++) {
          const x = 5 + k * 7 + r() * 2;
          p.capsule(x, y0, x + (r() - 0.5) * 4, y0 + 10 + r() * 14, 1.4, 0.5);
        }
        p.fill(MATERIALS.root, { mode: 'cyl' });
      } else if (v === 5) {
        for (let k = 0; k < 3; k++) crackDown(S.growth[2]!, S.growth[3]!, true);
      } else if (v === 6) {
        blobs(p, r, 5, MATERIALS.broodFlesh, [1.6, 1.6], [6, 8, 20, 14], S.accent[2]!);
      } else {
        blobs(p, r, 7, PALETTES.dungeon.moss, [1.6, 2], [0, 0, 32, 6]);
        for (let k = 0; k < 4; k++) {
          const x = 3 + r() * 26;
          p.capsule(x, y0 + 4, x, y0 + 9 + r() * 10, 0.8, 0.4);
        }
        p.fill(PALETTES.dungeon.moss, { mode: 'cyl' });
      }
      break;
    case 'forge':
      if (v === 1 || v === 6) {
        crackDown(S.pool[2]!, S.pool[3]!, true);
        if (v === 6) {
          for (let y = 18; y < 31; y++) p.rect(14 + Math.sin(y * 0.6), y0 + y, 3, 1);
          p.fill(S.pool, { mode: 'cyl', glow: S.pool[3]!, inner: false });
        }
      } else if (v === 2) {
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (pnoise(x, y, 8, 77) > 0.5 && y < 20) buf.set(x, y0 + y, mix(buf.get(x, y0 + y) & 0xffffff, 0x000000, 0.6));
      } else if (v === 3) {
        p.rect(5, y0 + 5, 22, 20).fill(MATERIALS.iron, { mode: 'emboss', dither: true });
        for (const [x, y] of [[7, 7], [24, 7], [7, 22], [24, 22], [16, 7], [16, 22]] as const) p.px(x, y0 + y, MATERIALS.iron[4]!);
      } else if (v === 4) {
        for (const cx of [10, 22]) {
          for (let k = 0; k < 8; k++) {
            const y = y0 + 2 + k * 3.2;
            if (k % 2) p.ellipse(cx, y, 1.8, 1.1);
            else p.ellipse(cx, y, 1.1, 1.8);
          }
        }
        p.fill(MATERIALS.iron, { mode: 'sphere', light: 0.15 });
      } else if (v === 5) {
        p.rect(8, y0 + 10, 16, 12).fill(MATERIALS.iron, { mode: 'emboss' });
        for (let k = 0; k < 4; k++) p.rect(10 + k * 3.6, y0 + 12, 1.8, 8);
        p.fill(S.pool, { mode: 'sphere', glow: S.pool[3]!, inner: false });
      } else if (v === 7) {
        p.ellipse(16, y0 + 18, 9, 9).minus().rect(0, y0 + 24, 32, 8).fill(MATERIALS.iron, { mode: 'emboss' });
        p.ellipse(16, y0 + 19, 6.5, 6.5).minus().rect(0, y0 + 24, 32, 8).fill(S.pool, { mode: 'sphere', glow: S.pool[3]!, light: 0.2, inner: false });
      }
      break;
    case 'frost':
      if (v === 1) crackDown(S.accent[3]!, S.accent[4]!);
      else if (v === 2) {
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (pnoise(x, y, 4, 91) * 0.7 + (1 - y / T) * 0.4 > 0.62) buf.set(x, y0 + y, tone(S.growth, 1 + bayer(x, y) * 2));
      } else if (v === 3) {
        for (let y = 0; y < 30; y++) {
          const w = 3 + Math.sin(y * 0.3) * 1.2;
          for (let x = Math.floor(16 - w); x <= 16 + w; x++) buf.set(x, y0 + y, tone(S.pool, 2 + (x === Math.floor(16 - w) ? 1.5 : 0) + bayer(x, y) * 0.8));
        }
      } else if (v === 4) {
        p.rect(14, y0 + 9, 4, 3).fill(MATERIALS.iron, { mode: 'emboss' });
        p.ellipse(16, y0 + 16, 4.6, 4.6).minus().ellipse(16, y0 + 16, 3, 3).fill(S.accent, { mode: 'emboss' });
      } else if (v === 5) {
        for (let k = 0; k < 6; k++) {
          const x = 3 + k * 5.2 + r() * 2;
          const L = 6 + r() * 12;
          p.poly([x - 1.6, y0, x + 1.6, y0, x, y0 + L]);
        }
        p.fill(S.accent, { mode: 'facet', facets: 3, glow: S.accent[3]!, inner: false });
      } else if (v === 6) {
        // corpse frozen in a block of ice
        p.rect(6, y0 + 3, 20, 25).fill(S.pool, { mode: 'emboss', alpha: 235 });
        p.ellipse(16, y0 + 9, 3, 2.8).fill(MATERIALS.paleSkin, { mode: 'sphere', alpha: 190, inner: false });
        p.capsule(16, y0 + 12, 16, y0 + 22, 2.6, 2.2).capsule(13, y0 + 13, 11, y0 + 20, 0.9, 0.8).capsule(19, y0 + 13, 21, y0 + 8, 0.9, 0.8).fill(MATERIALS.chain, { mode: 'emboss', alpha: 170, inner: false });
        p.px(15, y0 + 9, 0x202838).px(17, y0 + 9, 0x202838);
        p.line(8, y0 + 5, 12, y0 + 9).fill(S.accent, { mode: 'flat', tone: 4, inner: false, alpha: 220 });
      } else if (v === 7) {
        for (let y = 20; y < 31; y++) for (let x = 0; x < T; x++) {
          const h = 22 + Math.sin(x * 0.35) * 2.5 + pnoise(x, 0, 8, 3) * 3;
          if (y >= h) buf.set(x, y0 + y, tone(S.growth, 1.5 + (y - h < 1 ? 1.5 : 0) + bayer(x, y) * 0.6));
        }
      }
      break;
    default:
      break;
  }
}

/** Wall tops of the open-air and machine themes (replacing the masonry courses): turf, regolith, steel deck plate. */
function openCap(id: 'sky' | 'moon' | 'server', buf: PixelBuffer, oy: number, seed: number): void {
  const S = STYLES[id];
  // moon: two little craters per top (period 32, so neighbouring tops tile)
  const craters: [number, number, number][] = [[8 + hash2(1, 2, seed) * 8, 8 + hash2(3, 4, seed) * 8, 3 + hash2(5, 6, seed) * 2], [20 + hash2(7, 8, seed) * 6, 18 + hash2(9, 1, seed) * 8, 2 + hash2(2, 3, seed) * 2]];
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      let c: number;
      if (id === 'sky') {
        const n = pnoise(x, y, 8, seed) * 0.6 + pnoise(x, y, 4, seed + 1) * 0.4;
        c = tone(S.cap, 0.9 + n * 2.6 + bayer(x, y) * 0.45);
        const h = hash2(x, y, seed + 2);
        if (h > 0.9 && n > 0.45) c = S.growth[4]!;
        else if (h < 0.06) c = S.cap[0]!;
        if (hash2(x, y, seed + 3) > 0.988) c = hash2(x, y, seed + 4) > 0.5 ? 0xfff0b0 : 0xf0b0d0;
        if (pnoise(x, y, 8, seed + 5) > 0.74) c = tone(S.wall, 1.6 + pnoise(x, y, 4, seed + 6) * 2 + bayer(x, y) * 0.3);
      } else if (id === 'moon') {
        let v = 1.7 + (pnoise(x, y, 8, seed) - 0.5) * 1.1 + (pnoise(x, y, 4, seed + 1) - 0.5) * 0.6 + bayer(x, y) * 0.35;
        for (const [cx, cy, r] of craters) {
          const d = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.1) / r;
          if (d < 0.8) v -= 0.9 - d * 0.5;
          else if (d < 1.15) v += (cy > y ? 0.9 : -0.3);
        }
        c = tone(S.cap, v);
        if (hash2(x, y, seed + 2) > 0.985) c = S.cap[4]!;
      } else {
        const px = Math.floor(x / 16), py = Math.floor(y / 16), lx = x % 16, ly = y % 16;
        const seam = lx === 15 || ly === 15;
        let v = 2 + (pnoise(x, y, 8, seed) - 0.5) * 0.4 + bayer(x, y) * 0.25 + (lx === 0 || ly === 0 ? 0.8 : 0);
        const vented = hash2(px, py, seed + 7) < 0.5;
        if (vented && lx >= 3 && lx <= 12 && ly >= 3 && ly <= 12 && ly % 3 === 1) v = 0.4;
        c = seam ? S.mortar : tone(S.cap, v);
        if ((lx === 1 || lx === 13) && (ly === 1 || ly === 13)) c = S.cap[4]!;
        if (!vented && lx === 7 && ly === 7) c = hash2(px, py, seed + 8) > 0.5 ? S.growth[3]! : S.accent[3]!;
      }
      buf.set(x, y + oy, c);
    }
}

function themeCap(id: VariantTheme, buf: PixelBuffer, oy: number, variant: number, mask: number, faceBelow: boolean): void {
  const S = STYLES[id];
  const C = S.cap;
  const seed = 900 + variant * 13 + id.length;
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const seamY = y % 16 === 15;
      const seamX = (x + (Math.floor(y / 16) % 2) * 8) % 16 === 15;
      let v = 2 + (pnoise(x, y, 8, seed) - 0.5) * 1.1 + (pnoise(x, y, 4, seed + 3) - 0.5) * 0.6 + bayer(x, y) * 0.3;
      if (id === 'frost') v = 1.4 + (pnoise(x, y, 8, seed) - 0.5) * 1.4 + bayer(x, y) * 0.4;
      else if (seamY || seamX) v = 0.4;
      else if (y % 16 === 0) v += 0.6;
      let c = tone(C, v);
      const g = pnoise(x, y, 8, seed + 7);
      if (id === 'flooded' && g > 0.78) c = tone(S.growth, 0.4 + pnoise(x, y, 4, seed) * 1.6);
      if (id === 'fungal' && g > 0.68) c = tone(PALETTES.dungeon.moss, 0.8 + pnoise(x, y, 4, seed) * 2);
      if (id === 'forge' && g > 0.8 && hash2(x, y, seed) > 0.93) c = S.pool[1]!;
      buf.set(x, y + oy, c);
    }
  }
  if (id === 'sky' || id === 'moon' || id === 'server') openCap(id, buf, oy, seed);
  const p = new Painter(buf);
  const r = rng(seed + mask);
  if (id === 'ossuary') for (let k = 0; k < 3; k++) skull(p, 5 + r() * 22, oy + 5 + r() * 20, 1, S.wall, S.accent[0]!);
  if (id === 'fungal' && (variant + mask) % 3 === 0) {
    shroomCluster(p, 6 + r() * 20, oy + 12 + r() * 14, r() > 0.5 ? S.growth : S.accent, 2, seed, 0.7);
    p.finish(OUT, 0.7);
  }
  if (id === 'forge') for (let k = 0; k < 3; k++) p.gpx(4 + r() * 24, oy + 4 + r() * 22, S.pool[3]!, S.pool[2]!);
  const rim = (x: number, y: number, c: number): void => buf.set(x, y + oy, c);
  const lit = C[4]!;
  if (mask & 1)
    for (let x = 0; x < T; x++) {
      rim(x, 0, OUT);
      rim(x, 1, lit);
      rim(x, 2, mix(C[3]!, C[2]!, 0.5));
    }
  if (mask & 2)
    for (let y = 0; y < T; y++) {
      rim(0, y, OUT);
      rim(1, y, lit);
    }
  if (mask & 4)
    for (let y = 0; y < T; y++) {
      rim(T - 1, y, OUT);
      rim(T - 2, y, C[1]!);
    }
  if (faceBelow) {
    for (let x = 0; x < T; x++) {
      rim(x, T - 3, C[3]!);
      rim(x, T - 2, lit);
      rim(x, T - 1, C[2]!);
    }
    if (id === 'sanctum') for (let x = 0; x < T; x++) rim(x, T - 2, S.growth[3]!);
  }
}

function themeWallFrame(id: VariantTheme, faceVariant: number | null, mask: number, capVariant: number): PixelBuffer {
  const buf = new PixelBuffer(T, T * 2);
  themeCap(id, buf, 0, capVariant, mask, faceVariant !== null);
  if (faceVariant !== null) {
    themeFaceBase(id, buf, T, faceVariant);
    const p = new Painter(buf);
    themeFaceDetail(id, p, buf, T, faceVariant);
    p.finish(OUT, 0.8);
    if (id === 'frost') {
      // icicles hanging from the cap lip on every face
      const r = rng(77 + faceVariant);
      for (let k = 0; k < 5; k++) {
        const x = Math.round(2 + r() * 28);
        const L = 2 + Math.floor(r() * 4);
        for (let y = 0; y < L; y++) buf.set(x, T + y, y === L - 1 ? STYLES.frost.accent[4]! : STYLES.frost.accent[2]!);
      }
    }
    const wEdge = (mask & 2) !== 0;
    const eEdge = (mask & 4) !== 0;
    for (let y = T; y < T * 2; y++) {
      if (wEdge) {
        buf.set(0, y, OUT);
        buf.set(1, y, mix(buf.get(1, y) & 0xffffff, 0xffe0b0, 0.2));
      }
      if (eEdge) {
        buf.set(T - 1, y, OUT);
        buf.set(T - 2, y, mix(buf.get(T - 2, y) & 0xffffff, 0x000000, 0.35));
      }
    }
  }
  return buf;
}

function themeVoid(id: VariantTheme): PixelBuffer {
  const buf = new PixelBuffer(T, T);
  const vc = STYLES[id].void;
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const n = pnoise(x, y, 8, 501 + id.length) * 0.6 + pnoise(x, y, 4, 502) * 0.4;
      buf.set(x, y, mix(vc, lighten(vc, 0.08), n * 0.7 + bayer(x, y) * 0.1));
    }
  return buf;
}

export interface ThemeFrames {
  key: string;
  frames: PixelBuffer[];
  frameW: number;
  frameH: number;
}

/** Floor (12), wall (48) and void frames for a variant theme. */
export function buildThemeFrames(id: VariantTheme): ThemeFrames[] {
  const floors = Array.from({ length: 12 }, (_, v) => themeFloor(id, v));
  const walls: PixelBuffer[] = [];
  for (let v = 0; v < 8; v++) for (let e = 0; e < 4; e++) walls.push(themeWallFrame(id, v, ((e & 1) ? 2 : 0) | ((e & 2) ? 4 : 0), v % 2));
  for (let mask = 0; mask < 8; mask++) for (let v = 0; v < 2; v++) walls.push(themeWallFrame(id, null, mask, v));
  return [
    { key: `dungeon:floor:${id}`, frames: floors, frameW: T, frameH: T },
    { key: `dungeon:wall:${id}`, frames: walls, frameW: T, frameH: T * 2 },
    { key: `dungeon:void:${id}`, frames: [themeVoid(id)], frameW: T, frameH: T },
  ];
}

// ---------------------------------------------------------------- theme props

export interface ThemePropSpec {
  key: string;
  anim?: string;
  originX: number;
  originY: number;
  placement: 'wallFace' | 'floor' | 'corner';
  blocks: boolean;
  light?: { color: number; radius: number; intensity: number; flicker: number };
  w: number;
  h: number;
  frames: number;
  durations?: number[];
  draw: (p: Painter, i: number, n: number) => void;
  /** runs on each frame after the outline pass */
  post?: (buf: PixelBuffer) => void;
}

function flame(p: Painter, cx: number, by: number, h: number, w: number, sway: number, ramp: Ramp): void {
  p.poly([cx - w, by, cx + w, by, cx + w * 0.6 + sway * 0.4, by - h * 0.45, cx + sway, by - h, cx - w * 0.6 + sway * 0.3, by - h * 0.5]).fill(ramp, {
    mode: 'emboss',
    glow: ramp[3]!,
    light: 0.35,
    inner: false,
  });
  p.poly([cx - w * 0.45, by, cx + w * 0.45, by, cx + sway * 0.6, by - h * 0.55]).fill(ramp, { mode: 'flat', tone: Math.min(4, ramp.length - 1), inner: false });
}

const COLD_FLAME = R(0x1a3a8a, 0x3a7ae0, 0x8ac8ff, 0xd8f0ff, 0xffffff);
const RED_FLAME = R(0x5a0606, 0xb01414, 0xff3a2a, 0xffa080, 0xfff0e0);
const GREEN_FLAME = R(0x064030, 0x0e8a6a, 0x2af0c0, 0xa0ffe8, 0xffffff);

function torchVariant(key: string, ramp: Ramp, light: number, sconce: Ramp): ThemePropSpec {
  return {
    key,
    anim: key,
    originX: 0.5,
    originY: 1,
    placement: 'wallFace',
    blocks: false,
    light: { color: light, radius: 140, intensity: 0.9, flicker: 0.22 },
    w: 16,
    h: 32,
    frames: 4,
    durations: [90, 110, 80, 120],
    draw: (p, i) => {
      p.rect(5, 26, 6, 3).fill(sconce, { mode: 'emboss' });
      p.capsule(8, 27, 8, 18, 1.4, 1.2).fill(sconce, { mode: 'cyl' });
      p.capsule(8, 21, 8, 13, 1.6, 2).fill(MATERIALS.darkWood, { mode: 'cyl' });
      p.ellipse(8, 13, 2.6, 1.4).fill(sconce, { mode: 'sphere' });
      flame(p, 8, 13, [9, 11, 10, 12][i] ?? 10, 3, [0, 1, -1, 0.5][i] ?? 0, ramp);
    },
  };
}

/** Height of the tall dungeon pillars (px): the shaft runs on past the capital into the dark of the vault. */
export const PILLAR_H = 112;

/**
 * A tall free-standing pillar for any theme (32 x PILLAR_H, origin bottom centre): moulded base, fluted or
 * themed shaft, capital, and an impost that keeps rising and dissolves into the darkness above.
 */
export function paintTallPillar(p: Painter, id: ThemeId): void {
  const S: Style = id === 'catacombs'
    ? { floor: R(0x0d0d10, 0x17171b, 0x222126, 0x2e2c32, 0x3e3b41), mortar: 0x060607, growth: MATERIALS.mossDark, pool: R(0x0a1014, 0x16222a, 0x2a3c46, 0x5e7e8a, 0xa8c4cc), wall: R(0x1e1813, 0x342a22, 0x4c3e32, 0x665444, 0x84705a), cap: R(0x14110f, 0x24201c, 0x36302a, 0x4c443c, 0x7a6c5c), accent: MATERIALS.rust, void: 0x050405 }
    : STYLES[id];
  const H = PILLAR_H;
  const shaftTop = 34, shaftBot = H - 16;
  const shaft = id === 'sanctum' ? (S.floor2 ?? S.wall) : id === 'frost' ? R(0x2a3c54, 0x40587a, 0x5c7aa0, 0x86a6c8, 0xc0d8f0) : S.wall;
  const capRamp = id === 'sanctum' ? S.growth : id === 'frost' ? R(0x4a6482, 0x6a88aa, 0x8cacca, 0xb8d0e8, 0xe8f4ff) : id === 'sky' ? S.wall : id === 'moon' ? S.accent : id === 'server' ? S.wall : S.cap;
  // base: plinth block, top face, torus moulding
  p.rect(3, H - 11, 26, 10).fill(S.cap, { mode: 'emboss', dither: true });
  p.ellipse(16, H - 11, 13.5, 4).fill(capRamp, { mode: 'emboss', light: 0.3 });
  p.ellipse(16, H - 14, 10.5, 3.2).fill(capRamp, { mode: 'sphere', light: 0.15 });
  // shaft
  if (id === 'ossuary') {
    p.rect(8, shaftTop, 16, shaftBot - shaftTop).fill(S.accent, { mode: 'flat', tone: 1 });
    for (let k = 0; k < 9; k++) for (let j = 0; j < 3; j++) skull(p, 11 + j * 5 + (k % 2) * 2 - 1, shaftTop + 4 + k * 7, 0.85, S.wall, S.accent[0]!);
  } else if (id === 'fungal') {
    p.poly([9, shaftBot, 23, shaftBot, 21, shaftTop, 11, shaftTop]).fill(S.wall, { mode: 'cyl', dither: true });
    p.capsule(10, shaftBot - 4, 13, shaftTop + 8, 1.5, 0.8).capsule(22, shaftBot - 8, 19, shaftTop + 20, 1.2, 0.6).fill(MATERIALS.root, { mode: 'cyl' });
    shroomCluster(p, 20, shaftBot - 14, S.growth, 3, 5, 1.1);
    shroomCluster(p, 12, shaftTop + 24, S.accent, 2, 7);
    shroomCluster(p, 18, shaftTop + 8, S.growth, 2, 9, 0.8);
  } else if (id === 'sky') {
    // a weathered sandstone column, sun-bleached on its lit side, ivy climbing out of the turf
    p.rect(8, shaftTop, 16, shaftBot - shaftTop).fill(S.wall, { mode: 'cyl', dither: true, cx: 13 });
    for (let k = 0; k < 4; k++) p.line(10 + k * 4, shaftTop + 2, 10 + k * 4, shaftBot - 2);
    p.fill(S.wall, { mode: 'flat', tone: 1, inner: false, alpha: 140 });
    for (const y of [shaftTop + 22, shaftTop + 46]) p.rect(8, y, 16, 1);
    p.fill(S.wall, { mode: 'flat', tone: 0, inner: false, alpha: 200 });
    const r = rng(53);
    let vx = 12;
    for (let y = shaftBot; y > shaftTop + 10; y -= 1.5) {
      vx += (r() - 0.5) * 1.6;
      vx = Math.max(9, Math.min(23, vx));
      p.dot(vx, y);
      if (r() < 0.35) p.ellipse(vx + (r() < 0.5 ? -1.6 : 1.6), y, 1.3, 1);
    }
    p.fill(S.growth, { mode: 'sphere', dither: true, inner: false });
  } else if (id === 'moon') {
    // an outpost support pylon: a riveted steel shaft in a hazard-striped collar, a dead beacon at its head
    p.rect(9, shaftTop, 14, shaftBot - shaftTop).fill(S.accent, { mode: 'cyl', cx: 13 });
    for (let y = shaftTop + 4; y < shaftBot - 4; y += 9) for (const x of [10, 21]) p.px(x, y, S.accent[4]!);
    for (let y = shaftBot - 14; y < shaftBot - 4; y++) for (let x = 9; x < 23; x++) p.px(x, y, (x + y) % 6 < 3 ? 0xd8a020 : 0x18181c);
    p.rect(8, shaftTop + 30, 16, 3).fill(S.wall, { mode: 'cyl', inner: false });
    p.ellipse(16, shaftTop + 3, 2.4, 2).fill(R(0x3a0808, 0x6a1010, 0xa01e1e, 0xd04040, 0xf08080), { mode: 'sphere', inner: false });
  } else if (id === 'server') {
    // a cable riser: a dark steel column cased in cable bundles, a cyan status strip running up its face
    p.rect(8, shaftTop, 16, shaftBot - shaftTop).fill(S.wall, { mode: 'cyl', dither: true, cx: 13 });
    for (const x of [10, 21]) p.line(x, shaftTop + 2, x, shaftBot - 2);
    p.fill(R(0x060608, 0x0e0e12, 0x18181e, 0x24242c, 0x32323c), { mode: 'cyl', inner: false });
    for (let y = shaftTop + 6; y < shaftBot - 6; y += 4) p.px(15, y, S.growth[y % 12 === 2 ? 4 : 3]!).px(16, y, S.growth[2]!);
    for (const y of [shaftTop + 18, shaftTop + 44]) p.rect(7, y, 18, 2);
    p.fill(S.cap, { mode: 'cyl', inner: false });
    p.px(13, shaftTop + 26, S.accent[3]!).px(18, shaftBot - 20, S.accent[3]!);
  } else {
    p.rect(8, shaftTop, 16, shaftBot - shaftTop).fill(shaft, { mode: 'cyl', dither: true, cx: 14 });
    // fluting: dark grooves with a lit edge
    for (let k = 0; k < 4; k++) p.line(10 + k * 4, shaftTop + 2, 10 + k * 4, shaftBot - 2);
    p.fill(shaft, { mode: 'flat', tone: 0, inner: false, alpha: 150 });
    for (let k = 0; k < 3; k++) p.line(11 + k * 4, shaftTop + 2, 11 + k * 4, shaftBot - 2);
    p.fill(shaft, { mode: 'flat', tone: Math.min(4, shaft.length - 1), inner: false, alpha: 70 });
    // drum joints
    for (const y of [shaftTop + 20, shaftTop + 42]) p.rect(8, y, 16, 1);
    p.fill(shaft, { mode: 'flat', tone: 0, inner: false, alpha: 200 });
    if (id === 'sanctum') {
      for (const y of [shaftTop + 10, shaftBot - 10]) p.rect(8, y, 16, 2.5);
      p.fill(S.growth, { mode: 'cyl', inner: false });
    }
    if (id === 'forge') {
      for (const y of [shaftTop + 6, shaftTop + 30, shaftBot - 8]) p.rect(7, y, 18, 3);
      p.fill(MATERIALS.iron, { mode: 'cyl', inner: false });
      p.capsule(18, shaftTop + 12, 16.5, shaftTop + 28, 0.8, 0.8).capsule(14, shaftTop + 36, 15, shaftBot - 12, 0.7, 0.6).fill(S.pool, { mode: 'flat', tone: 2, glow: S.pool[3]!, inner: false });
    }
    if (id === 'flooded') {
      p.rect(8, shaftBot - 22, 16, 22).fill(S.growth, { mode: 'cyl', dither: true, alpha: 210, inner: false });
      p.rect(8, shaftBot - 23, 16, 1).fill(S.pool, { mode: 'flat', tone: 3, inner: false });
      const r = rng(97);
      for (let k = 0; k < 18; k++) p.ellipse(9 + r() * 14, shaftBot - 34 + r() * 14, 1.3, 1);
      p.fill(R(0x3a3c3a, 0x6a6c66, 0x9a9a90, 0xc8c6b8, 0xe8e6da), { mode: 'sphere', light: 0.2, inner: true });
    }
    if (id === 'catacombs') {
      const r = rng(4);
      let x = 18, y = shaftTop + 8;
      for (let k = 0; k < 26; k++) {
        x += (r() - 0.5) * 2;
        y += 1.5;
        p.dot(x, y);
      }
      p.fill([0x0a0807, 0x0a0807, 0x0a0807, 0x0a0807], { mode: 'flat', inner: false });
      for (let k = 0; k < 7; k++) p.ellipse(9 + r() * 14, shaftBot - 6 + r() * 5, 2.4 + r() * 2, 1.8);
      p.fill(S.growth, { mode: 'sphere', dither: true, inner: false });
    }
    if (id === 'frost') {
      const r = rng(31);
      for (let k = 0; k < 10; k++) p.ellipse(9 + r() * 14, shaftTop + r() * (shaftBot - shaftTop), 1.6 + r() * 2, 1.2 + r() * 3);
      p.fill(R(0x8a9ab0, 0xb4c4d8, 0xdce8f6, 0xf6faff), { mode: 'sphere', dither: true, inner: false, alpha: 220 });
    }
  }
  // capital: echinus + abacus
  p.ellipse(16, shaftTop, 11.5, 3.6).fill(capRamp, { mode: 'sphere', light: 0.2 });
  p.rect(3, shaftTop - 9, 26, 7).fill(S.cap, { mode: 'emboss', dither: true });
  p.ellipse(16, shaftTop - 9, 13, 3.6).fill(capRamp, { mode: 'emboss', light: 0.3 });
  if (id === 'frost') {
    for (let k = 0; k < 6; k++) p.poly([5 + k * 4.4, shaftTop - 2, 7.4 + k * 4.4, shaftTop - 2, 6.2 + k * 4.4, shaftTop + 3 + (k % 3) * 3]);
    p.fill(S.accent, { mode: 'facet', facets: 3, inner: false });
  }
  if (id === 'catacombs' || id === 'fungal') p.ellipse(9, shaftTop - 10, 4, 1.8).ellipse(23, shaftTop - 11, 3, 1.4).fill(id === 'fungal' ? S.growth : MATERIALS.mossDark, { mode: 'sphere', dither: true, inner: false });
  // impost rising on into the vault
  p.rect(7, 0, 18, shaftTop - 9).fill(S.cap, { mode: 'cyl', dither: true, cx: 14, light: -0.25 });
  for (let k = 0; k < 2; k++) p.rect(7, 6 + k * 9, 18, 1);
  p.fill(S.cap, { mode: 'flat', tone: 0, inner: false, alpha: 200 });
}

/** Dissolve the top of a pillar frame into the dark (ordered dither) after the outline pass. */
export function fadePillarTop(buf: PixelBuffer, rows = 34): void {
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < buf.w; x++) {
      const c = buf.get(x, y);
      if (!(c >>> 24)) continue;
      const t = y / rows;
      if (bayer(x, y) + 0.47 > Math.pow(t, 0.8) * 1.2) buf.set(x, y, 0, 0);
      else buf.set(x, y, mix(c & 0xffffff, 0x000000, (1 - t) * 0.85), c >>> 24);
    }
}

function pillarVariant(id: VariantTheme): ThemePropSpec {
  return {
    key: `prop:pillar_${id}`,
    originX: 0.5,
    originY: 1,
    placement: 'floor',
    blocks: true,
    w: 32,
    h: PILLAR_H,
    frames: 1,
    draw: (p) => paintTallPillar(p, id),
    post: (buf) => fadePillarTop(buf),
  };
}

export const THEME_PROP_SPECS: Record<string, ThemePropSpec> = {
  torch_cold: torchVariant('prop:torch_cold', COLD_FLAME, 0x9ad8ff, MATERIALS.iron),
  torch_red: torchVariant('prop:torch_red', RED_FLAME, 0xff4a3a, MATERIALS.brass),
  torch_green: torchVariant('prop:torch_green', GREEN_FLAME, 0x4af0c8, MATERIALS.root),
  // ---- flooded
  puddle: {
    key: 'prop:puddle',
    originX: 0.5,
    originY: 0.5,
    placement: 'floor',
    blocks: false,
    w: 32,
    h: 20,
    frames: 1,
    draw: (p) => {
      p.ellipse(16, 10, 14, 8).fill(STYLES.flooded.pool, { mode: 'sphere', alpha: 225, inner: false });
      p.ellipse(11, 7, 4, 1.5).fill(STYLES.flooded.pool, { mode: 'flat', tone: 3, alpha: 200, inner: false });
      p.ellipse(20, 12, 2, 1).fill(STYLES.flooded.pool, { mode: 'flat', tone: 4, alpha: 220, inner: false });
    },
  },
  beam: {
    key: 'prop:beam',
    originX: 0.5,
    originY: 0.7,
    placement: 'floor',
    blocks: false,
    w: 40,
    h: 16,
    frames: 1,
    draw: (p) => {
      p.poly([2, 6, 36, 2, 38, 8, 4, 13]).fill(STYLES.flooded.accent, { mode: 'cyl', dither: true });
      p.line(6, 8, 34, 4).line(10, 11, 30, 8).fill(STYLES.flooded.accent, { mode: 'flat', tone: 0, inner: false });
      p.ellipse(30, 7, 4, 2.5).fill(STYLES.flooded.growth, { mode: 'sphere', dither: true, inner: false });
      p.poly([36, 2, 39, 1, 38, 8]).fill(STYLES.flooded.accent, { mode: 'emboss', light: -0.2 });
    },
  },
  // ---- ossuary
  skullwall: {
    key: 'prop:skullwall',
    originX: 0.5,
    originY: 1,
    placement: 'wallFace',
    blocks: false,
    w: 24,
    h: 24,
    frames: 1,
    draw: (p) => {
      p.ellipse(12, 13, 10, 10).minus().rect(0, 21, 24, 4).fill(STYLES.ossuary.cap, { mode: 'emboss' });
      p.ellipse(12, 13, 8, 8).minus().rect(0, 21, 24, 4).fill(STYLES.ossuary.accent, { mode: 'flat', tone: 0, inner: false });
      skull(p, 8, 17, 1, STYLES.ossuary.wall, 0x050303);
      skull(p, 16, 17, 1, STYLES.ossuary.wall, 0x050303);
      skull(p, 12, 10, 1.3, STYLES.ossuary.wall, 0x050303);
      p.rect(2, 20, 20, 2).fill(STYLES.ossuary.cap, { mode: 'emboss', light: 0.2 });
    },
  },
  bonepile2: {
    key: 'prop:bonepile2',
    originX: 0.5,
    originY: 0.85,
    placement: 'floor',
    blocks: false,
    w: 32,
    h: 22,
    frames: 1,
    draw: (p) => {
      const r = rng(31);
      bones(p, r, 14, MATERIALS.boneDry, [4, 8, 24, 10]);
      skull(p, 12, 10, 1.2, MATERIALS.boneDry, 0x0e0808);
      skull(p, 21, 13, 1, MATERIALS.boneDry, 0x0e0808);
      p.capsule(5, 16, 27, 18, 1.1, 1.1).fill(MATERIALS.boneDry, { mode: 'cyl' });
    },
  },
  coffin: {
    key: 'prop:coffin',
    originX: 0.5,
    originY: 0.9,
    placement: 'floor',
    blocks: false,
    w: 32,
    h: 24,
    frames: 1,
    draw: (p) => {
      const W = MATERIALS.darkWood;
      p.poly([3, 14, 9, 22, 25, 22, 30, 14, 25, 9, 9, 9]).fill(W, { mode: 'emboss', dither: true });
      p.poly([4, 10, 9, 4, 25, 4, 29, 10, 25, 14, 9, 14]).fill(W, { mode: 'emboss', light: 0.25 });
      p.line(16, 5, 16, 13).line(12, 8, 20, 8).fill(MATERIALS.brass, { mode: 'flat', tone: 2, inner: false });
      p.poly([22, 4, 28, 1, 29, 6]).fill(W, { mode: 'emboss', light: 0.1 });
    },
  },
  // ---- sanctum
  ritual: {
    key: 'prop:ritual',
    anim: 'prop:ritual',
    originX: 0.5,
    originY: 0.5,
    placement: 'floor',
    blocks: false,
    light: { color: 0xff3030, radius: 90, intensity: 0.45, flicker: 0.12 },
    w: 48,
    h: 48,
    frames: 3,
    durations: [260, 260, 260],
    draw: (p, i) => {
      const S = STYLES.sanctum;
      const ring = (rad: number, ramp: Ramp, toneI: number, glow?: number): void => {
        for (let a = 0; a < Math.PI * 2; a += 0.03) p.dot(24 + Math.cos(a) * rad, 24 + Math.sin(a) * rad);
        p.fill(ramp, { mode: 'flat', tone: toneI, glow, inner: false, alpha: 230 });
      };
      ring(21, S.growth, 2);
      ring(16.5, S.accent, 1 + (i % 2), S.accent[2]!);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 - Math.PI / 2 + i * 0.04;
        const b = ((k + 2) / 5) * Math.PI * 2 - Math.PI / 2 + i * 0.04;
        p.line(24 + Math.cos(a) * 16, 24 + Math.sin(a) * 16, 24 + Math.cos(b) * 16, 24 + Math.sin(b) * 16);
      }
      p.fill(S.accent, { mode: 'flat', tone: 2, glow: S.accent[2]!, inner: false, alpha: 220 });
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        p.gpx(24 + Math.cos(a) * 19, 24 + Math.sin(a) * 19, (k + i) % 3 === 0 ? S.accent[3]! : S.growth[3]!, S.accent[2]!);
      }
    },
  },
  goldcandles: {
    key: 'prop:goldcandles',
    anim: 'prop:goldcandles',
    originX: 0.5,
    originY: 0.95,
    placement: 'floor',
    blocks: false,
    light: { color: 0xffb060, radius: 80, intensity: 0.7, flicker: 0.3 },
    w: 20,
    h: 28,
    frames: 3,
    durations: [120, 140, 110],
    draw: (p, i) => {
      const G = STYLES.sanctum.growth;
      p.capsule(10, 26, 10, 14, 1.2, 1.2).fill(G, { mode: 'cyl' });
      p.ellipse(10, 26, 6, 2).fill(G, { mode: 'emboss' });
      p.capsule(3, 14, 17, 14, 1, 1).fill(G, { mode: 'cyl' });
      const cs: [number, number][] = [[3, 7], [10, 9], [17, 7]];
      cs.forEach(([cx, h], k) => {
        p.rect(cx - 1, 13 - h, 2.2, h).fill(MATERIALS.wax, { mode: 'cyl', inner: false });
        p.px(cx + 1, 14 - h + 2, MATERIALS.wax[3]!).px(cx - 1, 14 - h + 4, MATERIALS.wax[3]!);
        const f = (i + k) % 3;
        p.gpx(cx + (f === 1 ? 1 : 0), 11 - h, MATERIALS.flame[3]!, MATERIALS.flame[2]!).gpx(cx, 10 - h - (f === 2 ? 1 : 0), MATERIALS.flame[2]!, MATERIALS.flame[2]!);
      });
    },
  },
  altar: {
    key: 'prop:altar',
    originX: 0.5,
    originY: 0.95,
    placement: 'floor',
    blocks: true,
    light: { color: 0xff3a2a, radius: 70, intensity: 0.5, flicker: 0.25 },
    w: 40,
    h: 36,
    frames: 1,
    draw: (p) => {
      const S = STYLES.sanctum;
      p.rect(4, 18, 32, 16).fill(S.wall, { mode: 'emboss', dither: true });
      p.poly([4, 18, 8, 10, 36, 10, 36, 18]).fill(S.wall, { mode: 'emboss', light: 0.3 });
      p.rect(4, 18, 32, 1.6).fill(S.growth, { mode: 'cyl', inner: false });
      p.rect(4, 32, 32, 1.6).fill(S.growth, { mode: 'cyl', inner: false });
      p.poly([4, 18, 10, 18, 10, 30, 7, 34, 4, 30]).fill(MATERIALS.bloodRed, { mode: 'cyl', dither: true, inner: false });
      p.ellipse(22, 13, 6, 2).fill(S.pool, { mode: 'sphere', inner: false });
      p.rect(28, 3, 2.2, 8).fill(MATERIALS.wax, { mode: 'cyl', inner: false });
      p.gpx(29, 2, MATERIALS.flame[3]!, MATERIALS.flame[2]!);
      p.poly([20, 24, 23, 27, 20, 30, 17, 27]).fill(S.accent, { mode: 'flat', tone: 2, glow: S.accent[2]!, inner: false });
    },
  },
  // ---- fungal
  shroom: {
    key: 'prop:shroom',
    anim: 'prop:shroom',
    originX: 0.5,
    originY: 0.95,
    placement: 'floor',
    blocks: false,
    light: { color: 0x3ae8c0, radius: 90, intensity: 0.65, flicker: 0.1 },
    w: 24,
    h: 24,
    frames: 4,
    durations: [300, 260, 300, 260],
    draw: (p, i) => {
      const G = STYLES.fungal.growth;
      const pulse = [0, 0.15, 0.3, 0.15][i] ?? 0;
      const caps: [number, number, number][] = [[7, 14, 3], [13, 9, 4.6], [18, 15, 3.2]];
      for (const [x, top, rad] of caps) p.capsule(x, 22, x, top + 1, 0.9, 0.8);
      p.fill(MATERIALS.wax, { mode: 'cyl' });
      for (const [x, top, rad] of caps) p.ellipse(x, top, rad, rad * 0.6);
      p.fill(G, { mode: 'sphere', glow: G[3]!, light: 0.15 + pulse, inner: true });
      for (const [x, top] of caps) p.gpx(x - 1, top - 1, G[4]!, G[3]!);
    },
  },
  shroom2: {
    key: 'prop:shroom2',
    anim: 'prop:shroom2',
    originX: 0.5,
    originY: 0.95,
    placement: 'floor',
    blocks: false,
    light: { color: 0xe050c8, radius: 80, intensity: 0.6, flicker: 0.1 },
    w: 24,
    h: 24,
    frames: 4,
    durations: [280, 320, 280, 320],
    draw: (p, i) => {
      const A = STYLES.fungal.accent;
      const pulse = [0.3, 0.15, 0, 0.15][i] ?? 0;
      const caps: [number, number, number][] = [[9, 12, 4], [16, 16, 3]];
      for (const [x, top] of caps) p.capsule(x, 22, x - 1, top + 1, 1, 0.8);
      p.fill(MATERIALS.wax, { mode: 'cyl' });
      for (const [x, top, rad] of caps) p.ellipse(x, top, rad, rad * 0.7);
      p.fill(A, { mode: 'sphere', glow: A[3]!, light: 0.15 + pulse });
      p.gpx(8, 11, 0xffffff, A[3]!).gpx(15, 15, A[4]!, A[3]!);
    },
  },
  roots: {
    key: 'prop:roots',
    originX: 0.5,
    originY: 0,
    placement: 'wallFace',
    blocks: false,
    w: 28,
    h: 32,
    frames: 1,
    draw: (p) => {
      const r = rng(13);
      for (let k = 0; k < 5; k++) {
        const x = 3 + k * 5.5;
        const mx = x + (r() - 0.5) * 6;
        const L = 14 + r() * 16;
        p.capsule(x, 0, mx, L * 0.6, 1.8, 1.1).capsule(mx, L * 0.6, mx + (r() - 0.5) * 4, L, 1.1, 0.4);
      }
      p.fill(MATERIALS.root, { mode: 'cyl', dither: true });
      p.gpx(9, 20, STYLES.fungal.growth[3]!, STYLES.fungal.growth[2]!);
    },
  },
  // ---- forge
  lavacrack: {
    key: 'prop:lavacrack',
    anim: 'prop:lavacrack',
    originX: 0.5,
    originY: 0.5,
    placement: 'floor',
    blocks: false,
    light: { color: 0xff6a1a, radius: 110, intensity: 0.75, flicker: 0.2 },
    w: 40,
    h: 24,
    frames: 3,
    durations: [200, 180, 220],
    draw: (p, i) => {
      const L = STYLES.forge.pool;
      const r = rng(17);
      let x = 3;
      let y = 12;
      for (let k = 0; k < 18; k++) {
        const nx = x + 2 + r() * 0.6;
        const ny = y + (r() - 0.5) * 4;
        p.capsule(x, y, nx, ny, 1.4 - k * 0.04, 1.3 - k * 0.04);
        if (k % 5 === 2) p.capsule(nx, ny, nx + (r() - 0.5) * 6, ny + (r() > 0.5 ? 5 : -5), 0.9, 0.3);
        x = nx;
        y = Math.max(4, Math.min(20, ny));
      }
      p.fill(L, { mode: 'flat', tone: 2 + (i === 1 ? 1 : 0), glow: L[3]!, inner: false });
      p.gpx(14, 12, L[4]!, L[3]!).gpx(27, 11, L[3 + (i % 2)]!, L[3]!);
    },
  },
  anvil: {
    key: 'prop:anvil',
    originX: 0.5,
    originY: 0.92,
    placement: 'floor',
    blocks: false,
    w: 28,
    h: 22,
    frames: 1,
    draw: (p) => {
      const I = MATERIALS.iron;
      p.rect(9, 12, 10, 8).fill(I, { mode: 'cyl' });
      p.rect(6, 18, 16, 3).fill(I, { mode: 'emboss' });
      p.poly([3, 6, 22, 6, 26, 9, 22, 12, 6, 12]).fill(I, { mode: 'emboss', light: 0.2 });
      p.line(5, 6, 21, 6).fill(I, { mode: 'flat', tone: 4, inner: false });
      p.gpx(14, 5, STYLES.forge.pool[3]!, STYLES.forge.pool[2]!);
    },
  },
  // ---- frost
  icicles: {
    key: 'prop:icicles',
    originX: 0.5,
    originY: 0,
    placement: 'wallFace',
    blocks: false,
    w: 28,
    h: 20,
    frames: 1,
    draw: (p) => {
      const r = rng(41);
      p.rect(1, 0, 26, 3).fill(STYLES.frost.growth, { mode: 'emboss' });
      for (let k = 0; k < 7; k++) {
        const x = 3 + k * 3.6 + r();
        const L = 5 + r() * 13;
        p.poly([x - 1.4, 2, x + 1.4, 2, x, 2 + L]);
      }
      p.fill(STYLES.frost.accent, { mode: 'facet', facets: 3, glow: STYLES.frost.accent[3]! });
    },
  },
  icecrystal: {
    key: 'prop:icecrystal',
    originX: 0.5,
    originY: 0.95,
    placement: 'floor',
    blocks: false,
    light: { color: 0x9ad8ff, radius: 90, intensity: 0.6, flicker: 0.05 },
    w: 24,
    h: 30,
    frames: 1,
    draw: (p) => {
      const A = STYLES.frost.accent;
      const shards: [number, number, number, number][] = [[12, 28, 12, 3], [7, 28, 18, -0.4], [17, 28, 16, 0.5], [12, 28, 24, 0.1]];
      for (const [x, by, h, lean] of shards) p.poly([x - 2.4, by, x + 2.4, by, x + lean * 6 + 0.6, by - h, x + lean * 6 - 0.6, by - h - 1.5]);
      p.fill(A, { mode: 'facet', facets: 3, glow: A[3]!, rot: 0.4 });
      p.ellipse(12, 28, 9, 2).fill(STYLES.frost.growth, { mode: 'sphere', inner: false });
    },
  },
  snowpile: {
    key: 'prop:snowpile',
    originX: 0.5,
    originY: 0.85,
    placement: 'floor',
    blocks: false,
    w: 32,
    h: 18,
    frames: 1,
    draw: (p) => {
      p.ellipse(16, 12, 14, 5).ellipse(11, 9, 7, 5).ellipse(20, 9, 6, 4).fill(STYLES.frost.growth, { mode: 'sphere', dither: true });
      p.px(9, 6, 0xffffff).px(19, 7, 0xffffff);
    },
  },
  // ---- shared obstacle
  sarcophagus: {
    key: 'prop:sarcophagus',
    originX: 0.5,
    originY: 1,
    placement: 'floor',
    blocks: true,
    w: 32,
    h: 48,
    frames: 1,
    draw: (p) => {
      const Sc = MATERIALS.stone;
      // body front face + lid top (3/4 view)
      p.rect(3, 26, 26, 20).fill(Sc, { mode: 'emboss', dither: true });
      p.poly([3, 26, 6, 6, 26, 6, 29, 26]).fill(Sc, { mode: 'emboss', light: 0.25, dither: true });
      // carved effigy on the lid
      p.ellipse(16, 11, 3.2, 2.8).fill(Sc, { mode: 'sphere', light: 0.35, inner: true });
      p.poly([12, 14, 20, 14, 21, 24, 11, 24]).fill(Sc, { mode: 'emboss', light: 0.3, inner: true });
      p.capsule(13, 17, 19, 17, 0.8, 0.8).fill(Sc, { mode: 'flat', tone: 1, inner: false });
      // rim + cracks + moss
      p.rect(3, 25, 26, 2).fill(Sc, { mode: 'flat', tone: 3, inner: false });
      p.line(22, 30, 25, 40).line(8, 34, 10, 44).fill(Sc, { mode: 'flat', tone: 0, inner: false });
      p.ellipse(7, 44, 4, 2).ellipse(25, 8, 3, 1.5).fill(PALETTES.dungeon.moss, { mode: 'sphere', dither: true, inner: false });
    },
  },
  pillar_flooded: pillarVariant('flooded'),
  pillar_ossuary: pillarVariant('ossuary'),
  pillar_sanctum: pillarVariant('sanctum'),
  pillar_fungal: pillarVariant('fungal'),
  pillar_forge: pillarVariant('forge'),
  pillar_frost: pillarVariant('frost'),
  // open sky has no vault to rise into: the sky column ends in a broken, sunlit top instead of fading out
  pillar_sky: { ...pillarVariant('sky'), post: (buf) => {
    for (let x = 0; x < buf.w; x++) {
      const cut = 40 + Math.round(Math.sin(x * 0.9) * 2 + hash2(x, 3, 61) * 5 + (x > 18 ? 6 : 0));
      for (let y = 0; y < cut; y++) buf.set(x, y, 0, 0);
      if (buf.alpha(x, cut)) buf.set(x, cut, mix(buf.get(x, cut) & 0xffffff, 0xfff4d8, 0.35));
    }
  } },
  pillar_moon: pillarVariant('moon'),
  pillar_server: pillarVariant('server'),
};

// ---------------------------------------------------------------- theme decals (grime)

export interface ThemeDecalSpec {
  key: string;
  w: number;
  h: number;
  frames: number;
  draw: (buf: PixelBuffer, i: number) => void;
}

function patch(buf: PixelBuffer, seed: number, fn: (n: number, d: number, x: number, y: number) => [number, number] | null): void {
  const cx = buf.w / 2;
  const cy = buf.h / 2;
  for (let y = 0; y < buf.h; y++)
    for (let x = 0; x < buf.w; x++) {
      const d = Math.hypot((x + 0.5 - cx) / (buf.w * 0.45), (y + 0.5 - cy) / (buf.h * 0.42));
      if (d > 1) continue;
      const n = pnoise(x % T, y % T, 8, seed) * 0.6 + pnoise(x % T, y % T, 4, seed + 1) * 0.4;
      const v = fn(n, d, x, y);
      if (v) buf.set(x, y, v[0], v[1]);
    }
}

export const THEME_DECAL_SPECS: ThemeDecalSpec[] = [
  { key: 'decal:algae', w: 32, h: 32, frames: 3, draw: (b, i) => patch(b, 600 + i, (n, d, x, y) => (n > 0.4 + d * 0.35 ? [tone(STYLES.flooded.growth, 0.6 + n * 2.6 + bayer(x, y) * 0.4), 215] : null)) },
  { key: 'decal:bonedust', w: 32, h: 32, frames: 3, draw: (b, i) => patch(b, 610 + i, (n, d, x, y) => (n > 0.45 + d * 0.3 && hash2(x, y, i) > 0.35 ? [tone(MATERIALS.boneDry, 1 + n * 2.4), 170] : null)) },
  {
    key: 'decal:rune',
    w: 40,
    h: 40,
    frames: 3,
    draw: (b, i) => {
      const r = rng(620 + i);
      const p = new Painter(b);
      for (let a = 0; a < Math.PI * 2; a += 0.05) p.dot(20 + Math.cos(a) * 15, 20 + Math.sin(a) * 15);
      for (let k = 0; k < 4 + i; k++) {
        const a = r() * Math.PI * 2;
        p.line(20 + Math.cos(a) * 4, 20 + Math.sin(a) * 4, 20 + Math.cos(a) * 13, 20 + Math.sin(a) * 13);
      }
      p.fill(STYLES.sanctum.accent, { mode: 'flat', tone: 1, alpha: 160, inner: false });
    },
  },
  { key: 'decal:spores', w: 32, h: 32, frames: 3, draw: (b, i) => patch(b, 630 + i, (n, d, x, y) => (hash2(x, y, 630 + i) > 0.9 - n * 0.1 && d < 0.9 ? [(x + y) % 3 ? STYLES.fungal.growth[3]! : STYLES.fungal.accent[3]!, 220] : null)) },
  { key: 'decal:ash', w: 40, h: 40, frames: 3, draw: (b, i) => patch(b, 640 + i, (n, d) => (n > 0.35 + d * 0.4 ? [n > 0.6 ? 0x050404 : 0x141010, Math.round(200 * (1 - d * 0.5))] : null)) },
  {
    key: 'decal:frost',
    w: 32,
    h: 32,
    frames: 3,
    draw: (b, i) => patch(b, 650 + i, (n, d, x, y) => (n > 0.42 + d * 0.32 ? [tone(STYLES.frost.growth, 0.8 + n * 2.6 + bayer(x, y) * 0.5), 210] : null)),
  },
  // ---- sky: clover and wildflower patches, scattered pale pebbles
  {
    key: 'decal:clover',
    w: 32,
    h: 32,
    frames: 3,
    draw: (b, i) => patch(b, 660 + i, (n, d, x, y) => {
      if (n < 0.38 + d * 0.36) return null;
      const h = hash2(x, y, 661 + i);
      if (h > 0.965) return [h > 0.985 ? 0xfff2a8 : i === 1 ? 0xf0a8d0 : 0xffffff, 255];
      return [tone(STYLES.sky.growth, 0.6 + n * 3 + bayer(x, y) * 0.5), 225];
    }),
  },
  { key: 'decal:pebbles', w: 32, h: 32, frames: 3, draw: (b, i) => patch(b, 670 + i, (n, d, x, y) => (hash2(x, y, 670 + i) > 0.9 - n * 0.08 && d < 0.85 ? [tone(STYLES.sky.floor2!, 1.6 + n * 2.6), 235] : null)) },
  // ---- moon: little impact craters (raised lit rim, shadowed bowl) and drifts of pale dust
  {
    key: 'decal:crater',
    w: 40,
    h: 40,
    frames: 3,
    draw: (b, i) => {
      const r = 8 + i * 3;
      for (let y = 0; y < b.h; y++)
        for (let x = 0; x < b.w; x++) {
          const dx = x + 0.5 - 20, dy = (y + 0.5 - 20) * 1.15;
          const d = Math.hypot(dx, dy) / r + (hash2(x, y, 680 + i) - 0.5) * 0.08;
          if (d > 1.35) continue;
          const M = STYLES.moon.floor;
          if (d < 0.82) b.set(x, y, tone(M, 0.4 + d * 1.6 + (dx + dy < 0 ? -0.4 : 0.6) * (d / 0.82) + bayer(x, y) * 0.3), 225);
          else if (d < 1.05) b.set(x, y, tone(M, (dy < 0 ? 2.4 : 3.6) + bayer(x, y) * 0.4), 235);
          else if (hash2(x, y, 690 + i) > 0.55) b.set(x, y, tone(M, 2.6), Math.round(180 * (1.35 - d) / 0.3));
        }
    },
  },
  { key: 'decal:regolith', w: 40, h: 40, frames: 3, draw: (b, i) => patch(b, 700 + i, (n, d, x, y) => (n > 0.36 + d * 0.38 ? [tone(STYLES.moon.floor, 2.4 + n * 2 + bayer(x, y) * 0.4), Math.round(170 * (1 - d * 0.5))] : null)) },
  // ---- server: glitched pixel smears (RGB-split blocks) and loose cable runs
  {
    key: 'decal:glitch',
    w: 40,
    h: 24,
    frames: 3,
    draw: (b, i) => {
      const r = rng(710 + i);
      for (let k = 0; k < 7 + i * 2; k++) {
        const x0 = Math.floor(r() * 30), y0 = Math.floor(r() * 20), w = 3 + Math.floor(r() * 10), h = 1 + Math.floor(r() * 2);
        const c = k % 3 === 0 ? STYLES.server.accent[3]! : k % 3 === 1 ? STYLES.server.growth[3]! : 0xf0f0ff;
        for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) b.set(x, y, c, 150 + Math.floor(hash2(x, y, i) * 90));
        for (let x = x0; x < x0 + w; x++) b.set(x + 1, y0 + h, STYLES.server.accent[1]!, 110);
      }
    },
  },
  {
    key: 'decal:cable',
    w: 40,
    h: 24,
    frames: 3,
    draw: (b, i) => {
      const p = new Painter(b);
      const r = rng(720 + i);
      const cols: Ramp[] = [R(0x060608, 0x101014, 0x1c1c22, 0x2a2a32, 0x3c3c46), R(0x200608, 0x40100e, 0x6a1c18, 0x983028, 0xc04c40), R(0x06141e, 0x0c2a3a, 0x164a62, 0x2a7090, 0x4a9ac0)];
      for (let k = 0; k < 2 + (i % 2); k++) {
        let x = 2 + r() * 6, y = 4 + r() * 16;
        let a = (r() - 0.5) * 0.8;
        for (let s = 0; s < 34; s++) {
          a += (r() - 0.5) * 0.5;
          x += Math.cos(a);
          y += Math.sin(a) * 0.5;
          p.circle(x, y, 1);
        }
        p.fill(cols[(k + i) % cols.length]!, { mode: 'cyl', inner: false });
      }
    },
  },
];

// ---------------------------------------------------------------- theme table

export interface ThemeArt {
  floorKey: string;
  wallKey: string;
  voidKey: string;
  /** Light2D ambient color */
  ambient: number;
  /** light color for the theme's light sources */
  torchColor: number;
  /** PROPS id of the wall-mounted light */
  torchProp: string;
  /** PROPS id of the theme's pillar (blocks: true) */
  pillarProp: string;
  props: { id: string; weight: number }[];
  wallProps: { id: string; weight: number }[];
  particles: 'dust' | 'drips' | 'spores' | 'embers' | 'snow' | 'petals' | 'data';
  grime: string[];
  puddleTint?: number;
  /** native 2:1 isometric terrain keys (see isoTerrain.ts) */
  iso: { floorKey: string; wallKey: string; stubKey: string; voidKey: string };
}

const isoOf = (t: ThemeId): ThemeArt['iso'] => ({ floorKey: 'iso:floor:' + t, wallKey: 'iso:wall:' + t, stubKey: 'iso:stub:' + t, voidKey: 'iso:void:' + t });

export const THEME_ART: Record<ThemeId, ThemeArt> = {
  catacombs: {
    iso: isoOf('catacombs'),
    floorKey: 'dungeon:floor:catacombs',
    wallKey: 'dungeon:wall:catacombs',
    voidKey: 'dungeon:void:catacombs',
    ambient: 0x6a5a6e,
    torchColor: 0xffa04a,
    torchProp: 'torch',
    pillarProp: 'pillar',
    props: [
      { id: 'bones', weight: 4 },
      { id: 'skullpile', weight: 2 },
      { id: 'barrel', weight: 2 },
      { id: 'crate', weight: 2 },
      { id: 'rubble', weight: 3 },
      { id: 'candles', weight: 2 },
      { id: 'brazier', weight: 1 },
      { id: 'grate', weight: 1 },
      { id: 'coffin', weight: 1 },
    ],
    wallProps: [
      { id: 'banner', weight: 2 },
      { id: 'chains', weight: 3 },
      { id: 'cobweb', weight: 2 },
    ],
    particles: 'dust',
    grime: ['decal:puddle', 'decal:crack', 'decal:moss', 'decal:stain'],
    puddleTint: 0x8aa0b0,
  },
  flooded: {
    iso: isoOf('flooded'),
    floorKey: 'dungeon:floor:flooded',
    wallKey: 'dungeon:wall:flooded',
    voidKey: 'dungeon:void:flooded',
    ambient: 0x4c6276,
    torchColor: 0xffc27a,
    torchProp: 'torch',
    pillarProp: 'pillar_flooded',
    props: [
      { id: 'puddle', weight: 5 },
      { id: 'beam', weight: 3 },
      { id: 'barrel', weight: 2 },
      { id: 'crate', weight: 1 },
      { id: 'rubble', weight: 2 },
      { id: 'grate', weight: 2 },
      { id: 'bones', weight: 1 },
    ],
    wallProps: [
      { id: 'chains', weight: 3 },
      { id: 'cobweb', weight: 1 },
      { id: 'roots', weight: 1 },
    ],
    particles: 'drips',
    grime: ['decal:puddle', 'decal:algae', 'decal:slime', 'decal:stain'],
    puddleTint: 0x6a9a9a,
  },
  ossuary: {
    iso: isoOf('ossuary'),
    floorKey: 'dungeon:floor:ossuary',
    wallKey: 'dungeon:wall:ossuary',
    voidKey: 'dungeon:void:ossuary',
    ambient: 0x6c6254,
    torchColor: 0xffb060,
    torchProp: 'torch',
    pillarProp: 'pillar_ossuary',
    props: [
      { id: 'bonepile2', weight: 4 },
      { id: 'skullpile', weight: 3 },
      { id: 'bones', weight: 4 },
      { id: 'coffin', weight: 2 },
      { id: 'candles', weight: 2 },
      { id: 'rubble', weight: 1 },
    ],
    wallProps: [
      { id: 'skullwall', weight: 3 },
      { id: 'cobweb', weight: 2 },
      { id: 'chains', weight: 1 },
    ],
    particles: 'dust',
    grime: ['decal:bonedust', 'decal:crack', 'decal:stain'],
    puddleTint: 0x7a6a50,
  },
  sanctum: {
    iso: isoOf('sanctum'),
    floorKey: 'dungeon:floor:sanctum',
    wallKey: 'dungeon:wall:sanctum',
    voidKey: 'dungeon:void:sanctum',
    ambient: 0x6c4246,
    torchColor: 0xff4a3a,
    torchProp: 'torch_red',
    pillarProp: 'pillar_sanctum',
    props: [
      { id: 'ritual', weight: 2 },
      { id: 'goldcandles', weight: 4 },
      { id: 'altar', weight: 1 },
      { id: 'candles', weight: 3 },
      { id: 'skullpile', weight: 1 },
    ],
    wallProps: [
      { id: 'banner', weight: 4 },
      { id: 'chains', weight: 1 },
    ],
    particles: 'embers',
    grime: ['decal:rune', 'decal:stain', 'decal:crack'],
    puddleTint: 0x8e1a24,
  },
  fungal: {
    iso: isoOf('fungal'),
    floorKey: 'dungeon:floor:fungal',
    wallKey: 'dungeon:wall:fungal',
    voidKey: 'dungeon:void:fungal',
    ambient: 0x44665c,
    torchColor: 0x4af0c8,
    torchProp: 'torch_green',
    pillarProp: 'pillar_fungal',
    props: [
      { id: 'shroom', weight: 5 },
      { id: 'shroom2', weight: 3 },
      { id: 'rubble', weight: 2 },
      { id: 'bones', weight: 1 },
      { id: 'beam', weight: 1 },
    ],
    wallProps: [
      { id: 'roots', weight: 4 },
      { id: 'cobweb', weight: 2 },
    ],
    particles: 'spores',
    grime: ['decal:spores', 'decal:moss', 'decal:stain'],
    puddleTint: 0x4ab89a,
  },
  forge: {
    iso: isoOf('forge'),
    floorKey: 'dungeon:floor:forge',
    wallKey: 'dungeon:wall:forge',
    voidKey: 'dungeon:void:forge',
    ambient: 0x6c4a36,
    torchColor: 0xff7a2a,
    torchProp: 'torch',
    pillarProp: 'pillar_forge',
    props: [
      { id: 'lavacrack', weight: 4 },
      { id: 'anvil', weight: 2 },
      { id: 'grate', weight: 3 },
      { id: 'brazier', weight: 2 },
      { id: 'crate', weight: 1 },
      { id: 'rubble', weight: 2 },
    ],
    wallProps: [
      { id: 'chains', weight: 4 },
      { id: 'banner', weight: 1 },
    ],
    particles: 'embers',
    grime: ['decal:ash', 'decal:scorch', 'decal:crack'],
  },
  frost: {
    iso: isoOf('frost'),
    floorKey: 'dungeon:floor:frost',
    wallKey: 'dungeon:wall:frost',
    voidKey: 'dungeon:void:frost',
    ambient: 0x586c84,
    torchColor: 0x9ad8ff,
    torchProp: 'torch_cold',
    pillarProp: 'pillar_frost',
    props: [
      { id: 'icecrystal', weight: 3 },
      { id: 'snowpile', weight: 4 },
      { id: 'bones', weight: 2 },
      { id: 'rubble', weight: 2 },
      { id: 'crate', weight: 1 },
    ],
    wallProps: [
      { id: 'icicles', weight: 4 },
      { id: 'chains', weight: 1 },
    ],
    particles: 'snow',
    grime: ['decal:frost', 'decal:crack', 'decal:puddle'],
    puddleTint: 0xa8d8ff,
  },
  // the props named here live in themeProps.ts
  sky: {
    iso: isoOf('sky'),
    floorKey: 'dungeon:floor:sky',
    wallKey: 'dungeon:wall:sky',
    voidKey: 'dungeon:void:sky',
    ambient: 0xc8bca8,
    torchColor: 0xffd890,
    torchProp: 'lantern_sky',
    pillarProp: 'pillar_sky',
    props: [
      { id: 'grass_tuft', weight: 5 },
      { id: 'wildflowers', weight: 3 },
      { id: 'boulder', weight: 3 },
      { id: 'sky_crystal', weight: 1 },
      { id: 'rubble', weight: 1 },
      { id: 'bones', weight: 0.5 },
    ],
    wallProps: [
      { id: 'ivy', weight: 3 },
      { id: 'prayer_flags', weight: 2 },
    ],
    particles: 'petals',
    grime: ['decal:clover', 'decal:pebbles', 'decal:moss'],
    puddleTint: 0x8ad0ee,
  },
  moon: {
    iso: isoOf('moon'),
    floorKey: 'dungeon:floor:moon',
    wallKey: 'dungeon:wall:moon',
    voidKey: 'dungeon:void:moon',
    ambient: 0x5a6478,
    torchColor: 0xcfe4ff,
    torchProp: 'lamp_moon',
    pillarProp: 'pillar_moon',
    props: [
      { id: 'moonrock', weight: 4 },
      { id: 'debris_panel', weight: 2 },
      { id: 'canister', weight: 2 },
      { id: 'solar_panel', weight: 1 },
      { id: 'rubble', weight: 1 },
    ],
    wallProps: [
      { id: 'porthole', weight: 2 },
      { id: 'hull_vent', weight: 2 },
      { id: 'cable_wall', weight: 1 },
    ],
    particles: 'dust',
    grime: ['decal:crater', 'decal:regolith', 'decal:crack'],
    puddleTint: 0x7aa8d8,
  },
  server: {
    iso: isoOf('server'),
    floorKey: 'dungeon:floor:server',
    wallKey: 'dungeon:wall:server',
    voidKey: 'dungeon:void:server',
    ambient: 0x2a3446,
    torchColor: 0x40e8ff,
    torchProp: 'neon_cyan',
    pillarProp: 'pillar_server',
    props: [
      { id: 'cable_coil', weight: 4 },
      { id: 'floor_vent', weight: 2 },
      { id: 'terminal', weight: 2 },
      { id: 'rack_small', weight: 2 },
      { id: 'chip_debris', weight: 2 },
    ],
    wallProps: [
      { id: 'rack_wall', weight: 3 },
      { id: 'neon_magenta', weight: 2 },
      { id: 'cable_wall', weight: 2 },
      { id: 'warning_sign', weight: 1 },
    ],
    particles: 'data',
    grime: ['decal:glitch', 'decal:cable', 'decal:stain'],
    puddleTint: 0x30c8d8,
  },
};

// ---------------------------------------------------------------- raw frame access (used by the isometric terrain builder)

/** One 32x32 floor frame of a variant theme (iso = no upright decorations). */
export function themeFloorFrame(id: VariantTheme, v: number, iso = false): PixelBuffer {
  return themeFloor(id, v, iso);
}

/** The 32x32 top surface of a wall block (no rims). */
export function themeCapTexture(id: VariantTheme, variant: number): PixelBuffer {
  const buf = new PixelBuffer(T, T);
  themeCap(id, buf, 0, variant, 0, false);
  return buf;
}

export function themeVoidFrame(id: VariantTheme): PixelBuffer {
  return themeVoid(id);
}

/** Upright mushroom cluster painter (iso floor polish). */
export function paintShrooms(p: Painter, cx: number, by: number, ramp: Ramp, n: number, seed: number, scale = 1): void {
  shroomCluster(p, cx, by, ramp, n, seed, scale);
}
