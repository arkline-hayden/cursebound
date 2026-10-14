/**
 * Boss sprites: The Hollow Stag (id prismstag, 128x128, views e/s/n) and The Bell Golem (id bellroot,
 * 160x160, front only).
 * Pure (no DOM / Phaser).
 */
import { MATERIALS, PALETTES } from '../palette';
import { Painter, PixelBuffer, flash, mix, rimTopLeft, rng, shatter, sparkle, type FillOpts, type Ramp } from './pixel';
import { Proj, VIEW_ANGLE, drawParts, hull, lerp, type Part, type Pt, type View } from './rig';

type V3 = [number, number, number];

// ======================================================================= PRISMSTAG

interface SPose {
  ph: number;
  moving: boolean;
  /** head pitch: + lowers the head / tips antlers forward */
  pitch: number;
  lean: number;
  bob: number;
  glow: number;
  lunge: number;
  rear: number;
  daze: number;
  frame: number;
}

function stagPose(state: string, i: number, n: number): SPose {
  const p: SPose = { ph: (i / n) * Math.PI * 2, moving: false, pitch: 0, lean: 0, bob: 0, glow: 0.35, lunge: 0, rear: 0, daze: 0, frame: i };
  switch (state) {
    case 'idle':
      p.bob = Math.sin(p.ph) * 0.8;
      p.glow = 0.35 + 0.2 * Math.sin(p.ph);
      p.pitch = Math.sin(p.ph) * 0.04;
      break;
    case 'run':
      p.moving = true;
      p.lean = 2;
      p.pitch = 0.15;
      p.glow = 0.5;
      break;
    case 'windup': {
      const t = (i + 1) / n;
      p.rear = t < 0.6 ? t * 1.4 : 0.84 - (t - 0.6) * 1.2;
      p.pitch = -0.25 * p.rear + (t > 0.6 ? (t - 0.6) * 2.2 : 0);
      p.lean = -3 * t;
      p.glow = 0.4 + t * 0.6;
      break;
    }
    case 'attack': {
      const seq = [1, 1, 0.85, 0.6, 0.3, 0.1];
      p.lunge = seq[i] ?? 0;
      p.pitch = 0.9 * p.lunge;
      p.lean = 9 * p.lunge;
      p.glow = 0.5 + p.lunge * 0.5;
      p.ph = i * 0.9;
      p.moving = i < 3;
      break;
    }
    case 'stagger':
    case 'death':
      p.daze = 1;
      p.pitch = 0.55 + (state === 'stagger' ? Math.sin(i * 2.1) * 0.08 : 0);
      p.lean = -2;
      p.bob = -5 - (state === 'stagger' ? (i % 2) : 0);
      p.glow = state === 'stagger' ? 0.12 + (i === 1 ? 0.1 : 0) : 0.2;
      break;
    default:
      break;
  }
  return p;
}

interface SC {
  p: Painter;
  P: Proj;
  pose: SPose;
  at: (f: number, r: number, z: number) => Pt;
  g: (f: number, r: number, z: number) => Pt;
}

function blob2(c: SC, segs: [number, number, number, number][], ramp: Ramp, opts: FillOpts): void {
  const pts: { x: number; y: number }[] = [];
  for (const [f, r, z, rad] of segs) {
    const q = c.at(f, r, z);
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      pts.push({ x: q.x + Math.cos(a) * rad, y: q.y + Math.sin(a) * rad * 0.9 });
    }
  }
  c.p.poly(hull(pts)).fill(ramp, opts);
}

function pitchV(v: V3, a: number): V3 {
  // rotate around the local right axis: +a tips "up" toward forward
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

interface Seg {
  a: V3;
  b: V3;
  r0: number;
  r1: number;
  tip: boolean;
  hue: number;
}

function antlerSegs(base: V3, side: number, pitch: number): Seg[] {
  const out: Seg[] = [];
  const grow = (start: V3, dir: V3, len: number, rad: number, depth: number, hue: number): void => {
    const d = pitchV(dir, pitch);
    const end: V3 = [start[0] + d[0] * len, start[1] + d[1] * len, start[2] + d[2] * len];
    out.push({ a: start, b: end, r0: rad, r1: rad * 0.72, tip: depth === 0, hue });
    if (depth === 0) return;
    // two branches: one sweeps outward, one sweeps up/back
    // main beam continues sweeping back/outward; a tine forks forward and up
    const out1: V3 = [dir[0] - 0.25, dir[1] + side * 0.35, dir[2] * 0.8];
    const out2: V3 = [0.55, side * 0.18, 0.85];
    const n1 = Math.hypot(...out1);
    const n2 = Math.hypot(...out2);
    grow(end, [out1[0] / n1, out1[1] / n1, out1[2] / n1], len * 0.74, rad * 0.72, depth - 1, hue + 0.09);
    grow(end, [out2[0] / n2, out2[1] / n2, out2[2] / n2], len * 0.68, rad * 0.7, depth - 1, hue - 0.07);
  };
  const d0: V3 = [-0.3, side * 0.62, 0.72];
  const n0 = Math.hypot(...d0);
  grow(base, [d0[0] / n0, d0[1] / n0, d0[2] / n0], 13.5, 3, 3, side > 0 ? 0.48 : 0.6);
  return out;
}

function prismstagParts(c: SC): Part[] {
  const { pose, P } = c;
  const C = PALETTES.prismstag;
  const parts: Part[] = [];
  const s = Math.sin(pose.ph);
  const rock = pose.moving ? s * 1.5 : 0;
  const lift = pose.rear * 10;
  const bodyZ = 39 + pose.bob;
  const chestZ = bodyZ + lift + rock;
  const hipZ = bodyZ - rock;
  // bone legs with knobbly joints
  const legs: [number, number, number, boolean][] = [
    [12, -6, 0, true],
    [12, 6, 0.6, true],
    [-13, -6, Math.PI, false],
    [-13, 6, Math.PI + 0.6, false],
  ];
  for (const [lf, lr, lp, front] of legs) {
    parts.push({
      d: P.depthOf(lf, lr) - 0.5,
      draw: () => {
        const ph = pose.ph + lp;
        const swing = pose.moving ? Math.sin(ph) * 9 : 0;
        const up = pose.moving ? Math.max(0, Math.cos(ph)) * 6 : 0;
        const rearUp = front ? pose.rear * 14 : 0;
        const splay = pose.daze ? lr * 0.5 : 0;
        const topZ = front ? chestZ - 3 : hipZ - 2;
        const top = c.at(lf, lr * 0.8, topZ);
        const ftF = lf + swing + (front ? pose.lunge * 6 : -pose.lunge * 3) + (front && pose.rear > 0 ? 4 : 0);
        const ft = c.g(ftF, lr + splay, up + rearUp);
        const knee = c.g((lf + ftF) / 2 + (front ? -3 : 4), lr + splay * 0.5, (topZ + up + rearUp) * 0.48);
        c.p.capsule(top.x, top.y, knee.x, knee.y, 2.4, 1.5).fill(C.bone, { mode: 'cyl' });
        c.p.capsule(knee.x, knee.y, ft.x, ft.y - 2, 1.4, 1.1).fill(C.bone, { mode: 'cyl', light: -0.08 });
        c.p.circle(knee.x, knee.y, 2.2).fill(C.bone, { mode: 'sphere' });
        c.p.ellipse(ft.x + P.fx * 0.8, ft.y - 1.5, 2.8, 2.2).fill(C.hoof, { mode: 'sphere', light: 0.2 });
      },
    });
  }
  // tail vertebrae
  parts.push({
    d: P.depthOf(-22, 0),
    draw: () => {
      for (let k = 0; k < 4; k++) {
        const q = c.at(-19 - k * 2.4, 0, hipZ + 7 - k * 1.6 + (pose.moving ? s * k * 0.4 : 0));
        c.p.circle(q.x, q.y, 1.8 - k * 0.3);
      }
      c.p.fill(C.bone, { mode: 'sphere' });
    },
  });
  // ribcage cage with a ghost-fire heart inside
  const ribs = (side: number): void => {
    for (let k = 0; k < 6; k++) {
      const f = 14 - k * 3.6;
      const zt = (k < 3 ? chestZ : bodyZ) + 9;
      const a = c.at(f, side * 0.8, zt);
      const m = c.at(f - 1.2, side * 8.2, zt - 8);
      const b = c.at(f - 2.4, side * 3.4, zt - 16 + k * 0.8);
      c.p.capsule(a.x, a.y, m.x, m.y, 1.4, 1.2).capsule(m.x, m.y, b.x, b.y, 1.2, 0.9);
    }
    c.p.fill(C.bone, { mode: 'emboss', light: side * P.ry > 0 ? 0.05 : -0.2 });
  };
  const nearSide = P.ry >= 0 ? 1 : -1;
  parts.push({
    d: -0.2,
    draw: () => {
      ribs(-nearSide);
    },
  });
  parts.push({
    d: 0,
    draw: () => {
      const g = c.at(2, 0, bodyZ + lift * 0.4 + 1);
      const rr = 8 + pose.glow * 2;
      c.p.ellipse(g.x, g.y, rr, rr * 0.8).fill(C.fire, { mode: 'sphere', glow: C.fire[3]!, alpha: 170, light: -0.1 + pose.glow * 0.3, inner: false });
      c.p.circle(g.x - 1, g.y - 1, 2.6 + pose.glow * 1.4).fill(C.fire, { mode: 'flat', tone: 3, glow: C.fire[4]!, inner: false });
      // pelvis
      const pv = c.at(-14, 0, hipZ + 3);
      c.p.ellipse(pv.x, pv.y, 6.2, 5).minus().ellipse(pv.x + P.fx * 1.5, pv.y + 0.5, 2, 1.6).fill(C.bone, { mode: 'sphere', dither: true });
      // shoulder blades
      for (const sd of [-1, 1]) {
        const q = c.at(13, sd * 5.5, chestZ + 5);
        c.p.ellipse(q.x, q.y, 4.2, 5).fill(C.bone, { mode: 'sphere', light: sd * P.ry > 0 ? 0 : -0.25 });
      }
    },
  });
  parts.push({
    d: 0.25,
    draw: () => {
      ribs(nearSide);
      for (let k = 0; k < 12; k++) {
        const f = -16 + k * 2.8;
        const z = (f > 0 ? chestZ : hipZ) + 10 + Math.sin(k * 0.8) * 0.4;
        const q = c.at(f, 0, z);
        c.p.circle(q.x, q.y, 2);
      }
      c.p.fill(C.bone, { mode: 'sphere' });
    },
  });
  // neck vertebrae, skull and ghost-fire antlers
  const headF = 24 + pose.lunge * 6 - pose.daze * 2;
  const headZ = 59 + lift * 1.2 - pose.pitch * 16 + pose.bob;
  parts.push({
    d: P.depthOf(headF, 0) + 0.5,
    draw: () => {
      for (let k = 0; k < 6; k++) {
        const t = k / 5;
        const q = c.at(lerp(15, headF - 4, t), 0, lerp(chestZ + 9, headZ - 2, t));
        c.p.circle(q.x, q.y, 2.8 - t * 0.6);
      }
      c.p.fill(C.bone, { mode: 'sphere' });
      const pv = pitchV([8.4, 0, -2.2], pose.pitch);
      const muz: V3 = [headF + pv[0], 0, headZ + pv[2]];
      blob2(
        c,
        [
          [headF, 0, headZ, 6.6],
          [muz[0], 0, muz[2], 3.6],
        ],
        C.bone,
        { mode: 'sphere' },
      );
      // nasal cavity + teeth
      if (P.depthOf(1, 0) > -0.2) {
        const nose = c.at(muz[0] + 1.6, 0, muz[2] + 0.8);
        c.p.ellipse(nose.x, nose.y, 1.4, 1.2).fill(C.hoof, { mode: 'flat', tone: 0, inner: false });
        const tt = c.at(muz[0] + 1.4, 0, muz[2] - 2.6);
        for (let k = -1; k <= 1; k++) c.p.px(tt.x + k * 1.2, tt.y, C.bone[4]!);
      }
      for (const sd of [-1, 1]) {
        const e0 = c.at(headF - 2, sd * 3, headZ + 3.5);
        const et = c.at(headF - 5, sd * 7.5, headZ + 5);
        c.p.capsule(e0.x, e0.y, et.x, et.y, 1.6, 0.6).fill(C.bone, { mode: 'emboss' });
      }
      // hollow sockets burning with pale ghost-fire
      for (const sd of [-1, 1]) {
        const th = sd * 0.72;
        if (P.depthOf(Math.cos(th), Math.sin(th)) < 0.05) continue;
        const e = c.at(headF + Math.cos(th) * 5.4, Math.sin(th) * 5.4, headZ + 1.4);
        c.p.ellipse(e.x, e.y, 1.8, 1.5).fill(C.hoof, { mode: 'flat', tone: 0, inner: false });
        const col = pose.daze ? C.eye[1]! : C.eye[4]!;
        c.p.gpx(e.x, e.y, col, C.eye[2]!).gpx(e.x + 1, e.y, col, C.eye[2]!);
        const fl = Math.sin(pose.frame * 1.7 + sd) * 0.8;
        c.p.poly([e.x - 1.2, e.y - 1, e.x + 1.4, e.y - 1, e.x + 0.4 + fl, e.y - 5]).fill(C.fire, { mode: 'flat', tone: 2, glow: C.fire[3]!, alpha: 210, inner: false });
      }
      // bone antlers
      const tips: { b: Pt; hue: number }[] = [];
      for (const sd of [-1, 1]) {
        const segs = antlerSegs([headF - 2, sd * 3.2, headZ + 5], sd, pose.pitch * 0.9);
        for (const sg of segs) {
          const a = c.at(...sg.a);
          const b = c.at(...sg.b);
          c.p.capsule(a.x, a.y, b.x, b.y, sg.r0 * 0.85, sg.r1 * 0.8);
          if (sg.tip) tips.push({ b, hue: sg.hue });
        }
        c.p.fill(C.bone, { mode: 'emboss', light: 0.05 });
      }
      // ghost-fire wreathing the antler tips
      tips.forEach(({ b }, k) => {
        const h = 4 + pose.glow * 3 + ((k + pose.frame) % 3);
        const fl = Math.sin(pose.frame * 1.3 + k * 2) * 1.2;
        c.p.poly([b.x - 1.8, b.y + 0.5, b.x + 1.8, b.y + 0.5, b.x + 1 + fl * 0.4, b.y - h * 0.5, b.x + fl, b.y - h, b.x - 1 + fl * 0.3, b.y - h * 0.5]).fill(C.fire, {
          mode: 'emboss',
          glow: C.fire[3]!,
          alpha: 225,
          light: 0.2 + pose.glow * 0.2,
          inner: false,
        });
      });
    },
  });
  return parts;
}

function stagOverlay(buf: PixelBuffer, view: View, pose: SPose, seed: number): void {
  const r = rng(seed);
  const C = PALETTES.prismstag;
  // drifting ghost-fire motes around the antlers and ribcage
  const count = Math.round(5 + pose.glow * 10);
  for (let k = 0; k < count; k++) {
    const x = Math.round(64 + (r() - 0.5) * 90);
    const y = Math.round(8 + r() * 70);
    buf.blend(x, y, C.fire[3]!, Math.round(110 + pose.glow * 120));
    if (r() > 0.6) buf.blend(x, y - 1, C.fire[2]!, 120);
  }
  if (pose.lunge > 0.5) {
    const P = new Proj(64, 112, VIEW_ANGLE[view]);
    for (let k = 0; k < 50; k++) {
      const t = k / 50;
      const q = P.p(30 + t * 30, (r() - 0.5) * 30, 50 + (r() - 0.5) * 30);
      buf.blend(Math.round(q.x), Math.round(q.y), mix(C.fire[3]!, 0xffffff, r() * 0.5), Math.round(210 * (1 - t)));
    }
  }
  if (pose.daze) {
    for (let k = 0; k < 3; k++) {
      const a = pose.frame * 0.9 + (k * Math.PI * 2) / 3;
      sparkle(buf, Math.round(64 + Math.cos(a) * 14), Math.round(34 + Math.sin(a) * 4), C.fire[3]!, 2, 230);
    }
  }
}

// ======================================================================= BELLROOT

interface BPose {
  ph: number;
  sway: number;
  armL: number; // 0 rest, 1 raised, -1 slam
  armR: number;
  glow: number;
  ring: number; // bell vibration rings 0..1
  open: number; // core exposure 0..1
  slump: number;
  frame: number;
}

function bellPose(state: string, i: number, n: number): BPose {
  const p: BPose = { ph: (i / n) * Math.PI * 2, sway: 0, armL: 0, armR: 0, glow: 0.4, ring: 0, open: 0, slump: 0, frame: i };
  switch (state) {
    case 'idle':
    case 'run':
      p.sway = Math.sin(p.ph) * 1.2;
      p.glow = 0.4 + Math.sin(p.ph) * 0.15;
      p.armL = Math.sin(p.ph) * 0.08;
      p.armR = -Math.sin(p.ph) * 0.08;
      break;
    case 'windup': {
      const t = (i + 1) / n;
      p.armL = p.armR = t;
      p.glow = 0.4 + t * 0.5;
      p.sway = -t * 2;
      break;
    }
    case 'attack': {
      const seq = [-1, -1, -0.8, -0.5, -0.2, 0];
      p.armL = p.armR = seq[i] ?? 0;
      p.ring = i < 5 ? (i + 1) / 5 : 0;
      p.glow = 1 - i * 0.12;
      p.sway = i === 0 ? 2 : i === 1 ? -1.5 : i === 2 ? 1 : 0;
      break;
    }
    case 'stagger':
    case 'death':
      p.open = 1;
      p.slump = 1;
      p.armL = p.armR = -0.35;
      p.glow = state === 'stagger' ? 0.8 + (i === 1 ? 0.2 : 0) : 0.6;
      p.sway = state === 'stagger' ? (i - 1) * 1.5 : 0;
      break;
    default:
      break;
  }
  return p;
}

const BX = 80;
const BGY = 146;

function bellProfile(t: number): number {
  return 11 + 7 * t + 21 * Math.pow(t, 3.2) + (t > 0.84 ? Math.pow((t - 0.84) / 0.16, 1.5) * 6 : 0);
}

function drawBellroot(p: Painter, pose: BPose): void {
  const C = PALETTES.bellroot;
  const sw = pose.sway;
  const slump = pose.slump * 6;
  const bellTop = 48 + slump;
  const bellBot = 106 + slump * 0.4;
  const bx = BX + sw;
  const steps = 24;
  // ---- stone pillar legs with iron bands
  for (const sd of [-1, 1]) {
    const hx = bx + sd * 15;
    const fx = BX + sd * (24 + pose.slump * 3);
    const ky = (bellBot + BGY) / 2 + 2;
    const kx = (hx + fx) / 2 + sd * 3;
    p.capsule(hx, bellBot - 6, kx, ky, 10, 8.5).capsule(kx, ky, fx, BGY - 7, 8.5, 9).fill(C.stone, { mode: 'cyl', dither: true });
    p.capsule(kx - 9, ky - 1, kx + 9, ky + 1, 2.2, 2.2).fill(C.iron, { mode: 'cyl', inner: true });
    p.ellipse(fx + sd * 2, BGY - 4, 13, 5.5).fill(C.stone, { mode: 'sphere', dither: true });
    p.px(kx - 5, ky - 1, C.iron[4]!).px(kx + 4, ky, C.iron[4]!);
  }
  // ---- cracked bronze bell torso
  const left: number[] = [];
  const right: number[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const y = lerp(bellTop, bellBot, t);
    const w = bellProfile(t);
    right.push(bx + w, y);
    left.unshift(bx - w, y);
  }
  const lipW = bellProfile(1);
  const lipArc: number[] = [];
  for (let k = 0; k <= 16; k++) {
    const a = (k / 16) * Math.PI;
    lipArc.push(bx + Math.cos(a) * lipW, bellBot + Math.sin(a) * 7);
  }
  p.poly([...right, ...lipArc, ...left]).ellipse(bx, bellTop + 2, 11, 6).fill(C.bell, { mode: 'cyl', cx: bx - 4, dither: true, light: -0.08 });
  const streak = (k0: number, k1: number, tone: number, alpha: number): void => {
    const a: number[] = [];
    const b: number[] = [];
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const y = lerp(bellTop, bellBot, t);
      const w = bellProfile(t);
      a.push(bx + w * k0, y);
      b.unshift(bx + w * k1, y);
    }
    p.poly([...a, ...b]).fill(C.bell, { mode: 'flat', tone, alpha, inner: false });
  };
  streak(-0.62, -0.5, 3, 170);
  streak(0.3, 0.6, 0, 140);
  // verdigris patina blotches
  const vr = rng(55);
  for (let k = 0; k < 7; k++) {
    const t = 0.2 + vr() * 0.7;
    const w = bellProfile(t);
    const x = bx + (vr() - 0.5) * w * 1.6;
    const y = lerp(bellTop, bellBot, t);
    p.ellipse(x, y, 2.5 + vr() * 2, 1.6 + vr());
  }
  p.fill([0x1c3a32, 0x2c5a4c, 0x3e7a66, 0x5a9a80], { mode: 'sphere', dither: true, inner: false, alpha: 200 });
  // rim
  const rimT: number[] = [];
  const rimB: number[] = [];
  for (let k = 0; k <= 20; k++) {
    const a = (k / 20) * Math.PI;
    rimT.push(bx + Math.cos(a) * (lipW - 0.5), bellBot - 4 + Math.sin(a) * 7);
    rimB.unshift(bx + Math.cos(a) * lipW, bellBot + 1.5 + Math.sin(a) * 7);
  }
  p.poly([...rimT, ...rimB]).fill(C.bell, { mode: 'cyl', cx: bx - 6, light: 0.12 });
  for (const t of [0.3, 0.62]) {
    const y = lerp(bellTop, bellBot, t);
    const w = bellProfile(t);
    const top: number[] = [];
    const bot: number[] = [];
    for (let k = 0; k <= 18; k++) {
      const a = (k / 18) * Math.PI;
      top.push(bx + Math.cos(a) * w, y + Math.sin(a) * w * 0.18);
      bot.unshift(bx + Math.cos(a) * w, y + 2.5 + Math.sin(a) * w * 0.18);
    }
    p.poly([...top, ...bot]).fill(C.bell, { mode: 'cyl', cx: bx - 6, light: -0.32, inner: false });
  }
  // glowing runes
  const runeY = lerp(bellTop, bellBot, 0.47);
  for (let k = -2; k <= 2; k++) {
    const x = bx + k * 9.5;
    const y = runeY + Math.abs(k) * -0.6 + 4;
    const g = C.core;
    const col = pose.glow > 0.6 ? g[3]! : g[2]!;
    p.gpx(x, y, col, g[2]!).gpx(x, y + 1, col, g[2]!).gpx(x - 1, y + 1, col, g[2]!).gpx(x + (k % 2 ? 1 : -1), y - 1, col, g[2]!);
  }
  // the crack: a jagged split leaking molten light
  const crack: [number, number][] = [
    [bx - 6, bellTop + 4],
    [bx - 2, bellTop + 12],
    [bx - 7, bellTop + 20],
    [bx - 1, bellTop + 30],
    [bx - 5, bellTop + 38],
  ];
  for (let k = 0; k + 1 < crack.length; k++) {
    const [ax, ay] = crack[k]!;
    const [cx2, cy2] = crack[k + 1]!;
    p.capsule(ax, ay, cx2, cy2, 0.9, 0.9);
  }
  p.fill(C.core, { mode: 'flat', tone: 1 + Math.round(pose.glow), glow: C.core[2]!, inner: false });
  // core window
  const coreY = lerp(bellTop, bellBot, 0.74);
  const coreR = 7 + pose.open * 6 + pose.glow * 1.5;
  if (pose.open > 0) {
    p.poly([bx - 16, coreY - 18, bx + 14, coreY - 20, bx + 19, coreY + 12, bx - 18, coreY + 13]).fill([0x140808, 0x200c0a, 0x2c120c, 0x3a1a10], {
      mode: 'flat',
      tone: 1,
      inner: false,
    });
    p.circle(bx, coreY - 2, coreR).fill(C.core, { mode: 'sphere', glow: C.core[3]!, light: 0.2 + pose.glow * 0.2, inner: false });
    p.circle(bx - 3, coreY - 5, coreR * 0.4).fill(C.core, { mode: 'flat', tone: 4, inner: false });
    for (let k = 0; k < 8; k++) {
      const x = bx - 16 + k * 4.5;
      p.poly([x, coreY - 19 - (k % 2) * 2, x + 3, coreY - 15, x - 1, coreY - 14]);
    }
    p.fill(C.bell, { mode: 'emboss' });
  } else {
    p.circle(bx, coreY, coreR).fill(C.core, { mode: 'sphere', glow: C.core[3]!, light: pose.glow * 0.25, inner: false });
    // iron grate over the core
    for (let k = 0; k < 4; k++) {
      const x0 = bx - 9 + k * 6;
      p.capsule(x0, coreY - 10, x0, coreY + 10, 1.4, 1.4);
    }
    p.capsule(bx - 12, coreY - 2, bx + 12, coreY - 2, 1.5, 1.5).capsule(bx - 11, coreY + 5, bx + 11, coreY + 5, 1.4, 1.4);
    p.fill(C.iron, { mode: 'emboss' });
  }
  // heavy chains slung across the bell
  const chainLinks = (x0: number, y0: number, x1: number, y1: number, sag: number): void => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 3.2);
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = lerp(x0, x1, t);
      const y = lerp(y0, y1, t) + Math.sin(t * Math.PI) * sag;
      if (k % 2) p.ellipse(x, y, 1.9, 1.1);
      else p.ellipse(x, y, 1.1, 1.9);
    }
    p.fill(C.iron, { mode: 'sphere', light: 0.1 });
  };
  chainLinks(bx - 24, bellTop + 14, bx + 30, bellTop + 40, 6);
  // moss on the shoulders
  for (let k = 0; k < 9; k++) {
    const t = k / 8;
    const x = bx + (t - 0.5) * 34;
    const y = bellTop + 3 + Math.abs(t - 0.5) * 10;
    p.ellipse(x, y, 5, 3.5);
    if (k % 3 === 1) p.capsule(x, y, x + Math.sin(pose.ph + k) * 1.5, y + 10 + (k % 2) * 6, 1.4, 0.9);
  }
  p.fill(C.moss, { mode: 'sphere', dither: true });
  // ---- stone arms with iron bands, boulder fists
  const arm = (side: number, a: number): void => {
    const sx = bx + side * (bellProfile(0.3) + 8);
    const sy = bellTop + 14;
    let ex: number;
    let ey: number;
    let hx: number;
    let hy: number;
    if (a >= 0) {
      ex = bx + side * lerp(50, 46, a);
      ey = lerp(sy + 22, sy - 22, a);
      hx = bx + side * lerp(46, 22, a);
      hy = lerp(sy + 46, 12, a);
    } else {
      const t = -a;
      ex = bx + side * lerp(50, 52, t);
      ey = lerp(sy + 22, sy + 4, t);
      hx = bx + side * lerp(46, 33, t);
      hy = lerp(sy + 46, sy + 24, t);
    }
    p.capsule(sx, sy, ex, ey, 9.5, 8).capsule(ex, ey, hx, hy, 8, 7).fill(C.stone, { mode: 'cyl', dither: true });
    // iron cuffs at elbow and wrist
    for (const [x, y, w] of [
      [ex, ey, 9],
      [lerp(ex, hx, 0.7), lerp(ey, hy, 0.7), 7.5],
    ] as const) {
      const dx = hx - ex;
      const dy = hy - ey;
      const L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L;
      const ny = dx / L;
      p.capsule(x - nx * w, y - ny * w, x + nx * w, y + ny * w, 1.9, 1.9);
    }
    p.fill(C.iron, { mode: 'cyl' });
    p.ellipse(sx + side * 2, sy - 5, 9, 5).fill(C.iron, { mode: 'sphere' });
    p.ellipse(sx + side * 3, sy - 7.5, 6, 3).fill(C.moss, { mode: 'sphere', dither: true, inner: false });
    p.circle(hx, hy, 8.5).fill(C.stone, { mode: 'sphere', dither: true });
    p.line(hx - 4, hy - 2, hx + 2, hy + 4).fill(C.stone, { mode: 'flat', tone: 0, inner: false });
    // a broken chain dangling from the wrist
    if (side > 0) chainLinks(hx + 4, hy + 4, hx + 8, hy + 22, 2);
  };
  arm(-1, pose.armL);
  arm(1, pose.armR);
  // ---- head: carved stone block with an iron brow band and molten eyes
  const hy = bellTop - 13 + (pose.slump ? 4 : 0);
  const hx = bx + sw * 0.5 + (pose.slump ? 3 : 0);
  p.ellipse(bx, bellTop - 2, 8, 6).minus().ellipse(bx, bellTop - 3, 4, 3).fill(C.bell, { mode: 'sphere' });
  p.poly([hx - 12, hy - 8, hx + 12, hy - 9, hx + 13, hy + 7, hx + 8, hy + 11, hx - 8, hy + 11, hx - 13, hy + 6]).fill(C.stone, { mode: 'emboss', dither: true, light: 0.05 });
  // broken iron crown spikes
  for (let k = -2; k <= 2; k++) {
    const x = hx + k * 5;
    const h = k === 0 ? 8 : k % 2 ? 5 : 3;
    p.poly([x - 2, hy - 7, x + 2, hy - 7.5, x + 0.5, hy - 7 - h]);
  }
  p.rect(hx - 13, hy - 4, 26, 3.5).fill(C.iron, { mode: 'emboss' });
  p.fill(C.iron, { mode: 'emboss' });
  p.ellipse(hx - 4, hy - 9, 5, 2).fill(C.moss, { mode: 'sphere', dither: true, inner: false });
  const eyeCol = pose.slump ? C.eye[1]! : pose.glow > 0.7 ? C.eye[4]! : C.eye[3]!;
  for (const sd of [-1, 1]) {
    const ex = hx + sd * 5;
    p.gpx(ex - 1, hy + 1, eyeCol, C.eye[2]!).gpx(ex, hy + 1, eyeCol, C.eye[2]!).gpx(ex + 1, hy + 1, eyeCol, C.eye[2]!).gpx(ex + sd, hy, eyeCol, C.eye[2]!);
  }
  const mouthOpen = pose.ring > 0 ? 2 : pose.slump ? 1 : 0;
  p.poly([hx - 5, hy + 6, hx + 5, hy + 6, hx + 3, hy + 7 + mouthOpen, hx - 3, hy + 7 + mouthOpen]).fill(C.core, {
    mode: 'flat',
    tone: 1,
    glow: C.core[2]!,
    inner: false,
  });
  p.line(hx + 6, hy - 1, hx + 10, hy + 6).fill(C.stone, { mode: 'flat', tone: 0, inner: false });
}

function bellOverlay(buf: PixelBuffer, pose: BPose, seed: number): void {
  const r = rng(seed);
  const C = PALETTES.bellroot;
  // embers rising from the molten crack and core
  for (let k = 0; k < 7; k++) {
    const x = Math.round(66 + r() * 28);
    const y = Math.round(40 + r() * 70);
    buf.blend(x, y, k % 2 ? C.core[3]! : C.core[2]!, Math.round(120 + pose.glow * 120));
  }
  if (pose.ring > 0) {
    for (let w = 0; w < 2; w++) {
      const rad = 30 + pose.ring * 40 + w * 12;
      for (let k = 0; k < 140; k++) {
        const a = (k / 140) * Math.PI * 2;
        const x = Math.round(BX + Math.cos(a) * rad);
        const y = Math.round(84 + Math.sin(a) * rad * 0.62);
        buf.blend(x, y, w ? C.core[3]! : 0xfff4b0, Math.round(200 * (1 - pose.ring * 0.7) * (w ? 0.6 : 1)));
      }
    }
  }
}

// ======================================================================= entry

export function renderBossFrame(id: 'prismstag' | 'bellroot', state: string, view: View, i: number, n: number, painter: Painter): PixelBuffer {
  const seed = (id === 'prismstag' ? 9000 : 7000) + i * 17 + view.charCodeAt(0) + state.length * 53;
  const isDeath = state === 'death';
  painter.reset();
  if (id === 'prismstag') {
    const pose = stagPose(state, isDeath ? 0 : i, n);
    const P = new Proj(64, 112, VIEW_ANGLE[view]);
    const at = (f: number, r: number, z: number): Pt => P.p(f + pose.lean * Math.min(1.2, z / 50), r, z);
    const c: SC = { p: painter, P, pose, at, g: (f, r, z) => P.p(f, r, z) };
    drawParts(prismstagParts(c));
    painter.finish();
    const out = painter.buf.clone();
    rimTopLeft(out, 0.28);
    if (isDeath) return bossDeath(out, i, n, seed, PALETTES.prismstag.bone[2]!, PALETTES.prismstag.fire[3]!, 112);
    stagOverlay(out, view, pose, seed);
    return out;
  }
  const pose = bellPose(state, isDeath ? 0 : i, n);
  drawBellroot(painter, pose);
  painter.finish();
  const out = painter.buf.clone();
  rimTopLeft(out, 0.26);
  if (isDeath) return bossDeath(out, i, n, seed, PALETTES.bellroot.stone[3]!, PALETTES.bellroot.core[2]!, 146);
  bellOverlay(out, pose, seed);
  if (state === 'stagger' && i === 0) flash(out, 0.45, 0xfff0c0);
  return out;
}

/** Bone/stone chunks scatter while ghost-fire or molten embers spray and settle on the floor. */
function bossDeath(base: PixelBuffer, i: number, n: number, seed: number, tint: number, ember: number, groundY: number): PixelBuffer {
  if (i === 0) {
    flash(base, 0.5, 0xffffff);
    return base;
  }
  const t = Math.pow(i / (n - 1), 1.2);
  const out = shatter(base, t * 0.97, seed, tint, 34, 2.4, { glint: true, drops: { color: ember, count: 46, groundY } });
  const r = rng(seed);
  for (let k = 0; k < 6; k++) {
    sparkle(out, Math.round(base.w * (0.2 + r() * 0.6)), Math.round(base.h * (0.2 + r() * 0.6)), ember, 1, Math.round(255 * (1 - t * 0.6)));
  }
  return out;
}
