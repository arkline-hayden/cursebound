import { CLASS_BY_ID, SKILL_BY_ID } from '@cursebound/content';
import { lineClear, type GridMap, type Pt } from './path';

// Target picking and attack-move decisions for click-to-move (pure: unit tested from tests/). Which foe is under
// the cursor (screen-space sprite bounds first, then the nearest body near the cursor's ground point), what kind of
// thing the cursor is over (foe, pickup, legendary loot, door) and whether an attack-move order should stand and
// swing or keep closing in.

/** Basic attack reach for a class: melee arcs reach `range` past the hero to the target's edge; projectiles fly `range`. */
export interface Reach { ranged: boolean; range: number }

export function basicReach(classId: string | undefined): Reach {
  const cls = classId ? CLASS_BY_ID[classId] : undefined;
  const shape = cls ? SKILL_BY_ID[cls.basicSkill]?.shape : undefined;
  if (shape?.kind === 'arc') return { ranged: false, range: shape.range };
  if (shape?.kind === 'projectile') return { ranged: true, range: shape.range };
  if (shape && 'range' in shape && shape.range > 0) return { ranged: shape.range > 3, range: shape.range };
  return { ranged: false, range: 1.6 };
}

export interface EngageInput {
  self: Pt;
  target: { x: number; y: number; r: number };
  reach: Reach;
  /** the hero is already swinging at this target (hysteresis: it keeps swinging a little past the entry range) */
  engaged: boolean;
  /** clear projectile line from hero to target (only consulted for ranged reach) */
  los: boolean;
}

/** Distance band where an attack-move stands still and attacks. */
export function attackRange(reach: Reach, targetR: number, engaged: boolean): number {
  if (reach.ranged) return reach.range * 0.88 + (engaged ? 0.5 : 0);
  // the sim's arc test hits when the body edge is inside `range` (inCone: d <= range + radius); stay a hair inside
  return Math.max(0.6, reach.range + targetR * 0.9 - 0.2) + (engaged ? 0.3 : 0);
}

/** Attack-move decision: 'attack' (stop, aim, hold the attack button) or 'approach' (path closer / around cover). */
export function engageDecision(a: EngageInput): 'attack' | 'approach' {
  const d = Math.hypot(a.target.x - a.self.x, a.target.y - a.self.y);
  if (d > attackRange(a.reach, a.target.r, a.engaged)) return 'approach';
  if (a.reach.ranged && !a.los) return 'approach';
  return 'attack';
}

/** Projectile line of sight from hero to target (thin ray thickened by a typical bolt radius). */
export function shotClear(map: GridMap | null, from: Pt, to: Pt): boolean {
  if (!map) return true;
  return lineClear(map, from.x, from.y, to.x, to.y, 0.12);
}

export interface PickableEnemy { i: number; g: number; x: number; y: number; r: number; st: string; boss?: boolean }

/**
 * Foe under the cursor. `screenHit(e)` returns a draw depth when the pointer is inside the foe's sprite bounds (or
 * null); the front-most hit wins. Otherwise the nearest living foe whose body is within `radius` tiles of the cursor's
 * ground point.
 */
export function pickEnemy<E extends PickableEnemy>(
  enemies: readonly E[], cursor: Pt | null, screenHit: ((e: E) => number | null) | null, radius = 0.8,
): E | null {
  if (!cursor) return null;
  let best: E | null = null, bestDepth = -Infinity;
  if (screenHit) {
    for (const e of enemies) {
      if (e.st === 'dying') continue;
      const d = screenHit(e);
      if (d !== null && d > bestDepth) { best = e; bestDepth = d; }
    }
    if (best) return best;
  }
  let bd = Infinity;
  for (const e of enemies) {
    if (e.st === 'dying') continue;
    // big bodies (bosses, packed cohorts) count from their edge, small ones from their centre
    const d = Math.hypot(e.x - cursor.x, e.y - cursor.y) - Math.max(0, Math.min(e.r, 2.5) - 0.4);
    if (d <= radius && d < bd) { bd = d; best = e; }
  }
  return best;
}

export type GroundKind = 'pickup' | 'loot' | 'door';
export interface GroundThing { kind: GroundKind; x: number; y: number; r: number; index: number }

/**
 * Pickup / loot / door under the cursor. Pickups, loot (beams stand tall above the item) and door art are hit in
 * screen space; doors also by their floor footprint (RULES.doorVoteRadius around the front point). `P` projects a world point to scene pixels; `sp` is the pointer in scene pixels.
 */
export function pickGround(
  cursor: Pt | null, sp: Pt | null, P: (x: number, y: number) => Pt,
  pickups: readonly { x: number; y: number }[], loot: readonly { x: number; y: number }[],
  doors: readonly { x: number; y: number; r?: number; nx?: number; ny?: number }[],
): GroundThing | null {
  if (!cursor) return null;
  if (sp) {
    // a door's art stands on the wall face behind its front point (x, y), rising a wall's height up the screen
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      const q = P(d.x - (d.nx ?? 0) * 0.5, d.y - (d.ny ?? 0) * 0.5);
      if (Math.abs(sp.x - q.x) <= 22 && sp.y >= q.y - 72 && sp.y <= q.y + 10) return { kind: 'door', x: d.x, y: d.y, r: d.r ?? 1.2, index: i };
    }
    for (let i = 0; i < loot.length; i++) {
      const q = P(loot[i].x, loot[i].y);
      if (Math.abs(sp.x - q.x) <= 12 && sp.y >= q.y - 72 && sp.y <= q.y + 10) return { kind: 'loot', x: loot[i].x, y: loot[i].y, r: 0.6, index: i };
    }
    for (let i = 0; i < pickups.length; i++) {
      const q = P(pickups[i].x, pickups[i].y);
      if (((sp.x - q.x) / 12) ** 2 + ((sp.y - (q.y - 6)) / 12) ** 2 <= 1) return { kind: 'pickup', x: pickups[i].x, y: pickups[i].y, r: 0.4, index: i };
    }
  }
  let best: GroundThing | null = null, bd = Infinity;
  for (let i = 0; i < doors.length; i++) {
    const r = doors[i].r ?? 1.2;
    const d = Math.hypot(doors[i].x - cursor.x, doors[i].y - cursor.y);
    if (d <= r + 0.3 && d < bd) { bd = d; best = { kind: 'door', x: doors[i].x, y: doors[i].y, r, index: i }; }
  }
  return best;
}
