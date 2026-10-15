import type { Big } from '@cursebound/numeric';
import type { DamageType, GearSlot, TelegraphShape } from '@cursebound/content';
import type { RngState } from './rng';

// Authoritative simulation state (PRD §3.1, §17.2). Plain serializable data: Big values are immutable objects
// encoded as {$b: compact} in checkpoints. Entity collections are arrays (deterministic iteration order).

export type Phase =
  | 'LOADOUT_LOCK' | 'ROUND_SETUP' | 'COMBAT' | 'ROUND_CLEAR' | 'SKILL_ALLOCATION' | 'FATE_OFFER' | 'VOTING'
  | 'FATE_COMMIT' | 'SAFE_CHECKPOINT' | 'PARTY_WIPE' | 'RETIRE_REQUEST' | 'FINALIZE' | 'RESULTS' | 'RECOVERY';

export type EndReason = 'wipe' | 'retired' | 'aborted_infrastructure' | 'invalidated';
export type RunMode = 'solo' | 'coop';
export type Trust = 'local' | 'lan' | 'trusted';

export interface PlayerInput {
  seq: number;
  moveX: number;   // quantized [-1,1]
  moveY: number;
  aimX: number;    // aim point offset from player in world units, quantized
  aimY: number;
  buttons: number; // ACTION bits
}

export const ACTION = {
  ATTACK: 1,
  SKILL1: 2,
  SKILL2: 4,
  SKILL3: 8,
  SIGNATURE: 16,
  DODGE: 32,
  /** Pick up / swap legendary gear (gear.ts). */
  INTERACT: 64,
} as const;

export interface SkillRuntime {
  skillId: string;
  cooldown: number;     // seconds remaining (scaled by recovery rate as it ticks)
  charges: number;
  maxCharges: number;
  /** full length of the cooldown now recharging (cooldownOf at cast; snapshot fraction). Absent = the authored cooldown. */
  full?: number;
  /** Return mark position (Arcanist) */
  mark?: { x: number; y: number; until: number } | null;
}

export interface FateFactorEntry {
  seq: number;          // order of application in the run
  offerId: string;
  cardId: string;
  round: number;        // applied after clearing this round; active from round+1
  stat: string;
  percent: string;
  factor: Big;
}

/** A Fate mechanic (boon/bane) bound by a card: Ledger provenance (boons.ts implements the rules). */
export interface FateMechanicEntry {
  seq: number;          // shares the ordering of FateFactorEntry.seq (one timeline)
  offerId: string;
  cardId: string;
  round: number;
  mechanic: string;
  kind: 'boon' | 'bane';
  magnitude: string;
}

/** Aggregate of a bound mechanic: copies and the running product of per-copy factors (content MechanicStacking). */
export interface FateMechanicState { stacks: number; acc: Big }

export interface PlayerState {
  slot: number;
  profileId: string;
  name: string;
  classId: string;
  connected: boolean;
  disconnectedAtTick: number | null;
  // Build
  ranks: Record<string, number>;   // node id -> rank
  skillPoints: number;
  spentByBranch: Record<string, number>;
  mastery: { damage: number; health: number; recovery: number };
  ready: boolean;
  // Body
  x: number; y: number;
  vx: number; vy: number;
  aimX: number; aimY: number;      // normalized aim direction
  aimDist: number;
  facing: number;                   // dir8
  hp: Big;
  maxHp: Big;
  shield: Big;
  lifeState: 'alive' | 'downed' | 'dead';
  downTimer: number;               // seconds left while downed
  downsThisRound: number;
  selfReviveBlock: number;         // five-round block index whose self revive was used (-1 none)
  selfReviveChannel: number;       // seconds remaining (solo self revive)
  reviveProgress: number;          // seconds channelled by an ally
  reviverSlot: number | null;
  dodgeTimer: number;              // seconds remaining in dodge travel
  dodgeCooldown: number;           // seconds until the next dodge charge returns (0 when full)
  dodgeCharges: number;            // dashes available (DODGE.charges max)
  /** maximum dodge charges when a bounty changes it (bounty.ts, "Hobbled"); absent = DODGE.charges */
  dodgeMax?: number;
  surgeTimer: number;              // post-dash speed surge remaining (seconds)
  dodgeDirX: number; dodgeDirY: number;
  iframes: number;
  guardTimer: number;
  guardMoved: boolean;
  guardAbsorbed: Big;
  attackWork: number;              // fractional basic attack work in [0,1)
  attackAnim: number;              // cosmetic timer for presentation
  castAnim: number;
  lastSkill: string | null;
  skills: SkillRuntime[];          // [active1, active2, active3, signature]
  buffs: { id: string; until: number; value: number }[];
  vulnerability: number;           // not used for players currently
  stormCasts: number[];            // ticks of recent storm casts (Tempest)
  /** Class-kit and Fate-mechanic counters (stacks, marks, timers in ticks). Plain numbers only, deterministic. */
  vars: Record<string, number>;
  /** Equipped legendary items by gear slot (gear.ts). Lasts the whole run. Absent in pre-gear checkpoints. */
  gear?: Partial<Record<GearSlot, string>>;
  /** Enemy-inflicted affliction bookkeeping (afflictions.ts): chill stacks, diminishing returns, chain anchor, poison. Created lazily. */
  aff?: PlayerAfflictions;
  /** Fate's Blessings carried (blessing.ts; content FATES_BLESSING). Absent = none. */
  bless?: number;
  /** Cursed coins in this hero's purse (coins.ts; room events). Absent = none. */
  coins?: number;
  /** Permanent personal stat changes bound by a cursed altar or bought from the merchant (roomEvents.ts; stats.ts
   *  applies them after Fate). Absent = none. */
  pacts?: PactRecord[];
  lastInputSeq: number;
  prevButtons: number;
  lastHitBy: string | null;        // for death recap
  lastHitAmount: Big | null;
  lastHitAttack: string | null;
  lastHitHpFrac: number;
  stats: { damageDealt: Big; damageTaken: Big; revives: number; downs: number; healing: Big; prevented: Big };
  dpsWindow: Big[];                // last 10 seconds of damage dealt, 1 bucket per second
  dpsBucket: Big;
}

/** A permanent personal stat change (roomEvents.ts): an altar pact or a merchant run boon. `mods` multiply
 *  independently after Fate (stats.ts pactFactor); `item` = the legendary a relic pact copied. */
export interface PactRecord {
  id: string;
  src: 'altar' | 'merchant';
  round: number;
  mods: { stat: string; factor: string }[];
  item?: string;
}

/** Affliction bookkeeping on a hero (afflictions.ts). The statuses themselves live in PlayerState.buffs. */
export interface PlayerAfflictions {
  /** plain numeric timers and counters (ticks / world units): chill stacks, DR windows, chain anchor */
  n: Record<string, number>;
  /** poison damage per second (enemy-scaled) and its source for recaps; absent when not poisoned */
  poison?: { dps: Big; source: string; attack: string; srcId?: number };
}

export interface Cohort {
  count: Big;          // logical unit count (D06)
  unitHp: Big;         // H: per-unit maximum health
  spread: Big;         // damage shared by every unit
  front: Big;          // extra damage on the front unit
}

export interface EnemyAttackState {
  attackId: string;
  stage: 'windup' | 'release' | 'recovery';
  timer: number;       // seconds remaining in stage (already scaled by enemy attack frequency)
  ox: number; oy: number;   // origin
  dx: number; dy: number;   // direction (normalized)
  tx: number; ty: number;   // target point
  hitSlots: number[];  // players already hit during this release
  telegraphId: number;
}

export interface EnemyState {
  id: number;
  gen: number;                 // entity generation (reused ids cannot attach old effects)
  kind: string;                // archetype or boss id
  boss: boolean;
  objective: boolean;
  groupId: number;             // objective group
  summonerId: number | null;
  x: number; y: number;
  vx: number; vy: number;
  fx: number; fy: number;      // facing vector
  radius: number;
  cohort: Cohort;
  armor: Big;
  damage: Big;                 // snapshot of round damage scaling (× enemy.damage), attack damage applies at release
  regenFrac: Big;              // per second fraction of max health (0 unless regen tagged)
  moveSpeed: number;           // world units/sec after factors (float, swept)
  attackFreq: Big;             // multiplier on cadence
  rapidWork: Big;              // accumulated attack cycles when cadence < tick
  // AI
  state: 'idle' | 'move' | 'windup' | 'attack' | 'recovery' | 'stagger' | 'dying';
  action: string;
  utility: Record<string, number>;
  targetSlot: number | null;
  path: number[];              // tile indices
  pathGoal: number;
  pathAge: number;
  stuckTimer: number;
  lastProgressX: number; lastProgressY: number;
  perceiveIn: number;          // ticks until next perception update
  reactIn: number;             // reaction delay countdown for dodging projectiles
  strafeSign: number;
  /** surround slot angle around the target hero (melee tactics, ai.ts); fleeing-until tick and once-only flag (cowards) */
  slotAng?: number;
  fleeUntil?: number;
  fled?: number;
  cooldowns: Record<string, number>;
  attack: EnemyAttackState | null;
  // statuses (source indexed aggregates, PRD §5.3)
  dots: { src: number; type: DamageType; perSec: Big; until: number }[];
  vulnUntil: number; vulnFactor: string;
  shield: Big; shieldUntil: number;
  ccResistUntil: number;
  stagger: number;             // boss stagger meter
  staggerUntil: number;
  knockX: number; knockY: number;
  // boss
  phaseIndex: number;
  patternIndex: number;
  patternStep: number;
  hitFlash: number;
  deathTimer: number;
  burning: boolean;
  /** Champion (1) / rare (2); absent = ordinary (elites.ts). */
  elite?: number;
  /** Monster affix ids (content AFFIXES). */
  affixes?: string[];
  /** Affix timers and counters (ticks / plain numbers, deterministic). */
  avars?: Record<string, number>;
  /** Fate mechanic markers (boons.ts: enrage, Blood Moon level, kill bookkeeping). Plain numbers, created lazily. */
  fateVars?: Record<string, number>;
  /** Legendary perk markers (gear.ts: chill slow factor and expiry). Plain numbers, created lazily. */
  gvars?: Record<string, number>;
  /** Crowd-control statuses (cc.ts): chill/freeze/snare/lure timers in ticks, chill factor, Ranger marks per slot. Created lazily. */
  ccVars?: Record<string, number>;
  /** Population pack id (director.ts); absent for summons, boss adds and dev spawns. */
  pack?: number;
  /** Idle until heroes come close (director.ts activation): no AI beyond a periodic aggro check. */
  dormant?: boolean;
  /** Named mini-boss (minibosses.ts): generated name, signature mechanic ids and their timers. Absent = not one. */
  mini?: MiniBossState;
}

/** A named mini-boss's identity and mechanic bookkeeping (minibosses.ts). Plain data, deterministic. */
export interface MiniBossState {
  name: string;
  /** signature mechanic ids (content MINIBOSS_MECHANICS), 1-2 */
  mechs: string[];
  /** timers in ticks and once-only flags (plain numbers) */
  v: Record<string, number>;
}

export interface Projectile {
  id: number;
  kind: string;                // 'spark' | 'wave' | 'shard' | 'orb' | 'lob'
  owner: 'player' | 'enemy';
  ownerId: number;             // slot or enemy id
  x: number; y: number;
  vx: number; vy: number;
  radius: number;
  range: number;               // remaining travel distance
  damage: Big;                 // snapshot at creation (persistent factors)
  weight: Big;                 // logical multiplicity
  dtype: DamageType;
  pierce: number;
  hitIds: number[];
  skillId: string;
  crit: boolean;
  dot?: { type: DamageType; fractionPerSec: string; durationSec: number };
  // lob
  lobTarget?: { x: number; y: number; radius: number; landTick: number } | null;
  bornTick: number;
}

export interface Hazard {
  id: number;
  /** Core kinds below; class kits add their own string kinds (handled by their hazardTick hook and client fx registry). */
  kind: 'fireline' | 'pool' | 'lightpool' | 'rootwall' | 'ring' | 'tempest' | 'horizon' | 'bastion' | (string & {});
  owner: 'player' | 'enemy';
  ownerId: number;
  x: number; y: number;
  dx: number; dy: number;
  length: number; width: number; radius: number;
  inner: number; outer: number; speed: number;
  bornTick: number;
  untilTick: number;
  nextTick: number;            // next damage application tick
  interval: number;            // ticks between applications
  damage: Big;                 // per application
  dtype: DamageType;
  generation: number;          // light pool split generation
  hitSlots: number[];
  dot?: { type: DamageType; fractionPerSec: string; durationSec: number };
  /** Affix hazards (elites.ts): tick at which the hazard arms or detonates. */
  armTick?: number;
  /** Class-kit hazard counters (e.g. Warden spirit beasts: target, cooldowns, leap). Plain numbers, deterministic. */
  vars?: Record<string, number>;
  /** Follower routing (follow.ts): remaining A* waypoints (tile indices) of a summon walking around walls / voids. */
  route?: number[];
}

/** Ground pickup (pickups.ts). Generic: `kind` 'potion' heals, 'orb' (haste orb) cuts skill cooldowns; other modules may add kinds. */
/** A legendary item lying on the ground (gear.ts). Persists until picked up; unclaimed items settle at round clear. */
export interface GroundLoot {
  id: number;
  itemId: string;
  x: number; y: number;
  bornTick: number;
  /** carried over from the previous round (relocated to the party at the next round start) */
  carry?: boolean;
}

/** A legendary found this run (Results). */
export interface LootRecord { itemId: string; round: number; source: 'enemy' | 'elite' | 'boss' }

export interface Pickup {
  id: number;
  kind: string;
  x: number; y: number;
  bornTick: number;
  untilTick: number;           // expires at this tick (0 = never)
  tier: number;                // 0 ordinary, 1 champion, 2 rare drop (bigger effect)
}

export interface Telegraph {
  id: number;
  ownerId: number;
  shape: TelegraphShape;
  x: number; y: number;
  dx: number; dy: number;
  startTick: number;
  releaseTick: number;
  attack: string;
}

/** Semantic room type (mapgen tier 2; content ROOM_KINDS). */
export type RoomKind =
  | 'crypt' | 'library' | 'cistern' | 'shrine' | 'ossuary' | 'collapsed' | 'pillared' | 'torture' | 'treasury'
  | 'barracks' | 'grotto' | 'forge' | 'bridge' | 'hall' | 'approach' | 'arena';

/** A typed room of a floor: its bounding rect in tiles (floor tiles inside it belong to it), kind and silhouette.
 *  `v` is a per-room variant seed the client dresses from (tier 3). */
export interface MapRoom {
  x: number; y: number; w: number; h: number;
  kind: RoomKind;
  shape: 'rect' | 'round' | 'cave' | 'hall';
  v: number;
}

export interface MapState {
  w: number; h: number;
  tiles: number[];             // 0 floor, 1 wall
  /** layout family plus the encoded room plan (mapgen encodeTopology), so clients that only receive the
   *  replicated map fields can still dress per room; decode with mapRooms() / mapVoids() */
  topology: string;
  playerSpawns: { x: number; y: number }[];
  enemySpawns: { x: number; y: number }[];
  fallback: boolean;
  decorSeed: number;
  theme: string;
  layout: string;
  /** typed rooms (tier 2); absent on old checkpoints and the fallback hall */
  rooms?: MapRoom[];
  /** wall tiles that are a bottomless chasm (still walls to the simulation; drawn as void, not masonry) */
  voids?: number[];
  /** boss arena design (content ARENA_DESIGNS) on boss floors */
  arena?: string;
  /** where the boss rises (its dais); absent = the legacy east-of-centre spot */
  bossSpawn?: { x: number; y: number };
}

export interface EncounterGroup {
  id: number;
  weight: number;
  archetype: string;
  wave: number;
  spawned: boolean;
  defeated: boolean;
  countText: string;           // logical cohort count for display
  /** population pack (director.ts) and its planned spawn point; reinforcement packs pick their point when they arrive */
  pack?: number;
  x?: number; y?: number;
  /** spawns idle (population packs) */
  dormant?: boolean;
  /** the pack's lead is the round's named mini-boss (minibosses.ts) */
  mini?: boolean;
}

export interface EncounterState {
  round: number;
  isBoss: boolean;
  bossId: string | null;
  bossEntityId: number | null;
  groups: EncounterGroup[];
  wave: number;
  waveCount: number;
  waveTimer: number;           // seconds since current wave spawned
  objectiveTotal: number;
  completedWeight: number;
  referenceTicks: number;
  activeTicks: number;
  budget: string;              // logical budget for disclosure
  pressure: Big;               // M_r at round start
  /** boss reinforcement waves already called (1 = at 2/3 health, 2 = at 1/3; director.ts bossReinforcements) */
  phaseAddsSpawned: number[];
  /** boss reinforcement waves telegraphed and on their way: they spawn at `tick` */
  reinforce?: { tick: number; spawns: PendingSpawn[] }[];
  /** number of population + reinforcement packs this round (HUD) */
  packCount?: number;
}

export interface RoundResult {
  round: number;
  cleared: boolean;
  basePoints: string;
  pressure: string;            // Big canonical
  activeTicks: number;
  referenceTicks: number;
  speedNum: string;            // (1+v) numerator/denominator as text for audit
  speedDen: string;
  completedWeight: number;
  objectiveTotal: number;
  awarded: string;             // score text
}

export interface OfferState {
  id: string;
  round: number;               // offered after clearing this round
  cards: string[];             // exactly three distinct ids
  snapshotHash: string;        // immutable pre choice state version
  stateVersion: number;
  deadlineTick: number | null;
  votes: { slot: number; seq: number; cardSlot: number | null; locked: boolean }[];
  resolved: boolean;
  /** Dungeon theme behind each card's door (doors.ts), one per card, distinct, never the current theme. Absent in pre-door checkpoints. */
  themes?: string[];
  /** Fate's Blessings applied to this offer (blessing.ts): card slot and the hero who blessed it. At most one per card. */
  blessed?: { card: number; slot: number }[];
}

/** One of the three doors of an intermission (doors.ts). (x, y): floor tile centre in front of the opening;
 *  (nx, ny): unit normal into the room; th: theme behind the door; c: the card it binds. Door i carries card i. */
export interface DoorState { i: 0 | 1 | 2; x: number; y: number; nx: number; ny: number; th: string; c: string }

/** The door threshold of the current VOTING / FATE_COMMIT (doors.ts). Cleared at ROUND_SETUP. */
export interface DoorsState {
  list: DoorState[];
  /** the round behind the doors is a boss round (boss lair: arena layout) */
  boss: boolean;
  /** door the whole eligible party currently stands in (-1 none) and for how many ticks */
  holdDoor: number;
  holdTicks: number;
  /** committed door (FATE_COMMIT), else null */
  chosen: number | null;
}

export interface CommitRecord {
  offerId: string;
  round: number;
  cardId: string;
  cardSlot: number;
  tie: { tiedSlots: number[]; draw: number | null; zeroVotes: boolean; counts: number[] };
  priorStateHash: string;
  resultingStateHash: string;
  eventSeq: number;
  tick: number;
  /** the committed card was blessed (blessing.ts): its price was not applied; value = the slot that blessed it */
  blessed?: number;
}

export interface SimState {
  schema: number;
  runId: string;
  seed: string;
  mode: RunMode;
  trust: Trust;
  challengeId: string | null;
  contentHash: string;
  deck: string[];
  tutorial: boolean;
  tick: number;
  stateVersion: number;
  phase: Phase;
  phaseTimer: number;          // seconds in current phase (or remaining for timed phases)
  phaseDeadlineTick: number | null;
  round: number;
  n: number;                   // frozen party size
  players: PlayerState[];
  enemies: EnemyState[];
  projectiles: Projectile[];
  hazards: Hazard[];
  telegraphs: Telegraph[];
  map: MapState | null;
  encounter: EncounterState | null;
  rng: { offers: RngState; combat: RngState; ai: RngState; /** legendary drops (gear.ts); seeded lazily for pre-gear checkpoints */ loot?: RngState; /** room events and coin drops (roomEvents.ts, coins.ts); seeded lazily */ events?: RngState };
  nextId: number;
  nextGen: number;
  fate: {
    entries: FateFactorEntry[];
    factors: Record<string, Big>;
    /** Bound boons/banes by mechanic id (absent in pre-mechanic checkpoints = none bound). */
    mechanics?: Record<string, FateMechanicState>;
    mechanicEntries?: FateMechanicEntry[];
  };
  offer: OfferState | null;
  commits: CommitRecord[];
  rounds: RoundResult[];
  scoreText: string;
  partialText: string;
  totalActiveTicks: number;
  eventSeq: number;
  retireVotes: number[];       // slots voting to retire
  endReason: EndReason | null;
  resumed: boolean;
  awaitingDurable: 'commit' | 'finalize' | null;
  incident: string | null;
  deathRecaps: DeathRecap[];
  lastClear: { round: number; points: string; cleared: boolean } | null;
  reactions: Reaction[];
  pendingSpawns: PendingSpawn[];
  bossPhaseEvents: number[];
  /** Ground pickups (potions, haste orbs). */
  pickups: Pickup[];
  /** Legendary items on the ground (gear.ts). Absent in pre-gear checkpoints. */
  loot?: GroundLoot[];
  /** Legendaries dropped this run, bounded (Results). */
  lootFound?: LootRecord[];
  /** Door threshold during VOTING and FATE_COMMIT (doors.ts); null/absent otherwise. */
  doors?: DoorsState | null;
  /** Theme chosen through a door for the given round (setupRound builds that round's map with it). */
  nextTheme?: { round: number; theme: string } | null;
  /**
   * Cinematic hold (cinematic.ts): while `tick < cinematicUntilTick` the fight is frozen for a cutscene (the boss
   * grand entrance): no player actions, no AI, no damage, no hazard / projectile / wave progress. Absent = never held.
   */
  cinematicUntilTick?: number;
  /** Training grounds (training.ts): present only in training runs (no scoring, no records, no Fate, no wipe). */
  training?: TrainingState | null;
  /** Daily bounty modifier the run was created with (content bounties.ts, applied by bounty.ts). Absent = none. */
  bounty?: string | null;
  /** Room events of the current floor (roomEvents.ts): shrines, altar, merchant, the pending treasure imp. */
  roomEvents?: RoomEventState | null;
}

/** A room event on the current floor (roomEvents.ts): a shrine (`type` = content SHRINES id), a cursed altar
 *  (`offers`: three seeded pact ids, 'relic:<item>' for the relic pact) or the wandering merchant (`stock`). */
export interface RoomEvent {
  id: number;
  kind: 'shrine' | 'altar' | 'merchant';
  type: string;
  x: number; y: number;
  /** shrine / altar spent (dark) */
  used?: boolean;
  offers?: string[];
  /** merchant shelf rows: ware id (content MERCHANT_WARES), price, units left; `item` = the legendary on sale */
  stock?: { ware: string; price: number; left: number; item?: string }[];
}

/** The current floor's room events (roomEvents.ts). Reset at ROUND_SETUP. */
export interface RoomEventState {
  list: RoomEvent[];
  /** tick at which this floor's treasure imp appears (absent = none, or already out) */
  runnerAt?: number;
}

/** Training-room switches (training.ts). Plain data, part of the replayed state. */
export interface TrainingState {
  /** enemy AI runs (false = foes stand still like dummies) */
  ai: boolean;
}

export interface PendingSpawn { kind: string; x: number; y: number; count: Big; summonerId: number | null; objective: boolean; groupId: number; /** population pack and idle state inherited by rare minions */ pack?: number; dormant?: boolean; /** minion scaling (boss reinforcements): unit health and damage multipliers */ hpMul?: string; dmgMul?: string }

export interface Reaction { kind: 'inferno'; slot: number; x: number; y: number; amount: Big; tick: number; generation: number }

export interface DeathRecap {
  slot: number;
  round: number;
  tick: number;
  attack: string;
  source: string;
  amountText: string;
  hpFracBefore: number;
  contributingFactors: string[];
  disconnected: boolean;
  final: boolean;              // dead (true) vs downed (false)
}

export type Command =
  | { type: 'ALLOCATE'; slot: number; nodeId: string }
  | { type: 'REFUND_ALL'; slot: number }
  | { type: 'MASTERY'; slot: number; choice: 'damage' | 'health' | 'recovery' }
  | { type: 'READY'; slot: number; ready: boolean }
  | { type: 'VOTE'; slot: number; offerId: string; seq: number; cardSlot: number | null; locked: boolean }
  | { type: 'RETIRE_VOTE'; slot: number; yes: boolean }
  | { type: 'CONNECT'; slot: number }
  | { type: 'DISCONNECT'; slot: number }
  | { type: 'DURABLE'; what: 'commit' | 'finalize' }
  | { type: 'INCIDENT'; reason: string }
  | { type: 'ABORT'; reason: string }
  /** Training grounds only (training.ts): op spawn (arg pack id, tier 0 ordinary / 1 champion / 2 rare), boss (arg boss id),
   *  clear, ai (arg 'on' | 'off'), cooldowns, heal, class (arg class id), level (arg foe level 1..99). */
  | { type: 'TRAIN'; slot: number; op: string; arg?: string; tier?: number }
  /** Fate's Blessing (blessing.ts): lift the price of card `cardSlot` of the current offer during VOTING. */
  | { type: 'BLESS'; slot: number; offerId: string; cardSlot: number }
  /** Room events (roomEvents.ts): activate shrine `id`, take pact `choice` of altar `id`, buy shelf row `choice` of merchant `id`. */
  | { type: 'EVENT'; slot: number; op: 'shrine' | 'altar' | 'buy'; id: number; choice?: number };

export type SimEvent =
  | { t: 'phase'; phase: Phase; round: number }
  | { t: 'hit'; target: number; targetKind: 'enemy' | 'player'; amount: string; crit: boolean; dtype: DamageType; x: number; y: number; count?: string; sx?: number; sy?: number; kill?: boolean; frac?: number; src?: number }
  | { t: 'heal'; slot: number; amount: string }
  | { t: 'shield'; slot: number; amount: string }
  | { t: 'death'; id: number; kind: string; x: number; y: number; by?: number }
  | { t: 'spawn'; id: number; kind: string; x: number; y: number }
  | { t: 'cast'; slot: number; skill: string; x: number; y: number; dx: number; dy: number; count?: string }
  | { t: 'enemy_attack'; id: number; attack: string; stage: 'windup' | 'release' }
  | { t: 'dodge'; slot: number }
  | { t: 'pickup'; id: number; kind: string; slot: number; x: number; y: number }
  | { t: 'elite'; id: number; fx: string; x: number; y: number; tx?: number; ty?: number; tier?: number }
  | { t: 'downed'; slot: number }
  | { t: 'revived'; slot: number; by: number | null }
  | { t: 'dead'; slot: number }
  | { t: 'teleport'; slot: number; fx: number; fy: number; x: number; y: number; /** presentation style: absent or 'rift' = Arcanist rings; others resolve SKILL_FX['teleport:<style>'] */ style?: string }
  | { t: 'boss_phase'; id: number; phase: number }
  /** a boss calls reinforcement wave `wave` (1 at 2/3 health, 2 at 1/3): `n` foes arrive in RULES.bossReinforceWarnSec at
   *  the summoning circles (telegraphs, attack 'reinforce') */
  | { t: 'boss_adds'; id: number; wave: number; n: number; x: number; y: number }
  | { t: 'stagger'; id: number }
  | { t: 'wave'; wave: number }
  | { t: 'objective'; groupId: number; weight: number; completed: number; total: number }
  | { t: 'domain'; type: string; payload: Record<string, unknown> }
  | { t: 'vote'; slot: number; cardSlot: number | null; locked: boolean; counts: number[] }
  /** The party committed to door i (doors.ts): front point, normal into the room, theme behind it, card it binds. */
  | { t: 'door_chosen'; i: number; x: number; y: number; nx: number; ny: number; th: string; c: string }
  /** ROUND_SETUP began (round-intro cutscene): the new floor's theme and whether it is a boss lair. */
  | { t: 'round_intro'; round: number; theme: string; boss: boolean }
  /** The boss spawned and the fight is held for its grand entrance until SimState.cinematicUntilTick. */
  | { t: 'boss_intro'; id: number; k: string; x: number; y: number }
  | { t: 'incident'; reason: string }
  | { t: 'loot'; id: number; itemId: string; x: number; y: number; src: 'enemy' | 'elite' | 'boss' | 'carry' }
  | { t: 'equip'; slot: number; gs: GearSlot; itemId: string; replaced?: string; x: number; y: number }
  | { t: 'perk'; slot: number; perk: string; x: number; y: number; tx?: number; ty?: number; r?: number }
  /** an affliction landed on a hero (afflictions.ts): s = status id ('chained', 'frozen', ...), sec = duration (0 = resisted by diminishing returns), 'chain_break' / 'thaw' when one ends early */
  | { t: 'afflict'; slot: number; s: string; sec: number; x: number; y: number; ax?: number; ay?: number }
  /** one-shot presentation cue for foe attacks (shadow burst, web splat, venom splash, hook hit, frost shatter) */
  | { t: 'foe_fx'; id: number; fx: string; x: number; y: number; tx?: number; ty?: number; r?: number }
  /** an idle pack noticed the heroes (director.ts activation) */
  | { t: 'aggro'; id: number; pack: number; x: number; y: number }
  /** a hero's summon / pet (hazard `id` of `kind`) lost its route and blinked from fx,fy back to x,y at its owner's
   *  side (follow.ts leash): the client dissolves it at the origin and reforms it at the destination */
  | { t: 'summon_blink'; slot: number; id: number; kind: string; fx: number; fy: number; x: number; y: number }
  /** Fate's Blessing (blessing.ts): a hero picked one up (id = ground item), or blessed card `card` of the current offer */
  | { t: 'blessing'; op: 'pickup' | 'apply'; slot: number; x: number; y: number; card?: number; id?: number }
  /** Training grounds (training.ts): a hero respawned in place ('respawn'), or used a tool (the TRAIN op) */
  | { t: 'training'; op: string; slot: number; x: number; y: number }
  /** Room events (roomEvents.ts): a hero used shrine / altar / merchant `id` (k = shrine type, pact id or ware id); the
   *  merchant or a treasure imp appeared (imp: id = enemy id); the imp started its portal, escaped, or burst into loot */
  | { t: 'room_event'; op: 'shrine' | 'altar' | 'buy' | 'merchant' | 'runner' | 'portal' | 'escape' | 'shower'; id: number; slot: number; x: number; y: number; k?: string }
  /** Named mini-bosses (minibosses.ts): 'spawn' (placed on the floor), 'awake' (the heroes found it: announcement),
   *  'slain' (pts = score burst text), and mechanic cues ('slam_warn', 'slam', 'summon', 'enrage', 'shield') */
  | { t: 'miniboss'; id: number; op: string; name: string; x: number; y: number; k?: string; pts?: string; r?: number };
