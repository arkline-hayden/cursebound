import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import {
  FLOAT_MS, NUMBER_CAP, ROLL_MAX_MS, ROLL_WINDOW_MS, accumulate, expiresAt, isOpen, numberKey, overCap, popScale,
  type NumKind, type NumberHit, type Rolling,
} from '../apps/client/src/game/render/numberAccumulator';
import { GFX_TIERS } from '../apps/client/src/game/gfxProfile';

// Rolling damage numbers (render/numberAccumulator.ts): one number per target and kind that ticks up as hits land.

const hit = (at: number, amount: number | string, kind: NumKind = 'dmg', target = 'e1', color = '#fff'): NumberHit =>
  ({ target, kind, amount: Big.from(amount), at, x: 10 + at / 100, y: 20, color });

/** Fold a stream of hits the way DamageNumbers does: one open number per key, a new one once it closes. */
function fold(hits: NumberHit[]): { numbers: Rolling[]; open: Map<string, Rolling> } {
  const open = new Map<string, Rolling>();
  const numbers: Rolling[] = [];
  for (const h of hits) {
    const key = numberKey(h.target, h.kind);
    const { roll, fresh } = accumulate(open.get(key), h);
    if (fresh) numbers.push(roll); else numbers[numbers.findIndex((n) => n.key === key && n.born === roll.born)] = roll;
    open.set(key, roll);
  }
  return { numbers, open };
}

describe('number accumulator', () => {
  it('folds hits on one target inside the window into a single rolling total', () => {
    const { numbers } = fold([hit(0, 12), hit(200, 30), hit(450, 8)]);
    expect(numbers).toHaveLength(1);
    expect(numbers[0]!.total.toNumber()).toBe(50);
    expect(numbers[0]!.hits).toBe(3);
    expect(numbers[0]!.born).toBe(0);
    expect(numbers[0]!.last).toBe(450);
  });

  it('the window rolls from the latest hit; a gap longer than it starts a new number', () => {
    const w = ROLL_WINDOW_MS.dmg;
    const { numbers } = fold([hit(0, 1), hit(w - 10, 1), hit(2 * w - 20, 1), hit(3 * w + 50, 5)]);
    expect(numbers.map((n) => n.total.toNumber())).toEqual([3, 5]);
  });

  it('a target under constant fire still releases a number every ROLL_MAX_MS', () => {
    const hits = Array.from({ length: 40 }, (_, i) => hit(i * 100, 1));   // 4 s of hits, 0.1 s apart
    const { numbers } = fold(hits);
    expect(numbers.length).toBeGreaterThanOrEqual(Math.floor(3900 / ROLL_MAX_MS));
    for (const n of numbers) expect(n.last - n.born).toBeLessThanOrEqual(ROLL_MAX_MS);
    expect(numbers.reduce((s, n) => s + n.total.toNumber(), 0)).toBe(40);   // nothing lost
  });

  it('keeps targets and kinds apart: crits never fold into plain damage, heals never into hurt', () => {
    const { numbers } = fold([hit(0, 10), hit(50, 99, 'crit'), hit(60, 7, 'dmg', 'e2'), hit(100, 5), hit(120, 3, 'heal', 'p0'), hit(130, 4, 'hurt', 'p0')]);
    const by = Object.fromEntries(numbers.map((n) => [n.key, n.total.toNumber()]));
    expect(by).toEqual({ 'e1:dmg': 15, 'e1:crit': 99, 'e2:dmg': 7, 'p0:heal': 3, 'p0:hurt': 4 });
  });

  it('crits fold only on their short window (a flurry collapses, separate crits stand out)', () => {
    const c = ROLL_WINDOW_MS.crit;
    expect(c).toBeLessThan(ROLL_WINDOW_MS.dmg);
    const { numbers } = fold([hit(0, 50, 'crit'), hit(c - 20, 60, 'crit'), hit(2 * c + 100, 70, 'crit')]);
    expect(numbers.map((n) => n.total.toNumber())).toEqual([110, 70]);
  });

  it('is pure: the open number is never mutated', () => {
    const first = accumulate(undefined, hit(0, 5)).roll;
    const snapshot = { ...first, total: first.total };
    const next = accumulate(first, hit(100, 7));
    expect(next.fresh).toBe(false);
    expect(first).toEqual(snapshot);
    expect(first.total.toNumber()).toBe(5);
    expect(next.roll.total.toNumber()).toBe(12);
  });

  it('sums huge numbers exactly (Big), far past float range', () => {
    const { numbers } = fold([hit(0, '1e400'), hit(10, '2e400'), hit(20, '3e399')]);
    expect(numbers[0]!.total.eq(Big.from('3.3e400'))).toBe(true);
  });

  it('tracks the latest hit position and colour', () => {
    const a = accumulate(undefined, { ...hit(0, 1), color: '#ff9a3a' }).roll;
    const b = accumulate(a, { ...hit(100, 1), x: 99, y: 77, color: '#9fd8ff' }).roll;
    expect([b.x, b.y, b.color]).toEqual([99, 77, '#9fd8ff']);
  });

  it('opens, closes and expires on schedule', () => {
    const r = accumulate(undefined, hit(1000, 1)).roll;
    expect(isOpen(r, 1000 + ROLL_WINDOW_MS.dmg)).toBe(true);
    expect(isOpen(r, 1001 + ROLL_WINDOW_MS.dmg)).toBe(false);
    expect(expiresAt(r)).toBe(1000 + ROLL_WINDOW_MS.dmg + FLOAT_MS.dmg);
  });
});

describe('number cap', () => {
  const roll = (key: string, kind: NumKind, born: number, last = born): Rolling => ({ key, kind, total: Big.ONE, hits: 1, born, last, x: 0, y: 0, color: '#fff' });

  it('caps grow with the graphics tier', () => {
    for (let i = 1; i < GFX_TIERS.length; i++) expect(NUMBER_CAP[GFX_TIERS[i]!]).toBeGreaterThan(NUMBER_CAP[GFX_TIERS[i - 1]!]);
  });

  it('drops released plain numbers first, then open ones, crits last; oldest first within a rank', () => {
    const now = 5000;
    const live = [
      roll('crit-old', 'crit', 100, 4990),
      roll('open-old', 'dmg', 4500, 4990),
      roll('released-new', 'dmg', 3000, 3200),
      roll('released-old', 'heal', 2000, 2100),
      roll('open-new', 'dmg', 4800, 4995),
    ];
    expect(overCap(live, 6, now)).toEqual([]);
    expect(overCap(live, 5, now)).toEqual(['released-old']);
    expect(overCap(live, 3, now)).toEqual(['released-old', 'released-new', 'open-old']);
    expect(overCap(live, 1, now)).toEqual(['released-old', 'released-new', 'open-old', 'open-new', 'crit-old']);
  });
});

describe('pop and bounce', () => {
  it('plain numbers pop on each add and settle to rest; crits bounce harder', () => {
    expect(popScale(0, 'dmg', true)).toBeGreaterThan(popScale(0, 'dmg', false));
    expect(popScale(0, 'dmg', false)).toBeGreaterThan(1);
    expect(popScale(200, 'dmg', false)).toBe(1);
    const crit = [0, 30, 60, 100, 140, 180, 220, 400].map((t) => popScale(t, 'crit', true));
    expect(Math.max(...crit)).toBeGreaterThan(1.5);
    expect(Math.min(...crit.slice(3))).toBeLessThan(1);   // undershoot
    expect(crit[crit.length - 1]).toBe(1);
  });
});
