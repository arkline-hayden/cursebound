import * as Phaser from 'phaser';
import type { SfxId } from '../../audio/AudioEngine';
import { iso } from '../iso';
import { registerHazardFx, registerKillFx, registerProjectileFx, registerSkillFx, type CastFx, type FxCtx, type SnapHazard } from './registry';
import { castFlash, chestAt, heroGhosts, killPop, upgradeScale, type Pal } from './spectacle';

// Artificer presentation (cosmetic only). Brass, teal arc-light, orange blasts, white steam and gear bits. Turrets,
// the drone, grenades, bomblets, mortar shells and mines are pixel sprites (art/fx/artificer.ts) that live while their
// hazard does; explosions and steam bursts are animated sheets.
// Sim conventions (simulation/src/classes/artificer.ts):
//   af_fx_blast: x,y centre, dx = radius, dy = style (0 grenade, 1 bomblet/cluster, 2 mortar, 3 turret self-destruct,
//                4 steam, 5 heavy shell, 6 firebomb, 7 rocket landing, 8 chain reaction)
//   af_fx_zap: x,y -> dx,dy;  af_fx_flame / af_fx_turret_shot: x,y turret, dx,dy direction
//   af_mortar_barrage: x,y caster, dx,dy barrage centre;  af_rocket_jump: x,y launch, dx,dy landing
//   af_grenade hazard: x,y landing, dx,dy throw dir, len throw distance, in = variant (+4 heavy), u-1 = detonation
//   (a grenade that lands with Proximity Mines turns into an af_mine with the same id)

const BRASS = 0xd8a850;
const BRASS_HOT = 0xfff2c0;
const BRASS_DK = 0x6a5232;
const TEAL = 0x5ae8d4;
const TEAL_HOT = 0xe0fff8;
const ARC = 0x8fe8ff;
const FIRE = 0xff7a2a;
const FIRE_HOT = 0xfff0a8;
const STEAM = 0xe8f4f4;
const SMOKE = 0x3a3230;

const TURRETP: Pal = { main: TEAL, hot: TEAL_HOT, deep: 0x0d3f4f, bits: 'gear' };
const FLAMEP: Pal = { main: FIRE, hot: FIRE_HOT, deep: 0x8a1e04 };
const ARCP: Pal = { main: ARC, hot: 0xffffff, deep: 0x1983c8, bits: 'zap' };
const BRASSP: Pal = { main: BRASS, hot: BRASS_HOT, deep: BRASS_DK, bits: 'gear' };
const STEAMP: Pal = { main: STEAM, hot: 0xffffff, deep: 0x5a7a80, bits: 'mote' };

const lastSfx = new Map<string, number>();
function sfx(ctx: FxCtx, id: SfxId, x: number, y: number, minGapMs: number, priority = 1) {
  const t = lastSfx.get(id) ?? -1e9;
  if (ctx.now - t < minGapMs) return;
  lastSfx.set(id, ctx.now);
  ctx.sfx(id, x, y, priority);
}

const has = (ctx: FxCtx, key: string) => ctx.scene.textures.exists(key);

// ---------------- one-shot sprites ----------------

interface ShotOpts { depth?: number; scale?: number; sx?: number; sy?: number; rot?: number; tint?: number; add?: boolean; alpha?: number; ox?: number; oy?: number; flip?: boolean; delay?: number }

/** Play a one-shot animated sheet at a screen point and destroy it when it ends. */
function shot(ctx: FxCtx, key: string, x: number, y: number, o: ShotOpts = {}) {
  if (!has(ctx, key) || !ctx.scene.anims.exists(key)) return null;
  const make = () => {
    const s = ctx.scene.add.sprite(Math.round(x), Math.round(y), key).setOrigin(o.ox ?? 0.5, o.oy ?? 0.5).setDepth(o.depth ?? 4648)
      .setScale(o.sx ?? o.scale ?? 1, o.sy ?? o.scale ?? 1).setRotation(o.rot ?? 0).setAlpha(o.alpha ?? 1).setFlipX(!!o.flip)
      .setBlendMode(o.add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    if (o.tint !== undefined) s.setTint(o.tint);
    s.play(key);
    s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
    return s;
  };
  if (o.delay) { ctx.scene.time.delayedCall(o.delay, make); return null; }
  return make();
}

/** A steam puff that drifts up (cosmetic, budgeted). */
function puff(ctx: FxCtx, x: number, y: number, scale = 1, delay = 0, drift = -14) {
  if (ctx.reduced) return;
  const s = shot(ctx, 'fx:artificer:puff', x, y, { scale, delay, depth: 4646, alpha: 0.9 });
  if (s) ctx.scene.tweens.add({ targets: s, y: y + drift, x: x + (Math.random() - 0.5) * 8, duration: 500, ease: 'Sine.easeOut' });
}

/** A ring of puffs billowing out along a world circle of radius R (steam blasts at their true radius). */
function steamRing(ctx: FxCtx, x: number, y: number, R: number, n: number) {
  if (ctx.reduced) return;
  const k = ctx.juice.budget(n);
  const p = ctx.P(x, y);
  for (let i = 0; i < k; i++) {
    const a = (i / k) * Math.PI * 2 + Math.random() * 0.4;
    const ex = p.x + Math.cos(a) * ctx.rx(R) * 0.9, ey = p.y + Math.sin(a) * ctx.ry(R) * 0.9;
    const s = shot(ctx, 'fx:artificer:puff', p.x, p.y - 4, { scale: 1.3 + Math.random() * 0.5, depth: 4646 });
    if (s) ctx.scene.tweens.add({ targets: s, x: ex, y: ey - 6, duration: 360, ease: 'Cubic.easeOut' });
  }
}

/** The brass deployment cog laid flat on the ground: spins up, swells and fades. */
function cog(ctx: FxCtx, sx: number, sy: number, radiusPx: number, ms = 700, tint?: number) {
  if (!has(ctx, 'fx:artificer:cog')) { ctx.juice.glyph(sx, sy, radiusPx, tint ?? BRASS, ms); return; }
  // keep the pixel cog crisp (at most ~2.4x); a wide area gets the generic glyph at its true radius around it
  if (radiusPx > 58) { ctx.juice.glyph(sx, sy, radiusPx, tint ?? BRASS, ms); radiusPx = 40; }
  const k = (radiusPx * 2) / 48;
  const s = ctx.scene.add.sprite(Math.round(sx), Math.round(sy), 'fx:artificer:cog').setDepth(-68).setScale(k * 0.4).setAlpha(0);
  if (tint !== undefined) s.setTint(tint);
  if (ctx.scene.anims.exists('fx:artificer:cog')) s.play('fx:artificer:cog');
  ctx.scene.tweens.add({ targets: s, alpha: 1, scale: k, duration: Math.min(200, ms * 0.3), ease: 'Back.easeOut' });
  ctx.scene.tweens.add({ targets: s, alpha: 0, scale: k * 1.1, duration: ms * 0.6, delay: ms * 0.4, ease: 'Quad.easeIn', onComplete: () => s.destroy() });
}

/** Fading parabola trail (rocket jump) between two world points. */
function arcStreak(ctx: FxCtx, x0: number, y0: number, x1: number, y1: number, color: number, width: number, lift = 14, ms = 260) {
  if (ctx.reduced) return;
  const a = ctx.P(x0, y0), b = ctx.P(x1, y1);
  const g = ctx.scene.add.graphics().setDepth(4645).setBlendMode(Phaser.BlendModes.ADD);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - lift - Math.hypot(b.x - a.x, b.y - a.y) * 0.25;
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(new Phaser.Math.Vector2((1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x, (1 - t) * (1 - t) * (a.y - lift) + 2 * (1 - t) * t * my + t * t * (b.y - lift)));
  }
  g.lineStyle(width + 4, SMOKE, 0.35).strokePoints(pts);
  g.lineStyle(width, color, 0.9).strokePoints(pts);
  g.lineStyle(Math.max(1, width / 3), 0xffffff, 0.95).strokePoints(pts);
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, onComplete: () => g.destroy() });
  for (let i = 1; i < 5; i++) { const q = pts[i * 3]!; puff(ctx, q.x, q.y, 0.8, i * 40, -6); }
}

// ---------------- persistent hazard sprites ----------------

interface View {
  kind: string;
  spr: Phaser.GameObjects.Sprite[];
  extra: Phaser.GameObjects.Image[];
  seen: number;
  x: number; y: number; t: number;
  pulse: number;
  recoil: number;       // screen recoil offset (turret shots), decays
  out: boolean;         // pop apart with a puff when the hazard ends
}
const views = new Map<number, View>();
let sweepScene: Phaser.Scene | null = null;

function killView(scene: Phaser.Scene, v: View, ctx?: FxCtx) {
  for (const s of v.spr) {
    if (v.out && s.active && ctx && !ctx.reduced) {
      puff(ctx, s.x, s.y - 10, 1.2);
      ctx.juice.bits('gear', s.x, s.y - 12, 4, BRASS);
    }
    s.destroy();
  }
  for (const e of v.extra) e.destroy();
}

let sweepCtx: FxCtx | null = null;
function ensureSweep(ctx: FxCtx) {
  sweepCtx = ctx;
  const scene = ctx.scene;
  if (sweepScene === scene) return;
  sweepScene = scene;
  const sweep = () => {
    const now = scene.time.now;
    for (const [id, v] of views) {
      if (now - v.seen < 150) continue;
      killView(scene, v, sweepCtx ?? undefined);
      views.delete(id);
    }
  };
  scene.events.on(Phaser.Scenes.Events.POST_UPDATE, sweep);
  const reset = () => {
    scene.events.off(Phaser.Scenes.Events.POST_UPDATE, sweep);
    for (const v of views.values()) { v.out = false; killView(scene, v); }
    views.clear(); sweepScene = null; sweepCtx = null;
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, reset);
  scene.events.once(Phaser.Scenes.Events.DESTROY, reset);
}

function viewOf(ctx: FxCtx, h: SnapHazard): View {
  ensureSweep(ctx);
  let v = views.get(h.i);
  if (v && v.kind !== h.k) { v.out = false; killView(ctx.scene, v); v = undefined; }   // grenade -> mine
  if (!v) { v = { kind: h.k, spr: [], extra: [], seen: ctx.now, x: h.x, y: h.y, t: ctx.now, pulse: -1, recoil: 0, out: false }; views.set(h.i, v); }
  v.seen = ctx.now;
  return v;
}

function smooth(ctx: FxCtx, v: View, x: number, y: number, k = 40) {
  const dt = Math.min(100, Math.max(0, ctx.now - v.t));
  v.t = ctx.now;
  if (Math.hypot(x - v.x, y - v.y) > 3) { v.x = x; v.y = y; return; }
  const a = 1 - Math.exp(-dt / k);
  v.x += (x - v.x) * a; v.y += (y - v.y) * a;
}

function newPulse(v: View, tick: number, start: number, period: number): boolean {
  if (tick < start) return false;
  const k = Math.floor((tick - start) / period);
  if (k === v.pulse) return false;
  v.pulse = k;
  return true;
}

/** Turret view nearest a world point (for recoil / zap origins), or undefined. */
function turretNear(x: number, y: number, kind?: string): View | undefined {
  let best: View | undefined, bd = 0.36;
  for (const v of views.values()) {
    if (kind ? v.kind !== kind : !(v.kind === 'af_turret' || v.kind === 'af_flame_turret' || v.kind === 'af_tesla_coil')) continue;
    const d = (v.x - x) ** 2 + (v.y - y) ** 2;
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

/** Direction frame (0..7, world angle k * 45 degrees) for a world vector. */
function dirFrame(dx: number, dy: number) {
  return ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
}

// ---------------- casts ----------------

const BLAST_PAL: Pal[] = [
  { main: 0xffa040, hot: FIRE_HOT, deep: 0x8a2408, bits: 'gear' },
  { main: 0xffc040, hot: FIRE_HOT, deep: 0x8a4408, bits: 'gear' },
  { main: FIRE, hot: FIRE_HOT, deep: 0x6a1a04, bits: 'gear' },
  { main: TEAL, hot: TEAL_HOT, deep: 0x0d3f4f, bits: 'gear' },
  STEAMP,
  { main: 0xff5a2a, hot: 0xffffff, deep: 0x4a1004, bits: 'gear' },
  { main: 0xff4a1a, hot: FIRE_HOT, deep: 0x6a1004 },
  STEAMP,
  { main: 0xffa040, hot: FIRE_HOT, deep: 0x8a2408, bits: 'gear' },
];

function blastFx(ctx: FxCtx, e: CastFx) {
  const J = ctx.juice;
  const R = e.dx || 1.5;
  const style = Math.round(e.dy) || 0;
  const pal = BLAST_PAL[style] ?? BLAST_PAL[0]!;
  const p = ctx.P(e.x, e.y);
  const rpx = ctx.rx(R);
  const steam = style === 4;
  const heavy = style === 5;
  const big = heavy || style === 2 || style === 3 || R >= 2.2;
  // the true radius, always
  J.shockwave(p.x, p.y, rpx, pal.main, steam ? 380 : 320);
  J.ring(p.x, p.y, rpx * 0.55, pal.hot, 200);
  if (steam) {
    shot(ctx, 'fx:artificer:steamboom', p.x, p.y - 8, { scale: Math.min(2.4, Math.max(1.2, rpx / 40)), depth: 4649 });
    steamRing(ctx, e.x, e.y, R, 8);
    J.bits('mote', p.x, p.y - 10, 10, STEAM, { speed: 1.4 });
    J.dust(p.x, p.y - 4, 6, 0xd0dcdc);
    ctx.dungeon.flashLight(p.x, p.y - 8, Math.max(130, rpx * 2.2), 0xd8f0f0, 2, 260);
    sfx(ctx, 'steam_vent', e.x, e.y, 70, ctx.mine ? 2 : 1);
    return;
  }
  const scale = heavy ? 2.4 : style === 1 || style === 8 ? Math.min(1.1, 0.6 + R * 0.25) : Math.min(2.2, Math.max(1, rpx / 36));
  shot(ctx, 'fx:artificer:boom', p.x, p.y - 14 * scale * 0.6, { scale, depth: 4653 });
  if (style === 7) { shot(ctx, 'fx:artificer:steamboom', p.x, p.y - 6, { scale: 1.6, depth: 4649 }); steamRing(ctx, e.x, e.y, R, 6); }
  J.starburst(p.x, p.y - 12, pal.hot, big ? 2 : 1.2);
  J.sparksAt(p.x, p.y - 10, big ? 16 : 7, 0xffd890);
  J.embersAt(p.x, p.y - 12, big ? 16 : 6, pal.main);
  if (pal.bits) J.bits(pal.bits, p.x, p.y - 12, big ? 9 : 4, BRASS, { speed: 1.4 });
  J.dust(p.x, p.y, big ? 10 : 4, 0x3a2a20);
  if (style !== 1 && style !== 8) ctx.dungeon.addDecal('scorch', p.x, p.y + 2, 0x1a1008, Math.max(0.7, R * (heavy ? 0.8 : 0.55)));
  if (big) J.shockwave(p.x, p.y, rpx * 1.15, pal.deep ?? pal.main, 440, 70);
  if (style === 3) { J.bits('zap', p.x, p.y - 14, 10, ARC, { speed: 1.3 }); J.sparksAt(p.x, p.y - 14, 12, TEAL); J.bits('gear', p.x, p.y - 14, 8, BRASS_HOT, { angle: -90, spread: 160, speed: 1.6 }); }
  if (style === 6) { J.bits('ice', p.x, p.y - 10, 8, 0xffc890); J.embersAt(p.x, p.y - 4, 20, 0xff5a1a); }
  if (style === 2) J.dust(p.x, p.y - 8, 6, 0x5a4a3a);
  if (ctx.rank(e.slot, 'af_concussive') > 0 && (style === 0 || style === 5 || style === 6 || style === 1)) J.bits('star', p.x, p.y - 22, big ? 6 : 3, 0xffe080, { angle: -90, spread: 120 });
  ctx.dungeon.flashLight(p.x, p.y - 8, Math.max(110, rpx * 2.4), pal.main, big ? 2.8 : 1.8, big ? 320 : 200);
  if (heavy) { J.pop(0xff7a2a, 0.16, 200); if (ctx.mine) J.hitStop(80); }
  else if (big && ctx.mine && style !== 2) J.hitStop(30);
  // grenades, shells and landings get the full explosion; bomblets and chain reactions a smaller flame whoomp
  if (style !== 8 && (big || R >= 1.6)) sfx(ctx, 'blast_fire', e.x, e.y, 70, big ? 2 : 1);
  else sfx(ctx, 'impact_fire', e.x, e.y, 70, 1);
}

function deployFx(ctx: FxCtx, e: CastFx, pal: Pal, kind: string) {
  const J = ctx.juice;
  const p = ctx.P(e.x, e.y);
  cog(ctx, p.x, p.y, 34, 800);
  J.shockwave(p.x, p.y, 30, pal.main, 300);
  // the turret drops in (see the hazard's drop tween); dust, gears and steam where it lands
  ctx.scene.time.delayedCall(170, () => {
    J.dust(p.x, p.y, 8, 0x5a4a38);
    J.ring(p.x, p.y, 26, BRASS, 260);
    J.sparksAt(p.x, p.y - 6, 10, BRASS);
    J.bits('gear', p.x, p.y - 10, 7, BRASS, { angle: -90, spread: 150, speed: 1.2 });
    puff(ctx, p.x - 10, p.y - 4, 1); puff(ctx, p.x + 10, p.y - 4, 1, 40);
    J.starburst(p.x, p.y - 16, pal.hot, 1);
    ctx.dungeon.flashLight(p.x, p.y - 12, 140, pal.main, 1.8, 280);
    if (kind === 'af_tesla_coil') {
      for (let i = 0; i < 3; i++) { const a = Math.random() * Math.PI * 2; ctx.bolt(e.x, e.y, e.x + Math.cos(a) * 1.4, e.y + Math.sin(a) * 1.4, ARC); }
      J.bits('zap', p.x, p.y - 30, 6, ARC);
    }
    if (kind === 'af_flame_turret') J.embersAt(p.x, p.y - 14, 10, FIRE);
  });
  // Turret Link: arcs between the new turret and its neighbours
  if (ctx.rank(e.slot, 'af_turret_link') > 0) {
    for (const v of views.values()) {
      if (!(v.kind === 'af_turret' || v.kind === 'af_flame_turret' || v.kind === 'af_tesla_coil')) continue;
      const d2 = (v.x - e.x) ** 2 + (v.y - e.y) ** 2;
      if (d2 > 36 || d2 < 0.04) continue;
      ctx.scene.time.delayedCall(220, () => ctx.bolt(v.x, v.y, e.x, e.y, TEAL));
    }
  }
  if (ctx.rank(e.slot, 'af_fortress_protocol') > 0) cog(ctx, p.x, p.y, ctx.rx(3.5), 900, TEAL);
  sfx(ctx, 'mech_deploy', e.x, e.y, 60, ctx.mine ? 2 : 1);
}

function overclockFx(ctx: FxCtx, e: CastFx, boiler: boolean) {
  const J = ctx.juice;
  const p = ctx.P(e.x, e.y);
  const k = upgradeScale(ctx, e.slot, ['af_steam_engine', 'af_perpetual_engine', 'af_aegis_protocol'], 1.75);
  cog(ctx, p.x, p.y, 30 * k, 900, boiler ? STEAM : undefined);
  castFlash(ctx, e.x, e.y, TURRETP, 1.4 * k, {});
  J.beam(p.x, p.y, 90 * k, 10, TEAL, 300);
  J.bits('gear', p.x, p.y - 20, 8 * k, BRASS, { angle: -90, spread: 120, speed: 1.3 });
  for (let i = 0; i < 4; i++) puff(ctx, p.x + (i % 2 ? 9 : -9), p.y - 24, 0.9, i * 70, -18);
  if (ctx.rank(e.slot, 'af_aegis_protocol') > 0) { J.ring(p.x, p.y - 14, 24, TEAL_HOT, 260); J.sparksAt(p.x, p.y - 18, 8, TEAL); }
  if (boiler) {
    shot(ctx, 'fx:artificer:steamboom', p.x, p.y - 8, { scale: 2.2, depth: 4649 });
    steamRing(ctx, e.x, e.y, 2.4, 10);
    J.shockwave(p.x, p.y, ctx.rx(2.4), STEAM, 420);
    J.pop(STEAM, 0.1, 200);
  }
  ctx.dungeon.flashLight(p.x, p.y - 16, 200, TEAL, 2.2, 400);
  if (ctx.mine) J.number(p.x, p.y - 34, 'OVERCLOCK', '#5ae8d4', 'sm');
  // the engine spinning up (Overclock's own vent arrives as a steam af_fx_blast; the boiler vents here)
  sfx(ctx, 'mech_deploy', e.x, e.y, 80, 2);
  if (boiler) sfx(ctx, 'steam_vent', e.x, e.y, 80, 1);
}

registerSkillFx({
  // ---- basic: Repeater (cheap; fires very often) ----
  af_repeater: (ctx, e) => {
    const J = ctx.juice;
    const u = ctx.U(e.dx, e.dy);
    const c = chestAt(ctx, e.x, e.y);
    const mx = c.x + u.x * 16, my = c.y + u.y * 10;
    J.orb(mx, my, BRASS, 0.25, 90, 1.5);
    J.sparksAt(mx, my, 2, BRASS_HOT);
    if (Math.random() < 0.3) J.bits('gear', c.x, c.y, 1, BRASS_DK, { angle: (Math.atan2(u.y, -u.x) * 180) / Math.PI - 60, spread: 30, speed: 0.6 });
    ctx.dungeon.flashLight(mx, my, 60, BRASS, 0.9, 70);
    sfx(ctx, 'gun_shot', e.x, e.y, 60, ctx.mine ? 1 : 0);
  },

  // ---- Turrets ----
  af_turret: (ctx, e) => deployFx(ctx, e, TURRETP, 'af_turret'),
  af_flame_turret: (ctx, e) => deployFx(ctx, e, FLAMEP, 'af_flame_turret'),
  af_tesla_coil: (ctx, e) => deployFx(ctx, e, ARCP, 'af_tesla_coil'),
  af_fx_turret_shot: (ctx, e) => {
    const u = ctx.U(e.dx, e.dy);
    const v = turretNear(e.x, e.y, 'af_turret');
    if (v) v.recoil = 3;
    const p = ctx.P(e.x, e.y);
    const mx = p.x + u.x * 12, my = p.y - 17 + u.y * 6;
    const k = upgradeScale(ctx, e.slot, ['af_calibrated'], 1.75);
    ctx.juice.orb(mx, my, TEAL, 0.22 * k, 90);
    ctx.juice.sparksAt(mx, my, 2, ctx.rank(e.slot, 'af_marking_rounds') > 0 ? 0xff6a4a : TEAL);
    sfx(ctx, 'gun_shot', e.x, e.y, 140, 0);
  },
  af_fx_flame: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const u = ctx.U(e.dx, e.dy);
    const tip = ctx.P(e.x + e.dx * 4, e.y + e.dy * 4);
    const L = Math.hypot(tip.x - p.x, tip.y - p.y);
    const nx = p.x + u.x * 11, ny = p.y - 15 + u.y * 6;
    if (!ctx.reduced) shot(ctx, 'fx:artificer:flamejet', nx, ny, { ox: 0, oy: 0.5, rot: Math.atan2(u.y, u.x), sx: L / 62, sy: Math.min(2.4, Math.max(1, L / 70)), add: true, depth: iso.depth(e.x + e.dx, e.y + e.dy) + 6 });
    const q = ctx.P(e.x + e.dx * 3.2, e.y + e.dy * 3.2);
    J.embersAt(q.x, q.y - 10, 3, FIRE);
    if (Math.random() < 0.3) J.dust(q.x, q.y - 12, 1, SMOKE);
    ctx.dungeon.flashLight((nx + q.x) / 2, (ny + q.y) / 2, 100, FIRE, 1.3, 160);
    sfx(ctx, 'skill_fireline', e.x, e.y, 450, 0);
  },
  // tesla chain links and drone zaps (frequent): bolt + a crisp spark
  af_fx_zap: (ctx, e) => {
    ctx.bolt(e.x, e.y, e.dx, e.dy, ARC);
    const t = chestAt(ctx, e.dx, e.dy);
    ctx.juice.starburst(t.x, t.y, 0xffffff, 0.6, 110);
    ctx.juice.sparksAt(t.x, t.y, 4, ARC);
    if (Math.random() < 0.5) ctx.juice.bits('zap', t.x, t.y, 1, ARC);
    const coil = turretNear(e.x, e.y, 'af_tesla_coil');
    if (coil) { const p = ctx.P(coil.x, coil.y); ctx.juice.orb(p.x, p.y - 34, ARC, 0.5, 140); }
    ctx.dungeon.flashLight(t.x, t.y, 80, ARC, 1.4, 120);
    sfx(ctx, 'skill_arc', e.dx, e.dy, 120, 0);
  },

  // ---- Ordnance ----
  af_grenade: (ctx, e) => throwFx(ctx, e),
  af_cluster_charge: (ctx, e) => throwFx(ctx, e),
  af_firebomb: (ctx, e) => throwFx(ctx, e),
  af_fx_blast: blastFx,
  af_mortar_barrage: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const t = ctx.P(e.dx, e.dy);
    // eight shells thump out of the launcher, one after another
    for (let i = 0; i < 8; i++) {
      ctx.scene.time.delayedCall(i * 70, () => {
        J.orb(p.x, p.y - 26, FIRE, 0.45, 120);
        J.sparksAt(p.x, p.y - 26, 3, FIRE_HOT);
        puff(ctx, p.x + (Math.random() - 0.5) * 8, p.y - 28, 0.9, 0, -20);
        ctx.dungeon.flashLight(p.x, p.y - 24, 110, FIRE, 1.4, 90);
        if (i === 4) ctx.sfx('gun_shot', e.x, e.y, 1);   // second thump of the volley (unthrottled: ctx.now is stale here)
      });
    }
    J.dust(p.x, p.y, 8, 0x5a4a38);
    J.bits('gear', p.x, p.y - 20, 6, BRASS, { angle: -90, spread: 90 });
    // the target zone: a brass ranging cog and the true footprint
    cog(ctx, t.x, t.y, ctx.rx(3.6), 1500, 0xffa060);
    J.shockwave(t.x, t.y, ctx.rx(3.6), 0xff5a2a, 700);
    J.pop(FIRE, 0.08, 160);
    sfx(ctx, 'gun_shot', e.x, e.y, 80, 2);
  },

  // ---- Clockwork ----
  af_overclock: (ctx, e) => overclockFx(ctx, e, false),
  af_boiler_overdrive: (ctx, e) => overclockFx(ctx, e, true),
  af_rocket_jump: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    arcStreak(ctx, e.x, e.y, e.dx, e.dy, FIRE, 4, 14, 420);
    shot(ctx, 'fx:artificer:flamejet', p.x, p.y - 6, { ox: 0, oy: 0.5, rot: Math.PI / 2, sx: 0.5, sy: 1.1, add: true, depth: 4650 });
    J.embersAt(p.x, p.y - 6, 18, FIRE);
    J.bits('gear', p.x, p.y - 8, 5, BRASS, { angle: -90, spread: 120 });
    J.dust(p.x, p.y, 10, 0xd0dcdc);
    heroGhosts(ctx, e.slot, e.dx - e.x, e.dy - e.y, FIRE, 4, 10);
    ctx.dungeon.addDecal('scorch', p.x, p.y + 2, 0x1a1008, 0.9);
    sfx(ctx, 'cast_fire', e.x, e.y, 80, 2);   // rocket ignition (the launch vent is a steam af_fx_blast)
  },
});

function throwFx(ctx: FxCtx, e: CastFx) {
  const u = ctx.U(e.dx, e.dy);
  const c = chestAt(ctx, e.x, e.y, 18);
  ctx.juice.slash(c.x + u.x * 6, c.y + u.y * 4, Math.atan2(u.y, u.x) - 0.6, BRASS, 0.6, { thin: true, ms: 140 });
  ctx.juice.sparksAt(c.x + u.x * 10, c.y - 4, 2, FIRE_HOT);
  sfx(ctx, 'throw_whoosh', e.x, e.y, 60, ctx.mine ? 1 : 0);
}

/** Styled teleport ('rocket', Rocket Jump landing): x,y = destination, dx,dy = origin. */
registerSkillFx({
  'teleport:rocket': (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.dust(p.x, p.y, 10, 0xd0dcdc);
    ctx.juice.embersAt(p.x, p.y - 6, 10, FIRE);
    ctx.juice.bits('gear', p.x, p.y - 6, 4, BRASS);
    puff(ctx, p.x - 12, p.y - 2, 1.2); puff(ctx, p.x + 12, p.y - 2, 1.2, 30);
    ctx.dungeon.addDecal('scorch', p.x, p.y + 2, 0x1a1008, 1.2);
    ctx.dungeon.flashLight(p.x, p.y - 8, 130, FIRE, 1.6, 200);
  },
});

// ---------------- hazards (ground layer + sprites) ----------------

function lifeRing(g: Phaser.GameObjects.Graphics, x: number, y: number, h: SnapHazard, tick: number, color: number) {
  const frac = Math.max(0, Math.min(1, (h.u - tick) / Math.max(1, h.u - h.b)));
  g.lineStyle(2, BRASS_DK, 0.6).strokeEllipse(x, y, 26, 12, 20);
  g.lineStyle(2, color, 0.75).beginPath();
  g.arc(x, y, 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false);
  g.strokePath();
}

const TURRET_KEY: Record<string, string> = { af_turret: 'fx:artificer:turret', af_flame_turret: 'fx:artificer:flamer', af_tesla_coil: 'fx:artificer:tesla' };
const TURRET_ACCENT: Record<string, number> = { af_turret: TEAL, af_flame_turret: FIRE, af_tesla_coil: ARC };

function drawTurret(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const accent = TURRET_ACCENT[h.k]!;
  const key = TURRET_KEY[h.k]!;
  const v = viewOf(ctx, h);
  v.out = true;
  v.x = h.x; v.y = h.y;
  const p = ctx.P(h.x, h.y);
  const tesla = h.k === 'af_tesla_coil';
  if (!v.spr.length && has(ctx, key)) {
    const s = ctx.scene.add.sprite(0, 0, key).setOrigin(0.5, tesla ? 38 / 42 : 26 / 30);
    if (tesla && ctx.scene.anims.exists(key)) s.play(key);
    ctx.dungeon.litObject(s);
    v.spr.push(s);
    const gl = !ctx.reduced && has(ctx, 'light:soft') ? ctx.scene.add.image(0, 0, 'light:soft').setBlendMode(Phaser.BlendModes.ADD).setTint(accent).setAlpha(0.25).setScale(tesla ? 0.3 : 0.18) : null;
    if (gl) v.extra.push(gl);
    if (tick - h.b < 12) {   // dropped in from above
      s.setData('drop', 1);
      s.y = p.y - 60;
      ctx.scene.tweens.add({ targets: s, y: p.y, duration: 170, ease: 'Quad.easeIn', onComplete: () => s.setData('drop', 0) });
    }
  }
  const s = v.spr[0];
  const left = h.u - tick;
  const warn = left < 60 && Math.floor(ctx.now / (left < 25 ? 70 : 140)) % 2 === 0;
  if (s) {
    if (!tesla) s.setFrame(dirFrame(h.dx, h.dy));
    v.recoil *= 0.8;
    const u = ctx.U(h.dx, h.dy);
    if (!s.getData('drop')) s.setPosition(Math.round(p.x - u.x * v.recoil), Math.round(p.y - u.y * v.recoil * 0.5));
    s.setDepth(iso.depth(h.x, h.y));
    if (warn) s.setTintFill(0xff6a4a); else s.clearTint();
  }
  const gl = v.extra[0];
  if (gl) gl.setPosition(p.x, p.y - (tesla ? 34 : 14)).setDepth(iso.depth(h.x, h.y) + 1).setAlpha(0.22 + 0.08 * Math.sin(ctx.now / (tesla ? 60 : 160)));
  // ground: range footprint, life ring
  g.fillStyle(accent, 0.035).fillEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 40);
  g.lineStyle(1, accent, 0.16).strokeEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 40);
  lifeRing(g, p.x, p.y, h, tick, warn ? 0xff6a4a : accent);
  if (h.k === 'af_flame_turret' && !ctx.reduced && Math.random() < 0.06) ctx.juice.dust(p.x + 4, p.y - 24, 1, SMOKE);
  if (tesla && !ctx.reduced && Math.random() < 0.05) ctx.juice.bits('zap', p.x, p.y - 34, 1, ARC);
}

function lobPos(ctx: FxCtx, h: SnapHazard, prog: number) {
  const ox = h.x - h.dx * h.len, oy = h.y - h.dy * h.len;
  const wx = ox + (h.x - ox) * prog, wy = oy + (h.y - oy) * prog;
  const ground = ctx.P(wx, wy);
  const lift = 14 + 4 * prog * (1 - prog) * (24 + h.len * 7);
  return { gx: ground.x, gy: ground.y, x: ground.x, y: ground.y - lift, wx, wy };
}

const GRENADE_KEY = ['fx:artificer:grenade', 'fx:artificer:cluster', 'fx:artificer:firebomb', 'fx:artificer:grenade'];
const GRENADE_COL = [BRASS, 0xe0c040, 0xff5a2a, BRASS];

function drawGrenade(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const land = h.u - 1;
  const prog = Math.max(0, Math.min(1, (tick - h.b) / Math.max(1, land - h.b)));
  const variant = h.in & 3, heavy = h.in >= 4;
  const color = heavy ? 0xff5a2a : GRENADE_COL[variant]!;
  const t = ctx.P(h.x, h.y);
  // landing footprint at the true radius, tightening as it falls
  const blink = prog > 0.65 && Math.floor(ctx.now / 70) % 2 === 0;
  g.fillStyle(color, 0.06 + 0.16 * prog).fillEllipse(t.x, t.y, ctx.rx(h.r * prog) * 2, ctx.ry(h.r * prog) * 2, 32);
  g.lineStyle(heavy ? 2 : 1.5, blink ? 0xffffff : color, 0.45 + 0.45 * prog).strokeEllipse(t.x, t.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 32);
  const q = lobPos(ctx, h, prog);
  g.fillStyle(0x000000, 0.3).fillEllipse(q.gx, q.gy, heavy ? 16 : 10, heavy ? 7 : 5);
  const v = viewOf(ctx, h);
  const key = heavy ? 'fx:artificer:heavy' : GRENADE_KEY[variant]!;
  if (!v.spr.length && has(ctx, key)) v.spr.push(ctx.scene.add.sprite(0, 0, key));
  const s = v.spr[0];
  if (s) s.setPosition(Math.round(q.x), Math.round(q.y)).setRotation((ctx.now / 1000) * (heavy ? 6 : 14)).setDepth(iso.depth(q.wx, q.wy) + 8).setScale(heavy ? 1.3 : 1);
  else g.fillStyle(color, 1).fillCircle(q.x, q.y, heavy ? 6 : 3.5);
  if (!ctx.reduced && Math.random() < 0.5) {
    if (variant === 2) ctx.juice.embersAt(q.x, q.y, 1, FIRE);
    else ctx.juice.sparksAt(q.x, q.y - 3, 1, FIRE_HOT);
    if (Math.random() < 0.3) ctx.juice.dust(q.x, q.y, 1, variant === 0 ? 0xd0dcdc : SMOKE);
  }
}

function drawBomblet(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const land = h.u - 1;
  const prog = Math.max(0, Math.min(1, (tick - h.b) / Math.max(1, land - h.b)));
  const ox = h.x - h.dx * h.len, oy = h.y - h.dy * h.len;
  const wx = ox + (h.x - ox) * prog, wy = oy + (h.y - oy) * prog;
  const gp = ctx.P(wx, wy);
  const y = gp.y - 6 - Math.sin(prog * Math.PI) * 18;
  const t = ctx.P(h.x, h.y);
  g.lineStyle(1, 0xffc040, 0.3 + 0.5 * prog).strokeEllipse(t.x, t.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 24);
  g.fillStyle(0x000000, 0.3).fillEllipse(gp.x, gp.y, 8, 4);
  const v = viewOf(ctx, h);
  if (!v.spr.length && has(ctx, 'fx:artificer:bomblet')) { const s = ctx.scene.add.sprite(0, 0, 'fx:artificer:bomblet'); if (ctx.scene.anims.exists('fx:artificer:bomblet')) s.play('fx:artificer:bomblet'); v.spr.push(s); }
  const s = v.spr[0];
  if (s) s.setPosition(Math.round(gp.x), Math.round(y)).setDepth(iso.depth(wx, wy) + 8);
  else g.fillStyle(0xffc040, 1).fillCircle(gp.x, y, 2.5);
}

function drawShell(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const p = ctx.P(h.x, h.y);
  const land = h.u - 1;
  const prog = Math.max(0, Math.min(1, (tick - h.b) / Math.max(1, land - h.b)));
  const blink = prog > 0.7 && Math.floor(ctx.now / 70) % 2 === 0;
  g.lineStyle(2, blink ? 0xffffff : 0xff6a2a, 0.9).strokeEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 32);
  g.fillStyle(0xff4a1a, 0.1 + 0.28 * prog).fillEllipse(p.x, p.y, ctx.rx(h.r * prog) * 2, ctx.ry(h.r * prog) * 2, 32);
  const cr = ctx.rx(0.45);
  g.lineStyle(1, 0xffb070, 0.8).lineBetween(p.x - cr, p.y, p.x + cr, p.y).lineBetween(p.x, p.y - cr * 0.5, p.x, p.y + cr * 0.5);
  const v = viewOf(ctx, h);
  const fall = (1 - prog) * 170;
  if (prog > 0.3) {
    if (!v.spr.length && has(ctx, 'fx:artificer:shell')) { const s = ctx.scene.add.sprite(0, 0, 'fx:artificer:shell').setOrigin(0.5, 1); if (ctx.scene.anims.exists('fx:artificer:shell')) s.play('fx:artificer:shell'); v.spr.push(s); }
    const s = v.spr[0];
    if (s) s.setPosition(Math.round(p.x), Math.round(p.y - fall - 4)).setDepth(iso.depth(h.x, h.y) + 20);
    else g.fillStyle(0x2a2420, 1).fillCircle(p.x, p.y - fall - 6, 4);
    g.fillStyle(0x000000, 0.12 + 0.25 * prog).fillEllipse(p.x, p.y, 6 + 10 * prog, 3 + 5 * prog);
    if (!ctx.reduced && Math.random() < 0.35) ctx.juice.dust(p.x, p.y - fall - 22, 1, SMOKE);
  }
}

function drawMine(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const p = ctx.P(h.x, h.y);
  const armed = tick >= h.b + 24;
  const v = viewOf(ctx, h);
  v.out = true;
  if (!v.spr.length && has(ctx, 'fx:artificer:mine')) {
    const s = ctx.scene.add.sprite(0, 0, 'fx:artificer:mine').setOrigin(0.5, 0.6);
    ctx.dungeon.litObject(s);
    v.spr.push(s);
    ctx.juice.dust(p.x, p.y, 3, 0x5a4a38);
    ctx.juice.bits('gear', p.x, p.y - 4, 2, BRASS);
  }
  const on = armed ? Math.floor(ctx.now / 120) % 2 === 0 : Math.floor(ctx.now / 260) % 2 === 0;
  const s = v.spr[0];
  if (s) s.setPosition(Math.round(p.x), Math.round(p.y)).setDepth(iso.depth(h.x, h.y) - 1).setFrame(on ? 1 : 0);
  else g.fillStyle(0x2a2826, 1).fillEllipse(p.x, p.y, 14, 7);
  if (armed) {
    g.lineStyle(1, 0xff2a2a, on ? 0.35 : 0.18).strokeEllipse(p.x, p.y, ctx.rx(1.2) * 2, ctx.ry(1.2) * 2, 24);
    if (on) g.fillStyle(0xff2a2a, 0.12).fillEllipse(p.x, p.y, 22, 10, 16);
  }
}

function drawFire(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const p = ctx.P(h.x, h.y);
  const age = (tick - h.b) / Math.max(1, h.u - h.b);
  const a = 0.3 * (1 - age * 0.6);
  g.fillStyle(0xff5a1a, a).fillEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 32);
  g.fillStyle(0xffb040, a * 0.6).fillEllipse(p.x, p.y, ctx.rx(h.r * 0.55) * 2, ctx.ry(h.r * 0.55) * 2, 24);
  g.lineStyle(1, 0xffa040, 0.5 * (1 - age)).strokeEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 32);
  const v = viewOf(ctx, h);
  if (!v.spr.length && !ctx.reduced && has(ctx, 'fx:flame')) {
    ctx.dungeon.addDecal('scorch', p.x, p.y + 2, 0x1a1008, h.r * 0.7);
    const n = Math.max(4, Math.min(8, Math.round(h.r * 3)));
    for (let i = 0; i < n; i++) {
      const s = ctx.scene.add.sprite(0, 0, 'fx:flame').setOrigin(0.5, 0.85).setBlendMode(Phaser.BlendModes.ADD);
      if (ctx.scene.anims.exists('fx:flame')) s.play({ key: 'fx:flame', startFrame: i % 4 });
      s.setData('a', (i / n) * Math.PI * 2 + i * 0.7).setData('r', i === 0 ? 0 : 0.35 + ((i * 37) % 10) / 10 * 0.55);
      v.spr.push(s);
    }
  }
  for (const s of v.spr) {
    const ang = s.getData('a') as number, rr = (s.getData('r') as number) * h.r;
    const wx = h.x + Math.cos(ang) * rr, wy = h.y + Math.sin(ang) * rr;
    const q = ctx.P(wx, wy);
    s.setPosition(Math.round(q.x), Math.round(q.y)).setDepth(iso.depth(wx, wy)).setAlpha(Math.max(0.2, 1 - age * 0.8)).setScale(0.7 + 0.15 * Math.sin(ctx.now / 150 + ang));
  }
  if (!ctx.reduced && Math.random() < 0.25) {
    const r = Math.random() * h.r, ang = Math.random() * Math.PI * 2;
    ctx.juice.embersAt(p.x + Math.cos(ang) * ctx.rx(r), p.y + Math.sin(ang) * ctx.ry(r) - 4, 1, FIRE);
  }
}

function drawBoiler(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const v = viewOf(ctx, h);
  smooth(ctx, v, h.x, h.y, 35);
  const p = ctx.P(v.x, v.y);
  const age = (tick - h.b) / Math.max(1, h.u - h.b);
  const a = 0.24 * (1 - age * 0.5);
  g.fillStyle(STEAM, a * 0.6).fillEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 36);
  for (let i = 0; i < 6; i++) {
    const ang = ctx.now / 420 + i * 1.047;
    const rr = h.r * 0.55;
    g.fillStyle(i % 2 ? STEAM : 0xbfe8e0, a).fillEllipse(p.x + Math.cos(ang) * ctx.rx(rr), p.y + Math.sin(ang) * ctx.ry(rr) - 4, ctx.rx(h.r * 0.6), ctx.ry(h.r * 0.6), 20);
  }
  g.lineStyle(2, TEAL, 0.45).strokeEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 36);
  // scald pulse every 0.4s, in step with the damage ticks
  const ph = ((tick - h.b) % 24) / 24;
  g.lineStyle(2, 0xffffff, 0.6 * (1 - ph)).strokeEllipse(p.x, p.y, ctx.rx(h.r * (0.4 + 0.6 * ph)) * 2, ctx.ry(h.r * (0.4 + 0.6 * ph)) * 2, 32);
  if (newPulse(v, tick, h.b, 24) && !ctx.reduced) ctx.juice.bits('mote', p.x, p.y - 10, 3, STEAM, { speed: 1.2 });
  // billowing puffs
  if (!ctx.reduced && Math.random() < 0.3 * Math.min(1, ctx.particles || 1)) {
    const ang = Math.random() * Math.PI * 2, rr = (0.3 + Math.random() * 0.7) * h.r;
    puff(ctx, p.x + Math.cos(ang) * ctx.rx(rr), p.y + Math.sin(ang) * ctx.ry(rr) - 6, 1.1 + Math.random() * 0.6, 0, -16);
  }
}

function drawDrone(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard) {
  const v = viewOf(ctx, h);
  smooth(ctx, v, h.x, h.y, 30);
  const p = ctx.P(v.x, v.y);
  const bob = Math.sin(ctx.now / 180 + h.in) * 2;
  if (!v.spr.length && has(ctx, 'fx:artificer:drone')) {
    const s = ctx.scene.add.sprite(0, 0, 'fx:artificer:drone').setOrigin(0.5, 0.6);
    if (ctx.scene.anims.exists('fx:artificer:drone')) s.play({ key: 'fx:artificer:drone', startFrame: h.in % 4 });
    v.spr.push(s);
    const gl = !ctx.reduced && has(ctx, 'light:soft') ? ctx.scene.add.image(0, 0, 'light:soft').setBlendMode(Phaser.BlendModes.ADD).setTint(TEAL).setAlpha(0.2).setScale(0.14) : null;
    if (gl) v.extra.push(gl);
  }
  const y = p.y - 30 + bob;
  g.fillStyle(0x000000, 0.25).fillEllipse(p.x, p.y, 12, 5);
  const s = v.spr[0];
  if (s) s.setPosition(Math.round(p.x), Math.round(y)).setDepth(iso.depth(v.x, v.y) + 30);
  else { g.fillStyle(BRASS, 1).fillCircle(p.x, y, 5); g.fillStyle(TEAL, 1).fillCircle(p.x, y, 2); }
  v.extra[0]?.setPosition(p.x, y).setDepth(iso.depth(v.x, v.y) + 29);
}

registerHazardFx({
  af_turret: drawTurret,
  af_flame_turret: drawTurret,
  af_tesla_coil: drawTurret,
  af_shell: drawShell,
  af_grenade: drawGrenade,
  af_bomblet: drawBomblet,
  af_mine: drawMine,
  af_fire: drawFire,
  af_boiler: drawBoiler,
  af_drone: drawDrone,
}, { af_turret: TEAL, af_flame_turret: FIRE, af_tesla_coil: ARC, af_fire: 0xff6a2a, af_boiler: 0xd8f0f0 });

registerProjectileFx({
  af_bolt: {
    key: 'fx:artificer:bolt', color: 0xffc860, additive: false, trail: 'mote', trailMs: 60,
    end: (ctx, sx, sy) => { ctx.juice.sparksAt(sx, sy, 3, BRASS_HOT); if (Math.random() < 0.25) ctx.juice.bits('gear', sx, sy, 1, BRASS); },
  },
  af_turret_bolt: {
    key: 'fx:artificer:tbolt', color: TEAL, additive: true, trail: 'mote', trailMs: 55,
    end: (ctx, sx, sy) => { ctx.juice.sparksAt(sx, sy, 3, TEAL); ctx.juice.starburst(sx, sy, TEAL_HOT, 0.5, 100); },
  },
});

// ---------------- on-kill flourish: gears and a burst of steam ----------------

registerKillFx({
  artificer: (ctx, k) => {
    const c = chestAt(ctx, k.x, k.y, 12);
    killPop(ctx, k.x, k.y, k.dtype === 'storm' ? ARCP : k.dtype === 'ember' ? { ...BRASSP, main: FIRE } : BRASSP, k.big, k.elite);
    if (k.big || k.elite || Math.random() < 0.4) puff(ctx, c.x, c.y, k.big ? 1.3 : 1, 0, -18);
    if (k.elite || k.boss) {
      const p = ctx.P(k.x, k.y);
      cog(ctx, p.x, p.y, k.boss ? 70 : 42, 900);
      shot(ctx, 'fx:artificer:boom', p.x, p.y - 16, { scale: k.boss ? 2 : 1.3, depth: 4653 });
      ctx.juice.bits('gear', c.x, c.y, k.boss ? 16 : 8, BRASS_HOT, { angle: -90, spread: 160, speed: 1.5 });
      if (ctx.mine && k.boss) ctx.juice.pop(BRASS, 0.12, 200);
    }
  },
});
