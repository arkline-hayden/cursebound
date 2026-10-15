import { Big } from '@cursebound/numeric';
import { KNOCKBACK_RULES, RULES, SKILL_BY_ID, TICK_SEC, type DamageType } from '@cursebound/content';
import { moveCircle, norm, q } from './geometry';
import type { EnemyState, SimState } from './types';

// Knockback (rules 1.6, content KNOCKBACK_RULES). Heavy hits, slams, explosions and crits shove ordinary foes a short way
// from the hit's source. The shove is a slide, not a teleport: impactKnock stores a per-tick velocity in the foe's
// knockX/knockY and stepKnock (called from ai.ts stepEnemy) moves it swept against walls (chasm voids are wall tiles)
// while the velocity decays, so the push reads as a short skid and can never end inside a wall. Everything is plain
// float math on quantized positions from simulation state: deterministic and replay-safe. Bosses are immune; champions
// and rares take KNOCKBACK_RULES.eliteFactor of every knockback, authored skill knockbacks included (knockScale).

const K = KNOCKBACK_RULES;
const HEAVY_FRAC = Big.from(K.heavyFrac);
const RESIST_TICKS = Math.round(RULES.crowdControlResistSec / TICK_SEC);

/** Knockback multiplier for a foe: 0 for bosses, eliteFactor[tier] for champions / rares, 1 otherwise. */
export function knockScale(e: EnemyState): number {
  if (e.boss) return 0;
  return K.eliteFactor[e.elite ?? 0] ?? K.eliteFactor[K.eliteFactor.length - 1] ?? 1;
}

/** An authored knockback (players.ts knockback / tbkit shove) supersedes a pending impact slide. */
export function cancelSlide(e: EnemyState) {
  e.knockX = 0; e.knockY = 0;
}

/**
 * Impact push distance for one hit (world units, before the elite factor; 0 = no push). Pure: exported for tests and
 * for presentation that wants to mirror the rule. `perUnit` is one unit's share of the hit after mitigation, `unitHp`
 * the unit's maximum health.
 */
export function impactPush(skillId: string, dtype: DamageType, crit: boolean, perUnit: Big, unitHp: Big): number {
  const def = SKILL_BY_ID[skillId];
  if (def?.knockback) return 0;                       // the kit pushes on its own (authored knockback)
  const authored = K.bySkill[skillId];
  if (authored === 0) return 0;                       // controls that hold foes in place never push
  // channelled auras (whirlwinds, blizzards, swarms) tick too often to shove: they would scatter what they hold
  if (authored === undefined && def?.shape.kind === 'aura') return 0;
  const coef = def ? Number(def.damageCoef) : 0;
  const area = def?.shape.kind === 'circle';
  const heavy = authored !== undefined || coef >= (area ? K.areaHeavyCoef : K.heavyCoef) || (!unitHp.isZero() && perUnit.gte(unitHp.mul(HEAVY_FRAC)));
  // a crit on its own pushes only from a real strike (a skill of at least critMinCoef), not from procs and pets' nips
  if (!heavy && !(crit && coef >= K.critMinCoef)) return 0;
  const base = authored ?? K.byDamageType[dtype] ?? K.defaultPush;
  const d = heavy ? base * (crit ? K.critMult : 1) : base * K.critOnlyFactor;
  return Math.min(K.maxPush, d);
}

/**
 * Start (or strengthen) an impact slide on a living foe away from (fromX, fromY). A foe already sliding keeps the
 * stronger of the two pushes; an authored knockback this tick (control resistance just set) wins outright.
 */
export function impactKnock(state: SimState, e: EnemyState, fromX: number, fromY: number, dist: number) {
  if (dist <= 0 || !state.map || e.state === 'dying' || e.cohort.count.isZero()) return;
  const scale = knockScale(e);
  if (scale <= 0) return;
  if (e.ccResistUntil === state.tick + RESIST_TICKS) return;   // shoved by a skill's own knockback this very tick
  let [nx, ny] = norm(e.x - fromX, e.y - fromY);
  if (nx === 0 && ny === 0) { nx = -e.fx || 1; ny = -e.fy; [nx, ny] = norm(nx, ny); }   // dead centre: back off along the facing
  const v = dist * scale * (1 - K.slideDecay);
  if (v * v <= e.knockX * e.knockX + e.knockY * e.knockY) return;
  e.knockX = q(nx * v); e.knockY = q(ny * v);
}

/** Advance a foe's impact slide by one tick (swept against walls and voids); the slide ends at a wall or when spent. */
export function stepKnock(state: SimState, e: EnemyState) {
  if (e.knockX === 0 && e.knockY === 0) return;
  if (!state.map || e.boss) { cancelSlide(e); return; }
  const r = moveCircle(state.map, e.x, e.y, e.knockX, e.knockY, Math.min(e.radius, 0.6));
  const moved = Math.abs(r.x - e.x) + Math.abs(r.y - e.y);
  e.x = r.x; e.y = r.y;
  const kx = q(e.knockX * K.slideDecay), ky = q(e.knockY * K.slideDecay);
  // a wall that stops the foe (or a spent slide) ends it; grazing a wall while still moving keeps it sliding along
  if ((r.hitWall && moved < 1e-4) || kx * kx + ky * ky < K.minStep * K.minStep) { cancelSlide(e); return; }
  e.knockX = kx; e.knockY = ky;
}
