import * as Phaser from 'phaser';
import { registerHazardFx, registerProjectileFx, registerSkillFx, type CastFx, type FxCtx } from './registry';
import { age, aimAngle, arcTrail, burst, chest, groundCircle, keep, pillar, pulseRing, runeRing, sfx, streak } from './tbfx';

// Templar presentation (cosmetic only): radiant gold and white light, sky-blue wards.
// Sim conventions (simulation/src/classes/templar.ts): t_judgment_day, t_smite, t_beacon and t_intercession carry their
// target point in dx/dy; t_judgment_land, t_skyfall_smite, t_smite_hit, t_heaven_smite, t_consecrate, t_dawnbreak,
// t_dome_up, t_hammer_hover/spin, t_intercession_land, t_vow_burst and t_retribution carry a radius in dx;
// t_condemn_burst carries (stacks, verdict) in dx/dy; t_charge_end carries the charge direction.

const GOLD = 0xffd76a;
const HOLY = 0xfff1a8;
const WHITE = 0xfff8e8;
const DEEP = 0xd0982a;
const WARD = 0xa8dcff;
const VERDICT = 0xff8a3a;

function slashSprite(ctx: FxCtx, x: number, y: number, ang: number, sx: number, sy: number, tint: number) {
  const s = ctx.scene;
  if (ctx.reduced || !s.textures.exists('fx:slash') || !s.anims.exists('fx:slash')) return;
  const spr = s.add.sprite(x, y, 'fx:slash').setRotation(ang).setDepth(4660).setScale(sx, sy).setBlendMode(Phaser.BlendModes.ADD).setTint(tint);
  spr.play('fx:slash');
  spr.once('animationcomplete', () => spr.destroy());
}

function swing(ctx: FxCtx, e: CastFx, color: number, scale: number) {
  const ang = aimAngle(ctx, e.dx, e.dy);
  const u = ctx.U(e.dx, e.dy);
  const c = chest(ctx, e.x, e.y);
  ctx.juice.arc(c.x + u.x * 18, c.y + u.y * 18, ang, color, scale);
  slashSprite(ctx, c.x + u.x * 28, c.y + u.y * 28, ang, 0.8 * scale, 0.65 * scale, color);
}

registerSkillFx({
  // ---- basic & signature ----
  t_hammer: (ctx, e) => {
    swing(ctx, e, e.count ? HOLY : 0xfff0c8, e.count ? 1.3 : 1.1);
    const u = ctx.U(e.dx, e.dy);
    const p = ctx.P(e.x + e.dx * 1.4, e.y + e.dy * 1.4);
    ctx.juice.dust(p.x + u.x * 4, p.y, 2, 0x6a5a48);
    sfx(ctx, 'swing', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  t_shockwave: (ctx, e) => {
    const ang = aimAngle(ctx, e.dx, e.dy);
    const c = chest(ctx, e.x, e.y, 6);
    const u = ctx.U(e.dx, e.dy);
    ctx.juice.arc(c.x + u.x * 30, c.y + u.y * 22, ang, GOLD, 2.4);
    ctx.juice.arc(c.x + u.x * 44, c.y + u.y * 32, ang, WHITE, 1.6);
    for (let i = 1; i <= 3; i++) {
      const p = ctx.P(e.x + e.dx * i * 0.9, e.y + e.dy * i * 0.9);
      ctx.juice.sparksAt(p.x, p.y - 8, 4, GOLD);
    }
    const p = ctx.P(e.x + e.dx * 1.5, e.y + e.dy * 1.5);
    ctx.dungeon.flashLight(p.x, p.y - 10, 150, GOLD, 1.8, 160);
    if (ctx.mine) ctx.juice.shake(0.004, 80);
    sfx(ctx, 'skill_sweep', e.x, e.y, 80, ctx.mine ? 2 : 1);
  },
  t_judgment_day: (ctx, e) => {
    const t = ctx.P(e.dx, e.dy);
    ctx.juice.ring(t.x, t.y, ctx.rx(3.5), HOLY, 350);
    streak(ctx, e.x, e.y, e.x, e.y, GOLD, 4);
    ctx.dungeon.flashLight(t.x, t.y - 60, 220, HOLY, 1.6, 360);
    const c = chest(ctx, e.x, e.y, 30);
    ctx.juice.embersAt(c.x, c.y, 12, HOLY);
    sfx(ctx, 'skill_rally', e.x, e.y, 0, 3);
  },
  t_judgment_land: (ctx, e) => {
    const R = e.dx || 3;
    pillar(ctx, e.x, e.y, HOLY, ctx.rx(R) * 0.9, 320, 520);
    burst(ctx, e.x, e.y, R, GOLD, WHITE, true, 26);
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(R * 1.25), WHITE, 480);
    ctx.juice.dust(p.x, p.y, 16, 0x8a7a58);
    ctx.juice.flash(0xfff4d0, 90);
    ctx.juice.shake(0.02, 300);
    sfx(ctx, 'signature_slam', e.x, e.y, 0, 4);
    sfx(ctx, 'signature_nova', e.x, e.y, 0, 3);
  },
  // ---- Radiance ----
  t_consecrate: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(e.dx || 2.6), GOLD, 420);
    ctx.juice.embersAt(p.x, p.y - 6, 18, HOLY);
    ctx.dungeon.flashLight(p.x, p.y - 12, 200, GOLD, 2, 420);
    sfx(ctx, 'skill_rally', e.x, e.y, 0, 2);
  },
  t_dawnbreak: (ctx, e) => {
    const R = e.dx || 3.5;
    burst(ctx, e.x, e.y, R, WHITE, GOLD, ctx.mine, 24);
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(R * 1.1), HOLY, 520);
    ctx.juice.embersAt(p.x, p.y - 20, 26, HOLY);
    ctx.juice.flash(0xfff8e0, 70);
    sfx(ctx, 'signature_nova', e.x, e.y, 0, 3);
  },
  t_beacon: (ctx, e) => {
    pillar(ctx, e.dx, e.dy, HOLY, 26, 260, 420);
    const t = ctx.P(e.dx, e.dy);
    ctx.juice.ring(t.x, t.y, ctx.rx(3), GOLD, 420);
    arcTrail(ctx, e.x, e.y, e.dx, e.dy, GOLD, 40, 300);
    sfx(ctx, 'skill_phase', e.dx, e.dy, 0, 2);
  },
  // ---- Judgment ----
  t_hammer_throw: (ctx, e) => {
    swing(ctx, e, GOLD, 1.2);
    sfx(ctx, 'skill_sweep', e.x, e.y, 0, ctx.mine ? 2 : 1);
  },
  t_skyfall: (ctx, e) => {
    swing(ctx, e, HOLY, 1.35);
    const c = chest(ctx, e.x, e.y, 26);
    ctx.juice.embersAt(c.x, c.y, 8, HOLY);
    sfx(ctx, 'skill_sweep', e.x, e.y, 0, ctx.mine ? 2 : 1);
  },
  t_skyfall_smite: (ctx, e) => {
    pillar(ctx, e.x, e.y, HOLY, ctx.rx(e.dx || 2) * 0.7, 280, 420);
    burst(ctx, e.x, e.y, e.dx || 2, GOLD, WHITE, ctx.mine, 18);
    sfx(ctx, 'skill_arc', e.x, e.y, 0, 3);
  },
  t_smite: (ctx, e) => {
    const t = ctx.P(e.dx, e.dy);
    ctx.juice.ring(t.x, t.y, ctx.rx(3.5), GOLD, 260);
    sfx(ctx, 'skill_arc', e.dx, e.dy, 0, 3);
    if (ctx.mine) ctx.juice.shake(0.006, 120);
  },
  t_smite_hit: (ctx, e) => {
    pillar(ctx, e.x, e.y, HOLY, 22, 300, 300);
    const p = ctx.P(e.x, e.y);
    ctx.juice.impact(p.x, p.y - 12, WHITE, 1.6);
    ctx.juice.sparksAt(p.x, p.y - 8, 12, GOLD);
    ctx.juice.ring(p.x, p.y, ctx.rx(e.dx || 1), GOLD, 240);
  },
  t_heaven_smite: (ctx, e) => {
    pillar(ctx, e.x, e.y, WHITE, 18, 280, 260);
    const p = ctx.P(e.x, e.y);
    ctx.juice.sparksAt(p.x, p.y - 8, 8, HOLY);
    ctx.juice.ring(p.x, p.y, ctx.rx(e.dx || 1.2), HOLY, 220);
    sfx(ctx, 'skill_arc', e.x, e.y, 90, 1);
  },
  t_condemn_burst: (ctx, e) => {
    const verdict = e.dy === 1;
    const stacks = Math.max(1, e.dx || 1);
    burst(ctx, e.x, e.y, 1.8, verdict ? VERDICT : GOLD, WHITE, verdict && ctx.mine, 10 + stacks * 4);
    const p = ctx.P(e.x, e.y);
    for (let i = 0; i < stacks; i++) ctx.juice.ring(p.x, p.y - 30 - i * 4, 10 + i * 8, verdict ? VERDICT : HOLY, 260 + i * 60);
    sfx(ctx, 'crit', e.x, e.y, 50, 2);
  },
  t_hammer_hover: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(e.dx || 1.5), GOLD, 300);
  },
  t_hammer_spin: (ctx, e) => {
    const c = chest(ctx, e.x, e.y, 16);
    ctx.juice.sparksAt(c.x, c.y, 5, GOLD);
    sfx(ctx, 'swing', e.x, e.y, 110, 1);
  },
  t_hammer_catch: (ctx, e) => {
    const c = chest(ctx, e.x, e.y, 18);
    ctx.juice.sparksAt(c.x, c.y, 8, HOLY);
    sfx(ctx, 'shield', e.x, e.y, 120, 1);
  },
  // ---- Aegis ----
  t_shield_charge: (ctx, e) => chargeStart(ctx, e, GOLD),
  t_aegis_charge: (ctx, e) => chargeStart(ctx, e, WARD),
  t_charge_end: (ctx, e) => {
    const u = ctx.U(e.dx, e.dy);
    const p = ctx.P(e.x + e.dx * 0.6, e.y + e.dy * 0.6);
    ctx.juice.impact(p.x, p.y - 14, WHITE, 2);
    ctx.juice.sparksAt(p.x + u.x * 6, p.y - 12, 16, GOLD);
    ctx.juice.dust(p.x, p.y, 10, 0x6a5a48);
    ctx.juice.ring(p.x, p.y, ctx.rx(1.8), GOLD, 260);
    ctx.dungeon.flashLight(p.x, p.y - 10, 160, GOLD, 2, 200);
    ctx.juice.shake(ctx.mine ? 0.012 : 0.005, 160);
    if (ctx.mine) ctx.juice.hitStop(55);
    sfx(ctx, 'signature_slam', e.x, e.y, 0, 3);
  },
  t_dome_up: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(e.dx || 3), WARD, 420);
    ctx.juice.sparksAt(p.x, p.y - 30, 18, WARD);
    ctx.dungeon.flashLight(p.x, p.y - 30, 220, WARD, 2, 400);
    sfx(ctx, 'skill_guard', e.x, e.y, 0, 3);
  },
  t_dome_block: (ctx, e) => {
    const c = chest(ctx, e.x, e.y, 16);
    ctx.juice.impact(c.x, c.y, WARD, 1.2);
    ctx.juice.sparksAt(c.x, c.y, 8, WARD);
    sfx(ctx, 'shield', e.x, e.y, 70, 1);
  },
  t_intercession: (ctx, e) => {
    arcTrail(ctx, e.x, e.y, e.dx, e.dy, GOLD, 70, 420);
    const p = ctx.P(e.x, e.y);
    ctx.juice.dust(p.x, p.y, 8, 0x6a5a48);
    ctx.juice.embersAt(p.x, p.y - 20, 10, HOLY);
    sfx(ctx, 'dodge', e.x, e.y, 0, 2);
  },
  t_intercession_land: (ctx, e) => {
    burst(ctx, e.x, e.y, e.dx || 2.2, GOLD, WHITE, ctx.mine, 20);
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(3), WARD, 420);
    ctx.juice.dust(p.x, p.y, 12, 0x6a5a48);
    sfx(ctx, 'signature_slam', e.x, e.y, 0, 3);
    sfx(ctx, 'shield', e.x, e.y, 0, 2);
  },
  t_vow_burst: (ctx, e) => {
    burst(ctx, e.x, e.y, e.dx || 2.2, HOLY, WARD, false, 18);
    sfx(ctx, 'signature_nova', e.x, e.y, 60, 2);
  },
  t_intervention: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    pillar(ctx, e.x, e.y, WHITE, 30, 300, 600);
    ctx.juice.ring(p.x, p.y, 40, WHITE, 500);
    ctx.juice.embersAt(p.x, p.y - 20, 24, HOLY);
    ctx.juice.flash(0xffffff, 80);
    window.dispatchEvent(new CustomEvent('cursebound:banner', { detail: { text: 'Divine Intervention!', tone: 'good' } }));
    sfx(ctx, 'player_revived', e.x, e.y, 0, 4);
  },
  t_retribution: (ctx, e) => {
    burst(ctx, e.x, e.y, e.dx || 2.6, VERDICT, HOLY, true, 26);
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx((e.dx || 2.6) * 1.2), GOLD, 460);
    sfx(ctx, 'signature_nova', e.x, e.y, 0, 3);
  },
});

function chargeStart(ctx: FxCtx, e: CastFx, color: number) {
  streak(ctx, e.x, e.y, e.x + e.dx * 5, e.y + e.dy * 5, color, 10, 300, 12);
  const p = ctx.P(e.x, e.y);
  ctx.juice.dust(p.x, p.y, 10, 0x6a5a48);
  ctx.juice.sparksAt(p.x, p.y - 14, 8, color);
  if (ctx.mine) ctx.juice.shake(0.005, 90);
  sfx(ctx, 'boss_charge', e.x, e.y, 0, 2);
}

registerHazardFx({
  // consecrated ground: warm disc, rotating runes, a pulse each 0.5s and rising motes
  t_consecration: (ctx, g, h) => {
    groundCircle(ctx, g, h.x, h.y, h.r, GOLD, 0.13, DEEP, 2, 0.8);
    groundCircle(ctx, g, h.x, h.y, h.r * 0.92, null, 0, HOLY, 1, 0.5);
    runeRing(ctx, g, h.x, h.y, h.r * 0.8, HOLY, 0.75, ctx.now / 1400);
    runeRing(ctx, g, h.x, h.y, h.r * 0.45, GOLD, 0.55, -ctx.now / 1000, 6);
    pulseRing(ctx, g, h.x, h.y, h.r, WHITE, 500, h.i * 37);
    if (!ctx.reduced && Math.random() < 0.18) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * h.r;
      const p = ctx.P(h.x + Math.cos(a) * r, h.y + Math.sin(a) * r);
      ctx.juice.embersAt(p.x, p.y - 4, 1, HOLY);
    }
  },
  // beacon: a floating sun over a faint circle of light, with rays down to the ground
  t_beacon: (ctx, g, h) => {
    groundCircle(ctx, g, h.x, h.y, h.r, HOLY, 0.08, GOLD, 1, 0.5);
    pulseRing(ctx, g, h.x, h.y, h.r, GOLD, 500, h.i * 53);
    const p = ctx.P(h.x, h.y);
    const bob = Math.sin(ctx.now / 260) * 3;
    const o = keep(ctx, `tb:${h.i}`, () => ctx.scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD));
    o.clear().setDepth(4600);
    const cy = p.y - 46 + bob;
    o.fillStyle(GOLD, 0.25).fillCircle(p.x, cy, 16);
    o.fillStyle(HOLY, 0.7).fillCircle(p.x, cy, 8);
    o.fillStyle(0xffffff, 1).fillCircle(p.x, cy, 4);
    o.lineStyle(2, HOLY, 0.35).lineBetween(p.x, cy, p.x, p.y);
    for (let i = 0; i < 6; i++) {
      const a = ctx.now / 900 + (i / 6) * Math.PI * 2;
      o.lineStyle(1, GOLD, 0.5).lineBetween(p.x + Math.cos(a) * 9, cy + Math.sin(a) * 9, p.x + Math.cos(a) * 18, cy + Math.sin(a) * 18);
    }
  },
  // pending Judgment Day: the target circle fills while a column of light descends
  t_judgment: (ctx, g, h) => {
    const prog = Math.min(1, age(ctx, `tj:${h.i}`) / 350);
    groundCircle(ctx, g, h.x, h.y, h.r, HOLY, 0.08 + 0.2 * prog, WHITE, 2, 0.9);
    groundCircle(ctx, g, h.x, h.y, h.r * prog, GOLD, 0.35);
    groundCircle(ctx, g, h.x, h.y, 3.5, null, 0, GOLD, 1, 0.6);
    const p = ctx.P(h.x, h.y);
    const o = keep(ctx, `tjc:${h.i}`, () => ctx.scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD));
    o.clear().setDepth(4661);
    const w = ctx.rx(h.r) * 0.3 * prog;
    o.fillStyle(HOLY, 0.15 + 0.3 * prog).fillRect(p.x - w / 2, p.y - 320, w, 320 * prog);
    o.fillStyle(0xffffff, 0.4 * prog).fillRect(p.x - w / 6, p.y - 320, w / 3, 320 * prog);
  },
  t_smite_mark: (ctx, g, h) => {
    const prog = Math.min(1, age(ctx, `ts:${h.i}`) / 200);
    groundCircle(ctx, g, h.x, h.y, h.r * (1.6 - 0.6 * prog), null, 0, HOLY, 2, 0.4 + 0.6 * prog);
    groundCircle(ctx, g, h.x, h.y, h.r * prog, GOLD, 0.25);
  },
  // condemned: a turning golden sigil over the enemy's head, one bar per stack
  t_condemn: (ctx, g, h) => {
    const p = ctx.P(h.x, h.y);
    groundCircle(ctx, g, h.x, h.y, Math.max(0.5, h.r + 0.15), null, 0, GOLD, 1, 0.6);
    const o = keep(ctx, `tc:${h.i}`, () => ctx.scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD));
    o.clear().setDepth(4610);
    const cy = p.y - 34 - h.r * 20 + Math.sin(ctx.now / 200) * 2;
    const a = ctx.now / 500;
    const pts = [0, 1, 2].map((i) => ({ x: p.x + Math.cos(a + (i * Math.PI * 2) / 3) * 8, y: cy + Math.sin(a + (i * Math.PI * 2) / 3) * 4 }));
    o.lineStyle(2, GOLD, 0.95).strokePoints([...pts, pts[0]]);
    o.fillStyle(WHITE, 0.9).fillCircle(p.x, cy, 2);
    const n = Math.max(1, h.out);
    for (let i = 0; i < n; i++) o.fillStyle(HOLY, 1).fillRect(p.x - n * 3 + i * 6, cy - 12, 4, 3);
  },
  // charge: a bright wedge of light trailing the shield
  t_charge: (ctx, g, h) => {
    const p0 = ctx.P(h.x - h.dx * 1.6, h.y - h.dy * 1.6), p1 = ctx.P(h.x, h.y);
    g.lineStyle(10, GOLD, 0.25).lineBetween(p0.x, p0.y - 10, p1.x, p1.y - 10);
    g.lineStyle(3, WHITE, 0.6).lineBetween(p0.x, p0.y - 10, p1.x, p1.y - 10);
  },
  // aegis dome: a translucent hemisphere with a shimmering lattice
  t_dome: (ctx, g, h) => {
    groundCircle(ctx, g, h.x, h.y, h.r, WARD, 0.1, WARD, 2, 0.8);
    const p = ctx.P(h.x, h.y);
    const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
    const o = keep(ctx, `td:${h.i}`, () => ctx.scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD));
    o.clear().setDepth(4605);
    const H = rx * 0.75;
    const shimmer = 0.25 + 0.1 * Math.sin(ctx.now / 180);
    o.fillStyle(WARD, 0.07).fillEllipse(p.x, p.y - H * 0.45, rx * 2, H * 1.3, 32);
    for (let k = 1; k <= 3; k++) {
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i <= 20; i++) { const t = Math.PI + (i / 20) * Math.PI; pts.push({ x: p.x + Math.cos(t) * rx * (k / 3), y: p.y + Math.sin(t) * (H * (k / 3)) + ry * 0 }); }
      o.lineStyle(1.5, WARD, shimmer + 0.15 * (k === 3 ? 1 : 0)).strokePoints(pts);
    }
    const arcPts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 24; i++) { const t = Math.PI + (i / 24) * Math.PI; arcPts.push({ x: p.x + Math.cos(t) * rx, y: p.y + Math.sin(t) * H }); }
    o.lineStyle(2.5, 0xffffff, 0.55).strokePoints(arcPts);
  },
  // vow: a golden halo ring at the bound ally's feet
  t_vow: (ctx, g, h) => {
    groundCircle(ctx, g, h.x, h.y, 0.75, HOLY, 0.12, GOLD, 2, 0.9);
    runeRing(ctx, g, h.x, h.y, 0.75, WHITE, 0.6, ctx.now / 700, 4);
  },
  t_leap_mark: (ctx, g, h) => {
    const prog = Math.min(1, age(ctx, `tl:${h.i}`) / 400);
    groundCircle(ctx, g, h.x, h.y, h.r, null, 0, GOLD, 2, 0.8);
    groundCircle(ctx, g, h.x, h.y, h.r * prog, HOLY, 0.2);
  },
  t_bastion_aura: (ctx, g, h) => {
    groundCircle(ctx, g, h.x, h.y, h.r, WARD, 0.04, WARD, 1, 0.35);
    runeRing(ctx, g, h.x, h.y, h.r, WARD, 0.3, ctx.now / 3000, 12);
  },
}, { t_consecration: GOLD, t_beacon: HOLY, t_judgment: WHITE, t_dome: WARD, t_smite_mark: HOLY });

registerProjectileFx({
  t_hammer: { key: 'fx:orb', color: GOLD, scale: 1.2, additive: true },
  t_hammer_h: { key: 'fx:orb', color: GOLD, scale: 1.2, additive: true },
  t_hammer_r: { key: 'fx:orb', color: HOLY, scale: 1.2, additive: true },
  t_bolt: { key: 'fx:spark', color: HOLY, scale: 1, additive: true },
});
