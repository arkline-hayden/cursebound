import type { ClassDef, NodeDef, SkillDef } from '../types';
import { node } from './common';

// Hexbinder: a dark caster of plague, blood and spirits. Almost everything deals decay damage and leaves "rot"
// (a decay damage-over-time). Every separate rot application on a target is one rot stack; several nodes read the
// stack count. Mechanics are implemented in packages/simulation/src/classes/hexbinder.ts.

const n = (id: string, branch: string, name: string, rankLimit: number, tier: NodeDef['tier'], opts: Parameters<typeof node>[6]) => node(id, 'hexbinder', branch, name, rankLimit, tier, opts);

const sk = (s: Omit<SkillDef, 'classId' | 'compressionSupport' | 'icon'> & { icon?: string }): SkillDef => ({ classId: 'hexbinder', compressionSupport: true, icon: `node:${s.id}`, ...s });

export const SKILLS: SkillDef[] = [
  sk({ id: 'h_hex_bolt', name: 'Hex Bolt', slot: 'basic', damageType: 'decay', damageCoef: '1', cooldownSec: 0, charges: 1,
    shape: { kind: 'projectile', speed: 10, radius: 0.28, range: 8.5, pierce: 0, spreadDeg: 12 },
    dot: { type: 'decay', fractionPerSec: '0.25', durationSec: 4 },
    description: 'A bolt of hexfire that rots its target: 25% of the hit as decay damage per second for 4s. Every bolt adds a rot stack.' }),
  sk({ id: 'h_grave_tide', name: 'Grave Tide', slot: 'signature', damageType: 'decay', damageCoef: '3', cooldownSec: 8.5, charges: 1,
    shape: { kind: 'line', length: 8, width: 3, duration: 1.15, tickInterval: 0 }, knockback: 0.9,
    description: 'Unleash a rolling wave of rot 3 units wide that surges 8 units forward: 3x decay damage to everything it washes over, rot (30%/s for 4s) and a 0.9 unit shove. Up to 6 enemies slain by the tide rise as homing spirits (0.8x decay damage). Builds boss stagger.' }),
  // ---- Pestilence ----
  sk({ id: 'h_plague_cloud', name: 'Plague Cloud', slot: 'active', damageType: 'decay', damageCoef: '0.4', cooldownSec: 4, charges: 1,
    shape: { kind: 'circle', radius: 2.2, selfCentered: false, range: 7 }, dot: { type: 'decay', fractionPerSec: '0.2', durationSec: 3 },
    description: 'Hurl a plague flask up to 7 units: a 2.2 radius cloud lingers for 4s, pulsing every 0.5s for 0.4x decay damage and rot (20%/s for 3s).' }),
  sk({ id: 'h_blightbloom', name: 'Blightbloom', slot: 'active', damageType: 'decay', damageCoef: '0.7', cooldownSec: 5.5, charges: 1,
    shape: { kind: 'circle', radius: 6, selfCentered: false, range: 7 }, dot: { type: 'decay', fractionPerSec: '0.2', durationSec: 3 },
    description: 'Plant a blight flower up to 7 units away for 6s. Every 0.75s it spits homing rot seeds at up to 3 enemies within 6 units (0.7x decay damage + rot); when it withers it bursts for 2.1x decay damage in a 2.5 radius.' }),
  sk({ id: 'h_locust_swarm', name: 'Locust Swarm', slot: 'active', damageType: 'decay', damageCoef: '0.35', cooldownSec: 5, charges: 1,
    shape: { kind: 'aura', radius: 1.6, duration: 5 }, dot: { type: 'decay', fractionPerSec: '0.15', durationSec: 3 },
    description: 'Release a plague swarm that sweeps to the aimed point (up to 8 units) and then hunts the nearest enemy for 5s. Enemies inside the 1.6 radius swarm take 0.35x decay damage every 0.25s and gain rot (15%/s for 3s).' }),
  // ---- Sanguine ----
  sk({ id: 'h_blood_tether', name: 'Blood Tether', slot: 'active', damageType: 'decay', damageCoef: '0.3', cooldownSec: 3.5, charges: 1,
    shape: { kind: 'line', length: 6, width: 0.6, duration: 3, tickInterval: 0.25 },
    description: 'Latch a blood tether onto the enemy nearest your aim (range 6) for 3s: every 0.25s it deals 0.3x decay damage and heals you for 30% of the damage dealt. It snaps beyond 8 units.' }),
  sk({ id: 'h_hemorrhage', name: 'Hemorrhage', slot: 'active', damageType: 'decay', damageCoef: '1.4', cooldownSec: 4, charges: 1,
    shape: { kind: 'circle', radius: 4, selfCentered: true, range: 0 },
    description: 'Blood tendrils rip into the 6 nearest enemies within 4 units: 1.4x decay damage each, pulling them 1.2 units toward you. You heal for 20% of the total damage dealt.' }),
  sk({ id: 'h_sanguine_lance', name: 'Sanguine Lance', slot: 'active', damageType: 'decay', damageCoef: '2.2', cooldownSec: 3.5, charges: 1,
    shape: { kind: 'projectile', speed: 16, radius: 0.4, range: 10, pierce: 99, spreadDeg: 0 },
    description: 'Hurl a lance of coagulated blood that pierces everything in a 10 unit line: 2.2x decay damage. Every enemy pierced heals you 2% maximum health and cuts 0.25s from its cooldown.' }),
  // ---- Wraithcall ----
  sk({ id: 'h_summon_wraith', name: 'Summon Wraith', slot: 'active', damageType: 'decay', damageCoef: '0.8', cooldownSec: 7, charges: 1,
    shape: { kind: 'aura', radius: 1.2, duration: 8 },
    description: 'Summon a wraith for 8s that hunts the nearest enemy (5.5 units/s) and slashes every 0.6s for 0.8x decay damage in a 1.2 radius, leaving rot (15%/s for 3s). Up to 2 wraiths; a third replaces the oldest.' }),
  sk({ id: 'h_banshee', name: 'Banshee', slot: 'active', damageType: 'decay', damageCoef: '1', cooldownSec: 7, charges: 1,
    shape: { kind: 'aura', radius: 3, duration: 7 },
    description: 'Summon a wailing banshee for 7s. Every 1.5s she shrieks: 1x decay damage within 3 units and a 1.2 unit knockback (40 boss stagger). Between shrieks she claws for 0.5x every 0.6s.' }),
  sk({ id: 'h_grave_legion', name: 'Grave Legion', slot: 'active', damageType: 'decay', damageCoef: '0.55', cooldownSec: 8.5, charges: 1,
    shape: { kind: 'aura', radius: 1, duration: 6 },
    description: 'Raise 3 skeletal wraiths around you for 6s. Each hunts at 6.5 units/s and slashes every 0.5s for 0.55x decay damage with rot. Recasting replaces the legion.' }),
];

export const NODES: NodeDef[] = [
  // ---- Pestilence: plagues, rot stacks and corpse bursts ----
  n('h_plague_cloud', 'pestilence', 'Plague Cloud', 1, 0, { starting: true, grantsSkill: 'h_plague_cloud', description: 'Lobs a 2.2-radius cloud that deals 0.4× decay and rot every 0.5s for 4s.' }),
  n('h_virulence', 'pestilence', 'Virulence', 3, 1, { modifiers: [{ stat: 'player.decayDamage', factorPerRank: '1.1' }], description: 'Raises decay damage ×{value} per rank, rot included.' }),
  n('h_lingering_rot', 'pestilence', 'Lingering Rot', 2, 1, { mechanics: ['lingering_rot'], description: 'Makes all rot you apply last +1s per rank.' }),
  n('h_fetid_reach', 'pestilence', 'Fetid Reach', 2, 1, { prereqs: [{ node: 'h_plague_cloud', rank: 1 }], modifiers: [{ stat: 'skill.h_plague_cloud.radius', factorPerRank: '1.12' }], upgrades: 'h_plague_cloud', description: 'Upgrades Plague Cloud: radius ×{value} per rank, evolutions too.' }),
  n('h_contagion', 'pestilence', 'Contagion', 1, 2, { mechanics: ['contagion'], description: 'Spreads 60% of a dying enemy\'s remaining rot to the 3 nearest enemies within 3 units.' }),
  n('h_blightbloom', 'pestilence', 'Blightbloom', 1, 2, { prereqs: [{ node: 'h_plague_cloud', rank: 1 }], grantsSkill: 'h_blightbloom', excludes: ['h_locust_swarm'],
    description: 'Plants a 6s flower that spits rot seeds (0.7×) and bursts for 2.1× when it withers.' }),
  n('h_locust_swarm', 'pestilence', 'Locust Swarm', 1, 2, { prereqs: [{ node: 'h_plague_cloud', rank: 1 }], grantsSkill: 'h_locust_swarm', excludes: ['h_blightbloom'],
    description: 'Sends a hunting swarm that shreds enemies for 0.35× decay every 0.25s for 5s.' }),
  n('h_corpse_bloom', 'pestilence', 'Corpse Bloom', 1, 3, { prereqs: [{ node: 'h_contagion', rank: 1 }], mechanics: ['corpse_bloom'],
    description: 'Makes rotting enemies burst on death for 1.2× decay in radius 2, chaining.' }),
  n('h_festering', 'pestilence', 'Festering Wounds', 1, 3, { mechanics: ['festering'],
    description: 'Your decay hits deal an extra 6% per rot stack beyond the first (up to 48%).' }),
  n('h_black_death', 'pestilence', 'Black Death', 1, 4, { excludes: ['h_rupture'], mechanics: ['black_death'],
    description: 'Every second each rotting enemy passes half its rot to a clean enemy within 3 units; rot ×1.25.' }),
  n('h_rupture', 'pestilence', 'Rupture', 1, 4, { excludes: ['h_black_death'], mechanics: ['rupture'],
    description: 'Decay hits on enemies with 5+ rot stacks consume your rot for 120% of its remaining damage.' }),

  // ---- Sanguine: life drain, blood price and blood shields ----
  n('h_blood_tether', 'sanguine', 'Blood Tether', 1, 0, { starting: true, grantsSkill: 'h_blood_tether', description: 'Tethers an enemy for 3s, draining 0.3× decay every 0.25s and healing you 30%.' }),
  n('h_crimson_vigor', 'sanguine', 'Crimson Vigor', 3, 1, { modifiers: [{ stat: 'player.maxHealth', factorPerRank: '1.1' }], description: 'Raises max health ×{value} per rank.' }),
  n('h_thirst', 'sanguine', 'Thirst', 2, 1, { modifiers: [{ stat: 'player.healing', factorPerRank: '1.1' }], description: 'Raises all healing you receive ×{value} per rank.' }),
  n('h_blood_price', 'sanguine', 'Blood Price', 1, 1, { mechanics: ['blood_price'],
    description: 'Cuts cooldowns ×0.7 while above 35% health, but each skill cast costs 3% max health.' }),
  n('h_blood_ward', 'sanguine', 'Blood Ward', 1, 2, { mechanics: ['blood_ward'], description: 'Turns overhealing from your heals into a blood shield, up to your shield cap.' }),
  n('h_hemorrhage', 'sanguine', 'Hemorrhage', 1, 2, { prereqs: [{ node: 'h_blood_tether', rank: 1 }], grantsSkill: 'h_hemorrhage', excludes: ['h_sanguine_lance'],
    description: 'Rips the 6 nearest enemies for 1.4×, drags them to you, and heals 20%.' }),
  n('h_sanguine_lance', 'sanguine', 'Sanguine Lance', 1, 2, { prereqs: [{ node: 'h_blood_tether', rank: 1 }], grantsSkill: 'h_sanguine_lance', excludes: ['h_hemorrhage'],
    description: 'Hurls a piercing 2.2× lance; each enemy pierced heals 2% and cuts 0.25s off its cooldown.' }),
  n('h_crimson_frenzy', 'sanguine', 'Crimson Frenzy', 1, 3, { mechanics: ['crimson_frenzy'],
    description: 'Below 50% health, deals ×1.25 damage and recovers cooldowns 25% faster.' }),
  n('h_exsanguinate', 'sanguine', 'Exsanguinate', 1, 3, { prereqs: [{ node: 'h_blood_tether', rank: 1 }], mechanics: ['exsanguinate'],
    upgrades: 'h_blood_tether', description: 'Upgrades Blood Tether: its kills explode for 1.2× decay and heal you 3%, evolutions too.' }),
  n('h_blood_sacrament', 'sanguine', 'Blood Sacrament', 1, 4, { excludes: ['h_crimson_covenant'], mechanics: ['blood_sacrament'],
    description: 'Each cast spends 8% of your current health for a 6s ×1.07 damage stack (max 5), never below 30%.' }),
  n('h_crimson_covenant', 'sanguine', 'Crimson Covenant', 1, 4, { excludes: ['h_blood_sacrament'], modifiers: [{ stat: 'player.shieldCapacity', factorPerRank: '1.5' }], mechanics: ['crimson_covenant'],
    description: 'Raises shield cap ×{value}; Sanguine skills turn 40% of damage into shield and deal ×1.3 while shielded.' }),

  // ---- Wraithcall: spirits, wraiths and soul harvest ----
  n('h_summon_wraith', 'wraithcall', 'Summon Wraith', 1, 0, { starting: true, grantsSkill: 'h_summon_wraith', description: 'Summons a wraith for 8s that slashes for 0.8× decay every 0.6s.' }),
  n('h_grave_strength', 'wraithcall', 'Grave Strength', 3, 1, { prereqs: [{ node: 'h_summon_wraith', rank: 1 }], modifiers: [{ stat: 'skill.h_summon_wraith.damage', factorPerRank: '1.1' }],
    upgrades: 'h_summon_wraith', description: 'Upgrades Summon Wraith: damage ×{value} per rank, all spirits too.' }),
  n('h_soul_harvest', 'wraithcall', 'Soul Harvest', 2, 1, { mechanics: ['soul_harvest'],
    description: 'Kills cut 0.15s per rank from all cooldowns and tear out an orbiting Soul (max 6).' }),
  n('h_spectral_haste', 'wraithcall', 'Spectral Haste', 2, 1, { modifiers: [{ stat: 'player.movementSpeed', factorPerRank: '1.05' }], description: 'Raises movement speed ×{value} per rank.' }),
  n('h_spirit_ward', 'wraithcall', 'Spirit Ward', 1, 2, { prereqs: [{ node: 'h_soul_harvest', rank: 1 }], mechanics: ['spirit_ward'],
    description: 'Makes orbiting Souls hit enemies they touch for 0.35× decay every 0.4s.' }),
  n('h_banshee', 'wraithcall', 'Banshee', 1, 2, { prereqs: [{ node: 'h_summon_wraith', rank: 1 }], grantsSkill: 'h_banshee', excludes: ['h_grave_legion'],
    description: 'Summons a 7s banshee whose shriek blasts nearby enemies for 1× every 1.5s.' }),
  n('h_grave_legion', 'wraithcall', 'Grave Legion', 1, 2, { prereqs: [{ node: 'h_summon_wraith', rank: 1 }], grantsSkill: 'h_grave_legion', excludes: ['h_banshee'],
    description: 'Raises 3 fast wraiths for 6s that hit for 0.55× every 0.5s.' }),
  n('h_soul_volley', 'wraithcall', 'Soul Volley', 1, 3, { mechanics: ['soul_volley'],
    upgrades: 'h_hex_bolt', description: 'Upgrades Hex Bolt: every 3rd bolt adds a homing spirit (0.8×, or 1.6× by spending a Soul).' }),
  n('h_death_knell', 'wraithcall', 'Death Knell', 1, 3, { prereqs: [{ node: 'h_summon_wraith', rank: 1 }], mechanics: ['death_knell'],
    upgrades: 'h_summon_wraith', description: 'Upgrades Summon Wraith: fading spirits explode for 1.5× and release 2 homing spirits.' }),
  n('h_legion_of_the_damned', 'wraithcall', 'Legion of the Damned', 1, 4, { excludes: ['h_soul_eater'], mechanics: ['legion_of_the_damned'],
    description: 'Raises each enemy you kill as a 4s lesser wraith (max 4).' }),
  n('h_soul_eater', 'wraithcall', 'Soul Eater', 1, 4, { prereqs: [{ node: 'h_soul_harvest', rank: 1 }], excludes: ['h_legion_of_the_damned'], mechanics: ['soul_eater'],
    description: 'Grants ×1.06 damage per orbiting Soul (max 6); spirit kills heal you 2%.' }),
];

export const CLASS: ClassDef = {
  id: 'hexbinder', name: 'Hexbinder', tagline: 'Plague, blood and spirits. Rots the horde, drinks its life and raises the dead.',
  branches: [
    { id: 'pestilence', name: 'Pestilence', theme: 'Rot stacks, spreading plagues and corpse bursts' },
    { id: 'sanguine', name: 'Sanguine', theme: 'Life drain, blood price and blood shields' },
    { id: 'wraithcall', name: 'Wraithcall', theme: 'Wraiths, homing spirits and soul harvest' },
  ],
  accent: '#8fd14f', role: 'Ranged caster · plague & summons',
  base: { maxHealth: 850, armor: 15, damage: 82, attackFrequency: 2.0, moveSpeed: 4.6, critTendency: '0.25', critMultiplier: '2', shieldCapacity: 0.6 },
  basicSkill: 'h_hex_bolt', signatureSkill: 'h_grave_tide',
  nodes: NODES.map((x) => x.id),
};
