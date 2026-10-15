import type { ClassDef, NodeDef, SkillDef } from '../types';
import { MELEE_PASSIVES, node } from './common';

// Duelist: lightning-fast melee assassin. Crits, bleeds, blinks, parries and a combo meter.
// Kit-wide rules (implemented in simulation/src/classes/duelist.ts):
//  - Backstab: hits landing from behind an enemy (opposite its facing) deal x1.25.
//  - Momentum: every connecting basic swing cuts 0.06s from all recharging skill cooldowns, 0.12s if it crits.
//  - Combo (0..20): +1 per connecting basic swing, +2 per skill cast that hits (+1 per Crimson Whirl spin or Phantom
//    Rush blink), +3 per parry. Lost after 2s without
//    connecting; a hit that deals 5%+ of maximum health halves it. Exposed to the HUD as vars.ui_combo / ui_comboMax.
// Branch skill families (evolutions replace the base active in its slot and inherit its tree modifiers):
//  Edge: Rend -> Crimson Whirl | Execution.  Shadow: Shadowstep -> Phantom Rush | Death Mark.
//  Tempo: Riposte -> Mirror Guard | Hundred Fangs.

const n = (id: string, branch: string, name: string, rankLimit: number, tier: NodeDef['tier'], opts: Parameters<typeof node>[6]) => node(id, 'duelist', branch, name, rankLimit, tier, opts);

const BLEED = { type: 'physical' as const, fractionPerSec: '0.3', durationSec: 4 };

export const SKILLS: SkillDef[] = [
  { id: 'd_twin_fangs', classId: 'duelist', name: 'Twin Fangs', slot: 'basic', damageType: 'physical', damageCoef: '0.85', cooldownSec: 0, charges: 1,
    shape: { kind: 'arc', range: 1.9, arcDeg: 90 },
    description: `A fast twin-blade flurry in a 90° arc (range 1.9). Every 4th connecting swing is a Fang Finisher: 110° arc, range 2.3, x2 damage. Momentum: connecting swings cut 0.06s from your cooldowns (0.12s on a crit) and build Combo. Hits from behind an enemy deal x1.25. Keen Edge: a swing that lands a critical hit heals 0.8% of maximum health. ${MELEE_PASSIVES}`,
    compressionSupport: true, icon: 'node:d_twin_fangs' },
  { id: 'd_thousand_cuts', classId: 'duelist', name: 'Thousand Cuts', slot: 'signature', damageType: 'physical', damageCoef: '0.8', cooldownSec: 8.5, charges: 1,
    shape: { kind: 'circle', radius: 5, selfCentered: true, range: 0 }, knockback: 1,
    description: 'Vanish into 5 blinks, 0.08s apart, each cutting through to the nearest unstruck enemy within 5 units: every enemy along the path takes 0.8x damage. End in a crimson burst (radius 2.4) for 2.2x that knocks enemies back 1. Invulnerable throughout. Builds boss stagger.',
    compressionSupport: true, icon: 'node:d_thousand_cuts' },
  // ---- Edge family ----
  { id: 'd_rend', classId: 'duelist', name: 'Rend', slot: 'active', damageType: 'physical', damageCoef: '1.7', cooldownSec: 3, charges: 1,
    shape: { kind: 'arc', range: 2.2, arcDeg: 100 }, dot: BLEED,
    description: 'An X-slash in a 100° cone (range 2.2) for 1.7x damage. Enemies hit bleed for 30% of the hit per second for 4s.', compressionSupport: true, icon: 'node:d_rend' },
  { id: 'd_crimson_whirl', classId: 'duelist', name: 'Crimson Whirl', slot: 'active', damageType: 'physical', damageCoef: '0.9', cooldownSec: 4, charges: 1,
    shape: { kind: 'circle', radius: 2.4, selfCentered: true, range: 0 }, dot: BLEED,
    description: 'Spin 3 times over 0.5s; each spin slashes everything within 2.4 units for 0.9x damage and applies Rend\'s bleed (30% per second for 4s).', compressionSupport: true, icon: 'node:d_crimson_whirl' },
  { id: 'd_execution', classId: 'duelist', name: 'Execution', slot: 'active', damageType: 'physical', damageCoef: '3.6', cooldownSec: 3.5, charges: 1,
    shape: { kind: 'line', length: 3, width: 0.9, duration: 0, tickInterval: 1 }, dot: BLEED,
    description: 'Lunge up to 3 units along your aim and run the first enemy through for 3.6x damage (x2 against targets below 35% health), applying Rend\'s bleed. A kill refunds the cooldown and cuts 1s from your other skills.', compressionSupport: true, icon: 'node:d_execution' },
  // ---- Shadow family ----
  { id: 'd_shadowstep', classId: 'duelist', name: 'Shadowstep', slot: 'active', damageType: 'physical', damageCoef: '2', cooldownSec: 3.5, charges: 1,
    shape: { kind: 'teleport', range: 6 },
    description: 'Blink up to 6 units to appear behind the enemy nearest your aim and strike everything within 1.4 units for 2x damage. 0.2s invulnerable on arrival.', compressionSupport: true, icon: 'node:d_shadowstep' },
  { id: 'd_phantom_rush', classId: 'duelist', name: 'Phantom Rush', slot: 'active', damageType: 'physical', damageCoef: '1.4', cooldownSec: 5, charges: 1,
    shape: { kind: 'teleport', range: 6 },
    description: 'Blink between up to 4 different enemies within 6 units, 0.1s apart, striking each and everything within 1.2 units of it for 1.4x damage. Invulnerable for the whole rush.', compressionSupport: true, icon: 'node:d_phantom_rush' },
  { id: 'd_death_mark', classId: 'duelist', name: 'Death Mark', slot: 'active', damageType: 'physical', damageCoef: '2.4', cooldownSec: 5.5, charges: 1,
    shape: { kind: 'teleport', range: 6 },
    description: 'Blink behind the enemy nearest your aim, strike it for 2.4x damage and mark it for 2.5s. The mark then detonates within 1.8 units for 2x damage plus 40% of all damage you dealt the target while it was marked.', compressionSupport: true, icon: 'node:d_death_mark' },
  // ---- Tempo family ----
  { id: 'd_riposte', classId: 'duelist', name: 'Riposte', slot: 'active', damageType: 'physical', damageCoef: '2.6', cooldownSec: 4, charges: 1,
    shape: { kind: 'guard', duration: 0.5, arcDeg: 360 },
    description: 'A 0.5s parry stance (invulnerable). The first threat is parried: enemy projectiles within 1.3 units are reflected for 1.3x damage, or a melee attacker winding up within reach is countered with a thrust for 2.6x damage that stuns it for 1s (bosses: +60 stagger). A parry cuts 1s from your other cooldowns and grants 3 Combo. An unused stance ends in a 1.3x thrust.',
    compressionSupport: true, icon: 'node:d_riposte' },
  { id: 'd_mirror_guard', classId: 'duelist', name: 'Mirror Guard', slot: 'active', damageType: 'physical', damageCoef: '2.6', cooldownSec: 5, charges: 1,
    shape: { kind: 'guard', duration: 0.9, arcDeg: 360 },
    description: 'A 0.9s parry stance (invulnerable) that parries every threat: each melee attacker is countered (2.6x, 1s stun) and every enemy projectile within 1.6 units is reflected for 2.6x damage. Each parry cuts 1s from your other cooldowns and grants 3 Combo.',
    compressionSupport: true, icon: 'node:d_mirror_guard' },
  { id: 'd_hundred_fangs', classId: 'duelist', name: 'Hundred Fangs', slot: 'active', damageType: 'physical', damageCoef: '0.55', cooldownSec: 5.5, charges: 1,
    shape: { kind: 'arc', range: 2.3, arcDeg: 90 },
    description: 'A 0.35s parry stance, then a flurry of 6 slashes plus 1 per 2 Combo (up to 16) over 0.8s in a 90° cone (range 2.3), each dealing 0.55x damage. Consumes all Combo.',
    compressionSupport: true, icon: 'node:d_hundred_fangs' },
];

export const NODES: NodeDef[] = [
  // ---- Duelist / Edge: crits, bleeds and executions ----
  n('d_rend', 'edge', 'Rend', 1, 0, { starting: true, grantsSkill: 'd_rend', description: 'Slashes a cone for 1.7× damage and makes enemies bleed 30% per second for 4s.' }),
  n('d_keen_edge', 'edge', 'Keen Edge', 3, 1, { modifiers: [{ stat: 'player.critTendency', factorPerRank: '1.12' }], description: 'Raises critical tendency ×{value} per rank.' }),
  n('d_serrated', 'edge', 'Serrated Steel', 3, 1, { modifiers: [{ stat: 'player.bleedDamage', factorPerRank: '1.15' }], description: 'Raises bleed damage ×{value} per rank.' }),
  n('d_honed_rend', 'edge', 'Honed Rend', 2, 1, { prereqs: [{ node: 'd_rend', rank: 1 }], modifiers: [{ stat: 'skill.d_rend.damage', factorPerRank: '1.15' }], upgrades: 'd_rend', description: 'Upgrades Rend: damage ×{value} per rank, evolutions too.' }),
  n('d_open_veins', 'edge', 'Open Veins', 1, 2, { prereqs: [{ node: 'd_rend', rank: 1 }], excludes: ['d_exsanguinate'], mechanics: ['open_veins'], description: 'Spreads a dying enemy\'s bleed to the 2 nearest enemies within 3.5 units.' }),
  n('d_exsanguinate', 'edge', 'Exsanguinate', 1, 2, { prereqs: [{ node: 'd_rend', rank: 1 }], excludes: ['d_open_veins'], mechanics: ['exsanguinate'], upgrades: 'd_rend', description: 'Upgrades Rend: hits cash out existing bleeds for 120% of their remaining damage.' }),
  n('d_cruelty', 'edge', 'Cruelty', 2, 2, { modifiers: [{ stat: 'player.critPotency', factorPerRank: '1.1' }], description: 'Raises critical damage ×{value} per rank.' }),
  n('d_crimson_whirl', 'edge', 'Crimson Whirl', 1, 3, { prereqs: [{ node: 'd_rend', rank: 1 }], excludes: ['d_execution'], grantsSkill: 'd_crimson_whirl', description: 'Spins 3 times, slashing all within 2.4 units for 0.9× and applying Rend\'s bleed.' }),
  n('d_execution', 'edge', 'Execution', 1, 3, { prereqs: [{ node: 'd_rend', rank: 1 }], excludes: ['d_crimson_whirl'], grantsSkill: 'd_execution', description: 'Lunges through a foe for 3.6× (×2 below 35%); a kill refunds it and cuts 1s off others.' }),
  n('d_executioner', 'edge', 'Executioner', 1, 3, { mechanics: ['executioner'], description: 'Makes your hits deal ×1.5 (×1.25 on bosses) to enemies below 30% health.' }),
  n('d_thousand_wounds', 'edge', 'Thousand Wounds', 1, 4, { prereqs: [{ node: 'd_serrated', rank: 1 }], excludes: ['d_coup_de_grace'], mechanics: ['thousand_wounds'], description: 'Adds a 15%/s bleed to every hit; bleeding enemies take ×1.15 from your hits.' }),
  n('d_coup_de_grace', 'edge', 'Coup de Grâce', 1, 4, { prereqs: [{ node: 'd_executioner', rank: 1 }], excludes: ['d_thousand_wounds'], mechanics: ['coup_de_grace'], description: 'Raises Executioner to 45% and ×2, slays units under 12%, and kills reset Rend.' }),

  // ---- Duelist / Shadow: blinks, backstabs and shadow clones ----
  n('d_shadowstep', 'shadow', 'Shadowstep', 1, 0, { starting: true, grantsSkill: 'd_shadowstep', description: 'Blinks behind the enemy nearest your aim and strikes nearby enemies for 2×.' }),
  n('d_fleet', 'shadow', 'Fleet Foot', 3, 1, { modifiers: [{ stat: 'player.movementSpeed', factorPerRank: '1.06' }], description: 'Raises movement speed ×{value} per rank; dodges go farther too.' }),
  n('d_umbral_edge', 'shadow', 'Umbral Edge', 3, 1, { prereqs: [{ node: 'd_shadowstep', rank: 1 }], modifiers: [{ stat: 'skill.d_shadowstep.damage', factorPerRank: '1.15' }], upgrades: 'd_shadowstep', description: 'Upgrades Shadowstep: damage ×{value} per rank, evolutions too.' }),
  n('d_twin_shadows', 'shadow', 'Twin Shadows', 1, 1, { prereqs: [{ node: 'd_shadowstep', rank: 1 }], mechanics: ['shadow_charge'], upgrades: 'd_shadowstep', description: 'Upgrades Shadowstep: +1 charge, evolutions too.' }),
  n('d_shadow_clone', 'shadow', 'Shadow Clone', 1, 2, { prereqs: [{ node: 'd_shadowstep', rank: 1 }], excludes: ['d_smoke_veil'], mechanics: ['shadow_clone'], upgrades: 'd_shadowstep', description: 'Upgrades Shadowstep: each blink leaves a 3s clone that mirrors your attacks at 50%.' }),
  n('d_smoke_veil', 'shadow', 'Smoke Veil', 1, 2, { prereqs: [{ node: 'd_shadowstep', rank: 1 }], excludes: ['d_shadow_clone'], mechanics: ['smoke_veil'], upgrades: 'd_shadowstep', description: 'Upgrades Shadowstep: arrival smoke interrupts enemies, who take ×1.2 damage for 3s.' }),
  n('d_phantom_dash', 'shadow', 'Phantom Dash', 2, 2, { mechanics: ['phantom_dash'], description: 'Makes your dodge slash enemies in its path for 0.8× (×1.3 at rank 2).' }),
  n('d_phantom_rush', 'shadow', 'Phantom Rush', 1, 3, { prereqs: [{ node: 'd_shadowstep', rank: 1 }], excludes: ['d_death_mark'], grantsSkill: 'd_phantom_rush', description: 'Blinks between up to 4 enemies, hitting each and those nearby for 1.4×.' }),
  n('d_death_mark', 'shadow', 'Death Mark', 1, 3, { prereqs: [{ node: 'd_shadowstep', rank: 1 }], excludes: ['d_phantom_rush'], grantsSkill: 'd_death_mark', description: 'Blinks behind a target for 2.4× and marks it to explode with 40% of damage dealt.' }),
  n('d_ambush', 'shadow', 'Ambush', 1, 3, { mechanics: ['ambush'], description: 'Makes your next basic attack within 2s of a blink or dodge deal ×2.5.' }),
  n('d_shadow_dance', 'shadow', 'Shadow Dance', 1, 3, { prereqs: [{ node: 'd_shadowstep', rank: 1 }], mechanics: ['shadow_dance'], upgrades: 'd_shadowstep', description: 'Upgrades Shadowstep: kills restore 1 charge (once per 2s).' }),
  n('d_legion_of_shades', 'shadow', 'Legion of Shades', 1, 4, { excludes: ['d_reapers_path'], mechanics: ['legion_of_shades'], description: 'Leaves a clone at every Shadowstep and Thousand Cuts blink that explodes for 1.5×.' }),
  n('d_reapers_path', 'shadow', 'Reaper\'s Path', 1, 4, { excludes: ['d_legion_of_shades'], mechanics: ['reapers_path'], description: 'Keystone: your Shadow skill recharges twice as fast for ×1.5 damage; casts cost 5% health.' }),

  // ---- Duelist / Tempo: combo, parries and momentum ----
  n('d_riposte', 'tempo', 'Riposte', 1, 0, { starting: true, grantsSkill: 'd_riposte', description: 'Parries the next threat (counter 2.6×, 1s stun); a parry cuts 1s off other cooldowns.' }),
  n('d_flow', 'tempo', 'Flow', 3, 1, { modifiers: [{ stat: 'player.attackFrequency', factorPerRank: '1.06' }], description: 'Raises attack speed ×{value} per rank.' }),
  n('d_crescendo', 'tempo', 'Crescendo', 3, 1, { mechanics: ['crescendo'], description: 'Raises damage ×1.007 per Combo point per rank (×1.15 per rank at 20 Combo).' }),
  n('d_momentum_well', 'tempo', 'Momentum Well', 2, 1, { modifiers: [{ stat: 'skill.d_riposte.cooldown', factorPerRank: '0.9' }, { stat: 'skill.d_mirror_guard.cooldown', factorPerRank: '0.9' }, { stat: 'skill.d_hundred_fangs.cooldown', factorPerRank: '0.9' }], upgrades: 'd_riposte', description: 'Upgrades Riposte: cooldown ×{value} per rank, evolutions too.' }),
  n('d_counterstrike', 'tempo', 'Counterstrike', 1, 2, { prereqs: [{ node: 'd_riposte', rank: 1 }], excludes: ['d_perfect_guard'], mechanics: ['counterstrike'], upgrades: 'd_riposte', description: 'Upgrades Riposte: counters become a 360° 2.4× sweep that stuns for 1s.' }),
  n('d_perfect_guard', 'tempo', 'Perfect Guard', 1, 2, { prereqs: [{ node: 'd_riposte', rank: 1 }], excludes: ['d_counterstrike'], mechanics: ['perfect_guard'], upgrades: 'd_riposte', description: 'Upgrades Riposte: parries grant a 12% shield, refund the charge, and counter ×1.5.' }),
  n('d_flurry', 'tempo', 'Flurry', 1, 2, { mechanics: ['flurry'], upgrades: 'd_twin_fangs', description: 'Upgrades Twin Fangs: at 10+ Combo, a Finisher every 2nd swing instead of every 4th.' }),
  n('d_mirror_guard', 'tempo', 'Mirror Guard', 1, 3, { prereqs: [{ node: 'd_riposte', rank: 1 }], excludes: ['d_hundred_fangs'], grantsSkill: 'd_mirror_guard', description: 'Holds a 0.9s stance that parries every attack and reflects projectiles for 2.6×.' }),
  n('d_hundred_fangs', 'tempo', 'Hundred Fangs', 1, 3, { prereqs: [{ node: 'd_riposte', rank: 1 }], excludes: ['d_mirror_guard'], grantsSkill: 'd_hundred_fangs', description: 'Parries briefly, then unleashes 6+ slashes (more with Combo) at 0.55× each.' }),
  n('d_unbroken', 'tempo', 'Unbroken', 1, 3, { mechanics: ['unbroken'], description: 'Keeps your Combo when hit, and Combo lasts 4s instead of 2s.' }),
  n('d_finale', 'tempo', 'Finale', 1, 3, { mechanics: ['finale'], upgrades: 'd_thousand_cuts', description: 'Upgrades Thousand Cuts: at 15+ Combo, uses 15 for +3 blinks and ×1.6 burst radius.' }),
  n('d_endless_waltz', 'tempo', 'Endless Waltz', 1, 4, { excludes: ['d_perfect_form'], mechanics: ['endless_waltz'], description: 'Raises max Combo 20 → 40; each Combo point adds ×1.015 attack speed.' }),
  n('d_perfect_form', 'tempo', 'Perfect Form', 1, 4, { excludes: ['d_endless_waltz'], mechanics: ['perfect_form'], description: 'Makes hits deal ×1.35 for 4s after a parry, and every swing is a Finisher.' }),
];

export const CLASS: ClassDef = {
  id: 'duelist', name: 'Duelist', tagline: 'Twin blades, blood and tempo. Strikes first, from behind, and never stands still.',
  branches: [
    { id: 'edge', name: 'Edge', theme: 'Crits, bleeds and executions' },
    { id: 'shadow', name: 'Shadow', theme: 'Blinks, backstabs and shadow clones' },
    { id: 'tempo', name: 'Tempo', theme: 'Combo, parries and momentum' },
  ],
  accent: '#d23a4e', role: 'Agile melee · crit assassin',
  base: { maxHealth: 950, armor: 22, damage: 80, attackFrequency: 3.2, moveSpeed: 5.0, critTendency: '0.35', critMultiplier: '2.2', shieldCapacity: 0.6 },
  melee: true, basicSkill: 'd_twin_fangs', signatureSkill: 'd_thousand_cuts',
  nodes: NODES.map((x) => x.id),
};
