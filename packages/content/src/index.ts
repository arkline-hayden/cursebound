import { CARDS } from './cards';
import { MECHANICS } from './mechanics';
import { CLASSES, NODES, SKILLS, DODGE } from './classes';
import { ARENA_DESIGNS, BIOMES, BOSSES, BOSS_ARENAS, DUNGEON_LAYOUTS, ENEMIES, PACK_TEMPLATES, ROOM_KINDS, THEME_BOSSES, THEME_PACKS, THEME_ROOM_WEIGHTS } from './enemies';
import { AFFIXES, AFFIX_RULES } from './affixes';
import { LEGENDARIES, LOOT_RULES } from './legendaries';
import { CONSUMABLES, MAX_BLESSINGS, TRAINING_THEME } from './consumables';
import { canonicalJson, sha256Hex } from './hash';
import { AFFLICTION_RULES, CONTENT_VERSION, KNOCKBACK_RULES, RULES, RULES_VERSION, SCORE_VERSION, SIM_VERSION } from './rules';
import { STATS } from './stats';
import { BOUNTY_MODIFIERS } from './bounties';
import { ALTAR_PACTS, COIN_RULES, MERCHANT_WARES, RELIC_AMPLIFY, ROOM_EVENT_RULES, SHRINES, SHRINE_TUNING } from './roomEvents';
import { MINIBOSS_MECHANICS, MINIBOSS_NAMES } from './minibosses';
import { SKY_FALL } from './bosses/skyDrake';

export * from './types';
export * from './stats';
export * from './cards';
export * from './mechanics';
export * from './classes';
export * from './enemies';
export { SLAG_PATTERNS, slagLava } from './bosses/ironColossus';
export { SKY_FALL } from './bosses/skyDrake';
export * from './affixes';
export * from './legendaries';
export * from './consumables';
export * from './rules';
export * from './hash';
export * from './validate';
export * from './progression';
export * from './bounties';
export * from './roomEvents';
export * from './minibosses';

/** The immutable content manifest (PRD §15.3, §21.2). Its hash pins runs, rooms and leaderboards. */
export const CONTENT_MANIFEST = {
  contentVersion: CONTENT_VERSION,
  rulesVersion: RULES_VERSION,
  scoreVersion: SCORE_VERSION,
  simVersion: SIM_VERSION,
  rules: RULES,
  dodge: DODGE,
  stats: STATS,
  cards: CARDS,
  mechanics: MECHANICS,
  classes: CLASSES,
  nodes: NODES,
  skills: SKILLS,
  enemies: ENEMIES,
  bosses: BOSSES,
  biomes: BIOMES,
  affixes: AFFIXES,
  affixRules: AFFIX_RULES,
  packs: PACK_TEMPLATES,
  themePacks: THEME_PACKS,
  dungeon: { layouts: DUNGEON_LAYOUTS, roomKinds: ROOM_KINDS, themeRooms: THEME_ROOM_WEIGHTS, arenas: ARENA_DESIGNS, bossArenas: BOSS_ARENAS, themeBosses: THEME_BOSSES },
  afflictionRules: AFFLICTION_RULES,
  // impact knockback (heavy hits, slams, blasts, crits): per damage type / per skill pushes and elite factors
  knockbackRules: KNOCKBACK_RULES,
  legendaries: LEGENDARIES,
  lootRules: LOOT_RULES,
  // legendary consumables (Fate's Blessing) and the training grounds
  consumables: CONSUMABLES,
  maxBlessings: MAX_BLESSINGS,
  training: TRAINING_THEME,
  // daily bounty modifiers (bounties.ts): a bounty run applies one at creation, so they are pinned with the content
  bounties: BOUNTY_MODIFIERS,
  // room events (roomEvents.ts): shrines, cursed altar pacts, merchant wares, treasure imp and cursed coin tuning
  roomEvents: { rules: ROOM_EVENT_RULES, coins: COIN_RULES, shrines: SHRINES, shrineTuning: SHRINE_TUNING, pacts: ALTAR_PACTS, relicAmplify: RELIC_AMPLIFY, wares: MERCHANT_WARES },
  // named mini-bosses (minibosses.ts): name parts and signature mechanics (spawn, health and loot tunables are RULES)
  miniBosses: { names: MINIBOSS_NAMES, mechanics: MINIBOSS_MECHANICS },
  // scripted bosses' shared rules (each boss's adds, loot and params live on its BossDef): the Gale Wyrm's long fall
  bossRules: { skyFall: SKY_FALL },
};

let cachedHash: string | null = null;
export function contentHash(): string {
  if (!cachedHash) cachedHash = sha256Hex(canonicalJson(CONTENT_MANIFEST)).slice(0, 32);
  return cachedHash;
}

/** The versioned run deck: fixed at run creation (REQ FATE01). */
export function defaultDeck(): string[] {
  return CARDS.map((c) => c.id);
}
