import * as Phaser from 'phaser';
import { MECHANIC_BY_ID, TICK_RATE } from '@cursebound/content';
import type { SfxId } from '../../audio/AudioEngine';
import { registerHazardFx, registerSkillFx, type CastFx, type FxCtx } from './registry';

// Fate mechanic presentation (cosmetic only; simulation/src/boons.ts documents the event contract).
// Casts: boon_chain_reaction (x,y centre, dx radius), boon_thunderous_blows (x,y strike), boon_splitting_shots
// (x,y from, dx,dy shard target), boon_soul_harvest (x,y foe, dx,dy hero), boon_retribution (x,y hero, dx radius),
// bane_hexed_ground (x,y eruption, dx radius), bane_blood_moon (x,y map centre, dx level); the rest are point
// effects at x,y. Enemy-sourced casts use slot -1.
// Hazards: fate_blast (pending blast), fate_trail (static trail), fate_pyre (burning pool; telegraph drawn by the
// generic telegraph layer until it arms), fate_hex (curse circle), fate_reaper (the Reaper; dx,dy = heading).

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
