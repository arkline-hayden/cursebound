/**
 * Framework-free pixel drawing library used by every procedural CURSEBOUND asset.
 *
 * Everything here works on plain typed arrays (no DOM, no Phaser), so the same code runs in the
 * game (Phaser registration in generate.ts), in the developer art viewer (public/art-preview.html)
 * and in Node tooling. Colors are 0xRRGGBB numbers; buffers store 0xAARRGGBB.
 */

import { OUTLINE, type Ramp } from '../palette';

export { OUTLINE };
/** A material ramp: [dark, shadow, base, light] with an optional 5th specular tone. */
export type { Ramp };

export type Shade = 'emboss' | 'sphere' | 'cyl' | 'facet' | 'flat';

export interface FillOpts {
  mode?: Shade;
  /** Draw a darkest-tone separation line where this part's edge overlaps already painted pixels (default true). */
  inner?: boolean;
  /** Ordered dithering at tone boundaries (cloth/organic). */
  dither?: boolean;
  /** Mark the painted pixels as light emitters; finish() gives them a 1px lighter halo of this color. */
  glow?: number;
  /** Lighting bias added before quantising (+ brighter). */
  light?: number;
  /** 0..255 opacity. */
  alpha?: number;
  /** Facet count for 'facet' mode. */
  facets?: number;
  /** Facet rotation (radians) for 'facet' mode. */
  rot?: number;
  /** Fixed ramp index for 'flat' mode (default 2). */
  tone?: number;
  /** Override the shading center (sphere/facet/cyl). */
  cx?: number;
  cy?: number;
}

// Light from the top-left, slightly towards the viewer.
const LX = -0.55;
const LY = -0.62;
const LZ = 0.56;

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function bayer(x: number, y: number): number {
  return (BAYER4[(y & 3) * 4 + (x & 3)] as number) / 16 - 0.47;
}

// ---------------------------------------------------------------- color helpers

export function rgb(r: number, g: number, b: number): number {
  return ((clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b)) >>> 0;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return rgb(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

export function lighten(c: number, t: number): number {
  return mix(c, 0xffffff, t);
}

export function darken(c: number, t: number): number {
  return mix(c, OUTLINE, t);
}

export function hsv(h: number, s: number, v: number): number {
  const hh = (((h % 1) + 1) % 1) * 6;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  let r = v;
  let g = t;
  let b = p;
  switch (i) {
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
    default: break;
  }
  return rgb(r * 255, g * 255, b * 255);
}

/** Build a 4-tone ramp from a base color (hue-shifted shadows toward indigo, highlights toward warm white). */
export function rampFrom(base: number): Ramp {
  return [mix(base, OUTLINE, 0.62), mix(base, 0x2a1858, 0.32), base, mix(base, 0xfff6e0, 0.45)];
}

// ---------------------------------------------------------------- deterministic RNG

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, y: number, s = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- buffer

export class PixelBuffer {
  readonly w: number;
  readonly h: number;
  readonly data: Uint32Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint32Array(w * h);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): number {
    return this.inside(x, y) ? (this.data[y * this.w + x] as number) : 0;
  }

  alpha(x: number, y: number): number {
    return this.get(x, y) >>> 24;
  }

  set(x: number, y: number, color: number, a = 255): void {
    x |= 0;
    y |= 0;
    if (!this.inside(x, y)) return;
    this.data[y * this.w + x] = ((a << 24) | (color & 0xffffff)) >>> 0;
  }

  /** Alpha-over blend. */
  blend(x: number, y: number, color: number, a: number): void {
    x |= 0;
    y |= 0;
    if (!this.inside(x, y) || a <= 0) return;
    if (a >= 255) {
      this.set(x, y, color, 255);
      return;
    }
    const i = y * this.w + x;
    const d = this.data[i] as number;
    const da = d >>> 24;
    if (da === 0) {
      this.data[i] = ((a << 24) | (color & 0xffffff)) >>> 0;
      return;
    }
    const sa = a / 255;
    const oa = sa + (da / 255) * (1 - sa);
    const c = mix(d & 0xffffff, color, sa / oa);
    this.data[i] = ((Math.round(oa * 255) << 24) | c) >>> 0;
  }

  clear(): void {
    this.data.fill(0);
  }

  clone(): PixelBuffer {
    const b = new PixelBuffer(this.w, this.h);
    b.data.set(this.data);
    return b;
  }

  /** Copy (overwrite opaque pixels, blend translucent) into dst at offset. */
  drawTo(dst: PixelBuffer, dx: number, dy: number): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.data[y * this.w + x] as number;
        const a = c >>> 24;
        if (a) dst.blend(x + dx, y + dy, c & 0xffffff, a);
      }
    }
  }

  /** Raw copy (including transparency) into dst at offset. */
  copyTo(dst: PixelBuffer, dx: number, dy: number): void {
    for (let y = 0; y < this.h; y++) {
      const ty = y + dy;
      if (ty < 0 || ty >= dst.h) continue;
      for (let x = 0; x < this.w; x++) {
        const tx = x + dx;
        if (tx < 0 || tx >= dst.w) continue;
        dst.data[ty * dst.w + tx] = this.data[y * this.w + x] as number;
      }
    }
  }

  /** Writes RGBA bytes (ImageData layout). */
  toRGBA(): Uint8ClampedArray {
    const out = new Uint8ClampedArray(this.w * this.h * 4);
    const d = this.data;
    for (let i = 0, j = 0; i < d.length; i++, j += 4) {
      const c = d[i] as number;
      out[j] = (c >>> 16) & 255;
      out[j + 1] = (c >>> 8) & 255;
      out[j + 2] = c & 255;
      out[j + 3] = c >>> 24;
    }
    return out;
  }
}

// ---------------------------------------------------------------- painter

/**
 * Shape-mask painter. Add shapes to the current mask (union, or subtract after `minus()`), then
 * `fill(ramp, opts)` shades the mask with top-left lighting into the buffer. `finish()` runs the
 * 1px outline pass and the glow-halo pass.
 */
export class Painter {
  readonly buf: PixelBuffer;
  readonly w: number;
  readonly h: number;
  private readonly mask: Uint8Array;
  private readonly glowMap: Uint32Array;
  private bx0 = 0;
  private by0 = 0;
  private bx1 = -1;
  private by1 = -1;
  private sub = false;

  constructor(buf: PixelBuffer) {
    this.buf = buf;
    this.w = buf.w;
    this.h = buf.h;
    this.mask = new Uint8Array(buf.w * buf.h);
    this.glowMap = new Uint32Array(buf.w * buf.h);
  }

  /** Reset the buffer and glow map for a new frame. */
  reset(): this {
    this.buf.clear();
    this.glowMap.fill(0);
    this.clearMask();
    return this;
  }

  private clearMask(): void {
    if (this.bx1 >= this.bx0) {
      for (let y = this.by0; y <= this.by1; y++) {
        this.mask.fill(0, y * this.w + this.bx0, y * this.w + this.bx1 + 1);
      }
    }
    this.bx0 = this.w;
    this.by0 = this.h;
    this.bx1 = -1;
    this.by1 = -1;
    this.sub = false;
  }

  private mark(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (this.sub) {
      this.mask[i] = 0;
      return;
    }
    this.mask[i] = 1;
    if (x < this.bx0) this.bx0 = x;
    if (x > this.bx1) this.bx1 = x;
    if (y < this.by0) this.by0 = y;
    if (y > this.by1) this.by1 = y;
  }

  /** Subsequent shapes subtract from the mask until the next fill. */
  minus(): this {
    this.sub = true;
    return this;
  }

  plus(): this {
    this.sub = false;
    return this;
  }

  dot(x: number, y: number): this {
    this.mark(Math.floor(x), Math.floor(y));
    return this;
  }

  rect(x: number, y: number, w: number, h: number): this {
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    const x1 = Math.round(x + w);
    const y1 = Math.round(y + h);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.mark(xx, yy);
    return this;
  }

  ellipse(cx: number, cy: number, rx: number, ry: number): this {
    if (rx <= 0 || ry <= 0) return this;
    const x0 = Math.floor(cx - rx - 1);
    const x1 = Math.ceil(cx + rx + 1);
    const y0 = Math.floor(cy - ry - 1);
    const y1 = Math.ceil(cy + ry + 1);
    for (let y = y0; y <= y1; y++) {
      const ny = (y + 0.5 - cy) / ry;
      for (let x = x0; x <= x1; x++) {
        const nx = (x + 0.5 - cx) / rx;
        if (nx * nx + ny * ny <= 1.0001) this.mark(x, y);
      }
    }
    return this;
  }

  circle(cx: number, cy: number, r: number): this {
    return this.ellipse(cx, cy, r, r);
  }

  /** Filled polygon from a flat [x0,y0,x1,y1,...] list (pixel-center sampling, even-odd). */
  poly(pts: readonly number[]): this {
    const n = pts.length >> 1;
    if (n < 3) return this;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const y = pts[i * 2 + 1] as number;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const xs: number[] = [];
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const sy = y + 0.5;
      xs.length = 0;
      for (let i = 0; i < n; i++) {
        const ax = pts[i * 2] as number;
        const ay = pts[i * 2 + 1] as number;
        const j = (i + 1) % n;
        const bx = pts[j * 2] as number;
        const by = pts[j * 2 + 1] as number;
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) {
          xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.ceil((xs[k] as number) - 0.5);
        const xb = Math.floor((xs[k + 1] as number) - 0.5);
        for (let x = xa; x <= xb; x++) this.mark(x, y);
      }
    }
    return this;
  }

  /** Tapered capsule between two points (radius r0 at start, r1 at end). */
  capsule(x0: number, y0: number, x1: number, y1: number, r0: number, r1 = r0): this {
    const minX = Math.floor(Math.min(x0 - r0, x1 - r1) - 1);
    const maxX = Math.ceil(Math.max(x0 + r0, x1 + r1) + 1);
    const minY = Math.floor(Math.min(y0 - r0, y1 - r1) - 1);
    const maxY = Math.ceil(Math.max(y0 + r0, y1 + r1) + 1);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const L2 = dx * dx + dy * dy || 1e-6;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5 - x0;
        const py = y + 0.5 - y0;
        let t = (px * dx + py * dy) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - dx * t;
        const ey = py - dy * t;
        const r = r0 + (r1 - r0) * t;
        if (ex * ex + ey * ey <= r * r + 0.001) this.mark(x, y);
      }
    }
    return this;
  }

  /** 1px Bresenham line into the mask. */
  line(x0: number, y0: number, x1: number, y1: number): this {
    let ax = Math.round(x0);
    let ay = Math.round(y0);
    const bx = Math.round(x1);
    const by = Math.round(y1);
    const dx = Math.abs(bx - ax);
    const dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 512; guard++) {
      this.mark(ax, ay);
      if (ax === bx && ay === by) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        ax += sx;
      }
      if (e2 <= dx) {
        err += dx;
        ay += sy;
      }
    }
    return this;
  }

  /** Is the mask set at (x,y)? */
  private m(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.mask[y * this.w + x] === 1;
  }

  /** Shade and paint the current mask, then clear it. */
  fill(ramp: Ramp, opts: FillOpts = {}): this {
    if (this.bx1 < this.bx0) {
      this.clearMask();
      return this;
    }
    const mode = opts.mode ?? 'emboss';
    const inner = opts.inner ?? true;
    const alpha = opts.alpha ?? 255;
    const bias = opts.light ?? 0;
    const n = ramp.length;
    const bx0 = this.bx0;
    const by0 = this.by0;
    const bw = this.bx1 - this.bx0 + 1;
    const bh = this.by1 - this.by0 + 1;
    const cx = opts.cx ?? bx0 + bw / 2;
    const cy = opts.cy ?? by0 + bh / 2;
    const rx = Math.max(1, bw / 2 + 0.35);
    const ry = Math.max(1, bh / 2 + 0.35);
    const facets = opts.facets ?? 6;
    const rot = opts.rot ?? 0;
    const glow = opts.glow;
    const buf = this.buf;
    const toWrite: number[] = [];
    for (let y = this.by0; y <= this.by1; y++) {
      for (let x = this.bx0; x <= this.bx1; x++) {
        if (this.mask[y * this.w + x] !== 1) continue;
        let I = 0;
        const top = !this.m(x, y - 1);
        const bot = !this.m(x, y + 1);
        const lef = !this.m(x - 1, y);
        const rig = !this.m(x + 1, y);
        if (mode === 'sphere') {
          const nx = (x + 0.5 - cx) / rx;
          const ny = (y + 0.5 - cy) / ry;
          const d2 = Math.min(1, nx * nx + ny * ny);
          const nz = Math.sqrt(1 - d2);
          I = nx * LX + ny * LY + nz * LZ;
          if (bot) I -= 0.15;
        } else if (mode === 'cyl') {
          const nx = Math.max(-1, Math.min(1, (x + 0.5 - cx) / rx));
          const nz = Math.sqrt(1 - nx * nx);
          I = nx * LX * 1.1 + nz * LZ + 0.08 - ((y - by0) / bh) * 0.35;
          if (top) I += 0.3;
          if (bot) I -= 0.3;
        } else if (mode === 'facet') {
          const a = Math.atan2(y + 0.5 - cy, x + 0.5 - cx) - rot;
          const step = (Math.PI * 2) / facets;
          const sector = Math.floor((a + Math.PI * 4) / step);
          const ca = sector * step + step / 2 + rot;
          const nx = Math.cos(ca) * 0.72;
          const ny = Math.sin(ca) * 0.72;
          I = nx * LX + ny * LY + 0.69 * LZ;
          const dd = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
          if (dd < 0.32) I += 0.32;
          if (top || lef) I += 0.25;
        } else if (mode === 'flat') {
          I = NaN;
        } else {
          const t = ((y - by0 + 0.5) / bh) * 0.72 + ((x - bx0 + 0.5) / bw) * 0.28;
          I = 0.64 - 0.78 * t;
          if (top) I += 0.5;
          else if (lef) I += 0.22;
          if (bot) I -= 0.42;
          else if (rig) I -= 0.2;
        }
        let idx: number;
        if (Number.isNaN(I)) {
          idx = Math.min(n - 1, opts.tone ?? 2);
        } else {
          I += bias;
          if (opts.dither) I += bayer(x, y) * 0.22;
          if (n >= 5 && I > 0.97) idx = 4;
          else if (I > 0.74) idx = 3;
          else if (I > 0.3) idx = 2;
          else if (I > -0.12) idx = 1;
          else idx = 0;
          if (idx >= n) idx = n - 1;
        }
        if (inner) {
          // separation line where this part overlaps something already painted (not on lit top edges)
          if (
            (bot && buf.alpha(x, y + 1) >= 128) ||
            (lef && buf.alpha(x - 1, y) >= 128) ||
            (rig && buf.alpha(x + 1, y) >= 128)
          ) {
            idx = 0;
          }
        }
        toWrite.push(x, y, ramp[idx] as number);
      }
    }
    for (let k = 0; k < toWrite.length; k += 3) {
      const x = toWrite[k] as number;
      const y = toWrite[k + 1] as number;
      const c = toWrite[k + 2] as number;
      if (alpha >= 255) buf.set(x, y, c, 255);
      else buf.blend(x, y, c, alpha);
      this.glowMap[y * this.w + x] = glow !== undefined ? (0xff000000 | glow) >>> 0 : 0;
    }
    this.clearMask();
    return this;
  }

  /** Paint a single pixel (no mask). */
  px(x: number, y: number, color: number, a = 255): this {
    x = Math.floor(x);
    y = Math.floor(y);
    if (a >= 255) this.buf.set(x, y, color);
    else this.buf.blend(x, y, color, a);
    if (this.buf.inside(x, y)) this.glowMap[y * this.w + x] = 0;
    return this;
  }

  /** Paint a glowing pixel (gets a halo in finish()). */
  gpx(x: number, y: number, color: number, halo: number): this {
    x = Math.floor(x);
    y = Math.floor(y);
    if (!this.buf.inside(x, y)) return this;
    this.buf.set(x, y, color);
    this.glowMap[y * this.w + x] = (0xff000000 | halo) >>> 0;
    return this;
  }

  /** Outline + glow halo pass. */
  finish(outline: number = OUTLINE, haloStrength = 1): this {
    outlinePass(this.buf, outline);
    const w = this.w;
    const h = this.h;
    const gm = this.glowMap;
    const buf = this.buf;
    const ring: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (gm[i] !== 0) continue;
        let hc = 0;
        if (x > 0 && gm[i - 1] !== 0) hc = gm[i - 1] as number;
        else if (x < w - 1 && gm[i + 1] !== 0) hc = gm[i + 1] as number;
        else if (y > 0 && gm[i - w] !== 0) hc = gm[i - w] as number;
        else if (y < h - 1 && gm[i + w] !== 0) hc = gm[i + w] as number;
        if (hc) ring.push(x, y, hc & 0xffffff);
      }
    }
    for (let k = 0; k < ring.length; k += 3) {
      const x = ring[k] as number;
      const y = ring[k + 1] as number;
      const hc = ring[k + 2] as number;
      const cur = buf.get(x, y);
      const a = cur >>> 24;
      if (a < 40) buf.set(x, y, hc, Math.round(150 * haloStrength));
      else if ((cur & 0xffffff) === outline) buf.set(x, y, mix(outline, hc, 0.62 * haloStrength), a);
      else buf.set(x, y, mix(cur & 0xffffff, hc, 0.4 * haloStrength), a);
    }
    // second, softer ring into empty space
    if (haloStrength > 0) {
      const marked = new Uint8Array(w * h);
      for (let k = 0; k < ring.length; k += 3) marked[(ring[k + 1] as number) * w + (ring[k] as number)] = 1;
      for (let k = 0; k < ring.length; k += 3) {
        const x = ring[k] as number;
        const y = ring[k + 1] as number;
        const hc = ring[k + 2] as number;
        const nb = [x + 1, y, x - 1, y, x, y + 1, x, y - 1];
        for (let q = 0; q < 8; q += 2) {
          const nx = nb[q] as number;
          const ny = nb[q + 1] as number;
          if (!buf.inside(nx, ny)) continue;
          const ii = ny * w + nx;
          if (marked[ii] || gm[ii] !== 0) continue;
          if (buf.alpha(nx, ny) === 0) {
            buf.set(nx, ny, hc, Math.round(60 * haloStrength));
            marked[ii] = 1;
          }
        }
      }
    }
    return this;
  }
}

/** 1px 4-neighbour outline around every solid pixel (written into transparent pixels only). */
export function outlinePass(buf: PixelBuffer, color: number = OUTLINE, solid = 100): void {
  const w = buf.w;
  const h = buf.h;
  const d = buf.data;
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if ((d[i] as number) >>> 24 >= solid) continue;
      if (
        (x > 0 && (d[i - 1] as number) >>> 24 >= solid) ||
        (x < w - 1 && (d[i + 1] as number) >>> 24 >= solid) ||
        (y > 0 && (d[i - w] as number) >>> 24 >= solid) ||
        (y < h - 1 && (d[i + w] as number) >>> 24 >= solid)
      ) {
        out.push(i);
      }
    }
  }
  const c = (0xff000000 | color) >>> 0;
  for (const i of out) d[i] = c;
}

// ---------------------------------------------------------------- frame post effects

/** Hit flash: push every non-outline pixel toward white. */
/** True for near-black outline-like colors (both the indigo enemy and the warm player outline). */
export function isOutlineColor(c: number): boolean {
  return ((c >> 16) & 255) < 0x30 && ((c >> 8) & 255) < 0x22 && (c & 255) < 0x38;
}

export function flash(buf: PixelBuffer, amt = 0.78, color = 0xffffff): void {
  const d = buf.data;
  for (let i = 0; i < d.length; i++) {
    const c = d[i] as number;
    const a = c >>> 24;
    if (!a) continue;
    if (isOutlineColor(c & 0xffffff)) continue;
    d[i] = ((a << 24) | mix(c & 0xffffff, color, amt)) >>> 0;
  }
}

export function tint(buf: PixelBuffer, color: number, amt: number): void {
  const d = buf.data;
  for (let i = 0; i < d.length; i++) {
    const c = d[i] as number;
    const a = c >>> 24;
    if (!a) continue;
    d[i] = ((a << 24) | mix(c & 0xffffff, color, amt)) >>> 0;
  }
}

export function fadeAlpha(buf: PixelBuffer, k: number): void {
  const d = buf.data;
  for (let i = 0; i < d.length; i++) {
    const c = d[i] as number;
    const a = c >>> 24;
    if (!a) continue;
    d[i] = ((Math.round(a * k) << 24) | (c & 0xffffff)) >>> 0;
  }
}

/** Afterimage: translucent tinted copies of the silhouette trailing by (dx,dy), only into empty pixels. */
export function smear(buf: PixelBuffer, dx: number, dy: number, color: number, steps = 2, a0 = 110): void {
  const src = buf.clone();
  for (let s = steps; s >= 1; s--) {
    const ox = Math.round((dx * s) / steps);
    const oy = Math.round((dy * s) / steps);
    const a = Math.round(a0 * (1 - (s - 1) / steps));
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const c = src.data[y * src.w + x] as number;
        if (c >>> 24 < 128 || isOutlineColor(c & 0xffffff)) continue;
        const tx = x + ox;
        const ty = y + oy;
        if (!buf.inside(tx, ty) || buf.alpha(tx, ty) !== 0) continue;
        buf.set(tx, ty, mix(c & 0xffffff, color, 0.75), a);
      }
    }
  }
}

/**
 * Crystal-shard dissolve: splits the source silhouette into Voronoi shards that fly apart, tint
 * toward crystal tones, shrink and fade. t in 0..1. Deterministic per seed.
 */
export interface ShatterOpts {
  /** brighten shard edges (bone/stone chips); off for wet gore */
  glint?: boolean;
  /** droplets that fly out and splat on the ground line */
  drops?: { color: number; count: number; groundY: number };
}

export function shatter(src: PixelBuffer, t: number, seed: number, shardTint: number, cells = 14, spread = 1, opts: ShatterOpts = {}): PixelBuffer {
  const out = new PixelBuffer(src.w, src.h);
  const r = rng(seed);
  // bounding box of the silhouette
  let x0 = src.w;
  let y0 = src.h;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      if (src.alpha(x, y) > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0) return out;
  const cxm = (x0 + x1) / 2;
  const cym = (y0 + y1) / 2;
  const sx: number[] = [];
  const sy: number[] = [];
  const vx: number[] = [];
  const vy: number[] = [];
  const life: number[] = [];
  for (let k = 0; k < cells; k++) {
    const px = x0 + r() * (x1 - x0 + 1);
    const py = y0 + r() * (y1 - y0 + 1);
    sx.push(px);
    sy.push(py);
    const ang = Math.atan2(py - cym, px - cxm) + (r() - 0.5) * 0.8;
    const sp = (4 + r() * 8) * spread;
    vx.push(Math.cos(ang) * sp);
    vy.push(Math.sin(ang) * sp * 0.6 - (3 + r() * 5) * spread);
    life.push(0.55 + r() * 0.45);
  }
  const size = Math.max(x1 - x0, y1 - y0) / Math.sqrt(cells);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const c = src.get(x, y);
      const a = c >>> 24;
      if (!a) continue;
      let best = 0;
      let bd = Infinity;
      let second = Infinity;
      for (let k = 0; k < cells; k++) {
        const dx = x - (sx[k] as number);
        const dy = y - (sy[k] as number);
        const dd = dx * dx + dy * dy;
        if (dd < bd) {
          second = bd;
          bd = dd;
          best = k;
        } else if (dd < second) {
          second = dd;
        }
      }
      const L = life[best] as number;
      const lt = t / L;
      if (lt >= 1) continue;
      // shrink shards from their borders
      const edge = Math.sqrt(second) - Math.sqrt(bd);
      const cut = lt < 0.04 ? 0 : 0.5 + lt * lt * size * 0.85;
      if (edge < cut) continue;
      const ox = (vx[best] as number) * t;
      const oy = (vy[best] as number) * t + 16 * spread * t * t;
      let col = mix(c & 0xffffff, shardTint, Math.min(1, 0.15 + lt * 0.85));
      if (opts.glint !== false && edge < cut + 1.1) col = lighten(col, 0.45);
      const na = Math.round(a * (lt > 0.6 ? 1 - (lt - 0.6) / 0.4 : 1));
      out.blend(Math.round(x + ox), Math.round(y + oy), col, na);
    }
  }
  if (opts.drops) {
    const { color, count, groundY } = opts.drops;
    const dr = rng(seed ^ 0x9e37);
    for (let k = 0; k < count; k++) {
      const ang = -Math.PI * (0.1 + dr() * 0.8);
      const sp = (8 + dr() * 14) * spread;
      const px0 = cxm + (dr() - 0.5) * (x1 - x0) * 0.5;
      const py0 = cym + (dr() - 0.5) * (y1 - y0) * 0.4;
      const tt = Math.min(1, t * 1.15);
      const x = px0 + Math.cos(ang) * sp * tt * (dr() > 0.5 ? 1 : -1);
      let y = py0 + Math.sin(ang) * sp * tt + 40 * spread * tt * tt;
      const landed = y >= groundY - dr() * 3;
      if (landed) y = groundY - dr() * 3;
      const c = landed ? mix(color, 0x000000, 0.25) : color;
      out.blend(Math.round(x), Math.round(y), c, 255);
      if (landed) {
        out.blend(Math.round(x) + 1, Math.round(y), c, 220);
        if (k % 3 === 0) out.blend(Math.round(x) - 1, Math.round(y), c, 200);
      } else if (k % 2 === 0) {
        out.blend(Math.round(x), Math.round(y) - 1, lighten(color, 0.25), 200);
      }
    }
  }
  return out;
}

/**
 * Low-light readability: brightens the top-left edge of the silhouette (pixels whose upper or left
 * neighbour is outline/empty), like a cold rim light.
 */
export function rimTopLeft(buf: PixelBuffer, amt = 0.32, color = 0xe8e0ff): void {
  const src = buf.clone();
  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      const c = src.get(x, y);
      const a = c >>> 24;
      if (a < 200 || isOutlineColor(c & 0xffffff)) continue;
      const up = src.get(x, y - 1);
      const lf = src.get(x - 1, y);
      const edgeUp = up >>> 24 < 200 || isOutlineColor(up & 0xffffff);
      const edgeLf = lf >>> 24 < 200 || isOutlineColor(lf & 0xffffff);
      if (edgeUp || edgeLf) buf.set(x, y, mix(c & 0xffffff, color, edgeUp && edgeLf ? amt * 1.3 : amt), a);
    }
  }
}

/** Stamp small 4-point sparkles (glints) into a buffer. */
export function sparkle(buf: PixelBuffer, x: number, y: number, color: number, size = 1, a = 255): void {
  buf.blend(x, y, 0xffffff, a);
  for (let s = 1; s <= size; s++) {
    const k = Math.round(a * (1 - (s - 1) / (size + 1)));
    buf.blend(x + s, y, color, k);
    buf.blend(x - s, y, color, k);
    buf.blend(x, y + s, color, k);
    buf.blend(x, y - s, color, k);
  }
}

/** A sheet of equally sized frames laid out row-major. */
export class Sheet {
  readonly frameW: number;
  readonly frameH: number;
  readonly cols: number;
  readonly rows: number;
  readonly buf: PixelBuffer;
  count = 0;

  constructor(frameW: number, frameH: number, frames: number, maxWidth = 2048) {
    this.frameW = frameW;
    this.frameH = frameH;
    this.cols = Math.max(1, Math.min(frames, Math.floor(maxWidth / frameW)));
    this.rows = Math.max(1, Math.ceil(frames / this.cols));
    this.buf = new PixelBuffer(this.cols * frameW, this.rows * frameH);
  }

  /** Append a frame; returns its index. */
  add(frame: PixelBuffer): number {
    const i = this.count++;
    const x = (i % this.cols) * this.frameW;
    const y = Math.floor(i / this.cols) * this.frameH;
    frame.copyTo(this.buf, x, y);
    return i;
  }
}

/**
 * Actor finishing pass (all heroes, creatures and bosses): a warm key rim on the top-left edge (heroes; the
 * creatures already carry a cold one), a cool bounce rim on the lower-right edge so silhouettes separate from
 * dark floors, a few specular glints on the brightest low-saturation (metal / bone) pixels, and a little contact
 * occlusion just above the feet. Outline pixels and translucent pixels are left alone.
 */
export function polishActor(buf: PixelBuffer, opts: { hero: boolean; groundY: number }): void {
  const w = buf.w, h = buf.h;
  const src = buf.data.slice();
  const n = src.length;
  // classify once: solid (opaque, not outline) + luminance byte
  const solid = new Uint8Array(n);
  const lum = new Uint8Array(n);
  const hist = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const c = src[i]!;
    if (c >>> 24 < 200) continue;
    const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    if (r < 0x30 && g < 0x22 && b < 0x38) continue;
    solid[i] = 1;
    const l = (r * 77 + g * 141 + b * 38) >> 8;
    lum[i] = l;
    hist[l]++;
    count++;
  }
  if (!count) return;
  // brightest 2.5% of the solid pixels: specular candidates
  let acc = 0, cut = 255;
  const want = Math.max(1, Math.floor(count * 0.025));
  for (; cut > 0; cut--) {
    acc += hist[cut]!;
    if (acc >= want) break;
  }
  const hiCut = Math.max(158, cut);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!solid[i]) continue;
      const c = src[i]!;
      const up = y > 0 && solid[i - w] === 1, lf = x > 0 && solid[i - 1] === 1;
      const rt = x < w - 1 && solid[i + 1] === 1, dn = y < h - 1 && solid[i + w] === 1;
      let col = c & 0xffffff;
      if (opts.hero && (!up || !lf)) col = mix(col, 0xffe8c8, !up && !lf ? 0.26 : 0.18);
      else if (!rt || !dn) col = mix(col, 0x4a64a0, !rt && !dn ? 0.2 : 0.13);
      const l = lum[i]!;
      if (l >= hiCut && (y === 0 || lum[i - w]! < l)) {
        const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
        const mx = Math.max(r, g, b);
        if (mx && (mx - Math.min(r, g, b)) / mx < 0.35) col = mix(col, 0xffffff, 0.35);
      }
      const dy = opts.groundY - y;
      if (dy >= 0 && dy < 3) col = mix(col, 0x0a0608, 0.16 - dy * 0.05);
      buf.data[i] = ((c & 0xff000000) | col) >>> 0;
    }
  }
}
