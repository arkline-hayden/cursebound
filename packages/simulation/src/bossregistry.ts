import type { EnemyState, SimEvent, SimState } from './types';

// The boss kit registry (kits themselves: bosskit.ts helpers, bosses/*). Dependency-free so the core modules that ask
// "is this boss out of reach?" (combat.ts, ai.ts, snapshot.ts, bot.ts) never import the kits.

export interface BossKit {
  /** Run the boss for one tick (after the shared phase, reinforcement and stagger bookkeeping in ai.ts stepBoss). */
  step(state: SimState, ev: SimEvent[], e: EnemyState): void;
  /** Out of reach (airborne): player hits, damage over time and stagger do nothing. */
  immune?(state: SimState, e: EnemyState): boolean;
  /** Presentation altitude 0..1 (snapshot `alt`). */
  altitude?(state: SimState, e: EnemyState): number;
}

const KITS: Record<string, BossKit> = {};

export function registerBossKit(id: string, kit: BossKit) { KITS[id] = kit; }

/** The kit running this boss, if it has one. */
export function bossKit(e: EnemyState): BossKit | undefined { return e.boss ? KITS[e.kind] : undefined; }

/** True while a boss is out of reach (combat.ts hitEnemy / addStagger, ai.ts separation, bot targeting). */
export function bossImmune(state: SimState, e: EnemyState): boolean {
  return e.boss && !!KITS[e.kind]?.immune?.(state, e);
}

/** Presentation altitude 0..1 of a flying boss (0 on the ground or without a kit). */
export function bossAltitude(state: SimState, e: EnemyState): number {
  return e.boss ? Math.max(0, Math.min(1, KITS[e.kind]?.altitude?.(state, e) ?? 0)) : 0;
}
