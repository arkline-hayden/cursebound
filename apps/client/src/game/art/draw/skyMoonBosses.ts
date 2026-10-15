/**
 * Theme boss sprites: The Gale Wyrm (id skydrake, 160x144, views e/se/s/ne/n) and The Crater Horror (id moonhorror,
 * 192x176, front only). Pure (no DOM / Phaser), same toolkit as bosses.ts.
 */
import { MATERIALS } from '../palette';
import { Painter, PixelBuffer, flash, mix, rimTopLeft, rng, shatter, sparkle, type FillOpts, type Ramp } from './pixel';
import { Proj, VIEW_ANGLE, drawParts, hull, lerp, type Part, type Pt, type View } from './rig';

const R = (...c: number[]): Ramp => Object.freeze(c);

// ======================================================================= THE GALE WYRM

const WYRM = {
  scale: R(0x0c1c30, 0x1a4462, 0x2c7298, 0x62b8d8, 0xd2f2ff),
  dark: R(0x08121e, 0x10283e, 0x1c4058, 0x2c5c78),
  belly: R(0x4a5868, 0x8898aa, 0xc8d4e0, 0xf0f6fc),
  membrane: R(0x16304e, 0x2e5e88, 0x6aa6d2, 0xbfe6ff, 0xf2fbff),
  bone: R(0x4a3c22, 0x8e7a46, 0xd8c27c, 0xfff0bc, 0xfffcec),
  feather: R(0x5a6a8c, 0xa4b8d4, 0xe2eefc, 0xffffff),
  eye: R(0x7a5a00, 0xe0b81c, 0xfff05a, 0xffffc8, 0xffffff),
  bolt: 0xfff7a8,
};

export const WYRM_W = 160;
export const WYRM_H = 144;
export const WYRM_GROUND = 128;

interface WPose {
  ph: number;
  /** wing raise: +1 high, -1 low */
  flap: number;
  hover: number;
  lean: number;
  /** head pull-back (windup) / thrust (attack) */
  neck: number;
  jaw: number;
  glow: number;
  sweep: number;   // wings swept back (dive)
  daze: number;
  tail: number;
  frame: number;
}

function wyrmPose(state: string, i: number, n: number): WPose {
  const p: WPose = { ph: (i / n) * Math.PI * 2, flap: 0, hover: 34, lean: 0, neck: 0, jaw: 0, glow: 0.35, sweep: 0, daze: 0, tail: 0, frame: i };
  switch (state) {
    case 'idle':
      p.flap = Math.cos(p.ph);
      p.hover = 34 + Math.sin(p.ph) * 2.2;
      p.tail = Math.sin(p.ph + 1) * 0.5;
      p.glow = 0.35 + 0.15 * Math.sin(p.ph);
      break;
    case 'run':
      p.flap = Math.cos(p.ph) * 1.1;
      p.hover = 36 + Math.sin(p.ph) * 1.5;
      p.lean = 4;
      p.tail = Math.sin(p.ph + 1.4) * 0.8;
      p.glow = 0.45;
      break;
    case 'windup': {
      const t = (i + 1) / n;
      p.flap = 0.6 + 0.5 * t;
      p.hover = 34 + t * 6;
      p.lean = -5 * t;
      p.neck = -t;
      p.jaw = t * 0.6;
      p.glow = 0.4 + 0.6 * t;
      p.tail = -0.4 * t;
      break;
    }
    case 'attack': {
      const seq = [1, 0.95, 0.75, 0.45, 0.2];
      const k = seq[Math.min(i, seq.length - 1)] ?? 0;
      p.sweep = k;
      p.flap = -0.6 * k + 0.2;
      p.hover = 30 - k * 4;
      p.lean = 8 * k;
      p.neck = k;
      p.jaw = k;
      p.glow = 0.5 + 0.5 * k;
      p.tail = 0.6 * k;
      break;
    }
    case 'stagger':
    case 'death':
      p.daze = 1;
      p.flap = -0.45 + (state === 'stagger' ? Math.sin(i * 2.2) * 0.12 : 0);
      p.hover = 16 + (state === 'stagger' ? (i % 2) : 0);
      p.lean = -2;
      p.neck = -0.3;
      p.jaw = 0.25;
      p.glow = 0.12;
      p.tail = 0.2;
      break;
    default:
      break;
  }
  return p;
}

interface WC { p: Painter; P: Proj; pose: WPose; at: (f: number, r: number, z: number) => Pt }

function wBlob(c: WC, segs: [number, number, number, number][], ramp: Ramp, opts: FillOpts): void {
  const pts: { x: number; y: number }[] = [];
  for (const [f, r, z, rad] of segs) {
    const q = c.at(f, r, z);
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      pts.push({ x: q.x + Math.cos(a) * rad, y: q.y + Math.sin(a) * rad * 0.88 });
    }
  }
  c.p.poly(hull(pts)).fill(ramp, opts);
}

function wyrmParts(c: WC): Part[] {
  const { pose, P } = c;
  const C = WYRM;
  const parts: Part[] = [];
  const hz = pose.hover;
  // ---- the wings: arm, wrist, three long fingers, a scalloped membrane and a feathered leading edge
  for (const sd of [-1, 1]) {
    parts.push({
      d: P.depthOf(2, sd * 24) * 0.6 + (sd > 0 ? 0.3 : -0.3),
      draw: () => {
        const lift = pose.flap * 20;
        const sw = pose.sweep;
        const S = c.at(7, sd * 6, hz + 7);
        const Wr = c.at(lerp(3, -6, sw), sd * lerp(27, 16, sw), hz + 14 + lift * 0.75);
        // the chord falls away from the leading tip so the membrane reads from every view (front views included)
        const tips = [
          c.at(lerp(16, -6, sw), sd * lerp(52, 30, sw), hz + 23 + lift * 1.2),
          c.at(lerp(2, -18, sw), sd * lerp(56, 34, sw), hz + 8 + lift * 1.05),
          c.at(lerp(-14, -30, sw), sd * lerp(46, 28, sw), hz - 7 + lift * 0.8),
        ];
        const root = c.at(-12, sd * 5, hz - 1);
        const mid = (a: Pt, b: Pt, k = 0.18): Pt => ({ x: (a.x + b.x) / 2 + (Wr.x - (a.x + b.x) / 2) * k, y: (a.y + b.y) / 2 + (Wr.y - (a.y + b.y) / 2) * k, d: 0 });
        const m1 = mid(tips[0]!, tips[1]!), m2 = mid(tips[1]!, tips[2]!), m3 = mid(tips[2]!, root, 0.12);
        c.p.poly([S.x, S.y, Wr.x, Wr.y, tips[0]!.x, tips[0]!.y, m1.x, m1.y, tips[1]!.x, tips[1]!.y, m2.x, m2.y, tips[2]!.x, tips[2]!.y, m3.x, m3.y, root.x, root.y])
          .fill(C.membrane, { mode: 'emboss', dither: true, alpha: 236, light: sd * P.ry > 0 ? 0.05 : -0.12 });
        // veins
        for (const t of tips) c.p.line(Wr.x, Wr.y, t.x, t.y);
        c.p.fill(C.membrane, { mode: 'flat', tone: 1, inner: false });
        // arm and finger bones
        c.p.capsule(S.x, S.y, Wr.x, Wr.y, 2.6, 1.9);
        for (const t of tips) c.p.capsule(Wr.x, Wr.y, t.x, t.y, 1.3, 0.6);
        c.p.fill(C.scale, { mode: 'cyl', light: 0.05 });
        // feathered leading edge along the arm (storm-white quills)
        for (let k = 0; k < 5; k++) {
          const q = { x: lerp(S.x, Wr.x, 0.15 + k * 0.18), y: lerp(S.y, Wr.y, 0.15 + k * 0.18) };
          c.p.poly([q.x - 1.5, q.y + 1, q.x + 1.5, q.y + 1, q.x + 0.5, q.y - 4 - (k % 2)]);
        }
        c.p.fill(C.feather, { mode: 'emboss', inner: false });
        c.p.ellipse(Wr.x, Wr.y, 2.4, 2).fill(C.bone, { mode: 'sphere' });
        // wing claw
        c.p.poly([Wr.x - 1, Wr.y - 1, Wr.x + 1.5, Wr.y - 1.5, Wr.x + sd * 1 + 0.5, Wr.y - 5]).fill(C.bone, { mode: 'flat', tone: 3, inner: false });
      },
    });
  }
  // ---- the tail: a long whip ending in a fan of storm feathers
  parts.push({
    d: P.depthOf(-30, 0),
    draw: () => {
      const seg = 9;
      let prev = c.at(-12, 0, hz);
      for (let k = 1; k <= seg; k++) {
        const t = k / seg;
        const sway = Math.sin(pose.ph * 1 + t * 2.4) * (3 + t * 7) * (0.4 + Math.abs(pose.tail));
        const q = c.at(-12 - t * 36, sway, hz - t * 10 + pose.tail * t * 8);
        c.p.capsule(prev.x, prev.y, q.x, q.y, 6.5 - t * 4.2, 6.2 - t * 4.4);
        prev = q;
      }
      c.p.fill(C.scale, { mode: 'cyl', dither: true });
      const end = prev;
      for (let k = -2; k <= 2; k++) {
        const a = k * 0.42;
        c.p.poly([end.x, end.y, end.x + Math.cos(a + Math.PI * 0.8) * 10 * (P.fx >= 0 ? 1 : -1) - 1, end.y + Math.sin(a) * 6 - 3, end.x + Math.cos(a + Math.PI * 0.85) * 12 * (P.fx >= 0 ? 1 : -1), end.y + Math.sin(a) * 7]);
      }
      c.p.fill(C.feather, { mode: 'emboss', dither: true });
    },
  });
  // ---- hind legs with talons tucked under the hips (splayed when grounded and dazed)
  for (const sd of [-1, 1]) {
    parts.push({
      d: P.depthOf(-6, sd * 6) - 0.2,
      draw: () => {
        const top = c.at(-6, sd * 6, hz - 2);
        const down = pose.daze ? hz - 2 : 14;
        const knee = c.at(-1, sd * 8, hz - 7);
        const ft = c.at(2 + pose.neck * 3, sd * (8 + pose.daze * 3), hz - down);
        c.p.capsule(top.x, top.y, knee.x, knee.y, 4.2, 3).capsule(knee.x, knee.y, ft.x, ft.y, 2.6, 1.8).fill(C.dark, { mode: 'cyl' });
        for (let k = -1; k <= 1; k++) c.p.line(ft.x, ft.y, ft.x + k * 2 + P.fx * 2, ft.y + 3);
        c.p.fill(C.bone, { mode: 'flat', tone: 3, inner: false });
      },
    });
  }
  // ---- body: scaled torso with a pale belly and a spine of white quills
  parts.push({
    d: 0,
    draw: () => {
      wBlob(c, [[13, 0, hz + 4, 10], [2, 0, hz + 2, 12], [-10, 0, hz, 10.5], [-16, 0, hz - 1, 8]], C.scale, { mode: 'sphere', dither: true });
      // belly plates (seen from the side and front)
      const bl: { x: number; y: number }[] = [];
      for (let k = 0; k <= 6; k++) {
        const f = 12 - k * 4.4;
        const q = c.at(f, 0, hz - 7 + Math.sin((k / 6) * Math.PI) * -1.5);
        bl.push({ x: q.x - 4.5, y: q.y - 2 }, { x: q.x + 4.5, y: q.y + 2 });
      }
      c.p.poly(hull(bl)).fill(C.belly, { mode: 'emboss', inner: false, alpha: 230 });
      for (let k = 0; k < 6; k++) {
        const q = c.at(12 - k * 4.4, 0, hz - 6.5);
        c.p.line(q.x - 4, q.y, q.x + 4, q.y);
      }
      c.p.fill(C.belly, { mode: 'flat', tone: 1, inner: false, alpha: 170 });
      // the spine quills
      for (let k = 0; k < 8; k++) {
        const f = 14 - k * 4;
        const q = c.at(f, 0, hz + 10 - Math.abs(f) * 0.1);
        c.p.poly([q.x - 2, q.y + 1, q.x + 2, q.y + 1, q.x - P.fx * 2, q.y - 6 - (k % 2) * 2]);
      }
      c.p.fill(C.feather, { mode: 'emboss' });
      // storm-vein runes glowing along the flank
      for (let k = 0; k < 4; k++) {
        const q = c.at(8 - k * 6, (P.ry >= 0 ? 1 : -1) * 9.5, hz + 1);
        if (P.depthOf(0, P.ry >= 0 ? 1 : -1) > -0.2) c.p.gpx(q.x, q.y, pose.glow > 0.6 ? C.eye[4]! : C.eye[3]!, C.eye[2]!).gpx(q.x + 1, q.y - 1, C.eye[2]!, C.eye[1]!);
      }
    },
  });
  // ---- front claws
  for (const sd of [-1, 1]) {
    parts.push({
      d: P.depthOf(12, sd * 5) + 0.1,
      draw: () => {
        const a = c.at(12, sd * 5.5, hz - 3);
        const b = c.at(16 + pose.neck * 4, sd * 6.5, hz - 9 - (pose.daze ? hz - 22 : 0));
        c.p.capsule(a.x, a.y, b.x, b.y, 2.6, 1.8).fill(C.dark, { mode: 'cyl' });
        for (let k = -1; k <= 1; k++) c.p.line(b.x, b.y, b.x + k * 1.6 + P.fx * 2.4, b.y + 2.6);
        c.p.fill(C.bone, { mode: 'flat', tone: 3, inner: false });
      },
    });
  }
  // ---- neck, head, horns, crest, glowing eyes and the storm in its jaws
  const headF = 30 + pose.neck * 9 - pose.daze * 6;
  const headZ = hz + 18 - pose.neck * 5 - pose.daze * 8 + (pose.neck < 0 ? -pose.neck * 6 : 0);
  parts.push({
    d: P.depthOf(headF, 0) + 0.5,
    draw: () => {
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        const q = c.at(lerp(14, headF - 5, t), Math.sin(pose.ph + t * 2) * 1.2, lerp(hz + 6, headZ - 1, t) + Math.sin(t * Math.PI) * 4);
        c.p.circle(q.x, q.y, 5.6 - t * 1.6);
      }
      c.p.fill(C.scale, { mode: 'sphere', dither: true });
      // throat quills
      for (let k = 1; k < 6; k++) {
        const t = k / 6;
        const q = c.at(lerp(14, headF - 5, t), 0, lerp(hz + 6, headZ - 1, t) + Math.sin(t * Math.PI) * 4 + 4.5);
        c.p.poly([q.x - 1.5, q.y + 1, q.x + 1.5, q.y + 1, q.x - P.fx * 3, q.y - 4]);
      }
      c.p.fill(C.feather, { mode: 'emboss', inner: false });
      // skull: a long wedge with a jaw that opens
      const jaw = pose.jaw * 4;
      wBlob(c, [[headF, 0, headZ, 5.4], [headF + 6, 0, headZ - 0.6, 3.8], [headF + 10, 0, headZ - 1.4, 2.6]], C.scale, { mode: 'sphere', light: 0.05 });
      if (jaw > 0.5 && P.depthOf(1, 0) > -0.6) {
        const j0 = c.at(headF + 2, 0, headZ - 3), j1 = c.at(headF + 10, 0, headZ - 3 - jaw);
        c.p.capsule(j0.x, j0.y, j1.x, j1.y, 2.8, 1.6).fill(C.dark, { mode: 'cyl' });
        const mouth = c.at(headF + 8, 0, headZ - 2 - jaw * 0.5);
        c.p.ellipse(mouth.x, mouth.y, 2.6, 1.2 + jaw * 0.3).fill(C.eye, { mode: 'flat', tone: pose.glow > 0.7 ? 4 : 2, glow: C.eye[2]!, inner: false });
      }
      // horns swept back, gold-tipped
      for (const sd of [-1, 1]) {
        const h0 = c.at(headF - 2, sd * 3, headZ + 3);
        const h1 = c.at(headF - 9, sd * 6, headZ + 9);
        const h2 = c.at(headF - 15, sd * 7, headZ + 10);
        c.p.capsule(h0.x, h0.y, h1.x, h1.y, 1.8, 1.2).capsule(h1.x, h1.y, h2.x, h2.y, 1.2, 0.5);
      }
      c.p.fill(C.bone, { mode: 'emboss', light: 0.1 });
      // feathered crest flaring behind the head
      for (let k = 0; k < 5; k++) {
        const q = c.at(headF - 4 - k * 1.5, 0, headZ + 5 - k * 0.6);
        const tip = c.at(headF - 10 - k * 2.5, (k - 2) * 2.2, headZ + 10 + (2 - Math.abs(k - 2)) * 2 + pose.glow * 2);
        c.p.poly([q.x - 1.5, q.y, q.x + 1.5, q.y, tip.x, tip.y]);
      }
      c.p.fill(C.feather, { mode: 'emboss', dither: true });
      // eyes: electric yellow, dim when dazed
      for (const sd of [-1, 1]) {
        const th = sd * 0.65;
        if (P.depthOf(Math.cos(th), Math.sin(th)) < 0.02) continue;
        const e = c.at(headF + 2 + Math.cos(th) * 3.6, Math.sin(th) * 4.2, headZ + 1.6);
        const col = pose.daze ? C.eye[1]! : pose.glow > 0.6 ? C.eye[4]! : C.eye[3]!;
        c.p.gpx(e.x, e.y, col, C.eye[2]!).gpx(e.x + 1, e.y, col, C.eye[2]!);
      }
      // nostril
      if (P.depthOf(1, 0) > -0.2) { const nq = c.at(headF + 10, 0, headZ); c.p.px(nq.x, nq.y, C.dark[0]!); }
    },
  });
  return parts;
}

function wyrmOverlay(buf: PixelBuffer, view: View, pose: WPose, seed: number): void {
  const r = rng(seed);
  const P = new Proj(WYRM_W / 2, WYRM_GROUND, VIEW_ANGLE[view]);
  // wind streaks curling off the wingtips
  const streaks = Math.round(4 + pose.glow * 6);
  for (let k = 0; k < streaks; k++) {
    const sd = r() < 0.5 ? -1 : 1;
    const q = P.p(-10 + (r() - 0.5) * 30, sd * (30 + r() * 26), pose.hover + 6 + (r() - 0.5) * 24);
    const len = 4 + Math.round(r() * 6);
    for (let s = 0; s < len; s++) buf.blend(Math.round(q.x - s * P.fx * 1.2), Math.round(q.y + Math.sin(s * 0.6) * 1.2), 0xe8f6ff, Math.round(110 * (1 - s / len)));
  }
  // crackling arcs over the wings while it gathers the storm
  if (pose.glow > 0.6 && !pose.daze) {
    for (let k = 0; k < 2 + Math.round(pose.glow * 3); k++) {
      const sd = r() < 0.5 ? -1 : 1;
      let q = P.p(r() * 10, sd * (12 + r() * 30), pose.hover + 12 + r() * 18);
      for (let s = 0; s < 6; s++) {
        const nx = q.x + (r() - 0.5) * 6, ny = q.y + 1.5 + r() * 2;
        const steps = Math.max(1, Math.round(Math.hypot(nx - q.x, ny - q.y)));
        for (let t = 0; t <= steps; t++) buf.blend(Math.round(q.x + ((nx - q.x) * t) / steps), Math.round(q.y + ((ny - q.y) * t) / steps), WYRM.bolt, 230);
        q = { x: nx, y: ny, d: 0 };
      }
    }
  }
  if (pose.sweep > 0.5) {
    // dive slipstream
    for (let k = 0; k < 40; k++) {
      const t = k / 40;
      const q = P.p(-20 - t * 30, (r() - 0.5) * 50, pose.hover + (r() - 0.5) * 24);
      buf.blend(Math.round(q.x), Math.round(q.y), mix(0xbfe6ff, 0xffffff, r() * 0.5), Math.round(190 * (1 - t)));
    }
  }
  if (pose.daze) {
    for (let k = 0; k < 3; k++) {
      const a = pose.frame * 0.9 + (k * Math.PI * 2) / 3;
      sparkle(buf, Math.round(WYRM_W / 2 + Math.cos(a) * 16), Math.round(WYRM_GROUND - 48 + Math.sin(a) * 4), WYRM.bolt, 2, 230);
    }
  }
}

// ======================================================================= THE CRATER HORROR

const HORROR = {
  flesh: R(0x261c32, 0x4a3e60, 0x786c92, 0xaca0c4, 0xe0daee),
  fleshDark: R(0x0e0a14, 0x1e1428, 0x322444, 0x4a3a62),
  glowSpot: R(0x0a4a40, 0x16907a, 0x52f0c8, 0xc0fff0),
  vein: R(0x3a0c3a, 0x6a1a6a, 0xa03aa0, 0xd87ad8),
  sclera: R(0x6a7a78, 0xaabcb4, 0xdcece2, 0xf6fffa),
  iris: R(0x0c3a5a, 0x1a7ab0, 0x52d2ff, 0xc2f6ff, 0xffffff),
  lantern: R(0x0a4a40, 0x14907a, 0x48f0c8, 0xbafff0, 0xffffff),
  rock: R(0x1a1a1e, 0x34343c, 0x5a5a64, 0x8a8a94, 0xbabac4),
  regolith: R(0x262428, 0x45434a, 0x6c6a72, 0x9a98a0),
  tooth: R(0x6a6050, 0xb0a48a, 0xe8dcc4, 0xfffaf0),
  pit: R(0x020104, 0x06040a, 0x0c0814, 0x140e20),
};

export const HORROR_W = 192;
export const HORROR_H = 176;
export const HORROR_GROUND = 158;
const HX = 96;

interface HPose {
  ph: number;
  sway: number;
  rear: number;     // tentacles reared up (windup)
  thrust: number;   // tentacles thrust out (attack)
  eye: number;      // eye openness 0..1
  glow: number;
  maw: number;
  slump: number;
  look: number;     // pupil drift -1..1
  frame: number;
}

function horrorPose(state: string, i: number, n: number): HPose {
  const p: HPose = { ph: (i / n) * Math.PI * 2, sway: 0, rear: 0, thrust: 0, eye: 0.85, glow: 0.4, maw: 0.1, slump: 0, look: 0, frame: i };
  switch (state) {
    case 'idle':
    case 'run':
      p.sway = Math.sin(p.ph);
      p.look = Math.sin(p.ph * 0.5) * 0.8;
      p.glow = 0.4 + 0.15 * Math.sin(p.ph);
      p.eye = i === 2 ? 0.55 : 0.85;   // a slow blink
      break;
    case 'windup': {
      const t = (i + 1) / n;
      p.rear = t;
      p.eye = 0.85 + 0.15 * t;
      p.glow = 0.4 + 0.6 * t;
      p.maw = 0.2 + 0.3 * t;
      p.sway = -0.4 * t;
      break;
    }
    case 'attack': {
      const seq = [1, 1, 0.8, 0.55, 0.3, 0.1];
      p.thrust = seq[Math.min(i, seq.length - 1)] ?? 0;
      p.eye = 1;
      p.glow = 0.6 + 0.4 * p.thrust;
      p.maw = 0.4 + 0.6 * p.thrust;
      p.sway = 0.3 * p.thrust;
      break;
    }
    case 'stagger':
    case 'death':
      p.slump = 1;
      p.eye = state === 'stagger' ? 0.3 + (i === 1 ? 0.15 : 0) : 0.2;
      p.glow = 0.15;
      p.maw = 0.35;
      p.sway = state === 'stagger' ? (i - 1) * 0.5 : 0;
      break;
    default:
      break;
  }
  return p;
}

/** A tentacle from the crater rim: a tapered curl of capsules, suckers underneath, an optional lantern bulb at the tip. */
function tentacle(p: Painter, x0: number, y0: number, ang: number, len: number, curl: number, rad: number, lantern: boolean, glow: number, pose: HPose, seed: number): void {
  const C = HORROR;
  const segs = 10;
  const pts: { x: number; y: number }[] = [{ x: x0, y: y0 }];
  let a = ang, x = x0, y = y0;
  for (let k = 1; k <= segs; k++) {
    const t = k / segs;
    a += curl * (0.02 + t * t * 0.3) + Math.sin(pose.ph + seed + t * 3) * 0.07;
    x += Math.cos(a) * (len / segs);
    y += Math.sin(a) * (len / segs);
    pts.push({ x, y });
  }
  for (let k = 0; k < segs; k++) {
    const t = k / segs;
    p.capsule(pts[k]!.x, pts[k]!.y, pts[k + 1]!.x, pts[k + 1]!.y, rad * (1 - t * 0.78), rad * (1 - (t + 0.1) * 0.78));
  }
  p.fill(C.flesh, { mode: 'cyl', dither: true });
  // suckers along the inner curve
  for (let k = 2; k < segs - 1; k += 2) {
    const q = pts[k]!;
    const nx = -Math.sin(a) * curl, ny = Math.cos(a) * curl;
    p.circle(q.x + nx * rad * 0.4, q.y + ny * rad * 0.4, Math.max(0.8, rad * (1 - k / segs) * 0.35));
  }
  p.fill(C.vein, { mode: 'sphere', inner: false });
  if (lantern) {
    const tip = pts[segs]!;
    p.circle(tip.x, tip.y, 3.4 + glow * 1.2).fill(C.lantern, { mode: 'sphere', glow: C.lantern[2]!, light: 0.1 + glow * 0.3, inner: false });
    p.gpx(tip.x - 1, tip.y - 1, C.lantern[4]!, C.lantern[3]!);
  }
}

function drawHorror(p: Painter, pose: HPose): void {
  const C = HORROR;
  const gy = HORROR_GROUND;
  const slump = pose.slump * 10;
  // ---- the crater: a dark pit ringed with regolith and broken rock
  p.ellipse(HX, gy - 4, 74, 16).fill(C.pit, { mode: 'flat', tone: 1, inner: false });
  p.ellipse(HX, gy - 6, 60, 11).fill(C.pit, { mode: 'flat', tone: 0, inner: false });
  // back rim
  for (let k = 0; k < 9; k++) {
    const a = Math.PI + (k / 8) * Math.PI;
    const x = HX + Math.cos(a) * 70, y = gy - 6 + Math.sin(a) * 15;
    p.ellipse(x, y, 8 + (k % 3) * 2, 5 + (k % 2) * 1.5);
  }
  p.fill(C.regolith, { mode: 'sphere', dither: true });
  // ---- towering tentacles behind the body: they rise high and hook over at the tips
  const back: [number, number, number, number, boolean, number][] = [
    [-40, -1.82, 92, 1, true, 9], [40, -1.32, 92, -1, false, 9], [-60, -2.25, 70, 1, false, 7.5], [62, -0.9, 74, -1, true, 7.5],
  ];
  for (const [dx, ang, len, curl, lantern, rad] of back) {
    const s = Math.sign(dx);
    const a = ang - pose.rear * 0.22 * s + pose.thrust * 0.3 * s + pose.slump * 0.7 * s;
    tentacle(p, HX + dx, gy - 12, a, len * (1 + pose.rear * 0.1 + pose.thrust * 0.12 - pose.slump * 0.3), curl * (1 + pose.rear * 0.6 - pose.thrust * 0.4), rad, lantern, pose.glow, pose, dx);
  }
  // ---- the body: a lumpy, lopsided mass of moon-pale flesh heaving out of the pit
  const top = 40 + slump - pose.rear * 6;
  const sx = pose.sway * 2;
  const lumps: [number, number, number, number][] = [
    [0, top + 34, 34, 34], [-20, top + 56, 30, 32], [22, top + 52, 28, 30], [-6, top + 18, 22, 20], [12, top + 26, 18, 18], [0, gy - 22, 40, 18],
  ];
  const bp: { x: number; y: number }[] = [];
  for (const [ox, oy, rx, ry] of lumps) for (let k = 0; k < 20; k++) { const a = (k / 20) * Math.PI * 2; bp.push({ x: HX + ox + sx + Math.cos(a) * rx, y: Math.min(gy - 6, oy + Math.sin(a) * ry) }); }
  p.poly(hull(bp)).fill(C.flesh, { mode: 'sphere', dither: true, cx: HX - 14 + sx, cy: top + 26, light: 0.12 });
  // a crown of feelers writhing on the crown of the mass
  for (let k = -2; k <= 2; k++) {
    tentacle(p, HX + k * 11 + sx, top + 10 + Math.abs(k) * 5, -Math.PI / 2 + k * 0.42, 18 + (2 - Math.abs(k)) * 5 + pose.rear * 6, (k >= 0 ? 1 : -1) * 0.9, 3.4, false, pose.glow, pose, k * 7);
  }
  // folds of flesh: darker crescents under the lumps
  for (const [ox, oy, rx] of [[-20, 78, 22], [22, 74, 20], [-8, 38, 16], [14, 46, 12]] as const) {
    p.ellipse(HX + ox + sx, top + oy, rx, 3.2).minus().ellipse(HX + ox + sx, top + oy - 2, rx * 0.95, 3);
  }
  p.plus();
  p.fill(C.fleshDark, { mode: 'flat', tone: 2, inner: false, alpha: 210 });
  // veins crawling up from the pit
  for (let k = 0; k < 7; k++) {
    const x0 = HX + (k - 3) * 11 + sx, y0 = gy - 12;
    p.line(x0, y0, x0 + Math.sin(k * 1.7) * 7, y0 - 26 - (k % 3) * 10);
    p.line(x0 + Math.sin(k * 1.7) * 7, y0 - 26 - (k % 3) * 10, x0 + Math.sin(k * 2.3) * 10, y0 - 40 - (k % 2) * 12);
  }
  p.fill(C.vein, { mode: 'flat', tone: 1, inner: false, alpha: 200 });
  // bioluminescent pocks and a cluster of small blind eyes
  const vr = rng(321);
  for (let k = 0; k < 9; k++) {
    const x = HX + sx + (vr() - 0.5) * 70, y = top + 20 + vr() * 70;
    p.ellipse(x, y, 1.4, 1.1);
  }
  p.fill(C.glowSpot, { mode: 'flat', tone: 2, glow: C.glowSpot[1]!, inner: false });
  for (const [ex, ey, er] of [[-28, 34, 3.4], [26, 30, 3], [-16, 16, 2.4], [34, 54, 2.6], [-38, 58, 3], [8, 10, 2.2], [-4, 70, 2.2]] as const) {
    const x = HX + ex + sx, y = top + ey;
    p.ellipse(x, y, er, er * 0.75).fill(C.sclera, { mode: 'sphere', inner: false });
    p.gpx(x + pose.look, y, pose.slump ? C.iris[1]! : C.iris[3]!, C.iris[2]!);
  }
  // ---- the great eye
  const ex = HX + sx, ey = top + 44;
  const open = pose.eye;
  const ew = 24, eh = 17 * open;
  p.ellipse(ex, ey, ew + 4, 15 + 4).fill(C.fleshDark, { mode: 'sphere', inner: false });
  if (eh > 1) {
    p.ellipse(ex, ey, ew, eh).fill(C.sclera, { mode: 'sphere', light: 0.05 + pose.glow * 0.1 });
    // bloodshot veins in the white
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.3;
      p.line(ex + Math.cos(a) * ew * 0.95, ey + Math.sin(a) * eh * 0.9, ex + Math.cos(a) * ew * 0.55, ey + Math.sin(a) * eh * 0.5);
    }
    p.fill(C.vein, { mode: 'flat', tone: 2, inner: false, alpha: 160 });
    const ix = ex + pose.look * 6, ir = Math.min(10, eh * 0.9);
    p.circle(ix, ey, ir).fill(C.iris, { mode: 'sphere', glow: C.iris[2]!, light: pose.glow * 0.35, inner: false });
    p.ellipse(ix, ey, Math.max(1, 2.2 - pose.glow), Math.max(1, ir * 0.85)).fill(C.pit, { mode: 'flat', tone: 0, inner: false });
    p.gpx(ix - 3, ey - 3, 0xffffff, C.iris[3]!).gpx(ix - 2, ey - 3, C.iris[4]!, C.iris[3]!);
  }
  // heavy lids
  p.poly([ex - ew - 4, ey - eh + 1, ex - ew * 0.5, ey - eh - 7, ex + ew * 0.5, ey - eh - 7, ex + ew + 4, ey - eh + 1, ex + ew * 0.5, ey - eh - 2, ex - ew * 0.5, ey - eh - 2]).fill(C.flesh, { mode: 'emboss' });
  p.poly([ex - ew - 3, ey + eh - 1, ex + ew + 3, ey + eh - 1, ex + ew * 0.5, ey + eh + 4, ex - ew * 0.5, ey + eh + 4]).fill(C.flesh, { mode: 'emboss', light: -0.1 });
  // ---- the maw under the eye: a ragged, lopsided split of uneven fangs
  const my = ey + 30 + slump * 0.3;
  const mo = 3 + pose.maw * 10;
  p.poly([ex - 26, my + 2, ex - 14, my - mo * 0.6, ex - 2, my - mo * 0.4, ex + 12, my - mo * 0.7, ex + 24, my - 1, ex + 14, my + mo, ex + 2, my + mo * 1.15, ex - 14, my + mo * 0.9]).fill(C.pit, { mode: 'flat', tone: 2, inner: false });
  const fangs = [5.5, 3, 7, 2.5, 4.5, 8, 3, 5, 3.5];
  fangs.forEach((h, k) => {
    const x = ex - 20 + k * 5;
    const ty = my - mo * 0.55 + Math.abs(k - 4) * 0.4, by = my + mo * 0.95 - Math.abs(k - 4) * 0.4;
    p.poly([x - 1.7, ty, x + 1.7, ty, x + 0.2, ty + h]);
    p.poly([x - 1.4, by, x + 1.4, by, x + 0.5, by - h * 0.7]);
  });
  p.fill(C.tooth, { mode: 'emboss', inner: false });
  if (pose.maw > 0.5) p.ellipse(ex, my + mo * 0.25, 6, Math.max(1, mo * 0.35)).fill(C.iris, { mode: 'flat', tone: 2, glow: C.iris[2]!, inner: false, alpha: 220 });
  // ---- tentacles in front of the body, slung over the crater rim
  const front: [number, number, number, number, boolean][] = [
    [-50, -2.45, 56, -1, false], [50, -0.7, 56, 1, true], [-24, -2.75, 44, -1, true], [26, -0.4, 42, 1, false],
  ];
  for (const [dx, ang, len, curl, lantern] of front) {
    const s = Math.sign(dx);
    const a = ang - pose.rear * 0.45 * s + pose.thrust * 0.55 * s + pose.slump * 0.6 * s;
    tentacle(p, HX + dx, gy - 4, a, len * (1 + pose.rear * 0.15 + pose.thrust * 0.25 - pose.slump * 0.3), curl * (0.9 + pose.sway * 0.3), 8, lantern, pose.glow, pose, dx * 2);
  }
  // ---- front rim of the crater (in front of everything)
  for (let k = 0; k < 11; k++) {
    const a = (k / 10) * Math.PI;
    const x = HX + Math.cos(a) * 74, y = gy - 4 + Math.sin(a) * 16;
    p.ellipse(x, y, 9 + (k % 3) * 2.5, 5.5 + (k % 2) * 2);
  }
  p.fill(C.rock, { mode: 'sphere', dither: true });
  for (let k = 0; k < 5; k++) p.ellipse(HX - 60 + k * 30, gy + 6 - (k % 2) * 2, 4, 2.5);
  p.fill(C.regolith, { mode: 'sphere', dither: true });
}

function horrorOverlay(buf: PixelBuffer, pose: HPose, seed: number): void {
  const r = rng(seed);
  // dust and void motes drifting up out of the pit
  for (let k = 0; k < Math.round(6 + pose.glow * 10); k++) {
    const x = Math.round(HX + (r() - 0.5) * 120);
    const y = Math.round(HORROR_GROUND - 10 - r() * 90);
    buf.blend(x, y, k % 3 ? 0x9a8aae : HORROR.iris[3]!, Math.round(80 + pose.glow * 130));
  }
  if (pose.thrust > 0.6) {
    // a pulse of void light from the eye
    for (let w = 0; w < 2; w++) {
      const rad = 26 + pose.thrust * 18 + w * 10;
      for (let k = 0; k < 120; k++) {
        const a = (k / 120) * Math.PI * 2;
        buf.blend(Math.round(HX + Math.cos(a) * rad), Math.round(90 + Math.sin(a) * rad * 0.6), w ? HORROR.iris[2]! : 0xe0f8ff, Math.round(170 * (w ? 0.5 : 1)));
      }
    }
  }
  if (pose.slump) {
    for (let k = 0; k < 3; k++) {
      const a = pose.frame * 0.9 + (k * Math.PI * 2) / 3;
      sparkle(buf, Math.round(HX + Math.cos(a) * 18), Math.round(60 + Math.sin(a) * 4), HORROR.iris[3]!, 2, 220);
    }
  }
}

// ======================================================================= entry

export type SkyMoonBossId = 'skydrake' | 'moonhorror';

export function renderSkyMoonBoss(id: SkyMoonBossId, state: string, view: View, i: number, n: number, painter: Painter): PixelBuffer {
  const seed = (id === 'skydrake' ? 5100 : 6300) + i * 19 + view.charCodeAt(0) + state.length * 47;
  const isDeath = state === 'death';
  painter.reset();
  if (id === 'skydrake') {
    const pose = wyrmPose(state, isDeath ? 0 : i, n);
    const P = new Proj(WYRM_W / 2, WYRM_GROUND, VIEW_ANGLE[view]);
    const K = 1.12;   // the rig is authored a touch small: scale the whole Wyrm up
    const at = (f: number, r: number, z: number): Pt => P.p((f + pose.lean * Math.min(1.2, (z - pose.hover + 20) / 40)) * K, r * K, z * K);
    drawParts(wyrmParts({ p: painter, P, pose, at }));
    painter.finish();
    const out = painter.buf.clone();
    rimTopLeft(out, 0.3);
    if (isDeath) return bossDeath(out, i, n, seed, WYRM.scale[2]!, WYRM.bolt, WYRM_GROUND);
    wyrmOverlay(out, view, pose, seed);
    if (state === 'stagger' && i === 0) flash(out, 0.4, 0xe8f6ff);
    return out;
  }
  const pose = horrorPose(state, isDeath ? 0 : i, n);
  drawHorror(painter, pose);
  painter.finish();
  const out = painter.buf.clone();
  rimTopLeft(out, 0.24, 0xd8e8ff);
  if (isDeath) return bossDeath(out, i, n, seed, HORROR.flesh[2]!, HORROR.iris[2]!, HORROR_GROUND);
  horrorOverlay(out, pose, seed);
  if (state === 'stagger' && i === 0) flash(out, 0.4, 0xc2f6ff);
  return out;
}

/** Chunks scatter while storm sparks / void ichor spray and settle on the ground line. */
function bossDeath(base: PixelBuffer, i: number, n: number, seed: number, tint: number, ember: number, groundY: number): PixelBuffer {
  if (i === 0) {
    flash(base, 0.5, 0xffffff);
    return base;
  }
  const t = Math.pow(i / (n - 1), 1.2);
  const out = shatter(base, t * 0.97, seed, tint, 34, 2.4, { glint: true, drops: { color: ember, count: 46, groundY } });
  const r = rng(seed);
  for (let k = 0; k < 6; k++) sparkle(out, Math.round(base.w * (0.2 + r() * 0.6)), Math.round(base.h * (0.2 + r() * 0.6)), ember, 1, Math.round(255 * (1 - t * 0.6)));
  return out;
}

void MATERIALS;
