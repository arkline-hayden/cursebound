import type { Big } from '@cursebound/numeric';
import { BOSS_BY_ID, RULES, TICK_SEC, type EnemyAttackDef, type TelegraphShape } from '@cursebound/content';
import { inflictHit } from '../afflictions';
import { actMul, moveMul } from '../cc';
import { enemyAttackDamage, hitPlayer } from '../combat';
import { bossReinforcements } from '../director';
import { dist2, inCone, isWall, lineOfSight, moveCircle, norm, rayDistance } from '../geometry';
import { registerGlobalHooks } from '../hooks';
import { findPath, nearestFloor, tileCenter } from '../map';
import { toFloatClamped } from '../stats';
import type { EnemyAttackState, EnemyState, Hazard, PlayerState, SimEvent, SimState, Telegraph } from '../types';

// Shared toolkit of the scripted bosses (bosses/<boss>.ts): phases and reinforcements, the pattern runner, a
// windup -> release -> recovery attack machine (with per-stage hooks), telegraphs, hero hits, movement and the bosses'
// own hazards. Mirrors the generic boss runner in ai.ts so scripted bosses read and pace exactly like the others.
// Shared rules for scripted attacks: every damaging release is telegraphed first (Telegraph objects the client draws
// and the reference bot reads), dodge i-frames avoid damage and forced movement, and forced movement never drops a
// hero into a chasm unannounced (chasm.ts: a push over the brink is the long fall). Script counters live in
// EnemyState.bvars / Hazard.vars as plain numbers, so a checkpoint restores a fight mid-attack.

export const DT = TICK_SEC;
/** Seconds to ticks (at least one). */
export const T = (sec: number) => Math.max(1, Math.round(sec / TICK_SEC));
/** Smoothstep of t clamped to 0..1 (lift-offs, glides). */
export const smooth = (t: number): number => { const k = Math.max(0, Math.min(1, t)); return k * k * (3 - 2 * k); };
/** Distance from the boss to a point. */
export const distTo = (e: EnemyState, p: { x: number; y: number }): number => Math.sqrt(dist2(e.x, e.y, p.x, p.y));

/** Scripted state of a boss entity (created lazily). */
export function bv(e: EnemyState): Record<string, number> { return (e.bvars ??= {}); }

/** Enemy attack cadence multiplier (Fate enemy.attackFrequency). */
export function freq(e: EnemyState): number { return toFloatClamped(e.attackFreq, 1e12); }

/** A boss tunable (content BossDef.params). */
export function param(e: EnemyState, key: string, def: number): number { return BOSS_BY_ID[e.kind]?.params?.[key] ?? def; }

export function attackOf(e: EnemyState, id: string): EnemyAttackDef | undefined { return BOSS_BY_ID[e.kind]?.attacks.find((a) => a.id === id); }

export function bossName(e: EnemyState): string { return BOSS_BY_ID[e.kind]?.name ?? e.kind; }

export function aliveHeroes(state: SimState): PlayerState[] { return state.players.filter((p) => p.lifeState === 'alive'); }

export function healthFrac(e: EnemyState): number {
  return e.cohort.unitHp.sub(e.cohort.spread).sub(e.cohort.front).ratio(e.cohort.unitHp);
}

/**
 * Phase transitions by health fraction and the reinforcement waves (RULES.bossReinforceAt: 2/3 and 1/3, each once),
 * exactly as the generic runner. Returns the phase index entered this tick, or -1.
 */
export function bossPhaseTick(state: SimState, ev: SimEvent[], e: EnemyState): number {
  const def = BOSS_BY_ID[e.kind];
  const frac = healthFrac(e);
  let phase = 0;
  for (let i = 0; i < def.phases.length; i++) if (frac <= def.phases[i].healthFrac) phase = i;
  let entered = -1;
  if (phase > e.phaseIndex) {
    e.phaseIndex = phase;
    e.patternIndex = 0; e.patternStep = 0;
    ev.push({ t: 'boss_phase', id: e.id, phase });
    state.bossPhaseEvents.push(phase);
    entered = phase;
  }
  RULES.bossReinforceAt.forEach((at, i) => { if (frac <= at) bossReinforcements(state, ev, e, i + 1); });
  return entered;
}

/** Nearest living hero; the current target keeps the lock until another is 3 units closer (no flicker). */
export function pickTarget(state: SimState, e: EnemyState): PlayerState | null {
  let best: PlayerState | null = null, bs = Infinity;
  for (const p of aliveHeroes(state)) {
    const d = Math.sqrt(dist2(e.x, e.y, p.x, p.y)) - (e.targetSlot === p.slot ? 3 : 0);
    if (d < bs) { bs = d; best = p; }
  }
  e.targetSlot = best ? best.slot : null;
  return best;
}

/** Face a point (snapshot fx / fy drives the sprite and the eye). */
export function face(e: EnemyState, x: number, y: number) {
  const [fx, fy] = norm(x - e.x, y - e.y);
  if (fx || fy) { e.fx = fx; e.fy = fy; }
}

/** Walk toward a point: straight in sight, else along an A* path (replanned now and then); chill slows, freeze stops. */
export function walkToward(state: SimState, e: EnemyState, gx: number, gy: number, speedMul = 1) {
  const map = state.map!;
  let wx = gx, wy = gy;
  if (!lineOfSight(map, e.x, e.y, gx, gy)) {
    const goal = Math.floor(gy) * map.w + Math.floor(gx);
    e.pathAge++;
    if (!e.path.length || e.pathAge > 45 || e.pathGoal !== goal) { e.path = findPath(map, e.x, e.y, gx, gy); e.pathGoal = goal; e.pathAge = 0; }
    while (e.path.length > 1) {
      const [nx, ny] = tileCenter(map, e.path[1]);
      if (lineOfSight(map, e.x, e.y, nx, ny)) e.path.shift(); else break;
    }
    if (e.path.length) [wx, wy] = tileCenter(map, e.path[0]);
  } else e.path = [];
  const d = Math.sqrt(dist2(e.x, e.y, wx, wy));
  const step = Math.min(d, e.moveSpeed * speedMul * moveMul(state, e) * DT);
  if (step <= 1e-6) { e.vx = 0; e.vy = 0; return; }
  const [dx, dy] = norm(wx - e.x, wy - e.y);
  const r = moveCircle(map, e.x, e.y, dx * step, dy * step, Math.min(e.radius, 0.6));
  e.vx = (r.x - e.x) / DT; e.vy = (r.y - e.y) / DT;
  e.x = r.x; e.y = r.y;
  e.fx = dx; e.fy = dy;
}

export type StartResult = 'started' | 'wait' | 'skip';

/**
 * Pattern bookkeeping (the rules of ai.ts stepBoss): the attack the current phase pattern offers next, or null while
 * the pause between patterns runs (a finished pattern starts that pause and returns null too).
 */
export function patternAttack(e: EnemyState): EnemyAttackDef | null {
  if ((e.cooldowns['_pause'] ?? 0) > 0) return null;
  const def = BOSS_BY_ID[e.kind];
  const ph = def.phases[Math.min(e.phaseIndex, def.phases.length - 1)];
  const pattern = ph.patterns[e.patternIndex % ph.patterns.length];
  if (e.patternStep >= pattern.length) {
    e.patternIndex++;
    e.patternStep = 0;
    e.cooldowns['_pause'] = 1.2 * Number(ph.cadence) / freq(e);
    return null;
  }
  return def.attacks.find((x) => x.id === pattern[e.patternStep]) ?? null;
}

/**
 * The pattern runner (as ai.ts stepBoss): between patterns the boss pauses (`idle` runs); otherwise the next module
 * of the current phase pattern is offered to `start`, which begins it ('started'), needs more time ('wait', e.g.
 * still walking into range; a pattern never stalls longer than 3.5 s) or passes on it ('skip'). Scripts that steer
 * their own approach call patternAttack directly.
 */
export function runPatterns(state: SimState, ev: SimEvent[], e: EnemyState, idle: (target: PlayerState | null) => void, start: (a: EnemyAttackDef, target: PlayerState) => StartResult) {
  if ((e.cooldowns['_pause'] ?? 0) > 0) { idle(pickTarget(state, e)); return; }
  const a = patternAttack(e);
  if (!a && (e.cooldowns['_pause'] ?? 0) > 0) return;   // the pattern just ended: its pause starts
  const target = pickTarget(state, e);
  if (!target) { e.state = 'idle'; e.vx = 0; e.vy = 0; return; }
  const r = a ? start(a, target) : 'skip';
  if (r === 'skip') { e.patternStep++; e.stuckTimer = 0; return; }
  if (r === 'wait') {
    e.stuckTimer += DT;
    if (e.stuckTimer > 3.5) { e.patternStep++; e.stuckTimer = 0; }
    return;
  }
  e.stuckTimer = 0;
}

/**
 * A pattern pause can start mid-attack: the shared phase change (bossPhaseTick) resets the pattern while an attack may
 * still be running, and that attack's end would skip the new phase's opener. Scripts that want every phase to open on
 * its first pattern call this between attacks (no e.attack).
 */
export function openPhase(e: EnemyState) {
  const v = bv(e);
  if (v.ph === undefined) v.ph = e.phaseIndex;
  if (v.ph === e.phaseIndex || e.attack) return;
  v.ph = e.phaseIndex;
  e.patternIndex = 0; e.patternStep = 0; e.cooldowns['_pause'] = 0;
}

/**
 * Begin a scripted attack aimed at (tx, ty): windup stage, `enemy_attack` windup event (client cue). The boss faces the
 * point, or along `aim` (dx, dy, as given) when the attack has its own heading, which may name its telegraph.
 */
export function beginAttack(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, tx: number, ty: number, aim?: { dx: number; dy: number; telegraphId?: number }): EnemyAttackState {
  let dx: number, dy: number;
  if (aim) {
    dx = aim.dx; dy = aim.dy;
    e.fx = dx || e.fx; e.fy = dy || e.fy;
  } else {
    [dx, dy] = norm(tx - e.x, ty - e.y);
    if (!dx && !dy) { dx = e.fx; dy = e.fy; }
    e.fx = dx; e.fy = dy;
  }
  e.attack = { attackId: a.id, stage: 'windup', timer: a.windupSec / freq(e), ox: e.x, oy: e.y, dx, dy, tx, ty, hitSlots: [], telegraphId: aim?.telegraphId ?? -1 };
  e.state = 'windup';
  e.vx = 0; e.vy = 0;
  ev.push({ t: 'enemy_attack', id: e.id, attack: a.id, stage: 'windup' });
  return e.attack;
}

/** Tick of the release, in absolute ticks, for an attack beginning now (its windup at the boss's cadence). */
export function releaseTickOf(state: SimState, e: EnemyState, a: EnemyAttackDef): number {
  return state.tick + Math.max(0, Math.round(a.windupSec / freq(e) / DT));
}

export type AttackStage = 'windup' | 'release' | 'recovery';

/** Stage hooks of a scripted attack (keyed by attack id), all optional; the stage machine is stepScripted. */
export interface ScriptedAttack {
  /** every tick of the attack, any stage, right after its timer advanced (k = progress 0..1 through the stage) */
  tick?(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, stage: AttackStage, k: number): void;
  /** once, when the windup ends */
  release?(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, at: EnemyAttackState): void;
  /** every tick of the release stage (after `release`) */
  during?(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, at: EnemyAttackState): void;
  /** once, when the release ends (recovery begins) */
  recover?(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, at: EnemyAttackState): void;
  /** once, when the recovery ends (the pattern moves on) */
  end?(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, at: EnemyAttackState): void;
}

/** A scripted attack that also starts itself (puts the boss in windup and lays its telegraphs). */
export interface ScriptedModule extends ScriptedAttack {
  start(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, target: PlayerState): void;
}

/**
 * Advance the boss's scripted attack one tick: windup (chill slows it, freeze stops it) -> release -> recovery ->
 * done (the next pattern module), calling the attack's stage hooks. A hook may end the attack (e.attack = null).
 * Returns false when no attack is running.
 */
export function stepScripted(state: SimState, ev: SimEvent[], e: EnemyState, h: Record<string, ScriptedAttack>): boolean {
  const at = e.attack;
  if (!at) return false;
  const a = attackOf(e, at.attackId);
  if (!a) { e.attack = null; e.state = 'idle'; return false; }
  const m = h[a.id];
  const f = freq(e);
  at.timer -= DT * actMul(state, e);
  if (m?.tick) {
    const dur = (at.stage === 'windup' ? a.windupSec : at.stage === 'release' ? a.releaseSec : a.recoverySec) / f;
    m.tick(state, ev, e, a, at.stage, Math.max(0, Math.min(1, 1 - at.timer / Math.max(1e-6, dur))));
    if (!e.attack) return true;
  }
  if (at.stage === 'windup') {
    if (at.timer > 0) return true;
    at.stage = 'release';
    at.timer += a.releaseSec / f;
    e.state = 'attack';
    ev.push({ t: 'enemy_attack', id: e.id, attack: a.id, stage: 'release' });
    m?.release?.(state, ev, e, a, at);
    if (!e.attack) return true;
  }
  if (at.stage === 'release') {
    m?.during?.(state, ev, e, a, at);
    if (at.timer > 0) return true;
    at.stage = 'recovery';
    at.timer += a.recoverySec / f;
    e.state = 'recovery';
    m?.recover?.(state, ev, e, a, at);
    if (!e.attack) return true;
  }
  if (at.stage === 'recovery') {
    if (at.timer > 0) return true;
    e.attack = null;
    e.state = 'idle';
    e.patternStep++;
    m?.end?.(state, ev, e, a, at);
  }
  return true;
}

/** Mark a telegraph on the ground (client shape-coded warning). */
export function telegraph(state: SimState, e: EnemyState, attack: string, shape: TelegraphShape, x: number, y: number, dx: number, dy: number, releaseTick: number): Telegraph {
  const t: Telegraph = { id: state.nextId++, ownerId: e.id, shape, x, y, dx, dy, startTick: state.tick, releaseTick, attack };
  state.telegraphs.push(t);
  return t;
}

/** Telegraphs of this boss for `attack` (all of them when omitted). */
export function telegraphsOf(state: SimState, e: EnemyState, attack?: string): Telegraph[] {
  return state.telegraphs.filter((t) => t.ownerId === e.id && (attack === undefined || t.attack === attack));
}

export function clearTelegraphs(state: SimState, e: EnemyState, attack: string) {
  state.telegraphs = state.telegraphs.filter((t) => !(t.ownerId === e.id && t.attack === attack));
}

/** Damage of one hit of `a` from `e` (direct hits take Fate enemy.attackDamage; hazards do not). */
export function damageOf(state: SimState, e: EnemyState, a: EnemyAttackDef, direct = true): Big {
  return enemyAttackDamage(state, e, a.damageCoef, direct);
}

/** Hit a hero with `a` (i-frames avoid both the damage and the attack's affliction). */
export function hitHero(state: SimState, ev: SimEvent[], e: EnemyState, p: PlayerState, amount: Big, a: EnemyAttackDef, o: { hazard?: boolean; fromX?: number; fromY?: number } = {}): Big {
  const iframed = p.iframes > 0;
  const src = bossName(e);
  const dealt = hitPlayer(state, ev, p, amount, { attack: a.name, source: src, fromX: o.fromX ?? e.x, fromY: o.fromY ?? e.y, dtype: a.damageType, hazard: !!o.hazard, srcId: e.id });
  if (a.inflict && !iframed) inflictHit(state, ev, p, a.id, { srcId: e.id, source: src, attack: a.name, damage: amount });
  return dealt;
}

/** A floor point near (x, y) that is not inside furniture (falls back to the point itself). */
export function floorNear(state: SimState, x: number, y: number): [number, number] {
  return nearestFloor(state.map!, x, y);
}

export function isFloor(state: SimState, x: number, y: number): boolean {
  const m = state.map!;
  return !isWall(m, Math.floor(x), Math.floor(y));
}

/**
 * The open radius around (x, y): the 70th percentile of 16 wall rays (furniture shortens a few, so the median of
 * the long ones reads the room), clamped to [lo, hi]. Measured once per boss (its lair from the dais).
 */
export function openRadius(state: SimState, x: number, y: number, lo: number, hi: number): number {
  const ds: number[] = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    ds.push(rayDistance(state.map!, x, y, Math.cos(a), Math.sin(a), hi + 2));
  }
  ds.sort((p, q) => p - q);
  return Math.max(lo, Math.min(hi, ds[Math.floor(ds.length * 0.7)] - 0.6));
}

/**
 * Reference-player helper: where to stand against `bad` ground. Standing clear (with `clear` units to spare) holds
 * still (returns the hero's own spot, so the bot does not wander back in); otherwise the nearest floor point within
 * `maxR` that is clear with that margin (rings of 16 samples), or null when there is none.
 */
export function safeSpot(state: SimState, p: PlayerState, bad: (x: number, y: number) => boolean, maxR = 5, clear = 0.45): { x: number; y: number } | null {
  const ok = (x: number, y: number) => !isWall(state.map!, Math.floor(x), Math.floor(y)) && !bad(x, y)
    && !bad(x + clear, y) && !bad(x - clear, y) && !bad(x, y + clear) && !bad(x, y - clear);
  if (!bad(p.x, p.y)) return { x: p.x, y: p.y };
  for (let r = 0.6; r <= maxR; r += 0.6) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * (Math.PI * 2);
      const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
      if (ok(x, y)) return { x, y };
    }
  }
  return null;
}

// ---------------- shared attacks ----------------

/** The close-range cone a boss may carry (the Gale Wyrm's talon rake, the Crater Horror's maw lash): a telegraphed
 *  cone at the target, one hit per hero inside it on release. */
export const SWEEP: ScriptedModule = {
  start(state, ev, e, a, target) {
    let [dx, dy] = norm(target.x - e.x, target.y - e.y);
    if (!dx && !dy) { dx = e.fx; dy = e.fy; }
    const t = telegraph(state, e, a.id, a.telegraph, e.x, e.y, dx, dy, releaseTickOf(state, e, a));
    beginAttack(state, ev, e, a, target.x, target.y, { dx, dy, telegraphId: t.id });
  },
  release(state, ev, e, a, at) {
    const tg = a.telegraph.kind === 'cone' ? a.telegraph : { range: a.range, arcDeg: 90 };
    const ch = Math.cos((tg.arcDeg / 2) * Math.PI / 180);
    for (const p of aliveHeroes(state)) if (inCone(e.x, e.y, at.dx, at.dy, tg.range, ch, p.x, p.y, 0.3)) hitHero(state, ev, e, p, damageOf(state, e, a), a);
    clearTelegraphs(state, e, a.id);
  },
};

// ---------------- boss hazards ----------------

export type BossHazardFn = (state: SimState, ev: SimEvent[], h: Hazard, owner: EnemyState | undefined) => void;
const BOSS_HAZARDS: Record<string, BossHazardFn> = {};

/** A scripted boss's own enemy hazard kind (firewalls, quake rings, gales, tentacles...): ticked by the one hazardTick
 *  hook below, before the core hazard rules. `owner` is the boss that laid it (undefined once it is gone). */
export function registerBossHazard(kind: string, fn: BossHazardFn) { BOSS_HAZARDS[kind] = fn; }

registerGlobalHooks({
  hazardTick(state, ev, h) {
    if (h.owner !== 'enemy') return undefined;
    const fn = BOSS_HAZARDS[h.kind];
    if (!fn) return undefined;
    fn(state, ev, h, state.enemies.find((x) => x.id === h.ownerId));
    return true;
  },
});
