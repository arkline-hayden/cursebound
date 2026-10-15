import { FLOOR, block, carve, idx, rect, ri, solid, straight, type Gen, type Grid, type RoomSpec } from './mapgrid';
import { nextFloat, type RngState } from './rng';

// The theme bosses' lairs (arenas.ts registers them; content BOSS_ARENAS picks them). Same dramatic grammar as every
// arena: a quiet antechamber in the west, a short processional, then a wide open lair with the boss's spot in the
// middle of its far half and a clear 5x5 around it for the grand entrance.
//   skyring  the Gale Wyrm's floating ring of rock: an annulus of wind-scoured stone around a hole of open sky, reached
//            over a rock bridge. Everything beyond the rim is open air (chasm voids), so the gale can blow a hero off
//            the island; a few crags on the outer band give cover. Dives cross the hole; the Wyrm circles above it.
//   crater   the Crater Horror's lunar basin: a wide, lumpy bowl of regolith cut by a ramp from the antechamber, the
//            pit the Horror rises from, and satellite craters ringed with boulders (the Earth hangs in the sky above:
//            the moon theme's backdrop).

type ArenaFn = (rng: RngState) => Gen;

/** The quiet room the party arrives in (west side; same as arenas.ts). */
function antechamber(g: Grid, rng: RngState, cy: number): { room: RoomSpec; start: number; east: number } {
  const aw = ri(rng, 6, 7), ah = ri(rng, 7, 8);
  const x0 = 2, y0 = cy - Math.floor(ah / 2);
  rect(g, x0, y0, aw, ah, FLOOR);
  return { room: { x: x0, y: y0, w: aw, h: ah, shape: 'rect', kind: 'approach' }, start: idx(g, x0 + 3, cy), east: x0 + aw };
}

/** Per-sector edge offsets (smoothly interpolated), zero within `keep` radians of each protected angle. */
function lumpyEdge(rng: RngState, sectors: number, lo: number, hi: number, keep: [number, number][]): (a: number) => number {
  const off = Array.from({ length: sectors }, () => lo + nextFloat(rng) * (hi - lo));
  return (a: number) => {
    for (const [at, w] of keep) {
      let d = Math.abs(a - at) % (Math.PI * 2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d < w) return 0;
    }
    const s = (((a / (Math.PI * 2)) % 1) + 1) % 1 * sectors;
    const i = Math.floor(s), t = s - i;
    const k = t * t * (3 - 2 * t);
    return off[i % sectors] * (1 - k) + off[(i + 1) % sectors] * k;
  };
}

/** The Gale Wyrm's floating ring of rock. */
function skyring(rng: RngState): Gen {
  const W = ri(rng, 40, 43), H = ri(rng, 27, 29);
  const g = solid(W, H);
  const voids = new Uint8Array(W * H);
  const cy = Math.floor(H / 2);
  const ante = antechamber(g, rng, cy);
  const R = Math.min(ri(rng, 11, 12), cy - 2);
  const hole = ri(rng, 3, 4);
  const cx = W - 3 - R;
  // beyond the antechamber everything is open sky
  for (let y = 1; y < H - 1; y++) for (let x = ante.east; x < W - 1; x++) voids[idx(g, x, y)] = 1;
  // the ring: wind-scoured outer edge, never notched at the dais (east) or the bridge (west)
  const edge = lumpyEdge(rng, 14, -1.1, 0.25, [[0, 0.55], [Math.PI, 0.45]]);
  for (let y = cy - R - 1; y <= cy + R + 1; y++) for (let x = cx - R - 1; x <= cx + R + 1; x++) {
    const dx = x - cx, dy = y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < hole + 0.5 || d > R + edge(Math.atan2(dy, dx))) continue;
    carve(g, x, y);
    if (g.t[idx(g, x, y)] === FLOOR) voids[idx(g, x, y)] = 0;
  }
  // the rock bridge from the antechamber
  for (let x = ante.east - 1; x <= cx - R + 1; x++) for (let k = -1; k <= 1; k++) { carve(g, x, cy + k); voids[idx(g, x, cy + k)] = 0; }
  // wind-carved crags on the outer band: cover from the gale (never on the dais side or by the bridge)
  const crags = ri(rng, 4, 6);
  for (let t = 0, n = 0; t < 60 && n < crags; t++) {
    const a = nextFloat(rng) * Math.PI * 2;
    if (Math.cos(a) > 0.8 || Math.cos(a) < -0.78) continue;
    const rr = R - 1.8 - nextFloat(rng) * 1.4;
    if (block(g, Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr), 1, 1)) n++;
  }
  const bx = cx + Math.round((hole + 1 + R) / 2);
  const bridge: RoomSpec = { x: ante.east, y: cy - 1, w: Math.max(1, cx - R - ante.east + 1), h: 3, shape: 'hall', kind: 'bridge' };
  const arena: RoomSpec = { x: cx - R, y: cy - R, w: R * 2 + 1, h: R * 2 + 1, shape: 'round', kind: 'arena' };
  return { g, rooms: [ante.room, bridge, arena], voids, start: ante.start, boss: idx(g, bx, cy), arena: 'skyring' };
}

/** The Crater Horror's lunar basin. */
function crater(rng: RngState): Gen {
  const W = ri(rng, 42, 45), H = ri(rng, 26, 28);
  const g = solid(W, H);
  const cy = Math.floor(H / 2);
  const ante = antechamber(g, rng, cy);
  const ry = Math.min(ri(rng, 10, 11), cy - 2);
  const rx = Math.min(ri(rng, 13, 14), Math.floor((W - ante.east - 5) / 2));
  const cx = W - 3 - rx;
  // the bowl: regolith slumps into the rim here and there (never at the ramp or behind the pit)
  const edge = lumpyEdge(rng, 16, -1.4, 0.2, [[Math.PI, 0.35], [0, 0.3]]);
  for (let y = cy - ry - 1; y <= cy + ry + 1; y++) for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
    const dx = x + 0.5 - (cx + 0.5), dy = y + 0.5 - (cy + 0.5);
    const a = Math.atan2(dy / ry, dx / rx);
    const e = edge(a);
    const nx = dx / (rx + e), ny = dy / (ry + e * (ry / rx));
    if (nx * nx + ny * ny <= 1) carve(g, x, y);
  }
  // the ramp down from the antechamber
  straight(g, ante.east - 1, cy - 1, cx - rx + 1, cy - 1, 3);
  // the pit the Horror rises from: the middle of the far half
  const bx = cx + Math.round(rx * 0.3), by = cy;
  // satellite craters: rings of boulders with gaps, clear of the pit and the ramp
  const want = ri(rng, 3, 4);
  for (let t = 0, n = 0; t < 80 && n < want; t++) {
    const a = nextFloat(rng) * Math.PI * 2, k = 0.4 + nextFloat(rng) * 0.4;
    const px = Math.round(cx + Math.cos(a) * rx * k), py = Math.round(cy + Math.sin(a) * ry * k);
    if ((px - bx) ** 2 + (py - by) ** 2 < 6.5 * 6.5 || px < cx - rx + 5 || Math.abs(py - cy) < 2 && px < bx) continue;
    let placed = 0;
    const a0 = nextFloat(rng) * Math.PI * 2;
    for (let s = 0; s < 6; s++) {
      if (s === 2) continue;   // the gap the craters open toward
      const sa = a0 + (s / 6) * Math.PI * 2;
      if (block(g, Math.round(px + Math.cos(sa) * 1.7), Math.round(py + Math.sin(sa) * 1.3), 1, 1)) placed++;
    }
    if (placed >= 2) n++;
  }
  // lone boulders by the rim
  for (let t = 0, n = 0; t < 40 && n < 3; t++) {
    const a = nextFloat(rng) * Math.PI * 2;
    if (Math.cos(a) < -0.8) continue;
    const px = Math.round(cx + Math.cos(a) * (rx - 2.5)), py = Math.round(cy + Math.sin(a) * (ry - 2.2));
    if ((px - bx) ** 2 + (py - by) ** 2 < 5.5 * 5.5) continue;
    if (block(g, px, py, 1, 1)) n++;
  }
  const arena: RoomSpec = { x: cx - rx - 1, y: cy - ry - 1, w: rx * 2 + 3, h: ry * 2 + 3, shape: 'round', kind: 'arena' };
  return { g, rooms: [ante.room, arena], start: ante.start, boss: idx(g, bx, by), arena: 'crater' };
}

export const SKY_MOON_ARENAS: Record<string, ArenaFn> = { skyring, crater };
