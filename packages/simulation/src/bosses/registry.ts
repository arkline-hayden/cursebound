import type { EnemyState, PlayerState, SimEvent, SimState } from '../types';

// Scripted bosses: a boss whose AI, phases and attacks are written as its own module (bosses/<boss>.ts) instead of
// the generic pattern runner in ai.ts. ai.ts stepBoss hands a boss to its script first; sim.ts imports bosses/index.ts
// so every script registers itself (and its hazard handlers, as global hooks) before the first tick.
// Scripts must be deterministic: only state, the seeded rng streams and their arguments.

/** Where a hero should stand (bot.ts): dodge = roll toward it now; hold = it is safe here, ignore other telegraphs. */
export interface BotHint { x: number; y: number; dodge?: boolean; hold?: boolean }

export interface BossScript {
  /** One AI tick of a live boss entity of this kind (cinematic holds, death and DoTs are handled before). Return true
   *  when the script handled the tick (ai.ts then skips the generic boss runner). */
  step(state: SimState, ev: SimEvent[], e: EnemyState): boolean;
  /** Reference-player hint (bot.ts): where a hero should stand right now against this boss's mechanics (safe tiles,
   *  gaps, clear floor), from visible state only, and whether to dodge-roll. Null = no advice. */
  botHint?(state: SimState, p: PlayerState, e: EnemyState): BotHint | null;
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
