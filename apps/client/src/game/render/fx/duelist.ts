import * as Phaser from 'phaser';
import type { SfxId } from '../../audio/AudioEngine';
import { registerHazardFx, registerKillFx, registerProjectileFx, registerSkillFx, type CastFx, type FxCtx } from './registry';
import { castFlash, chestAt, heroGhosts, impactBurst, screenAngle, type Pal } from './spectacle';
import { skillLayer, skillSfx } from './kit3';

// Duelist presentation (cosmetic only): crisp white slashes and afterimages, crimson blood, violet shadow work.
// Branch identity: Edge = crimson and blood, Shadow = violet with crimson eyes, Tempo = silver with gold parry sparks.
// Sim conventions (simulation/src/classes/duelist.ts): blink events (d_shadowstep, d_execution, d_death_mark,
// d_fx_blink, d_fx_phantom) carry the departure in x,y and the arrival in dx,dy; d_fx_counter / d_fx_veins / d_fx_parry
// carry a target point in dx,dy; bursts (d_fx_cuts_burst, d_fx_mark_burst, d_fx_counter_sweep, d_fx_clone_burst) carry
// the radius in dx. Everything else uses dx,dy as the aim direction. True shapes: Twin Fangs 90deg/1.9 (finisher
// 110deg/2.3), Rend 100deg/2.2, Whirl r2.4, Execution lunge 3, Shadowstep strike r1.4, Rush r1.2, Mark r1.8, parry reach
// 1.3 (Mirror 1.6), thrust 2.4, Hundred Fangs 90deg/2.3, Thousand Cuts reach 5 and burst r2.4 (x1.6 with Finale).

const CRIMSON = 0xff3a52;
const CRIMSON_HOT = 0xffb0bc;
const BLOOD = 0xb0142a;
const SILVER = 0xe8eef8;
const SHADOW = 0x8a5aff;
const SHADOW_HOT = 0xd8c8ff;
const DUSK = 0x3a1a4a;
const PARRY = 0xffe8a0;

const P_EDGE: Pal = { main: CRIMSON, hot: 0xffffff, deep: BLOOD };
const P_SHADOW: Pal = { main: SHADOW, hot: SHADOW_HOT, deep: DUSK, bits: 'mote' };
const P_CUTS: Pal = { main: CRIMSON, hot: 0xffffff, deep: SHADOW, bits: 'star' };

// ---------------------------------------------------------------- helpers

const lastSfx = new Map<string, number>();
function sfx(ctx: FxCtx, id: SfxId, x: number, y: number, minGapMs: number, priority = 1) {
  const t = lastSfx.get(id) ?? -1e9;
  if (ctx.now - t < minGapMs) return;
  lastSfx.set(id, ctx.now);
  ctx.sfx(id, x, y, priority);
}

/** Brief caster hit-stop for finishers, throttled per slot so rapid finishers (Perfect Form) never stutter. */
const lastStop = new Map<number, number>();
function stopFor(ctx: FxCtx, slot: number, ms: number, gap = 380) {
  if (!ctx.mine) return;
  const t = lastStop.get(slot) ?? -1e9;
  if (ctx.now - t < gap) return;
  lastStop.set(slot, ctx.now);
  ctx.juice.hitStop(ms);
}

/** One-shot sprite from a pixel sheet: plays its animation (or fades over `ms`) and destroys itself. Decorative. */
function oneShot(ctx: FxCtx, key: string, x: number, y: number, o: { rot?: number; sx?: number; sy?: number; depth?: number; tint?: number; ms?: number; ox?: number; oy?: number } = {}) {
  const s = ctx.scene;
  if (ctx.reduced || !s.textures.exists(key)) return undefined;
  const spr = s.add.sprite(Math.round(x), Math.round(y), key).setRotation(o.rot ?? 0).setScale(o.sx ?? 1, o.sy ?? o.sx ?? 1)
    .setDepth(o.depth ?? 4658).setOrigin(o.ox ?? 0.5, o.oy ?? 0.5).setBlendMode(Phaser.BlendModes.ADD);
  if (o.tint !== undefined) spr.setTint(o.tint);
  if (s.anims.exists(key) && !o.ms) { spr.play(key); spr.once('animationcomplete', () => spr.destroy()); }
  else s.tweens.add({ targets: spr, alpha: 0, duration: o.ms ?? 260, ease: 'Quad.easeIn', onComplete: () => spr.destroy() });
  return spr;
}

/** Razor lance streak between two screen points (the pixel thrust sheet stretched to the true length). */
function lance(ctx: FxCtx, ax: number, ay: number, bx: number, by: number, thick = 1, tint?: number) {
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 4) return;
  oneShot(ctx, 'fx:duelist:thrust', ax, ay, { rot: Math.atan2(by - ay, bx - ax), sx: len / 64, sy: thick, ox: 0, oy: 0.5, tint });
}

/** Fading additive streak between two world points at chest height (for violet shadow lines). */
function streak(ctx: FxCtx, x0: number, y0: number, x1: number, y1: number, color: number, width: number, ms = 200) {
  if (ctx.reduced) return;
  const a = chestAt(ctx, x0, y0), b = chestAt(ctx, x1, y1);
  const g = ctx.scene.add.graphics().setDepth(4645).setBlendMode(Phaser.BlendModes.ADD);
  g.lineStyle(width, color, 0.85).lineBetween(a.x, a.y, b.x, b.y);
  g.lineStyle(Math.max(1, width / 3), 0xffffff, 1).lineBetween(a.x, a.y, b.x, b.y);
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
}

/**
 * Afterimages strewn along a blink from departure to arrival (world points). The hero sprite sits at one end of the
 * blink when the event arrives (before or after the snap), so each ghost is offset from whichever end it is nearest.
 */
function blinkGhosts(ctx: FxCtx, slot: number, x0: number, y0: number, x1: number, y1: number, tint: number, n = 5) {
  const s = ctx.actorSprite?.(slot);
  if (!s || !s.active || ctx.reduced) return;
  const a = ctx.P(x0, y0), b = ctx.P(x1, y1);
  const da = (s.x - a.x) ** 2 + (s.y - a.y) ** 2, db = (s.x - b.x) ** 2 + (s.y - b.y) ** 2;
  const bx = da < db ? a.x : b.x, by = da < db ? a.y : b.y;
  const k = Math.max(2, Math.min(n, ctx.juice.budget(n)));
  for (let i = 0; i < k; i++) {
    const t = i / k;
    ctx.juice.afterimage(s, tint, 0.22 + 0.38 * t, 170 + 110 * t, a.x + (b.x - a.x) * t - bx, a.y + (b.y - a.y) * t - by);
  }
}

/** Two crossing razor cuts at a screen point (white and a colour), with a starburst at the crossing. */
function crossCut(ctx: FxCtx, x: number, y: number, color: number, scale = 1, ms = 180) {
  const J = ctx.juice;
  const a = Math.random() * 0.6 - 0.3;
  J.slash(x, y, -0.8 + a, 0xffffff, scale, { thin: true, ms });
  J.slash(x, y, 0.8 + a + Math.PI, color, scale, { thin: true, ms, flip: true });
  J.starburst(x, y, 0xffffff, 0.7 * scale + 0.3, 150);
}

/** Arrival strike after a blink: a cross cut, sparks, a shockwave at the true strike radius. */
function arrival(ctx: FxCtx, x: number, y: number, R: number, color: number, inner: number, power = 1) {
  const J = ctx.juice;
  const p = ctx.P(x, y);
  const c = chestAt(ctx, x, y);
  crossCut(ctx, c.x, c.y, color, 0.9 + 0.2 * power);
  if (R > 0) J.shockwave(p.x, p.y, ctx.rx(R), color, 260);
  J.ring(p.x, p.y, 18, inner, 200);
  J.sparksAt(c.x, c.y, 4 + power * 3, inner);
  ctx.dungeon.flashLight(c.x, c.y, 120 + power * 30, color, 1.6 + 0.3 * power, 200);
}

/** Departure puff: a violet implosion and smoke where the Duelist vanished. */
function departure(ctx: FxCtx, x: number, y: number, tint = SHADOW) {
  const J = ctx.juice;
  const p = ctx.P(x, y);
  J.dust(p.x, p.y - 4, 4, 0x2a1a30);
  J.orb(p.x, p.y - 16, tint, 0.55, 180, 0.4);
  J.ring(p.x, p.y, 18, tint, 200);
  J.bits('mote', p.x, p.y - 14, 3, tint);
}

/** Thousand Cuts window per slot: its blinks share the d_fx_blink event with Phantom Rush, so they recolour crimson. */
const cutsUntil = new Map<number, number>();
const fangSide = new Map<number, boolean>();
function flipFor(slot: number) { const f = !fangSide.get(slot); fangSide.set(slot, f); return f; }

// ---------------------------------------------------------------- skills

registerSkillFx({
  // ---- basic ----
  // Twin Fangs: a crisp thin crescent at the true 1.9 reach, alternating fore/backhand, silver then crimson. Cheap.
  d_twin_fangs: (ctx, e) => {
    const J = ctx.juice;
    const ang = screenAngle(ctx, e.dx, e.dy);
    const u = ctx.U(e.dx, e.dy);
    const c = chestAt(ctx, e.x, e.y);
    const flip = flipFor(e.slot);
    J.slash(c.x + u.x * 4, c.y + u.y * 2, ang + (flip ? 0.2 : -0.2), flip ? SILVER : CRIMSON, 1.3, { thin: true, flip, ms: 140 });
    J.sparksAt(c.x + u.x * 36, c.y + u.y * 18, 2, flip ? 0xffffff : CRIMSON_HOT);
    skillSfx(ctx, 'd_twin_fangs', 'swing', e.x, e.y, 55, ctx.mine ? 1 : 0);   // the file has 3 variations, picked at random
  },
  // Fang Finisher (every 4th connecting swing; 110deg/2.3): razor X at the reach, a heavy crimson wake, a starburst.
  d_fang_finisher: (ctx, e) => {
    const J = ctx.juice;
    const ang = screenAngle(ctx, e.dx, e.dy);
    const u = ctx.U(e.dx, e.dy);
    const c = chestAt(ctx, e.x, e.y);
    const tip = { x: c.x + u.x * 44, y: c.y + u.y * 22 };
    J.slash(c.x, c.y, ang, CRIMSON, 1.6, { ms: 200 });
    J.slash(c.x + u.x * 4, c.y + u.y * 2, ang - 0.3, 0xffffff, 1.55, { thin: true, ms: 170 });
    J.slash(c.x + u.x * 4, c.y + u.y * 2, ang + 0.3, SILVER, 1.55, { thin: true, flip: true, ms: 170 });
    J.starburst(tip.x, tip.y, 0xffffff, 1.1, 160);
    J.sparksAt(tip.x, tip.y, 8, SILVER);
    J.bleed('player', tip.x, tip.y, 5, u.x, u.y);
    heroGhosts(ctx, e.slot, e.dx, e.dy, CRIMSON, 2, 7);
    ctx.dungeon.flashLight(tip.x, tip.y, 120, CRIMSON, 1.6, 160);
    stopFor(ctx, e.slot, 32);
    sfx(ctx, 'blade_flurry', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  // Shadow clone mirroring a swing: a violet crescent from where it stands.
  d_clone_slash: (ctx, e) => {
    const ang = screenAngle(ctx, e.dx, e.dy);
    const c = chestAt(ctx, e.x, e.y);
    ctx.juice.slash(c.x, c.y, ang, SHADOW, 1.2, { thin: true, flip: Math.random() < 0.5, ms: 150 });
    ctx.juice.sparksAt(c.x, c.y, 1, SHADOW_HOT);
  },

  // ---- Edge ----
  // Rend (100deg/2.2): the pixel X-cut at the cone's heart, two heavy crimson crescents, an aimed blood spray.
  d_rend: (ctx, e) => {
    const J = ctx.juice;
    const ang = screenAngle(ctx, e.dx, e.dy);
    const u = ctx.U(e.dx, e.dy);
    const c = chestAt(ctx, e.x, e.y);
    const mid = { x: c.x + u.x * 34, y: c.y + u.y * 17 };
    J.slash(c.x, c.y, ang + 0.45, CRIMSON, 1.55, { ms: 210 });
    J.slash(c.x, c.y, ang - 0.45, BLOOD, 1.55, { ms: 230, flip: true });
    oneShot(ctx, 'fx:duelist:xslash', mid.x, mid.y, { rot: ang, sx: 1.25 });
    J.starburst(mid.x, mid.y, 0xffffff, 1.1, 170);
    J.bleed('player', mid.x, mid.y, ctx.rank(e.slot, 'd_exsanguinate') > 0 ? 18 : 12, u.x, u.y);
    J.sparksAt(mid.x, mid.y, 6, CRIMSON_HOT);
    ctx.dungeon.flashLight(mid.x, mid.y, 130, CRIMSON, 1.8, 180);
    stopFor(ctx, e.slot, 30);
    skillSfx(ctx, 'd_rend', 'skill_sweep', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  // Exsanguinate (on an enemy): its bleeds burst out in a blood geyser.
  d_fx_exsang: (ctx, e) => {
    const J = ctx.juice;
    const c = chestAt(ctx, e.x, e.y);
    const p = ctx.P(e.x, e.y);
    J.beam(p.x, p.y, 54, 8, BLOOD, 260);
    J.bleed('player', c.x, c.y, 20);
    J.starburst(c.x, c.y, CRIMSON_HOT, 1, 170);
    J.orb(c.x, c.y, BLOOD, 0.7, 200);
    ctx.dungeon.addDecal('blood', p.x, p.y + 3, 0x5a0a10, 0.8);
    ctx.dungeon.flashLight(c.x, c.y, 100, BLOOD, 1.6, 200);
    sfx(ctx, 'blast_decay', e.x, e.y, 70, 1);   // a wet burst of blood
  },
  // Crimson Whirl cast: a crimson flash and glyph under the spinning Duelist (the spins are d_fx_whirl).
  d_crimson_whirl: (ctx, e) => {
    castFlash(ctx, e.x, e.y, P_EDGE, 1.2, { glyph: true });
    skillSfx(ctx, 'd_crimson_whirl', 'skill_sweep', e.x, e.y, 60, 2);
  },
  // One whirl spin (3 per cast, r2.4): blades ringing the true radius, a crimson ring, a spinning afterimage, blood.
  d_fx_whirl: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const c = chestAt(ctx, e.x, e.y);
    const spin = (ctx.now / 70) % (Math.PI * 2);
    const rx = ctx.rx(2.4) * 0.62, ry = ctx.ry(2.4) * 0.62;
    for (let i = 0; i < 3; i++) {
      const a = spin + (i * Math.PI * 2) / 3;
      J.slash(c.x + Math.cos(a) * rx, c.y + Math.sin(a) * ry, a + Math.PI / 2, i === 0 ? 0xffffff : i === 1 ? CRIMSON : SILVER, 0.85, { thin: true, ms: 150 });
    }
    J.slash(c.x, c.y, spin, CRIMSON, 1.6, { ms: 180 });
    J.ring(p.x, p.y, ctx.rx(2.4), CRIMSON, 240);
    J.bleed('player', c.x, c.y, 6);
    const s = ctx.actorSprite?.(e.slot);
    if (s?.active) J.afterimage(s, CRIMSON, 0.4, 180, Math.cos(spin) * 6, Math.sin(spin) * 3);
    ctx.dungeon.flashLight(c.x, c.y, 150, CRIMSON, 1.7, 220);
    skillLayer(ctx, 'd_crimson_whirl', 'swing', e.x, e.y, 50, ctx.mine ? 2 : 1);
  },
  // Execution lunge (x,y -> dx,dy): afterimages down the lunge and a silver-crimson lance along it.
  d_execution: (ctx, e) => {
    const a = chestAt(ctx, e.x, e.y), b = chestAt(ctx, e.dx, e.dy);
    blinkGhosts(ctx, e.slot, e.x, e.y, e.dx, e.dy, SILVER, 5);
    lance(ctx, a.x, a.y, b.x, b.y, 1.2);
    const from = ctx.P(e.x, e.y);
    ctx.juice.dust(from.x, from.y, 5, 0x3a2a2a);
    ctx.juice.ring(from.x, from.y, 16, CRIMSON, 180);
    skillSfx(ctx, 'd_execution', 'dodge', e.x, e.y, 60, 2);   // the lunge
  },
  // Execution connecting (on the enemy, aim in dx,dy): a lance clean through, white and crimson starbursts, hit-stop.
  d_fx_execute_hit: (ctx, e) => {
    const J = ctx.juice;
    const c = chestAt(ctx, e.x, e.y);
    const u = ctx.U(e.dx, e.dy);
    lance(ctx, c.x - u.x * 30, c.y - u.y * 15, c.x + u.x * 46, c.y + u.y * 23, 1.6);
    J.slash(c.x, c.y, Math.atan2(u.y, u.x), 0xffffff, 1.1, { thin: true, ms: 200 });
    J.starburst(c.x, c.y, 0xffffff, 1.7, 200);
    J.starburst(c.x + u.x * 14, c.y + u.y * 7, CRIMSON, 1.1, 230);
    J.orb(c.x, c.y, CRIMSON, 0.8, 200);
    J.sparksAt(c.x, c.y, 14, CRIMSON_HOT);
    J.bleed('player', c.x, c.y, 18, u.x, u.y);
    const p = ctx.P(e.x, e.y);
    ctx.dungeon.addDecal('blood', p.x + u.x * 10, p.y + 3, 0x5a0a10, 0.8);
    ctx.dungeon.flashLight(c.x, c.y, 160, CRIMSON, 2.4, 220);
    stopFor(ctx, e.slot, 75, 0);
    skillLayer(ctx, 'd_execution', 'crit', e.x, e.y, 60, 2);   // the stab is in the Execution file
  },
  // Coup de Grace (a unit slain outright): a white guillotine, crossing crimson cuts, a blood ring.
  d_fx_execute: (ctx, e) => {
    const J = ctx.juice;
    const c = chestAt(ctx, e.x, e.y);
    const p = ctx.P(e.x, e.y);
    J.beam(p.x, p.y, 90, 10, CRIMSON, 220);
    J.beam(p.x, p.y, 90, 3, 0xffffff, 170);
    crossCut(ctx, c.x, c.y, CRIMSON, 1.2, 220);
    J.starburst(c.x, c.y, CRIMSON_HOT, 1.4, 200);
    J.shockwave(p.x, p.y, 30, BLOOD, 260);
    J.bleed('player', c.x, c.y, 18);
    ctx.dungeon.flashLight(c.x, c.y, 140, CRIMSON, 2.2, 220);
    stopFor(ctx, e.slot, 50);
    sfx(ctx, 'blade_flurry', e.x, e.y, 80, 2);   // the crossing cuts (the death plays the central kill cue)
  },
  // Open Veins (bleed jumping from a corpse at x,y to dx,dy): a thin blood thread with drops along it.
  d_fx_veins: (ctx, e) => {
    streak(ctx, e.x, e.y, e.dx, e.dy, BLOOD, 2, 320);
    const a = chestAt(ctx, e.x, e.y), t = chestAt(ctx, e.dx, e.dy);
    ctx.juice.bitsAlong('mote', a.x, a.y, t.x, t.y, 4, CRIMSON);
    ctx.juice.bleed('player', t.x, t.y, 6);
    ctx.juice.starburst(t.x, t.y, CRIMSON, 0.6, 140);
  },

  // ---- Shadow ----
  // Shadowstep (x,y -> dx,dy, strike r1.4): smoke where it vanished, violet afterimages down the blink, a razor arrival.
  d_shadowstep: (ctx, e) => {
    departure(ctx, e.x, e.y);
    blinkGhosts(ctx, e.slot, e.x, e.y, e.dx, e.dy, SHADOW, 6);
    streak(ctx, e.x, e.y, e.dx, e.dy, SHADOW, 3, 220);
    arrival(ctx, e.dx, e.dy, 1.4, SHADOW, SHADOW_HOT, 2);
    const t = chestAt(ctx, e.dx, e.dy);
    ctx.juice.bits('mote', t.x, t.y, 5, SHADOW_HOT);
    stopFor(ctx, e.slot, 28);
    skillSfx(ctx, 'd_shadowstep', 'blink', e.dx, e.dy, 45, ctx.mine ? 2 : 1);
    skillLayer(ctx, 'd_shadowstep', 'swing', e.dx, e.dy, 45, 1);   // the arrival cut
  },
  // Phantom Rush cast: the Duelist dissolves into violet, a faint ring at the true 6 reach.
  d_phantom_rush: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    castFlash(ctx, e.x, e.y, P_SHADOW, 1.4, { glyph: true });
    ctx.juice.ring(p.x, p.y, ctx.rx(6), SHADOW, 420);
    ctx.juice.bits('mote', p.x, p.y - 14, 8, SHADOW_HOT);
    if (ctx.mine) ctx.juice.pop(DUSK, 0.16, 160);
    skillSfx(ctx, 'd_phantom_rush', 'blink', e.x, e.y, 60, 2);
  },
  // A rush / Thousand Cuts / plain blink (x,y -> dx,dy): ghost trail, a streak and a cut on arrival. Crimson during
  // Thousand Cuts, violet for Phantom Rush (r1.2 strike).
  d_fx_blink: (ctx, e) => {
    const cuts = (cutsUntil.get(e.slot) ?? 0) > ctx.now;
    const col = cuts ? CRIMSON : SHADOW, hot = cuts ? CRIMSON_HOT : SHADOW_HOT;
    blinkGhosts(ctx, e.slot, e.x, e.y, e.dx, e.dy, cuts ? CRIMSON : SHADOW, 4);
    if (cuts) { const a = chestAt(ctx, e.x, e.y), b = chestAt(ctx, e.dx, e.dy); lance(ctx, a.x, a.y, b.x, b.y, 0.9); }
    else streak(ctx, e.x, e.y, e.dx, e.dy, SHADOW, 3, 200);
    const from = ctx.P(e.x, e.y);
    ctx.juice.dust(from.x, from.y - 4, 2, 0x2a1a30);
    arrival(ctx, e.dx, e.dy, cuts ? 0 : 1.2, col, hot, 1);
    skillLayer(ctx, cuts ? 'd_thousand_cuts' : 'd_phantom_rush', 'swing', e.dx, e.dy, 45, ctx.mine ? 2 : 1);
  },
  // Death Mark (x,y -> dx,dy): a crimson-violet blink, a strike, and a skull rising from the marked foe.
  d_death_mark: (ctx, e) => {
    departure(ctx, e.x, e.y);
    blinkGhosts(ctx, e.slot, e.x, e.y, e.dx, e.dy, SHADOW, 6);
    streak(ctx, e.x, e.y, e.dx, e.dy, BLOOD, 3, 240);
    arrival(ctx, e.dx, e.dy, 0, CRIMSON, SHADOW_HOT, 2);
    const t = chestAt(ctx, e.dx, e.dy);
    ctx.juice.bits('skull', t.x, t.y - 10, 2, CRIMSON);
    ctx.dungeon.flashLight(t.x, t.y, 150, CRIMSON, 2, 260);
    stopFor(ctx, e.slot, 30);
    skillSfx(ctx, 'd_death_mark', 'blink', e.dx, e.dy, 45, ctx.mine ? 2 : 1);
  },
  // Death Mark detonation (r in dx): a razor-sharp crimson and violet bloom, crossing cuts, skulls, a blood stain.
  d_fx_mark_burst: (ctx, e) => {
    const J = ctx.juice;
    const R = e.dx || 1.8;
    const p = ctx.P(e.x, e.y);
    const c = chestAt(ctx, e.x, e.y);
    impactBurst(ctx, e.x, e.y, R, P_CUTS, 3, { dust: 4, decal: 'blood', decalTint: 0x4a0a14 });
    J.shockwave(p.x, p.y, ctx.rx(R * 0.8), SHADOW, 340, 60);
    crossCut(ctx, c.x, c.y, CRIMSON, 1.5, 230);
    crossCut(ctx, c.x, c.y, SHADOW, 1.1, 200);
    J.beam(p.x, p.y, 80, 10, SHADOW, 240);
    J.bits('skull', c.x, c.y - 6, 3, SHADOW_HOT);
    J.bleed('player', c.x, c.y, 14);
    // Kept shared: the mark detonates up to 2.5s after the cast (its own trigger), so the cast file cannot time it.
    sfx(ctx, 'blade_flurry', e.x, e.y, 80, 3);
    sfx(ctx, 'blast_decay', e.x, e.y, 80, 1);   // the blood bloom
  },
  // Phantom Dash (a dodge that cuts, x,y -> dx,dy): violet afterimages and a cut where the dash ends.
  d_fx_phantom: (ctx, e) => {
    blinkGhosts(ctx, e.slot, e.x, e.y, e.dx, e.dy, SHADOW, 4);
    streak(ctx, e.x, e.y, e.dx, e.dy, SHADOW, 3, 200);
    const t = chestAt(ctx, e.dx, e.dy);
    ctx.juice.slash(t.x, t.y, screenAngle(ctx, e.dx - e.x, e.dy - e.y), SHADOW_HOT, 1, { thin: true, ms: 160 });
    ctx.juice.sparksAt(t.x, t.y, 5, SHADOW);
    sfx(ctx, 'swing', e.x, e.y, 60, 1);
  },
  // Legion of Shades clone detonation (r in dx): a violet burst with a cross cut.
  d_fx_clone_burst: (ctx, e) => {
    const R = e.dx || 1.8;
    impactBurst(ctx, e.x, e.y, R, P_SHADOW, 2, { dust: 3 });
    const c = chestAt(ctx, e.x, e.y);
    crossCut(ctx, c.x, c.y, SHADOW, 1, 200);
    ctx.juice.bits('skull', c.x, c.y, 1, SHADOW_HOT);
    stopFor(ctx, e.slot, 25);
    sfx(ctx, 'blade_flurry', e.x, e.y, 60, 1);
  },

  // ---- Tempo ----
  d_riposte: (ctx, e) => stanceFx(ctx, e, 1.3, SILVER),
  d_mirror_guard: (ctx, e) => stanceFx(ctx, e, 1.6, SHADOW_HOT),
  d_hundred_fangs: (ctx, e) => stanceFx(ctx, e, 1.3, CRIMSON),
  // A parry (player x,y; threat at dx,dy): a gold-white clang between them, crossing sparks, a silver ring, hit-stop.
  d_fx_parry: (ctx, e) => {
    const J = ctx.juice;
    const a = chestAt(ctx, e.x, e.y), b = chestAt(ctx, e.dx, e.dy);
    const mx = a.x + (b.x - a.x) * 0.4, my = a.y + (b.y - a.y) * 0.4;
    J.starburst(mx, my, 0xffffff, 1.8, 200);
    J.starburst(mx, my, PARRY, 1.1, 260);
    crossCut(ctx, mx, my, PARRY, 1, 200);
    J.sparksAt(mx, my, 18, PARRY);
    J.bits('star', mx, my, 6, 0xffffff);
    J.ring(a.x, a.y + 14, 38, SILVER, 260);
    if (ctx.rank(e.slot, 'd_perfect_guard') > 0) J.shockwave(a.x, a.y + 14, 30, 0x9fd8ff, 300);
    if (ctx.rank(e.slot, 'd_perfect_form') > 0) J.orb(a.x, a.y, CRIMSON, 0.9, 300);
    ctx.dungeon.flashLight(mx, my, 170, 0xffffff, 2.6, 200);
    J.pop(0xffffff, 0.1, 120);
    stopFor(ctx, e.slot, 90, 0);
    sfx(ctx, 'shield_bash', e.x, e.y, 50, 3);   // the parry clang
  },
  // Counter-thrust (player x,y -> enemy dx,dy): a lance through the attacker and stun stars over its head.
  d_fx_counter: (ctx, e) => {
    const a = chestAt(ctx, e.x, e.y), t = chestAt(ctx, e.dx, e.dy);
    const ux = t.x - a.x, uy = t.y - a.y, l = Math.hypot(ux, uy) || 1;
    lance(ctx, a.x, a.y, t.x + (ux / l) * 20, t.y + (uy / l) * 10, 1.4);
    blinkGhosts(ctx, e.slot, e.x, e.y, e.x + (e.dx - e.x) * 0.3, e.y + (e.dy - e.y) * 0.3, SILVER, 2);
    ctx.juice.starburst(t.x, t.y, 0xffffff, 1.3, 180);
    ctx.juice.sparksAt(t.x, t.y, 10, SILVER);
    ctx.juice.bits('star', t.x, t.y - 22, 4, PARRY);
    sfx(ctx, 'swing', e.x, e.y, 60, 1);   // the thrust (the parry clang plays with it)
  },
  // Counterstrike sweep (r in dx): six silver blades around the true radius, a silver wave, stun stars.
  d_fx_counter_sweep: (ctx, e) => {
    const J = ctx.juice;
    const R = e.dx || 2.4;
    const p = ctx.P(e.x, e.y);
    const c = chestAt(ctx, e.x, e.y);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      J.slash(c.x + Math.cos(a) * ctx.rx(R) * 0.5, c.y + Math.sin(a) * ctx.ry(R) * 0.5, a + Math.PI / 2, i % 2 ? SILVER : 0xffffff, 1, { thin: true, ms: 180 });
    }
    J.shockwave(p.x, p.y, ctx.rx(R), SILVER, 320);
    J.ring(p.x, p.y, ctx.rx(R * 0.6), PARRY, 220);
    J.starburst(c.x, c.y, 0xffffff, 1.4, 180);
    J.bits('star', c.x, c.y - 10, 8, PARRY, { angle: -90, spread: 200 });
    ctx.dungeon.flashLight(c.x, c.y, Math.max(130, ctx.rx(R) * 2), SILVER, 2, 220);
    sfx(ctx, 'skill_sweep', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  // An unused Riposte stance ends in a thrust (2.4 long): a lance at the true length.
  d_fx_thrust: (ctx, e) => {
    const a = chestAt(ctx, e.x, e.y), b = chestAt(ctx, e.x + e.dx * 2.4, e.y + e.dy * 2.4);
    lance(ctx, a.x, a.y, b.x, b.y, 1.1);
    ctx.juice.sparksAt(b.x, b.y, 4, SILVER);
    sfx(ctx, 'swing', e.x, e.y, 60, 1);
  },
  // One Hundred Fangs slash (6-16 over 0.8s, 90deg/2.3): a thin cut somewhere in the cone, every few a starburst.
  d_fx_fang_slash: (ctx, e) => {
    const J = ctx.juice;
    const ang = screenAngle(ctx, e.dx, e.dy);
    const u = ctx.U(e.dx, e.dy);
    const c = chestAt(ctx, e.x, e.y);
    const flip = flipFor(e.slot);
    const off = (Math.random() - 0.5) * 1.3;
    const r = 6 + Math.random() * 14;
    J.slash(c.x + u.x * r, c.y + u.y * r * 0.5, ang + off, flip ? SILVER : CRIMSON, 1.1 + Math.random() * 0.4, { thin: true, flip, ms: 130 });
    const tx = c.x + Math.cos(ang + off) * 40, ty = c.y + Math.sin(ang + off) * 20;
    J.sparksAt(tx, ty, 2, flip ? 0xffffff : CRIMSON_HOT);
    if (Math.random() < 0.3) J.starburst(tx, ty, 0xffffff, 0.6, 120);
    skillLayer(ctx, 'd_hundred_fangs', 'blade_flurry', e.x, e.y, 160, ctx.mine ? 2 : 1);   // one three-slash flurry per few cuts, never a machine gun
  },

  // ---- Signature ----
  // Thousand Cuts cast: a crimson glyph, a ring at the true 5 reach, a dark crimson pop; the blinks follow.
  d_thousand_cuts: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    cutsUntil.set(e.slot, ctx.now + 1100);
    castFlash(ctx, e.x, e.y, P_EDGE, 2, { glyph: true });
    J.shockwave(p.x, p.y, ctx.rx(5), CRIMSON, 420);
    J.ring(p.x, p.y, ctx.rx(5), SHADOW, 380);
    departure(ctx, e.x, e.y, CRIMSON);
    J.bits('star', p.x, p.y - 16, 6, CRIMSON_HOT);
    ctx.dungeon.flashLight(p.x, p.y - 10, 260, CRIMSON, 2.4, 600);
    if (ctx.mine) J.pop(0x5a0414, 0.14, 200);
    skillSfx(ctx, 'd_thousand_cuts', 'blink', e.x, e.y, 60, 3);
  },
  // Thousand Cuts finale burst (r in dx, x1.6 with Finale): the razor bloom. Eight radiating cuts, a crimson column,
  // waves at the true radius, blood, a pop and hit-stop.
  d_fx_cuts_burst: (ctx, e) => {
    const J = ctx.juice;
    const R = e.dx || 2.4;
    const p = ctx.P(e.x, e.y);
    const c = chestAt(ctx, e.x, e.y);
    cutsUntil.delete(e.slot);
    impactBurst(ctx, e.x, e.y, R, P_CUTS, 3, { dust: 8, decal: 'blood', decalTint: 0x4a0a14 });
    const n = R > 3 ? 12 : 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      J.slash(c.x + Math.cos(a) * ctx.rx(R) * 0.45, c.y + Math.sin(a) * ctx.ry(R) * 0.45, a, i % 2 ? CRIMSON : 0xffffff, 0.9, { thin: true, ms: 220 });
    }
    crossCut(ctx, c.x, c.y, CRIMSON, 1.6, 240);
    J.beam(p.x, p.y, 170, 22, CRIMSON, 320);
    J.beam(p.x, p.y, 170, 7, 0xffffff, 240);
    J.starburst(c.x, c.y, 0xffffff, 2.2, 230);
    if (R > 3) J.shockwave(p.x, p.y, ctx.rx(R * 1.1), SHADOW, 460, 100);
    J.bleed('player', c.x, c.y, 22);
    const s = ctx.actorSprite?.(e.slot);
    if (s?.active) for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 + Math.PI / 4; J.afterimage(s, i % 2 ? CRIMSON : SHADOW, 0.45, 260, Math.cos(a) * 16, Math.sin(a) * 8); }
    J.pop(CRIMSON, 0.16, 220);
    stopFor(ctx, e.slot, 90, 0);
    skillLayer(ctx, 'd_thousand_cuts', 'blade_flurry', e.x, e.y, 80, 3);
    skillLayer(ctx, 'd_thousand_cuts', 'slam_heavy', e.x, e.y, 80, 2);   // the knockback bloom
  },
});

// Styled teleport ('shadow', every Duelist blink): x/y = destination, dx/dy = origin. The blink skills draw the trail,
// so this is only a smoke puff at both ends.
registerSkillFx({
  'teleport:shadow': (ctx, e) => {
    const b = ctx.P(e.x, e.y), a = ctx.P(e.dx, e.dy);
    ctx.juice.dust(a.x, a.y - 4, 4, 0x2a1a30);
    ctx.juice.dust(b.x, b.y - 4, 2, 0x3a2040);
    ctx.juice.embersAt(b.x, b.y - 14, 3, SHADOW);
  },
});

/** Parry stance: blade raised with a glint, a ring at the true parry reach, a silver light. */
function stanceFx(ctx: FxCtx, e: CastFx, R: number, color: number) {
  const J = ctx.juice;
  const p = ctx.P(e.x, e.y);
  const u = ctx.U(e.dx, e.dy);
  const c = chestAt(ctx, e.x, e.y, 18);
  J.shockwave(p.x, p.y, ctx.rx(R), color, 300);
  J.ring(p.x, p.y, ctx.rx(R * 0.6), 0xffffff, 240);
  J.slash(c.x, c.y, screenAngle(ctx, e.dx, e.dy) - Math.PI / 2, 0xffffff, 0.8, { thin: true, ms: 200 });
  J.starburst(c.x + u.x * 8, c.y - 6, 0xffffff, 1, 200);
  J.sparksAt(c.x, c.y - 4, 6, color);
  if (e.skill === 'd_mirror_guard') J.bits('star', c.x, c.y, 6, SHADOW_HOT);
  ctx.dungeon.flashLight(c.x, c.y, 110 * R, color, 1.6, 260);
  skillSfx(ctx, e.skill, 'skill_guard', e.x, e.y, 60, ctx.mine ? 2 : 1);   // d_riposte / d_mirror_guard / d_hundred_fangs
}

// ---------------------------------------------------------------- hazards

registerHazardFx({
  // Shadow clone (3s): a hooded violet silhouette with crimson eyes and twin blades toward the owner's aim; it
  // flickers with glitch slices, sheds wisps and fades out at the end.
  d_clone: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const life = Math.max(0, Math.min(1, (h.u - tick) / 30)) * Math.max(0, Math.min(1, (tick - h.b + 1) / 6));
    const flick = 0.55 + 0.2 * Math.sin(ctx.now / 55 + h.i);
    const gx = Math.floor(ctx.now / 70 + h.i * 3) % 7 === 0 ? 2 : 0;
    const a = flick * life;
    const x = Math.round(p.x), y = Math.round(p.y);
    g.fillStyle(0x000000, 0.35 * life).fillEllipse(x, y, ctx.rx(0.4) * 2, ctx.ry(0.4) * 2, 16);
    g.fillStyle(SHADOW, 0.18 * life).fillEllipse(x, y, ctx.rx(0.6) * 2, ctx.ry(0.6) * 2, 16);
    // cloak, body and hood
    g.fillStyle(DUSK, a).fillTriangle(x - 8, y - 3, x + 8, y - 3, x + gx, y - 30);
    g.fillStyle(0x5a3a8a, a).fillRect(x - 4 + gx, y - 26, 8, 18);
    g.fillStyle(SHADOW, a * 0.9).fillRect(x - 4 + gx, y - 26, 3, 18);
    g.fillStyle(DUSK, a).fillCircle(x + gx, y - 32, 5);
    g.fillStyle(SHADOW, a).fillRect(x - 4 + gx, y - 37, 8, 3);
    g.fillStyle(0x0a0410, a).fillRect(x - 3 + gx, y - 33, 6, 3);
    g.fillStyle(CRIMSON, Math.min(1, life * 1.2)).fillRect(x - 2 + gx, y - 32, 1, 1).fillRect(x + 1 + gx, y - 32, 1, 1);
    // rim light and twin blades
    g.lineStyle(1, SHADOW_HOT, 0.6 * life).strokeTriangle(x - 8, y - 3, x + 8, y - 3, x + gx, y - 30);
    const u = ctx.U(h.dx, h.dy);
    g.lineStyle(2, SHADOW_HOT, 0.85 * life).lineBetween(x + u.x * 4 - 3, y - 18 + u.y * 3, x + u.x * 18 - 3, y - 18 + u.y * 9 - 4);
    g.lineStyle(2, CRIMSON, 0.8 * life).lineBetween(x + u.x * 4 + 3, y - 16 + u.y * 3, x + u.x * 16 + 3, y - 16 + u.y * 8 + 3);
    if (!ctx.reduced && Math.random() < 0.12) ctx.juice.bits('mote', x + (Math.random() - 0.5) * 12, y - 10 - Math.random() * 20, 1, SHADOW);
  },
  // Smoke Veil (r2, 2s): drifting violet-grey puffs inside a faint rim at the true radius.
  d_smoke: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const age = (tick - h.b) / Math.max(1, h.u - h.b);
    const a = 0.34 * (1 - age);
    const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
    g.fillStyle(0x1a1024, a * 0.8).fillEllipse(p.x, p.y, rx * 1.6, ry * 1.6, 28);
    for (let i = 0; i < 6; i++) {
      const ang = i * 1.047 + ctx.now / 900;
      const r = h.r * (0.35 + 0.15 * Math.sin(ctx.now / 400 + i));
      g.fillStyle(i % 2 ? 0x4a3a5a : 0x6a5a72, a).fillEllipse(p.x + Math.cos(ang) * ctx.rx(r), p.y - 6 + Math.sin(ang) * ctx.ry(r), rx * 0.85, ry * 0.95, 20);
    }
    g.lineStyle(1, SHADOW, 0.45 * (1 - age)).strokeEllipse(p.x, p.y, rx * 2, ry * 2, 32);
    if (!ctx.reduced && Math.random() < 0.15) ctx.juice.dust(p.x + (Math.random() - 0.5) * rx * 1.4, p.y + (Math.random() - 0.5) * ry, 1, 0x3a2a4a);
  },
  // Death Mark (2.5s, r1.8): the true blast footprint, a countdown arc, a tightening reticle and a crimson sigil
  // floating over the mark, all blinking faster as detonation nears.
  d_mark: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const total = Math.max(1, h.u - h.b);
    const prog = Math.min(1, Math.max(0, (tick - h.b) / total));
    const left = Math.max(0, (h.u - tick) / 60);
    const blink = Math.floor(ctx.now / (left < 0.7 ? 60 : 160)) % 2 === 0;
    const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
    g.fillStyle(BLOOD, 0.1 + 0.12 * prog).fillEllipse(p.x, p.y, rx * 2, ry * 2, 32);
    // dashed rim
    g.lineStyle(2, left < 0.7 && blink ? 0xffffff : CRIMSON, 0.85);
    const spin = ctx.now / 900;
    for (let i = 0; i < 12; i++) {
      const a0 = spin + (i * Math.PI) / 6;
      g.beginPath().moveTo(p.x + Math.cos(a0) * rx, p.y + Math.sin(a0) * ry).lineTo(p.x + Math.cos(a0 + 0.3) * rx, p.y + Math.sin(a0 + 0.3) * ry).strokePath();
    }
    // countdown arc
    const a1 = -Math.PI / 2 + Math.PI * 2 * (1 - prog);
    g.lineStyle(3, SHADOW_HOT, 0.8).beginPath();
    g.moveTo(p.x, p.y - ry * 0.82);
    for (let i = 1; i <= 16; i++) { const a = -Math.PI / 2 + ((a1 + Math.PI / 2) * i) / 16; g.lineTo(p.x + Math.cos(a) * rx * 0.82, p.y + Math.sin(a) * ry * 0.82); }
    g.strokePath();
    // tightening reticle
    const r = 0.45 + 0.25 * Math.min(1, left);
    g.lineStyle(2, blink ? 0xffffff : CRIMSON, 0.95).strokeEllipse(p.x, p.y, ctx.rx(r) * 2, ctx.ry(r) * 2, 24);
    const sp = ctx.now / 300;
    for (let i = 0; i < 4; i++) {
      const a = sp + (i * Math.PI) / 2;
      g.lineStyle(3, CRIMSON, 1).lineBetween(p.x + Math.cos(a) * ctx.rx(r + 0.15), p.y + Math.sin(a) * ctx.ry(r + 0.15), p.x + Math.cos(a) * ctx.rx(r - 0.15), p.y + Math.sin(a) * ctx.ry(r - 0.15));
    }
    // floating sigil: a crimson diamond with a violet halo and a white eye
    const sy = Math.round(p.y - 50 + Math.sin(ctx.now / 200) * 2), sx = Math.round(p.x);
    const k = 1 + (left < 0.7 && blink ? 0.25 : 0);
    g.fillStyle(SHADOW, 0.35).fillCircle(sx, sy, 9 * k);
    g.fillStyle(0x2a0410, 1).fillTriangle(sx, sy - 9 * k, sx - 6 * k, sy, sx + 6 * k, sy).fillTriangle(sx, sy + 9 * k, sx - 6 * k, sy, sx + 6 * k, sy);
    g.fillStyle(blink ? CRIMSON : BLOOD, 1).fillTriangle(sx, sy - 7 * k, sx - 4 * k, sy, sx + 4 * k, sy).fillTriangle(sx, sy + 7 * k, sx - 4 * k, sy, sx + 4 * k, sy);
    g.fillStyle(0xffffff, 1).fillRect(sx - 1, sy - 1, 2, 2);
    if (!ctx.reduced && Math.random() < 0.1) ctx.juice.bits('mote', sx, sy, 1, CRIMSON);
  },
}, { d_mark: CRIMSON, d_clone: SHADOW, d_smoke: SHADOW });

// ---------------------------------------------------------------- projectiles

registerProjectileFx({
  // A parried shot comes back as a spinning steel star with crimson tips and a glint trail.
  d_reflect: {
    key: 'fx:duelist:reflect', color: SILVER, scale: 1.2, additive: false, trail: 'star', trailMs: 40, spin: 900,
    end: (ctx, sx, sy) => { ctx.juice.starburst(sx, sy, 0xffffff, 0.8, 140); ctx.juice.sparksAt(sx, sy, 5, CRIMSON_HOT); },
  },
});

// ---------------------------------------------------------------- kills

registerKillFx({
  // A thin crossing cut and a spatter on every kill; crits flash white, elites and bosses bloom crimson.
  duelist: (ctx, k) => {
    const J = ctx.juice;
    const c = chestAt(ctx, k.x, k.y, 12);
    const a = Math.random() * 0.6 - 0.3;
    J.slash(c.x, c.y, -0.8 + a, 0xffffff, 0.7, { thin: true, ms: 160 });
    J.slash(c.x, c.y, 0.8 + a + Math.PI, CRIMSON, 0.7, { thin: true, ms: 160, flip: true });
    if (k.crit) J.starburst(c.x, c.y, 0xffffff, 1, 150);
    if (k.big || k.elite || k.boss) {
      J.starburst(c.x, c.y, CRIMSON, 1.4 + (k.boss ? 0.8 : 0), 220);
      J.bleed('player', c.x, c.y, k.boss ? 18 : 10);
      J.bits('star', c.x, c.y, 4, CRIMSON_HOT);
    }
  },
});
