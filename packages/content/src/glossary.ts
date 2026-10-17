import { CLASSES, CLASS_BY_ID, DODGE, NODES, SKILLS, SKILL_BY_ID } from './classes';
import { BOSSES, ENEMIES } from './enemies';
import { KNOCKBACK_RULES, RULES } from './rules';
import type { DamageType } from './types';

// Skill-tree glossary: one plain-language definition per game term the skill and node copy uses (statuses, damage
// types, combat rules and class mechanics), with one name per concept across all classes. The skill tree underlines
// these terms in node copy and shows the definition on hover / focus (client ui/Keywords.tsx, the same pixel tooltip
// as the Fate keyword chips). content.test.ts keeps the copy and the glossary in step: every jargon word in the copy
// must resolve to an entry here, and every entry must be used.
//
// Numbers come from the rules and content tables where they live (RULES, DODGE, class bases, bosses, enemies);
// simulation-only constants are quoted with their source file, and simulation/test/glossary.test.ts checks the ones
// the simulation exports. Presentation only: not part of the content manifest or its hash.

export type GlossaryKind = 'damage' | 'status' | 'rule' | 'class';

export interface GlossaryTerm {
  id: string;
  /** Display name on the tooltip. */
  name: string;
  kind: GlossaryKind;
  /** Words in skill copy that mean this term (whole words; the first letter matches either case). */
  forms: string[];
  /** Plain-language definition with the live numbers (at most ~190 characters). */
  text: string;
  /** Class mechanics: only these classes' copy uses this meaning. */
  classes?: string[];
  /** Classes whose copy uses the same word for something else (Cryomancer "storms" are blizzards). */
  notClasses?: string[];
  /** Chip accent (#rrggbb). */
  color: string;
}

const pct = (v: number | string) => `${Math.round(Number(v) * 1000) / 10}%`;
const range = (vals: number[], fmt: (v: number) => string) => {
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return lo === hi ? fmt(lo) : `${fmt(lo)} to ${fmt(hi)}`;
};
const mult = (v: number) => `×${Math.round(v * 100) / 100}`;

/** Strongest enemy weakness to a damage type (EnemyDef.weaknesses), for the damage-type entries. */
function weakest(t: DamageType): string {
  const vals = ENEMIES.map((e) => Number(e.weaknesses[t] ?? 1)).filter((v) => v > 1);
  return vals.length ? ` Some enemies take up to ${mult(Math.max(...vals))} from it.` : '';
}

/** The value most classes share (class bases), so the copy can name the exceptions. */
function mode(vals: number[]): number {
  const count = (v: number) => vals.filter((x) => x === v).length;
  return vals.reduce((best, v) => (count(v) > count(best) ? v : best), vals[0]!);
}
const commonCap = mode(CLASSES.map((c) => c.base.shieldCapacity));
const capOutliers = CLASSES.filter((c) => c.base.shieldCapacity !== commonCap).map((c) => `${c.name} ${pct(c.base.shieldCapacity)}`).join(', ');
const critMults = CLASSES.map((c) => Number(c.base.critMultiplier));
const commonCrit = mode(critMults);
const critOutliers = CLASSES.filter((c) => Number(c.base.critMultiplier) !== commonCrit).map((c) => `${c.name} ×${c.base.critMultiplier}`).join(', ');
const commonTendency = mode(CLASSES.map((c) => Number(c.base.critTendency)));
const chance = (c: number) => pct(c / (1 + c));
const bossVuln = range(BOSSES.map((b) => Number(b.vulnerableMultiplier)), mult);
const knockResist = 0.3;   // simulation players.ts / classes/tbkit.ts shove(): a push inside the control window travels x0.3
const fangs = SKILL_BY_ID.d_twin_fangs;

// Damage types
const C_PHYS = '#e3d3b8', C_EMBER = '#ff9a48', C_FROST = '#8fdcff', C_STORM = '#86b8ff', C_ASTRAL = '#cfaaff', C_DECAY = '#a8dc6e';
// Statuses: control, damage over time (coloured by type) and debuffs
const C_CONTROL = '#ffd66b', C_BLEED = '#ff6a5e', C_DEBUFF = '#ff7f9c';
// Rules and class mechanics
const C_RULE = '#efe2b6', C_CLASS = '#ffbf5e';

const TERMS: GlossaryTerm[] = [
  // ---------------- damage types ----------------
  { id: 'physical', name: 'Physical', kind: 'damage', forms: ['physical'], color: C_PHYS,
    text: `Damage type of blades, arrows, claws and blunt force.${weakest('physical')}` },
  { id: 'ember', name: 'Ember', kind: 'damage', forms: ['ember'], color: C_EMBER,
    text: `Fire damage type; ember hits often leave the enemy burning.${weakest('ember')}` },
  { id: 'frost', name: 'Frost', kind: 'damage', forms: ['frost'], color: C_FROST,
    text: `Ice damage type; frost skills Chill and Freeze.${weakest('frost')}` },
  { id: 'storm', name: 'Storm', kind: 'damage', forms: ['storm'], notClasses: ['cryomancer'], color: C_STORM,
    text: `Lightning damage type; storm skills often chain between enemies.${weakest('storm')}` },
  { id: 'astral', name: 'Astral', kind: 'damage', forms: ['astral'], color: C_ASTRAL,
    text: `Starlight and holy-light damage type.${weakest('astral')}` },
  { id: 'decay', name: 'Decay', kind: 'damage', forms: ['decay'], color: C_DECAY,
    text: `Rot, venom, poison and blood-magic damage type.${weakest('decay')}` },

  // ---------------- damage over time ----------------
  { id: 'burn', name: 'Burn', kind: 'status', forms: ['burn', 'burns', 'burning'], color: C_EMBER,
    text: 'Ember damage over time: each second the enemy takes a share of the hit that set it burning, usually for 3s. New burns add on top; burn damage raises them.' },
  { id: 'bleed', name: 'Bleed', kind: 'status', forms: ['bleed', 'bleeds', 'bleeding'], color: C_BLEED,
    text: 'Physical damage over time: a share of the hit each second for a few seconds. New bleeds add on top. Bonuses against bleeding enemies count only your own bleeds.' },
  { id: 'rot', name: 'Rot', kind: 'status', forms: ['rot', 'rotting'], classes: ['hexbinder'], color: C_DECAY,
    text: 'Hexbinder decay damage over time: a share of the hit each second, usually for 3 to 4s. New rot adds on top as another rot stack.' },
  { id: 'rot_stack', name: 'Rot stack', kind: 'status', forms: ['rot stack', 'rot stacks'], classes: ['hexbinder'], color: C_DECAY,
    text: 'Each separate rot you apply to an enemy counts as one stack while it lasts (hits landing within the same 0.25s count once).' },
  { id: 'venom', name: 'Venom', kind: 'status', forms: ['Venom', 'Venomed'], classes: ['warden'], color: C_DECAY,
    text: 'Warden decay damage over time: 25% of the hit each second for 4s from thorn novas, brambles and barbs. New Venom adds on top.' },
  { id: 'poison', name: 'Poison', kind: 'status', forms: ['poison', 'poisons', 'poisoned'], classes: ['ranger'], color: C_DECAY,
    text: 'Ranger decay damage over time: a share of the hit each second for 4s (20% from Poison Tips, 15% from Plague Bearer). Decay damage raises it.' },
  { id: 'frostbite', name: 'Frostbite', kind: 'status', forms: ['Frostbite'], classes: ['cryomancer'], color: C_FROST,
    text: 'Frost damage over time from the Frostbite node: chilling hits add 12% of their damage per second for 3s.' },

  // ---------------- control ----------------
  { id: 'chill', name: 'Chill', kind: 'status', forms: ['chill', 'chills', 'chilled', 'chilling'], color: C_FROST,
    text: 'Slows an enemy\'s movement and attacks by the % shown (at most 70%, half as much on bosses). Only the strongest Chill applies; durations refresh to the longest.' },
  { id: 'freeze', name: 'Freeze', kind: 'status', forms: ['freeze', 'freezes', 'frozen', 'freezing'], color: C_FROST,
    text: `The enemy can't move or act and its attack is cancelled; Frozen enemies take ×1.15 from everyone's hits. Each further Freeze or Snare within ${RULES.crowdControlResistSec}s lasts half as long. Bosses take boss stagger instead.` },
  { id: 'shatter', name: 'Shatter', kind: 'status', forms: ['shatter', 'shatters', 'shattering'], classes: ['cryomancer'], color: C_FROST,
    text: 'Hitting a Frozen enemy with Absolute Zero, your Shatter skill or a Crystallize Ice Shard breaks the Freeze for a bonus 1.5× frost hit.' },
  { id: 'snare', name: 'Snare', kind: 'status', forms: ['snare', 'snares', 'snared'], color: C_CONTROL,
    text: `The enemy can't move but can still attack, and a charge in flight stops. Each further Snare or Freeze within ${RULES.crowdControlResistSec}s lasts half as long. Bosses take boss stagger instead.` },
  { id: 'root', name: 'Root', kind: 'status', forms: ['root', 'roots', 'rooted', 'rooting'], classes: ['warden'], color: C_CONTROL,
    text: 'Pins a non-boss enemy in place; it can still attack. Roots never stack or extend, and a freed enemy can\'t be rooted again for 1.5s. Bosses take boss stagger instead.' },
  { id: 'root_patch', name: 'Root patch', kind: 'status', forms: ['root patch', 'root patches'], classes: ['warden'], color: C_CONTROL,
    text: 'Rooting ground: every 0.5s it hits enemies inside for 0.25× physical and roots them for 1s.' },
  { id: 'stun', name: 'Stun', kind: 'status', forms: ['stun', 'stuns', 'stunned', 'stunning'], color: C_CONTROL,
    text: `The enemy can't move or attack and its attack is cancelled. Shorter if it was knocked back or stunned in the last ${RULES.crowdControlResistSec}s. Bosses take boss stagger instead.` },
  { id: 'blind', name: 'Blind', kind: 'status', forms: ['blind', 'blinds', 'blinded'], classes: ['templar'], color: C_CONTROL,
    text: 'A 1s stun plus Vulnerable (×1.15) for 4s. Bosses take boss stagger and the Vulnerable instead of the stun.' },
  { id: 'fear', name: 'Fear', kind: 'status', forms: ['fear', 'feared'], classes: ['berserker'], color: C_CONTROL,
    text: 'Non-boss enemies flee from you for 2s and can\'t attack.' },
  { id: 'interrupt', name: 'Interrupt', kind: 'status', forms: ['interrupt', 'interrupts', 'interrupting'], color: C_CONTROL,
    text: 'Cancels a non-boss enemy\'s attack while it winds up.' },
  { id: 'taunt', name: 'Taunt', kind: 'status', forms: ['taunt', 'taunts', 'taunted'], classes: ['vanguard'], color: C_CONTROL,
    text: 'Non-boss enemies turn on you for 3s.' },
  { id: 'knockback', name: 'Knockback', kind: 'status', forms: ['knockback', 'knocks back', 'knocked back', 'knocks enemies back', 'knocking enemies back', 'knocked into'], color: C_CONTROL,
    text: `Shoves enemies away and cancels a wind-up. Champions move ${pct(KNOCKBACK_RULES.eliteFactor[1]!)} as far, rares ${pct(KNOCKBACK_RULES.eliteFactor[2]!)}, bosses never; an enemy pushed in the last ${RULES.crowdControlResistSec}s moves ${pct(knockResist)} as far.` },
  { id: 'pull', name: 'Pull', kind: 'status', forms: ['pull', 'pulls', 'pulled', 'pulling', 'drag', 'drags', 'dragged'], color: C_CONTROL,
    text: 'Draws enemies toward a point. Bosses never move.' },
  { id: 'lure', name: 'Lure', kind: 'status', forms: ['lure', 'lures', 'lured'], color: C_CONTROL,
    text: 'Non-boss enemies walk toward the lure instead of fighting while it lasts.' },

  // ---------------- debuffs and finishers ----------------
  { id: 'vulnerable', name: 'Vulnerable', kind: 'status', forms: ['Vulnerable'], color: C_DEBUFF,
    text: 'Takes extra damage (×N shown) from everyone\'s direct hits for a few seconds. An enemy holds one Vulnerable at a time: they never stack, and damage over time ignores it.' },
  { id: 'execute', name: 'Execute', kind: 'status', forms: ['execute', 'executes', 'executed', 'executing'], color: C_DEBUFF,
    text: 'Instantly slays a non-boss enemy below the health shown.' },
  { id: 'mark', name: 'Mark', kind: 'status', forms: ['Mark', 'Marks', 'Marked'], classes: ['ranger'], color: C_DEBUFF,
    text: 'Your own hits on an enemy you Marked get ×3 critical tendency. Lasts 8s; each hero\'s Marks are their own.' },
  { id: 'condemn', name: 'Condemn', kind: 'status', forms: ['Condemn', 'Condemned'], classes: ['templar'], color: C_DEBUFF,
    text: 'Hammer of Judgment and smite hits brand enemies for 6s (with Condemnation); your hammer swings and shockwaves detonate it for 0.8× astral per rank around the enemy.' },
  { id: 'stagger', name: 'Boss stagger', kind: 'status', forms: ['boss stagger', 'stagger'], color: C_DEBUFF,
    text: `Heavy hits and controls fill a boss's stagger meter; when it is full the boss is staggered for 2.5s: its attack is cancelled and it takes ${bossVuln} damage.` },
  { id: 'invulnerable', name: 'Invulnerable', kind: 'status', forms: ['invulnerable', 'invulnerability'], color: C_RULE,
    text: 'Takes no damage at all for the time shown.' },
  { id: 'unkillable', name: 'Unkillable', kind: 'status', forms: ['unkillable'], color: C_RULE,
    text: 'Still takes damage but can\'t drop below 1 health.' },

  // ---------------- rules ----------------
  { id: 'shield', name: 'Shield', kind: 'rule', forms: ['shield', 'shields', 'shielded', 'shielding'], color: C_RULE,
    text: `Absorbs damage before health. You hold at most your shield cap (${pct(commonCap)} of max health${capOutliers ? `; ${capOutliers}` : ''}), and shields drain ${pct(RULES.shieldDecayPerSec)} of that cap each second.` },
  { id: 'shield_cap', name: 'Shield cap', kind: 'rule', forms: ['shield cap', 'shield capacity'], color: C_RULE,
    text: `The most shield you can hold, as a share of max health (${pct(commonCap)} for most heroes). Raising it also makes every shield you gain bigger.` },
  { id: 'armor', name: 'Armor', kind: 'rule', forms: ['armor'], color: C_RULE,
    text: `Cuts damage taken: each hit is ×${RULES.armorK} ÷ (${RULES.armorK} + armor), so ${RULES.armorK} armor halves it.` },
  { id: 'crit', name: 'Critical hit', kind: 'rule', forms: ['crit', 'crits', 'critical hit', 'critical hits', 'critical strike', 'critically strike', 'critically strikes'], color: C_RULE,
    text: `A lucky hit for ×${commonCrit} damage${critOutliers ? ` (${critOutliers})` : ''}. Your critical tendency sets how often it happens.` },
  { id: 'crit_tendency', name: 'Critical tendency', kind: 'rule', forms: ['critical tendency', 'crit tendency'], color: C_RULE,
    text: `Sets your crit chance: tendency ÷ (1 + tendency). Most heroes start at ${commonTendency} (${chance(commonTendency)}); ×3 of that is ${chance(commonTendency * 3)}.` },
  { id: 'crit_damage', name: 'Critical damage', kind: 'rule', forms: ['critical damage', 'crit damage'], color: C_RULE,
    text: `How hard crits hit: ${range(critMults, (v) => `×${v}`)} of a normal hit by default; nodes multiply it.` },
  { id: 'recovery', name: 'Cooldown recovery', kind: 'rule', forms: ['cooldown recovery', 'recover cooldowns', 'recovers cooldowns'], color: C_RULE,
    text: 'How fast cooldowns (dodge included) count down: ×1.25 recovery finishes every cooldown in 80% of the time.' },
  { id: 'charge', name: 'Charge', kind: 'rule', forms: ['charge', 'charges'], color: C_RULE,
    text: 'One stored cast of a skill: with 2 charges you can cast twice in a row, and spent charges refill one at a time on the cooldown.' },
  { id: 'attack_speed', name: 'Attack speed', kind: 'rule', forms: ['attack speed'], color: C_RULE,
    text: 'How often your basic attack swings or fires.' },
  { id: 'dodge', name: 'Dodge', kind: 'rule', forms: ['dodge', 'dodges', 'dodging'], color: C_RULE,
    text: `Your dash: ${DODGE.charges} charges, each recharging in ${DODGE.cooldownSec}s, with ${DODGE.iframeSec}s of invulnerability.` },
  { id: 'downed', name: 'Going down', kind: 'rule', forms: ['going down', 'goes down', 'downed', 'revive', 'revives', 'reviving', 'self-revive'], color: C_RULE,
    text: `At 0 health you go down for ${RULES.downedSec}s; an ally's ${RULES.reviveChannelSec}s revive brings you back at ${pct(RULES.reviveHealthFrac)} health (solo: a ${RULES.soloSelfReviveChannelSec}s self-revive, once per round).` },
  { id: 'lifesteal', name: 'Lifesteal', kind: 'rule', forms: ['lifesteal'], color: C_RULE,
    text: 'Heals you for the % shown of the damage you deal.' },
  { id: 'close_quarters', name: 'Close Quarters', kind: 'rule', forms: ['Close Quarters'], classes: CLASSES.filter((c) => c.melee).map((c) => c.id), color: C_RULE,
    text: `Melee heroes take ${pct(1 - Number(RULES.meleeDamageTakenMult))} less damage, and a basic swing with no enemy in reach lunges up to ${RULES.meleeLungeDist} units onto one.` },
  { id: 'evolution', name: 'Evolution', kind: 'rule', forms: ['evolution', 'evolutions'], color: C_RULE,
    text: 'A new-skill node that replaces its branch\'s base skill in the same slot. Upgrades that say "evolutions too" also apply to it.' },

  // ---------------- class mechanics ----------------
  { id: 'rally', name: 'Rally', kind: 'class', forms: ['Rally', 'Rallies', 'Rallied'], classes: ['vanguard'], color: C_CLASS,
    text: `Skill cooldowns recover ${pct(RULES.rallyRecovery - 1)} faster (×${RULES.rallyRecovery}) while it lasts; dodge is unaffected.` },
  { id: 'guard', name: 'Guard', kind: 'class', forms: ['guard', 'guards', 'guarding'], classes: ['vanguard'], color: C_CLASS,
    text: 'While guarding, hits from the front 90° are blocked and 30% of the blocked damage becomes shield; a full guard heals 4% max health.' },
  { id: 'backstab', name: 'Backstab', kind: 'class', forms: ['behind'], classes: ['duelist'], color: C_CLASS,
    text: 'Duelist hits from behind an enemy deal ×1.25; blinks land behind their target.' },
  { id: 'combo', name: 'Combo', kind: 'class', forms: ['Combo'], classes: ['duelist'], color: C_CLASS,
    text: 'Duelist meter: +1 per connecting swing, more from skills and +3 per parry, up to 20. It empties 2s after your last gain, and a big hit halves it.' },
  { id: 'finisher', name: 'Finisher', kind: 'class', forms: ['Finisher', 'Fang Finisher'], classes: ['duelist'], color: C_CLASS,
    text: `Every 4th connecting ${fangs?.name ?? 'basic'} swing: ×2 damage in a wider 110° arc reaching 2.3 units.` },
  { id: 'parry', name: 'Parry', kind: 'class', forms: ['parry', 'parries', 'parried'], classes: ['duelist'], color: C_CLASS,
    text: 'Stopping a threat during a parry stance: projectiles are reflected and melee attackers countered. Each parry gives 3 Combo and cuts 1s from your other cooldowns.' },
  { id: 'counter', name: 'Counter', kind: 'class', forms: ['counter', 'counters', 'countered'], classes: ['duelist'], color: C_CLASS,
    text: 'A parry\'s return thrust at a melee attacker: 2.6× damage and a 1s stun.' },
  { id: 'clone', name: 'Clone', kind: 'class', forms: ['clone', 'clones'], classes: ['duelist'], color: C_CLASS,
    text: 'A shadow copy that stays 3s and repeats your basic swings at 50% damage (at most 3).' },
  { id: 'overclock', name: 'Overclock', kind: 'class', forms: ['Overclock', 'Overclocked', 'overclocks'], classes: ['artificer'], color: C_CLASS,
    text: 'For 5s (6s from Boiler Overdrive): ×1.5 attack speed, Repeater bolts pierce 1 more enemy and drones zap twice as often.' },
  { id: 'turret', name: 'Turret', kind: 'class', forms: ['turret', 'turrets'], classes: ['artificer'], color: C_CLASS,
    text: 'Any turret form lasts 10s; you keep 2 at once and a new one replaces the oldest.' },
  { id: 'drone', name: 'Drone', kind: 'class', forms: ['drone', 'drones'], classes: ['artificer'], color: C_CLASS,
    text: 'From Clockwork Drone: orbits you and zaps the nearest enemy within 5 units for 0.6× storm every 0.7s.' },
  { id: 'explosive', name: 'Explosives', kind: 'class', forms: ['explosives'], classes: ['artificer'], color: C_CLASS,
    text: 'Steam Grenade in every form (bomblets, mines, shells) and Mortar Barrage shells.' },
  { id: 'mine', name: 'Mine', kind: 'class', forms: ['mine', 'mines'], classes: ['artificer'], color: C_CLASS,
    text: 'A grenade that lands on nothing arms after 0.4s, lasts 8s and blows up when an enemy comes within 1.2 units.' },
  { id: 'trap', name: 'Trap', kind: 'class', forms: ['trap', 'traps'], classes: ['ranger'], color: C_CLASS,
    text: 'Arms 0.4s after landing and lasts 15s; the first enemy to step on it springs it. You keep 3 at once (6 with Trap Volley); the oldest goes first.' },
  { id: 'soul', name: 'Soul', kind: 'class', forms: ['Soul', 'Souls'], classes: ['hexbinder'], color: C_CLASS,
    text: 'Torn from enemies by Soul Harvest kills: each orbits you for 10s, at most 6.' },
  { id: 'homing_spirit', name: 'Homing spirit', kind: 'class', forms: ['homing spirit', 'homing spirits'], classes: ['hexbinder'], color: C_CLASS,
    text: 'A seeking bolt for 0.8× decay that hunts enemies within 8 units.' },
  { id: 'spirit', name: 'Spirits', kind: 'class', forms: ['spirit', 'spirits'], classes: ['hexbinder'], color: C_CLASS,
    text: 'Your wraiths, banshee, Grave Legion, lesser wraiths, homing spirits and Soul strikes.' },
  { id: 'frenzy', name: 'Frenzy', kind: 'class', forms: ['Frenzy'], classes: ['berserker'], color: C_CLASS,
    text: 'Berserker stacks: +1 per connecting swing, up to 5; each gives ×1.05 attack speed. All stacks drop 3s after your last gain.' },
  { id: 'bloodlust', name: 'Bloodlust', kind: 'class', forms: ['Bloodlust'], classes: ['berserker'], color: C_CLASS,
    text: 'For 6s you heal 6% of the damage you deal and Frenzy never drops.' },
  { id: 'holy_ground', name: 'Holy ground', kind: 'class', forms: ['holy ground', 'consecrates', 'consecrated'], classes: ['templar'], color: C_CLASS,
    text: 'Ground from Consecrate, Dawnbreak, Judgment Day or Beacon of Light: every 0.5s it heals allies inside (Consecrate\'s also hits enemies for 0.35× astral).' },
  { id: 'vow', name: 'Vow', kind: 'class', forms: ['Vow'], classes: ['templar'], color: C_CLASS,
    text: 'An 18% max-health shield lasting 6s; the first hit after it is used up sets off a 1.5× astral burst.' },
  { id: 'thorn_armor', name: 'Thorn Armor', kind: 'class', forms: ['Thorn Armor'], classes: ['warden'], color: C_CLASS,
    text: 'For 4s, enemies that hit you with an attack are lashed for 0.8× physical plus 50% of the damage you took.' },
  { id: 'thorns', name: 'Thorns damage', kind: 'class', forms: ['thorns damage', 'thorns'], classes: ['warden'], color: C_CLASS,
    text: 'Scales every Warden thorn effect: thorn novas, brambles, Thorn Armor lashes, thorn shards and Venom Bloom.' },
  { id: 'thorn_shard', name: 'Thorn shard', kind: 'class', forms: ['thorn shard', 'thorn shards'], classes: ['warden'], color: C_CLASS,
    text: 'Thornspear\'s piercing thorn (0.45× physical, range 5); Ironthorn Pod flings 8.' },
  { id: 'barkskin', name: 'Barkskin', kind: 'class', forms: ['Barkskin'], classes: ['warden'], color: C_CLASS,
    text: 'From the Barkskin node: each Grove cast grants a 14% max-health shield and heals 7.5% max health over 5s.' },
  { id: 'spirit_beast', name: 'Spirit beast', kind: 'class', forms: ['spirit beast', 'spirit beasts', 'beast', 'beasts'], classes: ['warden'], color: C_CLASS,
    text: 'Your wolves, the spirit bear, the Wild Hunt stampede and Feral Shift\'s Maul; spirit beast damage raises them all.' },
  { id: 'grove_healing', name: 'Grove healing', kind: 'class', forms: ['Grove healing'], classes: ['warden'], color: C_CLASS,
    text: 'Scales Verdant Totem\'s heal, Barkskin\'s healing and Heart of the Forest\'s patch heals.' },
];

/**
 * "<Branch> skill" / "<Branch> cast": a class branch's active slot (its base skill or whichever evolution replaced it).
 * Generated from the tree so the list can never go stale; only the pairs the copy uses are listed.
 */
const BRANCH_SKILL_TERMS: [classId: string, branchId: string][] = [
  ['arcanist', 'ember'], ['arcanist', 'storm'], ['arcanist', 'rift'], ['artificer', 'clockwork'], ['berserker', 'warcry'], ['cryomancer', 'glacier'],
  ['cryomancer', 'shatter'], ['duelist', 'shadow'], ['hexbinder', 'sanguine'], ['ranger', 'volley'], ['templar', 'aegis'],
  ['vanguard', 'rally'], ['warden', 'grove'],
];

function branchSkillTerm(classId: string, branchId: string): GlossaryTerm {
  const cls = CLASS_BY_ID[classId]!;
  const br = cls.branches.find((b) => b.id === branchId)!;
  const skills = NODES.filter((n) => n.classId === classId && n.branch === branchId && n.grantsSkill).sort((a, b) => a.tier - b.tier)
    .map((n) => SKILL_BY_ID[n.grantsSkill!]?.name ?? n.name);
  const list = skills.length > 1 ? `${skills.slice(0, -1).join(', ')} or ${skills[skills.length - 1]}` : skills[0] ?? br.name;
  return {
    id: `branch_${classId}_${branchId}`, name: `${br.name} skill`, kind: 'class', classes: [classId], color: C_CLASS,
    forms: [`${br.name} skill`, `${br.name} skills`, `${br.name} cast`, `${br.name} casts`],
    text: `Your ${br.name} branch's active skill: ${list}, whichever is in its slot.`,
  };
}

export const GLOSSARY: GlossaryTerm[] = [...TERMS, ...BRANCH_SKILL_TERMS.map(([c, b]) => branchSkillTerm(c, b))];
export const GLOSSARY_BY_ID: Record<string, GlossaryTerm> = Object.fromEntries(GLOSSARY.map((t) => [t.id, t]));

const applies = (t: GlossaryTerm, classId?: string) =>
  !classId || ((!t.classes || t.classes.includes(classId)) && !t.notClasses?.includes(classId));

// ---------------------------------------------------------------------------------------------------------------
// matching
// ---------------------------------------------------------------------------------------------------------------

export interface KeywordSpan {
  text: string;
  /** the glossary term this run of text names */
  term?: GlossaryTerm;
  /** a skill or node name (never split into keywords: "Frozen Orb" is a skill, not a Freeze) */
  name?: boolean;
}

interface Matcher { re: RegExp; names: Set<string>; forms: Map<string, GlossaryTerm[]> }
let matcher: Matcher | null = null;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A form matches with either case on its first letter ("Burning" at a sentence start). */
const formPattern = (f: string) => {
  const c = f.charAt(0);
  const lead = c.toLowerCase() !== c.toUpperCase() ? `[${c.toLowerCase()}${c.toUpperCase()}]` : esc(c);
  return lead + esc(f.slice(1));
};
const formKey = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function getMatcher(): Matcher {
  if (matcher) return matcher;
  const forms = new Map<string, GlossaryTerm[]>();
  for (const t of GLOSSARY) for (const f of t.forms) {
    const k = formKey(f);
    forms.set(k, [...(forms.get(k) ?? []), t]);
  }
  // skill and node names are protected, except names that are themselves glossary words (Overclock, Bloodlust, Shatter)
  const names = new Set<string>();
  for (const x of [...SKILLS, ...NODES]) if (!forms.has(formKey(x.name))) names.add(x.name);
  const alts = [...[...names].map((n) => ({ len: n.length, src: esc(n) })), ...[...forms.keys()].map((f) => ({ len: f.length, src: formPattern(f) }))]
    .sort((a, b) => b.len - a.len);
  matcher = { re: new RegExp(`(?<![A-Za-z0-9-])(?:${alts.map((a) => a.src).join('|')})(?![A-Za-z0-9-])`, 'g'), names, forms };
  return matcher;
}

/**
 * Split skill copy into plain text, protected skill names and glossary keywords for `classId`'s copy.
 * By default only the first mention of each term is a keyword (`all` marks every mention: the content tests).
 */
export function keywordSpans(text: string, classId?: string, opts: { all?: boolean } = {}): KeywordSpan[] {
  const m = getMatcher();
  const out: KeywordSpan[] = [];
  const seen = new Set<string>();
  let last = 0;
  const push = (s: KeywordSpan) => { if (s.text) out.push(s); };
  m.re.lastIndex = 0;
  for (let r = m.re.exec(text); r; r = m.re.exec(text)) {
    const word = r[0];
    const term = m.names.has(word) ? undefined : (m.forms.get(formKey(word)) ?? []).find((t) => applies(t, classId));
    if (!m.names.has(word) && (!term || (!opts.all && seen.has(term.id)))) continue;
    push({ text: text.slice(last, r.index) });
    push(term ? { text: word, term } : { text: word, name: true });
    if (term) seen.add(term.id);
    last = r.index + word.length;
  }
  push({ text: text.slice(last) });
  // merge adjacent plain runs (names that were not keywords stay marked for the tests)
  return out.reduce<KeywordSpan[]>((acc, s) => {
    const prev = acc[acc.length - 1];
    if (prev && !prev.term && !prev.name && !s.term && !s.name) prev.text += s.text;
    else acc.push({ ...s });
    return acc;
  }, []);
}

/** The glossary terms a piece of copy names (first mention order). */
export function glossaryTermsIn(text: string, classId?: string): GlossaryTerm[] {
  return keywordSpans(text, classId).flatMap((s) => (s.term ? [s.term] : []));
}
