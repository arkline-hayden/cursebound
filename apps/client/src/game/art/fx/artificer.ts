import { MATERIALS } from '../palette';
import { Painter, PixelBuffer, hash2, rng, sparkle } from '../draw/pixel';
import { glow, jag, line, ring, type FxSpec } from '../fxPrims';

// Artificer effect sheets (bolts, turrets, drone, ordnance, explosions, steam). Framework-free pixel art; keys use the
// fx:artificer:* prefix. Projectiles point east (+x). Directional turret sheets hold 8 frames, one per world direction
// (frame k = world angle k * 45 degrees), and are picked by frame at runtime (anim: false).

const BRASS = MATERIALS.brass;
const IRON = MATERIALS.iron;
const STEEL = MATERIALS.steel;
const COPPER = [0x38150b, 0x6c2b15, 0xa44925, 0xd0773d, 0xeea667] as const;
const TEAL = MATERIALS.teal;
const CYAN = MATERIALS.cyan;
const FLAME = MATERIALS.flame;
const YELLOW = MATERIALS.yellow;
const STEAM = [0x5a7a80, 0x9ec0c4, 0xdcefef, 0xffffff] as const;
const SMOKE = [0x1a1618, 0x2e2828, 0x4a4240, 0x6e6460] as const;
const OUT = 0x1a1030;

/** Screen vector (unit-ish, iso foreshortened) for world direction frame k (k * 45 degrees). */
function dirVec(k: number): [number, number] {
  const a = (k * Math.PI) / 4;
  const c = Math.cos(a), s = Math.sin(a);
  const sx = c - s, sy = (c + s) / 2;
  const l = Math.hypot(sx, sy * 2) || 1;   // keep the barrel length readable: normalise on the unsquashed axis
  return [sx / l, sy / l];
}

/** Shadow + tripod legs + pivot ring shared by the turret family; (cx, gy) is the ground point. */
function tripod(p: Painter, b: PixelBuffer, cx: number, gy: number, top: number) {
  for (let y = -3; y <= 3; y++) for (let x = -9; x <= 9; x++) if ((x / 9) ** 2 + (y / 3) ** 2 <= 1) b.blend(cx + x, gy + y, 0x000000, 90);
  p.line(cx, top, cx - 7, gy).line(cx, top, cx + 7, gy).line(cx, top, cx, gy + 1).fill(IRON, { mode: 'flat', tone: 3 });
  p.rect(cx - 8, gy - 1, 2, 2).rect(cx + 7, gy - 1, 2, 2).rect(cx - 1, gy, 2, 2).fill(BRASS, { mode: 'flat', tone: 2 });
  p.ellipse(cx, top, 5, 2.2).fill(BRASS, { mode: 'cyl' });
}

function blob(b: PixelBuffer, cx: number, cy: number, R: number, seed: number, paint: (d: number, x: number, y: number) => [number, number] | null) {
  for (let y = Math.floor(cy - R - 2); y <= Math.ceil(cy + R + 2); y++) for (let x = Math.floor(cx - R - 2); x <= Math.ceil(cx + R + 2); x++) {
    const a = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
    const bin = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 12);
    const rr = R * (0.82 + 0.22 * hash2(bin, seed, 3));
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / rr;
    if (d > 1) continue;
    const v = paint(d, x, y);
    if (v) b.blend(x, y, v[0], v[1]);
  }
}

function turretSheet(key: string, head: (p: Painter, b: PixelBuffer, cx: number, cy: number, k: number, behind: boolean) => void): FxSpec {
  return {
    key, w: 28, h: 30, frames: 8, durations: [100, 100, 100, 100, 100, 100, 100, 100], loop: false, anim: false,
    draw: (b, k) => {
      const p = new Painter(b);
      tripod(p, b, 14, 26, 18);
      const [, vy] = dirVec(k);
      const behind = vy < -0.05;
      if (behind) head(p, b, 14, 13, k, true);
      head(p, b, 14, 13, k, false);
      p.finish(OUT, 1);
    },
  };
}

export const SPECS: FxSpec[] = [
  // ---- Repeater bolt: brass shaft, steel head, teal fletching ----
  {
    key: 'fx:artificer:bolt', w: 16, h: 7, frames: 2, durations: [60, 60], loop: true,
    draw: (b, i) => {
      const p = new Painter(b);
      p.rect(3, 3, 9, 1).fill(BRASS, { mode: 'flat', tone: 3 });
      p.poly([11, 1.2, 15.5, 3.5, 11, 5.8]).fill(STEEL, { mode: 'facet', facets: 3, light: 0.2 });
      p.poly([0, 1, 4, 3, 0, 3]).poly([0, 4, 4, 4, 0, 6]).fill(TEAL, { mode: 'flat', tone: 2 });
      p.finish(OUT, 1);
      b.set(3, 4, BRASS[1]!);
      b.set(i ? 13 : 12, 3, 0xffffff);
    },
  },
  // ---- Turret slug: a teal energy round with a white core ----
  {
    key: 'fx:artificer:tbolt', w: 14, h: 7, frames: 2, durations: [50, 50], loop: true,
    draw: (b, i) => {
      for (let x = 0; x < 8; x++) b.blend(x, 3, TEAL[2]!, Math.round(40 + x * 22));
      glow(b, 9, 3.5, 4.5 + i * 0.4, TEAL[2]!, 230, 2.4);
      line(b, 6, 3, 12, 3, 0xffffff, 255, 0);
      b.set(13, 3, CYAN[3]!);
    },
  },
  // ---- Turrets (8 directions) ----
  turretSheet('fx:artificer:turret', (p, _b, cx, cy, k, behind) => {
    const [vx, vy] = dirVec(k);
    const bx = cx + vx * 12, by = cy + vy * 12;
    if (behind) { p.capsule(cx, cy, bx, by, 1.9, 1.5).fill(IRON, { mode: 'cyl' }); p.circle(bx, by, 1.6).fill(BRASS, { mode: 'flat', tone: 3 }); return; }
    p.circle(cx, cy, 5.2).fill(BRASS, { mode: 'sphere', light: 0.05 });
    p.rect(cx - 5, cy + 1, 10, 2).fill(BRASS, { mode: 'flat', tone: 1 });
    if (vy >= -0.05) { p.capsule(cx, cy, bx, by, 1.9, 1.5).fill(IRON, { mode: 'cyl' }); p.circle(bx, by, 1.7).fill(BRASS, { mode: 'flat', tone: 3 }); }
    p.circle(cx + vx * 2.5, cy - 1 + vy * 1.5, 1.5).fill(TEAL, { mode: 'flat', tone: 3, glow: TEAL[3]! });
    p.px(cx - 3, cy - 3, BRASS[4]!);
  }),
  turretSheet('fx:artificer:flamer', (p, _b, cx, cy, k, behind) => {
    const [vx, vy] = dirVec(k);
    const bx = cx + vx * 11, by = cy + vy * 11;
    const nozzle = () => {
      p.capsule(cx + vx * 3, cy + vy * 3, bx, by, 2.2, 1.6).fill(COPPER, { mode: 'cyl' });
      p.circle(bx, by, 1.8).fill(IRON, { mode: 'flat', tone: 3 });
      p.gpx(bx + vx, by + vy, FLAME[3]!, FLAME[2]!);
    };
    if (behind) { nozzle(); return; }
    p.rect(cx - 5, cy - 6, 10, 10).fill(COPPER, { mode: 'cyl' });
    p.ellipse(cx, cy - 6, 5, 2).fill(COPPER, { mode: 'sphere', light: 0.2 });
    p.rect(cx - 5, cy - 3, 10, 1).rect(cx - 5, cy + 1, 10, 1).fill(BRASS, { mode: 'flat', tone: 3 });
    if (vy >= -0.05) nozzle();
    p.gpx(cx - 2, cy - 1, FLAME[2]!, FLAME[1]!);
  }),
  // ---- Tesla coil: copper windings under a crackling glass orb ----
  {
    key: 'fx:artificer:tesla', w: 26, h: 42, frames: 4, durations: [70, 70, 70, 70], loop: true,
    draw: (b, i) => {
      const p = new Painter(b);
      tripod(p, b, 13, 38, 31);
      p.rect(11, 12, 4, 20).fill(IRON, { mode: 'cyl' });
      for (let k = 0; k < 4; k++) p.ellipse(13, 29 - k * 4.5, 5 - k * 0.5, 1.8).fill(COPPER, { mode: 'cyl' });
      p.ellipse(13, 12, 4, 1.5).fill(BRASS, { mode: 'cyl' });
      p.finish(OUT, 1);
      glow(b, 13, 8, 7 + (i % 2), CYAN[2]!, 150);
      const q = new Painter(b);
      q.circle(13, 8, 3.8).fill(MATERIALS.glassCyan, { mode: 'sphere', glow: CYAN[3]!, light: 0.25 });
      q.finish(CYAN[0]!, 1);
      const r = rng(41 + i * 7);
      for (let k = 0; k < 2; k++) {
        const a = r() * Math.PI * 2;
        jag(b, 13, 8, 13 + Math.cos(a) * 9, 8 + Math.sin(a) * 5, 90 + i * 3 + k, CYAN[2]!, 0xffffff, 3);
      }
      // a spark crawling up the windings
      const cy = 30 - ((i * 4) % 16);
      sparkle(b, 13 + (i % 2 ? 4 : -4), cy, CYAN[3]!, 1, 230);
    },
  },
  // ---- Clockwork drone: brass body, teal eye, spinning rotor ----
  {
    key: 'fx:artificer:drone', w: 20, h: 18, frames: 4, durations: [40, 40, 40, 40], loop: true,
    draw: (b, i) => {
      const wdt = [8, 5, 1, 5][i]!;
      for (let x = -wdt; x <= wdt; x++) b.blend(10 + x, 3, STEEL[3]!, Math.abs(x) === wdt ? 255 : 150);
      b.blend(10 - wdt, 2, STEEL[2]!, 140); b.blend(10 + wdt, 4, STEEL[2]!, 140);
      const p = new Painter(b);
      p.rect(9, 3, 2, 3).fill(IRON, { mode: 'flat', tone: 3 });
      p.circle(10, 10, 4.6).fill(BRASS, { mode: 'sphere', light: 0.1 });
      p.rect(5, 10, 10, 1).fill(BRASS, { mode: 'flat', tone: 1 });
      p.line(7, 14, 6, 17).line(13, 14, 14, 17).fill(IRON, { mode: 'flat', tone: 3 });
      p.finish(OUT, 1);
      b.set(11, 9, TEAL[3]!); b.set(12, 9, 0xffffff); b.set(11, 10, TEAL[2]!);
      b.set(8, 8, BRASS[4]!);
    },
  },
  // ---- Ordnance ----
  {
    key: 'fx:artificer:grenade', w: 10, h: 10, frames: 1, durations: [100], loop: false, anim: false,
    draw: (b) => {
      const p = new Painter(b);
      p.circle(5, 5.5, 3.4).fill(BRASS, { mode: 'sphere' });
      p.rect(2, 5, 7, 1).fill(IRON, { mode: 'flat', tone: 2 });
      p.rect(4, 1, 2, 2).fill(IRON, { mode: 'flat', tone: 3 });
      p.finish(OUT, 1);
      b.set(5, 0, 0xffffff); b.set(4, 0, FLAME[3]!);
    },
  },
  {
    key: 'fx:artificer:cluster', w: 10, h: 10, frames: 1, durations: [100], loop: false, anim: false,
    draw: (b) => {
      const p = new Painter(b);
      p.circle(5, 5.5, 3.6).fill(YELLOW, { mode: 'sphere' });
      p.finish(OUT, 1);
      for (let k = 0; k < 3; k++) { b.set(3 + k * 2, 4 + (k % 2) * 2, FLAME[1]!); b.set(3 + k * 2, 5 + (k % 2) * 2, FLAME[0]!); }
      b.set(5, 1, 0xffffff);
    },
  },
  {
    key: 'fx:artificer:firebomb', w: 10, h: 12, frames: 1, durations: [100], loop: false, anim: false,
    draw: (b) => {
      const p = new Painter(b);
      p.circle(5, 7.5, 3.6).fill(MATERIALS.glassCyan, { mode: 'sphere', light: 0.2, alpha: 200 });
      p.ellipse(5, 8.6, 3, 2.2).fill(FLAME, { mode: 'sphere', glow: FLAME[3]! });
      p.rect(4, 2, 2, 3).fill(MATERIALS.leather, { mode: 'flat', tone: 2 });
      p.finish(OUT, 1);
      b.set(5, 1, FLAME[3]!); b.set(4, 0, FLAME[2]!); b.set(6, 1, 0xffffff);
    },
  },
  {
    key: 'fx:artificer:heavy', w: 14, h: 14, frames: 1, durations: [100], loop: false, anim: false,
    draw: (b) => {
      const p = new Painter(b);
      p.circle(7, 7.5, 5.4).fill(IRON, { mode: 'sphere', light: 0.25 });
      p.rect(1.5, 7, 11, 2).fill(BRASS, { mode: 'flat', tone: 3 });
      p.rect(5.5, 1, 3, 2).fill(BRASS, { mode: 'flat', tone: 2 });
      p.finish(OUT, 1);
      b.set(6, 4, FLAME[1]!); b.set(7, 4, FLAME[1]!); b.set(8, 4, FLAME[1]!);
      b.set(7, 0, 0xffffff); b.set(6, 0, FLAME[3]!);
    },
  },
  {
    key: 'fx:artificer:bomblet', w: 7, h: 7, frames: 2, durations: [50, 50], loop: true,
    draw: (b, i) => {
      const p = new Painter(b);
      p.circle(3.5, 3.5, 2.4).fill(YELLOW, { mode: 'sphere' });
      p.finish(OUT, 1);
      b.set(3, 2, i ? 0xff2a1a : FLAME[0]!);
      if (i) b.blend(3, 1, 0xff8a6a, 200);
    },
  },
  // ---- falling mortar shell (nose down) with a friction-hot exhaust ----
  {
    key: 'fx:artificer:shell', w: 10, h: 22, frames: 2, durations: [50, 50], loop: true,
    draw: (b, i) => {
      const L = i ? 8 : 6;
      for (let k = 0; k < L; k++) { b.blend(5, 7 - k, k < 2 ? 0xffffff : FLAME[3 - Math.min(2, k >> 1)]!, 255 - k * 26); b.blend(4 + (k % 2), 6 - k, FLAME[1]!, 150 - k * 15); }
      const p = new Painter(b);
      p.poly([2, 8, 5, 10, 8, 8, 8, 11, 2, 11]).fill(IRON, { mode: 'flat', tone: 2 });
      p.capsule(5, 10, 5, 17, 2.6, 2.6).fill(IRON, { mode: 'cyl' });
      p.poly([2.6, 17, 7.4, 17, 5, 21]).fill(BRASS, { mode: 'facet', facets: 3 });
      p.finish(OUT, 1);
      b.set(5, 15, FLAME[1]!); b.set(4, 13, IRON[4]!);
    },
  },
  {
    key: 'fx:artificer:mine', w: 16, h: 10, frames: 2, durations: [100, 100], loop: false, anim: false,
    draw: (b, i) => {
      const p = new Painter(b);
      p.ellipse(8, 6, 6.6, 3.2).fill(IRON, { mode: 'sphere', light: 0.15 });
      p.ellipse(8, 5, 3, 1.6).fill(BRASS, { mode: 'sphere' });
      p.finish(OUT, 1);
      for (const x of [3, 13]) b.set(x, 6, BRASS[3]!);
      if (i) { b.set(8, 4, 0xff2a1a); b.set(8, 3, 0xffb0a0); b.blend(7, 4, 0xff2a1a, 160); b.blend(9, 4, 0xff2a1a, 160); }
      else b.set(8, 4, 0x6a1010);
    },
  },
  // ---- explosion: banded fireball that breaks into smoke and embers ----
  {
    key: 'fx:artificer:boom', w: 48, h: 48, frames: 7, durations: [35, 45, 55, 65, 75, 90, 110], loop: false,
    draw: (b, i) => {
      const cx = 24, cy = 27;
      if (i === 0) {
        glow(b, cx, cy, 9, YELLOW[2]!, 255);
        ring(b, cx, cy, 12, 9, 1.2, FLAME[2]!, 230, 0xffffff);
        return;
      }
      if (i <= 3) {
        const R = [0, 13, 17, 19][i]!;
        const lift = i * 1.5;
        if (i >= 2) blob(b, cx, cy - R * 0.55 - lift, R * 0.7, 30 + i, (d) => [d > 0.7 ? SMOKE[1]! : SMOKE[2]!, 220]);
        blob(b, cx, cy - lift * 0.5, R, 10 + i, (d, x, y) => {
          const n = (hash2(x, y, i) - 0.5) * 0.12;
          const e = d + n + (i - 1) * 0.16;
          if (e < 0.28) return [0xffffff, 255];
          if (e < 0.5) return [YELLOW[3]!, 255];
          if (e < 0.72) return [FLAME[2]!, 255];
          if (e < 0.92) return [FLAME[1]!, 255];
          return [FLAME[0]!, 240];
        });
        const r = rng(100 + i);
        for (let k = 0; k < 6 + i * 2; k++) {
          const a = r() * Math.PI * 2, rr = R * (1 + r() * 0.35);
          sparkle(b, Math.round(cx + Math.cos(a) * rr), Math.round(cy - lift + Math.sin(a) * rr * 0.8), FLAME[3]!, r() < 0.3 ? 1 : 0, 240);
        }
        return;
      }
      // smoke phase
      const r = rng(200 + i);
      const fade = [0, 0, 0, 0, 235, 190, 120][i]!;
      const n = i === 4 ? 4 : 6;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + r() * 0.6;
        const spread = (i - 3) * 5;
        const px = cx + Math.cos(a) * spread, py = cy - 6 - (i - 3) * 2 + Math.sin(a) * spread * 0.7;
        const R = 9 - (i - 4) * 1.6 + r() * 2;
        blob(b, px, py, R, 300 + i * 10 + k, (d) => [d < 0.4 && i === 4 ? FLAME[1]! : d < 0.6 ? SMOKE[3]! : d < 0.85 ? SMOKE[2]! : SMOKE[1]!, fade]);
      }
      for (let k = 0; k < 8; k++) b.blend(Math.round(cx + (r() - 0.5) * 36), Math.round(cy - 8 + (r() - 0.5) * 30), FLAME[3]!, fade);
    },
  },
  // ---- steam burst: a ring of white puffs rolling outward ----
  {
    key: 'fx:artificer:steamboom', w: 48, h: 40, frames: 6, durations: [40, 55, 65, 75, 90, 110], loop: false,
    draw: (b, i) => {
      const cx = 24, cy = 22;
      if (i === 0) { glow(b, cx, cy, 10, STEAM[2], 255, 7); return; }
      const fade = [0, 255, 245, 220, 170, 100][i]!;
      const R = 5 + i * 3.4;
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + i * 0.1;
        const pr = 6.5 - i * 0.5 + (k % 3);
        blob(b, cx + Math.cos(a) * R, cy + Math.sin(a) * R * 0.6, pr, 50 + k + i * 9, (d, x, y) => {
          const lit = (y < cy + Math.sin(a) * R * 0.6 - pr * 0.2) || x < cx + Math.cos(a) * R - pr * 0.3;
          return [d > 0.82 ? STEAM[0] : lit ? STEAM[3] : d > 0.55 ? STEAM[1] : STEAM[2], fade];
        });
      }
      if (i <= 2) glow(b, cx, cy, 6 - i * 1.5, TEAL[3]!, 200, 4);
    },
  },
  // ---- flame jet: a roaring cone of fire pointing east from its nozzle at (0, 14) ----
  {
    key: 'fx:artificer:flamejet', w: 64, h: 28, frames: 6, durations: [40, 45, 50, 55, 70, 90], loop: false,
    draw: (b, i) => {
      const L = [24, 42, 62, 63, 62, 60][i]!;
      const broken = i >= 4 ? (i === 4 ? 0.28 : 0.55) : 0;
      for (let x = 0; x < L; x++) {
        const t = x / 63;
        const hw = Math.min(13, 1.5 + x * 0.21) * (0.85 + 0.3 * hash2(x >> 2, i, 7));
        for (let y = 0; y < 28; y++) {
          const d = Math.abs(y + 0.5 - 14) / hw;
          if (d > 1 || x > L - 1 - d * 9 - hash2(y, i, 9) * 5) continue;
          if (broken && hash2(x >> 1, y >> 1, i + 20) < broken + t * 0.3) continue;
          const tip = x / L;
          const e = d * 0.75 + tip * 0.55 + (i >= 4 ? 0.2 : 0);
          let c: number, a = 255;
          if (e < 0.32 && t < 0.5) c = 0xffffff;
          else if (e < 0.55) c = YELLOW[3]!;
          else if (e < 0.78) c = FLAME[2]!;
          else if (e < 0.98) c = FLAME[1]!;
          else if (e < 1.12) { c = FLAME[0]!; a = 230; }
          else { c = SMOKE[2]!; a = 170; }
          b.blend(x, y, c, a);
        }
      }
      const r = rng(60 + i);
      for (let k = 0; k < 5; k++) sparkle(b, Math.round(L * 0.5 + r() * L * 0.5), Math.round(14 + (r() - 0.5) * 22), YELLOW[3]!, 0, 230);
    },
  },
  // ---- deployment cog: a turning brass gear ring laid flat on the ground ----
  {
    key: 'fx:artificer:cog', w: 48, h: 26, frames: 4, durations: [60, 60, 60, 60], loop: true,
    draw: (b, i) => {
      const cx = 24, cy = 13;
      ring(b, cx, cy, 17, 8.5, 1.6, BRASS[2]!, 255, BRASS[3]!);
      ring(b, cx, cy, 10, 5, 0.9, BRASS[1]!, 230, BRASS[2]!);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + i * (Math.PI / 24);
        const x = cx + Math.cos(a) * 20, y = cy + Math.sin(a) * 10;
        for (let oy = -1; oy <= 0; oy++) for (let ox = -1; ox <= 1; ox++) b.blend(Math.round(x + ox), Math.round(y + oy), oy ? BRASS[3]! : BRASS[2]!, 255);
      }
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 - i * (Math.PI / 24);
        line(b, cx + Math.cos(a) * 10, cy + Math.sin(a) * 5, cx + Math.cos(a) * 16, cy + Math.sin(a) * 8, BRASS[1]!, 230, 0);
      }
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + i * 0.26;
        b.blend(Math.round(cx + Math.cos(a) * 13.5), Math.round(cy + Math.sin(a) * 6.8), TEAL[3]!, 255);
      }
    },
  },
  // ---- steam puff: billows up and thins out ----
  {
    key: 'fx:artificer:puff', w: 18, h: 18, frames: 5, durations: [60, 80, 100, 120, 140], loop: false,
    draw: (b, i) => {
      const R = 3.5 + i * 1.2;
      const fade = [255, 240, 200, 140, 80][i]!;
      blob(b, 9, 10 - i * 0.6, R, 70 + i, (d, x, y) => {
        if (i >= 3 && hash2(x, y, i) < 0.15 * (i - 2)) return null;
        const lit = x + y < 18 - i;
        return [d > 0.8 ? STEAM[0] : lit ? STEAM[3] : d > 0.5 ? STEAM[1] : STEAM[2], fade];
      });
    },
  },
  // ---- shrapnel / gear shard (tintable, white) for blasts ----
  {
    key: 'fx:artificer:sprocket', w: 9, h: 9, frames: 1, durations: [100], loop: false, anim: false,
    draw: (b) => {
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; b.set(Math.round(4 + Math.cos(a) * 3.6), Math.round(4 + Math.sin(a) * 3.6), 0xffffff); }
      ring(b, 4.5, 4.5, 2.6, 2.6, 0.8, 0xd0d0d0, 255, 0xffffff);
      b.set(4, 4, 0x808080);
    },
  },
];
