import * as Phaser from 'phaser';
import type { SfxId } from '../../audio/AudioEngine';
import { registerHazardFx, registerProjectileFx, registerSkillFx, type CastFx, type FxCtx, type SnapHazard } from './registry';

// Ranger presentation (cosmetic only). Forest green, leather and gold: arrow storms, snapping traps, a hawk.
// Sim conventions (simulation/src/classes/ranger.ts): r_hunters_mark / r_deadeye carry the target point in dx,dy;
// r_mark_leap and r_hawk_dive go from x,y to dx,dy; r_trap_spring carries the burst radius in dx; r_plague_spread
// the spread radius in dx; r_headshot / r_explosion / r_mark_applied / r_hawk_strike are positioned at x,y.
// A Volley cast with count 'echo' is an Echoing Volley repeat. Everything else uses dx,dy as the aim direction.
// Hazards: ranger_rain (r), ranger_trap (armed after ~0.4s), ranger_bait (lure r = 6), ranger_cloud (r), ranger_hawk
// (moving; dx,dy heading).

const GREEN = 0x8fd86a;
const LEATHER = 0xc8a06a;
const GOLD = 0xffd890;
const TOXIC = 0x9ae04a;
const MARK = 0xff5a4a;
const STEEL = 0xd8dce4;

// ---------------- textures (generated once; art-agent textures win when present) ----------------

let sceneRef: Phaser.Scene | null = null;
function ensureTextures(scene: Phaser.Scene) {
  sceneRef = scene;
  if (scene.textures.exists('fx:ranger_arrow_gen')) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  // arrow pointing east (18x6): green fletching, wooden shaft, steel head
  g.fillStyle(0x5a8a3a, 1).fillTriangle(0, 0, 4, 3, 0, 6);
  g.fillStyle(GREEN, 1).fillTriangle(1, 0.5, 4, 3, 1, 3);
  g.fillStyle(0x8a6a40, 1).fillRect(2, 2.5, 12, 1.2);
  g.fillStyle(STEEL, 1).fillTriangle(13, 0.8, 18, 3, 13, 5.2);
  g.fillStyle(0xffffff, 1).fillRect(15, 2.5, 2, 1);
  g.generateTexture('fx:ranger_arrow_gen', 18, 6);
  g.clear();
  // heavy arrow (24x8)
  g.fillStyle(0x5a8a3a, 1).fillTriangle(0, 0, 6, 4, 0, 8);
  g.fillStyle(GOLD, 1).fillTriangle(1, 1, 6, 4, 1, 4);
  g.fillStyle(0x7a5a30, 1).fillRect(3, 3.2, 15, 1.8);
  g.fillStyle(STEEL, 1).fillTriangle(17, 0.5, 24, 4, 17, 7.5);
  g.fillStyle(0xffffff, 1).fillRect(20, 3.3, 3, 1.4);
  g.generateTexture('fx:ranger_heavy_gen', 24, 8);
  g.destroy();
}
const texKey = (art: string, gen: string, fallback: string) =>
  sceneRef?.textures.exists(art) ? art : sceneRef?.textures.exists(gen) ? gen : fallback;

registerProjectileFx({
  ranger_arrow: { get key() { return texKey('fx:arrow', 'fx:ranger_arrow_gen', 'fx:shard'); }, color: GOLD },
  ranger_heavy: { get key() { return texKey('fx:arrow_heavy', 'fx:ranger_heavy_gen', 'fx:shard'); }, color: GREEN, scale: 1.2 },
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

/** A fading streak between two world points at chest height. */
function streak(ctx: FxCtx, x0: number, y0: number, x1: number, y1: number, color: number, width: number, ms = 180) {
  if (ctx.reduced) return;
  const a = chest(ctx, x0, y0), b = chest(ctx, x1, y1);
  const g = ctx.scene.add.graphics().setDepth(4645).setBlendMode(Phaser.BlendModes.ADD);
  g.lineStyle(width, color, 0.85).lineBetween(a.x, a.y, b.x, b.y);
  g.lineStyle(Math.max(1, width / 3), 0xffffff, 1).lineBetween(a.x, a.y, b.x, b.y);
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
}

/** Target reticle at a world point (marks). */
function reticle(ctx: FxCtx, x: number, y: number, color: number, ms = 420) {
  if (ctx.reduced) return;
  const c = chest(ctx, x, y);
  const g = ctx.scene.add.graphics().setDepth(4648).setBlendMode(Phaser.BlendModes.ADD);
  g.lineStyle(2, color, 1).strokeCircle(0, 0, 11);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    g.lineBetween(Math.cos(a) * 7, Math.sin(a) * 7, Math.cos(a) * 16, Math.sin(a) * 16);
  }
  g.setPosition(c.x, c.y).setScale(1.8);
  ctx.scene.tweens.add({ targets: g, scale: 1, angle: 45, duration: 180, ease: 'Back.easeOut' });
  ctx.scene.tweens.add({ targets: g, alpha: 0, delay: ms - 160, duration: 160, onComplete: () => g.destroy() });
}

function volleyFx(ctx: FxCtx, e: CastFx, heavy: boolean) {
  ensureTextures(ctx.scene);
  const u = ctx.U(e.dx, e.dy);
  const c = chest(ctx, e.x, e.y);
  const echo = e.count === 'echo';
  ctx.juice.arc(c.x + u.x * 14, c.y + u.y * 14, Math.atan2(u.y, u.x), echo ? GREEN : GOLD, heavy ? 1.2 : 1.5);
  ctx.juice.sparksAt(c.x + u.x * 12, c.y + u.y * 12, heavy ? 10 : 6, GOLD);
  ctx.dungeon.flashLight(c.x, c.y, 90, GOLD, 1.1, 110);
  if (heavy) streak(ctx, e.x, e.y, e.x + e.dx * 3, e.y + e.dy * 3, GOLD, 5, 160);
  if (ctx.mine && !echo) ctx.juice.shake(heavy ? 0.006 : 0.003, heavy ? 110 : 70);
  sfx(ctx, heavy ? 'skill_arc' : 'skill_sweep', e.x, e.y, 60, ctx.mine ? 2 : 1);
}

registerSkillFx({
  r_quick_shot: (ctx, e) => {
    ensureTextures(ctx.scene);
    const u = ctx.U(e.dx, e.dy);
    const c = chest(ctx, e.x, e.y);
    ctx.juice.sparksAt(c.x + u.x * 10, c.y + u.y * 10, 2, GOLD);
    sfx(ctx, 'swing', e.x, e.y, 70, ctx.mine ? 1 : 0);
  },
  r_multishot: (ctx, e) => volleyFx(ctx, e, false),
  r_barrage: (ctx, e) => volleyFx(ctx, e, false),
  r_barrage_fan: (ctx, e) => volleyFx(ctx, e, false),
  r_longshot: (ctx, e) => volleyFx(ctx, e, true),
  r_tumble_shot: (ctx, e) => {
    volleyFx(ctx, e, false);
    const p = ctx.P(e.x, e.y);
    ctx.juice.dust(p.x, p.y, 5, 0x5a4a30);
  },
  r_power_shot: (ctx, e) => {
    ensureTextures(ctx.scene);
    const u = ctx.U(e.dx, e.dy);
    const c = chest(ctx, e.x, e.y);
    streak(ctx, e.x, e.y, e.x + e.dx * 4, e.y + e.dy * 4, GOLD, 7, 220);
    ctx.juice.impact(c.x + u.x * 16, c.y + u.y * 16, GOLD, 1.8);
    ctx.juice.dust(ctx.P(e.x, e.y).x, ctx.P(e.x, e.y).y, 8, 0x5a4a30);
    ctx.dungeon.flashLight(c.x, c.y, 140, GOLD, 2, 160);
    if (ctx.mine) { ctx.juice.shake(0.01, 160); ctx.juice.hitStop(40); }
    sfx(ctx, 'signature_slam', e.x, e.y, 60, 2);
  },
  r_hunters_mark: (ctx, e) => {
    ensureTextures(ctx.scene);
    streak(ctx, e.x, e.y, e.dx, e.dy, GOLD, 3, 200);
    reticle(ctx, e.dx, e.dy, MARK, 600);
    sfx(ctx, 'skill_phase', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  r_deadeye: (ctx, e) => {
    ensureTextures(ctx.scene);
    streak(ctx, e.x, e.y, e.dx, e.dy, GOLD, 3, 220);
    reticle(ctx, e.dx, e.dy, MARK, 520);
    const c = chest(ctx, e.dx, e.dy);
    ctx.juice.sparksAt(c.x, c.y, 6, GOLD);
    sfx(ctx, 'skill_arc', e.x, e.y, 40, ctx.mine ? 2 : 1);
  },
  r_mark_applied: (ctx, e) => reticle(ctx, e.x, e.y, MARK, 500),
  r_mark_leap: (ctx, e) => { streak(ctx, e.x, e.y, e.dx, e.dy, MARK, 3, 260); reticle(ctx, e.dx, e.dy, MARK, 500); sfx(ctx, 'skill_phase', e.dx, e.dy, 80, 1); },
  r_headshot: (ctx, e) => {
    const J = ctx.juice;
    const c = chest(ctx, e.x, e.y);
    J.impact(c.x, c.y, MARK, 2.4);
    J.sparksAt(c.x, c.y, 18, MARK);
    J.bleed('player', c.x, c.y, 14);
    J.number(c.x, c.y - 6, 'HEADSHOT', '#ff6a5a', 'md');
    ctx.dungeon.flashLight(c.x, c.y, 160, MARK, 2.4, 200);
    if (ctx.mine) { J.hitStop(70); J.shake(0.008, 140); }
    sfx(ctx, 'crit', e.x, e.y, 40, 3);
  },
  r_explosion: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(1.2), 0xff9a3a, 220);
    ctx.juice.sparksAt(p.x, p.y - 12, 8, 0xffb060);
    ctx.juice.dust(p.x, p.y, 3, 0x3a2a20);
    sfx(ctx, 'hit_enemy', e.x, e.y, 50, 0);
  },
  r_snare_trap: (ctx, e) => {
    ensureTextures(ctx.scene);
    const p = ctx.P(e.x, e.y);
    ctx.juice.dust(p.x, p.y, 4, 0x5a4a30);
    ctx.juice.sparksAt(p.x, p.y - 4, 4, STEEL);
    sfx(ctx, 'swing', e.x, e.y, 60, ctx.mine ? 1 : 0);
  },
  r_trap_volley: (ctx, e) => sfx(ctx, 'skill_sweep', e.x, e.y, 60, ctx.mine ? 2 : 1),
  r_trap_spring: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const R = e.dx || 1.6;
    J.ring(p.x, p.y, ctx.rx(R), STEEL, 260);
    J.ring(p.x, p.y, ctx.rx(R * 0.5), GOLD, 200);
    J.sparksAt(p.x, p.y - 6, 14, STEEL);
    J.dust(p.x, p.y, 8, 0x5a4a30);
    ctx.dungeon.flashLight(p.x, p.y - 8, 120, GOLD, 1.6, 160);
    J.shake(0.006, 110);
    sfx(ctx, 'enemy_bite', e.x, e.y, 50, 2);
  },
  r_bait: (ctx, e) => {
    ensureTextures(ctx.scene);
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(6), MARK, 500);
    ctx.juice.bleed('pursuer', p.x, p.y - 6, 8);
    sfx(ctx, 'skill_rally', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  r_rain_of_arrows: (ctx, e) => {
    ensureTextures(ctx.scene);
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(3.2), GOLD, 520);
    ctx.dungeon.flashLight(p.x, p.y - 30, 240, GOLD, 1.8, 600);
    if (ctx.mine) ctx.juice.shake(0.006, 160);
    sfx(ctx, 'skill_rally', e.x, e.y, 0, 3);
  },
  r_hawk_dive: (ctx, e) => {
    streak(ctx, e.x, e.y, e.dx, e.dy, LEATHER, 2, 240);
    sfx(ctx, 'swing', e.x, e.y, 120, 0);
  },
  r_hawk_strike: (ctx, e) => {
    const c = chest(ctx, e.x, e.y);
    ctx.juice.sparksAt(c.x, c.y, 8, LEATHER);
    ctx.juice.embersAt(c.x, c.y, 6, 0xb08a5a);
    ctx.juice.impact(c.x, c.y, GOLD, 1);
    sfx(ctx, 'enemy_bite', e.x, e.y, 80, 1);
  },
  r_plague_spread: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(e.dx || 3), TOXIC, 360);
    ctx.juice.embersAt(p.x, p.y - 10, 12, TOXIC);
    ctx.juice.dust(p.x, p.y, 6, 0x4a6a2a);
  },
});

// ---------------- hazards ----------------

const smooth = new Map<number, { x: number; y: number; t: number }>();
function smoothed(ctx: FxCtx, h: SnapHazard): { x: number; y: number } {
  const s = smooth.get(h.i);
  if (!s || ctx.now - s.t > 500) { smooth.set(h.i, { x: h.x, y: h.y, t: ctx.now }); return { x: h.x, y: h.y }; }
  const k = Math.min(1, (ctx.now - s.t) / 50);
  s.x += (h.x - s.x) * k; s.y += (h.y - s.y) * k; s.t = ctx.now;
  if (smooth.size > 64) for (const [id, v] of smooth) if (ctx.now - v.t > 2000) smooth.delete(id);
  return s;
}

function ellipse(ctx: FxCtx, g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, fill: number, alpha: number, stroke?: number, lw = 2, strokeAlpha = 1) {
  const p = ctx.P(x, y);
  if (alpha > 0) g.fillStyle(fill, alpha).fillEllipse(p.x, p.y, ctx.rx(r) * 2, ctx.ry(r) * 2, 40);
  if (stroke !== undefined) g.lineStyle(lw, stroke, strokeAlpha).strokeEllipse(p.x, p.y, ctx.rx(r) * 2, ctx.ry(r) * 2, 40);
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

const rainDust = new Map<number, number>();

registerHazardFx({
  ranger_rain: (ctx, g, h, tick) => {
    const left = (h.u - tick) / 60;
    const a = Math.max(0, Math.min(1, left / 0.3));
    ellipse(ctx, g, h.x, h.y, h.r, 0x1a1408, 0.22 * a, GOLD, 2, 0.6 * a);
    const c = ctx.P(h.x, h.y);
    const n = ctx.reduced ? 10 : 34;
    const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
    for (let i = 0; i < n; i++) {
      const seed = (i * 7919 + h.i * 104729) % 65536;
      const ang = (seed / 65536) * Math.PI * 2;
      const rad = Math.sqrt(((seed * 31) % 1000) / 1000);
      const phase = ((ctx.now / 260) + i / n) % 1;
      const gx = c.x + Math.cos(ang) * rx * rad, gy = c.y + Math.sin(ang) * ry * rad;
      const top = gy - 90 * (1 - phase);
      g.lineStyle(2, LEATHER, 0.9 * a).lineBetween(gx - 8 * (1 - phase) - 3, top - 10, gx - 8 * (1 - phase), top);
      g.fillStyle(STEEL, a).fillRect(gx - 8 * (1 - phase) - 1, top - 1, 2, 2);
      if (phase > 0.9) g.fillStyle(GOLD, 0.6 * a).fillRect(gx - 2, gy - 1, 4, 2);
    }
    if (!ctx.reduced && ctx.now - (rainDust.get(h.i) ?? 0) > 90) {
      rainDust.set(h.i, ctx.now);
      const t = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random());
      ctx.juice.dust(c.x + Math.cos(t) * rx * r, c.y + Math.sin(t) * ry * r, 1, 0x5a4a30);
    }
    if (rainDust.size > 32) rainDust.clear();
  },
  ranger_trap: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const armed = tick - h.b >= 24;
    const rx = ctx.rx(0.45), ry = ctx.ry(0.45);
    g.fillStyle(0x2a241c, 0.85).fillEllipse(p.x, p.y, rx * 2, ry * 2, 20);
    g.lineStyle(2, STEEL, armed ? 1 : 0.5).strokeEllipse(p.x, p.y, rx * 2, ry * 2, 20);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const bx = p.x + Math.cos(a) * rx, by = p.y + Math.sin(a) * ry;
      g.fillStyle(STEEL, armed ? 1 : 0.5).fillTriangle(bx - 2, by, bx + 2, by, p.x + Math.cos(a) * rx * 0.55, p.y + Math.sin(a) * ry * 0.55 - 2);
    }
    if (armed && Math.floor(ctx.now / 500) % 2 === 0) g.fillStyle(GOLD, 0.9).fillRect(p.x - 1, p.y - 1, 2, 2);
  },
  ranger_bait: (ctx, g, h, tick) => {
    const total = Math.max(1, h.u - h.b), prog = Math.min(1, (tick - h.b) / total);
    ellipse(ctx, g, h.x, h.y, h.r * (0.9 + 0.1 * Math.sin(ctx.now / 140)), MARK, 0.05, MARK, 1, 0.35);
    ellipse(ctx, g, h.x, h.y, 2.2 * (1 - prog) + 0.3, MARK, 0, STEEL, 2, 0.8);
    const p = ctx.P(h.x, h.y);
    g.fillStyle(0x7a2a20, 1).fillEllipse(p.x, p.y - 3, 10, 6, 12);
    g.fillStyle(0xd8c8a8, 1).fillRect(p.x + 3, p.y - 5, 4, 2);
  },
  ranger_cloud: (ctx, g, h, tick) => {
    const left = (h.u - tick) / 60;
    const a = Math.max(0, Math.min(1, left / 0.5, (tick - h.b) / 12));
    ellipse(ctx, g, h.x, h.y, h.r, TOXIC, 0.22 * a, TOXIC, 1, 0.5 * a);
    const c = ctx.P(h.x, h.y);
    for (let i = 0; i < 7; i++) {
      const ph = ((ctx.now / 900) + i / 7) % 1;
      const ang = i * 2.1 + h.i;
      const bx = c.x + Math.cos(ang) * ctx.rx(h.r * 0.6), by = c.y + Math.sin(ang) * ctx.ry(h.r * 0.6) - ph * 18;
      g.lineStyle(1, 0xc8ff8a, 0.6 * a * (1 - ph)).strokeCircle(bx, by, 2 + ph * 3);
    }
  },
  ranger_hawk: (ctx, ground, h) => {
    const s = smoothed(ctx, h);
    const p = ctx.P(s.x, s.y);
    ground.fillStyle(0x000000, 0.22).fillEllipse(p.x, p.y, 14, 6, 12);
    const g = airLayer(ctx);
    const u = ctx.U(h.dx || 1, h.dy);
    const ang = Math.atan2(u.y, u.x);
    const cx = p.x, cy = p.y - 30;
    const flap = Math.sin(ctx.now / 70 + h.i) * 5;
    const c = Math.cos(ang), sn = Math.sin(ang);
    const R = (x: number, y: number) => ({ x: cx + x * c - y * sn, y: cy + x * sn + y * c });
    const head = R(7, 0), tail = R(-7, 0), wl = R(-1, -9 - flap), wr = R(-1, 9 + flap), bodyL = R(2, -2), bodyR = R(2, 2);
    g.fillStyle(0x6a4a2a, 1).fillTriangle(bodyL.x, bodyL.y, wl.x, wl.y, tail.x, tail.y).fillTriangle(bodyR.x, bodyR.y, wr.x, wr.y, tail.x, tail.y);
    g.fillStyle(LEATHER, 1).fillTriangle(head.x, head.y, bodyL.x, bodyL.y, tail.x, tail.y).fillTriangle(head.x, head.y, bodyR.x, bodyR.y, tail.x, tail.y);
    g.fillStyle(0xf0e0b0, 1).fillCircle(head.x, head.y, 2);
    g.fillStyle(GOLD, 1).fillRect(head.x + c * 2 - 0.5, head.y + sn * 2 - 0.5, 1.5, 1.5);
  },
}, { ranger_rain: GOLD, ranger_trap: STEEL, ranger_cloud: TOXIC, ranger_bait: MARK });
