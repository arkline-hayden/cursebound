import { RULES, TICK_RATE } from '@cursebound/content';
import type { SimState } from './types';

// Cinematic holds (boss grand entrance). The client plays the cutscene from the `boss_intro` event; the authority
// keeps the fight frozen for exactly the same window so every co-op client resumes together:
//   - no player actions (inputs are ignored), no AI, no damage, no hazard / projectile / telegraph progress,
//   - wave and encounter timers do not advance (activeTicks excludes the hold, so the speed bonus is unaffected),
//   - in-flight absolute-tick timers are pushed back one tick per held tick, so anything that existed when the hold
//     began resumes exactly where it paused.
// Other systems must not act while inCinematic(state) is true.

/** True while the fight is held for a cutscene. */
export function inCinematic(state: SimState): boolean {
  return state.tick < (state.cinematicUntilTick ?? 0);
}

/** Hold the fight for `ticks` ticks from now (extends, never shortens, a running hold). */
export function holdCinematic(state: SimState, ticks: number) {
  state.cinematicUntilTick = Math.max(state.cinematicUntilTick ?? 0, state.tick + Math.max(0, Math.round(ticks)));
}

/** The boss grand-entrance hold length in ticks (RULES.bossIntroSec). */
export function bossIntroTicks(): number {
  return Math.round(RULES.bossIntroSec * TICK_RATE);
}

/**
 * One held tick: nothing steps. Absolute-tick timers of things in flight move one tick later so they keep their
 * remaining time (hazards, telegraphs, lobbed shots, pickups, buffs, enemy statuses). Velocities read zero so
 * snapshots show everyone standing still.
 */
export function cinematicHoldTick(state: SimState) {
  const now = state.tick;
  const later = (v: number) => (v > now ? v + 1 : v);
  for (const h of state.hazards) {
    h.bornTick++; h.untilTick++; h.nextTick++;
    if (h.armTick !== undefined) h.armTick++;
  }
  for (const t of state.telegraphs) { t.startTick++; t.releaseTick++; }
  for (const pr of state.projectiles) {
    pr.bornTick++;
    if (pr.lobTarget) pr.lobTarget.landTick++;
  }
  for (const k of state.pickups ?? []) {
    k.bornTick++;
    if (k.untilTick > 0) k.untilTick++;
  }
  for (const p of state.players) {
    p.vx = 0; p.vy = 0;
    for (const b of p.buffs) b.until = later(b.until);
    for (const s of p.skills) if (s.mark) s.mark.until = later(s.mark.until);
  }
  for (const e of state.enemies) {
    e.vx = 0; e.vy = 0;
    e.vulnUntil = later(e.vulnUntil);
    e.shieldUntil = later(e.shieldUntil);
    e.staggerUntil = later(e.staggerUntil);
    e.ccResistUntil = later(e.ccResistUntil);
    for (const d of e.dots) d.until = later(d.until);
    if (e.ccVars) for (const key of Object.keys(e.ccVars)) if (key.endsWith('U')) e.ccVars[key] = later(e.ccVars[key]);
  }
}
