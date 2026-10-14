import { nextInt, type RngState } from './rng';
import type { RoomKind } from './types';

// Grid toolkit shared by the map generation tiers (mapgen.ts layouts, rooms.ts room kinds, arenas.ts boss lairs).
// Carving never touches the outer border ring, so every floor stays sealed.

export type Grid = { w: number; h: number; t: number[] };
export const WALL = 1, FLOOR = 0;

export type RoomShape = 'rect' | 'round' | 'cave' | 'hall';

/** A room a layout carved (tier 1 output, tier 2 input). `kinds` limits what it may become; `kind` forces one;
 *  `furnished` marks rooms whose blocking pieces the layout already carved (gallery sarcophagi, colonnade columns). */
export interface RoomSpec {
  x: number; y: number; w: number; h: number;
  shape: RoomShape;
  kind?: RoomKind;
  kinds?: RoomKind[];
  furnished?: boolean;
}

/** One generated floor before validation: the grid, its rooms, chasm tiles and (arenas) authored spawn points. */
export interface Gen {
  g: Grid;
  rooms: RoomSpec[];
  /** 1 = this wall tile is chasm (drawn as void) */
  voids?: Uint8Array;
  /** authored party start and boss dais (tile indices) */
  start?: number;
  boss?: number;
  arena?: string;
}

export function solid(w: number, h: number): Grid { return { w, h, t: new Array<number>(w * h).fill(WALL) }; }
export const idx = (g: Grid, x: number, y: number) => y * g.w + x;
export const inner = (g: Grid, x: number, y: number) => x >= 1 && y >= 1 && x < g.w - 1 && y < g.h - 1;
export const isFloorAt = (g: Grid, x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h && g.t[y * g.w + x] === FLOOR;
export function carve(g: Grid, x: number, y: number) { if (inner(g, x, y)) g.t[idx(g, x, y)] = FLOOR; }
export function fill(g: Grid, x: number, y: number) { if (inner(g, x, y)) g.t[idx(g, x, y)] = WALL; }
export function rect(g: Grid, x0: number, y0: number, w: number, h: number, v: number) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) (v === FLOOR ? carve : fill)(g, x, y);
}
export function ellipse(g: Grid, cx: number, cy: number, rx: number, ry: number, v: number) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
    if (dx * dx + dy * dy <= 1) (v === FLOOR ? carve : fill)(g, x, y);
  }
}
/** L-shaped corridor `width` tiles wide between two points (bend order drawn from the stream). */
export function corridor(g: Grid, rng: RngState, x0: number, y0: number, x1: number, y1: number, width: number) {
  const horizFirst = nextInt(rng, 2) === 0;
  const hx = (ya: number, xa: number, xb: number) => { for (let x = Math.min(xa, xb); x <= Math.max(xa, xb); x++) for (let k = 0; k < width; k++) carve(g, x, ya + k); };
  const vy = (xa: number, ya: number, yb: number) => { for (let y = Math.min(ya, yb); y <= Math.max(ya, yb); y++) for (let k = 0; k < width; k++) carve(g, xa + k, y); };
  if (horizFirst) { hx(y0, x0, x1); vy(x1, y0, y1); } else { vy(x0, y0, y1); hx(y1, x0, x1); }
}
/** Straight run `width` tiles wide (axis-aligned; the shorter axis is ignored). */
export function straight(g: Grid, x0: number, y0: number, x1: number, y1: number, width: number) {
  if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let k = 0; k < width; k++) carve(g, x, y0 + k);
  } else {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let k = 0; k < width; k++) carve(g, x0 + k, y);
  }
}
export const ri = (rng: RngState, lo: number, hi: number) => lo + nextInt(rng, hi - lo + 1);

/** Floor tiles inside a rect. */
export function floorIn(g: Grid, r: { x: number; y: number; w: number; h: number }): number {
  let n = 0;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (isFloorAt(g, x, y)) n++;
  return n;
}

/**
 * Can a free-standing block (w x h tiles at x, y) be set down without ever cutting the floor apart? It must sit on
 * floor and its whole one-tile surround must be floor, so every path through it can walk round it on that ring. Two
 * blocks placed under this rule never touch, so their rings never overlap a block either.
 */
export function blockFits(g: Grid, x: number, y: number, w: number, h: number): boolean {
  for (let yy = y - 1; yy <= y + h; yy++) for (let xx = x - 1; xx <= x + w; xx++) {
    if (!inner(g, xx, yy) || g.t[idx(g, xx, yy)] !== FLOOR) return false;
  }
  return true;
}
export function block(g: Grid, x: number, y: number, w: number, h: number): boolean {
  if (!blockFits(g, x, y, w, h)) return false;
  rect(g, x, y, w, h, WALL);
  return true;
}
