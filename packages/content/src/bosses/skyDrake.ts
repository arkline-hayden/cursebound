import type { BossDef, EnemyDef } from '../types';

// THE GALE WYRM: the boss of the sky island ('sky'). Its behaviour lives in simulation bosses/skyDrake.ts (a scripted
// boss); the numbers live here. Tuned beside the Hollow Stag and the Bell Golem (rules 1.3 retune: ~20% easier than the
// first drafts). Its kit attacks are 'scripted' (resolved by its script); the talon rake is the shared close cone.

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
  adds: ['galeharpy', 'windelemental'],
  loot: ['lg_galeheart_mantle', 'lg_stormfeather_crown'],
  phases: [
    { healthFrac: 1.0, weight: 1, patterns: [['dive', 'talon'], ['gale', 'talon'], ['dive', 'gale']], cadence: '1.15' },
    { healthFrac: 0.5, weight: 1, patterns: [['soar'], ['dive', 'gale', 'dive'], ['feathers', 'talon'], ['soar'], ['gale', 'dive', 'feathers']], cadence: '0.95' },
  ],
  attacks: [
    { id: 'dive', name: 'Strafing Dive', kind: 'scripted', damageType: 'physical', damageCoef: '1.4', windupSec: 1.1, releaseSec: 0.7, recoverySec: 0.75, cooldownSec: 0, range: 14, telegraph: { kind: 'line', length: 14, width: 2.2 } },
    { id: 'gale', name: 'Gale Breath', kind: 'scripted', damageType: 'storm', damageCoef: '0.5', windupSec: 1.0, releaseSec: 1.5, recoverySec: 0.6, cooldownSec: 0, range: 7.5, telegraph: { kind: 'cone', range: 7.5, arcDeg: 70 } },
    { id: 'talon', name: 'Talon Rake', kind: 'sweep', damageType: 'physical', damageCoef: '1.25', windupSec: 0.75, releaseSec: 0.15, recoverySec: 0.7, cooldownSec: 0, range: 3.0, telegraph: { kind: 'cone', range: 3.0, arcDeg: 130 } },
    { id: 'feathers', name: 'Lightning Feathers', kind: 'scripted', damageType: 'storm', damageCoef: '0.85', windupSec: 0.95, releaseSec: 0.1, recoverySec: 0.5, cooldownSec: 0, range: 12, projectileCount: 5, telegraph: { kind: 'circle', radius: 1.1 } },
    // releaseSec: seconds aloft; duration: seconds between feather volleys; projectileCount: strikes per volley (+1 per hero)
    { id: 'soar', name: 'Storm Circling', kind: 'scripted', damageType: 'physical', damageCoef: '1.5', windupSec: 0.9, releaseSec: 6.5, recoverySec: 1.3, cooldownSec: 0, range: 12, projectileCount: 3, duration: 1.4, telegraph: { kind: 'circle', radius: 2.4 } },
  ],
};

/** The long fall (gale push into a chasm): damage as a fraction of maximum health, then back on solid rock (no chasm
 *  within safeRadius tiles) with brief invulnerability. Never an instant death: it can down a wounded hero, who then
 *  lies on safe ground to be revived. pushSpeed: the gale's shove (world units / s, just under a hero's walk); grip:
 *  world units of shove a hero pinned against the brink withstands before going over (about a tenth of a second). */
export const SKY_FALL = { healthFrac: '0.25', iframes: 1.2, safeRadius: 2, pushSpeed: 3.0, grip: 0.3 };

/** The Gale Wyrm's reinforcements (BossDef.adds: the waves at 2/3 and 1/3 health): harpies and wind elementals. */
export const SKY_DRAKE_ADDS: EnemyDef[] = [
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
    id: 'windelemental', name: 'Wind Elemental', role: 'pursuer',
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
];
