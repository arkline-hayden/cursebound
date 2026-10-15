import type { FxSpec } from '../fxPrims';
import { PixelBuffer, sparkle } from '../draw/pixel';

// Duelist effect sheets (projectiles, signature shapes). Framework-free pixel art; keys use the fx:duelist:* prefix.
//  fx:duelist:reflect  a parried shot turned into a spinning four-bladed steel star (silver blades, crimson tips).
//  fx:duelist:thrust   a razor lance thrust streak pointing east (origin on the left edge): extends, holds, fades.
//  fx:duelist:xslash   Rend's crossing X-cut: first stroke, second stroke, both, fade.

const CRIMSON = 0xff3a52;
const BLOOD = 0xb0142a;
const PINK = 0xff9aa8;
const SILVER = 0xd8e2f0;

function reflect(buf: PixelBuffer) {
  const cx = 8, cy = 8;
  for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
    const vx = x + 0.5 - cx, vy = y + 0.5 - cy;
    const r = Math.hypot(vx, vy);
    if (r > 7.6) continue;
    if (r < 1.6) { buf.set(x, y, r < 0.8 ? 0xffffff : BLOOD, 255); continue; }
    // four blades swept into hooks: the blade axis twists with radius
    const a = Math.atan2(vy, vx) - r * 0.16;
    const q = ((a % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    const off = q - Math.PI / 4;
    const w = 0.62 * (1 - r / 8.2) + 0.06;
    if (Math.abs(off) > w) continue;
    const lead = off > w * 0.35;
    const c = r > 5.6 ? (lead ? PINK : CRIMSON) : lead ? 0xffffff : Math.abs(off) < w * 0.4 ? SILVER : 0x8a98b8;
    buf.set(x, y, c, 255);
  }
  if (buf.inside(2, 2)) sparkle(buf, 3, 3, 0xffffff, 1, 220);
}

function thrust(buf: PixelBuffer, i: number) {
  const cy = 5;
  const L = i === 0 ? 40 : 63;
  const fade = i <= 1 ? 1 : i === 2 ? 0.7 : 0.35;
  for (let x = 0; x <= L; x++) {
    const t = x / L;
    // tapered body: thin at the hilt, fattest at three quarters, a hard point at the tip
    const w = t < 0.75 ? 0.6 + t * 2.4 : 2.4 * (1 - (t - 0.75) / 0.25) + 0.3;
    for (let dy = -3; dy <= 3; dy++) {
      const d = Math.abs(dy);
      if (d > w) continue;
      const c = d < 0.6 ? 0xffffff : d < w * 0.55 ? (t > 0.4 ? SILVER : PINK) : t > 0.55 ? CRIMSON : BLOOD;
      buf.blend(x, cy + dy, c, Math.round(255 * fade * (t < 0.15 ? 0.5 : 1)));
    }
  }
  // speed ticks trailing the stroke and a glint at the point
  for (let k = 0; k < 4; k++) {
    const x = 4 + k * 9 + (i % 2) * 3;
    if (x < L - 6) { buf.blend(x, cy - 4, 0xffffff, Math.round(150 * fade)); buf.blend(x + 1, cy - 4, 0xffffff, Math.round(90 * fade)); buf.blend(x + 3, cy + 4, PINK, Math.round(140 * fade)); }
  }
  if (i <= 1) sparkle(buf, Math.min(buf.w - 2, L), cy, 0xffffff, 2, 255);
}

/** One razor stroke between two points: tapered, banded crimson to white core. Draws the first `upto` of its length. */
function stroke(buf: PixelBuffer, x0: number, y0: number, x1: number, y1: number, upto: number, fade: number) {
  const L = Math.hypot(x1 - x0, y1 - y0);
  const nx = -(y1 - y0) / L, ny = (x1 - x0) / L;
  const steps = Math.ceil(L * 3 * upto);
  for (let s = 0; s <= steps; s++) {
    const t = (s / Math.max(1, steps)) * upto;
    const w = 3.4 * Math.sin(Math.PI * t) + 0.4;
    const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
    for (let q = -w; q <= w; q += 0.5) {
      const e = Math.abs(q) / w;
      const c = e < 0.25 ? 0xffffff : e < 0.55 ? PINK : e < 0.8 ? CRIMSON : BLOOD;
      buf.blend(Math.round(px + nx * q), Math.round(py + ny * q), c, Math.round(255 * fade * (e < 0.8 ? 1 : 0.7)));
    }
  }
}

function xslash(buf: PixelBuffer, i: number) {
  const fade = i === 3 ? 0.45 : 1;
  stroke(buf, 6, 9, 42, 39, i === 0 ? 0.75 : 1, fade);
  if (i >= 1) stroke(buf, 6, 39, 42, 9, i === 1 ? 0.65 : 1, fade);
  if (i === 2) { sparkle(buf, 24, 24, 0xffffff, 3, 255); sparkle(buf, 42, 9, PINK, 1, 220); sparkle(buf, 42, 39, PINK, 1, 220); }
}

export const SPECS: FxSpec[] = [
  { key: 'fx:duelist:reflect', w: 16, h: 16, frames: 1, durations: [100], loop: false, anim: false, draw: (b) => reflect(b) },
  { key: 'fx:duelist:thrust', w: 64, h: 11, frames: 4, durations: [30, 50, 60, 70], loop: false, draw: (b, i) => thrust(b, i) },
  { key: 'fx:duelist:xslash', w: 48, h: 48, frames: 4, durations: [35, 40, 70, 90], loop: false, draw: (b, i) => xslash(b, i) },
];
