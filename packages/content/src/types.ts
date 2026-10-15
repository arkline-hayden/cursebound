// Content definitions (PRD §21.2). Content is data only: no executable expressions, every numeric
// factor is a decimal string validated at authoring time (validate.ts), never evaluated with eval.

export type DamageType = 'physical' | 'ember' | 'frost' | 'storm' | 'decay' | 'astral';
export const DAMAGE_TYPES: DamageType[] = ['physical', 'ember', 'frost', 'storm', 'decay', 'astral'];

export type StatScope = 'player' | 'enemy' | 'encounter' | 'score';

/** Stat representation (PRD §8.3). Determines how a multiplicative factor is interpreted. */
export type StatRepresentation =
  | 'quantity'        // damage, health, healing, shields: positive large number with zero state
  | 'rate'            // attack frequency, regeneration: logical rate with accumulated work
  | 'recovery'        // cooldown recovery rate: +100% recovery = half the cooldown
  | 'intensity'       // critical tendency: nonnegative intensity converted to probability q = C/(1+C)
  | 'armor'           // mitigation via K/(K+A)
  | 'velocity'        // movement / projectile speed: positive velocity with swept collision
  | 'count'           // projectile count / spawn quantity: logical weighted count
  | 'pressure';       // prospective score factor

export type LedgerGroup =
  | 'party_damage'
  | 'health_recovery'
  | 'enemy_health'
  | 'enemy_offense'
  | 'mobility_projectiles'
  | 'score_growth';

export interface StatDef {
  id: string;
  name: string;              // canonical stat name used verbatim in card copy
  scope: StatScope;
  representation: StatRepresentation;
  group: LedgerGroup;
  /** Downstream derived quantities (for the calculation graph / Forecast cascade view). */
  affects: string[];
  /** Short explanation of the semantics shown in Ledger detail. */
  semantics: string;
  /** Which game objects this stat applies to; shown as applicability in cards. */
  applicability: string;
  /** Stat can be offered on Fate Cards (vs. tree-only). */
  fateEligible: boolean;
}

export interface CardEffect {
  stat: string;
  percent: string;           // decimal string, e.g. '75', '-30', '1000'
}

export interface CardDef {
  id: string;
  version: number;
  name: string;
  family: string;
  /** Draw rarity (fate.ts weights 60/30/10 by rarity; every card stays possible). Omitted = 'common'. */
  rarity?: CardRarity;
  /** Stat gift: multiplies a Fate-eligible stat. A card needs a gift (positive and/or boon) and a price (negative and/or bane). */
  positive?: CardEffect;
  /** Stat price. */
  negative?: CardEffect;
  /** Mechanic gift (mechanics.ts, kind 'boon'): a new rule implemented by simulation/src/boons.ts. */
  boon?: MechanicEffect;
  /** Mechanic price (mechanics.ts, kind 'bane'). */
  bane?: MechanicEffect;
  /** Mechanic tags used for applicability display (e.g. 'decay', 'regen-tagged'). */
  applicability: string[];
  icon: string;
  flavor: string;
}

// ---------------- Fate mechanics (boons and banes) ----------------

export type CardRarity = 'common' | 'rare' | 'mythic';

export type MechanicKind = 'boon' | 'bane';

/**
 * How extra copies of a mechanic combine. Every rule is a product of per-copy factors (never additive collapse):
 * - 'compound': magnitude m is a fraction (0.25 = 25%); effective = Π(1 + mᵢ) − 1 (25% then 56.25%).
 * - 'chance':   magnitude m is a probability/threshold in (0, 1); effective = 1 − Π(1 − mᵢ) (never reaches 100%).
 * - 'factor':   magnitude m is a multiplier (3 = ×3); effective = Π mᵢ (×3 then ×9).
 */
export type MechanicStacking = 'compound' | 'chance' | 'factor';

export interface MechanicEffect {
  id: string;
  magnitude: string;           // decimal string, validated at authoring time
}

export interface MechanicDef {
  id: string;
  /** Keyword name shown on chips and in the Ledger. */
  name: string;
  kind: MechanicKind;
  stacking: MechanicStacking;
  /** Display unit of the effective magnitude: 'percent' (25%) or 'multiplier' (×3). */
  unit: 'percent' | 'multiplier';
  /** One-line keyword explanation (≤ 48 chars after substitution); `{v}` = effective magnitude. */
  short: string;
  /** Full rules text for the Forecast and Ledger; `{v}` = effective magnitude. */
  description: string;
  /** What the mechanic touches (shown as applicability). */
  applicability: string;
  /** Party requirement for the gift to do anything (Forecast applicability): 'projectile' | 'skills' | 'any'. */
  requires: 'any' | 'projectile' | 'skills';
  /** Fixed tunables read by the simulation (radius, seconds, hit counts); `{name}` placeholders in the copy. */
  params: Record<string, number>;
  /** Chip accent colour (#rrggbb). */
  color: string;
  icon: string;
}

export type SkillSlot = 'basic' | 'active' | 'signature' | 'dodge';

export type HitShape =
  | { kind: 'projectile'; speed: number; radius: number; range: number; pierce: number; spreadDeg: number }
  | { kind: 'arc'; range: number; arcDeg: number }
  | { kind: 'circle'; radius: number; selfCentered: boolean; range: number }
  | { kind: 'line'; length: number; width: number; duration: number; tickInterval: number }
  | { kind: 'chain'; range: number; jumpRange: number; jumps: number }
  | { kind: 'teleport'; range: number }
  | { kind: 'guard'; duration: number; arcDeg: number }
  | { kind: 'aura'; radius: number; duration: number };

export interface SkillDef {
  id: string;
  classId: string;
  name: string;
  slot: SkillSlot;
  damageType: DamageType;
  /** Multiplier on the class base damage. 0 for non-damaging skills. */
  damageCoef: string;
  /** Seconds between casts (scaled by recovery rate). Skills are purely cooldown-gated: there is no resource. */
  cooldownSec: number;
  charges: number;
  shape: HitShape;
  /** Burn/bleed application as fraction of direct hit damage per second, duration seconds. */
  dot?: { type: DamageType; fractionPerSec: string; durationSec: number };
  knockback?: number;
  description: string;
  /** Effect is supported by the extreme compressor (grouped attack packets). Release decks require true. */
  compressionSupport: boolean;
  icon: string;
}

export interface NodeModifier {
  stat: string;              // player stat or skill-scoped stat (e.g. 'skill.v_sweeping_strike.damage')
  factorPerRank: string;     // each rank applies an independent ×factor (PRD §7.2)
}

export interface NodeDef {
  id: string;
  classId: string;
  branch: string;
  name: string;
  rankLimit: number;
  costPerRank: number;
  tier: 0 | 1 | 2 | 3 | 4;   // requires BRANCH_TIER_POINTS[tier] points spent in the branch
  prereqs: { node: string; rank: number }[];
  /** Choice nodes: owning any rank of this node locks every node listed here (always declared symmetrically). */
  excludes?: string[];
  modifiers: NodeModifier[];
  grantsSkill?: string;
  /**
   * Display tag for "upgrade" nodes: the skill (granted elsewhere, or the class basic/signature) this node modifies.
   * Presentation only (the tree marks the socket and names the skill); the effect itself lives in modifiers/mechanics.
   * The description must start with "Upgrades <skill name>:" (validate.ts).
   */
  upgrades?: string;
  starting?: boolean;        // free starting grant (Spark)
  mechanics: string[];       // mechanic tags implemented by the simulation
  description: string;       // template; {rank} {value} placeholders. One sentence, ≤ ~90 chars (content.test.ts)
  icon: string;
}

export interface ClassDef {
  id: string;
  name: string;
  tagline: string;
  /** UI accent colour (hex) and a one-line role summary for class pickers. */
  accent: string;
  role: string;
  branches: { id: string; name: string; theme: string }[];
  base: {
    maxHealth: number;
    armor: number;
    damage: number;          // base damage per basic hit
    attackFrequency: number; // basic attacks per second
    moveSpeed: number;       // world units per second
    critTendency: string;    // C
    critMultiplier: string;  // total crit multiplier
    shieldCapacity: number;  // fraction of max health a shield can hold (×Fate)
  };
  basicSkill: string;
  signatureSkill: string;
  nodes: string[];
  /**
   * Melee archetype (the basic attack is an arc swing fought inside enemy reach). Melee classes get Close Quarters
   * (incoming damage x RULES.meleeDamageTakenMult) and the basic-attack lunge (RULES.meleeLungeDist).
   */
  melee?: boolean;
}

export type TelegraphShape =
  | { kind: 'circle'; radius: number }
  | { kind: 'cone'; range: number; arcDeg: number }
  | { kind: 'line'; length: number; width: number }
  | { kind: 'ring'; inner: number; outer: number };

/**
 * Player afflictions an enemy attack can inflict (simulation/src/afflictions.ts). 'chill' adds a chill stack (three
 * within a few seconds freeze); the others are statuses shown in SnapPlayer.buffs under the same id.
 */
export type AfflictionId = 'chained' | 'chill' | 'frozen' | 'poisoned' | 'blinded' | 'rooted' | 'silenced' | 'slowed';

export interface EnemyAttackDef {
  id: string;
  name: string;
  /** 'burst' = a telegraphed circle at the target point that detonates on release (no lingering hazard).
   *  'scripted' = resolved by its boss's own script (simulation bosses/*), not by the generic attack kinds. */
  kind: 'melee' | 'projectile' | 'lob' | 'pool' | 'summon' | 'shield' | 'charge' | 'ring' | 'rootwall' | 'lightpool' | 'sweep' | 'slam' | 'burst' | 'scripted';
  /** Affliction applied to heroes this attack hits: seconds, optional magnitude (slow fraction / chain radius). */
  inflict?: { status: AfflictionId; sec: number; value?: number };
  /** Projectile / lob presentation kind (snapshot `k`); defaults to 'shard' / 'orb' / 'lob'. */
  projectileKind?: string;
  damageType: DamageType;
  damageCoef: string;        // × archetype damage
  windupSec: number;
  releaseSec: number;
  recoverySec: number;
  cooldownSec: number;
  range: number;
  telegraph: TelegraphShape;
  projectileSpeed?: number;
  projectileCount?: number;
  duration?: number;         // for pools/fields
  summonCount?: number;
}

export interface EnemyDef {
  id: string;
  name: string;
  role: 'pursuer' | 'skirmisher' | 'artillery' | 'guardian' | 'hexer' | 'broodcaller' | 'summon' | 'jailer' | 'wraith' | 'shade' | 'weaver';
  description: string;
  baseHealth: number;
  baseDamage: number;
  armor: number;
  cost: number;
  radius: number;
  moveSpeed: number;
  tags: string[];            // 'regen' | 'objective' | 'summon' | 'flying'
  perception: { sight: number; hearing: number; reactionTicks: number };
  preferredRange: [number, number];
  utility: Record<string, number>;
  attacks: EnemyAttackDef[];
  weaknesses: Partial<Record<DamageType, string>>;
}

export interface BossPhaseDef {
  /** Phase begins when health fraction is at or below this value. */
  healthFrac: number;
  weight: number;            // partial credit objective weight of finishing this phase
  patterns: string[][];      // ordered pattern modules (attack id sequences)
  cadence: string;           // multiplier on pattern recovery time for this phase
}

export interface BossDef {
  id: string;
  name: string;
  title: string;
  description: string;
  refUnitHealth: number;
  bossFactor: number;
  baseDamage: number;
  armor: number;
  radius: number;
  moveSpeed: number;
  tags: string[];
  phases: BossPhaseDef[];
  attacks: EnemyAttackDef[];
  /** Fraction of damage taken in stagger state multiplier (vulnerable core). */
  vulnerableMultiplier: string;
  staggerMeter: number;      // control converts to stagger
  /** Signature legendary (content LEGENDARIES id) its kill drops while nobody wears it; otherwise a random one. */
  loot?: string;
  /** Script tunables (seconds, world units, counts, fractions) read by a scripted boss (simulation bosses/*). */
  params?: Record<string, number>;
}

export interface BiomeDef {
  id: string;
  name: string;
  description: string;
  archetypes: string[];
  bosses: string[];
  hazards: string[];
}
