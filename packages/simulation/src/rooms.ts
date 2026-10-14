import { THEME_ROOM_WEIGHTS } from '@cursebound/content';
import { FLOOR, WALL, block, blockFits, fill, floorIn, idx, inner, isFloorAt, ri, type Grid, type RoomSpec } from './mapgrid';
import { nextFloat, nextInt, type RngState } from './rng';
import type { MapRoom, RoomKind } from './types';

// Map generation tier 2: every room a layout carved gets a semantic kind (crypt, scriptorium, cistern, shrine, ...),
// drawn from the theme's weights and the room's size and silhouette, with repeats on one floor damped. Kinds whose
// furniture blocks movement then carve it into the grid (tier 2b): sarcophagus rows, shelf stacks, pillar grids,
// fallen masonry, statues. Only free-standing 1x1 / 2x1 pieces (or small clusters) with a clear one-tile ring are
// carved, so the floor can never be cut apart. Everything purely cosmetic (rugs, water, props, lights) is left to
// the client's per-room dressing (tier 3), seeded from MapState.decorSeed and each room's variant `v`.

/** Kinds a layout may assign (bridge / hall / approach / arena are only ever forced by a layout). */
const ASSIGNABLE: RoomKind[] = ['crypt', 'library', 'cistern', 'shrine', 'ossuary', 'collapsed', 'pillared', 'torture', 'treasury', 'barracks', 'grotto', 'forge'];

/** Size and silhouette limits per kind: floor area range and allowed shapes. */
const FIT: Partial<Record<RoomKind, { min: number; max: number; shapes: RoomSpec['shape'][] }>> = {
  crypt: { min: 30, max: 400, shapes: ['rect', 'hall', 'round'] },
  library: { min: 24, max: 160, shapes: ['rect', 'hall'] },
  cistern: { min: 28, max: 400, shapes: ['rect', 'round', 'cave'] },
  shrine: { min: 20, max: 260, shapes: ['rect', 'round', 'cave'] },
  ossuary: { min: 20, max: 300, shapes: ['rect', 'round', 'cave', 'hall'] },
  collapsed: { min: 26, max: 400, shapes: ['rect', 'round', 'cave', 'hall'] },
  pillared: { min: 48, max: 400, shapes: ['rect', 'round', 'hall'] },
  torture: { min: 18, max: 120, shapes: ['rect', 'cave'] },
  treasury: { min: 14, max: 90, shapes: ['rect', 'round'] },
  barracks: { min: 22, max: 140, shapes: ['rect', 'hall'] },
  grotto: { min: 24, max: 400, shapes: ['cave', 'round', 'rect'] },
  forge: { min: 24, max: 180, shapes: ['rect', 'cave', 'round'] },
};

function pickWeighted(rng: RngState, list: [RoomKind, number][]): RoomKind | null {
  const total = list.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return null;
  let t = nextFloat(rng) * total;
  for (const [k, w] of list) { t -= w; if (t <= 0) return k; }
  return list[list.length - 1][0];
}

/** Tier 2: a kind for every room (forced kinds kept, the rest drawn per theme with repeats damped). */
export function assignKinds(g: Grid, specs: RoomSpec[], theme: string, rng: RngState): RoomKind[] {
  const weights = THEME_ROOM_WEIGHTS[theme] ?? THEME_ROOM_WEIGHTS.catacombs;
  const used = new Map<RoomKind, number>();
  const out: RoomKind[] = [];
  for (const s of specs) {
    if (s.kind) { out.push(s.kind); used.set(s.kind, (used.get(s.kind) ?? 0) + 1); continue; }
    const area = floorIn(g, s);
    // a layout's own short list overrides the size ceiling (its great halls are meant to be one room)
    const pool = (s.kinds ?? ASSIGNABLE).filter((k) => {
      const f = FIT[k];
      return !!f && area >= f.min && (!!s.kinds || area <= f.max) && f.shapes.includes(s.shape);
    });
    // a cave chamber leans towards the natural kinds, a long hall towards processional ones
    const list: [RoomKind, number][] = pool.map((k) => {
      let w = weights[k] ?? 0.15;
      if (s.shape === 'cave' && (k === 'grotto' || k === 'cistern' || k === 'collapsed' || k === 'ossuary')) w *= 1.8;
      if (s.shape === 'hall' && (k === 'crypt' || k === 'pillared' || k === 'library')) w *= 1.5;
      if (area < 40 && (k === 'treasury' || k === 'torture')) w *= 1.6;
      return [k, w * Math.pow(0.22, used.get(k) ?? 0)];
    });
    const k = pickWeighted(rng, list) ?? 'hall';
    out.push(k);
    used.set(k, (used.get(k) ?? 0) + 1);
  }
  return out;
}

/** Floor tiles of a room at least `d` tiles (8-neighbour) from any wall: where furniture may stand. */
function interior(g: Grid, s: RoomSpec, d: number): (x: number, y: number) => boolean {
  return (x, y) => {
    if (x < s.x || y < s.y || x >= s.x + s.w || y >= s.y + s.h) return false;
    for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) if (!isFloorAt(g, x + dx, y + dy)) return false;
    return true;
  };
}

/** Rows of 2x1 blocks (sarcophagi, shelf stacks) across the room, spaced so aisles stay two tiles wide. */
function rows(g: Grid, s: RoomSpec, rng: RngState, opts: { dx: number; dy: number; keep: number }): number {
  const ok = interior(g, s, 2);
  let n = 0;
  const ox = s.x + 2 + nextInt(rng, 2), oy = s.y + 2 + nextInt(rng, 2);
  for (let y = oy; y < s.y + s.h - 2; y += opts.dy) for (let x = ox; x < s.x + s.w - 3; x += opts.dx) {
    if (!ok(x, y) || !ok(x + 1, y) || nextFloat(rng) > opts.keep) continue;
    if (block(g, x, y, 2, 1)) n++;
  }
  return n;
}

/** A grid of 1x1 pillars (columns, bone pillars, stalagmites, statues). */
function grid(g: Grid, s: RoomSpec, rng: RngState, step: number, keep: number, margin = 2): number {
  const ok = interior(g, s, margin);
  let n = 0;
  const ox = s.x + margin + nextInt(rng, 2), oy = s.y + margin + nextInt(rng, 2);
  for (let y = oy; y < s.y + s.h - margin; y += step) for (let x = ox; x < s.x + s.w - margin; x += step) {
    if (!ok(x, y) || nextFloat(rng) > keep) continue;
    if (block(g, x, y, 1, 1)) n++;
  }
  return n;
}

/** A few singles at seeded spots (statues, iron maidens, giant stalks). */
function singles(g: Grid, s: RoomSpec, rng: RngState, count: number, margin = 2): number {
  const ok = interior(g, s, margin);
  let n = 0;
  for (let t = 0; t < count * 8 && n < count; t++) {
    const x = s.x + nextInt(rng, Math.max(1, s.w)), y = s.y + nextInt(rng, Math.max(1, s.h));
    if (ok(x, y) && block(g, x, y, 1, 1)) n++;
  }
  return n;
}

/** Symmetric pair of singles flanking the room's long axis (shrine statues, treasury guardians). */
function flank(g: Grid, s: RoomSpec, rng: RngState): number {
  const ok = interior(g, s, 2);
  const cx = s.x + Math.floor(s.w / 2), cy = s.y + Math.floor(s.h / 2);
  const along = s.w >= s.h;
  const off = ri(rng, 2, Math.max(2, Math.floor((along ? s.h : s.w) / 2) - 2));
  let n = 0;
  for (const sgn of [-1, 1]) {
    const x = along ? cx : cx + sgn * off, y = along ? cy + sgn * off : cy;
    if (ok(x, y) && block(g, x, y, 1, 1)) n++;
  }
  return n;
}

/** Fallen masonry: small irregular clusters (every cluster keeps a clear ring). */
function rubble(g: Grid, s: RoomSpec, rng: RngState, count: number): number {
  const ok = interior(g, s, 2);
  const shapes: [number, number][][] = [[[0, 0], [1, 0], [0, 1]], [[0, 0], [1, 0]], [[0, 0]], [[0, 0], [1, 1], [1, 0]], [[0, 0], [0, 1]]];
  let n = 0;
  for (let t = 0; t < count * 10 && n < count; t++) {
    const x = s.x + nextInt(rng, Math.max(1, s.w)), y = s.y + nextInt(rng, Math.max(1, s.h));
    const sh = shapes[nextInt(rng, shapes.length)];
    const bw = Math.max(...sh.map((p) => p[0])) + 1, bh = Math.max(...sh.map((p) => p[1])) + 1;
    if (!ok(x, y) || !ok(x + bw - 1, y + bh - 1) || !blockFits(g, x, y, bw, bh)) continue;
    for (const [dx, dy] of sh) fill(g, x + dx, y + dy);
    n++;
  }
  return n;
}

/** Tier 2b: carve each kind's blocking furniture into the grid. */
export function furnish(g: Grid, specs: RoomSpec[], kinds: RoomKind[], rng: RngState): void {
  specs.forEach((s, i) => {
    if (s.furnished) return;
    const area = floorIn(g, s);
    switch (kinds[i]) {
      case 'crypt': rows(g, s, rng, { dx: ri(rng, 4, 5), dy: 3, keep: 0.85 }); break;
      case 'library': rows(g, s, rng, { dx: ri(rng, 4, 6), dy: ri(rng, 3, 4), keep: 0.7 }); break;
      case 'pillared': grid(g, s, rng, ri(rng, 3, 4), 0.92); break;
      case 'ossuary': if (area >= 40) grid(g, s, rng, 4, 0.55); break;
      case 'collapsed': rubble(g, s, rng, Math.max(2, Math.min(7, Math.round(area / 22)))); break;
      case 'shrine': if (area >= 36) flank(g, s, rng); break;
      case 'treasury': if (area >= 30) flank(g, s, rng); break;
      case 'torture': singles(g, s, rng, area >= 50 ? 2 : 1); break;
      case 'grotto': singles(g, s, rng, Math.max(1, Math.min(4, Math.round(area / 35)))); break;
      case 'cistern': if (area >= 60) grid(g, s, rng, ri(rng, 4, 5), 0.6, 3); break;
      case 'forge': if (area >= 40) singles(g, s, rng, 1); break;
      default: break;
    }
  });
}

/** Final room records: rects clipped to the floor they still hold (rooms the validation cut away are dropped). */
export function finalRooms(g: Grid, specs: RoomSpec[], kinds: RoomKind[], rng: RngState): MapRoom[] {
  const out: MapRoom[] = [];
  specs.forEach((s, i) => {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, n = 0;
    for (let y = Math.max(0, s.y); y < Math.min(g.h, s.y + s.h); y++) for (let x = Math.max(0, s.x); x < Math.min(g.w, s.x + s.w); x++) {
      if (g.t[idx(g, x, y)] !== FLOOR && !(inner(g, x, y) && freeStanding(g, x, y))) continue;
      n++;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    if (n < 6) return;
    out.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, kind: kinds[i], shape: s.shape, v: nextInt(rng, 1 << 20) });
  });
  return out;
}

/** A wall tile with floor on all four sides or one half of a 2x1 block (furniture, not structure). */
function freeStanding(g: Grid, x: number, y: number): boolean {
  if (g.t[idx(g, x, y)] !== WALL) return false;
  const f = (xx: number, yy: number) => isFloorAt(g, xx, yy);
  if (f(x, y - 1) && f(x, y + 1) && f(x - 1, y) && f(x + 1, y)) return true;
  return f(x, y - 1) && f(x, y + 1) && (f(x - 1, y) || f(x + 1, y));
}

/**
 * Zones for open layouts without authored rooms (caverns, ruins): `k` seeds spread by farthest-point sampling over
 * the floor (walking distance), every floor tile joins its nearest seed, each zone's bounding rect becomes a room.
 * Pure geometry, no stream draws. Zone rects may overlap; the client gives a shared tile to the nearest zone centre.
 */
export function partitionRooms(g: Grid, shape: RoomSpec['shape'], tilesPerRoom: number, kinds?: RoomKind[]): RoomSpec[] {
  const W = g.w, H = g.h, N = W * H;
  const floors: number[] = [];
  for (let i = 0; i < N; i++) if (g.t[i] === FLOOR) floors.push(i);
  if (!floors.length) return [];
  const k = Math.max(1, Math.min(8, Math.round(floors.length / tilesPerRoom)));
  const multi = (seeds: number[]): { d: Int32Array; owner: Int32Array } => {
    const d = new Int32Array(N).fill(-1), owner = new Int32Array(N).fill(-1);
    const q: number[] = [];
    seeds.forEach((s, j) => { d[s] = 0; owner[s] = j; q.push(s); });
    for (let h = 0; h < q.length; h++) {
      const c = q[h], x = c % W, y = (c / W) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (g.t[n] !== FLOOR || d[n] >= 0) continue;
        d[n] = d[c] + 1; owner[n] = owner[c]; q.push(n);
      }
    }
    return { d, owner };
  };
  // first seed: the floor tile farthest from the map's first floor tile, then always the farthest from all seeds
  const seeds: number[] = [];
  let probe = multi([floors[0]]).d;
  for (let j = 0; j < k; j++) {
    let best = -1, bd = -1;
    for (const i of floors) if (probe[i] > bd) { bd = probe[i]; best = i; }
    if (best < 0 || (j > 0 && bd < 5)) break;
    seeds.push(best);
    probe = multi(seeds).d;
  }
  const { owner } = multi(seeds);
  return seeds.map((_, j) => {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (const i of floors) if (owner[i] === j) { const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const r: RoomSpec = { x: x0, y: y0, w: Math.max(1, x1 - x0 + 1), h: Math.max(1, y1 - y0 + 1), shape };
    if (kinds) r.kinds = kinds;
    return r;
  }).filter((r) => r.w > 2 && r.h > 2);
}
