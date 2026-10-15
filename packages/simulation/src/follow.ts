import { RULES, TICK_SEC } from '@cursebound/content';
import { isWall, lineOfSight, moveCircle } from './geometry';
import { findPath, tileCenter } from './map';
import type { Hazard, MapState, PlayerState, SimEvent, SimState } from './types';

// Follower routing for hero-owned summons and pets that walk the ground (Warden spirit beasts, Hexbinder wraiths).
// Flying pets (Ranger hawks) and attached ones (Artificer drones, turrets) do not use it.
//
//  - Direct line: a body-wide lane (centre ray + both edge rays) to the goal -> walk straight at it.
//  - Otherwise path-follow a grid A* route (map.findPath; chasm voids are wall tiles to the sim), skipping waypoints
//    the body can already see past. Re-pathing is throttled (RULES.followRepathTicks) and only happens when the goal
//    tile changed or the route ran out; search size and route length are capped (FOLLOW_NODES, followMaxPathTiles).
//  - Stuck detection: over each RULES.followStuckTicks window the follower must either move or get closer to a goal
//    that held still. A stalled window is a strike: the first forces a fresh route, the second counts as stuck.
//  - Leash (owner following): beyond RULES.followBlinkRange of the owner, when no route exists, when the only route
//    is a long detour (around a chasm), or when stuck, the follower blinks to its formation slot at the owner's side
//    (slid out from the owner, so never across a wall or gap) and a 'summon_blink' event lets the client show a small
//    spirit dissolve / reform.
//  - Spread: followers of one owner push apart softly so the pack never stacks into one body.
//
// Deterministic (state and arguments only, no rng). Per-follower counters live in h.vars ('f_' prefix, plain finite
// numbers) and the route in h.route, both serialized with the state.

const DT = TICK_SEC;
/** A* expansion budget for one follower route (map.findPath maxNodes). */
const FOLLOW_NODES = 500;
/** A route longer than DETOUR x the straight distance + DETOUR_SLACK tiles is a long way round (behind a gap). */
const DETOUR = 3;
const DETOUR_SLACK = 12;
/** Window progress: move this far, or get this much closer to a goal that moved less than GOAL_DRIFT. */
const MOVE_EPS = 0.4;
const GAIN_EPS = 0.25;
const GOAL_DRIFT = 1.5;
/** Ticks between two blinks of one follower (a blink never chains into another). */
const BLINK_GAP = 30;

export type RouteResult = 'direct' | 'path' | 'fail';

const dist = (ax: number, ay: number, bx: number, by: number) => Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
const tileOf = (map: MapState, x: number, y: number) => Math.floor(y) * map.w + Math.floor(x);
const vars = (h: Hazard) => (h.vars ??= {});

/** Straight lane wide enough for a body of radius r: the centre ray and both edge rays reach the goal. */
export function clearLane(map: MapState, x0: number, y0: number, x1: number, y1: number, r: number): boolean {
  if (!lineOfSight(map, x0, y0, x1, y1)) return false;
  const dx = x1 - x0, dy = y1 - y0;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-6 || r <= 0) return true;
  const ox = (-dy / d) * r, oy = (dx / d) * r;
  return lineOfSight(map, x0 + ox, y0 + oy, x1 + ox, y1 + oy) && lineOfSight(map, x0 - ox, y0 - oy, x1 - ox, y1 - oy);
}

/** Drop the route and progress counters (after a blink, or when a new goal makes them meaningless). */
export function resetRoute(h: Hazard) {
  delete h.route;
  const v = vars(h);
  delete v.f_rt; delete v.f_gt; delete v.f_ax; delete v.f_ay; delete v.f_gx; delete v.f_gy; delete v.f_bt; delete v.f_st; delete v.f_rl;
}

/**
 * Move a follower at most `maxStep` toward (tx, ty): straight when the lane is clear, else along a throttled A*
 * route. 'fail' = no route within the caps (unreachable, too long, or a long detour around a gap); the follower did
 * not move and the caller decides (blink back, or drop the target).
 */
export function routeStep(state: SimState, h: Hazard, tx: number, ty: number, maxStep: number, body: number): RouteResult {
  const map = state.map;
  if (!map || maxStep <= 0) return 'direct';
  const v = vars(h);
  let wx = tx, wy = ty;
  let res: RouteResult = 'direct';
  if (clearLane(map, h.x, h.y, tx, ty, body * 0.9)) {
    if (h.route) delete h.route;
  } else {
    const goal = tileOf(map, tx, ty);
    const age = state.tick - (v.f_rt ?? -1e9);
    if ((!h.route?.length || v.f_gt !== goal) && age >= RULES.followRepathTicks) {
      v.f_rt = state.tick; v.f_gt = goal;
      const path = findPath(map, h.x, h.y, tx, ty, FOLLOW_NODES);
      const straight = dist(h.x, h.y, tx, ty);
      if (!path.length || path.length > RULES.followMaxPathTiles || path.length > DETOUR * straight + DETOUR_SLACK) {
        delete h.route;
        return 'fail';
      }
      h.route = path;
    }
    const route = h.route;
    if (route?.length) {
      // skip waypoints the body can already see past; drop the one we stand on
      while (route.length > 1) {
        const [nx, ny] = tileCenter(map, route[1]);
        if (clearLane(map, h.x, h.y, nx, ny, body * 0.9)) route.shift(); else break;
      }
      if (route.length > 1) {
        [wx, wy] = tileCenter(map, route[0]);
        if (dist(h.x, h.y, wx, wy) < 0.12) { route.shift(); [wx, wy] = tileCenter(map, route[0]); }
      }
      res = 'path';
    }
    // no route yet (throttled): slide straight at the goal until the next re-path
  }
  const d = dist(h.x, h.y, wx, wy);
  if (d > 1e-4) {
    const step = Math.min(d, maxStep);
    const r = moveCircle(map, h.x, h.y, ((wx - h.x) / d) * step, ((wy - h.y) / d) * step, body);
    h.x = r.x; h.y = r.y;
  }
  return res;
}

/**
 * Stuck detection, called once per tick while the follower is trying to reach (gx, gy) and is `d` from it.
 * Returns the strike count after this tick: 0 while it makes progress, 1 after a stalled window (the route is
 * dropped so the next step re-paths at once), 2+ when it is still stuck after that.
 */
export function trackStuck(state: SimState, h: Hazard, gx: number, gy: number, d: number): number {
  const v = vars(h);
  const rl = h.route?.length ?? 0;
  if (v.f_bt === undefined) {
    v.f_bt = state.tick; v.f_ax = h.x; v.f_ay = h.y; v.f_gx = gx; v.f_gy = gy; v.f_rl = rl;
    return v.f_st ?? 0;
  }
  if (state.tick - v.f_bt < RULES.followStuckTicks) return v.f_st ?? 0;
  const moved = dist(h.x, h.y, v.f_ax ?? h.x, v.f_ay ?? h.y);
  const goalHeld = dist(gx, gy, v.f_gx ?? gx, v.f_gy ?? gy) < GOAL_DRIFT;
  const startD = dist(v.f_ax ?? h.x, v.f_ay ?? h.y, v.f_gx ?? gx, v.f_gy ?? gy);
  // progress toward a goal that held still: closer in a straight line, or (on a detour, which may lead away from
  // the goal for a while) waypoints of the route consumed
  const gained = startD - d >= GAIN_EPS || (rl > 0 && rl < (v.f_rl ?? 0));
  const stalled = moved < MOVE_EPS || (goalHeld && !gained);
  v.f_st = stalled ? (v.f_st ?? 0) + 1 : 0;
  if (stalled) { delete h.route; delete v.f_rt; }
  v.f_bt = state.tick; v.f_ax = h.x; v.f_ay = h.y; v.f_gx = gx; v.f_gy = gy; v.f_rl = h.route?.length ?? 0;
  return v.f_st;
}

/** The follower reached its goal (or stopped trying): clear the stuck window. */
export function arrived(h: Hazard) {
  const v = h.vars;
  if (!v || v.f_bt === undefined) return;
  delete v.f_bt; delete v.f_st; delete v.f_ax; delete v.f_ay; delete v.f_gx; delete v.f_gy; delete v.f_rl;
}

/** A formation point at offset (ox, oy) from the owner that is reachable from the owner: slid out from the owner's
 *  position when the straight offset would cross a wall or a chasm. */
export function ownerSlot(state: SimState, p: PlayerState, ox: number, oy: number, body: number): [number, number] {
  return reachableFrom(state, p.x, p.y, ox, oy, body);
}

/** The point (x + ox, y + oy) if a body can stand there in a straight line from (x, y), else the point a body slid
 *  from (x, y) along the offset reaches (same side of every wall and gap as (x, y)). */
export function reachableFrom(state: SimState, x: number, y: number, ox: number, oy: number, body: number): [number, number] {
  const map = state.map;
  if (!map) return [x + ox, y + oy];
  if (clearLane(map, x, y, x + ox, y + oy, body) && !overlapsWall(map, x + ox, y + oy, body)) return [x + ox, y + oy];
  const r = moveCircle(map, x, y, ox, oy, body);
  return [r.x, r.y];
}

/** Does a circle at (x, y) overlap any wall / void tile? */
function overlapsWall(map: MapState, x: number, y: number, r: number): boolean {
  for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++) {
    for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
      if (!isWall(map, tx, ty)) continue;
      const cx = Math.max(tx, Math.min(x, tx + 1)), cy = Math.max(ty, Math.min(y, ty + 1));
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
    }
  }
  return false;
}

/** Blink the follower to (x, y) beside its owner (from ownerSlot) with a 'summon_blink' event. */
export function blinkTo(state: SimState, ev: SimEvent[], h: Hazard, p: PlayerState, x: number, y: number) {
  ev.push({ t: 'summon_blink', slot: p.slot, id: h.id, kind: h.kind, fx: h.x, fy: h.y, x, y });
  h.x = x; h.y = y;
  resetRoute(h);
  vars(h).f_bk = state.tick;
}

/** True when the follower is past the leash range of its owner. */
export function beyondLeash(h: Hazard, p: PlayerState): boolean {
  return (h.x - p.x) ** 2 + (h.y - p.y) ** 2 > RULES.followBlinkRange * RULES.followBlinkRange;
}

/**
 * One tick of following the owner to the formation slot (sx, sy) (from ownerSlot) at `speed` u/s. Walks or routes
 * there; blinks to the slot when beyond the leash, when no acceptable route exists, or when stuck. Returns true if
 * it blinked this tick.
 */
export function followStep(state: SimState, ev: SimEvent[], h: Hazard, p: PlayerState, sx: number, sy: number, speed: number, body: number, arrive = 0.25): boolean {
  const v = vars(h);
  const canBlink = state.tick - (v.f_bk ?? -1e9) >= BLINK_GAP;
  if (beyondLeash(h, p) && canBlink) { blinkTo(state, ev, h, p, sx, sy); return true; }
  const d = dist(h.x, h.y, sx, sy);
  if (d <= arrive) { arrived(h); return false; }
  const res = routeStep(state, h, sx, sy, speed * DT, body);
  if (res === 'fail' && canBlink) { blinkTo(state, ev, h, p, sx, sy); return true; }
  const strikes = trackStuck(state, h, sx, sy, dist(h.x, h.y, sx, sy));
  if (strikes >= 2 && canBlink) { blinkTo(state, ev, h, p, sx, sy); return true; }
  return false;
}

/** Soft separation: push `h` out of overlapping peers (same owner's followers), wall-safe, at most `maxPush` per tick. */
export function spreadFrom(state: SimState, h: Hazard, body: number, peers: readonly Hazard[], peerBody: (o: Hazard) => number, maxPush = 0.05) {
  const map = state.map;
  if (!map) return;
  let px = 0, py = 0;
  for (const o of peers) {
    if (o === h || o.untilTick <= state.tick) continue;
    const want = (body + peerBody(o)) * 0.85;
    const dx = h.x - o.x, dy = h.y - o.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= want * want) continue;
    const d = Math.sqrt(d2);
    if (d > 1e-6) { px += (dx / d) * (want - d) * 0.5; py += (dy / d) * (want - d) * 0.5; }
    else { const s = h.id < o.id ? -1 : 1; px += s * want * 0.5; }   // exactly stacked: split along x by id
  }
  const l = Math.sqrt(px * px + py * py);
  if (l < 1e-4) return;
  const k = Math.min(1, maxPush / l);
  const r = moveCircle(map, h.x, h.y, px * k, py * k, body);
  h.x = r.x; h.y = r.y;
}
