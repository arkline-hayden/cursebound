import { BOUNTY_XP_MULTIPLIER } from './progression';

// Daily bounty modifiers. Once a day the backend rolls one of these negative modifiers (never the same one twice in a
// row); a run started with "Take the bounty" carries it for its whole length, and the first such run an account
// finishes that day earns double XP (progression.ts BOUNTY_XP_MULTIPLIER).
//
// Each modifier is data the simulation applies deterministically at run creation (simulation/src/bounty.ts):
//  - `stats`: Fate-style stat factors bound before round 1 (X × (1 + p/100)), shown in the Ledger as the bounty's;
//  - `mechanics`: banes from mechanics.ts bound once at the given magnitude, exactly as a card's bane;
//  - `rules`: small rule switches read by the simulation (see BountyRules).
// Part of the content manifest, so a run's modifier is pinned by its content hash and replays reproduce it.

export interface BountyRules {
  /** no healing potions or haste orbs drop from foes */
  noPickups?: boolean;
  /** maximum dodge charges (DODGE.charges otherwise) */
  dodgeCharges?: number;
  /** multiplies the bleed-out timer of a downed hero (RULES.downedSec) */
  downedSecFactor?: number;
  /** multiplies the revive channel time (RULES.reviveChannelSec) */
  reviveChannelFactor?: number;
  /** each chosen Fate card's price (its negative stat and its bane) is applied this many times */
  fatePriceCopies?: number;
  /** multiplies the between-rounds heal (RULES.intermissionHealFrac); 0 = none */
  intermissionHealFactor?: number;
}

export interface BountyModifierDef {
  id: string;
  name: string;
  /** one-line effect for the title-screen plaque */
  short: string;
  description: string;
  color: string;
  stats?: { stat: string; percent: string }[];
  mechanics?: { id: string; magnitude: string }[];
  rules?: BountyRules;
}

/** A bounty lasts this long before the polled job rerolls it. */
export const BOUNTY_PERIOD_MS = 24 * 3600 * 1000;
/** How often the backends check whether the bounty is due for a reroll. */
export const BOUNTY_POLL_MS = 60 * 1000;
/** A bounty run still counts for its bounty if it is reported up to this long after that bounty expired. */
export const BOUNTY_GRACE_MS = 6 * 3600 * 1000;

const b = (def: BountyModifierDef) => def;

export const BOUNTY_MODIFIERS: BountyModifierDef[] = [
  // ---- the horde grows stronger ----
  b({ id: 'ironhide', name: 'Ironhide Horde', short: 'Foes have +30% health', color: '#b8a48a',
    description: 'Every foe and boss has 30% more maximum health.', stats: [{ stat: 'enemy.maxHealth', percent: '30' }] }),
  b({ id: 'quickened', name: 'Quickened Dead', short: 'Foes move 20% faster', color: '#e0c24a',
    description: 'Every foe moves 20% faster, charges included.', stats: [{ stat: 'enemy.movementSpeed', percent: '20' }] }),
  b({ id: 'frenzied', name: 'Frenzied Horde', short: 'Foes attack 20% faster', color: '#ff7a3a',
    description: 'Every foe winds up, strikes and recovers 20% faster.', stats: [{ stat: 'enemy.attackFrequency', percent: '20' }] }),
  b({ id: 'teeming', name: 'Teeming Depths', short: '+30% foes in every pack', color: '#c86a3a',
    description: 'Every spawn cohort carries 30% more foes.', stats: [{ stat: 'encounter.spawnQuantity', percent: '30' }] }),
  b({ id: 'champions', name: "Champions' Muster", short: 'Elites twice as common', color: '#ffd76a',
    description: 'Elite intensity is doubled: champions and rares lead far more packs.', stats: [{ stat: 'encounter.eliteChance', percent: '100' }] }),
  b({ id: 'hailstorm', name: 'Hail of Spite', short: 'Foe projectiles fly 40% faster', color: '#9fd0ff',
    description: 'Enemy bolts, spit and arrows fly 40% faster.', stats: [{ stat: 'enemy.projectileSpeed', percent: '40' }] }),
  // ---- the heroes grow weaker ----
  b({ id: 'fragile', name: 'Fragile Flesh', short: 'Heroes take +20% damage', color: '#ff5a6a',
    description: 'All enemy damage, hazards included, hits 20% harder.', stats: [{ stat: 'enemy.damage', percent: '20' }] }),
  b({ id: 'withered', name: 'Withered Vessels', short: 'Heroes have −20% max health', color: '#a05a7a',
    description: 'Every hero starts with 20% less maximum health.', stats: [{ stat: 'player.maxHealth', percent: '-20' }] }),
  b({ id: 'sluggish', name: 'Leaden Mind', short: 'Cooldowns take 25% longer', color: '#6a8aff',
    description: 'Skill and dodge cooldowns recover 20% slower, so each takes 25% longer.', stats: [{ stat: 'player.recoveryRate', percent: '-20' }] }),
  b({ id: 'enfeebled', name: 'Enfeebled', short: 'Heroes deal −20% damage', color: '#8a8a9a',
    description: 'Every hero deals 20% less damage.', stats: [{ stat: 'player.damage', percent: '-20' }] }),
  b({ id: 'thin_blood', name: 'Thin Blood', short: 'Healing received −40%', color: '#d04a5a',
    description: 'All healing heroes receive is 40% weaker.', stats: [{ stat: 'player.healing', percent: '-40' }] }),
  // ---- curses (banes bound from round 1) ----
  b({ id: 'volatile', name: 'Volatile Dead', short: 'Slain foes leave burning pools', color: '#ff6a2a',
    description: 'The Volatile Dead bane is bound from the first round.', mechanics: [{ id: 'volatile_dead', magnitude: '0.05' }] }),
  b({ id: 'hexed', name: 'Hexed Ground', short: 'Curse circles erupt under heroes', color: '#9b5cff',
    description: 'The Hexed Ground bane is bound from the first round.', mechanics: [{ id: 'hexed_ground', magnitude: '0.2' }] }),
  b({ id: 'relentless', name: 'Relentless', short: 'Wounded foes enrage', color: '#ff3d3d',
    description: 'The Relentless bane is bound from the first round.', mechanics: [{ id: 'relentless', magnitude: '0.4' }] }),
  b({ id: 'hunted', name: 'The Hunt', short: 'A deathless Reaper stalks the party', color: '#b8b0c8',
    description: 'The Hunt bane is bound from the first round.', mechanics: [{ id: 'the_hunt', magnitude: '0.25' }] }),
  b({ id: 'blood_moon', name: 'Blood Moon', short: 'Foe damage climbs through each fight', color: '#ff2a55',
    description: 'The Blood Moon bane is bound from the first round.', mechanics: [{ id: 'blood_moon', magnitude: '0.12' }] }),
  b({ id: 'brittle', name: 'Brittle Bones', short: 'The first hit after a dodge hurts more', color: '#c6e6ff',
    description: 'The Brittle bane is bound from the first round.', mechanics: [{ id: 'brittle', magnitude: '0.5' }] }),
  // ---- rule changes ----
  b({ id: 'barren', name: 'Barren Halls', short: 'No potions or haste orbs drop', color: '#7a6a5a',
    description: 'Foes drop no healing potions and no haste orbs.', rules: { noPickups: true } }),
  b({ id: 'hobbled', name: 'Hobbled', short: 'Half the dodge charges', color: '#5ac8c8',
    description: 'Heroes hold one dodge charge instead of two.', rules: { dodgeCharges: 1 } }),
  b({ id: 'spite', name: "Fate's Spite", short: 'Every Fate card’s price is paid twice', color: '#e0315a',
    description: 'Each chosen Fate card applies its price (negative stat and bane) twice; its gift once.', rules: { fatePriceCopies: 2 } }),
  b({ id: 'swift_death', name: 'Swift Death', short: 'Downed heroes bleed out twice as fast', color: '#8a1a2a',
    description: 'Downed heroes bleed out in half the time and revives take 50% longer.', rules: { downedSecFactor: 0.5, reviveChannelFactor: 1.5 } }),
  b({ id: 'no_respite', name: 'No Respite', short: 'No healing between rounds', color: '#5a4a6a',
    description: 'Clearing a floor no longer heals the party.', rules: { intermissionHealFactor: 0 } }),
];

export const BOUNTY_BY_ID: Record<string, BountyModifierDef> = Object.fromEntries(BOUNTY_MODIFIERS.map((m) => [m.id, m]));

/** Ledger / provenance id of a bounty's effects ("cards" applied before round 1). */
export const bountyCardId = (modifierId: string) => `bounty:${modifierId}`;

/** A bounty run marks the bounty completed (and earns the double XP) only after clearing at least this many rounds. */
export const BOUNTY_MIN_DEPTH = 1;

/** Roll the next bounty: uniform over the list, never the previous modifier. `random` returns [0, 1). */
export function pickBountyModifier(previousId: string | null, random: () => number = Math.random): string {
  const pool = BOUNTY_MODIFIERS.map((m) => m.id).filter((id) => id !== previousId);
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/** Every modifier id in a uniformly random order (Fisher-Yates). A backend rolls by taking the first one that differs
 *  from the previous bounty inside its roll transaction, which is uniform over the rest and never a repeat. */
export function shuffledBountyIds(random: () => number = Math.random): string[] {
  const ids = BOUNTY_MODIFIERS.map((m) => m.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

/** The bounty as both backends serve it (`GET /api/v1/bounty`, `GET /api/v1/local/bounty`). */
export interface BountyView {
  id: string;
  modifier: { id: string; name: string; short: string; description: string; color: string };
  createdAt: number;
  expiresAt: number;
  /** the server clock when answering, so clients can run the countdown against server time */
  serverNow: number;
  /** null when the caller is unknown (signed out) */
  completed: boolean | null;
  xpMultiplier: number;
}

export function bountyView(b: { id: string; modifierId: string; createdAt: number; expiresAt: number }, completed: boolean | null, now: number, xpMultiplier = BOUNTY_XP_MULTIPLIER): BountyView {
  const m = BOUNTY_BY_ID[b.modifierId];
  return {
    id: b.id,
    modifier: m ? { id: m.id, name: m.name, short: m.short, description: m.description, color: m.color } : { id: b.modifierId, name: b.modifierId, short: '', description: '', color: '#888888' },
    createdAt: b.createdAt, expiresAt: b.expiresAt, serverNow: now, completed, xpMultiplier,
  };
}
