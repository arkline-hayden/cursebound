import * as Phaser from 'phaser';
import { registerHazardFx, registerSkillFx, type CastFx, type FxCtx } from './registry';
import { arcTrail, burst, chest, groundCircle, pulseRing, sfx } from './kit3';

// Vanguard evolved-skill presentation (cosmetic only). Base skills (Cleave, Earthbreaker, Guard, Sweeping Strike,
// Rally Cry) keep their CombatScene effects. Sim conventions (simulation/src/classes/vanguard.ts): v_war_banner and
// v_leap carry the target point in dx,dy; v_retaliate_blast, v_maelstrom, v_provoke and v_aftershock carry the radius
// in dx; everything else uses dx,dy as the aim direction.

const GOLD = 0xffd890;
const STEEL = 0x9fd8ff;
const RED = 0xff6a5e;
const BANNER = 0xffd23f;

function aim(ctx: FxCtx, e: CastFx) {
  const u = ctx.U(e.dx, e.dy);
  return { u, ang: Math.atan2(u.y, u.x) };
}

function slash(ctx: FxCtx, x: number, y: number, ang: number, sx: number, sy: number, tint: number) {
  const s = ctx.scene;
  if (ctx.reduced || !s.textures.exists('fx:slash') || !s.anims.exists('fx:slash')) return;
  const spr = s.add.sprite(x, y, 'fx:slash').setRotation(ang).setDepth(4660).setScale(sx, sy).setBlendMode(Phaser.BlendModes.ADD).setTint(tint);
  spr.play('fx:slash');
  spr.once('animationcomplete', () => spr.destroy());
}

registerSkillFx({
  v_shield_charge: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const { u, ang } = aim(ctx, e);
    J.dust(p.x, p.y, 10, 0x6a5a48); J.ring(p.x, p.y, 26, STEEL, 220);
    J.arc(p.x + u.x * 16, p.y - 14 + u.y * 16, ang, STEEL, 1.2);
    ctx.dungeon.flashLight(p.x, p.y - 10, 150, STEEL, 1.8, 220);
    if (ctx.mine) J.shake(0.006, 140);
    sfx(ctx, 'skill_guard', e.x, e.y, 60, ctx.mine ? 2 : 1);
    sfx(ctx, 'boss_charge', e.x, e.y, 200, 0);
  },
  v_retaliate: (ctx, e) => {
    const c = chest(ctx, e.x, e.y);
    const { u } = aim(ctx, e);
    ctx.juice.sparksAt(c.x + u.x * 10, c.y + u.y * 10, 10, STEEL);
    ctx.juice.ring(ctx.P(e.x, e.y).x, ctx.P(e.x, e.y).y, 22, GOLD, 260);
    sfx(ctx, 'skill_guard', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  v_retaliate_blast: (ctx, e) => {
    const R = e.dx || 3;
    burst(ctx, e.x, e.y, R, GOLD, 0xffffff, true);
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(R * 1.2), RED, 420);
    ctx.juice.dust(p.x, p.y + 4, 16, 0x6a5a48);
    ctx.juice.flash(0xffd890, 70);
    sfx(ctx, 'signature_slam', e.x, e.y, 80, 3);
  },
  v_whirlwind: (ctx, e) => {
    const c = chest(ctx, e.x, e.y);
    for (let i = 0; i < 4; i++) ctx.juice.arc(c.x, c.y, (i * Math.PI) / 2 + Math.random(), i % 2 ? GOLD : 0xfff0c8, 1.4);
    ctx.juice.dust(c.x, c.y + 14, 8, 0x6a5a48);
    if (ctx.mine) ctx.juice.shake(0.004, 100);
    sfx(ctx, 'skill_sweep', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  v_executioner: (ctx, e) => {
    const c = chest(ctx, e.x, e.y);
    const { u, ang } = aim(ctx, e);
    ctx.juice.arc(c.x + u.x * 20, c.y + u.y * 20, ang, RED, 2);
    slash(ctx, c.x + u.x * 30, c.y + u.y * 30, ang, 1.1, 0.9, 0xffb0a0);
    ctx.juice.dust(c.x + u.x * 30, c.y + u.y * 30 + 14, 6, 0x6a5a48);
    if (ctx.mine) ctx.juice.shake(0.008, 140);
    sfx(ctx, 'skill_sweep', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  v_execute: (ctx, e) => {
    const c = chest(ctx, e.x, e.y);
    ctx.juice.impact(c.x, c.y, RED, 2.4);
    ctx.juice.sparksAt(c.x, c.y, 18, RED);
    ctx.dungeon.flashLight(c.x, c.y, 160, RED, 2.4, 200);
    if (ctx.mine) { ctx.juice.hitStop(90); ctx.juice.number(c.x, c.y - 18, 'EXECUTE', '#ff6a5e', 'md'); }
    sfx(ctx, 'crit', e.x, e.y, 60, 3);
  },
  v_war_banner: (ctx, e) => {
    arcTrail(ctx, e.x, e.y, e.dx, e.dy, BANNER, 30, 260);
    ctx.scene.time.delayedCall(200, () => {
      const q = ctx.P(e.dx, e.dy);
      ctx.juice.ring(q.x, q.y, ctx.rx(4), BANNER, 420); ctx.juice.dust(q.x, q.y, 10, 0x6a5a48); ctx.juice.sparksAt(q.x, q.y - 10, 14, BANNER);
      ctx.dungeon.flashLight(q.x, q.y - 20, 220, BANNER, 2, 420);
    });
    sfx(ctx, 'skill_rally', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  v_thunder_shout: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    for (let i = 0; i < 3; i++) ctx.scene.time.delayedCall(i * 70, () => ctx.juice.ring(p.x, p.y, ctx.rx(5 - i * 1.2), i === 1 ? 0xffffff : BANNER, 380));
    ctx.juice.dust(p.x, p.y, 18, 0x6a5a48);
    ctx.dungeon.flashLight(p.x, p.y - 10, 280, BANNER, 2.6, 400);
    ctx.juice.shake(0.016, 280); if (ctx.mine) ctx.juice.hitStop(60);
    sfx(ctx, 'skill_rally', e.x, e.y, 60, 3);
    sfx(ctx, 'boss_ring', e.x, e.y, 200, 1);
  },
  v_leap: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.dust(p.x, p.y, 10, 0x6a5a48); ctx.juice.ring(p.x, p.y, 24, GOLD, 220);
    arcTrail(ctx, e.x, e.y, e.dx, e.dy, GOLD, 70, 420);
    const t = ctx.P(e.dx, e.dy);
    groundTarget(ctx, t.x, t.y);
    sfx(ctx, 'dodge', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  v_maelstrom: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(e.dx || 2.5), STEEL, 240);
    ctx.juice.sparksAt(p.x, p.y - 12, 8, STEEL);
    sfx(ctx, 'swing', e.x, e.y, 120, 1);
  },
  v_provoke: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(e.dx || 5), RED, 420);
    ctx.dungeon.flashLight(p.x, p.y - 10, 180, RED, 1.6, 300);
    if (ctx.mine) ctx.juice.number(p.x, p.y - 34, 'PROVOKE', '#ff6a5e', 'sm');
    sfx(ctx, 'telegraph_warn', e.x, e.y, 200, 1);
  },
  v_aftershock: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    const R = e.dx || 2.2;
    ctx.juice.ring(p.x, p.y, ctx.rx(R), 0xffc070, 300); ctx.juice.dust(p.x, p.y, 12, 0x6a5a48); ctx.juice.sparksAt(p.x, p.y - 6, 10, GOLD);
    ctx.dungeon.addDecal('scorch', p.x, p.y, 0x2a2018, R * 0.8);
    ctx.juice.shake(0.006, 140);
    sfx(ctx, 'signature_slam', e.x, e.y, 120, 1);
  },
  v_last_stand: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, 48, GOLD, 500); ctx.juice.ring(p.x, p.y, 30, 0xffffff, 320);
    ctx.juice.embersAt(p.x, p.y - 14, 24, GOLD);
    ctx.dungeon.flashLight(p.x, p.y - 10, 260, GOLD, 3, 600);
    if (ctx.mine) { ctx.juice.flash(0xffd890, 120); ctx.juice.hitStop(160); ctx.juice.number(p.x, p.y - 40, 'LAST STAND', '#ffd890', 'lg'); }
    sfx(ctx, 'player_revived', e.x, e.y, 200, 4);
  },
});

/** One-shot landing marker under a leap. */
function groundTarget(ctx: FxCtx, x: number, y: number) {
  if (ctx.reduced) return;
  const g = ctx.scene.add.graphics().setDepth(-70);
  g.lineStyle(2, GOLD, 0.9).strokeEllipse(x, y, ctx.rx(2.6) * 2, ctx.ry(2.6) * 2, 32);
  g.fillStyle(GOLD, 0.15).fillEllipse(x, y, ctx.rx(2.6) * 2, ctx.ry(2.6) * 2, 32);
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: 420, ease: 'Quad.easeIn', onComplete: () => g.destroy() });
}

registerHazardFx({
  v_charge: (ctx, g, h) => {
    const p = ctx.P(h.x, h.y);
    const u = ctx.U(h.dx, h.dy);
    const ang = Math.atan2(u.y, u.x);
    g.lineStyle(5, STEEL, 0.8).beginPath().arc(p.x, p.y - 14, 18, ang - 0.9, ang + 0.9).strokePath();
    g.lineStyle(2, 0xffffff, 1).beginPath().arc(p.x, p.y - 14, 18, ang - 0.7, ang + 0.7).strokePath();
    for (let i = 1; i <= 3; i++) g.lineStyle(2, STEEL, 0.5 / i).lineBetween(p.x - u.x * 10 * i - u.y * (i - 2) * 6, p.y - 14 - u.y * 10 * i + u.x * (i - 2) * 6, p.x - u.x * 24 * i, p.y - 14 - u.y * 24 * i);
    if (!ctx.reduced && Math.random() < 0.5) ctx.juice.dust(p.x, p.y, 1, 0x6a5a48);
  },
  v_whirl: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    for (let i = 0; i < 3; i++) {
      const a = tick * 0.9 + (i * Math.PI * 2) / 3;
      g.lineStyle(4, i ? GOLD : 0xffffff, 0.75).beginPath().arc(p.x, p.y - 12, ctx.rx(h.r) * 0.8, a, a + 1.2).strokePath();
    }
    groundCircle(ctx, g, h.x, h.y, h.r, GOLD, 0.08);
  },
  v_aftershock: (ctx, g, h, tick) => {
    const f = Math.min(1, (tick - h.b) / 30);
    const p = ctx.P(h.x, h.y);
    g.lineStyle(2, 0xffc070, 0.35 + 0.5 * f);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + h.i;
      const r1 = h.r * f;
      const mx = h.x + Math.cos(a + 0.2) * r1 * 0.5, my = h.y + Math.sin(a + 0.2) * r1 * 0.5;
      const m = ctx.P(mx, my), q = ctx.P(h.x + Math.cos(a) * r1, h.y + Math.sin(a) * r1);
      g.beginPath().moveTo(p.x, p.y).lineTo(m.x, m.y).lineTo(q.x, q.y).strokePath();
    }
  },
  v_banner: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    groundCircle(ctx, g, h.x, h.y, h.r, BANNER, 0.06, BANNER, 1, 0.45);
    pulseRing(ctx, g, h.x, h.y, h.r, BANNER, tick, h.b, 60);
    g.lineStyle(3, 0x5a4020, 1).lineBetween(p.x, p.y, p.x, p.y - 46);
    const wave = Math.sin(tick * 0.2) * 3;
    g.fillStyle(0xb02020, 1).fillTriangle(p.x, p.y - 46, p.x + 22, p.y - 40 + wave, p.x, p.y - 30);
    g.fillStyle(BANNER, 1).fillCircle(p.x + 7, p.y - 39 + wave * 0.5, 2.5);
    g.fillStyle(BANNER, 1).fillCircle(p.x, p.y - 47, 2.5);
  },
}, { v_banner: BANNER, v_charge: STEEL, v_aftershock: 0xffc070 });

