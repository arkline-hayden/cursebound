import { Big, percentToFactor, floorMulBig } from '@cursebound/numeric';
import { DUNGEON_THEMES, RARITY_WEIGHTS, RULES, TICK_RATE, basePoints, cardById, cardMechanics, cardRarity, cardStatEffects, isBossRound, type CardRarity } from '@cursebound/content';
import { blessedCard } from './blessing';
import { bindMechanic } from './boons';
import { nextInt, seedRng, type RngState } from './rng';
import { ONE, derivePlayer } from './stats';
import type { CommitRecord, OfferState, SimEvent, SimState } from './types';

// Fate deck, offers, voting and exactly-once commits (REQ FATE01, VOTE01, PRD §4.2, §8).
// No filtering of any kind: three distinct card IDs per offer, all cards return to eligibility next round,
// no reroll/skip/cleanse/veto. Rarity only weights the draw (60/30/10); every card in the deck stays possible.

const RARITY_ORDER: CardRarity[] = ['common', 'rare', 'mythic'];

/**
 * Draw k distinct card ids from the offers stream. Each slot rolls a rarity by RARITY_WEIGHTS among the rarities
 * still present in the remaining pool, then picks a card of that rarity uniformly. Unknown ids count as common.
 */
export function drawWeighted(rng: RngState, deck: readonly string[], k: number): string[] {
  const pool = deck.slice();
  const out: string[] = [];
  for (let i = 0; i < k && pool.length > 0; i++) {
    const by: Record<CardRarity, number[]> = { common: [], rare: [], mythic: [] };
    pool.forEach((id, j) => { const c = cardById(id); by[c ? cardRarity(c) : 'common'].push(j); });
    const avail = RARITY_ORDER.filter((r) => by[r].length > 0);
    const total = avail.reduce((s, r) => s + RARITY_WEIGHTS[r], 0);
    let roll = nextInt(rng, total);
    let pick = avail[avail.length - 1];
    for (const r of avail) {
      if (roll < RARITY_WEIGHTS[r]) { pick = r; break; }
      roll -= RARITY_WEIGHTS[r];
    }
    const list = by[pick];
    const j = list[nextInt(rng, list.length)];
    out.push(pool[j]);
    pool.splice(j, 1);
  }
  return out;
}

/** Share of the first slot's rarity roll per rarity, for this deck (rarities absent from the deck get 0). */
export function rarityShare(deck: readonly string[]): Record<CardRarity, number> {
  const present = RARITY_ORDER.filter((r) => deck.some((id) => { const c = cardById(id); return (c ? cardRarity(c) : 'common') === r; }));
  const total = present.reduce((s, r) => s + RARITY_WEIGHTS[r], 0);
  return Object.fromEntries(RARITY_ORDER.map((r) => [r, present.includes(r) ? RARITY_WEIGHTS[r] / total : 0])) as Record<CardRarity, number>;
}

/**
 * Door themes for an offer (doors.ts): k distinct dungeon themes, none equal to the current floor's theme, drawn
 * from the offers stream after the cards (so the card draw itself is unchanged).
 */
export function drawDoorThemes(rng: RngState, current: string | null, k = 3): string[] {
  const pool = DUNGEON_THEMES.map((t) => t.id).filter((id) => id !== current);
  const out: string[] = [];
  for (let i = 0; i < k && pool.length > 0; i++) out.push(pool.splice(nextInt(rng, pool.length), 1)[0]);
  // fewer themes than doors (never with the shipped seven): repeat in order rather than leave a door themeless
  for (let i = 0; out.length < k && out.length > 0; i++) out.push(out[i]);
  return out;
}

export function drawOffer(state: SimState, snapshotHash: string): OfferState {
  const cards = drawWeighted(state.rng.offers, state.deck, 3);
  const themes = drawDoorThemes(state.rng.offers, state.map?.theme ?? null, cards.length);
  const id = `${state.runId}-o${state.round}`;
  const timed = state.mode === 'coop';
  return {
    id, round: state.round, cards, snapshotHash, stateVersion: state.stateVersion,
    deadlineTick: timed ? state.tick + RULES.voteWindowSec * TICK_RATE : null,
    votes: state.players.map((p) => ({ slot: p.slot, seq: 0, cardSlot: null, locked: false })),
    resolved: false,
    themes,
  };
}

export function voteCounts(offer: OfferState): number[] {
  const c = [0, 0, 0];
  for (const v of offer.votes) if (v.cardSlot !== null) c[v.cardSlot]++;
  return c;
}

export type VoteResult = { ok: true } | { ok: false; code: 'STALE_OFFER' | 'STALE_PHASE' | 'DUPLICATE_SEQ' | 'LOCKED' | 'INVALID_INPUT' };

export function castVote(state: SimState, slot: number, offerId: string, seq: number, cardSlot: number | null, locked: boolean): VoteResult {
  if (state.phase !== 'VOTING' || !state.offer || state.offer.resolved) return { ok: false, code: 'STALE_PHASE' };
  if (offerId !== state.offer.id) return { ok: false, code: 'STALE_OFFER' };
  const v = state.offer.votes.find((x) => x.slot === slot);
  if (!v) return { ok: false, code: 'INVALID_INPUT' };
  if (!Number.isInteger(seq) || seq <= v.seq) return { ok: false, code: 'DUPLICATE_SEQ' };
  if (v.locked) return { ok: false, code: 'LOCKED' };
  if (cardSlot !== null && !(cardSlot === 0 || cardSlot === 1 || cardSlot === 2)) return { ok: false, code: 'INVALID_INPUT' };
  if (locked && cardSlot === null) return { ok: false, code: 'INVALID_INPUT' };
  v.seq = seq; v.cardSlot = cardSlot; v.locked = locked;
  return { ok: true };
}

/** Early resolution when every connected eligible member locked and no reconnect seat remains in grace. */
export function voteShouldResolve(state: SimState): boolean {
  const offer = state.offer!;
  if (offer.deadlineTick !== null && state.tick >= offer.deadlineTick) return true;
  const holdTicks = RULES.reconnectHoldSec * TICK_RATE;
  const connected = state.players.filter((p) => p.connected);
  if (!connected.length) return false;
  for (const p of state.players) {
    if (!p.connected && p.disconnectedAtTick !== null && state.tick - p.disconnectedAtTick < holdTicks && offer.deadlineTick !== null) return false;
  }
  return connected.every((p) => offer.votes.find((v) => v.slot === p.slot)!.locked);
}

/** Plurality among submitted votes; ties broken by a deterministic stream scoped to run and offer.
 *  `effective` replaces the explicit counts (doors.ts: a hero's vote is the door they stand in, else their VOTE). */
export function resolveVotes(state: SimState, effective?: number[]): { cardSlot: number; tie: CommitRecord['tie'] } {
  const offer = state.offer!;
  const counts = effective ? effective.slice(0, 3) : voteCounts(offer);
  const max = Math.max(...counts);
  const rng = seedRng(state.seed, 'vote', offer.id);
  if (max === 0) {
    const draw = nextInt(rng, 3);
    return { cardSlot: draw, tie: { tiedSlots: [0, 1, 2], draw, zeroVotes: true, counts } };
  }
  const tied = [0, 1, 2].filter((i) => counts[i] === max);
  if (tied.length === 1) return { cardSlot: tied[0], tie: { tiedSlots: tied, draw: null, zeroVotes: false, counts } };
  const draw = nextInt(rng, tied.length);
  return { cardSlot: tied[draw], tie: { tiedSlots: tied, draw, zeroVotes: false, counts } };
}

/** Apply a card: stat effects multiply (X_new = X_old × (1 + p/100)); boons/banes bind one more copy whose
 *  magnitude stacks multiplicatively (boons.ts). Records Ledger provenance for every effect.
 *  Maximum health changes preserve each player's current health fraction (D07).
 *  `blessed` (Fate's Blessing, blessing.ts): the card's price — negative stat and bane — is not applied. */
export function applyCard(state: SimState, cardId: string, offerId: string, ev: SimEvent[], blessed = false) {
  const found = cardById(cardId);
  if (!found) throw new Error(`unknown card ${cardId}`);
  const card = blessed ? blessedCard(found) : found;
  const beforeMax = state.players.map((p) => p.maxHp);
  let seq = state.fate.entries.length + (state.fate.mechanicEntries?.length ?? 0);
  for (const { effect: eff } of cardStatEffects(card)) {
    const factor = percentToFactor(eff.percent);
    const old = state.fate.factors[eff.stat] ?? ONE;
    state.fate.factors[eff.stat] = old.mul(factor);
    state.fate.entries.push({ seq: seq++, offerId, cardId, round: state.round, stat: eff.stat, percent: eff.percent, factor });
  }
  for (const { effect } of cardMechanics(card)) bindMechanic(state, effect.id, effect.magnitude, { offerId, cardId, seq: seq++ });
  state.stateVersion++;
  state.players.forEach((p, i) => {
    const d = derivePlayer(state, p);
    refreshMaxHp(p, beforeMax[i], d.maxHp);
  });
  ev.push({ t: 'domain', type: 'fate_applied', payload: blessed ? { cardId, offerId, blessed: true } : { cardId, offerId } });
}

export function refreshMaxHp(p: SimState['players'][number], oldMax: Big, newMax: Big) {
  if (oldMax.eq(newMax)) { p.maxHp = newMax; return; }
  if (p.hp.isZero() || oldMax.isZero()) { p.maxHp = newMax; return; }
  p.hp = Big.min(newMax, p.hp.mul(newMax).div(oldMax));
  p.maxHp = newMax;
}

// ---------------- Score (REQ SCORE01, PRD §13.1) ----------------

/** s_r = floor(b_r × M_r × (1 + v_r)), v_r = 0.25 × max(0, 1 − t/T) = (4T + max(0, T − t)) / 4T exactly. */
export function roundAward(r: number, M: Big, activeTicks: number, referenceTicks: number): { award: bigint; num: bigint; den: bigint } {
  const b = basePoints(r);
  const T = BigInt(referenceTicks);
  const t = BigInt(activeTicks);
  const delta = T > t ? T - t : 0n;
  const num = 4n * T + delta;
  const den = 4n * T;
  return { award: floorMulBig(b, M, num, den), num, den };
}

/** Partial credit: floor(b_r × M_r × completed/total), no speed bonus. */
export function partialAward(r: number, M: Big, completed: number, total: number): bigint {
  if (completed <= 0 || total <= 0) return 0n;
  return floorMulBig(basePoints(r), M, BigInt(completed), BigInt(total));
}

export function addScore(a: string, b: bigint): string {
  return (BigInt(a) + b).toString();
}

export { isBossRound };
