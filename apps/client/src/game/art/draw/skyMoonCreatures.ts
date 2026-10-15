/**
 * The theme bosses' adds (48x48, views e/se/s/ne/n): the Gale Wyrm's Gale Harpy and Wind Elemental, and the Crater
 * Horror's Crater Spawn. Same 2.5D rig and finishing as creatures.ts. Pure (no DOM / Phaser).
 */
import { MATERIALS } from '../palette';
import { Painter, PixelBuffer, flash, mix, rimTopLeft, rng, shatter, smear, sparkle, type FillOpts, type Ramp } from './pixel';
import { Proj, VIEW_ANGLE, drawParts, hull, type Part, type Pt, type View } from './rig';

export type SkyMoonCreatureId = 'galeharpy' | 'windelemental' | 'craterspawn';

const R = (...c: number[]): Ramp => Object.freeze(c);

const PAL = {
  harpy: {
    feather: R(0x1a2a44, 0x34507a, 0x5c86b4, 0xa8ccec, 0xeaf6ff),
    white: R(0x6a7890, 0xaab8cc, 0xe0eaf6, 0xffffff),
    skin: R(0x3a2c34, 0x6c5258, 0xa48078, 0xd2ac9a),
    talon: R(0x3a2c18, 0x7a6236, 0xc0a462, 0xf0dca0),
    eye: R(0x7a5a00, 0xe0b81c, 0xfff05a, 0xffffd0, 0xffffff),
  },
  wisp: {
    air: R(0x2a4a6a, 0x5a88b0, 0x9ac8e8, 0xdaf2ff, 0xffffff),
    core: R(0x1a3050, 0x3a6a9a, 0x7ab8e8, 0xd0f0ff, 0xffffff),
    debris: R(0x2a2420, 0x4e4438, 0x766a58, 0xa49880),
    leaf: R(0x1c3a1e, 0x34602e, 0x5a9a44, 0x9ad070),
    eye: R(0x6a7a00, 0xd0e01c, 0xf8ff7a, 0xffffe0, 0xffffff),
  },
  spawn: {
    shell: R(0x14101c, 0x2c2238, 0x4e4060, 0x7e6e92, 0xb2a6c4),
    flesh: R(0x2a1430, 0x5a2a5a, 0x8e4a86, 0xc884b8),
    leg: R(0x0e0a12, 0x221a2a, 0x3a2e46, 0x5a4a68),
    eye: R(0x0c3a5a, 0x1a7ab0, 0x52d2ff, 0xc2f6ff, 0xffffff),
  },
};

const GROUND: Record<SkyMoonCreatureId, number> = { galeharpy: 42, windelemental: 42, craterspawn: 40 };

interface CPose { ph: number; bob: number; lean: number; squash: number; wind: number; strike: number; hurt: number; moving: boolean; frame: number; lunge: number }

function poseFor(state: string, i: number, n: number): CPose {
  const p: CPose = { ph: (i / n) * Math.PI * 2, bob: 0, lean: 0, squash: 1, wind: 0, strike: 0, hurt: 0, moving: false, frame: i, lunge: 0 };
  switch (state) {
    case 'idle': p.bob = Math.sin(p.ph) * 0.6; break;
    case 'run': p.moving = true; p.lean = 1; p.bob = 0.5 - Math.abs(Math.sin(p.ph)) * 1.2; p.squash = 1 + 0.045 * Math.sin(p.ph * 2 + 0.6); break;
    case 'windup': p.wind = (i + 1) / n; p.ph = 0; p.lean = -1.8 * p.wind; p.squash = 1 - 0.12 * p.wind; break;
    case 'attack': { const seq = [1, 0.85, 0.45, 0.12]; p.strike = seq[Math.min(i, seq.length - 1)] ?? 0; p.ph = 0; p.lean = 4 * p.strike; p.squash = 1 + 0.06 * p.strike; p.lunge = 1.8 * p.strike; break; }
    case 'hit':
    case 'death': p.hurt = i === 0 || state === 'death' ? 1 : 0.45; p.lean = -2.2 * p.hurt; p.squash = 1 - 0.06 * p.hurt; p.ph = 0.3; break;
    default: break;
  }
  return p;
}

interface CC { p: Painter; P: Proj; pose: CPose; at: (f: number, r: number, z: number) => Pt; g: (f: number, r: number, z: number) => Pt; dep: (f: number, r: number) => number }

function sphere(c: CC, f: number, r: number, z: number, rad: number, ramp: Ramp, opts: FillOpts = {}, ry = 0.92): Pt {
  const q = c.at(f, r, z);
  c.p.ellipse(q.x, q.y, rad, rad * ry).fill(ramp, { mode: 'sphere', ...opts });
  return q;
}

function eye(c: CC, hf: number, hz: number, rad: number, th: number, col: number, halo: number): void {
  if (c.P.depthOf(Math.cos(th), Math.sin(th)) < 0.05) return;
  const q = c.at(hf + Math.cos(th) * rad, Math.sin(th) * rad, hz);
  c.p.gpx(q.x, q.y, col, halo);
}

// ---------------------------------------------------------------- Gale Harpy

function galeharpy(c: CC): Part[] {
  const { pose } = c;
  const C = PAL.harpy;
  const parts: Part[] = [];
  const flap = Math.sin(pose.ph * 2 + Math.PI / 4);
  const hover = 14 + Math.sin(pose.ph) * 1.2 - pose.strike * 2 + pose.wind * 1.5;
  const wz = pose.wind > 0 ? 7 * pose.wind : pose.strike > 0.5 ? -5 : flap * 6;
  for (const sd of [-1, 1]) {
    parts.push({
      d: c.dep(0, sd * 8) + (sd > 0 ? 0.1 : -0.1),
      draw: () => {
        const S = c.at(0.5, sd * 2.4, hover + 4);
        const W = c.at(0, sd * 8, hover + 6 + wz);
        const tips = [c.at(4, sd * 15, hover + 5 + wz * 1.2), c.at(-1, sd * 16.5, hover + 2 + wz * 1.1), c.at(-6, sd * 13, hover + wz * 0.7), c.at(-8.5, sd * 8, hover - 0.5 + wz * 0.4)];
        const pts = [S, W, ...tips, c.at(-4, sd * 2.5, hover + 1)];
        c.p.poly(pts.flatMap((q) => [q.x, q.y])).fill(C.feather, { mode: 'emboss', dither: true });
        // primary feathers: pale tips
        for (const t of tips) c.p.ellipse(t.x, t.y, 1.6, 1.1);
        c.p.fill(C.white, { mode: 'sphere', inner: false });
        c.p.line(S.x, S.y, W.x, W.y).fill(C.white, { mode: 'flat', tone: 1, inner: false });
      },
    });
  }
  // tail feathers
  parts.push({
    d: c.dep(-5, 0) - 0.3,
    draw: () => {
      for (let k = -1; k <= 1; k++) {
        const a = c.at(-3, k * 0.8, hover - 1), b = c.at(-8, k * 2.2, hover - 4);
        c.p.poly([a.x - 1, a.y, a.x + 1, a.y, b.x, b.y + 1]);
      }
      c.p.fill(C.white, { mode: 'emboss' });
    },
  });
  // legs and talons
  parts.push({
    d: c.dep(-0.5, 0) - 0.15,
    draw: () => {
      for (const sd of [-1, 1]) {
        const a = c.at(0, sd * 1.4, hover - 3), b = c.at(1 + pose.strike * 3, sd * 1.8, hover - 7 - pose.strike);
        c.p.capsule(a.x, a.y, b.x, b.y, 0.9, 0.7);
        c.p.line(b.x, b.y, b.x + 1.5, b.y + 1.5).line(b.x, b.y, b.x - 1, b.y + 1.5);
      }
      c.p.fill(C.talon, { mode: 'flat', tone: 2, inner: false });
    },
  });
  // feathered body
  parts.push({ d: 0, draw: () => { sphere(c, 0, 0, hover + 1, 4.2, C.feather, { dither: true }); sphere(c, 1.2, 0, hover - 0.5, 2.8, C.white, { inner: false, light: 0.1 }); } });
  // head: a pale face under a crest of storm feathers, golden eyes
  parts.push({
    d: c.dep(2.5, 0) + 0.2,
    draw: () => {
      const hz = hover + 6.5;
      for (let k = -1; k <= 1; k++) {
        const a = c.at(1.5, k * 1.1, hz + 2), b = c.at(-2.5, k * 2.4, hz + 6.5 + (k ? 0 : 1.5) + pose.wind);
        c.p.poly([a.x - 1, a.y, a.x + 1, a.y, b.x, b.y]);
      }
      c.p.fill(C.feather, { mode: 'emboss' });
      sphere(c, 2.2, 0, hz, 2.6, C.skin, { light: 0.05 });
      if (c.P.depthOf(1, 0) > -0.3) {
        const beak = c.at(4.6, 0, hz - 0.8);
        c.p.poly([beak.x - 1, beak.y - 1, beak.x + 1.5, beak.y, beak.x - 0.5, beak.y + 1.4]).fill(C.talon, { mode: 'flat', tone: 3, inner: false });
      }
      eye(c, 2.2, hz + 0.6, 2.3, 0.6, C.eye[3]!, C.eye[2]!);
      eye(c, 2.2, hz + 0.6, 2.3, -0.6, C.eye[3]!, C.eye[2]!);
    },
  });
  return parts;
}

// ---------------------------------------------------------------- Wind Elemental

function windelemental(c: CC): Part[] {
  const { pose } = c;
  const C = PAL.wisp;
  const parts: Part[] = [];
  const hz = 13 + Math.sin(pose.ph) * 1 + pose.wind * 2;
  const spin = pose.ph * 1.5 + pose.strike * 2;
  // the funnel: stacked rings of pale air narrowing toward the ground
  parts.push({
    d: -0.1,
    draw: () => {
      const pts: { x: number; y: number }[] = [];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        const z = 2 + t * (hz + 8);
        const rad = 1.5 + t * t * 8.5 + pose.wind * t * 2;
        const q = c.at(Math.sin(spin + t * 3) * 1.2 * (1 - t), Math.cos(spin + t * 3) * 1.2 * (1 - t), z);
        pts.push({ x: q.x - rad, y: q.y }, { x: q.x + rad, y: q.y });
      }
      c.p.poly(hull(pts)).fill(C.air, { mode: 'cyl', dither: true, alpha: 210 });
      // swirling bands
      for (let k = 1; k < 6; k++) {
        const t = k / 6;
        const q = c.at(0, 0, 2 + t * (hz + 8));
        const rad = 1.5 + t * t * 8.5;
        const a0 = spin + k;
        for (let s = 0; s < 6; s++) {
          const a = a0 + s * 0.35;
          c.p.dot(q.x + Math.cos(a) * rad, q.y + Math.sin(a) * rad * 0.35);
        }
      }
      c.p.fill(C.air, { mode: 'flat', tone: 4, inner: false });
    },
  });
  // the core: a bright knot with two eyes
  parts.push({
    d: 0.1,
    draw: () => {
      sphere(c, 0.5, 0, hz + 4, 5, C.core, { glow: C.core[3]!, light: 0.15 + pose.wind * 0.3, alpha: 235 });
      eye(c, 0.5, hz + 5, 3.9, 0.5, C.eye[3]!, C.eye[2]!);
      eye(c, 0.5, hz + 5, 3.9, -0.5, C.eye[3]!, C.eye[2]!);
      // a howling mouth of wind
      if (c.P.depthOf(1, 0) > -0.2) { const m = c.at(4, 0, hz + 2.2); c.p.ellipse(m.x, m.y, 1.4, 0.8 + pose.strike).fill(C.air, { mode: 'flat', tone: 0, inner: false }); }
    },
  });
  // debris caught in the wind: pebbles and leaves orbiting
  for (let k = 0; k < 7; k++) {
    const a = spin * 1.3 + (k / 7) * Math.PI * 2;
    const rr = 8 + (k % 2) * 3, z = 4 + k * 2.4;
    parts.push({
      d: c.dep(Math.cos(a) * rr, Math.sin(a) * rr) * 0.2,
      draw: () => {
        const q = c.at(Math.cos(a) * rr, Math.sin(a) * rr, z);
        if (k % 2) c.p.ellipse(q.x, q.y, 1.3, 1).fill(C.debris, { mode: 'sphere', inner: false });
        else c.p.poly([q.x - 1.5, q.y, q.x, q.y - 1, q.x + 1.5, q.y, q.x, q.y + 1]).fill(C.leaf, { mode: 'flat', tone: 2, inner: false });
      },
    });
  }
  return parts;
}

// ---------------------------------------------------------------- Crater Spawn

function craterspawn(c: CC): Part[] {
  const { pose, P } = c;
  const C = PAL.spawn;
  const parts: Part[] = [];
  const s = Math.sin(pose.ph);
  const bz = 6 + (pose.moving ? Math.abs(s) * 0.8 : Math.sin(pose.ph) * 0.4) + pose.wind * 1.2;
  // six legs, scuttling
  for (let k = 0; k < 6; k++) {
    const sd = k < 3 ? -1 : 1;
    const row = (k % 3) - 1;
    parts.push({
      d: c.dep(row * 3, sd * 5) - 0.3,
      draw: () => {
        const ph = pose.ph * 2 + k * 1.1;
        const step = pose.moving ? Math.sin(ph) * 2.2 : 0;
        const up = pose.moving ? Math.max(0, Math.cos(ph)) * 1.5 : 0;
        const a = c.at(row * 3, sd * 3.4, bz);
        const knee = c.at(row * 4.6 + step * 0.5, sd * 9, bz + 2.5);
        const ft = c.g(row * 6 + step + pose.lunge * 0.6, sd * 12, up);
        c.p.capsule(a.x, a.y, knee.x, knee.y, 1.4, 1.1).capsule(knee.x, knee.y, ft.x, ft.y, 1.1, 0.5).fill(C.leg, { mode: 'cyl' });
        c.p.px(knee.x, knee.y - 1, C.shell[3]!);
      },
    });
  }
  // the carapace: a cratered dome of moon-shell, soft flesh showing at the seams
  parts.push({
    d: 0,
    draw: () => {
      const pts: { x: number; y: number }[] = [];
      for (const [f, rad] of [[3, 5], [-0.5, 6.2], [-4, 5.2]] as const) {
        const q = c.at(f, 0, bz + 2);
        for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; pts.push({ x: q.x + Math.cos(a) * rad, y: q.y + Math.sin(a) * rad * 0.8 }); }
      }
      c.p.poly(hull(pts)).fill(C.flesh, { mode: 'sphere', dither: true });
      sphere(c, -0.5, 0, bz + 4, 5.6, C.shell, { dither: true });
      for (const [f, r] of [[-2.5, 2], [0.8, -2.2], [-1, -0.2]] as const) {
        const q = c.at(f, r, bz + 6.5);
        c.p.ellipse(q.x, q.y, 1.1, 0.7);
      }
      c.p.fill(C.shell, { mode: 'flat', tone: 0, inner: false });
    },
  });
  // mandibles and the single glowing eye
  parts.push({
    d: c.dep(4, 0) + 0.2,
    draw: () => {
      const hz = bz + 2.5;
      for (const sd of [-1, 1]) {
        const a = c.at(4, sd * 1.4, hz - 0.5), b = c.at(6.5 + pose.strike * 1.5, sd * (1.2 - pose.strike * 0.8), hz - 1.5);
        c.p.capsule(a.x, a.y, b.x, b.y, 0.9, 0.5);
      }
      c.p.fill(C.shell, { mode: 'flat', tone: 3, inner: false });
      if (P.depthOf(1, 0) > -0.1) {
        const e = c.at(4.2, 0, hz + 0.8);
        c.p.ellipse(e.x, e.y, 1.6, 1.3).fill(C.eye, { mode: 'sphere', glow: C.eye[2]!, light: 0.2 + pose.wind * 0.3, inner: false });
      }
    },
  });
  return parts;
}

const DRAW: Record<SkyMoonCreatureId, (c: CC) => Part[]> = { galeharpy, windelemental, craterspawn };
const DEATH: Record<SkyMoonCreatureId, { tint: number; glint: boolean; drop: number; drops: number }> = {
  galeharpy: { tint: 0x5c86b4, glint: false, drop: 0xe0eaf6, drops: 18 },
  windelemental: { tint: 0x9ac8e8, glint: true, drop: 0xdaf2ff, drops: 20 },
  craterspawn: { tint: 0x4e4060, glint: true, drop: 0x8e4a86, drops: 18 },
};
const SMEAR: Record<SkyMoonCreatureId, number> = { galeharpy: 0xa8ccec, windelemental: 0xdaf2ff, craterspawn: 0x7e6e92 };

export function renderSkyMoonCreature(id: SkyMoonCreatureId, state: string, view: View, i: number, n: number, painter: Painter): PixelBuffer {
  const seed = id.length * 1013 + i * 13 + view.charCodeAt(0) * 3 + state.length * 101;
  const pose = poseFor(state, i, n);
  if (state === 'death' && i > 0) { pose.squash = 0.8; pose.bob = -1.6; pose.lean = -3; }
  painter.reset();
  const W = painter.w;
  const P = new Proj(W / 2, GROUND[id], VIEW_ANGLE[view]);
  const at = (f: number, r: number, z: number): Pt => P.p(f + pose.lean * Math.min(1.2, z / 12) + pose.lunge * Math.min(1, z / 6), r, z * pose.squash + pose.bob);
  const g = (f: number, r: number, z: number): Pt => P.p(f, r, z);
  drawParts(DRAW[id]({ p: painter, P, pose, at, g, dep: (f, r) => P.depthOf(f, r) }));
  painter.finish(id === 'windelemental' ? 0x0a1a34 : undefined);
  const base = painter.buf.clone();
  rimTopLeft(base, 0.32);
  if (state === 'death') {
    if (i === 0) { flash(base, 0.6); return base; }
    const dd = DEATH[id];
    const t = Math.pow(i / (n - 1), 1.25);
    return shatter(base, t * 0.96, seed, dd.tint, 14, 0.9, { glint: dd.glint, drops: { color: dd.drop, count: dd.drops, groundY: GROUND[id] } });
  }
  if (state === 'hit' && i === 0) flash(base, 0.8);
  if (state === 'attack' && pose.strike > 0.4) {
    const k = pose.strike > 0.8 ? 1 : 0.5;
    smear(base, -P.fx * 6 * k, -P.fy * 3 * k, SMEAR[id], pose.strike > 0.8 ? 2 : 1, Math.round(120 * k + 20));
  }
  if (state === 'windup') {
    const r = rng(seed);
    const col = id === 'craterspawn' ? PAL.spawn.eye[3]! : PAL.wisp.air[4]!;
    for (let k = 0; k < 1 + i; k++) sparkle(base, Math.round(base.w / 2 + (r() - 0.5) * 24), Math.round(GROUND[id] - 6 - r() * 20), col, 1, 220);
  }
  void mix; void MATERIALS;
  return base;
}
