import { TRAINING_THEME } from '@cursebound/content';
import { encodeTopology } from './mapgen';
import { FLOOR, WALL, solid, type Grid } from './mapgrid';
import { nextInt, seedRng } from './rng';
import type { MapState } from './types';

// The training grounds floor (training.ts): a circular medieval town square built from the mapgen grid primitives.
// Everything outside the circle is the ring of timber-framed houses (wall tiles); inside, the blocking pieces are
// carved as walls: the central fountain, four market stalls, a row of straw training dummies, weapon racks against
// the houses and four banner poles. The layout is a pure function of decorSeed (`courtyardPlan`), so the client
// dresses exactly what the simulation carved (render/Courtyard.ts) from the replicated map alone.

export const COURTYARD = {
  w: 44, h: 44,
  /** plaza radius (tiles, from the map centre to the house fronts) */
  radius: 17.2,
  /** the fountain basin's blocking radius */
  fountain: 2.3,
  /** cobble rings (radii in tiles): flagstones round the fountain, inner cobbles, the brick band, setts, the worn rim */
  rings: [2.3, 4.3, 4.6, 9.0, 9.4, 13.1, 13.4] as readonly number[],
} as const;

export type CourtyardFeatureKind = 'fountain' | 'stall' | 'dummy' | 'rack' | 'banner' | 'arch';

/** A dressed piece of the square. Tile coordinates; (x, y) is the top-left tile, w x h its blocking footprint
 *  (0 x 0 = not blocking: arches are drawn on the house fronts). `v` is a variant seed, `ang` the world angle from
 *  the centre (radians; stalls and racks face the fountain). */
export interface CourtyardFeature { kind: CourtyardFeatureKind; x: number; y: number; w: number; h: number; v: number; ang: number }

export interface CourtyardPlan { cx: number; cy: number; r: number; features: CourtyardFeature[] }

function vhash(a: number, b: number, s: number): number {
  let h = (a * 374761393 + b * 668265263 + s * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const DEG = Math.PI / 180;

/** True when tile (x, y) lies inside the plaza circle. */
export function inPlaza(x: number, y: number): boolean {
  const cx = COURTYARD.w / 2, cy = COURTYARD.h / 2;
  return (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= COURTYARD.radius ** 2;
}

/** The dressed pieces of the square for a decor seed (shared by the simulation grid and the client renderer). */
export function courtyardPlan(decorSeed: number): CourtyardPlan {
  const { w, h, radius } = COURTYARD;
  const cx = w / 2, cy = h / 2;
  const f: CourtyardFeature[] = [];
  const at = (ang: number, r: number) => ({ x: Math.floor(cx + Math.cos(ang) * r), y: Math.floor(cy + Math.sin(ang) * r) });
  f.push({ kind: 'fountain', x: cx - 3, y: cy - 3, w: 6, h: 6, v: vhash(1, 1, decorSeed), ang: 0 });
  // market stalls on the diagonals of the middle band, long side tangent to the circle
  [30, 120, 210, 300].forEach((deg, i) => {
    const a = deg * DEG + ((vhash(i, 2, decorSeed) % 9) - 4) * DEG;
    const p = at(a, 11.2);
    const radialX = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a));
    f.push({ kind: 'stall', x: p.x, y: p.y, w: radialX ? 1 : 2, h: radialX ? 2 : 1, v: vhash(i, 3, decorSeed), ang: a });
  });
  // the dummy line: five straw foes in an arc on the open west side of the fountain
  for (let k = 0; k < 5; k++) {
    const a = (150 + k * 15) * DEG;
    const p = at(a, 7.4);
    f.push({ kind: 'dummy', x: p.x, y: p.y, w: 1, h: 1, v: vhash(k, 4, decorSeed), ang: a });
  }
  // weapon racks backed against the houses (north-west arc, where the camera sees the house fronts)
  [205, 238, 262, 292].forEach((deg, i) => {
    const a = deg * DEG;
    let r = radius - 0.6;
    let p = at(a, r);
    while (r > 10 && !inPlaza(p.x, p.y)) { r -= 0.5; p = at(a, r); }
    f.push({ kind: 'rack', x: p.x, y: p.y, w: 1, h: 1, v: vhash(i, 5, decorSeed), ang: a });
  });
  // banner poles round the fountain
  [45, 135, 225, 315].forEach((deg, i) => {
    const a = deg * DEG;
    const p = at(a, 4.95);
    f.push({ kind: 'banner', x: p.x, y: p.y, w: 1, h: 1, v: vhash(i, 6, decorSeed), ang: a });
  });
  // gateways through the houses at the four compass points (drawn on the house front; no blocking change)
  [0, 90, 180, 270].forEach((deg, i) => {
    const a = deg * DEG;
    let r = radius - 0.5;
    let p = at(a, r);
    while (r < radius + 3 && inPlaza(p.x, p.y)) { r += 0.5; p = at(a, r); }
    f.push({ kind: 'arch', x: p.x, y: p.y, w: 0, h: 0, v: vhash(i, 7, decorSeed), ang: a });
  });
  return { cx, cy, r: radius, features: f };
}

/** Carve the square into a grid: plaza floor, then every blocking piece of the plan. */
export function courtyardGrid(plan: CourtyardPlan): Grid {
  const g = solid(COURTYARD.w, COURTYARD.h);
  for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < g.w - 1; x++) if (inPlaza(x, y)) g.t[y * g.w + x] = FLOOR;
  for (const p of plan.features) {
    if (p.kind === 'fountain') {
      for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
        if ((x + 0.5 - plan.cx) ** 2 + (y + 0.5 - plan.cy) ** 2 <= COURTYARD.fountain ** 2) g.t[y * g.w + x] = WALL;
      }
      continue;
    }
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (x > 0 && y > 0 && x < g.w - 1 && y < g.h - 1) g.t[y * g.w + x] = WALL;
  }
  return g;
}

/** The training grounds map (deterministic per run seed). */
export function generateCourtyard(seed: string): MapState {
  const decorSeed = nextInt(seedRng(seed, 'courtyard'), 100000);
  const plan = courtyardPlan(decorSeed);
  const g = courtyardGrid(plan);
  const { cx, cy, r } = plan;
  const floor = (x: number, y: number) => g.t[Math.floor(y) * g.w + Math.floor(x)] === FLOOR;
  // the party starts south-east of the fountain (in front of it on screen), facing the plaza
  const playerSpawns: { x: number; y: number }[] = [];
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 1], [1, -1], [2, 0], [0, 2]]) {
    const x = Math.floor(cx + 4.6) + dx + 0.5, y = Math.floor(cy + 4.6) + dy + 0.5;
    if (floor(x, y) && playerSpawns.length < 5) playerSpawns.push({ x, y });
  }
  const enemySpawns: { x: number; y: number }[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    const x = Math.floor(cx + Math.cos(a) * 12.5) + 0.5, y = Math.floor(cy + Math.sin(a) * 12.5) + 0.5;
    if (floor(x, y)) enemySpawns.push({ x, y });
  }
  const R = Math.ceil(r);
  const m: MapState = {
    w: g.w, h: g.h, tiles: g.t, topology: 'courtyard', playerSpawns, enemySpawns, fallback: false, decorSeed,
    theme: TRAINING_THEME.id, layout: 'courtyard',
    rooms: [{ x: cx - R, y: cy - R, w: R * 2, h: R * 2, kind: 'arena', shape: 'round', v: decorSeed % 997 }],
  };
  m.topology = encodeTopology(m);
  return m;
}
