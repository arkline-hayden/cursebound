import type Phaser from 'phaser';
import { addAnim, addFramedTexture } from '../art/texutil';

// Procedural pixel art for the cutscenes (built once per scene on first use). Glows are drawn in grey levels so a
// single sheet can be tinted per theme / boss and blended additively; the crack sheet is drawn in its own colours.
//   cine:portal  40x64 x6   swirling entry rift (tint + ADD)
//   cine:circle  128x64 x8  summoning circle that draws itself frame by frame (tint + ADD)
//   cine:cracks  192x96 x8  molten ground cracks spreading from the centre (normal blend)
//   cine:shaft   24x96 x1   vertical light shaft for door flares (tint + ADD)

type Px = { w: number; h: number; d: Uint8ClampedArray };

function sheet(w: number, h: number, frames: number) {
  return { fw: w, fh: h, frames, buf: { w: w * frames, h, d: new Uint8ClampedArray(w * frames * h * 4) } as Px };
}

function put(b: Px, x: number, y: number, r: number, g: number, bl: number, a: number) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return;
  const i = (y * b.w + x) * 4;
  // keep the brighter of overlapping marks
  if (b.d[i + 3] > a && b.d[i] + b.d[i + 1] + b.d[i + 2] >= r + g + bl) return;
  b.d[i] = r; b.d[i + 1] = g; b.d[i + 2] = bl; b.d[i + 3] = a;
}

const grey = (b: Px, x: number, y: number, level: number, a: number) => put(b, x, y, level, level, level, a);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function upload(scene: Phaser.Scene, key: string, s: ReturnType<typeof sheet>, durations: number[] | null, loop = true) {
  if (scene.textures.exists(key)) return;
  addFramedTexture(scene, key, s.buf.w, s.buf.h, s.buf.d, s.fw, s.fh, s.frames);
  if (durations) addAnim(scene, key, key, durations, loop);
}

function portal(): ReturnType<typeof sheet> {
  const s = sheet(40, 64, 6);
  const cx = 20, cy = 34, rx = 14, ry = 27;
  for (let f = 0; f < s.frames; f++) {
    const ox = f * s.fw;
    const ph = (f / s.frames) * Math.PI * 2;
    for (let y = 0; y < s.fh; y++) for (let x = 0; x < s.fw; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      const d = Math.hypot(dx, dy);
      if (d > 1.16) continue;
      if (d > 1.0) { if ((x + y + f) % 2 === 0) grey(s.buf, ox + x, y, 150, 150); continue; }
      if (d > 0.84) { grey(s.buf, ox + x, y, 255, 255); continue; }
      if (d < 0.2) { grey(s.buf, ox + x, y, 255, 230); continue; }
      const a = Math.atan2(dy, dx);
      const v = Math.sin(a * 3 + d * 7 - ph);
      if (v > 0.55) grey(s.buf, ox + x, y, 210, 225);
      else if (v > 0.05) grey(s.buf, ox + x, y, 130, 180);
      else grey(s.buf, ox + x, y, 70, 130);
    }
    // sparks drifting off the rim
    const r = rng(77 + f * 13);
    for (let k = 0; k < 7; k++) {
      const a = r() * Math.PI * 2;
      grey(s.buf, ox + Math.round(cx + Math.cos(a) * rx * (1.08 + r() * 0.2)), Math.round(cy + Math.sin(a) * ry * (1.05 + r() * 0.12)), 255, 255);
    }
  }
  return s;
}

function circle(): ReturnType<typeof sheet> {
  const s = sheet(128, 64, 8);
  const cx = 64, cy = 32;
  const r = rng(4242);
  // rune glyphs: 8 tiny 5x5 marks around the band
  const glyphs = Array.from({ length: 8 }, () => Array.from({ length: 25 }, () => r() < 0.42));
  const star = Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2 - Math.PI / 2; return [Math.cos(a) * 44, Math.sin(a) * 44]; });
  const segs: [number, number, number, number][] = [];
  for (let i = 0; i < 6; i++) { const a = star[i], b = star[(i + 2) % 6]; segs.push([a[0], a[1], b[0], b[1]]); }
  const segDist = (px: number, py: number, [x0, y0, x1, y1]: [number, number, number, number]) => {
    const vx = x1 - x0, vy = y1 - y0, l2 = vx * vx + vy * vy;
    const t = Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / l2));
    return Math.hypot(px - (x0 + vx * t), py - (y0 + vy * t));
  };
  for (let f = 0; f < s.frames; f++) {
    const ox = f * s.fw;
    const q = (f + 1) / s.frames;
    for (let y = 0; y < s.fh; y++) for (let x = 0; x < s.fw; x++) {
      const wx = x + 0.5 - cx, wy = (y + 0.5 - cy) * 2;
      const rr = Math.hypot(wx, wy);
      const ang = (Math.atan2(wy, wx) + Math.PI * 2.5) % (Math.PI * 2) / (Math.PI * 2);
      if (ang <= q) {
        if (rr >= 57 && rr <= 61) grey(s.buf, ox + x, y, 255, 255);
        else if (rr >= 44 && rr <= 46.5) grey(s.buf, ox + x, y, 220, 240);
        else if (rr >= 18 && rr <= 20) grey(s.buf, ox + x, y, 200, 230);
        else if (rr >= 52 && rr <= 55 && Math.floor(ang * 96) % 2 === 0) grey(s.buf, ox + x, y, 140, 190);
      }
      if (q > 0.45 && rr < 46) {
        const k = Math.min(1, (q - 0.45) / 0.4);
        for (let i = 0; i < segs.length; i++) {
          if (i / segs.length > k) break;
          if (segDist(wx, wy, segs[i]) < 1.3) { grey(s.buf, ox + x, y, 235, 245); break; }
        }
      }
    }
    if (q > 0.7) {
      for (let g = 0; g < glyphs.length; g++) {
        if (g / glyphs.length > (q - 0.7) / 0.3) break;
        const a = (g / glyphs.length) * Math.PI * 2;
        const gx = Math.round(cx + Math.cos(a) * 51 - 2), gy = Math.round(cy + (Math.sin(a) * 51) / 2 - 2);
        glyphs[g].forEach((on, i) => { if (on) grey(s.buf, ox + gx + (i % 5), gy + Math.floor((i / 5) * 0.6), 255, 255); });
      }
    }
  }
  return s;
}

function cracks(): ReturnType<typeof sheet> {
  const s = sheet(192, 96, 8);
  const cx = 96, cy = 48;
  const r = rng(9001);
  // branches in world space (y doubled), each point remembers its distance from the centre along the crack
  const pts: { x: number; y: number; d: number }[] = [];
  const grow = (x: number, y: number, a: number, len: number, d0: number, depth: number) => {
    let d = d0;
    for (let i = 0; i < len; i += 2) {
      a += (r() - 0.5) * 0.7;
      x += Math.cos(a) * 2; y += Math.sin(a) * 2; d += 2;
      pts.push({ x, y, d });
      if (depth < 2 && r() < 0.07) grow(x, y, a + (r() < 0.5 ? -1 : 1) * (0.6 + r() * 0.5), len * 0.45, d, depth + 1);
    }
  };
  for (let k = 0; k < 7; k++) grow(0, 0, (k / 7) * Math.PI * 2 + r() * 0.5, 60 + r() * 30, 0, 0);
  const maxD = Math.max(...pts.map((p) => p.d));
  for (let f = 0; f < s.frames; f++) {
    const ox = f * s.fw;
    const lim = ((f + 1) / s.frames) * maxD;
    for (const p of pts) {
      if (p.d > lim) continue;
      const sx = Math.round(cx + p.x), sy = Math.round(cy + p.y / 2);
      const hot = p.d > lim - 10;
      for (let oy = -1; oy <= 1; oy++) for (let oxx = -1; oxx <= 1; oxx++) if (oxx || oy) put(s.buf, ox + sx + oxx, sy + oy, 34, 16, 8, 230);
      put(s.buf, ox + sx, sy, hot ? 255 : 255, hot ? 240 : 140, hot ? 160 : 40, 255);
      if (p.d < lim * 0.6) put(s.buf, ox + sx + 1, sy, 255, 110, 30, 255);
    }
  }
  return s;
}

function shaft(): ReturnType<typeof sheet> {
  const s = sheet(24, 96, 1);
  for (let y = 0; y < s.fh; y++) for (let x = 0; x < s.fw; x++) {
    const dx = Math.abs(x + 0.5 - 12) / 12;
    const fadeUp = y / s.fh;   // brightest at the floor
    const band = dx < 0.25 ? 255 : dx < 0.5 ? 190 : dx < 0.75 ? 120 : 60;
    const a = Math.round(band * (0.25 + 0.75 * fadeUp));
    if (dx < 0.92 && ((x + y) % 2 === 0 || dx < 0.75)) grey(s.buf, x, y, band, a);
  }
  return s;
}

/** Build every cutscene texture once. */
export function ensureCineArt(scene: Phaser.Scene) {
  if (scene.textures.exists('cine:shaft')) return;
  upload(scene, 'cine:portal', portal(), [90, 90, 90, 90, 90, 90], true);
  upload(scene, 'cine:circle', circle(), null);
  upload(scene, 'cine:cracks', cracks(), null);
  upload(scene, 'cine:shaft', shaft(), null);
}
