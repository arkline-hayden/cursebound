// Versioned tunable rules (PRD §3–§6, §11, §13, §19). Every constant here is a first proposal.
// Changing anything that affects simulation outcomes requires bumping RULES_VERSION (and replay version).

export const RULES_VERSION = 'rules-1.6.0'; // 1.1: door chain (offer themes + walk-through hold), dense populations, afflictions; 1.2: tiered map generation (room kinds, furnishing) + boss arenas; 1.3: no resource (cooldown-only skills, cooldowns x0.7), full starting kit, boss reinforcements at 2/3 and 1/3 health, bosses ~20% easier, smarter foes; 1.4: all movement x0.8 (heroes, foes, bosses, summons and pets), follower routing, daily bounty modifiers (optional negative modifier per run); 1.5: Fate's Blessing (legendary consumable lifts a card's price), training grounds rooms, three more dungeon themes in the rotation (sky island, moon, server room); 1.6: knockback (heavy hits, slams, blasts and crits shove ordinary foes, elites reduced, bosses immune; KNOCKBACK_RULES)
export const SCORE_VERSION = 'score-1.0.0';
export const CONTENT_VERSION = 'content-1.5.0'; // 1.1: room kinds, theme room weights, boss arena designs; 1.2: resource removed (skill costs, pools, resource stats and nodes reworked), cooldowns x0.7, base skills are starting grants, boss retune; 1.3: movement multipliers (hero 0.88, foe 0.8, minion 0.8), follower routing constants, bounty modifiers (bounties.ts) in the manifest; 1.4: Fate's Blessing consumable, training grounds theme, sky / moon / server themes (room weights, packs); 1.5: knockback rules (per damage type and per skill pushes, elite factors) in the manifest
export const SIM_VERSION = 'sim-1.5.0'; // 1.1: mapgen tiers (layout archetypes, typed rooms, furnishing, chasm voids, boss arenas); 1.2: cooldown-only casting, boss reinforcement waves, enemy AI (kiting, surrounds, focus, AoE dodge, retreat, spacing); 1.3: bosses take enemyMoveSpeedMult, minion speed multiplier, follower routing (A* path-follow, stuck detection, blink leash, spread), bounty modifiers applied at run creation (bounty.ts); 1.4: blessing in the legendary drop pool + BLESS command, training mode (courtyard map, TRAIN commands), ten-theme rotation, sky floors drop into open-air voids; 1.5: knockback slides (knock.ts: impact pushes from heavy hits, slams, blasts and crits, swept against walls and voids, stepped with the foe), elite-scaled authored knockback, killing damage type on death events
export const PROTOCOL_VERSION = 3;

export const TICK_RATE = 60;
export const TICK_SEC = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 20;

export const RULES = {
  maxPartySize: 5,
  bossEvery: 5,

  // Party scaling (§4.1): P_H(N) = 1 + 0.65(N-1), P_B(N) = 1 + 0.25(N-1)
  partyHealthCoef: '0.65',
  partyBudgetCoef: '0.25',

  // Baseline scaling (§11.1)
  enemyHealthGrowth: '1.18',
  enemyDamageGrowth: '1.12',
  budgetLinear: '0.08',
  // Diablo-style population (director.ts): wave 0 spreads packs through every room and corridor of the floor when
  // COMBAT starts; the remaining waves are small reinforcements arriving from the far side of the map (the next one
  // lands once half of the current wave has fallen, or after waveTriggerSec at the latest).
  baseBudget: 18,
  bossFactor: 8,
  /** Representative agent budget: logical quantity beyond this folds into cohort counts (D06). Not a cap on logical count. */
  maxRepresentativeAgents: 80,
  waveCount: 3,
  waveTriggerRemainingFrac: 0.5,
  waveTriggerSec: 45,
  /** Floor tiles per pack (pack count = floor area / this, × round growth × party factor, clamped). */
  packAreaPerPack: 72,
  packRoundGrowth: '0.06',
  packPartyCoef: '0.3',
  packMin: 5,
  packMax: 16,
  /** Units in a pack: base range at round 1, +1 every packGrowEvery rounds. */
  packUnits: [2, 3] as [number, number],
  packGrowEvery: 4,
  /** No pack is placed within this many tiles (path and straight-line) of the hero spawn. */
  packSafeRadius: 8,
  /** Reinforcement packs per wave after the population (wave ≥ 1); +1 every reinforcementGrowEvery rounds. */
  reinforcementPacks: 1,
  reinforcementGrowEvery: 4,
  /** Idle packs: heroes within aggroRadius (line of sight) or aggroHearing (any) wake the pack, which calls packs
   *  within aggroCallRadius. Dormant foes only run this check every aggroCheckTicks ticks. */
  aggroRadius: 8,
  aggroHearing: 4,
  aggroCallRadius: 5,
  aggroCheckTicks: 12,
  /** Difficulty ramp past round lateRampFrom: per-round compounding growth on top of the base growth. */
  lateRampFrom: 5,
  lateHealthGrowth: '1.05',
  lateDamageGrowth: '1.035',
  bossAddBudgetFrac: 0.25,
  /** Boss reinforcements (director.ts bossReinforcements): crossing each health threshold summons one wave of the
   *  floor theme's foes, once per threshold. Wave = base + perHero x (N-1) + perRounds step, folded into cohorts. */
  bossReinforceAt: [2 / 3, 1 / 3] as number[],
  bossReinforceBase: 2,
  bossReinforcePerHero: 1,
  bossReinforceRoundStep: 10,
  /** reinforcements are minions: numerous but individually weaker than the floor's packs */
  bossReinforceHealth: '0.6',
  bossReinforceDamage: '0.7',
  /** seconds the summoning telegraph (client banner, rune circles) runs before the wave arrives */
  bossReinforceWarnSec: 1.2,
  /** Global enemy ground-speed multiplier (applied at spawn to foes AND bosses, before Fate enemy.movementSpeed).
   *  0.8 since rules 1.4 (all movement x0.8). Charges are not scaled: they travel their telegraphed lane. */
  enemyMoveSpeedMult: 0.8,

  // Champions and rares (elites.ts). Elite intensity C = base × (1 + perRound × (r − 1)) × encounter.eliteChance;
  // the per-group chance is q = C / (1 + C) (doubling never exceeds 100%).
  eliteIntensityBase: '0.14',
  eliteIntensityPerRound: '0.12',
  eliteMinRound: 2,
  rareMinRound: 4,
  /** share of elite rolls that become rares once rares are unlocked */
  rareShare: 0.3,
  maxElitesPerWave: 3,
  championHealth: '3',
  rareHealth: '5.5',
  championDamage: '1.2',
  rareDamage: '1.35',
  championRadius: 1.18,
  rareRadius: 1.35,

  // Pickups (pickups.ts): potions heal, haste orbs cut the remaining cooldown of every skill. Collected by walking near (magnet), only by members
  // who need them, so a full-health hero leaves the potion for an ally.
  potionDropChance: 0.1,
  orbDropChance: 0.06,
  minionDropChance: 0.03,
  potionHealFrac: '0.25',
  potionHealFracElite: '0.35',
  potionAllyHealFrac: '0.08',
  potionAllyRange: 5,
  /** seconds a haste orb cuts from each recharging skill (x1.5 from champion / rare drops); allies nearby get the ally share */
  orbCooldownSec: 2,
  orbAllyCooldownSec: 0.75,
  pickupMagnetRange: 1.2,
  pickupTouchRange: 0.45,
  pickupMagnetSpeed: 7,
  pickupLifeSec: 25,
  maxPickups: 32,

  // Scoring (§13.1)
  scoreBasePerRound: 100,
  scoreBossAddend: 500,
  speedBonusMax: '0.25',
  referenceSecOrdinary: 80,
  referenceSecBoss: 135,

  // Death / revive (§6.1)
  downedSec: 15,
  reviveRange: 1.2,
  reviveChannelSec: 3,
  reviveHealthFrac: '0.25',
  downsPerRound: 1,
  soloSelfReviveBlock: 5,
  soloSelfReviveChannelSec: 5,
  clearReturnHealthFrac: '0.5',
  intermissionHealFrac: '0.25',

  // Progression (§6.2)
  startingSkillPoints: 1,
  pointsOrdinary: 1,
  pointsBoss: 2,
  masteryFactor: '1.05',

  // Movement & combat (§5)
  playerRadius: 0.3,
  /** Global hero ground-speed multiplier (derivePlayer moveSpeed); dodge distance is unaffected. 1.1 -> 0.88 in
   *  rules 1.4 (all movement x0.8). Client prediction reads the resulting speed from the snapshot (`spd`). */
  playerMoveSpeedMult: '0.88',
  /** Speed multiplier for hero-owned summons and pets (Warden beasts, Hexbinder wraiths and locusts, Ranger hawks) on
   *  top of their authored speeds. 0.8 since rules 1.4 (all movement x0.8). Attack lunges (wolf pounce, hawk dive) are
   *  strikes, not movement, and stay as authored. */
  minionMoveSpeedMult: 0.8,
  /** Follower routing (simulation follow.ts): summons that follow their owner path around walls and chasm voids, and
   *  blink back to the owner's side when the route fails, is far longer than the straight line, or progress stalls. */
  followRepathTicks: 20,
  followStuckTicks: 45,
  followMaxPathTiles: 48,
  followBlinkRange: 14,
  /** Light momentum (movementStep, shared with prediction): per-tick blend toward the wanted velocity. */
  moveAccelBlend: 0.55,
  moveDecelBlend: 0.4,
  armorK: '100',
  /** Rally (Vanguard Rally Cry, War Banner, Rallying Presence): skill cooldowns recover this many times as fast. */
  rallyRecovery: 1.35,
  /** Event Horizon (Arcanist): at most one pull field per this many seconds. */
  eventHorizonGapSec: 3,
  enemyBaseRegenFrac: '0.0005', // 0.05% max health per second, regen-tagged only (D14)
  crowdControlResistSec: 4,
  shieldDecayPerSec: '0.05',
  // Melee identity (classes flagged `melee` in content; simulation stats.ts and players.ts). Melee heroes fight inside
  // enemy reach, so they take more hits than kiting casters:
  //  - Close Quarters: incoming damage x meleeDamageTakenMult (folded into the derived incoming damage factor, so
  //    guard, shields and Forecast see the same number).
  //  - Lunge: a basic swing with no foe inside its reach steps up to meleeLungeDist toward the nearest foe inside the
  //    swing arc (within reach + meleeLungeDist), just far enough to connect. Deterministic, wall-safe.
  meleeDamageTakenMult: '0.85',
  meleeLungeDist: 0.6,

  // Voting & sessions (§3.3, §4.2, §4.3)
  voteWindowSec: 45,
  // Doors (simulation doors.ts): the Fate vote happens in the cleared map. Three themed doors stand in one stretch of
  // wall; a hero within doorVoteRadius of a door's front point votes for it. Solo: stand in a door for
  // doorSoloHoldSec; co-op: every living, connected hero in the same door for doorCoopHoldSec. FATE_COMMIT lasts at
  // least doorWalkSec (the walk-through) and still waits for the durable commit.
  doorWalkSec: 2.6,
  doorVoteRadius: 1.2,
  doorSoloHoldSec: 1.0,
  doorCoopHoldSec: 1.5,
  /** tiles between neighbouring doors of one threshold, and the preferred path distance from the party */
  doorSpacingMin: 3,
  doorSpacingMax: 6,
  doorPathMin: 6,
  doorPathMax: 14,
  reconnectHoldSec: 60,
  allDisconnectedSuspendSec: 60,
  clearSummarySec: 2.0,
  /** ROUND_SETUP length: the round-intro cutscene (heroes step out of the entry portal, title card). Heroes are frozen. */
  setupSec: 3.0,
  /** Boss grand entrance: the fight is held frozen this long after the boss spawns (SimState.cinematicUntilTick). */
  bossIntroSec: 4.0,
  inputStaleMs: 250,
  maxCatchupMs: 250,
};

export function isBossRound(r: number): boolean {
  return r > 0 && r % RULES.bossEvery === 0;
}

export function referenceSec(r: number): number {
  return isBossRound(r) ? RULES.referenceSecBoss : RULES.referenceSecOrdinary;
}

export function basePoints(r: number): bigint {
  return BigInt(RULES.scoreBasePerRound) * BigInt(r) + (isBossRound(r) ? BigInt(RULES.scoreBossAddend) : 0n);
}

/** Mastery choices once a tree is exhausted (§6.2). */
export const MASTERY_CHOICES = [
  { id: 'mastery_damage', name: 'Mastery: Skill damage', stat: 'player.skillDamage', factor: '1.05' },
  { id: 'mastery_health', name: 'Mastery: Maximum health', stat: 'player.maxHealth', factor: '1.05' },
  { id: 'mastery_recovery', name: 'Mastery: Cooldown recovery', stat: 'player.recoveryRate', factor: '1.05' },
] as const;

/**
 * Hero afflictions inflicted by enemies (simulation/src/afflictions.ts). Short durations, readable telegraphs and
 * counterplay: dodge i-frames avoid projectiles and bursts, a dash breaks a chain, and diminishing returns per status
 * family (a second control within drWindowSec lasts half as long, a third is ignored) prevent chain-control locks.
 */
export const AFFLICTION_RULES = {
  drWindowSec: 6,
  /** status families sharing diminishing returns (statuses not listed have none) */
  families: { frozen: 'immobilize', rooted: 'immobilize', chained: 'immobilize', blinded: 'blind', silenced: 'silence' } as Record<string, string>,
  chainSec: 2.5,
  chainRadius: 2.5,
  freezeStacks: 3,
  freezeStackWindowSec: 4,
  freezeSec: 1.0,
  freezeImmuneSec: 2,
  chillSlow: 0.3,
  chillSec: 2.5,
  poisonSec: 3,
  poisonTickSec: 0.5,
  /** healing received while poisoned (every heal path goes through combat.ts healPlayer) */
  poisonHealFactor: '0.5',
  blindSec: 2.5,
  /** world radius of a blinded hero's vision (presentation) */
  blindVision: 3.5,
  rootSec: 1.5,
  silenceSec: 2,
  slowCap: 0.6,
  /** lingering ground patches: Bile Toad venom puddles and Web Weaver webs */
  venomPuddleSec: 2.5,
  venomPuddleRadius: 1.1,
  webPatchSec: 3,
  webPatchRadius: 1.2,
  webSlow: 0.35,
};

/**
 * Knockback (simulation knock.ts, rules 1.6). Heavy hits, slams, explosions and crits shove ordinary foes a short way
 * from the hit's source as a brief slide: a per-tick velocity that decays by slideDecay each tick and is swept against
 * walls (chasm voids are wall tiles), so a foe never lands inside one. A hit pushes when it crits or is heavy:
 *  - heavy: its skill's damageCoef is at least heavyCoef (areaHeavyCoef for circle-shaped slams and blasts), or one hit
 *    takes heavyFrac of a unit's health and it survives;
 *  - distance: bySkill[skill] ?? byDamageType[type] ?? defaultPush, x critMult on a heavy crit; a crit that is not
 *    heavy pushes critOnlyFactor of that, and only from a skill of at least critMinCoef (procs and pets' nips do not);
 *  - channelled aura skills (whirlwinds, blizzards, swarms) never push unless listed in bySkill;
 *  - skills whose kits already knock back (SkillDef.knockback) keep their own push, and an authored knockback in the
 *    same tick supersedes the slide (no double shove);
 *  - champions and rares take eliteFactor[tier] of every knockback (authored ones too); bosses are immune.
 * The slide is a feel rule: it sets no control resistance and interrupts nothing (authored knockback still does).
 */
export const KNOCKBACK_RULES = {
  defaultPush: 0.3,
  /** frost barely moves what it hits (it freezes), blasts of fire and plain force shove hardest */
  byDamageType: { physical: 0.4, ember: 0.4, astral: 0.35, storm: 0.3, decay: 0.25, frost: 0.15 } as Record<string, number>,
  /** per-skill overrides: big explosions without an authored knockback push harder; controls that hold foes in place
   *  (snares, roots, lures, freezes) never push */
  bySkill: {
    c_comet: 0.45, c_effigy_burst: 0.35, t_judgment_day: 0.45, t_smite: 0.4, h_sanguine_lance: 0.4, h_hemorrhage: 0.3,
    c_absolute_zero: 0, c_cold_snap: 0, r_snare_trap: 0, r_bait: 0, w_entangle: 0,
  } as Record<string, number>,
  heavyCoef: 1.8,
  areaHeavyCoef: 1,
  heavyFrac: '0.5',
  critMult: 1.25,
  critOnlyFactor: 0.5,
  critMinCoef: 0.8,
  maxPush: 0.8,
  /** [ordinary, champion, rare] */
  eliteFactor: [1, 0.5, 0.35] as number[],
  slideDecay: 0.7,
  /** the slide stops below this per-tick step (world units) */
  minStep: 0.004,
};
