import type { ClassDef, NodeDef, SkillDef } from '../types';
import { MELEE_PASSIVES, node } from './common';

// Vanguard: shield, cleaver and banner. Base kit (Cleave, Earthbreaker, Guard Stance, Sweeping Strike, Rally Cry) is
// implemented inline in simulation players.ts/combat.ts; evolved skills and the deeper tree live in
// packages/simulation/src/classes/vanguard.ts.

const n = (id: string, branch: string, name: string, rankLimit: number, tier: NodeDef['tier'], opts: Parameters<typeof node>[6]) => node(id, 'vanguard', branch, name, rankLimit, tier, opts);

export const SKILLS: SkillDef[] = [
  // ---------------- Vanguard ----------------
  { id: 'v_cleave', classId: 'vanguard', name: 'Cleave', slot: 'basic', damageType: 'physical', damageCoef: '1', cooldownSec: 0, charges: 1,
    shape: { kind: 'arc', range: 2.1, arcDeg: 120 }, description: `A broad melee swing in the aimed direction: a 120° arc reaching 2.1 units. Each connecting swing shields you for 1.6% of maximum health. ${MELEE_PASSIVES}`, compressionSupport: true, icon: 'node:v_cleave' },
  { id: 'v_earthbreaker', classId: 'vanguard', name: 'Earthbreaker', slot: 'signature', damageType: 'physical', damageCoef: '4', cooldownSec: 8.5, charges: 1,
    shape: { kind: 'circle', radius: 2.6, selfCentered: true, range: 0 }, knockback: 1.6,
    description: 'Slam the ground for 4x physical damage around you (radius 2.6) with knockback. Builds boss stagger.', compressionSupport: true, icon: 'node:v_earthbreaker' },
  { id: 'v_guard_stance', classId: 'vanguard', name: 'Guard Stance', slot: 'active', damageType: 'physical', damageCoef: '0', cooldownSec: 4, charges: 1,
    shape: { kind: 'guard', duration: 2.0, arcDeg: 90 },
    description: 'Guard for 2s: damage from the front is blocked and 30% of it becomes shield. A full guard heals 4% maximum health.', compressionSupport: true, icon: 'node:v_guard_stance' },
  { id: 'v_sweeping_strike', classId: 'vanguard', name: 'Sweeping Strike', slot: 'active', damageType: 'physical', damageCoef: '2.2', cooldownSec: 3, charges: 1,
    shape: { kind: 'arc', range: 2.1, arcDeg: 150 }, description: 'A wide 150° melee arc (range 2.1) for 2.2x physical damage.', compressionSupport: true, icon: 'node:v_sweeping_strike' },
  { id: 'v_sundering_wave', classId: 'vanguard', name: 'Sundering Wave', slot: 'active', damageType: 'physical', damageCoef: '1.2', cooldownSec: 0, charges: 1,
    shape: { kind: 'projectile', speed: 10, radius: 0.55, range: 6, pierce: 99, spreadDeg: 18 }, description: 'Piercing wave sent by Sweeping Strike (Sundering Path).', compressionSupport: true, icon: 'node:v_sundering_path' },
  { id: 'v_rally_cry', classId: 'vanguard', name: 'Rally Cry', slot: 'active', damageType: 'physical', damageCoef: '0', cooldownSec: 10, charges: 1,
    shape: { kind: 'aura', radius: 4, duration: 6 }, description: 'For 6s, you and allies within 4 units gain Rally: skill cooldowns recover 35% faster.', compressionSupport: true, icon: 'node:v_rally_cry' },
  // ---- evolved skills ----
  { id: 'v_shield_charge', classId: 'vanguard', name: 'Shield Charge', slot: 'active', damageType: 'physical', damageCoef: '1.6', cooldownSec: 4, charges: 1,
    shape: { kind: 'line', length: 5, width: 2, duration: 0.3, tickInterval: 0 }, knockback: 1.4,
    description: 'Shield raised, rush 5 units in the aimed direction in 0.3s: every enemy in your path takes 1.6x physical damage and is shoved 1.4 units aside (knockback, 90 boss stagger). Your guard holds for 1s after the rush.', compressionSupport: true, icon: 'node:v_shield_charge' },
  { id: 'v_retaliate', classId: 'vanguard', name: 'Retaliate', slot: 'active', damageType: 'physical', damageCoef: '2', cooldownSec: 5, charges: 1,
    shape: { kind: 'guard', duration: 1.5, arcDeg: 90 }, knockback: 1.8,
    description: 'Guard behind your shield for 1.5s (damage from the front is blocked, 30% becomes shield), then burst outward: 2x physical damage plus 150% of all damage you blocked, within 3 units, with knockback 1.8 (120 boss stagger).', compressionSupport: true, icon: 'node:v_retaliate' },
  { id: 'v_whirlwind', classId: 'vanguard', name: 'Whirlwind', slot: 'active', damageType: 'physical', damageCoef: '2', cooldownSec: 3.5, charges: 1,
    shape: { kind: 'line', length: 4, width: 4, duration: 0.3, tickInterval: 0 },
    description: 'Spin forward 4 units in 0.3s: every enemy within 2 units of your path is cut once for 2x physical damage and flung 0.9 units to the side of your path.', compressionSupport: true, icon: 'node:v_whirlwind' },
  { id: 'v_executioner', classId: 'vanguard', name: "Executioner's Chop", slot: 'active', damageType: 'physical', damageCoef: '3', cooldownSec: 3.5, charges: 1,
    shape: { kind: 'arc', range: 2.6, arcDeg: 80 },
    description: 'A heavy 80° overhead chop (range 2.6) for 3x physical damage, x2.5 against non-boss enemies below 35% health; each such kill cuts 1.5s from its cooldown (at most 2 per chop). Bosses take 120 stagger.', compressionSupport: true, icon: 'node:v_executioner' },
  { id: 'v_war_banner', classId: 'vanguard', name: 'War Banner', slot: 'active', damageType: 'physical', damageCoef: '0.6', cooldownSec: 10, charges: 1,
    shape: { kind: 'aura', radius: 4, duration: 8 },
    description: 'Plant a war banner up to 5 units away for 8s. Each second it pulses: allies within 4 units gain Rally (skill cooldowns recover 35% faster) and enemies within 4 units take 0.6x physical damage.', compressionSupport: true, icon: 'node:v_war_banner' },
  { id: 'v_thunder_shout', classId: 'vanguard', name: 'Thunderous Shout', slot: 'active', damageType: 'physical', damageCoef: '1.5', cooldownSec: 8.5, charges: 1,
    shape: { kind: 'circle', radius: 5, selfCentered: true, range: 0 }, knockback: 2,
    description: 'A war cry that shakes the dungeon: enemies within 5 units take 1.5x physical damage with knockback 2 and are Vulnerable (x1.2) for 4s (100 boss stagger). You and allies within 5 units gain Rally for 4s.', compressionSupport: true, icon: 'node:v_thunder_shout' },
];

export const NODES: NodeDef[] = [
  // ---- Vanguard / Bulwark ----
  n('v_guard_stance', 'bulwark', 'Guard Stance', 1, 0, { starting: true, grantsSkill: 'v_guard_stance', description: 'Guards your front for 2s; 30% of the damage blocked becomes shield.' }),
  n('v_reinforced', 'bulwark', 'Reinforced', 3, 1, { modifiers: [{ stat: 'player.armor', factorPerRank: '1.1' }], description: 'Raises armor ×{value} per rank.' }),
  n('v_recovery_pulse', 'bulwark', 'Recovery Pulse', 2, 1, { prereqs: [{ node: 'v_guard_stance', rank: 1 }], modifiers: [{ stat: 'player.guardHeal', factorPerRank: '1.15' }], upgrades: 'v_guard_stance', description: 'Upgrades Guard Stance: the heal for a full guard ×{value} per rank, Shield Charge and Retaliate too.' }),
  n('v_shield_reach', 'bulwark', 'Shield Reach', 1, 1, { prereqs: [{ node: 'v_guard_stance', rank: 1 }], mechanics: ['guard_arc_120'], upgrades: 'v_guard_stance', description: 'Upgrades Guard Stance: guard arc 90° → 120°, all guard skills.' }),
  n('v_shared_shelter', 'bulwark', 'Shared Shelter', 1, 2, { prereqs: [{ node: 'v_guard_stance', rank: 1 }], mechanics: ['guard_share'], upgrades: 'v_guard_stance', description: 'Upgrades Guard Stance: the nearest ally within 3 units gets 20% of your guard shield.' }),
  n('v_shield_charge', 'bulwark', 'Shield Charge', 1, 2, { prereqs: [{ node: 'v_guard_stance', rank: 1 }], grantsSkill: 'v_shield_charge', excludes: ['v_retaliate'],
    description: 'Rushes 5 units behind your shield for 1.6× with knockback, then guards for 1s.' }),
  n('v_retaliate', 'bulwark', 'Retaliate', 1, 2, { prereqs: [{ node: 'v_guard_stance', rank: 1 }], grantsSkill: 'v_retaliate', excludes: ['v_shield_charge'],
    description: 'Guards behind your shield for 1.5s, then bursts for 2× plus 150% of the damage blocked.' }),
  n('v_bastion', 'bulwark', 'Bastion', 1, 3, { prereqs: [{ node: 'v_shared_shelter', rank: 1 }], mechanics: ['bastion'], description: 'Makes guarding in place raise a shelter (radius 2.5) where allies take ×0.6 damage.' }),
  n('v_provoke', 'bulwark', 'Provoke', 1, 3, { prereqs: [{ node: 'v_guard_stance', rank: 1 }], mechanics: ['provoke'],
    upgrades: 'v_guard_stance', description: 'Upgrades Guard Stance: taunts enemies within 5 units and makes them Vulnerable (×1.15) for 3s.' }),
  n('v_unbreakable', 'bulwark', 'Unbreakable', 1, 4, { prereqs: [{ node: 'v_guard_stance', rank: 1 }], excludes: ['v_iron_maelstrom'], modifiers: [{ stat: 'player.guardHeal', factorPerRank: '1.5' }], mechanics: ['unbreakable'],
    upgrades: 'v_guard_stance', description: 'Upgrades Guard Stance: guards all around (360°) for 1s longer, and its heal ×{value}.' }),
  n('v_iron_maelstrom', 'bulwark', 'Iron Maelstrom', 1, 4, { prereqs: [{ node: 'v_guard_stance', rank: 1 }], excludes: ['v_unbreakable'], mechanics: ['iron_maelstrom'],
    upgrades: 'v_guard_stance', description: 'Upgrades Guard Stance: while guarding, pulses for 0.6× every 0.5s and pulls enemies in.' }),
  // ---- Vanguard / Cleaver ----
  n('v_sweeping_strike', 'cleaver', 'Sweeping Strike', 1, 0, { starting: true, grantsSkill: 'v_sweeping_strike', description: 'Swings a 150° arc for 2.2× physical damage.' }),
  n('v_heavy_edge', 'cleaver', 'Heavy Edge', 3, 1, { prereqs: [{ node: 'v_sweeping_strike', rank: 1 }], modifiers: [{ stat: 'skill.v_sweeping_strike.damage', factorPerRank: '1.1' }], upgrades: 'v_sweeping_strike', description: 'Upgrades Sweeping Strike: damage ×{value} per rank, evolutions too.' }),
  n('v_deep_cut', 'cleaver', 'Deep Cut', 2, 1, { prereqs: [{ node: 'v_sweeping_strike', rank: 1 }], mechanics: ['bleed'], upgrades: 'v_sweeping_strike', description: 'Upgrades Sweeping Strike: hits bleed for 10% per rank per second for 3s, evolutions too.' }),
  n('v_fracture', 'cleaver', 'Fracture', 1, 1, { prereqs: [{ node: 'v_sweeping_strike', rank: 1 }], mechanics: ['fracture'], upgrades: 'v_sweeping_strike', description: 'Upgrades Sweeping Strike: enemies hit are Vulnerable (×1.1) for 2s.' }),
  n('v_follow_through', 'cleaver', 'Follow Through', 1, 2, { prereqs: [{ node: 'v_sweeping_strike', rank: 1 }], mechanics: ['follow_through'], upgrades: 'v_sweeping_strike', description: 'Upgrades Sweeping Strike: a kill restores its charge, once per cast.' }),
  n('v_whirlwind', 'cleaver', 'Whirlwind', 1, 2, { prereqs: [{ node: 'v_sweeping_strike', rank: 1 }], grantsSkill: 'v_whirlwind', excludes: ['v_executioner'],
    description: 'Spins 4 units forward, cutting everything within 2 units of your path for 2×.' }),
  n('v_executioner', 'cleaver', "Executioner's Chop", 1, 2, { prereqs: [{ node: 'v_sweeping_strike', rank: 1 }], grantsSkill: 'v_executioner', excludes: ['v_whirlwind'],
    description: 'Chops for 3×, ×2.5 below 35% health; kills below 35% cut 1.5s from its cooldown.' }),
  n('v_sundering_path', 'cleaver', 'Sundering Path', 1, 3, { prereqs: [{ node: 'v_sweeping_strike', rank: 1 }], mechanics: ['sundering_wave'], upgrades: 'v_sweeping_strike', description: 'Upgrades Sweeping Strike: also sends a piercing wave for 1.2×, evolutions too.' }),
  n('v_aftershock', 'cleaver', 'Aftershock', 1, 3, { prereqs: [{ node: 'v_sweeping_strike', rank: 1 }], mechanics: ['aftershock'],
    description: 'Makes Earthbreaker and Sweeping Strike (evolutions too) quake again 0.5s later for 60%.' }),
  n('v_warlord_leap', 'cleaver', "Warlord's Leap", 1, 4, { excludes: ['v_rampage'], mechanics: ['warlord_leap'],
    upgrades: 'v_earthbreaker', description: 'Upgrades Earthbreaker: becomes a 6-unit leap that slams for ×1.4 damage.' }),
  n('v_rampage', 'cleaver', 'Rampage', 1, 4, { excludes: ['v_warlord_leap'], mechanics: ['rampage'],
    description: 'Grants ×1.1 attack speed per kill for 5s (max 5); at 5 stacks, Cleave throws waves.' }),
  // ---- Vanguard / Rally ----
  n('v_rally_cry', 'rally', 'Rally Cry', 1, 0, { starting: true, grantsSkill: 'v_rally_cry', description: 'Rallies you and allies within 4 units for 6s.' }),
  n('v_endurance', 'rally', 'Endurance', 3, 1, { modifiers: [{ stat: 'player.maxHealth', factorPerRank: '1.1' }], description: 'Raises max health ×{value} per rank.' }),
  n('v_second_wind', 'rally', 'Second Wind', 2, 1, { modifiers: [{ stat: 'player.dodgeHeal', factorPerRank: '1.1' }], mechanics: ['dodge_heal'], description: 'Heals 3% max health when you dodge; dodge healing ×{value} per rank.' }),
  n('v_rescue_pace', 'rally', 'Rescue Pace', 1, 1, { modifiers: [{ stat: 'player.reviveSpeed', factorPerRank: '1.2' }], description: 'Speeds up reviving allies ×{value}.' }),
  n('v_unbroken_rhythm', 'rally', 'Unbroken Rhythm', 1, 2, { mechanics: ['revive_resets_dodge'], description: 'Refills a dodge charge when you finish a revive, your solo self-revive included.' }),
  n('v_war_banner', 'rally', 'War Banner', 1, 2, { prereqs: [{ node: 'v_rally_cry', rank: 1 }], grantsSkill: 'v_war_banner', excludes: ['v_thunder_shout'],
    description: 'Plants an 8s banner that pulses Rally and 0.6× physical damage within 4 units.' }),
  n('v_thunder_shout', 'rally', 'Thunderous Shout', 1, 2, { prereqs: [{ node: 'v_rally_cry', rank: 1 }], grantsSkill: 'v_thunder_shout', excludes: ['v_war_banner'],
    description: 'Blasts enemies within 5 units for 1.5× with knockback and Vulnerable (×1.2), and Rallies allies.' }),
  n('v_standard_bearer', 'rally', 'Standard Bearer', 1, 3, { prereqs: [{ node: 'v_rally_cry', rank: 1 }], mechanics: ['rally_shield'], upgrades: 'v_rally_cry', description: 'Upgrades Rally Cry: Rallied allies also gain a 15% max health shield, evolutions too.' }),
  n('v_valor', 'rally', 'Valor', 1, 3, { prereqs: [{ node: 'v_rally_cry', rank: 1 }], mechanics: ['valor'],
    upgrades: 'v_rally_cry', description: 'Upgrades Rally Cry: heals Rallied allies 8% and refills their dodges, evolutions too.' }),
  n('v_last_stand', 'rally', 'Last Stand', 1, 4, { excludes: ['v_warchief'], mechanics: ['last_stand'],
    description: 'Saves you from going down once per round: 1 health, 2s invulnerable and a 30% shield.' }),
  n('v_warchief', 'rally', 'Warchief', 1, 4, { excludes: ['v_last_stand'], mechanics: ['warchief'],
    description: 'You and allies within 4 units always have Rally, and your Rally skill recovers 50% faster.' }),
];

export const CLASS: ClassDef = {
    id: 'vanguard', name: 'Vanguard', tagline: 'Shield, cleaver and banner. Holds the line and lifts the party.',
    branches: [
      { id: 'bulwark', name: 'Bulwark', theme: 'Guard conversion, charges and retaliation' },
      { id: 'cleaver', name: 'Cleaver', theme: 'Melee cleave, executions and earth-shaking leaps' },
      { id: 'rally', name: 'Rally', theme: 'Banners, war cries, endurance and rescue' },
    ],
    accent: '#e0a040', role: 'Frontline melee · protector',
    base: { maxHealth: 1000, armor: 50, damage: 105, attackFrequency: 2.2, moveSpeed: 4.6, critTendency: '0.25', critMultiplier: '2', shieldCapacity: 0.6 },
    melee: true, basicSkill: 'v_cleave', signatureSkill: 'v_earthbreaker',
    nodes: NODES.map((x) => x.id),
  };
