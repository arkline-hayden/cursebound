import { BIOMES, DUNGEON_LAYOUTS, DUNGEON_THEMES, RULES, THEME_BOSSES } from '@cursebound/content';
import { arenaDesign, generateArena } from './arenas';
import { FLOOR, WALL, carve, corridor, ellipse, fill, idx, rect, ri, solid, type Gen, type Grid, type RoomSpec } from './mapgrid';
import { assignKinds, finalRooms, furnish, partitionRooms } from './rooms';
import { nextFloat, nextInt, seedRng, shuffleInPlace, type RngState } from './rng';
import type { MapRoom, MapState, RoomKind } from './types';

// Procedural dungeon floors (PRD §14.1), generated in tiers:
//   1. layout archetype (this module): the macro shape of the floor (chambers and corridors, hub and spokes, cell
//      warrens, cross vaults, cloisters, chasm bridges, caverns, ...) carved out of solid rock, recording its rooms;
//   2. room typing (rooms.ts): every room becomes a crypt, scriptorium, cistern, shrine, ossuary, ... by theme, size
//      and silhouette; kinds with blocking furniture carve it into the grid (sarcophagus rows, pillar grids, rubble);
//   3. per-room design (client, render/dressing.ts): rugs, mosaics, water, props, wall decor and lights per kind,
//      seeded from decorSeed and each room's variant.
// Boss floors are hand-designed arenas instead (arenas.ts), one family per boss. Validation then guarantees full
// connectivity (no unreachable required enemy), minimum playable area and spawn separation; invalid results retry
// deterministically, then fall back to an authored hall. The map stream is independent of the Fate offer stream.

// ---------------- tier 1: layout archetypes ----------------

type Layout = (rng: RngState, w: number, h: number) => Gen;

/** BSP rooms joined by corridors (2-3 wide so combat flows). */
function halls(rng: RngState, w: number, h: number): Gen {
  const g = solid(w, h);
  const leaves: RoomSpec[] = [];
  const split = (r: RoomSpec, depth: number) => {
    const canH = r.w >= 16, canV = r.h >= 14;
    if (depth > 3 || (!canH && !canV) || (depth > 1 && nextFloat(rng) < 0.25)) { leaves.push(r); return; }
    const horizontal = canH && (!canV || r.w / r.h > 1.15 || (r.w / r.h > 0.85 && nextInt(rng, 2) === 0));
    if (horizontal) { const cut = ri(rng, 8, r.w - 8); split({ x: r.x, y: r.y, w: cut, h: r.h, shape: 'rect' }, depth + 1); split({ x: r.x + cut, y: r.y, w: r.w - cut, h: r.h, shape: 'rect' }, depth + 1); }
    else { const cut = ri(rng, 7, r.h - 7); split({ x: r.x, y: r.y, w: r.w, h: cut, shape: 'rect' }, depth + 1); split({ x: r.x, y: r.y + cut, w: r.w, h: r.h - cut, shape: 'rect' }, depth + 1); }
  };
  split({ x: 1, y: 1, w: w - 2, h: h - 2, shape: 'rect' }, 0);
  const rooms: RoomSpec[] = leaves.map((l) => {
    const rw = ri(rng, Math.max(6, l.w - 5), Math.max(6, l.w - 2));
    const rh = ri(rng, Math.max(5, l.h - 4), Math.max(5, l.h - 2));
    const ww = Math.min(rw, l.w - 2), hh = Math.min(rh, l.h - 2);
    return { x: l.x + ri(rng, 1, Math.max(1, l.w - rw - 1)), y: l.y + ri(rng, 1, Math.max(1, l.h - rh - 1)), w: ww, h: hh, shape: ww >= hh * 2.2 || hh >= ww * 2.2 ? 'hall' : 'rect' };
  });
  for (const r of rooms) {
    rect(g, r.x, r.y, r.w, r.h, FLOOR);
    // chamfered corners (the room kinds bring the furniture)
    if (nextFloat(rng) < 0.5) { fill(g, r.x, r.y); fill(g, r.x + r.w - 1, r.y); fill(g, r.x, r.y + r.h - 1); fill(g, r.x + r.w - 1, r.y + r.h - 1); }
  }
  const order = rooms.slice().sort((a, b) => (a.x + a.w / 2) - (b.x + b.w / 2));
  for (let i = 1; i < order.length; i++) {
    const a = order[i - 1], b = order[i];
    corridor(g, rng, Math.floor(a.x + a.w / 2), Math.floor(a.y + a.h / 2), Math.floor(b.x + b.w / 2), Math.floor(b.y + b.h / 2), ri(rng, 2, 3));
  }
  // a loop or two so fights can circle
  for (let k = 0; k < 2 && order.length > 2; k++) {
    const a = order[nextInt(rng, order.length)], b = order[nextInt(rng, order.length)];
    if (a !== b) corridor(g, rng, Math.floor(a.x + a.w / 2), Math.floor(a.y + a.h / 2), Math.floor(b.x + b.w / 2), Math.floor(b.y + b.h / 2), 2);
  }
  return { g, rooms };
}

/** Cellular-automata caverns: organic chambers, kept to the largest connected region. */
function caverns(rng: RngState, w: number, h: number): Gen {
  let g = solid(w, h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) g.t[idx(g, x, y)] = nextFloat(rng) < 0.43 ? WALL : FLOOR;
  for (let it = 0; it < 5; it++) {
    const n = solid(w, h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      let walls = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && g.t[idx(g, x + dx, y + dy)] === WALL) walls++;
      n.t[idx(n, x, y)] = walls >= 5 || (it < 2 && walls <= 1) ? WALL : FLOOR;
      if (it >= 2) n.t[idx(n, x, y)] = walls >= 5 ? WALL : FLOOR;
    }
    g = n;
  }
  // widen narrow passages so the party is not funnelled into single tiles
  const out: Grid = { w, h, t: g.t.slice() };
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (g.t[idx(g, x, y)] !== FLOOR) continue;
    if (g.t[idx(g, x - 1, y)] === WALL && g.t[idx(g, x + 1, y)] === WALL) carve(out, x + 1, y);
    if (g.t[idx(g, x, y - 1)] === WALL && g.t[idx(g, x, y + 1)] === WALL) carve(out, x, y + 1);
  }
  return { g: out, rooms: partitionRooms(out, 'cave', 85) };
}

/** Cross-shaped great hall with side chambers at the arm ends. */
function cross(rng: RngState, w: number, h: number): Gen {
  const g = solid(w, h);
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  const armW = ri(rng, 4, 6), armH = ri(rng, 4, 5);
  rect(g, 2, cy - Math.floor(armH / 2), w - 4, armH, FLOOR);
  rect(g, cx - Math.floor(armW / 2), 2, armW, h - 4, FLOOR);
  const core = ri(rng, 4, 6);
  ellipse(g, cx + 0.5, cy + 0.5, core + 2, core, FLOOR);
  const rooms: RoomSpec[] = [{ x: cx - core - 2, y: cy - core, w: core * 2 + 5, h: core * 2 + 1, shape: 'round', kinds: ['shrine', 'pillared', 'cistern', 'ossuary', 'crypt', 'collapsed', 'forge', 'grotto'] }];
  for (const [ex, ey] of [[4, cy], [w - 5, cy], [cx, 4], [cx, h - 5]]) if (nextFloat(rng) < 0.85) {
    rect(g, ex - 3, ey - 3, 7, 6, FLOOR);
    rooms.push({ x: ex - 3, y: ey - 3, w: 7, h: 6, shape: 'rect' });
  }
  // the arms are passages (the smaller core and chambers win their shared tiles on the client)
  rooms.push({ x: 2, y: cy - Math.floor(armH / 2), w: w - 4, h: armH, shape: 'hall', kind: 'hall' }, { x: cx - Math.floor(armW / 2), y: 2, w: armW, h: h - 4, shape: 'hall', kind: 'hall' });
  // braziers' plinths in the core
  if (nextFloat(rng) < 0.6) { fill(g, cx - 2, cy - 2); fill(g, cx + 2, cy - 2); fill(g, cx - 2, cy + 2); fill(g, cx + 2, cy + 2); rooms[0].furnished = true; }
  return { g, rooms };
}

/** Pillared colonnade hall with aisles. */
function colonnade(rng: RngState, w: number, h: number): Gen {
  const g = solid(w, h);
  rect(g, 2, 2, w - 4, h - 4, FLOOR);
  const sx = ri(rng, 3, 4), sy = ri(rng, 3, 4);
  const ox = ri(rng, 4, 5), oy = ri(rng, 4, 5);
  for (let y = oy; y < h - 4; y += sy) for (let x = ox; x < w - 4; x += sx) if (nextFloat(rng) < 0.85) fill(g, x, y);
  // alcoves along the long walls
  for (let x = 4; x < w - 4; x += ri(rng, 4, 6)) { if (nextFloat(rng) < 0.6) carve(g, x, 1); if (nextFloat(rng) < 0.6) carve(g, x, h - 2); }
  // knock out a few columns to open fighting lanes
  for (let k = 0; k < 4; k++) carve(g, ri(rng, 3, w - 4), ri(rng, 3, h - 4));
  return { g, rooms: [{ x: 2, y: 1, w: w - 4, h: h - 2, shape: 'rect', kinds: ['pillared', 'library', 'crypt', 'shrine', 'cistern', 'barracks'], furnished: true }] };
}

/** Ring chamber around a central pit or shrine with spokes through it. */
function ring(rng: RngState, w: number, h: number): Gen {
  const g = solid(w, h);
  const cx = w / 2, cy = h / 2;
  const rx = w / 2 - 2, ry = h / 2 - 2;
  ellipse(g, cx, cy, rx, ry, FLOOR);
  const ir = ri(rng, 3, 5);
  ellipse(g, cx, cy, ir * 1.5, ir, WALL);
  const spokes = ri(rng, 2, 4);
  for (let s = 0; s < spokes; s++) {
    const a = (s / spokes) * Math.PI * 2 + nextFloat(rng);
    for (let r = 0; r <= ir * 1.6; r += 0.5) { carve(g, Math.floor(cx + Math.cos(a) * r * 1.4), Math.floor(cy + Math.sin(a) * r)); carve(g, Math.floor(cx + Math.cos(a) * r * 1.4) + 1, Math.floor(cy + Math.sin(a) * r)); }
  }
  const rooms: RoomSpec[] = [];
  // corner chambers first (they claim their tiles before the ring)
  for (const [qx, qy] of [[3, 3], [w - 9, 3], [3, h - 8], [w - 9, h - 8]]) if (nextFloat(rng) < 0.5) {
    rect(g, qx, qy, 6, 5, FLOOR);
    rooms.push({ x: qx, y: qy, w: 6, h: 5, shape: 'rect' });
  }
  rooms.push({ x: 2, y: 2, w: w - 4, h: h - 4, shape: 'round', kinds: ['shrine', 'cistern', 'ossuary', 'crypt', 'collapsed', 'grotto', 'forge'], furnished: true });
  return { g, rooms };
}

/** Long crypt gallery lined with sarcophagi and side niches. */
function gallery(rng: RngState, w: number, h: number): Gen {
  const g = solid(w, h);
  const top = ri(rng, 3, 5), bottom = h - ri(rng, 3, 5);
  rect(g, 2, top, w - 4, bottom - top, FLOOR);
  // sarcophagi rows (2x1 blocks)
  const rows = [top + 2, bottom - 3];
  if (bottom - top > 12) rows.push(Math.floor((top + bottom) / 2) - 1);
  for (const ry of rows) for (let x = 5; x < w - 6; x += ri(rng, 4, 6)) { fill(g, x, ry); fill(g, x + 1, ry); }
  // niches above and below
  for (let x = 4; x < w - 4; x += ri(rng, 3, 5)) {
    const nh = ri(rng, 1, Math.max(1, top - 1));
    rect(g, x, top - nh, 2, nh, FLOOR);
    const nb = ri(rng, 1, Math.max(1, h - bottom - 1));
    rect(g, x, bottom, 2, nb, FLOOR);
  }
  // an antechamber at each end
  rect(g, 2, Math.floor(h / 2) - 4, 6, 8, FLOOR);
  rect(g, w - 8, Math.floor(h / 2) - 4, 6, 8, FLOOR);
  return {
    g,
    rooms: [
      { x: 2, y: Math.floor(h / 2) - 4, w: 6, h: 8, shape: 'rect', kinds: ['shrine', 'treasury', 'torture', 'library', 'ossuary', 'barracks'] },
      { x: w - 8, y: Math.floor(h / 2) - 4, w: 6, h: 8, shape: 'rect', kinds: ['shrine', 'treasury', 'torture', 'library', 'ossuary', 'barracks'] },
      { x: 8, y: 1, w: w - 16, h: h - 2, shape: 'hall', kind: 'crypt', furnished: true },
    ],
  };
}

/** Ruined chamber with scattered rubble clusters. */
function ruins(rng: RngState, w: number, h: number): Gen {
  const g = solid(w, h);
  ellipse(g, w / 2, h / 2, w / 2 - 1.5, h / 2 - 1.5, FLOOR);
  rect(g, 3, 3, w - 6, h - 6, FLOOR);
  const clusters = ri(rng, 7, 12);
  for (let k = 0; k < clusters; k++) {
    const x = ri(rng, 4, w - 6), y = ri(rng, 4, h - 6);
    const shape = nextInt(rng, 4);
    if (shape === 0) { fill(g, x, y); fill(g, x + 1, y); fill(g, x, y + 1); }
    else if (shape === 1) { fill(g, x, y); fill(g, x + 1, y); fill(g, x + 2, y); }
    else if (shape === 2) { fill(g, x, y); fill(g, x, y + 1); }
    else fill(g, x, y);
  }
  // the open ruin reads as two or three zones, each with its own purpose (the rubble is already down)
  return { g, rooms: partitionRooms(g, 'cave', 160, ['collapsed', 'grotto', 'ossuary', 'shrine', 'cistern', 'crypt']).map((r) => ({ ...r, furnished: true })) };
}

/** Hub and spokes: a great round chamber with satellite rooms on radial passages. */
function hub(rng: RngState, w: number, h: number): Gen {
  const g = solid(w, h);
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  const R = ri(rng, 4, 6);
  ellipse(g, cx + 0.5, cy + 0.5, R + 1.5, R + 0.5, FLOOR);
  const rooms: RoomSpec[] = [{ x: cx - R - 2, y: cy - R - 1, w: R * 2 + 5, h: R * 2 + 3, shape: 'round', kinds: ['shrine', 'pillared', 'cistern', 'ossuary', 'crypt', 'grotto', 'forge'] }];
  const n = ri(rng, 4, 6), rot = nextFloat(rng) * Math.PI * 2;
  const placed: RoomSpec[] = [];
  for (let k = 0; k < n * 3 && placed.length < n; k++) {
    const a = rot + (k / n) * Math.PI * 2 + (nextFloat(rng) - 0.5) * 0.6;
    const rw = ri(rng, 6, 9), rh = ri(rng, 5, 7);
    const sx = Math.max(2, Math.min(w - 2 - rw, Math.round(cx + Math.cos(a) * (w / 2 - 6) - rw / 2)));
    const sy = Math.max(2, Math.min(h - 2 - rh, Math.round(cy + Math.sin(a) * (h / 2 - 5) - rh / 2)));
    // satellites never merge with each other or with the hub
    if (placed.some((o) => sx < o.x + o.w + 1 && sx + rw + 1 > o.x && sy < o.y + o.h + 1 && sy + rh + 1 > o.y)) continue;
    if (Math.abs(sx + rw / 2 - cx) < R + rw / 2 + 2 && Math.abs(sy + rh / 2 - cy) < R + rh / 2 + 1) continue;
    rect(g, sx, sy, rw, rh, FLOOR);
    corridor(g, rng, cx, cy, Math.floor(sx + rw / 2), Math.floor(sy + rh / 2), ri(rng, 2, 3));
    placed.push({ x: sx, y: sy, w: rw, h: rh, shape: 'rect' });
  }
  rooms.push(...placed);
  return { g, rooms };
}

/** Cell warren: a block of cells with doorways (a spanning tree plus a few loops); some cells knocked together. */
function warren(rng: RngState, w: number, h: number): Gen {
  const g = solid(w, h);
  const cw = ri(rng, 6, 8), ch = ri(rng, 5, 6);
  const cols = Math.floor((w - 3) / (cw + 1)), rows = Math.floor((h - 3) / (ch + 1));
  const ox = Math.floor((w - (cols * (cw + 1) - 1)) / 2), oy = Math.floor((h - (rows * (ch + 1) - 1)) / 2);
  const cell = (c: number, r: number) => ({ x: ox + c * (cw + 1), y: oy + r * (ch + 1) });
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const p = cell(c, r); rect(g, p.x, p.y, cw, ch, FLOOR); }
  // merge some neighbours into bigger halls (remove the shared wall)
  const owner = Array.from({ length: rows * cols }, (_, i) => i);
  for (let r = 0; r < rows; r++) for (let c = 0; c + 1 < cols; c++) {
    if (nextFloat(rng) > 0.18 || owner[r * cols + c] !== r * cols + c || owner[r * cols + c + 1] !== r * cols + c + 1) continue;
    const p = cell(c, r);
    rect(g, p.x + cw, p.y, 1, ch, FLOOR);
    owner[r * cols + c + 1] = r * cols + c;
  }
  // doorways: randomised spanning tree, then a couple of extra loops
  const door = (c: number, r: number, dir: 0 | 1) => {
    const p = cell(c, r);
    if (dir === 0) { const y = p.y + ri(rng, 1, ch - 3); rect(g, p.x + cw, y, 1, 2, FLOOR); }
    else { const x = p.x + ri(rng, 1, cw - 3); rect(g, x, p.y + ch, 2 + nextInt(rng, 2), 1, FLOOR); }
  };
  const seen = new Uint8Array(rows * cols);
  const stack = [nextInt(rng, rows * cols)];
  seen[stack[0]] = 1;
  while (stack.length) {
    const cur = stack[stack.length - 1], c = cur % cols, r = (cur / cols) | 0;
    const nb = ([[c + 1, r, 0], [c - 1, r, 0], [c, r + 1, 1], [c, r - 1, 1]] as [number, number, 0 | 1][]).filter(([nc, nr]) => nc >= 0 && nr >= 0 && nc < cols && nr < rows && !seen[nr * cols + nc]);
    if (!nb.length) { stack.pop(); continue; }
    const [nc, nr, dir] = nb[nextInt(rng, nb.length)];
    door(Math.min(c, nc), Math.min(r, nr), dir);
    seen[nr * cols + nc] = 1;
    stack.push(nr * cols + nc);
  }
  for (let k = 0; k < 2 + nextInt(rng, 2); k++) {
    const c = nextInt(rng, cols), r = nextInt(rng, rows);
    if (nextInt(rng, 2) === 0 && c + 1 < cols) door(c, r, 0); else if (r + 1 < rows) door(c, r, 1);
  }
  const rooms: RoomSpec[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (owner[r * cols + c] !== r * cols + c) continue;
    const p = cell(c, r);
    const merged = c + 1 < cols && owner[r * cols + c + 1] === r * cols + c;
    rooms.push({ x: p.x, y: p.y, w: merged ? cw * 2 + 1 : cw, h: ch, shape: merged ? 'hall' : 'rect' });
  }
  return { g, rooms };
}

/** Chasm bridges: a great hall whose middle fell into the dark, islands joined to the ledge by narrow bridges. */
function chasm(rng: RngState, w: number, h: number): Gen {
  const g = solid(w, h);
  const voids = new Uint8Array(w * h);
  rect(g, 2, 2, w - 4, h - 4, FLOOR);
  const L = ri(rng, 3, 4);
  const x0 = 2 + L, y0 = 2 + L, x1 = w - 3 - L, y1 = h - 3 - L;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { g.t[idx(g, x, y)] = WALL; voids[idx(g, x, y)] = 1; }
  const open = (x: number, y: number) => { carve(g, x, y); voids[idx(g, x, y)] = 0; };
  const n = ri(rng, 2, 3);
  const span = (x1 - x0 + 1) / n;
  const islands: RoomSpec[] = [];
  for (let k = 0; k < n; k++) {
    const iw = Math.min(Math.floor(span) - 3, ri(rng, 6, 8)), ih = Math.min(y1 - y0 - 3, ri(rng, 5, 7));
    if (iw < 4 || ih < 4) continue;
    const ix = Math.round(x0 + span * k + (span - iw) / 2), iy = Math.round((y0 + y1 - ih) / 2) + ri(rng, -1, 1);
    const round = nextFloat(rng) < 0.4;
    for (let y = iy; y < iy + ih; y++) for (let x = ix; x < ix + iw; x++) {
      const dx = (x + 0.5 - (ix + iw / 2)) / (iw / 2), dy = (y + 0.5 - (iy + ih / 2)) / (ih / 2);
      if (!round || dx * dx + dy * dy <= 1.05) open(x, y);
    }
    islands.push({ x: ix, y: iy, w: iw, h: ih, shape: round ? 'round' : 'rect', kinds: ['shrine', 'ossuary', 'treasury', 'crypt', 'collapsed', 'torture', 'grotto'] });
  }
  const bridges: RoomSpec[] = [];
  const bridge = (ax: number, ay: number, bx: number, by: number) => {
    const horiz = ay === by;
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) {
      open(x, y);
      if (horiz) open(x, y + 1); else open(x + 1, y);
    }
    bridges.push(horiz ? { x: Math.min(ax, bx), y: ay, w: Math.abs(bx - ax) + 1, h: 2, shape: 'hall', kind: 'bridge' } : { x: ax, y: Math.min(ay, by), w: 2, h: Math.abs(by - ay) + 1, shape: 'hall', kind: 'bridge' });
  };
  islands.forEach((is, k) => {
    const cy = is.y + Math.floor(is.h / 2) - 1 + nextInt(rng, 2);
    // west to the previous island (or the west ledge), the last one also east to the ledge
    if (k === 0) bridge(x0 - 1, cy, is.x, cy);
    else { const p = islands[k - 1]; const py = Math.max(is.y, p.y) + 1; bridge(p.x + p.w - 1, py, is.x, py); }
    if (k === islands.length - 1) bridge(is.x + is.w - 1, cy, x1 + 1, cy);
    // and now and then north or south to the ledge
    const cx = is.x + Math.floor(is.w / 2) - 1;
    if (nextFloat(rng) < 0.5) bridge(cx, y0 - 1, cx, is.y);
    else if (nextFloat(rng) < 0.5) bridge(cx, is.y + is.h - 1, cx, y1 + 1);
  });
  // the ledge round the drop is one long walkway
  return { g, rooms: [...islands, ...bridges, { x: 2, y: 2, w: w - 4, h: h - 4, shape: 'hall', kind: 'hall' }], voids };
}

/** Cloister: an arcaded courtyard ringed by a walk, chapels and cells opening off it. */
function cloister(rng: RngState, w: number, h: number): Gen {
  const g = solid(w, h);
  const cw = ri(rng, 9, 13), ch = ri(rng, 6, 8), aw = ri(rng, 2, 3);
  const cx0 = Math.floor((w - cw) / 2), cy0 = Math.floor((h - ch) / 2);
  const wx0 = cx0 - aw, wy0 = cy0 - aw, ww = cw + aw * 2, wh = ch + aw * 2;
  rect(g, wx0, wy0, ww, wh, FLOOR);
  const rooms: RoomSpec[] = [{ x: cx0, y: cy0, w: cw, h: ch, shape: 'rect', kinds: ['cistern', 'grotto', 'shrine', 'collapsed', 'ossuary', 'crypt'] }];
  // the arcade: columns round the court's edge
  const step = ri(rng, 2, 3);
  for (let x = cx0; x < cx0 + cw; x += step) { fill(g, x, cy0); fill(g, x, cy0 + ch - 1); }
  for (let y = cy0 + step; y < cy0 + ch - 1; y += step) { fill(g, cx0, y); fill(g, cx0 + cw - 1, y); }
  rooms[0].furnished = true;
  // ranges of rooms on every side beyond the walk's outer wall, each with a door onto the walk
  const sides: { x: number; y: number; w: number; h: number; horiz: boolean; doorAt: (r: RoomSpec) => void }[] = [
    { x: 2, y: 2, w: w - 4, h: wy0 - 3, horiz: true, doorAt: (r) => rect(g, Math.max(wx0, Math.min(wx0 + ww - 2, r.x + Math.floor(r.w / 2) - 1)), r.y + r.h, 2, wy0 - (r.y + r.h), FLOOR) },
    { x: 2, y: wy0 + wh + 1, w: w - 4, h: h - 3 - (wy0 + wh + 1), horiz: true, doorAt: (r) => rect(g, Math.max(wx0, Math.min(wx0 + ww - 2, r.x + Math.floor(r.w / 2) - 1)), wy0 + wh, 2, r.y - (wy0 + wh), FLOOR) },
    { x: 2, y: wy0, w: wx0 - 3, h: wh, horiz: false, doorAt: (r) => rect(g, r.x + r.w, Math.max(wy0, Math.min(wy0 + wh - 2, r.y + Math.floor(r.h / 2) - 1)), wx0 - (r.x + r.w), 2, FLOOR) },
    { x: wx0 + ww + 1, y: wy0, w: w - 3 - (wx0 + ww + 1), h: wh, horiz: false, doorAt: (r) => rect(g, wx0 + ww, Math.max(wy0, Math.min(wy0 + wh - 2, r.y + Math.floor(r.h / 2) - 1)), r.x - (wx0 + ww), 2, FLOOR) },
  ];
  for (const s of sides) {
    const len = s.horiz ? s.w : s.h, depth = s.horiz ? s.h : s.w;
    if (depth < 4 || len < 5) continue;
    const parts = Math.max(1, Math.min(3, Math.floor(len / ri(rng, 9, 13))));
    let at = 0;
    for (let p = 0; p < parts; p++) {
      const l = p === parts - 1 ? len - at : Math.floor(len / parts) - 1;
      if (l >= 4) {
        const r: RoomSpec = s.horiz ? { x: s.x + at, y: s.y, w: l, h: s.h, shape: 'rect' } : { x: s.x, y: s.y + at, w: s.w, h: l, shape: 'rect' };
        rect(g, r.x, r.y, r.w, r.h, FLOOR);
        s.doorAt(r);
        rooms.push(r);
      }
      at += l + 1;
    }
  }
  return { g, rooms };
}

/** Cross vaults: a grid of square vaulted chambers opening into each other through wide arches. */
function vaults(rng: RngState, w: number, h: number): Gen {
  const g = solid(w, h);
  const cols = w >= 36 ? ri(rng, 3, 4) : 3, rows = h >= 24 ? ri(rng, 2, 3) : 2;
  const vw = Math.floor((w - 3) / cols) - 1, vh = Math.floor((h - 3) / rows) - 1;
  const ox = Math.floor((w - cols * (vw + 1) + 1) / 2), oy = Math.floor((h - rows * (vh + 1) + 1) / 2);
  const at = (c: number, r: number) => ({ x: ox + c * (vw + 1), y: oy + r * (vh + 1) });
  const rooms: RoomSpec[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const p = at(c, r);
    rect(g, p.x, p.y, vw, vh, FLOOR);
    rooms.push({ x: p.x, y: p.y, w: vw, h: vh, shape: 'rect' });
  }
  // arches: every neighbour pair along a spanning tree, the rest with a good chance (wide, so fights flow)
  const arch = (c: number, r: number, dir: 0 | 1) => {
    const p = at(c, r);
    if (dir === 0) rect(g, p.x + vw, p.y + Math.floor(vh / 2) - 1, 1, 3, FLOOR);
    else rect(g, p.x + Math.floor(vw / 2) - 1, p.y + vh, 3, 1, FLOOR);
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (c + 1 < cols && (r === 0 || nextFloat(rng) < 0.7)) arch(c, r, 0);
    if (r + 1 < rows && (c === 0 || nextFloat(rng) < 0.7)) arch(c, r, 1);
  }
  return { g, rooms };
}

const GENERATORS: Record<string, Layout> = { halls, caverns, cross, colonnade, ring, gallery, ruins, hub, warren, chasm, cloister, vaults };

// ---------------- validation & spawns ----------------

function keepLargestRegion(g: Grid): number {
  const seen = new Int32Array(g.w * g.h).fill(-1);
  let best = -1, bestSize = 0, id = 0;
  for (let i = 0; i < g.t.length; i++) {
    if (g.t[i] !== FLOOR || seen[i] >= 0) continue;
    let size = 0;
    const stack = [i];
    seen[i] = id;
    while (stack.length) {
      const c = stack.pop()!;
      size++;
      const x = c % g.w, y = (c / g.w) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
        const n = ny * g.w + nx;
        if (g.t[n] === FLOOR && seen[n] < 0) { seen[n] = id; stack.push(n); }
      }
    }
    if (size > bestSize) { bestSize = size; best = id; }
    id++;
  }
  for (let i = 0; i < g.t.length; i++) if (g.t[i] === FLOOR && seen[i] !== best) g.t[i] = WALL;
  return bestSize;
}

function bfs(g: Grid, start: number): Int32Array {
  const d = new Int32Array(g.w * g.h).fill(-1);
  const q = [start];
  d[start] = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    const x = c % g.w, y = (c / g.w) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const n = ny * g.w + nx;
      if (g.t[n] === FLOOR && d[n] < 0) { d[n] = d[c] + 1; q.push(n); }
    }
  }
  return d;
}

function openness(g: Grid, i: number): number {
  const x = i % g.w, y = (i / g.w) | 0;
  let n = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx >= 0 && yy >= 0 && xx < g.w && yy < g.h && g.t[yy * g.w + xx] === FLOOR) n++;
  }
  return n;
}

/**
 * Sky floors are one shard of earth adrift in open air: the rock mass around and between the rooms (every wall tile
 * 4-connected to the map border) falls away into sky, except the back walls the camera sees (a wall directly north
 * or west of floor), which stay as the shard's raised rim so the Fate doors still have a face to stand in. Furniture
 * the room kinds carved stands free of that mass and keeps its tiles. Front edges therefore drop straight into the
 * void (the client hangs the shard's underside there). Pure function of the grid: no RNG draw, so the macro geometry
 * and every later draw of the map stream are identical to any other theme's.
 */
function skyVoids(g: Grid): Uint8Array {
  const out = new Uint8Array(g.w * g.h);
  const outer = new Uint8Array(g.w * g.h);
  const q: number[] = [];
  for (let x = 0; x < g.w; x++) for (const y of [0, g.h - 1]) { const i = idx(g, x, y); if (!outer[i]) { outer[i] = 1; q.push(i); } }
  for (let y = 0; y < g.h; y++) for (const x of [0, g.w - 1]) { const i = idx(g, x, y); if (!outer[i]) { outer[i] = 1; q.push(i); } }
  for (let k = 0; k < q.length; k++) {
    const c = q[k], x = c % g.w, y = (c / g.w) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const n = idx(g, nx, ny);
      if (!outer[n] && g.t[n] === WALL) { outer[n] = 1; q.push(n); }
    }
  }
  const floorAt = (x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h && g.t[idx(g, x, y)] === FLOOR;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = idx(g, x, y);
    if (outer[i] && !floorAt(x, y + 1) && !floorAt(x + 1, y)) out[i] = 1;
  }
  return out;
}

function finish(gen: Gen, rng: RngState, layout: string, theme: string, attempt: number, boss: boolean): MapState | null {
  const g = gen.g;
  // seal the border
  for (let x = 0; x < g.w; x++) { g.t[x] = WALL; g.t[(g.h - 1) * g.w + x] = WALL; }
  for (let y = 0; y < g.h; y++) { g.t[y * g.w] = WALL; g.t[y * g.w + g.w - 1] = WALL; }
  const before = g.t.slice();
  const area = keepLargestRegion(g);
  if (area < (boss ? 280 : 230)) return null;
  if (gen.voids) {
    // floor cut away with an unreachable island falls into the chasm with it
    const v = gen.voids, q: number[] = [];
    for (let i = 0; i < v.length; i++) if (v[i]) q.push(i);
    for (let k = 0; k < q.length; k++) {
      const c = q[k], x = c % g.w, y = (c / g.w) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 1 || ny < 1 || nx >= g.w - 1 || ny >= g.h - 1) continue;
        const n = ny * g.w + nx;
        if (!v[n] && before[n] === FLOOR && g.t[n] === WALL) { v[n] = 1; q.push(n); }
      }
    }
  }
  if (gen.start !== undefined && g.t[gen.start] !== FLOOR) return null;
  if (gen.boss !== undefined && g.t[gen.boss] !== FLOOR) return null;
  // tiers 2 and 2b: room kinds, then the furniture that blocks
  const kinds = assignKinds(g, gen.rooms, theme, rng);
  furnish(g, gen.rooms, kinds, rng);
  // player start: an open tile; boss rounds start in the arena's antechamber (or at the west side)
  const floors: number[] = [];
  for (let i = 0; i < g.t.length; i++) if (g.t[i] === FLOOR && openness(g, i) >= 20) floors.push(i);
  if (floors.length < 20) return null;
  let start = floors[nextInt(rng, floors.length)];
  if (gen.start !== undefined) start = gen.start;
  else if (boss) start = floors.reduce((b, i) => ((i % g.w) < (b % g.w) ? i : b), floors[0]);
  // pick the start so that the far side is genuinely far
  let d = bfs(g, start);
  let far = 0;
  for (let i = 0; i < d.length; i++) if (d[i] > far) far = d[i];
  if (!boss) {
    // move start toward one extreme of the map for a meaningful approach
    const extreme = d.indexOf(far);
    const d2 = bfs(g, extreme);
    let far2 = 0, far2i = start;
    for (const i of floors) if (d2[i] > far2) { far2 = d2[i]; far2i = i; }
    start = far2i;
    d = bfs(g, start);
    far = 0;
    for (let i = 0; i < d.length; i++) if (d[i] > far) far = d[i];
  }
  if (far < 12) return null;
  if (gen.boss !== undefined && d[gen.boss] < 12) return null;
  const sx = start % g.w, sy = (start / g.w) | 0;
  const playerSpawns: { x: number; y: number }[] = [];
  const ring: [number, number][] = [[0, 0], [0, -1], [0, 1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [0, 2], [-2, 0], [0, -2]];
  for (const [dx, dy] of ring) {
    const x = sx + dx, y = sy + dy;
    if (x > 0 && y > 0 && x < g.w - 1 && y < g.h - 1 && g.t[y * g.w + x] === FLOOR) playerSpawns.push({ x: x + 0.5, y: y + 0.5 });
    if (playerSpawns.length >= 5) break;
  }
  if (playerSpawns.length < 5) return null;
  // enemy spawns: spaced, far from the party, prefer open tiles
  const cand = floors.filter((i) => d[i] >= Math.max(10, Math.floor(far * 0.45))).sort((a, b) => d[b] - d[a] || a - b);
  shuffleInPlace(rng, cand);
  const enemySpawns: { x: number; y: number }[] = [];
  for (const i of cand) {
    const x = (i % g.w) + 0.5, y = ((i / g.w) | 0) + 0.5;
    if (enemySpawns.every((e) => Math.abs(e.x - x) + Math.abs(e.y - y) >= 5)) enemySpawns.push({ x, y });
    if (enemySpawns.length >= 10) break;
  }
  if (enemySpawns.length < 4) return null;
  const rooms = finalRooms(g, gen.rooms, kinds, rng);
  const voids: number[] = [];
  const open = theme === 'sky' ? skyVoids(g) : null;
  if (gen.voids || open) for (let i = 0; i < g.t.length; i++) if ((gen.voids?.[i] || open?.[i]) && g.t[i] === WALL) voids.push(i);
  const m: MapState = {
    w: g.w, h: g.h, tiles: g.t, topology: layout, playerSpawns, enemySpawns, fallback: false, decorSeed: attempt + nextInt(rng, 100000), theme, layout,
    rooms,
  };
  if (voids.length) m.voids = voids;
  if (gen.arena) m.arena = gen.arena;
  if (gen.boss !== undefined) m.bossSpawn = { x: (gen.boss % g.w) + 0.5, y: ((gen.boss / g.w) | 0) + 0.5 };
  m.topology = encodeTopology(m);
  return m;
}

function fallbackMap(boss: boolean, theme: string): MapState {
  const w = boss ? 34 : 30, h = boss ? 22 : 20;
  const g = solid(w, h);
  rect(g, 1, 1, w - 2, h - 2, FLOOR);
  for (const [x, y] of [[8, 5], [8, 14], [w - 9, 5], [w - 9, 14], [(w / 2) | 0, 4], [(w / 2) | 0, h - 5]]) { fill(g, x, y); fill(g, x + 1, y); }
  const psy = (h / 2) | 0;
  return {
    w, h, tiles: g.t, topology: 'fallback', fallback: true, decorSeed: 0, theme, layout: 'fallback',
    playerSpawns: [{ x: 4.5, y: psy + 0.5 }, { x: 4.5, y: psy - 0.5 }, { x: 4.5, y: psy + 1.5 }, { x: 5.5, y: psy + 0.5 }, { x: 3.5, y: psy + 0.5 }],
    enemySpawns: [{ x: w - 5.5, y: 4.5 }, { x: w - 5.5, y: h - 4.5 }, { x: w - 9.5, y: psy + 0.5 }, { x: w - 4.5, y: psy + 0.5 }, { x: (w / 2) + 3.5, y: 3.5 }, { x: (w / 2) + 3.5, y: h - 3.5 }],
  } as MapState;
}

// ---------------- the replicated room plan ----------------

const KIND_CODE: Record<RoomKind, string> = {
  crypt: 'cr', library: 'li', cistern: 'ci', shrine: 'sh', ossuary: 'os', collapsed: 'co', pillared: 'pi', torture: 'to',
  treasury: 'tr', barracks: 'ba', grotto: 'gr', forge: 'fo', bridge: 'br', hall: 'ha', approach: 'ap', arena: 'ar',
};
const CODE_KIND = Object.fromEntries(Object.entries(KIND_CODE).map(([k, c]) => [c, k])) as Record<string, RoomKind>;
const SHAPE_CODE: Record<MapRoom['shape'], string> = { rect: 'r', round: 'o', cave: 'c', hall: 'h' };
const CODE_SHAPE = Object.fromEntries(Object.entries(SHAPE_CODE).map(([k, c]) => [c, k])) as Record<string, MapRoom['shape']>;

/**
 * `topology` carries the layout family plus the room plan, the arena design and the chasm mask (run-length coded),
 * because the authority replicates only a fixed set of map fields to clients: "halls|r=3.4.8.6.cr.r.k2|v=...|a=nave".
 */
export function encodeTopology(m: Pick<MapState, 'layout' | 'w' | 'h' | 'rooms' | 'voids' | 'arena' | 'bossSpawn'>): string {
  const parts = [m.layout];
  if (m.rooms?.length) parts.push('r=' + m.rooms.map((r) => [r.x, r.y, r.w, r.h].map((n) => n.toString(36)).join('.') + '.' + KIND_CODE[r.kind] + '.' + SHAPE_CODE[r.shape] + '.' + r.v.toString(36)).join(','));
  if (m.voids?.length) {
    const set = new Set(m.voids), runs: number[] = [];
    let cur = false, run = 0;
    for (let i = 0; i < m.w * m.h; i++) {
      const v = set.has(i);
      if (v !== cur) { runs.push(run); run = 0; cur = v; }
      run++;
    }
    runs.push(run);
    parts.push('v=' + runs.map((n) => n.toString(36)).join('.'));
  }
  if (m.arena) parts.push('a=' + m.arena);
  if (m.bossSpawn) parts.push('b=' + Math.floor(m.bossSpawn.x).toString(36) + '.' + Math.floor(m.bossSpawn.y).toString(36));
  return parts.join('|');
}

function topologyField(topology: string | undefined, key: string): string | null {
  for (const p of (topology ?? '').split('|').slice(1)) if (p.startsWith(key + '=')) return p.slice(key.length + 1);
  return null;
}

/** The typed rooms of a map: MapState.rooms, or decoded from the replicated topology. */
export function mapRooms(m: Pick<MapState, 'topology'> & { rooms?: MapRoom[] }): MapRoom[] {
  if (m.rooms) return m.rooms;
  const f = topologyField(m.topology, 'r');
  if (!f) return [];
  const out: MapRoom[] = [];
  for (const s of f.split(',')) {
    const p = s.split('.');
    if (p.length < 7 || !CODE_KIND[p[4]] || !CODE_SHAPE[p[5]]) continue;
    out.push({ x: parseInt(p[0], 36), y: parseInt(p[1], 36), w: parseInt(p[2], 36), h: parseInt(p[3], 36), kind: CODE_KIND[p[4]], shape: CODE_SHAPE[p[5]], v: parseInt(p[6], 36) });
  }
  return out;
}

/** Chasm tile indices of a map: MapState.voids, or decoded from the replicated topology. */
export function mapVoids(m: Pick<MapState, 'topology'> & { voids?: number[] }): number[] {
  if (m.voids) return m.voids;
  const f = topologyField(m.topology, 'v');
  if (!f) return [];
  const out: number[] = [];
  let i = 0, on = false;
  for (const r of f.split('.')) {
    const n = parseInt(r, 36);
    if (on) for (let k = 0; k < n; k++) out.push(i + k);
    i += n;
    on = !on;
  }
  return out;
}

/** Where the boss rises (MapState.bossSpawn or the replicated topology; tile centre). */
export function mapBossSpawn(m: Pick<MapState, 'topology'> & { bossSpawn?: { x: number; y: number } }): { x: number; y: number } | null {
  if (m.bossSpawn) return m.bossSpawn;
  const f = topologyField(m.topology, 'b');
  if (!f) return null;
  const [x, y] = f.split('.').map((n) => parseInt(n, 36));
  return Number.isFinite(x) && Number.isFinite(y) ? { x: x + 0.5, y: y + 0.5 } : null;
}

/** The arena design of a boss floor (MapState.arena or the replicated topology). */
export function mapArena(m: Pick<MapState, 'topology'> & { arena?: string }): string | null {
  return m.arena ?? topologyField(m.topology, 'a');
}

// ---------------- rotation ----------------

/** Theme for a round: a seeded rotation, so consecutive rounds always differ. */
export function themeFor(seed: string, round: number): string {
  const order = shuffleInPlace(seedRng(seed, 'themes'), DUNGEON_THEMES.map((t) => t.id));
  return order[(Math.max(1, round) - 1) % order.length];
}

/** Layout family for a round: seeded rotation over ordinary families (bosses always fight in an arena). */
function cyclePerm(seed: string, cycle: number): string[] {
  const fams = DUNGEON_LAYOUTS.filter((l) => l.id !== 'arena').map((l) => l.id);
  return shuffleInPlace(seedRng(seed, 'layouts', cycle), fams);
}

/** Layout family for a round: a fresh permutation of the families per cycle; the first of a cycle never repeats
 *  the last of the previous one, so consecutive rounds always differ. Bosses always fight in an arena. */
export function layoutFor(seed: string, round: number, boss: boolean): string {
  if (boss) return 'arena';
  const n = DUNGEON_LAYOUTS.length - 1;
  const r = Math.max(1, round) - 1;
  const cycle = Math.floor(r / n);
  const perm = cyclePerm(seed, cycle);
  if (cycle > 0) {
    const prev = cyclePerm(seed, cycle - 1);
    if (perm[0] === prev[prev.length - 1]) { const t = perm[0]; perm[0] = perm[1]; perm[1] = t; }
  }
  return perm[r % n];
}

/**
 * The boss a boss round will spawn: the same first draw of the round's encounter stream the director makes
 * (director.setupRound), read here on a private copy so the arena can be built for its boss without the map
 * stream depending on the encounter stream's position.
 */
export function bossForRound(seed: string, round: number, theme?: string | null): string | null {
  if (theme && THEME_BOSSES[theme]) return THEME_BOSSES[theme];   // theme bosses own their floor's boss rounds
  const bosses = BIOMES[0].bosses;
  if (!bosses.length) return null;
  const rng = seedRng(seed, 'encounter', round);
  const i = Math.floor(round / RULES.bossEvery) - 1;
  return bosses[(i + nextInt(rng, 2)) % bosses.length];
}

/** True for a known dungeon theme id (DUNGEON_THEMES). */
export function isTheme(id: string | null | undefined): id is string {
  return !!id && DUNGEON_THEMES.some((t) => t.id === id);
}

/**
 * A round's floor. `themeOverride` (the theme chosen through a door, doors.ts) replaces the seeded rotation;
 * the layout family and the map stream do not depend on the theme, so the same round keeps its macro geometry
 * (room kinds, and the furniture they carve, follow the theme).
 */
export function generateDungeon(seed: string, round: number, boss: boolean, themeOverride?: string | null): MapState {
  const theme = isTheme(themeOverride) ? themeOverride : themeFor(seed, round);
  const layout = layoutFor(seed, round, boss);
  const rng = seedRng(seed, 'map', round);
  const design = boss ? arenaDesign(bossForRound(seed, round, theme), rng) : null;
  for (let attempt = 0; attempt < 12; attempt++) {
    let gen: Gen;
    if (design) gen = generateArena(design, rng);
    else {
      const w = ri(rng, 30, 40);
      const h = ri(rng, 21, 27);
      gen = GENERATORS[layout](rng, w, h);
    }
    const m = finish(gen, rng, layout, theme, attempt, boss);
    if (m) return m;
  }
  return fallbackMap(boss, theme);
}

