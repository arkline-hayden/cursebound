import type { BossDef, EnemyDef } from '../types';

// THE CORRUPTED CORE: the boss of the server room theme ('server'), a cursed machine mind adrift over the raised core
// platform of its data vault. Every attack is scripted (simulation bosses/corruptCore.ts); the numbers live here.
//   Laser Grid     parallel beam lanes tile the vault; one or two lanes stay dark (stand in a gap). From two thirds on
//                  a second grid crosses the first, so only the crossings of the gaps are safe. Racks block beams.
//   Firewall       two burning walls close in from opposite edges of the vault; each has one open port (walk through
//                  it, or dodge-roll through the flames).
//   Deploy         drones and, later, sentry turrets drop in on marked circles.
//   Glitch Jump    marks a spot near a hero and blinks there (the landing hits and silences), leaving a square of
//                  corrupted tiles where it was.
//   System Purge   the floor floods with a countdown; a few safe tiles light up. Anyone off them at zero is purged.
//   Mirror Split   (two thirds and below) it splits into three mirrored bodies. Only one is real: its eye tracks the
//                  hero it hunts while the echoes stare at nothing. Echoes are fragile and burst into corruption.

export const CORRUPT_CORE: BossDef = {
  id: 'corruptcore', name: 'The Corrupted Core', title: 'Kernel of the Cursed Datavault',
  description: 'Sweeps the vault with laser grids (stand in a dark lane), closes firewalls in from the edges, deploys drones and turrets, and glitch-jumps beside you leaving corrupted tiles. Below a third it purges every tile but a few safe ones. From two thirds it splits into three mirrored bodies: only the one whose eye follows you is real.',
  refUnitHealth: 1200, bossFactor: 8, baseDamage: 46, armor: 35, radius: 1.2, moveSpeed: 1.6, tags: ['boss', 'flying'],
  vulnerableMultiplier: '1.6', staggerMeter: 650,
  loot: ['lg_overclocked_kernel'],
  phases: [
    { healthFrac: 1.0, weight: 1, patterns: [['cc_lasergrid', 'cc_glitch'], ['cc_deploy', 'cc_firewall'], ['cc_glitch', 'cc_lasergrid', 'cc_firewall']], cadence: '1.15' },
    { healthFrac: 2 / 3, weight: 1, patterns: [['cc_split', 'cc_lasergrid', 'cc_firewall'], ['cc_glitch', 'cc_deploy', 'cc_lasergrid'], ['cc_firewall', 'cc_glitch']], cadence: '1.05' },
    { healthFrac: 1 / 3, weight: 1, patterns: [['cc_purge', 'cc_lasergrid'], ['cc_split', 'cc_firewall', 'cc_glitch'], ['cc_glitch', 'cc_glitch', 'cc_purge'], ['cc_deploy', 'cc_lasergrid', 'cc_firewall']], cadence: '0.9' },
  ],
  attacks: [
    { id: 'cc_lasergrid', name: 'Laser Grid', kind: 'scripted', damageType: 'storm', damageCoef: '1.0', windupSec: 1.35, releaseSec: 0.25, recoverySec: 0.8, cooldownSec: 0, range: 12, telegraph: { kind: 'line', length: 20, width: 1.6 } },
    { id: 'cc_firewall', name: 'Firewall', kind: 'scripted', damageType: 'ember', damageCoef: '0.8', windupSec: 1.1, releaseSec: 0.2, recoverySec: 0.7, cooldownSec: 0, range: 12, projectileSpeed: 2.2, telegraph: { kind: 'line', length: 20, width: 0.7 } },
    { id: 'cc_deploy', name: 'Deploy Drones', kind: 'scripted', damageType: 'physical', damageCoef: '0', windupSec: 1.0, releaseSec: 0.1, recoverySec: 0.7, cooldownSec: 0, range: 3, summonCount: 2, telegraph: { kind: 'circle', radius: 0.9 } },
    { id: 'cc_glitch', name: 'Glitch Jump', kind: 'scripted', damageType: 'astral', damageCoef: '1.15', inflict: { status: 'silenced', sec: 1.5 }, windupSec: 0.95, releaseSec: 0.15, recoverySec: 0.65, cooldownSec: 0, range: 9, duration: 7, telegraph: { kind: 'circle', radius: 1.6 } },
    { id: 'cc_purge', name: 'System Purge', kind: 'scripted', damageType: 'astral', damageCoef: '2.2', windupSec: 3.2, releaseSec: 0.3, recoverySec: 1.4, cooldownSec: 0, range: 12, projectileCount: 3, telegraph: { kind: 'circle', radius: 1.25 } },
    { id: 'cc_split', name: 'Mirror Split', kind: 'scripted', damageType: 'astral', damageCoef: '0', windupSec: 1.15, releaseSec: 0.1, recoverySec: 0.6, cooldownSec: 0, range: 5, duration: 16, telegraph: { kind: 'circle', radius: 1.4 } },
    // fired on a cadence by every body while split (not in the patterns): a fan of data bolts at the nearest hero
    { id: 'cc_mirrorbolt', name: 'Mirror Bolt', kind: 'scripted', damageType: 'storm', damageCoef: '0.35', windupSec: 0.3, releaseSec: 0.05, recoverySec: 0.2, cooldownSec: 4, range: 10, projectileSpeed: 7, projectileCount: 2, projectileKind: 'cc_bolt', telegraph: { kind: 'line', length: 10, width: 0.3 } },
  ],
  params: {
    /** laser lanes: width, every n-th lane stays dark (first grid / the crossing grid from two thirds), crossing wind-up seconds */
    laneWidth: 1.6, darkEvery: 4, darkEvery2: 3, grid2Sec: 0.95,
    /** firewall: travel speed (units/s, x Fate projectile speed), port width, flame thickness */
    wallSpeed: 2.2, wallGap: 2.4, wallThick: 0.8,
    /** glitch jump: landing distance from the hero, corrupted square half-size, seconds, damage tick and coefficient */
    glitchDist: 3.4, corruptHalf: 1.5, corruptSec: 7, corruptTick: 0.5, corruptCoef: 0.12,
    /** purge: safe tile radius and count (heroes + 1, clamped) */
    safeRadius: 1.3, safeMin: 2, safeMax: 4,
    /** mirror split: echo lifetime, ring radius around the platform, echo health (x the Core's), bolt fan cadence */
    splitSec: 16, splitRadius: 4.6, echoHealth: 0.12, boltEvery: 4,
    /** deploy: most adds alive at once */
    addCap: 3,
    /** the vault: platform radius bounds when measured from the dais (training yards fall back to the max) */
    arenaMin: 6, arenaMax: 10.5,
  },
};

/** The Core's deployable adds (summons: non-objective, linked to the Core, gone when it falls). */
export const CORE_ADDS: EnemyDef[] = [
  {
    id: 'coredrone', name: 'Watcher Drone', role: 'skirmisher',
    description: 'A hovering eye-drone of the Corrupted Core. Strafes and spits data bolts. Fragile.',
    baseHealth: 70, baseDamage: 9, armor: 4, cost: 0, radius: 0.32, moveSpeed: 3.2, tags: ['summon', 'flying'],
    perception: { sight: 15, hearing: 10, reactionTicks: 10 }, preferredRange: [3.5, 6],
    utility: { pursue: 0.4, flank: 0.9, retreat: 0.5, cast: 1.0, reposition: 0.8 },
    attacks: [
      { id: 'cd_zap', name: 'Data Bolt', kind: 'projectile', damageType: 'storm', damageCoef: '1', windupSec: 0.4, releaseSec: 0.05, recoverySec: 0.4, cooldownSec: 2.4, range: 7, projectileSpeed: 9, projectileCount: 1, projectileKind: 'cc_bolt', telegraph: { kind: 'line', length: 7, width: 0.25 } },
    ],
    weaknesses: { storm: '1.3' },
  },
  {
    id: 'coreturret', name: 'Sentry Turret', role: 'guardian',
    description: 'A bolted-down sentry of the Corrupted Core. Never moves; fires three-shot bursts down a marked lane. Armoured.',
    baseHealth: 150, baseDamage: 12, armor: 30, cost: 0, radius: 0.45, moveSpeed: 0, tags: ['summon'],
    perception: { sight: 16, hearing: 10, reactionTicks: 14 }, preferredRange: [0, 14],
    utility: { pursue: 0.1, flank: 0, retreat: 0, cast: 1.0, reposition: 0 },
    attacks: [
      { id: 'ct_burst', name: 'Sentry Burst', kind: 'projectile', damageType: 'storm', damageCoef: '0.8', windupSec: 0.75, releaseSec: 0.05, recoverySec: 0.6, cooldownSec: 3.0, range: 9, projectileSpeed: 8, projectileCount: 3, projectileKind: 'cc_bolt', telegraph: { kind: 'cone', range: 9, arcDeg: 30 } },
    ],
    weaknesses: { physical: '1.2', storm: '1.2' },
  },
];
