import * as Phaser from 'phaser';
import type { SfxId } from '../../audio/AudioEngine';
import { registerHazardFx, registerProjectileFx, registerSkillFx, type FxCtx, type SnapHazard } from './registry';

// Cryomancer presentation (cosmetic only). Glacial cyan and white: walls of ice, snow storms, shatter bursts.
// Sim conventions (simulation/src/classes/cryomancer.ts): c_cold_snap_hit carries the target in x,y and the caster in
// dx,dy; c_shatter / c_shatter_burst / c_hail / c_comet / c_effigy_burst / c_spike_burst / c_orb_burst /
// c_cryostasis / c_heart_of_winter are positioned at x,y; c_ice_wall / c_frost_effigy carry the wall direction in
// dx,dy (c_frost_effigy: x,y = the Effigy). Everything else uses dx,dy as the aim direction.
// Hazards: cryo_wall (x,y start, dx,dy dir, len), cryo_prison (ring r), cryo_effigy, cryo_storm (r), cryo_orb (moving),
// cryo_spike (detonates at u), cryo_permafrost (r).

const ICE = 0x9fe8ff;
const FROST = 0x5ac8ff;
const WHITE = 0xeafcff;
const DEEP = 0x2a6aa8;
const PALE = 0xd8f6ff;

// ---------------- textures (generated once; art-agent textures win when present) ----------------

let sceneRef: Phaser.Scene | null = null;
function ensureTextures(scene: Phaser.Scene) {
  sceneRef = scene;
  if (scene.textures.exists('fx:cryo_shard_gen')) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  // ice shard pointing east (14x8): deep core, pale facets, white tip
  g.fillStyle(DEEP, 1).fillTriangle(0, 4, 8, 0.5, 8, 7.5);
  g.fillStyle(FROST, 1).fillTriangle(3, 4, 8, 1, 14, 4).fillTriangle(3, 4, 14, 4, 8, 7);
  g.fillStyle(PALE, 1).fillTriangle(6, 3.5, 9, 2, 13, 4);
  g.fillStyle(0xffffff, 1).fillRect(11, 3, 3, 2);
  g.generateTexture('fx:cryo_shard_gen', 14, 8);
  g.destroy();
}
const texKey = (art: string, gen: string, fallback: string) =>
  sceneRef?.textures.exists(art) ? art : sceneRef?.textures.exists(gen) ? gen : fallback;

registerProjectileFx({
  cryo_shard: { get key() { return texKey('fx:frostshard', 'fx:cryo_shard_gen', 'fx:shard'); }, color: ICE, additive: true },
});

// ---------------- helpers ----------------

const lastSfx = new Map<string, number>();
function sfx(ctx: FxCtx, id: SfxId, x: number, y: number, minGapMs: number, priority = 1) {
  const t = lastSfx.get(id) ?? -1e9;
  if (ctx.now - t < minGapMs) return;
  lastSfx.set(id, ctx.now);
  ctx.sfx(id, x, y, priority);
}

function chest(ctx: FxCtx, x: number, y: number) {
  const p = ctx.P(x, y);
  return { x: p.x, y: p.y - 14 };
}

/** Radial ice spikes bursting from a world point (temporary, additive). */
function spikes(ctx: FxCtx, x: number, y: number, R: number, n: number, ms = 360) {
  if (ctx.reduced) return;
  n = Math.max(4, Math.round(n * Math.min(1, ctx.particles)));   // fewer spikes on cheaper tiers, never a bare burst
  const c = ctx.P(x, y);
  const g = ctx.scene.add.graphics().setDepth(4642).setBlendMode(Phaser.BlendModes.ADD);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (i % 2) * 0.17;
    const r = R * (0.65 + 0.35 * ((i * 7) % 5) / 4);
    const tx = c.x + Math.cos(a) * ctx.rx(r), ty = c.y + Math.sin(a) * ctx.ry(r);
    const bx = c.x + Math.cos(a) * ctx.rx(r * 0.55), by = c.y + Math.sin(a) * ctx.ry(r * 0.55);
    const h = 8 + ((i * 13) % 9);
    g.fillStyle(FROST, 0.85).fillTriangle(bx - 3, by, bx + 3, by, (bx + tx) / 2, (by + ty) / 2 - h);
    g.fillStyle(WHITE, 0.9).fillTriangle(bx - 1, by, bx + 1, by, (bx + tx) / 2, (by + ty) / 2 - h);
  }
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, ease: 'Quad.easeIn', onComplete: () => g.destroy() });
}

function burst(ctx: FxCtx, x: number, y: number, R: number, strong: boolean) {
  const J = ctx.juice;
  const p = ctx.P(x, y);
  J.ring(p.x, p.y, ctx.rx(R), ICE, strong ? 420 : 300);
  J.ring(p.x, p.y, ctx.rx(R * 0.6), WHITE, 220);
  J.sparksAt(p.x, p.y - 12, strong ? 26 : 12, ICE);
  J.impact(p.x, p.y - 14, WHITE, strong ? 2.4 : 1.4);
  ctx.dungeon.flashLight(p.x, p.y - 10, Math.max(120, ctx.rx(R) * 2.4), FROST, strong ? 2.8 : 1.8, strong ? 380 : 220);
  if (strong) { J.shake(0.012, 240); if (ctx.mine) J.hitStop(80); }
}

/** A falling streak from the sky to a world point (hail, comet). */
function fall(ctx: FxCtx, x: number, y: number, color: number, width: number, height: number, ms: number) {
  if (ctx.reduced) return;
  const p = ctx.P(x, y);
  const g = ctx.scene.add.graphics().setDepth(4646).setBlendMode(Phaser.BlendModes.ADD);
  g.lineStyle(width, color, 0.9).lineBetween(p.x - height * 0.25, p.y - height, p.x, p.y - 8);
  g.lineStyle(Math.max(1, width / 2), 0xffffff, 1).lineBetween(p.x - height * 0.12, p.y - height * 0.5, p.x, p.y - 8);
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, ease: 'Quad.easeIn', onComplete: () => g.destroy() });
}

let lastShatterText = 0;

registerSkillFx({
  c_ice_shard: (ctx, e) => {
    ensureTextures(ctx.scene);
    const u = ctx.U(e.dx, e.dy);
    const c = chest(ctx, e.x, e.y);
    ctx.juice.sparksAt(c.x + u.x * 12, c.y + u.y * 12, 2, ICE);
    ctx.dungeon.flashLight(c.x, c.y, 60, FROST, 0.8, 70);
    sfx(ctx, 'attack_spark', e.x, e.y, 70, ctx.mine ? 1 : 0);
  },
  c_absolute_zero: (ctx, e) => {
    ensureTextures(ctx.scene);
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    J.ring(p.x, p.y, ctx.rx(4.2), WHITE, 520);
    J.ring(p.x, p.y, ctx.rx(3.2), ICE, 420);
    J.ring(p.x, p.y, ctx.rx(1.8), FROST, 300);
    spikes(ctx, e.x, e.y, 4.2, 18, 600);
    J.sparksAt(p.x, p.y - 12, 34, ICE);
    J.embersAt(p.x, p.y - 20, 26, PALE);
    ctx.dungeon.flashLight(p.x, p.y - 10, 320, FROST, 3.2, 520);
    J.shake(0.02, 360);
    if (ctx.mine) { J.hitStop(110); J.flash(0xbfefff, 110); }
    sfx(ctx, 'signature_nova', e.x, e.y, 0, 3);
  },
  c_ice_wall: (ctx, e) => {
    ensureTextures(ctx.scene);
    const p = ctx.P(e.x, e.y);
    ctx.juice.dust(p.x, p.y, 10, 0xbfdcec);
    ctx.juice.sparksAt(p.x, p.y - 8, 14, ICE);
    ctx.dungeon.flashLight(p.x, p.y - 10, 160, FROST, 1.8, 260);
    if (ctx.mine) ctx.juice.shake(0.006, 120);
    sfx(ctx, 'skill_guard', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  c_frost_effigy: (ctx, e) => {
    ensureTextures(ctx.scene);
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(1.2), ICE, 320);
    ctx.juice.embersAt(p.x, p.y - 16, 14, PALE);
    ctx.juice.dust(p.x, p.y, 8, 0xbfdcec);
    sfx(ctx, 'skill_guard', e.x, e.y, 60, ctx.mine ? 2 : 1);
    sfx(ctx, 'skill_phase', e.x, e.y, 60, 1);
  },
  c_glacial_prison: (ctx, e) => {
    ensureTextures(ctx.scene);
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(2.8), WHITE, 360);
    spikes(ctx, e.x, e.y, 2.6, 14, 420);
    ctx.dungeon.flashLight(p.x, p.y - 10, 200, FROST, 2, 300);
    if (ctx.mine) ctx.juice.shake(0.008, 140);
    sfx(ctx, 'skill_guard', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  c_effigy_burst: (ctx, e) => { burst(ctx, e.x, e.y, 2.5, true); spikes(ctx, e.x, e.y, 2.5, 12); sfx(ctx, 'signature_slam', e.x, e.y, 80, 2); },
  c_wall_block: (ctx, e) => {
    const c = chest(ctx, e.x, e.y);
    ctx.juice.sparksAt(c.x, c.y, 8, WHITE);
    ctx.juice.impact(c.x, c.y, ICE, 0.8);
    sfx(ctx, 'shield', e.x, e.y, 120, 1);
  },
  c_blizzard: (ctx, e) => {
    ensureTextures(ctx.scene);
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(2.8), PALE, 420);
    ctx.juice.embersAt(p.x, p.y - 30, 18, WHITE);
    ctx.dungeon.flashLight(p.x, p.y - 20, 180, FROST, 1.6, 400);
    sfx(ctx, 'skill_phase', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  c_whiteout: (ctx, e) => {
    ensureTextures(ctx.scene);
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(3.4), WHITE, 500);
    ctx.juice.ring(p.x, p.y, ctx.rx(2.2), ICE, 380);
    ctx.juice.embersAt(p.x, p.y - 30, 26, WHITE);
    ctx.dungeon.flashLight(p.x, p.y - 20, 240, FROST, 2.2, 480);
    if (ctx.mine) ctx.juice.flash(0xe8faff, 60);
    sfx(ctx, 'skill_phase', e.x, e.y, 60, 2);
    sfx(ctx, 'signature_nova', e.x, e.y, 200, 1);
  },
  c_frozen_orb: (ctx, e) => {
    ensureTextures(ctx.scene);
    const c = chest(ctx, e.x, e.y);
    ctx.juice.impact(c.x, c.y, ICE, 1.4);
    ctx.juice.sparksAt(c.x, c.y, 10, ICE);
    sfx(ctx, 'skill_phase', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  c_orb_burst: (ctx, e) => { burst(ctx, e.x, e.y, 1.6, false); sfx(ctx, 'crit', e.x, e.y, 60, 1); },
  c_hail: (ctx, e) => {
    fall(ctx, e.x, e.y, ICE, 3, 90, 160);
    const p = ctx.P(e.x, e.y);
    ctx.juice.impact(p.x, p.y - 8, WHITE, 0.8);
    ctx.juice.sparksAt(p.x, p.y - 6, 4, ICE);
    sfx(ctx, 'hit_enemy', e.x, e.y, 60, 0);
  },
  c_comet: (ctx, e) => {
    fall(ctx, e.x, e.y, FROST, 8, 220, 260);
    burst(ctx, e.x, e.y, 2.5, true);
    spikes(ctx, e.x, e.y, 2.5, 14, 500);
    ctx.juice.dust(ctx.P(e.x, e.y).x, ctx.P(e.x, e.y).y, 14, 0xbfdcec);
    sfx(ctx, 'signature_slam', e.x, e.y, 0, 3);
  },
  c_frost_nova: (ctx, e) => {
    ensureTextures(ctx.scene);
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(3), WHITE, 340);
    ctx.juice.ring(p.x, p.y, ctx.rx(2), ICE, 240);
    spikes(ctx, e.x, e.y, 3, 14, 420);
    ctx.juice.sparksAt(p.x, p.y - 10, 18, ICE);
    ctx.dungeon.flashLight(p.x, p.y - 10, 220, FROST, 2.4, 300);
    ctx.juice.shake(0.01, 180);
    if (ctx.mine) ctx.juice.hitStop(50);
    sfx(ctx, 'signature_nova', e.x, e.y, 60, 2);
  },
  c_glacial_spike: (ctx, e) => {
    ensureTextures(ctx.scene);
    spikes(ctx, e.x, e.y, 1.8, 10, 600);
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(1.8), ICE, 260);
    ctx.juice.dust(p.x, p.y, 8, 0xbfdcec);
    ctx.dungeon.flashLight(p.x, p.y - 10, 150, FROST, 2, 260);
    if (ctx.mine) ctx.juice.shake(0.006, 100);
    sfx(ctx, 'skill_sweep', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  c_spike_burst: (ctx, e) => { burst(ctx, e.x, e.y, 2.4, false); spikes(ctx, e.x, e.y, 2.4, 12, 360); sfx(ctx, 'crit', e.x, e.y, 60, 2); },
  c_cold_snap: (ctx, e) => {
    ensureTextures(ctx.scene);
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(2.5), WHITE, 300);
    ctx.juice.ring(p.x, p.y, ctx.rx(9), FROST, 600);
    ctx.dungeon.flashLight(p.x, p.y - 10, 260, FROST, 2, 300);
    if (ctx.mine) ctx.juice.flash(0xd8f6ff, 70);
    sfx(ctx, 'skill_arc', e.x, e.y, 60, 2);
  },
  c_cold_snap_hit: (ctx, e) => {
    ctx.bolt(e.dx, e.dy, e.x, e.y, ICE);
    const c = chest(ctx, e.x, e.y);
    ctx.juice.sparksAt(c.x, c.y, 8, WHITE);
  },
  c_shatter: (ctx, e) => {
    const J = ctx.juice;
    const c = chest(ctx, e.x, e.y);
    J.sparksAt(c.x, c.y, 16, WHITE);
    J.sparksAt(c.x, c.y, 10, ICE);
    J.impact(c.x, c.y, ICE, 1.6);
    J.ring(c.x, c.y + 14, ctx.rx(0.9), WHITE, 200);
    ctx.dungeon.flashLight(c.x, c.y, 120, FROST, 2, 160);
    if (ctx.now - lastShatterText > 220) { lastShatterText = ctx.now; J.number(c.x, c.y - 4, 'SHATTER', '#bff4ff', 'sm'); }
    if (ctx.mine) { J.hitStop(28); J.shake(0.005, 80); }
    sfx(ctx, 'crit', e.x, e.y, 50, 2);
  },
  c_shatter_burst: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(2.2), ICE, 260);
    spikes(ctx, e.x, e.y, 2.2, 8, 300);
  },
  c_cryostasis: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(3), WHITE, 400);
    spikes(ctx, e.x, e.y, 1.2, 10, 1400);
    ctx.dungeon.flashLight(p.x, p.y - 14, 200, FROST, 2.6, 900);
    if (ctx.mine) { ctx.juice.flash(0xbfefff, 120); window.dispatchEvent(new CustomEvent('cursebound:banner', { detail: { text: 'Cryostasis', tone: 'good' } })); }
    sfx(ctx, 'shield', e.x, e.y, 0, 3);
  },
  c_heart_of_winter: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    burst(ctx, e.x, e.y, 4, true);
    spikes(ctx, e.x, e.y, 1.4, 14, 2200);
    if (ctx.mine) { ctx.juice.flash(0xffffff, 160); window.dispatchEvent(new CustomEvent('cursebound:banner', { detail: { text: 'Heart of Winter!', tone: 'good' } })); }
    ctx.dungeon.flashLight(p.x, p.y - 14, 300, WHITE, 3, 1200);
    sfx(ctx, 'player_revived', e.x, e.y, 0, 4);
  },
});

// ---------------- hazards ----------------

/** Smoothed display positions for moving hazards (snapshots arrive at 20 Hz). */
const smooth = new Map<number, { x: number; y: number; t: number }>();
function smoothed(ctx: FxCtx, h: SnapHazard): { x: number; y: number } {
  const s = smooth.get(h.i);
  if (!s || ctx.now - s.t > 500) { smooth.set(h.i, { x: h.x, y: h.y, t: ctx.now }); return { x: h.x, y: h.y }; }
  const k = Math.min(1, (ctx.now - s.t) / 60);
  s.x += (h.x - s.x) * k; s.y += (h.y - s.y) * k; s.t = ctx.now;
  if (smooth.size > 64) for (const [id, v] of smooth) if (ctx.now - v.t > 2000) smooth.delete(id);
  return s;
}

/** 0..1 fade: in over the first 0.15s, out over the last 0.4s. */
function fade(h: SnapHazard, tick: number) {
  const age = (tick - h.b) / 60, left = (h.u - tick) / 60;
  return Math.max(0, Math.min(1, age / 0.15, left / 0.4));
}

function ellipse(ctx: FxCtx, g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, fill: number, alpha: number, stroke?: number, lw = 2, strokeAlpha = 1) {
  const p = ctx.P(x, y);
  if (alpha > 0) g.fillStyle(fill, alpha).fillEllipse(p.x, p.y, ctx.rx(r) * 2, ctx.ry(r) * 2, 40);
  if (stroke !== undefined) g.lineStyle(lw, stroke, strokeAlpha).strokeEllipse(p.x, p.y, ctx.rx(r) * 2, ctx.ry(r) * 2, 40);
}

/** Ice crystals standing on the ground at a world point. */
function crystal(ctx: FxCtx, g: Phaser.GameObjects.Graphics, x: number, y: number, h: number, a: number, seed: number) {
  const p = ctx.P(x, y);
  const w = 3 + (seed % 3);
  g.fillStyle(DEEP, 0.75 * a).fillTriangle(p.x - w, p.y, p.x + w, p.y, p.x + (seed % 2 ? 1 : -1), p.y - h);
  g.fillStyle(ICE, 0.9 * a).fillTriangle(p.x - w + 1, p.y, p.x, p.y, p.x + (seed % 2 ? 1 : -1), p.y - h);
  g.fillStyle(WHITE, a).fillRect(p.x - 1, p.y - h + 2, 1, Math.max(2, h * 0.4));
}

function drawWall(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const a = fade(h, tick);
  const nx = -h.dy * (h.w / 2), ny = h.dx * (h.w / 2);
  const pts = [
    ctx.P(h.x + nx, h.y + ny), ctx.P(h.x + h.dx * h.len + nx, h.y + h.dy * h.len + ny),
    ctx.P(h.x + h.dx * h.len - nx, h.y + h.dy * h.len - ny), ctx.P(h.x - nx, h.y - ny),
  ];
  g.fillStyle(PALE, 0.4 * a).fillPoints(pts, true);
  g.lineStyle(2, WHITE, 0.8 * a).strokePoints(pts, true);
  const n = Math.max(3, Math.round(h.len / 0.45));
  const grow = Math.min(1, (tick - h.b) / 9);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const seed = (h.i * 31 + i * 17) % 97;
    crystal(ctx, g, h.x + h.dx * h.len * t, h.y + h.dy * h.len * t, (12 + (seed % 10)) * grow, a, seed);
  }
}

function drawRing(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const a = fade(h, tick);
  const p = ctx.P(h.x, h.y);
  g.lineStyle(Math.max(4, ctx.ry(0.6) * 2), PALE, 0.35 * a).strokeEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 48);
  g.lineStyle(2, WHITE, 0.8 * a).strokeEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 48);
  g.fillStyle(ICE, 0.08 * a).fillEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 48);
  const n = Math.max(10, Math.round((h.r * Math.PI * 2) / 0.5));
  const grow = Math.min(1, (tick - h.b) / 9);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const seed = (h.i * 13 + i * 29) % 89;
    crystal(ctx, g, h.x + Math.cos(t) * h.r, h.y + Math.sin(t) * h.r, (12 + (seed % 9)) * grow, a, seed);
  }
}

function drawStorm(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const a = fade(h, tick);
  ellipse(ctx, g, h.x, h.y, h.r, PALE, 0.16 * a, WHITE, 2, 0.6 * a);
  ellipse(ctx, g, h.x, h.y, h.r * (0.35 + 0.6 * ((ctx.now / 900) % 1)), ICE, 0, ICE, 1, 0.35 * a);
  const c = ctx.P(h.x, h.y);
  const n = ctx.reduced ? 8 : 26;
  const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
  for (let i = 0; i < n; i++) {
    const seed = (i * 9301 + h.i * 49297) % 233280;
    const ang = (seed / 233280) * Math.PI * 2;
    const rad = ((seed * 7) % 1000) / 1000;
    const phase = ((ctx.now / 700) + i / n) % 1;
    const px = c.x + Math.cos(ang) * rx * Math.sqrt(rad) - 10 + phase * 20;
    const groundY = c.y + Math.sin(ang) * ry * Math.sqrt(rad);
    const py = groundY - 60 + phase * 56;
    g.lineStyle(2, WHITE, 0.75 * a * (1 - phase * 0.5)).lineBetween(px, py, px + 4, py + 6);
  }
}

/** High-depth layer for things that fly (drawn above actors). Cleared every frame; emptied when nothing draws into it. */
let air: Phaser.GameObjects.Graphics | null = null;
let airFrame = -1, airTouched = 0;
function airLayer(ctx: FxCtx): Phaser.GameObjects.Graphics {
  if (!air || !air.active || air.scene !== ctx.scene) {
    const g = ctx.scene.add.graphics().setDepth(4610);
    air = g;
    ctx.scene.events.on('postupdate', () => { if (g.active && ctx.scene.time.now - airTouched > 80) g.clear(); });
  }
  if (airFrame !== ctx.now) { airFrame = ctx.now; air.clear(); }
  airTouched = ctx.now;
  return air;
}

function drawOrb(ctx: FxCtx, ground: Phaser.GameObjects.Graphics, h: SnapHazard) {
  const s = smoothed(ctx, h);
  const p = ctx.P(s.x, s.y);
  ground.fillStyle(0x000000, 0.25).fillEllipse(p.x, p.y, ctx.rx(0.6) * 2, ctx.ry(0.6) * 2, 20);
  const g = airLayer(ctx);
  const cy = p.y - 16;
  g.fillStyle(FROST, 0.35).fillCircle(p.x, cy, 14);
  g.fillStyle(ICE, 0.85).fillCircle(p.x, cy, 8);
  g.fillStyle(WHITE, 1).fillCircle(p.x - 2, cy - 2, 3);
  const spin = ctx.now / 120;
  for (let i = 0; i < 6; i++) {
    const a = spin + (i * Math.PI) / 3;
    g.lineStyle(2, WHITE, 0.8).lineBetween(p.x + Math.cos(a) * 6, cy + Math.sin(a) * 4, p.x + Math.cos(a) * 15, cy + Math.sin(a) * 10);
  }
  if (!ctx.reduced && Math.random() < 0.3) ctx.juice.embersAt(p.x, cy, 1, PALE);
}

registerHazardFx({
  cryo_wall: drawWall,
  cryo_prison: drawRing,
  cryo_effigy: (ctx, g, h, tick) => {
    const a = fade(h, tick);
    const p = ctx.P(h.x, h.y);
    ellipse(ctx, g, h.x, h.y, 6 * (0.85 + 0.15 * Math.sin(ctx.now / 160)), ICE, 0, ICE, 1, 0.25 * a);
    g.fillStyle(0x000000, 0.25 * a).fillEllipse(p.x, p.y, 22, 9, 20);
    const bob = Math.sin(ctx.now / 220) * 2;
    // a kneeling ice figure: body diamond, head, glow
    g.fillStyle(FROST, 0.3 * a).fillCircle(p.x, p.y - 18 + bob, 16);
    g.fillStyle(DEEP, 0.9 * a).fillTriangle(p.x - 8, p.y - 2, p.x + 8, p.y - 2, p.x, p.y - 28 + bob);
    g.fillStyle(ICE, 0.95 * a).fillTriangle(p.x - 6, p.y - 4, p.x + 2, p.y - 4, p.x, p.y - 26 + bob);
    g.fillStyle(PALE, a).fillCircle(p.x, p.y - 31 + bob, 4);
    g.fillStyle(WHITE, a).fillRect(p.x - 1, p.y - 33 + bob, 2, 2);
  },
  cryo_storm: drawStorm,
  cryo_orb: (ctx, g, h) => drawOrb(ctx, g, h),
  cryo_spike: (ctx, g, h, tick) => {
    const total = Math.max(1, h.u - h.b), prog = Math.min(1, (tick - h.b) / total);
    ellipse(ctx, g, h.x, h.y, h.r, ICE, 0.12 + 0.2 * prog, WHITE, 2, 0.5 + 0.5 * prog);
    for (let i = 0; i < 7; i++) {
      const t = (i / 7) * Math.PI * 2;
      const r = i === 0 ? 0 : 0.7;
      crystal(ctx, g, h.x + Math.cos(t) * r, h.y + Math.sin(t) * r, (i === 0 ? 34 : 20) * (0.4 + 0.6 * prog), 1, i * 11 + h.i);
    }
  },
  cryo_permafrost: (ctx, g, h, tick) => {
    const a = fade(h, tick);
    ellipse(ctx, g, h.x, h.y, h.r, PALE, 0.18 * a, ICE, 1, 0.4 * a);
    const c = ctx.P(h.x, h.y);
    for (let i = 0; i < 9; i++) {
      const ang = (i / 9) * Math.PI * 2 + (h.i % 7) * 0.3;
      const len = 0.5 + ((h.i * 7 + i * 13) % 10) / 20;
      g.lineStyle(1, WHITE, 0.55 * a).lineBetween(c.x, c.y, c.x + Math.cos(ang) * ctx.rx(h.r * len), c.y + Math.sin(ang) * ctx.ry(h.r * len));
    }
  },
}, { cryo_wall: ICE, cryo_prison: ICE, cryo_storm: PALE, cryo_spike: FROST, cryo_permafrost: ICE, cryo_effigy: ICE });

