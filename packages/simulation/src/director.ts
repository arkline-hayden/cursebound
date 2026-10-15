import { Big } from '@cursebound/numeric';
import { BOSS_BY_ID, ENEMY_BY_ID, PACK_BY_ID, PACK_TEMPLATES, RULES, THEME_PACKS, TICK_RATE, bossesForTheme, isBossRound, referenceSec } from '@cursebound/content';
import { cohortRadius } from './combat';
import { bossIntroTicks, holdCinematic, inCinematic } from './cinematic';
import { dist2 } from './geometry';
import { hooks } from './hooks';
import './caches';   // cursed caches: breakable exploration rewards on ordinary floors
import { generateMap, nearestFloor } from './map';
import { pickBoss } from './mapgen';
import { nextInt, seedRng, type RngState } from './rng';
import { B, ONE, enemyDamage, enemyUnitHealth, fateFactor, partyBudgetMult, toFloatClamped } from './stats';
import type { EncounterGroup, EnemyState, PendingSpawn, SimEvent, SimState } from './types';

// Procedural encounter director (PRD §3.2, §11.1, §14.1). Finite, score-bearing population only: ordinary rounds
// spread packs over the whole floor (idle until heroes approach, ai.ts wakePack) and send a few small reinforcement
// packs from the far side of the map; no infinite spawns. Encounter generation uses its own seeded stream per round.

export function createEnemy(state: SimState, kind: string, x: number, y: number, count: Big, opts: { boss?: boolean; objective: boolean; groupId: number; summonerId: number | null }): EnemyState {
  const boss = !!opts.boss;
  const def = boss ? null : ENEMY_BY_ID[kind];
  const bdef = boss ? BOSS_BY_ID[kind] : null;
  const r = state.round;
  const unitHp = boss
    ? enemyUnitHealth(state, bdef!.refUnitHealth, r, bdef!.bossFactor)
    : enemyUnitHealth(state, def!.baseHealth, r, 1);
  const baseDamage = boss ? bdef!.baseDamage : def!.baseDamage;
  const tags = boss ? bdef!.tags : def!.tags;
  const baseRadius = boss ? bdef!.radius : def!.radius;
  const id = state.nextId++;
  const e: EnemyState = {
    id, gen: state.nextGen++, kind, boss, objective: opts.objective, groupId: opts.groupId, summonerId: opts.summonerId,
    x, y, vx: 0, vy: 0, fx: -1, fy: 0, radius: cohortRadius(baseRadius, count),
    cohort: { count, unitHp, spread: Big.ZERO, front: Big.ZERO },
    armor: B(boss ? bdef!.armor : def!.armor).mul(fateFactor(state, 'enemy.armor')),
    damage: enemyDamage(state, baseDamage, r),
    regenFrac: tags.includes('regen') ? B(RULES.enemyBaseRegenFrac).mul(fateFactor(state, 'enemy.regeneration')) : Big.ZERO,
    // global enemy speed multiplier applies to bosses too (rules 1.4: all movement x0.8)
    moveSpeed: (boss ? bdef!.moveSpeed : def!.moveSpeed) * RULES.enemyMoveSpeedMult * toFloatClamped(fateFactor(state, 'enemy.movementSpeed'), 1e7),
    attackFreq: fateFactor(state, 'enemy.attackFrequency'),
    rapidWork: Big.ZERO,
    state: 'idle', action: 'idle', utility: {}, targetSlot: null, path: [], pathGoal: -1, pathAge: 0,
    stuckTimer: 0, lastProgressX: x, lastProgressY: y, perceiveIn: 1 + (id % 6),
    reactIn: 0, strafeSign: id % 2 === 0 ? 1 : -1, cooldowns: { _pause: boss ? 2 : 0 }, attack: null,
    dots: [], vulnUntil: 0, vulnFactor: '1', shield: Big.ZERO, shieldUntil: 0, ccResistUntil: 0,
    stagger: 0, staggerUntil: 0, knockX: 0, knockY: 0,
    phaseIndex: 0, patternIndex: 0, patternStep: 0, hitFlash: 0, deathTimer: 0, burning: false,
  };
  // stagger initial attacks so a wave does not fire in unison
  if (!boss && def) for (const a of def.attacks) e.cooldowns[a.id] = 0.6 + (id % 5) * 0.35;
  return e;
}

/** Logical cohort count for one spawned agent: baseCount × spawn quantity, fractional residue resolved by the encounter stream. */
function cohortCount(rng: RngState, baseCount: number, M: Big): Big {
  const logical = B(baseCount).mul(M);
  const whole = logical.floorInt();
  const frac = logical.sub(Big.from(whole)).toNumber();
  const extra = frac > 0 && nextInt(rng, 1000000) / 1000000 < frac ? 1n : 0n;
  const n = whole + extra;
  return Big.from(n > 0n ? n : 1n);
}

/**
 * Named mini-boss slots (minibosses.ts fills them when sim.ts imports it; empty = no mini-bosses). `plan` may turn
 * one wave-0 pack of planPopulation into the round's mini-boss pack (returns its index or -1); `make` turns the
 * spawned lead of that pack into the mini-boss.
 */
export const miniBossHooks: {
  plan?: (state: SimState, packs: { wave: number; units: string[]; site: { x: number; y: number } | null }[]) => number;
  make?: (state: SimState, ev: SimEvent[], e: EnemyState, groupId: number) => void;
} = {};

export function setupRound(state: SimState, ev: SimEvent[]) {
  const r = state.round;
  const boss = isBossRound(r);
  state.map = generateMap(state.seed, r, boss, state.nextTheme?.round === r ? state.nextTheme.theme : null);   // door choice (doors.ts)
  state.enemies = []; state.projectiles = []; state.hazards = []; state.telegraphs = []; state.pendingSpawns = []; state.reactions = []; state.bossPhaseEvents = [];
  const rng = seedRng(state.seed, 'encounter', r);
  const M = fateFactor(state, 'encounter.spawnQuantity');
  const groups: EncounterGroup[] = [];
  let bossId: string | null = null;
  let objectiveTotal = 0;
  let packCount = 0;
  let planned = 0;
  const budgetF =RULES.baseBudget * (1 + Number(RULES.budgetLinear) * (r - 1)) * partyBudgetMult(state.n).toNumber();
  if (boss) {
    // the floor theme's own lair (content THEME_BOSSES) or the biome's classic bosses, alternating templates
    bossId = pickBoss(bossesForTheme(state.map.theme), r, rng);
    const def = BOSS_BY_ID[bossId];
    const weight = def.phases.reduce((s, p) => s + p.weight, 0);
    groups.push({ id: 0, weight, archetype: bossId, wave: 0, spawned: false, defeated: false, countText: '1' });
    objectiveTotal = weight;
  } else {
    // Diablo-style population: packs spread through the whole floor (wave 0, idle until heroes approach) plus small
    // reinforcement packs (waves 1+) that arrive from the far side of the map. Every entity is one objective group;
    // countText holds the base count until spawn (replaced by the logical count then).
    const plan = planPopulation(state, rng);
    groups.push(...plan.groups);
    objectiveTotal = groups.length;
    packCount = plan.packs;
    planned = plan.units;
  }
  state.encounter = {
    round: r, isBoss: boss, bossId, bossEntityId: null, groups, wave: -1, waveCount: boss ? 1 : RULES.waveCount, waveTimer: 0,
    objectiveTotal, completedWeight: 0, referenceTicks: referenceSec(r) * TICK_RATE, activeTicks: 0,
    budget: boss ? B(budgetF.toFixed(2)).mul(M).toString() : B(planned).mul(M).toString(), pressure: fateFactor(state, 'score.pressure'), phaseAddsSpawned: [],
    ...(packCount ? { packCount } : {}),
  };
  // place players
  state.players.forEach((p, i) => {
    const s = state.map!.playerSpawns[i % state.map!.playerSpawns.length];
    p.x = s.x; p.y = s.y; p.vx = 0; p.vy = 0;
    p.dodgeTimer = 0; p.guardTimer = 0; p.iframes = 0; p.attackWork = 0;
  });
  ev.push({ t: 'domain', type: 'round_started', payload: { round: r, boss, bossId, topology: state.map.topology, objectiveTotal } });
}

export function spawnWave(state: SimState, ev: SimEvent[], wave: number) {
  const enc = state.encounter!;
  enc.wave = wave;
  enc.waveTimer = 0;
  const rng = seedRng(state.seed, 'encounter-wave', enc.round, wave);
  const M = fateFactor(state, 'encounter.spawnQuantity');
  const spawns = state.map!.enemySpawns;
  let si = nextInt(rng, spawns.length);
  const sites = new Map<number, { x: number; y: number }>();
  for (const g of enc.groups) {
    if (g.wave !== wave || g.spawned) continue;
    g.spawned = true;
    if (enc.isBoss) {
      // the arena's dais (mapgen arenas.ts); older maps: east of centre
      const spot = state.map!.bossSpawn ?? { x: state.map!.w * 0.7, y: state.map!.h / 2 };
      const [x, y] = nearestFloor(state.map!, spot.x, spot.y);
      const e = createEnemy(state, g.archetype, x, y, ONE, { boss: true, objective: true, groupId: g.id, summonerId: null });
      state.enemies.push(e);
      enc.bossEntityId = e.id;
      ev.push({ t: 'spawn', id: e.id, kind: e.kind, x, y });
      // grand entrance: the fight holds for RULES.bossIntroSec while every client plays the reveal (cinematic.ts)
      ev.push({ t: 'boss_intro', id: e.id, k: e.kind, x, y });
      holdCinematic(state, bossIntroTicks());
      continue;
    }
    let s: { x: number; y: number };
    if (g.pack !== undefined) {
      // population packs spawn where they were planned; reinforcement packs pick a far point when they arrive
      if (g.x === undefined || g.y === undefined) {
        const site = reinforcementSite(state, rng, g.pack, sites);
        const members = enc.groups.filter((o) => o.pack === g.pack);
        const k = members.indexOf(g);
        [g.x, g.y] = memberSpot(state, site.x, site.y, k, members.length);
      }
      s = { x: g.x, y: g.y! };
    } else {
      // spawn separation from players
      s = spawns[si++ % spawns.length];
      for (let k = 0; k < spawns.length; k++) {
        if (state.players.every((p) => dist2(p.x, p.y, s.x, s.y) > 16)) break;
        s = spawns[si++ % spawns.length];
      }
    }
    const count = cohortCount(rng, Number(g.countText), M);
    g.countText = count.toString();
    const e = createEnemy(state, g.archetype, s.x, s.y, count, { objective: true, groupId: g.id, summonerId: null });
    if (g.pack !== undefined) { e.pack = g.pack; if (g.dormant) e.dormant = true; }
    state.enemies.push(e);
    ev.push({ t: 'spawn', id: e.id, kind: e.kind, x: s.x, y: s.y });
    if (g.mini) miniBossHooks.make?.(state, ev, e, g.id);   // the round's named mini-boss (minibosses.ts)
    hooks.onEnemySpawn(state, ev, e);   // champion / rare rolls (elites.ts; mini-bosses never roll)
  }
  ev.push({ t: 'wave', wave });
}

export function flushPendingSpawns(state: SimState, ev: SimEvent[]) {
  // boss reinforcement waves arrive when their summoning circles release
  const enc = state.encounter;
  if (enc?.reinforce?.length && !inCinematic(state)) {
    for (const w of enc.reinforce) if (w.tick <= state.tick) state.pendingSpawns.push(...w.spawns);
    enc.reinforce = enc.reinforce.filter((w) => w.tick > state.tick);
  }
  if (!state.pendingSpawns.length || inCinematic(state)) return;
  const list: PendingSpawn[] = state.pendingSpawns;
  state.pendingSpawns = [];
  for (const s of list) {
    const e = createEnemy(state, s.kind, s.x, s.y, s.count, { objective: s.objective, groupId: s.groupId, summonerId: s.summonerId });
    if (s.pack !== undefined) e.pack = s.pack;
    if (s.dormant) e.dormant = true;   // a rare's minions idle with their pack
    if (s.hpMul) e.cohort.unitHp = e.cohort.unitHp.mul(B(s.hpMul));
    if (s.dmgMul) e.damage = e.damage.mul(B(s.dmgMul));
    state.enemies.push(e);
    ev.push({ t: 'spawn', id: e.id, kind: e.kind, x: s.x, y: s.y });
  }
}

/** Units in boss reinforcement wave `wave` (1 = at 2/3 health, 2 = at 1/3): base + per extra hero + per round step,
 *  one more on the second wave. Each unit is a cohort of encounter.spawnQuantity (Fate). */
export function bossReinforceUnits(partySize: number, round: number, wave: number): number {
  return RULES.bossReinforceBase + RULES.bossReinforcePerHero * (partySize - 1) + Math.floor(round / RULES.bossReinforceRoundStep) + (wave - 1);
}

/**
 * Boss reinforcements (RULES.bossReinforceAt): when the boss's health crosses a threshold (2/3, then 1/3), it calls
 * one wave of the floor theme's foes, exactly once per threshold (encounter.phaseAddsSpawned holds the waves called;
 * a single blow through both thresholds calls both). Composition comes from the theme's pack templates (the same
 * tables as the population director), sized by party and round. The wave is telegraphed: a 'boss_adds' event (client
 * banner + sound) and a summoning circle (Telegraph) at every arrival point; the foes appear when the circles release,
 * RULES.bossReinforceWarnSec later (encounter.reinforce, flushed by flushPendingSpawns). Arrival points ring the boss,
 * away from the heroes. Deterministic: its own seeded stream per round and wave. Non-objective, linked to the boss.
 */
export function bossReinforcements(state: SimState, ev: SimEvent[], boss: EnemyState, wave: number) {
  const enc = state.encounter;
  if (!enc || !state.map || enc.phaseAddsSpawned.includes(wave)) return;
  enc.phaseAddsSpawned.push(wave);
  const rng = seedRng(state.seed, 'boss-reinforce', enc.round, wave);
  const M = fateFactor(state, 'encounter.spawnQuantity');
  const r = state.round;
  const weights = THEME_PACKS[state.map.theme] ?? Object.fromEntries(PACK_TEMPLATES.map((t) => [t.id, 1]));
  let pool = Object.entries(weights).filter(([id]) => (PACK_BY_ID[id]?.minRound ?? 99) <= r);
  if (!pool.length) pool = PACK_TEMPLATES.filter((t) => t.minRound <= 1).map((t) => [t.id, 1] as [string, number]);
  const n = bossReinforceUnits(state.n, r, wave);
  const kinds: string[] = [];
  const roster = BOSS_BY_ID[boss.kind]?.adds;   // bosses with their own roster (BossDef.adds: the Gale Wyrm's harpies, the Crater Horror's brood)
  if (roster?.length) while (kinds.length < n) kinds.push(roster[nextInt(rng, roster.length)]);
  while (kinds.length < n) {
    const t = PACK_BY_ID[pickWeighted(rng, pool)];
    kinds.push(t.lead);
    for (let k = 0; k < 2 && kinds.length < n; k++) kinds.push(t.fodder[nextInt(rng, t.fodder.length)]);
  }
  // arrival points: a ring around the boss, rotated by the stream, nudged off heroes
  const R = 5.5 + Math.min(1.5, boss.radius);
  const a0 = (nextInt(rng, 360) / 360) * Math.PI * 2;
  const arrive = state.tick + Math.max(1, Math.round(RULES.bossReinforceWarnSec * TICK_RATE));
  const spawns: PendingSpawn[] = [];
  kinds.forEach((kind, i) => {
    const ang = a0 + (i / n) * Math.PI * 2;
    let [x, y] = nearestFloor(state.map!, boss.x + Math.cos(ang) * R, boss.y + Math.sin(ang) * R);
    if (state.players.some((p) => p.lifeState !== 'dead' && dist2(p.x, p.y, x, y) < 9)) [x, y] = nearestFloor(state.map!, boss.x + Math.cos(ang) * (R + 2.5), boss.y + Math.sin(ang) * (R + 2.5));
    spawns.push({ kind, x, y, count: cohortCount(rng, 1, M), summonerId: boss.id, objective: false, groupId: -1, hpMul: RULES.bossReinforceHealth, dmgMul: RULES.bossReinforceDamage });
    state.telegraphs.push({ id: state.nextId++, ownerId: boss.id, shape: { kind: 'circle', radius: 0.9 }, x, y, dx: 0, dy: 0, startTick: state.tick, releaseTick: arrive, attack: 'reinforce' });
  });
  (enc.reinforce ??= []).push({ tick: arrive, spawns });
  ev.push({ t: 'boss_adds', id: boss.id, wave, n, x: boss.x, y: boss.y });
}

// ---------------- Population (Diablo-style packs) ----------------

const FLOOR = 0;
type MapS = NonNullable<SimState['map']>;

/** Floor tiles of the map (reachable area after mapgen keeps the largest region). */
function floorArea(map: MapS): number {
  let n = 0;
  for (const t of map.tiles) if (t === FLOOR) n++;
  return n;
}

/** 4-neighbour BFS distances (tiles) over floor from several start points; -1 = unreachable. */
export function bfsFrom(map: MapS, starts: { x: number; y: number }[]): Int32Array {
  const { w, h, tiles } = map;
  const d = new Int32Array(w * h).fill(-1);
  const q: number[] = [];
  for (const s of starts) {
    const i = Math.floor(s.y) * w + Math.floor(s.x);
    if (i >= 0 && i < d.length && tiles[i] === FLOOR && d[i] < 0) { d[i] = 0; q.push(i); }
  }
  for (let k = 0; k < q.length; k++) {
    const c = q[k];
    const x = c % w, y = (c / w) | 0;
    if (x > 0 && tiles[c - 1] === FLOOR && d[c - 1] < 0) { d[c - 1] = d[c] + 1; q.push(c - 1); }
    if (x < w - 1 && tiles[c + 1] === FLOOR && d[c + 1] < 0) { d[c + 1] = d[c] + 1; q.push(c + 1); }
    if (y > 0 && tiles[c - w] === FLOOR && d[c - w] < 0) { d[c - w] = d[c] + 1; q.push(c - w); }
    if (y < h - 1 && tiles[c + w] === FLOOR && d[c + w] < 0) { d[c + w] = d[c] + 1; q.push(c + w); }
  }
  return d;
}

/** Floor tiles in the 3x3 block around tile i (room for a pack to stand). */
function roomAt(map: MapS, i: number): number {
  const x = i % map.w, y = (i / map.w) | 0;
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx >= 0 && yy >= 0 && xx < map.w && yy < map.h && map.tiles[yy * map.w + xx] === FLOOR) n++;
  }
  return n;
}

/** Number of population packs for a round: floor area x round growth x party factor, clamped. */
export function packCountFor(area: number, round: number, partySize: number): number {
  const raw = (area / RULES.packAreaPerPack) * (1 + Number(RULES.packRoundGrowth) * (round - 1)) * (1 + Number(RULES.packPartyCoef) * (partySize - 1));
  return Math.max(RULES.packMin, Math.min(RULES.packMax, Math.round(raw)));
}

/** Extra units per pack at a round (on top of the per-pack roll of packUnits). */
function packGrowth(round: number): number { return Math.floor((round - 1) / RULES.packGrowEvery); }

/** Reinforcement packs per wave after the population. */
function reinforcementPacksFor(round: number): number { return RULES.reinforcementPacks + Math.floor((round - 1) / RULES.reinforcementGrowEvery); }

/** Expected logical foes in an ordinary round (Forecast reference: mean pack size on a typical floor). */
export function expectedFoeCount(partySize: number, round: number): number {
  const packs = packCountFor(480, round, partySize);
  const size = (RULES.packUnits[0] + RULES.packUnits[1]) / 2 + packGrowth(round);
  return Math.round(packs * size + (RULES.waveCount - 1) * reinforcementPacksFor(round) * Math.max(2, size - 1));
}

/**
 * Pack sites spread over the whole floor: farthest-point sampling over open floor tiles at least packSafeRadius
 * (path and straight-line) from the hero spawns, starting at the far end of the map, so every room and corridor
 * region gets foes and nothing waits at the door.
 */
export function packSites(map: MapS, rng: RngState, want: number): { x: number; y: number }[] {
  const spawns = map.playerSpawns;
  const dist = bfsFrom(map, spawns.slice(0, 1));
  let cands: number[] = [];
  for (let safe = RULES.packSafeRadius; safe >= 4; safe -= 2) {
    cands = [];
    for (let i = 0; i < map.tiles.length; i++) {
      if (map.tiles[i] !== FLOOR || dist[i] < safe || roomAt(map, i) < 6) continue;
      const x = (i % map.w) + 0.5, y = ((i / map.w) | 0) + 0.5;
      if (spawns.some((s) => (s.x - x) ** 2 + (s.y - y) ** 2 < safe * safe)) continue;
      cands.push(i);
    }
    if (cands.length >= want * 3) break;
  }
  if (!cands.length) return [];
  const pos = (i: number) => ({ x: (i % map.w) + 0.5, y: ((i / map.w) | 0) + 0.5 });
  // first site: one of the farthest tiles (by path)
  const far = cands.slice().sort((a, b) => dist[b] - dist[a] || a - b);
  const sites = [pos(far[nextInt(rng, Math.min(5, far.length))])];
  const minD2 = new Float64Array(cands.length).fill(Infinity);
  while (sites.length < want) {
    const last = sites[sites.length - 1];
    let best = -1, bs = -Infinity;
    for (let k = 0; k < cands.length; k++) {
      const p = pos(cands[k]);
      const d2 = (p.x - last.x) ** 2 + (p.y - last.y) ** 2;
      if (d2 < minD2[k]) minD2[k] = d2;
      // spread first, then a little seeded jitter so floors differ
      const score = Math.sqrt(minD2[k]) + nextInt(rng, 1000) / 1000;
      if (score > bs) { bs = score; best = k; }
    }
    if (best < 0 || Math.sqrt(minD2[best]) < 3.2) break;   // the floor is saturated
    sites.push(pos(cands[best]));
  }
  return sites;
}

function wallAt(map: MapS, x: number, y: number): boolean {
  const tx = Math.floor(x), ty = Math.floor(y);
  return tx < 0 || ty < 0 || tx >= map.w || ty >= map.h || map.tiles[ty * map.w + tx] !== FLOOR;
}

/** A member's stand point around a pack site (lead in the middle, the rest in a small ring). */
function memberSpot(state: SimState, cx: number, cy: number, k: number, n: number): [number, number] {
  const map = state.map!;
  if (k === 0) return nearestFloor(map, cx, cy);
  const ang = (k / Math.max(1, n - 1)) * Math.PI * 2 + cx * 0.37;
  const r = 0.9 + (k % 2) * 0.4;
  const [x, y] = nearestFloor(map, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
  return wallAt(map, x, y) ? nearestFloor(map, cx, cy) : [x, y];
}

/** Arrival point for a reinforcement pack: an open floor tile far (by path) from every living hero. */
function reinforcementSite(state: SimState, rng: RngState, pack: number, cache: Map<number, { x: number; y: number }>): { x: number; y: number } {
  const hit = cache.get(pack);
  if (hit) return hit;
  const map = state.map!;
  const heroes = state.players.filter((p) => p.lifeState !== 'dead').map((p) => ({ x: p.x, y: p.y }));
  const dist = bfsFrom(map, heroes.length ? heroes : map.playerSpawns.slice(0, 1));
  const cands: number[] = [];
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === FLOOR && dist[i] >= 0 && roomAt(map, i) >= 7) cands.push(i);
  cands.sort((a, b) => dist[b] - dist[a] || a - b);
  // one of the farthest few, away from the spots other reinforcement packs of this wave took
  const taken = [...cache.values()];
  const pool = cands.slice(0, Math.max(1, Math.min(24, cands.length)))
    .filter((i) => taken.every((t) => ((i % map.w) + 0.5 - t.x) ** 2 + (((i / map.w) | 0) + 0.5 - t.y) ** 2 >= 9));
  const list = pool.length ? pool : cands;
  const i = list.length ? list[nextInt(rng, Math.min(6, list.length))] : -1;
  const site = i >= 0 ? { x: (i % map.w) + 0.5, y: ((i / map.w) | 0) + 0.5 } : { x: map.enemySpawns[0].x, y: map.enemySpawns[0].y };
  cache.set(pack, site);
  return site;
}

function pickWeighted(rng: RngState, entries: [string, number][]): string {
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = (nextInt(rng, 1000000) / 1000000) * total;
  for (const [id, w] of entries) { r -= w; if (r < 0) return id; }
  return entries[entries.length - 1][0];
}

/** Plan the round's packs: composition by theme and round, count by floor area, round and party size. */
function planPopulation(state: SimState, rng: RngState): { groups: EncounterGroup[]; packs: number; units: number } {
  const map = state.map!;
  const r = state.round;
  const weights = THEME_PACKS[map.theme] ?? Object.fromEntries(PACK_TEMPLATES.map((t) => [t.id, 1]));
  let pool = Object.entries(weights).filter(([id]) => (PACK_BY_ID[id]?.minRound ?? 99) <= r);
  if (!pool.length) pool = PACK_TEMPLATES.filter((t) => t.minRound <= 1).map((t) => [t.id, 1] as [string, number]);
  const sites = packSites(map, rng, packCountFor(floorArea(map), r, state.n));
  interface Pack { wave: number; units: string[]; site: { x: number; y: number } | null }
  const packs: Pack[] = [];
  const grow = packGrowth(r);
  const roll = (reinforce: boolean): string[] => {
    const t = PACK_BY_ID[pickWeighted(rng, pool)];
    const lo = RULES.packUnits[0], hi = RULES.packUnits[1];
    let size = lo + nextInt(rng, hi - lo + 1) + grow;
    if (reinforce) size = Math.max(2, size - 1);
    size += t.extra ?? 0;   // swarm packs of tiny theme foes come in bigger numbers (content 1.5)
    const units = [t.lead];
    while (units.length < size) units.push(t.fodder[nextInt(rng, t.fodder.length)]);
    return units;
  };
  for (const site of sites) packs.push({ wave: 0, units: roll(false), site });
  for (let w = 1; w < RULES.waveCount; w++) for (let k = 0; k < reinforcementPacksFor(r); k++) packs.push({ wave: w, units: roll(true), site: null });
  // named mini-boss (minibosses.ts, own seeded stream): one wave-0 pack in a room far from the heroes may become it
  const miniPack = miniBossHooks.plan?.(state, packs) ?? -1;
  // representative agent budget: beyond it, fodder of one archetype in a pack folds into cohort counts
  const totalUnits = packs.reduce((s, p) => s + p.units.length, 0);
  const fold = Math.max(1, Math.ceil(totalUnits / RULES.maxRepresentativeAgents));
  const groups: EncounterGroup[] = [];
  packs.forEach((pk, pi) => {
    const ents: { kind: string; count: number }[] = [{ kind: pk.units[0], count: 1 }];
    const fodder = new Map<string, number>();
    for (const u of pk.units.slice(1)) fodder.set(u, (fodder.get(u) ?? 0) + 1);
    for (const [kind, c] of fodder) {
      const n = Math.ceil(c / fold);
      for (let i = 0; i < n; i++) ents.push({ kind, count: Math.floor(c / n) + (i < c % n ? 1 : 0) });
    }
    ents.forEach((en, k) => {
      const g: EncounterGroup = { id: groups.length, weight: 1, archetype: en.kind, wave: pk.wave, spawned: false, defeated: false, countText: String(en.count), pack: pi };
      if (pk.site) { [g.x, g.y] = memberSpot(state, pk.site.x, pk.site.y, k, ents.length); g.dormant = true; }
      if (pi === miniPack && k === 0) g.mini = true;
      groups.push(g);
    });
  });
  return { groups, packs: packs.length, units: totalUnits };
}
