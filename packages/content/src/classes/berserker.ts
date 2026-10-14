import type { ClassDef, NodeDef, SkillDef } from '../types';
import { MELEE_PASSIVES, node } from './common';

// Berserker: rage-fuelled dual-axe brute. Kit-wide rules (implemented in simulation/src/classes/berserker.ts):
//  - Fury (0..100) does not regenerate. +5 per basic swing that connects, +1 per enemy struck by an active skill
//    (at most +2 per tick), +1 per 1% of maximum health lost. After 3s without dealing or taking damage it decays
//    at 10 per second. Every Fury gain scales with Fury generation and Player resource regeneration factors.
//    Fury starts each round at 0.
//  - Frenzy: every basic swing that connects grants a stack (max 5, all expire 3s after the last gain). Each stack
//    multiplies attack frequency by x1.05. Exposed to the HUD as vars.ui_frenzy / ui_frenzyMax.
// Branch skill families (evolutions replace the base active in its slot and inherit its tree damage modifiers):
//  Fury: Bloodlust -> Bloodbath | Unchained.  Carnage: Whirlwind -> Bladestorm | Executioner's Cleave.
//  Warcry: Earthshatter Leap -> Intimidating Shout | Cataclysm.

const n = (id: string, branch: string, name: string, rankLimit: number, tier: NodeDef['tier'], opts: Parameters<typeof node>[6]) => node(id, 'berserker', branch, name, rankLimit, tier, opts);

export const SKILLS: SkillDef[] = [
  { id: 'b_chop', classId: 'berserker', name: 'Twin Chop', slot: 'basic', damageType: 'physical', damageCoef: '1.1', resourceCost: 0, cooldownSec: 0, charges: 1,
    shape: { kind: 'arc', range: 2.0, arcDeg: 120 },
    description: `Both axes chop in a 120° arc (2 units): two strikes of 0.55x physical each. Connecting swings grant 5 Fury and a Frenzy stack. ${MELEE_PASSIVES}`,
    compressionSupport: true, icon: 'node:b_chop' },
  { id: 'b_avatar', classId: 'berserker', name: 'Avatar of Carnage', slot: 'signature', damageType: 'physical', damageCoef: '2', resourceCost: 35, cooldownSec: 14, charges: 1,
    shape: { kind: 'circle', radius: 3, selfCentered: true, range: 0 }, knockback: 1.5,
    description: 'Consume all your Fury (at least 35): a roar deals 2x physical within 3 units and hurls enemies back (bosses take 120 stagger), then you become the Avatar for 4s + 0.04s per Fury consumed (8s at 100, up to 10s). The Avatar is huge: x1.4 damage, x0.8 damage taken, Twin Chop reaches x1.35 further, every swing also whirls for 0.6x physical within 2.4 units, and Fury and Frenzy never decay.',
    compressionSupport: true, icon: 'node:b_avatar' },
  // ---- Fury ----
  { id: 'b_bloodlust', classId: 'berserker', name: 'Bloodlust', slot: 'active', damageType: 'physical', damageCoef: '0', resourceCost: 20, cooldownSec: 10, charges: 1,
    shape: { kind: 'aura', radius: 0, duration: 6 },
    description: 'For 6s you heal for 6% of all damage you deal and your Frenzy stacks never expire. Grants 3 Frenzy stacks at once.',
    compressionSupport: true, icon: 'node:b_bloodlust' },
  { id: 'b_bloodbath', classId: 'berserker', name: 'Bloodbath', slot: 'active', damageType: 'physical', damageCoef: '1.8', resourceCost: 25, cooldownSec: 11, charges: 1,
    shape: { kind: 'circle', radius: 2.8, selfCentered: true, range: 0 },
    description: 'A whirling double slash (radius 2.8): 1.8x physical and Rend (30% of the hit per second for 4s). Heal 3% maximum health per enemy hit (up to 15%), then enter Bloodlust.',
    compressionSupport: true, icon: 'node:b_bloodbath' },
  { id: 'b_unchained', classId: 'berserker', name: 'Unchained', slot: 'active', damageType: 'physical', damageCoef: '0', resourceCost: 20, cooldownSec: 12, charges: 1,
    shape: { kind: 'aura', radius: 0, duration: 7 },
    description: 'Break your chains for 7s: Bloodlust (6% lifesteal, Frenzy never expires), your Frenzy cap doubles and every Twin Chop strikes a third time (0.55x). You take x1.2 damage while Unchained.',
    compressionSupport: true, icon: 'node:b_unchained' },
  // ---- Carnage ----
  { id: 'b_whirlwind', classId: 'berserker', name: 'Whirlwind', slot: 'active', damageType: 'physical', damageCoef: '0.45', resourceCost: 25, cooldownSec: 7, charges: 1,
    shape: { kind: 'aura', radius: 2.2, duration: 2.5 },
    description: 'Spin for 2.5s while moving freely: every 0.25s enemies within 2.2 units take 0.45x physical and are dragged 0.15 units toward you. Spinning replaces your basic attack.',
    compressionSupport: true, icon: 'node:b_whirlwind' },
  { id: 'b_bladestorm', classId: 'berserker', name: 'Bladestorm', slot: 'active', damageType: 'physical', damageCoef: '0.45', resourceCost: 30, cooldownSec: 9, charges: 1,
    shape: { kind: 'aura', radius: 2.6, duration: 3 },
    description: 'A 3s storm of steel (radius 2.6): every 0.2s enemies inside take 0.45x physical and are dragged 0.15 units inward. Every 0.5s an axe is flung at the nearest enemy beyond the storm (up to 8 units) for 0.8x physical, piercing one enemy.',
    compressionSupport: true, icon: 'node:b_bladestorm' },
  { id: 'b_executioner', classId: 'berserker', name: 'Executioner\'s Cleave', slot: 'active', damageType: 'physical', damageCoef: '3', resourceCost: 25, cooldownSec: 6, charges: 1,
    shape: { kind: 'arc', range: 3.2, arcDeg: 200 },
    description: 'Lunge 2.5 units and bring both axes down in a 200° cleave (3.2 units): 3x physical, x1.5 against enemies bleeding from your Rend. Single enemies (not cohorts or bosses) left below 15% health are executed.',
    compressionSupport: true, icon: 'node:b_executioner' },
  // ---- Warcry ----
  { id: 'b_leap', classId: 'berserker', name: 'Earthshatter Leap', slot: 'active', damageType: 'physical', damageCoef: '2', resourceCost: 20, cooldownSec: 7, charges: 1,
    shape: { kind: 'circle', radius: 2.4, selfCentered: false, range: 6 }, knockback: 1.5,
    description: 'Leap to the aimed point (1.5 to 6 units, 0.45s, untargetable while airborne) and slam down: 2x physical within 2.4 units, enemies are hurled 1.5 units back (bosses take 60 stagger).',
    compressionSupport: true, icon: 'node:b_leap' },
  { id: 'b_shout', classId: 'berserker', name: 'Intimidating Shout', slot: 'active', damageType: 'physical', damageCoef: '0', resourceCost: 20, cooldownSec: 10, charges: 1,
    shape: { kind: 'aura', radius: 5, duration: 6 }, knockback: 1,
    description: 'A terrifying roar (radius 5): enemies are knocked back 1 unit, flee in fear for 2s and are Weakened for 6s (x1.2 damage taken; bosses take 80 stagger and the Weaken). You and allies within 5 units gain Battle Cry for 6s: attack frequency x1.2. Gain 15 Fury.',
    compressionSupport: true, icon: 'node:b_shout' },
  { id: 'b_cataclysm', classId: 'berserker', name: 'Cataclysm', slot: 'active', damageType: 'physical', damageCoef: '1.1', resourceCost: 25, cooldownSec: 8, charges: 1,
    shape: { kind: 'circle', radius: 5, selfCentered: false, range: 7 }, knockback: 0.6,
    description: 'Leap to the aimed point (1.5 to 7 units, 0.5s, untargetable) and split the earth: three quake rings expand 0.25s apart (radius 2.2, 3.6 and 5). Each ring deals 1.1x physical to the enemies it crosses, stuns them for 0.4s and shoves them 0.6 units (bosses take 40 stagger).',
    compressionSupport: true, icon: 'node:b_cataclysm' },
];

export const NODES: NodeDef[] = [
  // ---- Berserker / Fury ----
  n('b_bloodlust', 'fury', 'Bloodlust', 1, 0, { grantsSkill: 'b_bloodlust', description: 'Equip Bloodlust (20 Fury, 10s): for 6s heal for 6% of all damage you deal, Frenzy never expires, and gain 3 Frenzy stacks.' }),
  n('b_savagery', 'fury', 'Savagery', 3, 1, { modifiers: [{ stat: 'player.attackFrequency', factorPerRank: '1.05' }], description: 'Attack frequency x1.05 per rank.' }),
  n('b_red_mist', 'fury', 'Red Mist', 3, 1, { modifiers: [{ stat: 'player.critTendency', factorPerRank: '1.15' }], description: 'Critical tendency x1.15 per rank.' }),
  n('b_deep_frenzy', 'fury', 'Deep Frenzy', 2, 1, { mechanics: ['deep_frenzy'], description: 'Maximum Frenzy stacks +3 per rank (5 -> 8 -> 11).' }),
  n('b_blood_feast', 'fury', 'Blood Feast', 1, 2, { prereqs: [{ node: 'b_bloodlust', rank: 1 }], excludes: ['b_battle_trance'], mechanics: ['blood_feast'], description: 'Choice: Bloodlust lifesteal is doubled (12%) while you are below 50% health.' }),
  n('b_battle_trance', 'fury', 'Battle Trance', 1, 2, { prereqs: [{ node: 'b_bloodlust', rank: 1 }], excludes: ['b_blood_feast'], mechanics: ['battle_trance'], description: 'Choice: Bloodlust lasts 9s instead of 6s, and each kill while it lasts extends it by 0.5s (up to 15s in total).' }),
  n('b_bloodbath', 'fury', 'Bloodbath', 1, 2, { prereqs: [{ node: 'b_bloodlust', rank: 1 }], excludes: ['b_unchained'], grantsSkill: 'b_bloodbath', description: 'Evolution: Bloodlust becomes Bloodbath (25 Fury, 11s): a 2.8 unit whirling slash for 1.8x physical with Rend (30% per second, 4s) that heals 3% maximum health per enemy hit (up to 15%), then grants Bloodlust.' }),
  n('b_unchained', 'fury', 'Unchained', 1, 2, { prereqs: [{ node: 'b_bloodlust', rank: 1 }], excludes: ['b_bloodbath'], grantsSkill: 'b_unchained', description: 'Evolution: Bloodlust becomes Unchained (20 Fury, 12s): 7s of Bloodlust with a doubled Frenzy cap and a third Twin Chop strike, at the price of x1.2 damage taken.' }),
  n('b_undying', 'fury', 'Undying Rage', 1, 3, { mechanics: ['undying'], description: 'Once every 45s, a lethal hit leaves you at 1 health and you become Undying for 4s: you cannot drop below 1 health and deal x1.3 damage. When it ends you heal 40% of the damage you dealt while Undying (up to 60% maximum health).' }),
  n('b_death_wish', 'fury', 'Death Wish', 2, 3, { mechanics: ['death_wish'], description: 'Your damage is multiplied by 1 + 0.3 per rank x your missing health fraction (x1.48 at 20% health with 2 ranks).' }),
  n('b_deathless', 'fury', 'Deathless', 1, 4, { prereqs: [{ node: 'b_bloodlust', rank: 1 }], excludes: ['b_blood_god'], mechanics: ['deathless'], description: 'Keystone: whenever a hit would down you while you hold 50 Fury, it instead consumes 50 Fury and leaves you at 1 health, invulnerable for 1s.' }),
  n('b_blood_god', 'fury', 'Blood God', 1, 4, { prereqs: [{ node: 'b_bloodlust', rank: 1 }], excludes: ['b_deathless'], mechanics: ['blood_god'], description: 'Keystone: maximum Frenzy +5. Each Frenzy stack grants 1% lifesteal on all your damage, and at maximum stacks Twin Chop sweeps all around you (360°).' }),

  // ---- Berserker / Carnage ----
  n('b_whirlwind', 'carnage', 'Whirlwind', 1, 0, { grantsSkill: 'b_whirlwind', description: 'Equip Whirlwind (25 Fury, 7s): spin for 2.5s while moving; every 0.25s enemies within 2.2 units take 0.45x physical and are dragged toward you.' }),
  n('b_honed_axes', 'carnage', 'Honed Axes', 3, 1, { prereqs: [{ node: 'b_whirlwind', rank: 1 }], modifiers: [{ stat: 'skill.b_whirlwind.damage', factorPerRank: '1.12' }], description: 'Whirlwind damage x1.12 per rank. Also applies to Bladestorm (spin and axes) and Executioner\'s Cleave.' }),
  n('b_brutality', 'carnage', 'Brutality', 3, 1, { modifiers: [{ stat: 'player.physicalDamage', factorPerRank: '1.08' }], description: 'Physical damage x1.08 per rank.' }),
  n('b_rend', 'carnage', 'Rend', 2, 1, { mechanics: ['rend'], description: 'Twin Chop, Whirlwind and Bladestorm hits Rend enemies: they bleed for 8% of the hit per second per rank for 4s (stacking). Rend scales with Bleed damage.' }),
  n('b_maelstrom', 'carnage', 'Maelstrom', 1, 2, { prereqs: [{ node: 'b_whirlwind', rank: 1 }], excludes: ['b_flaying_spin'], mechanics: ['maelstrom'], description: 'Choice: Whirlwind and Bladestorm reach x1.25 further and drag enemies 0.45 units per hit instead of 0.15.' }),
  n('b_flaying_spin', 'carnage', 'Flaying Spin', 1, 2, { prereqs: [{ node: 'b_whirlwind', rank: 1 }], excludes: ['b_maelstrom'], mechanics: ['flaying_spin'], description: 'Choice: Whirlwind and Bladestorm hits add a Rend of 15% per second for 4s, and enemies that die while you spin burst for 0.8x physical within 1.6 units.' }),
  n('b_bladestorm', 'carnage', 'Bladestorm', 1, 2, { prereqs: [{ node: 'b_whirlwind', rank: 1 }], excludes: ['b_executioner'], grantsSkill: 'b_bladestorm', description: 'Evolution: Whirlwind becomes Bladestorm (30 Fury, 9s): a 3s, 2.6 unit spin hitting every 0.2s for 0.45x physical that also flings an axe (0.8x physical) at the nearest enemy beyond the storm every 0.5s.' }),
  n('b_executioner', 'carnage', 'Executioner\'s Cleave', 1, 2, { prereqs: [{ node: 'b_whirlwind', rank: 1 }], excludes: ['b_bladestorm'], grantsSkill: 'b_executioner', description: 'Evolution: Whirlwind becomes Executioner\'s Cleave (25 Fury, 6s): lunge 2.5 units into a 200° cleave (3.2 units) for 3x physical, x1.5 against Rended enemies; single non-boss enemies left below 15% health are executed.' }),
  n('b_widening_gyre', 'carnage', 'Widening Gyre', 2, 3, { modifiers: [{ stat: 'skill.b_whirlwind.radius', factorPerRank: '1.1' }, { stat: 'skill.b_chop.radius', factorPerRank: '1.1' }], description: 'Whirlwind (and its evolutions) and Twin Chop reach x1.1 further per rank. At rank 2 Twin Chop sweeps 180° instead of 120°.' }),
  n('b_hemorrhage', 'carnage', 'Hemorrhage', 1, 3, { mechanics: ['hemorrhage'], description: 'Your hits deal x1.25 damage to enemies bleeding from your Rend.' }),
  n('b_endless_storm', 'carnage', 'Endless Storm', 1, 4, { prereqs: [{ node: 'b_whirlwind', rank: 1 }], excludes: ['b_red_harvest'], mechanics: ['endless_storm'], description: 'Keystone: Whirlwind and Bladestorm keep spinning while you hold their key after the normal duration, draining 12 Fury per second, up to 10s in total.' }),
  n('b_red_harvest', 'carnage', 'Red Harvest', 1, 4, { prereqs: [{ node: 'b_whirlwind', rank: 1 }], excludes: ['b_endless_storm'], mechanics: ['red_harvest'], description: 'Keystone: enemies that die while bleeding from your Rend burst, dealing 0.5x physical plus 100% of their remaining Rend damage to enemies within 2 units, and grant 3 Fury.' }),

  // ---- Berserker / Warcry ----
  n('b_leap', 'warcry', 'Earthshatter Leap', 1, 0, { grantsSkill: 'b_leap', description: 'Equip Earthshatter Leap (20 Fury, 7s): leap up to 6 units, untargetable in the air, and slam down for 2x physical within 2.4 units, hurling enemies back.' }),
  n('b_heavy_landing', 'warcry', 'Heavy Landing', 3, 1, { prereqs: [{ node: 'b_leap', rank: 1 }], modifiers: [{ stat: 'skill.b_leap.damage', factorPerRank: '1.12' }], description: 'Earthshatter Leap damage x1.12 per rank. Also applies to Cataclysm, aftershocks and fissures.' }),
  n('b_iron_hide', 'warcry', 'Iron Hide', 3, 1, { modifiers: [{ stat: 'player.armor', factorPerRank: '1.12' }], description: 'Armor x1.12 per rank.' }),
  n('b_aftershock', 'warcry', 'Aftershock', 2, 1, { prereqs: [{ node: 'b_leap', rank: 1 }], mechanics: ['aftershock'], description: 'Leap and Cataclysm landings trigger an aftershock 0.5s later: 0.8x physical per rank within 3.2 units.' }),
  n('b_meteor', 'warcry', 'Meteor Leap', 1, 2, { prereqs: [{ node: 'b_leap', rank: 1 }], excludes: ['b_bounding'], mechanics: ['meteor'], description: 'Choice: your leaps reach 3 units further and their landing radius is x1.25, but you stay airborne 0.15s longer.' }),
  n('b_bounding', 'warcry', 'Bounding Fury', 1, 2, { prereqs: [{ node: 'b_leap', rank: 1 }], excludes: ['b_meteor'], mechanics: ['bounding'], description: 'Choice: Earthshatter Leap and Cataclysm hold 2 charges, and a leap within 3s of the previous one costs no Fury.' }),
  n('b_shout', 'warcry', 'Intimidating Shout', 1, 2, { prereqs: [{ node: 'b_leap', rank: 1 }], excludes: ['b_cataclysm'], grantsSkill: 'b_shout', description: 'Evolution: Earthshatter Leap becomes Intimidating Shout (20 Fury, 10s): enemies within 5 units are knocked back, flee in fear for 2s and take x1.2 damage for 6s; you and allies nearby gain x1.2 attack frequency for 6s.' }),
  n('b_cataclysm', 'warcry', 'Cataclysm', 1, 2, { prereqs: [{ node: 'b_leap', rank: 1 }], excludes: ['b_shout'], grantsSkill: 'b_cataclysm', description: 'Evolution: Earthshatter Leap becomes Cataclysm (25 Fury, 8s): leap up to 7 units and send three quake rings (radius 2.2, 3.6, 5) through the ground, each 1.1x physical with a 0.4s stun.' }),
  n('b_blood_brothers', 'warcry', 'Blood Brothers', 1, 3, { mechanics: ['blood_brothers'], description: 'Your Warcry skills heal you and allies within 5 units for 6% maximum health; allies gain 12 resource and you gain 12 Fury.' }),
  n('b_concussive', 'warcry', 'Concussive Force', 2, 3, { mechanics: ['concussive'], description: 'Enemies your Warcry skills knock into a wall take 1x physical per rank and are stunned for 1s.' }),
  n('b_tectonic', 'warcry', 'Tectonic Rage', 1, 4, { prereqs: [{ node: 'b_leap', rank: 1 }], excludes: ['b_warmonger'], mechanics: ['tectonic'], description: 'Keystone: every Warcry skill tears open a fissure (radius 2.6, 4s) where it lands: every 0.5s it erupts for 0.4x physical and enemies it hits take x1.15 damage for 1s.' }),
  n('b_warmonger', 'warcry', 'Warmonger', 1, 4, { prereqs: [{ node: 'b_leap', rank: 1 }], excludes: ['b_tectonic'], mechanics: ['warmonger'], description: 'Keystone: each enemy hit by a Warcry skill cuts 0.4s from its cooldown (up to 4s per cast) and grants 3 Fury (up to 15 per cast).' }),
];

export const CLASS: ClassDef = {
  id: 'berserker', name: 'Berserker', tagline: 'Two axes, no retreat. Pain becomes Fury, and Fury becomes carnage.',
  branches: [
    { id: 'fury', name: 'Fury', theme: 'Frenzy, lifesteal and refusing to die' },
    { id: 'carnage', name: 'Carnage', theme: 'Whirlwinds, cleaves and bleeding' },
    { id: 'warcry', name: 'Warcry', theme: 'Leaps, quakes and terror' },
  ],
  accent: '#b3261e', role: 'Melee bruiser · rage',
  resource: { name: 'Fury', max: 100, regenPerSec: 0 },
  base: { maxHealth: 960, armor: 20, damage: 92, attackFrequency: 2.1, moveSpeed: 4.8, critTendency: '0.3', critMultiplier: '2', shieldCapacity: 0.5 },
  melee: true, basicSkill: 'b_chop', signatureSkill: 'b_avatar',
  nodes: NODES.map((x) => x.id),
};
