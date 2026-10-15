import * as Phaser from 'phaser';
import { iso } from '../iso';
import { registerHazardFx, registerKillFx, registerProjectileFx, registerSkillFx, type CastFx, type FxCtx, type SnapHazard } from './registry';
import { groundCircle, groundQuad, sfx } from './kit3';
import { castFlash, chestAt, hitSpark, impactBurst, killPop, screenAngle, upgradeScale, type Pal } from './spectacle';

// Hexbinder presentation (cosmetic only): sickly green rot, violet hexes, crimson blood and pale spirit mint.
// Sim conventions (simulation/src/classes/hexbinder.ts): plague cloud / blightbloom / locust swarm / blood tether casts
// carry the target point in dx,dy; h_contagion and h_hemorrhage_t are links x,y -> dx,dy; bursts (h_corpse_bloom,
// h_blightbloom_burst, h_exsanguinate, h_death_knell, h_banshee_shriek) carry the radius in dx. hx_tether hazards hold
// the caster in x,y and the vector to the target in dx,dy,len. Summons (hx_wraith/banshee/legion/lesser), the bloom and
// orbiting souls are drawn as pixel sprites (art/fx/hexbinder.ts) that live while their hazard does.

const SICK = 0x8fd14f;
const SICK_HOT = 0xe0ffb0;
const ROT = 0x4f7a22;
const HEX = 0x9a5ad0;
const HEX_HOT = 0xe8d0ff;
const BLOOD = 0xd0182e;
const BLOOD_HOT = 0xffb0b0;
const BLOOD_DK = 0x5a0812;
const SPIRIT = 0x9af0d0;
const SPIRIT_HOT = 0xe8fff4;
const LILAC = 0xc8a0ff;
const BONE = 0xe8e0c8;
const PLAGUE_BLACK = 0x2a3a10;

const PEST: Pal = { main: SICK, hot: SICK_HOT, deep: 0x2a4a10, bits: 'bubble' };
const HEXP: Pal = { main: HEX, hot: HEX_HOT, deep: 0x3a1a60, bits: 'rune' };
const BLOODP: Pal = { main: BLOOD, hot: BLOOD_HOT, deep: BLOOD_DK, bits: 'mote' };
const SPIRITP: Pal = { main: SPIRIT, hot: SPIRIT_HOT, deep: 0x1a5a4a, bits: 'skull' };
const BANSHEEP: Pal = { main: LILAC, hot: 0xffffff, deep: 0x4a2a80, bits: 'mote' };

const has = (ctx: FxCtx, key: string) => ctx.scene.textures.exists(key);

// ---------------- one-shot sprites ----------------

interface ShotOpts { depth?: number; scale?: number; sx?: number; sy?: number; rot?: number; tint?: number; add?: boolean; alpha?: number; ox?: number; oy?: number; flip?: boolean }

/** Play a one-shot animated sheet at a screen point and destroy it when it ends. */
function shot(ctx: FxCtx, key: string, x: number, y: number, o: ShotOpts = {}) {
  if (!has(ctx, key) || !ctx.scene.anims.exists(key)) return null;
  const s = ctx.scene.add.sprite(Math.round(x), Math.round(y), key).setOrigin(o.ox ?? 0.5, o.oy ?? 0.5).setDepth(o.depth ?? 4648)
    .setScale(o.sx ?? o.scale ?? 1, o.sy ?? o.scale ?? 1).setRotation(o.rot ?? 0).setAlpha(o.alpha ?? 1).setFlipX(!!o.flip)
    .setBlendMode(o.add === false ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD);
  if (o.tint !== undefined) s.setTint(o.tint);
  s.play(key);
  s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
  return s;
}

/** The hex sigil laid flat on the ground: fades in, turns a little and fades (summons, signatures). */
function sigil(ctx: FxCtx, sx: number, sy: number, radiusPx: number, tint: number, ms = 700) {
  if (ctx.reduced || !has(ctx, 'fx:hexbinder:sigil')) { ctx.juice.glyph(sx, sy, radiusPx, tint, ms); return; }
  // keep the pixel sigil crisp (at most ~2.5x); a wide area gets the generic glyph at its true radius around it
  if (radiusPx > 75) { ctx.juice.glyph(sx, sy, radiusPx, tint, ms); radiusPx = 75; }
  const k = (radiusPx * 2) / 60;
  const img = ctx.scene.add.image(Math.round(sx), Math.round(sy), 'fx:hexbinder:sigil').setDepth(-68).setTint(tint)
    .setBlendMode(Phaser.BlendModes.ADD).setScale(k * 0.55, k * 0.55).setAlpha(0);
  ctx.scene.tweens.add({ targets: img, alpha: 1, scaleX: k, scaleY: k, duration: Math.min(180, ms * 0.3), ease: 'Back.easeOut' });
  ctx.scene.tweens.add({ targets: img, alpha: 0, scaleX: k * 1.08, scaleY: k * 1.08, duration: ms * 0.6, delay: ms * 0.4, ease: 'Quad.easeIn', onComplete: () => img.destroy() });
}

/** A thrown flask / seed tweened along a parabola from the caster to a world point (screen space, cosmetic). */
function lob(ctx: FxCtx, key: string, x0: number, y0: number, x1: number, y1: number, ms: number, height: number, onLand: () => void, tint?: number) {
  const a = chestAt(ctx, x0, y0, 18), b = ctx.P(x1, y1);
  if (ctx.reduced || !has(ctx, key)) { ctx.scene.time.delayedCall(ms, onLand); return; }
  const s = ctx.scene.add.sprite(a.x, a.y, key).setDepth(4647);
  if (tint !== undefined) s.setTint(tint);
  if (ctx.scene.anims.exists(key)) s.play(key);
  const st = { t: 0 };
  let lastTrail = 0;
  ctx.scene.tweens.add({
    targets: st, t: 1, duration: ms, ease: 'Linear',
    onUpdate: () => {
      const t = st.t;
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - 6 - a.y) * t - Math.sin(t * Math.PI) * height;
      s.setPosition(Math.round(x), Math.round(y)).setRotation(t * 9);
      if (ctx.scene.time.now - lastTrail > 40) { lastTrail = ctx.scene.time.now; ctx.juice.bits('bubble', x, y, 1, SICK, { speed: 0.4 }); }
    },
    onComplete: () => { s.destroy(); onLand(); },
  });
}

/** A ring that collapses inward from radiusPx to nothing (pull / drain moments). */
function implode(ctx: FxCtx, sx: number, sy: number, radiusPx: number, tint: number, ms = 280) {
  if (ctx.reduced || !has(ctx, 'pfx:ringThick')) return;
  const k = (radiusPx * 2) / 64;
  const img = ctx.scene.add.image(sx, sy, 'pfx:ringThick').setDepth(4639).setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setScale(k, k * 0.5).setAlpha(0.2);
  ctx.scene.tweens.add({ targets: img, scaleX: k * 0.08, scaleY: k * 0.04, alpha: 1, duration: ms, ease: 'Cubic.easeIn', onComplete: () => img.destroy() });
}

/** Writhing tendril (wavy additive line) between two screen points that fades out. */
function tendril(ctx: FxCtx, a: { x: number; y: number }, b: { x: number; y: number }, color: number, core: number, width: number, ms: number) {
  if (ctx.reduced) return;
  const g = ctx.scene.add.graphics().setDepth(4645).setBlendMode(Phaser.BlendModes.ADD);
  const nx = -(b.y - a.y), ny = b.x - a.x, nl = Math.hypot(nx, ny) || 1;
  const ph = Math.random() * 6;
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const w = Math.sin(t * Math.PI) * Math.sin(ph + t * 10) * 6;
    pts.push(new Phaser.Math.Vector2(a.x + (b.x - a.x) * t + (nx / nl) * w, a.y + (b.y - a.y) * t + (ny / nl) * w));
  }
  g.lineStyle(width + 3, BLOOD_DK, 0.6).strokePoints(pts);
  g.lineStyle(width, color, 0.95).strokePoints(pts);
  g.lineStyle(1, core, 1).strokePoints(pts);
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, ease: 'Quad.easeIn', onComplete: () => g.destroy() });
}

// ---------------- persistent hazard sprites ----------------

interface View {
  spr: Phaser.GameObjects.Sprite[];
  extra: Phaser.GameObjects.Image[];
  seen: number;
  born: number;
  x: number; y: number; t: number;
  pulse: number;
  out: number;          // dissolve colour when the hazard ends (0 = vanish)
}
const views = new Map<number, View>();
let sweepScene: Phaser.Scene | null = null;

function killView(scene: Phaser.Scene, v: View) {
  for (const s of v.spr) {
    if (v.out && s.active) {
      scene.tweens.add({ targets: s, alpha: 0, scaleX: s.scaleX * 1.25, scaleY: s.scaleY * 0.5, y: s.y - 10, duration: 260, ease: 'Quad.easeIn', onComplete: () => s.destroy() });
    } else s.destroy();
  }
  for (const e of v.extra) e.destroy();
}

function ensureSweep(scene: Phaser.Scene) {
  if (sweepScene === scene) return;
  sweepScene = scene;
  const sweep = () => {
    const now = scene.time.now;
    for (const [id, v] of views) {
      if (now - v.seen < 150) continue;
      killView(scene, v);
      views.delete(id);
    }
  };
  scene.events.on(Phaser.Scenes.Events.POST_UPDATE, sweep);
  const reset = () => {
    scene.events.off(Phaser.Scenes.Events.POST_UPDATE, sweep);
    for (const v of views.values()) { v.out = 0; killView(scene, v); }
    views.clear(); sweepScene = null;
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, reset);
  scene.events.once(Phaser.Scenes.Events.DESTROY, reset);
}

function viewOf(ctx: FxCtx, h: SnapHazard): View {
  ensureSweep(ctx.scene);
  let v = views.get(h.i);
  if (!v) { v = { spr: [], extra: [], seen: ctx.now, born: ctx.now, x: h.x, y: h.y, t: ctx.now, pulse: -1, out: 0 }; views.set(h.i, v); }
  v.seen = ctx.now;
  return v;
}

/** Exponential smoothing toward the authoritative position (snapshots arrive at 20 Hz). */
function smooth(ctx: FxCtx, v: View, x: number, y: number, k = 40) {
  const dt = Math.min(100, Math.max(0, ctx.now - v.t));
  v.t = ctx.now;
  if (Math.hypot(x - v.x, y - v.y) > 3) { v.x = x; v.y = y; return; }
  const a = 1 - Math.exp(-dt / k);
  v.x += (x - v.x) * a; v.y += (y - v.y) * a;
}

function sprite(ctx: FxCtx, key: string, add: boolean) {
  const s = ctx.scene.add.sprite(0, 0, key).setBlendMode(add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
  if (ctx.scene.anims.exists(key)) s.play({ key, startFrame: Math.floor(Math.random() * 4) });
  return s;
}

function softGlow(ctx: FxCtx, tint: number, scale: number): Phaser.GameObjects.Image | null {
  if (ctx.reduced || !has(ctx, 'light:soft')) return null;
  return ctx.scene.add.image(0, 0, 'light:soft').setBlendMode(Phaser.BlendModes.ADD).setTint(tint).setAlpha(0.25).setScale(scale);
}

/** Index of the periodic pulse a hazard is on; returns true once when it advances (pulse fx without sim events). */
function newPulse(v: View, tick: number, start: number, period: number): boolean {
  if (tick < start) return false;
  const k = Math.floor((tick - start) / period);
  if (k === v.pulse) return false;
  v.pulse = k;
  return true;
}

// ---------------- casts ----------------

function rise(ctx: FxCtx, e: CastFx, pal: Pal, size: number) {
  const J = ctx.juice;
  const p = ctx.P(e.x, e.y);
  sigil(ctx, p.x, p.y, 20 + 12 * size, pal.main, 520 + 220 * size);
  J.beam(p.x, p.y, 70 + 50 * size, 8 + 6 * size, pal.main, 300 + 80 * size);
  J.beam(p.x, p.y, 60 + 40 * size, 3 + 2 * size, pal.hot, 220);
  J.orb(p.x, p.y - 16, pal.main, 0.5 + 0.35 * size, 280);
  J.shockwave(p.x, p.y, 22 + 14 * size, pal.main, 340);
  J.bits('mote', p.x, p.y - 6, 6 + 6 * size, pal.main, { angle: -90, spread: 70, speed: 0.8 });
  if (size >= 1) J.bits('skull', p.x, p.y - 14, 2 + 2 * size, pal.hot, { angle: -90, spread: 120 });
  J.dust(p.x, p.y, 3 + 3 * size, 0x1a2a22);
  ctx.dungeon.flashLight(p.x, p.y - 18, 110 + 50 * size, pal.main, 1.4 + 0.5 * size, 260 + 80 * size);
}

function plagueRadius(ctx: FxCtx, slot: number, base: number) {
  return base * Math.pow(1.12, ctx.rank(slot, 'h_fetid_reach'));
}

registerSkillFx({
  // ---- basic: Hex Bolt (cheap; fires several times a second) ----
  h_hex_bolt: (ctx, e) => {
    const J = ctx.juice;
    const u = ctx.U(e.dx, e.dy);
    const c = chestAt(ctx, e.x, e.y, 16);
    const hx = c.x + u.x * 12, hy = c.y + u.y * 8;
    const k = upgradeScale(ctx, e.slot, ['h_virulence', 'h_lingering_rot', 'h_soul_volley'], 1.8);
    const multi = Number(e.count ?? '1') > 1;
    J.orb(hx, hy, SICK, 0.32 * k * (multi ? 1.3 : 1), 120, 1.6);
    J.bits('rune', hx, hy, multi ? 3 : 1, HEX, { angle: (Math.atan2(u.y, u.x) * 180) / Math.PI, spread: 50, speed: 0.6 });
    J.embersAt(hx, hy, 2, SICK);
    ctx.dungeon.flashLight(hx, hy, 70, SICK, 0.9, 80);
    sfx(ctx, 'attack_spark', e.x, e.y, 60, ctx.mine ? 2 : 1);   // basics stay a short zip (ear fatigue); casts carry the element
  },

  // ---- signature: Grave Tide ----
  h_grave_tide: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const ang = screenAngle(ctx, e.dx, e.dy);
    const deg = (ang * 180) / Math.PI;
    castFlash(ctx, e.x, e.y, PEST, 2.4, { glyph: false, dx: e.dx, dy: e.dy });
    sigil(ctx, p.x, p.y, ctx.rx(1.8), HEX, 900);
    J.shockwave(p.x, p.y, ctx.rx(1.6), SICK, 320);
    // the tide's opening roar: skulls and bile sprayed down the lane
    J.bits('skull', p.x, p.y - 12, 8, BONE, { angle: deg, spread: 46, speed: 1.4 });
    J.bits('bubble', p.x, p.y - 8, 14, SICK, { angle: deg, spread: 60, speed: 1.2 });
    J.bits('rune', p.x, p.y - 16, 6, HEX, { angle: deg, spread: 80 });
    J.dust(p.x, p.y, 10, 0x24301a);
    ctx.dungeon.flashLight(p.x, p.y, 280, SICK, 2.8, 460);
    J.pop(SICK, 0.14, 200);
    if (ctx.mine) J.hitStop(55);
    sfx(ctx, 'blast_decay', e.x, e.y, 80, 3);   // the tide's wet roar
    sfx(ctx, 'cast_decay', e.x, e.y, 80, 1);
  },

  // ---- Pestilence ----
  h_plague_cloud: (ctx, e) => {
    const R = plagueRadius(ctx, e.slot, 2.2);
    const c = chestAt(ctx, e.x, e.y, 16);
    ctx.juice.orb(c.x, c.y, SICK, 0.5, 160);
    ctx.juice.bits('bubble', c.x, c.y, 4, SICK);
    lob(ctx, 'fx:lob', e.x, e.y, e.dx, e.dy, 240, 46, () => {
      const q = ctx.P(e.dx, e.dy);
      const J = ctx.juice;
      J.shockwave(q.x, q.y, ctx.rx(R), SICK, 360);
      J.ring(q.x, q.y, ctx.rx(R * 0.5), SICK_HOT, 220);
      J.starburst(q.x, q.y - 8, SICK_HOT, 1.1);
      J.bits('ice', q.x, q.y - 8, 8, 0xc8f0a0);          // flask glass
      J.bits('bubble', q.x, q.y - 6, 12, SICK, { angle: -90, spread: 140 });
      J.bits('skull', q.x, q.y - 10, 2, SICK_HOT, { angle: -90, spread: 60 });
      J.dust(q.x, q.y, 10, 0x3a5a1a);
      ctx.dungeon.addDecal('slime', q.x, q.y + 2, ROT, R * 0.7);
      ctx.dungeon.flashLight(q.x, q.y - 10, ctx.rx(R) * 2.2, SICK, 2, 300);
      sfx(ctx, 'blast_decay', e.dx, e.dy, 60, ctx.mine ? 2 : 1);   // the flask bursting
    });
    sfx(ctx, 'throw_whoosh', e.x, e.y, 60, ctx.mine ? 1 : 0);
  },
  h_blightbloom: (ctx, e) => {
    const c = chestAt(ctx, e.x, e.y, 16);
    ctx.juice.orb(c.x, c.y, HEX, 0.5, 160);
    lob(ctx, 'fx:hexbinder:seed', e.x, e.y, e.dx, e.dy, 300, 40, () => {
      const q = ctx.P(e.dx, e.dy);
      const J = ctx.juice;
      sigil(ctx, q.x, q.y, 30, SICK, 700);
      J.shockwave(q.x, q.y, 26, HEX, 300);
      J.bits('leaf', q.x, q.y - 6, 8, SICK, { angle: -90, spread: 150 });
      J.bits('thorn', q.x, q.y - 4, 5, HEX);
      J.dust(q.x, q.y, 6, 0x2a3a1a);
      ctx.dungeon.flashLight(q.x, q.y - 12, 150, SICK, 1.8, 300);
      sfx(ctx, 'summon_rise', e.dx, e.dy, 60, ctx.mine ? 2 : 1);   // the bloom sprouting
    });
    sfx(ctx, 'throw_whoosh', e.x, e.y, 60, ctx.mine ? 1 : 0);
  },
  h_blightbloom_burst: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    const R = e.dx || 2.5;
    impactBurst(ctx, e.x, e.y, R, PEST, 3, { decal: 'slime', decalTint: ROT });
    ctx.juice.shockwave(p.x, p.y, ctx.rx(R * 0.8), HEX, 380, 60);
    ctx.juice.bits('leaf', p.x, p.y - 14, 14, HEX, { angle: -90, spread: 200, speed: 1.3 });
    ctx.juice.bits('skull', p.x, p.y - 14, 4, SICK_HOT, { angle: -90, spread: 90 });
    ctx.juice.bleed('artillery', p.x, p.y - 10, 20);
    sfx(ctx, 'blast_decay', e.x, e.y, 80, 2);
  },
  h_locust_swarm: (ctx, e) => {
    const p = chestAt(ctx, e.x, e.y, 14);
    const deg = (screenAngle(ctx, e.dx - e.x, e.dy - e.y) * 180) / Math.PI;
    ctx.juice.dust(p.x, p.y + 12, 8, 0x2a3a1a);
    ctx.juice.bits('mote', p.x, p.y, 16, 0x2a3418, { angle: deg, spread: 40, speed: 1.6 });
    ctx.juice.bits('mote', p.x, p.y, 8, SICK, { angle: deg, spread: 30, speed: 1.3 });
    ctx.juice.orb(p.x, p.y, ROT, 0.6, 180);
    sfx(ctx, 'cast_decay', e.x, e.y, 60, ctx.mine ? 2 : 1);   // its beating detuned drone reads as the swarm
  },
  // rot leaping corpse -> neighbour (also Black Death's spread every second): cheap
  h_contagion: (ctx, e) => {
    const a = chestAt(ctx, e.x, e.y), b = chestAt(ctx, e.dx, e.dy);
    const black = ctx.rank(e.slot, 'h_black_death') > 0;
    ctx.juice.bitsAlong('bubble', a.x, a.y, b.x, b.y, 3, black ? PLAGUE_BLACK : SICK);
    ctx.juice.orb(b.x, b.y, black ? PLAGUE_BLACK : SICK, 0.35, 160);
    if (black) ctx.juice.bits('skull', b.x, b.y - 4, 1, SICK);
  },
  h_corpse_bloom: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    impactBurst(ctx, e.x, e.y, e.dx || 2, PEST, 2, { decal: 'slime', decalTint: ROT, dust: 4 });
    ctx.juice.bleed('artillery', p.x, p.y - 12, 14);
    ctx.juice.bits('skull', p.x, p.y - 16, 2, BONE, { angle: -90, spread: 80, speed: 1.2 });
    sfx(ctx, 'blast_decay', e.x, e.y, 70, 1);
  },
  h_rupture: (ctx, e) => {
    const c = chestAt(ctx, e.x, e.y, 14);
    const p = ctx.P(e.x, e.y);
    const J = ctx.juice;
    J.starburst(c.x, c.y, HEX_HOT, 1.8, 200);
    J.orb(c.x, c.y, HEX, 0.9, 240);
    J.orb(c.x, c.y, SICK, 0.6, 180);
    J.shockwave(p.x, p.y, ctx.rx(1.3), HEX, 280);
    J.bits('rune', c.x, c.y, 8, HEX);
    J.bits('bubble', c.x, c.y, 8, SICK);
    J.bleed('artillery', c.x, c.y, 14);
    ctx.dungeon.addDecal('ichor', p.x, p.y + 4, 0x3a1a50, 0.9);
    ctx.dungeon.flashLight(c.x, c.y, 140, HEX, 2, 200);
    sfx(ctx, 'blast_decay', e.x, e.y, 60, 2);
  },

  // ---- Sanguine ----
  h_blood_tether: (ctx, e) => {
    castFlash(ctx, e.x, e.y, BLOODP, 1.2, { dx: e.dx - e.x, dy: e.dy - e.y });
    ctx.bolt(e.x, e.y, e.dx, e.dy, BLOOD);
    const q = chestAt(ctx, e.dx, e.dy);
    ctx.juice.starburst(q.x, q.y, BLOOD_HOT, 1, 160);
    ctx.juice.bleed('player', q.x, q.y, 10);
    sfx(ctx, 'cast_decay', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  h_hemorrhage: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    sigil(ctx, p.x, p.y, ctx.rx(4) * 0.9, BLOOD, 650);
    implode(ctx, p.x, p.y, ctx.rx(4), BLOOD, 300);
    J.shockwave(p.x, p.y, ctx.rx(1.2), BLOOD_HOT, 260);
    J.orb(p.x, p.y - 16, BLOOD, 1.1, 300);
    J.bleed('player', p.x, p.y - 14, 18);
    J.bits('mote', p.x, p.y - 14, 12, BLOOD, { angle: -90, spread: 160 });
    ctx.dungeon.addDecal('blood', p.x, p.y + 4, 0x6a0a10, 1.4);
    ctx.dungeon.flashLight(p.x, p.y - 10, 220, BLOOD, 2.4, 320);
    J.pop(BLOOD, 0.1, 160);
    if (ctx.mine) J.hitStop(45);
    sfx(ctx, 'cast_decay', e.x, e.y, 60, ctx.mine ? 2 : 1);
    sfx(ctx, 'blast_decay', e.x, e.y, 80, 1);   // the tendrils ripping in
  },
  // one tendril per victim (target x,y -> caster dx,dy)
  h_hemorrhage_t: (ctx, e) => {
    const a = chestAt(ctx, e.dx, e.dy, 16), b = chestAt(ctx, e.x, e.y);
    tendril(ctx, a, b, BLOOD, BLOOD_HOT, 2.5, 320);
    shot(ctx, 'fx:hexbinder:fang', b.x, b.y, { rot: Math.atan2(b.y - a.y, b.x - a.x), depth: 4652 });
    ctx.juice.starburst(b.x, b.y, BLOOD_HOT, 0.8, 140);
    ctx.juice.bleed('player', b.x, b.y, 10, a.x - b.x, a.y - b.y);
  },
  h_sanguine_lance: (ctx, e) => {
    const J = ctx.juice;
    const c = chestAt(ctx, e.x, e.y, 16);
    const u = ctx.U(e.dx, e.dy);
    const ang = Math.atan2(u.y, u.x);
    castFlash(ctx, e.x, e.y, BLOODP, 1.5, { dx: e.dx, dy: e.dy });
    J.slash(c.x + u.x * 14, c.y + u.y * 9, ang, BLOOD, 1.1, { thin: true });
    J.bleed('player', c.x + u.x * 10, c.y + u.y * 6, 10, u.x, u.y);
    J.bits('mote', c.x, c.y, 6, BLOOD, { angle: (ang * 180) / Math.PI, spread: 30, speed: 1.6 });
    if (ctx.rank(e.slot, 'h_crimson_covenant') > 0) J.sparksAt(c.x, c.y, 6, 0xffd070);
    sfx(ctx, 'cast_decay', e.x, e.y, 60, ctx.mine ? 2 : 1);
    sfx(ctx, 'throw_whoosh', e.x, e.y, 60, 1);   // the lance hurled
  },
  h_exsanguinate: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    impactBurst(ctx, e.x, e.y, e.dx || 2, BLOODP, 2, { decal: 'blood', decalTint: 0x7a0a10 });
    ctx.juice.bleed('player', p.x, p.y - 12, 22);
    ctx.juice.bits('mote', p.x, p.y - 12, 10, BLOOD_HOT, { angle: -90, spread: 120, speed: 1.2 });
    sfx(ctx, 'blast_decay', e.x, e.y, 60, 1);
  },
  h_blood_price: (ctx, e) => {
    const c = chestAt(ctx, e.x, e.y);
    const p = ctx.P(e.x, e.y);
    ctx.juice.orb(c.x, c.y, BLOOD, 0.6, 200);
    ctx.juice.bleed('player', c.x, c.y, 10);
    implode(ctx, p.x, p.y, 34, BLOOD, 220);
  },
  h_blood_sacrament: (ctx, e) => {
    const J = ctx.juice;
    const c = chestAt(ctx, e.x, e.y);
    const p = ctx.P(e.x, e.y);
    const n = Number(e.count ?? '1') || 1;
    J.bleed('player', c.x, c.y, 8 + n * 3);
    J.orb(c.x, c.y, BLOOD, 0.5 + n * 0.12, 240);
    J.shockwave(p.x, p.y, 18 + n * 6, BLOOD, 300);
    J.bits('mote', c.x, c.y, 3 + n * 2, BLOOD_HOT, { angle: -90, spread: 90 });
    ctx.dungeon.flashLight(c.x, c.y, 90 + n * 22, BLOOD, 1.2 + n * 0.25, 220);
    if (n >= 5) { J.beam(p.x, p.y, 120, 14, BLOOD, 320); J.pop(BLOOD, 0.1, 160); }
    if (ctx.mine) J.number(c.x, c.y - 10, `BLOODLUST ${n}`, '#ff5a6a', 'sm');
  },

  // ---- Wraithcall ----
  h_summon_wraith: (ctx, e) => { rise(ctx, e, SPIRITP, 1.2); sfx(ctx, 'summon_rise', e.x, e.y, 60, ctx.mine ? 2 : 1); },
  h_banshee: (ctx, e) => {
    rise(ctx, e, BANSHEEP, 1.8);
    const p = ctx.P(e.x, e.y);
    ctx.juice.shockwave(p.x, p.y, ctx.rx(3), LILAC, 420, 80);
    ctx.juice.pop(LILAC, 0.08, 160);
    sfx(ctx, 'summon_rise', e.x, e.y, 60, ctx.mine ? 2 : 1);
    sfx(ctx, 'beast_howl', e.x, e.y, 200, 1);   // her wail
  },
  h_grave_legion: (ctx, e) => { rise(ctx, e, { main: BONE, hot: SICK_HOT, deep: 0x3a3020, bits: 'skull' }, 0.9); sfx(ctx, 'summon_rise', e.x, e.y, 120, ctx.mine ? 2 : 1); },
  // Legion of the Damned raises one per kill: keep it light
  h_lesser_wraith: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, 20, SPIRIT, 260);
    ctx.juice.bits('mote', p.x, p.y - 8, 5, SPIRIT, { angle: -90, spread: 60, speed: 0.8 });
    ctx.juice.orb(p.x, p.y - 14, SPIRIT, 0.4, 200);
    sfx(ctx, 'summon_rise', e.x, e.y, 400, 0);
  },
  h_banshee_shriek: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const R = e.dx || 3;
    J.shockwave(p.x, p.y, ctx.rx(R), LILAC, 360);
    J.shockwave(p.x, p.y, ctx.rx(R * 0.92), 0xffffff, 380, 90);
    J.shockwave(p.x, p.y, ctx.rx(R * 0.84), HEX, 400, 180);
    J.orb(p.x, p.y - 30, LILAC, 1, 240);
    J.bits('mote', p.x, p.y - 26, 12, LILAC, { speed: 1.5 });
    J.bits('skull', p.x, p.y - 26, 2, 0xffffff);
    ctx.dungeon.flashLight(p.x, p.y - 26, 200, 0xb07aff, 2.2, 280);
    // the banshee herself rears back
    for (const v of views.values()) {
      const s = v.spr[0];
      if (!s || s.texture.key !== 'fx:hexbinder:banshee' || Math.hypot(v.x - e.x, v.y - e.y) > 1.5) continue;
      const k = s.scaleX;
      ctx.scene.tweens.add({ targets: s, scaleX: k * 1.25, scaleY: k * 1.25, duration: 90, yoyo: true, ease: 'Quad.easeOut', onComplete: () => s.setScale(k) });
    }
    sfx(ctx, 'beast_howl', e.x, e.y, 200, 1);   // the shriek
  },
  h_death_knell: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    const R = e.dx || 2.2;
    impactBurst(ctx, e.x, e.y, R, SPIRITP, 2, { dust: 4 });
    ctx.juice.shockwave(p.x, p.y, ctx.rx(R * 0.9), HEX, 420, 110);
    shot(ctx, 'fx:hexbinder:bell', p.x, p.y - 40, { add: false, depth: 4662, scale: 1.2 });
    ctx.juice.beam(p.x, p.y, 110, 10, SPIRIT, 320);
    ctx.juice.bits('skull', p.x, p.y - 16, 5, SPIRIT_HOT, { angle: -90, spread: 140, speed: 1.2 });
    sfx(ctx, 'blast_decay', e.x, e.y, 160, 2);
    sfx(ctx, 'bell_toll', e.x, e.y, 1500, 1);   // the long toll at most every 1.5s (lesser wraiths fade often)
  },
});

// ---------------- projectiles ----------------

registerProjectileFx({
  hx_bolt: {
    key: 'fx:hexbinder:bolt', color: SICK, trail: 'bubble', trailMs: 70,
    end: (ctx, sx, sy) => { ctx.juice.orb(sx, sy, SICK, 0.35, 140); ctx.juice.bits('rune', sx, sy, 1, HEX); },
  },
  hx_spirit: {
    key: 'fx:hexbinder:spirit', color: SPIRIT, trail: 'mote', trailMs: 40,
    end: (ctx, sx, sy) => { ctx.juice.orb(sx, sy, SPIRIT, 0.5, 180); ctx.juice.bits('skull', sx, sy, 1, SPIRIT_HOT); ctx.juice.starburst(sx, sy, SPIRIT_HOT, 0.6); },
  },
  hx_seed: {
    key: 'fx:hexbinder:seed', color: 0xb0e060, trail: 'leaf', trailMs: 90,
    end: (ctx, sx, sy) => { ctx.juice.bits('bubble', sx, sy, 2, SICK); },
  },
  hx_lance: {
    key: 'fx:hexbinder:lance', color: BLOOD, additive: false, trail: 'mote', trailMs: 30,
    end: (ctx, sx, sy) => { ctx.juice.starburst(sx, sy, BLOOD_HOT, 1, 160); ctx.juice.bleed('player', sx, sy, 10); ctx.juice.orb(sx, sy, BLOOD, 0.6, 180); },
  },
});


// ---------------- hazards ----------------

const WRAITH_LOOK: Record<string, { key: string; scale: number; alpha: number; glow: number; out: number }> = {
  hx_wraith: { key: 'fx:hexbinder:wraith', scale: 1, alpha: 0.9, glow: SPIRIT, out: SPIRIT },
  hx_banshee: { key: 'fx:hexbinder:banshee', scale: 1.1, alpha: 0.92, glow: LILAC, out: LILAC },
  hx_legion: { key: 'fx:hexbinder:legion', scale: 0.95, alpha: 1, glow: SICK, out: BONE },
  hx_lesser: { key: 'fx:hexbinder:wraith', scale: 0.72, alpha: 0.55, glow: SPIRIT, out: SPIRIT },
};

function wraithFx(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const look = WRAITH_LOOK[h.k]!;
  const v = viewOf(ctx, h);
  v.out = look.out;
  if (!v.spr.length) {
    const s = sprite(ctx, look.key, false).setOrigin(0.5, 1);
    v.spr.push(s);
    const gl = softGlow(ctx, look.glow, 0.3 * look.scale);
    if (gl) v.extra.push(gl);
    if (tick - h.b < 12) {   // rise out of the sigil
      s.setScale(look.scale * 1.3, look.scale * 0.1).setAlpha(0);
      ctx.scene.tweens.add({ targets: s, scaleX: look.scale, scaleY: look.scale, alpha: 1, duration: 280, ease: 'Back.easeOut' });
    } else s.setScale(look.scale);
  }
  smooth(ctx, v, h.x, h.y, 45);
  const s = v.spr[0]!;
  const p = ctx.P(v.x, v.y);
  const u = ctx.U(h.dx, h.dy);
  const left = h.u - tick;
  const fade = Math.max(0.15, Math.min(1, left / 24));
  const bob = Math.sin(ctx.now / 240 + h.i * 1.7) * 2.5;
  const lift = h.k === 'hx_banshee' ? 10 : 6;
  s.setPosition(Math.round(p.x), Math.round(p.y - lift + bob)).setDepth(iso.depth(v.x, v.y) + 3).setFlipX(u.x < -0.1);
  if (!ctx.scene.tweens.isTweening(s)) s.setAlpha(look.alpha * fade);
  const gl = v.extra[0];
  if (gl) gl.setPosition(p.x, p.y - lift - 14 + bob).setDepth(iso.depth(v.x, v.y) + 2).setAlpha((0.2 + 0.06 * Math.sin(ctx.now / 180)) * fade);
  // shadow + a faint spectral pool under it
  g.fillStyle(0x000000, 0.28 * fade).fillEllipse(p.x, p.y, 18 * look.scale, 7 * look.scale, 16);
  g.fillStyle(look.glow, 0.1 * fade).fillEllipse(p.x, p.y, 26 * look.scale, 10 * look.scale, 16);
  if (h.k === 'hx_banshee') {
    // her wail radius breathes on the ground between shrieks
    const ph = ((tick - h.b) % 90) / 90;
    groundCircle(ctx, g, v.x, v.y, 3, LILAC, 0.04 * fade, LILAC, 1, 0.35 * fade);
    groundCircle(ctx, g, v.x, v.y, 3 * ph, null, 0, 0xffffff, 1.5, 0.45 * (1 - ph) * fade);
  }
  if (!ctx.reduced && Math.random() < 0.1) ctx.juice.bits('mote', p.x + (Math.random() - 0.5) * 10, p.y - 10, 1, look.glow, { angle: 90, spread: 40, speed: 0.3 });
}

function tideFx(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const v = viewOf(ctx, h);
  v.out = SICK;
  smooth(ctx, v, h.x, h.y, 26);
  const x = v.x, y = v.y;
  const left = h.u - tick;
  const a = Math.min(1, left / 8, (tick - h.b + 2) / 4);
  // body of the wave and its rotten wake
  g.fillStyle(ROT, 0.22 * a).fillPoints(groundQuad(x - h.dx * 2.6, y - h.dy * 2.6, h.dx, h.dy, 2, h.w * 0.85), true);
  g.fillStyle(SICK, 0.3 * a).fillPoints(groundQuad(x - h.dx * 0.7, y - h.dy * 0.7, h.dx, h.dy, 1.4, h.w), true);
  g.fillStyle(HEX, 0.16 * a).fillPoints(groundQuad(x - h.dx * 0.2, y - h.dy * 0.2, h.dx, h.dy, 0.6, h.w), true);
  g.lineStyle(3, SICK_HOT, 0.95 * a).strokePoints(groundQuad(x + h.dx * 0.6, y + h.dy * 0.6, h.dx, h.dy, 0.05, h.w), true);
  // crest sprites riding the front
  const n = Math.max(3, Math.min(7, Math.round(h.w * 1.7)));
  if (!v.spr.length && has(ctx, 'fx:hexbinder:crest')) for (let i = 0; i < n; i++) v.spr.push(sprite(ctx, 'fx:hexbinder:crest', false).setOrigin(0.5, 0.85));
  const u = ctx.U(h.dx, h.dy);
  const fx = x + h.dx * 0.4, fy = y + h.dy * 0.4;
  for (let i = 0; i < v.spr.length; i++) {
    const s = v.spr[i]!;
    const off = (i / (v.spr.length - 1) - 0.5) * h.w * 0.92;
    const wx = fx - h.dy * off, wy = fy + h.dx * off;
    const q = ctx.P(wx, wy);
    const bob = Math.sin(ctx.now / 90 + i * 1.3) * 2;
    s.setPosition(Math.round(q.x), Math.round(q.y + bob)).setDepth(iso.depth(wx, wy) + 1).setFlipX(u.x < 0).setAlpha(a)
      .setScale(1.1 + 0.15 * Math.sin(ctx.now / 120 + i));
  }
  if (!ctx.reduced) {
    if (Math.random() < 0.55) {
      const side = (Math.random() - 0.5) * h.w;
      const q = ctx.P(fx - h.dy * side, fy + h.dx * side);
      ctx.juice.bits(Math.random() < 0.2 ? 'skull' : 'bubble', q.x, q.y - 10, 1, Math.random() < 0.3 ? BONE : SICK, { angle: -90, spread: 50 });
      ctx.juice.dust(q.x, q.y, 1, 0x3a5a1a);
    }
    if (Math.random() < 0.06) {
      const side = (Math.random() - 0.5) * h.w * 0.8;
      const q = ctx.P(x - h.dx * 1.2 - h.dy * side, y - h.dy * 1.2 + h.dx * side);
      ctx.dungeon.addDecal('slime', q.x, q.y, ROT, 0.7 + Math.random() * 0.5);
    }
  }
}

function plagueFx(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const land = h.b + 15;
  if (tick < land) {
    // the flask is still in the air: telegraph the landing ring
    const f = (tick - h.b) / 15;
    groundCircle(ctx, g, h.x, h.y, h.r, SICK, 0.05 + 0.08 * f, SICK, 1, 0.55);
    return;
  }
  const v = viewOf(ctx, h);
  v.out = SICK;
  const left = h.u - tick;
  const a = Math.min(1, left / 20, (tick - land + 1) / 8);
  const breathe = 0.5 + 0.5 * Math.sin(tick * 0.08);
  groundCircle(ctx, g, h.x, h.y, h.r, SICK, 0.16 * a, ROT, 2, 0.85 * a);
  groundCircle(ctx, g, h.x, h.y, h.r * (0.6 + 0.12 * breathe), ROT, 0.18 * a);
  groundCircle(ctx, g, h.x, h.y, h.r * 0.98, null, 0, SICK_HOT, 1, 0.4 * a);
  // pulse every 0.5s, in step with the damage ticks
  const ph = ((tick - land) % 30) / 30;
  groundCircle(ctx, g, h.x, h.y, h.r * ph, null, 0, SICK_HOT, 2, 0.75 * (1 - ph) * a);
  if (newPulse(v, tick, land, 30) && !ctx.reduced) {
    const p = ctx.P(h.x, h.y);
    ctx.juice.bits('bubble', p.x, p.y - 6, 3, SICK, { angle: -90, spread: 120, speed: 0.7 });
  }
  // drifting miasma puffs
  if (!v.spr.length && !ctx.reduced && has(ctx, 'fx:hexbinder:miasma')) {
    const n = Math.max(3, Math.min(7, Math.round(h.r * 2.4)));
    for (let i = 0; i < n; i++) v.spr.push(sprite(ctx, 'fx:hexbinder:miasma', false).setOrigin(0.5, 0.8));
  }
  for (let i = 0; i < v.spr.length; i++) {
    const s = v.spr[i]!;
    const ang = (i / v.spr.length) * Math.PI * 2 + ctx.now / (2600 + i * 300) * (i % 2 ? 1 : -1);
    const rr = h.r * (0.3 + 0.45 * ((i * 37) % 10) / 10);
    const wx = h.x + Math.cos(ang) * rr, wy = h.y + Math.sin(ang) * rr;
    const q = ctx.P(wx, wy);
    s.setPosition(Math.round(q.x), Math.round(q.y - 2 + Math.sin(ctx.now / 400 + i) * 2)).setDepth(iso.depth(wx, wy) - 2)
      .setAlpha(0.6 * a).setScale((0.9 + 0.25 * Math.sin(ctx.now / 500 + i * 2)) * (0.8 + h.r * 0.12));
  }
  if (!ctx.reduced && Math.random() < 0.12) {
    const ang = Math.random() * Math.PI * 2, rr = Math.random() * h.r;
    const q = ctx.P(h.x + Math.cos(ang) * rr, h.y + Math.sin(ang) * rr);
    ctx.juice.bits(Math.random() < 0.15 ? 'skull' : 'bubble', q.x, q.y - 4, 1, SICK, { angle: -90, spread: 30, speed: 0.4 });
  }
}

function bloomFx(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const v = viewOf(ctx, h);
  v.out = HEX;
  const p = ctx.P(h.x, h.y);
  const left = h.u - tick;
  const wither = left < 45 ? 1 - left / 45 : 0;
  if (!v.spr.length && has(ctx, 'fx:hexbinder:bloom')) {
    const s = sprite(ctx, 'fx:hexbinder:bloom', false).setOrigin(0.5, 0.95).setScale(0.1);
    ctx.scene.tweens.add({ targets: s, scale: 1, duration: 320, ease: 'Back.easeOut' });
    v.spr.push(s);
    const gl = softGlow(ctx, SICK, 0.35);
    if (gl) v.extra.push(gl);
  }
  const s = v.spr[0];
  if (s) {
    s.setPosition(Math.round(p.x), Math.round(p.y)).setDepth(iso.depth(h.x, h.y) + 1);
    if (wither > 0) {
      // swelling and flashing before it bursts
      const blink = Math.floor(ctx.now / (120 - wither * 70)) % 2 === 0;
      if (!ctx.scene.tweens.isTweening(s)) s.setScale(1 + wither * 0.35);
      if (blink) s.setTintFill(0xf0ffd0); else s.clearTint();
    }
  }
  const gl = v.extra[0];
  if (gl) gl.setPosition(p.x, p.y - 14).setDepth(iso.depth(h.x, h.y)).setAlpha(0.22 + 0.08 * Math.sin(ctx.now / 160) + wither * 0.3);
  // burst footprint (true radius) and a glowing root patch
  groundCircle(ctx, g, h.x, h.y, h.r, SICK, 0.04 + wither * 0.14, SICK, 1, 0.35 + wither * 0.5);
  if (wither > 0) groundCircle(ctx, g, h.x, h.y, h.r * wither, null, 0, 0xffffff, 2, 0.7);
  g.fillStyle(HEX, 0.22).fillEllipse(p.x, p.y, 22, 9, 16);
  g.fillStyle(SICK, 0.3 + 0.15 * Math.sin(ctx.now / 140)).fillEllipse(p.x, p.y, 12, 5, 12);
  // seed volley every 0.75s: a spit puff from the bulb
  if (newPulse(v, tick, h.b + 20, 45) && !ctx.reduced) {
    ctx.juice.orb(p.x, p.y - 22, SICK, 0.45, 160);
    ctx.juice.bits('bubble', p.x, p.y - 22, 3, SICK, { angle: -90, spread: 100 });
  }
}

function swarmFx(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const v = viewOf(ctx, h);
  smooth(ctx, v, h.x, h.y, 50);
  const p = ctx.P(v.x, v.y);
  const left = h.u - tick;
  const a = Math.min(1, left / 15);
  groundCircle(ctx, g, v.x, v.y, h.r, PLAGUE_BLACK, 0.18 * a, ROT, 1, 0.5 * a);
  const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
  const n = ctx.reduced ? 16 : 30;
  for (let i = 0; i < n; i++) {
    const ang = i * 2.39996 + ctx.now * 0.001 * (2.2 + (i % 5) * 0.5) * (i % 2 ? 1 : -1);
    const rr = 0.25 + (((i * 37) % 10) / 10) * 0.75;
    const x = Math.round(p.x + Math.cos(ang) * rx * rr);
    const y = Math.round(p.y - 12 + Math.sin(ang * 1.3) * ry * rr - Math.abs(Math.sin(ang * 2)) * 10);
    g.fillStyle(i % 4 ? 0x1a2410 : SICK, a).fillRect(x, y, 2, 2);
    // wing flicker
    if ((i + Math.floor(ctx.now / 50)) % 2) g.fillStyle(0xd8f0b0, 0.7 * a).fillRect(x - 1, y - 1, 1, 1);
  }
  if (newPulse(v, tick, h.b + 5, 15) && !ctx.reduced && Math.random() < 0.6) {
    const ang = Math.random() * Math.PI * 2;
    ctx.juice.sparksAt(p.x + Math.cos(ang) * rx * 0.5, p.y - 10 + Math.sin(ang) * ry * 0.5, 2, SICK);
  }
}

// reused per frame for the tether curve (no per-frame allocation)
const TETHER_PTS = Array.from({ length: 13 }, () => ({ x: 0, y: 0 }));

function tetherFx(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const v = viewOf(ctx, h);
  const a = chestAt(ctx, h.x, h.y, 16), b = chestAt(ctx, h.x + h.dx * h.len, h.y + h.dy * h.len, 18);
  const nx = -(b.y - a.y), ny = b.x - a.x, nl = Math.hypot(nx, ny) || 1;
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const w = Math.sin(t * Math.PI) * Math.sin(ctx.now / 45 + t * 9) * 5;
    const q = TETHER_PTS[i]!;
    q.x = a.x + (b.x - a.x) * t + (nx / nl) * w; q.y = a.y + (b.y - a.y) * t + (ny / nl) * w;
  }
  g.lineStyle(7, BLOOD_DK, 0.5).strokePoints(TETHER_PTS);
  g.lineStyle(3, BLOOD, 1).strokePoints(TETHER_PTS);
  g.lineStyle(1, BLOOD_HOT, 0.9).strokePoints(TETHER_PTS);
  // life flowing back along the tether
  for (let k = 0; k < 4; k++) {
    const t = 1 - (((ctx.now / 420) + k / 4) % 1);
    const i = Math.min(11, Math.floor(t * 12)), f = t * 12 - i;
    const q0 = TETHER_PTS[i]!, q1 = TETHER_PTS[i + 1]!;
    g.fillStyle(0xffd0d0, 1).fillRect(Math.round(q0.x + (q1.x - q0.x) * f) - 1, Math.round(q0.y + (q1.y - q0.y) * f) - 1, 3, 3);
  }
  const beat = 3 + Math.sin(ctx.now / 70) * 1.2;
  g.fillStyle(BLOOD, 0.5).fillCircle(b.x, b.y, beat + 3);
  g.fillStyle(BLOOD_HOT, 1).fillCircle(b.x, b.y, beat);
  g.fillStyle(BLOOD, 0.6).fillCircle(a.x, a.y, 3);
  // a gout of blood on every drain tick (0.25s)
  if (newPulse(v, tick, h.b + 1, 15) && !ctx.reduced) {
    ctx.juice.bleed('player', b.x, b.y, 3, a.x - b.x, a.y - b.y);
    ctx.juice.bits('mote', b.x, b.y, 1, BLOOD_HOT, { angle: (Math.atan2(a.y - b.y, a.x - b.x) * 180) / Math.PI, spread: 20, speed: 1.2 });
  }
}

function soulFx(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const v = viewOf(ctx, h);
  v.out = SPIRIT;
  smooth(ctx, v, h.x, h.y, 30);
  if (!v.spr.length && has(ctx, 'fx:hexbinder:soul')) {
    const s = sprite(ctx, 'fx:hexbinder:soul', true);
    v.spr.push(s);
    if (tick - h.b < 6) { s.setScale(0.2); ctx.scene.tweens.add({ targets: s, scale: 1, duration: 200, ease: 'Back.easeOut' }); }
  }
  const p = ctx.P(v.x, v.y);
  const y = p.y - 20 + Math.sin(ctx.now / 200 + h.i) * 3;
  const s = v.spr[0];
  const fade = Math.min(1, (h.u - tick) / 30);
  if (s) s.setPosition(Math.round(p.x), Math.round(y)).setDepth(iso.depth(v.x, v.y) + 4).setAlpha(0.95 * fade);
  else { g.fillStyle(SPIRIT, 0.9).fillCircle(p.x, y, 3); }
  g.fillStyle(SPIRIT, 0.12 * fade).fillEllipse(p.x, p.y, 10, 4, 10);
}

function corpseFx(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const f = Math.min(1, (tick - h.b) / 15);
  const blink = Math.floor(ctx.now / 60) % 2 === 0;
  groundCircle(ctx, g, h.x, h.y, h.r * f, SICK, 0.1 + 0.22 * f, blink ? 0xffffff : SICK, 2);
  groundCircle(ctx, g, h.x, h.y, h.r, null, 0, ROT, 1, 0.5);
}

registerHazardFx({
  hx_tide: tideFx,
  hx_plague: plagueFx,
  hx_bloom: bloomFx,
  hx_swarm: swarmFx,
  hx_corpse: corpseFx,
  hx_tether: tetherFx,
  hx_wraith: wraithFx, hx_banshee: wraithFx, hx_legion: wraithFx, hx_lesser: wraithFx,
  hx_soul: soulFx,
}, { hx_tide: SICK, hx_plague: SICK, hx_bloom: 0xb0e060, hx_swarm: ROT, hx_wraith: SPIRIT, hx_banshee: 0xb07aff, hx_legion: BONE, hx_corpse: SICK, hx_tether: BLOOD });

// ---------------- on-kill flourish: a soul tears loose and rises ----------------

registerKillFx({
  hexbinder: (ctx, k) => {
    const c = chestAt(ctx, k.x, k.y, 12);
    killPop(ctx, k.x, k.y, k.dtype === 'decay' ? PEST : SPIRITP, k.big, k.elite);
    if (ctx.reduced || !has(ctx, 'fx:hexbinder:soul')) return;
    const n = k.boss ? 3 : k.elite ? 2 : (k.big || Math.random() < 0.5) ? 1 : 0;
    for (let i = 0; i < Math.min(n, ctx.juice.budget(n)); i++) {
      const s = ctx.scene.add.sprite(c.x + (i - (n - 1) / 2) * 8, c.y, 'fx:hexbinder:soul').setBlendMode(Phaser.BlendModes.ADD).setDepth(4655).setAlpha(0.95);
      if (ctx.scene.anims.exists('fx:hexbinder:soul')) s.play('fx:hexbinder:soul');
      ctx.scene.tweens.add({ targets: s, y: c.y - 34 - i * 6, x: s.x + (Math.random() - 0.5) * 14, alpha: 0, duration: 620 + i * 80, ease: 'Sine.easeOut', onComplete: () => s.destroy() });
    }
    if (k.elite || k.boss) {
      const p = ctx.P(k.x, k.y);
      sigil(ctx, p.x, p.y, k.boss ? 70 : 40, SPIRIT, 800);
      ctx.juice.beam(p.x, p.y, k.boss ? 200 : 120, k.boss ? 18 : 10, SPIRIT, 360);
      hitSpark(ctx, k.x, k.y, SPIRITP, k.boss ? 3 : 2);
    }
  },
});
