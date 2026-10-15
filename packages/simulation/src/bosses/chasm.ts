import { RULES, SKY_FALL } from '@cursebound/content';
import { breakChain } from '../afflictions';
import { hitPlayer } from '../combat';
import { isWall, moveCircle, norm } from '../geometry';
import { B } from '../stats';
import type { EnemyState, MapState, PlayerState, SimEvent, SimState } from '../types';
import { bossName } from './kit';

// Chasms and forced movement of the scripted bosses (the Gale Wyrm's gale, the Crater Horror's gravity well). Chasm
// voids (MapState.voids) are wall tiles to every mover, so ordinary movement, knockback (knock.ts impact slides on
// foes, afflictions.ts pushPlayer shoves on heroes) and these pushes are all swept against the brink and can never
// leave anyone over the void. Only a boss push that keeps a hero pinned against the brink tips them over: the long
// fall (content SKY_FALL), heavy damage and back on solid rock, never an instant death from full health.

const VOID_SETS = new WeakMap<number[], Set<number>>();

/** Is (x, y) over a chasm tile (MapState.voids)? Ordinary walls are not chasms. */
export function isVoidAt(map: MapState, x: number, y: number): boolean {
  const list = map.voids;
  if (!list?.length) return false;
  let set = VOID_SETS.get(list);
  if (!set) { set = new Set(list); VOID_SETS.set(list, set); }
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
  return set.has(ty * map.w + tx);
}

/** Open floor near (x, y): the point itself on floor, else the closest floor tile centre within `reach` rings (by
 *  distance, unlike map.ts nearestFloor's first-found scan). */
export function closestFloor(map: MapState, x: number, y: number, reach = 6): [number, number] {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (!isWall(map, tx, ty)) return [x, y];
  for (let r = 1; r <= reach; r++) {
    let best: [number, number] | null = null, bd = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || isWall(map, tx + dx, ty + dy)) continue;
      const cx = tx + dx + 0.5, cy = ty + dy + 0.5, d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bd) { bd = d; best = [cx, cy]; }
    }
    if (best) return best;
  }
  return [x, y];
}

/** The nearest floor tile to (x, y) with no chasm within `margin` tiles (solid rock to stand on). */
export function solidGround(map: MapState, x: number, y: number, margin: number): [number, number] {
  const tx = Math.floor(x), ty = Math.floor(y);
  const ok = (cx: number, cy: number) => {
    if (isWall(map, cx, cy)) return false;
    for (let dy = -margin; dy <= margin; dy++) for (let dx = -margin; dx <= margin; dx++) if (isVoidAt(map, cx + dx + 0.5, cy + dy + 0.5)) return false;
    return true;
  };
  for (let r = 0; r <= 16; r++) {
    let best: [number, number] | null = null, bd = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !ok(tx + dx, ty + dy)) continue;
      const cx = tx + dx + 0.5, cy = ty + dy + 0.5, d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bd) { bd = d; best = [cx, cy]; }
    }
    if (best) return best;
  }
  const s = map.bossSpawn ?? map.playerSpawns[0] ?? { x, y };
  return closestFloor(map, s.x, s.y);
}

/**
 * The long fall: a hero pushed over the brink drops out of sight and is set back on solid rock nearby, taking
 * SKY_FALL.healthFrac of their maximum health (it can down a wounded hero, never kills outright from full health) with
 * a moment of invulnerability. Chains break. Events: foe_fx 'void_fall' (where they fell, where they land) and a
 * 'teleport' (style 'skyfall') so prediction snaps.
 */
export function voidFall(state: SimState, ev: SimEvent[], p: PlayerState, e: EnemyState) {
  const map = state.map!;
  const fx = p.x, fy = p.y;
  const [sx, sy] = solidGround(map, fx, fy, SKY_FALL.safeRadius);
  breakChain(state, ev, p);
  p.x = sx; p.y = sy; p.vx = 0; p.vy = 0; p.dodgeTimer = 0;
  ev.push({ t: 'foe_fx', id: e.id, fx: 'void_fall', x: fx, y: fy, tx: sx, ty: sy });
  ev.push({ t: 'teleport', slot: p.slot, fx, fy, x: sx, y: sy, style: 'skyfall' });
  hitPlayer(state, ev, p, p.maxHp.mul(B(SKY_FALL.healthFrac)), { attack: 'The Long Fall', source: bossName(e), fromX: sx, fromY: sy, dtype: 'physical', hazard: true, srcId: e.id });
  p.iframes = Math.max(p.iframes, SKY_FALL.iframes);
}

/**
 * Forced movement of a hero by (mx, my) world units this tick (gales, gravity wells). Walls stop it (sliding). Pressed
 * against the brink of a chasm, the push that cannot move the hero builds up (PlayerState.vars 'bk.grip', reset the
 * moment they are not pinned); once it passes SKY_FALL.grip world units the hero goes over: the long fall. So a hero
 * pinned at the edge tips over after a beat, while one walking into the wind (or knocked against the edge by anything
 * else) never does. Returns true when the hero fell.
 */
export function pushHero(state: SimState, ev: SimEvent[], p: PlayerState, mx: number, my: number, e: EnemyState): boolean {
  const map = state.map;
  if (!map || p.lifeState !== 'alive' || (mx === 0 && my === 0)) return false;
  const [ux, uy] = norm(mx, my);
  const r = moveCircle(map, p.x, p.y, mx, my, RULES.playerRadius);
  const lost = Math.hypot(mx, my) - Math.hypot(r.x - p.x, r.y - p.y);
  p.x = r.x; p.y = r.y;
  const edge = RULES.playerRadius + 0.05;
  const pinned = lost > 1e-6 && isVoidAt(map, p.x + ux * edge, p.y + uy * edge);
  const prev = p.vars['bk.gripT'] === state.tick - 1 ? p.vars['bk.grip'] ?? 0 : 0;
  if (!pinned) { delete p.vars['bk.grip']; delete p.vars['bk.gripT']; return false; }
  const grip = prev + lost;
  if (grip < SKY_FALL.grip) { p.vars['bk.grip'] = grip; p.vars['bk.gripT'] = state.tick; return false; }
  delete p.vars['bk.grip']; delete p.vars['bk.gripT'];
  voidFall(state, ev, p, e);
  return true;
}
