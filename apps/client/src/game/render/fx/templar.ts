import * as Phaser from 'phaser';
import { registerHazardFx, registerKillFx, registerProjectileFx, registerSkillFx, type CastFx, type FxCtx } from './registry';
import { castFlash, heroGhosts, impactBurst, type Pal } from './spectacle';
import { age, aimAngle, arcTrail, chest, groundCircle, heroSprite, keep, pulseRing, runeRing, sfx, streak } from './tbfx';

// Templar presentation (cosmetic only): radiant gold and white light from the sky, crosses and runes, warding blue.
// Sim conventions (simulation/src/classes/templar.ts): t_judgment_day, t_smite, t_beacon and t_intercession carry their
// target point in dx/dy; t_judgment_land, t_skyfall_smite, t_smite_hit, t_heaven_smite, t_consecrate, t_dawnbreak,
// t_dome_up, t_hammer_hover/spin, t_intercession_land, t_vow_burst carry a radius in dx; t_retribution carries
// (radius, stored fraction); t_condemn_burst carries (stacks, verdict) in dx/dy; t_charge_end carries the charge
// direction; t_dome_block carries the dome centre; t_intervention the saved player's slot. Hazards carry the owning
// Templar's slot in `in` (t_vow: the bound ally's slot).
// Branch colours: Radiance = sun gold and motes, Judgment = white-gold sky light with crosses (Final Verdict orange),
// Aegis = warding blue edged in gold. No camera shake anywhere.

const GOLD = 0xffd76a;
const HOLY = 0xfff1a8;
const WHITE = 0xfff8e8;
const DEEP = 0xd0982a;
const WARD = 0xa8dcff;
const WARD_D = 0x4a8ad8;
const VERDICT = 0xff8a3a;
const DUST = 0x6a5a48;

const P_SUN: Pal = { main: GOLD, hot: WHITE, deep: DEEP, bits: 'mote' };
const P_SKY: Pal = { main: HOLY, hot: 0xffffff, deep: GOLD, bits: 'cross' };
const P_WARD: Pal = { main: WARD, hot: 0xffffff, deep: WARD_D, bits: 'rune' };
const P_VERDICT: Pal = { main: VERDICT, hot: HOLY, deep: 0xa04010, bits: 'cross' };

/** One-shot pixel sheet (art/fx/templar.ts). Looping or static sheets fade over `ms`; animated ones end with their animation. */
function play(ctx: FxCtx, key: string, x: number, y: number, o: { rot?: number; sx?: number; sy?: number; depth?: number; add?: boolean; tint?: number; alpha?: number; oy?: number; ms?: number; rise?: number } = {}) {
  const s = ctx.scene;
  if (ctx.reduced || !s.textures.exists(key)) return null;
  const spr = s.add.sprite(x, y, key).setOrigin(0.5, o.oy ?? 0.5).setRotation(o.rot ?? 0).setScale(o.sx ?? 1, o.sy ?? o.sx ?? 1)
    .setDepth(o.depth ?? 4655).setAlpha(o.alpha ?? 1).setBlendMode(o.add === false ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD);
  if (o.tint !== undefined) spr.setTint(o.tint);
  const anim = s.anims.exists(key);
  if (anim) spr.play(key);
  if (o.ms || !anim) s.tweens.add({ targets: spr, alpha: 0, y: y - (o.rise ?? 0), duration: o.ms ?? 400, ease: 'Quad.easeIn', onComplete: () => spr.destroy() });
  else spr.once('animationcomplete', () => spr.destroy());
  return spr;
}

/** A pixel column of light crashing onto a world point (screen width in px), plus its light. */
function pillar(ctx: FxCtx, x: number, y: number, widthPx: number, heightPx = 220, tint?: number) {
  const p = ctx.P(x, y);
  ctx.dungeon.flashLight(p.x, p.y - 40, Math.max(160, widthPx * 4), tint ?? HOLY, 2.8, 420);
  if (!play(ctx, 'fx:templar:pillar', p.x, p.y + 2, { oy: 1, sx: widthPx / 38, sy: heightPx / 192, depth: 4662, tint })) ctx.juice.beam(p.x, p.y, heightPx, widthPx, tint ?? HOLY, 300);
}

/** Holy cross flash at a screen point. */
function crossFlash(ctx: FxCtx, sx: number, sy: number, scale = 1, tint?: number) {
  if (!play(ctx, 'fx:templar:cross', sx, sy, { sx: scale, sy: scale, depth: 4664, tint })) ctx.juice.starburst(sx, sy, tint ?? HOLY, scale);
}

/** A ground sigil flash at a world point, sized to world radius R. */
function sigilFlash(ctx: FxCtx, x: number, y: number, R: number, ms = 700, tint?: number) {
  const p = ctx.P(x, y);
  const k = ctx.rx(R) / 111;
  play(ctx, 'fx:templar:sigil', p.x, p.y, { sx: k, sy: k, depth: -67, ms, tint, alpha: 0.9 });
}

/** The hammer swing: a heavy gold crescent at the true reach and a white thin one inside it. */
function swing(ctx: FxCtx, e: CastFx, color: number, reach: number, k = 1) {
  const ang = aimAngle(ctx, e.dx, e.dy);
  const u = ctx.U(e.dx, e.dy);
  const c = chest(ctx, e.x, e.y);
  const s = Math.min(2.4, ctx.rx(reach) / 52) * k;
  ctx.juice.slash(c.x + u.x * 8, c.y + u.y * 6, ang, color, s);
  ctx.juice.slash(c.x + u.x * 12, c.y + u.y * 9, ang + 0.15, WHITE, s * 0.85, { thin: true, flip: true, ms: 170 });
  return { ang, u, c, s };
}

registerSkillFx({
  // ---- basic & signature ----
  // Hallowed Hammer: a heavy gold crescent (110 deg, 2.2 units) that thuds into the ground
  t_hammer: (ctx, e) => {
    const { u, c } = swing(ctx, e, e.count ? HOLY : GOLD, 2.2, e.count ? 1.15 : 1);
    const p = ctx.P(e.x + e.dx * 1.5, e.y + e.dy * 1.5);
    ctx.juice.dust(p.x + u.x * 4, p.y, 2, DUST);
    ctx.juice.sparksAt(c.x + u.x * ctx.rx(2.2) * 0.7, c.y + u.y * ctx.rx(2.2) * 0.4, 3, GOLD);
    sfx(ctx, 'swing', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  // every third swing: a radiant wave crescent (120 deg cone, 2.9 units) strewn with crosses
  t_shockwave: (ctx, e) => {
    const J = ctx.juice;
    const ang = aimAngle(ctx, e.dx, e.dy);
    const c = chest(ctx, e.x, e.y, 8);
    const u = ctx.U(e.dx, e.dy);
    const s = Math.min(2.6, ctx.rx(2.9) / 50);
    J.slash(c.x + u.x * 12, c.y + u.y * 9, ang, GOLD, s);
    J.slash(c.x + u.x * 22, c.y + u.y * 16, ang, WHITE, s * 0.9, { thin: true, ms: 220 });
    const wa = Math.atan2(e.dy, e.dx);
    for (let i = 0; i <= 4; i++) {
      const b = wa + ((i / 4) - 0.5) * ((120 * Math.PI) / 180);
      const q = ctx.P(e.x + Math.cos(b) * 2.6, e.y + Math.sin(b) * 2.6);
      J.sparksAt(q.x, q.y - 8, 3, GOLD);
      if (i % 2 === 0) J.bits('cross', q.x, q.y - 10, 1, HOLY);
    }
    const p = ctx.P(e.x + e.dx * 1.6, e.y + e.dy * 1.6);
    J.starburst(p.x, p.y - 10, WHITE, 1, 160);
    ctx.dungeon.flashLight(p.x, p.y - 10, 160, GOLD, 2, 180);
    sfx(ctx, 'skill_sweep', e.x, e.y, 80, ctx.mine ? 2 : 1);
  },
  // Judgment Day call: the Templar raises the hammer, a sigil opens at the target and a bell tolls
  t_judgment_day: (ctx, e) => {
    const J = ctx.juice;
    castFlash(ctx, e.x, e.y, P_SKY, 2, { glyph: true });
    const c = chest(ctx, e.x, e.y, 34);
    J.beam(c.x, c.y, 140, 8, HOLY, 380);
    J.bits('cross', c.x, c.y, 6, HOLY);
    const t = ctx.P(e.dx, e.dy);
    J.ring(t.x, t.y, ctx.rx(3.5), HOLY, 360);
    sigilFlash(ctx, e.dx, e.dy, 3.5, 700);
    ctx.dungeon.flashLight(t.x, t.y - 60, 240, HOLY, 1.8, 400);
    sfx(ctx, 'bell_toll', e.x, e.y, 0, 3);
    sfx(ctx, 'skill_rally', e.x, e.y, 0, 2);
  },
  // the pillar crashes down: the class's biggest spectacle
  t_judgment_land: (ctx, e) => {
    const R = e.dx || 3;
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    pillar(ctx, e.x, e.y, ctx.rx(R) * 0.95, 300);
    impactBurst(ctx, e.x, e.y, R, P_SKY, 3, { dust: 14 });
    J.shockwave(p.x, p.y, ctx.rx(R), GOLD, 460, 120);
    J.shockwave(p.x, p.y, ctx.rx(R * 1.3), WHITE, 560, 220);
    crossFlash(ctx, p.x, p.y - 60, 2.2);
    J.beam(p.x, p.y, 320, 10, 0xffffff, 300);
    J.bits('cross', p.x, p.y - 20, 14, HOLY);
    J.bits('star', p.x, p.y - 20, 12, GOLD);
    J.embersAt(p.x, p.y - 8, 20, HOLY);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const q = ctx.P(e.x + Math.cos(a) * R * 0.8, e.y + Math.sin(a) * R * 0.8);
      J.bits('star', q.x, q.y - 6, 2, WHITE, { angle: -90, spread: 40, speed: 1.4 });
    }
    J.pop(HOLY, 0.26, 280);
    if (ctx.mine) J.hitStop(90);
    sfx(ctx, 'signature_slam', e.x, e.y, 0, 4);
    sfx(ctx, 'signature_nova', e.x, e.y, 0, 3);
  },

  // ---- Radiance: sun gold, motes ----
  t_consecrate: (ctx, e) => {
    const J = ctx.juice;
    const R = e.dx || 2.6;
    const p = ctx.P(e.x, e.y);
    castFlash(ctx, e.x, e.y, P_SUN, 1.4);
    J.shockwave(p.x, p.y, ctx.rx(R), GOLD, 420);
    J.ring(p.x, p.y, ctx.rx(R * 0.6), WHITE, 300);
    sigilFlash(ctx, e.x, e.y, R, 500);
    J.bits('mote', p.x, p.y - 6, 14, HOLY);
    J.bits('cross', p.x, p.y - 12, 4, GOLD);
    ctx.dungeon.flashLight(p.x, p.y - 12, 220, GOLD, 2.2, 460);
    if (ctx.rank(e.slot, 't_blinding_light')) blinding(ctx, e.x, e.y, R);
    sfx(ctx, 'skill_rally', e.x, e.y, 0, 2);
  },
  // Dawnbreak: a sunrise nova at radius 3.5 that heals and stuns
  t_dawnbreak: (ctx, e) => {
    const J = ctx.juice;
    const R = e.dx || 3.5;
    const p = ctx.P(e.x, e.y);
    const c = chest(ctx, e.x, e.y, 16);
    J.orb(c.x, c.y, GOLD, 1.4, 320, 2.4);
    J.orb(c.x, c.y, WHITE, 0.7, 200, 1.8);
    impactBurst(ctx, e.x, e.y, R, P_SUN, ctx.mine ? 3 : 2, { dust: 6 });
    J.shockwave(p.x, p.y, ctx.rx(R * 1.1), HOLY, 560, 140);
    sigilFlash(ctx, e.x, e.y, R, 700);
    // sun rays fanning out low over the ground
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const q = ctx.P(e.x + Math.cos(a) * R * 0.75, e.y + Math.sin(a) * R * 0.75);
      J.beam(q.x, q.y, 50, 6, i % 2 ? GOLD : WHITE, 360);
    }
    J.bits('mote', c.x, c.y, 18, HOLY);
    J.bits('cross', c.x, c.y, 5, WHITE);
    if (ctx.rank(e.slot, 't_blinding_light')) blinding(ctx, e.x, e.y, R);
    sfx(ctx, 'signature_nova', e.x, e.y, 0, 3);
  },
  // Beacon of Light: an arcing spark lands and a sun ignites over the target
  t_beacon: (ctx, e) => {
    const J = ctx.juice;
    arcTrail(ctx, e.x, e.y, e.dx, e.dy, GOLD, 50, 320);
    castFlash(ctx, e.x, e.y, P_SUN, 1);
    pillar(ctx, e.dx, e.dy, 26, 220);
    const t = ctx.P(e.dx, e.dy);
    J.shockwave(t.x, t.y, ctx.rx(3), GOLD, 420);
    J.starburst(t.x, t.y - 46, WHITE, 1.4, 240);
    J.bits('mote', t.x, t.y - 40, 10, HOLY);
    sigilFlash(ctx, e.dx, e.dy, 3, 600);
    if (ctx.rank(e.slot, 't_blinding_light')) blinding(ctx, e.dx, e.dy, 3);
    sfx(ctx, 'skill_phase', e.dx, e.dy, 0, 2);
  },

  // ---- Judgment: hammers and sky light ----
  t_hammer_throw: (ctx, e) => {
    swing(ctx, e, GOLD, 2, 1.1);
    castFlash(ctx, e.x, e.y, P_SKY, 0.8, { dx: e.dx, dy: e.dy });
    sfx(ctx, 'skill_sweep', e.x, e.y, 0, ctx.mine ? 2 : 1);
  },
  t_skyfall: (ctx, e) => {
    swing(ctx, e, HOLY, 2, 1.2);
    castFlash(ctx, e.x, e.y, P_SKY, 1.2, { dx: e.dx, dy: e.dy });
    const c = chest(ctx, e.x, e.y, 26);
    ctx.juice.embersAt(c.x, c.y, 8, HOLY);
    sfx(ctx, 'skill_sweep', e.x, e.y, 0, ctx.mine ? 2 : 1);
  },
  // where the Skyfall hammer stops: a pillar of light smites 2 units
  t_skyfall_smite: (ctx, e) => {
    const R = e.dx || 2;
    const p = ctx.P(e.x, e.y);
    pillar(ctx, e.x, e.y, ctx.rx(R) * 0.75, 260);
    impactBurst(ctx, e.x, e.y, R, P_SKY, ctx.mine ? 3 : 2, { dust: 8 });
    crossFlash(ctx, p.x, p.y - 44, 1.5);
    ctx.juice.bits('star', p.x, p.y - 16, 8, GOLD);
    sfx(ctx, 'skill_arc', e.x, e.y, 0, 3);
    sfx(ctx, 'bell_toll', e.x, e.y, 400, 1);
  },
  // Divine Smite cast: the hand rises, a faint sigil marks the 3.5 unit search radius
  t_smite: (ctx, e) => {
    const J = ctx.juice;
    const c = chest(ctx, e.x, e.y, 30);
    J.orb(c.x, c.y, HOLY, 0.8, 220, 2);
    J.starburst(c.x, c.y, WHITE, 0.9, 160);
    J.beam(c.x, c.y, 120, 6, HOLY, 260);
    const t = ctx.P(e.dx, e.dy);
    J.ring(t.x, t.y, ctx.rx(3.5), GOLD, 300);
    sigilFlash(ctx, e.dx, e.dy, 3.5, 420);
    sfx(ctx, 'skill_arc', e.dx, e.dy, 0, 3);
  },
  // each lance of light (up to 3 per cast, 1 unit splash)
  t_smite_hit: (ctx, e) => {
    const R = e.dx || 1;
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    pillar(ctx, e.x, e.y, 24, 280);
    J.beam(p.x, p.y, 300, 6, 0xffffff, 200);
    J.shockwave(p.x, p.y, ctx.rx(R), GOLD, 280);
    J.starburst(p.x, p.y - 10, WHITE, 1.3, 180);
    crossFlash(ctx, p.x, p.y - 30, 0.9);
    J.sparksAt(p.x, p.y - 8, 10, GOLD);
    J.bits('cross', p.x, p.y - 10, 3, HOLY);
    sfx(ctx, 'skill_arc', e.x, e.y, 60, 2);
  },
  // Heaven's Call smite
  t_heaven_smite: (ctx, e) => {
    const R = e.dx || 1.2;
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    pillar(ctx, e.x, e.y, 18, 260, 0xfffbe8);
    J.shockwave(p.x, p.y, ctx.rx(R), HOLY, 260);
    J.starburst(p.x, p.y - 8, WHITE, 1, 150);
    J.bits('star', p.x, p.y - 8, 4, GOLD);
    sfx(ctx, 'skill_arc', e.x, e.y, 90, 1);
  },
  // Condemn detonation: a cross bursts out of the mark, one ring per stack; Final Verdict burns orange
  t_condemn_burst: (ctx, e) => {
    const verdict = e.dy === 1;
    const stacks = Math.max(1, Math.round(e.dx || 1));
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const c = chest(ctx, e.x, e.y, 16);
    const pal = verdict ? P_VERDICT : P_SKY;
    impactBurst(ctx, e.x, e.y, 1.8, pal, verdict ? 3 : 1, { dust: 0 });
    crossFlash(ctx, c.x, c.y - 6, 0.9 + stacks * 0.25 + (verdict ? 0.5 : 0), verdict ? 0xffb070 : undefined);
    for (let i = 0; i < stacks; i++) J.ring(p.x, p.y, ctx.rx(1.8) * (0.5 + i * 0.25), verdict ? VERDICT : HOLY, 260 + i * 70);
    if (verdict) { J.number(c.x, c.y - 20, 'VERDICT', '#ffae5a', 'md'); if (ctx.mine) J.hitStop(45); }
    sfx(ctx, 'crit', e.x, e.y, 50, 2);
  },
  // Grinding Halt: the hammer stops and starts to spin in place
  t_hammer_hover: (ctx, e) => {
    const R = e.dx || 1.5;
    const p = ctx.P(e.x, e.y);
    ctx.juice.shockwave(p.x, p.y, ctx.rx(R), GOLD, 300);
    ctx.juice.glyph(p.x, p.y, ctx.rx(R), GOLD, 1300);
    ctx.juice.starburst(p.x, p.y - 14, WHITE, 0.9, 160);
  },
  // grind tick (every 0.2s): cheap sparks off the spinning head
  t_hammer_spin: (ctx, e) => {
    const R = e.dx || 1.5;
    const a = Math.random() * Math.PI * 2;
    const q = ctx.P(e.x + Math.cos(a) * R * 0.7, e.y + Math.sin(a) * R * 0.7);
    ctx.juice.sparksAt(q.x, q.y - 10, 4, GOLD);
    sfx(ctx, 'swing', e.x, e.y, 110, 1);
  },
  t_hammer_catch: (ctx, e) => {
    const c = chest(ctx, e.x, e.y, 18);
    ctx.juice.starburst(c.x, c.y, WHITE, 0.9, 160);
    ctx.juice.sparksAt(c.x, c.y, 8, HOLY);
    ctx.juice.bits('star', c.x, c.y, 3, GOLD);
    sfx(ctx, 'shield', e.x, e.y, 120, 1);
  },

  // ---- Aegis: warding blue and gold ----
  t_shield_charge: (ctx, e) => chargeStart(ctx, e, GOLD),
  t_aegis_charge: (ctx, e) => chargeStart(ctx, e, WARD),
  t_charge_end: (ctx, e) => {
    const J = ctx.juice;
    const u = ctx.U(e.dx, e.dy);
    const slamR = ctx.rank(e.slot, 't_shield_slam') ? 1.8 : 0;
    const jugg = ctx.rank(e.slot, 't_juggernaut') > 0;
    const R = Math.max(slamR, jugg ? 2 : 1.4);
    const p = ctx.P(e.x + e.dx * 0.6, e.y + e.dy * 0.6);
    J.impact(p.x, p.y - 14, WHITE, 2.2);
    J.starburst(p.x, p.y - 14, HOLY, 1.3 + (jugg ? 0.4 : 0), 200);
    J.sparksAt(p.x + u.x * 6, p.y - 12, 16, GOLD);
    J.dust(p.x, p.y, 10, DUST);
    J.bits('ice', p.x, p.y - 6, 5, 0x8a7a68, { angle: -90, spread: 120 });
    J.shockwave(p.x, p.y, ctx.rx(R), GOLD, 300);
    if (slamR) { J.ring(p.x, p.y, ctx.rx(slamR), WHITE, 260); J.bits('star', p.x, p.y - 20, 4, 0xfff0a0); }
    if (ctx.rank(e.slot, 't_guardians_path')) {
      const a = chest(ctx, e.x - e.dx * 5, e.y - e.dy * 5), b = chest(ctx, e.x, e.y);
      J.bitsAlong('rune', a.x, a.y, b.x, b.y, 8, WARD);
    }
    ctx.dungeon.flashLight(p.x, p.y - 10, 180, GOLD, 2.2, 220);
    if (ctx.mine) J.hitStop(55);
    sfx(ctx, 'signature_slam', e.x, e.y, 0, 3);
  },
  // Aegis Dome rises (radius 3)
  t_dome_up: (ctx, e) => {
    const J = ctx.juice;
    const R = e.dx || 3;
    const p = ctx.P(e.x, e.y);
    impactBurst(ctx, e.x, e.y, R, P_WARD, 2, { dust: 0 });
    J.beam(p.x, p.y, ctx.rx(R) * 0.9, ctx.rx(R) * 0.8, WARD, 420);
    J.bits('rune', p.x, p.y - 20, 10, WARD);
    J.glyph(p.x, p.y, ctx.rx(R), WARD, 800);
    ctx.dungeon.flashLight(p.x, p.y - 30, 240, WARD, 2.2, 420);
    sfx(ctx, 'skill_guard', e.x, e.y, 0, 3);
  },
  // an enemy projectile shattering on the dome
  t_dome_block: (ctx, e) => {
    const c = chest(ctx, e.x, e.y, 16);
    ctx.juice.impact(c.x, c.y, WARD, 1.3);
    ctx.juice.starburst(c.x, c.y, 0xffffff, 0.8, 140);
    ctx.juice.bits('ice', c.x, c.y, 3, WARD);
    sfx(ctx, 'shield', e.x, e.y, 70, 1);
  },
  // Intercession: a gilded leap to an ally
  t_intercession: (ctx, e) => {
    const J = ctx.juice;
    arcTrail(ctx, e.x, e.y, e.dx, e.dy, GOLD, 80, 460);
    const p = ctx.P(e.x, e.y);
    J.dust(p.x, p.y, 8, DUST);
    J.bits('feather', p.x, p.y - 18, 6, WHITE);
    play(ctx, 'fx:templar:wings', p.x, p.y - 24, { sx: 1, sy: 1, depth: 4600, ms: 420, alpha: 0.85, rise: 18 });
    heroGhosts(ctx, e.slot, e.dx - e.x, e.dy - e.y, GOLD, 3, 10);
    sfx(ctx, 'cine_whoosh', e.x, e.y, 0, 2);
  },
  t_intercession_land: (ctx, e) => {
    const J = ctx.juice;
    const R = e.dx || 2.2;
    const p = ctx.P(e.x, e.y);
    impactBurst(ctx, e.x, e.y, R, P_SUN, ctx.mine ? 3 : 2, { dust: 10 });
    J.shockwave(p.x, p.y, ctx.rx(3), WARD, 460, 100);
    play(ctx, 'fx:templar:wings', p.x, p.y - 26, { sx: 1.5, sy: 1.5, depth: 4600, ms: 650, alpha: 0.95, rise: 10 });
    J.bits('feather', p.x, p.y - 24, 10, WHITE);
    J.bits('cross', p.x, p.y - 20, 5, HOLY);
    sfx(ctx, 'signature_slam', e.x, e.y, 0, 3);
    sfx(ctx, 'shield', e.x, e.y, 0, 2);
  },
  // a Vow shield breaks: blue glass and light
  t_vow_burst: (ctx, e) => {
    const J = ctx.juice;
    const R = e.dx || 2.2;
    const c = chest(ctx, e.x, e.y, 18);
    impactBurst(ctx, e.x, e.y, R, P_WARD, 2, { dust: 0 });
    J.bits('ice', c.x, c.y, 10, WARD, { angle: -90, spread: 220, speed: 1.2 });
    crossFlash(ctx, c.x, c.y - 4, 1.1, 0xc8e8ff);
    sfx(ctx, 'ice_shatter', e.x, e.y, 60, 2);
    sfx(ctx, 'signature_nova', e.x, e.y, 60, 2);
  },
  // Divine Intervention: wings of light unfold behind the saved player
  t_intervention: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    pillar(ctx, e.x, e.y, 34, 300, 0xffffff);
    play(ctx, 'fx:templar:wings', p.x, p.y - 30, { sx: 2, sy: 2, depth: 4600, ms: 1100, rise: 14 });
    J.shockwave(p.x, p.y, ctx.rx(2), WHITE, 500);
    J.bits('feather', p.x, p.y - 30, 14, WHITE);
    J.bits('cross', p.x, p.y - 20, 6, HOLY);
    J.embersAt(p.x, p.y - 20, 24, HOLY);
    J.pop(0xffffff, 0.22, 260);
    if (ctx.mine) J.hitStop(80);
    window.dispatchEvent(new CustomEvent('cursebound:banner', { detail: { text: 'Divine Intervention!', tone: 'good' } }));
    sfx(ctx, 'player_revived', e.x, e.y, 0, 4);
  },
  // Retribution keystone: stored pain released as an orange-gold nova (scales with the amount stored)
  t_retribution: (ctx, e) => {
    const J = ctx.juice;
    const R = e.dx || 2.6;
    const stored = Math.max(0, Math.min(1, e.dy || 0));
    const p = ctx.P(e.x, e.y);
    const big = stored > 0.3;
    impactBurst(ctx, e.x, e.y, R, P_VERDICT, big ? 3 : 2, { dust: 8 });
    J.shockwave(p.x, p.y, ctx.rx(R * 1.2), GOLD, 480, 120);
    pillar(ctx, e.x, e.y, ctx.rx(R) * (0.4 + stored * 0.5), 240, 0xffc890);
    crossFlash(ctx, p.x, p.y - 40, 1.2 + stored * 1.2, 0xffc080);
    J.bits('cross', p.x, p.y - 16, 6 + Math.round(stored * 10), VERDICT);
    sfx(ctx, 'signature_nova', e.x, e.y, 0, 3);
  },
});

function blinding(ctx: FxCtx, x: number, y: number, R: number) {
  const p = ctx.P(x, y);
  ctx.juice.starburst(p.x, p.y - 20, 0xffffff, 2, 260);
  ctx.juice.shockwave(p.x, p.y, ctx.rx(R), 0xffffff, 300);
  ctx.juice.bits('star', p.x, p.y - 16, 10, 0xffffff);
  if (ctx.mine) ctx.juice.pop(0xffffff, 0.12, 140);
  sfx(ctx, 'blind_burst', x, y, 0, 2);
}

function chargeStart(ctx: FxCtx, e: CastFx, color: number) {
  const J = ctx.juice;
  streak(ctx, e.x, e.y, e.x + e.dx * 5, e.y + e.dy * 5, color, 10, 300, 12);
  castFlash(ctx, e.x, e.y, color === WARD ? P_WARD : P_SUN, 1, { dx: e.dx, dy: e.dy });
  heroGhosts(ctx, e.slot, e.dx, e.dy, color, 4, 9);
  const p = ctx.P(e.x, e.y);
  J.dust(p.x, p.y, 10, DUST);
  J.sparksAt(p.x, p.y - 14, 8, color);
  sfx(ctx, 'boss_charge', e.x, e.y, 0, 2);
}

/** Sigil sprite held on a ground hazard (one per hazard id, destroyed when the hazard stops drawing). */
function sigil(ctx: FxCtx, key: string, x: number, y: number, r: number, alpha: number, tint?: number) {
  if (ctx.reduced) return;
  const p = ctx.P(x, y);
  const s = keep(ctx, key, () => {
    const o = ctx.scene.add.sprite(p.x, p.y, 'fx:templar:sigil').setBlendMode(Phaser.BlendModes.ADD);
    if (ctx.scene.anims.exists('fx:templar:sigil')) o.play('fx:templar:sigil');
    if (tint !== undefined) o.setTint(tint);
    return o;
  });
  const k = ctx.rx(r) / 111;
  s.setPosition(p.x, p.y).setScale(k, k).setDepth(-67).setAlpha(alpha);
}

registerHazardFx({
  // consecrated ground: warm disc, the turning pixel sigil, a pulse each 0.5s and rising motes and crosses
  t_consecration: (ctx, g, h) => {
    const sanctum = ctx.rank(h.in, 't_sanctum') > 0;
    const searing = ctx.rank(h.in, 't_searing_light') > 0;
    groundCircle(ctx, g, h.x, h.y, h.r, GOLD, 0.12, DEEP, 2, 0.8);
    sigil(ctx, `tcs:${h.i}`, h.x, h.y, h.r, 0.5 + 0.12 * Math.sin(ctx.now / 260 + h.i));
    if (ctx.reduced) runeRing(ctx, g, h.x, h.y, h.r * 0.8, HOLY, 0.75, ctx.now / 1400);
    if (sanctum) groundCircle(ctx, g, h.x, h.y, h.r * 0.96, null, 0, WARD, 1, 0.6);
    pulseRing(ctx, g, h.x, h.y, h.r, searing ? VERDICT : WHITE, 500, h.i * 37);
    if (!ctx.reduced && Math.random() < 0.2) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * h.r;
      const p = ctx.P(h.x + Math.cos(a) * r, h.y + Math.sin(a) * r);
      if (Math.random() < 0.25) ctx.juice.bits('cross', p.x, p.y - 4, 1, HOLY);
      else ctx.juice.embersAt(p.x, p.y - 4, 1, HOLY);
    }
  },
  // beacon: a floating pixel sun over a sigil of light, its ray falling to the ground
  t_beacon: (ctx, g, h) => {
    groundCircle(ctx, g, h.x, h.y, h.r, HOLY, 0.07, GOLD, 1, 0.5);
    pulseRing(ctx, g, h.x, h.y, h.r, GOLD, 500, h.i * 53);
    sigil(ctx, `tbs:${h.i}`, h.x, h.y, h.r, 0.35);
    const p = ctx.P(h.x, h.y);
    const bob = Math.sin(ctx.now / 260) * 3;
    const cy = Math.round(p.y - 46 + bob);
    g.lineStyle(3, GOLD, 0.18).lineBetween(p.x, cy, p.x, p.y);
    g.lineStyle(1, HOLY, 0.5).lineBetween(p.x, cy, p.x, p.y);
    const sun = keep(ctx, `tb:${h.i}`, () => {
      const o = ctx.scene.add.sprite(p.x, cy, 'fx:templar:sun').setBlendMode(Phaser.BlendModes.ADD);
      if (ctx.scene.anims.exists('fx:templar:sun')) o.play('fx:templar:sun');
      return o;
    });
    sun.setPosition(Math.round(p.x), cy).setDepth(4600).setScale(1.2 + 0.08 * Math.sin(ctx.now / 180));
    if (!ctx.reduced && Math.random() < 0.12) ctx.juice.bits('mote', p.x, cy, 1, HOLY);
  },
  // pending Judgment Day: the sigil fills while a column of light descends
  t_judgment: (ctx, g, h) => {
    const prog = Math.min(1, age(ctx, `tj:${h.i}`) / 350);
    groundCircle(ctx, g, h.x, h.y, h.r, HOLY, 0.08 + 0.2 * prog, WHITE, 2, 0.9);
    groundCircle(ctx, g, h.x, h.y, h.r * prog, GOLD, 0.3);
    groundCircle(ctx, g, h.x, h.y, 3.5, null, 0, GOLD, 1, 0.6);
    sigil(ctx, `tjs:${h.i}`, h.x, h.y, h.r, 0.4 + 0.5 * prog);
    const p = ctx.P(h.x, h.y);
    const o = keep(ctx, `tjc:${h.i}`, () => ctx.scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD));
    o.clear().setDepth(4661);
    const w = Math.round(ctx.rx(h.r) * 0.3 * prog);
    const len = Math.round(320 * prog);
    o.fillStyle(GOLD, 0.25 + 0.2 * prog).fillRect(p.x - w, p.y - 320, w * 2, len);
    o.fillStyle(HOLY, 0.35 + 0.3 * prog).fillRect(p.x - Math.round(w / 2), p.y - 320, w, len);
    o.fillStyle(0xffffff, 0.6 * prog).fillRect(p.x - Math.max(1, Math.round(w / 6)), p.y - 320, Math.max(2, Math.round(w / 3)), len);
  },
  // Heaven's Call smite pending on an enemy: a ring closing in with a cross mark
  t_smite_mark: (ctx, g, h) => {
    const prog = Math.min(1, age(ctx, `ts:${h.i}`) / 200);
    groundCircle(ctx, g, h.x, h.y, h.r * (1.6 - 0.6 * prog), null, 0, HOLY, 2, 0.4 + 0.6 * prog);
    groundCircle(ctx, g, h.x, h.y, h.r * prog, GOLD, 0.25);
    const p = ctx.P(h.x, h.y);
    const s = Math.round(ctx.ry(h.r) * 0.6);
    g.lineStyle(2, WHITE, 0.8 * prog).lineBetween(p.x - s * 2, p.y, p.x + s * 2, p.y).lineBetween(p.x, p.y - s, p.x, p.y + s);
  },
  // condemned: a turning golden sigil over the enemy's head, one pixel cross per stack
  t_condemn: (ctx, g, h) => {
    const p = ctx.P(h.x, h.y);
    groundCircle(ctx, g, h.x, h.y, Math.max(0.5, h.r + 0.15), null, 0, GOLD, 1, 0.6);
    const o = keep(ctx, `tc:${h.i}`, () => ctx.scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD));
    o.clear().setDepth(4610);
    const cy = Math.round(p.y - 34 - h.r * 20 + Math.sin(ctx.now / 200) * 2);
    const a = ctx.now / 500;
    const n = Math.max(1, Math.round(h.out));
    o.lineStyle(2, n >= 3 ? VERDICT : GOLD, 0.95);
    for (let i = 0; i < 3; i++) {
      const a0 = a + (i * Math.PI * 2) / 3, a1 = a0 + (Math.PI * 2) / 3;
      o.lineBetween(p.x + Math.cos(a0) * 9, cy + Math.sin(a0) * 4, p.x + Math.cos(a1) * 9, cy + Math.sin(a1) * 4);
    }
    for (let i = 0; i < n; i++) {
      const x = Math.round(p.x - (n - 1) * 4 + i * 8), y = cy - 12;
      o.fillStyle(HOLY, 1).fillRect(x - 1, y - 3, 2, 7).fillRect(x - 3, y - 1, 6, 2);
    }
  },
  // charge: a bright wedge of light behind the shield, with gilded afterimages
  t_charge: (ctx, g, h) => {
    const p0 = ctx.P(h.x - h.dx * 1.8, h.y - h.dy * 1.8), p1 = ctx.P(h.x, h.y);
    g.lineStyle(12, GOLD, 0.2).lineBetween(p0.x, p0.y - 10, p1.x, p1.y - 10);
    g.lineStyle(5, HOLY, 0.4).lineBetween(p0.x, p0.y - 10, p1.x, p1.y - 10);
    g.lineStyle(2, WHITE, 0.8).lineBetween(p0.x, p0.y - 10, p1.x, p1.y - 10);
    if (!ctx.reduced && Math.random() < 0.35) {
      const spr = heroSprite(ctx, h.in);
      if (spr) ctx.juice.afterimage(spr, GOLD, 0.45, 200);
      ctx.juice.dust(p1.x, p1.y, 1, DUST);
    }
  },
  // aegis dome: a translucent hemisphere with a shimmering lattice and a turning ward band at its base
  t_dome: (ctx, g, h) => {
    groundCircle(ctx, g, h.x, h.y, h.r, WARD, 0.1, WARD, 2, 0.8);
    const p = ctx.P(h.x, h.y);
    const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
    if (!ctx.reduced) {
      const band = keep(ctx, `tdb:${h.i}`, () => {
        const o = ctx.scene.add.sprite(p.x, p.y, 'fx:templar:ward').setBlendMode(Phaser.BlendModes.ADD);
        if (ctx.scene.anims.exists('fx:templar:ward')) o.play('fx:templar:ward');
        return o;
      });
      band.setPosition(p.x, p.y).setScale(rx / 119, ry / 59.5).setDepth(-66).setAlpha(0.8);
    }
    const o = keep(ctx, `td:${h.i}`, () => ctx.scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD));
    o.clear().setDepth(4605);
    const H = rx * 0.75;
    const shimmer = 0.22 + 0.1 * Math.sin(ctx.now / 180);
    o.fillStyle(WARD, 0.06).fillEllipse(p.x, p.y - H * 0.45, rx * 2, H * 1.3, 32);
    // meridians and parallels of the lattice
    for (let k = 1; k <= 3; k++) {
      o.lineStyle(1, WARD, shimmer);
      o.beginPath();
      for (let i = 0; i <= 20; i++) { const t = Math.PI + (i / 20) * Math.PI; const x = p.x + Math.cos(t) * rx * (k / 3), y = p.y + Math.sin(t) * H * (k / 3); if (i === 0) o.moveTo(x, y); else o.lineTo(x, y); }
      o.strokePath();
      const yy = p.y - H * (k / 4), w = rx * Math.sqrt(1 - (k / 4) ** 2);
      o.lineBetween(p.x - w, yy, p.x + w, yy);
    }
    o.lineStyle(2, 0xffffff, 0.5);
    o.beginPath();
    for (let i = 0; i <= 24; i++) { const t = Math.PI + (i / 24) * Math.PI; const x = p.x + Math.cos(t) * rx, y = p.y + Math.sin(t) * H; if (i === 0) o.moveTo(x, y); else o.lineTo(x, y); }
    o.strokePath();
    // a glint sliding over the surface
    const gt = ((ctx.now / 1400 + h.i * 0.37) % 1) * Math.PI;
    o.fillStyle(0xffffff, 0.8).fillRect(Math.round(p.x - Math.cos(gt) * rx * 0.8) - 1, Math.round(p.y - Math.sin(gt) * H * 0.8) - 1, 3, 3);
  },
  // vow: a golden halo ring at the bound ally's feet and the oath shield floating over their head
  t_vow: (ctx, g, h) => {
    groundCircle(ctx, g, h.x, h.y, 0.75, HOLY, 0.12, GOLD, 2, 0.9);
    runeRing(ctx, g, h.x, h.y, 0.75, WARD, 0.6, ctx.now / 700, 4);
    if (ctx.reduced) return;
    const p = ctx.P(h.x, h.y);
    const y = Math.round(p.y - 52 + Math.sin(ctx.now / 240 + h.i) * 2);
    const s = keep(ctx, `tvs:${h.i}`, () => ctx.scene.add.image(p.x, y, 'fx:templar:shield'));
    s.setPosition(Math.round(p.x), y).setDepth(4612).setAlpha(0.85 + 0.15 * Math.sin(ctx.now / 160));
  },
  t_leap_mark: (ctx, g, h) => {
    const prog = Math.min(1, age(ctx, `tl:${h.i}`) / 400);
    groundCircle(ctx, g, h.x, h.y, h.r, null, 0, GOLD, 2, 0.8);
    groundCircle(ctx, g, h.x, h.y, h.r * prog, HOLY, 0.2);
    sigil(ctx, `tls:${h.i}`, h.x, h.y, h.r, 0.3 + 0.5 * prog);
  },
  // Living Bastion aura: a faint ward band around the Templar
  t_bastion_aura: (ctx, g, h) => {
    groundCircle(ctx, g, h.x, h.y, h.r, WARD, 0.04, WARD, 1, 0.35);
    runeRing(ctx, g, h.x, h.y, h.r, WARD, 0.3, ctx.now / 3000, 12);
  },
}, { t_consecration: GOLD, t_beacon: HOLY, t_judgment: WHITE, t_dome: WARD, t_smite_mark: HOLY });

const hammerEnd = (ctx: FxCtx, sx: number, sy: number) => { ctx.juice.starburst(sx, sy, HOLY, 0.7, 140); ctx.juice.sparksAt(sx, sy, 5, GOLD); };

registerProjectileFx({
  // the thrown warhammer: a real spinning pixel hammer shedding stars (outbound, hovering, returning)
  t_hammer: { key: 'fx:templar:hammer', color: GOLD, scale: 1.2, additive: false, spin: 900, trail: 'star', trailMs: 50, end: hammerEnd },
  t_hammer_h: { key: 'fx:templar:hammer', color: GOLD, scale: 1.2, additive: false, spin: 900, trail: 'mote', trailMs: 60, end: hammerEnd },
  t_hammer_r: { key: 'fx:templar:hammer', color: HOLY, scale: 1.2, additive: false, spin: 900, trail: 'star', trailMs: 50, end: hammerEnd },
  // the Beacon's holy bolt
  t_bolt: {
    key: 'fx:templar:bolt', color: HOLY, scale: 1, additive: true, trail: 'mote', trailMs: 50,
    end: (ctx, sx, sy) => { ctx.juice.starburst(sx, sy, WHITE, 0.6, 130); ctx.juice.bits('cross', sx, sy, 1, HOLY); },
  },
});

registerKillFx({
  // Templar kills: the soul rises as a cross of light; crits flash a cross; elites and bosses get a small pillar
  templar: (ctx, k) => {
    const J = ctx.juice;
    const c = chest(ctx, k.x, k.y, 12);
    J.bits('cross', c.x, c.y, k.big ? 3 : 1, HOLY);
    J.starburst(c.x, c.y, GOLD, k.big ? 0.9 : 0.6, 150);
    if (k.crit) crossFlash(ctx, c.x, c.y - 4, 0.7);
    if (k.elite || k.boss) {
      pillar(ctx, k.x, k.y, k.boss ? 40 : 22, 220);
      J.bits('star', c.x, c.y, 8, GOLD);
    }
  },
});
