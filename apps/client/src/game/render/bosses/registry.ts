import type * as Phaser from 'phaser';
import type { SimEvent, SnapEnemy, Snapshot } from '@cursebound/simulation';
import type { Juice } from '../Juice';
import type { DungeonRenderer } from '../DungeonRenderer';

// Presentation of the scripted bosses (simulation bosses/*). Each boss file registers a kit: how its sim events look
// and sound (laser beams, glitch jumps, hammer quakes, banners that say what to do) and any per-frame touch on its
// sprites (the Corrupted Core's echoes glitch now and then). Hazards and projectiles register in the shared fx
// registry (render/fx/registry.ts). Everything here is cosmetic.

/** What a boss kit may use (CombatScene closures). */
export interface BossFxHost {
  scene: Phaser.Scene;
  juice: Juice;
  dungeon: DungeonRenderer;
  /** play a sound panned at a world position */
  sfx(id: string, x?: number, y?: number, priority?: number): void;
  /** the HUD banner (danger = red, good = gold, info = pale) */
  banner(text: string, tone: 'danger' | 'good' | 'info'): void;
  /** effects setting: fewer cosmetic particles */
  reduced(): boolean;
  /** the local hero's slot */
  me(): number;
}

/** A short-lived beam the boss layer draws (world coordinates, ms clock). */
export interface Beam { x0: number; y0: number; x1: number; y1: number; w: number; color: number; core: number; born: number; until: number }

export interface BossKit {
  /** Present a sim event of (or about) this boss. Return true when handled: the scene then skips its generic cue. */
  onEvent?(host: BossFxHost, layer: BossLayer, e: SimEvent, snap: Snapshot | null): boolean;
  /** Per-frame touch on one of this boss kind's live sprites, after the scene set its frame, tint and position. */
  drawEnemy?(host: BossFxHost, sprite: Phaser.GameObjects.Sprite, e: SnapEnemy, now: number): void;
  /** A light the boss carries (its eye, its furnace) so it reads in the dark lair; dy = height above its feet (px). */
  light?(e: SnapEnemy, now: number): { color: number; radius: number; intensity: number; dy: number } | null;
}

/** Transient boss effects drawn above the floor (beams), owned by BossFx. */
export interface BossLayer {
  beam(b: Omit<Beam, 'born'>): void;
  /** was entity `id` a mirror echo (seen with the snapshot echo flag)? */
  isEcho(id: number): boolean;
}

export const BOSS_KITS: Record<string, BossKit> = {};

export function registerBossKit(bossId: string, kit: BossKit) { BOSS_KITS[bossId] = kit; }

/** World map access for hazard drawing (clip walls to the floor); set by BossFx each frame. */
let mapRef: { w: number; h: number; tiles: number[] } | null = null;
export function setBossFxMap(m: { w: number; h: number; tiles: number[] } | null) { mapRef = m; }
export function floorAt(x: number, y: number): boolean {
  const m = mapRef;
  if (!m) return true;
  const tx = Math.floor(x), ty = Math.floor(y);
  return tx >= 0 && ty >= 0 && tx < m.w && ty < m.h && m.tiles[ty * m.w + tx] !== 1;
}
