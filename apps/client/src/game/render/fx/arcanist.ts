import * as Phaser from 'phaser';
import type { SfxId } from '../../audio/AudioEngine';
import type { BitKind } from '../Juice';
import { registerHazardFx, registerKillFx, registerProjectileFx, registerSkillFx, type FxCtx, type SnapHazard } from './registry';
import { fileSfx, skillLayer, skillSfx } from './kit3';
import { castFlash, chestAt, hitSpark, impactBurst, killPop, upgradeScale, type Pal } from './spectacle';
import { SKILL_FILE } from '../../audio/fileCues';

// Arcanist presentation (cosmetic only). Three branch identities: EMBER (molten reds, oranges, gold, white-hot),
// STORM (indigo, electric violet-blue, white arcs) and RIFT (void, astral violet, lilac, violet-white). Every skill
// is layered: cast flash -> travel (bolts, lobs, tears) -> impact burst -> lingering ground effect -> kill flourish.
//
// Sim conventions (simulation/src/classes/arcanist.ts, players.ts):
//   a_spark / a_fireline / a_ball_lightning / a_phase_step: x,y caster (phase step: arrival), dx,dy aim.
//   a_arc_bolt / a_overload: x,y caster, dx,dy = the chain end. a_chain_link / a_ball_zap: links x,y -> dx,dy.
//   a_meteor / a_flame_wall / a_rift_gate / a_singularity: x,y caster (gate: first gate), dx,dy = target point.
//   a_blink_strike: x,y arrival, dx,dy departure. teleport:rift (every rift teleport): x,y arrival, dx,dy origin.
//   bursts (a_meteor_impact, a_overload_burst, a_thunderstrike, a_stormcaller, a_combustion, a_echo_burst,
//   a_singularity_collapse, a_pyroclasm) carry their radius in dx. a_attune: dx = 1 ember / 2 storm.
// Hazards: fireline (base line), tempest (base storm field), horizon (Event Horizon pull), a_meteor (fuse),
// a_crater, a_flamewall, a_ball, a_gate (dx,dy,len -> partner), a_echo, a_singularity, a_combust.
// Projectiles: spark (Spark and Pyroclasm's 8 sparks), a_shard (Riftwalker ring).

const E_DEEP = 0xc0300f, S_DEEP = 0x5a3aff, A_DEEP = 0x5a2aa0;
const EMBER: Pal = { main: 0xff7a1a, hot: 0xfff0c8, deep: E_DEEP, bits: 'mote' };
const STORM: Pal = { main: 0x8fa8ff, hot: 0xeef4ff, deep: S_DEEP, bits: 'zap' };
const RIFT: Pal = { main: 0xb07aff, hot: 0xf6eeff, deep: A_DEEP, bits: 'star' };
const E_RED = 0xd8401a, E_GOLD = 0xffc24a, E_CHAR = 0x5a1006;
const S_VIOLET = 0xa070ff, S_CYAN = 0x9fd8ff, S_INDIGO = 0x2a1e7a;
const A_LILAC = 0xd7a8ff, VOID = 0x14061f;

type G = Phaser.GameObjects.Graphics;

// ---------------------------------------------------------------- local infrastructure

const lastSfx = new Map<string, number>();
/** Throttled positional sound (high-frequency events would otherwise machine-gun). */
function sfx(ctx: FxCtx, id: SfxId, x: number, y: number, minGapMs = 40, priority = 1) {
  const t = lastSfx.get(id) ?? -1e9;
  if (ctx.now - t < minGapMs) return;
  lastSfx.set(id, ctx.now);
  ctx.sfx(id, x, y, priority);
}

/** Rift casts (Phase Step, Blink Strike, Rift Gate) emit their teleport just before the cast event: when the cast plays
 *  its own recorded file (which covers the blink), the teleport's shared blink is dropped. slot -> ctx.now of that file. */
const riftFileAt = new Map<number, number>();
function riftFile(ctx: FxCtx, slot: number, skill: string) {
  const f = SKILL_FILE[skill];
  if (f && ctx.hasFile(f)) riftFileAt.set(slot, ctx.now);
}

/** Hazards whose first appearance has already played its sound (hazard id -> ctx.now). */
const heard = new Map<number, number>();
/** True once per hazard, on its first frame (only when seen within a few ticks of its birth). */
function firstSight(ctx: FxCtx, h: SnapHazard, tick: number): boolean {
  if (heard.has(h.i) || tick - h.b > 3) return false;
  if (heard.size > 64) for (const [id, t] of heard) if (ctx.now - t > 20000) heard.delete(id);
  heard.set(h.i, ctx.now);
  return true;
}

/** Deterministic hash 0..1 (flicker seeds, stable per-hazard layouts) without allocating. */
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
let airG: G | null = null, groundG: G | null = null, hzAir: G | null = null, hzLow: G | null = null;
let hzFrame = -1, lowFrame = -1;

/** One additive air layer + one ground layer for transients, one per-frame air layer for hazards, and the sweeper. */
function ensure(ctx: FxCtx) {
  const s = ctx.scene;
  if (hookedScene === s && airG?.active) return;
  hookedScene = s;
  trs.length = 0;
  airG = s.add.graphics().setDepth(4647).setBlendMode(Phaser.BlendModes.ADD);
  groundG = s.add.graphics().setDepth(-72).setBlendMode(Phaser.BlendModes.ADD);
  hzAir = s.add.graphics().setDepth(4612).setBlendMode(Phaser.BlendModes.ADD);
  hzLow = s.add.graphics().setDepth(-73);
  const tick = () => {
    const now = s.time.now, frame = s.game.loop.frame;
    if (hzFrame !== frame) hzAir?.clear();
    if (lowFrame !== frame) hzLow?.clear();
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
    hookedScene = null; airG = groundG = hzAir = hzLow = null;
  });
}

/** A transient drawn every frame for `ms` (k = 0..1). Decorative: skipped under reduced effects. */
function tr(ctx: FxCtx, ms: number, draw: (g: G, k: number, now: number) => void, opts: { delay?: number; ground?: boolean } = {}) {
  if (ctx.reduced) return;
  ensure(ctx);
  trs.push({ t0: ctx.scene.time.now + (opts.delay ?? 0), ms, air: !opts.ground, draw });
}

/** The per-frame air layer for hazards (cleared at the first draw of each frame). */
function air(ctx: FxCtx): G {
  ensure(ctx);
  const f = ctx.scene.game.loop.frame;
  if (hzFrame !== f) { hzFrame = f; hzAir!.clear(); }
  return hzAir!;
}

/** The per-frame low layer for hazards: above ground sprites (gate mouths), below actors. */
function low(ctx: FxCtx): G {
  ensure(ctx);
  const f = ctx.scene.game.loop.frame;
  if (lowFrame !== f) { lowFrame = f; hzLow!.clear(); }
  return hzLow!;
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

/** One-shot pixel sprite: plays its animation (when it has one) and fades out over `ms`. Decorative. */
function oneShot(ctx: FxCtx, tex: string, x: number, y: number, o: { scale?: number; sy?: number; rot?: number; depth?: number; ms?: number; delay?: number; originY?: number; grow?: number; add?: boolean; tint?: number } = {}) {
  if (ctx.reduced || !ctx.scene.textures.exists(tex)) return;
  const sc = ctx.scene;
  const s = sc.add.sprite(Math.round(x), Math.round(y), tex).setOrigin(0.5, o.originY ?? 0.5).setDepth(o.depth ?? 4655)
    .setScale(o.scale ?? 1, (o.scale ?? 1) * (o.sy ?? 1)).setRotation(o.rot ?? 0);
  if (o.add !== false) s.setBlendMode(Phaser.BlendModes.ADD);
  if (o.tint !== undefined) s.setTint(o.tint);
  const ms = o.ms ?? 360, delay = o.delay ?? 0;
  if (delay) s.setVisible(false);
  const start = () => { s.setVisible(true); if (sc.anims.exists(tex)) s.play(tex); };
  if (delay) sc.time.delayedCall(delay, start); else start();
  const g = o.grow ?? 1;
  sc.tweens.add({ targets: s, alpha: 0, scaleX: s.scaleX * g, scaleY: s.scaleY * g, duration: ms, delay: delay + ms * 0.35, ease: 'Quad.easeIn', onComplete: () => s.destroy() });
}

const PT = { x: 0, y: 0 };
/** Point i of a jagged bolt path (into PT). */
function pathPt(x0: number, y0: number, x1: number, y1: number, seed: number, segs: number, amp: number, i: number) {
  const t = i / segs, dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  const off = i <= 0 || i >= segs ? 0 : (hr(seed, i) - 0.5) * 2 * amp * (0.55 + 0.45 * Math.sin(Math.PI * t));
  PT.x = x0 + dx * t - (dy / L) * off; PT.y = y0 + dy * t + (dx / L) * off;
}
function boltPath(g: G, x0: number, y0: number, x1: number, y1: number, seed: number, segs: number, amp: number, w: number, col: number, a: number) {
  if (a <= 0.02 || w <= 0) return;
  g.lineStyle(w, col, Math.min(1, a)).beginPath().moveTo(x0, y0);
  for (let i = 1; i < segs; i++) { pathPt(x0, y0, x1, y1, seed, segs, amp, i); g.lineTo(PT.x, PT.y); }
  g.lineTo(x1, y1).strokePath();
}

/**
 * Layered flickering lightning between two screen points: a wide glow, a coloured body, a white core and `forks`
 * side branches; re-jitters every 45ms while it fades.
 */
function zap(ctx: FxCtx, x0: number, y0: number, x1: number, y1: number, col: number, glow: number, o: { ms?: number; w?: number; forks?: number; amp?: number; delay?: number } = {}) {
  const ms = o.ms ?? 180, w = o.w ?? 3, forks = o.forks ?? 1;
  const seed0 = (Math.random() * 1e9) | 0;
  const L = Math.hypot(x1 - x0, y1 - y0);
  const segs = Math.max(3, Math.min(12, Math.round(L / 13)));
  const amp = o.amp ?? Math.min(14, 3 + L * 0.08);
  tr(ctx, ms, (g, k, now) => {
    const seed = seed0 + ((now / 45) | 0);
    const f = 1 - k * k;
    boltPath(g, x0, y0, x1, y1, seed, segs, amp, w * 2.8 * f + 1, glow, 0.32 * f);
    boltPath(g, x0, y0, x1, y1, seed, segs, amp, w * f + 0.6, col, 0.95 * f);
    boltPath(g, x0, y0, x1, y1, seed, segs, amp, Math.max(1, w * 0.4), 0xffffff, f);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    for (let j = 0; j < forks; j++) {
      const i = 1 + Math.floor(hr(seed0, j + 40) * Math.max(1, segs - 2));
      pathPt(x0, y0, x1, y1, seed, segs, amp, i);
      const bx = PT.x, by = PT.y;
      const a = ang + (hr(seed0, j + 60) < 0.5 ? -1 : 1) * (0.45 + hr(seed0, j + 80) * 0.6);
      const fl = L * (0.16 + hr(seed0, j + 90) * 0.2) + 8;
      boltPath(g, bx, by, bx + Math.cos(a) * fl, by + Math.sin(a) * fl, seed + j * 13, 4, amp * 0.6, Math.max(1, w * 0.55 * f), col, 0.85 * f);
    }
  }, { delay: o.delay });
}

/** Lightning from the sky onto a world point: branching bolt, ground flash, sparks and light. */
function skyZap(ctx: FxCtx, x: number, y: number, col: number, glow: number, height = 210, w = 4, forks = 2) {
  const p = ctx.P(x, y);
  zap(ctx, p.x + (Math.random() - 0.5) * 34, p.y - height, p.x, p.y - 4, col, glow, { ms: 200, w, forks, amp: 16 });
  ctx.juice.impact(p.x, p.y - 6, 0xffffff, 1.3);
  ctx.juice.sparksAt(p.x, p.y - 4, 8, col);
  ctx.dungeon.flashLight(p.x, p.y - 30, 170, col, 2.4, 160);
}

/** Star-tipped rays racing out along the ground to radius R (world), drawn above the floor. */
function starRays(ctx: FxCtx, x: number, y: number, R: number, n: number, col: number, hot: number, ms = 380) {
  const c = ctx.P(x, y), rx = ctx.rx(R), ry = ctx.ry(R), rot = Math.random() * 6.28;
  tr(ctx, ms, (g, k) => {
    const e = 1 - (1 - k) ** 3, a = 1 - k;
    for (let i = 0; i < n; i++) {
      const ang = rot + (i / n) * Math.PI * 2;
      const ux = Math.cos(ang) * rx, uy = Math.sin(ang) * ry;
      const hx = c.x + ux * e, hy = c.y + uy * e;
      g.lineStyle(2, col, 0.85 * a).lineBetween(c.x + ux * e * 0.4, c.y + uy * e * 0.4, hx, hy);
      g.fillStyle(hot, a).fillRect(hx - 1, hy - 1, 3, 3).fillRect(hx - 4, hy, 9, 1).fillRect(hx, hy - 4, 1, 9);
    }
  });
}

/** A ring of flame tongues erupting at world radius R around a point (pixel flame sprites). */
function flameRing(ctx: FxCtx, x: number, y: number, R: number, n: number, scale = 1, stagger = 16) {
  const k = ctx.juice.budget(n);
  for (let i = 0; i < k; i++) {
    const a = (i / k) * Math.PI * 2 + Math.random() * 0.3;
    const wx = x + Math.cos(a) * R, wy = y + Math.sin(a) * R;
    const p = ctx.P(wx, wy);
    oneShot(ctx, 'fx:arcanist:flame', p.x, p.y + 2, { scale: scale * (0.85 + Math.random() * 0.3), originY: 0.95, depth: isoDepth(wx, wy) + 2, ms: 420, delay: i * stagger, grow: 1.15 });
  }
}

/** Parabolic lob from a screen point to a screen point: a fading trail and a hot head travelling along it. */
function lob(ctx: FxCtx, ax: number, ay: number, bx: number, by: number, col: number, head: number, height: number, ms: number) {
  tr(ctx, ms + 120, (g, kk) => {
    const k = Math.min(1, kk * (ms + 120) / ms);
    const tail = Math.max(0, k - 0.45);
    g.lineStyle(4, col, 0.55 * (1 - kk)).beginPath();
    for (let i = 0; i <= 10; i++) {
      const t = tail + (k - tail) * (i / 10);
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t - Math.sin(t * Math.PI) * height;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokePath();
    if (kk * (ms + 120) < ms) {
      const x = ax + (bx - ax) * k, y = ay + (by - ay) * k - Math.sin(k * Math.PI) * height;
      g.fillStyle(col, 0.5).fillCircle(x, y, 6);
      g.fillStyle(head, 1).fillCircle(x, y, 3);
    }
  });
}

/** Collapsing ring at a screen point (implosions, departures). */
function implode(ctx: FxCtx, sx: number, sy: number, r0: number, col: number, ms = 240) {
  tr(ctx, ms, (g, k) => {
    const r = r0 * (1 - k) ** 1.5;
    g.lineStyle(2 + 2 * (1 - k), col, 0.9 * (1 - k * 0.5)).strokeEllipse(sx, sy, r * 2, r, 24);
  }, { ground: true });
}

/** Hand point (chest height pushed toward the aim). */
function hand(ctx: FxCtx, x: number, y: number, dx: number, dy: number, push = 11) {
  const c = chestAt(ctx, x, y, 16), u = ctx.U(dx, dy);
  return { x: c.x + u.x * push, y: c.y + u.y * push * 0.6, ux: u.x, uy: u.y };
}

/** Storm-cast extras: Static Shell visibly wraps the caster in a crackling shell. */
function stormCastFx(ctx: FxCtx, slot: number, x: number, y: number) {
  if (ctx.rank(slot, 'a_static_shell') <= 0) return;
  const p = ctx.P(x, y);
  ctx.juice.ring(p.x, p.y, 22, S_CYAN, 300);
  ctx.juice.orb(p.x, p.y - 16, S_VIOLET, 0.7, 260, 1.3);
  ctx.juice.bits('zap', p.x, p.y - 18, 5, S_CYAN);
  sfx(ctx, 'shield', x, y, 300, 0);
}

/** 0..1 hazard fade: in over the first 0.12s, out over the last 0.35s. */
function fade(h: SnapHazard, tick: number) {
  return clamp01(Math.min((tick - h.b) / 7, (h.u - tick) / 21));
}

function ellipse(ctx: FxCtx, g: G, x: number, y: number, r: number, fill: number | null, alpha: number, stroke?: number, lw = 2, sa = 1) {
  const p = ctx.P(x, y), rx = ctx.rx(r), ry = ctx.ry(r);
  if (fill !== null && alpha > 0) g.fillStyle(fill, alpha).fillEllipse(p.x, p.y, rx * 2, ry * 2, 40);
  if (stroke !== undefined && sa > 0) g.lineStyle(lw, stroke, sa).strokeEllipse(p.x, p.y, rx * 2, ry * 2, 40);
}

/** Rotating tick marks around a world circle (rune ring / wind marks). */
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

// ---------------------------------------------------------------- casts

registerSkillFx({
  // ---------------- base kit ----------------
  a_spark: (ctx, e) => {
    const J = ctx.juice;
    const h = hand(ctx, e.x, e.y, e.dx, e.dy, 12);
    const hot = ctx.rank(e.slot, 'a_conflagration') > 0;
    J.orb(h.x, h.y, hot ? E_GOLD : EMBER.main, hot ? 0.36 : 0.28, 110, 1.5);
    J.bits('mote', h.x, h.y, hot ? 3 : 2, hot ? 0xfff0c8 : E_GOLD, { angle: deg(h.ux, h.uy), spread: 50, speed: 1.6 });
    if (hot) J.embersAt(h.x, h.y, 2, E_RED);
    ctx.dungeon.flashLight(h.x, h.y, 70, 0xff9a3a, 0.9, 80);
    skillSfx(ctx, e.skill, 'attack_spark', e.x, e.y, 55, ctx.mine ? 2 : 1);   // basics stay a short zip (ear fatigue); casts carry the element
  },

  a_astral_nova: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), R = 3, rpx = ctx.rx(R);
    const up = upgradeScale(ctx, e.slot, ['a_rift_focus', 'a_astral_echo'], 1.75);
    castFlash(ctx, e.x, e.y, RIFT, 2.4, { glyph: true });
    oneShot(ctx, 'fx:arcanist:nova', p.x, p.y - 18, { scale: 1.5 * up, depth: 4657, ms: 300 });
    J.shockwave(p.x, p.y, rpx, RIFT.main, 380);
    J.shockwave(p.x, p.y, rpx * 0.96, 0xffffff, 300, 50);
    J.shockwave(p.x, p.y, rpx * 1.12, A_DEEP, 480, 110);
    J.glyph(p.x, p.y, rpx, A_LILAC, 760);
    J.beam(p.x, p.y, 150, 22, RIFT.main, 340);
    J.beam(p.x, p.y, 150, 8, 0xffffff, 240);
    J.bits('star', p.x, p.y - 14, Math.round(14 * up), A_LILAC);
    J.bits('rune', p.x, p.y - 10, 6, RIFT.main);
    J.embersAt(p.x, p.y - 8, 18, A_LILAC);
    starRays(ctx, e.x, e.y, R, Math.round(8 * up), A_LILAC, 0xffffff);
    ctx.dungeon.flashLight(p.x, p.y - 12, 300, 0xb07aff, 2.8, 360);
    J.pop(0xb07aff, 0.14, 200);
    if (ctx.mine) J.hitStop(60);
    skillSfx(ctx, e.skill, 'signature_nova', e.x, e.y, 0, ctx.mine ? 3 : 2);
  },

  a_fireline: (ctx, e) => {
    const J = ctx.juice;
    const h = hand(ctx, e.x, e.y, e.dx, e.dy);
    castFlash(ctx, e.x, e.y, EMBER, 1.2, { dx: e.dx, dy: e.dy });
    J.bits('mote', h.x, h.y, 6, E_GOLD, { angle: deg(h.ux, h.uy), spread: 30, speed: 1.8 });
    J.embersAt(h.x, h.y, 6, EMBER.main);
    J.slash(h.x, h.y, Math.atan2(h.uy, h.ux), EMBER.main, 0.6, { thin: true, ms: 160 });
    skillSfx(ctx, e.skill, 'cast_fire', e.x, e.y, 60, ctx.mine ? 2 : 1);
    skillLayer(ctx, e.skill, 'skill_fireline', e.x, e.y, 60, 1);
  },

  a_arc_bolt: (ctx, e) => {
    const J = ctx.juice;
    const h = hand(ctx, e.x, e.y, e.dx - e.x, e.dy - e.y, 10);
    const b = chestAt(ctx, e.dx, e.dy);
    const fork = ctx.rank(e.slot, 'a_fork') > 0;
    const att = ctx.rank(e.slot, 'a_attunement') > 0;
    J.orb(h.x, h.y, STORM.main, 0.45, 150, 1.6);
    zap(ctx, h.x, h.y, b.x, b.y, STORM.main, S_VIOLET, { ms: 210, w: 3, forks: fork ? 3 : 2 });
    if (fork) {
      // Fork: a visible extra endpoint splitting off the far end
      const a = Math.random() * 6.28, L = 26 + Math.random() * 16;
      zap(ctx, b.x, b.y, b.x + Math.cos(a) * L, b.y + Math.sin(a) * L * 0.6, S_CYAN, S_VIOLET, { ms: 190, w: 2.2, forks: 0, delay: 30 });
      J.starburst(b.x + Math.cos(a) * L, b.y + Math.sin(a) * L * 0.6, 0xffffff, 0.7, 130);
    }
    hitSpark(ctx, e.dx, e.dy, STORM, att ? 3 : 2);
    J.bits('zap', h.x, h.y, 3, S_CYAN, { angle: deg(h.ux, h.uy), spread: 60 });
    stormCastFx(ctx, e.slot, e.x, e.y);
    skillSfx(ctx, e.skill, 'skill_arc', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },

  a_phase_step: (ctx, e) => {
    castFlash(ctx, e.x, e.y, RIFT, 1.2, { glyph: true });
    riftFile(ctx, e.slot, e.skill);
    skillSfx(ctx, e.skill, 'blink', e.x, e.y, 120, ctx.mine ? 2 : 1);
  },

  /** Every rift teleport (Phase Step, Blink Strike, Rift Gate, gate walk-throughs): x,y arrival, dx,dy origin. */
  'teleport:rift': (ctx, e) => {
    const J = ctx.juice;
    const f = ctx.P(e.dx, e.dy), t = ctx.P(e.x, e.y);
    const fy = f.y - 14, ty = t.y - 14;
    implode(ctx, f.x, f.y, 30, RIFT.main);
    J.orb(f.x, fy, A_DEEP, 0.7, 220, 0.6);
    J.ring(f.x, f.y, 24, A_DEEP, 220);
    // the tear between the two points: a jagged violet seam with a white core that closes
    const seed = (Math.random() * 1e9) | 0;
    const L = Math.hypot(t.x - f.x, ty - fy);
    const segs = Math.max(3, Math.min(10, Math.round(L / 16)));
    tr(ctx, 280, (g, k) => {
      const w = 1 - k;
      boltPath(g, f.x, fy, t.x, ty, seed, segs, 7, 6 * w + 1, A_DEEP, 0.5 * w);
      boltPath(g, f.x, fy, t.x, ty, seed, segs, 7, 3 * w + 0.5, RIFT.main, 0.9 * w);
      boltPath(g, f.x, fy, t.x, ty, seed, segs, 7, 1, 0xffffff, w);
    });
    J.bitsAlong('star', f.x, fy, t.x, ty, 6, A_LILAC);
    J.orb(t.x, ty, RIFT.main, 0.75, 240, 1.8);
    J.starburst(t.x, ty - 2, 0xffffff, 1, 160);
    J.shockwave(t.x, t.y, 34, RIFT.main, 300);
    J.embersAt(t.x, ty, 10, A_LILAC);
    ctx.dungeon.flashLight(t.x, ty, 150, 0xb07aff, 2, 220);
    // gate walk-throughs. A rift cast's teleport comes just before its cast event in the same batch, so the blink waits a
    // frame and is dropped when that cast played its own recorded file (a shared-cue cast blink dedupes it by throttle).
    const t0 = ctx.now, slot = e.slot, prio = ctx.mine ? 2 : 1;
    ctx.scene.time.delayedCall(0, () => { if ((riftFileAt.get(slot) ?? -1e9) < t0) sfx(ctx, 'blink', e.x, e.y, 120, prio); });
    if (ctx.rank(e.slot, 'a_riftwalker') > 0) {
      // Riftwalker: a hexagon of astral shards flashing open as the ring fires
      const rx = ctx.rx(1.1), ry = ctx.ry(1.1), rot = Math.random() * 6.28;
      tr(ctx, 300, (g, k) => {
        const e2 = 0.4 + 0.6 * (1 - (1 - k) ** 2), a = 1 - k;
        g.lineStyle(2, A_LILAC, 0.8 * a).beginPath();
        for (let i = 0; i <= 6; i++) {
          const an = rot + (i / 6) * Math.PI * 2;
          const x = t.x + Math.cos(an) * rx * e2, y = t.y + Math.sin(an) * ry * e2;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
          g.fillStyle(0xffffff, a).fillRect(x - 1, y - 1, 3, 3);
        }
        g.strokePath();
      }, { ground: true });
      J.bits('star', t.x, ty, 6, 0xffffff);
    }
    if (ctx.cls(e.slot) === 'arcanist' && ctx.rank(e.slot, 'a_return_mark') > 0 && ctx.rank(e.slot, 'a_blink_strike') <= 0 && ctx.rank(e.slot, 'a_rift_gate') <= 0) {
      J.glyph(f.x, f.y, 20, RIFT.main, 3800);   // Return Mark: the fading return point
    }
  },

  // ---------------- ember evolutions ----------------
  a_meteor: (ctx, e) => {
    const J = ctx.juice;
    const h = hand(ctx, e.x, e.y, e.dx - e.x, e.dy - e.y);
    const t = ctx.P(e.dx, e.dy);
    castFlash(ctx, e.x, e.y, EMBER, 1.8, { glyph: true });
    J.beam(h.x, h.y, 110, 9, E_GOLD, 260);
    J.glyph(t.x, t.y, ctx.rx(2.4), EMBER.main, 900);
    J.embersAt(h.x, h.y, 10, EMBER.main);
    ctx.dungeon.flashLight(h.x, h.y, 120, EMBER.main, 1.4, 200);
    skillSfx(ctx, e.skill, 'cast_fire', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  a_meteor_impact: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), R = e.dx || 2.4, rpx = ctx.rx(R);
    impactBurst(ctx, e.x, e.y, R, EMBER, 3, { decal: 'scorch', decalTint: 0x140804, dust: 16 });
    J.shockwave(p.x, p.y, rpx * 1.45, E_GOLD, 540, 90);
    J.orb(p.x, p.y - 8, 0xffffff, 1.4, 200, 2);
    J.beam(p.x, p.y, 130, 34, EMBER.main, 300);
    J.beam(p.x, p.y, 130, 12, 0xfff0c8, 220);
    flameRing(ctx, e.x, e.y, R * 0.72, 10, 1.25);
    J.bits('mote', p.x, p.y - 10, 16, E_GOLD);
    J.embersAt(p.x, p.y - 10, 30, EMBER.main);
    J.sparksAt(p.x, p.y - 8, 18, E_GOLD);
    skillLayer(ctx, 'a_meteor', 'blast_fire', e.x, e.y, 80, 3);
    skillLayer(ctx, 'a_meteor', 'slam_heavy', e.x, e.y, 80, 1);
  },
  a_flame_wall: (ctx, e) => {
    const J = ctx.juice;
    const h = hand(ctx, e.x, e.y, e.dx - e.x, e.dy - e.y);
    const t = ctx.P(e.dx, e.dy);
    castFlash(ctx, e.x, e.y, EMBER, 1.4, { dx: e.dx - e.x, dy: e.dy - e.y });
    lob(ctx, h.x, h.y, t.x, t.y - 4, EMBER.main, 0xfff0c8, 34, 170);
    J.shockwave(t.x, t.y, ctx.rx(1.6), E_GOLD, 300, 170);
    J.embersAt(t.x, t.y - 6, 14, EMBER.main);
    skillSfx(ctx, e.skill, 'cast_fire', e.x, e.y, 60, ctx.mine ? 2 : 1);
    skillLayer(ctx, e.skill, 'skill_fireline', e.dx, e.dy, 60, 1);
  },
  a_combustion: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), R = e.dx || 2;
    impactBurst(ctx, e.x, e.y, R, EMBER, 1, { decal: 'scorch', decalTint: 0x1a0804 });
    oneShot(ctx, 'fx:arcanist:flame', p.x, p.y + 2, { scale: 1.5, originY: 0.95, depth: isoDepth(e.x, e.y) + 3, ms: 380, grow: 1.2 });
    J.embersAt(p.x, p.y - 10, 12, E_GOLD);
    sfx(ctx, 'blast_fire', e.x, e.y, 90, 1);
  },
  a_pyroclasm: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), R = e.dx || 3, rpx = ctx.rx(R);
    castFlash(ctx, e.x, e.y, EMBER, 2.4, { glyph: true });
    impactBurst(ctx, e.x, e.y, R, EMBER, 3, { decal: 'scorch', decalTint: 0x1a0804, dust: 12 });
    J.shockwave(p.x, p.y, rpx * 0.7, E_GOLD, 300, 40);
    J.shockwave(p.x, p.y, rpx * 1.25, E_RED, 520, 120);
    oneShot(ctx, 'fx:arcanist:nova', p.x, p.y - 18, { scale: 1.6, depth: 4657, ms: 300, tint: 0xffb060 });
    flameRing(ctx, e.x, e.y, R * 0.92, 12, 1.3, 14);
    flameRing(ctx, e.x, e.y, R * 0.45, 6, 0.95, 20);
    J.beam(p.x, p.y, 170, 26, EMBER.main, 360);
    J.beam(p.x, p.y, 170, 10, E_GOLD, 260);
    // the eight Sparks fanning out: short white-hot flares along their headings
    tr(ctx, 220, (g, k) => {
      const a = 1 - k, r0 = 0.5 + 1.6 * k;
      for (let i = 0; i < 8; i++) {
        const c = Math.cos((i * Math.PI) / 4), s = Math.sin((i * Math.PI) / 4);
        const q0 = ctx.P(e.x + c * (r0 - 0.6), e.y + s * (r0 - 0.6)), q1 = ctx.P(e.x + c * r0, e.y + s * r0);
        g.lineStyle(3, E_GOLD, 0.8 * a).lineBetween(q0.x, q0.y - 14, q1.x, q1.y - 14);
        g.fillStyle(0xffffff, a).fillRect(q1.x - 1, q1.y - 15, 3, 3);
      }
    });
    J.embersAt(p.x, p.y - 10, 36, EMBER.main);
    J.bits('mote', p.x, p.y - 12, 14, E_GOLD);
    if (ctx.mine) J.hitStop(70);
    sfx(ctx, 'blast_fire', e.x, e.y, 80, 3);
    sfx(ctx, 'cast_fire', e.x, e.y, 80, 1);
  },

  // ---------------- storm evolutions ----------------
  a_overload: (ctx, e) => {
    const J = ctx.juice;
    const h = hand(ctx, e.x, e.y, e.dx - e.x, e.dy - e.y, 10);
    castFlash(ctx, e.x, e.y, STORM, 1.6, { dx: e.dx - e.x, dy: e.dy - e.y });
    J.bits('zap', h.x, h.y, 6, S_CYAN);
    hitSpark(ctx, e.dx, e.dy, STORM, 2);
    stormCastFx(ctx, e.slot, e.x, e.y);
    skillSfx(ctx, e.skill, 'skill_arc', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  a_chain_link: (ctx, e) => {
    const a = chestAt(ctx, e.x, e.y), b = chestAt(ctx, e.dx, e.dy);
    zap(ctx, a.x, a.y, b.x, b.y, STORM.main, S_VIOLET, { ms: 180, w: 2.6, forks: 1 });
    ctx.juice.starburst(b.x, b.y, 0xffffff, 0.75, 120);
    ctx.juice.sparksAt(b.x, b.y, 4, S_CYAN);
    ctx.dungeon.flashLight(b.x, b.y, 90, STORM.main, 1.6, 110);
  },
  a_overload_burst: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), R = e.dx || 2.5;
    skyZap(ctx, e.x, e.y, STORM.main, S_VIOLET, 230, 5, 3);
    impactBurst(ctx, e.x, e.y, R, STORM, 2);
    J.shockwave(p.x, p.y, ctx.rx(R) * 0.6, 0xffffff, 220);
    J.bits('zap', p.x, p.y - 12, 10, S_CYAN);
    starRays(ctx, e.x, e.y, R, 6, S_CYAN, 0xffffff, 260);
    if (ctx.mine) J.hitStop(40);
    skillLayer(ctx, 'a_overload', 'zap_strike', e.x, e.y, 60, 2);   // Overload's chain-end burst
  },
  a_ball_lightning: (ctx, e) => {
    const h = hand(ctx, e.x, e.y, e.dx, e.dy, 12);
    castFlash(ctx, e.x, e.y, STORM, 1.3, { dx: e.dx, dy: e.dy });
    ctx.juice.bits('zap', h.x, h.y, 6, S_CYAN, { angle: deg(h.ux, h.uy), spread: 70 });
    stormCastFx(ctx, e.slot, e.x, e.y);
    skillSfx(ctx, e.skill, 'cast_storm', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  a_ball_zap: (ctx, e) => {
    ctx.bolt(e.x, e.y, e.dx, e.dy, S_VIOLET);
    const c = chestAt(ctx, e.dx, e.dy);
    ctx.juice.sparksAt(c.x, c.y, 3, S_CYAN);
    sfx(ctx, 'skill_arc', e.dx, e.dy, 160, 0);
  },
  a_thunderstrike: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), R = e.dx || 1.5;
    skyZap(ctx, e.x, e.y, STORM.main, S_VIOLET, 200, 4, 2);
    J.shockwave(p.x, p.y, ctx.rx(R), STORM.main, 300);
    J.starburst(p.x, p.y - 8, 0xffffff, 1.3);
    J.bits('zap', p.x, p.y - 8, 6, S_CYAN);
    sfx(ctx, 'zap_strike', e.x, e.y, 80, 1);
  },
  a_stormcaller: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), R = e.dx || 1.2;
    skyZap(ctx, e.x, e.y, 0xc8b0ff, S_VIOLET, 240, 3.5, 2);
    J.shockwave(p.x, p.y, ctx.rx(R), S_VIOLET, 280);
    J.bits('zap', p.x, p.y - 6, 4, 0xc8b0ff);
    sfx(ctx, 'zap_strike', e.x, e.y, 120, 1);
  },
  a_attune: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const ember = e.dx === 1;
    const col = ember ? EMBER.main : STORM.main, hot = ember ? E_GOLD : S_CYAN;
    J.ring(p.x, p.y, 26, col, 280);
    J.orb(p.x, p.y - 16, col, 0.6, 240, 1.6);
    J.bits(ember ? 'mote' : 'zap', p.x, p.y - 16, 6, hot);
    // six motes orbiting the caster and rising
    tr(ctx, 520, (g, k) => {
      const a = 1 - k;
      for (let i = 0; i < 6; i++) {
        const an = k * 7 + (i / 6) * Math.PI * 2;
        const x = p.x + Math.cos(an) * 18, y = p.y - 10 - k * 16 + Math.sin(an) * 8;
        g.fillStyle(i % 2 ? hot : 0xffffff, a).fillRect(x - 1, y - 1, 3, 3);
      }
    });
    if (ctx.mine) J.number(p.x, p.y - 36, ember ? 'EMBER ATTUNED' : 'STORM ATTUNED', ember ? '#ff9a3a' : '#9fd8ff', 'sm');
  },

  // ---------------- rift evolutions ----------------
  a_blink_strike: (ctx, e) => {
    const J = ctx.juice;
    impactBurst(ctx, e.dx, e.dy, 2, RIFT, 1);
    impactBurst(ctx, e.x, e.y, 2, RIFT, 2);
    const t = ctx.P(e.x, e.y);
    oneShot(ctx, 'fx:arcanist:nova', t.x, t.y - 16, { scale: 1.05, depth: 4657, ms: 260 });
    J.bits('star', t.x, t.y - 14, 8, A_LILAC);
    if (ctx.mine) J.hitStop(35);
    riftFile(ctx, e.slot, e.skill);
    skillSfx(ctx, e.skill, 'blink', e.x, e.y, 120, ctx.mine ? 2 : 1);
    skillLayer(ctx, e.skill, 'impact_astral', e.x, e.y, 60, 1);
  },
  a_rift_gate: (ctx, e) => {
    const J = ctx.juice;
    for (let k = 0; k < 2; k++) {
      const wx = k ? e.dx : e.x, wy = k ? e.dy : e.y;
      const p = ctx.P(wx, wy);
      J.beam(p.x, p.y, 80, 14, RIFT.main, 380);
      J.beam(p.x, p.y, 80, 5, 0xffffff, 260);
      J.glyph(p.x, p.y, ctx.rx(1.5), RIFT.main, 640);
      J.shockwave(p.x, p.y, ctx.rx(1.5), A_LILAC, 340);
      J.bits('star', p.x, p.y - 14, 8, A_LILAC);
      ctx.dungeon.flashLight(p.x, p.y - 14, 180, 0xb07aff, 2, 400);
    }
    riftFile(ctx, e.slot, e.skill);
    skillSfx(ctx, e.skill, 'cast_astral', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  a_echo_burst: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), R = e.dx || 2.2;
    impactBurst(ctx, e.x, e.y, R, RIFT, 2);
    oneShot(ctx, 'fx:arcanist:nova', p.x, p.y - 16, { scale: 1.2, depth: 4657, ms: 280 });
    J.bits('rune', p.x, p.y - 12, 4, A_LILAC);
    sfx(ctx, 'impact_astral', e.x, e.y, 120, 1);
    sfx(ctx, 'cast_astral', e.x, e.y, 120, 0);
  },
  a_singularity: (ctx, e) => {
    const J = ctx.juice;
    const h = hand(ctx, e.x, e.y, e.dx - e.x, e.dy - e.y);
    const t = ctx.P(e.dx, e.dy);
    castFlash(ctx, e.x, e.y, RIFT, 1.8, { dx: e.dx - e.x, dy: e.dy - e.y });
    lob(ctx, h.x, h.y, t.x, t.y - 10, RIFT.main, VOID, 40, 200);
    J.glyph(t.x, t.y, ctx.rx(3), RIFT.main, 1500);
    // motes converging on the well
    const rx = ctx.rx(4.2), ry = ctx.ry(4.2), rot = Math.random() * 6.28;
    tr(ctx, 600, (g, k) => {
      const r = (1 - k) ** 1.4, a = Math.min(1, k * 4) * (1 - k * 0.3);
      for (let i = 0; i < 14; i++) {
        const an = rot + (i / 14) * Math.PI * 2 + k * 2.2;
        g.fillStyle(i % 3 ? A_LILAC : 0xffffff, a).fillRect(t.x + Math.cos(an) * rx * r - 1, t.y - 8 + Math.sin(an) * ry * r - 1, 2, 2);
      }
    }, { delay: 160 });
    sfx(ctx, 'cast_astral', e.x, e.y, 60, ctx.mine ? 3 : 2);
    sfx(ctx, 'skill_phase', e.dx, e.dy, 80, 1);   // the well drawing in
  },
  a_singularity_collapse: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y), R = e.dx || 3, rpx = ctx.rx(R);
    J.orb(p.x, p.y - 10, 0xffffff, 1.6, 260, 2.2);
    oneShot(ctx, 'fx:arcanist:nova', p.x, p.y - 16, { scale: 2.3, depth: 4657, ms: 360 });
    impactBurst(ctx, e.x, e.y, R, RIFT, 3, { decal: 'scorch', decalTint: 0x1a0a30 });
    J.shockwave(p.x, p.y, rpx * 0.55, 0xffffff, 240);
    J.shockwave(p.x, p.y, rpx * 1.4, A_LILAC, 560, 140);
    J.beam(p.x, p.y, 220, 30, RIFT.main, 420);
    J.beam(p.x, p.y, 220, 10, 0xffffff, 300);
    J.bits('star', p.x, p.y - 14, 22, A_LILAC);
    J.bits('rune', p.x, p.y - 10, 10, RIFT.main);
    starRays(ctx, e.x, e.y, R * 1.3, 14, A_LILAC, 0xffffff, 420);
    J.pop(0xd7a8ff, 0.22, 240);
    if (ctx.mine) { J.hitStop(90); J.dilate(0.6, 280); }
    // Singularity collapse: the recorded implosion + blast replaces both shared cues
    fileSfx(ctx, 'skill_arcanist_singularity', 'signature_nova', e.x, e.y, 80, 3);
    if (!ctx.hasFile('skill_arcanist_singularity')) sfx(ctx, 'impact_astral', e.x, e.y, 80, 2);
  },
});

registerProjectileFx({
  spark: {
    key: 'fx:arcanist:spark', color: 0xff8a2a, trail: 'ember', trailMs: 28,
    end: (ctx, sx, sy) => { ctx.juice.embersAt(sx, sy, 2, E_GOLD); },
  },
  a_shard: {
    key: 'fx:arcanist:shard', color: A_LILAC, trail: 'star', trailMs: 40,
    end: (ctx, sx, sy) => { ctx.juice.starburst(sx, sy, A_LILAC, 0.55, 120); },
  },
});

// ---------------------------------------------------------------- hazards

/** Burning line (base Fireline and Flame Wall): scorched band, molten core, pixel flame tongues, an ignition front. */
function flameLine(ctx: FxCtx, g: G, h: SnapHazard, tick: number, wall: boolean) {
  const a = fade(h, tick);
  const front = clamp01((tick - h.b) / (wall ? 8 : 11));
  const nx = -h.dy * (h.w / 2), ny = h.dx * (h.w / 2);
  const x1 = h.x + h.dx * h.len, y1 = h.y + h.dy * h.len;
  const q0 = ctx.P(h.x + nx, h.y + ny), q1 = ctx.P(x1 + nx, y1 + ny), q2 = ctx.P(x1 - nx, y1 - ny), q3 = ctx.P(h.x - nx, h.y - ny);
  // footprint: charred band with hot edges (the true width stays readable)
  g.fillStyle(E_CHAR, 0.42 * a).beginPath().moveTo(q0.x, q0.y).lineTo(q1.x, q1.y).lineTo(q2.x, q2.y).lineTo(q3.x, q3.y).closePath().fillPath();
  const flick = 0.75 + 0.25 * Math.sin(ctx.now / 70 + h.i);
  g.lineStyle(2, EMBER.main, 0.75 * a * flick).lineBetween(q0.x, q0.y, q1.x, q1.y).lineBetween(q3.x, q3.y, q2.x, q2.y);
  const s0 = ctx.P(h.x, h.y), s1 = ctx.P(h.x + h.dx * h.len * front, h.y + h.dy * h.len * front);
  g.lineStyle(wall ? 4 : 3, E_GOLD, 0.55 * a * flick).lineBetween(s0.x, s0.y, s1.x, s1.y);
  g.lineStyle(1, 0xfff0c8, 0.8 * a).lineBetween(s0.x, s0.y, s1.x, s1.y);
  // flame tongues, ignited progressively along the line
  const rows = wall ? 2 : 1;
  const n = Math.max(2, Math.round(h.len / (wall ? 0.42 : 0.55)));
  const grow = wall ? Math.min(1, (tick - h.b) / 10) : 1;
  for (let r = 0; r < rows; r++) {
    const side = rows === 1 ? 0 : r ? 0.22 : -0.22;
    for (let i = 0; i < n; i++) {
      const id = h.i * 100 + r * 48 + i;
      const t = (i + 0.5 + (r ? 0.5 : 0)) / (n + (r ? 0.5 : 0));
      const s = keepSprite(ctx, id, 'fx:arcanist:flame');
      if (!s) continue;
      if (t > front + 0.02) { s.setVisible(false); continue; }
      const j = (hr(id, 3) - 0.5) * 0.25;
      const wx = h.x + h.dx * h.len * t - h.dy * (side + j) * h.w, wy = h.y + h.dy * h.len * t + h.dx * (side + j) * h.w;
      const p = ctx.P(wx, wy);
      const base = (wall ? 1.15 : 0.85) * (0.8 + 0.4 * hr(id, 5));
      const lick = 0.9 + 0.18 * Math.sin(ctx.now / 85 + i * 1.9 + r);
      const fresh = Math.min(1, (front - t) * 6 + 0.3);
      s.setVisible(true).setPosition(Math.round(p.x), Math.round(p.y + 2)).setOrigin(0.5, 0.95)
        .setScale(base, base * lick * grow * fresh).setAlpha(a).setDepth(isoDepth(wx, wy) + 1);
    }
  }
  // the racing ignition head
  if (front < 1) {
    g.fillStyle(E_GOLD, 0.6 * a).fillCircle(s1.x, s1.y - 4, 7);
    g.fillStyle(0xffffff, a).fillCircle(s1.x, s1.y - 4, 3);
    if (!ctx.reduced && Math.random() < 0.6) ctx.juice.embersAt(s1.x, s1.y - 6, 1, E_GOLD);
  }
  if (!ctx.reduced && Math.random() < (wall ? 0.5 : 0.35)) {
    const t = Math.random() * front;
    const q = ctx.P(h.x + h.dx * h.len * t, h.y + h.dy * h.len * t);
    ctx.juice.embersAt(q.x, q.y - (wall ? 18 : 12), 1, Math.random() < 0.5 ? EMBER.main : E_GOLD);
  }
}

/** Dark spiral well (Event Horizon and the Singularity body): rim, inward arms and motes spiralling in. */
function well(ctx: FxCtx, g: G, h: SnapHazard, a: number, spin: number, arms: number, motes: number, intensity: number) {
  const p = ctx.P(h.x, h.y);
  const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
  g.fillStyle(VOID, (0.28 + 0.18 * intensity) * a).fillEllipse(p.x, p.y, rx * 2, ry * 2, 40);
  g.fillStyle(A_DEEP, 0.18 * a).fillEllipse(p.x, p.y, rx * 1.2, ry * 1.2, 32);
  for (let k = 0; k < arms; k++) {
    g.lineStyle(2, k % 2 ? A_LILAC : RIFT.main, 0.6 * a).beginPath();
    for (let s = 0; s <= 9; s++) {
      const rho = 1 - s / 10;
      const an = spin + (k / arms) * Math.PI * 2 + (1 - rho) * 2.6;
      const x = p.x + Math.cos(an) * rx * rho, y = p.y + Math.sin(an) * ry * rho;
      if (s === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokePath();
  }
  for (let i = 0; i < motes; i++) {
    const ph = (i / motes + ctx.now / 1100) % 1;
    const an = hr(h.i, i) * 6.283 + ph * 2.4 + spin * 0.5;
    const r = 1 - ph;
    g.fillStyle(i % 3 ? A_LILAC : 0xffffff, a * Math.min(1, ph * 3)).fillRect(p.x + Math.cos(an) * rx * r - 1, p.y + Math.sin(an) * ry * r - 1, 2, 2);
  }
}

registerHazardFx({
  // ---- base hazards ----
  fireline: (ctx, g, h, tick) => flameLine(ctx, g, h, tick, false),
  tempest: (ctx, g, h, tick) => {
    // Tempest Field has no cast event: its file plays where the field first appears (silent until the file lands; the storm cast already sounds)
    if (firstSight(ctx, h, tick)) fileSfx(ctx, 'skill_arcanist_tempest_field', null, h.x, h.y, 200, 1);
    const a = fade(h, tick);
    const p = ctx.P(h.x, h.y);
    const spin = ctx.now / 500;
    ellipse(ctx, g, h.x, h.y, h.r, S_INDIGO, 0.3 * a, S_VIOLET, 2, 0.85 * a);
    ellipse(ctx, g, h.x, h.y, h.r * 0.72, S_VIOLET, 0.1 * a);
    ticks(ctx, g, h.x, h.y, h.r * 0.95, 10, spin, 0.82, S_CYAN, 0.55 * a);
    ticks(ctx, g, h.x, h.y, h.r * 0.55, 6, -spin * 1.6, 0.7, S_VIOLET, 0.5 * a);
    // crackling arcs inside the field, re-struck every 70ms
    const seed = h.i * 31 + ((ctx.now / 70) | 0);
    for (let k = 0; k < 3; k++) {
      const a0 = hr(seed, k) * 6.283, a1 = a0 + 1 + hr(seed, k + 9) * 2;
      const r0 = 0.85 + hr(seed, k + 3) * 0.15, r1 = hr(seed, k + 5) * 0.6;
      const b0 = ctx.P(h.x + Math.cos(a0) * h.r * r0, h.y + Math.sin(a0) * h.r * r0);
      const b1 = ctx.P(h.x + Math.cos(a1) * h.r * r1, h.y + Math.sin(a1) * h.r * r1);
      boltPath(g, b0.x, b0.y - 2, b1.x, b1.y - 2, seed + k, 5, 6, 3, S_VIOLET, 0.45 * a);
      boltPath(g, b0.x, b0.y - 2, b1.x, b1.y - 2, seed + k, 5, 6, 1, 0xffffff, 0.9 * a);
    }
    if (!ctx.reduced && Math.random() < 0.08) ctx.juice.bits('zap', p.x + (Math.random() - 0.5) * ctx.rx(h.r), p.y - 6 - Math.random() * 20, 2, S_CYAN);
  },
  horizon: (ctx, g, h, tick) => {
    // Event Horizon field has no cast event: its file plays where the well first opens (silent until the file lands; the rift blink already sounds)
    if (firstSight(ctx, h, tick)) fileSfx(ctx, 'skill_arcanist_event_horizon', null, h.x, h.y, 200, 1);
    const a = fade(h, tick);
    well(ctx, g, h, a, ctx.now / 380, 4, 12, 0.4);
    ellipse(ctx, g, h.x, h.y, h.r, null, 0, A_LILAC, 2, 0.75 * a);
    ticks(ctx, g, h.x, h.y, h.r, 12, -ctx.now / 700, 0.9, RIFT.main, 0.6 * a);
    const p = ctx.P(h.x, h.y);
    g.fillStyle(0x000000, 0.8 * a).fillEllipse(p.x, p.y, 16, 8, 16);
    g.lineStyle(1, 0xffffff, 0.8 * a).strokeEllipse(p.x, p.y, 18, 9, 16);
  },

  // ---- ember ----
  a_meteor: (ctx, g, h, tick) => {
    const total = Math.max(1, h.u - 1 - h.b), f = clamp01((tick - h.b) / total);
    const blink = f > 0.72 && Math.floor(ctx.now / 70) % 2 === 0;
    const p = ctx.P(h.x, h.y);
    // telegraph at the true radius: fill, edge, rotating gold runes, a shadow that swells as it falls
    ellipse(ctx, g, h.x, h.y, h.r, EMBER.main, 0.08 + 0.14 * f, blink ? 0xffffff : EMBER.main, 2, 1);
    ellipse(ctx, g, h.x, h.y, h.r * f, E_RED, 0.22);
    ticks(ctx, g, h.x, h.y, h.r * 0.92, 8, ctx.now / 300, 0.78, E_GOLD, 0.7);
    g.fillStyle(0x000000, 0.25 + 0.3 * f).fillEllipse(p.x, p.y, ctx.rx(h.r) * (0.25 + 0.55 * f), ctx.ry(h.r) * (0.25 + 0.55 * f), 24);
    // the falling meteor (sprite) with a roaring trail in the air layer
    const alt = (1 - f) ** 1.2 * 300;
    const mx = p.x + alt * 0.45, my = p.y - 10 - alt;
    const s = keepSprite(ctx, h.i * 100, 'fx:arcanist:meteor');
    if (s) s.setPosition(Math.round(mx), Math.round(my)).setRotation(Math.atan2(1, -0.45)).setScale(1.5 + 0.35 * f).setDepth(4620).setBlendMode(Phaser.BlendModes.NORMAL);
    const A = air(ctx);
    const tx = 0.41, ty = -0.91;   // unit vector back up the trail
    A.lineStyle(14, E_RED, 0.22).lineBetween(mx, my, mx + tx * 80, my + ty * 80);
    A.lineStyle(7, EMBER.main, 0.5).lineBetween(mx, my, mx + tx * 56, my + ty * 56);
    A.lineStyle(3, E_GOLD, 0.8).lineBetween(mx, my, mx + tx * 30, my + ty * 30);
    if (!ctx.reduced && Math.random() < 0.6) ctx.juice.embersAt(mx + tx * 14, my + ty * 14, 1, Math.random() < 0.5 ? E_GOLD : EMBER.main);
  },
  a_crater: (ctx, g, h, tick) => {
    const a = fade(h, tick);
    const pulse = 0.65 + 0.35 * Math.sin(ctx.now / 160 + h.i);
    ellipse(ctx, g, h.x, h.y, h.r, 0x2a0a04, 0.5 * a, EMBER.main, 2, (0.55 + 0.35 * pulse) * a);
    ellipse(ctx, g, h.x, h.y, h.r * 0.62, E_RED, 0.18 * a * pulse);
    // glowing magma cracks (stable per crater)
    for (let k = 0; k < 7; k++) {
      let px = h.x, py = h.y;
      const a0 = (k / 7) * Math.PI * 2 + hr(h.i, k) * 0.7;
      g.lineStyle(2, k % 2 ? E_GOLD : EMBER.main, 0.75 * a * pulse).beginPath();
      const s0 = ctx.P(px, py); g.moveTo(s0.x, s0.y);
      for (let s = 1; s <= 4; s++) {
        const an = a0 + (hr(h.i * 7 + k, s) - 0.5) * 0.7;
        px = h.x + Math.cos(an) * h.r * (s / 4) * 0.95; py = h.y + Math.sin(an) * h.r * (s / 4) * 0.95;
        const q = ctx.P(px, py); g.lineTo(q.x, q.y);
      }
      g.strokePath();
    }
    // a few small flames licking inside
    for (let i = 0; i < 3; i++) {
      const id = h.i * 100 + i;
      const s = keepSprite(ctx, id, 'fx:arcanist:flame');
      if (!s) continue;
      const an = hr(id, 1) * 6.283, rr = 0.25 + hr(id, 2) * 0.5;
      const wx = h.x + Math.cos(an) * h.r * rr, wy = h.y + Math.sin(an) * h.r * rr;
      const q = ctx.P(wx, wy);
      s.setPosition(Math.round(q.x), Math.round(q.y + 2)).setOrigin(0.5, 0.95).setScale(0.6, 0.6 * (0.85 + 0.2 * Math.sin(ctx.now / 90 + i))).setAlpha(a).setDepth(isoDepth(wx, wy) + 1);
    }
    if (!ctx.reduced && Math.random() < 0.3) {
      const an = Math.random() * 6.283, r = Math.random() * h.r;
      const q = ctx.P(h.x + Math.cos(an) * r, h.y + Math.sin(an) * r);
      ctx.juice.embersAt(q.x, q.y - 4, 1, EMBER.main);
    }
  },
  a_flamewall: (ctx, g, h, tick) => flameLine(ctx, g, h, tick, true),
  a_combust: (ctx, g, h, tick) => {
    const f = clamp01((tick - h.b) / 12);
    const p = ctx.P(h.x, h.y);
    ellipse(ctx, g, h.x, h.y, h.r * f, EMBER.main, 0.2 + 0.25 * f, E_GOLD, 2, 0.9);
    g.fillStyle(E_GOLD, 0.7).fillCircle(p.x, p.y - 10, 3 + 6 * f);
    g.fillStyle(0xffffff, 0.9).fillCircle(p.x, p.y - 10, 1.5 + 3 * f);
  },

  // ---- storm ----
  a_ball: (ctx, g, h, tick) => {
    const a = fade(h, tick);
    const s = smoothed(ctx, h);
    const p = ctx.P(s.x, s.y);
    const cy = p.y - 18 + Math.sin(ctx.now / 120) * 2;
    // reach ring (3 units) and shadow on the ground
    ellipse(ctx, g, s.x, s.y, h.r, S_INDIGO, 0.08 * a, S_VIOLET, 1, 0.3 * a);
    ticks(ctx, g, s.x, s.y, h.r, 14, ctx.now / 260, 0.9, S_CYAN, 0.35 * a);
    g.fillStyle(0x000000, 0.3 * a).fillEllipse(p.x, p.y, 20, 9, 16);
    const spr = keepSprite(ctx, h.i * 100, 'fx:arcanist:ball');
    if (spr) spr.setPosition(Math.round(p.x), Math.round(cy)).setScale(1.15 + 0.1 * Math.sin(ctx.now / 70)).setAlpha(a).setDepth(isoDepth(s.x, s.y) + 8).setBlendMode(Phaser.BlendModes.ADD);
    // crackles licking at the ground around it
    const A = air(ctx);
    const seed = h.i * 17 + ((ctx.now / 55) | 0);
    for (let k = 0; k < 2; k++) {
      const an = hr(seed, k) * 6.283, rr = 0.5 + hr(seed, k + 4) * 1.1;
      const q = ctx.P(s.x + Math.cos(an) * rr, s.y + Math.sin(an) * rr);
      boltPath(A, p.x, cy, q.x, q.y, seed + k, 4, 5, 2.5, S_VIOLET, 0.5 * a);
      boltPath(A, p.x, cy, q.x, q.y, seed + k, 4, 5, 1, 0xffffff, 0.85 * a);
    }
    if (!ctx.reduced && Math.random() < 0.3) ctx.juice.bits('zap', p.x, cy, 1, S_CYAN);
  },

  // ---- rift ----
  a_gate: (ctx, g, h, tick) => {
    const left = h.u - tick;
    const a = left < 60 && Math.floor(tick / 5) % 2 ? 0.45 : 1;
    const grow = clamp01((tick - h.b) / 12);
    const p = ctx.P(h.x, h.y);
    // sear radius (1.5) with an inward-pulling pulse
    ellipse(ctx, g, h.x, h.y, h.r, VOID, 0.16 * a, A_LILAC, 1, 0.35 * a);
    const ph = 1 - ((ctx.now / 700 + h.i * 0.3) % 1);
    ellipse(ctx, g, h.x, h.y, h.r * ph, null, 0, RIFT.main, 1, 0.5 * a * (1 - ph));
    // the swirling mouth on the ground
    const s = keepSprite(ctx, h.i * 100, 'fx:arcanist:rift');
    if (s) { const sc = ((ctx.rx(0.95) * 2) / 48) * grow; s.setPosition(Math.round(p.x), Math.round(p.y)).setScale(sc).setAlpha(a).setDepth(-74); }
    // the standing tear: a violet doorway of void (drawn over the mouth sprite)
    const L = low(ctx);
    const tw = 9 * grow, th = 17 * grow, cy = p.y - th - 2;
    L.fillStyle(RIFT.main, 0.25 * a).fillEllipse(p.x, cy, tw * 2 + 8, th * 2 + 8, 24);
    L.fillStyle(VOID, 0.9 * a).fillEllipse(p.x, cy, tw * 2, th * 2, 24);
    L.lineStyle(2, A_LILAC, 0.95 * a).strokeEllipse(p.x, cy, tw * 2, th * 2, 24);
    const sp = ctx.now / 260 + h.i;
    L.lineStyle(1, 0xffffff, 0.8 * a).beginPath().arc(p.x, cy, tw * 0.6, sp, sp + 2).strokePath();
    L.lineStyle(1, RIFT.main, 0.9 * a).beginPath().arc(p.x, cy, tw * 0.4, -sp * 1.4, -sp * 1.4 + 2.4).strokePath();
    // a faint dotted link to the partner gate
    const q = ctx.P(h.x + h.dx * h.len, h.y + h.dy * h.len);
    g.fillStyle(A_LILAC, 0.22 * a);
    const dots = Math.min(24, Math.max(3, Math.round(h.len * 2)));
    const off = (ctx.now / 900) % 1;
    for (let i = 1; i < dots; i++) { const t = (i + off) / dots; g.fillRect(p.x + (q.x - p.x) * t - 1, p.y + (q.y - p.y) * t - 1, 2, 2); }
    if (!ctx.reduced && Math.random() < 0.25) ctx.juice.bits(Math.random() < 0.5 ? 'star' : 'mote', p.x + (Math.random() - 0.5) * tw * 2, cy + (Math.random() - 0.5) * th, 1, A_LILAC);
  },
  a_echo: (ctx, g, h, tick) => {
    const f = clamp01((tick - h.b) / 45);
    const blink = f > 0.7 && Math.floor(ctx.now / 70) % 2 === 0;
    const p = ctx.P(h.x, h.y);
    ellipse(ctx, g, h.x, h.y, h.r, A_DEEP, 0.08 + 0.12 * f, blink ? 0xffffff : RIFT.main, 2, 1);
    ellipse(ctx, g, h.x, h.y, h.r * f, RIFT.main, 0.18);
    ticks(ctx, g, h.x, h.y, h.r * 0.9, 8, -ctx.now / 260, 0.75, A_LILAC, 0.7);
    // the astral after-image of the caster, brightening before it detonates
    const al = 0.35 + 0.45 * f;
    g.fillStyle(RIFT.main, al * 0.35).fillEllipse(p.x, p.y - 16, 22, 38, 20);
    g.fillStyle(A_LILAC, al).fillEllipse(p.x, p.y - 13, 11, 22, 16);
    g.fillStyle(0xffffff, al).fillCircle(p.x, p.y - 28, 4);
  },
  a_singularity: (ctx, g, h, tick) => {
    const f = clamp01((tick - h.b) / Math.max(1, h.u - h.b));
    const near = f > 0.78;
    const blink = near && Math.floor(ctx.now / 60) % 2 === 0;
    well(ctx, g, h, 1, ctx.now / (240 - 120 * f), 5, 18, f);
    // the true radius, tightening rune ring, and a blinking edge before the collapse
    ellipse(ctx, g, h.x, h.y, h.r, null, 0, blink ? 0xffffff : A_LILAC, 2, 0.9);
    ticks(ctx, g, h.x, h.y, h.r * (1 - 0.15 * f), 12, ctx.now / 200, 0.86, RIFT.main, 0.75);
    const p = ctx.P(h.x, h.y);
    const s = keepSprite(ctx, h.i * 100, 'fx:arcanist:hole');
    if (s) s.setPosition(Math.round(p.x), Math.round(p.y - 12 + Math.sin(ctx.now / 90) * 1.5)).setScale(1.1 + 0.4 * f).setDepth(isoDepth(h.x, h.y) + 6);
    if (!ctx.reduced && Math.random() < 0.3) {
      const an = Math.random() * 6.283;
      ctx.juice.bits('mote', p.x + Math.cos(an) * ctx.rx(h.r), p.y + Math.sin(an) * ctx.ry(h.r) - 4, 1, A_LILAC);
    }
  },
}, {
  fireline: EMBER.main, tempest: S_VIOLET, horizon: RIFT.main,
  a_meteor: EMBER.main, a_crater: EMBER.main, a_flamewall: EMBER.main, a_combust: E_GOLD,
  a_ball: STORM.main, a_gate: RIFT.main, a_singularity: RIFT.main, a_echo: A_LILAC,
});

// ---------------------------------------------------------------- kill flourish

registerKillFx({
  arcanist: (ctx, k) => {
    const J = ctx.juice;
    const c = chestAt(ctx, k.x, k.y, 12);
    const big = k.big || k.elite > 0 || k.boss;
    let pal: Pal = RIFT, bit: BitKind = 'star';
    if (k.dtype === 'ember') {
      pal = EMBER; bit = 'mote';
      J.embersAt(c.x, c.y, big ? 10 : 4, EMBER.main);
      if (big || k.crit) { const p = ctx.P(k.x, k.y); oneShot(ctx, 'fx:arcanist:flame', p.x, p.y + 2, { scale: big ? 1.4 : 1, originY: 0.95, depth: isoDepth(k.x, k.y) + 3, ms: 360 }); }
    } else if (k.dtype === 'storm') {
      pal = STORM; bit = 'zap';
      zap(ctx, c.x + (Math.random() - 0.5) * 16, c.y - (big ? 90 : 56), c.x, c.y, STORM.main, S_VIOLET, { ms: 130, w: big ? 3 : 2, forks: big ? 2 : 0 });
    } else {
      J.starburst(c.x, c.y, A_LILAC, big ? 1.2 : 0.75, 160);
    }
    J.bits(bit, c.x, c.y, big ? 8 : 3, pal.main);
    if (big) {
      killPop(ctx, k.x, k.y, pal, true, k.elite);
      const p = ctx.P(k.x, k.y);
      J.glyph(p.x, p.y, 22 + k.elite * 6 + (k.boss ? 16 : 0), pal.main, 520);
    }
  },
});
