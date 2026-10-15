import type { ClassDef, NodeDef, SkillDef } from '../types';
import { node } from './common';

// Ranger: bow hunter. Kit rules (implemented in simulation/src/classes/ranger.ts and cc.ts):
//   Mark   - a Marked enemy takes your hits with x3 critical tendency (Marks are per Ranger; Hunter's Mark keeps one).
//   Snare  - the enemy cannot move for the duration (it can still attack). Shares control resistance with Freeze:
//            within 4s of any crowd control each further Snare lasts half as long. Bosses take stagger instead.
//   Poison - decay damage over time; scales with decay damage (Toxicology, Plague Bearer).

const n = (id: string, branch: string, name: string, rankLimit: number, tier: NodeDef['tier'], opts: Parameters<typeof node>[6]) => node(id, 'ranger', branch, name, rankLimit, tier, opts);

const sk = (s: Omit<SkillDef, 'classId' | 'compressionSupport' | 'icon'> & { icon?: string }): SkillDef =>
  ({ classId: 'ranger', compressionSupport: true, icon: s.icon ?? `node:${s.id}`, ...s });

const hidden = (id: string, name: string, coef: string, dtype: SkillDef['damageType'], shape: SkillDef['shape'], description: string, icon: string): SkillDef =>
  sk({ id, name, slot: 'active', damageType: dtype, damageCoef: coef, resourceCost: 0, cooldownSec: 0, charges: 1, shape, description, icon });

const ARROW = { kind: 'projectile', speed: 15, radius: 0.18, range: 9, pierce: 0, spreadDeg: 12 } as const;

export const SKILLS: SkillDef[] = [
  sk({ id: 'r_quick_shot', name: 'Quick Shot', slot: 'basic', damageType: 'physical', damageCoef: '1', resourceCost: 0, cooldownSec: 0, charges: 1,
    shape: { kind: 'projectile', speed: 16, radius: 0.18, range: 10, pierce: 0, spreadDeg: 8 }, description: 'A fast arrow loosed at your aim.' }),
  sk({ id: 'r_rain_of_arrows', name: 'Rain of Arrows', slot: 'signature', damageType: 'physical', damageCoef: '0.45', resourceCost: 35, cooldownSec: 13, charges: 1,
    shape: { kind: 'aura', radius: 3.2, duration: 3 },
    description: 'Darken the sky over the aimed point (up to 9 units, radius 3.2) for 3s: every 0.25s arrows strike every enemy inside for 0.45x physical damage (can critically strike). Builds boss stagger.' }),
  // ---- Volley ----
  sk({ id: 'r_multishot', name: 'Multishot', slot: 'active', damageType: 'physical', damageCoef: '0.8', resourceCost: 15, cooldownSec: 3, charges: 1,
    shape: { ...ARROW }, description: 'Fire a fan of 5 arrows (12 degrees apart), each dealing 0.8x physical damage.' }),
  sk({ id: 'r_barrage', name: 'Barrage', slot: 'active', damageType: 'physical', damageCoef: '0.6', resourceCost: 20, cooldownSec: 5, charges: 1,
    shape: { ...ARROW }, description: 'Loose three fans over 0.3s, each 5 arrows of 0.6x physical damage, re-aimed as you turn.' }),
  sk({ id: 'r_longshot', name: 'Longshot', slot: 'active', damageType: 'physical', damageCoef: '2.8', resourceCost: 20, cooldownSec: 6, charges: 1,
    shape: { kind: 'projectile', speed: 26, radius: 0.35, range: 16, pierce: 99, spreadDeg: 0 },
    description: 'A heavy arrow that flies 16 units and pierces everything for 2.8x physical damage, x1.6 against enemies more than 6 units away.' }),
  hidden('r_ricochet', 'Ricochet', '0.5', 'physical', { kind: 'projectile', speed: 16, radius: 0.18, range: 5, pierce: 0, spreadDeg: 0 }, 'Ricocheting Volley arrow.', 'node:r_ricochet'),
  hidden('r_explosion', 'Explosive Tip', '0.4', 'physical', { kind: 'circle', radius: 1.2, selfCentered: false, range: 0 }, 'Explosive Tips blast.', 'node:r_explosive_tips'),
  // ---- Marksman ----
  sk({ id: 'r_hunters_mark', name: "Hunter's Mark", slot: 'active', damageType: 'physical', damageCoef: '1', resourceCost: 10, cooldownSec: 4, charges: 1,
    shape: { kind: 'chain', range: 12, jumpRange: 0, jumps: 0 },
    description: 'Shoot the enemy nearest your aim (within 12 units) for 1x physical damage and Mark it for 8s: your hits against it have x3 critical tendency.' }),
  sk({ id: 'r_power_shot', name: 'Power Shot', slot: 'active', damageType: 'physical', damageCoef: '3.5', resourceCost: 25, cooldownSec: 6, charges: 1,
    shape: { kind: 'projectile', speed: 22, radius: 0.3, range: 13, pierce: 1, spreadDeg: 0 }, knockback: 1,
    description: 'A heavy arrow (pierces 1) for 3.5x physical damage that knocks enemies back 1 unit; always critically strikes Marked enemies with x1.5 critical damage and Marks the first enemy hit.' }),
  sk({ id: 'r_deadeye', name: 'Deadeye', slot: 'active', damageType: 'physical', damageCoef: '1.6', resourceCost: 20, cooldownSec: 8, charges: 1,
    shape: { kind: 'chain', range: 12, jumpRange: 0, jumps: 2 },
    description: 'Mark the 3 enemies nearest your aim (within 12 units) for 8s and shoot each for 1.6x physical damage.' }),
  hidden('r_tumble_shot', 'Tumble Shot', '0.9', 'physical', { kind: 'projectile', speed: 16, radius: 0.18, range: 9, pierce: 0, spreadDeg: 14 }, 'Arrows loosed while dodging.', 'node:r_tumble_shot'),
  // ---- Wilds ----
  sk({ id: 'r_snare_trap', name: 'Snare Trap', slot: 'active', damageType: 'physical', damageCoef: '2', resourceCost: 15, cooldownSec: 6, charges: 1,
    shape: { kind: 'circle', radius: 1.6, selfCentered: false, range: 7 },
    description: 'Toss a trap that arms after 0.4s and lasts 15s; the first enemy to step on it springs it for 2x physical damage (radius 1.6) and Snares enemies for 1.5s.' }),
  sk({ id: 'r_trap_volley', name: 'Trap Volley', slot: 'active', damageType: 'physical', damageCoef: '2', resourceCost: 25, cooldownSec: 8, charges: 1,
    shape: { kind: 'circle', radius: 1.6, selfCentered: false, range: 7 },
    description: 'Toss 3 Snare Traps in a fan (25 degrees apart); up to 6 traps at once.' }),
  sk({ id: 'r_bait', name: "Hunter's Bait", slot: 'active', damageType: 'physical', damageCoef: '2', resourceCost: 25, cooldownSec: 10, charges: 1,
    shape: { kind: 'circle', radius: 2.2, selfCentered: false, range: 8 },
    description: 'Throw bait to the aimed point: non-boss enemies within 6 units are lured to it for 2.5s, then it springs a trap burst (radius 2.2).' }),
  hidden('r_venom_cloud', 'Venom Cloud', '0.35', 'decay', { kind: 'aura', radius: 2, duration: 4 }, 'Toxic cloud from Venom Snare.', 'node:r_venom_snare'),
  hidden('r_hawk_dive', 'Hawk Dive', '1.2', 'physical', { kind: 'circle', radius: 0.6, selfCentered: false, range: 7 }, 'Hawk companion dive.', 'node:r_hawk_companion'),
];

export const NODES: NodeDef[] = [
  // ---- Ranger / Volley ----
  n('r_multishot', 'volley', 'Multishot', 1, 0, { grantsSkill: 'r_multishot',
    description: 'Fires a fan of 5 arrows, each for 0.8× physical.' }),
  n('r_steady_draw', 'volley', 'Steady Draw', 3, 1, { modifiers: [{ stat: 'player.physicalDamage', factorPerRank: '1.08' }], description: 'Raises physical damage ×{value} per rank.' }),
  n('r_quick_hands', 'volley', 'Quick Hands', 3, 1, { modifiers: [{ stat: 'player.attackFrequency', factorPerRank: '1.07' }], description: 'Raises attack speed ×{value} per rank.' }),
  n('r_wide_fan', 'volley', 'Wide Fan', 2, 1, { prereqs: [{ node: 'r_multishot', rank: 1 }], mechanics: ['wide_fan'],
    upgrades: 'r_multishot', description: 'Upgrades Multishot: +2 arrows per rank, Barrage fans too.' }),
  n('r_ricochet', 'volley', 'Ricochet', 1, 2, { prereqs: [{ node: 'r_multishot', rank: 1 }], excludes: ['r_piercing'], mechanics: ['ricochet'],
    upgrades: 'r_multishot', description: 'Upgrades Multishot: arrows ricochet to a nearby enemy for 0.5×, evolutions too.' }),
  n('r_piercing', 'volley', 'Piercing Arrows', 1, 2, { prereqs: [{ node: 'r_multishot', rank: 1 }], excludes: ['r_ricochet'], mechanics: ['piercing_arrows'],
    upgrades: 'r_multishot', description: 'Upgrades Multishot: +2 pierce and ×1.25 damage, but a 30% narrower fan.' }),
  n('r_barrage', 'volley', 'Barrage', 1, 2, { prereqs: [{ node: 'r_multishot', rank: 1 }], excludes: ['r_longshot'], grantsSkill: 'r_barrage',
    description: 'Looses 3 fans of 5 arrows over 0.3s, each arrow 0.6× physical.' }),
  n('r_longshot', 'volley', 'Longshot', 1, 2, { prereqs: [{ node: 'r_multishot', rank: 1 }], excludes: ['r_barrage'], grantsSkill: 'r_longshot',
    description: 'Fires a 16-unit piercing arrow for 2.8×, ×1.6 against distant enemies.' }),
  n('r_hunters_rhythm', 'volley', "Hunter's Rhythm", 1, 2, { prereqs: [{ node: 'r_multishot', rank: 1 }], mechanics: ['hunters_rhythm'],
    description: 'Makes your next 3 Quick Shots after a Volley skill fire 2 extra arrows.' }),
  n('r_arrow_storm', 'volley', 'Arrow Storm', 1, 3, { prereqs: [{ node: 'r_multishot', rank: 1 }], mechanics: ['arrow_storm'], upgrades: 'r_multishot', description: 'Upgrades Multishot: holds 2 charges, evolutions too.' }),
  n('r_explosive_tips', 'volley', 'Explosive Tips', 1, 3, { prereqs: [{ node: 'r_multishot', rank: 1 }], mechanics: ['explosive_tips'],
    upgrades: 'r_multishot', description: 'Upgrades Multishot: arrows explode for 0.4× in radius 1.2, evolutions too.' }),
  n('r_echoing_volley', 'volley', 'Echoing Volley', 1, 4, { excludes: ['r_point_blank'], mechanics: ['echoing_volley'],
    upgrades: 'r_multishot', description: 'Upgrades Multishot: fires again at ×0.7 damage 0.25s later, evolutions too.' }),
  n('r_point_blank', 'volley', 'Point Blank', 1, 4, { excludes: ['r_echoing_volley'], mechanics: ['point_blank'],
    upgrades: 'r_multishot', description: 'Upgrades Multishot: ×1.5 damage within 3.5 units, and each cast springs you back 2.5.' }),

  // ---- Ranger / Marksman ----
  n('r_hunters_mark', 'marksman', "Hunter's Mark", 1, 0, { grantsSkill: 'r_hunters_mark',
    description: 'Shoots and Marks an enemy for 8s; your hits on it get ×3 critical tendency.' }),
  n('r_keen_eye', 'marksman', 'Keen Eye', 3, 1, { modifiers: [{ stat: 'player.critTendency', factorPerRank: '1.12' }], description: 'Raises critical tendency ×{value} per rank.' }),
  n('r_lethality', 'marksman', 'Lethality', 3, 1, { modifiers: [{ stat: 'player.critPotency', factorPerRank: '1.08' }], description: 'Raises critical damage ×{value} per rank.' }),
  n('r_lingering_mark', 'marksman', 'Lingering Mark', 2, 1, { prereqs: [{ node: 'r_hunters_mark', rank: 1 }], mechanics: ['lingering_mark'],
    upgrades: 'r_hunters_mark', description: 'Upgrades Hunter\'s Mark: +4s duration and ×1.05 damage to Marked per rank.' }),
  n('r_predator', 'marksman', "Predator's Mark", 1, 2, { prereqs: [{ node: 'r_hunters_mark', rank: 1 }], excludes: ['r_exposed'], mechanics: ['predator'],
    upgrades: 'r_hunters_mark', description: 'Upgrades Hunter\'s Mark: on a kill, the Mark leaps on and the cooldown resets.' }),
  n('r_exposed', 'marksman', 'Exposed Weakness', 1, 2, { prereqs: [{ node: 'r_hunters_mark', rank: 1 }], excludes: ['r_predator'], mechanics: ['exposed'],
    upgrades: 'r_hunters_mark', description: 'Upgrades Hunter\'s Mark: Marked enemies take ×1.25 damage from all sources.' }),
  n('r_power_shot', 'marksman', 'Power Shot', 1, 2, { prereqs: [{ node: 'r_hunters_mark', rank: 1 }], excludes: ['r_deadeye'], grantsSkill: 'r_power_shot',
    description: 'Fires a 3.5× piercing arrow that always crits Marked enemies and Marks the first hit.' }),
  n('r_deadeye', 'marksman', 'Deadeye', 1, 2, { prereqs: [{ node: 'r_hunters_mark', rank: 1 }], excludes: ['r_power_shot'], grantsSkill: 'r_deadeye',
    description: 'Marks the 3 enemies nearest your aim and shoots each for 1.6× physical.' }),
  n('r_tumble_shot', 'marksman', 'Tumble Shot', 1, 2, { mechanics: ['tumble_shot'],
    description: 'Fires 3 arrows (0.9× each) toward your aim whenever you dodge.' }),
  n('r_headshot', 'marksman', 'Headshot', 1, 3, { prereqs: [{ node: 'r_hunters_mark', rank: 1 }], mechanics: ['headshot'],
    upgrades: 'r_hunters_mark', description: 'Upgrades Hunter\'s Mark: crits execute Marked enemies under 20%; bosses take ×1.3 crits.' }),
  n('r_focus_fire', 'marksman', 'Focus Fire', 1, 3, { prereqs: [{ node: 'r_hunters_mark', rank: 1 }], mechanics: ['focus_fire'],
    upgrades: 'r_hunters_mark', description: 'Upgrades Hunter\'s Mark: each hit on your Mark stacks ×1.04 damage (max 10).' }),
  n('r_steady_aim', 'marksman', 'Steady Aim', 1, 4, { excludes: ['r_wind_dancer'], mechanics: ['steady_aim'],
    description: 'Gives ×2 critical tendency and ×1.3 crit damage after standing still for 0.75s.' }),
  n('r_wind_dancer', 'marksman', 'Wind Dancer', 1, 4, { excludes: ['r_steady_aim'], mechanics: ['wind_dancer'],
    description: 'Makes your next 3 hits after a dodge crit for ×1.25; Tumble Shot fires 5 arrows.' }),

  // ---- Ranger / Wilds ----
  n('r_snare_trap', 'wilds', 'Snare Trap', 1, 0, { grantsSkill: 'r_snare_trap',
    description: 'Tosses a trap that springs for 2× physical and snares enemies for 1.5s (3 at once).' }),
  n('r_toxicology', 'wilds', 'Toxicology', 3, 1, { modifiers: [{ stat: 'player.decayDamage', factorPerRank: '1.1' }], description: 'Raises poison (decay) damage ×{value} per rank.' }),
  n('r_fleet_foot', 'wilds', 'Fleet Foot', 3, 1, { modifiers: [{ stat: 'player.movementSpeed', factorPerRank: '1.04' }], description: 'Raises movement speed ×{value} per rank.' }),
  n('r_hair_trigger', 'wilds', 'Hair Trigger', 2, 1, { prereqs: [{ node: 'r_snare_trap', rank: 1 }], mechanics: ['hair_trigger'],
    upgrades: 'r_snare_trap', description: 'Upgrades Snare Trap: arms instantly, and +0.3 burst radius per rank.' }),
  n('r_blast_traps', 'wilds', 'Blast Traps', 1, 2, { prereqs: [{ node: 'r_snare_trap', rank: 1 }], excludes: ['r_venom_snare'], mechanics: ['blast_traps'],
    upgrades: 'r_snare_trap', description: 'Upgrades Snare Trap: ×2 damage in ×1.4 radius, with knockback instead of a snare.' }),
  n('r_venom_snare', 'wilds', 'Venom Snare', 1, 2, { prereqs: [{ node: 'r_snare_trap', rank: 1 }], excludes: ['r_blast_traps'], mechanics: ['venom_snare'],
    upgrades: 'r_snare_trap', description: 'Upgrades Snare Trap: snares 2.5s and leaves a poison cloud (0.35× every 0.5s).' }),
  n('r_trap_volley', 'wilds', 'Trap Volley', 1, 2, { prereqs: [{ node: 'r_snare_trap', rank: 1 }], excludes: ['r_bait'], grantsSkill: 'r_trap_volley',
    description: 'Tosses 3 traps in a fan; up to 6 traps at once.' }),
  n('r_bait', 'wilds', "Hunter's Bait", 1, 2, { prereqs: [{ node: 'r_snare_trap', rank: 1 }], excludes: ['r_trap_volley'], grantsSkill: 'r_bait',
    description: 'Throws bait that lures enemies within 6 units for 2.5s, then springs a trap.' }),
  n('r_hawk_companion', 'wilds', 'Hawk Companion', 1, 2, { mechanics: ['hawk_companion'],
    description: 'Adds a hawk that dives your Mark or the nearest enemy for 1.2× every 2s.' }),
  n('r_poison_tips', 'wilds', 'Poison Tips', 1, 3, { mechanics: ['poison_tips'],
    description: 'Makes arrows and hawk dives poison for 20% of the hit per second over 4s.' }),
  n('r_twin_hawks', 'wilds', 'Twin Hawks', 1, 3, { prereqs: [{ node: 'r_hawk_companion', rank: 1 }], mechanics: ['twin_hawks'],
    description: 'Adds a second hawk, and hawk dives deal ×1.25 damage.' }),
  n('r_apex_predator', 'wilds', 'Apex Predator', 1, 4, { prereqs: [{ node: 'r_hawk_companion', rank: 1 }], excludes: ['r_plague_bearer'], mechanics: ['apex_predator'],
    description: 'Makes hawks dive every 0.8s for ×1.5 damage and Mark what they hit.' }),
  n('r_plague_bearer', 'wilds', 'Plague Bearer', 1, 4, { excludes: ['r_apex_predator'], modifiers: [{ stat: 'player.decayDamage', factorPerRank: '1.5' }], mechanics: ['plague_bearer'],
    description: 'Makes all hits poison, poison ×{value}, and poison spreads when a victim dies.' }),
];

export const CLASS: ClassDef = {
  id: 'ranger', name: 'Ranger', tagline: 'Bow, mark and wilds. Picks the pack apart from range and lets nothing escape.',
  branches: [
    { id: 'volley', name: 'Volley', theme: 'Multishot fans, ricochets and longshots' },
    { id: 'marksman', name: 'Marksman', theme: 'Marks, critical strikes and executions' },
    { id: 'wilds', name: 'Wilds', theme: 'Traps, poison and a hawk companion' },
  ],
  accent: '#6fa83c', role: 'Ranged hunter · precision',
  resource: { name: 'Focus', max: 100, regenPerSec: 10 },
  base: { maxHealth: 820, armor: 16, damage: 82, attackFrequency: 2.2, moveSpeed: 4.8, critTendency: '0.3', critMultiplier: '2', shieldCapacity: 0.6 },
  basicSkill: 'r_quick_shot', signatureSkill: 'r_rain_of_arrows',
  nodes: NODES.map((x) => x.id),
};
