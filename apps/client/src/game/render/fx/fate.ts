import * as Phaser from 'phaser';
import { MECHANICS, MECHANIC_BY_ID, TICK_RATE } from '@cursebound/content';
import { GRASP_WARN_SEC } from '@cursebound/simulation';
import type { SfxId } from '../../audio/AudioEngine';
import { registerHazardFx, registerSkillFx, type CastFx, type FxCtx } from './registry';

// Fate mechanic presentation (cosmetic only; simulation/src/boons.ts documents the event contract).
// Casts: boon_chain_reaction (x,y centre, dx radius), boon_thunderous_blows (x,y strike), boon_splitting_shots
// (x,y from, dx,dy shard target), boon_soul_harvest (x,y foe, dx,dy hero), boon_retribution (x,y hero, dx radius),
// bane_hexed_ground (x,y eruption, dx radius), bane_blood_moon (x,y map centre, dx level); the rest are point
// effects at x,y. Enemy-sourced casts use slot -1.
// Hazards: fate_blast (pending blast), fate_trail (static trail), fate_pyre (burning pool; telegraph drawn by the
// generic telegraph layer until it arms), fate_hex (curse circle), fate_reaper (the Reaper; dx,dy = heading).
// Rule-changer wave (bottom of this file): the shade, thralls, wisps and grave hands, plus their casts.

const EMBER = 0xff7a2a;
const FIRE_HI = 0xffc94a;
const STORM = 0x8fd8ff;
const PRISM = 0xf2a6ff;
const SOUL = 0x7ef0d0;
const HEX = 0x9b5cff;
const BLOOD = 0xff2a55;
const BONE = 0xe8dcc4;
const GOLD = 0xffc531;

const PYRE_ARM = Math.round(MECHANIC_BY_ID.volatile_dead.params.armSec * TICK_RATE);
const HEX_ARM = Math.round(MECHANIC_BY_ID.hexed_ground.params.armSec * TICK_RATE);

const lastSfx = new Map<string, number>();
function sfx(ctx: FxCtx, id: SfxId, x: number, y: number, minGapMs: number, priority = 1) {
  const t = lastSfx.get(id) ?? -1e9;
  if (ctx.now - t < minGapMs) return;
  lastSfx.set(id, ctx.now);
  ctx.sfx(id, x, y, priority);
}

const chest = (ctx: FxCtx, x: number, y: number) => { const p = ctx.P(x, y); return { x: p.x, y: p.y - 14 }; };

function fade(ctx: FxCtx, g: Phaser.GameObjects.Graphics, ms: number) {
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
}

function burst(ctx: FxCtx, x: number, y: number, R: number, color: number, inner: number, strong: boolean) {
  const J = ctx.juice;
  const p = ctx.P(x, y);
  J.ring(p.x, p.y, ctx.rx(R), color, 320);
  J.ring(p.x, p.y, ctx.rx(R * 0.55), inner, 220);
  J.embersAt(p.x, p.y - 10, strong ? 18 : 8, color);
  J.impact(p.x, p.y - 12, inner, strong ? 2 : 1.2);
  ctx.dungeon.flashLight(p.x, p.y - 10, Math.max(110, ctx.rx(R) * 2.2), color, strong ? 2.4 : 1.6, strong ? 300 : 200);
}

/** Jagged vertical sky bolt onto a world point. */
function skyBolt(ctx: FxCtx, x: number, y: number, color: number) {
  const p = ctx.P(x, y);
  if (!ctx.reduced) {
    const g = ctx.scene.add.graphics().setDepth(4650).setBlendMode(Phaser.BlendModes.ADD);
    let cx = p.x, cy = p.y - 180;
    const pts: [number, number][] = [[cx, cy]];
    for (let i = 0; i < 7; i++) { cx = p.x + (i % 2 === 0 ? 8 : -8) * (1 - i / 8); cy += 24; pts.push([cx, cy]); }
    pts.push([p.x, p.y - 4]);
    g.lineStyle(6, color, 0.7);
    for (let i = 1; i < pts.length; i++) g.lineBetween(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    g.lineStyle(2, 0xffffff, 1);
    for (let i = 1; i < pts.length; i++) g.lineBetween(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    fade(ctx, g, 220);
  }
  ctx.juice.sparksAt(p.x, p.y - 8, 12, color);
  ctx.juice.ring(p.x, p.y, ctx.rx(1.5), color, 220);
  ctx.dungeon.flashLight(p.x, p.y - 20, 180, color, 2.6, 160);
}

function streak(ctx: FxCtx, x0: number, y0: number, x1: number, y1: number, color: number, width: number, ms = 180) {
  if (ctx.reduced) return;
  const a = chest(ctx, x0, y0), b = chest(ctx, x1, y1);
  const g = ctx.scene.add.graphics().setDepth(4645).setBlendMode(Phaser.BlendModes.ADD);
  g.lineStyle(width, color, 0.9).lineBetween(a.x, a.y, b.x, b.y);
  g.lineStyle(Math.max(1, width / 3), 0xffffff, 1).lineBetween(a.x, a.y, b.x, b.y);
  fade(ctx, g, ms);
}

function wisp(ctx: FxCtx, x0: number, y0: number, x1: number, y1: number, color: number) {
  if (ctx.reduced) return;
  const a = chest(ctx, x0, y0), b = chest(ctx, x1, y1);
  const dot = ctx.scene.add.rectangle(a.x, a.y, 6, 6, color, 1).setDepth(4655).setBlendMode(Phaser.BlendModes.ADD);
  ctx.scene.tweens.add({ targets: dot, x: b.x, y: b.y, duration: 320, ease: 'Quad.easeIn', onComplete: () => { ctx.juice.sparksAt(b.x, b.y, 4, color); dot.destroy(); } });
}

const point = (e: CastFx) => [e.x, e.y] as const;

registerSkillFx({
  boon_chain_reaction: (ctx, e) => {
    burst(ctx, e.x, e.y, Math.max(1, e.dx || 2.5), EMBER, FIRE_HI, true);
    ctx.juice.shake(0.006, 120);
    sfx(ctx, 'blast_fire', e.x, e.y, 90, 1);
  },
  boon_thunderous_blows: (ctx, e) => { skyBolt(ctx, e.x, e.y, STORM); sfx(ctx, 'zap_strike', e.x, e.y, 70, ctx.mine ? 2 : 1); },
  boon_splitting_shots: (ctx, e) => { streak(ctx, e.x, e.y, e.dx, e.dy, PRISM, 3); const t = chest(ctx, e.dx, e.dy); ctx.juice.sparksAt(t.x, t.y, 4, PRISM); },
  boon_bloodrush: (ctx, e) => {
    const p = ctx.P(...point(e));
    ctx.juice.ring(p.x, p.y, ctx.rx(1.2), 0xff5a4a, 260); ctx.juice.embersAt(p.x, p.y - 16, 10, 0xff5a4a);
    if (ctx.mine) sfx(ctx, 'heartbeat', e.x, e.y, 400, 2);   // the blood rushing
  },
  boon_soul_harvest: (ctx, e) => wisp(ctx, e.x, e.y, e.dx, e.dy, SOUL),
  boon_echo: (ctx, e) => {
    const p = ctx.P(...point(e));
    ctx.juice.ring(p.x, p.y, ctx.rx(0.9), 0x6aa8ff, 200); ctx.juice.ring(p.x, p.y, ctx.rx(1.4), 0xdacaff, 320);
    ctx.juice.sparksAt(p.x, p.y - 20, 8, 0x6aa8ff);
    sfx(ctx, 'cast_astral', e.x, e.y, 150, ctx.mine ? 2 : 1);   // the charge chiming back
  },
  boon_phoenix: (ctx, e) => {
    burst(ctx, e.x, e.y, 2.2, 0xffa53a, GOLD, true);
    const p = ctx.P(...point(e));
    ctx.juice.embersAt(p.x, p.y - 24, 28, 0xffa53a);
    ctx.juice.flash(0xffa53a, 80);
    if (ctx.mine) ctx.juice.hitStop(90);
    sfx(ctx, 'player_revived', e.x, e.y, 200, 3);
    sfx(ctx, 'cast_fire', e.x, e.y, 200, 2);   // the flames of rebirth
  },
  boon_warding_rune: (ctx, e) => {
    const p = ctx.P(...point(e));
    ctx.juice.ring(p.x, p.y, ctx.rx(1), 0x7fe8ff, 320);
    ctx.juice.sparksAt(p.x, p.y - 22, 6, 0x7fe8ff);
    if (ctx.mine) sfx(ctx, 'shield', e.x, e.y, 300, 1);
  },
  boon_retribution: (ctx, e) => {
    const p = ctx.P(...point(e));
    ctx.juice.ring(p.x, p.y, ctx.rx(e.dx || 2.5), 0xc9a36b, 260);
    ctx.juice.dust(p.x, p.y, 6, 0x6a5a48);
    sfx(ctx, 'impact_heavy', e.x, e.y, 250, 1);   // fires on every hit taken, so spaced out
  },
  boon_executioner: (ctx, e) => {
    const p = chest(ctx, e.x, e.y);
    if (!ctx.reduced) {
      const g = ctx.scene.add.graphics().setDepth(4660).setBlendMode(Phaser.BlendModes.ADD);
      g.lineStyle(4, BONE, 1).lineBetween(p.x - 14, p.y - 14, p.x + 14, p.y + 14).lineBetween(p.x + 14, p.y - 14, p.x - 14, p.y + 14);
      fade(ctx, g, 260);
    }
    ctx.juice.sparksAt(p.x, p.y, 10, BONE);
    sfx(ctx, 'blade_flurry', e.x, e.y, 60, 1);   // the crossing cut
  },
  bane_hexed_ground: (ctx, e) => {
    burst(ctx, e.x, e.y, e.dx || 1.4, HEX, 0xdacaff, true);
    ctx.juice.shake(0.008, 140);
    sfx(ctx, 'blast_decay', e.x, e.y, 120, 2);   // the curse erupting
  },
  bane_relentless: (ctx, e) => {
    const p = ctx.P(...point(e));
    ctx.juice.ring(p.x, p.y, ctx.rx(1), 0xff3d3d, 240);
    ctx.juice.embersAt(p.x, p.y - 18, 6, 0xff3d3d);
    sfx(ctx, 'beast_roar', e.x, e.y, 300, 1);   // a foe enraging
  },
  bane_blood_moon: (ctx, e) => {
    ctx.juice.flash(BLOOD, 120);
    const p = ctx.P(...point(e));
    ctx.juice.number(p.x, p.y - 60, `BLOOD MOON ${Math.round(e.dx)}`, '#ff2a55', 'lg');
    sfx(ctx, 'heartbeat', e.x, e.y, 500, 3);
  },
  bane_brittle: (ctx, e) => {
    const p = chest(ctx, e.x, e.y);
    ctx.juice.sparksAt(p.x, p.y, 12, 0xc6e6ff);
    sfx(ctx, 'crit', e.x, e.y, 80, 2);
  },
  bane_the_hunt: (ctx, e) => {
    const p = ctx.P(...point(e));
    ctx.juice.ring(p.x, p.y, ctx.rx(1.6), 0xb8b0c8, 500);
    ctx.juice.dust(p.x, p.y, 14, 0x2a2430);
    ctx.dungeon.flashLight(p.x, p.y - 20, 200, 0x8a7aa8, 2, 500);
    sfx(ctx, 'summon_rise', e.x, e.y, 500, 3);   // the Reaper rising
    sfx(ctx, 'bell_toll', e.x, e.y, 500, 2);   // once a round: its knell
  },
});

registerHazardFx({
  // pending Chain Reaction blast: a blinking fuse ring
  fate_blast: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const on = Math.floor(tick / 2) % 2 === 0;
    g.lineStyle(2, on ? 0xffffff : EMBER, 1).strokeEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2);
    g.fillStyle(EMBER, 0.18).fillEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2);
  },
  // Static Trail segment: a crackling cyan patch that fades out
  fate_trail: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const life = Math.max(0, Math.min(1, (h.u - tick) / 40));
    g.fillStyle(0x3fe0c5, 0.22 * life).fillEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2);
    const k = (tick + h.i * 7) % 6;
    g.lineStyle(2, STORM, 0.9 * life)
      .lineBetween(p.x - 8 + k, p.y - 2, p.x - 2, p.y + 3)
      .lineBetween(p.x - 2, p.y + 3, p.x + 4, p.y - 3)
      .lineBetween(p.x + 4, p.y - 3, p.x + 10 - k, p.y + 2);
  },
  // Volatile Dead pool: the generic telegraph shows the arming window; then it burns
  fate_pyre: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
    if (tick - h.b < PYRE_ARM) { g.lineStyle(2, EMBER, 0.5).strokeEllipse(p.x, p.y, rx * 2, ry * 2); return; }
    const life = Math.max(0, Math.min(1, (h.u - tick) / 30));
    const flick = (Math.floor(tick / 4) + h.i) % 2;
    g.fillStyle(0x7a1a04, 0.42 * life).fillEllipse(p.x, p.y, rx * 2, ry * 2);
    g.fillStyle(flick ? EMBER : FIRE_HI, 0.3 * life).fillEllipse(p.x, p.y, rx * 1.4, ry * 1.4);
    g.lineStyle(2, 0xff3a1a, 0.9 * life).strokeEllipse(p.x, p.y, rx * 2, ry * 2);
    if (!ctx.reduced && (tick + h.i) % 9 === 0) ctx.juice.embersAt(p.x + ((tick * 13) % (rx | 1)) - rx / 2, p.y - 4, 1, EMBER);
  },
  // Hexed Ground curse circle: filling sigil, blinking just before it erupts
  fate_hex: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
    const prog = Math.max(0, Math.min(1, (tick - h.b) / HEX_ARM));
    const blink = prog > 0.75 && Math.floor(tick / 4) % 2 === 0;
    g.fillStyle(HEX, 0.14).fillEllipse(p.x, p.y, rx * 2, ry * 2);
    g.fillStyle(HEX, 0.34).fillEllipse(p.x, p.y, rx * 2 * prog, ry * 2 * prog);
    g.lineStyle(2, blink ? 0xffffff : HEX, 1).strokeEllipse(p.x, p.y, rx * 2, ry * 2);
    const rot = tick / 20;
    for (let i = 0; i < 6; i++) {
      const a = rot + (i * Math.PI) / 3;
      g.fillStyle(0xdacaff, 0.9).fillRect(Math.round(p.x + Math.cos(a) * rx * 0.8) - 2, Math.round(p.y + Math.sin(a) * ry * 0.8) - 2, 4, 4);
    }
  },
  // The Reaper: a hooded wraith with a scythe, drifting over a danger ring
  fate_reaper: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const bob = Math.round(Math.sin(ctx.now / 260) * 3);
    g.lineStyle(2, 0xff5a5a, 0.8).strokeEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2);
    g.fillStyle(0x000000, 0.35).fillEllipse(p.x, p.y, ctx.rx(h.r) * 1.6, ctx.ry(h.r) * 1.6);
    const top = p.y - 52 + bob;
    g.fillStyle(0x1a1424, 0.95).fillTriangle(p.x - 14, p.y - 6 + bob, p.x + 14, p.y - 6 + bob, p.x, top);
    g.fillStyle(0x2a2238, 1).fillRect(p.x - 7, top + 4, 14, 12);
    g.fillStyle(BONE, 1).fillRect(p.x - 4, top + 8, 8, 6);
    const glow = Math.floor(tick / 10) % 2 ? 0xff3a3a : 0xff8a5a;
    g.fillStyle(glow, 1).fillRect(p.x - 3, top + 9, 2, 2).fillRect(p.x + 1, top + 9, 2, 2);
    const u = ctx.U(h.dx || 1, h.dy);
    const sx = p.x + (u.x >= 0 ? 12 : -12);
    g.lineStyle(2, 0x8a7a6a, 1).lineBetween(sx, top + 6, sx, p.y - 4 + bob);
    g.lineStyle(3, 0xd8d8e8, 1).lineBetween(sx, top + 6, sx + (u.x >= 0 ? -16 : 16), top + 12);
  },
}, { fate_pyre: EMBER, fate_hex: HEX, fate_reaper: 0x8a7aa8 });

// ---------------- The rule-changer wave (boons.ts documents the event contract) ----------------

const SHADE = 0x6c5a9c;
const SHADE_HI = 0xc8b8ff;
const GRAVE = 0x9fe0a8;
const WISP = 0x8ff0e0;
const VOID = 0x7a6bff;
const KINETIC = 0x3fe0a0;
const LAST = 0xff4a3a;
const MOSS = 0x7d9a5a;

const THRALL_RISE = Math.round(MECHANIC_BY_ID.grave_thralls.params.riseSec * TICK_RATE);
const WISP_RISE = Math.round(MECHANIC_BY_ID.restless_dead.params.riseSec * TICK_RATE);
const GRASP_WARN = Math.round(GRASP_WARN_SEC * TICK_RATE);

/** A ground ring that collapses inward (gravity wells): the reverse of Juice.ring. */
function implode(ctx: FxCtx, x: number, y: number, R: number, color: number) {
  const p = ctx.P(x, y);
  if (ctx.reduced) { ctx.juice.ring(p.x, p.y, ctx.rx(R), color, 260); return; }
  const g = ctx.scene.add.graphics().setDepth(4641).setBlendMode(Phaser.BlendModes.ADD);
  const st = { k: 1 };
  ctx.scene.tweens.add({
    targets: st, k: 0.05, duration: 260, ease: 'Cubic.easeIn',
    onUpdate: () => {
      g.clear();
      g.lineStyle(3, color, 0.9).strokeEllipse(p.x, p.y, ctx.rx(R) * 2 * st.k, ctx.ry(R) * 2 * st.k);
      g.lineStyle(1, 0xffffff, 0.8).strokeEllipse(p.x, p.y, ctx.rx(R) * 1.3 * st.k, ctx.ry(R) * 1.3 * st.k);
    },
    onComplete: () => g.destroy(),
  });
}

registerSkillFx({
  boon_shadow_twin: (ctx, e) => {
    streak(ctx, e.x, e.y, e.dx, e.dy, SHADE, 3, 160);
    const a = chest(ctx, e.x, e.y), t = chest(ctx, e.dx, e.dy);
    ctx.juice.slash(t.x, t.y, Math.atan2(t.y - a.y, t.x - a.x), SHADE_HI, 0.9, { thin: true });
    const hero = ctx.actorSprite?.(e.slot);
    if (hero) { const s = ctx.P(e.x, e.y); ctx.juice.afterimage(hero, 0x2a1e4a, 0.7, 260, s.x - hero.x, s.y - hero.y); }
    sfx(ctx, 'blink', e.x, e.y, 140, ctx.mine ? 2 : 1);   // the shade's strike
  },
  boon_grave_thralls: (ctx, e) => {
    const p = ctx.P(...point(e));
    ctx.juice.ring(p.x, p.y, ctx.rx(1), GRAVE, 320);
    ctx.juice.dust(p.x, p.y, 8, 0x3a4a34);
    ctx.juice.sparksAt(p.x, p.y - 10, 6, GRAVE);
    sfx(ctx, 'summon_rise', e.x, e.y, 250, ctx.mine ? 2 : 1);   // a thrall claws out of the ground
  },
  boon_last_stand: (ctx, e) => {
    const p = ctx.P(...point(e));
    ctx.juice.ring(p.x, p.y, ctx.rx(1.6), LAST, 360);
    ctx.juice.embersAt(p.x, p.y - 18, 16, LAST);
    ctx.juice.number(p.x, p.y - 30, 'LAST STAND', '#ff4a3a', 'md');
    if (ctx.mine) { ctx.juice.pop(LAST, 0.18, 220); sfx(ctx, 'heartbeat', e.x, e.y, 600, 3); }
  },
  boon_gravity_well: (ctx, e) => {
    implode(ctx, e.x, e.y, Math.max(1, e.dx || 3), VOID);
    const p = ctx.P(...point(e));
    ctx.juice.orb(p.x, p.y - 10, VOID, 1.2, 280, 0.4);
    ctx.juice.sparksAt(p.x, p.y - 10, 10, 0xdacaff);
    ctx.dungeon.flashLight(p.x, p.y - 10, 160, VOID, 2, 260);
    sfx(ctx, 'gravity_well', e.x, e.y, 200, ctx.mine ? 2 : 1);
  },
  boon_momentum_ready: (ctx, e) => {
    const p = ctx.P(...point(e));
    ctx.juice.ring(p.x, p.y, ctx.rx(0.9), KINETIC, 240);
    ctx.juice.sparksAt(p.x, p.y - 20, 8, KINETIC);
    if (ctx.mine) sfx(ctx, 'combo', e.x, e.y, 300, 2);   // charged: the next hit lands heavy
  },
  boon_momentum: (ctx, e) => {
    const c = chest(ctx, e.x, e.y), g = ctx.P(e.x, e.y);
    ctx.juice.starburst(c.x, c.y, KINETIC, 1.3);
    ctx.juice.shockwave(g.x, g.y, ctx.rx(1.4), KINETIC, 300);
    sfx(ctx, 'impact_heavy', e.x, e.y, 120, ctx.mine ? 2 : 1);
  },
  boon_mirror_ward: (ctx, e) => {
    const p = chest(ctx, e.x, e.y);
    ctx.juice.starburst(p.x, p.y, 0xe8d4ff, 0.9);
    ctx.juice.sparksAt(p.x, p.y, 6, PRISM);
    sfx(ctx, 'shield_bash', e.x, e.y, 90, ctx.mine ? 2 : 1);   // the shot rings off the ward
  },
  // one event per hero at round start; each client calls out its own hero's roll
  boon_pandora: (ctx, e) => {
    if (!ctx.mine) return;
    const p = ctx.P(...point(e));
    const boon = MECHANICS[e.dx], bane = MECHANICS[e.dy];
    ctx.juice.pop(0xff5ce1, 0.16, 260);
    ctx.juice.ring(p.x, p.y, ctx.rx(1.8), 0xff5ce1, 420);
    if (boon) ctx.juice.number(p.x, p.y - 44, boon.name.toUpperCase(), '#ffd86a', 'lg');
    if (bane) ctx.juice.number(p.x, p.y - 20, bane.name.toUpperCase(), '#ff3d5a', 'lg');
    sfx(ctx, 'fate_blessing', e.x, e.y, 500, 3);
    if (bane) sfx(ctx, 'altar_pact', e.x, e.y, 500, 2);
  },
  bane_blood_price: (ctx, e) => {
    const c = chest(ctx, e.x, e.y), g = ctx.P(e.x, e.y);
    ctx.juice.embersAt(c.x, c.y, 8, 0xc8102e);
    ctx.juice.ring(g.x, g.y, ctx.rx(0.7), 0xc8102e, 200);
  },
  bane_restless_dead: (ctx, e) => {
    const p = ctx.P(...point(e));
    ctx.juice.dust(p.x, p.y, 5, 0x2a3a3a);
    ctx.juice.ring(p.x, p.y, ctx.rx(0.6), WISP, 260);
    sfx(ctx, 'horror_moan', e.x, e.y, 700, 1);   // the dead stir (spaced out: deaths come in waves)
  },
  bane_wisp_burst: (ctx, e) => {
    burst(ctx, e.x, e.y, 0.9, WISP, 0xffffff, false);
    sfx(ctx, 'impact_astral', e.x, e.y, 100, 2);
  },
  bane_grave_hands: (ctx, e) => {
    const c = chest(ctx, e.x, e.y), g = ctx.P(e.x, e.y);
    ctx.juice.claw(c.x, c.y + 8, -Math.PI / 2, MOSS, 1.1);
    ctx.juice.dust(g.x, g.y, 6, 0x3a3428);
    sfx(ctx, 'trap_snap', e.x, e.y, 200, 2);
  },
  bane_shadow_pact: (ctx, e) => {
    streak(ctx, e.dx, e.dy, e.x, e.y, SHADE, 4, 260);
    const p = ctx.P(...point(e));
    ctx.juice.dust(p.x, p.y, 12, 0x1a1428);
    ctx.juice.ring(p.x, p.y, ctx.rx(1.2), SHADE, 380);
    ctx.dungeon.flashLight(p.x, p.y - 16, 140, SHADE, 1.8, 300);
    sfx(ctx, 'summon_rise', e.x, e.y, 300, 2);   // a shadow peels off the elite
  },
});

registerHazardFx({
  // Shadow Twin: a dark, hooded double walking at the hero's back
  fate_shade: (ctx, g, h) => {
    const p = ctx.P(h.x, h.y);
    const bob = Math.round(Math.sin(ctx.now / 300 + h.i) * 2);
    g.fillStyle(0x000000, 0.3).fillEllipse(p.x, p.y, ctx.rx(0.45) * 2, ctx.ry(0.45) * 2);
    const top = p.y - 34 + bob;
    g.fillStyle(0x140e22, 0.78).fillTriangle(p.x - 9, p.y - 2 + bob, p.x + 9, p.y - 2 + bob, p.x, top);
    g.fillStyle(0x221a38, 0.85).fillCircle(p.x, top + 6, 5);
    const ex = Math.round(ctx.U(h.dx || 1, h.dy).x * 2);
    g.fillStyle(SHADE_HI, 1).fillRect(p.x - 3 + ex, top + 5, 2, 1).fillRect(p.x + 1 + ex, top + 5, 2, 1);
    g.lineStyle(1, SHADE, 0.6).strokeEllipse(p.x, p.y - 14 + bob, 22, 40);
  },
  // Grave Thralls: a pale grave-green revenant (clawing out of the ground while it rises)
  fate_thrall: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const rise = Math.max(0, Math.min(1, (tick - h.b) / THRALL_RISE));
    const a = Math.max(0, Math.min(1, (h.u - tick) / 30));
    g.fillStyle(0x0a140c, 0.4 * a).fillEllipse(p.x, p.y, ctx.rx(0.5) * 2, ctx.ry(0.5) * 2);
    const hgt = 30 * rise;
    const top = p.y - hgt;
    g.fillStyle(0x2a3a2c, 0.85 * a).fillRect(p.x - 6, top + 8, 12, Math.max(0, hgt - 8));
    g.fillStyle(BONE, 0.95 * a).fillRect(p.x - 4, top, 8, 8);
    const glow = Math.floor(tick / 8) % 2 ? GRAVE : 0xd8ffd8;
    g.fillStyle(glow, a).fillRect(p.x - 3, top + 3, 2, 2).fillRect(p.x + 1, top + 3, 2, 2);
    if (rise >= 1) {
      const u = ctx.U(h.dx || 1, h.dy);
      const sw = Math.sin(ctx.now / 90 + h.i) * 3;
      g.lineStyle(2, BONE, 0.9 * a).lineBetween(p.x, top + 12, p.x + u.x * 10 + sw, top + 14 + u.y * 6);
    }
    g.lineStyle(1, GRAVE, 0.5 * a).strokeEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2);
  },
  // Restless Dead: a hunting wisp (a pale flame with a tail), ringed red as the danger it is
  fate_wisp: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const rise = Math.max(0, Math.min(1, (tick - h.b) / WISP_RISE));
    const y = p.y - 6 - 14 * rise;
    g.lineStyle(1, 0xff5a5a, 0.7 * rise).strokeEllipse(p.x, p.y, ctx.rx(h.r) * 2, ctx.ry(h.r) * 2);
    const u = ctx.U(h.dx || 1, h.dy);
    for (let k = 3; k >= 1; k--) g.fillStyle(WISP, 0.18 * k * rise).fillCircle(p.x - u.x * k * 4, y - u.y * k * 2, 4 - k * 0.8);
    const pulse = 3 + (Math.floor(tick / 6) % 2);
    g.fillStyle(WISP, 0.5 * rise).fillCircle(p.x, y, (pulse + 3) * rise);
    g.fillStyle(0xffffff, 0.95 * rise).fillCircle(p.x, y, pulse * rise);
  },
  // Grave Hands: the ground cracks beneath a lingering hero and fingers claw upward until they grip
  fate_grasp: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
    const prog = Math.max(0, Math.min(1, (tick - h.b) / GRASP_WARN));
    const blink = prog >= 1 && Math.floor(tick / 5) % 2 === 0;
    g.fillStyle(0x0c120a, 0.45).fillEllipse(p.x, p.y, rx * 2, ry * 2);
    g.lineStyle(2, blink ? 0xd8ffb0 : MOSS, 0.9).strokeEllipse(p.x, p.y, rx * 2, ry * 2);
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + 0.3;
      const bx = p.x + Math.cos(ang) * rx * 0.7, by = p.y + Math.sin(ang) * ry * 0.7;
      const len = 4 + 10 * prog;
      const curl = Math.sin(ctx.now / 140 + i) * 2;
      g.lineStyle(2, BONE, 0.9).lineBetween(bx, by, bx + curl, by - len);
      g.lineStyle(1, BONE, 0.8).lineBetween(bx + curl, by - len, bx + curl + (bx < p.x ? 3 : -3), by - len + 3);
    }
  },
}, { fate_thrall: GRAVE, fate_wisp: WISP, fate_grasp: MOSS });
