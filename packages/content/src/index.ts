import { CARDS } from './cards';
import { MECHANICS } from './mechanics';
import { CLASSES, NODES, SKILLS, DODGE } from './classes';
import { ARENA_DESIGNS, BIOMES, BOSSES, BOSS_ARENAS, DUNGEON_LAYOUTS, ENEMIES, PACK_TEMPLATES, ROOM_KINDS, THEME_PACKS, THEME_ROOM_WEIGHTS } from './enemies';
import { AFFIXES, AFFIX_RULES } from './affixes';
import { LEGENDARIES, LOOT_RULES } from './legendaries';
import { CONSUMABLES, MAX_BLESSINGS, TRAINING_THEME } from './consumables';
import { canonicalJson, sha256Hex } from './hash';
import { AFFLICTION_RULES, CONTENT_VERSION, RULES, RULES_VERSION, SCORE_VERSION, SIM_VERSION } from './rules';
import { STATS } from './stats';

export * from './types';
export * from './stats';
export * from './cards';
export * from './mechanics';
export * from './classes';
export * from './enemies';
export * from './affixes';
export * from './legendaries';
export * from './consumables';
export * from './rules';
export * from './hash';
export * from './validate';

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
  dungeon: { layouts: DUNGEON_LAYOUTS, roomKinds: ROOM_KINDS, themeRooms: THEME_ROOM_WEIGHTS, arenas: ARENA_DESIGNS, bossArenas: BOSS_ARENAS },
  afflictionRules: AFFLICTION_RULES,
  legendaries: LEGENDARIES,
  lootRules: LOOT_RULES,
  // legendary consumables (Fate's Blessing) and the training grounds
  consumables: CONSUMABLES,
  maxBlessings: MAX_BLESSINGS,
  training: TRAINING_THEME,
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
