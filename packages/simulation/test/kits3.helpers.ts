import { Big } from '@cursebound/numeric';
import { NODE_BY_ID, contentHash } from '@cursebound/content';
import {
  ACTION, cohortTotalHp, createRun, devSpawn, rayDistance, step,
  type Command, type EnemyState, type PlayerInput, type SimEvent, type SimState,
} from '@cursebound/simulation';

// Scripted combat harness for the Hexbinder / Vanguard / Arcanist kit tests: a solo (or co-op) run with nodes
// allocated through real ALLOCATE commands (tiers, prerequisites and exclusions enforced), advanced into COMBAT with
// the encounter isolated so only test-spawned enemies are near the player.

export { ACTION };

export interface Kit { s: SimState; dir: [number, number]; seq: number; events: SimEvent[] }

export function kit(classId: string, nodes: string[], seed = 'KIT3_TEST', extraClasses: string[] = []): Kit {
  const roster = [classId, ...extraClasses].map((c, i) => ({ slot: i, profileId: 'p' + i, name: 'P' + i, classId: c }));
  const s = createRun({ runId: 'run_' + seed, seed, mode: roster.length > 1 ? 'coop' : 'solo', trust: 'local', contentHash: contentHash(), roster });
  s.players[0].skillPoints = 99;
  const r = step(s, [], nodes.filter((id) => !NODE_BY_ID[id]?.starting).map((nodeId): Command => ({ type: 'ALLOCATE', slot: 0, nodeId })));   // base skills are starting grants
  const bad = r.outcomes.filter((o) => !o.ok);
  if (bad.length) throw new Error('allocation failed: ' + JSON.stringify(bad));
  step(s, [], s.players.map((p): Command => ({ type: 'READY', slot: p.slot, ready: true })));
  for (let i = 0; i < 600 && s.phase !== 'COMBAT'; i++) step(s, []);
  if (s.phase !== 'COMBAT') throw new Error('never reached combat');
  isolate(s);
  const p = s.players[0];
  let best: [number, number] = [1, 0]; let bd = -1;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const dx = Math.round(Math.cos(a) * 1e6) / 1e6, dy = Math.round(Math.sin(a) * 1e6) / 1e6;
    const d = rayDistance(s.map!, p.x, p.y, dx, dy, 12);
    if (d > bd + 1e-9) { bd = d; best = [dx, dy]; }
  }
  for (const a of s.players) { a.x = p.x; a.y = p.y; }
  return { s, dir: best, seq: 1, events: [] };
}

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
  if (keeper) { keeper.x = fx; keeper.y = fy; keeper.staggerUntil = 1e12; keeper.attack = null; keeper.cohort.unitHp = Big.from('1e30'); }
  s.pendingSpawns = []; s.projectiles = []; s.hazards = []; s.telegraphs = [];
  s.encounter!.waveCount = s.encounter!.wave + 1;
}

/** Spawn a frozen test enemy `dist` units along the open direction, rotated by `deg`; `hpMul` scales unit health. */
export function spawn(k: Kit, kind: string, dist: number, deg = 0, hpMul = '1', count = 1): EnemyState {
  const p = k.s.players[0];
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), sn = Math.sin(r);
  const dx = k.dir[0] * c - k.dir[1] * sn, dy = k.dir[0] * sn + k.dir[1] * c;
  const e = devSpawn(k.s, kind, p.x + dx * dist, p.y + dy * dist, Big.from(count));
  e.cohort.unitHp = e.cohort.unitHp.mul(Big.from(hpMul));
  e.fx = -dx; e.fy = -dy;
  e.staggerUntil = 1e12;
  return e;
}

export function aimAt(k: Kit, e: { x: number; y: number }): [number, number] {
  const p = k.s.players[0];
  return [e.x - p.x, e.y - p.y];
}

/** Advance `ticks` ticks pressing `buttons` on the first `hold` ticks; players stay untouchable unless `vulnerable`. */
export function run(k: Kit, ticks: number, buttons = 0, hold = 1, aim?: [number, number], vulnerable = false) {
  for (let i = 0; i < ticks; i++) {
    if (!vulnerable) for (const a of k.s.players) a.iframes = Math.max(a.iframes, 1e6);
    const [ax, ay] = aim ?? [k.dir[0] * 3, k.dir[1] * 3];
    const inp: PlayerInput = { seq: k.seq++, moveX: 0, moveY: 0, aimX: ax, aimY: ay, buttons: i < hold ? buttons : 0 };
    const r = step(k.s, [inp, ...k.s.players.slice(1).map(() => null)]);
    k.events.push(...r.events);
  }
}

export function casts(k: Kit, skill: string) {
  return k.events.filter((e) => e.t === 'cast' && e.skill === skill) as Extract<SimEvent, { t: 'cast' }>[];
}

export const hp = (e: EnemyState): Big => cohortTotalHp(e.cohort);
export const damaged = (e: EnemyState) => e.cohort.count.isZero() || !e.cohort.front.isZero() || !e.cohort.spread.isZero();
export const dead = (e: EnemyState) => e.cohort.count.isZero() || e.state === 'dying';
export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
