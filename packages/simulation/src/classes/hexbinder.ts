import { Big } from '@cursebound/numeric';
import { RULES, SKILL_BY_ID } from '@cursebound/content';
import { addDot, healPlayer, hitEnemy, mitigationFactor } from '../combat';
import { arrived, followStep, ownerSlot, routeStep, trackStuck } from '../follow';
import { registerClassHooks, registerGlobalHooks, type SimHooks } from '../hooks';
import { inLine, moveCircle, norm, rayDistance } from '../geometry';
import { areaCoverage, cutCooldowns, knockback, makeHazard, spawnPlayerProjectiles } from '../players';
import { B, ONE, hitDamage, playerDerived, toFloatClamped, treeFactor } from '../stats';
import type { EnemyState, Hazard, PlayerState, SimEvent, SimState } from '../types';
import {
  DT, ZERO, addShieldQuiet, aimPoint, baseHit, castEv, coef, enemiesNear, enemyById, fracStr, has, hitArea, isLive,
  nearestEnemy, pullToward, rank, spawnProj, steerProjectile, ticks,
} from './kitHelpers';

// Hexbinder kit (content: packages/content/src/classes/hexbinder.ts). Decay damage, rot stacks (each separate decay
// dot entry from a player on an enemy is one stack), blood heals/shields and spirit hazards.
//
// Hazard kinds:   hx_tide (Grave Tide wave), hx_plague (Plague Cloud), hx_bloom (Blightbloom), hx_swarm (Locust Swarm),
//                 hx_corpse (Corpse Bloom fuse), hx_tether (Blood Tether: x,y = caster, dx,dy,length = vector to target),
//                 hx_wraith / hx_banshee / hx_legion / hx_lesser (summons; dx,dy = facing), hx_soul (orbiting Soul).
// Projectiles:    hx_bolt (Hex Bolt), hx_spirit (homing spirit), hx_seed (homing Blightbloom seed), hx_lance (Sanguine Lance).
// Cast events:    skill ids, plus h_contagion (x,y -> dx,dy link), h_corpse_bloom, h_rupture, h_exsanguinate, h_hemorrhage_t
//                 (target x,y -> caster dx,dy), h_blightbloom_burst, h_banshee_shriek, h_death_knell, h_blood_price,
//                 h_blood_sacrament. Target-point skills (plague cloud, blightbloom, locust swarm, tether) carry the
//                 target point in dx/dy.

const CID = 'hexbinder';
const BLOOD = new Set(['h_blood_tether', 'h_hemorrhage', 'h_sanguine_lance']);
const SPIRIT = new Set(['h_summon_wraith', 'h_banshee', 'h_grave_legion', 'h_lesser_wraith', 'h_spirit', 'h_soul_strike', 'h_death_knell']);
const WRAITH_KINDS: Record<string, { skill: string; speed: number; reach: number; interval: number; dur: number; max: number }> = {
  hx_wraith: { skill: 'h_summon_wraith', speed: 5.5, reach: 1.2, interval: 36, dur: 8, max: 2 },
  hx_banshee: { skill: 'h_banshee', speed: 4.5, reach: 1.0, interval: 36, dur: 7, max: 1 },
  hx_legion: { skill: 'h_grave_legion', speed: 6.5, reach: 1.0, interval: 30, dur: 6, max: 3 },
  hx_lesser: { skill: 'h_lesser_wraith', speed: 6, reach: 1.0, interval: 36, dur: 4, max: 4 },
};
/** Collision radius summons walk with (h.radius is their strike reach). */
const WRAITH_BODY = 0.3;
const SOUL_MAX = 6;
/** Blood Price: every cast costs `hp` of max health and cooldowns are x`cd` while paying leaves the hero above `floor`. */
const BLOOD_PRICE = { hp: 0.03, cd: 0.7, floor: 0.35 } as const;
const bloodPriceActive = (p: PlayerState) => has(p, 'h_blood_price') && p.hp.ratio(p.maxHp) - BLOOD_PRICE.hp > BLOOD_PRICE.floor;

// ---------------- damage, rot and healing ----------------

const spiritFactor = (p: PlayerState) => treeFactor(p, 'skill.h_summon_wraith.damage').factor;

function lustStacks(state: SimState, p: PlayerState): number {
  return state.tick < (p.vars.hx_lustUntil ?? 0) ? (p.vars.hx_lust ?? 0) : 0;
}

function soulsOf(state: SimState, p: PlayerState): Hazard[] {
  return state.hazards.filter((h) => h.kind === 'hx_soul' && h.owner === 'player' && h.ownerId === p.slot && h.untilTick > state.tick);
}

/** Conditional damage multipliers (Crimson Frenzy, Bloodlust, Soul Eater, Crimson Covenant). */
function dmgMult(state: SimState, p: PlayerState, tag: string): Big {
  let m = ONE;
  if (has(p, 'h_crimson_frenzy') && p.hp.ratio(p.maxHp) < 0.5) m = m.mul(B('1.25'));
  const lust = lustStacks(state, p);
  if (lust > 0) m = m.mul(B('1.07').powInt(lust));
  if (has(p, 'h_soul_eater')) { const s = Math.min(SOUL_MAX, soulsOf(state, p).length); if (s > 0) m = m.mul(B('1.06').powInt(s)); }
  if (has(p, 'h_crimson_covenant') && BLOOD.has(tag) && !p.shield.isZero()) m = m.mul(B('1.3'));
  return m;
}

/** Damage of a real Hexbinder skill (coefficient and skill-scoped tree factors from content). */
function skillDmg(state: SimState, p: PlayerState, skillId: string): Big {
  let d = hitDamage(state, p, skillId, 'decay');
  if (SPIRIT.has(skillId) && skillId !== 'h_summon_wraith') d = d.mul(spiritFactor(p));
  return d.mul(dmgMult(state, p, skillId));
}

/** Damage of a derived effect: coefficient × class base decay hit. */
function coefDmg(state: SimState, p: PlayerState, c: string, tag: string): Big {
  let d = baseHit(state, p, 'decay').mul(B(c));
  if (SPIRIT.has(tag)) d = d.mul(spiritFactor(p));
  return d.mul(dmgMult(state, p, tag));
}

function rotDot(p: PlayerState, frac: number, dur: number) {
  const f = frac * (has(p, 'h_black_death') ? 1.25 : 1);
  return { type: 'decay' as const, fractionPerSec: fracStr(f), durationSec: dur + rank(p, 'h_lingering_rot') };
}

function rotStacks(state: SimState, e: EnemyState, slot: number): number {
  let n = 0;
  for (const d of e.dots) if (d.src === slot && d.type === 'decay' && d.until > state.tick) n++;
  return n;
}

/** Pre-mitigation decay damage still to come from `slot`'s rot on `e`. */
function remainingRot(state: SimState, e: EnemyState, slot: number): Big {
  let total = ZERO;
  for (const d of e.dots) {
    if (d.src !== slot || d.type !== 'decay' || d.until <= state.tick) continue;
    total = total.add(d.perSec.mul(Big.from(d.until - state.tick)).div(B(60)));
  }
  return total;
}

function rotRate(state: SimState, e: EnemyState, slot: number): Big {
  let total = ZERO;
  for (const d of e.dots) if (d.src === slot && d.type === 'decay' && d.until > state.tick) total = total.add(d.perSec);
  return total;
}

function shieldSoft(state: SimState, ev: SimEvent[], p: PlayerState, amount: Big) {
  const gain = addShieldQuiet(state, p, amount);
  if (gain.isZero()) return;
  if (state.tick >= (p.vars.hx_shEv ?? 0)) { ev.push({ t: 'shield', slot: p.slot, amount: gain.toCompact() }); p.vars.hx_shEv = state.tick + 30; }
}

/** Heal (×player healing); with Blood Ward the overflow becomes a blood shield. */
function hxHeal(state: SimState, ev: SimEvent[], p: PlayerState, amount: Big) {
  if (amount.isZero() || p.lifeState !== 'alive') return;
  const eff = amount.mul(playerDerived(state, p).healing);
  const missing = p.maxHp.sub(p.hp);
  healPlayer(state, ev, p, amount);
  if (has(p, 'h_blood_ward') && eff.gt(missing)) shieldSoft(state, ev, p, eff.sub(missing));
}

/** Blood (no resource): cut `sec` from the remaining cooldown of one skill (`skillId`) or of every recharging skill. */
function gainBlood(p: PlayerState, sec: number, skillId?: string) {
  if (!skillId) { cutCooldowns(p, sec); return; }
  const s = p.skills.find((x) => x.skillId === skillId);
  if (s && s.charges < s.maxCharges) s.cooldown -= sec;
}

function spawnSpirit(state: SimState, p: PlayerState, x: number, y: number, dx: number, dy: number, mult: string) {
  spawnProj(state, p, {
    kind: 'hx_spirit', x, y, dx, dy, speed: 8, radius: 0.3, range: 10, damage: coefDmg(state, p, '0.8', 'h_spirit').mul(B(mult)),
    dtype: 'decay', pierce: 0, skillId: 'h_spirit',
  });
}

// ---------------- summons ----------------

function summon(state: SimState, ev: SimEvent[], p: PlayerState, kind: string, x: number, y: number, damage: Big) {
  const cfg = WRAITH_KINDS[kind];
  const mine = state.hazards.filter((h) => h.kind === kind && h.owner === 'player' && h.ownerId === p.slot && h.untilTick > state.tick + 1)
    .sort((a, b) => a.bornTick - b.bornTick || a.id - b.id);
  for (let i = 0; i <= mine.length - cfg.max; i++) mine[i].untilTick = state.tick + 1;   // oldest fades (Death Knell still fires)
  const [fx, fy] = norm(p.aimX, p.aimY);
  state.hazards.push(makeHazard(state, {
    kind, owner: 'player', ownerId: p.slot, x, y, dx: fx || 1, dy: fy, radius: cfg.reach, speed: cfg.speed * RULES.minionMoveSpeedMult,
    untilTick: state.tick + ticks(cfg.dur), nextTick: state.tick + 18, interval: cfg.interval, inner: state.tick + 30, outer: 0,
    damage, dtype: 'decay',
  }));
  castEv(ev, p, kind === 'hx_lesser' ? 'h_lesser_wraith' : cfg.skill, x, y, fx, fy);
}

function nearPlayer(state: SimState, p: PlayerState, ox: number, oy: number): [number, number] {
  if (!state.map) return [p.x + ox, p.y + oy];
  const r = moveCircle(state.map, p.x, p.y, ox, oy, 0.3);
  return [r.x, r.y];
}

function stepWraith(state: SimState, ev: SimEvent[], h: Hazard, p: PlayerState | undefined) {
  const cfg = WRAITH_KINDS[h.kind];
  if (!p || !state.map) { h.untilTick = state.tick; return; }
  if (state.tick >= h.untilTick - 1) {
    if (h.outer === 0) {
      h.outer = 1;
      if (has(p, 'h_death_knell')) {
        hitArea(state, ev, h.x, h.y, 2.2, coefDmg(state, p, '1.5', 'h_death_knell'), { dtype: 'decay', srcSlot: p.slot, skillId: 'h_death_knell', allowCrit: true, generation: 1 });
        spawnSpirit(state, p, h.x, h.y, h.dx - h.dy, h.dy + h.dx, '1');
        spawnSpirit(state, p, h.x, h.y, h.dx + h.dy, h.dy - h.dx, '1');
        castEv(ev, p, 'h_death_knell', h.x, h.y, 2.2, 0);
      }
    }
    return;
  }
  // Movement routes around walls and chasm voids (follow.ts): a foe it cannot reach is skipped for a moment; with no
  // foe it keeps its spot around the Hexbinder and blinks back when cut off or stuck.
  const v = (h.vars ??= {});
  const speed = cfg.speed * RULES.minionMoveSpeedMult;
  const ox = h.x, oy = h.y;
  const target = nearestEnemy(state, h.x, h.y, 9, (v.unrT ?? 0) > state.tick ? [v.unr] : undefined);
  if (target) {
    const stopAt = Math.max(0.2, target.radius + h.radius * 0.5);
    const d = Math.sqrt((target.x - h.x) ** 2 + (target.y - h.y) ** 2);
    if (d > stopAt) {
      const res = routeStep(state, h, target.x, target.y, Math.min(speed * DT, d - stopAt), WRAITH_BODY);
      const strikes = res === 'fail' ? 2 : trackStuck(state, h, target.x, target.y, Math.sqrt((target.x - h.x) ** 2 + (target.y - h.y) ** 2));
      if (strikes >= 2) { v.unr = target.id; v.unrT = state.tick + ticks(1.5); arrived(h); }
    } else arrived(h);
  } else {
    const a = (h.id % 6) * 1.0472;
    const [sx, sy] = ownerSlot(state, p, Math.cos(a) * 1.4, Math.sin(a) * 1.4, WRAITH_BODY);
    followStep(state, ev, h, p, sx, sy, speed, WRAITH_BODY, 0.15);
  }
  const mx = h.x - ox, my = h.y - oy, ml = Math.sqrt(mx * mx + my * my);
  if (ml > 1e-4 && ml < 2) { h.dx = mx / ml; h.dy = my / ml; }   // face the way it walked (not across a blink)
  if (target && state.tick >= h.nextTick && (target.x - h.x) ** 2 + (target.y - h.y) ** 2 <= (h.radius + target.radius) ** 2) {
    const slash = h.kind === 'hx_banshee' ? h.damage.mul(B('0.5')) : h.damage;
    hitArea(state, ev, h.x, h.y, h.radius, slash, { dtype: 'decay', srcSlot: p.slot, skillId: cfg.skill, allowCrit: true, dot: rotDot(p, 0.15, 3) });
    h.nextTick = state.tick + h.interval;
  }
  if (h.kind === 'hx_banshee' && state.tick >= h.inner && enemiesNear(state, h.x, h.y, 3).length > 0) {
    h.inner = state.tick + 90;
    const hits = hitArea(state, ev, h.x, h.y, 3, h.damage, { dtype: 'decay', srcSlot: p.slot, skillId: 'h_banshee', allowCrit: true, stagger: 40 });
    for (const { e } of hits) if (isLive(e)) knockback(state, e, h.x, h.y, 1.2);
    castEv(ev, p, 'h_banshee_shriek', h.x, h.y, 3, 0);
  }
}

function addSoul(state: SimState, p: PlayerState, x: number, y: number) {
  const souls = soulsOf(state, p).sort((a, b) => a.bornTick - b.bornTick || a.id - b.id);
  if (souls.length >= SOUL_MAX) { souls[0].untilTick = state.tick + ticks(10); return; }
  state.hazards.push(makeHazard(state, { kind: 'hx_soul', owner: 'player', ownerId: p.slot, x, y, radius: 0.45, untilTick: state.tick + ticks(10), nextTick: state.tick, interval: 24, damage: ZERO, dtype: 'decay' }));
}

function stepSoul(state: SimState, ev: SimEvent[], h: Hazard, p: PlayerState | undefined) {
  if (!p) { h.untilTick = state.tick; return; }
  const souls = soulsOf(state, p);
  const i = Math.max(0, souls.indexOf(h)), n = Math.max(1, souls.length);
  const a = state.tick * 0.06 + (i * Math.PI * 2) / n;
  const tx = p.x + Math.cos(a) * 1.3, ty = p.y + Math.sin(a) * 1.3;
  h.x += (tx - h.x) * 0.25; h.y += (ty - h.y) * 0.25;
  if (has(p, 'h_spirit_ward') && p.lifeState === 'alive' && state.tick >= h.nextTick) {
    const hits = hitArea(state, ev, h.x, h.y, h.radius, coefDmg(state, p, '0.35', 'h_soul_strike'), { dtype: 'decay', srcSlot: p.slot, skillId: 'h_soul_strike', allowCrit: true, fromX: p.x, fromY: p.y });
    if (hits.length) h.nextTick = state.tick + h.interval;
  }
}

// ---------------- hazards ----------------

function stepHazard(state: SimState, ev: SimEvent[], h: Hazard): boolean | undefined {
  const p = state.players[h.ownerId];
  switch (h.kind) {
    case 'hx_tide': {
      if (!state.map) return true;
      const step = h.speed * DT;
      if (rayDistance(state.map, h.x, h.y, h.dx, h.dy, step + 0.2) < step) h.untilTick = state.tick;   // breaks on walls
      else { h.x += h.dx * step; h.y += h.dy * step; }
      for (const e of state.enemies) {
        if (!isLive(e) || h.hitSlots.includes(e.id)) continue;
        if (!inLine(h.x - h.dx * 0.7, h.y - h.dy * 0.7, h.dx, h.dy, 1.4, h.width / 2, e.x, e.y, e.radius)) continue;
        h.hitSlots.push(e.id);
        const res = hitEnemy(state, ev, e, h.damage, ONE, {
          dtype: 'decay', srcSlot: h.ownerId, skillId: 'h_grave_tide', fromX: h.x - h.dx, fromY: h.y - h.dy,
          coverage: areaCoverage(e, h.width / 2), allowCrit: true, dot: h.dot, stagger: 120,
        });
        if (isLive(e)) knockback(state, e, e.x - h.dx, e.y - h.dy, 0.9);
        if (p && !res.kills.isZero() && h.inner < 6) { h.inner++; spawnSpirit(state, p, e.x, e.y, h.dx, h.dy, '1'); }
      }
      return true;
    }
    case 'hx_plague': {
      if (state.tick < h.nextTick) return true;
      h.nextTick = state.tick + h.interval;
      hitArea(state, ev, h.x, h.y, h.radius, h.damage, { dtype: 'decay', srcSlot: h.ownerId, skillId: 'h_plague_cloud', allowCrit: true, dot: h.dot });
      return true;
    }
    case 'hx_bloom': {
      if (!p) { h.untilTick = state.tick; return true; }
      if (state.tick >= h.untilTick - 1) {
        if (h.outer === 0) {
          h.outer = 1;
          hitArea(state, ev, h.x, h.y, h.radius, h.damage.mul(B('3')), { dtype: 'decay', srcSlot: p.slot, skillId: 'h_blightbloom', allowCrit: true, dot: h.dot });
          castEv(ev, p, 'h_blightbloom_burst', h.x, h.y, h.radius, 0);
        }
        return true;
      }
      if (state.tick < h.nextTick) return true;
      h.nextTick = state.tick + h.interval;
      for (const e of enemiesNear(state, h.x, h.y, 6).slice(0, 3)) {
        spawnProj(state, p, { kind: 'hx_seed', x: h.x, y: h.y, dx: e.x - h.x, dy: e.y - h.y, speed: 9, radius: 0.25, range: 8, damage: h.damage, dtype: 'decay', pierce: 0, skillId: 'h_blightbloom', dot: h.dot });
      }
      return true;
    }
    case 'hx_swarm': {
      if (!state.map) return true;
      if (h.length > 0) {
        const step = Math.min(h.speed * DT, h.length);
        const r = moveCircle(state.map, h.x, h.y, h.dx * step, h.dy * step, 0.3);
        const moved = Math.abs(r.x - h.x) + Math.abs(r.y - h.y);
        h.x = r.x; h.y = r.y; h.length = moved < step * 0.5 ? 0 : h.length - step;
      } else {
        const t = nearestEnemy(state, h.x, h.y, 7);
        if (t) {
          const vx = t.x - h.x, vy = t.y - h.y, d = Math.sqrt(vx * vx + vy * vy);
          if (d > 0.25) {
            const step = Math.min(6 * RULES.minionMoveSpeedMult * DT, d - 0.2);   // the swarm's hunting drift is summon movement
            const r = moveCircle(state.map, h.x, h.y, (vx / d) * step, (vy / d) * step, 0.3);
            h.x = r.x; h.y = r.y; h.dx = vx / d; h.dy = vy / d;
          }
        }
      }
      if (state.tick >= h.nextTick) {
        h.nextTick = state.tick + h.interval;
        hitArea(state, ev, h.x, h.y, h.radius, h.damage, { dtype: 'decay', srcSlot: h.ownerId, skillId: 'h_locust_swarm', allowCrit: true, dot: h.dot });
      }
      return true;
    }
    case 'hx_corpse': {
      if (state.tick < h.nextTick) return true;
      h.untilTick = state.tick;
      hitArea(state, ev, h.x, h.y, h.radius, h.damage, { dtype: 'decay', srcSlot: h.ownerId, skillId: 'h_corpse_bloom', allowCrit: false, dot: h.dot, generation: 1 });
      if (p) castEv(ev, p, 'h_corpse_bloom', h.x, h.y, h.radius, 0);
      return true;
    }
    case 'hx_tether': {
      const e = enemyById(state, h.hitSlots[0] ?? -1);
      if (!p || p.lifeState !== 'alive' || !e || (e.x - p.x) ** 2 + (e.y - p.y) ** 2 > 64) { h.untilTick = state.tick; return true; }
      const vx = e.x - p.x, vy = e.y - p.y, d = Math.sqrt(vx * vx + vy * vy);
      h.x = p.x; h.y = p.y; h.length = d;
      if (d > 1e-6) { h.dx = vx / d; h.dy = vy / d; }
      if (state.tick >= h.nextTick) {
        h.nextTick = state.tick + h.interval;
        const res = hitEnemy(state, ev, e, h.damage, ONE, { dtype: 'decay', srcSlot: p.slot, skillId: 'h_blood_tether', fromX: p.x, fromY: p.y, allowCrit: true });
        hxHeal(state, ev, p, res.dealt.mul(B('0.3')));
      }
      return true;
    }
    case 'hx_wraith': case 'hx_banshee': case 'hx_legion': case 'hx_lesser':
      stepWraith(state, ev, h, p);
      return true;
    case 'hx_soul':
      stepSoul(state, ev, h, p);
      return true;
  }
  return undefined;
}

// ---------------- skills ----------------

function castSkill(state: SimState, ev: SimEvent[], p: PlayerState, skillId: string): boolean | undefined {
  const tick = state.tick;
  const fetid = treeFactor(p, 'skill.h_plague_cloud.radius').factor.toNumber();
  switch (skillId) {
    case 'h_grave_tide': {
      state.hazards.push(makeHazard(state, {
        kind: 'hx_tide', owner: 'player', ownerId: p.slot, x: p.x + p.aimX * 0.5, y: p.y + p.aimY * 0.5, dx: p.aimX, dy: p.aimY,
        width: 3, length: 8, speed: 7, radius: 1.5, inner: 0, untilTick: tick + ticks(8 / 7) + 1, interval: 1,
        damage: skillDmg(state, p, 'h_grave_tide'), dtype: 'decay', dot: rotDot(p, 0.3, 4),
      }));
      castEv(ev, p, skillId, p.x, p.y, p.aimX, p.aimY);
      return true;
    }
    case 'h_plague_cloud': {
      const [tx, ty] = aimPoint(state, p, 7);
      state.hazards.push(makeHazard(state, {
        kind: 'hx_plague', owner: 'player', ownerId: p.slot, x: tx, y: ty, radius: 2.2 * fetid, untilTick: tick + 15 + ticks(4),
        nextTick: tick + 15, interval: 30, damage: skillDmg(state, p, skillId), dtype: 'decay', dot: rotDot(p, 0.2, 3),
      }));
      castEv(ev, p, skillId, p.x, p.y, tx, ty);
      return true;
    }
    case 'h_blightbloom': {
      const [tx, ty] = aimPoint(state, p, 7);
      state.hazards.push(makeHazard(state, {
        kind: 'hx_bloom', owner: 'player', ownerId: p.slot, x: tx, y: ty, radius: 2.5 * fetid, untilTick: tick + ticks(6), nextTick: tick + 20,
        interval: 45, outer: 0, damage: skillDmg(state, p, skillId), dtype: 'decay', dot: rotDot(p, 0.2, 3),
      }));
      castEv(ev, p, skillId, p.x, p.y, tx, ty);
      return true;
    }
    case 'h_locust_swarm': {
      const [tx, ty] = aimPoint(state, p, 8);
      const vx = tx - p.x, vy = ty - p.y, d = Math.sqrt(vx * vx + vy * vy);
      state.hazards.push(makeHazard(state, {
        kind: 'hx_swarm', owner: 'player', ownerId: p.slot, x: p.x, y: p.y, dx: d > 1e-6 ? vx / d : p.aimX, dy: d > 1e-6 ? vy / d : p.aimY,
        length: d, speed: 7, radius: 1.6 * fetid, untilTick: tick + ticks(5), nextTick: tick + 5, interval: 15,
        damage: skillDmg(state, p, skillId), dtype: 'decay', dot: rotDot(p, 0.15, 3),
      }));
      castEv(ev, p, skillId, p.x, p.y, tx, ty);
      return true;
    }
    case 'h_blood_tether': {
      const want = Math.min(6, Math.max(1, p.aimDist || 6));
      const ax = p.x + p.aimX * want, ay = p.y + p.aimY * want;
      let best: EnemyState | undefined; let bd = Infinity;
      for (const e of enemiesNear(state, p.x, p.y, 6)) {
        const d = (e.x - ax) ** 2 + (e.y - ay) ** 2;
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) return false;
      for (const h of state.hazards) if (h.kind === 'hx_tether' && h.ownerId === p.slot) h.untilTick = tick;
      state.hazards.push(makeHazard(state, {
        kind: 'hx_tether', owner: 'player', ownerId: p.slot, x: p.x, y: p.y, hitSlots: [best.id], untilTick: tick + ticks(3) + 1,
        nextTick: tick + 1, interval: 15, damage: skillDmg(state, p, skillId), dtype: 'decay',
        length: Math.sqrt((best.x - p.x) ** 2 + (best.y - p.y) ** 2), dx: p.aimX, dy: p.aimY,
      }));
      castEv(ev, p, skillId, p.x, p.y, best.x, best.y);
      return true;
    }
    case 'h_hemorrhage': {
      const dmg = skillDmg(state, p, skillId);
      let total = ZERO;
      for (const e of enemiesNear(state, p.x, p.y, 4).slice(0, 6)) {
        const res = hitEnemy(state, ev, e, dmg, ONE, { dtype: 'decay', srcSlot: p.slot, skillId, fromX: p.x, fromY: p.y, allowCrit: true, stagger: 40 });
        total = total.add(res.dealt);
        castEv(ev, p, 'h_hemorrhage_t', e.x, e.y, p.x, p.y);
        if (isLive(e)) pullToward(state, e, p.x, p.y, 1.2);
      }
      hxHeal(state, ev, p, total.mul(B('0.2')));
      castEv(ev, p, skillId, p.x, p.y, p.aimX, p.aimY);
      return true;
    }
    case 'h_sanguine_lance': {
      const s = SKILL_BY_ID[skillId];
      if (s.shape.kind !== 'projectile') return false;
      spawnProj(state, p, { kind: 'hx_lance', x: p.x + p.aimX * 0.4, y: p.y + p.aimY * 0.4, dx: p.aimX, dy: p.aimY, speed: s.shape.speed, radius: s.shape.radius, range: s.shape.range, damage: skillDmg(state, p, skillId), dtype: 'decay', pierce: s.shape.pierce, skillId });
      castEv(ev, p, skillId, p.x, p.y, p.aimX, p.aimY);
      return true;
    }
    case 'h_summon_wraith': {
      const [x, y] = nearPlayer(state, p, p.aimX * 1.0, p.aimY * 1.0);
      summon(state, ev, p, 'hx_wraith', x, y, skillDmg(state, p, skillId));
      return true;
    }
    case 'h_banshee': {
      const [x, y] = nearPlayer(state, p, p.aimX * 1.0, p.aimY * 1.0);
      summon(state, ev, p, 'hx_banshee', x, y, skillDmg(state, p, skillId));
      return true;
    }
    case 'h_grave_legion': {
      for (const h of state.hazards) if (h.kind === 'hx_legion' && h.ownerId === p.slot && h.untilTick > tick + 1) h.untilTick = tick + 1;
      const dmg = skillDmg(state, p, skillId);
      const a0 = Math.atan2(p.aimY, p.aimX);
      for (let i = 0; i < 3; i++) {
        const a = a0 + (i - 1) * 2.0944;
        const [x, y] = nearPlayer(state, p, Math.cos(a) * 1.1, Math.sin(a) * 1.1);
        summon(state, ev, p, 'hx_legion', x, y, dmg);
      }
      return true;
    }
  }
  return undefined;
}

// ---------------- hooks ----------------

const hexHooks: SimHooks = {
  castSkill,

  basicAttack(state, ev, p, k) {
    const skill = SKILL_BY_ID['h_hex_bolt'];
    if (!skill) return undefined;
    const pd = playerDerived(state, p);
    spawnPlayerProjectiles(state, ev, p, { ...skill, dot: rotDot(p, 0.25, 4) }, k.mul(pd.projectileCount), skillDmg(state, p, 'h_hex_bolt'), 'hx_bolt');
    castEv(ev, p, 'h_hex_bolt', p.x, p.y, p.aimX, p.aimY, k.gt(ONE) ? k.toCompact() : undefined);
    if (has(p, 'h_soul_volley')) {
      const c = (p.vars.hx_volley ?? 0) + 1;
      if (c >= 3) {
        p.vars.hx_volley = 0;
        const soul = soulsOf(state, p).sort((a, b) => a.bornTick - b.bornTick || a.id - b.id)[0];
        if (soul) soul.untilTick = state.tick;
        spawnSpirit(state, p, soul ? soul.x : p.x + p.aimX * 0.4, soul ? soul.y : p.y + p.aimY * 0.4, p.aimX, p.aimY, soul ? '2' : '1');
      } else p.vars.hx_volley = c;
    }
    return true;
  },

  hazardTick: stepHazard,

  // Blood Price: while the hero can pay (above BLOOD_PRICE.floor after paying), cooldowns run shorter; onCast pays
  cooldownFactor(state, p) {
    return bloodPriceActive(p) ? BLOOD_PRICE.cd : 1;
  },

  onCast(state, ev, p, skillId) {
    if (bloodPriceActive(p) && SKILL_BY_ID[skillId]?.cooldownSec > 0) {
      const room = p.hp.sub(p.maxHp.mul(coef(BLOOD_PRICE.floor)));
      const amt = Big.min(p.maxHp.mul(coef(BLOOD_PRICE.hp)), room);
      if (!amt.isZero() && amt.gt(Big.ZERO)) { p.hp = p.hp.sub(amt); castEv(ev, p, 'h_blood_price', p.x, p.y, p.aimX, p.aimY); }
    }
    if (has(p, 'h_blood_sacrament')) {
      const floor = p.maxHp.mul(B('0.3'));
      if (p.hp.gt(floor)) {
        p.hp = p.hp.sub(Big.min(p.hp.mul(B('0.08')), p.hp.sub(floor)));
        p.vars.hx_lust = Math.min(5, lustStacks(state, p) + 1);
        p.vars.hx_lustUntil = state.tick + ticks(6);
        castEv(ev, p, 'h_blood_sacrament', p.x, p.y, p.aimX, p.aimY, String(p.vars.hx_lust));
      }
    }
  },

  onEnemyHit(state, ev, p, e, info) {
    if (!p || p.classId !== CID) return;
    const gen0 = info.generation === 0;
    if (gen0 && info.dtype === 'decay' && isLive(e)) {
      if (has(p, 'h_festering')) {
        const st = rotStacks(state, e, p.slot);
        if (st >= 2) {
          const extra = info.dealt.div(mitigationFactor(e.armor)).mul(coef(0.06 * Math.min(8, st - 1)));
          hitEnemy(state, ev, e, extra, ONE, { dtype: 'decay', srcSlot: p.slot, skillId: 'h_festering', fromX: info.fromX, fromY: info.fromY, allowCrit: false, generation: 1 });
        }
      }
      if (has(p, 'h_rupture') && isLive(e) && rotStacks(state, e, p.slot) >= 5) {
        const rem = remainingRot(state, e, p.slot);
        e.dots = e.dots.filter((d) => !(d.src === p.slot && d.type === 'decay'));
        if (!rem.isZero()) {
          hitEnemy(state, ev, e, rem.mul(B('1.2')), ONE, { dtype: 'decay', srcSlot: p.slot, skillId: 'h_rupture', fromX: info.fromX, fromY: info.fromY, allowCrit: false, generation: 1 });
          castEv(ev, p, 'h_rupture', e.x, e.y, 0, 0);
        }
      }
    }
    if (BLOOD.has(info.skillId ?? '')) {
      if (has(p, 'h_crimson_covenant')) shieldSoft(state, ev, p, info.dealt.mul(B('0.4')));
      if (info.skillId === 'h_sanguine_lance' && gen0) { hxHeal(state, ev, p, p.maxHp.mul(B('0.02'))); gainBlood(p, 0.25, 'h_sanguine_lance'); }
      if (info.kill && gen0 && has(p, 'h_exsanguinate')) {
        hitArea(state, ev, e.x, e.y, 2, coefDmg(state, p, '1.2', 'h_exsanguinate'), { dtype: 'decay', srcSlot: p.slot, skillId: 'h_exsanguinate', allowCrit: false, generation: 1 }, [e.id]);
        hxHeal(state, ev, p, p.maxHp.mul(B('0.03')));
        castEv(ev, p, 'h_exsanguinate', e.x, e.y, 2, 0);
      }
    }
    if (info.kill && has(p, 'h_soul_eater') && SPIRIT.has(info.skillId ?? '')) hxHeal(state, ev, p, p.maxHp.mul(B('0.02')));
  },

  onKill(state, ev, e, p) {
    if (!p || p.classId !== CID) return;
    const harvest = rank(p, 'h_soul_harvest');
    if (harvest > 0) { gainBlood(p, 0.15 * harvest); addSoul(state, p, e.x, e.y); }
    if (has(p, 'h_legion_of_the_damned') && state.map) summon(state, ev, p, 'hx_lesser', e.x, e.y, coefDmg(state, p, '0.4', 'h_lesser_wraith'));
  },

  onPlayerTick(state, ev, p) {
    // homing spirits and seeds
    for (const pr of state.projectiles) {
      if (pr.owner !== 'player' || pr.ownerId !== p.slot) continue;
      if (pr.kind === 'hx_spirit') steerProjectile(state, pr, 8, 0.16);
      else if (pr.kind === 'hx_seed') steerProjectile(state, pr, 6, 0.12);
    }
    if (has(p, 'h_crimson_frenzy') && p.hp.ratio(p.maxHp) < 0.5) {
      // cooldowns recover 25% faster while bloodied (on top of the core's recovery-rate tick)
      gainBlood(p, toFloatClamped(playerDerived(state, p).recovery, 1e9) * DT * 0.25);
    }
    if (has(p, 'h_black_death') && (state.tick + p.slot * 7) % 60 === 0) blackDeath(state, ev, p);
  },

  onRoundStart(state) {
    for (const p of state.players) {
      if (p.classId !== CID) continue;
      p.vars.hx_lust = 0; p.vars.hx_lustUntil = 0; p.vars.hx_volley = 0;
    }
  },
};

function blackDeath(state: SimState, ev: SimEvent[], p: PlayerState) {
  const chosen: number[] = [];
  const infections: { from: EnemyState; to: EnemyState; rate: Big }[] = [];
  for (const e of state.enemies) {
    if (!isLive(e)) continue;
    const rate = rotRate(state, e, p.slot);
    if (rate.isZero()) continue;
    const to = enemiesNear(state, e.x, e.y, 3, [e.id, ...chosen]).find((o) => rotStacks(state, o, p.slot) === 0);
    if (!to) continue;
    chosen.push(to.id);
    infections.push({ from: e, to, rate: rate.mul(B('0.5')) });
  }
  for (const x of infections) {
    addDot(state, x.to, p.slot, 'decay', x.rate, 3);
    castEv(ev, p, 'h_contagion', x.from.x, x.from.y, x.to.x, x.to.y);
  }
}

/** Death effects of rot apply whoever lands the kill (co-op): Contagion and Corpse Bloom. */
const hexDeathHooks: SimHooks = {
  onKill(state, ev, e) {
    for (const hx of state.players) {
      if (hx.classId !== CID) continue;
      const contagion = has(hx, 'h_contagion'), bloom = has(hx, 'h_corpse_bloom');
      if (!contagion && !bloom) continue;
      if (!e.dots.some((d) => d.src === hx.slot && d.type === 'decay' && d.until > state.tick)) continue;
      if (contagion) {
        const rem = remainingRot(state, e, hx.slot);
        if (!rem.isZero()) {
          const perSec = rem.mul(B('0.2'));   // 60% of the remaining rot over 3s
          for (const t of enemiesNear(state, e.x, e.y, 3, [e.id]).slice(0, 3)) {
            addDot(state, t, hx.slot, 'decay', perSec, 3);
            castEv(ev, hx, 'h_contagion', e.x, e.y, t.x, t.y);
          }
        }
      }
      if (bloom) {
        state.hazards.push(makeHazard(state, {
          kind: 'hx_corpse', owner: 'player', ownerId: hx.slot, x: e.x, y: e.y, radius: 2, nextTick: state.tick + 15, untilTick: state.tick + 16,
          interval: 9999, damage: coefDmg(state, hx, '1.2', 'h_corpse_bloom'), dtype: 'decay', dot: rotDot(hx, 0.2, 3), generation: 1,
        }));
      }
    }
  },
};

registerClassHooks(CID, hexHooks);
registerGlobalHooks(hexDeathHooks);
