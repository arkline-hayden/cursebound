import * as Phaser from 'phaser';
import type { SfxId } from '../../audio/AudioEngine';
import { registerHazardFx, registerProjectileFx, registerSkillFx, type CastFx, type FxCtx, type SnapHazard } from './registry';

// Artificer presentation (cosmetic only). Brass, teal arc-light, orange blasts and white steam.
// Sim conventions (simulation/src/classes/artificer.ts):
//   af_fx_blast: x,y centre, dx = radius, dy = style (0 grenade, 1 bomblet/cluster, 2 mortar, 3 turret self-destruct,
//                4 steam, 5 heavy shell, 6 firebomb, 7 rocket landing, 8 chain reaction)
//   af_fx_zap: x,y -> dx,dy;  af_fx_flame / af_fx_turret_shot: x,y turret, dx,dy direction
//   af_mortar_barrage: x,y caster, dx,dy barrage centre;  af_rocket_jump: x,y launch, dx,dy landing
//   af_grenade hazard: x,y landing, dx,dy throw dir, len throw distance, in = variant (+4 heavy), u-1 = detonation

const BRASS = 0xd8a850;
const BRASS_DK = 0x6a5232;
const TEAL = 0x5ae8d4;
const ARC = 0x8fe8ff;
const FIRE = 0xff7a2a;
const STEAM = 0xe8f4f4;

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

function trail(ctx: FxCtx, x0: number, y0: number, x1: number, y1: number, color: number, width: number, lift = 14, ms = 260) {
  if (ctx.reduced) return;
  const a = ctx.P(x0, y0), b = ctx.P(x1, y1);
  const g = ctx.scene.add.graphics().setDepth(4645).setBlendMode(Phaser.BlendModes.ADD);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - lift - Math.hypot(b.x - a.x, b.y - a.y) * 0.25;
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x;
    const y = (1 - t) * (1 - t) * (a.y - lift) + 2 * (1 - t) * t * my + t * t * (b.y - lift);
    pts.push(new Phaser.Math.Vector2(x, y));
  }
  g.lineStyle(width, color, 0.85).strokePoints(pts);
  g.lineStyle(Math.max(1, width / 3), 0xffffff, 0.9).strokePoints(pts);
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, onComplete: () => g.destroy() });
}

const BLAST_COLOR = [0xffa040, 0xffc040, 0xff7a2a, 0x9ff0e0, STEAM, 0xff5a2a, 0xff4a1a, STEAM, 0xffa040];

function blastFx(ctx: FxCtx, e: CastFx) {
  const J = ctx.juice;
  const R = e.dx || 1.5;
  const style = Math.round(e.dy) || 0;
  const color = BLAST_COLOR[style] ?? 0xffa040;
  const steam = style === 4 || style === 7;
  const big = style === 5 || style === 2 || style === 3 || R >= 2.2;
  const p = ctx.P(e.x, e.y);
  J.ring(p.x, p.y, ctx.rx(R), color, steam ? 360 : 300);
  J.ring(p.x, p.y, ctx.rx(R * 0.55), 0xffffff, 200);
  if (steam) J.dust(p.x, p.y - 6, 12, 0xd0dcdc);
  else {
    J.dust(p.x, p.y, big ? 10 : 5, 0x3a2a20);
    J.embersAt(p.x, p.y - 10, big ? 18 : 8, color);
    J.sparksAt(p.x, p.y - 10, big ? 14 : 6, 0xffd890);
    J.impact(p.x, p.y - 12, color, big ? 2.2 : 1.2);
  }
  if (style === 3) J.sparksAt(p.x, p.y - 12, 16, TEAL);
  ctx.dungeon.flashLight(p.x, p.y - 8, Math.max(110, ctx.rx(R) * 2.4), steam ? 0xd8f0f0 : color, big ? 2.6 : 1.8, big ? 300 : 200);
  if (style === 5) { J.shake(0.016, 260); if (ctx.mine) J.hitStop(70); }
  else J.shake(Math.min(0.012, 0.002 + R * 0.002), 120);
  if (steam) sfx(ctx, 'skill_sweep', e.x, e.y, 70, ctx.mine ? 2 : 1);
  else sfx(ctx, big || R >= 1.6 ? 'signature_slam' : 'hit_enemy', e.x, e.y, 70, big ? 2 : 1);
}

function deployFx(ctx: FxCtx, e: CastFx, color: number) {
  const p = ctx.P(e.x, e.y);
  ctx.juice.dust(p.x, p.y, 6, 0x5a4a38);
  ctx.juice.ring(p.x, p.y, 26, color, 260);
  ctx.juice.sparksAt(p.x, p.y - 8, 8, BRASS);
  ctx.dungeon.flashLight(p.x, p.y - 10, 120, color, 1.6, 260);
  sfx(ctx, 'skill_guard', e.x, e.y, 60, ctx.mine ? 2 : 1);
}

function steamFx(ctx: FxCtx, e: CastFx) {
  const p = ctx.P(e.x, e.y);
  ctx.juice.ring(p.x, p.y, ctx.rx(2.2), STEAM, 360);
  ctx.juice.dust(p.x, p.y - 8, 14, 0xd8e4e4);
  ctx.dungeon.flashLight(p.x, p.y - 10, 160, TEAL, 2, 400);
  if (ctx.mine) ctx.juice.shake(0.006, 120);
}

registerSkillFx({
  af_repeater: (ctx, e) => {
    const u = ctx.U(e.dx, e.dy);
    const c = chest(ctx, e.x, e.y);
    ctx.juice.sparksAt(c.x + u.x * 16, c.y + u.y * 16, 2, BRASS);
    ctx.dungeon.flashLight(c.x + u.x * 12, c.y + u.y * 12, 60, BRASS, 0.9, 70);
    sfx(ctx, 'attack_spark', e.x, e.y, 70, ctx.mine ? 1 : 0);
  },
  af_turret: (ctx, e) => deployFx(ctx, e, TEAL),
  af_flame_turret: (ctx, e) => deployFx(ctx, e, FIRE),
  af_tesla_coil: (ctx, e) => deployFx(ctx, e, ARC),
  af_fx_turret_shot: (ctx, e) => {
    const u = ctx.U(e.dx, e.dy);
    const c = ctx.P(e.x, e.y);
    ctx.juice.sparksAt(c.x + u.x * 12, c.y - 14 + u.y * 8, 2, TEAL);
    sfx(ctx, 'attack_spark', e.x, e.y, 140, 0);
  },
  af_fx_flame: (ctx, e) => {
    if (ctx.reduced) return;
    for (let i = 1; i <= 3; i++) {
      const q = ctx.P(e.x + e.dx * i * 1.1, e.y + e.dy * i * 1.1);
      ctx.juice.embersAt(q.x, q.y - 10, 3 + i, i === 3 ? 0xffd040 : FIRE);
    }
    const c = ctx.P(e.x + e.dx * 1.5, e.y + e.dy * 1.5);
    ctx.dungeon.flashLight(c.x, c.y - 10, 90, FIRE, 1.2, 140);
    sfx(ctx, 'skill_fireline', e.x, e.y, 450, 0);
  },
  af_fx_zap: (ctx, e) => {
    ctx.bolt(e.x, e.y, e.dx, e.dy, ARC);
    const t = chest(ctx, e.dx, e.dy);
    ctx.juice.sparksAt(t.x, t.y, 5, ARC);
    ctx.dungeon.flashLight(t.x, t.y, 80, ARC, 1.4, 120);
    sfx(ctx, 'skill_arc', e.dx, e.dy, 120, 0);
  },
  af_grenade: (ctx, e) => sfx(ctx, 'swing', e.x, e.y, 60, ctx.mine ? 1 : 0),
  af_cluster_charge: (ctx, e) => sfx(ctx, 'swing', e.x, e.y, 60, ctx.mine ? 1 : 0),
  af_firebomb: (ctx, e) => sfx(ctx, 'swing', e.x, e.y, 60, ctx.mine ? 1 : 0),
  af_fx_blast: blastFx,
  af_mortar_barrage: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.embersAt(p.x, p.y - 24, 14, FIRE);
    ctx.juice.dust(p.x, p.y, 6, 0x5a4a38);
    ctx.dungeon.flashLight(p.x, p.y - 20, 150, FIRE, 2, 260);
    const t = ctx.P(e.dx, e.dy);
    ctx.juice.ring(t.x, t.y, ctx.rx(3.2), 0xff5a2a, 600);
    if (ctx.mine) ctx.juice.shake(0.005, 120);
    sfx(ctx, 'skill_fireline', e.x, e.y, 80, 2);
  },
  af_overclock: (ctx, e) => { steamFx(ctx, e); sfx(ctx, 'skill_rally', e.x, e.y, 80, 2); },
  af_boiler_overdrive: (ctx, e) => { steamFx(ctx, e); sfx(ctx, 'skill_rally', e.x, e.y, 80, 2); },
  af_rocket_jump: (ctx, e) => {
    trail(ctx, e.x, e.y, e.dx, e.dy, FIRE, 4, 14, 360);
    const p = ctx.P(e.x, e.y);
    ctx.juice.embersAt(p.x, p.y - 6, 16, FIRE);
    ctx.juice.dust(p.x, p.y, 10, 0xd0dcdc);
    sfx(ctx, 'skill_phase', e.x, e.y, 80, 2);
  },
});

/** Teleport payload: the raw sim event (fx,fy -> x,y) or the cast convention (x,y -> dx,dy). */
function tpPoints(e: CastFx) {
  const t = e as unknown as { fx?: number; fy?: number; x: number; y: number; dx?: number; dy?: number };
  return typeof t.fx === 'number' && typeof t.fy === 'number'
    ? { x0: t.fx, y0: t.fy, x1: t.x, y1: t.y }
    : { x0: t.x, y0: t.y, x1: t.dx ?? t.x, y1: t.dy ?? t.y };
}

// Styled teleport ('rocket', emitted on Rocket Jump landing): scorch and steam at the landing point.
registerSkillFx({
  'teleport:rocket': (ctx, e) => {
    const { x1, y1 } = tpPoints(e);
    const p = ctx.P(x1, y1);
    ctx.juice.dust(p.x, p.y, 8, 0xd0dcdc);
    ctx.juice.embersAt(p.x, p.y - 6, 8, FIRE);
    ctx.dungeon.flashLight(p.x, p.y - 8, 110, FIRE, 1.4, 180);
  },
});

// ---------------- hazards (ground layer) ----------------

function lifeRing(ctx: FxCtx, g: Phaser.GameObjects.Graphics, x: number, y: number, h: SnapHazard, tick: number, color: number) {
  const frac = Math.max(0, Math.min(1, (h.u - tick) / Math.max(1, h.u - h.b)));
  g.lineStyle(2, color, 0.5).beginPath();
  g.arc(x, y, 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false);
  g.strokePath();
}

function turretBase(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number, accent: number) {
  const p = ctx.P(h.x, h.y);
  g.fillStyle(0x000000, 0.35).fillEllipse(p.x, p.y, ctx.rx(0.45) * 2, ctx.ry(0.45) * 2);
  g.fillStyle(accent, 0.05).fillEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 40);
  // tripod legs
  g.lineStyle(2, BRASS_DK, 1);
  g.lineBetween(p.x, p.y - 10, p.x - 9, p.y + 3);
  g.lineBetween(p.x, p.y - 10, p.x + 9, p.y + 3);
  g.lineBetween(p.x, p.y - 10, p.x, p.y + 5);
  lifeRing(ctx, g, p.x, p.y, h, tick, accent);
  return p;
}

function drawTurret(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const p = turretBase(ctx, g, h, tick, TEAL);
  const u = ctx.U(h.dx, h.dy);
  g.fillStyle(BRASS, 1).fillCircle(p.x, p.y - 14, 6);
  g.lineStyle(4, BRASS_DK, 1).lineBetween(p.x, p.y - 14, p.x + u.x * 13, p.y - 14 + u.y * 9);
  g.fillStyle(TEAL, 0.9).fillCircle(p.x + u.x * 13, p.y - 14 + u.y * 9, 2);
  g.fillStyle(TEAL, 0.6 + 0.4 * Math.sin(ctx.now / 120)).fillCircle(p.x, p.y - 15, 2);
}

function drawFlameTurret(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const p = turretBase(ctx, g, h, tick, FIRE);
  const u = ctx.U(h.dx, h.dy);
  g.fillStyle(0x8a4a2a, 1).fillRoundedRect(p.x - 6, p.y - 22, 12, 12, 3);
  g.lineStyle(5, BRASS_DK, 1).lineBetween(p.x, p.y - 15, p.x + u.x * 12, p.y - 15 + u.y * 8);
  g.fillStyle(0xffd040, 0.6 + 0.4 * Math.random()).fillCircle(p.x + u.x * 13, p.y - 15 + u.y * 9, 3);
}

function drawTesla(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const p = turretBase(ctx, g, h, tick, ARC);
  g.lineStyle(3, BRASS_DK, 1).lineBetween(p.x, p.y - 8, p.x, p.y - 30);
  for (let i = 0; i < 3; i++) g.lineStyle(2, BRASS, 1).strokeEllipse(p.x, p.y - 12 - i * 6, 12 - i * 2, 5, 16);
  const pulse = 0.5 + 0.5 * Math.sin(ctx.now / 70);
  g.fillStyle(ARC, 0.5 + 0.5 * pulse).fillCircle(p.x, p.y - 33, 4);
  g.fillStyle(0xffffff, 0.8).fillCircle(p.x, p.y - 33, 1.5);
  if (!ctx.reduced && Math.random() < 0.15) {
    const a = Math.random() * Math.PI * 2;
    g.lineStyle(1, ARC, 0.9).lineBetween(p.x, p.y - 33, p.x + Math.cos(a) * 10, p.y - 33 + Math.sin(a) * 7);
  }
}

function lobPos(ctx: FxCtx, h: SnapHazard, prog: number) {
  const ox = h.x - h.dx * h.len, oy = h.y - h.dy * h.len;
  const wx = ox + (h.x - ox) * prog, wy = oy + (h.y - oy) * prog;
  const ground = ctx.P(wx, wy);
  const lift = 14 + 4 * prog * (1 - prog) * (24 + h.len * 7);
  return { ground, x: ground.x, y: ground.y - lift };
}

registerHazardFx({
  af_turret: drawTurret,
  af_flame_turret: drawFlameTurret,
  af_tesla_coil: drawTesla,
  af_shell: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const land = h.u - 1;
    const prog = Math.max(0, Math.min(1, (tick - h.b) / Math.max(1, land - h.b)));
    const blink = prog > 0.7 && Math.floor(ctx.now / 70) % 2 === 0;
    g.lineStyle(2, blink ? 0xffffff : 0xff6a2a, 0.9).strokeEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 32);
    g.fillStyle(0xff4a1a, 0.12 + 0.3 * prog).fillEllipse(p.x, p.y, ctx.rx(h.r * prog) * 2, ctx.ry(h.r * prog) * 2, 32);
    g.lineStyle(1, 0xff6a2a, 0.7).lineBetween(p.x - ctx.rx(0.4), p.y, p.x + ctx.rx(0.4), p.y).lineBetween(p.x, p.y - ctx.ry(0.4), p.x, p.y + ctx.ry(0.4));
    const fall = (1 - prog) * 140;
    if (prog > 0.35) {
      g.fillStyle(0x2a2420, 1).fillCircle(p.x, p.y - fall - 6, 4);
      g.lineStyle(2, 0xffa040, 0.6).lineBetween(p.x, p.y - fall - 10, p.x, p.y - fall - 24);
    }
  },
  af_grenade: (ctx, g, h, tick) => {
    const land = h.u - 1;
    const prog = Math.max(0, Math.min(1, (tick - h.b) / Math.max(1, land - h.b)));
    const variant = h.in & 3, heavy = h.in >= 4;
    const color = heavy ? 0x6a5040 : variant === 1 ? 0xe0c040 : variant === 2 ? 0xff5a2a : BRASS;
    const t = ctx.P(h.x, h.y);
    g.lineStyle(1, color, 0.35 + 0.4 * prog).strokeEllipse(t.x, t.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 32);
    const q = lobPos(ctx, h, prog);
    g.fillStyle(0x000000, 0.3).fillEllipse(q.ground.x, q.ground.y, 10, 5);
    g.fillStyle(color, 1).fillCircle(q.x, q.y, heavy ? 6 : 3.5);
    g.fillStyle(0xffffff, Math.floor(ctx.now / 80) % 2 ? 0.9 : 0.2).fillCircle(q.x, q.y - 1, heavy ? 2 : 1.2);
  },
  af_bomblet: (ctx, g, h, tick) => {
    const land = h.u - 1;
    const prog = Math.max(0, Math.min(1, (tick - h.b) / Math.max(1, land - h.b)));
    const q = lobPos(ctx, h, prog);
    g.fillStyle(0x000000, 0.3).fillEllipse(q.ground.x, q.ground.y, 8, 4);
    g.fillStyle(0xffc040, 1).fillCircle(q.x, q.y + 8, 2.5);
    g.fillStyle(0xff3a1a, Math.floor(ctx.now / 50) % 2 ? 1 : 0.2).fillCircle(q.x, q.y + 7, 1.2);
  },
  af_mine: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const armed = tick >= h.b + 24;
    g.fillStyle(0x2a2826, 1).fillEllipse(p.x, p.y, 14, 7);
    g.lineStyle(1, BRASS, 1).strokeEllipse(p.x, p.y, 14, 7);
    const on = armed ? Math.floor(ctx.now / 120) % 2 === 0 : true;
    g.fillStyle(armed ? 0xff2a2a : 0xffb030, on ? 1 : 0.25).fillCircle(p.x, p.y - 2, 2);
    if (armed) g.lineStyle(1, 0xff2a2a, 0.18).strokeEllipse(p.x, p.y, ctx.rx(1.2) * 2, ctx.ry(1.2) * 2, 24);
  },
  af_fire: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const age = (tick - h.b) / Math.max(1, h.u - h.b);
    const a = 0.28 * (1 - age * 0.6);
    g.fillStyle(0xff5a1a, a).fillEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 32);
    for (let i = 0; i < 3; i++) {
      const s = 0.5 + 0.2 * Math.sin(ctx.now / 110 + i * 2);
      g.fillStyle(i ? 0xff8a2a : 0xffd040, a * 0.8).fillEllipse(p.x + (i - 1) * ctx.rx(h.r * 0.3), p.y + Math.sin(i) * 3, ctx.rx(h.r * s), ctx.ry(h.r * s), 20);
    }
    if (!ctx.reduced && Math.random() < 0.25) {
      const r = Math.random() * h.r, ang = Math.random() * Math.PI * 2;
      ctx.juice.embersAt(p.x + Math.cos(ang) * ctx.rx(r), p.y + Math.sin(ang) * ctx.ry(r) - 4, 1, FIRE);
    }
  },
  af_boiler: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const age = (tick - h.b) / Math.max(1, h.u - h.b);
    const a = 0.22 * (1 - age * 0.5);
    for (let i = 0; i < 6; i++) {
      const ang = ctx.now / 500 + i * 1.047;
      const rr = h.r * 0.55;
      g.fillStyle(i % 2 ? STEAM : 0xbfe8e0, a).fillEllipse(p.x + Math.cos(ang) * ctx.rx(rr), p.y + Math.sin(ang) * ctx.ry(rr) - 6, ctx.rx(h.r * 0.75), ctx.ry(h.r * 0.75), 20);
    }
    g.lineStyle(1, TEAL, 0.35).strokeEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 32);
    if (!ctx.reduced && Math.random() < 0.2) ctx.juice.dust(p.x + (Math.random() - 0.5) * ctx.rx(h.r) * 1.6, p.y - 8, 1, 0xd8e4e4);
  },
  af_drone: (ctx, g, h) => {
    const p = ctx.P(h.x, h.y);
    const bob = Math.sin(ctx.now / 180 + h.in) * 2;
    g.fillStyle(0x000000, 0.28).fillEllipse(p.x, p.y, 12, 6);
    const y = p.y - 30 + bob;
    g.fillStyle(BRASS, 1).fillCircle(p.x, y, 5);
    g.lineStyle(1, BRASS_DK, 1).strokeCircle(p.x, y, 5);
    const spin = ctx.now / 40;
    g.lineStyle(2, 0xc8c0b0, 0.8).lineBetween(p.x - Math.cos(spin) * 9, y - 6 - Math.sin(spin) * 2, p.x + Math.cos(spin) * 9, y - 6 + Math.sin(spin) * 2);
    g.fillStyle(TEAL, 0.7 + 0.3 * Math.sin(ctx.now / 90)).fillCircle(p.x, y, 2);
  },
}, { af_turret: TEAL, af_flame_turret: FIRE, af_tesla_coil: ARC, af_fire: 0xff6a2a, af_boiler: 0xd8f0f0 });

registerProjectileFx({
  af_bolt: { key: 'fx:shard', color: 0xffc860, scale: 0.9, additive: true },
  af_turret_bolt: { key: 'fx:shard', color: TEAL, scale: 0.8, additive: true },
});
