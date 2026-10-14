import { Big } from '@cursebound/numeric';
import { RULES, SKILL_BY_ID, TICK_SEC } from '@cursebound/content';
import { applyChill, applyFreeze, breakFreeze, isChilled, isFrozen, lure } from '../cc';
import { addDot, hitEnemy, shieldPlayer } from '../combat';
import { moveCircle, norm, q, rayDistance } from '../geometry';
import { registerClassHooks, type EnemyHitInfo } from '../hooks';
import { nearestFloor } from '../map';
import { areaCoverage, makeHazard, newProjectileId, spawnPlayerProjectiles } from '../players';
import { nextFloat, nextInt } from '../rng';
import { B, ONE, hitDamage, playerDerived } from '../stats';
import type { EnemyState, Hazard, PlayerState, Projectile, SimEvent, SimState } from '../types';

// Cryomancer kit (content: packages/content/src/classes/cryomancer.ts). Chill / Freeze / control resistance live in
// cc.ts; this module owns walls, storms, the Frozen Orb, Shatter and every node mechanic. Deterministic: state, the
// combat rng stream and inputs only. Per-player timers in p.vars (ticks):
//   glT/glX/glY  Frost Effigy glide        cryoReady  Cryostasis recharge      howReady  Heart of Winter recharge
// Hazard kinds: cryo_wall, cryo_prison, cryo_effigy, cryo_storm, cryo_orb, cryo_spike, cryo_permafrost.
// Field use on hazards (all plain numbers): inner = next Living Glacier shot / storm type / orb angle,
// outer = next hail tick, generation = orb spiral index, hitSlots = enemy ids (first touch, orb hits, Whiteout pulses).

const DT = TICK_SEC;
const T = (sec: number) => Math.max(1, Math.round(sec / DT));
const rank = (p: PlayerState, id: string) => p.ranks[id] ?? 0;
const has = (p: PlayerState, id: string) => (p.ranks[id] ?? 0) > 0;
const live = (e: EnemyState) => e.state !== 'dying' && !e.cohort.count.isZero();

const GLACIER = ['c_ice_wall', 'c_glacial_prison', 'c_frost_effigy'];
const BLIZZARD = ['c_blizzard', 'c_whiteout', 'c_frozen_orb'];
const SHATTER = ['c_frost_nova', 'c_glacial_spike', 'c_cold_snap'];
/** Damage sources that count as the Blizzard-branch skill for Cold Front. */
const BLIZZARD_DAMAGE = new Set(['c_blizzard', 'c_whiteout', 'c_frozen_orb', 'c_orb_shard', 'c_hail']);
/** Hits that Shatter a Frozen target (Ice Shard only with Crystallize). */
const SHATTERING = new Set(['c_absolute_zero', 'c_frost_nova', 'c_glacial_spike', 'c_spike_burst', 'c_cold_snap', 'c_shatter_burst']);
/** On-hit Chill per source: [slow, seconds]. Storm chill is resolved per player (Eye of the Storm). */
const CHILL: Record<string, [number, number]> = {
  c_ice_shard: [0.3, 1.5], c_orb_shard: [0.3, 1.5], c_glacier_shard: [0.3, 1.5], c_bloom_shard: [0.3, 1.5],
  c_ice_wall: [0.5, 2], c_glacial_prison: [0.5, 2], c_frozen_orb: [0.4, 1.5], c_shatter_burst: [0.5, 2], c_hail: [0.3, 1],
};
const WALL_HALF = 0.3;

function castEv(ev: SimEvent[], p: PlayerState, skill: string, x: number, y: number, dx: number, dy: number) {
  ev.push({ t: 'cast', slot: p.slot, skill, x, y, dx, dy });
}

/** Living enemies whose body touches the circle, nearest first (ties by id). */
function enemiesIn(state: SimState, x: number, y: number, r: number): EnemyState[] {
  const out: { e: EnemyState; d: number }[] = [];
  for (const e of state.enemies) {
    if (!live(e)) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d <= (r + e.radius) ** 2) out.push({ e, d });
  }
  out.sort((a, b) => a.d - b.d || a.e.id - b.e.id);
  return out.map((o) => o.e);
}

/** Aimed ground point within maxR (stopped short of walls), always valid floor. */
function aimPoint(state: SimState, p: PlayerState, maxR: number): [number, number] {
  const want = Math.min(maxR, Math.max(1, p.aimDist || maxR));
  const d = state.map ? Math.max(0, rayDistance(state.map, p.x, p.y, p.aimX, p.aimY, want) - RULES.playerRadius - 0.05) : want;
  const x = p.x + p.aimX * d, y = p.y + p.aimY * d;
  if (!state.map) return [x, y];
  const [fx, fy] = nearestFloor(state.map, Math.min(state.map.w - 0.5, Math.max(0.5, x)), Math.min(state.map.h - 0.5, Math.max(0.5, y)));
  return [q(fx), q(fy)];
}

function freezeSec(p: PlayerState, sec: number): number {
  return has(p, 'c_deep_freeze') ? sec * 1.5 : sec;
}

function freeze(state: SimState, ev: SimEvent[], p: PlayerState, e: EnemyState, sec: number) {
  applyFreeze(state, ev, e, freezeSec(p, sec));
}

/** Cut seconds from the cooldown of whichever of `ids` sits on the hotbar. */
function cutCooldown(p: PlayerState, ids: readonly string[], sec: number) {
  for (const s of p.skills) if (ids.includes(s.skillId) && s.charges < s.maxCharges) s.cooldown -= sec;
}

function shard(state: SimState, p: PlayerState, x: number, y: number, dx: number, dy: number, skillId: string) {
  const sk = SKILL_BY_ID[skillId];
  if (sk.shape.kind !== 'projectile') return;
  const [nx, ny] = norm(dx, dy);
  if (nx === 0 && ny === 0) return;
  const pr: Projectile = {
    id: newProjectileId(state), kind: 'cryo_shard', owner: 'player', ownerId: p.slot, x, y,
    vx: nx * sk.shape.speed, vy: ny * sk.shape.speed, radius: sk.shape.radius, range: sk.shape.range,
    damage: hitDamage(state, p, skillId, 'frost'), weight: ONE, dtype: 'frost', pierce: sk.shape.pierce, hitIds: [], skillId,
    crit: false, lobTarget: null, bornTick: state.tick,
  };
  state.projectiles.push(pr);
}

function areaHit(state: SimState, ev: SimEvent[], p: PlayerState, x: number, y: number, r: number, dmg: Big, skillId: string, stagger = 0, crit = true): EnemyState[] {
  const hit = enemiesIn(state, x, y, r);
  for (const e of hit) hitEnemy(state, ev, e, dmg, ONE, { dtype: 'frost', srcSlot: p.slot, skillId, fromX: x, fromY: y, coverage: areaCoverage(e, r), allowCrit: crit, stagger: stagger || undefined });
  return hit;
}

// ---------------- Shatter ----------------

function shatter(state: SimState, ev: SimEvent[], p: PlayerState, e: EnemyState, gen: number) {
  let dmg = hitDamage(state, p, 'c_shatter', 'frost');
  if (has(p, 'c_deep_freeze')) dmg = dmg.mul(B('1.6'));
  castEv(ev, p, 'c_shatter', e.x, e.y, 0, 0);
  // the bonus lands while the target is still Frozen (Shatterpoint crits, frozen damage taken), then the ice breaks
  hitEnemy(state, ev, e, dmg, ONE, { dtype: 'frost', srcSlot: p.slot, skillId: 'c_shatter', fromX: e.x, fromY: e.y, allowCrit: has(p, 'c_shatterpoint'), generation: gen + 1, stagger: 30 });
  breakFreeze(state, e);
  if (has(p, 'c_frozen_momentum')) {
    p.resource = Math.min(playerDerived(state, p).resourceMax, p.resource + 4);
    cutCooldown(p, SHATTER, 0.5);
  }
  if (has(p, 'c_zero_point')) cutCooldown(p, ['c_absolute_zero'], 1);
  if (has(p, 'c_chain_reaction')) {
    const burst = hitDamage(state, p, 'c_shatter_burst', 'frost');
    castEv(ev, p, 'c_shatter_burst', e.x, e.y, 0, 0);
    for (const o of enemiesIn(state, e.x, e.y, 2.2)) {
      if (o === e) continue;
      hitEnemy(state, ev, o, burst, ONE, { dtype: 'frost', srcSlot: p.slot, skillId: 'c_shatter_burst', fromX: e.x, fromY: e.y, coverage: areaCoverage(o, 2.2), allowCrit: false, generation: gen + 1 });
    }
  }
}

// ---------------- hazards ----------------

function wallDims(p: PlayerState): { len: number; dur: number; prisonR: number } {
  const thick = rank(p, 'c_thick_ice');
  const bulw = has(p, 'c_glacial_bulwark') ? 1.3 : 1;
  return {
    len: (5 + thick) * bulw,
    dur: (4 + thick) * (has(p, 'c_living_glacier') ? 2 : 1),
    prisonR: (2.6 + 0.4 * thick) * bulw,
  };
}

function raiseWall(state: SimState, p: PlayerState, skillId: string): Hazard {
  const { len, dur } = wallDims(p);
  const free = state.map ? rayDistance(state.map, p.x, p.y, p.aimX, p.aimY, 2.5) : 2.5;
  const d = Math.max(0.9, Math.min(2.5, free - 0.2));
  const cx = p.x + p.aimX * d, cy = p.y + p.aimY * d;
  const dx = -p.aimY, dy = p.aimX;
  const spikes = has(p, 'c_rime_spikes') ? B('2.5') : ONE;
  const h = makeHazard(state, {
    kind: 'cryo_wall', owner: 'player', ownerId: p.slot, x: q(cx - dx * len / 2), y: q(cy - dy * len / 2), dx, dy, length: len, width: WALL_HALF * 2,
    untilTick: state.tick + T(dur), interval: T(0.5), nextTick: state.tick + 1, damage: hitDamage(state, p, skillId, 'frost').mul(spikes), dtype: 'frost',
    inner: state.tick + T(1),
  });
  state.hazards.push(h);
  return h;
}

/** Shared wall behaviour for one enemy touching the wall band: Rime Spikes first-touch Freeze. */
function wallTouch(state: SimState, ev: SimEvent[], p: PlayerState, h: Hazard, e: EnemyState) {
  if (!has(p, 'c_rime_spikes') || h.hitSlots.includes(e.id)) return;
  h.hitSlots.push(e.id);
  freeze(state, ev, p, e, 0.8);
}

function brittle(state: SimState, e: EnemyState) {
  if (e.vulnUntil > state.tick && Number(e.vulnFactor) > 1.15) return;
  e.vulnUntil = Math.max(e.vulnUntil > state.tick ? e.vulnUntil : 0, state.tick + T(2));
  e.vulnFactor = '1.15';
}

function blockProjectiles(state: SimState, ev: SimEvent[], p: PlayerState, inside: (x: number, y: number, r: number) => boolean) {
  let shown = 0;
  state.projectiles = state.projectiles.filter((pr) => {
    if (pr.owner !== 'enemy' || pr.lobTarget || !inside(pr.x, pr.y, pr.radius + 0.1)) return true;
    if (shown++ < 3) castEv(ev, p, 'c_wall_block', pr.x, pr.y, pr.vx, pr.vy);
    return false;
  });
}

function livingGlacierShot(state: SimState, p: PlayerState, h: Hazard, cx: number, cy: number) {
  if (!has(p, 'c_living_glacier') || state.tick < h.inner) return;
  h.inner = state.tick + T(1);
  const t = enemiesIn(state, cx, cy, 7)[0];
  if (t) shard(state, p, cx, cy, t.x - cx, t.y - cy, 'c_glacier_shard');
}

function stepWall(state: SimState, ev: SimEvent[], p: PlayerState, h: Hazard) {
  const nx = -h.dy, ny = h.dx;
  const ownerSide = Math.sign((p.x - h.x) * nx + (p.y - h.y) * ny) || 1;
  const pulse = state.tick >= h.nextTick;
  if (pulse) h.nextTick = state.tick + h.interval;
  for (const e of state.enemies) {
    if (!live(e)) continue;
    const rx = e.x - h.x, ry = e.y - h.y;
    const along = rx * h.dx + ry * h.dy;
    if (along < -e.radius - 0.2 || along > h.length + e.radius + 0.2) continue;
    const perp = rx * nx + ry * ny;
    const reach = WALL_HALF + Math.min(e.radius, 0.6);
    const touching = Math.abs(perp) < reach + 0.35;
    if (!touching) continue;
    // soft collision: non-boss bodies inside the band are put back on the side they came from
    if (!e.boss && Math.abs(perp) < reach && along >= -0.1 && along <= h.length + 0.1 && state.map) {
      const side = perp > 0 ? 1 : perp < 0 ? -1 : -ownerSide;
      const push = (reach + 0.02 - Math.abs(perp)) * side;
      const r = moveCircle(state.map, e.x, e.y, nx * push, ny * push, Math.min(e.radius, 0.6));
      e.x = r.x; e.y = r.y;
    }
    wallTouch(state, ev, p, h, e);
    if (pulse) {
      hitEnemy(state, ev, e, h.damage, ONE, { dtype: 'frost', srcSlot: p.slot, skillId: 'c_ice_wall', fromX: h.x + h.dx * along, fromY: h.y + h.dy * along, coverage: areaCoverage(e, 1), allowCrit: true });
      if (has(p, 'c_brittle_ice')) brittle(state, e);
    }
  }
  if (has(p, 'c_glacial_bulwark')) {
    blockProjectiles(state, ev, p, (x, y, r) => {
      const rx = x - h.x, ry = y - h.y;
      const along = rx * h.dx + ry * h.dy;
      return along >= -r && along <= h.length + r && Math.abs(rx * nx + ry * ny) < WALL_HALF + r;
    });
  }
  livingGlacierShot(state, p, h, h.x + h.dx * h.length / 2, h.y + h.dy * h.length / 2);
}

function stepPrison(state: SimState, ev: SimEvent[], p: PlayerState, h: Hazard) {
  const R = h.radius;
  const pulse = state.tick >= h.nextTick;
  if (pulse) h.nextTick = state.tick + h.interval;
  for (const e of state.enemies) {
    if (!live(e)) continue;
    const dx = e.x - h.x, dy = e.y - h.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const reach = WALL_HALF + Math.min(e.radius, 0.6);
    if (Math.abs(d - R) >= reach + 0.35) continue;
    if (!e.boss && Math.abs(d - R) < reach && state.map) {
      const [ux, uy] = d > 1e-6 ? [dx / d, dy / d] : [1, 0];
      const target = d < R ? R - reach - 0.02 : R + reach + 0.02;
      const r = moveCircle(state.map, e.x, e.y, ux * (target - d), uy * (target - d), Math.min(e.radius, 0.6));
      e.x = r.x; e.y = r.y;
    }
    wallTouch(state, ev, p, h, e);
    if (pulse) {
      hitEnemy(state, ev, e, h.damage, ONE, { dtype: 'frost', srcSlot: p.slot, skillId: 'c_glacial_prison', fromX: h.x, fromY: h.y, coverage: areaCoverage(e, 1), allowCrit: true });
      if (has(p, 'c_brittle_ice')) brittle(state, e);
    }
  }
  if (has(p, 'c_glacial_bulwark')) {
    blockProjectiles(state, ev, p, (x, y, r) => Math.abs(Math.sqrt((x - h.x) ** 2 + (y - h.y) ** 2) - R) < WALL_HALF + r);
  }
  livingGlacierShot(state, p, h, h.x, h.y);
}

function stepEffigy(state: SimState, ev: SimEvent[], p: PlayerState, h: Hazard) {
  for (const e of enemiesIn(state, h.x, h.y, 6)) lure(state, e, h.x, h.y, 3);
  if (state.tick >= h.nextTick) {
    h.nextTick = state.tick + T(0.5);
    for (const e of enemiesIn(state, h.x, h.y, 2)) applyChill(state, e, 0.5, 1);
  }
  if (state.tick >= h.untilTick - 1) {
    h.untilTick = state.tick;
    castEv(ev, p, 'c_effigy_burst', h.x, h.y, 0, 0);
    const hit = areaHit(state, ev, p, h.x, h.y, 2.5, hitDamage(state, p, 'c_effigy_burst', 'frost'), 'c_effigy_burst', 60);
    for (const e of hit) freeze(state, ev, p, e, 1.2);
  }
}

function comet(state: SimState, ev: SimEvent[], p: PlayerState, x: number, y: number) {
  castEv(ev, p, 'c_comet', x, y, 0, 0);
  const hit = areaHit(state, ev, p, x, y, 2.5, hitDamage(state, p, 'c_comet', 'frost'), 'c_comet', 120);
  for (const e of hit) freeze(state, ev, p, e, 1.5);
}

function hail(state: SimState, ev: SimEvent[], p: PlayerState, h: Hazard, x: number, y: number, r: number) {
  if (!has(p, 'c_hailstorm') || state.tick < h.outer) return;
  h.outer = state.tick + T(1 / 3);
  const pool = enemiesIn(state, x, y, r);
  if (!pool.length) return;
  const e = pool[nextInt(state.rng.combat, pool.length)];
  castEv(ev, p, 'c_hail', e.x, e.y, 0, 0);
  hitEnemy(state, ev, e, hitDamage(state, p, 'c_hail', 'frost'), ONE, { dtype: 'frost', srcSlot: p.slot, skillId: 'c_hail', fromX: e.x, fromY: e.y, allowCrit: true });
}

function maelstromPull(state: SimState, x: number, y: number, r: number, speed: number) {
  if (!state.map) return;
  for (const e of enemiesIn(state, x, y, r)) {
    if (e.boss) continue;
    const dx = x - e.x, dy = y - e.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.3) continue;
    const step = Math.min(speed * DT, d - 0.3);
    const m = moveCircle(state.map, e.x, e.y, (dx / d) * step, (dy / d) * step, Math.min(e.radius, 0.6));
    e.x = m.x; e.y = m.y;
  }
}

function stepStorm(state: SimState, ev: SimEvent[], p: PlayerState, h: Hazard) {
  const whiteout = h.inner === 1;
  if (has(p, 'c_eye_of_the_storm') && p.lifeState === 'alive') { h.x = p.x; h.y = p.y; }
  if (has(p, 'c_maelstrom')) maelstromPull(state, h.x, h.y, h.radius, 0.8);
  if (state.tick >= h.nextTick) {
    h.nextTick = state.tick + h.interval;
    const sid = whiteout ? 'c_whiteout' : 'c_blizzard';
    const slow = has(p, 'c_eye_of_the_storm') ? 0.6 : 0.4;
    for (const e of enemiesIn(state, h.x, h.y, h.radius)) {
      const res = hitEnemy(state, ev, e, h.damage, ONE, { dtype: 'frost', srcSlot: p.slot, skillId: sid, fromX: h.x, fromY: h.y, coverage: areaCoverage(e, h.radius), allowCrit: true, stagger: 6 });
      if (!live(e)) continue;
      applyChill(state, e, slow, 1);
      frostbiteFrom(state, p, e, res.dealt);
      if (whiteout) {
        h.hitSlots.push(e.id);
        if (h.hitSlots.filter((id) => id === e.id).length >= 4) {
          h.hitSlots = h.hitSlots.filter((id) => id !== e.id);
          freeze(state, ev, p, e, 1.5);
        }
      }
    }
  }
  hail(state, ev, p, h, h.x, h.y, h.radius);
  if (state.tick >= h.untilTick - 1) {
    h.untilTick = state.tick;
    if (has(p, 'c_glacial_comet')) comet(state, ev, p, h.x, h.y);
  }
}

function burstOrb(state: SimState, ev: SimEvent[], p: PlayerState, h: Hazard) {
  h.untilTick = state.tick;
  castEv(ev, p, 'c_orb_burst', h.x, h.y, 0, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + h.generation * 0.3;
    shard(state, p, h.x, h.y, Math.cos(a), Math.sin(a), 'c_orb_shard');
  }
  if (has(p, 'c_glacial_comet')) comet(state, ev, p, h.x, h.y);
}

function stepOrb(state: SimState, ev: SimEvent[], p: PlayerState, h: Hazard) {
  const orbit = h.outer < 0;   // outer = -1 marks an orbiting orb (Eye of the Storm); hail uses h.length as its clock
  if (orbit) {
    h.inner += (h.speed / 2.6) * DT;
    h.x = p.x + Math.cos(h.inner) * 2.6; h.y = p.y + Math.sin(h.inner) * 2.6;
    if ((state.tick - h.bornTick) % T(1) === 0) h.hitSlots = [];
  } else {
    const step = h.speed * DT;
    const free = state.map ? rayDistance(state.map, h.x, h.y, h.dx, h.dy, step + 0.25) : Infinity;
    if (free < step + 0.25) { burstOrb(state, ev, p, h); return; }
    h.x += h.dx * step; h.y += h.dy * step;
  }
  const body = hitDamage(state, p, 'c_frozen_orb', 'frost');
  for (const e of enemiesIn(state, h.x, h.y, h.radius)) {
    if (h.hitSlots.includes(e.id)) continue;
    h.hitSlots.push(e.id);
    hitEnemy(state, ev, e, body, ONE, { dtype: 'frost', srcSlot: p.slot, skillId: 'c_frozen_orb', fromX: h.x, fromY: h.y, allowCrit: true, stagger: 8 });
  }
  if ((state.tick - h.bornTick) % 9 === 0) {
    const a = h.generation * 2.39996;   // golden-angle spiral
    h.generation++;
    shard(state, p, h.x, h.y, Math.cos(a), Math.sin(a), 'c_orb_shard');
  }
  if (has(p, 'c_maelstrom')) maelstromPull(state, h.x, h.y, 3, 1.2);
  if (has(p, 'c_hailstorm') && state.tick >= h.length) {
    h.length = state.tick + T(1 / 3);
    const pool = enemiesIn(state, h.x, h.y, 3);
    if (pool.length) {
      const e = pool[nextInt(state.rng.combat, pool.length)];
      castEv(ev, p, 'c_hail', e.x, e.y, 0, 0);
      hitEnemy(state, ev, e, hitDamage(state, p, 'c_hail', 'frost'), ONE, { dtype: 'frost', srcSlot: p.slot, skillId: 'c_hail', fromX: e.x, fromY: e.y, allowCrit: true });
    }
  }
  if (state.tick >= h.untilTick - 1) burstOrb(state, ev, p, h);
}

function stepSpike(state: SimState, ev: SimEvent[], p: PlayerState, h: Hazard) {
  if (state.tick < h.untilTick - 1) return;
  h.untilTick = state.tick;
  castEv(ev, p, 'c_spike_burst', h.x, h.y, 0, 0);
  areaHit(state, ev, p, h.x, h.y, h.radius, hitDamage(state, p, 'c_spike_burst', 'frost'), 'c_spike_burst', 40);
}

function stepPermafrost(state: SimState, h: Hazard) {
  if (state.tick < h.nextTick) return;
  h.nextTick = state.tick + h.interval;
  for (const e of enemiesIn(state, h.x, h.y, h.radius)) applyChill(state, e, 0.4, 0.6);
}

// ---------------- skills ----------------

function stormHazard(state: SimState, p: PlayerState, skillId: 'c_blizzard' | 'c_whiteout') {
  const whiteout = skillId === 'c_whiteout';
  const gyre = rank(p, 'c_widening_gyre');
  const R = (whiteout ? 3.4 : 2.8) + 0.35 * gyre;
  const dur = (whiteout ? 6 : 5) + gyre;
  const [x, y] = has(p, 'c_eye_of_the_storm') ? [p.x, p.y] : aimPoint(state, p, 8);
  const pulse = has(p, 'c_maelstrom') ? B('1.4') : ONE;
  state.hazards.push(makeHazard(state, {
    kind: 'cryo_storm', owner: 'player', ownerId: p.slot, x, y, radius: R, untilTick: state.tick + T(dur), interval: T(0.5), nextTick: state.tick + 1,
    damage: hitDamage(state, p, skillId, 'frost').mul(pulse), dtype: 'frost', inner: whiteout ? 1 : 0, outer: state.tick + T(1 / 3),
  }));
  return [x, y];
}

function castCryo(state: SimState, ev: SimEvent[], p: PlayerState, skillId: string): boolean | undefined {
  const ax = p.aimX, ay = p.aimY;
  switch (skillId) {
    case 'c_absolute_zero': {
      const R = 4.2;
      castEv(ev, p, skillId, p.x, p.y, ax, ay);
      const hit = areaHit(state, ev, p, p.x, p.y, R, hitDamage(state, p, skillId, 'frost'), skillId, 200);
      const sec = has(p, 'c_zero_point') ? 2.4 : 1.6;
      for (const e of hit) freeze(state, ev, p, e, sec);
      state.hazards.push(makeHazard(state, { kind: 'cryo_permafrost', owner: 'player', ownerId: p.slot, x: p.x, y: p.y, radius: R, untilTick: state.tick + T(3), interval: T(0.25), damage: Big.ZERO, dtype: 'frost' }));
      return true;
    }
    case 'c_ice_wall': {
      const h = raiseWall(state, p, skillId);
      castEv(ev, p, skillId, h.x + h.dx * h.length / 2, h.y + h.dy * h.length / 2, h.dx, h.dy);
      return true;
    }
    case 'c_frost_effigy': {
      const h = raiseWall(state, p, 'c_frost_effigy');
      const cx = h.x + h.dx * h.length / 2, cy = h.y + h.dy * h.length / 2;
      let [ex, ey] = [cx + ax * 0.8, cy + ay * 0.8];
      if (state.map) [ex, ey] = nearestFloor(state.map, ex, ey);
      state.hazards.push(makeHazard(state, { kind: 'cryo_effigy', owner: 'player', ownerId: p.slot, x: q(ex), y: q(ey), radius: 6, untilTick: h.untilTick, interval: T(0.5), nextTick: state.tick + 1, damage: Big.ZERO, dtype: 'frost', dx: ax, dy: ay }));
      // glide back on a trail of ice: 2.5 units over 0.25s
      const n = T(0.25);
      p.vars.glT = n; p.vars.glX = (-ax * 2.5) / n; p.vars.glY = (-ay * 2.5) / n;
      castEv(ev, p, skillId, ex, ey, h.dx, h.dy);
      return true;
    }
    case 'c_glacial_prison': {
      const { prisonR, dur } = wallDims(p);
      const [x, y] = aimPoint(state, p, 7);
      const spikes = has(p, 'c_rime_spikes') ? B('2.5') : ONE;
      state.hazards.push(makeHazard(state, {
        kind: 'cryo_prison', owner: 'player', ownerId: p.slot, x, y, radius: prisonR, width: WALL_HALF * 2, untilTick: state.tick + T(dur), interval: T(0.5),
        nextTick: state.tick + 1, damage: hitDamage(state, p, skillId, 'frost').mul(spikes), dtype: 'frost', inner: state.tick + T(1),
      }));
      for (const e of enemiesIn(state, x, y, prisonR - 0.2)) {
        if ((e.x - x) ** 2 + (e.y - y) ** 2 < (prisonR - 0.2) ** 2) freeze(state, ev, p, e, 1.2);
      }
      castEv(ev, p, skillId, x, y, ax, ay);
      return true;
    }
    case 'c_blizzard':
    case 'c_whiteout': {
      const [x, y] = stormHazard(state, p, skillId);
      castEv(ev, p, skillId, x, y, ax, ay);
      return true;
    }
    case 'c_frozen_orb': {
      const eye = has(p, 'c_eye_of_the_storm');
      const range = 9 + 2 * rank(p, 'c_widening_gyre');
      const speed = 4.5;
      const angle = Math.atan2(ay, ax);
      const x = eye ? p.x + Math.cos(angle) * 2.6 : p.x + ax * 0.6, y = eye ? p.y + Math.sin(angle) * 2.6 : p.y + ay * 0.6;
      state.hazards.push(makeHazard(state, {
        kind: 'cryo_orb', owner: 'player', ownerId: p.slot, x, y, dx: ax, dy: ay, radius: 0.7, speed,
        untilTick: state.tick + (eye ? T(4) : T(range / speed)), damage: Big.ZERO, dtype: 'frost',
        inner: angle, outer: eye ? -1 : 0, length: state.tick + T(1 / 3),
      }));
      castEv(ev, p, skillId, x, y, ax, ay);
      return true;
    }
    case 'c_frost_nova': {
      castEv(ev, p, skillId, p.x, p.y, ax, ay);
      const hit = areaHit(state, ev, p, p.x, p.y, 3, hitDamage(state, p, skillId, 'frost'), skillId, 40);
      for (const e of hit) freeze(state, ev, p, e, 1.2);
      return true;
    }
    case 'c_glacial_spike': {
      const [x, y] = aimPoint(state, p, 8);
      castEv(ev, p, skillId, x, y, ax, ay);
      const hit = areaHit(state, ev, p, x, y, 1.8, hitDamage(state, p, skillId, 'frost'), skillId, 50);
      for (const e of hit) freeze(state, ev, p, e, 1.4);
      state.hazards.push(makeHazard(state, { kind: 'cryo_spike', owner: 'player', ownerId: p.slot, x, y, radius: 2.4, untilTick: state.tick + T(0.6), damage: Big.ZERO, dtype: 'frost' }));
      return true;
    }
    case 'c_cold_snap': {
      castEv(ev, p, skillId, p.x, p.y, ax, ay);
      const dmg = hitDamage(state, p, skillId, 'frost');
      const snapped: number[] = [];
      for (const e of enemiesIn(state, p.x, p.y, 9)) {
        if (!isChilled(state, e) && !isFrozen(state, e)) continue;
        snapped.push(e.id);
        castEv(ev, p, 'c_cold_snap_hit', e.x, e.y, p.x, p.y);
        hitEnemy(state, ev, e, dmg, ONE, { dtype: 'frost', srcSlot: p.slot, skillId, fromX: p.x, fromY: p.y, allowCrit: true, stagger: 40 });
        freeze(state, ev, p, e, 1.2);
      }
      for (const e of enemiesIn(state, p.x, p.y, 2.5)) if (!snapped.includes(e.id)) applyChill(state, e, 0.4, 2);
      return true;
    }
  }
  return undefined;
}

// ---------------- hit effects ----------------

function frostbiteFrom(state: SimState, p: PlayerState, e: EnemyState, dealt: Big) {
  if (!has(p, 'c_frostbite') || !live(e)) return;
  addDot(state, e, p.slot, 'frost', dealt.mul(B('0.12')), 3);
}

function onCryoHit(state: SimState, ev: SimEvent[], p: PlayerState, e: EnemyState, info: EnemyHitInfo) {
  const sid = info.skillId ?? '';
  const wasFrozen = isFrozen(state, e);
  const alive = live(e);
  // Shatter (chains through Chain Reaction bursts up to 3 links: generations 0..2 may shatter)
  if (alive && wasFrozen && info.generation <= 2 && (SHATTERING.has(sid) || (sid === 'c_ice_shard' && has(p, 'c_crystallize')))) {
    shatter(state, ev, p, e, info.generation);
  } else if (alive && sid === 'c_ice_shard' && has(p, 'c_crystallize') && !wasFrozen && isChilled(state, e) && nextFloat(state.rng.combat) < 0.15) {
    freeze(state, ev, p, e, 0.6);
  }
  const ch = CHILL[sid];
  if (ch && live(e)) {
    applyChill(state, e, ch[0], ch[1]);
    frostbiteFrom(state, p, e, info.dealt);
  }
  if (info.kill && has(p, 'c_cold_front') && BLIZZARD_DAMAGE.has(sid)) cutCooldown(p, BLIZZARD, 0.75);
}

// ---------------- hooks ----------------

registerClassHooks('cryomancer', {
  castSkill: castCryo,

  basicAttack(state, ev, p, k) {
    const skill = SKILL_BY_ID['c_ice_shard'];
    ev.push({ t: 'cast', slot: p.slot, skill: skill.id, x: p.x, y: p.y, dx: p.aimX, dy: p.aimY, count: k.gt(ONE) ? k.toCompact() : undefined });
    spawnPlayerProjectiles(state, ev, p, skill, k.mul(playerDerived(state, p).projectileCount), hitDamage(state, p, skill.id, 'frost'), 'cryo_shard');
    return true;
  },

  onCast(state, ev, p, skillId) {
    if (GLACIER.includes(skillId) && has(p, 'c_rime_armor')) shieldPlayer(state, ev, p, p.maxHp.mul(B('0.12')));
  },

  onEnemyHit(state, ev, p, e, info) {
    if (p) onCryoHit(state, ev, p, e, info);
  },

  onKill(state, _ev, e, p) {
    if (!p || !has(p, 'c_ice_bloom')) return;
    if (!isChilled(state, e) && !isFrozen(state, e)) return;
    const a0 = (e.id % 8) * 0.39;
    for (let i = 0; i < 5; i++) {
      const a = a0 + (i / 5) * Math.PI * 2;
      shard(state, p, e.x, e.y, Math.cos(a), Math.sin(a), 'c_bloom_shard');
    }
  },

  onPlayerDamaged(state, ev, p, info) {
    const remaining = p.hp.sub(info.dealt);   // the hook runs before the damage is subtracted
    if (remaining.isZero() && has(p, 'c_heart_of_winter') && state.tick >= (p.vars.howReady ?? 0)) {
      p.hp = info.dealt.add(ONE);             // the pending hit leaves exactly 1 health
      p.vars.howReady = state.tick + T(60);
      p.iframes = Math.max(p.iframes, 2.5);
      shieldPlayer(state, ev, p, p.maxHp.mul(B('0.4')));
      for (const e of enemiesIn(state, p.x, p.y, 4)) freeze(state, ev, p, e, 2);
      castEv(ev, p, 'c_heart_of_winter', p.x, p.y, 0, 0);
      return;
    }
    if (!remaining.isZero() && has(p, 'c_cryostasis') && state.tick >= (p.vars.cryoReady ?? 0) && remaining.ratio(p.maxHp) < 0.35) {
      p.vars.cryoReady = state.tick + T(40);
      p.iframes = Math.max(p.iframes, 1.5);
      shieldPlayer(state, ev, p, p.maxHp.mul(B('0.25')));
      for (const e of enemiesIn(state, p.x, p.y, 3)) freeze(state, ev, p, e, 1);
      castEv(ev, p, 'c_cryostasis', p.x, p.y, 0, 0);
    }
  },

  onPlayerTick(state, _ev, p) {
    const gl = p.vars.glT ?? 0;
    if (gl > 0 && state.map) {
      const r = moveCircle(state.map, p.x, p.y, p.vars.glX ?? 0, p.vars.glY ?? 0, RULES.playerRadius);
      p.x = r.x; p.y = r.y;
      p.vars.glT = gl - 1;
    }
    if (has(p, 'c_rime_armor') && !p.shield.isZero() && state.tick % 15 === 0) {
      for (const e of enemiesIn(state, p.x, p.y, 2.5)) applyChill(state, e, 0.4, 0.6);
    }
  },

  hazardTick(state, ev, h) {
    if (!h.kind.startsWith('cryo_')) return undefined;
    if (h.untilTick <= state.tick) return true;   // already ended this tick
    const p = state.players[h.ownerId];
    if (!p) { h.untilTick = state.tick; return true; }
    switch (h.kind) {
      case 'cryo_wall': stepWall(state, ev, p, h); break;
      case 'cryo_prison': stepPrison(state, ev, p, h); break;
      case 'cryo_effigy': stepEffigy(state, ev, p, h); break;
      case 'cryo_storm': stepStorm(state, ev, p, h); break;
      case 'cryo_orb': stepOrb(state, ev, p, h); break;
      case 'cryo_spike': stepSpike(state, ev, p, h); break;
      case 'cryo_permafrost': stepPermafrost(state, h); break;
    }
    return true;
  },

  extraCharges(p, skillId) {
    return has(p, 'c_twin_storms') && BLIZZARD.includes(skillId) ? 1 : 0;
  },

  modifyHit(state, p, e, info, mod) {
    if (p.classId !== 'cryomancer') return;
    const frozen = isFrozen(state, e);
    const cp = rank(p, 'c_cold_precision');
    if (cp > 0 && (frozen || isChilled(state, e))) mod.critMul = mod.critMul.mul(B('1.4').powInt(cp));
    if (info.skillId === 'c_hail') mod.critMul = mod.critMul.mul(B('2'));
    if (frozen && has(p, 'c_shatterpoint')) mod.forceCrit = true;
  },
});
