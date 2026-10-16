import * as Phaser from 'phaser';
import type { SfxId } from '../../audio/AudioEngine';
import { SKILL_FILE } from '../../audio/fileCues';
import { ACTOR_IDS, ACTOR_META, animFor, type ActorId, type ActorState } from '../../art/actors';
import { iso, isoPoly } from '../iso';
import { fileSfx, skillLayer, skillSfx } from './kit3';
import { registerHazardFx, registerKillFx, registerProjectileFx, registerSkillFx, type CastFx, type FxCtx, type SnapHazard } from './registry';
import { castFlash, chestAt, heroGhosts, impactBurst, killPop, type Pal } from './spectacle';

// Warden presentation (cosmetic only). Moss, bark and spectral teal-green spirits; thorns are pale bone, venom a toxic
// lime, healing a soft green with pink blooms. Pixel textures live in art/fx/warden.ts (fx:warden:*).
// Sim conventions (packages/simulation/src/classes/warden.ts):
//   casts at a target point (x,y = target): w_entangle, w_verdant_totem, w_ursine_call, w_thorn_pod, w_alpha_land,
//     w_pod_burst, w_bloodroot, w_sprout, w_venom_bloom, w_wolf_pounce (dx,dy = leap direction), w_thorn_nova
//   casts with a target point in dx,dy: w_thorn_lash (x,y Warden -> dx,dy enemy), w_contagion (corpse -> enemy)
//   other casts: x,y caster, dx,dy aim (w_alpha_pounce: dx,dy = leap direction; w_ursa_swipe: x,y the Ursa)
//   hazards: w_wolf / w_ursa (beasts: dx,dy facing, sp speed, len leap ticks left, w last bite tick, in variant,
//     out frenzy), w_stampede, w_roots, w_worldroot, w_root (vines while tick < out), w_totem, w_bramble, w_pod
//     (detonates at out), w_aura (in thorn armor 0/1/2, out Barkskin, len Feral Shift).
// Beasts are pooled sprites keyed by hazard id: created on first sight, swept when their id stops appearing.

const MOSS = 0x6b8f3a;
const LEAF = 0x9ad86a;
const SPIRIT = 0x9affc8;
const SPIRIT_HOT = 0xeafff6;
const BARK = 0x6a4a2a;
const BARK_LT = 0xb08850;
const THORN = 0xd8c890;
const VENOM = 0x9ef04a;
const HEAL = 0x8fe07a;
const BLOOM = 0xff9ad0;
const BLOOD = 0xc0303a;

const GROVEP: Pal = { main: 0x7ad84a, hot: 0xeaffc8, deep: 0x2a4a14, bits: 'leaf' };
const HEALP: Pal = { main: HEAL, hot: 0xf0fff0, deep: 0x2a5a2a, bits: 'leaf' };
const BEASTP: Pal = { main: SPIRIT, hot: SPIRIT_HOT, deep: 0x1a6a5a, bits: 'mote' };
const THORNP: Pal = { main: THORN, hot: 0xfff8d8, deep: 0x5a3a1a, bits: 'thorn' };
const VENOMP: Pal = { main: VENOM, hot: 0xf0ffc0, deep: 0x2a4a10, bits: 'bubble' };

const DEG = 180 / Math.PI;

const lastSfx = new Map<string, number>();
function sfx(ctx: FxCtx, id: SfxId, x: number, y: number, minGapMs = 0, priority = 1) {
  const t = lastSfx.get(id) ?? -1e9;
  if (ctx.now - t < minGapMs) return;
  lastSfx.set(id, ctx.now);
  ctx.sfx(id, x, y, priority);
}

/** 8-way screen facing for a world direction (matches CombatScene). */
function dir8(wx: number, wy: number): number {
  const v = iso.dir(wx, wy);
  const x = v.x, y = v.y;
  if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) return 2;
  const T = 0.41421356, ax = Math.abs(x), ay = Math.abs(y);
  if (ay <= ax * T) return x > 0 ? 0 : 4;
  if (ax <= ay * T) return y > 0 ? 2 : 6;
  if (x > 0) return y > 0 ? 1 : 7;
  return y > 0 ? 3 : 5;
}

const hasActor = (id: string): id is ActorId => (ACTOR_IDS as readonly string[]).includes(id);
/** Dedicated spirit sprites when present; a tinted Ghoul Hound stands in otherwise. */
const wolfActor = (): ActorId => (hasActor('spiritwolf') ? 'spiritwolf' : 'pursuer') as ActorId;
const bearActor = (): ActorId => (hasActor('spiritbear') ? 'spiritbear' : 'pursuer') as ActorId;
const elkActor = (): ActorId => (hasActor('spiritelk') ? 'spiritelk' : hasActor('prismstag') ? 'prismstag' : 'pursuer') as ActorId;

/** Wild Growth enlarges root patches x1.15 per rank (radius, or width for Worldroot). */
const growth = (ctx: FxCtx, slot: number) => Math.pow(1.15, ctx.rank(slot, 'w_wild_growth'));

/** Screen length of a world distance `d` along (dx, dy). */
function scrLen(ctx: FxCtx, dx: number, dy: number, d: number) {
  const a = ctx.P(0, 0), b = ctx.P(dx * d, dy * d);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// ---------------- pooled one-shot sprites (spikes, thrusts, spirit heads) ----------------

const fxPool = new Map<string, Phaser.GameObjects.Sprite[]>();
let liveFx = 0;
function grab(ctx: FxCtx, key: string, x: number, y: number): Phaser.GameObjects.Sprite | null {
  if (ctx.reduced || liveFx > 90 || !ctx.scene.textures.exists(key)) return null;
  const list = fxPool.get(key);
  let s: Phaser.GameObjects.Sprite | undefined;
  while (list?.length) { const c = list.pop()!; if (c.scene === ctx.scene) { s = c; break; } }
  s ??= ctx.scene.add.sprite(0, 0, key);
  liveFx++;
  return s.setActive(true).setVisible(true).setPosition(x, y).setAlpha(1).setScale(1).setRotation(0).setOrigin(0.5, 0.5)
    .setFlip(false, false).clearTint().setBlendMode(Phaser.BlendModes.NORMAL).setDepth(4650).setFrame(0);
}
function release(key: string, s: Phaser.GameObjects.Sprite) {
  liveFx = Math.max(0, liveFx - 1);
  if (!s.scene) return;
  s.anims.stop();
  s.setActive(false).setVisible(false);
  let list = fxPool.get(key);
  if (!list) { list = []; fxPool.set(key, list); }
  if (list.length < 40) list.push(s); else s.destroy();
}
interface FxOpts { rot?: number; sx?: number; sy?: number; tint?: number; add?: boolean; depth?: number; ox?: number; oy?: number; flip?: boolean; fadeMs?: number }
/** Play an animated sheet once (then fade `fadeMs` if given) and recycle it. */
function playFx(ctx: FxCtx, key: string, x: number, y: number, o: FxOpts = {}) {
  const s = grab(ctx, key, x, y);
  if (!s) return null;
  s.setRotation(o.rot ?? 0).setScale(o.sx ?? 1, o.sy ?? o.sx ?? 1).setOrigin(o.ox ?? 0.5, o.oy ?? 0.5).setDepth(o.depth ?? 4650).setFlipX(!!o.flip);
  if (o.tint !== undefined) s.setTint(o.tint);
  if (o.add) s.setBlendMode(Phaser.BlendModes.ADD);
  const done = () => {
    if (o.fadeMs) ctx.scene.tweens.add({ targets: s, alpha: 0, scaleY: s.scaleY * 0.4, duration: o.fadeMs, ease: 'Quad.easeIn', onComplete: () => release(key, s) });
    else release(key, s);
  };
  if (ctx.scene.anims.exists(key)) { s.play(key); s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, done); }
  else ctx.scene.tweens.add({ targets: s, alpha: 0, duration: 220, onComplete: () => release(key, s) });
  return s;
}

/** Spikes (root or thorn) erupting from the ground in a ring of world radius R around (x, y), staggered outward. */
function spikeRing(ctx: FxCtx, x: number, y: number, R: number, n: number, key: 'fx:warden:rootspike' | 'fx:warden:thornspike', tint?: number, scale = 1, stagger = 0) {
  if (ctx.reduced) return;
  const k = Math.max(1, Math.min(n, ctx.juice.budget(n)));
  const rot = Math.random() * Math.PI * 2;
  for (let i = 0; i < k; i++) {
    const a = rot + (i / k) * Math.PI * 2;
    const r = R * (0.8 + Math.random() * 0.3);
    const wx = x + Math.cos(a) * r, wy = y + Math.sin(a) * r;
    const fire = () => {
      const p = ctx.P(wx, wy);
      playFx(ctx, key, Math.round(p.x), Math.round(p.y), { oy: 0.92, sx: scale * (0.85 + Math.random() * 0.3), tint, depth: iso.depth(wx, wy) + 1, flip: Math.random() < 0.5, fadeMs: 220 });
    };
    if (stagger > 0) ctx.scene.time.delayedCall(i * stagger, fire); else fire();
  }
}

/** A spectral head (wolf or bear) rising and dissolving above a screen point. */
function spiritRise(ctx: FxCtx, sx: number, sy: number, key: 'fx:warden:wolfspirit' | 'fx:warden:bearspirit', scale = 1, ms = 620) {
  const s = grab(ctx, key, sx, sy);
  if (!s) return;
  s.setBlendMode(Phaser.BlendModes.ADD).setDepth(4663).setScale(scale * 0.6).setAlpha(0);
  ctx.scene.tweens.add({ targets: s, alpha: 0.85, scale: scale, duration: 140, ease: 'Back.easeOut' });
  ctx.scene.tweens.add({ targets: s, alpha: 0, y: sy - 26, scale: scale * 1.25, delay: 160, duration: ms - 160, ease: 'Quad.easeIn', onComplete: () => release(key, s) });
}

/** Lofted arc between two screen points (thrown seeds and pods) with bits along it. */
function lob(ctx: FxCtx, ax: number, ay: number, bx: number, by: number, color: number, kind: 'leaf' | 'thorn' | 'mote' | 'bubble', ms = 260) {
  const mx = (ax + bx) / 2, my = (ay + by) / 2 - Math.max(18, Math.hypot(bx - ax, by - ay) * 0.35);
  if (!ctx.reduced) {
    const g = ctx.scene.add.graphics().setDepth(4645).setBlendMode(Phaser.BlendModes.ADD);
    let px = ax, py = ay;
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      const x = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * mx + t * t * bx, y = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * my + t * t * by;
      g.lineStyle(3, color, 0.25 + 0.5 * t).lineBetween(px, py, x, y);
      g.lineStyle(1, 0xffffff, 0.4 + 0.6 * t).lineBetween(px, py, x, y);
      px = x; py = y;
    }
    ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, ease: 'Quad.easeIn', onComplete: () => g.destroy() });
  }
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    ctx.juice.bits(kind, (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * mx + t * t * bx, (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * my + t * t * by, 1, color);
  }
}

function handOf(ctx: FxCtx, slot: number, x: number, y: number) {
  const s = ctx.actorSprite?.(slot);
  if (s && s.active) return { x: s.x, y: s.y - 18 };
  return chestAt(ctx, x, y, 18);
}

// ---------------- pooled objects keyed by hazard id ----------------

interface View {
  sprites: Phaser.GameObjects.Sprite[];
  extra: Phaser.GameObjects.GameObject[];
  lastSeen: number;
  firstSeen: number;
  firstTick: number;
  x: number; y: number;      // smoothed world position
  lastT: number;
  leapMax: number;
  anims: string[];
  pulse: number;
  spikes: number;
  done: boolean;
  dissolve: number;          // colour for the parting puff (0 = none)
}
const views = new Map<number, View>();
let sweeperScene: Phaser.Scene | null = null;

function destroyView(v: View) {
  v.sprites.forEach((s) => s.destroy());
  v.extra.forEach((o) => o.destroy());
}

function ensureSweeper(scene: Phaser.Scene) {
  if (sweeperScene === scene) return;
  sweeperScene = scene;
  const sweep = () => {
    const now = scene.time.now;
    for (const [id, v] of views) {
      if (now - v.lastSeen < 160) continue;
      if (v.dissolve && v.sprites[0]?.active) {
        const s = v.sprites[0];
        scene.tweens.add({ targets: s, alpha: 0, scaleX: s.scaleX * 1.2, scaleY: s.scaleY * 0.6, duration: 220, onComplete: () => s.destroy() });
        v.sprites.shift();
      }
      destroyView(v);
      views.delete(id);
    }
  };
  scene.events.on(Phaser.Scenes.Events.POST_UPDATE, sweep);
  const reset = () => {
    scene.events.off(Phaser.Scenes.Events.POST_UPDATE, sweep);
    for (const v of views.values()) destroyView(v);
    views.clear(); sweeperScene = null; fxPool.clear(); liveFx = 0;
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, reset);
  scene.events.once(Phaser.Scenes.Events.DESTROY, reset);
}

function viewFor(ctx: FxCtx, h: SnapHazard, tick: number): { v: View; fresh: boolean } {
  ensureSweeper(ctx.scene);
  let v = views.get(h.i);
  const fresh = !v;
  if (!v) {
    v = { sprites: [], extra: [], lastSeen: ctx.now, firstSeen: ctx.now, firstTick: tick, x: h.x, y: h.y, lastT: ctx.now, leapMax: 0, anims: [], pulse: -1, spikes: 0, done: false, dissolve: 0 };
    views.set(h.i, v);
  }
  v.lastSeen = ctx.now;
  return { v, fresh };
}

function actorSprite(ctx: FxCtx, actor: ActorId, lit: boolean): Phaser.GameObjects.Sprite {
  const meta = ACTOR_META[actor];
  const s = ctx.scene.add.sprite(0, 0, `actor:${actor}`).setOrigin(meta.originX, meta.originY);
  if (lit) ctx.dungeon.litObject(s);
  return s;
}

function playAnim(ctx: FxCtx, v: View, i: number, actor: ActorId, state: ActorState, dir: number) {
  const s = v.sprites[i];
  const a = animFor(actor, state, dir);
  s.setFlipX(a.flipX);
  if (v.anims[i] !== a.key && ctx.scene.anims.exists(a.key)) { v.anims[i] = a.key; s.play(a.key, true); }
}

/** Exponential smoothing toward the authoritative position (snapshots arrive at 20 Hz). */
function smooth(ctx: FxCtx, v: View, x: number, y: number, fast: boolean) {
  const dt = Math.min(100, Math.max(0, ctx.now - v.lastT));
  v.lastT = ctx.now;
  // snap instead of gliding across a jump (summon_blink leash; walking and leaping beasts stay well under 2 tiles)
  if (Math.hypot(x - v.x, y - v.y) > 2) { v.x = x; v.y = y; return; }
  const k = 1 - Math.exp(-dt / (fast ? 28 : 55));
  v.x += (x - v.x) * k; v.y += (y - v.y) * k;
}

function ell(ctx: FxCtx, g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, fill: number | null, alpha: number, stroke?: number, lw = 2, strokeAlpha = 1) {
  const p = ctx.P(x, y);
  if (fill !== null) g.fillStyle(fill, alpha).fillEllipse(p.x, p.y, ctx.rx(r) * 2, ctx.ry(r) * 2, 36);
  if (stroke !== undefined) g.lineStyle(lw, stroke, strokeAlpha).strokeEllipse(p.x, p.y, ctx.rx(r) * 2, ctx.ry(r) * 2, 36);
}

function quad(x: number, y: number, dx: number, dy: number, len: number, w: number) {
  const px = -dy * (w / 2), py = dx * (w / 2);
  return isoPoly([
    { x: x + px, y: y + py }, { x: x + dx * len + px, y: y + dy * len + py },
    { x: x + dx * len - px, y: y + dy * len - py }, { x: x - px, y: y - py },
  ]);
}

/** Deterministic pseudo-random in [0,1) for stable cosmetic scatter per hazard. */
function hash01(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rootSprites(ctx: FxCtx, v: View, n: number, place: (i: number) => [number, number], scale: number, alpha = 1, key = 'fx:root') {
  if (ctx.reduced || !ctx.scene.textures.exists(key)) return;
  while (v.sprites.length < n) v.sprites.push(ctx.scene.add.sprite(0, 0, key).setDepth(-74).setOrigin(0.5, 0.85));
  v.sprites.forEach((s, i) => {
    const [x, y] = place(i);
    const p = ctx.P(x, y);
    s.setPosition(Math.round(p.x), Math.round(p.y)).setScale(scale * (0.8 + hash01(i, 7) * 0.4)).setAlpha(alpha).setFlipX(hash01(i, 3) > 0.5);
  });
}

/** Ellipse arc from 12 o'clock covering `prog` (0..1) of the turn (countdowns). */
function arcProgress(ctx: FxCtx, g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, prog: number, color: number, alpha: number, lw = 2) {
  const p = ctx.P(x, y);
  const rx = ctx.rx(r), ry = ctx.ry(r);
  const n = Math.max(1, Math.ceil(28 * prog));
  g.lineStyle(lw, color, alpha);
  let px = p.x, py = p.y - ry;
  for (let i = 1; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * prog * Math.PI * 2;
    const nx = p.x + Math.cos(a) * rx, ny = p.y + Math.sin(a) * ry;
    g.lineBetween(px, py, nx, ny);
    px = nx; py = ny;
  }
}

// ---------------- beasts ----------------

function drawBeast(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const bear = h.in === 2;
  const dire = h.in === 1;
  const actor = bear ? bearActor() : wolfActor();
  const { v, fresh } = viewFor(ctx, h, tick);
  v.dissolve = SPIRIT;
  if (!v.sprites.length) {
    const s = actorSprite(ctx, actor, true);
    const custom = actor !== 'pursuer';
    s.setScale(custom ? (dire ? 1.15 : 1) : bear ? 1.9 : dire ? 1.2 : 0.95);
    if (!custom) s.setTint(bear ? 0x9ae8b0 : SPIRIT);
    v.sprites.push(s);
    const glow = ctx.scene.textures.exists('light:soft')
      ? ctx.scene.add.image(0, 0, 'light:soft').setBlendMode(Phaser.BlendModes.ADD).setTint(SPIRIT).setAlpha(0.22).setScale(bear ? 0.5 : 0.28)
      : null;
    if (glow) v.extra.push(glow);
    v.pulse = h.w;
    if (fresh && tick - h.b < 12) {
      // summoned: a spirit column, a ring and motes; the beast fades in out of the light
      const p = ctx.P(h.x, h.y);
      ctx.juice.beam(p.x, p.y, bear ? 130 : 70, bear ? 24 : 12, SPIRIT, bear ? 420 : 300);
      ctx.juice.shockwave(p.x, p.y, bear ? ctx.rx(1.4) : ctx.rx(0.6), SPIRIT, 320);
      ctx.juice.bits('mote', p.x, p.y - 12, bear ? 14 : 6, SPIRIT);
      ctx.juice.bits('leaf', p.x, p.y - 8, bear ? 6 : 2, LEAF);
      s.setAlpha(0);
      ctx.scene.tweens.add({ targets: s, alpha: 0.92, duration: 260 });
    }
  }
  const leaping = h.len > 0;
  if (leaping) v.leapMax = Math.max(v.leapMax, h.len); else v.leapMax = 0;
  smooth(ctx, v, h.x, h.y, leaping);
  const p = ctx.P(v.x, v.y);
  const prog = leaping && v.leapMax > 0 ? 1 - h.len / v.leapMax : 0;
  const lift = leaping ? Math.sin(Math.min(1, prog + 0.15) * Math.PI) * (bear ? 10 : 16) : 0;
  const s = v.sprites[0];
  const biting = tick - h.w < (bear ? 18 : 12);
  const state: ActorState = biting ? 'attack' : leaping || h.sp > 0.4 ? 'run' : 'idle';
  playAnim(ctx, v, 0, actor, state, dir8(h.dx, h.dy));
  s.setPosition(Math.round(p.x), Math.round(p.y - lift)).setDepth(iso.depth(v.x, v.y));
  // expiring beasts flicker; frenzied beasts burn hotter
  const left = h.u - tick;
  if (s.alpha > 0.85 || left < 60) s.setAlpha(left < 60 ? (Math.floor(ctx.now / 90) % 2 ? 0.35 : 0.8) : 0.92);
  if (actor === 'pursuer') s.setTint(h.out ? 0xd8ffa0 : bear ? 0x9ae8b0 : SPIRIT);
  const glow = v.extra[0] as Phaser.GameObjects.Image | undefined;
  glow?.setPosition(p.x, p.y - 12 - lift).setDepth(iso.depth(v.x, v.y) - 1).setAlpha(h.out ? 0.4 + 0.08 * Math.sin(ctx.now / 80) : 0.22);
  // a wolf bite rakes spectral claws (the Ursa's swipe has its own cast)
  if (!bear && h.w !== v.pulse && tick - h.w < 4) {
    v.pulse = h.w;
    const u = ctx.U(h.dx || 1, h.dy);
    ctx.juice.claw(p.x + u.x * 12, p.y - 10 + u.y * 6, Math.atan2(u.y, u.x) + Math.PI / 2, h.out ? 0xd8ffa0 : SPIRIT, dire ? 0.8 : 0.6, 170);
    fileSfx(ctx, SKILL_FILE.w_wolf_bite, null, h.x, h.y, 90, 1);   // snarl + snap; one key shared by all wolves, >= 90 ms apart
  }
  // ground mark (readable spirit footprint) and shadow
  ell(ctx, g, v.x, v.y, (bear ? 0.95 : dire ? 0.5 : 0.38) * (leaping ? 0.7 : 1), 0x000000, 0.35);
  ell(ctx, g, v.x, v.y, bear ? 1.0 : 0.42, null, 0, h.out ? 0xd8ffa0 : SPIRIT, 1, 0.45);
  if (leaping && !ctx.reduced && Math.random() < 0.5) ctx.juice.afterimage(s, SPIRIT);
  if (!ctx.reduced) {
    if (Math.random() < (h.out ? 0.12 : 0.035)) ctx.juice.bits('mote', p.x + (Math.random() - 0.5) * 12, p.y - 10 - lift, 1, h.out ? 0xd8ffa0 : SPIRIT);
    if (h.sp > 3 && Math.random() < 0.08) ctx.juice.dust(p.x, p.y, 1, 0x3a4a30);
  }
}

function drawStampede(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const { v, fresh } = viewFor(ctx, h, tick);
  const actor = elkActor();
  const lanes: [number, number][] = [[-0.38, 0.55], [-0.19, 0.15], [0, 0], [0.19, 0.25], [0.38, 0.65]];
  if (!v.sprites.length) {
    for (let i = 0; i < lanes.length; i++) {
      const s = actorSprite(ctx, actor, false).setBlendMode(Phaser.BlendModes.ADD).setTint(SPIRIT).setAlpha(0.85);
      s.setScale(actor === 'prismstag' ? 0.42 : actor === 'pursuer' ? 1.3 : 1);
      v.sprites.push(s);
    }
    if (fresh) v.firstTick = tick;
  }
  const front = Math.min(h.len, h.sp * ((ctx.now - v.firstSeen) / 1000 + Math.max(0, v.firstTick - h.b) / 60));
  const done = front >= h.len - 1e-3;
  const fade = done ? Math.max(0, 1 - (ctx.now - v.firstSeen - (h.len / h.sp) * 1000) / 250) : 1;
  // the full lane stays faintly outlined so everyone can read where the herd runs
  g.lineStyle(1, SPIRIT, 0.22 * fade).strokePoints(quad(h.x, h.y, h.dx, h.dy, h.len, h.w), true);
  // trampled lane behind the herd
  g.fillStyle(MOSS, 0.18 * fade).fillPoints(quad(h.x, h.y, h.dx, h.dy, front, h.w), true);
  g.lineStyle(2, SPIRIT, 0.55 * fade).strokePoints(quad(h.x, h.y, h.dx, h.dy, front, h.w), true);
  const px = -h.dy, py = h.dx;
  // hoofprints churned into the ground behind the front
  const prints = Math.floor(front / 0.45);
  for (let i = 0; i < prints; i++) {
    const along = i * 0.45 + 0.2, side = (hash01(h.i, i) - 0.5) * h.w * 0.85;
    const q = ctx.P(h.x + h.dx * along + px * side, h.y + h.dy * along + py * side);
    g.fillStyle(0x1a2410, 0.5 * fade).fillRect(Math.round(q.x) - 1, Math.round(q.y), 3, 1);
    g.fillStyle(SPIRIT, 0.25 * fade).fillRect(Math.round(q.x), Math.round(q.y) - 1, 1, 1);
  }
  // the spirit wave front across the lane
  if (!done) {
    const fx = h.x + h.dx * front, fy = h.y + h.dy * front;
    const l = ctx.P(fx + px * h.w * 0.5, fy + py * h.w * 0.5), r = ctx.P(fx - px * h.w * 0.5, fy - py * h.w * 0.5);
    g.lineStyle(4, SPIRIT, 0.35).lineBetween(l.x, l.y, r.x, r.y);
    g.lineStyle(1, 0xffffff, 0.9).lineBetween(l.x, l.y, r.x, r.y);
    if (!ctx.reduced) {
      const t = Math.random() - 0.5;
      const q = ctx.P(fx + px * h.w * t, fy + py * h.w * t);
      if (Math.random() < 0.45) ctx.juice.dust(q.x, q.y, 1, 0x4a5a3a);
      if (Math.random() < 0.25) ctx.juice.bits(Math.random() < 0.5 ? 'leaf' : 'mote', q.x, q.y - 6, 1, Math.random() < 0.5 ? LEAF : SPIRIT);
    }
  } else if (!v.done) {
    // the herd breaks at the end of the lane in a burst of spirit light
    v.done = true;
    const e = ctx.P(h.x + h.dx * h.len, h.y + h.dy * h.len);
    ctx.juice.shockwave(e.x, e.y, ctx.rx(h.w * 0.6), SPIRIT, 360);
    ctx.juice.bits('mote', e.x, e.y - 14, 10, SPIRIT);
    ctx.juice.bits('leaf', e.x, e.y - 8, 6, LEAF);
    ctx.dungeon.flashLight(e.x, e.y - 14, 200, SPIRIT, 2, 300);
  }
  const dir = dir8(h.dx, h.dy);
  v.sprites.forEach((s, i) => {
    const [side, back] = lanes[i];
    const f = Math.max(0, front - back);
    const wx = h.x + h.dx * f + px * side * h.w, wy = h.y + h.dy * f + py * side * h.w;
    const p = ctx.P(wx, wy);
    const bob = Math.abs(Math.sin(ctx.now / 70 + i * 1.3)) * 4;
    s.setPosition(Math.round(p.x), Math.round(p.y - bob)).setDepth(iso.depth(wx, wy)).setAlpha(0.85 * fade);
    playAnim(ctx, v, i, actor, 'run', dir);
    if (!ctx.reduced && !done && Math.random() < 0.25) ctx.juice.dust(p.x, p.y, 1, 0x4a5a3a);
    if (!ctx.reduced && !done && Math.random() < 0.18) ctx.juice.afterimage(s, SPIRIT, 0.35, 240);
  });
}

// ---------------- ground hazards ----------------

function drawPatch(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const { v } = viewFor(ctx, h, tick);
  const grow = Math.min(1, (ctx.now - v.firstSeen) / 220 + (v.firstTick > h.b + 3 ? 1 : 0));
  const left = h.u - tick;
  const a = left < 30 ? left / 30 : 1;
  const pulse = (tick - h.b) % 30 < 4;
  if (h.len > 0) {
    const qd = quad(h.x, h.y, h.dx, h.dy, h.len, h.w);
    g.fillStyle(0x1e2e12, 0.45 * a).fillPoints(qd, true);
    g.fillStyle(0x3a5a1e, 0.18 * a).fillPoints(quad(h.x, h.y, h.dx, h.dy, h.len, h.w * 0.55), true);
    g.lineStyle(2, pulse ? LEAF : MOSS, 0.9 * a).strokePoints(qd, true);
    const n = Math.max(2, Math.round(h.len / 0.9));
    rootSprites(ctx, v, n, (i) => { const t = (i + 0.5) / n; const s = (hash01(h.i, i) - 0.5) * h.w * 0.6; return [h.x + h.dx * h.len * t - h.dy * s, h.y + h.dy * h.len * t + h.dx * s]; }, 0.8, a);
  } else {
    const r = h.r * (0.3 + 0.7 * grow);
    ell(ctx, g, h.x, h.y, r, 0x1e2e12, 0.42 * a);
    ell(ctx, g, h.x, h.y, r * 0.62, 0x3a5a1e, 0.18 * a);
    ell(ctx, g, h.x, h.y, r, null, 0, pulse ? LEAF : MOSS, 2, 0.9 * a);
    ell(ctx, g, h.x, h.y, r * 0.66, null, 0, BARK_LT, 1, 0.35 * a);
    const n = Math.max(3, Math.round(h.r * 2.2));
    rootSprites(ctx, v, n, (i) => { const ang = hash01(h.i, i) * Math.PI * 2; const d = Math.sqrt(hash01(i, h.i)) * r * 0.85; return [h.x + Math.cos(ang) * d, h.y + Math.sin(ang) * d]; }, 0.75 * (0.5 + 0.5 * grow), a);
  }
  // each 0.5s pulse: a ring (circle) or a ripple of leaves (line) so the damage tick reads
  if (pulse && v.pulse !== Math.floor((tick - h.b) / 30) && !ctx.reduced) {
    v.pulse = Math.floor((tick - h.b) / 30);
    if (h.len > 0) {
      const a0 = ctx.P(h.x, h.y), a1 = ctx.P(h.x + h.dx * h.len, h.y + h.dy * h.len);
      ctx.juice.bitsAlong('leaf', a0.x, a0.y - 4, a1.x, a1.y - 4, 3, LEAF);
    } else {
      const c = ctx.P(h.x, h.y);
      ctx.juice.ring(c.x, c.y, ctx.rx(h.r) * 0.95, LEAF, 280);
      ctx.juice.embersAt(c.x, c.y - 4, 2, LEAF);
    }
  }
  if (!ctx.reduced && Math.random() < 0.03) {
    const c = ctx.P(h.len > 0 ? h.x + h.dx * h.len * Math.random() : h.x, h.len > 0 ? h.y + h.dy * h.len * Math.random() : h.y);
    ctx.juice.bits('leaf', c.x + (Math.random() - 0.5) * 20, c.y - 4, 1, LEAF);
  }
}

function drawWorldroot(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const { v } = viewFor(ctx, h, tick);
  const eruptTicks = Math.ceil((h.len / h.sp) * 60);
  const age = (ctx.now - v.firstSeen) / 1000 * 60 + Math.max(0, v.firstTick - h.b);
  const front = Math.min(h.len, h.sp * (age / 60));
  // roots rip up the ground: spikes erupt every 0.7 units behind the front (kept even after the patch takes over)
  const step = 0.7;
  while ((v.spikes + 1) * step <= front + 1e-3 && v.spikes < 24) {
    v.spikes++;
    const along = v.spikes * step;
    const side = (hash01(h.i, v.spikes) - 0.5) * h.w * 0.6;
    const wx = h.x + h.dx * along - h.dy * side, wy = h.y + h.dy * along + h.dx * side;
    const p = ctx.P(wx, wy);
    playFx(ctx, 'fx:warden:rootspike', Math.round(p.x), Math.round(p.y), { oy: 0.92, sx: (0.9 + h.w * 0.15) * (0.85 + hash01(v.spikes, 9) * 0.3), depth: iso.depth(wx, wy) + 1, flip: hash01(v.spikes, 4) > 0.5, fadeMs: 260 });
    ctx.juice.dust(p.x, p.y, 2, 0x4a3a28);
    if (v.spikes % 2 === 0) ctx.juice.bits('leaf', p.x, p.y - 10, 2, LEAF);
    if (v.spikes % 3 === 0) ctx.juice.bits('thorn', p.x, p.y - 6, 2, BARK_LT);
  }
  if (age >= eruptTicks) { drawPatch(ctx, g, h, tick); return; }
  const qd = quad(h.x, h.y, h.dx, h.dy, front, h.w);
  g.fillStyle(0x2a3a1a, 0.5).fillPoints(qd, true);
  g.lineStyle(3, LEAF, 1).strokePoints(qd, true);
  // the full eruption line, faint, so the path reads ahead of the front
  g.lineStyle(1, LEAF, 0.3).strokePoints(quad(h.x, h.y, h.dx, h.dy, h.len, h.w), true);
  const tip = ctx.P(h.x + h.dx * front, h.y + h.dy * front);
  if (!ctx.reduced) { ctx.juice.dust(tip.x, tip.y, 2, 0x4a3a28); if (Math.random() < 0.5) ctx.juice.sparksAt(tip.x, tip.y - 6, 2, LEAF); }
  const n = Math.max(2, Math.round(front / 0.9));
  rootSprites(ctx, v, n, (i) => { const t = (i + 0.5) / n; return [h.x + h.dx * front * t, h.y + h.dy * front * t]; }, 0.9);
}

function drawRootMarker(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const { v, fresh } = viewFor(ctx, h, tick);
  const holding = tick < h.out;
  if (fresh && holding && tick - h.b < 6) {
    // vines snatch the enemy's feet
    const p = ctx.P(h.x, h.y);
    ctx.juice.dust(p.x, p.y, 3, 0x3a5a2a);
    ctx.juice.bits('leaf', p.x, p.y - 6, 3, LEAF);
    playFx(ctx, 'fx:warden:rootspike', Math.round(p.x + 6), Math.round(p.y + 1), { oy: 0.92, sx: 0.55, depth: iso.depth(h.x, h.y) + 3, fadeMs: 200 });
    playFx(ctx, 'fx:warden:rootspike', Math.round(p.x - 6), Math.round(p.y + 1), { oy: 0.92, sx: 0.5, depth: iso.depth(h.x, h.y) + 3, flip: true, fadeMs: 200 });
  }
  if (!holding) { v.sprites.forEach((s) => s.setVisible(false)); return; }
  const r = Math.max(0.45, h.r + 0.15);
  const wob = Math.sin(ctx.now / 120 + h.i) * 0.04;
  ell(ctx, g, h.x, h.y, r + wob, 0x1a2a10, 0.35, MOSS, 2, 1);
  ell(ctx, g, h.x, h.y, r * 0.7, null, 0, BARK_LT, 1, 0.7);
  // a few leaves on the binding ring
  const p = ctx.P(h.x, h.y);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + h.i;
    g.fillStyle(LEAF, 0.9).fillRect(Math.round(p.x + Math.cos(a) * ctx.rx(r)) - 1, Math.round(p.y + Math.sin(a) * ctx.ry(r)) - 1, 2, 2);
  }
  rootSprites(ctx, v, 2, (i) => [h.x + (i ? 0.18 : -0.18) * r, h.y + (i ? -0.1 : 0.1) * r], 0.7 + r * 0.25);
  v.sprites.forEach((s, i) => s.setDepth(iso.depth(h.x, h.y) + 2 + i).setVisible(true));
}

function drawTotem(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const { v, fresh } = viewFor(ctx, h, tick);
  const p = ctx.P(h.x, h.y);
  if (!v.sprites.length && ctx.scene.textures.exists('fx:warden:totem')) {
    const s = ctx.scene.add.sprite(0, 0, 'fx:warden:totem').setOrigin(0.5, 0.96);
    if (ctx.scene.anims.exists('fx:warden:totem')) s.play('fx:warden:totem');
    ctx.dungeon.litObject(s);
    v.sprites.push(s);
    if (fresh) {
      s.setScale(1, 0.1);
      ctx.scene.tweens.add({ targets: s, scaleY: 1, duration: 300, ease: 'Back.easeOut' });
      ctx.juice.beam(p.x, p.y, 120, 18, HEAL, 420);
      ctx.juice.bits('leaf', p.x, p.y - 40, 8, BLOOM);
    }
    const glow = ctx.scene.textures.exists('light:soft') ? ctx.scene.add.image(0, 0, 'light:soft').setBlendMode(Phaser.BlendModes.ADD).setTint(HEAL).setAlpha(0.3).setScale(0.45) : null;
    if (glow) v.extra.push(glow);
  }
  v.sprites[0]?.setPosition(Math.round(p.x), Math.round(p.y)).setDepth(iso.depth(h.x, h.y));
  (v.extra[0] as Phaser.GameObjects.Image | undefined)?.setPosition(p.x, p.y - 44).setDepth(iso.depth(h.x, h.y) + 1).setAlpha(0.22 + 0.1 * Math.sin(ctx.now / 200));
  // heal radius: a soft disc, a readable rim and a ripple travelling out each second
  const phase = ((tick - h.b) % 60) / 60;
  ell(ctx, g, h.x, h.y, h.r, HEAL, 0.07, HEAL, 1, 0.55);
  ell(ctx, g, h.x, h.y, h.r * phase, null, 0, HEAL, 2, 0.6 * (1 - phase));
  ell(ctx, g, h.x, h.y, h.r * 0.25, BLOOM, 0.08);
  const k = Math.floor((tick - h.b - 1) / 60);
  if (k !== v.pulse && tick > h.b) {
    v.pulse = k;
    ctx.juice.ring(p.x, p.y, ctx.rx(h.r), HEAL, 420);
    ctx.juice.bits('mote', p.x, p.y - 30, 6, HEAL, { angle: -90, spread: 120 });
    ctx.juice.bits('leaf', p.x, p.y - 44, 2, BLOOM);
  }
  if (!ctx.reduced && Math.random() < 0.12) {
    const t = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random());
    ctx.juice.bits('mote', p.x + Math.cos(t) * ctx.rx(h.r) * r, p.y + Math.sin(t) * ctx.ry(h.r) * r, 1, HEAL);
  }
}

function drawBramble(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const { v } = viewFor(ctx, h, tick);
  const left = h.u - tick;
  const a = left < 30 ? left / 30 : 1;
  const grow = Math.min(1, (ctx.now - v.firstSeen) / 220);
  const qd = quad(h.x, h.y, h.dx, h.dy, h.len, h.w * grow);
  g.fillStyle(0x2a2414, 0.55 * a).fillPoints(qd, true);
  g.lineStyle(2, BARK_LT, a).strokePoints(qd, true);
  const useArt = !ctx.reduced && ctx.scene.textures.exists('fx:warden:bramble');
  const n = Math.round(h.len * 2.2);
  if (useArt) {
    if (!v.sprites.length) {
      for (let i = 0; i < n; i++) {
        const s = ctx.scene.add.sprite(0, 0, 'fx:warden:bramble', i % 3).setOrigin(0.5, 0.8).setFlipX(hash01(h.i, i) > 0.5);
        ctx.dungeon.litObject(s);
        v.sprites.push(s);
      }
    }
    v.sprites.forEach((s, i) => {
      const t = (i + 0.5) / n;
      const side = (hash01(i, h.i) - 0.5) * h.w * 0.5;
      const wx = h.x + h.dx * h.len * t - h.dy * side, wy = h.y + h.dy * h.len * t + h.dx * side;
      const p = ctx.P(wx, wy);
      const sway = Math.sin(ctx.now / 300 + i) * 0.04;
      s.setPosition(Math.round(p.x), Math.round(p.y)).setDepth(iso.depth(wx, wy)).setScale(0.95 + hash01(i, 5) * 0.3, (0.9 + hash01(i, 6) * 0.3) * grow).setRotation(sway).setAlpha(a);
    });
  } else {
    // fallback: thorn spikes along both edges
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const side = i % 2 ? 1 : -1;
      const bx = h.x + h.dx * h.len * t - h.dy * side * h.w * 0.45, by = h.y + h.dy * h.len * t + h.dx * side * h.w * 0.45;
      const b = ctx.P(bx, by);
      const hgt = (8 + hash01(h.i, i) * 8) * grow;
      g.fillStyle(i % 3 ? THORN : BARK_LT, a).fillTriangle(b.x - 2, b.y, b.x + 2, b.y, b.x + (hash01(i, h.i) - 0.5) * 4, b.y - hgt);
    }
  }
  // each 0.5s pulse flicks thorns off the wall
  const k = Math.floor((tick - h.b) / 30);
  if (k !== v.pulse && !ctx.reduced) {
    v.pulse = k;
    const a0 = ctx.P(h.x, h.y), a1 = ctx.P(h.x + h.dx * h.len, h.y + h.dy * h.len);
    ctx.juice.bitsAlong('thorn', a0.x, a0.y - 8, a1.x, a1.y - 8, 4, THORN);
    if (k % 2 === 0) ctx.juice.bitsAlong('bubble', a0.x, a0.y - 6, a1.x, a1.y - 6, 2, VENOM);
  }
}

function drawPod(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const { v } = viewFor(ctx, h, tick);
  const total = Math.max(1, h.out - h.b);
  const prog = Math.max(0, Math.min(1, (tick - h.b) / total));
  const blink = prog > 0.6 && Math.floor(ctx.now / 70) % 2 === 0;
  // the detonation footprint with a fill swelling to the edge and a countdown arc
  ell(ctx, g, h.x, h.y, h.r, VENOM, 0.06 + 0.1 * prog, blink ? 0xffffff : THORN, 2, 0.9);
  ell(ctx, g, h.x, h.y, h.r * prog, VENOM, 0.16);
  arcProgress(ctx, g, h.x, h.y, h.r * 0.35, prog, VENOM, 0.9, 2);
  const p = ctx.P(h.x, h.y);
  const bob = Math.round(Math.sin(ctx.now / 90) * (prog > 0.6 ? 1.5 : 0.5));
  if (ctx.scene.textures.exists('fx:warden:pod')) {
    if (!v.sprites.length) {
      const s = ctx.scene.add.sprite(0, 0, 'fx:warden:pod').setOrigin(0.5, 0.8);
      if (ctx.scene.anims.exists('fx:warden:pod')) s.play('fx:warden:pod');
      ctx.dungeon.litObject(s);
      v.sprites.push(s);
    }
    v.sprites[0]!.setPosition(Math.round(p.x), Math.round(p.y) + bob).setDepth(iso.depth(h.x, h.y)).setScale(1 + prog * 0.35).setRotation(ctx.now / 400);
  } else {
    const pr = 5 + prog * 3;
    g.fillStyle(0x3a4a1a, 1).fillCircle(p.x, p.y - 6, pr);
    g.fillStyle(VENOM, 0.9).fillCircle(p.x - 1, p.y - 7, pr * 0.45);
  }
  if (!ctx.reduced && Math.random() < 0.1 + prog * 0.2) ctx.juice.bits('bubble', p.x + (Math.random() - 0.5) * 10, p.y - 10, 1, VENOM);
}

function drawAura(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const { v } = viewFor(ctx, h, tick);
  smooth(ctx, v, h.x, h.y, true);
  const p = ctx.P(v.x, v.y);
  if (h.in > 0) {
    // Thorn Armor: a crown of pale thorns turning around the Warden (full strength turns faster, venom-rimmed)
    const full = h.in >= 2;
    const r = full ? 0.75 : 0.62;
    const n = full ? 12 : 8;
    const rot = ctx.now / (full ? 500 : 900);
    for (let i = 0; i < n; i++) {
      const ang = rot + (i / n) * Math.PI * 2;
      const ox = Math.cos(ang), oy = Math.sin(ang);
      const bx = p.x + ox * ctx.rx(r), by = p.y + oy * ctx.ry(r);
      const tx = p.x + ox * ctx.rx(r + (full ? 0.26 : 0.18)), ty = p.y + oy * ctx.ry(r + (full ? 0.26 : 0.18)) - (full ? 7 : 5);
      const sx = -oy * 2, sy = ox * 1;
      g.fillStyle(full ? THORN : BARK_LT, full ? 1 : 0.75).fillTriangle(bx - sx, by - sy, bx + sx, by + sy, tx, ty);
      if (full) g.fillStyle(0xffffff, 0.9).fillRect(Math.round(tx), Math.round(ty), 1, 1);
    }
    ell(ctx, g, v.x, v.y, r, null, 0, full ? VENOM : MOSS, 1, full ? 0.6 : 0.35);
  }
  if (h.out > 0) {
    // Barkskin: bark plates orbiting slowly over a sap-green rim
    ell(ctx, g, v.x, v.y, 0.55, BARK, 0.18, BARK_LT, 2, 0.8);
    for (let i = 0; i < 6; i++) {
      const ang = -ctx.now / 1400 + (i / 6) * Math.PI * 2;
      const bx = p.x + Math.cos(ang) * ctx.rx(0.55), by = p.y + Math.sin(ang) * ctx.ry(0.55) - 10;
      g.fillStyle(BARK_LT, 0.85).fillRect(Math.round(bx) - 2, Math.round(by) - 1, 4, 3);
      g.fillStyle(0x4a2e16, 0.85).fillRect(Math.round(bx) - 2, Math.round(by) + 1, 4, 1);
    }
    if (!ctx.reduced && Math.random() < 0.06) ctx.juice.embersAt(p.x, p.y - 14, 1, HEAL);
  }
  if (h.len > 0) {
    // Feral Shift: a spectral werebear looms behind the Warden
    if (!v.sprites.length) {
      const bear = bearActor();
      const s = actorSprite(ctx, bear, false).setBlendMode(Phaser.BlendModes.ADD).setTint(0x8fd8a0).setAlpha(0.32);
      s.setScale(bear === 'pursuer' ? 2.1 : 1.2);
      v.sprites.push(s);
    }
    const s = v.sprites[0];
    s.setPosition(Math.round(p.x - ctx.U(h.dx, h.dy).x * 4), Math.round(p.y - 2)).setDepth(iso.depth(v.x, v.y) - 0.6).setAlpha(0.26 + 0.06 * Math.sin(ctx.now / 260));
    playAnim(ctx, v, 0, bearActor(), 'idle', dir8(h.dx, h.dy));
  } else if (v.sprites.length) { v.sprites.forEach((s) => s.destroy()); v.sprites.length = 0; v.anims.length = 0; }
}

registerHazardFx({
  w_wolf: drawBeast,
  w_ursa: drawBeast,
  w_stampede: drawStampede,
  w_roots: drawPatch,
  w_worldroot: drawWorldroot,
  w_root: drawRootMarker,
  w_totem: drawTotem,
  w_bramble: drawBramble,
  w_pod: drawPod,
  w_aura: drawAura,
}, { w_roots: 0x6bd84a, w_worldroot: 0x6bd84a, w_totem: HEAL, w_stampede: SPIRIT, w_ursa: SPIRIT, w_bramble: 0xb08850, w_pod: VENOM });

registerProjectileFx({
  w_thorn: {
    key: 'fx:warden:thorn', color: LEAF, additive: false, trail: 'leaf', trailMs: 120,
    end: (ctx, sx, sy) => { if (Math.random() < 0.5) ctx.juice.bits('thorn', sx, sy, 2, THORN); },
  },
});

// ---------------- casts ----------------

/** Curved trail between two world points (venom leaps, thorn lashes). Throttled: these can fire many times a second. */
let lastTrail = 0;
function trail(ctx: FxCtx, x0: number, y0: number, x1: number, y1: number, color: number, width: number, ms = 240) {
  const a = chestAt(ctx, x0, y0), b = chestAt(ctx, x1, y1);
  ctx.juice.bitsAlong(color === VENOM ? 'bubble' : 'thorn', a.x, a.y, b.x, b.y, 2, color);
  if (ctx.reduced || ctx.now - lastTrail < 40) return;
  lastTrail = ctx.now;
  const g = ctx.scene.add.graphics().setDepth(4645).setBlendMode(Phaser.BlendModes.ADD);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - Math.hypot(b.x - a.x, b.y - a.y) * 0.3;
  let px = a.x, py = a.y;
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x, y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y;
    g.lineStyle(width, color, 0.3 + 0.6 * t).lineBetween(px, py, x, y);
    g.lineStyle(Math.max(1, width / 3), 0xffffff, 0.8 * t).lineBetween(px, py, x, y);
    px = x; py = y;
  }
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, onComplete: () => g.destroy() });
}

/** Thorn nova (Thornburst and Bramble Wall): a thick thorn wave, venom inside, two rings of erupting thorns. */
function thornNova(ctx: FxCtx, e: CastFx, R: number) {
  const J = ctx.juice;
  const p = ctx.P(e.x, e.y);
  impactBurst(ctx, e.x, e.y, R, THORNP, 2, { dust: 6 });
  J.shockwave(p.x, p.y, ctx.rx(R * 0.55), VENOM, 300, 60);
  J.bits('thorn', p.x, p.y - 10, 16, THORN, { speed: 1.4 });
  J.bits('bubble', p.x, p.y - 8, 6, VENOM);
  spikeRing(ctx, e.x, e.y, R * 0.5, 8, 'fx:warden:thornspike', undefined, 1);
  spikeRing(ctx, e.x, e.y, R * 0.88, 10, 'fx:warden:thornspike', undefined, 1.15, 12);
  if (ctx.rank(e.slot, 'w_festering')) J.bits('skull', p.x, p.y - 18, 1, VENOM);
  ctx.dungeon.flashLight(p.x, p.y - 10, ctx.rx(R) * 2.2, 0xc8d870, 2, 260);
}

registerSkillFx({
  w_thornspear: (ctx, e) => {
    const J = ctx.juice;
    const c = chestAt(ctx, e.x, e.y);
    const u = ctx.U(e.dx, e.dy);
    const ang = Math.atan2(u.y, u.x);
    const reach = scrLen(ctx, e.dx, e.dy, 2.1);
    const tint = ctx.rank(e.slot, 'w_creeping_venom') ? VENOM : 0xd8ffb0;
    playFx(ctx, 'fx:warden:thrust', c.x + u.x * 4, c.y + u.y * 4, { rot: ang, sx: reach / 40, sy: 1, tint, add: true, ox: 0.05, depth: 4652 });
    J.slash(c.x + u.x * reach * 0.5, c.y + u.y * reach * 0.5, ang, tint, 0.8, { thin: true, ms: 150 });
    const tx = c.x + u.x * reach, ty = c.y + u.y * reach;
    J.sparksAt(tx, ty, 2, THORN);
    if (Math.random() < 0.5) J.bits('leaf', tx, ty, 1, LEAF, { angle: ang * DEG, spread: 60 });
    skillSfx(ctx, e.skill, 'swing', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  w_bear_maul: (ctx, e) => {
    const J = ctx.juice;
    const c = chestAt(ctx, e.x, e.y);
    const u = ctx.U(e.dx, e.dy);
    const ang = Math.atan2(u.y, u.x);
    const reach = scrLen(ctx, e.dx, e.dy, 2.3) * 0.55;
    J.slash(c.x + u.x * reach, c.y + u.y * reach, ang, 0xd8ffb0, 1.5, { ms: 200 });
    J.claw(c.x + u.x * reach * 1.2, c.y + u.y * reach * 1.2, ang + Math.PI / 2, SPIRIT, 1.3, 220);
    J.dust(c.x + u.x * reach * 1.3, c.y + 14 + u.y * reach * 1.3, 3, 0x4a3a28);
    J.bits('mote', c.x + u.x * reach, c.y + u.y * reach, 3, SPIRIT, { angle: ang * DEG, spread: 90 });
    sfx(ctx, 'skill_sweep', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  w_wild_hunt: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const u = ctx.U(e.dx, e.dy);
    const ang = Math.atan2(u.y, u.x) * DEG;
    // the call: a spirit pillar and a rune circle at the Warden, the forest blasting forward down the lane
    castFlash(ctx, e.x, e.y, BEASTP, 2.2, { glyph: true });
    J.beam(p.x, p.y, 150, 26, SPIRIT, 460);
    J.beam(p.x, p.y, 150, 8, SPIRIT_HOT, 320);
    spiritRise(ctx, p.x, p.y - 44, 'fx:warden:wolfspirit', 1.5, 700);
    J.shockwave(p.x, p.y, ctx.rx(1.8), SPIRIT, 380);
    J.shockwave(p.x, p.y, ctx.rx(2.6), LEAF, 460, 90);
    J.bits('leaf', p.x, p.y - 8, 14, LEAF, { angle: ang, spread: 50, speed: 2 });
    J.bits('mote', p.x, p.y - 12, 14, SPIRIT, { angle: ang, spread: 40, speed: 2.4 });
    J.dust(p.x, p.y, 14, 0x3a4a30);
    ctx.dungeon.flashLight(p.x, p.y - 12, 340, SPIRIT, 2.6, 560);
    if (ctx.mine) { J.pop(SPIRIT, 0.14, 220); J.hitStop(50); }
    skillSfx(ctx, e.skill, 'beast_howl', e.x, e.y, 0, 3);   // the call
    skillLayer(ctx, e.skill, 'slam_heavy', e.x, e.y, 0, 2);   // the stampede's thunder
  },
  w_entangle: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const R = 2.4 * growth(ctx, e.slot);
    const h = handOf(ctx, e.slot, e.x, e.y);
    lob(ctx, h.x, h.y, p.x, p.y - 4, LEAF, 'leaf', 240);
    impactBurst(ctx, e.x, e.y, R, GROVEP, 2, { dust: 8 });
    spikeRing(ctx, e.x, e.y, R * 0.55, 7, 'fx:warden:rootspike');
    J.bits('leaf', p.x, p.y - 10, 10, LEAF);
    skillSfx(ctx, e.skill, 'throw_whoosh', e.x, e.y, 0, ctx.mine ? 2 : 1);   // the seed
    skillLayer(ctx, e.skill, 'slam_heavy', e.x, e.y, 120, 1);   // roots ripping up
  },
  w_verdant_totem: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const R = 2.4 * growth(ctx, e.slot);
    const h = handOf(ctx, e.slot, e.x, e.y);
    lob(ctx, h.x, h.y, p.x, p.y - 4, HEAL, 'leaf', 240);
    impactBurst(ctx, e.x, e.y, R, HEALP, 2, { dust: 8 });
    spikeRing(ctx, e.x, e.y, R * 0.55, 6, 'fx:warden:rootspike');
    J.glyph(p.x, p.y, ctx.rx(ctx.rank(e.slot, 'w_forest_heart') ? 6 : 4), HEAL, 900);
    J.bits('leaf', p.x, p.y - 30, 10, BLOOM, { angle: -90, spread: 140 });
    skillSfx(ctx, e.skill, 'summon_rise', e.x, e.y, 0, 2);   // the living totem rising
    skillLayer(ctx, e.skill, 'heal', e.x, e.y, 0, 1);
  },
  w_worldroot: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const u = ctx.U(e.dx, e.dy);
    castFlash(ctx, e.x, e.y, GROVEP, 1.4, { glyph: true });
    J.shockwave(p.x, p.y, ctx.rx(1.1), LEAF, 300);
    J.dust(p.x, p.y, 10, 0x4a3a28);
    J.bits('leaf', p.x, p.y - 8, 8, LEAF, { angle: Math.atan2(u.y, u.x) * DEG, spread: 40, speed: 1.8 });
    ctx.dungeon.flashLight(p.x, p.y - 10, 200, 0x6bd84a, 2, 400);
    if (ctx.mine) J.hitStop(35);
    skillSfx(ctx, e.skill, 'slam_heavy', e.x, e.y, 0, ctx.mine ? 2 : 1);
  },
  w_call_pack: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    // the howl: rings rolling out, a wolf spirit rising and motes swirling up
    castFlash(ctx, e.x, e.y, BEASTP, 1.6, { glyph: true });
    J.shockwave(p.x, p.y, ctx.rx(2.2), SPIRIT, 480);
    J.shockwave(p.x, p.y, ctx.rx(1.3), SPIRIT_HOT, 320, 80);
    spiritRise(ctx, p.x, p.y - 40, 'fx:warden:wolfspirit', 1.2, 640);
    J.bits('mote', p.x, p.y - 18, 14, SPIRIT, { angle: -90, spread: 160 });
    ctx.dungeon.flashLight(p.x, p.y - 16, 230, SPIRIT, 1.9, 420);
    skillSfx(ctx, e.skill, 'beast_howl', e.x, e.y, 0, ctx.mine ? 2 : 1);
    skillLayer(ctx, e.skill, 'summon_rise', e.x, e.y, 0, 1);   // the wolf spirits rising
  },
  w_ursine_call: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const R = 2.6;
    // the Great Spirit Bear crashes down: a spectral head drops out of the sky into a spirit pillar
    const s = grab(ctx, 'fx:warden:bearspirit', p.x, p.y - 170);
    if (s) {
      s.setBlendMode(Phaser.BlendModes.ADD).setDepth(4663).setScale(1.1).setAlpha(0.9);
      ctx.scene.tweens.add({ targets: s, y: p.y - 40, scale: 1.7, duration: 150, ease: 'Quad.easeIn' });
      ctx.scene.tweens.add({ targets: s, alpha: 0, scale: 2.3, y: p.y - 56, delay: 160, duration: 420, ease: 'Quad.easeOut', onComplete: () => release('fx:warden:bearspirit', s) });
    }
    J.beam(p.x, p.y, 190, 34, SPIRIT, 420);
    J.beam(p.x, p.y, 190, 10, SPIRIT_HOT, 300);
    impactBurst(ctx, e.x, e.y, R, BEASTP, 3, { dust: 18, decal: 'scorch', decalTint: 0x0e2a22 });
    J.claw(p.x, p.y - 4, Math.random() * Math.PI, SPIRIT, 2.4, 320);
    ctx.scene.time.delayedCall(150, () => {
      J.shockwave(p.x, p.y, ctx.rx(R * 1.25), SPIRIT_HOT, 420);
      J.bits('mote', p.x, p.y - 16, 16, SPIRIT, { speed: 2 });
      J.bits('leaf', p.x, p.y - 10, 8, LEAF);
    });
    skillSfx(ctx, e.skill, 'slam_heavy', e.x, e.y, 0, 3);
    skillLayer(ctx, e.skill, 'beast_roar', e.x, e.y, 0, 2);   // the Ursa
  },
  w_alpha_pounce: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const c = chestAt(ctx, e.x, e.y);
    const u = ctx.U(e.dx, e.dy);
    const far = scrLen(ctx, e.dx, e.dy, 4);
    J.dust(p.x, p.y, 7, 0x4a3a28);
    J.shockwave(p.x, p.y, ctx.rx(0.8), SPIRIT, 260);
    heroGhosts(ctx, e.slot, e.dx, e.dy, SPIRIT, 4, 9);
    J.bitsAlong('mote', c.x, c.y, c.x + u.x * far, c.y + u.y * far, 6, SPIRIT);
    skillSfx(ctx, e.skill, 'dodge', e.x, e.y, 0, 2);   // the file covers the leap and the landing
  },
  w_alpha_land: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const u = ctx.U(e.dx, e.dy);
    impactBurst(ctx, e.x, e.y, 2.2, BEASTP, 2, { dust: 14 });
    J.claw(p.x, p.y - 8, Math.atan2(u.y, u.x) + Math.PI / 2, SPIRIT, 1.8, 260);
    spiritRise(ctx, p.x, p.y - 34, 'fx:warden:wolfspirit', 1, 480);
    spikeRing(ctx, e.x, e.y, 1.3, 5, 'fx:warden:rootspike', undefined, 0.8);
    if (ctx.mine) J.hitStop(60);
    skillLayer(ctx, 'w_alpha_pounce', 'slam_heavy', e.x, e.y, 0, ctx.mine ? 3 : 1);
    skillLayer(ctx, 'w_alpha_pounce', 'beast_howl', e.x, e.y, 0, 1);   // the pack called
  },
  w_wolf_pounce: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const u = ctx.U(e.dx || 1, e.dy);
    J.claw(p.x + u.x * 6, p.y - 12, Math.atan2(u.y, u.x) + Math.PI / 2, SPIRIT, 0.85, 200);
    J.impact(p.x, p.y - 12, SPIRIT, 0.9);
    J.dust(p.x, p.y, 2, 0x3a4a30);
    J.bits('mote', p.x, p.y - 12, 2, SPIRIT);
    sfx(ctx, 'beast_roar', e.x, e.y, 400, 1);   // a snarl (a pack leaping at once growls once)
  },
  w_ursa_swipe: (ctx, e) => {
    const J = ctx.juice;
    const c = chestAt(ctx, e.x, e.y, 22);
    const u = ctx.U(e.dx, e.dy);
    const ang = Math.atan2(u.y, u.x);
    const reach = scrLen(ctx, e.dx, e.dy, 1.8) * 0.7;
    J.slash(c.x + u.x * reach, c.y + u.y * reach, ang, SPIRIT, 1.8, { ms: 220 });
    J.claw(c.x + u.x * reach * 1.3, c.y + u.y * reach * 1.3, ang + Math.PI / 2, SPIRIT_HOT, 1.6, 240);
    J.dust(c.x + u.x * reach, c.y + 22 + u.y * reach, 4, 0x3a4a30);
    J.sparksAt(c.x + u.x * reach, c.y + u.y * reach, 6, SPIRIT);
    sfx(ctx, 'skill_sweep', e.x, e.y, 90, 1);
  },
  w_thornburst: (ctx, e) => {
    thornNova(ctx, e, 2.8);
    if (ctx.mine) ctx.juice.hitStop(30);
    skillSfx(ctx, e.skill, 'slam_heavy', e.x, e.y, 0, ctx.mine ? 2 : 1);   // thorns erupting
    skillLayer(ctx, e.skill, 'blast_decay', e.x, e.y, 0, 1);   // the venom
  },
  w_bramble_wall: (ctx, e) => {
    thornNova(ctx, e, 2.8);
    if (ctx.mine) ctx.juice.hitStop(35);
    skillSfx(ctx, e.skill, 'slam_heavy', e.x, e.y, 0, ctx.mine ? 2 : 1);   // the nova and the wall bursting up
    skillLayer(ctx, e.skill, 'blast_decay', e.x, e.y, 0, 1);
  },
  w_thorn_pod: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    const h = handOf(ctx, e.slot, e.x, e.y);
    lob(ctx, h.x, h.y, p.x, p.y - 6, VENOM, 'thorn', 260);
    ctx.juice.ring(p.x, p.y, 18, VENOM, 240);
    ctx.juice.dust(p.x, p.y, 3, 0x3a4a20);
    skillLayer(ctx, 'w_thorn_pod', 'throw_whoosh', e.x, e.y, 0, ctx.mine ? 2 : 1);   // the lob (the pod's file plays at the burst)
  },
  w_pod_burst: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const R = 3.2;
    impactBurst(ctx, e.x, e.y, R, VENOMP, 2, { dust: 10, decal: 'slime', decalTint: 0x2a4a10 });
    J.shockwave(p.x, p.y, ctx.rx(R * 0.6), THORN, 300, 60);
    // eight thorn sprays along the shard directions
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const u = ctx.U(Math.cos(a), Math.sin(a));
      J.bits('thorn', p.x + u.x * 8, p.y - 8 + u.y * 4, 3, THORN, { angle: Math.atan2(u.y, u.x) * DEG, spread: 16, speed: 1.6 });
    }
    spikeRing(ctx, e.x, e.y, R * 0.5, 8, 'fx:warden:thornspike', undefined, 1.1);
    J.bits('bubble', p.x, p.y - 10, 12, VENOM);
    J.embersAt(p.x, p.y - 10, 10, VENOM);
    if (ctx.mine) { J.pop(VENOM, 0.1, 160); J.hitStop(40); }
    skillSfx(ctx, 'w_thorn_pod', 'blast_decay', e.x, e.y, 0, 2);   // Ironthorn Pod's file: swelling then bursting
  },
  w_thorn_lash: (ctx, e) => {
    const heart = ctx.rank(e.slot, 'w_heart_of_thorns') > 0;
    trail(ctx, e.x, e.y, e.dx, e.dy, heart ? 0xff8a7a : THORN, 3, 200);
    const t = chestAt(ctx, e.dx, e.dy);
    ctx.juice.impact(t.x, t.y, heart ? BLOOD : THORN, 1);
    ctx.juice.sparksAt(t.x, t.y, 4, heart ? BLOOD : THORN);
    sfx(ctx, 'swing', e.x, e.y, 80, 1);   // the lash (its hit plays the central impact)
  },
  w_thorn_nova: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    J.shockwave(p.x, p.y, ctx.rx(1.8), THORN, 300);
    J.ring(p.x, p.y, ctx.rx(1.1), BLOOD, 220);
    J.bits('thorn', p.x, p.y - 10, 10, 0xffd0c0, { speed: 1.3 });
    spikeRing(ctx, e.x, e.y, 1.1, 6, 'fx:warden:thornspike', 0xff9a8a, 0.9);
    J.starburst(p.x, p.y - 12, 0xffd0c0, 0.8, 140);
    sfx(ctx, 'blade_flurry', e.x, e.y, 120, 1);   // thorns slicing out
  },
  w_contagion: (ctx, e) => {
    trail(ctx, e.x, e.y, e.dx, e.dy, VENOM, 3, 320);
    const t = chestAt(ctx, e.dx, e.dy);
    ctx.juice.orb(t.x, t.y, VENOM, 0.35, 160);
    ctx.juice.bits('bubble', t.x, t.y, 2, VENOM);
  },
  w_venom_bloom: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    J.shockwave(p.x, p.y, ctx.rx(2), VENOM, 340);
    J.ring(p.x, p.y, ctx.rx(1.1), THORN, 220);
    J.orb(p.x, p.y - 10, VENOM, 0.8, 240);
    J.bits('bubble', p.x, p.y - 10, 8, VENOM);
    J.bits('skull', p.x, p.y - 16, 1, 0xd8f0b0);
    spikeRing(ctx, e.x, e.y, 1, 5, 'fx:warden:thornspike', 0xc8ff8a, 0.9);
    ctx.dungeon.addDecal('slime', p.x, p.y + 3, 0x2a4a10, 0.9);
    ctx.dungeon.flashLight(p.x, p.y - 10, 150, VENOM, 1.8, 220);
    sfx(ctx, 'blast_decay', e.x, e.y, 120, 1);
  },
  w_bloodroot: (ctx, e) => {
    const J = ctx.juice;
    const t = chestAt(ctx, e.x, e.y);
    spikeRing(ctx, e.x, e.y, 0.4, 4, 'fx:warden:thornspike', 0xff6a6a, 1);
    J.starburst(t.x, t.y, 0xffb0a0, 1.2, 170);
    J.impact(t.x, t.y, BLOOD, 1.4);
    J.sparksAt(t.x, t.y, 10, BLOOD);
    J.bleed('player', t.x, t.y, 8);
    J.dust(t.x, t.y + 14, 4, 0x3a1a14);
    sfx(ctx, 'blast_decay', e.x, e.y, 200, 1);   // a spurt of blood (every rooted second, so spaced out)
  },
  w_sprout: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const R = 1.6 * growth(ctx, e.slot);
    J.shockwave(p.x, p.y, ctx.rx(R), LEAF, 300);
    J.bits('leaf', p.x, p.y - 8, 6, LEAF);
    spikeRing(ctx, e.x, e.y, R * 0.5, 3, 'fx:warden:rootspike', undefined, 0.8);
    J.dust(p.x, p.y, 5, 0x3a5a2a);
  },
});

registerKillFx({
  warden: (ctx, k) => {
    const J = ctx.juice;
    const c = chestAt(ctx, k.x, k.y, 12);
    const big = k.big || k.elite > 0 || k.boss;
    J.bits('leaf', c.x, c.y, big ? 7 : 3, LEAF);
    J.bits('mote', c.x, c.y, big ? 5 : 2, SPIRIT);
    if (k.dtype === 'decay') J.bits('bubble', c.x, c.y, big ? 6 : 3, VENOM);
    if (k.crit) J.starburst(c.x, c.y, SPIRIT_HOT, big ? 1.3 : 0.9, 150);
    if (big) { killPop(ctx, k.x, k.y, GROVEP, true, k.elite); spikeRing(ctx, k.x, k.y, 0.5, 3, 'fx:warden:rootspike', undefined, 0.8); }
  },
});
