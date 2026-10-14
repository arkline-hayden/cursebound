import * as Phaser from 'phaser';
import { registerHazardFx, registerProjectileFx, registerSkillFx, type CastFx, type FxCtx } from './registry';
import { age, aimAngle, arcTrail, burst, chest, cracks, enlargeHero, groundCircle, heroSprite, keep, pillar, pulseRing, sfx, streak } from './tbfx';

// Berserker presentation (cosmetic only): blood red, hot iron and ember sparks.
// Sim conventions (simulation/src/classes/berserker.ts): b_leap / b_cataclysm carry the landing point in dx/dy;
// b_avatar carries (duration, Fury spent); b_whirl_tick carries (radius, kind); b_quake_ring (radius, ring index);
// b_leap_land, b_cataclysm_land, b_aftershock, b_shout, b_bloodbath, b_avatar_whirl, b_flay_burst, b_harvest carry a
// radius in dx. Everything else uses dx/dy as the aim direction. Hazards attached to the Berserker carry its slot in `in`.

const BLOOD = 0xd0202a;
const RAGE = 0xff4a2a;
const IRON = 0xc8ccd4;
const EMBER = 0xff8a3a;
const GORE = 0x7a0a12;
const DREAD = 0x8a3aa0;

function slashSprite(ctx: FxCtx, x: number, y: number, ang: number, sx: number, sy: number, tint: number) {
  const s = ctx.scene;
  if (ctx.reduced || !s.textures.exists('fx:slash') || !s.anims.exists('fx:slash')) return;
  const spr = s.add.sprite(x, y, 'fx:slash').setRotation(ang).setDepth(4660).setScale(sx, sy).setBlendMode(Phaser.BlendModes.ADD).setTint(tint);
  spr.play('fx:slash');
  spr.once('animationcomplete', () => spr.destroy());
}

const chopSide = new Map<number, number>();

function slam(ctx: FxCtx, x: number, y: number, R: number, strong: boolean) {
  burst(ctx, x, y, R, RAGE, IRON, strong, 22);
  const p = ctx.P(x, y);
  ctx.juice.dust(p.x, p.y, 18, 0x5a4a40);
  ctx.juice.ring(p.x, p.y, ctx.rx(R * 1.2), EMBER, 420);
  if (!ctx.reduced) {
    const g = ctx.scene.add.graphics().setDepth(-70);
    cracks(ctx, g, x, y, R * 1.1, Math.floor(x * 31 + y * 17), 0x2a1410, 0.9, 9, 3);
    cracks(ctx, g, x, y, R * 0.9, Math.floor(x * 13 + y * 7), EMBER, 0.7, 6, 1.5);
    ctx.scene.tweens.add({ targets: g, alpha: 0, delay: 500, duration: 900, onComplete: () => g.destroy() });
  }
}

registerSkillFx({
  // ---- basic & signature ----
  b_chop: (ctx, e) => {
    const side = (chopSide.get(e.slot) ?? 1) * -1;
    chopSide.set(e.slot, side);
    const ang = aimAngle(ctx, e.dx, e.dy);
    const u = ctx.U(e.dx, e.dy);
    const c = chest(ctx, e.x, e.y);
    const k = e.count ? 1.3 : 1;
    ctx.juice.arc(c.x + u.x * 14, c.y + u.y * 14, ang + side * 0.35, IRON, 1.0 * k);
    ctx.juice.arc(c.x + u.x * 18, c.y + u.y * 18, ang - side * 0.35, RAGE, 0.9 * k);
    slashSprite(ctx, c.x + u.x * 24, c.y + u.y * 24, ang + side * 0.5, 0.6 * k, 0.5 * k, 0xffd0c0);
    sfx(ctx, 'swing', e.x, e.y, 55, ctx.mine ? 2 : 1);
  },
  b_chop_spin: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(2), RAGE, 220);
    for (let i = 0; i < 4; i++) ctx.juice.arc(p.x, p.y - 12, (i / 4) * Math.PI * 2 + ctx.now / 200, i % 2 ? IRON : RAGE, 1.1);
    sfx(ctx, 'swing', e.x, e.y, 55, ctx.mine ? 2 : 1);
  },
  b_avatar: (ctx, e) => {
    slam(ctx, e.x, e.y, 3, true);
    const p = ctx.P(e.x, e.y);
    pillar(ctx, e.x, e.y, BLOOD, 60, 260, 700);
    ctx.juice.ring(p.x, p.y, ctx.rx(4.2), BLOOD, 600);
    ctx.juice.embersAt(p.x, p.y - 20, 30, RAGE);
    ctx.juice.flash(0xff2a1a, 110);
    ctx.juice.shake(0.025, 420);
    if (ctx.mine) window.dispatchEvent(new CustomEvent('cursebound:banner', { detail: { text: 'Avatar of Carnage!', tone: 'good' } }));
    sfx(ctx, 'boss_phase', e.x, e.y, 0, 4);
    sfx(ctx, 'signature_slam', e.x, e.y, 0, 4);
  },
  b_avatar_whirl: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(e.dx || 2.4), BLOOD, 200);
    ctx.juice.sparksAt(p.x, p.y - 12, 6, RAGE);
  },
  // ---- Fury ----
  b_bloodlust: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(1.6), BLOOD, 380);
    ctx.juice.embersAt(p.x, p.y - 18, 22, BLOOD);
    ctx.dungeon.flashLight(p.x, p.y - 16, 160, BLOOD, 2, 420);
    sfx(ctx, 'heartbeat', e.x, e.y, 0, 3);
  },
  b_bloodbath: (ctx, e) => {
    const R = e.dx || 2.8;
    const p = ctx.P(e.x, e.y);
    burst(ctx, e.x, e.y, R, BLOOD, RAGE, ctx.mine, 20);
    for (let i = 0; i < 6; i++) ctx.juice.arc(p.x, p.y - 12, (i / 6) * Math.PI * 2, i % 2 ? IRON : BLOOD, 1.6);
    ctx.juice.bleed('pursuer', p.x, p.y - 10, 24);
    sfx(ctx, 'skill_sweep', e.x, e.y, 0, 3);
  },
  b_unchained: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.sparksAt(p.x, p.y - 18, 26, IRON);
    ctx.juice.ring(p.x, p.y, ctx.rx(2.2), RAGE, 340);
    ctx.juice.embersAt(p.x, p.y - 18, 16, RAGE);
    ctx.dungeon.flashLight(p.x, p.y - 16, 190, RAGE, 2.4, 360);
    if (ctx.mine) ctx.juice.shake(0.01, 180);
    sfx(ctx, 'boss_phase', e.x, e.y, 0, 3);
  },
  // ---- Carnage ----
  b_whirlwind: (ctx, e) => whirlStart(ctx, e, IRON),
  b_bladestorm: (ctx, e) => whirlStart(ctx, e, RAGE),
  b_whirl_tick: (ctx, e) => {
    const R = e.dx || 2.2;
    const a = Math.random() * Math.PI * 2;
    const p = ctx.P(e.x + Math.cos(a) * R * 0.8, e.y + Math.sin(a) * R * 0.8);
    ctx.juice.sparksAt(p.x, p.y - 12, e.dy === 2 ? 6 : 4, e.dy === 2 ? RAGE : IRON);
    sfx(ctx, 'swing', e.x, e.y, 110, ctx.mine ? 2 : 1);
  },
  b_executioner: (ctx, e) => {
    streak(ctx, e.x, e.y, e.x + e.dx * 2.5, e.y + e.dy * 2.5, RAGE, 8, 260);
    const p = ctx.P(e.x, e.y);
    ctx.juice.dust(p.x, p.y, 6, 0x5a4a40);
    sfx(ctx, 'boss_charge', e.x, e.y, 0, 2);
  },
  b_execute_cleave: (ctx, e) => {
    const ang = aimAngle(ctx, e.dx, e.dy);
    const u = ctx.U(e.dx, e.dy);
    const c = chest(ctx, e.x, e.y, 8);
    ctx.juice.arc(c.x + u.x * 30, c.y + u.y * 20, ang, RAGE, 3);
    ctx.juice.arc(c.x + u.x * 40, c.y + u.y * 28, ang, IRON, 2.2);
    slashSprite(ctx, c.x + u.x * 36, c.y + u.y * 26, ang, 1.6, 1.2, 0xffb0a0);
    const p = ctx.P(e.x + e.dx * 1.8, e.y + e.dy * 1.8);
    ctx.juice.dust(p.x, p.y, 12, 0x5a4a40);
    ctx.dungeon.flashLight(p.x, p.y - 10, 180, RAGE, 2.2, 240);
    ctx.juice.shake(ctx.mine ? 0.016 : 0.006, 220);
    if (ctx.mine) ctx.juice.hitStop(80);
    sfx(ctx, 'signature_slam', e.x, e.y, 0, 3);
  },
  b_execute: (ctx, e) => {
    const c = chest(ctx, e.x, e.y, 14);
    ctx.juice.impact(c.x, c.y, BLOOD, 2.6);
    ctx.juice.bleed('pursuer', c.x, c.y, 30, e.dx, e.dy);
    ctx.juice.number(c.x, c.y - 18, 'EXECUTED', '#ff5a4a', 'md');
    sfx(ctx, 'kill', e.x, e.y, 0, 3);
  },
  // ---- Warcry ----
  b_leap: (ctx, e) => leapStart(ctx, e, 90),
  b_cataclysm: (ctx, e) => leapStart(ctx, e, 130),
  b_leap_land: (ctx, e) => {
    slam(ctx, e.x, e.y, e.dx || 2.4, true);
    sfx(ctx, 'signature_slam', e.x, e.y, 0, 4);
  },
  b_cataclysm_land: (ctx, e) => {
    slam(ctx, e.x, e.y, e.dx || 2.2, true);
    ctx.juice.flash(0xff6a2a, 70);
    sfx(ctx, 'signature_slam', e.x, e.y, 0, 4);
  },
  b_quake_ring: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    const R = e.dx || 3;
    ctx.juice.ring(p.x, p.y, ctx.rx(R), EMBER, 300);
    ctx.juice.ring(p.x, p.y, ctx.rx(R * 0.92), 0x3a2010, 360);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + e.dy;
      const q = ctx.P(e.x + Math.cos(a) * R, e.y + Math.sin(a) * R);
      ctx.juice.dust(q.x, q.y, 2, 0x5a4a40);
    }
    ctx.juice.shake(0.01 + 0.004 * e.dy, 160);
    sfx(ctx, 'boss_ring', e.x, e.y, 80, 2);
  },
  b_aftershock: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(e.dx || 3.2), EMBER, 360);
    ctx.juice.dust(p.x, p.y, 12, 0x5a4a40);
    ctx.juice.shake(0.008, 140);
    sfx(ctx, 'boss_ring', e.x, e.y, 0, 2);
  },
  b_shout: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    const R = e.dx || 5;
    for (let i = 0; i < 3; i++) ctx.juice.ring(p.x, p.y - 10, ctx.rx(R * (0.5 + i * 0.25)), i === 1 ? DREAD : BLOOD, 300 + i * 120);
    ctx.juice.embersAt(p.x, p.y - 26, 14, BLOOD);
    ctx.dungeon.flashLight(p.x, p.y - 20, 240, BLOOD, 2.2, 360);
    ctx.juice.shake(0.016, 300);
    sfx(ctx, 'boss_phase', e.x, e.y, 0, 4);
  },
  b_wall_slam: (ctx, e) => {
    const c = chest(ctx, e.x, e.y, 10);
    ctx.juice.impact(c.x, c.y, IRON, 1.8);
    ctx.juice.sparksAt(c.x, c.y, 10, EMBER);
    ctx.juice.dust(c.x, c.y + 8, 6, 0x5a4a40);
    sfx(ctx, 'crit', e.x, e.y, 60, 2);
  },
  b_flay_burst: (ctx, e) => bloodBurst(ctx, e),
  b_harvest: (ctx, e) => bloodBurst(ctx, e),
  b_undying: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    pillar(ctx, e.x, e.y, GORE, 40, 240, 600);
    ctx.juice.ring(p.x, p.y, ctx.rx(2), BLOOD, 500);
    ctx.juice.embersAt(p.x, p.y - 20, 26, BLOOD);
    ctx.juice.flash(0x600008, 120);
    if (ctx.mine) { ctx.juice.hitStop(120); window.dispatchEvent(new CustomEvent('cursebound:banner', { detail: { text: 'Undying!', tone: 'good' } })); }
    sfx(ctx, 'player_revived', e.x, e.y, 0, 4);
  },
  b_deathless: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(1.6), RAGE, 400);
    ctx.juice.flash(0x400004, 90);
    sfx(ctx, 'heartbeat', e.x, e.y, 0, 4);
  },
});

function whirlStart(ctx: FxCtx, e: CastFx, color: number) {
  const p = ctx.P(e.x, e.y);
  ctx.juice.ring(p.x, p.y, ctx.rx(e.dx || 2.2), color, 300);
  ctx.juice.dust(p.x, p.y, 8, 0x5a4a40);
  sfx(ctx, 'skill_sweep', e.x, e.y, 0, 3);
}

function leapStart(ctx: FxCtx, e: CastFx, height: number) {
  arcTrail(ctx, e.x, e.y, e.dx, e.dy, RAGE, height, 520);
  const p = ctx.P(e.x, e.y);
  ctx.juice.dust(p.x, p.y, 12, 0x5a4a40);
  ctx.juice.ring(p.x, p.y, ctx.rx(1.2), IRON, 240);
  if (ctx.mine) ctx.juice.shake(0.006, 100);
  sfx(ctx, 'dodge', e.x, e.y, 0, 2);
}

function bloodBurst(ctx: FxCtx, e: CastFx) {
  const p = ctx.P(e.x, e.y);
  ctx.juice.ring(p.x, p.y, ctx.rx(e.dx || 1.8), BLOOD, 260);
  ctx.juice.bleed('pursuer', p.x, p.y - 10, 16);
  ctx.juice.impact(p.x, p.y - 12, RAGE, 1.4);
  sfx(ctx, 'enemy_death', e.x, e.y, 70, 1);
}

registerHazardFx({
  // Avatar: the Berserker swells to a giant behind a blood-red halo and smouldering cracks
  b_avatar: (ctx, g, h) => {
    const t = age(ctx, `ba:${h.i}`);
    const grow = Math.min(1, t / 250);
    const spr = heroSprite(ctx, h.in);
    if (spr) enlargeHero(ctx, spr, 1 + 0.45 * grow);
    const x = h.x, y = h.y;
    groundCircle(ctx, g, x, y, 1.3, BLOOD, 0.18 + 0.06 * Math.sin(ctx.now / 120), RAGE, 2, 0.7);
    pulseRing(ctx, g, x, y, 2.4, RAGE, 420, h.i * 41);
    cracks(ctx, g, x, y, 1.9, h.i, EMBER, 0.45 + 0.2 * Math.sin(ctx.now / 90), 7, 2);
    if (spr && !ctx.reduced) {
      const ghost = keep(ctx, `bag:${h.i}`, () => ctx.scene.add.image(spr.x, spr.y, spr.texture.key, spr.frame.name).setBlendMode(Phaser.BlendModes.ADD));
      ghost.setTexture(spr.texture.key, spr.frame.name).setOrigin(spr.originX, spr.originY).setFlipX(spr.flipX)
        .setPosition(spr.x, spr.y).setScale(spr.scaleX * 1.3, spr.scaleY * 1.3).setTintFill(BLOOD).setAlpha(0.18 + 0.08 * Math.sin(ctx.now / 110)).setDepth(spr.depth - 0.5);
    }
    if (!ctx.reduced && Math.random() < 0.25) { const c = chest(ctx, x, y, 24); ctx.juice.embersAt(c.x + (Math.random() - 0.5) * 20, c.y, 1, RAGE); }
  },
  // Whirlwind / Bladestorm: blades circling the Berserker at waist height
  b_whirl: (ctx, g, h) => {
    const p = ctx.P(h.x, h.y);
    const blade = h.out === 2;
    groundCircle(ctx, g, h.x, h.y, h.r, blade ? BLOOD : 0x3a3030, 0.12, blade ? RAGE : IRON, 1, 0.5);
    const o = keep(ctx, `bw:${h.i}`, () => ctx.scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD));
    o.clear().setDepth(4598);
    const rx = ctx.rx(h.r) * 0.85, ry = ctx.ry(h.r) * 0.85;
    const spin = ctx.now / (blade ? 55 : 70);
    const n = blade ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const a0 = spin + (i / n) * Math.PI * 2;
      const pts: { x: number; y: number }[] = [];
      for (let k = 0; k <= 8; k++) { const a = a0 + (k / 8) * 1.1; pts.push({ x: p.x + Math.cos(a) * rx, y: p.y - 10 + Math.sin(a) * ry }); }
      o.lineStyle(5, blade ? RAGE : IRON, 0.35).strokePoints(pts);
      o.lineStyle(2, 0xffffff, 0.8).strokePoints(pts);
    }
  },
  // Frenzy pips: a segmented ring at the feet, lit per stack
  b_frenzy: (ctx, g, h) => {
    const max = Math.max(1, Math.round(h.w) || 5);
    const st = Math.max(0, Math.round(h.out));
    for (let i = 0; i < max; i++) {
      const a0 = -Math.PI / 2 + (i / max) * Math.PI * 2, a1 = a0 + (Math.PI * 2 / max) * 0.7;
      const p0 = ctx.P(h.x + Math.cos(a0) * 0.55, h.y + Math.sin(a0) * 0.55), p1 = ctx.P(h.x + Math.cos(a1) * 0.55, h.y + Math.sin(a1) * 0.55);
      g.lineStyle(3, i < st ? (st >= max ? RAGE : BLOOD) : 0x2a1a1a, i < st ? 0.95 : 0.5).lineBetween(p0.x, p0.y, p1.x, p1.y);
    }
  },
  // Fear: a dread swirl over the fleeing enemy's head
  b_fear: (ctx, g, h) => {
    const p = ctx.P(h.x, h.y);
    const o = keep(ctx, `bf:${h.i}`, () => ctx.scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD));
    o.clear().setDepth(4610);
    const cy = p.y - 34 - h.r * 20;
    const a = ctx.now / 160;
    for (let i = 0; i < 3; i++) {
      const b = a + (i * Math.PI * 2) / 3;
      o.fillStyle(i === 0 ? DREAD : BLOOD, 0.85).fillCircle(p.x + Math.cos(b) * 7, cy + Math.sin(b) * 3, 2.2);
    }
    o.fillStyle(0xffffff, 0.8).fillCircle(p.x, cy, 1.5);
  },
  // Cataclysm: the earth keeps splitting outward between rings
  b_quake: (ctx, g, h) => {
    const t = age(ctx, `bq:${h.i}`);
    const R = Math.min(h.r, h.r * (0.45 + t / 900));
    cracks(ctx, g, h.x, h.y, R, h.i, EMBER, 0.75, 10, 2);
    cracks(ctx, g, h.x, h.y, R * 0.8, h.i + 7, 0x2a1410, 0.8, 8, 3);
  },
  b_aftershock: (ctx, g, h) => {
    const prog = Math.min(1, age(ctx, `bas:${h.i}`) / 500);
    groundCircle(ctx, g, h.x, h.y, h.r, null, 0, EMBER, 2, 0.4 + 0.5 * prog);
    groundCircle(ctx, g, h.x, h.y, h.r * prog, RAGE, 0.12);
  },
  b_fissure: (ctx, g, h) => {
    groundCircle(ctx, g, h.x, h.y, h.r, 0x1a0806, 0.35, GORE, 1, 0.6);
    const glow = 0.55 + 0.35 * Math.sin(ctx.now / 140 + h.i);
    cracks(ctx, g, h.x, h.y, h.r, h.i, EMBER, glow, 9, 2.5);
    cracks(ctx, g, h.x, h.y, h.r * 0.7, h.i + 3, RAGE, glow * 0.8, 6, 1.5);
    pulseRing(ctx, g, h.x, h.y, h.r, EMBER, 500, h.i * 29);
  },
  b_leap_mark: (ctx, g, h) => {
    const prog = Math.min(1, age(ctx, `bl:${h.i}`) / 450);
    groundCircle(ctx, g, h.x, h.y, h.r, null, 0, RAGE, 2, 0.85);
    groundCircle(ctx, g, h.x, h.y, h.r * prog, BLOOD, 0.22);
  },
  b_undying: (ctx, g, h) => {
    const flick = 0.2 + 0.15 * Math.sin(ctx.now / 60);
    groundCircle(ctx, g, h.x, h.y, 1.1, GORE, flick, BLOOD, 2, 0.8);
    pulseRing(ctx, g, h.x, h.y, 1.6, BLOOD, 300);
  },
}, { b_avatar: BLOOD, b_fissure: EMBER, b_undying: GORE, b_quake: EMBER });

registerProjectileFx({
  b_axe: { key: 'fx:shard', color: RAGE, scale: 1.3, additive: false },
});
