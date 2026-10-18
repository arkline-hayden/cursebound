// 2:1 isometric projection shared by every renderer. The simulation plane is untouched: a world tile (x, y) is
// drawn as a 64x32 diamond whose top corner sits at (iso.x, iso.y). World north (-y) is screen up-right, world
// west (-x) is screen up-left. Depth sorts by x + y (the screen row), so anything further "south-east" draws later.

export const HW = 32;          // half diamond width
export const HH = 16;          // half diamond height
export const WALL_H = 64;      // full wall face height in screen px
export const STUB_H = 16;      // cut-away front wall height

export const iso = {
  x: (x: number, y: number) => (x - y) * HW,
  y: (x: number, y: number) => (x + y) * HH,
  /** screen point of a world point */
  p: (x: number, y: number) => ({ x: (x - y) * HW, y: (x + y) * HH }),
  /** screen-space vector of a world-space vector (not normalised) */
  dir: (dx: number, dy: number) => ({ x: (dx - dy) * HW, y: (dx + dy) * HH }),
  /** unit screen direction of a world direction */
  unit: (dx: number, dy: number) => {
    const sx = (dx - dy) * HW, sy = (dx + dy) * HH;
    const l = Math.hypot(sx, sy) || 1;
    return { x: sx / l, y: sy / l };
  },
  /** world point under a screen point */
  toWorld: (sx: number, sy: number) => {
    const a = sx / HW, b = sy / HH;
    return { x: (a + b) / 2, y: (b - a) / 2 };
  },
  /** world direction for a screen direction (normalised to the input's length, clamped to 1) */
  dirToWorld: (sx: number, sy: number) => {
    const m = Math.min(1, Math.hypot(sx, sy));
    if (m < 1e-4) return { x: 0, y: 0 };
    const a = sx / HW, b = sy / HH;
    const wx = (a + b) / 2, wy = (b - a) / 2;
    const l = Math.hypot(wx, wy) || 1;
    return { x: (wx / l) * m, y: (wy / l) * m };
  },
  /**
   * World direction for digital movement (WASD, arrow keys, D-pad), normalised to the input's length clamped to 1.
   * A single key walks straight along the screen like dirToWorld (W up, D right: world diagonals), but two keys walk
   * along the grid instead of at 45° on screen: W+D is world north (screen up-right at atan(1/2) ~ 26.57°, straight
   * down a corridor / tile row), D+S world east, S+A world south, A+W world west. The key vector is read on the
   * unsquashed ground plane (the 2:1 squash undone), where the eight key directions are 45° apart.
   */
  keyToWorld: (sx: number, sy: number) => {
    const m = Math.min(1, Math.hypot(sx, sy));
    if (m < 1e-4) return { x: 0, y: 0 };
    const wx = sx + sy, wy = sy - sx;
    const l = Math.hypot(wx, wy) || 1;
    return { x: (wx / l) * m, y: (wy / l) * m };
  },
  /**
   * 8-way facing (0 E, 1 SE, 2 S, 3 SW, 4 W, 5 NW, 6 N, 7 NE on screen; animFor's index) for a world direction.
   * Sprites are posed on the ground plane and foreshortened 2:1 exactly like the floor (art/draw/rig.ts), so the
   * direction is binned there, in equal 45° sectors: undoing the 2:1 squash of iso.dir leaves (dx - dy, dx + dy).
   * Binning the squashed screen vector instead gave east / west 79° of heading and north / south only 23°, so a
   * hero walking a few degrees off a world axis (a screen diagonal: every corridor) showed the wrong sprite.
   */
  facing8: (dx: number, dy: number) => {
    const x = dx - dy, y = dx + dy;
    if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return 2;
    const T = 0.41421356, ax = Math.abs(x), ay = Math.abs(y);   // tan(22.5°)
    if (ay <= ax * T) return x > 0 ? 0 : 4;
    if (ax <= ay * T) return y > 0 ? 2 : 6;
    if (x > 0) return y > 0 ? 1 : 7;
    return y > 0 ? 3 : 5;
  },
  /** depth for an object standing at world (x, y) */
  depth: (x: number, y: number) => (x + y) * 10,
  /** half-axes of the screen ellipse for a world circle of radius r */
  rx: (r: number) => r * HW * Math.SQRT2,
  ry: (r: number) => r * HH * Math.SQRT2,
};

/** Screen polygon for a world polygon. */
export function isoPoly(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  return pts.map((p) => iso.p(p.x, p.y));
}

/** Screen bounds of a w x h map (ground plane), padded. */
export function isoBounds(w: number, h: number) {
  return { minX: -h * HW, maxX: w * HW, minY: 0, maxY: (w + h) * HH, width: (w + h) * HW, height: (w + h) * HH };
}
