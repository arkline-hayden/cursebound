import type { ClassDef, NodeDef, SkillDef } from '../types';
import { node } from './common';

// Artificer: ranged engineer with deployables and explosives. Implemented in simulation/src/classes/artificer.ts.
// Branch skill families (evolutions replace the base active in its slot and inherit its tree modifiers):
//  Turrets: Deploy Turret -> Flame Turret | Tesla Coil.  Ordnance: Steam Grenade -> Cluster Charge | Firebomb.
//  Clockwork: Overclock -> Rocket Jump | Boiler Overdrive.
// HUD counters: vars.ui_turrets (active turrets). Overclock shows as the 'af_overclock' buff.

const n = (id: string, branch: string, name: string, rankLimit: number, tier: NodeDef['tier'], opts: Parameters<typeof node>[6]) => node(id, 'artificer', branch, name, rankLimit, tier, opts);

export const SKILLS: SkillDef[] = [
  { id: 'af_repeater', classId: 'artificer', name: 'Repeater', slot: 'basic', damageType: 'physical', damageCoef: '0.9', resourceCost: 0, cooldownSec: 0, charges: 1,
    shape: { kind: 'projectile', speed: 15, radius: 0.2, range: 9, pierce: 0, spreadDeg: 6 },
    description: 'Repeater crossbow: rapid brass bolts (range 9) for 0.9x damage.', compressionSupport: true, icon: 'node:af_repeater' },
  { id: 'af_mortar_barrage', classId: 'artificer', name: 'Mortar Barrage', slot: 'signature', damageType: 'ember', damageCoef: '1.1', resourceCost: 35, cooldownSec: 13, charges: 1,
    shape: { kind: 'circle', radius: 3.2, selfCentered: false, range: 8 }, knockback: 0.5,
    description: 'Call down 8 mortar shells around the aimed point (up to 8 units away): one on the point and 7 in a ring of radius 2.2. Shells land from 0.6s after the call, 0.15s apart, each exploding within 1.4 units for 1.1x ember damage with knockback. Builds boss stagger.',
    compressionSupport: true, icon: 'node:af_mortar_barrage' },
  // ---- Turret family ----
  { id: 'af_turret', classId: 'artificer', name: 'Deploy Turret', slot: 'active', damageType: 'physical', damageCoef: '0.5', resourceCost: 25, cooldownSec: 8, charges: 1,
    shape: { kind: 'aura', radius: 7, duration: 10 },
    description: 'Deploy an auto-turret at the aimed point (up to 4 units away) for 10s. It fires a bolt at the nearest visible enemy within 7 units every 0.5s for 0.5x damage. Up to 2 turrets; deploying more replaces the oldest.', compressionSupport: true, icon: 'node:af_turret' },
  { id: 'af_flame_turret', classId: 'artificer', name: 'Flame Turret', slot: 'active', damageType: 'ember', damageCoef: '0.35', resourceCost: 25, cooldownSec: 8, charges: 1,
    shape: { kind: 'aura', radius: 4, duration: 10 }, dot: { type: 'ember', fractionPerSec: '0.25', durationSec: 3 },
    description: 'Deploy a flamethrower turret for 10s. Every 0.25s it sprays a 4-unit, 60° cone of fire at the nearest enemy for 0.35x ember damage, burning targets for 25% of the hit per second for 3s.', compressionSupport: true, icon: 'node:af_flame_turret' },
  { id: 'af_tesla_coil', classId: 'artificer', name: 'Tesla Coil', slot: 'active', damageType: 'storm', damageCoef: '0.9', resourceCost: 28, cooldownSec: 9, charges: 1,
    shape: { kind: 'chain', range: 6, jumpRange: 3.5, jumps: 3 },
    description: 'Deploy a tesla coil for 10s. Every 0.8s it zaps the nearest enemy within 6 units for 0.9x storm damage, chaining to 3 more enemies within 3.5 units of each other.', compressionSupport: true, icon: 'node:af_tesla_coil' },
  // ---- Grenade family ----
  { id: 'af_grenade', classId: 'artificer', name: 'Steam Grenade', slot: 'active', damageType: 'ember', damageCoef: '2', resourceCost: 18, cooldownSec: 5, charges: 2,
    shape: { kind: 'circle', radius: 1.8, selfCentered: false, range: 7 }, knockback: 0.8,
    description: 'Lob a grenade to the aimed point (up to 7 units). It lands after 0.45s and explodes within 1.8 units for 2x ember damage, knocking enemies back 0.8. Holds 2 charges.', compressionSupport: true, icon: 'node:af_grenade' },
  { id: 'af_cluster_charge', classId: 'artificer', name: 'Cluster Charge', slot: 'active', damageType: 'ember', damageCoef: '1.6', resourceCost: 22, cooldownSec: 6, charges: 2,
    shape: { kind: 'circle', radius: 1.6, selfCentered: false, range: 7 }, knockback: 0.8,
    description: 'Lob a cluster charge: it explodes within 1.6 units for 1.6x ember damage and scatters 4 bomblets 1.5 to 2.5 units outward that explode 0.3s later for 0.8x each within 1.1 units. Holds 2 charges.', compressionSupport: true, icon: 'node:af_cluster_charge' },
  { id: 'af_firebomb', classId: 'artificer', name: 'Firebomb', slot: 'active', damageType: 'ember', damageCoef: '1.6', resourceCost: 22, cooldownSec: 6, charges: 2,
    shape: { kind: 'circle', radius: 2, selfCentered: false, range: 7 }, knockback: 0.8, dot: { type: 'ember', fractionPerSec: '0.25', durationSec: 3 },
    description: 'Lob a firebomb: it explodes within 2 units for 1.6x ember damage, ignites enemies (25% of the hit per second for 3s) and leaves burning ground (radius 2.2) for 4s that deals 0.4x ember damage every 0.5s. Holds 2 charges.', compressionSupport: true, icon: 'node:af_firebomb' },
  // ---- Clockwork family ----
  { id: 'af_overclock', classId: 'artificer', name: 'Overclock', slot: 'active', damageType: 'ember', damageCoef: '1', resourceCost: 20, cooldownSec: 12, charges: 1,
    shape: { kind: 'aura', radius: 2.2, duration: 5 }, knockback: 1.4,
    description: 'Vent a steam blast around you (radius 2.2, 1x ember damage, knockback 1.4 that interrupts windups), then overclock for 5s: basic attack speed x1.5 and repeater bolts pierce 1 extra enemy.', compressionSupport: true, icon: 'node:af_overclock' },
  { id: 'af_rocket_jump', classId: 'artificer', name: 'Rocket Jump', slot: 'active', damageType: 'ember', damageCoef: '1', resourceCost: 22, cooldownSec: 8, charges: 1,
    shape: { kind: 'teleport', range: 4.5 }, knockback: 1.4,
    description: 'Rocket up to 4.5 units toward your aim over 0.25s (invulnerable), exploding at launch and landing (radius 2.2, 1x ember damage, knockback 1.4), then overclock for 5s.', compressionSupport: true, icon: 'node:af_rocket_jump' },
  { id: 'af_boiler_overdrive', classId: 'artificer', name: 'Boiler Overdrive', slot: 'active', damageType: 'ember', damageCoef: '0.35', resourceCost: 26, cooldownSec: 12, charges: 1,
    shape: { kind: 'aura', radius: 2.4, duration: 4 },
    description: 'A scalding steam cloud surrounds you for 4s (radius 2.4), dealing 0.35x ember damage every 0.4s to enemies inside and shoving them outward; overclock for 6s.', compressionSupport: true, icon: 'node:af_boiler_overdrive' },
  // ---- support (not granted directly) ----
  { id: 'af_drone_zap', classId: 'artificer', name: 'Drone Zap', slot: 'active', damageType: 'storm', damageCoef: '0.6', resourceCost: 0, cooldownSec: 0, charges: 1,
    shape: { kind: 'chain', range: 5, jumpRange: 3, jumps: 0 },
    description: 'Clockwork Drone zap: 0.6x storm damage to the nearest enemy within 5 units of the drone.', compressionSupport: true, icon: 'node:af_drone' },
];

export const NODES: NodeDef[] = [
  // ---- Artificer / Turrets ----
  n('af_turret', 'turrets', 'Deploy Turret', 1, 0, { grantsSkill: 'af_turret', description: 'Deploys a turret for 10s that shoots the nearest enemy for 0.5× every 0.5s (max 2).' }),
  n('af_calibrated', 'turrets', 'Calibrated Sights', 3, 1, { prereqs: [{ node: 'af_turret', rank: 1 }], modifiers: [{ stat: 'skill.af_turret.damage', factorPerRank: '1.12' }], upgrades: 'af_turret', description: 'Upgrades Deploy Turret: damage ×{value} per rank, all turret forms.' }),
  n('af_extended_service', 'turrets', 'Extended Service', 2, 1, { prereqs: [{ node: 'af_turret', rank: 1 }], mechanics: ['turret_duration'], upgrades: 'af_turret', description: 'Upgrades Deploy Turret: duration ×1.2 per rank, all turret forms.' }),
  n('af_tinkerer', 'turrets', 'Tinkerer', 3, 1, { modifiers: [{ stat: 'player.recoveryRate', factorPerRank: '1.05' }], description: 'Speeds cooldown recovery ×{value} per rank.' }),
  n('af_flame_turret', 'turrets', 'Flame Turret', 1, 2, { prereqs: [{ node: 'af_turret', rank: 1 }], excludes: ['af_tesla_coil'], grantsSkill: 'af_flame_turret', description: 'Deploys a turret that sprays a fire cone for 0.35× ember every 0.25s, burning enemies.' }),
  n('af_tesla_coil', 'turrets', 'Tesla Coil', 1, 2, { prereqs: [{ node: 'af_turret', rank: 1 }], excludes: ['af_flame_turret'], grantsSkill: 'af_tesla_coil', description: 'Deploys a coil that zaps for 0.9× storm every 0.8s, chaining to 3 more enemies.' }),
  n('af_marking_rounds', 'turrets', 'Marking Rounds', 1, 2, { prereqs: [{ node: 'af_turret', rank: 1 }], mechanics: ['marking_rounds'], upgrades: 'af_turret', description: 'Upgrades Deploy Turret: hits make enemies take ×1.1 damage for 2s; bolts pierce +1.' }),
  n('af_twin_deploy', 'turrets', 'Twin Deploy', 1, 2, { prereqs: [{ node: 'af_turret', rank: 1 }], mechanics: ['twin_deploy'], upgrades: 'af_turret', description: 'Upgrades Deploy Turret: max turrets 2 → 3, and +1 charge.' }),
  n('af_turret_link', 'turrets', 'Turret Link', 1, 3, { mechanics: ['turret_link'], upgrades: 'af_turret', description: 'Upgrades Deploy Turret: fires ×1.25 faster per other turret within 6 units.' }),
  n('af_self_destruct', 'turrets', 'Self-Destruct', 1, 3, { mechanics: ['self_destruct'], upgrades: 'af_turret', description: 'Upgrades Deploy Turret: expiring turrets explode for 2.5× physical in radius 2.2.' }),
  n('af_fortress_protocol', 'turrets', 'Fortress Protocol', 1, 4, { excludes: ['af_sentry_network'], mechanics: ['fortress_protocol'], upgrades: 'af_turret', description: 'Upgrades Deploy Turret: near one, turrets fire ×1.5 faster and you heal 1.5% per second.' }),
  n('af_sentry_network', 'turrets', 'Sentry Network', 1, 4, { excludes: ['af_fortress_protocol'], mechanics: ['sentry_network'], upgrades: 'af_turret', description: 'Upgrades Deploy Turret: turrets within 8 units also shoot what your Repeater hits.' }),

  // ---- Artificer / Ordnance ----
  n('af_grenade', 'ordnance', 'Steam Grenade', 1, 0, { grantsSkill: 'af_grenade', description: 'Lobs a grenade that explodes for 2× ember in radius 1.8 (2 charges).' }),
  n('af_blasting_powder', 'ordnance', 'Blasting Powder', 3, 1, { prereqs: [{ node: 'af_grenade', rank: 1 }], modifiers: [{ stat: 'skill.af_grenade.damage', factorPerRank: '1.12' }], upgrades: 'af_grenade', description: 'Upgrades Steam Grenade: damage ×{value} per rank, all grenade forms.' }),
  n('af_wide_payload', 'ordnance', 'Wide Payload', 2, 1, { prereqs: [{ node: 'af_grenade', rank: 1 }], modifiers: [{ stat: 'skill.af_grenade.radius', factorPerRank: '1.12' }], upgrades: 'af_grenade', description: 'Upgrades Steam Grenade: blast radius ×{value} per rank, all grenade forms.' }),
  n('af_demolitions', 'ordnance', 'Demolitions', 3, 1, { modifiers: [{ stat: 'player.emberDamage', factorPerRank: '1.08' }], description: 'Raises ember damage ×{value} per rank.' }),
  n('af_quick_fuse', 'ordnance', 'Quick Fuse', 2, 1, { prereqs: [{ node: 'af_grenade', rank: 1 }], mechanics: ['quick_fuse'], description: 'Grenade flight time x0.8 per rank and grenade Steam cost x0.9 per rank.' }),
  n('af_cluster_charge', 'ordnance', 'Cluster Charge', 1, 2, { prereqs: [{ node: 'af_grenade', rank: 1 }], excludes: ['af_firebomb'], grantsSkill: 'af_cluster_charge', description: 'Lobs a 1.6× charge that scatters 4 bomblets (0.8× each) around the blast.' }),
  n('af_firebomb', 'ordnance', 'Firebomb', 1, 2, { prereqs: [{ node: 'af_grenade', rank: 1 }], excludes: ['af_cluster_charge'], grantsSkill: 'af_firebomb', description: 'Lobs a 1.6× firebomb that ignites enemies and leaves burning ground for 4s.' }),
  n('af_proximity_mines', 'ordnance', 'Proximity Mines', 1, 2, { prereqs: [{ node: 'af_grenade', rank: 1 }], mechanics: ['proximity_mines'], upgrades: 'af_grenade', description: 'Upgrades Steam Grenade: grenades that hit nothing become mines that deal ×1.3.' }),
  n('af_concussive', 'ordnance', 'Concussive Charge', 1, 3, { mechanics: ['concussive'], upgrades: 'af_grenade', description: 'Upgrades Steam Grenade: double knockback and a 0.6s stun (bosses +40 stagger).' }),
  n('af_chain_reaction', 'ordnance', 'Chain Reaction', 1, 3, { mechanics: ['chain_reaction'], description: 'Makes enemies killed by your explosives burst for 0.6× ember in radius 1.5.' }),
  n('af_carpet_bomber', 'ordnance', 'Carpet Bomber', 1, 4, { excludes: ['af_heavy_ordnance'], mechanics: ['carpet_bomber'], upgrades: 'af_grenade', description: 'Upgrades Steam Grenade: throws 3 grenades at ×0.6 damage, and +1 charge.' }),
  n('af_heavy_ordnance', 'ordnance', 'Heavy Ordnance', 1, 4, { excludes: ['af_carpet_bomber'], mechanics: ['heavy_ordnance'], upgrades: 'af_grenade', description: 'Upgrades Steam Grenade: one huge shell with ×2.5 damage, ×1.6 radius, ×1.5 cooldown.' }),

  // ---- Artificer / Clockwork ----
  n('af_overclock', 'clockwork', 'Overclock', 1, 0, { grantsSkill: 'af_overclock', description: 'Blasts steam around you for 1× ember, then raises attack speed ×1.5 for 5s.' }),
  n('af_drone', 'clockwork', 'Clockwork Drone', 1, 1, { mechanics: ['clockwork_drone'], description: 'Adds a drone that zaps the nearest enemy for 0.6× storm every 0.7s.' }),
  n('af_pressure_valves', 'clockwork', 'Pressure Valves', 3, 1, { modifiers: [{ stat: 'player.resourceRegen', factorPerRank: '1.08' }], description: 'Steam regeneration x1.08 per rank.' }),
  n('af_servo_motors', 'clockwork', 'Servo Motors', 3, 1, { modifiers: [{ stat: 'player.attackFrequency', factorPerRank: '1.06' }], description: 'Raises attack speed ×{value} per rank.' }),
  n('af_hardened_plating', 'clockwork', 'Hardened Plating', 2, 1, { modifiers: [{ stat: 'player.armor', factorPerRank: '1.12' }], description: 'Raises armor ×{value} per rank.' }),
  n('af_rocket_jump', 'clockwork', 'Rocket Jump', 1, 2, { prereqs: [{ node: 'af_overclock', rank: 1 }], excludes: ['af_boiler_overdrive'], grantsSkill: 'af_rocket_jump', description: 'Rockets you up to 4.5 units, exploding at both ends for 1× ember, then overclocks.' }),
  n('af_boiler_overdrive', 'clockwork', 'Boiler Overdrive', 1, 2, { prereqs: [{ node: 'af_overclock', rank: 1 }], excludes: ['af_rocket_jump'], grantsSkill: 'af_boiler_overdrive', description: 'Surrounds you with scalding steam for 4s (0.35× every 0.4s), then overclocks.' }),
  n('af_arc_capacitor', 'clockwork', 'Arc Capacitor', 2, 2, { prereqs: [{ node: 'af_drone', rank: 1 }], modifiers: [{ stat: 'skill.af_drone_zap.damage', factorPerRank: '1.2' }], upgrades: 'af_drone_zap', description: 'Upgrades Drone Zap: damage ×{value} per rank.' }),
  n('af_aegis_protocol', 'clockwork', 'Aegis Protocol', 1, 3, { prereqs: [{ node: 'af_drone', rank: 1 }], mechanics: ['aegis_protocol'], description: 'Makes your drone shield you for 8% max health every 5s and on Clockwork casts.' }),
  n('af_steam_engine', 'clockwork', 'Steam Engine', 1, 3, { mechanics: ['steam_engine'], description: 'Overclock lasts x1.6 as long (every Clockwork form), and kills while overclocked restore 4 Steam.' }),
  n('af_clockwork_legion', 'clockwork', 'Clockwork Legion', 1, 4, { prereqs: [{ node: 'af_drone', rank: 1 }], excludes: ['af_perpetual_engine'], mechanics: ['clockwork_legion'], upgrades: 'af_drone_zap', description: 'Upgrades Drone Zap: 3 drones instead of 1, each at ×0.8 damage.' }),
  n('af_perpetual_engine', 'clockwork', 'Perpetual Engine', 1, 4, { excludes: ['af_clockwork_legion'], mechanics: ['perpetual_engine'], description: 'Keystone: each repeater bolt hit extends Overclock by 0.15s (up to 10s remaining) and overclocked attack speed rises to x1.75, but your Clockwork skill costs x1.5 Steam.' }),
];

export const CLASS: ClassDef = {
  id: 'artificer', name: 'Artificer', tagline: 'Turrets, ordnance and clockwork. Builds a killing field and lets it work.',
  branches: [
    { id: 'turrets', name: 'Turrets', theme: 'Auto-turrets, flame and tesla' },
    { id: 'ordnance', name: 'Ordnance', theme: 'Grenades, mines and chain reactions' },
    { id: 'clockwork', name: 'Clockwork', theme: 'Drones, overclock and steam' },
  ],
  accent: '#3cb4a0', role: 'Ranged engineer · deployables',
  resource: { name: 'Steam', max: 110, regenPerSec: 11 },
  base: { maxHealth: 850, armor: 20, damage: 74, attackFrequency: 2.6, moveSpeed: 4.6, critTendency: '0.25', critMultiplier: '2', shieldCapacity: 0.6 },
  basicSkill: 'af_repeater', signatureSkill: 'af_mortar_barrage',
  nodes: NODES.map((x) => x.id),
};
