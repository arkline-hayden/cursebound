import type * as Phaser from 'phaser';
import { registerHazardFx, registerProjectileFx, registerSkillFx, type CastFx, type FxCtx, type SnapHazard } from './registry';
import { arcTrail, burst, chest, ghost, groundCircle, groundQuad, pulseRing, sfx, streak } from './kit3';

// Hexbinder presentation (cosmetic only): sickly green rot, violet hexes, crimson blood and pale spirits.
// Sim conventions (simulation/src/classes/hexbinder.ts): plague cloud / blightbloom / locust swarm / blood tether casts
// carry the target point in dx,dy; h_contagion and h_hemorrhage_t are links x,y -> dx,dy; bursts (h_corpse_bloom,
// h_blightbloom_burst, h_exsanguinate, h_death_knell, h_banshee_shriek) carry the radius in dx. hx_tether hazards hold
// the caster in x,y and the vector to the target in dx,dy,len.

const SICK = 0x8fd14f;
const ROT = 0x4f7a22;
const HEX = 0x9a5ad0;
const BLOOD = 0xc0142a;
const SPIRIT = 0xc8f5e0;
const BONE = 0xe8e0c8;

function muzzle(ctx: FxCtx, e: CastFx, color: number, n = 3) {
  const u = ctx.U(e.dx, e.dy);
  const c = chest(ctx, e.x, e.y);
  ctx.juice.embersAt(c.x + u.x * 14, c.y + u.y * 14, n, color);
  ctx.dungeon.flashLight(c.x, c.y, 70, color, 0.9, 80);
}

function rise(ctx: FxCtx, e: CastFx, color: number, big: boolean) {
  const p = ctx.P(e.x, e.y);
  ctx.juice.ring(p.x, p.y, big ? 34 : 24, color, 300);
  ctx.juice.dust(p.x, p.y, big ? 8 : 4, 0x1a2a1a);
  ctx.juice.embersAt(p.x, p.y - 16, big ? 14 : 8, color);
  ctx.dungeon.flashLight(p.x, p.y - 16, 140, color, 1.6, 260);
}

registerSkillFx({
  h_hex_bolt: (ctx, e) => { muzzle(ctx, e, SICK); sfx(ctx, 'attack_spark', e.x, e.y, 60, ctx.mine ? 2 : 1); },
  h_grave_tide: (ctx, e) => {
    const J = ctx.juice;
    const p = ctx.P(e.x, e.y);
    J.ring(p.x, p.y, ctx.rx(2.2), SICK, 380); J.ring(p.x, p.y, ctx.rx(1.2), HEX, 260);
    J.dust(p.x, p.y, 16, 0x24301a); J.embersAt(p.x, p.y - 10, 24, SICK);
    ctx.dungeon.flashLight(p.x, p.y, 260, SICK, 2.6, 420);
    J.shake(0.012, 260); if (ctx.mine) J.hitStop(60);
    sfx(ctx, 'signature_nova', e.x, e.y, 80, 3);
  },
  h_plague_cloud: (ctx, e) => {
    arcTrail(ctx, e.x, e.y, e.dx, e.dy, SICK, 46, 300);
    ctx.scene.time.delayedCall(240, () => { const q = ctx.P(e.dx, e.dy); ctx.juice.ring(q.x, q.y, ctx.rx(2.2), SICK, 320); ctx.juice.dust(q.x, q.y, 10, 0x3a5a1a); ctx.juice.impact(q.x, q.y - 8, SICK, 1.4); });
    sfx(ctx, 'skill_fireline', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  h_blightbloom: (ctx, e) => {
    arcTrail(ctx, e.x, e.y, e.dx, e.dy, SICK, 40, 280);
    ctx.scene.time.delayedCall(220, () => { const q = ctx.P(e.dx, e.dy); ctx.juice.ring(q.x, q.y, 30, SICK, 300); ctx.juice.embersAt(q.x, q.y - 8, 14, SICK); });
    sfx(ctx, 'skill_rally', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  h_blightbloom_burst: (ctx, e) => { burst(ctx, e.x, e.y, e.dx || 2.5, SICK, 0xe0ffb0, true); ctx.juice.bleed('artillery', ctx.P(e.x, e.y).x, ctx.P(e.x, e.y).y - 10, 20); sfx(ctx, 'signature_nova', e.x, e.y, 80, 2); },
  h_locust_swarm: (ctx, e) => { const p = ctx.P(e.x, e.y); ctx.juice.dust(p.x, p.y, 10, 0x2a3a1a); streak(ctx, e.x, e.y, e.dx, e.dy, ROT, 3, 300); sfx(ctx, 'skill_sweep', e.x, e.y, 60, ctx.mine ? 2 : 1); },
  h_contagion: (ctx, e) => { streak(ctx, e.x, e.y, e.dx, e.dy, SICK, 2, 260); const q = chest(ctx, e.dx, e.dy); ctx.juice.embersAt(q.x, q.y, 4, SICK); },
  h_corpse_bloom: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    burst(ctx, e.x, e.y, e.dx || 2, SICK, ROT, false);
    ctx.juice.bleed('artillery', p.x, p.y - 12, 16);
    ctx.dungeon.addDecal('slime', p.x, p.y + 6, ROT, 1.4);
    sfx(ctx, 'kill', e.x, e.y, 60, 1);
  },
  h_rupture: (ctx, e) => { burst(ctx, e.x, e.y, 1.2, HEX, SICK, false); sfx(ctx, 'crit', e.x, e.y, 60, 2); },
  h_blood_tether: (ctx, e) => { ctx.bolt(e.x, e.y, e.dx, e.dy, BLOOD); const q = chest(ctx, e.dx, e.dy); ctx.juice.bleed('player', q.x, q.y, 8); sfx(ctx, 'skill_arc', e.x, e.y, 60, ctx.mine ? 2 : 1); },
  h_hemorrhage: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    ctx.juice.ring(p.x, p.y, ctx.rx(4), BLOOD, 340); ctx.juice.ring(p.x, p.y, ctx.rx(2), 0xff6a6a, 220);
    ctx.dungeon.flashLight(p.x, p.y - 10, 200, BLOOD, 2.2, 280);
    ctx.juice.shake(0.008, 160);
    sfx(ctx, 'signature_slam', e.x, e.y, 80, ctx.mine ? 2 : 1);
  },
  h_hemorrhage_t: (ctx, e) => { streak(ctx, e.x, e.y, e.dx, e.dy, BLOOD, 4, 260); const q = chest(ctx, e.x, e.y); ctx.juice.bleed('player', q.x, q.y, 12, e.dx - e.x, e.dy - e.y); },
  h_sanguine_lance: (ctx, e) => { const c = chest(ctx, e.x, e.y); const u = ctx.U(e.dx, e.dy); ctx.juice.arc(c.x + u.x * 12, c.y + u.y * 12, Math.atan2(u.y, u.x), BLOOD, 1.3); ctx.juice.bleed('player', c.x, c.y, 8, u.x, u.y); if (ctx.mine) ctx.juice.shake(0.004, 80); sfx(ctx, 'skill_sweep', e.x, e.y, 60, ctx.mine ? 2 : 1); },
  h_exsanguinate: (ctx, e) => { burst(ctx, e.x, e.y, e.dx || 2, BLOOD, 0xff9a9a, false); const p = ctx.P(e.x, e.y); ctx.juice.bleed('player', p.x, p.y - 12, 22); ctx.dungeon.addDecal('blood', p.x, p.y + 6, 0x8a1010, 1.3); },
  h_blood_price: (ctx, e) => { const c = chest(ctx, e.x, e.y); ctx.juice.bleed('player', c.x, c.y, 10); ctx.juice.ring(ctx.P(e.x, e.y).x, ctx.P(e.x, e.y).y, 20, BLOOD, 220); },
  h_blood_sacrament: (ctx, e) => {
    const c = chest(ctx, e.x, e.y);
    const n = Number(e.count ?? '1') || 1;
    ctx.juice.bleed('player', c.x, c.y, 8 + n * 3);
    ctx.juice.ring(c.x, c.y + 14, 18 + n * 5, BLOOD, 260);
    ctx.dungeon.flashLight(c.x, c.y, 90 + n * 20, BLOOD, 1.2 + n * 0.25, 220);
    if (ctx.mine) ctx.juice.number(c.x, c.y - 10, `BLOODLUST ${n}`, '#ff5a6a', 'sm');
  },
  h_summon_wraith: (ctx, e) => { rise(ctx, e, SPIRIT, true); sfx(ctx, 'skill_phase', e.x, e.y, 60, ctx.mine ? 2 : 1); },
  h_banshee: (ctx, e) => { rise(ctx, e, 0xd7a8ff, true); sfx(ctx, 'skill_phase', e.x, e.y, 60, ctx.mine ? 2 : 1); },
  h_grave_legion: (ctx, e) => { rise(ctx, e, BONE, false); sfx(ctx, 'skill_phase', e.x, e.y, 120, ctx.mine ? 2 : 1); },
  h_lesser_wraith: (ctx, e) => rise(ctx, e, SPIRIT, false),
  h_banshee_shriek: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    const R = e.dx || 3;
    ctx.juice.ring(p.x, p.y, ctx.rx(R), 0xd7a8ff, 360); ctx.juice.ring(p.x, p.y, ctx.rx(R * 0.66), 0xffffff, 260); ctx.juice.ring(p.x, p.y, ctx.rx(R * 0.33), 0xd7a8ff, 180);
    ctx.dungeon.flashLight(p.x, p.y - 20, 180, 0xb07aff, 2, 260);
    ctx.juice.shake(0.006, 140);
    sfx(ctx, 'boss_ring', e.x, e.y, 200, 1);
  },
  h_death_knell: (ctx, e) => { burst(ctx, e.x, e.y, e.dx || 2.2, HEX, SPIRIT, true); sfx(ctx, 'signature_nova', e.x, e.y, 120, 1); },
});

registerProjectileFx({
  hx_bolt: { key: 'fx:orb', color: SICK },
  hx_spirit: { key: 'fx:mote', color: SPIRIT },
  hx_seed: { key: 'fx:spark', color: 0xb0e060 },
  hx_lance: { key: 'fx:shard', color: BLOOD, scale: 1.6 },
});

const WRAITH_LOOK: Record<string, { size: number; body: number; eye: number; alpha: number }> = {
  hx_wraith: { size: 1, body: SPIRIT, eye: SICK, alpha: 0.7 },
  hx_banshee: { size: 1.25, body: 0xd7a8ff, eye: 0xffffff, alpha: 0.75 },
  hx_legion: { size: 0.85, body: BONE, eye: 0xff5a3a, alpha: 0.8 },
  hx_lesser: { size: 0.7, body: SPIRIT, eye: SICK, alpha: 0.45 },
};

function wraithFx(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const look = WRAITH_LOOK[h.k];
  const left = h.u - tick;
  const fade = Math.min(1, left / 20, (tick - h.b) / 12);
  const u = ctx.U(h.dx, h.dy);
  ghost(ctx, g, h.x, h.y, look.size, look.body, look.eye, look.alpha * Math.max(0.15, fade), tick + h.i * 7, u.x >= 0 ? 1 : -1);
  if (h.k === 'hx_banshee') pulseRing(ctx, g, h.x, h.y, 3, 0xd7a8ff, tick, h.b, 90);
  if (!ctx.reduced && Math.random() < 0.08) { const c = chest(ctx, h.x, h.y, 20); ctx.juice.embersAt(c.x, c.y, 1, look.body); }
}

registerHazardFx({
  hx_tide: (ctx, g, h) => {
    g.fillStyle(SICK, 0.32).fillPoints(groundQuad(h.x - h.dx * 0.7, h.y - h.dy * 0.7, h.dx, h.dy, 1.4, h.w), true);
    g.fillStyle(ROT, 0.25).fillPoints(groundQuad(h.x - h.dx * 2.2, h.y - h.dy * 2.2, h.dx, h.dy, 1.5, h.w * 0.9), true);
    g.lineStyle(3, 0xd8ffb0, 0.9).strokePoints(groundQuad(h.x + h.dx * 0.6, h.y + h.dy * 0.6, h.dx, h.dy, 0.05, h.w), true);
    if (!ctx.reduced && Math.random() < 0.6) {
      const side = (Math.random() - 0.5) * h.w;
      const q = ctx.P(h.x - h.dy * side, h.y + h.dx * side);
      ctx.juice.dust(q.x, q.y, 1, 0x3a5a1a); ctx.juice.embersAt(q.x, q.y - 6, 1, SICK);
    }
  },
  hx_plague: (ctx, g, h, tick) => {
    const landed = tick >= h.b + 15;
    if (!landed) { groundCircle(ctx, g, h.x, h.y, h.r, null, 0, SICK, 1, 0.5); return; }
    groundCircle(ctx, g, h.x, h.y, h.r, SICK, 0.16, ROT, 2, 0.8);
    groundCircle(ctx, g, h.x, h.y, h.r * (0.55 + 0.15 * Math.sin(tick * 0.08)), ROT, 0.18);
    pulseRing(ctx, g, h.x, h.y, h.r, 0xd8ffb0, tick, h.b + 15, 30);
    if (!ctx.reduced && Math.random() < 0.18) {
      const a = Math.random() * Math.PI * 2, rr = Math.random() * h.r;
      const q = ctx.P(h.x + Math.cos(a) * rr, h.y + Math.sin(a) * rr);
      ctx.juice.dust(q.x, q.y - 4, 1, 0x5a8a2a);
    }
  },
  hx_bloom: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const pulse = 1 + 0.12 * Math.sin(tick * 0.2);
    groundCircle(ctx, g, h.x, h.y, h.r, null, 0, SICK, 1, 0.35);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + tick * 0.01;
      g.fillStyle(i % 2 ? HEX : SICK, 0.85).fillEllipse(p.x + Math.cos(a) * 9 * pulse, p.y - 10 + Math.sin(a) * 5 * pulse, 10, 6, 10);
    }
    g.fillStyle(0xe0ffb0, 1).fillCircle(p.x, p.y - 10, 4 * pulse);
    g.lineStyle(2, ROT, 1).lineBetween(p.x, p.y, p.x, p.y - 8);
  },
  hx_swarm: (ctx, g, h, tick) => {
    groundCircle(ctx, g, h.x, h.y, h.r, ROT, 0.12);
    const p = ctx.P(h.x, h.y);
    for (let i = 0; i < 18; i++) {
      const a = i * 2.39996 + tick * (0.15 + (i % 5) * 0.03);
      const rr = (0.25 + ((i * 37) % 10) / 10 * 0.75) * h.r;
      const x = p.x + Math.cos(a) * ctx.rx(rr), y = p.y - 12 + Math.sin(a * 1.3) * ctx.ry(rr) - Math.abs(Math.sin(a * 2)) * 10;
      g.fillStyle(i % 3 ? 0x1a2410 : SICK, 0.95).fillRect(Math.round(x), Math.round(y), 2, 2);
    }
  },
  hx_corpse: (ctx, g, h, tick) => {
    const f = Math.min(1, (tick - h.b) / 15);
    groundCircle(ctx, g, h.x, h.y, h.r * f, SICK, 0.15 + 0.25 * f, Math.floor(tick / 4) % 2 ? 0xffffff : SICK, 2);
  },
  hx_tether: (ctx, g, h, tick) => {
    const a = chest(ctx, h.x, h.y), b = chest(ctx, h.x + h.dx * h.len, h.y + h.dy * h.len, 18);
    const pts: { x: number; y: number }[] = [];
    const nx = -(b.y - a.y), ny = b.x - a.x, nl = Math.hypot(nx, ny) || 1;
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const w = Math.sin(t * Math.PI) * Math.sin(tick * 0.4 + t * 9) * 5;
      pts.push({ x: a.x + (b.x - a.x) * t + (nx / nl) * w, y: a.y + (b.y - a.y) * t + (ny / nl) * w });
    }
    g.lineStyle(6, BLOOD, 0.45).strokePoints(pts);
    g.lineStyle(2.5, 0xff5a6a, 1).strokePoints(pts);
    g.fillStyle(0xff9a9a, 1).fillCircle(b.x, b.y, 3);
    if (!ctx.reduced && Math.random() < 0.25) ctx.juice.bleed('player', b.x, b.y, 2, a.x - b.x, a.y - b.y);
  },
  hx_wraith: wraithFx, hx_banshee: wraithFx, hx_legion: wraithFx, hx_lesser: wraithFx,
  hx_soul: (ctx, g, h, tick) => {
    const c = chest(ctx, h.x, h.y, 20 + Math.sin(tick * 0.15 + h.i) * 3);
    g.fillStyle(SPIRIT, 0.25).fillCircle(c.x, c.y, 7);
    g.fillStyle(SPIRIT, 0.95).fillCircle(c.x, c.y, 3);
    g.fillStyle(SICK, 0.9).fillCircle(c.x, c.y, 1.5);
  },
}, { hx_tide: SICK, hx_plague: SICK, hx_bloom: 0xb0e060, hx_swarm: ROT, hx_wraith: SPIRIT, hx_banshee: 0xb07aff, hx_legion: BONE, hx_corpse: SICK });
