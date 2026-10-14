// Burning-title renderer (pure buffer code): takes a 1-bit glyph mask and produces a molten-metal lettering with a
// hard black outline, a dithered ember halo and classic "Doom fire" flames licking up from the letters, all at
// native pixel scale. The DOM component (FireTitle) supplies the mask from a pixel font and blits the result.

import { dither, type RGB } from './pixelSkin';

export type FirePaletteId = 'ember' | 'blood' | 'arcane';
export type MetalId = 'bronze' | 'bone' | 'blood';

const FIRE: Record<FirePaletteId, RGB[]> = {
  ember: [0x2a0503, 0x4a0805, 0x701008, 0x9c1a0a, 0xc8340c, 0xe85e12, 0xf6901e, 0xffbe3a, 0xffe07a, 0xfff6c8],
  blood: [0x1c0204, 0x360408, 0x56070e, 0x7a0b14, 0xa0121c, 0xc81e24, 0xe83a2e, 0xff6a48, 0xff9c78, 0xffd2b8],
  arcane: [0x0e0620, 0x1c0b3c, 0x2c1260, 0x40208a, 0x5a32b8, 0x7646e0, 0x8e6af6, 0xa894ff, 0xccc0ff, 0xf0ecff],
};
const METAL: Record<MetalId, { hi: RGB; top: RGB[]; low: RGB[]; shade: RGB }> = {
  bronze: { hi: 0xfff1c2, top: [0xf0cf78, 0xd29d3e, 0xa46f24], low: [0x764916, 0xa46f24, 0xd29d3e], shade: 0x2a1606 },
  bone: { hi: 0xffffff, top: [0xfffaee, 0xebe0c8, 0xc6b698], low: [0x998a71, 0xc6b698, 0xebe0c8], shade: 0x3a3226 },
  blood: { hi: 0xffb8a0, top: [0xff8a6a, 0xdc3f3b, 0xac1d29], low: [0x4a0910, 0x78101a, 0xac1d29], shade: 0x160204 },
};

export class FireTitleSim {
  readonly fire: Uint8Array;
  private readonly stat: Int32Array; // packed static colour per pixel (-1 none), alpha in top byte
  private readonly maxI: number;
  private readonly decay: number;
  private seed = 1;
  private readonly cols: Float32Array;
  private readonly firePal: RGB[];

  constructor(readonly mask: Uint8Array, readonly w: number, readonly h: number, readonly glyphTop: number, readonly glyphH: number, fireH: number, firePal: FirePaletteId, metal: MetalId) {
    this.fire = new Uint8Array(w * h);
    this.stat = new Int32Array(w * h).fill(-1);
    this.firePal = FIRE[firePal];
    this.maxI = 36;
    this.decay = this.maxI / Math.max(6, fireH * 0.78);
    this.cols = new Float32Array(w).map(() => Math.random());
    const m = METAL[metal];
    // distance from glyph (0 inside, up to 4)
    const dist = new Uint8Array(w * h).fill(9);
    const q: number[] = [];
    for (let i = 0; i < w * h; i++) if (mask[i]) { dist[i] = 0; q.push(i); }
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], x = i % w, y = (i / w) | 0, nd = dist[i] + 1;
      if (nd > 4) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (dist[j] > nd) { dist[j] = nd; q.push(j); }
      }
    }
    const pack = (c: RGB, a = 255) => ((a & 255) << 24) | c;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i]) {
        const v = (y - glyphTop) / Math.max(1, glyphH);
        const above = y > 0 && mask[i - w], below = y < h - 1 && mask[i + w], left = x > 0 && mask[i - 1];
        let c: RGB;
        if (!above) c = m.hi;
        else if (!below) c = m.shade;
        else if (v < 0.52) c = rampD(m.top, v / 0.52, x, y);
        else c = rampD(m.low, (v - 0.52) / 0.48, x, y);
        if (above && !left && v < 0.52) c = m.top[0];
        this.stat[i] = pack(c);
      } else if (dist[i] === 1) this.stat[i] = pack(0x050303);
      else if (dist[i] === 2) this.stat[i] = pack(firePal === 'arcane' ? 0x1a0a36 : 0x2c0405);
      else if (dist[i] <= 4 && dither(x, y, dist[i] === 3 ? 0.5 : 0.22)) this.stat[i] = pack(firePal === 'arcane' ? 0x140826 : 0x240304, 190);
    }
  }

  private rnd() { this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff; return this.seed / 0x7fffffff; }

  step() {
    const { w, h, fire, mask, maxI } = this;
    // per-column heat random walk -> distinct tongues of flame with gaps
    for (let x = 0; x < w; x++) this.cols[x] = Math.max(0, Math.min(1, this.cols[x] + (this.rnd() - 0.5) * 0.35));
    for (let x = 1; x < w - 1; x++) this.cols[x] = (this.cols[x - 1] + this.cols[x] * 2 + this.cols[x + 1]) / 4;
    for (let i = 0; i < w * h; i++) if (mask[i]) fire[i] = Math.floor(maxI * (0.5 + this.cols[i % w] * 0.44 + this.rnd() * 0.06));
    for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) {
      const src = y * w + x, p = fire[src];
      if (mask[src - w]) continue;
      if (p === 0) { fire[src - w] = 0; continue; }
      const off = Math.floor(this.rnd() * 3) - 1;
      const xx = Math.max(0, Math.min(w - 1, x + off));
      const dec = Math.floor(this.rnd() * this.decay * 2 + 0.5);
      fire[(y - 1) * w + xx] = Math.max(0, p - dec);
    }
  }

  render(out: Uint8ClampedArray) {
    const { w, h, fire, stat, maxI, firePal } = this;
    for (let i = 0; i < w * h; i++) {
      const o = i * 4, s = stat[i];
      const a = s === -1 ? 0 : (s >>> 24) & 255;
      if (a === 255) { out[o] = (s >> 16) & 255; out[o + 1] = (s >> 8) & 255; out[o + 2] = s & 255; out[o + 3] = 255; continue; }
      const f = fire[i];
      if (f > 1) {
        const idx = Math.min(firePal.length - 1, Math.floor((f / maxI) * firePal.length));
        const c = firePal[idx];
        out[o] = (c >> 16) & 255; out[o + 1] = (c >> 8) & 255; out[o + 2] = c & 255; out[o + 3] = idx < 1 ? 110 : idx < 2 ? 180 : 255;
        continue;
      }
      if (a) { out[o] = (s >> 16) & 255; out[o + 1] = (s >> 8) & 255; out[o + 2] = s & 255; out[o + 3] = a; continue; }
      out[o + 3] = 0;
    }
  }
}

function rampD(cols: RGB[], t: number, x: number, y: number) {
  const f = Math.max(0, Math.min(1, t)) * (cols.length - 1), i = Math.floor(f);
  if (i >= cols.length - 1) return cols[cols.length - 1];
  return dither(x, y, f - i) ? cols[i + 1] : cols[i];
}
