/**
 * Asset manifest (PRD §15.3): every procedural asset ID (Sunken Catacombs theme) with provenance/license/version/tags/review
 * status. The generator source module is the editable source asset. Must not import Phaser or touch
 * the DOM: it is consumed by the Node CLI `tools/assets/src/validate.ts`.
 */
import { SFX_IDS } from '../audio/sfx';
import { CARD_IDS, EXTRA_CARD_FAMILIES, NODE_IDS, STAT_NAMES, CLASS_IDS, MECH_IDS, hasCardIcon, hasNodeIcon, hasMechIcon, registerIconContent, registerMechanics, type IconContent } from '../../ui/icons/iconData';
import { ACTOR_IDS, ACTOR_META, actorDirs, actorStateSpecs, isHeroActor, type ActorId } from './actors';
import { DECALS, DUNGEON_TEXTURE_KEYS, PROPS, STORY_DECALS } from './dungeonData';
import { THEME_DRESSING, VIGNETTES, dressingDecalKeys, dressingPropIds } from './vignettes';
import { THEME_ART, THEME_IDS } from './dungeonThemes';
import { ISO_FRAMES, ISO_TEXTURE_KEYS, isoKeys } from './isoTerrain';
import { ATMO_KEYS } from './atmosphere';
import { EFFECT_KEYS, effectSpecs } from './effects';
import { TILE_FRAMES } from './tiles';

export interface AssetEntry {
  id: string;
  kind: 'sprite' | 'tileset' | 'effect' | 'icon' | 'audio';
  source: string;
  provenance: 'procedural';
  author: 'CURSEBOUND procedural generator';
  license: 'Project-owned (generated)';
  version: string;
  tags: string[];
  reviewStatus: 'draft' | 'reviewed';
  states?: string[];
}

/** Bump when generator output changes in a way that matters for content hashes. */
export const ART_VERSION = '2.0.0';

const BASE = {
  provenance: 'procedural' as const,
  author: 'CURSEBOUND procedural generator' as const,
  license: 'Project-owned (generated)' as const,
  version: ART_VERSION,
  reviewStatus: 'draft' as const,
};

const ACTOR_SOURCE: Record<ActorId, string> = {
  vanguard: 'apps/client/src/game/art/draw/humanoid.ts',
  arcanist: 'apps/client/src/game/art/draw/humanoid.ts',
  duelist: 'apps/client/src/game/art/draw/humanoid.ts',
  hexbinder: 'apps/client/src/game/art/draw/humanoid.ts',
  artificer: 'apps/client/src/game/art/draw/humanoid.ts',
  templar: 'apps/client/src/game/art/draw/humanoid.ts',
  berserker: 'apps/client/src/game/art/draw/humanoid.ts',
  cryomancer: 'apps/client/src/game/art/draw/humanoid.ts',
  ranger: 'apps/client/src/game/art/draw/humanoid.ts',
  warden: 'apps/client/src/game/art/draw/humanoid.ts',
  pursuer: 'apps/client/src/game/art/draw/creatures.ts',
  skirmisher: 'apps/client/src/game/art/draw/creatures.ts',
  artillery: 'apps/client/src/game/art/draw/creatures.ts',
  guardian: 'apps/client/src/game/art/draw/creatures.ts',
  hexer: 'apps/client/src/game/art/draw/creatures.ts',
  broodcaller: 'apps/client/src/game/art/draw/creatures.ts',
  mite: 'apps/client/src/game/art/draw/creatures.ts',
  prismstag: 'apps/client/src/game/art/draw/bosses.ts',
  bellroot: 'apps/client/src/game/art/draw/bosses.ts',
  spiritwolf: 'apps/client/src/game/art/draw/creatures.ts',
  spiritbear: 'apps/client/src/game/art/draw/creatures.ts',
  spiritelk: 'apps/client/src/game/art/draw/creatures.ts',
  gaoler: 'apps/client/src/game/art/draw/creatures.ts',
  rimewraith: 'apps/client/src/game/art/draw/creatures.ts',
  gloomshade: 'apps/client/src/game/art/draw/creatures.ts',
  webweaver: 'apps/client/src/game/art/draw/creatures.ts',
  // theme foes (content 1.5)
  harpy: 'apps/client/src/game/art/draw/themeFoes.ts',
  galewisp: 'apps/client/src/game/art/draw/themeFoes.ts',
  stormhawk: 'apps/client/src/game/art/draw/themeFoes.ts',
  cloudgolem: 'apps/client/src/game/art/draw/themeFoes.ts',
  mooncrawler: 'apps/client/src/game/art/draw/themeFoes.ts',
  moonleaper: 'apps/client/src/game/art/draw/themeFoes.ts',
  lunarsentry: 'apps/client/src/game/art/draw/themeFoes.ts',
  voidshambler: 'apps/client/src/game/art/draw/themeFoes.ts',
  maintdrone: 'apps/client/src/game/art/draw/themeFoes.ts',
  firewall: 'apps/client/src/game/art/draw/themeFoes.ts',
  glitchwraith: 'apps/client/src/game/art/draw/themeFoes.ts',
  malware: 'apps/client/src/game/art/draw/themeFoes.ts',
};

/** Display names in the Sunken Catacombs theme (ids are stable). */
export const ACTOR_DISPLAY_NAME: Record<ActorId, string> = {
  vanguard: 'Vanguard',
  arcanist: 'Arcanist',
  duelist: 'Duelist',
  hexbinder: 'Hexbinder',
  artificer: 'Artificer',
  templar: 'Templar',
  berserker: 'Berserker',
  cryomancer: 'Cryomancer',
  ranger: 'Ranger',
  warden: 'Warden',
  pursuer: 'Ghoul Hound',
  skirmisher: 'Gloom Bat',
  artillery: 'Bile Toad',
  guardian: 'Bonewarden',
  hexer: 'Hex Cultist',
  broodcaller: 'Brood Sac',
  mite: 'Carrion Mite',
  prismstag: 'The Hollow Stag',
  bellroot: 'The Bell Golem',
  spiritwolf: 'Spirit Wolf',
  spiritbear: 'Spirit Ursa',
  spiritelk: 'Wild Hunt Elk',
  gaoler: 'Gaoler',
  rimewraith: 'Rime Wraith',
  gloomshade: 'Gloom Shade',
  webweaver: 'Web Weaver',
  // theme foes (content 1.5)
  harpy: 'Harpy Diver',
  galewisp: 'Gale Wisp',
  stormhawk: 'Storm-Hawk',
  cloudgolem: 'Cloud Golem',
  mooncrawler: 'Moon-spawn Crawler',
  moonleaper: 'Lunar Leaper',
  lunarsentry: 'Lunar Sentry',
  voidshambler: 'Void-Eyed Shambler',
  maintdrone: 'Maintenance Drone',
  firewall: 'Firewall Sentinel',
  glitchwraith: 'Glitch Wraith',
  malware: 'Malware Swarm',
};

const ACTOR_ROLE: Record<ActorId, string> = {
  vanguard: 'player-class',
  arcanist: 'player-class',
  duelist: 'player-class',
  hexbinder: 'player-class',
  artificer: 'player-class',
  templar: 'player-class',
  berserker: 'player-class',
  cryomancer: 'player-class',
  ranger: 'player-class',
  warden: 'player-class',
  pursuer: 'enemy',
  skirmisher: 'enemy',
  artillery: 'enemy',
  guardian: 'enemy',
  hexer: 'enemy',
  broodcaller: 'enemy',
  mite: 'summon',
  prismstag: 'boss',
  bellroot: 'boss',
  spiritwolf: 'companion',
  spiritbear: 'companion',
  spiritelk: 'companion',
  gaoler: 'enemy',
  rimewraith: 'enemy',
  gloomshade: 'enemy',
  webweaver: 'enemy',
  harpy: 'enemy',
  galewisp: 'enemy',
  stormhawk: 'enemy',
  cloudgolem: 'enemy',
  mooncrawler: 'enemy',
  moonleaper: 'enemy',
  lunarsentry: 'enemy',
  voidshambler: 'enemy',
  maintdrone: 'enemy',
  firewall: 'enemy',
  glitchwraith: 'enemy',
  malware: 'enemy',
};

function buildManifest(): AssetEntry[] {
  const out: AssetEntry[] = [];
  for (const id of ACTOR_IDS) {
    const m = ACTOR_META[id];
    out.push({
      ...BASE,
      id: `actor:${id}`,
      kind: 'sprite',
      source: ACTOR_SOURCE[id],
      tags: ['catacombs', ACTOR_ROLE[id], `name:${ACTOR_DISPLAY_NAME[id]}`, `${m.frameW}x${m.frameH}`, `dirs:${actorDirs(id).join(',')}`],
      states: [...m.states],
      reviewStatus: 'reviewed',
    });
  }
  out.push({
    ...BASE,
    id: 'tiles:prismwood',
    kind: 'tileset',
    source: 'apps/client/src/game/art/tiles.ts',
    tags: ['prismwood', '32x32', `frames:${TILE_FRAMES.total}`, 'autotile'],
    reviewStatus: 'reviewed',
  });
  out.push({ ...BASE, id: 'bg:prismwood', kind: 'tileset', source: 'apps/client/src/game/art/dungeon.ts', tags: ['alias:bg:catacombs', 'backdrop', '480x270'] });
  const propKeys = new Set(Object.values(PROPS).map((p) => p.key));
  const decalKeys = new Set<string>([DECALS.blood, DECALS.scorch, DECALS.ichor, DECALS.slime, ...DECALS.grime, ...Object.values(STORY_DECALS)]);
  const glowKeys = new Set(Object.values(PROPS).map((p) => p.glowKey).filter((k): k is string => !!k));
  for (const key of DUNGEON_TEXTURE_KEYS) {
    const critter = key.startsWith('critter:'), ambient = key.startsWith('amb:');
    const kind: AssetEntry['kind'] = propKeys.has(key) || glowKeys.has(key) || critter ? 'sprite' : decalKeys.has(key) || ambient ? 'effect' : 'tileset';
    const tags = ['catacombs'];
    if (critter) tags.push('critter', 'ambient', 'cosmetic');
    if (ambient) tags.push('ambient', 'tintable');
    if (glowKeys.has(key)) tags.push('glow-layer', 'unlit');
    if ((Object.values(STORY_DECALS) as string[]).includes(key)) tags.push('story');
    if (key === 'dungeon:wall') tags.push('32x64', '2.5D', 'cap+face');
    if (key === 'dungeon:floor' || key === 'dungeon:void') tags.push('32x32');
    if (propKeys.has(key)) {
      const prop = Object.values(PROPS).find((p) => p.key === key);
      tags.push('prop', `placement:${prop?.placement ?? 'floor'}`);
      if (prop?.light) tags.push('light');
      if (prop?.blocks) tags.push('blocks');
    }
    if (decalKeys.has(key)) tags.push('decal', key === DECALS.blood || key === DECALS.ichor ? 'tintable' : 'colored');
    out.push({ ...BASE, id: key, kind, source: 'apps/client/src/game/art/dungeonData.ts', tags });
  }
  // native 2:1 isometric terrain (per theme): colour sheets, emissive companions and Light2D normal maps
  const isoPart = (key: string): keyof typeof ISO_FRAMES => {
    const kind = key.split(':')[1]!;
    return kind === 'floorglow' ? 'floor' : kind === 'decoglow' ? 'deco' : kind === 'wallglow' ? 'wall' : kind === 'roomglow' ? 'room' : (kind as keyof typeof ISO_FRAMES);
  };
  for (const id of ISO_TEXTURE_KEYS) {
    const normal = id.endsWith(':n');
    const base = normal ? id.slice(0, -2) : id;
    const part = isoPart(base);
    const spec = ISO_FRAMES[part];
    const theme = base.split(':')[2]!;
    const tags = ['iso', '2:1', theme, `iso-${part}`, `${spec.w}x${spec.h}`, `frames:${spec.frames}`];
    if (normal) tags.push('normal-map', 'light2d', `for:${base}`);
    if (base.includes('glow:')) tags.push('emissive', 'unlit', 'additive');
    out.push({ ...BASE, id, kind: 'tileset', source: 'apps/client/src/game/art/isoTerrain.ts', tags });
  }
  for (const id of Object.values(ATMO_KEYS)) out.push({ ...BASE, id, kind: 'effect', source: 'apps/client/src/game/art/atmosphere.ts', tags: ['atmosphere', 'tintable', id === ATMO_KEYS.grade ? 'screen-grade' : 'additive'] });
  for (const e of effectSpecs()) {
    out.push({
      ...BASE,
      id: e.key,
      kind: 'effect',
      source: 'apps/client/src/game/art/effects.ts',
      tags: [`${e.frameW}x${e.frameH}`, `frames:${e.frames}`, e.loop ? 'loop' : 'one-shot', ...(e.key.startsWith('fx:') ? [] : ['tintable'])],
    });
  }
  for (const id of [...CARD_IDS, ...Object.keys(EXTRA_CARD_FAMILIES)]) out.push({ ...BASE, id: `icon:card:${id}`, kind: 'icon', source: 'apps/client/src/ui/icons/iconData.ts', tags: ['card', '16x16'] });
  for (const id of NODE_IDS) out.push({ ...BASE, id: `icon:node:${id}`, kind: 'icon', source: 'apps/client/src/ui/icons/iconData.ts', tags: ['node', '16x16'] });
  for (const id of CLASS_IDS) out.push({ ...BASE, id: `icon:class:${id}`, kind: 'icon', source: 'apps/client/src/ui/icons/iconData.ts', tags: ['class', '16x16'] });
  // content-driven icons: every card / node / skill in the content package gets a generated icon
  out.push({ ...BASE, id: 'icon:card:*', kind: 'icon', source: 'apps/client/src/ui/icons/iconData.ts', tags: ['card', '16x16', 'data-driven', 'family+rarity'] });
  out.push({ ...BASE, id: 'icon:node:*', kind: 'icon', source: 'apps/client/src/ui/icons/iconData.ts', tags: ['node', '16x16', 'data-driven', 'branch+kind+tier'] });
  for (const id of MECH_IDS) out.push({ ...BASE, id: `icon:mech:${id}`, kind: 'icon', source: 'apps/client/src/ui/icons/iconData.ts', tags: ['mechanic', '16x16'] });
  out.push({ ...BASE, id: 'icon:mech:*', kind: 'icon', source: 'apps/client/src/ui/icons/iconData.ts', tags: ['mechanic', '16x16', 'data-driven', 'boon/bane'] });
  for (const id of STAT_NAMES) out.push({ ...BASE, id: `icon:stat:${id}`, kind: 'icon', source: 'apps/client/src/ui/icons/iconData.ts', tags: ['stat', '16x16'] });
  for (const id of SFX_IDS) out.push({ ...BASE, id: `sfx:${id}`, kind: 'audio', source: 'apps/client/src/game/audio/AudioEngine.ts', tags: ['sfx', 'synth'] });
  for (const t of ['menu', 'combat', 'boss']) {
    out.push({ ...BASE, id: `music:${t}`, kind: 'audio', source: 'apps/client/src/game/audio/AudioEngine.ts', tags: ['music', 'sequenced', t === 'combat' ? 'intensity-layers' : 'loop'] });
  }
  return out;
}

export const ASSET_MANIFEST: AssetEntry[] = buildManifest();

/** Required effect keys from the art contract. */
export const REQUIRED_EFFECTS: readonly string[] = [
  'fx:spark', 'fx:arc', 'fx:shard', 'fx:lob', 'fx:orb', 'fx:wave', 'fx:slash', 'fx:slam', 'fx:nova', 'fx:hit', 'fx:crit', 'fx:heal',
  'fx:shield', 'fx:burn', 'fx:mote', 'fx:revive', 'fx:teleport', 'fx:spawn', 'fx:death', 'fx:pool', 'fx:lightpool', 'fx:root', 'fx:flame', 'fx:field',
  'fx:potion:health', 'fx:globe:health', 'fx:globe:resource', 'fx:elite:ring',
];

/** Required dungeon / lighting / particle assets (Sunken Catacombs spec). */
export const REQUIRED_DUNGEON: readonly string[] = ['dungeon:floor', 'dungeon:wall', 'dungeon:void', 'bg:catacombs', 'bg:prismwood'];
export const REQUIRED_PROPS: readonly string[] = [
  'torch', 'brazier', 'candles', 'bones', 'skullpile', 'barrel', 'crate', 'chains', 'cobweb', 'grate', 'rubble', 'banner', 'pillar',
  // themed props
  'puddle', 'beam', 'skullwall', 'bonepile2', 'coffin', 'ritual', 'goldcandles', 'altar', 'shroom', 'roots', 'lavacrack', 'anvil',
  'icicles', 'icecrystal', 'snowpile', 'sarcophagus',
];
export const REQUIRED_PFX: readonly string[] = [
  'light:soft', 'light:cone', 'pfx:spark', 'pfx:streak', 'pfx:ember', 'pfx:dust', 'pfx:drop', 'pfx:shard', 'pfx:smoke', 'pfx:ring', 'pfx:flash', 'pfx:slashArc',
  'pfx:snow', 'pfx:spore', 'pfx:drip',
];

/** Required actor states from the art contract (minimum set). */
const REQUIRED_STATES: Record<ActorId, string[]> = {
  vanguard: ['idle', 'run', 'attack', 'cast', 'dodge', 'hit', 'downed', 'revive', 'death'],
  arcanist: ['idle', 'run', 'attack', 'cast', 'dodge', 'hit', 'downed', 'revive', 'death'],
  duelist: ['idle', 'run', 'attack', 'cast', 'dodge', 'hit', 'downed', 'revive', 'death'],
  hexbinder: ['idle', 'run', 'attack', 'cast', 'dodge', 'hit', 'downed', 'revive', 'death'],
  artificer: ['idle', 'run', 'attack', 'cast', 'dodge', 'hit', 'downed', 'revive', 'death'],
  templar: ['idle', 'run', 'attack', 'cast', 'dodge', 'hit', 'downed', 'revive', 'death'],
  berserker: ['idle', 'run', 'attack', 'cast', 'dodge', 'hit', 'downed', 'revive', 'death'],
  cryomancer: ['idle', 'run', 'attack', 'cast', 'dodge', 'hit', 'downed', 'revive', 'death'],
  ranger: ['idle', 'run', 'attack', 'cast', 'dodge', 'hit', 'downed', 'revive', 'death'],
  warden: ['idle', 'run', 'attack', 'cast', 'dodge', 'hit', 'downed', 'revive', 'death'],
  pursuer: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  skirmisher: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  artillery: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  guardian: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  hexer: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  broodcaller: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  mite: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  prismstag: ['idle', 'run', 'windup', 'attack', 'stagger', 'death'],
  bellroot: ['idle', 'windup', 'attack', 'stagger', 'death'],
  spiritwolf: ['idle', 'run', 'attack', 'death'],
  spiritbear: ['idle', 'run', 'attack', 'death'],
  spiritelk: ['idle', 'run', 'attack', 'death'],
  gaoler: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  rimewraith: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  gloomshade: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  webweaver: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  harpy: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  galewisp: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  stormhawk: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  cloudgolem: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  mooncrawler: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  moonleaper: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  lunarsentry: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  voidshambler: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  maintdrone: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  firewall: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  glitchwraith: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
  malware: ['idle', 'run', 'windup', 'attack', 'hit', 'death'],
};

/** Minimum frame counts from the art contract. */
const MIN_FRAMES: Record<string, Record<string, number>> = {
  hero: { idle: 4, run: 10, attack: 8, cast: 6, dodge: 4, hit: 2, downed: 2, revive: 4, death: 6 },
  enemy: { idle: 4, run: 6, windup: 4, attack: 4, hit: 2, death: 6 },
  companion: { idle: 4, run: 6, attack: 4, death: 6 },
  mite: { idle: 2, run: 4, windup: 2, attack: 2, hit: 1, death: 4 },
  prismstag: { idle: 4, run: 6, windup: 4, attack: 6, stagger: 3, death: 8 },
  bellroot: { idle: 4, windup: 4, attack: 6, stagger: 3, death: 8 },
};

function frameClass(id: ActorId): string {
  if (isHeroActor(id)) return 'hero';
  if (id === 'mite' || id === 'prismstag' || id === 'bellroot') return id;
  if (id === 'spiritwolf' || id === 'spiritbear' || id === 'spiritelk') return 'companion';
  return 'enemy';
}

/**
 * Returns a list of problems: missing states vs ACTOR_META / contract minimums, missing card/node
 * icons, duplicate IDs, missing effects. Optional extra card/node ids (e.g. from the content package)
 * are checked for icon coverage too.
 */
export function validateManifest(extra?: {
  cardIds?: readonly string[];
  nodeIds?: readonly string[];
  iconContent?: IconContent;
  mechanics?: readonly { id: string; kind: string; color: string; name: string }[];
}): string[] {
  const problems: string[] = [];
  if (extra?.iconContent) registerIconContent(extra.iconContent);
  if (extra?.mechanics) registerMechanics(extra.mechanics);
  for (const m of extra?.mechanics ?? []) if (!hasMechIcon(m.id)) problems.push(`missing mechanic icon for '${m.id}'`);
  const seen = new Set<string>();
  for (const e of ASSET_MANIFEST) {
    if (seen.has(e.id)) problems.push(`duplicate asset id: ${e.id}`);
    seen.add(e.id);
    if (!e.source) problems.push(`asset ${e.id} has no source`);
    if (!e.version) problems.push(`asset ${e.id} has no version`);
  }
  for (const id of ACTOR_IDS) {
    const entry = ASSET_MANIFEST.find((e) => e.id === `actor:${id}`);
    const meta = ACTOR_META[id];
    if (!entry) {
      problems.push(`missing manifest entry for actor:${id}`);
      continue;
    }
    const states = new Set(entry.states ?? []);
    for (const s of meta.states) if (!states.has(s)) problems.push(`actor:${id} manifest missing state '${s}' declared in ACTOR_META`);
    for (const s of REQUIRED_STATES[id]) {
      if (!meta.states.includes(s as (typeof meta.states)[number])) problems.push(`actor:${id} missing required state '${s}'`);
    }
    const specs = actorStateSpecs(id);
    const mins = MIN_FRAMES[frameClass(id)] ?? {};
    for (const [s, min] of Object.entries(mins)) {
      const n = specs[s]?.durations.length ?? 0;
      if (n < min) problems.push(`actor:${id} state '${s}' has ${n} frames, needs >= ${min}`);
    }
  }
  const fx = new Set(EFFECT_KEYS);
  for (const k of REQUIRED_EFFECTS) if (!fx.has(k)) problems.push(`missing effect texture ${k}`);
  for (const k of REQUIRED_PFX) if (!fx.has(k)) problems.push(`missing light/particle texture ${k}`);
  for (const k of REQUIRED_DUNGEON) if (!seen.has(k)) problems.push(`missing dungeon texture ${k}`);
  for (const name of REQUIRED_PROPS) {
    const p = PROPS[name];
    if (!p) problems.push(`missing prop '${name}'`);
    else if (!seen.has(p.key)) problems.push(`prop '${name}' texture ${p.key} not in manifest`);
  }
  for (const k of [DECALS.blood, DECALS.scorch, DECALS.ichor, DECALS.slime, ...DECALS.grime]) if (!seen.has(k)) problems.push(`missing decal texture ${k}`);
  // themed dungeon sets: every key and prop id referenced by THEME_ART must exist
  for (const theme of THEME_IDS) {
    const art = THEME_ART[theme];
    if (!art) {
      problems.push(`missing THEME_ART entry for '${theme}'`);
      continue;
    }
    for (const k of [art.floorKey, art.wallKey, art.voidKey, ...art.grime]) if (!seen.has(k)) problems.push(`theme '${theme}' references unknown texture ${k}`);
    for (const id of [art.torchProp, art.pillarProp, ...art.props.map((p) => p.id), ...art.wallProps.map((p) => p.id)]) {
      if (!PROPS[id]) problems.push(`theme '${theme}' references unknown prop '${id}'`);
    }
    if (!PROPS[art.torchProp]?.light) problems.push(`theme '${theme}' torchProp '${art.torchProp}' has no light`);
    if (!PROPS[art.pillarProp]?.blocks) problems.push(`theme '${theme}' pillarProp '${art.pillarProp}' must block`);
    const ik = isoKeys(theme);
    for (const key of [ik.floorKey, ik.wallKey, ik.stubKey, ik.voidKey, ik.decoKey, ik.cliffKey, `${ik.floorKey}:n`, `${ik.wallKey}:n`]) if (!seen.has(key)) problems.push(`theme '${theme}' is missing iso texture ${key}`);
    if (art.iso.floorKey !== ik.floorKey || art.iso.wallKey !== ik.wallKey || art.iso.stubKey !== ik.stubKey || art.iso.voidKey !== ik.voidKey) {
      problems.push(`THEME_ART['${theme}'].iso keys do not match isoKeys('${theme}')`);
    }
    for (const wp of art.wallProps) if (PROPS[wp.id] && PROPS[wp.id]!.placement === 'floor') problems.push(`theme '${theme}' wall prop '${wp.id}' is a floor prop`);
    // lived-in dressing tables
    const dress = THEME_DRESSING[theme];
    if (!dress) {
      problems.push(`missing THEME_DRESSING entry for '${theme}'`);
      continue;
    }
    for (const v of dress.vignettes) if (!VIGNETTES[v.id]) problems.push(`theme '${theme}' references unknown vignette '${v.id}'`);
    for (const wp of dress.wall) if (PROPS[wp.id] && PROPS[wp.id]!.placement === 'floor') problems.push(`theme '${theme}' dressing wall prop '${wp.id}' is a floor prop`);
    for (const sp of [...dress.standing, ...dress.low]) if (PROPS[sp.id] && (PROPS[sp.id]!.placement !== 'floor' || PROPS[sp.id]!.blocks)) problems.push(`theme '${theme}' floor clutter '${sp.id}' must be a non-blocking floor prop`);
  }
  for (const id of dressingPropIds()) {
    const p = PROPS[id];
    if (!p) problems.push(`dressing references unknown prop '${id}'`);
    else if (!seen.has(p.key)) problems.push(`dressing prop '${id}' texture ${p.key} not in manifest`);
    else if (p.hug && (p.w ?? 0) > 48) problems.push(`hug prop '${id}' is ${p.w}px wide; wall-hugging props must fit one wall face (<= 48px)`);
    if (p?.glowKey && !seen.has(p.glowKey)) problems.push(`prop '${id}' glow layer ${p.glowKey} not in manifest`);
  }
  for (const k of dressingDecalKeys()) if (!seen.has(k)) problems.push(`vignette decal ${k} not in manifest`);
  for (const v of Object.values(VIGNETTES)) {
    for (const it of v.items) if (PROPS[it.id]?.blocks) problems.push(`vignette '${v.id}' uses blocking prop '${it.id}' (dressing is cosmetic)`);
    for (const w of v.walls ?? []) if (PROPS[w.id] && PROPS[w.id]!.placement === 'floor') problems.push(`vignette '${v.id}' wall piece '${w.id}' is a floor prop`);
    if (v.items.some((it) => it.v >= 2) || v.depth > 2) problems.push(`vignette '${v.id}' reaches 2+ tiles into the room (scenes stay within two rows of the wall)`);
  }
  const cards = new Set<string>([...CARD_IDS, ...(extra?.cardIds ?? [])]);
  for (const id of cards) {
    if (!hasCardIcon(id)) problems.push(`missing card icon for '${id}'`);
    else if (!seen.has(`icon:card:${id}`) && !seen.has('icon:card:*')) problems.push(`card icon '${id}' not listed in manifest`);
  }
  const nodes = new Set<string>([...NODE_IDS, ...(extra?.nodeIds ?? [])]);
  for (const id of nodes) {
    if (!hasNodeIcon(id)) problems.push(`missing node icon for '${id}'`);
    else if (!seen.has(`icon:node:${id}`) && !seen.has('icon:node:*')) problems.push(`node icon '${id}' not listed in manifest`);
  }
  return problems;
}
