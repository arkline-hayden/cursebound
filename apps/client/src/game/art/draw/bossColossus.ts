/**
 * The Iron Colossus (id ironcolossus, 176x176, front only): a towering forge-engine in riveted iron plate with a
 * furnace chest, smokestack pauldrons, a T-visor helm, a piston fist and a quake hammer. Overheated (stagger) its
 * plates part and the weak points (furnace heart, shoulder and knee joints) glow white-hot.
 * Pure (no DOM / Phaser).
 */
import { Painter, PixelBuffer, flash, rimTopLeft, rng, shatter, sparkle, type Ramp } from './pixel';
import { lerp } from './rig';

const R = (...c: number[]): Ramp => Object.freeze(c);

const IRON = R(0x17141c, 0x322c38, 0x544c5c, 0x847a8c, 0xbcb2c2);
const IRON_D = R(0x0c0a0e, 0x1a161e, 0x2a242e, 0x3e3644);
const SOOT = R(0x080608, 0x141014, 0x201a1e, 0x2e2628);
const RUST = R(0x241008, 0x4a2010, 0x7a3a1a, 0xa8602c, 0xd08a48);
const BRASS = R(0x3a2008, 0x7a4c18, 0xbc8432, 0xecc068, 0xfff0c0);
const EMBER = R(0x6a1a04, 0xc8460c, 0xff8a1e, 0xffd060, 0xfff8d8);
const HOT = R(0xc85a10, 0xff9a30, 0xffd878, 0xfff4c8, 0xffffff);
const STEEL = R(0x2a2a34, 0x4a4c5a, 0x767a8a, 0xa8acba, 0xe0e4ee);

interface KPose {
  ph: number;
  /** body drop (px) */
  sink: number;
  sway: number;
  /** furnace glow 0..1 */
  heat: number;
  /** hammer: 0 rest (head on the floor, right side), 1 raised overhead, -1 slammed in front */
  ham: number;
  /** stride: left / right foot lift (px) */
  stepL: number;
  stepR: number;
  /** overheated: plates part, weak points blaze */
  vent: number;
  /** hit flinch 0..1 */
  hurt: number;
  /** left fist piston extension 0..1 */
  punch: number;
  frame: number;
}

function kPose(state: string, i: number, n: number): KPose {
  const p: KPose = { ph: (i / n) * Math.PI * 2, sink: 0, sway: 0, heat: 0.45, ham: 0, stepL: 0, stepR: 0, vent: 0, hurt: 0, punch: 0, frame: i };
  switch (state) {
    case 'idle':
      p.sink = Math.sin(p.ph) * 1.2;
      p.heat = 0.45 + 0.15 * Math.sin(p.ph);
      break;
    case 'run': {
      const s = Math.sin(p.ph);
      p.stepL = Math.max(0, s) * 7; p.stepR = Math.max(0, -s) * 7;
      p.sway = s * 2.5; p.sink = Math.abs(Math.cos(p.ph)) * 2.5; p.heat = 0.55;
      break;
    }
    case 'windup': {
      const t = (i + 1) / n;
      p.ham = t; p.heat = 0.55 + t * 0.45; p.sway = -t * 2; p.sink = -t * 2;
      break;
    }
    case 'attack': {
      const seq = [-1, -1, -0.95, -0.85, -0.6, -0.3];
      p.ham = seq[i] ?? 0; p.heat = 1 - i * 0.08; p.sink = i < 2 ? 5 - i : 3 - i * 0.4; p.sway = i === 0 ? 3 : 0; p.punch = i < 3 ? 1 : 0;
      break;
    }
    case 'stagger':
    case 'death':
      p.vent = 1; p.heat = 1; p.sink = 7 + (state === 'stagger' ? (i % 2) : 0); p.sway = state === 'stagger' ? (i - 1) * 1.5 : 0; p.ham = -0.2;
      break;
    case 'hit':
      p.hurt = 1 - i * 0.5; p.sway = -2 + i; p.heat = 0.7;
      break;
    default:
      break;
  }
  return p;
}

const BX = 88;
const GY = 164;

function rivets(p: Painter, pts: [number, number][]): void {
  for (const [x, y] of pts) { p.px(x, y, BRASS[3]!); p.px(x + 1, y + 1, IRON_D[1]!); }
}

/** A riveted iron plate (quad) with a brass trim line along its top. */
function plate(p: Painter, q: number[], light = 0, ramp: Ramp = IRON): void {
  p.poly(q).fill(ramp, { mode: 'emboss', dither: true, light });
  p.capsule(q[0]!, q[1]! + 1, q[2]!, q[3]! + 1, 0.6, 0.6).fill(BRASS, { mode: 'flat', tone: 2, inner: false });
}

function drawColossus(p: Painter, pose: KPose): void {
  const sx = pose.sway - pose.hurt * 3;
  const sk = pose.sink;
  const bx = BX + sx;
  const vent = pose.vent;
  const glowA = pose.heat;
  const weak = (x: number, y: number, r: number): void => {
    // a glowing weak point: white-hot when overheated, a dull ember otherwise
    if (vent > 0) { p.circle(x, y, r + 1).fill(HOT, { mode: 'sphere', glow: HOT[2]!, light: 0.2, inner: false }); p.circle(x - 1, y - 1, r * 0.45).fill(HOT, { mode: 'flat', tone: 4, inner: false }); }
    else p.circle(x, y, r * 0.55).fill(EMBER, { mode: 'sphere', glow: EMBER[2]!, light: -0.2 + glowA * 0.3, inner: false });
  };
  // ---- hammer at rest or slammed (behind the legs when resting on the right)
  const hammer = (front: boolean): void => {
    const h = pose.ham;
    let hx: number, hy: number, tx: number, ty: number;
    if (h >= 0) {
      // rest (0) -> raised overhead (1)
      hx = lerp(bx + 52, bx + 16, h); hy = lerp(GY - 44, GY - 126, h);
      tx = lerp(bx + 60, bx + 4, h); ty = lerp(GY - 6, GY - 146, h);
    } else {
      // slammed down in front of it
      const t = -h;
      hx = lerp(bx + 52, bx + 22, t); hy = lerp(GY - 44, GY - 70, t);
      tx = lerp(bx + 60, bx + 4, t); ty = lerp(GY - 6, GY - 4, t);
    }
    const isFront = h < -0.3 || h > 0.45;   // slammed in front, or raised overhead (over the pauldron)
    if (front !== isFront) return;
    // haft
    p.capsule(hx, hy, tx, ty, 3, 3).fill(RUST, { mode: 'cyl', light: -0.05 });
    for (let k = 1; k < 4; k++) { const q = k / 4; p.capsule(lerp(hx, tx, q) - 3.5, lerp(hy, ty, q), lerp(hx, tx, q) + 3.5, lerp(hy, ty, q) + 1, 1, 1); }
    p.fill(IRON, { mode: 'cyl' });
    // the head: an anvil block bound in iron, glowing seams
    const dx = tx - hx, dy = ty - hy, L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const hw = 18, hd = 12;
    const c = [tx + ux * 4, ty + uy * 4];
    p.poly([c[0]! - nx * hw - ux * hd, c[1]! - ny * hw - uy * hd, c[0]! + nx * hw - ux * hd, c[1]! + ny * hw - uy * hd, c[0]! + nx * hw + ux * hd, c[1]! + ny * hw + uy * hd, c[0]! - nx * hw + ux * hd, c[1]! - ny * hw + uy * hd])
      .fill(IRON, { mode: 'emboss', dither: true, light: 0.08 });
    for (const s of [-0.55, 0.55]) p.capsule(c[0]! + nx * hw * s - ux * hd, c[1]! + ny * hw * s - uy * hd, c[0]! + nx * hw * s + ux * hd, c[1]! + ny * hw * s + uy * hd, 1.2, 1.2);
    p.fill(BRASS, { mode: 'cyl' });
    const hot = pose.ham > 0.5 || pose.ham < -0.5 || vent > 0 ? EMBER[3]! : EMBER[1]!;
    p.gpx(c[0]!, c[1]!, hot, EMBER[2]!).gpx(c[0]! + nx * 4, c[1]! + ny * 4, hot, EMBER[2]!).gpx(c[0]! - nx * 4, c[1]! - ny * 4, hot, EMBER[2]!);
  };
  hammer(false);
  // ---- legs: iron pillars with knee plates
  const leg = (sd: number, lift: number): void => {
    const hip = [bx + sd * 17, GY - 60 + sk];
    const ankle = [BX + sd * 22, GY - 12 - lift];
    const knee = [lerp(hip[0]!, ankle[0]!, 0.5) + sd * 3, lerp(hip[1]!, ankle[1]!, 0.5) - lift * 0.4];
    p.capsule(hip[0]!, hip[1]!, knee[0]!, knee[1]!, 12, 11).capsule(knee[0]!, knee[1]!, ankle[0]!, ankle[1]!, 11, 10).fill(IRON, { mode: 'cyl', dither: true, light: sd > 0 ? -0.15 : 0.05 });
    // greave bands
    for (const q of [0.25, 0.75]) p.capsule(lerp(knee[0]!, ankle[0]!, q) - 11, lerp(knee[1]!, ankle[1]!, q), lerp(knee[0]!, ankle[0]!, q) + 11, lerp(knee[1]!, ankle[1]!, q) + 1, 1.6, 1.6);
    p.fill(IRON_D, { mode: 'cyl' });
    // knee cop and its weak joint
    p.ellipse(knee[0]!, knee[1]! - 1, 10, 8).fill(IRON, { mode: 'sphere', light: 0.15 });
    if (vent > 0) weak(knee[0]! + sd * 7, knee[1]! + 3, 3);
    rivets(p, [[knee[0]! - 5, knee[1]! - 4], [knee[0]! + 4, knee[1]! - 4]]);
    // the boot
    p.poly([ankle[0]! - 15, ankle[1]! + 2, ankle[0]! + 15, ankle[1]! + 2, ankle[0]! + 18, GY - lift, ankle[0]! - 18, GY - lift]).fill(IRON, { mode: 'emboss', light: 0.1 });
    p.rect(ankle[0]! - 18, GY - 3 - lift, 36, 3).fill(SOOT, { mode: 'flat', tone: 2, inner: false });
    rivets(p, [[ankle[0]! - 12, ankle[1]! + 4], [ankle[0]!, ankle[1]! + 4], [ankle[0]! + 11, ankle[1]! + 4]]);
  };
  leg(-1, pose.stepL);
  leg(1, pose.stepR);
  // ---- waist: a belted skirt of plates
  const wy = GY - 66 + sk;
  for (let k = -2; k <= 2; k++) plate(p, [bx + k * 11 - 6, wy, bx + k * 11 + 6, wy, bx + k * 12 + 7, wy + 16 - Math.abs(k), bx + k * 12 - 7, wy + 16 - Math.abs(k)], k < 0 ? 0.05 : -0.12);
  p.rect(bx - 30, wy - 4, 60, 6).fill(IRON_D, { mode: 'emboss' });
  p.rect(bx - 5, wy - 5, 10, 8).fill(BRASS, { mode: 'emboss' });
  // ---- torso: a barrel chest of riveted plate around the furnace
  const ty0 = GY - 128 + sk, ty1 = wy - 2;
  const part = vent * 5;
  // side plates (they part when the furnace vents)
  plate(p, [bx - 40 - part, ty0 + 8, bx - 12 - part * 0.5, ty0 + 2, bx - 14 - part * 0.5, ty1, bx - 32 - part, ty1 - 2], 0.12);
  plate(p, [bx + 12 + part * 0.5, ty0 + 2, bx + 40 + part, ty0 + 8, bx + 32 + part, ty1 - 2, bx + 14 + part * 0.5, ty1], -0.22);
  // the core plate and its furnace grate
  p.poly([bx - 16, ty0, bx + 16, ty0, bx + 18, ty1 + 1, bx - 18, ty1 + 1]).fill(IRON, { mode: 'emboss', dither: true });
  const fy0 = ty0 + 12, fy1 = ty1 - 8;
  p.poly([bx - 11, fy0, bx + 11, fy0, bx + 12, fy1, bx - 12, fy1]).fill(vent > 0 ? HOT : EMBER, { mode: 'cyl', cx: bx, glow: vent > 0 ? HOT[2]! : EMBER[2]!, light: -0.25 + glowA * 0.4, inner: false });
  if (vent <= 0) {
    for (let k = -2; k <= 2; k++) p.capsule(bx + k * 4.5, fy0, bx + k * 4.8, fy1, 1.1, 1.1);
    p.capsule(bx - 12, (fy0 + fy1) / 2, bx + 12, (fy0 + fy1) / 2, 1.1, 1.1);
    p.fill(IRON_D, { mode: 'emboss' });
  } else {
    // the furnace heart laid bare
    p.circle(bx, (fy0 + fy1) / 2, 7).fill(HOT, { mode: 'sphere', glow: HOT[3]!, light: 0.3, inner: false });
  }
  rivets(p, [[bx - 13, ty0 + 3], [bx + 12, ty0 + 3], [bx - 14, ty1 - 3], [bx + 13, ty1 - 3], [bx - 36, ty0 + 12], [bx + 35, ty0 + 12]]);
  // gorget
  p.ellipse(bx, ty0 - 2, 18, 6).fill(IRON_D, { mode: 'sphere' });
  // ---- arms (behind the pauldrons): the piston fist (left), the hammer arm (right)
  const sy = ty0 + 10;
  const lArm = (): void => {
    const s = [bx - 42, sy];
    const e = [bx - 52, sy + 30];
    const f = [bx - 48 + pose.punch * 6, sy + 56 - pose.punch * 6];
    p.capsule(s[0]!, s[1]!, e[0]!, e[1]!, 10, 9).fill(IRON, { mode: 'cyl', dither: true, light: 0.08 });
    // the piston forearm: a brass ram sliding in an iron sleeve
    p.capsule(e[0]!, e[1]!, f[0]!, f[1]!, 6, 6).fill(BRASS, { mode: 'cyl', light: -0.05 });
    p.capsule(e[0]!, e[1]!, lerp(e[0]!, f[0]!, 0.55), lerp(e[1]!, f[1]!, 0.55), 9, 8).fill(IRON, { mode: 'cyl', dither: true });
    p.poly([f[0]! - 10, f[1]! - 4, f[0]! + 9, f[1]! - 5, f[0]! + 10, f[1]! + 10, f[0]! - 9, f[1]! + 11]).fill(IRON, { mode: 'emboss', light: 0.1 });
    for (let k = 0; k < 4; k++) p.px(f[0]! - 7 + k * 5, f[1]! + 9, IRON_D[0]!);
    if (vent > 0) weak(e[0]!, e[1]!, 3.4);
  };
  const rArm = (): void => {
    const s = [bx + 42, sy];
    const h = pose.ham;
    const hand = h >= 0 ? [lerp(bx + 52, bx + 16, h), lerp(GY - 44, GY - 126, h)] : [lerp(bx + 52, bx + 22, -h), lerp(GY - 44, GY - 70, -h)];
    const e = [lerp(s[0]!, hand[0]!, 0.5) + 10 - h * 4, lerp(s[1]!, hand[1]!, 0.5) + (h > 0 ? 4 : 0)];
    p.capsule(s[0]!, s[1]!, e[0]!, e[1]!, 10, 9).capsule(e[0]!, e[1]!, hand[0]!, hand[1]!, 9, 8).fill(IRON, { mode: 'cyl', dither: true, light: -0.1 });
    p.circle(hand[0]!, hand[1]!, 8).fill(IRON, { mode: 'sphere', light: 0.1 });
    if (vent > 0) weak(e[0]!, e[1]!, 3.4);
  };
  lArm();
  rArm();
  // ---- pauldrons with smokestacks and shoulder joints
  for (const sd of [-1, 1]) {
    const px = bx + sd * 40, py = ty0 + 4;
    // smokestack behind the shoulder
    p.rect(px + sd * 6 - 3.5, py - 26, 7, 18).fill(SOOT, { mode: 'cyl', cx: px + sd * 6 });
    p.ellipse(px + sd * 6, py - 26, 4.5, 2).fill(IRON_D, { mode: 'sphere' });
    if (glowA > 0.6 || vent > 0) p.gpx(px + sd * 6, py - 26, EMBER[3]!, EMBER[2]!);
    // layered plates
    p.ellipse(px, py + 2, 20, 15).fill(IRON, { mode: 'sphere', dither: true, light: sd < 0 ? 0.12 : -0.1 });
    p.poly([px - 19, py + 6, px + 19, py + 6, px + 16, py + 16, px - 16, py + 16]).fill(IRON, { mode: 'emboss', light: -0.05 });
    p.capsule(px - 18, py + 6, px + 18, py + 6, 0.8, 0.8).fill(BRASS, { mode: 'flat', tone: 2, inner: false });
    rivets(p, [[px - 10, py - 6], [px, py - 9], [px + 10, py - 6], [px - 12, py + 11], [px + 11, py + 11]]);
    if (vent > 0) weak(px - sd * 14, py + 10, 3.6);
  }
  // ---- weathering: rust blooms and soot streaks on the big plates
  const wr = rng(97);
  for (const [x, y, rx, ry] of [[bx - 27, ty0 + 30, 5, 7], [bx + 25, ty0 + 40, 4, 6], [bx - 44, ty0 - 2, 5, 3], [bx + 38, ty0 + 2, 4, 3], [bx - 6, ty1 - 6, 4, 2]] as const) {
    p.ellipse(x + (wr() - 0.5) * 2, y, rx, ry);
  }
  p.fill(RUST, { mode: 'sphere', dither: true, alpha: 150, inner: false });
  for (const x of [bx - 30, bx - 22, bx + 21, bx + 29]) p.rect(x, ty0 + 14 + wr() * 6, 1, 10 + wr() * 8);
  p.fill(SOOT, { mode: 'flat', tone: 1, alpha: 120, inner: false });
  // ---- the head: a squat helm sunk between the shoulders, T-visor glowing
  const hx = bx, hy = ty0 - 12 + (vent ? 4 : 0) + pose.hurt * 2;
  p.poly([hx - 13, hy - 10, hx + 13, hy - 10, hx + 15, hy + 6, hx + 10, hy + 12, hx - 10, hy + 12, hx - 15, hy + 6]).fill(IRON, { mode: 'emboss', dither: true, light: 0.08 });
  // crest ridge
  p.poly([hx - 3, hy - 10, hx + 3, hy - 10, hx + 2, hy - 18, hx - 2, hy - 18]).fill(RUST, { mode: 'emboss' });
  rivets(p, [[hx - 10, hy - 7], [hx + 9, hy - 7], [hx - 11, hy + 7], [hx + 10, hy + 7]]);
  const eye = vent > 0 ? HOT : pose.hurt > 0.4 ? STEEL : EMBER;
  const ec = glowA > 0.7 || vent > 0 ? eye[4] ?? eye[3]! : eye[3]!;
  for (let x = hx - 9; x <= hx + 9; x++) p.gpx(x, hy - 1, ec, eye[2]!);
  for (let y = hy; y <= hy + 6; y++) p.gpx(hx, y, ec, eye[2]!);
  // ---- the hammer slammed in front
  hammer(true);
}

function colossusOverlay(buf: PixelBuffer, pose: KPose, seed: number): void {
  const r = rng(seed);
  // smoke from the stacks
  const puffs = pose.vent ? 14 : 5;
  for (let k = 0; k < puffs; k++) {
    const sd = k % 2 ? 1 : -1;
    const x = Math.round(BX + pose.sway + sd * 46 + (r() - 0.5) * 8), y = Math.round(GY - 160 + pose.sink - r() * 10);
    buf.blend(x, y, 0x5a5050, 120);
    buf.blend(x + 1, y, 0x3a3434, 100);
  }
  // rising embers
  const embers = Math.round(4 + pose.heat * 8 + pose.vent * 10);
  for (let k = 0; k < embers; k++) {
    const x = Math.round(BX + (r() - 0.5) * 70), y = Math.round(GY - 60 - r() * 90);
    buf.blend(x, y, k % 3 ? EMBER[3]! : HOT[3]!, Math.round(140 + pose.heat * 100));
  }
  if (pose.vent) for (let k = 0; k < 4; k++) sparkle(buf, Math.round(BX - 30 + r() * 60), Math.round(GY - 120 + r() * 60), HOT[3]!, 1, 230);
  if (pose.ham < -0.8) {
    // impact sparks and dust at the hammer head
    for (let k = 0; k < 16; k++) {
      const a = Math.PI + r() * Math.PI, d = 6 + r() * 18;
      buf.blend(Math.round(BX + 6 + Math.cos(a) * d), Math.round(GY - 6 + Math.sin(a) * d * 0.5), k % 2 ? EMBER[3]! : 0xfff0c0, 220);
    }
  }
}

export function renderColossusFrame(state: string, i: number, n: number, painter: Painter): PixelBuffer {
  const seed = 6100 + i * 23 + state.length * 59;
  const isDeath = state === 'death';
  painter.reset();
  const pose = kPose(state, isDeath ? 0 : i, n);
  drawColossus(painter, pose);
  painter.finish(0x070406);
  const out = painter.buf.clone();
  rimTopLeft(out, 0.22, 0xffe0c0);
  if (isDeath) {
    if (i === 0) { flash(out, 0.5, 0xfff0d0); return out; }
    const t = Math.pow(i / (n - 1), 1.2);
    const sh = shatter(out, t * 0.97, seed, IRON[3]!, 36, 2.4, { glint: true, drops: { color: EMBER[3]!, count: 52, groundY: GY } });
    const r = rng(seed);
    for (let k = 0; k < 6; k++) sparkle(sh, Math.round(out.w * (0.2 + r() * 0.6)), Math.round(out.h * (0.2 + r() * 0.6)), EMBER[3]!, 1, Math.round(255 * (1 - t * 0.6)));
    return sh;
  }
  colossusOverlay(out, pose, seed);
  if (state === 'hit' && i === 0) flash(out, 0.4, 0xfff0d8);
  return out;
}
