import { Big, percentToFactor } from '@cursebound/numeric';
import {
  ALTAR_PACTS, DRAUGHT_HEAL, GEAR_SLOTS, LEGENDARIES, LEGENDARY_BY_ID, LOOT_RULES, MAX_BLESSINGS, MERCHANT_BOONS, PACT_BY_ID,
  ROOM_EVENT_RULES as R, RUNNER_KIND, SHRINES, SHRINE_BY_ID, SHRINE_TUNING as T, TICK_RATE, WARE_BY_ID, isBossRound,
} from '@cursebound/content';
import { blessingsOf } from './blessing';
import { bountyRules } from './bountyRules';
import { isFrozen, moveMul } from './cc';
import { inCinematic } from './cinematic';
import { coinsOf, dropCoins, eventRng, fortuneActive, settleCoins, shrineBuff } from './coins';
import { cohortHpFrac, healPlayer, shieldPlayer } from './combat';
import { createEnemy } from './director';
import { refreshMaxHp } from './fate';
import { canEquip, dropLegendary, equipLegendary, lootChance } from './gear';
import { lineOfSight, moveCircle, norm } from './geometry';
import { registerGlobalHooks } from './hooks';
import { findPath, nearestFloor, tileCenter } from './map';
import { PICKUP_KINDS } from './pickups';
import { drawDistinct, nextFloat, nextInt, seedRng, type RngState } from './rng';
import { B, ONE, derivePlayer } from './stats';
import type { EnemyState, GroundLoot, MapState, PactRecord, PlayerState, RoomEvent, RoomEventState, SimEvent, SimState } from './types';

// Room events (content roomEvents.ts holds every number and name):
//   shrines     placed in typed rooms of ordinary floors at COMBAT start (own stream: seed, 'roomevents', round);
//               EVENT op 'shrine' (combat only, in range) blesses every living hero, then the shrine goes dark.
//   altar       a cursed altar with three seeded pacts (seed, 'altar', round, n); EVENT op 'altar' binds the chosen
//               pact to the hero for the run (PlayerState.pacts, applied after Fate in stats.ts) and darkens it.
//   merchant    after an ordinary floor (by chance) or a boss floor (always) the merchant waits on the cleared floor
//               during the door vote, away from the doors (sim.ts startOffer -> placeMerchant); EVENT op 'buy'.
//   runner      a treasure imp may appear mid-floor (seed, 'runner', round): it flees along A* paths (map.findPath)
//               away from the heroes, spills a coin per tenth of its health lost, opens a portal after
//               runnerEscapeSec and is gone after runnerPortalSec more, unless slain (a loot shower).
// Everything is plain state (SimState.roomEvents, PlayerState.coins / pacts, enemy avars 'imp.*') and seeded streams,
// so runs replay exactly and survive checkpoints. Validation (EVENT): phase, the event, a living hero in range, then
// per op: unused shrine / altar and a valid pact, a stocked shelf row and enough coins.

const DT = 1 / TICK_RATE;
const ticks = (sec: number) => Math.max(1, Math.round(sec * TICK_RATE));
/** a Fortune blessing lasts the floor (buffs clear at round clear) */
const FLOOR_TICKS = ticks(600);

export const ROOM_EVENT_OPS = ['shrine', 'altar', 'buy'] as const;
export type RoomEventOp = typeof ROOM_EVENT_OPS[number];
export type EventResult = { ok: true } | { ok: false; code: 'STALE_PHASE' | 'NOT_FOUND' | 'DEAD' | 'TOO_FAR' | 'SPENT' | 'INVALID_INPUT' | 'SOLD_OUT' | 'NO_FUNDS' | 'PACK_FULL' | 'CANNOT_EQUIP' };
const fail = (code: Extract<EventResult, { ok: false }>['code']): EventResult => ({ ok: false, code });

export function roomEventsOf(state: SimState): RoomEvent[] {
  return state.roomEvents?.list ?? [];
}

function eventState(state: SimState): RoomEventState {
  return state.roomEvents ?? (state.roomEvents = { list: [] });
}

/** ROUND_SETUP (sim.ts enterRoundSetup): the last floor's events stay behind. */
export function resetRoomEvents(state: SimState) {
  if (state.roomEvents !== undefined) delete state.roomEvents;
}

/** Round clear (sim.ts enterRoundClear): unclaimed coins pay the party; a treasure imp still to come never arrives. */
export function settleRoomEvents(state: SimState, ev: SimEvent[]) {
  settleCoins(state, ev);
  if (state.roomEvents?.runnerAt !== undefined) delete state.roomEvents.runnerAt;
}

function buffActive(state: SimState, p: PlayerState, id: string): boolean {
  for (const b of p.buffs) if (b.id === id && b.until > state.tick) return true;
  return false;
}

function setBuff(p: PlayerState, id: string, until: number, value: number) {
  const b = p.buffs.find((x) => x.id === id);
  if (b) { b.until = Math.max(b.until, until); b.value = value; } else p.buffs.push({ id, until, value });
}

// ---------------- grids ----------------

/** 4-connected floor BFS from `starts` (tile indices); -1 = unreached. Stops expanding past `maxD`. */
function bfs(map: MapState, starts: number[], maxD = 1 << 30): Int32Array {
  const { w, h, tiles } = map;
  const d = new Int32Array(w * h).fill(-1);
  const q: number[] = [];
  for (const s of starts) if (s >= 0 && s < tiles.length && tiles[s] === 0 && d[s] < 0) { d[s] = 0; q.push(s); }
  for (let k = 0; k < q.length; k++) {
    const c = q[k];
    if (d[c] >= maxD) continue;
    const x = c % w, y = (c / w) | 0;
    if (x > 0 && tiles[c - 1] === 0 && d[c - 1] < 0) { d[c - 1] = d[c] + 1; q.push(c - 1); }
    if (x < w - 1 && tiles[c + 1] === 0 && d[c + 1] < 0) { d[c + 1] = d[c] + 1; q.push(c + 1); }
    if (y > 0 && tiles[c - w] === 0 && d[c - w] < 0) { d[c - w] = d[c] + 1; q.push(c - w); }
    if (y < h - 1 && tiles[c + w] === 0 && d[c + w] < 0) { d[c + w] = d[c] + 1; q.push(c + w); }
  }
  return d;
}

const tileOf = (map: MapState, x: number, y: number) => Math.floor(y) * map.w + Math.floor(x);

/** Floor tile with all eight neighbours floor. */
function openTile(map: MapState, i: number): boolean {
  const { w, h, tiles } = map;
  const x = i % w, y = (i / w) | 0;
  if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1 || tiles[i] !== 0) return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tiles[i + dy * w + dx] !== 0) return false;
  return true;
}

// ---------------- placement (shrines, altar) ----------------

export interface EventSpot { kind: 'shrine' | 'altar'; type: string; x: number; y: number }

/** Open floor tile nearest the room centre that the spawn reaches (ties by index). */
function roomSpot(map: MapState, rm: { x: number; y: number; w: number; h: number }, reach: Int32Array): number {
  const cx = rm.x + rm.w / 2, cy = rm.y + rm.h / 2;
  let best = -1, bd = Infinity;
  for (let ty = rm.y + 1; ty < rm.y + rm.h - 1; ty++) for (let tx = rm.x + 1; tx < rm.x + rm.w - 1; tx++) {
    const i = ty * map.w + tx;
    if (i < 0 || i >= map.tiles.length || reach[i] < 0 || !openTile(map, i)) continue;
    const dd = (tx + 0.5 - cx) ** 2 + (ty + 0.5 - cy) ** 2;
    if (dd < bd - 1e-9) { bd = dd; best = i; }
  }
  return best;
}

/**
 * Shrines and the altar of an ordinary floor (deterministic: seed, round and the map only). Each takes its own typed
 * room (shrine rooms draw shrines, torture chambers / ossuaries / crypts draw altars), on open floor near the room
 * centre, at least ROOM_EVENT_RULES.spawnClearance tiles from the hero spawn and 6 tiles from each other.
 */
export function roomEventSpots(map: MapState, seed: string, round: number): EventSpot[] {
  const rooms = map.rooms ?? [];
  if (!rooms.length || !map.playerSpawns.length) return [];
  const rng = seedRng(seed, 'roomevents', round);
  const plan: { kind: 'shrine' | 'altar'; type: string }[] = [];
  if (nextFloat(rng) < R.shrineChance) {
    const a = nextInt(rng, SHRINES.length);
    plan.push({ kind: 'shrine', type: SHRINES[a].id });
    if (nextFloat(rng) < R.secondShrineChance) {
      let b = nextInt(rng, SHRINES.length - 1);
      if (b >= a) b++;
      plan.push({ kind: 'shrine', type: SHRINES[b].id });
    }
  }
  if (round >= R.altarMinRound && nextFloat(rng) < R.altarChance) plan.push({ kind: 'altar', type: 'altar' });
  if (!plan.length) return [];
  const sp = map.playerSpawns[0];
  const reach = bfs(map, [tileOf(map, sp.x, sp.y)]);
  const used = new Set<number>();
  const out: EventSpot[] = [];
  for (const item of plan) {
    const cands: { i: number; tile: number; w: number }[] = [];
    rooms.forEach((rm, i) => {
      if (used.has(i)) return;
      const tile = roomSpot(map, rm, reach);
      if (tile < 0 || reach[tile] < R.spawnClearance) return;
      const x = (tile % map.w) + 0.5, y = ((tile / map.w) | 0) + 0.5;
      if (out.some((o) => (o.x - x) ** 2 + (o.y - y) ** 2 < 36)) return;
      const w = item.kind === 'shrine'
        ? (rm.kind === 'shrine' ? 4 : rm.kind === 'pillared' || rm.kind === 'library' ? 2 : 1)
        : (rm.kind === 'torture' || rm.kind === 'ossuary' || rm.kind === 'crypt' ? 4 : 1);
      cands.push({ i, tile, w });
    });
    if (!cands.length) continue;
    let roll = nextFloat(rng) * cands.reduce((s, c) => s + c.w, 0);
    let pick = cands[cands.length - 1];
    for (const c of cands) { if (roll < c.w) { pick = c; break; } roll -= c.w; }
    used.add(pick.i);
    out.push({ kind: item.kind, type: item.type, x: (pick.tile % map.w) + 0.5, y: ((pick.tile / map.w) | 0) + 0.5 });
  }
  return out;
}

/** Legendaries any class can wear, with player-stat lines, nobody in the party holds (relic pact, merchant). */
function universalLegendaries(state: SimState): typeof LEGENDARIES {
  const owned = new Set<string>();
  for (const p of state.players) for (const s of GEAR_SLOTS) { const id = p.gear?.[s]; if (id) owned.add(id); }
  for (const it of state.loot ?? []) owned.add(it.itemId);
  return LEGENDARIES.filter((d) => !d.classId && d.modifiers.some((m) => m.stat.startsWith('player.')) && !owned.has(d.id));
}

/** Three distinct pacts for an altar; the relic pact names its legendary ('relic:<item>'). */
export function altarOffers(state: SimState, rng: RngState): string[] {
  const ids = drawDistinct(rng, ALTAR_PACTS.map((p) => p.id), 3);
  return ids.map((id) => {
    if (!PACT_BY_ID[id]?.relic) return id;
    const pool = universalLegendaries(state);
    if (!pool.length) return ALTAR_PACTS.find((p) => !p.relic && !ids.includes(p.id))?.id ?? 'fury';
    return `relic:${pool[nextInt(rng, pool.length)].id}`;
  });
}

function addEvent(state: SimState, e: Omit<RoomEvent, 'id'>): RoomEvent {
  const re: RoomEvent = { id: state.nextId++, ...e };
  eventState(state).list.push(re);
  return re;
}

/** `salt`: training spawns add the tick so repeated altars differ; floor altars depend on seed, round and order only. */
function newAltar(state: SimState, x: number, y: number, n: number, salt?: number): RoomEvent {
  const rng = salt === undefined ? seedRng(state.seed, 'altar', state.round, n) : seedRng(state.seed, 'altar', state.round, n, salt);
  return addEvent(state, { kind: 'altar', type: 'altar', x, y, offers: altarOffers(state, rng) });
}

/** COMBAT start of an ordinary floor: shrines and the altar take their rooms; the treasure imp may be scheduled. */
function setupFloor(state: SimState) {
  if (state.training || !state.map) return;
  const r = state.round;
  if (isBossRound(r) || (state.tutorial && r === 1)) return;
  let n = 0;
  for (const s of roomEventSpots(state.map, state.seed, r)) {
    if (s.kind === 'altar') newAltar(state, s.x, s.y, n++);
    else addEvent(state, { kind: 'shrine', type: s.type, x: s.x, y: s.y });
  }
  if (r >= R.runnerMinRound) {
    const rng = seedRng(state.seed, 'runner', r);
    if (nextFloat(rng) < R.runnerChance) {
      const [lo, hi] = R.runnerDelaySec;
      eventState(state).runnerAt = state.tick + ticks(lo + (hi - lo) * nextFloat(rng));
    }
  }
}

// ---------------- merchant ----------------

function merchantStock(state: SimState, rng: RngState): NonNullable<RoomEvent['stock']> {
  const row = (ware: string, item?: string) => ({ ware, price: WARE_BY_ID[ware].price, left: WARE_BY_ID[ware].stock, ...(item ? { item } : {}) });
  const rows = [row('draught')];
  for (const b of drawDistinct(rng, MERCHANT_BOONS, 2)) rows.push(row(b));
  const pool = universalLegendaries(state);
  if (pool.length) rows.push(row('legendary', pool[nextInt(rng, pool.length)].id));
  if (nextFloat(rng) < (WARE_BY_ID.blessing.chance ?? 1)) rows.push(row('blessing'));
  return rows;
}

/** A merchant spot: open floor 2..5 tiles from the nearest living hero, clear of every door's front point. */
function merchantSpot(state: SimState): { x: number; y: number } | null {
  const map = state.map;
  if (!map) return null;
  const heroes = state.players.filter((p) => p.lifeState === 'alive');
  const ref = heroes.length ? heroes : state.players;
  const d = bfs(map, ref.map((p) => tileOf(map, p.x, p.y)), 6);
  const doors = state.doors?.list ?? [];
  const clear = (x: number, y: number, r: number) => doors.every((dr) => (dr.x - x) ** 2 + (dr.y - y) ** 2 >= r * r);
  for (const need of [R.merchantDoorClearance, 2.5]) {
    let best = -1, bs = Infinity;
    for (let i = 0; i < map.tiles.length; i++) {
      if (d[i] < 2 || d[i] > 5 || !openTile(map, i)) continue;
      const x = (i % map.w) + 0.5, y = ((i / map.w) | 0) + 0.5;
      if (!clear(x, y, need)) continue;
      const s = Math.abs(d[i] - 3);
      if (s < bs) { bs = s; best = i; }
    }
    if (best >= 0) return { x: (best % map.w) + 0.5, y: ((best / map.w) | 0) + 0.5 };
  }
  return null;
}

function newMerchant(state: SimState, ev: SimEvent[], x: number, y: number, salt?: number): RoomEvent {
  const rng = salt === undefined ? seedRng(state.seed, 'merchant-stock', state.round) : seedRng(state.seed, 'merchant-stock', state.round, salt);
  const re = addEvent(state, { kind: 'merchant', type: 'merchant', x, y, stock: merchantStock(state, rng) });
  ev.push({ t: 'room_event', op: 'merchant', id: re.id, slot: -1, x, y });
  ev.push({ t: 'domain', type: 'merchant_arrived', payload: { round: state.round, wares: re.stock!.map((s) => s.item ?? s.ware) } });
  return re;
}

/** Door vote start (sim.ts startOffer, after the doors): after a boss floor always, else by chance from merchantMinRound. */
export function placeMerchant(state: SimState, ev: SimEvent[]) {
  if (state.training || !state.map || (state.tutorial && state.round <= 1)) return;
  const r = state.round;
  if (!isBossRound(r)) {
    if (r < R.merchantMinRound) return;
    if (nextFloat(seedRng(state.seed, 'merchant', r)) >= R.merchantChance) return;
  }
  const spot = merchantSpot(state);
  if (spot) newMerchant(state, ev, spot.x, spot.y);
}

// ---------------- EVENT command ----------------

/** EVENT (sim.ts applyCommand): validated shrine activation, altar pact or purchase. */
export function applyRoomEvent(state: SimState, ev: SimEvent[], p: PlayerState, op: string, id: number, choice: number | undefined): EventResult {
  const combat = state.phase === 'COMBAT' && !inCinematic(state);
  if (!combat && state.phase !== 'VOTING') return fail('STALE_PHASE');
  if (!(ROOM_EVENT_OPS as readonly string[]).includes(op)) return fail('INVALID_INPUT');
  const re = roomEventsOf(state).find((e) => e.id === id);
  const kind = op === 'shrine' ? 'shrine' : op === 'altar' ? 'altar' : 'merchant';
  if (!re || re.kind !== kind) return fail('NOT_FOUND');
  if (p.lifeState !== 'alive') return fail('DEAD');
  if ((p.x - re.x) ** 2 + (p.y - re.y) ** 2 > R.useRange * R.useRange) return fail('TOO_FAR');
  if (op === 'shrine') {
    if (!combat) return fail('STALE_PHASE');   // a shrine's blessing belongs to the fight
    if (re.used) return fail('SPENT');
    activateShrine(state, ev, p, re);
    return { ok: true };
  }
  if (op === 'altar') {
    if (re.used) return fail('SPENT');
    if (!Number.isInteger(choice) || choice! < 0 || choice! >= (re.offers?.length ?? 0)) return fail('INVALID_INPUT');
    takePact(state, ev, p, re, re.offers![choice!]);
    return { ok: true };
  }
  const row = Number.isInteger(choice) ? re.stock?.[choice!] : undefined;
  if (!row) return fail('INVALID_INPUT');
  if (row.left <= 0) return fail('SOLD_OUT');
  if (coinsOf(p) < row.price) return fail('NO_FUNDS');
  if (row.ware === 'blessing' && blessingsOf(p) >= MAX_BLESSINGS) return fail('PACK_FULL');
  if (row.ware === 'legendary') { const def = row.item ? LEGENDARY_BY_ID[row.item] : undefined; if (!def || !canEquip(p, def)) return fail('CANNOT_EQUIP'); }
  buy(state, ev, p, re, row);
  return { ok: true };
}

function activateShrine(state: SimState, ev: SimEvent[], p: PlayerState, re: RoomEvent) {
  const def = SHRINE_BY_ID[re.type];
  re.used = true;
  const until = state.tick + ticks(def?.sec || 1);
  for (const a of state.players) {
    if (a.lifeState !== 'alive') continue;
    switch (re.type) {
      case 'fury': setBuff(a, shrineBuff('fury'), until, 1); break;
      case 'haste':
        setBuff(a, shrineBuff('haste'), until, T.hasteSpeed);
        for (const s of a.skills) if (s.skillId && s.charges < s.maxCharges && s.cooldown > 0) s.cooldown *= T.hasteCooldownCut;
        break;
      case 'warding':
        setBuff(a, shrineBuff('warding'), until, 1);
        shieldPlayer(state, ev, a, a.maxHp.mul(B(T.wardShield)));
        break;
      case 'fortune': setBuff(a, shrineBuff('fortune'), state.tick + FLOOR_TICKS, 1); break;
      case 'renewal': {
        // cleanse first (poison halves healing), then a full heal that ignores healing modifiers
        a.buffs = a.buffs.filter((b) => !['poisoned', 'chill', 'slowed', 'blinded', 'silenced'].includes(b.id));
        if (a.aff?.poison) delete a.aff.poison;
        const gained = a.maxHp.sub(a.hp);
        if (gained.gt(Big.ZERO)) {
          a.hp = a.maxHp;
          a.stats.healing = a.stats.healing.add(gained);
          ev.push({ t: 'heal', slot: a.slot, amount: gained.toCompact() });
        }
        break;
      }
    }
  }
  ev.push({ t: 'room_event', op: 'shrine', id: re.id, slot: p.slot, x: re.x, y: re.y, k: re.type });
  ev.push({ t: 'domain', type: 'shrine_activated', payload: { round: state.round, slot: p.slot, shrine: re.type } });
}

/** Stat lines a pact binds: its gifts, a relic's legendary lines doubled, and the maximum-health price. */
export function pactMods(offer: string): { id: string; item?: string; mods: PactRecord['mods'] } {
  const [id, item] = offer.split(':');
  const def = PACT_BY_ID[id];
  const mods: PactRecord['mods'] = [];
  if (!def) return { id, mods };
  for (const g of def.gift) mods.push({ stat: g.stat, factor: percentToFactor(g.percent).toString() });
  const leg = def.relic && item ? LEGENDARY_BY_ID[item] : undefined;
  if (leg) for (const m of leg.modifiers) if (m.stat.startsWith('player.')) mods.push({ stat: m.stat, factor: B(m.factorPerRank).mul(B(m.factorPerRank)).toString() });
  if (def.maxHealth) mods.push({ stat: 'player.maxHealth', factor: percentToFactor(def.maxHealth).toString() });
  return { id, ...(leg ? { item: leg.id } : {}), mods };
}

function bindRecord(state: SimState, p: PlayerState, rec: PactRecord) {
  const before = p.maxHp;
  (p.pacts ??= []).push(rec);
  state.stateVersion++;
  refreshMaxHp(p, before, derivePlayer(state, p).maxHp);
}

function takePact(state: SimState, ev: SimEvent[], p: PlayerState, re: RoomEvent, offer: string) {
  const { id, item, mods } = pactMods(offer);
  const def = PACT_BY_ID[id];
  bindRecord(state, p, { id, src: 'altar', round: state.round, mods, ...(item ? { item } : {}) });
  if (def?.bloodFrac) {
    // the blood price: a share of current health, never lethal
    const loss = p.hp.mul(B(def.bloodFrac));
    p.hp = p.hp.sub(loss);
    if (p.hp.lt(ONE)) p.hp = Big.min(ONE, p.maxHp);
    if (!loss.isZero()) ev.push({ t: 'hit', target: p.slot, targetKind: 'player', amount: loss.toCompact(), crit: false, dtype: 'decay', x: p.x, y: p.y, sx: re.x, sy: re.y, frac: Math.min(1, loss.ratio(p.maxHp)) });
  }
  re.used = true;
  ev.push({ t: 'room_event', op: 'altar', id: re.id, slot: p.slot, x: re.x, y: re.y, k: id });
  ev.push({ t: 'domain', type: 'altar_pact', payload: { round: state.round, slot: p.slot, pact: id, ...(item ? { item } : {}) } });
}

function buy(state: SimState, ev: SimEvent[], p: PlayerState, re: RoomEvent, row: NonNullable<RoomEvent['stock']>[number]) {
  p.coins = coinsOf(p) - row.price;
  row.left--;
  const ware = WARE_BY_ID[row.ware];
  if (row.ware === 'draught') healPlayer(state, ev, p, p.maxHp.mul(B(DRAUGHT_HEAL)));
  else if (ware?.mods) bindRecord(state, p, { id: ware.id, src: 'merchant', round: state.round, mods: ware.mods.map((m) => ({ stat: m.stat, factor: percentToFactor(m.percent).toString() })) });
  else if (row.ware === 'blessing') {
    p.bless = blessingsOf(p) + 1;
    ev.push({ t: 'blessing', op: 'pickup', slot: p.slot, x: re.x, y: re.y });
  } else if (row.ware === 'legendary' && row.item) {
    const old = equipLegendary(state, ev, p, row.item);
    if (old && LEGENDARY_BY_ID[old]) {
      // the replaced item drops at the hero's feet (between floors it travels with the party: carried)
      let fx = p.x - p.aimX * 0.4, fy = p.y - p.aimY * 0.4;
      if (state.map) [fx, fy] = nearestFloor(state.map, fx, fy);
      const back: GroundLoot = { id: state.nextId++, itemId: old, x: Math.round(fx * 1000) / 1000, y: Math.round(fy * 1000) / 1000, bornTick: state.tick, ...(state.phase === 'COMBAT' ? {} : { carry: true }) };
      (state.loot ??= []).push(back);
      ev.push({ t: 'loot', id: back.id, itemId: old, x: back.x, y: back.y, src: 'carry' });
    }
  }
  ev.push({ t: 'room_event', op: 'buy', id: re.id, slot: p.slot, x: re.x, y: re.y, k: row.item ?? row.ware });
  ev.push({ t: 'domain', type: 'merchant_purchase', payload: { round: state.round, slot: p.slot, ware: row.ware, price: row.price, ...(row.item ? { item: row.item } : {}) } });
}

// ---------------- treasure imp ----------------

export const isRunner = (e: EnemyState) => e.kind === RUNNER_KIND;

/** Spawn the imp: `at` (training) or a seeded open tile runnerSpawnTiles away from the nearest living hero. */
export function spawnRunner(state: SimState, ev: SimEvent[], at?: { x: number; y: number }): EnemyState | null {
  const map = state.map;
  if (!map) return null;
  let x: number, y: number;
  if (at) [x, y] = nearestFloor(map, at.x, at.y);
  else {
    const heroes = state.players.filter((p) => p.lifeState === 'alive');
    if (!heroes.length) return null;
    const d = bfs(map, heroes.map((p) => tileOf(map, p.x, p.y)), R.runnerSpawnTiles[1] + 1);
    const cands: number[] = [];
    for (let i = 0; i < map.tiles.length; i++) if (d[i] >= R.runnerSpawnTiles[0] && d[i] <= R.runnerSpawnTiles[1] && openTile(map, i)) cands.push(i);
    if (!cands.length) for (let i = 0; i < map.tiles.length; i++) if (d[i] >= 3) cands.push(i);
    if (!cands.length) return null;
    const t = cands[nextInt(eventRng(state), cands.length)];
    [x, y] = tileCenter(map, t);
  }
  const e = createEnemy(state, RUNNER_KIND, x, y, ONE, { objective: false, groupId: -1, summonerId: null });
  // the AI stands it still (no attacks, zero ground speed); stepRunner moves it with its own speed
  e.avars = { 'imp.b': state.tick, 'imp.s': e.moveSpeed };
  e.moveSpeed = 0;
  e.cooldowns = {};
  state.enemies.push(e);
  ev.push({ t: 'spawn', id: e.id, kind: e.kind, x, y });
  ev.push({ t: 'room_event', op: 'runner', id: e.id, slot: -1, x, y });
  ev.push({ t: 'domain', type: 'runner_spawned', payload: { round: state.round, id: e.id } });
  return e;
}

/** Seconds the imp has left before its portal opens (0 while channelling). */
export function runnerSecondsLeft(state: SimState, e: EnemyState): number {
  const born = e.avars?.['imp.b'] ?? state.tick;
  return Math.max(0, (born + ticks(R.runnerEscapeSec) - state.tick) / TICK_RATE);
}

/** Pick a refuge (far from every hero, not too far to run) and the next waypoint toward it along an A* path. */
function replanRunner(state: SimState, e: EnemyState, av: Record<string, number>) {
  const map = state.map!;
  const heroes = state.players.filter((p) => p.lifeState === 'alive');
  const me = tileOf(map, e.x, e.y);
  const hd = bfs(map, heroes.map((p) => tileOf(map, p.x, p.y)));
  const rd = bfs(map, [me], 18);
  let goal = me, gs = -Infinity;
  for (let i = 0; i < map.tiles.length; i++) {
    if (rd[i] < 0 || hd[i] < 0) continue;
    const s = Math.min(hd[i], 14) * 2 - rd[i] * 0.5;
    if (s > gs + 1e-9) { gs = s; goal = i; }
  }
  const [gx, gy] = tileCenter(map, goal);
  const path = findPath(map, e.x, e.y, gx, gy);
  let k = 0;
  while (k + 1 < path.length) {
    const [nx, ny] = tileCenter(map, path[k + 1]);
    if (!lineOfSight(map, e.x, e.y, nx, ny)) break;
    k++;
  }
  av['imp.g'] = goal;
  av['imp.wp'] = path.length ? path[k] : goal;
  av['imp.re'] = state.tick + ticks(R.replanSec);
}

function escapeRunner(state: SimState, ev: SimEvent[], e: EnemyState) {
  ev.push({ t: 'room_event', op: 'escape', id: e.id, slot: -1, x: e.x, y: e.y });
  ev.push({ t: 'domain', type: 'runner_escaped', payload: { round: state.round, id: e.id } });
  // gone without a death: removed with the dying at the end of this combat tick (no kill, no drops)
  e.state = 'dying'; e.deathTimer = 0; e.attack = null; e.vx = 0; e.vy = 0;
  e.cohort.count = Big.ZERO;
}

/** One tick of a living imp (after the AI, which leaves it standing): portal timer, panic sprint, flee along its path. */
export function stepRunner(state: SimState, ev: SimEvent[], e: EnemyState) {
  const map = state.map;
  if (!map || e.state === 'dying') return;
  const av = e.avars ?? (e.avars = { 'imp.b': state.tick, 'imp.s': 3.68 });
  e.stuckTimer = 0;   // the AI's unstick nudge never fires (the imp moves itself)
  const age = state.tick - av['imp.b'];
  const esc = ticks(R.runnerEscapeSec), port = ticks(R.runnerPortalSec);
  if (age >= esc + port) { escapeRunner(state, ev, e); return; }
  if (age >= esc) {
    if (!av['imp.p']) {
      av['imp.p'] = 1;
      ev.push({ t: 'room_event', op: 'portal', id: e.id, slot: -1, x: e.x, y: e.y });
    }
    e.vx = 0; e.vy = 0; e.state = 'idle';
    return;
  }
  if (isFrozen(state, e)) { e.vx = 0; e.vy = 0; e.state = 'idle'; return; }
  let dn = Infinity;
  for (const p of state.players) if (p.lifeState === 'alive') dn = Math.min(dn, Math.hypot(p.x - e.x, p.y - e.y));
  if (dn < R.panicRange && state.tick >= (av['imp.pc'] ?? 0)) {
    av['imp.pu'] = state.tick + ticks(R.panicSec);
    av['imp.pc'] = state.tick + ticks(R.panicSec + R.panicCooldownSec);
  }
  if (state.tick >= (av['imp.re'] ?? 0) || av['imp.wp'] === undefined) replanRunner(state, e, av);
  const [wx, wy] = tileCenter(map, av['imp.wp']);
  const d = Math.hypot(wx - e.x, wy - e.y);
  const speed = av['imp.s'] * (state.tick < (av['imp.pu'] ?? 0) ? R.panicSpeed : 1) * moveMul(state, e);
  const step = Math.min(d, speed * DT);
  if (step <= 1e-6) {
    e.vx = 0; e.vy = 0; e.state = 'idle';
    if (d < 0.2) av['imp.re'] = state.tick;   // arrived: plan the next leg now
    return;
  }
  const [dx, dy] = norm(wx - e.x, wy - e.y);
  const r = moveCircle(map, e.x, e.y, dx * step, dy * step, Math.min(e.radius, 0.6));
  e.vx = (r.x - e.x) / DT; e.vy = (r.y - e.y) / DT;
  e.x = r.x; e.y = r.y;
  e.fx = dx; e.fy = dy;
  e.state = 'move';
  if (d - step < 0.2) av['imp.re'] = state.tick;
}

/** Coins as it is hit: one per further tenth of its health lost (the rest come out when it dies). */
function runnerHit(state: SimState, e: EnemyState) {
  const av = e.avars ?? (e.avars = { 'imp.b': state.tick, 'imp.s': 3.68 });
  const steps = R.runnerCoinSteps;
  const due = Math.min(steps - 1, Math.floor((1 - cohortHpFrac(e.cohort)) * steps + 1e-9));
  let done = av['imp.c'] ?? 0;
  while (done < due) { dropCoins(state, e.x, e.y, 1, 0.5); done++; }
  av['imp.c'] = done;
}

/** A healing potion or haste orb from the room-event stream (fortune extras, the imp's shower). */
function spawnPickup(state: SimState, kind: string, x: number, y: number, tier: number) {
  if (!state.map) return;
  const rng = eventRng(state);
  const ang = nextFloat(rng) * Math.PI * 2, r = 0.25 + nextFloat(rng) * 0.55;
  const [px, py] = nearestFloor(state.map, x + Math.cos(ang) * r, y + Math.sin(ang) * r);
  (state.pickups ??= []).push({ id: state.nextId++, kind, x: px, y: py, bornTick: state.tick, untilTick: state.tick + ticks(25), tier });
}

/** The imp dies: coin piles, a rare potion and orb, and a legendary at showerLegendaryChance. */
function runnerShower(state: SimState, ev: SimEvent[], e: EnemyState, slot: number) {
  const done = e.avars?.['imp.c'] ?? 0;
  if (done < R.runnerCoinSteps) dropCoins(state, e.x, e.y, R.runnerCoinSteps - done, 0.6);   // the coins it still carried
  for (let i = 0; i < R.showerPiles; i++) dropCoins(state, e.x, e.y, R.showerPile, 1.3);
  spawnPickup(state, PICKUP_KINDS.potion, e.x, e.y, 2);
  spawnPickup(state, PICKUP_KINDS.orb, e.x, e.y, 2);
  if (nextFloat(eventRng(state)) < R.showerLegendaryChance) dropLegendary(state, ev, e.x, e.y, 'elite');
  ev.push({ t: 'room_event', op: 'shower', id: e.id, slot, x: e.x, y: e.y });
  ev.push({ t: 'domain', type: 'runner_slain', payload: { round: state.round, id: e.id, slot } });
}

/** Shrine of Fortune: an extra potion-or-orb chance and an extra legendary roll per ordinary / elite kill. */
function fortuneExtras(state: SimState, ev: SimEvent[], e: EnemyState) {
  if (!e.objective && !e.elite && !state.training) return;
  const rng = eventRng(state);
  if (nextFloat(rng) < T.fortunePickupChance) spawnPickup(state, nextFloat(rng) < 0.6 ? PICKUP_KINDS.potion : PICKUP_KINDS.orb, e.x, e.y, Math.min(2, e.elite ?? 0));
  if (e.boss) return;
  const roll = nextFloat(rng);
  const found = (state.lootFound ?? []).filter((f) => f.round === state.round && f.source !== 'boss').length;
  if (roll < lootChance(state, e) && found < LOOT_RULES.maxDropsPerRound) dropLegendary(state, ev, e.x, e.y, (e.elite ?? 0) > 0 ? 'elite' : 'enemy');
}

// ---------------- training grounds ----------------

/** TRAIN op 'event' (training.ts): 'shrine_<type>', 'altar', 'merchant', 'runner' or 'coins', placed ahead of the hero. */
export function trainingRoomEvent(state: SimState, ev: SimEvent[], p: PlayerState, arg: string): { ok: true } | { ok: false; code: string } {
  const map = state.map;
  if (!map) return { ok: false, code: 'STALE_PHASE' };
  const list = eventState(state).list;
  // fan successive spawns around the aim so they never stack (deterministic: the yard's event count)
  const fan = ((list.length % 5) - 2) * 0.7;
  const ahead = (dist: number, turn = fan) => {
    const c = Math.cos(turn), s = Math.sin(turn);
    return nearestFloor(map, p.x + (p.aimX * c - p.aimY * s) * dist, p.y + (p.aimX * s + p.aimY * c) * dist);
  };
  if (arg !== 'runner' && arg !== 'coins' && list.length >= 8) list.splice(0, list.length - 7);   // the yard keeps the newest few
  if (arg.startsWith('shrine_')) {
    const type = arg.slice(7);
    if (!SHRINE_BY_ID[type]) return { ok: false, code: 'INVALID_INPUT' };
    const [x, y] = ahead(2.5);
    addEvent(state, { kind: 'shrine', type, x, y });
    return { ok: true };
  }
  switch (arg) {
    case 'altar': { const [x, y] = ahead(2.5); newAltar(state, x, y, list.length, state.tick); return { ok: true }; }
    case 'merchant': { const [x, y] = ahead(2.5); newMerchant(state, ev, x, y, state.tick); return { ok: true }; }
    case 'runner': {
      if (state.enemies.some((e) => isRunner(e) && e.state !== 'dying')) return { ok: false, code: 'BOSS_ACTIVE' };
      const [x, y] = ahead(5, 0);
      return spawnRunner(state, ev, { x, y }) ? { ok: true } : { ok: false, code: 'STALE_PHASE' };
    }
    case 'coins': { const [x, y] = ahead(1.6, 0); dropCoins(state, x, y, 30, 1.2); return { ok: true }; }
    default: return { ok: false, code: 'INVALID_INPUT' };
  }
}

// ---------------- snapshot, ledger ----------------

/** Room events as the client sees them: shrines / altars / the merchant, and living treasure imps (k 'runner'). */
export interface SnapRoomEvent {
  i: number;
  k: 'shrine' | 'altar' | 'merchant' | 'runner';
  t: string;
  x: number; y: number;
  /** spent (dark) */
  u?: 1;
  /** altar offers (pact ids, 'relic:<item>') */
  o?: string[];
  /** merchant shelf: [ware, price, left, item?] */
  s?: [string, number, number, string?][];
  /** imp: seconds until its portal opens; p = the portal is opening */
  l?: number;
  p?: 1;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function roomEventSnapshot(state: SimState): { rev?: SnapRoomEvent[] } {
  const out: SnapRoomEvent[] = [];
  for (const e of roomEventsOf(state)) {
    const s: SnapRoomEvent = { i: e.id, k: e.kind, t: e.type, x: r3(e.x), y: r3(e.y) };
    if (e.used) s.u = 1;
    if (e.offers) s.o = e.offers;
    if (e.stock) s.s = e.stock.map((r) => (r.item ? [r.ware, r.price, r.left, r.item] : [r.ware, r.price, r.left]));
    out.push(s);
  }
  for (const e of state.enemies) {
    if (!isRunner(e) || e.state === 'dying') continue;
    const s: SnapRoomEvent = { i: e.id, k: 'runner', t: 'imp', x: r3(e.x), y: r3(e.y), l: Math.round(runnerSecondsLeft(state, e) * 10) / 10 };
    if (e.avars?.['imp.p']) s.p = 1;
    out.push(s);
  }
  return out.length ? { rev: out } : {};
}

/** Per-hero snapshot fields: coins and the seconds left on timed shrine blessings. */
export function playerEventSnap(state: SimState, p: PlayerState): { co?: number; rb?: Record<string, number> } {
  const out: { co?: number; rb?: Record<string, number> } = {};
  if (p.coins) out.co = p.coins;
  for (const b of p.buffs) {
    if (!b.id.startsWith('shrine_') || b.until <= state.tick || b.id === shrineBuff('fortune')) continue;
    (out.rb ??= {})[b.id] = Math.ceil((b.until - state.tick) / TICK_RATE);
  }
  return out;
}

/** Ledger rows: every altar pact and merchant run boon, in order. */
export function ledgerPacts(state: SimState): { pacts?: { round: number; slot: number; name: string; id: string; src: 'altar' | 'merchant'; item?: string; mods: { stat: string; factor: string }[] }[] } {
  const list: NonNullable<ReturnType<typeof ledgerPacts>['pacts']> = [];
  for (const p of state.players) for (const r of p.pacts ?? []) list.push({ round: r.round, slot: p.slot, name: p.name, id: r.id, src: r.src, ...(r.item ? { item: r.item } : {}), mods: r.mods });
  list.sort((a, b) => a.round - b.round || a.slot - b.slot);
  return list.length ? { pacts: list } : {};
}

// ---------------- hooks ----------------

registerGlobalHooks({
  // after pickups.ts / caches.ts (imported earlier) cleared and refilled the floor's pickups
  onRoundStart(state) {
    setupFloor(state);
  },
  onTick(state, ev) {
    const rs = state.roomEvents;
    if (rs?.runnerAt !== undefined && state.tick >= rs.runnerAt) {
      delete rs.runnerAt;
      spawnRunner(state, ev);
    }
    for (const e of state.enemies) if (isRunner(e) && e.state !== 'dying') stepRunner(state, ev, e);
    // Shrine of Warding: the shield renews every wardPulseSec while the blessing lasts
    const ward = shrineBuff('warding');
    const pulse = ticks(T.wardPulseSec);
    for (const p of state.players) {
      if (p.lifeState !== 'alive' || !p.buffs.length) continue;
      const b = p.buffs.find((x) => x.id === ward && x.until > state.tick);
      if (b && (b.until - state.tick) % pulse === 0) shieldPlayer(state, ev, p, p.maxHp.mul(B(T.wardPulse)));
    }
  },
  onEnemyHit(state, _ev, _p, e) {
    if (isRunner(e)) runnerHit(state, e);
  },
  onKill(state, ev, e, p) {
    if (state.phase !== 'COMBAT') return;
    if (isRunner(e)) { runnerShower(state, ev, e, p?.slot ?? -1); return; }
    if (fortuneActive(state) && !bountyRules(state).noPickups) fortuneExtras(state, ev, e);
  },
  modifyHit(state, p, _e, _info, mod) {
    if (p.buffs.length && buffActive(state, p, shrineBuff('fury'))) mod.dmg = mod.dmg.mul(B(T.furyDamage));
  },
});


