import { Big } from '@cursebound/numeric';
import { SKILL_BY_ID } from '@cursebound/content';
import { hitEnemy } from '../combat';
import { registerClassHooks, registerGlobalHooks, type SimHooks } from '../hooks';
import { inLine, norm, q, rayDistance } from '../geometry';
import { nearestFloor } from '../map';
import { areaCoverage, knockback, livingEnemies, makeHazard, spawnPlayerProjectiles, stormCast } from '../players';
import { nextFloat } from '../rng';
import { B, ONE, hitDamage, playerDerived } from '../stats';
import type { EnemyState, Hazard, PlayerState, SimEvent, SimState } from '../types';
import { DT, aimPoint, baseHit, castEv, clearVars, enemiesNear, has, hitArea, isLive, pullToward, pushEnemy, spawnProj, ticks } from './kitHelpers';

// Arcanist deep tree + evolved skills (content: packages/content/src/classes/arcanist.ts). Spark, Astral Nova, Phase
// Step, Inferno, Ash Recovery and the base Fireline/Arc Bolt remain inline in players.ts/combat.ts; Fireline and
// Arc Bolt are re-implemented here only when Elemental Attunement needs to empower them.
//
// Hazard kinds: a_meteor (fuse, impacts at nextTick), a_crater (burning ground), a_flamewall (x,y = one end, dx,dy along
//               the wall, length), a_ball (Ball Lightning orb), a_gate (Rift Gate; dx,dy,length = vector to its partner),
//               a_echo (Astral Echo fuse), a_singularity (black hole), a_combust (Combustion fuse).
// Projectiles:  a_shard (Riftwalker ring); Pyroclasm reuses 'spark'.
// Cast events:  skill ids (meteor/flame wall/rift gate/singularity carry their target point in dx/dy; Overload and the
//               attuned Arc Bolt carry the chain end like the inline Arc Bolt), plus a_chain_link (x,y -> dx,dy),
//               a_overload_burst, a_ball_zap (orb -> target), a_meteor_impact, a_thunderstrike, a_stormcaller,
//               a_combustion, a_echo_burst, a_singularity_collapse, a_pyroclasm, a_attune (dx = 1 ember / 2 storm).

const CID = 'arcanist';
const EMBER = new Set(['a_fireline', 'a_meteor', 'a_flame_wall']);
const STORM = new Set(['a_arc_bolt', 'a_overload', 'a_ball_lightning']);
const RIFT = new Set(['a_phase_step', 'a_blink_strike', 'a_rift_gate']);

/** Elemental Attunement: x1.6 on the next skill of the attuned element (ar_att 1 = ember, 2 = storm). */
function attuned(p: PlayerState, skillId: string): boolean {
  if (!has(p, 'a_attunement')) return false;
  const a = p.vars.ar_att ?? 0;
  return (a === 1 && EMBER.has(skillId)) || (a === 2 && STORM.has(skillId));
}
const attuneMult = (p: PlayerState, skillId: string) => (attuned(p, skillId) ? B('1.6') : ONE);

function eventHorizon(state: SimState, p: PlayerState) {
  if (!has(p, 'a_event_horizon') || p.resource < 15) return;
  p.resource -= 15;
  state.hazards.push(makeHazard(state, {
    kind: 'horizon', owner: 'player', ownerId: p.slot, x: p.x, y: p.y, radius: 3, untilTick: state.tick + ticks(2),
    interval: ticks(0.25), damage: hitDamage(state, p, 'a_event_horizon_field', 'astral'), dtype: 'astral',
  }));
}

function teleport(state: SimState, ev: SimEvent[], p: PlayerState, x: number, y: number) {
  const fx = p.x, fy = p.y;
  p.x = q(x); p.y = q(y);
  ev.push({ t: 'teleport', slot: p.slot, fx, fy, x: p.x, y: p.y });
}

/** Chain lightning shared by the attuned Arc Bolt and Overload (same targeting as the inline Arc Bolt). */
function chain(state: SimState, ev: SimEvent[], p: PlayerState, skillId: string, dmg: Big, range: number, jumpRange: number, jumps: number) {
  const reach = Math.min(p.aimDist || 4, range);
  const tx = p.x + p.aimX * reach, ty = p.y + p.aimY * reach;
  const live = livingEnemies(state);
  let cur: EnemyState | null = null; let bd = Infinity;
  for (const e of live) {
    if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 > range * range) continue;
    const d2 = (e.x - tx) ** 2 + (e.y - ty) ** 2;
    if (d2 < bd) { bd = d2; cur = e; }
  }
  const hit: number[] = [];
  const pts: { x: number; y: number }[] = [{ x: p.x, y: p.y }];
  let last: EnemyState | null = null;
  while (cur && hit.length <= jumps) {
    hit.push(cur.id);
    pts.push({ x: cur.x, y: cur.y });
    last = cur;
    hitEnemy(state, ev, cur, dmg, ONE, { dtype: 'storm', srcSlot: p.slot, skillId, fromX: p.x, fromY: p.y, allowCrit: true });
    const from: EnemyState = cur;
    cur = null; bd = jumpRange * jumpRange;
    for (const e of live) {
      if (hit.includes(e.id) || e.state === 'dying') continue;
      const d2 = (e.x - from.x) ** 2 + (e.y - from.y) ** 2;
      if (d2 <= bd) { bd = d2; cur = e; }
    }
  }
  return { tx, ty, pts, last };
}

// ---------------- skills ----------------

function castSkill(state: SimState, ev: SimEvent[], p: PlayerState, skillId: string): boolean | undefined {
  const tick = state.tick;
  switch (skillId) {
    case 'a_fireline': {
      if (!attuned(p, skillId) || !state.map) return undefined;
      const skill = SKILL_BY_ID[skillId];
      if (skill.shape.kind !== 'line') return false;
      const len = Math.min(skill.shape.length, rayDistance(state.map, p.x, p.y, p.aimX, p.aimY, skill.shape.length));
      state.hazards.push(makeHazard(state, {
        kind: 'fireline', owner: 'player', ownerId: p.slot, x: p.x, y: p.y, dx: p.aimX, dy: p.aimY, length: Math.max(0.5, len), width: skill.shape.width,
        untilTick: tick + ticks(skill.shape.duration), interval: ticks(skill.shape.tickInterval),
        damage: hitDamage(state, p, skillId, 'ember').mul(attuneMult(p, skillId)), dtype: 'ember', dot: skill.dot,
      }));
      castEv(ev, p, skillId, p.x, p.y, p.aimX, p.aimY);
      return true;
    }
    case 'a_arc_bolt': {
      if (!attuned(p, skillId)) return undefined;
      const skill = SKILL_BY_ID[skillId];
      if (skill.shape.kind !== 'chain') return false;
      const jumps = skill.shape.jumps + (has(p, 'a_fork') ? 1 : 0) + 2;
      const c = chain(state, ev, p, skillId, hitDamage(state, p, skillId, 'storm').mul(B('1.6')), skill.shape.range, skill.shape.jumpRange, jumps);
      const end = c.pts[c.pts.length - 1];
      castEv(ev, p, skillId, p.x, p.y, c.pts.length > 1 ? end.x : c.tx, c.pts.length > 1 ? end.y : c.ty);
      for (let i = 1; i < c.pts.length - 1; i++) castEv(ev, p, 'a_chain_link', c.pts[i].x, c.pts[i].y, c.pts[i + 1].x, c.pts[i + 1].y);
      stormCast(state, ev, p, c.tx, c.ty);
      return true;
    }
    case 'a_overload': {
      const skill = SKILL_BY_ID[skillId];
      if (skill.shape.kind !== 'chain') return false;
      const m = attuneMult(p, skillId);
      const jumps = skill.shape.jumps + (has(p, 'a_fork') ? 1 : 0) + (attuned(p, skillId) ? 2 : 0);
      const c = chain(state, ev, p, skillId, hitDamage(state, p, skillId, 'storm').mul(m), skill.shape.range, skill.shape.jumpRange, jumps);
      for (let i = 0; i < c.pts.length - 1; i++) castEv(ev, p, 'a_chain_link', c.pts[i].x, c.pts[i].y, c.pts[i + 1].x, c.pts[i + 1].y);
      const end = c.pts[c.pts.length - 1];
      castEv(ev, p, skillId, p.x, p.y, c.pts.length > 1 ? end.x : c.tx, c.pts.length > 1 ? end.y : c.ty);
      if (c.last) {
        const bx = c.last.x, by = c.last.y;
        const hits = hitArea(state, ev, bx, by, 2.5, baseHit(state, p, 'storm').mul(B('1.5')).mul(m), { dtype: 'storm', srcSlot: p.slot, skillId: 'a_overload_burst', allowCrit: true, stagger: 60, generation: 1 });
        for (const { e } of hits) if (isLive(e)) knockback(state, e, bx, by, 1.2);
        castEv(ev, p, 'a_overload_burst', bx, by, 2.5, 0);
      }
      stormCast(state, ev, p, c.tx, c.ty);
      return true;
    }
    case 'a_ball_lightning': {
      state.hazards.push(makeHazard(state, {
        kind: 'a_ball', owner: 'player', ownerId: p.slot, x: p.x + p.aimX * 0.6, y: p.y + p.aimY * 0.6, dx: p.aimX, dy: p.aimY, speed: 3.5, radius: 3,
        untilTick: tick + ticks(2.6), nextTick: tick + 6, interval: 15, damage: hitDamage(state, p, skillId, 'storm').mul(attuneMult(p, skillId)), dtype: 'storm',
      }));
      castEv(ev, p, skillId, p.x, p.y, p.aimX, p.aimY);
      stormCast(state, ev, p, p.x + p.aimX * 4, p.y + p.aimY * 4);
      return true;
    }
    case 'a_meteor': {
      const skill = SKILL_BY_ID[skillId];
      const [tx, ty] = aimPoint(state, p, 8, 1, false);
      state.hazards.push(makeHazard(state, {
        kind: 'a_meteor', owner: 'player', ownerId: p.slot, x: tx, y: ty, radius: 2.4, nextTick: tick + 42, untilTick: tick + 43, interval: 9999,
        damage: hitDamage(state, p, skillId, 'ember').mul(attuneMult(p, skillId)), dtype: 'ember', dot: skill.dot,
      }));
      castEv(ev, p, skillId, p.x, p.y, tx, ty);
      return true;
    }
    case 'a_flame_wall': {
      if (!state.map) return false;
      const skill = SKILL_BY_ID[skillId];
      const [cx, cy] = aimPoint(state, p, 6, 2);
      const px = -p.aimY, py = p.aimX;
      const la = Math.max(0.5, rayDistance(state.map, cx, cy, px, py, 3) - 0.1);
      const lb = Math.max(0.5, rayDistance(state.map, cx, cy, -px, -py, 3) - 0.1);
      state.hazards.push(makeHazard(state, {
        kind: 'a_flamewall', owner: 'player', ownerId: p.slot, x: cx - px * lb, y: cy - py * lb, dx: px, dy: py, length: la + lb, width: 1.2,
        untilTick: tick + ticks(5), nextTick: tick + 1, interval: 24, damage: hitDamage(state, p, skillId, 'ember').mul(attuneMult(p, skillId)), dtype: 'ember', dot: skill.dot,
      }));
      castEv(ev, p, skillId, p.x, p.y, cx, cy);
      return true;
    }
    case 'a_blink_strike': {
      const dmg = hitDamage(state, p, skillId, 'astral');
      const burst = (x: number, y: number) => {
        const hits = hitArea(state, ev, x, y, 2, dmg, { dtype: 'astral', srcSlot: p.slot, skillId, allowCrit: true, stagger: 40 });
        for (const { e } of hits) if (isLive(e)) knockback(state, e, x, y, 1);
      };
      const fx = p.x, fy = p.y;
      const [nx, ny] = aimPoint(state, p, 6, 1);
      burst(fx, fy);
      teleport(state, ev, p, nx, ny);
      burst(p.x, p.y);
      eventHorizon(state, p);
      castEv(ev, p, skillId, p.x, p.y, fx, fy);
      return true;
    }
    case 'a_rift_gate': {
      if (!state.map) return false;
      const fx = p.x, fy = p.y;
      const [tx, ty] = aimPoint(state, p, 8, 2, false);
      const vx = tx - fx, vy = ty - fy, d = Math.sqrt(vx * vx + vy * vy);
      const [ux, uy] = d > 1e-6 ? [vx / d, vy / d] : [p.aimX, p.aimY];
      const dmg = hitDamage(state, p, skillId, 'astral');
      for (const h of state.hazards) if (h.kind === 'a_gate' && h.ownerId === p.slot) h.untilTick = tick;   // one pair per Arcanist
      const gate = (x: number, y: number, dx: number, dy: number) => makeHazard(state, {
        kind: 'a_gate', owner: 'player', ownerId: p.slot, x, y, dx, dy, length: d, radius: 1.5, untilTick: tick + ticks(8), nextTick: tick + 30, interval: 30, damage: dmg, dtype: 'astral',
      });
      state.hazards.push(gate(fx, fy, ux, uy), gate(tx, ty, -ux, -uy));
      const [ax, ay] = nearestFloor(state.map, tx + ux * 0.9, ty + uy * 0.9);
      teleport(state, ev, p, ax, ay);
      p.vars.ar_gateCd = tick + 60;
      eventHorizon(state, p);
      castEv(ev, p, skillId, fx, fy, tx, ty);
      return true;
    }
    case 'a_astral_nova': {
      if (has(p, 'a_singularity')) {
        const [tx, ty] = aimPoint(state, p, 7, 1, false);
        state.hazards.push(makeHazard(state, {
          kind: 'a_singularity', owner: 'player', ownerId: p.slot, x: tx, y: ty, radius: 3, untilTick: tick + ticks(1.5) + 1, nextTick: tick + 1, interval: 15, outer: 0,
          damage: hitDamage(state, p, 'a_astral_nova', 'astral').mul(B('0.1')), dtype: 'astral',
        }));
        castEv(ev, p, 'a_singularity', p.x, p.y, tx, ty);
        return true;
      }
      if (has(p, 'a_pyroclasm')) {
        const nova = SKILL_BY_ID['a_astral_nova'];
        const R = nova.shape.kind === 'circle' ? nova.shape.radius : 3;
        const hits = hitArea(state, ev, p.x, p.y, R, hitDamage(state, p, 'a_astral_nova', 'ember').mul(B('1.3')), {
          dtype: 'ember', srcSlot: p.slot, skillId: 'a_astral_nova', allowCrit: true, stagger: 120, dot: { type: 'ember', fractionPerSec: '0.4', durationSec: 4 },
        });
        for (const { e } of hits) if (isLive(e)) knockback(state, e, p.x, p.y, nova.knockback ?? 1.1);
        const spark = SKILL_BY_ID['a_spark'];
        if (spark.shape.kind === 'projectile') {
          const sd = hitDamage(state, p, 'a_spark', 'ember');
          for (let i = 0; i < 8; i++) {
            const a = (i * Math.PI) / 4;
            spawnProj(state, p, { kind: 'spark', x: p.x, y: p.y, dx: Math.cos(a), dy: Math.sin(a), speed: spark.shape.speed, radius: spark.shape.radius, range: spark.shape.range, damage: sd, dtype: 'ember', pierce: 0, skillId: 'a_spark', dot: spark.dot });
          }
        }
        castEv(ev, p, 'a_pyroclasm', p.x, p.y, R, 0);
        return true;
      }
      return undefined;
    }
  }
  return undefined;
}

// ---------------- hazards ----------------

function stepHazard(state: SimState, ev: SimEvent[], h: Hazard): boolean | undefined {
  const p = state.players[h.ownerId];
  switch (h.kind) {
    case 'a_meteor': {
      if (state.tick < h.nextTick) return true;
      h.untilTick = state.tick;
      const hits = hitArea(state, ev, h.x, h.y, h.radius, h.damage, { dtype: 'ember', srcSlot: h.ownerId, skillId: 'a_meteor', allowCrit: true, dot: h.dot, stagger: 140 });
      for (const { e } of hits) if (isLive(e)) knockback(state, e, h.x, h.y, 1.5);
      if (p) {
        state.hazards.push(makeHazard(state, {
          kind: 'a_crater', owner: 'player', ownerId: p.slot, x: h.x, y: h.y, radius: 2, untilTick: state.tick + ticks(3), nextTick: state.tick + 30, interval: 30,
          damage: baseHit(state, p, 'ember').mul(B('0.4')), dtype: 'ember', dot: { type: 'ember', fractionPerSec: '0.25', durationSec: 3 },
        }));
        castEv(ev, p, 'a_meteor_impact', h.x, h.y, h.radius, 0);
      }
      return true;
    }
    case 'a_crater': {
      if (state.tick < h.nextTick) return true;
      h.nextTick = state.tick + h.interval;
      hitArea(state, ev, h.x, h.y, h.radius, h.damage, { dtype: 'ember', srcSlot: h.ownerId, skillId: 'a_crater', allowCrit: false, dot: h.dot });
      return true;
    }
    case 'a_flamewall': {
      if (state.tick < h.nextTick) return true;
      h.nextTick = state.tick + h.interval;
      const cx = h.x + h.dx * h.length / 2, cy = h.y + h.dy * h.length / 2;
      const nx = h.dy, ny = -h.dx;   // wall normal (the caster's aim)
      for (const e of state.enemies) {
        if (!isLive(e) || !inLine(h.x, h.y, h.dx, h.dy, h.length, h.width / 2, e.x, e.y, e.radius)) continue;
        hitEnemy(state, ev, e, h.damage, ONE, { dtype: 'ember', srcSlot: h.ownerId, skillId: 'a_flame_wall', fromX: cx, fromY: cy, coverage: areaCoverage(e, h.width), allowCrit: true, dot: h.dot });
        const side = (e.x - cx) * nx + (e.y - cy) * ny >= 0 ? 1 : -1;
        if (isLive(e)) pushEnemy(state, e, nx * side, ny * side, 0.35);
      }
      return true;
    }
    case 'a_ball': {
      if (!state.map) return true;
      const step = h.speed * DT;
      if (rayDistance(state.map, h.x, h.y, h.dx, h.dy, step + 0.3) >= step + 0.3) { h.x += h.dx * step; h.y += h.dy * step; }
      if (state.tick < h.nextTick) return true;
      h.nextTick = state.tick + h.interval;
      for (const e of enemiesNear(state, h.x, h.y, h.radius).slice(0, 3)) {
        hitEnemy(state, ev, e, h.damage, ONE, { dtype: 'storm', srcSlot: h.ownerId, skillId: 'a_ball_lightning', fromX: h.x, fromY: h.y, allowCrit: true });
        if (p) castEv(ev, p, 'a_ball_zap', h.x, h.y, e.x, e.y);
      }
      return true;
    }
    case 'a_gate': {
      if (!state.map) return true;
      const ox = h.x + h.dx * h.length, oy = h.y + h.dy * h.length;
      for (const a of state.players) {
        if (a.lifeState !== 'alive' || (a.x - h.x) ** 2 + (a.y - h.y) ** 2 > 0.55 * 0.55 || state.tick < (a.vars.ar_gateCd ?? 0)) continue;
        let [ex, ey] = norm(a.vx, a.vy);
        if (ex === 0 && ey === 0) { ex = -h.dx; ey = -h.dy; }
        const [x, y] = nearestFloor(state.map, ox + ex * 0.9, oy + ey * 0.9);
        teleport(state, ev, a, x, y);
        a.vars.ar_gateCd = state.tick + 60;
      }
      if (state.tick >= h.nextTick) {
        h.nextTick = state.tick + h.interval;
        const hits = hitArea(state, ev, h.x, h.y, h.radius, h.damage, { dtype: 'astral', srcSlot: h.ownerId, skillId: 'a_rift_gate', allowCrit: false });
        for (const { e } of hits) if (isLive(e)) pullToward(state, e, h.x, h.y, 0.15);
      }
      return true;
    }
    case 'a_echo': {
      if (state.tick < h.nextTick) return true;
      h.untilTick = state.tick;
      const hits = hitArea(state, ev, h.x, h.y, h.radius, h.damage, { dtype: 'astral', srcSlot: h.ownerId, skillId: 'a_astral_echo', allowCrit: true, stagger: 50, generation: 1 });
      for (const { e } of hits) if (isLive(e)) pushEnemy(state, e, e.x - h.x, e.y - h.y, 1);
      if (p) castEv(ev, p, 'a_echo_burst', h.x, h.y, h.radius, 0);
      return true;
    }
    case 'a_singularity': {
      if (state.tick >= h.untilTick - 1) {
        if (h.outer === 0 && p) {
          h.outer = 1;
          hitArea(state, ev, h.x, h.y, h.radius, hitDamage(state, p, 'a_astral_nova', 'astral'), { dtype: 'astral', srcSlot: p.slot, skillId: 'a_astral_nova', allowCrit: true, stagger: 120 });
          castEv(ev, p, 'a_singularity_collapse', h.x, h.y, h.radius, 0);
        }
        return true;
      }
      for (const e of enemiesNear(state, h.x, h.y, h.radius + 1.5)) pullToward(state, e, h.x, h.y, 0.06);
      if (state.tick >= h.nextTick) {
        h.nextTick = state.tick + h.interval;
        hitArea(state, ev, h.x, h.y, h.radius, h.damage, { dtype: 'astral', srcSlot: h.ownerId, skillId: 'a_singularity', allowCrit: false, stagger: 15 });
      }
      return true;
    }
    case 'a_combust': {
      if (state.tick < h.nextTick) return true;
      h.untilTick = state.tick;
      hitArea(state, ev, h.x, h.y, h.radius, h.damage, { dtype: 'ember', srcSlot: h.ownerId, skillId: 'a_combustion', allowCrit: false, dot: h.dot, generation: 1 });
      if (p) castEv(ev, p, 'a_combustion', h.x, h.y, h.radius, 0);
      return true;
    }
  }
  return undefined;
}

function lastTeleport(ev: SimEvent[], slot: number) {
  for (let i = ev.length - 1; i >= 0; i--) { const e = ev[i]; if (e.t === 'teleport' && e.slot === slot) return e; }
  return undefined;
}

// ---------------- hooks ----------------

const arcanistHooks: SimHooks = {
  castSkill,
  hazardTick: stepHazard,

  basicAttack(state, ev, p, k) {
    if (!has(p, 'a_conflagration')) return undefined;
    const spark = SKILL_BY_ID['a_spark'];
    if (spark.shape.kind !== 'projectile') return undefined;
    castEv(ev, p, 'a_spark', p.x, p.y, p.aimX, p.aimY, k.gt(ONE) ? k.toCompact() : undefined);
    spawnPlayerProjectiles(state, ev, p, { ...spark, shape: { ...spark.shape, pierce: spark.shape.pierce + 1 } }, k.mul(playerDerived(state, p).projectileCount), hitDamage(state, p, 'a_spark', 'ember'), 'spark');
    return true;
  },

  extraCharges(p, skillId) {
    let n = 0;
    if (RIFT.has(skillId) && has(p, 'a_riftwalker')) n += 2;
    if ((skillId === 'a_blink_strike' || skillId === 'a_rift_gate') && has(p, 'a_temporal_reserve')) n += 1;   // inline covers a_phase_step
    return n;
  },

  onCast(state, ev, p, skillId) {
    if (has(p, 'a_attunement')) {
      const next = STORM.has(skillId) ? 1 : EMBER.has(skillId) ? 2 : 0;
      if (next && next !== (p.vars.ar_att ?? 0)) castEv(ev, p, 'a_attune', p.x, p.y, next, 0);
      if (next) p.vars.ar_att = next;
    }
    if (RIFT.has(skillId)) {
      const tp = lastTeleport(ev, p.slot);
      if (!tp) return;
      if (has(p, 'a_astral_echo')) {
        state.hazards.push(makeHazard(state, {
          kind: 'a_echo', owner: 'player', ownerId: p.slot, x: tp.fx, y: tp.fy, radius: 2.2, nextTick: state.tick + 45, untilTick: state.tick + 46,
          interval: 9999, damage: baseHit(state, p, 'astral').mul(B('1.5')), dtype: 'astral', generation: 1,
        }));
      }
      if (has(p, 'a_riftwalker')) {
        const a0 = Math.atan2(p.aimY, p.aimX);
        const dmg = baseHit(state, p, 'astral').mul(B('0.6'));
        for (let i = 0; i < 6; i++) {
          const a = a0 + (i * Math.PI) / 3;
          spawnProj(state, p, { kind: 'a_shard', x: tp.x, y: tp.y, dx: Math.cos(a), dy: Math.sin(a), speed: 11, radius: 0.25, range: 6, damage: dmg, dtype: 'astral', pierce: 1, skillId: 'a_rift_shard' });
        }
      }
    }
  },

  onEnemyHit(state, ev, p, e, info) {
    if (!p || p.classId !== CID || info.generation !== 0) return;
    if (info.crit && info.dtype === 'storm' && has(p, 'a_thunderstrike')) {
      hitArea(state, ev, e.x, e.y, 1.5, baseHit(state, p, 'storm'), { dtype: 'storm', srcSlot: p.slot, skillId: 'a_thunderstrike', allowCrit: false, stagger: 30, generation: 1 });
      castEv(ev, p, 'a_thunderstrike', e.x, e.y, 1.5, 0);
    }
    if (has(p, 'a_conflagration') && e.burning && isLive(e) && !(e.vulnUntil > state.tick && Number(e.vulnFactor) > 1.12)) {
      e.vulnUntil = state.tick + ticks(2);
      e.vulnFactor = '1.12';
    }
  },

  onPlayerTick(state, ev, p) {
    if (has(p, 'a_stormcaller') && (state.tick + p.slot * 11) % 72 === 0) {
      const cands = enemiesNear(state, p.x, p.y, 7);
      if (cands.length) {
        const t = cands[Math.min(cands.length - 1, Math.floor(nextFloat(state.rng.combat) * cands.length))];
        hitArea(state, ev, t.x, t.y, 1.2, baseHit(state, p, 'storm'), { dtype: 'storm', srcSlot: p.slot, skillId: 'a_stormcaller', allowCrit: true, generation: 1 });
        castEv(ev, p, 'a_stormcaller', t.x, t.y, 1.2, 0);
      }
    }
  },

  onRoundStart(state) {
    for (const p of state.players) if (p.classId === CID) clearVars(p, 'ar_');
  },
};

/** Combustion applies to burning enemies whoever lands the kill (co-op). */
const combustionHooks: SimHooks = {
  onKill(state, ev, e) {
    if (!e.burning) return;
    const owner = state.players.find((a) => a.classId === CID && has(a, 'a_combustion'));
    if (!owner) return;
    state.hazards.push(makeHazard(state, {
      kind: 'a_combust', owner: 'player', ownerId: owner.slot, x: e.x, y: e.y, radius: 2, nextTick: state.tick + 12, untilTick: state.tick + 13,
      interval: 9999, damage: baseHit(state, owner, 'ember'), dtype: 'ember', dot: { type: 'ember', fractionPerSec: '0.3', durationSec: 3 }, generation: 1,
    }));
  },
};

registerClassHooks(CID, arcanistHooks);
registerGlobalHooks(combustionHooks);
