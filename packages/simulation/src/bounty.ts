import { percentToFactor } from '@cursebound/numeric';
import { BOUNTY_BY_ID, bountyCardId } from '@cursebound/content';
import { bindMechanic } from './boons';
import { refreshMaxHp } from './fate';
import { ONE, derivePlayer } from './stats';
import type { SimState } from './types';

// Daily bounty (content bounties.ts): a run created with a bounty modifier gets it applied once, at creation, before
// LOADOUT_LOCK. Deterministic: only content data and the fresh state, so a replay (whose header carries the bounty)
// rebuilds the identical run.
//  - stat factors bind into state.fate.factors exactly like a Fate card's (offer 'bounty', card 'bounty:<id>', round 0)
//    so every derived stat, the Forecast and the Ledger see them;
//  - banes bind one copy via boons.ts bindMechanic, as a card's bane would;
//  - rule switches live in bountyRules.ts and are read where each rule is applied (pickups, dodge, downs, revives,
//    Fate prices, intermission heal). "Hobbled" also stamps each hero's dodge maximum (PlayerState.dodgeMax).

export const BOUNTY_OFFER_ID = 'bounty';

export function applyBounty(state: SimState, modifierId: string) {
  const def = BOUNTY_BY_ID[modifierId];
  if (!def) throw new Error(`unknown bounty modifier ${modifierId}`);
  state.bounty = modifierId;
  const cardId = bountyCardId(modifierId);
  const beforeMax = state.players.map((p) => p.maxHp);
  let seq = state.fate.entries.length + (state.fate.mechanicEntries?.length ?? 0);
  for (const s of def.stats ?? []) {
    const factor = percentToFactor(s.percent);
    state.fate.factors[s.stat] = (state.fate.factors[s.stat] ?? ONE).mul(factor);
    state.fate.entries.push({ seq: seq++, offerId: BOUNTY_OFFER_ID, cardId, round: 0, stat: s.stat, percent: s.percent, factor });
  }
  for (const m of def.mechanics ?? []) bindMechanic(state, m.id, m.magnitude, { offerId: BOUNTY_OFFER_ID, cardId, seq: seq++ });
  const charges = def.rules?.dodgeCharges;
  state.players.forEach((p, i) => {
    if (charges !== undefined) { p.dodgeMax = charges; p.dodgeCharges = Math.min(p.dodgeCharges, charges); }
    refreshMaxHp(p, beforeMax[i], derivePlayer(state, p).maxHp);
  });
  state.stateVersion++;
}
