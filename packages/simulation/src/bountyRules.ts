import { BOUNTY_BY_ID, DODGE, type BountyRules } from '@cursebound/content';
import type { SimState } from './types';

// Rule switches of the run's daily bounty modifier (content bounties.ts). A leaf module (content imports only) so
// combat, players and pickups can read it without import cycles; bounty.ts applies the stat and bane parts.

const NONE: BountyRules = {};

export function bountyRules(state: Pick<SimState, 'bounty'>): BountyRules {
  return (state.bounty && BOUNTY_BY_ID[state.bounty]?.rules) || NONE;
}

/** Maximum dodge charges for a hero (a bounty may lower it; checkpoints from before bounties have none). */
export function dodgeMaxOf(p: { dodgeMax?: number }): number {
  return p.dodgeMax ?? DODGE.charges;
}
