import type { ClassDef, NodeDef, SkillDef } from '../types';
import { MELEE_PASSIVES, node } from './common';

// Duelist: lightning-fast melee assassin. Crits, bleeds, blinks, parries and a combo meter.
// Kit-wide rules (implemented in simulation/src/classes/duelist.ts):
//  - Backstab: hits landing from behind an enemy (opposite its facing) deal x1.25.
//  - Momentum: every connecting basic swing restores 2 Momentum, +2 more if it crits.
//  - Combo (0..20): +1 per connecting basic swing, +2 per skill cast that hits (+1 per Crimson Whirl spin or Phantom
//    Rush blink), +3 per parry. Lost after 2s without
//    connecting; a hit that deals 5%+ of maximum health halves it. Exposed to the HUD as vars.ui_combo / ui_comboMax.
// Branch skill families (evolutions replace the base active in its slot and inherit its tree modifiers):
//  Edge: Rend -> Crimson Whirl | Execution.  Shadow: Shadowstep -> Phantom Rush | Death Mark.
//  Tempo: Riposte -> Mirror Guard | Hundred Fangs.

const n = (id: string, branch: string, name: string, rankLimit: number, tier: NodeDef['tier'], opts: Parameters<typeof node>[6]) => node(id, 'duelist', branch, name, rankLimit, tier, opts);

const BLEED = { type: 'physical' as const, fractionPerSec: '0.3', durationSec: 4 };

export const SKILLS: SkillDef[] = [
  { id: 'd_twin_fangs', classId: 'duelist', name: 'Twin Fangs', slot: 'basic', damageType: 'physical', damageCoef: '0.85', resourceCost: 0, cooldownSec: 0, charges: 1,
    shape: { kind: 'arc', range: 1.9, arcDeg: 90 },
    description: `A fast twin-blade flurry in a 90° arc (range 1.9). Every 4th connecting swing is a Fang Finisher: 110° arc, range 2.3, x2 damage. Connecting swings restore 2 Momentum (+2 on a crit) and build Combo. Hits from behind an enemy deal x1.25. Keen Edge: a swing that lands a critical hit heals 0.8% of maximum health. ${MELEE_PASSIVES}`,
    compressionSupport: true, icon: 'node:d_twin_fangs' },
  { id: 'd_thousand_cuts', classId: 'duelist', name: 'Thousand Cuts', slot: 'signature', damageType: 'physical', damageCoef: '0.8', resourceCost: 35, cooldownSec: 12, charges: 1,
    shape: { kind: 'circle', radius: 5, selfCentered: true, range: 0 }, knockback: 1,
    description: 'Vanish into 5 blinks, 0.08s apart, each cutting through to the nearest unstruck enemy within 5 units: every enemy along the path takes 0.8x damage. End in a crimson burst (radius 2.4) for 2.2x that knocks enemies back 1. Invulnerable throughout. Builds boss stagger.',
    compressionSupport: true, icon: 'node:d_thousand_cuts' },
  // ---- Edge family ----
  { id: 'd_rend', classId: 'duelist', name: 'Rend', slot: 'active', damageType: 'physical', damageCoef: '1.7', resourceCost: 16, cooldownSec: 4, charges: 1,
    shape: { kind: 'arc', range: 2.2, arcDeg: 100 }, dot: BLEED,
    description: 'An X-slash in a 100° cone (range 2.2) for 1.7x damage. Enemies hit bleed for 30% of the hit per second for 4s.', compressionSupport: true, icon: 'node:d_rend' },
  { id: 'd_crimson_whirl', classId: 'duelist', name: 'Crimson Whirl', slot: 'active', damageType: 'physical', damageCoef: '0.9', resourceCost: 22, cooldownSec: 6, charges: 1,
    shape: { kind: 'circle', radius: 2.4, selfCentered: true, range: 0 }, dot: BLEED,
    description: 'Spin 3 times over 0.5s; each spin slashes everything within 2.4 units for 0.9x damage and applies Rend\'s bleed (30% per second for 4s).', compressionSupport: true, icon: 'node:d_crimson_whirl' },
  { id: 'd_execution', classId: 'duelist', name: 'Execution', slot: 'active', damageType: 'physical', damageCoef: '3.6', resourceCost: 20, cooldownSec: 5, charges: 1,
    shape: { kind: 'line', length: 3, width: 0.9, duration: 0, tickInterval: 1 }, dot: BLEED,
    description: 'Lunge up to 3 units along your aim and run the first enemy through for 3.6x damage (x2 against targets below 35% health), applying Rend\'s bleed. A kill refunds the cooldown and 15 Momentum.', compressionSupport: true, icon: 'node:d_execution' },
  // ---- Shadow family ----
  { id: 'd_shadowstep', classId: 'duelist', name: 'Shadowstep', slot: 'active', damageType: 'physical', damageCoef: '2', resourceCost: 18, cooldownSec: 5, charges: 1,
    shape: { kind: 'teleport', range: 6 },
    description: 'Blink up to 6 units to appear behind the enemy nearest your aim and strike everything within 1.4 units for 2x damage. 0.2s invulnerable on arrival.', compressionSupport: true, icon: 'node:d_shadowstep' },
  { id: 'd_phantom_rush', classId: 'duelist', name: 'Phantom Rush', slot: 'active', damageType: 'physical', damageCoef: '1.4', resourceCost: 25, cooldownSec: 7, charges: 1,
    shape: { kind: 'teleport', range: 6 },
    description: 'Blink between up to 4 different enemies within 6 units, 0.1s apart, striking each and everything within 1.2 units of it for 1.4x damage. Invulnerable for the whole rush.', compressionSupport: true, icon: 'node:d_phantom_rush' },
  { id: 'd_death_mark', classId: 'duelist', name: 'Death Mark', slot: 'active', damageType: 'physical', damageCoef: '2.4', resourceCost: 22, cooldownSec: 8, charges: 1,
    shape: { kind: 'teleport', range: 6 },
    description: 'Blink behind the enemy nearest your aim, strike it for 2.4x damage and mark it for 2.5s. The mark then detonates within 1.8 units for 2x damage plus 40% of all damage you dealt the target while it was marked.', compressionSupport: true, icon: 'node:d_death_mark' },
  // ---- Tempo family ----
  { id: 'd_riposte', classId: 'duelist', name: 'Riposte', slot: 'active', damageType: 'physical', damageCoef: '2.6', resourceCost: 15, cooldownSec: 6, charges: 1,
    shape: { kind: 'guard', duration: 0.5, arcDeg: 360 },
    description: 'A 0.5s parry stance (invulnerable). The first threat is parried: enemy projectiles within 1.3 units are reflected for 1.3x damage, or a melee attacker winding up within reach is countered with a thrust for 2.6x damage that stuns it for 1s (bosses: +60 stagger). Parries grant 20 Momentum and 3 Combo. An unused stance ends in a 1.3x thrust.',
    compressionSupport: true, icon: 'node:d_riposte' },
  { id: 'd_mirror_guard', classId: 'duelist', name: 'Mirror Guard', slot: 'active', damageType: 'physical', damageCoef: '2.6', resourceCost: 18, cooldownSec: 7, charges: 1,
    shape: { kind: 'guard', duration: 0.9, arcDeg: 360 },
    description: 'A 0.9s parry stance (invulnerable) that parries every threat: each melee attacker is countered (2.6x, 1s stun) and every enemy projectile within 1.6 units is reflected for 2.6x damage. Each parry grants 20 Momentum and 3 Combo.',
    compressionSupport: true, icon: 'node:d_mirror_guard' },
  { id: 'd_hundred_fangs', classId: 'duelist', name: 'Hundred Fangs', slot: 'active', damageType: 'physical', damageCoef: '0.55', resourceCost: 25, cooldownSec: 8, charges: 1,
    shape: { kind: 'arc', range: 2.3, arcDeg: 90 },
    description: 'A 0.35s parry stance, then a flurry of 6 slashes plus 1 per 2 Combo (up to 16) over 0.8s in a 90° cone (range 2.3), each dealing 0.55x damage. Consumes all Combo.',
    compressionSupport: true, icon: 'node:d_hundred_fangs' },
];

export const NODES: NodeDef[] = [
  // ---- Duelist / Edge: crits, bleeds and executions ----
  n('d_rend', 'edge', 'Rend', 1, 0, { grantsSkill: 'd_rend', description: 'Equip Rend (16 Momentum, 4s): an X-slash in a 100° cone (range 2.2) for 1.7x damage; enemies hit bleed for 30% of the hit per second for 4s.' }),
  n('d_keen_edge', 'edge', 'Keen Edge', 3, 1, { modifiers: [{ stat: 'player.critTendency', factorPerRank: '1.12' }], description: 'Critical tendency x1.12 per rank.' }),
  n('d_serrated', 'edge', 'Serrated Steel', 3, 1, { modifiers: [{ stat: 'player.bleedDamage', factorPerRank: '1.15' }], description: 'Bleed damage x1.15 per rank (every bleed you apply).' }),
  n('d_honed_rend', 'edge', 'Honed Rend', 2, 1, { prereqs: [{ node: 'd_rend', rank: 1 }], modifiers: [{ stat: 'skill.d_rend.damage', factorPerRank: '1.15' }], description: 'Rend damage x1.15 per rank. Also applies to its evolutions, Crimson Whirl and Execution.' }),
  n('d_open_veins', 'edge', 'Open Veins', 1, 2, { prereqs: [{ node: 'd_rend', rank: 1 }], excludes: ['d_exsanguinate'], mechanics: ['open_veins'], description: 'Choice: when an enemy bleeding from you dies, its bleed (full remaining rate, refreshed to 3s) jumps to the 2 nearest enemies within 3.5 units.' }),
  n('d_exsanguinate', 'edge', 'Exsanguinate', 1, 2, { prereqs: [{ node: 'd_rend', rank: 1 }], excludes: ['d_open_veins'], mechanics: ['exsanguinate'], description: 'Choice: Rend, Execution and the first spin of Crimson Whirl consume your bleeds on every enemy they hit, instantly dealing 120% of the bleeds\' remaining damage, before applying their fresh bleed.' }),
  n('d_cruelty', 'edge', 'Cruelty', 2, 2, { modifiers: [{ stat: 'player.critPotency', factorPerRank: '1.1' }], description: 'Critical damage potency x1.1 per rank.' }),
  n('d_crimson_whirl', 'edge', 'Crimson Whirl', 1, 3, { prereqs: [{ node: 'd_rend', rank: 1 }], excludes: ['d_execution'], grantsSkill: 'd_crimson_whirl', description: 'Evolution: Rend becomes Crimson Whirl (22 Momentum, 6s): spin 3 times over 0.5s, each spin slashing everything within 2.4 units for 0.9x damage and applying Rend\'s bleed.' }),
  n('d_execution', 'edge', 'Execution', 1, 3, { prereqs: [{ node: 'd_rend', rank: 1 }], excludes: ['d_crimson_whirl'], grantsSkill: 'd_execution', description: 'Evolution: Rend becomes Execution (20 Momentum, 5s): lunge up to 3 units and run the first enemy through for 3.6x damage (x2 below 35% health), applying Rend\'s bleed. A kill refunds the cooldown and 15 Momentum.' }),
  n('d_executioner', 'edge', 'Executioner', 1, 3, { mechanics: ['executioner'], description: 'Your hits deal x1.5 damage (x1.25 against bosses) to enemies whose front unit is below 30% health.' }),
  n('d_thousand_wounds', 'edge', 'Thousand Wounds', 1, 4, { prereqs: [{ node: 'd_serrated', rank: 1 }], excludes: ['d_coup_de_grace'], mechanics: ['thousand_wounds'], description: 'Keystone: every hit you deal applies an extra bleed of 15% of its damage per second for 3s, and enemies bleeding from you take x1.15 damage from your hits.' }),
  n('d_coup_de_grace', 'edge', 'Coup de Grâce', 1, 4, { prereqs: [{ node: 'd_executioner', rank: 1 }], excludes: ['d_thousand_wounds'], mechanics: ['coup_de_grace'], description: 'Keystone: Executioner\'s threshold rises to 45% and its bonus to x2 (x1.4 against bosses). Non-boss units left at or below 12% health by your hits are slain outright. Kills reset your Edge skill\'s cooldown (at most once every 1.5s).' }),

  // ---- Duelist / Shadow: blinks, backstabs and shadow clones ----
  n('d_shadowstep', 'shadow', 'Shadowstep', 1, 0, { grantsSkill: 'd_shadowstep', description: 'Equip Shadowstep (18 Momentum, 5s): blink up to 6 units to appear behind the enemy nearest your aim and strike everything within 1.4 units for 2x damage (backstab x1.25 applies). 0.2s invulnerable on arrival.' }),
  n('d_fleet', 'shadow', 'Fleet Foot', 3, 1, { modifiers: [{ stat: 'player.movementSpeed', factorPerRank: '1.06' }], description: 'Movement speed x1.06 per rank (also lengthens your dodge).' }),
  n('d_umbral_edge', 'shadow', 'Umbral Edge', 3, 1, { prereqs: [{ node: 'd_shadowstep', rank: 1 }], modifiers: [{ stat: 'skill.d_shadowstep.damage', factorPerRank: '1.15' }], description: 'Shadowstep damage x1.15 per rank. Also applies to its evolutions, Phantom Rush and Death Mark.' }),
  n('d_twin_shadows', 'shadow', 'Twin Shadows', 1, 1, { prereqs: [{ node: 'd_shadowstep', rank: 1 }], mechanics: ['shadow_charge'], description: 'Your Shadow skill holds 1 extra charge.' }),
  n('d_shadow_clone', 'shadow', 'Shadow Clone', 1, 2, { prereqs: [{ node: 'd_shadowstep', rank: 1 }], excludes: ['d_smoke_veil'], mechanics: ['shadow_clone'], description: 'Choice: every Shadow skill blink leaves a shadow clone at its departure point for 3s (max 3). Clones mirror your basic attacks for 50% damage from where they stand.' }),
  n('d_smoke_veil', 'shadow', 'Smoke Veil', 1, 2, { prereqs: [{ node: 'd_shadowstep', rank: 1 }], excludes: ['d_shadow_clone'], mechanics: ['smoke_veil'], description: 'Choice: Shadow skill arrivals burst into smoke (radius 2, 2s). Enemies inside have their attack windups interrupted and take x1.2 damage from all sources for 3s.' }),
  n('d_phantom_dash', 'shadow', 'Phantom Dash', 2, 2, { mechanics: ['phantom_dash'], description: 'Your dodge slashes every enemy along its path for 0.8x damage (x1.3 for the second rank).' }),
  n('d_phantom_rush', 'shadow', 'Phantom Rush', 1, 3, { prereqs: [{ node: 'd_shadowstep', rank: 1 }], excludes: ['d_death_mark'], grantsSkill: 'd_phantom_rush', description: 'Evolution: Shadowstep becomes Phantom Rush (25 Momentum, 7s): blink between up to 4 different enemies within 6 units, 0.1s apart, striking each and everything within 1.2 units of it for 1.4x damage. Invulnerable throughout.' }),
  n('d_death_mark', 'shadow', 'Death Mark', 1, 3, { prereqs: [{ node: 'd_shadowstep', rank: 1 }], excludes: ['d_phantom_rush'], grantsSkill: 'd_death_mark', description: 'Evolution: Shadowstep becomes Death Mark (22 Momentum, 8s): blink behind your target, strike it for 2.4x and mark it for 2.5s; the mark detonates within 1.8 units for 2x plus 40% of all damage you dealt it while marked.' }),
  n('d_ambush', 'shadow', 'Ambush', 1, 3, { mechanics: ['ambush'], description: 'After any blink or dodge, your next connecting basic attack within 2s deals x2.5 damage, flinches hard and adds 40 boss stagger.' }),
  n('d_shadow_dance', 'shadow', 'Shadow Dance', 1, 3, { prereqs: [{ node: 'd_shadowstep', rank: 1 }], mechanics: ['shadow_dance'], description: 'Kills restore 1 charge of your Shadow skill (at most once every 2s).' }),
  n('d_legion_of_shades', 'shadow', 'Legion of Shades', 1, 4, { excludes: ['d_reapers_path'], mechanics: ['legion_of_shades'], description: 'Keystone: every Thousand Cuts and Shadow skill blink leaves a shadow clone (max 3, 3s; mirrors basic attacks for 50%). When a clone expires or is replaced it detonates for 1.5x damage within 1.8 units.' }),
  n('d_reapers_path', 'shadow', 'Reaper\'s Path', 1, 4, { excludes: ['d_legion_of_shades'], mechanics: ['reapers_path'], description: 'Keystone: your Shadow skill costs no Momentum, recharges twice as fast and deals x1.4 damage, but each cast costs 5% of your current health.' }),

  // ---- Duelist / Tempo: combo, parries and momentum ----
  n('d_riposte', 'tempo', 'Riposte', 1, 0, { grantsSkill: 'd_riposte', description: 'Equip Riposte (15 Momentum, 6s): a 0.5s invulnerable parry stance. The first threat is parried: nearby projectiles reflect for 1.3x, or a melee attacker takes a 2.6x counter-thrust and a 1s stun (bosses +60 stagger). +20 Momentum, +3 Combo. An unused stance ends in a 1.3x thrust.' }),
  n('d_flow', 'tempo', 'Flow', 3, 1, { modifiers: [{ stat: 'player.attackFrequency', factorPerRank: '1.06' }], description: 'Attack frequency x1.06 per rank.' }),
  n('d_crescendo', 'tempo', 'Crescendo', 3, 1, { mechanics: ['crescendo'], description: 'Your damage is multiplied by x1.007 per Combo point per rank (x1.15 per rank at 20 Combo).' }),
  n('d_momentum_well', 'tempo', 'Momentum Well', 2, 1, { modifiers: [{ stat: 'player.maxResource', factorPerRank: '1.1' }], description: 'Maximum Momentum x1.1 per rank.' }),
  n('d_counterstrike', 'tempo', 'Counterstrike', 1, 2, { prereqs: [{ node: 'd_riposte', rank: 1 }], excludes: ['d_perfect_guard'], mechanics: ['counterstrike'], description: 'Choice: parry counters become a 360° sweep (radius 2.4) for 2.4x damage that stuns every enemy hit for 1s and knocks them back 1.2.' }),
  n('d_perfect_guard', 'tempo', 'Perfect Guard', 1, 2, { prereqs: [{ node: 'd_riposte', rank: 1 }], excludes: ['d_counterstrike'], mechanics: ['perfect_guard'], description: 'Choice: parries grant a shield of 12% maximum health and refund your Tempo skill\'s charge, and parry counters deal x1.5 damage.' }),
  n('d_flurry', 'tempo', 'Flurry', 1, 2, { mechanics: ['flurry'], description: 'At 10 or more Combo, Fang Finisher triggers on every 2nd connecting swing instead of every 4th.' }),
  n('d_mirror_guard', 'tempo', 'Mirror Guard', 1, 3, { prereqs: [{ node: 'd_riposte', rank: 1 }], excludes: ['d_hundred_fangs'], grantsSkill: 'd_mirror_guard', description: 'Evolution: Riposte becomes Mirror Guard (18 Momentum, 7s): a 0.9s parry stance that parries every threat. Each attacker is countered and every enemy projectile within 1.6 units is reflected for 2.6x damage.' }),
  n('d_hundred_fangs', 'tempo', 'Hundred Fangs', 1, 3, { prereqs: [{ node: 'd_riposte', rank: 1 }], excludes: ['d_mirror_guard'], grantsSkill: 'd_hundred_fangs', description: 'Evolution: Riposte becomes Hundred Fangs (25 Momentum, 8s): a 0.35s parry stance, then 6 slashes plus 1 per 2 Combo (up to 16) over 0.8s in a 90° cone (range 2.3), each 0.55x damage. Consumes all Combo.' }),
  n('d_unbroken', 'tempo', 'Unbroken', 1, 3, { mechanics: ['unbroken'], description: 'Taking damage no longer halves your Combo, and Combo lasts 4s without connecting instead of 2s.' }),
  n('d_finale', 'tempo', 'Finale', 1, 3, { mechanics: ['finale'], description: 'Casting Thousand Cuts with 15 or more Combo consumes 15 Combo for 3 extra blinks and a x1.6 burst radius.' }),
  n('d_endless_waltz', 'tempo', 'Endless Waltz', 1, 4, { excludes: ['d_perfect_form'], mechanics: ['endless_waltz'], description: 'Keystone: maximum Combo rises from 20 to 40, and each Combo point multiplies your basic attack speed by x1.015 (x1.81 at 40 Combo).' }),
  n('d_perfect_form', 'tempo', 'Perfect Form', 1, 4, { excludes: ['d_endless_waltz'], mechanics: ['perfect_form'], description: 'Keystone: after a parry, for 4s your hits deal x1.35 damage and every connecting basic swing is a Fang Finisher.' }),
];

export const CLASS: ClassDef = {
  id: 'duelist', name: 'Duelist', tagline: 'Twin blades, blood and tempo. Strikes first, from behind, and never stands still.',
  branches: [
    { id: 'edge', name: 'Edge', theme: 'Crits, bleeds and executions' },
    { id: 'shadow', name: 'Shadow', theme: 'Blinks, backstabs and shadow clones' },
    { id: 'tempo', name: 'Tempo', theme: 'Combo, parries and momentum' },
  ],
  accent: '#d23a4e', role: 'Agile melee · crit assassin',
  resource: { name: 'Momentum', max: 100, regenPerSec: 7 },
  base: { maxHealth: 950, armor: 22, damage: 76, attackFrequency: 3.2, moveSpeed: 5.0, critTendency: '0.35', critMultiplier: '2.2', shieldCapacity: 0.6 },
  melee: true, basicSkill: 'd_twin_fangs', signatureSkill: 'd_thousand_cuts',
  nodes: NODES.map((x) => x.id),
};
