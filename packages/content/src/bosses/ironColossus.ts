import type { BossDef } from '../types';

// THE IRON COLOSSUS: the boss of the Ember Forge ('forge'), a slow, towering forge-engine in riveted plate. It never
// rushes: it plods after its prey and owns the floor. Every attack is scripted (simulation bosses/ironColossus.ts).
//   Quake Hammer   a long raise, then the hammer falls on a marked circle in front of it and molten shockwave rings
//                  roll out one after another. Each ring has a gap: walk through it, or dodge-roll through the flames.
//   Slag Flood     vents slag into the floor in a pattern (checkerboard, cross, bands or spokes) that glows before it
//                  erupts into lava for a few seconds. Its own footing stays clear.
//   Piston Stomp   a short, close stomp that punishes heroes hugging its feet (pins them for a moment).
//   Overheat       every few blows the furnace overheats: plates vent, the glowing weak points take x2.2 damage and
//                  it stands still, radiating heat, for a few seconds. The punish window.

export const IRON_COLOSSUS: BossDef = {
  id: 'ironcolossus', name: 'The Iron Colossus', title: 'Heart of the Ember Forge',
  description: 'Slow and armour-plated. Its hammer quakes send molten rings rolling outward (step through the gap or dodge-roll through), it floods the floor with glowing slag patterns that erupt into lava, and it stomps anyone at its feet. Every few blows it overheats: the plates vent and its glowing weak points take double damage.',
  refUnitHealth: 1750, bossFactor: 8, baseDamage: 56, armor: 80, radius: 1.7, moveSpeed: 1.0, tags: ['boss'],
  vulnerableMultiplier: '2.2', staggerMeter: 900,
  loot: 'lg_heart_of_the_colossus',
  phases: [
    { healthFrac: 1.0, weight: 1, patterns: [['ic_hammer', 'ic_stomp'], ['ic_slag', 'ic_hammer'], ['ic_hammer', 'ic_overheat']], cadence: '1.2' },
    { healthFrac: 2 / 3, weight: 1, patterns: [['ic_slag', 'ic_hammer', 'ic_stomp'], ['ic_hammer', 'ic_hammer', 'ic_overheat'], ['ic_slag', 'ic_slag', 'ic_hammer']], cadence: '1.05' },
    { healthFrac: 1 / 3, weight: 1, patterns: [['ic_hammer', 'ic_slag', 'ic_hammer'], ['ic_stomp', 'ic_slag', 'ic_overheat'], ['ic_slag', 'ic_hammer', 'ic_hammer', 'ic_overheat']], cadence: '0.9' },
  ],
  attacks: [
    { id: 'ic_hammer', name: 'Quake Hammer', kind: 'scripted', damageType: 'physical', damageCoef: '1.7', windupSec: 1.45, releaseSec: 0.25, recoverySec: 1.0, cooldownSec: 0, range: 3.4, projectileSpeed: 4, projectileCount: 2, telegraph: { kind: 'circle', radius: 2.2 } },
    { id: 'ic_slag', name: 'Slag Flood', kind: 'scripted', damageType: 'ember', damageCoef: '0.14', windupSec: 1.5, releaseSec: 0.2, recoverySec: 0.6, cooldownSec: 0, range: 9, duration: 4.5, telegraph: { kind: 'circle', radius: 9 } },
    { id: 'ic_stomp', name: 'Piston Stomp', kind: 'scripted', damageType: 'physical', damageCoef: '1.3', inflict: { status: 'rooted', sec: 1 }, windupSec: 0.85, releaseSec: 0.15, recoverySec: 0.8, cooldownSec: 0, range: 3.2, telegraph: { kind: 'circle', radius: 3.2 } },
    { id: 'ic_overheat', name: 'Overheat', kind: 'scripted', damageType: 'ember', damageCoef: '0.12', windupSec: 0.8, releaseSec: 0.1, recoverySec: 0.4, cooldownSec: 0, range: 2.6, duration: 4.5, telegraph: { kind: 'circle', radius: 2.6 } },
  ],
  params: {
    /** hammer: impact distance ahead and radius; shockwave rings (count early / below a third, seconds apart, units/s
     *  x Fate projectile speed, thickness, reach), the half-angle of each ring's gap (radians) and ring damage (x impact) */
    impactDist: 2.6, impactRadius: 2.2, rings: 2, ringsLate: 3, ringLead: 0.3, ringDelay: 0.55, ringThick: 0.7, ringReach: 11, ringGap: 0.42, ringCoef: 0.55,
    /** slag: pattern radius, clear radius around its feet, cell size (tiles), lava seconds and damage tick */
    slagRadius: 9, slagSafe: 1.6, slagCell: 2, slagTick: 0.5,
    /** overheat: vulnerable seconds; heat aura radius and tick */
    heatRadius: 2.6, heatTick: 0.5,
  },
};

/** Slag patterns (Slag Flood): 0 checkerboard of cells, 1 cross / saltire lanes, 2 concentric bands, 3 spokes. */
export const SLAG_PATTERNS = ['checker', 'cross', 'bands', 'spokes'] as const;

/**
 * Is tile (tx, ty) lava under a slag pattern centred on tile (cx, cy)? Pure and shared by the simulation (damage) and
 * the client (drawing), so both always agree. `parity` (0 | 1) flips the pattern; `cell` is the checker cell size.
 * Tiles beyond `radius` or within `safe` of the centre (its own footing) are never lava.
 */
export function slagLava(pattern: number, parity: number, cx: number, cy: number, tx: number, ty: number, radius: number, safe: number, cell = 2): boolean {
  const dx = tx - cx, dy = ty - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 > radius * radius || d2 < safe * safe) return false;
  switch (pattern) {
    case 0: return ((Math.floor(dx / cell) + Math.floor(dy / cell)) & 1) === parity;
    case 1: return parity === 0 ? Math.abs(dx) <= 1 || Math.abs(dy) <= 1 : Math.abs(dx - dy) <= 1 || Math.abs(dx + dy) <= 1;
    case 2: return (Math.floor(Math.sqrt(d2) / 2) & 1) === parity;
    default: {
      const a = Math.atan2(dy, dx) + Math.PI;
      return (Math.floor((a / (Math.PI * 2)) * 8 + 0.5) & 1) === parity;
    }
  }
}
