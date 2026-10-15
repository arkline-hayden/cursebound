// Per-room design (map generation tier 3, pure and deterministic from map.decorSeed and each room's variant).
//
// The simulation types every room (MapState.rooms: crypt, scriptorium, cistern, shrine, ...) and carves the furniture
// that blocks; this planner gives each room the look its kind calls for: a floor treatment (rugs, mosaics, water,
// planks, marble, sand, bones, rubble), furniture laid out against its walls, wall decor, the props that stand in for
// the blocking pieces the simulation carved (bookcases, iron maidens, obelisks, bone pillars, ...), lights and ambient
// hints. Boss arenas get their own set pieces per design (nave, ritual circle, bell tower, colosseum).
//
// Rules shared with the generic dressing (dressing.ts): standing props only within two tiles of a wall so the middle
// of a room stays readable for combat, spawn points stay clear, lights stay inside the map's budget, and nothing here
// ever blocks movement (the simulation already carved whatever does). Optional pieces scale with `density`
// (gfx decorDensity); the structural set pieces of a kind (its floor, its blocker props) always appear.

import type { MapRoom, RoomKind } from '@cursebound/simulation';
import type { ThemeId } from '../art/dungeonThemes';
import type { DecoName } from '../art/isoFloor';
import type { RoomFloorName } from '../art/isoRoomFloor';

/** What the room planner may do to the plan (closures over planDressing's state). */
export interface RoomCtx {
  W: number;
  H: number;
  theme: ThemeId;
  seed: number;
  /** cosmetic density multiplier (gfx decorDensity) */
  density: number;
  arena: string | null;
  /** the boss's dais (tile centre) on boss floors */
  boss: { x: number; y: number } | null;
  isFloor(x: number, y: number): boolean;
  /** masonry (not chasm) */
  isWall(x: number, y: number): boolean;
  isVoid(x: number, y: number): boolean;
  /** a wall tile that is furniture the simulation carved (free-standing 1x1 / one half of a 2x1) */
  freeStanding(x: number, y: number): boolean;
  /** any wall (furniture, masonry or chasm) within two tiles: where standing props may go */
  shallow(x: number, y: number): boolean;
  reserved: Uint8Array;
  occupied: Uint8Array;
  /** typed room index per tile (-1 = none) */
  owner: Int16Array;
  /** place a non-blocking prop (low / flat / standing, occlusion-tested). false = did not fit */
  place(id: string, px: number, py: number, flip: boolean, frameSeed: number): boolean;
  /** stand a tall `hug` prop against the back wall of floor tile (x, y): side 'n' = wall to the north, 'w' = west */
  hug(id: string, x: number, y: number, side: 'n' | 'w', frameSeed: number): boolean;
  /** dress the visible face of wall tile (wx, wy): 'L' faces south (+y), 'R' faces east (+x) */
  face(wx: number, wy: number, side: 'L' | 'R', id: string): void;
  floor(name: RoomFloorName, x: number, y: number): void;
  deco(name: DecoName, x: number, y: number): void;
  decal(key: string, frame: number, x: number, y: number, o?: { sx?: number; sy?: number; alpha?: number; tint?: number; flip?: boolean }): void;
  /** draw prop `id` in place of the free-standing wall piece at (x, y) */
  blocker(x: number, y: number, id: string, frame?: number, flip?: boolean): void;
  shaft(x: number, y: number, w: number): void;
  drip(x: number, y: number): void;
  emitter(kind: 'smoke' | 'steam' | 'spores' | 'embers' | 'wisp' | 'sparks', x: number, y: number, z: number, rate: number): void;
}

function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Typed room index per floor tile: the smallest room whose rect holds it wins (ties: nearest centre). */
export function roomOwners(W: number, H: number, rooms: MapRoom[], isFloor: (x: number, y: number) => boolean): Int16Array {
  const owner = new Int16Array(W * H).fill(-1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!isFloor(x, y)) continue;
    let best = -1, bestArea = Infinity, bestD = Infinity;
    rooms.forEach((r, i) => {
      if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) return;
      const area = r.w * r.h;
      const d = (x + 0.5 - (r.x + r.w / 2)) ** 2 + (y + 0.5 - (r.y + r.h / 2)) ** 2;
      if (area < bestArea || (area === bestArea && d < bestD)) { best = i; bestArea = area; bestD = d; }
    });
    owner[y * W + x] = best;
  }
  return owner;
}

/** Vignettes (art/vignettes.ts) that suit a room kind; typed rooms take at most one, from this list. */
export const KIND_VIGNETTES: Partial<Record<RoomKind, string[]>> = {
  library: ['library'], torture: ['torture'], forge: ['smithy'], collapsed: ['collapse'], shrine: ['shrine', 'chapel', 'ritual'],
  treasury: ['reliquary', 'storage'], barracks: ['camp', 'storage', 'expedition'], ossuary: ['reliquary', 'throne'], grotto: ['grove'],
  crypt: ['chapel', 'reliquary'], cistern: ['boatwreck'], pillared: ['chapel', 'ambush'], hall: ['camp', 'ambush', 'expedition', 'storage'],
};

/** Kinds that bring their own full floor treatment (the generic dais / centrepiece / runner stays out). */
export const DESIGNED_FLOOR: ReadonlySet<RoomKind> = new Set<RoomKind>(['library', 'cistern', 'shrine', 'treasury', 'barracks', 'bridge', 'arena', 'approach', 'pillared']);

interface Room {
  r: MapRoom;
  i: number;
  tiles: number[];
  /** floor tiles with masonry to the north / west (back walls the camera sees), south / east (front walls) */
  backN: number[];
  backW: number[];
  /** free-standing furniture walls inside the rect */
  blocks: { x: number; y: number; pair: boolean }[];
  cx: number;
  cy: number;
  rnd: () => number;
}

/** Plan every typed room. */
export function planRooms(ctx: RoomCtx, rooms: MapRoom[]): void {
  const { W } = ctx;
  rooms.forEach((r, i) => {
    const tiles: number[] = [];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (ctx.isFloor(x, y) && ctx.owner[y * W + x] === i) tiles.push(y * W + x);
    if (!tiles.length) return;
    const backN = tiles.filter((t) => ctx.isWall(t % W, ((t / W) | 0) - 1));
    const backW = tiles.filter((t) => ctx.isWall((t % W) - 1, (t / W) | 0));
    const blocks: Room['blocks'] = [];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      if (!ctx.freeStanding(x, y)) continue;
      blocks.push({ x, y, pair: ctx.freeStanding(x + 1, y) || ctx.freeStanding(x - 1, y) });
    }
    let sx = 0, sy = 0;
    for (const t of tiles) { sx += t % W; sy += (t / W) | 0; }
    const room: Room = { r, i, tiles, backN, backW, blocks, cx: sx / tiles.length + 0.5, cy: sy / tiles.length + 0.5, rnd: mulberry((ctx.seed * 31 + r.v * 2654435761 + i) >>> 0) };
    const fn = KIND_PLANS[r.kind];
    if (fn) fn(ctx, room);
  });
}

// ---------------------------------------------------------------- helpers

const xy = (ctx: RoomCtx, t: number): [number, number] => [t % ctx.W, (t / ctx.W) | 0];
const free = (ctx: RoomCtx, x: number, y: number): boolean => ctx.isFloor(x, y) && !ctx.reserved[y * ctx.W + x] && !ctx.occupied[y * ctx.W + x];
/** keep an optional piece? (scaled by the graphics tier's decor density) */
const keep = (ctx: RoomCtx, room: Room, p = 1): boolean => room.rnd() < p * Math.min(1.35, ctx.density);

/** Shuffle a copy (seeded by the room). */
function shuffled<T>(room: Room, list: T[]): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(room.rnd() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}

/** Stand props against the back walls: every `step`-th wall tile, cycling through `ids`. */
function alongWalls(ctx: RoomCtx, room: Room, ids: string[], opts: { step?: number; max?: number; hug?: boolean; p?: number; face?: boolean } = {}): number {
  const step = opts.step ?? 2, max = opts.max ?? 99;
  let n = 0, k = 0;
  const anchors = shuffled(room, [...room.backN.map((t) => ({ t, side: 'n' as const })), ...room.backW.map((t) => ({ t, side: 'w' as const }))]);
  anchors.sort((a, b) => a.t - b.t);
  for (const a of anchors) {
    if (n >= max) break;
    if ((k++ % step) !== 0) continue;
    const [x, y] = xy(ctx, a.t);
    if (!free(ctx, x, y) || (opts.p !== undefined && !keep(ctx, room, opts.p))) continue;
    const id = ids[n % ids.length]!;
    const seedF = hash(x, y, ctx.seed + 501);
    let ok: boolean;
    if (opts.hug) ok = ctx.hug(id, x, y, a.side, seedF);
    else {
      const nx = a.side === 'w' ? -0.18 : 0, ny = a.side === 'n' ? -0.18 : 0;
      ok = ctx.place(id, x + 0.5 + nx, y + 0.5 + ny, hash(x, y, ctx.seed + 503) < 0.5, seedF);
    }
    if (ok) { ctx.occupied[a.t] = 1; n++; }
  }
  return n;
}

/** Scatter props on floor tiles near the walls (standing pieces stay shallow). */
function scatter(ctx: RoomCtx, room: Room, ids: string[], count: number, opts: { low?: boolean; near?: (x: number, y: number) => boolean } = {}): number {
  let n = 0;
  const want = Math.round(count * Math.min(1.35, ctx.density));
  for (const t of shuffled(room, room.tiles)) {
    if (n >= want) break;
    const [x, y] = xy(ctx, t);
    if (!free(ctx, x, y)) continue;
    if (!opts.low && !ctx.shallow(x, y)) continue;
    if (opts.near && !opts.near(x, y)) continue;
    const id = ids[Math.floor(room.rnd() * ids.length)]!;
    const jx = (room.rnd() - 0.5) * 0.3, jy = (room.rnd() - 0.5) * 0.3;
    if (ctx.place(id, x + 0.5 + jx, y + 0.5 + jy, room.rnd() < 0.5, room.rnd())) { ctx.occupied[t] = 1; n++; }
  }
  return n;
}

/** Wall decor on the room's back wall faces (each face at most once; `p` = chance per face). */
function wallDecor(ctx: RoomCtx, room: Room, ids: string[], p: number): void {
  let k = 0;
  for (const t of room.backN) {
    const [x, y] = xy(ctx, t);
    if (hash(x, y, ctx.seed + 611) < p * ctx.density) ctx.face(x, y - 1, 'L', ids[(k++) % ids.length]!);
  }
  for (const t of room.backW) {
    const [x, y] = xy(ctx, t);
    if (hash(x, y, ctx.seed + 613) < p * ctx.density) ctx.face(x - 1, y, 'R', ids[(k++) % ids.length]!);
  }
}

/** Largest all-floor rect (between min and max size) centred on the room, shrinking from its bounds by `inset`. */
function centreRect(ctx: RoomCtx, room: Room, inset: number, minW: number, minH: number, maxW = 99, maxH = 99): { x: number; y: number; w: number; h: number } | null {
  const r = room.r;
  const cx = Math.floor(room.cx), cy = Math.floor(room.cy);
  for (let w = Math.min(maxW, r.w - inset * 2); w >= minW; w--) for (let h = Math.min(maxH, r.h - inset * 2); h >= minH; h--) {
    for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [1, 0], [0, 1]]) {
      const x0 = cx - Math.floor(w / 2) + ox!, y0 = cy - Math.floor(h / 2) + oy!;
      let ok = true;
      for (let y = y0; y < y0 + h && ok; y++) for (let x = x0; x < x0 + w && ok; x++) if (!ctx.isFloor(x, y) || ctx.owner[y * ctx.W + x] !== room.i) ok = false;
      if (ok) return { x: x0, y: y0, w, h };
    }
  }
  return null;
}

/** Lay a nine-slice (rug / pool) over a rect. */
function nineSlice(ctx: RoomCtx, base: 'rug' | 'pool', x0: number, y0: number, w: number, h: number, centre?: () => RoomFloorName): void {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const n = y === y0, s = y === y0 + h - 1, wv = x === x0, e = x === x0 + w - 1;
    const v = n ? 'N' : s ? 'S' : '';
    const u = wv ? 'W' : e ? 'E' : '';
    const name = (v || u ? `${base}${v}${u}` : centre ? centre() : `${base}C`) as RoomFloorName;
    ctx.floor(name, x, y);
  }
}

/** Fill every floor tile of the room with one of `names` (full-coverage floors: planks, marble, sand). */
function cover(ctx: RoomCtx, room: Room, names: RoomFloorName[]): void {
  for (const t of room.tiles) {
    const [x, y] = xy(ctx, t);
    ctx.floor(names[Math.floor(hash(x, y, ctx.seed + 701) * names.length)]!, x, y);
  }
}

/** Sprinkle a partial overlay over a fraction of the room's tiles. */
function sprinkle(ctx: RoomCtx, room: Room, names: RoomFloorName[], frac: number, where?: (x: number, y: number) => boolean): void {
  for (const t of room.tiles) {
    const [x, y] = xy(ctx, t);
    if (where && !where(x, y)) continue;
    if (hash(x, y, ctx.seed + 709) < frac * Math.min(1.25, ctx.density)) ctx.floor(names[Math.floor(hash(x, y, ctx.seed + 711) * names.length)]!, x, y);
  }
}

/** Big medallion (sigil / rose 6x6, mosaic 4x4) centred on a tile; only where every tile is floor. */
function medallion(ctx: RoomCtx, base: 'sigil' | 'rose' | 'mos', n: number, cx: number, cy: number, room?: Room): boolean {
  const x0 = cx - Math.floor(n / 2), y0 = cy - Math.floor(n / 2);
  for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) {
    if (!ctx.isFloor(x, y)) {
      // a corner of the circle's square may sit on a pillar or wall (the circle never reaches the corners)
      const dx = x + 0.5 - (x0 + n / 2), dy = y + 0.5 - (y0 + n / 2);
      if (dx * dx + dy * dy < (n / 2) * (n / 2) * 0.82) return false;
    }
    if (room && ctx.isFloor(x, y) && ctx.owner[y * ctx.W + x] !== room.i) return false;
  }
  for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) if (ctx.isFloor(x, y)) ctx.floor(`${base}${(y - y0) * n + (x - x0)}` as RoomFloorName, x, y);
  return true;
}

/** The raised 3x3 dais of the generic floor deco, centred on a tile. */
function dais(ctx: RoomCtx, cx: number, cy: number): boolean {
  for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) if (!ctx.isFloor(x, y)) return false;
  for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
    const s = y === cy + 1, e = x === cx + 1;
    ctx.deco(s && e ? 'daisSE' : s ? 'daisS' : e ? 'daisE' : 'dais', x, y);
  }
  return true;
}

/** Stand the room's carved furniture: singles and 2x1 pairs get the kind's props. */
function blockers(ctx: RoomCtx, room: Room, single: string | string[] | null, pair: string | null): void {
  const singles = Array.isArray(single) ? single : single ? [single] : [];
  room.blocks.forEach((b, k) => {
    if (b.pair) { if (pair) ctx.blocker(b.x, b.y, pair, Math.floor(hash(b.x, b.y, ctx.seed + 801) * 4)); }
    else if (singles.length) ctx.blocker(b.x, b.y, singles[k % singles.length]!, Math.floor(hash(b.x, b.y, ctx.seed + 803) * 4), hash(b.x, b.y, ctx.seed + 805) < 0.5);
  });
}

/** Floor tiles of the room that touch masonry within `d` tiles (a band along the walls). */
const nearWalls = (ctx: RoomCtx, d: number) => (x: number, y: number): boolean => {
  for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) if (ctx.isWall(x + dx, y + dy)) return true;
  return false;
};

// ---------------------------------------------------------------- the kinds

type KindPlan = (ctx: RoomCtx, room: Room) => void;

const crypt: KindPlan = (ctx, room) => {
  blockers(ctx, room, 'guardian', 'sarcophagus');
  // candles at the heads of the sarcophagi, urns and cold lights along the walls
  for (const b of room.blocks) {
    if (!b.pair || ctx.freeStanding(b.x - 1, b.y)) continue;
    if (free(ctx, b.x - 1, b.y) && keep(ctx, room, 0.6)) ctx.place('candles', b.x - 0.35, b.y + 0.5, false, hash(b.x, b.y, 3));
  }
  alongWalls(ctx, room, ['candle_stand', 'urn', 'coffin', 'urn'], { step: 3, max: 6, p: 0.85 });
  wallDecor(ctx, room, ['niche_urns', 'skullwall', 'bonecandle'], 0.22);
  sprinkle(ctx, room, ['rubble0', 'rubble1'], 0.05);
};

const library: KindPlan = (ctx, room) => {
  cover(ctx, room, ['plank0', 'plank1', 'plank2', 'plank3']);
  const rug = centreRect(ctx, room, 2, 3, 2, 7, 5);
  if (rug) nineSlice(ctx, 'rug', rug.x, rug.y, rug.w, rug.h);
  blockers(ctx, room, 'bookcase_free', 'bookcase_free');
  alongWalls(ctx, room, ['bookshelf'], { step: 2, hug: true, max: 8 });
  alongWalls(ctx, room, ['reading_table', 'candelabra', 'lectern', 'candle_stand'], { step: 3, max: 4, p: 0.9 });
  scatter(ctx, room, ['parchment', 'books_spilled'], 4, { low: true, near: nearWalls(ctx, 2) });
  wallDecor(ctx, room, ['shelf_jars', 'tapestry'], 0.18);
};

const cistern: KindPlan = (ctx, room) => {
  const pool = centreRect(ctx, room, 1, 3, 3) ?? centreRect(ctx, room, 0, 3, 2);
  if (pool) {
    const centres: RoomFloorName[] = ['poolC', 'poolC1', 'poolC2'];
    let k = 0;
    nineSlice(ctx, 'pool', pool.x, pool.y, pool.w, pool.h, () => centres[(k++ * 7 + room.r.v) % 3]!);
    if (ctx.theme === 'flooded' || ctx.theme === 'fungal' || ctx.theme === 'catacombs' || ctx.theme === 'sky') {
      for (let n = 0; n < Math.round(3 * ctx.density); n++) {
        const x = pool.x + 1 + Math.floor(room.rnd() * Math.max(1, pool.w - 2)), y = pool.y + 1 + Math.floor(room.rnd() * Math.max(1, pool.h - 2));
        if (free(ctx, x, y)) ctx.place('lilies', x + 0.5, y + 0.5, room.rnd() < 0.5, room.rnd());
      }
    }
  }
  blockers(ctx, room, ctx.theme === 'fungal' ? 'stalagmite' : null, null);
  // spouts feeding the basin, each with its drip
  let spouts = 0;
  for (const t of shuffled(room, room.backN)) {
    if (spouts >= 3) break;
    const [x, y] = xy(ctx, t);
    // no spouts over lava; none over the sky's pond (its rim is too low) or the moon's frozen crater
    if (ctx.theme === 'forge' || ctx.theme === 'sky' || ctx.theme === 'moon') break;
    ctx.face(x, y - 1, 'L', 'pipe_outlet');
    ctx.drip(x + 0.5, y + 0.3);
    spouts++;
  }
  alongWalls(ctx, room, ['bucket', 'urn', 'well'], { step: 4, max: 3, p: 0.7 });
  if (ctx.theme === 'forge' || ctx.theme === 'server') ctx.emitter('steam', room.cx, room.cy, 6, 1.4);
};

const shrine: KindPlan = (ctx, room) => {
  const cx = Math.floor(room.cx), cy = Math.floor(room.cy);
  if (!medallion(ctx, 'mos', 4, cx, cy, room)) {
    const rug = centreRect(ctx, room, 1, 2, 2, 4, 4);
    if (rug) nineSlice(ctx, 'rug', rug.x, rug.y, rug.w, rug.h);
  }
  blockers(ctx, room, ctx.theme === 'sanctum' || ctx.theme === 'frost' ? 'obelisk' : 'guardian', null);
  // the altar on the longest back wall, braziers flanking it, kneelers facing it
  const north = room.backN.length >= room.backW.length;
  const wallRow = (north ? room.backN : room.backW).map((t) => xy(ctx, t)).sort((a, b) => (north ? a[0] - b[0] : a[1] - b[1]));
  if (wallRow.length) {
    const mid = wallRow[Math.floor(wallRow.length / 2)]!;
    const altar = ctx.theme === 'sanctum' || ctx.theme === 'ossuary' ? 'altar_blood' : 'statue';
    const placed = altar === 'statue' ? ctx.hug('statue', mid[0], mid[1], north ? 'n' : 'w', 0.5) : ctx.place(altar, mid[0] + 0.5, mid[1] + 0.45, !north, 0.5);
    if (placed) {
      ctx.occupied[mid[1] * ctx.W + mid[0]] = 1;
      for (const s of [-2, 2]) {
        const bx = north ? mid[0] + s : mid[0], by = north ? mid[1] : mid[1] + s;
        if (free(ctx, bx, by) && ctx.place('brazier_great', bx + 0.5, by + 0.4, false, 0)) ctx.occupied[by * ctx.W + bx] = 1;
      }
      const kx = north ? mid[0] : mid[0] + 2, ky = north ? mid[1] + 2 : mid[1];
      if (free(ctx, kx, ky) && ctx.shallow(kx, ky)) ctx.place('kneeler', kx + 0.5, ky + 0.5, !north, 0.3);
      if (altar === 'statue') { ctx.place('candle_circle', mid[0] + 0.5, mid[1] + 1.2, false, 0); }
    }
  }
  scatter(ctx, room, ['candles', 'offering', 'candles'], 4, { near: nearWalls(ctx, 1) });
  wallDecor(ctx, room, ['tapestry_red', 'runes', 'sconce'], 0.2);
};

const ossuary: KindPlan = (ctx, room) => {
  sprinkle(ctx, room, ['bones0', 'bones1', 'bones2'], 0.85, nearWalls(ctx, 1));
  sprinkle(ctx, room, ['bones0', 'bones1', 'bones2'], 0.25);
  blockers(ctx, room, 'bone_pillar', 'sarcophagus');
  alongWalls(ctx, room, ['skull_pyramid', 'skullpile', 'bonepile2', 'skulls_tall'], { step: 2, max: 7, p: 0.85 });
  wallDecor(ctx, room, ['skullwall', 'bonecandle', 'niche_urns'], 0.35);
};

const collapsed: KindPlan = (ctx, room) => {
  sprinkle(ctx, room, ['rubble0', 'rubble1', 'rubble2'], 0.32);
  blockers(ctx, room, 'masonry_heap', 'masonry_heap');
  scatter(ctx, room, ['rubble_big', 'rubble', 'bricks', 'beam'], 5);
  alongWalls(ctx, room, ['beam_broken', 'statue_broken'], { step: 4, hug: true, max: 2, p: 0.8 });
  // daylight through the broken vault, dust turning in it
  ctx.shaft(room.cx + (room.rnd() - 0.5) * 2, room.cy + (room.rnd() - 0.5) * 2, 1 + room.rnd() * 0.5);
  if (room.tiles.length > 60) ctx.shaft(room.r.x + room.r.w * (0.2 + room.rnd() * 0.2), room.r.y + room.r.h * (0.6 + room.rnd() * 0.2), 0.8);
};

const pillared: KindPlan = (ctx, room) => {
  blockers(ctx, room, null, null);   // the theme pillar is the column
  // a long runner down the clearest aisle along the room's long axis
  const r = room.r, alongX = r.w >= r.h;
  let best: { a: number; b0: number; len: number } | null = null;
  const across = alongX ? r.h : r.w;
  for (let k = 1; k < across - 2; k++) {
    const line = (alongX ? r.y : r.x) + k;
    let run = 0, start = 0;
    for (let t = 0; t <= (alongX ? r.w : r.h); t++) {
      const p = (alongX ? r.x : r.y) + t;
      const ok = t < (alongX ? r.w : r.h) && (alongX ? ctx.isFloor(p, line) && ctx.isFloor(p, line + 1) : ctx.isFloor(line, p) && ctx.isFloor(line + 1, p));
      if (ok) { if (!run) start = p; run++; }
      if ((!ok || t === (alongX ? r.w : r.h)) && run) {
        const score = run - Math.abs(line + 1 - (alongX ? room.cy : room.cx)) * 1.5;
        if (run >= 4 && (!best || score > best.len - Math.abs(best.a + 1 - (alongX ? room.cy : room.cx)) * 1.5)) best = { a: line, b0: start, len: run };
        run = 0;
      }
    }
  }
  if (best) {
    const inset = best.len > 8 ? 1 : 0;
    if (alongX) nineSlice(ctx, 'rug', best.b0 + inset, best.a, best.len - inset * 2, 2);
    else nineSlice(ctx, 'rug', best.a, best.b0 + inset, 2, best.len - inset * 2);
  }
  alongWalls(ctx, room, ['banner_pole', 'candle_stand'], { step: 4, max: 4, p: 0.8 });
  wallDecor(ctx, room, ['banner', 'shield_crest', 'sconce'], 0.2);
};

const torture: KindPlan = (ctx, room) => {
  const cx = Math.floor(room.cx), cy = Math.floor(room.cy);
  // a blood gutter across the room into a central drain
  const alongX = room.r.w >= room.r.h;
  let laid = false;
  for (let t = (alongX ? room.r.x : room.r.y); t < (alongX ? room.r.x + room.r.w : room.r.y + room.r.h); t++) {
    const x = alongX ? t : cx, y = alongX ? cy : t;
    if (!ctx.isFloor(x, y) || ctx.owner[y * ctx.W + x] !== room.i) continue;
    ctx.floor(x === cx && y === cy ? 'drain' : alongX ? 'chanX' : 'chanY', x, y);
    laid = true;
  }
  if (!laid && ctx.isFloor(cx, cy)) ctx.floor('drain', cx, cy);
  sprinkle(ctx, room, ['straw0', 'straw1'], 0.2);
  blockers(ctx, room, ['iron_maiden', 'pillory'], null);
  alongWalls(ctx, room, ['cage', 'cage_skel'], { step: 4, hug: true, max: 2, p: 0.9 });
  alongWalls(ctx, room, ['rack', 'brazier', 'bucket', 'skull_spike'], { step: 3, max: 4, p: 0.85 });
  for (let n = 0; n < Math.round(5 * ctx.density); n++) {
    const t = room.tiles[Math.floor(room.rnd() * room.tiles.length)]!;
    const [x, y] = xy(ctx, t);
    ctx.decal('decal:blood', Math.floor(room.rnd() * 4), x + 0.5, y + 0.5, { tint: 0x4a0808, alpha: 0.6, sx: 1.1, sy: 0.55, flip: room.rnd() < 0.5 });
  }
  wallDecor(ctx, room, ['manacles', 'chainhooks', 'chains', 'tally'], 0.32);
};

const treasury: KindPlan = (ctx, room) => {
  cover(ctx, room, ['checker0', 'checker1']);
  sprinkle(ctx, room, ['coins0', 'coins1'], 0.18);
  blockers(ctx, room, 'guardian', null);
  alongWalls(ctx, room, ['chest_gold', 'urn', 'chest_open', 'coin_heap', 'urn', 'chest_gold'], { step: 2, max: 8 });
  scatter(ctx, room, ['coin_heap'], 2, { low: true, near: nearWalls(ctx, 2) });
  wallDecor(ctx, room, ['shield_crest', 'tapestry', 'sconce'], 0.25);
};

const barracks: KindPlan = (ctx, room) => {
  cover(ctx, room, ['plank0', 'plank1', 'plank2', 'plank3']);
  sprinkle(ctx, room, ['straw0', 'straw1'], 0.12);
  blockers(ctx, room, 'armor_stand', null);
  alongWalls(ctx, room, ['cot'], { step: 2, max: 6 });
  alongWalls(ctx, room, ['weaponrack'], { step: 5, hug: true, max: 2, p: 0.8 });
  alongWalls(ctx, room, ['armor_stand', 'weapon_barrel', 'table', 'stool'], { step: 3, max: 4, p: 0.85 });
  wallDecor(ctx, room, ['shield_crest', 'toolrack', 'tally'], 0.2);
};

const grotto: KindPlan = (ctx, room) => {
  sprinkle(ctx, room, ['growth0', 'growth1', 'growth2'], 0.5);
  const pool = room.tiles.length > 50 ? centreRect(ctx, room, 2, 3, 2, 4, 3) : null;
  if (pool) nineSlice(ctx, 'pool', pool.x, pool.y, pool.w, pool.h);
  blockers(ctx, room, 'stalagmite', 'masonry_heap');
  scatter(ctx, room, ['shroom_giant', 'shroom', 'shroom2', 'sporepod'], 5);
  scatter(ctx, room, ['mushroom_ring', 'roots_floor'], 2, { low: true });
  wallDecor(ctx, room, ['roots', 'glowmoss', 'wallshrooms'], 0.3);
};

const forge: KindPlan = (ctx, room) => {
  sprinkle(ctx, room, ['ash0', 'ash1'], 0.3);
  blockers(ctx, room, 'furnace', 'anvil');
  alongWalls(ctx, room, ['forge_hearth', 'anvil', 'quench', 'orepile', 'minecart'], { step: 3, max: 5, p: 0.9 });
  wallDecor(ctx, room, ['toolrack', 'chainhooks'], 0.25);
  // the server room's power plant: a shorted bus bar spitting sparks
  if (ctx.theme === 'server') ctx.emitter('sparks', room.cx, room.cy - 0.5, 18, 0.9);
};

const bridge: KindPlan = (ctx, room) => {
  const alongX = room.r.w >= room.r.h;
  for (const t of room.tiles) {
    const [x, y] = xy(ctx, t);
    let name: RoomFloorName;
    if (alongX) name = ctx.isVoid(x, y - 1) ? 'bridgeXN' : ctx.isVoid(x, y + 1) ? 'bridgeXS' : 'bridgeX';
    else name = ctx.isVoid(x - 1, y) ? 'bridgeYW' : ctx.isVoid(x + 1, y) ? 'bridgeYE' : 'bridgeY';
    ctx.floor(name, x, y);
  }
};

const approach: KindPlan = (ctx, room) => {
  // a processional runner towards the arena, braziers and banners flanking, statues at the door
  const r = room.r;
  const cy = Math.floor(r.y + r.h / 2);
  if (r.h >= 5) nineSlice(ctx, 'rug', r.x + 1, cy - 1, r.w - 1, 3);
  blockers(ctx, room, 'guardian', null);
  for (const [x, y] of [[r.x + r.w - 2, r.y + 1], [r.x + r.w - 2, r.y + r.h - 2]] as const) {
    if (free(ctx, x, y)) { ctx.place('brazier_great', x + 0.5, y + 0.5, false, 0); ctx.occupied[y * ctx.W + x] = 1; }
  }
  alongWalls(ctx, room, ['banner_pole', 'candle_stand'], { step: 3, max: 3 });
  wallDecor(ctx, room, ['tapestry_red', 'shield_crest'], 0.4);
};

// ---------------------------------------------------------------- boss arenas

const ARENA_PLANS: Record<string, KindPlan> = {
  /** drowned cathedral: a processional runner to the apse dais, flooded aisles, a rose at the crossing */
  nave(ctx, room) {
    const r = room.r;
    const singles = room.blocks.filter((b) => !b.pair);
    const minX = Math.min(...singles.map((b) => b.x));
    // guardians at the mouth of the nave; the rows are the theme's own columns (bone pillars in the ossuary)
    singles.forEach((b) => { if (b.x === minX) ctx.blocker(b.x, b.y, 'guardian', 0, b.y > room.cy); else if (ctx.theme === 'ossuary') ctx.blocker(b.x, b.y, 'bone_pillar'); });
    const rowY = singles.filter((b) => b.x !== minX).map((b) => b.y);
    const top = rowY.length ? Math.min(...rowY) : Math.floor(room.cy) - 3, bot = rowY.length ? Math.max(...rowY) : Math.floor(room.cy) + 3;
    const cy = Math.round((top + bot) / 2);
    // the dais the boss rises on (the apse centre)
    const daisX = ctx.boss ? Math.floor(ctx.boss.x) : r.x + r.w - 4;
    dais(ctx, daisX, ctx.boss ? Math.floor(ctx.boss.y) : cy);
    // the rose sits at the crossing; if a pillar or the room edge is in the way, slide it along the nave (and a row
    // off axis) to the nearest spot where the whole circle is floor
    let crossing = Math.floor((r.x + daisX) / 2) + 1;
    let rose = false;
    search: for (let d = 0; d <= Math.max(4, Math.floor(r.w / 2)); d++) for (const dx of d ? [d, -d] : [0]) for (const dy of [0, -1, 1]) {
      const x = crossing + dx;
      if (x - 3 < r.x || x + 3 > daisX - 1) continue;
      if (medallion(ctx, 'rose', 6, x, cy + dy, room)) { crossing = x; rose = true; break search; }
    }
    for (let x = r.x; x < daisX - 1; x++) {
      if (rose && Math.abs(x + 0.5 - (crossing + 0.5)) < 3.2) continue;
      for (const y of [cy - 1, cy, cy + 1]) if (ctx.isFloor(x, y)) ctx.floor(y === cy - 1 ? (x === r.x ? 'rugNW' : 'rugN') : y === cy + 1 ? (x === r.x ? 'rugSW' : 'rugS') : x === r.x ? 'rugW' : 'rugC', x, y);
    }
    // flooded aisles beyond the pillar rows: grow a basin outward from each row while whole rows stay floor
    const x0 = minX + 2, x1 = daisX - 3;
    const rowFloor = (y: number) => { for (let x = x0; x <= x1; x++) if (!ctx.isFloor(x, y)) return false; return true; };
    for (const [from, dir] of [[top - 1, -1], [bot + 1, 1]] as const) {
      let m = 0;
      while (m < 4 && rowFloor(from + dir * m)) m++;
      if (m < 2 || x1 - x0 < 3) continue;
      const ya = dir < 0 ? from - m + 1 : from;
      nineSlice(ctx, 'pool', x0, ya, x1 - x0 + 1, m);
      for (let n = 0; n < 3; n++) { const lx = x0 + 1 + Math.floor(room.rnd() * Math.max(1, x1 - x0 - 1)); ctx.place('lilies', lx + 0.5, ya + m / 2, room.rnd() < 0.5, room.rnd()); }
    }
    for (const s of [-2, 2]) if (ctx.isFloor(daisX, cy + s)) { ctx.place('brazier_great', daisX + 0.5, cy + s + 0.5, false, 0); ctx.occupied[(cy + s) * ctx.W + daisX] = 1; }
    alongWalls(ctx, room, ['candle_stand', 'candelabra'], { step: 4, max: 6 });
    // side chapels: a statue and candles in each recess
    for (const t of room.tiles) {
      const [x, y] = xy(ctx, t);
      if (y > top - 3 && y < bot + 3) continue;
      if ((y < top && ctx.isWall(x, y - 1) && ctx.isWall(x - 1, y) && hash(x, y, ctx.seed + 33) < 0.6) && free(ctx, x, y)) ctx.place('candles', x + 0.5, y + 0.4, false, 0.2);
    }
    wallDecor(ctx, room, ['banner', 'tapestry_red', 'sconce'], 0.35);
  },
  /** ghost-fire circle: the sigil under the boss, obelisks around it, shrines in the alcoves */
  ritual(ctx, room) {
    const bx = ctx.boss ? Math.floor(ctx.boss.x) : Math.floor(room.cx), by = ctx.boss ? Math.floor(ctx.boss.y) : Math.floor(room.cy);
    medallion(ctx, 'sigil', 6, bx, by, room);
    blockers(ctx, room, 'obelisk', null);
    sprinkle(ctx, room, ['ash0', 'ash1'], 0.06);
    alongWalls(ctx, room, ['candle_stand', 'skull_pyramid', 'brazier_great', 'candles'], { step: 3, max: 8 });
    ctx.emitter('wisp', bx + 0.5, by + 0.5, 4, 0.8);
    wallDecor(ctx, room, ['runes', 'bonecandle', 'sconce'], 0.3);
  },
  /** bell tower: a bronze rose on the platform, the fallen frame's posts, braziers round the rim */
  belltower(ctx, room) {
    const cx = ctx.boss ? Math.floor(ctx.boss.x) : Math.floor(room.cx), cy = ctx.boss ? Math.floor(ctx.boss.y) : Math.floor(room.cy);
    medallion(ctx, 'rose', 6, cx, cy, room);
    blockers(ctx, room, 'bell_post', null);
    sprinkle(ctx, room, ['rubble0', 'rubble1', 'rubble2'], 0.18, (x, y) => Math.abs(x - cx) + Math.abs(y - cy) > 5);
    // braziers on the rim diagonals (never on the bridge side)
    const R = Math.floor(room.r.w / 2);
    for (const [dx, dy] of [[1, -1], [1, 1], [-1, -1], [-1, 1], [1, 0]] as const) {
      for (let k = R; k > 2; k--) {
        const x = cx + Math.round(dx * k * (dy ? 0.62 : 1)), y = cy + Math.round(dy * k * 0.62);
        if (!free(ctx, x, y) || !ctx.shallow(x, y)) continue;
        if (ctx.place('brazier_great', x + 0.5, y + 0.5, false, 0)) { ctx.occupied[y * ctx.W + x] = 1; break; }
      }
    }
    ctx.emitter('wisp', cx + 0.5, cy + 0.5, 2, 0.6);
  },
  /** colosseum: raked sand, a dais and mosaic in the middle, spina posts burning, pens behind portcullises */
  colosseum(ctx, room) {
    const cx = ctx.boss ? Math.floor(ctx.boss.x) : Math.floor(room.cx), cy = ctx.boss ? Math.floor(ctx.boss.y) : Math.floor(room.cy);
    for (const t of room.tiles) {
      const [x, y] = xy(ctx, t);
      if (Math.abs(x - cx) <= 2 && Math.abs(y - cy) <= 2) continue;
      ctx.floor((['sand0', 'sand1', 'sand0', 'sand1', 'sand2', 'sand3'] as RoomFloorName[])[Math.floor(hash(x, y, ctx.seed + 901) * 6)]!, x, y);
    }
    medallion(ctx, 'mos', 4, cx, cy, room);
    blockers(ctx, room, 'brazier_column', null);
    // the pens: portcullises on their back walls, kit stacked inside
    for (const t of room.backN) {
      const [x, y] = xy(ctx, t);
      if (ctx.isWall(x - 1, y) || ctx.isWall(x + 1, y)) { if (Math.abs(x - cx) <= 1) ctx.face(x, y - 1, 'L', 'portcullis'); }
    }
    for (const t of room.backW) {
      const [x, y] = xy(ctx, t);
      if (Math.abs(y - cy) <= 1 && ctx.isWall(x, y - 1) && ctx.isWall(x, y + 1)) ctx.face(x - 1, y, 'R', 'portcullis');
    }
    alongWalls(ctx, room, ['banner_pole', 'weapon_barrel', 'armor_stand', 'banner_pole'], { step: 4, max: 6 });
    for (let n = 0; n < Math.round(6 * ctx.density); n++) {
      const t = room.tiles[Math.floor(room.rnd() * room.tiles.length)]!;
      const [x, y] = xy(ctx, t);
      ctx.decal('decal:blood', Math.floor(room.rnd() * 4), x + 0.5, y + 0.5, { tint: 0x3a0606, alpha: 0.45, sx: 1, sy: 0.5, flip: room.rnd() < 0.5 });
    }
    wallDecor(ctx, room, ['shield_crest', 'banner'], 0.3);
  },
};

/** The Corrupted Core's data vault: a sigil on the raised core platform, pylons round it, rack rows on the arcs,
 *  rack walls all round, power cores behind the platform, cable runs and neon on the walls. */
ARENA_PLANS.datavault = (ctx, room) => {
  const bx = ctx.boss ? Math.floor(ctx.boss.x) : Math.floor(room.cx), by = ctx.boss ? Math.floor(ctx.boss.y) : Math.floor(room.cy);
  medallion(ctx, 'sigil', 6, bx, by, room);
  room.blocks.forEach((b, k) => {
    if (b.pair) ctx.blocker(b.x, b.y, 'rack_free', Math.floor(hash(b.x, b.y, ctx.seed + 811) * 4));
    else ctx.blocker(b.x, b.y, Math.abs(b.x - bx) <= 4 && Math.abs(b.y - by) <= 4 ? 'core_pylon' : 'power_core', k % 4);
  });
  alongWalls(ctx, room, ['rack_hug'], { step: 2, hug: true, max: 16 });
  alongWalls(ctx, room, ['terminal', 'holo_pylon', 'ups_unit'], { step: 4, max: 5, p: 0.9 });
  scatter(ctx, room, ['cable_coil', 'chip_debris', 'floor_vent'], 7, { low: true, near: nearWalls(ctx, 2) });
  for (let n = 0; n < Math.round(5 * ctx.density); n++) {
    const t = room.tiles[Math.floor(room.rnd() * room.tiles.length)]!;
    const [x, y] = xy(ctx, t);
    if (Math.abs(x - bx) + Math.abs(y - by) > 4) ctx.decal('decal:cable', Math.floor(room.rnd() * 4), x + 0.5, y + 0.5, { alpha: 0.7, flip: room.rnd() < 0.5 });
  }
  ctx.emitter('sparks', bx + 0.5, by + 0.5, 30, 0.6);
  wallDecor(ctx, room, ['neon_cyan', 'rack_wall', 'cable_wall', 'warning_sign', 'neon_magenta'], 0.45);
};

/** The Iron Colossus's foundry: the casting-pit dais, furnaces on the diagonals, anvil pairs, smithing kit along the
 *  walls, ash on the floor, embers and smoke. Lava stays off the floor (the slag patterns are the only lava). */
ARENA_PLANS.foundry = (ctx, room) => {
  const bx = ctx.boss ? Math.floor(ctx.boss.x) : Math.floor(room.cx), by = ctx.boss ? Math.floor(ctx.boss.y) : Math.floor(room.cy);
  if (!medallion(ctx, 'mos', 4, bx, by, room)) dais(ctx, bx, by);   // the casting pit's iron grate
  blockers(ctx, room, 'furnace', 'anvil');
  for (const b of room.blocks) if (!b.pair) ctx.emitter('embers', b.x + 0.5, b.y + 0.5, 24, 0.9);
  sprinkle(ctx, room, ['ash0', 'ash1'], 0.22, (x, y) => Math.abs(x - bx) + Math.abs(y - by) > 2);
  alongWalls(ctx, room, ['forge_hearth', 'quench', 'orepile', 'minecart', 'anvil'], { step: 3, max: 8, p: 0.95 });
  wallDecor(ctx, room, ['toolrack', 'chainhooks', 'chains'], 0.35);
  ctx.emitter('smoke', bx + 0.5, by + 0.5, 40, 0.5);
};

const arena: KindPlan = (ctx, room) => {
  const fn = ARENA_PLANS[ctx.arena ?? ''] ?? ARENA_PLANS.ritual!;
  fn(ctx, room);
};

const hall: KindPlan = (ctx, room) => {
  wallDecor(ctx, room, ['sconce', 'banner'], 0.08);
};

const KIND_PLANS: Partial<Record<RoomKind, KindPlan>> = { crypt, library, cistern, shrine, ossuary, collapsed, pillared, torture, treasury, barracks, grotto, forge, bridge, approach, arena, hall };
