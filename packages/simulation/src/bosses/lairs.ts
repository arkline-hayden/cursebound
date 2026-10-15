import { FLOOR, block, ellipse, idx, rect, ri, solid, straight, type Gen, type Grid, type RoomSpec } from '../mapgrid';
import { nextFloat, type RngState } from '../rng';

// Boss lairs of the scripted bosses (arenas.ts registers them with the other designs). Same grammar as every arena:
// a quiet antechamber in the west, a short processional, a wide lair whose boss rises on a dais in its far half.
//   datavault  the Corrupted Core's cursed data vault: a round vault ringed by rack rows (north and south arcs of
//              2x1 racks with service gaps, power cores behind the platform), four pylons round the raised core
//              platform in the middle. Racks and pylons break the laser lanes.
//   foundry    the Iron Colossus's molten foundry: a wide octagonal casting floor, four furnaces on the diagonals,
//              anvil pairs by the north and south walls, the casting pit (its dais) in the middle. Open ground for
//              the quake rings and the slag patterns.

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
