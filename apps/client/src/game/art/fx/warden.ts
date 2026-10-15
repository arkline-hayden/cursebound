import { line, type FxSpec } from '../fxPrims';
import { outlinePass, rng, sparkle, type PixelBuffer } from '../draw/pixel';

// Warden effect sheets: thorn shards, a living totem, erupting roots and thorns, brambles, the Ironthorn pod and the
// spectral wolf / bear spirits. Framework-free pixel art; keys use the fx:warden:* prefix. Projectiles point east.

const OUT = 0x0e140a;
const BARK: readonly number[] = [0x24170c, 0x4a2e16, 0x6a4a2a, 0x9a7244, 0xc8a066];
const MOSS: readonly number[] = [0x14280c, 0x2a4a14, 0x3f7a26, 0x6aa83e, 0xa8e070];
const SPIRIT: readonly number[] = [0x0e4a3e, 0x1f8a6a, 0x4ad8a8, 0x9affd8, 0xeafff6];

function tri(b: PixelBuffer, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, col: number, a = 255): void {
  const x0 = Math.floor(Math.min(ax, bx, cx)), x1 = Math.ceil(Math.max(ax, bx, cx));
  const y0 = Math.floor(Math.min(ay, by, cy)), y1 = Math.ceil(Math.max(ay, by, cy));
  const s = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const d1 = s(px, py, ax, ay, bx, by), d2 = s(px, py, bx, by, cx, cy), d3 = s(px, py, cx, cy, ax, ay);
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) b.blend(x, y, col, a);
    }
}

function ellipse(b: PixelBuffer, cx: number, cy: number, rx: number, ry: number, col: number, a = 255): void {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++)
      if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) b.blend(x, y, col, a);
}

/** Shape mask built from ellipses and triangles, then shaded in hard bands (rim dark, top-left light). */
class Mask {
  readonly m: Uint8Array;
  constructor(readonly b: PixelBuffer) { this.m = new Uint8Array(b.w * b.h); }
  private set(x: number, y: number) { if (x >= 0 && y >= 0 && x < this.b.w && y < this.b.h) this.m[y * this.b.w + x] = 1; }
  has(x: number, y: number) { return x >= 0 && y >= 0 && x < this.b.w && y < this.b.h && this.m[y * this.b.w + x] === 1; }
  ell(cx: number, cy: number, rx: number, ry: number) {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++)
        if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) this.set(x, y);
    return this;
  }
  tri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
    const tmp = { blend: (x: number, y: number) => this.set(x, y) } as unknown as PixelBuffer;
    tri(tmp, ax, ay, bx, by, cx, cy, 0);
    return this;
  }
  /** ramp: [rim, dark, mid, light, highlight]; light comes from (lx, ly) in mask space. */
  shade(ramp: readonly number[], lx: number, ly: number, alpha = 255, span = 18) {
    const { b } = this;
    for (let y = 0; y < b.h; y++)
      for (let x = 0; x < b.w; x++) {
        if (!this.has(x, y)) continue;
        const rim = !this.has(x - 1, y) || !this.has(x + 1, y) || !this.has(x, y - 1) || !this.has(x, y + 1);
        if (rim) { b.blend(x, y, ramp[0]!, alpha); continue; }
        const d = Math.hypot(x + 0.5 - lx, y + 0.5 - ly) / span;
        const c = d < 0.25 ? ramp[4]! : d < 0.55 ? ramp[3]! : d < 0.85 ? ramp[2]! : ramp[1]!;
        b.blend(x, y, c, alpha);
      }
  }
}

// ---------------------------------------------------------------- thorn shard (14x7)

function thorn(b: PixelBuffer): void {
  tri(b, 1, 1.2, 13.5, 3.5, 1, 5.8, BARK[2]!);
  tri(b, 2, 2, 13, 3.5, 2, 3.5, BARK[4]!);
  line(b, 9, 3, 13, 3, 0xfff0c8, 255, 0);
  b.blend(13, 3, 0xffffff, 255);
  // leaf tucked at the back
  ellipse(b, 2.5, 1.5, 2.2, 1.2, MOSS[3]!);
  b.blend(2, 1, MOSS[4]!, 255);
  outlinePass(b, OUT, 160);
}

// ---------------------------------------------------------------- spear thrust streak (44x14, tintable)

function thrust(b: PixelBuffer, i: number, n: number): void {
  const head = 16 + i * 8;
  const tail = Math.max(0, head - 26);
  const fade = i === n - 1 ? 0.5 : 1;
  for (let x = tail; x <= head; x++) {
    const t = (x - tail) / Math.max(1, head - tail);
    const w = t * 2.6;
    for (let dy = -Math.ceil(w); dy <= Math.ceil(w); dy++) {
      if (Math.abs(dy) > w) continue;
      const core = Math.abs(dy) < w * 0.4;
      b.blend(x, 7 + dy, core ? 0xffffff : 0xb8b8b8, Math.round((core ? 255 : 150) * fade * (0.35 + 0.65 * t)));
    }
  }
  // the leaf-blade tip flash
  tri(b, head, 3.5, head + 5, 7, head, 10.5, 0xffffff, Math.round(230 * fade));
  if (i <= 1) sparkle(b, head + 2, 7, 0xffffff, 2, 255);
}

// ---------------------------------------------------------------- living totem (28x58)

function totem(b: PixelBuffer, i: number, n: number): void {
  const pulse = 0.5 + 0.5 * Math.sin((i / n) * Math.PI * 2);
  // splayed roots at the base
  for (const [x0, x1] of [[13, 4], [14, 23], [12, 8], [15, 20]] as const) line(b, x0, 52, x1, 56, BARK[1]!, 255, 1);
  // carved pole
  for (let y = 18; y <= 54; y++)
    for (let x = 9; x <= 18; x++) {
      const e = x === 9 || x === 18;
      const t = (x - 9) / 9;
      b.blend(x, y, e ? BARK[0]! : t < 0.25 ? BARK[3]! : t < 0.6 ? BARK[2]! : BARK[1]!, 255);
    }
  for (let y = 20; y < 54; y += 3) b.blend(11, y, BARK[4]!, 255);
  // carved face: brow, glowing eyes, open mouth
  line(b, 10, 25, 17, 25, BARK[0]!, 255, 0);
  const eye = pulse > 0.5 ? SPIRIT[4]! : SPIRIT[3]!;
  for (const ex of [11, 15]) {
    b.blend(ex, 27, eye, 255); b.blend(ex + 1, 27, eye, 255); b.blend(ex, 28, SPIRIT[2]!, 255); b.blend(ex + 1, 28, SPIRIT[2]!, 255);
  }
  ellipse(b, 13.5, 32, 2, 1.6, BARK[0]!);
  b.blend(13, 32, SPIRIT[1]!, Math.round(120 + 135 * pulse));
  // rune bands that glow in turn
  for (let r = 0; r < 3; r++) {
    const y = 38 + r * 5;
    const lit = (i + r) % n === 0;
    line(b, 10, y, 17, y, lit ? SPIRIT[3]! : BARK[0]!, 255, 0);
    if (lit) { b.blend(13, y - 1, SPIRIT[4]!, 255); b.blend(14, y + 1, SPIRIT[2]!, 255); }
  }
  // leafy crown with a pink bloom
  const crown: [number, number, number, number][] = [[13.5, 12, 10.5, 0], [8, 12, 5.5, 1], [19, 11, 6, 1], [11, 7, 5.5, 2], [17, 6, 5, 2], [13.5, 4, 4, 3]];
  for (const [cx, cy, r, k] of crown) ellipse(b, cx, cy, r, r * 0.8, MOSS[Math.min(4, k + 1)]!);
  for (const [cx, cy] of [[7, 9], [20, 8], [10, 4], [18, 3], [15, 9]] as const) b.blend(cx, cy, MOSS[4]!, 255);
  ellipse(b, 14, 5, 2.6, 2.2, 0xff8ac8);
  ellipse(b, 13.5, 4.5, 1.4, 1.2, 0xffd0ea);
  b.blend(14, 5, 0xffffff, 255);
  // hanging vines
  for (const [x, len] of [[5, 9], [22, 7], [9, 5]] as const) {
    line(b, x, 13, x + (x < 13 ? -1 : 1), 13 + len, MOSS[2]!, 255, 0);
    b.blend(x + (x < 13 ? -1 : 1), 13 + len, MOSS[4]!, 255);
  }
  outlinePass(b, OUT, 170);
  // spirit glow halo around the eyes on the bright frames
  if (pulse > 0.6) { sparkle(b, 11, 27, SPIRIT[3]!, 1, 200); sparkle(b, 16, 27, SPIRIT[3]!, 1, 200); }
}

// ---------------------------------------------------------------- erupting root spike (18x30)

function rootSpike(b: PixelBuffer, i: number): void {
  const H = [5, 13, 22, 27, 25, 25][i]!;
  const base = 28, cx = 9;
  const r = rng(11 + i);
  // dirt clods kicked up by the eruption
  if (i <= 2) for (let k = 0; k < 5 + i * 2; k++) b.blend(Math.round(cx + (r() - 0.5) * 16), Math.round(base - r() * (6 + i * 5)), r() < 0.5 ? 0x4a3a28 : 0x6a5238, 255);
  ellipse(b, cx, base, 6, 1.6, 0x2a2014);
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const w = 3.6 * (1 - t) + 0.4;
    const bend = Math.sin(t * 2.2) * 1.4;
    for (let x = Math.floor(cx - w + bend); x <= Math.ceil(cx + w + bend); x++) {
      const u = (x + 0.5 - (cx - w + bend)) / (2 * w);
      if (u < 0 || u > 1) continue;
      const c = u < 0.18 ? BARK[0]! : u < 0.45 ? (y % 5 === 2 ? BARK[4]! : BARK[3]!) : u < 0.8 ? BARK[2]! : BARK[1]!;
      b.blend(x, base - y, t > 0.86 ? 0xe8d8a8 : c, 255);
    }
  }
  // moss collar and a side twig with a leaf
  if (H > 10) {
    for (let x = cx - 3; x <= cx + 3; x++) b.blend(x, base - 2, MOSS[3]!, 255);
    line(b, cx + 2, base - H * 0.45, cx + 6, base - H * 0.6, BARK[2]!, 255, 0);
    ellipse(b, cx + 6.5, base - H * 0.62, 1.6, 1, MOSS[4]!);
  }
  outlinePass(b, OUT, 170);
}

// ---------------------------------------------------------------- erupting thorn spike (14x24, pale: tints well)

function thornSpike(b: PixelBuffer, i: number): void {
  const H = [4, 10, 17, 21, 19, 19][i]!;
  const base = 22, cx = 7;
  ellipse(b, cx, base, 4.5, 1.3, 0x3a3020, 220);
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const w = 2.4 * (1 - t) + 0.3;
    const bend = t * t * 2.2;
    for (let x = Math.floor(cx - w + bend); x <= Math.ceil(cx + w + bend); x++) {
      const u = (x + 0.5 - (cx - w + bend)) / (2 * w);
      if (u < 0 || u > 1) continue;
      b.blend(x, base - y, u < 0.35 ? 0xfff4d8 : u < 0.7 ? 0xd8c890 : 0x8a7a50, 255);
    }
  }
  if (H > 8) { b.blend(cx - 2, base - Math.round(H * 0.4), 0xfff4d8, 255); b.blend(cx - 3, base - Math.round(H * 0.4) - 1, 0xd8c890, 255); }
  if (i === 3) sparkle(b, Math.round(cx + 2), base - H, 0xffffff, 1, 255);
  outlinePass(b, 0x1a1408, 160);
}

// ---------------------------------------------------------------- bramble clump (22x18)

function bramble(b: PixelBuffer, i: number): void {
  const r = rng(77 + i * 13);
  const vines: [number, number, number, number][] = [];
  for (let k = 0; k < 5; k++) vines.push([1 + r() * 6, 8 + r() * 9, 14 + r() * 7, 2 + r() * 12]);
  for (const [x0, y0, x1, y1] of vines) {
    line(b, x0, y0, x1, y1, MOSS[1]!, 255, 1);
    line(b, x0, y0 - 0.5, x1, y1 - 0.5, MOSS[2]!, 255, 0);
    // thorns along the vine
    for (let t = 0.15; t < 1; t += 0.22) {
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      const s = r() < 0.5 ? -1 : 1;
      b.blend(Math.round(x), Math.round(y + s * 2), 0xf0e2b0, 255);
      b.blend(Math.round(x + 0.5), Math.round(y + s * 1.2), 0xb0a070, 255);
    }
  }
  for (let k = 0; k < 3; k++) {
    const x = 4 + r() * 14, y = 4 + r() * 10;
    ellipse(b, x, y, 1.8, 1.1, MOSS[3]!);
    b.blend(Math.round(x - 1), Math.round(y - 1), MOSS[4]!, 255);
  }
  for (let k = 0; k < 2; k++) { const x = Math.round(5 + r() * 12), y = Math.round(5 + r() * 9); b.blend(x, y, 0xd8304a, 255); b.blend(x, y - 1, 0xff8aa0, 255); }
  outlinePass(b, OUT, 170);
}

// ---------------------------------------------------------------- Ironthorn pod (18x18)

function pod(b: PixelBuffer, i: number): void {
  const cx = 9, cy = 9.5;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    tri(b, cx + Math.cos(a + 0.35) * 4.5, cy + Math.sin(a + 0.35) * 4.5, cx + Math.cos(a - 0.35) * 4.5, cy + Math.sin(a - 0.35) * 4.5,
      cx + Math.cos(a) * 8.6, cy + Math.sin(a) * 8.6, k % 2 ? 0xd8c890 : 0xfff0c8);
  }
  const m = new Mask(b).ell(cx, cy, 5.4, 5.6);
  m.shade([0x1a2a0a, 0x2a4a14, 0x4a7a1e, 0x7ab83a, 0xc8f070], cx - 2, cy - 2.5, 255, 7);
  // glowing venom seams, pulsing
  const g = [0x9ef04a, 0xd8ff8a, 0xffffff][i]!;
  line(b, cx - 3, cy, cx + 3, cy, g, 255, 0);
  line(b, cx, cy - 3, cx, cy + 3, g, 220, 0);
  if (i === 2) sparkle(b, cx, cy, 0xd8ff8a, 2, 255);
  outlinePass(b, OUT, 170);
}

// ---------------------------------------------------------------- spirit wolf head (32x28) and bear head (48x42)

function wolfSpirit(b: PixelBuffer): void {
  const m = new Mask(b)
    .ell(16, 14, 8.5, 7.5)
    .tri(7.5, 10, 10.5, 0.5, 14, 8).tri(18, 8, 21.5, 0.5, 24.5, 10)
    .ell(16, 21, 4.4, 4.6)
    .tri(8, 12, 2.5, 21, 11, 19).tri(24, 12, 29.5, 21, 21, 19);
  m.shade([SPIRIT[0]!, SPIRIT[1]!, SPIRIT[2]!, SPIRIT[3]!, SPIRIT[4]!], 12, 6, 235, 20);
  // inner ears, slanted glowing eyes, muzzle
  tri(b, 9.5, 8, 10.8, 3, 12.5, 8, SPIRIT[1]!); tri(b, 19.5, 8, 21.2, 3, 22.5, 8, SPIRIT[1]!);
  for (const [x0, s] of [[11, 1], [19, -1]] as const) {
    ellipse(b, x0 + 1.5, 13.5, 2.6, 1.6, SPIRIT[0]!);
    line(b, x0, 13 + (s > 0 ? 1 : 0), x0 + 3, 13 + (s > 0 ? 0 : 1), 0xffffff, 255, 0);
  }
  line(b, 16, 15, 16, 21, SPIRIT[4]!, 200, 0);
  ellipse(b, 16, 23, 1.6, 1.1, SPIRIT[0]!);
  line(b, 14, 25, 18, 25, SPIRIT[1]!, 255, 0);
  sparkle(b, 12, 13, 0xffffff, 1, 200); sparkle(b, 20, 13, 0xffffff, 1, 200);
}

function bearSpirit(b: PixelBuffer): void {
  const m = new Mask(b)
    .ell(24, 20, 15, 13)
    .ell(11, 8, 5.5, 5.5).ell(37, 8, 5.5, 5.5)
    .ell(24, 31, 9, 8);
  m.shade([SPIRIT[0]!, SPIRIT[1]!, SPIRIT[2]!, SPIRIT[3]!, SPIRIT[4]!], 17, 9, 235, 30);
  ellipse(b, 11, 8.5, 2.6, 2.6, SPIRIT[1]!); ellipse(b, 37, 8.5, 2.6, 2.6, SPIRIT[1]!);
  // heavy brow and burning eyes
  line(b, 14, 15, 21, 17, SPIRIT[0]!, 255, 0); line(b, 34, 15, 27, 17, SPIRIT[0]!, 255, 0);
  for (const ex of [17, 29]) { ellipse(b, ex + 0.5, 19.5, 3.2, 2.2, SPIRIT[0]!); ellipse(b, ex + 0.5, 19.5, 1.8, 1.1, 0xffffff); }
  // roaring maw with fangs
  ellipse(b, 24, 34, 6, 4.2, SPIRIT[0]!);
  ellipse(b, 24, 35, 4.2, 2.6, 0x062a22);
  for (const fx of [20, 27]) { tri(b, fx, 30.5, fx + 2, 30.5, fx + 1, 34, 0xffffff); tri(b, fx, 38.5, fx + 2, 38.5, fx + 1, 35.5, 0xeafff6); }
  ellipse(b, 24, 27, 3, 2, SPIRIT[0]!);
  b.blend(23, 26, SPIRIT[3]!, 255);
}

export const SPECS: FxSpec[] = [
  { key: 'fx:warden:thorn', w: 14, h: 7, frames: 1, durations: [100], loop: false, anim: false, draw: thorn },
  { key: 'fx:warden:thrust', w: 44, h: 14, frames: 4, durations: [28, 32, 40, 60], loop: false, draw: thrust },
  { key: 'fx:warden:totem', w: 28, h: 58, frames: 6, durations: [140, 140, 140, 140, 140, 140], loop: true, draw: totem },
  { key: 'fx:warden:rootspike', w: 18, h: 30, frames: 6, durations: [30, 30, 40, 60, 90, 400], loop: false, draw: rootSpike },
  { key: 'fx:warden:thornspike', w: 14, h: 24, frames: 6, durations: [25, 25, 35, 60, 80, 260], loop: false, draw: thornSpike },
  { key: 'fx:warden:bramble', w: 22, h: 18, frames: 3, durations: [100, 100, 100], loop: false, anim: false, draw: bramble },
  { key: 'fx:warden:pod', w: 18, h: 18, frames: 3, durations: [120, 90, 70], loop: true, draw: pod },
  { key: 'fx:warden:wolfspirit', w: 32, h: 28, frames: 1, durations: [100], loop: false, anim: false, draw: wolfSpirit },
  { key: 'fx:warden:bearspirit', w: 48, h: 42, frames: 1, durations: [100], loop: false, anim: false, draw: bearSpirit },
];

