import type { FxSpec } from '../fxPrims';
import { line } from '../fxPrims';
import { PixelBuffer, lighten, rng, sparkle } from '../draw/pixel';

// Vanguard effect sheets (projectiles, signature shapes). Framework-free pixel art; keys use the fx:vanguard:* prefix.
//  fx:vanguard:wave   Sundering Wave projectile: an east-facing ground shockwave crescent (amber body, white leading
//                     edge, steel inner wake, flying rubble), 4 shimmering frames.
//  fx:vanguard:shield the Vanguard's heater shield (steel field, gold rim, crimson chevron, white glint), popped in
//                     front of the hero when a guard skill raises it.
//  fx:vanguard:crack  radial ground fissures with molten cores, iso-squashed (2:1) for slams and aftershocks.

const OUT = 0x1a1220;

/**
 * Banded crescent facing east around (cx, cy): thickest on the axis, tapering to points at +-half radians. Bands run
 * from the trailing (inner) side to a white leading (outer) edge; hard steps only.
 */
function bandArc(buf: PixelBuffer, cx: number, cy: number, r: number, th: number, half: number, col: number, alpha = 255, ry = 1) {
  const hot = lighten(col, 0.5);
  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      const vx = x + 0.5 - cx, vy = (y + 0.5 - cy) / ry;
      const a = Math.atan2(vy, vx);
      if (Math.abs(a) > half) continue;
      const k = Math.abs(a) / half;
      const w = th * (1 - k * k) + 0.4;
      const off = Math.hypot(vx, vy) - r;
      if (off < -w || off > w * 0.7) continue;
      const f = (off + w) / (w * 1.7);
      const c = f > 0.72 ? 0xffffff : f > 0.42 ? hot : col;
      buf.blend(x, y, c, Math.round(alpha * (f > 0.42 ? 1 : 0.82)));
    }
  }
}

function wave(buf: PixelBuffer, i: number) {
  const r = rng(71 + i * 13);
  const wob = [0, 1, 0, -1][i % 4]!;
  // trailing wake and steel inner crescent, then the hot amber front
  bandArc(buf, 2, 16, 13, 2.0, 0.85, 0xc8641a, 150);
  bandArc(buf, 3, 16, 17, 2.4, 0.86 + wob * 0.03, 0x6aa8e0, 210);
  bandArc(buf, 3, 16, 22 + wob * 0.5, 3.6, 0.8, 0xffa830, 255);
  // flying rubble and glints behind the front
  for (let k = 0; k < 10; k++) {
    const x = Math.round(5 + r() * 15), y = Math.round(5 + r() * 22);
    if (Math.hypot(x - 3, y - 16) > 20) continue;
    buf.blend(x, y, k % 3 ? 0x8a6a48 : 0xe8c890, 255);
    if (k % 4 === 0) buf.blend(x + 1, y, 0x5a4030, 255);
  }
  sparkle(buf, 26, 16 + wob, 0xffe0a0, 1, 255);
  sparkle(buf, 20, 4 + (i % 2), 0xfff0c8, 1, 200);
  sparkle(buf, 20, 28 - (i % 2), 0xfff0c8, 1, 200);
}

/** Heater shield: flat top, straight flanks, curving to a point. */
function shield(buf: PixelBuffer) {
  const cx = 12, top = 2, flank = 13, tip = 26;
  const half = (y: number) => (y < flank ? 10 : 10 * Math.sqrt(Math.max(0, 1 - ((y - flank) / (tip - flank)) ** 2)));
  for (let y = top; y <= tip; y++) {
    const hw = half(y);
    for (let x = 0; x < buf.w; x++) {
      const dx = x + 0.5 - cx;
      if (Math.abs(dx) > hw) continue;
      const edge = Math.min(hw - Math.abs(dx), y - top + 0.5, (tip - y) + 0.5);
      let c: number;
      if (edge < 1) c = OUT;
      else if (edge < 2.6) c = dx < 0 && y < flank + 4 ? 0xffe08a : y > flank + 5 || dx > 3 ? 0xa86a10 : 0xffc94a;
      else {
        // steel field lit from the top-left, hard bands
        const lit = -dx * 0.08 - (y - top) * 0.05;
        c = lit > 0.25 ? 0xd8e8f8 : lit > -0.25 ? 0x9fb8d4 : lit > -0.7 ? 0x6e88a8 : 0x4a6080;
        // crimson chevron emblem
        const cy = 10 + Math.abs(dx) * 0.9;
        if (y >= cy && y <= cy + 3 && Math.abs(dx) < 7) c = y < cy + 1 ? 0xff6a5e : 0xb02020;
        // central boss
        if (Math.hypot(dx, y - 7) < 2) c = Math.hypot(dx + 0.6, y - 6.4) < 1 ? 0xffffff : 0xffc94a;
      }
      buf.set(x, y, c, 255);
    }
  }
  // diagonal glint across the upper-left field
  for (let k = 0; k < 6; k++) { buf.set(5 + k, 14 - k, 0xffffff, 255); buf.blend(6 + k, 14 - k, 0xffffff, 140); }
  sparkle(buf, 4, 4, 0xffffff, 2, 255);
}

function crack(buf: PixelBuffer) {
  const r = rng(907);
  const cx = 48, cy = 24;
  // molten crater: dark rim, glowing basin
  for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
    const d = Math.hypot((x + 0.5 - cx) / 9, (y + 0.5 - cy) / 4.5);
    if (d > 1) continue;
    buf.blend(x, y, d > 0.75 ? 0x2a1810 : d > 0.45 ? 0xc05a10 : d > 0.2 ? 0xffa830 : 0xfff0c8, d > 0.75 ? 230 : 255);
  }
  const rays = 11;
  for (let k = 0; k < rays; k++) {
    const a = (k / rays) * Math.PI * 2 + (r() - 0.5) * 0.35;
    const len = 30 + r() * 16;
    let px = cx + Math.cos(a) * 7, py = cy + Math.sin(a) * 3.5;
    const segs = 5;
    for (let s = 1; s <= segs; s++) {
      const t = s / segs;
      const ja = a + (r() - 0.5) * 0.5;
      const nx = cx + Math.cos(ja) * len * t, ny = cy + Math.sin(ja) * len * t * 0.5;
      line(buf, px, py, nx, ny, 0x2a1810, 255, t < 0.6 ? 1 : 0);
      line(buf, px, py, nx, ny, t < 0.45 ? 0xffd070 : 0xe07a20, 255, 0);
      // a short branch now and then
      if (s === 3 && r() < 0.6) {
        const ba = ja + (r() < 0.5 ? -0.7 : 0.7);
        const bx = nx + Math.cos(ba) * 7, by = ny + Math.sin(ba) * 3.5;
        line(buf, nx, ny, bx, by, 0x2a1810, 230, 0);
        line(buf, nx, ny, (nx + bx) / 2, (ny + by) / 2, 0xc05a10, 255, 0);
      }
      px = nx; py = ny;
    }
  }
}

export const SPECS: FxSpec[] = [
  { key: 'fx:vanguard:wave', w: 32, h: 32, frames: 4, durations: [60, 60, 60, 60], loop: true, draw: (b, i) => wave(b, i) },
  { key: 'fx:vanguard:shield', w: 24, h: 28, frames: 1, durations: [100], loop: false, anim: false, draw: (b) => shield(b) },
  { key: 'fx:vanguard:crack', w: 96, h: 48, frames: 1, durations: [100], loop: false, anim: false, draw: (b) => crack(b) },
];
