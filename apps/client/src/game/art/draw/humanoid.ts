/**
 * Player class sprites (Vanguard, Arcanist): 48x48 frames posed on the 2.5D rig, drawn as layered
 * shaded shapes, outlined, then overlaid with trails/sparks. Pure (no DOM / Phaser).
 */
import { MATERIALS, PALETTES } from '../palette';
import {
  Painter,
  PixelBuffer,
  flash,
  lighten,
  mix,
  rng,
  shatter,
  smear,
  sparkle,
  type Ramp,
} from './pixel';
import { Proj, VIEW_ANGLE, clamp, drawParts, hull, lerp, rot, type Part, type Pt, type View } from './rig';

export type HeroClass = 'vanguard' | 'arcanist' | 'duelist' | 'hexbinder' | 'artificer' | 'templar' | 'berserker' | 'cryomancer' | 'ranger' | 'warden';
export type HeroState = 'idle' | 'run' | 'attack' | 'cast' | 'dodge' | 'hit' | 'downed' | 'revive' | 'death';
type V3 = [number, number, number];

const FW = 48;
const FH = 48;
const CX = 24;
const GY = 42;
const HIP = 9;
const SH = 19;
const HEAD = 27;

export interface HPose {
  bob: number;
  lean: number;
  side: number;
  twist: number;
  squash: number;
  footL: V3;
  footR: V3;
  handL: V3;
  handR: V3;
  /** right-hand item direction (local) */
  wpn: V3;
  shieldYaw: number;
  headF: number;
  headZ: number;
  cape: number;
  glow: number;
  /** horizontal weapon trail arc: [fromAngle, toAngle, z, strength] (0 = forward, + = right) */
  trail: [number, number, number, number] | null;
  /** >= 0: curled roll pose with this rotation phase */
  ball: number;
  flare: number;
  hem: number;
  hatSway: number;
  kneel: boolean;
  shieldDown: boolean;
  sparks: number;
  prism: number;
  /** afterimage smear strength for dashes */
  blur: number;
  /** cast ring burst 0..1 */
  burst: number;
  /** left-hand item direction (duelist off-hand blade) */
  wpnL: V3;
  /** second weapon trail (off-hand) */
  trail2: [number, number, number, number] | null;
  /** artificer bomb: 0 none, 1 in hand, 2/3 in flight */
  bomb: number;
  /** artificer backpack steam 0..1 */
  steam: number;
  /** weapon gleam sparkle on the impact frame */
  gleam: boolean;
  /** bowstring draw 0..1 (ranger) */
  pull: number;
}

function n3(x: number, y: number, z: number): V3 {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function basePose(cls: HeroClass): HPose {
  const v = cls === 'vanguard';
  return {
    bob: 0,
    lean: 0,
    side: 0,
    twist: 0,
    squash: 1,
    footL: [0.3, -2.7, 0],
    footR: [-0.3, 2.7, 0],
    handL: v ? [4.6, -4.4, 12.5] : [2.2, -5.6, 12.5],
    handR: v ? [2.4, 6.6, 12] : [1.6, 6.2, 13],
    wpn: v ? n3(0.62, 0.18, 0.78) : n3(0.12, 0.06, 1),
    shieldYaw: -0.32,
    headF: 0,
    headZ: 0,
    cape: 0.15,
    glow: 0,
    trail: null,
    ball: -1,
    flare: 0,
    hem: 0,
    hatSway: 0,
    kneel: false,
    shieldDown: false,
    sparks: 0,
    prism: 0,
    blur: 0,
    burst: 0,
    wpnL: n3(0.5, -0.3, -0.75),
    trail2: null,
    bomb: 0,
    steam: 0.3,
    gleam: false,
    pull: 0,
  };
}

/** Interpolate numeric pose fields (used for revive transitions). */
function blendPose(a: HPose, b: HPose, t: number): HPose {
  const o = { ...a };
  const keys: (keyof HPose)[] = ['bob', 'lean', 'side', 'twist', 'squash', 'shieldYaw', 'headF', 'headZ', 'cape', 'glow', 'hem', 'hatSway', 'prism', 'pull'];
  for (const k of keys) (o as Record<string, unknown>)[k] = lerp(a[k] as number, b[k] as number, t);
  const v3 = (p: V3, q: V3): V3 => [lerp(p[0], q[0], t), lerp(p[1], q[1], t), lerp(p[2], q[2], t)];
  o.footL = v3(a.footL, b.footL);
  o.footR = v3(a.footR, b.footR);
  o.handL = v3(a.handL, b.handL);
  o.handR = v3(a.handR, b.handR);
  const w = v3(a.wpn, b.wpn);
  o.wpn = n3(w[0], w[1], w[2]);
  const wl = v3(a.wpnL, b.wpnL);
  o.wpnL = n3(wl[0], wl[1], wl[2]);
  o.kneel = t < 0.5 ? a.kneel : b.kneel;
  o.shieldDown = t < 0.5 ? a.shieldDown : b.shieldDown;
  return o;
}

// ------------------------------------------------------------------ poses per state

function heroPoseRaw(cls: HeroClass, state: HeroState, i: number, n: number): HPose {
  if (cls === 'duelist') return duelistPose(state, i, n);
  if (cls === 'artificer') return artificerPose(state, i, n);
  if (cls === 'hexbinder') return hexbinderPose(state, i, n);
  if (cls === 'templar') return templarPose(state, i, n);
  if (cls === 'berserker') return berserkerPose(state, i, n);
  if (cls === 'ranger') return rangerPose(state, i, n);
  if (cls === 'warden') return wardenPose(state, i, n);
  if (cls === 'cryomancer') return cryomancerPose(state, i, n);
  const p = basePose(cls);
  const v = cls === 'vanguard';
  switch (state) {
    case 'idle': {
      const ph = (i / n) * Math.PI * 2;
      p.bob = i === 1 || i === 2 ? -0.6 : 0;
      p.handR[2] += i === 1 || i === 2 ? -0.5 : 0;
      p.handL[2] += i === 2 || i === 3 ? -0.5 : 0;
      p.cape = 0.15 + 0.1 * Math.sin(ph);
      p.hem = 0.3 * Math.sin(ph);
      p.hatSway = 0.6 * Math.sin(ph);
      p.prism = Math.round(Math.sin(ph) * 1.2);
      break;
    }
    case 'run': {
      const ph = (i / n) * Math.PI * 2;
      const s = Math.sin(ph);
      const c = Math.cos(ph);
      p.footR = [4.6 * s, 2.6, Math.max(0, c) * 2.6];
      p.footL = [-4.6 * s, -2.6, Math.max(0, -c) * 2.6];
      p.bob = 0.7 - Math.abs(s) * 1.7;
      p.lean = 1.8;
      p.twist = -0.14 * s;
      p.cape = 0.65 + 0.3 * Math.sin(ph * 2);
      p.hem = -0.8 + 0.4 * Math.sin(ph * 2);
      p.hatSway = 1.6 + Math.sin(ph * 2) * 0.8;
      p.prism = Math.round(Math.sin(ph) * 1.2);
      if (v) {
        p.handR = [2.2 - 3 * s, 6.4, 12.5 + Math.abs(s)];
        p.handL = [4.8 + 0.6 * s, -4.2, 13];
        p.wpn = n3(0.8, 0.25, 0.55);
      } else {
        p.handR = [2.6 - 1.5 * s, 6, 13];
        p.handL = [1.5 + 3 * s, -5.6, 12.5 + Math.abs(s)];
        p.wpn = n3(0.42, 0.05, 1);
      }
      break;
    }
    case 'attack': {
      if (v) {
        const frames: [number, number, V3, number, number, number, [number, number, number, number] | null][] = [
          // swingAngle, handZ, weaponDir, twist, lean, squash, trail
          [2.0, 20, n3(-0.4, 0.5, 1), 0.5, -0.6, 0.94, null],
          [2.3, 23, n3(-0.6, 0.3, 1), 0.62, -0.8, 0.9, null],
          [1.0, 16, n3(0.55, 0.8, 0.1), 0.25, 1.6, 1.0, [2.4, 0.85, 15, 0.8]],
          [-0.35, 13, n3(0.85, -0.45, -0.1), -0.35, 2.6, 1.02, [1.7, -0.5, 13, 1]],
          [-1.05, 11, n3(0.2, -0.9, -0.45), -0.5, 1.8, 0.96, [0.4, -1.15, 11, 0.45]],
          [0.4, 12, n3(0.7, 0.3, 0.6), -0.1, 0.4, 1, null],
        ];
        const f = frames[Math.min(i, frames.length - 1)]!;
        const a = f[0];
        p.handR = [Math.cos(a) * 6.2 + 1, Math.sin(a) * 6.2 + 1.2, f[1]];
        p.wpn = f[2];
        p.twist = f[3];
        p.lean = f[4];
        p.squash = f[5];
        p.trail = f[6];
        p.handL = [3, -4.8, 13];
        p.shieldYaw = -0.55;
        if (i >= 2 && i <= 4) {
          p.footL = [2.6, -2.8, 0];
          p.footR = [-1.6, 2.8, 0];
        }
        if (i <= 1) p.bob = -0.8;
        p.cape = i >= 2 && i <= 4 ? 0.7 : 0.25;
      } else {
        const frames: [V3, V3, number, number, number][] = [
          // hand, staff dir, twist, lean, flare
          [[-0.5, 6, 15], n3(-0.45, 0.1, 1), 0.35, -0.8, 0.2],
          [[-1.2, 5.6, 17], n3(-0.6, 0.15, 1), 0.45, -1.1, 0.35],
          [[6, 3.4, 16], n3(1, -0.15, 0.42), -0.25, 2.2, 1],
          [[6.6, 3, 15.5], n3(1, -0.2, 0.32), -0.3, 2.4, 0.85],
          [[4, 4.6, 14], n3(0.6, 0, 0.8), -0.1, 1.2, 0.4],
          [[2, 6, 13], n3(0.25, 0.05, 1), 0, 0.3, 0.1],
        ];
        const f = frames[Math.min(i, frames.length - 1)]!;
        p.handR = f[0];
        p.wpn = f[1];
        p.twist = f[2];
        p.lean = f[3];
        p.flare = f[4];
        p.handL = i >= 2 && i <= 3 ? [3, -6, 15] : [1.5, -5.6, 13];
        if (i === 2 || i === 3) p.trail = [0.5, -0.35, 22, i === 2 ? 0.9 : 0.4];
        if (i >= 2 && i <= 3) p.footL = [2.4, -2.8, 0];
        p.hem = i >= 2 ? -0.6 : 0.4;
        p.hatSway = i >= 2 ? 2 : -1;
      }
      break;
    }
    case 'cast': {
      const glow = [0.25, 0.6, 1, 0.9, 0.55, 0.15][i] ?? 0;
      p.glow = glow;
      p.sparks = i >= 1 && i <= 4 ? 4 + i : 0;
      if (v) {
        const frames: [V3, V3, number, number, number][] = [
          [[3, 5, 11], n3(0.6, 0.2, 0.7), 0.88, 0.6, -1.2],
          [[1, 2.5, 23], n3(-0.5, -0.1, 0.85), 1.02, -0.6, 0],
          [[0.5, 2, 24.5], n3(-0.62, -0.1, 0.78), 1.04, -0.8, 0.4],
          [[7, 2, 7], n3(0.9, 0, -0.45), 0.84, 2.8, -1.6],
          [[7, 2, 7], n3(0.9, 0, -0.45), 0.86, 2.6, -1.4],
          [[3, 5.5, 11], n3(0.6, 0.2, 0.7), 0.97, 0.6, -0.3],
        ];
        const f = frames[Math.min(i, frames.length - 1)]!;
        p.handR = f[0];
        p.wpn = f[1];
        p.squash = f[2];
        p.lean = f[3];
        p.bob = f[4];
        p.handL = i === 1 || i === 2 ? [3, -4, 20] : [4.5, -4.6, 12];
        p.shieldYaw = i === 1 || i === 2 ? -0.1 : -0.35;
        p.burst = i === 3 ? 0.5 : i === 4 ? 1 : 0;
        p.cape = i === 3 ? 0.9 : 0.3;
      } else {
        const frames: [V3, V3, V3, number, number][] = [
          [[2, 6, 13], [2.5, -5, 14], n3(0.2, 0.05, 1), 0.92, -0.6],
          [[1.5, 4.5, 16.5], [2.5, -5, 20], n3(0.25, 0.1, 1), 1, 0],
          [[1, 3.6, 17.5], [1.5, -4.6, 24], n3(0.3, 0.15, 1), 1.02, 0.3],
          [[2, 3.4, 18], [2.6, -5.6, 23], n3(0.35, 0.15, 1), 1.02, 0.3],
          [[2, 4.5, 16.5], [2.5, -5.4, 18], n3(0.25, 0.1, 1), 1, 0],
          [[1.8, 6, 14], [2.2, -5.6, 13], n3(0.12, 0.06, 1), 0.98, 0],
        ];
        const f = frames[Math.min(i, frames.length - 1)]!;
        p.handR = f[0];
        p.handL = f[1];
        p.wpn = f[2];
        p.squash = f[3];
        p.bob = f[4];
        p.flare = glow;
        p.burst = i === 3 ? 0.6 : i === 4 ? 1 : 0;
        p.hem = i >= 2 && i <= 3 ? 0.8 : 0;
        p.prism = i >= 1 && i <= 3 ? -2 : 0;
      }
      break;
    }
    case 'dodge': {
      if (v) {
        if (i === 0) {
          p.squash = 0.84;
          p.lean = 3;
          p.bob = -2;
          p.footL = [2.5, -2.8, 0];
          p.footR = [-2, 2.8, 0];
          p.handR = [5, 5, 9];
          p.handL = [5, -4, 10];
          p.cape = 0.6;
        } else if (i === 3) {
          p.squash = 0.9;
          p.lean = 1.5;
          p.bob = -1;
          p.cape = 0.8;
          p.blur = 0.4;
        } else {
          p.ball = i === 1 ? 0 : Math.PI * 0.75;
          p.blur = 1;
        }
      } else {
        const lean = [2.4, 4, 4, 1.6][i] ?? 0;
        p.lean = lean;
        p.bob = [-1, -2.2, -2.2, -0.5][i] ?? 0;
        p.squash = [0.92, 0.88, 0.9, 0.97][i] ?? 1;
        p.blur = i === 1 || i === 2 ? 1 : i === 3 ? 0.4 : 0;
        p.hem = -1.6;
        p.hatSway = 3;
        p.footL = [3, -2.6, 0.5];
        p.footR = [-3, 2.6, 1.2];
        p.handR = [-1, 6.2, 12];
        p.wpn = n3(-0.7, 0.1, 0.7);
        p.handL = [-1, -5.6, 12];
      }
      break;
    }
    case 'hit': {
      p.lean = -2.2;
      p.headF = -0.8;
      p.headZ = 0.4;
      p.twist = 0.15;
      p.bob = 0.3;
      p.handR = v ? [0.6, 7.2, 13.5] : [0, 6.8, 14];
      p.handL = v ? [2.5, -5.6, 13.5] : [0, -6.6, 15];
      p.cape = 0.5;
      p.hem = 0.8;
      p.hatSway = -2;
      if (i === 1) {
        p.lean = -1.2;
        p.headF = -0.4;
      }
      break;
    }
    case 'downed': {
      p.kneel = true;
      p.bob = i === 0 ? -5 : -5.5;
      p.lean = 2.2;
      p.headF = 1.2;
      p.headZ = -1.8;
      p.footR = [-3.6, 2.7, 0];
      p.footL = [2.2, -2.7, 0];
      p.cape = 0.05;
      p.hem = 0.2;
      p.hatSway = -1.5;
      if (v) {
        p.handR = [4.5, 5.5, 8.5];
        p.wpn = n3(0.85, 0.45, -0.15);
        p.handL = [2.5, -6.2, 4];
        p.shieldDown = true;
      } else {
        p.handR = [3.5, 5.6, 4];
        p.wpn = n3(0.9, 0.25, 0.08);
        p.handL = [3, -4.6, 5];
      }
      break;
    }
    case 'revive': {
      const t = (i + 1) / n;
      const down = heroPose(cls, 'downed', 0, 2);
      const up = basePose(cls);
      const o = blendPose(down, up, Math.min(1, t * 1.15));
      o.glow = 1 - t * 0.6;
      o.sparks = 8 - i;
      return o;
    }
    case 'death': {
      return heroPose(cls, 'hit', 0, 2);
    }
    default:
      break;
  }
  return p;
}

// ------------------------------------------------------------------ animation layer

/**
 * 8-frame attacks are built from each class's 6 authored key poses: anticipation, a blended smear
 * frame into the swing, impact (with weapon gleam), a held follow-through and recovery.
 */
const ATTACK8_KEYS = [0, 1, 1.5, 2, 3, 3.5, 4, 5];

/** Public pose entry: adds the animation layer (smears, breathing, lagging cloth) on top of the raw key poses. */
export function heroPose(cls: HeroClass, state: HeroState, i: number, n: number): HPose {
  if (state === 'attack' && n === 8) {
    const k = ATTACK8_KEYS[i] ?? 5;
    const k0 = Math.floor(k);
    const fr = k - k0;
    let pose: HPose;
    if (fr === 0) pose = heroPoseRaw(cls, 'attack', k0, 6);
    else {
      const a = heroPoseRaw(cls, 'attack', k0, 6);
      const b = heroPoseRaw(cls, 'attack', Math.min(5, k0 + 1), 6);
      pose = blendPose(a, b, fr);
      pose.trail = b.trail ? [b.trail[0], b.trail[1], b.trail[2], b.trail[3] * 0.85] : a.trail;
      pose.trail2 = b.trail2 ? [b.trail2[0], b.trail2[1], b.trail2[2], b.trail2[3] * 0.85] : a.trail2;
      pose.flare = Math.max(a.flare, b.flare * 0.7);
      if (k0 === 1) pose.blur = Math.max(pose.blur, 0.35); // smear frame into the swing
    }
    if (i === 4) pose.gleam = true;
    return pose;
  }
  const pose = heroPoseRaw(cls, state, i, n);
  const ph = (i / Math.max(1, n)) * Math.PI * 2;
  if (state === 'idle') {
    // breathing + cloth that lags the body
    pose.squash *= 1 + 0.022 * Math.sin(ph);
    pose.cape += 0.1 * Math.sin(ph - 0.9);
    pose.hem += 0.25 * Math.sin(ph - 0.9);
  } else if (state === 'run') {
    pose.cape += 0.18 * Math.sin(ph * 2 - 1.2);
    pose.hem += 0.3 * Math.sin(ph * 2 - 1.2);
    pose.hatSway += 0.5 * Math.sin(ph * 2 - 1.4);
  }
  return pose;
}

/** Weapon reach for the gleam sparkle (local units from the right hand along wpn). */
const GLEAM_REACH: Record<HeroClass, number> = { vanguard: 13, arcanist: 19, duelist: 11, hexbinder: 17, artificer: 9.5, templar: 14, berserker: 9, cryomancer: 19, ranger: 9, warden: 19 };

// ------------------------------------------------------------------ new classes: poses

/** Kneeling downed pose shared by the new classes (items handled per class). */
function kneelPose(p: HPose, i: number): void {
  p.kneel = true;
  p.bob = i === 0 ? -5 : -5.5;
  p.lean = 2.2;
  p.headF = 1.2;
  p.headZ = -1.8;
  p.footR = [-3.6, 2.7, 0];
  p.footL = [2.2, -2.7, 0];
  p.cape = 0.05;
  p.hem = 0.2;
  p.hatSway = -1.5;
  p.steam = 0;
}

function hitPose(p: HPose, i: number): void {
  p.lean = i === 0 ? -2.2 : -1.2;
  p.headF = i === 0 ? -0.8 : -0.4;
  p.headZ = 0.4;
  p.twist = 0.15;
  p.bob = 0.3;
  p.cape = 0.5;
  p.hem = 0.8;
  p.hatSway = -2;
}

function duelistBase(): HPose {
  const p = basePose('duelist');
  p.handR = [2.2, 5.3, 11.5];
  p.wpn = n3(0.55, 0.3, -0.78);
  p.handL = [2.2, -5.3, 11.5];
  p.wpnL = n3(0.55, -0.3, -0.78);
  p.cape = 0.3;
  p.footL = [1.2, -2.9, 0];
  p.footR = [-1.2, 2.9, 0];
  return p;
}

/** Duelist: lithe twin-blade assassin. Fast, sharp attacks; spinning blade whirl cast; shadow dash. */
function duelistPose(state: HeroState, i: number, n: number): HPose {
  const p = duelistBase();
  switch (state) {
    case 'idle': {
      const ph = (i / n) * Math.PI * 2;
      p.bob = i === 1 || i === 2 ? -0.5 : 0;
      p.wpn = n3(0.55, 0.3, -0.78 + Math.sin(ph) * 0.08);
      p.wpnL = n3(0.55, -0.3, -0.78 - Math.sin(ph) * 0.08);
      p.cape = 0.3 + 0.12 * Math.sin(ph);
      break;
    }
    case 'run': {
      const ph = (i / n) * Math.PI * 2;
      const s = Math.sin(ph);
      const c = Math.cos(ph);
      p.footR = [5.2 * s, 2.6, Math.max(0, c) * 3];
      p.footL = [-5.2 * s, -2.6, Math.max(0, -c) * 3];
      p.bob = 0.6 - Math.abs(s) * 1.8;
      p.lean = 2.8;
      p.twist = -0.12 * s;
      p.handR = [-1.6 - 1.4 * s, 5.4, 12];
      p.handL = [-1.6 + 1.4 * s, -5.4, 12];
      p.wpn = n3(-0.75, 0.3, -0.5);
      p.wpnL = n3(-0.75, -0.3, -0.5);
      p.cape = 0.95 + 0.25 * Math.sin(ph * 2);
      break;
    }
    case 'attack': {
      const F: { hR: V3; wR: V3; hL: V3; wL: V3; tw: number; lean: number; sq: number; tr: HPose['trail']; tr2: HPose['trail2'] }[] = [
        { hR: [-1, 6, 17], wR: n3(-0.4, 0.6, 0.7), hL: [3, -4.6, 12], wL: n3(0.7, -0.2, -0.4), tw: 0.55, lean: -0.4, sq: 0.9, tr: null, tr2: null },
        { hR: [6, -1, 14], wR: n3(0.6, -0.8, 0.1), hL: [2, -5, 12.5], wL: n3(0.6, -0.3, -0.6), tw: -0.3, lean: 2.2, sq: 1, tr: [2.1, -0.7, 14, 1], tr2: null },
        { hR: [1, 5, 12], wR: n3(0.4, 0.5, -0.7), hL: [6, 1.5, 14], wL: n3(0.6, 0.8, 0.1), tw: 0.35, lean: 2.6, sq: 1, tr: null, tr2: [-2.1, 0.7, 15, 1] },
        { hR: [7, 2, 14], wR: n3(1, 0.12, 0), hL: [7, -2, 14], wL: n3(1, -0.12, 0), tw: 0, lean: 3.2, sq: 1.02, tr: [0.6, 0.15, 14, 0.5], tr2: [-0.6, -0.15, 14, 0.5] },
        { hR: [3, 5, 12], wR: n3(0.6, 0.4, -0.6), hL: [3, -5, 12], wL: n3(0.6, -0.4, -0.6), tw: 0, lean: 1.2, sq: 1, tr: null, tr2: null },
        { hR: [2.2, 5.3, 11.5], wR: n3(0.55, 0.3, -0.78), hL: [2.2, -5.3, 11.5], wL: n3(0.55, -0.3, -0.78), tw: 0, lean: 0.3, sq: 1, tr: null, tr2: null },
      ];
      const f = F[Math.min(i, F.length - 1)]!;
      p.handR = f.hR;
      p.wpn = f.wR;
      p.handL = f.hL;
      p.wpnL = f.wL;
      p.twist = f.tw;
      p.lean = f.lean;
      p.squash = f.sq;
      p.trail = f.tr;
      p.trail2 = f.tr2;
      if (i >= 1 && i <= 3) {
        p.footL = [3, -2.8, 0];
        p.footR = [-2, 2.8, 0];
      }
      if (i === 0) p.bob = -1;
      p.cape = i >= 1 && i <= 3 ? 0.8 : 0.35;
      break;
    }
    case 'cast': {
      // blade whirl: the upper body spins, both blades held straight out, crimson trails
      const tw = [-0.5, 0.9, 2.3, 3.7, 5.1, 0][i] ?? 0;
      const prev = [-0.5, -0.5, 0.9, 2.3, 3.7, 5.1][i] ?? 0;
      p.twist = tw;
      p.handR = [0.5, 7.2, 15];
      p.wpn = n3(0.15, 1, 0.05);
      p.handL = [0.5, -7.2, 15];
      p.wpnL = n3(0.15, -1, 0.05);
      p.squash = 0.94;
      p.bob = -0.8;
      p.cape = 0.9;
      p.glow = [0.3, 0.7, 1, 0.9, 0.5, 0.1][i] ?? 0;
      p.sparks = i >= 1 && i <= 4 ? 4 : 0;
      if (i >= 1 && i <= 4) {
        p.trail = [prev + Math.PI / 2, tw + Math.PI / 2, 15, 0.9];
        p.trail2 = [prev - Math.PI / 2, tw - Math.PI / 2, 15, 0.9];
      }
      if (i === 5) {
        p.handR = [2.2, 5.3, 11.5];
        p.wpn = n3(0.55, 0.3, -0.78);
        p.handL = [2.2, -5.3, 11.5];
        p.wpnL = n3(0.55, -0.3, -0.78);
      }
      p.footL = [0.5, -3.4, 0];
      p.footR = [-0.5, 3.4, 0];
      break;
    }
    case 'dodge': {
      p.lean = [2.6, 4.6, 4.6, 1.6][i] ?? 0;
      p.bob = [-1, -2.6, -2.6, -0.5][i] ?? 0;
      p.squash = [0.9, 0.85, 0.87, 0.96][i] ?? 1;
      p.blur = i === 1 || i === 2 ? 1 : i === 3 ? 0.4 : 0;
      p.cape = 1.2;
      p.footL = [3.4, -2.6, 0.6];
      p.footR = [-3.4, 2.6, 1.4];
      p.handR = [-2, 5.6, 12];
      p.wpn = n3(-0.8, 0.2, -0.4);
      p.handL = [-2, -5.6, 12];
      p.wpnL = n3(-0.8, -0.2, -0.4);
      break;
    }
    case 'hit':
      hitPose(p, i);
      p.handR = [0.4, 7, 13.5];
      p.handL = [0.4, -7, 13.5];
      p.wpn = n3(0.2, 0.6, 0.6);
      p.wpnL = n3(0.2, -0.6, 0.6);
      break;
    case 'downed':
      kneelPose(p, i);
      p.handR = [4, 5.6, 5];
      p.wpn = n3(0.9, 0.4, -0.12);
      p.handL = [4, -5.6, 5];
      p.wpnL = n3(0.9, -0.4, -0.12);
      break;
    case 'revive': {
      const t = (i + 1) / n;
      const o = blendPose(duelistPose('downed', 0, 2), duelistBase(), Math.min(1, t * 1.15));
      o.glow = 1 - t * 0.6;
      o.sparks = 8 - i;
      return o;
    }
    case 'death':
      return duelistPose('hit', 0, 2);
    default:
      break;
  }
  return p;
}

function artificerBase(): HPose {
  const p = basePose('artificer');
  p.handR = [1.4, 3.8, 12.5];
  p.handL = [5.4, -0.6, 13.2];
  p.wpn = n3(1, 0, 0.06);
  p.footL = [0.6, -3.1, 0];
  p.footR = [-0.6, 3.1, 0];
  p.steam = 0.35;
  return p;
}

/** Artificer: goggled engineer with a brass steam pack and a heavy repeater crossbow; throws bombs. */
function artificerPose(state: HeroState, i: number, n: number): HPose {
  const p = artificerBase();
  switch (state) {
    case 'idle': {
      p.bob = i === 1 || i === 2 ? -0.5 : 0;
      p.steam = 0.3 + (i % 2) * 0.25;
      break;
    }
    case 'run': {
      const ph = (i / n) * Math.PI * 2;
      const s = Math.sin(ph);
      const c = Math.cos(ph);
      p.footR = [4.2 * s, 3, Math.max(0, c) * 2.4];
      p.footL = [-4.2 * s, -3, Math.max(0, -c) * 2.4];
      p.bob = 0.7 - Math.abs(s) * 1.6;
      p.lean = 1.5;
      p.twist = -0.08 * s;
      p.handR = [1.2, 3.8, 13 + Math.abs(s) * 0.6];
      p.handL = [5, -0.6, 13.6 + Math.abs(s) * 0.6];
      p.wpn = n3(1, 0, 0.18);
      p.steam = 0.6;
      break;
    }
    case 'attack': {
      const F: [V3, V3, number, number][] = [
        // trigger hand, fore hand, lean, flare (muzzle)
        [[2, 3.2, 15], [6, -0.4, 15.6], 0.4, 0],
        [[1.2, 3.2, 15.4], [5.2, -0.4, 16], -1.2, 1],
        [[1.5, 3.2, 15.2], [5.6, -0.4, 15.8], -0.6, 0.45],
        [[1.8, 3.4, 14.6], [2.6, -1.6, 14.6], 0, 0],
        [[1.6, 3.6, 13.6], [5, -0.6, 14], 0.2, 0],
        [[1.4, 3.8, 12.5], [5.4, -0.6, 13.2], 0, 0],
      ];
      const f = F[Math.min(i, F.length - 1)]!;
      p.handR = f[0];
      p.handL = f[1];
      p.lean = f[2];
      p.flare = f[3];
      p.wpn = n3(1, 0, i <= 2 ? 0.02 : 0.06);
      p.steam = i === 1 || i === 2 ? 1 : 0.4;
      if (i === 1) p.bob = 0.4;
      break;
    }
    case 'cast': {
      // reach for a bomb, wind up, lob it; the bomb leaves the hand on frame 2
      const F: [V3, number, number, number][] = [
        [[1, -4.6, 10], 0, 0.2, 1],
        [[-3, -4.6, 22], 0.45, -1, 1],
        [[6, -3, 19], -0.45, 2, 2],
        [[5, -3, 13], -0.2, 1.2, 3],
        [[2.2, -5, 12.5], 0, 0.4, 0],
        [[5.4, -0.6, 13.2], 0, 0, 0],
      ];
      const f = F[Math.min(i, F.length - 1)]!;
      p.handL = f[0];
      p.twist = f[1];
      p.lean = f[2];
      p.bomb = f[3];
      if (i <= 4) {
        p.handR = [0.4, 4.6, 12];
        p.wpn = n3(0.35, 0.2, -0.9);
      }
      p.glow = [0.15, 0.4, 0.8, 0.6, 0.3, 0][i] ?? 0;
      p.sparks = i === 2 || i === 3 ? 4 : 0;
      p.steam = 0.6;
      break;
    }
    case 'dodge': {
      p.lean = [2.4, 3.8, 3.8, 1.4][i] ?? 0;
      p.bob = [-1, -2.2, -2.2, -0.5][i] ?? 0;
      p.squash = [0.92, 0.88, 0.9, 0.97][i] ?? 1;
      p.blur = i === 1 || i === 2 ? 1 : i === 3 ? 0.4 : 0;
      p.footL = [3, -2.8, 0.5];
      p.footR = [-3, 2.8, 1.2];
      p.steam = 1;
      break;
    }
    case 'hit':
      hitPose(p, i);
      p.handR = [0.4, 4.6, 14];
      p.handL = [3.6, -1.2, 15];
      break;
    case 'downed':
      kneelPose(p, i);
      p.handR = [4.5, 4, 4.5];
      p.handL = [6.5, -1, 4.5];
      p.wpn = n3(0.95, 0.2, -0.05);
      break;
    case 'revive': {
      const t = (i + 1) / n;
      const o = blendPose(artificerPose('downed', 0, 2), artificerBase(), Math.min(1, t * 1.15));
      o.glow = 1 - t * 0.6;
      o.sparks = 8 - i;
      return o;
    }
    case 'death':
      return artificerPose('hit', 0, 2);
    default:
      break;
  }
  return p;
}

/** Hexbinder: a hunched warlock; staff poses are the arcanist's with a gaunt stoop. */
function hexbinderPose(state: HeroState, i: number, n: number): HPose {
  const p = heroPoseRaw('arcanist', state, i, n);
  if (state !== 'dodge' && state !== 'downed') {
    p.lean += 0.9;
    p.headF += 1;
    p.headZ -= 1.4;
  }
  if (state === 'idle' || state === 'run') p.prism = Math.round(Math.sin((i / n) * Math.PI * 2) * 1.5);
  return p;
}

// ------------------------------------------------------------------ templar / berserker / cryomancer / ranger / warden poses

type KeyFrame = { hR?: V3; hL?: V3; w?: V3; wL?: V3; tw?: number; lean?: number; sq?: number; bob?: number; tr?: HPose['trail']; tr2?: HPose['trail2']; flare?: number; burst?: number; blur?: number; pull?: number; glow?: number; sparks?: number };

function applyKey(p: HPose, f: KeyFrame): void {
  if (f.hR) p.handR = f.hR;
  if (f.hL) p.handL = f.hL;
  if (f.w) p.wpn = f.w;
  if (f.wL) p.wpnL = f.wL;
  if (f.tw !== undefined) p.twist = f.tw;
  if (f.lean !== undefined) p.lean = f.lean;
  if (f.sq !== undefined) p.squash = f.sq;
  if (f.bob !== undefined) p.bob = f.bob;
  if (f.tr !== undefined) p.trail = f.tr;
  if (f.tr2 !== undefined) p.trail2 = f.tr2;
  if (f.flare !== undefined) p.flare = f.flare;
  if (f.burst !== undefined) p.burst = f.burst;
  if (f.blur !== undefined) p.blur = f.blur;
  if (f.pull !== undefined) p.pull = f.pull;
  if (f.glow !== undefined) p.glow = f.glow;
  if (f.sparks !== undefined) p.sparks = f.sparks;
}

/** Shared state machine for the martial heroes: a base pose + per-class key tables. */
function martialPose(
  base: () => HPose,
  keys: { run: (p: HPose, s: number, c: number) => void; attack: KeyFrame[]; cast: KeyFrame[]; downed: KeyFrame; hit: KeyFrame },
  state: HeroState,
  i: number,
  n: number,
  self: (state: HeroState, i: number, n: number) => HPose,
): HPose {
  const p = base();
  switch (state) {
    case 'idle':
      p.bob = i === 1 || i === 2 ? -0.5 : 0;
      break;
    case 'run': {
      const ph = (i / n) * Math.PI * 2;
      const s = Math.sin(ph);
      const c = Math.cos(ph);
      p.footR = [4.6 * s, 2.7, Math.max(0, c) * 2.6];
      p.footL = [-4.6 * s, -2.7, Math.max(0, -c) * 2.6];
      p.bob = 0.7 - Math.abs(s) * 1.7;
      p.lean = 1.8;
      p.twist = -0.12 * s;
      p.cape = 0.75 + 0.25 * Math.sin(ph * 2);
      p.hem = -0.8 + 0.4 * Math.sin(ph * 2);
      keys.run(p, s, c);
      break;
    }
    case 'attack':
      applyKey(p, keys.attack[Math.min(i, keys.attack.length - 1)]!);
      if (i >= 2 && i <= 4) {
        p.footL = [2.6, -2.8, 0];
        p.footR = [-1.8, 2.8, 0];
      }
      p.cape = i >= 2 && i <= 4 ? 0.8 : 0.3;
      break;
    case 'cast':
      applyKey(p, keys.cast[Math.min(i, keys.cast.length - 1)]!);
      p.cape = 0.5;
      break;
    case 'dodge':
      p.lean = [2.4, 4, 4, 1.5][i] ?? 0;
      p.bob = [-1, -2.4, -2.4, -0.5][i] ?? 0;
      p.squash = [0.9, 0.86, 0.88, 0.96][i] ?? 1;
      p.blur = i === 1 || i === 2 ? 1 : i === 3 ? 0.4 : 0;
      p.cape = 1.1;
      p.hem = -1.6;
      p.footL = [3, -2.7, 0.5];
      p.footR = [-3, 2.7, 1.2];
      break;
    case 'hit':
      hitPose(p, i);
      applyKey(p, keys.hit);
      break;
    case 'downed':
      kneelPose(p, i);
      applyKey(p, keys.downed);
      break;
    case 'revive': {
      const t = (i + 1) / n;
      const o = blendPose(self('downed', 0, 2), base(), Math.min(1, t * 1.15));
      o.glow = 1 - t * 0.6;
      o.sparks = 8 - i;
      return o;
    }
    case 'death':
      return self('hit', 0, 2);
    default:
      break;
  }
  return p;
}

function templarBase(): HPose {
  const p = basePose('templar');
  p.handR = [2.6, 5.2, 13];
  p.handL = [2.4, -5.2, 12.5];
  p.wpn = n3(-0.5, 0.15, 0.85);
  p.cape = 0.2;
  return p;
}

/** Templar: great two-handed hammer; overhead smash with a holy shockwave. */
function templarPose(state: HeroState, i: number, n: number): HPose {
  return martialPose(
    templarBase,
    {
      run: (p, s) => {
        p.handR = [1.4, 4.4, 16 + Math.abs(s) * 0.5];
        p.handL = [3, 2, 13];
        p.wpn = n3(-0.6, 0.15, 0.78);
      },
      attack: [
        { hR: [0, 3, 23], hL: [0.6, 1.4, 21], w: n3(-0.8, 0, 0.6), tw: 0.2, lean: -1.2, sq: 0.92, bob: -0.6 },
        { hR: [-0.5, 2.6, 25], hL: [0, 1.2, 23], w: n3(-0.95, 0, 0.3), tw: 0.25, lean: -1.5, sq: 0.9 },
        { hR: [5, 2, 18], hL: [5.6, 0.8, 19.5], w: n3(0.72, 0, 0.7), tw: 0, lean: 1.6, sq: 1.02, blur: 0.3 },
        { hR: [7, 2, 8], hL: [7.5, 0.8, 10], w: n3(0.9, 0, -0.42), tw: -0.1, lean: 3, sq: 0.88, bob: -1.4, burst: 0.55 },
        { hR: [7, 2, 8], hL: [7.5, 0.8, 10], w: n3(0.9, 0, -0.42), tw: -0.1, lean: 2.6, sq: 0.9, bob: -1, burst: 1 },
        { hR: [2.6, 5, 13], hL: [2.6, -5, 12.5], w: n3(-0.4, 0.15, 0.9), lean: 0.4 },
      ],
      cast: [
        { hR: [2, 3.4, 13], hL: [3, 1.6, 16], w: n3(0.3, -0.3, 0.9), sq: 0.92, bob: -1, glow: 0.3 },
        { hR: [1, 2.6, 22], hL: [1.4, 1.2, 25], w: n3(0.05, 0, 1), glow: 0.7, sparks: 5 },
        { hR: [0.8, 2.4, 24], hL: [1.2, 1, 27], w: n3(0.05, 0, 1), glow: 1, sparks: 7, sq: 1.04 },
        { hR: [0.8, 2.4, 24], hL: [1.2, 1, 27], w: n3(0.05, 0, 1), glow: 0.9, sparks: 6, burst: 0.6 },
        { hR: [2, 3.4, 14], hL: [3, 1.6, 17], w: n3(0.3, -0.3, 0.9), glow: 0.5, burst: 1 },
        { hR: [2.6, 5.2, 13], hL: [2.4, -5.2, 12.5], w: n3(-0.5, 0.15, 0.85), glow: 0.1 },
      ],
      downed: { hR: [4.5, 4, 4], hL: [6, 2, 4], w: n3(0.95, -0.2, -0.1) },
      hit: { hR: [0.6, 5, 13], hL: [1.6, 2, 16], w: n3(-0.2, -0.3, 0.9) },
    },
    state,
    i,
    n,
    templarPose,
  );
}

function berserkerBase(): HPose {
  const p = basePose('berserker');
  p.handR = [2.2, 6.6, 11.5];
  p.wpn = n3(0.45, 0.25, 0.86);
  p.handL = [2.2, -6.6, 11.5];
  p.wpnL = n3(0.45, -0.25, 0.86);
  p.footL = [0.6, -3.3, 0];
  p.footR = [-0.6, 3.3, 0];
  return p;
}

/** Berserker: hulking dual-axe brawler; double overhead chop, roaring rage cast. */
function berserkerPose(state: HeroState, i: number, n: number): HPose {
  return martialPose(
    berserkerBase,
    {
      run: (p, s) => {
        p.handR = [2 - 2.6 * s, 6.6, 12.5];
        p.handL = [2 + 2.6 * s, -6.6, 12.5];
        p.wpn = n3(0.7, 0.3, 0.6);
        p.wpnL = n3(0.7, -0.3, 0.6);
        p.lean = 2.2;
      },
      attack: [
        { hR: [-1, 5, 24], hL: [-1, -5, 24], w: n3(-0.7, 0.2, 0.7), wL: n3(-0.7, -0.2, 0.7), lean: -1.4, sq: 0.9, bob: -0.6 },
        { hR: [-1.6, 4.6, 26], hL: [-1.6, -4.6, 26], w: n3(-0.9, 0.2, 0.4), wL: n3(-0.9, -0.2, 0.4), lean: -1.6, sq: 0.88 },
        { hR: [5, 4, 18], hL: [5, -4, 18], w: n3(0.8, 0.1, 0.6), wL: n3(0.8, -0.1, 0.6), lean: 1.8, blur: 0.3 },
        { hR: [7, 3.6, 9], hL: [7, -3.6, 9], w: n3(0.9, 0.1, -0.4), wL: n3(0.9, -0.1, -0.4), lean: 3.2, sq: 0.88, bob: -1.4, burst: 0.5 },
        { hR: [4, -3, 12], hL: [6, -4, 9], w: n3(0.3, -0.9, -0.2), wL: n3(0.9, -0.1, -0.4), tw: -0.5, lean: 2.4, tr: [1.4, -1.2, 12, 1] },
        { hR: [2.4, 6.4, 11.5], hL: [2.4, -6.4, 11.5], w: n3(0.45, 0.25, 0.86), wL: n3(0.45, -0.25, 0.86), lean: 0.6 },
      ],
      cast: [
        { hR: [2, 6, 13], hL: [2, -6, 13], sq: 0.9, bob: -1.2, lean: 1, glow: 0.3 },
        { hR: [0, 8.5, 21], hL: [0, -8.5, 21], w: n3(0, 0.5, 0.9), wL: n3(0, -0.5, 0.9), lean: -1.6, sq: 1.05, glow: 0.8, sparks: 6 },
        { hR: [0, 9, 22], hL: [0, -9, 22], w: n3(0, 0.55, 0.85), wL: n3(0, -0.55, 0.85), lean: -2, sq: 1.06, glow: 1, sparks: 8, burst: 0.5 },
        { hR: [0, 9, 22], hL: [0, -9, 22], w: n3(0, 0.55, 0.85), wL: n3(0, -0.55, 0.85), lean: -1.8, glow: 0.9, sparks: 6, burst: 1 },
        { hR: [1.6, 7, 15], hL: [1.6, -7, 15], lean: -0.5, glow: 0.5 },
        { hR: [2.2, 6.6, 11.5], hL: [2.2, -6.6, 11.5], glow: 0.1 },
      ],
      downed: { hR: [4.5, 6, 4], hL: [4.5, -6, 4], w: n3(0.9, 0.4, -0.1), wL: n3(0.9, -0.4, -0.1) },
      hit: { hR: [0.4, 8, 14], hL: [0.4, -8, 14], w: n3(0.1, 0.6, 0.7), wL: n3(0.1, -0.6, 0.7) },
    },
    state,
    i,
    n,
    berserkerPose,
  );
}

function rangerBase(): HPose {
  const p = basePose('ranger');
  p.handL = [3.2, -5.2, 13];
  p.handR = [1.4, 5.4, 12];
  p.wpn = n3(0.1, 0.05, 1);
  p.cape = 0.25;
  p.wpnL = n3(1, -0.12, -0.08);
  return p;
}

/** Ranger: hooded longbow archer; nock, draw, release, follow-through; volley cast aims skyward. */
function rangerPose(state: HeroState, i: number, n: number): HPose {
  return martialPose(
    rangerBase,
    {
      run: (p, s) => {
        p.handL = [2 + 1.5 * s, -5.4, 13];
        p.handR = [1.5 - 2.4 * s, 5.4, 12.5];
      },
      attack: [
        { hL: [5, -2.4, 17], hR: [3, 0.6, 17.5], lean: 0.4, pull: 0.2 },
        { hL: [6.4, -1.4, 18.5], hR: [0.4, 1.4, 19.5], lean: 0.6, pull: 0.7, tw: 0.15 },
        { hL: [6.8, -1.2, 19], hR: [-1.2, 1.6, 20], lean: 0.8, pull: 1, tw: 0.2 },
        { hL: [6.8, -1.2, 19], hR: [-2.8, 3, 21], lean: 0.2, pull: 0, flare: 1, tw: 0.15 },
        { hL: [6.4, -1.4, 18], hR: [-2.4, 3.6, 19], lean: 0.2, pull: 0, flare: 0.4 },
        { hL: [3.6, -5, 13.5], hR: [1.4, 5.4, 12], lean: 0 },
      ],
      cast: [
        { hL: [4.5, -2, 21], hR: [2.6, 0.8, 21], lean: -0.6, pull: 0.3, glow: 0.2, wL: n3(0.62, -0.18, 0.76) },
        { hL: [4.2, -1.4, 26], hR: [-0.6, 1.4, 22], lean: -1.4, pull: 1, glow: 0.5, wL: n3(0.62, -0.18, 0.76) },
        { hL: [4.2, -1.4, 26], hR: [-2, 3, 23], lean: -1.2, pull: 0, flare: 1, glow: 0.9, sparks: 5, wL: n3(0.62, -0.18, 0.76) },
        { hL: [4.2, -1.4, 26], hR: [-0.6, 1.4, 22], lean: -1.4, pull: 1, glow: 0.8, sparks: 4, wL: n3(0.62, -0.18, 0.76) },
        { hL: [4.2, -1.4, 26], hR: [-2, 3, 23], lean: -1.2, pull: 0, flare: 1, glow: 0.6, sparks: 5, wL: n3(0.62, -0.18, 0.76) },
        { hL: [3.2, -5.2, 13], hR: [1.4, 5.4, 12], glow: 0.1 },
      ],
      downed: { hL: [4, -5, 4], hR: [3, 5, 5] },
      hit: { hL: [1, -6.6, 15], hR: [0.4, 6.6, 14] },
    },
    state,
    i,
    n,
    rangerPose,
  );
}

function wardenBase(): HPose {
  const p = basePose('warden');
  p.handR = [1.8, 5.6, 13];
  p.wpn = n3(0.12, 0.04, 1);
  p.handL = [3.2, -4.6, 12.5];
  return p;
}

/** Warden: thorned spear; coiled thrust attack, plants the spear for a thorn-burst cast. */
function wardenPose(state: HeroState, i: number, n: number): HPose {
  return martialPose(
    wardenBase,
    {
      run: (p, s) => {
        p.handR = [2.4 - 1.2 * s, 5.4, 13.5];
        p.wpn = n3(0.55, 0, 0.84);
        p.handL = [1.8 + 2.2 * s, -5.2, 12.5];
      },
      attack: [
        { hR: [-1.5, 4.4, 15], hL: [2.2, 1.2, 15], w: n3(1, -0.1, 0.05), tw: 0.3, lean: -0.8, sq: 0.94 },
        { hR: [-3, 4, 15], hL: [0.6, 1.4, 15], w: n3(1, -0.1, 0.04), tw: 0.4, lean: -1.2, sq: 0.9 },
        { hR: [3, 3.4, 15.5], hL: [6, 0.8, 15.5], w: n3(1, -0.08, 0.02), tw: -0.1, lean: 2, blur: 0.4 },
        { hR: [6, 3, 15.5], hL: [9, 0.6, 15.5], w: n3(1, -0.06, 0), tw: -0.2, lean: 3.4, sq: 1.02 },
        { hR: [5, 3, 15], hL: [8, 0.6, 15], w: n3(1, -0.06, 0), lean: 2.8 },
        { hR: [1.8, 5.6, 13], hL: [3.2, -4.6, 12.5], w: n3(0.12, 0.04, 1), lean: 0.4 },
      ],
      cast: [
        { hR: [2, 3.6, 22], hL: [2.6, 1.4, 20], w: n3(0.1, 0, -1), lean: -0.6, sq: 1.04, glow: 0.3 },
        { hR: [2.6, 3, 24], hL: [3.2, 1.2, 22], w: n3(0.1, 0, -1), lean: -0.8, sq: 1.06, glow: 0.6, sparks: 4 },
        { hR: [3.2, 2.6, 14], hL: [3.6, 1, 12.5], w: n3(0.1, 0, -1), lean: 1.6, sq: 0.88, bob: -1.4, glow: 1, burst: 0.5, sparks: 6 },
        { hR: [3.2, 2.6, 14], hL: [3.6, 1, 12.5], w: n3(0.1, 0, -1), lean: 1.4, sq: 0.9, bob: -1, glow: 0.8, burst: 1, sparks: 5 },
        { hR: [2.4, 4, 15], hL: [3.2, -2, 13], w: n3(0.15, 0, 1), glow: 0.4 },
        { hR: [1.8, 5.6, 13], hL: [3.2, -4.6, 12.5], w: n3(0.12, 0.04, 1), glow: 0.1 },
      ],
      downed: { hR: [4, 5, 4], hL: [3, -4.6, 5], w: n3(0.9, 0.3, 0.08) },
      hit: { hR: [0.2, 6.6, 14], hL: [0.6, -6.4, 15], w: n3(-0.3, 0.1, 0.95) },
    },
    state,
    i,
    n,
    wardenPose,
  );
}

/** Cryomancer: staff caster with a flowing robe (arcanist key poses, wider hem flutter, upright). */
function cryomancerPose(state: HeroState, i: number, n: number): HPose {
  const p = heroPoseRaw('arcanist', state, i, n);
  p.hem *= 1.7;
  p.hatSway *= 1.4;
  if (state === 'idle' || state === 'run') p.prism = Math.round(Math.sin((i / n) * Math.PI * 2) * 1.2);
  return p;
}

// ------------------------------------------------------------------ renderer

interface Ctx {
  p: Painter;
  P: Proj;
  pose: HPose;
  cls: HeroClass;
  up: (f: number, r: number, z: number) => Pt;
  faceVis: number;
}

/** Points of the camera-facing half of a horizontal ellipse around a body column. */
function frontArc(c: Ctx, dp: number, w: number, z: number, steps = 10, cf = 0, cr = 0): Pt[] {
  const P = c.P;
  const thc = Math.atan2(w * P.ry, dp * P.fy);
  const out: Pt[] = [];
  for (let k = 0; k <= steps; k++) {
    const th = thc - Math.PI / 2 + (Math.PI * k) / steps;
    out.push(c.up(cf + Math.cos(th) * dp, cr + Math.sin(th) * w, z));
  }
  return out;
}

function ringPts(c: Ctx, dp: number, w: number, z: number, steps = 14, cf = 0, cr = 0): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k < steps; k++) {
    const th = (Math.PI * 2 * k) / steps;
    out.push(c.up(cf + Math.cos(th) * dp, cr + Math.sin(th) * w, z));
  }
  return out;
}

/** Band polygon on the visible front of a body column between z0 (bottom) and z1 (top). */
function band(c: Ctx, dp: number, w: number, z0: number, z1: number, cf = 0, cr = 0): number[] {
  const top = frontArc(c, dp, w, z1, 10, cf, cr);
  const bot = frontArc(c, dp, w, z0, 10, cf, cr).reverse();
  return top.concat(bot).flatMap((q) => [q.x, q.y]);
}

function drawLeg(c: Ctx, side: number, foot: V3, boot: Ramp, leg: Ramp, kneeRamp: Ramp | null): void {
  const { p, P, pose } = c;
  const hip = c.up(0, side * 2.4, HIP);
  const hipLocal: V3 = [pose.lean * 0, side * 2.4, HIP * pose.squash + pose.bob];
  let knee: Pt;
  if (pose.kneel && foot[0] < 0) {
    // kneeling leg: knee on the ground in front, shin back to the foot
    knee = P.p(foot[0] + 4.2, side * 2.6, 1);
  } else {
    const kf = (hipLocal[0] + foot[0]) / 2 + 1.1;
    const kz = (hipLocal[2] + foot[2]) / 2 + 0.6;
    knee = P.p(kf, side * 2.55, kz);
  }
  const ft = P.p(foot[0], foot[1], foot[2]);
  p.capsule(hip.x, hip.y, knee.x, knee.y, 1.9, 1.7).capsule(knee.x, knee.y, ft.x, ft.y - 1, 1.7, 1.5).fill(leg, { mode: 'cyl' });
  if (kneeRamp) p.ellipse(knee.x, knee.y, 1.7, 1.5).fill(kneeRamp, { mode: 'sphere', inner: false });
  const toe = P.p(foot[0] + 1.6, foot[1], foot[2]);
  p.ellipse((ft.x + toe.x) / 2, (ft.y + toe.y) / 2 - 0.6, 2.4, 1.6).fill(boot, { mode: 'sphere' });
}

function drawArm(c: Ctx, side: number, hand: V3, sleeve: Ramp, glove: Ramp, wide: boolean, extra?: () => void): void {
  const { p } = c;
  const sh = c.up(0, side * 5.2, SH - 0.6);
  const el = c.up((hand[0] + 0) / 2 - 0.3, (hand[1] + side * 5.2) / 2 + side * 0.9, (hand[2] + SH) / 2 - 1.4);
  const hd = c.up(hand[0], hand[1], hand[2]);
  if (wide) {
    p.capsule(sh.x, sh.y, el.x, el.y, 1.9, 2.1).capsule(el.x, el.y, hd.x, hd.y, 2.1, 2.7).fill(sleeve, { mode: 'cyl', dither: true });
  } else {
    p.capsule(sh.x, sh.y, el.x, el.y, 1.6, 1.5).capsule(el.x, el.y, hd.x, hd.y, 1.5, 1.4).fill(sleeve, { mode: 'cyl' });
  }
  if (extra) extra();
  p.ellipse(hd.x, hd.y, wide ? 1.5 : 2, wide ? 1.5 : 1.8).fill(glove, { mode: 'sphere' });
}

function cleaver(c: Ctx): void {
  const { p, pose } = c;
  const V = PALETTES.vanguard;
  const h = pose.handR;
  const w = pose.wpn;
  const at = (k: number): Pt => c.up(h[0] + w[0] * k, h[1] + w[1] * k, h[2] + w[2] * k);
  const pom = at(-2.6);
  const b = at(1.6);
  const t = at(14);
  let ux = t.x - b.x;
  let uy = t.y - b.y;
  const L = Math.hypot(ux, uy);
  if (L < 2.5) {
    ux = 0;
    uy = -1;
  } else {
    ux /= L;
    uy /= L;
  }
  let nx = -uy;
  let ny = ux;
  if (ny > 0.05 || (Math.abs(ny) <= 0.05 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  const tx = L < 2.5 ? b.x : t.x;
  const ty = L < 2.5 ? b.y - 7 : t.y;
  // grip + pommel
  p.capsule(pom.x, pom.y, b.x, b.y, 1, 1).fill(MATERIALS.leather, { mode: 'cyl' });
  p.circle(pom.x, pom.y, 1.3).fill(V.plate, { mode: 'sphere', inner: false });
  // blade (spine on +n side, flared chopping edge on -n side)
  p.poly([
    b.x + nx * 1.3, b.y + ny * 1.3,
    tx + nx * 1.3, ty + ny * 1.3,
    tx + ux * 1.4 - nx * 0.4, ty + uy * 1.4 - ny * 0.4,
    tx + ux * 0.6 - nx * 4.6, ty + uy * 0.6 - ny * 4.6,
    b.x - nx * 2.8, b.y - ny * 2.8,
  ]).fill(V.blade, { mode: 'emboss' });
  // keen edge highlight
  p.line(b.x - nx * 2.3, b.y - ny * 2.3, tx + ux * 0.4 - nx * 4.1, ty + uy * 0.4 - ny * 4.1).fill([0xffffff, 0xffffff, 0xffffff, 0xffffff], { mode: 'flat', inner: false });
  // fuller groove (teal inlay)
  p.line(b.x + ux * 2 - nx * 0.2, b.y + uy * 2 - ny * 0.2, tx - ux * 3 - nx * 0.6, ty - uy * 3 - ny * 0.6).fill(V.trim, { mode: 'flat', tone: 1, inner: false });
  // guard
  p.capsule(b.x - nx * 3.2, b.y - ny * 3.2, b.x + nx * 2.2, b.y + ny * 2.2, 1.05, 1.05).fill(V.plate, { mode: 'cyl' });
}

function staff(c: Ctx): void {
  const { p, pose } = c;
  const A = PALETTES.arcanist;
  const h = pose.handR;
  const w = pose.wpn;
  const at = (k: number): Pt => c.up(h[0] + w[0] * k, h[1] + w[1] * k, h[2] + w[2] * k);
  const bot = at(-11);
  const top = at(16);
  p.capsule(bot.x, bot.y, top.x, top.y, 0.95, 1.05).fill(A.staff, { mode: 'cyl' });
  // gold ferrules
  const f1 = at(-10.4);
  p.circle(f1.x, f1.y, 1.2).fill(A.sash, { mode: 'sphere', inner: false });
  // skull finial
  const sk = at(17.4);
  const fx = c.P.fx;
  p.ellipse(sk.x, sk.y, 2.7, 2.4).fill(A.skull, { mode: 'sphere' });
  p.rect(sk.x - 1.4 + fx * 0.6, sk.y + 1.2, 2.8, 1.4).fill(A.skull, { mode: 'emboss' });
  if (c.faceVis > -0.3) {
    p.px(sk.x - 1 + fx, sk.y, PALETTES.playerOutline).px(sk.x + 1 + fx, sk.y, PALETTES.playerOutline);
    p.px(sk.x + fx * 0.5, sk.y + 2, PALETTES.playerOutline);
  }
  // ember flame dancing on the skull (flickers per frame, flares on attack/cast)
  const s = 1 + pose.flare * 0.7;
  const fl = Math.sin(pose.prism * 2.1 + pose.hem * 3) * 0.8;
  const fb = sk.y - 2;
  p.poly([sk.x - 2.2 * s, fb, sk.x + 2.2 * s, fb, sk.x + 1.2 * s + fl * 0.3, fb - 3 * s, sk.x + fl, fb - 6.2 * s, sk.x - 1.2 * s + fl * 0.3, fb - 3 * s]).fill(A.ember, {
    mode: 'emboss',
    glow: A.ember[3]!,
    light: 0.35 + pose.flare * 0.3,
    inner: false,
  });
  p.gpx(sk.x + fl * 0.3, fb - 1.6 * s, A.ember[4]!, A.ember[3]!);
  if (pose.flare > 0.6) p.gpx(sk.x + fl * 0.6, fb - 3.5 * s, 0xffffff, A.ember[4]!);
}

function towerShield(c: Ctx): void {
  const { p, P, pose } = c;
  const V = PALETTES.vanguard;
  const h = pose.handL;
  let nf: number;
  let nr: number;
  let ox: number;
  let oy: number;
  let oz: number;
  const pts: Pt[] = [];
  const back: Pt[] = [];
  // shield outline in its own plane (u: side, v: up)
  const shape: [number, number][] = [
    [-4.6, 6.6], [-2.6, 7.8], [2.6, 7.8], [4.6, 6.6], [4.9, -3.4], [0, -8.4], [-4.9, -3.4],
  ];
  if (pose.shieldDown) {
    // lying on the ground beside the body, face up
    const cxl = h[0];
    const crl = h[1] - 2;
    for (const [u, v] of shape) pts.push(P.p(cxl + v * 0.55, crl + u * 0.9, 0.8 + (v + 8.4) * 0.6));
    p.poly(pts.flatMap((q) => [q.x, q.y])).fill(V.trim, { mode: 'emboss' });
    const inner: Pt[] = shape.map(([u, v]) => P.p(cxl + v * 0.42, crl + u * 0.68, 0.8 + (v * 0.78 + 8.4) * 0.6));
    p.poly(inner.flatMap((q) => [q.x, q.y])).fill(V.shield, { mode: 'emboss', inner: false });
    return;
  }
  [nf, nr] = rot(1, 0, pose.shieldYaw);
  const sf = -nr;
  const sr = nf;
  ox = h[0] + nf * 1.3;
  oy = h[1] + nr * 1.3;
  oz = h[2] - 1;
  for (const [u, v] of shape) {
    pts.push(c.up(ox + sf * u, oy + sr * u, oz + v));
    back.push(c.up(ox + sf * u - nf * 1.5, oy + sr * u - nr * 1.5, oz + v));
  }
  const [wnf, wnr] = rot(nf, nr, pose.twist);
  const facing = P.depthOf(wnf, wnr) > -0.08;
  const flat = (a: Pt[]): number[] => a.flatMap((q) => [q.x, q.y]);
  // slab edge
  p.poly(hull(back.concat(pts))).fill([V.trim[0]!, V.trim[0]!, V.trim[1]!, V.trim[2]!], { mode: 'emboss' });
  p.poly(flat(pts)).fill(V.trim, { mode: 'emboss', inner: false });
  const inner = shape.map(([u, v]) => c.up(ox + sf * u * 0.72, oy + sr * u * 0.72, oz + v * 0.8 + 0.4));
  if (facing) {
    p.poly(flat(inner)).fill(V.shield, { mode: 'emboss', inner: false, light: 0.05 });
    // gold sunburst crest
    const cc = c.up(ox + nf * 0.2, oy + nr * 0.2, oz + 1.6);
    const sx = Math.abs(P.halfWidth(1, 0) * sf + 0) + 0.3;
    const span = Math.max(0.6, Math.abs(c.up(ox + sf, oy + sr, oz).x - c.up(ox, oy, oz).x));
    void sx;
    // brass boss + battle dents and a scratch across the face
    p.poly([cc.x, cc.y - 2.6, cc.x + 1.5 * span, cc.y, cc.x, cc.y + 2.6, cc.x - 1.5 * span, cc.y]).fill(V.trim, { mode: 'facet', facets: 4, rot: Math.PI / 4, inner: false });
    const d1 = c.up(ox + sf * 2.2, oy + sr * 2.2, oz + 4.5);
    const d2 = c.up(ox + sf * -2.4, oy + sr * -2.4, oz - 3);
    p.px(d1.x, d1.y, V.shield[0]!).px(d1.x + 1, d1.y, V.shield[3]!).px(d2.x, d2.y, V.shield[0]!).px(d2.x, d2.y - 1, V.shield[3]!);
    const s1 = c.up(ox + sf * -3, oy + sr * -3, oz + 5.5);
    const s2 = c.up(ox + sf * 1, oy + sr * 1, oz - 1);
    p.line(s1.x, s1.y, s2.x, s2.y).fill(V.shield, { mode: 'flat', tone: 0, inner: false, alpha: 200 });
  } else {
    p.poly(flat(inner)).fill(V.shieldBack, { mode: 'emboss', inner: false, dither: true });
    const a = c.up(ox + sf * -3.2 - nf * 0.3, oy + sr * -3.2 - nr * 0.3, oz + 1);
    const b = c.up(ox + sf * 3.2 - nf * 0.3, oy + sr * 3.2 - nr * 0.3, oz + 1);
    p.capsule(a.x, a.y, b.x, b.y, 0.9).fill(MATERIALS.leather, { mode: 'cyl', inner: false });
  }
}

function drawCape(c: Ctx): void {
  const { p, pose } = c;
  const V = PALETTES.vanguard;
  const fl = pose.cape;
  const top = SH + 0.3;
  const L: Pt[] = [];
  const steps = 6;
  // cape: top across shoulders (behind), bottom hem flares and trails backwards with flutter
  const topL = c.up(-1.6, -4.4, top);
  const topR = c.up(-1.6, 4.4, top);
  L.push(topL, topR);
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const r = lerp(6.4, -6.4, t);
    const wave = Math.sin(t * Math.PI * 2 + fl * 4) * fl * 1.3;
    const back = -3 - fl * 6.5 - Math.abs(r) * 0.12;
    const z = Math.max(1, 3 + fl * 6 + wave - (pose.kneel ? 3 : 0));
    L.push(c.up(back, r, z - pose.bob));
  }
  const ramp = c.P.depthOf(1, 0) > 0.35 ? [V.cape[0]!, V.cape[0]!, V.cape[1]!, V.cape[1]!] : V.cape;
  p.poly(hull(L)).fill(ramp, { mode: 'cyl', dither: true });
  // gold clasps visible from behind
  if (c.P.depthOf(1, 0) < -0.3) {
    p.circle(topL.x, topL.y + 1, 1.1).fill(V.plate, { mode: 'sphere', inner: false });
    p.circle(topR.x, topR.y + 1, 1.1).fill(V.plate, { mode: 'sphere', inner: false });
  }
}

function vanguardHead(c: Ctx): void {
  const { p, P, pose } = c;
  const V = PALETTES.vanguard;
  const hz = HEAD + pose.headZ;
  const hc = c.up(pose.headF, 0, hz);
  const R = 5.9;
  p.ellipse(hc.x, hc.y, R + 0.2, R - 0.2).fill(V.plate, { mode: 'sphere' });
  // teal brow band (front arc)
  const bandPts = frontArcAt(c, pose.headF, R - 0.1, hz + 1.4, hz + 0.2);
  if (bandPts.length) p.poly(bandPts).fill(V.trim, { mode: 'emboss', inner: false });
  // visor slit + glowing eyes
  if (c.faceVis > -0.2) {
    for (let th = -1.05; th <= 1.051; th += 0.07) {
      const dep = P.depthOf(Math.cos(th), Math.sin(th));
      if (dep < -0.12) continue;
      const q = c.up(pose.headF + Math.cos(th) * (R - 0.4), Math.sin(th) * (R - 0.4), hz - 1.2);
      p.px(q.x, q.y, V.under[0]!).px(q.x, q.y + 1, V.under[0]!);
    }
    const nose0 = c.up(pose.headF + R - 0.5, 0, hz - 1.2);
    if (P.depthOf(1, 0) > -0.1) {
      p.px(nose0.x, nose0.y + 2, V.under[0]!).px(nose0.x, nose0.y + 3, V.under[1]!);
    }
    for (const th of [-0.42, 0.42]) {
      if (P.depthOf(Math.cos(th), Math.sin(th)) < 0.02) continue;
      const q = c.up(pose.headF + Math.cos(th) * (R - 0.4), Math.sin(th) * (R - 0.4), hz - 1.2);
      p.gpx(q.x, q.y, V.eye[3]!, V.eye[2]!);
    }
  }
  // plume crest flowing back
  const fl = pose.cape;
  const chain: [number, number, number][] = [
    [1.4, R + 0.6, 1.3],
    [-1.8, R + 2.6, 1.8],
    [-5.2 - fl * 1.2, R + 2.2 - fl, 1.6],
    [-7.6 - fl * 2.4, R - 0.6 - fl * 1.5, 1.1],
  ];
  for (let k = 0; k + 1 < chain.length; k++) {
    const a = chain[k]!;
    const b = chain[k + 1]!;
    const pa = c.up(pose.headF + a[0], 0, hz + a[1]);
    const pb = c.up(pose.headF + b[0], 0, hz + b[1]);
    p.capsule(pa.x, pa.y, pb.x, pb.y, a[2], b[2]);
  }
  p.fill(PALETTES.vanguard.cape, { mode: 'emboss', dither: true });
}

function frontArcAt(c: Ctx, cf: number, R: number, zTop: number, zBot: number): number[] {
  const P = c.P;
  const thc = Math.atan2(P.ry, P.fy);
  const top: Pt[] = [];
  const bot: Pt[] = [];
  for (let k = 0; k <= 12; k++) {
    const th = thc - Math.PI / 2 + (Math.PI * k) / 12;
    top.push(c.up(cf + Math.cos(th) * R, Math.sin(th) * R, zTop));
    bot.push(c.up(cf + Math.cos(th) * R, Math.sin(th) * R, zBot));
  }
  return top.concat(bot.reverse()).flatMap((q) => [q.x, q.y]);
}

interface CowlPal {
  hat: Ramp;
  trim: Ramp;
  face: Ramp;
  eye: Ramp;
}

/** Cowled head; `peak` scales the drooping hood point (hexbinder uses a short ragged one). */
function arcanistHead(c: Ctx, A: CowlPal = PALETTES.arcanist, peak = 1): void {
  const { p, P, pose } = c;
  const hz = HEAD - 1.6 + pose.headZ;
  const hc = c.up(pose.headF, 0, hz);
  const R = 5.2;
  // deep cowl: hood shell, drooping peak that sways, trimmed face opening
  const sway = pose.hatSway;
  const shell = c.up(pose.headF - 0.5, 0, hz + 0.7);
  const peakA = c.up(pose.headF - 2.4 * peak - sway * 0.4, 0, hz + 0.7 + 6.5 * peak);
  const peakB = c.up(pose.headF - 5.6 * peak - sway * 1.1, 0, hz + 0.7 + 4.7 * peak - Math.abs(sway) * 0.2);
  p.ellipse(shell.x, shell.y, R + 1.3, R + 0.9)
    .poly([shell.x - 4.2, shell.y - 1.5, shell.x + 4.2, shell.y - 1.5, peakA.x + 1.4, peakA.y + 1, peakA.x, peakA.y - 0.6, peakA.x - 1.4, peakA.y + 1])
    .capsule(peakA.x, peakA.y, peakB.x, peakB.y, 1.6, 0.8)
    .fill(A.hat, { mode: 'emboss', dither: true, light: 0.08 });
  if (c.faceVis > -0.25) {
    const fd = P.depthOf(1, 0);
    const fc = c.up(pose.headF + R * 0.66, 0, hz - 1);
    const rx = 1.2 + 2.4 * Math.max(0, fd) + (Math.abs(P.fx) > 0.9 ? 0 : 0.4);
    p.ellipse(fc.x, fc.y, rx + 1, 3.9).fill(A.trim, { mode: 'emboss', inner: false, light: -0.1 });
    p.ellipse(fc.x, fc.y + 0.3, rx, 3).fill(A.face, { mode: 'flat', tone: 1, inner: false });
    for (const th of [-0.5, 0.5]) {
      if (P.depthOf(Math.cos(th), Math.sin(th)) < 0.05) continue;
      const q = c.up(pose.headF + Math.cos(th) * (R - 0.4), Math.sin(th) * (R - 0.4), hz - 1.2);
      p.gpx(q.x, q.y, A.eye[3]!, A.eye[2]!);
    }
  } else {
    // trim seam down the back of the hood
    const t0 = c.up(pose.headF - R, 0, hz + 3);
    const t1 = c.up(pose.headF - R - 0.6, 0, hz - 3);
    p.line(t0.x, t0.y, t1.x, t1.y).fill(A.trim, { mode: 'flat', tone: 1, inner: false });
  }
}

/** Small floating skull familiar with arcane eyes (replaces the old prism). */
function prism(c: Ctx): void {
  const { p, pose } = c;
  const A = PALETTES.arcanist;
  const q = c.up(1, -8.4, HEAD + 5 + pose.prism - pose.bob * 0.5);
  const s = 1 + pose.glow * 0.25;
  p.ellipse(q.x, q.y, 2.6 * s, 2.3 * s).fill(A.skull, { mode: 'sphere', glow: pose.glow > 0.4 ? A.trim[2]! : undefined });
  p.rect(q.x - 1.3, q.y + 1.4 * s, 2.6, 1.3).fill(A.skull, { mode: 'emboss', inner: false });
  if (c.faceVis > -0.4) {
    const ox = c.P.fx * 0.8;
    p.gpx(q.x - 1 + ox, q.y, A.trim[3]!, A.trim[2]!).gpx(q.x + 1 + ox, q.y, A.trim[3]!, A.trim[2]!);
  }
}

interface RobePal {
  robe: Ramp;
  robeDark: Ramp;
  trim: Ramp;
  sash: Ramp;
}

function robe(c: Ctx, A: RobePal = PALETTES.arcanist): void {
  const { p, pose } = c;
  const hem = pose.hem;
  const topPts = ringPts(c, 2.4, 3.7, SH + 0.5, 12);
  const hemPts: Pt[] = [];
  const hemZ = 1.2;
  for (let k = 0; k < 16; k++) {
    const th = (Math.PI * 2 * k) / 16;
    const fl = Math.cos(th) < 0 ? -hem * 1.6 : 0;
    const wav = Math.sin(th * 3 + hem * 2) * 0.4;
    hemPts.push(c.P.p(Math.cos(th) * (5.6 + Math.max(0, -Math.cos(th)) * Math.max(0, -hem) * 1.5) + fl * 0.4 + pose.lean * 0.25, Math.sin(th) * 8, hemZ + wav));
  }
  p.poly(hull(topPts.concat(hemPts))).fill(A.robe, { mode: 'cyl', dither: true });
  // hem trim (camera-facing arc)
  const P = c.P;
  const thc = Math.atan2(8 * P.ry, 5.6 * P.fy);
  const t1: Pt[] = [];
  const t0: Pt[] = [];
  for (let k = 0; k <= 12; k++) {
    const th = thc - Math.PI / 2 + (Math.PI * k) / 12;
    const wav = Math.sin(th * 3 + hem * 2) * 0.4;
    const ff = Math.cos(th) * (5.6 + Math.max(0, -Math.cos(th)) * Math.max(0, -hem) * 1.5) + (Math.cos(th) < 0 ? -hem * 0.64 : 0) + pose.lean * 0.25;
    t0.push(P.p(ff, Math.sin(th) * 8, hemZ + wav));
    t1.push(P.p(ff * 0.97, Math.sin(th) * 7.7, hemZ + wav + 1.8));
  }
  p.poly(t1.concat(t0.reverse()).flatMap((q) => [q.x, q.y])).fill(A.trim, { mode: 'emboss', inner: false });
  // front seam
  if (P.depthOf(1, 0) > -0.2) {
    const a = c.up(2.4, 0, SH - 1);
    const b = P.p(5.3 + pose.lean * 0.25, 0, hemZ + 1.8);
    p.line(a.x, a.y, b.x, b.y).fill(A.robeDark, { mode: 'flat', tone: 1, inner: false });
  }
  // gold sash
  p.poly(band(c, 3.1, 4.6, HIP + 2, HIP + 3.4)).fill(A.sash, { mode: 'emboss', inner: false });
  // collar mantle (cyan)
  p.poly(band(c, 2.9, 4.6, SH - 1.6, SH + 0.4)).fill(A.trim, { mode: 'emboss' });
  const clasp = frontArc(c, 3, 4.7, SH - 0.6, 2)[1];
  if (clasp && P.depthOf(1, 0) > -0.2) p.gpx(clasp.x, clasp.y, A.sash[3]!, A.sash[2]!);
}

function vanguardTorso(c: Ctx): void {
  const { p } = c;
  const V = PALETTES.vanguard;
  // tassets
  p.poly(hull(ringPts(c, 3.4, 4.8, HIP + 1.5, 12).concat(ringPts(c, 3.9, 5.3, HIP - 2.6, 12)))).fill(V.plate, { mode: 'cyl' });
  p.poly(band(c, 3.95, 5.35, HIP - 2.6, HIP - 1.4)).fill(V.trim, { mode: 'emboss', inner: false });
  // breastplate
  const sh = ringPts(c, 3.3, 5.3, SH + 0.4, 14);
  const ws = ringPts(c, 2.9, 4.3, HIP + 1.6, 14);
  p.poly(hull(sh.concat(ws))).fill(V.plate, { mode: 'cyl' });
  // belt
  p.poly(band(c, 3.05, 4.5, HIP + 1.2, HIP + 2.5)).fill(MATERIALS.leather, { mode: 'emboss', inner: false });
  const bk = frontArc(c, 3.1, 4.5, HIP + 1.8, 2);
  const mid = bk[1];
  if (mid && c.P.depthOf(1, 0) > -0.2) p.px(mid.x, mid.y, V.plate[3]!).px(mid.x + 1, mid.y, V.plate[2]!);
  // chest gem
  if (c.P.depthOf(1, 0) > -0.15) {
    const g = c.up(3.2, 0, 15.5);
    p.poly([g.x, g.y - 2, g.x + 1.6, g.y, g.x, g.y + 2, g.x - 1.6, g.y]).fill(V.trim, { mode: 'facet', facets: 4, rot: Math.PI / 4, inner: false });
  } else {
    // backplate ridge
    const a = c.up(-3, 0, SH - 1);
    const b = c.up(-2.7, 0, HIP + 3);
    p.line(a.x, a.y, b.x, b.y).fill(V.plate, { mode: 'flat', tone: 1, inner: false });
  }
}

function pauldron(c: Ctx, side: number): void {
  const { p } = c;
  const V = PALETTES.vanguard;
  const q = c.up(-0.3, side * 5.6, SH + 0.2);
  p.ellipse(q.x, q.y + 1.3, 3.9, 2.6).fill(V.trim, { mode: 'emboss' });
  p.ellipse(q.x, q.y - 0.2, 3.7, 3.1).fill(V.plate, { mode: 'sphere' });
}

function ballPose(c: Ctx): void {
  const { p, P, pose, cls } = c;
  const V = PALETTES.vanguard;
  const ctr = P.p(1.5, 0, 8.5);
  const b = pose.ball;
  p.ellipse(ctr.x, ctr.y, 8.8, 8.2).fill(V.cape, { mode: 'sphere', dither: true });
  for (let k = 0; k < 3; k++) {
    const a = b + (k * Math.PI * 2) / 3;
    const ox = Math.cos(a) * 4.2;
    const oy = Math.sin(a) * 3.8;
    p.ellipse(ctr.x + ox, ctr.y + oy, 3.1, 2.8).fill(cls === 'vanguard' ? V.plate : PALETTES.arcanist.robe, { mode: 'sphere', inner: true });
  }
  // shield rim arc on the outside
  const a0 = b + Math.PI;
  for (let t = -0.9; t <= 0.9; t += 0.1) {
    const x = ctr.x + Math.cos(a0 + t) * 8.4;
    const y = ctr.y + Math.sin(a0 + t) * 7.8;
    p.circle(x, y, 1.2);
  }
  p.fill(V.shield, { mode: 'emboss' });
  const hp = P.p(5, 0, 10.5);
  p.ellipse(hp.x, hp.y, 3.6, 3.2).fill(V.plate, { mode: 'sphere' });
  if (P.depthOf(1, 0) > -0.1) p.gpx(hp.x + P.fx * 1.5, hp.y, V.eye[3]!, V.eye[2]!);
}

// ------------------------------------------------------------------ new classes: part painters

const WHITE4: Ramp = [0xffffff, 0xffffff, 0xffffff, 0xffffff];

/** Curved sabre from a hand along a direction (duelist). */
function sabre(c: Ctx, hand: V3, w: V3, flipCurve: number): void {
  const { p } = c;
  const D = PALETTES.duelist;
  const at = (k: number): Pt => c.up(hand[0] + w[0] * k, hand[1] + w[1] * k, hand[2] + w[2] * k);
  const pom = at(-2.2);
  const b = at(1.2);
  const t = at(11.5);
  let ux = t.x - b.x;
  let uy = t.y - b.y;
  const L = Math.hypot(ux, uy);
  if (L < 2) {
    ux = 0;
    uy = -1;
  } else {
    ux /= L;
    uy /= L;
  }
  let nx = -uy;
  let ny = ux;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  nx *= flipCurve;
  ny *= flipCurve;
  const len = Math.max(L, 2);
  const spine: number[] = [];
  const edge: number[] = [];
  const steps = 6;
  for (let k = 0; k <= steps; k++) {
    const tt = k / steps;
    const bend = Math.sin(Math.PI * tt * 0.9) * 1.8;
    const x = b.x + ux * len * tt + nx * bend;
    const y = b.y + uy * len * tt + ny * bend;
    const wdt = 1.2 * (1 - tt * 0.75);
    spine.push(x + nx * 0.5, y + ny * 0.5);
    edge.unshift(x - nx * wdt, y - ny * wdt);
  }
  p.capsule(pom.x, pom.y, b.x, b.y, 0.9, 0.9).fill(D.grip, { mode: 'cyl' });
  p.poly([...spine, ...edge]).fill(D.blade, { mode: 'emboss', light: 0.1 });
  p.line(b.x - nx * 0.6, b.y - ny * 0.6, b.x + ux * len * 0.8 - nx * 0.2 + nx * 1.6, b.y + uy * len * 0.8 - ny * 0.2 + ny * 1.6).fill(WHITE4, { mode: 'flat', inner: false, alpha: 200 });
  p.capsule(b.x - nx * 1.8, b.y - ny * 1.8, b.x + nx * 1.4, b.y + ny * 1.4, 0.7, 0.7).fill(D.accent, { mode: 'cyl', inner: false });
}

/** Short hooded half-cape (duelist). */
function shortCape(c: Ctx, ramp: Ramp, lining: Ramp): void {
  const { p, pose } = c;
  const fl = pose.cape;
  const top = SH + 0.6;
  const pts: Pt[] = [c.up(-1.4, -4, top), c.up(-1.4, 4, top)];
  for (let k = 0; k <= 5; k++) {
    const t = k / 5;
    const r = lerp(5.4, -5.4, t);
    const wave = Math.sin(t * Math.PI * 3 + fl * 5) * fl * 0.9;
    pts.push(c.up(-2.6 - fl * 4.5, r, Math.max(2, 10.5 + fl * 3 + wave - (pose.kneel ? 2 : 0)) - pose.bob * 0.5));
  }
  const inner = c.P.depthOf(1, 0) > 0.35;
  p.poly(hull(pts)).fill(inner ? [lining[0]!, lining[0]!, lining[1]!, lining[1]!] : ramp, { mode: 'cyl', dither: true });
}

/** Scarf tail trailing from the neck (duelist); streams further while running/dashing. */
function scarf(c: Ctx): void {
  const { p, pose } = c;
  const D = PALETTES.duelist;
  const fl = pose.cape + pose.blur * 0.6;
  const n0 = c.up(-0.8, 1, SH + 1.6);
  const n1 = c.up(-3.5 - fl * 4.5, 1.8, SH + 0.8 - fl * 0.8 + Math.sin(fl * 6) * 0.6);
  const n2 = c.up(-6.5 - fl * 8.5, 2.6, SH - 0.8 - fl * 1.8 + Math.sin(fl * 6 + 1.6) * 1.1);
  p.capsule(n0.x, n0.y, n1.x, n1.y, 1.5, 1.2).capsule(n1.x, n1.y, n2.x, n2.y, 1.2, 0.7).fill(D.accent, { mode: 'emboss', dither: true });
}

function duelistTorso(c: Ctx): void {
  const { p, P } = c;
  const D = PALETTES.duelist;
  p.poly(hull(ringPts(c, 2.7, 4.2, SH + 0.3, 12).concat(ringPts(c, 2.4, 3.4, HIP + 0.6, 12)))).fill(D.leather, { mode: 'cyl' });
  p.poly(band(c, 2.55, 3.6, HIP + 1.2, HIP + 2.7)).fill(D.accent, { mode: 'emboss', inner: false });
  // crossed bandolier with throwing knives
  if (P.depthOf(1, 0) > -0.3) {
    const a = c.up(2.4, 3.6, SH);
    const b = c.up(2.6, -3, HIP + 2.6);
    p.line(a.x, a.y, b.x, b.y).fill(D.cloth, { mode: 'flat', tone: 3, inner: false });
    for (let k = 1; k <= 3; k++) {
      const q = { x: lerp(a.x, b.x, k / 4), y: lerp(a.y, b.y, k / 4) };
      p.px(q.x, q.y - 1, D.blade[3]!);
    }
  } else {
    const a = c.up(-2.4, -3.6, SH);
    const b = c.up(-2.6, 3, HIP + 2.6);
    p.line(a.x, a.y, b.x, b.y).fill(D.cloth, { mode: 'flat', tone: 3, inner: false });
  }
}

function duelistHead(c: Ctx): void {
  const { p, P, pose } = c;
  const D = PALETTES.duelist;
  const hz = HEAD - 1.2 + pose.headZ;
  const R = 4.9;
  const shell = c.up(pose.headF - 0.4, 0, hz + 0.4);
  const peak = c.up(pose.headF - 4.4, 0, hz + 3.6);
  p.ellipse(shell.x, shell.y, R + 0.2, R)
    .poly([shell.x - 2.4, shell.y - 2.2, shell.x + 2.4, shell.y - 2.2, peak.x, peak.y])
    .fill(D.cloth, { mode: 'emboss', dither: true, light: 0.15 });
  if (c.faceVis > -0.25) {
    const fd = P.depthOf(1, 0);
    const fc = c.up(pose.headF + R * 0.62, 0, hz - 0.8);
    const rx = 1 + 2.2 * Math.max(0, fd) + (Math.abs(P.fx) > 0.9 ? 0 : 0.4);
    p.ellipse(fc.x, fc.y, rx + 0.9, 3.3).fill(D.accent, { mode: 'emboss', inner: false, light: -0.1 });
    p.ellipse(fc.x, fc.y, rx, 2.6).fill(PALETTES.hexbinder.face, { mode: 'flat', tone: 1, inner: false });
    // crimson mask over the lower face
    p.rect(fc.x - rx, fc.y + 0.6, rx * 2, 2).fill(D.accent, { mode: 'flat', tone: 1, inner: false });
    for (const th of [-0.48, 0.48]) {
      if (P.depthOf(Math.cos(th), Math.sin(th)) < 0.05) continue;
      const q = c.up(pose.headF + Math.cos(th) * (R - 0.3), Math.sin(th) * (R - 0.3), hz - 1);
      p.gpx(q.x, q.y, D.eye[3]!, D.eye[2]!);
    }
  }
}

/** Crooked bone fetish staff topped with a horned skull and dangling charms (hexbinder). */
function boneStaff(c: Ctx): void {
  const { p, pose } = c;
  const H = PALETTES.hexbinder;
  const hd = pose.handR;
  const w = pose.wpn;
  const at = (k: number, side = 0): Pt => c.up(hd[0] + w[0] * k + side * 0.6, hd[1] + w[1] * k + side, hd[2] + w[2] * k);
  const bot = at(-11);
  const kink = at(5, 0.8);
  const top = at(15);
  p.capsule(bot.x, bot.y, kink.x, kink.y, 0.9, 1).capsule(kink.x, kink.y, top.x, top.y, 1, 1.1).fill(H.staff, { mode: 'cyl' });
  // dangling charms
  const hang = at(13.5);
  p.line(hang.x + 1, hang.y, hang.x + 1.5, hang.y + 5).line(hang.x - 1, hang.y, hang.x - 1.8, hang.y + 4).fill(H.skull, { mode: 'flat', tone: 1, inner: false });
  p.px(hang.x + 1.5, hang.y + 5, H.skull[3]!).px(hang.x - 1.8, hang.y + 4, H.sash[3]!);
  // horned skull
  const sk = at(17);
  const fx = c.P.fx;
  for (const s of [-1, 1]) {
    const pts: [number, number][] = [
      [s * 1.6, -1.6],
      [s * 4, -2.4],
      [s * 5, -0.2],
      [s * 3.6, 1.6],
    ];
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, ay] = pts[k]!;
      const [bx, by] = pts[k + 1]!;
      p.capsule(sk.x + ax, sk.y + ay, sk.x + bx, sk.y + by, 1 - k * 0.2, 0.8 - k * 0.2);
    }
  }
  p.fill(H.skull, { mode: 'emboss', light: -0.2 });
  p.ellipse(sk.x, sk.y, 2.4, 2.6).fill(H.skull, { mode: 'sphere' });
  p.rect(sk.x - 1 + fx * 0.6, sk.y + 1.8, 2, 1.6).fill(H.skull, { mode: 'emboss', inner: false });
  const hot = pose.flare > 0.5 ? H.glow[4]! : H.glow[3]!;
  p.gpx(sk.x - 1 + fx * 0.7, sk.y, hot, H.glow[2]!).gpx(sk.x + 1 + fx * 0.7, sk.y, hot, H.glow[2]!);
  if (pose.flare > 0.5) p.circle(sk.x, sk.y - 0.5, 4.2 + pose.flare).fill(H.glow, { mode: 'sphere', alpha: 110, glow: H.glow[3]!, inner: false });
}

/** Floating skull lantern with a rot-green flame inside (hexbinder familiar). */
function skullLantern(c: Ctx): void {
  const { p, pose } = c;
  const H = PALETTES.hexbinder;
  const q = c.up(1, -8.6, HEAD + 3 + pose.prism - pose.bob * 0.5);
  p.ellipse(q.x, q.y, 2.8, 2.5).fill(H.skull, { mode: 'sphere' });
  p.rect(q.x - 1.4, q.y + 1.6, 2.8, 1.4).fill(H.skull, { mode: 'emboss', inner: false });
  const ox = c.P.fx * 0.8;
  if (c.faceVis > -0.4) p.gpx(q.x - 1 + ox, q.y, H.glow[3]!, H.glow[2]!).gpx(q.x + 1 + ox, q.y, H.glow[3]!, H.glow[2]!);
  // green flame licking out of the cranium + a chain loop above
  const fl = Math.sin(pose.prism * 1.7 + pose.hem * 2) * 0.7;
  p.poly([q.x - 1.4, q.y - 1.6, q.x + 1.4, q.y - 1.6, q.x + fl, q.y - 5.4]).fill(H.glow, { mode: 'emboss', glow: H.glow[3]!, light: 0.3, inner: false });
  p.line(q.x, q.y - 5.5, q.x, q.y - 7.5).fill(MATERIALS.chain, { mode: 'flat', tone: 3, inner: false });
}

/** Ragged shawl over the shoulders that broadens the hexbinder silhouette. */
function shawl(c: Ctx): void {
  const { p } = c;
  const H = PALETTES.hexbinder;
  p.poly(hull(ringPts(c, 3.4, 6.2, SH + 0.8, 14).concat(ringPts(c, 3.7, 6.6, SH - 3.2, 14)))).fill(H.robeDark, { mode: 'cyl', dither: true, light: 0.25 });
  p.poly(band(c, 3.75, 6.65, SH - 3.4, SH - 2.4)).fill(H.trim, { mode: 'flat', tone: 1, inner: false });
}

/** Cuts ragged notches into the hem and splashes rot stains (hexbinder robe). */
function tatter(c: Ctx, buf: PixelBuffer): void {
  const P = c.P;
  const H = PALETTES.hexbinder;
  const thc = Math.atan2(8 * P.ry, 5.6 * P.fy);
  for (let k = 0; k <= 9; k++) {
    const th = thc - Math.PI / 2 + (Math.PI * (k + 0.5)) / 10;
    const q = P.p(Math.cos(th) * 5.6 + c.pose.lean * 0.25, Math.sin(th) * 8, 1.2);
    const depth = 2 + (k % 3);
    for (let dy = 0; dy < depth; dy++) {
      for (let dx = -1 + Math.floor(dy / 2); dx <= 1 - Math.floor(dy / 2); dx++) buf.set(Math.round(q.x) + dx, Math.round(q.y) - dy + 1, 0, 0);
    }
    if (k % 3 === 1) c.p.gpx(q.x + 1, q.y - 4, H.glow[2]!, H.glow[2]!);
  }
}

function backpack(c: Ctx): void {
  const { p, P } = c;
  const A = PALETTES.artificer;
  const corners: Pt[] = [];
  for (const f of [-2.3, -6]) for (const r of [-3.8, 3.8]) for (const z of [11, 22]) corners.push(c.up(f, r, z));
  p.poly(hull(corners)).fill(A.brass, { mode: 'emboss', dither: true });
  // riveted band
  const b0 = c.up(-4.2, -3.9, 16.5);
  const b1 = c.up(-4.2, 3.9, 16.5);
  p.capsule(b0.x, b0.y, b1.x, b1.y, 0.7, 0.7).fill(A.copper, { mode: 'cyl', inner: false });
  // chimney pipes
  for (const s of [-1, 1]) {
    const a = c.up(-4.6, s * 2.3, 21.5);
    const t = c.up(-4.6, s * 2.3, 26.5 + (s > 0 ? 1.5 : 0));
    p.capsule(a.x, a.y, t.x, t.y, 1, 1.1).fill(A.copper, { mode: 'cyl' });
    p.ellipse(t.x, t.y, 1.3, 0.8).fill([0x050404, 0x0a0808, 0x100c0c, 0x161212], { mode: 'flat', tone: 1, inner: false });
  }
  // pressure gauge on the back
  if (P.depthOf(1, 0) < -0.2) {
    const g = c.up(-6.1, 0, 17.5);
    p.circle(g.x, g.y, 1.8).fill([0x8a9a9a, 0xc8d4d0, 0xf0f8f4, 0xffffff], { mode: 'sphere', inner: false });
    p.line(g.x, g.y, g.x + 1, g.y - 1).fill(A.copper, { mode: 'flat', tone: 0, inner: false });
  }
}

function artificerTorso(c: Ctx): void {
  const { p, P } = c;
  const A = PALETTES.artificer;
  p.poly(hull(ringPts(c, 3.1, 4.9, SH + 0.4, 14).concat(ringPts(c, 3.4, 5.2, HIP - 2.8, 14)))).fill(A.coat, { mode: 'cyl' });
  if (P.depthOf(1, 0) > -0.2) {
    // leather apron + backpack straps
    p.poly(band(c, 3.2, 2.6, HIP - 2.6, SH - 2)).fill(A.leather, { mode: 'cyl', dither: true, inner: false });
    for (const s of [-1, 1]) {
      const a = c.up(2.4, s * 3.6, SH + 0.2);
      const b = c.up(3, s * 3, HIP + 4);
      p.line(a.x, a.y, b.x, b.y).fill(A.leather, { mode: 'flat', tone: 1, inner: false });
    }
  }
  // tool belt with pouches and a wrench
  p.poly(band(c, 3.3, 5, HIP + 1, HIP + 2.6)).fill(A.leather, { mode: 'emboss', inner: false });
  const arc = frontArc(c, 3.5, 5.2, HIP + 0.6, 6);
  arc.forEach((q, k) => {
    if (k === 1 || k === 5) p.rect(q.x - 1, q.y - 0.5, 2.2, 2.4).fill(A.leather, { mode: 'emboss', light: 0.2, inner: true });
    if (k === 3 && P.depthOf(1, 0) > -0.2) p.px(q.x, q.y - 1, A.brass[3]!).px(q.x + 1, q.y - 1, A.brass[2]!);
  });
  const wq = arc[4];
  if (wq) p.line(wq.x, wq.y, wq.x + 0.5, wq.y + 4).fill(A.iron, { mode: 'flat', tone: 3, inner: false });
}

function artificerHead(c: Ctx): void {
  const { p, P, pose } = c;
  const A = PALETTES.artificer;
  const hz = HEAD - 1.4 + pose.headZ;
  const R = 4.8;
  const hc = c.up(pose.headF, 0, hz);
  p.ellipse(hc.x, hc.y, R + 0.2, R).fill(A.skin, { mode: 'sphere' });
  // leather cap
  const cap = c.up(pose.headF - 0.4, 0, hz + 2.2);
  p.ellipse(cap.x, cap.y, R + 0.6, 3.4).minus().rect(cap.x - 8, cap.y + 1.2, 16, 6).fill(A.leather, { mode: 'sphere' });
  // goggle strap
  // goggle strap around the camera-facing half of the head
  for (const q of frontArc(c, R + 0.1, R + 0.1, hz + 0.6, 16, pose.headF)) p.dot(q.x, q.y);
  p.fill(A.leather, { mode: 'flat', tone: 1, inner: false });
  // goggles with glowing teal lenses
  for (const th of [-0.5, 0.5]) {
    if (P.depthOf(Math.cos(th), Math.sin(th)) < 0) continue;
    const q = c.up(pose.headF + Math.cos(th) * (R - 0.2), Math.sin(th) * (R - 0.2), hz + 0.4);
    p.circle(q.x, q.y, 1.9).fill(A.brass, { mode: 'sphere', inner: false });
    p.gpx(q.x, q.y, A.lens[3]!, A.lens[2]!).gpx(q.x + 1, q.y, A.lens[2]!, A.lens[2]!);
  }
}

/** Heavy repeater crossbow carried in both hands (artificer). */
function crossbow(c: Ctx): void {
  const { p, pose } = c;
  const A = PALETTES.artificer;
  const h = pose.handR;
  const w = pose.wpn;
  const at = (k: number, side = 0, dz = 0): Pt => {
    const pr = [-w[1], w[0]];
    const l = Math.hypot(pr[0]!, pr[1]!) || 1;
    return c.up(h[0] + w[0] * k + (pr[0]! / l) * side, h[1] + w[1] * k + (pr[1]! / l) * side, h[2] + w[2] * k + dz);
  };
  const s0 = at(-3.5, 0, -0.6);
  const s1 = at(8);
  p.capsule(s0.x, s0.y, s1.x, s1.y, 1.4, 1.1).fill(A.wood, { mode: 'cyl' });
  const mag = at(3, 0, 1.8);
  p.rect(mag.x - 1.8, mag.y - 1.5, 3.6, 2.8).fill(A.brass, { mode: 'emboss', inner: true });
  const front = at(8);
  const tipA = at(6.2, 6.4);
  const tipB = at(6.2, -6.4);
  p.capsule(front.x, front.y, tipA.x, tipA.y, 1.1, 0.6).capsule(front.x, front.y, tipB.x, tipB.y, 1.1, 0.6).fill(A.iron, { mode: 'cyl' });
  const nut = at(pose.flare > 0.5 ? 6 : 2.2);
  p.line(tipA.x, tipA.y, nut.x, nut.y).line(tipB.x, tipB.y, nut.x, nut.y).fill([0x8a8a90, 0xb8b8c0, 0xd8d8e0, 0xf0f0f4], { mode: 'flat', tone: 2, inner: false });
  if (pose.flare < 0.5) {
    const bt = at(9.5);
    p.line(nut.x, nut.y, bt.x, bt.y).fill(A.iron, { mode: 'flat', tone: 4, inner: false });
  }
}

function bombAt(c: Ctx, q: Pt): void {
  const { p } = c;
  p.circle(q.x, q.y, 2.2).fill(PALETTES.artificer.iron, { mode: 'sphere', light: 0.15 });
  p.line(q.x - 2, q.y, q.x + 2, q.y).fill(PALETTES.artificer.brass, { mode: 'flat', tone: 2, inner: false });
  p.gpx(q.x + 1, q.y - 3, 0xffe080, MATERIALS.flame[2]!);
}

// ------------------------------------------------------------------ templar / berserker / cryomancer / ranger / warden parts

/** Generic long cloak (ranger) with a darker visible lining. */
function longCape(c: Ctx, ramp: Ramp): void {
  const { p, pose } = c;
  const fl = pose.cape;
  const top = SH + 0.5;
  const pts: Pt[] = [c.up(-1.5, -4.2, top), c.up(-1.5, 4.2, top)];
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    const r = lerp(6, -6, t);
    const wave = Math.sin(t * Math.PI * 2 + fl * 4) * fl * 1.3;
    pts.push(c.up(-2.8 - fl * 6, r, Math.max(1.5, 3 + fl * 5.5 + wave - (pose.kneel ? 3 : 0)) - pose.bob));
  }
  const inner = c.P.depthOf(1, 0) > 0.35;
  p.poly(hull(pts)).fill(inner ? [ramp[0]!, ramp[0]!, ramp[1]!, ramp[1]!] : ramp, { mode: 'cyl', dither: true });
}

function plateTorso(c: Ctx, plate: Ramp, trim: Ramp, wide = 1): void {
  const { p } = c;
  p.poly(hull(ringPts(c, 3.3 * wide, 5.3 * wide, SH + 0.4, 14).concat(ringPts(c, 2.9, 4.3, HIP + 1.6, 14)))).fill(plate, { mode: 'cyl' });
  p.poly(band(c, 3.05, 4.5, HIP + 1.2, HIP + 2.5)).fill(trim, { mode: 'emboss', inner: false });
}

function templarTorso(c: Ctx): void {
  const { p, P, pose } = c;
  const T = PALETTES.templar;
  plateTorso(c, T.plate, T.gold);
  // tabard panel (front when facing the camera, back otherwise) with gold border and sun emblem
  const front = P.depthOf(1, 0) > -0.15;
  const f = front ? 3.3 : -3.3;
  const fl = front ? pose.hem * 0.6 : -pose.hem * 0.6 - pose.cape;
  const q = [c.up(f, -2.6, SH - 1), c.up(f, 2.6, SH - 1), c.up(f + fl * 0.6, 2.9, 3.5), c.up(f + fl * 0.6, -2.9, 3.5)];
  const pts = q.flatMap((v) => [v.x, v.y]);
  p.poly(pts).fill(T.gold, { mode: 'emboss', inner: false });
  const qi = [c.up(f + 0.05, -2, SH - 1.8), c.up(f + 0.05, 2, SH - 1.8), c.up(f + 0.05 + fl * 0.6, 2.2, 4.4), c.up(f + 0.05 + fl * 0.6, -2.2, 4.4)];
  p.poly(qi.flatMap((v) => [v.x, v.y])).fill(T.tabard, { mode: 'cyl', dither: true, inner: false });
  if (front) {
    const g = c.up(f + 0.1, 0, 14.5);
    p.poly([g.x, g.y - 2.4, g.x + 1.6, g.y, g.x, g.y + 2.4, g.x - 1.6, g.y]).fill(T.gold, { mode: 'facet', facets: 4, rot: Math.PI / 4, glow: T.gold[3]!, inner: false });
  }
}

function goldPauldron(c: Ctx, side: number): void {
  const { p } = c;
  const T = PALETTES.templar;
  const q = c.up(-0.3, side * 5.6, SH + 0.2);
  p.ellipse(q.x, q.y + 1.3, 3.9, 2.6).fill(T.gold, { mode: 'emboss' });
  p.ellipse(q.x, q.y - 0.2, 3.7, 3.1).fill(T.plate, { mode: 'sphere' });
}

function templarHead(c: Ctx): void {
  const { p, P, pose } = c;
  const T = PALETTES.templar;
  const hz = HEAD + pose.headZ;
  const hc = c.up(pose.headF, 0, hz);
  const R = 5.6;
  p.ellipse(hc.x, hc.y, R + 0.1, R - 0.2).fill(T.plate, { mode: 'sphere' });
  // gold crest fin
  const c0 = c.up(pose.headF + 1.6, 0, hz + R + 0.2);
  const c1 = c.up(pose.headF - 3.6, 0, hz + R - 0.6);
  p.capsule(c0.x, c0.y, c1.x, c1.y, 1.1, 0.8).fill(T.gold, { mode: 'emboss' });
  if (c.faceVis > -0.2) {
    // gold cross visor with radiant eyes
    for (let th = -0.9; th <= 0.901; th += 0.08) {
      if (P.depthOf(Math.cos(th), Math.sin(th)) < -0.1) continue;
      const q = c.up(pose.headF + Math.cos(th) * (R - 0.4), Math.sin(th) * (R - 0.4), hz - 0.8);
      p.px(q.x, q.y, 0x1a1408);
    }
    if (P.depthOf(1, 0) > -0.1) {
      const v0 = c.up(pose.headF + R - 0.4, 0, hz + 1.8);
      const v1 = c.up(pose.headF + R - 0.4, 0, hz - 3);
      p.line(v0.x, v0.y, v1.x, v1.y).fill(T.gold, { mode: 'flat', tone: 3, inner: false });
    }
    for (const th of [-0.4, 0.4]) {
      if (P.depthOf(Math.cos(th), Math.sin(th)) < 0.02) continue;
      const q = c.up(pose.headF + Math.cos(th) * (R - 0.4), Math.sin(th) * (R - 0.4), hz - 0.8);
      p.gpx(q.x, q.y, T.eye[3]!, T.eye[2]!);
    }
  }
}

/** Halo-like golden crest ring floating behind the helm. */
function halo(c: Ctx): void {
  const { p, pose } = c;
  const T = PALETTES.templar;
  const q = c.up(pose.headF - 2.2, 0, HEAD + pose.headZ + 4.2);
  p.circle(q.x, q.y, 6.6).minus().circle(q.x, q.y, 5.2).fill(T.gold, { mode: 'flat', tone: 3, glow: T.gold[4]!, inner: false, alpha: 235 });
}

function greatHammer(c: Ctx): void {
  const { p, pose } = c;
  const T = PALETTES.templar;
  const h = pose.handR;
  const w = pose.wpn;
  const at = (k: number, side = 0): Pt => {
    const pr = [-w[1], w[0]];
    const l = Math.hypot(pr[0]!, pr[1]!) || 1;
    return c.up(h[0] + w[0] * k + (pr[0]! / l) * side, h[1] + w[1] * k + (pr[1]! / l) * side, h[2] + w[2] * k);
  };
  const a = at(-2.5);
  const b = at(13);
  p.capsule(a.x, a.y, b.x, b.y, 1, 1).fill(T.haft, { mode: 'cyl' });
  const h0 = at(13.6, -4.4);
  const h1 = at(13.6, 4.4);
  p.capsule(h0.x, h0.y, h1.x, h1.y, 2.7, 2.7).fill(T.plate, { mode: 'cyl', light: 0.05 });
  const g0 = at(13.6, -0.5);
  const g1 = at(13.6, 0.5);
  p.capsule(g0.x, g0.y, g1.x, g1.y, 2.9, 2.9).fill(T.gold, { mode: 'cyl', inner: true });
  const pm = at(-2.8);
  p.circle(pm.x, pm.y, 1.3).fill(T.gold, { mode: 'sphere', inner: false });
}

function berserkerTorso(c: Ctx): void {
  const { p, P } = c;
  const B = PALETTES.berserker;
  p.poly(hull(ringPts(c, 3.5, 5, HIP + 1, 12).concat(ringPts(c, 4, 5.6, HIP - 3.2, 12)))).fill(B.leather, { mode: 'cyl', dither: true });
  p.poly(hull(ringPts(c, 3.9, 6.3, SH + 0.6, 14).concat(ringPts(c, 3.3, 4.8, HIP + 1.2, 14)))).fill(B.skin, { mode: 'cyl' });
  if (P.depthOf(1, 0) > -0.2) {
    // pecs, abs and red war paint
    const m = c.up(3.6, 0, SH - 2.4);
    const l = c.up(3.4, -3.6, SH - 3);
    const r = c.up(3.4, 3.6, SH - 3);
    p.line(l.x, l.y, m.x, m.y + 1).line(m.x, m.y + 1, r.x, r.y).fill(B.skin, { mode: 'flat', tone: 1, inner: false });
    const a0 = c.up(3.5, 0, SH - 4);
    const a1 = c.up(3.4, 0, HIP + 2.5);
    p.line(a0.x, a0.y, a1.x, a1.y).fill(B.skin, { mode: 'flat', tone: 1, inner: false });
    for (const s of [-1, 1]) {
      const s0 = c.up(3.3, s * 4.6, SH - 0.6);
      const s1 = c.up(3.5, s * 1.4, HIP + 4);
      p.capsule(s0.x, s0.y, s1.x, s1.y, 0.6, 0.6);
    }
    p.fill(B.paint, { mode: 'flat', tone: 2, inner: false });
  }
  p.poly(band(c, 3.4, 4.9, HIP + 1, HIP + 2.6)).fill(B.leather, { mode: 'emboss', inner: false });
  const bk = frontArc(c, 3.5, 5, HIP + 1.8, 2)[1];
  if (bk && P.depthOf(1, 0) > -0.2) p.circle(bk.x, bk.y, 1.3).fill(B.iron, { mode: 'sphere', inner: false });
}

function furMantle(c: Ctx): void {
  const { p } = c;
  const B = PALETTES.berserker;
  p.poly(hull(ringPts(c, 4, 7.2, SH + 1.6, 16).concat(ringPts(c, 3.6, 6.4, SH - 1.6, 16)))).fill(B.fur, { mode: 'cyl', dither: true, light: 0.1 });
  for (const q of frontArc(c, 3.8, 6.8, SH - 1.4, 9)) p.px(q.x, q.y + 1, B.fur[3]!);
}

function berserkerHead(c: Ctx): void {
  const { p, P, pose } = c;
  const B = PALETTES.berserker;
  const hz = HEAD - 0.6 + pose.headZ;
  const hc = c.up(pose.headF + 0.4, 0, hz);
  const R = 5;
  p.ellipse(hc.x, hc.y, R + 0.2, R).fill(B.skin, { mode: 'sphere' });
  if (c.faceVis > -0.25) {
    // beard
    const bq = c.up(pose.headF + 3.4, 0, hz - 3);
    p.ellipse(bq.x, bq.y, 2.2 + 1.6 * Math.max(0, P.depthOf(1, 0)), 2.8).fill(B.hair, { mode: 'sphere', dither: true, inner: false });
    // war paint band across the eyes + angry eyes
    for (let th = -0.8; th <= 0.801; th += 0.1) {
      if (P.depthOf(Math.cos(th), Math.sin(th)) < -0.05) continue;
      const q = c.up(pose.headF + 0.4 + Math.cos(th) * (R - 0.3), Math.sin(th) * (R - 0.3), hz + 0.2);
      p.px(q.x, q.y, B.paint[2]!).px(q.x, q.y + 1, B.paint[1]!);
    }
    for (const th of [-0.42, 0.42]) {
      if (P.depthOf(Math.cos(th), Math.sin(th)) < 0.05) continue;
      const q = c.up(pose.headF + 0.4 + Math.cos(th) * (R - 0.3), Math.sin(th) * (R - 0.3), hz + 0.3);
      p.px(q.x, q.y, 0xfff0e0);
    }
  }
  // mohawk
  const pts: [number, number][] = [
    [2, R + 0.4],
    [-1, R + 2],
    [-4, R + 1.2],
    [-6, R - 2],
  ];
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = c.up(pose.headF + 0.4 + pts[k]![0], 0, hz + pts[k]![1]);
    const b = c.up(pose.headF + 0.4 + pts[k + 1]![0], 0, hz + pts[k + 1]![1]);
    p.capsule(a.x, a.y, b.x, b.y, 1.5, 1.2);
  }
  p.fill(B.hair, { mode: 'emboss', dither: true });
}

function axe(c: Ctx, hand: V3, w: V3, side: number): void {
  const { p } = c;
  const B = PALETTES.berserker;
  const at = (k: number): Pt => c.up(hand[0] + w[0] * k, hand[1] + w[1] * k, hand[2] + w[2] * k);
  const a = at(-2);
  const b = at(9.5);
  p.capsule(a.x, a.y, b.x, b.y, 0.9, 0.9).fill(B.haft, { mode: 'cyl' });
  let ux = b.x - a.x;
  let uy = b.y - a.y;
  const L = Math.hypot(ux, uy) || 1;
  ux /= L;
  uy /= L;
  let nx = -uy * side;
  let ny = ux * side;
  if (Math.abs(nx) < 0.2 && Math.abs(ny) < 0.2) {
    nx = side;
    ny = 0;
  }
  const H = at(8);
  p.poly([H.x + nx * 0.6 - ux * 1.6, H.y + ny * 0.6 - uy * 1.6, H.x + nx * 0.6 + ux * 1.6, H.y + ny * 0.6 + uy * 1.6, H.x + nx * 4.4 + ux * 3.2, H.y + ny * 4.4 + uy * 3.2, H.x + nx * 5.2, H.y + ny * 5.2, H.x + nx * 4.4 - ux * 3.2, H.y + ny * 4.4 - uy * 3.2]).fill(B.blade, { mode: 'emboss', light: 0.05 });
  p.line(H.x + nx * 4.6 + ux * 2.8, H.y + ny * 4.6 + uy * 2.8, H.x + nx * 4.6 - ux * 2.8, H.y + ny * 4.6 - uy * 2.8).fill(WHITE4, { mode: 'flat', inner: false, alpha: 210 });
}

function cryoHair(c: Ctx): void {
  const { p, pose } = c;
  const C = PALETTES.cryomancer;
  const sway = pose.hatSway;
  const hz = HEAD - 1.2 + pose.headZ;
  const a = c.up(pose.headF - 2.6, 0, hz + 1.6);
  const b = c.up(pose.headF - 4.4 - sway * 0.5, 0.6, hz - 5);
  const d = c.up(pose.headF - 5.4 - sway * 1.1, 1.2, hz - 11);
  p.capsule(a.x, a.y, b.x, b.y, 3.4, 2.8).capsule(b.x, b.y, d.x, d.y, 2.8, 1.6).fill(C.hair, { mode: 'emboss', dither: true });
}

function cryoHead(c: Ctx): void {
  const { p, P, pose } = c;
  const C = PALETTES.cryomancer;
  const hz = HEAD - 1.2 + pose.headZ;
  const R = 4.7;
  const hc = c.up(pose.headF, 0, hz);
  p.ellipse(hc.x, hc.y, R + 0.1, R).fill(C.skin, { mode: 'sphere' });
  // hair cap over the back half of the head
  const hq = c.up(pose.headF - 1.4, 0, hz + 1);
  p.ellipse(hq.x, hq.y, R, R - 0.6).fill(C.hair, { mode: 'sphere', dither: true });
  if (c.faceVis > -0.25) {
    for (const th of [-0.48, 0.48]) {
      if (P.depthOf(Math.cos(th), Math.sin(th)) < 0.05) continue;
      const q = c.up(pose.headF + Math.cos(th) * (R - 0.3), Math.sin(th) * (R - 0.3), hz - 0.4);
      p.gpx(q.x, q.y, C.eye[3]!, C.eye[2]!);
    }
  }
  // frost crown of ice spikes
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.2;
    const base = c.up(pose.headF + Math.cos(a) * 3.6, Math.sin(a) * 3.6, hz + 3);
    const tip = c.up(pose.headF + Math.cos(a) * 4.4, Math.sin(a) * 4.4, hz + 6.5 + (k % 2) * 2.2);
    p.poly([base.x - 1.2, base.y, base.x + 1.2, base.y, tip.x, tip.y]);
  }
  p.fill(C.ice, { mode: 'facet', facets: 3, glow: C.ice[3]!, light: 0.15 });
}

function iceStaff(c: Ctx): void {
  const { p, pose } = c;
  const C = PALETTES.cryomancer;
  const h = pose.handR;
  const w = pose.wpn;
  const at = (k: number): Pt => c.up(h[0] + w[0] * k, h[1] + w[1] * k, h[2] + w[2] * k);
  const bot = at(-11);
  const top = at(15);
  p.capsule(bot.x, bot.y, top.x, top.y, 0.9, 1).fill(C.sash, { mode: 'cyl' });
  const t = at(18.5);
  const s = 1 + pose.flare * 0.5;
  p.poly([t.x, t.y - 5 * s, t.x + 2.6 * s, t.y, t.x, t.y + 3 * s, t.x - 2.6 * s, t.y]).fill(C.ice, { mode: 'facet', facets: 4, rot: Math.PI / 4, glow: C.ice[3]!, light: 0.1 + pose.flare * 0.3, inner: false });
  for (const sd of [-1, 1]) {
    const b = at(15.6);
    p.poly([b.x + sd * 1, b.y, b.x + sd * 1.8, b.y - 0.4, b.x + sd * 4, b.y - 4]);
  }
  p.fill(C.ice, { mode: 'facet', facets: 3, inner: false });
}

/** Hooded head shared by the duelist look and the ranger (cloth/trim/eye colours vary). */
function hoodHead(c: Ctx, cloth: Ramp, trim: Ramp, eye: Ramp, mask: Ramp | null, peakLen: number, skin: Ramp | null = null): void {
  const { p, P, pose } = c;
  const hz = HEAD - 1.2 + pose.headZ;
  const R = 4.9;
  const shell = c.up(pose.headF - 0.4, 0, hz + 0.4);
  const peak = c.up(pose.headF - 4.4 - peakLen - pose.hatSway * 0.4, 0, hz + 3.2 - peakLen * 0.6);
  p.ellipse(shell.x, shell.y, R + 0.2, R)
    .poly([shell.x - 2.4, shell.y - 2.2, shell.x + 2.4, shell.y - 2.2, peak.x, peak.y])
    .fill(cloth, { mode: 'emboss', dither: true, light: 0.15 });
  if (c.faceVis > -0.25) {
    const fd = P.depthOf(1, 0);
    const fc = c.up(pose.headF + R * 0.62, 0, hz - 0.8);
    const rx = 1 + 2.2 * Math.max(0, fd) + (Math.abs(P.fx) > 0.9 ? 0 : 0.4);
    p.ellipse(fc.x, fc.y, rx + 0.9, 3.3).fill(trim, { mode: 'emboss', inner: false, light: -0.1 });
    if (skin) {
      p.ellipse(fc.x, fc.y + 0.3, rx, 2.6).fill(skin, { mode: 'sphere', inner: false });
      p.rect(fc.x - rx, fc.y - 2.4, rx * 2, 1).fill(PALETTES.hexbinder.face, { mode: 'flat', tone: 1, inner: false });
    } else p.ellipse(fc.x, fc.y, rx, 2.6).fill(PALETTES.hexbinder.face, { mode: 'flat', tone: 1, inner: false });
    if (mask) p.rect(fc.x - rx, fc.y + 0.6, rx * 2, 2).fill(mask, { mode: 'flat', tone: 1, inner: false });
    for (const th of [-0.48, 0.48]) {
      if (P.depthOf(Math.cos(th), Math.sin(th)) < 0.05) continue;
      const q = c.up(pose.headF + Math.cos(th) * (R - 0.3), Math.sin(th) * (R - 0.3), hz - 1);
      if (skin) p.px(q.x, q.y, eye[0]!);
      else p.gpx(q.x, q.y, eye[3]!, eye[2]!);
    }
  }
}

function rangerTorso(c: Ctx): void {
  const { p, P } = c;
  const Rg = PALETTES.ranger;
  p.poly(hull(ringPts(c, 2.9, 4.5, SH + 0.3, 12).concat(ringPts(c, 2.7, 4, HIP - 1.5, 12)))).fill(Rg.leather, { mode: 'cyl', dither: true });
  p.poly(band(c, 2.8, 4.1, HIP + 1, HIP + 2.3)).fill(Rg.leather, { mode: 'emboss', light: -0.3, inner: false });
  const front = P.depthOf(1, 0) > -0.3;
  const a = c.up(front ? 2.4 : -2.4, front ? -3.6 : 3.6, SH);
  const b = c.up(front ? 2.6 : -2.6, front ? 3 : -3, HIP + 2.4);
  p.line(a.x, a.y, b.x, b.y).fill(Rg.leather, { mode: 'flat', tone: 0, inner: false });
}

function quiver(c: Ctx): void {
  const { p } = c;
  const Rg = PALETTES.ranger;
  const a = c.up(-3, 2.2, 10);
  const b = c.up(-3.8, 2.6, 21.5);
  p.capsule(a.x, a.y, b.x, b.y, 1.6, 1.8).fill(Rg.leather, { mode: 'cyl' });
  for (let k = -1; k <= 1; k++) {
    const t = c.up(-4.2 + k * 0.3, 2.6 + k * 0.9, 24.5 + (k === 0 ? 1 : 0));
    p.capsule(b.x + k, b.y, t.x, t.y, 0.5, 0.5).fill(Rg.bow, { mode: 'flat', tone: 3, inner: false });
    p.px(t.x, t.y, Rg.fletch[k === 0 ? 3 : 2]!).px(t.x, t.y - 1, 0xf0f0f0);
  }
}

function longbow(c: Ctx): void {
  const { p, pose } = c;
  const Rg = PALETTES.ranger;
  const hL = pose.handL;
  const hR = pose.handR;
  const aim = pose.pull > 0.05 ? n3(hL[0] - hR[0], hL[1] - hR[1], hL[2] - hR[2]) : pose.wpnL;
  const hz2 = aim[0] * aim[0] + aim[1] * aim[1];
  const upv = n3(-aim[0] * aim[2], -aim[1] * aim[2], hz2 || 1);
  const pt = (t: number): Pt => {
    const back = 0.8 - 2.6 * t * t;
    return c.up(hL[0] + aim[0] * back + upv[0] * 11 * t, hL[1] + aim[1] * back + upv[1] * 11 * t, hL[2] + aim[2] * back + upv[2] * 11 * t);
  };
  let prev = pt(-1);
  for (let k = 1; k <= 10; k++) {
    const q = pt(-1 + (k / 10) * 2);
    const r = 1.35 - Math.abs(-1 + (k / 10) * 2) * 0.55;
    p.capsule(prev.x, prev.y, q.x, q.y, r, r);
    prev = q;
  }
  p.fill(Rg.bow, { mode: 'cyl' });
  const top = pt(-1);
  const bot = pt(1);
  const nockLocal: V3 = pose.pull > 0.05 ? pose.handR : [hL[0] - aim[0] * 1.8, hL[1] - aim[1] * 1.8, hL[2] - aim[2] * 1.8];
  const nock = c.up(nockLocal[0], nockLocal[1], nockLocal[2]);
  p.line(top.x, top.y, nock.x, nock.y).line(bot.x, bot.y, nock.x, nock.y).fill(Rg.string, { mode: 'flat', tone: 2, inner: false });
  if (pose.pull > 0.1) {
    const tip = c.up(nockLocal[0] + aim[0] * 13, nockLocal[1] + aim[1] * 13, nockLocal[2] + aim[2] * 13);
    p.line(nock.x, nock.y, tip.x, tip.y).fill(Rg.bow, { mode: 'flat', tone: 3, inner: false });
    p.px(tip.x, tip.y, 0xe8ecf0);
    p.px(nock.x, nock.y, Rg.fletch[3]!);
  }
}

function wardenTorso(c: Ctx): void {
  const { p } = c;
  const W = PALETTES.warden;
  p.poly(hull(ringPts(c, 3.2, 5, SH + 0.4, 14).concat(ringPts(c, 2.8, 4.2, HIP + 1.2, 14)))).fill(W.bark, { mode: 'cyl', dither: true });
  for (const z of [SH - 3.5, SH - 7]) p.poly(band(c, 3.1, 4.8, z, z + 0.7)).fill(W.bark, { mode: 'flat', tone: 0, inner: false });
  p.poly(band(c, 3, 4.4, HIP + 1, HIP + 2.4)).fill(W.vine, { mode: 'emboss', inner: false });
  p.poly(hull(ringPts(c, 2.9, 4.4, HIP + 1, 12).concat(ringPts(c, 3.4, 5, HIP - 2.8, 12)))).fill(W.leaf, { mode: 'cyl', dither: true });
}

function leafMantle(c: Ctx): void {
  const { p } = c;
  const W = PALETTES.warden;
  const ring = ringPts(c, 3.4, 5.6, SH + 0.8, 10);
  for (const q of ring) p.ellipse(q.x, q.y, 2.1, 1.5);
  p.fill(W.leaf, { mode: 'sphere', dither: true });
  for (const q of frontArc(c, 3.9, 6.1, SH + 0.2, 5)) p.px(q.x, q.y - 1, W.leaf[4]!);
}

function wardenHead(c: Ctx): void {
  const { p, P, pose } = c;
  const W = PALETTES.warden;
  const hz = HEAD - 1 + pose.headZ;
  const R = 4.9;
  const hc = c.up(pose.headF, 0, hz);
  // antler/branch headdress (behind/above the hood)
  for (const s of [-1, 1]) {
    const pts: V3[] = [
      [pose.headF - 0.5, s * 2.4, hz + 3],
      [pose.headF - 1, s * 4.8, hz + 7.5],
      [pose.headF - 2.2, s * 7, hz + 10.5],
    ];
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = c.up(...pts[k]!);
      const b = c.up(...pts[k + 1]!);
      p.capsule(a.x, a.y, b.x, b.y, 1.1 - k * 0.3, 0.8 - k * 0.2);
    }
    const tine0 = c.up(pose.headF - 1, s * 4.8, hz + 7.5);
    const tine1 = c.up(pose.headF + 1.2, s * 5.6, hz + 10.5);
    p.capsule(tine0.x, tine0.y, tine1.x, tine1.y, 0.7, 0.4);
  }
  p.fill(W.antler, { mode: 'emboss', light: -0.1 });
  p.ellipse(hc.x, hc.y, R + 0.3, R).fill(W.leaf, { mode: 'sphere', dither: true });
  if (c.faceVis > -0.25) {
    const fd = P.depthOf(1, 0);
    const fc = c.up(pose.headF + R * 0.6, 0, hz - 0.6);
    const rx = 1 + 2.2 * Math.max(0, fd) + (Math.abs(P.fx) > 0.9 ? 0 : 0.4);
    p.ellipse(fc.x, fc.y, rx, 2.8).fill(W.bark, { mode: 'emboss', inner: false });
    for (const th of [-0.48, 0.48]) {
      if (P.depthOf(Math.cos(th), Math.sin(th)) < 0.05) continue;
      const q = c.up(pose.headF + Math.cos(th) * (R - 0.3), Math.sin(th) * (R - 0.3), hz - 0.6);
      p.gpx(q.x, q.y, W.eye[3]!, W.eye[2]!);
    }
  }
}

function thornSpear(c: Ctx): void {
  const { p, pose } = c;
  const W = PALETTES.warden;
  const h = pose.handR;
  const w = pose.wpn;
  const at = (k: number): Pt => c.up(h[0] + w[0] * k, h[1] + w[1] * k, h[2] + w[2] * k);
  const a = at(-10);
  const b = at(15);
  p.capsule(a.x, a.y, b.x, b.y, 1.05, 1.05).fill(W.shaft, { mode: 'cyl' });
  for (const k of [-6, -2, 3, 8, 12]) {
    const q = at(k);
    p.px(q.x + 1, q.y - 1, W.vine[3]!).px(q.x - 1, q.y + 1, W.vine[2]!);
  }
  const t0 = at(14.5);
  const t1 = at(21.5);
  const ux = t1.x - t0.x;
  const uy = t1.y - t0.y;
  const L = Math.hypot(ux, uy) || 1;
  const nx = (-uy / L) * 2.3;
  const ny = (ux / L) * 2.3;
  const mx = (t0.x + t1.x) / 2;
  const my = (t0.y + t1.y) / 2;
  if (L < 1.5) p.poly([t0.x, t0.y - 4, t0.x + 1.8, t0.y - 1, t0.x, t0.y + 1, t0.x - 1.8, t0.y - 1]);
  else p.poly([t0.x, t0.y, mx + nx, my + ny, t1.x, t1.y, mx - nx, my - ny]);
  p.fill(W.spear, { mode: 'facet', facets: 4, rot: Math.PI / 4, glow: W.leaf[3]!, inner: false });
}

/** Thick bare arm with a leather bracer (berserker). */
function brawnyArm(c: Ctx, side: number, hand: V3, extra?: () => void): void {
  const { p } = c;
  const B = PALETTES.berserker;
  const sh = c.up(0, side * 6, SH - 0.4);
  const el = c.up(hand[0] / 2 - 0.4, (hand[1] + side * 6) / 2 + side * 1.1, (hand[2] + SH) / 2 - 1.2);
  const hd = c.up(hand[0], hand[1], hand[2]);
  p.capsule(sh.x, sh.y, el.x, el.y, 2.6, 2.1).capsule(el.x, el.y, hd.x, hd.y, 2.1, 1.9).fill(B.skin, { mode: 'cyl' });
  const bx = lerp(el.x, hd.x, 0.55);
  const by = lerp(el.y, hd.y, 0.55);
  p.capsule(bx, by, lerp(el.x, hd.x, 0.85), lerp(el.y, hd.y, 0.85), 2.1, 2).fill(B.leather, { mode: 'cyl', inner: false });
  if (extra) extra();
  p.ellipse(hd.x, hd.y, 2.1, 1.9).fill(B.skin, { mode: 'sphere' });
}

// ------------------------------------------------------------------ class look table

interface Look {
  seed: number;
  trail: number;
  trailR: [number, number];
  spark: [number, number];
  burst: number;
  blur: number;
  glow: number;
  death: { tint: number; glint: boolean; drop: number };
}

const LOOK: Record<HeroClass, Look> = {
  vanguard: { seed: 1000, trail: MATERIALS.brass[3]!, trailR: [8, 20], spark: [MATERIALS.brass[3]!, MATERIALS.flame[3]!], burst: MATERIALS.brass[3]!, blur: MATERIALS.bloodRed[3]!, glow: MATERIALS.brass[3]!, death: { tint: 0x4a3036, glint: true, drop: MATERIALS.bloodRed[2]! } },
  arcanist: { seed: 2000, trail: MATERIALS.flame[2]!, trailR: [15, 21], spark: [MATERIALS.arcane[3]!, MATERIALS.arcane[2]!], burst: MATERIALS.arcane[2]!, blur: MATERIALS.arcane[2]!, glow: MATERIALS.arcane[3]!, death: { tint: 0x2e1c34, glint: false, drop: MATERIALS.arcane[2]! } },
  duelist: { seed: 3000, trail: MATERIALS.crimson[3]!, trailR: [8, 18], spark: [MATERIALS.crimson[3]!, 0xe8ecff], burst: MATERIALS.crimson[3]!, blur: MATERIALS.crimson[2]!, glow: MATERIALS.crimson[3]!, death: { tint: 0x2a1a20, glint: false, drop: MATERIALS.bloodRed[2]! } },
  hexbinder: { seed: 4000, trail: PALETTES.hexbinder.glow[2]!, trailR: [15, 21], spark: [PALETTES.hexbinder.glow[3]!, MATERIALS.hexViolet[3]!], burst: PALETTES.hexbinder.glow[2]!, blur: PALETTES.hexbinder.glow[2]!, glow: PALETTES.hexbinder.glow[3]!, death: { tint: 0x241a2c, glint: false, drop: PALETTES.hexbinder.glow[2]! } },
  artificer: { seed: 5000, trail: PALETTES.artificer.lens[2]!, trailR: [12, 20], spark: [PALETTES.artificer.lens[3]!, MATERIALS.brass[3]!], burst: PALETTES.artificer.lens[2]!, blur: PALETTES.artificer.lens[2]!, glow: PALETTES.artificer.lens[3]!, death: { tint: 0x3a3022, glint: true, drop: MATERIALS.bloodRed[2]! } },
  templar: { seed: 6000, trail: MATERIALS.gold[3]!, trailR: [9, 21], spark: [MATERIALS.gold[3]!, 0xffffff], burst: MATERIALS.gold[3]!, blur: MATERIALS.gold[2]!, glow: MATERIALS.gold[4]!, death: { tint: 0x4a4436, glint: true, drop: MATERIALS.bloodRed[2]! } },
  berserker: { seed: 7000, trail: MATERIALS.bloodRed[3]!, trailR: [6, 16], spark: [MATERIALS.bloodRed[3]!, MATERIALS.flame[3]!], burst: MATERIALS.bloodRed[3]!, blur: MATERIALS.bloodRed[2]!, glow: MATERIALS.flame[3]!, death: { tint: 0x3a2018, glint: false, drop: MATERIALS.bloodRed[2]! } },
  cryomancer: { seed: 8000, trail: MATERIALS.glassCyan[2]!, trailR: [15, 21], spark: [MATERIALS.glassCyan[3]!, 0xffffff], burst: MATERIALS.glassCyan[2]!, blur: MATERIALS.glassCyan[2]!, glow: MATERIALS.glassCyan[3]!, death: { tint: 0x2a3a4a, glint: true, drop: MATERIALS.glassCyan[2]! } },
  ranger: { seed: 9000, trail: PALETTES.ranger.eye[2]!, trailR: [8, 16], spark: [PALETTES.ranger.eye[2]!, MATERIALS.brass[3]!], burst: PALETTES.ranger.cloak[4]!, blur: PALETTES.ranger.cloak[3]!, glow: PALETTES.ranger.eye[2]!, death: { tint: 0x22281a, glint: false, drop: MATERIALS.bloodRed[2]! } },
  warden: { seed: 10000, trail: PALETTES.warden.leaf[4]!, trailR: [12, 21], spark: [PALETTES.warden.leaf[4]!, PALETTES.warden.eye[3]!], burst: PALETTES.warden.leaf[3]!, blur: PALETTES.warden.leaf[3]!, glow: PALETTES.warden.eye[3]!, death: { tint: 0x2a2418, glint: false, drop: PALETTES.warden.leaf[3]! } },
};

function renderPose(p: Painter, cls: HeroClass, view: View, pose: HPose): void {
  const P = new Proj(CX, GY, VIEW_ANGLE[view]);
  const up = (f: number, r: number, z: number): Pt => {
    const [tf, tr] = rot(f, r, pose.twist);
    const k = clamp((z - HIP) / (SH - HIP), 0, 1.3);
    return P.p(tf + pose.lean * k, tr + pose.side * k, z * pose.squash + pose.bob);
  };
  const c: Ctx = { p, P, pose, cls, up, faceVis: P.depthOf(1, 0) };
  if (pose.ball >= 0) {
    ballPose(c);
    return;
  }
  const parts: Part[] = [];
  const V = PALETTES.vanguard;
  const A = PALETTES.arcanist;
  const fd = (f: number, r: number): number => {
    const [tf, tr] = rot(f, r, pose.twist);
    return P.depthOf(tf, tr);
  };
  const robed = cls === 'arcanist' || cls === 'hexbinder';
  // legs
  for (const side of [-1, 1]) {
    const foot = side < 0 ? pose.footL : pose.footR;
    const d = P.depthOf(foot[0], foot[1]) - 0.5;
    if (cls === 'vanguard') parts.push({ d, draw: () => drawLeg(c, side, foot, V.plate, V.under, V.plate) });
    else if (cls === 'duelist') parts.push({ d, draw: () => drawLeg(c, side, foot, PALETTES.duelist.leather, PALETTES.duelist.cloth, null) });
    else if (cls === 'artificer') parts.push({ d, draw: () => drawLeg(c, side, foot, PALETTES.artificer.leather, PALETTES.artificer.trousers, PALETTES.artificer.brass) });
    else if (cls === 'templar') parts.push({ d, draw: () => drawLeg(c, side, foot, PALETTES.templar.plate, PALETTES.templar.plate, PALETTES.templar.gold) });
    else if (cls === 'berserker') parts.push({ d, draw: () => drawLeg(c, side, foot, PALETTES.berserker.fur, PALETTES.berserker.leather, null) });
    else if (cls === 'ranger') parts.push({ d, draw: () => drawLeg(c, side, foot, PALETTES.ranger.leather, PALETTES.berserker.leather, null) });
    else if (cls === 'warden') parts.push({ d, draw: () => drawLeg(c, side, foot, PALETTES.warden.shaft, PALETTES.warden.bark, PALETTES.warden.leaf) });
    else
      parts.push({
        d: d + 0.2,
        draw: () => {
          const ft = P.p(foot[0], foot[1], foot[2]);
          const toe = P.p(foot[0] + 1.6, foot[1], foot[2]);
          p.ellipse((ft.x + toe.x) / 2, (ft.y + toe.y) / 2 - 0.8, 2.3, 1.7).fill(MATERIALS.leather, { mode: 'sphere' });
        },
      });
  }
  // body
  const backD = (f: number): number => {
    const d0 = fd(f, 0);
    return d0 > 0.5 ? d0 : Math.min(d0, -0.4) - 0.3;
  };
  if (cls === 'vanguard') {
    parts.push({ d: backD(-2.5), draw: () => drawCape(c) });
    parts.push({ d: 0, draw: () => vanguardTorso(c) });
    for (const side of [-1, 1]) parts.push({ d: fd(-0.3, side * 5.6) + 0.3, draw: () => pauldron(c, side) });
  } else if (cls === 'duelist') {
    parts.push({ d: backD(-2.2), draw: () => shortCape(c, PALETTES.duelist.cloth, PALETTES.duelist.accent) });
    parts.push({ d: backD(-3) - 0.05, draw: () => scarf(c) });
    parts.push({ d: 0, draw: () => duelistTorso(c) });
  } else if (cls === 'artificer') {
    parts.push({ d: backD(-4.2), draw: () => backpack(c) });
    parts.push({ d: 0, draw: () => artificerTorso(c) });
  } else if (cls === 'hexbinder') {
    parts.push({
      d: 0,
      draw: () => {
        robe(c, PALETTES.hexbinder);
        tatter(c, p.buf);
      },
    });
    parts.push({ d: 0.05, draw: () => shawl(c) });
  } else if (cls === 'templar') {
    parts.push({ d: 0, draw: () => templarTorso(c) });
    for (const side of [-1, 1]) parts.push({ d: fd(-0.3, side * 5.6) + 0.3, draw: () => goldPauldron(c, side) });
  } else if (cls === 'berserker') {
    parts.push({ d: 0, draw: () => berserkerTorso(c) });
    parts.push({ d: 0.05, draw: () => furMantle(c) });
  } else if (cls === 'ranger') {
    parts.push({ d: backD(-2.8), draw: () => longCape(c, PALETTES.ranger.cloak) });
    parts.push({ d: backD(-3.4), draw: () => quiver(c) });
    parts.push({ d: 0, draw: () => rangerTorso(c) });
  } else if (cls === 'warden') {
    parts.push({ d: 0, draw: () => wardenTorso(c) });
    parts.push({ d: 0.05, draw: () => leafMantle(c) });
  } else if (cls === 'cryomancer') {
    parts.push({ d: c.faceVis > -0.1 ? backD(-3) : fd(pose.headF, 0) + 0.55, draw: () => cryoHair(c) });
    parts.push({ d: 0, draw: () => robe(c, PALETTES.cryomancer) });
  } else {
    parts.push({ d: 0, draw: () => robe(c) });
  }
  // arms + held items
  const hr = pose.handR;
  const hl = pose.handL;
  const shR = fd(0, 5.2);
  const shL = fd(0, -5.2);
  const handRd = fd(hr[0], hr[1]);
  const handLd = fd(hl[0], hl[1]);
  if (cls === 'vanguard') {
    const wd = fd(hr[0] + pose.wpn[0] * 7, hr[1] + pose.wpn[1] * 7);
    parts.push({
      d: (shR + handRd) / 2 + 0.25 + Math.max(0, (wd - handRd) * 0.3),
      draw: () => drawArm(c, 1, hr, V.under, V.plate, false, () => cleaver(c)),
    });
    parts.push({ d: (shL + handLd) / 2 + 0.2, draw: () => drawArm(c, -1, hl, V.under, V.plate, false) });
    const [snf, snr] = rot(1, 0, pose.shieldYaw);
    const sd = pose.shieldDown ? P.depthOf(hl[0], hl[1] - 2) - 1.5 : fd(hl[0] + snf * 1.3, hl[1] + snr * 1.3) + 0.4;
    parts.push({ d: sd, draw: () => towerShield(c) });
  } else if (cls === 'duelist') {
    const D = PALETTES.duelist;
    const wdR = fd(hr[0] + pose.wpn[0] * 6, hr[1] + pose.wpn[1] * 6);
    const wdL = fd(hl[0] + pose.wpnL[0] * 6, hl[1] + pose.wpnL[1] * 6);
    parts.push({ d: (shR + handRd) / 2 + 0.25 + Math.max(0, (wdR - handRd) * 0.3), draw: () => drawArm(c, 1, hr, D.leather, D.grip, false, () => sabre(c, hr, pose.wpn, 1)) });
    parts.push({ d: (shL + handLd) / 2 + 0.2 + Math.max(0, (wdL - handLd) * 0.3), draw: () => drawArm(c, -1, hl, D.leather, D.grip, false, () => sabre(c, hl, pose.wpnL, -1)) });
  } else if (cls === 'artificer') {
    const AR = PALETTES.artificer;
    const gunD = Math.max(handRd, handLd) + 0.3;
    parts.push({ d: (shR + handRd) / 2 + 0.2, draw: () => drawArm(c, 1, hr, AR.coat, AR.leather, false) });
    parts.push({ d: gunD, draw: () => crossbow(c) });
    parts.push({ d: Math.max(gunD + 0.05, (shL + handLd) / 2 + 0.2), draw: () => drawArm(c, -1, hl, AR.coat, AR.leather, false) });
    if (pose.bomb === 1) parts.push({ d: handLd + 0.6, draw: () => bombAt(c, c.up(hl[0], hl[1], hl[2] + 1.6)) });
    if (pose.bomb >= 2) {
      const far = pose.bomb === 2 ? [11, -1, 24] : [17, 0, 21];
      parts.push({ d: fd(far[0]!, far[1]!) + 0.5, draw: () => bombAt(c, c.up(far[0]!, far[1]!, far[2]!)) });
    }
  } else if (cls === 'templar') {
    const T = PALETTES.templar;
    const wd = fd(hr[0] + pose.wpn[0] * 10, hr[1] + pose.wpn[1] * 10);
    parts.push({ d: (shR + handRd) / 2 + 0.25 + Math.max(0, (wd - handRd) * 0.3), draw: () => drawArm(c, 1, hr, T.plate, T.plate, false, () => greatHammer(c)) });
    parts.push({ d: (shL + handLd) / 2 + 0.2, draw: () => drawArm(c, -1, hl, T.plate, T.plate, false) });
  } else if (cls === 'berserker') {
    const wdR = fd(hr[0] + pose.wpn[0] * 6, hr[1] + pose.wpn[1] * 6);
    const wdL = fd(hl[0] + pose.wpnL[0] * 6, hl[1] + pose.wpnL[1] * 6);
    parts.push({ d: (shR + handRd) / 2 + 0.25 + Math.max(0, (wdR - handRd) * 0.3), draw: () => brawnyArm(c, 1, hr, () => axe(c, hr, pose.wpn, 1)) });
    parts.push({ d: (shL + handLd) / 2 + 0.2 + Math.max(0, (wdL - handLd) * 0.3), draw: () => brawnyArm(c, -1, hl, () => axe(c, hl, pose.wpnL, -1)) });
  } else if (cls === 'ranger') {
    const Rg = PALETTES.ranger;
    parts.push({ d: (shR + handRd) / 2 + 0.2, draw: () => drawArm(c, 1, hr, Rg.leather, Rg.leather, false) });
    parts.push({ d: (shL + handLd) / 2 + 0.25, draw: () => drawArm(c, -1, hl, Rg.cloak, Rg.leather, false, () => longbow(c)) });
  } else if (cls === 'warden') {
    const W = PALETTES.warden;
    const wd = fd(hr[0] + pose.wpn[0] * 8, hr[1] + pose.wpn[1] * 8);
    parts.push({ d: (shR + handRd) / 2 + 0.25 + Math.max(0, (wd - handRd) * 0.3), draw: () => drawArm(c, 1, hr, W.bark, W.shaft, false, () => thornSpear(c)) });
    parts.push({ d: (shL + handLd) / 2 + 0.2, draw: () => drawArm(c, -1, hl, W.bark, W.shaft, false) });
  } else if (cls === 'cryomancer') {
    const C = PALETTES.cryomancer;
    parts.push({
      d: (shR + handRd) / 2 + 0.25,
      draw: () => {
        iceStaff(c);
        drawArm(c, 1, hr, C.robe, C.skin, true);
      },
    });
    parts.push({ d: (shL + handLd) / 2 + 0.2, draw: () => drawArm(c, -1, hl, C.robe, C.skin, true) });
  } else {
    const H = cls === 'hexbinder' ? PALETTES.hexbinder : null;
    parts.push({
      d: (shR + handRd) / 2 + 0.25,
      draw: () => {
        if (H) boneStaff(c);
        else staff(c);
        drawArm(c, 1, hr, H ? H.robe : A.robe, H ? H.skin : A.skin, true);
      },
    });
    parts.push({ d: (shL + handLd) / 2 + 0.2, draw: () => drawArm(c, -1, hl, H ? H.robe : A.robe, H ? H.skin : A.skin, true) });
  }
  // head
  const headDraw = (): void => {
    if (cls === 'vanguard') vanguardHead(c);
    else if (cls === 'duelist') duelistHead(c);
    else if (cls === 'artificer') artificerHead(c);
    else if (cls === 'templar') templarHead(c);
    else if (cls === 'berserker') berserkerHead(c);
    else if (cls === 'cryomancer') cryoHead(c);
    else if (cls === 'ranger') hoodHead(c, PALETTES.ranger.cloak, PALETTES.ranger.leather, PALETTES.ranger.eye, null, 1.4, PALETTES.ranger.skin);
    else if (cls === 'warden') wardenHead(c);
    else if (cls === 'hexbinder') arcanistHead(c, { hat: PALETTES.hexbinder.robe, trim: PALETTES.hexbinder.trim, face: PALETTES.hexbinder.face, eye: PALETTES.hexbinder.glow }, 0.45);
    else arcanistHead(c);
  };
  const headD = fd(pose.headF, 0) + 0.6;
  parts.push({ d: headD, draw: headDraw });
  if (cls === 'templar') parts.push({ d: c.faceVis > -0.35 ? headD - 0.05 : headD + 0.05, draw: () => halo(c) });
  if (cls === 'arcanist') parts.push({ d: fd(1, -8.2) + 0.2, draw: () => prism(c) });
  if (cls === 'hexbinder') parts.push({ d: fd(1, -8.6) + 0.2, draw: () => skullLantern(c) });
  void robed;
  drawParts(parts);
}

function drawTrail(buf: PixelBuffer, up: (f: number, r: number, z: number) => Pt, trail: [number, number, number, number], rIn: number, rOut: number, trailCol: number): void {
  const [a0, a1, z, str] = trail;
  const acc = new Map<number, [number, number]>();
  const steps = Math.ceil(Math.abs(a1 - a0) * rOut * 2.4);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const a = lerp(a0, a1, t);
    for (let r = rIn; r <= rOut; r += 0.5) {
      const q = up(Math.cos(a) * r + 1, Math.sin(a) * r + 1, z - (r - rIn) * 0.12);
      const x = Math.round(q.x);
      const y = Math.round(q.y);
      if (x < 0 || y < 0 || x >= buf.w || y >= buf.h) continue;
      const edge = (rOut - r) / (rOut - rIn);
      const al = Math.min(255, Math.round((40 + 215 * t * t) * str * (edge < 0.2 ? 1.1 : 0.85)));
      const col = edge < 0.18 ? 0xffffff : mix(trailCol, 0xffffff, 0.25 * (1 - edge));
      const key = y * buf.w + x;
      const prev = acc.get(key);
      if (!prev || prev[1] < al) acc.set(key, [col, al]);
    }
  }
  for (const [key, [col, al]] of acc) buf.blend(key % buf.w, Math.floor(key / buf.w), col, al);
}

/** Overlays drawn after the outline pass (no outline): trails, sparks, bursts, steam, wisps, muzzle flash. */
function overlays(buf: PixelBuffer, cls: HeroClass, view: View, pose: HPose, seed: number, frame: number): void {
  const P = new Proj(CX, GY, VIEW_ANGLE[view]);
  const up = (f: number, r: number, z: number): Pt => {
    const k = clamp((z - HIP) / (SH - HIP), 0, 1.3);
    return P.p(f + pose.lean * k, r + pose.side * k, z * pose.squash + pose.bob);
  };
  const L = LOOK[cls];
  if (pose.trail) drawTrail(buf, up, pose.trail, L.trailR[0], L.trailR[1], L.trail);
  if (pose.trail2) drawTrail(buf, up, pose.trail2, L.trailR[0], L.trailR[1], L.trail);
  const r = rng(seed);
  if (pose.sparks > 0) {
    for (let k = 0; k < pose.sparks; k++) {
      const a = r() * Math.PI * 2;
      const rad = 7 + r() * 9;
      sparkle(buf, Math.round(CX + Math.cos(a) * rad), Math.round(GY - 16 + Math.sin(a) * rad * 0.9), k % 2 ? L.spark[0] : L.spark[1], r() > 0.6 ? 2 : 1, 230);
    }
  }
  if (pose.gleam) {
    const hR = pose.handR;
    const w = pose.wpn;
    const reach = GLEAM_REACH[cls];
    const tip = cls === 'ranger' ? up(pose.handL[0] + pose.wpnL[0] * reach, pose.handL[1] + pose.wpnL[1] * reach, pose.handL[2] + pose.wpnL[2] * reach) : up(hR[0] + w[0] * reach, hR[1] + w[1] * reach, hR[2] + w[2] * reach);
    sparkle(buf, Math.round(tip.x), Math.round(tip.y), 0xffffff, 3, 255);
    if (cls === 'duelist' || cls === 'berserker') {
      const hL = pose.handL;
      const wl = pose.wpnL;
      const t2 = up(hL[0] + wl[0] * reach, hL[1] + wl[1] * reach, hL[2] + wl[2] * reach);
      sparkle(buf, Math.round(t2.x), Math.round(t2.y), 0xffffff, 2, 230);
    }
  }
  if (pose.burst > 0) {
    const rad = 6 + pose.burst * 12;
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      const x = Math.round(CX + Math.cos(a) * rad);
      const y = Math.round(GY + Math.sin(a) * rad * 0.5);
      buf.blend(x, y, L.burst, Math.round(220 * (1.15 - pose.burst * 0.5)));
      buf.blend(x, y - 1, 0xffffff, Math.round(120 * (1.1 - pose.burst * 0.6)));
    }
  }
  if (cls === 'artificer') {
    // steam puffs from the backpack chimneys
    if (pose.steam > 0) {
      for (const s of [-1, 1]) {
        const base = up(-4.6, s * 2.3, 28 + (s > 0 ? 1.5 : 0));
        const n = 1 + Math.round(pose.steam * 2);
        for (let k = 0; k < n; k++) {
          const rise = ((frame * 2 + k * 3 + (s > 0 ? 1 : 0)) % 7) + k * 1.5;
          const cx = base.x + (r() - 0.5) * 2;
          const cy = base.y - rise;
          const rad = 1.2 + rise * 0.18;
          for (let y = Math.floor(cy - rad); y <= cy + rad; y++)
            for (let x = Math.floor(cx - rad); x <= cx + rad; x++)
              if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= rad) buf.blend(x, y, 0xe8eef0, Math.round(110 * pose.steam * (1 - rise / 14)));
        }
      }
    }
    // muzzle flash + bolt streak
    if (pose.flare > 0.5) {
      const hR = pose.handR;
      const w = pose.wpn;
      const tip = up(hR[0] + w[0] * 9.5, hR[1] + w[1] * 9.5, hR[2] + w[2] * 9.5);
      const far = up(hR[0] + w[0] * 26, hR[1] + w[1] * 26, hR[2] + w[2] * 26);
      for (let k = 0; k <= 30; k++) {
        const t = k / 30;
        const x = Math.round(lerp(tip.x, far.x, t));
        const y = Math.round(lerp(tip.y, far.y, t));
        buf.blend(x, y, t > 0.85 ? 0xffffff : PALETTES.artificer.lens[3]!, Math.round(255 * (0.4 + t * 0.6)));
      }
      sparkle(buf, Math.round(tip.x), Math.round(tip.y), 0xfff0b0, 2, 255);
    }
  }
  if (cls === 'ranger' && pose.flare > 0.5) {
    // loosed arrow streak along the bow's aim
    const hL = pose.handL;
    const a = pose.wpnL;
    const from = up(hL[0] + a[0] * 3, hL[1] + a[1] * 3, hL[2] + a[2] * 3);
    const to = up(hL[0] + a[0] * 26, hL[1] + a[1] * 26, hL[2] + a[2] * 26);
    for (let k = 0; k <= 32; k++) {
      const t = k / 32;
      buf.blend(Math.round(lerp(from.x, to.x, t)), Math.round(lerp(from.y, to.y, t)), t > 0.88 ? 0xffffff : PALETTES.ranger.eye[2]!, Math.round(255 * (0.25 + t * 0.75)));
    }
  }
  if (cls === 'cryomancer') {
    // drifting frost motes
    const I = MATERIALS.glassCyan;
    for (let k = 0; k < 4; k++) {
      const a = k * 1.7 + frame * 0.35;
      const fall = (frame * 1.5 + k * 5) % 16;
      const q = P.p(Math.cos(a) * 8, Math.sin(a) * 8, 30 - fall + pose.bob);
      buf.blend(Math.round(q.x), Math.round(q.y), k % 2 ? 0xffffff : I[3]!, Math.round(200 * (1 - fall / 18)));
    }
  }
  if (cls === 'warden' && (pose.burst > 0 || pose.sparks > 0)) {
    // whirling leaves on the thorn-burst
    const Lf = PALETTES.warden.leaf;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + frame * 0.6;
      const rad = 6 + pose.burst * 10 + (k % 2) * 2;
      const q = P.p(Math.cos(a) * rad, Math.sin(a) * rad, 3 + (k % 3) * 3 + pose.burst * 4);
      buf.blend(Math.round(q.x), Math.round(q.y), Lf[3]!, 230);
      buf.blend(Math.round(q.x) + 1, Math.round(q.y), Lf[4]!, 200);
    }
  }
  if (cls === 'hexbinder') {
    // rot wisps orbiting the warlock
    const G = PALETTES.hexbinder.glow;
    for (let k = 0; k < 3; k++) {
      const a = frame * 0.9 + (k * Math.PI * 2) / 3;
      for (let tail = 0; tail < 4; tail++) {
        const aa = a - tail * 0.25;
        const q = P.p(Math.cos(aa) * 9, Math.sin(aa) * 9, 15 + Math.sin(aa * 2 + k) * 4 + pose.bob);
        buf.blend(Math.round(q.x), Math.round(q.y), tail === 0 ? G[4]! : G[3 - Math.min(2, tail)]!, Math.round(220 * (1 - tail * 0.22)));
      }
    }
  }
}

/** Render one hero frame. */
export function renderHeroFrame(cls: HeroClass, state: HeroState, view: View, i: number, n: number, painter?: Painter): PixelBuffer {
  const p = painter ?? new Painter(new PixelBuffer(FW, FH));
  const L = LOOK[cls];
  const seed = L.seed + i * 31 + view.length * 7 + state.length * 131;
  if (state === 'death') {
    p.reset();
    const pose = heroPose(cls, 'death', 0, 1);
    renderPose(p, cls, view, pose);
    p.finish(PALETTES.playerOutline);
    const base = p.buf.clone();
    if (i === 0) {
      flash(base, 0.55);
      return base;
    }
    const t = Math.pow(i / (n - 1), 1.3);
    return shatter(base, t * 0.95, seed ^ 0x5a5a, L.death.tint, 16, 0.85, {
      glint: L.death.glint,
      drops: { color: L.death.drop, count: 22, groundY: GY },
    });
  }
  const pose = heroPose(cls, state, i, n);
  p.reset();
  renderPose(p, cls, view, pose);
  p.finish(PALETTES.playerOutline);
  const out = p.buf.clone();
  if (pose.blur > 0) {
    const P = new Proj(CX, GY, VIEW_ANGLE[view]);
    smear(out, -P.fx * 7 * pose.blur, -P.fy * 3.5 * pose.blur, L.blur, 3, 120);
  }
  overlays(out, cls, view, pose, seed, i);
  if (pose.glow > 0 && (state === 'revive' || state === 'cast')) {
    rimLight(out, lighten(L.glow, 0.2), pose.glow * (state === 'revive' ? 0.55 : 0.3));
  }
  if (state === 'hit' && i === 0) flash(out, 0.8);
  return out;
}

/** Tints pixels adjacent to transparency toward a light color (magic glow rim). */
function rimLight(buf: PixelBuffer, color: number, amt: number): void {
  const src = buf.clone();
  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      const c = src.get(x, y);
      if (c >>> 24 < 200) continue;
      const near = src.alpha(x - 1, y) < 200 || src.alpha(x + 1, y) < 200 || src.alpha(x, y - 1) < 200 || src.alpha(x, y + 1) < 200;
      if (!near) continue;
      buf.set(x, y, mix(c & 0xffffff, color, amt + 0.25), c >>> 24);
    }
  }
}

export const HERO_FRAME = { w: FW, h: FH, cx: CX, gy: GY };
