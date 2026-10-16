import * as Phaser from 'phaser';
import { registerHazardFx, registerKillFx, registerProjectileFx, registerSkillFx, type CastFx, type FxCtx } from './registry';
import { heroGhosts, impactBurst, type Pal } from './spectacle';
import { age, aimAngle, arcTrail, chest, cracks, enlargeHero, groundCircle, heroSprite, keep, pulseRing, sfx, streak } from './tbfx';
import { skillLayer, skillSfx } from './kit3';

// Berserker presentation (cosmetic only): blood red, hot iron and ember sparks, dread purple for fear.
// Sim conventions (simulation/src/classes/berserker.ts): b_leap / b_cataclysm carry the landing point in dx/dy;
// b_avatar carries (duration, Fury spent); b_whirl_tick carries (radius, kind); b_quake_ring (radius, ring index);
// b_leap_land, b_cataclysm_land, b_aftershock, b_shout (radius, enemies hit), b_bloodbath (radius, enemies hit),
// b_avatar_whirl, b_flay_burst, b_harvest carry a radius in dx. b_undying carries its duration, b_deathless the Fury left.
// Everything else uses dx/dy as the aim direction. Hazards carry the owning Berserker's slot in `in`.
// Branch colours: Fury = crimson blood and drops, Carnage = steel and red smears, Warcry = ember earth and dust
// (Intimidating Shout = dread purple). No camera shake anywhere: weight comes from hit-stop, light, decals and debris.

const BLOOD = 0xd0202a;
const RAGE = 0xff4a2a;
const IRON = 0xc8ccd4;
const EMBER = 0xff8a3a;
const GORE = 0x7a0a12;
const DREAD = 0x8a3aa0;
const HOT = 0xffe0b0;
const DUST = 0x5a4a40;
const ROCK = 0x7a6858;

const P_BLOOD: Pal = { main: BLOOD, hot: HOT, deep: GORE, bits: 'mote' };
const P_EARTH: Pal = { main: EMBER, hot: HOT, deep: 0x8a3010 };

const DEPTH_GROUND = -66;

/** One-shot pixel sheet (art/fx/berserker.ts). Looping sheets or `ms` fade out over ms; otherwise the animation ends it. */
function play(ctx: FxCtx, key: string, x: number, y: number, o: { rot?: number; sx?: number; sy?: number; depth?: number; add?: boolean; tint?: number; alpha?: number; oy?: number; flipY?: boolean; ms?: number; force?: boolean } = {}) {
  const s = ctx.scene;
  if ((ctx.reduced && !o.force) || !s.textures.exists(key)) return null;
  const spr = s.add.sprite(x, y, key).setOrigin(0.5, o.oy ?? 0.5).setRotation(o.rot ?? 0).setScale(o.sx ?? 1, o.sy ?? o.sx ?? 1)
    .setDepth(o.depth ?? 4650).setAlpha(o.alpha ?? 1).setBlendMode(o.add === false ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD);
  if (o.flipY) spr.setFlipY(true);
  if (o.tint !== undefined) spr.setTint(o.tint);
  const anim = s.anims.exists(key);
  if (anim) spr.play(key);
  if (o.ms || !anim) s.tweens.add({ targets: spr, alpha: 0, duration: o.ms ?? 400, ease: 'Quad.easeIn', onComplete: () => spr.destroy() });
  else spr.once('animationcomplete', () => spr.destroy());
  return spr;
}

/** Cracked-earth burst lying on the ground at a world point, sized to the true radius R. */
function quakeDecal(ctx: FxCtx, x: number, y: number, R: number, tint?: number) {
  const p = ctx.P(x, y);
  const k = (ctx.rx(R) * 2) / 192 * 1.05;
  play(ctx, 'fx:berserker:quake', p.x, p.y, { sx: k, sy: k, depth: DEPTH_GROUND, add: false, tint });
}

/** The heavy blood cleave crescent centred on the hero's chest, reaching `reach` world units along screen angle `ang`. */
function cleave(ctx: FxCtx, x: number, y: number, ang: number, reach: number, o: { flipY?: boolean; tint?: number; lift?: number } = {}) {
  const c = chest(ctx, x, y, o.lift ?? 12);
  const k = Math.min(3.2, (ctx.rx(reach) * 0.95) / 62);
  // the crescent's centre sits 20px (x scale) behind the sheet centre
  const off = 20 * k;
  play(ctx, 'fx:berserker:cleave', c.x + Math.cos(ang) * off, c.y + Math.sin(ang) * off * 0.75, { rot: ang, sx: k, sy: k * 0.8, depth: 4651, flipY: o.flipY, tint: o.tint });
}

/** Rocks and grit thrown up around a ring of world radius R (angular 'ice' bits read as rock chips). */
function debrisRing(ctx: FxCtx, x: number, y: number, R: number, n: number, chips = 2) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const q = ctx.P(x + Math.cos(a) * R, y + Math.sin(a) * R);
    ctx.juice.dust(q.x, q.y, 2, DUST);
    ctx.juice.bits('ice', q.x, q.y - 4, chips, ROCK, { angle: -90, spread: 70, speed: 0.8 });
  }
}

/** Ground slam: thick waves at the true radius, the crack sheet, scar lines, debris and a light. */
function slam(ctx: FxCtx, x: number, y: number, R: number, power: 2 | 3, pal: Pal = P_EARTH) {
  impactBurst(ctx, x, y, R, pal, power, { dust: 10 });
  const p = ctx.P(x, y);
  ctx.juice.ring(p.x, p.y, ctx.rx(R * 1.2), EMBER, 420);
  quakeDecal(ctx, x, y, R);
  debrisRing(ctx, x, y, R * 0.85, 8, power === 3 ? 3 : 2);
  ctx.juice.bits('ice', p.x, p.y - 6, power === 3 ? 10 : 6, ROCK, { angle: -90, spread: 120, speed: 1.2 });
  ctx.dungeon.addDecal('scorch', p.x, p.y + 2, 0x1a0c08, Math.max(0.8, R * 0.55));
  if (!ctx.reduced) {
    const g = ctx.scene.add.graphics().setDepth(-70);
    cracks(ctx, g, x, y, R * 1.1, Math.floor(x * 31 + y * 17), 0x2a1410, 0.9, 9, 3);
    cracks(ctx, g, x, y, R * 0.9, Math.floor(x * 13 + y * 7), EMBER, 0.7, 6, 1.5);
    ctx.scene.tweens.add({ targets: g, alpha: 0, delay: 600, duration: 1000, onComplete: () => g.destroy() });
  }
}

/** Last Frenzy reading per slot (from the b_frenzy hazard), so basic swings burn hotter as Frenzy builds. */
const frenzy = new Map<number, { st: number; max: number; at: number }>();
function frenzyOf(ctx: FxCtx, slot: number): number {
  const f = frenzy.get(slot);
  if (!f || performance.now() - f.at > 300) return 0;
  return f.st / Math.max(1, f.max);
}

const chopSide = new Map<number, number>();

registerSkillFx({
  // ---- basic & signature ----
  // Twin Chop: alternating fore/backhand crescents at the true reach; hotter and bloodier with Frenzy
  b_chop: (ctx, e) => {
    const side = (chopSide.get(e.slot) ?? 1) * -1;
    chopSide.set(e.slot, side);
    const ang = aimAngle(ctx, e.dx, e.dy);
    const u = ctx.U(e.dx, e.dy);
    const c = chest(ctx, e.x, e.y);
    const fr = frenzyOf(ctx, e.slot);
    const wide = ctx.rank(e.slot, 'b_widening_gyre') >= 2;
    const reach = 2 * (1 + 0.1 * ctx.rank(e.slot, 'b_widening_gyre'));
    const k = Math.min(2.4, ctx.rx(reach) / 52) * (e.count ? 1.15 : 1) * (wide ? 1.1 : 1);
    const hot = fr >= 1 ? HOT : fr > 0.5 ? EMBER : RAGE;
    ctx.juice.slash(c.x + u.x * 8, c.y + u.y * 6, ang + side * 0.25, IRON, k, { flip: side < 0 });
    ctx.juice.slash(c.x + u.x * 12, c.y + u.y * 9, ang - side * 0.3, hot, k * 0.9, { thin: true, flip: side > 0, ms: 160 });
    const tip = { x: c.x + u.x * ctx.rx(reach) * 0.8, y: c.y + u.y * ctx.rx(reach) * 0.45 };
    ctx.juice.sparksAt(tip.x, tip.y, 2 + Math.round(fr * 4), hot);
    if (fr > 0.5) ctx.juice.embersAt(c.x, c.y - 4, 1 + Math.round(fr * 2), RAGE);
    skillSfx(ctx, 'b_chop', 'swing', e.x, e.y, 55, ctx.mine ? 2 : 1);   // 3 recorded variations, picked at random
  },
  // Blood God at max Frenzy: Twin Chop sweeps all around
  b_chop_spin: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    const c = chest(ctx, e.x, e.y);
    const R = 2 * (1 + 0.1 * ctx.rank(e.slot, 'b_widening_gyre'));
    const k = Math.min(2.4, ctx.rx(R) / 52);
    const spin = Math.random() * Math.PI * 2;
    for (let i = 0; i < 4; i++) ctx.juice.slash(c.x, c.y, spin + (i / 4) * Math.PI * 2, i % 2 ? IRON : BLOOD, k * 0.8, { flip: i % 2 === 1 });
    ctx.juice.shockwave(p.x, p.y, ctx.rx(R), BLOOD, 260);
    ctx.juice.bleed('pursuer', c.x, c.y, 6);
    ctx.juice.bits('mote', c.x, c.y, 3, RAGE);
    sfx(ctx, 'skill_sweep', e.x, e.y, 55, ctx.mine ? 2 : 1);
  },
  // Avatar of Carnage: the signature roar. Scales with the Fury consumed.
  b_avatar: (ctx, e) => {
    const R = 3;
    const spent = Math.max(35, e.dy || 35);
    const k = 0.75 + Math.min(1, spent / 100) * 0.5;
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const c = chest(ctx, e.x, e.y, 20);
    // anticipation: a red bloom at the chest and a ring of blood glyph
    J.orb(c.x, c.y, BLOOD, 1.2 * k, 320, 2.2);
    J.orb(c.x, c.y, HOT, 0.5 * k, 180, 1.6);
    J.glyph(p.x, p.y, ctx.rx(R) * 0.9, BLOOD, 900);
    // the roar: three staggered waves at the true radius, the slam, cracks and debris
    slam(ctx, e.x, e.y, R, 3, P_BLOOD);
    J.shockwave(p.x, p.y, ctx.rx(R), RAGE, 420, 120);
    J.shockwave(p.x, p.y, ctx.rx(R * 1.25), GORE, 560, 220);
    // a blood column and flames roaring up
    J.beam(p.x, p.y, 220 * k, 34 * k, BLOOD, 520);
    J.beam(p.x, p.y, 240 * k, 12 * k, HOT, 360);
    play(ctx, 'fx:berserker:rage', p.x, p.y + 4, { oy: 1, sx: 2.2 * k, sy: 2.4 * k, depth: 4662, ms: 900, alpha: 0.9 });
    J.embersAt(c.x, c.y, 34, RAGE);
    J.bits('skull', c.x, c.y - 10, 4 + Math.round(k * 3), BLOOD);
    J.bleed('pursuer', c.x, c.y, 26);
    ctx.dungeon.addDecal('blood', p.x, p.y + 4, GORE, 1.6);
    const spr = heroSprite(ctx, e.slot);
    if (spr) { J.afterimage(spr, RAGE, 0.7, 500); J.afterimage(spr, HOT, 0.5, 260); }
    ctx.dungeon.flashLight(p.x, p.y - 30, 320 * k, BLOOD, 3.2, 700);
    J.pop(BLOOD, 0.24, 260);
    if (ctx.mine) {
      J.hitStop(110);
      window.dispatchEvent(new CustomEvent('cursebound:banner', { detail: { text: 'Avatar of Carnage!', tone: 'good' } }));
    }
    skillSfx(ctx, 'b_avatar', 'beast_roar', e.x, e.y, 0, 4);   // the recorded take: roar, flames and slam
    skillLayer(ctx, 'b_avatar', 'signature_slam', e.x, e.y, 0, 4);
  },
  // Avatar swing whirl: a blood gust at its true radius each swing
  b_avatar_whirl: (ctx, e) => {
    const R = e.dx || 2.4;
    const p = ctx.P(e.x, e.y);
    const c = chest(ctx, e.x, e.y, 16);
    ctx.juice.ring(p.x, p.y, ctx.rx(R), BLOOD, 240);
    const a = Math.random() * Math.PI * 2;
    ctx.juice.slash(c.x, c.y, a, RAGE, Math.min(2.4, ctx.rx(R) / 52) * 0.9, { thin: true });
    ctx.juice.slash(c.x, c.y, a + Math.PI, BLOOD, Math.min(2.4, ctx.rx(R) / 52) * 0.9, { thin: true, flip: true });
    ctx.juice.sparksAt(c.x, c.y, 4, RAGE);
    sfx(ctx, 'skill_sweep', e.x, e.y, 120, ctx.mine ? 1 : 0);   // layered under the swing's own whoosh
  },

  // ---- Fury: crimson, drops, heartbeats ----
  b_bloodlust: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const c = chest(ctx, e.x, e.y, 18);
    J.glyph(p.x, p.y, ctx.rx(1.4), BLOOD, 700);
    J.orb(c.x, c.y, BLOOD, 0.9, 300, 2);
    // heartbeat: two pulses
    J.shockwave(p.x, p.y, ctx.rx(1.6), BLOOD, 300);
    J.shockwave(p.x, p.y, ctx.rx(2), GORE, 360, 180);
    J.bits('mote', c.x, c.y, 12, BLOOD);
    J.bleed('pursuer', c.x, c.y - 6, 10);
    // three Frenzy stacks granted: three sparks around the waist
    for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + (i - 1) * 0.9; J.starburst(c.x + Math.cos(a) * 14, c.y + 8 + Math.sin(a) * 6, RAGE, 0.5, 200); }
    const spr = heroSprite(ctx, e.slot);
    if (spr) J.afterimage(spr, BLOOD, 0.6, 420);
    ctx.dungeon.flashLight(c.x, c.y, 170, BLOOD, 2.2, 460);
    skillSfx(ctx, 'b_bloodlust', 'heartbeat', e.x, e.y, 0, 3);
  },
  // Bloodbath: a whirling double cleave at the true radius, Rend drops everywhere, heal motes per enemy hit
  b_bloodbath: (ctx, e) => {
    const R = e.dx || 2.8;
    const hits = Math.max(0, e.dy || 0);
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const c = chest(ctx, e.x, e.y, 14);
    const a = Math.random() * Math.PI * 2;
    cleave(ctx, e.x, e.y, a, R);
    cleave(ctx, e.x, e.y, a + Math.PI, R, { flipY: true });
    for (let i = 0; i < 4; i++) J.slash(c.x, c.y, a + (i / 4) * Math.PI * 2 + 0.4, i % 2 ? IRON : BLOOD, Math.min(2.4, ctx.rx(R) / 52), { flip: i % 2 === 1 });
    impactBurst(ctx, e.x, e.y, R, P_BLOOD, ctx.mine ? 3 : 2, { dust: 4, decal: 'blood', decalTint: GORE });
    J.bleed('pursuer', c.x, c.y, 30);
    for (let i = 0; i < 4; i++) {
      const b = a + (i / 4) * Math.PI * 2;
      const q = ctx.P(e.x + Math.cos(b) * R * 0.7, e.y + Math.sin(b) * R * 0.7);
      J.bleed('pursuer', q.x, q.y - 8, 6);
      if (!ctx.reduced && i % 2 === 0) ctx.dungeon.addDecal('blood', q.x, q.y + 2, GORE, 0.7 + Math.random() * 0.4);
    }
    if (hits > 0) { J.bits('mote', c.x, c.y, 4 + hits * 3, 0xff6a6a); J.orb(c.x, c.y, 0xff5a5a, 0.5 + hits * 0.1, 260); }
    skillSfx(ctx, 'b_bloodbath', 'skill_sweep', e.x, e.y, 0, 3);
    skillLayer(ctx, 'b_bloodbath', 'heartbeat', e.x, e.y, 0, 2);
  },
  // Unchained: chains burst apart in iron shards and the rage flares up
  b_unchained: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const c = chest(ctx, e.x, e.y, 16);
    J.starburst(c.x, c.y, IRON, 1.6, 220);
    J.orb(c.x, c.y, RAGE, 1, 300, 2);
    J.sparksAt(c.x, c.y, 26, IRON);
    J.bits('ice', c.x, c.y, 12, 0x9a9aae, { angle: -90, spread: 200, speed: 1.3 });   // broken chain links
    J.bits('star', c.x, c.y, 6, RAGE);
    J.shockwave(p.x, p.y, ctx.rx(2.2), RAGE, 340);
    J.shockwave(p.x, p.y, ctx.rx(2.6), IRON, 420, 90);
    J.embersAt(c.x, c.y, 20, RAGE);
    play(ctx, 'fx:berserker:rage', p.x, p.y + 4, { oy: 1, sx: 1.6, sy: 1.5, depth: 4662, ms: 700, alpha: 0.8 });
    const spr = heroSprite(ctx, e.slot);
    if (spr) { J.afterimage(spr, RAGE, 0.7, 380); J.afterimage(spr, IRON, 0.4, 220); }
    ctx.dungeon.flashLight(c.x, c.y, 210, RAGE, 2.6, 380);
    if (ctx.mine) J.pop(RAGE, 0.14, 160);
    skillSfx(ctx, 'b_unchained', 'chain_break', e.x, e.y, 0, 3);
    skillLayer(ctx, 'b_unchained', 'beast_roar', e.x, e.y, 0, 2);
  },

  // ---- Carnage: steel, smears, rend ----
  b_whirlwind: (ctx, e) => whirlStart(ctx, e, IRON),
  b_bladestorm: (ctx, e) => whirlStart(ctx, e, RAGE),
  // every 0.25s (0.2s Bladestorm): one cheap blade glint at the true radius
  b_whirl_tick: (ctx, e) => {
    const R = e.dx || 2.2;
    const storm = e.dy === 2;
    const a = Math.random() * Math.PI * 2;
    const q = ctx.P(e.x + Math.cos(a) * R * 0.85, e.y + Math.sin(a) * R * 0.85);
    ctx.juice.slash(q.x, q.y - 12, a + Math.PI / 2, storm ? RAGE : IRON, 0.7, { thin: true, ms: 140 });
    ctx.juice.sparksAt(q.x, q.y - 12, storm ? 4 : 3, storm ? RAGE : IRON);
    if (ctx.rank(e.slot, 'b_flaying_spin') && Math.random() < 0.5) ctx.juice.bleed('pursuer', q.x, q.y - 10, 4);
    // the same spin sound the recorded whirl take covers (played once per cast), so the per-tick swing only plays without it
    skillLayer(ctx, storm ? 'b_bladestorm' : 'b_whirlwind', 'swing', e.x, e.y, 110, ctx.mine ? 2 : 1);
  },
  // Executioner's Cleave lunge: steel afterimages along the 2.5 unit dash
  b_executioner: (ctx, e) => {
    const J = ctx.juice;
    heroGhosts(ctx, e.slot, e.dx, e.dy, RAGE, 5, 9);
    streak(ctx, e.x, e.y, e.x + e.dx * 2.5, e.y + e.dy * 2.5, RAGE, 10, 300);
    streak(ctx, e.x, e.y, e.x + e.dx * 2.5, e.y + e.dy * 2.5, IRON, 3, 200, 22);
    const p = ctx.P(e.x, e.y);
    J.dust(p.x, p.y, 8, DUST);
    const c = chest(ctx, e.x, e.y);
    J.orb(c.x, c.y, RAGE, 0.6, 180);
    skillSfx(ctx, 'b_executioner', 'dodge', e.x, e.y, 0, 2);   // the recorded take: lunge, swoosh and chop
  },
  // the 200 degree, 3.2 unit cleave: the big crescent at the true reach, a ground scar and sparks along the arc
  b_execute_cleave: (ctx, e) => {
    const J = ctx.juice;
    const ang = aimAngle(ctx, e.dx, e.dy);
    const R = 3.2;
    cleave(ctx, e.x, e.y, ang, R, { lift: 10 });
    const c = chest(ctx, e.x, e.y, 10);
    const u = ctx.U(e.dx, e.dy);
    J.slash(c.x + u.x * 10, c.y + u.y * 7, ang, IRON, 2.2);
    J.slash(c.x + u.x * 14, c.y + u.y * 10, ang, HOT, 1.8, { thin: true, flip: true });
    // sparks and dust along the 200 degree edge
    const wa = Math.atan2(e.dy, e.dx);
    for (let i = 0; i <= 6; i++) {
      const b = wa + ((i / 6) - 0.5) * ((200 * Math.PI) / 180);
      const q = ctx.P(e.x + Math.cos(b) * R * 0.92, e.y + Math.sin(b) * R * 0.92);
      J.sparksAt(q.x, q.y - 8, 3, i % 2 ? RAGE : IRON);
      J.dust(q.x, q.y, 1, DUST);
    }
    const p = ctx.P(e.x + e.dx * 1.6, e.y + e.dy * 1.6);
    J.starburst(p.x, p.y - 10, HOT, 1.6, 200);
    J.shockwave(p.x, p.y, ctx.rx(1.4), RAGE, 300);
    J.bits('ice', p.x, p.y - 4, 6, ROCK, { angle: -90, spread: 100 });
    ctx.dungeon.addDecal('scorch', p.x, p.y + 2, 0x1a0c08, 1);
    ctx.dungeon.flashLight(p.x, p.y - 10, 210, RAGE, 2.6, 280);
    if (ctx.mine) J.hitStop(80);
    skillLayer(ctx, 'b_executioner', 'skill_sweep', e.x, e.y, 0, 2);
    skillLayer(ctx, 'b_executioner', 'slam_heavy', e.x, e.y, 0, 3);
  },
  // an execution: a gory burst, a skull and the word
  b_execute: (ctx, e) => {
    const J = ctx.juice;
    const c = chest(ctx, e.x, e.y, 14);
    J.impact(c.x, c.y, BLOOD, 2.8);
    J.starburst(c.x, c.y, HOT, 1.8, 240);
    J.bleed('pursuer', c.x, c.y, 34, e.dx, e.dy);
    J.claw(c.x, c.y, aimAngle(ctx, e.dx, e.dy) + Math.PI / 2, BLOOD, 1.6, 260);
    J.bits('skull', c.x, c.y - 8, 2, 0xffd0c0);
    J.number(c.x, c.y - 18, 'EXECUTED', '#ff5a4a', 'md');
    ctx.dungeon.addDecal('blood', c.x, c.y + 18, GORE, 1.4);
    ctx.dungeon.flashLight(c.x, c.y, 160, BLOOD, 2.4, 260);
    sfx(ctx, 'crit', e.x, e.y, 60, 3);   // the death itself plays the central kill cue
  },

  // ---- Warcry: ember earth, dust, rock; dread for the shout ----
  b_leap: (ctx, e) => leapStart(ctx, e, 90, false),
  b_cataclysm: (ctx, e) => leapStart(ctx, e, 130, true),
  b_leap_land: (ctx, e) => {
    const R = e.dx || 2.4;
    slam(ctx, e.x, e.y, R, ctx.mine ? 3 : 2);
    if (ctx.rank(e.slot, 'b_meteor')) {
      const p = ctx.P(e.x, e.y);
      ctx.juice.embersAt(p.x, p.y - 8, 24, EMBER);
      ctx.juice.beam(p.x, p.y, 120, 22, EMBER, 260);
    }
    skillLayer(ctx, 'b_leap', 'slam_heavy', e.x, e.y, 0, 4);   // the recorded leap take includes the landing
  },
  b_cataclysm_land: (ctx, e) => {
    const R = e.dx || 2.2;
    slam(ctx, e.x, e.y, R, 3);
    const p = ctx.P(e.x, e.y);
    ctx.juice.beam(p.x, p.y, 160, 30, EMBER, 320);
    ctx.juice.embersAt(p.x, p.y - 10, 26, EMBER);
    skillLayer(ctx, 'b_cataclysm', 'slam_heavy', e.x, e.y, 0, 4);   // each quake ring adds its own thud after this
  },
  // each Cataclysm ring (2.2, 3.6, 5): a thick front at the true radius, rock spray on the rim, hotter each ring
  b_quake_ring: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const R = e.dx || 3;
    const i = Math.max(0, Math.min(2, Math.round(e.dy)));
    const col = i === 0 ? RAGE : i === 1 ? EMBER : HOT;
    J.shockwave(p.x, p.y, ctx.rx(R), col, 340);
    J.ring(p.x, p.y, ctx.rx(R * 0.94), 0x3a2010, 380);
    debrisRing(ctx, e.x, e.y, R, 8 + i * 3, 1 + (i === 2 ? 1 : 0));
    if (i === 2) { quakeDecal(ctx, e.x, e.y, R * 0.8, 0xffc0a0); if (ctx.mine) J.pop(EMBER, 0.12, 160); }
    ctx.dungeon.flashLight(p.x, p.y - 8, ctx.rx(R) * 2, col, 1.8 + i * 0.3, 240);
    skillLayer(ctx, 'b_cataclysm', 'slam_heavy', e.x, e.y, 80, 2);   // the recorded take is the whole series of ruptures
  },
  b_aftershock: (ctx, e) => {
    const R = e.dx || 3.2;
    const p = ctx.P(e.x, e.y);
    ctx.juice.shockwave(p.x, p.y, ctx.rx(R), EMBER, 380);
    ctx.juice.ring(p.x, p.y, ctx.rx(R * 0.6), HOT, 260);
    debrisRing(ctx, e.x, e.y, R * 0.8, 8, 2);
    ctx.juice.dust(p.x, p.y, 10, DUST);
    ctx.dungeon.flashLight(p.x, p.y - 8, ctx.rx(R) * 2, EMBER, 1.8, 240);
    sfx(ctx, 'slam_heavy', e.x, e.y, 0, 2);
  },
  // Intimidating Shout: three dread waves at radius 5, skulls rising, the screen tints for the caster
  b_shout: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const c = chest(ctx, e.x, e.y, 22);
    const R = e.dx || 5;
    const n = Math.max(0, e.dy || 0);
    J.orb(c.x, c.y, DREAD, 1.1, 280, 2.2);
    J.starburst(c.x, c.y, 0xf0c8ff, 1.4, 220);
    J.shockwave(p.x, p.y, ctx.rx(R), DREAD, 420);
    J.shockwave(p.x, p.y, ctx.rx(R * 0.8), BLOOD, 420, 110);
    J.shockwave(p.x, p.y, ctx.rx(R), DREAD, 520, 220);
    J.glyph(p.x, p.y, ctx.rx(R) * 0.6, DREAD, 700);
    J.bits('skull', c.x, c.y - 6, 4 + Math.min(8, n), 0xd08af0);
    J.embersAt(c.x, c.y, 14, BLOOD);
    const spr = heroSprite(ctx, e.slot);
    if (spr) J.afterimage(spr, DREAD, 0.6, 420);
    ctx.dungeon.flashLight(c.x, c.y, 280, DREAD, 2.4, 420);
    if (ctx.mine) J.pop(DREAD, 0.14, 220);
    skillSfx(ctx, 'b_shout', 'beast_roar', e.x, e.y, 0, 4);
    skillLayer(ctx, 'b_shout', 'skill_rally', e.x, e.y, 0, 2);   // Battle Cry for allies in range
  },
  // Concussive Force: an enemy smashed into a wall
  b_wall_slam: (ctx, e) => {
    const J = ctx.juice;
    const c = chest(ctx, e.x, e.y, 10);
    J.impact(c.x, c.y, IRON, 1.8);
    J.starburst(c.x, c.y, HOT, 1.2, 180);
    J.sparksAt(c.x, c.y, 10, EMBER);
    J.bits('ice', c.x, c.y, 6, ROCK, { angle: -90, spread: 140 });
    J.bits('star', c.x, c.y - 12, 3, 0xfff0a0);
    J.dust(c.x, c.y + 8, 5, DUST);
    sfx(ctx, 'slam_heavy', e.x, e.y, 90, 1);
  },
  b_flay_burst: (ctx, e) => bloodBurst(ctx, e, false),
  b_harvest: (ctx, e) => bloodBurst(ctx, e, true),
  // Undying Rage: a dark crimson column, skulls and a heavy heartbeat
  b_undying: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const c = chest(ctx, e.x, e.y, 18);
    J.beam(p.x, p.y, 240, 40, GORE, 620);
    J.beam(p.x, p.y, 260, 14, BLOOD, 420);
    J.shockwave(p.x, p.y, ctx.rx(2), BLOOD, 420);
    J.shockwave(p.x, p.y, ctx.rx(2.6), GORE, 520, 140);
    J.bits('skull', c.x, c.y, 6, 0xff8a8a);
    J.embersAt(c.x, c.y, 26, BLOOD);
    play(ctx, 'fx:berserker:rage', p.x, p.y + 4, { oy: 1, sx: 1.8, sy: 1.9, depth: 4662, ms: 900, tint: 0xff8080 });
    ctx.dungeon.flashLight(c.x, c.y, 240, BLOOD, 2.8, 600);
    J.pop(GORE, 0.22, 280);
    if (ctx.mine) { J.hitStop(120); window.dispatchEvent(new CustomEvent('cursebound:banner', { detail: { text: 'Undying!', tone: 'good' } })); }
    sfx(ctx, 'player_revived', e.x, e.y, 0, 4);
    sfx(ctx, 'heartbeat', e.x, e.y, 0, 3);
  },
  // Deathless keystone: 50 Fury burns away instead of the life
  b_deathless: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const c = chest(ctx, e.x, e.y, 16);
    J.starburst(c.x, c.y, 0xffffff, 1.8, 240);
    J.orb(c.x, c.y, RAGE, 1.1, 320, 2);
    J.shockwave(p.x, p.y, ctx.rx(1.8), RAGE, 380);
    J.bits('skull', c.x, c.y, 3, 0xffd0c0);
    J.embersAt(c.x, c.y, 30, RAGE);
    const spr = heroSprite(ctx, e.slot);
    if (spr) J.afterimage(spr, 0xffffff, 0.8, 360);
    J.pop(0x60040a, 0.22, 240);
    if (ctx.mine) J.dilate(0.45, 420);
    sfx(ctx, 'heartbeat', e.x, e.y, 0, 4);
    sfx(ctx, 'cast_fire', e.x, e.y, 0, 2);   // the Fury burning away
  },
});

function whirlStart(ctx: FxCtx, e: CastFx, color: number) {
  const J = ctx.juice;
  const R = e.dx || 2.2;
  const storm = e.dy === 2;
  const p = ctx.P(e.x, e.y);
  const c = chest(ctx, e.x, e.y, 12);
  J.shockwave(p.x, p.y, ctx.rx(R), color, 320);
  const a = Math.random() * Math.PI * 2;
  for (let i = 0; i < 3; i++) J.slash(c.x, c.y, a + (i / 3) * Math.PI * 2, i ? IRON : color, Math.min(2.4, ctx.rx(R) / 52), { thin: true });
  debrisRing(ctx, e.x, e.y, R * 0.9, 6, 1);
  J.sparksAt(c.x, c.y, storm ? 14 : 8, color);
  if (storm) { J.embersAt(c.x, c.y, 14, RAGE); J.orb(c.x, c.y, RAGE, 0.8, 240); if (ctx.mine) J.pop(RAGE, 0.1, 140); }
  skillSfx(ctx, e.skill === 'b_bladestorm' ? 'b_bladestorm' : 'b_whirlwind', 'skill_sweep', e.x, e.y, 0, 3);   // the recorded spin take, once per cast
}

function leapStart(ctx: FxCtx, e: CastFx, height: number, cata: boolean) {
  const J = ctx.juice;
  const meteor = ctx.rank(e.slot, 'b_meteor') > 0;
  const col = cata || meteor ? EMBER : RAGE;
  arcTrail(ctx, e.x, e.y, e.dx, e.dy, col, height, 560);
  // embers strewn along the arc for heavy leaps
  if (!ctx.reduced && (cata || meteor)) {
    const a = chest(ctx, e.x, e.y), b = chest(ctx, e.dx, e.dy);
    for (let i = 1; i < 6; i++) { const t = i / 6; J.embersAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * height, 2, col); }
  }
  const p = ctx.P(e.x, e.y);
  J.dust(p.x, p.y, 12, DUST);
  J.shockwave(p.x, p.y, ctx.rx(1.2), IRON, 260);
  J.bits('ice', p.x, p.y - 4, 4, ROCK, { angle: -90, spread: 90 });
  heroGhosts(ctx, e.slot, e.dx - e.x, e.dy - e.y, col, 3, 10);
  skillSfx(ctx, cata ? 'b_cataclysm' : 'b_leap', 'cine_whoosh', e.x, e.y, 0, 2);
}

function bloodBurst(ctx: FxCtx, e: CastFx, harvest: boolean) {
  const J = ctx.juice;
  const R = e.dx || (harvest ? 2 : 1.6);
  const p = ctx.P(e.x, e.y);
  const c = chest(ctx, e.x, e.y, 10);
  J.shockwave(p.x, p.y, ctx.rx(R), BLOOD, 280);
  J.ring(p.x, p.y, ctx.rx(R * 0.6), HOT, 200);
  J.starburst(c.x, c.y, harvest ? HOT : RAGE, harvest ? 1.3 : 0.9, 180);
  J.bleed('pursuer', c.x, c.y, harvest ? 22 : 14);
  ctx.dungeon.addDecal('blood', p.x, p.y + 2, GORE, R * 0.6);
  if (harvest) { J.bits('skull', c.x, c.y - 6, 1, 0xff9a9a); J.embersAt(c.x, c.y, 8, EMBER); }
  sfx(ctx, 'blast_decay', e.x, e.y, 70, 1);   // a wet burst of blood (the kill itself has its central cue)
}

registerHazardFx({
  // Avatar: the Berserker swells to a giant inside roaring blood flames, over smouldering cracks
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
      const p = ctx.P(x, y);
      const fl = keep(ctx, `baf:${h.i}`, () => {
        const f = ctx.scene.add.sprite(p.x, p.y, 'fx:berserker:rage').setOrigin(0.5, 1).setBlendMode(Phaser.BlendModes.ADD);
        if (ctx.scene.anims.exists('fx:berserker:rage')) f.play('fx:berserker:rage');
        return f;
      });
      fl.setPosition(p.x, p.y + 6).setScale(1.7 * (0.6 + 0.4 * grow), 1.9 * (0.6 + 0.4 * grow)).setDepth(spr.depth - 1).setAlpha(0.55 + 0.15 * Math.sin(ctx.now / 140));
      const ghost = keep(ctx, `bag:${h.i}`, () => ctx.scene.add.image(spr.x, spr.y, spr.texture.key, spr.frame.name).setBlendMode(Phaser.BlendModes.ADD));
      ghost.setTexture(spr.texture.key, spr.frame.name).setOrigin(spr.originX, spr.originY).setFlipX(spr.flipX)
        .setPosition(spr.x, spr.y).setScale(spr.scaleX * 1.25, spr.scaleY * 1.25).setTintFill(BLOOD).setAlpha(0.16 + 0.08 * Math.sin(ctx.now / 110)).setDepth(spr.depth - 0.5);
      if (Math.random() < 0.3) { const c = chest(ctx, x, y, 26); ctx.juice.embersAt(c.x + (Math.random() - 0.5) * 24, c.y, 1, RAGE); }
    }
  },
  // Whirlwind / Bladestorm: the spinning-steel ring sheet at the true radius (Bladestorm adds a counter-spinning red storm)
  b_whirl: (ctx, g, h) => {
    const p = ctx.P(h.x, h.y);
    const storm = h.out === 2;
    groundCircle(ctx, g, h.x, h.y, h.r, storm ? BLOOD : 0x3a3030, 0.12, storm ? RAGE : IRON, 1, 0.5);
    const k = ctx.rx(h.r) / 84;
    const s = keep(ctx, `bw:${h.i}`, () => {
      const o = ctx.scene.add.sprite(p.x, p.y, 'fx:berserker:whirl').setBlendMode(Phaser.BlendModes.ADD);
      if (ctx.scene.anims.exists('fx:berserker:whirl')) o.play('fx:berserker:whirl');
      return o;
    });
    s.setPosition(p.x, p.y - 8).setScale(k, k).setDepth(4598).setAlpha(0.95);
    if (storm && !ctx.reduced) {
      const s2 = keep(ctx, `bw2:${h.i}`, () => {
        const o = ctx.scene.add.sprite(p.x, p.y, 'fx:berserker:whirl').setBlendMode(Phaser.BlendModes.ADD).setFlipX(true).setTint(0xff7a5a);
        if (ctx.scene.anims.exists('fx:berserker:whirl')) o.play({ key: 'fx:berserker:whirl', startFrame: 3 });
        return o;
      });
      s2.setPosition(p.x, p.y - 14).setScale(k * 0.82, k * 0.82).setDepth(4599).setAlpha(0.75);
    }
    if (!ctx.reduced && Math.random() < 0.18) {
      // Maelstrom drags grit inward from the rim; otherwise grit kicks up
      const a = Math.random() * Math.PI * 2;
      const q = ctx.P(h.x + Math.cos(a) * h.r, h.y + Math.sin(a) * h.r);
      ctx.juice.dust(q.x, q.y, 1, DUST);
      if (ctx.rank(h.in, 'b_maelstrom')) ctx.juice.bits('mote', q.x, q.y - 4, 1, IRON, { angle: (Math.atan2(p.y - q.y, p.x - q.x) * 180) / Math.PI, spread: 10, speed: 2 });
    }
  },
  // Frenzy pips: a segmented ring at the feet, lit per stack; at the cap it burns
  b_frenzy: (ctx, g, h) => {
    const max = Math.max(1, Math.round(h.w) || 5);
    const st = Math.max(0, Math.round(h.out));
    frenzy.set(h.in, { st, max, at: performance.now() });
    const full = st >= max;
    for (let i = 0; i < max; i++) {
      const a0 = -Math.PI / 2 + (i / max) * Math.PI * 2, a1 = a0 + (Math.PI * 2 / max) * 0.7;
      const p0 = ctx.P(h.x + Math.cos(a0) * 0.55, h.y + Math.sin(a0) * 0.55), p1 = ctx.P(h.x + Math.cos(a1) * 0.55, h.y + Math.sin(a1) * 0.55);
      const lit = i < st;
      if (lit) g.lineStyle(5, full ? RAGE : BLOOD, 0.25).lineBetween(p0.x, p0.y, p1.x, p1.y);
      g.lineStyle(3, lit ? (full ? HOT : i >= st - 1 ? RAGE : BLOOD) : 0x2a1a1a, lit ? 0.95 : 0.5).lineBetween(p0.x, p0.y, p1.x, p1.y);
    }
    if (full && !ctx.reduced && Math.random() < 0.15) { const p = ctx.P(h.x, h.y); ctx.juice.embersAt(p.x + (Math.random() - 0.5) * 20, p.y - 2, 1, RAGE); }
  },
  // Fear: a blinking dread skull bobbing over the fleeing enemy, with a purple swirl
  b_fear: (ctx, g, h) => {
    const p = ctx.P(h.x, h.y);
    const cy = p.y - 36 - h.r * 20 + Math.sin(ctx.now / 140 + h.i) * 2;
    const s = keep(ctx, `bfs:${h.i}`, () => {
      const o = ctx.scene.add.sprite(p.x, cy, 'fx:berserker:fear');
      if (ctx.scene.anims.exists('fx:berserker:fear')) o.play('fx:berserker:fear');
      return o;
    });
    s.setPosition(Math.round(p.x), Math.round(cy)).setDepth(4611);
    const o = keep(ctx, `bf:${h.i}`, () => ctx.scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD));
    o.clear().setDepth(4610);
    const a = ctx.now / 160;
    for (let i = 0; i < 3; i++) {
      const b = a + (i * Math.PI * 2) / 3;
      o.fillStyle(i === 0 ? DREAD : BLOOD, 0.85).fillRect(Math.round(p.x + Math.cos(b) * 9) - 1, Math.round(cy + 2 + Math.sin(b) * 3) - 1, 2, 2);
    }
  },
  // Cataclysm: the earth keeps splitting outward between rings
  b_quake: (ctx, g, h) => {
    const t = age(ctx, `bq:${h.i}`);
    const R = Math.min(h.r, h.r * (0.45 + t / 900));
    cracks(ctx, g, h.x, h.y, R, h.i, EMBER, 0.75, 10, 2);
    cracks(ctx, g, h.x, h.y, R * 0.8, h.i + 7, 0x2a1410, 0.8, 8, 3);
    groundCircle(ctx, g, h.x, h.y, R, null, 0, EMBER, 1, 0.35);
    if (!ctx.reduced && Math.random() < 0.3) {
      const a = Math.random() * Math.PI * 2;
      const q = ctx.P(h.x + Math.cos(a) * R, h.y + Math.sin(a) * R);
      ctx.juice.dust(q.x, q.y, 1, DUST);
    }
  },
  // pending aftershock: the 3.2 unit ring fills as the ground tenses
  b_aftershock: (ctx, g, h) => {
    const prog = Math.min(1, age(ctx, `bas:${h.i}`) / 500);
    groundCircle(ctx, g, h.x, h.y, h.r, null, 0, EMBER, 2, 0.4 + 0.5 * prog);
    groundCircle(ctx, g, h.x, h.y, h.r * prog, RAGE, 0.12 + 0.08 * prog);
    cracks(ctx, g, h.x, h.y, h.r * prog, h.i + 3, EMBER, 0.5 * prog, 6, 1);
  },
  // Tectonic fissure: a glowing rift that erupts every 0.5s
  b_fissure: (ctx, g, h) => {
    groundCircle(ctx, g, h.x, h.y, h.r, 0x1a0806, 0.35, GORE, 1, 0.6);
    const glow = 0.55 + 0.35 * Math.sin(ctx.now / 140 + h.i);
    cracks(ctx, g, h.x, h.y, h.r, h.i, EMBER, glow, 9, 2.5);
    cracks(ctx, g, h.x, h.y, h.r * 0.7, h.i + 3, RAGE, glow * 0.8, 6, 1.5);
    cracks(ctx, g, h.x, h.y, h.r * 0.4, h.i + 5, HOT, glow * 0.7, 4, 1);
    pulseRing(ctx, g, h.x, h.y, h.r, EMBER, 500, h.i * 29);
    if (!ctx.reduced && Math.random() < 0.2) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * h.r * 0.9;
      const q = ctx.P(h.x + Math.cos(a) * r, h.y + Math.sin(a) * r);
      ctx.juice.embersAt(q.x, q.y - 2, 2, Math.random() < 0.5 ? EMBER : RAGE);
    }
  },
  // leap target: the landing circle fills while the hero is airborne, with crosshair ticks
  b_leap_mark: (ctx, g, h) => {
    const prog = Math.min(1, age(ctx, `bl:${h.i}`) / 450);
    groundCircle(ctx, g, h.x, h.y, h.r, null, 0, RAGE, 2, 0.85);
    groundCircle(ctx, g, h.x, h.y, h.r * prog, BLOOD, 0.22);
    g.lineStyle(2, EMBER, 0.8);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const p0 = ctx.P(h.x + Math.cos(a) * h.r * 1.08, h.y + Math.sin(a) * h.r * 1.08);
      const p1 = ctx.P(h.x + Math.cos(a) * h.r * (1.08 - 0.25 * (1 - prog)), h.y + Math.sin(a) * h.r * (1.08 - 0.25 * (1 - prog)));
      g.lineBetween(p0.x, p0.y, p1.x, p1.y);
    }
  },
  // Undying: a dark crimson pool and flickering flames under the refusing-to-die Berserker
  b_undying: (ctx, g, h) => {
    const flick = 0.2 + 0.15 * Math.sin(ctx.now / 60);
    groundCircle(ctx, g, h.x, h.y, 1.1, GORE, flick, BLOOD, 2, 0.8);
    pulseRing(ctx, g, h.x, h.y, 1.6, BLOOD, 300);
    const spr = heroSprite(ctx, h.in);
    if (spr && !ctx.reduced) {
      const p = ctx.P(h.x, h.y);
      const fl = keep(ctx, `buf:${h.i}`, () => {
        const f = ctx.scene.add.sprite(p.x, p.y, 'fx:berserker:rage').setOrigin(0.5, 1).setBlendMode(Phaser.BlendModes.ADD).setTint(0xff6a6a);
        if (ctx.scene.anims.exists('fx:berserker:rage')) f.play('fx:berserker:rage');
        return f;
      });
      fl.setPosition(p.x, p.y + 4).setScale(1.2, 1.3).setDepth(spr.depth - 1).setAlpha(0.45 + 0.2 * Math.sin(ctx.now / 70));
    }
  },
}, { b_avatar: BLOOD, b_fissure: EMBER, b_undying: GORE, b_quake: EMBER });

registerProjectileFx({
  // Bladestorm's flung axe: a real spinning pixel axe trailing embers
  b_axe: {
    key: 'fx:berserker:axe', color: RAGE, scale: 1.1, additive: false, spin: 1260, trail: 'ember', trailMs: 35,
    end: (ctx, sx, sy) => { ctx.juice.sparksAt(sx, sy, 6, IRON); ctx.juice.slash(sx, sy, Math.random() * Math.PI * 2, RAGE, 0.6, { thin: true, ms: 140 }); },
  },
});

registerKillFx({
  // Berserker kills: a directional blood spray; crits rake claw marks; elites and bosses get a skull and a gory ring
  berserker: (ctx, k) => {
    const J = ctx.juice;
    const c = chest(ctx, k.x, k.y, 12);
    J.bleed(k.kind, c.x, c.y, k.big ? 14 : 6);
    if (k.crit) { J.claw(c.x, c.y, Math.random() * Math.PI, BLOOD, 1.1, 200); J.starburst(c.x, c.y, HOT, 0.8, 150); }
    if (k.elite || k.boss) {
      const p = ctx.P(k.x, k.y);
      J.shockwave(p.x, p.y, ctx.rx(k.boss ? 3 : 1.8), BLOOD, 420);
      J.bits('skull', c.x, c.y - 6, k.boss ? 4 : 2, 0xff9a8a);
      J.embersAt(c.x, c.y, 10, RAGE);
    }
  },
});
