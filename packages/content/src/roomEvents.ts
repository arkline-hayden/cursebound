import type { EnemyDef } from './types';

// Room events (data only; behaviour in packages/simulation/src/roomEvents.ts and coins.ts):
//   - Shrines: placed in typed rooms of ordinary floors; Interact grants the whole party a short blessing, then the
//     shrine goes dark. Usable during combat only.
//   - Cursed altar: trade health for power. One of three seeded pacts binds to the hero who takes it for the rest
//     of the run (shown in the Fate Ledger as an altar pact). The altar goes dark after one pact.
//   - Wandering merchant: sometimes waits on the cleared floor during the door vote (always after a boss floor);
//     sells a few wares for cursed coins. Purchases are validated by the authority (phase, range, stock, funds).
//   - Treasure imp: occasionally appears mid-floor and flees along paths; coins spill as it is hit; after a while it
//     opens a portal and is gone, unless it dies first in a shower of loot.
//   - Cursed coins: the run currency. Foes, elites, bosses, caches and imps drop them; whoever touches a coin pile
//     collects it for the whole party (every hero's purse gains the pile), so co-op heroes never race for coins.
// All chances are rolled on dedicated seeded streams, so placement and drops replay exactly.

export const ROOM_EVENT_RULES = {
  // ---- placement (ordinary floors; never boss arenas, the tutorial's first floor or the training yard) ----
  /** chance a floor holds a shrine, and a second (different) shrine on top */
  shrineChance: 0.5,
  secondShrineChance: 0.15,
  /** chance a floor holds a cursed altar, from altarMinRound */
  altarChance: 0.22,
  altarMinRound: 2,
  /** shrines and altars stand at least this many tiles (path) from the hero spawn */
  spawnClearance: 8,
  // ---- interaction ----
  /** world units between a hero and an event for Interact / a purchase to count (authority check) */
  useRange: 1.8,
  // ---- merchant (door vote after an ordinary floor; always after a boss floor) ----
  merchantChance: 0.35,
  merchantMinRound: 2,
  /** the merchant stands this far (world units) from every door front point */
  merchantDoorClearance: 4,
  // ---- treasure imp ----
  runnerChance: 0.2,
  runnerMinRound: 2,
  /** seconds into combat the imp appears (seeded within the range) */
  runnerDelaySec: [6, 20] as [number, number],
  /** seconds the imp flees before it opens its portal, and the portal channel (still killable) */
  runnerEscapeSec: 13,
  runnerPortalSec: 1.5,
  /** it appears this many tiles (path) from the nearest hero */
  runnerSpawnTiles: [6, 11] as [number, number],
  /** panic burst: a hero within panicRange makes it sprint (×panicSpeed for panicSec, then panicCooldownSec) */
  panicRange: 2.5,
  panicSpeed: 1.35,
  panicSec: 0.8,
  panicCooldownSec: 2,
  /** replan its escape route every replanSec */
  replanSec: 0.35,
  /** a coin spills each time it loses another 1/coinSteps of its health */
  runnerCoinSteps: 10,
  /** death shower: coin piles (each pile worth showerPile), a rare potion and orb, and a legendary at this chance */
  showerPiles: 4,
  showerPile: 5,
  showerLegendaryChance: 0.4,
};

/** Cursed coins: drop chances and pile values. */
export const COIN_RULES = {
  /** ordinary objective foe: chance of one coin */
  foeChance: 0.25,
  /** champion / rare / boss: coins dropped (in piles of up to pileMax) */
  champion: 3,
  rare: 6,
  boss: 15,
  /** a broken cursed cache spills this many */
  cache: 3,
  pileMax: 5,
  /** at most this many coin piles lie on the floor; more coins merge into the newest pile */
  maxPiles: 12,
  /** magnet pull toward the nearest living hero, touch radius, pop delay before a pile can be taken */
  magnetRange: 2.4,
  magnetSpeed: 9,
  touchRange: 0.5,
  popTicks: 12,
};

export const CURSED_COIN = { id: 'cursed_coin', name: 'Cursed coins', short: 'coins' };

export interface ShrineDef {
  id: string;
  name: string;
  /** one line for the prompt and the toast */
  short: string;
  /** buff seconds (0 = instant or floor-long) */
  sec: number;
  /** tone colour (#rrggbb) for the sprite glow, burst and HUD chip */
  color: string;
}

export const SHRINES: ShrineDef[] = [
  { id: 'fury', name: 'Shrine of Fury', short: '+30% damage for 30s', sec: 30, color: '#ff5a3a' },
  { id: 'haste', name: 'Shrine of Haste', short: '+25% speed, cooldowns ×1.4 faster for 30s', sec: 30, color: '#5ae0ff' },
  { id: 'warding', name: 'Shrine of Warding', short: 'Shield of 50% health, renewing for 20s', sec: 20, color: '#a8b8ff' },
  { id: 'fortune', name: 'Shrine of Fortune', short: 'Richer drops for the rest of this floor', sec: 0, color: '#ffd23f' },
  { id: 'renewal', name: 'Shrine of Renewal', short: 'Fully heals and cleanses the party', sec: 0, color: '#6aff8a' },
];
export const SHRINE_BY_ID: Record<string, ShrineDef> = Object.fromEntries(SHRINES.map((s) => [s.id, s]));

/** Shrine numbers (simulation roomEvents.ts). */
export const SHRINE_TUNING = {
  furyDamage: '1.3',
  hasteSpeed: 0.25,
  hasteRecovery: 1.4,
  /** on activation the remaining cooldowns shrink to this fraction */
  hasteCooldownCut: 0.6,
  wardShield: '0.5',
  /** while warded: +wardPulse of max health as shield every wardPulseSec */
  wardPulse: '0.1',
  wardPulseSec: 2,
  /** fortune: coin chance/value multiplier, extra potion-or-orb chance per kill, and an extra legendary roll */
  fortuneCoins: 2,
  fortunePickupChance: 0.2,
};

export interface PactDef {
  id: string;
  name: string;
  /** permanent gifts (percent changes, multiplicative like Fate effects). The relic pact draws its gift from a legendary. */
  gift: { stat: string; percent: string }[];
  /** permanent price on maximum health (percent, negative) */
  maxHealth?: string;
  /** immediate price: this fraction of current health is lost (never lethal) */
  bloodFrac?: number;
  /** the gift is a random legendary's stat lines, amplified (each line's bonus × RELIC_AMPLIFY) */
  relic?: boolean;
  flavor: string;
}

export const ALTAR_PACTS: PactDef[] = [
  { id: 'fury', name: 'Pact of Fury', gift: [{ stat: 'player.damage', percent: '25' }], maxHealth: '-15', flavor: 'Bleed a little. Hit a lot.' },
  { id: 'edge', name: 'Pact of the Keen Edge', gift: [{ stat: 'player.critTendency', percent: '50' }, { stat: 'player.critPotency', percent: '15' }], maxHealth: '-15', flavor: 'The altar hones what you offer it.' },
  { id: 'frenzy', name: 'Pact of Frenzy', gift: [{ stat: 'player.attackFrequency', percent: '18' }, { stat: 'player.movementSpeed', percent: '6' }], maxHealth: '-12', flavor: 'Your heart races. It will not stop.' },
  { id: 'relic', name: 'Relic Pact', gift: [], maxHealth: '-12', relic: true, flavor: 'A dead hero’s strength, worn deeper.' },
  { id: 'tithe', name: 'Blood Tithe', gift: [{ stat: 'player.damage', percent: '10' }], bloodFrac: 0.5, flavor: 'Pay now. Never again.' },
];
export const PACT_BY_ID: Record<string, PactDef> = Object.fromEntries(ALTAR_PACTS.map((p) => [p.id, p]));
/** Relic pact: a legendary line ×f binds as ×(1 + RELIC_AMPLIFY × (f − 1)) (×1.12 damage becomes ×1.30). */
export const RELIC_AMPLIFY = 2.5;

export interface WareDef {
  id: string;
  name: string;
  /** cursed coins */
  price: number;
  stock: number;
  short: string;
  /** permanent personal stat changes (percent) for 'boon' wares */
  mods?: { stat: string; percent: string }[];
  /** chance this ware is on the shelf (absent = always) */
  chance?: number;
}

/** Wares: the draught and a legendary always; two of the three run boons; the blessing sometimes. */
export const MERCHANT_WARES: WareDef[] = [
  { id: 'draught', name: 'Healing Draught', price: 8, stock: 3, short: 'Restore 50% health' },
  { id: 'tonic', name: 'Tonic of Vigor', price: 25, stock: 1, short: '+8% max health for the run', mods: [{ stat: 'player.maxHealth', percent: '8' }] },
  { id: 'whetstone', name: 'Cursed Whetstone', price: 25, stock: 1, short: '+6% damage for the run', mods: [{ stat: 'player.damage', percent: '6' }] },
  { id: 'oil', name: 'Quickening Oil', price: 25, stock: 1, short: '+6% attack speed for the run', mods: [{ stat: 'player.attackFrequency', percent: '6' }] },
  { id: 'legendary', name: 'Legendary', price: 70, stock: 1, short: 'Equip a legendary now' },
  { id: 'blessing', name: 'Fate’s Blessing', price: 120, stock: 1, short: 'Lift one Fate card’s price', chance: 0.35 },
];
export const WARE_BY_ID: Record<string, WareDef> = Object.fromEntries(MERCHANT_WARES.map((w) => [w.id, w]));
/** run boons the merchant may shelve (two of them per visit) */
export const MERCHANT_BOONS = ['tonic', 'whetstone', 'oil'] as const;
/** Healing Draught heal fraction of max health */
export const DRAUGHT_HEAL = '0.5';

export const MERCHANT = { name: 'Wandering Merchant', short: 'Trades wares for cursed coins' };

/** The treasure imp: a non-objective foe that never attacks (simulation roomEvents.ts moves it; the AI stands it still). */
export const TREASURE_IMP: EnemyDef = {
  id: 'loot_imp', name: 'Treasure Imp', role: 'skirmisher',
  description: 'A shiny loot imp with a bulging sack. It flees, spilling coins as it is hit, and portals away after a few seconds. Kill it for a shower of loot.',
  baseHealth: 900, baseDamage: 0, armor: 0, cost: 0, radius: 0.35, moveSpeed: 4.6, tags: [],
  perception: { sight: 14, hearing: 10, reactionTicks: 6 }, preferredRange: [6, 10],
  utility: {}, attacks: [], weaknesses: {},
};
export const RUNNER_KIND = TREASURE_IMP.id;

/** Content checks for the room events (validate.ts). */
export function validateRoomEvents(knownStat: (id: string) => boolean): string[] {
  const errs: string[] = [];
  for (const p of ALTAR_PACTS) {
    for (const g of p.gift) if (!knownStat(g.stat)) errs.push(`pact ${p.id}: unknown stat ${g.stat}`);
    if (!p.gift.length && !p.relic) errs.push(`pact ${p.id}: no gift`);
    if (!p.maxHealth && !p.bloodFrac) errs.push(`pact ${p.id}: no price`);
  }
  for (const w of MERCHANT_WARES) {
    if (!(w.price > 0) || !(w.stock > 0)) errs.push(`ware ${w.id}: price and stock must be positive`);
    for (const m of w.mods ?? []) if (!knownStat(m.stat)) errs.push(`ware ${w.id}: unknown stat ${m.stat}`);
  }
  for (const s of SHRINES) if (!/^#[0-9a-f]{6}$/i.test(s.color)) errs.push(`shrine ${s.id}: color must be #rrggbb`);
  return errs;
}
