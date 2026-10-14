// Procedural gothic pixel-art UI skin (Diablo-era chrome). Every frame, plaque, button, socket, medallion, bar,
// corner ornament, scrollbar and cursor is drawn pixel by pixel at 1x into a plain RGBA buffer, then exposed as CSS
// custom properties (data URLs). CSS renders them as 9-slice border-images with image-rendering: pixelated at an
// integer scale, so the DOM interface reads as hand-made game chrome while staying semantic, focusable HTML
// (REQ ACCESS01). The drawing code is environment-agnostic (no DOM until `url()`), so it can be previewed offline.

export type RGB = number;

export const PAL = {
  K: 0x050404, ink: 0x0b0807, W: 0xffffff,
  // blackened iron (cool)
  fe0: 0x0f0e10, fe1: 0x1a181b, fe2: 0x282528, fe3: 0x3b3638, fe4: 0x585151, fe5: 0x7d746d,
  // dark carved stone (warm)
  st0: 0x0d0a09, st1: 0x161210, st2: 0x201a16, st3: 0x2c241e, st4: 0x3b3028, st5: 0x504236,
  // weathered bronze / gold
  br0: 0x2a1606, br1: 0x4c2c0c, br2: 0x764916, br3: 0xa46f24, br4: 0xd29d3e, br5: 0xf0cf78, br6: 0xfff1c2,
  pt1: 0x2e4a3e, pt2: 0x4a7560,
  // blood
  bl0: 0x260407, bl1: 0x4a0910, bl2: 0x78101a, bl3: 0xac1d29, bl4: 0xdc3f3b, bl5: 0xff8a6a,
  // ember
  em0: 0x381904, em1: 0x763808, em2: 0xbc600e, em3: 0xec941e, em4: 0xffc94a, em5: 0xfff0a6,
  // arcane violet
  vi0: 0x140a24, vi1: 0x2a144c, vi2: 0x482482, vi3: 0x7042c0, vi4: 0xa682ee, vi5: 0xdacaff,
  // mana blue
  mb0: 0x050a28, mb1: 0x0c1a5c, mb2: 0x1a34a4, mb3: 0x3a62e4, mb4: 0x84a6ff, mb5: 0xcedcff,
  // bone
  bo0: 0x6c604f, bo1: 0x998a71, bo2: 0xc6b698, bo3: 0xebe0c8, bo4: 0xfffaee,
};
const P = PAL;

// ---------------------------------------------------------------------------------------------------------------
// pixel buffer
// ---------------------------------------------------------------------------------------------------------------

export class Px {
  readonly d: Uint8ClampedArray;
  constructor(readonly w: number, readonly h: number) { this.d = new Uint8ClampedArray(w * h * 4); }
  inb(x: number, y: number) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  p(x: number, y: number, col: RGB, a = 1): void {
    x = Math.floor(x); y = Math.floor(y);
    if (!this.inb(x, y) || a <= 0) return;
    const i = (y * this.w + x) * 4, d = this.d;
    const r = (col >> 16) & 255, g = (col >> 8) & 255, b = col & 255;
    if (a >= 1) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; return; }
    const da = d[i + 3] / 255, oa = a + da * (1 - a);
    d[i] = (r * a + d[i] * da * (1 - a)) / oa;
    d[i + 1] = (g * a + d[i + 1] * da * (1 - a)) / oa;
    d[i + 2] = (b * a + d[i + 2] * da * (1 - a)) / oa;
    d[i + 3] = oa * 255;
  }
  /** alpha 0..255 */
  al(x: number, y: number) { return this.inb(x, y) ? this.d[(y * this.w + x) * 4 + 3] : 0; }
  col(x: number, y: number): RGB { const i = (y * this.w + x) * 4; return (this.d[i] << 16) | (this.d[i + 1] << 8) | this.d[i + 2]; }
  clear(x: number, y: number) { if (this.inb(x, y)) this.d.fill(0, (y * this.w + x) * 4, (y * this.w + x) * 4 + 4); }
  rect(x: number, y: number, w: number, h: number, col: RGB, a = 1) { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.p(xx, yy, col, a); }
  line(x0: number, y0: number, x1: number, y1: number, col: RGB, a = 1) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.p(x0, y0, col, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  disc(cx: number, cy: number, r: number, col: RGB, a = 1) {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.p(x, y, col, a);
    }
  }
  blit(src: Px, dx: number, dy: number, fx = false, fy = false) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const sxx = fx ? src.w - 1 - x : x, syy = fy ? src.h - 1 - y : y;
      const a = src.al(sxx, syy);
      if (a) this.p(dx + x, dy + y, src.col(sxx, syy), a / 255);
    }
  }
  flip(fx: boolean, fy: boolean) { const o = new Px(this.w, this.h); o.blit(this, 0, 0, fx, fy); return o; }
  /** Adds a 1px outline (4-neighbour, optionally 8) around opaque pixels into transparent ones. */
  outline(col: RGB, diag = false, a = 1) {
    const mask = new Uint8Array(this.w * this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) mask[y * this.w + x] = this.al(x, y) > 0 ? 1 : 0;
    const nb = diag ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (mask[y * this.w + x]) continue;
      for (const [ox, oy] of nb) {
        const xx = x + ox, yy = y + oy;
        if (xx >= 0 && yy >= 0 && xx < this.w && yy < this.h && mask[yy * this.w + xx]) { this.p(x, y, col, a); break; }
      }
    }
    return this;
  }
  toCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(this.d), this.w, this.h), 0, 0);
    return c;
  }
  url(scale = 1) {
    let c = this.toCanvas();
    if (scale > 1) {
      const u = document.createElement('canvas');
      u.width = this.w * scale; u.height = this.h * scale;
      const g = u.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      g.drawImage(c, 0, 0, u.width, u.height);
      c = u;
    }
    return `url(${c.toDataURL('image/png')})`;
  }
}

const bayer4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const dither = (x: number, y: number, t: number) => (bayer4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 < t;
export function hash(x: number, y: number, s = 1) {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) / 4294967296;
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Pick from a ramp with ordered dithering between neighbouring shades. */
export function ramp(cols: readonly RGB[], t: number, x: number, y: number): RGB {
  const f = clamp01(t) * (cols.length - 1);
  const i = Math.floor(f);
  if (i >= cols.length - 1) return cols[cols.length - 1];
  return dither(x, y, f - i) ? cols[i + 1] : cols[i];
}

/** Pixel map from strings. Legend chars map to colours; '.' / ' ' transparent. */
export function fromMap(rows: string[], legend: Record<string, RGB>): Px {
  const px = new Px(Math.max(...rows.map((r) => r.length)), rows.length);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { const c = legend[ch]; if (c !== undefined) px.p(x, y, c); }));
  return px;
}

// ---------------------------------------------------------------------------------------------------------------
// trims (colour sets for rims, bands and gems)
// ---------------------------------------------------------------------------------------------------------------

interface Trim { r: readonly [RGB, RGB, RGB, RGB]; b: readonly [RGB, RGB, RGB, RGB]; gem: readonly [RGB, RGB, RGB] }
const T: Record<'bronze' | 'blood' | 'ember' | 'arcane' | 'gold' | 'iron', Trim> = {
  bronze: { r: [P.br1, P.br3, P.br4, P.br5], b: [P.fe1, P.fe2, P.fe3, P.fe4], gem: [P.bl2, P.bl3, P.bl5] },
  blood: { r: [P.br1, P.br3, P.br5, P.br6], b: [P.bl0, P.bl1, P.bl2, P.bl3], gem: [P.em2, P.em3, P.em5] },
  ember: { r: [P.em1, P.em2, P.em4, P.em5], b: [P.st1, P.st2, P.st3, P.st4], gem: [P.bl2, P.bl4, P.bl5] },
  arcane: { r: [P.vi1, P.vi3, P.vi4, P.vi5], b: [P.vi0, P.fe1, P.vi1, P.vi2], gem: [P.mb2, P.mb3, P.mb5] },
  gold: { r: [P.br2, P.br4, P.br5, P.br6], b: [P.br0, P.br1, P.br2, P.br3], gem: [P.bl2, P.bl4, P.bl5] },
  iron: { r: [P.fe2, P.fe4, P.fe5, P.bo1], b: [P.fe0, P.fe1, P.fe2, P.fe3], gem: [P.bl2, P.bl3, P.bl5] },
};

/** distance-to-edge helpers for square 9-slice tiles */
function edgeInfo(x: number, y: number, w: number, h: number) {
  const dl = x, dt = y, dr = w - 1 - x, db = h - 1 - y;
  const d = Math.min(dl, dt, dr, db);
  const light = d === dt || d === dl;
  return { d, light, cx: Math.min(dl, dr), cy: Math.min(dt, db) };
}

function diamondStud(px: Px, cx: number, cy: number, rad: number, t: Trim, gem = true) {
  for (let y = Math.floor(cy - rad - 1); y <= cy + rad + 1; y++) for (let x = Math.floor(cx - rad - 1); x <= cx + rad + 1; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, m = Math.abs(dx) + Math.abs(dy);
    if (m > rad + 0.5) continue;
    if (m > rad - 0.5) { px.p(x, y, P.K); continue; }
    if (gem && m < rad - 1.5) { px.p(x, y, dx + dy < -0.5 ? t.gem[2] : dx + dy < 0.5 ? t.gem[1] : t.gem[0]); continue; }
    px.p(x, y, dx + dy < 0 ? t.r[3] : dx + dy < 1 ? t.r[2] : t.r[1]);
  }
}

function rivet(px: Px, x: number, y: number, t: Trim) {
  px.p(x, y, t.r[3]); px.p(x + 1, y, t.r[2]); px.p(x, y + 1, t.r[2]); px.p(x + 1, y + 1, t.r[0]);
}

// ---------------------------------------------------------------------------------------------------------------
// frames
// ---------------------------------------------------------------------------------------------------------------

/** Ornate panel 9-slice: bronze rim, blackened iron band, filigree line and chiselled inner bevel. 40px tile, 12px slice. */
export function panelFrame(t: Trim, s = 40, b = 12, seed = 3) {
  const px = new Px(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const { d, light, cx, cy } = edgeInfo(x, y, s, s);
    if (d >= b) continue;
    if (cx + cy <= 1) continue;
    if (cx + cy === 2) { px.p(x, y, P.K); continue; }
    const n = hash(x, y, seed);
    let c: RGB;
    switch (d) {
      case 0: c = P.K; break;
      case 1: c = light ? t.r[3] : t.r[0]; break;
      case 2: c = light ? t.r[2] : t.r[1]; break;
      case 3: c = P.K; break;
      case 4: c = light ? t.b[3] : t.b[1]; break;
      case 5: case 6: c = n < 0.14 ? t.b[0] : n > 0.9 ? t.b[2] : t.b[1]; break;
      case 7: c = t.b[0]; break;
      case 8: c = P.K; break;
      case 9: c = light ? t.r[2] : t.r[1]; break;
      case 10: c = P.K; break;
      default: c = light ? P.st0 : P.st4;
    }
    // weathering: a few verdigris pixels on bronze rims
    if ((d === 1 || d === 2) && t === T.bronze && n > 0.965) c = n > 0.985 ? P.pt2 : P.pt1;
    px.p(x, y, c);
  }
  // corner studs
  for (const [sx, sy] of [[5.5, 5.5], [s - 5.5, 5.5], [5.5, s - 5.5], [s - 5.5, s - 5.5]]) diamondStud(px, sx, sy, 3.5, t);
  return px;
}

/** Recessed carved-stone well. 12px tile, 4px slice. */
function insetFrame(rim: RGB = P.br2, rimLo: RGB = P.br1) {
  const s = 12, px = new Px(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const { d, light, cx, cy } = edgeInfo(x, y, s, s);
    if (d >= 4) continue;
    if (cx + cy === 0) continue;
    if (d === 0) px.p(x, y, P.K);
    else if (d === 1) px.p(x, y, light ? rimLo : rim);
    else if (d === 2) px.p(x, y, P.K);
    else px.p(x, y, light ? 0x000000 : P.st3, light ? 0.7 : 0.8);
  }
  return px;
}

/** Tarot card frame with studded iron band and fleur corners. 36px tile, 12px slice. */
function cardFrame(t: Trim) {
  const s = 36, b = 12, px = new Px(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const { d, light, cx, cy } = edgeInfo(x, y, s, s);
    if (d >= b) continue;
    if (cx + cy <= 2) continue;
    if (cx + cy === 3) { px.p(x, y, P.K); continue; }
    const n = hash(x, y, 11);
    let c: RGB;
    switch (d) {
      case 0: c = P.K; break;
      case 1: c = light ? t.r[3] : t.r[1]; break;
      case 2: c = t.r[1]; break;
      case 3: c = P.K; break;
      case 4: c = light ? t.b[2] : t.b[0]; break;
      case 5: case 6: c = n < 0.15 ? t.b[0] : t.b[1]; break;
      case 7: c = t.b[0]; break;
      case 8: c = P.K; break;
      case 9: c = light ? t.r[3] : t.r[1]; break;
      case 10: c = t.r[0]; break;
      default: c = P.K;
    }
    px.p(x, y, c);
  }
  // studs on the band, centred in each repeating edge tile (centre tile = 12px)
  for (const [x, y] of [[17, 5], [17, s - 7], [5, 17], [s - 7, 17]]) rivet(px, x, y, t);
  // fleur corners
  const fleur = fromMap([
    '..KKK....',
    '.KhmK....',
    'KhmmKKK..',
    'KmmgggK..',
    'KKmgGgmKK',
    '..KgggmhK',
    '..KKmmmmK',
    '....KmmK.',
    '....KKK..',
  ], { K: P.K, h: t.r[3], m: t.r[1], g: t.gem[1], G: t.gem[2] });
  px.blit(fleur, 1, 1);
  px.blit(fleur, s - 10, 1, true, false);
  px.blit(fleur, 1, s - 10, false, true);
  px.blit(fleur, s - 10, s - 10, true, true);
  return px;
}

const SILVER: Trim = { r: [0x3e424a, 0x8c929c, 0xc8ccd4, 0xf4f6fa], b: [0x101114, 0x1c1e22, 0x2a2d33, 0x3c4048], gem: [0x4a5a78, 0x8ca6d8, 0xdce8ff] };
const CRIMSON: Trim = { r: [0x4a0612, 0xa8142c, 0xff3d5a, 0xffb0bc], b: [0x1a0206, 0x2c0610, 0x420a18, 0x5c1022], gem: [0x7a0a1c, 0xff3d5a, 0xffd0d8] };

/** Ornate rarity card frame (Fate cards): the tarot frame plus an inner gilt line and gem studs on the band.
 *  `shimmer` >= 0 draws one frame of the mythic prismatic sweep: a pale diagonal glint travels along the rim and
 *  the gems cycle crimson → magenta → gold → cyan (4 frames, played with a steps() animation). */
function rarityFrame(t: Trim, shimmer = -1, gems = true) {
  const prism: readonly [RGB, RGB, RGB][] = [[0x7a0a1c, 0xff3d5a, 0xffd0d8], [0x6a0a5a, 0xff4fd8, 0xffd0f4], [0x7a4a08, 0xffc531, 0xfff0b0], [0x0a4a6a, 0x6ae6ff, 0xd8faff]];
  const tt: Trim = shimmer >= 0 ? { ...t, gem: prism[shimmer % 4] } : t;
  const px = cardFrame(tt);
  const s = 36;
  // inner gilt line just inside the band (d = 10) and gem studs replacing the band rivets
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const { d, light, cx, cy } = edgeInfo(x, y, s, s);
    if (d === 10 && cx + cy > 4) px.p(x, y, light ? tt.r[3] : tt.r[2]);
  }
  if (gems) for (const [x, y] of [[18, 6], [18, s - 6], [6, 18], [s - 6, 18]]) diamondStud(px, x, y, 2.5, tt);
  if (shimmer >= 0) {
    const period = 36, phase = (shimmer * period) / 4;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const { d } = edgeInfo(x, y, s, s);
      if (d !== 1 && d !== 2 && d !== 9) continue;
      const k = (((x + y - phase) % period) + period) % period;
      if (k < 2) px.p(x, y, 0xffffff);
      else if (k < 4) px.p(x, y, prism[shimmer % 4][2]);
    }
  }
  return px;
}

/** Gothic stone button with chamfered corners. 16px tile, 5px slice, fill. */
function button(face: readonly [RGB, RGB, RGB, RGB], rim: readonly [RGB, RGB, RGB, RGB], pressed = false, seed = 2) {
  const s = 16, px = new Px(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const { d, light, cx, cy } = edgeInfo(x, y, s, s);
    if (cx + cy <= 1) continue;
    if (cx + cy === 2) { px.p(x, y, P.K); continue; }
    const n = hash(x, y, seed);
    let c: RGB;
    if (d === 0) c = P.K;
    else if (d === 1) c = light ? rim[3] : rim[0];
    else if (d === 2) c = light ? rim[2] : rim[1];
    else if (d === 3) c = P.K;
    else if (d === 4) c = pressed ? (light ? face[0] : face[2]) : (light ? face[3] : face[0]);
    else c = n < 0.1 ? face[0] : n > 0.92 ? face[2] : face[1];
    if (pressed && d >= 5 && y === 5) c = face[0];
    px.p(x, y, c);
  }
  return px;
}

/** Carved menu plaque with pointed gothic ends and gems. 48x18 tile; slices 4 (v) / 12 (h). */
function plaque(face: readonly [RGB, RGB, RGB, RGB], rim: readonly [RGB, RGB, RGB, RGB], gem: readonly [RGB, RGB, RGB], engrave: RGB, pressed = false) {
  const W = 48, H = 18, c = (H - 1) / 2, px = new Px(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const xl = Math.min(x, W - 1 - x), l = Math.floor(Math.abs(y - c) * 0.9);
    if (xl < l) continue;
    const dy = Math.min(y, H - 1 - y), top = y < c, lit = pressed ? !top : top;
    const n = hash(x, y, 5);
    let col: RGB;
    if (xl === l || dy === 0) col = P.K;
    else if (xl < 11) {
      // bronze end cap
      if (xl === 10) col = P.K;
      else if (xl === l + 1 || dy === 1) col = lit ? rim[3] : rim[0];
      else if (xl === 9) col = rim[0];
      else col = lit ? rim[2] : rim[1];
    } else if (dy === 1) col = lit ? rim[3] : rim[0];
    else if (dy === 2) col = lit ? rim[2] : rim[1];
    else if (dy === 3) col = P.K;
    else if (dy === 4) col = lit ? face[3] : face[0];
    else col = n < 0.12 ? face[0] : n > 0.9 ? face[2] : face[1];
    if (xl === 11 && dy >= 3) col = engrave;
    px.p(x, y, col);
  }
  // end gems set into the caps
  for (const gx of [5.5, W - 5.5]) {
    for (let y = 0; y < H; y++) for (let x = Math.floor(gx - 4); x <= gx + 4; x++) {
      const dx = x + 0.5 - gx, dy = y + 0.5 - (c + 0.5), m = Math.abs(dx) + Math.abs(dy) * 0.8;
      if (m > 3.2) continue;
      if (m > 2.2) px.p(x, y, P.K);
      else px.p(x, y, dx + dy < -0.6 ? gem[2] : dx + dy < 0.8 ? gem[1] : gem[0]);
    }
  }
  return px;
}

/** Small iron readout plate for HUD text. 12px tile, 4px slice, translucent fill. */
function hudPlate(t: Trim) {
  const s = 12, px = new Px(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const { d, light, cx, cy } = edgeInfo(x, y, s, s);
    if (cx + cy === 0) continue;
    if (cx + cy === 1) { px.p(x, y, P.K); continue; }
    if (d === 0) px.p(x, y, P.K);
    else if (d === 1) px.p(x, y, light ? t.r[2] : t.r[0]);
    else if (d === 2) px.p(x, y, P.K);
    else px.p(x, y, P.ink, 0.82);
  }
  return px;
}

/** Skill socket. 24px tile, 8px slice, fill. */
function slotFrame(t: Trim, deep: RGB = 0x090706) {
  const s = 24, px = new Px(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const { d, light, cx, cy } = edgeInfo(x, y, s, s);
    if (cx + cy <= 1) continue;
    if (cx + cy === 2) { px.p(x, y, P.K); continue; }
    const n = hash(x, y, 9);
    let c: RGB;
    if (d === 0) c = P.K;
    else if (d === 1) c = light ? t.r[3] : t.r[0];
    else if (d === 2) c = light ? t.r[2] : t.r[1];
    else if (d === 3) c = P.K;
    else if (d === 4) c = light ? t.b[3] : t.b[1];
    else if (d === 5) c = n < 0.2 ? t.b[0] : t.b[1];
    else if (d === 6) c = P.K;
    else if (d === 7) c = light ? 0x020101 : P.st2;
    else c = n < 0.08 ? 0x120d0b : deep;
    px.p(x, y, c);
  }
  for (const [x, y] of [[4, 4], [s - 6, 4], [4, s - 6], [s - 6, s - 6]]) rivet(px, x, y, t);
  return px;
}

/** Portrait frame (small, no fill). 20px tile, 6px slice. */
function portraitFrame(t: Trim) {
  const s = 20, px = new Px(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const { d, light, cx, cy } = edgeInfo(x, y, s, s);
    if (d >= 6) continue;
    if (cx + cy <= 1) continue;
    if (cx + cy === 2) { px.p(x, y, P.K); continue; }
    let c: RGB;
    if (d === 0) c = P.K;
    else if (d === 1) c = light ? t.r[3] : t.r[0];
    else if (d === 2) c = light ? t.r[2] : t.r[1];
    else if (d === 3) c = light ? t.r[1] : t.r[0];
    else if (d === 4) c = P.K;
    else c = light ? 0x000000 : P.st3;
    px.p(x, y, c);
  }
  for (const [sx, sy] of [[3, 3], [s - 3, 3], [3, s - 3], [s - 3, s - 3]]) diamondStud(px, sx, sy, 2.5, t, false);
  return px;
}

/** Bar housing with bronze end caps. 16x10 tile; slices 3 (v) / 5 (h). */
function barFrame(t: Trim) {
  const W = 16, H = 10, px = new Px(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = Math.min(x, W - 1 - x), dy = Math.min(y, H - 1 - y);
    if (dx + dy === 0) continue;
    const cap = dx < 4;
    let c: RGB | null = null;
    if (dx === 0 || dy === 0) c = P.K;
    else if (cap) {
      if (dx === 3) c = P.K;
      else c = y < H / 2 ? (dx === 1 ? t.r[3] : t.r[2]) : (dx === 1 ? t.r[1] : t.r[0]);
      if (dx === 2 && (y === 4 || y === 5)) c = y === 4 ? t.r[3] : t.r[1];
    } else if (dy === 1) c = y < H / 2 ? t.b[3] : t.b[1];
    else if (dy === 2) c = P.K;
    if (c !== null) px.p(x, y, c);
  }
  return px;
}

/** Boss bar housing with horned end caps. 56x18 tile; slices 5 (v) / 18 (h). */
function bossBarFrame() {
  const W = 56, H = 18, px = new Px(W, H), t = T.gold;
  // body rails
  for (let x = 12; x < W - 12; x++) {
    px.p(x, 2, P.K); px.p(x, 3, t.r[3]); px.p(x, 4, P.K);
    px.p(x, H - 5, P.K); px.p(x, H - 4, t.r[1]); px.p(x, H - 3, P.K);
  }
  // end caps: pointed bronze shield bearing a skull
  const cap = new Px(18, 18);
  for (let y = 0; y < 18; y++) for (let x = 0; x < 18; x++) {
    const l = Math.floor(Math.abs(y - 8.5) * 0.85);
    if (x < l || x > 16) continue;
    let c: RGB;
    if (x === l || y === 0 || y === 17 || x === 16) c = P.K;
    else if (x === l + 1 || y === 1) c = y < 8.5 ? t.r[3] : t.r[0];
    else if (x === 15 || y === 16) c = t.r[0];
    else c = y < 8.5 ? t.r[2] : t.r[1];
    cap.p(x, y, c);
  }
  cap.blit(fromMap(SKULL, skullLegend).outline(P.K), 4, 3);
  px.blit(cap, 0, 0);
  px.blit(cap, W - 18, 0, true, false);
  return px;
}

/** Carved stone action-bar slab with bronze mouldings. 32x32; slices 8 (top) / 6 (sides) / 6 (bottom). */
function actionBar() {
  const W = 32, H = 32, px = new Px(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = hash(x, y, 31), dx = Math.min(x, W - 1 - x);
    let c: RGB;
    if (y === 0 || y === H - 1 || dx === 0) c = P.K;
    else if (dx === 1) c = x < W / 2 ? P.br4 : P.br1;
    else if (dx === 2) c = P.br2;
    else if (dx === 3) c = P.K;
    else if (y === 1) c = P.br5; else if (y === 2) c = P.br3; else if (y === 3) c = P.br1; else if (y === 4) c = P.K;
    else if (y === 5) c = P.st5; else if (y === 6) c = P.st4;
    else if (y === H - 2) c = P.br1; else if (y === H - 3) c = P.br3; else if (y === H - 4) c = P.K; else if (y === H - 5) c = P.st1;
    else c = n < 0.12 ? P.st1 : n > 0.9 ? P.st4 : (n > 0.55 ? P.st3 : P.st2);
    px.p(x, y, c);
  }
  return px;
}

/** Gothic spire pillar bearing a skull (flanks the action bar). 20x66. */
function pillar() {
  const W = 20, H = 66, px = new Px(W, H), cx = W / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const half = y >= 12 ? 8 : y >= 10 ? 9 : Math.max(0, (y + 1) * 0.8);
    const dx = x + 0.5 - cx;
    if (Math.abs(dx) > half) continue;
    const edge = Math.abs(dx) > half - 1 || y === H - 1;
    let c: RGB;
    if (edge) c = P.K;
    else if (y < 10) c = dx < 0 ? P.br4 : P.br2;
    else if (y === 10 || y === 11) c = y === 10 ? P.br5 : P.br1;
    else if (y === 12) c = P.K;
    else if (y >= H - 6) c = y === H - 6 ? P.K : y === H - 5 ? P.br4 : dx < 0 ? P.br3 : P.br1;
    else if (Math.abs(dx) > half - 2.5) c = dx < 0 ? P.br4 : P.br1;
    else if (Math.abs(dx) > half - 3.5) c = P.K;
    else c = hash(x, y, 33) < 0.15 ? P.st2 : dx < 0 ? P.st4 : P.st3;
    px.p(x, y, c);
  }
  px.blit(fromMap(SKULL, skullLegend).outline(P.K), 4, 20);
  // gem below the skull
  for (let y = 36; y < 43; y++) for (let x = 6; x < 14; x++) {
    const ddx = x + 0.5 - cx, ddy = y + 0.5 - 39.5, m = Math.abs(ddx) + Math.abs(ddy);
    if (m > 3.5) continue;
    px.p(x, y, m > 2.5 ? P.K : ddx + ddy < -0.5 ? P.bl5 : ddx + ddy < 0.6 ? P.bl3 : P.bl1);
  }
  return px;
}

/** Thin progress rail used under the round medallion. 12x6 tile; slices 2 (v) / 4 (h). */
function railFrame() {
  const W = 12, H = 6, px = new Px(W, H), t = T.bronze;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = Math.min(x, W - 1 - x), dy = Math.min(y, H - 1 - y);
    if (dx === 0 && dy === 0) continue;
    if (dx === 0 || dy === 0) px.p(x, y, P.K);
    else if (dx < 3) px.p(x, y, y < 3 ? t.r[2] : t.r[0]);
    else if (dy === 1 && y === 1) px.p(x, y, t.b[2]);
  }
  return px;
}

/** Engraved stone keycap. 9x10 tile; slices 3/4. */
function keyCap() {
  const W = 9, H = 10, px = new Px(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = Math.min(x, W - 1 - x), dy = Math.min(y, H - 1 - y);
    if (dx === 0 && dy === 0) continue;
    let c: RGB;
    if (dx === 0 || dy === 0) c = P.K;
    else if (y >= H - 3) c = y === H - 2 ? P.st1 : P.st0;
    else if (y === 1) c = P.st5;
    else if (x === 1) c = P.st4;
    else if (x === W - 2) c = P.st2;
    else c = P.st3;
    px.p(x, y, c);
  }
  return px;
}

/** Tooltip box (D2-style near-black with fine bronze rule). 10px tile, 3px slice, fill. */
function tooltipFrame() {
  const s = 10, px = new Px(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const { d, light } = edgeInfo(x, y, s, s);
    if (d === 0) px.p(x, y, P.K);
    else if (d === 1) px.p(x, y, light ? P.br3 : P.br1);
    else px.p(x, y, 0x070505, 0.94);
  }
  return px;
}

/** Chip / tag. 8px tile, 3px slice, fill. */
function chipFrame(lo: RGB = P.fe2, hi: RGB = P.fe4, fill: RGB = P.ink) {
  const s = 8, px = new Px(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const { d, light, cx, cy } = edgeInfo(x, y, s, s);
    if (cx + cy === 0) continue;
    if (d === 0) px.p(x, y, P.K);
    else if (d === 1) px.p(x, y, light ? hi : lo);
    else px.p(x, y, fill);
  }
  return px;
}

/** Carved text input slot. 12px tile, 4px slice, fill. */
function inputFrame() {
  const s = 12, px = new Px(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const { d, light, cx, cy } = edgeInfo(x, y, s, s);
    if (cx + cy === 0) continue;
    if (d === 0) px.p(x, y, P.K);
    else if (d === 1) px.p(x, y, light ? P.br1 : P.br3);
    else if (d === 2) px.p(x, y, P.K);
    else if (d === 3) px.p(x, y, light ? 0x030202 : 0x0d0a09);
    else px.p(x, y, 0x0a0807);
  }
  return px;
}

// ---------------------------------------------------------------------------------------------------------------
// ornaments
// ---------------------------------------------------------------------------------------------------------------

export const SKULL = [
  '..KKKKK..',
  '.KbBBBBK.',
  'KbBBBBBBK',
  'KbKKBKKBK',
  'KbKrBrKBK',
  'KbBBKBBBK',
  '.KbBKBBK.',
  '.KBKBKBK.',
  '..KKKKK..',
];
const skullLegend = { K: P.K, B: P.bo3, b: P.bo1, r: P.bl4 };

/** Corner filigree bracket with a gem rosette (top-left orientation). 20x20. */
function cornerOrnament(t: Trim, skull = false, fx = false, fy = false): Px {
  if (fx || fy) {
    // mirror the bracket, but keep the skull upright
    const base = cornerOrnament(t, false).flip(fx, fy);
    if (!skull) return base;
    const out = new Px(20, 20);
    out.blit(base, 0, 0);
    out.blit(fromMap(SKULL, skullLegend).outline(P.K), fx ? 9 : 0, fy ? 9 : 0);
    return out;
  }
  const px = new Px(20, 20);
  // arms
  for (let i = 3; i < 18; i++) {
    px.p(i, 3, t.r[3]); px.p(i, 4, t.r[1]);
    px.p(3, i, t.r[2]); px.p(4, i, t.r[1]);
  }
  // curls at arm ends
  const curl = [[17, 2], [18, 2], [19, 3], [19, 4], [18, 5], [17, 5], [17, 4]];
  for (const [x, y] of curl) { px.p(x, y, t.r[2]); px.p(y, x, t.r[2]); }
  // inner thin filigree
  for (let i = 8; i < 14; i++) { px.p(i, 7, t.r[1]); px.p(7, i, t.r[1]); }
  px.p(14, 8, t.r[1]); px.p(8, 14, t.r[1]);
  if (skull) {
    const sk = fromMap(SKULL, skullLegend);
    px.blit(sk, 1, 1);
  } else {
    // rosette
    for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
      const dx = x + 0.5 - 5.5, dy = y + 0.5 - 5.5, r = Math.hypot(dx, dy);
      const petal = Math.abs(dx) < 1.6 || Math.abs(dy) < 1.6;
      if (r < 2.1) px.p(x, y, dx + dy < -0.4 ? t.gem[2] : dx + dy < 0.9 ? t.gem[1] : t.gem[0]);
      else if (r < 3.4) px.p(x, y, dx + dy < 0 ? t.r[3] : t.r[1]);
      else if (petal && r < 5.2) px.p(x, y, dx + dy < 0 ? t.r[2] : t.r[1]);
    }
  }
  px.outline(P.K);
  return px;
}

/** Horned skull crest with filigree wings, centred on a panel's top border. 56x20. */
function crest(t: Trim) {
  const W = 56, H = 20, px = new Px(W, H), cx = W / 2;
  // wings: tapering bronze scrolls
  for (let i = 0; i < 18; i++) {
    const y = 11 + Math.round(Math.sin(i / 17 * Math.PI) * -2);
    const th = i < 12 ? 2 : 1;
    for (let k = 0; k < th; k++) { px.p(cx - 8 - i, y + k, k === 0 ? t.r[3] : t.r[1]); px.p(cx + 7 + i, y + k, k === 0 ? t.r[3] : t.r[1]); }
  }
  for (const [x, y] of [[3, 9], [2, 10], [2, 11], [3, 12], [4, 12], [5, 11]]) { px.p(x, y, t.r[2]); px.p(W - 1 - x, y, t.r[2]); }
  // shield plate behind skull
  for (let y = 3; y < 19; y++) for (let x = Math.floor(cx - 8); x < cx + 8; x++) {
    const dx = Math.abs(x + 0.5 - cx), lim = y > 12 ? 8 - (y - 12) * 1.2 : 8;
    if (dx > lim) continue;
    px.p(x, y, dx > lim - 1.2 ? (x < cx ? t.r[2] : t.r[0]) : y < 6 ? t.b[2] : t.b[1]);
  }
  // horns
  const horn = (dir: number) => {
    const pts: [number, number, number][] = [[3, 7, 1.4], [5, 6, 1.3], [7, 5, 1.1], [8, 3, 0.9], [9, 2, 0.7], [9, 1, 0.5], [10, 0, 0.5]];
    for (const [ox, oy, r] of pts) px.disc(cx + dir * ox, oy + 0.5, r, oy < 3 ? P.bo3 : P.bo2);
  };
  horn(-1); horn(1);
  px.blit(fromMap(SKULL, skullLegend), Math.floor(cx - 4.5), 6);
  px.outline(P.K);
  return px;
}

/** Engraved divider: centre ornament (rule line drawn by tiling `ruleLine`). 64x11. */
function ruleOrnament(t: Trim) {
  const W = 64, H = 11, px = new Px(W, H), c = W / 2;
  for (let x = 6; x < W - 6; x++) { px.p(x, 5, t.r[2]); px.p(x, 6, t.r[0]); }
  // flourish
  for (const s of [-1, 1]) {
    for (let i = 0; i < 9; i++) { const y = 5 - Math.round(Math.sin(i / 8 * Math.PI) * 3); px.p(c + s * (6 + i), y, t.r[3]); }
    for (const [ox, oy] of [[15, 2], [16, 2], [17, 3], [17, 4], [16, 4]]) px.p(c + s * ox, oy, t.r[2]);
  }
  diamondStud(px, c, 5.5, 4.5, t);
  px.outline(P.K);
  return px;
}
function ruleLine(t: Trim) {
  const px = new Px(4, 11);
  for (let x = 0; x < 4; x++) { px.p(x, 4, P.K); px.p(x, 5, t.r[2]); px.p(x, 6, t.r[0]); px.p(x, 7, P.K); }
  return px;
}

/** Round medallion (round counter). 44x44. */
function medallion(boss: boolean) {
  const S = 44, px = new Px(S, S), c = S / 2, t = boss ? T.blood : T.bronze;
  // spikes behind the ring
  const spikes = new Px(S, S);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    for (let r = 15; r < 21.5; r++) {
      const w = (21.5 - r) * 0.32;
      for (let s = -w; s <= w; s += 0.5) {
        const x = c + Math.cos(a) * r - Math.sin(a) * s, y = c + Math.sin(a) * r + Math.cos(a) * s;
        spikes.p(x, y, s < 0 ? t.r[2] : t.r[1]);
      }
    }
  }
  spikes.outline(P.K);
  px.blit(spikes, 0, 0);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x + 0.5 - c, dy = y + 0.5 - c, r = Math.hypot(dx, dy);
    if (r > 17) continue;
    const lit = clamp01(0.5 - (dx + dy) / (r * 2.4 + 0.001));
    let col: RGB;
    if (r > 16) col = P.K;
    else if (r > 13.6) col = ramp([t.r[0], t.r[1], t.r[2], t.r[3]], lit * 1.15, x, y);
    else if (r > 12.6) col = P.K;
    else if (r > 10.6) col = ramp([t.b[0], t.b[1], t.b[2]], lit, x, y);
    else if (r > 9.8) col = P.K;
    else {
      const v = clamp01(0.75 - r / 14 + (-(dx + dy) / 40));
      col = boss ? ramp([P.bl0, P.bl1, P.bl2], v, x, y) : ramp([P.st0, P.st1, P.st2, P.st3], v, x, y);
    }
    px.p(x, y, col);
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    rivet(px, Math.round(c + Math.cos(a) * 11.6 - 1), Math.round(c + Math.sin(a) * 11.6 - 1), t);
  }
  if (boss) {
    const horns = new Px(S, S);
    for (const dir of [-1, 1]) {
      const pts: [number, number, number][] = [[8, 12, 2.2], [10, 9, 2], [12, 7, 1.8], [13, 5, 1.5], [14, 3, 1.2], [14, 1.5, 0.9], [13.5, 0.5, 0.6]];
      for (const [ox, oy, r] of pts) horns.disc(c + dir * ox, oy + 1, r, oy < 5 ? P.bo3 : P.bo2);
    }
    horns.outline(P.K);
    px.blit(horns, 0, 0);
  }
  return px;
}

/** Keystone socket (tier 4 skill node): spiked crown ring with cardinal gems around a deep well. S x S, drawn at
 *  native scale (not 9-sliced); the inner well is always >= 16px across so a 16px icon at 2x sits inside it. */
function keystone(t: Trim, S: number, deep: RGB = 0x0b0605) {
  const px = new Px(S, S), c = S / 2;
  const r1 = 13.5 + (S - 36) / 2.2;      // outer edge of the bronze ring
  const spikes = new Px(S, S);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    for (let r = r1 - 1; r < c - 0.5; r += 0.5) {
      const w = Math.max(0.5, (c - 0.5 - r) * 0.42);
      for (let s = -w; s <= w; s += 0.5) spikes.p(c + Math.cos(a) * r - Math.sin(a) * s, c + Math.sin(a) * r + Math.cos(a) * s, s < 0 ? t.r[2] : t.r[1]);
    }
  }
  spikes.outline(P.K);
  px.blit(spikes, 0, 0);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x + 0.5 - c, dy = y + 0.5 - c, r = Math.hypot(dx, dy);
    if (r > r1 + 1) continue;
    const lit = clamp01(0.5 - (dx + dy) / (r * 2.4 + 0.001));
    let col: RGB;
    if (r > r1) col = P.K;
    else if (r > r1 - 2.6) col = ramp([t.r[0], t.r[1], t.r[2], t.r[3]], lit * 1.15, x, y);
    else if (r > r1 - 3.6) col = P.K;
    else if (r > r1 - 5.2) col = ramp([t.b[0], t.b[1], t.b[2], t.b[3]], lit, x, y);
    else if (r > r1 - 6.2) col = P.K;
    else col = hash(x, y, 41) < 0.08 ? 0x150e0b : deep;
    px.p(x, y, col);
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 - Math.PI / 2;
    diamondStud(px, c + Math.cos(a) * (r1 - 1.3), c + Math.sin(a) * (r1 - 1.3), 2.5, t);
  }
  return px;
}

/** Red cross-chains drawn over a sealed (excluded) choice node. 12x12. */
function sealCross() {
  const px = new Px(12, 12);
  for (let i = 1; i < 11; i++) {
    for (const [x, y] of [[i, i], [11 - i, i]]) { px.p(x, y, i % 3 === 0 ? P.bl5 : P.bl4); }
    px.p(i + 1, i, P.bl2); px.p(10 - i, i, P.bl2);
  }
  px.outline(P.K, true);
  return px;
}

/** Tiny padlock for locked nodes. 7x8. */
function padlock() {
  return fromMap([
    '.KKKKK.',
    'KhK.KdK',
    'KhK.KdK',
    'KKKKKKK',
    'KhhmmdK',
    'KhmKmdK',
    'KhmmmdK',
    'KKKKKKK',
  ], { K: P.K, h: P.fe5, m: P.fe4, d: P.fe3 });
}

/** Requirement bullets: met (green tick) / unmet (red cross). 7x7. */
function tick(on: boolean) {
  return on
    ? fromMap(['......K', '.....Kg', 'K...KgK', 'gK.KgK.', 'KgKgK..', '.KgK...', '..K....'], { K: P.K, g: 0x8fe07a })
    : fromMap(['K.....K', 'rK...Kr', '.rK.Kr.', '..rKr..', '.rK.Kr.', 'rK...Kr', 'K.....K'], { K: P.K, r: P.bl4 });
}

/** Torch flame sprite strip: 8 frames of 12x20. */
function flameStrip(hot: readonly RGB[] = [P.bl2, P.bl3, P.em2, P.em3, P.em4, P.em5]) {
  const FW = 12, FH = 20, N = 8, px = new Px(FW * N, FH);
  for (let f = 0; f < N; f++) {
    const ph = (f / N) * Math.PI * 2;
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const h = (FH - 1 - y) / (FH - 1);
      const cx = 5.5 + Math.sin(h * 3.1 + ph) * 1.5 * h + Math.sin(h * 7.3 - ph * 2) * 0.5 * h;
      let hw = 4.4 * Math.pow(1 - h, 0.62) * (0.9 + 0.1 * Math.sin(ph * 2 + h * 5));
      if (y > FH - 5) hw *= Math.sqrt(Math.max(0, 1 - ((y - (FH - 5)) / 4.2) ** 2));
      const dist = Math.abs(x + 0.5 - cx) / Math.max(0.01, hw);
      if (dist >= 1) continue;
      const I = (1 - dist) * (1.05 - h * 0.75) + (hash(x, y + f * 31, 7) - 0.5) * 0.12;
      const i = I > 0.78 ? 5 : I > 0.58 ? 4 : I > 0.4 ? 3 : I > 0.22 ? 2 : I > 0.1 ? 1 : 0;
      px.p(f * FW + x, y, hot[i]);
    }
    // sparks drifting up
    for (let k = 0; k < 2; k++) {
      const life = ((f + k * 4) % N) / N;
      const sx = 5 + Math.round(Math.sin(k * 2.1 + life * 5) * 3), sy = Math.round(6 - life * 7);
      if (sy >= 0) px.p(f * FW + sx, sy, life < 0.5 ? hot[4] : hot[2]);
    }
  }
  return px;
}

/** Iron wall sconce that holds a flame. 12x14. */
function sconce() {
  return fromMap([
    '.KKKKKKKKKK.',
    'KhmmmmmmmmdK',
    '.KhmmmmmmdK.',
    '..KKKKKKKK..',
    '....KhdK....',
    '....KhdK....',
    '...KKhdKK...',
    '..KhhmmddK..',
    '..KhmggmdK..',
    '..KhmggmdK..',
    '..KhhmmddK..',
    '...KKhdKK...',
    '....KhdK....',
    '.....KK.....',
  ], { K: P.K, h: P.br4, m: P.br2, d: P.br1, g: P.bl4 });
}

/** Pixel sword cursor (hotspot 1,1). 16x16. */
function cursor() {
  const px = new Px(16, 16);
  for (let i = 0; i < 9; i++) { px.p(1 + i, 1 + i, P.bo4); px.p(2 + i, 1 + i, P.fe5); px.p(1 + i, 2 + i, P.bo1); }
  px.p(1, 1, P.W);
  // guard
  for (const [x, y] of [[8, 11], [9, 10], [10, 9], [11, 8], [7, 12], [12, 7]]) { px.p(x, y, P.br4); px.p(x + 1, y + 1, P.br2); }
  // grip + pommel
  px.p(11, 11, P.st4); px.p(12, 12, P.st4); px.p(12, 11, P.st3); px.p(11, 12, P.st3);
  px.rect(13, 13, 2, 2, P.bl4); px.p(13, 13, P.bl5);
  px.outline(P.K);
  return px;
}

// ---------------------------------------------------------------------------------------------------------------
// form controls and scrollbars
// ---------------------------------------------------------------------------------------------------------------

function checkBox(on: boolean) {
  const s = 12, px = new Px(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const { d, light, cx, cy } = edgeInfo(x, y, s, s);
    if (cx + cy === 0) continue;
    if (d === 0) px.p(x, y, P.K);
    else if (d === 1) px.p(x, y, light ? P.br4 : P.br1);
    else if (d === 2) px.p(x, y, P.K);
    else px.p(x, y, light && d === 3 ? 0x020101 : 0x0c0908);
  }
  if (on) {
    for (let y = 3; y < 9; y++) for (let x = 3; x < 9; x++) {
      const dx = x + 0.5 - 6, dy = y + 0.5 - 6, m = Math.abs(dx) + Math.abs(dy);
      if (m > 3) continue;
      px.p(x, y, m > 2.2 ? P.bl1 : dx + dy < -0.5 ? P.em5 : dx + dy < 0.6 ? P.em3 : P.bl4);
    }
  }
  return px;
}

function rangeTrack() {
  const W = 12, H = 8, px = new Px(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = Math.min(x, W - 1 - x), dy = Math.min(y, H - 1 - y);
    if (dx === 0 && dy === 0) continue;
    if (dx === 0 || dy === 0) px.p(x, y, P.K);
    else if (dx < 3) px.p(x, y, y < 4 ? P.br3 : P.br1);
    else if (dy === 1) px.p(x, y, y < 4 ? 0x020101 : P.st3);
    else px.p(x, y, 0x0c0908);
  }
  return px;
}

function rangeThumb() {
  return fromMap([
    '..KKKKKK..',
    '.KhhhhhmK.',
    'KhhmmmmmdK',
    'KhmmggmmdK',
    'KhmgGGgmdK',
    'KhmgGggmdK',
    'KhmmggmmdK',
    'KhmmmmmmdK',
    '.KhmmmmdK.',
    '..KhmmdK..',
    '...KhdK...',
    '....KK....',
  ], { K: P.K, h: P.br5, m: P.br3, d: P.br1, g: P.bl3, G: P.bl5 });
}

function selectArrow() {
  return fromMap(['KKKKKKK', 'KhhhhdK', '.KhhdK.', '..KdK..', '...K...'], { K: P.K, h: P.br4, d: P.br2 });
}

function scrollTrack() {
  const W = 12, H = 16, px = new Px(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let c: RGB;
    if (x === 0 || x === W - 1) c = P.K;
    else if (x === 1) c = P.st3;
    else if (x === W - 2) c = P.st1;
    else if (x === 2 || x === W - 3) c = P.K;
    else c = hash(x, y, 4) < 0.1 ? P.st1 : 0x0b0807;
    px.p(x, y, c);
  }
  // chain link down the centre groove
  for (const yy of [2, 10]) for (let k = 0; k < 4; k++) { px.p(5, yy + k, P.fe3); px.p(6, yy + k, P.fe2); }
  return px;
}

function scrollThumb() {
  const W = 12, H = 12, px = new Px(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const { d, light, cx, cy } = edgeInfo(x, y, W, H);
    if (cx + cy === 0) continue;
    let c: RGB;
    if (d === 0) c = P.K;
    else if (d === 1) c = light ? P.br4 : P.br1;
    else if (d === 2) c = light ? P.fe4 : P.fe1;
    else c = (y % 3 === 0) ? P.fe1 : (y % 3 === 1 ? P.fe4 : P.fe3);
    px.p(x, y, c);
  }
  return px;
}

// ---------------------------------------------------------------------------------------------------------------
// textures and masks
// ---------------------------------------------------------------------------------------------------------------

function stoneTile(cols: readonly RGB[], seed: number, size = 32) {
  const px = new Px(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = hash(x >> 2, y >> 2, seed) * 0.35 + hash(x >> 1, y >> 1, seed + 3) * 0.3 + hash(x, y, seed + 9) * 0.35;
    const i = n < 0.24 ? 0 : n < 0.66 ? 1 : n < 0.88 ? 2 : 3;
    px.p(x, y, cols[Math.min(cols.length - 1, i)]);
  }
  return px;
}

/** Dark masonry blocks for page backgrounds. 32x32. */
function masonry(seed = 5) {
  const S = 32, px = new Px(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const row = Math.floor(y / 8), off = row % 2 ? 8 : 0;
    const bx = (x + off) % 16, by = y % 8;
    const n = hash(x, y, seed), blk = hash(Math.floor((x + off) / 16), row, seed + 1);
    let c: RGB;
    if (by === 7 || bx === 15) c = P.K;
    else if (by === 0 || bx === 0) c = blk > 0.5 ? P.st2 : P.st1;
    else c = n < 0.18 ? P.st0 : n > 0.93 ? P.st2 : (blk > 0.66 ? P.st1 : 0x120f0d);
    px.p(x, y, c);
  }
  return px;
}

/** Hard-pixel vignette: alpha quantised into dithered steps (no soft gradients). */
function vignette(maxA: number, inner: number, W = 256, H = 144) {
  const px = new Px(W, H);
  const levels = [0, 0.2, 0.38, 0.56, 0.74, 0.9, 1];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = ((x + 0.5) / W) * 2 - 1, v = ((y + 0.5) / H) * 2 - 1;
    const d = Math.pow(Math.pow(Math.abs(u), 2.4) + Math.pow(Math.abs(v), 2.4), 1 / 2.4);
    const dark = clamp01((d - inner) / (1.18 - inner));
    const t = dark * dark * (levels.length - 1);
    const base = Math.floor(t);
    const lv = Math.min(levels.length - 1, base + (dither(x, y, t - base) ? 1 : 0));
    if (levels[lv] > 0) px.p(x, y, 0x050303, levels[lv] * maxA);
  }
  return px;
}

/** Dithered radial glow (white, hard pixels) used as a CSS mask and tinted with background-color. */
function glowMask(size = 64) {
  const px = new Px(size, size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - c, y - c) / c;
    const v = Math.max(0, 1 - d);
    if (dither(x, y, v * v * 1.15)) px.p(x, y, 0xffffff);
  }
  return px;
}

/** Dithered sunburst rays (12 spokes). */
function raysMask(size = 96) {
  const px = new Px(size, size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x - c, dy = y - c;
    const d = Math.hypot(dx, dy) / c;
    if (d > 1) continue;
    const a = Math.atan2(dy, dx);
    const spoke = Math.pow(Math.max(0, Math.cos(a * 6)), 6);
    if (dither(x, y, spoke * (1 - d) * 0.9)) px.p(x, y, 0xffffff);
  }
  return px;
}

/** Selection brackets for the chosen Fate card (four corner hooks on one tile). 16px tile, 6px slice. */
function selectBrackets() {
  const s = 16, px = new Px(s, s);
  const hook = (fx: boolean, fy: boolean) => {
    for (let i = 0; i < 6; i++) {
      for (const [x, y] of [[i, 0], [0, i], [i, 1], [1, i]]) {
        const xx = fx ? s - 1 - x : x, yy = fy ? s - 1 - y : y;
        px.p(xx, yy, (x === 0 || y === 0) ? P.em5 : P.em3);
      }
    }
  };
  hook(false, false); hook(true, false); hook(false, true); hook(true, true);
  return px;
}

// ---------------------------------------------------------------------------------------------------------------
// install
// ---------------------------------------------------------------------------------------------------------------

/** Every generated asset, keyed by CSS custom property name. Exported for offline previews. */
export function buildSkinAssets(): Record<string, Px> {
  const out: Record<string, Px> = {};
  // panels
  out['--px-frame'] = panelFrame(T.bronze);
  out['--px-frame-blood'] = panelFrame(T.blood);
  out['--px-frame-ember'] = panelFrame(T.ember);
  out['--px-frame-arcane'] = panelFrame(T.arcane);
  out['--px-frame-gold'] = panelFrame(T.gold);
  out['--px-frame-inset'] = insetFrame();
  out['--px-frame-inset-gold'] = insetFrame(P.br4, P.br2);
  out['--px-card'] = cardFrame(T.iron);
  out['--px-card-gold'] = cardFrame(T.gold);
  // Fate card rarity frames: silver (common), ornate gold (rare), crimson prismatic with a 4-frame shimmer (mythic)
  out['--px-card-common'] = rarityFrame(SILVER, -1, false);
  out['--px-card-rare'] = rarityFrame(T.gold);
  for (let f = 0; f < 4; f++) out[`--px-card-mythic-${f}`] = rarityFrame(CRIMSON, f);
  out['--px-hud-plate'] = hudPlate(T.bronze);
  out['--px-tooltip'] = tooltipFrame();
  out['--px-chip'] = chipFrame();
  out['--px-chip-bad'] = chipFrame(P.bl2, P.bl4, 0x0e0505);   // HUD debuff chips
  out['--px-chip-good'] = chipFrame(P.br2, P.br4, 0x0d0905);  // HUD buff chips
  out['--px-input'] = inputFrame();
  // buttons
  out['--px-btn'] = button([P.st2, P.st3, P.st4, P.st5], T.bronze.r);
  out['--px-btn-hover'] = button([P.st3, P.st4, P.st5, P.bo1], [P.em1, P.em3, P.em4, P.em5]);
  out['--px-btn-press'] = button([P.st1, P.st2, P.st3, P.st2], [P.br0, P.br2, P.br3, P.br3], true);
  out['--px-btn-blood'] = button([P.bl0, P.bl1, P.bl2, P.bl3], T.gold.r);
  out['--px-btn-blood-hover'] = button([P.bl1, P.bl2, P.bl3, P.bl4], [P.em1, P.em3, P.em5, P.W]);
  out['--px-btn-blood-press'] = button([P.bl0, P.bl0, P.bl1, P.bl2], [P.br1, P.br2, P.br3, P.br4], true);
  out['--px-btn-ember'] = button([P.br1, P.br3, P.br4, P.br5], [P.br0, P.em2, P.em4, P.em5]);
  out['--px-btn-ember-hover'] = button([P.br2, P.br4, P.br5, P.br6], [P.em1, P.em3, P.em5, P.W]);
  out['--px-btn-arcane'] = button([P.vi0, P.vi1, P.vi2, P.vi3], T.arcane.r);
  out['--px-btn-arcane-hover'] = button([P.vi1, P.vi2, P.vi3, P.vi4], [P.mb2, P.mb3, P.mb4, P.mb5]);
  out['--px-btn-ghost'] = button([0x0a0807, P.st0, P.st1, P.st2], T.iron.r);
  // menu plaques
  out['--px-plaque'] = plaque([P.st2, P.st3, P.st4, P.st4], T.bronze.r, [P.bl1, P.bl2, P.bl4], P.st1);
  out['--px-plaque-hover'] = plaque([P.st3, P.st4, P.st5, P.st5], [P.em1, P.em3, P.em4, P.em5], [P.bl3, P.bl4, P.em5], P.em1);
  out['--px-plaque-press'] = plaque([P.st1, P.st2, P.st3, P.st2], [P.br0, P.br2, P.br3, P.br3], [P.bl1, P.bl3, P.bl4], P.st0, true);
  out['--px-plaque-blood'] = plaque([P.bl0, P.bl1, P.bl2, P.bl2], T.gold.r, [P.em1, P.em3, P.em5], P.bl0);
  out['--px-plaque-blood-hover'] = plaque([P.bl1, P.bl2, P.bl3, P.bl3], [P.em2, P.em4, P.em5, P.W], [P.em3, P.em4, P.W], P.bl1);
  out['--px-plaque-off'] = plaque([P.st1, P.st1, P.st2, P.st2], T.iron.r, [P.fe1, P.fe2, P.fe3], P.st0);
  // sockets, bars, plates
  out['--px-slot'] = slotFrame(T.bronze);
  out['--px-slot-ready'] = slotFrame({ ...T.bronze, r: [P.br2, P.em3, P.em4, P.em5] });
  out['--px-slot-sig'] = slotFrame(T.gold, 0x0b0605);
  out['--px-slot-sig-ready'] = slotFrame({ ...T.gold, r: [P.em2, P.em4, P.em5, P.W] }, 0x0b0605);
  out['--px-slot-empty'] = slotFrame(T.iron, 0x070606);
  // skill-tree sockets: owned (gold rim), capstone owned, keystones (tier 4) in two native sizes
  const goldRim: Trim = { ...T.bronze, r: [P.br2, P.br4, P.br5, P.br6] };
  const hotGold: Trim = { ...T.gold, r: [P.br3, P.br5, P.br6, P.W] };
  const emberRim: Trim = { ...T.bronze, r: [P.br2, P.em3, P.em4, P.em5] };
  out['--px-slot-owned'] = slotFrame(goldRim);
  out['--px-slot-sig-owned'] = slotFrame(hotGold, 0x0b0605);
  out['--px-keystone'] = keystone(T.bronze, 36);
  out['--px-keystone-ready'] = keystone(emberRim, 36);
  out['--px-keystone-owned'] = keystone(hotGold, 36);
  out['--px-keystone-lg'] = keystone(T.bronze, 44);
  out['--px-keystone-lg-ready'] = keystone(emberRim, 44);
  out['--px-keystone-lg-owned'] = keystone(hotGold, 44);
  out['--px-seal'] = sealCross();
  out['--px-lock'] = padlock();
  out['--px-tick'] = tick(true);
  out['--px-cross'] = tick(false);
  out['--px-portrait'] = portraitFrame(T.bronze);
  out['--px-portrait-me'] = portraitFrame(T.gold);
  out['--px-portrait-down'] = portraitFrame(T.blood);
  out['--px-bar'] = barFrame(T.bronze);
  out['--px-bar-gold'] = barFrame(T.gold);
  out['--px-bossbar'] = bossBarFrame();
  out['--px-rail'] = railFrame();
  out['--px-actionbar'] = actionBar();
  out['--px-pillar'] = pillar();
  out['--px-key'] = keyCap();
  out['--px-medallion'] = medallion(false);
  out['--px-medallion-boss'] = medallion(true);
  // ornaments
  out['--px-orn-tl'] = cornerOrnament(T.bronze);
  out['--px-orn-tr'] = out['--px-orn-tl'].flip(true, false);
  out['--px-orn-bl'] = out['--px-orn-tl'].flip(false, true);
  out['--px-orn-br'] = out['--px-orn-tl'].flip(true, true);
  out['--px-skull-tl'] = cornerOrnament(T.blood, true);
  out['--px-skull-tr'] = cornerOrnament(T.blood, true, true, false);
  out['--px-skull-bl'] = cornerOrnament(T.blood, true, false, true);
  out['--px-skull-br'] = cornerOrnament(T.blood, true, true, true);
  out['--px-crest'] = crest(T.bronze);
  out['--px-crest-blood'] = crest(T.blood);
  out['--px-divider'] = ruleOrnament(T.bronze);
  out['--px-rule'] = ruleLine(T.bronze);
  out['--px-flame'] = flameStrip();
  out['--px-flame-blue'] = flameStrip([P.vi1, P.vi2, P.vi3, P.mb3, P.mb4, P.mb5]);
  out['--px-sconce'] = sconce();
  out['--px-select'] = selectBrackets();
  out['--px-skull'] = fromMap(SKULL, skullLegend).outline(P.K);
  // controls
  out['--px-check'] = checkBox(false);
  out['--px-check-on'] = checkBox(true);
  out['--px-range-track'] = rangeTrack();
  out['--px-range-thumb'] = rangeThumb();
  out['--px-select-arrow'] = selectArrow();
  out['--px-sb-track'] = scrollTrack();
  out['--px-sb-thumb'] = scrollThumb();
  // textures and masks
  out['--px-stone'] = stoneTile([P.st1, P.st2, P.st3, P.st4], 3);
  out['--px-stone-dark'] = masonry();
  out['--px-iron'] = stoneTile([P.fe0, P.fe1, P.fe2, P.fe3], 8, 16);
  out['--px-vignette'] = vignette(1, 0.42);
  out['--px-vignette-soft'] = vignette(0.85, 0.62);
  out['--px-glow'] = glowMask();
  out['--px-rays'] = raysMask();
  return out;
}

let installed = false;
export function installPixelSkin() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const root = document.documentElement.style;
  const assets = buildSkinAssets();
  for (const [k, px] of Object.entries(assets)) root.setProperty(k, px.url());
  root.setProperty('--px-cursor', `${cursor().url(2)} 2 2, auto`);
  document.documentElement.dataset.skin = 'ready';
}

export const SKIN_COLORS = PAL;
export { T as SKIN_TRIMS, cursor as skinCursor };
