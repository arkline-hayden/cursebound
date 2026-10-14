import { registerHazardFx, registerProjectileFx, registerSkillFx } from './registry';
import { arcTrail, burst, chest, groundCircle, groundQuad, pulseRing, sfx, skyBolt, streak } from './kit3';

// Arcanist evolved-skill presentation (cosmetic only). Spark, Astral Nova, Fireline, Arc Bolt and Phase Step keep their
// CombatScene effects. Sim conventions (simulation/src/classes/arcanist.ts): a_meteor, a_flame_wall, a_rift_gate and
// a_singularity casts carry the target point in dx,dy; a_overload carries the chain end; a_chain_link / a_ball_zap are
// links x,y -> dx,dy; a_blink_strike holds the arrival in x,y and the departure in dx,dy; bursts carry the radius in
// dx; a_attune carries the element in dx (1 ember, 2 storm). a_gate hazards point at their partner (dx,dy,len).

const EMBER = 0xff8a2a;
const FLAME = 0xffc070;
const STORM = 0x9fd8ff;
const ASTRAL = 0xd7a8ff;
const VOID = 0x2a1440;

registerSkillFx({
  a_meteor: (ctx, e) => { const c = chest(ctx, e.x, e.y); ctx.juice.embersAt(c.x, c.y - 10, 10, EMBER); ctx.dungeon.flashLight(c.x, c.y, 120, EMBER, 1.4, 200); sfx(ctx, 'skill_fireline', e.x, e.y, 60, ctx.mine ? 2 : 1); },
  a_meteor_impact: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    const R = e.dx || 2.4;
    burst(ctx, e.x, e.y, R, EMBER, 0xffffff, true);
    ctx.juice.ring(p.x, p.y, ctx.rx(R * 1.4), FLAME, 460);
    ctx.juice.dust(p.x, p.y, 20, 0x3a2a20); ctx.juice.embersAt(p.x, p.y - 10, 30, EMBER);
    ctx.dungeon.addDecal('scorch', p.x, p.y, 0x1a1008, R);
    ctx.juice.shake(0.02, 320);
    sfx(ctx, 'signature_slam', e.x, e.y, 80, 3);
  },
  a_flame_wall: (ctx, e) => { arcTrail(ctx, e.x, e.y, e.dx, e.dy, EMBER, 24, 240); sfx(ctx, 'skill_fireline', e.x, e.y, 60, ctx.mine ? 2 : 1); },
  a_overload: (ctx, e) => { const c = chest(ctx, e.x, e.y); ctx.juice.sparksAt(c.x, c.y, 10, STORM); ctx.dungeon.flashLight(c.x, c.y, 140, STORM, 2, 160); sfx(ctx, 'skill_arc', e.x, e.y, 60, ctx.mine ? 2 : 1); },
  a_chain_link: (ctx, e) => { ctx.bolt(e.x, e.y, e.dx, e.dy, STORM); const q = chest(ctx, e.dx, e.dy); ctx.juice.sparksAt(q.x, q.y, 5, STORM); },
  a_overload_burst: (ctx, e) => { burst(ctx, e.x, e.y, e.dx || 2.5, STORM, 0xffffff, true); skyBolt(ctx, e.x, e.y, STORM, 160); sfx(ctx, 'crit', e.x, e.y, 60, 2); },
  a_ball_lightning: (ctx, e) => { const c = chest(ctx, e.x, e.y); ctx.juice.sparksAt(c.x, c.y, 12, STORM); sfx(ctx, 'skill_arc', e.x, e.y, 60, ctx.mine ? 2 : 1); },
  a_ball_zap: (ctx, e) => { ctx.bolt(e.x, e.y, e.dx, e.dy, STORM); sfx(ctx, 'skill_arc', e.dx, e.dy, 140, 0); },
  a_thunderstrike: (ctx, e) => { skyBolt(ctx, e.x, e.y, STORM); const p = ctx.P(e.x, e.y); ctx.juice.ring(p.x, p.y, ctx.rx(e.dx || 1.5), STORM, 220); sfx(ctx, 'crit', e.x, e.y, 80, 1); },
  a_stormcaller: (ctx, e) => { skyBolt(ctx, e.x, e.y, 0xc8ecff, 260); const p = ctx.P(e.x, e.y); ctx.juice.ring(p.x, p.y, ctx.rx(e.dx || 1.2), STORM, 260); ctx.juice.shake(0.004, 90); sfx(ctx, 'skill_arc', e.x, e.y, 120, 1); },
  a_combustion: (ctx, e) => { burst(ctx, e.x, e.y, e.dx || 2, EMBER, FLAME, false); const p = ctx.P(e.x, e.y); ctx.juice.embersAt(p.x, p.y - 10, 16, EMBER); ctx.dungeon.addDecal('scorch', p.x, p.y, 0x1a1008, 1.2); sfx(ctx, 'kill', e.x, e.y, 60, 1); },
  a_blink_strike: (ctx, e) => {
    streak(ctx, e.dx, e.dy, e.x, e.y, ASTRAL, 5, 260);
    burst(ctx, e.dx, e.dy, 2, ASTRAL, 0xffffff, false);
    burst(ctx, e.x, e.y, 2, ASTRAL, 0xffffff, true);
    sfx(ctx, 'skill_phase', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  a_rift_gate: (ctx, e) => {
    for (const [x, y] of [[e.x, e.y], [e.dx, e.dy]]) { const p = ctx.P(x, y); ctx.juice.ring(p.x, p.y, ctx.rx(1.5), ASTRAL, 360); ctx.juice.embersAt(p.x, p.y - 14, 12, ASTRAL); ctx.dungeon.flashLight(p.x, p.y - 14, 180, 0xb07aff, 2, 400); }
    streak(ctx, e.x, e.y, e.dx, e.dy, ASTRAL, 2, 300);
    sfx(ctx, 'skill_phase', e.x, e.y, 60, ctx.mine ? 2 : 1);
  },
  a_echo_burst: (ctx, e) => { burst(ctx, e.x, e.y, e.dx || 2.2, ASTRAL, 0xffffff, false); sfx(ctx, 'signature_nova', e.x, e.y, 120, 1); },
  a_singularity: (ctx, e) => { arcTrail(ctx, e.x, e.y, e.dx, e.dy, ASTRAL, 30, 280); sfx(ctx, 'signature_nova', e.x, e.y, 80, ctx.mine ? 2 : 1); },
  a_singularity_collapse: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    burst(ctx, e.x, e.y, e.dx || 3, ASTRAL, 0xffffff, true);
    ctx.juice.ring(p.x, p.y, ctx.rx((e.dx || 3) * 1.5), 0xb07aff, 500);
    ctx.juice.flash(0xd7a8ff, 90);
    ctx.juice.shake(0.02, 320);
    sfx(ctx, 'signature_slam', e.x, e.y, 80, 3);
  },
  a_pyroclasm: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    const R = e.dx || 3;
    ctx.juice.ring(p.x, p.y, ctx.rx(R), EMBER, 360); ctx.juice.ring(p.x, p.y, ctx.rx(R * 0.6), 0xffffff, 220);
    ctx.juice.embersAt(p.x, p.y - 10, 34, EMBER); ctx.juice.dust(p.x, p.y, 12, 0x3a2a20);
    ctx.dungeon.flashLight(p.x, p.y, 280, EMBER, 2.8, 380);
    ctx.juice.shake(0.012, 240); if (ctx.mine) ctx.juice.hitStop(60);
    sfx(ctx, 'signature_nova', e.x, e.y, 80, 3);
  },
  a_attune: (ctx, e) => {
    const p = ctx.P(e.x, e.y);
    const col = e.dx === 1 ? EMBER : STORM;
    ctx.juice.ring(p.x, p.y, 26, col, 260);
    if (ctx.mine) ctx.juice.number(p.x, p.y - 36, e.dx === 1 ? 'EMBER ATTUNED' : 'STORM ATTUNED', e.dx === 1 ? '#ff9a3a' : '#9fd8ff', 'sm');
  },
});

registerProjectileFx({ a_shard: { key: 'fx:shard', color: ASTRAL } });

registerHazardFx({
  a_meteor: (ctx, g, h, tick) => {
    const total = Math.max(1, h.u - 1 - h.b), f = Math.min(1, (tick - h.b) / total);
    groundCircle(ctx, g, h.x, h.y, h.r, EMBER, 0.1 + 0.15 * f, f > 0.75 && Math.floor(tick / 4) % 2 ? 0xffffff : EMBER, 2);
    groundCircle(ctx, g, h.x, h.y, h.r * f, EMBER, 0.25);
    const p = ctx.P(h.x, h.y);
    const alt = (1 - f) * 260;
    const mx = p.x + alt * 0.35, my = p.y - 14 - alt;
    g.lineStyle(10, EMBER, 0.25).lineBetween(mx + 30, my - 60, mx, my);
    g.lineStyle(4, FLAME, 0.8).lineBetween(mx + 18, my - 36, mx, my);
    g.fillStyle(FLAME, 1).fillCircle(mx, my, 9);
    g.fillStyle(0xffffff, 1).fillCircle(mx - 2, my - 2, 4);
    if (!ctx.reduced && Math.random() < 0.5) ctx.juice.embersAt(mx, my, 1, EMBER);
  },
  a_crater: (ctx, g, h, tick) => {
    groundCircle(ctx, g, h.x, h.y, h.r, 0x2a1008, 0.4, EMBER, 2, 0.6 + 0.3 * Math.sin(tick * 0.2));
    if (!ctx.reduced && Math.random() < 0.3) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * h.r;
      const q = ctx.P(h.x + Math.cos(a) * r, h.y + Math.sin(a) * r);
      ctx.juice.embersAt(q.x, q.y - 4, 1, EMBER);
    }
  },
  a_flamewall: (ctx, g, h, tick) => {
    g.fillStyle(EMBER, 0.28).fillPoints(groundQuad(h.x, h.y, h.dx, h.dy, h.len, h.w), true);
    const n = Math.max(3, Math.round(h.len / 0.45));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const q = ctx.P(h.x + h.dx * h.len * t, h.y + h.dy * h.len * t);
      const fl = 14 + 8 * Math.sin(tick * 0.35 + i * 1.7);
      g.fillStyle(i % 2 ? EMBER : FLAME, 0.85).fillTriangle(q.x - 6, q.y, q.x + 6, q.y, q.x + Math.sin(tick * 0.2 + i) * 3, q.y - fl);
      g.fillStyle(0xfff0c8, 0.9).fillTriangle(q.x - 2.5, q.y, q.x + 2.5, q.y, q.x, q.y - fl * 0.5);
    }
    if (!ctx.reduced && Math.random() < 0.4) { const t = Math.random(); const q = ctx.P(h.x + h.dx * h.len * t, h.y + h.dy * h.len * t); ctx.juice.embersAt(q.x, q.y - 12, 1, EMBER); }
  },
  a_ball: (ctx, g, h, tick) => {
    const c = chest(ctx, h.x, h.y, 16);
    groundCircle(ctx, g, h.x, h.y, h.r, STORM, 0.05, STORM, 1, 0.25);
    g.fillStyle(STORM, 0.3).fillCircle(c.x, c.y, 13 + Math.sin(tick * 0.5) * 2);
    g.fillStyle(0xe8f6ff, 1).fillCircle(c.x, c.y, 6);
    g.lineStyle(1.5, 0xffffff, 0.9);
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      g.beginPath().moveTo(c.x, c.y).lineTo(c.x + Math.cos(a) * 9 + (Math.random() - 0.5) * 6, c.y + Math.sin(a) * 9).lineTo(c.x + Math.cos(a) * 18, c.y + Math.sin(a) * 18).strokePath();
    }
  },
  a_gate: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    const left = h.u - tick;
    const a = left < 60 && Math.floor(tick / 5) % 2 ? 0.4 : 1;
    groundCircle(ctx, g, h.x, h.y, 0.9, VOID, 0.6 * a, ASTRAL, 2, a);
    for (let i = 0; i < 2; i++) {
      const s = tick * 0.12 + i * Math.PI;
      g.lineStyle(3, i ? 0xb07aff : 0xffffff, 0.8 * a).beginPath().arc(p.x, p.y - 2, ctx.rx(0.7), s, s + 2.2).strokePath();
    }
    groundCircle(ctx, g, h.x, h.y, h.r, null, 0, ASTRAL, 1, 0.25 * a);
    const q = ctx.P(h.x + h.dx * h.len, h.y + h.dy * h.len);
    g.lineStyle(1, ASTRAL, 0.12 * a).lineBetween(p.x, p.y, q.x, q.y);
  },
  a_echo: (ctx, g, h, tick) => {
    const f = Math.min(1, (tick - h.b) / 45);
    groundCircle(ctx, g, h.x, h.y, h.r, ASTRAL, 0.08 + 0.2 * f, Math.floor(tick / 4) % 2 && f > 0.7 ? 0xffffff : ASTRAL, 2);
    const c = chest(ctx, h.x, h.y);
    g.fillStyle(ASTRAL, 0.35 * (1 - f * 0.5)).fillEllipse(c.x, c.y - 4, 14, 30, 16);
  },
  a_singularity: (ctx, g, h, tick) => {
    const p = ctx.P(h.x, h.y);
    groundCircle(ctx, g, h.x, h.y, h.r, VOID, 0.35, ASTRAL, 2, 0.6);
    pulseRing(ctx, g, h.x, h.y, h.r, 0xb07aff, h.b + h.u - tick, 0, 20);
    for (let i = 0; i < 10; i++) {
      const a = i * 0.628 + tick * 0.18;
      const r = ((i * 13 + tick * 2) % 30) / 30;
      g.fillStyle(ASTRAL, 0.9).fillCircle(p.x + Math.cos(a) * ctx.rx(h.r) * (1 - r), p.y - 6 + Math.sin(a) * ctx.ry(h.r) * (1 - r), 2);
    }
    g.fillStyle(0x000000, 0.95).fillEllipse(p.x, p.y - 6, 22, 14, 16);
    g.lineStyle(2, 0xffffff, 0.9).strokeEllipse(p.x, p.y - 6, 24, 15, 16);
  },
  a_combust: (ctx, g, h, tick) => {
    const f = Math.min(1, (tick - h.b) / 12);
    groundCircle(ctx, g, h.x, h.y, h.r * f, EMBER, 0.2 + 0.3 * f, FLAME, 2);
  },
}, { a_meteor: EMBER, a_crater: EMBER, a_flamewall: EMBER, a_ball: STORM, a_gate: 0xb07aff, a_singularity: 0xb07aff, a_echo: ASTRAL });
