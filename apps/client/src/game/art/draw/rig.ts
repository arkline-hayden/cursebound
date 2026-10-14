/**
 * Tiny 2.5D rig for three-quarter top-down sprites. Characters are posed in a local frame
 * (f = forward, r = character's right, z = up), rotated to a facing, and projected with the
 * camera looking from the south: screen y = ground + worldY * K - z. Parts are depth-sorted by worldY.
 */

export type View = 'e' | 'se' | 's' | 'ne' | 'n';

export const VIEW_ANGLE: Record<View, number> = {
  e: 0,
  se: Math.PI / 4,
  s: Math.PI / 2,
  ne: -Math.PI / 4,
  n: -Math.PI / 2,
};

export interface Pt {
  x: number;
  y: number;
  /** depth: larger = nearer the camera */
  d: number;
}

export const FORESHORTEN = 0.5;

export class Proj {
  readonly cx: number;
  readonly gy: number;
  readonly fx: number;
  readonly fy: number;
  readonly rx: number;
  readonly ry: number;
  readonly k: number;

  constructor(cx: number, gy: number, angle: number, k = FORESHORTEN) {
    this.cx = cx;
    this.gy = gy;
    this.fx = Math.cos(angle);
    this.fy = Math.sin(angle);
    // character's right-hand side: facing rotated +90deg (screen space, +y down)
    this.rx = -this.fy;
    this.ry = this.fx;
    this.k = k;
  }

  p(f: number, r: number, z: number): Pt {
    const wx = f * this.fx + r * this.rx;
    const wy = f * this.fy + r * this.ry;
    return { x: this.cx + wx, y: this.gy + wy * this.k - z, d: wy };
  }

  /** World-y of a local horizontal offset (positive = toward camera). */
  depthOf(f: number, r: number): number {
    return f * this.fy + r * this.ry;
  }

  /** Screen half-width of a body with half-width w (right axis) and half-depth dp (forward axis). */
  halfWidth(w: number, dp: number): number {
    return Math.abs(this.rx) * w + Math.abs(this.fx) * dp;
  }

  /** Screen half-height (vertical extent on screen) of the same footprint. */
  halfHeight(w: number, dp: number): number {
    return (Math.abs(this.ry) * w + Math.abs(this.fy) * dp) * this.k;
  }
}

export interface Part {
  d: number;
  draw: () => void;
}

export function drawParts(parts: Part[]): void {
  parts.sort((a, b) => a.d - b.d);
  for (const part of parts) part.draw();
}

export function rot(f: number, r: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [f * c - r * s, f * s + r * c];
}

/** Convex hull (monotone chain) of points, returned as a flat [x,y,...] polygon. */
export function hull(pts: { x: number; y: number }[]): number[] {
  const p = pts.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (p.length < 3) return p.flatMap((q) => [q.x, q.y]);
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: { x: number; y: number }[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper).flatMap((q) => [q.x, q.y]);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
