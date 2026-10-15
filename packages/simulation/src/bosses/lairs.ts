import { FLOOR, block, carve, ellipse, idx, rect, ri, solid, straight, type Gen, type Grid, type RoomSpec } from '../mapgrid';
import { nextFloat, type RngState } from '../rng';

// Boss lairs of the scripted bosses (arenas.ts registers them with the other designs; content BOSS_ARENAS picks them).
// Same grammar as every arena: a quiet antechamber in the west, a short processional, a wide lair whose boss rises on
// a dais in its far half, with a clear 5x5 around it for the grand entrance.
//   datavault  the Corrupted Core's cursed data vault: a round vault ringed by rack rows (north and south arcs of
//              2x1 racks with service gaps, power cores behind the platform), four pylons round the raised core
//              platform in the middle. Racks and pylons break the laser lanes.
//   foundry    the Iron Colossus's molten foundry: a wide octagonal casting floor, four furnaces on the diagonals,
//              anvil pairs by the north and south walls, the casting pit (its dais) in the middle. Open ground for
//              the quake rings and the slag patterns.
//   skyring    the Gale Wyrm's floating ring of rock: an annulus of wind-scoured stone around a hole of open sky, reached
//              over a rock bridge. Everything beyond the rim is open air (chasm voids), so the gale can blow a hero off
//              the island; a few crags on the outer band give cover. Dives cross the hole; the Wyrm circles above it.
//   crater     the Crater Horror's lunar basin: a wide, lumpy bowl of regolith cut by a ramp from the antechamber, the
//              pit the Horror rises from, and satellite craters ringed with boulders (the Earth hangs in the sky above:
//              the moon theme's backdrop).

/** The quiet room the party arrives in (west side) and where they stand when the round starts. */
function antechamber(g: Grid, rng: RngState, cy: number): { room: RoomSpec; start: number; east: number } {
  const aw = ri(rng, 6, 7), ah = ri(rng, 7, 8);
  const x0 = 2, y0 = cy - Math.floor(ah / 2);
  rect(g, x0, y0, aw, ah, FLOOR);
  return { room: { x: x0, y: y0, w: aw, h: ah, shape: 'rect', kind: 'approach' }, start: idx(g, x0 + 3, cy), east: x0 + aw };
}

/** The Corrupted Core's data vault. */
export function datavault(rng: RngState): Gen {
  const W = ri(rng, 40, 43), H = ri(rng, 25, 27);
  const g = solid(W, H);
  const cy = Math.floor(H / 2);
  const R = Math.min(ri(rng, 10, 11), cy - 2);
  const cx = W - 3 - R;
  const ante = antechamber(g, rng, cy);
  ellipse(g, cx + 0.5, cy + 0.5, R + 0.5, R + 0.5, FLOOR);
  // the access corridor
  straight(g, ante.east - 1, cy - 1, cx - R + 1, cy - 1, 3);
  // rack rows on the north and south arcs (2x1 racks, a service gap after each)
  const rr = R - 2;
  for (const side of [-1, 1]) {
    for (let x = cx - rr + 2; x <= cx + rr - 3; x += 3) {
      if (nextFloat(rng) < 0.18) continue;
      const dx = x + 1 - (cx + 0.5);
      const y = cy + side * Math.round(Math.sqrt(Math.max(0, rr * rr - dx * dx)));
      block(g, x, y, 2, 1);
    }
  }
  // power cores behind the platform (east), never on the entrance side
  for (const a of [-0.55, 0, 0.55]) {
    if (nextFloat(rng) < 0.15) continue;
    block(g, Math.round(cx + Math.cos(a) * (R - 1.6)), Math.round(cy + Math.sin(a) * (R - 1.6)), 1, 1);
  }
  // the four pylons of the raised core platform
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) block(g, cx + dx * 3, cy + dy * 3, 1, 1);
  const arena: RoomSpec = { x: cx - R - 1, y: cy - R - 1, w: R * 2 + 3, h: R * 2 + 3, shape: 'round', kind: 'arena' };
  return { g, rooms: [ante.room, arena], start: ante.start, boss: idx(g, cx, cy), arena: 'datavault' };
}

/** The Iron Colossus's molten foundry. */
export function foundry(rng: RngState): Gen {
  const W = ri(rng, 40, 44), H = ri(rng, 25, 27);
  const g = solid(W, H);
  const cy = Math.floor(H / 2);
  const ry = Math.min(ri(rng, 9, 10), cy - 3);
  const rx = Math.min(ri(rng, 12, 13), Math.floor((W - 16) / 2));
  const cx = W - 3 - rx;
  const ante = antechamber(g, rng, cy);
  // the octagonal casting floor
  const diag = Math.round((rx + ry) * 0.74);
  for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
    if (Math.abs(x - cx) + Math.abs(y - cy) <= diag) rect(g, x, y, 1, 1, FLOOR);
  }
  // the slag run in from the antechamber
  straight(g, ante.east - 1, cy - 1, cx - rx + 1, cy - 1, 3);
  // furnaces on the diagonals, anvil pairs by the north and south walls
  const fx = Math.round(rx * (0.56 + nextFloat(rng) * 0.08)), fy = Math.round(ry * (0.56 + nextFloat(rng) * 0.08));
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) block(g, cx + dx * fx, cy + dy * fy, 1, 1);
  for (const side of [-1, 1]) {
    const x = cx - 1 + (nextFloat(rng) < 0.5 ? -3 : 3);
    block(g, x, cy + side * (ry - 2), 2, 1);
  }
  const arena: RoomSpec = { x: cx - rx - 1, y: cy - ry - 1, w: rx * 2 + 3, h: ry * 2 + 3, shape: 'round', kind: 'arena' };
  return { g, rooms: [ante.room, arena], start: ante.start, boss: idx(g, cx, cy), arena: 'foundry' };
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
export function skyring(rng: RngState): Gen {
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
export function crater(rng: RngState): Gen {
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
