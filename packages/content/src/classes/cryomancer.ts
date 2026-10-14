import type { ClassDef, NodeDef, SkillDef } from '../types';
import { node } from './common';

// Cryomancer: ice sorceress. Status rules shared by the kit (implemented in simulation/src/cc.ts):
//   Chill  - movement and attack speed x(1 - slow); the strongest Chill applies (max 70%); bosses suffer half.
//   Freeze - cannot move or act; takes x1.15 damage from every player. Control resistance: within 4s of any
//            crowd control, each further Freeze lasts half as long; a third in a row becomes a 70% Chill instead.
//            Bosses never freeze: they take 60 stagger per second of Freeze and a half-strength Chill.
//   Shatter - ends a Freeze for a bonus 1.5x frost hit (Shatter-branch skills, Absolute Zero, Crystallize shards).

const n = (id: string, branch: string, name: string, rankLimit: number, tier: NodeDef['tier'], opts: Parameters<typeof node>[6]) => node(id, 'cryomancer', branch, name, rankLimit, tier, opts);

const sk = (s: Omit<SkillDef, 'classId' | 'compressionSupport' | 'icon'> & { icon?: string }): SkillDef =>
  ({ classId: 'cryomancer', compressionSupport: true, icon: s.icon ?? `node:${s.id}`, ...s });

/** Internal follow-up effects (not slotted): own coefficients so tree modifiers can target them. */
const hidden = (id: string, name: string, coef: string, shape: SkillDef['shape'], description: string, icon: string): SkillDef =>
  sk({ id, name, slot: 'active', damageType: 'frost', damageCoef: coef, resourceCost: 0, cooldownSec: 0, charges: 1, shape, description, icon });

export const SKILLS: SkillDef[] = [
  sk({ id: 'c_ice_shard', name: 'Ice Shard', slot: 'basic', damageType: 'frost', damageCoef: '1', resourceCost: 0, cooldownSec: 0, charges: 1,
    shape: { kind: 'projectile', speed: 13, radius: 0.22, range: 9, pierce: 1, spreadDeg: 10 },
    description: 'A shard of ice that passes through 1 enemy and Chills targets by 30% for 1.5s.' }),
  sk({ id: 'c_absolute_zero', name: 'Absolute Zero', slot: 'signature', damageType: 'frost', damageCoef: '3', resourceCost: 35, cooldownSec: 14, charges: 1,
    shape: { kind: 'circle', radius: 4.2, selfCentered: true, range: 0 },
    description: 'A blizzard nova (radius 4.2) deals 3x frost damage to every enemy. Frozen enemies Shatter first, then everything hit is Frozen for 1.6s. Leaves Permafrost (radius 4.2, 3s) that Chills by 40%. Bosses take 200 stagger.' }),
  // ---- Glacier ----
  sk({ id: 'c_ice_wall', name: 'Ice Wall', slot: 'active', damageType: 'frost', damageCoef: '0.5', resourceCost: 20, cooldownSec: 8, charges: 1,
    shape: { kind: 'line', length: 5, width: 0.6, duration: 4, tickInterval: 0.5 },
    description: 'Raise a 5-unit wall of ice across your aim, 2.5 units ahead, for 4s. Enemies cannot walk through it (bosses can); enemies touching it take 0.5x frost damage every 0.5s and are Chilled 50% for 2s.' }),
  sk({ id: 'c_glacial_prison', name: 'Glacial Prison', slot: 'active', damageType: 'frost', damageCoef: '0.5', resourceCost: 25, cooldownSec: 10, charges: 1,
    shape: { kind: 'aura', radius: 2.6, duration: 4 },
    description: 'A ring of ice (radius 2.6) at the aimed point for 4s. Enemies inside when it forms are Frozen for 1.2s; the ring keeps enemies in and out, Chills 50% and deals 0.5x frost damage every 0.5s on contact.' }),
  sk({ id: 'c_frost_effigy', name: 'Frost Effigy', slot: 'active', damageType: 'frost', damageCoef: '0.5', resourceCost: 25, cooldownSec: 10, charges: 1,
    shape: { kind: 'line', length: 5, width: 0.6, duration: 4, tickInterval: 0.5 },
    description: 'Raise the Ice Wall, leave a Frost Effigy just beyond it and glide 2.5 units back. Enemies within 6 units are lured to the Effigy; when the wall fades it bursts for 2.5x frost damage (radius 2.5), Freezing for 1.2s.' }),
  hidden('c_effigy_burst', 'Effigy Burst', '2.5', { kind: 'circle', radius: 2.5, selfCentered: false, range: 0 }, 'Frost Effigy detonation.', 'node:c_frost_effigy'),
  hidden('c_glacier_shard', 'Glacier Shard', '0.8', { kind: 'projectile', speed: 12, radius: 0.22, range: 8, pierce: 0, spreadDeg: 0 }, 'Ice shard fired by a Living Glacier wall.', 'node:c_living_glacier'),
  // ---- Blizzard ----
  sk({ id: 'c_blizzard', name: 'Blizzard', slot: 'active', damageType: 'frost', damageCoef: '0.45', resourceCost: 25, cooldownSec: 9, charges: 1,
    shape: { kind: 'aura', radius: 2.8, duration: 5 },
    description: 'Call a storm (radius 2.8) at the aimed point for 5s: every 0.5s it deals 0.45x frost damage to enemies inside and Chills them 40%.' }),
  sk({ id: 'c_whiteout', name: 'Whiteout', slot: 'active', damageType: 'frost', damageCoef: '0.5', resourceCost: 30, cooldownSec: 12, charges: 1,
    shape: { kind: 'aura', radius: 3.4, duration: 6 },
    description: 'A larger storm (radius 3.4, 6s): 0.5x frost damage every 0.5s and Chill 40%. Enemies struck by 4 pulses of the same Whiteout are Frozen for 1.5s.' }),
  sk({ id: 'c_frozen_orb', name: 'Frozen Orb', slot: 'active', damageType: 'frost', damageCoef: '0.6', resourceCost: 25, cooldownSec: 8, charges: 1,
    shape: { kind: 'projectile', speed: 4.5, radius: 0.7, range: 9, pierce: 99, spreadDeg: 0 },
    description: 'A slow orb (4.5 units/s, 9 units) deals 0.6x frost damage to each enemy it passes and sprays an ice shard every 0.15s in a spinning spiral, bursting into 8 shards at the end of its path.' }),
  hidden('c_orb_shard', 'Orb Shard', '0.4', { kind: 'projectile', speed: 11, radius: 0.2, range: 5, pierce: 0, spreadDeg: 0 }, 'Ice shard sprayed by Frozen Orb.', 'node:c_frozen_orb'),
  hidden('c_hail', 'Hailstone', '0.6', { kind: 'circle', radius: 0.8, selfCentered: false, range: 0 }, 'Hailstone from Hailstorm.', 'node:c_hailstorm'),
  hidden('c_comet', 'Glacial Comet', '4', { kind: 'circle', radius: 2.5, selfCentered: false, range: 0 }, 'Comet from the Glacial Comet keystone.', 'node:c_glacial_comet'),
  // ---- Shatter ----
  sk({ id: 'c_frost_nova', name: 'Frost Nova', slot: 'active', damageType: 'frost', damageCoef: '1.2', resourceCost: 20, cooldownSec: 7, charges: 1,
    shape: { kind: 'circle', radius: 3, selfCentered: true, range: 0 },
    description: 'Ice bursts around you (radius 3) for 1.2x frost damage and Freezes enemies for 1.2s. Frozen enemies hit Shatter first.' }),
  sk({ id: 'c_glacial_spike', name: 'Glacial Spike', slot: 'active', damageType: 'frost', damageCoef: '2', resourceCost: 22, cooldownSec: 6, charges: 1,
    shape: { kind: 'circle', radius: 1.8, selfCentered: false, range: 8 },
    description: 'Ice erupts at the aimed point: 2x frost damage (radius 1.8) and Freeze for 1.4s; 0.6s later it detonates for 1.2x frost damage (radius 2.4), Shattering enemies still Frozen.' }),
  hidden('c_spike_burst', 'Spike Detonation', '1.2', { kind: 'circle', radius: 2.4, selfCentered: false, range: 0 }, 'Glacial Spike detonation.', 'node:c_glacial_spike'),
  sk({ id: 'c_cold_snap', name: 'Cold Snap', slot: 'active', damageType: 'frost', damageCoef: '1', resourceCost: 25, cooldownSec: 9, charges: 1,
    shape: { kind: 'circle', radius: 9, selfCentered: true, range: 0 },
    description: 'Every Chilled enemy within 9 units takes 1x frost damage and is Frozen for 1.2s (Frozen ones Shatter first); a ring around you (radius 2.5) Chills everything else by 40%.' }),
  hidden('c_shatter', 'Shatter', '1.5', { kind: 'circle', radius: 0.5, selfCentered: false, range: 0 }, 'Bonus hit when a Freeze is broken.', 'node:c_frost_nova'),
  hidden('c_shatter_burst', 'Shatter Burst', '1', { kind: 'circle', radius: 2.2, selfCentered: false, range: 0 }, 'Chain Reaction explosion.', 'node:c_chain_reaction'),
  hidden('c_bloom_shard', 'Bloom Shard', '0.6', { kind: 'projectile', speed: 10, radius: 0.2, range: 4, pierce: 0, spreadDeg: 0 }, 'Ice shard from Ice Bloom.', 'node:c_ice_bloom'),
];

const GLACIER_WALL = 'Glacier walls (Ice Wall, Glacial Prison, Frost Effigy)';

export const NODES: NodeDef[] = [
  // ---- Cryomancer / Glacier ----
  n('c_ice_wall', 'glacier', 'Ice Wall', 1, 0, { grantsSkill: 'c_ice_wall',
    description: 'Equip Ice Wall (20 Frost, 8s): a 5-unit wall of ice across your aim, 2.5 units ahead, for 4s. Enemies cannot walk through it (bosses can); enemies touching it take 0.5x frost damage every 0.5s and are Chilled 50% for 2s.' }),
  n('c_glacial_bulk', 'glacier', 'Glacial Bulk', 3, 1, { modifiers: [{ stat: 'player.maxHealth', factorPerRank: '1.07' }], description: 'Maximum health x1.07 per rank.' }),
  n('c_hoarfrost', 'glacier', 'Hoarfrost', 3, 1, { modifiers: [{ stat: 'player.armor', factorPerRank: '1.12' }], description: 'Armor x1.12 per rank.' }),
  n('c_thick_ice', 'glacier', 'Thick Ice', 2, 1, { prereqs: [{ node: 'c_ice_wall', rank: 1 }], mechanics: ['thick_ice'],
    description: `${GLACIER_WALL} last 1s longer and grow 1 unit longer per rank (Glacial Prison: +0.4 radius per rank).` }),
  n('c_rime_spikes', 'glacier', 'Rime Spikes', 1, 2, { prereqs: [{ node: 'c_ice_wall', rank: 1 }], excludes: ['c_glacial_bulwark'], mechanics: ['rime_spikes'],
    description: `Choice: ${GLACIER_WALL} deal x2.5 damage and Freeze each enemy for 0.8s the first time it touches a given wall.` }),
  n('c_glacial_bulwark', 'glacier', 'Glacial Bulwark', 1, 2, { prereqs: [{ node: 'c_ice_wall', rank: 1 }], excludes: ['c_rime_spikes'], mechanics: ['glacial_bulwark'],
    description: `Choice: ${GLACIER_WALL} are 30% longer (Prison radius x1.3) and destroy enemy projectiles that touch them (lobbed globs fly over).` }),
  n('c_glacial_prison', 'glacier', 'Glacial Prison', 1, 2, { prereqs: [{ node: 'c_ice_wall', rank: 1 }], excludes: ['c_frost_effigy'], grantsSkill: 'c_glacial_prison',
    description: 'Evolve Ice Wall into Glacial Prison (25 Frost, 10s): a ring of ice (radius 2.6) at the aimed point (up to 7 units) for 4s. Enemies inside when it forms are Frozen for 1.2s; the ring keeps enemies in and out, Chills 50% and deals 0.5x frost damage every 0.5s on contact. Wall upgrades apply.' }),
  n('c_frost_effigy', 'glacier', 'Frost Effigy', 1, 2, { prereqs: [{ node: 'c_ice_wall', rank: 1 }], excludes: ['c_glacial_prison'], grantsSkill: 'c_frost_effigy',
    description: 'Evolve Ice Wall into Frost Effigy (25 Frost, 10s): raise the Ice Wall, leave a Frost Effigy just beyond it and glide 2.5 units back. While the wall stands, non-boss enemies within 6 units are lured to the Effigy; when it fades the Effigy bursts for 2.5x frost damage (radius 2.5), Freezing for 1.2s. Wall upgrades apply.' }),
  n('c_rime_armor', 'glacier', 'Rime Armor', 1, 2, { prereqs: [{ node: 'c_ice_wall', rank: 1 }], mechanics: ['rime_armor'],
    description: 'Casting a Glacier skill grants Frost Armor: a shield of 12% maximum health. While you hold any shield, enemies within 2.5 units of you are Chilled 40%.' }),
  n('c_cryostasis', 'glacier', 'Cryostasis', 1, 3, { mechanics: ['cryostasis'],
    description: 'When a hit leaves you below 35% health you are encased in ice: invulnerable for 1.5s, shielded for 25% maximum health, and enemies within 3 units are Frozen for 1s. Recharges after 40s.' }),
  n('c_brittle_ice', 'glacier', 'Brittle Ice', 1, 3, { prereqs: [{ node: 'c_ice_wall', rank: 1 }], mechanics: ['brittle_ice'],
    description: `Enemies touching ${GLACIER_WALL} become Brittle: they take x1.15 damage from all sources for 2s.` }),
  n('c_heart_of_winter', 'glacier', 'Heart of Winter', 1, 4, { excludes: ['c_living_glacier'], mechanics: ['heart_of_winter'],
    description: 'Keystone: once every 60s, a hit that would down you instead leaves you at 1 health, makes you invulnerable for 2.5s, shields you for 40% maximum health and Freezes enemies within 4 units for 2s.' }),
  n('c_living_glacier', 'glacier', 'Living Glacier', 1, 4, { prereqs: [{ node: 'c_ice_wall', rank: 1 }], excludes: ['c_heart_of_winter'], mechanics: ['living_glacier'],
    description: `Keystone: ${GLACIER_WALL} last twice as long and fire an ice shard (0.8x frost, Chills 30%) at the nearest enemy within 7 units every second.` }),

  // ---- Cryomancer / Blizzard ----
  n('c_blizzard', 'blizzard', 'Blizzard', 1, 0, { grantsSkill: 'c_blizzard',
    description: 'Equip Blizzard (25 Frost, 9s): a storm (radius 2.8) at the aimed point (up to 8 units) for 5s. Every 0.5s it deals 0.45x frost damage to enemies inside and Chills them 40%.' }),
  n('c_bitter_cold', 'blizzard', 'Bitter Cold', 3, 1, { modifiers: [{ stat: 'player.frostDamage', factorPerRank: '1.08' }], description: 'Frost damage x1.08 per rank.' }),
  n('c_winter_tide', 'blizzard', 'Winter Tide', 3, 1, { modifiers: [{ stat: 'player.resourceRegen', factorPerRank: '1.08' }], description: 'Frost regeneration x1.08 per rank.' }),
  n('c_widening_gyre', 'blizzard', 'Widening Gyre', 2, 1, { prereqs: [{ node: 'c_blizzard', rank: 1 }], mechanics: ['widening_gyre'],
    description: 'Blizzard and Whiteout gain +0.35 radius and +1s duration per rank; Frozen Orb travels 2 units farther per rank.' }),
  n('c_eye_of_the_storm', 'blizzard', 'Eye of the Storm', 1, 2, { prereqs: [{ node: 'c_blizzard', rank: 1 }], excludes: ['c_hailstorm'], mechanics: ['eye_of_the_storm'],
    description: 'Choice: your storms are centred on you and follow you, and Chill 60% instead of 40%; Frozen Orb circles you (radius 2.6) for 4s instead of flying forward.' }),
  n('c_hailstorm', 'blizzard', 'Hailstorm', 1, 2, { prereqs: [{ node: 'c_blizzard', rank: 1 }], excludes: ['c_eye_of_the_storm'], mechanics: ['hailstorm'],
    description: 'Choice: every 0.33s a hailstone strikes a random enemy inside each of your storms (Frozen Orb: within 3 units of the orb) for 0.6x frost damage with x2 critical tendency.' }),
  n('c_frozen_orb', 'blizzard', 'Frozen Orb', 1, 2, { prereqs: [{ node: 'c_blizzard', rank: 1 }], excludes: ['c_whiteout'], grantsSkill: 'c_frozen_orb',
    description: 'Evolve Blizzard into Frozen Orb (25 Frost, 8s): a slow orb (4.5 units/s, 9 units) that deals 0.6x frost damage to each enemy it passes and sprays an ice shard (0.4x frost, Chills 30%) every 0.15s in a spinning spiral. At the end of its path it bursts into 8 shards. Storm upgrades apply.' }),
  n('c_whiteout', 'blizzard', 'Whiteout', 1, 2, { prereqs: [{ node: 'c_blizzard', rank: 1 }], excludes: ['c_frozen_orb'], grantsSkill: 'c_whiteout',
    description: 'Evolve Blizzard into Whiteout (30 Frost, 12s): a larger storm (radius 3.4, 6s) dealing 0.5x frost damage every 0.5s and Chilling 40%. Enemies struck by 4 pulses of the same Whiteout are Frozen for 1.5s. Storm upgrades apply.' }),
  n('c_cold_front', 'blizzard', 'Cold Front', 1, 2, { prereqs: [{ node: 'c_blizzard', rank: 1 }], mechanics: ['cold_front'],
    description: 'Each kill by a Blizzard-branch skill (storm pulses, hail, Frozen Orb and its shards) refunds 0.75s of that skill\'s cooldown.' }),
  n('c_twin_storms', 'blizzard', 'Twin Storms', 1, 3, { prereqs: [{ node: 'c_blizzard', rank: 1 }], mechanics: ['twin_storms'], description: 'Your Blizzard-branch skill holds 2 charges.' }),
  n('c_frostbite', 'blizzard', 'Frostbite', 1, 3, { mechanics: ['frostbite'],
    description: 'All your Chilling hits inflict Frostbite: 12% of the damage dealt per second as frost damage for 3s.' }),
  n('c_maelstrom', 'blizzard', 'Maelstrom', 1, 4, { excludes: ['c_glacial_comet'], mechanics: ['maelstrom'],
    description: 'Keystone: your storms drag non-boss enemies toward their centre (0.8 units/s) and their pulses deal x1.4 damage; Frozen Orb drags enemies within 3 units toward it.' }),
  n('c_glacial_comet', 'blizzard', 'Glacial Comet', 1, 4, { excludes: ['c_maelstrom'], mechanics: ['glacial_comet'],
    description: 'Keystone: when one of your storms ends or a Frozen Orb bursts, a glacial comet crashes into its centre for 4x frost damage (radius 2.5), Freezing enemies for 1.5s.' }),

  // ---- Cryomancer / Shatter ----
  n('c_frost_nova', 'shatter', 'Frost Nova', 1, 0, { grantsSkill: 'c_frost_nova',
    description: 'Equip Frost Nova (20 Frost, 7s): ice bursts around you (radius 3) for 1.2x frost damage and Freezes enemies for 1.2s. Frozen enemies hit Shatter first: the Freeze breaks for a bonus 1.5x frost hit.' }),
  n('c_glacial_focus', 'shatter', 'Glacial Focus', 3, 1, { modifiers: [{ stat: 'player.critTendency', factorPerRank: '1.12' }], description: 'Critical tendency x1.12 per rank.' }),
  n('c_razor_ice', 'shatter', 'Razor Ice', 3, 1, { modifiers: [{ stat: 'player.critPotency', factorPerRank: '1.08' }], description: 'Critical damage potency x1.08 per rank.' }),
  n('c_cold_precision', 'shatter', 'Cold Precision', 2, 1, { prereqs: [{ node: 'c_frost_nova', rank: 1 }], mechanics: ['cold_precision'],
    description: 'Your hits against Chilled or Frozen enemies have x1.4 critical tendency per rank.' }),
  n('c_chain_reaction', 'shatter', 'Chain Reaction', 1, 2, { prereqs: [{ node: 'c_frost_nova', rank: 1 }], excludes: ['c_deep_freeze'], mechanics: ['chain_reaction'],
    description: 'Choice: Shatters explode for 1x frost damage (radius 2.2), Chilling 50%; Frozen enemies caught in the blast Shatter too, chaining up to 3 links deep.' }),
  n('c_deep_freeze', 'shatter', 'Deep Freeze', 1, 2, { prereqs: [{ node: 'c_frost_nova', rank: 1 }], excludes: ['c_chain_reaction'], mechanics: ['deep_freeze'],
    description: 'Choice: your Freezes last x1.5 as long and your Shatters deal x1.6 damage, but they never spread.' }),
  n('c_glacial_spike', 'shatter', 'Glacial Spike', 1, 2, { prereqs: [{ node: 'c_frost_nova', rank: 1 }], excludes: ['c_cold_snap'], grantsSkill: 'c_glacial_spike',
    description: 'Evolve Frost Nova into Glacial Spike (22 Frost, 6s): ice erupts at the aimed point (up to 8 units) for 2x frost damage (radius 1.8) and Freezes for 1.4s; 0.6s later the spike detonates for 1.2x frost damage (radius 2.4), Shattering enemies still Frozen.' }),
  n('c_cold_snap', 'shatter', 'Cold Snap', 1, 2, { prereqs: [{ node: 'c_frost_nova', rank: 1 }], excludes: ['c_glacial_spike'], grantsSkill: 'c_cold_snap',
    description: 'Evolve Frost Nova into Cold Snap (25 Frost, 9s): every Chilled enemy within 9 units takes 1x frost damage and is Frozen for 1.2s (already Frozen enemies Shatter first); a ring around you (radius 2.5) Chills everything else by 40%.' }),
  n('c_crystallize', 'shatter', 'Crystallize', 1, 2, { prereqs: [{ node: 'c_frost_nova', rank: 1 }], mechanics: ['crystallize'],
    description: 'Ice Shard hits have a 15% chance to Freeze Chilled enemies for 0.6s, and Ice Shards Shatter Frozen enemies.' }),
  n('c_ice_bloom', 'shatter', 'Ice Bloom', 1, 3, { mechanics: ['ice_bloom'],
    description: 'When an enemy you kill was Chilled or Frozen, it bursts into 5 ice shards (0.6x frost each, Chill 30%).' }),
  n('c_frozen_momentum', 'shatter', 'Frozen Momentum', 1, 3, { prereqs: [{ node: 'c_frost_nova', rank: 1 }], mechanics: ['frozen_momentum'],
    description: 'Each Shatter restores 4 Frost and cuts 0.5s from your Shatter-branch skill\'s cooldown.' }),
  n('c_shatterpoint', 'shatter', 'Shatterpoint', 1, 4, { excludes: ['c_zero_point'], mechanics: ['shatterpoint'],
    description: 'Keystone: your hits against Frozen enemies always critically strike, and Shatter bonus hits can critically strike.' }),
  n('c_zero_point', 'shatter', 'Zero Point', 1, 4, { excludes: ['c_shatterpoint'], mechanics: ['zero_point'],
    description: 'Keystone: each Shatter cuts 1s from Absolute Zero\'s cooldown, and Absolute Zero Freezes for 2.4s.' }),
];

export const CLASS: ClassDef = {
  id: 'cryomancer', name: 'Cryomancer', tagline: 'Ice, storm and shatter. Freezes the battlefield solid, then breaks it.',
  branches: [
    { id: 'glacier', name: 'Glacier', theme: 'Ice walls, frost armor and decoys' },
    { id: 'blizzard', name: 'Blizzard', theme: 'Storm fields, hail and frozen orbs' },
    { id: 'shatter', name: 'Shatter', theme: 'Freeze, critical strikes and chain detonations' },
  ],
  accent: '#7fe3ff', role: 'Ranged caster · control',
  resource: { name: 'Frost', max: 110, regenPerSec: 11 },
  base: { maxHealth: 760, armor: 12, damage: 78, attackFrequency: 2.0, moveSpeed: 4.5, critTendency: '0.25', critMultiplier: '2', shieldCapacity: 0.6 },
  basicSkill: 'c_ice_shard', signatureSkill: 'c_absolute_zero',
  nodes: NODES.map((x) => x.id),
};
