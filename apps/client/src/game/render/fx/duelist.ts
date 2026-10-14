import * as Phaser from 'phaser';
import type { SfxId } from '../../audio/AudioEngine';
import { registerHazardFx, registerProjectileFx, registerSkillFx, type CastFx, type FxCtx } from './registry';

// Duelist presentation (cosmetic only). Crimson and silver blades, violet shadow work.
// Sim conventions (simulation/src/classes/duelist.ts): blink events (d_shadowstep, d_execution, d_death_mark,
// d_fx_blink, d_fx_phantom) carry the departure in x,y and the arrival in dx,dy; d_fx_counter / d_fx_veins carry a
// target point in dx,dy; bursts (d_fx_cuts_burst, d_fx_mark_burst, d_fx_counter_sweep, d_fx_clone_burst) carry the
// radius in dx. Everything else uses dx,dy as the aim direction.

const CRIMSON = 0xff3a52;
const BLOOD = 0xb0142a;
const SILVER = 0xe8eef8;
const SHADOW = 0x8a5aff;
const DUSK = 0x3a1a4a;

const lastSfx = new Map<string, number>();
function sfx(ctx: FxCtx, id: SfxId, x: number, y: number, minGapMs: number, priority = 1) {
  const k = id;
  const t = lastSfx.get(k) ?? -1e9;
  if (ctx.now - t < minGapMs) return;
  lastSfx.set(k, ctx.now);
  ctx.sfx(id, x, y, priority);
}

/** chest-height screen point of a world point */
function chest(ctx: FxCtx, x: number, y: number) {
  const p = ctx.P(x, y);
  return { x: p.x, y: p.y - 14 };
}

/** A fading blade streak between two world points (additive, chest height). */
function streak(ctx: FxCtx, x0: number, y0: number, x1: number, y1: number, color: number, width: number, ms = 200) {
  if (ctx.reduced) return;
  const a = chest(ctx, x0, y0), b = chest(ctx, x1, y1);
  const g = ctx.scene.add.graphics().setDepth(4645).setBlendMode(Phaser.BlendModes.ADD);
  g.lineStyle(width, color, 0.9).lineBetween(a.x, a.y, b.x, b.y);
  g.lineStyle(Math.max(1, width / 3), 0xffffff, 1).lineBetween(a.x, a.y, b.x, b.y);
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
}

function slashSprite(ctx: FxCtx, x: number, y: number, ang: number, sx: number, sy: number, tint?: number) {
  const s = ctx.scene;
  if (ctx.reduced || !s.textures.exists('fx:slash') || !s.anims.exists('fx:slash')) return;
  const spr = s.add.sprite(x, y, 'fx:slash').setRotation(ang).setDepth(4660).setScale(sx, sy).setBlendMode(Phaser.BlendModes.ADD);
  if (tint !== undefined) spr.setTint(tint);
  spr.play('fx:slash');
  spr.once('animationcomplete', () => spr.destroy());
}

function aimAngle(ctx: FxCtx, e: CastFx) {
  const u = ctx.U(e.dx, e.dy);
  return { u, ang: Math.atan2(u.y, u.x) };
}

const fangSide = new Map<number, number>();

function blinkFx(ctx: FxCtx, e: CastFx, color: number, sound: SfxId | null) {
  const J = ctx.juice;
  streak(ctx, e.x, e.y, e.dx, e.dy, color, 4, 220);
  const from = ctx.P(e.x, e.y), to = chest(ctx, e.dx, e.dy);
  J.dust(from.x, from.y, 4, 0x2a1a30);
  J.ring(from.x, from.y, 18, SHADOW, 200);
  J.sparksAt(to.x, to.y, 6, color);
  const u = ctx.U(e.dx - e.x, e.dy - e.y);
  J.arc(to.x, to.y, Math.atan2(u.y, u.x), color, 1.1);
  if (sound) sfx(ctx, sound, e.dx, e.dy, 45, ctx.mine ? 2 : 1);
}

function burstFx(ctx: FxCtx, x: number, y: number, R: number, color: number, inner: number, strong: boolean) {
  const J = ctx.juice;
  const p = ctx.P(x, y);
  J.ring(p.x, p.y, ctx.rx(R), color, 320);
  J.ring(p.x, p.y, ctx.rx(R * 0.6), inner, 220);
  J.sparksAt(p.x, p.y - 12, strong ? 22 : 10, color);
  J.impact(p.x, p.y - 14, inner, strong ? 2.2 : 1.3);
  ctx.dungeon.flashLight(p.x, p.y - 10, Math.max(120, ctx.rx(R) * 2.2), color, strong ? 2.6 : 1.8, strong ? 320 : 200);
  if (strong) { J.shake(0.012, 220); if (ctx.mine) J.hitStop(80); }
}

registerSkillFx({
  d_twin_fangs: (ctx, e) => {
    const { u, ang } = aimAngle(ctx, e);
    const side = (fangSide.get(e.slot) ?? 0) ^ 1;
    fangSide.set(e.slot, side);
    const c = chest(ctx, e.x, e.y);
    ctx.juice.arc(c.x + u.x * 15, c.y + u.y * 15, ang + (side ? 0.35 : -0.35), side ? CRIMSON : SILVER, 0.85);
    sfx(ctx, 'swing', e.x, e.y, 55, ctx.mine ? 1 : 0);
  },
  d_fang_finisher: (ctx, e) => {
    const { u, ang } = aimAngle(ctx, e);
    const c = chest(ctx, e.x, e.y);
    ctx.juice.arc(c.x + u.x * 18, c.y + u.y * 18, ang - 0.3, CRIMSON, 1.5);
    ctx.juice.arc(c.x + u.x * 18, c.y + u.y * 18, ang + 0.3, SILVER, 1.4);
    slashSprite(ctx, c.x + u.x * 28, c.y + u.y * 28, ang, 0.85, 0.6, CRIMSON);
    ctx.juice.sparksAt(c.x + u.x * 26, c.y + u.y * 26, 8, SILVER);
    if (ctx.mine) ctx.juice.shake(0.003, 70);
    sfx(ctx, 'skill_sweep', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  d_rend: (ctx, e) => {
    const { u, ang } = aimAngle(ctx, e);
    const c = chest(ctx, e.x, e.y);
    ctx.juice.arc(c.x + u.x * 20, c.y + u.y * 20, ang + 0.55, CRIMSON, 1.6);
    ctx.juice.arc(c.x + u.x * 20, c.y + u.y * 20, ang - 0.55, CRIMSON, 1.6);
    slashSprite(ctx, c.x + u.x * 30, c.y + u.y * 30, ang + 0.5, 0.9, 0.7, BLOOD);
    slashSprite(ctx, c.x + u.x * 30, c.y + u.y * 30, ang - 0.5, 0.9, 0.7, CRIMSON);
    ctx.juice.bleed('player', c.x + u.x * 34, c.y + u.y * 34, 10, u.x, u.y);
    ctx.dungeon.flashLight(c.x, c.y, 110, CRIMSON, 1.4, 160);
    if (ctx.mine) ctx.juice.shake(0.004, 80);
    sfx(ctx, 'skill_sweep', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  d_crimson_whirl: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.dungeon.flashLight(p.x, p.y - 10, 180, CRIMSON, 2, 520);
    sfx(ctx, 'skill_sweep', e.x, e.y, 60, 2);
  },
  d_fx_whirl: (ctx, e) => {
    const c = chest(ctx, e.x, e.y);
    const spin = (ctx.now / 90) % (Math.PI * 2);
    for (let i = 0; i < 4; i++) {
      const a = spin + (i * Math.PI) / 2;
      ctx.juice.arc(c.x + Math.cos(a) * 26, c.y + Math.sin(a) * 13, a + Math.PI / 2, i % 2 ? SILVER : CRIMSON, 1.2);
    }
    ctx.juice.ring(c.x, c.y + 14, ctx.rx(2.4), CRIMSON, 240);
    ctx.juice.bleed('player', c.x, c.y, 6);
    sfx(ctx, 'swing', e.x, e.y, 50, ctx.mine ? 2 : 1);
  },
  d_execution: (ctx, e) => {
    streak(ctx, e.x, e.y, e.dx, e.dy, SILVER, 5, 260);
    const from = ctx.P(e.x, e.y);
    ctx.juice.dust(from.x, from.y, 6);
    sfx(ctx, 'skill_phase', e.dx, e.dy, 60, 2);
  },
  d_fx_execute_hit: (ctx, e) => {
    const c = chest(ctx, e.x, e.y);
    const u = ctx.U(e.dx, e.dy);
    slashSprite(ctx, c.x, c.y, Math.atan2(u.y, u.x), 1.1, 0.5, SILVER);
    ctx.juice.impact(c.x, c.y, 0xffffff, 2);
    ctx.juice.sparksAt(c.x, c.y, 16, CRIMSON);
    ctx.juice.bleed('player', c.x, c.y, 16, u.x, u.y);
    if (ctx.mine) { ctx.juice.hitStop(70); ctx.juice.shake(0.008, 140); }
    sfx(ctx, 'crit', e.x, e.y, 60, 2);
  },
  d_fx_execute: (ctx, e) => {
    const c = chest(ctx, e.x, e.y);
    ctx.juice.impact(c.x, c.y, CRIMSON, 2.4);
    ctx.juice.ring(c.x, c.y + 14, 30, BLOOD, 260);
    ctx.juice.bleed('player', c.x, c.y, 20);
    if (ctx.mine) ctx.juice.hitStop(50);
    sfx(ctx, 'kill', e.x, e.y, 80, 2);
  },
  d_fx_exsang: (ctx, e) => {
    const c = chest(ctx, e.x, e.y);
    ctx.juice.bleed('player', c.x, c.y, 22);
    ctx.juice.ring(c.x, c.y + 14, 26, BLOOD, 240);
    ctx.juice.impact(c.x, c.y, CRIMSON, 1.6);
    ctx.dungeon.flashLight(c.x, c.y, 90, BLOOD, 1.6, 200);
    sfx(ctx, 'crit', e.x, e.y, 70, 1);
  },
  d_fx_veins: (ctx, e) => {
    streak(ctx, e.x, e.y, e.dx, e.dy, BLOOD, 2, 300);
    const t = chest(ctx, e.dx, e.dy);
    ctx.juice.bleed('player', t.x, t.y, 8);
  },
  d_shadowstep: (ctx, e) => {
    blinkFx(ctx, e, CRIMSON, 'skill_phase');
    const to = ctx.P(e.dx, e.dy);
    ctx.juice.ring(to.x, to.y, 30, CRIMSON, 240);
    ctx.dungeon.flashLight(to.x, to.y - 10, 140, SHADOW, 1.8, 220);
  },
  d_phantom_rush: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, 34, SHADOW, 260);
    ctx.dungeon.flashLight(p.x, p.y - 10, 160, SHADOW, 2, 300);
    if (ctx.mine) ctx.juice.flash(0x2a0a3a, 60);
    sfx(ctx, 'skill_phase', e.x, e.y, 60, 2);
  },
  d_death_mark: (ctx, e) => {
    blinkFx(ctx, e, BLOOD, 'skill_phase');
    const to = ctx.P(e.dx, e.dy);
    ctx.dungeon.flashLight(to.x, to.y - 10, 150, CRIMSON, 2, 260);
  },
  d_fx_blink: (ctx, e) => blinkFx(ctx, e, CRIMSON, 'swing'),
  d_fx_phantom: (ctx, e) => {
    streak(ctx, e.x, e.y, e.dx, e.dy, SHADOW, 3, 200);
    const t = chest(ctx, e.dx, e.dy);
    ctx.juice.sparksAt(t.x, t.y, 5, SHADOW);
    sfx(ctx, 'swing', e.x, e.y, 60, 1);
  },
  d_fx_mark_burst: (ctx, e) => {
    burstFx(ctx, e.x, e.y, e.dx || 1.8, BLOOD, CRIMSON, true);
    if (ctx.mine) ctx.juice.flash(0x5a0a1a, 70);
    sfx(ctx, 'signature_nova', e.x, e.y, 80, 3);
  },
  d_riposte: (ctx, e) => stanceFx(ctx, e, 1),
  d_mirror_guard: (ctx, e) => stanceFx(ctx, e, 1.4),
  d_hundred_fangs: (ctx, e) => stanceFx(ctx, e, 0.9),
  d_fx_parry: (ctx, e) => {
    const a = chest(ctx, e.x, e.y), b = chest(ctx, e.dx, e.dy);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    ctx.juice.impact(mx, my, 0xffffff, 2.4);
    ctx.juice.sparksAt(mx, my, 22, 0xffe8a0);
    ctx.juice.ring(a.x, a.y + 14, 38, SILVER, 260);
    ctx.dungeon.flashLight(mx, my, 160, 0xffffff, 2.6, 200);
    if (ctx.mine) { ctx.juice.hitStop(90); ctx.juice.shake(0.008, 140); ctx.juice.flash(0xffffff, 50); }
    sfx(ctx, 'crit', e.x, e.y, 50, 3);
  },
  d_fx_counter: (ctx, e) => {
    streak(ctx, e.x, e.y, e.dx, e.dy, SILVER, 5, 220);
    const t = chest(ctx, e.dx, e.dy);
    ctx.juice.impact(t.x, t.y, SILVER, 1.8);
    ctx.juice.sparksAt(t.x, t.y, 10, SILVER);
  },
  d_fx_counter_sweep: (ctx, e) => {
    const c = chest(ctx, e.x, e.y);
    for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; ctx.juice.arc(c.x + Math.cos(a) * 24, c.y + Math.sin(a) * 12, a + Math.PI / 2, SILVER, 1.2); }
    burstFx(ctx, e.x, e.y, e.dx || 2.4, SILVER, 0xffffff, false);
    if (ctx.mine) ctx.juice.shake(0.008, 140);
  },
  d_fx_thrust: (ctx, e) => {
    streak(ctx, e.x, e.y, e.x + e.dx * 2.4, e.y + e.dy * 2.4, SILVER, 4, 200);
    sfx(ctx, 'swing', e.x, e.y, 60, 1);
  },
  d_fx_fang_slash: (ctx, e) => {
    const { u, ang } = aimAngle(ctx, e);
    const c = chest(ctx, e.x, e.y);
    const off = (Math.random() - 0.5) * 1.2;
    const r = 14 + Math.random() * 18;
    ctx.juice.arc(c.x + u.x * r, c.y + u.y * r, ang + off, Math.random() < 0.5 ? CRIMSON : SILVER, 0.9 + Math.random() * 0.5);
    ctx.juice.sparksAt(c.x + u.x * (r + 8), c.y + u.y * (r + 8), 3, SILVER);
    sfx(ctx, 'swing', e.x, e.y, 45, ctx.mine ? 2 : 1);
  },
  d_thousand_cuts: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(5), CRIMSON, 380);
    ctx.juice.embersAt(p.x, p.y - 14, 18, CRIMSON);
    ctx.dungeon.flashLight(p.x, p.y - 10, 260, CRIMSON, 2.4, 700);
    if (ctx.mine) ctx.juice.flash(0x3a0410, 80);
    sfx(ctx, 'skill_phase', e.x, e.y, 60, 3);
  },
  d_fx_cuts_burst: (ctx, e) => {
    burstFx(ctx, e.x, e.y, e.dx || 2.4, CRIMSON, SILVER, true);
    const p = ctx.P(e.x, e.y);
    ctx.juice.dust(p.x, p.y, 10, 0x4a1a20);
    ctx.juice.bleed('player', p.x, p.y - 14, 18);
    sfx(ctx, 'signature_slam', e.x, e.y, 80, 3);
  },
  d_clone_slash: (ctx, e) => {
    const { u, ang } = aimAngle(ctx, e);
    const c = chest(ctx, e.x, e.y);
    ctx.juice.arc(c.x + u.x * 15, c.y + u.y * 15, ang, SHADOW, 0.85);
  },
  d_fx_clone_burst: (ctx, e) => {
    burstFx(ctx, e.x, e.y, e.dx || 1.8, SHADOW, 0xd8c8ff, false);
    sfx(ctx, 'hit_enemy', e.x, e.y, 60, 1);
  },
});

/** Teleport payload: the raw sim event (fx,fy -> x,y) or the cast convention (x,y -> dx,dy). */
function tpPoints(e: CastFx) {
  const t = e as unknown as { fx?: number; fy?: number; x: number; y: number; dx?: number; dy?: number };
  return typeof t.fx === 'number' && typeof t.fy === 'number'
    ? { x0: t.fx, y0: t.fy, x1: t.x, y1: t.y }
    : { x0: t.x, y0: t.y, x1: t.dx ?? t.x, y1: t.dy ?? t.y };
}

// Styled teleport ('shadow'): the blink skills draw their own streaks, so this is a light smoke puff at both ends.
registerSkillFx({
  'teleport:shadow': (ctx, e) => {
    const { x0, y0, x1, y1 } = tpPoints(e);
    const a = ctx.P(x0, y0), b = ctx.P(x1, y1);
    ctx.juice.dust(a.x, a.y - 4, 5, 0x2a1a30);
    ctx.juice.dust(b.x, b.y - 4, 3, 0x3a2040);
    ctx.juice.embersAt(b.x, b.y - 14, 4, SHADOW);
  },
});

function stanceFx(ctx: FxCtx, e: CastFx, size: number) {
  const c = chest(ctx, e.x, e.y);
  ctx.juice.ring(c.x, c.y + 14, 22 * size, SILVER, 260);
  ctx.juice.sparksAt(c.x, c.y - 4, 6, 0xffffff);
  ctx.dungeon.flashLight(c.x, c.y, 90 * size, SILVER, 1.4, 260);
  sfx(ctx, 'skill_guard', e.x, e.y, 60, ctx.mine ? 2 : 1);
}

registerHazardFx({
  // Shadow clone: a flickering violet silhouette with a blade toward the owner's aim
  d_clone: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const life = Math.max(0, Math.min(1, (h.u - tick) / 30));
    const flick = 0.4 + 0.15 * Math.sin(ctx.now / 60 + h.i);
    g.fillStyle(0x000000, 0.3 * life).fillEllipse(p.x, p.y, ctx.rx(0.35) * 2, ctx.ry(0.35) * 2);
    g.fillStyle(DUSK, (flick + 0.1) * life).fillRoundedRect(p.x - 5, p.y - 34, 10, 30, 4);
    g.fillStyle(SHADOW, flick * life).fillCircle(p.x, p.y - 38, 5);
    g.fillStyle(CRIMSON, 0.9 * life).fillRect(p.x - 3, p.y - 39, 6, 1);
    const u = ctx.U(h.dx, h.dy);
    g.lineStyle(2, 0xd8c8ff, 0.7 * life).lineBetween(p.x + u.x * 4, p.y - 18 + u.y * 4, p.x + u.x * 16, p.y - 18 + u.y * 10);
  },
  // Smoke veil: drifting violet-grey puffs
  d_smoke: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const age = (tick - h.b) / Math.max(1, h.u - h.b);
    const a = 0.32 * (1 - age);
    for (let i = 0; i < 5; i++) {
      const ang = i * 1.256 + ctx.now / 900;
      const r = h.r * (0.35 + 0.15 * Math.sin(ctx.now / 400 + i));
      g.fillStyle(i % 2 ? 0x4a3a5a : 0x6a5a72, a).fillEllipse(p.x + Math.cos(ang) * ctx.rx(r), p.y + Math.sin(ang) * ctx.ry(r), ctx.rx(h.r * 0.9), ctx.ry(h.r * 0.9));
    }
  },
  // Death mark: a crimson reticle that tightens and blinks faster as it nears detonation
  d_mark: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const left = Math.max(0, (h.u - tick) / 60);
    const blink = Math.floor(ctx.now / (left < 0.7 ? 60 : 160)) % 2 === 0;
    const r = 0.6 + 0.25 * Math.min(1, left);
    g.lineStyle(2, blink ? 0xffffff : CRIMSON, 0.95).strokeEllipse(p.x, p.y, ctx.rx(r) * 2, ctx.ry(r) * 2, 32);
    const spin = ctx.now / 300;
    for (let i = 0; i < 4; i++) {
      const a = spin + (i * Math.PI) / 2;
      const x0 = p.x + Math.cos(a) * ctx.rx(r + 0.15), y0 = p.y + Math.sin(a) * ctx.ry(r + 0.15);
      const x1 = p.x + Math.cos(a) * ctx.rx(r - 0.15), y1 = p.y + Math.sin(a) * ctx.ry(r - 0.15);
      g.lineStyle(3, CRIMSON, 1).lineBetween(x0, y0, x1, y1);
    }
    g.fillStyle(BLOOD, 0.18).fillEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 32);
  },
}, { d_mark: CRIMSON, d_clone: SHADOW });

registerProjectileFx({
  d_reflect: { key: 'fx:shard', color: SILVER, scale: 1.2, additive: true },
});
