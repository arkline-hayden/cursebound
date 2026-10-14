// Client-side pathing for Diablo-style click-to-move (and cutscene puppets): 8-connected A* on the tile grid that
// never cuts a wall corner, then line-of-sight string pulling with the hero's body radius so walks read as natural
// straight lines instead of staircase zig-zags. Unreachable clicks fall back to the reachable floor closest to the
// clicked point. Pure (no DOM, no Phaser) so the root tests/ folder can unit test it.

/** Any tile grid: `tiles[y * w + x]` is 1 for wall, anything else is floor (MapState / PhaseData.map fit). */
export interface GridMap { w: number; h: number; tiles: ArrayLike<number> }
export interface Pt { x: number; y: number }

/** Hero body radius (RULES.playerRadius): string pulling keeps this clearance from walls. */
export const BODY_RADIUS = 0.3;
const EPS = 0.02;

export interface PathOpts {
  /** body radius used by smoothing and goal nudging (default BODY_RADIUS) */
  radius?: number;
  /** A* expansion budget (default: whole map) */
  maxNodes?: number;
  /** extra cost for entering a tile (e.g. tiles crowded by foes); Infinity blocks it. Never applied to the goal tile. */
  cost?: (tx: number, ty: number) => number;
  /** string-pull the tile path (default true) */
  smooth?: boolean;
}

export interface PathResult {
  /** waypoints after the start point; the last one is `goal`. Empty when no step is needed or possible. */
  points: Pt[];
  /** true when `goal` is the clicked point (or the floor right next to a clicked wall), false for a fallback */
  reached: boolean;
  /** where the walk ends */
  goal: Pt;
}

/** Out of bounds or a wall tile. */
export function blocked(map: GridMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
  return map.tiles[ty * map.w + tx] === 1;
}

/** A circle of radius r at (x, y) overlaps no wall tile (r = 0: the point is on floor). */
export function circleFree(map: GridMap, x: number, y: number, r: number): boolean {
  if (r <= 0) return !blocked(map, Math.floor(x), Math.floor(y));
  const rr = Math.max(0, r - EPS);
  const minX = Math.floor(x - rr), maxX = Math.floor(x + rr), minY = Math.floor(y - rr), maxY = Math.floor(y + rr);
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if (!blocked(map, tx, ty)) continue;
      const cx = Math.max(tx, Math.min(x, tx + 1)), cy = Math.max(ty, Math.min(y, ty + 1));
      if ((cx - x) ** 2 + (cy - y) ** 2 < rr * rr) return false;
    }
  }
  return true;
}

/**
 * The segment can be walked by a body of radius r (sampled every r/2; r = 0 is a thin line-of-sight ray).
 * The start sample is skipped: a hero resting against a wall still has line of sight away from it.
 */
export function lineClear(map: GridMap, x0: number, y0: number, x1: number, y1: number, r = BODY_RADIUS): boolean {
  const dx = x1 - x0, dy = y1 - y0;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return circleFree(map, x1, y1, r);
  const step = r > 0 ? Math.max(0.06, r * 0.5) : 0.1;
  const n = Math.max(1, Math.ceil(d / step));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (!circleFree(map, x0 + dx * t, y0 + dy * t, r)) return false;
  }
  return true;
}

/** Nearest floor tile index to the point (x, y) by Euclidean distance to the tile centre, searching out to `maxR`. */
export function nearestFloorTile(map: GridMap, x: number, y: number, maxR = 12): number {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (!blocked(map, tx, ty)) return ty * map.w + tx;
  let best = -1, bd = Infinity;
  for (let r = 1; r <= maxR; r++) {
    for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;     // ring only
      const nx = tx + ox, ny = ty + oy;
      if (blocked(map, nx, ny)) continue;
      const d = (nx + 0.5 - x) ** 2 + (ny + 0.5 - y) ** 2;
      if (d < bd) { bd = d; best = ny * map.w + nx; }
    }
    // the point sits inside tile (tx, ty), so every centre on ring k is at least k - 0.5 away
    if (best >= 0 && Math.sqrt(bd) <= r + 0.5) break;
  }
  return best;
}

/** The point inside tile `ti` closest to (x, y), kept a body radius away from the tile's wall sides. */
export function pointInTile(map: GridMap, ti: number, x: number, y: number, r = BODY_RADIUS): Pt {
  const tx = ti % map.w, ty = (ti / map.w) | 0;
  const m = Math.min(0.49, Math.max(0, r));
  const lo = (side: boolean) => (side ? m : 0.001), hi = (side: boolean) => (side ? 1 - m : 0.999);
  const px = Math.max(tx + lo(blocked(map, tx - 1, ty)), Math.min(tx + hi(blocked(map, tx + 1, ty)), x));
  const py = Math.max(ty + lo(blocked(map, tx, ty - 1)), Math.min(ty + hi(blocked(map, tx, ty + 1)), y));
  if (circleFree(map, px, py, r)) return { x: px, y: py };
  return { x: tx + 0.5, y: ty + 0.5 };
}

// ---------------- A* ----------------

class Heap {
  private ids: number[] = [];
  private fs: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, f: number) {
    const ids = this.ids, fs = this.fs;
    let i = ids.length;
    ids.push(id); fs.push(f);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (fs[p] < f || (fs[p] === f && ids[p] <= id)) break;
      ids[i] = ids[p]; fs[i] = fs[p]; i = p;
    }
    ids[i] = id; fs[i] = f;
  }
  pop(): number {
    const ids = this.ids, fs = this.fs;
    const top = ids[0];
    const lastId = ids.pop()!, lastF = fs.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = -1, mf = lastF, mid = lastId;
        if (l < n && (fs[l] < mf || (fs[l] === mf && ids[l] < mid))) { m = l; mf = fs[l]; mid = ids[l]; }
        if (r < n && (fs[r] < mf || (fs[r] === mf && ids[r] < mid))) { m = r; }
        if (m < 0) break;
        ids[i] = ids[m]; fs[i] = fs[m]; i = m;
      }
      ids[i] = lastId; fs[i] = lastF;
    }
    return top;
  }
}

const SQ2 = Math.SQRT2;

/** Tile-index path start → goal (inclusive), or the path to the explored tile nearest the goal point when unreachable. */
function astar(map: GridMap, start: number, goal: number, gx: number, gy: number, opts: PathOpts): { tiles: number[]; reached: boolean } {
  const w = map.w, n = map.w * map.h;
  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const goalX = goal % w, goalY = (goal / w) | 0;
  const h = (i: number) => {
    const dx = Math.abs((i % w) - goalX), dy = Math.abs(((i / w) | 0) - goalY);
    return Math.max(dx, dy) + (SQ2 - 1) * Math.min(dx, dy);
  };
  const near = (i: number) => ((i % w) + 0.5 - gx) ** 2 + (((i / w) | 0) + 0.5 - gy) ** 2;
  const open = new Heap();
  g[start] = 0;
  open.push(start, h(start));
  let best = start, bestD = near(start), bestG = 0;
  let expanded = 0;
  const budget = opts.maxNodes ?? n;
  const cost = opts.cost;
  let reached = false;
  while (open.size && expanded < budget) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    expanded++;
    const d = near(cur);
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && g[cur] < bestG)) { best = cur; bestD = d; bestG = g[cur]; }
    if (cur === goal) { reached = true; best = cur; break; }
    const cx = cur % w, cy = (cur / w) | 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = cx + ox, ny = cy + oy;
      if (blocked(map, nx, ny)) continue;
      // no corner cutting: a diagonal step needs both orthogonal neighbours open
      if (ox && oy && (blocked(map, nx, cy) || blocked(map, cx, ny))) continue;
      const ni = ny * w + nx;
      if (closed[ni]) continue;
      let step = ox && oy ? SQ2 : 1;
      if (cost && ni !== goal) {
        const c = cost(nx, ny);
        if (!(c < Infinity)) continue;
        step += Math.max(0, c);
      }
      const ng = g[cur] + step;
      if (ng < g[ni]) {
        g[ni] = ng;
        came[ni] = cur;
        open.push(ni, ng + h(ni));
      }
    }
  }
  const tiles: number[] = [];
  for (let c = best; c >= 0; c = came[c]) { tiles.push(c); if (c === start) break; }
  tiles.reverse();
  return { tiles, reached };
}

/** Does the segment only cross tiles that are free of extra cost or already on the tile path? */
function costClear(map: GridMap, a: Pt, b: Pt, cost: (tx: number, ty: number) => number, onPath: Set<number>): boolean {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(d / 0.2));
  for (let i = 0; i <= n; i++) {
    const tx = Math.floor(a.x + ((b.x - a.x) * i) / n), ty = Math.floor(a.y + ((b.y - a.y) * i) / n);
    if (!onPath.has(ty * map.w + tx) && cost(tx, ty) > 0) return false;
  }
  return true;
}

/**
 * Greedy line-of-sight string pulling: keep only the corners a body of radius r actually has to turn at. With a
 * `cost` function, shortcuts never cut through costly tiles the tile path went around.
 */
export function smoothPath(map: GridMap, pts: Pt[], r = BODY_RADIUS, cost?: (tx: number, ty: number) => number): Pt[] {
  if (pts.length <= 2) return pts.slice();
  const onPath = new Set<number>();
  if (cost) for (const p of pts) onPath.add(Math.floor(p.y) * map.w + Math.floor(p.x));
  const out: Pt[] = [pts[0]];
  let anchor = pts[0];
  for (let i = 2; i < pts.length; i++) {
    if (!lineClear(map, anchor.x, anchor.y, pts[i].x, pts[i].y, r) || (cost && !costClear(map, anchor, pts[i], cost, onPath))) {
      anchor = pts[i - 1];
      out.push(anchor);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Full pathing query from (fx, fy) to (tx, ty) in world tile coordinates. A click on a wall walks to the floor next
 * to it; a click on floor that cannot be reached walks to the reachable floor closest to the click (`reached` false).
 */
export function findPathEx(map: GridMap, fx: number, fy: number, tx: number, ty: number, opts: PathOpts = {}): PathResult {
  const r = opts.radius ?? BODY_RADIUS;
  const self = { x: fx, y: fy };
  const cx = Math.max(0, Math.min(map.w - 1e-3, tx)), cy = Math.max(0, Math.min(map.h - 1e-3, ty));
  const start = nearestFloorTile(map, fx, fy, 4);
  if (start < 0 || !(map.w > 0 && map.h > 0)) return { points: [], reached: false, goal: self };
  const goalTile = nearestFloorTile(map, cx, cy);
  if (goalTile < 0) return { points: [], reached: false, goal: self };
  let goal = pointInTile(map, goalTile, cx, cy, r);
  if (start === goalTile) {
    const near = Math.hypot(goal.x - fx, goal.y - fy) < 1e-3;
    return { points: near ? [] : [goal], reached: true, goal };
  }
  const res = astar(map, start, goalTile, cx, cy, opts);
  let reached = res.reached;
  const last = res.tiles[res.tiles.length - 1];
  if (!reached) goal = pointInTile(map, last, cx, cy, r);
  if (res.tiles.length <= 1) {
    const near = Math.hypot(goal.x - fx, goal.y - fy) < 1e-3;
    return { points: near ? [] : [goal], reached, goal };
  }
  const pts: Pt[] = res.tiles.map((i) => ({ x: (i % map.w) + 0.5, y: ((i / map.w) | 0) + 0.5 }));
  pts[0] = self;
  pts[pts.length - 1] = goal;
  const smoothed = opts.smooth === false ? pts : smoothPath(map, pts, r, opts.cost);
  return { points: smoothed.slice(1), reached, goal };
}

/**
 * Contract API (CINEMA / UI): waypoints from (fromX, fromY) to (toX, toY) in world tile coordinates, excluding the
 * start point and ending at the destination (or the nearest reachable floor to it). Empty when already there.
 */
export function findPath(map: GridMap, fromX: number, fromY: number, toX: number, toY: number, opts?: PathOpts): Pt[] {
  return findPathEx(map, fromX, fromY, toX, toY, opts).points;
}

/** Total walking length of a path from (x, y) through its waypoints. */
export function pathLength(x: number, y: number, pts: readonly Pt[]): number {
  let len = 0, px = x, py = y;
  for (const p of pts) { len += Math.hypot(p.x - px, p.y - py); px = p.x; py = p.y; }
  return len;
}
