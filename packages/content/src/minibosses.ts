// Named mini-bosses (content 1.5; simulation minibosses.ts, spawn / health / loot tunables in RULES.miniBoss*).
// A mini-boss is a theme foe grown big, crowned and recoloured, with a generated name ("Grimtooth the Unbowed") and one
// or two signature mechanics drawn from MINIBOSS_MECHANICS. Names are built from theme-flavoured parts: a first part,
// a second part (joined into one word) and an epithet. Everything here is data; the simulation picks with its own
// seeded stream, so a run's mini-bosses are fixed by its seed.

export interface MiniBossNameParts {
  first: string[];
  second: string[];
  epithet: string[];
}

/** The dungeon-crawl pool every catacomb-family theme shares (themes add their own epithets below). */
const CRYPT: MiniBossNameParts = {
  first: ['Grim', 'Marrow', 'Rot', 'Gall', 'Vile', 'Ash', 'Mourn', 'Bile', 'Dread', 'Gloom', 'Skull', 'Murk'],
  second: ['tooth', 'gnaw', 'maw', 'hide', 'claw', 'bone', 'fang', 'gut', 'rend', 'spine'],
  epithet: ['the Unbowed', 'the Hollow', 'the Gravebound', 'the Pale', 'the Unburied', 'the Wretched', 'the Ever-Hungry'],
};

const withEpithets = (extra: string[]): MiniBossNameParts => ({ ...CRYPT, epithet: [...extra, ...CRYPT.epithet.slice(0, 3)] });

/** Name parts by dungeon theme (unknown themes use the catacomb pool). */
export const MINIBOSS_NAMES: Record<string, MiniBossNameParts> = {
  catacombs: CRYPT,
  flooded: withEpithets(['the Drowned', 'the Brackish', 'of the Black Water']),
  ossuary: withEpithets(['the Bone-Crowned', 'the Ossified', 'the Rattling']),
  sanctum: withEpithets(['the Bloodsworn', 'the Anointed', 'the Red Hand']),
  fungal: withEpithets(['the Sporeborn', 'the Mouldering', 'the Rootbound']),
  forge: withEpithets(['the Molten', 'the Ashen', 'the Slag-Born']),
  frost: withEpithets(['the Rimebound', 'the Frozen', 'the Winterheart']),
  sky: {
    first: ['Storm', 'Gale', 'Sky', 'Cloud', 'Thunder', 'Wind', 'Sun', 'Hail'],
    second: ['rend', 'talon', 'wing', 'cry', 'crest', 'howl', 'scream', 'plume'],
    epithet: ['the Windborne', 'the Skyrender', 'the Unfallen', 'the Stormcrowned', 'the Highborn', 'of the Long Fall'],
  },
  moon: {
    first: ['Crater', 'Void', 'Dust', 'Lun', 'Tide', 'Grey', 'Cold', 'Shard'],
    second: ['maw', 'eye', 'crawl', 'gnash', 'howl', 'spine', 'husk', 'wane'],
    epithet: ['the Lightless', 'the Earthwatcher', 'the Silent', 'the Waning', 'the Unbreathing', 'of the Far Side'],
  },
  server: {
    first: ['Null', 'Hex', 'Byte', 'Root', 'Kernel', 'Glitch', 'Loop', 'Zero'],
    second: ['fang', 'core', 'shard', 'worm', 'daemon', 'wire', 'spike', 'gate'],
    epithet: ['the Unpatched', 'the Recursive', 'the Corrupted', 'the Overclocked', 'the Undeleted', 'of the Deep Stack'],
  },
};

export type MiniBossMechanicId = 'slam' | 'summon' | 'enrage' | 'shield' | 'poison';

export interface MiniBossMechanicDef {
  id: MiniBossMechanicId;
  name: string;
  /** one terse line for the hover plate */
  short: string;
  /** fixed tunables read by the simulation (seconds, world units, fractions, damage coefficients) */
  params: Record<string, number>;
}

/** The signature mechanic pool (each mini-boss draws 1-2 distinct ones). Every damaging one is telegraphed. */
export const MINIBOSS_MECHANICS: MiniBossMechanicDef[] = [
  {
    id: 'slam', name: 'Ground Slam', short: 'Marks the ground around it, then slams: a shockwave shoves heroes away',
    params: { first: 3, every: 7.5, warn: 1.1, radius: 3.2, coef: 1.3, push: 1.2, trigger: 4.5 },
  },
  {
    id: 'summon', name: 'Call the Pack', short: 'Calls minions of its kind through summoning circles',
    params: { first: 4, every: 13, warn: 1.0, count: 2, maxAlive: 6, hp: 0.5, dmg: 0.7, trigger: 9 },
  },
  {
    id: 'enrage', name: 'Enrage', short: 'Below 40% health it moves and strikes faster',
    params: { below: 0.4, move: 1.3, attack: 1.35 },
  },
  {
    id: 'shield', name: 'Warded', short: 'At 70% and 35% health it is warded: no damage for a moment',
    params: { at1: 0.7, at2: 0.35, sec: 2.5 },
  },
  {
    id: 'poison', name: 'Venom Trail', short: 'Leaves poisonous puddles where it walks',
    params: { every: 0.45, radius: 0.85, sec: 3, coef: 0.3 },
  },
];

export const MINIBOSS_MECHANIC_BY_ID: Record<string, MiniBossMechanicDef> = Object.fromEntries(MINIBOSS_MECHANICS.map((m) => [m.id, m]));

/** Roles that never become a mini-boss: tiny swarm units and summons read badly at mini-boss scale, and shield-wall
 *  guardians (frontal plate) turn into damage sponges. */
export const MINIBOSS_EXCLUDED_ROLES = ['swarm', 'summon', 'guardian'];

/** Display name of a mini-boss from its name parts (indices are taken modulo the pool sizes). */
export function miniBossName(theme: string, a: number, b: number, c: number): string {
  const n = MINIBOSS_NAMES[theme] ?? CRYPT;
  const first = n.first[((a % n.first.length) + n.first.length) % n.first.length];
  const second = n.second[((b % n.second.length) + n.second.length) % n.second.length];
  const epi = n.epithet[((c % n.epithet.length) + n.epithet.length) % n.epithet.length];
  return `${first}${second} ${epi}`;
}
