import { RULES, TICK_RATE, TICK_SEC, isBossRound } from '@cursebound/content';
import { dir8, isWall } from './geometry';
import { moveSpeedOf, predictMoveTick } from './players';
import { playerDerived, toFloatClamped } from './stats';
import { ACTION, type DoorState, type DoorsState, type MapState, type PlayerInput, type PlayerState, type SimEvent, type SimState } from './types';

// In-world Fate vote (replaces the full-screen card vote; the PRD rules for cards, votes, ties and the exactly-once
// commit are unchanged). When VOTING starts, three themed doors are set into one visible stretch of wall of the
// cleared floor. Door i binds card i and leads to offer.themes[i]. Heroes walk (and dodge) but never attack or cast.
//   - a hero within RULES.doorVoteRadius of a door's front point stands in it;
//   - solo: standing in one door for doorSoloHoldSec commits; co-op: every living, connected hero in the SAME door
//     for doorCoopHoldSec commits (not while a dropped seat is still inside its reconnect grace, like early locks);
//   - otherwise the existing rules resolve (all locked / deadline). A hero's vote is the door they stand in, else
//     their latest explicit VOTE (explicit votes keep working for bots, tests and the "Choose" button).
// Placement is a pure function of the map, the heroes' positions, the round and map.decorSeed (no RNG draw), so it
// is identical on replay and after checkpoint restore.

const DT = TICK_SEC;

/** Snapshot entry for a door (contract fields + presentation extras). */
export interface SnapDoor {
  i: 0 | 1 | 2; x: number; y: number; nx: number; ny: number; th: string; c: string;
  /** player slots standing in this door */
  v: number[];
  /** commit progress 0..1 (the filling ring); 1 on the chosen door during FATE_COMMIT */
  hold: number;
  /** the door leads to a boss lair */
  b?: 1;
  /** the committed door (FATE_COMMIT) */
  sel?: 1;
}

// ---------------- placement ----------------

/** Wall faces the 2:1 camera sees: a door's normal points into the room +y (the wall's south face, screen lower-left)
 *  or +x (east face, screen lower-right). North and west faces are cut down to stubs by the renderer. */
const FACES: readonly { nx: number; ny: number }[] = [{ nx: 0, ny: 1 }, { nx: 1, ny: 0 }];

interface Slot { fx: number; fy: number; nx: number; ny: number; d: number; key: number }

function tileHash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Can a door stand on the wall face behind floor tile (fx, fy) facing (nx, ny)? The door wall and its two neighbours
 * along the face are walls; the 3 tiles in front (and, strictly, the row after them) are floor, so nothing stands in
 * the opening and no later-drawn block covers it; strictly, the wall is also backed by rock (never a free-standing
 * block or a one-tile partition seen from behind).
 */
export function doorSlotOk(map: MapState, fx: number, fy: number, nx: number, ny: number, strict: boolean): boolean {
  const tx = ny, ty = nx;                 // along the face
  const wx = fx - nx, wy = fy - ny;       // the door's wall tile
  if (wx < 0 || wy < 0) return false;
  const chasm = voidSet(map);
  for (let k = -1; k <= 1; k++) {
    if (!isWall(map, wx + tx * k, wy + ty * k)) return false;
    if (chasm && chasm.has((wy + ty * k) * map.w + wx + tx * k)) return false;   // no door hangs over the void
    if (isWall(map, fx + tx * k, fy + ty * k)) return false;
    if (strict) {
      if (isWall(map, fx + nx + tx * k, fy + ny + ty * k)) return false;
      if (!isWall(map, wx - nx + tx * k, wy - ny + ty * k)) return false;
    }
  }
  return !isWall(map, fx + nx, fy + ny);  // an approach tile
}

const voidCache = new WeakMap<number[], Set<number>>();
/** Chasm tiles of the map (mapgen voids) as a set, cached per map. */
function voidSet(map: MapState): Set<number> | null {
  if (!map.voids?.length) return null;
  let s = voidCache.get(map.voids);
  if (!s) voidCache.set(map.voids, (s = new Set(map.voids)));
  return s;
}

function bfs(map: MapState, sx: number, sy: number): Int32Array {
  const d = new Int32Array(map.w * map.h).fill(-1);
  if (isWall(map, sx, sy)) return d;
  const q = [sy * map.w + sx];
  d[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h], x = c % map.w, y = (c / map.w) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (isWall(map, nx, ny)) continue;
      const n = ny * map.w + nx;
      if (d[n] < 0) { d[n] = d[c] + 1; q.push(n); }
    }
  }
  return d;
}

function heroesOf(state: SimState): PlayerState[] {
  const alive = state.players.filter((p) => p.lifeState === 'alive');
  return alive.length ? alive : state.players;
}

/** Mean path distance from the heroes to each floor tile (-1 where any hero cannot reach). */
function partyDistance(map: MapState, heroes: PlayerState[]): Int32Array {
  const maps = heroes.map((p) => bfs(map, Math.floor(p.x), Math.floor(p.y)));
  const out = new Int32Array(map.w * map.h).fill(-1);
  for (let i = 0; i < out.length; i++) {
    let s = 0, ok = maps.length > 0;
    for (const m of maps) { if (m[i] < 0) { ok = false; break; } s += m[i]; }
    if (ok) out[i] = Math.round(s / maps.length);
  }
  return out;
}

function slotsFor(map: MapState, dist: Int32Array, strict: boolean): Slot[] {
  const out: Slot[] = [];
  for (let fy = 1; fy < map.h - 1; fy++) for (let fx = 1; fx < map.w - 1; fx++) {
    const d = dist[fy * map.w + fx];
    if (d < 0) continue;
    for (const f of FACES) if (doorSlotOk(map, fx, fy, f.nx, f.ny, strict)) out.push({ fx, fy, nx: f.nx, ny: f.ny, d, key: fy * map.w + fx });
  }
  return out;
}

/** Lower is better: a short walk (doorPathMin..doorPathMax), even spacing, nobody already standing in a door. */
function score(set: Slot[], heroes: PlayerState[], seed: number, spacing: boolean): number {
  const dm = set.reduce((s, x) => s + x.d, 0) / set.length;
  let sc = 0;
  if (dm < RULES.doorPathMin) sc += (RULES.doorPathMin - dm) * 4;
  if (dm > RULES.doorPathMax) sc += (dm - RULES.doorPathMax) * 2;
  sc += Math.abs(dm - (RULES.doorPathMin + RULES.doorPathMax) / 2) * 0.25;
  if (spacing) for (let k = 1; k < set.length; k++) sc += Math.abs(Math.abs(set[k].fx - set[k - 1].fx) + Math.abs(set[k].fy - set[k - 1].fy) - 4) * 0.4;
  const clear = RULES.doorVoteRadius + 1.8;
  for (const s of set) for (const p of heroes) if ((p.x - s.fx - 0.5) ** 2 + (p.y - s.fy - 0.5) ** 2 < clear * clear) sc += 100;
  for (const s of set) sc += tileHash(s.fx, s.fy, seed) * 0.05;
  return sc;
}

interface Pick { set: Slot[]; score: number }

/** Best three slots along one straight stretch of wall (same row/column, same facing, contiguous run). */
function bestOnStretch(slots: Slot[], heroes: PlayerState[], seed: number): Pick | null {
  const lines = new Map<string, Slot[]>();
  for (const s of slots) {
    const k = `${s.nx},${s.ny},${s.ny ? s.fy : s.fx}`;
    let l = lines.get(k);
    if (!l) lines.set(k, (l = []));
    l.push(s);
  }
  let best: Slot[] | null = null, bestScore = Infinity;
  for (const l of [...lines.keys()].sort().map((k) => lines.get(k)!)) {
    const along = (s: Slot) => (s.ny ? s.fx : s.fy);
    l.sort((a, b) => along(a) - along(b));
    for (let a = 0; a < l.length; a++) for (let b = a + 1; b < l.length; b++) {
      const s1 = along(l[b]) - along(l[a]);
      if (s1 > RULES.doorSpacingMax) break;
      if (s1 < RULES.doorSpacingMin || !contiguous(l, a, b, along)) continue;
      for (let c = b + 1; c < l.length; c++) {
        const s2 = along(l[c]) - along(l[b]);
        if (s2 > RULES.doorSpacingMax) break;
        if (s2 < RULES.doorSpacingMin || !contiguous(l, b, c, along)) continue;
        const set = [l[a], l[b], l[c]];
        const sc = score(set, heroes, seed, true);
        if (sc < bestScore) { bestScore = sc; best = set; }
      }
    }
  }
  return best ? { set: best, score: bestScore } : null;
}

/** No gap in the wall between slots i and j of a sorted line (every tile between is a valid slot too). */
function contiguous(l: Slot[], i: number, j: number, along: (s: Slot) => number): boolean {
  return along(l[j]) - along(l[i]) === j - i;
}

/** Three slots of one room that need not share a stretch (corner thresholds), still 3+ tiles apart. */
function bestInRoom(slots: Slot[], heroes: PlayerState[], seed: number, minGap: number): Pick | null {
  const pool = slots.slice().sort((a, b) => score([a], heroes, seed, false) - score([b], heroes, seed, false) || a.key - b.key).slice(0, 60);
  const cheb = (a: Slot, b: Slot) => Math.max(Math.abs(a.fx - b.fx), Math.abs(a.fy - b.fy));
  const near = (a: Slot, b: Slot) => cheb(a, b) >= minGap && cheb(a, b) <= RULES.doorSpacingMax + 3 && Math.abs(a.d - b.d) <= 8;
  let best: Slot[] | null = null, bestScore = Infinity;
  for (let a = 0; a < pool.length; a++) for (let b = a + 1; b < pool.length; b++) {
    if (!near(pool[a], pool[b])) continue;
    for (let c = b + 1; c < pool.length; c++) {
      if (!near(pool[a], pool[c]) || !near(pool[b], pool[c])) continue;
      const set = [pool[a], pool[b], pool[c]];
      const sc = score(set, heroes, seed, false);
      if (sc < bestScore) { bestScore = sc; best = set; }
    }
  }
  return best ? { set: best, score: bestScore } : null;
}

/** Last resort (tiny or broken maps): free-standing portals on reachable floor, greedily spaced. */
function freePortals(map: MapState, dist: Int32Array, heroes: PlayerState[], seed: number): Slot[] {
  const floor: Slot[] = [];
  for (let fy = 1; fy < map.h - 1; fy++) for (let fx = 1; fx < map.w - 1; fx++) {
    const d = dist[fy * map.w + fx];
    if (d >= 0) floor.push({ fx, fy, nx: 0, ny: 1, d, key: fy * map.w + fx });
  }
  floor.sort((a, b) => score([a], heroes, seed, false) - score([b], heroes, seed, false) || a.key - b.key);
  for (const gap of [3, 2, 1, 0]) {
    const out: Slot[] = [];
    for (const s of floor) {
      if (out.every((o) => Math.max(Math.abs(o.fx - s.fx), Math.abs(o.fy - s.fy)) >= gap)) out.push(s);
      if (out.length === 3) return out;
    }
  }
  const any = floor[0] ?? { fx: Math.floor(heroes[0]?.x ?? 1), fy: Math.floor(heroes[0]?.y ?? 1), nx: 0, ny: 1, d: 0, key: 0 };
  return [any, any, any];
}

/** Choose the three door slots for the current state (no state mutation). */
export function chooseDoorSlots(state: SimState): Slot[] {
  const map = state.map!;
  const heroes = heroesOf(state);
  const seed = (map.decorSeed * 31 + state.round * 7919) >>> 0;
  const dist = partyDistance(map, heroes);
  const strict = slotsFor(map, dist, true);
  const loose = slotsFor(map, dist, false);
  // a straight stretch of thick wall reads best as a set; corner thresholds and thin walls only win when much closer
  const options: (Pick | null)[] = [
    bestOnStretch(strict, heroes, seed),
    bump(bestInRoom(strict, heroes, seed, RULES.doorSpacingMin), 4),
    bump(bestOnStretch(loose, heroes, seed), 6),
    bump(bestInRoom(loose, heroes, seed, 2), 10),
  ];
  let best: Pick | null = null;
  for (const o of options) if (o && (!best || o.score < best.score)) best = o;
  return best ? best.set : freePortals(map, dist, heroes, seed);
}

function bump(p: Pick | null, k: number): Pick | null { return p ? { set: p.set, score: p.score + k } : null; }

/** Place the threshold for the current offer: three doors ordered left to right on screen (door i = card i). */
export function placeDoors(state: SimState): DoorsState | null {
  const offer = state.offer;
  if (!state.map || !offer) return null;
  const slots = chooseDoorSlots(state).slice().sort((a, b) => (a.fx - a.fy) - (b.fx - b.fy) || a.fy - b.fy || a.ny - b.ny);
  const themes = offer.themes ?? [];
  const list: DoorState[] = slots.map((s, i) => ({
    i: i as 0 | 1 | 2, x: s.fx + 0.5, y: s.fy + 0.5, nx: s.nx, ny: s.ny,
    th: themes[i] ?? state.map!.theme, c: offer.cards[i],
  }));
  return { list, boss: isBossRound(state.round + 1), holdDoor: -1, holdTicks: 0, chosen: null };
}

// ---------------- voting ----------------

/** Door a point stands in (nearest front point within RULES.doorVoteRadius), else null. */
export function doorAt(doors: DoorsState | null | undefined, x: number, y: number): number | null {
  if (!doors) return null;
  let best: number | null = null, bd = RULES.doorVoteRadius * RULES.doorVoteRadius;
  for (const d of doors.list) {
    const dd = (d.x - x) ** 2 + (d.y - y) ** 2;
    if (dd <= bd) { bd = dd; best = d.i; }
  }
  return best;
}

/** Each slot's effective vote: the door the hero stands in, else their latest explicit VOTE (or null). */
export function effectiveVotes(state: SimState): (number | null)[] {
  return state.players.map((p) => {
    const at = doorAt(state.doors, p.x, p.y);
    if (at !== null) return at;
    return state.offer?.votes.find((v) => v.slot === p.slot)?.cardSlot ?? null;
  });
}

export function effectiveCounts(state: SimState): number[] {
  const c = [0, 0, 0];
  for (const v of effectiveVotes(state)) if (v !== null) c[v]++;
  return c;
}

/** Ticks of standing together that commit: solo (or a party of one) vs co-op. */
export function doorHoldTicks(state: SimState): number {
  return Math.round((state.mode === 'solo' || state.n === 1 ? RULES.doorSoloHoldSec : RULES.doorCoopHoldSec) * TICK_RATE);
}

/** A dropped co-op seat still inside its reconnect grace blocks early resolution (as with early locks). */
function reconnectGrace(state: SimState): boolean {
  if (!state.offer || state.offer.deadlineTick === null) return false;
  const hold = RULES.reconnectHoldSec * TICK_RATE;
  return state.players.some((p) => !p.connected && p.disconnectedAtTick !== null && state.tick - p.disconnectedAtTick < hold);
}

/**
 * Intermission movement: exactly the shared movement rules (predictMoveTick: dash charges, chained dashes, surge,
 * momentum) so client prediction matches; aim and facing follow the input; no attacks, casts, resource or cooldowns.
 */
export function stepIntermissionPlayer(state: SimState, ev: SimEvent[], p: PlayerState, input: PlayerInput | null) {
  p.attackAnim = Math.max(0, p.attackAnim - DT);
  p.castAnim = Math.max(0, p.castAnim - DT);
  if (p.lifeState !== 'alive') { p.vx = 0; p.vy = 0; return; }
  if (input) p.lastInputSeq = input.seq;
  const inp = input ?? { seq: p.lastInputSeq, moveX: 0, moveY: 0, aimX: p.aimX, aimY: p.aimY, buttons: 0 };
  const al = Math.sqrt(inp.aimX * inp.aimX + inp.aimY * inp.aimY);
  if (al > 1e-4) { p.aimX = inp.aimX / al; p.aimY = inp.aimY / al; p.aimDist = al; }
  p.facing = dir8(p.aimX, p.aimY);
  p.iframes = Math.max(0, p.iframes - DT);
  const pressed = inp.buttons;
  const edge = (pressed & ACTION.DODGE) !== 0 && (p.prevButtons & ACTION.DODGE) === 0;
  const rec = toFloatClamped(playerDerived(state, p).recovery, 1e12);
  if (predictMoveTick(state.map, p, inp.moveX, inp.moveY, p.aimX, p.aimY, edge, moveSpeedOf(state, p), p.classId, rec)) ev.push({ t: 'dodge', slot: p.slot });
  p.prevButtons = pressed;
}

/**
 * One VOTING tick: move the heroes, then advance the party's hold on a door. Returns the door to commit when the
 * hold completes, else null. Places the doors lazily if a restored state reached VOTING without them.
 */
export function stepVoting(state: SimState, ev: SimEvent[], inputs: (PlayerInput | null | undefined)[]): number | null {
  if (!state.doors) state.doors = placeDoors(state);
  for (const p of state.players) stepIntermissionPlayer(state, ev, p, p.connected ? (inputs[p.slot] ?? null) : null);
  const doors = state.doors;
  if (!doors) return null;
  const eligible = state.players.filter((p) => p.connected && p.lifeState === 'alive');
  let target = -1;
  if (eligible.length && !reconnectGrace(state)) {
    const first = doorAt(doors, eligible[0].x, eligible[0].y);
    if (first !== null && eligible.every((p) => doorAt(doors, p.x, p.y) === first)) target = first;
  }
  if (target >= 0 && target === doors.holdDoor) doors.holdTicks++;
  else { doors.holdDoor = target; doors.holdTicks = target >= 0 ? 1 : 0; }
  return target >= 0 && doors.holdTicks >= doorHoldTicks(state) ? target : null;
}

/** Mark the committed door; returns the presentation event (contract: door_chosen). */
export function chooseDoor(state: SimState, cardSlot: number): SimEvent | null {
  const doors = state.doors;
  const door = doors?.list[cardSlot];
  const theme = state.offer?.themes?.[cardSlot];
  if (theme) state.nextTheme = { round: state.round + 1, theme };
  if (!doors || !door) return null;
  doors.chosen = cardSlot;
  doors.holdDoor = cardSlot;
  doors.holdTicks = Math.max(doors.holdTicks, doorHoldTicks(state));
  return { t: 'door_chosen', i: cardSlot, x: door.x, y: door.y, nx: door.nx, ny: door.ny, th: door.th, c: door.c };
}

/** Snapshot view of the threshold: present during VOTING and FATE_COMMIT only. */
export function doorSnapshot(state: SimState): SnapDoor[] | undefined {
  const doors = state.doors;
  if (!doors || (state.phase !== 'VOTING' && state.phase !== 'FATE_COMMIT')) return undefined;
  const need = doorHoldTicks(state);
  return doors.list.map((d) => {
    const s: SnapDoor = {
      i: d.i, x: d.x, y: d.y, nx: d.nx, ny: d.ny, th: d.th, c: d.c,
      v: state.players.filter((p) => doorAt(doors, p.x, p.y) === d.i).map((p) => p.slot),
      hold: doors.chosen === d.i ? 1 : doors.holdDoor === d.i ? Math.round(Math.min(1, doors.holdTicks / need) * 1000) / 1000 : 0,
    };
    if (doors.boss) s.b = 1;
    if (doors.chosen === d.i) s.sel = 1;
    return s;
  });
}
