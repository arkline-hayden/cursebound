import { Big, percentToFactor } from '@cursebound/numeric';
import {
  BRANCH_TIER_POINTS, CARD_BY_ID, CLASS_BY_ID, DODGE, cardById, cardMechanics, cardStatEffects, NODE_BY_ID, RULES, SKILL_BY_ID, TICK_RATE, TICK_SEC, TUTORIAL_CARD, defaultDeck, isBossRound,
} from '@cursebound/content';
import { separateEnemies, stepEnemy, stepEnemyHazard, stepEnemyProjectile } from './ai';
import { createEnemy, flushPendingSpawns, setupRound, spawnWave } from './director';
import { addScore, applyCard, castVote, drawOffer, partialAward, refreshMaxHp, resolveVotes, roundAward, voteCounts, voteShouldResolve } from './fate';
import { processReactions, stepPlayer, stepPlayerHazard, stepPlayerProjectile } from './players';
import { seedRng } from './rng';
import { hooks } from './hooks';
import { cinematicHoldTick, inCinematic } from './cinematic';
import { chooseDoor, effectiveCounts, placeDoors, stepVoting } from './doors';
import './classes';
import './elites';    // champion / rare monster affixes (global hooks)
import './pickups';   // potions and resource orbs (global hooks)
import './boons';     // Fate mechanics: boons and banes (global hooks)
import { settleLoot } from './gear';   // legendary gear: drops, pickup/swap, perks (global hooks; after pickups)
import { applyRoomEvent, placeMerchant, resetRoomEvents, settleRoomEvents } from './roomEvents';   // room events: shrines, altar, merchant, treasure imps, coins (global hooks)
import './minibosses';   // named mini-bosses: director slots, mechanics and loot (global hooks; after gear)
import { STATE_SCHEMA, stateHash } from './serialize';
import { applyTraining, setupTraining, topUpTrainingPoints, trainingAiOff, trainingIdleEnemy, trainingTick } from './training';   // training grounds
import { applyBlessing, blessingOn } from './blessing';   // Fate's Blessing
import { GUIDE_STEPS, guideAtDoors, guideIdle, guideTick, newGuide, setupGuide } from './tutorialRoom';   // guided first-run tutorial
import { applyBounty } from './bounty';
import { bountyRules } from './bountyRules';
import { B, ONE, derivePlayer } from './stats';
import type { Command, CommitRecord, Phase, PlayerInput, PlayerState, SimEvent, SimState, SkillRuntime } from './types';

// Authoritative run state machine (PRD §3.1): LOADOUT_LOCK -> ROUND_SETUP -> COMBAT -> ROUND_CLEAR ->
// SKILL_ALLOCATION -> FATE_OFFER -> VOTING -> FATE_COMMIT -> SAFE_CHECKPOINT -> ROUND_SETUP ...;
// COMBAT -> PARTY_WIPE | RETIRE_REQUEST -> FINALIZE -> RESULTS. The simulation alone advances phases.

const DT = TICK_SEC;
const ZERO = Big.ZERO;

export interface RosterEntry { slot: number; profileId: string; name: string; classId: string }

export interface CreateRunParams {
  runId: string;
  seed: string;
  mode: 'solo' | 'coop';
  trust: 'local' | 'lan' | 'trusted';
  challengeId?: string | null;
  contentHash: string;
  roster: RosterEntry[];
  tutorial?: boolean;
  deck?: string[];
  /** training grounds run (training.ts): courtyard sandbox, no score, records or Fate */
  training?: boolean;
  /** daily bounty modifier id (content bounties.ts), applied at creation by bounty.ts; absent/null = none */
  bounty?: string | null;
  /** guided first-run tutorial (tutorialRoom.ts): the tutorial crypt and its prompted steps, then the Fate doors */
  guided?: boolean;
}

function newPlayer(e: RosterEntry): PlayerState {
  const cls = CLASS_BY_ID[e.classId];
  if (!cls) throw new Error(`unknown class ${e.classId}`);
  const ranks: Record<string, number> = {};
  for (const id of cls.nodes) if (NODE_BY_ID[id].starting) ranks[id] = NODE_BY_ID[id].rankLimit;
  const p: PlayerState = {
    slot: e.slot, profileId: e.profileId, name: e.name, classId: e.classId, connected: true, disconnectedAtTick: null,
    ranks, skillPoints: RULES.startingSkillPoints, spentByBranch: {}, mastery: { damage: 0, health: 0, recovery: 0 }, ready: false,
    x: 0, y: 0, vx: 0, vy: 0, aimX: 1, aimY: 0, aimDist: 3, facing: 0,
    hp: B(cls.base.maxHealth), maxHp: B(cls.base.maxHealth), shield: ZERO,
    lifeState: 'alive', downTimer: 0, downsThisRound: 0, selfReviveBlock: -1, selfReviveChannel: 0, reviveProgress: 0, reviverSlot: null,
    dodgeTimer: 0, dodgeCooldown: 0, dodgeCharges: DODGE.charges, surgeTimer: 0, dodgeDirX: 1, dodgeDirY: 0, iframes: 0, guardTimer: 0, guardMoved: false, guardAbsorbed: ZERO,
    attackWork: 0, attackAnim: 0, castAnim: 0, lastSkill: null, skills: [], buffs: [], vulnerability: 0, stormCasts: [], vars: {}, gear: {},
    lastInputSeq: 0, prevButtons: 0, lastHitBy: null, lastHitAmount: null, lastHitAttack: null, lastHitHpFrac: 1,
    stats: { damageDealt: ZERO, damageTaken: ZERO, revives: 0, downs: 0, healing: ZERO, prevented: ZERO },
    dpsWindow: [], dpsBucket: ZERO,
  };
  rebuildSkills(p);
  return p;
}

/**
 * Equipped actives come from tree grants: slot i = branch i's active; slot 3 = class signature. A branch may hold
 * evolved skills (tier >= 2 grants): the highest-tier owned grant replaces the branch's base active in its slot.
 */
export function rebuildSkills(p: PlayerState) {
  const cls = CLASS_BY_ID[p.classId];
  const old = new Map(p.skills.map((s) => [s.skillId, s]));
  const slots: SkillRuntime[] = [];
  for (const b of cls.branches) {
    const node = cls.nodes.map((id) => NODE_BY_ID[id])
      .filter((n) => n.branch === b.id && n.grantsSkill && (p.ranks[n.id] ?? 0) > 0)
      .sort((a, c) => c.tier - a.tier)[0];
    const skillId = node?.grantsSkill ?? '';
    slots.push(runtimeFor(p, skillId, old.get(skillId)));
  }
  slots.push(runtimeFor(p, cls.signatureSkill, old.get(cls.signatureSkill)));
  p.skills = slots;
}

function runtimeFor(p: PlayerState, skillId: string, prev?: SkillRuntime): SkillRuntime {
  if (!skillId) return { skillId: '', cooldown: 0, charges: 0, maxCharges: 0, mark: null };
  const def = SKILL_BY_ID[skillId];
  const maxCharges = def.charges + (skillId === 'a_phase_step' && (p.ranks['a_temporal_reserve'] ?? 0) > 0 ? 1 : 0) + hooks.extraCharges(p, skillId);
  if (prev) return { ...prev, maxCharges, charges: Math.min(prev.charges + (maxCharges - prev.maxCharges), maxCharges) };
  return { skillId, cooldown: 0, charges: maxCharges, maxCharges, mark: null };
}

export function createRun(params: CreateRunParams): SimState {
  if (params.roster.length < 1 || params.roster.length > RULES.maxPartySize) throw new Error('party size must be 1..5');
  const state: SimState = {
    schema: STATE_SCHEMA,
    runId: params.runId, seed: params.seed, mode: params.mode, trust: params.trust, challengeId: params.challengeId ?? null,
    contentHash: params.contentHash, deck: params.deck ?? defaultDeck(), tutorial: !!params.tutorial,
    tick: 0, stateVersion: 1, phase: 'LOADOUT_LOCK', phaseTimer: 0, phaseDeadlineTick: null, round: 0,
    n: params.roster.length,
    players: params.roster.slice().sort((a, b) => a.slot - b.slot).map((r, i) => newPlayer({ ...r, slot: i })),
    enemies: [], projectiles: [], hazards: [], telegraphs: [], map: null, encounter: null,
    rng: { offers: seedRng(params.seed, 'offers'), combat: seedRng(params.seed, 'combat'), ai: seedRng(params.seed, 'ai'), loot: seedRng(params.seed, 'loot') },
    nextId: 1, nextGen: 1,
    fate: { entries: [], factors: {} },
    offer: null, commits: [], rounds: [], scoreText: '0', partialText: '0', totalActiveTicks: 0, eventSeq: 0,
    retireVotes: [], endReason: null, resumed: false, awaitingDurable: null, incident: null, deathRecaps: [], lastClear: null,
    reactions: [], pendingSpawns: [], bossPhaseEvents: [], pickups: [], loot: [], lootFound: [],
  };
  if (params.mode === 'coop') state.phaseDeadlineTick = null;
  if (params.training) state.training = { ai: true };   // training grounds (training.ts)
  else if (params.guided) state.guide = newGuide();     // guided tutorial (tutorialRoom.ts); absent keeps old hashes
  if (params.bounty) applyBounty(state, params.bounty);   // daily bounty modifier (bounty.ts); absent keeps old hashes
  return state;
}

function setPhase(state: SimState, ev: SimEvent[], phase: Phase) {
  state.phase = phase;
  state.phaseTimer = 0;
  state.phaseDeadlineTick = null;
  ev.push({ t: 'phase', phase, round: state.round });
}

// ---------------- Skill allocation (REQ CLASS01) ----------------

export type AllocResult = { ok: true } | { ok: false; code: string };

export function canAllocate(state: SimState, p: PlayerState, nodeId: string): AllocResult {
  const node = NODE_BY_ID[nodeId];
  if (!node || node.classId !== p.classId) return { ok: false, code: 'UNKNOWN_NODE' };
  if (node.starting) return { ok: false, code: 'STARTING_GRANT' };
  const rank = p.ranks[nodeId] ?? 0;
  if (rank >= node.rankLimit) return { ok: false, code: 'MAX_RANK' };
  if (p.skillPoints < node.costPerRank) return { ok: false, code: 'NO_POINTS' };
  if ((p.spentByBranch[node.branch] ?? 0) < BRANCH_TIER_POINTS[node.tier]) return { ok: false, code: 'TIER_LOCKED' };
  for (const pr of node.prereqs) if ((p.ranks[pr.node] ?? 0) < pr.rank) return { ok: false, code: 'PREREQ' };
  for (const x of node.excludes ?? []) if ((p.ranks[x] ?? 0) > 0) return { ok: false, code: 'EXCLUSIVE' };
  return { ok: true };
}

export function hasSpendableNode(state: SimState, p: PlayerState): boolean {
  const cls = CLASS_BY_ID[p.classId];
  const saved = p.skillPoints;
  p.skillPoints = 1e9;
  const any = cls.nodes.some((id) => canAllocate(state, p, id).ok);
  p.skillPoints = saved;
  return any;
}

function allocate(state: SimState, p: PlayerState, nodeId: string): AllocResult {
  const r = canAllocate(state, p, nodeId);
  if (!r.ok) return r;
  const node = NODE_BY_ID[nodeId];
  const before = p.maxHp;
  p.ranks[nodeId] = (p.ranks[nodeId] ?? 0) + 1;
  p.skillPoints -= node.costPerRank;
  p.spentByBranch[node.branch] = (p.spentByBranch[node.branch] ?? 0) + node.costPerRank;
  state.stateVersion++;
  refreshMaxHp(p, before, derivePlayer(state, p).maxHp);
  rebuildSkills(p);
  return { ok: true };
}

function refundAll(state: SimState, p: PlayerState): AllocResult {
  // Respec permitted only before round 1 (proposed ranked rule, PRD §7.2); training grounds refund freely
  if (state.phase !== 'LOADOUT_LOCK' && !state.training) return { ok: false, code: 'RESPEC_LOCKED' };
  let refund = 0;
  for (const [id, r] of Object.entries(p.ranks)) {
    const n = NODE_BY_ID[id];
    if (!n || n.starting) continue;
    refund += r * n.costPerRank;
    delete p.ranks[id];
  }
  p.spentByBranch = {};
  p.skillPoints += refund;
  topUpTrainingPoints(state, p);
  state.stateVersion++;
  const before = p.maxHp;
  refreshMaxHp(p, before, derivePlayer(state, p).maxHp);
  rebuildSkills(p);
  return { ok: true };
}

// ---------------- Commands ----------------

export interface CommandOutcome { cmd: Command; ok: boolean; code?: string }

function applyCommand(state: SimState, ev: SimEvent[], cmd: Command): CommandOutcome {
  const p = 'slot' in cmd ? state.players[cmd.slot] : undefined;
  if ('slot' in cmd && !p) return { cmd, ok: false, code: 'INVALID_SLOT' };
  // training grounds (training.ts): the tree stays open in combat
  const intermission = state.phase === 'LOADOUT_LOCK' || state.phase === 'SKILL_ALLOCATION' || (!!state.training && state.phase === 'COMBAT');
  switch (cmd.type) {
    case 'ALLOCATE': {
      if (!intermission) return { cmd, ok: false, code: 'STALE_PHASE' };
      const r = allocate(state, p!, cmd.nodeId);
      if (r.ok) topUpTrainingPoints(state, p!);
      return r.ok ? { cmd, ok: true } : { cmd, ok: false, code: r.code };
    }
    case 'REFUND_ALL': {
      const r = refundAll(state, p!);
      return r.ok ? { cmd, ok: true } : { cmd, ok: false, code: r.code };
    }
    case 'MASTERY': {
      if (!intermission) return { cmd, ok: false, code: 'STALE_PHASE' };
      if (p!.skillPoints < 1 || hasSpendableNode(state, p!)) return { cmd, ok: false, code: 'MASTERY_LOCKED' };
      const before = p!.maxHp;
      p!.mastery[cmd.choice]++;
      p!.skillPoints--;
      state.stateVersion++;
      refreshMaxHp(p!, before, derivePlayer(state, p!).maxHp);
      return { cmd, ok: true };
    }
    case 'READY': {
      if (!intermission) return { cmd, ok: false, code: 'STALE_PHASE' };
      p!.ready = cmd.ready;
      return { cmd, ok: true };
    }
    case 'VOTE': {
      const r = castVote(state, cmd.slot, cmd.offerId, cmd.seq, cmd.cardSlot, cmd.locked);
      if (!r.ok) return { cmd, ok: false, code: r.code };
      ev.push({ t: 'vote', slot: cmd.slot, cardSlot: cmd.cardSlot, locked: cmd.locked, counts: voteCounts(state.offer!) });
      ev.push({ t: 'domain', type: 'vote_changed', payload: { offerId: cmd.offerId, slot: cmd.slot, seq: cmd.seq, cardSlot: cmd.cardSlot, locked: cmd.locked } });
      return { cmd, ok: true };
    }
    case 'RETIRE_VOTE': {
      const allowed: Phase[] = ['COMBAT', 'SKILL_ALLOCATION', 'VOTING', 'ROUND_SETUP', 'LOADOUT_LOCK'];
      if (!allowed.includes(state.phase)) return { cmd, ok: false, code: 'STALE_PHASE' };
      state.retireVotes = state.retireVotes.filter((s) => s !== cmd.slot);
      if (cmd.yes) state.retireVotes.push(cmd.slot);
      return { cmd, ok: true };
    }
    case 'CONNECT':
      p!.connected = true; p!.disconnectedAtTick = null;
      ev.push({ t: 'domain', type: 'reconnect_completed', payload: { slot: cmd.slot } });
      return { cmd, ok: true };
    case 'DISCONNECT':
      p!.connected = false; p!.disconnectedAtTick = state.tick;
      state.retireVotes = state.retireVotes.filter((s) => s !== cmd.slot);   // disconnected players abstain
      ev.push({ t: 'domain', type: 'reconnect_started', payload: { slot: cmd.slot } });
      return { cmd, ok: true };
    case 'DURABLE':
      if (state.awaitingDurable !== cmd.what) return { cmd, ok: false, code: 'NOT_AWAITING' };
      state.awaitingDurable = null;
      return { cmd, ok: true };
    case 'ABORT':
      if (state.phase === 'FINALIZE' || state.phase === 'RESULTS') return { cmd, ok: false, code: 'RUN_FINALIZED' };
      state.endReason = 'aborted_infrastructure';
      enterFinalize(state, ev, state.phase === 'COMBAT');
      return { cmd, ok: true };
    case 'TRAIN': {
      const r = applyTraining(state, ev, p!, cmd.op, cmd.arg, cmd.tier);
      return r.ok ? { cmd, ok: true } : { cmd, ok: false, code: r.code };
    }
    case 'BLESS': {
      const r = applyBlessing(state, ev, p!, cmd.offerId, cmd.cardSlot);
      return r.ok ? { cmd, ok: true } : { cmd, ok: false, code: r.code };
    }
    case 'EVENT': {   // room events (roomEvents.ts): shrine, altar pact, merchant purchase
      const r = applyRoomEvent(state, ev, p!, cmd.op, cmd.id, cmd.choice);
      return r.ok ? { cmd, ok: true } : { cmd, ok: false, code: r.code };
    }
    case 'INCIDENT':
      state.incident = cmd.reason;
      setPhase(state, ev, 'RECOVERY');
      ev.push({ t: 'incident', reason: cmd.reason });
      ev.push({ t: 'domain', type: 'technical_recovery', payload: { reason: cmd.reason, round: state.round } });
      return { cmd, ok: true };
  }
}

function retireMajority(state: SimState): boolean {
  // majority of the frozen roster; disconnected players abstain; a tie continues the run
  const yes = state.retireVotes.filter((s) => state.players[s]?.connected).length;
  return yes * 2 > state.n;
}

// ---------------- Phase handlers ----------------

function enterRoundSetup(state: SimState, ev: SimEvent[]) {
  state.round++;
  state.retireVotes = [];
  state.doors = null;   // the threshold of the last intermission is gone (doors.ts)
  resetRoomEvents(state);   // so are the last floor's shrines, altar and merchant (roomEvents.ts)
  setPhase(state, ev, 'ROUND_SETUP');
  if (state.training) setupTraining(state, ev);   // the courtyard (training.ts)
  else if (state.guide) setupGuide(state, ev);    // the tutorial crypt (tutorialRoom.ts)
  else setupRound(state, ev);
  if (state.tutorial && state.round === 1 && !state.guide) {
    // tutorial: a gentle first encounter teaching movement and one enemy attack
    const enc = state.encounter!;
    enc.groups = enc.groups.slice(0, 2).map((g, i) => ({ ...g, archetype: 'pursuer', wave: 0, countText: '1', id: i }));
    enc.objectiveTotal = enc.groups.length;
    enc.waveCount = 1;
  }
  // round-intro cutscene (client): heroes stand frozen at their spawns for RULES.setupSec
  delete state.cinematicUntilTick;
  ev.push({ t: 'round_intro', round: state.round, theme: state.map?.theme ?? 'catacombs', boss: isBossRound(state.round) });
}

function combatTick(state: SimState, ev: SimEvent[], inputs: (PlayerInput | null | undefined)[]) {
  if (inCinematic(state)) return;   // never step a held fight (step() parks it in cinematicHoldTick)
  const enc = state.encounter!;
  enc.activeTicks++;
  state.totalActiveTicks++;
  flushPendingSpawns(state, ev);
  // inputs -> movement & collision -> ability readiness -> attack events -> intersections -> damage
  for (const p of state.players) stepPlayer(state, ev, p, p.connected ? (inputs[p.slot] ?? null) : null);
  processReactions(state, ev);
  // projectiles spawned while stepping (ricochets, on-hit / on-kill shards) are appended past `stepped` and kept for next tick
  const stepping = state.projectiles, stepped = stepping.length;
  state.projectiles = stepping.filter((pr, i) => i >= stepped || (pr.owner === 'player' ? stepPlayerProjectile(state, ev, pr) : stepEnemyProjectile(state, ev, pr)));
  if (stepping.length > stepped) state.projectiles.push(...stepping.slice(stepped));
  for (const h of state.hazards) (h.owner === 'player' ? stepPlayerHazard : stepEnemyHazard)(state, ev, h);
  state.hazards = state.hazards.filter((h) => h.untilTick > state.tick);
  // statuses, AI and enemy attacks
  const idle = trainingAiOff(state);   // training grounds: foes may stand still like dummies
  for (const e of state.enemies) (idle || guideIdle(state, e) ? trainingIdleEnemy : stepEnemy)(state, ev, e);   // tutorial dummies too
  separateEnemies(state);
  hooks.onTick(state, ev);
  // deaths -> progression
  if (state.bossPhaseEvents.length) {
    if (!state.training) for (const ph of state.bossPhaseEvents) {   // training bosses carry no objective
      enc.completedWeight = Math.max(enc.completedWeight, ph);   // finishing phase i credits its fixed weight once
      ev.push({ t: 'objective', groupId: 0, weight: 1, completed: enc.completedWeight, total: enc.objectiveTotal });
      ev.push({ t: 'domain', type: 'objective_completed', payload: { round: state.round, completedWeight: enc.completedWeight, total: enc.objectiveTotal, bossPhase: ph } });
    }
    state.bossPhaseEvents = [];
  }
  for (const g of enc.groups) {
    if (!g.spawned || g.defeated) continue;
    const alive = state.enemies.some((e) => e.groupId === g.id && e.objective && e.state !== 'dying');
    if (!alive) {
      g.defeated = true;
      if (enc.isBoss) enc.completedWeight = enc.objectiveTotal;
      else enc.completedWeight += g.weight;
      ev.push({ t: 'objective', groupId: g.id, weight: g.weight, completed: enc.completedWeight, total: enc.objectiveTotal });
      ev.push({ t: 'domain', type: 'objective_completed', payload: { round: state.round, groupId: g.id, completedWeight: enc.completedWeight, total: enc.objectiveTotal } });
    }
  }
  state.enemies = state.enemies.filter((e) => !(e.state === 'dying' && e.deathTimer <= 0));
  state.telegraphs = state.telegraphs.filter((t) => t.releaseTick >= state.tick - 2);
  // waves
  enc.waveTimer += DT;
  if (enc.wave < enc.waveCount - 1) {
    const cur = enc.groups.filter((g) => g.wave === enc.wave);
    const left = cur.filter((g) => !g.defeated).length;
    if (enc.waveTimer >= RULES.waveTriggerSec || left <= Math.floor(cur.length * RULES.waveTriggerRemainingFrac)) spawnWave(state, ev, enc.wave + 1);
  }
  // DPS measurement window (Forecast estimates)
  if (enc.activeTicks % TICK_RATE === 0) {
    for (const p of state.players) {
      p.dpsWindow.push(p.dpsBucket);
      if (p.dpsWindow.length > 10) p.dpsWindow.shift();
      p.dpsBucket = ZERO;
    }
  }
  if (state.training) { trainingTick(state, ev); return; }   // training grounds: no clear, no wipe (heroes respawn)
  if (state.guide) { if (guideTick(state, ev)) enterRoundClear(state, ev); return; }   // tutorial: its steps clear the hall
  // clear and wipe checks (simultaneous boss kill and wipe: objective credit first, then wipe)
  const cleared = enc.wave >= enc.waveCount - 1 && enc.groups.every((g) => g.defeated);
  const anyAlive = state.players.some((p) => p.lifeState === 'alive' || p.selfReviveChannel > 0);
  if (!anyAlive) {
    if (cleared) enc.completedWeight = enc.objectiveTotal;
    state.endReason = 'wipe';
    setPhase(state, ev, 'PARTY_WIPE');
    ev.push({ t: 'domain', type: 'party_wipe', payload: { round: state.round, completedWeight: enc.completedWeight } });
    return;
  }
  if (cleared) enterRoundClear(state, ev);
}

function enterRoundClear(state: SimState, ev: SimEvent[]) {
  const enc = state.encounter!;
  const r = state.round;
  const { award, num, den } = roundAward(r, enc.pressure, enc.activeTicks, enc.referenceTicks);
  state.scoreText = addScore(state.scoreText, award);
  state.rounds.push({
    round: r, cleared: true, basePoints: String(Number(r) * RULES.scoreBasePerRound + (isBossRound(r) ? RULES.scoreBossAddend : 0)),
    pressure: enc.pressure.toString(), activeTicks: enc.activeTicks, referenceTicks: enc.referenceTicks,
    speedNum: num.toString(), speedDen: den.toString(), completedWeight: enc.objectiveTotal, objectiveTotal: enc.objectiveTotal, awarded: award.toString(),
  });
  if (state.rounds.length > 500) state.rounds.splice(0, state.rounds.length - 500);   // bounded history (K10); totals are exact in scoreText
  state.lastClear = { round: r, points: award.toString(), cleared: true };
  const points = isBossRound(r) ? RULES.pointsBoss : RULES.pointsOrdinary;
  const healFactor = bountyRules(state).intermissionHealFactor ?? 1;   // "No Respite" bounty: 0
  for (const p of state.players) {
    p.skillPoints += points;
    p.ready = false;
    if (p.lifeState !== 'alive') {
      p.lifeState = 'alive';
      p.hp = p.maxHp.mul(B(RULES.clearReturnHealthFrac));
      p.selfReviveChannel = 0; p.downTimer = 0;
    } else if (healFactor > 0) {
      const heal = p.maxHp.mul(B(RULES.intermissionHealFrac));
      p.hp = Big.min(p.maxHp, p.hp.add(healFactor === 1 ? heal : heal.mulNum(healFactor)));
    }
    p.downsThisRound = 0;
    p.guardTimer = 0; p.dodgeTimer = 0; p.buffs = [];
  }
  settleLoot(state, ev);   // unclaimed legendaries: nearest open slot, otherwise carried into the next round
  settleRoomEvents(state, ev);   // unclaimed cursed coins pay the party (roomEvents.ts / coins.ts)
  state.enemies = []; state.projectiles = []; state.hazards = []; state.telegraphs = []; state.reactions = []; state.pendingSpawns = []; state.pickups = [];
  setPhase(state, ev, 'ROUND_CLEAR');
  ev.push({ t: 'domain', type: 'round_cleared', payload: {
    round: r, objectiveWeight: enc.objectiveTotal, activeTicks: enc.activeTicks, referenceTicks: enc.referenceTicks,
    basePoints: state.rounds[state.rounds.length - 1].basePoints, pressureFactor: enc.pressure.toString(), speedFactor: `${num}/${den}`, awardedScoreText: award.toString(),
  } });
}

function enterFinalize(state: SimState, ev: SimEvent[], fromCombat: boolean) {
  const enc = state.encounter;
  let partial = 0n;
  if (fromCombat && enc && enc.completedWeight > 0) {
    partial = partialAward(state.round, enc.pressure, enc.completedWeight, enc.objectiveTotal);
    state.rounds.push({
      round: state.round, cleared: false, basePoints: String(state.round * RULES.scoreBasePerRound + (isBossRound(state.round) ? RULES.scoreBossAddend : 0)),
      pressure: enc.pressure.toString(), activeTicks: enc.activeTicks, referenceTicks: enc.referenceTicks, speedNum: '1', speedDen: '1',
      completedWeight: enc.completedWeight, objectiveTotal: enc.objectiveTotal, awarded: partial.toString(),
    });
  }
  state.partialText = partial.toString();
  state.scoreText = addScore(state.scoreText, partial);
  state.enemies = []; state.projectiles = []; state.hazards = []; state.telegraphs = [];
  setPhase(state, ev, 'FINALIZE');
  state.awaitingDurable = 'finalize';
  ev.push({ t: 'domain', type: 'run_finalized', payload: { endReason: state.endReason, scoreText: state.scoreText, depth: clearedDepth(state), activeTicks: state.totalActiveTicks, partialText: state.partialText } });
}

export function clearedDepth(state: SimState): number {
  let d = 0;
  for (const r of state.rounds) if (r.cleared && r.round > d) d = r.round;
  return Math.max(d, state.lastClear?.round ?? 0);
}

function startOffer(state: SimState, ev: SimEvent[]) {
  setPhase(state, ev, 'FATE_OFFER');
  const snapshotHash = stateHash(state);
  state.offer = drawOffer(state, snapshotHash);
  if (state.tutorial && state.round === 1) state.offer.cards[0] = TUTORIAL_CARD.id;
  ev.push({ t: 'domain', type: 'fate_offered', payload: { offerId: state.offer.id, round: state.round, cards: state.offer.cards, snapshotHash, deadlineTick: state.offer.deadlineTick } });
  setPhase(state, ev, 'VOTING');
  state.phaseDeadlineTick = state.offer.deadlineTick;
  state.doors = placeDoors(state);   // the vote happens in the cleared map: three themed doors (doors.ts)
  placeMerchant(state, ev);   // a wandering merchant may wait by the doors (roomEvents.ts)
}

/** `door`: the party completed a hold on that door (doors.ts) and commits to it directly; otherwise plurality of the
 *  effective votes (door stood in, else explicit VOTE) with the seeded tie-break. */
function commitOffer(state: SimState, ev: SimEvent[], door?: number) {
  const offer = state.offer!;
  const prior = offer.snapshotHash;
  const counts = effectiveCounts(state);
  const { cardSlot, tie } = door !== undefined
    ? { cardSlot: door, tie: { tiedSlots: [door], draw: null, zeroVotes: false, counts } }
    : resolveVotes(state, counts);
  const cardId = offer.cards[cardSlot];
  const blessedBy = blessingOn(offer, cardSlot)?.slot;   // Fate's Blessing: the price is lifted (blessing.ts)
  offer.resolved = true;
  setPhase(state, ev, 'FATE_COMMIT');
  applyCard(state, cardId, offer.id, ev, blessedBy !== undefined);
  const chosen = chooseDoor(state, cardSlot);   // the next floor uses this door's theme
  if (chosen) ev.push(chosen);
  state.eventSeq++;
  const record: CommitRecord = { offerId: offer.id, round: state.round, cardId, cardSlot, tie, priorStateHash: prior, resultingStateHash: '', eventSeq: state.eventSeq, tick: state.tick };
  if (blessedBy !== undefined) record.blessed = blessedBy;
  state.commits.push(record);
  if (state.commits.length > 1000) state.commits.splice(0, state.commits.length - 1000);
  record.resultingStateHash = stateHash(state);
  state.awaitingDurable = 'commit';
  ev.push({ t: 'domain', type: 'fate_committed', payload: { offerId: offer.id, cardId, cardSlot, tieEvidence: tie, priorStateHash: prior, resultingStateHash: record.resultingStateHash, factors: CARD_FACTORS(cardId, blessedBy !== undefined), ...(blessedBy !== undefined ? { blessedBy } : {}) } });
}

function CARD_FACTORS(cardId: string, blessed = false) {
  const c = cardById(cardId);
  if (!c) return [];
  return [
    ...cardStatEffects(c).filter((x) => !blessed || x.side !== 'price').map(({ effect: e }) => ({ stat: e.stat, percent: e.percent, factor: percentToFactor(e.percent).toString() })),
    ...cardMechanics(c).filter((x) => !blessed || x.side !== 'price').map(({ effect: m }) => ({ mechanic: m.id, magnitude: m.magnitude })),
  ];
}

/** Advance the authoritative simulation by one tick. */
export function step(state: SimState, inputs: (PlayerInput | null | undefined)[], commands: Command[] = []): { events: SimEvent[]; outcomes: CommandOutcome[] } {
  const ev: SimEvent[] = [];
  const outcomes = commands.map((c) => applyCommand(state, ev, c));
  if (state.phase === 'RECOVERY' || state.phase === 'RESULTS') { state.tick++; return { events: ev, outcomes }; }
  state.phaseTimer += DT;
  const retire = retireMajority(state);
  switch (state.phase) {
    case 'LOADOUT_LOCK':
      if (retire) { state.endReason = 'retired'; enterFinalize(state, ev, false); break; }
      // training grounds and the tutorial open at once (no loadout to confirm)
      if ((state.players.every((p) => p.ready || !p.connected) || state.training || state.guide) && state.players.some((p) => p.connected)) {
        for (const p of state.players) p.ready = false;
        ev.push({ t: 'domain', type: 'run_started', payload: { n: state.n, seed: state.seed, roster: state.players.map((p) => ({ slot: p.slot, classId: p.classId, ranks: p.ranks })) } });
        enterRoundSetup(state, ev);
      }
      break;
    case 'ROUND_SETUP':
      if (retire) { state.endReason = 'retired'; enterFinalize(state, ev, false); break; }
      if (state.phaseTimer >= RULES.setupSec) {
        setPhase(state, ev, 'COMBAT');
        if (!state.guide) spawnWave(state, ev, 0);   // boss rounds: boss_intro + cinematic hold (director.ts); the tutorial has no waves
        if (!inCinematic(state)) hooks.onRoundStart(state, ev);   // held rounds start when the hold releases
      }
      break;
    case 'COMBAT':
      if (retire) { state.endReason = 'retired'; setPhase(state, ev, 'RETIRE_REQUEST'); break; }
      if (inCinematic(state)) { cinematicHoldTick(state); break; }   // boss grand entrance: the fight is frozen
      if (state.cinematicUntilTick === state.tick && state.encounter?.activeTicks === 0) hooks.onRoundStart(state, ev);
      combatTick(state, ev, inputs);
      break;
    case 'ROUND_CLEAR':
      if (state.phaseTimer >= RULES.clearSummarySec && state.guide) { startOffer(state, ev); guideAtDoors(state); break; }   // tutorial: straight to the doors
      if (state.phaseTimer >= RULES.clearSummarySec) {
        setPhase(state, ev, 'SKILL_ALLOCATION');
        if (state.mode === 'coop') state.phaseDeadlineTick = state.tick + RULES.voteWindowSec * TICK_RATE;
      }
      break;
    case 'SKILL_ALLOCATION': {
      if (retire) { state.endReason = 'retired'; enterFinalize(state, ev, false); break; }
      const allReady = state.players.every((p) => p.ready || !p.connected) && state.players.some((p) => p.connected);
      if (allReady || (state.phaseDeadlineTick !== null && state.tick >= state.phaseDeadlineTick)) {
        for (const p of state.players) p.ready = false;
        startOffer(state, ev);
      }
      break;
    }
    case 'VOTING': {
      if (retire) { state.endReason = 'retired'; enterFinalize(state, ev, false); break; }
      const held = stepVoting(state, ev, inputs);   // heroes walk the cleared floor; standing in a door is a vote
      if (held !== null) commitOffer(state, ev, held);
      else if (voteShouldResolve(state)) commitOffer(state, ev);
      break;
    }
    case 'FATE_COMMIT':
      // the door walk-through plays for at least RULES.doorWalkSec, and the commit must be durable
      if (state.awaitingDurable === null && state.phaseTimer >= RULES.doorWalkSec - 1e-9 && state.guide) {
        state.guide.step = GUIDE_STEPS.length;   // tutorial: through the door, "You're ready" (no round 2)
        state.endReason = 'retired';
        enterFinalize(state, ev, false);
        break;
      }
      if (state.awaitingDurable === null && state.phaseTimer >= RULES.doorWalkSec - 1e-9) {
        setPhase(state, ev, 'SAFE_CHECKPOINT');
        ev.push({ t: 'domain', type: 'checkpoint_saved', payload: { round: state.round } });
        enterRoundSetup(state, ev);
      }
      break;
    case 'PARTY_WIPE':
      enterFinalize(state, ev, true);
      break;
    case 'RETIRE_REQUEST':
      enterFinalize(state, ev, true);
      break;
    case 'FINALIZE':
      if (state.awaitingDurable === null) setPhase(state, ev, 'RESULTS');
      break;
  }
  state.tick++;
  return { events: ev, outcomes };
}

/** Developer/test helper: spawn an enemy directly (unranked developer tools only). */
export function devSpawn(state: SimState, kind: string, x: number, y: number, count = ONE) {
  const e = createEnemy(state, kind, x, y, count, { objective: false, groupId: -1, summonerId: null });
  state.enemies.push(e);
  return e;
}

export function maxHpOf(state: SimState, p: PlayerState) { return derivePlayer(state, p).maxHp; }
