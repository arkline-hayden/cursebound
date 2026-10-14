import { describe, expect, it } from 'vitest';
import { Big, NumericError, sampleBinomial } from '../src/index';
import { mulberry32 } from './helpers';

function counting(next: () => number): { next: () => number; draws: () => number } {
  let n = 0;
  return {
    next: () => {
      n++;
      return next();
    },
    draws: () => n,
  };
}

describe('sampleBinomial (PRD §12.1)', () => {
  it('k <= 64 equals sequential Bernoulli trials with the same draws (grouped/ungrouped equivalence)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      for (const [qn, qd] of [
        [1n, 2n],
        [1n, 3n],
        [7n, 100n],
        [0n, 1n],
        [1n, 1n],
        [999n, 1000n],
      ] as const) {
        const k = 1 + (seed % 64);
        const grouped = counting(mulberry32(seed));
        const g = sampleBinomial(Big.from(k), qn, qd, grouped.next);
        expect(grouped.draws()).toBe(k);
        // ungrouped: k calls with k = 1 on an identical stream
        const single = mulberry32(seed);
        let total = 0;
        for (let i = 0; i < k; i++) total += sampleBinomial(Big.ONE, qn, qd, single).toNumber();
        expect(g.toNumber()).toBe(total);
        // reference: explicit trials with exact rational comparison
        const ref = mulberry32(seed);
        let manual = 0;
        for (let i = 0; i < k; i++) if (ref() < Number(qn) / Number(qd)) manual++;
        // float q equals exact q for these fractions except at the representable boundary; check on non-boundary q
        if (qd !== 3n) expect(g.toNumber()).toBe(manual);
        expect(g.isInteger()).toBe(true);
      }
    }
  });
  it('uses an exact rational threshold (draw exactly at q fails, just below succeeds)', () => {
    expect(sampleBinomial(Big.ONE, 1n, 2n, () => 0.5).zero).toBe(true);
    expect(sampleBinomial(Big.ONE, 1n, 2n, () => 0.49999999999999994).eq(Big.ONE)).toBe(true);
    // 1/3 is not a double: the double nearest 1/3 is below 1/3, so it succeeds
    expect(sampleBinomial(Big.ONE, 1n, 3n, () => 1 / 3).eq(Big.ONE)).toBe(true);
    // draws finer than 2^-53 use the slow exact path
    expect(sampleBinomial(Big.ONE, 1n, 10n ** 30n, () => 2 ** -110).eq(Big.ONE)).toBe(true);
    expect(sampleBinomial(Big.ONE, 1n, 10n ** 40n, () => 2 ** -110).zero).toBe(true);
    expect(sampleBinomial(Big.from(3), 0n, 5n, () => 0).zero).toBe(true);
  });
  it('k > 64 uses binom-normal-v1: exactly 2 draws, deterministic, integer in [0,k]', () => {
    for (const kText of ['65', '1000', '123456789', '1e15', '9.87654321e40', '1e10000', '7.1e1000000']) {
      const k = Big.from(kText);
      for (const [qn, qd] of [
        [1n, 2n],
        [1n, 1000n],
        [999n, 1000n],
        [0n, 7n],
        [7n, 7n],
      ] as const) {
        for (let seed = 1; seed <= 20; seed++) {
          const c = counting(mulberry32(seed));
          const r = sampleBinomial(k, qn, qd, c.next);
          expect(c.draws()).toBe(2);
          expect(r.isInteger()).toBe(true);
          expect(r.gte(Big.ZERO) && r.lte(k)).toBe(true);
          expect(sampleBinomial(k, qn, qd, mulberry32(seed)).eq(r)).toBe(true);
          if (qn === 0n) expect(r.zero).toBe(true);
          if (qn === qd) expect(r.eq(k)).toBe(true);
        }
      }
    }
  });
  it('k > 64 results are near k·q', () => {
    const k = Big.from(1_000_000);
    const rnd = mulberry32(5);
    let sum = 0;
    for (let i = 0; i < 2000; i++) sum += sampleBinomial(k, 1n, 4n, rnd).toNumber();
    expect(Math.abs(sum / 2000 - 250000)).toBeLessThan(50); // sd 433/sqrt(2000) ≈ 10
    const huge = Big.from('1e10000');
    const r = sampleBinomial(huge, 1n, 2n, mulberry32(9));
    expect(r.ratio(huge)).toBeCloseTo(0.5, 12);
  });
  it('extreme draws do not produce NaN/Infinity', () => {
    for (const k of ['100', '1e20']) {
      for (const draws of [
        [0, 0],
        [0.9999999999999999, 0],
        [0.9999999999999999, 0.5],
        [0, 0.25],
      ]) {
        let i = 0;
        const r = sampleBinomial(Big.from(k), 1n, 2n, () => draws[i++]!);
        expect(r.isInteger()).toBe(true);
        expect(r.lte(Big.from(k))).toBe(true);
      }
    }
  });
  it('validates arguments', () => {
    const next = mulberry32(1);
    expect(() => sampleBinomial(Big.from('1.5'), 1n, 2n, next)).toThrow(NumericError);
    expect(() => sampleBinomial(Big.ONE, 3n, 2n, next)).toThrow(NumericError);
    expect(() => sampleBinomial(Big.ONE, 1n, 0n, next)).toThrow(NumericError);
    expect(() => sampleBinomial(Big.ONE, 1n, 2n, () => 1)).toThrow(NumericError);
    expect(() => sampleBinomial(Big.ONE, 1n, 2n, () => NaN)).toThrow(NumericError);
    expect(sampleBinomial(Big.ZERO, 1n, 2n, () => 0.1).zero).toBe(true);
  });
});
