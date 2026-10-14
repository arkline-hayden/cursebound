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

const VOLLEY = 'Volley arrows (Multishot, Barrage, Longshot)';

export const NODES: NodeDef[] = [
  // ---- Ranger / Volley ----
  n('r_multishot', 'volley', 'Multishot', 1, 0, { grantsSkill: 'r_multishot',
    description: 'Equip Multishot (15 Focus, 3s): fire a fan of 5 arrows (12 degrees apart), each dealing 0.8x physical damage.' }),
  n('r_steady_draw', 'volley', 'Steady Draw', 3, 1, { modifiers: [{ stat: 'player.physicalDamage', factorPerRank: '1.08' }], description: 'Physical damage x1.08 per rank.' }),
  n('r_quick_hands', 'volley', 'Quick Hands', 3, 1, { modifiers: [{ stat: 'player.attackFrequency', factorPerRank: '1.07' }], description: 'Attack frequency x1.07 per rank.' }),
  n('r_wide_fan', 'volley', 'Wide Fan', 2, 1, { prereqs: [{ node: 'r_multishot', rank: 1 }], mechanics: ['wide_fan'],
    description: 'Multishot and each Barrage fan fire 2 more arrows per rank.' }),
  n('r_ricochet', 'volley', 'Ricochet', 1, 2, { prereqs: [{ node: 'r_multishot', rank: 1 }], excludes: ['r_piercing'], mechanics: ['ricochet'],
    description: `Choice: ${VOLLEY} ricochet on hit toward the nearest other enemy within 5 units for 0.5x physical damage.` }),
  n('r_piercing', 'volley', 'Piercing Arrows', 1, 2, { prereqs: [{ node: 'r_multishot', rank: 1 }], excludes: ['r_ricochet'], mechanics: ['piercing_arrows'],
    description: `Choice: ${VOLLEY} pierce 2 more enemies and deal x1.25 damage; Multishot and Barrage fans are 30% narrower.` }),
  n('r_barrage', 'volley', 'Barrage', 1, 2, { prereqs: [{ node: 'r_multishot', rank: 1 }], excludes: ['r_longshot'], grantsSkill: 'r_barrage',
    description: 'Evolve Multishot into Barrage (20 Focus, 5s): loose three fans over 0.3s, each 5 arrows of 0.6x physical damage, re-aimed as you turn. Volley upgrades apply.' }),
  n('r_longshot', 'volley', 'Longshot', 1, 2, { prereqs: [{ node: 'r_multishot', rank: 1 }], excludes: ['r_barrage'], grantsSkill: 'r_longshot',
    description: 'Evolve Multishot into Longshot (20 Focus, 6s): a heavy arrow that flies 16 units and pierces everything for 2.8x physical damage, x1.6 against enemies more than 6 units from you. Volley upgrades apply.' }),
  n('r_hunters_rhythm', 'volley', "Hunter's Rhythm", 1, 2, { prereqs: [{ node: 'r_multishot', rank: 1 }], mechanics: ['hunters_rhythm'],
    description: 'After each Volley skill, your next 3 Quick Shots fire 2 extra arrows in a fan.' }),
  n('r_arrow_storm', 'volley', 'Arrow Storm', 1, 3, { prereqs: [{ node: 'r_multishot', rank: 1 }], mechanics: ['arrow_storm'], description: 'Your Volley-branch skill holds 2 charges.' }),
  n('r_explosive_tips', 'volley', 'Explosive Tips', 1, 3, { prereqs: [{ node: 'r_multishot', rank: 1 }], mechanics: ['explosive_tips'],
    description: `${VOLLEY} explode on hit for 0.4x physical damage to other enemies within 1.2 units.` }),
  n('r_echoing_volley', 'volley', 'Echoing Volley', 1, 4, { excludes: ['r_point_blank'], mechanics: ['echoing_volley'],
    description: 'Keystone: every Volley-branch skill fires again at x0.7 damage 0.25s after it finishes (Multishot and Longshot: 0.25s after the cast; Barrage: 0.25s after its third fan).' }),
  n('r_point_blank', 'volley', 'Point Blank', 1, 4, { excludes: ['r_echoing_volley'], mechanics: ['point_blank'],
    description: `Keystone: ${VOLLEY} deal x1.5 damage to enemies within 3.5 units, and each Volley cast springs you 2.5 units backward.` }),

  // ---- Ranger / Marksman ----
  n('r_hunters_mark', 'marksman', "Hunter's Mark", 1, 0, { grantsSkill: 'r_hunters_mark',
    description: "Equip Hunter's Mark (10 Focus, 4s): shoot the enemy nearest your aim (within 12 units) for 1x physical damage and Mark it for 8s. Your hits against your Marked enemy have x3 critical tendency. Marking again moves your Mark." }),
  n('r_keen_eye', 'marksman', 'Keen Eye', 3, 1, { modifiers: [{ stat: 'player.critTendency', factorPerRank: '1.12' }], description: 'Critical tendency x1.12 per rank.' }),
  n('r_lethality', 'marksman', 'Lethality', 3, 1, { modifiers: [{ stat: 'player.critPotency', factorPerRank: '1.08' }], description: 'Critical damage potency x1.08 per rank.' }),
  n('r_lingering_mark', 'marksman', 'Lingering Mark', 2, 1, { prereqs: [{ node: 'r_hunters_mark', rank: 1 }], mechanics: ['lingering_mark'],
    description: 'Marks last 4s longer per rank, and your hits against Marked enemies deal x1.05 damage per rank.' }),
  n('r_predator', 'marksman', "Predator's Mark", 1, 2, { prereqs: [{ node: 'r_hunters_mark', rank: 1 }], excludes: ['r_exposed'], mechanics: ['predator'],
    description: 'Choice: when your Marked enemy dies, the Mark leaps to the nearest enemy within 8 units and your Marksman skill\'s cooldown resets.' }),
  n('r_exposed', 'marksman', 'Exposed Weakness', 1, 2, { prereqs: [{ node: 'r_hunters_mark', rank: 1 }], excludes: ['r_predator'], mechanics: ['exposed'],
    description: 'Choice: enemies you Mark take x1.25 damage from all sources, and your hits on a Marked boss add 25 stagger.' }),
  n('r_power_shot', 'marksman', 'Power Shot', 1, 2, { prereqs: [{ node: 'r_hunters_mark', rank: 1 }], excludes: ['r_deadeye'], grantsSkill: 'r_power_shot',
    description: "Evolve Hunter's Mark into Power Shot (25 Focus, 6s): a heavy arrow (pierces 1) for 3.5x physical damage that knocks enemies back 1 unit. It always critically strikes Marked enemies with x1.5 critical damage, and Marks the first enemy it hits for 8s. Mark upgrades apply." }),
  n('r_deadeye', 'marksman', 'Deadeye', 1, 2, { prereqs: [{ node: 'r_hunters_mark', rank: 1 }], excludes: ['r_power_shot'], grantsSkill: 'r_deadeye',
    description: "Evolve Hunter's Mark into Deadeye (20 Focus, 8s): Mark the 3 enemies nearest your aim (within 12 units) for 8s and shoot each for 1.6x physical damage. Mark upgrades apply." }),
  n('r_tumble_shot', 'marksman', 'Tumble Shot', 1, 2, { mechanics: ['tumble_shot'],
    description: 'Dodging looses a fan of 3 arrows toward your aim, each dealing 0.9x physical damage.' }),
  n('r_headshot', 'marksman', 'Headshot', 1, 3, { prereqs: [{ node: 'r_hunters_mark', rank: 1 }], mechanics: ['headshot'],
    description: 'Your critical hits on Marked non-boss enemies left below 20% health execute them; your critical hits on Marked bosses deal x1.3 critical damage.' }),
  n('r_focus_fire', 'marksman', 'Focus Fire', 1, 3, { prereqs: [{ node: 'r_hunters_mark', rank: 1 }], mechanics: ['focus_fire'],
    description: 'Each hit on your Marked enemy grants Focus Fire (max 10 stacks): x1.04 damage per stack against it. Stacks reset when you hit a different Marked enemy.' }),
  n('r_steady_aim', 'marksman', 'Steady Aim', 1, 4, { excludes: ['r_wind_dancer'], mechanics: ['steady_aim'],
    description: 'Keystone: after standing still for 0.75s, your hits have x2 critical tendency and x1.3 critical damage, and Quick Shots pierce 1 enemy.' }),
  n('r_wind_dancer', 'marksman', 'Wind Dancer', 1, 4, { excludes: ['r_steady_aim'], mechanics: ['wind_dancer'],
    description: 'Keystone: after dodging, your next 3 hits within 3s critically strike with x1.25 critical damage, and Tumble Shot fires 5 arrows instead of 3.' }),

  // ---- Ranger / Wilds ----
  n('r_snare_trap', 'wilds', 'Snare Trap', 1, 0, { grantsSkill: 'r_snare_trap',
    description: 'Equip Snare Trap (15 Focus, 6s): toss a trap to the aimed point (up to 7 units); it arms after 0.4s and lasts 15s (3 at once). The first enemy to step on it springs it for 2x physical damage (radius 1.6) and Snares enemies for 1.5s (bosses take 50 stagger).' }),
  n('r_toxicology', 'wilds', 'Toxicology', 3, 1, { modifiers: [{ stat: 'player.decayDamage', factorPerRank: '1.1' }], description: 'Poison (decay) damage x1.1 per rank.' }),
  n('r_fleet_foot', 'wilds', 'Fleet Foot', 3, 1, { modifiers: [{ stat: 'player.movementSpeed', factorPerRank: '1.04' }], description: 'Movement speed x1.04 per rank.' }),
  n('r_hair_trigger', 'wilds', 'Hair Trigger', 2, 1, { prereqs: [{ node: 'r_snare_trap', rank: 1 }], mechanics: ['hair_trigger'],
    description: 'Traps arm instantly and their burst radius grows by 0.3 per rank.' }),
  n('r_blast_traps', 'wilds', 'Blast Traps', 1, 2, { prereqs: [{ node: 'r_snare_trap', rank: 1 }], excludes: ['r_venom_snare'], mechanics: ['blast_traps'],
    description: 'Choice: trap bursts deal x2 damage in a x1.4 radius and knock enemies back 1.2 units instead of Snaring.' }),
  n('r_venom_snare', 'wilds', 'Venom Snare', 1, 2, { prereqs: [{ node: 'r_snare_trap', rank: 1 }], excludes: ['r_blast_traps'], mechanics: ['venom_snare'],
    description: 'Choice: trap Snares last 2.5s and leave a toxic cloud (radius 2, 4s) dealing 0.35x poison damage every 0.5s.' }),
  n('r_trap_volley', 'wilds', 'Trap Volley', 1, 2, { prereqs: [{ node: 'r_snare_trap', rank: 1 }], excludes: ['r_bait'], grantsSkill: 'r_trap_volley',
    description: 'Evolve Snare Trap into Trap Volley (25 Focus, 8s): toss 3 traps in a fan (25 degrees apart); up to 6 traps at once. Trap upgrades apply.' }),
  n('r_bait', 'wilds', "Hunter's Bait", 1, 2, { prereqs: [{ node: 'r_snare_trap', rank: 1 }], excludes: ['r_trap_volley'], grantsSkill: 'r_bait',
    description: "Evolve Snare Trap into Hunter's Bait (25 Focus, 10s): throw bait to the aimed point (up to 8 units). Non-boss enemies within 6 units are lured to it for 2.5s, then it springs a trap burst (radius 2.2). Trap upgrades apply." }),
  n('r_hawk_companion', 'wilds', 'Hawk Companion', 1, 2, { mechanics: ['hawk_companion'],
    description: 'A hawk companion circles you and every 2s dives at your Marked enemy (or the nearest enemy within 7 units) for 1.2x physical damage.' }),
  n('r_poison_tips', 'wilds', 'Poison Tips', 1, 3, { mechanics: ['poison_tips'],
    description: 'Quick Shots, Volley arrows, Tumble Shots and hawk dives poison: 20% of their hit damage per second as poison (decay) damage for 4s.' }),
  n('r_twin_hawks', 'wilds', 'Twin Hawks', 1, 3, { prereqs: [{ node: 'r_hawk_companion', rank: 1 }], mechanics: ['twin_hawks'],
    description: 'A second hawk joins the first, and hawk dives deal x1.25 damage.' }),
  n('r_apex_predator', 'wilds', 'Apex Predator', 1, 4, { prereqs: [{ node: 'r_hawk_companion', rank: 1 }], excludes: ['r_plague_bearer'], mechanics: ['apex_predator'],
    description: 'Keystone: your hawks dive every 0.8s for x1.5 damage and Mark the enemies they strike for 4s.' }),
  n('r_plague_bearer', 'wilds', 'Plague Bearer', 1, 4, { excludes: ['r_apex_predator'], modifiers: [{ stat: 'player.decayDamage', factorPerRank: '1.5' }], mechanics: ['plague_bearer'],
    description: 'Keystone: all your hits poison (15% of hit damage per second for 4s, stacking with Poison Tips), poison damage x1.5, and when a poisoned enemy dies its poison spreads to enemies within 3 units.' }),
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
