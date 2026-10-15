import * as Phaser from 'phaser';
import type { SfxId } from '../../audio/AudioEngine';
import { registerHazardFx, registerKillFx, registerProjectileFx, registerSkillFx, type CastFx, type FxCtx } from './registry';
import { castFlash, chestAt, heroGhosts, impactBurst, screenAngle, trailBits, type Pal } from './spectacle';
import { arcTrail } from './kit3';

// Vanguard presentation (cosmetic only): steel shockwaves, shield glints, gold rally light, red for executes and
// provokes. Branch identity: Bulwark = steel blue + white glints, Cleaver = forged red + amber earth, Rally = banner
// gold. This kit owns the base skills too (a registered kit replaces CombatScene's fallback), so each plays its own sfx.
// Sim conventions (simulation/src/classes/vanguard.ts + players.ts): v_war_banner and v_leap carry the target point in
// dx,dy; v_retaliate_blast, v_maelstrom, v_provoke and v_aftershock carry the radius in dx; everything else uses dx,dy
// as the aim direction. True shapes: Cleave 120deg/2.1, Sweeping Strike 150deg/2.1, Executioner 80deg/2.6, Earthbreaker
// r2.6, Rally/Banner r4, Thunder Shout r5, Shield Charge 5x2 lane, Whirlwind 4 long r2, Retaliate r3, Bastion r2.5.

const STEEL = 0x9fd8ff;
const STEEL_HOT = 0xe8f6ff;
const GOLD = 0xffc94a;
const GOLD_HOT = 0xfff4c8;
const BANNER = 0xffd23f;
const RED = 0xff4a3a;
const RED_HOT = 0xffc0b0;
const AMBER = 0xffa830;
const EARTH = 0x6a5a48;
const RUBBLE = 0x8a7058;

const P_GOLD: Pal = { main: GOLD, hot: GOLD_HOT, deep: 0x8a5a10, bits: 'mote' };
const P_EARTH: Pal = { main: AMBER, hot: GOLD_HOT, deep: 0x8a4a10, bits: 'star' };

// ---------------------------------------------------------------- helpers

const lastSfx = new Map<string, number>();
/** Throttled positional sound (per id) so grouped packets and pulses never machine-gun. */
function sfx(ctx: FxCtx, id: SfxId, x: number, y: number, minGapMs: number, priority = 1) {
  const t = lastSfx.get(id) ?? -1e9;
  if (ctx.now - t < minGapMs) return;
  lastSfx.set(id, ctx.now);
  ctx.sfx(id, x, y, priority);
}

/** One-shot sprite from a pixel sheet: plays its animation (or fades over `ms`) and destroys itself. Decorative. */
function oneShot(ctx: FxCtx, key: string, x: number, y: number, o: { rot?: number; sx?: number; sy?: number; depth?: number; add?: boolean; tint?: number; ms?: number; grow?: number; alpha?: number; ox?: number; oy?: number } = {}) {
  const s = ctx.scene;
  if (ctx.reduced || !s.textures.exists(key)) return undefined;
  const spr = s.add.sprite(Math.round(x), Math.round(y), key).setRotation(o.rot ?? 0).setScale(o.sx ?? 1, o.sy ?? o.sx ?? 1)
    .setDepth(o.depth ?? 4655).setOrigin(o.ox ?? 0.5, o.oy ?? 0.5).setAlpha(o.alpha ?? 1)
    .setBlendMode(o.add === false ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD);
  if (o.tint !== undefined) spr.setTint(o.tint);
  if (s.anims.exists(key) && !o.ms) { spr.play(key); spr.once('animationcomplete', () => spr.destroy()); }
  else {
    const g = o.grow ?? 1;
    s.tweens.add({ targets: spr, alpha: 0, scaleX: spr.scaleX * g, scaleY: spr.scaleY * g, duration: o.ms ?? 300, ease: 'Quad.easeIn', onComplete: () => spr.destroy() });
  }
  return spr;
}

/** A flat wedge on the ground at the TRUE cone of a melee swing (world radius R, full angle arcDeg), fading out. */
function groundWedge(ctx: FxCtx, x: number, y: number, dx: number, dy: number, R: number, arcDeg: number, color: number, ms = 240, alpha = 0.32) {
  const base = Math.atan2(dy, dx);
  const half = (arcDeg * Math.PI) / 360;
  const n = Math.max(8, Math.ceil(arcDeg / 10));
  const c = ctx.P(x, y);
  const pts: Phaser.Types.Math.Vector2Like[] = [c];
  for (let i = 0; i <= n; i++) {
    const a = base - half + (2 * half * i) / n;
    pts.push(ctx.P(x + Math.cos(a) * R, y + Math.sin(a) * R));
  }
  const g = ctx.scene.add.graphics().setDepth(-69).setBlendMode(Phaser.BlendModes.ADD);
  g.fillStyle(color, alpha).fillPoints(pts, true);
  g.lineStyle(2, 0xffffff, 0.75).strokePoints(pts.slice(1), false);
  g.lineStyle(1, color, 0.9).strokePoints(pts, true);
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, ease: 'Quad.easeIn', onComplete: () => g.destroy() });
}

/** A flat lane on the ground (start, unit dir, length, width) in world units, fading out. */
function groundLane(ctx: FxCtx, x: number, y: number, dx: number, dy: number, len: number, w: number, color: number, ms = 320, alpha = 0.22) {
  const px = -dy * (w / 2), py = dx * (w / 2);
  const pts = [ctx.P(x + px, y + py), ctx.P(x + dx * len + px, y + dy * len + py), ctx.P(x + dx * len - px, y + dy * len - py), ctx.P(x - px, y - py)];
  const g = ctx.scene.add.graphics().setDepth(-69).setBlendMode(Phaser.BlendModes.ADD);
  g.fillStyle(color, alpha).fillPoints(pts, true);
  g.lineStyle(2, color, 0.85).lineBetween(pts[0]!.x, pts[0]!.y, pts[1]!.x, pts[1]!.y).lineBetween(pts[2]!.x, pts[2]!.y, pts[3]!.x, pts[3]!.y);
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, ease: 'Quad.easeIn', onComplete: () => g.destroy() });
}

/** Elliptical arc on the ground plane drawn straight into `g` (no allocation; safe in per-frame hazard draws). */
function groundArc(g: Phaser.GameObjects.Graphics, cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, segs = 10) {
  g.beginPath();
  g.moveTo(cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry);
  for (let i = 1; i <= segs; i++) { const a = a0 + ((a1 - a0) * i) / segs; g.lineTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry); }
  g.strokePath();
}

/** Upper half of a dome over a ground ellipse; `w` squeezes it into a meridian (1 = silhouette). */
function domeArc(g: Phaser.GameObjects.Graphics, cx: number, cy: number, rx: number, H: number, w: number, segs = 14) {
  g.beginPath();
  g.moveTo(cx + rx * w, cy);
  for (let i = 1; i <= segs; i++) { const a = (Math.PI * i) / segs; g.lineTo(cx + Math.cos(a) * rx * w, cy - Math.sin(a) * H); }
  g.strokePath();
}

/** Rising 'stone spurs': short amber light columns standing around a slam at a fraction of its radius. */
function spurs(ctx: FxCtx, x: number, y: number, R: number, n: number, color: number, h = 34) {
  const k = ctx.juice.budget(n);
  const off = Math.random() * Math.PI * 2;
  for (let i = 0; i < k; i++) {
    const a = off + (i / k) * Math.PI * 2;
    const q = ctx.P(x + Math.cos(a) * R, y + Math.sin(a) * R);
    ctx.juice.beam(q.x, q.y, h * (0.7 + Math.random() * 0.6), 7, color, 260 + i * 20);
    ctx.juice.dust(q.x, q.y, 1, EARTH);
  }
}

/** Rubble chips (ice bits tinted as stone) and dust thrown from a ground point. */
function rubble(ctx: FxCtx, sx: number, sy: number, n: number) {
  ctx.juice.bits('ice', sx, sy - 6, n, RUBBLE);
  ctx.juice.dust(sx, sy, Math.ceil(n / 2), EARTH);
}

/** The heater shield popping up in front of the hero along the aim, with a white glint on the shield side. */
function shieldPop(ctx: FxCtx, e: CastFx, scale = 1) {
  const u = ctx.U(e.dx, e.dy);
  const c = chestAt(ctx, e.x, e.y, 16);
  const sx = c.x + u.x * 14, sy = c.y + u.y * 8;
  const spr = oneShot(ctx, 'fx:vanguard:shield', sx, sy, { ms: 420, add: false, sx: 0.6 * scale, depth: 4662, grow: 1.25 });
  if (spr) ctx.scene.tweens.add({ targets: spr, y: sy - 4, duration: 140, ease: 'Back.easeOut' });
  ctx.juice.starburst(sx - 4, sy - 6, 0xffffff, 0.9 * scale, 200);
  ctx.juice.starburst(sx + 3, sy + 2, STEEL, 0.5 * scale, 160);
  ctx.juice.sparksAt(sx, sy, 6, STEEL_HOT);
  return { sx, sy };
}

/** Guard coverage drawn as a bright arc on the ground: 90deg, 120deg with Shield Reach, a full ring with Unbreakable. */
function guardArc(ctx: FxCtx, e: CastFx, color: number) {
  const full = ctx.rank(e.slot, 'v_unbreakable') > 0;
  const deg = full ? 360 : ctx.rank(e.slot, 'v_shield_reach') > 0 ? 120 : 90;
  if (full) {
    const p = ctx.P(e.x, e.y);
    ctx.juice.shockwave(p.x, p.y, ctx.rx(1.3), color, 380);
    ctx.juice.ring(p.x, p.y, ctx.rx(0.9), 0xffffff, 300);
  } else groundWedge(ctx, e.x, e.y, e.dx, e.dy, 1.3, deg, color, 420, 0.2);
}

const swingSide = new Map<number, boolean>();
function flipFor(slot: number) { const f = !swingSide.get(slot); swingSide.set(slot, f); return f; }

// ---------------------------------------------------------------- skills

registerSkillFx({
  // ---- base kit ----
  // Cleave (basic): crisp and cheap. A heavy forged arc at the true 2.1 reach, a thin white edge, alternating fore/backhand.
  v_cleave: (ctx, e) => {
    const J = ctx.juice;
    const ang = screenAngle(ctx, e.dx, e.dy);
    const u = ctx.U(e.dx, e.dy);
    const c = chestAt(ctx, e.x, e.y);
    const flip = flipFor(e.slot);
    const big = e.count ? 1.12 : 1;
    J.slash(c.x + u.x * 4, c.y + u.y * 2, ang, 0xfff0c8, 1.5 * big, { flip, ms: 170 });
    J.slash(c.x + u.x * 6, c.y + u.y * 3, ang, 0xffffff, 1.3 * big, { thin: true, flip, ms: 130 });
    J.sparksAt(c.x + u.x * 40, c.y + u.y * 20, 3, GOLD);
    sfx(ctx, 'swing', e.x, e.y, 50, ctx.mine ? 2 : 1);
  },

  // Earthbreaker (signature, r2.6; also the Warlord's Leap landing): a molten crater, triple wave, stone spurs, rubble.
  v_earthbreaker: (ctx, e) => {
    const J = ctx.juice;
    const R = 2.6;
    const p = ctx.P(e.x, e.y);
    const leap = ctx.rank(e.slot, 'v_warlord_leap') > 0;
    if (leap) {
      J.beam(p.x, p.y, 220, 26, GOLD, 300);
      J.beam(p.x, p.y, 220, 9, 0xffffff, 220);
    }
    J.orb(p.x, p.y - 18, GOLD_HOT, 0.9, 160, 2.2);
    impactBurst(ctx, e.x, e.y, R, P_EARTH, 3, { dust: 10, decal: 'scorch', decalTint: 0x2a1a10 });
    J.shockwave(p.x, p.y, ctx.rx(R * 0.8), STEEL, 380, 120);
    oneShot(ctx, 'fx:vanguard:crack', p.x, p.y + 2, { depth: -69, add: false, sx: ctx.rx(R) / 44, ms: 1100 });
    spurs(ctx, e.x, e.y, R * 0.65, 6, AMBER, leap ? 46 : 34);
    rubble(ctx, p.x, p.y, 16);
    J.bits('star', p.x, p.y - 12, 6, GOLD_HOT, { angle: -90, spread: 140, speed: 1.4 });
    if (ctx.rank(e.slot, 'v_aftershock') > 0) J.glyph(p.x, p.y, ctx.rx(R), AMBER, 520);   // the crack that will erupt
    ctx.dungeon.flashLight(p.x, p.y - 10, 300, AMBER, 2.8, 380);
    if (ctx.mine) J.hitStop(leap ? 110 : 80);
    sfx(ctx, 'signature_slam', e.x, e.y, 80, ctx.mine ? 3 : 2);
  },

  // Guard Stance: the shield pops up with a glint, the guard arc lights on the ground, steel light.
  v_guard_stance: (ctx, e) => {
    const { sx, sy } = shieldPop(ctx, e);
    guardArc(ctx, e, STEEL);
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, 22, STEEL, 240);
    ctx.dungeon.flashLight(sx, sy, 130, STEEL, 1.8, 260);
    sfx(ctx, 'skill_guard', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },

  // Sweeping Strike: the true 150deg wedge flares red, two heavy arcs, sparks along the edge; Deep Cut bleeds, Fracture cracks.
  v_sweeping_strike: (ctx, e) => {
    const J = ctx.juice;
    const ang = screenAngle(ctx, e.dx, e.dy);
    const u = ctx.U(e.dx, e.dy);
    const c = chestAt(ctx, e.x, e.y);
    groundWedge(ctx, e.x, e.y, e.dx, e.dy, 2.1, 150, RED, 260, 0.3);
    J.slash(c.x, c.y, ang, RED, 1.7, { ms: 220 });
    J.slash(c.x, c.y, ang + 0.25, 0xfff0c8, 1.45, { thin: true, ms: 170 });
    J.slash(c.x, c.y, ang - 0.25, 0xffffff, 1.45, { thin: true, flip: true, ms: 170 });
    const base = Math.atan2(e.dy, e.dx);
    const bleed = ctx.rank(e.slot, 'v_deep_cut') > 0, fracture = ctx.rank(e.slot, 'v_fracture') > 0;
    for (let i = -2; i <= 2; i++) {
      const a = base + (i * 0.6);
      const q = chestAt(ctx, e.x + Math.cos(a) * 1.9, e.y + Math.sin(a) * 1.9, 10);
      J.sparksAt(q.x, q.y, 2, i % 2 ? RED_HOT : GOLD);
      if (bleed) J.bleed('player', q.x, q.y, 3, q.x - c.x, q.y - c.y);
      if (fracture && i % 2 === 0) J.bits('ice', q.x, q.y, 2, STEEL_HOT);
    }
    J.starburst(c.x + u.x * 40, c.y + u.y * 20, RED_HOT, 0.8, 150);
    ctx.dungeon.flashLight(c.x + u.x * 30, c.y + u.y * 15, 140, RED, 1.8, 200);
    sfx(ctx, 'skill_sweep', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },

  // Rally Cry (aura r4): a gold war-glyph, a banner-gold wave at the true radius, a light column, rising motes.
  v_rally_cry: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    castFlash(ctx, e.x, e.y, P_GOLD, 1.6, { glyph: true });
    J.shockwave(p.x, p.y, ctx.rx(4), BANNER, 520);
    J.ring(p.x, p.y, ctx.rx(4), 0xffffff, 380);
    J.beam(p.x, p.y, 120, 18, BANNER, 420);
    J.beam(p.x, p.y, 120, 6, 0xffffff, 300);
    J.bits('mote', p.x, p.y - 20, 12, BANNER);
    J.bits('star', p.x, p.y - 30, 5, GOLD_HOT, { angle: -90, spread: 70, speed: 1.2 });
    if (ctx.rank(e.slot, 'v_standard_bearer') > 0) J.ring(p.x, p.y, ctx.rx(2.2), STEEL, 460);
    if (ctx.rank(e.slot, 'v_valor') > 0) J.bits('mote', p.x, p.y - 10, 8, 0xb8ffb0);
    ctx.dungeon.flashLight(p.x, p.y - 20, 240, BANNER, 2.2, 520);
    sfx(ctx, 'skill_rally', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },

  // ---- evolutions ----
  // Shield Charge: the true 5x2 lane lights, the shield leads, steel afterimages stream behind, a slam where it stops.
  v_shield_charge: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const u = ctx.U(e.dx, e.dy);
    groundLane(ctx, e.x, e.y, e.dx, e.dy, 5, 2, STEEL, 360);
    shieldPop(ctx, e, 1.1);
    J.dust(p.x, p.y, 8, EARTH);
    J.bits('ice', p.x, p.y - 4, 5, RUBBLE, { angle: (Math.atan2(-u.y, -u.x) * 180) / Math.PI, spread: 60, speed: 0.8 });
    J.ring(p.x, p.y, 26, STEEL, 220);
    ctx.dungeon.flashLight(p.x, p.y - 10, 160, STEEL, 2, 260);
    for (let i = 0; i < 3; i++) ctx.scene.time.delayedCall(i * 90, () => heroGhosts(ctx, e.slot, e.dx, e.dy, STEEL, 3, 10));
    ctx.scene.time.delayedCall(300, () => {
      const s = ctx.actorSprite?.(e.slot);
      const ex = s?.active ? s.x : ctx.P(e.x + e.dx * 5, e.y + e.dy * 5).x;
      const ey = s?.active ? s.y : ctx.P(e.x + e.dx * 5, e.y + e.dy * 5).y;
      J.shockwave(ex, ey, ctx.rx(1.2), STEEL, 300);
      J.starburst(ex + u.x * 12, ey - 16 + u.y * 6, 0xffffff, 1.1, 170);
      J.sparksAt(ex + u.x * 12, ey - 14, 8, STEEL_HOT);
      J.dust(ex, ey, 5, EARTH);
      ctx.dungeon.flashLight(ex, ey - 12, 140, STEEL, 2, 200);
      sfx(ctx, 'shield_bash', e.x + e.dx * 5, e.y + e.dy * 5, 60, ctx.mine ? 2 : 1);   // the slam where it stops (fixed delay)
    });
    sfx(ctx, 'dodge', e.x, e.y, 60, ctx.mine ? 2 : 1);   // the rush
  },

  // Retaliate: the shield braces and a ring at the true blast radius (3) charges up over the brace.
  v_retaliate: (ctx, e) => {
    shieldPop(ctx, e, 1.1);
    guardArc(ctx, e, GOLD);
    const sec = 1.5 + (ctx.rank(e.slot, 'v_unbreakable') > 0 ? 1 : 0);
    if (!ctx.reduced) {
      const p = ctx.P(e.x, e.y);
      const rx = ctx.rx(3), ry = ctx.ry(3);
      const g = ctx.scene.add.graphics().setDepth(-69).setBlendMode(Phaser.BlendModes.ADD);
      const st = { f: 0 };
      ctx.scene.tweens.add({
        targets: st, f: 1, duration: sec * 1000, ease: 'Quad.easeIn',
        onUpdate: () => {
          g.clear();
          g.lineStyle(1, GOLD, 0.35 + 0.4 * st.f).strokeEllipse(p.x, p.y, rx * 2, ry * 2, 40);
          g.lineStyle(3, st.f > 0.85 && Math.floor(ctx.scene.time.now / 70) % 2 ? 0xffffff : GOLD, 0.8);
          groundArc(g, p.x, p.y, rx, ry, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * st.f, 32);
          g.fillStyle(GOLD, 0.05 + 0.1 * st.f).fillEllipse(p.x, p.y, rx * 2 * st.f, ry * 2 * st.f, 32);
        },
        onComplete: () => g.destroy(),
      });
    }
    sfx(ctx, 'skill_guard', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  // Retaliate detonation (r in dx): everything absorbed comes back as a gold-white blast with shield-shard glints.
  v_retaliate_blast: (ctx, e) => {
    const J = ctx.juice;
    const R = e.dx || 3;
    const p = ctx.P(e.x, e.y);
    impactBurst(ctx, e.x, e.y, R, P_GOLD, 3, { dust: 12, decal: 'scorch', decalTint: 0x2a2010 });
    J.shockwave(p.x, p.y, ctx.rx(R * 1.2), RED, 480, 90);
    J.shockwave(p.x, p.y, ctx.rx(R * 0.7), STEEL, 340, 40);
    J.beam(p.x, p.y, 160, 24, GOLD, 320);
    J.beam(p.x, p.y, 160, 8, 0xffffff, 240);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const q = chestAt(ctx, e.x + Math.cos(a) * R * 0.75, e.y + Math.sin(a) * R * 0.75, 10);
      J.starburst(q.x, q.y, i % 2 ? STEEL_HOT : GOLD_HOT, 0.7, 200 + i * 15);
      J.slash(q.x, q.y, Math.atan2(q.y - p.y + 10, q.x - p.x), i % 2 ? STEEL : GOLD, 0.6, { thin: true, ms: 200 });
    }
    J.bits('star', p.x, p.y - 14, 12, STEEL_HOT, { angle: -90, spread: 200, speed: 1.6 });
    rubble(ctx, p.x, p.y, 10);
    J.pop(GOLD, 0.18, 200);
    if (ctx.mine) J.hitStop(90);
    sfx(ctx, 'slam_heavy', e.x, e.y, 80, 3);
    sfx(ctx, 'shield_bash', e.x, e.y, 80, 1);   // the shield shards
  },

  // Whirlwind: the true 4-long, r2 lane lights, a cyclone of gold/white blades turns around the hero for the spin.
  v_whirlwind: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    groundLane(ctx, e.x, e.y, e.dx, e.dy, 4, 4, GOLD, 360, 0.14);
    J.dust(p.x, p.y, 6, EARTH);
    for (let i = 0; i < 4; i++) {
      ctx.scene.time.delayedCall(i * 75, () => {
        const s = ctx.actorSprite?.(e.slot);
        const cx = s?.active ? s.x : p.x, cy = (s?.active ? s.y : p.y) - 14;
        const a = i * 1.7;
        J.slash(cx, cy, a, i % 2 ? GOLD : 0xfff0c8, 1.4, { ms: 160, flip: i % 2 === 1 });
        J.slash(cx, cy, a + Math.PI, i % 2 ? RED : 0xffffff, 1.2, { thin: true, ms: 140 });
        J.dust(cx, cy + 14, 2, EARTH);
        if (s?.active) heroGhosts(ctx, e.slot, e.dx, e.dy, GOLD, 2, 9);
      });
    }
    ctx.dungeon.flashLight(p.x, p.y - 10, 160, GOLD, 1.8, 360);
    sfx(ctx, 'skill_sweep', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },

  // Executioner's Chop: the true 80deg/2.6 wedge flashes red and a heavy overhead blade lands with a crack in the stone.
  v_executioner: (ctx, e) => {
    const J = ctx.juice;
    const ang = screenAngle(ctx, e.dx, e.dy);
    const u = ctx.U(e.dx, e.dy);
    const c = chestAt(ctx, e.x, e.y);
    const hit = ctx.P(e.x + e.dx * 1.7, e.y + e.dy * 1.7);
    groundWedge(ctx, e.x, e.y, e.dx, e.dy, 2.6, 80, RED, 300, 0.34);
    J.slash(c.x + u.x * 10, c.y - 6, ang + 0.6, RED, 1.9, { ms: 230 });
    J.slash(c.x + u.x * 12, c.y - 4, ang + 0.6, 0xffffff, 1.6, { thin: true, ms: 170 });
    J.beam(hit.x, hit.y, 70, 8, RED, 200);
    J.starburst(hit.x, hit.y - 8, RED_HOT, 1.1, 180);
    oneShot(ctx, 'fx:vanguard:crack', hit.x, hit.y, { depth: -69, add: false, sx: 0.55, ms: 700 });
    rubble(ctx, hit.x, hit.y, 8);
    ctx.dungeon.addDecal('scorch', hit.x, hit.y + 2, 0x2a1810, 0.7);
    ctx.dungeon.flashLight(hit.x, hit.y - 10, 150, RED, 2, 220);
    if (ctx.mine) J.hitStop(40);
    sfx(ctx, 'skill_sweep', e.x, e.y, 60, ctx.mine ? 2 : 1);
    sfx(ctx, 'slam_heavy', e.x + e.dx * 1.7, e.y + e.dy * 1.7, 60, 1);   // the blade cracking the stone
  },
  // An execution (on the executed enemy): a guillotine of red light, crossing white cuts, a blood burst.
  v_execute: (ctx, e) => {
    const J = ctx.juice;
    const c = chestAt(ctx, e.x, e.y);
    const p = ctx.P(e.x, e.y);
    J.beam(p.x, p.y, 110, 12, RED, 240);
    J.beam(p.x, p.y, 110, 4, 0xffffff, 180);
    J.slash(c.x, c.y, -0.8, 0xffffff, 0.9, { thin: true, ms: 200 });
    J.slash(c.x, c.y, 0.8 + Math.PI, RED, 0.9, { thin: true, ms: 200, flip: true });
    J.starburst(c.x, c.y, 0xffffff, 1.5, 200);
    J.orb(c.x, c.y, RED, 0.9, 220);
    J.bleed('player', c.x, c.y, 16);
    J.sparksAt(c.x, c.y, 12, RED);
    ctx.dungeon.addDecal('blood', p.x, p.y + 3, 0x6a0a0a, 0.9);
    ctx.dungeon.flashLight(c.x, c.y, 170, RED, 2.4, 220);
    if (ctx.mine) { J.hitStop(80); J.number(c.x, c.y - 18, 'EXECUTE', '#ff6a5e', 'md'); }
    sfx(ctx, 'crit', e.x, e.y, 60, 3);
  },

  // War Banner (target point in dx,dy): thrown in a gold arc; it lands with a wave at the true radius (4).
  v_war_banner: (ctx, e) => {
    castFlash(ctx, e.x, e.y, P_GOLD, 1, { dx: e.dx - e.x, dy: e.dy - e.y });
    arcTrail(ctx, e.x, e.y, e.dx, e.dy, BANNER, 34, 300);
    trailBits(ctx, e.x, e.y, e.dx, e.dy, 'mote', 5, BANNER, 24);
    ctx.scene.time.delayedCall(200, () => {
      const J = ctx.juice;
      const q = ctx.P(e.dx, e.dy);
      J.beam(q.x, q.y, 150, 18, BANNER, 340);
      J.beam(q.x, q.y, 150, 6, 0xffffff, 260);
      J.shockwave(q.x, q.y, ctx.rx(4), BANNER, 480);
      J.glyph(q.x, q.y, ctx.rx(4), BANNER, 700);
      J.starburst(q.x, q.y - 40, GOLD_HOT, 1.2, 200);
      J.bits('mote', q.x, q.y - 20, 10, BANNER);
      rubble(ctx, q.x, q.y, 6);
      ctx.dungeon.flashLight(q.x, q.y - 20, 240, BANNER, 2.2, 460);
      sfx(ctx, 'slam_heavy', e.dx, e.dy, 120, 1);
      sfx(ctx, 'skill_rally', e.dx, e.dy, 60, ctx.mine ? 2 : 1);   // planted: the rally goes up
    });
    sfx(ctx, 'throw_whoosh', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },

  // Thunderous Shout (r5): the big one. A war-glyph, three staggered waves at the true radius, a visible roar, thunder.
  v_thunder_shout: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const R = 5;
    castFlash(ctx, e.x, e.y, P_GOLD, 2.2, { glyph: true });
    J.shockwave(p.x, p.y, ctx.rx(R), BANNER, 460);
    J.shockwave(p.x, p.y, ctx.rx(R), 0xffffff, 420, 80);
    J.shockwave(p.x, p.y, ctx.rx(R * 0.6), AMBER, 380, 160);
    J.beam(p.x, p.y, 200, 26, BANNER, 360);
    J.beam(p.x, p.y, 200, 9, 0xffffff, 260);
    J.starburst(p.x, p.y - 24, 0xffffff, 2, 220);
    // the roar: stacked crescents rolling out along the aim
    const ang = screenAngle(ctx, e.dx, e.dy);
    const u = ctx.U(e.dx, e.dy);
    for (let i = 0; i < 3; i++) {
      ctx.scene.time.delayedCall(i * 70, () => J.slash(p.x + u.x * (20 + i * 26), p.y - 16 + u.y * (10 + i * 13), ang, i === 1 ? 0xffffff : BANNER, 1 + i * 0.5, { thin: true, ms: 240 }));
    }
    // thunder: jagged bolts out to the edge of the shout, zaps around the rim
    const bolts = ctx.reduced ? 0 : 4;
    const off = Math.random() * Math.PI * 2;
    for (let i = 0; i < bolts; i++) {
      const a = off + (i / bolts) * Math.PI * 2;
      ctx.bolt(e.x, e.y, e.x + Math.cos(a) * R * 0.9, e.y + Math.sin(a) * R * 0.9, i % 2 ? BANNER : 0xfff4c8);
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      J.bits('zap', p.x + Math.cos(a) * ctx.rx(R), p.y + Math.sin(a) * ctx.ry(R) - 6, 1, i % 2 ? BANNER : 0xffffff);
    }
    J.bits('star', p.x, p.y - 20, 10, GOLD_HOT, { angle: -90, spread: 160, speed: 1.6 });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; J.dust(p.x + Math.cos(a) * ctx.rx(R * 0.8), p.y + Math.sin(a) * ctx.ry(R * 0.8), 1, EARTH); }
    J.pop(BANNER, 0.15, 220);
    ctx.dungeon.flashLight(p.x, p.y - 10, 320, BANNER, 3, 460);
    if (ctx.mine) J.hitStop(80);
    sfx(ctx, 'skill_rally', e.x, e.y, 60, 3);
    sfx(ctx, 'zap_strike', e.x, e.y, 200, 1);   // the thunder
  },

  // Warlord's Leap (x,y -> landing dx,dy, 0.4s airborne): take-off burst, a gold arc, a landing ring at the true r2.6
  // that closes in as the hero comes down (the slam itself is the v_earthbreaker event at landing).
  v_leap: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    const t = ctx.P(e.dx, e.dy);
    J.shockwave(p.x, p.y, ctx.rx(1.2), GOLD, 260);
    J.dust(p.x, p.y, 10, EARTH);
    rubble(ctx, p.x, p.y, 6);
    J.orb(p.x, p.y - 16, GOLD, 0.7, 200);
    arcTrail(ctx, e.x, e.y, e.dx, e.dy, GOLD, 70, 440);
    trailBits(ctx, e.x, e.y, e.dx, e.dy, 'star', 6, GOLD_HOT, 40);
    for (let i = 0; i < 3; i++) ctx.scene.time.delayedCall(i * 110, () => heroGhosts(ctx, e.slot, e.dx - e.x, e.dy - e.y, GOLD, 2, 12));
    landingMark(ctx, t.x, t.y, 2.6, 400);
    sfx(ctx, 'cine_whoosh', e.x, e.y, 60, ctx.mine ? 2 : 1);   // the arc up and over
  },

  // Iron Maelstrom pulse (every 0.5s while guarding, r in dx): a steel ring at the true radius and two turning blades.
  v_maelstrom: (ctx, e) => {
    const J = ctx.juice;
    const R = e.dx || 2.5;
    const p = ctx.P(e.x, e.y);
    J.shockwave(p.x, p.y, ctx.rx(R), STEEL, 260);
    const a = (ctx.now / 160) % (Math.PI * 2);
    J.slash(p.x, p.y - 14, a, STEEL, 1.2, { thin: true, ms: 160 });
    J.slash(p.x, p.y - 14, a + Math.PI, 0xffffff, 1.2, { thin: true, ms: 160 });
    J.sparksAt(p.x, p.y - 12, 5, STEEL_HOT);
    sfx(ctx, 'swing', e.x, e.y, 120, 1);
  },

  // Provoke (r in dx): a red challenge wave at the true radius and a red flare over the Vanguard's head.
  v_provoke: (ctx, e) => {
    const J = ctx.juice;
    const R = e.dx || 5;
    const p = ctx.P(e.x, e.y);
    J.shockwave(p.x, p.y, ctx.rx(R), RED, 420, 60);
    J.ring(p.x, p.y, ctx.rx(R), RED_HOT, 360);
    J.starburst(p.x, p.y - 46, RED, 1.2, 240);
    J.bits('zap', p.x, p.y - 44, 4, RED);
    ctx.dungeon.flashLight(p.x, p.y - 20, 190, RED, 1.8, 300);
    if (ctx.mine) J.number(p.x, p.y - 34, 'PROVOKE', '#ff6a5e', 'sm');
    sfx(ctx, 'shield_bash', e.x, e.y, 200, 1);   // banging the shield in challenge
  },

  // Aftershock eruption (r in dx): the cracked ground bursts in amber, spurs and rubble.
  v_aftershock: (ctx, e) => {
    const J = ctx.juice;
    const R = e.dx || 2.2;
    const p = ctx.P(e.x, e.y);
    impactBurst(ctx, e.x, e.y, R, P_EARTH, 2, { dust: 6, decal: 'scorch', decalTint: 0x2a2018 });
    oneShot(ctx, 'fx:vanguard:crack', p.x, p.y + 2, { depth: -69, add: false, sx: ctx.rx(R) / 46, ms: 800 });
    spurs(ctx, e.x, e.y, R * 0.55, 4, AMBER, 28);
    rubble(ctx, p.x, p.y, 10);
    sfx(ctx, 'slam_heavy', e.x, e.y, 120, 1);
  },

  // Last Stand (keystone): a golden pillar, a halo burst and a moment of slow motion for the Vanguard who refuses to fall.
  v_last_stand: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    J.beam(p.x, p.y, 260, 34, GOLD, 600);
    J.beam(p.x, p.y, 260, 12, 0xffffff, 420);
    J.glyph(p.x, p.y, 60, GOLD, 900);
    J.shockwave(p.x, p.y, 70, GOLD, 520);
    J.shockwave(p.x, p.y, 44, 0xffffff, 380, 80);
    J.starburst(p.x, p.y - 22, 0xffffff, 2.2, 260);
    J.orb(p.x, p.y - 20, GOLD, 1.4, 360);
    J.embersAt(p.x, p.y - 14, 24, GOLD);
    J.bits('star', p.x, p.y - 20, 12, GOLD_HOT, { angle: -90, spread: 120, speed: 1.4 });
    ctx.dungeon.flashLight(p.x, p.y - 10, 280, GOLD, 3, 700);
    J.pop(GOLD, 0.2, 260);
    if (ctx.mine) { J.hitStop(140); J.dilate(0.5, 500); J.number(p.x, p.y - 40, 'LAST STAND', '#ffd890', 'lg'); }
    sfx(ctx, 'player_revived', e.x, e.y, 200, 4);
  },
});

/** Landing ring at the true slam radius whose inner ring closes in over the flight time. */
function landingMark(ctx: FxCtx, x: number, y: number, R: number, ms: number) {
  const rx = ctx.rx(R), ry = ctx.ry(R);
  const g = ctx.scene.add.graphics().setDepth(-70);
  const st = { f: 0 };
  ctx.scene.tweens.add({
    targets: st, f: 1, duration: ms, ease: 'Quad.easeIn',
    onUpdate: () => {
      g.clear();
      g.fillStyle(GOLD, 0.1 + 0.12 * st.f).fillEllipse(x, y, rx * 2, ry * 2, 36);
      g.lineStyle(2, GOLD, 0.95).strokeEllipse(x, y, rx * 2, ry * 2, 36);
      const k = 1 - st.f;
      g.lineStyle(2, 0xffffff, 0.9).strokeEllipse(x, y, rx * 2 * k, ry * 2 * k, 28);
    },
    onComplete: () => g.destroy(),
  });
}

// ---------------------------------------------------------------- hazards

const bannerPulse = new Map<number, number>();

registerHazardFx({
  // Shield Charge: a shield wedge leading the charge, speed lines and a dust wake.
  v_charge: (ctx, g, h) => {
    const p = ctx.P(h.x, h.y);
    const u = ctx.U(h.dx, h.dy);
    const ang = Math.atan2(u.y, u.x);
    const fx = p.x + u.x * 6, fy = p.y - 14 + u.y * 3;
    g.lineStyle(6, STEEL, 0.55).beginPath().arc(fx, fy, 19, ang - 0.95, ang + 0.95).strokePath();
    g.lineStyle(3, STEEL_HOT, 0.95).beginPath().arc(fx, fy, 19, ang - 0.75, ang + 0.75).strokePath();
    g.lineStyle(1, 0xffffff, 1).beginPath().arc(fx, fy, 21, ang - 0.45, ang + 0.45).strokePath();
    for (let i = 1; i <= 4; i++) {
      const side = (i % 2 ? 1 : -1) * (4 + i * 3);
      const ox = -u.y * side, oy = u.x * side * 0.6;
      g.lineStyle(2, i % 2 ? STEEL : 0xffffff, 0.6 / i * 2).lineBetween(p.x + ox - u.x * 8 * i, p.y - 14 + oy - u.y * 8 * i, p.x + ox - u.x * (20 + 10 * i), p.y - 14 + oy - u.y * (20 + 10 * i));
    }
    g.fillStyle(STEEL, 0.12).fillEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 24);
    if (!ctx.reduced && Math.random() < 0.5) ctx.juice.dust(p.x - u.x * 10, p.y, 1, EARTH);
    if (!ctx.reduced && Math.random() < 0.15) ctx.juice.bits('star', fx + u.x * 18, fy, 1, STEEL_HOT);
  },

  // Whirlwind: a cyclone of gold blades at the true r2 around the spinning hero, a ground ring and red sparks.
  v_whirl: (ctx, g, h) => {
    const p = ctx.P(h.x, h.y);
    const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
    const t = ctx.now / 1000;
    g.fillStyle(GOLD, 0.08).fillEllipse(p.x, p.y, rx * 2, ry * 2, 32);
    g.lineStyle(2, GOLD, 0.7).strokeEllipse(p.x, p.y, rx * 2, ry * 2, 32);
    for (let i = 0; i < 3; i++) {
      const a = t * 14 + (i * Math.PI * 2) / 3;
      g.lineStyle(4, i ? GOLD : 0xffffff, 0.85);
      groundArc(g, p.x, p.y, rx * 0.95, ry * 0.95, a, a + 1.1, 8);
      g.lineStyle(3, i ? 0xfff0c8 : RED, 0.75);
      groundArc(g, p.x, p.y - 16, rx * 0.55, ry * 0.55, a + 0.5, a + 1.5, 6);
    }
    if (!ctx.reduced && Math.random() < 0.35) {
      const a = Math.random() * Math.PI * 2;
      ctx.juice.sparksAt(p.x + Math.cos(a) * rx * 0.8, p.y - 10 + Math.sin(a) * ry * 0.8, 1, Math.random() < 0.5 ? RED_HOT : GOLD);
    }
  },

  // Aftershock fuse (0.5s): molten cracks race out to the true radius and the rim blinks faster before it erupts.
  v_aftershock: (ctx, g, h, tick) => {
    const f = Math.min(1, (tick - h.b) / 30);
    const p = ctx.P(h.x, h.y);
    const blink = Math.floor(ctx.now / (f > 0.6 ? 60 : 120)) % 2 === 0;
    g.fillStyle(AMBER, 0.06 + 0.12 * f).fillEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 32);
    g.lineStyle(2, blink ? 0xffffff : AMBER, 0.4 + 0.5 * f).strokeEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2, 32);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + h.i;
      const r1 = h.r * f;
      const m = ctx.P(h.x + Math.cos(a + 0.2) * r1 * 0.5, h.y + Math.sin(a + 0.2) * r1 * 0.5), q = ctx.P(h.x + Math.cos(a) * r1, h.y + Math.sin(a) * r1);
      g.lineStyle(3, 0x2a1810, 0.8).beginPath().moveTo(p.x, p.y).lineTo(m.x, m.y).lineTo(q.x, q.y).strokePath();
      g.lineStyle(1, i % 2 ? 0xffd070 : AMBER, 0.6 + 0.4 * f).beginPath().moveTo(p.x, p.y).lineTo(m.x, m.y).lineTo(q.x, q.y).strokePath();
    }
    if (!ctx.reduced && Math.random() < 0.25) ctx.juice.dust(p.x + (Math.random() - 0.5) * ctx.rx(h.r), p.y, 1, EARTH);
  },

  // War Banner: a planted crimson-and-gold standard, the true r4 field with turning gold ticks, a wave every pulse.
  v_banner: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
    const t = ctx.now / 1000;
    g.fillStyle(BANNER, 0.06).fillEllipse(p.x, p.y, rx * 2, ry * 2, 40);
    g.lineStyle(2, BANNER, 0.55).strokeEllipse(p.x, p.y, rx * 2, ry * 2, 40);
    g.lineStyle(3, GOLD_HOT, 0.7);
    for (let i = 0; i < 6; i++) { const a = t * 0.6 + (i * Math.PI) / 3; groundArc(g, p.x, p.y, rx, ry, a, a + 0.22, 3); }
    // pulse wave synced to the damage pulse (every 60 ticks from birth + 1)
    const ph = ((tick - h.b - 1) % 60 + 60) % 60;
    const f = ph / 60;
    g.lineStyle(2, 0xffffff, Math.max(0, 0.8 - f)).strokeEllipse(p.x, p.y, rx * 2 * Math.min(1, f * 1.6), ry * 2 * Math.min(1, f * 1.6), 32);
    const cycle = Math.floor((tick - h.b - 1) / 60);
    if (cycle >= 0 && bannerPulse.get(h.i) !== cycle) {
      if (bannerPulse.size > 64) bannerPulse.clear();
      bannerPulse.set(h.i, cycle);
      ctx.juice.shockwave(p.x, p.y, rx, BANNER, 380);
      ctx.juice.bits('mote', p.x, p.y - 30, 4, BANNER);
      ctx.dungeon.flashLight(p.x, p.y - 30, 160, BANNER, 1.4, 260);
    }
    // the standard: shadow, pole, gold finial, crimson cloth in stepped waves with gold trim and a sun emblem
    g.fillStyle(0x000000, 0.35).fillEllipse(p.x, p.y, 16, 6, 12);
    g.fillStyle(0x2a1a10, 1).fillRect(p.x - 2, p.y - 52, 4, 52);
    g.fillStyle(0x8a5a30, 1).fillRect(p.x - 1, p.y - 52, 2, 52);
    g.fillStyle(GOLD, 1).fillRect(p.x - 3, p.y - 56, 6, 4);
    g.fillStyle(0xffffff, 1).fillRect(p.x - 1, p.y - 58, 2, 2);
    for (let k = 0; k < 6; k++) {
      const wy = Math.round(Math.sin(t * 5 - k * 0.8) * 2);
      const x0 = p.x + 2 + k * 4;
      const len = 22 - (k > 3 ? (k - 3) * 4 : 0);
      g.fillStyle(0x6a0a14, 1).fillRect(x0, p.y - 50 + wy, 4, len + 2);
      g.fillStyle(k % 2 ? 0xb01a24 : 0xd02a30, 1).fillRect(x0, p.y - 50 + wy, 4, len);
      g.fillStyle(GOLD, 1).fillRect(x0, p.y - 50 + wy, 4, 2).fillRect(x0, p.y - 50 + wy + len - 2, 4, 2);
    }
    const ey = p.y - 41 + Math.round(Math.sin(t * 5 - 1.6) * 2);
    g.fillStyle(GOLD, 1).fillRect(p.x + 9, ey - 3, 6, 6);
    g.fillStyle(GOLD_HOT, 1).fillRect(p.x + 11, ey - 5, 2, 10).fillRect(p.x + 7, ey - 1, 10, 2);
    if (!ctx.reduced && Math.random() < 0.08) ctx.juice.bits('mote', p.x + (Math.random() - 0.5) * rx, p.y - Math.random() * 10, 1, BANNER);
  },

  // Bastion (r2.5 shelter, allies take x0.6): a steel dome over the true footprint with turning rim lights and glints.
  bastion: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
    const life = Math.max(0, Math.min(1, (h.u - tick) / 20)) * Math.max(0, Math.min(1, (tick - h.b + 1) / 8));
    const t = ctx.now / 1000;
    g.fillStyle(STEEL, 0.12 * life).fillEllipse(p.x, p.y, rx * 2, ry * 2, 40);
    g.lineStyle(2, STEEL, 0.9 * life).strokeEllipse(p.x, p.y, rx * 2, ry * 2, 40);
    g.lineStyle(3, 0xffffff, 0.8 * life);
    for (let k = 0; k < 4; k++) { const a = t * 1.4 + (k * Math.PI) / 2; groundArc(g, p.x, p.y, rx, ry, a, a + 0.45, 5); }
    const H = ry * 2.6;
    g.lineStyle(1.5, STEEL, 0.5 * life);
    domeArc(g, p.x, p.y, rx, H, 1);
    g.lineStyle(1, STEEL_HOT, 0.35 * life);
    for (let m = 0; m < 3; m++) domeArc(g, p.x, p.y, rx, H, Math.cos(t * 0.9 + (m * Math.PI) / 3), 10);
    // a shimmer band climbing the dome
    const lat = (t * 0.7) % 1;
    const w = Math.sqrt(1 - lat * lat);
    g.lineStyle(2, 0xffffff, 0.45 * life * (1 - lat));
    groundArc(g, p.x, p.y - H * lat, rx * w, ry * w, 0, Math.PI, 12);
    if (!ctx.reduced && Math.random() < 0.07) ctx.juice.bits('star', p.x + (Math.random() - 0.5) * rx * 1.4, p.y - Math.random() * H * 0.8, 1, STEEL_HOT);
  },
}, { v_banner: BANNER, v_charge: STEEL, v_aftershock: AMBER, bastion: STEEL, v_whirl: GOLD });

// ---------------------------------------------------------------- projectiles

registerProjectileFx({
  // Sundering Wave: a ground shockwave crescent with glints in its wake; it breaks into rubble where it ends.
  wave: {
    key: 'fx:vanguard:wave', color: AMBER, scale: 1.1, additive: true, trail: 'star', trailMs: 40,
    end: (ctx, sx, sy) => {
      ctx.juice.shockwave(sx, sy + 14, 26, AMBER, 240);
      ctx.juice.starburst(sx, sy, GOLD_HOT, 0.7, 140);
      rubble(ctx, sx, sy + 14, 4);
    },
  },
});

// ---------------------------------------------------------------- kills

registerKillFx({
  // A steel glint and gold chips on every kill; crits strike red, elites and bosses get a ground wave.
  vanguard: (ctx, k) => {
    const J = ctx.juice;
    const c = chestAt(ctx, k.x, k.y, 12);
    J.starburst(c.x, c.y, k.crit ? RED_HOT : 0xffffff, k.big || k.crit ? 1.2 : 0.8, 170);
    J.bits('star', c.x, c.y, k.big ? 6 : 3, k.crit ? RED : GOLD);
    if (k.big || k.elite || k.boss) {
      const p = ctx.P(k.x, k.y);
      J.shockwave(p.x, p.y, ctx.rx(k.boss ? 2.4 : 1.3), k.crit ? RED : STEEL, 320);
      rubble(ctx, p.x, p.y, k.boss ? 10 : 5);
    }
  },
});
