import { Big } from '@cursebound/numeric';
import { RULES, SKILL_BY_ID, TICK_SEC, type DamageType } from '@cursebound/content';
import { applySnare, clearMark, isMarkedBy, lure, markEnemy } from '../cc';
import { addDot, addStagger, cohortHpFrac, hitEnemy, killEnemy } from '../combat';
import { moveCircle, norm, q, rayDistance } from '../geometry';
import { registerClassHooks, registerGlobalHooks } from '../hooks';
import { nearestFloor } from '../map';
import { areaCoverage, knockback, makeHazard, newProjectileId } from '../players';
import { nextFloat } from '../rng';
import { B, ONE, hitDamage, playerDerived } from '../stats';
import type { EnemyState, Hazard, PlayerState, Projectile, SimEvent, SimState } from '../types';

// Ranger kit (content: packages/content/src/classes/ranger.ts). Marks / Snare / lures live in cc.ts.
// Deterministic: state, the combat rng stream (via hitEnemy) and inputs only. Per-player p.vars (ticks / numbers):
//   still          ticks standing still (Steady Aim)       rhythm      Hunter's Rhythm empowered Quick Shots left
//   brN/brT/brM    pending Barrage fans, next tick, damage multiplier
//   ecT/ecS        Echoing Volley: tick and skill code (1 Multishot, 2 Barrage, 3 Longshot)
//   spT/spX/spY    Point Blank backward spring          wdN/wdU     Wind Dancer guaranteed crits left / expiry
//   ffId/ui_focus  Focus Fire target and stacks (ui_ vars are shown on the HUD)
// Hazard kinds: ranger_rain, ranger_trap, ranger_bait, ranger_cloud, ranger_hawk.

const DT = TICK_SEC;
const T = (sec: number) => Math.max(1, Math.round(sec / DT));
const rank = (p: PlayerState, id: string) => p.ranks[id] ?? 0;
const has = (p: PlayerState, id: string) => (p.ranks[id] ?? 0) > 0;
const live = (e: EnemyState) => e.state !== 'dying' && !e.cohort.count.isZero();

const VOLLEY = ['r_multishot', 'r_barrage', 'r_longshot'];
const MARKSMAN = ['r_hunters_mark', 'r_power_shot', 'r_deadeye'];
const VOLLEY_ARROWS = new Set(['r_multishot', 'r_barrage', 'r_longshot']);
const TIPS_SOURCES = new Set(['r_quick_shot', 'r_multishot', 'r_barrage', 'r_longshot', 'r_ricochet', 'r_tumble_shot', 'r_hawk_dive']);
/** Area / follow-up damage that does not count as a direct hit (Exposed boss stagger, Wind Dancer charges). */
const INDIRECT = new Set(['r_rain_of_arrows', 'r_venom_cloud', 'r_explosion', 'r_headshot', 'r_snare_trap']);

function castEv(ev: SimEvent[], p: PlayerState, skill: string, x: number, y: number, dx: number, dy: number, count?: string) {
  ev.push({ t: 'cast', slot: p.slot, skill, x, y, dx, dy, ...(count ? { count } : {}) });
}

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

function aimPoint(state: SimState, p: PlayerState, maxR: number, dirX = p.aimX, dirY = p.aimY): [number, number] {
  const want = Math.min(maxR, Math.max(1, p.aimDist || maxR));
  const d = state.map ? Math.max(0, rayDistance(state.map, p.x, p.y, dirX, dirY, want) - RULES.playerRadius - 0.05) : want;
  const x = p.x + dirX * d, y = p.y + dirY * d;
  if (!state.map) return [x, y];
  const [fx, fy] = nearestFloor(state.map, Math.min(state.map.w - 0.5, Math.max(0.5, x)), Math.min(state.map.h - 0.5, Math.max(0.5, y)));
  return [q(fx), q(fy)];
}

/** Enemies within `range` of the player, ordered by distance to the aim point. */
function nearAim(state: SimState, p: PlayerState, range: number): EnemyState[] {
  const ad = Math.min(range, Math.max(1, p.aimDist || 4));
  const tx = p.x + p.aimX * ad, ty = p.y + p.aimY * ad;
  return enemiesIn(state, p.x, p.y, range)
    .map((e) => ({ e, d: (e.x - tx) ** 2 + (e.y - ty) ** 2 }))
    .sort((a, b) => a.d - b.d || a.e.id - b.e.id)
    .map((o) => o.e);
}

const markSec = (p: PlayerState) => 8 + 4 * rank(p, 'r_lingering_mark');

function clearOwnMarks(state: SimState, p: PlayerState) {
  for (const e of state.enemies) clearMark(e, p.slot);
}

function hasLiveMark(state: SimState, p: PlayerState): boolean {
  return state.enemies.some((e) => live(e) && isMarkedBy(state, e, p.slot));
}

/** Poison carried by a hit from `skillId` (Poison Tips 20%/s on its sources, Plague Bearer 15%/s on everything), scaled
 *  by decay / physical damage so Toxicology and Plague Bearer grow it. */
function poisonDot(state: SimState, p: PlayerState, skillId: string): { type: DamageType; fractionPerSec: string; durationSec: number } | undefined {
  const frac = (has(p, 'r_poison_tips') && TIPS_SOURCES.has(skillId) ? 0.2 : 0) + (has(p, 'r_plague_bearer') ? 0.15 : 0);
  if (frac <= 0) return undefined;
  const pd = playerDerived(state, p);
  const ratio = Math.min(1e6, Math.max(0, pd.typeMult.decay.ratio(pd.typeMult.physical)));
  return { type: 'decay', fractionPerSec: (Math.round(frac * ratio * 10000) / 10000).toFixed(4), durationSec: 4 };
}

interface ArrowSpec {
  skillId: string; total: Big; spreadDeg: number; dirX?: number; dirY?: number; x?: number; y?: number;
  dmgMul?: Big; pierce?: number; kind?: string; hitIds?: number[];
}

/** Weighted arrow packets (same model as spawnPlayerProjectiles): up to 7 representative arrows carrying integer weights. */
function fireArrows(state: SimState, p: PlayerState, s: ArrowSpec) {
  const sk = SKILL_BY_ID[s.skillId];
  if (sk.shape.kind !== 'projectile') return;
  let count = s.total.floorInt();
  const frac = s.total.sub(Big.from(count)).toNumber();
  if (frac > 0 && nextFloat(state.rng.combat) < frac) count += 1n;   // fractional residue resolved by the combat stream
  if (count <= 0n) return;
  const reps = count < 7n ? Number(count) : 7;
  const base = count / BigInt(reps);
  const residue = Number(count % BigInt(reps));
  const [ax, ay] = norm(s.dirX ?? p.aimX, s.dirY ?? p.aimY);
  const dmg = hitDamage(state, p, s.skillId, sk.damageType).mul(s.dmgMul ?? ONE);
  const dot = poisonDot(state, p, s.skillId);
  const ox = s.x ?? p.x, oy = s.y ?? p.y;
  for (let i = 0; i < reps; i++) {
    const a = reps === 1 ? 0 : ((i - (reps - 1) / 2) * s.spreadDeg) * Math.PI / 180;
    const c = Math.cos(a), sn = Math.sin(a);
    const dx = ax * c - ay * sn, dy = ax * sn + ay * c;
    const pr: Projectile = {
      id: newProjectileId(state), kind: s.kind ?? 'ranger_arrow', owner: 'player', ownerId: p.slot,
      x: ox + dx * 0.4, y: oy + dy * 0.4, vx: dx * sk.shape.speed, vy: dy * sk.shape.speed, radius: sk.shape.radius, range: sk.shape.range,
      damage: dmg, weight: Big.from(base + (i < residue ? 1n : 0n)), dtype: sk.damageType, pierce: s.pierce ?? sk.shape.pierce,
      hitIds: s.hitIds ? s.hitIds.slice() : [], skillId: s.skillId, crit: false, dot, lobTarget: null, bornTick: state.tick,
    };
    state.projectiles.push(pr);
  }
}

// ---------------- Volley ----------------

function fan(state: SimState, p: PlayerState, skillId: 'r_multishot' | 'r_barrage', mul: number) {
  const pd = playerDerived(state, p);
  const n = 5 + 2 * rank(p, 'r_wide_fan');
  const pierce = has(p, 'r_piercing');
  fireArrows(state, p, {
    skillId, total: B(n).mul(pd.projectileCount), spreadDeg: 12 * (pierce ? 0.7 : 1),
    dmgMul: B(mul).mul(pierce ? B('1.25') : ONE), pierce: pierce ? 2 : 0,
  });
}

function longshot(state: SimState, p: PlayerState, mul: number) {
  fireArrows(state, p, {
    skillId: 'r_longshot', total: playerDerived(state, p).projectileCount, spreadDeg: 4, kind: 'ranger_heavy',
    dmgMul: B(mul).mul(has(p, 'r_piercing') ? B('1.25') : ONE),
  });
}

/** Fire a Volley skill (code 1 Multishot, 2 Barrage, 3 Longshot) at damage multiplier `mul`. */
function volley(state: SimState, ev: SimEvent[], p: PlayerState, code: number, mul: number) {
  const skill = code === 1 ? 'r_multishot' : code === 2 ? 'r_barrage' : 'r_longshot';
  castEv(ev, p, skill, p.x, p.y, p.aimX, p.aimY, mul < 1 ? 'echo' : undefined);
  if (code === 1) fan(state, p, 'r_multishot', mul);
  else if (code === 2) { fan(state, p, 'r_barrage', mul); p.vars.brN = 2; p.vars.brT = state.tick + T(0.15); p.vars.brM = mul; }
  else longshot(state, p, mul);
}

function volleyCast(state: SimState, ev: SimEvent[], p: PlayerState, code: number) {
  volley(state, ev, p, code, 1);
  if (has(p, 'r_hunters_rhythm')) p.vars.rhythm = 3;
  // the echo follows the whole volley: 0.25s after the cast, or 0.25s after Barrage's third fan
  if (has(p, 'r_echoing_volley')) { p.vars.ecT = state.tick + T(code === 2 ? 0.55 : 0.25); p.vars.ecS = code; }
  if (has(p, 'r_point_blank')) {
    const n = T(0.2);
    p.vars.spT = n; p.vars.spX = (-p.aimX * 2.5) / n; p.vars.spY = (-p.aimY * 2.5) / n;
  }
}

// ---------------- Marksman ----------------

function hitMarked(state: SimState, ev: SimEvent[], p: PlayerState, e: EnemyState, skillId: string) {
  castEv(ev, p, skillId, p.x, p.y, e.x, e.y);   // dx/dy carry the target point (like Arc Bolt)
  hitEnemy(state, ev, e, hitDamage(state, p, skillId, 'physical'), ONE, { dtype: 'physical', srcSlot: p.slot, skillId, fromX: p.x, fromY: p.y, allowCrit: true, dot: poisonDot(state, p, skillId), stagger: 20 });
}

function execute(state: SimState, ev: SimEvent[], p: PlayerState, e: EnemyState) {
  castEv(ev, p, 'r_headshot', e.x, e.y, p.x, p.y);
  if (e.cohort.count.lte(ONE)) killEnemy(state, ev, e, p.slot);
  else hitEnemy(state, ev, e, e.cohort.unitHp.mul(B(10)), ONE, { dtype: 'physical', srcSlot: p.slot, skillId: 'r_headshot', fromX: p.x, fromY: p.y, allowCrit: false, generation: 1 });
}

// ---------------- Wilds ----------------

function trapRadius(p: PlayerState, base: number) {
  return (base + 0.3 * rank(p, 'r_hair_trigger')) * (has(p, 'r_blast_traps') ? 1.4 : 1);
}

function placeTrap(state: SimState, p: PlayerState, x: number, y: number) {
  const max = p.skills.some((s) => s.skillId === 'r_trap_volley') ? 6 : 3;
  const mine = state.hazards.filter((h) => h.kind === 'ranger_trap' && h.ownerId === p.slot && h.untilTick > state.tick);
  for (let i = 0; i <= mine.length - max; i++) mine[i].untilTick = state.tick;   // oldest first (array order = creation order)
  state.hazards.push(makeHazard(state, {
    kind: 'ranger_trap', owner: 'player', ownerId: p.slot, x, y, radius: 0.6, outer: trapRadius(p, 1.6),
    untilTick: state.tick + T(15), armTick: state.tick + (has(p, 'r_hair_trigger') ? 0 : T(0.4)),
    damage: hitDamage(state, p, 'r_snare_trap', 'physical').mul(has(p, 'r_blast_traps') ? B(2) : ONE), dtype: 'physical',
  }));
}

/** Trap burst (Snare Trap, Trap Volley, Hunter's Bait): damage, then Snare or knockback, Venom Snare cloud. */
function springTrap(state: SimState, ev: SimEvent[], p: PlayerState, x: number, y: number, R: number, dmg: Big) {
  castEv(ev, p, 'r_trap_spring', x, y, R, 0);
  const hit = enemiesIn(state, x, y, R);
  const dot = poisonDot(state, p, 'r_snare_trap');
  for (const e of hit) {
    hitEnemy(state, ev, e, dmg, ONE, { dtype: 'physical', srcSlot: p.slot, skillId: 'r_snare_trap', fromX: x, fromY: y, coverage: areaCoverage(e, R), allowCrit: true, stagger: 20, dot });
    if (!live(e)) continue;
    if (has(p, 'r_blast_traps')) knockback(state, e, x, y, 1.2);
    else applySnare(state, ev, e, has(p, 'r_venom_snare') ? 2.5 : 1.5);
  }
  if (has(p, 'r_venom_snare')) {
    state.hazards.push(makeHazard(state, {
      kind: 'ranger_cloud', owner: 'player', ownerId: p.slot, x, y, radius: 2, untilTick: state.tick + T(4), interval: T(0.5), nextTick: state.tick + 1,
      damage: hitDamage(state, p, 'r_venom_cloud', 'decay'), dtype: 'decay',
    }));
  }
}

function stepTrap(state: SimState, ev: SimEvent[], p: PlayerState, h: Hazard) {
  if (state.tick < (h.armTick ?? 0)) return;
  if (!state.enemies.some((e) => live(e) && (e.x - h.x) ** 2 + (e.y - h.y) ** 2 <= (h.radius + e.radius) ** 2)) return;
  h.untilTick = state.tick;
  springTrap(state, ev, p, h.x, h.y, h.outer, h.damage);
}

function stepBait(state: SimState, ev: SimEvent[], p: PlayerState, h: Hazard) {
  for (const e of enemiesIn(state, h.x, h.y, 6)) lure(state, e, h.x, h.y, 3);
  if (state.tick < h.untilTick - 1) return;
  h.untilTick = state.tick;
  springTrap(state, ev, p, h.x, h.y, h.outer, h.damage);
}

function stepCloud(state: SimState, ev: SimEvent[], p: PlayerState, h: Hazard) {
  if (state.tick < h.nextTick) return;
  h.nextTick = state.tick + h.interval;
  for (const e of enemiesIn(state, h.x, h.y, h.radius)) {
    hitEnemy(state, ev, e, h.damage, ONE, { dtype: 'decay', srcSlot: p.slot, skillId: 'r_venom_cloud', fromX: h.x, fromY: h.y, coverage: areaCoverage(e, h.radius), allowCrit: false });
  }
}

function stepRain(state: SimState, ev: SimEvent[], p: PlayerState, h: Hazard) {
  if (state.tick < h.nextTick) return;
  h.nextTick = state.tick + h.interval;
  const dot = poisonDot(state, p, 'r_rain_of_arrows');
  for (const e of enemiesIn(state, h.x, h.y, h.radius)) {
    hitEnemy(state, ev, e, h.damage, ONE, { dtype: 'physical', srcSlot: p.slot, skillId: 'r_rain_of_arrows', fromX: h.x, fromY: h.y, coverage: areaCoverage(e, h.radius), allowCrit: true, stagger: 10, dot });
  }
}

// Hawk: generation = phase (0 circling, 1 diving), inner = orbit angle, outer = hawk index, hitSlots[0] = dive target,
// nextTick = next dive, armTick = dive start tick.
function stepHawk(state: SimState, ev: SimEvent[], p: PlayerState, h: Hazard) {
  if (p.lifeState !== 'alive') { h.generation = 0; }
  h.untilTick = Math.max(h.untilTick, state.tick + T(60));
  const apex = has(p, 'r_apex_predator');
  const moveTo = (x: number, y: number, speed: number) => {
    const dx = x - h.x, dy = y - h.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-6) return 0;
    const step = Math.min(d, speed * DT);
    h.x += (dx / d) * step; h.y += (dy / d) * step;
    h.dx = dx / d; h.dy = dy / d;
    return d - step;
  };
  if (h.generation === 1) {
    const target = state.enemies.find((e) => e.id === h.hitSlots[0] && live(e));
    if (!target || state.tick - (h.armTick ?? 0) > T(1.2)) { h.generation = 0; return; }
    const left = moveTo(target.x, target.y, 16);
    if (left <= 0.35 + target.radius) {
      let dmg = hitDamage(state, p, 'r_hawk_dive', 'physical');
      if (has(p, 'r_twin_hawks')) dmg = dmg.mul(B('1.25'));
      if (apex) dmg = dmg.mul(B('1.5'));
      castEv(ev, p, 'r_hawk_strike', target.x, target.y, h.dx, h.dy);
      hitEnemy(state, ev, target, dmg, ONE, { dtype: 'physical', srcSlot: p.slot, skillId: 'r_hawk_dive', fromX: h.x, fromY: h.y, allowCrit: true, stagger: 10, dot: poisonDot(state, p, 'r_hawk_dive') });
      if (apex) markEnemy(state, target, p.slot, 4);
      h.generation = 0;
    }
    return;
  }
  h.inner += 2.4 * DT;
  const a = h.inner + h.outer * Math.PI;
  const ox = p.x + Math.cos(a) * 1.8, oy = p.y + Math.sin(a) * 1.8;
  const left = moveTo(ox, oy, 14);
  if (left < 0.05) { h.dx = -Math.sin(a); h.dy = Math.cos(a); }
  if (state.tick < h.nextTick || p.lifeState !== 'alive') return;
  const pool = enemiesIn(state, p.x, p.y, 8);
  const target = pool.find((e) => isMarkedBy(state, e, p.slot)) ?? pool.find((e) => (e.x - p.x) ** 2 + (e.y - p.y) ** 2 <= (7 + e.radius) ** 2);
  if (!target) return;
  h.nextTick = state.tick + T(apex ? 0.8 : 2);
  h.generation = 1; h.hitSlots = [target.id]; h.armTick = state.tick;
  castEv(ev, p, 'r_hawk_dive', h.x, h.y, target.x, target.y);
}

function ensureHawks(state: SimState, p: PlayerState) {
  if (!has(p, 'r_hawk_companion')) return;
  const want = has(p, 'r_twin_hawks') ? 2 : 1;
  const mine = state.hazards.filter((h) => h.kind === 'ranger_hawk' && h.ownerId === p.slot && h.untilTick > state.tick);
  for (let i = mine.length; i < want; i++) {
    state.hazards.push(makeHazard(state, {
      kind: 'ranger_hawk', owner: 'player', ownerId: p.slot, x: p.x, y: p.y, radius: 0.3, untilTick: state.tick + T(60),
      nextTick: state.tick + T(1 + i), damage: Big.ZERO, dtype: 'physical', outer: i, inner: 0,
    }));
  }
}

// ---------------- casts ----------------

function castRanger(state: SimState, ev: SimEvent[], p: PlayerState, skillId: string): boolean | undefined {
  switch (skillId) {
    case 'r_rain_of_arrows': {
      const [x, y] = aimPoint(state, p, 9);
      state.hazards.push(makeHazard(state, {
        kind: 'ranger_rain', owner: 'player', ownerId: p.slot, x, y, radius: 3.2, untilTick: state.tick + T(3), interval: T(0.25), nextTick: state.tick + T(0.25),
        damage: hitDamage(state, p, skillId, 'physical'), dtype: 'physical',
      }));
      castEv(ev, p, skillId, x, y, p.aimX, p.aimY);
      return true;
    }
    case 'r_multishot': volleyCast(state, ev, p, 1); return true;
    case 'r_barrage': volleyCast(state, ev, p, 2); return true;
    case 'r_longshot': volleyCast(state, ev, p, 3); return true;
    case 'r_hunters_mark': {
      const t = nearAim(state, p, 12)[0];
      if (!t) return false;
      clearOwnMarks(state, p);
      markEnemy(state, t, p.slot, markSec(p));
      if ((p.vars.ffId ?? -1) !== t.id) { p.vars.ffId = t.id; p.vars.ui_focus = 0; }
      hitMarked(state, ev, p, t, skillId);
      return true;
    }
    case 'r_deadeye': {
      const targets = nearAim(state, p, 12).slice(0, 3);
      if (!targets.length) return false;
      clearOwnMarks(state, p);
      for (const t of targets) markEnemy(state, t, p.slot, markSec(p));
      for (const t of targets) hitMarked(state, ev, p, t, skillId);
      return true;
    }
    case 'r_power_shot': {
      castEv(ev, p, skillId, p.x, p.y, p.aimX, p.aimY);
      fireArrows(state, p, { skillId, total: playerDerived(state, p).projectileCount, spreadDeg: 4, kind: 'ranger_heavy' });
      return true;
    }
    case 'r_snare_trap': {
      const [x, y] = aimPoint(state, p, 7);
      placeTrap(state, p, x, y);
      castEv(ev, p, skillId, x, y, p.aimX, p.aimY);
      return true;
    }
    case 'r_trap_volley': {
      for (const deg of [-25, 0, 25]) {
        const a = deg * Math.PI / 180;
        const dx = p.aimX * Math.cos(a) - p.aimY * Math.sin(a), dy = p.aimX * Math.sin(a) + p.aimY * Math.cos(a);
        const [x, y] = aimPoint(state, p, 7, dx, dy);
        placeTrap(state, p, x, y);
        castEv(ev, p, 'r_snare_trap', x, y, dx, dy);
      }
      castEv(ev, p, skillId, p.x, p.y, p.aimX, p.aimY);
      return true;
    }
    case 'r_bait': {
      const [x, y] = aimPoint(state, p, 8);
      state.hazards.push(makeHazard(state, {
        kind: 'ranger_bait', owner: 'player', ownerId: p.slot, x, y, radius: 6, outer: trapRadius(p, 2.2), untilTick: state.tick + T(2.5),
        damage: hitDamage(state, p, skillId, 'physical').mul(has(p, 'r_blast_traps') ? B(2) : ONE), dtype: 'physical',
      }));
      castEv(ev, p, skillId, x, y, p.aimX, p.aimY);
      return true;
    }
  }
  return undefined;
}

// ---------------- hooks ----------------

registerClassHooks('ranger', {
  castSkill: castRanger,

  basicAttack(state, ev, p, k) {
    const pd = playerDerived(state, p);
    let total = k.mul(pd.projectileCount);
    let spread = 8;
    if ((p.vars.rhythm ?? 0) > 0) { total = total.add(k.mul(B(2))); spread = 10; p.vars.rhythm = (p.vars.rhythm ?? 0) - 1; }
    const steady = has(p, 'r_steady_aim') && (p.vars.still ?? 0) >= T(0.75);
    castEv(ev, p, 'r_quick_shot', p.x, p.y, p.aimX, p.aimY, k.gt(ONE) ? k.toCompact() : undefined);
    fireArrows(state, p, { skillId: 'r_quick_shot', total, spreadDeg: spread, pierce: steady ? 1 : 0 });
    return true;
  },

  onEnemyHit(state, ev, p, e, info) {
    if (!p) return;
    const sid = info.skillId ?? '';
    const gen = info.generation;
    const marked = isMarkedBy(state, e, p.slot);
    if (sid === 'r_power_shot' && gen === 0) {
      if (!hasLiveMark(state, p) && live(e)) { markEnemy(state, e, p.slot, markSec(p)); castEv(ev, p, 'r_mark_applied', e.x, e.y, 0, 0); }
      if (live(e)) knockback(state, e, p.x, p.y, 1);
    }
    if (gen === 0 && (VOLLEY_ARROWS.has(sid) || sid === 'r_ricochet') && has(p, 'r_explosive_tips')) {
      castEv(ev, p, 'r_explosion', e.x, e.y, 0, 0);
      const dmg = hitDamage(state, p, 'r_explosion', 'physical');
      for (const o of enemiesIn(state, e.x, e.y, 1.2)) {
        if (o === e) continue;
        hitEnemy(state, ev, o, dmg, ONE, { dtype: 'physical', srcSlot: p.slot, skillId: 'r_explosion', fromX: e.x, fromY: e.y, coverage: areaCoverage(o, 1.2), allowCrit: false, generation: 1, dot: poisonDot(state, p, 'r_explosion') });
      }
    }
    if (gen === 0 && VOLLEY_ARROWS.has(sid) && has(p, 'r_ricochet')) {
      const next = enemiesIn(state, e.x, e.y, 5).find((o) => o !== e);
      if (next) fireArrows(state, p, { skillId: 'r_ricochet', total: ONE, spreadDeg: 0, x: e.x, y: e.y, dirX: next.x - e.x, dirY: next.y - e.y, hitIds: [e.id] });
    }
    if (marked && gen === 0 && has(p, 'r_focus_fire')) {
      if ((p.vars.ffId ?? -1) === e.id) p.vars.ui_focus = Math.min(10, (p.vars.ui_focus ?? 0) + 1);
      else { p.vars.ffId = e.id; p.vars.ui_focus = 1; }
    }
    if (marked && e.boss && gen === 0 && has(p, 'r_exposed') && !INDIRECT.has(sid)) addStagger(state, ev, e, 25);
    if (marked && info.crit && !e.boss && has(p, 'r_headshot') && live(e) && cohortHpFrac(e.cohort) < 0.2) execute(state, ev, p, e);
  },

  onDodge(state, ev, p) {
    if (has(p, 'r_wind_dancer')) { p.vars.wdN = 3; p.vars.wdU = state.tick + T(3); }
    if (has(p, 'r_tumble_shot')) {
      const n = has(p, 'r_wind_dancer') ? 5 : 3;
      castEv(ev, p, 'r_tumble_shot', p.x, p.y, p.aimX, p.aimY);
      fireArrows(state, p, { skillId: 'r_tumble_shot', total: B(n).mul(playerDerived(state, p).projectileCount), spreadDeg: 14 });
    }
  },

  onPlayerTick(state, ev, p) {
    // Steady Aim stillness
    const moving = Math.abs(p.vx) + Math.abs(p.vy) > 0.05;
    p.vars.still = moving ? 0 : Math.min(1e6, (p.vars.still ?? 0) + 1);
    if (has(p, 'r_steady_aim')) p.vars.ui_steady = p.vars.still >= T(0.75) ? 1 : 0;
    // Point Blank spring
    const sp = p.vars.spT ?? 0;
    if (sp > 0 && state.map) {
      const r = moveCircle(state.map, p.x, p.y, p.vars.spX ?? 0, p.vars.spY ?? 0, RULES.playerRadius);
      p.x = r.x; p.y = r.y;
      p.vars.spT = sp - 1;
    }
    // Barrage follow-up fans
    if ((p.vars.brN ?? 0) > 0 && state.tick >= (p.vars.brT ?? 0)) {
      p.vars.brN = (p.vars.brN ?? 0) - 1;
      p.vars.brT = state.tick + T(0.15);
      castEv(ev, p, 'r_barrage_fan', p.x, p.y, p.aimX, p.aimY);
      fan(state, p, 'r_barrage', p.vars.brM ?? 1);
    }
    // Echoing Volley
    if ((p.vars.ecT ?? 0) > 0 && state.tick >= (p.vars.ecT ?? 0)) {
      const code = p.vars.ecS ?? 1;
      p.vars.ecT = 0;
      volley(state, ev, p, code, 0.7);
    }
    ensureHawks(state, p);
  },

  hazardTick(state, ev, h) {
    if (!h.kind.startsWith('ranger_')) return undefined;
    if (h.untilTick <= state.tick) return true;   // removed earlier this tick (e.g. a culled trap)
    const p = state.players[h.ownerId];
    if (!p) { h.untilTick = state.tick; return true; }
    switch (h.kind) {
      case 'ranger_rain': stepRain(state, ev, p, h); break;
      case 'ranger_trap': stepTrap(state, ev, p, h); break;
      case 'ranger_bait': stepBait(state, ev, p, h); break;
      case 'ranger_cloud': stepCloud(state, ev, p, h); break;
      case 'ranger_hawk': if (has(p, 'r_hawk_companion')) stepHawk(state, ev, p, h); else h.untilTick = state.tick; break;
    }
    return true;
  },

  extraCharges(p, skillId) {
    return has(p, 'r_arrow_storm') && VOLLEY.includes(skillId) ? 1 : 0;
  },

  modifyHit(state, p, e, info, mod) {
    const sid = info.skillId;
    const marked = isMarkedBy(state, e, p.slot);
    if (marked) {
      mod.critMul = mod.critMul.mul(B(3));
      const lm = rank(p, 'r_lingering_mark');
      if (lm) mod.dmg = mod.dmg.mul(B('1.05').powInt(lm));
      if (has(p, 'r_focus_fire') && (p.vars.ffId ?? -1) === e.id && (p.vars.ui_focus ?? 0) > 0) mod.dmg = mod.dmg.mul(B('1.04').powInt(p.vars.ui_focus ?? 0));
      if (sid === 'r_power_shot') { mod.forceCrit = true; mod.critDmg = mod.critDmg.mul(B('1.5')); }
      if (e.boss && has(p, 'r_headshot')) mod.critDmg = mod.critDmg.mul(B('1.3'));
    }
    const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (sid === 'r_longshot' && d2 > 36) mod.dmg = mod.dmg.mul(B('1.6'));
    if (VOLLEY_ARROWS.has(sid) && has(p, 'r_point_blank') && d2 <= 3.5 * 3.5) mod.dmg = mod.dmg.mul(B('1.5'));
    if (has(p, 'r_steady_aim') && (p.vars.still ?? 0) >= T(0.75)) { mod.critMul = mod.critMul.mul(B(2)); mod.critDmg = mod.critDmg.mul(B('1.3')); }
    if (has(p, 'r_wind_dancer') && (p.vars.wdN ?? 0) > 0 && state.tick < (p.vars.wdU ?? 0) && info.generation === 0 && !INDIRECT.has(sid)) {
      p.vars.wdN = (p.vars.wdN ?? 0) - 1;
      mod.forceCrit = true;
      mod.critDmg = mod.critDmg.mul(B('1.25'));
    }
  },
});

// Party-wide Ranger effects: Exposed Weakness (damage taken from everyone), Predator's Mark leap and Plague Bearer
// spread (they must fire whoever lands the hit or the kill).
registerGlobalHooks({
  modifyHit(state, _p, e, _info, mod) {
    if (!e.ccVars) return;
    for (const r of state.players) {
      if (r.classId === 'ranger' && has(r, 'r_exposed') && isMarkedBy(state, e, r.slot)) { mod.dmg = mod.dmg.mul(B('1.25')); return; }
    }
  },
  onKill(state, ev, e) {
    for (const r of state.players) {
      if (r.classId !== 'ranger' || r.lifeState !== 'alive') continue;
      if (has(r, 'r_predator') && isMarkedBy(state, e, r.slot)) {
        clearMark(e, r.slot);
        const next = enemiesIn(state, e.x, e.y, 8).find((o) => o !== e);
        if (next) {
          markEnemy(state, next, r.slot, markSec(r));
          castEv(ev, r, 'r_mark_leap', e.x, e.y, next.x, next.y);
        }
        for (const s of r.skills) if (MARKSMAN.includes(s.skillId)) { s.charges = s.maxCharges; s.cooldown = 0; }
      }
      if (has(r, 'r_plague_bearer')) {
        let perSec = Big.ZERO;
        for (const d of e.dots) if (d.src === r.slot && d.type === 'decay' && d.until > state.tick) perSec = perSec.add(d.perSec);
        if (perSec.isZero()) continue;
        const near = enemiesIn(state, e.x, e.y, 3).filter((o) => o !== e);
        if (!near.length) continue;
        castEv(ev, r, 'r_plague_spread', e.x, e.y, 3, 0);
        for (const o of near) addDot(state, o, r.slot, 'decay', perSec, 4);
      }
    }
  },
});
