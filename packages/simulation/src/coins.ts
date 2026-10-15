import { COIN_RULES, RUNNER_KIND, SHRINE_TUNING, TICK_SEC } from '@cursebound/content';
import { bountyRules } from './bountyRules';
import { registerGlobalHooks } from './hooks';
import { nearestFloor } from './map';
import { nextFloat, seedRng, type RngState } from './rng';
import type { EnemyState, Pickup, PlayerState, SimEvent, SimState } from './types';

// Cursed coins, the run currency (content COIN_RULES; spent at the wandering merchant, roomEvents.ts). Coins lie on
// the floor as generic pickups of kind 'coin' whose `tier` is the pile's value; they never expire. A pile drifts to
// the nearest living hero in magnet range and, on touch, every hero's purse gains its value (the party shares coins,
// so co-op heroes never race for them). Unclaimed piles are swept into the purses at round clear. Drops: ordinary
// objective foes by chance, champions / rares / bosses always, broken cursed caches, the treasure imp (roomEvents.ts).
// Rolls and scatter use the dedicated room-event stream (state.rng.events), never the combat or AI streams.

export const COIN_KIND = 'coin';
const DT = TICK_SEC;

/** The room-event / coin stream (seeded lazily, so runs that never touch it keep their old state shape). */
export function eventRng(state: SimState): RngState {
  return state.rng.events ?? (state.rng.events = seedRng(state.seed, 'events'));
}

export function coinsOf(p: PlayerState | undefined): number {
  return p?.coins ?? 0;
}

/** Every hero's purse gains `n` coins. */
export function creditParty(state: SimState, n: number) {
  if (!(n > 0)) return;
  for (const p of state.players) p.coins = coinsOf(p) + Math.floor(n);
}

/** Buff id a shrine grants (roomEvents.ts): 'shrine_fury', 'shrine_haste', 'shrine_warding', 'shrine_fortune'. */
export const shrineBuff = (type: string) => `shrine_${type}`;

/** A Shrine of Fortune was taken on this floor (its buff lasts the floor; buffs clear at round clear). */
export function fortuneActive(state: SimState): boolean {
  const id = shrineBuff('fortune');
  for (const p of state.players) for (const b of p.buffs) if (b.id === id && b.until > state.tick) return true;
  return false;
}

/** Scatter `total` coins near (x, y) in piles of up to COIN_RULES.pileMax (merging into the newest pile past maxPiles). */
export function dropCoins(state: SimState, x: number, y: number, total: number, spread = 0.6) {
  if (!state.map || !(total >= 1)) return;
  const list = state.pickups ?? (state.pickups = []);
  let left = Math.floor(total);
  while (left > 0) {
    const v = Math.min(COIN_RULES.pileMax, left);
    left -= v;
    let piles = 0, newest: Pickup | null = null;
    for (const k of list) if (k.kind === COIN_KIND) { piles++; newest = k; }
    if (newest && piles >= COIN_RULES.maxPiles) { newest.tier += v; continue; }
    const rng = eventRng(state);
    const ang = nextFloat(rng) * Math.PI * 2;
    const r = 0.15 + nextFloat(rng) * spread;
    const [px, py] = nearestFloor(state.map, x + Math.cos(ang) * r, y + Math.sin(ang) * r);
    list.push({ id: state.nextId++, kind: COIN_KIND, x: px, y: py, bornTick: state.tick, untilTick: 0, tier: v });
  }
}

/** Coins for an enemy death (onKill): champions, rares and bosses always; ordinary objective foes by chance. */
export function rollCoins(state: SimState, e: EnemyState) {
  if (state.phase !== 'COMBAT' || e.kind === RUNNER_KIND || bountyRules(state).noPickups) return;   // the imp showers (roomEvents.ts)
  const f = fortuneActive(state) ? SHRINE_TUNING.fortuneCoins : 1;
  const tier = e.elite ?? 0;
  if (e.boss) { dropCoins(state, e.x, e.y, COIN_RULES.boss * f, 1.4); return; }
  if (tier >= 2) { dropCoins(state, e.x, e.y, COIN_RULES.rare * f, 0.9); return; }
  if (tier === 1) { dropCoins(state, e.x, e.y, COIN_RULES.champion * f, 0.7); return; }
  if (!e.objective && !state.training) return;   // no farming summons (training foes are all non-objective)
  if (nextFloat(eventRng(state)) < Math.min(1, COIN_RULES.foeChance * f)) dropCoins(state, e.x, e.y, f);
}

/** Per tick: piles drift to the nearest living hero in magnet range; a touch pays the whole party. */
export function stepCoins(state: SimState, ev: SimEvent[]) {
  const list = state.pickups;
  if (!list?.length) return;
  let taken: Set<Pickup> | null = null;
  const R2 = COIN_RULES.magnetRange ** 2;
  for (const pk of list) {
    if (pk.kind !== COIN_KIND || state.tick - pk.bornTick < COIN_RULES.popTicks) continue;
    let best: PlayerState | null = null, bd = R2;
    for (const p of state.players) {
      if (p.lifeState !== 'alive') continue;
      const d2 = (p.x - pk.x) ** 2 + (p.y - pk.y) ** 2;
      if (d2 <= bd) { bd = d2; best = p; }
    }
    if (!best) continue;
    const d = Math.sqrt(bd);
    const step = Math.min(d, COIN_RULES.magnetSpeed * DT);
    if (d > 1e-9) { pk.x += ((best.x - pk.x) / d) * step; pk.y += ((best.y - pk.y) / d) * step; }
    if (d - step <= COIN_RULES.touchRange) {
      creditParty(state, pk.tier);
      ev.push({ t: 'pickup', id: pk.id, kind: COIN_KIND, slot: best.slot, x: pk.x, y: pk.y });
      (taken ??= new Set()).add(pk);
    }
  }
  if (taken) state.pickups = list.filter((k) => !taken!.has(k));
}

/** Round clear (sim.ts enterRoundClear, before the floor's pickups vanish): every unclaimed pile pays the party. */
export function settleCoins(state: SimState, ev: SimEvent[]) {
  const list = state.pickups;
  if (!list?.length) return;
  let any = false;
  for (const pk of list) {
    if (pk.kind !== COIN_KIND) continue;
    let best = state.players[0], bd = Infinity;
    for (const p of state.players) { const d2 = (p.x - pk.x) ** 2 + (p.y - pk.y) ** 2; if (d2 < bd) { bd = d2; best = p; } }
    creditParty(state, pk.tier);
    if (best) ev.push({ t: 'pickup', id: pk.id, kind: COIN_KIND, slot: best.slot, x: pk.x, y: pk.y });
    any = true;
  }
  if (any) state.pickups = list.filter((k) => k.kind !== COIN_KIND);
}

registerGlobalHooks({
  onKill(state, _ev, e) {
    rollCoins(state, e);
  },
  onTick(state, ev) {
    stepCoins(state, ev);
  },
});
