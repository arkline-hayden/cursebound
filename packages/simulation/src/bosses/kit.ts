import type { Big } from '@cursebound/numeric';
import { BOSS_BY_ID, RULES, TICK_SEC, type EnemyAttackDef, type TelegraphShape } from '@cursebound/content';
import { inflictHit } from '../afflictions';
import { actMul, moveMul } from '../cc';
import { enemyAttackDamage, hitPlayer } from '../combat';
import { bossReinforcements } from '../director';
import { dist2, isWall, lineOfSight, moveCircle, norm, rayDistance } from '../geometry';
import { findPath, nearestFloor, tileCenter } from '../map';
import { toFloatClamped } from '../stats';
import type { EnemyAttackState, EnemyState, PlayerState, SimEvent, SimState, Telegraph } from '../types';

// Shared toolkit of the scripted bosses (bosses/<boss>.ts): phases and reinforcements, the pattern runner, a
// windup -> release -> recovery attack machine, telegraphs, hero hits and movement. Mirrors the generic boss runner
// in ai.ts so scripted bosses read and pace exactly like the others.

export const DT = TICK_SEC;
/** Seconds to ticks (at least one). */
export const T = (sec: number) => Math.max(1, Math.round(sec / TICK_SEC));

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
 * The pattern runner (as ai.ts stepBoss): between patterns the boss pauses (`idle` runs); otherwise the next module
 * of the current phase pattern is offered to `start`, which begins it ('started'), needs more time ('wait', e.g.
 * still walking into range; a pattern never stalls longer than 3.5 s) or passes on it ('skip').
 */
export function runPatterns(state: SimState, ev: SimEvent[], e: EnemyState, idle: (target: PlayerState | null) => void, start: (a: EnemyAttackDef, target: PlayerState) => StartResult) {
  const def = BOSS_BY_ID[e.kind];
  if ((e.cooldowns['_pause'] ?? 0) > 0) { idle(pickTarget(state, e)); return; }
  const ph = def.phases[Math.min(e.phaseIndex, def.phases.length - 1)];
  const pattern = ph.patterns[e.patternIndex % ph.patterns.length];
  if (e.patternStep >= pattern.length) {
    e.patternIndex++;
    e.patternStep = 0;
    e.cooldowns['_pause'] = 1.2 * Number(ph.cadence) / freq(e);
    return;
  }
  const target = pickTarget(state, e);
  if (!target) { e.state = 'idle'; e.vx = 0; e.vy = 0; return; }
  const a = def.attacks.find((x) => x.id === pattern[e.patternStep]);
  const r = a ? start(a, target) : 'skip';
  if (r === 'skip') { e.patternStep++; e.stuckTimer = 0; return; }
  if (r === 'wait') {
    e.stuckTimer += DT;
    if (e.stuckTimer > 3.5) { e.patternStep++; e.stuckTimer = 0; }
    return;
  }
  e.stuckTimer = 0;
}

/** Begin a scripted attack aimed at (tx, ty): windup stage, `enemy_attack` windup event (client cue). */
export function beginAttack(state: SimState, ev: SimEvent[], e: EnemyState, a: EnemyAttackDef, tx: number, ty: number): EnemyAttackState {
  let [dx, dy] = norm(tx - e.x, ty - e.y);
  if (!dx && !dy) { dx = e.fx; dy = e.fy; }
  e.fx = dx; e.fy = dy;
  e.attack = { attackId: a.id, stage: 'windup', timer: a.windupSec / freq(e), ox: e.x, oy: e.y, dx, dy, tx, ty, hitSlots: [], telegraphId: -1 };
  e.state = 'windup';
  e.vx = 0; e.vy = 0;
  ev.push({ t: 'enemy_attack', id: e.id, attack: a.id, stage: 'windup' });
  return e.attack;
}

/** Tick of the release, in absolute ticks, for an attack beginning now (its windup at the boss's cadence). */
export function releaseTickOf(state: SimState, e: EnemyState, a: EnemyAttackDef): number {
  return state.tick + Math.max(0, Math.round(a.windupSec / freq(e) / DT));
}

export interface ScriptedAttack {
  /** once, when the windup ends */
  release(a: EnemyAttackDef, at: EnemyAttackState): void;
  /** every tick of the release stage (after `release`) */
  during?(a: EnemyAttackDef, at: EnemyAttackState): void;
}

/**
 * Advance the boss's scripted attack one tick: windup (chill slows it, freeze stops it) -> release -> recovery ->
 * done (the next pattern module). Returns false when no attack is running.
 */
export function stepScripted(state: SimState, ev: SimEvent[], e: EnemyState, h: Record<string, ScriptedAttack>): boolean {
  const at = e.attack;
  if (!at) return false;
  const a = attackOf(e, at.attackId);
  if (!a) { e.attack = null; e.state = 'idle'; return false; }
  const f = freq(e);
  at.timer -= DT * actMul(state, e);
  if (at.stage === 'windup') {
    if (at.timer > 0) return true;
    at.stage = 'release';
    at.timer += a.releaseSec / f;
    e.state = 'attack';
    ev.push({ t: 'enemy_attack', id: e.id, attack: a.id, stage: 'release' });
    h[a.id]?.release(a, at);
    if (!e.attack) return true;
  }
  if (at.stage === 'release') {
    h[a.id]?.during?.(a, at);
    if (at.timer > 0) return true;
    at.stage = 'recovery';
    at.timer += a.recoverySec / f;
    e.state = 'recovery';
  }
  if (at.stage === 'recovery') {
    if (at.timer > 0) return true;
    e.attack = null;
    e.state = 'idle';
    e.patternStep++;
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
