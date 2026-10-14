/**
 * Atmosphere textures for the dungeon renderer (framework-free): a slanted shaft of light falling through a
 * crack in the vault, the pool it throws on the floor, a low fog bank and the screen grade. White / grey with
 * alpha; the renderer tints them per theme. Alpha is quantised and ordered-dithered so the soft shapes keep
 * the crisp pixel look under nearest filtering.
 */
import { PixelBuffer, bayer, hash2 } from './draw/pixel';

export interface AtmoSheet {
  key: string;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  /** scaled up a lot on screen: linear filtering */
  smooth?: boolean;
}

export const ATMO_KEYS = { shaft: 'fx:shaft', pool: 'fx:shaftpool', fog: 'fx:fog', grade: 'fx:grade' } as const;

/** Quantise an alpha to 6 steps with a 4x4 ordered dither. */
function qa(a: number, x: number, y: number): number {
  const v = Math.max(0, Math.min(1, a)) * 6 + bayer(x, y) * 0.9;
  return Math.max(0, Math.min(6, Math.floor(v))) / 6;
}

function shaft(): PixelBuffer {
  const W = 56, H = 184;
  const b = new PixelBuffer(W, H);
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    // slant: light enters at the top right and falls to the lower left
    const cx = W - 16 - t * (W - 32);
    const half = 7 + t * 9;
    const vfade = Math.min(1, t * 5) * (t > 0.86 ? Math.max(0, 1 - (t - 0.86) / 0.14) : 1);
    for (let x = 0; x < W; x++) {
      const d = Math.abs(x + 0.5 - cx) / half;
      if (d >= 1) continue;
      const streak = 0.8 + 0.2 * Math.sin((x - y * 0.3) * 0.9 + hash2(Math.floor(x / 3), 0, 7) * 6);
      const a = (1 - d * d) * vfade * streak * 0.9;
      const q = qa(a, x, y);
      if (q > 0) b.set(x, y, 0xffffff, Math.round(q * 255));
    }
  }
  return b;
}

function pool(): PixelBuffer {
  const W = 96, H = 48;
  const b = new PixelBuffer(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = Math.hypot((x + 0.5 - W / 2) / (W / 2), (y + 0.5 - H / 2) / (H / 2));
      if (d >= 1) continue;
      const q = qa((1 - d) * (1 - d) * 1.2, x, y);
      if (q > 0) b.set(x, y, 0xffffff, Math.round(q * 255));
    }
  return b;
}

function fog(): PixelBuffer {
  const W = 192, H = 64;
  const b = new PixelBuffer(W, H);
  const n = (x: number, y: number, c: number, s: number): number => {
    const gx = x / c, gy = y / c;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const v = (i: number, j: number): number => hash2(i, j, s);
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
    const bb = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
    return a + (bb - a) * sy;
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = Math.hypot((x + 0.5 - W / 2) / (W / 2), (y + 0.5 - H / 2) / (H / 2));
      if (d >= 1) continue;
      const cloud = n(x, y, 24, 3) * 0.6 + n(x, y, 12, 4) * 0.3 + n(x, y, 6, 5) * 0.1;
      const a = Math.max(0, (1 - d) * 1.6 - 0.15) * (0.35 + cloud * 0.9);
      const q = qa(a, x, y);
      if (q > 0) b.set(x, y, 0xffffff, Math.round(q * 255));
    }
  return b;
}

function grade(): PixelBuffer {
  const S = 64;
  const b = new PixelBuffer(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.hypot((x + 0.5 - S / 2) / (S / 2), (y + 0.5 - S * 0.46) / (S / 2));
      // centre untouched, edges and the top pulled toward the theme colour (multiply)
      const k = Math.min(1, Math.max(0, d - 0.35) * 1.15 + Math.max(0, 0.3 - y / S) * 0.8);
      const v = Math.round(255 - k * 255);
      b.set(x, y, (v << 16) | (v << 8) | v, 255);
    }
  return b;
}

/** The screen grade washed toward a theme colour: white in the middle, `color` at the edges and the top (multiply). */
export function gradeTexture(color: number): AtmoSheet {
  const base = grade();
  const cr = (color >> 16) & 255, cg = (color >> 8) & 255, cb = color & 255;
  for (let i = 0; i < base.data.length; i++) {
    const k = 1 - ((base.data[i]! >> 16) & 255) / 255;
    const r = Math.round(255 + (cr - 255) * k), g = Math.round(255 + (cg - 255) * k), b = Math.round(255 + (cb - 255) * k);
    base.data[i] = (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
  }
  return { key: `fx:grade:${color.toString(16)}`, width: base.w, height: base.h, rgba: base.toRGBA(), smooth: true };
}

/** Every atmosphere texture (tiny; built with the shared dungeon art). */
export function buildAtmosphere(): AtmoSheet[] {
  const out: AtmoSheet[] = [];
  const add = (key: string, buf: PixelBuffer, smooth = false): void => {
    out.push({ key, width: buf.w, height: buf.h, rgba: buf.toRGBA(), smooth });
  };
  add(ATMO_KEYS.shaft, shaft());
  add(ATMO_KEYS.pool, pool());
  add(ATMO_KEYS.fog, fog());
  add(ATMO_KEYS.grade, grade(), true);
  return out;
}
