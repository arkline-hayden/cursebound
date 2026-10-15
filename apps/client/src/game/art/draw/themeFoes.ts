/**
 * Theme foes (content 1.5): the sky island, dead moon and server room rosters. Each is posed on the same 2.5D creature
 * rig as the catacomb foes (creatures.ts poses, outlines, rim light, death shatter, lunge smear), so every system that
 * treats enemy sprites (outlines, death bursts, knockback, flinch) applies unchanged. Pure (no DOM / Phaser).
 *
 *   sky:    harpy (Harpy Diver), galewisp (Gale Wisp), stormhawk (Storm-Hawk), cloudgolem (Cloud Golem)
 *   moon:   mooncrawler (Moon-spawn Crawler), moonleaper (Lunar Leaper), lunarsentry (Lunar Sentry),
 *           voidshambler (Void-Eyed Shambler)
 *   server: maintdrone (Maintenance Drone), firewall (Firewall Sentinel), glitchwraith (Glitch Wraith), malware
 *           (Malware Swarm)
 */
import { MATERIALS } from '../palette';
import { PixelBuffer, mix, rng, type FillOpts, type Ramp } from './pixel';
import { hull, type Part, type Pt } from './rig';
import type { CC } from './creatures';

export type ThemeFoeId =
  | 'harpy' | 'galewisp' | 'stormhawk' | 'cloudgolem'
  | 'mooncrawler' | 'moonleaper' | 'lunarsentry' | 'voidshambler'
  | 'maintdrone' | 'firewall' | 'glitchwraith' | 'malware';

export const THEME_FOE_IDS: readonly ThemeFoeId[] = [
  'harpy', 'galewisp', 'stormhawk', 'cloudgolem',
  'mooncrawler', 'moonleaper', 'lunarsentry', 'voidshambler',
  'maintdrone', 'firewall', 'glitchwraith', 'malware',
];

const ramp = (...c: number[]): Ramp => Object.freeze(c);

// ---------------------------------------------------------------- shape helpers (same as creatures.ts)

function blob(c: CC, segs: [number, number, number, number][], rmp: Ramp, opts: FillOpts = {}): void {
  const pts: { x: number; y: number }[] = [];
  for (const [f, r, z, rad] of segs) {
    const q = c.at(f, r, z);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      pts.push({ x: q.x + Math.cos(a) * rad, y: q.y + Math.sin(a) * rad * 0.92 });
    }
  }
  c.p.poly(hull(pts)).fill(rmp, opts);
}

function sphere(c: CC, f: number, r: number, z: number, rad: number, rmp: Ramp, opts: FillOpts = {}, ry = 0.92): Pt {
  const q = c.at(f, r, z);
  c.p.ellipse(q.x, q.y, rad, rad * ry).fill(rmp, { mode: 'sphere', ...opts });
  return q;
}

function limb(c: CC, a: Pt, b: Pt, r0: number, r1: number, rmp: Ramp, opts: FillOpts = {}): void {
  c.p.capsule(a.x, a.y, b.x, b.y, r0, r1).fill(rmp, { mode: 'cyl', ...opts });
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

const faces = (c: CC, k = -0.3): boolean => c.P.depthOf(1, 0) > k;

// ================================================================ THE SHATTERED SKYREACH

// ---------------------------------------------------------------- harpy: Harpy Diver (winged hag, hooked talons)

const HARPY = {
  wing: ramp(0x161a2a, 0x2a3450, 0x46587e, 0x7088ae, 0xa8bcd8),
  feather: ramp(0x1a1626, 0x342a44, 0x52426a, 0x7a6492),
  skin: ramp(0x4a3a3e, 0x8a7070, 0xc8a898, 0xead2c0),
  hair: ramp(0x0c0a12, 0x1c1828, 0x2e2a40, 0x464060),
  talon: MATERIALS.yellow,
  eye: MATERIALS.eyeRed,
};

function harpy(c: CC): Part[] {
  const { pose, P } = c;
  const C = HARPY;
  const parts: Part[] = [];
  const flap = Math.sin(pose.ph * 2 + 0.7);
  const dive = pose.strike, wind = pose.wind;
  const hover = 12 + Math.sin(pose.ph) * 1.1 - dive * 3.5 + wind * 2.5;
  const wz = wind > 0 ? 7 * wind : dive > 0.5 ? -2.5 : flap * 5.5;
  const spread = wind > 0 ? 1 - wind * 0.2 : dive > 0.5 ? 0.55 : 1;
  for (const sd of [-1, 1]) {
    parts.push({
      d: c.dep(-0.8, sd * 9) + (sd > 0 ? 0.1 : -0.1),
      draw: () => {
        const S = c.at(-0.4, sd * 2.2, hover + 7.5);
        const E = c.at(-1.2, sd * 8 * spread, hover + 10 + wz * 0.55);
        const T = c.at(-3.6, sd * 15 * spread, hover + 7 + wz);
        const M1 = c.at(-6.4, sd * 12 * spread, hover + 3.5 + wz * 0.75);
        const M2 = c.at(-7.6, sd * 7 * spread, hover + 2.4 + wz * 0.4);
        const B = c.at(-3.2, sd * 2.4, hover + 3.5);
        c.p.poly([S.x, S.y, E.x, E.y, T.x, T.y, M1.x, M1.y, M2.x, M2.y, B.x, B.y]).fill(C.wing, { mode: 'emboss', dither: true });
        // primaries: dark separated feather tips along the trailing edge
        for (let k = 0; k < 4; k++) {
          const t = k / 3;
          const a = { x: T.x + (M2.x - T.x) * t, y: T.y + (M2.y - T.y) * t };
          c.p.line(a.x, a.y, a.x - P.fx * 1.6 - sd * P.rx * 0.6, a.y + 2.2);
        }
        c.p.fill(C.feather, { mode: 'flat', tone: 1, inner: false });
        c.p.capsule(S.x, S.y, E.x, E.y, 1, 0.8).fill(C.feather, { mode: 'cyl', inner: false });
        c.p.px(E.x, E.y - 1, C.wing[4]!);
      },
    });
  }
  // scaly legs ending in hooked yellow talons (thrust forward on the dive)
  for (const sd of [-1, 1]) {
    parts.push({
      d: c.dep(0.5, sd * 2) - 0.3,
      draw: () => {
        const hip = c.at(-0.6, sd * 1.5, hover + 1.6);
        const knee = c.at(0.6 + dive * 2.4, sd * 1.8, hover - 1.6 + dive);
        const ft = c.at(0.2 + dive * 5, sd * 1.9, hover - 4.6 + dive * 2.2);
        limb(c, hip, knee, 1.3, 0.9, C.feather, { mode: 'emboss', dither: true });
        limb(c, knee, ft, 0.8, 0.6, C.talon, { mode: 'emboss' });
        for (const o of [-1, 0, 1]) c.p.line(ft.x, ft.y, ft.x + P.fx * 1.8 + o * 0.9, ft.y + 1.4 + Math.abs(o) * 0.3);
        c.p.fill(C.talon, { mode: 'flat', tone: 3, inner: false });
      },
    });
  }
  // feathered body with a pale chest and a fan of tail feathers
  parts.push({
    d: 0,
    draw: () => {
      for (const o of [-1, 0, 1]) {
        const a = c.at(-3, o * 0.8, hover + 2.4);
        const b = c.at(-7.4 - Math.abs(o) * 0.4, o * 2.6, hover + 0.4 - dive);
        c.p.capsule(a.x, a.y, b.x, b.y, 1.2, 0.5);
      }
      c.p.fill(C.wing, { mode: 'emboss', light: -0.1 });
      blob(c, [[0.6, 0, hover + 5.6, 3.5], [-1, 0, hover + 2.6, 2.9]], C.feather, { mode: 'sphere', dither: true });
      if (faces(c, -0.2)) {
        const ch = c.at(1.9, 0, hover + 5.4);
        c.p.ellipse(ch.x, ch.y, 1.9, 2.5).fill(C.skin, { mode: 'sphere', inner: false });
      }
    },
  });
  // head: a pale hag's face under a wild black mane, red eyes, a shriek when it strikes
  parts.push({
    d: c.dep(1.5, 0) + 0.3,
    draw: () => {
      const hz = hover + 11;
      const mane = rng(4127);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const base = c.at(0.6 + Math.cos(a) * 1.2, Math.sin(a) * 1.8, hz + 1.2);
        const tip = c.at(-3.4 - mane() * 2 - wind * 1.5, Math.sin(a) * 3.4, hz + 2.6 - k * 0.5 + Math.sin(pose.ph * 2 + k) * 0.6);
        c.p.capsule(base.x, base.y, tip.x, tip.y, 1.2, 0.4);
      }
      c.p.fill(C.hair, { mode: 'emboss', dither: true });
      sphere(c, 1.2, 0, hz, 2.7, C.skin, { light: 0.12 });
      if (faces(c)) {
        eye(c, 1.2, hz + 0.5, 2.5, 0.5, 0, C.eye[3]!, C.eye[1]!);
        eye(c, 1.2, hz + 0.5, 2.5, -0.5, 0, C.eye[3]!, C.eye[1]!);
        const m = c.at(3.6, 0, hz - 1);
        const open = dive > 0.3 || wind > 0.5;
        c.p.px(m.x, m.y, 0x2a0a10);
        if (open) c.p.px(m.x, m.y + 1, 0x2a0a10).px(m.x + 1, m.y, 0x2a0a10);
      }
    },
  });
  return parts;
}

// ---------------------------------------------------------------- galewisp: Gale Wisp (a knot of living wind)

const GALE = {
  air: ramp(0x3a6a8a, 0x6aa6c8, 0xa8dcf0, 0xe0f6ff, 0xffffff),
  core: ramp(0x5ab0d8, 0x9ae0f8, 0xd8f8ff, 0xffffff),
  leaf: MATERIALS.moss,
};

function galewisp(c: CC): Part[] {
  const { pose } = c;
  const C = GALE;
  const parts: Part[] = [];
  const w = pose.wind, st = pose.strike;
  const hover = 4 + Math.sin(pose.ph) * 1.4 + w * 1.5;
  const widen = 1 + w * 0.35 + st * 0.5;
  const spin = pose.ph * 2 + pose.frame * 0.9;
  // the funnel: stacked rings of wind, narrow at the foot, wide at the crown, each swaying on its own
  for (let k = 0; k < 7; k++) {
    const z = hover + k * 2.4;
    const R0 = (1.4 + k * 1.15) * widen;
    const sway = Math.sin(spin + k * 0.8) * (0.9 + k * 0.12);
    parts.push({
      d: -0.6 + k * 0.02,
      draw: () => {
        const q = c.at(sway * 0.4, sway, z);
        c.p.ellipse(q.x, q.y, R0, R0 * 0.45).minus().ellipse(q.x + Math.cos(spin + k) * 0.6, q.y - 0.5, Math.max(0.5, R0 - 1.2), Math.max(0.3, (R0 - 1.2) * 0.42));
        c.p.fill(C.air, { mode: 'flat', tone: k >= 5 ? 3 : 2, alpha: 150 + k * 12, inner: false });
        // a bright streak running round each ring
        const a = spin * (1 + k * 0.1) + k;
        c.p.px(q.x + Math.cos(a) * R0, q.y + Math.sin(a) * R0 * 0.45, C.air[4]!);
        c.p.px(q.x + Math.cos(a + 0.3) * R0, q.y + Math.sin(a + 0.3) * R0 * 0.45, C.air[3]!);
      },
    });
  }
  // the core: a bright eye of the storm with two pale eyes
  parts.push({
    d: 0.4,
    draw: () => {
      const q = c.at(0, 0, hover + 9);
      const r = 3 + w * 1.2 - st * 0.8;
      c.p.circle(q.x, q.y, r).fill(C.core, { mode: 'sphere', glow: C.core[1]!, light: 0.2, inner: false });
      if (faces(c, -0.6)) {
        c.p.gpx(q.x - 1 + c.P.fx, q.y, 0x0a2a3a, C.core[2]!).gpx(q.x + 1 + c.P.fx, q.y, 0x0a2a3a, C.core[2]!);
      }
    },
  });
  // debris caught in the wind: leaves and pebbles orbiting the funnel
  parts.push({
    d: 0.8,
    draw: () => {
      for (let k = 0; k < 4; k++) {
        const a = spin * 1.3 + (k / 4) * Math.PI * 2;
        const R = (5 + (k % 2) * 2.5) * widen;
        const q = c.at(Math.cos(a) * R * 0.6, Math.sin(a) * R, hover + 4 + k * 3);
        if (k % 2) c.p.ellipse(q.x, q.y, 1.3, 0.7).fill(C.leaf, { mode: 'sphere', inner: false });
        else c.p.circle(q.x, q.y, 0.8).fill(MATERIALS.stone, { mode: 'sphere', inner: false });
      }
      if (st > 0.3) {
        // the gust: wind streaks flung outward
        const q = c.at(0, 0, hover + 7);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + spin;
          const L = 6 + st * 10;
          c.p.line(q.x + Math.cos(a) * 4, q.y + Math.sin(a) * 2, q.x + Math.cos(a) * L, q.y + Math.sin(a) * L * 0.5);
        }
        c.p.fill(C.air, { mode: 'flat', tone: 3, alpha: 200, inner: false });
      }
    },
  });
  return parts;
}

// ---------------------------------------------------------------- stormhawk: Storm-Hawk (crackling raptor)

const HAWK = {
  wing: ramp(0x0e1024, 0x1e2448, 0x323c72, 0x50609e, 0x7c8cc8),
  belly: ramp(0x5a5470, 0x9a94b0, 0xd0cce0, 0xf4f2ff),
  beak: MATERIALS.yellow,
  spark: ramp(0x8a7a10, 0xe0c820, 0xfff060, 0xffffd0, 0xffffff),
  eye: MATERIALS.eyeYellow,
};

function stormhawk(c: CC): Part[] {
  const { pose, P } = c;
  const C = HAWK;
  const parts: Part[] = [];
  const flap = Math.sin(pose.ph * 2);
  const w = pose.wind, st = pose.strike;
  const hover = 15 + Math.sin(pose.ph) * 1.4 + w * 1.2 - st * 1.5;
  const wz = w > 0 ? 5 * w : st > 0.5 ? 1 : flap * 5;
  for (const sd of [-1, 1]) {
    parts.push({
      d: c.dep(-0.5, sd * 8) + (sd > 0 ? 0.1 : -0.1),
      draw: () => {
        const S = c.at(0.6, sd * 1.8, hover + 1.2);
        const E = c.at(0.2, sd * 7, hover + 2.4 + wz * 0.6);
        const T = c.at(-2.6, sd * 14, hover + 1 + wz);
        const M = c.at(-5.4, sd * 9.5, hover - 0.4 + wz * 0.6);
        const R = c.at(-3.4, sd * 2.2, hover - 0.4);
        c.p.poly([S.x, S.y, E.x, E.y, T.x, T.y, M.x, M.y, R.x, R.y]).fill(C.wing, { mode: 'emboss', dither: true });
        // jagged lightning streak along the wing
        const a = c.at(0, sd * 4, hover + 1.6 + wz * 0.4), b = c.at(-1.4, sd * 8, hover + 1 + wz * 0.7), d = c.at(-2.4, sd * 11.5, hover + 0.8 + wz * 0.9);
        c.p.line(a.x, a.y, b.x, b.y + 1).line(b.x, b.y + 1, d.x, d.y);
        c.p.fill(C.spark, { mode: 'flat', tone: 2, glow: C.spark[1]!, inner: false });
        if ((pose.frame + (sd > 0 ? 1 : 0)) % 2 === 0 || w > 0.3) c.p.gpx(T.x, T.y, C.spark[4]!, C.spark[2]!);
      },
    });
  }
  parts.push({
    d: 0,
    draw: () => {
      // tail fan
      const t0 = c.at(-3, 0, hover), t1 = c.at(-7, -1.8, hover - 0.8), t2 = c.at(-7.4, 1.8, hover - 0.8);
      c.p.poly([t0.x, t0.y, t1.x, t1.y, t2.x, t2.y]).fill(C.wing, { mode: 'emboss' });
      blob(c, [[1.6, 0, hover + 0.6, 2.8], [-1.6, 0, hover, 2.3]], C.wing, { mode: 'sphere', dither: true, light: 0.05 });
      if (faces(c, -0.1)) { const b = c.at(1.6, 0, hover - 0.6); c.p.ellipse(b.x, b.y, 1.6, 1.4).fill(C.belly, { mode: 'sphere', inner: false }); }
    },
  });
  parts.push({
    d: c.dep(4, 0) + 0.3,
    draw: () => {
      const hz = hover + 1.8;
      sphere(c, 4, 0, hz, 2.2, C.wing, { dither: true, light: 0.1 });
      // hooked yellow beak
      const b0 = c.at(5.6, 0, hz - 0.2), b1 = c.at(7 + st, 0, hz - 1.4);
      c.p.poly([b0.x, b0.y - 1, b0.x, b0.y + 1, b1.x, b1.y]).fill(C.beak, { mode: 'emboss', inner: false });
      eye(c, 4, hz + 0.4, 2, 0.6, 0, C.eye[3]!, C.eye[1]!);
      eye(c, 4, hz + 0.4, 2, -0.6, 0, C.eye[3]!, C.eye[1]!);
      // crackling crest
      const cr = c.at(3.2, 0, hz + 2.4);
      c.p.gpx(cr.x - P.fx, cr.y, C.spark[3]!, C.spark[1]!);
    },
  });
  if (w > 0.4 || st > 0.4) {
    parts.push({
      d: 2,
      draw: () => {
        // static gathering in the beak / the bolt leaving it
        const q = c.at(7.2, 0, hover + 0.6);
        const r = rng(911 + pose.frame);
        for (let k = 0; k < 4; k++) c.p.gpx(q.x + (r() - 0.5) * 5, q.y + (r() - 0.5) * 4, C.spark[4]!, C.spark[2]!);
        if (st > 0.6) c.p.line(q.x, q.y, q.x + P.fx * 8, q.y + P.fy * 4).fill(C.spark, { mode: 'flat', tone: 3, glow: C.spark[2]!, inner: false });
      },
    });
  }
  return parts;
}

// ---------------------------------------------------------------- cloudgolem: Cloud Golem (storm cloud + floating rock)

const GOLEM = {
  cloud: ramp(0x4a5468, 0x7c889e, 0xb4bed0, 0xe2e8f2, 0xffffff),
  rock: ramp(0x1e1c22, 0x3a3640, 0x5e5866, 0x8a8494, 0xb4aebe),
  eye: MATERIALS.soulBlue,
  bolt: ramp(0x6a6a20, 0xd8d84a, 0xffff9a, 0xffffff),
};

function cloudgolem(c: CC): Part[] {
  const { pose } = c;
  const C = GOLEM;
  const parts: Part[] = [];
  const w = pose.wind, st = pose.strike;
  const s = Math.sin(pose.ph);
  const bob = pose.moving ? Math.abs(s) * 1.2 : Math.sin(pose.ph) * 0.6;
  const bodyZ = 20 + bob - st * 3;
  // heavy cloud legs (alternating stride)
  for (const sd of [-1, 1]) {
    const ph = pose.ph + (sd > 0 ? Math.PI : 0);
    const fwd = pose.moving ? Math.sin(ph) * 4 : 0;
    const lift = pose.moving ? Math.max(0, Math.cos(ph)) * 2 : 0;
    parts.push({
      d: c.dep(0, sd * 5) - 0.5,
      draw: () => {
        blob(c, [[fwd * 0.4, sd * 4.4, bodyZ - 6, 4], [fwd, sd * 4.6, 3.5 + lift, 3.6]], C.cloud, { mode: 'sphere', dither: true });
        const f = c.g(fwd + 1, sd * 4.6, lift);
        c.p.ellipse(f.x, f.y - 1, 3.4, 1.8).fill(C.rock, { mode: 'facet', facets: 5 });
      },
    });
  }
  // the billowing cloud torso with lightning flickering inside
  parts.push({
    d: 0,
    draw: () => {
      const r = rng(2203);
      const segs: [number, number, number, number][] = [[0, 0, bodyZ + 4, 8.5], [-1.5, 0, bodyZ - 1, 7.6]];
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; segs.push([Math.cos(a) * 4, Math.sin(a) * 6, bodyZ + 3 + r() * 5, 3.4 + r() * 1.6]); }
      blob(c, segs, C.cloud, { mode: 'sphere', dither: true, light: 0.05 });
      // puffs boiling on the surface
      for (let k = 0; k < 5; k++) {
        const a = r() * Math.PI * 2;
        const q = c.at(Math.cos(a) * 5, Math.sin(a) * 6.5, bodyZ + 2 + r() * 7);
        c.p.circle(q.x, q.y, 2 + r() * 1.5);
      }
      c.p.fill(C.cloud, { mode: 'sphere', light: 0.2, inner: false });
      // lightning in the belly
      if ((pose.frame % 2 === 0) || w > 0.3 || st > 0.3) {
        const a = c.at(1.5, -2, bodyZ + 6), b = c.at(2, 0, bodyZ + 2.5), d = c.at(1.2, 2.4, bodyZ - 0.5);
        c.p.line(a.x, a.y, b.x, b.y).line(b.x, b.y, d.x, d.y).fill(C.bolt, { mode: 'flat', tone: 2, glow: C.bolt[1]!, inner: false });
      }
    },
  });
  // boulder shoulders, floating just off the cloud, and cloud arms ending in rock fists
  for (const sd of [-1, 1]) {
    parts.push({
      d: c.dep(0.5, sd * 10) + 0.2,
      draw: () => {
        const sh = c.at(0, sd * 8.6, bodyZ + 9 + Math.sin(pose.ph * 2 + sd) * 0.8);
        c.p.ellipse(sh.x, sh.y, 4.2, 3.6).fill(C.rock, { mode: 'facet', facets: 6, rot: sd });
        const raise = w * 13 - st * 6;
        const fist = c.at(3 + st * 5 + (pose.moving ? Math.sin(pose.ph + (sd > 0 ? 0 : Math.PI)) * 2 : 0), sd * 9.6, bodyZ - 3 + raise);
        const elbow = c.at(1.5 + st * 2, sd * 10.4, bodyZ + 3 + raise * 0.5);
        blob(c, [[0.5, sd * 9.2, bodyZ + 6.5, 3], [1.5 + st * 2, sd * 10.4, bodyZ + 3 + raise * 0.5, 2.8]], C.cloud, { mode: 'sphere', dither: true });
        void elbow;
        c.p.ellipse(fist.x, fist.y, 3.8, 3.4).fill(C.rock, { mode: 'facet', facets: 5, rot: sd * 0.5 });
        if (st > 0.5) c.p.gpx(fist.x, fist.y + 3, C.bolt[3]!, C.bolt[1]!);
      },
    });
  }
  // a small rock head sunk into the cloud with two cold blue eyes
  parts.push({
    d: c.dep(3, 0) + 0.4,
    draw: () => {
      const hz = bodyZ + 12.5;
      const q = c.at(1.5, 0, hz);
      c.p.ellipse(q.x, q.y, 3.6, 3.2).fill(C.rock, { mode: 'facet', facets: 6 });
      if (faces(c)) {
        const hot = w > 0.4 || st > 0.3;
        eye(c, 1.5, hz, 3, 0.55, 0.2, hot ? C.eye[4]! : C.eye[3]!, C.eye[2]!);
        eye(c, 1.5, hz, 3, -0.55, 0.2, hot ? C.eye[4]! : C.eye[3]!, C.eye[2]!);
      }
    },
  });
  return parts;
}

// ================================================================ THE DEAD MOON

// ---------------------------------------------------------------- mooncrawler: Moon-spawn Crawler (pale regolith grub)

const CRAWLER = {
  grub: ramp(0x4a4458, 0x7e7690, 0xb8b0c8, 0xe2dcee, 0xfaf8ff),
  leg: ramp(0x1a1622, 0x2e2838, 0x4a4256, 0x6a607a),
  acid: MATERIALS.lime,
};

function mooncrawler(c: CC): Part[] {
  const { pose, P } = c;
  const C = CRAWLER;
  const parts: Part[] = [];
  const w = pose.wind, st = pose.strike;
  const rear = w * 3.5 - st * 1;
  const segs = [4.6, 1.6, -1.5, -4.4];
  // many short legs, rippling
  for (const sd of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const f = segs[k]!;
      const ph = pose.ph * 2 + k * 0.9 + (sd > 0 ? Math.PI : 0);
      parts.push({
        d: c.dep(f, sd * 3) - 0.3,
        draw: () => {
          const a = c.at(f, sd * 2, 2.8 + (k === 0 ? rear * 0.6 : 0));
          const b = c.g(f + (pose.moving ? Math.sin(ph) * 1.5 : 0), sd * 4.6, pose.moving ? Math.max(0, Math.cos(ph)) * 1 : 0);
          c.p.capsule(a.x, a.y, b.x, b.y, 0.75, 0.5).fill(C.leg, { mode: 'cyl', inner: false });
        },
      });
    }
  }
  // segmented body: four soft segments, the head reared up on the wind-up
  parts.push({
    d: 0,
    draw: () => {
      for (let k = 3; k >= 0; k--) {
        const f = segs[k]! + (k === 0 ? st * 1.6 : 0);
        const z = 3.6 + (k === 0 ? rear : k === 1 ? rear * 0.4 : 0) + (pose.moving ? Math.sin(pose.ph * 2 + k) * 0.5 : 0);
        sphere(c, f, 0, z, 3.4 - k * 0.3, C.grub, { dither: true, light: 0.1 });
      }
    },
  });
  // head: black eye dots and an acid-green maw
  parts.push({
    d: c.dep(5, 0) + 0.3,
    draw: () => {
      if (!faces(c, -0.4)) return;
      const hf = segs[0]! + st * 1.6, hz = 3.6 + rear;
      for (const th of [-0.6, -0.25, 0.25, 0.6]) {
        if (c.P.depthOf(Math.cos(th), Math.sin(th)) < 0.05) continue;
        const e = c.at(hf + Math.cos(th) * 2.9, Math.sin(th) * 2.9, hz + 1.1);
        c.p.px(e.x, e.y, 0x0a0812);
      }
      const m = c.at(hf + 3.2, 0, hz - 0.8);
      c.p.gpx(m.x, m.y, w > 0.3 || st > 0.3 ? C.acid[4]! : C.acid[3]!, C.acid[2]!);
      if (st > 0.3) c.p.gpx(m.x + P.fx, m.y + 1, C.acid[3]!, C.acid[2]!);
    },
  });
  return parts;
}

// ---------------------------------------------------------------- moonleaper: Lunar Leaper (long-legged low-g hunter)

const LEAPER = {
  skin: ramp(0x1e2432, 0x3a4458, 0x5e6c84, 0x8e9cb4, 0xc0cce0),
  crest: ramp(0x101420, 0x1e2436, 0x2e3650, 0x464e6e),
  eye: ramp(0x0a1a3a, 0x1a4a8a, 0x5aa8ff, 0xd0ecff, 0xffffff),
  claw: MATERIALS.boneDry,
};

function moonleaper(c: CC): Part[] {
  const { pose } = c;
  const C = LEAPER;
  const parts: Part[] = [];
  const w = pose.wind, st = pose.strike;
  const crouch = w * 3.5 - st * 3;
  const hop = pose.moving ? Math.max(0, Math.sin(pose.ph)) * 3 : 0;
  const bodyZ = 9 - crouch + hop;
  // long folded hind legs: thigh high, shin back down to big flat feet
  for (const sd of [-1, 1]) {
    parts.push({
      d: c.dep(-2, sd * 3.5) - 0.3,
      draw: () => {
        const hip = c.at(-2.2, sd * 2.4, bodyZ);
        const knee = c.at(1.6 + w * 1.2, sd * 3.6, bodyZ + 3 - crouch * 0.3 + st * 1.5);
        const ankle = c.g(-3.4 + st * 2, sd * 3.4, 2 + hop * 0.6);
        const toe = c.g(-0.6 + st * 2, sd * 3.6, hop * 0.5);
        limb(c, hip, knee, 2, 1.3, C.skin, { mode: 'emboss', dither: true });
        limb(c, knee, ankle, 1.2, 0.8, C.skin, { mode: 'emboss' });
        limb(c, ankle, toe, 0.9, 0.7, C.crest, { mode: 'emboss' });
      },
    });
  }
  // lean torso tilted forward, ridge of dark crest plates on the spine
  parts.push({
    d: 0,
    draw: () => {
      blob(c, [[1.4, 0, bodyZ + 3.2, 3.2], [-1.8, 0, bodyZ + 1, 3.4]], C.skin, { mode: 'sphere', dither: true, light: 0.04 });
      for (let k = 0; k < 4; k++) {
        const q = c.at(1.4 - k * 1.4, 0, bodyZ + 5.4 - k * 0.6);
        c.p.poly([q.x - 1, q.y + 0.5, q.x + 1, q.y + 0.5, q.x, q.y - 1.6]);
      }
      c.p.fill(C.crest, { mode: 'emboss' });
    },
  });
  // thin forearms with hooked claws (rake on the strike)
  for (const sd of [-1, 1]) {
    parts.push({
      d: c.dep(2, sd * 3) + 0.1,
      draw: () => {
        const sh = c.at(2, sd * 2.2, bodyZ + 3.5);
        const hand = c.at(3.6 + st * 4 + w * 0.5, sd * (2.6 - st), bodyZ - 1 + st * 2 + w * 1.5);
        limb(c, sh, hand, 0.9, 0.7, C.skin, { mode: 'emboss' });
        for (const o of [-0.8, 0.8]) c.p.line(hand.x, hand.y, hand.x + c.P.fx * 1.6 + o * 0.5, hand.y + 1.2);
        c.p.fill(C.claw, { mode: 'flat', tone: 3, inner: false });
      },
    });
  }
  // big head with huge glassy black eyes
  parts.push({
    d: c.dep(4, 0) + 0.3,
    draw: () => {
      const hz = bodyZ + 6;
      sphere(c, 3.6, 0, hz, 3, C.skin, { light: 0.12 });
      if (faces(c, -0.2)) {
        for (const th of [0.55, -0.55]) {
          if (c.P.depthOf(Math.cos(th), Math.sin(th)) < 0.02) continue;
          const e = c.at(3.6 + Math.cos(th) * 2.4, Math.sin(th) * 2.4, hz + 0.4);
          c.p.ellipse(e.x, e.y, 1.3, 1.1).fill(ramp(0x020306, 0x060a12, 0x0c1424, 0x18243a), { mode: 'sphere', inner: false });
          c.p.gpx(e.x - 0.5, e.y - 0.5, C.eye[3]!, C.eye[2]!);
        }
      }
    },
  });
  return parts;
}

// ---------------------------------------------------------------- lunarsentry: Lunar Sentry (old lander drone)

const SENTRY = {
  foil: ramp(0x5a3a0a, 0x9a6a14, 0xd8a430, 0xf8d878, 0xfff4c8),
  hull: ramp(0x5a5e6a, 0x9aa0ae, 0xd0d6e0, 0xf2f4f8, 0xffffff),
  leg: ramp(0x2a2a30, 0x4a4a54, 0x707080, 0x9a9aaa),
  lens: MATERIALS.eyeRed,
  jet: MATERIALS.orangeGlow,
};

function lunarsentry(c: CC): Part[] {
  const { pose, P } = c;
  const C = SENTRY;
  const parts: Part[] = [];
  const w = pose.wind, st = pose.strike;
  const hover = 9 + Math.sin(pose.ph) * 1.2 - st * 0.8;
  const tilt = pose.moving ? 0.8 : 0;
  // three spindly folded landing legs with pads
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    parts.push({
      d: c.dep(Math.cos(a) * 5, Math.sin(a) * 5) - 0.5,
      draw: () => {
        const top = c.at(Math.cos(a) * 3, Math.sin(a) * 3, hover + 1);
        const knee = c.at(Math.cos(a) * 6, Math.sin(a) * 6, hover - 1.5);
        const pad = c.at(Math.cos(a) * 5.2, Math.sin(a) * 5.2, hover - 4.5);
        c.p.line(top.x, top.y, knee.x, knee.y).line(knee.x, knee.y, pad.x, pad.y).fill(C.leg, { mode: 'flat', tone: 2, inner: false });
        c.p.ellipse(pad.x, pad.y, 1.4, 0.7).fill(C.leg, { mode: 'sphere', inner: false });
      },
    });
  }
  // thruster glow underneath (flickers)
  parts.push({
    d: -0.2,
    draw: () => {
      const q = c.at(0, 0, hover - 2.5);
      const fl = pose.frame % 2;
      c.p.ellipse(q.x, q.y + 1 + fl, 1.6, 2.4 + fl).fill(C.jet, { mode: 'flat', tone: 2, glow: C.jet[1]!, alpha: 220, inner: false });
      c.p.gpx(q.x, q.y, C.jet[4]!, C.jet[2]!);
    },
  });
  // gold-foil descent stage and the white ascent module on top
  parts.push({
    d: 0,
    draw: () => {
      const b = c.at(-tilt, 0, hover + 2);
      c.p.ellipse(b.x, b.y, 5.6, 4.4).fill(C.foil, { mode: 'facet', facets: 8, rot: 0.4, light: 0.05 });
      const r = rng(331);
      for (let k = 0; k < 6; k++) c.p.px(b.x + (r() - 0.5) * 8, b.y + (r() - 0.5) * 5, C.foil[4]!);
      const m = c.at(-tilt * 0.5, 0, hover + 6.5);
      c.p.poly([m.x - 3.6, m.y + 2, m.x + 3.6, m.y + 2, m.x + 2.8, m.y - 2.6, m.x - 2.8, m.y - 2.6]).fill(C.hull, { mode: 'emboss', light: 0.1 });
      // panel seams
      c.p.px(m.x - 1, m.y - 1, C.hull[1]!).px(m.x + 1, m.y, C.hull[1]!);
    },
  });
  // dish antenna and the red survey lens
  parts.push({
    d: c.dep(3, 0) + 0.3,
    draw: () => {
      const tz = hover + 9.5;
      const mast = c.at(-1 - tilt, 0, hover + 8.5), dish = c.at(-1.6 - tilt, 0, tz + 1.5);
      c.p.line(mast.x, mast.y, dish.x, dish.y).fill(C.leg, { mode: 'flat', tone: 3, inner: false });
      const ang = pose.frame * 0.3 + w * 1.5;
      c.p.ellipse(dish.x, dish.y, 2.6, 1.2 + Math.abs(Math.sin(ang)) * 0.6).fill(C.hull, { mode: 'sphere', inner: false });
      if (faces(c, -0.5)) {
        const l = c.at(3.4, 0, hover + 5.5);
        const hot = w > 0.3 || st > 0.3;
        c.p.circle(l.x, l.y, 1.5).fill(C.leg, { mode: 'sphere', inner: false });
        c.p.gpx(l.x, l.y, hot ? C.lens[4]! : C.lens[3]!, C.lens[2]!);
        if (st > 0.5) c.p.line(l.x, l.y, l.x + P.fx * 7, l.y + P.fy * 3.5).fill(C.lens, { mode: 'flat', tone: 3, glow: C.lens[2]!, inner: false });
      }
    },
  });
  return parts;
}

// ---------------------------------------------------------------- voidshambler: Void-Eyed Shambler (suited corpse)

const SHAMBLER = {
  suit: ramp(0x4a4a50, 0x84848c, 0xbcbcc4, 0xe6e6ea, 0xffffff),
  grime: ramp(0x2a2620, 0x4a4234, 0x6e6450, 0x968a70),
  pack: ramp(0x2e3036, 0x50545e, 0x787e8a, 0xa4aab6),
  void: ramp(0x000000, 0x050208, 0x0c0614, 0x180c28),
  glint: MATERIALS.hexViolet,
};

function voidshambler(c: CC): Part[] {
  const { pose } = c;
  const C = SHAMBLER;
  const parts: Part[] = [];
  const w = pose.wind, st = pose.strike;
  const s = Math.sin(pose.ph);
  const limp = pose.moving ? Math.max(0, s) * 1.6 : 0;
  const hipZ = 12 - limp * 0.4;
  // heavy boots and suit legs (a dragging limp)
  for (const sd of [-1, 1]) {
    const ph = pose.ph + (sd > 0 ? Math.PI : 0);
    const fwd = pose.moving ? Math.sin(ph) * (sd > 0 ? 2.4 : 3.4) : 0;
    parts.push({
      d: c.dep(0, sd * 3) - 0.4,
      draw: () => {
        const hip = c.at(0, sd * 2.6, hipZ);
        const knee = c.at(fwd * 0.5 + 0.6, sd * 2.8, 6.4);
        const ft = c.g(fwd, sd * 2.8, pose.moving ? Math.max(0, Math.cos(ph)) * 1 : 0);
        limb(c, hip, knee, 2.2, 1.9, C.suit, { mode: 'cyl', dither: true });
        limb(c, knee, { x: ft.x, y: ft.y - 2, d: 0 }, 1.9, 1.8, C.suit, { mode: 'cyl' });
        c.p.ellipse(ft.x + c.P.fx * 0.8, ft.y - 1, 2.4, 1.6).fill(C.grime, { mode: 'sphere' });
      },
    });
  }
  // life-support pack on the back
  parts.push({
    d: c.dep(-4, 0),
    draw: () => {
      const q = c.at(-3.6, 0, hipZ + 7);
      c.p.poly([q.x - 4, q.y + 4, q.x + 4, q.y + 4, q.x + 3.6, q.y - 4.4, q.x - 3.6, q.y - 4.4]).fill(C.pack, { mode: 'emboss' });
      c.p.px(q.x - 2, q.y - 2, 0x4aff7a).px(q.x + 1, q.y - 2, 0xff4a3a);
    },
  });
  // bulky suit torso, grimy and torn
  parts.push({
    d: 0,
    draw: () => {
      blob(c, [[0.4 + w * -0.6, 0, hipZ + 4.5, 4.6], [0, 0, hipZ + 8.4, 4.8]], C.suit, { mode: 'sphere', dither: true, light: 0.04 });
      const r = rng(77);
      for (let k = 0; k < 5; k++) { const q = c.at(1.5 + r() * 2, (r() - 0.5) * 7, hipZ + 3 + r() * 6); c.p.px(q.x, q.y, C.grime[1]!); }
      if (faces(c, -0.2)) { const b = c.at(4, 0, hipZ + 6.5); c.p.px(b.x, b.y, 0x3a6aff).px(b.x + 1, b.y, 0xffd040); }
    },
  });
  // stiff arms reaching (swing on the strike)
  for (const sd of [-1, 1]) {
    parts.push({
      d: c.dep(2, sd * 5) + 0.2,
      draw: () => {
        const sh = c.at(0.4, sd * 4.8, hipZ + 9.5);
        const reach = 3.5 + st * 3.5 - w * 2;
        const hand = c.at(reach + 1, sd * (4.4 - st * 1.6), hipZ + 6 + st * 2 + w * 3 + (pose.moving ? Math.sin(pose.ph + sd) * 0.6 : 0));
        limb(c, sh, hand, 1.8, 1.5, C.suit, { mode: 'cyl', dither: true });
        c.p.circle(hand.x, hand.y, 1.4).fill(C.grime, { mode: 'sphere', inner: false });
      },
    });
  }
  // dented helmet with the black void where the visor was
  parts.push({
    d: c.dep(1.5, 0) + 0.4,
    draw: () => {
      const tip = w * -1.2;
      const hz = hipZ + 14;
      sphere(c, 0.6 + tip, 0, hz, 4.2, C.suit, { light: 0.2 });
      if (faces(c, -0.35)) {
        const fd = c.P.depthOf(1, 0);
        const v = c.at(3 + tip, 0, hz - 0.2);
        const rx = 1.6 + 1.8 * Math.max(0, fd);
        c.p.ellipse(v.x, v.y, rx, 2.4).fill(C.void, { mode: 'flat', tone: 0, inner: false });
        // cold stars drifting in the void, and a violet glint that flares on the wind-up
        const r = rng(155 + pose.frame);
        for (let k = 0; k < 3; k++) c.p.px(v.x + (r() - 0.5) * rx * 1.4, v.y + (r() - 0.5) * 3, 0xc8c0ff, 200);
        c.p.gpx(v.x - rx * 0.4, v.y - 1, w > 0.3 ? C.glint[4]! : C.glint[3]!, C.glint[2]!);
      }
    },
  });
  return parts;
}

// ================================================================ THE CURSED DATAVAULT

// ---------------------------------------------------------------- maintdrone: Maintenance Drone (corrupted repair drone)

const DRONE = {
  casing: ramp(0x1a2a30, 0x2e4a54, 0x4a7280, 0x78a4b0, 0xb0d4dc),
  stripe: MATERIALS.yellow,
  rotor: ramp(0x5a6a70, 0x8a9aa0, 0xbccad0, 0xe6f0f2),
  weld: ramp(0x3a6aaa, 0x8ac8ff, 0xdff4ff, 0xffffff),
  eye: MATERIALS.eyeRed,
};

function maintdrone(c: CC): Part[] {
  const { pose, P } = c;
  const C = DRONE;
  const parts: Part[] = [];
  const w = pose.wind, st = pose.strike;
  const hover = 10 + Math.sin(pose.ph * 2) * 1 + w * 1.2 - st * 1.5;
  const tilt = (pose.moving ? 1 : 0) + st * 1.2;
  // rotor arms with blurred rotor discs
  for (const [rf, rr] of [[2.8, -4.4], [2.8, 4.4], [-3, -4.4], [-3, 4.4]] as const) {
    parts.push({
      d: c.dep(rf, rr) - 0.1,
      draw: () => {
        const hub = c.at(rf * 0.4, rr * 0.4, hover + 2);
        const end = c.at(rf, rr, hover + 2.6 - (rf > 0 ? tilt : -tilt) * 0.4);
        c.p.line(hub.x, hub.y, end.x, end.y).fill(C.casing, { mode: 'flat', tone: 1, inner: false });
        const spin = pose.frame % 2;
        c.p.ellipse(end.x, end.y - 0.5, 3, 1.2).fill(C.rotor, { mode: 'flat', tone: 2 + spin, alpha: 120, inner: false });
        c.p.px(end.x, end.y - 0.5, C.rotor[3]!);
      },
    });
  }
  // boxy chassis with a hazard stripe
  parts.push({
    d: 0,
    draw: () => {
      const q = c.at(0, 0, hover);
      c.p.poly([q.x - 4.4, q.y + 3, q.x + 4.4, q.y + 3, q.x + 3.9, q.y - 2.8, q.x - 3.9, q.y - 2.8]).fill(C.casing, { mode: 'emboss', light: 0.1 });
      for (let k = -2; k <= 2; k += 2) c.p.px(q.x + k, q.y + 1, C.stripe[2]!).px(q.x + k + 1, q.y + 1, 0x1a1a1a);
    },
  });
  // camera eye and the welder arm that darts out on the strike
  parts.push({
    d: c.dep(3, 0) + 0.3,
    draw: () => {
      if (faces(c, -0.4)) {
        const e = c.at(3, 0, hover + 0.4);
        c.p.circle(e.x, e.y, 1.3).fill(ramp(0x0a0a0e, 0x1a1a22, 0x2a2a36, 0x3a3a4a), { mode: 'sphere', inner: false });
        c.p.gpx(e.x, e.y, w > 0.3 || st > 0.3 ? C.eye[4]! : C.eye[3]!, C.eye[2]!);
      }
      const base = c.at(2, 1.6, hover - 1.8);
      const tip = c.at(3.4 + st * 4.5 - w, 1.4, hover - 3 + st * 1.5);
      c.p.line(base.x, base.y, tip.x, tip.y).fill(C.rotor, { mode: 'flat', tone: 1, inner: false });
      const hot = w > 0.2 || st > 0.2;
      c.p.gpx(tip.x, tip.y, hot ? C.weld[3]! : C.weld[1]!, C.weld[1]!);
      if (st > 0.5) {
        const r = rng(19 + pose.frame);
        for (let k = 0; k < 5; k++) c.p.gpx(tip.x + P.fx * r() * 3 + (r() - 0.5) * 3, tip.y + (r() - 0.3) * 3, C.weld[3]!, C.weld[1]!);
      }
    },
  });
  return parts;
}

// ---------------------------------------------------------------- firewall: Firewall Sentinel (rack construct + shield wall)

const FIREWALL = {
  steel: ramp(0x0e1016, 0x1e222c, 0x343a48, 0x525a6c, 0x7a8496),
  fire: ramp(0x5a1004, 0xb43a0a, 0xff7a1e, 0xffc860, 0xfff4c0),
  hex: ramp(0x3a0c04, 0x7a2008, 0xc84a12, 0xff8a2a),
  led: ramp(0x0a3a1a, 0x16803a, 0x3ae86a, 0xb0ffc8),
  eye: MATERIALS.amberGold,
};

function firewall(c: CC): Part[] {
  const { pose, P } = c;
  const C = FIREWALL;
  const parts: Part[] = [];
  const w = pose.wind, st = pose.strike;
  const step = pose.moving ? Math.abs(Math.sin(pose.ph)) * 1 : 0;
  const bodyZ = 8 + step;
  // stubby tread blocks
  for (const sd of [-1, 1]) {
    const fwd = pose.moving ? Math.sin(pose.ph + (sd > 0 ? Math.PI : 0)) * 1.6 : 0;
    parts.push({
      d: c.dep(0, sd * 4) - 0.4,
      draw: () => {
        const q = c.g(fwd, sd * 4, 2);
        c.p.poly([q.x - 3.4, q.y + 2.4, q.x + 3.4, q.y + 2.4, q.x + 3, q.y - 2.8, q.x - 3, q.y - 2.8]).fill(C.steel, { mode: 'emboss' });
        c.p.px(q.x - 1, q.y, C.steel[4]!).px(q.x + 1, q.y, C.steel[4]!);
      },
    });
  }
  // the rack body: a tall steel cabinet with blinking LED rows and a cyclops sensor
  parts.push({
    d: 0,
    draw: () => {
      const bot = c.at(-1, 0, bodyZ), top = c.at(-1.4, 0, bodyZ + 17);
      const hw = 6.2;
      c.p.poly([bot.x - hw, bot.y + 2, bot.x + hw, bot.y + 2, top.x + hw * 0.9, top.y, top.x - hw * 0.9, top.y]).fill(C.steel, { mode: 'emboss', dither: true });
      for (let row = 0; row < 4; row++) {
        const q = c.at(-1.2, 0, bodyZ + 3.5 + row * 3.4);
        for (let k = -2; k <= 2; k++) {
          const on = (row * 3 + k + pose.frame) % 3 !== 0;
          c.p.px(q.x + k * 2, q.y, on ? C.led[3]! : C.led[0]!);
        }
      }
      if (faces(c, -0.6)) {
        const e = c.at(1, 0, bodyZ + 15);
        c.p.ellipse(e.x, e.y, 2.6, 1).fill(ramp(0x0a0806, 0x1a1410, 0x2a2018, 0x3a2c20), { mode: 'flat', tone: 1, inner: false });
        c.p.gpx(e.x + P.fx, e.y, w > 0.3 ? C.eye[3]! : C.eye[2]!, C.eye[1]!);
      }
    },
  });
  // the burning shield wall carried in front (thrust forward on the bash, flaring on the wind-up)
  parts.push({
    d: c.dep(5, 0) + 0.5,
    draw: () => {
      const f = 4.6 + st * 2.6 - w * 0.6;
      const lz = bodyZ + 1, hz = bodyZ + 14;
      const a = c.at(f, -6, lz), b = c.at(f, 6, lz), d = c.at(f, 6, hz), e = c.at(f, -6, hz);
      c.p.poly([a.x, a.y, b.x, b.y, d.x, d.y, e.x, e.y]).fill(C.hex, { mode: 'emboss', light: 0.1 + w * 0.2, alpha: 230 });
      // hex grid lines
      for (let k = 1; k < 4; k++) {
        const t = k / 4;
        const l0 = { x: a.x + (e.x - a.x) * t, y: a.y + (e.y - a.y) * t }, l1 = { x: b.x + (d.x - b.x) * t, y: b.y + (d.y - b.y) * t };
        c.p.line(l0.x, l0.y, l1.x, l1.y);
      }
      c.p.fill(C.fire, { mode: 'flat', tone: 2, glow: C.fire[1]!, inner: false, alpha: 210 });
      // flames licking off the top edge
      const r = rng(613 + pose.frame);
      for (let k = 0; k <= 5; k++) {
        const t = k / 5;
        const q = { x: e.x + (d.x - e.x) * t, y: e.y + (d.y - e.y) * t };
        const hgt = 1.5 + r() * 2.5 + w * 2;
        c.p.poly([q.x - 1, q.y, q.x + 1, q.y, q.x + (r() - 0.5), q.y - hgt]);
      }
      c.p.fill(C.fire, { mode: 'flat', tone: 3, glow: C.fire[2]!, inner: false });
    },
  });
  return parts;
}

// ---------------------------------------------------------------- glitchwraith: Glitch Wraith (ghost in the machine)

const GLITCH = {
  shroud: ramp(0x04060e, 0x0a1022, 0x141e3a, 0x223258, 0x34507e),
  cyan: ramp(0x0a4a5a, 0x1aa0b8, 0x4ae8ff, 0xc0faff, 0xffffff),
  magenta: MATERIALS.magenta,
};

function glitchwraith(c: CC): Part[] {
  const { pose } = c;
  const C = GLITCH;
  const parts: Part[] = [];
  const w = pose.wind, st = pose.strike;
  const hover = 7 + Math.sin(pose.ph) * 1.5 + w * 1.5;
  const sway = Math.sin(pose.ph + 1) * 1.2;
  // trailing pixel blocks instead of legs (data falling away)
  parts.push({
    d: -0.8,
    draw: () => {
      const r = rng(4049 + pose.frame);
      for (let k = 0; k < 9; k++) {
        const q = c.at(-1 - sway * 0.5 + (r() - 0.5) * 3, (r() - 0.5) * 7, hover - 1 - r() * 6);
        const s = r() < 0.4 ? 2 : 1;
        c.p.rect(Math.round(q.x), Math.round(q.y), s, s);
      }
      c.p.fill(C.cyan, { mode: 'flat', tone: 1, inner: false, alpha: 200 });
    },
  });
  // the hooded shroud
  parts.push({
    d: 0,
    draw: () => {
      const pts: Pt[] = [];
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        pts.push(c.at(Math.cos(a) * 2.2, Math.sin(a) * 3.2, hover + 13));
        pts.push(c.at(Math.cos(a) * 4.8 - sway * 0.3, Math.sin(a) * 6.4, hover + 1.5));
      }
      c.p.poly(hull(pts)).fill(C.shroud, { mode: 'cyl', dither: true, light: 0.05 });
      // ragged scan-line hem
      const r = rng(123);
      for (let k = 0; k < 6; k++) {
        const q = c.at(r() * 2 - 1, (k - 2.5) * 2.2, hover + 1);
        c.p.rect(Math.round(q.x) - 1, Math.round(q.y), 2, 2 + Math.round(r() * 2));
      }
      c.p.fill(C.shroud, { mode: 'flat', tone: 2, inner: false });
      // cyan circuit trace down the front
      if (faces(c, -0.3)) {
        const t0 = c.at(4, 0, hover + 10), t1 = c.at(4.4, 0, hover + 5), t2 = c.at(4.2, 1.6, hover + 3);
        c.p.line(t0.x, t0.y, t1.x, t1.y).line(t1.x, t1.y, t2.x, t2.y).fill(C.cyan, { mode: 'flat', tone: 2, glow: C.cyan[1]!, inner: false });
      }
    },
  });
  // reaching hands of light
  for (const sd of [-1, 1]) {
    parts.push({
      d: c.dep(2, sd * 5) + 0.2,
      draw: () => {
        const sh = c.at(0.4, sd * 3.6, hover + 10);
        const hand = c.at(2.8 + st * 4 + w * 0.5, sd * (4.6 - st * 2 - w), hover + 7 + w * 5 + st * 1.5);
        limb(c, sh, hand, 1.3, 0.9, C.shroud, { mode: 'emboss', dither: true });
        c.p.gpx(hand.x, hand.y, C.cyan[3]!, C.cyan[1]!);
      },
    });
  }
  // the hood's empty face: two bright cyan pixel eyes
  parts.push({
    d: c.dep(1, 0) + 0.4,
    draw: () => {
      const hz = hover + 15;
      const q = c.at(0, 0, hz);
      c.p.ellipse(q.x, q.y, 4.4, 4.2).fill(C.shroud, { mode: 'emboss', dither: true, light: 0.25 });
      if (faces(c, -0.3)) {
        const f = c.at(2.4, 0, hz - 0.6);
        c.p.ellipse(f.x, f.y, 2.6, 2.6).fill(ramp(0x000000, 0x02040a, 0x060a14, 0x0a1020), { mode: 'flat', tone: 1, inner: false });
        const hot = w > 0.3 || st > 0.3;
        for (const th of [-0.45, 0.45]) {
          if (c.P.depthOf(Math.cos(th), Math.sin(th)) < 0.05) continue;
          const e = c.at(Math.cos(th) * 3.4, Math.sin(th) * 3.4, hz - 0.4);
          c.p.gpx(e.x, e.y, hot ? 0xffffff : C.cyan[3]!, C.cyan[2]!);
        }
      }
    },
  });
  return parts;
}

/** Glitch finish: chromatic split (magenta left, cyan right), a couple of displaced scanline slices, block noise. */
function glitchify(buf: PixelBuffer, frame: number, seed: number): void {
  const src = buf.clone();
  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      if (src.alpha(x, y) > 0) continue;
      if (src.alpha(x + 1, y) > 100) buf.blend(x, y, 0xff3ad0, 120);
      else if (src.alpha(x - 1, y) > 100) buf.blend(x, y, 0x3ae8ff, 120);
    }
  }
  const r = rng(seed ^ 0x5bd1 ^ (frame * 7919));
  for (let k = 0; k < 2; k++) {
    const y0 = Math.floor(r() * buf.h), hgt = 1 + Math.floor(r() * 2), dx = Math.round((r() - 0.5) * 6);
    if (!dx) continue;
    const band = buf.clone();
    for (let y = y0; y < Math.min(buf.h, y0 + hgt); y++) {
      for (let x = 0; x < buf.w; x++) {
        const sx = x - dx;
        const c = sx >= 0 && sx < buf.w ? band.get(sx, y) : 0;
        const a = c >>> 24;
        if (a) buf.set(x, y, c & 0xffffff, a);
        else if (band.alpha(x, y)) buf.set(x, y, 0, 0);
      }
    }
  }
}

// ---------------------------------------------------------------- malware: Malware Swarm (knot of code-bugs)

const MALWARE = {
  shell: ramp(0x1a0418, 0x3e0a3a, 0x6e1a66, 0xa83a9a, 0xe070d4),
  code: MATERIALS.lime,
  leg: ramp(0x0a040a, 0x1a0a1a, 0x2a142a, 0x3e203e),
};

function malware(c: CC): Part[] {
  const { pose, P } = c;
  const C = MALWARE;
  const parts: Part[] = [];
  const w = pose.wind, st = pose.strike;
  const bugs: [number, number, number][] = [[3.2, 0, 0], [-0.8, -3.8, 1.3], [-1, 3.8, 2.6], [-4, 0.2, 3.9], [0.4, -0.4, 5.2]];
  for (const [bf0, br0, ph0] of bugs) {
    const jit = pose.moving ? Math.sin(pose.ph * 3 + ph0) * 0.8 : Math.sin(pose.ph + ph0) * 0.3;
    const bunch = 1 - w * 0.35;
    const bf = bf0 * bunch + st * 2.4 * (bf0 > 0 ? 1.4 : 1), br = br0 * bunch + jit * 0.4;
    const z = 2.6 + (bf0 === 0.4 ? 3.6 : 0) + (pose.moving ? Math.max(0, Math.sin(pose.ph * 3 + ph0)) * 0.8 : 0) + w * 0.8;
    parts.push({
      d: c.dep(bf, br),
      draw: () => {
        for (const sd of [-1, 1]) {
          for (let k = 0; k < 3; k++) {
            const a = c.at(bf + (k - 1) * 1.2, br + sd * 1.1, z - 0.4);
            const b = c.g(bf + (k - 1) * 1.6 + (pose.moving ? Math.sin(pose.ph * 4 + k + ph0) * 0.7 : 0), br + sd * 2.8, Math.max(0, z - 3));
            c.p.line(a.x, a.y, b.x, b.y);
          }
        }
        c.p.fill(C.leg, { mode: 'flat', tone: 2, inner: false });
        const q = c.at(bf, br, z);
        c.p.ellipse(q.x, q.y, 3, 2.3).fill(C.shell, { mode: 'sphere', dither: true, light: 0.14 });
        // glowing code glyph on the carapace
        c.p.gpx(q.x, q.y - 0.5, C.code[3]!, C.code[1]!);
        if ((pose.frame + Math.round(ph0)) % 2 === 0) c.p.px(q.x + 1, q.y - 0.5, C.code[2]!);
        const h = c.at(bf + 2.6, br, z);
        if (c.P.depthOf(1, 0) > -0.5) c.p.circle(h.x, h.y, 1.3).fill(C.shell, { mode: 'sphere', inner: false }).px(h.x + P.fx * 0.6, h.y, st > 0.3 ? C.code[4]! : 0xff3a5a);
      },
    });
  }
  return parts;
}

// ---------------------------------------------------------------- tables (merged into creatures.ts)

export const THEME_FOE_DRAW: Record<ThemeFoeId, (c: CC) => Part[]> = {
  harpy, galewisp, stormhawk, cloudgolem, mooncrawler, moonleaper, lunarsentry, voidshambler, maintdrone, firewall, glitchwraith, malware,
};

/** Feet row (px) inside each frame; must match ACTOR specs (actors.ts originY x frameH). */
export const THEME_FOE_GROUND: Record<ThemeFoeId, number> = {
  harpy: 41, galewisp: 42, stormhawk: 41, cloudgolem: 64,
  mooncrawler: 34, moonleaper: 41, lunarsentry: 41, voidshambler: 49,
  maintdrone: 34, firewall: 49, glitchwraith: 42, malware: 34,
};

/** Death burst style: chunk tint, shard glint (stone / metal) and droplet colour. */
export const THEME_FOE_DEATH: Record<ThemeFoeId, { tint: number; glint: boolean; drop: number; drops: number }> = {
  harpy: { tint: 0x2a3450, glint: false, drop: 0x8e1a24, drops: 18 },
  galewisp: { tint: 0x6aa6c8, glint: true, drop: 0xe0f6ff, drops: 16 },
  stormhawk: { tint: 0x1e2448, glint: false, drop: 0xfff060, drops: 14 },
  cloudgolem: { tint: 0x7c889e, glint: true, drop: 0xe2e8f2, drops: 30 },
  mooncrawler: { tint: 0x6a6278, glint: false, drop: 0x98dc2c, drops: 10 },
  moonleaper: { tint: 0x3a4458, glint: false, drop: 0x5aa8ff, drops: 18 },
  lunarsentry: { tint: 0x9a6a14, glint: true, drop: 0xff7a2e, drops: 16 },
  voidshambler: { tint: 0x84848c, glint: false, drop: 0x5418aa, drops: 22 },
  maintdrone: { tint: 0x2e4a54, glint: true, drop: 0x8ac8ff, drops: 12 },
  firewall: { tint: 0x343a48, glint: true, drop: 0xff7a1e, drops: 26 },
  glitchwraith: { tint: 0x141e3a, glint: false, drop: 0x4ae8ff, drops: 18 },
  malware: { tint: 0x3e0a3a, glint: false, drop: 0x98dc2c, drops: 14 },
};

/** Lunge smear colour on the strike frames. */
export const THEME_FOE_SMEAR: Record<ThemeFoeId, number> = {
  harpy: HARPY.wing[3]!, galewisp: GALE.air[3]!, stormhawk: HAWK.spark[2]!, cloudgolem: GOLEM.cloud[3]!,
  mooncrawler: CRAWLER.grub[3]!, moonleaper: LEAPER.skin[3]!, lunarsentry: SENTRY.lens[3]!, voidshambler: SHAMBLER.suit[3]!,
  maintdrone: DRONE.weld[2]!, firewall: FIREWALL.fire[3]!, glitchwraith: GLITCH.cyan[2]!, malware: MALWARE.shell[3]!,
};

/** Ranged / casting foes (their strike smear is halved, like the catacomb casters). */
export const THEME_FOE_RANGED = new Set<ThemeFoeId>(['galewisp', 'stormhawk', 'lunarsentry', 'glitchwraith']);

/** Wind-up sparkle colour for casters and heavy hitters (absent = none). */
export const THEME_FOE_WINDUP: Partial<Record<ThemeFoeId, number>> = {
  galewisp: GALE.air[4]!, stormhawk: HAWK.spark[3]!, cloudgolem: GOLEM.bolt[2]!, lunarsentry: SENTRY.lens[3]!,
  voidshambler: SHAMBLER.glint[3]!, firewall: FIREWALL.fire[3]!, glitchwraith: GLITCH.cyan[3]!,
};

/** Outline colour override for painter.finish (absent = the shared indigo outline). */
export const THEME_FOE_OUTLINE: Partial<Record<ThemeFoeId, number>> = { galewisp: 0x16344a, glitchwraith: 0x05030c };

/** Optional finishing pass after the rim light (glitch wraith: chromatic split and slice displacement). */
export const THEME_FOE_POST: Partial<Record<ThemeFoeId, (buf: PixelBuffer, frame: number, seed: number) => void>> = { glitchwraith: glitchify };

export function isThemeFoe(id: string): id is ThemeFoeId {
  return (THEME_FOE_IDS as readonly string[]).includes(id);
}
