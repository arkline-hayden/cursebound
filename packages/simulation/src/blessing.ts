import { FATES_BLESSING, LOOT_RULES, MAX_BLESSINGS, cardById, type CardDef } from '@cursebound/content';
import type { GroundLoot, OfferState, PlayerState, SimEvent, SimState } from './types';

// Fate's Blessing (content consumables.ts), the legendary consumable. It drops through the legendary roll (gear.ts
// chooseLegendary), lies on the ground like gear (state.loot, item id FATES_BLESSING.id) and goes into the pack of the
// first hero to touch it (PlayerState.bless, at most MAX_BLESSINGS each). During VOTING any party member holding one
// may bless one of the three offered cards (BLESS command): the card's price — its negative stat and/or its bane — is
// not applied if that card is committed (fate.ts applyCard), the gift is untouched. Validation: the right phase and
// offer, a held blessing, a card that has a price, at most one blessing per card. The blessing is consumed on use
// (even if another card ends up committed: the party chose to spend it). Deterministic plain data, replayed exactly.

export type BlessResult = { ok: true } | { ok: false; code: 'STALE_PHASE' | 'STALE_OFFER' | 'INVALID_INPUT' | 'NO_BLESSING' | 'ALREADY_BLESSED' | 'NO_CURSE' };

export const isBlessingItem = (itemId: string): boolean => itemId === FATES_BLESSING.id;

/** Blessings a hero carries. */
export function blessingsOf(p: PlayerState | undefined): number {
  return p?.bless ?? 0;
}

/** True when the card has a price a blessing can lift. */
export function cardHasCurse(card: CardDef | undefined): boolean {
  return !!card && (!!card.negative || !!card.bane);
}

/** The blessing on card `cardSlot` of an offer (who blessed it), if any. */
export function blessingOn(offer: OfferState | null | undefined, cardSlot: number): { card: number; slot: number } | undefined {
  return offer?.blessed?.find((b) => b.card === cardSlot);
}

/** A card as it binds when blessed: the same card without its price. */
export function blessedCard(card: CardDef): CardDef {
  const out: CardDef = { ...card };
  delete out.negative;
  delete out.bane;
  return out;
}

/** The card an offer slot binds (blessed view when blessed). Forecasts and the commit read it. */
export function offeredCard(offer: OfferState, cardSlot: number): CardDef | undefined {
  const c = cardById(offer.cards[cardSlot] ?? '');
  return c && blessingOn(offer, cardSlot) ? blessedCard(c) : c;
}

/** BLESS: spend one of the hero's blessings on card `cardSlot` of the current offer. */
export function applyBlessing(state: SimState, ev: SimEvent[], p: PlayerState, offerId: string, cardSlot: number): BlessResult {
  const offer = state.offer;
  if (state.phase !== 'VOTING' || !offer || offer.resolved) return { ok: false, code: 'STALE_PHASE' };
  if (offerId !== offer.id) return { ok: false, code: 'STALE_OFFER' };
  if (!Number.isInteger(cardSlot) || cardSlot < 0 || cardSlot >= offer.cards.length) return { ok: false, code: 'INVALID_INPUT' };
  if (blessingsOf(p) < 1) return { ok: false, code: 'NO_BLESSING' };
  if (blessingOn(offer, cardSlot)) return { ok: false, code: 'ALREADY_BLESSED' };
  const card = cardById(offer.cards[cardSlot]);
  if (!cardHasCurse(card)) return { ok: false, code: 'NO_CURSE' };
  (offer.blessed ??= []).push({ card: cardSlot, slot: p.slot });
  p.bless = blessingsOf(p) - 1;
  if (p.bless <= 0) delete p.bless;
  state.stateVersion++;
  const door = state.doors?.list[cardSlot];
  ev.push({ t: 'blessing', op: 'apply', slot: p.slot, card: cardSlot, x: door?.x ?? p.x, y: door?.y ?? p.y });
  ev.push({ t: 'domain', type: 'fate_blessed', payload: { offerId, cardSlot, cardId: offer.cards[cardSlot], slot: p.slot } });
  return { ok: true };
}

/**
 * One tick of a blessing lying on the ground (gear.ts stepLoot): after the pop delay, the nearest living hero in
 * pickup range with room in their pack takes it. Returns true when it was taken.
 */
export function stepBlessingLoot(state: SimState, ev: SimEvent[], it: GroundLoot, delayTicks: number): boolean {
  if (it.carry || state.tick - it.bornTick < delayTicks) return false;
  const R2 = LOOT_RULES.pickupRange ** 2;
  let best: PlayerState | null = null, bd = Infinity;
  for (const p of state.players) {
    if (p.lifeState !== 'alive' || blessingsOf(p) >= MAX_BLESSINGS) continue;
    const d2 = (p.x - it.x) ** 2 + (p.y - it.y) ** 2;
    if (d2 <= R2 && d2 < bd) { bd = d2; best = p; }
  }
  if (!best) return false;
  giveBlessing(state, ev, best, it);
  return true;
}

/** Put a ground blessing into a hero's pack. */
export function giveBlessing(state: SimState, ev: SimEvent[], p: PlayerState, it: GroundLoot) {
  p.bless = blessingsOf(p) + 1;
  ev.push({ t: 'blessing', op: 'pickup', slot: p.slot, x: it.x, y: it.y, id: it.id });
  ev.push({ t: 'domain', type: 'blessing_found', payload: { round: state.round, slot: p.slot } });
}

/** Round clear (gear.ts settleLoot): an unclaimed blessing goes to the nearest hero with room. Returns false if none. */
export function settleBlessing(state: SimState, ev: SimEvent[], it: GroundLoot): boolean {
  let best: PlayerState | null = null, bd = Infinity;
  for (const p of state.players) {
    if (blessingsOf(p) >= MAX_BLESSINGS) continue;
    const d2 = (p.x - it.x) ** 2 + (p.y - it.y) ** 2;
    if (d2 < bd) { bd = d2; best = p; }
  }
  if (!best) return false;
  giveBlessing(state, ev, best, it);
  return true;
}
