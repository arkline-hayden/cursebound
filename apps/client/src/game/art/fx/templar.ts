import { fill, line, type FxSpec } from '../fxPrims';
import { outlinePass, rng, sparkle, type PixelBuffer } from '../draw/pixel';

// Templar effect sheets (projectiles, signature shapes). Framework-free pixel art; keys use the fx:templar:* prefix.
// Palette: radiant gold, white-gold light and warding blue. Hard bands only.

const OUT = 0x1c1008;
const GOLD_D = 0x8a5a14;
const GOLD = 0xe0a830;
const GOLD_L = 0xffd76a;
const HOLY = 0xfff1a8;
const WHITE = 0xffffff;
const STEEL_D = 0x4a5068;
const STEEL = 0x8890ac;
const STEEL_L = 0xc8d0e4;
const WOOD = 0x6e4426;
const WARD = 0xa8dcff;
const WARD_D = 0x3a78c8;

/** Thrown warhammer (spun at runtime): a gold-banded steel head with a glowing rune on a gilded haft. */
function drawHammer(b: PixelBuffer) {
  // haft: diagonal
  line(b, 4, 17, 11, 8, WOOD, 255, 1);
  line(b, 4, 16, 11, 7, 0x9a6438, 255, 0);
  b.blend(3, 18, GOLD, 255); b.blend(4, 18, GOLD_L, 255); b.blend(3, 17, GOLD_L, 255);
  b.blend(7, 13, GOLD, 255); b.blend(8, 12, GOLD, 255);
  // head: a block perpendicular to the haft, centred near (12.5, 6.5)
  fill(b, (x, y) => {
    const dx = x + 0.5 - 12.5, dy = y + 0.5 - 6.5;
    const u = dx * 0.6 + dy * 0.8;     // across the head (perpendicular to the haft)
    const v = dx * 0.8 - dy * 0.6;     // along the haft
    if (Math.abs(u) > 5.6 || Math.abs(v) > 3.2) return null;
    if (Math.abs(u) > 4.4) return [Math.abs(v) < 2.2 ? STEEL_L : STEEL, 255];   // striking faces
    if (Math.abs(u) > 3.4) return [GOLD_L, 255];                                 // gold bands
    if (Math.abs(u) < 1.3 && Math.abs(v) < 1.3) return [HOLY, 255];              // rune core
    return [v > 1.2 ? STEEL_D : STEEL, 255];
  });
  outlinePass(b, OUT, 255);
  b.blend(12, 6, WHITE, 255);
  sparkle(b, 16, 2, HOLY, 1, 255);
}

/** Beacon bolt (east-facing): a white lance head with gold flanks and a flickering tail. */
function drawBolt(b: PixelBuffer, i: number) {
  const cy = (b.h - 1) / 2;
  fill(b, (x, y) => {
    const t = x / (b.w - 1);                  // 0 tail .. 1 tip
    const half = t < 0.7 ? t * 4 * (0.8 + (i ? 0.2 : 0)) / 0.7 * 0.6 : (1 - t) / 0.3 * 2.4;
    const d = Math.abs(y - cy);
    if (d > half + 0.3) return null;
    const k = d / Math.max(0.5, half);
    if (k < 0.35) return [WHITE, 255];
    if (k < 0.7) return [HOLY, 255];
    return [GOLD_L, t < 0.3 ? 140 : 230];
  });
  sparkle(b, b.w - 4, Math.round(cy), WHITE, 1, 255);
  if (i) { b.blend(1, Math.round(cy) - 2, GOLD_L, 200); b.blend(3, Math.round(cy) + 2, HOLY, 200); }
}

/** A column of light crashing down (origin at the bottom centre): white core, banded gold edges, a ground flare. */
function drawPillar(b: PixelBuffer, i: number, n: number) {
  const cx = (b.w - 1) / 2;
  const widths = [0.18, 1, 0.92, 0.7, 0.45, 0.22];
  const hw = (b.w / 2 - 1) * (widths[i] ?? 0.2) * 0.72;
  const reach = i === 0 ? 0.5 : 1;      // first frame: the beam is still falling
  const fade = i >= n - 2 ? 0.7 : 1;
  fill(b, (x, y) => {
    const fy = y / (b.h - 1);
    if (fy < 1 - reach) return null;
    const flare = fy > 0.86 ? (fy - 0.86) / 0.14 : 0;
    const w = hw * (1 + flare * 1.3) * (0.93 + 0.07 * Math.sin(y * 0.16 + i * 1.3));
    const d = Math.abs(x - cx) / Math.max(0.6, w);
    if (d > 1) return null;
    const a = Math.round(255 * fade * (fy < 0.15 ? fy / 0.15 : 1));
    if (a <= 8) return null;
    if (d < 0.3) return [WHITE, a];
    if (d < 0.6) return [HOLY, a];
    if (d < 0.85) return [GOLD_L, Math.round(a * 0.9)];
    return [GOLD, Math.round(a * 0.55)];
  });
  // light bands sliding down and drifting crosses
  if (i >= 1) {
    for (let k = 0; k < 4; k++) {
      const y = Math.round(((k * 0.25 + i * 0.07) % 1) * (b.h - 12));
      line(b, cx - hw * 1.1, y, cx + hw * 1.1, y, WHITE, Math.round(150 * fade), 0);
    }
    const r = rng(11 + i);
    for (let k = 0; k < 4; k++) {
      const x = Math.round(cx + (r() - 0.5) * b.w * 0.9), y = Math.round(b.h * (0.3 + r() * 0.6));
      b.blend(x, y, WHITE, 255); b.blend(x - 1, y, HOLY, 220); b.blend(x + 1, y, HOLY, 220);
      b.blend(x, y - 1, HOLY, 220); b.blend(x, y + 1, HOLY, 220); b.blend(x, y + 2, GOLD_L, 200);
    }
  }
}

/** Iso ground sigil (2:1): double ring, a cross along the ground axes and rune ticks that turn around the band. */
function drawSigil(b: PixelBuffer, i: number, n: number) {
  const cx = b.w / 2, cy = b.h / 2;
  const R = b.w / 2 - 1;
  const ph = (i / n) * ((Math.PI * 2) / 12);
  fill(b, (x, y) => {
    const ex = (x + 0.5 - cx) / R, ey = (y + 0.5 - cy) / (R / 2);
    const d = Math.hypot(ex, ey);
    if (d > 1) return null;
    const ang = Math.atan2(ey, ex);
    if (d > 0.93) return [GOLD_L, 255];
    if (d > 0.89) return null;
    if (d > 0.76) {
      // rune band: ticks and little crosses turning
      const s = ((ang - ph) / ((Math.PI * 2) / 12)) % 1;
      const f = (s + 1) % 1;
      if (f < 0.12 || (f > 0.45 && f < 0.55 && d > 0.8 && d < 0.86)) return [HOLY, 230];
      return null;
    }
    if (d > 0.72) return [GOLD, 230];
    if (d > 0.48 && d < 0.52) return [GOLD_L, 200];
    // the cross: thin bands along the screen axes
    if ((Math.abs(ex) < 0.02 && d < 0.72) || (Math.abs(ey) < 0.04 && d < 0.72)) return [d < 0.3 ? WHITE : HOLY, d < 0.3 ? 220 : 150];
    if (d < 0.14) return [HOLY, 200];
    return null;
  });
}

/** Holy cross flash: a tall white cross snapping open with gold rays, then thinning out. */
function drawCross(b: PixelBuffer, i: number, n: number) {
  const cx = (b.w - 1) / 2, cy = (b.h - 1) / 2 + 2;
  const s = [0.45, 1, 0.95, 0.75, 0.5][i] ?? 0.4;
  const th = [2, 3, 2.5, 1.5, 1][i] ?? 1;
  const fade = i >= n - 1 ? 0.6 : 1;
  const up = 17 * s, down = 19 * s, side = 13 * s;
  fill(b, (x, y) => {
    const dx = x - cx, dy = y - cy + 4 * s;
    const inV = Math.abs(dx) <= th && dy >= -up && dy <= down;
    const inH = Math.abs(dy) <= th && Math.abs(dx) <= side;
    if (!inV && !inH) {
      // rays between the arms
      if (i <= 2) {
        const a = Math.atan2(dy, dx), r = Math.hypot(dx, dy);
        const ray = Math.abs(Math.sin(a * 4 + Math.PI / 4)) > 0.97;
        if (ray && r > 5 && r < 16 * s) return [GOLD_L, Math.round(200 * fade)];
      }
      return null;
    }
    const core = (inV && Math.abs(dx) <= th - 1.2) || (inH && Math.abs(dy) <= th - 1.2);
    return core ? [WHITE, Math.round(255 * fade)] : [HOLY, Math.round(235 * fade)];
  });
  if (i <= 2) sparkle(b, Math.round(cx), Math.round(cy - 4 * s), WHITE, 2 + i, 255);
}

/** Radiant sun for the Beacon (loops): banded orb with turning rays. */
function drawSun(b: PixelBuffer, i: number, n: number) {
  const c = (b.w - 1) / 2;
  const ph = (i / n) * (Math.PI / 4);
  fill(b, (x, y) => {
    const dx = x - c, dy = y - c;
    const r = Math.hypot(dx, dy);
    if (r < 3) return [WHITE, 255];
    if (r < 4.5) return [HOLY, 255];
    if (r < 6) return [GOLD_L, 255];
    if (r < 7) return [GOLD, 200];
    const a = Math.atan2(dy, dx) - ph;
    const ray = Math.cos(a * 8);
    if (r < 11.5 && ray > 0.86) return [r < 9 ? HOLY : GOLD_L, r < 9 ? 230 : 160];
    if (r < 9 && ray < -0.92) return [GOLD, 150];
    return null;
  });
}

/** Angel wings (static): two fans of white-gold feathers rising from a centre point, primaries longest. */
function drawWings(b: PixelBuffer) {
  const cx = (b.w - 1) / 2, sy = 21;
  for (const side of [-1, 1]) {
    const ox = cx + side * 2;
    for (let k = 0; k < 9; k++) {
      const ang = -1.35 + k * 0.17;
      const len = 20.5 - k * 1.25;
      const tx = ox + side * Math.cos(ang) * len, ty = sy + Math.sin(ang) * len;
      line(b, ox, sy, tx, ty, k % 2 ? GOLD_L : HOLY, 255, 1);
      line(b, ox, sy, tx, ty, WHITE, 255, 0);
      b.blend(Math.round(tx), Math.round(ty), GOLD, 255);
    }
    for (let k = 0; k < 6; k++) {
      const ang = -1.1 + k * 0.26;
      const len = 7 + k * 0.6;
      line(b, ox, sy, ox + side * Math.cos(ang) * len, sy + Math.sin(ang) * len, WHITE, 255, 1);
    }
  }
  outlinePass(b, 0x7a5418, 200);
}

/** Vow shield (static): a gilded heater shield with a white field and gold cross. */
function drawShield(b: PixelBuffer) {
  fill(b, (x, y) => {
    const cx = (b.w - 1) / 2;
    const dx = Math.abs(x - cx);
    const hw = y < 7 ? 5.5 : 5.5 - (y - 7) * 0.75;
    if (y < 1 || y > 15 || dx > hw) return null;
    if (dx > hw - 1.2 || y < 2) return [GOLD_L, 255];
    if (dx < 1 || (y >= 5 && y <= 6)) return [GOLD, 255];
    return [y < 4 ? WHITE : WARD, 255];
  });
  outlinePass(b, OUT, 255);
  b.blend(4, 3, WHITE, 255);
}

/** Dome shimmer ring: a hex-lattice band on the ground plane in warding blue (loops). */
function drawWardRing(b: PixelBuffer, i: number, n: number) {
  const cx = b.w / 2, cy = b.h / 2;
  const R = b.w / 2 - 1;
  const ph = (i / n) * ((Math.PI * 2) / 16);
  fill(b, (x, y) => {
    const ex = (x + 0.5 - cx) / R, ey = (y + 0.5 - cy) / (R / 2);
    const d = Math.hypot(ex, ey);
    if (d > 1 || d < 0.8) return null;
    if (d > 0.95) return [WHITE, 230];
    const a = Math.atan2(ey, ex) - ph;
    const f = (((a / ((Math.PI * 2) / 16)) % 1) + 1) % 1;
    if (f < 0.1) return [WARD, 230];
    if (d > 0.86 && d < 0.89) return [WARD_D, 200];
    return null;
  });
}

export const SPECS: FxSpec[] = [
  { key: 'fx:templar:hammer', w: 20, h: 20, frames: 1, durations: [100], loop: false, anim: false, draw: (b) => drawHammer(b) },
  { key: 'fx:templar:bolt', w: 16, h: 9, frames: 2, durations: [60, 60], loop: true, draw: drawBolt },
  { key: 'fx:templar:pillar', w: 56, h: 192, frames: 6, durations: [30, 50, 60, 70, 90, 110], loop: false, draw: drawPillar },
  { key: 'fx:templar:sigil', w: 224, h: 112, frames: 8, durations: [90, 90, 90, 90, 90, 90, 90, 90], loop: true, draw: drawSigil },
  { key: 'fx:templar:cross', w: 40, h: 44, frames: 5, durations: [30, 50, 60, 80, 100], loop: false, draw: drawCross },
  { key: 'fx:templar:sun', w: 25, h: 25, frames: 4, durations: [90, 90, 90, 90], loop: true, draw: drawSun },
  { key: 'fx:templar:wings', w: 64, h: 32, frames: 1, durations: [100], loop: false, anim: false, draw: (b) => drawWings(b) },
  { key: 'fx:templar:shield', w: 13, h: 17, frames: 1, durations: [100], loop: false, anim: false, draw: (b) => drawShield(b) },
  { key: 'fx:templar:ward', w: 240, h: 120, frames: 6, durations: [80, 80, 80, 80, 80, 80], loop: true, draw: drawWardRing },
];
