import * as Phaser from 'phaser';
import type { SfxId } from '../../audio/AudioEngine';
import { registerHazardFx, registerKillFx, registerProjectileFx, registerSkillFx, type CastFx, type FxCtx, type SnapHazard } from './registry';
import { castFlash, chestAt, heroGhosts, hitSpark, impactBurst, killPop, type Pal } from './spectacle';
import { fileSfx, skillLayer, skillSfx } from './kit3';
import { SKILL_FILE } from '../../audio/fileCues';

// Ranger presentation (cosmetic only). Forest green fletching, gold wind and steel; a red hunter's reticle for the
// Marksman, toxic green for poison and a hawk for the Wilds. Pixel textures live in art/fx/ranger.ts (fx:ranger:*).
// Sim conventions (simulation/src/classes/ranger.ts): r_hunters_mark / r_deadeye carry the target point in dx,dy;
// r_mark_leap and r_hawk_dive go from x,y to dx,dy; r_trap_spring carries the burst radius in dx; r_plague_spread
// the spread radius in dx; r_headshot / r_explosion / r_mark_applied / r_hawk_strike are positioned at x,y;
// r_snare_trap / r_bait / r_rain_of_arrows are at the target point (dx,dy aim). A Volley cast with count 'echo' is an
// Echoing Volley repeat. Everything else uses dx,dy as the aim direction from the caster at x,y.
// Hazards: ranger_rain (r), ranger_trap (r trigger, out burst radius; armed after ~0.4s), ranger_bait (lure r = 6,
// out burst radius), ranger_cloud (r), ranger_hawk (moving; dx,dy heading).

const GOLD = 0xffd27a;
const GOLD_HOT = 0xfff6d8;
const GREEN = 0x8fd86a;
const FEATHER = 0xa8f07a;
const LEATHER = 0xc8a06a;
const TOXIC = 0x9ef04a;
const MARK = 0xff3a2a;
const MARK_HOT = 0xffc0b0;
const STEEL = 0xd8dce4;
const WIND = 0xeaf6ff;
const ECHO = 0x8affd8;
const EMBER = 0xff8a3a;

const VOLLEY: Pal = { main: GOLD, hot: GOLD_HOT, deep: 0x8a5a20, bits: 'feather' };
const MARKP: Pal = { main: MARK, hot: MARK_HOT, deep: 0x6a0a0a, bits: 'star' };
const STEELP: Pal = { main: STEEL, hot: 0xffffff, deep: 0x5a606a, bits: 'star' };
const PLAGUE: Pal = { main: TOXIC, hot: 0xeaffb0, deep: 0x2a4a10, bits: 'bubble' };
const BLAST: Pal = { main: EMBER, hot: 0xffe0a0, deep: 0x5a1a08, bits: 'star' };

const DEG = 180 / Math.PI;

// ---------------- helpers ----------------

const lastSfx = new Map<string, number>();
function sfx(ctx: FxCtx, id: SfxId, x: number, y: number, minGapMs: number, priority = 1) {
  const t = lastSfx.get(id) ?? -1e9;
  if (ctx.now - t < minGapMs) return;
  lastSfx.set(id, ctx.now);
  ctx.sfx(id, x, y, priority);
}

/** Pooled one-shot sprites for this kit's own pixel textures (gusts, reticles, trap snaps). Decorative: skipped when
 *  effects are reduced or too many are alive. */
const pool = new Map<string, Phaser.GameObjects.Sprite[]>();
let liveFx = 0;
function grab(ctx: FxCtx, key: string, x: number, y: number): Phaser.GameObjects.Sprite | null {
  if (ctx.reduced || liveFx > 70 || !ctx.scene.textures.exists(key)) return null;
  const list = pool.get(key);
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
  let list = pool.get(key);
  if (!list) { list = []; pool.set(key, list); }
  if (list.length < 32) list.push(s); else s.destroy();
}
/** Play an animated fx sheet once, then recycle it. */
function playFx(ctx: FxCtx, key: string, x: number, y: number, o: { rot?: number; sx?: number; sy?: number; tint?: number; add?: boolean; depth?: number; ox?: number; oy?: number } = {}) {
  const s = grab(ctx, key, x, y);
  if (!s) return null;
  s.setRotation(o.rot ?? 0).setScale(o.sx ?? 1, o.sy ?? o.sx ?? 1).setOrigin(o.ox ?? 0.5, o.oy ?? 0.5).setDepth(o.depth ?? 4650);
  if (o.tint !== undefined) s.setTint(o.tint);
  if (o.add) s.setBlendMode(Phaser.BlendModes.ADD);
  if (ctx.scene.anims.exists(key)) { s.play(key); s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => release(key, s)); }
  else ctx.scene.tweens.add({ targets: s, alpha: 0, duration: 200, onComplete: () => release(key, s) });
  return s;
}

/** Gust of wind streaks leaving the bow along a screen angle. */
function gust(ctx: FxCtx, sx: number, sy: number, ang: number, tint: number, scale = 1) {
  playFx(ctx, 'fx:ranger:gust', sx, sy, { rot: ang, sx: scale, sy: scale * 0.9, tint, add: true, ox: 0.15, depth: 4652 });
}

/** The red hunter's reticle snapping onto a world point: slams in large and turning, holds, then fades. */
function reticle(ctx: FxCtx, x: number, y: number, scale = 1, hold = 600, tint?: number) {
  const c = chestAt(ctx, x, y);
  const s = grab(ctx, 'fx:ranger:reticle', c.x, c.y);
  if (!s) { ctx.juice.ring(c.x, c.y + 14, 16, MARK, 300); return; }
  s.setBlendMode(Phaser.BlendModes.ADD).setDepth(4662).setScale(2.4 * scale).setAngle(60).setAlpha(0.2);
  if (tint !== undefined) s.setTint(tint);
  ctx.scene.tweens.add({ targets: s, scale: 0.75 * scale, angle: 0, alpha: 1, duration: 170, ease: 'Back.easeOut' });
  ctx.scene.tweens.add({ targets: s, alpha: 0, scale: 0.6 * scale, delay: 170 + hold, duration: 200, ease: 'Quad.easeIn', onComplete: () => release('fx:ranger:reticle', s) });
}

/** The reticle bursting outward (headshots, crit kills). */
function reticleBurst(ctx: FxCtx, sx: number, sy: number, scale = 1) {
  const s = grab(ctx, 'fx:ranger:reticle', sx, sy);
  if (!s) return;
  s.setBlendMode(Phaser.BlendModes.ADD).setDepth(4662).setScale(0.8 * scale);
  ctx.scene.tweens.add({ targets: s, scale: 2.2 * scale, angle: 45, alpha: 0, duration: 260, ease: 'Cubic.easeOut', onComplete: () => release('fx:ranger:reticle', s) });
}

/** A fading tracer between two screen points (white core over a coloured body). */
function tracer(ctx: FxCtx, ax: number, ay: number, bx: number, by: number, color: number, width: number, ms = 180) {
  if (ctx.reduced) return;
  const g = ctx.scene.add.graphics().setDepth(4645).setBlendMode(Phaser.BlendModes.ADD);
  g.lineStyle(width + 2, color, 0.35).lineBetween(ax, ay, bx, by);
  g.lineStyle(width, color, 0.9).lineBetween(ax, ay, bx, by);
  g.lineStyle(Math.max(1, Math.round(width / 3)), 0xffffff, 1).lineBetween(ax, ay, bx, by);
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
}

/** Tracer between two world points at chest height. */
function streak(ctx: FxCtx, x0: number, y0: number, x1: number, y1: number, color: number, width: number, ms = 180) {
  const a = chestAt(ctx, x0, y0), b = chestAt(ctx, x1, y1);
  tracer(ctx, a.x, a.y, b.x, b.y, color, width, ms);
}

/** Lofted arc between two screen points (thrown traps and bait, Predator's Mark leaps), with bits along it. */
function lob(ctx: FxCtx, ax: number, ay: number, bx: number, by: number, color: number, kind: 'mote' | 'star' | 'feather', ms = 260) {
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

/** Hand point of a hero sprite (screen) or the event position as a fallback. */
function handOf(ctx: FxCtx, slot: number, x: number, y: number) {
  const s = ctx.actorSprite?.(slot);
  if (s && s.active) return { x: s.x, y: s.y - 18 };
  return chestAt(ctx, x, y, 18);
}

/** One Graphics with the whole fan of arrow streaks, so wider fans (Wide Fan) and narrower ones (Piercing) read. */
function fanStreaks(ctx: FxCtx, x: number, y: number, dx: number, dy: number, n: number, spreadDeg: number, lenPx: number, tint: number, ms = 170) {
  if (ctx.reduced) return;
  const c = chestAt(ctx, x, y);
  const g = ctx.scene.add.graphics().setDepth(4646).setBlendMode(Phaser.BlendModes.ADD);
  for (let i = 0; i < n; i++) {
    const a = n === 1 ? 0 : ((i - (n - 1) / 2) * spreadDeg) / DEG;
    const ca = Math.cos(a), sa = Math.sin(a);
    const u = ctx.U(dx * ca - dy * sa, dx * sa + dy * ca);
    const x0 = c.x + u.x * 10, y0 = c.y + u.y * 10, x1 = c.x + u.x * lenPx, y1 = c.y + u.y * lenPx;
    g.lineStyle(3, tint, 0.35).lineBetween(x0, y0, x1, y1);
    g.lineStyle(1, 0xffffff, 0.9).lineBetween(x0 + u.x * lenPx * 0.3, y0 + u.y * lenPx * 0.3, x1, y1);
  }
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
}

// ---------------- projectiles ----------------

registerProjectileFx({
  ranger_arrow: {
    key: 'fx:ranger:arrow', color: GOLD, additive: false, trail: 'mote', trailMs: 85,
    // Ricochet sends no cast event: its bounce is a plain arrow born at the struck foe. Traced back along its flight
    // (up to 0.3 s, whatever snapshot first shows it), a hero's arrow passes its archer; a bounce passes no hero.
    spawn: (ctx, pr, snap) => {
      const bx = pr.x - pr.vx * 0.3, by = pr.y - pr.vy * 0.3;
      const fromHero = snap.players.some((h) => {
        const lx = pr.x - bx, ly = pr.y - by, l2 = lx * lx + ly * ly || 1;
        const t = Math.max(0, Math.min(1, ((h.x - bx) * lx + (h.y - by) * ly) / l2));
        return (bx + lx * t - h.x) ** 2 + (by + ly * t - h.y) ** 2 < 0.9 * 0.9;
      });
      if (!fromHero) fileSfx(ctx, SKILL_FILE.r_ricochet!, null, pr.x, pr.y, 90);
    },
    end: (ctx, sx, sy) => { if (Math.random() < 0.45) ctx.juice.bits('feather', sx, sy, 1, FEATHER); },
  },
  ranger_heavy: {
    key: 'fx:ranger:heavy', color: 0xffe08a, additive: false, trail: 'feather', trailMs: 32,
    end: (ctx, sx, sy) => {
      ctx.juice.starburst(sx, sy, GOLD_HOT, 1, 160);
      ctx.juice.bits('feather', sx, sy, 5, GOLD);
      ctx.juice.sparksAt(sx, sy, 6, GOLD);
    },
  },
});

// ---------------- casts ----------------

type VolleyKind = 'multi' | 'barrage' | 'fan' | 'long' | 'tumble';

function volleyFx(ctx: FxCtx, e: CastFx, kind: VolleyKind) {
  const J = ctx.juice;
  const echo = e.count === 'echo';
  const wide = ctx.rank(e.slot, 'r_wide_fan');
  const pierce = ctx.rank(e.slot, 'r_piercing') > 0;
  const long = kind === 'long';
  const tumble = kind === 'tumble';
  const n = long ? 1 : tumble ? (ctx.rank(e.slot, 'r_wind_dancer') ? 5 : 3) : 5 + 2 * wide;
  const spread = tumble ? 14 : 12 * (pierce ? 0.7 : 1);
  const tint = echo ? ECHO : GOLD;
  const c = chestAt(ctx, e.x, e.y);
  const u = ctx.U(e.dx, e.dy);
  const ang = Math.atan2(u.y, u.x);
  const bx = c.x + u.x * 10, by = c.y + u.y * 10;
  const follow = kind === 'fan';
  // anticipation flash at the bow, then the release
  if (!follow) J.orb(bx, by, tint, long ? 0.6 : 0.4, 150, 1.9);
  J.starburst(bx, by, echo ? 0xeafff8 : GOLD_HOT, long ? 1 : 0.55, 130);
  gust(ctx, bx, by, ang, echo ? ECHO : WIND, long ? 1.5 : 1 + wide * 0.1);
  if (!long) fanStreaks(ctx, e.x, e.y, e.dx, e.dy, n, spread, 40 + n * 2, tint);
  const fanDeg = ((n - 1) * spread) || 20;
  J.bits('feather', bx, by, long ? 7 : 2 + Math.ceil(n / 2), echo ? ECHO : FEATHER, { angle: ang * DEG, spread: Math.min(150, fanDeg * 1.3 + 20), speed: long ? 1.8 : 1.3 });
  J.sparksAt(bx, by, long ? 10 : 3 + wide * 2, tint);
  ctx.dungeon.flashLight(bx, by, long ? 150 : 100, tint, long ? 2 : 1.3, 130);
  if (echo) heroGhosts(ctx, e.slot, e.dx, e.dy, ECHO, 2, 7);
  if (pierce && !follow) J.bits('star', bx + u.x * 10, by + u.y * 10, 2, WIND, { angle: ang * DEG, spread: 20, speed: 1.6 });
  if (long) {
    // a heavy shaft: long tracer, a sonic ring at the feet and gold wind peeling off
    streak(ctx, e.x, e.y, e.x + e.dx * 6, e.y + e.dy * 6, tint, 5, 240);
    const p = ctx.P(e.x, e.y);
    J.shockwave(p.x, p.y, ctx.rx(1.1), tint, 260);
    J.slash(bx + u.x * 14, by + u.y * 14, ang, WIND, 0.9, { thin: true, ms: 180 });
    if (ctx.mine && !echo) J.hitStop(30);
  }
  if (tumble) {
    const p = ctx.P(e.x, e.y);
    J.dust(p.x, p.y, 5, 0x5a4a30);
    heroGhosts(ctx, e.slot, e.dx, e.dy, ctx.rank(e.slot, 'r_wind_dancer') ? 0xbfefff : GOLD, 3, 8);
    if (ctx.rank(e.slot, 'r_wind_dancer')) J.ring(p.x, p.y, ctx.rx(1.4), 0xbfefff, 280);
  }
  // Point Blank springs the ranger backward: a dust kick and ghosts toward where they stood
  if (!follow && !tumble && ctx.rank(e.slot, 'r_point_blank')) {
    const p = ctx.P(e.x, e.y);
    J.dust(p.x, p.y, 5, 0x5a4a30);
    J.ring(p.x, p.y, ctx.rx(0.9), GOLD, 200);
    heroGhosts(ctx, e.slot, -e.dx, -e.dy, GOLD, 3, 9);
  }
  // Barrage follow-up fans are covered by the Barrage take (rapid repeated twangs)
  if (follow) skillLayer(ctx, 'r_barrage', 'bow_shot', e.x, e.y, 90, ctx.mine ? 2 : 1);
  else skillSfx(ctx, e.skill, 'bow_shot', e.x, e.y, 50, ctx.mine ? 2 : 1);
  // the heavy shaft rips the air; the tumble rolls
  if (long) skillLayer(ctx, e.skill, 'skill_sweep', e.x, e.y, 50, 1);
  else if (tumble) skillLayer(ctx, e.skill, 'dodge', e.x, e.y, 50, 1);
}

/** A marked shot from x,y to a target point: bow flash, tracer, red hit and the reticle locking on. */
function markShot(ctx: FxCtx, e: CastFx, power: number) {
  const J = ctx.juice;
  const a = chestAt(ctx, e.x, e.y), b = chestAt(ctx, e.dx, e.dy);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const bx = a.x + Math.cos(ang) * 10, by = a.y + Math.sin(ang) * 10;
  J.orb(bx, by, GOLD, 0.35, 120);
  gust(ctx, bx, by, ang, WIND, 0.9);
  tracer(ctx, bx, by, b.x, b.y, power > 1 ? MARK : GOLD, power > 1 ? 3 : 2, 220);
  J.bitsAlong('mote', bx, by, b.x, b.y, 3 + power, GOLD);
  hitSpark(ctx, e.dx, e.dy, MARKP, power);
  reticle(ctx, e.dx, e.dy, 1 + 0.12 * ctx.rank(e.slot, 'r_lingering_mark'), 650);
  const p = ctx.P(e.dx, e.dy);
  J.ring(p.x, p.y, ctx.rx(0.9), MARK, 360);
  if (ctx.rank(e.slot, 'r_exposed')) J.glyph(p.x, p.y, ctx.rx(1.1), MARK, 650);
}

const deadeyeAt = new Map<number, number>();

registerSkillFx({
  r_quick_shot: (ctx, e) => {
    const c = chestAt(ctx, e.x, e.y);
    const u = ctx.U(e.dx, e.dy);
    const bx = c.x + u.x * 10, by = c.y + u.y * 10;
    gust(ctx, bx, by, Math.atan2(u.y, u.x), WIND, 0.65);
    ctx.juice.sparksAt(bx, by, 2, GOLD);
    skillSfx(ctx, e.skill, 'bow_shot', e.x, e.y, 60, ctx.mine ? 1 : 0);
  },
  r_multishot: (ctx, e) => volleyFx(ctx, e, 'multi'),
  r_barrage: (ctx, e) => volleyFx(ctx, e, 'barrage'),
  r_barrage_fan: (ctx, e) => volleyFx(ctx, e, 'fan'),
  r_longshot: (ctx, e) => volleyFx(ctx, e, 'long'),
  r_tumble_shot: (ctx, e) => volleyFx(ctx, e, 'tumble'),
  r_power_shot: (ctx, e) => {
    const J = ctx.juice;
    const u = ctx.U(e.dx, e.dy);
    const c = chestAt(ctx, e.x, e.y);
    const ang = Math.atan2(u.y, u.x);
    const bx = c.x + u.x * 12, by = c.y + u.y * 12;
    castFlash(ctx, e.x, e.y, VOLLEY, 1.4, { dx: e.dx, dy: e.dy });
    streak(ctx, e.x, e.y, e.x + e.dx * 4.5, e.y + e.dy * 4.5, GOLD, 7, 240);
    streak(ctx, e.x, e.y, e.x + e.dx * 2.5, e.y + e.dy * 2.5, MARK, 3, 200);
    gust(ctx, bx, by, ang, WIND, 1.7);
    J.starburst(bx, by, GOLD_HOT, 1.4, 170);
    J.slash(bx + u.x * 16, by + u.y * 16, ang, GOLD, 1.1, { thin: true, ms: 200 });
    J.bits('feather', bx, by, 8, GOLD, { angle: ang * DEG, spread: 50, speed: 1.8 });
    const p = ctx.P(e.x, e.y);
    J.shockwave(p.x, p.y, ctx.rx(1.2), GOLD, 280);
    J.dust(p.x, p.y, 8, 0x5a4a30);
    ctx.dungeon.flashLight(bx, by, 160, GOLD, 2.2, 170);
    if (ctx.mine) J.hitStop(45);
    skillSfx(ctx, e.skill, 'bow_shot', e.x, e.y, 60, 2);
    skillLayer(ctx, e.skill, 'skill_sweep', e.x, e.y, 60, 1);   // the heavy arrow ripping the air
  },
  r_hunters_mark: (ctx, e) => {
    markShot(ctx, e, 1);
    skillSfx(ctx, e.skill, 'bow_shot', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  r_deadeye: (ctx, e) => {
    // three marked shots arrive in the same tick: the caster flourish plays once
    const last = deadeyeAt.get(e.slot) ?? -1e9;
    if (ctx.now - last > 60) {
      deadeyeAt.set(e.slot, ctx.now);
      castFlash(ctx, e.x, e.y, MARKP, 1.5, { glyph: true });
      if (ctx.mine) { ctx.juice.pop(MARK, 0.08, 150); ctx.juice.hitStop(40); }
      skillSfx(ctx, e.skill, 'bow_shot', e.x, e.y, 40, ctx.mine ? 2 : 1);   // the hits themselves play the central impacts
    }
    markShot(ctx, e, 2);
    const p = ctx.P(e.dx, e.dy);
    ctx.juice.beam(p.x, p.y, 70, 7, MARK, 260);
    ctx.juice.beam(p.x, p.y, 70, 2, MARK_HOT, 200);
  },
  r_mark_applied: (ctx, e) => {
    const c = chestAt(ctx, e.x, e.y);
    reticle(ctx, e.x, e.y, 1 + 0.12 * ctx.rank(e.slot, 'r_lingering_mark'), 600);
    ctx.juice.starburst(c.x, c.y, MARK_HOT, 0.9, 150);
    ctx.juice.ring(c.x, c.y + 14, ctx.rx(0.9), MARK, 340);
  },
  r_mark_leap: (ctx, e) => {
    const a = chestAt(ctx, e.x, e.y), b = chestAt(ctx, e.dx, e.dy);
    lob(ctx, a.x, a.y, b.x, b.y, MARK, 'star', 320);
    ctx.juice.starburst(a.x, a.y, MARK_HOT, 0.8, 140);
    reticle(ctx, e.dx, e.dy, 1, 650);
    ctx.juice.sparksAt(b.x, b.y, 6, MARK);
    sfx(ctx, 'blink', e.dx, e.dy, 80, 1);   // the mark zipping to its new target
  },
  r_headshot: (ctx, e) => {
    const J = ctx.juice;
    const c = chestAt(ctx, e.x, e.y, 18);
    J.starburst(c.x, c.y, MARK_HOT, 2.4, 220);
    J.starburst(c.x, c.y, MARK, 1.5, 300);
    J.orb(c.x, c.y, MARK, 1, 240);
    reticleBurst(ctx, c.x, c.y, 1.2);
    J.sparksAt(c.x, c.y, 18, MARK);
    J.bleed('player', c.x, c.y, 14);
    J.bits('skull', c.x, c.y - 6, 1, MARK_HOT);
    J.bits('star', c.x, c.y, 5, GOLD_HOT);
    J.number(c.x, c.y - 6, 'HEADSHOT', '#ff6a5a', 'md');
    const p = ctx.P(e.x, e.y);
    J.shockwave(p.x, p.y, ctx.rx(1), MARK, 260);
    ctx.dungeon.addDecal('blood', p.x, p.y + 3, 0x5a0a0a, 0.9);
    ctx.dungeon.flashLight(c.x, c.y, 170, MARK, 2.6, 220);
    if (ctx.mine) { J.hitStop(70); J.pop(MARK, 0.1, 160); }
    sfx(ctx, 'crit', e.x, e.y, 40, 3);
  },
  r_explosion: (ctx, e) => {
    // Explosive Tips fire on every Volley arrow hit: kept light
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    J.shockwave(p.x, p.y, ctx.rx(1.2), EMBER, 240);
    J.orb(p.x, p.y - 12, 0xffb060, 0.45, 160);
    J.sparksAt(p.x, p.y - 12, 5, 0xffb060);
    J.embersAt(p.x, p.y - 10, 3, EMBER);
    if (Math.random() < 0.25) ctx.dungeon.addDecal('scorch', p.x, p.y + 2, 0x1a1008, 0.6);
    ctx.dungeon.flashLight(p.x, p.y - 10, 90, EMBER, 1.4, 120);
    skillSfx(ctx, e.skill, 'impact_fire', e.x, e.y, 60, 0);   // fires on every Volley arrow hit: throttled
  },
  r_snare_trap: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const h = handOf(ctx, e.slot, e.x, e.y);
    lob(ctx, h.x, h.y, p.x, p.y - 4, STEEL, 'mote', 240);
    J.dust(p.x, p.y, 4, 0x5a4a30);
    J.sparksAt(p.x, p.y - 4, 4, STEEL);
    J.ring(p.x, p.y, ctx.rx(0.6), STEEL, 240);
    // placing: the recorded take is the snap (r_trap_spring), so the toss only plays while it is missing
    skillLayer(ctx, e.skill, 'throw_whoosh', e.x, e.y, 60, ctx.mine ? 1 : 0);
  },
  r_trap_volley: (ctx, e) => {
    const c = chestAt(ctx, e.x, e.y);
    ctx.juice.orb(c.x, c.y, LEATHER, 0.45, 160);
    ctx.juice.sparksAt(c.x, c.y, 5, STEEL);
    sfx(ctx, 'throw_whoosh', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  r_trap_spring: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const R = e.dx || 1.6;
    const blast = ctx.rank(e.slot, 'r_blast_traps') > 0;
    const venom = ctx.rank(e.slot, 'r_venom_snare') > 0;
    playFx(ctx, 'fx:ranger:snap', p.x, p.y - 8, { sx: 1.5 });
    if (blast) {
      impactBurst(ctx, e.x, e.y, R, BLAST, 2, { decal: 'scorch', decalTint: 0x1a1008 });
      J.embersAt(p.x, p.y - 10, 12, EMBER);
      skillLayer(ctx, 'r_snare_trap', 'blast_fire', e.x, e.y, 80, 1);
    } else if (venom) {
      impactBurst(ctx, e.x, e.y, R, PLAGUE, 2, { decal: 'slime', decalTint: 0x2a4a10 });
      J.bits('bubble', p.x, p.y - 8, 8, TOXIC);
      skillLayer(ctx, 'r_snare_trap', 'blast_decay', e.x, e.y, 80, 1);
    } else {
      impactBurst(ctx, e.x, e.y, R, STEELP, 2, { dust: 8 });
      // the Snare: a tight gold ring closing in
      J.shockwave(p.x, p.y, ctx.rx(R * 0.5), GOLD, 220, 80);
    }
    skillSfx(ctx, 'r_snare_trap', 'trap_snap', e.x, e.y, 50, 2);   // the snap (Snare Trap, Trap Volley and Bait bursts)
  },
  r_bait: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const h = handOf(ctx, e.slot, e.x, e.y);
    lob(ctx, h.x, h.y, p.x, p.y - 4, MARK, 'mote', 260);
    // the lure range (6 units) pulses out once so the pull reads
    J.shockwave(p.x, p.y, ctx.rx(6), MARK, 700, 80);
    J.ring(p.x, p.y, ctx.rx(2.2), STEEL, 300);
    J.bleed('pursuer', p.x, p.y - 6, 8);
    J.bits('mote', p.x, p.y - 8, 5, MARK);
    skillSfx(ctx, e.skill, 'throw_whoosh', e.x, e.y, 60, ctx.mine ? 2 : 1);
    skillLayer(ctx, e.skill, 'skill_rally', e.x, e.y, 60, 1);   // the lure calling
  },
  r_rain_of_arrows: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    // the volley goes up from the ranger...
    const h = handOf(ctx, e.slot, e.x, e.y);
    J.beam(h.x, h.y + 6, 110, 5, GOLD, 260);
    gust(ctx, h.x, h.y, -Math.PI / 2, WIND, 1.3);
    J.bits('feather', h.x, h.y, 8, FEATHER, { angle: -90, spread: 40, speed: 1.8 });
    J.starburst(h.x, h.y, GOLD_HOT, 1.1, 160);
    // ...and the sky darkens over the target
    J.glyph(p.x, p.y, ctx.rx(3.2), GOLD, 1000);
    J.shockwave(p.x, p.y, ctx.rx(3.2), GOLD, 520, 160);
    J.ring(p.x, p.y, ctx.rx(1.6), GOLD_HOT, 360);
    ctx.dungeon.flashLight(p.x, p.y - 30, 260, GOLD, 2, 700);
    if (ctx.mine) J.pop(GOLD, 0.08, 200);
    skillSfx(ctx, e.skill, 'bow_shot', e.x, e.y, 0, 3);
    skillLayer(ctx, e.skill, 'cine_whoosh', e.x, e.y, 0, 1);   // the volley rising and falling
  },
  r_hawk_dive: (ctx, e) => {
    hawkDove(ctx, e);
    const a = chestAt(ctx, e.x, e.y, 30), b = chestAt(ctx, e.dx, e.dy);
    tracer(ctx, a.x, a.y, b.x, b.y, LEATHER, 2, 260);
    ctx.juice.bitsAlong('feather', a.x, a.y, b.x, b.y, 3, LEATHER);
    skillSfx(ctx, e.skill, 'swing', e.x, e.y, 120, 0);
  },
  r_hawk_strike: (ctx, e) => {
    const J = ctx.juice;
    const c = chestAt(ctx, e.x, e.y);
    const u = ctx.U(e.dx || 1, e.dy);
    const apex = ctx.rank(e.slot, 'r_apex_predator') > 0;
    J.claw(c.x, c.y, Math.atan2(u.y, u.x) + Math.PI / 2, apex ? MARK : GOLD, 0.9, 220);
    J.starburst(c.x, c.y, GOLD_HOT, 0.8, 140);
    J.bits('feather', c.x, c.y, 5, LEATHER);
    J.sparksAt(c.x, c.y, 6, apex ? MARK : LEATHER);
    if (apex) reticle(ctx, e.x, e.y, 0.7, 380);
    if (ctx.rank(e.slot, 'r_poison_tips')) J.bits('bubble', c.x, c.y, 2, TOXIC);
    sfx(ctx, 'blade_flurry', e.x, e.y, 80, 1);   // raking talons
  },
  r_plague_spread: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const R = e.dx || 3;
    J.shockwave(p.x, p.y, ctx.rx(R), TOXIC, 420);
    J.ring(p.x, p.y, ctx.rx(R * 0.5), 0xeaffb0, 260);
    J.orb(p.x, p.y - 10, TOXIC, 0.8, 260);
    J.bits('bubble', p.x, p.y - 10, 10, TOXIC);
    J.bits('skull', p.x, p.y - 16, 2, 0xd8f0b0);
    J.bits('mote', p.x, p.y - 8, 6, TOXIC, { speed: 2.4 });
    ctx.dungeon.addDecal('slime', p.x, p.y + 3, 0x2a4a10, 1.1);
    ctx.dungeon.flashLight(p.x, p.y - 10, 150, TOXIC, 1.6, 240);
    sfx(ctx, 'blast_decay', e.x, e.y, 120, 1);
  },
});

registerKillFx({
  ranger: (ctx, k) => {
    const J = ctx.juice;
    const c = chestAt(ctx, k.x, k.y, 12);
    const big = k.big || k.elite > 0 || k.boss;
    J.bits('feather', c.x, c.y, big ? 7 : 3, FEATHER);
    if (k.crit) { J.starburst(c.x, c.y, MARK_HOT, big ? 1.4 : 1, 160); reticleBurst(ctx, c.x, c.y, big ? 1.1 : 0.7); }
    if (k.dtype === 'decay') J.bits('bubble', c.x, c.y, big ? 6 : 3, TOXIC);
    if (big) killPop(ctx, k.x, k.y, VOLLEY, true, k.elite);
  },
});

// ---------------- hazard views (pooled sprites keyed by hazard id) ----------------

interface View {
  spr: Phaser.GameObjects.Sprite[];
  cyc: number[];
  lastSeen: number;
  first: number;
  pulse: number;
  x: number; y: number; t: number;
  diveUntil: number;
  slot: number;
}
const views = new Map<number, View>();
let sweepScene: Phaser.Scene | null = null;

function ensureSweep(scene: Phaser.Scene) {
  if (sweepScene === scene) return;
  sweepScene = scene;
  const sweep = () => {
    const now = scene.time.now;
    for (const [id, v] of views) {
      if (now - v.lastSeen < 160) continue;
      v.spr.forEach((s) => s.destroy());
      views.delete(id);
    }
  };
  scene.events.on(Phaser.Scenes.Events.POST_UPDATE, sweep);
  const reset = () => {
    scene.events.off(Phaser.Scenes.Events.POST_UPDATE, sweep);
    for (const v of views.values()) v.spr.forEach((s) => s.destroy());
    views.clear(); sweepScene = null; pool.clear(); liveFx = 0;
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, reset);
  scene.events.once(Phaser.Scenes.Events.DESTROY, reset);
}

function viewOf(ctx: FxCtx, h: SnapHazard): View {
  ensureSweep(ctx.scene);
  let v = views.get(h.i);
  if (!v) { v = { spr: [], cyc: [], lastSeen: ctx.now, first: ctx.now, pulse: -1, x: h.x, y: h.y, t: ctx.now, diveUntil: 0, slot: -1 }; views.set(h.i, v); }
  v.lastSeen = ctx.now;
  return v;
}

function smoothed(ctx: FxCtx, v: View, h: SnapHazard) {
  const dt = Math.min(100, Math.max(0, ctx.now - v.t));
  v.t = ctx.now;
  if (Math.hypot(h.x - v.x, h.y - v.y) > 4) { v.x = h.x; v.y = h.y; return; }
  const k = 1 - Math.exp(-dt / 40);
  v.x += (h.x - v.x) * k; v.y += (h.y - v.y) * k;
}

/** A hawk dive event: the hawk nearest its start point folds its wings for the stoop. */
function hawkDove(ctx: FxCtx, e: CastFx) {
  let best: View | undefined, bd = 4;
  for (const v of views.values()) {
    if (!v.spr.length || v.spr[0]!.texture.key !== 'fx:ranger:hawk') continue;
    const d = Math.hypot(v.x - e.x, v.y - e.y);
    if (d < bd) { bd = d; best = v; }
  }
  if (best) { best.diveUntil = ctx.now + 700; best.slot = e.slot; }
}

function ellipse(ctx: FxCtx, g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, fill: number, alpha: number, stroke?: number, lw = 2, strokeAlpha = 1) {
  const p = ctx.P(x, y);
  if (alpha > 0) g.fillStyle(fill, alpha).fillEllipse(p.x, p.y, ctx.rx(r) * 2, ctx.ry(r) * 2, 40);
  if (stroke !== undefined) g.lineStyle(lw, stroke, strokeAlpha).strokeEllipse(p.x, p.y, ctx.rx(r) * 2, ctx.ry(r) * 2, 40);
}

/** Dashed ellipse (trap and bait burst footprints) and an optional progress arc over it. */
function dashed(ctx: FxCtx, g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, color: number, alpha: number, lw = 1, segs = 20, rot = 0) {
  const p = ctx.P(x, y);
  const rx = ctx.rx(r), ry = ctx.ry(r);
  g.lineStyle(lw, color, alpha);
  for (let i = 0; i < segs; i++) {
    const a0 = rot + (i / segs) * Math.PI * 2, a1 = a0 + (Math.PI * 2 / segs) * 0.55;
    g.lineBetween(p.x + Math.cos(a0) * rx, p.y + Math.sin(a0) * ry, p.x + Math.cos(a1) * rx, p.y + Math.sin(a1) * ry);
  }
}
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

const hash = (a: number, b: number) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const FALL = 120, DRIFT = 12;
const FALL_ROT = Math.atan2(FALL, DRIFT);

registerHazardFx({
  ranger_rain: (ctx, g, h, tick) => {
    const v = viewOf(ctx, h);
    const left = (h.u - tick) / 60;
    const age = tick - h.b;
    const a = Math.max(0, Math.min(1, left / 0.3, (ctx.now - v.first) / 150 + (age > 6 ? 1 : 0)));
    const c = ctx.P(h.x, h.y);
    const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
    // darkened ground under the storm, with a readable gold edge
    ellipse(ctx, g, h.x, h.y, h.r, 0x0a0804, 0.3 * a);
    ellipse(ctx, g, h.x, h.y, h.r * 0.7, 0x1a1408, 0.18 * a);
    ellipse(ctx, g, h.x, h.y, h.r, 0, 0, GOLD, 2, 0.75 * a);
    ellipse(ctx, g, h.x, h.y, h.r * 0.93, 0, 0, GOLD, 1, 0.3 * a);
    // arrows already stuck in the ground pile up over the 3s
    const stuck = Math.min(28, Math.floor(age / 4));
    for (let i = 0; i < stuck; i++) {
      const ang = hash(h.i, i) * Math.PI * 2, rad = Math.sqrt(hash(i, h.i + 7)) * 0.92;
      const gx = c.x + Math.cos(ang) * rx * rad, gy = c.y + Math.sin(ang) * ry * rad;
      const lean = (hash(i, 3) - 0.5) * 4;
      g.lineStyle(1, 0x6a4422, a).lineBetween(gx, gy, gx - 2 + lean, gy - 7);
      g.fillStyle(FEATHER, a).fillRect(gx - 3 + lean, gy - 9, 2, 2);
    }
    // damage pulse every 0.25s
    const k = Math.floor(age / 15);
    if (k !== v.pulse && age > 0) {
      v.pulse = k;
      ctx.juice.ring(c.x, c.y, rx * 0.98, GOLD, 240);
    }
    // falling arrows: pooled sprites streaking down at seeded spots, re-seeded every cycle
    if (ctx.reduced || !ctx.scene.textures.exists('fx:ranger:arrow')) {
      for (let i = 0; i < 10; i++) {
        const ph = ((ctx.now / 260) + i / 10) % 1;
        const ang = hash(h.i, i + 40) * Math.PI * 2, rad = Math.sqrt(hash(i + 40, h.i));
        const gx = c.x + Math.cos(ang) * rx * rad, gy = c.y + Math.sin(ang) * ry * rad;
        const top = gy - 90 * (1 - ph);
        g.lineStyle(2, LEATHER, 0.9 * a).lineBetween(gx - 8 * (1 - ph) - 3, top - 10, gx - 8 * (1 - ph), top);
      }
      return;
    }
    if (!v.spr.length) {
      const n = Math.round(10 + 18 * Math.min(1, ctx.particles));
      for (let i = 0; i < n; i++) {
        v.spr.push(ctx.scene.add.sprite(0, 0, 'fx:ranger:arrow').setRotation(FALL_ROT).setDepth(4600).setScale(0.9).setVisible(false));
        v.cyc.push(-1);
      }
    }
    const n = v.spr.length;
    for (let i = 0; i < n; i++) {
      const s = v.spr[i]!;
      const tt = ctx.now / 300 + i / n;
      const cyc = Math.floor(tt), ph = tt - cyc;
      const ang = hash(h.i + cyc * 31, i) * Math.PI * 2, rad = Math.sqrt(hash(i, h.i + cyc * 17)) * 0.95;
      const gx = c.x + Math.cos(ang) * rx * rad, gy = c.y + Math.sin(ang) * ry * rad;
      const fall = 1 - ph;
      s.setVisible(left > 0.15).setPosition(Math.round(gx - DRIFT * fall - 1), Math.round(gy - FALL * fall - 10)).setAlpha(a * Math.min(1, ph * 6));
      if (v.cyc[i] !== cyc) {
        if (v.cyc[i]! >= 0 && Math.random() < 0.18) {
          const oa = hash(h.i + (cyc - 1) * 31, i) * Math.PI * 2, orad = Math.sqrt(hash(i, h.i + (cyc - 1) * 17)) * 0.95;
          ctx.juice.sparksAt(c.x + Math.cos(oa) * rx * orad, c.y + Math.sin(oa) * ry * orad - 2, 2, GOLD);
        }
        v.cyc[i] = cyc;
      }
    }
    if (!ctx.reduced && Math.random() < 0.12) {
      const t = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random());
      ctx.juice.dust(c.x + Math.cos(t) * rx * r, c.y + Math.sin(t) * ry * r, 1, 0x5a4a30);
    }
  },
  ranger_trap: (ctx, g, h, tick) => {
    const v = viewOf(ctx, h);
    const p = ctx.P(h.x, h.y);
    const armed = tick - h.b >= 24;
    const R = h.out || 1.6;
    ellipse(ctx, g, h.x, h.y, Math.max(0.45, h.r), 0x1a140c, 0.4);
    if (armed) {
      // the burst footprint, slowly turning, so allies can see where it bites
      dashed(ctx, g, h.x, h.y, R, STEEL, 0.32 + 0.12 * Math.sin(ctx.now / 260 + h.i), 1, 18, ctx.now / 2400);
    } else {
      arcProgress(ctx, g, h.x, h.y, 0.75, Math.min(1, (tick - h.b) / 24), GOLD, 0.8, 2);
    }
    if (!ctx.scene.textures.exists('fx:ranger:trap')) {
      ellipse(ctx, g, h.x, h.y, 0.45, 0x2a241c, 0.85, STEEL, 2, armed ? 1 : 0.5);
      return;
    }
    if (!v.spr.length) {
      const s = ctx.scene.add.sprite(0, 0, 'fx:ranger:trap').setDepth(-72);
      ctx.dungeon.litObject(s);
      v.spr.push(s);
      s.setScale(0.4, 0.2);
      ctx.scene.tweens.add({ targets: s, scaleX: 1, scaleY: 1, duration: 180, ease: 'Back.easeOut' });
    }
    const s = v.spr[0]!;
    s.setPosition(Math.round(p.x), Math.round(p.y)).setFrame(armed ? 1 : 0);
    if (armed && v.pulse < 0) {
      v.pulse = 1;
      ctx.juice.starburst(p.x, p.y - 2, GOLD_HOT, 0.45, 140);
    }
    if (armed && Math.floor(ctx.now / 1100 + h.i * 0.37) % 4 === 0) g.fillStyle(0xffffff, 0.9).fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2);
  },
  ranger_bait: (ctx, g, h, tick) => {
    const v = viewOf(ctx, h);
    const total = Math.max(1, h.u - h.b), prog = Math.min(1, (tick - h.b) / total);
    const p = ctx.P(h.x, h.y);
    // lure: red scent rings drawn inward from the 6 unit pull radius
    ellipse(ctx, g, h.x, h.y, h.r, MARK, 0.04, MARK, 1, 0.35);
    for (let k = 0; k < 3; k++) {
      const ph = ((ctx.now / 900) + k / 3) % 1;
      ellipse(ctx, g, h.x, h.y, h.r * (1 - ph) + 0.4, 0, 0, MARK, 1, 0.12 + 0.4 * ph);
    }
    // the burst footprint with a countdown arc closing to the snap
    const R = h.out || 2.2;
    dashed(ctx, g, h.x, h.y, R, STEEL, 0.55, 1, 16);
    arcProgress(ctx, g, h.x, h.y, R, prog, GOLD, 0.9, 2);
    if (ctx.scene.textures.exists('fx:ranger:bait')) {
      if (!v.spr.length) { const s = ctx.scene.add.sprite(0, 0, 'fx:ranger:bait').setDepth(-71).setOrigin(0.5, 0.8); ctx.dungeon.litObject(s); v.spr.push(s); }
      v.spr[0]!.setPosition(Math.round(p.x), Math.round(p.y + Math.sin(ctx.now / 120) * (prog > 0.75 ? 1 : 0)));
    } else {
      g.fillStyle(0x7a2a20, 1).fillEllipse(p.x, p.y - 3, 10, 6, 12);
    }
    if (!ctx.reduced && Math.random() < 0.07) ctx.juice.bits('mote', p.x + (Math.random() - 0.5) * 10, p.y - 6, 1, MARK);
  },
  ranger_cloud: (ctx, g, h, tick) => {
    // Venom Cloud has no cast event: its recorded hiss plays once when the cloud appears (silent until the file lands)
    const v = viewOf(ctx, h);
    if (v.pulse < 0) { v.pulse = 1; fileSfx(ctx, SKILL_FILE.r_venom_cloud!, null, h.x, h.y, 120, 1); }
    const left = (h.u - tick) / 60;
    const a = Math.max(0, Math.min(1, left / 0.5, (tick - h.b) / 12));
    const c = ctx.P(h.x, h.y);
    const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
    // churning toxic billows inside a readable rim
    for (let k = 0; k < 5; k++) {
      const ang = k * 1.2566 + ctx.now / 2400 + h.i;
      const bx = c.x + Math.cos(ang) * rx * 0.38, by = c.y + Math.sin(ang) * ry * 0.38;
      g.fillStyle(0x3a6a14, 0.14 * a).fillEllipse(bx, by, rx * 1.1, ry * 1.1, 24);
      g.fillStyle(TOXIC, 0.08 * a).fillEllipse(bx, by - 3, rx * 0.7, ry * 0.7, 20);
    }
    ellipse(ctx, g, h.x, h.y, h.r, 0, 0, TOXIC, 2, 0.6 * a);
    ellipse(ctx, g, h.x, h.y, h.r * 0.95, 0, 0, 0xd8ff8a, 1, 0.22 * a);
    for (let i = 0; i < 7; i++) {
      const ph = ((ctx.now / 900) + i / 7) % 1;
      const ang = i * 2.1 + h.i;
      const bx = c.x + Math.cos(ang) * rx * 0.6, by = c.y + Math.sin(ang) * ry * 0.6 - ph * 18;
      g.lineStyle(1, 0xc8ff8a, 0.6 * a * (1 - ph)).strokeCircle(bx, by, 2 + ph * 3);
    }
    if (!ctx.reduced && Math.random() < 0.06) {
      const t = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.8;
      ctx.juice.bits(Math.random() < 0.12 ? 'skull' : 'bubble', c.x + Math.cos(t) * rx * r, c.y + Math.sin(t) * ry * r - 4, 1, TOXIC);
    }
  },
  ranger_hawk: (ctx, ground, h) => {
    const v = viewOf(ctx, h);
    smoothed(ctx, v, h);
    const p = ctx.P(v.x, v.y);
    const diving = ctx.now < v.diveUntil;
    const lift = diving ? 12 + 18 * Math.max(0, (v.diveUntil - ctx.now) / 700) : 30 + Math.sin(ctx.now / 400 + h.i) * 2;
    ground.fillStyle(0x000000, 0.22).fillEllipse(p.x, p.y, diving ? 12 : 16, diving ? 5 : 6, 12);
    const u = ctx.U(h.dx || 1, h.dy);
    const ang = Math.atan2(u.y, u.x);
    if (!ctx.scene.textures.exists('fx:ranger:hawk')) return;
    if (!v.spr.length) v.spr.push(ctx.scene.add.sprite(0, 0, 'fx:ranger:hawk').setDepth(4612));
    const s = v.spr[0]!;
    const frame = diving ? 4 : Math.floor(ctx.now / 85 + h.i) % 4;
    s.setFrame(frame).setPosition(Math.round(p.x), Math.round(p.y - lift)).setRotation(ang);
    if (diving && !ctx.reduced) {
      const apex = v.slot >= 0 && ctx.rank(v.slot, 'r_apex_predator') > 0;
      if (Math.random() < 0.5) ctx.juice.afterimage(s, apex ? MARK : GOLD, 0.4, 200);
      if (Math.random() < 0.2) ctx.juice.bits('feather', s.x, s.y, 1, LEATHER);
    }
  },
}, { ranger_rain: GOLD, ranger_trap: STEEL, ranger_cloud: TOXIC, ranger_bait: MARK });
