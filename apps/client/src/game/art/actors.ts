/**
 * Actor sprite metadata, animation tables and sheet building (framework-free).
 * Texture key: `actor:${actor}`; animation key: `${actor}:${state}:${dir}`.
 */
import { renderBossFrame } from './draw/bosses';
import { renderCreatureFrame, type CreatureId } from './draw/creatures';
import { renderHeroFrame, type HeroClass, type HeroState } from './draw/humanoid';
import { Painter, PixelBuffer, Sheet, polishActor } from './draw/pixel';
import type { View } from './draw/rig';

export type ActorId =
  | 'vanguard'
  | 'arcanist'
  | 'duelist'
  | 'hexbinder'
  | 'artificer'
  | 'templar'
  | 'berserker'
  | 'cryomancer'
  | 'ranger'
  | 'warden'
  | 'pursuer'
  | 'skirmisher'
  | 'artillery'
  | 'guardian'
  | 'hexer'
  | 'broodcaller'
  | 'mite'
  | 'prismstag'
  | 'bellroot'
  | 'spiritwolf'
  | 'spiritbear'
  | 'spiritelk'
  | 'gaoler'
  | 'rimewraith'
  | 'gloomshade'
  | 'webweaver';

export type ActorState = 'idle' | 'run' | 'attack' | 'cast' | 'dodge' | 'hit' | 'downed' | 'revive' | 'death' | 'windup' | 'stagger';

export type ActorDir = View;

export const ACTOR_IDS: readonly ActorId[] = [
  'vanguard',
  'arcanist',
  'duelist',
  'hexbinder',
  'artificer',
  'templar',
  'berserker',
  'cryomancer',
  'ranger',
  'warden',
  'pursuer',
  'skirmisher',
  'artillery',
  'guardian',
  'hexer',
  'broodcaller',
  'mite',
  'prismstag',
  'bellroot',
  'spiritwolf',
  'spiritbear',
  'spiritelk',
  'gaoler',
  'rimewraith',
  'gloomshade',
  'webweaver',
];

export interface StateSpec {
  /** per-frame durations in ms (length = frame count) */
  durations: readonly number[];
  loop: boolean;
}

const rep = (n: number, ms: number): number[] => Array.from({ length: n }, () => ms);

const HERO_STATES: Record<string, StateSpec> = {
  idle: { durations: [240, 180, 240, 180], loop: true },
  run: { durations: rep(10, 64), loop: true },
  attack: { durations: [100, 60, 35, 45, 65, 80, 95, 120], loop: false },
  cast: { durations: [100, 90, 100, 60, 130, 130], loop: false },
  dodge: { durations: [55, 70, 70, 95], loop: false },
  hit: { durations: [70, 120], loop: false },
  downed: { durations: [560, 560], loop: true },
  revive: { durations: [130, 130, 140, 180], loop: false },
  death: { durations: [90, 90, 100, 110, 130, 200], loop: false },
};

/** Duelist: same frames, snappier timing. */
const DUELIST_STATES: Record<string, StateSpec> = {
  ...HERO_STATES,
  run: { durations: rep(10, 58), loop: true },
  attack: { durations: [70, 40, 28, 35, 50, 60, 75, 90], loop: false },
  dodge: { durations: [45, 55, 55, 80], loop: false },
};

/** Templar / Berserker: same frame counts and total attack time, longer wind-up and a harder snap. */
const HEAVY_STATES: Record<string, StateSpec> = {
  ...HERO_STATES,
  run: { durations: rep(10, 68), loop: true },
  attack: { durations: [120, 75, 35, 40, 60, 75, 85, 110], loop: false },
};

const ENEMY_STATES: Record<string, StateSpec> = {
  idle: { durations: [210, 170, 210, 170], loop: true },
  run: { durations: rep(6, 85), loop: true },
  windup: { durations: [120, 120, 150, 200], loop: false },
  attack: { durations: [60, 70, 100, 140], loop: false },
  hit: { durations: [70, 120], loop: false },
  death: { durations: [80, 90, 100, 120, 140, 200], loop: false },
};

/** Warden spirit wolf (companion: cannot be harmed, fades out with the death burst). */
const COMPANION_STATES: Record<string, StateSpec> = {
  idle: { durations: [220, 180, 220, 180], loop: true },
  run: { durations: rep(6, 70), loop: true },
  attack: { durations: [60, 70, 100, 140], loop: false },
  death: { durations: [80, 90, 100, 120, 140, 200], loop: false },
};

/** Spirit bear: heavier gait and a slower paw swipe. */
const BEAR_STATES: Record<string, StateSpec> = {
  idle: { durations: [260, 220, 260, 220], loop: true },
  run: { durations: rep(6, 90), loop: true },
  attack: { durations: [90, 90, 120, 170], loop: false },
  death: { durations: [90, 100, 110, 130, 150, 220], loop: false },
};

/** Gaoler: same frames as every foe, a heavier gait and a slow, telegraphed hook throw. */
const GAOLER_STATES: Record<string, StateSpec> = {
  idle: { durations: [260, 220, 260, 220], loop: true },
  run: { durations: rep(6, 96), loop: true },
  windup: { durations: [140, 140, 170, 240], loop: false },
  attack: { durations: [60, 70, 110, 160], loop: false },
  hit: { durations: [80, 130], loop: false },
  death: { durations: [90, 100, 110, 130, 150, 220], loop: false },
};

const MITE_STATES: Record<string, StateSpec> = {
  idle: { durations: [200, 200], loop: true },
  run: { durations: rep(4, 70), loop: true },
  windup: { durations: [120, 160], loop: false },
  attack: { durations: [70, 130], loop: false },
  hit: { durations: [120], loop: false },
  death: { durations: [80, 100, 120, 170], loop: false },
};

const STAG_STATES: Record<string, StateSpec> = {
  idle: { durations: [280, 220, 280, 220], loop: true },
  run: { durations: rep(6, 95), loop: true },
  windup: { durations: [150, 150, 180, 240], loop: false },
  attack: { durations: [70, 70, 80, 100, 130, 180], loop: false },
  stagger: { durations: [160, 220, 220], loop: true },
  death: { durations: [110, 110, 120, 120, 130, 150, 180, 260], loop: false },
};

const BELL_STATES: Record<string, StateSpec> = {
  idle: { durations: [320, 260, 320, 260], loop: true },
  windup: { durations: [190, 190, 220, 280], loop: false },
  attack: { durations: [70, 80, 90, 110, 150, 200], loop: false },
  stagger: { durations: [170, 240, 240], loop: true },
  death: { durations: [110, 110, 120, 130, 140, 160, 190, 280], loop: false },
};

interface ActorSpec {
  frameW: number;
  frameH: number;
  originX: number;
  originY: number;
  shadowRadius: number;
  dirs: readonly ActorDir[];
  states: Record<string, StateSpec>;
  /** states that alias another state's frames (registered under their own key too) */
  aliases?: Record<string, string>;
}

const HERO_DIRS: readonly ActorDir[] = ['e', 'se', 's', 'ne', 'n'];
/** Creatures and the Hollow Stag author 5 views for isometric play (W side mirrors, like the heroes). */
const ENEMY_DIRS: readonly ActorDir[] = ['e', 'se', 's', 'ne', 'n'];

const SPECS: Record<ActorId, ActorSpec> = {
  vanguard: { frameW: 48, frameH: 48, originX: 0.5, originY: 42 / 48, shadowRadius: 11, dirs: HERO_DIRS, states: HERO_STATES },
  arcanist: { frameW: 48, frameH: 48, originX: 0.5, originY: 42 / 48, shadowRadius: 10, dirs: HERO_DIRS, states: HERO_STATES },
  duelist: { frameW: 48, frameH: 48, originX: 0.5, originY: 42 / 48, shadowRadius: 10, dirs: HERO_DIRS, states: DUELIST_STATES },
  hexbinder: { frameW: 48, frameH: 48, originX: 0.5, originY: 42 / 48, shadowRadius: 10, dirs: HERO_DIRS, states: HERO_STATES },
  artificer: { frameW: 48, frameH: 48, originX: 0.5, originY: 42 / 48, shadowRadius: 11, dirs: HERO_DIRS, states: HERO_STATES },
  templar: { frameW: 48, frameH: 48, originX: 0.5, originY: 42 / 48, shadowRadius: 11, dirs: HERO_DIRS, states: HEAVY_STATES },
  berserker: { frameW: 48, frameH: 48, originX: 0.5, originY: 42 / 48, shadowRadius: 12, dirs: HERO_DIRS, states: HEAVY_STATES },
  cryomancer: { frameW: 48, frameH: 48, originX: 0.5, originY: 42 / 48, shadowRadius: 10, dirs: HERO_DIRS, states: HERO_STATES },
  ranger: { frameW: 48, frameH: 48, originX: 0.5, originY: 42 / 48, shadowRadius: 10, dirs: HERO_DIRS, states: HERO_STATES },
  warden: { frameW: 48, frameH: 48, originX: 0.5, originY: 42 / 48, shadowRadius: 10, dirs: HERO_DIRS, states: HERO_STATES },
  pursuer: { frameW: 48, frameH: 48, originX: 0.5, originY: 40 / 48, shadowRadius: 12, dirs: ENEMY_DIRS, states: ENEMY_STATES },
  skirmisher: { frameW: 48, frameH: 48, originX: 0.5, originY: 41 / 48, shadowRadius: 8, dirs: ENEMY_DIRS, states: ENEMY_STATES },
  artillery: { frameW: 48, frameH: 48, originX: 0.5, originY: 41 / 48, shadowRadius: 13, dirs: ENEMY_DIRS, states: ENEMY_STATES },
  guardian: { frameW: 48, frameH: 48, originX: 0.5, originY: 42 / 48, shadowRadius: 14, dirs: ENEMY_DIRS, states: ENEMY_STATES },
  hexer: { frameW: 48, frameH: 48, originX: 0.5, originY: 42 / 48, shadowRadius: 8, dirs: ENEMY_DIRS, states: ENEMY_STATES },
  broodcaller: { frameW: 48, frameH: 48, originX: 0.5, originY: 42 / 48, shadowRadius: 13, dirs: ENEMY_DIRS, states: ENEMY_STATES },
  mite: { frameW: 32, frameH: 32, originX: 0.5, originY: 26 / 32, shadowRadius: 6, dirs: ENEMY_DIRS, states: MITE_STATES },
  prismstag: { frameW: 128, frameH: 128, originX: 0.5, originY: 112 / 128, shadowRadius: 36, dirs: ENEMY_DIRS, states: STAG_STATES },
  bellroot: {
    frameW: 160,
    frameH: 160,
    originX: 0.5,
    originY: 146 / 160,
    shadowRadius: 48,
    dirs: ['s'],
    states: BELL_STATES,
    aliases: { run: 'idle' },
  },
  spiritwolf: { frameW: 48, frameH: 48, originX: 0.5, originY: 40 / 48, shadowRadius: 10, dirs: ENEMY_DIRS, states: COMPANION_STATES },
  spiritbear: { frameW: 80, frameH: 80, originX: 0.5, originY: 70 / 80, shadowRadius: 20, dirs: ENEMY_DIRS, states: BEAR_STATES },
  spiritelk: { frameW: 80, frameH: 80, originX: 0.5, originY: 72 / 80, shadowRadius: 16, dirs: ENEMY_DIRS, states: COMPANION_STATES },
  gaoler: { frameW: 72, frameH: 72, originX: 0.5, originY: 64 / 72, shadowRadius: 17, dirs: ENEMY_DIRS, states: GAOLER_STATES },
  rimewraith: { frameW: 48, frameH: 48, originX: 0.5, originY: 42 / 48, shadowRadius: 9, dirs: ENEMY_DIRS, states: ENEMY_STATES },
  gloomshade: { frameW: 48, frameH: 48, originX: 0.5, originY: 42 / 48, shadowRadius: 8, dirs: ENEMY_DIRS, states: ENEMY_STATES },
  webweaver: { frameW: 48, frameH: 48, originX: 0.5, originY: 41 / 48, shadowRadius: 14, dirs: ENEMY_DIRS, states: ENEMY_STATES },
};

export const ACTOR_META: Record<
  ActorId,
  { frameW: number; frameH: number; originX: number; originY: number /* feet */; shadowRadius: number /* px */; states: ActorState[] }
> = Object.fromEntries(
  ACTOR_IDS.map((id) => {
    const s = SPECS[id];
    const states = [...Object.keys(s.states), ...Object.keys(s.aliases ?? {})] as ActorState[];
    return [id, { frameW: s.frameW, frameH: s.frameH, originX: s.originX, originY: s.originY, shadowRadius: s.shadowRadius, states }];
  }),
) as Record<ActorId, { frameW: number; frameH: number; originX: number; originY: number; shadowRadius: number; states: ActorState[] }>;

/** Authored directions per actor. */
export function actorDirs(actor: ActorId): readonly ActorDir[] {
  return SPECS[actor].dirs;
}

export function actorStateSpecs(actor: ActorId): Readonly<Record<string, StateSpec>> {
  return SPECS[actor].states;
}

export function animKey(actor: ActorId, state: ActorState, dir: ActorDir): string {
  return `${actor}:${state}:${dir}`;
}

export function actorTextureKey(actor: ActorId): string {
  return `actor:${actor}`;
}

const DIR5: readonly { dir: ActorDir; flipX: boolean }[] = [
  { dir: 'e', flipX: false }, // 0 E
  { dir: 'se', flipX: false }, // 1 SE
  { dir: 's', flipX: false }, // 2 S
  { dir: 'se', flipX: true }, // 3 SW
  { dir: 'e', flipX: true }, // 4 W
  { dir: 'ne', flipX: true }, // 5 NW
  { dir: 'n', flipX: false }, // 6 N
  { dir: 'ne', flipX: false }, // 7 NE
];

const DIR3: readonly { dir: ActorDir; flipX: boolean }[] = [
  { dir: 'e', flipX: false }, // 0 E
  { dir: 'e', flipX: false }, // 1 SE
  { dir: 's', flipX: false }, // 2 S
  { dir: 'e', flipX: true }, // 3 SW
  { dir: 'e', flipX: true }, // 4 W
  { dir: 'e', flipX: true }, // 5 NW
  { dir: 'n', flipX: false }, // 6 N
  { dir: 'e', flipX: false }, // 7 NE
];

/** Returns the animation key and flip for an actor/state/dir8. Falls back to 'idle' if the state is not authored for that actor. */
export function animFor(actor: ActorId, state: ActorState, dir8: number): { key: string; flipX: boolean } {
  const spec = SPECS[actor];
  const authored = state in spec.states || (spec.aliases !== undefined && state in spec.aliases);
  const st: ActorState = authored ? state : 'idle';
  const d = ((Math.round(dir8) % 8) + 8) % 8;
  if (spec.dirs.length === 1) return { key: animKey(actor, st, spec.dirs[0] as ActorDir), flipX: false };
  const table = spec.dirs.length >= 5 ? DIR5 : DIR3;
  const pick = table[d] as { dir: ActorDir; flipX: boolean };
  return { key: animKey(actor, st, pick.dir), flipX: pick.flipX };
}

export interface ActorAnim {
  key: string;
  state: ActorState;
  dir: ActorDir;
  frames: { frame: number; duration: number }[];
  repeat: boolean;
}

export interface ActorSheet {
  actor: ActorId;
  textureKey: string;
  frameW: number;
  frameH: number;
  width: number;
  height: number;
  frameCount: number;
  rgba: Uint8ClampedArray;
  anims: ActorAnim[];
}

/** Player-class actors (rendered by the hero rig). */
export const HERO_ACTOR_IDS: readonly HeroClass[] = ['vanguard', 'arcanist', 'duelist', 'hexbinder', 'artificer', 'templar', 'berserker', 'cryomancer', 'ranger', 'warden'];

export function isHeroActor(id: string): id is HeroClass {
  return (HERO_ACTOR_IDS as readonly string[]).includes(id);
}

function renderFrame(actor: ActorId, state: string, dir: ActorDir, i: number, n: number, painter: Painter): PixelBuffer {
  if (isHeroActor(actor)) return renderHeroFrame(actor, state as HeroState, dir, i, n, painter);
  if (actor === 'prismstag' || actor === 'bellroot') return renderBossFrame(actor, state, dir, i, n, painter);
  return renderCreatureFrame(actor as CreatureId, state, dir, i, n, painter);
}

/** Render every frame of an actor into one sheet and describe its animations. Deterministic. */
export function buildActorSheet(actor: ActorId): ActorSheet {
  const spec = SPECS[actor];
  let total = 0;
  for (const s of Object.values(spec.states)) total += s.durations.length * spec.dirs.length;
  const sheet = new Sheet(spec.frameW, spec.frameH, total, 2048);
  const painter = new Painter(new PixelBuffer(spec.frameW, spec.frameH));
  const anims: ActorAnim[] = [];
  for (const dir of spec.dirs) {
    for (const [state, ss] of Object.entries(spec.states)) {
      const n = ss.durations.length;
      const frames: { frame: number; duration: number }[] = [];
      for (let i = 0; i < n; i++) {
        const buf = renderFrame(actor, state, dir, i, n, painter);
        // the big bosses carry their own rim light and cost the most to polish: leave them as authored
        if (spec.frameW <= 96) polishActor(buf, { hero: isHeroActor(actor), groundY: Math.round(spec.originY * spec.frameH) });
        frames.push({ frame: sheet.add(buf), duration: ss.durations[i] as number });
      }
      anims.push({ key: animKey(actor, state as ActorState, dir), state: state as ActorState, dir, frames, repeat: ss.loop });
    }
    for (const [alias, target] of Object.entries(spec.aliases ?? {})) {
      const t = anims.find((a) => a.dir === dir && a.state === target);
      if (t) anims.push({ key: animKey(actor, alias as ActorState, dir), state: alias as ActorState, dir, frames: t.frames.slice(), repeat: t.repeat });
    }
  }
  return {
    actor,
    textureKey: actorTextureKey(actor),
    frameW: spec.frameW,
    frameH: spec.frameH,
    width: sheet.buf.w,
    height: sheet.buf.h,
    frameCount: sheet.count,
    rgba: sheet.buf.toRGBA(),
    anims,
  };
}
