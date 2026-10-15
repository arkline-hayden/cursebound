/**
 * Shared pixel primitives for procedural effect textures (effects.ts and the per-class sheets in art/fx/). Framework-free.
 * Everything is drawn into PixelBuffers with hard-edged bands: no smooth gradients.
 */
import { PixelBuffer, lighten, rng } from './draw/pixel';

export interface FxSpec {
  key: string;
  w: number;
  h: number;
  frames: number;
  durations: number[];
  loop: boolean;
  /** register a Phaser animation with the same key (default: true for fx:*) */
  anim?: boolean;
  draw: (buf: PixelBuffer, i: number, n: number) => void;
}


/** Banded radial glow: outer haze, body, light, white core. */
export function glow(buf: PixelBuffer, cx: number, cy: number, r: number, col: number, alpha = 255, ry = r): void {
  const x0 = Math.floor(cx - r - 1);
  const x1 = Math.ceil(cx + r + 1);
  const y0 = Math.floor(cy - ry - 1);
  const y1 = Math.ceil(cy + ry + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot((x + 0.5 - cx) / r, (y + 0.5 - cy) / ry);
      if (d > 1) continue;
      let c: number;
      let a: number;
      if (d < 0.3) {
        c = 0xffffff;
        a = 255;
      } else if (d < 0.55) {
        c = lighten(col, 0.55);
        a = 255;
      } else if (d < 0.8) {
        c = col;
        a = 230;
      } else {
        c = col;
        a = 90;
      }
      buf.blend(x, y, c, Math.round((a * alpha) / 255));
    }
  }
}

/** Elliptical ring band (ground plane when ry = rx/2). */
export function ring(buf: PixelBuffer, cx: number, cy: number, rx: number, ry: number, thick: number, col: number, alpha = 255, inner = lighten(col, 0.6)): void {
  const x0 = Math.floor(cx - rx - thick - 1);
  const x1 = Math.ceil(cx + rx + thick + 1);
  const y0 = Math.floor(cy - ry - thick - 1);
  const y1 = Math.ceil(cy + ry + thick + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const d = Math.hypot(dx, dy);
      const dist = (d - 1) * Math.min(rx, ry * 2);
      if (Math.abs(dist) > thick) continue;
      const t = Math.abs(dist) / thick;
      buf.blend(x, y, t < 0.4 ? inner : col, Math.round(alpha * (t < 0.4 ? 1 : 0.75)));
    }
  }
}

export function jag(buf: PixelBuffer, x0: number, y0: number, x1: number, y1: number, seed: number, col: number, core = 0xffffff, segs = 5): void {
  const r = rng(seed);
  let px = x0;
  let py = y0;
  for (let k = 1; k <= segs; k++) {
    const t = k / segs;
    const nx = k === segs ? x1 : x0 + (x1 - x0) * t + (r() - 0.5) * 5;
    const ny = k === segs ? y1 : y0 + (y1 - y0) * t + (r() - 0.5) * 5;
    line(buf, px, py, nx, ny, col, 200, 1);
    line(buf, px, py, nx, ny, core, 255, 0);
    px = nx;
    py = ny;
  }
}

export function line(buf: PixelBuffer, x0: number, y0: number, x1: number, y1: number, col: number, a: number, width: number): void {
  const L = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  for (let k = 0; k <= L; k++) {
    const t = k / L;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    if (width <= 0) buf.blend(x, y, col, a);
    else
      for (let oy = -width; oy <= width; oy++)
        for (let ox = -width; ox <= width; ox++) if (Math.abs(ox) + Math.abs(oy) <= width) buf.blend(x + ox, y + oy, col, a);
  }
}

/** Crescent slash band from angle a0 to a1 (radians), radius r, thickness th; opacity grows toward a1. */
export function crescent(buf: PixelBuffer, cx: number, cy: number, r: number, th: number, a0: number, a1: number, col: number, fade = 1, ry = 1): void {
  const steps = Math.ceil(Math.abs(a1 - a0) * r * 2.5);
  const acc = new Map<number, [number, number]>();
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const a = a0 + (a1 - a0) * t;
    const w = th * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.5;
    for (let q = -w; q <= w; q += 0.5) {
      const rr = r + q;
      const x = Math.round(cx + Math.cos(a) * rr);
      const y = Math.round(cy + Math.sin(a) * rr * ry);
      if (!buf.inside(x, y)) continue;
      const edge = (q + w) / (2 * w);
      const c = edge > 0.65 ? 0xffffff : edge > 0.3 ? lighten(col, 0.45) : col;
      const al = Math.round(255 * fade * Math.min(1, 0.35 + 0.9 * t));
      const key = y * buf.w + x;
      const prev = acc.get(key);
      if (!prev || prev[1] < al) acc.set(key, [c, al]);
    }
  }
  for (const [key, [c, al]] of acc) buf.blend(key % buf.w, Math.floor(key / buf.w), c, al);
}

export function fill(buf: PixelBuffer, fn: (x: number, y: number) => [number, number] | null): void {
  for (let y = 0; y < buf.h; y++)
    for (let x = 0; x < buf.w; x++) {
      const v = fn(x, y);
      if (v) buf.blend(x, y, v[0], v[1]);
    }
}

/**
 * Stamp a tiny hand-placed sprite from rows of characters. `pal` maps a character to [colour, alpha]; spaces and
 * unmapped characters stay transparent. Tintable particles use white/grey so the runtime tint carries the hue.
 */
export function pix(buf: PixelBuffer, rows: readonly string[], pal: Record<string, readonly [number, number]>, ox = 0, oy = 0): void {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!;
    for (let x = 0; x < row.length; x++) {
      const v = pal[row[x]!];
      if (v) buf.blend(ox + x, oy + y, v[0], v[1]);
    }
  }
}

/** Greyscale palette for tintable particles: '#' white, '+' light, 'o' mid, ':' dim, '.' faint haze. */
export const TINT_PAL: Record<string, readonly [number, number]> = {
  '#': [0xffffff, 255], '+': [0xd8d8d8, 255], o: [0xa4a4a4, 255], ':': [0xc8c8c8, 150], '.': [0xffffff, 90],
};

/** Stepped (posterised) value: snaps 0..1 to `steps` hard bands so glows read as pixel art, never smooth gradients. */
export function band(v: number, steps = 4): number {
  return Math.max(0, Math.min(1, Math.ceil(v * steps) / steps));
}
