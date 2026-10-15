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
  sk({ id, name, slot: 'active', damageType: 'frost', damageCoef: coef, cooldownSec: 0, charges: 1, shape, description, icon });

export const SKILLS: SkillDef[] = [
  sk({ id: 'c_ice_shard', name: 'Ice Shard', slot: 'basic', damageType: 'frost', damageCoef: '1', cooldownSec: 0, charges: 1,
    shape: { kind: 'projectile', speed: 13, radius: 0.22, range: 9, pierce: 1, spreadDeg: 10 },
    description: 'A shard of ice that passes through 1 enemy and Chills targets by 30% for 1.5s.' }),
  sk({ id: 'c_absolute_zero', name: 'Absolute Zero', slot: 'signature', damageType: 'frost', damageCoef: '3', cooldownSec: 10, charges: 1,
    shape: { kind: 'circle', radius: 4.2, selfCentered: true, range: 0 },
    description: 'A blizzard nova (radius 4.2) deals 3x frost damage to every enemy. Frozen enemies Shatter first, then everything hit is Frozen for 1.6s. Leaves Permafrost (radius 4.2, 3s) that Chills by 40%. Bosses take 200 stagger.' }),
  // ---- Glacier ----
  sk({ id: 'c_ice_wall', name: 'Ice Wall', slot: 'active', damageType: 'frost', damageCoef: '0.5', cooldownSec: 5.5, charges: 1,
    shape: { kind: 'line', length: 5, width: 0.6, duration: 4, tickInterval: 0.5 },
    description: 'Raise a 5-unit wall of ice across your aim, 2.5 units ahead, for 4s. Enemies cannot walk through it (bosses can); enemies touching it take 0.5x frost damage every 0.5s and are Chilled 50% for 2s.' }),
  sk({ id: 'c_glacial_prison', name: 'Glacial Prison', slot: 'active', damageType: 'frost', damageCoef: '0.5', cooldownSec: 7, charges: 1,
    shape: { kind: 'aura', radius: 2.6, duration: 4 },
    description: 'A ring of ice (radius 2.6) at the aimed point for 4s. Enemies inside when it forms are Frozen for 1.2s; the ring keeps enemies in and out, Chills 50% and deals 0.5x frost damage every 0.5s on contact.' }),
  sk({ id: 'c_frost_effigy', name: 'Frost Effigy', slot: 'active', damageType: 'frost', damageCoef: '0.5', cooldownSec: 7, charges: 1,
    shape: { kind: 'line', length: 5, width: 0.6, duration: 4, tickInterval: 0.5 },
    description: 'Raise the Ice Wall, leave a Frost Effigy just beyond it and glide 2.5 units back. Enemies within 6 units are lured to the Effigy; when the wall fades it bursts for 2.5x frost damage (radius 2.5), Freezing for 1.2s.' }),
  hidden('c_effigy_burst', 'Effigy Burst', '2.5', { kind: 'circle', radius: 2.5, selfCentered: false, range: 0 }, 'Frost Effigy detonation.', 'node:c_frost_effigy'),
  hidden('c_glacier_shard', 'Glacier Shard', '0.8', { kind: 'projectile', speed: 12, radius: 0.22, range: 8, pierce: 0, spreadDeg: 0 }, 'Ice shard fired by a Living Glacier wall.', 'node:c_living_glacier'),
  // ---- Blizzard ----
  sk({ id: 'c_blizzard', name: 'Blizzard', slot: 'active', damageType: 'frost', damageCoef: '0.45', cooldownSec: 6.5, charges: 1,
    shape: { kind: 'aura', radius: 2.8, duration: 5 },
    description: 'Call a storm (radius 2.8) at the aimed point for 5s: every 0.5s it deals 0.45x frost damage to enemies inside and Chills them 40%.' }),
  sk({ id: 'c_whiteout', name: 'Whiteout', slot: 'active', damageType: 'frost', damageCoef: '0.5', cooldownSec: 8.5, charges: 1,
    shape: { kind: 'aura', radius: 3.4, duration: 6 },
    description: 'A larger storm (radius 3.4, 6s): 0.5x frost damage every 0.5s and Chill 40%. Enemies struck by 4 pulses of the same Whiteout are Frozen for 1.5s.' }),
  sk({ id: 'c_frozen_orb', name: 'Frozen Orb', slot: 'active', damageType: 'frost', damageCoef: '0.6', cooldownSec: 5.5, charges: 1,
    shape: { kind: 'projectile', speed: 4.5, radius: 0.7, range: 9, pierce: 99, spreadDeg: 0 },
    description: 'A slow orb (4.5 units/s, 9 units) deals 0.6x frost damage to each enemy it passes and sprays an ice shard every 0.15s in a spinning spiral, bursting into 8 shards at the end of its path.' }),
  hidden('c_orb_shard', 'Orb Shard', '0.4', { kind: 'projectile', speed: 11, radius: 0.2, range: 5, pierce: 0, spreadDeg: 0 }, 'Ice shard sprayed by Frozen Orb.', 'node:c_frozen_orb'),
  hidden('c_hail', 'Hailstone', '0.6', { kind: 'circle', radius: 0.8, selfCentered: false, range: 0 }, 'Hailstone from Hailstorm.', 'node:c_hailstorm'),
  hidden('c_comet', 'Glacial Comet', '4', { kind: 'circle', radius: 2.5, selfCentered: false, range: 0 }, 'Comet from the Glacial Comet keystone.', 'node:c_glacial_comet'),
  // ---- Shatter ----
  sk({ id: 'c_frost_nova', name: 'Frost Nova', slot: 'active', damageType: 'frost', damageCoef: '1.2', cooldownSec: 5, charges: 1,
    shape: { kind: 'circle', radius: 3, selfCentered: true, range: 0 },
    description: 'Ice bursts around you (radius 3) for 1.2x frost damage and Freezes enemies for 1.2s. Frozen enemies hit Shatter first.' }),
  sk({ id: 'c_glacial_spike', name: 'Glacial Spike', slot: 'active', damageType: 'frost', damageCoef: '2', cooldownSec: 4, charges: 1,
    shape: { kind: 'circle', radius: 1.8, selfCentered: false, range: 8 },
    description: 'Ice erupts at the aimed point: 2x frost damage (radius 1.8) and Freeze for 1.4s; 0.6s later it detonates for 1.2x frost damage (radius 2.4), Shattering enemies still Frozen.' }),
  hidden('c_spike_burst', 'Spike Detonation', '1.2', { kind: 'circle', radius: 2.4, selfCentered: false, range: 0 }, 'Glacial Spike detonation.', 'node:c_glacial_spike'),
  sk({ id: 'c_cold_snap', name: 'Cold Snap', slot: 'active', damageType: 'frost', damageCoef: '1', cooldownSec: 6.5, charges: 1,
    shape: { kind: 'circle', radius: 9, selfCentered: true, range: 0 },
    description: 'Every Chilled enemy within 9 units takes 1x frost damage and is Frozen for 1.2s (Frozen ones Shatter first); a ring around you (radius 2.5) Chills everything else by 40%.' }),
  hidden('c_shatter', 'Shatter', '1.5', { kind: 'circle', radius: 0.5, selfCentered: false, range: 0 }, 'Bonus hit when a Freeze is broken.', 'node:c_frost_nova'),
  hidden('c_shatter_burst', 'Shatter Burst', '1', { kind: 'circle', radius: 2.2, selfCentered: false, range: 0 }, 'Chain Reaction explosion.', 'node:c_chain_reaction'),
  hidden('c_bloom_shard', 'Bloom Shard', '0.6', { kind: 'projectile', speed: 10, radius: 0.2, range: 4, pierce: 0, spreadDeg: 0 }, 'Ice shard from Ice Bloom.', 'node:c_ice_bloom'),
];

export const NODES: NodeDef[] = [
  // ---- Cryomancer / Glacier ----
  n('c_ice_wall', 'glacier', 'Ice Wall', 1, 0, { starting: true, grantsSkill: 'c_ice_wall',
    description: 'Raises a 5-unit ice wall for 4s that blocks enemies and chills 50% on touch.' }),
  n('c_glacial_bulk', 'glacier', 'Glacial Bulk', 3, 1, { modifiers: [{ stat: 'player.maxHealth', factorPerRank: '1.07' }], description: 'Raises max health ×{value} per rank.' }),
  n('c_hoarfrost', 'glacier', 'Hoarfrost', 3, 1, { modifiers: [{ stat: 'player.armor', factorPerRank: '1.12' }], description: 'Raises armor ×{value} per rank.' }),
  n('c_thick_ice', 'glacier', 'Thick Ice', 2, 1, { prereqs: [{ node: 'c_ice_wall', rank: 1 }], mechanics: ['thick_ice'],
    upgrades: 'c_ice_wall', description: 'Upgrades Ice Wall: +1s duration and +1 length per rank, all wall forms.' }),
  n('c_rime_spikes', 'glacier', 'Rime Spikes', 1, 2, { prereqs: [{ node: 'c_ice_wall', rank: 1 }], excludes: ['c_glacial_bulwark'], mechanics: ['rime_spikes'],
    upgrades: 'c_ice_wall', description: 'Upgrades Ice Wall: ×2.5 damage, and the first touch freezes for 0.8s.' }),
  n('c_glacial_bulwark', 'glacier', 'Glacial Bulwark', 1, 2, { prereqs: [{ node: 'c_ice_wall', rank: 1 }], excludes: ['c_rime_spikes'], mechanics: ['glacial_bulwark'],
    upgrades: 'c_ice_wall', description: 'Upgrades Ice Wall: 30% longer, and it destroys enemy projectiles.' }),
  n('c_glacial_prison', 'glacier', 'Glacial Prison', 1, 2, { prereqs: [{ node: 'c_ice_wall', rank: 1 }], excludes: ['c_frost_effigy'], grantsSkill: 'c_glacial_prison',
    description: 'Forms an ice ring (radius 2.6) for 4s that freezes enemies inside for 1.2s.' }),
  n('c_frost_effigy', 'glacier', 'Frost Effigy', 1, 2, { prereqs: [{ node: 'c_ice_wall', rank: 1 }], excludes: ['c_glacial_prison'], grantsSkill: 'c_frost_effigy',
    description: 'Raises an Ice Wall with a decoy that lures enemies, then bursts for 2.5× frost.' }),
  n('c_rime_armor', 'glacier', 'Rime Armor', 1, 2, { prereqs: [{ node: 'c_ice_wall', rank: 1 }], mechanics: ['rime_armor'],
    description: 'Grants a 12% max health shield on Glacier casts that chills nearby enemies 40%.' }),
  n('c_cryostasis', 'glacier', 'Cryostasis', 1, 3, { mechanics: ['cryostasis'],
    description: 'Encases you in ice below 35% health: invulnerable 1.5s and shielded 25% (40s cooldown).' }),
  n('c_brittle_ice', 'glacier', 'Brittle Ice', 1, 3, { prereqs: [{ node: 'c_ice_wall', rank: 1 }], mechanics: ['brittle_ice'],
    upgrades: 'c_ice_wall', description: 'Upgrades Ice Wall: enemies touching it take ×1.15 damage for 2s.' }),
  n('c_heart_of_winter', 'glacier', 'Heart of Winter', 1, 4, { excludes: ['c_living_glacier'], mechanics: ['heart_of_winter'],
    description: 'Saves you from a lethal hit once per 60s: 1 health, 2.5s invulnerable, 40% shield.' }),
  n('c_living_glacier', 'glacier', 'Living Glacier', 1, 4, { prereqs: [{ node: 'c_ice_wall', rank: 1 }], excludes: ['c_heart_of_winter'], mechanics: ['living_glacier'],
    upgrades: 'c_ice_wall', description: 'Upgrades Ice Wall: lasts twice as long and fires a 0.8× ice shard every second.' }),

  // ---- Cryomancer / Blizzard ----
  n('c_blizzard', 'blizzard', 'Blizzard', 1, 0, { starting: true, grantsSkill: 'c_blizzard',
    description: 'Calls a storm (radius 2.8) for 5s that deals 0.45× frost every 0.5s and chills 40%.' }),
  n('c_bitter_cold', 'blizzard', 'Bitter Cold', 3, 1, { modifiers: [{ stat: 'player.frostDamage', factorPerRank: '1.08' }], description: 'Raises frost damage ×{value} per rank.' }),
  n('c_winter_tide', 'blizzard', 'Winter Tide', 3, 1, { modifiers: [{ stat: 'skill.c_blizzard.cooldown', factorPerRank: '0.93' }, { stat: 'skill.c_frozen_orb.cooldown', factorPerRank: '0.93' }, { stat: 'skill.c_whiteout.cooldown', factorPerRank: '0.93' }], upgrades: 'c_blizzard', description: 'Upgrades Blizzard: cooldown ×{value} per rank, evolutions too.' }),
  n('c_widening_gyre', 'blizzard', 'Widening Gyre', 2, 1, { prereqs: [{ node: 'c_blizzard', rank: 1 }], mechanics: ['widening_gyre'],
    upgrades: 'c_blizzard', description: 'Upgrades Blizzard: +0.35 radius and +1s per rank; Frozen Orb flies +2 units.' }),
  n('c_eye_of_the_storm', 'blizzard', 'Eye of the Storm', 1, 2, { prereqs: [{ node: 'c_blizzard', rank: 1 }], excludes: ['c_hailstorm'], mechanics: ['eye_of_the_storm'],
    upgrades: 'c_blizzard', description: 'Upgrades Blizzard: storms follow you and chill 60% instead of 40%.' }),
  n('c_hailstorm', 'blizzard', 'Hailstorm', 1, 2, { prereqs: [{ node: 'c_blizzard', rank: 1 }], excludes: ['c_eye_of_the_storm'], mechanics: ['hailstorm'],
    upgrades: 'c_blizzard', description: 'Upgrades Blizzard: hail strikes an enemy inside every 0.33s for 0.6× frost.' }),
  n('c_frozen_orb', 'blizzard', 'Frozen Orb', 1, 2, { prereqs: [{ node: 'c_blizzard', rank: 1 }], excludes: ['c_whiteout'], grantsSkill: 'c_frozen_orb',
    description: 'Launches a slow orb that sprays ice shards and bursts into 8 at the end.' }),
  n('c_whiteout', 'blizzard', 'Whiteout', 1, 2, { prereqs: [{ node: 'c_blizzard', rank: 1 }], excludes: ['c_frozen_orb'], grantsSkill: 'c_whiteout',
    description: 'Calls a larger storm (radius 3.4, 6s) that freezes enemies hit by 4 pulses.' }),
  n('c_cold_front', 'blizzard', 'Cold Front', 1, 2, { prereqs: [{ node: 'c_blizzard', rank: 1 }], mechanics: ['cold_front'],
    upgrades: 'c_blizzard', description: 'Upgrades Blizzard: each kill refunds 0.75s of its cooldown.' }),
  n('c_twin_storms', 'blizzard', 'Twin Storms', 1, 3, { prereqs: [{ node: 'c_blizzard', rank: 1 }], mechanics: ['twin_storms'], upgrades: 'c_blizzard', description: 'Upgrades Blizzard: holds 2 charges, evolutions too.' }),
  n('c_frostbite', 'blizzard', 'Frostbite', 1, 3, { mechanics: ['frostbite'],
    description: 'Makes chilling hits add Frostbite: 12% of the damage per second for 3s.' }),
  n('c_maelstrom', 'blizzard', 'Maelstrom', 1, 4, { excludes: ['c_glacial_comet'], mechanics: ['maelstrom'],
    upgrades: 'c_blizzard', description: 'Upgrades Blizzard: storms drag enemies inward and pulse for ×1.4 damage.' }),
  n('c_glacial_comet', 'blizzard', 'Glacial Comet', 1, 4, { excludes: ['c_maelstrom'], mechanics: ['glacial_comet'],
    upgrades: 'c_blizzard', description: 'Upgrades Blizzard: when a storm ends, a comet hits its centre for 4× and freezes.' }),

  // ---- Cryomancer / Shatter ----
  n('c_frost_nova', 'shatter', 'Frost Nova', 1, 0, { starting: true, grantsSkill: 'c_frost_nova',
    description: 'Bursts ice around you (radius 3) for 1.2× frost and freezes enemies for 1.2s.' }),
  n('c_glacial_focus', 'shatter', 'Glacial Focus', 3, 1, { modifiers: [{ stat: 'player.critTendency', factorPerRank: '1.12' }], description: 'Raises critical tendency ×{value} per rank.' }),
  n('c_razor_ice', 'shatter', 'Razor Ice', 3, 1, { modifiers: [{ stat: 'player.critPotency', factorPerRank: '1.08' }], description: 'Raises critical damage ×{value} per rank.' }),
  n('c_cold_precision', 'shatter', 'Cold Precision', 2, 1, { prereqs: [{ node: 'c_frost_nova', rank: 1 }], mechanics: ['cold_precision'],
    description: 'Gives ×1.4 critical tendency per rank against chilled or frozen enemies.' }),
  n('c_chain_reaction', 'shatter', 'Chain Reaction', 1, 2, { prereqs: [{ node: 'c_frost_nova', rank: 1 }], excludes: ['c_deep_freeze'], mechanics: ['chain_reaction'],
    description: 'Makes Shatters explode for 1× frost in radius 2.2, chaining up to 3 links.' }),
  n('c_deep_freeze', 'shatter', 'Deep Freeze', 1, 2, { prereqs: [{ node: 'c_frost_nova', rank: 1 }], excludes: ['c_chain_reaction'], mechanics: ['deep_freeze'],
    description: 'Makes Freezes last ×1.5 and Shatters deal ×1.6, but they never spread.' }),
  n('c_glacial_spike', 'shatter', 'Glacial Spike', 1, 2, { prereqs: [{ node: 'c_frost_nova', rank: 1 }], excludes: ['c_cold_snap'], grantsSkill: 'c_glacial_spike',
    description: 'Erupts ice at a point for 2× frost and freezes, then detonates 0.6s later for 1.2×.' }),
  n('c_cold_snap', 'shatter', 'Cold Snap', 1, 2, { prereqs: [{ node: 'c_frost_nova', rank: 1 }], excludes: ['c_glacial_spike'], grantsSkill: 'c_cold_snap',
    description: 'Freezes every chilled enemy within 9 units and hits them for 1× frost.' }),
  n('c_crystallize', 'shatter', 'Crystallize', 1, 2, { prereqs: [{ node: 'c_frost_nova', rank: 1 }], mechanics: ['crystallize'],
    upgrades: 'c_ice_shard', description: 'Upgrades Ice Shard: 15% chance to freeze chilled enemies, and it shatters frozen ones.' }),
  n('c_ice_bloom', 'shatter', 'Ice Bloom', 1, 3, { mechanics: ['ice_bloom'],
    description: 'Makes chilled or frozen enemies you kill burst into 5 ice shards (0.6× each).' }),
  n('c_frozen_momentum', 'shatter', 'Frozen Momentum', 1, 3, { prereqs: [{ node: 'c_frost_nova', rank: 1 }], mechanics: ['frozen_momentum'],
    description: 'Cuts 0.5s from your Shatter skill and 0.25s from all cooldowns on each Shatter.' }),
  n('c_shatterpoint', 'shatter', 'Shatterpoint', 1, 4, { excludes: ['c_zero_point'], mechanics: ['shatterpoint'],
    description: 'Makes your hits on frozen enemies always crit, and Shatters can crit.' }),
  n('c_zero_point', 'shatter', 'Zero Point', 1, 4, { excludes: ['c_shatterpoint'], mechanics: ['zero_point'],
    upgrades: 'c_absolute_zero', description: 'Upgrades Absolute Zero: freezes for 2.4s, and each Shatter cuts 1s off its cooldown.' }),
];

export const CLASS: ClassDef = {
  id: 'cryomancer', name: 'Cryomancer', tagline: 'Ice, storm and shatter. Freezes the battlefield solid, then breaks it.',
  branches: [
    { id: 'glacier', name: 'Glacier', theme: 'Ice walls, frost armor and decoys' },
    { id: 'blizzard', name: 'Blizzard', theme: 'Storm fields, hail and frozen orbs' },
    { id: 'shatter', name: 'Shatter', theme: 'Freeze, critical strikes and chain detonations' },
  ],
  accent: '#7fe3ff', role: 'Ranged caster · control',
  base: { maxHealth: 760, armor: 12, damage: 78, attackFrequency: 2.0, moveSpeed: 4.5, critTendency: '0.25', critMultiplier: '2', shieldCapacity: 0.6 },
  basicSkill: 'c_ice_shard', signatureSkill: 'c_absolute_zero',
  nodes: NODES.map((x) => x.id),
};
