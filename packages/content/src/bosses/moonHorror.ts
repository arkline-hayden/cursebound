import type { BossDef, EnemyDef } from '../types';

// THE CRATER HORROR: the boss of the dead moon ('moon'). Its behaviour lives in simulation bosses/moonHorror.ts (a
// scripted boss); the numbers live here. Its kit attacks are 'scripted'; the maw lash is the shared close cone.

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
  adds: ['craterspawn'],
  loot: ['lg_eye_of_the_dead_moon', 'lg_carapace_of_the_brood_moon'],
  phases: [
    { healthFrac: 1.0, weight: 1, patterns: [['tentacles', 'lash'], ['gravwell', 'tentacles'], ['lowgrav', 'voidbeam'], ['tentacles', 'lash']], cadence: '1.15' },
    { healthFrac: 0.5, weight: 1, patterns: [['voidbeam', 'tentacles'], ['gravwell', 'lash', 'tentacles'], ['lowgrav', 'voidbeam', 'brood'], ['tentacles', 'gravwell', 'voidbeam']], cadence: '0.95' },
  ],
  attacks: [
    // projectileCount: tentacles per eruption (+1 per hero); duration: seconds a tentacle lingers as a swaying lantern
    { id: 'tentacles', name: 'Tentacle Eruption', kind: 'scripted', damageType: 'physical', damageCoef: '1.15', windupSec: 1.15, releaseSec: 0.2, recoverySec: 0.6, cooldownSec: 0, range: 12, projectileCount: 4, duration: 4.5, telegraph: { kind: 'circle', radius: 1.0 } },
    { id: 'gravwell', name: 'Gravity Well', kind: 'scripted', damageType: 'astral', damageCoef: '0.5', windupSec: 1.0, releaseSec: 0.1, recoverySec: 0.8, cooldownSec: 0, range: 10, duration: 3.0, telegraph: { kind: 'circle', radius: 4.2 } },
    { id: 'voidbeam', name: 'Void Beam', kind: 'scripted', damageType: 'astral', damageCoef: '1.1', windupSec: 1.25, releaseSec: 2.2, recoverySec: 0.8, cooldownSec: 0, range: 12, telegraph: { kind: 'cone', range: 12, arcDeg: 110 } },
    { id: 'lowgrav', name: 'Low Gravity', kind: 'scripted', damageType: 'astral', damageCoef: '0', windupSec: 0.9, releaseSec: 0.1, recoverySec: 0.5, cooldownSec: 0, range: 10, projectileCount: 3, duration: 6, inflict: { status: 'slowed', sec: 0.5, value: 0.45 }, telegraph: { kind: 'circle', radius: 2.2 } },
    { id: 'lash', name: 'Maw Lash', kind: 'sweep', damageType: 'physical', damageCoef: '1.2', windupSec: 0.8, releaseSec: 0.15, recoverySec: 0.7, cooldownSec: 0, range: 3.8, telegraph: { kind: 'cone', range: 3.8, arcDeg: 150 } },
    { id: 'brood', name: 'Spawn the Brood', kind: 'scripted', damageType: 'physical', damageCoef: '0', windupSec: 1.0, releaseSec: 0.1, recoverySec: 0.6, cooldownSec: 0, range: 12, summonCount: 2, telegraph: { kind: 'circle', radius: 1.4 } },
  ],
};

/** The Crater Horror's brood (BossDef.adds, and its Spawn the Brood attack). */
export const MOON_HORROR_ADDS: EnemyDef[] = [
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
