import { Big } from '@cursebound/numeric';
import { contentHash } from '@cursebound/content';
import {
  ACTION, cohortTotalHp, createRun, devSpawn, rayDistance, step,
  type Command, type EnemyState, type PlayerInput, type SimEvent, type SimState,
} from '@cursebound/simulation';

// Scripted combat harness for the Cryomancer / Ranger kit tests (own copy so other kits can evolve theirs): a solo run with the given nodes allocated,
// advanced into COMBAT, with the encounter isolated so only test-spawned enemies are near the player.

export { ACTION };

export interface Arena { s: SimState; dir: [number, number]; seq: number; events: SimEvent[] }

export function arena(classId: string, nodes: string[], seed = 'KIT_TEST'): Arena {
  const s = createRun({
    runId: 'run_' + seed, seed, mode: 'solo', trust: 'local', contentHash: contentHash(),
    roster: [{ slot: 0, profileId: 'p0', name: 'P0', classId }],
  });
  s.players[0].skillPoints = 99;
  const cmds: Command[] = nodes.map((nodeId) => ({ type: 'ALLOCATE', slot: 0, nodeId }));
  const r = step(s, [], cmds);
  const bad = r.outcomes.filter((o) => !o.ok);
  if (bad.length) throw new Error('allocation failed: ' + JSON.stringify(bad));
  step(s, [], [{ type: 'READY', slot: 0, ready: true }]);
  for (let i = 0; i < 600 && s.phase !== 'COMBAT'; i++) step(s, []);
  if (s.phase !== 'COMBAT') throw new Error('never reached combat');
  isolate(s);
  const p = s.players[0];
  openFloor(s, p.x, p.y, 10);
  p.iframes = 1e6;
  // the most open of 8 directions from the player
  let best: [number, number] = [1, 0]; let bd = -1;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const dx = Math.round(Math.cos(a) * 1e6) / 1e6, dy = Math.round(Math.sin(a) * 1e6) / 1e6;
    const d = rayDistance(s.map!, p.x, p.y, dx, dy, 12);
    if (d > bd + 1e-9) { bd = d; best = [dx, dy]; }
  }
  return { s, dir: best, seq: 1, events: [] };
}

/** Carve open floor (map border kept) so spatial assertions do not depend on the generated layout. */
function openFloor(s: SimState, cx: number, cy: number, r: number) {
  const map = s.map!;
  for (let y = 1; y < map.h - 1; y++) for (let x = 1; x < map.w - 1; x++) {
    if (Math.abs(x + 0.5 - cx) <= r && Math.abs(y + 0.5 - cy) <= r) map.tiles[y * map.w + x] = 0;
  }
}

/** Keep one objective enemy frozen at the far end of the map (so the round never clears); drop the rest. */
function isolate(s: SimState) {
  const p = s.players[0];
  const map = s.map!;
  let fx = p.x, fy = p.y, fd = -1;
  for (let i = 0; i < map.tiles.length; i++) {
    if (map.tiles[i] !== 0) continue;
    const x = (i % map.w) + 0.5, y = Math.floor(i / map.w) + 0.5;
    const d = (x - p.x) ** 2 + (y - p.y) ** 2;
    if (d > fd) { fd = d; fx = x; fy = y; }
  }
  const keeper = s.enemies.find((e) => e.objective && !e.boss) ?? s.enemies[0];
  s.enemies = keeper ? [keeper] : [];
  if (keeper) { keeper.x = fx; keeper.y = fy; keeper.staggerUntil = 1e12; keeper.attack = null; }
  s.pendingSpawns = []; s.projectiles = []; s.hazards = []; s.telegraphs = [];
  const enc = s.encounter!;
  enc.waveCount = enc.wave + 1;
}

/** Spawn a frozen (stunned) test enemy `dist` units along the arena direction, rotated by `deg`. */
export function spawnAt(a: Arena, kind: string, dist: number, deg = 0, count = 1, frozen = true): EnemyState {
  const p = a.s.players[0];
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), sn = Math.sin(r);
  const dx = a.dir[0] * c - a.dir[1] * sn, dy = a.dir[0] * sn + a.dir[1] * c;
  const e = devSpawn(a.s, kind, p.x + dx * dist, p.y + dy * dist, Big.from(count));
  e.fx = dx; e.fy = dy;            // facing away from the player
  if (frozen) e.staggerUntil = 1e12;
  return e;
}

export function input(a: Arena, buttons: number, aim?: [number, number]): PlayerInput {
  const p = a.s.players[0];
  const [ax, ay] = aim ?? [a.dir[0] * 3, a.dir[1] * 3];
  void p;
  return { seq: a.seq++, moveX: 0, moveY: 0, aimX: ax, aimY: ay, buttons };
}

/** Advance `ticks` ticks holding `buttons` for the first `holdTicks` (default: all) ticks. */
export function run(a: Arena, ticks: number, buttons = 0, holdTicks = ticks, aim?: [number, number]) {
  for (let i = 0; i < ticks; i++) {
    a.s.players[0].iframes = Math.max(a.s.players[0].iframes, 1e6);
    const r = step(a.s, [input(a, i < holdTicks ? buttons : 0, aim)]);
    a.events.push(...r.events);
  }
}

export function casts(a: Arena, skill: string) {
  return a.events.filter((e) => e.t === 'cast' && e.skill === skill) as Extract<SimEvent, { t: 'cast' }>[];
}

export function hp(e: EnemyState): Big {
  return cohortTotalHp(e.cohort);
}

/** True once the enemy has lost health (or died) relative to its full health. */
export function damaged(e: EnemyState) {
  return e.cohort.count.isZero() || !e.cohort.front.isZero() || !e.cohort.spread.isZero();
}

export function aimAt(a: Arena, e: EnemyState): [number, number] {
  const p = a.s.players[0];
  return [e.x - p.x, e.y - p.y];
}
