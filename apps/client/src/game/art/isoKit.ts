/**
 * Shared helpers for the native 2:1 isometric terrain (framework-free): the 64x32 diamond <-> tile texel
 * mapping, periodic value noise, irregular stone packing on a torus, and height-map -> normal-map
 * conversion for Phaser's Light2D pipeline.
 *
 * Texel space: one world tile is 32x32 texels; a = world x fraction (texel column), b = world y fraction
 * (texel row). A diamond pixel (u, v) maps to texel (floor(a*32), floor(b*32)), 1:1.
 *
 * Normal maps are encoded in Light2D's screen space (x right, y up, z toward the viewer). Floors and wall
 * tops face the viewer; only their relief tilts the normal.
 */
import type { Ramp } from './palette';

export const TILE = 32;
export const DW = 64;
export const DH = 32;
/** Encoded flat normal (0.5, 0.5, 1). */
export const FLAT_NORMAL = 0x8080ff;

/** Diamond coordinates of pixel (u, v) in a 64x32 cell, or null if outside. */
export function diamondAB(u: number, v: number): [number, number] | null {
  const du = (u + 0.5 - 32) / 32;
  const dv = (v + 0.5) / 16;
  const a = (du + dv) / 2;
  const b = (dv - du) / 2;
  if (a < 0 || a >= 1 || b < 0 || b >= 1) return null;
  return [a, b];
}

/** Per diamond pixel: texel column/row (or -1 outside). */
export const DIAMOND_TEXEL: Int16Array = (() => {
  const t = new Int16Array(DW * DH * 2).fill(-1);
  for (let v = 0; v < DH; v++)
    for (let u = 0; u < DW; u++) {
      const ab = diamondAB(u, v);
      if (!ab) continue;
      t[(v * DW + u) * 2] = Math.floor(ab[0] * TILE);
      t[(v * DW + u) * 2 + 1] = Math.floor(ab[1] * TILE);
    }
  return t;
})();

/** Last top-diamond row per column (columns 0 and 63 have no diamond pixels; they continue the faces). */
export const LAST_TOP: number[] = Array.from({ length: DW }, (_, u) => {
  const uu = u < 32 ? u : 63 - u;
  return Math.ceil(15.75 + uu / 2) - 1;
});

export function hashi(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise with an arbitrary period (period must be a multiple of cell). */
export function pnoiseP(x: number, y: number, cell: number, period: number, seed: number): number {
  const n = period / cell;
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const v = (i: number, j: number): number => hashi(((i % n) + n) % n, ((j % n) + n) % n, seed);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
  const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

/** Periodic fractal noise in 0..1 (cells 32/16/8/4 weighted). */
export function fbmP(x: number, y: number, period: number, seed: number, cells: readonly number[] = [32, 16, 8, 4]): number {
  let s = 0;
  let w = 0;
  let k = 1;
  for (const c of cells) {
    s += pnoiseP(x, y, Math.min(c, period), period, seed + c) * k;
    w += k;
    k *= 0.55;
  }
  return s / w;
}

/** Whole periodic value-noise field (size x size, 0..1): much faster than per-texel pnoiseP calls. */
export function noiseField(size: number, cell: number, seed: number): Float32Array {
  const n = Math.max(1, Math.round(size / cell));
  const lat = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) lat[j * n + i] = hashi(i, j, seed);
  const out = new Float32Array(size * size);
  const sm = new Float32Array(cell);
  for (let k = 0; k < cell; k++) {
    const f = k / cell;
    sm[k] = f * f * (3 - 2 * f);
  }
  for (let y = 0; y < size; y++) {
    const j0 = Math.floor(y / cell) % n, j1 = (j0 + 1) % n, sy = sm[y % cell]!;
    for (let x = 0; x < size; x++) {
      const i0 = Math.floor(x / cell) % n, i1 = (i0 + 1) % n, sx = sm[x % cell]!;
      const a = lat[j0 * n + i0]! + (lat[j0 * n + i1]! - lat[j0 * n + i0]!) * sx;
      const b2 = lat[j1 * n + i0]! + (lat[j1 * n + i1]! - lat[j1 * n + i0]!) * sx;
      out[y * size + x] = a + (b2 - a) * sy;
    }
  }
  return out;
}

/** Whole periodic fractal-noise field (weights 1, .55, .3 ...). */
export function fbmField(size: number, seed: number, cells: readonly number[] = [32, 16, 8, 4]): Float32Array {
  const out = new Float32Array(size * size);
  let w = 0;
  let k = 1;
  for (const c of cells) {
    const f = noiseField(size, Math.min(c, size), seed + c);
    for (let i = 0; i < out.length; i++) out[i] += f[i]! * k;
    w += k;
    k *= 0.55;
  }
  for (let i = 0; i < out.length; i++) out[i] /= w;
  return out;
}

export function tone(ramp: Ramp, v: number): number {
  return ramp[Math.max(0, Math.min(ramp.length - 1, Math.floor(v)))] as number;
}

export function mixc(a: number, b: number, t: number): number {
  const tt = t < 0 ? 0 : t > 1 ? 1 : t;
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const r = Math.round(ar + (((b >> 16) & 255) - ar) * tt);
  const g = Math.round(ag + (((b >> 8) & 255) - ag) * tt);
  const bl = Math.round(ab + ((b & 255) - ab) * tt);
  return ((r << 16) | (g << 8) | bl) >>> 0;
}

export function scalec(c: number, k: number, add = 0): number {
  const f = (v: number): number => Math.max(0, Math.min(255, Math.round(v * k + add)));
  return ((f((c >> 16) & 255) << 16) | (f((c >> 8) & 255) << 8) | f(c & 255)) >>> 0;
}

export function luma(c: number): number {
  return (((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.55 + (c & 255) * 0.15) / 255;
}

export function encodeNormal(nx: number, ny: number, nz: number): number {
  const l = Math.hypot(nx, ny, nz) || 1;
  const f = (v: number): number => Math.max(0, Math.min(255, Math.round((v / l) * 127.5 + 127.5)));
  return ((f(nx) << 16) | (f(ny) << 8) | f(nz)) >>> 0;
}

// world axes in Light2D screen space (y up): +x tile -> (+32, +16 px down), +y tile -> (-32, +16 px down)
const WXX = 0.894;
const WXY = -0.447;
const WYX = -0.894;
const WYY = -0.447;

/**
 * Normal map (encoded RGB) of a periodic floor height field in world texel space.
 * strength scales the slope (height units per texel).
 */
export function floorNormals(h: Float32Array, size: number, strength: number): Uint32Array {
  const out = new Uint32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const xl = (x + size - 1) % size, xr = (x + 1) % size, yu = (y + size - 1) % size, yd = (y + 1) % size;
      const gx = (h[y * size + xr]! - h[y * size + xl]!) * 0.5 * strength;
      const gy = (h[yd * size + x]! - h[yu * size + x]!) * 0.5 * strength;
      out[y * size + x] = encodeNormal(-(gx * WXX + gy * WYX), -(gx * WXY + gy * WYY), 1);
    }
  return out;
}

/**
 * Normal map of a wall face height field (face texture space, w x h, not periodic).
 * side 0 = left (SW) face: face x runs screen down-right; side 1 = right (SE) face: face x runs up-right.
 */
export function faceNormals(h: Float32Array, w: number, hh: number, side: 0 | 1, strength: number, tiltX = 0): Uint32Array {
  const out = new Uint32Array(w * hh);
  const ux = 0.894;
  const uy = side === 0 ? -0.447 : 0.447;
  for (let y = 0; y < hh; y++)
    for (let x = 0; x < w; x++) {
      const xl = Math.max(0, x - 1), xr = Math.min(w - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(hh - 1, y + 1);
      const gu = ((h[y * w + xr]! - h[y * w + xl]!) / Math.max(1, xr - xl)) * strength;
      const gv = ((h[yd * w + x]! - h[yu * w + x]!) / Math.max(1, yd - yu)) * strength;
      // face v runs screen-down: (0, -1) in y-up space
      out[y * w + x] = encodeNormal(-(gu * ux) + tiltX, -(gu * uy - gv), 1);
    }
  return out;
}

/** Normal map of an arbitrary screen-space height field (sprites drawn upright). */
export function screenNormals(h: Float32Array, w: number, hh: number, strength: number, mask?: (i: number) => boolean): Uint32Array {
  const out = new Uint32Array(w * hh).fill(FLAT_NORMAL);
  for (let y = 0; y < hh; y++)
    for (let x = 0; x < w; x++) {
      if (mask && !mask(y * w + x)) continue;
      const xl = Math.max(0, x - 1), xr = Math.min(w - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(hh - 1, y + 1);
      const gx = ((h[y * w + xr]! - h[y * w + xl]!) / Math.max(1, xr - xl)) * strength;
      const gy = ((h[yd * w + x]! - h[yu * w + x]!) / Math.max(1, yd - yu)) * strength;
      out[y * w + x] = encodeNormal(-gx, gy, 1);
    }
  return out;
}

// ---------------------------------------------------------------- stone packing (periodic)

export interface Stone {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** 0..1 random attributes */
  r0: number;
  r1: number;
  r2: number;
  r3: number;
}

/**
 * Packs irregular rectangular stones on an n x n torus of cells. `pick` returns a wanted [w, h] in cells;
 * stones shrink to fit. Returns the owner of every cell and the stones.
 */
export function packStones(n: number, rnd: () => number, pick: (r: number) => [number, number]): { owner: Int32Array; stones: Stone[] } {
  const owner = new Int32Array(n * n).fill(-1);
  const stones: Stone[] = [];
  for (let cy = 0; cy < n; cy++)
    for (let cx = 0; cx < n; cx++) {
      if (owner[cy * n + cx]! >= 0) continue;
      const want = pick(rnd());
      let w = 0;
      while (w < want[0] && owner[cy * n + ((cx + w) % n)]! < 0) w++;
      w = Math.max(1, w);
      let h = 1;
      while (h < want[1]) {
        let ok = true;
        for (let i = 0; i < w; i++) if (owner[((cy + h) % n) * n + ((cx + i) % n)]! >= 0) ok = false;
        if (!ok) break;
        h++;
      }
      const id = stones.length;
      stones.push({ cx, cy, w, h, r0: rnd(), r1: rnd(), r2: rnd(), r3: rnd() });
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) owner[((cy + j) % n) * n + ((cx + i) % n)] = id;
    }
  return { owner, stones };
}

/**
 * Texel-level stone ids for a size x size torus with wobbly edges, plus the distance (in texels, capped)
 * of every texel to the nearest joint. Joint texels (distance 0) are the 1px grout lines.
 */
export function stoneField(
  size: number,
  cell: number,
  owner: Int32Array,
  wobble: number,
  seed: number,
  cap = 4,
): { id: Int32Array; dist: Uint8Array } {
  const n = size / cell;
  const id = new Int32Array(size * size);
  const a1 = wobble ? noiseField(size, 16, seed) : null;
  const a2 = wobble ? noiseField(size, 8, seed + 7) : null;
  const b1 = wobble ? noiseField(size, 16, seed + 3) : null;
  const b2 = wobble ? noiseField(size, 8, seed + 9) : null;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const wx = a1 ? Math.round((a1[i]! - 0.5) * 2 * wobble + (a2![i]! - 0.5) * wobble) : 0;
      const wy = b1 ? Math.round((b1[i]! - 0.5) * 2 * wobble + (b2![i]! - 0.5) * wobble) : 0;
      const sx = (((x + wx) % size) + size) % size;
      const sy = (((y + wy) % size) + size) % size;
      id[i] = owner[Math.floor(sy / cell) * n + Math.floor(sx / cell)]!;
    }
  return { id, dist: jointDistance(id, size, cap) };
}

/** Distance (4-neighbour, capped) to the nearest joint texel; joints are texels whose right or lower neighbour differs. */
export function jointDistance(id: Int32Array, size: number, cap: number): Uint8Array {
  const dist = new Uint8Array(size * size).fill(cap);
  const q: number[] = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const r = id[y * size + ((x + 1) % size)]!;
      const d = id[((y + 1) % size) * size + x]!;
      if (r !== id[i] || d !== id[i]) {
        dist[i] = 0;
        q.push(i);
      }
    }
  for (let k = 0; k < q.length; k++) {
    const i = q[k]!;
    const x = i % size, y = (i / size) | 0;
    const nd = dist[i]! + 1;
    if (nd >= cap) continue;
    for (const j of [y * size + ((x + 1) % size), y * size + ((x + size - 1) % size), ((y + 1) % size) * size + x, ((y + size - 1) % size) * size + x]) {
      if (dist[j]! > nd) {
        dist[j] = nd;
        q.push(j);
      }
    }
  }
  return dist;
}

/** Rounded-bevel profile by joint distance: grout well, sloped lip, flat top. */
export function bevel(d: number, depth: number): number {
  return d === 0 ? -depth : d === 1 ? -depth * 0.42 : d === 2 ? -depth * 0.14 : 0;
}
