import { isBossRound } from '@cursebound/content';
import { registerGlobalHooks } from './hooks';
import { dropPickup, PICKUP_KINDS } from './pickups';
import { nextInt, seedRng } from './rng';
import type { MapState, Pickup, SimEvent, SimState } from './types';

// Cursed caches: an exploration incentive. Ordinary floors hide a few breakable caches in out-of-the-way spots
// (alcoves, niches and far corners, away from the hero spawn). A hero who walks into one breaks it open: it spills
// potions and a resource orb (pickups.ts). Stored as generic pickups of kind 'cache' that never expire; placement
// uses its own seeded stream (seed, round), so it never perturbs combat or AI randomness.

export const CACHE_KIND = 'cache';
const TOUCH = 0.75;

function cacheCount(round: number): number { return Math.min(4, 2 + Math.floor(round / 4)); }

/** Out-of-the-way floor tiles: far from the spawn by path and enclosed (few open neighbours), spread apart. */
export function cacheSpots(map: MapState, seed: string, round: number): { x: number; y: number }[] {
  const { w, h, tiles } = map;
  const s = map.playerSpawns[0];
  const d = new Int32Array(w * h).fill(-1);
  const start = Math.floor(s.y) * w + Math.floor(s.x);
  if (tiles[start] !== 0) return [];
  const q = [start];
  d[start] = 0;
  for (let k = 0; k < q.length; k++) {
    const c = q[k], x = c % w, y = (c / w) | 0;
    for (const n of [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, y > 0 ? c - w : -1, y < h - 1 ? c + w : -1]) {
      if (n >= 0 && tiles[n] === 0 && d[n] < 0) { d[n] = d[c] + 1; q.push(n); }
    }
  }
  const open = (i: number) => {
    const x = i % w, y = (i / w) | 0;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if ((dx || dy) && xx >= 0 && yy >= 0 && xx < w && yy < h && tiles[yy * w + xx] === 0) n++;
    }
    return n;
  };
  let far = 0;
  for (const v of d) if (v > far) far = v;
  const cands: number[] = [];
  for (let enclosed = 4; enclosed <= 8 && cands.length < 6; enclosed++) {
    cands.length = 0;
    for (let i = 0; i < tiles.length; i++) if (d[i] >= Math.max(8, far * 0.35) && open(i) <= enclosed) cands.push(i);
  }
  if (!cands.length) return [];
  const rng = seedRng(seed, 'caches', round);
  const pos = (i: number) => ({ x: (i % w) + 0.5, y: ((i / w) | 0) + 0.5 });
  cands.sort((a, b) => d[b] - d[a] || a - b);
  const out = [pos(cands[nextInt(rng, Math.min(4, cands.length))])];
  while (out.length < cacheCount(round)) {
    let best = -1, bs = -1;
    for (const i of cands) {
      const p = pos(i);
      let m = Infinity;
      for (const o of out) m = Math.min(m, (p.x - o.x) ** 2 + (p.y - o.y) ** 2);
      const score = Math.sqrt(m) + nextInt(rng, 1000) / 500;
      if (score > bs) { bs = score; best = i; }
    }
    if (best < 0 || bs < 6) break;
    out.push(pos(best));
  }
  return out;
}

function breakCache(state: SimState, ev: SimEvent[], pk: Pickup, slot: number) {
  ev.push({ t: 'pickup', id: pk.id, kind: CACHE_KIND, slot, x: pk.x, y: pk.y });
  dropPickup(state, PICKUP_KINDS.potion, pk.x, pk.y, 1);
  dropPickup(state, PICKUP_KINDS.orb, pk.x, pk.y, 1);
  if (nextInt(state.rng.combat, 2) === 0) dropPickup(state, PICKUP_KINDS.potion, pk.x, pk.y, 0);
}

registerGlobalHooks({
  // after pickups.ts has cleared last floor's pickups (it is imported, so it registers first)
  onRoundStart(state) {
    if (!state.map || isBossRound(state.round) || state.tutorial && state.round === 1) return;
    state.pickups ??= [];
    for (const s of cacheSpots(state.map, state.seed, state.round)) {
      state.pickups.push({ id: state.nextId++, kind: CACHE_KIND, x: s.x, y: s.y, bornTick: state.tick, untilTick: 0, tier: 0 });
    }
  },
  onTick(state, ev) {
    if (!state.pickups?.length) return;
    const broken: [Pickup, number][] = [];
    for (const pk of state.pickups) {
      if (pk.kind !== CACHE_KIND) continue;
      const p = state.players.find((pl) => pl.lifeState === 'alive' && (pl.x - pk.x) ** 2 + (pl.y - pk.y) ** 2 <= TOUCH * TOUCH);
      if (p) broken.push([pk, p.slot]);
    }
    if (!broken.length) return;
    state.pickups = state.pickups.filter((pk) => !broken.some(([b]) => b === pk));
    for (const [pk, slot] of broken) breakCache(state, ev, pk, slot);
  },
});
