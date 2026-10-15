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
    description: 'Blood tendrils rip into the 6 nearest enemies within 4 units: 1.4x decay damage each, dragging them 1.2 units toward you. You heal for 20% of the total damage dealt.' }),
  sk({ id: 'h_sanguine_lance', name: 'Sanguine Lance', slot: 'active', damageType: 'decay', damageCoef: '2.2', cooldownSec: 3.5, charges: 1,
    shape: { kind: 'projectile', speed: 16, radius: 0.4, range: 10, pierce: 99, spreadDeg: 0 },
    description: 'Hurl a lance of coagulated blood that pierces everything in a 10 unit line: 2.2x decay damage. Every enemy pierced heals you 2% maximum health and restores 3 Blood.' }),
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
  n('h_plague_cloud', 'pestilence', 'Plague Cloud', 1, 0, { starting: true, grantsSkill: 'h_plague_cloud', description: 'Equip Plague Cloud: a lobbed 2.2 radius cloud that pulses 0.4x decay damage and rot every 0.5s for 4s.' }),
  n('h_virulence', 'pestilence', 'Virulence', 3, 1, { modifiers: [{ stat: 'player.decayDamage', factorPerRank: '1.1' }], description: 'Decay damage (hits and rot) x1.1 per rank.' }),
  n('h_lingering_rot', 'pestilence', 'Lingering Rot', 2, 1, { mechanics: ['lingering_rot'], description: 'All rot you apply lasts 1 second longer per rank (Hex Bolt rot: 4s -> 6s at rank 2).' }),
  n('h_fetid_reach', 'pestilence', 'Fetid Reach', 2, 1, { prereqs: [{ node: 'h_plague_cloud', rank: 1 }], modifiers: [{ stat: 'skill.h_plague_cloud.radius', factorPerRank: '1.12' }], description: 'Radius of Plague Cloud, the Blightbloom burst and the Locust Swarm x1.12 per rank.' }),
  n('h_contagion', 'pestilence', 'Contagion', 1, 2, { mechanics: ['contagion'], description: 'When an enemy dies while rotting, its remaining rot leaps to the 3 nearest enemies within 3 units (each receives 60% of the remaining rot damage over 3s). Works on kills by allies.' }),
  n('h_blightbloom', 'pestilence', 'Blightbloom', 1, 2, { prereqs: [{ node: 'h_plague_cloud', rank: 1 }], grantsSkill: 'h_blightbloom', excludes: ['h_locust_swarm'],
    description: 'Evolve Plague Cloud into Blightbloom: a 6s blight flower that spits homing rot seeds (0.7x) at 3 enemies every 0.75s and bursts for 2.1x when it withers. Choice: excludes Locust Swarm.' }),
  n('h_locust_swarm', 'pestilence', 'Locust Swarm', 1, 2, { prereqs: [{ node: 'h_plague_cloud', rank: 1 }], grantsSkill: 'h_locust_swarm', excludes: ['h_blightbloom'],
    description: 'Evolve Plague Cloud into Locust Swarm: a hunting plague swarm that shreds enemies for 0.35x decay damage every 0.25s for 5s. Choice: excludes Blightbloom.' }),
  n('h_corpse_bloom', 'pestilence', 'Corpse Bloom', 1, 3, { prereqs: [{ node: 'h_contagion', rank: 1 }], mechanics: ['corpse_bloom'],
    description: 'Enemies that die while rotting burst 0.25s later for 1.2x decay damage in a 2 unit radius, rotting everything caught (20%/s for 3s). Bursts chain from corpse to corpse.' }),
  n('h_festering', 'pestilence', 'Festering Wounds', 1, 3, { mechanics: ['festering'],
    description: 'Your direct hits on a rotting enemy deal an extra decay hit of 6% of the damage per rot stack beyond the first (up to +48% at 9 stacks).' }),
  n('h_black_death', 'pestilence', 'Black Death', 1, 4, { excludes: ['h_rupture'], mechanics: ['black_death'],
    description: 'Keystone: rot is a living plague. Every second each enemy rotting from you infects the nearest clean enemy within 3 units with 50% of its rot rate for 3s, and all rot you apply is x1.25 stronger. Choice: excludes Rupture.' }),
  n('h_rupture', 'pestilence', 'Rupture', 1, 4, { excludes: ['h_black_death'], mechanics: ['rupture'],
    description: 'Keystone: your direct hits on an enemy with 5+ rot stacks rupture it, instantly dealing 120% of all your remaining rot on it as decay damage and consuming the rot. Choice: excludes Black Death.' }),

  // ---- Sanguine: life drain, blood price and blood shields ----
  n('h_blood_tether', 'sanguine', 'Blood Tether', 1, 0, { starting: true, grantsSkill: 'h_blood_tether', description: 'Equip Blood Tether: a 3s life-draining tether (0.3x decay every 0.25s, heals 30% of damage dealt).' }),
  n('h_crimson_vigor', 'sanguine', 'Crimson Vigor', 3, 1, { modifiers: [{ stat: 'player.maxHealth', factorPerRank: '1.1' }], description: 'Maximum health x1.1 per rank.' }),
  n('h_thirst', 'sanguine', 'Thirst', 2, 1, { modifiers: [{ stat: 'player.healing', factorPerRank: '1.1' }], description: 'All healing you receive x1.1 per rank.' }),
  n('h_blood_price', 'sanguine', 'Blood Price', 1, 1, { mechanics: ['blood_price'],
    description: 'When you lack Blood for a skill, the shortfall is paid with health: 1% maximum health per missing Blood. Only works while the payment leaves you above 35% health, so it can never down you.' }),
  n('h_blood_ward', 'sanguine', 'Blood Ward', 1, 2, { mechanics: ['blood_ward'], description: 'Overhealing from your Hexbinder heals (tether, lance, hemorrhage, souls) becomes a blood shield, up to your shield cap.' }),
  n('h_hemorrhage', 'sanguine', 'Hemorrhage', 1, 2, { prereqs: [{ node: 'h_blood_tether', rank: 1 }], grantsSkill: 'h_hemorrhage', excludes: ['h_sanguine_lance'],
    description: 'Evolve Blood Tether into Hemorrhage: tendrils rip the 6 nearest enemies within 4 units (1.4x), drag them 1.2 units to you and heal 20% of the damage. Choice: excludes Sanguine Lance.' }),
  n('h_sanguine_lance', 'sanguine', 'Sanguine Lance', 1, 2, { prereqs: [{ node: 'h_blood_tether', rank: 1 }], grantsSkill: 'h_sanguine_lance', excludes: ['h_hemorrhage'],
    description: 'Evolve Blood Tether into Sanguine Lance: a piercing 10 unit blood lance (2.2x) that heals 2% maximum health and restores 3 Blood per enemy pierced. Choice: excludes Hemorrhage.' }),
  n('h_crimson_frenzy', 'sanguine', 'Crimson Frenzy', 1, 3, { mechanics: ['crimson_frenzy'],
    description: 'While below 50% health, all your damage is x1.25 and you regenerate Blood 50% faster.' }),
  n('h_exsanguinate', 'sanguine', 'Exsanguinate', 1, 3, { prereqs: [{ node: 'h_blood_tether', rank: 1 }], mechanics: ['exsanguinate'],
    description: 'Enemies killed by Blood Tether, Hemorrhage or Sanguine Lance explode in a blood nova: 1.2x decay damage within 2 units, and you heal 3% maximum health.' }),
  n('h_blood_sacrament', 'sanguine', 'Blood Sacrament', 1, 4, { excludes: ['h_crimson_covenant'], mechanics: ['blood_sacrament'],
    description: 'Keystone: every skill you cast sacrifices 8% of your current health (never below 30% maximum health; skipped at or under it) and grants a Bloodlust stack for 6s: x1.07 damage per stack, up to 5 (x1.40). Choice: excludes Crimson Covenant.' }),
  n('h_crimson_covenant', 'sanguine', 'Crimson Covenant', 1, 4, { excludes: ['h_blood_sacrament'], modifiers: [{ stat: 'player.shieldCapacity', factorPerRank: '1.5' }], mechanics: ['crimson_covenant'],
    description: 'Keystone: shield capacity x1.5. Your Blood skills convert 40% of the damage they deal into a blood shield, and deal x1.3 damage while you are shielded. Choice: excludes Blood Sacrament.' }),

  // ---- Wraithcall: spirits, wraiths and soul harvest ----
  n('h_summon_wraith', 'wraithcall', 'Summon Wraith', 1, 0, { starting: true, grantsSkill: 'h_summon_wraith', description: 'Equip Summon Wraith: an 8s hunting wraith that slashes for 0.8x decay damage every 0.6s.' }),
  n('h_grave_strength', 'wraithcall', 'Grave Strength', 3, 1, { modifiers: [{ stat: 'skill.h_summon_wraith.damage', factorPerRank: '1.1' }],
    description: 'Spirit damage x1.1 per rank: wraiths, the banshee, the legion, souls and homing spirits.' }),
  n('h_soul_harvest', 'wraithcall', 'Soul Harvest', 2, 1, { mechanics: ['soul_harvest'],
    description: 'Your kills restore 2 Blood per rank and tear out a Soul that orbits you for 10s (up to 6 Souls; extra kills refresh the oldest).' }),
  n('h_spectral_haste', 'wraithcall', 'Spectral Haste', 2, 1, { modifiers: [{ stat: 'player.movementSpeed', factorPerRank: '1.05' }], description: 'Movement speed x1.05 per rank.' }),
  n('h_spirit_ward', 'wraithcall', 'Spirit Ward', 1, 2, { prereqs: [{ node: 'h_soul_harvest', rank: 1 }], mechanics: ['spirit_ward'],
    description: 'Orbiting Souls strike enemies they touch: 0.35x decay damage per Soul every 0.4s.' }),
  n('h_banshee', 'wraithcall', 'Banshee', 1, 2, { prereqs: [{ node: 'h_summon_wraith', rank: 1 }], grantsSkill: 'h_banshee', excludes: ['h_grave_legion'],
    description: 'Evolve Summon Wraith into Banshee: a 7s spirit whose shriek blasts everything within 3 units (1x decay, 1.2 knockback) every 1.5s. Choice: excludes Grave Legion.' }),
  n('h_grave_legion', 'wraithcall', 'Grave Legion', 1, 2, { prereqs: [{ node: 'h_summon_wraith', rank: 1 }], grantsSkill: 'h_grave_legion', excludes: ['h_banshee'],
    description: 'Evolve Summon Wraith into Grave Legion: raise 3 fast skeletal wraiths for 6s (0.55x every 0.5s each). Choice: excludes Banshee.' }),
  n('h_soul_volley', 'wraithcall', 'Soul Volley', 1, 3, { mechanics: ['soul_volley'],
    description: 'Every 3rd Hex Bolt also launches a homing spirit (0.8x decay damage). If you have an orbiting Soul, it is consumed and the spirit deals 1.6x instead.' }),
  n('h_death_knell', 'wraithcall', 'Death Knell', 1, 3, { prereqs: [{ node: 'h_summon_wraith', rank: 1 }], mechanics: ['death_knell'],
    description: 'When any of your wraiths, banshees or legionnaires fades, it detonates for 1.5x decay damage in a 2.2 radius and releases 2 homing spirits.' }),
  n('h_legion_of_the_damned', 'wraithcall', 'Legion of the Damned', 1, 4, { excludes: ['h_soul_eater'], mechanics: ['legion_of_the_damned'],
    description: 'Keystone: every enemy you kill rises as a lesser wraith for 4s (0.4x decay damage every 0.6s, up to 4 at once). Choice: excludes Soul Eater.' }),
  n('h_soul_eater', 'wraithcall', 'Soul Eater', 1, 4, { excludes: ['h_legion_of_the_damned'], mechanics: ['soul_eater'],
    description: 'Keystone: each orbiting Soul grants x1.06 damage (up to 6: x1.42), and every kill by your spirits or wraiths heals you 2% maximum health. Choice: excludes Legion of the Damned.' }),
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
