/**
 * The Corrupted Core (id corruptcore, 160x160, views e/se/s/ne/n) and its adds: the Watcher Drone (coredrone, 48x48)
 * and the Sentry Turret (coreturret, 48x48), both front only.
 * A giant floating eye of gunmetal plates wrapped in an orbital ring, broken monitors orbiting it, cables hanging below.
 * The eye looks where the Core faces (views), which is the Mirror Split tell: an echo's eye stares at nothing.
 * Pure (no DOM / Phaser).
 */
import { Painter, PixelBuffer, flash, mix, rimTopLeft, rng, shatter, sparkle, type Ramp } from './pixel';
import type { View } from './rig';

const R = (...c: number[]): Ramp => Object.freeze(c);

const SHELL = R(0x141824, 0x262e42, 0x3e4a66, 0x64749a, 0xa4b4d4);
const PLATE = R(0x1c2030, 0x323a50, 0x525c78, 0x7a86a4, 0xb8c4dc);
const DARK = R(0x040508, 0x0a0c12, 0x12141c, 0x1c2030);
const CYAN = R(0x053640, 0x0b7488, 0x20cce0, 0x8af2ff, 0xeaffff);
const MAG = R(0x380632, 0x78106c, 0xcc28b4, 0xff7ee4, 0xffe8fa);
const RED = R(0x380606, 0x7a1010, 0xd02a1e, 0xff7a5a, 0xffd8c8);
const GLASS = R(0x03060a, 0x07121e, 0x0e2236, 0x1a3a58);
const CABLE = R(0x050507, 0x0e0e12, 0x1a1a22, 0x2a2a36);
const CABLE_R = R(0x200608, 0x40100e, 0x6a1c18, 0x983028);
const CABLE_B = R(0x06141e, 0x0c2a3a, 0x164a62, 0x2a7090);
const COPPER = R(0x3a1a08, 0x7a4018, 0xc07a30, 0xf0b060, 0xfff0c0);

// ======================================================================= THE CORRUPTED CORE

interface CPose {
  ph: number;
  bob: number;
  glow: number;
  /** iris dilation 0..1 (wind-up) */
  dilate: number;
  /** anger: the iris and screens shift from cyan to magenta / red */
  red: number;
  /** attack glare 0..1 */
  flare: number;
  /** cables rise 0..1 */
  lift: number;
  /** stagger: the eye cracks, screens show errors, the body lists */
  crack: number;
  tilt: number;
  /** horizontal glitch slicing 0..1 */
  glitch: number;
  /** hit flinch 0..1 */
  hurt: number;
  /** orbit phase of the monitors (0..1) */
  spin: number;
  frame: number;
}

function corePose(state: string, i: number, n: number): CPose {
  const p: CPose = { ph: (i / n) * Math.PI * 2, bob: 0, glow: 0.5, dilate: 0, red: 0, flare: 0, lift: 0, crack: 0, tilt: 0, glitch: 0, hurt: 0, spin: i / Math.max(1, n), frame: i };
  switch (state) {
    case 'idle':
    case 'run':
      p.bob = Math.sin(p.ph) * 2;
      p.glow = 0.5 + 0.2 * Math.sin(p.ph);
      p.lift = 0.15 + 0.15 * Math.sin(p.ph + 1);
      break;
    case 'windup': {
      const t = (i + 1) / n;
      p.dilate = t; p.red = t; p.glow = 0.6 + 0.4 * t; p.lift = 0.3 + 0.7 * t; p.bob = -2 * t; p.spin = 0.15 * t;
      break;
    }
    case 'attack': {
      const seq = [1, 0.9, 0.7, 0.45, 0.25, 0.1];
      p.flare = seq[i] ?? 0; p.red = 1 - i * 0.15; p.glow = 1; p.dilate = Math.max(0, 1 - i * 0.18); p.lift = 1 - i * 0.12; p.bob = -2 + i * 0.4;
      p.spin = 0.15 + i * 0.03;
      break;
    }
    case 'stagger':
      p.crack = 1; p.glitch = 0.8; p.tilt = (i - 1) * 3; p.glow = 0.2 + (i === 1 ? 0.15 : 0); p.red = 0.5; p.bob = 4 + (i % 2); p.lift = 0;
      break;
    case 'hit':
      p.hurt = 1 - i * 0.5; p.glitch = 0.6 - i * 0.3; p.glow = 0.7; p.bob = 1;
      break;
    case 'death':
      p.crack = 1; p.glow = 0.3; p.red = 0.6;
      break;
    default:
      break;
  }
  return p;
}

const CX = 80;
const CY0 = 62;
const SR = 34;
const GROUND = 150;

/** Eye socket per view: offset from the sphere centre, radii (null = the eye faces away). */
const SOCKET: Record<View, { ox: number; oy: number; rx: number; ry: number } | null> = {
  s: { ox: 0, oy: 11, rx: 17, ry: 15 },
  se: { ox: 15, oy: 8, rx: 13, ry: 14.5 },
  e: { ox: 24, oy: 2, rx: 8, ry: 14 },
  ne: { ox: 17, oy: -10, rx: 9.5, ry: 7 },
  n: null,
};

function bezier(p0: [number, number], c: [number, number], p1: [number, number], t: number): [number, number] {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]];
}

function cable(p: Painter, a: [number, number], c: [number, number], b: [number, number], r0: number, r1: number, ramp: Ramp, light = 0): void {
  const N = 9;
  let prev = a;
  for (let k = 1; k <= N; k++) {
    const q = bezier(a, c, b, k / N);
    p.capsule(prev[0], prev[1], q[0], q[1], r0 + (r1 - r0) * ((k - 1) / N), r0 + (r1 - r0) * (k / N));
    prev = q;
  }
  p.fill(ramp, { mode: 'cyl', light });
}

/** Plug at a cable's end: a steel sleeve with copper prongs (and a spark when live). */
function plug(p: Painter, x: number, y: number, live: boolean, col: number): void {
  p.rect(x - 2.5, y - 1, 5, 5).fill(PLATE, { mode: 'emboss' });
  p.px(x - 1.5, y + 4, COPPER[3]!).px(x + 1, y + 4, COPPER[3]!).px(x - 1.5, y + 5, COPPER[2]!).px(x + 1, y + 5, COPPER[2]!);
  if (live) p.gpx(x, y + 6, 0xffffff, col).gpx(x - 1, y + 7, col, col).gpx(x + 2, y + 7, col, col);
}

/** A broken monitor: bezel, glowing screen with scanlines and glyphs (red when the Core is angry, static when staggered). */
function monitor(p: Painter, x: number, y: number, s: number, pose: CPose, seed: number, back: boolean): void {
  const w = 16 * s, h = 11 * s;
  const sk = (seed % 2 ? 1 : -1) * 2 * s;
  p.poly([x - w / 2, y - h / 2 + sk, x + w / 2, y - h / 2 - sk, x + w / 2, y + h / 2 - sk, x - w / 2, y + h / 2 + sk]).fill(PLATE, { mode: 'emboss', light: back ? -0.35 : 0 });
  const iw = w - 4 * s, ih = h - 4 * s;
  const scr = pose.crack ? RED : pose.red > 0.5 ? MAG : CYAN;
  p.poly([x - iw / 2, y - ih / 2 + sk * 0.8, x + iw / 2, y - ih / 2 - sk * 0.8, x + iw / 2, y + ih / 2 - sk * 0.8, x - iw / 2, y + ih / 2 + sk * 0.8])
    .fill(GLASS, { mode: 'flat', tone: 2, inner: false });
  if (back) return;
  const r = rng(seed * 31 + pose.frame);
  const lit = scr[3]!, halo = scr[2]!;
  // glyph rows / static
  for (let row = 0; row < ih - 1; row += 2) {
    const yy = y - ih / 2 + 1 + row;
    for (let xx = x - iw / 2 + 1; xx < x + iw / 2 - 1; xx++) {
      const on = pose.crack ? r() < 0.45 : r() < 0.35 + pose.glow * 0.25;
      if (!on) continue;
      const t = (xx - (x - iw / 2)) / iw;
      const yk = yy - sk * 0.8 * (2 * t - 1);
      if (r() < 0.25) p.gpx(xx, yk, lit, halo);
      else p.px(xx, yk, scr[1]!);
    }
  }
  // a crack across one screen
  if (seed % 3 === 0) for (let k = 0; k < 6 * s; k++) p.px(x - 3 * s + k, y - 2 * s + (k % 3) - 1, 0xd8e8f0, 200);
}

/** Back of the Core (view n): heat-sink fins, cable ports and a blinking status light. */
function coreBack(p: Painter, cx: number, cy: number, pose: CPose): void {
  for (let k = -3; k <= 3; k++) {
    const x = cx + k * 5;
    p.poly([x - 1.5, cy - 14 + Math.abs(k) * 2, x + 1.5, cy - 14 + Math.abs(k) * 2, x + 1.5, cy + 10 - Math.abs(k), x - 1.5, cy + 10 - Math.abs(k)]);
  }
  p.fill(PLATE, { mode: 'cyl', cx });
  for (const k of [-1, 1]) p.circle(cx + k * 9, cy + 14, 3.2).fill(DARK, { mode: 'sphere' });
  const on = pose.frame % 2 === 0;
  p.gpx(cx, cy - 18, on ? RED[3]! : RED[1]!, RED[2]!).gpx(cx + 1, cy - 18, on ? RED[4]! : RED[1]!, RED[2]!);
}

/** A limp cable hanging from the Core's underside: an S-curl swaying with the phase, ending well above the floor. */
function tentacle(p: Painter, ax: number, ay: number, spread: number, len: number, phase: number, r0: number, r1: number, ramp: Ramp, light: number): [number, number] {
  const N = 12;
  let px = ax, py = ay;
  for (let k = 1; k <= N; k++) {
    const t = k / N;
    const x = ax + spread * t + Math.sin(t * Math.PI * 1.6 + phase) * 4 * t;
    const y = ay + len * t;
    p.capsule(px, py, x, y, r0 + (r1 - r0) * ((k - 1) / N), r0 + (r1 - r0) * t);
    px = x; py = y;
  }
  p.fill(ramp, { mode: 'cyl', light });
  return [px, py];
}

function drawCore(p: Painter, view: View, pose: CPose): void {
  const cy = CY0 + pose.bob;
  const cx = CX + pose.tilt * 0.4;
  const angry = pose.red > 0.5;
  const glowCol = pose.crack ? RED : angry ? MAG : CYAN;
  // ---- hover field on the floor
  const fr = 16 + pose.glow * 5;
  for (let k = 0; k < 56; k++) {
    const a = (k / 56) * Math.PI * 2;
    if (k % 2) continue;
    p.px(CX + Math.cos(a) * fr, GROUND - 3 + Math.sin(a) * fr * 0.36, glowCol[2]!, Math.round(50 + pose.glow * 70));
  }
  // ---- monitors: two flank the Core, one hangs behind its crown (never in front of the eye)
  const b1 = Math.sin(pose.ph) * 2, b2 = Math.sin(pose.ph + 2) * 2, drift = Math.sin(pose.spin * Math.PI * 2) * 2;
  monitor(p, cx + 34 + drift, cy - 40 + b2, 0.85, pose, 13, true);
  // ---- cables behind the shell
  const sway = pose.ph;
  const lift = pose.lift * 14;
  const hang = (dx: number) => cy + Math.sqrt(Math.max(0, SR * SR - dx * dx)) - 5;
  const len = SR + 30 - lift;
  tentacle(p, cx - 16, hang(-16), -18, len - 4, sway, 3, 1.8, CABLE, -0.3);
  tentacle(p, cx + 14, hang(14), 22, len - 8, sway + 1.3, 3, 1.8, CABLE_B, -0.3);
  tentacle(p, cx + 3, hang(3), 6, len + 2, sway + 2.2, 2.6, 1.6, CABLE, -0.35);
  // ---- halo ring round the crown, far half
  const ring = (front: boolean): void => {
    const pts: number[] = [];
    const ry0 = cy - 15;
    const a0 = front ? 0 : Math.PI, a1 = front ? Math.PI : Math.PI * 2;
    for (let k = 0; k <= 28; k++) { const a = a0 + ((a1 - a0) * k) / 28; pts.push(cx + Math.cos(a) * 47, ry0 + Math.sin(a) * 9); }
    for (let k = 28; k >= 0; k--) { const a = a0 + ((a1 - a0) * k) / 28; pts.push(cx + Math.cos(a) * 41.5, ry0 + Math.sin(a) * 6.5); }
    p.poly(pts).fill(PLATE, { mode: 'emboss', light: front ? 0.05 : -0.3 });
    for (let k = 0; k < 10; k++) {
      const a = (k / 10 + pose.spin * 0.5) * Math.PI * 2;
      if ((Math.sin(a) > 0) !== front) continue;
      p.gpx(cx + Math.cos(a) * 44.2, ry0 + Math.sin(a) * 7.8, front ? glowCol[3]! : glowCol[1]!, glowCol[2]!);
    }
  };
  ring(false);
  // ---- the crown: three data spires
  for (const k of [-1, 0, 1]) {
    const x = cx + k * 12, h = k === 0 ? 16 : 10, y0 = cy - SR + 5 + Math.abs(k) * 4;
    p.poly([x - 2.6, y0, x + 2.6, y0, x + 0.7, y0 - h, x - 0.7, y0 - h]);
  }
  p.fill(PLATE, { mode: 'cyl', cx });
  for (const k of [-1, 0, 1]) {
    const on = (pose.frame + k + 3) % 3 !== 0 || pose.flare > 0.3;
    p.gpx(cx + k * 12, cy - SR + 5 + Math.abs(k) * 4 - (k === 0 ? 16 : 10), on ? glowCol[4] ?? glowCol[3]! : glowCol[1]!, glowCol[2]!);
  }
  // ---- the sphere: gunmetal shell with panel seams and rivets
  p.circle(cx, cy, SR).fill(SHELL, { mode: 'sphere', dither: true, light: 0.05 });
  for (const t of [-0.5, 0.05, 0.6]) {
    const y = cy + t * SR, w = Math.sqrt(Math.max(0, 1 - t * t)) * SR;
    const pts: number[] = [];
    for (let k = 0; k <= 18; k++) { const a = (k / 18) * Math.PI; pts.push(cx - Math.cos(a) * w, y + Math.sin(a) * w * 0.18); }
    for (let k = 18; k >= 0; k--) { const a = (k / 18) * Math.PI; pts.push(cx - Math.cos(a) * w, y + 1.3 + Math.sin(a) * w * 0.18); }
    p.poly(pts).fill(DARK, { mode: 'flat', tone: 1, inner: false });
  }
  for (let k = 0; k < 11; k++) {
    const a = -0.2 + (k / 10) * (Math.PI + 0.4);
    p.px(cx - Math.cos(a) * (SR - 3), cy + 0.05 * SR + Math.sin(a) * (SR - 3) * 0.18 - 1, PLATE[4]!);
  }
  // the underside skirt where the cables come out
  p.ellipse(cx, cy + SR - 5, 17, 5).fill(DARK, { mode: 'sphere', inner: false });
  for (let k = -2; k <= 2; k++) p.px(cx + k * 6, cy + SR - 5, glowCol[1]!);
  // armour lappets over the flanks
  for (const sd of [-1, 1]) {
    p.poly([cx + sd * (SR - 7), cy - 20, cx + sd * (SR + 5), cy - 8, cx + sd * (SR + 4), cy + 12, cx + sd * (SR - 6), cy + 5]).fill(PLATE, { mode: 'emboss', light: sd < 0 ? 0.1 : -0.2 });
    p.px(cx + sd * (SR - 1), cy - 6, PLATE[4]!).px(cx + sd * (SR), cy + 4, PLATE[4]!);
  }
  // ---- the eye (or, facing away, the back of the Core)
  const sock = SOCKET[view];
  if (!sock) coreBack(p, cx, cy, pose);
  else {
    const ex = cx + sock.ox, ey = cy + sock.oy;
    p.ellipse(ex, ey, sock.rx + 3.5, sock.ry + 3.5).fill(PLATE, { mode: 'sphere', light: 0.2 });
    // aperture blades round the lens
    for (let s2 = 0; s2 < 8; s2++) {
      const a = (s2 / 8) * Math.PI * 2;
      p.px(ex + Math.cos(a) * (sock.rx + 2), ey + Math.sin(a) * (sock.ry + 2), DARK[0]!);
    }
    p.ellipse(ex, ey, sock.rx + 1, sock.ry + 1).fill(DARK, { mode: 'flat', tone: 0, inner: false });
    p.ellipse(ex, ey, sock.rx, sock.ry).fill(GLASS, { mode: 'sphere', inner: false });
    const k = 0.15 + pose.hurt * -0.08;
    const ix = ex + sock.ox * k * 0.6, iy = ey + sock.oy * k * 0.6;
    const irx = sock.rx * (0.62 + pose.dilate * 0.16), iry = sock.ry * (0.62 + pose.dilate * 0.16);
    const iris = pose.crack ? RED : angry ? MAG : CYAN;
    p.ellipse(ix, iy, irx, iry).fill(iris, { mode: 'sphere', glow: iris[3]!, light: -0.1 + pose.glow * 0.35, inner: false });
    p.ellipse(ix, iy, irx * 0.62, iry * 0.62).fill(iris, { mode: 'flat', tone: angry ? 3 : 2, glow: iris[3]!, inner: false });
    // iris spokes
    for (let s2 = 0; s2 < 12; s2++) {
      const a = (s2 / 12) * Math.PI * 2 + pose.spin;
      p.px(ix + Math.cos(a) * irx * 0.8, iy + Math.sin(a) * iry * 0.8, iris[1]!);
    }
    // pupil: a round lens, a slit when angry, a pinprick when hurt
    const pr = Math.max(1, Math.min(irx, iry) * (pose.hurt > 0.4 ? 0.18 : angry ? 0.3 : 0.38));
    if (angry && !pose.crack) p.ellipse(ix, iy, Math.max(1, pr * 0.45), pr * 1.6).fill(DARK, { mode: 'flat', tone: 0, inner: false });
    else p.ellipse(ix, iy, pr, pr).fill(DARK, { mode: 'flat', tone: 0, inner: false });
    p.gpx(ix - irx * 0.35, iy - iry * 0.4, 0xffffff, iris[3]!).gpx(ix - irx * 0.35 + 1, iy - iry * 0.4, 0xffffff, iris[3]!);
    if (pose.crack) {
      // a lightning crack across the lens
      let x = ex - sock.rx * 0.8, y = ey - sock.ry * 0.5;
      for (let s2 = 0; s2 < 8; s2++) { const nx = x + sock.rx * 0.22, ny = y + (s2 % 2 ? 2 : -1) + 0.7; p.capsule(x, y, nx, ny, 0.5, 0.5); x = nx; y = ny; }
      p.fill(R(0xc8e0f0, 0xe8f4ff, 0xffffff, 0xffffff), { mode: 'flat', tone: 2, inner: false });
    }
    if (pose.flare > 0) {
      // glare spokes from the lens
      for (let s2 = 0; s2 < 8; s2++) {
        const a = (s2 / 8) * Math.PI * 2 + 0.2;
        const ln = 8 + pose.flare * 20;
        for (let t = 2; t < ln; t++) p.px(ix + Math.cos(a) * (irx * 0.4 + t), iy + Math.sin(a) * (iry * 0.4 + t) * 0.8, s2 % 2 ? iris[3]! : 0xffffff, Math.round(230 * pose.flare * (1 - t / ln)));
      }
    }
  }
  // ---- halo ring, near half; the flanking monitors
  ring(true);
  monitor(p, cx - 58, cy - 2 + b1, 1, pose, 11, false);
  monitor(p, cx + 58, cy - 10 + b2, 1, pose, 12, false);
  // ---- front cables with live plugs
  const e1 = tentacle(p, cx - 24, hang(-24), -16, len - 10, sway + 0.6, 3, 2, CABLE_R, 0);
  const e2 = tentacle(p, cx - 6, hang(-6), -4, len, sway + 1.9, 2.8, 1.8, CABLE, 0.05);
  const e3 = tentacle(p, cx + 22, hang(22), 16, len - 12, sway + 3.1, 2.8, 1.8, CABLE_B, 0);
  plug(p, e1[0], e1[1], pose.frame % 3 === 0 || pose.flare > 0.2, glowCol[3]!);
  plug(p, e2[0], e2[1], pose.frame % 3 === 1 || pose.lift > 0.8, glowCol[3]!);
  plug(p, e3[0], e3[1], pose.frame % 3 === 2, glowCol[3]!);
}

/** Horizontal glitch slicing: random row bands shift sideways, a few rows tint cyan / magenta. */
function glitchRows(buf: PixelBuffer, amt: number, seed: number): void {
  if (amt <= 0) return;
  const r = rng(seed);
  const bands = Math.round(2 + amt * 5);
  for (let b = 0; b < bands; b++) {
    const y0 = Math.floor(r() * buf.h), hgt = 1 + Math.floor(r() * 4), dx = Math.round((r() - 0.5) * 10 * amt);
    if (!dx) continue;
    for (let y = y0; y < Math.min(buf.h, y0 + hgt); y++) {
      const row: number[] = [];
      for (let x = 0; x < buf.w; x++) row.push(buf.get(x, y));
      for (let x = 0; x < buf.w; x++) {
        const v = row[(x - dx + buf.w) % buf.w]!;
        const a = v >>> 24;
        if (a) buf.set(x, y, b % 2 ? mix(v & 0xffffff, 0x40f0ff, 0.25) : mix(v & 0xffffff, 0xff40e0, 0.25), a);
        else buf.set(x, y, 0, 0);
      }
    }
  }
}

/** Chromatic split for a hit: a cyan ghost to one side, a magenta one to the other, under the body. */
function chroma(buf: PixelBuffer, amt: number): void {
  if (amt <= 0) return;
  const src = buf.clone();
  const d = Math.max(1, Math.round(amt * 3));
  for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
    if (buf.alpha(x, y) > 0) continue;
    const l = x + d < buf.w ? src.alpha(x + d, y) : 0, rr = x - d >= 0 ? src.alpha(x - d, y) : 0;
    if (l > 128) buf.set(x, y, 0x30e8ff, Math.round(150 * amt));
    else if (rr > 128) buf.set(x, y, 0xff30d8, Math.round(150 * amt));
  }
}

function coreOverlay(buf: PixelBuffer, pose: CPose, seed: number): void {
  const r = rng(seed);
  const col = pose.crack ? RED : pose.red > 0.5 ? MAG : CYAN;
  // drifting data motes
  for (let k = 0; k < 10; k++) {
    const x = Math.round(CX + (r() - 0.5) * 110), y = Math.round(20 + r() * 110);
    buf.blend(x, y, k % 3 ? col[3]! : 0xffffff, Math.round(80 + pose.glow * 120));
  }
  if (pose.crack) for (let k = 0; k < 3; k++) sparkle(buf, Math.round(CX - 20 + r() * 40), Math.round(CY0 - 10 + r() * 30), RED[3]!, 1, 220);
}

// ======================================================================= ADDS

function droneDraw(p: Painter, state: string, i: number, n: number): void {
  const ph = (i / n) * Math.PI * 2;
  const bob = state === 'death' ? 0 : Math.sin(ph) * 1.5;
  const wind = state === 'windup' ? (i + 1) / n : 0;
  const fire = state === 'attack' ? 1 - i / n : 0;
  const cx = 24, cy = 20 + bob;
  // rotor arms and blur
  for (const sd of [-1, 1]) {
    p.capsule(cx + sd * 6, cy - 1, cx + sd * 14, cy - 5, 1.4, 1).fill(PLATE, { mode: 'cyl' });
    const blur = i % 2 ? 7 : 5;
    p.ellipse(cx + sd * 14, cy - 6, blur, 1.4).fill(PLATE, { mode: 'flat', tone: 3, alpha: 150, inner: false });
  }
  p.circle(cx, cy, 8).fill(SHELL, { mode: 'sphere', light: 0.1 });
  p.rect(cx - 8, cy + 1, 16, 2).fill(DARK, { mode: 'flat', tone: 1, inner: false });
  const eye = wind > 0.5 || fire > 0 ? MAG : CYAN;
  p.circle(cx, cy - 1, 3.6 + wind).fill(eye, { mode: 'sphere', glow: eye[3]!, light: 0.2 + fire * 0.3, inner: false });
  p.circle(cx, cy - 1, 1.2).fill(DARK, { mode: 'flat', tone: 0, inner: false });
  // dangling antenna cable
  p.capsule(cx, cy + 7, cx + 2 + Math.sin(ph) * 2, cy + 13, 0.8, 0.6).fill(CABLE_R, { mode: 'cyl' });
  // hover light on the floor
  for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; p.px(cx + Math.cos(a) * 6, 41 + Math.sin(a) * 2, CYAN[2]!, 120); }
}

function turretDraw(p: Painter, state: string, i: number, n: number): void {
  const wind = state === 'windup' ? (i + 1) / n : 0;
  const fire = state === 'attack' ? Math.max(0, 1 - i / 2) : 0;
  const cx = 24, gy = 42;
  // tripod
  for (const [dx, dy] of [[-12, 0], [12, 0], [0, -3]]) p.capsule(cx, gy - 12, cx + dx, gy + dy - 1, 1.6, 1.4);
  p.fill(PLATE, { mode: 'cyl' });
  for (const [dx, dy] of [[-12, 0], [12, 0], [0, -3]]) p.ellipse(cx + dx, gy + dy, 2.5, 1.3);
  p.fill(DARK, { mode: 'sphere' });
  // pivot and armoured head
  p.circle(cx, gy - 13, 4).fill(SHELL, { mode: 'sphere' });
  const hy = gy - 21 + (fire ? 1 : 0);
  p.poly([cx - 10, hy - 6, cx + 8, hy - 7, cx + 11, hy + 4, cx - 9, hy + 5]).fill(SHELL, { mode: 'emboss', light: 0.1 });
  p.rect(cx - 9, hy - 1, 19, 2).fill(DARK, { mode: 'flat', tone: 1, inner: false });
  // twin barrels toward the viewer (foreshortened), muzzle flash when firing
  for (const sd of [-1, 1]) p.ellipse(cx + sd * 4, hy + 6, 2.4, 2.2);
  p.fill(DARK, { mode: 'sphere' });
  for (const sd of [-1, 1]) p.circle(cx + sd * 4, hy + 6, 1).fill(DARK, { mode: 'flat', tone: 0, inner: false });
  const eye = wind > 0.3 || fire ? RED : CYAN;
  p.rect(cx - 4, hy - 4, 8, 2).fill(eye, { mode: 'flat', tone: 3, glow: eye[2]!, inner: false });
  if (fire) for (const sd of [-1, 1]) { p.gpx(cx + sd * 4, hy + 9, 0xffffff, MAG[3]!); p.gpx(cx + sd * 4, hy + 10, MAG[3]!, MAG[2]!); }
  if (wind > 0.5) p.gpx(cx, hy - 8, RED[4]!, RED[2]!);
}

// ======================================================================= entry

export type CoreActorId = 'corruptcore' | 'coredrone' | 'coreturret';

export function renderCoreFrame(id: CoreActorId, state: string, view: View, i: number, n: number, painter: Painter): PixelBuffer {
  const seed = (id === 'corruptcore' ? 4100 : id === 'coredrone' ? 4300 : 4500) + i * 19 + view.charCodeAt(0) * 7 + state.length * 41;
  const isDeath = state === 'death';
  painter.reset();
  if (id === 'corruptcore') {
    const pose = corePose(state, isDeath ? 0 : i, n);
    drawCore(painter, view, pose);
    painter.finish(0x05060c);
    const out = painter.buf.clone();
    rimTopLeft(out, 0.24, 0xc8f0ff);
    if (isDeath) return coreDeath(out, i, n, seed, SHELL[3]!, CYAN[3]!, GROUND);
    coreOverlay(out, pose, seed);
    if (pose.hurt > 0) chroma(out, pose.hurt);
    glitchRows(out, pose.glitch, seed + 7);
    if (state === 'attack' && i === 0) flash(out, 0.35, 0xe8ffff);
    return out;
  }
  if (id === 'coredrone') droneDraw(painter, state, isDeath ? 0 : i, n);
  else turretDraw(painter, state, isDeath ? 0 : i, n);
  painter.finish(0x05060c);
  const out = painter.buf.clone();
  rimTopLeft(out, 0.3, 0xc8f0ff);
  if (isDeath) {
    if (i === 0) { flash(out, 0.6); return out; }
    const t = i / (n - 1);
    return shatter(out, t * 0.95, seed, id === 'coredrone' ? SHELL[3]! : PLATE[3]!, 10, 0.8, { glint: true, drops: { color: CYAN[3]!, count: 10, groundY: 42 } });
  }
  if (state === 'hit' && i === 0) flash(out, 0.5);
  return out;
}

/** The Core comes apart: plates and glass scatter, static sparks rain to the floor. */
function coreDeath(base: PixelBuffer, i: number, n: number, seed: number, tint: number, spark: number, groundY: number): PixelBuffer {
  if (i === 0) { flash(base, 0.55, 0xe8ffff); return base; }
  const t = Math.pow(i / (n - 1), 1.15);
  const out = shatter(base, t * 0.97, seed, tint, 30, 2.2, { glint: true, drops: { color: spark, count: 40, groundY } });
  glitchRows(out, 1 - t, seed + 3);
  const r = rng(seed);
  for (let k = 0; k < 6; k++) sparkle(out, Math.round(base.w * (0.2 + r() * 0.6)), Math.round(base.h * (0.15 + r() * 0.55)), k % 2 ? spark : MAG[3]!, 1, Math.round(255 * (1 - t * 0.6)));
  return out;
}
