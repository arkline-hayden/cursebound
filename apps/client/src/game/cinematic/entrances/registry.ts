import type * as Phaser from 'phaser';
import type { Juice } from '../../render/Juice';
import type { Puppet } from '../puppet';
import type { Timeline, TimelineCtx } from '../timeline';

// Per-boss grand entrances (the boss reveal of the cutscene director, Cinematic.ts startBoss). A boss with an entry
// here stages its own emergence on its real sprite (the puppet); the director keeps the shared frame around it: the
// letterbox, the lights going down, the camera move to the lair, the stingers, the name card and the boss bar sweep.

export interface EntranceKit {
  tl: Timeline;
  J: Juice;
  /** the boss's world position, its screen point, and the unit world direction toward the party */
  x: number; y: number;
  sq: { x: number; y: number };
  fx: number; fy: number;
  /** the boss puppet (real sprite stand-in), hidden until the entrance shows it */
  pup: Puppet | null;
  /** boss colours (cinematic/text.ts BOSS_CINE) */
  glow: number; dust: number;
  /** scaled seconds (the hold length may differ from 4 s), the emergence and the cry times */
  T(v: number): number;
  REVEAL: number;
  ROAR: number;
  reduced: boolean;
  motion: boolean;
  /** 8-way facing for a world direction */
  dirOf(wx: number, wy: number): number;
  sfx(ctx: TimelineCtx, id: string, priority?: number): void;
  image(key: string, x: number, y: number, depth: number): Phaser.GameObjects.Image | null;
  sprite(key: string, x: number, y: number, depth: number): Phaser.GameObjects.Sprite | null;
  light(x: number, y: number, radius: number, color: number, intensity: number): Phaser.GameObjects.Light | null;
  flash(x: number, y: number, radius: number, color: number, intensity: number, ms: number): void;
  debris(x: number, y: number, n: number, tint: number): void;
  /** close-up for the cry (integer camera zoom; ignored under reduced motion) */
  zoom(z: number): void;
}

export type Entrance = (k: EntranceKit) => void;

export const BOSS_ENTRANCES: Record<string, Entrance> = {};

export function registerEntrance(bossId: string, fn: Entrance) { BOSS_ENTRANCES[bossId] = fn; }
