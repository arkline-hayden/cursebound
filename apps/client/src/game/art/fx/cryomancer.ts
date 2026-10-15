import { glow, line, ring, type FxSpec } from '../fxPrims';
import { PixelBuffer, hash2, rng, sparkle } from '../draw/pixel';

// Cryomancer effect sheets (projectiles, crystals, the Effigy, the Frozen Orb, frost decals). Framework-free pixel
// art with hard bands; keys use the fx:cryomancer:* prefix, plus 'fx:frostshard' (the Ice Shard projectile the kit
// looks up first). Projectiles point east (+x); ground pieces sit on the 2:1 ground plane. Crystal sheets are static
// variant strips (anim: false, frame = variant).

const NAVY = 0x10284e;
const DEEP = 0x2a5aa8;
const FROST = 0x4ab4f0;
const ICE = 0x9fe8ff;
const PALE = 0xd8f6ff;
const WHITE = 0xffffff;
const RAMP = [NAVY, DEEP, FROST, ICE, PALE, WHITE] as const;

/**
 * A faceted ice spike standing on (bx, by), height h, half-width w, tip leaning by `lean` px. Lit from the top left:
 * left facet pale, right facet deep, a white ridge, a navy outline.
 */
function spike(b: PixelBuffer, bx: number, by: number, h: number, w: number, lean: number) {
  const tipX = bx + lean, tipY = by - h;
  for (let y = Math.floor(tipY); y <= by; y++) {
    const t = (y + 0.5 - tipY) / h;                         // 0 at the tip, 1 at the base
    if (t < 0) continue;
    const cx = tipX + (bx - tipX) * t;
    const hw = w * Math.min(1, t * 1.1) + 0.3;
    const x0 = Math.round(cx - hw), x1 = Math.round(cx + hw);
    for (let x = x0; x <= x1; x++) {
      const u = (x + 0.5 - (cx - hw)) / (2 * hw);           // 0 left .. 1 right
      let c: number;
      if (x === x0 || x === x1) c = NAVY;
      else if (Math.abs(u - 0.42) < 0.09) c = WHITE;
      else if (u < 0.42) c = t < 0.35 ? PALE : ICE;
      else c = u > 0.78 ? DEEP : FROST;
      b.blend(x, y, c, 255);
    }
  }
  b.blend(Math.round(tipX), Math.round(tipY), WHITE, 255);
}

export const SPECS: FxSpec[] = [
  // ---------------- projectiles ----------------
  {
    // Ice Shard: a faceted ice javelin with a white ridge, frost wisps off the tail and a travelling glint
    key: 'fx:frostshard', w: 18, h: 8, frames: 2, durations: [80, 80], loop: true,
    draw: (b, i) => {
      for (let x = 0; x < 6; x++) { b.blend(x, 3 + ((x + i) % 2), ICE, 50 + x * 25); if (x % 2 === i) b.blend(x, 5, PALE, 90); }
      for (let x = 3; x <= 17; x++) {
        const h = x < 12 ? ((x - 3) / 9) * 2.7 : ((17.5 - x) / 5.5) * 2.7;
        for (let y = 0; y < 8; y++) {
          const d = y + 0.5 - 4;
          if (Math.abs(d) > h + 0.25) continue;
          const edge = Math.abs(d) > h - 0.75;
          const c = edge ? (d < 0 ? FROST : DEEP) : d < 0 ? (x > 11 ? WHITE : PALE) : x > 12 ? ICE : FROST;
          b.blend(x, y, c, 255);
        }
      }
      for (let x = 8; x <= 16; x++) b.blend(x, 3, x > 13 ? WHITE : PALE, 255);
      sparkle(b, i ? 13 : 8, 3, PALE, 1, 255);
    },
  },
  {
    // Glacial Comet head: a white-cyan core with a long banded frost trail and snow glints (points east)
    key: 'fx:cryomancer:comet', w: 34, h: 18, frames: 3, durations: [55, 55, 55], loop: true,
    draw: (b, i) => {
      const hx = 26, hy = 9;
      for (let y = 0; y < 18; y++) for (let x = 0; x < 34; x++) {
        const cx = x + 0.5, cy = y + 0.5;
        let v = 1 - Math.hypot(cx - hx, cy - hy) / 5.5;
        const t = (cx - (hx - 24)) / 24;
        if (t > 0 && t < 1.05) {
          const w = 0.6 + 4.2 * Math.pow(Math.min(1, t), 1.3);
          const off = Math.sin(cx * 0.7 + i * 2.2) * 1.4 * (1 - t);
          const tv = (1 - Math.abs(cy - hy - off) / w) * Math.pow(Math.min(1, t), 0.7) * 0.9;
          if (tv > v) v = tv;
        }
        v += hash2(x, y, i + 3) * 0.14 - 0.07;
        if (v <= 0.1) continue;
        const k = Math.min(5, Math.floor(v * 6));
        b.blend(x, y, RAMP[Math.max(2, k)]!, k <= 2 ? 170 : 255);
      }
      const r = rng(30 + i);
      for (let k = 0; k < 5; k++) sparkle(b, Math.floor(r() * 18), 3 + Math.floor(r() * 12), PALE, 0, 255);
      sparkle(b, hx + 1, hy - 1, PALE, 2, 255);
    },
  },

  // ---------------- crystals (static variants) ----------------
  {
    // a lone ice spike erupting from the ground (bursts, prisons, Glacial Spike's ring); base at the bottom centre
    key: 'fx:cryomancer:spike', w: 14, h: 30, frames: 4, durations: [100, 100, 100, 100], loop: false, anim: false,
    draw: (b, i) => {
      const r = rng(11 + i * 7);
      spike(b, 7, 28, 20 + r() * 7, 3 + r() * 1.2, (r() - 0.5) * 5);
      for (let x = 3; x < 12; x++) b.blend(x, 29, PALE, 120);
    },
  },
  {
    // a cluster of two or three shards (walls, prisons, cocoon); base at the bottom centre
    key: 'fx:cryomancer:cluster', w: 20, h: 26, frames: 4, durations: [100, 100, 100, 100], loop: false, anim: false,
    draw: (b, i) => {
      const r = rng(50 + i * 13);
      const side = r() < 0.5 ? -1 : 1;
      spike(b, 10 - side * 4, 24, 9 + r() * 4, 2.4, -side * 3);
      if (i % 2) spike(b, 10 + side * 5, 24, 7 + r() * 3, 2, side * 2.5);
      spike(b, 10, 24, 15 + r() * 6, 3.2, (r() - 0.5) * 3);
      for (let x = 3; x < 17; x++) b.blend(x, 25, PALE, 110);
    },
  },
  {
    // the Glacial Spike: a towering crystal with a frosted collar (one big piece, base at the bottom centre)
    key: 'fx:cryomancer:pillar', w: 24, h: 48, frames: 1, durations: [100], loop: false, anim: false,
    draw: (b) => {
      spike(b, 6, 45, 16, 2.6, -3);
      spike(b, 18, 45, 14, 2.4, 3);
      spike(b, 12, 46, 42, 5.2, 0.5);
      for (let k = 0; k < 6; k++) sparkle(b, 9 + (k % 3) * 3, 14 + k * 5, PALE, 0, 220);
      for (let x = 1; x < 23; x++) b.blend(x, 47, PALE, x % 3 ? 140 : 220);
    },
  },

  // ---------------- bodies ----------------
  {
    // Frozen Orb: a banded ice sphere with six snowflake spokes turning around it
    key: 'fx:cryomancer:orb', w: 30, h: 30, frames: 6, durations: [55, 55, 55, 55, 55, 55], loop: true,
    draw: (b, i, n) => {
      const c = 15;
      glow(b, c, c, 13, FROST, 70);
      const rot = (i / n) * (Math.PI / 3);
      for (let k = 0; k < 6; k++) {
        const a = rot + (k * Math.PI) / 3;
        const ex = c + Math.cos(a) * 13, ey = c + Math.sin(a) * 13;
        line(b, c, c, ex, ey, ICE, 255, 0);
        // side barbs
        const mx = c + Math.cos(a) * 9, my = c + Math.sin(a) * 9;
        line(b, mx, my, mx + Math.cos(a + 0.8) * 3, my + Math.sin(a + 0.8) * 3, PALE, 255, 0);
        line(b, mx, my, mx + Math.cos(a - 0.8) * 3, my + Math.sin(a - 0.8) * 3, PALE, 255, 0);
        b.blend(Math.round(ex), Math.round(ey), WHITE, 255);
      }
      for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) {
        const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
        if (d > 6.5) continue;
        const lit = (c - x) * 0.4 + (c - y) * 0.5;
        const col = d > 5.6 ? DEEP : lit > 2.2 ? WHITE : lit > 0.6 ? PALE : lit > -1.5 ? ICE : FROST;
        b.blend(x, y, col, 255);
      }
      ring(b, c, c, 9.5, 9.5, 0.5, ICE, 90, PALE);
    },
  },
  {
    // Frost Effigy: a hooded ice maiden kneeling on a crystal plinth, cyan eyes, pulsing rime aura
    key: 'fx:cryomancer:effigy', w: 24, h: 38, frames: 4, durations: [150, 150, 150, 150], loop: true,
    draw: (b, i) => {
      const pulse = i === 1 || i === 2;
      glow(b, 12, 18, pulse ? 12 : 10.5, FROST, pulse ? 80 : 55, pulse ? 17 : 15);
      // plinth
      spike(b, 5, 36, 7, 2, -2);
      spike(b, 19, 36, 6, 2, 2);
      for (let y = 32; y < 37; y++) for (let x = 4; x < 21; x++) {
        const d = Math.hypot((x + 0.5 - 12.5) / 8, (y + 0.5 - 34.5) / 2.5);
        if (d <= 1) b.blend(x, y, d > 0.8 ? NAVY : y < 34 ? PALE : FROST, 255);
      }
      // robe (kneeling trapezoid), lit left
      for (let y = 15; y < 33; y++) {
        const t = (y - 15) / 18;
        const hw = 3 + t * 5.5;
        for (let x = Math.round(12.5 - hw); x <= Math.round(12.5 + hw); x++) {
          const u = (x + 0.5 - (12.5 - hw)) / (2 * hw);
          const edge = x === Math.round(12.5 - hw) || x === Math.round(12.5 + hw);
          const c = edge ? NAVY : u < 0.3 ? PALE : u < 0.55 ? ICE : u < 0.8 ? FROST : DEEP;
          b.blend(x, y, c, 255);
        }
      }
      // folds
      for (let y = 22; y < 32; y += 3) b.blend(10 + (y % 2), y, WHITE, 200);
      // clasped hands
      for (let x = 10; x <= 15; x++) b.blend(x, 21, WHITE, 255);
      for (let x = 11; x <= 14; x++) b.blend(x, 22, PALE, 255);
      // hood
      for (let y = 5; y < 16; y++) {
        const hw = y < 8 ? (y - 4) * 1.2 : 4.6;
        for (let x = Math.round(12.5 - hw); x <= Math.round(12.5 + hw); x++) {
          const edge = x === Math.round(12.5 - hw) || x === Math.round(12.5 + hw) || y === 5;
          b.blend(x, y, edge ? NAVY : x < 12 ? PALE : ICE, 255);
        }
      }
      // face shadow + eyes
      for (let y = 9; y < 14; y++) for (let x = y < 12 ? 10 : 11; x <= (y < 12 ? 15 : 14); x++) b.blend(x, y, NAVY, 255);
      b.blend(11, 11, pulse ? WHITE : ICE, 255); b.blend(14, 11, pulse ? WHITE : ICE, 255);
      // crown of rime
      spike(b, 12, 5, 4, 1, 0); spike(b, 9, 7, 3, 0.8, -1); spike(b, 16, 7, 3, 0.8, 1);
      const r = rng(90 + i);
      for (let k = 0; k < 4; k++) sparkle(b, 2 + Math.floor(r() * 20), 2 + Math.floor(r() * 30), PALE, 1, 210);
    },
  },

  // ---------------- ground ----------------
  {
    // frost decal: a crystalline fern of rime spreading over the ground (permafrost, Absolute Zero), ground plane
    key: 'fx:cryomancer:frost', w: 96, h: 48, frames: 1, durations: [100], loop: false, anim: false,
    draw: (b) => {
      const cx = 48, cy = 24;
      for (let y = 0; y < 48; y++) for (let x = 0; x < 96; x++) {
        const d = Math.hypot((x + 0.5 - cx) / 46, (y + 0.5 - cy) / 23);
        if (d > 1) continue;
        const n = hash2(x >> 1, y >> 1, 4);
        if (d > 0.93) { b.blend(x, y, PALE, n > 0.4 ? 170 : 90); continue; }
        b.blend(x, y, ICE, d < 0.5 ? 40 : 60);
        if (n > 0.97) b.blend(x, y, WHITE, 160);
      }
      const r = rng(77);
      const branch = (x0: number, y0: number, a: number, len: number, depth: number) => {
        let x = x0, y = y0;
        const steps = Math.round(len);
        for (let s = 0; s < steps; s++) {
          const nx = x + Math.cos(a), ny = y + Math.sin(a) * 0.5;
          if (Math.hypot((nx - cx) / 46, (ny - cy) / 23) > 0.95) return;
          b.blend(Math.round(nx), Math.round(ny), s < steps * 0.5 ? WHITE : PALE, 230);
          x = nx; y = ny;
          if (depth > 0 && s > 3 && s % 7 === 0) {
            branch(x, y, a + 0.9, len * 0.3, depth - 1);
            branch(x, y, a - 0.9, len * 0.3, depth - 1);
          }
          a += (r() - 0.5) * 0.25;
        }
      };
      for (let k = 0; k < 9; k++) branch(cx, cy, (k / 9) * Math.PI * 2 + r() * 0.4, 30 + r() * 12, 1);
      for (let k = 0; k < 14; k++) sparkle(b, 8 + Math.floor(r() * 80), 6 + Math.floor(r() * 36), PALE, 1, 220);
    },
  },
];
