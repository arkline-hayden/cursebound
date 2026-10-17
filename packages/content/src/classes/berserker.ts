import type { ClassDef, NodeDef, SkillDef } from '../types';
import { MELEE_PASSIVES, node } from './common';

// Berserker: rage-fuelled dual-axe brute. Kit-wide rules (implemented in simulation/src/classes/berserker.ts):
//  - Rage (there is no resource bar): every basic swing that connects cuts 0.1s from your active skill cooldowns,
//    every enemy struck by an active skill 0.03s (at most 2 per tick), and every 1% of maximum health lost 0.02s.
//    The Avatar of Carnage keeps its own cooldown.
//  - Frenzy: every basic swing that connects grants a stack (max 5, all expire 3s after the last gain). Each stack
//    multiplies attack frequency by x1.05. Exposed to the HUD as vars.ui_frenzy / ui_frenzyMax.
// Branch skill families (evolutions replace the base active in its slot and inherit its tree damage modifiers):
//  Fury: Bloodlust -> Bloodbath | Unchained.  Carnage: Whirlwind -> Bladestorm | Executioner's Cleave.
//  Warcry: Earthshatter Leap -> Intimidating Shout | Cataclysm.

const n = (id: string, branch: string, name: string, rankLimit: number, tier: NodeDef['tier'], opts: Parameters<typeof node>[6]) => node(id, 'berserker', branch, name, rankLimit, tier, opts);

export const SKILLS: SkillDef[] = [
  { id: 'b_chop', classId: 'berserker', name: 'Twin Chop', slot: 'basic', damageType: 'physical', damageCoef: '1.1', cooldownSec: 0, charges: 1,
    shape: { kind: 'arc', range: 2.0, arcDeg: 120 },
    description: `Both axes chop in a 120° arc (2 units): two strikes of 0.55x physical each. Connecting swings cut 0.1s from your active cooldowns and grant a Frenzy stack. ${MELEE_PASSIVES}`,
    compressionSupport: true, icon: 'node:b_chop' },
  { id: 'b_avatar', classId: 'berserker', name: 'Avatar of Carnage', slot: 'signature', damageType: 'physical', damageCoef: '2', cooldownSec: 10, charges: 1,
    shape: { kind: 'circle', radius: 3, selfCentered: true, range: 0 }, knockback: 1.5,
    description: 'A roar deals 2x physical within 3 units and knocks enemies back (bosses take 120 stagger), then you become a towering avatar for 5s; each kill while it lasts adds 0.25s (up to 7s). The avatar deals x1.4 damage and takes x0.8 damage, Twin Chop reaches x1.35 further, every swing also whirls for 0.6x physical within 2.4 units, and Frenzy never drops.',
    compressionSupport: true, icon: 'node:b_avatar' },
  // ---- Fury ----
  { id: 'b_bloodlust', classId: 'berserker', name: 'Bloodlust', slot: 'active', damageType: 'physical', damageCoef: '0', cooldownSec: 7, charges: 1,
    shape: { kind: 'aura', radius: 0, duration: 6 },
    description: 'For 6s you heal for 6% of all damage you deal and your Frenzy stacks never expire. Grants 3 Frenzy stacks at once.',
    compressionSupport: true, icon: 'node:b_bloodlust' },
  { id: 'b_bloodbath', classId: 'berserker', name: 'Bloodbath', slot: 'active', damageType: 'physical', damageCoef: '1.8', cooldownSec: 7.5, charges: 1,
    shape: { kind: 'circle', radius: 2.8, selfCentered: true, range: 0 },
    description: 'A whirling double slash (radius 2.8): 1.8x physical and a bleed (30% of the hit per second for 4s). Heal 3% maximum health per enemy hit (up to 15%), then enter Bloodlust.',
    compressionSupport: true, icon: 'node:b_bloodbath' },
  { id: 'b_unchained', classId: 'berserker', name: 'Unchained', slot: 'active', damageType: 'physical', damageCoef: '0', cooldownSec: 8.5, charges: 1,
    shape: { kind: 'aura', radius: 0, duration: 7 },
    description: 'Break your chains for 7s: Bloodlust (6% lifesteal, Frenzy never expires), your Frenzy cap doubles and every Twin Chop strikes a third time (0.55x). You take x1.2 damage while Unchained.',
    compressionSupport: true, icon: 'node:b_unchained' },
  // ---- Carnage ----
  { id: 'b_whirlwind', classId: 'berserker', name: 'Whirlwind', slot: 'active', damageType: 'physical', damageCoef: '0.45', cooldownSec: 5, charges: 1,
    shape: { kind: 'aura', radius: 2.2, duration: 2.5 },
    description: 'Spin for 2.5s while moving freely: every 0.25s enemies within 2.2 units take 0.45x physical and are dragged 0.15 units toward you. Spinning replaces your basic attack.',
    compressionSupport: true, icon: 'node:b_whirlwind' },
  { id: 'b_bladestorm', classId: 'berserker', name: 'Bladestorm', slot: 'active', damageType: 'physical', damageCoef: '0.45', cooldownSec: 6.5, charges: 1,
    shape: { kind: 'aura', radius: 2.6, duration: 3 },
    description: 'A 3s storm of steel (radius 2.6): every 0.2s enemies inside take 0.45x physical and are dragged 0.15 units inward. Every 0.5s an axe is flung at the nearest enemy beyond the storm (up to 8 units) for 0.8x physical, piercing one enemy.',
    compressionSupport: true, icon: 'node:b_bladestorm' },
  { id: 'b_executioner', classId: 'berserker', name: 'Executioner\'s Cleave', slot: 'active', damageType: 'physical', damageCoef: '3', cooldownSec: 4, charges: 1,
    shape: { kind: 'arc', range: 3.2, arcDeg: 200 },
    description: 'Lunge 2.5 units and bring both axes down in a 200° cleave (3.2 units): 3x physical, x1.5 against enemies bleeding from you. Lone enemies (not dense groups or bosses) left below 15% health are executed.',
    compressionSupport: true, icon: 'node:b_executioner' },
  // ---- Warcry ----
  { id: 'b_leap', classId: 'berserker', name: 'Earthshatter Leap', slot: 'active', damageType: 'physical', damageCoef: '2', cooldownSec: 5, charges: 1,
    shape: { kind: 'circle', radius: 2.4, selfCentered: false, range: 6 }, knockback: 1.5,
    description: 'Leap to the aimed point (1.5 to 6 units, 0.45s, invulnerable while airborne) and slam down: 2x physical within 2.4 units that knocks enemies back 1.5 units (bosses take 60 stagger).',
    compressionSupport: true, icon: 'node:b_leap' },
  { id: 'b_shout', classId: 'berserker', name: 'Intimidating Shout', slot: 'active', damageType: 'physical', damageCoef: '0', cooldownSec: 7, charges: 1,
    shape: { kind: 'aura', radius: 5, duration: 6 }, knockback: 1,
    description: 'A terrifying roar (radius 5): enemies are knocked back 1 unit, flee in fear for 2s and are Vulnerable (x1.2) for 6s (bosses take 80 stagger and the Vulnerable). You and allies within 5 units attack x1.2 faster for 6s. Cuts 0.5s from your active cooldowns.',
    compressionSupport: true, icon: 'node:b_shout' },
  { id: 'b_cataclysm', classId: 'berserker', name: 'Cataclysm', slot: 'active', damageType: 'physical', damageCoef: '1.1', cooldownSec: 5.5, charges: 1,
    shape: { kind: 'circle', radius: 5, selfCentered: false, range: 7 }, knockback: 0.6,
    description: 'Leap to the aimed point (1.5 to 7 units, 0.5s, invulnerable) and split the earth: three quake rings expand 0.25s apart (radius 2.2, 3.6 and 5). Each ring deals 1.1x physical to the enemies it crosses, stuns them for 0.4s and shoves them 0.6 units (bosses take 40 stagger).',
    compressionSupport: true, icon: 'node:b_cataclysm' },
];

export const NODES: NodeDef[] = [
  // ---- Berserker / Fury ----
  n('b_bloodlust', 'fury', 'Bloodlust', 1, 0, { starting: true, grantsSkill: 'b_bloodlust', description: 'Heals 6% of damage dealt for 6s, grants 3 Frenzy, and Frenzy never expires.' }),
  n('b_savagery', 'fury', 'Savagery', 3, 1, { modifiers: [{ stat: 'player.attackFrequency', factorPerRank: '1.05' }], description: 'Raises attack speed ×{value} per rank.' }),
  n('b_red_mist', 'fury', 'Red Mist', 3, 1, { modifiers: [{ stat: 'player.critTendency', factorPerRank: '1.15' }], description: 'Raises critical tendency ×{value} per rank.' }),
  n('b_deep_frenzy', 'fury', 'Deep Frenzy', 2, 1, { mechanics: ['deep_frenzy'], description: 'Raises max Frenzy stacks by 3 per rank (5 → 8 → 11).' }),
  n('b_blood_feast', 'fury', 'Blood Feast', 1, 2, { prereqs: [{ node: 'b_bloodlust', rank: 1 }], excludes: ['b_battle_trance'], mechanics: ['blood_feast'], upgrades: 'b_bloodlust', description: 'Upgrades Bloodlust: lifesteal 6% → 12% while below 50% health.' }),
  n('b_battle_trance', 'fury', 'Battle Trance', 1, 2, { prereqs: [{ node: 'b_bloodlust', rank: 1 }], excludes: ['b_blood_feast'], mechanics: ['battle_trance'], upgrades: 'b_bloodlust', description: 'Upgrades Bloodlust: lasts 6s → 9s, +0.5s per kill (max 15s).' }),
  n('b_bloodbath', 'fury', 'Bloodbath', 1, 2, { prereqs: [{ node: 'b_bloodlust', rank: 1 }], excludes: ['b_unchained'], grantsSkill: 'b_bloodbath', description: 'Whirls for 1.8× physical with a bleed, heals 3% per enemy hit, then enters Bloodlust.' }),
  n('b_unchained', 'fury', 'Unchained', 1, 2, { prereqs: [{ node: 'b_bloodlust', rank: 1 }], excludes: ['b_bloodbath'], grantsSkill: 'b_unchained', description: 'Enters a 7s Bloodlust with double Frenzy cap and a third chop; you take ×1.2 damage.' }),
  n('b_undying', 'fury', 'Undying Rage', 1, 3, { mechanics: ['undying'], description: 'Saves you from a lethal hit every 45s: 4s unkillable at ×1.3 damage, then heals from the damage dealt.' }),
  n('b_death_wish', 'fury', 'Death Wish', 2, 3, { mechanics: ['death_wish'], description: 'Adds up to +30% damage per rank, scaling with your missing health.' }),
  n('b_deathless', 'fury', 'Deathless', 1, 4, { prereqs: [{ node: 'b_bloodlust', rank: 1 }], excludes: ['b_blood_god'], mechanics: ['deathless'], description: 'A hit that would down you leaves you at 1 health and invulnerable for 1s (every 40s).' }),
  n('b_blood_god', 'fury', 'Blood God', 1, 4, { prereqs: [{ node: 'b_bloodlust', rank: 1 }], excludes: ['b_deathless'], mechanics: ['blood_god'], description: 'Raises max Frenzy by 5; each stack gives 1% lifesteal; full stacks make Twin Chop 360°.' }),

  // ---- Berserker / Carnage ----
  n('b_whirlwind', 'carnage', 'Whirlwind', 1, 0, { starting: true, grantsSkill: 'b_whirlwind', description: 'Spins for 2.5s while moving, hitting nearby enemies for 0.45× every 0.25s.' }),
  n('b_honed_axes', 'carnage', 'Honed Axes', 3, 1, { prereqs: [{ node: 'b_whirlwind', rank: 1 }], modifiers: [{ stat: 'skill.b_whirlwind.damage', factorPerRank: '1.12' }], upgrades: 'b_whirlwind', description: 'Upgrades Whirlwind: damage ×{value} per rank, evolutions too.' }),
  n('b_brutality', 'carnage', 'Brutality', 3, 1, { modifiers: [{ stat: 'player.physicalDamage', factorPerRank: '1.08' }], description: 'Raises physical damage ×{value} per rank.' }),
  n('b_rend', 'carnage', 'Rending Axes', 2, 1, { mechanics: ['rend'], description: 'Makes chops and spins bleed for 8% of the hit per rank per second for 4s.' }),
  n('b_maelstrom', 'carnage', 'Maelstrom', 1, 2, { prereqs: [{ node: 'b_whirlwind', rank: 1 }], excludes: ['b_flaying_spin'], mechanics: ['maelstrom'], upgrades: 'b_whirlwind', description: 'Upgrades Whirlwind: reach ×1.25, and pull 0.15 → 0.45 units per hit.' }),
  n('b_flaying_spin', 'carnage', 'Flaying Spin', 1, 2, { prereqs: [{ node: 'b_whirlwind', rank: 1 }], excludes: ['b_maelstrom'], mechanics: ['flaying_spin'], upgrades: 'b_whirlwind', description: 'Upgrades Whirlwind: hits add a bleed of 15% per second, and kills burst for 0.8× physical.' }),
  n('b_bladestorm', 'carnage', 'Bladestorm', 1, 2, { prereqs: [{ node: 'b_whirlwind', rank: 1 }], excludes: ['b_executioner'], grantsSkill: 'b_bladestorm', description: 'Spins for 3s and flings axes (0.8×) at enemies outside the storm.' }),
  n('b_executioner', 'carnage', 'Executioner\'s Cleave', 1, 2, { prereqs: [{ node: 'b_whirlwind', rank: 1 }], excludes: ['b_bladestorm'], grantsSkill: 'b_executioner', description: 'Lunges into a 3× cleave, ×1.5 on bleeding enemies, executing enemies under 15%.' }),
  n('b_widening_gyre', 'carnage', 'Widening Gyre', 2, 3, { modifiers: [{ stat: 'skill.b_whirlwind.radius', factorPerRank: '1.1' }, { stat: 'skill.b_chop.radius', factorPerRank: '1.1' }], description: 'Extends Whirlwind (evolutions too) and Twin Chop reach ×1.1 per rank; rank 2 widens Twin Chop to 180°.' }),
  n('b_hemorrhage', 'carnage', 'Hemorrhage', 1, 3, { mechanics: ['hemorrhage'], description: 'Makes your hits deal ×1.25 damage to enemies bleeding from you.' }),
  n('b_endless_storm', 'carnage', 'Endless Storm', 1, 4, { prereqs: [{ node: 'b_whirlwind', rank: 1 }], excludes: ['b_red_harvest'], mechanics: ['endless_storm'], description: 'Hold to keep Whirlwind spinning (up to 10s); the extra time adds to its cooldown.' }),
  n('b_red_harvest', 'carnage', 'Red Harvest', 1, 4, { prereqs: [{ node: 'b_whirlwind', rank: 1 }], excludes: ['b_endless_storm'], mechanics: ['red_harvest'], description: 'Enemies bleeding from you burst on death for 0.5× plus their remaining bleed, cutting 0.15s off actives.' }),

  // ---- Berserker / Warcry ----
  n('b_leap', 'warcry', 'Earthshatter Leap', 1, 0, { starting: true, grantsSkill: 'b_leap', description: 'Leaps up to 6 units and slams for 2× physical in radius 2.4, knocking enemies back.' }),
  n('b_heavy_landing', 'warcry', 'Heavy Landing', 3, 1, { prereqs: [{ node: 'b_leap', rank: 1 }], modifiers: [{ stat: 'skill.b_leap.damage', factorPerRank: '1.12' }], upgrades: 'b_leap', description: 'Upgrades Earthshatter Leap: damage ×{value} per rank, evolutions too.' }),
  n('b_iron_hide', 'warcry', 'Iron Hide', 3, 1, { modifiers: [{ stat: 'player.armor', factorPerRank: '1.12' }], description: 'Raises armor ×{value} per rank.' }),
  n('b_aftershock', 'warcry', 'Aftershock', 2, 1, { prereqs: [{ node: 'b_leap', rank: 1 }], mechanics: ['aftershock'], upgrades: 'b_leap', description: 'Upgrades Earthshatter Leap: an aftershock 0.5s later for 0.8× per rank (radius 3.2).' }),
  n('b_meteor', 'warcry', 'Meteor Leap', 1, 2, { prereqs: [{ node: 'b_leap', rank: 1 }], excludes: ['b_bounding'], mechanics: ['meteor'], upgrades: 'b_leap', description: 'Upgrades Earthshatter Leap: +3 range and ×1.25 landing radius, but 0.15s more airtime.' }),
  n('b_bounding', 'warcry', 'Bounding Fury', 1, 2, { prereqs: [{ node: 'b_leap', rank: 1 }], excludes: ['b_meteor'], mechanics: ['bounding'], upgrades: 'b_leap', description: 'Upgrades Earthshatter Leap: 2 charges; a second leap within 3s lands for ×1.3 damage.' }),
  n('b_shout', 'warcry', 'Intimidating Shout', 1, 2, { prereqs: [{ node: 'b_leap', rank: 1 }], excludes: ['b_cataclysm'], grantsSkill: 'b_shout', description: 'Roars: enemies within 5 units are feared and Vulnerable (×1.2), and allies attack ×1.2 faster.' }),
  n('b_cataclysm', 'warcry', 'Cataclysm', 1, 2, { prereqs: [{ node: 'b_leap', rank: 1 }], excludes: ['b_shout'], grantsSkill: 'b_cataclysm', description: 'Leaps up to 7 units and sends 3 quake rings out, each 1.1× with a 0.4s stun.' }),
  n('b_blood_brothers', 'warcry', 'Blood Brothers', 1, 3, { mechanics: ['blood_brothers'], description: 'Warcry skills heal you and allies within 5 units 6% and cut 0.5s off their cooldowns.' }),
  n('b_concussive', 'warcry', 'Concussive Force', 2, 3, { prereqs: [{ node: 'b_leap', rank: 1 }], mechanics: ['concussive'], upgrades: 'b_leap', description: 'Upgrades Earthshatter Leap: enemies knocked into walls take 1× per rank and are stunned, evolutions too.' }),
  n('b_tectonic', 'warcry', 'Tectonic Rage', 1, 4, { prereqs: [{ node: 'b_leap', rank: 1 }], excludes: ['b_warmonger'], mechanics: ['tectonic'], upgrades: 'b_leap', description: 'Upgrades Earthshatter Leap: a 4s fissure erupts for 0.4× every 0.5s (Vulnerable ×1.15), evolutions too.' }),
  n('b_warmonger', 'warcry', 'Warmonger', 1, 4, { prereqs: [{ node: 'b_leap', rank: 1 }], excludes: ['b_tectonic'], mechanics: ['warmonger'], description: 'Each hit of your Warcry skill cuts 0.4s off it (max 4s) and 0.1s off other actives (max 1s).' }),
];

export const CLASS: ClassDef = {
  id: 'berserker', name: 'Berserker', tagline: 'Two axes, no retreat. Pain becomes rage, and rage becomes carnage.',
  branches: [
    { id: 'fury', name: 'Fury', theme: 'Frenzy, lifesteal and refusing to die' },
    { id: 'carnage', name: 'Carnage', theme: 'Whirlwinds, cleaves and bleeding' },
    { id: 'warcry', name: 'Warcry', theme: 'Leaps, quakes and terror' },
  ],
  accent: '#b3261e', role: 'Melee bruiser · rage',
  base: { maxHealth: 960, armor: 20, damage: 97, attackFrequency: 2.1, moveSpeed: 4.8, critTendency: '0.3', critMultiplier: '2', shieldCapacity: 0.5 },
  melee: true, basicSkill: 'b_chop', signatureSkill: 'b_avatar',
  nodes: NODES.map((x) => x.id),
};
