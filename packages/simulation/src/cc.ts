import { ENEMY_BY_ID, RULES, TICK_SEC } from '@cursebound/content';
import { addStagger } from './combat';
import { registerGlobalHooks } from './hooks';
import { B } from './stats';
import type { EnemyState, SimEvent, SimState } from './types';

// Crowd-control statuses shared by class kits (Cryomancer frost, Ranger snares / lures / marks). Stored lazily in
// EnemyState.ccVars as plain numbers (ticks), so checkpoints and hashes stay deterministic. ai.ts reads moveMul /
// actMul / isFrozen / lureGoal; everything else is kit-side.
//
//   Chill  - movement and attack timers x chillFactor (1 - slow). Strongest active Chill applies, durations refresh to
//            the longest; slow is capped at 70%. Bosses suffer half the slow.
//   Freeze - cannot move or act (attacks in progress are cancelled). Frozen enemies take x1.15 damage from every player.
//   Snare  - cannot move; attacks continue.
//   Control resistance (diminishing returns): Freeze and Snare share the knockback ccResistUntil window
//            (RULES.crowdControlResistSec). Each further Freeze/Snare inside the window lasts half as long; the third in a
//            row is converted into a strong Chill instead. Bosses never freeze or snare: they take stagger instead.

const DT = TICK_SEC;
export const CHILL_MAX_SLOW = 0.7;
export const FROZEN_DAMAGE_TAKEN = '1.15';
/** Stagger a boss takes per second of Freeze / Snare it ignores. */
export const BOSS_FREEZE_STAGGER = 60;
export const BOSS_SNARE_STAGGER = 35;

const ticksOf = (sec: number) => Math.max(1, Math.round(sec / DT));
const live = (e: EnemyState) => e.state !== 'dying' && !e.cohort.count.isZero();
const cv = (e: EnemyState): Record<string, number> => (e.ccVars ??= {});
const get = (e: EnemyState, k: string) => e.ccVars?.[k] ?? 0;

export function isChilled(state: SimState, e: EnemyState): boolean { return get(e, 'chU') > state.tick; }
export function isFrozen(state: SimState, e: EnemyState): boolean { return get(e, 'fzU') > state.tick; }
export function isSnared(state: SimState, e: EnemyState): boolean { return get(e, 'snU') > state.tick; }
/** Current speed factor from Chill (1 when not chilled). */
export function chillFactor(state: SimState, e: EnemyState): number { return isChilled(state, e) ? (e.ccVars!.chF ?? 1) : 1; }

/** AI movement multiplier (0 = cannot move). */
export function moveMul(state: SimState, e: EnemyState): number {
  if (!e.ccVars) return 1;
  if (isFrozen(state, e) || isSnared(state, e)) return 0;
  return chillFactor(state, e);
}

/** AI attack-timer multiplier (windup / release / recovery progress). */
export function actMul(state: SimState, e: EnemyState): number {
  if (!e.ccVars) return 1;
  if (isFrozen(state, e)) return 0;
  return chillFactor(state, e);
}

/** Lure point the AI walks toward instead of its usual goal (decoys, bait), or null. */
export function lureGoal(state: SimState, e: EnemyState): [number, number] | null {
  if (!e.ccVars || get(e, 'luU') <= state.tick) return null;
  return [e.ccVars.luX ?? e.x, e.ccVars.luY ?? e.y];
}

export function applyChill(state: SimState, e: EnemyState, slow: number, sec: number) {
  if (!live(e) || slow <= 0 || sec <= 0) return;
  const s = Math.min(CHILL_MAX_SLOW, slow) * (e.boss ? 0.5 : 1);
  const f = Math.round((1 - s) * 1000) / 1000;
  const until = state.tick + ticksOf(sec);
  const v = cv(e);
  if (isChilled(state, e)) { v.chF = Math.min(v.chF ?? 1, f); v.chU = Math.max(v.chU ?? 0, until); }
  else { v.chF = f; v.chU = until; }
}

/** Diminishing returns shared by Freeze and Snare (knockback's ccResistUntil window). Returns the duration to apply (0 = converted). */
function controlDuration(state: SimState, e: EnemyState, sec: number): number {
  const v = cv(e);
  const resisting = e.ccResistUntil > state.tick;
  const dr = resisting ? Math.min(3, (v.dr ?? 0) + 1) : 0;
  v.dr = dr;
  e.ccResistUntil = state.tick + Math.round(RULES.crowdControlResistSec / DT);
  return dr >= 3 ? 0 : sec * 0.5 ** dr;
}

function interrupt(state: SimState, e: EnemyState) {
  if (e.attack) { e.attack = null; e.cooldowns['_recover'] = 0.4; }
  e.state = 'idle';
  e.vx = 0; e.vy = 0;
  state.telegraphs = state.telegraphs.filter((t) => t.ownerId !== e.id);
}

/** Freeze for `sec` seconds (diminishing returns apply). Returns the applied duration in seconds (0 = resisted / boss). */
export function applyFreeze(state: SimState, ev: SimEvent[], e: EnemyState, sec: number): number {
  if (!live(e) || sec <= 0) return 0;
  if (e.boss) {
    addStagger(state, ev, e, Math.round(BOSS_FREEZE_STAGGER * sec));
    applyChill(state, e, 0.5, sec + 1);
    return 0;
  }
  const dur = controlDuration(state, e, sec);
  if (dur <= 0) { applyChill(state, e, CHILL_MAX_SLOW, sec + 1); return 0; }
  const v = cv(e);
  v.fzU = Math.max(v.fzU ?? 0, state.tick + ticksOf(dur));
  interrupt(state, e);
  return dur;
}

/** End a Freeze early (Shatter). */
export function breakFreeze(state: SimState, e: EnemyState) {
  if (e.ccVars && (e.ccVars.fzU ?? 0) > state.tick) e.ccVars.fzU = state.tick;
}

/** Snare (cannot move) for `sec` seconds; diminishing returns shared with Freeze. Returns the applied duration. */
export function applySnare(state: SimState, ev: SimEvent[], e: EnemyState, sec: number): number {
  if (!live(e) || sec <= 0) return 0;
  if (e.boss) { addStagger(state, ev, e, Math.round(BOSS_SNARE_STAGGER * sec)); return 0; }
  const dur = controlDuration(state, e, sec);
  if (dur <= 0) { applyChill(state, e, 0.5, sec); return 0; }
  const v = cv(e);
  v.snU = Math.max(v.snU ?? 0, state.tick + ticksOf(dur));
  e.vx = 0; e.vy = 0;
  // a charge in flight is stopped by the snare
  if (e.attack && e.attack.stage === 'release' && ENEMY_BY_ID[e.kind]?.attacks.find((a) => a.id === e.attack!.attackId)?.kind === 'charge') {
    e.attack = null; e.state = 'idle';
  }
  return dur;
}

/** Lure a non-boss enemy toward (x, y) for `ticks` ticks (refreshes). */
export function lure(state: SimState, e: EnemyState, x: number, y: number, ticks: number) {
  if (e.boss || !live(e)) return;
  const v = cv(e);
  v.luX = x; v.luY = y;
  v.luU = Math.max(v.luU ?? 0, state.tick + ticks);
}

// ---------------- marks (per player slot) ----------------

export function markEnemy(state: SimState, e: EnemyState, slot: number, sec: number) {
  if (!live(e)) return;
  const v = cv(e);
  v['mk' + slot] = Math.max(v['mk' + slot] ?? 0, state.tick + ticksOf(sec));
}
export function clearMark(e: EnemyState, slot: number) {
  if (e.ccVars && e.ccVars['mk' + slot]) e.ccVars['mk' + slot] = 0;
}
export function isMarkedBy(state: SimState, e: EnemyState, slot: number): boolean {
  return (e.ccVars?.['mk' + slot] ?? 0) > state.tick;
}
export function isMarked(state: SimState, e: EnemyState): boolean {
  if (!e.ccVars) return false;
  for (let s = 0; s < RULES.maxPartySize; s++) if ((e.ccVars['mk' + s] ?? 0) > state.tick) return true;
  return false;
}

/** Snapshot flags for the client (chilled / frozen / snared / marked), only the active ones. */
export function ccSnapFlags(state: SimState, e: EnemyState): { ch?: 1; fz?: 1; sn?: 1; mk?: 1 } {
  if (!e.ccVars) return {};
  const out: { ch?: 1; fz?: 1; sn?: 1; mk?: 1 } = {};
  if (isChilled(state, e)) out.ch = 1;
  if (isFrozen(state, e)) out.fz = 1;
  if (isSnared(state, e)) out.sn = 1;
  if (isMarked(state, e)) out.mk = 1;
  return out;
}

// Frozen enemies take more damage from everyone (co-op payoff for freezing).
registerGlobalHooks({
  modifyHit(state, _p, e, _info, mod) {
    if (e.ccVars && isFrozen(state, e)) mod.dmg = mod.dmg.mul(B(FROZEN_DAMAGE_TAKEN));
  },
});
