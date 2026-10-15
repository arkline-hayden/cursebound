import type { ClassDef, NodeDef, SkillDef } from '../types';
import { MELEE_PASSIVES, node } from './common';

// Vanguard: shield, cleaver and banner. Base kit (Cleave, Earthbreaker, Guard Stance, Sweeping Strike, Rally Cry) is
// implemented inline in simulation players.ts/combat.ts; evolved skills and the deeper tree live in
// packages/simulation/src/classes/vanguard.ts.

const n = (id: string, branch: string, name: string, rankLimit: number, tier: NodeDef['tier'], opts: Parameters<typeof node>[6]) => node(id, 'vanguard', branch, name, rankLimit, tier, opts);

export const SKILLS: SkillDef[] = [
  // ---------------- Vanguard ----------------
  { id: 'v_cleave', classId: 'vanguard', name: 'Cleave', slot: 'basic', damageType: 'physical', damageCoef: '1', cooldownSec: 0, charges: 1,
    shape: { kind: 'arc', range: 2.1, arcDeg: 120 }, description: `A broad melee swing in the aimed direction: a 120° arc reaching 2.1 units. Cleave Guard: each connecting swing shields you for 1.6% of maximum health. ${MELEE_PASSIVES}`, compressionSupport: true, icon: 'node:v_cleave' },
  { id: 'v_earthbreaker', classId: 'vanguard', name: 'Earthbreaker', slot: 'signature', damageType: 'physical', damageCoef: '4', cooldownSec: 8.5, charges: 1,
    shape: { kind: 'circle', radius: 2.6, selfCentered: true, range: 0 }, knockback: 1.6,
    description: 'Slam the ground: heavy physical damage around you and knockback. Builds boss stagger.', compressionSupport: true, icon: 'node:v_earthbreaker' },
  { id: 'v_guard_stance', classId: 'vanguard', name: 'Guard Stance', slot: 'active', damageType: 'physical', damageCoef: '0', cooldownSec: 4, charges: 1,
    shape: { kind: 'guard', duration: 2.0, arcDeg: 90 },
    description: 'Raise your shield for 2s: frontal damage is absorbed and 30% of it converts into shield. Completing a guard heals 4% maximum health.', compressionSupport: true, icon: 'node:v_guard_stance' },
  { id: 'v_sweeping_strike', classId: 'vanguard', name: 'Sweeping Strike', slot: 'active', damageType: 'physical', damageCoef: '2.2', cooldownSec: 3, charges: 1,
    shape: { kind: 'arc', range: 2.1, arcDeg: 150 }, description: 'A wide 150 degree melee arc on a short cooldown.', compressionSupport: true, icon: 'node:v_sweeping_strike' },
  { id: 'v_sundering_wave', classId: 'vanguard', name: 'Sundering Wave', slot: 'active', damageType: 'physical', damageCoef: '1.2', cooldownSec: 0, charges: 1,
    shape: { kind: 'projectile', speed: 10, radius: 0.55, range: 6, pierce: 99, spreadDeg: 18 }, description: 'Directional wave projected by Sweeping Strike.', compressionSupport: true, icon: 'node:v_sundering_path' },
  { id: 'v_rally_cry', classId: 'vanguard', name: 'Rally Cry', slot: 'active', damageType: 'physical', damageCoef: '0', cooldownSec: 10, charges: 1,
    shape: { kind: 'aura', radius: 4, duration: 6 }, description: 'For 6s, you and allies within 4 units gain Rally: skill cooldowns recover 35% faster.', compressionSupport: true, icon: 'node:v_rally_cry' },
  // ---- evolved skills ----
  { id: 'v_shield_charge', classId: 'vanguard', name: 'Shield Charge', slot: 'active', damageType: 'physical', damageCoef: '1.6', cooldownSec: 4, charges: 1,
    shape: { kind: 'line', length: 5, width: 2, duration: 0.3, tickInterval: 0 }, knockback: 1.4,
    description: 'Shield raised, charge 5 units in the aimed direction in 0.3s: every enemy in your path takes 1.6x physical damage and is hurled 1.4 units aside (90 boss stagger). Your guard holds for 1s after the charge.', compressionSupport: true, icon: 'node:v_shield_charge' },
  { id: 'v_retaliate', classId: 'vanguard', name: 'Retaliate', slot: 'active', damageType: 'physical', damageCoef: '2', cooldownSec: 5, charges: 1,
    shape: { kind: 'guard', duration: 1.5, arcDeg: 90 }, knockback: 1.8,
    description: 'Brace behind your shield for 1.5s (frontal damage absorbed, 30% becomes shield), then explode outward: 2x physical damage plus 150% of all damage you absorbed, within 3 units, knocking enemies back 1.8 (120 boss stagger).', compressionSupport: true, icon: 'node:v_retaliate' },
  { id: 'v_whirlwind', classId: 'vanguard', name: 'Whirlwind', slot: 'active', damageType: 'physical', damageCoef: '2', cooldownSec: 3.5, charges: 1,
    shape: { kind: 'line', length: 4, width: 4, duration: 0.3, tickInterval: 0 },
    description: 'Spin forward 4 units in 0.3s: every enemy within 2 units of your path is cut once for 2x physical damage and flung 0.9 units to the side of your path.', compressionSupport: true, icon: 'node:v_whirlwind' },
  { id: 'v_executioner', classId: 'vanguard', name: "Executioner's Chop", slot: 'active', damageType: 'physical', damageCoef: '3', cooldownSec: 3.5, charges: 1,
    shape: { kind: 'arc', range: 2.6, arcDeg: 80 },
    description: 'A heavy 80 degree overhead chop (range 2.6) for 3x physical damage. Enemies below 35% health are executed for x2.5 damage, and each execution kill cuts 1.5s from its cooldown. Bosses take 120 stagger.', compressionSupport: true, icon: 'node:v_executioner' },
  { id: 'v_war_banner', classId: 'vanguard', name: 'War Banner', slot: 'active', damageType: 'physical', damageCoef: '0.6', cooldownSec: 10, charges: 1,
    shape: { kind: 'aura', radius: 4, duration: 8 },
    description: 'Plant a war banner up to 5 units away for 8s. Each second it pulses: allies within 4 units gain Rally (skill cooldowns recover 35% faster) and enemies within 4 units take 0.6x physical damage.', compressionSupport: true, icon: 'node:v_war_banner' },
  { id: 'v_thunder_shout', classId: 'vanguard', name: 'Thunderous Shout', slot: 'active', damageType: 'physical', damageCoef: '1.5', cooldownSec: 8.5, charges: 1,
    shape: { kind: 'circle', radius: 5, selfCentered: true, range: 0 }, knockback: 2,
    description: 'A war cry that shakes the dungeon: enemies within 5 units take 1.5x physical damage, are blasted back 2 units and take x1.2 damage for 4s (100 boss stagger). You and allies within 5 units gain Rally for 4s.', compressionSupport: true, icon: 'node:v_thunder_shout' },
];

export const NODES: NodeDef[] = [
  // ---- Vanguard / Bulwark ----
  n('v_guard_stance', 'bulwark', 'Guard Stance', 1, 0, { starting: true, grantsSkill: 'v_guard_stance', description: 'Blocks frontal damage for 2s; 30% of it becomes a shield.' }),
  n('v_reinforced', 'bulwark', 'Reinforced', 3, 1, { modifiers: [{ stat: 'player.armor', factorPerRank: '1.1' }], description: 'Raises armor ×{value} per rank.' }),
  n('v_recovery_pulse', 'bulwark', 'Recovery Pulse', 2, 1, { prereqs: [{ node: 'v_guard_stance', rank: 1 }], modifiers: [{ stat: 'player.guardHeal', factorPerRank: '1.15' }], upgrades: 'v_guard_stance', description: 'Upgrades Guard Stance: completion heal ×{value} per rank, Shield Charge and Retaliate too.' }),
  n('v_shield_reach', 'bulwark', 'Shield Reach', 1, 1, { prereqs: [{ node: 'v_guard_stance', rank: 1 }], mechanics: ['guard_arc_120'], upgrades: 'v_guard_stance', description: 'Upgrades Guard Stance: guard arc 90° → 120°, all guard skills.' }),
  n('v_shared_shelter', 'bulwark', 'Shared Shelter', 1, 2, { prereqs: [{ node: 'v_guard_stance', rank: 1 }], mechanics: ['guard_share'], upgrades: 'v_guard_stance', description: 'Upgrades Guard Stance: the nearest ally within 3 units gets 20% of your guard shield.' }),
  n('v_shield_charge', 'bulwark', 'Shield Charge', 1, 2, { prereqs: [{ node: 'v_guard_stance', rank: 1 }], grantsSkill: 'v_shield_charge', excludes: ['v_retaliate'],
    description: 'Charges 5 units behind your shield for 1.6×, hurling enemies aside, then guards 1s.' }),
  n('v_retaliate', 'bulwark', 'Retaliate', 1, 2, { prereqs: [{ node: 'v_guard_stance', rank: 1 }], grantsSkill: 'v_retaliate', excludes: ['v_shield_charge'],
    description: 'Braces behind your shield for 1.5s, then detonates for 2× plus 150% of damage absorbed.' }),
  n('v_bastion', 'bulwark', 'Bastion', 1, 3, { prereqs: [{ node: 'v_shared_shelter', rank: 1 }], mechanics: ['bastion'], description: 'Makes guarding in place raise a shelter (radius 2.5) where allies take ×0.6 damage.' }),
  n('v_provoke', 'bulwark', 'Provoke', 1, 3, { prereqs: [{ node: 'v_guard_stance', rank: 1 }], mechanics: ['provoke'],
    upgrades: 'v_guard_stance', description: 'Upgrades Guard Stance: taunts enemies within 5 units, who take ×1.15 damage for 3s.' }),
  n('v_unbreakable', 'bulwark', 'Unbreakable', 1, 4, { excludes: ['v_iron_maelstrom'], modifiers: [{ stat: 'player.guardHeal', factorPerRank: '1.5' }], mechanics: ['unbreakable'],
    upgrades: 'v_guard_stance', description: 'Upgrades Guard Stance: guards all around (360°), lasts +1s, and heals ×{value}.' }),
  n('v_iron_maelstrom', 'bulwark', 'Iron Maelstrom', 1, 4, { excludes: ['v_unbreakable'], mechanics: ['iron_maelstrom'],
    upgrades: 'v_guard_stance', description: 'Upgrades Guard Stance: while guarding, pulse 0.6× every 0.5s and pull enemies in.' }),
  // ---- Vanguard / Cleaver ----
  n('v_sweeping_strike', 'cleaver', 'Sweeping Strike', 1, 0, { starting: true, grantsSkill: 'v_sweeping_strike', description: 'Swings a 150° arc for 2.2× physical damage.' }),
  n('v_heavy_edge', 'cleaver', 'Heavy Edge', 3, 1, { modifiers: [{ stat: 'skill.v_sweeping_strike.damage', factorPerRank: '1.1' }], upgrades: 'v_sweeping_strike', description: 'Upgrades Sweeping Strike: damage ×{value} per rank, evolutions too.' }),
  n('v_deep_cut', 'cleaver', 'Deep Cut', 2, 1, { prereqs: [{ node: 'v_sweeping_strike', rank: 1 }], mechanics: ['bleed'], upgrades: 'v_sweeping_strike', description: 'Upgrades Sweeping Strike: adds a bleed of 10% per rank per second for 3s.' }),
  n('v_fracture', 'cleaver', 'Fracture', 1, 1, { prereqs: [{ node: 'v_sweeping_strike', rank: 1 }], mechanics: ['fracture'], upgrades: 'v_sweeping_strike', description: 'Upgrades Sweeping Strike: enemies hit take ×1.1 damage for 2s.' }),
  n('v_follow_through', 'cleaver', 'Follow Through', 1, 2, { prereqs: [{ node: 'v_sweeping_strike', rank: 1 }], mechanics: ['follow_through'], upgrades: 'v_sweeping_strike', description: 'Upgrades Sweeping Strike: a kill restores its charge, once per cast.' }),
  n('v_whirlwind', 'cleaver', 'Whirlwind', 1, 2, { prereqs: [{ node: 'v_sweeping_strike', rank: 1 }], grantsSkill: 'v_whirlwind', excludes: ['v_executioner'],
    description: 'Spins 4 units forward, cutting everything within 2 units of your path for 2×.' }),
  n('v_executioner', 'cleaver', "Executioner's Chop", 1, 2, { prereqs: [{ node: 'v_sweeping_strike', rank: 1 }], grantsSkill: 'v_executioner', excludes: ['v_whirlwind'],
    description: 'Chops for 3×, ×2.5 below 35% health; execution kills cut 1.5s from its cooldown.' }),
  n('v_sundering_path', 'cleaver', 'Sundering Path', 1, 3, { prereqs: [{ node: 'v_fracture', rank: 1 }], mechanics: ['sundering_wave'], upgrades: 'v_sweeping_strike', description: 'Upgrades Sweeping Strike: also sends a piercing wave for 1.2×, evolutions too.' }),
  n('v_aftershock', 'cleaver', 'Aftershock', 1, 3, { prereqs: [{ node: 'v_sweeping_strike', rank: 1 }], mechanics: ['aftershock'],
    description: 'Adds an aftershock to Earthbreaker and Sweeping Strike for 60% of the hit, 0.5s later.' }),
  n('v_warlord_leap', 'cleaver', "Warlord's Leap", 1, 4, { excludes: ['v_rampage'], mechanics: ['warlord_leap'],
    upgrades: 'v_earthbreaker', description: 'Upgrades Earthbreaker: becomes a 6-unit leap that slams for ×1.4 damage.' }),
  n('v_rampage', 'cleaver', 'Rampage', 1, 4, { excludes: ['v_warlord_leap'], mechanics: ['rampage'],
    description: 'Grants ×1.1 attack speed per kill for 5s (max 5); at 5 stacks, Cleave throws waves.' }),
  // ---- Vanguard / Rally ----
  n('v_rally_cry', 'rally', 'Rally Cry', 1, 0, { starting: true, grantsSkill: 'v_rally_cry', description: 'Rallies you and allies within 4 units for 6s: cooldowns recover 35% faster.' }),
  n('v_endurance', 'rally', 'Endurance', 3, 1, { modifiers: [{ stat: 'player.maxHealth', factorPerRank: '1.1' }], description: 'Raises max health ×{value} per rank.' }),
  n('v_second_wind', 'rally', 'Second Wind', 2, 1, { modifiers: [{ stat: 'player.dodgeHeal', factorPerRank: '1.1' }], mechanics: ['dodge_heal'], description: 'Heals 3% max health when you dodge; dodge healing ×{value} per rank.' }),
  n('v_rescue_pace', 'rally', 'Rescue Pace', 1, 1, { modifiers: [{ stat: 'player.reviveSpeed', factorPerRank: '1.2' }], description: 'Speeds up reviving allies ×{value}.' }),
  n('v_unbroken_rhythm', 'rally', 'Unbroken Rhythm', 1, 2, { mechanics: ['revive_resets_dodge'], description: 'Resets your dodge when you finish a revive, including your solo self-revive.' }),
  n('v_war_banner', 'rally', 'War Banner', 1, 2, { prereqs: [{ node: 'v_rally_cry', rank: 1 }], grantsSkill: 'v_war_banner', excludes: ['v_thunder_shout'],
    description: 'Plants an 8s banner that pulses Rally and 0.6× physical damage within 4 units.' }),
  n('v_thunder_shout', 'rally', 'Thunderous Shout', 1, 2, { prereqs: [{ node: 'v_rally_cry', rank: 1 }], grantsSkill: 'v_thunder_shout', excludes: ['v_war_banner'],
    description: 'Blasts foes within 5 units for 1.5×, knocks back, ×1.2 damage taken; Rallies allies.' }),
  n('v_standard_bearer', 'rally', 'Standard Bearer', 1, 3, { prereqs: [{ node: 'v_unbroken_rhythm', rank: 1 }, { node: 'v_rally_cry', rank: 1 }], mechanics: ['rally_shield'], upgrades: 'v_rally_cry', description: 'Upgrades Rally Cry: affected allies also gain a 15% max health shield, evolutions too.' }),
  n('v_valor', 'rally', 'Valor', 1, 3, { prereqs: [{ node: 'v_rally_cry', rank: 1 }], mechanics: ['valor'],
    upgrades: 'v_rally_cry', description: 'Upgrades Rally Cry: heals affected allies 8% and refills their dodges, evolutions too.' }),
  n('v_last_stand', 'rally', 'Last Stand', 1, 4, { excludes: ['v_warchief'], mechanics: ['last_stand'],
    description: 'Saves you from going down once per round: 1 health, 2s untouchable, 30% shield.' }),
  n('v_warchief', 'rally', 'Warchief', 1, 4, { excludes: ['v_last_stand'], mechanics: ['warchief'],
    description: 'Keystone: you and allies within 4 units always have Rally; your Rally skill recovers 50% faster.' }),
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
