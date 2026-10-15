/**
 * Room event sprites (framework-free pixel generators + lazy Phaser registration):
 *   rev:shrine:<type>      4 frames  a carved stone obelisk with a floating crystal in the shrine's colour (pulsing glow,
 *                                    drifting motes); frame layout [lit 0..3]
 *   rev:shrine:<type>:dark 1 frame   the spent shrine: cold crystal, cracked rune
 *   rev:altar              4 frames  a blood altar: skull, guttering candles, a dripping basin, ember runes
 *   rev:altar:dark         1 frame   the spent altar: candles out, dried blood
 *   rev:merchant           4 frames  a hooded pack-merchant: towering pack, swaying lantern, breathing idle
 *   rev:imp:run / idle / portal      the treasure imp hauling a glittering sack (faces east; the renderer flips)
 *   rev:coin               4 frames  a little heap of cursed coins with a travelling glint
 *   rev:portal             6 frames  the imp's violet escape rift
 * Everything is painted with the shared Painter (shaded masks, glow halos, indigo outline), so it sits with the
 * actors and props. Client-only registration touches `document` inside functions, never at import time.
 */
import type Phaser from 'phaser';
import { Painter, PixelBuffer, Sheet, mix, rampFrom, sparkle } from './draw/pixel';
import { MATERIALS, OUTLINE } from './palette';
import { addAnim, addFramedTexture } from './texutil';

type Ramp = readonly number[];
const R = (...c: number[]): Ramp => Object.freeze(c);

const STONE = R(0x1c1826, 0x37304a, 0x5a5270, 0x857d9a, 0xb4adc6);
const STONE_DARK = R(0x15121c, 0x272233, 0x3d374b, 0x5a546a);
const BONE = R(0x4a3a30, 0x8a7660, 0xcdbb9a, 0xf2e6c8);
const BLOOD = R(0x2a0408, 0x5e0a14, 0x9a1424, 0xe0303a);
const ROBE = R(0x1a1022, 0x2e1c36, 0x4a2c52, 0x6e4a72);
const CLOTH = R(0x2a1a14, 0x4c2e1e, 0x74482a, 0x9e6a3e);
const IMP_SKIN = R(0x1c2a18, 0x35502a, 0x5a7f3a, 0x8cb458);
const SACK = R(0x3a2414, 0x6a4422, 0x9a6a34, 0xc89a52);

/** Shrine tone (crystal ramp, glow) per content SHRINES id. */
const SHRINE_TONES: Record<string, { ramp: Ramp; glow: number }> = {
  fury: { ramp: R(0x5a0a08, 0xb82414, 0xff5a2a, 0xffb27a, 0xfff0d8), glow: 0xff6a3a },
  haste: { ramp: R(0x0a3a5a, 0x1a7ab8, 0x4ae0ff, 0xb8f6ff, 0xffffff), glow: 0x5ae0ff },
  warding: { ramp: R(0x1c2a6a, 0x3a52b0, 0x7a92ff, 0xc8d4ff, 0xffffff), glow: 0x9fb4ff },
  fortune: { ramp: MATERIALS.gold, glow: 0xffd23f },
  renewal: { ramp: R(0x0a4a1e, 0x1a9a3a, 0x4aef6a, 0xb4ffbe, 0xffffff), glow: 0x6aff8a },
};
export const SHRINE_TYPES = Object.keys(SHRINE_TONES);

export interface RevSheet { key: string; frameW: number; frameH: number; frames: number; width: number; height: number; rgba: Uint8ClampedArray; durations: number[]; loop: boolean }

function sheetOf(key: string, w: number, h: number, frames: PixelBuffer[], durations: number[], loop = true): RevSheet {
  const sh = new Sheet(w, h, frames.length);
  for (const f of frames) sh.add(f);
  return { key, frameW: w, frameH: h, frames: frames.length, width: sh.buf.w, height: sh.buf.h, rgba: sh.buf.toRGBA(), durations, loop };
}

// ---------------------------------------------------------------- shrine (32 x 52, feet at y 49)

const SW = 32, SH = 52;

function shrineFrame(type: string, f: number, lit: boolean): PixelBuffer {
  const p = new Painter(new PixelBuffer(SW, SH));
  const tone = SHRINE_TONES[type] ?? SHRINE_TONES.fury;
  const stone = lit ? STONE : STONE_DARK;
  const ph = (f / 4) * Math.PI * 2;
  // stepped plinth (a lit top face, a shadowed front)
  p.poly([3, 44, 16, 39, 29, 44, 16, 49]).fill(stone, { mode: 'facet', facets: 4, rot: 0.3 });
  p.rect(3, 44, 26, 3).fill(stone, { mode: 'cyl' });
  p.poly([3, 47, 16, 52, 29, 47, 29, 44, 16, 49, 3, 44]).fill(stone, { mode: 'flat', tone: 1 });
  p.poly([7, 41, 16, 37, 25, 41, 16, 45]).fill(stone, { mode: 'facet', facets: 4, light: 0.15 });
  // the obelisk: tapering shaft with a pyramidion
  p.poly([11, 41, 12, 17, 20, 17, 21, 41]).fill(stone, { mode: 'cyl' });
  p.poly([11, 17, 16, 13, 21, 17]).fill(stone, { mode: 'facet', facets: 3, light: 0.2 });
  // carved bands
  for (const y of [22, 36]) p.rect(11, y, 11, 1).fill(stone, { mode: 'flat', tone: 0, inner: false });
  // the rune (type motif) on the shaft front
  const rune = lit ? tone.ramp[3]! : 0x3a3446;
  const glyph: Record<string, number[][]> = {
    fury: [[16, 25], [15, 26], [17, 26], [16, 27], [14, 28], [18, 28], [15, 29], [17, 29], [16, 30], [16, 31]],
    haste: [[17, 25], [16, 26], [15, 27], [16, 28], [17, 28], [18, 28], [17, 29], [16, 30], [15, 31]],
    warding: [[14, 25], [15, 25], [16, 25], [17, 25], [18, 25], [14, 26], [18, 26], [14, 27], [18, 27], [15, 28], [17, 28], [16, 29], [16, 26], [16, 27]],
    fortune: [[15, 25], [16, 25], [17, 25], [14, 26], [18, 26], [14, 27], [16, 27], [18, 27], [14, 28], [18, 28], [15, 29], [16, 29], [17, 29]],
    renewal: [[16, 25], [16, 26], [15, 27], [17, 27], [14, 28], [18, 28], [15, 29], [17, 29], [16, 30], [16, 31]],
  };
  for (const [x, y] of glyph[type] ?? glyph.fury) { if (lit) p.gpx(x, y, rune, tone.glow); else p.px(x, y, rune); }
  if (!lit) { p.px(13, 32, 0x0e0c14); p.px(14, 33, 0x0e0c14); p.px(14, 34, 0x0e0c14); p.px(19, 19, 0x0e0c14); p.px(18, 20, 0x0e0c14); }
  // the floating crystal (bobs while lit)
  const cy = 8 + (lit ? Math.round(Math.sin(ph) * 1.2) : 2);
  const cr = lit ? tone.ramp : R(0x221e2c, 0x3a3446, 0x585266, 0x7a7488);
  if (type === 'fortune') p.circle(16, cy, 4).fill(cr, { mode: 'sphere', glow: lit ? tone.glow : undefined });
  else if (type === 'warding') p.poly([12, cy - 4, 20, cy - 4, 20, cy + 1, 16, cy + 5, 12, cy + 1]).fill(cr, { mode: 'facet', facets: 5, glow: lit ? tone.glow : undefined });
  else if (type === 'renewal') p.poly([16, cy - 5, 20, cy + 1, 16, cy + 5, 12, cy + 1]).fill(cr, { mode: 'facet', facets: 4, glow: lit ? tone.glow : undefined });
  else if (type === 'haste') p.poly([18, cy - 5, 13, cy + 1, 16, cy + 1, 14, cy + 5, 19, cy - 1, 16, cy - 1]).fill(cr, { mode: 'facet', facets: 3, glow: lit ? tone.glow : undefined });
  else p.poly([16, cy - 6, 20, cy, 16, cy + 5, 12, cy]).fill(cr, { mode: 'facet', facets: 4, rot: 0.4, glow: lit ? tone.glow : undefined });
  if (lit) {
    p.gpx(15, cy - 1, 0xffffff, tone.glow);
    // drifting motes around the crystal
    for (let k = 0; k < 3; k++) {
      const a = ph + (k * Math.PI * 2) / 3;
      p.gpx(16 + Math.round(Math.cos(a) * 7), cy + 2 + Math.round(Math.sin(a) * 3), tone.ramp[3]!, tone.glow);
    }
  }
  p.finish(OUTLINE, lit ? 1 : 0);
  if (lit) sparkle(p.buf, 16 + Math.round(Math.cos(ph * 2) * 3), cy - 3, tone.ramp[3]!, 1, 200);
  return p.buf;
}

export function buildShrineSheets(): RevSheet[] {
  const out: RevSheet[] = [];
  for (const type of SHRINE_TYPES) {
    out.push(sheetOf(`rev:shrine:${type}`, SW, SH, [0, 1, 2, 3].map((f) => shrineFrame(type, f, true)), [200, 170, 200, 170]));
    out.push(sheetOf(`rev:shrine:${type}:dark`, SW, SH, [shrineFrame(type, 0, false)], [1000], false));
  }
  return out;
}

// ---------------------------------------------------------------- altar (44 x 40, feet at y 37)

const AW = 44, AH = 40;

function altarFrame(f: number, lit: boolean): PixelBuffer {
  const p = new Painter(new PixelBuffer(AW, AH));
  const stone = lit ? STONE : STONE_DARK;
  const flick = [0, 1, 0, -1][f % 4]!;
  // the slab on two squat legs
  p.rect(9, 24, 6, 11).fill(stone, { mode: 'cyl' });
  p.rect(29, 24, 6, 11).fill(stone, { mode: 'cyl' });
  p.poly([4, 22, 22, 15, 40, 22, 22, 29]).fill(stone, { mode: 'facet', facets: 4, light: 0.1 });
  p.poly([4, 22, 22, 29, 22, 32, 4, 25]).fill(stone, { mode: 'flat', tone: 1 });
  p.poly([22, 29, 40, 22, 40, 25, 22, 32]).fill(stone, { mode: 'flat', tone: 0 });
  // blood pooled on the slab, running over the lip
  const blood = lit ? BLOOD : R(0x1c0c0e, 0x2e1416, 0x40201e, 0x52302a);
  p.ellipse(22, 22, 9, 3.5).fill(blood, { mode: 'sphere', glow: lit ? 0x8a1020 : undefined });
  const drip = lit ? (f % 4) : 1;
  p.rect(16, 28, 1, 2 + drip).fill(blood, { mode: 'flat', tone: 2, inner: false });
  p.rect(27, 27, 1, 1 + ((drip + 2) % 4)).fill(blood, { mode: 'flat', tone: 2, inner: false });
  // a horned skull at the back of the slab
  p.ellipse(22, 14, 4.5, 4).fill(BONE, { mode: 'sphere' });
  p.rect(19, 16, 7, 3).fill(BONE, { mode: 'cyl' });
  p.capsule(18, 12, 13, 7, 1.4, 0.6).fill(BONE, { mode: 'cyl' });
  p.capsule(26, 12, 31, 7, 1.4, 0.6).fill(BONE, { mode: 'cyl' });
  const eye = lit ? 0xff3a2a : 0x14080a;
  for (const x of [20, 24]) { if (lit) p.gpx(x, 14, eye, 0xff2a1a); else p.px(x, 14, eye); }
  p.px(21, 18, OUTLINE); p.px(23, 18, OUTLINE);
  // two candles
  for (const [x, h] of [[7, 7], [36, 9]] as const) {
    p.rect(x, 21 - h, 2, h).fill(BONE, { mode: 'cyl' });
    if (lit) {
      p.gpx(x, 19 - h + flick, 0xffe0a0, 0xff9a3a);
      p.gpx(x + 1, 19 - h, 0xffb04a, 0xff7a2a);
      p.gpx(x, 18 - h + flick, 0xffffff, 0xffb04a);
    } else p.px(x, 20 - h, 0x2a2430);
  }
  // ember runes carved into the slab's front
  if (lit) for (const [x, y] of [[8, 27], [11, 28], [14, 29], [30, 28], [33, 27], [36, 26]] as const) p.gpx(x, y, (f + x) % 3 ? 0xff4a2a : 0xffa060, 0xc01818);
  p.finish(OUTLINE, lit ? 0.9 : 0);
  return p.buf;
}

export function buildAltarSheets(): RevSheet[] {
  return [
    sheetOf('rev:altar', AW, AH, [0, 1, 2, 3].map((f) => altarFrame(f, true)), [150, 130, 160, 140]),
    sheetOf('rev:altar:dark', AW, AH, [altarFrame(0, false)], [1000], false),
  ];
}

// ---------------------------------------------------------------- merchant (36 x 52, feet at y 49)

const MW = 36, MH = 52;

function merchantFrame(f: number): PixelBuffer {
  const p = new Painter(new PixelBuffer(MW, MH));
  const breathe = [0, 0, 1, 0][f]!;
  const sway = [0, 1, 0, -1][f]!;
  // the towering pack: crates, a rolled rug, pots and a dangling pan
  p.rect(16, 12 + breathe, 15, 24).fill(CLOTH, { mode: 'cyl' });
  p.rect(17, 7 + breathe, 12, 7).fill(MATERIALS.wood, { mode: 'emboss' });
  p.rect(14, 4 + breathe, 9, 5).fill(R(0x3a1a2a, 0x6a2a3a, 0x9a3a4a, 0xc86a6a), { mode: 'cyl' });
  p.circle(27, 5 + breathe, 3).fill(R(0x2a3a4a, 0x3a5a6a, 0x5a8a9a, 0x9ac8d0), { mode: 'sphere' });
  p.circle(31, 22 + breathe, 2.5).fill(MATERIALS.darkSteel, { mode: 'sphere' });
  p.rect(18, 20 + breathe, 11, 1).fill(MATERIALS.leather, { mode: 'flat', tone: 1, inner: false });
  p.rect(18, 28 + breathe, 11, 1).fill(MATERIALS.leather, { mode: 'flat', tone: 1, inner: false });
  // the robed body and hood
  p.poly([6, 48, 9, 24 + breathe, 20, 22 + breathe, 24, 48]).fill(ROBE, { mode: 'cyl', dither: true });
  p.ellipse(14, 19 + breathe, 6, 6).fill(ROBE, { mode: 'sphere' });
  p.ellipse(13, 21 + breathe, 3.5, 3).fill(R(0x05030a, 0x0a0612, 0x120a1a, 0x1a1024), { mode: 'flat', tone: 0 });
  // glinting eyes in the hood's shadow
  p.gpx(12, 21 + breathe, 0xffd86a, 0xffa020);
  p.gpx(15, 21 + breathe, 0xffd86a, 0xffa020);
  // a sash of trinkets
  p.rect(9, 32 + breathe, 13, 2).fill(MATERIALS.gold, { mode: 'cyl' });
  // the arm and the lantern staff
  p.capsule(8, 30 + breathe, 4, 34, 1.6, 1.4).fill(ROBE, { mode: 'cyl' });
  p.line(3, 49, 4, 14);
  p.fill(MATERIALS.wood, { mode: 'flat', tone: 2, inner: false });
  p.line(4, 14, 7 + sway, 15);
  p.fill(MATERIALS.darkSteel, { mode: 'flat', tone: 2, inner: false });
  const lx = 7 + sway, ly = 18;
  p.rect(lx - 2, ly - 2, 5, 6).fill(MATERIALS.darkSteel, { mode: 'emboss' });
  p.gpx(lx, ly, 0xfff0b0, 0xffb040);
  p.gpx(lx, ly + 1, 0xffd060, 0xffa020);
  p.gpx(lx + 1, ly + 1, 0xffb040, 0xff8a20);
  p.finish(OUTLINE, 1);
  return p.buf;
}

export function buildMerchantSheet(): RevSheet {
  return sheetOf('rev:merchant', MW, MH, [0, 1, 2, 3].map(merchantFrame), [320, 260, 320, 260]);
}

// ---------------------------------------------------------------- treasure imp (28 x 28, feet at y 26)

const IW = 28, IH = 28;

function impFrame(state: 'run' | 'idle' | 'portal', f: number): PixelBuffer {
  const p = new Painter(new PixelBuffer(IW, IH));
  const run = state === 'run';
  const ph = (f / (run ? 4 : 2)) * Math.PI * 2;
  const bob = run ? Math.round(-Math.abs(Math.sin(ph)) * 2) : state === 'portal' ? -1 : Math.round(Math.sin(ph) * 0.6);
  const lean = run ? 2 : 0;
  const by = 18 + bob;
  // legs (scurrying)
  const stride = run ? Math.sin(ph) * 3 : 0;
  p.capsule(12 + lean * 0.3, by + 2, 11 + stride, 26, 1.4, 1.1).fill(IMP_SKIN, { mode: 'cyl' });
  p.capsule(15 + lean * 0.3, by + 2, 16 - stride, 26, 1.4, 1.1).fill(IMP_SKIN, { mode: 'cyl' });
  // the body, hunched forward when running
  p.ellipse(13 + lean, by - 1, 4.5, 4.5).fill(IMP_SKIN, { mode: 'sphere' });
  // the huge sack slung over the shoulder (behind the head), bulging with gold
  const sx = 7 - lean * 0.5, sy = by - 6 + (run ? Math.round(Math.sin(ph * 2) * 0.6) : 0);
  p.ellipse(sx, sy, 6.5, 6).fill(SACK, { mode: 'sphere', dither: true });
  p.rect(Math.round(sx) + 2, Math.round(sy) - 6, 3, 3).fill(SACK, { mode: 'cyl' });
  for (const [dx, dy] of [[-3, -2], [1, -4], [-1, 2], [3, 0]] as const) p.gpx(Math.round(sx + dx), Math.round(sy + dy), 0xffe48a, 0xffc020);
  // head with long ears and a greedy grin
  const hx = 16 + lean, hy = by - 7;
  p.ellipse(hx, hy, 3.6, 3.4).fill(IMP_SKIN, { mode: 'sphere' });
  p.poly([hx - 2, hy - 2, hx - 7, hy - 6, hx - 3, hy]).fill(IMP_SKIN, { mode: 'facet', facets: 3 });
  p.poly([hx + 2, hy - 2, hx + 6, hy - 7, hx + 3, hy]).fill(IMP_SKIN, { mode: 'facet', facets: 3 });
  p.gpx(hx + 1, hy - 1, 0xfff07a, 0xffc020);
  p.px(hx + 2, hy + 1, 0xf2e6c8);
  p.px(hx, hy + 1, 0xf2e6c8);
  // arms: one grips the sack, the other flails (or both raised to tear the portal)
  if (state === 'portal') {
    p.capsule(13 + lean, by - 3, 19, by - 11 - f, 1.2, 0.9).fill(IMP_SKIN, { mode: 'cyl' });
    p.capsule(12, by - 3, 6, by - 12 + f, 1.2, 0.9).fill(IMP_SKIN, { mode: 'cyl' });
  } else {
    p.capsule(12 + lean, by - 3, sx + 3, sy - 3, 1.2, 0.9).fill(IMP_SKIN, { mode: 'cyl' });
    p.capsule(15 + lean, by - 1, 19 + lean + (run ? Math.round(Math.cos(ph) * 2) : 0), by + 1, 1.1, 0.9).fill(IMP_SKIN, { mode: 'cyl' });
  }
  // coins spilling from the sack's mouth while it runs
  if (run && f % 2 === 0) p.gpx(Math.round(sx) - 3, Math.round(sy) + 6, 0xffd23f, 0xffa020);
  p.finish(OUTLINE, 1);
  sparkle(p.buf, Math.round(sx) + [2, -2, 0, 3][f % 4]!, Math.round(sy) - [4, 1, 3, 2][f % 4]!, 0xffe48a, 1, 230);
  return p.buf;
}

export function buildImpSheets(): RevSheet[] {
  return [
    sheetOf('rev:imp:run', IW, IH, [0, 1, 2, 3].map((f) => impFrame('run', f)), [70, 70, 70, 70]),
    sheetOf('rev:imp:idle', IW, IH, [0, 1].map((f) => impFrame('idle', f)), [220, 220]),
    sheetOf('rev:imp:portal', IW, IH, [0, 1].map((f) => impFrame('portal', f)), [120, 120]),
  ];
}

// ---------------------------------------------------------------- coins (14 x 10) and the portal (36 x 44)

function coinFrame(f: number): PixelBuffer {
  const p = new Painter(new PixelBuffer(14, 10));
  const gold = MATERIALS.gold;
  p.ellipse(7, 7, 5.5, 2.5).fill(gold, { mode: 'sphere' });
  p.ellipse(5, 5, 3, 1.5).fill(gold, { mode: 'sphere', light: 0.1 });
  p.ellipse(9, 4.5, 2.5, 1.3).fill(gold, { mode: 'sphere', light: 0.15 });
  p.finish(OUTLINE, 0);
  const g = [[4, 4], [9, 3], [7, 6], [11, 6]][f]!;
  sparkle(p.buf, g[0]!, g[1]!, 0xfff6c0, 1, 255);
  return p.buf;
}

function portalFrame(f: number): PixelBuffer {
  const buf = new PixelBuffer(36, 44);
  const cx = 18, cy = 22;
  const rim = rampFrom(0x9a4aff);
  for (let y = 0; y < 44; y++) for (let x = 0; x < 36; x++) {
    const nx = (x + 0.5 - cx) / 15, ny = (y + 0.5 - cy) / 20;
    const d = Math.sqrt(nx * nx + ny * ny);
    if (d > 1) continue;
    const a = Math.atan2(ny, nx);
    const swirl = Math.sin(a * 3 + d * 9 - f * (Math.PI / 3));
    if (d > 0.86) buf.set(x, y, d > 0.95 ? OUTLINE : rim[swirl > 0 ? 3 : 2]!);
    else {
      const t = Math.max(0, Math.min(1, 0.55 + 0.45 * swirl - d * 0.4));
      buf.set(x, y, mix(0x12052a, 0xb06aff, t * (1 - d * 0.6)), 235);
    }
  }
  for (let k = 0; k < 5; k++) {
    const a = f * 0.9 + k * 1.3;
    sparkle(buf, Math.round(cx + Math.cos(a) * 9 * (0.3 + k * 0.15)), Math.round(cy + Math.sin(a) * 12 * (0.3 + k * 0.15)), 0xe0c8ff, 1, 220);
  }
  return buf;
}

export function buildMiscSheets(): RevSheet[] {
  return [
    sheetOf('rev:coin', 14, 10, [0, 1, 2, 3].map(coinFrame), [260, 180, 260, 180]),
    sheetOf('rev:portal', 36, 44, [0, 1, 2, 3, 4, 5].map(portalFrame), [70, 70, 70, 70, 70, 70]),
  ];
}

/** Every room-event sheet (art preview and tests). */
export function buildRoomEventSheets(): RevSheet[] {
  return [...buildShrineSheets(), ...buildAltarSheets(), buildMerchantSheet(), ...buildImpSheets(), ...buildMiscSheets()];
}

/** Register every room-event texture + animation once (anim key = texture key). */
export function ensureRoomEventArt(scene: Phaser.Scene): void {
  if (scene.textures.exists('rev:coin')) return;
  for (const s of buildRoomEventSheets()) {
    addFramedTexture(scene, s.key, s.width, s.height, s.rgba, s.frameW, s.frameH, s.frames);
    if (s.frames > 1) addAnim(scene, s.key, s.key, s.durations, s.loop);
  }
}
