import type { MapState } from './types';

// Shared ground-plane collision (PRD §5.1, §12.3, §17.2). Used by the authority AND by client prediction,
// so it must stay free of rendering/browser/node dependencies. 1 tile = 1 world unit.

export const QUANT = 1 / 1024;
export const q = (v: number) => Math.round(v / QUANT) * QUANT;

export function isWall(map: MapState, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
  return map.tiles[ty * map.w + tx] === 1;
}

export function isWallAt(map: MapState, x: number, y: number): boolean {
  return isWall(map, Math.floor(x), Math.floor(y));
}

/** Push a circle out of all overlapping wall tiles (closest-point resolution). */
function resolveCircle(map: MapState, x: number, y: number, r: number): [number, number, boolean] {
  let hit = false;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    const minX = Math.floor(x - r), maxX = Math.floor(x + r);
    const minY = Math.floor(y - r), maxY = Math.floor(y + r);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (!isWall(map, tx, ty)) continue;
        const cx = Math.max(tx, Math.min(x, tx + 1));
        const cy = Math.max(ty, Math.min(y, ty + 1));
        let dx = x - cx, dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        hit = true; moved = true;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          const push = r - d + 1e-6;
          x += (dx / d) * push; y += (dy / d) * push;
        } else {
          // center inside the tile: push out along the shallowest axis
          const left = x - tx, right = tx + 1 - x, up = y - ty, down = ty + 1 - y;
          const m = Math.min(left, right, up, down);
          if (m === left) x = tx - r - 1e-6; else if (m === right) x = tx + 1 + r + 1e-6;
          else if (m === up) y = ty - r - 1e-6; else y = ty + 1 + r + 1e-6;
          dx = 0; dy = 0;
        }
      }
    }
    if (!moved) break;
  }
  return [x, y, hit];
}

/**
 * Swept circle movement with wall sliding. Movement is sub-stepped so a step never exceeds half the radius,
 * preventing tunnelling at any speed. Distances beyond two arena diagonals in one tick fully settle against walls
 * through sliding, so additional distance cannot change the outcome (declared rule, PRD §12.3) — this bounds work
 * without lowering the velocity stat.
 */
export function moveCircle(map: MapState, x: number, y: number, dx: number, dy: number, r: number): { x: number; y: number; hitWall: boolean } {
  let len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-9) return { x, y, hitWall: false };
  const maxLen = 2 * Math.sqrt(map.w * map.w + map.h * map.h);
  if (len > maxLen) { dx = (dx / len) * maxLen; dy = (dy / len) * maxLen; len = maxLen; }
  const stepLen = Math.max(0.05, r * 0.5);
  const steps = Math.min(1024, Math.ceil(len / stepLen));
  const sx = dx / steps, sy = dy / steps;
  let hitWall = false;
  let stalled = 0;
  for (let i = 0; i < steps; i++) {
    const px = x, py = y;
    let nx = x + sx, ny = y;
    let res = resolveCircle(map, nx, ny, r);
    nx = res[0]; ny = res[1]; if (res[2]) hitWall = true;
    ny += sy;
    res = resolveCircle(map, nx, ny, r);
    x = res[0]; y = res[1]; if (res[2]) hitWall = true;
    // settle: if no progress for several substeps, contact has settled
    if (Math.abs(x - px) + Math.abs(y - py) < 1e-7) { if (++stalled > 2) break; } else stalled = 0;
  }
  return { x: q(x), y: q(y), hitWall };
}

/** Grid ray cast (DDA). Returns distance to first wall along the ray, up to maxDist. */
export function rayDistance(map: MapState, x: number, y: number, dx: number, dy: number, maxDist: number): number {
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-9) return 0;
  dx /= len; dy /= len;
  let tx = Math.floor(x), ty = Math.floor(y);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? (tx + 1 - x) : (x - tx)) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? (ty + 1 - y) : (y - ty)) * tDeltaY : Infinity;
  let t = 0;
  if (isWall(map, tx, ty)) return 0;
  while (t <= maxDist) {
    if (tMaxX < tMaxY) { t = tMaxX; tMaxX += tDeltaX; tx += stepX; }
    else { t = tMaxY; tMaxY += tDeltaY; ty += stepY; }
    if (t > maxDist) break;
    if (isWall(map, tx, ty)) return t;
  }
  return maxDist;
}

export function lineOfSight(map: MapState, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0, dy = y1 - y0;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-6) return true;
  return rayDistance(map, x0, y0, dx, dy, d) >= d - 1e-6;
}

/** Segment (p0->p1, thickened by r) vs circle intersection: returns earliest parameter t in [0,1] or -1. */
export function sweepCircle(x0: number, y0: number, x1: number, y1: number, r: number, cx: number, cy: number, cr: number): number {
  const dx = x1 - x0, dy = y1 - y0;
  const fx = x0 - cx, fy = y0 - cy;
  const R = r + cr;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - R * R;
  if (c <= 0) return 0;
  if (a < 1e-12) return -1;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

export function norm(x: number, y: number): [number, number] {
  const l = Math.sqrt(x * x + y * y);
  return l < 1e-9 ? [0, 0] : [x / l, y / l];
}

/** Point inside a cone (origin, unit dir, range, cos(halfArc)), accounting for target radius. */
export function inCone(ox: number, oy: number, dx: number, dy: number, range: number, cosHalf: number, px: number, py: number, pr: number): boolean {
  const vx = px - ox, vy = py - oy;
  const d2 = vx * vx + vy * vy;
  const R = range + pr;
  if (d2 > R * R) return false;
  if (d2 < pr * pr) return true;
  const d = Math.sqrt(d2);
  const cos = (vx * dx + vy * dy) / d;
  // widen by the angular size of the target
  const slack = Math.min(1, pr / d);
  return cos >= cosHalf - slack;
}

/** Point within an oriented rectangle starting at origin along dir (length, half width). */
export function inLine(ox: number, oy: number, dx: number, dy: number, length: number, halfWidth: number, px: number, py: number, pr: number): boolean {
  const vx = px - ox, vy = py - oy;
  const along = vx * dx + vy * dy;
  if (along < -pr || along > length + pr) return false;
  const perp = Math.abs(-vx * dy + vy * dx);
  return perp <= halfWidth + pr;
}

/** dir8 from a vector in screen space: 0=E,1=SE,2=S,3=SW,4=W,5=NW,6=N,7=NE (no trig). */
export function dir8(x: number, y: number): number {
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return 2;
  const ax = Math.abs(x), ay = Math.abs(y);
  const T = 0.41421356; // tan(22.5°)
  if (ay <= ax * T) return x > 0 ? 0 : 4;
  if (ax <= ay * T) return y > 0 ? 2 : 6;
  if (x > 0) return y > 0 ? 1 : 7;
  return y > 0 ? 3 : 5;
}

export function rotate(x: number, y: number, cos: number, sin: number): [number, number] {
  return [x * cos - y * sin, x * sin + y * cos];
}
