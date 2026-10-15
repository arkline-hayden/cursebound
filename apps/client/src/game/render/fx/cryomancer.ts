import * as Phaser from 'phaser';
import type { SfxId } from '../../audio/AudioEngine';
import { registerHazardFx, registerKillFx, registerProjectileFx, registerSkillFx, type FxCtx, type SnapHazard } from './registry';
import { castFlash, chestAt, heroGhosts, impactBurst, killPop, type Pal } from './spectacle';

// Cryomancer presentation (cosmetic only). Icy cyans and whites: crystalline spikes that erupt and shatter, frost
// decals, snow storms, a pixel-art Effigy and Frozen Orb (art/fx/cryomancer.ts). Branch accents: GLACIER (solid teal
// ice), BLIZZARD (pale snow-lavender), SHATTER (hard cyan-white glints). Absolute Zero, Heart of Winter and the
// Glacial Comet get the biggest show.
//
// Sim conventions (simulation/src/classes/cryomancer.ts): c_cold_snap_hit carries the target in x,y and the caster in
// dx,dy; c_shatter / c_shatter_burst / c_hail / c_comet / c_effigy_burst / c_spike_burst / c_orb_burst /
// c_cryostasis / c_heart_of_winter are positioned at x,y; c_ice_wall / c_frost_effigy carry the wall direction in
// dx,dy (c_ice_wall: x,y = the wall centre; c_frost_effigy: x,y = the Effigy, 0.8 beyond the wall centre along the
// aim). Storms, prison, spike: x,y = the target point. Everything else uses dx,dy as the aim direction.
// Hazards: cryo_wall (x,y start, dx,dy dir, len), cryo_prison (ring r), cryo_effigy, cryo_storm (r; in = 1 Whiteout),
// cryo_orb (moving), cryo_spike (detonates at u), cryo_permafrost (r).

const ICE = 0x9fe8ff;
const FROST = 0x5ac8ff;
const WHITE = 0xeafcff;
const DEEP = 0x2a6aa8;
const PALE = 0xd8f6ff;
const SNOW = 0xd0e4ff;
const CRYO: Pal = { main: ICE, hot: 0xffffff, deep: DEEP, bits: 'ice' };
const GLACIER: Pal = { main: 0x7fe3ff, hot: 0xffffff, deep: DEEP, bits: 'ice' };
const BLIZZ: Pal = { main: SNOW, hot: 0xffffff, deep: 0x8aa8e8, bits: 'star' };
const SHATTER: Pal = { main: 0x9ff4ff, hot: 0xffffff, deep: 0x4a8af0, bits: 'ice' };

type G = Phaser.GameObjects.Graphics;

// ---------------------------------------------------------------- local infrastructure

const lastSfx = new Map<string, number>();
function sfx(ctx: FxCtx, id: SfxId, x: number, y: number, minGapMs: number, priority = 1) {
  const t = lastSfx.get(id) ?? -1e9;
  if (ctx.now - t < minGapMs) return;
  lastSfx.set(id, ctx.now);
  ctx.sfx(id, x, y, priority);
}

/** Deterministic hash 0..1 without allocating. */
function hr(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const deg = (x: number, y: number) => (Math.atan2(y, x) * 180) / Math.PI;
const isoDepth = (x: number, y: number) => (x + y) * 10;

interface Tr { t0: number; ms: number; air: boolean; draw: (g: G, k: number, now: number) => void }
const trs: Tr[] = [];
const kept = new Map<number, { s: Phaser.GameObjects.Sprite; f: number }>();
let hookedScene: Phaser.Scene | null = null;
let airG: G | null = null, groundG: G | null = null, hzAir: G | null = null;
let hzFrame = -1;

function ensure(ctx: FxCtx) {
  const s = ctx.scene;
  if (hookedScene === s && airG?.active) return;
  hookedScene = s;
  trs.length = 0;
  airG = s.add.graphics().setDepth(4647).setBlendMode(Phaser.BlendModes.ADD);
  groundG = s.add.graphics().setDepth(-72).setBlendMode(Phaser.BlendModes.ADD);
  hzAir = s.add.graphics().setDepth(4611);
  const tick = () => {
    const now = s.time.now, frame = s.game.loop.frame;
    if (hzFrame !== frame) hzAir?.clear();
    airG!.clear(); groundG!.clear();
    for (let i = trs.length - 1; i >= 0; i--) {
      const t = trs[i]!;
      const k = (now - t.t0) / t.ms;
      if (k >= 1) { trs.splice(i, 1); continue; }
      if (k >= 0) t.draw(t.air ? airG! : groundG!, k, now);
    }
    for (const [id, v] of kept) if (frame - v.f > 6 || !v.s.active) { v.s.destroy(); kept.delete(id); }
  };
  s.events.on('postupdate', tick);
  s.events.once('shutdown', () => {
    s.events.off('postupdate', tick);
    trs.length = 0;
    for (const v of kept.values()) v.s.destroy();
    kept.clear();
    hookedScene = null; airG = groundG = hzAir = null;
  });
}

/** A transient drawn every frame for `ms` (k = 0..1). Decorative: skipped under reduced effects. */
function tr(ctx: FxCtx, ms: number, draw: (g: G, k: number, now: number) => void, opts: { delay?: number; ground?: boolean } = {}) {
  if (ctx.reduced) return;
  ensure(ctx);
  trs.push({ t0: ctx.scene.time.now + (opts.delay ?? 0), ms, air: !opts.ground, draw });
}

/** The per-frame air layer for hazards (things that fly above actors). */
function air(ctx: FxCtx): G {
  ensure(ctx);
  const f = ctx.scene.game.loop.frame;
  if (hzFrame !== f) { hzFrame = f; hzAir!.clear(); }
  return hzAir!;
}

/** A sprite that lives while its hazard keeps drawing it (destroyed a few frames after the hazard goes). */
function keepSprite(ctx: FxCtx, id: number, tex: string, frame?: number): Phaser.GameObjects.Sprite | null {
  ensure(ctx);
  let v = kept.get(id);
  if (!v || !v.s.active) {
    if (!ctx.scene.textures.exists(tex)) return null;
    const s = ctx.scene.add.sprite(0, 0, tex);
    if (frame !== undefined) s.setFrame(frame);
    else if (ctx.scene.anims.exists(tex)) s.play({ key: tex, startFrame: id % Math.max(1, ctx.scene.anims.get(tex).frames.length) });
    v = { s, f: 0 };
    kept.set(id, v);
  }
  v.f = ctx.scene.game.loop.frame;
  return v.s;
}

/**
 * An ice spike (or cluster) erupting from the ground at a world point: snaps up with an overshoot, holds for `linger`
 * ms, then cracks apart (optionally spitting ice bits). Decorative.
 */
function spikeAt(ctx: FxCtx, wx: number, wy: number, o: { tex?: string; frame?: number; scale?: number; delay?: number; linger?: number; shards?: boolean } = {}) {
  if (ctx.reduced) return;
  const tex = o.tex ?? 'fx:cryomancer:spike';
  const sc = ctx.scene;
  if (!sc.textures.exists(tex)) return;
  const p = ctx.P(wx, wy), S = o.scale ?? 1;
  const s = sc.add.image(Math.round(p.x), Math.round(p.y + 2), tex, o.frame ?? 0).setOrigin(0.5, 0.95).setDepth(isoDepth(wx, wy) + 1).setScale(S, 0.05);
  if (o.delay) s.setVisible(false);
  sc.tweens.add({
    targets: s, scaleY: S, duration: 90, delay: o.delay ?? 0, ease: 'Back.easeOut', onStart: () => { s.setVisible(true); },
    onComplete: () => {
      sc.tweens.add({
        targets: s, alpha: 0, scaleY: S * 0.45, scaleX: S * 1.25, duration: 170, delay: o.linger ?? 200, ease: 'Quad.easeIn',
        onStart: () => { if (o.shards && s.active) ctx.juice.bits('ice', s.x, s.y - 10 * S, 2, PALE); },
        onComplete: () => s.destroy(),
      });
    },
  });
}

/** A ring of erupting spikes between world radii r0..r1, staggered outward (`stagger` ms per world unit). */
function spikeRing(ctx: FxCtx, x: number, y: number, r0: number, r1: number, n: number, o: { stagger?: number; linger?: number; scale?: number; shards?: boolean; tex?: string } = {}) {
  const k = ctx.juice.budget(n);
  const rot = Math.random() * 6.283;
  for (let i = 0; i < k; i++) {
    const a = rot + (i / k) * Math.PI * 2 + (hr(i, 7) - 0.5) * 0.3;
    const rr = r0 + (r1 - r0) * hr(i, 11);
    spikeAt(ctx, x + Math.cos(a) * rr, y + Math.sin(a) * rr, {
      tex: o.tex, frame: i % 4, scale: (o.scale ?? 1) * (0.75 + 0.45 * hr(i, 13)), delay: rr * (o.stagger ?? 40),
      linger: o.linger, shards: o.shards && i % 2 === 0,
    });
  }
}

/** A row of spikes erupting along a wall from its centre outward. */
function spikeLine(ctx: FxCtx, cx: number, cy: number, dx: number, dy: number, len: number, o: { scale?: number; linger?: number } = {}) {
  const n = ctx.juice.budget(Math.max(4, Math.round(len / 0.45)));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n - 0.5;
    const side = (i % 2 ? 1 : -1) * 0.18;
    spikeAt(ctx, cx + dx * len * t - dy * side, cy + dy * len * t + dx * side, {
      frame: i % 4, scale: (o.scale ?? 1) * (0.8 + 0.4 * hr(i, 3)), delay: Math.abs(t) * len * 32, linger: o.linger ?? 60, shards: i % 3 === 0,
    });
  }
}

const PT = { x: 0, y: 0 };
function pathPt(x0: number, y0: number, x1: number, y1: number, seed: number, segs: number, amp: number, i: number) {
  const t = i / segs, dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  const off = i <= 0 || i >= segs ? 0 : (hr(seed, i) - 0.5) * 2 * amp;
  PT.x = x0 + dx * t - (dy / L) * off; PT.y = y0 + dy * t + (dx / L) * off;
}

/** Frost cracks racing across the ground to world radius R, then fading (ground layer). */
function frostCracks(ctx: FxCtx, x: number, y: number, R: number, n: number, ms: number) {
  const c = ctx.P(x, y), rx = ctx.rx(R), ry = ctx.ry(R);
  const seed = (Math.random() * 1e9) | 0;
  tr(ctx, ms, (g, k) => {
    const grow = Math.min(1, k * 2.4), a = k < 0.5 ? 1 : 1 - (k - 0.5) / 0.5;
    for (let j = 0; j < n; j++) {
      const ang = (j / n) * Math.PI * 2 + hr(seed, j) * 0.5;
      const ex = c.x + Math.cos(ang) * rx * grow * (0.75 + 0.25 * hr(seed, j + 20)), ey = c.y + Math.sin(ang) * ry * grow * (0.75 + 0.25 * hr(seed, j + 20));
      g.lineStyle(2, j % 2 ? ICE : WHITE, 0.85 * a).beginPath().moveTo(c.x, c.y);
      for (let i = 1; i < 5; i++) { pathPt(c.x, c.y, ex, ey, seed + j * 7, 5, 5, i); g.lineTo(PT.x, PT.y); }
      g.lineTo(ex, ey).strokePath();
      g.fillStyle(0xffffff, a).fillRect(ex - 1, ey - 1, 2, 2);
    }
  }, { ground: true });
}

/** Collapsing ring at a screen point (the prison closing, cold gathering). */
function implode(ctx: FxCtx, sx: number, sy: number, r0: number, col: number, ms = 240) {
  tr(ctx, ms, (g, k) => {
    const r = r0 * (1 - k) ** 1.4;
    g.lineStyle(2 + 2 * (1 - k), col, 0.9 * (1 - k * 0.4)).strokeEllipse(sx, sy, r * 2, r, 32);
  }, { ground: true });
}

function hand(ctx: FxCtx, x: number, y: number, dx: number, dy: number, push = 11) {
  const c = chestAt(ctx, x, y, 16), u = ctx.U(dx, dy);
  return { x: c.x + u.x * push, y: c.y + u.y * push * 0.6, ux: u.x, uy: u.y };
}

/** True Glacier wall length / prison radius for a caster (mirrors wallDims in the sim; presentation only). */
function wallLen(ctx: FxCtx, slot: number) { return (5 + ctx.rank(slot, 'c_thick_ice')) * (ctx.rank(slot, 'c_glacial_bulwark') > 0 ? 1.3 : 1); }
function prisonR(ctx: FxCtx, slot: number) { return (2.6 + 0.4 * ctx.rank(slot, 'c_thick_ice')) * (ctx.rank(slot, 'c_glacial_bulwark') > 0 ? 1.3 : 1); }

/** Glacier upgrade tells: Rime Spikes (extra barbs), Bulwark (a shimmer), Living Glacier (a heart), Rime Armor (a shell). */
function glacierTells(ctx: FxCtx, slot: number, cx: number, cy: number, dx: number, dy: number, len: number) {
  const J = ctx.juice;
  const c = ctx.P(cx, cy);
  if (ctx.rank(slot, 'c_rime_spikes') > 0) {
    const n = J.budget(6);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5, side = i % 2 ? 0.45 : -0.45;
      spikeAt(ctx, cx + dx * len * t - dy * side, cy + dy * len * t + dx * side, { frame: (i + 1) % 4, scale: 0.6, delay: 80 + i * 20, linger: 260, shards: true });
    }
  }
  if (ctx.rank(slot, 'c_glacial_bulwark') > 0) {
    const a = ctx.P(cx - dx * len / 2, cy - dy * len / 2), b = ctx.P(cx + dx * len / 2, cy + dy * len / 2);
    tr(ctx, 420, (g, k) => {
      const al = 1 - k;
      g.lineStyle(8, ICE, 0.25 * al).lineBetween(a.x, a.y - 12, b.x, b.y - 12);
      g.lineStyle(2, 0xffffff, 0.8 * al).lineBetween(a.x, a.y - 12 - k * 10, b.x, b.y - 12 - k * 10);
    });
  }
  if (ctx.rank(slot, 'c_living_glacier') > 0) {
    J.orb(c.x, c.y - 14, GLACIER.main, 0.8, 320, 1.4);
    J.starburst(c.x, c.y - 14, 0xffffff, 1.2, 200);
  }
  const hero = ctx.rank(slot, 'c_rime_armor') > 0 ? ctx.actorSprite?.(slot) : undefined;
  if (hero && hero.active) {
    // Rime Armor: a frost shell closing around the caster
    J.ring(hero.x, hero.y, 24, ICE, 320);
    J.orb(hero.x, hero.y - 16, FROST, 0.7, 260, 1.3);
    J.bits('ice', hero.x, hero.y - 18, 6, PALE);
  }
}

/** 0..1 hazard fade: in over the first 0.15s, out over the last 0.4s. */
function fade(h: SnapHazard, tick: number) {
  return clamp01(Math.min((tick - h.b) / 9, (h.u - tick) / 24));
}

function ellipse(ctx: FxCtx, g: G, x: number, y: number, r: number, fill: number | null, alpha: number, stroke?: number, lw = 2, sa = 1) {
  const p = ctx.P(x, y), rx = ctx.rx(r), ry = ctx.ry(r);
  if (fill !== null && alpha > 0) g.fillStyle(fill, alpha).fillEllipse(p.x, p.y, rx * 2, ry * 2, 40);
  if (stroke !== undefined && sa > 0) g.lineStyle(lw, stroke, sa).strokeEllipse(p.x, p.y, rx * 2, ry * 2, 40);
}

function ticks(ctx: FxCtx, g: G, x: number, y: number, r: number, n: number, phase: number, inner: number, col: number, a: number, lw = 2) {
  if (a <= 0) return;
  g.lineStyle(lw, col, a);
  for (let i = 0; i < n; i++) {
    const ang = phase + (i / n) * Math.PI * 2;
    const c = Math.cos(ang), s = Math.sin(ang);
    const p0 = ctx.P(x + c * r, y + s * r), p1 = ctx.P(x + c * r * inner, y + s * r * inner);
    g.lineBetween(p0.x, p0.y, p1.x, p1.y);
  }
}

/** Smoothed display positions for moving hazards (snapshots arrive at 20 Hz). */
const smooth = new Map<number, { x: number; y: number; t: number }>();
function smoothed(ctx: FxCtx, h: SnapHazard): { x: number; y: number } {
  const s = smooth.get(h.i);
  if (!s || ctx.now - s.t > 500) { const v = { x: h.x, y: h.y, t: ctx.now }; smooth.set(h.i, v); return v; }
  const k = Math.min(1, (ctx.now - s.t) / 60);
  s.x += (h.x - s.x) * k; s.y += (h.y - s.y) * k; s.t = ctx.now;
  if (smooth.size > 64) for (const [id, v] of smooth) if (ctx.now - v.t > 2000) smooth.delete(id);
  return s;
}

function banner(text: string) {
  window.dispatchEvent(new CustomEvent('cursebound:banner', { detail: { text, tone: 'good' } }));
}

let lastShatterText = 0, lastShatterStop = 0;

// ---------------------------------------------------------------- casts

registerSkillFx({
  c_ice_shard: (ctx, e) => {
    const J = ctx.juice;
    const h = hand(ctx, e.x, e.y, e.dx, e.dy, 12);
    J.orb(h.x, h.y, ICE, 0.3, 110, 1.5);
    J.bits('ice', h.x, h.y, 2, PALE, { angle: deg(h.ux, h.uy), spread: 40, speed: 0.9 });
    ctx.dungeon.flashLight(h.x, h.y, 60, FROST, 0.8, 70);
    sfx(ctx, 'attack_spark', e.x, e.y, 60, ctx.mine ? 2 : 1);   // basics stay a short zip (ear fatigue); casts carry the element
  },

  c_absolute_zero: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), R = 4.2, rpx = ctx.rx(R);
    const zp = ctx.rank(e.slot, 'c_zero_point') > 0;
    castFlash(ctx, e.x, e.y, CRYO, 2.6, { glyph: true });
    J.shockwave(p.x, p.y, rpx, WHITE, 460);
    J.shockwave(p.x, p.y, rpx * 0.72, ICE, 380, 60);
    J.shockwave(p.x, p.y, rpx * 1.1, DEEP, 560, 130);
    J.glyph(p.x, p.y, rpx, ICE, 1100);
    if (zp) { J.glyph(p.x, p.y, rpx * 0.6, 0xffffff, 900); J.shockwave(p.x, p.y, rpx * 0.45, 0xffffff, 300, 200); }
    // the frost wave: two rings of spikes racing outward, then cracking apart
    spikeRing(ctx, e.x, e.y, R * 0.3, R * 0.55, 12, { stagger: 45, linger: 420, scale: 1.1, shards: true });
    spikeRing(ctx, e.x, e.y, R * 0.68, R * 0.98, 18, { stagger: 45, linger: 360, scale: 1.25, shards: true });
    frostCracks(ctx, e.x, e.y, R, 10, 760);
    J.beam(p.x, p.y, 200, 30, ICE, 420);
    J.beam(p.x, p.y, 200, 10, 0xffffff, 300);
    J.starburst(p.x, p.y - 14, 0xffffff, 2.4, 220);
    J.bits('ice', p.x, p.y - 14, 30, PALE);
    J.bits('star', p.x, p.y - 16, 10, 0xffffff);
    J.embersAt(p.x, p.y - 24, 20, PALE);
    ctx.dungeon.flashLight(p.x, p.y - 10, 340, FROST, 3.2, 560);
    J.pop(0xbfefff, 0.22, 260);
    if (ctx.mine) { J.hitStop(110); J.dilate(0.6, 320); }
    sfx(ctx, 'signature_nova', e.x, e.y, 0, 3);
    sfx(ctx, 'blast_frost', e.x, e.y, 0, 2);
  },

  // ---------------- glacier ----------------
  c_ice_wall: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), len = wallLen(ctx, e.slot);
    spikeLine(ctx, e.x, e.y, e.dx, e.dy, len, { scale: 1.2 });
    glacierTells(ctx, e.slot, e.x, e.y, e.dx, e.dy, len);
    const a = ctx.P(e.x - e.dx * len / 2, e.y - e.dy * len / 2), b = ctx.P(e.x + e.dx * len / 2, e.y + e.dy * len / 2);
    J.bitsAlong('ice', a.x, a.y - 6, b.x, b.y - 6, 10, PALE);
    J.dust(p.x, p.y, 10, 0xbfdcec);
    J.sparksAt(p.x, p.y - 8, 12, ICE);
    ctx.dungeon.flashLight(p.x, p.y - 10, 160, FROST, 1.8, 260);
    sfx(ctx, 'cast_frost', e.x, e.y, 60, ctx.mine ? 2 : 1);
    sfx(ctx, 'freeze', e.x, e.y, 200, 1);   // the wall locking into place
  },
  c_frost_effigy: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), len = wallLen(ctx, e.slot);
    const cx = e.x - e.dy * 0.8, cy = e.y + e.dx * 0.8;   // the wall centre, back toward the caster
    spikeLine(ctx, cx, cy, e.dx, e.dy, len, { scale: 1.1 });
    glacierTells(ctx, e.slot, cx, cy, e.dx, e.dy, len);
    J.beam(p.x, p.y, 100, 18, ICE, 420);
    J.beam(p.x, p.y, 100, 6, 0xffffff, 300);
    J.glyph(p.x, p.y, ctx.rx(1.2), ICE, 700);
    J.bits('star', p.x, p.y - 20, 8, WHITE);
    J.embersAt(p.x, p.y - 16, 14, PALE);
    J.dust(p.x, p.y, 8, 0xbfdcec);
    // the glide back over the ice: afterimages once the caster is moving
    ctx.scene.time.delayedCall(70, () => heroGhosts(ctx, e.slot, -e.dy, e.dx, ICE, 5, 10));
    sfx(ctx, 'freeze', e.x, e.y, 200, ctx.mine ? 2 : 1);   // the wall
    sfx(ctx, 'summon_rise', e.x, e.y, 60, 1);   // the Effigy rising
  },
  c_glacial_prison: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), R = prisonR(ctx, e.slot), rpx = ctx.rx(R);
    const n = Math.round((R * Math.PI * 2) / 0.5);
    spikeRing(ctx, e.x, e.y, R - 0.05, R + 0.05, n, { stagger: 0, linger: 90, scale: 1.25, shards: true });
    implode(ctx, p.x, p.y, rpx * 1.25, WHITE, 260);
    J.shockwave(p.x, p.y, rpx, PALE, 360);
    J.glyph(p.x, p.y, rpx, ICE, 640);
    glacierTells(ctx, e.slot, e.x, e.y, 1, 0, 0);
    J.starburst(p.x, p.y - 12, 0xffffff, 1.4);
    J.bits('ice', p.x, p.y - 10, 12, PALE);
    ctx.dungeon.flashLight(p.x, p.y - 10, 220, FROST, 2.2, 320);
    sfx(ctx, 'blast_frost', e.x, e.y, 60, ctx.mine ? 2 : 1);
    sfx(ctx, 'freeze', e.x, e.y, 120, 1);
  },
  c_effigy_burst: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), R = 2.5;
    impactBurst(ctx, e.x, e.y, R, GLACIER, 2, { dust: 6 });
    spikeRing(ctx, e.x, e.y, R * 0.35, R, 12, { stagger: 35, linger: 260, scale: 1.1, shards: true });
    frostCracks(ctx, e.x, e.y, R, 7, 520);
    J.bits('ice', p.x, p.y - 20, 24, PALE);
    J.bits('star', p.x, p.y - 20, 6, 0xffffff);
    J.starburst(p.x, p.y - 20, 0xffffff, 2);
    if (ctx.mine) J.hitStop(60);
    sfx(ctx, 'blast_frost', e.x, e.y, 80, 2);
    sfx(ctx, 'ice_shatter', e.x, e.y, 80, 1);
  },
  c_wall_block: (ctx, e) => {
    const c = chestAt(ctx, e.x, e.y);
    ctx.juice.starburst(c.x, c.y, 0xffffff, 0.8, 140);
    ctx.juice.bits('ice', c.x, c.y, 4, PALE);
    ctx.juice.ring(c.x, c.y + 14, 14, ICE, 200);
    sfx(ctx, 'impact_frost', e.x, e.y, 120, 1);
  },
  c_cryostasis: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    // an ice cocoon around the caster, holding for the invulnerability window, then cracking open
    const n = J.budget(8) || 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      spikeAt(ctx, e.x + Math.cos(a) * 0.55, e.y + Math.sin(a) * 0.55, { tex: 'fx:cryomancer:cluster', frame: i % 4, scale: 1.1, delay: i * 12, linger: 1300, shards: true });
    }
    J.shockwave(p.x, p.y, ctx.rx(3), WHITE, 400);
    J.glyph(p.x, p.y, ctx.rx(3), ICE, 900);
    J.beam(p.x, p.y, 120, 24, ICE, 500);
    J.bits('ice', p.x, p.y - 14, 14, PALE);
    ctx.dungeon.flashLight(p.x, p.y - 14, 200, FROST, 2.6, 900);
    if (ctx.mine) { J.pop(0xbfefff, 0.14, 220); banner('Cryostasis'); }
    sfx(ctx, 'shield', e.x, e.y, 0, 3);
    sfx(ctx, 'freeze', e.x, e.y, 0, 2);
  },
  c_heart_of_winter: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), R = 4, rpx = ctx.rx(R);
    const n = J.budget(12) || 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      spikeAt(ctx, e.x + Math.cos(a) * 0.62, e.y + Math.sin(a) * 0.62, { tex: 'fx:cryomancer:cluster', frame: i % 4, scale: 1.25, delay: i * 10, linger: 2300, shards: true });
    }
    spikeRing(ctx, e.x, e.y, R * 0.75, R, 18, { stagger: 40, linger: 500, scale: 1.2, shards: true });
    frostCracks(ctx, e.x, e.y, R, 12, 900);
    J.shockwave(p.x, p.y, rpx, WHITE, 480);
    J.shockwave(p.x, p.y, rpx * 0.7, ICE, 400, 60);
    J.shockwave(p.x, p.y, rpx * 1.15, DEEP, 600, 140);
    J.glyph(p.x, p.y, rpx, ICE, 1400);
    J.beam(p.x, p.y, 260, 34, ICE, 700);
    J.beam(p.x, p.y, 260, 12, 0xffffff, 500);
    J.starburst(p.x, p.y - 16, 0xffffff, 2.6, 260);
    J.bits('ice', p.x, p.y - 16, 30, PALE);
    J.bits('star', p.x, p.y - 20, 12, 0xffffff);
    ctx.dungeon.flashLight(p.x, p.y - 14, 320, WHITE, 3.2, 1300);
    if (ctx.mine) { J.pop(0xffffff, 0.26, 320); J.hitStop(120); J.dilate(0.5, 450); banner('Heart of Winter!'); }
    sfx(ctx, 'player_revived', e.x, e.y, 0, 4);
    sfx(ctx, 'freeze', e.x, e.y, 0, 2);
  },

  // ---------------- blizzard ----------------
  c_blizzard: (ctx, e) => stormCast(ctx, e.slot, e.x, e.y, false),
  c_whiteout: (ctx, e) => stormCast(ctx, e.slot, e.x, e.y, true),
  c_frozen_orb: (ctx, e) => {
    const J = ctx.juice;
    const c = chestAt(ctx, e.x, e.y, 16);
    castFlash(ctx, e.x, e.y, CRYO, 1.3, { dx: e.dx, dy: e.dy });
    J.starburst(c.x, c.y, 0xffffff, 1.2, 160);
    J.bits('ice', c.x, c.y, 6, PALE, { angle: deg(ctx.U(e.dx, e.dy).x, ctx.U(e.dx, e.dy).y), spread: 70 });
    J.bits('star', c.x, c.y, 4, 0xffffff);
    sfx(ctx, 'cast_frost', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  c_orb_burst: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), c = chestAt(ctx, e.x, e.y, 16);
    J.shockwave(p.x, p.y, ctx.rx(1.6), ICE, 300);
    J.orb(c.x, c.y, ICE, 0.9, 220, 1.8);
    J.starburst(c.x, c.y, 0xffffff, 1.6, 200);
    J.bits('ice', c.x, c.y, 12, PALE);
    J.bits('star', c.x, c.y, 5, 0xffffff);
    spikeRing(ctx, e.x, e.y, 0.5, 1.2, 6, { stagger: 30, linger: 120, scale: 0.8 });
    ctx.dungeon.flashLight(c.x, c.y, 150, FROST, 2, 200);
    sfx(ctx, 'blast_frost', e.x, e.y, 60, 1);
  },
  c_hail: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const x0 = p.x - 26, y0 = p.y - 120, x1 = p.x, y1 = p.y - 8;
    tr(ctx, 120, (g, k) => {
      const hx = x0 + (x1 - x0) * k, hy = y0 + (y1 - y0) * k;
      g.lineStyle(3, ICE, 0.45).lineBetween(hx - (x1 - x0) * 0.25, hy - (y1 - y0) * 0.25, hx, hy);
      g.fillStyle(ICE, 0.6).fillCircle(hx, hy, 4);
      g.fillStyle(0xffffff, 1).fillRect(hx - 1, hy - 1, 3, 3);
    });
    ctx.scene.time.delayedCall(ctx.reduced ? 0 : 110, () => {
      J.impact(p.x, p.y - 8, WHITE, 0.8);
      J.bits('ice', p.x, p.y - 8, 4, PALE);
      J.ring(p.x, p.y, ctx.rx(0.8), ICE, 200);
      sfx(ctx, 'impact_frost', e.x, e.y, 60, 0);   // on landing (fixed delay, so the throttle still spaces them)
    });
  },
  c_comet: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), R = 2.5;
    const sc = ctx.scene;
    const fallMs = ctx.reduced ? 0 : 120;
    if (!ctx.reduced && sc.textures.exists('fx:cryomancer:comet')) {
      const sx = p.x + 110, sy = p.y - 260;
      const s = sc.add.sprite(sx, sy, 'fx:cryomancer:comet').setDepth(4625).setScale(1.8).setRotation(Math.atan2(p.y - 8 - sy, p.x - sx));
      if (sc.anims.exists('fx:cryomancer:comet')) s.play('fx:cryomancer:comet');
      sc.tweens.add({ targets: s, x: p.x, y: p.y - 8, duration: fallMs, ease: 'Quad.easeIn', onComplete: () => s.destroy() });
      J.glyph(p.x, p.y, ctx.rx(R), ICE, 300);
    }
    sc.time.delayedCall(fallMs, () => {
      impactBurst(ctx, e.x, e.y, R, CRYO, 3, { decal: 'ichor', decalTint: 0xa8e0ff, dust: 12 });
      J.shockwave(p.x, p.y, ctx.rx(R) * 1.35, PALE, 520, 80);
      spikeRing(ctx, e.x, e.y, R * 0.35, R * 0.95, 14, { stagger: 40, linger: 420, scale: 1.2, shards: true });
      frostCracks(ctx, e.x, e.y, R * 1.1, 9, 620);
      J.beam(p.x, p.y, 150, 30, ICE, 340);
      J.bits('ice', p.x, p.y - 10, 26, PALE);
      J.bits('star', p.x, p.y - 12, 8, 0xffffff);
      sfx(ctx, 'blast_frost', e.x, e.y, 0, 3);
      sfx(ctx, 'slam_heavy', e.x, e.y, 0, 1);
    });
  },

  // ---------------- shatter ----------------
  c_frost_nova: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), R = 3;
    castFlash(ctx, e.x, e.y, SHATTER, 1.8, { glyph: true });
    impactBurst(ctx, e.x, e.y, R, SHATTER, 2, { dust: 0 });
    spikeRing(ctx, e.x, e.y, R * 0.45, R * 0.98, 16, { stagger: 40, linger: 240, scale: 1.1, shards: true });
    frostCracks(ctx, e.x, e.y, R, 8, 520);
    J.bits('ice', p.x, p.y - 12, 16, PALE);
    if (ctx.mine) J.hitStop(50);
    sfx(ctx, 'blast_frost', e.x, e.y, 60, 2);
    sfx(ctx, 'freeze', e.x, e.y, 120, 1);
  },
  c_glacial_spike: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), R = 1.8;
    J.shockwave(p.x, p.y, ctx.rx(R), SHATTER.main, 300);
    J.ring(p.x, p.y, ctx.rx(R * 0.5), 0xffffff, 200);
    spikeRing(ctx, e.x, e.y, R * 0.4, R * 0.9, 8, { stagger: 30, linger: 380, scale: 0.9 });
    J.starburst(p.x, p.y - 20, 0xffffff, 1.4);
    J.bits('ice', p.x, p.y - 16, 12, PALE);
    J.dust(p.x, p.y, 8, 0xbfdcec);
    ctx.dungeon.flashLight(p.x, p.y - 20, 170, FROST, 2.2, 280);
    sfx(ctx, 'cast_frost', e.x, e.y, 60, ctx.mine ? 2 : 1);
    sfx(ctx, 'freeze', e.x, e.y, 120, 1);
  },
  c_spike_burst: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), R = 2.4;
    impactBurst(ctx, e.x, e.y, R, SHATTER, 2, { dust: 4 });
    spikeRing(ctx, e.x, e.y, R * 0.4, R * 0.95, 12, { stagger: 30, linger: 160, scale: 1, shards: true });
    J.bits('ice', p.x, p.y - 30, 18, WHITE);
    J.bits('ice', p.x, p.y - 12, 10, PALE);
    J.bits('star', p.x, p.y - 26, 6, 0xffffff);
    if (ctx.mine) J.hitStop(40);
    sfx(ctx, 'blast_frost', e.x, e.y, 60, 2);
    sfx(ctx, 'ice_shatter', e.x, e.y, 80, 1);
  },
  c_cold_snap: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    castFlash(ctx, e.x, e.y, SHATTER, 1.6);
    J.shockwave(p.x, p.y, ctx.rx(2.5), WHITE, 320);
    J.glyph(p.x, p.y, ctx.rx(2.5), ICE, 600);
    J.shockwave(p.x, p.y, ctx.rx(9), ICE, 640);
    J.shockwave(p.x, p.y, ctx.rx(9) * 0.97, PALE, 720, 90);
    frostCracks(ctx, e.x, e.y, 2.5, 8, 480);
    ctx.dungeon.flashLight(p.x, p.y - 10, 260, FROST, 2, 300);
    if (ctx.mine) J.pop(0xd8f6ff, 0.1, 160);
    sfx(ctx, 'cast_frost', e.x, e.y, 60, 2);
    sfx(ctx, 'freeze', e.x, e.y, 120, 1);
  },
  c_cold_snap_hit: (ctx, e) => {
    ctx.bolt(e.dx, e.dy, e.x, e.y, ICE);
    const c = chestAt(ctx, e.x, e.y);
    ctx.juice.starburst(c.x, c.y, 0xffffff, 0.9, 140);
    ctx.juice.bits('ice', c.x, c.y, 4, PALE);
  },
  c_shatter: (ctx, e) => {
    const J = ctx.juice;
    const c = chestAt(ctx, e.x, e.y);
    const sp = ctx.rank(e.slot, 'c_shatterpoint') > 0;
    J.bits('ice', c.x, c.y, 10, PALE);
    J.bits('star', c.x, c.y, 3, 0xffffff);
    J.starburst(c.x, c.y, 0xffffff, sp ? 1.5 : 1.1, 150);
    if (sp) J.starburst(c.x, c.y, SHATTER.main, 1.1, 190);
    J.impact(c.x, c.y, ICE, 1.5);
    J.ring(c.x, c.y + 14, ctx.rx(0.9), WHITE, 200);
    // the frozen shell flying apart: six glassy shards
    const rot = Math.random() * 6.283;
    tr(ctx, 230, (g, k) => {
      const a = 1 - k, d = 4 + 22 * (1 - (1 - k) ** 2);
      for (let i = 0; i < 6; i++) {
        const an = rot + (i / 6) * Math.PI * 2;
        const x = c.x + Math.cos(an) * d, y = c.y + Math.sin(an) * d * 0.8 + k * k * 10;
        g.fillStyle(i % 2 ? ICE : 0xffffff, a).fillTriangle(x, y - 3, x + 2, y, x - 2, y).fillTriangle(x, y + 3, x + 2, y, x - 2, y);
      }
    });
    ctx.dungeon.flashLight(c.x, c.y, 120, FROST, 2, 160);
    if (ctx.now - lastShatterText > 220) { lastShatterText = ctx.now; J.number(c.x, c.y - 4, 'SHATTER', '#bff4ff', 'sm'); }
    if (ctx.mine && ctx.now - lastShatterStop > 140) { lastShatterStop = ctx.now; J.hitStop(28); }
    sfx(ctx, 'ice_shatter', e.x, e.y, 50, 2);
  },
  c_shatter_burst: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), R = 2.2;
    J.shockwave(p.x, p.y, ctx.rx(R), SHATTER.main, 280);
    J.ring(p.x, p.y, ctx.rx(R * 0.55), 0xffffff, 200);
    spikeRing(ctx, e.x, e.y, R * 0.5, R, 7, { stagger: 25, linger: 100, scale: 0.75 });
    J.bits('ice', p.x, p.y - 10, 8, PALE);
    sfx(ctx, 'blast_frost', e.x, e.y, 70, 1);
  },
});

/** Blizzard / Whiteout cast at the storm centre: a gathering snow cloud, the true radius, a snow fall. */
function stormCast(ctx: FxCtx, slot: number, x: number, y: number, whiteout: boolean) {
  const J = ctx.juice;
  const p = ctx.P(x, y);
  const R = (whiteout ? 3.4 : 2.8) + 0.35 * ctx.rank(slot, 'c_widening_gyre'), rpx = ctx.rx(R);
  J.glyph(p.x, p.y, rpx, PALE, whiteout ? 900 : 700);
  J.shockwave(p.x, p.y, rpx, SNOW, 440);
  implode(ctx, p.x, p.y, rpx * 1.3, WHITE, 300);
  J.bits('ice', p.x, p.y - 70, whiteout ? 18 : 12, PALE, { angle: 90, spread: 140, speed: 0.6 });
  J.bits('star', p.x, p.y - 50, whiteout ? 10 : 6, 0xffffff);
  // a cloud of wind arcs swirling overhead as the storm forms
  const ry = ctx.ry(R) * 0.6, rx = rpx * 0.9;
  tr(ctx, 560, (g, k) => {
    const a = k < 0.3 ? k / 0.3 : 1 - (k - 0.3) / 0.7;
    for (let j = 0; j < 4; j++) {
      const r = 0.45 + j * 0.18, s0 = k * 5 + j * 1.6;
      g.lineStyle(2, j % 2 ? SNOW : 0xffffff, 0.6 * a).beginPath();
      for (let i = 0; i <= 6; i++) {
        const an = s0 + i * 0.28;
        const px = p.x + Math.cos(an) * rx * r, py = p.y - 56 + Math.sin(an) * ry * r;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.strokePath();
    }
  });
  ctx.dungeon.flashLight(p.x, p.y - 20, whiteout ? 240 : 180, FROST, whiteout ? 2.2 : 1.6, whiteout ? 480 : 400);
  if (whiteout && ctx.mine) J.pop(0xe8faff, 0.12, 200);
  sfx(ctx, 'cast_frost', x, y, 60, ctx.mine ? 2 : 1);
  sfx(ctx, 'cine_whoosh', x, y, 200, whiteout ? 2 : 1);   // the storm's wind gathering
}

registerProjectileFx({
  cryo_shard: {
    key: 'fx:frostshard', color: ICE, additive: false, trail: 'ice', trailMs: 55,
    end: (ctx, sx, sy) => { ctx.juice.bits('ice', sx, sy, 2, PALE); },
  },
});

// ---------------------------------------------------------------- hazards

/** Crystal clusters standing along a world segment (walls) or around a circle (prisons), growing in and fading out. */
function crystalAt(ctx: FxCtx, id: number, wx: number, wy: number, a: number, grow: number) {
  const s = keepSprite(ctx, id, 'fx:cryomancer:cluster', Math.floor(hr(id, 1) * 4));
  if (!s) return;
  const p = ctx.P(wx, wy);
  const sc = 0.8 + 0.35 * hr(id, 2);
  s.setPosition(Math.round(p.x), Math.round(p.y + 2)).setOrigin(0.5, 0.95).setScale(sc * (hr(id, 3) < 0.5 ? -1 : 1), sc * grow).setAlpha(a).setDepth(isoDepth(wx, wy) + 1);
}

function drawWall(ctx: FxCtx, g: G, h: SnapHazard, tick: number) {
  const a = fade(h, tick);
  const grow = Math.min(1, (tick - h.b) / 9);
  const nx = -h.dy * (h.w / 2), ny = h.dx * (h.w / 2);
  const x1 = h.x + h.dx * h.len, y1 = h.y + h.dy * h.len;
  const q0 = ctx.P(h.x + nx, h.y + ny), q1 = ctx.P(x1 + nx, y1 + ny), q2 = ctx.P(x1 - nx, y1 - ny), q3 = ctx.P(h.x - nx, h.y - ny);
  g.fillStyle(PALE, 0.35 * a).beginPath().moveTo(q0.x, q0.y).lineTo(q1.x, q1.y).lineTo(q2.x, q2.y).lineTo(q3.x, q3.y).closePath().fillPath();
  g.lineStyle(2, WHITE, 0.85 * a).beginPath().moveTo(q0.x, q0.y).lineTo(q1.x, q1.y).lineTo(q2.x, q2.y).lineTo(q3.x, q3.y).closePath().strokePath();
  const n = Math.max(3, Math.round(h.len / 0.42));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const side = (i % 2 ? 1 : -1) * 0.08;
    crystalAt(ctx, h.i * 100 + i, h.x + h.dx * h.len * t - h.dy * side, h.y + h.dy * h.len * t + h.dx * side, a, grow);
  }
  if (!ctx.reduced && Math.random() < 0.15) {
    const t = Math.random();
    const q = ctx.P(h.x + h.dx * h.len * t, h.y + h.dy * h.len * t);
    ctx.juice.bits('star', q.x, q.y - 12 - Math.random() * 10, 1, 0xffffff);
  }
}

function drawPrison(ctx: FxCtx, g: G, h: SnapHazard, tick: number) {
  const a = fade(h, tick);
  const grow = Math.min(1, (tick - h.b) / 9);
  const p = ctx.P(h.x, h.y);
  const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
  g.fillStyle(ICE, 0.07 * a).fillEllipse(p.x, p.y, rx * 2, ry * 2, 48);
  g.lineStyle(Math.max(4, ctx.ry(0.6) * 2), PALE, 0.35 * a).strokeEllipse(p.x, p.y, rx * 2, ry * 2, 48);
  g.lineStyle(1, WHITE, 0.85 * a).strokeEllipse(p.x, p.y, ctx.rx(h.r + 0.3) * 2, ctx.ry(h.r + 0.3) * 2, 48)
    .strokeEllipse(p.x, p.y, ctx.rx(h.r - 0.3) * 2, ctx.ry(h.r - 0.3) * 2, 48);
  const n = Math.min(60, Math.max(10, Math.round((h.r * Math.PI * 2) / 0.5)));
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    crystalAt(ctx, h.i * 100 + i, h.x + Math.cos(t) * h.r, h.y + Math.sin(t) * h.r, a, grow);
  }
  if (!ctx.reduced && Math.random() < 0.18) {
    const t = Math.random() * 6.283;
    const q = ctx.P(h.x + Math.cos(t) * h.r, h.y + Math.sin(t) * h.r);
    ctx.juice.bits('star', q.x, q.y - 12 - Math.random() * 10, 1, 0xffffff);
  }
}

function drawStorm(ctx: FxCtx, g: G, h: SnapHazard, tick: number) {
  const a = fade(h, tick);
  const wo = h.in === 1;
  const s = smoothed(ctx, h);
  const c = ctx.P(s.x, s.y);
  const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
  // ground: the true radius, rotating wind marks, a gust ring sweeping outward
  g.fillStyle(PALE, (wo ? 0.2 : 0.14) * a).fillEllipse(c.x, c.y, rx * 2, ry * 2, 40);
  g.lineStyle(2, WHITE, 0.7 * a).strokeEllipse(c.x, c.y, rx * 2, ry * 2, 40);
  ticks(ctx, g, s.x, s.y, h.r * 0.97, wo ? 16 : 12, ctx.now / 420, 0.84, ICE, 0.55 * a);
  const gust = 0.3 + 0.65 * ((ctx.now / 900 + h.i * 0.17) % 1);
  g.lineStyle(1, ICE, 0.45 * a * (1 - gust)).strokeEllipse(c.x, c.y, rx * 2 * gust, ry * 2 * gust, 32);
  // wind arcs circling low over the field
  for (let j = 0; j < 3; j++) {
    const r = 0.35 + j * 0.22, s0 = ctx.now / (520 - j * 90) + j * 2.1;
    g.lineStyle(2, j % 2 ? SNOW : WHITE, 0.5 * a).beginPath();
    for (let i = 0; i <= 6; i++) {
      const an = s0 + i * 0.26;
      const px = c.x + Math.cos(an) * rx * r, py = c.y - 4 + Math.sin(an) * ry * r;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.strokePath();
  }
  // falling snow above the actors (thin, translucent: the footprint stays readable)
  const A = air(ctx);
  if (wo) A.fillStyle(WHITE, 0.07 * a).fillEllipse(c.x, c.y - 14, rx * 1.8, ry * 1.8 + 16, 32);
  const n = ctx.reduced ? 8 : wo ? 34 : 24;
  for (let i = 0; i < n; i++) {
    const ang = hr(h.i, i) * Math.PI * 2;
    const rad = Math.sqrt(hr(h.i + 7, i));
    const phase = (ctx.now / (wo ? 560 : 700) + i / n) % 1;
    const px = c.x + Math.cos(ang) * rx * rad - 12 + phase * 22;
    const py = c.y + Math.sin(ang) * ry * rad - 62 + phase * 58;
    const al = 0.7 * a * (1 - phase * 0.5);
    if (i % 4 === 0) A.fillStyle(0xffffff, al).fillRect(px - 1, py, 3, 1).fillRect(px, py - 1, 1, 3);
    else A.lineStyle(1, i % 3 ? WHITE : ICE, al).lineBetween(px, py, px + 4, py + 6);
  }
  if (!ctx.reduced && Math.random() < (wo ? 0.2 : 0.12)) {
    const an = Math.random() * 6.283, r = Math.sqrt(Math.random());
    ctx.juice.bits('ice', c.x + Math.cos(an) * rx * r, c.y + Math.sin(an) * ry * r - 30, 1, PALE);
  }
}

function drawOrb(ctx: FxCtx, g: G, h: SnapHazard, tick: number) {
  const a = fade(h, tick);
  const s = smoothed(ctx, h);
  const p = ctx.P(s.x, s.y);
  const cy = p.y - 16 + Math.sin(ctx.now / 140) * 1.5;
  g.fillStyle(0x000000, 0.25).fillEllipse(p.x, p.y, ctx.rx(0.6) * 2, ctx.ry(0.6) * 2, 20);
  g.lineStyle(1, ICE, 0.35 * a).strokeEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 24);
  const A = air(ctx);
  A.fillStyle(FROST, 0.22 * a).fillCircle(p.x, cy, 16);
  const spr = keepSprite(ctx, h.i * 100, 'fx:cryomancer:orb');
  if (spr) spr.setPosition(Math.round(p.x), Math.round(cy)).setRotation(ctx.now / 260).setScale(1.1).setAlpha(a).setDepth(isoDepth(s.x, s.y) + 8);
  if (!ctx.reduced && Math.random() < 0.35) ctx.juice.bits(Math.random() < 0.6 ? 'ice' : 'star', p.x, cy, 1, PALE);
}

registerHazardFx({
  cryo_wall: drawWall,
  cryo_prison: drawPrison,
  cryo_effigy: (ctx, g, h, tick) => {
    const a = fade(h, tick);
    const p = ctx.P(h.x, h.y);
    const left = h.u - tick;
    const warn = left < 30 && Math.floor(ctx.now / 70) % 2 === 0;
    // the lure radius (6) drawn as inward-drifting marks, the chill radius (2) as a frosted ring
    ellipse(ctx, g, h.x, h.y, h.r, null, 0, ICE, 1, 0.22 * a);
    const lure = 1 - ((ctx.now / 1400 + h.i * 0.2) % 1);
    ellipse(ctx, g, h.x, h.y, h.r * lure, null, 0, PALE, 1, 0.35 * a * (1 - lure));
    ticks(ctx, g, h.x, h.y, h.r, 18, -ctx.now / 1500, 0.94, ICE, 0.3 * a);
    ellipse(ctx, g, h.x, h.y, 2, PALE, 0.12 * a, warn ? 0xffffff : ICE, 2, 0.6 * a);
    g.fillStyle(ICE, 0.25 * a).fillEllipse(p.x, p.y, 34, 14, 20);
    const s = keepSprite(ctx, h.i * 100, 'fx:cryomancer:effigy');
    if (s) s.setPosition(Math.round(p.x), Math.round(p.y + 2)).setOrigin(0.5, 0.95).setScale(warn ? 1.12 : 1).setAlpha(a).setDepth(isoDepth(h.x, h.y) + 2);
    if (!ctx.reduced && Math.random() < 0.2) ctx.juice.embersAt(p.x + (Math.random() - 0.5) * 20, p.y - 10 - Math.random() * 20, 1, PALE);
  },
  cryo_storm: drawStorm,
  cryo_orb: drawOrb,
  cryo_spike: (ctx, g, h, tick) => {
    const total = Math.max(1, h.u - h.b), prog = clamp01((tick - h.b) / total);
    const blink = prog > 0.7 && Math.floor(ctx.now / 60) % 2 === 0;
    const p = ctx.P(h.x, h.y);
    ellipse(ctx, g, h.x, h.y, h.r, ICE, 0.1 + 0.18 * prog, blink ? 0xffffff : WHITE, 2, 0.5 + 0.5 * prog);
    ellipse(ctx, g, h.x, h.y, h.r * prog, SHATTER.main, 0.16);
    // cracks spreading toward the detonation radius (stable per spike)
    g.lineStyle(2, WHITE, 0.7);
    for (let j = 0; j < 7; j++) {
      const an = (j / 7) * Math.PI * 2 + hr(h.i, j) * 0.6;
      const L = h.r * prog * (0.7 + 0.3 * hr(h.i, j + 9));
      const m = ctx.P(h.x + Math.cos(an + 0.15) * L * 0.5, h.y + Math.sin(an + 0.15) * L * 0.5), q = ctx.P(h.x + Math.cos(an) * L, h.y + Math.sin(an) * L);
      g.lineBetween(p.x, p.y, m.x, m.y).lineBetween(m.x, m.y, q.x, q.y);
    }
    g.fillStyle(ICE, 0.35).fillEllipse(p.x, p.y, 30, 12, 16);
    const s = keepSprite(ctx, h.i * 100, 'fx:cryomancer:pillar', 0);
    if (s) {
      const up = Math.min(1, (tick - h.b) / 6);
      const tremble = prog > 0.6 ? (Math.floor(ctx.now / 40) % 2 ? 1 : -1) : 0;
      s.setPosition(Math.round(p.x + tremble), Math.round(p.y + 2)).setOrigin(0.5, 0.97).setScale(1.25, 1.25 * up).setAlpha(blink ? 0.7 : 1).setDepth(isoDepth(h.x, h.y) + 2);
    }
    for (let i = 0; i < 5; i++) {
      const an = (i / 5) * Math.PI * 2 + 0.4;
      crystalAt(ctx, h.i * 100 + 1 + i, h.x + Math.cos(an) * 0.75, h.y + Math.sin(an) * 0.75, 1, Math.min(1, prog * 2.5));
    }
  },
  cryo_permafrost: (ctx, g, h, tick) => {
    const a = fade(h, tick);
    const p = ctx.P(h.x, h.y);
    const s = keepSprite(ctx, h.i * 100, 'fx:cryomancer:frost', 0);
    if (s) s.setPosition(Math.round(p.x), Math.round(p.y)).setScale(ctx.rx(h.r) / 46, ctx.ry(h.r) / 23).setAlpha(0.85 * a).setDepth(-74);
    else ellipse(ctx, g, h.x, h.y, h.r, PALE, 0.18 * a);
    ellipse(ctx, g, h.x, h.y, h.r, null, 0, ICE, 1, 0.45 * a);
    if (!ctx.reduced && Math.random() < 0.15) {
      const an = Math.random() * 6.283, r = Math.sqrt(Math.random());
      ctx.juice.bits('star', p.x + Math.cos(an) * ctx.rx(h.r) * r, p.y + Math.sin(an) * ctx.ry(h.r) * r - 2, 1, 0xffffff);
    }
  },
}, { cryo_wall: ICE, cryo_prison: ICE, cryo_storm: PALE, cryo_spike: FROST, cryo_permafrost: ICE, cryo_effigy: ICE, cryo_orb: ICE });

// ---------------------------------------------------------------- kill flourish

registerKillFx({
  cryomancer: (ctx, k) => {
    const J = ctx.juice;
    const c = chestAt(ctx, k.x, k.y, 12);
    const big = k.big || k.elite > 0 || k.boss;
    J.bits('ice', c.x, c.y, big ? 12 : 5, PALE);
    J.starburst(c.x, c.y, 0xffffff, big ? 1.3 : 0.7, 150);
    // the body freezes into a crystal for an instant and cracks apart
    if ((k.dtype === 'frost' || big) && J.budget(1) > 0) spikeAt(ctx, k.x, k.y, { tex: 'fx:cryomancer:cluster', frame: (k.x * 7 + k.y * 3) & 3, scale: big ? 1.3 : 0.9, linger: 120, shards: true });
    if (big) {
      killPop(ctx, k.x, k.y, CRYO, true, k.elite);
      const p = ctx.P(k.x, k.y);
      J.shockwave(p.x, p.y, ctx.rx(1.4 + (k.boss ? 1 : 0)), ICE, 360);
      J.glyph(p.x, p.y, 22 + k.elite * 6 + (k.boss ? 16 : 0), ICE, 520);
    }
  },
});
