import { ARENA_DESIGNS, BOSS_ARENAS } from '@cursebound/content';
import { FLOOR, WALL, block, carve, ellipse, idx, inner, rect, ri, solid, straight, type Gen, type Grid, type RoomSpec } from './mapgrid';
import { nextFloat, nextInt, type RngState } from './rng';
import { crater, datavault, foundry, skyring } from './bosses/lairs';

// Boss lairs (map generation, boss floors): every boss fights in a hand-designed arena that clearly differs from the
// ordinary floors, procedurally varied per run (proportions, pillar rings, chapels, rim breaks, mirrored details).
// Every arena shares the same dramatic grammar: the party arrives in a quiet antechamber in the west, walks a short
// processional (a gate, a tunnel or a bridge over the void) and enters a wide, open lair whose boss rises on a dais
// in the middle of its far half. Furniture stays at the edges so telegraphs read from anywhere in the fight.
//   nave       drowned cathedral nave: pillar rows make charge lanes (the Hollow Stag staggers on stone), side
//              chapels, an apse with the dais
//   ritual     ghost-fire ritual circle: a round chamber ringed by obelisks, four shrine alcoves
//   belltower  bell-tower floor: an octagonal platform floating in a bottomless shaft, reached over a bridge
//   colosseum  sunken colosseum: an elliptical sand floor, gated pens, a central dais and four spina posts
//   datavault  cursed data vault (the Corrupted Core), foundry  molten foundry (the Iron Colossus),
//   skyring    floating ring of rock (the Gale Wyrm), crater  cratered lunar basin (the Crater Horror): bosses/lairs.ts

type ArenaFn = (rng: RngState) => Gen;

/** The quiet room the party arrives in (west side) and where they stand when the round starts. */
function antechamber(g: Grid, rng: RngState, cy: number): { room: RoomSpec; start: number; east: number } {
  const aw = ri(rng, 6, 7), ah = ri(rng, 7, 8);
  const x0 = 2, y0 = cy - Math.floor(ah / 2);
  rect(g, x0, y0, aw, ah, FLOOR);
  return { room: { x: x0, y: y0, w: aw, h: ah, shape: 'rect', kind: 'approach' }, start: idx(g, x0 + 3, cy), east: x0 + aw };
}

/** Drowned cathedral nave. */
function nave(rng: RngState): Gen {
  const W = ri(rng, 40, 44), H = ri(rng, 20, 23);
  const g = solid(W, H);
  const cy = Math.floor(H / 2);
  const ante = antechamber(g, rng, cy);
  const nx0 = ante.east + ri(rng, 2, 3);
  const nh = Math.min(ri(rng, 7, 9), cy - 3);
  const ra = nh;
  const ax = W - 3 - ra;
  // gate passage, nave, apse
  straight(g, ante.east - 1, cy - 1, nx0, cy - 1, 3);
  rect(g, nx0, cy - nh, ax - nx0 + 1, nh * 2 + 1, FLOOR);
  ellipse(g, ax + 0.5, cy + 0.5, ra + 0.5, nh + 0.5, FLOOR);
  // side chapels between the buttresses, north and south
  const step = ri(rng, 4, 5);
  for (let x = nx0 + 2; x < ax - 1; x += step) {
    if (nextFloat(rng) < 0.7) rect(g, x, cy - nh - 2, 2, 2, FLOOR);
    if (nextFloat(rng) < 0.7) rect(g, x, cy + nh + 1, 2, 2, FLOOR);
  }
  // guardian statues at the mouth of the nave, then two pillar rows: the charge lanes
  block(g, nx0 + 1, cy - 3, 1, 1);
  block(g, nx0 + 1, cy + 3, 1, 1);
  const pr = ri(rng, 3, 4), ps = ri(rng, 3, 4);
  for (let x = nx0 + 4; x <= ax - 2; x += ps) {
    block(g, x, cy - pr, 1, 1);
    block(g, x, cy + pr, 1, 1);
  }
  const arena: RoomSpec = { x: nx0, y: cy - nh - 2, w: W - 2 - nx0, h: nh * 2 + 5, shape: 'rect', kind: 'arena' };
  return { g, rooms: [ante.room, arena], start: ante.start, boss: idx(g, ax, cy), arena: 'nave' };
}

/** Ghost-fire ritual circle. */
function ritual(rng: RngState): Gen {
  const W = ri(rng, 38, 42), H = ri(rng, 24, 27);
  const g = solid(W, H);
  const cy = Math.floor(H / 2);
  const R = Math.min(ri(rng, 10, 11), cy - 2);
  const cx = W - 3 - R;
  const ante = antechamber(g, rng, cy);
  ellipse(g, cx + 0.5, cy + 0.5, R + 0.5, R + 0.5, FLOOR);
  straight(g, ante.east - 1, cy - 1, cx - R + 1, cy - 1, 3);
  // shrine alcoves on the diagonals
  for (const a of [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75]) {
    if (nextFloat(rng) < 0.2) continue;
    const ex = Math.round(cx + Math.cos(a) * (R + 0.6)), ey = Math.round(cy + Math.sin(a) * (R + 0.6));
    rect(g, ex - 1, ey - 1, 3, 3, FLOOR);
  }
  // the obelisk ring (open towards the entrance so the party walks straight in)
  const n = ri(rng, 8, 10), pr = R * (0.6 + nextFloat(rng) * 0.1), rot = nextFloat(rng) * Math.PI * 2;
  for (let k = 0; k < n; k++) {
    const a = rot + (k / n) * Math.PI * 2;
    if (Math.cos(a) < -0.86) continue;
    block(g, Math.round(cx + Math.cos(a) * pr), Math.round(cy + Math.sin(a) * pr), 1, 1);
  }
  const arena: RoomSpec = { x: cx - R - 2, y: cy - R - 2, w: R * 2 + 5, h: R * 2 + 5, shape: 'round', kind: 'arena' };
  return { g, rooms: [ante.room, arena], start: ante.start, boss: idx(g, cx, cy), arena: 'ritual' };
}

/** Bell-tower floor over a bottomless shaft. */
function belltower(rng: RngState): Gen {
  const W = ri(rng, 38, 42), H = ri(rng, 26, 28);
  const g = solid(W, H);
  const voids = new Uint8Array(W * H);
  const cy = Math.floor(H / 2);
  const ante = antechamber(g, rng, cy);
  const lw = ante.east - 2;
  const R = Math.max(7, Math.min(ri(rng, 8, 10), cy - 3, Math.floor((W - 11 - lw) / 2)));
  const cx = W - 5 - R;
  // the shaft: everything around the platform drops away
  const sx = R + 4, sy = Math.min(R + 4, cy - 1);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const dx = (x + 0.5 - (cx + 0.5)) / sx, dy = (y + 0.5 - (cy + 0.5)) / sy;
    if (dx * dx + dy * dy <= 1 && x >= ante.east) voids[idx(g, x, y)] = 1;
  }
  // octagonal platform
  const diag = Math.round(R * 1.45);
  for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
    if (Math.abs(x - cx) + Math.abs(y - cy) <= diag) { carve(g, x, y); voids[idx(g, x, y)] = 0; }
  }
  // the bridge over the void
  for (let x = ante.east - 1; x <= cx - R; x++) for (let k = -1; k <= 1; k++) { carve(g, x, cy + k); voids[idx(g, x, cy + k)] = 0; }
  // crumbled rim: a few edge stones gone into the dark (never on the bridge side)
  const breaks = ri(rng, 3, 6);
  for (let t = 0, n = 0; t < 60 && n < breaks; t++) {
    const a = nextFloat(rng) * Math.PI * 2;
    if (Math.cos(a) < -0.5) continue;
    let x = cx, y = cy;
    for (let r = 0; r <= R + 1; r++) {
      const tx = Math.round(cx + Math.cos(a) * r), ty = Math.round(cy + Math.sin(a) * r);
      if (!inner(g, tx, ty) || g.t[idx(g, tx, ty)] !== FLOOR) break;
      x = tx; y = ty;
    }
    if (Math.abs(x - cx) + Math.abs(y - cy) < R - 1) continue;
    g.t[idx(g, x, y)] = WALL;
    voids[idx(g, x, y)] = 1;
    n++;
  }
  // the four posts of the fallen bell frame
  const s = ri(rng, 3, Math.max(3, R - 4));
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) block(g, cx + dx * s, cy + dy * s, 1, 1);
  const bridge: RoomSpec = { x: ante.east, y: cy - 1, w: Math.max(1, cx - R - ante.east), h: 3, shape: 'hall', kind: 'bridge' };
  const arena: RoomSpec = { x: cx - R, y: cy - R, w: R * 2 + 1, h: R * 2 + 1, shape: 'round', kind: 'arena' };
  return { g, rooms: [ante.room, bridge, arena], voids, start: ante.start, boss: idx(g, cx, cy), arena: 'belltower' };
}

/** Sunken colosseum. */
function colosseum(rng: RngState): Gen {
  const W = ri(rng, 40, 44), H = ri(rng, 25, 28);
  const g = solid(W, H);
  const cy = Math.floor(H / 2);
  const ry = Math.min(ri(rng, 10, 11), cy - 4);
  const rx = Math.min(ri(rng, 12, 14), Math.floor((W - 16) / 2));
  const cx = W - 3 - rx;
  const ante = antechamber(g, rng, cy);
  ellipse(g, cx + 0.5, cy + 0.5, rx + 0.5, ry + 0.5, FLOOR);
  // the gladiators' tunnel, then gated pens north, south and east
  straight(g, ante.east - 1, cy - 1, cx - rx + 1, cy - 1, 3);
  rect(g, cx - 1, cy - ry - 2, 3, 2, FLOOR);
  rect(g, cx - 1, cy + ry + 1, 3, 2, FLOOR);
  if (cx + rx + 2 < W - 1) rect(g, cx + rx + 1, cy - 1, 2, 3, FLOOR);
  // spina posts on the diagonals, clear of the dais
  const px = Math.round(rx * (0.52 + nextFloat(rng) * 0.1)), py = Math.round(ry * (0.52 + nextFloat(rng) * 0.1));
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) block(g, cx + dx * px, cy + dy * py, 1, 1);
  const arena: RoomSpec = { x: cx - rx - 1, y: cy - ry - 2, w: rx * 2 + 4, h: ry * 2 + 5, shape: 'round', kind: 'arena' };
  return { g, rooms: [ante.room, arena], start: ante.start, boss: idx(g, cx, cy), arena: 'colosseum' };
}

const ARENAS: Record<string, ArenaFn> = { nave, ritual, belltower, colosseum, datavault, foundry, skyring, crater };   // + scripted bosses' lairs (bosses/lairs.ts)

/** The arena design for a boss (its own designs; any design for a boss without one), drawn from the map stream. */
export function arenaDesign(bossId: string | null, rng: RngState): string {
  const list = (bossId && BOSS_ARENAS[bossId]?.filter((a) => ARENAS[a])) || [];
  const pool = list.length ? list : ARENA_DESIGNS.map((a) => a.id).filter((a) => ARENAS[a]);
  return pool[nextInt(rng, pool.length)];
}

export function generateArena(design: string, rng: RngState): Gen {
  return (ARENAS[design] ?? nave)(rng);
}
