import { Big, floorMulBig } from '@cursebound/numeric';
import {
  ENEMY_BY_ID, MINIBOSS_EXCLUDED_ROLES, MINIBOSS_MECHANICS, MINIBOSS_MECHANIC_BY_ID, PACK_BY_ID, PACK_TEMPLATES, RULES, THEME_PACKS, TICK_RATE,
  basePoints, isBossRound, miniBossName,
} from '@cursebound/content';
import { dropPatch, pushPlayer } from './afflictions';
import { cohortHpFrac, cohortTotalHp, enemyAttackDamage, hitPlayer } from './combat';
import { bfsFrom, miniBossHooks } from './director';
import { addScore } from './fate';
import { dropLegendary } from './gear';
import { registerGlobalHooks } from './hooks';
import { nearestFloor } from './map';
import { bountyRules } from './bountyRules';
import { dropPickup } from './pickups';
import { nextFloat, nextInt, seedRng, type RngState } from './rng';
import { B, ONE, enemyDamage, enemyUnitHealth, fateFactor } from './stats';
import type { EnemyState, PendingSpawn, PlayerState, SimEvent, SimState } from './types';

// Named mini-bosses (rules 1.6, sim 1.5). On ordinary rounds from RULES.miniBossMinRound, with chance
// RULES.miniBossChance (its own seeded stream per round, so the encounter stream and every other pack stay as they
// were), the director turns one population pack whose site lies in a proper room far from the heroes into a mini-boss
// pack: a theme foe (a pack lead of the floor's theme) plus RULES.miniBossEscorts escorts. makeMiniBoss gives the lead a
// generated name ("Grimtooth the Unbowed", content minibosses.ts), one or two signature mechanics, mini-boss health
// (max(RULES.miniBossHealth, its rare's health x miniBossRareFactor), round-scaled like any foe: tougher than a rare,
// far below a boss), damage, armour and size. The pack stands in for RULES.miniBossTakesReinforcements reinforcement
// packs, so a round's work stays about the same. It idles with its pack until found; waking it announces it
// ('miniboss' event 'awake'). Its death drops rare-tier
// potions and a haste orb, rolls a legendary at RULES.miniBossLegendaryChance (outside the per-round drop cap) and pays
// RULES.miniBossScorePercent% of the round's base points x score pressure at once. Mechanics (all telegraphed):
//   slam    - marks a circle around itself, channels, then a shockwave: damage + knockback (i-frames avoid both)
//   summon  - calls minions of its pack through summoning circles (linked: they fall with it)
//   enrage  - below 40% health it moves and strikes faster, once
//   shield  - at 70% and 35% health a ward makes it immune for a moment
//   poison  - leaves venom puddles where it walks
// Deterministic: identity from seeded streams, mechanic timers in ticks, positions from state.rng.ai.

const T = (sec: number) => Math.max(1, Math.round(sec * TICK_RATE));
/** room kinds too narrow or ceremonial to hold a mini-boss (corridors, bridges, the boss approach) */
const NO_LAIR = new Set(['hall', 'bridge', 'approach', 'arena']);

type MapS = NonNullable<SimState['map']>;
interface PackPlan { wave: number; units: string[]; site: { x: number; y: number } | null }

/** Chance of a mini-boss this round (0 on boss rounds, training, the tutorial and before miniBossMinRound). */
export function miniBossChance(state: SimState, round = state.round): number {
  if (state.training || state.tutorial || isBossRound(round) || round < RULES.miniBossMinRound) return 0;
  return Math.max(0, Math.min(1, RULES.miniBossChance));
}

function pickWeighted(rng: RngState, entries: [string, number][]): string {
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = (nextInt(rng, 1000000) / 1000000) * total;
  for (const [id, w] of entries) { r -= w; if (r < 0) return id; }
  return entries[entries.length - 1][0];
}

/** Pack templates whose lead may become a mini-boss on this theme and round (weights from the theme's pack table). */
export function miniBossPool(theme: string, round: number): [string, number][] {
  const weights = THEME_PACKS[theme] ?? Object.fromEntries(PACK_TEMPLATES.map((t) => [t.id, 1]));
  const ok = (id: string) => {
    const t = PACK_BY_ID[id];
    const lead = t ? ENEMY_BY_ID[t.lead] : undefined;
    return !!t && !!lead && t.minRound <= round && !MINIBOSS_EXCLUDED_ROLES.includes(lead.role);
  };
  let pool = Object.entries(weights).filter(([id]) => ok(id));
  if (!pool.length) pool = Object.entries(weights).filter(([id]) => PACK_BY_ID[id] && !MINIBOSS_EXCLUDED_ROLES.includes(ENEMY_BY_ID[PACK_BY_ID[id].lead]?.role ?? 'summon'));
  return pool;
}

function roomAtTile(map: MapS, tx: number, ty: number) {
  for (const r of map.rooms ?? []) if (tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h) return r;
  return undefined;
}

/**
 * Director hook (planPopulation): maybe turn one wave-0 pack into the round's mini-boss pack. Prefers sites inside a
 * proper room, far (by path) from the hero spawn. Returns the pack index, or -1 for no mini-boss this round.
 */
export function planMiniBoss(state: SimState, packs: PackPlan[]): number {
  const q = miniBossChance(state);
  if (q <= 0 || !state.map) return -1;
  const rng = seedRng(state.seed, 'miniboss', state.round);
  if (nextFloat(rng) >= q) return -1;
  const map = state.map;
  const dist = bfsFrom(map, map.playerSpawns.slice(0, 1));
  const cands: { i: number; d: number; room: boolean }[] = [];
  packs.forEach((pk, i) => {
    if (pk.wave !== 0 || !pk.site) return;
    const tx = Math.floor(pk.site.x), ty = Math.floor(pk.site.y);
    const room = roomAtTile(map, tx, ty);
    const big = !!room && !NO_LAIR.has(room.kind) && room.w * room.h >= 20;
    cands.push({ i, d: dist[ty * map.w + tx] ?? -1, room: big });
  });
  if (!cands.length) return -1;
  const inRooms = cands.filter((c) => c.room);
  const list = (inRooms.length ? inRooms : cands).sort((a, b) => b.d - a.d || a.i - b.i);
  const pick = list[nextInt(rng, Math.min(3, list.length))];
  const pool = miniBossPool(map.theme, state.round);
  if (!pool.length) return -1;
  const t = PACK_BY_ID[pickWeighted(rng, pool)];
  const units = [t.lead];
  while (units.length < 1 + RULES.miniBossEscorts) units.push(t.fodder[nextInt(rng, t.fodder.length)]);
  packs[pick.i].units = units;
  // it stands in for the last reinforcement pack(s): the round's total work stays about the same (RULES)
  for (let k = 0; k < RULES.miniBossTakesReinforcements; k++) {
    let last = -1;
    for (let i = packs.length - 1; i >= 0; i--) if (packs[i].wave > 0) { last = i; break; }
    if (last < 0 || last <= pick.i) break;
    packs.splice(last, 1);
  }
  return pick.i;
}

/** Draw 1-2 distinct signature mechanics (two more likely in later rounds). */
function pickMechanics(rng: RngState, round: number): string[] {
  const pool = MINIBOSS_MECHANICS.map((m) => m.id as string);
  const two = nextFloat(rng) < Math.min(0.85, 0.45 + 0.05 * Math.max(0, round - 2));
  const out: string[] = [];
  while (out.length < (two ? 2 : 1) && pool.length) out.push(pool.splice(nextInt(rng, pool.length), 1)[0]);
  return out;
}

/**
 * Turn a freshly created foe into a named mini-boss: name, mechanics, health, damage, armour and size. `rng` decides
 * the identity (director: a stream per run seed, round and group; training: per tick and slot). `forced` pins the
 * mechanics (tests, dev tools). A cohort of several (Fate spawn quantity) keeps one boss; the rest join as escorts.
 */
export function makeMiniBoss(state: SimState, ev: SimEvent[], e: EnemyState, rng: RngState, forced?: string[]) {
  const def = ENEMY_BY_ID[e.kind];
  if (!def || e.boss) return;
  const r = Math.max(1, state.round);
  const theme = state.map?.theme ?? 'catacombs';
  const name = miniBossName(theme, nextInt(rng, 9973), nextInt(rng, 9967), nextInt(rng, 9949));
  const mechs = forced ? forced.filter((m) => MINIBOSS_MECHANIC_BY_ID[m]) : pickMechanics(rng, r);
  if (e.cohort.count.gt(ONE) && state.map) {
    const rest = e.cohort.count.sub(ONE);
    e.cohort.count = ONE;
    const [x, y] = nearestFloor(state.map, e.x + 1.1, e.y);
    state.pendingSpawns.push({ kind: e.kind, x, y, count: rest, summonerId: null, objective: e.objective, groupId: e.groupId, ...(e.pack !== undefined ? { pack: e.pack } : {}), ...(e.dormant ? { dormant: true } : {}) });
  }
  e.cohort.unitHp = enemyUnitHealth(state, miniBossBaseHealth(e.kind), r, 1);
  e.cohort.spread = Big.ZERO; e.cohort.front = Big.ZERO;
  e.damage = enemyDamage(state, Math.max(def.baseDamage, RULES.miniBossMinDamage), r).mul(B(RULES.miniBossDamage));
  e.armor = B(def.armor + RULES.miniBossArmor).mul(fateFactor(state, 'enemy.armor'));
  e.radius = def.radius * RULES.miniBossRadius;
  e.mini = { name, mechs, v: { born: state.tick } };
  ev.push({ t: 'miniboss', id: e.id, op: 'spawn', name, x: e.x, y: e.y, k: e.kind });
}

/** Base (round-1) unit health of a mini-boss of this kind: tougher than the rare version of the same foe. */
export function miniBossBaseHealth(kind: string): number {
  const def = ENEMY_BY_ID[kind];
  return Math.max(RULES.miniBossHealth, Math.round((def?.baseHealth ?? 0) * Number(RULES.rareHealth) * RULES.miniBossRareFactor));
}

/** Director hook (spawnWave): the identity stream of a population mini-boss. */
export function miniBossRng(state: SimState, groupId: number): RngState {
  return seedRng(state.seed, 'miniboss-id', state.round, groupId);
}

// ---------------- mechanics ----------------

function alive(state: SimState): PlayerState[] {
  return state.players.filter((p) => p.lifeState === 'alive');
}

function nearestHero(state: SimState, e: EnemyState, range: number): PlayerState | null {
  let best: PlayerState | null = null, bd = range * range;
  for (const p of alive(state)) {
    const d2 = (p.x - e.x) ** 2 + (p.y - e.y) ** 2;
    if (d2 <= bd) { bd = d2; best = p; }
  }
  return best;
}

/** The minion a summoning mini-boss calls: the frailest fodder of its own pack template, else its own kind. */
export function minionKindFor(kind: string): string {
  const t = PACK_TEMPLATES.find((p) => p.lead === kind);
  let best = kind, hp = Infinity;
  for (const f of t?.fodder ?? []) { const d = ENEMY_BY_ID[f]; if (d && d.baseHealth < hp) { hp = d.baseHealth; best = f; } }
  return best;
}

const P = (id: string) => MINIBOSS_MECHANIC_BY_ID[id].params;

type MechTick = (state: SimState, ev: SimEvent[], e: EnemyState, v: Record<string, number>) => void;

const MECH: Record<string, MechTick> = {
  slam(state, ev, e, v) {
    const p = P('slam');
    const t = state.tick;
    const name = e.mini!.name;
    if (v.slFire) {
      if (t < v.slFire) return;
      v.slFire = 0;
      const x = v.slX ?? e.x, y = v.slY ?? e.y;
      const dmg = enemyAttackDamage(state, e, String(p.coef), true);
      for (const h of alive(state)) {
        if (h.iframes > 0 || (h.x - x) ** 2 + (h.y - y) ** 2 > (p.radius + 0.3) ** 2) continue;
        hitPlayer(state, ev, h, dmg, { attack: 'Ground Slam', source: name, fromX: x, fromY: y, dtype: 'physical', srcId: e.id });
        pushPlayer(state, ev, h, x, y, p.push, e.id);
      }
      if (e.state === 'windup') e.state = 'idle';
      ev.push({ t: 'miniboss', id: e.id, op: 'slam', name, x, y, r: p.radius });
      return;
    }
    if (t < (v.slAt ?? 0)) return;
    if (e.attack || !nearestHero(state, e, p.trigger) || !state.map) { v.slAt = t + 20; return; }
    v.slAt = t + T(p.every); v.slFire = t + T(p.warn); v.slX = e.x; v.slY = e.y;
    // channel: it plants itself for the warning (the circle is fixed where it stood) and holds its other attacks
    e.staggerUntil = Math.max(e.staggerUntil, v.slFire);
    e.state = 'windup'; e.vx = 0; e.vy = 0;
    for (const k of Object.keys(e.cooldowns)) if (k !== '_pause') e.cooldowns[k] = Math.max(e.cooldowns[k], p.warn + 0.3);
    state.telegraphs.push({ id: state.nextId++, ownerId: e.id, shape: { kind: 'circle', radius: p.radius }, x: e.x, y: e.y, dx: 1, dy: 0, startTick: t, releaseTick: v.slFire, attack: 'mb_slam' });
    ev.push({ t: 'miniboss', id: e.id, op: 'slam_warn', name, x: e.x, y: e.y, r: p.radius });
  },
  summon(state, ev, e, v) {
    const p = P('summon');
    const t = state.tick;
    if (t < (v.suAt ?? 0) || !state.map || !state.encounter) return;
    if (!nearestHero(state, e, p.trigger)) { v.suAt = t + 30; return; }
    const pending = (state.encounter.reinforce ?? []).reduce((n, w) => n + w.spawns.filter((s) => s.summonerId === e.id).length, 0);
    const living = state.enemies.filter((o) => o.summonerId === e.id && o.state !== 'dying').length + pending;
    if (living >= p.maxAlive) { v.suAt = t + 60; return; }
    v.suAt = t + T(p.every);
    const kind = minionKindFor(e.kind);
    const n = Math.min(p.maxAlive - living, p.count + (state.n > 2 ? 1 : 0));
    const arrive = t + T(p.warn);
    const a0 = nextFloat(state.rng.ai) * Math.PI * 2;
    const q = fateFactor(state, 'encounter.spawnQuantity');
    const count = q.floorInt() > 0n ? Big.from(q.floorInt()) : ONE;
    const spawns: PendingSpawn[] = [];
    for (let i = 0; i < n; i++) {
      const ang = a0 + (i / n) * Math.PI * 2;
      const [x, y] = nearestFloor(state.map, e.x + Math.cos(ang) * 1.7, e.y + Math.sin(ang) * 1.7);
      spawns.push({ kind, x, y, count, summonerId: e.id, objective: false, groupId: -1, hpMul: String(p.hp), dmgMul: String(p.dmg) });
      state.telegraphs.push({ id: state.nextId++, ownerId: e.id, shape: { kind: 'circle', radius: 0.8 }, x, y, dx: 0, dy: 0, startTick: t, releaseTick: arrive, attack: 'reinforce' });
    }
    (state.encounter.reinforce ??= []).push({ tick: arrive, spawns });
    ev.push({ t: 'miniboss', id: e.id, op: 'summon', name: e.mini!.name, x: e.x, y: e.y, k: kind });
  },
  enrage(state, ev, e, v) {
    const p = P('enrage');
    if (v.enr || cohortHpFrac(e.cohort) > p.below) return;
    v.enr = 1;
    e.moveSpeed *= p.move;
    e.attackFreq = e.attackFreq.mul(B(String(p.attack)));
    ev.push({ t: 'miniboss', id: e.id, op: 'enrage', name: e.mini!.name, x: e.x, y: e.y });
  },
  shield(state, ev, e, v) {
    const p = P('shield');
    const frac = cohortHpFrac(e.cohort);
    let ward = false;
    if (!v.sh1 && frac <= p.at1) { v.sh1 = 1; ward = true; }
    if (!v.sh2 && frac <= p.at2) { v.sh2 = 1; ward = true; }   // a blow through both thresholds wards once
    if (!ward) return;
    // an absorb far beyond its remaining health: immune for the ward's duration (like the Shielding affix)
    e.shield = cohortTotalHp(e.cohort).mul(B('1e12')).add(B('1e12'));
    e.shieldUntil = state.tick + T(p.sec);
    ev.push({ t: 'miniboss', id: e.id, op: 'shield', name: e.mini!.name, x: e.x, y: e.y });
  },
  poison(state, _ev, e, v) {
    const p = P('poison');
    if (state.tick < (v.poAt ?? 0)) return;
    const dx = e.x - (v.poX ?? e.x), dy = e.y - (v.poY ?? e.y);
    if (v.poX !== undefined && dx * dx + dy * dy < 0.35 * 0.35) return;
    v.poAt = state.tick + T(p.every); v.poX = e.x; v.poY = e.y;
    // poisons only behind the walker (arms after a beat); damage = poison per second
    dropPatch(state, e.id, 'venom', e.x, e.y, p.radius, p.sec, enemyAttackDamage(state, e, String(p.coef), false), 0.3);
  },
};

function lootRng(state: SimState): RngState {
  return state.rng.loot ?? (state.rng.loot = seedRng(state.seed, 'loot'));
}

/** Score burst for slaying the round's mini-boss: miniBossScorePercent% of the round's base points x score pressure. */
export function miniBossScore(state: SimState): bigint {
  const pressure = state.encounter?.pressure ?? fateFactor(state, 'score.pressure');
  return floorMulBig(basePoints(Math.max(1, state.round)), pressure, BigInt(RULES.miniBossScorePercent), 100n);
}

/** Mini-boss loot: rare-tier potions and a haste orb, a legendary roll outside the per-round cap, a score burst. */
export function miniBossLoot(state: SimState, ev: SimEvent[], e: EnemyState) {
  if (!e.mini) return;
  if (!bountyRules(state).noPickups) {
    dropPickup(state, 'potion', e.x, e.y, 2);
    dropPickup(state, 'potion', e.x, e.y, 2);
    dropPickup(state, 'orb', e.x, e.y, 2);
  }
  if (nextFloat(lootRng(state)) < RULES.miniBossLegendaryChance) dropLegendary(state, ev, e.x, e.y, 'elite');
  let pts = 0n;
  if (!state.training) {
    pts = miniBossScore(state);
    if (pts > 0n) state.scoreText = addScore(state.scoreText, pts);
  }
  ev.push({ t: 'miniboss', id: e.id, op: 'slain', name: e.mini.name, x: e.x, y: e.y, k: e.kind, pts: pts.toString() });
  ev.push({ t: 'domain', type: 'miniboss_slain', payload: { round: state.round, name: e.mini.name, kind: e.kind, mechanics: e.mini.mechs, points: pts.toString() } });
}

registerGlobalHooks({
  onTick(state, ev) {
    if (state.tick < (state.cinematicUntilTick ?? 0)) return;
    for (const e of state.enemies) {
      if (!e.mini || e.dormant || e.state === 'dying' || e.cohort.count.isZero()) continue;
      const v = e.mini.v;
      if (!v.awake) {
        // found: the announcement, and the first mechanic beats a moment later
        v.awake = state.tick;
        v.slAt = state.tick + T(P('slam').first);
        v.suAt = state.tick + T(P('summon').first);
        ev.push({ t: 'miniboss', id: e.id, op: 'awake', name: e.mini.name, x: e.x, y: e.y, k: e.kind });
        ev.push({ t: 'domain', type: 'miniboss_found', payload: { round: state.round, name: e.mini.name, kind: e.kind, mechanics: e.mini.mechs } });
      }
      if (state.training && !state.training.ai) continue;   // a frozen training yard keeps its mini-bosses quiet
      for (const m of e.mini.mechs) MECH[m]?.(state, ev, e, v);
    }
  },
  onKill(state, ev, e) {
    if (state.phase !== 'COMBAT' || !e.mini) return;
    miniBossLoot(state, ev, e);
  },
});

// the director's mini-boss slots (director.ts miniBossHooks): planning and the identity of the spawned lead
miniBossHooks.plan = planMiniBoss;
miniBossHooks.make = (state, ev, e, groupId) => makeMiniBoss(state, ev, e, miniBossRng(state, groupId));
