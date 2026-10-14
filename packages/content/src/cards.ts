import type { CardDef, CardEffect, CardRarity, MechanicEffect } from './types';

// The Fate deck (PRD §9.1, Appendix D3). Every card is a gift plus a price; effects multiply forever.
// - 24 commons: the original stat-for-stat bargains.
// - Rares: one new rule (a boon or a bane from mechanics.ts) traded against a stat, or rule for rule.
// - Mythics: build-defining boon + stat gift, paid for with a bane + a harsh stat.
// There are NO runtime eligibility rules: every card in the deck can always be offered (F08/F09, REQ FATE01).
// Rarity only weights the draw (fate.ts: 60/30/10); every card stays possible. All values are tuning proposals.
const c = (
  id: string, name: string, family: string,
  pos: [string, string], neg: [string, string],
  flavor: string, applicability: string[] = [],
): CardDef => ({
  id, version: 1, name, family, rarity: 'common',
  positive: { stat: pos[0], percent: pos[1] },
  negative: { stat: neg[0], percent: neg[1] },
  applicability, icon: `card:${id}`, flavor,
});

interface Spec {
  gift?: [string, string];     // stat gift [stat, percent]
  boon?: [string, string];     // mechanic gift [id, magnitude]
  price?: [string, string];    // stat price
  bane?: [string, string];     // mechanic price
  applicability?: string[];
}
const x = (id: string, name: string, family: string, rarity: CardRarity, s: Spec, flavor: string): CardDef => {
  const eff = (e?: [string, string]): CardEffect | undefined => (e ? { stat: e[0], percent: e[1] } : undefined);
  const mech = (e?: [string, string]): MechanicEffect | undefined => (e ? { id: e[0], magnitude: e[1] } : undefined);
  const card: CardDef = { id, version: 1, name, family, rarity, applicability: s.applicability ?? [], icon: `card:${id}`, flavor };
  if (s.gift) card.positive = eff(s.gift);
  if (s.price) card.negative = eff(s.price);
  if (s.boon) card.boon = mech(s.boon);
  if (s.bane) card.bane = mech(s.bane);
  return card;
};

export const CARDS: CardDef[] = [
  // ---------------- Commons: stat for stat ----------------
  c('blood_pact', 'Blood Pact', 'blood', ['player.damage', '75'], ['player.maxHealth', '-30'], 'Strength paid for in heartbeats.'),
  c('glass_cathedral', 'Glass Cathedral', 'glass', ['player.critPotency', '200'], ['enemy.damage', '100'], 'Every blow rings like a bell. So does every wound.', ['crit']),
  c('rapid_evolution', 'Rapid Evolution', 'tempo', ['player.attackFrequency', '40'], ['enemy.movementSpeed', '60'], 'The dead learn to run.'),
  c('immortal_ambition', 'Immortal Ambition', 'growth', ['player.healing', '150'], ['enemy.maxHealth', '300'], 'Life overflows. Theirs most of all.', ['healing']),
  c('endless_horde', 'Endless Horde', 'horde', ['player.attackFrequency', '150'], ['encounter.spawnQuantity', '400'], 'Strike faster. There will be more to strike.'),
  c('golden_catastrophe', 'Golden Catastrophe', 'gold', ['score.pressure', '100'], ['enemy.damage', '300'], 'Glory, priced in danger.'),
  c('colossal_bargain', 'Colossal Bargain', 'titan', ['player.maxHealth', '500'], ['enemy.maxHealth', '1000'], 'Grow mountainous. The world grows faster.'),
  c('temporal_collapse', 'Temporal Collapse', 'time', ['player.recoveryRate', '200'], ['enemy.attackFrequency', '200'], 'Time folds for everyone.'),
  c('mirrorstorm', 'Mirrorstorm', 'mirror', ['player.projectileCount', '100'], ['enemy.projectileCount', '100'], 'Every shot has a reflection.', ['projectile']),
  c('plague_bloom', 'Plague Bloom', 'decay', ['player.decayDamage', '200'], ['enemy.regeneration', '100'], 'Rot feeds the garden.', ['decay', 'regen-tagged']),
  c('wild_transit', 'Wild Transit', 'transit', ['player.movementSpeed', '100'], ['enemy.attackDamage', '75'], 'The road runs faster than you can think.'),
  c('thorn_covenant', 'Thorn Covenant', 'thorn', ['player.shieldCapacity', '150'], ['enemy.armor', '100'], 'Walls of briar, hides of bark.', ['shield']),
  c('red_horizon', 'Red Horizon', 'blood', ['player.damage', '100'], ['player.maxHealth', '-40'], 'The sky bleeds so your blade can.'),
  c('shattered_crown', 'Shattered Crown', 'glass', ['player.critTendency', '100'], ['enemy.damage', '80'], 'Fortune favors the cracked.', ['crit']),
  c('chasing_thunder', 'Chasing Thunder', 'tempo', ['player.attackFrequency', '75'], ['enemy.movementSpeed', '100'], 'Lightning hands, lightning hunters.'),
  c('deep_renewal', 'Deep Renewal', 'growth', ['player.healing', '200'], ['enemy.maxHealth', '400'], 'Roots drink deep on both sides.', ['healing']),
  c('thousand_footsteps', 'Thousand Footsteps', 'horde', ['player.resourceRegen', '100'], ['encounter.spawnQuantity', '200'], 'Power wells up as the ground trembles.'),
  c('gilded_ruin', 'Gilded Ruin', 'gold', ['score.pressure', '150'], ['enemy.damage', '500'], 'A golden age, briefly.'),
  c('titan_offering', 'Titan Offering', 'titan', ['player.maxHealth', '300'], ['enemy.maxHealth', '600'], 'An offering the giants accept gladly.'),
  c('borrowed_tomorrow', 'Borrowed Tomorrow', 'time', ['player.recoveryRate', '100'], ['enemy.attackFrequency', '100'], 'Spend the future now.'),
  c('prism_rain', 'Prism Rain', 'mirror', ['player.projectileCount', '200'], ['enemy.projectileCount', '200'], 'Light shatters into a thousand paths.', ['projectile']),
  c('rotting_garden', 'Rotting Garden', 'decay', ['player.decayDamage', '100'], ['enemy.regeneration', '200'], 'Decay blooms. So does recovery.', ['decay', 'regen-tagged']),
  c('comet_walk', 'Comet Walk', 'transit', ['player.movementSpeed', '75'], ['enemy.projectileSpeed', '100'], 'Streak like a comet. Dodge like one too.'),
  c('iron_orchard', 'Iron Orchard', 'thorn', ['player.armor', '100'], ['enemy.armor', '150'], 'Bark becomes iron on every trunk.'),

  // ---------------- Rares: a new rule ----------------
  x('chain_reaction', 'Chain Reaction', 'cataclysm', 'rare', { boon: ['chain_reaction', '0.25'], price: ['enemy.maxHealth', '80'] }, 'Every death is a fuse.'),
  x('vampiric_rite', 'Vampiric Rite', 'blood', 'rare', { boon: ['vampiric_rite', '0.08'], price: ['player.armor', '-40'] }, 'Drink deep. Bleed easy.'),
  x('thunderous_blows', 'Thunderous Blows', 'storm', 'rare', { boon: ['thunderous_blows', '3'], price: ['enemy.attackFrequency', '40'] }, 'The sky answers every fifth prayer.'),
  x('splitting_shots', 'Splitting Shots', 'mirror', 'rare', { boon: ['splitting_shots', '0.6'], price: ['enemy.projectileCount', '100'], applicability: ['projectile'] }, 'One becomes three. Theirs too.'),
  x('bloodrush', 'Bloodrush', 'blood', 'rare', { boon: ['bloodrush', '0.5'], price: ['enemy.movementSpeed', '50'] }, 'Blood quickens. So do they.'),
  x('soul_harvest', 'Soul Harvest', 'soul', 'rare', { boon: ['soul_harvest', '0.12'], price: ['encounter.spawnQuantity', '100'] }, 'A thousand souls, a thousand sparks.'),
  x('echo_of_ages', 'Echo of Ages', 'time', 'rare', { boon: ['echo', '0.3'], price: ['enemy.damage', '60'] }, 'Every spell remembers itself.'),
  x('executioner', 'Executioner', 'doom', 'rare', { boon: ['executioner', '0.15'], price: ['enemy.armor', '100'] }, 'The axe does not wait.'),
  x('retribution', 'Retribution', 'thorn', 'rare', { boon: ['retribution', '3'], price: ['enemy.attackDamage', '60'] }, 'Strike me. I dare you.'),
  x('warding_rune', 'Warding Rune', 'glass', 'rare', { boon: ['warding_rune', '0.2'], price: ['player.movementSpeed', '-20'], applicability: ['shield'] }, 'Etched in light, heavy as stone.'),
  x('static_trail', 'Static Trail', 'storm', 'rare', { boon: ['static_trail', '0.6'], bane: ['brittle', '0.5'] }, 'Dance on lightning. Land on glass.'),
  x('crimson_wager', 'Crimson Wager', 'moon', 'rare', { gift: ['player.damage', '150'], bane: ['blood_moon', '0.15'] }, 'Win quickly or not at all.'),
  x('gravediggers_bargain', "Gravedigger's Bargain", 'cataclysm', 'rare', { gift: ['player.maxHealth', '200'], bane: ['volatile_dead', '0.06'] }, 'The dead keep their embers.'),
  x('witchfire_tithe', 'Witchfire Tithe', 'hex', 'rare', { gift: ['player.critPotency', '250'], bane: ['hexed_ground', '0.25'], applicability: ['crit'] }, 'The ground itself collects the tithe.'),
  x('champion_tide', 'Champion Tide', 'gold', 'rare', { gift: ['score.pressure', '120'], price: ['encounter.eliteChance', '200'] }, 'Glory walks with giants.'),
  x('wrath_unbound', 'Wrath Unbound', 'tempo', 'rare', { gift: ['player.attackFrequency', '100'], bane: ['relentless', '0.5'] }, 'Wounded beasts bite hardest.'),
  x('reapers_wager', "Reaper's Wager", 'doom', 'rare', { gift: ['player.damage', '200'], bane: ['the_hunt', '0.3'] }, 'Something follows the brave.'),

  // ---------------- Mythics: build-defining, dramatic prices ----------------
  x('cataclysm', 'Cataclysm', 'cataclysm', 'mythic',
    { boon: ['chain_reaction', '0.6'], gift: ['player.damage', '50'], bane: ['volatile_dead', '0.08'], price: ['encounter.spawnQuantity', '200'] }, 'Everything burns. Everything.'),
  x('phoenix_heart', 'Phoenix Heart', 'phoenix', 'mythic',
    { boon: ['phoenix', '0.5'], gift: ['player.healing', '100'], bane: ['blood_moon', '0.2'], price: ['player.maxHealth', '-40'] }, 'Die once. Rise burning.'),
  x('sanguine_crown', 'Sanguine Crown', 'blood', 'mythic',
    { boon: ['vampiric_rite', '0.2'], gift: ['player.damage', '100'], bane: ['brittle', '1'], price: ['player.armor', '-50'] }, 'Feast forever. Never flinch.'),
  x('stormcaller', 'Stormcaller', 'storm', 'mythic',
    { boon: ['thunderous_blows', '8'], gift: ['player.attackFrequency', '50'], bane: ['hexed_ground', '0.35'], price: ['enemy.attackFrequency', '60'] }, 'Call the storm. It calls back.'),
  x('the_wild_hunt', 'The Wild Hunt', 'doom', 'mythic',
    { boon: ['executioner', '0.3'], gift: ['player.movementSpeed', '60'], bane: ['the_hunt', '0.5'], price: ['enemy.movementSpeed', '60'] }, 'Hunter and hunted run the same road.'),
  x('infinite_echo', 'Infinite Echo', 'time', 'mythic',
    { boon: ['echo', '0.6'], gift: ['player.recoveryRate', '100'], bane: ['relentless', '1'], price: ['enemy.maxHealth', '150'] }, 'The spell that never ends.'),
  x('prismatic_storm', 'Prismatic Storm', 'mirror', 'mythic',
    { boon: ['splitting_shots', '1.2'], gift: ['player.projectileCount', '100'], bane: ['blood_moon', '0.25'], price: ['enemy.projectileSpeed', '100'], applicability: ['projectile'] }, 'A sky of knives.'),
  x('soulforge', 'Soulforge', 'soul', 'mythic',
    { boon: ['soul_harvest', '0.3'], gift: ['player.damage', '150'], bane: ['volatile_dead', '0.1'], price: ['encounter.eliteChance', '300'] }, 'Feed the forge with champions.'),
  x('berserkers_requiem', "Berserker's Requiem", 'blood', 'mythic',
    { boon: ['bloodrush', '1'], gift: ['player.damage', '75'], bane: ['brittle', '1.5'], price: ['player.maxHealth', '-50'] }, 'Faster. Harder. Thinner.'),
  x('aegis_of_ruin', 'Aegis of Ruin', 'glass', 'mythic',
    { boon: ['warding_rune', '0.5'], gift: ['player.shieldCapacity', '200'], bane: ['hexed_ground', '0.5'], price: ['player.movementSpeed', '-30'], applicability: ['shield'] }, 'An unbreakable shell on breaking ground.'),
  x('thornlord', 'Thornlord', 'thorn', 'mythic',
    { boon: ['retribution', '10'], gift: ['player.armor', '200'], bane: ['the_hunt', '0.4'], price: ['enemy.attackDamage', '150'] }, 'Every wound a weapon.'),
];

export const CARD_BY_ID: Record<string, CardDef> = Object.fromEntries(CARDS.map((x) => [x.id, x]));

/** Tutorial-only sample card (PRD §16.3) — never part of a ranked/random deck. */
export const TUTORIAL_CARD: CardDef = c('tutorial_twin_blades', 'Twin Blades (tutorial)', 'blood', ['player.damage', '100'], ['enemy.maxHealth', '20'],
  'A teaching card: +100% damage means x2.');

/** Resolve a card id, including the tutorial card (which lives outside the deck). */
export function cardById(id: string): CardDef | undefined {
  return id === TUTORIAL_CARD.id ? TUTORIAL_CARD : CARD_BY_ID[id];
}

export const cardRarity = (card: CardDef): CardRarity => card.rarity ?? 'common';

/** Stat effects in display order: gift first, then price. */
export function cardStatEffects(card: CardDef): { side: 'gift' | 'price'; effect: CardEffect }[] {
  const out: { side: 'gift' | 'price'; effect: CardEffect }[] = [];
  if (card.positive) out.push({ side: 'gift', effect: card.positive });
  if (card.negative) out.push({ side: 'price', effect: card.negative });
  return out;
}

/** Mechanic effects in display order: boon first, then bane. */
export function cardMechanics(card: CardDef): { side: 'gift' | 'price'; effect: MechanicEffect }[] {
  const out: { side: 'gift' | 'price'; effect: MechanicEffect }[] = [];
  if (card.boon) out.push({ side: 'gift', effect: card.boon });
  if (card.bane) out.push({ side: 'price', effect: card.bane });
  return out;
}

/** Draw shares by rarity (fate.ts). Each slot rolls a rarity, then a card of that rarity uniformly. */
export const RARITY_WEIGHTS: Record<CardRarity, number> = { common: 60, rare: 30, mythic: 10 };

export const RARITIES: Record<CardRarity, { name: string; color: string }> = {
  common: { name: 'Common', color: '#c8ccd4' },   // silver
  rare: { name: 'Rare', color: '#e8c66a' },       // gold
  mythic: { name: 'Mythic', color: '#ff3d5a' },   // crimson, animated prismatic aura in the UI
};

export const FAMILIES: Record<string, { name: string; color: string }> = {
  blood: { name: 'Blood', color: '#e0315a' },
  glass: { name: 'Glass', color: '#7fe8ff' },
  tempo: { name: 'Tempo', color: '#ffd23f' },
  growth: { name: 'Growth', color: '#5ee07a' },
  horde: { name: 'Horde', color: '#ff8a3d' },
  gold: { name: 'Gold', color: '#ffc531' },
  titan: { name: 'Titan', color: '#b48cff' },
  time: { name: 'Time', color: '#6aa8ff' },
  mirror: { name: 'Mirror', color: '#f2a6ff' },
  decay: { name: 'Decay', color: '#a4d94a' },
  transit: { name: 'Transit', color: '#3fe0c5' },
  thorn: { name: 'Thorn', color: '#9b6b43' },
  // families introduced with the mechanic cards
  cataclysm: { name: 'Cataclysm', color: '#ff6a1f' },
  storm: { name: 'Storm', color: '#8fd8ff' },
  soul: { name: 'Soul', color: '#7ef0d0' },
  doom: { name: 'Doom', color: '#d8cdb4' },
  moon: { name: 'Moon', color: '#ff2a55' },
  hex: { name: 'Hex', color: '#9b5cff' },
  phoenix: { name: 'Phoenix', color: '#ffa53a' },
};
