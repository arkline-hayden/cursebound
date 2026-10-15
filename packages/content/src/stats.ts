import type { StatDef } from './types';

// Canonical stat definitions (PRD §8.3, §10.1, §21.2). Card copy MUST use `name` verbatim.
// `affects` edges form the directed acyclic calculation graph used by Forecast cascades (§10.3).
export const STATS: StatDef[] = [
  // ---- Player ----
  { id: 'player.damage', name: 'Player damage', scope: 'player', representation: 'quantity', group: 'party_damage',
    affects: ['derived.hitDamage'], semantics: 'Multiplies every direct and over-time damage the party deals.', applicability: 'All player damage', fateEligible: true },
  { id: 'player.maxHealth', name: 'Player maximum health', scope: 'player', representation: 'quantity', group: 'health_recovery',
    affects: ['derived.survivalHits', 'derived.healAmount', 'derived.shieldCap'], semantics: 'Current health fraction is preserved when maximum health changes at Fate commit (D07).', applicability: 'Every party member', fateEligible: true },
  { id: 'player.attackFrequency', name: 'Player attack frequency', scope: 'player', representation: 'rate', group: 'party_damage',
    affects: ['derived.rawDps'], semantics: 'Basic attacks per second. Accumulates logical attack work; extreme rates fire grouped attack packets (no minimum cooldown).', applicability: 'Basic attacks', fateEligible: true },
  { id: 'player.healing', name: 'Player healing', scope: 'player', representation: 'quantity', group: 'health_recovery',
    affects: ['derived.healAmount'], semantics: 'Multiplies all healing received. Healing never exceeds maximum health.', applicability: 'Heals from skills, nodes, revives and intermission', fateEligible: true },
  { id: 'player.critTendency', name: 'Critical tendency', scope: 'player', representation: 'intensity', group: 'party_damage',
    affects: ['derived.critChance', 'derived.expectedHit'], semantics: 'Critical intensity C; chance q = C/(1+C). Doubling C never exceeds 100% chance.', applicability: 'All player hits', fateEligible: true },
  { id: 'player.critPotency', name: 'Critical damage potency', scope: 'player', representation: 'quantity', group: 'party_damage',
    affects: ['derived.expectedHit'], semantics: 'Multiplies the total critical multiplier (Appendix A2: x2 total becomes x6 with +200%).', applicability: 'Critical hits only', fateEligible: true },
  { id: 'player.recoveryRate', name: 'Player recovery rate', scope: 'player', representation: 'recovery', group: 'party_damage',
    affects: ['derived.cooldown'], semantics: 'Cooldown recovery speed. +100% recovery halves cooldowns. Skills are purely cooldown-gated (no resource).', applicability: 'Active and signature skill cooldowns, dodge', fateEligible: true },
  { id: 'player.projectileCount', name: 'Player projectile count', scope: 'player', representation: 'count', group: 'mobility_projectiles',
    affects: ['derived.rawDps'], semantics: 'Logical projectile multiplicity per shot. Rendering shows representative projectiles; each carries its logical weight.', applicability: 'Projectile skills (Spark, Sundering path wave)', fateEligible: true },
  { id: 'player.decayDamage', name: 'Player decay damage', scope: 'player', representation: 'quantity', group: 'party_damage',
    affects: ['derived.hitDamage'], semantics: 'Multiplies decay-type damage only.', applicability: 'Decay damage sources (none in the MVP classes)', fateEligible: true },
  { id: 'player.movementSpeed', name: 'Player movement speed', scope: 'player', representation: 'velocity', group: 'mobility_projectiles',
    affects: ['derived.moveSpeed'], semantics: 'Ground speed. Large values use swept collision and can overshoot.', applicability: 'Walking and dodge distance', fateEligible: true },
  { id: 'player.shieldCapacity', name: 'Player shield capacity', scope: 'player', representation: 'quantity', group: 'health_recovery',
    affects: ['derived.shieldCap'], semantics: 'Multiplies shield generation and the shield cap.', applicability: 'Shields from Guard, Static shell, Standard bearer', fateEligible: true },
  { id: 'player.armor', name: 'Player armor', scope: 'player', representation: 'armor', group: 'health_recovery',
    affects: ['derived.incomingFactor'], semantics: 'Armor A reduces incoming damage by factor K/(K+A). Doubling armor never grants immunity.', applicability: 'All incoming damage', fateEligible: true },
  // Tree-only player stats
  { id: 'player.physicalDamage', name: 'Player physical damage', scope: 'player', representation: 'quantity', group: 'party_damage',
    affects: ['derived.hitDamage'], semantics: 'Multiplies physical damage.', applicability: 'Physical damage', fateEligible: false },
  { id: 'player.emberDamage', name: 'Player ember damage', scope: 'player', representation: 'quantity', group: 'party_damage',
    affects: ['derived.hitDamage'], semantics: 'Multiplies ember damage.', applicability: 'Ember damage', fateEligible: false },
  { id: 'player.stormDamage', name: 'Player storm damage', scope: 'player', representation: 'quantity', group: 'party_damage',
    affects: ['derived.hitDamage'], semantics: 'Multiplies storm damage.', applicability: 'Storm damage', fateEligible: false },
  { id: 'player.astralDamage', name: 'Player astral damage', scope: 'player', representation: 'quantity', group: 'party_damage',
    affects: ['derived.hitDamage'], semantics: 'Multiplies astral damage.', applicability: 'Astral damage', fateEligible: false },
  { id: 'player.frostDamage', name: 'Player frost damage', scope: 'player', representation: 'quantity', group: 'party_damage',
    affects: ['derived.hitDamage'], semantics: 'Multiplies frost damage (including Frostbite).', applicability: 'Frost damage (Cryomancer)', fateEligible: false },
  { id: 'player.burnRate', name: 'Player burn rate', scope: 'player', representation: 'rate', group: 'party_damage',
    affects: ['derived.hitDamage'], semantics: 'Multiplies burn damage per second.', applicability: 'Burns', fateEligible: false },
  { id: 'player.reviveSpeed', name: 'Player revive speed', scope: 'player', representation: 'rate', group: 'health_recovery',
    affects: [], semantics: 'Revive channel speed.', applicability: 'Reviving allies', fateEligible: false },
  { id: 'player.guardHeal', name: 'Guard healing', scope: 'player', representation: 'quantity', group: 'health_recovery',
    affects: ['derived.healAmount'], semantics: 'Healing after a completed guard.', applicability: 'Guard stance', fateEligible: false },
  { id: 'player.dodgeHeal', name: 'Dodge healing', scope: 'player', representation: 'quantity', group: 'health_recovery',
    affects: ['derived.healAmount'], semantics: 'Self healing after dodging.', applicability: 'Second wind', fateEligible: false },
  { id: 'player.bleedDamage', name: 'Bleed damage', scope: 'player', representation: 'quantity', group: 'party_damage',
    affects: ['derived.hitDamage'], semantics: 'Multiplies the per-second damage of bleeds you apply (Duelist).', applicability: 'Bleeds', fateEligible: false },
  { id: 'player.skillDamage', name: 'Player skill damage', scope: 'player', representation: 'quantity', group: 'party_damage',
    affects: ['derived.hitDamage'], semantics: 'Mastery: multiplies all skill damage.', applicability: 'All damage', fateEligible: false },
  // Warden (tree-only, base 1)
  { id: 'player.beastDamage', name: 'Spirit beast damage', scope: 'player', representation: 'quantity', group: 'party_damage',
    affects: ['derived.hitDamage'], semantics: 'Multiplies damage dealt by Warden spirit beasts (wolves, the Ursa, the Wild Hunt) and the Feral Shift maul.', applicability: 'Warden spirit beasts', fateEligible: false },
  { id: 'player.thornsDamage', name: 'Thorns damage', scope: 'player', representation: 'quantity', group: 'party_damage',
    affects: ['derived.hitDamage'], semantics: 'Multiplies Warden thorn damage: Thorn Armor lashes, Thornburst and its evolutions, Bramble Wall, Ironthorn Pod and thorn shards.', applicability: 'Warden thorns', fateEligible: false },
  { id: 'player.rootDuration', name: 'Root duration', scope: 'player', representation: 'quantity', group: 'party_damage',
    affects: [], semantics: 'Multiplies how long Warden roots hold enemies in place.', applicability: 'Warden roots', fateEligible: false },
  { id: 'player.natureHealing', name: 'Grove healing', scope: 'player', representation: 'quantity', group: 'health_recovery',
    affects: ['derived.healAmount'], semantics: 'Multiplies healing from Warden Grove effects (Verdant Totem, Barkskin, Heart of the Forest root patches).', applicability: 'Warden Grove healing', fateEligible: false },
  // Templar / Berserker (tree-only, base 1)
  { id: 'player.holyHealing', name: 'Holy healing', scope: 'player', representation: 'quantity', group: 'health_recovery',
    affects: ['derived.healAmount', 'derived.shieldCap'], semantics: 'Multiplies the healing and shields a Templar grants (consecrated ground, Dawnbreak, Beacon, Vows, Guardian\'s Path).', applicability: 'Templar healing and shields', fateEligible: false },

  // ---- Enemy ----
  { id: 'enemy.maxHealth', name: 'Enemy maximum health', scope: 'enemy', representation: 'quantity', group: 'enemy_health',
    affects: ['derived.enemyHealth', 'derived.enemyRegen'], semantics: 'Multiplies every enemy and boss maximum health.', applicability: 'All enemies and bosses', fateEligible: true },
  { id: 'enemy.damage', name: 'Enemy damage', scope: 'enemy', representation: 'quantity', group: 'enemy_offense',
    affects: ['derived.incomingHit'], semantics: 'Multiplies all enemy damage including hazards.', applicability: 'All enemy damage', fateEligible: true },
  { id: 'enemy.attackDamage', name: 'Enemy attack damage', scope: 'enemy', representation: 'quantity', group: 'enemy_offense',
    affects: ['derived.incomingHit'], semantics: 'Multiplies direct enemy attacks (melee, projectiles, boss strikes); not lingering hazards.', applicability: 'Direct enemy attacks', fateEligible: true },
  { id: 'enemy.movementSpeed', name: 'Enemy movement speed', scope: 'enemy', representation: 'velocity', group: 'enemy_offense',
    affects: ['derived.enemyPressure'], semantics: 'Applies literally, including charges. No hidden speed limit.', applicability: 'All enemy movement', fateEligible: true },
  { id: 'enemy.attackFrequency', name: 'Enemy attack frequency', scope: 'enemy', representation: 'rate', group: 'enemy_offense',
    affects: ['derived.incomingDps', 'derived.telegraph'], semantics: 'Scales windup, recovery and idle cadence. Telegraph windows shrink literally; no minimum windup.', applicability: 'All enemy attacks', fateEligible: true },
  { id: 'enemy.projectileCount', name: 'Enemy projectile count', scope: 'enemy', representation: 'count', group: 'enemy_offense',
    affects: ['derived.incomingDps'], semantics: 'Logical projectile multiplicity per enemy shot.', applicability: 'Gloom Bat, Bile Toad and Hex Cultist projectiles', fateEligible: true },
  { id: 'enemy.projectileSpeed', name: 'Enemy projectile speed', scope: 'enemy', representation: 'velocity', group: 'enemy_offense',
    affects: ['derived.reactionWindow'], semantics: 'Enemy projectile velocity. Very high speeds become effectively instant.', applicability: 'Enemy projectiles', fateEligible: true },
  { id: 'enemy.regeneration', name: 'Enemy regeneration rate', scope: 'enemy', representation: 'rate', group: 'enemy_health',
    affects: ['derived.enemyRegen'], semantics: 'Regeneration of regeneration-tagged enemies (base 0.05% max health per second). Untagged enemies stay at zero.', applicability: 'Regeneration-tagged enemies: Bonewarden, Brood Sac, The Bell Golem', fateEligible: true },
  { id: 'enemy.armor', name: 'Enemy armor', scope: 'enemy', representation: 'armor', group: 'enemy_health',
    affects: ['derived.enemyMitigation'], semantics: 'Enemy armor A; damage taken factor K/(K+A).', applicability: 'All enemies and bosses', fateEligible: true },

  // ---- Encounter & score ----
  { id: 'encounter.spawnQuantity', name: 'Encounter spawn quantity', scope: 'encounter', representation: 'count', group: 'enemy_health',
    affects: ['derived.enemyCount', 'derived.incomingDps'], semantics: 'Multiplies the logical count of every spawn cohort (D06 cohort model): each spawned enemy is a co-located cohort carrying a logical count. Health, deaths and attacks represent that multiplicity.', applicability: 'Ordinary encounter spawns and boss adds', fateEligible: true },
  { id: 'encounter.eliteChance', name: 'Elite pack chance', scope: 'encounter', representation: 'intensity', group: 'enemy_offense',
    affects: ['derived.eliteChance'], semantics: 'Elite intensity C (base grows with round); each spawned group becomes a champion or rare with chance q = C/(1+C). Doubling C never exceeds 100% chance.', applicability: 'Ordinary encounter waves from round 2', fateEligible: true },
  { id: 'score.pressure', name: 'Prospective score pressure', scope: 'score', representation: 'pressure', group: 'score_growth',
    affects: ['derived.roundPoints'], semantics: 'Multiplies points of rounds that start after the choice. Banked score is never repriced.', applicability: 'Future round scores', fateEligible: true },
];

export const STAT_BY_ID: Record<string, StatDef> = Object.fromEntries(STATS.map((s) => [s.id, s]));

export function isKnownStat(id: string): boolean {
  if (STAT_BY_ID[id]) return true;
  // skill-scoped stats: skill.<skillId>.<damage|cooldown|radius>
  return /^skill\.[a-z0-9_]+\.(damage|cooldown|radius)$/.test(id);
}

export const DERIVED_NODES: Record<string, { name: string; affects: string[] }> = {
  'derived.hitDamage': { name: 'Damage per hit', affects: ['derived.expectedHit'] },
  'derived.critChance': { name: 'Critical chance', affects: ['derived.expectedHit'] },
  'derived.expectedHit': { name: 'Expected hit', affects: ['derived.rawDps'] },
  'derived.rawDps': { name: 'Raw DPS', affects: ['derived.netDps'] },
  'derived.cooldown': { name: 'Skill cooldowns', affects: ['derived.rawDps'] },
  'derived.enemyHealth': { name: 'Enemy health', affects: ['derived.killTime', 'derived.enemyRegen'] },
  'derived.enemyRegen': { name: 'Enemy regeneration per second', affects: ['derived.netDps'] },
  'derived.enemyMitigation': { name: 'Enemy damage taken factor', affects: ['derived.netDps'] },
  'derived.netDps': { name: 'Net damage requirement', affects: ['derived.killTime'] },
  'derived.killTime': { name: 'Idealized kill time', affects: [] },
  'derived.incomingHit': { name: 'Representative incoming hit', affects: ['derived.survivalHits', 'derived.incomingDps'] },
  'derived.incomingFactor': { name: 'Incoming damage factor', affects: ['derived.incomingHit'] },
  'derived.incomingDps': { name: 'Incoming DPS', affects: ['derived.survivalTime'] },
  'derived.survivalHits': { name: 'Hits to down', affects: [] },
  'derived.survivalTime': { name: 'Survival without healing', affects: [] },
  'derived.healAmount': { name: 'Healing amount', affects: [] },
  'derived.shieldCap': { name: 'Shield capacity', affects: [] },
  'derived.moveSpeed': { name: 'Movement speed', affects: [] },
  'derived.enemyPressure': { name: 'Enemy closing speed', affects: [] },
  'derived.telegraph': { name: 'Telegraph window', affects: ['derived.reactionWindow'] },
  'derived.reactionWindow': { name: 'Reaction window', affects: [] },
  'derived.enemyCount': { name: 'Logical enemy count', affects: ['derived.incomingDps', 'derived.killTime'] },
  'derived.eliteChance': { name: 'Elite pack chance', affects: ['derived.incomingDps', 'derived.killTime'] },
  'derived.roundPoints': { name: 'Next round points', affects: [] },
};
