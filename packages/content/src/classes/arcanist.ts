import type { ClassDef, NodeDef, SkillDef } from '../types';
import { node } from './common';

// Arcanist: ember, storm and rift. Spark, Astral Nova, Phase Step and the inline reactions (Inferno, Ash Recovery)
// live in simulation players.ts/combat.ts; Fireline/Arc Bolt, the evolved skills and the deeper tree are in
// packages/simulation/src/classes/arcanist.ts.

const n = (id: string, branch: string, name: string, rankLimit: number, tier: NodeDef['tier'], opts: Parameters<typeof node>[6]) => node(id, 'arcanist', branch, name, rankLimit, tier, opts);

export const SKILLS: SkillDef[] = [
  // ---------------- Arcanist ----------------
  { id: 'a_spark', classId: 'arcanist', name: 'Spark', slot: 'basic', damageType: 'ember', damageCoef: '1', resourceCost: 0, cooldownSec: 0, charges: 1,
    shape: { kind: 'projectile', speed: 11, radius: 0.25, range: 9, pierce: 0, spreadDeg: 14 },
    dot: { type: 'ember', fractionPerSec: '0.2', durationSec: 3 }, description: 'Basic ember bolt that sets targets burning.', compressionSupport: true, icon: 'node:a_spark' },
  { id: 'a_astral_nova', classId: 'arcanist', name: 'Astral Nova', slot: 'signature', damageType: 'astral', damageCoef: '3.5', resourceCost: 35, cooldownSec: 12, charges: 1,
    shape: { kind: 'circle', radius: 3, selfCentered: true, range: 0 }, knockback: 1.1,
    description: 'Detonate a burst of starlight around you. Builds boss stagger.', compressionSupport: true, icon: 'node:a_astral_nova' },
  { id: 'a_fireline', classId: 'arcanist', name: 'Fireline', slot: 'active', damageType: 'ember', damageCoef: '0.6', resourceCost: 25, cooldownSec: 6, charges: 1,
    shape: { kind: 'line', length: 6, width: 1.1, duration: 3, tickInterval: 0.5 },
    dot: { type: 'ember', fractionPerSec: '0.25', durationSec: 3 }, description: 'A directional line of ground flame that burns enemies inside it.', compressionSupport: true, icon: 'node:a_fireline' },
  { id: 'a_arc_bolt', classId: 'arcanist', name: 'Arc Bolt', slot: 'active', damageType: 'storm', damageCoef: '1.8', resourceCost: 20, cooldownSec: 3, charges: 1,
    shape: { kind: 'chain', range: 7, jumpRange: 4, jumps: 3 }, description: 'Lightning that chains between enemies (source-indexed hit list: no target is hit twice per cast).', compressionSupport: true, icon: 'node:a_arc_bolt' },
  { id: 'a_tempest_field', classId: 'arcanist', name: 'Tempest Field', slot: 'active', damageType: 'storm', damageCoef: '0.5', resourceCost: 10, cooldownSec: 0, charges: 1,
    shape: { kind: 'line', length: 0, width: 2, duration: 3, tickInterval: 0.5 }, description: 'Storm field built by repeated storm casts.', compressionSupport: true, icon: 'node:a_tempest' },
  { id: 'a_phase_step', classId: 'arcanist', name: 'Phase Step', slot: 'active', damageType: 'astral', damageCoef: '0', resourceCost: 15, cooldownSec: 4, charges: 1,
    shape: { kind: 'teleport', range: 5 }, description: 'Teleport to aimed valid ground up to 5 units away.', compressionSupport: true, icon: 'node:a_phase_step' },
  { id: 'a_event_horizon_field', classId: 'arcanist', name: 'Event Horizon', slot: 'active', damageType: 'astral', damageCoef: '0.4', resourceCost: 15, cooldownSec: 0, charges: 1,
    shape: { kind: 'aura', radius: 3, duration: 2 }, description: 'Pull field created on Phase Step arrival.', compressionSupport: true, icon: 'node:a_event_horizon' },
  // ---- evolved skills ----
  { id: 'a_meteor', classId: 'arcanist', name: 'Meteor', slot: 'active', damageType: 'ember', damageCoef: '3.5', resourceCost: 30, cooldownSec: 8, charges: 1,
    shape: { kind: 'circle', radius: 2.4, selfCentered: false, range: 8 }, knockback: 1.5, dot: { type: 'ember', fractionPerSec: '0.25', durationSec: 3 },
    description: 'Call down a meteor up to 8 units away. It lands 0.7s later for 3.5x ember damage in a 2.4 radius, knocks enemies back 1.5 (140 boss stagger) and leaves the crater burning for 3s (0.4x ember damage every 0.5s).', compressionSupport: true, icon: 'node:a_meteor' },
  { id: 'a_flame_wall', classId: 'arcanist', name: 'Flame Wall', slot: 'active', damageType: 'ember', damageCoef: '0.7', resourceCost: 25, cooldownSec: 7, charges: 1,
    shape: { kind: 'line', length: 6, width: 1.2, duration: 5, tickInterval: 0.4 }, dot: { type: 'ember', fractionPerSec: '0.25', durationSec: 3 },
    description: 'Raise a 6 unit wall of fire across the aimed point (up to 6 units away) for 5s. Every 0.4s enemies in it take 0.7x ember damage, start burning and are shoved 0.35 units back from the flames.', compressionSupport: true, icon: 'node:a_flame_wall' },
  { id: 'a_overload', classId: 'arcanist', name: 'Overload', slot: 'active', damageType: 'storm', damageCoef: '2', resourceCost: 25, cooldownSec: 4, charges: 1,
    shape: { kind: 'chain', range: 7, jumpRange: 4, jumps: 4 },
    description: 'A heavier bolt that chains through 5 enemies for 2x storm damage. The last enemy struck overloads: a 1.5x storm burst in a 2.5 radius that knocks enemies back 1.2 (60 boss stagger).', compressionSupport: true, icon: 'node:a_overload' },
  { id: 'a_ball_lightning', classId: 'arcanist', name: 'Ball Lightning', slot: 'active', damageType: 'storm', damageCoef: '0.4', resourceCost: 25, cooldownSec: 6, charges: 1,
    shape: { kind: 'projectile', speed: 3.5, radius: 3, range: 9, pierce: 99, spreadDeg: 0 },
    description: 'Release a crackling orb that drifts 9 units forward over 2.6s, zapping up to 3 enemies within 3 units every 0.25s for 0.4x storm damage.', compressionSupport: true, icon: 'node:a_ball_lightning' },
  { id: 'a_blink_strike', classId: 'arcanist', name: 'Blink Strike', slot: 'active', damageType: 'astral', damageCoef: '1.4', resourceCost: 18, cooldownSec: 4, charges: 1,
    shape: { kind: 'teleport', range: 6 },
    description: 'Teleport up to 6 units, detonating astral bursts where you vanish and where you appear: 1.4x astral damage in a 2 unit radius and a 1 unit knockback (40 boss stagger).', compressionSupport: true, icon: 'node:a_blink_strike' },
  { id: 'a_rift_gate', classId: 'arcanist', name: 'Rift Gate', slot: 'active', damageType: 'astral', damageCoef: '0.3', resourceCost: 20, cooldownSec: 8, charges: 1,
    shape: { kind: 'teleport', range: 8 },
    description: 'Tear open two linked rift gates for 8s, one at your feet and one up to 8 units away (walls do not block it), and step through. Any ally entering a gate emerges from the other. Gates sear and pull enemies within 1.5 units (0.3x astral every 0.5s).', compressionSupport: true, icon: 'node:a_rift_gate' },
];

export const NODES: NodeDef[] = [
  // ---- Arcanist / Ember ----
  n('a_spark', 'ember', 'Spark', 1, 0, { starting: true, description: 'Fires an ember bolt that burns for 20% of its hit per second for 3s.' }),
  n('a_fireline', 'ember', 'Fireline', 1, 0, { grantsSkill: 'a_fireline', description: 'Casts a 6-unit line of ground fire that burns enemies inside for 3s.' }),
  n('a_kindling', 'ember', 'Kindling', 3, 1, { modifiers: [{ stat: 'player.burnRate', factorPerRank: '1.1' }], description: 'Raises burn damage ×{value} per rank.' }),
  n('a_heat_sink', 'ember', 'Heat Sink', 2, 1, { modifiers: [{ stat: 'player.emberCost', factorPerRank: '0.95' }], description: 'Ember resource cost x0.95 per rank.' }),
  n('a_ash_recovery', 'ember', 'Ash Recovery', 1, 2, { mechanics: ['ash_recovery'], description: 'Killing a burning objective enemy restores 8 Mana.' }),
  n('a_meteor', 'ember', 'Meteor', 1, 2, { prereqs: [{ node: 'a_fireline', rank: 1 }], grantsSkill: 'a_meteor', excludes: ['a_flame_wall'],
    description: 'Calls a meteor for 3.5× ember in radius 2.4 that leaves the crater burning.' }),
  n('a_flame_wall', 'ember', 'Flame Wall', 1, 2, { prereqs: [{ node: 'a_fireline', rank: 1 }], grantsSkill: 'a_flame_wall', excludes: ['a_meteor'],
    description: 'Raises a 5s wall of fire that burns and shoves back enemies who touch it.' }),
  n('a_inferno', 'ember', 'Inferno', 1, 3, { prereqs: [{ node: 'a_fireline', rank: 1 }], mechanics: ['inferno'], description: 'Spreads 20% of your direct ember damage as a burn in radius 1.5 around the target.' }),
  n('a_combustion', 'ember', 'Combustion', 1, 3, { mechanics: ['combustion'],
    description: 'Makes burning enemies explode on death for 1× ember in radius 2, igniting others.' }),
  n('a_pyroclasm', 'ember', 'Pyroclasm', 1, 4, { excludes: ['a_conflagration', 'a_singularity'], mechanics: ['pyroclasm'],
    upgrades: 'a_astral_nova', description: 'Upgrades Astral Nova: deals ×1.3 as ember, ignites, and hurls 8 Sparks.' }),
  n('a_conflagration', 'ember', 'Conflagration', 1, 4, { excludes: ['a_pyroclasm'], modifiers: [{ stat: 'player.burnRate', factorPerRank: '1.5' }], mechanics: ['conflagration'],
    description: 'Strengthens burns ×{value}; Spark pierces +1; burning enemies take ×1.12 damage.' }),
  // ---- Arcanist / Storm ----
  n('a_arc_bolt', 'storm', 'Arc Bolt', 1, 0, { grantsSkill: 'a_arc_bolt', description: 'Casts chain lightning that jumps to 3 more enemies.' }),
  n('a_conductivity', 'storm', 'Conductivity', 3, 1, { modifiers: [{ stat: 'player.stormDamage', factorPerRank: '1.1' }], description: 'Raises storm damage ×{value} per rank.' }),
  n('a_charged_reserve', 'storm', 'Charged Reserve', 2, 1, { modifiers: [{ stat: 'player.maxResource', factorPerRank: '1.1' }], description: 'Maximum Mana x1.1 per rank.' }),
  n('a_static_shell', 'storm', 'Static Shell', 1, 1, { mechanics: ['static_shell'], description: 'Grants a shield of 8% max health for 3s whenever you cast a storm skill.' }),
  n('a_fork', 'storm', 'Fork', 1, 2, { prereqs: [{ node: 'a_arc_bolt', rank: 1 }], mechanics: ['fork'], upgrades: 'a_arc_bolt', description: 'Upgrades Arc Bolt: +1 chain target, Overload too.' }),
  n('a_overload', 'storm', 'Overload', 1, 2, { prereqs: [{ node: 'a_arc_bolt', rank: 1 }], grantsSkill: 'a_overload', excludes: ['a_ball_lightning'],
    description: 'Fires a 2× chain through 5 enemies; the last one bursts for 1.5× storm.' }),
  n('a_ball_lightning', 'storm', 'Ball Lightning', 1, 2, { prereqs: [{ node: 'a_arc_bolt', rank: 1 }], grantsSkill: 'a_ball_lightning', excludes: ['a_overload'],
    description: 'Releases a drifting orb that zaps 3 nearby enemies for 0.4× every 0.25s.' }),
  n('a_tempest', 'storm', 'Tempest', 1, 3, { prereqs: [{ node: 'a_fork', rank: 1 }], mechanics: ['tempest'], description: 'Every third storm cast within 4s builds a storm field (10 Mana) dealing storm damage for 3s.' }),
  n('a_thunderstrike', 'storm', 'Thunderstrike', 1, 3, { mechanics: ['thunderstrike'],
    description: 'Makes storm crits call a thunderbolt for 1× storm in radius 1.5.' }),
  n('a_stormcaller', 'storm', 'Stormcaller', 1, 4, { excludes: ['a_attunement'], mechanics: ['stormcaller'],
    description: 'Calls lightning on a random enemy within 7 units every 1.2s for 1× storm.' }),
  n('a_attunement', 'storm', 'Elemental Attunement', 1, 4, { excludes: ['a_stormcaller'], mechanics: ['attunement'],
    description: 'Makes each storm cast power your next ember cast ×1.6, and vice versa with +2 chains.' }),
  // ---- Arcanist / Rift ----
  n('a_phase_step', 'rift', 'Phase Step', 1, 0, { grantsSkill: 'a_phase_step', description: 'Teleports you to aimed ground up to 5 units away.' }),
  n('a_rift_focus', 'rift', 'Rift Focus', 3, 1, { modifiers: [{ stat: 'player.astralDamage', factorPerRank: '1.1' }], description: 'Raises astral damage ×{value} per rank.' }),
  n('a_quickening', 'rift', 'Quickening', 2, 1, { modifiers: [{ stat: 'player.recoveryRate', factorPerRank: '1.1' }], description: 'Speeds cooldown recovery ×{value} per rank.' }),
  n('a_temporal_reserve', 'rift', 'Temporal Reserve', 1, 1, { prereqs: [{ node: 'a_phase_step', rank: 1 }], mechanics: ['phase_charge'], upgrades: 'a_phase_step', description: 'Upgrades Phase Step: +1 charge, evolutions too.' }),
  n('a_return_mark', 'rift', 'Return Mark', 1, 2, { prereqs: [{ node: 'a_phase_step', rank: 1 }], mechanics: ['return_mark'], upgrades: 'a_phase_step', description: 'Upgrades Phase Step: recast within 4s to snap back to where you started.' }),
  n('a_blink_strike', 'rift', 'Blink Strike', 1, 2, { prereqs: [{ node: 'a_phase_step', rank: 1 }], grantsSkill: 'a_blink_strike', excludes: ['a_rift_gate'],
    description: 'Teleports up to 6 units with a 1.4× astral burst at both ends.' }),
  n('a_rift_gate', 'rift', 'Rift Gate', 1, 2, { prereqs: [{ node: 'a_phase_step', rank: 1 }], grantsSkill: 'a_rift_gate', excludes: ['a_blink_strike'],
    description: 'Opens two linked gates up to 8 units apart for 8s that any ally can walk through.' }),
  n('a_event_horizon', 'rift', 'Event Horizon', 1, 3, { prereqs: [{ node: 'a_return_mark', rank: 1 }], mechanics: ['event_horizon'], description: 'Phase Step, Blink Strike and Rift Gate arrival creates a pull field (15 Mana) that drags enemies inward and deals astral damage.' }),
  n('a_astral_echo', 'rift', 'Astral Echo', 1, 3, { prereqs: [{ node: 'a_phase_step', rank: 1 }], mechanics: ['astral_echo'],
    upgrades: 'a_phase_step', description: 'Upgrades Phase Step: leaves an echo that bursts for 1.5× astral after 0.75s.' }),
  n('a_riftwalker', 'rift', 'Riftwalker', 1, 4, { excludes: ['a_singularity'], mechanics: ['riftwalker'],
    upgrades: 'a_phase_step', description: 'Upgrades Phase Step: +2 charges, and each arrival fires 6 astral shards (0.6× each).' }),
  n('a_singularity', 'rift', 'Singularity', 1, 4, { excludes: ['a_riftwalker', 'a_pyroclasm'], mechanics: ['singularity'],
    upgrades: 'a_astral_nova', description: 'Upgrades Astral Nova: becomes a ranged black hole that pulls, then bursts for 3.5×.' }),
];

export const CLASS: ClassDef = {
    id: 'arcanist', name: 'Arcanist', tagline: 'Ember, storm and rift. Trades resource pressure for projectile power.',
    branches: [
      { id: 'ember', name: 'Ember', theme: 'Burns, meteors and walls of flame' },
      { id: 'storm', name: 'Storm', theme: 'Chain lightning, overloads and static shields' },
      { id: 'rift', name: 'Rift', theme: 'Blinks, gates and astral gravity' },
    ],
    accent: '#8a7aff', role: 'Ranged caster · elemental',
    resource: { name: 'Mana', max: 120, regenPerSec: 12 },
    base: { maxHealth: 750, armor: 10, damage: 72, attackFrequency: 2.4, moveSpeed: 4.6, critTendency: '0.25', critMultiplier: '2', shieldCapacity: 0.6 },
    basicSkill: 'a_spark', signatureSkill: 'a_astral_nova',
    nodes: NODES.map((x) => x.id),
  };
