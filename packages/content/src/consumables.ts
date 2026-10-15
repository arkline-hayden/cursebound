// Legendary consumables (data only) and the training grounds' presentation identity.
//
// Fate's Blessing: a legendary consumable. It drops through the same roll as legendary gear (simulation gear.ts
// chooseLegendary: one more entry in the legendary pool, weighted like a single item, so it is exactly as rare as any
// one legendary), lies on the ground in a prismatic beam, and goes into the finder's pack on touch. During the door
// vote (simulation blessing.ts) any party member holding one may bless one of the three Fate cards: that card's
// price (negative stat and/or bane) is lifted for the commit; the gift is unchanged. One blessing per card.

export interface ConsumableDef {
  id: string;
  name: string;
  description: string;
  flavor: string;
}

export const FATES_BLESSING: ConsumableDef = {
  id: 'fates_blessing',
  name: "Fate's Blessing",
  description: 'Bless one Fate card during the door vote: its price (curse) is lifted for the commit. The gift stays.',
  flavor: 'Every bargain has a loophole. This one shines.',
};

export const CONSUMABLES: ConsumableDef[] = [FATES_BLESSING];
export const CONSUMABLE_BY_ID: Record<string, ConsumableDef> = Object.fromEntries(CONSUMABLES.map((c) => [c.id, c]));

/** True for a ground-loot item id that is a consumable (not wearable gear). */
export function isConsumable(itemId: string | null | undefined): boolean {
  return !!itemId && !!CONSUMABLE_BY_ID[itemId];
}

/** Most blessings one hero can carry (extra pickups stay on the ground for allies). */
export const MAX_BLESSINGS = 3;

/**
 * Training grounds (simulation training.ts): a sunlit town courtyard used only by training rooms. Not a dungeon
 * theme (never drawn for doors or the round rotation); the client renders it with its own art (render/Courtyard.ts).
 */
export const TRAINING_THEME = { id: 'courtyard', name: 'The Training Grounds', description: 'A sunlit town square of cobbles, stalls and straw foes.' };
