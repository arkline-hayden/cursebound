import { Big } from '@cursebound/numeric';
import { DODGE, RULES, TICK_SEC, type DamageType } from '@cursebound/content';
import { hitEnemy, type CohortResult, type HitOpts } from '../combat';
import { moveCircle, norm, q, rayDistance } from '../geometry';
import { nearestFloor } from '../map';
import { areaCoverage, newProjectileId } from '../players';
import { B, ONE, playerDerived } from '../stats';
import type { EnemyState, PlayerState, Projectile, SimEvent, SimState } from '../types';

// Shared helpers for the Vanguard, Arcanist and Hexbinder kit modules. Deterministic: state, arguments and the
// seeded rng streams only. Per-player counters live in p.vars (plain numbers, ticks for timers).

export const DT = TICK_SEC;
export const ticks = (sec: number) => Math.round(sec / TICK_SEC);
export const ZERO = Big.ZERO;

export const rank = (p: PlayerState, id: string) => p.ranks[id] ?? 0;
export const has = (p: PlayerState, id: string) => (p.ranks[id] ?? 0) > 0;

/** Class base hit (player.damage × skill mastery × damage type multiplier), before any skill coefficient. */
export function baseHit(state: SimState, p: PlayerState, dtype: DamageType): Big {
  const pd = playerDerived(state, p);
  return pd.damage.mul(pd.typeMult[dtype]);
}

export function isLive(e: EnemyState): boolean {
  return e.state !== 'dying' && !e.cohort.count.isZero();
}

export function enemyById(state: SimState, id: number): EnemyState | undefined {
  for (const e of state.enemies) if (e.id === id && isLive(e)) return e;
  return undefined;
}

/** Living enemies whose body touches the circle (x, y, r), nearest first (ties by id). */
export function enemiesNear(state: SimState, x: number, y: number, r: number, exclude?: readonly number[]): EnemyState[] {
  const out: { e: EnemyState; d: number }[] = [];
  for (const e of state.enemies) {
    if (!isLive(e) || exclude?.includes(e.id)) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d <= (r + e.radius) ** 2) out.push({ e, d });
  }
  out.sort((a, b) => a.d - b.d || a.e.id - b.e.id);
  return out.map((o) => o.e);
}

export function nearestEnemy(state: SimState, x: number, y: number, r: number, exclude?: readonly number[]): EnemyState | undefined {
  return enemiesNear(state, x, y, r, exclude)[0];
}

/** Hit every living enemy touching the circle once (area coverage). Returns the enemies hit with their results. */
export function hitArea(state: SimState, ev: SimEvent[], x: number, y: number, r: number, dmg: Big, o: Omit<HitOpts, 'coverage' | 'fromX' | 'fromY'> & { fromX?: number; fromY?: number }, exclude?: readonly number[]): { e: EnemyState; r: CohortResult }[] {
  const out: { e: EnemyState; r: CohortResult }[] = [];
  for (const e of enemiesNear(state, x, y, r, exclude)) {
    const res = hitEnemy(state, ev, e, dmg, ONE, { ...o, fromX: o.fromX ?? x, fromY: o.fromY ?? y, coverage: areaCoverage(e, r) });
    out.push({ e, r: res });
  }
  return out;
}

/** Small displacement without control resistance (pulls, shoves). Bosses are immovable. */
export function pushEnemy(state: SimState, e: EnemyState, dx: number, dy: number, dist: number) {
  if (e.boss || !isLive(e) || dist <= 0 || !state.map) return;
  const [nx, ny] = norm(dx, dy);
  if (nx === 0 && ny === 0) return;
  const r = moveCircle(state.map, e.x, e.y, nx * dist, ny * dist, Math.min(0.6, e.radius));
  e.x = r.x; e.y = r.y;
}

/** Pull toward a point, never overshooting it. */
export function pullToward(state: SimState, e: EnemyState, x: number, y: number, dist: number) {
  const d = Math.sqrt((x - e.x) ** 2 + (y - e.y) ** 2);
  pushEnemy(state, e, x - e.x, y - e.y, Math.min(dist, Math.max(0, d - 0.25)));
}

/** Aimed ground point: aim distance clamped to [minR, maxR]; optionally stopped short of walls. Always valid floor. */
export function aimPoint(state: SimState, p: PlayerState, maxR: number, minR = 1, clipWalls = true): [number, number] {
  const want = Math.min(maxR, Math.max(minR, p.aimDist || maxR));
  let d = want;
  if (clipWalls && state.map) d = Math.max(0, rayDistance(state.map, p.x, p.y, p.aimX, p.aimY, want) - RULES.playerRadius - 0.05);
  const x = p.x + p.aimX * d, y = p.y + p.aimY * d;
  if (!state.map) return [x, y];
  const cx = Math.min(state.map.w - 0.5, Math.max(0.5, x)), cy = Math.min(state.map.h - 0.5, Math.max(0.5, y));
  const [fx, fy] = nearestFloor(state.map, cx, cy);
  return [q(fx), q(fy)];
}

export function castEv(ev: SimEvent[], p: PlayerState, skill: string, x: number, y: number, dx: number, dy: number, count?: string) {
  ev.push({ t: 'cast', slot: p.slot, skill, x, y, dx, dy, ...(count ? { count } : {}) });
}

export interface ProjSpec {
  kind: string; x: number; y: number; dx: number; dy: number; speed: number; radius: number; range: number;
  damage: Big; dtype: DamageType; pierce: number; skillId: string; weight?: Big;
  dot?: { type: DamageType; fractionPerSec: string; durationSec: number };
}

export function spawnProj(state: SimState, p: PlayerState, s: ProjSpec): Projectile {
  const [dx, dy] = norm(s.dx, s.dy);
  const pr: Projectile = {
    id: newProjectileId(state), kind: s.kind, owner: 'player', ownerId: p.slot, x: s.x, y: s.y,
    vx: (dx || 1) * s.speed, vy: dy * s.speed, radius: s.radius, range: s.range, damage: s.damage, weight: s.weight ?? ONE,
    dtype: s.dtype, pierce: s.pierce, hitIds: [], skillId: s.skillId, crit: false, dot: s.dot, lobTarget: null, bornTick: state.tick,
  };
  state.projectiles.push(pr);
  return pr;
}

/** Steer a player projectile toward the nearest enemy it has not hit yet (homing spirits, seeds). */
export function steerProjectile(state: SimState, pr: Projectile, seek: number, turn: number) {
  let best: EnemyState | undefined; let bd = seek * seek;
  for (const e of state.enemies) {
    if (!isLive(e) || pr.hitIds.includes(e.id)) continue;
    const d = (e.x - pr.x) ** 2 + (e.y - pr.y) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) return;
  const sp = Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy) || 1;
  const [tx, ty] = norm(best.x - pr.x, best.y - pr.y);
  const [cx, cy] = norm(pr.vx, pr.vy);
  const [nx, ny] = norm(cx + (tx - cx) * turn, cy + (ty - cy) * turn);
  if (nx === 0 && ny === 0) return;
  pr.vx = nx * sp; pr.vy = ny * sp;
}

/** Shield gain with the same math as shieldPlayer, without emitting an event (for high-frequency sources). */
export function addShieldQuiet(state: SimState, p: PlayerState, amount: Big): Big {
  if (p.lifeState !== 'alive' || amount.isZero()) return ZERO;
  const pd = playerDerived(state, p);
  const gain = amount.mul(pd.shieldCapFrac).div(B('0.6'));
  const cap = p.maxHp.mul(pd.shieldCapFrac);
  p.shield = Big.min(cap, p.shield.add(gain));
  return gain;
}

export function grantRally(p: PlayerState, untilTick: number) {
  const cur = p.buffs.find((b) => b.id === 'rally');
  if (cur) { if (cur.until < untilTick) cur.until = untilTick; }
  else p.buffs.push({ id: 'rally', until: untilTick, value: 2 });
}

/** Refill dodge charges and clear the recharge clock. */
export function restoreDodge(p: PlayerState) {
  p.dodgeCooldown = 0;
  if (typeof p.dodgeCharges === 'number') p.dodgeCharges = Math.max(p.dodgeCharges, DODGE.charges);
}

// ---------------- scripted dashes (charges, whirls, blazing dashes) ----------------

/** Start a scripted dash: `dist` units along (dx, dy) over `sec`. Stored as <prefix>T/X/Y in p.vars. */
export function startDash(p: PlayerState, prefix: string, dx: number, dy: number, dist: number, sec: number) {
  const n = Math.max(1, ticks(sec));
  const [nx, ny] = norm(dx, dy);
  p.vars[prefix + 'T'] = n;
  p.vars[prefix + 'X'] = (nx * dist) / n;
  p.vars[prefix + 'Y'] = (ny * dist) / n;
}

/** Advance a scripted dash one tick. Returns 'idle' (none), 'moving' or 'ended' (the tick the dash finished). */
export function stepDash(state: SimState, p: PlayerState, prefix: string): 'idle' | 'moving' | 'ended' {
  const t = p.vars[prefix + 'T'] ?? 0;
  if (t <= 0 || !state.map) return 'idle';
  const r = moveCircle(state.map, p.x, p.y, p.vars[prefix + 'X'] ?? 0, p.vars[prefix + 'Y'] ?? 0, RULES.playerRadius);
  p.x = r.x; p.y = r.y;
  p.vars[prefix + 'T'] = t - 1;
  return t - 1 <= 0 ? 'ended' : 'moving';
}

export function clearVars(p: PlayerState, prefix: string) {
  for (const k of Object.keys(p.vars)) if (k.startsWith(prefix)) delete p.vars[k];
}

/** Fraction string for a rot/burn rate (finite decimal, content-style). */
export function fracStr(x: number): string {
  return (Math.round(x * 10000) / 10000).toFixed(4);
}

/** Big from a non-negative float coefficient (rounded to 4 decimals so cache keys stay bounded). */
export function coef(x: number): Big {
  return B(fracStr(Math.max(0, x)));
}
