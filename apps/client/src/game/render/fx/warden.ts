import * as Phaser from 'phaser';
import type { SfxId } from '../../audio/AudioEngine';
import { ACTOR_IDS, ACTOR_META, animFor, type ActorId, type ActorState } from '../../art/actors';
import { iso, isoPoly } from '../iso';
import { registerHazardFx, registerProjectileFx, registerSkillFx, type CastFx, type FxCtx, type SnapHazard } from './registry';

// Warden presentation (cosmetic only). Moss, bark and spectral spirit-green; venom is a toxic lime.
// Sim conventions (packages/simulation/src/classes/warden.ts):
//   casts at a target point (x,y = target): w_entangle, w_verdant_totem, w_ursine_call, w_thorn_pod, w_alpha_land,
//     w_pod_burst, w_bloodroot, w_sprout, w_venom_bloom, w_wolf_pounce (dx,dy = leap direction), w_thorn_nova
//   casts with a target point in dx,dy: w_thorn_lash (x,y Warden -> dx,dy enemy), w_contagion (corpse -> enemy)
//   other casts: x,y caster, dx,dy aim
//   hazards: w_wolf / w_ursa (beasts: dx,dy facing, sp speed, len leap ticks left, w last bite tick, in variant,
//     out frenzy), w_stampede, w_roots, w_worldroot, w_root (vines while tick < out), w_totem, w_bramble, w_pod
//     (detonates at out), w_aura (in thorn armor 0/1/2, out Barkskin, len Feral Shift).
// Beasts are pooled sprites keyed by hazard id: created on first sight, swept when their id stops appearing.

const MOSS = 0x6b8f3a;
const LEAF = 0x9ad86a;
const SPIRIT = 0x9affc8;
const BARK = 0x6a4a2a;
const BARK_LT = 0xb08850;
const THORN = 0xd8c890;
const VENOM = 0x9ef04a;
const HEAL = 0x8fe07a;
const BLOOD = 0xc0303a;

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
/** The art agent may add dedicated spirit sprites; until then a tinted Ghoul Hound stands in. */
const wolfActor = (): ActorId => (hasActor('spiritwolf') ? 'spiritwolf' : 'pursuer') as ActorId;
const bearActor = (): ActorId => (hasActor('spiritbear') ? 'spiritbear' : 'pursuer') as ActorId;
const elkActor = (): ActorId => (hasActor('spiritelk') ? 'spiritelk' : hasActor('prismstag') ? 'prismstag' : 'pursuer') as ActorId;

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
  const reset = () => { scene.events.off(Phaser.Scenes.Events.POST_UPDATE, sweep); for (const v of views.values()) destroyView(v); views.clear(); sweeperScene = null; };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, reset);
  scene.events.once(Phaser.Scenes.Events.DESTROY, reset);
}

function viewFor(ctx: FxCtx, h: SnapHazard, tick: number): { v: View; fresh: boolean } {
  ensureSweeper(ctx.scene);
  let v = views.get(h.i);
  const fresh = !v;
  if (!v) {
    v = { sprites: [], extra: [], lastSeen: ctx.now, firstSeen: ctx.now, firstTick: tick, x: h.x, y: h.y, lastT: ctx.now, leapMax: 0, anims: [], pulse: -1, dissolve: 0 };
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
  if (Math.hypot(x - v.x, y - v.y) > 3) { v.x = x; v.y = y; return; }
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

function rootSprites(ctx: FxCtx, v: View, n: number, place: (i: number) => [number, number], scale: number, alpha = 1) {
  if (ctx.reduced || !ctx.scene.textures.exists('fx:root')) return;
  while (v.sprites.length < n) v.sprites.push(ctx.scene.add.sprite(0, 0, 'fx:root').setDepth(-74).setOrigin(0.5, 0.85));
  v.sprites.forEach((s, i) => {
    const [x, y] = place(i);
    const p = ctx.P(x, y);
    s.setPosition(Math.round(p.x), Math.round(p.y)).setScale(scale * (0.8 + hash01(i, 7) * 0.4)).setAlpha(alpha).setFlipX(hash01(i, 3) > 0.5);
  });
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
    s.setScale(custom ? 1 : bear ? 1.9 : dire ? 1.2 : 0.95);
    if (!custom) s.setTint(bear ? 0x9ae8b0 : SPIRIT);
    v.sprites.push(s);
    const glow = ctx.scene.textures.exists('light:soft')
      ? ctx.scene.add.image(0, 0, 'light:soft').setBlendMode(Phaser.BlendModes.ADD).setTint(SPIRIT).setAlpha(0.22).setScale(bear ? 0.5 : 0.28)
      : null;
    if (glow) v.extra.push(glow);
    if (fresh && tick - h.b < 12) {
      const p = ctx.P(h.x, h.y);
      ctx.juice.ring(p.x, p.y, bear ? 60 : 26, SPIRIT, 320);
      ctx.juice.embersAt(p.x, p.y - 10, bear ? 18 : 8, SPIRIT);
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
  glow?.setPosition(p.x, p.y - 12 - lift).setDepth(iso.depth(v.x, v.y) - 1).setAlpha(h.out ? 0.38 : 0.22);
  // ground mark (readable spirit footprint) and shadow
  ell(ctx, g, v.x, v.y, (bear ? 0.95 : dire ? 0.5 : 0.38) * (leaping ? 0.7 : 1), 0x000000, 0.35);
  ell(ctx, g, v.x, v.y, bear ? 1.0 : 0.42, null, 0, h.out ? 0xd8ffa0 : SPIRIT, 1, 0.45);
  if (leaping && !ctx.reduced && Math.random() < 0.5) ctx.juice.afterimage(s, SPIRIT);
  if (h.sp > 3 && !ctx.reduced && Math.random() < 0.08) ctx.juice.dust(p.x, p.y, 1, 0x3a4a30);
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
  // trampled lane behind the herd
  g.fillStyle(MOSS, 0.16 * fade).fillPoints(quad(h.x, h.y, h.dx, h.dy, front, h.w), true);
  g.lineStyle(2, SPIRIT, 0.5 * fade).strokePoints(quad(h.x, h.y, h.dx, h.dy, front, h.w), true);
  const px = -h.dy, py = h.dx;
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
    if (!ctx.reduced && !done && Math.random() < 0.12) ctx.juice.afterimage(s, SPIRIT);
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
    g.fillStyle(0x2a3a1a, 0.42 * a).fillPoints(qd, true);
    g.lineStyle(2, pulse ? LEAF : MOSS, 0.9 * a).strokePoints(qd, true);
    const n = Math.max(2, Math.round(h.len / 0.9));
    rootSprites(ctx, v, n, (i) => { const t = (i + 0.5) / n; const s = (hash01(h.i, i) - 0.5) * h.w * 0.6; return [h.x + h.dx * h.len * t - h.dy * s, h.y + h.dy * h.len * t + h.dx * s]; }, 0.8, a);
  } else {
    const r = h.r * (0.3 + 0.7 * grow);
    ell(ctx, g, h.x, h.y, r, 0x2a3a1a, 0.4 * a, pulse ? LEAF : MOSS, 2, 0.9 * a);
    ell(ctx, g, h.x, h.y, r * 0.66, null, 0, BARK_LT, 1, 0.35 * a);
    const n = Math.max(3, Math.round(h.r * 2.2));
    rootSprites(ctx, v, n, (i) => { const ang = hash01(h.i, i) * Math.PI * 2; const d = Math.sqrt(hash01(i, h.i)) * r * 0.85; return [h.x + Math.cos(ang) * d, h.y + Math.sin(ang) * d]; }, 0.75 * (0.5 + 0.5 * grow), a);
  }
  if (pulse && v.pulse !== Math.floor((tick - h.b) / 30) && !ctx.reduced) {
    v.pulse = Math.floor((tick - h.b) / 30);
    const c = ctx.P(h.len > 0 ? h.x + h.dx * h.len * 0.5 : h.x, h.len > 0 ? h.y + h.dy * h.len * 0.5 : h.y);
    ctx.juice.embersAt(c.x, c.y - 4, 3, LEAF);
  }
}

function drawWorldroot(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const { v } = viewFor(ctx, h, tick);
  const eruptTicks = Math.ceil((h.len / h.sp) * 60);
  const age = (ctx.now - v.firstSeen) / 1000 * 60 + Math.max(0, v.firstTick - h.b);
  if (age >= eruptTicks) { drawPatch(ctx, g, h, tick); return; }
  const front = Math.min(h.len, h.sp * (age / 60));
  const qd = quad(h.x, h.y, h.dx, h.dy, front, h.w);
  g.fillStyle(0x2a3a1a, 0.5).fillPoints(qd, true);
  g.lineStyle(3, LEAF, 1).strokePoints(qd, true);
  const tip = ctx.P(h.x + h.dx * front, h.y + h.dy * front);
  if (!ctx.reduced) { ctx.juice.dust(tip.x, tip.y, 2, 0x4a3a28); if (Math.random() < 0.5) ctx.juice.sparksAt(tip.x, tip.y - 6, 2, LEAF); }
  const n = Math.max(2, Math.round(front / 0.9));
  rootSprites(ctx, v, n, (i) => { const t = (i + 0.5) / n; return [h.x + h.dx * front * t, h.y + h.dy * front * t]; }, 0.9);
}

function drawRootMarker(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const { v, fresh } = viewFor(ctx, h, tick);
  const holding = tick < h.out;
  if (fresh && holding && tick - h.b < 6) {
    const p = ctx.P(h.x, h.y);
    ctx.juice.dust(p.x, p.y, 3, 0x3a5a2a);
    ctx.juice.sparksAt(p.x, p.y - 8, 4, LEAF);
  }
  if (!holding) { v.sprites.forEach((s) => s.setVisible(false)); return; }
  const r = Math.max(0.45, h.r + 0.15);
  const wob = Math.sin(ctx.now / 120 + h.i) * 0.04;
  ell(ctx, g, h.x, h.y, r + wob, 0x1a2a10, 0.35, MOSS, 2, 1);
  ell(ctx, g, h.x, h.y, r * 0.7, null, 0, BARK_LT, 1, 0.7);
  rootSprites(ctx, v, 2, (i) => [h.x + (i ? 0.18 : -0.18) * r, h.y + (i ? -0.1 : 0.1) * r], 0.7 + r * 0.25);
  v.sprites.forEach((s, i) => s.setDepth(iso.depth(h.x, h.y) + 2 + i).setVisible(true));
}

function totemTexture(scene: Phaser.Scene) {
  if (scene.textures.exists('w:totem')) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0x24170c, 1).fillRect(9, 16, 9, 38);
  g.fillStyle(BARK, 1).fillRect(10, 16, 6, 38);
  g.fillStyle(BARK_LT, 1).fillRect(11, 18, 2, 34);
  g.fillStyle(0x24170c, 1).fillRect(10, 28, 7, 2).fillRect(10, 40, 7, 2);
  g.fillStyle(SPIRIT, 1).fillRect(11, 23, 2, 2).fillRect(14, 23, 2, 2);
  g.fillStyle(0x1e3a14, 1).fillCircle(13, 13, 11);
  g.fillStyle(0x3f7a26, 1).fillCircle(10, 11, 7);
  g.fillStyle(0x6aa83e, 1).fillCircle(16, 9, 5);
  g.fillStyle(LEAF, 1).fillCircle(8, 8, 2);
  g.fillStyle(0xffb0d8, 1).fillCircle(14, 6, 3);
  g.fillStyle(0xffffff, 1).fillCircle(14, 6, 1);
  g.fillStyle(0x1e3a14, 1).fillTriangle(4, 54, 22, 54, 13, 46);
  g.generateTexture('w:totem', 27, 56);
  g.destroy();
}

function drawTotem(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const { v, fresh } = viewFor(ctx, h, tick);
  if (!v.sprites.length) {
    totemTexture(ctx.scene);
    const s = ctx.scene.add.sprite(0, 0, 'w:totem').setOrigin(0.5, 0.96);
    ctx.dungeon.litObject(s);
    v.sprites.push(s);
    if (fresh) { s.setScale(1, 0.1); ctx.scene.tweens.add({ targets: s, scaleY: 1, duration: 260, ease: 'Back.easeOut' }); }
    const glow = ctx.scene.textures.exists('light:soft') ? ctx.scene.add.image(0, 0, 'light:soft').setBlendMode(Phaser.BlendModes.ADD).setTint(HEAL).setAlpha(0.3).setScale(0.45) : null;
    if (glow) v.extra.push(glow);
  }
  const p = ctx.P(h.x, h.y);
  v.sprites[0].setPosition(Math.round(p.x), Math.round(p.y)).setDepth(iso.depth(h.x, h.y));
  (v.extra[0] as Phaser.GameObjects.Image | undefined)?.setPosition(p.x, p.y - 44).setDepth(iso.depth(h.x, h.y) + 1).setAlpha(0.22 + 0.1 * Math.sin(ctx.now / 200));
  const phase = ((tick - h.b) % 60) / 60;
  ell(ctx, g, h.x, h.y, h.r, HEAL, 0.06, HEAL, 1, 0.5);
  ell(ctx, g, h.x, h.y, h.r * phase, null, 0, HEAL, 2, 0.6 * (1 - phase));
  const k = Math.floor((tick - h.b - 1) / 60);
  if (k !== v.pulse && tick > h.b) {
    v.pulse = k;
    ctx.juice.ring(p.x, p.y, ctx.rx(h.r), HEAL, 420);
    ctx.juice.embersAt(p.x, p.y - 40, 6, 0xffb0d8);
  }
}

function drawBramble(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const { v } = viewFor(ctx, h, tick);
  const left = h.u - tick;
  const a = left < 30 ? left / 30 : 1;
  const grow = Math.min(1, (ctx.now - v.firstSeen) / 200);
  const qd = quad(h.x, h.y, h.dx, h.dy, h.len, h.w * grow);
  g.fillStyle(0x2a2414, 0.55 * a).fillPoints(qd, true);
  g.lineStyle(2, BARK_LT, a).strokePoints(qd, true);
  // thorn spikes along both edges
  const n = Math.round(h.len * 2.5);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const side = i % 2 ? 1 : -1;
    const bx = h.x + h.dx * h.len * t - h.dy * side * h.w * 0.45, by = h.y + h.dy * h.len * t + h.dx * side * h.w * 0.45;
    const b = ctx.P(bx, by);
    const hgt = (8 + hash01(h.i, i) * 8) * grow;
    g.fillStyle(i % 3 ? THORN : BARK_LT, a).fillTriangle(b.x - 2, b.y, b.x + 2, b.y, b.x + (hash01(i, h.i) - 0.5) * 4, b.y - hgt);
  }
  rootSprites(ctx, v, Math.round(h.len), (i) => { const t = (i + 0.5) / Math.round(h.len); return [h.x + h.dx * h.len * t, h.y + h.dy * h.len * t]; }, 0.95 * grow, a);
  v.sprites.forEach((s, i) => { const t = (i + 0.5) / Math.round(h.len); s.setDepth(iso.depth(h.x + h.dx * h.len * t, h.y + h.dy * h.len * t)); });
}

function drawPod(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const total = Math.max(1, h.out - h.b);
  const prog = Math.max(0, Math.min(1, (tick - h.b) / total));
  const blink = prog > 0.6 && Math.floor(ctx.now / 70) % 2 === 0;
  ell(ctx, g, h.x, h.y, h.r, VENOM, 0.08 + 0.12 * prog, blink ? 0xffffff : THORN, 2, 0.9);
  ell(ctx, g, h.x, h.y, h.r * prog, VENOM, 0.18);
  const p = ctx.P(h.x, h.y);
  const pr = 5 + prog * 3;
  g.fillStyle(0x3a4a1a, 1).fillCircle(p.x, p.y - 6, pr);
  g.fillStyle(VENOM, 0.9).fillCircle(p.x - 1, p.y - 7, pr * 0.45);
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 + ctx.now / 300;
    g.lineStyle(2, THORN, 1).lineBetween(p.x + Math.cos(ang) * pr, p.y - 6 + Math.sin(ang) * pr * 0.6, p.x + Math.cos(ang) * (pr + 4), p.y - 6 + Math.sin(ang) * (pr + 4) * 0.6);
  }
}

function drawAura(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const { v } = viewFor(ctx, h, tick);
  smooth(ctx, v, h.x, h.y, true);
  const p = ctx.P(v.x, v.y);
  if (h.in > 0) {
    const full = h.in >= 2;
    const r = full ? 0.75 : 0.62;
    const n = full ? 12 : 8;
    const rot = ctx.now / (full ? 500 : 900);
    for (let i = 0; i < n; i++) {
      const ang = rot + (i / n) * Math.PI * 2;
      const ox = Math.cos(ang), oy = Math.sin(ang);
      const b = { x: p.x + ox * ctx.rx(r), y: p.y + oy * ctx.ry(r) };
      const tip = { x: p.x + ox * ctx.rx(r + 0.22), y: p.y + oy * ctx.ry(r + 0.22) - 6 };
      g.lineStyle(full ? 2 : 1, full ? THORN : BARK_LT, full ? 1 : 0.7).lineBetween(b.x, b.y, tip.x, tip.y);
    }
    ell(ctx, g, v.x, v.y, r, null, 0, full ? VENOM : MOSS, 1, full ? 0.6 : 0.35);
  }
  if (h.out > 0) {
    ell(ctx, g, v.x, v.y, 0.55, BARK, 0.18, BARK_LT, 2, 0.8);
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

registerProjectileFx({ w_thorn: { key: 'fx:shard', color: LEAF, scale: 0.9 } });

// ---------------- casts ----------------

function chest(ctx: FxCtx, x: number, y: number) { const p = ctx.P(x, y); return { x: p.x, y: p.y - 14 }; }

/** Curved trail between two world points (venom leaps, thorn lashes). */
function trail(ctx: FxCtx, x0: number, y0: number, x1: number, y1: number, color: number, width: number, ms = 240) {
  if (ctx.reduced) return;
  const a = chest(ctx, x0, y0), b = chest(ctx, x1, y1);
  const g = ctx.scene.add.graphics().setDepth(4645).setBlendMode(Phaser.BlendModes.ADD);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - Math.hypot(b.x - a.x, b.y - a.y) * 0.3;
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new Phaser.Math.Vector2((1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x, (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y));
  }
  g.lineStyle(width, color, 0.9).strokePoints(pts);
  g.lineStyle(Math.max(1, width / 3), 0xffffff, 0.8).strokePoints(pts);
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, onComplete: () => g.destroy() });
}

function slash(ctx: FxCtx, e: CastFx, tint: number, scale: number, reach: number) {
  const u = ctx.U(e.dx, e.dy);
  const c = chest(ctx, e.x, e.y);
  const ang = Math.atan2(u.y, u.x);
  ctx.juice.arc(c.x + u.x * reach, c.y + u.y * reach, ang, tint, scale);
  const s = ctx.scene;
  if (!ctx.reduced && s.textures.exists('fx:slash') && s.anims.exists('fx:slash')) {
    const spr = s.add.sprite(c.x + u.x * (reach + 10), c.y + u.y * (reach + 10), 'fx:slash').setRotation(ang).setDepth(4660)
      .setScale(0.55 * scale, 0.4 * scale).setBlendMode(Phaser.BlendModes.ADD).setTint(tint);
    spr.play('fx:slash');
    spr.once('animationcomplete', () => spr.destroy());
  }
}

function burst(ctx: FxCtx, x: number, y: number, R: number, ring: number, inner: number, opts: { shake?: number; light?: number; sparks?: number; dust?: number; ms?: number } = {}) {
  const J = ctx.juice;
  const p = ctx.P(x, y);
  J.ring(p.x, p.y, ctx.rx(R), ring, opts.ms ?? 320);
  J.ring(p.x, p.y, ctx.rx(R * 0.62), inner, (opts.ms ?? 320) * 0.7);
  if (opts.sparks) J.sparksAt(p.x, p.y - 8, opts.sparks, ring);
  if (opts.dust) J.dust(p.x, p.y, opts.dust, 0x3a3020);
  if (opts.light) ctx.dungeon.flashLight(p.x, p.y - 10, ctx.rx(R) * 2.2, opts.light, 2, 260);
  if (opts.shake) J.shake(opts.shake, 160);
}

registerSkillFx({
  w_thornspear: (ctx, e) => {
    slash(ctx, e, THORN, 0.9, 14);
    sfx(ctx, 'swing', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  w_bear_maul: (ctx, e) => {
    slash(ctx, e, 0xd8ffb0, 1.5, 18);
    const c = chest(ctx, e.x, e.y); const u = ctx.U(e.dx, e.dy);
    ctx.juice.dust(c.x + u.x * 22, c.y + 14 + u.y * 22, 3, 0x4a3a28);
    if (ctx.mine) ctx.juice.shake(0.003, 70);
    sfx(ctx, 'skill_sweep', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  w_wild_hunt: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(3), SPIRIT, 420);
    ctx.juice.dust(p.x, p.y, 16, 0x3a4a30);
    ctx.juice.embersAt(p.x, p.y - 14, 22, SPIRIT);
    ctx.dungeon.flashLight(p.x, p.y - 12, 320, SPIRIT, 2.4, 520);
    ctx.juice.shake(0.012, 380);
    if (ctx.mine) ctx.juice.hitStop(50);
    sfx(ctx, 'skill_rally', e.x, e.y, 0, 3);
    sfx(ctx, 'boss_charge', e.x, e.y, 0, 2);
  },
  w_entangle: (ctx, e) => {
    burst(ctx, e.x, e.y, 2.4, MOSS, LEAF, { dust: 10, sparks: 10, light: 0x6bd84a });
    sfx(ctx, 'skill_sweep', e.x, e.y, 0, ctx.mine ? 2 : 1);
  },
  w_verdant_totem: (ctx, e) => {
    burst(ctx, e.x, e.y, 2.4, MOSS, HEAL, { dust: 10, sparks: 8, light: HEAL });
    sfx(ctx, 'heal', e.x, e.y, 0, 2);
    sfx(ctx, 'skill_sweep', e.x, e.y, 0, 1);
  },
  w_worldroot: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.dust(p.x, p.y, 8, 0x4a3a28);
    ctx.juice.shake(0.008, 260);
    sfx(ctx, 'signature_slam', e.x, e.y, 0, ctx.mine ? 2 : 1);
  },
  w_call_pack: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(2.2), SPIRIT, 500);
    ctx.juice.ring(p.x, p.y, ctx.rx(1.2), 0xffffff, 300);
    ctx.juice.embersAt(p.x, p.y - 18, 16, SPIRIT);
    ctx.dungeon.flashLight(p.x, p.y - 16, 220, SPIRIT, 1.8, 420);
    sfx(ctx, 'skill_rally', e.x, e.y, 0, ctx.mine ? 2 : 1);
  },
  w_ursine_call: (ctx, e) => {
    burst(ctx, e.x, e.y, 2.6, SPIRIT, 0xffffff, { dust: 18, sparks: 14, light: SPIRIT, shake: 0.016, ms: 380 });
    if (ctx.mine) ctx.juice.hitStop(70);
    sfx(ctx, 'signature_slam', e.x, e.y, 0, 3);
    sfx(ctx, 'skill_rally', e.x, e.y, 0, 1);
  },
  w_alpha_pounce: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.dust(p.x, p.y, 6, 0x4a3a28);
    ctx.juice.embersAt(p.x, p.y - 12, 8, SPIRIT);
    sfx(ctx, 'dodge', e.x, e.y, 0, 2);
  },
  w_alpha_land: (ctx, e) => {
    burst(ctx, e.x, e.y, 2.2, SPIRIT, LEAF, { dust: 14, sparks: 12, light: SPIRIT, shake: 0.012 });
    if (ctx.mine) ctx.juice.hitStop(60);
    sfx(ctx, 'signature_slam', e.x, e.y, 0, ctx.mine ? 3 : 1);
  },
  w_wolf_pounce: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.dust(p.x, p.y, 2, 0x3a4a30);
    ctx.juice.impact(p.x, p.y - 12, SPIRIT, 0.9);
    sfx(ctx, 'enemy_bite', e.x, e.y, 70, 1);
  },
  w_ursa_swipe: (ctx, e) => {
    slash(ctx, e, SPIRIT, 1.8, 26);
    sfx(ctx, 'skill_sweep', e.x, e.y, 90, 1);
  },
  w_thornburst: (ctx, e) => {
    burst(ctx, e.x, e.y, 2.8, THORN, VENOM, { sparks: 18, dust: 6, light: 0xc8d870, shake: ctx.mine ? 0.006 : 0 });
    sfx(ctx, 'signature_nova', e.x, e.y, 0, ctx.mine ? 2 : 1);
  },
  w_bramble_wall: (ctx, e) => {
    burst(ctx, e.x, e.y, 2.8, THORN, VENOM, { sparks: 16, dust: 8, light: 0xc8d870, shake: 0.008 });
    sfx(ctx, 'signature_nova', e.x, e.y, 0, ctx.mine ? 2 : 1);
    sfx(ctx, 'signature_slam', e.x, e.y, 0, 1);
  },
  w_thorn_pod: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, 18, VENOM, 240);
    sfx(ctx, 'enemy_shoot', e.x, e.y, 0, ctx.mine ? 2 : 1);
  },
  w_pod_burst: (ctx, e) => {
    burst(ctx, e.x, e.y, 3.2, THORN, VENOM, { sparks: 22, dust: 10, light: VENOM, shake: 0.012, ms: 360 });
    ctx.juice.embersAt(ctx.P(e.x, e.y).x, ctx.P(e.x, e.y).y - 10, 14, VENOM);
    sfx(ctx, 'signature_nova', e.x, e.y, 0, 2);
  },
  w_thorn_lash: (ctx, e) => {
    trail(ctx, e.x, e.y, e.dx, e.dy, THORN, 3, 200);
    const t = chest(ctx, e.dx, e.dy);
    ctx.juice.impact(t.x, t.y, THORN, 1);
    ctx.juice.sparksAt(t.x, t.y, 5, THORN);
    sfx(ctx, 'hit_enemy', e.dx, e.dy, 80, 1);
  },
  w_thorn_nova: (ctx, e) => {
    burst(ctx, e.x, e.y, 1.8, THORN, BLOOD, { sparks: 10 });
    sfx(ctx, 'skill_guard', e.x, e.y, 120, 1);
  },
  w_contagion: (ctx, e) => {
    trail(ctx, e.x, e.y, e.dx, e.dy, VENOM, 3, 320);
    const t = chest(ctx, e.dx, e.dy);
    ctx.juice.embersAt(t.x, t.y, 5, VENOM);
  },
  w_venom_bloom: (ctx, e) => {
    burst(ctx, e.x, e.y, 2, VENOM, THORN, { sparks: 12, light: VENOM });
    sfx(ctx, 'signature_nova', e.x, e.y, 120, 1);
  },
  w_bloodroot: (ctx, e) => {
    const t = chest(ctx, e.x, e.y);
    ctx.juice.impact(t.x, t.y, BLOOD, 1.4);
    ctx.juice.sparksAt(t.x, t.y, 10, BLOOD);
    ctx.juice.dust(t.x, t.y + 14, 4, 0x3a1a14);
    sfx(ctx, 'crit', e.x, e.y, 80, 1);
  },
  w_sprout: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(1.6), LEAF, 300);
    ctx.juice.dust(p.x, p.y, 5, 0x3a5a2a);
  },
});
