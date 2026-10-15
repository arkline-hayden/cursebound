import type * as Phaser from 'phaser';
import type { Snapshot } from '@cursebound/simulation';
import type { SfxId } from '../../audio/AudioEngine';
import type { DungeonRenderer } from '../DungeonRenderer';
import type { BitKind, Juice } from '../Juice';

// Presentation registry for class kits and Fate mechanics. CombatScene owns the loop; per-class files
// (fx/<class>.ts) register how their casts and hazards look. Everything here is cosmetic: it never feeds back
// into the simulation.

export interface FxCtx {
  scene: Phaser.Scene;
  juice: Juice;
  dungeon: DungeonRenderer;
  /** screen point for a world point */
  P(x: number, y: number): { x: number; y: number };
  /** unit screen direction for a world direction */
  U(dx: number, dy: number): { x: number; y: number };
  /** horizontal / vertical screen radius of a world circle */
  rx(r: number): number;
  ry(r: number): number;
  /** play a sound panned at a world position */
  sfx(id: SfxId, x?: number, y?: number, priority?: number): void;
  /** jagged lightning between two world points */
  bolt(x0: number, y0: number, x1: number, y1: number, color: number): void;
  /** is this event from the local player? */
  mine: boolean;
  /** The hero sprite for a party slot, if it is on screen. */
  actorSprite?(slot: number): Phaser.GameObjects.Sprite | undefined;
  /** Skill-tree rank of a node for a party slot (0 when unowned or unknown), so upgrades can show: extra chains, a
   *  bigger blast, a new element. Presentation only; the sim event stays the source of truth for shapes. */
  rank(slot: number, node: string): number;
  /** Class id of a party slot, if known. */
  cls(slot: number): string | undefined;
  reduced: boolean;
  /** cosmetic particle budget (graphics tier x reduced effects; 0 when reduced). Juice bursts already apply it; use it
   *  for counts of extra cosmetic sprites a kit spawns itself, never for telegraphs, hazards or projectiles */
  particles: number;
  now: number;
}

/** A 'cast' sim event (see SimEvent in @cursebound/simulation). dx/dy are the aim direction unless a kit documents otherwise. */
export interface CastFx { slot: number; skill: string; x: number; y: number; dx: number; dy: number; count?: string }

export type SkillFx = (ctx: FxCtx, e: CastFx) => void;

/** A snapshot hazard (see Snapshot['hazards']). */
export type SnapHazard = Snapshot['hazards'][number];
/** Draw a hazard for this frame on `g` (cleared every frame, ground layer). Return a light colour to flash once when it appears, or 0. */
export type HazardFx = (ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) => void;

/**
 * Projectile look per projectile kind: texture key, glow colour (also the trail and the burst where it ends), scale,
 * blend (player shots default to additive), an optional tint for white textures, a themed trail of bits every
 * `trailMs` (default 45; 'none' for no trail), a spin in degrees per second for thrown things, and an optional
 * `end` burst drawn where the projectile vanishes (screen coordinates).
 */
export interface ProjectileLook {
  key: string; color: number; scale?: number; additive?: boolean; tint?: number;
  trail?: BitKind | 'ember' | 'none'; trailMs?: number; spin?: number;
  end?: (ctx: FxCtx, sx: number, sy: number) => void;
}

/** What CombatScene knows about a kill when it hands it to the killer's class flourish (world coordinates). */
export interface KillInfo { slot: number; kind: string; x: number; y: number; dtype?: string; crit: boolean; big: boolean; elite: number; boss: boolean }
/** On-kill flourish for a class (cosmetic), drawn on top of the shared death burst. */
export type KillFx = (ctx: FxCtx, k: KillInfo) => void;

export const SKILL_FX: Record<string, SkillFx> = {};
export const HAZARD_FX: Record<string, HazardFx> = {};
/** Light colour flashed when a hazard of this kind first appears. */
export const HAZARD_LIGHT: Record<string, number> = {};
export const PROJECTILE_FX: Record<string, ProjectileLook> = {};
/** On-kill flourish per class id. */
export const KILL_FX: Record<string, KillFx> = {};

export function registerSkillFx(map: Record<string, SkillFx>) { Object.assign(SKILL_FX, map); }
export function registerHazardFx(map: Record<string, HazardFx>, lights: Record<string, number> = {}) { Object.assign(HAZARD_FX, map); Object.assign(HAZARD_LIGHT, lights); }
export function registerProjectileFx(map: typeof PROJECTILE_FX) { Object.assign(PROJECTILE_FX, map); }
export function registerKillFx(map: Record<string, KillFx>) { Object.assign(KILL_FX, map); }
