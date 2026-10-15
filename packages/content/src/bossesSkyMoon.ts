import type { BossDef, EnemyDef } from './types';

// Theme bosses of the open-air floors (enemies.ts THEME_BOSSES): the Gale Wyrm rules the sky island, the Crater Horror
// the dead moon. Their behaviour lives in simulation/src/bosses/skydrake.ts and moonhorror.ts (boss kits); the numbers
// live here. Tuned beside the Hollow Stag and the Bell Golem (rules 1.3 retune: ~20% easier than the first drafts).

/**
 * The Gale Wyrm (sky). Phase 1: telegraphed strafing dives across the ring, a gale cone that shoves heroes toward the
 * brink (a hero blown off the island takes fall damage and is set back on solid rock, see SKY_FALL), and a talon
 * rake up close. Phase 2 (50%): it takes to the sky out of reach (immune), circles the ring
 * raining telegraphed lightning feathers, then stoops onto a marked spot and lands winded (staggered, vulnerable).
 */
export const SKY_DRAKE: BossDef = {
  id: 'skydrake', name: 'The Gale Wyrm', title: 'Sovereign of the Shattered Sky',
  description: 'Strafes the ring in marked dives and breathes a gale that shoves heroes toward the brink. Below half health it circles out of reach, rains lightning feathers, then stoops to land, winded.',
  refUnitHealth: 1300, bossFactor: 8, baseDamage: 54, armor: 35, radius: 1.4, moveSpeed: 2.4, tags: ['boss', 'flying'],
  vulnerableMultiplier: '1.6', staggerMeter: 650,
  phases: [
    { healthFrac: 1.0, weight: 1, patterns: [['dive', 'talon'], ['gale', 'talon'], ['dive', 'gale']], cadence: '1.15' },
    { healthFrac: 0.5, weight: 1, patterns: [['soar'], ['dive', 'gale', 'dive'], ['feathers', 'talon'], ['soar'], ['gale', 'dive', 'feathers']], cadence: '0.95' },
  ],
  attacks: [
    { id: 'dive', name: 'Strafing Dive', kind: 'dive', damageType: 'physical', damageCoef: '1.4', windupSec: 1.1, releaseSec: 0.7, recoverySec: 0.75, cooldownSec: 0, range: 14, telegraph: { kind: 'line', length: 14, width: 2.2 } },
    { id: 'gale', name: 'Gale Breath', kind: 'gale', damageType: 'storm', damageCoef: '0.5', windupSec: 1.0, releaseSec: 1.5, recoverySec: 0.6, cooldownSec: 0, range: 7.5, telegraph: { kind: 'cone', range: 7.5, arcDeg: 70 } },
    { id: 'talon', name: 'Talon Rake', kind: 'sweep', damageType: 'physical', damageCoef: '1.25', windupSec: 0.75, releaseSec: 0.15, recoverySec: 0.7, cooldownSec: 0, range: 3.0, telegraph: { kind: 'cone', range: 3.0, arcDeg: 130 } },
    { id: 'feathers', name: 'Lightning Feathers', kind: 'feathers', damageType: 'storm', damageCoef: '0.85', windupSec: 0.95, releaseSec: 0.1, recoverySec: 0.5, cooldownSec: 0, range: 12, projectileCount: 5, telegraph: { kind: 'circle', radius: 1.1 } },
    // releaseSec: seconds aloft; duration: seconds between feather volleys; projectileCount: strikes per volley (+1 per hero)
    { id: 'soar', name: 'Storm Circling', kind: 'soar', damageType: 'physical', damageCoef: '1.5', windupSec: 0.9, releaseSec: 6.5, recoverySec: 1.3, cooldownSec: 0, range: 12, projectileCount: 3, duration: 1.4, telegraph: { kind: 'circle', radius: 2.4 } },
  ],
};

/** The long fall (gale push into a chasm): damage as a fraction of maximum health, then back on solid rock (no chasm
 *  within safeRadius tiles) with brief invulnerability. Never an instant death: it can down a wounded hero, who then
 *  lies on safe ground to be revived. pushSpeed: the gale's shove (world units / s, just under a hero's walk); grip:
 *  world units of shove a hero pinned against the brink withstands before going over (about a tenth of a second). */
export const SKY_FALL = { healthFrac: '0.25', iframes: 1.2, safeRadius: 2, pushSpeed: 3.0, grip: 0.3 };

/**
 * The Crater Horror (moon). Rises from the crater at the heart of the basin and stays rooted in it: tentacles burst
 * from marked ground (and linger as swaying lanterns), a gravity well drags heroes toward its core, a void beam sweeps
 * an arc of the basin and low-gravity zones slow every step. Phase 2 (50%): the basin goes dark except near the eye
 * and the tentacle lanterns (presentation), and it spawns crawling brood.
 */
export const MOON_HORROR: BossDef = {
  id: 'moonhorror', name: 'The Crater Horror', title: 'Eye of the Dead Moon',
  description: 'Tentacles burst from marked ground, a gravity well drags heroes in, a void beam sweeps the basin and low gravity slows every step. Below half health it swallows the light.',
  refUnitHealth: 1550, bossFactor: 8, baseDamage: 48, armor: 50, radius: 1.8, moveSpeed: 0.5, tags: ['boss'],
  vulnerableMultiplier: '1.8', staggerMeter: 750,
  phases: [
    { healthFrac: 1.0, weight: 1, patterns: [['tentacles', 'lash'], ['gravwell', 'tentacles'], ['lowgrav', 'voidbeam'], ['tentacles', 'lash']], cadence: '1.15' },
    { healthFrac: 0.5, weight: 1, patterns: [['voidbeam', 'tentacles'], ['gravwell', 'lash', 'tentacles'], ['lowgrav', 'voidbeam', 'brood'], ['tentacles', 'gravwell', 'voidbeam']], cadence: '0.95' },
  ],
  attacks: [
    // projectileCount: tentacles per eruption (+1 per hero); duration: seconds a tentacle lingers as a swaying lantern
    { id: 'tentacles', name: 'Tentacle Eruption', kind: 'tentacle', damageType: 'physical', damageCoef: '1.15', windupSec: 1.15, releaseSec: 0.2, recoverySec: 0.6, cooldownSec: 0, range: 12, projectileCount: 4, duration: 4.5, telegraph: { kind: 'circle', radius: 1.0 } },
    { id: 'gravwell', name: 'Gravity Well', kind: 'gravwell', damageType: 'astral', damageCoef: '0.5', windupSec: 1.0, releaseSec: 0.1, recoverySec: 0.8, cooldownSec: 0, range: 10, duration: 3.0, telegraph: { kind: 'circle', radius: 4.2 } },
    { id: 'voidbeam', name: 'Void Beam', kind: 'beam', damageType: 'astral', damageCoef: '1.1', windupSec: 1.25, releaseSec: 2.2, recoverySec: 0.8, cooldownSec: 0, range: 12, telegraph: { kind: 'cone', range: 12, arcDeg: 110 } },
    { id: 'lowgrav', name: 'Low Gravity', kind: 'slowzone', damageType: 'astral', damageCoef: '0', windupSec: 0.9, releaseSec: 0.1, recoverySec: 0.5, cooldownSec: 0, range: 10, projectileCount: 3, duration: 6, inflict: { status: 'slowed', sec: 0.5, value: 0.45 }, telegraph: { kind: 'circle', radius: 2.2 } },
    { id: 'lash', name: 'Maw Lash', kind: 'sweep', damageType: 'physical', damageCoef: '1.2', windupSec: 0.8, releaseSec: 0.15, recoverySec: 0.7, cooldownSec: 0, range: 3.8, telegraph: { kind: 'cone', range: 3.8, arcDeg: 150 } },
    { id: 'brood', name: 'Spawn the Brood', kind: 'brood', damageType: 'physical', damageCoef: '0', windupSec: 1.0, releaseSec: 0.1, recoverySec: 0.6, cooldownSec: 0, range: 12, summonCount: 2, telegraph: { kind: 'circle', radius: 1.4 } },
  ],
};

/** The theme bosses' own adds (enemies.ts BOSS_ADDS): reinforcement waves at 2/3 and 1/3 health, the Horror's brood. */
export const SKY_MOON_ADDS: EnemyDef[] = [
  {
    id: 'galeharpy', name: 'Gale Harpy', role: 'skirmisher',
    description: 'A storm-feathered harpy that answers the Gale Wyrm. Strafes at range and flings quill darts.',
    baseHealth: 110, baseDamage: 15, armor: 4, cost: 2, radius: 0.38, moveSpeed: 3.2, tags: ['flying'],
    perception: { sight: 15, hearing: 10, reactionTicks: 10 }, preferredRange: [3.5, 6],
    utility: { pursue: 0.45, flank: 0.9, retreat: 0.55, cast: 1.0, reposition: 0.8 },
    attacks: [
      { id: 'quill', name: 'Quill Dart', kind: 'projectile', damageType: 'physical', damageCoef: '1', windupSec: 0.4, releaseSec: 0.05, recoverySec: 0.4, cooldownSec: 1.7, range: 7, projectileSpeed: 9, projectileCount: 1, projectileKind: 'quill', telegraph: { kind: 'line', length: 7, width: 0.25 } },
      { id: 'harpyrake', name: 'Talon Swoop', kind: 'melee', damageType: 'physical', damageCoef: '1.1', windupSec: 0.45, releaseSec: 0.1, recoverySec: 0.5, cooldownSec: 2.2, range: 1.2, telegraph: { kind: 'cone', range: 1.4, arcDeg: 80 } },
    ],
    weaknesses: { ember: '1.2' },
  },
  {
    id: 'galewisp', name: 'Wind Elemental', role: 'pursuer',
    description: 'A howling knot of living wind. Buffets heroes up close and hurls gusts that slow.',
    baseHealth: 165, baseDamage: 18, armor: 6, cost: 3, radius: 0.45, moveSpeed: 3.0, tags: ['flying'],
    perception: { sight: 14, hearing: 10, reactionTicks: 12 }, preferredRange: [0, 1.1],
    utility: { pursue: 1.0, flank: 0.4, retreat: 0.05, cast: 0.9, reposition: 0.2 },
    attacks: [
      { id: 'buffet', name: 'Buffet', kind: 'melee', damageType: 'storm', damageCoef: '1', windupSec: 0.5, releaseSec: 0.1, recoverySec: 0.55, cooldownSec: 1.2, range: 1.25, telegraph: { kind: 'cone', range: 1.5, arcDeg: 80 } },
      { id: 'gustbolt', name: 'Gust', kind: 'projectile', damageType: 'storm', damageCoef: '0.7', windupSec: 0.45, releaseSec: 0.05, recoverySec: 0.45, cooldownSec: 4.5, range: 6, projectileSpeed: 8, projectileCount: 1, projectileKind: 'gust', inflict: { status: 'slowed', sec: 1.5, value: 0.3 }, telegraph: { kind: 'line', length: 6, width: 0.4 } },
    ],
    weaknesses: { physical: '1.2' },
  },
  {
    id: 'craterspawn', name: 'Crater Spawn', role: 'pursuer',
    description: 'A many-legged moon spawn that crawls out of the Crater Horror\'s pit and swarms the nearest hero.',
    baseHealth: 120, baseDamage: 17, armor: 6, cost: 2, radius: 0.36, moveSpeed: 3.4, tags: [],
    perception: { sight: 13, hearing: 9, reactionTicks: 10 }, preferredRange: [0, 0.9],
    utility: { pursue: 1.0, flank: 0.5, retreat: 0.05, cast: 0.9, reposition: 0.15 },
    attacks: [
      { id: 'spawnbite', name: 'Mandible Snap', kind: 'melee', damageType: 'physical', damageCoef: '1', windupSec: 0.4, releaseSec: 0.08, recoverySec: 0.5, cooldownSec: 1.0, range: 1.0, telegraph: { kind: 'cone', range: 1.2, arcDeg: 75 } },
      { id: 'spawnleap', name: 'Lunar Leap', kind: 'charge', damageType: 'physical', damageCoef: '1.2', windupSec: 0.6, releaseSec: 0.3, recoverySec: 0.7, cooldownSec: 6, range: 3.5, telegraph: { kind: 'line', length: 3.5, width: 0.7 } },
    ],
    weaknesses: { ember: '1.25' },
  },
];
