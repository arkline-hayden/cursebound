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
  { id: 't_hammer', classId: 'templar', name: 'Hallowed Hammer', slot: 'basic', damageType: 'physical', damageCoef: '1', cooldownSec: 0, charges: 1,
    shape: { kind: 'arc', range: 2.2, arcDeg: 110 },
    description: `A heavy hammer swing (110° arc, 2.2 units). Every third swing releases a radiant shockwave: 0.9x astral damage in a 120° cone reaching 2.9 units. Connecting swings grant 4 Zeal. ${MELEE_PASSIVES}`,
    compressionSupport: true, icon: 'node:t_hammer' },
  { id: 't_judgment_day', classId: 'templar', name: 'Judgment Day', slot: 'signature', damageType: 'astral', damageCoef: '4', cooldownSec: 8.5, charges: 1,
    shape: { kind: 'circle', radius: 3, selfCentered: false, range: 6 },
    description: `Call a pillar of light onto the aimed point (up to 6 units). After 0.35s it crashes down: enemies within 3.5 units are dragged up to 2 units inward, then take 4x astral damage in a 3 unit radius and are stunned for 1.5s (bosses take 180 stagger). The ground stays consecrated for 5s: ${GROUND}.`,
    compressionSupport: true, icon: 'node:t_judgment_day' },
  // ---- Radiance ----
  { id: 't_consecrate', classId: 'templar', name: 'Consecrate', slot: 'active', damageType: 'astral', damageCoef: '0.35', cooldownSec: 5.5, charges: 1,
    shape: { kind: 'aura', radius: 2.6, duration: 5 },
    description: `Sanctify the ground around you (radius 2.6) for 5s: ${GROUND}.`, compressionSupport: true, icon: 'node:t_consecrate' },
  { id: 't_dawnbreak', classId: 'templar', name: 'Dawnbreak', slot: 'active', damageType: 'astral', damageCoef: '1.8', cooldownSec: 6.5, charges: 1,
    shape: { kind: 'circle', radius: 3.5, selfCentered: true, range: 0 }, knockback: 0.8,
    description: 'Erupt in a nova of dawn light (radius 3.5): 1.8x astral damage, enemies are stunned for 1s and knocked back (bosses take 60 stagger), allies inside heal 8% of their maximum health. Leaves Consecration (radius 2.6, 5s) under you.',
    compressionSupport: true, icon: 'node:t_dawnbreak' },
  { id: 't_beacon', classId: 'templar', name: 'Beacon of Light', slot: 'active', damageType: 'astral', damageCoef: '0.55', cooldownSec: 8.5, charges: 1,
    shape: { kind: 'aura', radius: 3, duration: 8 },
    description: 'Plant a radiant beacon on the aimed point (up to 6 units) for 8s. Every 0.5s it fires a holy bolt (0.55x astral) at the nearest enemy within 6 units and heals allies within 3 units for 1% of their maximum health.',
    compressionSupport: true, icon: 'node:t_beacon' },
  // ---- Judgment ----
  { id: 't_hammer_throw', classId: 'templar', name: 'Hammer of Judgment', slot: 'active', damageType: 'physical', damageCoef: '1.3', cooldownSec: 3.5, charges: 1,
    shape: { kind: 'projectile', speed: 14, radius: 0.55, range: 7, pierce: 999, spreadDeg: 20 },
    description: 'Hurl a spinning hammer up to 7 units. It strikes every enemy in its path for 1.3x physical damage, then flies back to you, striking each enemy again on the way back. Player projectile count throws more hammers.',
    compressionSupport: true, icon: 'node:t_hammer_throw' },
  { id: 't_skyfall', classId: 'templar', name: 'Skyfall Hammer', slot: 'active', damageType: 'physical', damageCoef: '1.3', cooldownSec: 4, charges: 1,
    shape: { kind: 'projectile', speed: 14, radius: 0.55, range: 7, pierce: 999, spreadDeg: 20 },
    description: 'Hurl the hammer at the aimed point (2 to 7 units), striking enemies in its path for 1.3x physical. Where it stops, a pillar of light smites a 2 unit radius for 2.2x astral damage and stuns for 0.8s (bosses take 50 stagger), then the hammer returns, striking again.',
    compressionSupport: true, icon: 'node:t_skyfall' },
  { id: 't_smite', classId: 'templar', name: 'Divine Smite', slot: 'active', damageType: 'astral', damageCoef: '2.4', cooldownSec: 3, charges: 2,
    shape: { kind: 'circle', radius: 3.5, selfCentered: false, range: 9 },
    description: 'Holds 2 charges. Lances of light strike the 3 enemies nearest the aimed point (up to 9 units away, within 3.5 units of it): 2.4x astral damage in a 1 unit radius around each, stunning for 0.5s (bosses take 30 stagger). With no enemy near, the light strikes the point itself.',
    compressionSupport: true, icon: 'node:t_smite' },
  // ---- Aegis ----
  { id: 't_shield_charge', classId: 'templar', name: 'Shield Charge', slot: 'active', damageType: 'physical', damageCoef: '1.6', cooldownSec: 4, charges: 1,
    shape: { kind: 'line', length: 5, width: 2, duration: 0.28, tickInterval: 0.28 }, knockback: 1.2,
    description: 'Charge 5 units behind your shield (stops at walls). Every enemy you plough into takes 1.6x physical damage and is hurled 1.2 units aside (bosses take 30 stagger). You take x0.5 damage while charging.',
    compressionSupport: true, icon: 'node:t_shield_charge' },
  { id: 't_aegis_charge', classId: 'templar', name: 'Aegis Charge', slot: 'active', damageType: 'physical', damageCoef: '1.6', cooldownSec: 7, charges: 1,
    shape: { kind: 'line', length: 5, width: 2, duration: 0.28, tickInterval: 0.28 }, knockback: 1.2,
    description: 'Shield Charge (5 units, 1.6x physical, x0.5 damage taken while charging), then raise an Aegis Dome (radius 3) where you stop for 4s: allies inside take x0.6 damage and enemy projectiles that enter the dome are destroyed.',
    compressionSupport: true, icon: 'node:t_aegis_charge' },
  { id: 't_intercession', classId: 'templar', name: 'Intercession', slot: 'active', damageType: 'physical', damageCoef: '1.2', cooldownSec: 6.5, charges: 1,
    shape: { kind: 'teleport', range: 8 },
    description: 'Leap (0.4s, untargetable) to the ally nearest your aim within 8 units, or 6 units along your aim. Landing deals 1.2x physical in a 2.2 unit radius and knocks enemies back. You and allies within 3 units take a Vow: a holy shield of 18% maximum health for 6s; when a Vow\'s shield breaks it bursts for 1.5x astral in a 2.2 unit radius.',
    compressionSupport: true, icon: 'node:t_intercession' },
];

export const NODES: NodeDef[] = [
  // ---- Templar / Radiance ----
  n('t_consecrate', 'radiance', 'Consecrate', 1, 0, { starting: true, grantsSkill: 't_consecrate', description: `Equip Consecrate (5.5s): sanctify the ground around you (radius 2.6) for 5s: ${GROUND}.` }),
  n('t_hallowed_ground', 'radiance', 'Hallowed Ground', 3, 1, { prereqs: [{ node: 't_consecrate', rank: 1 }], modifiers: [{ stat: 'skill.t_consecrate.damage', factorPerRank: '1.12' }], description: 'Consecrate damage x1.12 per rank. Applies to every consecrated ground you create (including Judgment Day\'s) and to Dawnbreak and Beacon of Light.' }),
  n('t_benediction', 'radiance', 'Benediction', 3, 1, { modifiers: [{ stat: 'player.holyHealing', factorPerRank: '1.1' }], description: 'Holy healing x1.1 per rank: every heal and shield you grant to yourself or allies.' }),
  n('t_radiant_core', 'radiance', 'Radiant Core', 2, 1, { modifiers: [{ stat: 'player.astralDamage', factorPerRank: '1.08' }], description: 'Astral damage x1.08 per rank (holy ground, shockwaves, smites, Judgment Day).' }),
  n('t_sanctuary', 'radiance', 'Sanctuary', 1, 2, { prereqs: [{ node: 't_consecrate', rank: 1 }], excludes: ['t_blinding_light'], mechanics: ['sanctuary'], description: 'Choice: the Consecration you create with Consecrate or Dawnbreak, and your Beacon of Light, move with you for their whole duration.' }),
  n('t_blinding_light', 'radiance', 'Blinding Light', 1, 2, { prereqs: [{ node: 't_consecrate', rank: 1 }], excludes: ['t_sanctuary'], mechanics: ['blinding_light'], description: 'Choice: Consecrate, Dawnbreak and Beacon of Light blind the enemies inside when cast: stunned for 1s (bosses take 40 stagger) and x1.15 damage taken for 4s.' }),
  n('t_dawnbreak', 'radiance', 'Dawnbreak', 1, 2, { prereqs: [{ node: 't_consecrate', rank: 1 }], excludes: ['t_beacon'], grantsSkill: 't_dawnbreak', description: 'Evolution: Consecrate becomes Dawnbreak (6.5s): a nova of light (radius 3.5) for 1.8x astral that stuns for 1s, knocks back and heals allies inside for 8% maximum health, leaving Consecration under you.' }),
  n('t_beacon', 'radiance', 'Beacon of Light', 1, 2, { prereqs: [{ node: 't_consecrate', rank: 1 }], excludes: ['t_dawnbreak'], grantsSkill: 't_beacon', description: 'Evolution: Consecrate becomes Beacon of Light (8.5s): an 8s beacon on the aimed point that fires a 0.55x astral bolt at the nearest enemy every 0.5s and heals allies within 3 units for 1% maximum health per pulse.' }),
  n('t_radiant_ward', 'radiance', 'Radiant Ward', 1, 3, { mechanics: ['radiant_ward'], description: 'Healing you grant beyond an ally\'s maximum health becomes a shield worth 50% of the excess.' }),
  n('t_searing_light', 'radiance', 'Searing Light', 1, 3, { mechanics: ['searing_light'], description: 'Each pulse of your holy ground leaves the enemies it hits taking x1.12 damage from all sources for 1s.' }),
  n('t_avenging_light', 'radiance', 'Avenging Light', 1, 4, { prereqs: [{ node: 't_consecrate', rank: 1 }], excludes: ['t_sanctum'], mechanics: ['avenging_light'], description: 'Keystone: every heal you grant (overhealing included) also strikes the enemy nearest the healed ally (within 5 units) for astral damage equal to 60% of the heal, times your astral damage multiplier.' }),
  n('t_sanctum', 'radiance', 'Holy Sanctum', 1, 4, { prereqs: [{ node: 't_consecrate', rank: 1 }], excludes: ['t_avenging_light'], mechanics: ['sanctum'], description: 'Keystone: allies standing in your holy ground (consecrated ground or the Beacon\'s 3 unit light) take x0.8 damage and attack x1.2 faster.' }),

  // ---- Templar / Judgment ----
  n('t_hammer_throw', 'judgment', 'Hammer of Judgment', 1, 0, { starting: true, grantsSkill: 't_hammer_throw', description: 'Equip Hammer of Judgment (3.5s): hurl a returning hammer up to 7 units; it strikes every enemy it passes for 1.3x physical on the way out and again on the way back.' }),
  n('t_weighted_head', 'judgment', 'Weighted Head', 3, 1, { prereqs: [{ node: 't_hammer_throw', rank: 1 }], modifiers: [{ stat: 'skill.t_hammer_throw.damage', factorPerRank: '1.12' }], description: 'Hammer of Judgment damage x1.12 per rank. Also applies to Skyfall Hammer (including its smite), Divine Smite and Heaven\'s Call.' }),
  n('t_zealotry', 'judgment', 'Zealotry', 3, 1, { modifiers: [{ stat: 'player.attackFrequency', factorPerRank: '1.05' }], description: 'Attack frequency x1.05 per rank (more swings, more shockwaves, more detonations).' }),
  n('t_condemnation', 'judgment', 'Condemnation', 2, 1, { prereqs: [{ node: 't_hammer_throw', rank: 1 }], mechanics: ['condemn'], description: 'Judgment hits (hammer strikes, smites) Condemn enemies for 6s. Your basic swings and shockwaves detonate Condemn: 0.8x astral damage per rank to every enemy within 1.8 units of the target.' }),
  n('t_shepherd', 'judgment', 'Shepherd\'s Return', 1, 2, { prereqs: [{ node: 't_hammer_throw', rank: 1 }], excludes: ['t_hammerfall'], mechanics: ['shepherd'], description: 'Choice: the returning hammer drags every enemy it strikes 1.5 units toward you (bosses take 25 stagger instead).' }),
  n('t_hammerfall', 'judgment', 'Grinding Halt', 1, 2, { prereqs: [{ node: 't_hammer_throw', rank: 1 }], excludes: ['t_shepherd'], mechanics: ['hammerfall'], description: 'Choice: at the end of its flight the hammer hovers for 1.2s, grinding every enemy within 1.5 units for 0.35x physical every 0.2s, before it returns.' }),
  n('t_skyfall', 'judgment', 'Skyfall Hammer', 1, 2, { prereqs: [{ node: 't_hammer_throw', rank: 1 }], excludes: ['t_smite'], grantsSkill: 't_skyfall', description: 'Evolution: Hammer of Judgment becomes Skyfall Hammer (4s): the hammer flies to the aimed point, a pillar of light smites 2 units around it for 2.2x astral and stuns for 0.8s, then the hammer returns.' }),
  n('t_smite', 'judgment', 'Divine Smite', 1, 2, { prereqs: [{ node: 't_hammer_throw', rank: 1 }], excludes: ['t_skyfall'], grantsSkill: 't_smite', description: 'Evolution: Hammer of Judgment becomes Divine Smite (3s, 2 charges): lances of light strike the 3 enemies nearest the aimed point for 2.4x astral in a 1 unit radius each and stun for 0.5s.' }),
  n('t_final_verdict', 'judgment', 'Final Verdict', 1, 3, { prereqs: [{ node: 't_condemnation', rank: 1 }], mechanics: ['final_verdict'], description: 'Condemn detonations deal x2.5 damage when the condemned enemy\'s front unit is below 35% health, and deal 40 stagger to bosses.' }),
  n('t_momentum', 'judgment', 'Righteous Momentum', 2, 3, { prereqs: [{ node: 't_condemnation', rank: 1 }], mechanics: ['momentum'], description: 'Each Condemn detonation cuts 0.5s per rank from your Judgment skill\'s cooldown and grants 3 Zeal per rank.' }),
  n('t_inquisitor', 'judgment', 'Inquisitor', 1, 4, { prereqs: [{ node: 't_condemnation', rank: 1 }], excludes: ['t_heavens_call'], mechanics: ['inquisitor'], description: 'Keystone: Condemn stacks up to 3 times (one stack per Judgment hit). A detonation deals its damage once per stack and spreads 1 stack to up to 3 enemies within 3 units.' }),
  n('t_heavens_call', 'judgment', 'Heaven\'s Call', 1, 4, { prereqs: [{ node: 't_hammer_throw', rank: 1 }], excludes: ['t_inquisitor'], mechanics: ['heavens_call'], description: 'Keystone: every Judgment skill cast calls down 3 smites, 0.2s apart, on random enemies within 7 units: 1x astral in a 1.2 unit radius each (they Condemn with Condemnation).' }),

  // ---- Templar / Aegis ----
  n('t_shield_charge', 'aegis', 'Shield Charge', 1, 0, { starting: true, grantsSkill: 't_shield_charge', description: 'Equip Shield Charge (4s): charge 5 units, dealing 1.6x physical to every enemy in your path and hurling them aside. You take x0.5 damage while charging.' }),
  n('t_bulwark_of_faith', 'aegis', 'Bulwark of Faith', 3, 1, { modifiers: [{ stat: 'player.armor', factorPerRank: '1.1' }], description: 'Armor x1.1 per rank.' }),
  n('t_steadfast', 'aegis', 'Steadfast', 3, 1, { modifiers: [{ stat: 'player.maxHealth', factorPerRank: '1.07' }], description: 'Maximum health x1.07 per rank.' }),
  n('t_shield_slam', 'aegis', 'Shield Slam', 2, 1, { prereqs: [{ node: 't_shield_charge', rank: 1 }], mechanics: ['shield_slam'], description: 'Your Aegis charges end in a Shield Slam: enemies within 1.8 units take 0.8x physical per rank and are stunned for 0.5s per rank (bosses take 30 stagger per rank).' }),
  n('t_guardians_path', 'aegis', 'Guardian\'s Path', 1, 2, { prereqs: [{ node: 't_shield_charge', rank: 1 }], excludes: ['t_juggernaut'], mechanics: ['guardians_path'], description: 'Choice: when an Aegis charge ends, you and every ally within 2 units of its path gain a shield of 10% maximum health.' }),
  n('t_juggernaut', 'aegis', 'Juggernaut', 1, 2, { prereqs: [{ node: 't_shield_charge', rank: 1 }], excludes: ['t_guardians_path'], mechanics: ['juggernaut'], description: 'Choice: enemies you charge into are pinned to your shield and carried to the end of the charge, where an impact deals 1x physical within 2 units.' }),
  n('t_aegis_charge', 'aegis', 'Aegis Charge', 1, 2, { prereqs: [{ node: 't_shield_charge', rank: 1 }], excludes: ['t_intercession'], grantsSkill: 't_aegis_charge', description: 'Evolution: Shield Charge becomes Aegis Charge (7s): the charge ends by raising a 4s Aegis Dome (radius 3): allies inside take x0.6 damage and enemy projectiles entering it are destroyed.' }),
  n('t_intercession', 'aegis', 'Intercession', 1, 2, { prereqs: [{ node: 't_shield_charge', rank: 1 }], excludes: ['t_aegis_charge'], grantsSkill: 't_intercession', description: 'Evolution: Shield Charge becomes Intercession (6.5s): leap to the ally nearest your aim (8 units) for 1.2x physical on landing; you and allies within 3 units gain a Vow shield of 18% maximum health that bursts for 1.5x astral when broken.' }),
  n('t_guardian_angel', 'aegis', 'Guardian Angel', 1, 3, { mechanics: ['guardian_angel'], description: 'Allies (and you) within 5 units of you revive downed players x1.5 faster, and downed allies within 5 units bleed out at half speed.' }),
  n('t_divine_intervention', 'aegis', 'Divine Intervention', 1, 3, { mechanics: ['divine_intervention'], description: 'Once per round, when you or an ally within 8 units would be downed, they are instead left at 30% maximum health and become invulnerable for 2s.' }),
  n('t_living_bastion', 'aegis', 'Living Bastion', 1, 4, { prereqs: [{ node: 't_shield_charge', rank: 1 }], excludes: ['t_retribution'], mechanics: ['living_bastion'], description: 'Keystone: you project a 4 unit aura. Allies inside (not you) take x0.75 damage, and 25% of the damage they would have taken is redirected to you (reduced by your armor and shields).' }),
  n('t_retribution', 'aegis', 'Retribution', 1, 4, { prereqs: [{ node: 't_shield_charge', rank: 1 }], excludes: ['t_living_bastion'], mechanics: ['retribution'], description: 'Keystone: 40% of the damage you take is stored as Retribution (up to 100% of your maximum health). Your next Aegis skill releases it where it ends as an astral nova (radius 2.6) dealing 200% of the stored amount.' }),
];

export const CLASS: ClassDef = {
  id: 'templar', name: 'Templar', tagline: 'Hammer, light and oath. Consecrates the ground, condemns the wicked and shields the faithful.',
  branches: [
    { id: 'radiance', name: 'Radiance', theme: 'Consecrated ground, healing light and blinding' },
    { id: 'judgment', name: 'Judgment', theme: 'Returning hammer, smites and condemn detonations' },
    { id: 'aegis', name: 'Aegis', theme: 'Shield charges, domes, vows and rescue' },
  ],
  accent: '#f2d16b', role: 'Holy frontliner · support',
  base: { maxHealth: 1040, armor: 35, damage: 110, attackFrequency: 1.3, moveSpeed: 4.4, critTendency: '0.2', critMultiplier: '2', shieldCapacity: 0.7 },
  melee: true, basicSkill: 't_hammer', signatureSkill: 't_judgment_day',
  nodes: NODES.map((x) => x.id),
};
