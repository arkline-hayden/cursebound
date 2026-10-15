import type { EnemyState, PlayerState, SimEvent, SimState } from '../types';

// Scripted bosses: a boss whose AI, phases and attacks are written as its own module (bosses/<boss>.ts) instead of
// the generic pattern runner in ai.ts. ai.ts stepBoss hands a boss to its script first; sim.ts imports bosses/index.ts
// so every script registers itself (and its hazards, kit.ts registerBossHazard) before the first tick. The shared
// toolkit (kit.ts) carries phases and reinforcements, the pattern runner, the attack stage machine, telegraphs, hits,
// movement and boss hazards; chasm.ts the forced movement and the long fall; lairs.ts the arenas.
// Scripts must be deterministic: only state, the seeded rng streams and their arguments. This module is
// dependency-free (types only), so the core modules that ask "is this boss out of reach?" (combat.ts, ai.ts,
// snapshot.ts, bot.ts) never import a script.

/** Where a hero should stand (bot.ts): dodge = roll toward it now; hold = it is safe here, ignore other telegraphs. */
export interface BotHint { x: number; y: number; dodge?: boolean; hold?: boolean }

export interface BossScript {
  /** One AI tick of a live boss entity of this kind (cinematic holds, death and DoTs are handled before). Return true
   *  when the script handled the tick (ai.ts then skips the generic boss runner). */
  step(state: SimState, ev: SimEvent[], e: EnemyState): boolean;
  /** Reference-player hint (bot.ts): where a hero should stand right now against this boss's mechanics (safe tiles,
   *  gaps, clear floor), from visible state only, and whether to dodge-roll. Null = no advice. */
  botHint?(state: SimState, p: PlayerState, e: EnemyState): BotHint | null;
  /** Out of reach (airborne): player hits, damage over time, stagger and body-blocking do nothing. */
  immune?(state: SimState, e: EnemyState): boolean;
  /** Presentation altitude 0..1 (snapshot `alt`: the client lifts the sprite and shrinks its shadow). */
  altitude?(state: SimState, e: EnemyState): number;
}

const SCRIPTS: Record<string, BossScript> = {};

export function registerBossScript(bossId: string, script: BossScript) { SCRIPTS[bossId] = script; }

export function bossScript(bossId: string): BossScript | undefined { return SCRIPTS[bossId]; }

/** The first live scripted boss's advice for this hero (bot.ts), or null. */
export function bossBotHint(state: SimState, p: PlayerState): BotHint | null {
  for (const e of state.enemies) {
    if (!e.boss || e.state === 'dying') continue;
    const h = SCRIPTS[e.kind]?.botHint?.(state, p, e);
    if (h) return h;
  }
  return null;
}

/** True while a scripted boss is out of reach (combat.ts hitEnemy / tickDots / addStagger, ai.ts separation, bot targeting). */
export function bossImmune(state: SimState, e: EnemyState): boolean {
  return e.boss && !!SCRIPTS[e.kind]?.immune?.(state, e);
}

/** Presentation altitude 0..1 of a flying scripted boss (0 on the ground or without one). */
export function bossAltitude(state: SimState, e: EnemyState): number {
  return e.boss ? Math.max(0, Math.min(1, SCRIPTS[e.kind]?.altitude?.(state, e) ?? 0)) : 0;
}
