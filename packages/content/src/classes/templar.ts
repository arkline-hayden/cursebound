import type { ClassDef, NodeDef, SkillDef } from '../types';
import { MELEE_PASSIVES, node } from './common';

// Templar: holy warrior with a great hammer and a tower shield. Consecrates the ground, hurls a returning hammer,
// condemns foes and shields the party. Kit-wide rules (implemented in simulation/src/classes/templar.ts):
//  - Zeal: regenerates 8 per second; every basic swing that connects grants 4 more.
//  - Hallowed Hammer: every third swing releases a radiant shockwave (0.9x astral, 120° cone, 2.9 units).
//  - Holy ground: consecrated ground (Consecrate, Dawnbreak, Judgment Day) and the Beacon's light pulse every 0.5s,
//    damaging enemies inside and healing allies inside. Healing and shields you grant scale with Holy healing.
//  - Condemn (Condemnation node): Judgment hits mark enemies; your basic swings and shockwaves detonate the mark.
// Branch skill families (evolutions replace the base active in its slot and inherit its tree damage modifiers):
//  Radiance: Consecrate -> Dawnbreak | Beacon of Light.  Judgment: Hammer of Judgment -> Skyfall Hammer | Divine Smite.
//  Aegis: Shield Charge -> Aegis Charge | Intercession.

const n = (id: string, branch: string, name: string, rankLimit: number, tier: NodeDef['tier'], opts: Parameters<typeof node>[6]) => node(id, 'templar', branch, name, rankLimit, tier, opts);

const GROUND = 'enemies inside take 0.35x astral damage and allies inside heal 1.2% of their maximum health every 0.5s';

export const SKILLS: SkillDef[] = [
  { id: 't_hammer', classId: 'templar', name: 'Hallowed Hammer', slot: 'basic', damageType: 'physical', damageCoef: '1', resourceCost: 0, cooldownSec: 0, charges: 1,
    shape: { kind: 'arc', range: 2.2, arcDeg: 110 },
    description: `A heavy hammer swing (110° arc, 2.2 units). Every third swing releases a radiant shockwave: 0.9x astral damage in a 120° cone reaching 2.9 units. Connecting swings grant 4 Zeal. ${MELEE_PASSIVES}`,
    compressionSupport: true, icon: 'node:t_hammer' },
  { id: 't_judgment_day', classId: 'templar', name: 'Judgment Day', slot: 'signature', damageType: 'astral', damageCoef: '4', resourceCost: 35, cooldownSec: 12, charges: 1,
    shape: { kind: 'circle', radius: 3, selfCentered: false, range: 6 },
    description: `Call a pillar of light onto the aimed point (up to 6 units). After 0.35s it crashes down: enemies within 3.5 units are dragged up to 2 units inward, then take 4x astral damage in a 3 unit radius and are stunned for 1.5s (bosses take 180 stagger). The ground stays consecrated for 5s: ${GROUND}.`,
    compressionSupport: true, icon: 'node:t_judgment_day' },
  // ---- Radiance ----
  { id: 't_consecrate', classId: 'templar', name: 'Consecrate', slot: 'active', damageType: 'astral', damageCoef: '0.35', resourceCost: 20, cooldownSec: 8, charges: 1,
    shape: { kind: 'aura', radius: 2.6, duration: 5 },
    description: `Sanctify the ground around you (radius 2.6) for 5s: ${GROUND}.`, compressionSupport: true, icon: 'node:t_consecrate' },
  { id: 't_dawnbreak', classId: 'templar', name: 'Dawnbreak', slot: 'active', damageType: 'astral', damageCoef: '1.8', resourceCost: 25, cooldownSec: 9, charges: 1,
    shape: { kind: 'circle', radius: 3.5, selfCentered: true, range: 0 }, knockback: 0.8,
    description: 'Erupt in a nova of dawn light (radius 3.5): 1.8x astral damage, enemies are stunned for 1s and knocked back (bosses take 60 stagger), allies inside heal 8% of their maximum health. Leaves Consecration (radius 2.6, 5s) under you.',
    compressionSupport: true, icon: 'node:t_dawnbreak' },
  { id: 't_beacon', classId: 'templar', name: 'Beacon of Light', slot: 'active', damageType: 'astral', damageCoef: '0.55', resourceCost: 25, cooldownSec: 12, charges: 1,
    shape: { kind: 'aura', radius: 3, duration: 8 },
    description: 'Plant a radiant beacon on the aimed point (up to 6 units) for 8s. Every 0.5s it fires a holy bolt (0.55x astral) at the nearest enemy within 6 units and heals allies within 3 units for 1% of their maximum health.',
    compressionSupport: true, icon: 'node:t_beacon' },
  // ---- Judgment ----
  { id: 't_hammer_throw', classId: 'templar', name: 'Hammer of Judgment', slot: 'active', damageType: 'physical', damageCoef: '1.3', resourceCost: 18, cooldownSec: 5, charges: 1,
    shape: { kind: 'projectile', speed: 14, radius: 0.55, range: 7, pierce: 999, spreadDeg: 20 },
    description: 'Hurl a spinning hammer up to 7 units. It strikes every enemy in its path for 1.3x physical damage, then flies back to you, striking each enemy again on the way back. Player projectile count throws more hammers.',
    compressionSupport: true, icon: 'node:t_hammer_throw' },
  { id: 't_skyfall', classId: 'templar', name: 'Skyfall Hammer', slot: 'active', damageType: 'physical', damageCoef: '1.3', resourceCost: 22, cooldownSec: 6, charges: 1,
    shape: { kind: 'projectile', speed: 14, radius: 0.55, range: 7, pierce: 999, spreadDeg: 20 },
    description: 'Hurl the hammer at the aimed point (2 to 7 units), striking enemies in its path for 1.3x physical. Where it stops, a pillar of light smites a 2 unit radius for 2.2x astral damage and stuns for 0.8s (bosses take 50 stagger), then the hammer returns, striking again.',
    compressionSupport: true, icon: 'node:t_skyfall' },
  { id: 't_smite', classId: 'templar', name: 'Divine Smite', slot: 'active', damageType: 'astral', damageCoef: '2.4', resourceCost: 20, cooldownSec: 4, charges: 2,
    shape: { kind: 'circle', radius: 3.5, selfCentered: false, range: 9 },
    description: 'Holds 2 charges. Lances of light strike the 3 enemies nearest the aimed point (up to 9 units away, within 3.5 units of it): 2.4x astral damage in a 1 unit radius around each, stunning for 0.5s (bosses take 30 stagger). With no enemy near, the light strikes the point itself.',
    compressionSupport: true, icon: 'node:t_smite' },
  // ---- Aegis ----
  { id: 't_shield_charge', classId: 'templar', name: 'Shield Charge', slot: 'active', damageType: 'physical', damageCoef: '1.6', resourceCost: 18, cooldownSec: 6, charges: 1,
    shape: { kind: 'line', length: 5, width: 2, duration: 0.28, tickInterval: 0.28 }, knockback: 1.2,
    description: 'Charge 5 units behind your shield (stops at walls). Every enemy you plough into takes 1.6x physical damage and is hurled 1.2 units aside (bosses take 30 stagger). You take x0.5 damage while charging.',
    compressionSupport: true, icon: 'node:t_shield_charge' },
  { id: 't_aegis_charge', classId: 'templar', name: 'Aegis Charge', slot: 'active', damageType: 'physical', damageCoef: '1.6', resourceCost: 26, cooldownSec: 10, charges: 1,
    shape: { kind: 'line', length: 5, width: 2, duration: 0.28, tickInterval: 0.28 }, knockback: 1.2,
    description: 'Shield Charge (5 units, 1.6x physical, x0.5 damage taken while charging), then raise an Aegis Dome (radius 3) where you stop for 4s: allies inside take x0.6 damage and enemy projectiles that enter the dome are destroyed.',
    compressionSupport: true, icon: 'node:t_aegis_charge' },
  { id: 't_intercession', classId: 'templar', name: 'Intercession', slot: 'active', damageType: 'physical', damageCoef: '1.2', resourceCost: 24, cooldownSec: 9, charges: 1,
    shape: { kind: 'teleport', range: 8 },
    description: 'Leap (0.4s, untargetable) to the ally nearest your aim within 8 units, or 6 units along your aim. Landing deals 1.2x physical in a 2.2 unit radius and knocks enemies back. You and allies within 3 units take a Vow: a holy shield of 18% maximum health for 6s; when a Vow\'s shield breaks it bursts for 1.5x astral in a 2.2 unit radius.',
    compressionSupport: true, icon: 'node:t_intercession' },
];

export const NODES: NodeDef[] = [
  // ---- Templar / Radiance ----
  n('t_consecrate', 'radiance', 'Consecrate', 1, 0, { grantsSkill: 't_consecrate', description: 'Sanctifies the ground around you for 5s, burning enemies and healing allies.' }),
  n('t_hallowed_ground', 'radiance', 'Hallowed Ground', 3, 1, { prereqs: [{ node: 't_consecrate', rank: 1 }], modifiers: [{ stat: 'skill.t_consecrate.damage', factorPerRank: '1.12' }], upgrades: 't_consecrate', description: 'Upgrades Consecrate: damage ×{value} per rank, all holy ground too.' }),
  n('t_benediction', 'radiance', 'Benediction', 3, 1, { modifiers: [{ stat: 'player.holyHealing', factorPerRank: '1.1' }], description: 'Raises every heal and shield you grant ×{value} per rank.' }),
  n('t_radiant_core', 'radiance', 'Radiant Core', 2, 1, { modifiers: [{ stat: 'player.astralDamage', factorPerRank: '1.08' }], description: 'Raises astral damage ×{value} per rank.' }),
  n('t_sanctuary', 'radiance', 'Sanctuary', 1, 2, { prereqs: [{ node: 't_consecrate', rank: 1 }], excludes: ['t_blinding_light'], mechanics: ['sanctuary'], upgrades: 't_consecrate', description: 'Upgrades Consecrate: your holy ground moves with you, evolutions too.' }),
  n('t_blinding_light', 'radiance', 'Blinding Light', 1, 2, { prereqs: [{ node: 't_consecrate', rank: 1 }], excludes: ['t_sanctuary'], mechanics: ['blinding_light'], upgrades: 't_consecrate', description: 'Upgrades Consecrate: blinds enemies inside for 1s; they take ×1.15 damage for 4s.' }),
  n('t_dawnbreak', 'radiance', 'Dawnbreak', 1, 2, { prereqs: [{ node: 't_consecrate', rank: 1 }], excludes: ['t_beacon'], grantsSkill: 't_dawnbreak', description: 'Bursts light for 1.8× astral that stuns, heals allies 8%, and consecrates the ground.' }),
  n('t_beacon', 'radiance', 'Beacon of Light', 1, 2, { prereqs: [{ node: 't_consecrate', rank: 1 }], excludes: ['t_dawnbreak'], grantsSkill: 't_beacon', description: 'Plants an 8s beacon that shoots 0.55× astral bolts and heals allies nearby.' }),
  n('t_radiant_ward', 'radiance', 'Radiant Ward', 1, 3, { mechanics: ['radiant_ward'], description: 'Turns healing beyond an ally\'s max health into a shield worth 50% of it.' }),
  n('t_searing_light', 'radiance', 'Searing Light', 1, 3, { mechanics: ['searing_light'], description: 'Makes your holy ground leave enemies taking ×1.12 damage for 1s per pulse.' }),
  n('t_avenging_light', 'radiance', 'Avenging Light', 1, 4, { prereqs: [{ node: 't_consecrate', rank: 1 }], excludes: ['t_sanctum'], mechanics: ['avenging_light'], description: 'Makes every heal you grant also smite the nearest enemy for 60% of the heal.' }),
  n('t_sanctum', 'radiance', 'Holy Sanctum', 1, 4, { prereqs: [{ node: 't_consecrate', rank: 1 }], excludes: ['t_avenging_light'], mechanics: ['sanctum'], description: 'Makes allies in your holy ground take ×0.8 damage and attack ×1.2 faster.' }),

  // ---- Templar / Judgment ----
  n('t_hammer_throw', 'judgment', 'Hammer of Judgment', 1, 0, { grantsSkill: 't_hammer_throw', description: 'Hurls a returning hammer that hits enemies for 1.3× physical both ways.' }),
  n('t_weighted_head', 'judgment', 'Weighted Head', 3, 1, { prereqs: [{ node: 't_hammer_throw', rank: 1 }], modifiers: [{ stat: 'skill.t_hammer_throw.damage', factorPerRank: '1.12' }], upgrades: 't_hammer_throw', description: 'Upgrades Hammer of Judgment: damage ×{value} per rank, evolutions too.' }),
  n('t_zealotry', 'judgment', 'Zealotry', 3, 1, { modifiers: [{ stat: 'player.attackFrequency', factorPerRank: '1.05' }], description: 'Raises attack speed ×{value} per rank.' }),
  n('t_condemnation', 'judgment', 'Condemnation', 2, 1, { prereqs: [{ node: 't_hammer_throw', rank: 1 }], mechanics: ['condemn'], upgrades: 't_hammer_throw', description: 'Upgrades Hammer of Judgment: hits Condemn; your swings detonate it for 0.8× per rank.' }),
  n('t_shepherd', 'judgment', 'Shepherd\'s Return', 1, 2, { prereqs: [{ node: 't_hammer_throw', rank: 1 }], excludes: ['t_hammerfall'], mechanics: ['shepherd'], upgrades: 't_hammer_throw', description: 'Upgrades Hammer of Judgment: the return pulls enemies 1.5 units toward you.' }),
  n('t_hammerfall', 'judgment', 'Grinding Halt', 1, 2, { prereqs: [{ node: 't_hammer_throw', rank: 1 }], excludes: ['t_shepherd'], mechanics: ['hammerfall'], upgrades: 't_hammer_throw', description: 'Upgrades Hammer of Judgment: hovers 1.2s at range, grinding for 0.35× every 0.2s.' }),
  n('t_skyfall', 'judgment', 'Skyfall Hammer', 1, 2, { prereqs: [{ node: 't_hammer_throw', rank: 1 }], excludes: ['t_smite'], grantsSkill: 't_skyfall', description: 'Throws the hammer to a point where a pillar of light smites for 2.2× and stuns.' }),
  n('t_smite', 'judgment', 'Divine Smite', 1, 2, { prereqs: [{ node: 't_hammer_throw', rank: 1 }], excludes: ['t_skyfall'], grantsSkill: 't_smite', description: 'Smites the 3 enemies nearest your aim for 2.4× astral and stuns them (2 charges).' }),
  n('t_final_verdict', 'judgment', 'Final Verdict', 1, 3, { prereqs: [{ node: 't_condemnation', rank: 1 }], mechanics: ['final_verdict'], description: 'Makes Condemn detonations deal ×2.5 to enemies below 35% health.' }),
  n('t_momentum', 'judgment', 'Righteous Momentum', 2, 3, { prereqs: [{ node: 't_condemnation', rank: 1 }], mechanics: ['momentum'], description: 'Each Condemn detonation cuts 0.5s per rank from your Judgment skill\'s cooldown and grants 3 Zeal per rank.' }),
  n('t_inquisitor', 'judgment', 'Inquisitor', 1, 4, { prereqs: [{ node: 't_condemnation', rank: 1 }], excludes: ['t_heavens_call'], mechanics: ['inquisitor'], description: 'Lets Condemn stack 3 times, and each detonation spreads a stack to 3 enemies.' }),
  n('t_heavens_call', 'judgment', 'Heaven\'s Call', 1, 4, { prereqs: [{ node: 't_hammer_throw', rank: 1 }], excludes: ['t_inquisitor'], mechanics: ['heavens_call'], upgrades: 't_hammer_throw', description: 'Upgrades Hammer of Judgment: each cast calls 3 smites on nearby enemies for 1×.' }),

  // ---- Templar / Aegis ----
  n('t_shield_charge', 'aegis', 'Shield Charge', 1, 0, { grantsSkill: 't_shield_charge', description: 'Charges 5 units behind your shield for 1.6×, taking half damage while charging.' }),
  n('t_bulwark_of_faith', 'aegis', 'Bulwark of Faith', 3, 1, { modifiers: [{ stat: 'player.armor', factorPerRank: '1.1' }], description: 'Raises armor ×{value} per rank.' }),
  n('t_steadfast', 'aegis', 'Steadfast', 3, 1, { modifiers: [{ stat: 'player.maxHealth', factorPerRank: '1.07' }], description: 'Raises max health ×{value} per rank.' }),
  n('t_shield_slam', 'aegis', 'Shield Slam', 2, 1, { prereqs: [{ node: 't_shield_charge', rank: 1 }], mechanics: ['shield_slam'], upgrades: 't_shield_charge', description: 'Upgrades Shield Charge: ends in a slam for 0.8× and a 0.5s stun per rank.' }),
  n('t_guardians_path', 'aegis', 'Guardian\'s Path', 1, 2, { prereqs: [{ node: 't_shield_charge', rank: 1 }], excludes: ['t_juggernaut'], mechanics: ['guardians_path'], upgrades: 't_shield_charge', description: 'Upgrades Shield Charge: you and allies near its path gain a 10% shield.' }),
  n('t_juggernaut', 'aegis', 'Juggernaut', 1, 2, { prereqs: [{ node: 't_shield_charge', rank: 1 }], excludes: ['t_guardians_path'], mechanics: ['juggernaut'], upgrades: 't_shield_charge', description: 'Upgrades Shield Charge: carries enemies to the end for a 1× impact.' }),
  n('t_aegis_charge', 'aegis', 'Aegis Charge', 1, 2, { prereqs: [{ node: 't_shield_charge', rank: 1 }], excludes: ['t_intercession'], grantsSkill: 't_aegis_charge', description: 'Ends your Shield Charge in a 4s dome where allies take ×0.6 and projectiles break.' }),
  n('t_intercession', 'aegis', 'Intercession', 1, 2, { prereqs: [{ node: 't_shield_charge', rank: 1 }], excludes: ['t_aegis_charge'], grantsSkill: 't_intercession', description: 'Leaps to an ally and grants nearby allies an 18% Vow shield that bursts when broken.' }),
  n('t_guardian_angel', 'aegis', 'Guardian Angel', 1, 3, { mechanics: ['guardian_angel'], description: 'Makes revives near you ×1.5 faster, and downed allies bleed out at half speed.' }),
  n('t_divine_intervention', 'aegis', 'Divine Intervention', 1, 3, { mechanics: ['divine_intervention'], description: 'Saves you or a nearby ally from going down once per round, at 30% health.' }),
  n('t_living_bastion', 'aegis', 'Living Bastion', 1, 4, { prereqs: [{ node: 't_shield_charge', rank: 1 }], excludes: ['t_retribution'], mechanics: ['living_bastion'], description: 'Shields allies within 4 units: they take ×0.75 damage, with 25% redirected to you.' }),
  n('t_retribution', 'aegis', 'Retribution', 1, 4, { prereqs: [{ node: 't_shield_charge', rank: 1 }], excludes: ['t_living_bastion'], mechanics: ['retribution'], description: 'Stores 40% of damage taken; your next Aegis skill releases 200% of it as a nova.' }),
];

export const CLASS: ClassDef = {
  id: 'templar', name: 'Templar', tagline: 'Hammer, light and oath. Consecrates the ground, condemns the wicked and shields the faithful.',
  branches: [
    { id: 'radiance', name: 'Radiance', theme: 'Consecrated ground, healing light and blinding' },
    { id: 'judgment', name: 'Judgment', theme: 'Returning hammer, smites and condemn detonations' },
    { id: 'aegis', name: 'Aegis', theme: 'Shield charges, domes, vows and rescue' },
  ],
  accent: '#f2d16b', role: 'Holy frontliner · support',
  resource: { name: 'Zeal', max: 100, regenPerSec: 8 },
  base: { maxHealth: 1040, armor: 35, damage: 110, attackFrequency: 1.3, moveSpeed: 4.4, critTendency: '0.2', critMultiplier: '2', shieldCapacity: 0.7 },
  melee: true, basicSkill: 't_hammer', signatureSkill: 't_judgment_day',
  nodes: NODES.map((x) => x.id),
};
