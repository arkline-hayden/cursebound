import { circleClear, isWall, lineOfSight } from './geometry';
import { generateDungeon } from './mapgen';
import type { MapState } from './types';

// Map generation lives in mapgen.ts (procedural layouts + themes per round). This module keeps grid queries and A*.

/** `theme` overrides the seeded theme rotation (the door the party chose, doors.ts). */
export function generateMap(seed: string, round: number, boss: boolean, theme?: string | null): MapState {
  return generateDungeon(seed, round, boss, theme);
}

// ---------------- A* (8-connected, no corner cutting) ----------------

/** Sample points of a tile (fractions of a tile) where a big body may stand: centre first, then edges and corners. */
const ROOM_SAMPLES = [0.5, 0.1, 0.9];

/** Is there a spot in tile (tx, ty) where a body of radius `body` touches no wall? (big bodies' A*, findPath) */
export function roomFor(map: MapState, tx: number, ty: number, body: number): boolean {
  for (const fy of ROOM_SAMPLES) for (const fx of ROOM_SAMPLES) if (circleClear(map, tx + fx, ty + fy, body)) return true;
  return false;
}

/**
 * A* over floor tiles. `body` > 0 plans for a big body (bosses): tiles with no room for a circle of that radius anywhere
 * in them (one-tile gaps between a pillar and a wall, say) are impassable, except the start and goal tiles. When no
 * such path exists it falls back to the plain tile path (the body slides as far as it can).
 */
export function findPath(map: MapState, sx: number, sy: number, gx: number, gy: number, maxNodes = 900, body = 0): number[] {
  if (body > 0) {
    const room = new Map<number, boolean>();
    const open = (i: number) => {
      let v = room.get(i);
      if (v === undefined) { v = roomFor(map, i % map.w, (i / map.w) | 0, body); room.set(i, v); }
      return v;
    };
    const p = aStar(map, sx, sy, gx, gy, maxNodes, open);
    if (p.length) return p;
  }
  return aStar(map, sx, sy, gx, gy, maxNodes, null);
}

function aStar(map: MapState, sx: number, sy: number, gx: number, gy: number, maxNodes: number, passable: ((i: number) => boolean) | null): number[] {
  const w = map.w, h = map.h;
  const start = Math.floor(sy) * w + Math.floor(sx);
  let goal = Math.floor(gy) * w + Math.floor(gx);
  if (map.tiles[goal] === 1) {
    // nearest floor tile to goal
    let best = -1, bd = Infinity;
    const gtx = Math.floor(gx), gty = Math.floor(gy);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = gtx + dx, y = gty + dy;
      if (x < 0 || y < 0 || x >= w || y >= h || map.tiles[y * w + x] === 1) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = y * w + x; }
    }
    if (best < 0) return [];
    goal = best;
  }
  if (start === goal) return [goal];
  const gScore = new Map<number, number>();
  const came = new Map<number, number>();
  const open: { i: number; f: number; g: number }[] = [];
  const gx0 = goal % w, gy0 = (goal / w) | 0;
  const hfn = (i: number) => {
    const dx = Math.abs((i % w) - gx0), dy = Math.abs(((i / w) | 0) - gy0);
    return Math.max(dx, dy) + 0.41421356 * Math.min(dx, dy);
  };
  gScore.set(start, 0);
  open.push({ i: start, f: hfn(start), g: 0 });
  let expanded = 0;
  const closed = new Set<number>();
  while (open.length && expanded < maxNodes) {
    // binary-heap-free: small grids, pick min (deterministic tie by index)
    let bi = 0;
    for (let k = 1; k < open.length; k++) {
      const a = open[k], b = open[bi];
      if (a.f < b.f || (a.f === b.f && a.i < b.i)) bi = k;
    }
    const cur = open[bi];
    open[bi] = open[open.length - 1]; open.pop();
    if (closed.has(cur.i)) continue;
    closed.add(cur.i);
    expanded++;
    if (cur.i === goal) {
      const path = [goal];
      let c = goal;
      while (came.has(c)) { c = came.get(c)!; path.push(c); }
      path.reverse();
      return path;
    }
    const cx = cur.i % w, cy = (cur.i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (map.tiles[ni] === 1) continue;
      if (dx && dy && (map.tiles[cy * w + nx] === 1 || map.tiles[ny * w + cx] === 1)) continue;
      if (passable && ni !== goal && !passable(ni)) continue;
      const ng = cur.g + (dx && dy ? 1.41421356 : 1);
      if (ng < (gScore.get(ni) ?? Infinity)) {
        gScore.set(ni, ng);
        came.set(ni, cur.i);
        open.push({ i: ni, f: ng + hfn(ni), g: ng });
      }
    }
  }
  return [];
}

export function tileCenter(map: MapState, i: number): [number, number] {
  return [(i % map.w) + 0.5, ((i / map.w) | 0) + 0.5];
}

/** Find a floor point near (x,y) with line of sight from (fromX, fromY). */
export function nearestFloor(map: MapState, x: number, y: number): [number, number] {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (!isWall(map, tx, ty)) return [x, y];
  for (let r = 1; r < 6; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (!isWall(map, tx + dx, ty + dy)) return [tx + dx + 0.5, ty + dy + 0.5];
    }
  }
  return [x, y];
}

export { lineOfSight };
