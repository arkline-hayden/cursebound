import * as Phaser from 'phaser';
import { rayDistance, voidBeamDir, type MapState } from '@cursebound/simulation';
import { iso } from '../iso';
import { registerHazardFx, registerProjectileFx, registerSkillFx, type FxCtx, type SnapHazard } from './registry';

// Theme boss presentation (cosmetic only; simulation/src/bosses/skydrake.ts and moonhorror.ts are the authority).
// Hazards: gale (the Wyrm's breath cone, x,y origin, dx,dy heading, r range, in = cos half-arc), stormfeather (a
// lightning feather falling onto its marked circle; in = strike tick), tentacle (bursts at in = arm tick, then sways
// as a lantern), gravwell (pull radius r, core in), voidbeam (sweeps from dx,dy at sp rad/s since b, len, w), lowgrav
// (slow zone radius r). Projectiles: quill (harpy dart), gust (wind elemental). Teleport style 'skyfall': a hero blown
// off the island is set back on the rock. The telegraph layer draws every marked shape; these draw the effect itself.

const SKY = 0xbfe6ff;
const BOLT = 0xfff7a8;
const VOID = 0x9a6aff;
const VOID_HI = 0xc2f6ff;
const LANTERN = 0x48f0c8;
const MOON = 0xb8c8ff;

// ---- scene objects owned by this module (per-hazard graphics that depth-sort with actors, an overlay layer)
let owner: Phaser.Scene | null = null;
let overlay: Phaser.GameObjects.Graphics | null = null;
const objs = new Map<number, { g: Phaser.GameObjects.Graphics; touched: number }>();
let frame = 0;
let fxMap: MapState | null = null;
/** the moon horror's darkness 0..1 (BossFx): tentacle lanterns glow brighter in the dark */
let darkness = 0;

/** Called once per frame by BossFx before hazards draw: drops per-hazard objects the last frame did not touch. */
export function beginThemeBossFx(scene: Phaser.Scene, map: MapState | null, dark: number) {
  if (owner !== scene) { owner = scene; overlay = null; objs.clear(); }
  fxMap = map;
  darkness = dark;
  frame++;
  for (const [id, o] of objs) if (o.touched < frame - 1) { o.g.destroy(); objs.delete(id); }
  if (!overlay || !overlay.scene) overlay = scene.add.graphics().setDepth(4640).setBlendMode(Phaser.BlendModes.ADD);
  overlay.clear();
}

function objFor(scene: Phaser.Scene, id: number, depth: number): Phaser.GameObjects.Graphics {
  let o = objs.get(id);
  if (!o || !o.g.scene) { o = { g: scene.add.graphics(), touched: frame }; objs.set(id, o); }
  o.touched = frame;
  return o.g.clear().setDepth(depth);
}

const fade = (ctx: FxCtx, g: Phaser.GameObjects.Graphics, ms: number) => ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, ease: 'Quad.easeOut', onComplete: () => g.destroy() });

/** Jagged sky bolt onto a world point (lightning feather strike). */
export function skyBolt(ctx: FxCtx, x: number, y: number, color = BOLT) {
  const p = ctx.P(x, y);
  if (!ctx.reduced) {
    const g = ctx.scene.add.graphics().setDepth(4650).setBlendMode(Phaser.BlendModes.ADD);
    let cx = p.x + (Math.random() - 0.5) * 20, cy = p.y - 190;
    const pts: [number, number][] = [[cx, cy]];
    for (let i = 0; i < 7; i++) { cx = p.x + (i % 2 === 0 ? 9 : -9) * (1 - i / 8) + (Math.random() - 0.5) * 6; cy += 26; pts.push([cx, cy]); }
    pts.push([p.x, p.y - 3]);
    g.lineStyle(7, color, 0.6);
    for (let i = 1; i < pts.length; i++) g.lineBetween(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    g.lineStyle(2, 0xffffff, 1);
    for (let i = 1; i < pts.length; i++) g.lineBetween(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    fade(ctx, g, 240);
  }
  ctx.juice.sparksAt(p.x, p.y - 6, 12, color);
  ctx.juice.ring(p.x, p.y, ctx.rx(1.2), color, 240);
  ctx.dungeon.flashLight(p.x, p.y - 24, 130, color, 1.5, 150);   // several strike at once: keep each flash modest
}

registerHazardFx({
  /** the gale: a pale cone with wind streaks racing outward and leaves/feathers riding it */
  gale(ctx, g, h, tick) {
    const ang = Math.atan2(h.dy, h.dx);
    const half = Math.acos(Math.max(-1, Math.min(1, h.in || 0.82)));
    const pts: { x: number; y: number }[] = [ctx.P(h.x, h.y)];
    for (let i = 0; i <= 14; i++) { const a = ang - half + (2 * half * i) / 14; pts.push(ctx.P(h.x + Math.cos(a) * h.r, h.y + Math.sin(a) * h.r)); }
    g.fillStyle(SKY, 0.1).fillPoints(pts, true);
    const t = ctx.now / 1000;
    for (let k = 0; k < 9; k++) {
      const a = ang - half * 0.85 + ((k * 0.618) % 1) * half * 1.7;
      const d0 = ((t * 1.9 + k * 0.37) % 1) * h.r;
      const d1 = Math.min(h.r, d0 + 1.4);
      const p0 = ctx.P(h.x + Math.cos(a) * d0, h.y + Math.sin(a) * d0), p1 = ctx.P(h.x + Math.cos(a + 0.05) * d1, h.y + Math.sin(a + 0.05) * d1);
      g.lineStyle(2, 0xffffff, 0.55 * (1 - d0 / h.r)).lineBetween(p0.x, p0.y - 8, p1.x, p1.y - 8);
      g.lineStyle(1, SKY, 0.5 * (1 - d0 / h.r)).lineBetween(p0.x, p0.y - 3, p1.x, p1.y - 3);
    }
    if (!ctx.reduced && Math.random() < 0.3) {
      const a = ang + (Math.random() - 0.5) * half * 1.6, d = Math.random() * h.r * 0.7;
      const q = ctx.P(h.x + Math.cos(a) * d, h.y + Math.sin(a) * d);
      const u = ctx.U(Math.cos(a), Math.sin(a));
      ctx.juice.bits(Math.random() < 0.5 ? 'feather' : 'leaf', q.x, q.y - 10, 1, 0xe8f6ff, { angle: (Math.atan2(u.y, u.x) * 180) / Math.PI, spread: 20, speed: 2.2 });
    }
    void tick;
  },
  /** a lightning feather tumbling down onto its marked circle (the telegraph shows where) */
  stormfeather(ctx, g, h, tick) {
    const strike = h.in || h.u - 1;
    const total = Math.max(1, strike - h.b);
    const k = Math.max(0, Math.min(1, (tick - h.b) / total));
    const p = ctx.P(h.x, h.y);
    const fall = (1 - k * k) * 150;
    const sway = Math.sin(k * 9 + h.i) * 6 * (1 - k);
    const x = p.x + sway, y = p.y - 6 - fall;
    g.fillStyle(BOLT, 0.25 + 0.4 * k).fillEllipse(p.x, p.y, ctx.rx(0.35) * 2 * (0.4 + k), ctx.ry(0.35) * 2 * (0.4 + k));
    // the feather: a pale vane with a crackling spine
    const o = overlay;
    if (o) {
      o.fillStyle(0xffffff, 0.95).fillTriangle(x, y - 7, x - 2.5, y + 3, x + 2.5, y + 3);
      o.fillStyle(SKY, 0.8).fillTriangle(x - 2.5, y + 3, x + 2.5, y + 3, x, y + 7);
      o.lineStyle(1, BOLT, 1).lineBetween(x, y - 8, x, y + 8);
      if (k > 0.6 && Math.floor(ctx.now / 50) % 2) o.lineStyle(1, BOLT, 0.9).lineBetween(x, y + 8, p.x + (Math.random() - 0.5) * 8, p.y - 4);
    }
  },
  /** a tentacle: bursts from the ground and sways there, a lantern bulb glowing at its tip */
  tentacle(ctx, _g, h, tick) {
    const arm = h.in || h.b;
    if (tick < arm) {
      // the ground bulges and cracks over it
      const p = ctx.P(h.x, h.y);
      if (Math.random() < 0.15 && !ctx.reduced) ctx.juice.dust(p.x, p.y, 1, 0x5a5862);
      return;
    }
    const scene = ctx.scene;
    const p = ctx.P(h.x, h.y);
    const g = objFor(scene, h.i, iso.depth(h.x, h.y) + 1);
    const age = (tick - arm) / 60;
    const rise = Math.min(1, age / 0.18);
    const left = (h.u - tick) / 60;
    const sink = left < 0.4 ? Math.max(0, left / 0.4) : 1;
    const height = 54 * rise * sink;
    const segs = 9;
    const t = ctx.now / 1000;
    let x = p.x, y = p.y, prevW = 7;
    let tipX = x, tipY = y;
    for (let s = 1; s <= segs; s++) {
      const k = s / segs;
      const nx = p.x + Math.sin(t * 2.2 + h.i + k * 2.6) * 7 * k + Math.sin(t * 5 + k * 5) * 1.5 * k;
      const ny = p.y - height * k;
      const w = 7 * (1 - k * 0.8);
      g.fillStyle(0x4a3e60, 1).fillTriangle(x - prevW, y, x + prevW, y, nx, ny);
      g.fillStyle(0x786c92, 1).fillTriangle(x - prevW * 0.4, y, x + prevW, y, nx + w * 0.3, ny);
      g.fillStyle(0x261c32, 1).fillTriangle(x - prevW, y, nx - w, ny, nx, ny);
      if (s % 2 === 0) g.fillStyle(0xa03aa0, 0.9).fillCircle(nx + w * 0.4, ny + 1, Math.max(1, w * 0.35));
      x = nx; y = ny; prevW = w; tipX = nx; tipY = ny;
    }
    if (height > 8) {
      const glow = 0.6 + 0.4 * darkness;
      g.fillStyle(LANTERN, 0.35 * glow).fillCircle(tipX, tipY - 2, 7 + darkness * 4);
      g.fillStyle(LANTERN, 1).fillCircle(tipX, tipY - 2, 3.5);
      g.fillStyle(0xffffff, 1).fillRect(Math.round(tipX - 1), Math.round(tipY - 4), 2, 2);
    }
    // the hole it rose from
    _g.fillStyle(0x07050c, 0.7).fillEllipse(p.x, p.y, ctx.rx(0.5) * 2, ctx.ry(0.5) * 2);
  },
  /** gravity well: spiral arms turning inward over a dark core, motes falling in */
  gravwell(ctx, g, h) {
    const p = ctx.P(h.x, h.y);
    const t = ctx.now / 1000;
    g.fillStyle(0x0a0614, 0.35).fillEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2);
    g.fillStyle(VOID, 0.12).fillEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2);
    for (let arm = 0; arm < 4; arm++) {
      let prev: { x: number; y: number } | null = null;
      for (let s = 0; s <= 16; s++) {
        const k = s / 16;
        const r = h.r * (1 - k * 0.92);
        const a = arm * (Math.PI / 2) - t * 2.4 + k * 3.4;
        const q = ctx.P(h.x + Math.cos(a) * r, h.y + Math.sin(a) * r);
        if (prev) g.lineStyle(2, k > 0.7 ? VOID_HI : VOID, 0.25 + 0.6 * k).lineBetween(prev.x, prev.y, q.x, q.y);
        prev = q;
      }
    }
    g.fillStyle(0x000000, 0.8).fillEllipse(p.x, p.y, ctx.rx(h.in || 1) * 2, ctx.ry(h.in || 1) * 2);
    g.lineStyle(2, VOID_HI, 0.9).strokeEllipse(p.x, p.y, ctx.rx(h.in || 1) * 2, ctx.ry(h.in || 1) * 2);
    if (!ctx.reduced && Math.random() < 0.35) {
      const a = Math.random() * Math.PI * 2;
      const q = ctx.P(h.x + Math.cos(a) * h.r, h.y + Math.sin(a) * h.r);
      ctx.juice.bitsAlong('mote', q.x, q.y - 4, p.x, p.y - 4, 1, VOID_HI);
    }
  },
  /** the void beam: a scorched stripe on the ground and a ray from the great eye along it */
  voidbeam(ctx, g, h, tick) {
    const [ux, uy] = voidBeamDir({ dx: h.dx, dy: h.dy, speed: h.sp, bornTick: h.b }, tick);
    const len = fxMap ? rayDistance(fxMap, h.x, h.y, ux, uy, h.len) : h.len;
    const half = (h.w || 1) / 2;
    const quad = (w: number, l: number) => [
      ctx.P(h.x - uy * w, h.y + ux * w), ctx.P(h.x + ux * l - uy * w, h.y + uy * l + ux * w),
      ctx.P(h.x + ux * l + uy * w, h.y + uy * l - ux * w), ctx.P(h.x + uy * w, h.y - ux * w),
    ];
    g.fillStyle(VOID, 0.35).fillPoints(quad(half, len), true);
    g.fillStyle(0xffffff, 0.5).fillPoints(quad(half * 0.3, len), true);
    const o = overlay;
    const eye = ctx.P(h.x, h.y), end = ctx.P(h.x + ux * len, h.y + uy * len);
    const ex = eye.x, ey = eye.y - 92;
    if (o) {
      const flick = 0.8 + Math.random() * 0.2;
      o.lineStyle(14, VOID, 0.35 * flick).lineBetween(ex, ey, end.x, end.y - 4);
      o.lineStyle(7, VOID_HI, 0.7 * flick).lineBetween(ex, ey, end.x, end.y - 4);
      o.lineStyle(2, 0xffffff, 1).lineBetween(ex, ey, end.x, end.y - 4);
      o.fillStyle(VOID_HI, 0.8).fillCircle(end.x, end.y - 4, 6 * flick);
    }
    if (!ctx.reduced && Math.random() < 0.5) ctx.juice.sparksAt(end.x, end.y - 4, 2, VOID_HI);
  },
  /** low gravity: a pale shimmering dome, motes drifting slowly upward */
  lowgrav(ctx, g, h) {
    const p = ctx.P(h.x, h.y);
    const t = ctx.now / 1000;
    g.fillStyle(MOON, 0.1).fillEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2);
    g.lineStyle(1, MOON, 0.55).strokeEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2);
    const pulse = (t * 0.6) % 1;
    g.lineStyle(1, 0xffffff, 0.35 * (1 - pulse)).strokeEllipse(p.x, p.y - pulse * 6, ctx.rx(h.r * pulse) * 2, ctx.ry(h.r * pulse) * 2);
    for (let k = 0; k < 6; k++) {
      const a = k * 1.7 + h.i;
      const rr = h.r * (0.2 + ((k * 0.37) % 0.7));
      const q = ctx.P(h.x + Math.cos(a) * rr, h.y + Math.sin(a) * rr);
      const lift = ((t * 0.35 + k * 0.21) % 1) * 30;
      g.fillStyle(0xe8f0ff, 0.7 * (1 - lift / 30)).fillRect(Math.round(q.x), Math.round(q.y - lift), 1, 1);
    }
  },
}, { gale: SKY, stormfeather: BOLT, tentacle: LANTERN, gravwell: VOID, voidbeam: VOID_HI, lowgrav: MOON });

/** Textures for the adds' shots (pixel art, made once per scene). */
export function ensureThemeBossTextures(scene: Phaser.Scene) {
  if (scene.textures.exists('tb:quill')) return;
  const t = scene.textures.createCanvas('tb:quill', 12, 5);
  if (!t) return;
  const c = t.context;
  const px = (x: number, y: number, col: string) => { c.fillStyle = col; c.fillRect(x, y, 1, 1); };
  for (let x = 0; x < 9; x++) px(x, 2, '#e0eaf6');
  for (let x = 1; x < 7; x++) { px(x, 1, x % 2 ? '#5c86b4' : '#a8ccec'); px(x, 3, x % 2 ? '#a8ccec' : '#5c86b4'); }
  for (const [x, y] of [[9, 2], [10, 2], [11, 2], [9, 1], [9, 3]]) px(x, y, '#f0dca0');
  px(0, 0, '#5c86b4'); px(0, 4, '#5c86b4');
  t.refresh();
  t.setFilter(Phaser.Textures.FilterMode.NEAREST);
}

registerProjectileFx({
  quill: { key: 'tb:quill', color: 0xe0eaf6, additive: false, trail: 'feather', trailMs: 80 },
  gust: { key: 'fx:orb', color: SKY, tint: 0xd8f2ff, scale: 0.8, trail: 'mote', trailMs: 40 },
});

registerSkillFx({
  /** a hero blown off the island (dx,dy where they fell) is set back on the rock (x,y) */
  'teleport:skyfall'(ctx, e) {
    const J = ctx.juice;
    const from = ctx.P(e.dx, e.dy), to = ctx.P(e.x, e.y);
    J.bits('feather', from.x, from.y - 10, 6, 0xe8f6ff, { angle: 90, spread: 40, speed: 2.5 });
    J.ring(to.x, to.y, ctx.rx(1.4), SKY, 360);
    J.dust(to.x, to.y, 8, 0x8a8a94);
    if (!ctx.reduced) J.beam(to.x, to.y, 70, 10, SKY, 300);
  },
});

export type { SnapHazard };
