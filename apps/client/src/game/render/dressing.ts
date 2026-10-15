// Lived-in dressing planner (pure, framework-free, deterministic from map.decorSeed).
//
// Turns a map into a list of things to draw: flat stamps baked into the floor texture (grime, edge growth, story
// decals, trails, low clutter), sprites that need per-object depth (tall or animated props), wall-face dressing and
// hints for the ambient layer (rat runs, webs, fly swarms, smoke/spore/ember emitters, drips). DungeonRenderer turns
// the plan into Phaser objects; tests and the offline preview read it directly.
//
// Placement rules
//  - Rooms are found from a distance-to-wall field: connected tiles at least 3 tiles from any wall form a room core.
//    1-3 vignettes per room hug the room's back walls (north / west); their footprint never reaches into the core.
//  - Tall props only stand against back walls and never where a wall with a later draw depth would cut into them
//    (screen-space hexagon test against every nearby wall block), so nothing is ever sliced by the depth sort.
//  - The middle of every room only gets flat decals: combat space stays readable.
//  - Props are cosmetic: the simulation never sees them, heroes walk straight through.
//  - Typed rooms (MapState.rooms, map generation tier 2) are designed first by roomDressing.ts (tier 3): their floor
//    treatment, furniture, wall decor and the props standing in for the furniture the simulation carved. The generic
//    layers below then fill in around them, lighter inside designed rooms.
//  - Chasm tiles (MapState.voids) are walls to the simulation but drawn as a bottomless drop: no masonry, no wall
//    dressing; the floor's edge hangs over them as a cliff.

import { mapArena, mapBossSpawn, mapRooms, mapVoids, type MapRoom } from '@cursebound/simulation';
import { CLUTTER_PROP_IDS, PROPS, type PropDef } from '../art/dungeonData';
import { PILLAR_H, THEME_ART, THEME_IDS, type ThemeId } from '../art/dungeonThemes';
import { THEME_DRESSING, VIGNETTES, type ThemeDressing, type Vignette } from '../art/vignettes';
import { EDGE_KINDS } from '../art/ambientArt';
import { HH, HW, STUB_H, WALL_H, iso } from './iso';
import { DECO, type DecoName } from '../art/isoFloor';
import { ROOM_FLOOR, ROOM_FLOOR_NAMES } from '../art/isoRoomFloor';
import { DESIGNED_FLOOR, KIND_VIGNETTES, planRooms, roomOwners, type RoomCtx } from './roomDressing';

export interface DressMap {
  w: number;
  h: number;
  tiles: number[];
  decorSeed: number;
  theme?: string;
  playerSpawns?: { x: number; y: number }[];
  enemySpawns?: { x: number; y: number }[];
  /** layout family + replicated room plan (mapgen encodeTopology) */
  topology?: string;
  rooms?: MapRoom[];
  voids?: number[];
  arena?: string;
  bossSpawn?: { x: number; y: number };
}

/** Planner options: `density` scales optional cosmetic decor (gfx decorDensity; 1 = the authored amount). */
export interface DressOpts {
  density?: number;
}

/** A prop drawn in place of a free-standing wall piece the simulation carved (room furniture). */
export interface PlanBlocker {
  x: number;
  y: number;
  id: string;
  frame: number;
  flip: boolean;
}

/** A flat image baked into the floor render texture. World tile coords; origin defaults to the centre. */
export interface PlanStamp {
  key: string;
  frame: number;
  x: number;
  y: number;
  flip?: boolean;
  flipY?: boolean;
  sx?: number;
  sy?: number;
  alpha?: number;
  tint?: number;
  /** use the prop's own origin (low props) instead of the centre */
  prop?: string;
}

export interface PlanSprite {
  id: string;
  x: number;
  y: number;
  flip: boolean;
  frame: number;
  /** 'row' sorts with actors and walls; 'flat' lies on the floor under everything */
  layer: 'row' | 'flat';
  /** keep the prop's light (lights are budgeted per map) */
  light: boolean;
  /** extra depth (x10 units) */
  bias: number;
  /** placed by a vignette (kept when budgets trim) */
  vignette?: string;
}

export interface FaceDress {
  id: string;
  torch: boolean;
  frame: number;
  /** keep the light of a glowing wall piece (budgeted) */
  light: boolean;
}

export interface PlanWall {
  x: number;
  y: number;
  kind: 'pillar' | 'pair' | 'stub' | 'block';
  /** L = south-west face (floor to the south), R = south-east face (floor to the east) */
  L?: FaceDress | null;
  R?: FaceDress | null;
}

export interface PlanTrail {
  kind: 'boots' | 'drag' | 'blood' | 'paws';
  pts: { x: number; y: number }[];
  tint: number;
}

export interface PlanEmitter {
  kind: 'smoke' | 'steam' | 'spores' | 'embers' | 'wisp' | 'sparks';
  x: number;
  y: number;
  /** px above the ground */
  z: number;
  rate: number;
}

export interface PlanAmbient {
  theme: ThemeId;
  /** wall-hugging rat runs: world start / end points */
  rats: { x0: number; y0: number; x1: number; y1: number }[];
  /** cobweb corners (world point of the inside corner at floor level) */
  webs: { x: number; y: number; z: number; depth: number }[];
  flies: { x: number; y: number; z: number }[];
  emitters: PlanEmitter[];
  /** water drips: world floor point under a wall top */
  drips: { x: number; y: number }[];
  bats: boolean;
  gusts: boolean;
  ratCount: number;
}

export interface PlanRoom {
  core: number;
  area: number;
  cx: number;
  cy: number;
  vignettes: { id: string; x: number; y: number; side: 'n' | 'w'; cells: number[] }[];
}

export interface DressingPlan {
  theme: ThemeId;
  /** floor-baked layers, drawn in this order */
  grime: PlanStamp[];
  edges: PlanStamp[];
  decals: PlanStamp[];
  trails: PlanTrail[];
  shadows: { x: number; y: number; rx: number; ry: number; a: number }[];
  low: PlanStamp[];
  sprites: PlanSprite[];
  walls: PlanWall[];
  cobwebs: { x: number; y: number }[];
  ambient: PlanAmbient;
  rooms: PlanRoom[];
  /** tiles any prop or vignette occupies (tests: the room middles stay clear) */
  occupied: number[];
  /** tile-aligned floor overlays (iso:deco frames), in back-to-front order; all walkable decor */
  floor: PlanFloor[];
  /** slab side faces hanging into the chasm under front walls with nothing but rock beyond */
  cliffs: { x: number; y: number; L: boolean; R: boolean; v: number }[];
  /** shafts of light falling through cracks in the vault (world point on the floor) */
  shafts: { x: number; y: number; w: number }[];
  /** low fog banks drifting over the floor (world point, size in tiles) */
  fog: { x: number; y: number; r: number }[];
  /** per-room floor treatments (iso:room frames: rugs, pools, planks, marble, sand, medallions), back-to-front */
  roomFloor: PlanFloor[];
  /** props standing in for room furniture the simulation carved (keyed by the free-standing wall tile) */
  blockers: PlanBlocker[];
  /** chasm tiles (indices) and the cliff faces of floor tiles at the brink: L = drop to the south, R = to the east */
  voids: number[];
  voidCliffs: { x: number; y: number; L: boolean; R: boolean; v: number; bridge: boolean }[];
  /** the typed rooms the plan dressed (tier 2 data) */
  typed: MapRoom[];
  stats: { ms: number; stamps: number; sprites: number; lights: number; vignettes: number };
}

/** A floor overlay on tile (x, y) (drawn centred on the tile). */
export interface PlanFloor {
  frame: number;
  x: number;
  y: number;
}

/** A tiny rectangle of a trail, in screen px (relative to the iso origin). */
export interface TrailMark { x: number; y: number; w: number; h: number; color: number; a: number }

/**
 * Rasterise a trail into small marks: boot prints alternate left / right of the path, paws come in little
 * clusters, drag marks are two broken parallel smears, blood is a run of uneven drops.
 */
export function trailMarks(t: PlanTrail): TrailMark[] {
  const out: TrailMark[] = [];
  const pts = t.pts.map((p) => iso.p(p.x, p.y));
  let rem = 0, n = 0;
  const step = t.kind === 'boots' ? 7 : t.kind === 'paws' ? 6 : t.kind === 'blood' ? 5 : 1.5;
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k]!, b = pts[k + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.01) continue;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const nx = -uy, ny = ux;
    let s = rem;
    for (; s < len; s += step) {
      const x = a.x + ux * s, y = a.y + uy * s;
      const fade = Math.min(1, n / 6) * Math.min(1, (pts.length - k) / 4);
      const r = hash(n, k, 977);
      if (t.kind === 'boots') {
        const side = n % 2 ? 1 : -1;
        const px = Math.round(x + nx * side * 2), py = Math.round(y + ny * side * 1.2);
        out.push({ x: px, y: py, w: 2, h: 1, color: t.tint, a: 0.34 * fade });
        out.push({ x: px + Math.round(ux), y: py + 1, w: 1, h: 1, color: t.tint, a: 0.28 * fade });
      } else if (t.kind === 'paws') {
        const side = n % 2 ? 1 : -1;
        const px = Math.round(x + nx * side * 1.5), py = Math.round(y + ny * side);
        out.push({ x: px, y: py, w: 1, h: 1, color: t.tint, a: 0.36 * fade });
        out.push({ x: px + 1, y: py - 1, w: 1, h: 1, color: t.tint, a: 0.28 * fade });
        out.push({ x: px - 1, y: py - 1, w: 1, h: 1, color: t.tint, a: 0.28 * fade });
      } else if (t.kind === 'drag') {
        if (r < 0.82) {
          out.push({ x: Math.round(x + nx * 2), y: Math.round(y + ny * 1.4), w: 1, h: 1, color: t.tint, a: 0.4 * fade });
          if (r < 0.7) out.push({ x: Math.round(x - nx * 2), y: Math.round(y - ny * 1.4), w: 1, h: 1, color: t.tint, a: 0.36 * fade });
        }
        if (r > 0.985) out.push({ x: Math.round(x), y: Math.round(y), w: 2, h: 1, color: t.tint, a: 0.6 * fade });
      } else {
        const big = r > 0.7;
        const jx = (hash(k, n, 979) - 0.5) * 3;
        out.push({ x: Math.round(x + jx), y: Math.round(y), w: big ? 2 : 1, h: 1, color: t.tint, a: (big ? 0.7 : 0.55) * fade });
        if (r > 0.9) out.push({ x: Math.round(x + jx + 1), y: Math.round(y + 1), w: 2, h: 1, color: t.tint, a: 0.45 * fade });
      }
      n++;
    }
    rem = s - len;
  }
  return out;
}

// ---------------------------------------------------------------- utils

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

function pick(list: { id: string; weight: number }[], r: number): string | null {
  const total = list.reduce((s, x) => s + Math.max(0, x.weight), 0);
  if (total <= 0) return null;
  let t = r * total;
  for (const x of list) {
    t -= Math.max(0, x.weight);
    if (t <= 0) return x.id;
  }
  return list[list.length - 1]!.id;
}

/** Axis-aligned rect vs convex polygon (flat [x,y,...]) overlap, separating axis test. */
function rectHitsPoly(x0: number, y0: number, x1: number, y1: number, poly: number[]): boolean {
  let px0 = Infinity, py0 = Infinity, px1 = -Infinity, py1 = -Infinity, cx = 0, cy = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const x = poly[i * 2]!, y = poly[i * 2 + 1]!;
    px0 = Math.min(px0, x); px1 = Math.max(px1, x); py0 = Math.min(py0, y); py1 = Math.max(py1, y);
    cx += x / n; cy += y / n;
  }
  if (x1 <= px0 || x0 >= px1 || y1 <= py0 || y0 >= py1) return false;
  const corners = [x0, y0, x1, y0, x1, y1, x0, y1];
  for (let i = 0; i < n; i++) {
    const ax = poly[i * 2]!, ay = poly[i * 2 + 1]!;
    const bx = poly[((i + 1) % n) * 2]!, by = poly[((i + 1) % n) * 2 + 1]!;
    let nx = by - ay, ny = ax - bx;
    if ((cx - ax) * nx + (cy - ay) * ny > 0) { nx = -nx; ny = -ny; }
    let outside = true;
    for (let k = 0; k < 4; k++) if ((corners[k * 2]! - ax) * nx + (corners[k * 2 + 1]! - ay) * ny <= 0.01) { outside = false; break; }
    if (outside) return false;
  }
  return true;
}

const MAX_LIGHTS = 16;
/** Room floor frames that cover their tile (the generic wear and features stay off them). */
const FULL_ROOM_FLOOR: ReadonlySet<number> = new Set(ROOM_FLOOR_NAMES.filter((n) => /^(rug|pool|plank|bridge|checker|bones|sand|mos|sigil|rose)/.test(n)).map((n) => ROOM_FLOOR[n]));
/** Props from clutter.ts draw their own soft contact shadow; older props get one baked into the floor. */
const CLUTTER_SET = new Set<string>(CLUTTER_PROP_IDS);
const ORTHO: [number, number][] = [[0, -1], [-1, 0], [0, 1], [1, 0]];
const EIGHT: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];

// ---------------------------------------------------------------- planner

export function planDressing(map: DressMap, opts: DressOpts = {}): DressingPlan {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const theme: ThemeId = (THEME_IDS as readonly string[]).includes(map.theme ?? '') ? (map.theme as ThemeId) : 'catacombs';
  const art = THEME_ART[theme];
  const dress: ThemeDressing = THEME_DRESSING[theme];
  const W = map.w, H = map.h;
  const seed = (map.decorSeed + 17) >>> 0;
  const rand = mulberry(seed * 2654435761 + 7);
  const density = Math.max(0, opts.density ?? 1);
  const idx = (x: number, y: number): number => y * W + x;
  const wire = { topology: map.topology ?? '', rooms: map.rooms, voids: map.voids, arena: map.arena, bossSpawn: map.bossSpawn };
  const voidMask = new Uint8Array(W * H);
  const voidList = mapVoids(wire).filter((i) => i >= 0 && i < W * H && map.tiles[i] === 1);
  for (const i of voidList) voidMask[i] = 1;
  const isVoid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && voidMask[idx(x, y)] === 1;
  /** masonry: a wall tile that is not chasm (outside the map counts as rock) */
  const isWall = (x: number, y: number): boolean => x < 0 || y < 0 || x >= W || y >= H || (map.tiles[idx(x, y)] === 1 && !voidMask[idx(x, y)]);
  const isFloor = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && map.tiles[idx(x, y)] !== 1;

  // free-standing pieces (pillars, paired sarcophagi) are furniture of a room, not its boundary
  const freeStanding = (x: number, y: number): boolean => {
    if (!isWall(x, y) || x < 0 || y < 0 || x >= W || y >= H) return false;
    const fN = isFloor(x, y - 1), fS = isFloor(x, y + 1), fE = isFloor(x + 1, y), fW = isFloor(x - 1, y);
    if (fN && fS && fE && fW) return true;
    const pairL = isWall(x + 1, y) && fW && !isWall(x + 2, y) && fN && fS && !isWall(x + 1, y - 1) && !isWall(x + 1, y + 1);
    const pairR = isWall(x - 1, y) && fE && !isWall(x - 2, y) && fN && fS && !isWall(x - 1, y - 1) && !isWall(x - 1, y + 1);
    return pairL || pairR;
  };
  const solid = (x: number, y: number): boolean => (isWall(x, y) && !freeStanding(x, y)) || isVoid(x, y);
  const isOpen = (x: number, y: number): boolean => !solid(x, y);

  // ---- distance to the nearest boundary wall (8-neighbour BFS; floor next to a wall = 1)
  const dist = new Int16Array(W * H).fill(-1);
  const queue: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (solid(x, y)) continue;
    if (EIGHT.some(([dx, dy]) => solid(x + dx, y + dy))) { dist[idx(x, y)] = 1; queue.push(idx(x, y)); }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!, x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of EIGHT) {
      const nx = x + dx, ny = y + dy;
      if (!isOpen(nx, ny) || nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = idx(nx, ny);
      if (dist[j] !== -1) continue;
      dist[j] = dist[i]! + 1;
      queue.push(j);
    }
  }
  const D = (x: number, y: number): number => (isFloor(x, y) ? dist[idx(x, y)]! : 0);
  /** distance for room detection: free-standing pillars count as open floor */
  const Dr = (x: number, y: number): number => (x >= 0 && y >= 0 && x < W && y < H && isOpen(x, y) ? Math.max(0, dist[idx(x, y)]!) : 0);

  // ---- wall classification (mirrors the renderer) + screen hexagons for the occlusion test
  const wallKind = new Map<number, PlanWall['kind']>();
  const walls: PlanWall[] = [];
  const wallPoly = new Map<number, { poly: number[]; depth: number }>();
  const wkey = (x: number, y: number): number => (y + 2) * (W + 4) + (x + 2);
  for (let y = -1; y <= H; y++) for (let x = -1; x <= W; x++) {
    if (!isWall(x, y)) continue;
    if (!EIGHT.some(([dx, dy]) => isFloor(x + dx, y + dy))) continue;
    const fS = isFloor(x, y + 1), fE = isFloor(x + 1, y), fSE = isFloor(x + 1, y + 1);
    const fN = isFloor(x, y - 1), fW = isFloor(x - 1, y);
    const isolated = fN && fS && fE && fW;
    const pairL = isWall(x + 1, y) && fW && !isWall(x + 2, y) && fN && fS && !isWall(x + 1, y - 1) && !isWall(x + 1, y + 1);
    const pairR = isWall(x - 1, y) && fE && !isWall(x - 2, y) && fN && fS && !isWall(x - 1, y - 1) && !isWall(x - 1, y + 1);
    const kind: PlanWall['kind'] = isolated ? 'pillar' : pairL || pairR ? 'pair' : fS || fE || fSE ? 'block' : 'stub';
    wallKind.set(wkey(x, y), kind);
    const w: PlanWall = { x, y, kind };
    if (kind === 'block') {
      if (fS) w.L = null;
      if (fE) w.R = null;
    }
    walls.push(w);
    const T = iso.p(x, y), c = iso.p(x + 0.5, y + 0.5);
    const depth = (x + y + 1) * 10;
    let poly: number[];
    if (kind === 'pillar') poly = [c.x - 15, c.y + 8 - PILLAR_H, c.x + 15, c.y + 8 - PILLAR_H, c.x + 15, c.y + 8, c.x - 15, c.y + 8];
    else if (kind === 'pair') poly = [c.x - 15, c.y + 8 - 46, c.x + 15, c.y + 8 - 46, c.x + 15, c.y + 8, c.x - 15, c.y + 8];
    else {
      const hh = kind === 'stub' ? STUB_H : WALL_H;
      poly = [T.x, T.y - hh, T.x + HW, T.y + HH - hh, T.x + HW, T.y + HH, T.x, T.y + HH * 2, T.x - HW, T.y + HH, T.x - HW, T.y + HH - hh];
    }
    wallPoly.set(wkey(x, y), { poly, depth });
  }

  /** Would any wall drawn later than this sprite cut into it? */
  const occluded = (def: PropDef, px: number, py: number, flip: boolean, depth: number): boolean => {
    const w = def.w ?? 32, h = def.h ?? 32;
    const s = iso.p(px, py);
    const left = (flip ? 1 - def.originX : def.originX) * w;
    const x0 = s.x - left + 2, x1 = s.x - left + w - 2, y0 = s.y - def.originY * h + 2, y1 = s.y + (1 - def.originY) * h - 1;
    const tx = Math.floor(px), ty = Math.floor(py);
    for (let y = ty - 3; y <= ty + 3; y++) for (let x = tx - 3; x <= tx + 3; x++) {
      const wp = wallPoly.get(wkey(x, y));
      if (!wp || wp.depth <= depth) continue;
      if (rectHitsPoly(x0, y0, x1, y1, wp.poly)) return true;
    }
    return false;
  };

  // ---- rooms: connected cores (dist >= 3), band tiles assigned to the nearest core
  const roomOf = new Int16Array(W * H).fill(-1);
  const rooms: PlanRoom[] = [];
  const coreCells: number[][] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    if (Dr(x, y) < 3 || roomOf[i] !== -1) continue;
    const id = rooms.length;
    const cells: number[] = [i];
    roomOf[i] = id;
    for (let q = 0; q < cells.length; q++) {
      const c = cells[q]!, cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of ORTHO) {
        const nx = cx + dx, ny = cy + dy;
        if (Dr(nx, ny) < 3 || roomOf[idx(nx, ny)] !== -1) continue;
        roomOf[idx(nx, ny)] = id;
        cells.push(idx(nx, ny));
      }
    }
    let sx = 0, sy = 0;
    for (const c of cells) { sx += c % W; sy += (c / W) | 0; }
    rooms.push({ core: cells.length, area: cells.length, cx: sx / cells.length + 0.5, cy: sy / cells.length + 0.5, vignettes: [] });
    coreCells.push(cells);
  }
  {
    // grow rooms into their bands (3 steps)
    let frontier: number[] = coreCells.flat();
    for (let step = 0; step < 3; step++) {
      const next: number[] = [];
      for (const c of frontier) {
        const cx = c % W, cy = (c / W) | 0, r = roomOf[c]!;
        for (const [dx, dy] of ORTHO) {
          const nx = cx + dx, ny = cy + dy;
          if (!isFloor(nx, ny)) continue;
          const j = idx(nx, ny);
          if (roomOf[j] !== -1) continue;
          roomOf[j] = r;
          rooms[r]!.area++;
          next.push(j);
        }
      }
      frontier = next;
    }
  }

  // ---- reservations: spawn points stay clear
  const reserved = new Uint8Array(W * H);
  for (const s of [...(map.playerSpawns ?? []), ...(map.enemySpawns ?? [])]) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = Math.floor(s.x) + dx, y = Math.floor(s.y) + dy;
      if (isFloor(x, y)) reserved[idx(x, y)] = 1;
    }
  }
  const occupied = new Uint8Array(W * H);   // 1 = prop, 2 = vignette footprint, 3 = vignette margin
  const standing = new Uint8Array(W * H);

  const plan: DressingPlan = {
    theme, grime: [], edges: [], decals: [], trails: [], shadows: [], low: [], sprites: [], walls, cobwebs: [],
    ambient: { theme, rats: [], webs: [], flies: [], emitters: [], drips: [], bats: dress.critters.bats, gusts: dress.critters.gusts, ratCount: dress.critters.rats },
    rooms, occupied: [], floor: [], cliffs: [], shafts: [], fog: [], roomFloor: [], blockers: [], voids: voidList, voidCliffs: [], typed: [],
    stats: { ms: 0, stamps: 0, sprites: 0, lights: 0, vignettes: 0 },
  };
  let lights = 0;
  const swap = (id: string): string => (dress.swap[id] && PROPS[dress.swap[id]!] ? dress.swap[id]! : id);

  const addFx = (def: PropDef, px: number, py: number, flip: boolean): void => {
    for (const f of def.fx ?? []) {
      // fx offsets are sprite px from the origin; convert the horizontal part back to a world nudge
      const dx = (flip ? -f.dx : f.dx) / (HW * 2);
      const wx = px + dx, wy = py - dx;
      const z = -f.dy;
      if (f.kind === 'flies') plan.ambient.flies.push({ x: wx, y: wy, z });
      else plan.ambient.emitters.push({ kind: f.kind, x: wx, y: wy, z, rate: f.rate ?? 1 });
    }
  };

  /** Place one prop. Returns false if it does not fit. */
  const place = (id: string, px: number, py: number, flip: boolean, frameSeed: number, vignette?: string): boolean => {
    const def = PROPS[id];
    if (!def || def.blocks || def.placement === 'wallFace') return false;
    const tx = Math.floor(px), ty = Math.floor(py);
    if (!isFloor(tx, ty)) return false;
    const frames = def.frames ?? 1;
    const frame = def.variants && frames > 1 ? Math.floor(frameSeed * frames) % frames : 0;
    if (def.low) {
      plan.low.push({ key: def.key, frame, x: px, y: py, flip, prop: id });
      addFx(def, px, py, flip);
      return true;
    }
    if (def.flat) {
      let light = !!def.light;
      if (light && lights >= MAX_LIGHTS) light = false;
      if (light) lights++;
      plan.sprites.push({ id, x: px, y: py, flip, frame, layer: 'flat', light, bias: 0, vignette });
      addFx(def, px, py, flip);
      return true;
    }
    const depth = (px + py) * 10;
    if (occluded(def, px, py, flip, depth)) return false;
    let light = !!def.light;
    if (light && lights >= MAX_LIGHTS) light = false;
    if (light) lights++;
    plan.sprites.push({ id, x: px, y: py, flip, frame, layer: 'row', light, bias: 0, vignette });
    if (!CLUTTER_SET.has(id)) {
      const rx = Math.min(16, (def.w ?? 20) * 0.36);
      plan.shadows.push({ x: px, y: py, rx, ry: rx * 0.42, a: 0.32 });
    }
    addFx(def, px, py, flip);
    return true;
  };

  // ---- vignettes
  const usedOnMap = new Map<string, number>();
  const faceRequests = new Map<string, string>();   // `${x},${y},${side}` -> wall prop id
  const faceBlocked = new Set<string>();
  const trailsWanted: { kind: NonNullable<Vignette['trail']>; x: number; y: number }[] = [];

  // ---- typed rooms first (tier 3, roomDressing.ts): their floors, furniture, wall decor and blocker props
  const typed = mapRooms(wire);
  plan.typed = typed;
  const owner = roomOwners(W, H, typed, isFloor);
  const kindAt = (x: number, y: number): MapRoom['kind'] | null => {
    const o = isFloor(x, y) ? owner[idx(x, y)]! : -1;
    return o >= 0 ? typed[o]!.kind : null;
  };
  const roomFloorAt = new Map<number, number>();   // tile -> iso:room frame (the last one laid wins)
  const extraDeco: PlanFloor[] = [];
  const blockerAt = new Map<number, PlanBlocker>();
  /** Stand a hug prop against the back wall of floor tile (x, y), sliding along the wall until it fits. */
  const hugAt = (id: string, x: number, y: number, side: 'n' | 'w', frameSeed: number): boolean => {
    const def = PROPS[id];
    if (!def) return false;
    const hd = def.hug ? (def.hugDepth ?? 0.3) / 2 + 0.03 : 0.3;
    for (const du of [0.5, 0.38, 0.26, 0.62]) {
      const px = side === 'n' ? x + du : x + hd, py = side === 'n' ? y + hd : y + du;
      if (place(id, px, py, side === 'w', frameSeed)) {
        faceBlocked.add(side === 'n' ? `${x},${y - 1},L` : `${x - 1},${y},R`);
        return true;
      }
    }
    return false;
  };
  const shallow = (x: number, y: number): boolean => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || map.tiles[idx(xx, yy)] === 1) return true;
    }
    return false;
  };
  // themes that re-dress the dungeon's furniture in their own (sky, moon, server room: vignettes.ts `rooms`)
  const roomProp = (id: string): string => (dress.rooms?.[id] && PROPS[dress.rooms[id]!] ? dress.rooms[id]! : id);
  const ctx: RoomCtx = {
    W, H, theme, seed, density, arena: mapArena(wire), boss: mapBossSpawn(wire),
    isFloor, isWall, isVoid, freeStanding, shallow, reserved, occupied, owner,
    place: (id, px, py, flip, fs) => place(roomProp(id), px, py, flip, fs),
    hug: (id, x, y, side, fs) => hugAt(roomProp(id), x, y, side, fs),
    face: (wx, wy, side, id) => { const rid = roomProp(id); if (PROPS[rid]) faceRequests.set(`${wx},${wy},${side}`, rid); },
    floor: (name, x, y) => { if (isFloor(x, y) && ROOM_FLOOR[name] !== undefined) roomFloorAt.set(idx(x, y), ROOM_FLOOR[name]); },
    deco: (name, x, y) => { if (isFloor(x, y)) extraDeco.push({ frame: DECO[name], x, y }); },
    decal: (key, frame, x, y, o = {}) => plan.decals.push({ key, frame, x, y, sx: o.sx, sy: o.sy, alpha: o.alpha, tint: o.tint, flip: o.flip }),
    blocker: (x, y, bid, frame = 0, flip = false) => {
      const id = roomProp(bid);
      const def = PROPS[id];
      if (!def || !freeStanding(x, y)) return;
      const frames = def.frames ?? 1;
      blockerAt.set(idx(x, y), { x, y, id, frame: def.variants && frames > 1 ? frame % frames : 0, flip });
    },
    shaft: (x, y, w) => { if (isFloor(Math.floor(x), Math.floor(y))) plan.shafts.push({ x, y, w }); },
    drip: (x, y) => plan.ambient.drips.push({ x, y }),
    emitter: (kind, x, y, z, rate) => plan.ambient.emitters.push({ kind, x, y, z, rate }),
  };
  planRooms(ctx, typed);

  const footprintFits = (v: Vignette, ax: number, ay: number, side: 'n' | 'w'): number[] | null => {
    // scenes occupy at most the two tile rows next to the wall: the room core (3+ tiles in) is never touched
    const L = Math.ceil(v.len - 0.01), Dp = Math.min(2, Math.ceil(v.depth - 0.01));
    const at = (u: number, w: number): [number, number] => (side === 'n' ? [ax + u, ay + w] : [ax + w, ay + u]);
    const cells: number[] = [];
    for (let i = 0; i < L; i++) {
      // continuous back wall behind the whole length
      const [bx, by] = side === 'n' ? [ax + i, ay - 1] : [ax - 1, ay + i];
      if (!isWall(bx, by)) return null;
      for (let j = 0; j < Dp; j++) {
        const [x, y] = at(i, j);
        if (!isFloor(x, y)) return null;
        const c = idx(x, y);
        if (reserved[c] || occupied[c]) return null;
        cells.push(c);
      }
      // at least as much open floor beyond the scene as the scene is deep: the middle stays clear
      for (let j = Dp; j < Dp * 2 + 1; j++) {
        const [x, y] = at(i, j);
        if (!isOpen(x, y) || x < 0 || y < 0 || x >= W || y >= H) return null;
      }
    }
    if (v.corner) {
      for (let j = 0; j < Dp; j++) {
        const [sx, sy] = side === 'n' ? [ax - 1, ay + j] : [ax + j, ay - 1];
        if (!isWall(sx, sy)) return null;
      }
    }
    return cells;
  };

  const placeVignette = (room: PlanRoom, rid: number, v: Vignette, ax: number, ay: number, side: 'n' | 'w', cells: number[]): boolean => {
    const vr = mulberry(seed ^ (ax * 7919 + ay * 104729 + rid * 31));
    const at = (u: number, w: number): [number, number] => (side === 'n' ? [ax + u, ay + w] : [ax + w, ay + u]);
    let placed = 0;
    v.items.forEach((it, k) => {
      if (it.p !== undefined && vr() > it.p) return;
      const id = swap(it.id);
      const def = PROPS[id];
      if (!def) return;
      const u = it.u;
      const w = def.hug ? (def.hugDepth ?? 0.3) / 2 + 0.03 : it.v;
      const flip = side === 'w' ? !it.flip : !!it.flip;
      // hug props slide along the wall until no later wall cuts into them
      const tries = def.hug ? [0, -0.12, -0.24, -0.36, 0.12, -0.48] : [0, 0.12, -0.12];
      for (const du of tries) {
        const [px, py] = at(u + du, w);
        if (place(id, px, py, flip, hash(ax + k, ay, seed + 41), v.id)) {
          placed++;
          if (def.hug) {
            // the wall face right behind a tall piece stays bare
            const ti = Math.floor(u + du);
            const [fx, fy] = side === 'n' ? [ax + ti, ay - 1] : [ax - 1, ay + ti];
            faceBlocked.add(`${fx},${fy},${side === 'n' ? 'L' : 'R'}`);
          }
          return;
        }
      }
    });
    if (placed < Math.min(2, v.items.length)) return false;
    for (const d of v.decals ?? []) {
      if (d.p !== undefined && vr() > d.p) continue;
      const [px, py] = at(d.u, d.v);
      plan.decals.push({ key: d.key, frame: d.frame ?? 0, x: px, y: py, sx: d.sx, sy: d.sy, tint: d.tint, alpha: d.alpha, flip: side === 'w' });
    }
    for (const wl of v.walls ?? []) {
      const ti = Math.floor(wl.u);
      const [fx, fy] = side === 'n' ? [ax + ti, ay - 1] : [ax - 1, ay + ti];
      const key = `${fx},${fy},${side === 'n' ? 'L' : 'R'}`;
      if (!faceBlocked.has(key)) faceRequests.set(key, swap(wl.id));
    }
    for (const c of cells) occupied[c] = 2;
    // keep a one-tile margin so two scenes never merge into one heap
    for (const c of cells) {
      const cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of EIGHT) if (isFloor(cx + dx, cy + dy) && !occupied[idx(cx + dx, cy + dy)]) occupied[idx(cx + dx, cy + dy)] = 3;
    }
    const [mx, my] = at(v.len / 2, v.depth / 2);
    room.vignettes.push({ id: v.id, x: mx, y: my, side, cells });
    if (v.trail) trailsWanted.push({ kind: v.trail, x: mx, y: my });
    usedOnMap.set(v.id, (usedOnMap.get(v.id) ?? 0) + 1);
    plan.stats.vignettes++;
    return true;
  };

  rooms.forEach((room, rid) => {
    const want = Math.min(3, room.area < 45 ? 1 : room.area < 110 ? 2 : 3);
    // inside a typed room only a scene that suits its purpose (and only one); arenas and bridges keep their set pieces
    const kind = kindAt(Math.floor(room.cx), Math.floor(room.cy));
    const suits = kind ? KIND_VIGNETTES[kind] : undefined;
    const n = kind && !suits ? 0 : kind ? 1 : Math.max(1, want - (rand() < 0.25 ? 1 : 0));
    // candidate anchors: band tiles touching a back wall, in a seeded order
    const cands: { x: number; y: number; side: 'n' | 'w'; r: number }[] = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      if (roomOf[i] !== rid || D(x, y) !== 1 || reserved[i]) continue;
      if (isWall(x, y - 1)) cands.push({ x, y, side: 'n', r: hash(x, y, seed + 101) });
      if (isWall(x - 1, y)) cands.push({ x, y, side: 'w', r: hash(x, y, seed + 103) });
    }
    cands.sort((a, b) => a.r - b.r);
    const usedHere = new Set<string>();
    for (let k = 0; k < n; k++) {
      const source = suits ? suits.map((id) => ({ id, weight: dress.vignettes.find((v) => v.id === id)?.weight ?? 1 })) : dress.vignettes;
      const pool = source
        .filter((v) => !usedHere.has(v.id) && VIGNETTES[v.id])
        .map((v) => ({ id: v.id, weight: (usedOnMap.get(v.id) ?? 0) > 0 ? v.weight * 0.12 : v.weight }));
      let done = false;
      for (let attempt = 0; attempt < 3 && !done && pool.length; attempt++) {
        const vid = pick(pool, rand());
        if (!vid) break;
        const v = VIGNETTES[vid]!;
        for (const c of cands) {
          const cells = footprintFits(v, c.x, c.y, c.side);
          if (!cells) continue;
          if (placeVignette(room, rid, v, c.x, c.y, c.side, cells)) { usedHere.add(vid); done = true; break; }
        }
        if (!done) pool.splice(pool.findIndex((p) => p.id === vid), 1);
      }
    }
  });

  // ---- braziers in the open (kept from the original dressing; at most 4)
  let braziers = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (!isFloor(x, y) || D(x, y) < 2) continue;
    const r = hash(x, y, seed + 7);
    const k = kindAt(x, y);
    if (k && k !== 'hall') continue;
    if (braziers < 4 && r < 0.014 * density && x > 3 && x < W - 4 && !occupied[idx(x, y)] && !reserved[idx(x, y)]) {
      if (place('brazier', x + 0.5, y + 0.5, false, 0)) { braziers++; occupied[idx(x, y)] = 1; }
    }
  }

  // ---- scattered clutter along the walls
  const standingPool = [
    ...art.props.filter((p) => PROPS[p.id] && !PROPS[p.id]!.low && !PROPS[p.id]!.blocks && PROPS[p.id]!.placement === 'floor' && p.id !== 'brazier'),
    ...dress.standing.filter((p) => PROPS[p.id]),
  ];
  const lowPool = [...art.props.filter((p) => PROPS[p.id]?.low), ...dress.low.filter((p) => PROPS[p.id])];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (!isFloor(x, y)) continue;
    const i = idx(x, y);
    if (occupied[i] === 1 || occupied[i] === 2 || reserved[i]) continue;
    const d = D(x, y);
    const r = hash(x, y, seed + 7);
    const backN = isWall(x, y - 1), backW = isWall(x - 1, y);
    const frontS = isWall(x, y + 1), frontE = isWall(x + 1, y);
    // optional clutter follows the decor density, and thins out inside rooms that carry their own design
    const k = kindAt(x, y);
    const dens = density * (k && k !== 'hall' ? 0.45 : 1);
    if (d === 1 && (backN || backW) && r < 0.28 * dens && occupied[i] !== 3) {
      // no two standing pieces side by side
      if (EIGHT.some(([dx, dy]) => isFloor(x + dx, y + dy) && standing[idx(x + dx, y + dy)])) continue;
      const id = pick(standingPool, hash(x, y, seed + 8));
      const def = id ? PROPS[id] : undefined;
      if (!id || !def) continue;
      let ok = false;
      if (def.hug) {
        const sides: ('n' | 'w')[] = backN && backW ? (hash(x, y, seed + 9) < 0.5 ? ['n', 'w'] : ['w', 'n']) : backN ? ['n'] : ['w'];
        for (const side of sides) {
          const hd = (def.hugDepth ?? 0.3) / 2 + 0.03;
          for (const du of [0.5, 0.38, 0.26, 0.62]) {
            const px = side === 'n' ? x + du : x + hd, py = side === 'n' ? y + hd : y + du;
            if (place(id, px, py, side === 'w', hash(x, y, seed + 10))) {
              ok = true;
              faceBlocked.add(side === 'n' ? `${x},${y - 1},L` : `${x - 1},${y},R`);
              break;
            }
          }
          if (ok) break;
        }
      } else {
        const nx = backW ? -0.22 : frontE ? 0.05 : 0, ny = backN ? -0.22 : frontS ? 0.05 : 0;
        const flip = hash(x, y, seed + 11) < 0.5;
        ok = place(id, x + 0.5 + nx, y + 0.5 + ny, flip, hash(x, y, seed + 10)) || place(id, x + 0.5, y + 0.5, flip, hash(x, y, seed + 10));
      }
      if (ok) { occupied[i] = 1; standing[i] = 1; }
      continue;
    }
    if (d <= 2 && r > 0.3 && r < 0.3 + 0.09 * dens && lowPool.length) {
      const id = pick(lowPool, hash(x, y, seed + 12));
      if (!id) continue;
      const jx = (hash(x, y, seed + 13) - 0.5) * 0.4, jy = (hash(x, y, seed + 14) - 0.5) * 0.4;
      if (place(id, x + 0.5 + jx, y + 0.5 + jy, hash(x, y, seed + 15) < 0.5, hash(x, y, seed + 16))) occupied[i] = 1;
    }
  }

  // ---- cobwebs in inside corners of tall walls (and spiders living in some of them)
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (!isFloor(x, y) || !isWall(x - 1, y) || !isWall(x, y - 1)) continue;
    if (hash(x, y, seed + 7) >= 0.5) continue;
    plan.cobwebs.push({ x, y });
    if (dress.critters.spiders && hash(x, y, seed + 21) < 0.55) plan.ambient.webs.push({ x, y, z: WALL_H - 16, depth: (x + y + 1) * 10 - 9.5 });
  }

  // ---- wall faces: torches (fixed rhythm), vignette requests, then varied dressing
  const wallPool = [...art.wallProps, ...dress.wall].filter((p) => PROPS[p.id] && PROPS[p.id]!.placement !== 'floor');
  const faceId = new Map<string, string>();
  for (const w of walls) {
    if (w.kind !== 'block') continue;
    for (const side of ['L', 'R'] as const) {
      if (w[side] === undefined) continue;
      const { x, y } = w;
      const r = hash(x * 3 + (side === 'L' ? 0 : 7), y, seed + 5);
      const torch = (x * 7 + y * 3 + (side === 'L' ? 0 : 2)) % 5 === 0 && r < 0.9;
      const key = `${x},${y},${side}`;
      if (torch) {
        w[side] = { id: PROPS[art.torchProp]?.placement === 'wallFace' ? art.torchProp : 'torch', torch: true, frame: 0, light: true };
        faceId.set(key, 'torch');
        continue;
      }
      const req = faceRequests.get(key);
      const neighbours = side === 'L' ? [`${x - 1},${y},L`, `${x + 1},${y},L`, `${x},${y},R`] : [`${x},${y - 1},R`, `${x},${y + 1},R`, `${x},${y},L`];
      let id: string | null = null;
      if (req && PROPS[req]) id = req;
      else if (!faceBlocked.has(key) && r < 0.3 && wallPool.length) {
        for (let t = 0; t < 4 && !id; t++) {
          const cand = pick(wallPool, hash(x, y, seed + 6 + t * 13));
          if (cand && !neighbours.some((n) => faceId.get(n) === cand)) id = cand;
        }
      }
      if (!id) continue;
      const def = PROPS[id]!;
      const frames = def.frames ?? 1;
      const keepLight = !!def.light && lights < MAX_LIGHTS;
      if (keepLight) lights++;
      w[side] = { id, torch: false, frame: def.variants && frames > 1 ? Math.floor(hash(x, y, seed + 17) * frames) % frames : 0, light: keepLight };
      faceId.set(key, id);
      if (id === 'cobweb' && dress.critters.spiders && hash(x, y, seed + 22) < 0.5) {
        const fx = side === 'L' ? x + 0.5 : x + 1, fy = side === 'L' ? y + 1 : y + 0.5;
        plan.ambient.webs.push({ x: fx, y: fy, z: WALL_H - 20, depth: (x + y + 1) * 10 + 0.35 });
      }
    }
  }

  // ---- grime (one frame per stamp) and edge growth along the back walls
  const grime = art.grime.length ? art.grime : [];
  const edgeKind = Math.max(0, EDGE_KINDS.indexOf(dress.edge));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!isFloor(x, y)) continue;
    if (grime.length && hash(x, y, seed + 3) <= 0.1 * Math.min(1.3, density)) {
      const k = grime[Math.floor(hash(x, y, seed + 4) * grime.length)]!;
      plan.grime.push({
        key: k, frame: Math.floor(hash(x, y, seed + 18) * 3), x: x + 0.5 + (hash(x, y, 9) - 0.5) * 0.5, y: y + 0.5 + (hash(x, y, 10) - 0.5) * 0.5,
        sx: 1.4, sy: 0.7, flip: hash(x, y, 11) > 0.5, alpha: 0.9,
      });
    }
    if (isWall(x, y - 1) && hash(x, y, seed + 30) < dress.edgeChance) {
      plan.edges.push({ key: 'decal:edge', frame: edgeKind * 2 + (hash(x, y, seed + 31) < 0.5 ? 0 : 1), x: x + 0.5, y: y + 0.02 });
    }
    if (isWall(x - 1, y) && hash(x, y, seed + 32) < dress.edgeChance) {
      plan.edges.push({ key: 'decal:edge', frame: edgeKind * 2 + (hash(x, y, seed + 33) < 0.5 ? 0 : 1), x: x + 0.02, y: y + 0.5, flip: true });
    }
  }

  // ---- story decals sprinkled through the open floor (flat only: the middle stays readable)
  const story: { key: string; frames: number; w: number; tint?: number; alpha?: number; sx?: number; sy?: number }[] = [
    { key: 'decal:coins', frames: 3, w: 2 },
    { key: 'decal:claw', frames: 2, w: theme === 'frost' ? 0.5 : 1.5 },
    { key: 'decal:chalk', frames: 2, w: theme === 'flooded' ? 0.3 : 1 },
    { key: 'decal:blood', frames: 4, w: 2, tint: dress.trailTint, alpha: 0.55, sx: 1.2, sy: 0.6 },
    { key: 'decal:scorch', frames: 3, w: theme === 'forge' ? 2 : 0.6, alpha: 0.6, sx: 0.9, sy: 0.45 },
  ];
  const storyPool = story.map((s, k) => ({ id: String(k), weight: s.w }));
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (!isFloor(x, y) || reserved[idx(x, y)] || hash(x, y, seed + 40) > 0.022 * density) continue;
    const s = story[Number(pick(storyPool, hash(x, y, seed + 41)))]!;
    plan.decals.push({
      key: s.key, frame: Math.floor(hash(x, y, seed + 42) * s.frames), x: x + 0.5, y: y + 0.5, flip: hash(x, y, seed + 43) < 0.5,
      tint: s.tint, alpha: s.alpha, sx: s.sx ?? 1, sy: s.sy ?? 1,
    });
  }

  // ---- trails: footprints / drag marks / blood leading into the scenes, plus a couple of old tracks across rooms
  const bfsPath = (sx: number, sy: number, goal: (x: number, y: number, d: number) => boolean, maxD: number): { x: number; y: number }[] | null => {
    if (!isFloor(sx, sy)) return null;
    const prev = new Int32Array(W * H).fill(-2);
    const dd = new Int16Array(W * H);
    const q = [idx(sx, sy)];
    prev[q[0]!] = -1;
    for (let k = 0; k < q.length; k++) {
      const c = q[k]!, cx = c % W, cy = (c / W) | 0;
      if (k > 0 && goal(cx, cy, dd[c]!)) {
        const out: { x: number; y: number }[] = [];
        for (let p = c; p >= 0; p = prev[p]!) out.push({ x: (p % W) + 0.5, y: ((p / W) | 0) + 0.5 });
        return out.reverse();
      }
      if (dd[c]! >= maxD) continue;
      for (const [dx, dy] of ORTHO) {
        const nx = cx + dx, ny = cy + dy;
        if (!isFloor(nx, ny)) continue;
        const j = idx(nx, ny);
        if (prev[j] !== -2) continue;
        prev[j] = c;
        dd[j] = dd[c]! + 1;
        q.push(j);
      }
    }
    return null;
  };
  const smooth = (pts: { x: number; y: number }[], salt: number): { x: number; y: number }[] => {
    let out = pts.map((p, k) => ({ x: p.x + (hash(k, salt, seed) - 0.5) * 0.5, y: p.y + (hash(salt, k, seed) - 0.5) * 0.5 }));
    for (let it = 0; it < 2; it++) {
      const n: { x: number; y: number }[] = [out[0]!];
      for (let k = 0; k + 1 < out.length; k++) {
        const a = out[k]!, b = out[k + 1]!;
        n.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
      }
      n.push(out[out.length - 1]!);
      out = n;
    }
    return out;
  };
  trailsWanted.forEach((t, k) => {
    const sx = Math.floor(t.x), sy = Math.floor(t.y);
    const target = 9 + Math.floor(hash(sx, sy, seed + 50) * 5);
    const path = bfsPath(sx, sy, (x, y, d) => d >= target && D(x, y) >= 1 && hash(x, y, seed + 51) < 0.35, target + 6);
    if (!path || path.length < 5) return;
    // walk in from the far end, stopping short of the scene
    const pts = smooth(path.slice(2).reverse(), 60 + k);
    plan.trails.push({ kind: t.kind, pts, tint: t.kind === 'boots' || t.kind === 'paws' ? 0x000000 : dress.trailTint });
  });
  if (rooms.length >= 2) {
    const nOld = rooms.length > 3 ? 2 : 1;
    for (let k = 0; k < nOld; k++) {
      const a = rooms[Math.floor(hash(k, 1, seed + 70) * rooms.length)]!;
      const b = rooms[Math.floor(hash(k, 2, seed + 70) * rooms.length)]!;
      if (a === b) continue;
      const path = bfsPath(Math.floor(a.cx), Math.floor(a.cy), (x, y) => Math.abs(x + 0.5 - b.cx) < 1.5 && Math.abs(y + 0.5 - b.cy) < 1.5, 120);
      if (!path || path.length < 6) continue;
      const start = Math.floor(path.length * 0.2), len = Math.min(18, path.length - start);
      const kind = theme === 'frost' || hash(k, 3, seed + 70) < 0.6 ? 'boots' : 'paws';
      plan.trails.push({ kind, pts: smooth(path.slice(start, start + len), 80 + k), tint: 0x000000 });
    }
  }

  // ---- ambient hints: rat runs along back walls, drips into puddles
  if (dress.critters.rats > 0) {
    for (let y = 1; y < H - 1; y++) {
      let run = -1;
      for (let x = 1; x <= W - 1; x++) {
        const ok = x < W - 1 && isFloor(x, y) && isWall(x, y - 1);
        if (ok && run < 0) run = x;
        if (!ok && run >= 0) {
          if (x - run >= 3) plan.ambient.rats.push({ x0: run + 0.15, y0: y + 0.2, x1: x - 0.15, y1: y + 0.2 });
          run = -1;
        }
      }
    }
    for (let x = 1; x < W - 1; x++) {
      let run = -1;
      for (let y = 1; y <= H - 1; y++) {
        const ok = y < H - 1 && isFloor(x, y) && isWall(x - 1, y);
        if (ok && run < 0) run = y;
        if (!ok && run >= 0) {
          if (y - run >= 3) plan.ambient.rats.push({ x0: x + 0.2, y0: run + 0.15, x1: x + 0.2, y1: y - 0.15 });
          run = -1;
        }
      }
    }
  }
  if (dress.critters.drips) {
    const want = theme === 'flooded' ? 12 : 5;
    for (let y = 1; y < H - 1 && plan.ambient.drips.length < want; y++) for (let x = 1; x < W - 1 && plan.ambient.drips.length < want; x++) {
      if (!isFloor(x, y) || !isWall(x, y - 1) || occupied[idx(x, y)] === 1 || occupied[idx(x, y)] === 2) continue;
      if (hash(x, y, seed + 90) > (theme === 'flooded' ? 0.12 : 0.05)) continue;
      const px = x + 0.3 + hash(x, y, seed + 91) * 0.4, py = y + 0.3;
      plan.ambient.drips.push({ x: px, y: py });
      plan.decals.push({ key: 'decal:puddle', frame: Math.floor(hash(x, y, seed + 92) * 3), x: px, y: py + 0.05, sx: 0.8, sy: 0.4, alpha: 0.85 });
    }
  }

  // ---- room floors and blocker props from the typed rooms (the generic floor features keep off designed floors)
  const covered = new Uint8Array(W * H);
  for (const [i, frame] of roomFloorAt) {
    plan.roomFloor.push({ frame, x: i % W, y: (i / W) | 0 });
    if (FULL_ROOM_FLOOR.has(frame)) covered[i] = 1;
  }
  plan.roomFloor.sort((a, b) => a.x + a.y - (b.x + b.y) || a.x - b.x);
  plan.blockers = [...blockerAt.values()].sort((a, b) => a.y * W + a.x - (b.y * W + b.x));
  for (const r of typed) if (DESIGNED_FLOOR.has(r.kind)) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (isFloor(x, y) && owner[idx(x, y)] >= 0 && typed[owner[idx(x, y)]!] === r) covered[idx(x, y)] = 2;
  }
  planFloorFeatures(plan, map, theme, D, isWall, isFloor, seed, covered, extraDeco);
  // ---- the brink of every chasm: the floor slab's edge hangs over the drop (bridges show only their deck)
  if (voidList.length) {
    const bridgeTile = (x: number, y: number) => kindAt(x, y) === 'bridge';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!isFloor(x, y)) continue;
      const L = isVoid(x, y + 1), R = isVoid(x + 1, y);
      if (L || R) plan.voidCliffs.push({ x, y, L, R, v: Math.floor(hash(x, y, seed + 940) * 3), bridge: bridgeTile(x, y) });
    }
  }
  plan.occupied = [];
  for (let i = 0; i < W * H; i++) if (occupied[i] === 1 || occupied[i] === 2) plan.occupied.push(i);
  plan.stats.lights = lights;
  plan.stats.sprites = plan.sprites.length;
  plan.stats.stamps = plan.grime.length + plan.edges.length + plan.decals.length + plan.low.length + plan.shadows.length;
  plan.stats.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return plan;
}

// ---------------------------------------------------------------- floor features, chasm edges, light shafts, fog

/** Chance / amount of each floor feature per theme. */
const FLOOR_FEATURES: Record<ThemeId, { runner: number; dais: number; centre: number; slabs: number; edge: number; wet: number; crack: number; hole: number; grate: number; scatter: number; shafts: number; fog: number }> = {
  catacombs: { runner: 0.45, dais: 0.4, centre: 0.6, slabs: 1, edge: 0.55, wet: 0.03, crack: 0.06, hole: 0.025, grate: 0.012, scatter: 0.05, shafts: 2, fog: 0.6 },
  flooded: { runner: 0.75, dais: 0.25, centre: 0.7, slabs: 0.3, edge: 0.7, wet: 0.08, crack: 0.04, hole: 0.03, grate: 0.02, scatter: 0.04, shafts: 2, fog: 1 },
  ossuary: { runner: 0.5, dais: 0.45, centre: 0.75, slabs: 0.8, edge: 0.6, wet: 0.05, crack: 0.05, hole: 0.02, grate: 0.008, scatter: 0.07, shafts: 1, fog: 0.5 },
  sanctum: { runner: 0.9, dais: 0.6, centre: 0.8, slabs: 0.5, edge: 0.8, wet: 0.03, crack: 0.035, hole: 0.01, grate: 0.008, scatter: 0.05, shafts: 2, fog: 0.5 },
  fungal: { runner: 0.5, dais: 0.25, centre: 0.75, slabs: 0.15, edge: 0.7, wet: 0.07, crack: 0.03, hole: 0.03, grate: 0.006, scatter: 0.06, shafts: 2, fog: 0.9 },
  forge: { runner: 0.6, dais: 0.35, centre: 0.7, slabs: 0.6, edge: 0.6, wet: 0.05, crack: 0.07, hole: 0.03, grate: 0.025, scatter: 0.05, shafts: 1, fog: 0.7 },
  frost: { runner: 0.5, dais: 0.3, centre: 0.6, slabs: 0.4, edge: 0.85, wet: 0.06, crack: 0.05, hole: 0.02, grate: 0.008, scatter: 0.05, shafts: 3, fog: 0.8 },
  // footpaths and sunbeams on the shard (its holes look down into the sky); rover tracks and craters; light strips
  sky: { runner: 0.55, dais: 0.2, centre: 0.4, slabs: 0.25, edge: 0.75, wet: 0.04, crack: 0.03, hole: 0.015, grate: 0.004, scatter: 0.06, shafts: 3, fog: 0.7 },
  moon: { runner: 0.5, dais: 0.3, centre: 0.65, slabs: 0.35, edge: 0.6, wet: 0.05, crack: 0.05, hole: 0.03, grate: 0.01, scatter: 0.07, shafts: 1, fog: 0.4 },
  server: { runner: 0.8, dais: 0.4, centre: 0.6, slabs: 0.6, edge: 0.7, wet: 0.03, crack: 0.03, hole: 0.03, grate: 0.03, scatter: 0.06, shafts: 0, fog: 0.4 },
};

/**
 * `covered`: 1 = a room floor covers the tile (nothing generic goes on it), 2 = inside a room with its own floor
 * design (no generic dais, centrepiece, runner or slabs). `extra`: deco frames the room plans asked for (a dais).
 */
function planFloorFeatures(
  plan: DressingPlan, map: DressMap, theme: ThemeId, D: (x: number, y: number) => number, isWall: (x: number, y: number) => boolean,
  isFloor: (x: number, y: number) => boolean, seed: number, covered: Uint8Array, extra: PlanFloor[],
): void {
  const W = map.w, H = map.h;
  const F = FLOOR_FEATURES[theme];
  const used = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (covered[i] === 1) used[i] = 1;
  const out: PlanFloor[] = [];
  for (const e of extra) { out.push(e); used[e.y * W + e.x] = 1; }
  const open = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && !covered[y * W + x];
  const put = (name: DecoName, x: number, y: number): void => {
    out.push({ frame: DECO[name], x, y });
    if (x >= 0 && y >= 0 && x < W && y < H) used[y * W + x] = 1;
  };
  const free = (x: number, y: number, minD = 1): boolean => isFloor(x, y) && !used[y * W + x] && D(x, y) >= minD;
  const h = (x: number, y: number, s: number): number => hash(x, y, seed + s);

  // ---- per room: a centrepiece or a raised dais in the middle, a runner along the long axis
  plan.rooms.forEach((room, ri) => {
    const cx = Math.floor(room.cx), cy = Math.floor(room.cy);
    if (!open(cx, cy)) return;   // a typed room with its own floor design
    const roll = h(ri, 1, 900);
    let placed = false;
    if (room.area >= 40 && roll < F.dais) {
      for (const n of [3, 2]) {
        const x0 = cx - (n === 3 ? 1 : 0), y0 = cy - (n === 3 ? 1 : 0);
        let ok = true;
        for (let y = y0; y < y0 + n && ok; y++) for (let x = x0; x < x0 + n && ok; x++) if (!free(x, y, 2)) ok = false;
        if (!ok) continue;
        for (let y = y0; y < y0 + n; y++)
          for (let x = x0; x < x0 + n; x++) {
            const s = y === y0 + n - 1, e = x === x0 + n - 1;
            put(s && e ? 'daisSE' : s ? 'daisS' : e ? 'daisE' : 'dais', x, y);
          }
        placed = true;
        break;
      }
    }
    if (!placed && room.area >= 24 && roll < F.dais + F.centre) {
      const x0 = cx - 1 + (h(ri, 2, 901) < 0.5 ? 0 : 1), y0 = cy - 1 + (h(ri, 3, 901) < 0.5 ? 0 : 1);
      if (free(x0, y0, 2) && free(x0 + 1, y0, 2) && free(x0, y0 + 1, 2) && free(x0 + 1, y0 + 1, 2)) {
        put('cp0', x0, y0);
        put('cp1', x0 + 1, y0);
        put('cp2', x0, y0 + 1);
        put('cp3', x0 + 1, y0 + 1);
      }
    }
    if (h(ri, 4, 902) < F.runner) {
      // the longest straight run of open floor through the room middle
      let best: { x: number; y: number; n: number; alongY: boolean } | null = null;
      for (const alongY of [false, true]) {
        for (const off of [0, -1, 1]) {
          const fx = alongY ? cx + off : cx, fy = alongY ? cy : cy + off;
          if (!free(fx, fy, 2)) continue;
          let a = 0, b = 0;
          while (a < 40 && free(alongY ? fx : fx - a - 1, alongY ? fy - a - 1 : fy, 2)) a++;
          while (b < 40 && free(alongY ? fx : fx + b + 1, alongY ? fy + b + 1 : fy, 2)) b++;
          const n = a + b + 1;
          if (!best || n > best.n) best = { x: alongY ? fx : fx - a, y: alongY ? fy - a : fy, n, alongY };
        }
      }
      if (best && best.n >= 4) {
        for (let k = 0; k < best.n; k++) {
          const x = best.alongY ? best.x : best.x + k, y = best.alongY ? best.y + k : best.y;
          const name: DecoName = k === 0 ? (best.alongY ? 'runY0' : 'runX0') : k === best.n - 1 ? (best.alongY ? 'runY1' : 'runX1') : best.alongY ? 'runY' : 'runX';
          put(name, x, y);
        }
      }
    }
  });

  // ---- worn steps where a narrow passage opens into a room
  const span = (x: number, y: number, dx: number, dy: number): number => {
    if (!isFloor(x, y)) return 0;
    let n = 1;
    for (let k = 1; k < 6 && isFloor(x + dx * k, y + dy * k); k++) n++;
    for (let k = 1; k < 6 && isFloor(x - dx * k, y - dy * k); k++) n++;
    return n;
  };
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (!free(x, y) || h(Math.floor(x / 3), Math.floor(y / 3), 905) > 0.65) continue;
      // a passage at most three tiles across, opening into something wide
      const acrossY = span(x, y, 0, 1), acrossX = span(x, y, 1, 0);
      if (acrossY <= 3 && isFloor(x - 1, y) && isFloor(x + 1, y) && (span(x - 1, y, 0, 1) >= 6 || span(x + 1, y, 0, 1) >= 6)) put('stepsX', x, y);
      else if (acrossX <= 3 && isFloor(x, y - 1) && isFloor(x, y + 1) && (span(x, y - 1, 1, 0) >= 6 || span(x, y + 1, 1, 0) >= 6)) put('stepsY', x, y);
    }

  // ---- wall-base accumulation along the back walls, a little along the cut front walls
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!free(x, y)) continue;
      const n = isWall(x, y - 1), wv = isWall(x - 1, y), s = isWall(x, y + 1), e = isWall(x + 1, y);
      const r = h(x, y, 910);
      if ((n || wv) && r < F.edge) put(n && wv ? 'edgeNW' : n ? (h(x, y, 911) < 0.5 ? 'edgeN0' : 'edgeN1') : h(x, y, 911) < 0.5 ? 'edgeW0' : 'edgeW1', x, y);
      else if ((s || e) && !n && !wv && r < F.edge * 0.45) put(s ? 'edgeS' : 'edgeE', x, y);
    }

  // ---- 2x1 slabs (graves, lids, plates) in the open
  const slabs = Math.round(((W * H) / 70) * F.slabs);
  for (let k = 0, tries = 0; k < slabs && tries < slabs * 8; tries++) {
    const x = 1 + Math.floor(h(tries, 1, 920) * (W - 3)), y = 1 + Math.floor(h(tries, 2, 920) * (H - 3));
    const alongY = h(tries, 3, 920) < 0.5;
    const x2 = alongY ? x : x + 1, y2 = alongY ? y + 1 : y;
    if (!free(x, y, 2) || !free(x2, y2, 2) || !open(x, y) || !open(x2, y2)) continue;
    put(alongY ? 'slabY0' : 'slabX0', x, y);
    put(alongY ? 'slabY1' : 'slabX1', x2, y2);
    k++;
  }

  // ---- scattered wear: cracks, broken stones, puddles, grates, bits
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!free(x, y)) continue;
      let r = h(x, y, 930);
      const pick = (p: number): boolean => {
        if (r < p) return true;
        r -= p;
        return false;
      };
      if (pick(F.crack)) put(h(x, y, 931) < 0.34 ? 'crack0' : h(x, y, 931) < 0.67 ? 'crack1' : 'crack2', x, y);
      else if (pick(F.hole)) put(h(x, y, 932) < 0.5 ? 'hole0' : 'hole1', x, y);
      else if (pick(F.wet)) put(h(x, y, 933) < 0.5 ? 'wet0' : 'wet1', x, y);
      else if (pick(F.grate) && D(x, y) >= 2) put('grate', x, y);
      else if (pick(F.scatter)) put(h(x, y, 934) < 0.5 ? 'scatter0' : 'scatter1', x, y);
    }
  out.sort((a, b) => a.x + a.y - (b.x + b.y) || a.x - b.x);
  plan.floor = out;

  // ---- chasm edges: under cut front walls with only rock in front of the face
  const rockOnly = (x0: number, y0: number, x1: number, y1: number): boolean => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x >= 0 && y >= 0 && x < W && y < H && isFloor(x, y)) return false;
    return true;
  };
  // a wall whose foot stands on the brink of a chasm (the sky shard's rim) hangs its slab face into the void too
  const voidAt = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && !isFloor(x, y) && !isWall(x, y);
  for (const w of plan.walls) {
    if (w.kind !== 'stub' && w.kind !== 'block') continue;
    const stub = w.kind === 'stub';
    const L = (stub && isWall(w.x, w.y + 1) && rockOnly(w.x, w.y + 1, w.x + 2, w.y + 3)) || voidAt(w.x, w.y + 1);
    const R = (stub && isWall(w.x + 1, w.y) && rockOnly(w.x + 1, w.y, w.x + 3, w.y + 2)) || voidAt(w.x + 1, w.y);
    if (L || R) plan.cliffs.push({ x: w.x, y: w.y, L, R, v: Math.floor(h(w.x, w.y, 940) * 3) });
  }

  // ---- shafts of light in room middles; fog banks over open floor
  const rooms = plan.rooms.slice().sort((a, b) => b.area - a.area);
  for (let k = 0; k < Math.min(F.shafts, rooms.length); k++) {
    const r = rooms[k]!;
    const x = Math.floor(r.cx + (h(k, 1, 950) - 0.5) * 3), y = Math.floor(r.cy + (h(k, 2, 950) - 0.5) * 3);
    if (isFloor(x, y)) plan.shafts.push({ x: x + 0.5, y: y + 0.5, w: 0.8 + h(k, 3, 950) * 0.6 });
  }
  const nFog = Math.round(((W * H) / 55) * F.fog);
  for (let k = 0, tries = 0; k < nFog && tries < nFog * 6; tries++) {
    const x = 1 + h(tries, 1, 960) * (W - 2), y = 1 + h(tries, 2, 960) * (H - 2);
    if (!isFloor(Math.floor(x), Math.floor(y))) continue;
    plan.fog.push({ x, y, r: 2 + h(tries, 3, 960) * 2.5 });
    k++;
  }
}
