import { Big } from '@cursebound/numeric';
import type { GfxTier } from '../gfxProfile';

// Rolling damage numbers, the pure half (no Phaser, unit tested in tests/numbers.test.ts). Hits on one target within a
// short window fold into a single number that ticks up instead of a cloud of digits; crits keep their own, larger
// number per target (a fast flurry of crits still folds, on a shorter window); healing and damage taken by heroes roll
// the same way. render/DamageNumbers.ts draws what this decides.

/** dmg: a hero's hit on a foe; crit: a critical hit on a foe; heal: healing on a hero; hurt: damage to you; ally: damage to a teammate */
export type NumKind = 'dmg' | 'crit' | 'heal' | 'hurt' | 'ally';

/** A hit stays foldable into the open number this long after the previous one (ms). */
export const ROLL_WINDOW_MS: Record<NumKind, number> = { dmg: 600, crit: 220, heal: 600, hurt: 450, ally: 450 };
/** A number stops folding this long after it first appeared, so a target under constant fire still releases numbers. */
export const ROLL_MAX_MS = 1600;
/** How long a released number floats and fades (ms). */
export const FLOAT_MS: Record<NumKind, number> = { dmg: 650, crit: 900, heal: 750, hurt: 700, ally: 600 };

/** Most numbers on screen at once per graphics tier (crits are the last to go). */
export const NUMBER_CAP: Record<GfxTier, number> = { low: 10, medium: 18, high: 28, ultra: 36 };

export interface NumberHit {
  /** stable target key (e.g. `e12`, `p0`); the kind is added to it, so a crit never folds into plain damage */
  target: string;
  kind: NumKind;
  amount: Big;
  /** ms clock */
  at: number;
  /** where the hit landed (screen px), and the colour for this hit (damage type; the latest hit's colour wins) */
  x: number; y: number;
  color: string;
}

export interface Rolling {
  key: string;
  kind: NumKind;
  total: Big;
  hits: number;
  born: number;
  last: number;
  x: number; y: number;
  color: string;
}

export const numberKey = (target: string, kind: NumKind) => `${target}:${kind}`;

/** Still folding hits at `now`: inside its kind's window since the last hit and younger than ROLL_MAX_MS. */
export function isOpen(r: Rolling, now: number): boolean {
  return now - r.last <= ROLL_WINDOW_MS[r.kind] && now - r.born <= ROLL_MAX_MS;
}

/**
 * Fold a hit into the target's open number, or start a new one. Pure: `open` is never mutated. `fresh` is true when a
 * new number starts (draw a new text), false when the hit was added (tick the total up and pop the existing text).
 */
export function accumulate(open: Rolling | undefined, hit: NumberHit): { roll: Rolling; fresh: boolean } {
  const key = numberKey(hit.target, hit.kind);
  if (open && open.key === key && isOpen(open, hit.at)) {
    return { roll: { ...open, total: open.total.add(hit.amount), hits: open.hits + 1, last: hit.at, x: hit.x, y: hit.y, color: hit.color }, fresh: false };
  }
  return { roll: { key, kind: hit.kind, total: hit.amount, hits: 1, born: hit.at, last: hit.at, x: hit.x, y: hit.y, color: hit.color }, fresh: true };
}

/** When a number is fully gone (its window closed, then it floated and faded). */
export function expiresAt(r: Rolling): number {
  return Math.min(r.last + ROLL_WINDOW_MS[r.kind], r.born + ROLL_MAX_MS) + FLOAT_MS[r.kind];
}

/**
 * Which live numbers to drop so a new one fits under `cap`: the oldest released (no longer folding) plain numbers
 * first, then the oldest open plain ones; crits go only when nothing else is left. Returns keys in drop order.
 */
export function overCap(live: readonly Rolling[], cap: number, now: number): string[] {
  const excess = live.length + 1 - cap;
  if (excess <= 0) return [];
  const rank = (r: Rolling) => (r.kind === 'crit' ? 2 : isOpen(r, now) ? 1 : 0);
  return [...live].sort((a, b) => rank(a) - rank(b) || a.born - b.born).slice(0, excess).map((r) => r.key);
}

/** Pop scale for a number `ms` after a hit was added: a quick swell that settles (1 = rest). Crits bounce harder. */
export function popScale(ms: number, kind: NumKind, fresh: boolean): number {
  if (kind === 'crit') {
    // scale-bounce: snap to 1.7, undershoot to 0.92, settle at 1
    if (ms < 60) return 0.6 + (1.7 - 0.6) * (ms / 60);
    if (ms < 140) return 1.7 - (1.7 - 0.92) * ((ms - 60) / 80);
    if (ms < 220) return 0.92 + 0.08 * ((ms - 140) / 80);
    return 1;
  }
  const peak = fresh ? 1.35 : 1.22;
  const dur = 140;
  if (ms >= dur) return 1;
  const k = ms / dur;
  return 1 + (peak - 1) * (1 - k) * (1 - k);
}
