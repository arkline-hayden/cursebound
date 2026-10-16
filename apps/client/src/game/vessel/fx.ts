/**
 * Portal effects for the Vessel Select stage: a small particle system and each class's signature eruption (the
 * selected hero's portal), its softer idle glow (other heroes, party members) and its burst when chosen.
 * Particles and effect sprites draw additively (or blended, for solid things like ice and gears) through the
 * renderer's depth-tested Raster, so a hero hides what passes behind them. Framework-free.
 */
import { flavorOf, type VesselClass } from './palette';
import { CROSSES, FEATHERS, FLAKES, GEARS, LEAVES, fxFrames, wolfFrames, type Spr } from './sprites';

/** Depth-tested drawing into the lit frame (implemented by the renderer). */
export interface Raster {
  /** additive pixel; `d` is the element's floor-plane depth (hidden behind anything nearer) */
  add(x: number, y: number, col: number, a: number, d: number): void;
  /** additive sprite (alpha-weighted), optionally mirrored and tinted toward `tint` */
  sprAdd(s: Spr, x: number, y: number, a: number, d: number, flip?: boolean, tint?: number, tintAmt?: number): void;
  /** alpha-blended sprite (solid things: ice, gears, leaves), brightness `lit` */
  sprBlend(s: Spr, x: number, y: number, a: number, d: number, flip?: boolean, lit?: number): void;
  /** 1px additive line */
  line(x0: number, y0: number, x1: number, y1: number, col: number, a: number, d: number): void;
}

export const PK = { Pix: 0, Ember: 1, Streak: 2, Spr: 3, SprBlend: 4, Wisp: 5, Puff: 6 } as const;
export type PK = (typeof PK)[keyof typeof PK];

export interface Particle {
  x: number; y: number; vx: number; vy: number;
  ay: number; drag: number;
  life: number; max: number;
  kind: PK;
  col: number; col2: number;
  /** floor-plane depth */
  d: number;
  spr: Spr | null; spr2: Spr | null;
  flip: boolean; alpha: number;
  /** horizontal wobble amplitude / frequency */
  wob: number; wobF: number; seed: number;
  /** floor y to bounce on (sparks), or NaN */
  floor: number;
}

const MAX_PARTICLES = 700;

export class Particles {
  readonly list: Particle[] = [];
  private pool: Particle[] = [];

  spawn(p: Partial<Particle> & { x: number; y: number; max: number }): void {
    if (this.list.length >= MAX_PARTICLES) return;
    const q = this.pool.pop() ?? ({} as Particle);
    q.x = p.x; q.y = p.y; q.vx = p.vx ?? 0; q.vy = p.vy ?? 0; q.ay = p.ay ?? 0; q.drag = p.drag ?? 0;
    q.life = 0; q.max = p.max; q.kind = p.kind ?? PK.Pix; q.col = p.col ?? 0xffffff; q.col2 = p.col2 ?? q.col;
    q.d = p.d ?? 0; q.spr = p.spr ?? null; q.spr2 = p.spr2 ?? null; q.flip = p.flip ?? false; q.alpha = p.alpha ?? 1;
    q.wob = p.wob ?? 0; q.wobF = p.wobF ?? 0; q.seed = p.seed ?? Math.random() * 100; q.floor = p.floor ?? NaN;
    this.list.push(q);
  }

  clear(): void { this.pool.push(...this.list); this.list.length = 0; }

  step(dt: number): void {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i]!;
      p.life += dt;
      if (p.life >= p.max) { L[i] = L[L.length - 1]!; L.pop(); this.pool.push(p); continue; }
      const k = p.drag ? Math.max(0, 1 - p.drag * dt) : 1;
      p.vx *= k; p.vy = p.vy * k + p.ay * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.floor === p.floor && p.y > p.floor && p.vy > 0) { p.y = p.floor; p.vy *= -0.35; p.vx *= 0.6; }
    }
  }

  draw(r: Raster, t: number): void {
    for (const p of this.list) {
      const u = p.life / p.max;
      const fade = (u < 0.15 ? u / 0.15 : 1) * (1 - Math.max(0, (u - 0.55) / 0.45)) * p.alpha;
      const x = Math.round(p.x + (p.wob ? Math.sin(t * p.wobF + p.seed) * p.wob : 0)), y = Math.round(p.y);
      switch (p.kind) {
        case PK.Pix:
          r.add(x, y, u < 0.4 ? p.col : p.col2, fade, p.d);
          break;
        case PK.Ember: {
          const c = u < 0.35 ? p.col : p.col2;
          const tw = 0.7 + 0.3 * Math.sin(t * 23 + p.seed * 7);
          r.add(x, y, c, fade * tw, p.d);
          if (fade > 0.45) { r.add(x - 1, y, c, fade * 0.35, p.d); r.add(x + 1, y, c, fade * 0.35, p.d); r.add(x, y - 1, c, fade * 0.35, p.d); r.add(x, y + 1, c, fade * 0.3, p.d); }
          break;
        }
        case PK.Streak: {
          const len = Math.min(6, Math.hypot(p.vx, p.vy) * 0.06);
          const n = Math.hypot(p.vx, p.vy) || 1;
          r.line(x, y, Math.round(x - (p.vx / n) * len), Math.round(y - (p.vy / n) * len), u < 0.3 ? p.col : p.col2, fade, p.d);
          break;
        }
        case PK.Wisp: {
          // a rising skull or soul with a fading trail
          for (let k = 1; k <= 5; k++) r.add(x + Math.round(Math.sin(t * 6 + p.seed + k) * 1), y + 3 + k * 2, k < 3 ? p.col : p.col2, fade * (0.7 - k * 0.12), p.d);
          if (p.spr) { r.sprAdd(p.spr, x - (p.spr.w >> 1), y - (p.spr.h >> 1) - 1, fade * 0.35, p.d, p.flip, p.col2, 1); r.sprBlend(p.spr, x - (p.spr.w >> 1), y - (p.spr.h >> 1), fade, p.d, p.flip, 1.15); }
          break;
        }
        case PK.Puff: {
          const rad = 1 + u * 3.5;
          for (let yy = -3; yy <= 3; yy++) for (let xx = -4; xx <= 4; xx++) {
            const dd = (xx * xx) / (rad * rad) + (yy * yy) / (rad * rad * 0.6);
            if (dd < 1 && ((xx + yy + Math.floor(t * 8)) & 1) === 0) r.add(x + xx, y + yy, p.col, fade * 0.18 * (1 - dd), p.d);
          }
          break;
        }
        case PK.Spr: {
          const s = p.spr2 && Math.floor(t * 8 + p.seed) % 2 ? p.spr2 : p.spr;
          if (s) r.sprAdd(s, x - (s.w >> 1), y - (s.h >> 1), fade, p.d, p.flip, p.col, p.col === 0xffffff ? 0 : 1);
          break;
        }
        case PK.SprBlend: {
          const s = p.spr2 && Math.floor(t * 7 + p.seed) % 2 ? p.spr2 : p.spr;
          if (s) r.sprBlend(s, x - (s.w >> 1), y - (s.h >> 1), Math.min(1, fade * 1.4), p.d, p.flip, 0.9);
          break;
        }
      }
    }
  }
}

// ---------------------------------------------------------------- per-class portal effects

export interface PortalCtx {
  cls: VesselClass;
  /** plinth top centre (hero feet) */
  x: number;
  y: number;
  /** floor-plane depth of the hero (feet) */
  d: number;
  /** floor y below the plinth centre */
  fy: number;
  /** 0..2: 1 = selected, ~0.4 = a party member, 2 = the confirm flare */
  power: number;
  /** cosmetic particle multiplier (graphics tier; 0 = reduced effects) */
  density: number;
  t: number;
  /** per-portal accumulators (fractional spawns, timers) */
  acc: Record<string, number>;
  ps: Particles;
}

const R = Math.random;
const pick = <T,>(a: readonly T[]): T => a[Math.floor(R() * a.length)]!;
const front = (c: PortalCtx, frontSide: boolean) => c.d + (frontSide ? 3 : -3);

/** Spawn `rate` per second (scaled), carrying the fraction between frames. */
function every(c: PortalCtx, key: string, rate: number, dt: number, fn: () => void): void {
  const n = (c.acc[key] ?? 0) + rate * dt * c.density;
  const whole = Math.floor(n);
  c.acc[key] = n - whole;
  for (let k = 0; k < Math.min(whole, 12); k++) fn();
}

/** A point on the floor ring around the plinth (angle a), with its depth. */
function onFloorRing(c: PortalCtx, a: number, rx = 24, ry = 12) {
  const x = c.x + Math.cos(a) * rx, y = c.fy + Math.sin(a) * ry;
  return { x, y, d: y };
}

/** Continuous emission for a lit portal. */
export function emitPortal(c: PortalCtx, dt: number): void {
  const f = flavorOf(c.cls);
  const P = c.power;
  // shared: motes drifting up the light column
  every(c, 'mote', 6 * P, dt, () => {
    const fs = R() < 0.5;
    c.ps.spawn({ x: c.x + (R() - 0.5) * 20, y: c.y - R() * 4, vy: -10 - R() * 14, max: 1.4 + R() * 1.2, col: pick(f.motes), col2: f.light, d: front(c, fs), wob: 1.5, wobF: 2 + R() * 2 });
  });
  if (P < 0.3) return;
  switch (c.cls) {
    case 'arcanist':
      every(c, 'ember', 22 * P, dt, () => {
        const fs = R() < 0.5;
        c.ps.spawn({ kind: PK.Ember, x: c.x + (R() - 0.5) * 22, y: c.y - R() * 3, vx: (R() - 0.5) * 8, vy: -22 - R() * 26, drag: 0.4, max: 0.9 + R() * 0.9, col: pick([0xfff0b0, 0xffc24a]), col2: pick([0xff7a2a, 0xd8401a]), d: front(c, fs), wob: 2, wobF: 5 });
      });
      every(c, 'star', 7 * P, dt, () => {
        c.ps.spawn({ kind: PK.Ember, x: c.x + (R() - 0.5) * 40, y: c.y - 8 - R() * 50, max: 0.5 + R() * 0.5, col: 0xffffff, col2: pick([0xd7a8ff, 0xa070ff]), d: front(c, R() < 0.4) });
      });
      break;
    case 'cryomancer':
      every(c, 'snow', 14 * P, dt, () => {
        const fs = R() < 0.5;
        c.ps.spawn({ kind: PK.Spr, spr: pick(FLAKES), x: c.x + (R() - 0.5) * 50, y: c.y - 70 - R() * 30, vy: 9 + R() * 8, max: 3 + R() * 2, col: 0xffffff, d: front(c, fs), wob: 4, wobF: 1.5 + R() });
      });
      every(c, 'frost', 10 * P, dt, () => {
        const a = R() * Math.PI * 2;
        const p = onFloorRing(c, a, 13, 6.5);
        c.ps.spawn({ kind: PK.Ember, x: p.x, y: p.y - 7, vx: -Math.sin(a) * 6, vy: -16 - R() * 16, max: 1 + R(), col: 0xffffff, col2: 0x9fe8ff, d: c.d + (Math.sin(a) > 0 ? 3 : -3), wob: 2, wobF: 4 });
      });
      break;
    case 'templar':
      every(c, 'dust', 10 * P, dt, () => {
        c.ps.spawn({ kind: PK.Pix, x: c.x + (R() - 0.5) * 44, y: c.y - 90 - R() * 30, vy: 12 + R() * 10, max: 2.5 + R() * 2, col: 0xfff8e8, col2: 0xffd76a, d: front(c, R() < 0.5), wob: 3, wobF: 1 + R() });
      });
      every(c, 'cross', 1.8 * P, dt, () => {
        const fs = R() < 0.5;
        c.ps.spawn({ kind: PK.Spr, spr: CROSSES[R() < 0.7 ? 0 : 1]!, x: c.x + (R() < 0.5 ? -1 : 1) * (9 + R() * 9), y: c.y - 6 - R() * 10, vy: -12 - R() * 6, max: 1.6 + R() * 0.6, col: pick([0xfff1a8, 0xffd76a]), d: front(c, fs), wob: 1, wobF: 2 });
      });
      break;
    case 'hexbinder':
      every(c, 'skull', 2.6 * P, dt, () => {
        const skull = fxFrames('fx:berserker:fear')[0] ?? null;
        const fs = R() < 0.5;
        c.ps.spawn({ kind: PK.Wisp, spr: skull, x: c.x + (R() - 0.5) * 22, y: c.y - 4, vy: -14 - R() * 8, max: 2 + R() * 0.8, col: 0xc8a0ff, col2: 0x9a5ad0, d: front(c, fs), wob: 4, wobF: 2.5 + R(), flip: R() < 0.5 });
      });
      every(c, 'sick', 9 * P, dt, () => {
        c.ps.spawn({ kind: PK.Ember, x: c.x + (R() - 0.5) * 30, y: c.y - R() * 6, vy: -8 - R() * 10, max: 1.5 + R(), col: 0xe0ffb0, col2: 0x8fd14f, d: front(c, R() < 0.5), wob: 3, wobF: 3 });
      });
      break;
    case 'ranger':
      every(c, 'feather', 4 * P, dt, () => {
        const fs = R() < 0.5;
        const s = R() < 0.75 ? 0 : 2;
        c.ps.spawn({ kind: PK.SprBlend, spr: FEATHERS[s]!, spr2: FEATHERS[s === 0 ? 1 : 2]!, x: c.x + (R() - 0.5) * 30, y: c.y - 2, vx: (R() - 0.5) * 14, vy: -26 - R() * 14, ay: 18, drag: 0.6, max: 2.6 + R(), d: front(c, fs), wob: 5, wobF: 2 + R(), flip: R() < 0.5 });
      });
      break;
    case 'warden':
      every(c, 'leaf', 6 * P, dt, () => {
        const fs = R() < 0.5;
        const s = Math.floor(R() * 3);
        c.ps.spawn({ kind: PK.SprBlend, spr: LEAVES[s]!, spr2: LEAVES[(s + 1) % 3]!, x: c.x + (R() - 0.5) * 26, y: c.y - 2, vx: (R() - 0.5) * 10, vy: -20 - R() * 16, drag: 0.3, max: 2 + R(), d: front(c, fs), wob: 7, wobF: 2.4 + R(), flip: R() < 0.5 });
      });
      every(c, 'petal', 1.2 * P, dt, () => {
        c.ps.spawn({ kind: PK.SprBlend, spr: LEAVES[3]!, x: c.x + (R() - 0.5) * 26, y: c.y - 2, vy: -16 - R() * 10, max: 2.2, d: front(c, R() < 0.5), wob: 6, wobF: 3 });
      });
      break;
    case 'berserker':
      every(c, 'blood', 22 * P, dt, () => {
        const fs = R() < 0.5;
        c.ps.spawn({ kind: PK.Ember, x: c.x + (R() - 0.5) * 24, y: c.y - R() * 4, vx: (R() - 0.5) * 10, vy: -34 - R() * 34, drag: 0.6, max: 0.7 + R() * 0.7, col: pick([0xffe0b0, 0xff8a3a]), col2: pick([0xff4a2a, 0xd0202a, 0x7a0a12]), d: front(c, fs), wob: 1.5, wobF: 7 });
      });
      break;
    case 'vanguard':
      every(c, 'spark', 4.5 * P, dt, () => {
        // a grinding burst off the plinth rim, sparks bouncing on the floor
        const a = R() * Math.PI * 2;
        const p = onFloorRing(c, a, 16, 8);
        const n = 3 + Math.floor(R() * 4);
        for (let k = 0; k < n; k++) {
          const sp = 40 + R() * 50, dir = a + (R() - 0.5) * 1.2;
          c.ps.spawn({ kind: PK.Streak, x: p.x, y: p.y - 7, vx: Math.cos(dir) * sp, vy: -30 - R() * 50, ay: 160, max: 0.5 + R() * 0.5, col: 0xffffff, col2: pick([0xffc94a, 0xffa830]), d: p.d + 2, floor: p.y + 2 });
        }
      });
      break;
    case 'duelist':
      every(c, 'petal', 9 * P, dt, () => {
        const a = R() * Math.PI * 2;
        const p = onFloorRing(c, a, 15, 7);
        c.ps.spawn({ kind: PK.Ember, x: p.x, y: p.y - 7, vx: -Math.sin(a) * 18, vy: -16 - R() * 18, drag: 0.5, max: 1 + R() * 0.8, col: pick([0xffd0d8, 0xff3a52]), col2: pick([0xb0142a, 0x8a5aff]), d: c.d + (Math.sin(a) > 0 ? 3 : -3), wob: 3, wobF: 4 });
      });
      break;
    case 'artificer':
      every(c, 'gear', 2.2 * P, dt, () => {
        const big = R() < 0.4;
        const fs = R() < 0.5;
        c.ps.spawn({ kind: PK.SprBlend, spr: GEARS[big ? 2 : 0]!, spr2: GEARS[big ? 3 : 1]!, x: c.x + (R() - 0.5) * 28, y: c.y - 2, vx: (R() - 0.5) * 8, vy: -16 - R() * 10, max: 2.4 + R(), d: front(c, fs), wob: 1.5, wobF: 2 });
      });
      every(c, 'steam', 4 * P, dt, () => {
        c.ps.spawn({ kind: PK.Puff, x: c.x + (R() - 0.5) * 30, y: c.y + 2, vy: -10 - R() * 6, max: 1.6 + R(), col: 0xe8f4f4, d: front(c, R() < 0.5) });
      });
      break;
  }
}

/** The burst when a portal's hero is chosen (and, scaled up, the confirm flare). */
export function burstPortal(c: PortalCtx, scale = 1): void {
  const f = flavorOf(c.cls);
  const n = Math.round(26 * scale * Math.max(0.25, c.density));
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + R() * 0.3;
    const sp = 30 + R() * 40;
    const fs = Math.sin(a) > 0;
    c.ps.spawn({ kind: PK.Ember, x: c.x + Math.cos(a) * 10, y: c.y + Math.sin(a) * 5 - 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 - 30 - R() * 30, ay: 30, drag: 1.4, max: 0.7 + R() * 0.6, col: pick(f.motes), col2: f.light, d: c.d + (fs ? 3 : -3) });
  }
  switch (c.cls) {
    case 'vanguard':
      for (let k = 0; k < 14 * scale; k++) {
        const a = R() * Math.PI * 2, sp = 50 + R() * 70;
        c.ps.spawn({ kind: PK.Streak, x: c.x, y: c.y - 4, vx: Math.cos(a) * sp, vy: -50 - R() * 60, ay: 170, max: 0.6 + R() * 0.5, col: 0xffffff, col2: 0xffc94a, d: c.d + (Math.sin(a) > 0 ? 3 : -3), floor: c.fy + 4 });
      }
      break;
    case 'ranger':
      for (let k = 0; k < 6 * scale; k++) c.ps.spawn({ kind: PK.SprBlend, spr: FEATHERS[k % 3]!, x: c.x, y: c.y - 10, vx: (R() - 0.5) * 70, vy: -40 - R() * 30, ay: 40, drag: 1, max: 1.8, d: c.d + (R() < 0.5 ? 3 : -3), wob: 3, wobF: 3, flip: R() < 0.5 });
      break;
    case 'warden':
      for (let k = 0; k < 10 * scale; k++) c.ps.spawn({ kind: PK.SprBlend, spr: LEAVES[k % 4]!, x: c.x, y: c.y - 6, vx: (R() - 0.5) * 70, vy: -30 - R() * 40, ay: 30, drag: 1, max: 1.8, d: c.d + (R() < 0.5 ? 3 : -3), wob: 4, wobF: 3, flip: R() < 0.5 });
      break;
    case 'hexbinder': {
      const skull = fxFrames('fx:berserker:fear')[0] ?? null;
      for (let k = 0; k < 5 * scale; k++) c.ps.spawn({ kind: PK.Wisp, spr: skull, x: c.x + (k - 2) * 8, y: c.y - 6, vy: -24 - R() * 10, max: 1.4, col: 0xe8d0ff, col2: 0x9a5ad0, d: c.d + (k % 2 ? 3 : -3), wob: 3, wobF: 3 });
      break;
    }
    case 'artificer':
      for (let k = 0; k < 6 * scale; k++) c.ps.spawn({ kind: PK.SprBlend, spr: GEARS[(k % 2) * 2]!, spr2: GEARS[(k % 2) * 2 + 1]!, x: c.x, y: c.y - 6, vx: (R() - 0.5) * 60, vy: -40 - R() * 30, ay: 90, max: 1.2, d: c.d + (R() < 0.5 ? 3 : -3), floor: c.fy + 3 });
      break;
    case 'cryomancer':
      for (let k = 0; k < 14 * scale; k++) c.ps.spawn({ kind: PK.Spr, spr: pick(FLAKES), x: c.x, y: c.y - 8, vx: (R() - 0.5) * 70, vy: -20 - R() * 40, drag: 1.5, max: 1.4, col: 0xffffff, d: c.d + (R() < 0.5 ? 3 : -3) });
      break;
    default:
      break;
  }
}

/** Grey dust from a dormant plinth (a locked hero was picked). */
export function dustPuff(c: PortalCtx): void {
  for (let k = 0; k < 10; k++) {
    const a = R() * Math.PI * 2;
    c.ps.spawn({ kind: PK.Puff, x: c.x + Math.cos(a) * 14, y: c.y + Math.sin(a) * 6 + 4, vx: Math.cos(a) * 8, vy: -4 - R() * 4, max: 0.9 + R() * 0.4, col: 0x8a8078, d: c.d + (Math.sin(a) > 0 ? 3 : -3) });
  }
}

// ---------------------------------------------------------------- persistent class pieces

export interface SpecialState { bolt: number; boltSeed: number; slash: number; slashX: number; slashY: number; shaft: number }
export const newSpecial = (): SpecialState => ({ bolt: 0, boltSeed: 1, slash: 0, slashX: 0, slashY: 0, shaft: 0 });

function jag(r: Raster, x0: number, y0: number, x1: number, y1: number, seed: number, col: number, core: number, a: number, d: number): void {
  let px = x0, py = y0;
  const segs = 5;
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let k = 1; k <= segs; k++) {
    const t = k / segs;
    const nx = k === segs ? x1 : x0 + (x1 - x0) * t + (rnd() - 0.5) * 7;
    const ny = k === segs ? y1 : y0 + (y1 - y0) * t + (rnd() - 0.5) * 4;
    r.line(Math.round(px), Math.round(py), Math.round(nx), Math.round(ny), col, a * 0.7, d);
    r.line(Math.round(px) + 1, Math.round(py), Math.round(nx) + 1, Math.round(ny), col, a * 0.35, d);
    r.line(Math.round(px), Math.round(py), Math.round(nx), Math.round(ny), core, a, d);
    px = nx; py = ny;
  }
}

/**
 * Animated class pieces drawn every frame around a lit portal: storm bolts, ice crystals, holy shafts, the hex
 * sigil, wind spirals, the spirit wolf, rage flames, the earth crack, crimson slashes, the cog ring and tesla arcs.
 * `grow` (0..1) eases solid pieces in when the hero is chosen.
 */
export function drawSpecial(c: PortalCtx, st: SpecialState, r: Raster, dt: number, grow: number): void {
  const P = c.power, t = c.t;
  if (P <= 0.05) return;
  const f = flavorOf(c.cls);
  switch (c.cls) {
    case 'arcanist': {
      st.bolt -= dt;
      if (st.bolt <= 0 && P >= 0.8) { st.bolt = 0.25 + R() * 0.55; st.boltSeed = 1 + Math.floor(R() * 1e6); }
      if (st.bolt > 0.12 + (P >= 1.5 ? 0.2 : 0)) {
        const h = 26 + (st.boltSeed % 30);
        const ox = ((st.boltSeed >> 3) % 15) - 7;
        jag(r, c.x + ox, c.y - 2, c.x - ox, c.y - h, st.boltSeed, 0xa070ff, 0xd8f0ff, Math.min(1, P), c.d - 1);
      }
      break;
    }
    case 'cryomancer': {
      // ice crystals ringing the plinth on the floor, grown in when chosen
      const spikes = fxFrames('fx:cryomancer:spike'), clusters = fxFrames('fx:cryomancer:cluster');
      if (!spikes.length) break;
      const g = Math.min(1, grow) * Math.min(1, P);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + 0.35;
        const p = onFloorRing(c, a, 24, 11);
        const s = k % 2 ? spikes[k % spikes.length]! : clusters[k % clusters.length] ?? spikes[0]!;
        const reveal = Math.max(0, Math.min(1, g * 1.6 - k * 0.08));
        if (reveal <= 0) continue;
        const sx = Math.round(p.x - s.w / 2), sy = Math.round(p.y - s.h + 2 + (1 - reveal) * s.h);
        r.sprBlend(s, sx, sy, 1, p.d, k % 3 === 0, 0.95);
        if (P >= 0.8 && Math.sin(t * 2 + k * 1.7) > 0.96) r.add(sx + (s.w >> 1), sy + 2, 0xffffff, 1, p.d + 0.1);
      }
      break;
    }
    case 'templar': {
      // shafts of holy light falling around the hero
      for (let k = 0; k < 3; k++) {
        const ph = t * 0.9 + k * 2.1;
        const a = Math.max(0, Math.sin(ph)) * 0.7 * Math.min(1, P);
        if (a < 0.05) continue;
        const sx = Math.round(c.x + (k - 1) * 14 + Math.sin(ph * 0.3) * 3);
        for (let y = Math.max(0, c.y - 150); y < c.y + 4; y++) {
          const v = (y - (c.y - 150)) / 154;
          r.add(sx, y, 0xfff8e8, a * v, c.d - 2);
          r.add(sx + 1, y, 0xffd76a, a * v * 0.6, c.d - 2);
          r.add(sx - 1, y, 0xffd76a, a * v * 0.35, c.d - 2);
        }
      }
      break;
    }
    case 'hexbinder': {
      const sig = fxFrames('fx:hexbinder:sigil')[0];
      if (sig) r.sprAdd(sig, Math.round(c.x - sig.w / 2), Math.round(c.fy - sig.h / 2 + 1), (0.45 + 0.2 * Math.sin(t * 3)) * Math.min(1, P), c.fy - 20, false, 0x9a5ad0, 0.4);
      break;
    }
    case 'ranger': {
      // two wind ribbons spiralling up around the hero
      for (let k = 0; k < 2; k++) {
        for (let s = 0; s < 22; s++) {
          const u = s / 22;
          const a = t * 4.5 + k * Math.PI + u * 5.5;
          const x = c.x + Math.cos(a) * (14 - u * 5), y = c.y - 2 - u * 46 + Math.sin(a) * 4;
          const fs = Math.sin(a) > 0;
          const wa = (0.95 - Math.abs(u - 0.45) * 1.4) * Math.min(1, P);
          r.add(Math.round(x), Math.round(y), u < 0.5 ? 0xeaf6ff : 0xc8f0a8, wa, c.d + (fs ? 3 : -3));
          r.add(Math.round(x) + (fs ? 1 : -1), Math.round(y), 0xa8e878, wa * 0.45, c.d + (fs ? 3 : -3));
        }
      }
      break;
    }
    case 'warden': {
      // the spirit wolf runs a lap of the floor around the plinth
      const wf = wolfFrames();
      const a = t * 2.2;
      const p = onFloorRing(c, a, 30, 12);
      const vx = -Math.sin(a);
      const fr = wf[Math.floor(t * 12) % wf.length]!;
      r.sprBlend(fr, Math.round(p.x - 24), Math.round(p.y - 40), 0.55 * Math.min(1, P), p.d, vx < 0, 1.2);
      r.sprAdd(fr, Math.round(p.x - 24), Math.round(p.y - 40), 0.55 * Math.min(1, P), p.d, vx < 0, 0x9affc8, 0.6);
      break;
    }
    case 'berserker': {
      const rage = fxFrames('fx:berserker:rage');
      if (rage.length) r.sprAdd(rage[Math.floor(t * 12) % rage.length]!, Math.round(c.x - 20), Math.round(c.y - 49), 0.65 * Math.min(1, P), c.d - 1);
      break;
    }
    case 'vanguard': {
      const crack = fxFrames('fx:vanguard:crack')[0];
      if (crack) r.sprAdd(crack, Math.round(c.x - crack.w / 2), Math.round(c.fy - crack.h / 2 + 2), (0.5 + 0.25 * Math.sin(t * 4)) * Math.min(1, P) * Math.min(1, grow * 1.5), c.fy - 30, false, 0xffa830, 0.5);
      break;
    }
    case 'duelist': {
      st.slash -= dt;
      if (st.slash <= -1.1 && P >= 0.8) { st.slash = 0.28; st.slashX = (R() - 0.5) * 10; st.slashY = (R() - 0.5) * 8; }
      if (st.slash > 0) {
        const xs = fxFrames('fx:duelist:xslash');
        const fr = xs[Math.min(xs.length - 1, Math.floor((1 - st.slash / 0.28) * xs.length))];
        if (fr) r.sprAdd(fr, Math.round(c.x - 24 + st.slashX), Math.round(c.y - 44 + st.slashY), 0.9, c.d + 4);
      }
      break;
    }
    case 'artificer': {
      const cog = fxFrames('fx:artificer:cog');
      if (cog.length) r.sprAdd(cog[Math.floor(t * 8) % cog.length]!, Math.round(c.x - 24), Math.round(c.fy - 13 + 1), 0.7 * Math.min(1, P), c.fy - 14, false, 0xd8a850, 0.2);
      st.bolt -= dt;
      if (st.bolt <= 0 && P >= 0.8) { st.bolt = 0.18 + R() * 0.5; st.boltSeed = 1 + Math.floor(R() * 1e6); }
      if (st.bolt > 0.1) {
        const a0 = (st.boltSeed % 628) / 100, a1 = a0 + 1.4 + (st.boltSeed % 7) * 0.2;
        const p0 = onFloorRing(c, a0, 22, 10), p1 = { x: c.x + (st.boltSeed % 2 ? 6 : -6), y: c.y - 22 };
        jag(r, p0.x, p0.y - 1, p1.x, p1.y, st.boltSeed, 0x5ae8d4, 0xe0fff8, Math.min(1, P), Math.max(p0.d, c.d) + 1);
        void a1;
      }
      break;
    }
  }
  void f;
}
