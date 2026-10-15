import { glow, jag, ring, type FxSpec } from '../fxPrims';
import { PixelBuffer, hash2, rng, sparkle } from '../draw/pixel';

// Arcanist effect sheets (projectiles, hazard bodies, signature shapes). Framework-free pixel art with hard bands;
// keys use the fx:arcanist:* prefix. Projectiles point east (+x); ground pieces are drawn on the 2:1 ground plane.
// Branch palettes: ember (molten reds, oranges, gold, white-hot), storm (indigo, electric violet-blue, white),
// rift (void, astral violet, lilac, violet-white).

const EMB = [0x5a1006, 0xc0300f, 0xff7a1a, 0xffc24a, 0xfff4d0] as const;   // deep -> white-hot
const STM = [0x2a1e7a, 0x6a5aff, 0x9fb8ff, 0xd8e6ff, 0xffffff] as const;
const AST = [0x14061f, 0x5a2aa0, 0xb07aff, 0xd7a8ff, 0xf6eeff] as const;

/** Pick a band colour from a 5-tone ramp for an intensity 0..1 (null below the cut). */
function bandOf(ramp: readonly number[], v: number, cut = 0.12): number | null {
  if (v <= cut) return null;
  if (v > 0.82) return ramp[4]!;
  if (v > 0.62) return ramp[3]!;
  if (v > 0.4) return ramp[2]!;
  if (v > 0.22) return ramp[1]!;
  return ramp[0]!;
}

/** Comet / bolt body: a hot head at (hx, hy) with a tail that tapers west, banded through `ramp`. */
function comet(b: PixelBuffer, hx: number, hy: number, headR: number, tailLen: number, tailW: number, ramp: readonly number[], seed: number, wobble: number) {
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const cx = x + 0.5, cy = y + 0.5;
    const dh = Math.hypot(cx - hx, (cy - hy) * 1.1) / headR;
    let v = 1 - dh;
    const t = (cx - (hx - tailLen)) / tailLen;   // 0 at the tail end, 1 at the head
    if (t > 0 && t < 1.05) {
      const w = 0.5 + tailW * Math.pow(Math.min(1, t), 1.4);
      const off = Math.sin(cx * 0.9 + seed * 2.1) * wobble * (1 - t);
      const dv = Math.abs(cy - hy - off) / w;
      const tv = (1 - dv) * Math.pow(Math.min(1, t), 0.8) * 0.92;
      if (tv > v) v = tv;
    }
    const n = hash2(x, y, seed) * 0.16 - 0.08;
    const c = bandOf(ramp, v + n);
    if (c !== null) b.blend(x, y, c, v + n > 0.22 ? 255 : 170);
  }
}

export const SPECS: FxSpec[] = [
  // ---------------- projectiles ----------------
  {
    // Spark: a molten ember comet, white-hot head and a flickering red-orange tail
    key: 'fx:arcanist:spark', w: 18, h: 10, frames: 3, durations: [55, 55, 55], loop: true,
    draw: (b, i) => {
      comet(b, 13, 5, 3.3, 12, 2.6, EMB, i + 1, 0.9);
      const r = rng(70 + i);
      for (let k = 0; k < 3; k++) b.blend(Math.floor(r() * 6), 2 + Math.floor(r() * 6), k ? EMB[2] : EMB[3], 220);
      b.blend(14, 4, 0xffffff, 255);
    },
  },
  {
    // Riftwalker shard: a faceted astral dart with a lilac glint that travels along it
    key: 'fx:arcanist:shard', w: 16, h: 8, frames: 2, durations: [70, 70], loop: true,
    draw: (b, i) => {
      for (let x = 0; x < 5; x++) b.blend(x, 4, AST[2], 60 + x * 30);
      for (let x = 2; x <= 14; x++) {
        const h = x < 10 ? ((x - 2) / 8) * 2.6 : ((14.5 - x) / 4.5) * 2.6;
        for (let y = 0; y < 8; y++) {
          const d = y + 0.5 - 4;
          if (Math.abs(d) > h + 0.2) continue;
          const edge = Math.abs(d) > h - 0.8;
          const c = edge ? AST[1] : d < 0 ? (x > 9 ? AST[4] : AST[3]) : AST[2];
          b.blend(x, y, c, 255);
        }
      }
      for (let x = 7; x <= 14; x++) b.blend(x, 3, AST[4], 255);
      sparkle(b, i ? 11 : 7, 3, AST[3], 1, 255);
    },
  },

  // ---------------- hazard bodies ----------------
  {
    // a single tall flame tongue (fireline / flame wall / pyroclasm eruptions); origin at the bottom centre
    key: 'fx:arcanist:flame', w: 16, h: 30, frames: 4, durations: [70, 70, 70, 70], loop: true,
    draw: (b, i) => {
      const base = 28;
      const H = 20 + ((i * 5) % 7);
      for (let y = 0; y <= H; y++) {
        const t = y / H;
        const w = (1 - Math.pow(t, 0.85)) * 5.4 + 0.4;
        const sway = Math.sin(i * 1.7 + y * 0.33) * 1.8 * t;
        for (let x = 0; x < 16; x++) {
          const dx = Math.abs(x + 0.5 - 8 - sway) / w;
          if (dx > 1) continue;
          const v = (1 - dx) * 0.75 + (1 - t) * 0.55 + hash2(x, y, i) * 0.12;
          const c = v > 1.05 ? EMB[4] : v > 0.82 ? EMB[3] : v > 0.55 ? EMB[2] : v > 0.3 ? EMB[1] : EMB[0];
          b.blend(x, base - y, c, dx > 0.85 ? 200 : 255);
        }
      }
      // a detached licking blob above the tip
      const by = base - H - 3 - (i % 2) * 2;
      glow(b, 8 + Math.sin(i * 2.3) * 2, by, 1.6, EMB[2], 230);
      // ground glow under the tongue
      for (let x = 2; x < 14; x++) b.blend(x, base + 1, EMB[1], 150);
    },
  },
  {
    // Meteor: a basalt boulder veined with magma, white-hot leading edge, roaring fire trail (points east)
    key: 'fx:arcanist:meteor', w: 30, h: 18, frames: 3, durations: [60, 60, 60], loop: true,
    draw: (b, i) => {
      comet(b, 19, 9, 6, 19, 5, EMB, i + 11, 1.8);
      // the rock: lit from the front (east, where it burns hottest), cooler basalt behind
      for (let y = 0; y < 18; y++) for (let x = 14; x < 30; x++) {
        const dx = x + 0.5 - 22, dy = (y + 0.5 - 9) * 1.08;
        const d = Math.hypot(dx, dy);
        if (d > 4.4) continue;
        const lit = dx * 0.55 - dy * 0.25 + (hash2(x, y, 7) - 0.5) * 0.9;
        let c = lit > 1.5 ? 0x9a6a4e : lit > 0.2 ? 0x6a4434 : lit > -1.2 ? 0x44282a : 0x2a181e;
        if (d > 3.6) c = dx > 1.5 ? EMB[3] : 0x1e1016;
        b.blend(x, y, c, 255);
      }
      // magma veins
      const r = rng(5 + i);
      for (let k = 0; k < 4; k++) { const a = r() * 6.28, rr = r() * 2.4; b.blend(Math.round(22 + Math.cos(a) * rr), Math.round(9 + Math.sin(a) * rr), k ? EMB[2] : EMB[3], 255); }
      // white-hot leading edge
      for (let y = 6; y <= 12; y++) b.blend(Math.round(22 + Math.sqrt(Math.max(0, 16 - (y - 9) * (y - 9) * 1.17))), y, Math.abs(y - 9) < 2 ? 0xffffff : EMB[4], 255);
    },
  },
  {
    // Ball Lightning: a violet-white core spitting electric arcs
    key: 'fx:arcanist:ball', w: 26, h: 26, frames: 4, durations: [60, 60, 60, 60], loop: true,
    draw: (b, i) => {
      glow(b, 13, 13, 11, STM[1], 70);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + i * 1.3 + hash2(k, i, 9) * 0.8;
        const L = 7 + hash2(i, k, 4) * 5;
        jag(b, 13, 13, 13 + Math.cos(a) * L, 13 + Math.sin(a) * L, 40 + k * 7 + i * 13, STM[2], 0xffffff, 3);
      }
      glow(b, 13, 13, 6.2, STM[2]);
      glow(b, 13, 13, 3.6, STM[3]);
      ring(b, 13, 13, 8.5, 8.5, 0.6, STM[1], 120 + (i % 2) * 60, STM[2]);
    },
  },
  {
    // Rift Gate mouth on the ground: a void well with violet spiral arms turning inward
    key: 'fx:arcanist:rift', w: 48, h: 26, frames: 6, durations: [80, 80, 80, 80, 80, 80], loop: true,
    draw: (b, i, n) => {
      const cx = 24, cy = 13, R = 22;
      const rot = (i / n) * Math.PI * 2;
      for (let y = 0; y < 26; y++) for (let x = 0; x < 48; x++) {
        const dx = (x + 0.5 - cx) / R, dy = (y + 0.5 - cy) / (R / 2);
        const d = Math.hypot(dx, dy);
        if (d > 1) continue;
        const a = Math.atan2(dy, dx);
        const arm = Math.sin(a * 3 - rot + d * 7);
        let c: number; let al: number;
        if (d > 0.9) { c = (Math.floor((a + rot) * 6) & 1) ? AST[3] : AST[2]; al = 255; }
        else if (arm > 0.55 && d > 0.25) { c = d < 0.5 ? AST[4] : AST[3]; al = 230; }
        else if (arm > 0.1 && d > 0.2) { c = AST[1]; al = 200; }
        else { c = AST[0]; al = d < 0.6 ? 240 : 200; }
        b.blend(x, y, c, al);
      }
      sparkle(b, Math.round(cx + Math.cos(rot) * 12), Math.round(cy + Math.sin(rot) * 5), AST[3], 1);
      sparkle(b, Math.round(cx - Math.cos(rot) * 9), Math.round(cy - Math.sin(rot) * 4), AST[4], 1);
    },
  },
  {
    // Singularity core: a black sphere with a white lensing rim, wrapped in a tilted violet accretion disk
    key: 'fx:arcanist:hole', w: 36, h: 28, frames: 4, durations: [60, 60, 60, 60], loop: true,
    draw: (b, i, n) => {
      const cx = 18, cy = 14;
      const disk = (front: boolean) => {
        for (let y = 0; y < 28; y++) for (let x = 0; x < 36; x++) {
          const dx = (x + 0.5 - cx) / 16, dy = (y + 0.5 - cy) / 5;
          const d = Math.hypot(dx, dy);
          if (d > 1 || d < 0.48) continue;
          if (front !== (y + 0.5 >= cy)) continue;
          const a = Math.atan2(dy, dx) + (i / n) * Math.PI * 2;
          const clump = Math.sin(a * 5) * 0.5 + 0.5;
          const v = (1 - Math.abs(d - 0.74) / 0.26) * 0.7 + clump * 0.35;
          const c = bandOf(AST, v, 0.18);
          if (c !== null) b.blend(x, y, c, 235);
        }
      };
      disk(false);
      for (let y = 0; y < 28; y++) for (let x = 0; x < 36; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= 5.2) b.blend(x, y, 0x000000, 255);
        else if (d <= 6.3) b.blend(x, y, (Math.floor(Math.atan2(y - cy, x - cx) * 4 + i) & 1) ? 0xffffff : AST[4], 255);
        else if (d <= 7.6) b.blend(x, y, AST[2], 90);
      }
      disk(true);
    },
  },
  {
    // Astral Nova star: four long rays and four short diagonals snapping open and burning out (one-shot)
    key: 'fx:arcanist:nova', w: 56, h: 56, frames: 5, durations: [45, 45, 55, 65, 80], loop: false,
    draw: (b, i, n) => {
      const cx = 28, cy = 28;
      const k = (i + 1) / n;
      const fade = i < 2 ? 1 : 1 - (i - 1) / (n - 0.5);
      for (let y = 0; y < 56; y++) for (let x = 0; x < 56; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const ax = Math.abs(dx), ay = Math.abs(dy);
        const L = 26 * Math.min(1, k * 1.6), Ld = 14 * Math.min(1, k * 1.6);
        const ray = Math.max(
          ax < 1.6 * (1 - ay / L) + 0.4 && ay < L ? 1 - ay / L : 0,
          ay < 1.6 * (1 - ax / L) + 0.4 && ax < L ? 1 - ax / L : 0,
          Math.abs(ax - ay) < 1.2 && ax < Ld ? (1 - ax / Ld) * 0.8 : 0,
        );
        const core = 1 - Math.hypot(dx, dy) / (6 + 6 * k);
        const v = Math.max(ray, core);
        const c = bandOf(AST, v, 0.1);
        if (c !== null) b.blend(x, y, c, Math.round(255 * fade));
      }
    },
  },
];
