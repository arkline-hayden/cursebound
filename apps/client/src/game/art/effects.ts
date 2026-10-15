/**
 * Effect textures (`fx:*`), light masks (`light:*`) and tintable particles (`pfx:*`). Framework-free. Projectiles point east (+x) so renderers rotate them.
 * Ground effects (slam, nova rings, pools, fields, portals) are drawn on the foreshortened ground plane.
 * Enemy projectiles use hot magenta/lime/orange danger tones; player effects use gold/teal/ember/cyan.
 */
import { MATERIALS, PALETTES } from './palette';
import { Painter, PixelBuffer, hash2, hsv, lighten, mix, outlinePass, rng, sparkle, type Ramp } from './draw/pixel';
import { crescent, fill, glow, jag, line, ring, type FxSpec } from './fxPrims';
import { CLASS_FX_SPECS } from './fx';
import { JUICE_SPECS } from './fxJuice';

export interface EffectSheet {
  key: string;
  frameW: number;
  frameH: number;
  frames: number;
  durations: number[];
  loop: boolean;
  /** whether generate.ts registers a Phaser animation under the same key */
  anim: boolean;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

const M = MATERIALS;

// ---------------------------------------------------------------- primitives
// ---------------------------------------------------------------- pickups

const CORK: Ramp = [0x4a2e16, 0x7a5228, 0xa87a44, 0xd2a868];
const GLASS: Ramp = [0x2a3448, 0x5a6a86, 0x9aaccc, 0xd8e6f6, 0xffffff];

/** 16x16 red health potion: round flask, cork, glass shine; frames 1..3 sweep a glint across the glass. */
function potion(b: PixelBuffer, i: number): void {
  const p = new Painter(b);
  const cx = 8;
  const cy = 10.4;
  // glass body (empty top shows as pale glass) + neck
  p.circle(cx, cy, 5.3).rect(6.4, 3.6, 3.2, 3.6).fill(GLASS, { mode: 'sphere', cx: cx - 1.5, cy: cy - 2 });
  // liquid: lower part of the bulb with a lit meniscus
  p.circle(cx, cy, 4.5).minus().rect(0, 0, 16, 8.4).fill(M.bloodRed, { mode: 'sphere', light: 0.15, glow: M.bloodRed[3]!, inner: false });
  // lip + cork
  p.rect(5.8, 3.2, 4.4, 1.2).fill(GLASS, { mode: 'flat', tone: 2, inner: false });
  p.rect(6.4, 1, 3.2, 2.6).fill(CORK, { mode: 'emboss' });
  p.finish(0x1a0a0e);
  // meniscus highlight + fixed glass shine
  for (let x = 5; x <= 10; x++) if (b.alpha(x, 8) > 0) b.blend(x, 8, M.bloodRed[4]!, 200);
  b.blend(5, 8, 0xffffff, 230);
  b.blend(5, 9, 0xffffff, 200);
  b.blend(6, 7, 0xffffff, 160);
  b.blend(7, 4, 0xffffff, 140);
  // travelling glint
  if (i > 0) {
    const off = -6 + i * 4;
    for (let y = 4; y <= 15; y++)
      for (let x = 2; x <= 14; x++) {
        const d = x + y - 16 - off;
        if (d !== 0 && d !== 1) continue;
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > 4.6 && !(x >= 7 && x <= 8 && y >= 4 && y <= 6)) continue;
        b.blend(x, y, 0xffffff, d === 0 ? 210 : 110);
      }
    if (i === 3) sparkle(b, 11, 7, 0xffd0c8, 1, 255);
  }
}

/** 16x16 glowing orb with a shine crescent, a slow swirl and a pulsing halo. */
function globe(b: PixelBuffer, i: number, ramp: Ramp, haloCol: number): void {
  const ph = (i / 4) * Math.PI * 2;
  const cx = 8;
  const cy = 8;
  // pulsing halo (drawn first, under the outline)
  const hr = 7.2 + Math.sin(ph) * 0.6;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > hr || d < 4.6) continue;
      b.blend(x, y, haloCol, Math.round((1 - (d - 4.6) / (hr - 4.6)) * (70 + Math.sin(ph) * 30)));
    }
  const orb = new PixelBuffer(16, 16);
  const p = new Painter(orb);
  p.circle(cx, cy, 4.9).fill(ramp, { mode: 'sphere', light: 0.1 + Math.sin(ph) * 0.06, glow: ramp[3]! });
  p.finish(0x10080c);
  // swirl: two bright motes orbiting inside
  for (let k = 0; k < 2; k++) {
    const a = ph + k * Math.PI;
    const x = Math.round(cx + Math.cos(a) * 2.4 - 0.5);
    const y = Math.round(cy + Math.sin(a) * 1.6 + 0.5);
    orb.blend(x, y, ramp[4] ?? 0xffffff, 200);
  }
  // shine crescent top-left
  orb.blend(6, 5, 0xffffff, 255);
  orb.blend(5, 6, 0xffffff, 220);
  orb.blend(7, 5, 0xffffff, 150);
  orb.blend(5, 7, 0xffffff, 120);
  orb.drawTo(b, 0, 0);
}

/** 64x32 white iso ground sigil under elites: double ring with 8 rune ticks that rotate; tint at runtime. */
function eliteRing(b: PixelBuffer, i: number, n: number): void {
  const cx = 32;
  const cy = 16;
  ring(b, cx, cy, 29.5, 14.75, 1.1, 0xe8e8e8, 235, 0xffffff);
  ring(b, cx, cy, 23.5, 11.75, 0.7, 0xd8d8d8, 190, 0xffffff);
  const rot = (i / n) * (Math.PI / 4);
  for (let k = 0; k < 8; k++) {
    const a = rot + (k / 8) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // rune tick between the rings: a short radial bar with a cross notch
    line(b, cx + ca * 24.6, cy + sa * 12.3, cx + ca * 28.4, cy + sa * 14.2, 0xffffff, 230, 0);
    const mx = cx + ca * 26.5;
    const my = cy + sa * 13.25;
    line(b, mx - sa * 1.6, my + ca * 0.8, mx + sa * 1.6, my - ca * 0.8, 0xffffff, 200, 0);
  }
  // faint inner fill so the sigil reads on busy floors
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 64; x++) {
      const d = Math.hypot((x + 0.5 - cx) / 23, (y + 0.5 - cy) / 11.5);
      if (d < 1) b.blend(x, y, 0xffffff, Math.round(34 * d * d));
    }
}

// ---------------------------------------------------------------- specs

const SPECS: FxSpec[] = [
  // ---------------------------------------------------------------- pickups + elite marker
  {
    key: 'fx:potion:health',
    w: 16,
    h: 16,
    frames: 4,
    durations: [520, 90, 90, 140],
    loop: true,
    draw: (b, i) => potion(b, i),
  },
  {
    key: 'fx:globe:health',
    w: 16,
    h: 16,
    frames: 4,
    durations: [140, 140, 140, 140],
    loop: true,
    draw: (b, i) => globe(b, i, M.bloodRed, 0xff5a4a),
  },
  {
    key: 'fx:globe:resource',
    w: 16,
    h: 16,
    frames: 4,
    durations: [140, 140, 140, 140],
    loop: true,
    draw: (b, i) => globe(b, i, M.soulBlue, 0x5ab4ff),
  },
  {
    key: 'fx:elite:ring',
    w: 64,
    h: 32,
    frames: 4,
    durations: [120, 120, 120, 120],
    loop: true,
    draw: (b, i, n) => eliteRing(b, i, n),
  },
  {
    key: 'fx:spark',
    w: 12,
    h: 12,
    frames: 2,
    durations: [70, 70],
    loop: true,
    draw: (b, i) => {
      // ember bolt with tail (points east)
      for (let k = 0; k < 4; k++) glow(b, 3 + k * 0.9 - i * 0.5, 6 + (k % 2 ? 0.4 : -0.4) * (i ? -1 : 1), 1.2 + k * 0.35, M.ember[1]!, 120 + k * 30);
      glow(b, 7.5, 6, 3.6, M.ember[2]!);
      b.blend(9, 5 + i, 0xffffff, 255);
    },
  },
  {
    key: 'fx:arc',
    w: 16,
    h: 16,
    frames: 2,
    durations: [60, 60],
    loop: true,
    draw: (b, i) => {
      glow(b, 8, 8, 4.5, 0xffe060);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + i * 0.6 + 0.3;
        jag(b, 8, 8, 8 + Math.cos(a) * 7.5, 8 + Math.sin(a) * 7.5, 30 + k + i * 9, 0xffe04a, 0xffffff, 3);
      }
    },
  },
  {
    key: 'fx:shard',
    w: 10,
    h: 10,
    frames: 1,
    durations: [100],
    loop: false,
    draw: (b) => {
      const p = new Painter(b);
      p.poly([9, 5, 4, 2.5, 1, 5, 4, 7.5]).fill(M.boneDry, { mode: 'facet', facets: 4, glow: M.eyeRed[2]!, light: 0.1 });
      p.finish();
    },
  },
  {
    key: 'fx:lob',
    w: 14,
    h: 14,
    frames: 1,
    durations: [100],
    loop: false,
    draw: (b) => {
      const p = new Painter(b);
      p.ellipse(7, 7, 4.6, 4.2).fill(M.bile, { mode: 'sphere', glow: M.bile[3]!, light: 0.1, dither: true });
      p.ellipse(4, 8, 1.6, 1.4).fill(M.bile, { mode: 'sphere', inner: false });
      p.finish();
      b.blend(5, 5, 0xffffff, 255);
    },
  },
  {
    key: 'fx:orb',
    w: 12,
    h: 12,
    frames: 1,
    durations: [100],
    loop: false,
    draw: (b) => {
      const p = new Painter(b);
      p.circle(6, 6, 4.4).fill(M.cultRobe, { mode: 'sphere', glow: M.hexViolet[2]!, light: 0.2 });
      p.circle(5.5, 5.5, 2.4).fill(M.hexViolet, { mode: 'sphere', inner: false, light: 0.3 });
      p.finish();
    },
  },
  {
    key: 'fx:wave',
    w: 24,
    h: 24,
    frames: 1,
    durations: [100],
    loop: false,
    draw: (b) => {
      crescent(b, 4, 12, 13, 3.2, -1.1, 1.1, M.brass[3]!, 1);
      crescent(b, 2, 12, 10, 1.6, -0.9, 0.9, M.bloodRed[3]!, 0.8);
      outlinePass(b, PALETTES.outline, 200);
    },
  },
  {
    key: 'fx:slash',
    w: 96,
    h: 96,
    frames: 5,
    durations: [35, 40, 45, 60, 80],
    loop: false,
    draw: (b, i, n) => {
      // big sweeping crescent (east-facing) with motion-smear ghosts, speed lines and a white leading edge
      const t = i / (n - 1);
      const lead = Math.min(1.75, -1.75 + t * 4.2);
      const tail = Math.max(-1.75, lead - 2.7);
      const fade = i >= 3 ? 1 - (i - 2) * 0.32 : 1;
      const th = 11 - t * 4;
      crescent(b, 38, 48, 40, th * 0.55, tail - 0.25, lead - 0.3, M.brass[1]!, fade * 0.5);
      crescent(b, 38, 48, 32, th * 0.55, tail, lead - 0.12, M.bloodRed[2]!, fade * 0.75);
      crescent(b, 38, 48, 36, th, tail + 0.3, lead, M.brass[2]!, fade);
      if (i <= 3) {
        const r = rng(9 + i);
        for (let k = 0; k < 5; k++) {
          const a = lead - 0.25 - r() * 0.5;
          const rad = 30 + r() * 12;
          const x0 = 38 + Math.cos(a) * rad;
          const y0 = 48 + Math.sin(a) * rad;
          const tx = -Math.sin(a);
          const ty = Math.cos(a);
          line(b, x0, y0, x0 - tx * (8 + r() * 8), y0 - ty * (8 + r() * 8), 0xffffff, Math.round(170 * fade), 0);
        }
        sparkle(b, Math.round(38 + Math.cos(lead) * 36), Math.round(48 + Math.sin(lead) * 36), 0xfff2c0, 3, 255);
      }
    },
  },
  {
    key: 'fx:slam',
    w: 96,
    h: 96,
    frames: 6,
    durations: [50, 60, 70, 80, 90, 110],
    loop: false,
    draw: (b, i, n) => {
      const t = (i + 1) / n;
      const rx = 8 + t * 38;
      const fade = 1 - Math.max(0, t - 0.5) * 1.6;
      // shock disk
      if (i < 2) glow(b, 48, 48, 14 + i * 6, M.gold[3]!, 200, 7 + i * 3);
      ring(b, 48, 48, rx, rx * 0.5, 3.5 - t * 1.5, M.amberGold[2]!, Math.round(255 * fade));
      ring(b, 48, 48, rx * 0.72, rx * 0.36, 1.5, M.flame[2]!, Math.round(180 * fade));
      // debris chunks flying out
      const r = rng(77);
      for (let k = 0; k < 12; k++) {
        const a = r() * Math.PI * 2;
        const d = rx * (0.75 + r() * 0.3);
        const up = Math.sin(t * Math.PI) * (6 + r() * 10);
        const x = Math.round(48 + Math.cos(a) * d);
        const y = Math.round(48 + Math.sin(a) * d * 0.5 - up);
        const col = k % 3 ? PALETTES.dungeon.floor[4]! : M.stone[3]!;
        b.blend(x, y, col, Math.round(255 * fade));
        b.blend(x + 1, y, col, Math.round(255 * fade));
        b.blend(x, y + 1, PALETTES.outline, Math.round(200 * fade));
      }
    },
  },
  {
    key: 'fx:nova',
    w: 96,
    h: 96,
    frames: 6,
    durations: [50, 60, 70, 80, 90, 110],
    loop: false,
    draw: (b, i, n) => {
      const t = (i + 1) / n;
      const rad = 6 + t * 40;
      const fade = 1 - Math.max(0, t - 0.45) * 1.5;
      if (i < 3) glow(b, 48, 48, 16 - i * 3, M.arcane[3]!, 230, 16 - i * 3);
      ring(b, 48, 48, rad, rad * 0.55, 4 - t * 2, M.arcane[2]!, Math.round(255 * fade), M.arcane[4]!);
      ring(b, 48, 48, rad * 0.62, rad * 0.34, 1.6, M.plum[4]!, Math.round(200 * fade));
      // astral rays + stars
      const r = rng(31);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 + 0.2;
        const len = rad * (0.6 + r() * 0.5);
        line(b, 48 + Math.cos(a) * rad * 0.3, 48 + Math.sin(a) * rad * 0.18, 48 + Math.cos(a) * len, 48 + Math.sin(a) * len * 0.55, k % 2 ? M.arcane[3]! : M.plum[4]!, Math.round(170 * fade), 0);
        if (k % 3 === 0) sparkle(b, Math.round(48 + Math.cos(a) * len), Math.round(48 + Math.sin(a) * len * 0.55), hsv(0.42 + r() * 0.1, 0.4, 1), 2, Math.round(255 * fade));
      }
    },
  },
  {
    key: 'fx:hit',
    w: 24,
    h: 24,
    frames: 4,
    durations: [30, 40, 50, 70],
    loop: false,
    draw: (b, i) => {
      // chunky impact: solid flash disk, thick 4-point star, flying debris pixels
      const s = [7, 11, 11, 9][i] ?? 8;
      const a = [255, 255, 210, 120][i] ?? 100;
      if (i < 2) glow(b, 12, 12, 6 - i, 0xfff2c8, 255);
      for (let k = 0; k < 4; k++) {
        const ang = (k / 4) * Math.PI * 2 + (i % 2) * 0.2;
        line(b, 12, 12, 12 + Math.cos(ang) * s, 12 + Math.sin(ang) * s, 0xffe08a, a, i < 3 ? 1 : 0);
        line(b, 12, 12, 12 + Math.cos(ang) * s * 0.7, 12 + Math.sin(ang) * s * 0.7, 0xffffff, a, 0);
      }
      const r = rng(5);
      for (let k = 0; k < 6; k++) {
        const ang = r() * Math.PI * 2;
        const d = 3 + i * 2.6 + r() * 2;
        const x = Math.round(12 + Math.cos(ang) * d);
        const y = Math.round(12 + Math.sin(ang) * d);
        b.blend(x, y, 0xffffff, a);
        b.blend(x + 1, y, 0xffd070, Math.round(a * 0.8));
      }
      if (i >= 1) ring(b, 12, 12, 4 + i * 2.6, 4 + i * 2.6, 0.8, 0xffffff, Math.round(a * 0.6));
    },
  },
  {
    key: 'fx:crit',
    w: 32,
    h: 32,
    frames: 4,
    durations: [40, 50, 60, 90],
    loop: false,
    draw: (b, i) => {
      // jagged 8-ray crit burst: thick gold rays, blood-red secondaries, white core + shock ring
      const s = [10, 15, 15, 13][i] ?? 10;
      const a = [255, 255, 220, 130][i] ?? 100;
      glow(b, 16, 16, 7 - i * 0.8, i < 2 ? 0xffffff : M.gold[3]!, a);
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2 + 0.12;
        const len = k % 2 ? s * 0.65 : s;
        line(b, 16, 16, 16 + Math.cos(ang) * len, 16 + Math.sin(ang) * len, k % 2 ? M.bloodRed[3]! : M.gold[3]!, a, k % 2 ? 1 : 2);
        line(b, 16, 16, 16 + Math.cos(ang) * len * 0.75, 16 + Math.sin(ang) * len * 0.75, 0xffffff, a, 0);
      }
      if (i >= 1) ring(b, 16, 16, 7 + i * 3, 7 + i * 3, 1.2, M.gold[4]!, Math.round(a * 0.85));
    },
  },
  {
    key: 'fx:heal',
    w: 16,
    h: 16,
    frames: 4,
    durations: [80, 80, 80, 100],
    loop: false,
    draw: (b, i) => {
      const y = 10 - i * 2;
      const a = i === 3 ? 140 : 255;
      const g = 0x6cff8e;
      for (let k = -2; k <= 2; k++) {
        b.blend(8 + k, y, k === 0 ? 0xffffff : g, a);
        b.blend(8, y + k, k === 0 ? 0xffffff : g, a);
      }
      b.blend(7, y - 1, lighten(g, 0.5), a);
      sparkle(b, 3 + i, 13 - i * 2, g, 1, a);
      sparkle(b, 13 - i, 12 - i * 2, 0xc8ffd8, 1, a);
    },
  },
  {
    key: 'fx:shield',
    w: 48,
    h: 48,
    frames: 4,
    durations: [120, 120, 120, 120],
    loop: true,
    draw: (b, i) => {
      const cx = 24;
      const cy = 24;
      const R = 21;
      const hi = (i / 4) * Math.PI * 2;
      fill(b, (x, y) => {
        const dx = (x + 0.5 - cx) / R;
        const dy = (y + 0.5 - cy) / R;
        const d = Math.hypot(dx, dy);
        if (d > 1) return null;
        if (d > 0.9) return [d > 0.95 ? M.cyan[2]! : M.cyan[3]!, 220];
        // hex shimmer
        const hx = Math.floor((x + (Math.floor(y / 5) % 2) * 3) / 6);
        const hy = Math.floor(y / 5);
        const ang = Math.atan2(dy, dx);
        const band = Math.cos(ang - hi);
        const edgeHex = (x + (Math.floor(y / 5) % 2) * 3) % 6 === 0 || y % 5 === 0;
        if (edgeHex && band > 0.4 && d > 0.45) return [M.cyan[3]!, 120];
        if (dx < -0.3 && dy < -0.3 && d > 0.55 && d < 0.75) return [0xffffff, 150];
        void hx;
        void hy;
        return [M.cyan[2]!, Math.round(36 + d * d * 60)];
      });
    },
  },
  {
    key: 'fx:burn',
    w: 8,
    h: 8,
    frames: 3,
    durations: [70, 70, 70],
    loop: true,
    draw: (b, i) => {
      const h = [5, 6, 4][i] ?? 5;
      for (let y = 0; y < h; y++) {
        const t = y / h;
        const w = (1 - t) * 2.6 + 0.4;
        const sway = Math.sin(i * 2 + y) * 0.6;
        for (let x = Math.round(4 - w + sway); x <= Math.round(4 + w + sway - 1); x++) {
          const c = t < 0.3 ? M.ember[1]! : t < 0.6 ? M.ember[2]! : M.ember[3]!;
          b.blend(x, 7 - y, c, 255);
        }
      }
      b.blend(4, 6, 0xffffff, 255);
    },
  },
  {
    key: 'fx:mote',
    w: 4,
    h: 4,
    frames: 1,
    durations: [100],
    loop: false,
    draw: (b) => {
      b.set(1, 1, 0xffffff);
      b.set(2, 1, 0xffffff);
      b.set(1, 2, 0xffffff);
      b.set(2, 2, 0xe8f6ff);
      for (const [x, y] of [[0, 1], [0, 2], [3, 1], [3, 2], [1, 0], [2, 0], [1, 3], [2, 3]] as const) b.set(x, y, 0xc8eaff, 110);
    },
  },
  {
    key: 'fx:revive',
    w: 48,
    h: 48,
    frames: 4,
    durations: [100, 100, 100, 140],
    loop: false,
    draw: (b, i) => {
      const t = (i + 1) / 4;
      ring(b, 24, 38, 18, 8, 2, M.gold[2]!, 230);
      ring(b, 24, 38 - t * 18, 14 - t * 4, 6 - t * 2, 1, M.teal[3]!, Math.round(220 * (1 - t * 0.5)));
      const r = rng(5 + i);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + i * 0.4;
        sparkle(b, Math.round(24 + Math.cos(a) * 16), Math.round(38 + Math.sin(a) * 7 - t * 22 - r() * 6), k % 2 ? M.gold[3]! : M.teal[3]!, 1, 230);
      }
      // light column
      for (let y = 6; y < 38; y++) {
        const a = Math.round(70 * (y / 38) * (1 - t * 0.4));
        for (let x = 20; x <= 28; x++) b.blend(x, y, Math.abs(x - 24) < 2 ? 0xfffbe0 : M.gold[3]!, Math.abs(x - 24) < 2 ? a + 40 : a);
      }
    },
  },
  {
    key: 'fx:teleport',
    w: 48,
    h: 48,
    frames: 5,
    durations: [50, 60, 70, 60, 50],
    loop: false,
    draw: (b, i) => {
      const open = [0.3, 0.8, 1, 0.7, 0.25][i] ?? 0.5;
      const cx = 24;
      fill(b, (x, y) => {
        const dy = (y + 0.5 - 24) / 20;
        if (Math.abs(dy) > 1) return null;
        const hw = (1 - dy * dy) * 7 * open + 0.5;
        const dx = Math.abs(x + 0.5 - cx);
        if (dx > hw + 2) return null;
        if (dx > hw) return [M.violet[3]!, 120];
        if (dx > hw - 1.5) return [M.magenta[3]!, 255];
        return [dx < hw * 0.3 ? 0xffffff : M.deepViolet[1]!, 255];
      });
      const r = rng(i + 3);
      for (let k = 0; k < 5; k++) sparkle(b, Math.round(cx + (r() - 0.5) * 22 * open), Math.round(6 + r() * 36), M.cyan[3]!, 1, 220);
    },
  },
  {
    key: 'fx:spawn',
    w: 48,
    h: 48,
    frames: 6,
    durations: [80, 80, 80, 80, 90, 110],
    loop: false,
    draw: (b, i) => {
      const s = [0.3, 0.6, 0.9, 1, 0.8, 0.4][i] ?? 0.5;
      const rx = 20 * s;
      const ry = 10 * s;
      fill(b, (x, y) => {
        const dx = (x + 0.5 - 24) / rx;
        const dy = (y + 0.5 - 36) / ry;
        const d = Math.hypot(dx, dy);
        if (d > 1) return null;
        const ang = Math.atan2(dy, dx) + d * 4 + i * 0.9;
        const swirl = Math.sin(ang * 3) > 0.2;
        if (d > 0.85) return [M.hexViolet[3]!, 255];
        return [swirl ? M.bloodRed[1]! : 0x0a0408, 235];
      });
      // rising motes
      const r = rng(41);
      for (let k = 0; k < 6; k++) {
        const x = Math.round(24 + (r() - 0.5) * rx * 1.6);
        const y = Math.round(36 - ((r() * 30 + i * 5) % 30));
        sparkle(b, x, y, M.hexViolet[3]!, 1, Math.round(200 * s));
      }
    },
  },
  {
    key: 'fx:death',
    w: 32,
    h: 32,
    frames: 6,
    durations: [40, 50, 60, 70, 80, 100],
    loop: false,
    draw: (b, i, n) => {
      const t = i / (n - 1);
      const r = rng(19);
      if (i < 2) glow(b, 16, 16, 6 + i * 3, 0xdffaff, 230);
      for (let k = 0; k < 10; k++) {
        const a = r() * Math.PI * 2;
        const sp = 6 + r() * 9;
        const x = 16 + Math.cos(a) * sp * (0.3 + t);
        const y = 16 + Math.sin(a) * sp * (0.3 + t) + t * t * 6;
        const col = hsv(0.5 + r() * 0.4, 0.35, 1);
        const al = Math.round(255 * (1 - t * 0.8));
        b.blend(Math.round(x), Math.round(y), col, al);
        b.blend(Math.round(x + Math.cos(a)), Math.round(y + Math.sin(a)), 0xffffff, al);
        if (k % 2) b.blend(Math.round(x - Math.cos(a)), Math.round(y - Math.sin(a)), mix(col, PALETTES.outline, 0.4), al);
      }
    },
  },
  {
    key: 'fx:pool',
    w: 64,
    h: 64,
    frames: 3,
    durations: [160, 160, 160],
    loop: true,
    draw: (b, i) => {
      const r = rng(11);
      const bub: [number, number, number][] = [];
      for (let k = 0; k < 7; k++) bub.push([10 + r() * 44, 22 + r() * 20, r()]);
      fill(b, (x, y) => {
        const dx = (x + 0.5 - 32) / 29;
        const dy = (y + 0.5 - 32) / 15;
        const wob = Math.sin(Math.atan2(dy, dx) * 5 + i * 2) * 0.05;
        const d = Math.hypot(dx, dy) + wob;
        if (d > 1) return null;
        if (d > 0.9) return [M.hexViolet[3]!, 230];
        if (d > 0.8) return [M.hexViolet[1]!, 200];
        return [(x + y + i) % 9 === 0 ? M.hexViolet[2]! : M.cultRobe[2]!, 160];
      });
      for (const [bx, by, ph] of bub) {
        const k = (ph * 3 + i) % 3;
        if (k < 1) continue;
        b.blend(Math.round(bx), Math.round(by), M.hexViolet[3]!, 230);
        if (k >= 2) {
          b.blend(Math.round(bx) + 1, Math.round(by), M.hexViolet[2]!, 200);
          b.blend(Math.round(bx), Math.round(by) - 1, M.hexViolet[2]!, 200);
        }
      }
    },
  },
  {
    key: 'fx:lightpool',
    w: 64,
    h: 64,
    frames: 3,
    durations: [140, 140, 140],
    loop: true,
    draw: (b, i) => {
      fill(b, (x, y) => {
        const dx = (x + 0.5 - 32) / 29;
        const dy = (y + 0.5 - 32) / 15;
        const d = Math.hypot(dx, dy);
        if (d > 1) return null;
        // pale ghost-fire pool (Hollow Stag)
        const wob = Math.sin(Math.atan2(dy, dx) * 6 + i * 2.1) * 0.03;
        if (d + wob > 0.88) return [M.ghostFire[3]!, 230];
        const stripe = Math.sin((x - y * 2) * 0.35 + i * 2) > 0.85;
        return [stripe ? 0xffffff : M.ghostFire[2]!, stripe ? 140 : Math.round(60 + (1 - d) * 70)];
      });
      const r = rng(23 + i);
      for (let k = 0; k < 4; k++) sparkle(b, Math.round(14 + r() * 36), Math.round(22 + r() * 20), M.ghostFire[3]!, 1, 230);
    },
  },
  {
    key: 'fx:root',
    w: 32,
    h: 32,
    frames: 1,
    durations: [100],
    loop: false,
    draw: (b) => {
      const p = new Painter(b);
      const C = PALETTES.bellroot;
      p.capsule(4, 30, 10, 6, 3.6, 2).capsule(16, 31, 15, 3, 4.2, 2.2).capsule(28, 30, 22, 7, 3.6, 2).capsule(3, 20, 29, 18, 2.4, 2.4);
      p.fill(M.root, { mode: 'cyl', dither: true });
      p.ellipse(16, 8, 4, 2.5).fill(C.moss, { mode: 'sphere', dither: true });
      p.capsule(6, 24, 26, 25, 1.2, 1.2).fill(C.iron, { mode: 'cyl', inner: false });
      p.gpx(10, 14, C.core[3]!, C.core[2]!).gpx(22, 16, C.core[3]!, C.core[2]!).gpx(16, 22, C.core[3]!, C.core[2]!);
      p.finish();
    },
  },
  {
    key: 'fx:flame',
    w: 32,
    h: 32,
    frames: 4,
    durations: [80, 80, 80, 80],
    loop: true,
    draw: (b, i) => {
      // ground scorch + three licking flames
      fill(b, (x, y) => {
        const d = Math.hypot((x + 0.5 - 16) / 13, (y + 0.5 - 26) / 5);
        return d <= 1 ? [M.ember[0]!, 140] : null;
      });
      const cols = [M.ember[1]!, M.ember[2]!, M.ember[3]!, 0xffffff];
      for (let f = 0; f < 3; f++) {
        const cx = 9 + f * 7;
        const h = 12 + ((f * 5 + i * 3) % 7) + (f === 1 ? 5 : 0);
        for (let y = 0; y < h; y++) {
          const t = y / h;
          const w = (1 - t) * (f === 1 ? 4.6 : 3.6) + 0.3;
          const sway = Math.sin(i * 1.6 + y * 0.4 + f) * 1.4 * t;
          for (let x = Math.round(cx - w + sway); x <= Math.round(cx + w + sway); x++) {
            const edge = Math.abs(x - cx - sway) / w;
            const ci = Math.min(3, Math.floor((1 - edge) * 2 + (1 - t) * 1.6));
            b.blend(x, 27 - y, cols[ci]!, 255);
          }
        }
      }
      outlinePass(b, PALETTES.outline, 200);
    },
  },
  {
    key: 'fx:field',
    w: 64,
    h: 64,
    frames: 4,
    durations: [70, 70, 70, 70],
    loop: true,
    draw: (b, i) => {
      fill(b, (x, y) => {
        const dx = (x + 0.5 - 32) / 30;
        const dy = (y + 0.5 - 32) / 16;
        const d = Math.hypot(dx, dy);
        if (d > 1) return null;
        if (d > 0.92) return [(x + i * 3) % 6 < 3 ? 0xffe04a : M.violet[3]!, 230];
        return [M.violet[1]!, Math.round(50 + d * 50)];
      });
      for (let k = 0; k < 4; k++) {
        const a0 = ((k + i * 0.37) / 4) * Math.PI * 2;
        const a1 = a0 + 2.2;
        jag(b, 32 + Math.cos(a0) * 26, 32 + Math.sin(a0) * 13, 32 + Math.cos(a1) * 22, 32 + Math.sin(a1) * 11, 100 + k * 7 + i * 31, 0xffe04a, 0xffffff, 6);
      }
    },
  },
  // ---------------------------------------------------------------- lighting + tintable particles (white/grey)
  {
    key: 'light:soft',
    w: 256,
    h: 256,
    frames: 1,
    durations: [100],
    loop: false,
    anim: false,
    draw: (b) => {
      fill(b, (x, y) => {
        const d = Math.hypot(x + 0.5 - 128, y + 0.5 - 128) / 128;
        if (d >= 1) return null;
        const f = (1 - d * d) * (1 - d * d);
        return [0xffffff, Math.round(255 * f)];
      });
    },
  },
  {
    key: 'light:cone',
    w: 256,
    h: 128,
    frames: 1,
    durations: [100],
    loop: false,
    anim: false,
    draw: (b) => {
      // apex at the left-centre, opening toward +x (rotate to aim)
      fill(b, (x, y) => {
        const dx = x + 0.5;
        const dy = y + 0.5 - 64;
        const r = Math.hypot(dx, dy) / 256;
        if (r >= 1) return null;
        const ang = Math.abs(Math.atan2(dy, dx));
        const half = 0.42;
        if (ang >= half) return null;
        const af = 1 - ang / half;
        const f = Math.pow(1 - r, 1.4) * (af * af * (3 - 2 * af));
        return [0xffffff, Math.round(255 * Math.min(1, f * 1.3))];
      });
    },
  },
  {
    key: 'pfx:spark',
    w: 4,
    h: 4,
    frames: 1,
    durations: [100],
    loop: false,
    anim: false,
    draw: (b) => {
      for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]] as const) b.set(x, y, 0xffffff);
      for (const [x, y] of [[0, 1], [0, 2], [3, 1], [3, 2], [1, 0], [2, 0], [1, 3], [2, 3]] as const) b.set(x, y, 0xdddddd, 140);
    },
  },
  {
    key: 'pfx:streak',
    w: 2,
    h: 6,
    frames: 1,
    durations: [100],
    loop: false,
    anim: false,
    draw: (b) => {
      for (let y = 0; y < 6; y++) {
        const a = Math.round(60 + (y / 5) * 195);
        b.set(0, y, 0xffffff, a);
        b.set(1, y, 0xe8e8e8, Math.round(a * 0.7));
      }
    },
  },
  {
    key: 'pfx:ember',
    w: 3,
    h: 3,
    frames: 1,
    durations: [100],
    loop: false,
    anim: false,
    draw: (b) => {
      b.set(1, 1, 0xffffff);
      for (const [x, y] of [[0, 1], [2, 1], [1, 0], [1, 2]] as const) b.set(x, y, 0xffffff, 150);
      for (const [x, y] of [[0, 0], [2, 0], [0, 2], [2, 2]] as const) b.set(x, y, 0xffffff, 40);
    },
  },
  {
    key: 'pfx:dust',
    w: 16,
    h: 16,
    frames: 4,
    durations: [70, 80, 90, 110],
    loop: false,
    anim: true,
    draw: (b, i) => {
      const r = 3 + i * 1.5;
      const a0 = [210, 170, 120, 60][i] ?? 60;
      fill(b, (x, y) => {
        const d = Math.hypot(x + 0.5 - 8, (y + 0.5 - 9) * 1.15) / r;
        if (d > 1) return null;
        const n = hash2(x, y, i + 3) * 0.35;
        const v = (1 - d) * 1.4 + n - 0.2;
        if (v <= 0.12) return null;
        return [mix(0xb8b8b8, 0xffffff, Math.min(1, v)), Math.round(a0 * Math.min(1, v))];
      });
    },
  },
  {
    key: 'pfx:drop',
    w: 4,
    h: 4,
    frames: 1,
    durations: [100],
    loop: false,
    anim: false,
    draw: (b) => {
      b.set(1, 0, 0xdddddd, 200);
      b.set(1, 1, 0xffffff);
      b.set(2, 1, 0xdddddd);
      b.set(0, 2, 0xcccccc, 220);
      b.set(1, 2, 0xffffff);
      b.set(2, 2, 0xbbbbbb);
      b.set(1, 3, 0x999999, 220);
      b.set(2, 3, 0x999999, 160);
    },
  },
  {
    key: 'pfx:shard',
    w: 6,
    h: 6,
    frames: 3,
    durations: [100, 100, 100],
    loop: false,
    anim: false,
    draw: (b, i) => {
      const p = new Painter(b);
      const shapes = [
        [1, 4.5, 3, 0.5, 5, 2.5, 3.5, 5],
        [0.5, 2.5, 4.5, 1, 5.5, 3.5, 2, 5],
        [2.5, 0.5, 5, 3, 3, 5.5, 0.5, 3.5],
      ];
      p.poly(shapes[i] ?? shapes[0]!).fill([0x6a6a6a, 0xa0a0a0, 0xd8d8d8, 0xffffff], { mode: 'facet', facets: 3 });
      p.finish(0x2a2a2a, 0);
    },
  },
  {
    key: 'pfx:smoke',
    w: 24,
    h: 24,
    frames: 1,
    durations: [100],
    loop: false,
    anim: false,
    draw: (b) => {
      fill(b, (x, y) => {
        const d = Math.hypot(x + 0.5 - 12, y + 0.5 - 12) / 11.5;
        if (d >= 1) return null;
        const n = hash2(x >> 1, y >> 1, 41) * 0.4 + hash2(x, y, 42) * 0.15;
        const v = (1 - d) * (1 - d) * 1.5 + n * (1 - d) - 0.1;
        if (v <= 0.05) return null;
        return [mix(0x8a8a8a, 0xdedede, Math.min(1, v)), Math.round(170 * Math.min(1, v))];
      });
    },
  },
  {
    key: 'pfx:ring',
    w: 64,
    h: 64,
    frames: 1,
    durations: [100],
    loop: false,
    anim: false,
    draw: (b) => {
      fill(b, (x, y) => {
        const d = Math.abs(Math.hypot(x + 0.5 - 32, y + 0.5 - 32) - 29.5);
        if (d > 2) return null;
        return [0xffffff, Math.round(255 * (1 - d / 2))];
      });
    },
  },
  {
    key: 'pfx:flash',
    w: 64,
    h: 64,
    frames: 1,
    durations: [100],
    loop: false,
    anim: false,
    draw: (b) => {
      fill(b, (x, y) => {
        const dx = x + 0.5 - 32;
        const dy = y + 0.5 - 32;
        const d = Math.hypot(dx, dy) / 32;
        if (d >= 1) return null;
        const ang = Math.atan2(dy, dx);
        const ray = Math.pow(Math.abs(Math.cos(ang * 4)), 18) * (1 - d) * 1.2 + Math.pow(Math.abs(Math.cos(ang * 4 + Math.PI / 4)), 30) * (1 - d) * 0.6;
        const core = Math.pow(Math.max(0, 1 - d * 2.2), 1.5);
        const soft = (1 - d) * (1 - d) * 0.5;
        const v = Math.min(1, core + ray + soft);
        if (v < 0.02) return null;
        return [0xffffff, Math.round(255 * v)];
      });
    },
  },
  {
    key: 'pfx:snow',
    w: 3,
    h: 3,
    frames: 1,
    durations: [100],
    loop: false,
    anim: false,
    draw: (b) => {
      b.set(1, 1, 0xffffff);
      for (const [x, y] of [[0, 1], [2, 1], [1, 0], [1, 2]] as const) b.set(x, y, 0xffffff, 190);
      for (const [x, y] of [[0, 0], [2, 2]] as const) b.set(x, y, 0xe0e8f0, 70);
    },
  },
  {
    key: 'pfx:spore',
    w: 3,
    h: 3,
    frames: 1,
    durations: [100],
    loop: false,
    anim: false,
    draw: (b) => {
      b.set(1, 1, 0xffffff, 255);
      for (const [x, y] of [[0, 1], [2, 1], [1, 0], [1, 2]] as const) b.set(x, y, 0xffffff, 110);
      for (const [x, y] of [[0, 0], [2, 0], [0, 2], [2, 2]] as const) b.set(x, y, 0xffffff, 35);
    },
  },
  {
    key: 'pfx:drip',
    w: 2,
    h: 4,
    frames: 1,
    durations: [100],
    loop: false,
    anim: false,
    draw: (b) => {
      b.set(0, 0, 0xffffff, 120);
      b.set(0, 1, 0xffffff, 200);
      b.set(0, 2, 0xffffff);
      b.set(1, 2, 0xdddddd, 200);
      b.set(0, 3, 0xbbbbbb);
      b.set(1, 3, 0xbbbbbb, 220);
    },
  },
  {
    key: 'pfx:slashArc',
    w: 96,
    h: 96,
    frames: 1,
    durations: [100],
    loop: false,
    anim: false,
    draw: (b) => {
      // crescent sweeping counter-clockwise to its leading edge at the top-right; white so it can be tinted
      const cx = 40;
      const cy = 52;
      const R = 38;
      const a0 = 2.3;
      const a1 = -1.2;
      const acc = new Map<number, number>();
      const steps = 900;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const a = a0 + (a1 - a0) * t;
        const w = 1 + 9 * Math.pow(t, 1.3) * (t > 0.92 ? (1 - t) / 0.08 : 1);
        for (let q = -w; q <= w; q += 0.5) {
          const rr = R + q * 0.9;
          const x = Math.round(cx + Math.cos(a) * rr);
          const y = Math.round(cy + Math.sin(a) * rr);
          if (!b.inside(x, y)) continue;
          const edge = (q + w) / (2 * w);
          const al = 255 * Math.pow(t, 1.6) * (edge > 0.7 ? 1 : 0.55 + edge * 0.5);
          const key = y * b.w + x;
          acc.set(key, Math.max(acc.get(key) ?? 0, al));
        }
      }
      for (const [key, al] of acc) {
        const v = Math.min(255, Math.round(al));
        b.set(key % b.w, Math.floor(key / b.w), v > 200 ? 0xffffff : 0xe4e4e4, v);
      }
    },
  },
  // tintable juice bits and shapes for class kits (fxJuice.ts), then the per-class sheets (art/fx/)
  ...JUICE_SPECS,
  ...CLASS_FX_SPECS,
];

export const EFFECT_KEYS
: readonly string[] = SPECS.map((s) => s.key);

/** Frame metadata without rendering (used by the manifest/validation). */
export function effectSpecs(): { key: string; frameW: number; frameH: number; frames: number; loop: boolean; anim: boolean }[] {
  return SPECS.map((s) => ({ key: s.key, frameW: s.w, frameH: s.h, frames: s.frames, loop: s.loop, anim: s.anim ?? s.key.startsWith('fx:') }));
}

export function buildEffects(): EffectSheet[] {
  const out: EffectSheet[] = [];
  for (const s of SPECS) {
    const sheet = new PixelBuffer(s.w * s.frames, s.h);
    for (let i = 0; i < s.frames; i++) {
      const f = new PixelBuffer(s.w, s.h);
      s.draw(f, i, s.frames);
      f.copyTo(sheet, i * s.w, 0);
    }
    out.push({ key: s.key, frameW: s.w, frameH: s.h, frames: s.frames, durations: s.durations, loop: s.loop, anim: s.anim ?? s.key.startsWith('fx:'), width: sheet.w, height: sheet.h, rgba: sheet.toRGBA() });
  }
  return out;
}
