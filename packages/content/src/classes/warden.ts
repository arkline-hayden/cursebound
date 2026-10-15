import type { ClassDef, NodeDef, SkillDef } from '../types';
import { MELEE_PASSIVES, node } from './common';

// Warden: a nature guardian who fights beside spirit beasts and makes the ground itself hostile.
// Grove = roots, healing blooms and barkskin; Beast = a spirit-wolf pack, the Ursa and pounces; Thorns = reflected
// pain, bramble walls and spreading Venom (a decay damage-over-time). Every mechanic is implemented in
// packages/simulation/src/classes/warden.ts.
//
// Shared rules referenced by the descriptions:
// - Root: the enemy cannot move but can still attack. Roots never stack or extend; when a root ends the enemy is
//   immune to Warden roots for 1.5s. Bosses are never rooted; a root attempt adds 40 boss stagger instead (8 from
//   root-patch and bramble pulses). Root durations x Root duration.
// - Venom: decay damage-over-time from the Thorns branch (x Decay damage).
// - Spirit beasts (wolves, the Ursa, the Wild Hunt stampede) cannot be harmed and are bounded in number.

const n = (id: string, branch: string, name: string, rankLimit: number, tier: NodeDef['tier'], opts: Parameters<typeof node>[6]) => node(id, 'warden', branch, name, rankLimit, tier, opts);

const sk = (s: Omit<SkillDef, 'classId' | 'compressionSupport' | 'icon'> & { icon?: string }): SkillDef => ({ classId: 'warden', compressionSupport: true, icon: `node:${s.id}`, ...s });

export const SKILLS: SkillDef[] = [
  // ---------------- basic & signature ----------------
  sk({ id: 'w_thornspear', name: 'Thornspear', slot: 'basic', damageType: 'physical', damageCoef: '1', cooldownSec: 0, charges: 1,
    shape: { kind: 'arc', range: 2.1, arcDeg: 90 },
    description: `Thrust your thorned spear through a 90 degree arc (range 2.1) for 1x physical damage and loose a thorn shard (0.45x physical, range 5, pierces 1 enemy). Living Sap: each connecting thrust heals 0.5% of maximum health. ${MELEE_PASSIVES}` }),
  sk({ id: 'w_wild_hunt', name: 'Wild Hunt', slot: 'signature', damageType: 'physical', damageCoef: '3.2', cooldownSec: 8.5, charges: 1,
    shape: { kind: 'line', length: 11, width: 3.2, duration: 1, tickInterval: 0 }, knockback: 1.5,
    description: 'Call a stampede of five spectral elk that thunders 11 units along your aim through a 3.2 unit wide lane at 11 units/s. Every enemy in its path is trampled once for 3.2x physical damage (x Spirit beast damage) and carried 1.5 units along the charge. Builds 160 boss stagger.' }),

  // ---------------- Grove ----------------
  sk({ id: 'w_entangle', name: 'Entangle', slot: 'active', damageType: 'physical', damageCoef: '1.1', cooldownSec: 5, charges: 1,
    shape: { kind: 'circle', radius: 2.4, selfCentered: false, range: 7 },
    description: 'Hurl a seed up to 7 units: it bursts into a 2.4 radius root patch dealing 1.1x physical damage and rooting enemies for 2s. The patch lasts 4s and pulses every 0.5s for 0.25x physical damage and a 1s root.' }),
  sk({ id: 'w_verdant_totem', name: 'Verdant Totem', slot: 'active', damageType: 'physical', damageCoef: '1.1', cooldownSec: 8.5, charges: 1,
    shape: { kind: 'aura', radius: 4, duration: 8 },
    description: 'Plant a living totem up to 6 units away. It erupts like Entangle (2.4 radius, 1.1x physical, 2s root, 4s root patch) and stands for 8s, healing every ally within 4 units for 3% of maximum health each second (x Grove healing).' }),
  sk({ id: 'w_worldroot', name: 'Worldroot Eruption', slot: 'active', damageType: 'physical', damageCoef: '1.8', cooldownSec: 6.5, charges: 1,
    shape: { kind: 'line', length: 9, width: 1.4, duration: 4, tickInterval: 0.5 },
    description: 'Roots rip through the ground along a 9 unit line at 18 units/s. Every enemy reached takes 1.8x physical damage and is rooted for 2.5s; the line stays as a 1.4 wide root patch for 4s (0.25x physical and a 1s root every 0.5s).' }),

  // ---------------- Beast ----------------
  sk({ id: 'w_call_pack', name: 'Call of the Pack', slot: 'active', damageType: 'physical', damageCoef: '1.2', cooldownSec: 5.5, charges: 1,
    shape: { kind: 'aura', radius: 9, duration: 18 },
    description: 'Howl: summon spirit wolves until you lead 3 (each lasts 18s); every wolf leaps at the enemy nearest your aim for 1.2x physical damage. Wolves bite every 0.9s for 0.45x physical, pounce on enemies 1.6 to 4.5 units away for 0.9x (each wolf every 4s) and follow you when idle.' }),
  sk({ id: 'w_ursine_call', name: 'Spirit of the Ursa', slot: 'active', damageType: 'physical', damageCoef: '2.6', cooldownSec: 8.5, charges: 1,
    shape: { kind: 'circle', radius: 2.6, selfCentered: false, range: 6 }, knockback: 1.5,
    description: 'Calls the pack (as Call of the Pack) and a Great Spirit Bear crashes down up to 6 units away: 2.6x physical damage in a 2.6 radius, 1.5 unit knockback, 120 boss stagger. The Ursa fights for 10s, swiping the enemy nearest it every 1.4s for 1.4x physical in a 1.8 range, 120 degree arc.' }),
  sk({ id: 'w_alpha_pounce', name: 'Alpha Pounce', slot: 'active', damageType: 'physical', damageCoef: '1.8', cooldownSec: 4, charges: 1,
    shape: { kind: 'circle', radius: 2.2, selfCentered: false, range: 6 },
    description: 'Leap up to 6 units along your aim in 0.3s (invulnerable while airborne) and land with a 2.2 radius slam: 1.8x physical damage and a 1s root. Then call the pack (as Call of the Pack): every wolf leaps at the enemy nearest your landing.' }),

  // ---------------- Thorns ----------------
  sk({ id: 'w_thornburst', name: 'Thornburst', slot: 'active', damageType: 'physical', damageCoef: '1.7', cooldownSec: 4, charges: 1,
    shape: { kind: 'circle', radius: 2.8, selfCentered: true, range: 0 },
    description: 'Erupt in a 2.8 radius nova of thorns: 1.7x physical damage and Venom (25% of the hit as decay damage per second for 4s). Grants Thorn Armor for 4s: enemies that damage you with a direct attack are lashed for 0.8x physical damage plus 50% of the damage you took.' }),
  sk({ id: 'w_bramble_wall', name: 'Bramble Wall', slot: 'active', damageType: 'physical', damageCoef: '1.7', cooldownSec: 7, charges: 1,
    shape: { kind: 'line', length: 7, width: 0.9, duration: 6, tickInterval: 0.5 },
    description: 'Erupt as Thornburst (nova, Venom, Thorn Armor), then raise a 7 unit bramble wall 2.5 units ahead, across your aim, for 6s. Enemies touching it take 0.6x physical damage every 0.5s, gain Venom and are rooted for 0.75s.' }),
  sk({ id: 'w_thorn_pod', name: 'Ironthorn Pod', slot: 'active', damageType: 'physical', damageCoef: '2.6', cooldownSec: 6.5, charges: 1,
    shape: { kind: 'circle', radius: 3.2, selfCentered: false, range: 7 },
    description: 'Hurl a pod up to 7 units that detonates after 0.7s: 2.6x physical damage with Venom in a 3.2 radius, flinging 8 thorn shards outward (0.45x each, range 5). Casting grants Thorn Armor for 4s.' }),

  // ---------------- helper effects (not equippable; damage coefficients for kit effects) ----------------
  sk({ id: 'w_thorn_shard', name: 'Thorn Shard', slot: 'active', damageType: 'physical', damageCoef: '0.45', cooldownSec: 0, charges: 1,
    shape: { kind: 'projectile', speed: 13, radius: 0.22, range: 5, pierce: 1, spreadDeg: 10 }, description: 'Thorn shard loosed by Thornspear and Ironthorn Pod.' }),
  sk({ id: 'w_bear_maul', name: 'Maul', slot: 'active', damageType: 'physical', damageCoef: '1.7', cooldownSec: 0, charges: 1,
    shape: { kind: 'arc', range: 2.3, arcDeg: 150 }, description: 'Feral Shift basic attack. Living Sap: each connecting maul heals 0.5% of maximum health.', icon: 'node:w_feral_shift' }),
  sk({ id: 'w_wolf_bite', name: 'Wolf Bite', slot: 'active', damageType: 'physical', damageCoef: '0.45', cooldownSec: 0, charges: 1,
    shape: { kind: 'circle', radius: 0.6, selfCentered: false, range: 0 }, description: 'Spirit wolf bite.', icon: 'node:w_call_pack' }),
  sk({ id: 'w_wolf_pounce', name: 'Wolf Pounce', slot: 'active', damageType: 'physical', damageCoef: '0.9', cooldownSec: 0, charges: 1,
    shape: { kind: 'circle', radius: 0.9, selfCentered: false, range: 4.5 }, description: 'Spirit wolf pounce.', icon: 'node:w_call_pack' }),
  sk({ id: 'w_pack_command', name: 'Pack Leap', slot: 'active', damageType: 'physical', damageCoef: '1.2', cooldownSec: 0, charges: 1,
    shape: { kind: 'circle', radius: 0.9, selfCentered: false, range: 8 }, description: 'Commanded wolf leap from Call of the Pack.', icon: 'node:w_call_pack' }),
  sk({ id: 'w_ursa_swipe', name: 'Ursa Swipe', slot: 'active', damageType: 'physical', damageCoef: '1.4', cooldownSec: 0, charges: 1,
    shape: { kind: 'arc', range: 1.8, arcDeg: 120 }, description: 'The Ursa\'s swipe.', icon: 'node:w_ursine_call' }),
  sk({ id: 'w_root_pulse', name: 'Root Patch', slot: 'active', damageType: 'physical', damageCoef: '0.25', cooldownSec: 0, charges: 1,
    shape: { kind: 'circle', radius: 2.4, selfCentered: false, range: 0 }, description: 'Root patch pulse.', icon: 'node:w_entangle' }),
  sk({ id: 'w_strangle', name: 'Strangling Vines', slot: 'active', damageType: 'physical', damageCoef: '0.35', cooldownSec: 0, charges: 1,
    shape: { kind: 'circle', radius: 0.5, selfCentered: false, range: 0 }, description: 'Damage per second while strangled.', icon: 'node:w_strangling_vines' }),
  sk({ id: 'w_bloodroot', name: 'Bloodroot', slot: 'active', damageType: 'physical', damageCoef: '0.9', cooldownSec: 0, charges: 1,
    shape: { kind: 'circle', radius: 0.5, selfCentered: false, range: 0 }, description: 'Bloodroot burst per rooted second.', icon: 'node:w_worldtree_grasp' }),
  sk({ id: 'w_thorn_lash', name: 'Thorn Lash', slot: 'active', damageType: 'physical', damageCoef: '0.8', cooldownSec: 0, charges: 1,
    shape: { kind: 'circle', radius: 0.5, selfCentered: false, range: 12 }, description: 'Thorn Armor reflection.', icon: 'node:w_thornburst' }),
  sk({ id: 'w_thorn_nova', name: 'Heart of Thorns', slot: 'active', damageType: 'physical', damageCoef: '0.8', cooldownSec: 0, charges: 1,
    shape: { kind: 'circle', radius: 1.8, selfCentered: true, range: 0 }, description: 'Thorn burst on reflection.', icon: 'node:w_heart_of_thorns' }),
  sk({ id: 'w_bramble_pulse', name: 'Bramble', slot: 'active', damageType: 'physical', damageCoef: '0.6', cooldownSec: 0, charges: 1,
    shape: { kind: 'line', length: 7, width: 0.9, duration: 6, tickInterval: 0.5 }, description: 'Bramble Wall pulse.', icon: 'node:w_bramble_wall' }),
  sk({ id: 'w_venom_burst', name: 'Venom Bloom', slot: 'active', damageType: 'physical', damageCoef: '1.4', cooldownSec: 0, charges: 1,
    shape: { kind: 'circle', radius: 2, selfCentered: false, range: 0 }, description: 'Venom Bloom corpse burst.', icon: 'node:w_venom_bloom' }),
];

const choice = (...ids: string[]) => ids;

export const NODES: NodeDef[] = [
  // ---- Warden / Grove ----
  n('w_entangle', 'grove', 'Entangle', 1, 0, { starting: true, grantsSkill: 'w_entangle', mechanics: ['w_root'],
    description: 'Equip Entangle: hurl a seed up to 7 units that bursts into a 2.4 radius root patch: 1.1x physical damage and a 2s root. The patch lasts 4s, pulsing every 0.5s for 0.25x physical damage and a 1s root. Rooted enemies cannot move but can still attack. Roots never stack or extend, and a freed enemy is immune to roots for 1.5s. Bosses are never rooted: a root adds 40 boss stagger instead (8 from patch and bramble pulses).' }),
  n('w_ironbark', 'grove', 'Ironbark', 3, 1, { modifiers: [{ stat: 'player.armor', factorPerRank: '1.12' }], description: 'Armor x1.12 per rank.' }),
  n('w_heartwood', 'grove', 'Heartwood', 3, 1, { modifiers: [{ stat: 'player.maxHealth', factorPerRank: '1.07' }], description: 'Maximum health x1.07 per rank.' }),
  n('w_grasping_earth', 'grove', 'Grasping Earth', 2, 1, { prereqs: [{ node: 'w_entangle', rank: 1 }], modifiers: [{ stat: 'player.rootDuration', factorPerRank: '1.2' }],
    description: 'Root duration x1.2 per rank (every root you apply: Entangle and its evolutions, Alpha Pounce, Bramble Wall).' }),
  n('w_wild_growth', 'grove', 'Wild Growth', 2, 1, { prereqs: [{ node: 'w_entangle', rank: 1 }], mechanics: ['w_wild_growth'],
    description: 'Root patches from Entangle, Verdant Totem, Worldroot Eruption and Overgrowth are x1.15 larger per rank (radius, or width for Worldroot).' }),
  n('w_strangling_vines', 'grove', 'Strangling Vines', 1, 2, { prereqs: [{ node: 'w_entangle', rank: 1 }], excludes: choice('w_overgrowth'), mechanics: ['w_strangle'],
    description: 'Choice. Your roots strangle: a rooted enemy takes 0.35x physical damage per second for the whole root, and non-boss enemies are stunned for the first 0.6s of each root (an attack windup is interrupted).' }),
  n('w_overgrowth', 'grove', 'Overgrowth', 1, 2, { prereqs: [{ node: 'w_entangle', rank: 1 }], excludes: choice('w_strangling_vines'), mechanics: ['w_overgrowth'],
    description: 'Choice. An enemy that dies while rooted by you sprouts a 1.6 radius root patch at its corpse for 2.5s (0.25x physical and a 1s root every 0.5s). A sprout can sprout once more (2 generations).' }),
  n('w_verdant_totem', 'grove', 'Verdant Totem', 1, 2, { prereqs: [{ node: 'w_entangle', rank: 1 }], grantsSkill: 'w_verdant_totem', excludes: choice('w_worldroot'), mechanics: ['w_totem'],
    description: 'Evolves Entangle (choice). Verdant Totem: plant a living totem up to 6 units away. It erupts like Entangle (2.4 radius, 1.1x physical, 2s root, 4s root patch) and stands for 8s, healing every ally within 4 units for 3% of maximum health each second (x Grove healing).' }),
  n('w_worldroot', 'grove', 'Worldroot Eruption', 1, 2, { prereqs: [{ node: 'w_entangle', rank: 1 }], grantsSkill: 'w_worldroot', excludes: choice('w_verdant_totem'), mechanics: ['w_worldroot'],
    description: 'Evolves Entangle (choice). Worldroot Eruption: roots rip along a 9 unit line at 18 units/s; every enemy reached takes 1.8x physical damage and is rooted for 2.5s. The line remains a 1.4 wide root patch for 4s (0.25x physical and a 1s root every 0.5s).' }),
  n('w_barkskin', 'grove', 'Barkskin', 1, 3, { mechanics: ['w_barkskin'],
    description: 'Casting any Grove skill encases you in Barkskin for 5s: a shield worth 14% of maximum health and healing of 0.75% maximum health every 0.5s (x Grove healing).' }),
  n('w_grove_wrath', 'grove', 'Wrath of the Grove', 1, 3, { prereqs: [{ node: 'w_entangle', rank: 1 }], mechanics: ['w_grove_wrath'],
    description: 'Enemies rooted by you take x1.2 damage from every source while rooted (a stronger vulnerability is kept).' }),
  n('w_forest_heart', 'grove', 'Heart of the Forest', 1, 4, { excludes: choice('w_worldtree_grasp'), modifiers: [{ stat: 'player.natureHealing', factorPerRank: '1.5' }], mechanics: ['w_forest_heart'],
    description: 'Keystone (choice): Heart of the Forest. Grove healing x1.5. Your root patches heal allies standing in them for 1% of maximum health every pulse (x Grove healing), Verdant Totem heals within 6 units instead of 4, and Barkskin also shields allies within 4 units of you.' }),
  n('w_worldtree_grasp', 'grove', "Worldtree's Grasp", 1, 4, { excludes: choice('w_forest_heart'), modifiers: [{ stat: 'player.rootDuration', factorPerRank: '1.4' }], mechanics: ['w_bloodroot'],
    description: "Keystone (choice): Worldtree's Grasp. Root duration x1.4 and Entangle (or its evolution) holds 2 charges. When one of your roots ends, the enemy suffers Bloodroot: 0.9x physical damage per second it was rooted (up to 3 seconds counted)." }),

  // ---- Warden / Beast ----
  n('w_call_pack', 'beast', 'Call of the Pack', 1, 0, { starting: true, grantsSkill: 'w_call_pack', mechanics: ['w_wolves'],
    description: 'Equip Call of the Pack: howl to summon spirit wolves until you lead 3 (18s each); every wolf leaps at the enemy nearest your aim for 1.2x physical damage. Wolves hunt within 9 units of you, bite every 0.9s for 0.45x physical, pounce on enemies 1.6 to 4.5 units away for 0.9x (every 4s each) and follow you when idle. They cannot be harmed.' }),
  n('w_feral_might', 'beast', 'Feral Might', 3, 1, { modifiers: [{ stat: 'player.beastDamage', factorPerRank: '1.12' }],
    description: 'Spirit beast damage x1.12 per rank (wolves, the Ursa, Wild Hunt and the Feral Shift maul).' }),
  n('w_hunters_rhythm', 'beast', "Hunter's Rhythm", 3, 1, { modifiers: [{ stat: 'player.attackFrequency', factorPerRank: '1.06' }], description: 'Attack frequency x1.06 per rank.' }),
  n('w_bloodied_fangs', 'beast', 'Bloodied Fangs', 2, 1, { prereqs: [{ node: 'w_call_pack', rank: 1 }], mechanics: ['w_bleed'],
    description: 'Wolf bites and pounces make enemies bleed: 12% of the hit per second per rank, for 3s (physical).' }),
  n('w_long_hunt', 'beast', 'Long Hunt', 2, 1, { prereqs: [{ node: 'w_call_pack', rank: 1 }], mechanics: ['w_long_hunt'],
    description: 'Wolves and the Ursa stay x1.25 longer and run x1.1 faster per rank.' }),
  n('w_dire_wolves', 'beast', 'Dire Wolves', 1, 2, { prereqs: [{ node: 'w_call_pack', rank: 1 }], excludes: choice('w_endless_pack'), mechanics: ['w_dire'],
    description: 'Choice. Your pack is limited to 2 dire wolves: their bites and pounces deal x2.2 damage and pounces knock enemies back 0.8 units.' }),
  n('w_endless_pack', 'beast', 'Endless Pack', 1, 2, { prereqs: [{ node: 'w_call_pack', rank: 1 }], excludes: choice('w_dire_wolves'), mechanics: ['w_endless'],
    description: 'Choice. Your pack holds up to 5 wolves that last 25s, but their bites and pounces deal x0.75 damage.' }),
  n('w_ursine_call', 'beast', 'Spirit of the Ursa', 1, 2, { prereqs: [{ node: 'w_call_pack', rank: 1 }], grantsSkill: 'w_ursine_call', excludes: choice('w_alpha_pounce'), mechanics: ['w_ursa'],
    description: 'Evolves Call of the Pack (choice). Spirit of the Ursa: calls the pack and a Great Spirit Bear crashes down up to 6 units away: 2.6x physical damage in a 2.6 radius, 1.5 unit knockback, 120 boss stagger. The Ursa fights for 10s, swiping the enemy nearest it every 1.4s for 1.4x physical (1.8 range, 120 degrees).' }),
  n('w_alpha_pounce', 'beast', 'Alpha Pounce', 1, 2, { prereqs: [{ node: 'w_call_pack', rank: 1 }], grantsSkill: 'w_alpha_pounce', excludes: choice('w_ursine_call'), mechanics: ['w_leap'],
    description: 'Evolves Call of the Pack (choice). Alpha Pounce: leap up to 6 units along your aim in 0.3s (invulnerable while airborne), landing with a 2.2 radius slam for 1.8x physical damage and a 1s root, then call the pack: every wolf leaps at the enemy nearest your landing.' }),
  n('w_spirit_bond', 'beast', 'Spirit Bond', 1, 3, { mechanics: ['w_spirit_bond'],
    description: 'Heal for 4% of spirit beast damage; each enemy they kill cuts 0.3s from all skill cooldowns.' }),
  n('w_pack_frenzy', 'beast', 'Pack Frenzy', 1, 3, { prereqs: [{ node: 'w_call_pack', rank: 1 }], mechanics: ['w_frenzy'],
    description: 'When a spirit beast kills an enemy, your beasts frenzy for 4s: they attack x1.6 as often and run x1.3 faster.' }),
  n('w_alpha_wild', 'beast', 'Alpha of the Wild', 1, 4, { excludes: choice('w_feral_shift'), mechanics: ['w_alpha_mark'],
    description: 'Keystone (choice): Alpha of the Wild. Your pack holds one more wolf. Thornspear marks the first enemy it hits for 4s: your beasts always hunt the mark and deal x1.5 damage to it, and every 4th Thornspear attack sends every wolf leaping at it (0.9x pounce, ignoring pounce cooldowns).' }),
  n('w_feral_shift', 'beast', 'Feral Shift', 1, 4, { excludes: choice('w_alpha_wild'),
    modifiers: [{ stat: 'player.maxHealth', factorPerRank: '1.25' }, { stat: 'player.armor', factorPerRank: '1.3' }], mechanics: ['w_feral'],
    description: 'Keystone (choice): Feral Shift. You fight as a werebear: maximum health x1.25 and armor x1.3. Thornspear becomes Maul: a 2.3 range, 150 degree swipe for 1.7x physical damage (x Spirit beast damage, no thorn shard). Your pack is limited to 1 wolf.' }),

  // ---- Warden / Thorns ----
  n('w_thornburst', 'thorns', 'Thornburst', 1, 0, { starting: true, grantsSkill: 'w_thornburst', mechanics: ['w_venom', 'w_thorn_armor'],
    description: 'Equip Thornburst: a 2.8 radius thorn nova for 1.7x physical damage plus Venom (25% of the hit as decay damage per second for 4s). Grants Thorn Armor for 4s: enemies that damage you with a direct attack are lashed for 0.8x physical damage plus 50% of the damage you took (x Thorns damage).' }),
  n('w_barbed', 'thorns', 'Barbed', 3, 1, { modifiers: [{ stat: 'player.thornsDamage', factorPerRank: '1.15' }],
    description: 'Thorns damage x1.15 per rank: Thorn Armor lashes, Thornburst and its evolutions, Bramble Wall, Ironthorn Pod and thorn shards.' }),
  n('w_virulence', 'thorns', 'Virulence', 3, 1, { modifiers: [{ stat: 'player.decayDamage', factorPerRank: '1.1' }], description: 'Decay damage (Venom) x1.1 per rank.' }),
  n('w_sharpened_thorns', 'thorns', 'Sharpened Thorns', 2, 1, { prereqs: [{ node: 'w_thornburst', rank: 1 }], modifiers: [{ stat: 'skill.w_thornburst.damage', factorPerRank: '1.12' }],
    description: "Thornburst damage x1.12 per rank; also applies to Bramble Wall's eruption and Ironthorn Pod's detonation." }),
  n('w_toxic_barbs', 'thorns', 'Toxic Barbs', 1, 1, { mechanics: ['w_toxic_barbs'],
    description: "Thorn shards (Thornspear and Ironthorn Pod) apply Venom: 25% of the shard's damage per second for 4s." }),
  n('w_contagion', 'thorns', 'Contagion', 1, 2, { excludes: choice('w_venom_bloom'), mechanics: ['w_contagion'],
    description: 'Choice. When an enemy carrying your Venom dies, its Venom leaps to the 3 nearest enemies within 3.5 units at full strength for 4s.' }),
  n('w_venom_bloom', 'thorns', 'Venom Bloom', 1, 2, { excludes: choice('w_contagion'), mechanics: ['w_venom_bloom'],
    description: 'Choice. When an enemy carrying your Venom dies, it bursts in a 2 radius for 1.4x physical damage (x Thorns damage). Bursts never trigger further bursts.' }),
  n('w_bramble_wall', 'thorns', 'Bramble Wall', 1, 2, { prereqs: [{ node: 'w_thornburst', rank: 1 }], grantsSkill: 'w_bramble_wall', excludes: choice('w_thorn_pod'), mechanics: ['w_bramble'],
    description: 'Evolves Thornburst (choice). Bramble Wall: erupt as Thornburst (nova, Venom, Thorn Armor), then raise a 7 unit bramble wall 2.5 units ahead, across your aim, for 6s. Enemies touching it take 0.6x physical damage every 0.5s, gain Venom and are rooted for 0.75s.' }),
  n('w_thorn_pod', 'thorns', 'Ironthorn Pod', 1, 2, { prereqs: [{ node: 'w_thornburst', rank: 1 }], grantsSkill: 'w_thorn_pod', excludes: choice('w_bramble_wall'), mechanics: ['w_pod'],
    description: 'Evolves Thornburst (choice). Ironthorn Pod: hurl a pod up to 7 units that detonates after 0.7s: 2.6x physical damage with Venom in a 3.2 radius and 8 thorn shards flung outward (0.45x each, range 5). Casting grants Thorn Armor for 4s.' }),
  n('w_bramblehide', 'thorns', 'Bramblehide', 1, 3, { prereqs: [{ node: 'w_thornburst', rank: 1 }], mechanics: ['w_bramblehide'],
    description: 'Thorn Armor is always active at half strength; dodging restores full strength for 3s.' }),
  n('w_festering', 'thorns', 'Festering Wounds', 1, 3, { mechanics: ['w_festering'],
    description: 'Thorns damage against enemies carrying your Venom x1.3, and Venom from Thornburst and its evolutions lasts 6s instead of 4s.' }),
  n('w_heart_of_thorns', 'thorns', 'Heart of Thorns', 1, 4, { excludes: choice('w_creeping_venom'), modifiers: [{ stat: 'player.maxHealth', factorPerRank: '1.15' }], mechanics: ['w_heart_of_thorns'],
    description: 'Keystone (choice): Heart of Thorns. Maximum health x1.15. Thorn Armor lashes deal x2 damage, and each lash also bursts thorns around you for 0.8x physical damage in a 1.8 radius (x Thorns damage, at most once per 0.5s).' }),
  n('w_creeping_venom', 'thorns', 'Creeping Venom', 1, 4, { excludes: choice('w_heart_of_thorns'), modifiers: [{ stat: 'player.decayDamage', factorPerRank: '1.6' }], mechanics: ['w_creeping_venom'],
    description: 'Keystone (choice): Creeping Venom. Decay damage x1.6 and Thornspear hits apply Venom (20% of the hit per second for 4s). Every second, each enemy carrying your Venom infects the nearest enemy within 2.5 units that has none (same strength, 4s).' }),
];

export const CLASS: ClassDef = {
  id: 'warden', name: 'Warden', tagline: 'Roots, fangs and thorns. The wild answers when you call.',
  branches: [
    { id: 'grove', name: 'Grove', theme: 'Entangling roots, healing blooms and barkskin' },
    { id: 'beast', name: 'Beast', theme: 'A spirit-wolf pack, the Ursa and pounces' },
    { id: 'thorns', name: 'Thorns', theme: 'Reflected pain, bramble walls and spreading Venom' },
  ],
  accent: '#6b8f3a', role: 'Summoner bruiser · nature guardian',
  base: { maxHealth: 1050, armor: 22, damage: 88, attackFrequency: 1.7, moveSpeed: 4.6, critTendency: '0.25', critMultiplier: '2', shieldCapacity: 0.6 },
  melee: true, basicSkill: 'w_thornspear', signatureSkill: 'w_wild_hunt',
  nodes: NODES.map((x) => x.id),
};
