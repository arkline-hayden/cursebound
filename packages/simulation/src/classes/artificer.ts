import { Big } from '@cursebound/numeric';
import { RULES, SKILL_BY_ID, TICK_SEC, type DamageType } from '@cursebound/content';
import { addStagger, healPlayer, hitEnemy, shieldPlayer } from '../combat';
import { inCone, lineOfSight, moveCircle, norm, q, rayDistance } from '../geometry';
import { registerClassHooks } from '../hooks';
import { nearestFloor } from '../map';
import { areaCoverage, cosHalf, cutCooldowns, flinch, knockback, livingEnemies, makeHazard, newProjectileId, spawnPlayerProjectiles } from '../players';
import { nextFloat } from '../rng';
import { B, ONE, hitDamage, playerDerived, toFloatClamped, treeFactor } from '../stats';
import { ACTION, type EnemyState, type Hazard, type PlayerState, type SimEvent, type SimState } from '../types';

// Artificer kit (content: packages/content/src/classes/artificer.ts). Deterministic: state, the combat rng stream
// (cluster scatter, mortar ring phase, fractional projectile counts) and inputs only.
// Player hazards (snapshot fields the client reads):
//   af_turret / af_flame_turret / af_tesla_coil  dx,dy = barrel direction, r = range, b/u = deploy/expiry ticks
//   af_shell     mortar shell: b = call tick, u - 1 = landing tick, r = blast radius
//   af_grenade   in-flight grenade: x,y = landing point, dx,dy = throw direction, len = throw distance (origin =
//                x - dx*len, y - dy*len), b = throw tick, u - 1 = detonation tick, r = blast radius,
//                in = variant (0 steam, 1 cluster, 2 firebomb; +4 = Heavy Ordnance shell)
//   af_bomblet   cluster bomblet: dx,dy/len = scatter vector from its parent blast, u - 1 = detonation tick
//   af_mine      proximity mine (armed once the tick passes b + 24), r = blast radius
//   af_fire      burning ground (generic damage pulse); af_boiler  steam cloud centred on its owner
//   af_drone     clockwork drone (position updated every tick), in = drone index
// Hazard scratch fields: turrets use `inner` as the Sentry Network cooldown tick and `outer` as a forced target id.
// Cosmetic cast events: af_fx_blast (x,y, dx = radius, dy = style: 0 grenade, 1 bomblet/cluster, 2 mortar,
// 3 turret self-destruct, 4 steam, 5 heavy shell, 6 firebomb, 7 rocket landing, 8 chain reaction),
// af_fx_zap (x,y -> dx,dy), af_fx_flame / af_fx_turret_shot (x,y turret, dx,dy direction).

const DT = TICK_SEC;
const ZERO = Big.ZERO;
const T = (sec: number) => Math.round(sec / DT);
const rank = (p: PlayerState, id: string) => p.ranks[id] ?? 0;
const has = (p: PlayerState, id: string) => (p.ranks[id] ?? 0) > 0;
/** Steam Engine: seconds cut from every recharging skill per kill while overclocked. */
const STEAM_ENGINE_CUT = 0.3;

const FAMILY: Record<string, 'af_turret' | 'af_grenade' | 'af_overclock'> = {
  af_turret: 'af_turret', af_flame_turret: 'af_turret', af_tesla_coil: 'af_turret',
  af_grenade: 'af_grenade', af_cluster_charge: 'af_grenade', af_firebomb: 'af_grenade',
  af_overclock: 'af_overclock', af_rocket_jump: 'af_overclock', af_boiler_overdrive: 'af_overclock',
};
const SLOT = { af_turret: 0, af_grenade: 1, af_overclock: 2 } as const;
const TURRETS = new Set(['af_turret', 'af_flame_turret', 'af_tesla_coil']);
const FIRE_DOT = { type: 'ember' as const, fractionPerSec: '0.25', durationSec: 3 };
const GROUND_DOT = { type: 'ember' as const, fractionPerSec: '0.2', durationSec: 3 };

const alive = (e: EnemyState) => e.state !== 'dying' && !e.cohort.count.isZero();
const d2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;

function fx(ev: SimEvent[], p: PlayerState, skill: string, x: number, y: number, dx: number, dy: number) {
  ev.push({ t: 'cast', slot: p.slot, skill, x, y, dx, dy });
}

/** Family skill damage: own coefficient x the base skill's tree damage factor (evolutions inherit it). */
function famHit(state: SimState, p: PlayerState, skillId: string, dtype: DamageType): Big {
  const base = FAMILY[skillId];
  let d = hitDamage(state, p, skillId, dtype);
  if (base && base !== skillId) d = d.mul(treeFactor(p, `skill.${base}.damage`).factor);
  return d;
}

function baseHit(state: SimState, p: PlayerState, dtype: DamageType, coef: string): Big {
  const pd = playerDerived(state, p);
  return pd.damage.mul(pd.typeMult[dtype]).mul(B(coef));
}

function overclocked(state: SimState, p: PlayerState) {
  return p.buffs.some((b) => b.id === 'af_overclock' && b.until > state.tick);
}

function myHazards(state: SimState, p: PlayerState, pred: (h: Hazard) => boolean): Hazard[] {
  return state.hazards.filter((h) => h.owner === 'player' && h.ownerId === p.slot && h.untilTick > state.tick && pred(h));
}

function nearestFrom(state: SimState, x: number, y: number, range: number, skip?: (e: EnemyState) => boolean): EnemyState | null {
  let best: EnemyState | null = null; let bd = Infinity;
  for (const e of livingEnemies(state)) {
    if (skip?.(e)) continue;
    const d = d2(e.x, e.y, x, y);
    if (d > (range + e.radius) ** 2) continue;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function anyWithin(state: SimState, x: number, y: number, r: number) {
  return livingEnemies(state).some((e) => d2(e.x, e.y, x, y) <= (r + e.radius) ** 2);
}

/** A floor point up to `dist` along (dx,dy) from the player, stopping before walls. */
function placePoint(state: SimState, p: PlayerState, dx: number, dy: number, dist: number): [number, number] {
  const map = state.map!;
  const free = rayDistance(map, p.x, p.y, dx, dy, dist);
  const d = free >= dist - 1e-6 ? dist : Math.max(0, free - 0.3);
  const [x, y] = nearestFloor(map, p.x + dx * d, p.y + dy * d);
  return [q(x), q(y)];
}

function aimDist(p: PlayerState, lo: number, hi: number) {
  return Math.min(Math.max(p.aimDist || (lo + hi) / 2, lo), hi);
}

function stun(state: SimState, ev: SimEvent[], e: EnemyState, sec: number, bossStagger: number) {
  if (!alive(e)) return;
  if (e.boss) { addStagger(state, ev, e, bossStagger); return; }
  const s = e.ccResistUntil > state.tick ? sec * 0.3 : sec;
  e.staggerUntil = Math.max(e.staggerUntil, state.tick + T(s));
  if (e.attack) state.telegraphs = state.telegraphs.filter((t) => t.ownerId !== e.id);
  e.attack = null; e.state = 'stagger';
  e.ccResistUntil = state.tick + T(RULES.crowdControlResistSec);
}

/** Logical projectile multiplicity (Player projectile count) for a deployable's shot; residue via the combat stream. */
function projWeight(state: SimState, p: PlayerState): Big {
  const total = playerDerived(state, p).projectileCount;
  const whole = total.floorInt();
  let n = whole;
  const frac = total.sub(Big.from(whole)).toNumber();
  if (frac > 0 && nextFloat(state.rng.combat) < frac) n += 1n;
  return Big.from(n);
}

function skillSlot(p: PlayerState, family: keyof typeof SLOT) {
  const s = p.skills[SLOT[family]];
  return s && s.skillId && FAMILY[s.skillId] === family ? s : null;
}

// ---------------- explosions ----------------

interface BlastOpts {
  skillId: string; dtype: DamageType; style: number;
  kb?: number; stagger?: number; stun?: number;
  dot?: { type: DamageType; fractionPerSec: string; durationSec: number };
  gen?: number;
}

function blast(state: SimState, ev: SimEvent[], p: PlayerState, x: number, y: number, R: number, dmg: Big, o: BlastOpts): number {
  let n = 0;
  for (const e of livingEnemies(state)) {
    if (d2(e.x, e.y, x, y) > (R + e.radius) ** 2) continue;
    hitEnemy(state, ev, e, dmg, ONE, { dtype: o.dtype, srcSlot: p.slot, skillId: o.skillId, fromX: x, fromY: y, coverage: areaCoverage(e, R), allowCrit: true, stagger: o.stagger, dot: o.dot, generation: o.gen });
    n++;
    if (!alive(e)) continue;
    // a dead-centre hit has no outward direction: throw the target away from the artificer instead
    if (o.kb) { const centre = d2(e.x, e.y, x, y) < 1e-6; knockback(state, e, centre ? p.x : x, centre ? p.y : y, o.kb); }
    if (o.stun) stun(state, ev, e, o.stun, 0);
  }
  fx(ev, p, 'af_fx_blast', x, y, R, o.style);
  return n;
}

// ---------------- Turrets ----------------

function turretDuration(p: PlayerState) {
  let d = 10;
  for (let i = 0; i < rank(p, 'af_extended_service'); i++) d *= 1.2;
  return d;
}

function deployTurret(state: SimState, ev: SimEvent[], p: PlayerState, skillId: string) {
  const kind = skillId === 'af_flame_turret' ? 'af_flame_turret' : skillId === 'af_tesla_coil' ? 'af_tesla_coil' : 'af_turret';
  const [x, y] = placePoint(state, p, p.aimX, p.aimY, aimDist(p, 1, 4));
  const range = kind === 'af_flame_turret' ? 4 : kind === 'af_tesla_coil' ? 6 : 7;
  const interval = kind === 'af_flame_turret' ? T(0.25) : kind === 'af_tesla_coil' ? T(0.8) : T(0.5);
  const dtype: DamageType = kind === 'af_flame_turret' ? 'ember' : kind === 'af_tesla_coil' ? 'storm' : 'physical';
  const existing = myHazards(state, p, (h) => TURRETS.has(h.kind)).sort((a, b) => a.bornTick - b.bornTick || a.id - b.id);
  const max = has(p, 'af_twin_deploy') ? 3 : 2;
  // the oldest beyond the limit expires this tick (and self-destructs if able)
  for (let i = 0; i <= existing.length - max; i++) existing[i].untilTick = Math.min(existing[i].untilTick, state.tick + 1);
  state.hazards.push(makeHazard(state, {
    kind, owner: 'player', ownerId: p.slot, x, y, dx: p.aimX, dy: p.aimY, radius: range,
    untilTick: state.tick + T(turretDuration(p)), interval, nextTick: state.tick + T(0.35),
    damage: famHit(state, p, skillId, dtype), dtype, inner: 0, outer: 0,
    ...(kind === 'af_flame_turret' ? { dot: FIRE_DOT } : {}),
  }));
  fx(ev, p, skillId, x, y, p.aimX, p.aimY);
}

function turretTarget(state: SimState, h: Hazard): EnemyState | null {
  let best: EnemyState | null = null; let bd = Infinity;
  for (const e of livingEnemies(state)) {
    const d = d2(e.x, e.y, h.x, h.y);
    if (d > (h.radius + e.radius) ** 2 || d >= bd) continue;
    if (state.map && !lineOfSight(state.map, h.x, h.y, e.x, e.y)) continue;
    bd = d; best = e;
  }
  return best;
}

function turretAttack(state: SimState, ev: SimEvent[], p: PlayerState, h: Hazard, tgt: EnemyState) {
  let [dx, dy] = norm(tgt.x - h.x, tgt.y - h.y);
  if (dx === 0 && dy === 0) { dx = h.dx; dy = h.dy; }
  h.dx = dx; h.dy = dy;
  if (h.kind === 'af_turret') {
    const weight = projWeight(state, p);
    if (weight.isZero()) return;
    state.projectiles.push({
      id: newProjectileId(state), kind: 'af_turret_bolt', owner: 'player', ownerId: p.slot,
      x: h.x + dx * 0.35, y: h.y + dy * 0.35, vx: dx * 16, vy: dy * 16, radius: 0.18, range: h.radius + 1.5,
      damage: h.damage, weight, dtype: 'physical', pierce: has(p, 'af_marking_rounds') ? 1 : 0, hitIds: [],
      skillId: 'af_turret', crit: false, lobTarget: null, bornTick: state.tick,
    });
    fx(ev, p, 'af_fx_turret_shot', h.x, h.y, dx, dy);
  } else if (h.kind === 'af_flame_turret') {
    const ch = cosHalf(60);
    for (const e of livingEnemies(state)) {
      if (!inCone(h.x, h.y, dx, dy, h.radius, ch, e.x, e.y, e.radius)) continue;
      hitEnemy(state, ev, e, h.damage, ONE, { dtype: 'ember', srcSlot: p.slot, skillId: 'af_turret', fromX: h.x, fromY: h.y, coverage: areaCoverage(e, 1.5), allowCrit: true, dot: h.dot });
    }
    fx(ev, p, 'af_fx_flame', h.x, h.y, dx, dy);
  } else {
    const hit: number[] = [];
    let from = { x: h.x, y: h.y };
    let cur: EnemyState | null = tgt;
    while (cur && hit.length <= 3) {
      hit.push(cur.id);
      fx(ev, p, 'af_fx_zap', from.x, from.y, cur.x, cur.y);
      from = { x: cur.x, y: cur.y };
      hitEnemy(state, ev, cur, h.damage, ONE, { dtype: 'storm', srcSlot: p.slot, skillId: 'af_turret', fromX: h.x, fromY: h.y, allowCrit: true });
      cur = nearestFrom(state, from.x, from.y, 3.5, (e) => hit.includes(e.id));
    }
  }
}

function turretTick(state: SimState, ev: SimEvent[], p: PlayerState, h: Hazard) {
  if (state.tick === h.untilTick - 1 && has(p, 'af_self_destruct')) {
    const dmg = baseHit(state, p, 'physical', '2.5').mul(treeFactor(p, 'skill.af_turret.damage').factor);
    blast(state, ev, p, h.x, h.y, 2.2, dmg, { skillId: 'af_self_destruct', dtype: 'physical', style: 3, kb: 1.2, stagger: 40 });
    return;
  }
  if (h.outer) {   // Sentry Network: attack the enemy your bolt just hit
    const forced = state.enemies.find((e) => e.id === h.outer && alive(e));
    h.outer = 0;
    if (forced && d2(forced.x, forced.y, h.x, h.y) <= (h.radius + forced.radius) ** 2) turretAttack(state, ev, p, h, forced);
  }
  if (state.tick < h.nextTick) return;
  const tgt = turretTarget(state, h);
  if (!tgt) { h.nextTick = state.tick + 6; return; }
  turretAttack(state, ev, p, h, tgt);
  let rate = 1;
  if (has(p, 'af_turret_link')) {
    for (const o of state.hazards) if (o !== h && TURRETS.has(o.kind) && o.ownerId === h.ownerId && o.untilTick > state.tick && d2(o.x, o.y, h.x, h.y) <= 36) rate *= 1.25;
  }
  if (has(p, 'af_fortress_protocol') && p.lifeState === 'alive' && d2(p.x, p.y, h.x, h.y) <= 3.5 * 3.5) rate *= 1.5;
  h.nextTick = state.tick + Math.max(1, Math.round(h.interval / rate));
}

// ---------------- Ordnance ----------------

function grenadeRadiusFactor(p: PlayerState) {
  return toFloatClamped(treeFactor(p, 'skill.af_grenade.radius').factor, 50);
}

function throwGrenades(state: SimState, ev: SimEvent[], p: PlayerState, skillId: string) {
  const variant = skillId === 'af_cluster_charge' ? 1 : skillId === 'af_firebomb' ? 2 : 0;
  const heavy = has(p, 'af_heavy_ordnance');
  const carpet = has(p, 'af_carpet_bomber');
  let R = (variant === 1 ? 1.6 : variant === 2 ? 2 : 1.8) * grenadeRadiusFactor(p);
  let dmg = famHit(state, p, skillId, 'ember');
  let flight = 0.45;
  for (let i = 0; i < rank(p, 'af_quick_fuse'); i++) flight *= 0.8;
  if (heavy) { dmg = dmg.mul(B('2.5')); R *= 1.6; flight += 0.55; }
  if (carpet) dmg = dmg.mul(B('0.6'));
  const dist = aimDist(p, 1, 7);
  for (const deg of carpet ? [-15, 0, 15] : [0]) {
    const a = (deg * Math.PI) / 180;
    const c = Math.cos(a), s = Math.sin(a);
    const dx = p.aimX * c - p.aimY * s, dy = p.aimX * s + p.aimY * c;
    const [x, y] = placePoint(state, p, dx, dy, dist);
    const land = state.tick + Math.max(1, T(flight));
    state.hazards.push(makeHazard(state, {
      kind: 'af_grenade', owner: 'player', ownerId: p.slot, x, y, dx, dy, length: Math.hypot(x - p.x, y - p.y), radius: R,
      inner: variant + (heavy ? 4 : 0), untilTick: land + 1, nextTick: land, interval: 99999, damage: dmg, dtype: 'ember',
    }));
  }
  fx(ev, p, skillId, p.x, p.y, p.aimX, p.aimY);
}

function detonateGrenade(state: SimState, ev: SimEvent[], p: PlayerState, h: Hazard) {
  const variant = h.inner & 3;
  const heavy = h.inner >= 4;
  const conc = has(p, 'af_concussive');
  blast(state, ev, p, h.x, h.y, h.radius, h.damage, {
    skillId: 'af_grenade', dtype: 'ember', style: heavy ? 5 : variant === 1 ? 1 : variant === 2 ? 6 : 0,
    kb: 0.8 * (conc ? 2 : 1), stagger: (heavy ? 120 : 35) + (conc ? 40 : 0), stun: conc ? 0.6 : 0, dot: variant === 2 ? FIRE_DOT : undefined,
  });
  const rf = grenadeRadiusFactor(p);
  if (variant === 1) {
    for (let i = 0; i < 4; i++) {
      const a = ((i * 90 + nextFloat(state.rng.combat) * 60) * Math.PI) / 180;
      const dist = 1.5 + nextFloat(state.rng.combat);
      const dx = Math.cos(a), dy = Math.sin(a);
      const [bx, by] = state.map ? nearestFloor(state.map, h.x + dx * dist, h.y + dy * dist) : [h.x, h.y];
      const land = state.tick + T(0.3);
      state.hazards.push(makeHazard(state, {
        kind: 'af_bomblet', owner: 'player', ownerId: p.slot, x: q(bx), y: q(by), dx, dy, length: dist, radius: 1.1 * rf,
        untilTick: land + 1, nextTick: land, interval: 99999, damage: h.damage.mul(B('0.5')), dtype: 'ember',
      }));
    }
  } else if (variant === 2) {
    state.hazards.push(makeHazard(state, {
      kind: 'af_fire', owner: 'player', ownerId: p.slot, x: h.x, y: h.y, radius: h.radius * 1.1,
      untilTick: state.tick + T(4), interval: T(0.5), nextTick: state.tick + T(0.5), damage: h.damage.mul(B('0.25')), dtype: 'ember', dot: GROUND_DOT,
    }));
  }
}

function mortar(state: SimState, ev: SimEvent[], p: PlayerState) {
  const [tx, ty] = placePoint(state, p, p.aimX, p.aimY, aimDist(p, 1, 8));
  const dmg = hitDamage(state, p, 'af_mortar_barrage', 'ember');
  const phase = nextFloat(state.rng.combat) * Math.PI * 2;
  for (let i = 0; i < 8; i++) {
    let x = tx, y = ty;
    if (i > 0) { const a = phase + ((i - 1) * Math.PI * 2) / 7; x += Math.cos(a) * 2.2; y += Math.sin(a) * 2.2; }
    if (state.map) [x, y] = nearestFloor(state.map, x, y);
    const land = state.tick + T(0.6) + i * 9;
    state.hazards.push(makeHazard(state, {
      kind: 'af_shell', owner: 'player', ownerId: p.slot, x: q(x), y: q(y), radius: 1.4, inner: i,
      untilTick: land + 1, nextTick: land, interval: 99999, damage: dmg, dtype: 'ember',
    }));
  }
  // x,y = caster, dx,dy = barrage centre
  fx(ev, p, 'af_mortar_barrage', p.x, p.y, tx, ty);
}

// ---------------- Clockwork ----------------

function startOverclock(state: SimState, ev: SimEvent[], p: PlayerState, sec: number) {
  const dur = sec * (has(p, 'af_steam_engine') ? 1.6 : 1);
  p.buffs = p.buffs.filter((b) => b.id !== 'af_overclock');
  p.buffs.push({ id: 'af_overclock', until: state.tick + T(dur), value: 1 });
  if (has(p, 'af_aegis_protocol')) { shieldPlayer(state, ev, p, p.maxHp.mul(B('0.08'))); p.vars.aegisT = state.tick; }
}

function steamBlast(state: SimState, ev: SimEvent[], p: PlayerState, skillId: string, style: number) {
  blast(state, ev, p, p.x, p.y, 2.2, famHit(state, p, skillId, 'ember'), { skillId, dtype: 'ember', style, kb: 1.4, stagger: 30 });
}

function droneCount(p: PlayerState) {
  if (!has(p, 'af_drone')) return 0;
  return has(p, 'af_clockwork_legion') ? 3 : 1;
}

function maintainDrones(state: SimState, p: PlayerState) {
  const want = droneCount(p);
  if (!want) return;
  const drones = myHazards(state, p, (h) => h.kind === 'af_drone');
  for (let i = 0; i < want; i++) {
    let h = drones.find((d) => d.inner === i);
    if (!h) {
      h = makeHazard(state, {
        kind: 'af_drone', owner: 'player', ownerId: p.slot, x: p.x, y: p.y, radius: 5, inner: i,
        untilTick: state.tick + 3, interval: T(0.7), nextTick: state.tick + T(0.5), damage: ZERO, dtype: 'storm',
      });
      state.hazards.push(h);
    }
    const a = state.tick * 0.06 + (i * Math.PI * 2) / want;
    const c = Math.cos(a), s = Math.sin(a);
    h.x = q(p.x + c * 1.3); h.y = q(p.y + s * 1.3);
    h.dx = c; h.dy = s;
    h.untilTick = state.tick + 3;
  }
}

function droneTick(state: SimState, ev: SimEvent[], p: PlayerState, h: Hazard) {
  if (state.tick < h.nextTick) return;
  const tgt = nearestFrom(state, h.x, h.y, h.radius);
  if (!tgt) { h.nextTick = state.tick + 6; return; }
  let dmg = famHit(state, p, 'af_drone_zap', 'storm');
  if (has(p, 'af_clockwork_legion')) dmg = dmg.mul(B('0.8'));
  hitEnemy(state, ev, tgt, dmg, ONE, { dtype: 'storm', srcSlot: p.slot, skillId: 'af_drone_zap', fromX: h.x, fromY: h.y, allowCrit: true });
  fx(ev, p, 'af_fx_zap', h.x, h.y, tgt.x, tgt.y);
  h.nextTick = state.tick + (overclocked(state, p) ? T(0.35) : h.interval);
}

function killSteam(state: SimState, p: PlayerState) {
  if (has(p, 'af_steam_engine') && overclocked(state, p)) {
    cutCooldowns(p, STEAM_ENGINE_CUT);   // no resource: overclocked kills speed every recharging skill
  }
}

// ---------------- hooks ----------------

registerClassHooks('artificer', {
  basicAttack(state, ev, p, k) {
    const skill = SKILL_BY_ID['af_repeater'];
    const pd = playerDerived(state, p);
    const n0 = state.projectiles.length;
    spawnPlayerProjectiles(state, ev, p, skill, k.mul(pd.projectileCount), hitDamage(state, p, 'af_repeater', 'physical'), 'af_bolt');
    if (overclocked(state, p)) for (let i = n0; i < state.projectiles.length; i++) state.projectiles[i].pierce += 1;
    ev.push({ t: 'cast', slot: p.slot, skill: 'af_repeater', x: p.x, y: p.y, dx: p.aimX, dy: p.aimY, count: k.gt(ONE) ? k.toCompact() : undefined });
    return true;
  },

  castSkill(state, ev, p, skillId) {
    switch (skillId) {
      case 'af_turret':
      case 'af_flame_turret':
      case 'af_tesla_coil':
        deployTurret(state, ev, p, skillId);
        return true;
      case 'af_grenade':
      case 'af_cluster_charge':
      case 'af_firebomb':
        throwGrenades(state, ev, p, skillId);
        return true;
      case 'af_overclock':
        steamBlast(state, ev, p, skillId, 4);
        startOverclock(state, ev, p, 5);
        fx(ev, p, skillId, p.x, p.y, p.aimX, p.aimY);
        return true;
      case 'af_rocket_jump': {
        const dist = aimDist(p, 1.5, 4.5);
        steamBlast(state, ev, p, skillId, 4);
        p.vars.rjLeft = 15;
        p.vars.rjFX = p.x;
        p.vars.rjFY = p.y;
        p.vars.rjDX = (p.aimX * dist) / 15;
        p.vars.rjDY = (p.aimY * dist) / 15;
        p.iframes = Math.max(p.iframes, 0.3);
        startOverclock(state, ev, p, 5);
        // x,y = launch point, dx,dy = intended landing point
        fx(ev, p, skillId, p.x, p.y, p.x + p.aimX * dist, p.y + p.aimY * dist);
        return true;
      }
      case 'af_boiler_overdrive':
        state.hazards = state.hazards.filter((h) => !(h.kind === 'af_boiler' && h.ownerId === p.slot));
        state.hazards.push(makeHazard(state, {
          kind: 'af_boiler', owner: 'player', ownerId: p.slot, x: p.x, y: p.y, radius: 2.4,
          untilTick: state.tick + T(4), interval: T(0.4), nextTick: state.tick, damage: famHit(state, p, skillId, 'ember'), dtype: 'ember',
        }));
        startOverclock(state, ev, p, 6);
        fx(ev, p, skillId, p.x, p.y, p.aimX, p.aimY);
        return true;
      case 'af_mortar_barrage':
        mortar(state, ev, p);
        return true;
    }
    return undefined;
  },

  onEnemyHit(state, ev, p, e, info) {
    if (!p) return;
    if (info.skillId === 'af_turret' && has(p, 'af_marking_rounds')) {
      if (e.vulnUntil <= state.tick || e.vulnFactor === '1.1') { e.vulnFactor = '1.1'; e.vulnUntil = state.tick + T(2); }
    }
    if (info.skillId === 'af_repeater' && info.generation === 0) {
      if (has(p, 'af_sentry_network')) {
        for (const h of state.hazards) {
          if (!TURRETS.has(h.kind) || h.ownerId !== p.slot || h.untilTick <= state.tick || h.inner > state.tick) continue;
          if (d2(h.x, h.y, e.x, e.y) > 64) continue;
          h.inner = state.tick + T(0.3);
          h.outer = e.id;
        }
      }
      if (has(p, 'af_perpetual_engine')) {
        const b = p.buffs.find((x) => x.id === 'af_overclock' && x.until > state.tick);
        if (b) b.until = Math.min(state.tick + T(10), b.until + 9);
      }
    }
    if (info.kill && info.generation === 0 && (info.skillId === 'af_grenade' || info.skillId === 'af_mortar_barrage') && has(p, 'af_chain_reaction')) {
      blast(state, ev, p, e.x, e.y, 1.5, baseHit(state, p, 'ember', '0.6'), { skillId: 'af_chain_reaction', dtype: 'ember', style: 8, gen: 1, kb: 0.4 });
    }
    if (info.kill && !e.cohort.count.isZero()) killSteam(state, p);
  },

  onKill(state, _ev, _e, p) {
    if (p) killSteam(state, p);
  },

  onPlayerTick(state, ev, p) {
    const v = p.vars;
    maintainDrones(state, p);
    // Rocket Jump flight
    if (v.rjLeft > 0 && state.map) {
      p.iframes = Math.max(p.iframes, 0.1);
      const r = moveCircle(state.map, p.x, p.y, v.rjDX, v.rjDY, RULES.playerRadius);
      p.x = r.x; p.y = r.y;
      v.rjLeft--;
      if (v.rjLeft <= 0) {
        v.rjLeft = 0;
        ev.push({ t: 'teleport', slot: p.slot, fx: v.rjFX ?? p.x, fy: v.rjFY ?? p.y, x: p.x, y: p.y, style: 'rocket' });
        steamBlast(state, ev, p, 'af_rocket_jump', 7);
      }
    }
    // Overclock: extra logical attack work while firing
    if (overclocked(state, p) && (p.prevButtons & ACTION.ATTACK) && p.dodgeTimer <= 0 && p.guardTimer <= 0) {
      const bonus = has(p, 'af_perpetual_engine') ? 0.75 : 0.5;
      p.attackWork += bonus * toFloatClamped(playerDerived(state, p).attackFreq, 1e9) * DT;
    }
    // Aegis Protocol
    if (has(p, 'af_aegis_protocol') && droneCount(p) && state.tick - (v.aegisT ?? -1e9) >= T(5)) {
      shieldPlayer(state, ev, p, p.maxHp.mul(B('0.08')));
      v.aegisT = state.tick;
    }
    const turrets = myHazards(state, p, (h) => TURRETS.has(h.kind));
    v.ui_turrets = turrets.length;
    // Fortress Protocol regeneration (0.75% every 0.5s = 1.5%/s)
    if (has(p, 'af_fortress_protocol') && state.tick % 30 === 0 && turrets.some((h) => d2(h.x, h.y, p.x, p.y) <= 3.5 * 3.5)) {
      healPlayer(state, ev, p, p.maxHp.mul(B('0.0075')));
    }
    // Heavy Ordnance: the grenade skill recharges at 2/3 speed (cooldown x1.5)
    if (has(p, 'af_heavy_ordnance')) {
      const s = skillSlot(p, 'af_grenade');
      if (s && s.charges < s.maxCharges) s.cooldown += (DT * toFloatClamped(playerDerived(state, p).recovery, 1e12)) / 3;
    }
  },

  hazardTick(state, ev, h) {
    const p = state.players[h.ownerId];
    if (!p) return undefined;
    switch (h.kind) {
      case 'af_turret':
      case 'af_flame_turret':
      case 'af_tesla_coil':
        turretTick(state, ev, p, h);
        return true;
      case 'af_grenade':
        if (state.tick < h.nextTick) return true;
        if (has(p, 'af_proximity_mines') && !anyWithin(state, h.x, h.y, h.radius)) {
          h.kind = 'af_mine';
          h.bornTick = state.tick;
          h.nextTick = state.tick + T(0.4);
          h.untilTick = state.tick + T(8);
          h.damage = h.damage.mul(B('1.3'));
          return true;
        }
        detonateGrenade(state, ev, p, h);
        h.untilTick = state.tick;
        return true;
      case 'af_mine':
        if (state.tick >= h.nextTick && anyWithin(state, h.x, h.y, 1.2)) {
          detonateGrenade(state, ev, p, h);
          h.untilTick = state.tick;
        }
        return true;
      case 'af_bomblet':
        if (state.tick >= h.nextTick) {
          const conc = has(p, 'af_concussive');
          blast(state, ev, p, h.x, h.y, h.radius, h.damage, { skillId: 'af_grenade', dtype: 'ember', style: 1, kb: 0.4 * (conc ? 2 : 1), stagger: 10 });
          h.untilTick = state.tick;
        }
        return true;
      case 'af_shell':
        if (state.tick >= h.nextTick) {
          blast(state, ev, p, h.x, h.y, h.radius, h.damage, { skillId: 'af_mortar_barrage', dtype: 'ember', style: 2, kb: 0.5, stagger: 20 });
          h.untilTick = state.tick;
        }
        return true;
      case 'af_drone':
        droneTick(state, ev, p, h);
        return true;
      case 'af_boiler':
        if (p.lifeState === 'alive') { h.x = p.x; h.y = p.y; }
        if (state.tick >= h.nextTick) {
          h.nextTick = state.tick + h.interval;
          for (const e of livingEnemies(state)) {
            if (d2(e.x, e.y, h.x, h.y) > (h.radius + e.radius) ** 2) continue;
            hitEnemy(state, ev, e, h.damage, ONE, { dtype: 'ember', srcSlot: p.slot, skillId: 'af_boiler_overdrive', fromX: h.x, fromY: h.y, coverage: areaCoverage(e, h.radius), allowCrit: true });
            if (alive(e)) flinch(state, e, h.x, h.y, 0.3);
          }
        }
        return true;
    }
    return undefined;   // af_fire uses the generic periodic damage pulse
  },

  extraCharges(p, skillId) {
    const fam = FAMILY[skillId];
    if (fam === 'af_turret' && has(p, 'af_twin_deploy')) return 1;
    if (fam === 'af_grenade' && has(p, 'af_carpet_bomber')) return 1;
    return 0;
  },

  cooldownFactor(_state, p, skillId) {
    const fam = FAMILY[skillId];
    if (fam === 'af_grenade') { let f = 1; for (let i = 0; i < rank(p, 'af_quick_fuse'); i++) f *= 0.9; return f; }
    if (fam === 'af_overclock' && has(p, 'af_perpetual_engine')) return 1.5;
    return 1;
  },

  onRoundStart(state) {
    for (const p of state.players) {
      if (p.classId !== 'artificer') continue;
      p.vars.rjLeft = 0;
      p.vars.aegisT = -1e9;
      p.vars.ui_turrets = 0;
    }
  },
});
