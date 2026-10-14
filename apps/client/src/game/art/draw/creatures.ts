/**
 * Ordinary enemy + summon sprites for the Sunken Catacombs. Each creature is posed on
 * the 2.5D rig (views e / s / n) from a small set of pose parameters, drawn as shaded shapes,
 * outlined, then given glows. Pure (no DOM / Phaser).
 */
import { MATERIALS, PALETTES } from '../palette';
import { Painter, PixelBuffer, flash, mix, rimTopLeft, rng, shatter, smear, sparkle, type FillOpts, type Ramp } from './pixel';
import { Proj, VIEW_ANGLE, drawParts, hull, lerp, type Part, type Pt, type View } from './rig';

export type CreatureId =
  | 'pursuer'
  | 'skirmisher'
  | 'artillery'
  | 'guardian'
  | 'hexer'
  | 'broodcaller'
  | 'mite'
  | 'spiritwolf'
  | 'spiritbear'
  | 'spiritelk'
  | 'gaoler'
  | 'rimewraith'
  | 'gloomshade'
  | 'webweaver';

interface CPose {
  /** cycle phase (radians) */
  ph: number;
  bob: number;
  lean: number;
  squash: number;
  /** windup charge 0..1 */
  wind: number;
  /** attack strike 0..1 */
  strike: number;
  /** hit flinch 0..1 */
  hurt: number;
  moving: boolean;
  frame: number;
  /** whole-body forward lunge (attack), feet stay planted */
  lunge: number;
}

interface CC {
  p: Painter;
  P: Proj;
  pose: CPose;
  /** body-space projection (lean + bob + squash applied) */
  at: (f: number, r: number, z: number) => Pt;
  /** ground-space projection (feet) */
  g: (f: number, r: number, z: number) => Pt;
  dep: (f: number, r: number) => number;
}

const GROUND: Record<CreatureId, number> = {
  pursuer: 40,
  skirmisher: 41,
  artillery: 41,
  guardian: 42,
  hexer: 42,
  broodcaller: 42,
  mite: 26,
  spiritwolf: 40,
  spiritbear: 70,
  spiritelk: 72,
  gaoler: 64,
  rimewraith: 42,
  gloomshade: 42,
  webweaver: 41,
};

function poseFor(state: string, i: number, n: number): CPose {
  const p: CPose = { ph: (i / n) * Math.PI * 2, bob: 0, lean: 0, squash: 1, wind: 0, strike: 0, hurt: 0, moving: false, frame: i, lunge: 0 };
  switch (state) {
    case 'idle':
      p.bob = Math.sin(p.ph) * 0.6;
      break;
    case 'run':
      p.moving = true;
      p.lean = 1;
      // two footfalls per cycle: dip on contact, stretch on push-off
      p.bob = 0.5 - Math.abs(Math.sin(p.ph)) * 1.2;
      p.squash = 1 + 0.045 * Math.sin(p.ph * 2 + 0.6);
      break;
    case 'windup':
      p.wind = (i + 1) / n;
      p.ph = 0;
      p.lean = -1.8 * p.wind;
      p.squash = 1 - 0.12 * p.wind;
      break;
    case 'attack': {
      const seq = n <= 2 ? [1, 0.3] : [1, 0.85, 0.45, 0.12];
      p.strike = seq[Math.min(i, seq.length - 1)] ?? 0;
      p.ph = 0;
      p.lean = 4 * p.strike;
      p.squash = 1 + 0.06 * p.strike;
      p.lunge = 1.8 * p.strike;
      break;
    }
    case 'hit':
    case 'death':
      p.hurt = i === 0 || state === 'death' ? 1 : 0.45;
      p.lean = -2.2 * p.hurt;
      p.squash = 1 - 0.06 * p.hurt;
      p.ph = 0.3;
      break;
    default:
      break;
  }
  return p;
}

// ---------------------------------------------------------------- shape helpers

/** Hull of projected spheres (an organic blob body). */
function blob(c: CC, segs: [number, number, number, number][], ramp: Ramp, opts: FillOpts = {}): void {
  const pts: { x: number; y: number }[] = [];
  for (const [f, r, z, rad] of segs) {
    const q = c.at(f, r, z);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      pts.push({ x: q.x + Math.cos(a) * rad, y: q.y + Math.sin(a) * rad * 0.92 });
    }
  }
  c.p.poly(hull(pts)).fill(ramp, opts);
}

function sphere(c: CC, f: number, r: number, z: number, rad: number, ramp: Ramp, opts: FillOpts = {}, ry = 0.92): Pt {
  const q = c.at(f, r, z);
  c.p.ellipse(q.x, q.y, rad, rad * ry).fill(ramp, { mode: 'sphere', ...opts });
  return q;
}

function limb(c: CC, a: Pt, b: Pt, r0: number, r1: number, ramp: Ramp, opts: FillOpts = {}): void {
  c.p.capsule(a.x, a.y, b.x, b.y, r0, r1).fill(ramp, { mode: 'cyl', ...opts });
}

function tri(c: CC, a: Pt, b: Pt, d: Pt, ramp: Ramp, opts: FillOpts = {}): void {
  c.p.poly([a.x, a.y, b.x, b.y, d.x, d.y]).fill(ramp, opts);
}

/** Glowing eye on a head sphere surface, only if it faces the camera. */
function eye(c: CC, hf: number, hz: number, rad: number, th: number, dz: number, col: number, halo: number, size = 1): boolean {
  const dep = c.P.depthOf(Math.cos(th), Math.sin(th));
  if (dep < 0.05) return false;
  const q = c.at(hf + Math.cos(th) * rad, Math.sin(th) * rad, hz + dz);
  c.p.gpx(q.x, q.y, col, halo);
  if (size > 1) c.p.gpx(q.x + 1, q.y, col, halo).gpx(q.x, q.y + 1, mix(col, halo, 0.5), halo);
  return true;
}


// ---------------------------------------------------------------- pursuer: Ghoul Hound

function pursuer(c: CC): Part[] {
  const { pose, P } = c;
  const C = PALETTES.pursuer;
  const parts: Part[] = [];
  const s = Math.sin(pose.ph);
  const rock = pose.moving ? s * 1 : 0;
  const stretch = 1 + pose.strike * 0.18 - pose.wind * 0.08;
  const open = Math.max(pose.wind * 0.8, pose.strike);
  const headF = 8.6 * stretch;
  const headZ = 11 + rock * 0.6 + pose.strike * 1 - pose.wind * 1.8;
  const legs: [number, number, number][] = [
    [4 * stretch, -3, 0],
    [4 * stretch, 3, 0.5],
    [-5 * stretch, -3, Math.PI],
    [-5 * stretch, 3, Math.PI + 0.5],
  ];
  for (const [lf, lr, lp] of legs) {
    const ph = pose.ph + lp;
    const footF = lf + (pose.moving ? Math.sin(ph) * 3.8 : 0) + (pose.strike > 0.5 && lf > 0 ? 2.5 : 0) - (pose.wind > 0 && lf < 0 ? 1.2 : 0);
    const lift = pose.moving ? Math.max(0, Math.cos(ph)) * 2.2 : 0;
    parts.push({
      d: c.dep(lf, lr) - 0.4,
      draw: () => {
        const hip = c.at(lf, lr * 0.8, 8.4 + (lf > 0 ? rock : -rock));
        const knee = c.g((lf + footF) / 2 + (lf > 0 ? -1.2 : 1.6), lr, 4 + lift * 0.5);
        const ft = c.g(footF, lr, lift);
        limb(c, hip, knee, 1.9, 1.1, C.body, { mode: 'emboss', dither: true });
        limb(c, knee, ft, 1.1, 0.8, C.dark, { mode: 'emboss' });
        c.p.ellipse(ft.x + P.fx * 0.8, ft.y - 0.3, 1.6, 0.9).fill(C.bone, { mode: 'sphere' });
      },
    });
  }
  // gaunt body with exposed ribs and knobbly spine
  parts.push({
    d: 0,
    draw: () => {
      blob(
        c,
        [
          [3.6 * stretch, 0, 9.6 + rock, 4.9],
          [-0.9, 0, 8.8, 3.4],
          [-5.2 * stretch, 0, 9.2 - rock, 4.2],
        ],
        C.body,
        { mode: 'sphere', dither: true },
      );
      const sides = Math.abs(P.ry) > 0.5 ? [P.ry > 0 ? 1 : -1] : [-1, 1];
      for (const sd of sides) {
        for (let k = 0; k < 4; k++) {
          const f = 4.6 * stretch - k * 1.5;
          const a = c.at(f, sd * 0.6, 13 + rock * 0.6);
          const b = c.at(f - 0.8, sd * 3.9, 8 + rock * 0.3);
          c.p.line(a.x, a.y, b.x, b.y).fill(C.bone, { mode: 'flat', tone: 2, inner: false });
        }
      }
      for (let k = 0; k < 6; k++) {
        const f = 5 * stretch - k * 1.9;
        const q = c.at(f, 0, 13.4 + (f > 0 ? rock : -rock) * 0.6 - (k === 2 || k === 3 ? 0.8 : 0));
        c.p.circle(q.x, q.y, 1.1);
      }
      c.p.fill(C.bone, { mode: 'sphere', inner: false });
    },
  });
  // thin rat tail
  parts.push({
    d: c.dep(-10, 0),
    draw: () => {
      const a = c.at(-8.8 * stretch, 0, 9.6);
      const m = c.at(-11.5 * stretch, 0, 9 + (pose.moving ? s : 0));
      const b = c.at(-13.5 * stretch, 0, 6.5 + (pose.moving ? s * 1.5 : 0) + pose.wind * 3);
      c.p.capsule(a.x, a.y, m.x, m.y, 1, 0.7).capsule(m.x, m.y, b.x, b.y, 0.7, 0.4).fill(C.dark, { mode: 'emboss' });
    },
  });
  // skull-like head
  parts.push({
    d: c.dep(headF, 0) + 0.3,
    draw: () => {
      for (const sd of [-1, 1]) {
        const e0 = c.at(headF - 0.8, sd * 1.6, headZ + 2.4);
        const e1 = c.at(headF - 2.4, sd * 2.8, headZ + 1.8);
        const et = c.at(headF - 3.6, sd * 3.4, headZ + 6 + pose.wind);
        tri(c, e0, et, e1, C.dark, { mode: 'emboss' });
      }
      const jawA = c.at(headF + 1, 0, headZ - 1.8);
      const jawB = c.at(headF + 4.6, 0, headZ - 2.6 - open * 2.8);
      limb(c, jawA, jawB, 1.7, 1.2, C.dark, { mode: 'emboss' });
      if (open > 0.2) {
        const m = c.at(headF + 3.4, 0, headZ - 2.2 - open * 1.2);
        c.p.ellipse(m.x, m.y, 1.6 + open, 1 + open * 0.7).fill(MATERIALS.bloodRed, { mode: 'flat', tone: 0, inner: false });
      }
      blob(
        c,
        [
          [headF, 0, headZ, 3.9],
          [headF + 4.2, 0, headZ - 1, 2.2],
        ],
        C.body,
        { mode: 'sphere', dither: true, light: 0.05 },
      );
      // bared teeth (always a fang, a full row when the jaw opens)
      if (P.depthOf(1, 0) > -0.3) {
        const t1 = c.at(headF + 4.8, 0.9, headZ - 2.3);
        const t2 = c.at(headF + 4.8, -0.9, headZ - 2.3);
        c.p.px(t1.x, t1.y, 0xffffff);
        if (open > 0.2) c.p.px(t2.x, t2.y, 0xffffff).px(t1.x, t1.y - 1, C.bone[3]!).px((t1.x + t2.x) / 2, t1.y, 0xffffff);
      }
      const hot = pose.wind > 0.5 || pose.strike > 0.5 ? 0xffffff : C.eye[3]!;
      eye(c, headF + 0.8, headZ + 0.8, 3.6, 0.62, 0, hot, C.eye[2]!, 2);
      eye(c, headF + 0.8, headZ + 0.8, 3.6, -0.62, 0, hot, C.eye[2]!, 2);
    },
  });
  return parts;
}

// ---------------------------------------------------------------- skirmisher: Gloom Bat

function skirmisher(c: CC): Part[] {
  const { pose } = c;
  const C = PALETTES.skirmisher;
  const parts: Part[] = [];
  const flap = Math.sin(pose.ph * 2 + Math.PI / 4);
  const hover = 15 + Math.sin(pose.ph) * 1.2 - pose.strike * 2 + pose.wind * 1.5;
  const spread = pose.wind > 0 ? 1 + pose.wind * 0.2 : 1;
  const wz = pose.wind > 0 ? 6 * pose.wind : pose.strike > 0.5 ? -4 : flap * 6.5;
  for (const sd of [-1, 1]) {
    parts.push({
      d: c.dep(0, sd * 8) + (sd > 0 ? 0.1 : -0.1),
      draw: () => {
        const S = c.at(0.5, sd * 2.2, hover + 1.5);
        const W = c.at(1, sd * 8 * spread, hover + 3 + wz);
        const T1 = c.at(6, sd * 13 * spread, hover + 1 + wz * 1.2);
        const T2 = c.at(0.4, sd * 14.5 * spread, hover - 1.5 + wz * 1.1);
        const T3 = c.at(-6.4, sd * 10.5 * spread, hover - 2.5 + wz * 0.7);
        const R0 = c.at(-3.8, sd * 2, hover - 0.5);
        const scal = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2 + (S.x - (a.x + b.x) / 2) * 0.22, y: (a.y + b.y) / 2 + (S.y - (a.y + b.y) / 2) * 0.22, d: 0 });
        const m1 = scal(T1, T2);
        const m2 = scal(T2, T3);
        const m3 = scal(T3, R0);
        c.p.poly([S.x, S.y, W.x, W.y, T1.x, T1.y, m1.x, m1.y, T2.x, T2.y, m2.x, m2.y, T3.x, T3.y, m3.x, m3.y, R0.x, R0.y]).fill(C.wing, { mode: 'emboss', dither: true });
        // arm + finger bones
        c.p.capsule(S.x, S.y, W.x, W.y, 0.9, 0.7);
        for (const T of [T1, T2, T3]) c.p.line(W.x, W.y, T.x, T.y);
        c.p.fill(C.body, { mode: 'flat', tone: 3, inner: false });
        c.p.px(W.x, W.y - 1, C.bone[3]!);
      },
    });
  }
  // dangling claws
  parts.push({
    d: c.dep(-1, 0) - 0.2,
    draw: () => {
      for (const sd of [-1, 1]) {
        const a = c.at(-1, sd * 1.3, hover - 2.5);
        const b = c.at(-1.6, sd * 1.6, hover - 5);
        c.p.line(a.x, a.y, b.x, b.y);
      }
      c.p.fill(C.bone, { mode: 'flat', tone: 1, inner: false });
    },
  });
  parts.push({
    d: 0,
    draw: () => {
      sphere(c, 0, 0, hover, 4.6, C.body, { dither: true });
    },
  });
  parts.push({
    d: c.dep(3, 0) + 0.2,
    draw: () => {
      const hz = hover + 1.8;
      for (const sd of [-1, 1]) {
        const e0 = c.at(2.6, sd * 1.2, hz + 2.2);
        const e1 = c.at(2.2, sd * 2.8, hz + 1.6);
        const et = c.at(1.4, sd * 3, hz + 7 + pose.wind);
        tri(c, e0, et, e1, C.wing, { mode: 'emboss' });
      }
      sphere(c, 3, 0, hz, 3.3, C.body, { dither: true, light: 0.05 });
      const sn = c.at(5.6, 0, hz - 0.6);
      if (c.P.depthOf(1, 0) > -0.3) {
        c.p.ellipse(sn.x, sn.y, 1.6, 1.1).fill(C.wing, { mode: 'sphere', inner: false });
        const open = pose.strike > 0.3 || pose.wind > 0.5;
        c.p.px(sn.x - 1, sn.y + 1, 0xffffff).px(sn.x + 1, sn.y + 1, 0xffffff);
        if (open) c.p.px(sn.x - 1, sn.y + 2, 0xffffff).px(sn.x + 1, sn.y + 2, 0xffffff).px(sn.x, sn.y + 1, MATERIALS.bloodRed[1]!);
      }
      eye(c, 3.2, hz + 0.6, 2.9, 0.55, 0, C.eye[3]!, C.eye[2]!);
      eye(c, 3.2, hz + 0.6, 2.9, -0.55, 0, C.eye[3]!, C.eye[2]!);
    },
  });
  return parts;
}

// ---------------------------------------------------------------- artillery: Bile Toad

function artillery(c: CC): Part[] {
  const { pose } = c;
  const C = PALETTES.artillery;
  const parts: Part[] = [];
  const hop = pose.moving ? Math.max(0, Math.sin(pose.ph)) * 4 : 0;
  const land = pose.moving ? Math.max(0, -Math.sin(pose.ph)) : 0;
  const sq = 1 - land * 0.12 + hop * 0.03;
  const bodyZ = 8.5 * sq + hop;
  const sac = 3.4 + pose.wind * 3.4 - pose.strike * 1.6 + (pose.moving ? 0 : Math.sin(pose.ph) * 0.5);
  const mouth = pose.strike;
  const recoil = -pose.strike * 2.5;
  for (const sd of [-1, 1]) {
    parts.push({
      d: c.dep(-3, sd * 6) - 0.3,
      draw: () => {
        const h = c.at(-3 + recoil, sd * 5.8, bodyZ - 1);
        c.p.ellipse(h.x, h.y, 4.2, 3.6).fill(C.body, { mode: 'sphere', dither: true });
        const ft = c.g(-1 + recoil + (pose.moving ? -hop * 0.4 : 0), sd * 7, 0);
        c.p.ellipse(ft.x + c.P.fx * 1.4, ft.y - 0.6, 2.9, 1.3).fill(C.belly, { mode: 'sphere' });
      },
    });
    parts.push({
      d: c.dep(4, sd * 4) - 0.2,
      draw: () => {
        const a = c.at(3.6 + recoil, sd * 4.2, bodyZ - 2);
        const ft = c.g(5 + recoil + (pose.moving ? hop * 0.5 : 0), sd * 4.6, hop * 0.5);
        limb(c, a, ft, 1.7, 1.3, C.body, { mode: 'emboss' });
        c.p.ellipse(ft.x + c.P.fx, ft.y - 0.4, 2, 1).fill(C.belly, { mode: 'sphere', inner: false });
      },
    });
  }
  parts.push({
    d: 0,
    draw: () => {
      blob(
        c,
        [
          [-1.5 + recoil, 0, bodyZ, 8.2 * (2 - sq) * 0.5 + 5.4],
          [2.6 + recoil, 0, bodyZ + 2.6, 7.2],
        ],
        C.body,
        { mode: 'sphere', dither: true },
      );
      // warts and glowing bile pustules
      const r = rng(77);
      for (let k = 0; k < 9; k++) {
        const f = -5 + r() * 8 + recoil;
        const rr = (r() - 0.5) * 10;
        if (c.P.depthOf(f, rr) < -4 && c.P.fy < 0) continue;
        const q = c.at(f, rr, bodyZ + 5 + r() * 2);
        if (k % 3 === 0) c.p.circle(q.x, q.y, 1).fill(C.lantern, { mode: 'sphere', glow: C.lantern[3]!, inner: false });
        else c.p.ellipse(q.x, q.y, 1.3 + r() * 0.6, 1).fill(C.body, { mode: 'sphere', light: -0.25, inner: false });
      }
      if (c.P.depthOf(1, 0) > 0.3) {
        const b = c.at(3 + recoil, 0, bodyZ - 1.4);
        c.p.ellipse(b.x, b.y + 1, 4.8, 2.6).fill(C.belly, { mode: 'sphere', inner: false, dither: true });
      }
    },
  });
  parts.push({
    d: c.dep(6, 0) + 0.2,
    draw: () => {
      const q = c.at(6 + recoil, 0, bodyZ - 1.5);
      c.p.ellipse(q.x, q.y, sac, sac * 0.95).fill(C.lantern, { mode: 'sphere', glow: C.lantern[3]!, light: 0.05 + pose.wind * 0.12, inner: false, dither: true });
      // veins on the sac
      c.p.line(q.x - sac * 0.5, q.y - sac * 0.2, q.x + sac * 0.2, q.y + sac * 0.6).fill(C.lantern, { mode: 'flat', tone: 0, inner: false, alpha: 160 });
      if (sac > 4.5) c.p.gpx(q.x - 1, q.y - 1, 0xffffff, C.lantern[3]!);
    },
  });
  parts.push({
    d: c.dep(5, 0) + 0.1,
    draw: () => {
      const hz = bodyZ + 4.5 + mouth * 1.5;
      const hq = c.at(4 + recoil, 0, hz);
      c.p.ellipse(hq.x, hq.y, 5.4, 3.7).fill(C.body, { mode: 'sphere', dither: true });
      if (c.P.depthOf(1, 0) > -0.2) {
        const m = c.at(7.6 + recoil, 0, hz - 1.4);
        if (mouth > 0.3) {
          c.p.ellipse(m.x, m.y + 0.5, 2.9, 1.2 + mouth * 1.5).fill(MATERIALS.bloodRed, { mode: 'flat', tone: 0, inner: false });
          c.p.capsule(m.x, m.y + 1, m.x + 0.5, m.y + 4, 0.7, 0.5).fill(C.lantern, { mode: 'emboss', glow: C.lantern[3]!, inner: false });
        } else {
          c.p.rect(m.x - 3, m.y, 6, 1).fill(C.body, { mode: 'flat', tone: 0, inner: false });
          c.p.px(m.x + 2, m.y + 1, C.lantern[2]!);
        }
      }
      for (const sd of [-1, 1]) {
        const e = c.at(3.6 + recoil, sd * 2.9, hz + 3);
        c.p.ellipse(e.x, e.y, 2.3, 2).fill(C.body, { mode: 'sphere' });
        if (c.P.depthOf(1, sd * 0.4) > -0.4) {
          const ei = c.at(4.4 + recoil, sd * 3.1, hz + 3.2);
          c.p.ellipse(ei.x, ei.y, 1.3, 1.2).fill(C.eye, { mode: 'sphere', inner: false, glow: C.eye[2]! });
          c.p.px(ei.x + c.P.fx * 0.6, ei.y, PALETTES.outline).px(ei.x + c.P.fx * 0.6, ei.y - 1, PALETTES.outline);
        }
      }
    },
  });
  return parts;
}

// ---------------------------------------------------------------- guardian: Bonewarden

function guardian(c: CC): Part[] {
  const { pose, P } = c;
  const C = PALETTES.guardian;
  const parts: Part[] = [];
  const s = Math.sin(pose.ph);
  const shieldF = 5.8 + pose.strike * 3 - pose.wind * 0.8;
  const shieldZ = 13 + pose.wind * 1;
  const swordHand: [number, number, number] =
    pose.wind > 0 ? [-1, 5.4, 18 + pose.wind * 6] : pose.strike > 0 ? [6 * pose.strike + 1, 3.5, 15 - pose.strike * 2] : [1.6, 5.4, 11 + (pose.moving ? s : 0)];
  const swordDir: [number, number, number] =
    pose.wind > 0 ? [-0.55, 0.2, 0.8] : pose.strike > 0.3 ? [0.85, -0.45, -0.25] : [0.55, 0.15, -0.8];
  // legs
  for (const sd of [-1, 1]) {
    parts.push({
      d: c.dep(0, sd * 2.4) - 0.5,
      draw: () => {
        const ph = pose.ph + (sd > 0 ? Math.PI : 0);
        const fF = (pose.moving ? Math.sin(ph) * 3.4 : 0) + (pose.strike > 0.5 && sd < 0 ? 2.4 : 0);
        const lift = pose.moving ? Math.max(0, Math.cos(ph)) * 2 : 0;
        const hip = c.at(0, sd * 2.2, 11);
        const knee = c.g(fF / 2 + 1, sd * 2.4, 5.6 + lift * 0.5);
        const ft = c.g(fF, sd * 2.5, lift);
        c.p.capsule(hip.x, hip.y, knee.x, knee.y, 1.2, 1).capsule(knee.x, knee.y, ft.x, ft.y, 1, 0.9).fill(C.bone, { mode: 'cyl' });
        const gb = { x: knee.x + (ft.x - knee.x) * 0.65, y: knee.y + (ft.y - knee.y) * 0.65 };
        c.p.capsule(knee.x, knee.y + 0.5, gb.x, gb.y, 1.9, 1.6).fill(C.shield, { mode: 'cyl', dither: true });
        c.p.ellipse(ft.x + P.fx, ft.y - 0.5, 2.2, 1.2).fill(C.iron, { mode: 'sphere' });
      },
    });
  }
  // sword arm (behind or in front depending on facing)
  const handD = c.dep(swordHand[0], swordHand[1]);
  parts.push({
    d: (c.dep(0, 4.6) + handD) / 2 + 0.25,
    draw: () => {
      const sh = c.at(0, 4.6, 20.5);
      const hd = c.at(swordHand[0], swordHand[1], swordHand[2]);
      const el = c.at((swordHand[0] + 0) / 2, (swordHand[1] + 4.6) / 2 + 0.8, (swordHand[2] + 20.5) / 2 - 1.5);
      c.p.capsule(sh.x, sh.y, el.x, el.y, 1, 0.9).capsule(el.x, el.y, hd.x, hd.y, 0.9, 0.8).fill(C.bone, { mode: 'cyl' });
      const b = c.at(swordHand[0] + swordDir[0] * 1.5, swordHand[1] + swordDir[1] * 1.5, swordHand[2] + swordDir[2] * 1.5);
      const t = c.at(swordHand[0] + swordDir[0] * 12, swordHand[1] + swordDir[1] * 12, swordHand[2] + swordDir[2] * 12);
      c.p.capsule(b.x, b.y, t.x, t.y, 1.5, 0.7).fill(C.shield, { mode: 'emboss', dither: true, light: 0.1 });
      c.p.line(b.x, b.y, t.x, t.y).fill(C.iron, { mode: 'flat', tone: 3, inner: false, alpha: 200 });
      const g0 = c.at(swordHand[0] + swordDir[1] * 2.2, swordHand[1] - swordDir[0] * 2.2, swordHand[2] + 0.8);
      const g1 = c.at(swordHand[0] - swordDir[1] * 2.2, swordHand[1] + swordDir[0] * 2.2, swordHand[2] + 0.8);
      c.p.capsule(g0.x, g0.y, g1.x, g1.y, 0.8, 0.8).fill(C.iron, { mode: 'cyl', inner: false });
      c.p.circle(hd.x, hd.y, 1.2).fill(C.bone, { mode: 'sphere' });
    },
  });
  // pelvis, spine, ribcage, pauldrons
  parts.push({
    d: 0,
    draw: () => {
      const pv = c.at(0, 0, 11.6);
      c.p.ellipse(pv.x, pv.y, 3.2, 1.8).fill(C.bone, { mode: 'sphere' });
      const sp0 = c.at(-0.4, 0, 12);
      const sp1 = c.at(-0.2, 0, 16);
      c.p.capsule(sp0.x, sp0.y, sp1.x, sp1.y, 1, 1).fill(C.bone, { mode: 'cyl' });
      const rc = c.at(0.3, 0, 18.3);
      const hw = P.halfWidth(4.6, 3.2);
      c.p.ellipse(rc.x, rc.y, hw, 3.6).fill(C.bone, { mode: 'sphere' });
      for (let k = 0; k < 3; k++) {
        const y = rc.y - 1.6 + k * 1.6;
        c.p.line(rc.x - hw + 1, y + 0.6, rc.x + hw - 1, y + 0.6);
      }
      c.p.fill(C.bone, { mode: 'flat', tone: 0, inner: false });
      // rusted gorget + pauldrons
      for (const sd of [-1, 1]) {
        const q = c.at(-0.2, sd * 4.6, 21);
        c.p.ellipse(q.x, q.y, 2.9, 2.4).fill(C.shield, { mode: 'sphere', dither: true });
        c.p.px(q.x - 1, q.y - 1, C.iron[4]!);
      }
      const gg = c.at(0, 0, 21.4);
      c.p.ellipse(gg.x, gg.y, P.halfWidth(2.8, 2.2), 1.4).fill(C.iron, { mode: 'emboss' });
    },
  });
  // skull with rusted helm and soul fire
  parts.push({
    d: c.dep(0.6, 0) + 0.6,
    draw: () => {
      const hz = 25.4 - pose.hurt + (pose.moving ? Math.abs(s) * 0.4 : 0);
      const hq = c.at(0.6, 0, hz);
      c.p.ellipse(hq.x, hq.y, 3.7, 3.5).fill(C.bone, { mode: 'sphere' });
      if (P.depthOf(1, 0) > -0.3) {
        const j = c.at(2.4, 0, hz - 3);
        c.p.rect(j.x - 2, j.y, 4, 1.6).fill(C.bone, { mode: 'emboss', light: -0.1 });
        c.p.px(j.x - 1, j.y, PALETTES.outline).px(j.x + 1, j.y, PALETTES.outline);
      }
      // helm dome
      c.p.ellipse(hq.x - P.fx * 0.4, hq.y - 2, 4, 2.4).minus().rect(hq.x - 6, hq.y - 1.4, 12, 6).fill(C.iron, { mode: 'sphere', dither: true });
      const crest0 = c.at(0.2, 0, hz + 3.2);
      const crest1 = c.at(-2.6, 0, hz + 5);
      c.p.capsule(crest0.x, crest0.y, crest1.x, crest1.y, 0.9, 0.6).fill(C.shield, { mode: 'emboss' });
      for (const th of [-0.55, 0.55]) {
        if (P.depthOf(Math.cos(th), Math.sin(th)) < 0.05) continue;
        const e = c.at(0.6 + Math.cos(th) * 3.1, Math.sin(th) * 3.1, hz + 0.2);
        c.p.px(e.x, e.y - 1, PALETTES.outline).px(e.x + 1, e.y - 1, PALETTES.outline);
        c.p.gpx(e.x, e.y, C.eye[3]!, C.eye[2]!).gpx(e.x + 1, e.y, C.eye[2]!, C.eye[2]!);
        // soul flame licking up out of the socket
        const fl = Math.sin(pose.ph * 2 + th * 3) * 0.6;
        const f0 = c.at(0.6 + Math.cos(th) * 3, Math.sin(th) * 3 + fl * 0.3, hz + 2);
        c.p.poly([f0.x - 0.8, f0.y + 0.5, f0.x + 0.8, f0.y + 0.5, f0.x + fl, f0.y - 3]).fill(C.eye, { mode: 'flat', tone: 2, glow: C.eye[2]!, inner: false, alpha: 220 });
      }
    },
  });
  // huge rusted tower shield, always on the FRONT
  parts.push({
    d: c.dep(shieldF, 0) + 0.4,
    draw: () => {
      const W = 7;
      const H0 = shieldZ - 11.5;
      const H1 = shieldZ + 10.5;
      const shape: [number, number][] = [[-W, H1 - 2.5], [-W + 2.5, H1], [W - 2.5, H1], [W, H1 - 2.5], [W, H0 + 1.5], [0, H0], [-W, H0 + 1.5]];
      const front = shape.map(([u, z]) => c.at(shieldF, u, z));
      const back = shape.map(([u, z]) => c.at(shieldF - 2.2, u, z));
      const flat = (a: Pt[]): number[] => a.flatMap((q) => [q.x, q.y]);
      const facing = P.depthOf(1, 0) > -0.1;
      c.p.poly(hull(back.concat(front))).fill(C.iron, { mode: 'emboss' });
      if (facing) {
        c.p.poly(flat(front)).fill(C.iron, { mode: 'emboss', light: 0.05 });
        const inner = shape.map(([u, z]) => c.at(shieldF + 0.05, u * 0.8, shieldZ + (z - shieldZ) * 0.86));
        c.p.poly(flat(inner)).fill(C.shield, { mode: 'emboss', dither: true });
        // iron straps + rivets + skull-and-cross boss
        const v0 = c.at(shieldF + 0.1, 0, H1 - 1);
        const v1 = c.at(shieldF + 0.1, 0, H0 + 1);
        const h0 = c.at(shieldF + 0.1, -W * 0.8, shieldZ + 2);
        const h1 = c.at(shieldF + 0.1, W * 0.8, shieldZ + 2);
        c.p.capsule(v0.x, v0.y, v1.x, v1.y, 1, 1).capsule(h0.x, h0.y, h1.x, h1.y, 1, 1).fill(C.iron, { mode: 'emboss', inner: false });
        const boss = c.at(shieldF + 0.2, 0, shieldZ + 2);
        c.p.circle(boss.x, boss.y, 2.4).fill(C.bone, { mode: 'sphere', inner: false });
        c.p.px(boss.x - 1, boss.y, PALETTES.outline).px(boss.x + 1, boss.y, PALETTES.outline);
        for (const u of [-W + 1.5, W - 1.5]) {
          for (const z of [H1 - 3, H0 + 3.5]) {
            const rv = c.at(shieldF + 0.1, u, z);
            c.p.px(rv.x, rv.y, C.iron[4]!);
          }
        }
        const dn = c.at(shieldF + 0.1, -3, shieldZ - 4);
        c.p.px(dn.x, dn.y, C.shield[0]!).px(dn.x + 1, dn.y + 1, C.shield[0]!).px(dn.x + 1, dn.y, C.shield[4]!);
      } else {
        c.p.poly(flat(back)).fill(MATERIALS.darkWood, { mode: 'emboss', dither: true, inner: false });
        const h0 = c.at(shieldF - 2.3, -W * 0.8, shieldZ + 4);
        const h1 = c.at(shieldF - 2.3, W * 0.8, shieldZ + 4);
        c.p.capsule(h0.x, h0.y, h1.x, h1.y, 0.9, 0.9).fill(C.iron, { mode: 'emboss', inner: false });
      }
    },
  });
  return parts;
}

// ---------------------------------------------------------------- hexer: Hex Cultist

function hexer(c: CC): Part[] {
  const { pose } = c;
  const C = PALETTES.hexer;
  const parts: Part[] = [];
  const hover = 5 + Math.sin(pose.ph) * 1.2 + pose.wind * 1.5;
  const sway = Math.sin(pose.ph + 1) * 1.2 - pose.lean * 0.3;
  const raise = pose.wind;
  const thrust = pose.strike;
  // violet under-glow wisps
  parts.push({
    d: -1,
    draw: () => {
      for (let k = 0; k < 3; k++) {
        const a = c.at(-0.4, (k - 1) * 3, hover + 2.5);
        const b = c.at(-1 - sway * (0.6 + k * 0.3), (k - 1) * 3.4 + sway * 0.4, hover - 3.5 - (k === 1 ? 1.5 : 0) + Math.sin(pose.ph * 2 + k) * 0.7);
        c.p.capsule(a.x, a.y, b.x, b.y, 1.4 - k * 0.2, 0.4);
      }
      c.p.fill(C.glow, { mode: 'emboss', glow: C.glow[3]!, alpha: 190, inner: false });
    },
  });
  // tattered robe
  parts.push({
    d: 0,
    draw: () => {
      const pts: Pt[] = [];
      const topZ = hover + 15;
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        pts.push(c.at(Math.cos(a) * 2.6, Math.sin(a) * 3.8, topZ));
        pts.push(c.at(Math.cos(a) * 6 - sway * 0.3, Math.sin(a) * 8.2, hover + 2.5));
      }
      c.p.poly(hull(pts)).fill(C.robe, { mode: 'cyl', dither: true, light: 0.05 });
      // ragged hem points
      const P = c.P;
      const thc = Math.atan2(7.6 * P.ry, 5.6 * P.fy);
      for (let k = 0; k <= 8; k++) {
        const a = thc - Math.PI / 2 + (Math.PI * k) / 8;
        const q0 = c.at(Math.cos(a) * 5.4 - sway * 0.3, Math.sin(a) * 7.3, hover + 3);
        const q1 = c.at(Math.cos(a + 0.18) * 5.4 - sway * 0.3, Math.sin(a + 0.18) * 7.3, hover + 3);
        const tip = c.at(Math.cos(a + 0.09) * 5.6 - sway * 0.6, Math.sin(a + 0.09) * 7.5, hover + 0.4 - (k % 3) * 0.8);
        c.p.poly([q0.x, q0.y, q1.x, q1.y, tip.x, tip.y]);
      }
      c.p.fill(C.robe, { mode: 'emboss', light: -0.15 });
      // rope belt
      const b0 = c.at(3.6, -4.6, hover + 9);
      const b1 = c.at(3.6, 4.6, hover + 9);
      if (P.depthOf(1, 0) > -0.3) c.p.capsule(b0.x, b0.y, b1.x, b1.y, 0.7, 0.7).fill(MATERIALS.darkWood, { mode: 'cyl', light: 0.2, inner: false });
    },
  });
  // bony arms
  for (const sd of [-1, 1]) {
    parts.push({
      d: c.dep(1, sd * 5) + 0.2,
      draw: () => {
        const sh = c.at(0.5, sd * 4.6, hover + 13.5);
        const hand = c.at(2.6 + thrust * 4 + raise * 0.5, sd * (5.2 - thrust * 2.2 - raise * 1.2), hover + 9 + raise * 7 + thrust * 2);
        limb(c, sh, hand, 1.6, 1.3, C.robe, { mode: 'emboss', dither: true });
        c.p.circle(hand.x, hand.y, 1.1).fill(C.skin, { mode: 'sphere', inner: false });
      },
    });
  }
  // glowing violet sigil floating before the chest
  parts.push({
    d: c.dep(4, 0) + 0.7,
    draw: () => {
      const q = c.at(3.6 + thrust * 4, 0, hover + 10 + raise * 6 + thrust * 1.5);
      const rr = 2.4 + raise * 2.4 + thrust * 1.6;
      c.p.circle(q.x, q.y, rr + 0.9).minus().circle(q.x, q.y, rr).fill(C.glow, { mode: 'flat', tone: 3, glow: C.glow[2]!, inner: false, alpha: 235 });
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 - Math.PI / 2 + pose.frame * 0.4;
        const b2 = a + (Math.PI * 2) / 3;
        c.p.line(q.x + Math.cos(a) * rr * 0.9, q.y + Math.sin(a) * rr * 0.9, q.x + Math.cos(b2) * rr * 0.9, q.y + Math.sin(b2) * rr * 0.9);
      }
      c.p.fill(C.glow, { mode: 'flat', tone: 2, glow: C.glow[2]!, inner: false, alpha: 210 });
      c.p.gpx(q.x, q.y, 0xffffff, C.glow[3]!);
    },
  });
  // peaked hood + candle crown
  parts.push({
    d: c.dep(0.5, 0) + 0.4,
    draw: () => {
      const hz = hover + 18;
      const P = c.P;
      const candles: { a: number; d: number }[] = [];
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + 0.3;
        candles.push({ a, d: P.depthOf(Math.cos(a), Math.sin(a)) });
      }
      const drawCandle = (a: number, k: number): void => {
        const base = c.at(0 + Math.cos(a) * 3.4, Math.sin(a) * 3.4, hz + 3.4);
        const h = 1.2 + (k % 2) * 0.8;
        c.p.capsule(base.x, base.y, base.x, base.y - h, 0.6, 0.6).fill(C.wax, { mode: 'cyl', inner: false });
        const fl = Math.sin(pose.ph * 3 + k) > 0 ? 0 : 1;
        c.p.gpx(base.x + fl * 0.4, base.y - h - 1.2, C.flame[3]!, C.flame[2]!).gpx(base.x, base.y - h - 2.2, C.flame[2]!, C.flame[2]!);
      };
      candles.forEach((cd, k) => {
        if (cd.d < 0) drawCandle(cd.a, k);
      });
      const shell = c.at(0, 0, hz);
      const peak = c.at(-1.6 - sway * 0.3, 0, hz + 9);
      c.p.ellipse(shell.x, shell.y, 5.3, 4.9)
        .poly([shell.x - 4, shell.y - 1, shell.x + 4, shell.y - 1, peak.x, peak.y])
        .fill(C.robe, { mode: 'emboss', dither: true, light: 0.28 });
      if (P.depthOf(1, 0) > -0.3) {
        const fd = P.depthOf(1, 0);
        const f = c.at(2.8, 0, hz - 0.6);
        const rx = 1.2 + 1.8 * Math.max(0, fd);
        c.p.ellipse(f.x, f.y, rx + 0.9, 3.6).fill(C.glow, { mode: 'flat', tone: 1, inner: false });
        c.p.ellipse(f.x, f.y + 0.2, rx, 2.8).fill([0x050206, 0x0a040c, 0x120818, 0x1a0c22], { mode: 'flat', tone: 1, inner: false });
        for (const th of [-0.5, 0.5]) {
          if (P.depthOf(Math.cos(th), Math.sin(th)) < 0.05) continue;
          const e = c.at(Math.cos(th) * 3.9, Math.sin(th) * 3.9, hz - 0.4);
          c.p.gpx(e.x, e.y, C.eye[3]!, C.eye[2]!);
        }
      }
      candles.forEach((cd, k) => {
        if (cd.d >= 0) drawCandle(cd.a, k);
      });
    },
  });
  return parts;
}

// ---------------------------------------------------------------- broodcaller: Brood Sac

function broodcaller(c: CC): Part[] {
  const { pose } = c;
  const C = PALETTES.broodcaller;
  const parts: Part[] = [];
  const bloom = Math.max(pose.wind, pose.strike * 1.1);
  const pulse = pose.moving ? 0 : Math.sin(pose.ph * 2) * 0.05;
  const swell = 1 + pulse + pose.wind * 0.12 - pose.strike * 0.08;
  const bodyZ = 12 + (pose.moving ? Math.abs(Math.sin(pose.ph)) * 1 : 0);
  const legAngles = [0.55, 1.45, 2.45];
  for (const sd of [-1, 1]) {
    legAngles.forEach((la, k) => {
      const a = sd * la;
      const ph = pose.ph + k * 2.1 + (sd > 0 ? Math.PI : 0);
      parts.push({
        d: c.dep(Math.cos(a) * 7, Math.sin(a) * 7) - 0.5,
        draw: () => {
          const reach = 14.5 + (pose.moving ? Math.sin(ph) * 1.8 : 0);
          const lift = pose.moving ? Math.max(0, Math.cos(ph)) * 2.2 : 0;
          const hip = c.at(Math.cos(a) * 5, Math.sin(a) * 5, bodyZ + 2);
          const knee = c.g(Math.cos(a) * 9.5, Math.sin(a) * 9.5, bodyZ + 9 + lift);
          const ft = c.g(Math.cos(a) * reach, Math.sin(a) * reach, lift);
          limb(c, hip, knee, 1.3, 1, C.leg, { mode: 'emboss', light: 0.15 });
          limb(c, knee, ft, 1, 0.45, C.leg, { mode: 'emboss', light: 0.15 });
        },
      });
    });
  }
  parts.push({
    d: 0,
    draw: () => {
      const q = c.at(0, 0, bodyZ + 3);
      const rx = 8.4 * swell;
      const ry = 9 * swell;
      c.p.ellipse(q.x, q.y, rx, ry).fill(C.flesh, { mode: 'sphere', dither: true });
      // veins
      const r = rng(31);
      for (let k = 0; k < 4; k++) {
        let x = q.x + (r() - 0.5) * rx;
        let y = q.y - ry * 0.8;
        for (let s = 0; s < 9; s++) {
          const nx = x + (r() - 0.5) * 2.4;
          const ny = y + ry * 0.2;
          c.p.line(x, y, nx, ny);
          x = nx;
          y = ny;
        }
      }
      c.p.fill(C.flesh, { mode: 'flat', tone: 0, inner: false, alpha: 170 });
      // glistening highlight
      c.p.px(q.x - rx * 0.45, q.y - ry * 0.5, 0xffe8e8).px(q.x - rx * 0.45 + 1, q.y - ry * 0.5, C.flesh[4]!).px(q.x - rx * 0.45, q.y - ry * 0.5 + 1, C.flesh[4]!);
      // glowing eggs under the membrane
      const eggs: [number, number, number][] = [];
      for (let k = 0; k < 7; k++) {
        const a = r() * Math.PI * 2;
        eggs.push([Math.cos(a) * 6.4 * swell, Math.sin(a) * 6.4 * swell, bodyZ + 1 + r() * 6]);
      }
      eggs.sort((A, B) => c.P.depthOf(A[0], A[1]) - c.P.depthOf(B[0], B[1]));
      for (const [ef, er, ez] of eggs) {
        if (c.P.depthOf(ef, er) < -2.5) continue;
        const e = c.at(ef, er, ez);
        const burst = pose.strike > 0.6;
        c.p.ellipse(e.x, e.y, 2 + bloom * 0.5, 1.8 + bloom * 0.5).fill(C.egg, { mode: 'sphere', glow: C.egg[3]!, light: -0.2 + bloom * 0.35, inner: false });
        c.p.px(e.x, e.y, burst ? C.egg[4]! : C.egg[1]!);
      }
      // top orifice
      const top = c.at(0, 0, bodyZ + 3 + 9 * swell * 0.9);
      c.p.ellipse(top.x, top.y + 1, 2.2, 1.2).fill(C.flesh, { mode: 'flat', tone: 0, inner: false });
      if (bloom > 0.3) c.p.gpx(top.x, top.y + 1, C.egg[3]!, C.egg[2]!);
    },
  });
  return parts;
}

// ---------------------------------------------------------------- mite: Carrion Mite (maggot crawler)

function mite(c: CC): Part[] {
  const { pose } = c;
  const C = PALETTES.mite;
  const parts: Part[] = [];
  const lunge = pose.strike * 2.5 - pose.wind * 1;
  const rear = pose.wind * 2.2;
  const segs: [number, number][] = [
    [2.6, 2.4],
    [0.6, 2.7],
    [-1.4, 2.6],
    [-3.3, 2.2],
    [-4.9, 1.6],
  ];
  // tiny legs
  parts.push({
    d: -0.5,
    draw: () => {
      for (let k = 0; k < 3; k++) {
        for (const sd of [-1, 1]) {
          const f = 2 - k * 2 + lunge;
          const ph = pose.ph + k * 2 + (sd > 0 ? Math.PI : 0);
          const a = c.at(f, sd * 1.6, 1.8);
          const b = c.g(f + (pose.moving ? Math.sin(ph) * 1.2 : 0), sd * 3.6, 0);
          c.p.line(a.x, a.y, b.x, b.y);
        }
      }
      c.p.fill(C.head, { mode: 'flat', tone: 2, inner: false });
    },
  });
  const order = segs.map((sg, k) => ({ sg, k, d: c.dep(sg[0], 0) })).sort((A, B) => A.d - B.d || B.k - A.k);
  parts.push({
    d: 0,
    draw: () => {
      for (const { sg, k } of order) {
        const wig = pose.moving ? Math.sin(pose.ph + k * 1.1) * 0.9 : Math.sin(pose.ph + k) * 0.3;
        const z = 2.6 + (k === 0 ? rear : rear * (1 - k / 4) * 0.5) + (pose.moving ? Math.abs(Math.sin(pose.ph + k)) * 0.5 : 0);
        const q = c.at(sg[0] + lunge * (1 - k / 5), wig, z);
        c.p.ellipse(q.x, q.y, sg[1], sg[1] * 0.92).fill(C.body, { mode: 'sphere', dither: k % 2 === 1 });
      }
    },
  });
  parts.push({
    d: c.dep(4.6, 0) + 0.2,
    draw: () => {
      const hf = 4.4 + lunge;
      const hz = 2.8 + rear;
      const h = c.at(hf, 0, hz);
      for (const sd of [-1, 1]) {
        const a = c.at(hf + 1.2, sd * 0.9, hz - 0.5);
        const t = c.at(hf + 2.8 + pose.strike, sd * (pose.strike > 0.5 ? 0.3 : 1.5), hz - 0.8);
        c.p.line(a.x, a.y, t.x, t.y);
      }
      c.p.fill(PALETTES.mite.body, { mode: 'flat', tone: 3, inner: false });
      c.p.ellipse(h.x, h.y, 2, 1.8).fill(C.head, { mode: 'sphere', light: 0.2 });
      eye(c, hf, hz + 0.3, 1.6, 0.6, 0, C.eye[3]!, C.eye[2]!);
      eye(c, hf, hz + 0.3, 1.6, -0.6, 0, C.eye[3]!, C.eye[2]!);
    },
  });
  return parts;
}

// ---------------------------------------------------------------- spiritwolf: Warden companion (spectral wolf)

function spiritwolf(c: CC): Part[] {
  const { pose, P } = c;
  const C = PALETTES.spiritwolf;
  const parts: Part[] = [];
  const s = Math.sin(pose.ph);
  const rock = pose.moving ? s * 0.9 : 0;
  const stretch = 1 + pose.strike * 0.22 - pose.wind * 0.08;
  const open = Math.max(pose.wind * 0.7, pose.strike);
  const headF = 9 * stretch;
  const headZ = 12.4 + rock * 0.5 + pose.strike * 0.6 - pose.wind * 1.4 - pose.hurt * 1.5;
  // gallop: fore and hind pairs move together, offset by half a cycle
  const legs: [number, number, number][] = [
    [4.4 * stretch, -2.4, 0],
    [4.4 * stretch, 2.4, 0.35],
    [-4.8 * stretch, -2.4, Math.PI],
    [-4.8 * stretch, 2.4, Math.PI + 0.35],
  ];
  for (const [lf, lr, lp] of legs) {
    const ph = pose.ph + lp;
    const swing = pose.moving ? Math.sin(ph) * 4.4 : 0;
    const footF = lf + swing + (pose.strike > 0.5 ? (lf > 0 ? 3.4 : -1.5) : 0);
    const lift = pose.moving ? Math.max(0, Math.cos(ph)) * 2.6 : pose.strike > 0.5 && lf > 0 ? 2.4 : 0;
    parts.push({
      d: c.dep(lf, lr) - 0.4,
      draw: () => {
        const hip = c.at(lf, lr * 0.75, 9 + (lf > 0 ? rock : -rock));
        const knee = c.g((lf + footF) / 2 + (lf > 0 ? 0.8 : -1.6), lr, 4.4 + lift * 0.5);
        const ft = c.g(footF, lr, lift);
        limb(c, hip, knee, 1.8, 1.1, C.body, { mode: 'emboss', dither: true });
        limb(c, knee, ft, 1.1, 0.9, C.body, { mode: 'emboss' });
        c.p.ellipse(ft.x + P.fx * 0.7, ft.y - 0.3, 1.5, 0.9).fill(C.dark, { mode: 'sphere' });
      },
    });
  }
  // bushy tail streaming into wisps
  const tailUp = pose.moving ? 0.5 + s * 0.6 : 1 + Math.sin(pose.ph) * 0.4;
  parts.push({
    d: c.dep(-10, 0),
    draw: () => {
      const a = c.at(-7.6 * stretch, 0, 11);
      const m = c.at(-11 * stretch, 0, 12 + tailUp * 1.5);
      const b = c.at(-14.5 * stretch, 0, 13.5 + tailUp * 3 - pose.hurt * 4);
      c.p.capsule(a.x, a.y, m.x, m.y, 1.6, 2.4).capsule(m.x, m.y, b.x, b.y, 2.4, 1).fill(C.body, { mode: 'emboss', dither: true, glow: C.body[3]! });
    },
  });
  // lean body with a deep chest and a fur ruff
  parts.push({
    d: 0,
    draw: () => {
      blob(
        c,
        [
          [4 * stretch, 0, 10.4 + rock, 4.7],
          [-0.6, 0, 9.8, 3.3],
          [-5 * stretch, 0, 10 - rock, 3.7],
        ],
        C.body,
        { mode: 'sphere', dither: true, light: -0.12 },
      );
      // ruff spikes around the neck
      const pts: { x: number; y: number }[] = [];
      const q = c.at(5.6 * stretch, 0, 12 + rock);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const rr = k % 2 ? 5.2 : 3.8;
        pts.push({ x: q.x + Math.cos(a) * rr, y: q.y + Math.sin(a) * rr * 0.85 });
      }
      c.p.poly(pts.flatMap((v) => [v.x, v.y])).fill(C.body, { mode: 'sphere', dither: true, light: 0.15 });
      // spine stripe of brighter spirit-fur
      for (let k = 0; k < 6; k++) {
        const f = 5 * stretch - k * 2;
        const sq = c.at(f, 0, 14.2 + (f > 0 ? rock : -rock) * 0.5 - (k > 2 ? 0.6 : 0));
        c.p.px(sq.x, sq.y, C.body[4]!);
      }
    },
  });
  // head: long snout, pointed ears, glowing eyes
  parts.push({
    d: c.dep(headF, 0) + 0.3,
    draw: () => {
      for (const sd of [-1, 1]) {
        const e0 = c.at(headF - 1, sd * 1.4, headZ + 2.2);
        const e1 = c.at(headF - 2.6, sd * 2.4, headZ + 1.6);
        const et = c.at(headF - 2.6, sd * 2.2, headZ + 6.2 - pose.hurt * 2);
        tri(c, e0, et, e1, C.body, { mode: 'emboss', light: 0.1 });
      }
      const jawA = c.at(headF + 1, 0, headZ - 1.6);
      const jawB = c.at(headF + 5, 0, headZ - 2.4 - open * 2.6);
      limb(c, jawA, jawB, 1.5, 1, C.dark, { mode: 'emboss' });
      if (open > 0.2) {
        const m = c.at(headF + 3.6, 0, headZ - 2 - open * 1.1);
        c.p.ellipse(m.x, m.y, 1.4 + open, 0.9 + open * 0.6).fill(C.dark, { mode: 'flat', tone: 0, inner: false });
      }
      blob(
        c,
        [
          [headF, 0, headZ, 3.5],
          [headF + 4.6, 0, headZ - 1.1, 1.8],
        ],
        C.body,
        { mode: 'sphere', dither: true, light: 0.12 },
      );
      const nose = c.at(headF + 6.2, 0, headZ - 0.9);
      if (P.depthOf(1, 0) > -0.5) c.p.px(nose.x, nose.y, C.dark[0]!);
      if (open > 0.2 && P.depthOf(1, 0) > -0.3) {
        const t1 = c.at(headF + 5, 0.8, headZ - 2.1);
        const t2 = c.at(headF + 5, -0.8, headZ - 2.1);
        c.p.px(t1.x, t1.y, 0xffffff).px(t2.x, t2.y, 0xffffff);
      }
      eye(c, headF + 0.8, headZ + 0.7, 3.2, 0.6, 0, 0xffffff, C.body[3]!, 2);
      eye(c, headF + 0.8, headZ + 0.7, 3.2, -0.6, 0, 0xffffff, C.body[3]!, 2);
    },
  });
  return parts;
}

/** Spectral finish: translucent body, soft outer glow and a few drifting motes. */
function ghostify(buf: PixelBuffer, frame: number, seed: number, ground: number): void {
  const C = PALETTES.spiritwolf;
  const src = buf.clone();
  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      const a = src.alpha(x, y);
      if (a > 0) {
        buf.set(x, y, src.get(x, y) & 0xffffff, Math.round(a * 0.84));
        continue;
      }
      const near = src.alpha(x - 1, y) > 0 || src.alpha(x + 1, y) > 0 || src.alpha(x, y - 1) > 0 || src.alpha(x, y + 1) > 0;
      if (near) buf.blend(x, y, C.body[3]!, 70);
    }
  }
  const r = rng(seed ^ 0x77);
  const big = buf.w > 48;
  for (let k = 0; k < (big ? 7 : 4); k++) {
    const x = Math.round(buf.w / 2 + (r() - 0.5) * buf.w * 0.62);
    const y = Math.round(ground - 10 - ((frame * 2 + k * 6 + r() * 4) % (big ? 34 : 20)));
    buf.blend(x, y, k % 2 ? C.body[4]! : C.body[3]!, 200);
  }
}

// ---------------------------------------------------------------- spirit bear / spirit elk (Warden companions, generic spectral quadruped)

interface BeastCfg {
  /** hip / shoulder height (z) */
  hipZ: number;
  /** half body length (shoulder at +len, haunch at -len) */
  len: number;
  chestR: number;
  hipR: number;
  legR: [number, number];
  /** stride amplitude */
  stride: number;
  /** shoulder hump height (bear) */
  hump: number;
  /** neck base -> head center offsets */
  headF: number;
  headZ: number;
  headR: number;
  snout: number;
  snoutR: number;
  ears: 'round' | 'point';
  antlers: boolean;
  tail: number;
  /** attack style: 'swipe' raises a forepaw, 'gore' lowers the head */
  attack: 'swipe' | 'gore';
}

const BEAR: BeastCfg = { hipZ: 15, len: 11, chestR: 9.5, hipR: 8.5, legR: [3.4, 2.6], stride: 5, hump: 3.5, headF: 9, headZ: 4, headR: 6, snout: 5, snoutR: 2.8, ears: 'round', antlers: false, tail: 2, attack: 'swipe' };
const ELK: BeastCfg = { hipZ: 21, len: 10, chestR: 6.6, hipR: 6, legR: [2.2, 1.2], stride: 6, hump: 1, headF: 9, headZ: 13, headR: 3.8, snout: 6, snoutR: 2, ears: 'point', antlers: true, tail: 1.5, attack: 'gore' };

function spiritBeast(c: CC, B: BeastCfg): Part[] {
  const { pose, P } = c;
  const C = PALETTES.spiritwolf;
  const parts: Part[] = [];
  const s = Math.sin(pose.ph);
  const rock = pose.moving ? s * 1.2 : 0;
  const reach = 1 + pose.strike * 0.15 - pose.wind * 0.06;
  const gore = B.attack === 'gore' ? Math.max(pose.strike, pose.wind * 0.6) : 0;
  const swipe = B.attack === 'swipe' ? pose.strike : 0;
  const L = B.len * reach;
  const neckF = L + B.chestR * 0.4;
  const hf = neckF + B.headF - gore * 2;
  const hz = B.hipZ + B.headZ + rock * 0.6 - gore * (B.headZ + 6) - pose.hurt * 3;
  const open = Math.max(pose.wind * 0.6, pose.strike);
  const legs: [number, number, number][] = [
    [L, -B.chestR * 0.45, 0],
    [L, B.chestR * 0.45, 0.4],
    [-L, -B.hipR * 0.45, Math.PI],
    [-L, B.hipR * 0.45, Math.PI + 0.4],
  ];
  for (const [lf, lr, lp] of legs) {
    const ph = pose.ph + lp;
    const fore = lf > 0;
    const raised = swipe > 0.4 && fore && lr > 0;
    const footF = lf + (pose.moving ? Math.sin(ph) * B.stride : 0) + (raised ? 6 : 0) + (gore > 0.5 && !fore ? -2 : 0);
    const lift = pose.moving ? Math.max(0, Math.cos(ph)) * B.stride * 0.6 : raised ? B.hipZ * 0.7 : 0;
    parts.push({
      d: c.dep(lf, lr) - 0.4,
      draw: () => {
        const hip = c.at(lf, lr * 0.8, B.hipZ + (fore ? rock : -rock));
        const knee = c.g((lf + footF) / 2 + (fore ? 0.6 : -1.4), lr, B.hipZ * 0.45 + lift * 0.6);
        const ft = c.g(footF, lr, lift);
        limb(c, hip, knee, B.legR[0], B.legR[1], C.body, { mode: 'emboss', dither: true, light: -0.1 });
        limb(c, knee, ft, B.legR[1], B.legR[1] * 0.8, C.dark, { mode: 'emboss' });
        if (B.antlers) c.p.ellipse(ft.x + P.fx * 0.5, ft.y - 0.3, 1.3, 0.8).fill(C.dark, { mode: 'sphere' });
        else c.p.ellipse(ft.x + P.fx * 1, ft.y - 0.6, B.legR[1] + 0.6, 1.4).fill(C.dark, { mode: 'sphere' });
      },
    });
  }
  // tail
  parts.push({
    d: c.dep(-L - B.hipR, 0),
    draw: () => {
      const a = c.at(-L - B.hipR * 0.7, 0, B.hipZ + 2);
      const b = c.at(-L - B.hipR * 0.7 - B.tail * 1.6, 0, B.hipZ + 2 + B.tail + (pose.moving ? s : 0));
      c.p.capsule(a.x, a.y, b.x, b.y, B.tail, B.tail * 0.7).fill(C.body, { mode: 'emboss', glow: C.body[3]! });
    },
  });
  // body: chest, belly, haunch (+ shoulder hump), spirit-fur stripe
  parts.push({
    d: 0,
    draw: () => {
      const segs: [number, number, number, number][] = [
        [L, 0, B.hipZ + 2 + rock, B.chestR],
        [0, 0, B.hipZ + 1, B.chestR * 0.82],
        [-L, 0, B.hipZ + 1.5 - rock, B.hipR],
      ];
      if (B.hump > 0) segs.push([L * 0.7, 0, B.hipZ + 2 + B.hump + rock, B.chestR * 0.75]);
      blob(c, segs, C.body, { mode: 'sphere', dither: true, light: -0.12 });
      for (let k = 0; k < 7; k++) {
        const f = L - (k / 6) * 2 * L;
        const q = c.at(f, 0, B.hipZ + 2 + B.chestR * 0.85 + (f > 0 ? B.hump * 0.8 : 0) + (f > 0 ? rock : -rock) * 0.5);
        c.p.px(q.x, q.y, C.body[4]!);
      }
    },
  });
  // neck + head
  parts.push({
    d: c.dep(hf, 0) + 0.3,
    draw: () => {
      const n0 = c.at(neckF - 1, 0, B.hipZ + 3 + rock);
      const n1 = c.at(hf - B.headR * 0.5, 0, hz);
      c.p.capsule(n0.x, n0.y, n1.x, n1.y, B.chestR * 0.55, B.headR * 0.75).fill(C.body, { mode: 'emboss', dither: true, light: -0.05 });
      // ears / antlers (behind the skull)
      if (B.antlers) {
        for (const sd of [-1, 1]) {
          const base = c.at(hf - 1.4, sd * 1.6, hz + B.headR * 0.8);
          const mid = c.at(hf - 4, sd * 6, hz + B.headR + 6 - gore * 3);
          const tip = c.at(hf - 7, sd * 8.5, hz + B.headR + 13 - gore * 6);
          c.p.capsule(base.x, base.y, mid.x, mid.y, 1, 0.8).capsule(mid.x, mid.y, tip.x, tip.y, 0.8, 0.5);
          for (const [tf, tr, tz] of [[0.3, 0.55, 0.6], [0.65, 0.8, 0.85]] as const) {
            const o = c.at(hf - 4 - tf * 3, sd * (6 * tr + 1), hz + B.headR + 6 + tz * 7 - gore * 4);
            const t2 = c.at(hf - 1 - tf * 3, sd * (6 * tr + 2), hz + B.headR + 10 + tz * 6 - gore * 5);
            c.p.capsule(o.x, o.y, t2.x, t2.y, 0.6, 0.4);
          }
        }
        c.p.fill(C.body, { mode: 'emboss', light: 0.25, glow: C.body[4]! });
      } else {
        for (const sd of [-1, 1]) {
          const e = c.at(hf - 1.5, sd * B.headR * 0.65, hz + B.headR * 0.8);
          c.p.circle(e.x, e.y, B.headR * 0.32);
        }
        c.p.fill(C.body, { mode: 'sphere', light: -0.05 });
      }
      if (B.ears === 'point') {
        for (const sd of [-1, 1]) {
          const e0 = c.at(hf - 0.8, sd * 1.2, hz + B.headR * 0.6);
          const e1 = c.at(hf - 1.8, sd * 3.4, hz + B.headR * 0.9);
          const et = c.at(hf - 1, sd * 4.2, hz + B.headR * 0.3);
          tri(c, e0, et, e1, C.body, { mode: 'emboss' });
        }
      }
      // jaw
      const jawA = c.at(hf + B.headR * 0.3, 0, hz - B.headR * 0.45);
      const jawB = c.at(hf + B.headR * 0.4 + B.snout, 0, hz - B.headR * 0.6 - open * 2.6);
      limb(c, jawA, jawB, B.snoutR * 0.7, B.snoutR * 0.5, C.dark, { mode: 'emboss' });
      blob(
        c,
        [
          [hf, 0, hz, B.headR],
          [hf + B.headR * 0.5 + B.snout * 0.7, 0, hz - B.headR * 0.25, B.snoutR],
        ],
        C.body,
        { mode: 'sphere', dither: true, light: 0.02 },
      );
      const nose = c.at(hf + B.headR * 0.5 + B.snout * 0.7 + B.snoutR * 0.8, 0, hz - B.headR * 0.15);
      if (P.depthOf(1, 0) > -0.5) c.p.px(nose.x, nose.y, C.dark[0]!).px(nose.x + (P.fx > 0 ? -1 : 1), nose.y, C.dark[1]!);
      eye(c, hf + 0.6, hz + B.headR * 0.2, B.headR * 0.9, 0.62, 0, 0xffffff, C.body[3]!, B.headR > 5 ? 2 : 1);
      eye(c, hf + 0.6, hz + B.headR * 0.2, B.headR * 0.9, -0.62, 0, 0xffffff, C.body[3]!, B.headR > 5 ? 2 : 1);
    },
  });
  return parts;
}

function spiritbear(c: CC): Part[] {
  return spiritBeast(c, BEAR);
}

function spiritelk(c: CC): Part[] {
  return spiritBeast(c, ELK);
}

// ---------------------------------------------------------------- shared bits for the Gaoler / Rime Wraith / Gloom Shade / Web Weaver

const ramp = (...c: number[]): Ramp => Object.freeze(c);

/** Iron chain: alternating links between two screen points (each link shaded on its own). */
function chainLinks(c: CC, a: Pt, b: Pt, rmp: Ramp, sag = 0): void {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(2, Math.round(L / 2));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t + Math.sin(t * Math.PI) * sag;
    if (k % 2) c.p.ellipse(x, y, 1.35, 0.85);
    else c.p.ellipse(x, y, 0.85, 1.35);
    c.p.fill(rmp, { mode: 'sphere', light: 0.18, inner: false });
  }
}

/** A cruel meat hook: shank up from q, curved barb below (dir = screen x direction of the point). */
function hookAt(c: CC, q: { x: number; y: number }, dir: number, rmp: Ramp): void {
  const d = dir >= 0 ? 1 : -1;
  c.p.capsule(q.x, q.y - 2.5, q.x, q.y + 1.5, 0.9, 0.9);
  const pts: [number, number][] = [];
  for (let k = 0; k <= 6; k++) {
    const a = Math.PI * (k / 6);
    pts.push([q.x + d * 2.2 - d * 2.2 * Math.cos(a), q.y + 1.5 + Math.sin(a) * 2.6]);
  }
  for (let k = 0; k + 1 < pts.length; k++) c.p.capsule(pts[k]![0], pts[k]![1], pts[k + 1]![0], pts[k + 1]![1], 0.85, 0.75);
  const tip = pts[pts.length - 1]!;
  c.p.poly([tip[0] - 0.8, tip[1], tip[0] + 0.8, tip[1], tip[0] + d * 0.3, tip[1] - 2.4]);
  c.p.fill(rmp, { mode: 'emboss', light: 0.15 });
  c.p.px(q.x - d * 0.5, q.y - 2, rmp[4] ?? rmp[3]!);
}

// ---------------------------------------------------------------- gaoler: Gaoler (hulking jailer, iron mask, chain hook)

const GAOLER = {
  skin: ramp(0x2a1e20, 0x5a4244, 0x8a6c68, 0xb4968c, 0xd6bcae),
  leather: ramp(0x0c0705, 0x1c110b, 0x301e14, 0x4a3020, 0x664430),
  apron: ramp(0x100906, 0x22150d, 0x382416, 0x523622, 0x6e4c32),
  iron: MATERIALS.iron,
  rust: MATERIALS.rust,
  eye: MATERIALS.ember,
};

function gaoler(c: CC): Part[] {
  const { pose, P } = c;
  const C = GAOLER;
  const parts: Part[] = [];
  const s = Math.sin(pose.ph);
  const heave = pose.moving ? Math.abs(s) * 0.8 : Math.sin(pose.ph) * 0.45;
  const w = pose.wind;
  const st = pose.strike;
  const facing = P.depthOf(1, 0);
  // stout legs in leather breeches, iron-shod boots
  for (const sd of [-1, 1]) {
    parts.push({
      d: c.dep(0, sd * 4.4) - 0.6,
      draw: () => {
        const ph = pose.ph + (sd > 0 ? Math.PI : 0);
        const fF = (pose.moving ? Math.sin(ph) * 4.2 : 0) + (st > 0.5 && sd < 0 ? 3.2 : 0) - (w > 0 && sd > 0 ? 2.2 : 0);
        const lift = pose.moving ? Math.max(0, Math.cos(ph)) * 2.4 : 0;
        const hip = c.at(0, sd * 4.4, 15);
        const knee = c.g(fF * 0.5 + 1.4, sd * 4.9, 7.6 + lift * 0.5);
        const ft = c.g(fF, sd * 5.1, lift);
        limb(c, hip, knee, 3.4, 2.7, C.leather, { mode: 'emboss', dither: true });
        limb(c, knee, ft, 2.7, 2.3, C.leather, { mode: 'emboss' });
        c.p.ellipse(knee.x, knee.y + 0.5, 2.7, 1.3).fill(C.rust, { mode: 'emboss', inner: false });
        c.p.ellipse(ft.x + P.fx * 1.6, ft.y - 1, 3.6, 2.1).fill(C.iron, { mode: 'sphere', light: 0.12 });
      },
    });
  }
  // the hook arm (right) and its chain
  const hand: [number, number, number] =
    w > 0 ? [-1.5 - w * 1.5, 8.6, 33 + w * 7] : st > 0 ? [8 + st * 2.5, 6.2, 25.5] : [3.4, 10.6, 15.5 + (pose.moving ? s * 0.8 : 0)];
  const elbow: [number, number, number] =
    w > 0 ? [-0.5, 11, 28 + w * 3] : st > 0 ? [4.5, 8.8, 27] : [1.2, 11.4, 22.5];
  let hook: [number, number, number];
  if (w > 0) {
    // whirling the hook overhead before the throw
    const th = pose.frame * 1.75 + 0.4;
    hook = [hand[0] + Math.cos(th) * 10, hand[1] + Math.sin(th) * 10, hand[2] + 2.5];
  } else if (st > 0) {
    hook = [hand[0] + 2 + st * 19, hand[1] - st * 2.4, hand[2] - 2 - (1 - st) * 4];
  } else {
    hook = [hand[0] + (pose.moving ? -s * 1.6 : Math.sin(pose.ph) * 0.8), hand[1] + 0.4, 7.4];
  }
  const handD = c.dep(hand[0], hand[1]);
  parts.push({
    d: (c.dep(0, 9.5) + handD) / 2 + 0.3,
    draw: () => {
      const sh = c.at(0, 9.4, 30 + heave);
      const el = c.at(elbow[0], elbow[1], elbow[2]);
      const hd = c.at(hand[0], hand[1], hand[2]);
      limb(c, sh, el, 3.4, 3, C.skin, { mode: 'emboss', dither: true });
      limb(c, el, hd, 3, 2.6, C.skin, { mode: 'emboss', dither: true });
      // leather bracer
      const b0 = { x: el.x + (hd.x - el.x) * 0.45, y: el.y + (hd.y - el.y) * 0.45, d: 0 };
      c.p.capsule(b0.x, b0.y, hd.x, hd.y, 3, 2.7).fill(C.leather, { mode: 'cyl', inner: false });
      c.p.circle(hd.x, hd.y, 2.6).fill(C.skin, { mode: 'sphere' });
    },
  });
  parts.push({
    d: Math.max(handD, c.dep(hook[0], hook[1])) + 0.5,
    draw: () => {
      const hd = c.at(hand[0], hand[1], hand[2]);
      const hk = w > 0 || st > 0 ? c.at(hook[0], hook[1], hook[2]) : c.g(hook[0], hook[1], hook[2]);
      chainLinks(c, hd, hk, C.iron, w > 0 || st > 0.7 ? 0 : 0.6);
      const dirX = hk.x - hd.x;
      hookAt(c, { x: hk.x, y: hk.y + 1 }, Math.abs(dirX) > 1 ? dirX : P.fx >= 0 ? 1 : -1, C.rust);
    },
  });
  // hulking torso: pale gut, leather harness, belt
  parts.push({
    d: 0,
    draw: () => {
      blob(
        c,
        [
          [3.4, 0, 19.5 + heave * 0.3, 7.4],
          [-2.2, 0, 21, 6],
          [1, -4.6, 27.5 + heave, 6.4],
          [1, 4.6, 27.5 + heave, 6.4],
          [-2, 0, 30 + heave, 6.8],
        ],
        C.skin,
        { mode: 'sphere', dither: true, light: -0.08 },
      );
      // crossed harness straps + iron ring where they meet
      const r0 = c.at(1.6, -8, 30.5 + heave), r1 = c.at(9.8, 5, 18.5);
      const l0 = c.at(1.6, 8, 30.5 + heave), l1 = c.at(9.8, -5, 18.5);
      c.p.capsule(r0.x, r0.y, r1.x, r1.y, 1.2, 1.2).capsule(l0.x, l0.y, l1.x, l1.y, 1.2, 1.2).fill(C.leather, { mode: 'emboss', inner: false, light: 0.1 });
      if (facing > -0.2) {
        const ring = c.at(8.9, 0, 24 + heave * 0.6);
        c.p.circle(ring.x, ring.y, 1.7).minus().circle(ring.x, ring.y, 0.8).fill(C.iron, { mode: 'emboss', inner: false });
      }
      // belly hair / scars
      if (facing > 0.2) {
        const sc = c.at(10.3, -2.4, 21);
        c.p.line(sc.x - 1, sc.y - 1, sc.x + 1, sc.y + 1).fill(C.skin, { mode: 'flat', tone: 1, inner: false });
      }
      // belt with an iron buckle and a ring of keys
      const pts: Pt[] = [];
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        pts.push(c.at(2.6 + Math.cos(a) * 8, Math.sin(a) * 7.8, 16.4));
        pts.push(c.at(2.6 + Math.cos(a) * 8, Math.sin(a) * 7.8, 14.6));
      }
      c.p.poly(hull(pts)).fill(C.leather, { mode: 'cyl', light: 0.05 });
      if (facing > -0.3) {
        const bk = c.at(10.5, 0, 15.5);
        c.p.rect(bk.x - 1.5, bk.y - 1, 3, 2.2).fill(C.iron, { mode: 'emboss', inner: false });
      }
      const keys = c.at(4, -8.8, 14);
      c.p.circle(keys.x, keys.y + 1, 1.6).minus().circle(keys.x, keys.y + 1, 0.8).fill(C.rust, { mode: 'emboss', inner: false });
      c.p.line(keys.x, keys.y + 2, keys.x - 0.5, keys.y + 4.5).line(keys.x + 1, keys.y + 2, keys.x + 1.5, keys.y + 4).fill(C.iron, { mode: 'flat', tone: 3, inner: false });
    },
  });
  // stained leather apron hanging over the belly and thighs
  parts.push({
    d: c.dep(10.6, 0) + 0.2,
    draw: () => {
      const tl = c.at(10.2, -6, 16.6), tr = c.at(10.2, 6, 16.6);
      const bl = c.at(7.8 + (pose.moving ? s * 0.6 : 0), -5.6, 4.5), br = c.at(7.8 + (pose.moving ? s * 0.6 : 0), 5.6, 4.5);
      const mid = c.at(8, 0, 3.6);
      c.p.poly([tl.x, tl.y, tr.x, tr.y, br.x, br.y, mid.x, mid.y, bl.x, bl.y]).fill(C.apron, { mode: 'emboss', dither: true, light: -0.05 });
      if (facing > 0.1) {
        // old blood stains and a scorch-dark hem
        const r = rng(1931);
        for (let k = 0; k < 5; k++) {
          const q = c.at(9.2, (r() - 0.5) * 8, 6 + r() * 9);
          c.p.ellipse(q.x, q.y, 0.9 + r(), 0.7 + r() * 0.6).fill(MATERIALS.bloodRed, { mode: 'flat', tone: 0, inner: false, alpha: 200 });
        }
        c.p.line(bl.x, bl.y - 1, br.x, br.y - 1).fill(C.apron, { mode: 'flat', tone: 0, inner: false });
      }
    },
  });
  // chain-wrapped left arm with a rusted pauldron
  parts.push({
    d: c.dep(1.5, -10) + 0.2,
    draw: () => {
      const sh = c.at(0, -9.4, 30 + heave);
      const el = c.at(1.6 + st * 1.5, -11.2, 22.4 - w * 1);
      const hd = c.at(4.2 + st * 2 - w * 1.4, -9.6, 16 + w * 3);
      limb(c, sh, el, 3.4, 3, C.skin, { mode: 'emboss', dither: true });
      limb(c, el, hd, 3, 2.6, C.skin, { mode: 'emboss', dither: true });
      c.p.circle(hd.x, hd.y, 2.6).fill(C.skin, { mode: 'sphere' });
      // coils of heavy chain around the forearm
      for (let k = 0; k < 3; k++) {
        const t = 0.2 + k * 0.26;
        const x = el.x + (hd.x - el.x) * t, y = el.y + (hd.y - el.y) * t;
        c.p.ellipse(x, y, 3.8, 1.9).minus().ellipse(x, y - 0.4, 2.6, 1).fill(C.iron, { mode: 'emboss', light: 0.15, inner: false });
      }
      // spiked pauldron
      c.p.ellipse(sh.x, sh.y - 1, 4.6, 3.4).fill(C.rust, { mode: 'sphere', dither: true, light: 0.05 });
      c.p.poly([sh.x - 1, sh.y - 3.5, sh.x + 1, sh.y - 3.5, sh.x - 0.4, sh.y - 7]).fill(C.iron, { mode: 'emboss', inner: false, light: 0.2 });
      c.p.px(sh.x - 2, sh.y - 1, C.iron[4]!).px(sh.x + 2, sh.y, C.iron[4]!);
    },
  });
  // bull neck and the iron jailer's mask
  parts.push({
    d: c.dep(3.4, 0) + 0.6,
    draw: () => {
      const hz = 34.8 + heave - pose.hurt * 1.2 + w * 0.6;
      const nk = c.at(2.2, 0, 31 + heave);
      c.p.ellipse(nk.x, nk.y, 4.4, 2.8).fill(C.skin, { mode: 'sphere', light: -0.15 });
      const hq = c.at(3.4, 0, hz);
      c.p.ellipse(hq.x, hq.y, 4.5, 5.1).fill(C.iron, { mode: 'sphere', dither: true, light: 0.12 });
      // riveted band and rust bleeding from the rivets
      c.p.line(hq.x - 4, hq.y - 2, hq.x + 4, hq.y - 2).fill(C.iron, { mode: 'flat', tone: 1, inner: false });
      for (const dx of [-3, 0, 3]) c.p.px(hq.x + dx, hq.y - 2, C.iron[4]!).px(hq.x + dx, hq.y - 1, C.rust[2]!);
      c.p.px(hq.x - 2, hq.y + 3, C.rust[1]!).px(hq.x + 1, hq.y + 4, C.rust[2]!);
      if (facing > -0.35) {
        const fx = 3.4 + 3.9;
        const e0 = c.at(fx, -2.4, hz + 0.8), e1 = c.at(fx, 2.4, hz + 0.8);
        c.p.line(e0.x, e0.y, e1.x, e1.y).fill([0x040202, 0x040202, 0x080404, 0x0c0606], { mode: 'flat', tone: 0, inner: false });
        const hot = w > 0.5 || st > 0.5 ? C.eye[4]! : C.eye[2]!;
        for (const sd of [-1, 1]) {
          const e = c.at(fx, sd * 1.4, hz + 0.8);
          if (P.depthOf(1, sd * 0.5) > -0.2) c.p.gpx(e.x, e.y, hot, C.eye[1]!);
        }
        // breathing holes
        for (const sd of [-1, 0, 1]) {
          const b = c.at(fx - 0.2, sd * 1.2, hz - 2.4);
          c.p.px(b.x, b.y, 0x060404);
        }
      }
    },
  });
  return parts;
}

// ---------------------------------------------------------------- rimewraith: Rime Wraith (floating ice ghost)

const RIME = {
  shroud: ramp(0x14223a, 0x284266, 0x4a76a2, 0x8cbede, 0xdaf2ff),
  inner: ramp(0x02050a, 0x060c16, 0x0a1422, 0x101e30),
  ice: MATERIALS.glassCyan,
  eye: ramp(0x1a5aa0, 0x46a8ff, 0xa8e4ff, 0xffffff),
  bone: ramp(0x4a5a72, 0x8a9cb4, 0xc4d4e6, 0xf0f8ff),
};

function rimewraith(c: CC): Part[] {
  const { pose, P } = c;
  const C = RIME;
  const parts: Part[] = [];
  const w = pose.wind;
  const st = pose.strike;
  const hover = 6.5 + Math.sin(pose.ph) * 1.4 + w * 1.6 - st * 0.6;
  const sway = Math.sin(pose.ph + 1) * 1.1 - pose.lean * 0.25;
  const trail = pose.moving ? 3 : 0;
  // trailing frost wisps where the legs should be
  parts.push({
    d: -1.2,
    draw: () => {
      for (let k = 0; k < 3; k++) {
        const a = c.at(-0.6, (k - 1) * 2.6, hover + 3);
        const b = c.at(-2 - trail - sway * (0.8 + k * 0.3), (k - 1) * 3.2 + sway * 0.5, hover - 4.5 - (k === 1 ? 2 : 0) + Math.sin(pose.ph * 2 + k) * 0.9);
        c.p.capsule(a.x, a.y, b.x, b.y, 1.7 - k * 0.2, 0.3);
      }
      c.p.fill(C.shroud, { mode: 'emboss', alpha: 160, inner: false, glow: C.shroud[3]! });
    },
  });
  // the tattered frost shroud
  parts.push({
    d: 0,
    draw: () => {
      const pts: Pt[] = [];
      const top = hover + 16;
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        pts.push(c.at(Math.cos(a) * 2.8, Math.sin(a) * 5.8, top));
        pts.push(c.at(Math.cos(a) * 4 - sway * 0.15, Math.sin(a) * 6.6, hover + 10));
        pts.push(c.at(Math.cos(a) * 3.6 - sway * 0.3 - trail * 0.3, Math.sin(a) * 5.2, hover + 3));
      }
      c.p.poly(hull(pts)).fill(C.shroud, { mode: 'cyl', dither: true });
      const thc = Math.atan2(5.2 * P.ry, 3.6 * P.fy);
      for (let k = 0; k <= 9; k++) {
        const a = thc - Math.PI / 2 + (Math.PI * k) / 9;
        const q0 = c.at(Math.cos(a) * 3.3 - sway * 0.3, Math.sin(a) * 4.9, hover + 3.8);
        const q1 = c.at(Math.cos(a + 0.22) * 3.3 - sway * 0.3, Math.sin(a + 0.22) * 4.9, hover + 3.8);
        const tip = c.at(Math.cos(a + 0.11) * 3.6 - sway * 0.8 - trail * 0.6, Math.sin(a + 0.11) * 5.3, hover - 1 - ((k + pose.frame) % 3) * 1.5);
        c.p.poly([q0.x, q0.y, q1.x, q1.y, tip.x, tip.y]);
      }
      c.p.fill(C.shroud, { mode: 'emboss', light: -0.22 });
      // a mantle of ice shards on the shoulders
      for (const sd of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const b = c.at(-0.4 + k * 0.9, sd * (4.4 + k * 0.5), hover + 15.6);
          const h = 2.4 + ((k + (sd > 0 ? 1 : 0)) % 2) * 1.6;
          c.p.poly([b.x - 1, b.y + 0.5, b.x + 1, b.y + 0.5, b.x + sd * 0.6, b.y - h]);
        }
      }
      c.p.fill(C.ice, { mode: 'facet', facets: 3, light: 0.2, inner: false });
      // rime crust streaks down the front
      if (P.depthOf(1, 0) > -0.4) {
        const r = rng(4411);
        for (let k = 0; k < 4; k++) {
          const rr = (r() - 0.5) * 7;
          const a = c.at(4.2, rr, hover + 13 - r() * 3);
          const b = c.at(4.6, rr + (r() - 0.5), hover + 5 + r() * 2);
          c.p.line(a.x, a.y, b.x, b.y);
        }
        c.p.fill(C.shroud, { mode: 'flat', tone: 4, inner: false, alpha: 150 });
      }
    },
  });
  // skeletal frozen arms in ragged sleeves
  for (const sd of [-1, 1]) {
    parts.push({
      d: c.dep(1.5, sd * 4.6) + 0.2,
      draw: () => {
        const sh = c.at(0.4, sd * 4.3, hover + 14.5);
        const hand = c.at(2.6 + w * 1.6 + st * 4.4, sd * (4.6 - w * 2.8 - st * 2.6), hover + 8.4 + w * 4.4 + st * 2.6);
        limb(c, sh, hand, 1.9, 1.5, C.shroud, { mode: 'emboss', dither: true, light: 0.05 });
        c.p.poly([hand.x - 1.8, hand.y - 1, hand.x + 1.8, hand.y - 1, hand.x, hand.y + 2.6]).fill(C.shroud, { mode: 'emboss', light: -0.2, inner: false });
        c.p.circle(hand.x + P.fx * 0.8, hand.y + 0.6, 1.05).fill(C.bone, { mode: 'sphere', inner: false });
        c.p.px(hand.x + P.fx * 1.8, hand.y + 1.6, C.bone[2]!);
      },
    });
  }
  // the frost bolt gathering between the hands / bursting forth
  if (w > 0 || st > 0.3) {
    parts.push({
      d: c.dep(5, 0) + 0.7,
      draw: () => {
        const q = c.at(4.2 + w * 1.6 + st * 5.4, 0, hover + 9 + w * 4.4 + st * 2.6);
        const rr = st > 0 ? 1.6 + st * 2.2 : 0.9 + w * 2.3;
        c.p.circle(q.x, q.y, rr).fill(C.ice, { mode: 'facet', facets: 5, glow: C.ice[3]!, light: 0.25, inner: false, rot: pose.frame * 0.7 });
        if (st > 0.8 || w > 0.7) {
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2 + pose.frame * 0.5;
            const L = rr + 1.5 + (k % 2) * 1.8;
            c.p.line(q.x + Math.cos(a) * (rr - 0.5), q.y + Math.sin(a) * (rr - 0.5), q.x + Math.cos(a) * L, q.y + Math.sin(a) * L);
          }
          c.p.fill(C.ice, { mode: 'flat', tone: 3, glow: C.ice[2]!, inner: false, alpha: 220 });
        }
        c.p.gpx(q.x, q.y, 0xffffff, C.ice[3]!);
      },
    });
  }
  // peaked hood, dark within, two cold eyes; icicle fringe on the brim
  parts.push({
    d: c.dep(0.6, 0) + 0.45,
    draw: () => {
      const hz = hover + 20.4;
      const shell = c.at(0, 0, hz);
      const peak = c.at(-2.2 - sway * 0.3 - trail * 0.3, 0, hz + 6.4);
      c.p.ellipse(shell.x, shell.y, 4.9, 4.6).poly([shell.x - 3.6, shell.y - 1, shell.x + 3.6, shell.y - 1, peak.x, peak.y]).fill(C.shroud, { mode: 'emboss', dither: true, light: 0.32 });
      const fd = P.depthOf(1, 0);
      if (fd > -0.3) {
        const f = c.at(2.7, 0, hz - 0.6);
        const rx = 1.1 + 1.8 * Math.max(0, fd);
        c.p.ellipse(f.x, f.y + 0.3, rx, 2.7).fill(C.inner, { mode: 'flat', tone: 1, inner: false });
        const hot = w > 0.4 || st > 0.4;
        for (const th of [-0.48, 0.48]) {
          if (P.depthOf(Math.cos(th), Math.sin(th)) < 0.05) continue;
          const e = c.at(Math.cos(th) * 3.8, Math.sin(th) * 3.8, hz - 0.3);
          c.p.gpx(e.x, e.y, hot ? 0xffffff : C.eye[3]!, C.eye[1]!);
          if (hot) c.p.gpx(e.x, e.y + 1, C.eye[2]!, C.eye[1]!);
        }
      }
      for (let k = -2; k <= 2; k++) {
        const b = c.at(1.8, k * 1.7, hz - 3.2);
        c.p.poly([b.x - 0.7, b.y, b.x + 0.7, b.y, b.x, b.y + 1.6 + ((k + 3) % 2) * 1.2]);
      }
      c.p.fill(C.ice, { mode: 'flat', tone: 3, inner: false, alpha: 230 });
    },
  });
  return parts;
}

/** Spectral frost finish: translucent body, cold outer haze and drifting snow motes. */
function frostify(buf: PixelBuffer, frame: number, seed: number, ground: number): void {
  const src = buf.clone();
  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      const a = src.alpha(x, y);
      if (a > 0) {
        const fade = y > ground - 18 ? 0.34 + 0.56 * Math.max(0, (ground - y) / 18) : 0.9;
        buf.set(x, y, src.get(x, y) & 0xffffff, Math.round(a * fade));
        continue;
      }
      const near = src.alpha(x - 1, y) > 0 || src.alpha(x + 1, y) > 0 || src.alpha(x, y - 1) > 0 || src.alpha(x, y + 1) > 0;
      if (near) buf.blend(x, y, RIME.shroud[3]!, 60);
    }
  }
  const r = rng(seed ^ 0x5157);
  for (let k = 0; k < 6; k++) {
    const x = Math.round(buf.w / 2 + (r() - 0.5) * 30);
    const y = Math.round(ground - 34 + ((frame * 3 + k * 7 + r() * 5) % 34));
    buf.blend(x, y, k % 3 ? 0xeaf6ff : RIME.shroud[3]!, 210);
  }
}

// ---------------------------------------------------------------- gloomshade: Gloom Shade (inky shadow wisp, one staring eye)

const GLOOM = {
  ink: ramp(0x050309, 0x0c0716, 0x181028, 0x2a1c44, 0x4a3470),
  eye: ramp(0x6a6878, 0xb4b2c2, 0xe8e6f0, 0xffffff),
  pupil: 0x120614,
  glow: MATERIALS.hexViolet,
};

function gloomshade(c: CC): Part[] {
  const { pose, P } = c;
  const C = GLOOM;
  const parts: Part[] = [];
  const w = pose.wind;
  const st = pose.strike;
  const burst = st > 0.6;
  const hover = 12 + Math.sin(pose.ph) * 1.6 + w * 2.2;
  const swell = 1 + w * 0.5 - (burst ? 0.38 : st * 0.18);
  const R0 = 6.8 * swell;
  const trail = pose.moving ? 1 : 0;
  // smoky tendrils hanging (or streaming behind when it drifts)
  if (!burst) {
    parts.push({
      d: -0.8,
      draw: () => {
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + 0.4;
          const len = (7.5 + (k % 2) * 3.5) * (1 - w * 0.45) * (st > 0 ? 0.6 : 1);
          const wave = Math.sin(pose.ph * 2 + k * 1.3) * 1.7;
          const base = c.at(Math.cos(a) * R0 * 0.45, Math.sin(a) * R0 * 0.55, hover - R0 * 0.35);
          const mid = c.at(Math.cos(a) * R0 * 0.65 - trail * 3 + wave * 0.4, Math.sin(a) * R0 * 0.75 + wave, hover - R0 * 0.35 - len * 0.5);
          const tip = c.at(Math.cos(a) * R0 * 0.8 - trail * 7 - wave * 0.5, Math.sin(a) * R0 * 0.9 - wave * 0.6, hover - R0 * 0.25 - len);
          c.p.capsule(base.x, base.y, mid.x, mid.y, 1.9, 1.1).capsule(mid.x, mid.y, tip.x, tip.y, 1.1, 0.3);
        }
        c.p.fill(C.ink, { mode: 'emboss', dither: true, alpha: 215, inner: false });
      },
    });
  }
  // bursting darkness: spikes of shadow radiating out of the core
  if (st > 0.3) {
    parts.push({
      d: 1.2,
      draw: () => {
        const len = st > 0.9 ? 13 : st > 0.6 ? 18 : 9;
        const thick = st > 0.9 ? 2.3 : st > 0.6 ? 1.3 : 0.9;
        for (let k = 0; k < 11; k++) {
          const a = (k / 11) * Math.PI * 2 + (k % 2) * 0.25;
          const L = len * (k % 3 === 0 ? 1 : 0.72);
          const b = c.at(0, 0, hover);
          const t = c.at(Math.cos(a) * L, Math.sin(a) * L, hover + Math.sin(a * 3) * 4);
          c.p.capsule(b.x, b.y, t.x, t.y, thick, 0.35);
        }
        c.p.fill(C.ink, { mode: 'flat', tone: burst ? 1 : 2, alpha: burst ? 235 : 150, inner: false, glow: C.glow[0]! });
        if (st > 0.9) {
          const q = c.at(0, 0, hover);
          c.p.circle(q.x, q.y, 9).minus().circle(q.x, q.y, 7.6).fill(C.glow, { mode: 'flat', tone: 0, alpha: 170, inner: false });
        }
      },
    });
  }
  // the inky core
  parts.push({
    d: 0,
    draw: () => {
      const q = c.at(0, 0, hover);
      // the core and the smoke lumps boiling on its surface share one shading pass
      c.p.ellipse(q.x, q.y, R0, R0 * 0.95);
      const r = rng(733 + pose.frame);
      for (let k = 0; k < 5; k++) {
        const a = r() * Math.PI * 2;
        c.p.circle(q.x + Math.cos(a) * R0 * 0.82, q.y + Math.sin(a) * R0 * 0.78, 1.6 + r() * 1.4);
      }
      c.p.fill(C.ink, { mode: 'sphere', dither: true, light: 0.12, cx: q.x, cy: q.y });
      // faint violet sheen on the lit rim
      c.p.px(q.x - R0 * 0.55, q.y - R0 * 0.6, C.ink[4]!).px(q.x - R0 * 0.35, q.y - R0 * 0.75, C.ink[4]!);
    },
  });
  // one pale staring eye
  parts.push({
    d: 0.6,
    draw: () => {
      const fd = P.depthOf(1, 0);
      if (fd < -0.45) return;
      const big = 1 + w * 0.55 + (burst ? 0.35 : 0);
      const e = c.at(R0 * 0.62, 0, hover + 0.6);
      const rx = (1.3 + 1.5 * Math.max(0, fd)) * big;
      const ry = 2.1 * big;
      c.p.ellipse(e.x, e.y, rx + 0.8, ry + 0.6).fill(C.ink, { mode: 'flat', tone: 0, inner: false });
      c.p.ellipse(e.x, e.y, rx, ry).fill(C.eye, { mode: 'sphere', glow: C.eye[1]!, light: 0.25, inner: false });
      const px = e.x + P.fx * 0.6 * Math.max(0, fd);
      if (burst) c.p.gpx(px, e.y, 0xffffff, C.glow[3]!);
      else if (w > 0.4) c.p.px(px, e.y, C.pupil);
      else c.p.px(px, e.y, C.pupil).px(px, e.y + 1, C.pupil).px(px + 1, e.y, C.pupil);
    },
  });
  return parts;
}

/** Smoky finish: a soft dark haze around the silhouette and a few curls of rising smoke. */
function smokify(buf: PixelBuffer, frame: number, seed: number, ground: number): void {
  const src = buf.clone();
  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      if (src.alpha(x, y) > 0) continue;
      let n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, -2]] as const) if (src.alpha(x + dx, y + dy) > 0) n++;
      if (n) buf.blend(x, y, n > 2 ? 0x1c1030 : 0x120a20, Math.min(150, 40 + n * 22));
    }
  }
  const r = rng(seed ^ 0x9e37);
  for (let k = 0; k < 5; k++) {
    const x = Math.round(buf.w / 2 + (r() - 0.5) * 22);
    const y = Math.round(ground - 16 - ((frame * 3 + k * 5 + r() * 4) % 22));
    buf.blend(x, y, k % 2 ? 0x1c1230 : 0x2a1c44, 170);
    buf.blend(x + 1, y, 0x140c22, 110);
  }
}

// ---------------------------------------------------------------- webweaver: Web Weaver (bloated cave spider)

const WEAVER = {
  chitin: ramp(0x0a0608, 0x1a1014, 0x2c1c22, 0x443036, 0x62484e),
  abdomen: ramp(0x3a3026, 0x766852, 0xb2a282, 0xdacfae, 0xf6f0dc),
  mark: 0x3a120c,
  eye: MATERIALS.eyeRed,
  web: ramp(0x8a8a96, 0xc0c0cc, 0xe8e8f0, 0xffffff),
  fang: MATERIALS.boneDry,
};

function webweaver(c: CC): Part[] {
  const { pose, P } = c;
  const C = WEAVER;
  const parts: Part[] = [];
  const w = pose.wind;
  const st = pose.strike;
  const rear = Math.max(w, st * 0.7);
  const bodyZ = 7 + (pose.moving ? Math.abs(Math.sin(pose.ph * 2)) * 0.6 : Math.sin(pose.ph) * 0.3);
  const thF = 3;
  const abF = -5.4;
  const thZ = bodyZ + rear * 4.2;
  const abZ = bodyZ + 1.5 - rear * 1.6;
  const pulse = 1 + (pose.moving ? 0 : Math.sin(pose.ph) * 0.035) + w * 0.04;
  // eight jointed legs, alternating tetrapod gait
  const hips = [4.4, 3.4, 2.3, 1.2];
  const fan = [0.95, 0.35, -0.3, -0.85];
  for (const sd of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const set = (k + (sd > 0 ? 1 : 0)) % 2;
      const ph = pose.ph * 2 + set * Math.PI;
      const front = k === 0;
      parts.push({
        d: c.dep(hips[k]! + fan[k]! * 6, sd * 8) - 0.3,
        draw: () => {
          const stride = pose.moving ? Math.sin(ph) * 2.6 : Math.sin(pose.ph + k) * 0.25;
          const lift = pose.moving ? Math.max(0, Math.cos(ph)) * 2.4 : 0;
          const raise = front ? rear * 11 : k === 1 ? rear * 3 : 0;
          const hip = c.at(hips[k]!, sd * 2.8, thZ - 0.4);
          const knee = c.g(hips[k]! + fan[k]! * 5.6 + stride * 0.5 + (front ? rear * 3 : 0), sd * (8.6 - Math.abs(fan[k]!) * 1.4), thZ + 4.6 + lift * 0.5 + raise * 0.7);
          const ft = c.g(hips[k]! + fan[k]! * 10.5 + stride + (front ? rear * 4.5 : 0), sd * (14 - Math.abs(fan[k]!) * 2.2), lift + raise);
          limb(c, hip, knee, 1.35, 1, C.chitin, { mode: 'emboss', light: 0.12 });
          limb(c, knee, ft, 1, 0.45, C.chitin, { mode: 'emboss', light: 0.12 });
          c.p.px(knee.x, knee.y - 1, C.abdomen[1]!);
          const mid = { x: (knee.x + ft.x) / 2, y: (knee.y + ft.y) / 2 };
          c.p.px(mid.x, mid.y, C.abdomen[1]!);
        },
      });
    }
  }
  // bloated pale abdomen with dark chevrons
  parts.push({
    d: c.dep(abF, 0),
    draw: () => {
      blob(
        c,
        [
          [abF + 2.6, 0, abZ + 1.2, 5.4 * pulse],
          [abF - 1.6, 0, abZ + 1.8, 6.8 * pulse],
        ],
        C.abdomen,
        { mode: 'sphere', dither: true, light: 0.02 },
      );
      for (let k = 0; k < 3; k++) {
        const f = abF + 1.4 - k * 2.3;
        const a = c.at(f + 0.9, -2.6 + k * 0.3, abZ + 6.6 - k * 0.3);
        const m = c.at(f, 0, abZ + 7.4 - k * 0.3);
        const b = c.at(f + 0.9, 2.6 - k * 0.3, abZ + 6.6 - k * 0.3);
        c.p.line(a.x, a.y, m.x, m.y).line(m.x, m.y, b.x, b.y);
      }
      const s0 = c.at(abF + 2.8, 0, abZ + 7), s1 = c.at(abF - 5.2, 0, abZ + 5.6);
      c.p.line(s0.x, s0.y, s1.x, s1.y);
      c.p.fill([C.mark, C.mark, C.mark, C.mark], { mode: 'flat', tone: 0, inner: false, alpha: 230 });
      const r = rng(5151);
      for (let k = 0; k < 6; k++) {
        const q = c.at(abF + (r() - 0.5) * 8, (r() - 0.5) * 9, abZ + 3 + r() * 4);
        c.p.px(q.x, q.y, C.abdomen[1]!);
      }
      const hl = c.at(abF - 0.5, -2.5, abZ + 7);
      c.p.px(hl.x, hl.y, C.abdomen[4]!).px(hl.x + 1, hl.y, C.abdomen[3]!);
      const sp = c.at(abF - 8.2, 0, abZ + 1);
      c.p.circle(sp.x, sp.y, 1.1).fill(C.chitin, { mode: 'sphere', inner: false });
    },
  });
  // cephalothorax, eye cluster, fangs
  parts.push({
    d: c.dep(thF + 2, 0) + 0.3,
    draw: () => {
      sphere(c, thF, 0, thZ, 4.5, C.chitin, { dither: true, light: 0.14 });
      sphere(c, thF + 3.8, 0, thZ + 0.5, 3.1, C.chitin, { light: 0.2 });
      if (P.depthOf(1, 0) > -0.3) {
        const hot = w > 0.4 || st > 0.4;
        for (const [ef, er, ez, big] of [[5.2, -1.3, 2.2, 1], [5.2, 1.3, 2.2, 1], [4.6, -2.6, 1.6, 0], [4.6, 2.6, 1.6, 0]] as const) {
          if (P.depthOf(1, er * 0.35) < -0.1) continue;
          const e = c.at(thF + ef, er, thZ + ez);
          c.p.gpx(e.x, e.y, hot ? C.eye[4]! : C.eye[3]!, C.eye[1]!);
          if (big) c.p.gpx(e.x + 1, e.y, C.eye[2]!, C.eye[1]!);
        }
        for (const sd of [-1, 1]) {
          const f0 = c.at(thF + 6, sd * 1.1, thZ - 1);
          const f1 = c.at(thF + 6.8 + st * 0.8, sd * 0.7 * (1 - st), thZ - 3.6 - w * 0.6);
          c.p.capsule(f0.x, f0.y, f1.x, f1.y, 0.75, 0.35);
        }
        c.p.fill(C.fang, { mode: 'emboss', inner: false, light: 0.1 });
      }
    },
  });
  // web spit (strike) / a strand drooling from the mouth (windup)
  if (st > 0.3 || w > 0.5) {
    parts.push({
      d: c.dep(thF + 9, 0) + 0.8,
      draw: () => {
        const m = c.at(thF + 6.6, 0, thZ - 1.6);
        if (st > 0.3) {
          const far = 5 + st * 11;
          const g = c.at(thF + 6 + far, 0, thZ - 1 + (1 - st) * 2);
          for (const o of [-1, 0, 1]) c.p.line(m.x, m.y, g.x + o * 1.4, g.y + o * 0.8);
          const R1 = 2 + st * 2.2;
          for (let k = 0; k < 7; k++) {
            const a = (k / 7) * Math.PI * 2 + pose.frame;
            c.p.line(g.x, g.y, g.x + Math.cos(a) * R1, g.y + Math.sin(a) * R1 * 0.8);
          }
          c.p.fill(C.web, { mode: 'flat', tone: 2, alpha: 210, inner: false });
          c.p.circle(g.x, g.y, 1.2 + st * 0.8).fill(C.web, { mode: 'sphere', light: 0.2, inner: false });
        } else {
          c.p.line(m.x, m.y, m.x + 0.4, m.y + 3 + w * 2).fill(C.web, { mode: 'flat', tone: 2, alpha: 200, inner: false });
          c.p.px(m.x + 0.4, m.y + 4 + w * 2, C.web[3]!);
        }
      },
    });
  }
  return parts;
}

const DRAW: Record<CreatureId, (c: CC) => Part[]> = { pursuer, skirmisher, artillery, guardian, hexer, broodcaller, mite, spiritwolf, spiritbear, spiritelk, gaoler, rimewraith, gloomshade, webweaver };

/** Death burst style per creature: chunk tint, shard glint (bone/stone) and droplet color (gore/ichor). */
const DEATH: Record<CreatureId, { tint: number; glint: boolean; drop: number; drops: number }> = {
  pursuer: { tint: 0x4a2a26, glint: false, drop: 0x8e1a24, drops: 22 },
  skirmisher: { tint: 0x2a1830, glint: false, drop: 0x7a1420, drops: 14 },
  artillery: { tint: 0x3a4a14, glint: false, drop: 0x8ee81c, drops: 24 },
  guardian: { tint: 0xbcae94, glint: true, drop: 0x44a2ff, drops: 8 },
  hexer: { tint: 0x2a0c18, glint: false, drop: 0x9446f0, drops: 14 },
  broodcaller: { tint: 0x5a2a30, glint: false, drop: 0xf0dc48, drops: 28 },
  mite: { tint: 0x82745a, glint: false, drop: 0xb8c070, drops: 8 },
  spiritwolf: { tint: 0x34a888, glint: true, drop: 0x8ae8c8, drops: 16 },
  spiritbear: { tint: 0x34a888, glint: true, drop: 0x8ae8c8, drops: 26 },
  spiritelk: { tint: 0x34a888, glint: true, drop: 0x8ae8c8, drops: 22 },
  gaoler: { tint: 0x5a3a2a, glint: true, drop: 0x8e1a24, drops: 30 },
  rimewraith: { tint: 0x8cbede, glint: true, drop: 0xdaf2ff, drops: 18 },
  gloomshade: { tint: 0x150d22, glint: false, drop: 0x5418aa, drops: 20 },
  webweaver: { tint: 0x766852, glint: false, drop: 0xb4c84a, drops: 22 },
};

/** Lunge smear colour per creature (attack strike frames). */
const SMEAR: Record<CreatureId, number> = {
  pursuer: MATERIALS.ghoulFlesh[3]!,
  skirmisher: MATERIALS.batWing[3]!,
  artillery: MATERIALS.bile[3]!,
  guardian: MATERIALS.boneDry[3]!,
  hexer: MATERIALS.hexViolet[3]!,
  broodcaller: MATERIALS.broodFlesh[3]!,
  mite: MATERIALS.maggot[3]!,
  spiritwolf: PALETTES.spiritwolf.body[3]!,
  spiritbear: PALETTES.spiritwolf.body[3]!,
  spiritelk: PALETTES.spiritwolf.body[3]!,
  gaoler: MATERIALS.rust[3]!,
  rimewraith: MATERIALS.glassCyan[3]!,
  gloomshade: MATERIALS.hexViolet[1]!,
  webweaver: 0xe8e8f0,
};

function renderPose(painter: Painter, id: CreatureId, view: View, pose: CPose): void {
  const W = painter.w;
  const P = new Proj(W / 2, GROUND[id], VIEW_ANGLE[view]);
  const at = (f: number, r: number, z: number): Pt => P.p(f + pose.lean * Math.min(1.2, z / 12) + pose.lunge * Math.min(1, z / 6), r, z * pose.squash + pose.bob);
  const g = (f: number, r: number, z: number): Pt => P.p(f, r, z);
  const c: CC = { p: painter, P, pose, at, g, dep: (f, r) => P.depthOf(f, r) };
  drawParts(DRAW[id](c));
}

export function renderCreatureFrame(id: CreatureId, state: string, view: View, i: number, n: number, painter: Painter): PixelBuffer {
  const seed = id.length * 977 + i * 13 + view.charCodeAt(0) * 3 + state.length * 101;
  const ghost = id === 'spiritwolf' || id === 'spiritbear' || id === 'spiritelk';
  const pose = poseFor(state, i, n);
  if (state === 'death' && i > 0) {
    // collapse: the body sags and tips back before it bursts
    pose.squash = 0.8;
    pose.bob = -1.6;
    pose.lean = -3;
  }
  painter.reset();
  renderPose(painter, id, view, pose);
  painter.finish(ghost ? 0x062a20 : id === 'rimewraith' ? 0x0a1a34 : undefined);
  const base = painter.buf.clone();
  rimTopLeft(base, 0.32);
  if (ghost) ghostify(base, i, seed, GROUND[id]);
  if (id === 'rimewraith') frostify(base, i, seed, GROUND[id]);
  if (id === 'gloomshade') smokify(base, i, seed, GROUND[id]);
  if (state === 'death') {
    if (i === 0) {
      flash(base, 0.6);
      return base;
    }
    const dd = DEATH[id];
    const small = id === 'mite';
    if (i === 1 && n > 3) {
      // collapse frame: hairline cracks and a first spurt of ichor
      return shatter(base, 0.08, seed, dd.tint, small ? 8 : 14, small ? 0.6 : 0.9, {
        glint: false,
        drops: { color: dd.drop, count: Math.ceil(dd.drops / 3), groundY: GROUND[id] },
      });
    }
    const t = Math.pow((i - (n > 3 ? 1 : 0)) / (n - 1 - (n > 3 ? 1 : 0)), 1.25);
    return shatter(base, t * 0.96, seed, dd.tint, small ? 8 : 14, small ? 0.6 : 0.9, {
      glint: dd.glint,
      drops: { color: dd.drop, count: dd.drops, groundY: GROUND[id] },
    });
  }
  if (state === 'hit' && i === 0) flash(base, 0.8);
  if (state === 'attack' && pose.strike > 0.4) {
    // lunge smear (strong on the strike frame, a faint trailing echo on the next)
    const P = new Proj(base.w / 2, GROUND[id], VIEW_ANGLE[view]);
    const ranged = id === 'artillery' || id === 'hexer' || id === 'broodcaller' || id === 'rimewraith' || id === 'webweaver' || id === 'gloomshade';
    const k = (pose.strike > 0.8 ? 1 : 0.5) * (ranged ? 0.5 : 1);
    smear(base, -P.fx * 6 * k, -P.fy * 3 * k, SMEAR[id], pose.strike > 0.8 ? 2 : 1, Math.round(120 * k + 20));
  }
  if (state === 'windup' && (id === 'hexer' || id === 'artillery' || id === 'broodcaller' || id === 'guardian' || id === 'rimewraith' || id === 'gloomshade')) {
    const r = rng(seed);
    const col = id === 'hexer' || id === 'gloomshade' ? MATERIALS.hexViolet[3]! : id === 'artillery' ? MATERIALS.bile[3]! : id === 'guardian' ? MATERIALS.soulBlue[3]! : id === 'rimewraith' ? MATERIALS.glassCyan[3]! : MATERIALS.broodEgg[3]!;
    for (let k = 0; k < 1 + i; k++) sparkle(base, Math.round(base.w / 2 + (r() - 0.5) * 30), Math.round(GROUND[id] - 6 - r() * 26), col, 1, 220);
  }
  void lerp;
  return base;
}
