import { Big } from '@cursebound/numeric';
import { BOSS_BY_ID, CLASS_BY_ID, DODGE, LEGENDARY_BY_ID, NODE_BY_ID, PACK_BY_ID, RULES, TICK_RATE, TICK_SEC, referenceSec, type GearSlot } from '@cursebound/content';
import { tickDots } from './combat';
import { stepKnock } from './knock';
import { generateCourtyard } from './courtyard';
import { createEnemy } from './director';
import { makeElite } from './elites';
import { makeMiniBoss, miniBossPool } from './minibosses';
import { nearestFloor } from './map';
import { nextInt, seedRng } from './rng';
import { rebuildSkills } from './sim';
import { trainingRoomEvent } from './roomEvents';
import { ONE, derivePlayer } from './stats';
import type { EnemyState, PlayerState, SimEvent, SimState } from './types';

// Training grounds (a training room's run; server rooms.ts + authority.ts mark it and never persist it). A solo or
// co-op sandbox in a sunlit town courtyard (courtyard.ts):
//   - LOADOUT_LOCK starts the yard at once; ROUND_SETUP builds the courtyard with an empty encounter, and COMBAT then
//     never ends: no round clear, no score, no Fate offer, no party wipe (heroes respawn in place at full health);
//   - every skill-tree node is freely rankable at any time (points stay topped up at TRAINING_POINTS) and Refund all
//     works at any time;
//   - TRAIN commands (seat-scoped; the authority accepts them only in training rooms and this module re-checks
//     state.training): spawn any pack template as ordinary / champion / rare, spawn either boss, clear the yard,
//     switch enemy AI off (foes stand like dummies), reset the issuer's cooldowns, heal the issuer, swap the issuer's
//     class, set the foe level (the round number that scales new spawns).
// Deterministic: positions derive from the issuing hero, elite affixes from a stream seeded by run seed, tick and slot.

const DT = TICK_SEC;
/** Skill points a training hero always holds (allocation tops it back up). */
export const TRAINING_POINTS = 999;
/** Most foes alive in the yard at once (spawn requests past it are refused). */
export const TRAINING_MAX_ENEMIES = 72;
export const TRAINING_OPS = ['spawn', 'boss', 'clear', 'ai', 'cooldowns', 'heal', 'class', 'level', 'event', /* named mini-boss (minibosses.ts) */ 'miniboss'] as const;
export type TrainingOp = typeof TRAINING_OPS[number];

export function isTraining(state: SimState): boolean {
  return !!state.training;
}

/** ROUND_SETUP of a training run: the courtyard, an encounter with nothing to clear, heroes at the spawns. */
export function setupTraining(state: SimState, ev: SimEvent[]) {
  state.map = generateCourtyard(state.seed);
  state.enemies = []; state.projectiles = []; state.hazards = []; state.telegraphs = []; state.pendingSpawns = []; state.reactions = []; state.bossPhaseEvents = [];
  state.encounter = {
    round: state.round, isBoss: false, bossId: null, bossEntityId: null, groups: [], wave: -1, waveCount: 1, waveTimer: 0,
    objectiveTotal: 0, completedWeight: 0, referenceTicks: referenceSec(1) * TICK_RATE, activeTicks: 0, budget: '0', pressure: ONE, phaseAddsSpawned: [],
  };
  state.players.forEach((p, i) => {
    const s = state.map!.playerSpawns[i % state.map!.playerSpawns.length];
    p.x = s.x; p.y = s.y; p.vx = 0; p.vy = 0;
    p.dodgeTimer = 0; p.guardTimer = 0; p.iframes = 0; p.attackWork = 0;
    p.skillPoints = TRAINING_POINTS;
  });
  ev.push({ t: 'domain', type: 'training_started', payload: { topology: state.map.topology } });
}

/** Per COMBAT tick (sim.ts combatTick, instead of the clear and wipe checks): fallen heroes stand straight back up. */
export function trainingTick(state: SimState, ev: SimEvent[]) {
  // a slain training boss leaves the boss bar
  const enc = state.encounter;
  if (enc?.bossEntityId != null && !state.enemies.some((e) => e.id === enc.bossEntityId && e.state !== 'dying')) { enc.isBoss = false; enc.bossId = null; enc.bossEntityId = null; }
  for (const p of state.players) {
    if (p.lifeState === 'alive') continue;
    p.lifeState = 'alive';
    p.hp = p.maxHp;
    p.downTimer = 0; p.selfReviveChannel = 0; p.reviveProgress = 0; p.reviverSlot = null; p.downsThisRound = 0;
    p.iframes = Math.max(p.iframes, 1);
    ev.push({ t: 'revived', slot: p.slot, by: null });
    ev.push({ t: 'training', op: 'respawn', slot: p.slot, x: p.x, y: p.y });
  }
}

/** A foe with the yard's AI switched off: no movement, attacks or perception; damage over time and death still run. */
export function trainingIdleEnemy(state: SimState, ev: SimEvent[], e: EnemyState) {
  if (e.state === 'dying') { e.deathTimer -= DT; return; }
  stepKnock(state, e);   // dummies still take knockback (knock.ts)
  e.hitFlash = Math.max(0, e.hitFlash - 1);
  e.vx = 0; e.vy = 0;
  if (e.attack) e.attack = null;
  if (e.state !== 'stagger') e.state = 'idle';
  tickDots(state, ev, e);
}

/** True when the yard's foes should stand still (sim.ts combatTick picks trainingIdleEnemy over stepEnemy). */
export function trainingAiOff(state: SimState): boolean {
  return !!state.training && !state.training.ai;
}

/** Allocation in a training run: points never run out. */
export function topUpTrainingPoints(state: SimState, p: PlayerState) {
  if (state.training) p.skillPoints = TRAINING_POINTS;
}

// ---------------- TRAIN commands ----------------

export type TrainResult = { ok: true } | { ok: false; code: string };

/** Where a spawn lands: ahead of the issuing hero along their aim, on open floor. */
function spawnPoint(state: SimState, p: PlayerState, dist: number): [number, number] {
  return nearestFloor(state.map!, p.x + p.aimX * dist, p.y + p.aimY * dist);
}

function living(state: SimState): number {
  return state.enemies.filter((e) => e.state !== 'dying').length;
}

function spawnPack(state: SimState, ev: SimEvent[], p: PlayerState, packId: string, tier: number): TrainResult {
  const t = PACK_BY_ID[packId];
  if (!t) return { ok: false, code: 'UNKNOWN_PACK' };
  if (living(state) + 4 > TRAINING_MAX_ENEMIES) return { ok: false, code: 'YARD_FULL' };
  const [cx, cy] = spawnPoint(state, p, 4.5);
  const units = [t.lead];
  for (let k = 0; units.length < 4; k++) units.push(t.fodder[k % t.fodder.length]);
  const rng = seedRng(state.seed, 'training', state.tick, p.slot);
  units.forEach((kind, k) => {
    const ang = (k / units.length) * Math.PI * 2 + 0.4;
    const [x, y] = k === 0 ? [cx, cy] : nearestFloor(state.map!, cx + Math.cos(ang) * 1.2, cy + Math.sin(ang) * 1.2);
    const e = createEnemy(state, kind, x, y, ONE, { objective: false, groupId: -1, summonerId: null });
    state.enemies.push(e);
    ev.push({ t: 'spawn', id: e.id, kind: e.kind, x, y });
    if (k === 0 && (tier === 1 || tier === 2)) makeElite(state, ev, e, tier, rng);
  });
  return { ok: true };
}

/**
 * A named mini-boss (minibosses.ts) with its escorts: the lead of pack `packId`, or (no arg) a pack lead drawn from
 * every theme's mini-boss pool. Identity from a stream per run seed, tick and slot. At most one alive at a time.
 */
function spawnMiniBoss(state: SimState, ev: SimEvent[], p: PlayerState, packId: string | undefined): TrainResult {
  if (state.enemies.some((e) => e.mini && e.state !== 'dying')) return { ok: false, code: 'MINIBOSS_ACTIVE' };
  if (living(state) + 1 + RULES.miniBossEscorts > TRAINING_MAX_ENEMIES) return { ok: false, code: 'YARD_FULL' };
  const rng = seedRng(state.seed, 'training-miniboss', state.tick, p.slot);
  let t = packId ? PACK_BY_ID[packId] : undefined;
  if (packId && !t) return { ok: false, code: 'UNKNOWN_PACK' };
  if (!t) {
    const pool = [...new Set(['sky', 'moon', 'server', 'catacombs'].flatMap((th) => miniBossPool(th, 99).map(([id]) => id)))];
    t = PACK_BY_ID[pool[nextInt(rng, pool.length)]];
  }
  const [cx, cy] = spawnPoint(state, p, 5.5);
  const units = [t.lead];
  while (units.length < 1 + RULES.miniBossEscorts) units.push(t.fodder[nextInt(rng, t.fodder.length)]);
  units.forEach((kind, k) => {
    const ang = (k / units.length) * Math.PI * 2 + 0.4;
    const [x, y] = k === 0 ? [cx, cy] : nearestFloor(state.map!, cx + Math.cos(ang) * 1.6, cy + Math.sin(ang) * 1.6);
    const e = createEnemy(state, kind, x, y, ONE, { objective: false, groupId: -1, summonerId: null });
    state.enemies.push(e);
    ev.push({ t: 'spawn', id: e.id, kind: e.kind, x, y });
    if (k === 0) makeMiniBoss(state, ev, e, rng);
  });
  return { ok: true };
}

function spawnBoss(state: SimState, ev: SimEvent[], p: PlayerState, bossId: string): TrainResult {
  if (!BOSS_BY_ID[bossId]) return { ok: false, code: 'UNKNOWN_BOSS' };
  if (state.enemies.some((e) => e.boss && e.state !== 'dying')) return { ok: false, code: 'BOSS_ACTIVE' };
  const [x, y] = spawnPoint(state, p, 6);
  const e = createEnemy(state, bossId, x, y, ONE, { boss: true, objective: false, groupId: -1, summonerId: null });
  state.enemies.push(e);
  const enc = state.encounter!;
  enc.isBoss = true; enc.bossId = bossId; enc.bossEntityId = e.id; enc.phaseAddsSpawned = []; enc.reinforce = [];
  ev.push({ t: 'spawn', id: e.id, kind: e.kind, x, y });
  return { ok: true };
}

/** Empty the yard: every foe, foe projectile, foe hazard, telegraph and pending arrival. */
export function clearYard(state: SimState) {
  state.enemies = [];
  state.projectiles = state.projectiles.filter((pr) => pr.owner === 'player');
  state.hazards = state.hazards.filter((h) => h.owner === 'player');
  state.telegraphs = [];
  state.pendingSpawns = [];
  state.bossPhaseEvents = [];
  const enc = state.encounter;
  if (enc) { enc.isBoss = false; enc.bossId = null; enc.bossEntityId = null; enc.phaseAddsSpawned = []; enc.reinforce = []; }
}

function resetCooldowns(p: PlayerState) {
  for (const s of p.skills) { if (!s.skillId) continue; s.cooldown = 0; s.charges = s.maxCharges; delete s.full; }
  p.dodgeCharges = DODGE.charges; p.dodgeCooldown = 0;
}

function heal(p: PlayerState) {
  p.lifeState = 'alive';
  p.hp = p.maxHp;
  p.downTimer = 0; p.selfReviveChannel = 0;
  if (p.aff?.poison) delete p.aff.poison;
  p.buffs = p.buffs.filter((b) => b.id !== 'poisoned');
}

/** Swap a training hero's class in place: starting grants only, fresh skills, class-only gear for other classes off. */
export function swapClass(state: SimState, p: PlayerState, classId: string): TrainResult {
  const cls = CLASS_BY_ID[classId];
  if (!cls) return { ok: false, code: 'UNKNOWN_CLASS' };
  p.classId = classId;
  p.ranks = {};
  for (const id of cls.nodes) if (NODE_BY_ID[id].starting) p.ranks[id] = NODE_BY_ID[id].rankLimit;
  p.spentByBranch = {};
  p.mastery = { damage: 0, health: 0, recovery: 0 };
  p.skillPoints = TRAINING_POINTS;
  p.vars = {}; p.buffs = []; p.skills = []; p.stormCasts = [];
  p.lastSkill = null; p.guardTimer = 0; p.guardAbsorbed = Big.ZERO; p.castAnim = 0; p.attackAnim = 0; p.attackWork = 0;
  if (p.gear) {
    const kept: Partial<Record<GearSlot, string>> = {};
    for (const [slot, id] of Object.entries(p.gear) as [GearSlot, string][]) { const def = LEGENDARY_BY_ID[id]; if (def && (!def.classId || def.classId === classId)) kept[slot] = id; }
    p.gear = kept;
  }
  // the old kit's summons, turrets, fields and shots leave with it
  state.hazards = state.hazards.filter((h) => !(h.owner === 'player' && h.ownerId === p.slot));
  state.projectiles = state.projectiles.filter((pr) => !(pr.owner === 'player' && pr.ownerId === p.slot));
  state.stateVersion++;
  rebuildSkills(p);
  const d = derivePlayer(state, p);
  p.maxHp = d.maxHp; p.hp = d.maxHp; p.shield = Big.ZERO;
  return { ok: true };
}

/** Apply a TRAIN command (sim.ts applyCommand). Refused outside training runs, outside COMBAT, and for bad args. */
export function applyTraining(state: SimState, ev: SimEvent[], p: PlayerState, op: string, arg: string | undefined, tier: number | undefined): TrainResult {
  if (!state.training) return { ok: false, code: 'NOT_TRAINING' };
  if (state.phase !== 'COMBAT' || !state.map || !state.encounter) return { ok: false, code: 'STALE_PHASE' };
  let r: TrainResult;
  switch (op as TrainingOp) {
    case 'spawn': r = spawnPack(state, ev, p, arg ?? '', tier ?? 0); break;
    case 'boss': r = spawnBoss(state, ev, p, arg ?? ''); break;
    case 'miniboss': r = spawnMiniBoss(state, ev, p, arg); break;
    case 'clear': clearYard(state); r = { ok: true }; break;
    case 'ai': {
      if (arg !== 'on' && arg !== 'off') { r = { ok: false, code: 'INVALID_INPUT' }; break; }
      state.training.ai = arg === 'on';
      if (!state.training.ai) {
        // frozen foes: no attack in progress, nothing of theirs still in the air or on the ground
        for (const e of state.enemies) e.attack = null;
        state.telegraphs = [];
        state.projectiles = state.projectiles.filter((pr) => pr.owner === 'player');
        state.hazards = state.hazards.filter((h) => h.owner === 'player');
      }
      r = { ok: true };
      break;
    }
    case 'cooldowns': resetCooldowns(p); r = { ok: true }; break;
    case 'heal': heal(p); r = { ok: true }; break;
    case 'class': r = swapClass(state, p, arg ?? ''); break;
    case 'level': {
      const n = Number(arg);
      if (!Number.isInteger(n) || n < 1 || n > 99) { r = { ok: false, code: 'INVALID_INPUT' }; break; }
      state.round = n;
      if (state.encounter) state.encounter.round = n;
      r = { ok: true };
      break;
    }
    // room events (roomEvents.ts): a shrine of any type, an altar, the merchant, a treasure imp or a heap of coins
    case 'event': r = trainingRoomEvent(state, ev, p, arg ?? ''); break;
    default: r = { ok: false, code: 'UNKNOWN_OP' };
  }
  if (r.ok) ev.push({ t: 'training', op, slot: p.slot, x: p.x, y: p.y });
  return r;
}
