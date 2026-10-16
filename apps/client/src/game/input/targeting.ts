import { CLASS_BY_ID, SKILL_BY_ID } from '@cursebound/content';
import { HH, iso } from '../render/iso';
import { blocked, lineClear, nearestFloorTile, pointInTile, type GridMap, type Pt } from './path';

// Target picking and attack-move decisions for click-to-move (pure: unit tested from tests/). Which foe is under
// the cursor (the sprites as drawn, nothing else), which ground the cursor means (walls standing over it resolve to
// the floor at their foot), what kind of thing the cursor is over (foe, pickup, legendary loot, door) and whether an
// attack-move order should stand and swing or keep closing in.

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

/** A sprite's hit box in scene px, with its draw depth (the front-most box under the pointer wins). */
export interface HitBox { x0: number; y0: number; x1: number; y1: number; depth: number }

/** A foe as drawn this frame: a box for every body it shows (a packed cohort draws extra bodies around it). */
export interface FoeSprite<E> { e: E; boxes: readonly HitBox[] }

/**
 * Hit box of an actor sprite drawn with its feet at (x, y): most of the frame's width (the art is padded), from just
 * below the feet up the frame's height above its origin. `scaleX / scaleY` are the drawn scale (elites, squash).
 */
export function spriteBox(x: number, y: number, w: number, h: number, scaleX: number, scaleY: number, originY: number, depth: number): HitBox {
  const hw = w * Math.abs(scaleX) * 0.42, up = h * scaleY * originY * 0.9;
  return { x0: x - hw, x1: x + hw, y0: y - up, y1: y + 6, depth };
}

/**
 * Foe under the pointer (`sp`, scene px): the front-most sprite box that contains it, built from the sprites as drawn
 * (interpolated positions), the same test the hover outline uses. Nothing else: a click beside a foe's sprite is a
 * ground click, even close to where the latest snapshot puts its body (the picture runs ~100 ms behind that).
 */
export function pickEnemy<E extends PickableEnemy>(sprites: readonly FoeSprite<E>[], sp: Pt | null): E | null {
  if (!sp) return null;
  let best: E | null = null, bestDepth = -Infinity;
  for (const s of sprites) {
    if (s.e.st === 'dying') continue;
    for (const b of s.boxes) {
      if (sp.x < b.x0 || sp.x > b.x1 || sp.y < b.y0 || sp.y > b.y1 || b.depth <= bestDepth) continue;
      best = s.e; bestDepth = b.depth;
    }
  }
  return best;
}

/** Tallest wall face (screen px) the ground resolver looks past: the dungeon's full walls and the yard's houses. */
const MAX_WALL_PX = 160;
/** How far down (or up) the screen ray the floor at a wall's foot is looked for: its own tile plus two (32 px a tile). */
const FOOT_PX = 96;

/**
 * The ground point a pointer at scene px (sx, sy) means. Walls stand up the screen from their floor diamond
 * (`heightAt(tx, ty)`: the px a wall tile is drawn tall, 0 for floor, chasms and undrawn rock), so a pointer on a tall
 * back wall's face is over ground well behind the wall, often the next room, and the bare inverse projection sent the
 * hero around to it. When a wall is drawn over the pointer (the front-most one whose face rises past it), the point is
 * the floor at the foot of that wall straight down the screen from the pointer: on the camera side, or on the far side
 * when `self` stands there (a wall that hides the hero is faded and clicked through) and only that side is in view.
 * Floor the pointer really shows comes back unchanged.
 */
export function groundAt(map: GridMap | null, sx: number, sy: number, heightAt: ((tx: number, ty: number) => number) | null, self: Pt | null = null): Pt {
  const g = iso.toWorld(sx, sy);
  if (!map || !heightAt) return g;
  const k = 1 / (2 * HH);                                   // one screen px down the ray: +1/32 tile in world x and y
  const at = (h: number) => ({ x: g.x + h * k, y: g.y + h * k });
  // further down the screen is further forward, so the last face along the ray that still reaches the pointer is drawn
  // over every other one
  let wallAt = -1;
  for (let h = 0; h <= MAX_WALL_PX; h++) {
    const p = at(h), tx = Math.floor(p.x), ty = Math.floor(p.y);
    if (!blocked(map, tx, ty)) continue;
    const wh = heightAt(tx, ty);
    if (wh > 0 && wh >= h) wallAt = h;
  }
  if (wallAt < 0) return g;
  // the first floor along the ray from the wall, out of its tile and at most two more tiles on (not a room away)
  const floorFrom = (h0: number, dir: 1 | -1): Pt | null => {
    for (let h = h0, n = 0; n <= FOOT_PX; h += dir, n++) {
      const p = at(h), tx = Math.floor(p.x), ty = Math.floor(p.y);
      if (!blocked(map, tx, ty)) return pointInTile(map, ty * map.w + tx, p.x, p.y);
    }
    return null;
  };
  // a corner face looking onto rock has no floor straight below it: the floor nearest the wall's foot instead
  const foot = at(wallAt), ti = nearestFloorTile(map, foot.x, foot.y);
  const front = floorFrom(wallAt, 1) ?? (ti >= 0 ? pointInTile(map, ti, foot.x, foot.y) : null), back = floorFrom(wallAt, -1);
  if (self && back && !(front && lineClear(map, self.x, self.y, front.x, front.y, 0)) && lineClear(map, self.x, self.y, back.x, back.y, 0)) return back;
  return front ?? g;
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
