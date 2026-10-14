import { describe, expect, it } from 'vitest';
import { Big, NUMERIC_VERSION, NumericError, PRECISION, percentToFactor } from '../src/index';
import { mulberry32, randomBig } from './helpers';

const B = (x: string | number | bigint) => Big.from(x);

function expectNumericError(fn: () => unknown, code: 'INVALID' | 'DIV_ZERO' | 'RANGE'): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(NumericError);
    expect((err as NumericError).code).toBe(code);
    return;
  }
  throw new Error('expected NumericError ' + code);
}

describe('constants and representation', () => {
  it('exports version constants', () => {
    expect(PRECISION).toBe(34);
    expect(NUMERIC_VERSION).toBe('num-1.0.0');
  });
  it('ZERO and ONE', () => {
    expect(Big.ZERO.zero).toBe(true);
    expect(Big.ZERO.c).toBe(0n);
    expect(Big.ZERO.e).toBe(0n);
    expect(Big.ONE.c).toBe(10n ** 33n);
    expect(Big.ONE.e).toBe(0n);
    expect(Big.ONE.toString()).toBe('1e0');
  });
  it('normalizes coefficients to 34 digits', () => {
    for (const s of ['1', '123', '0.05', '1e450', '1.2345e-7', '2.5E+10', '999.999']) {
      const x = B(s);
      expect(x.c >= 10n ** 33n && x.c < 10n ** 34n).toBe(true);
    }
    expect(B('123').e).toBe(2n);
    expect(B('0.05').e).toBe(-2n);
    expect(B('2.5E+10').toString()).toBe('2.5e10');
    expect(B('1.2345e-7').toString()).toBe('1.2345e-7');
  });
  it('fromParts accepts any number of digits', () => {
    expect(Big.fromParts(1n, 33n).toString()).toBe('1e0');
    expect(Big.fromParts(175n, 33n).toString()).toBe('1.75e2');
    expect(Big.fromParts(10n ** 60n, 33n).toString()).toBe('1e60');
    expect(Big.fromParts(0n, 5n).zero).toBe(true);
    expectNumericError(() => Big.fromParts(-1n, 0n), 'INVALID');
  });
  it('from() accepts numbers via their shortest decimal string, bigints, wires, Bigs', () => {
    expect(B(0.1).toString()).toBe('1e-1'); // not 0.1000000000000000055511151231257827
    expect(B(1e21).toString()).toBe('1e21');
    expect(B(5e-7).toString()).toBe('5e-7');
    expect(B(-0).zero).toBe(true);
    expect(B(12345678901234567890123456789012345678901234567890n).toString()).toBe('1.234567890123456789012345678901235e49');
    const x = B('1.75');
    expect(Big.from(x)).toBe(x);
    expect(Big.from({ m: '1.2345', e: '450', zero: false }).toString()).toBe('1.2345e450');
  });
  it('from() rejects negatives and garbage', () => {
    for (const bad of [-1, NaN, Infinity, -Infinity]) expectNumericError(() => B(bad), 'INVALID');
    for (const bad of ['-1', 'NaN', 'Infinity', '', 'abc', '1e', '1..2', ' 1', '0x10', '1e5.5', '--1', '+-1']) {
      expectNumericError(() => B(bad), 'INVALID');
    }
    expectNumericError(() => B(-5n), 'INVALID');
    expectNumericError(() => Big.from(null as unknown as string), 'INVALID');
  });
  it('is immutable from the type system and operations return new values', () => {
    const a = B('2');
    const b = a.mul(B('3'));
    expect(a.toString()).toBe('2e0');
    expect(b.toString()).toBe('6e0');
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(Big.ZERO) && Object.isFrozen(Big.ONE)).toBe(true);
    expect(() => {
      (a as unknown as { c: bigint }).c = 5n;
    }).toThrow(TypeError);
    expect(a.toString()).toBe('2e0');
  });
});

describe('percent semantics (PRD §8.2)', () => {
  it('single percents', () => {
    expect(percentToFactor('75').toString()).toBe('1.75e0');
    expect(percentToFactor('300').toString()).toBe('4e0');
    expect(percentToFactor('-30').toString()).toBe('7e-1');
    expect(percentToFactor('1000').toString()).toBe('1.1e1');
    expect(percentToFactor('-50').toString()).toBe('5e-1');
    expect(percentToFactor('12.5').toString()).toBe('1.125e0');
    expect(percentToFactor('0').eq(Big.ONE)).toBe(true);
  });
  it('stacking is multiplicative and exact', () => {
    const f100 = percentToFactor('100');
    expect(f100.mul(f100).toString()).toBe('4e0');
    const h = percentToFactor('-50');
    expect(h.mul(h).mul(h).toString()).toBe('1.25e-1');
    expect(h.powInt(3).toString()).toBe('1.25e-1');
  });
  it('rejects factors <= 0 and garbage', () => {
    expectNumericError(() => percentToFactor('-100'), 'INVALID');
    expectNumericError(() => percentToFactor('-150'), 'INVALID');
    expectNumericError(() => percentToFactor('abc'), 'INVALID');
    expectNumericError(() => percentToFactor('1e2'), 'INVALID');
  });
  it('Blood Pact x3: 100 × 1.75^3 = 535.9375 and 1000 × 0.7^3 = 343 exactly', () => {
    const dmg = B(100).mul(percentToFactor('75')).mul(percentToFactor('75')).mul(percentToFactor('75'));
    expect(dmg.toString()).toBe('5.359375e2');
    expect(dmg.eq(B('535.9375'))).toBe(true);
    const hp = B(1000).mul(percentToFactor('-30')).mul(percentToFactor('-30')).mul(percentToFactor('-30'));
    expect(hp.toString()).toBe('3.43e2');
    expect(hp.isInteger()).toBe(true);
    expect(hp.floorInt()).toBe(343n);
    expect(B(100).mul(B('1.75').powInt(3)).toString()).toBe('5.359375e2');
  });
  it('Appendix A1 factors: raw DPS 100 × 1.75 × 1.4 = 245', () => {
    expect(B(100).mul(B('1.75')).mul(B('1.4')).toString()).toBe('2.45e2');
  });
});

describe('round half even at the 34th digit', () => {
  const base = 10n ** 33n; // 1e33 has 34 digits
  it('ties go to even', () => {
    expect(B(base).add(B('0.5')).c).toBe(base); // ...000.5 -> ...000 (even)
    expect(B(base + 1n).add(B('0.5')).c).toBe(base + 2n); // ...001.5 -> ...002
    expect(B(base).add(B('1.5')).c).toBe(base + 2n);
    expect(B(base).add(B('2.5')).c).toBe(base + 2n);
    expect(B('12345678901234567890123456789012345').toString()).toBe('1.234567890123456789012345678901234e34');
    expect(B('12345678901234567890123456789012335').toString()).toBe('1.234567890123456789012345678901234e34');
    expect(B('1.0000000000000000000000000000000005').eq(Big.ONE)).toBe(true);
    expect(B('1.0000000000000000000000000000000015').toString()).toBe('1.000000000000000000000000000000002e0');
  });
  it('above/below ties round to nearest', () => {
    expect(B('1.00000000000000000000000000000000050001').toString()).toBe('1.000000000000000000000000000000001e0');
    expect(B('1.00000000000000000000000000000000049999').eq(Big.ONE)).toBe(true);
  });
  it('carry on rounding renormalizes', () => {
    const x = B('9.999999999999999999999999999999999e33').add(B('0.5'));
    expect(x.toString()).toBe('1e34');
    expect(B('99999999999999999999999999999999995').toString()).toBe('1e35');
  });
  it('mul and div round half even', () => {
    // 3 × 0.3333...(34 digits) = 0.9999...(34 nines): exact, no rounding
    const third = Big.ONE.div(B(3));
    expect(third.toString()).toBe('3.333333333333333333333333333333333e-1');
    expect(B(2).div(B(3)).toString()).toBe('6.666666666666666666666666666666667e-1');
    expect(third.mul(B(3)).toString()).toBe('9.999999999999999999999999999999999e-1');
    // (1e33+1)^2 = 1e66 + 2e33 + 1 -> 1000..0002|000..0001 rounds down
    const y = B(base + 1n);
    expect(y.mul(y).c).toBe(base + 2n);
    // 5e33 + 0.5 style tie through multiplication: 1.000000000000000000000000000000001 × 1.5
    const z = B('1.000000000000000000000000000000001').mul(B('1.5')); // 1.5000000000000000000000000000000015 -> tie -> ...02
    expect(z.toString()).toBe('1.500000000000000000000000000000002e0');
    const w = B('1.000000000000000000000000000000003').mul(B('1.5')); // ...0045 -> tie -> ...004
    expect(w.toString()).toBe('1.500000000000000000000000000000004e0');
  });
});

describe('arithmetic', () => {
  it('basic operations', () => {
    expect(B(2).add(B(3)).toString()).toBe('5e0');
    expect(B(5).sub(B(3)).toString()).toBe('2e0');
    expect(B(6).div(B(4)).toString()).toBe('1.5e0');
    expect(B('1e450').mul(B('1e450')).toString()).toBe('1e900');
    expect(B('0.1').add(B('0.2')).toString()).toBe('3e-1');
    expect(B(7).mulNum(1.5).toString()).toBe('1.05e1');
  });
  it('sub floors at zero', () => {
    expect(B(3).sub(B(5)).zero).toBe(true);
    expect(B(3).sub(B(3)).zero).toBe(true);
    expect(Big.ZERO.sub(B(1)).zero).toBe(true);
    expect(B('1e10').sub(B('1e11')).zero).toBe(true);
    expect(B(3).sub(Big.ZERO).toString()).toBe('3e0');
  });
  it('zero handling', () => {
    expect(Big.ZERO.mul(B('1e99999')).zero).toBe(true);
    expect(Big.ZERO.add(B(5)).toString()).toBe('5e0');
    expect(Big.ZERO.div(B(5)).zero).toBe(true);
    expectNumericError(() => B(5).div(Big.ZERO), 'DIV_ZERO');
    expectNumericError(() => Big.ZERO.div(Big.ZERO), 'DIV_ZERO');
  });
  it('absorbs(): 1e40 + 1 loses the 1 entirely', () => {
    const big = B('1e40');
    expect(big.absorbs(B(1))).toBe(true);
    expect(big.add(B(1)).eq(big)).toBe(true);
    expect(big.absorbs(B('1e7'))).toBe(false);
    expect(big.absorbs(B('5e6'))).toBe(true); // exact tie -> even keeps 1e40
    expect(big.absorbs(B('5.000000000000000000000000000000001e6'))).toBe(false);
    expect(B(1).absorbs(B('1e40'))).toBe(false);
    expect(big.absorbs(Big.ZERO)).toBe(true);
    expect(Big.ZERO.absorbs(B(1))).toBe(false);
    // subtraction of a tiny value from a power of ten
    expect(big.sub(B(1)).eq(big)).toBe(true);
  });
  it('powInt: zero, negative, power of ten fast path, errors', () => {
    expect(B('1.18').powInt(0).eq(Big.ONE)).toBe(true);
    expect(B(2).powInt(10).toString()).toBe('1.024e3');
    expect(B(2).powInt(-2).toString()).toBe('2.5e-1');
    expect(B('1e5').powInt(1000000n).toString()).toBe('1e5000000');
    expect(B('1e5').powInt(-3).toString()).toBe('1e-15');
    expect(Big.ZERO.powInt(3).zero).toBe(true);
    expect(Big.ZERO.powInt(0).eq(Big.ONE)).toBe(true);
    expectNumericError(() => Big.ZERO.powInt(-1), 'DIV_ZERO');
    expectNumericError(() => B(2).powInt(1.5), 'INVALID');
    expectNumericError(() => B(2).powInt(Number.MAX_SAFE_INTEGER + 2), 'INVALID');
  });
  it('powInt is deterministic: repeated evaluation and bigint/number exponents agree', () => {
    const a = B('1.18').powInt(9999);
    for (let i = 0; i < 3; i++) expect(B('1.18').powInt(9999n).toString()).toBe(a.toString());
  });
});

describe('comparison', () => {
  it('orders by exponent first, then coefficient; zero smallest', () => {
    const xs = ['0', '1e-1000000', '0.05', '1', '1.0000000000000000000000000000000001', '1.000000000000000000000000000000001', '9.99', '10', '1e450', '1.5e450', '1e10000', '1e1000000'].map((s) => B(s));
    for (let i = 0; i < xs.length; i++) {
      for (let j = 0; j < xs.length; j++) {
        const expected = xs[i]!.eq(xs[j]!) ? 0 : i < j ? -1 : 1;
        if (i !== j && xs[i]!.eq(xs[j]!)) continue; // '1' and the 35-digit literal round to the same value
        expect(xs[i]!.cmp(xs[j]!)).toBe(expected);
      }
    }
    expect(B(1).lt(B(2)) && B(2).gt(B(1)) && B(2).gte(B(2)) && B(2).lte(B(2)) && B(2).eq(B('2.0'))).toBe(true);
    expect(Big.min(B(1), B(2)).toString()).toBe('1e0');
    expect(Big.max(B(1), B(2)).toString()).toBe('2e0');
    expect(Big.ZERO.cmp(Big.ZERO)).toBe(0);
    expect(Big.ZERO.cmp(B('1e-99999999'))).toBe(-1);
  });
  it('compare is monotonic under add (property)', () => {
    const rnd = mulberry32(7);
    for (let i = 0; i < 2000; i++) {
      const a = randomBig(rnd, 50n);
      const b = randomBig(rnd, 50n);
      expect(a.add(b).gte(a)).toBe(true);
      expect(a.add(b).gte(b)).toBe(true);
      expect(a.sub(b).lte(a)).toBe(true);
      expect(a.cmp(b)).toBe(-b.cmp(a) as -1 | 0 | 1);
      // cmp agrees with float ordering when floats are distinguishable
      const fa = a.log10();
      const fb = b.log10();
      if (Math.abs(fa - fb) > 1e-9) expect(a.cmp(b)).toBe(fa < fb ? -1 : 1);
    }
  });
  it('sorting is a total order consistent with cmp (transitivity sample)', () => {
    const rnd = mulberry32(99);
    const xs = Array.from({ length: 300 }, () => randomBig(rnd, 1000n));
    xs.push(Big.ZERO, Big.ONE);
    const sorted = [...xs].sort((a, b) => a.cmp(b));
    for (let i = 1; i < sorted.length; i++) expect(sorted[i - 1]!.lte(sorted[i]!)).toBe(true);
  });
});

describe('properties', () => {
  it('mul is commutative and add is commutative', () => {
    const rnd = mulberry32(12345);
    for (let i = 0; i < 3000; i++) {
      const a = randomBig(rnd, 5000n);
      const b = randomBig(rnd, 5000n);
      expect(a.mul(b).eq(b.mul(a))).toBe(true);
      expect(a.add(b).eq(b.add(a))).toBe(true);
    }
  });
  it('wire and compact roundtrip (incl. huge exponents)', () => {
    const rnd = mulberry32(424242);
    const xs: Big[] = [Big.ZERO, Big.ONE, B('1e10000'), B('7.1e1000000'), B('1.23e-1000000'), B('9.999999999999999999999999999999999e999999999999')];
    for (let i = 0; i < 3000; i++) xs.push(randomBig(rnd, 10n ** 12n));
    for (const x of xs) {
      const w = x.toWire();
      const w2 = JSON.parse(JSON.stringify(w)) as typeof w;
      const back = Big.fromWire(w2);
      expect(back.eq(x)).toBe(true);
      expect(back.c).toBe(x.c);
      expect(Big.fromCompact(x.toCompact()).eq(x)).toBe(true);
      expect(Big.from(x.toString()).eq(x)).toBe(true);
      expect(JSON.stringify(x)).toBe(JSON.stringify(w)); // toJSON
      if (!x.zero) expect(w.m).toMatch(/^[1-9](\.\d{1,33})?$/);
    }
  });
  it('wire/compact formats', () => {
    expect(B('1.2345e450').toWire()).toEqual({ m: '1.2345', e: '450', zero: false });
    expect(B(175).toWire()).toEqual({ m: '1.75', e: '2', zero: false });
    expect(B(2).toWire()).toEqual({ m: '2', e: '0', zero: false });
    expect(Big.ZERO.toWire()).toEqual({ m: '0', e: '0', zero: true });
    expect(B(175).toCompact()).toBe('175|2');
    expect(B('1.75e-3').toCompact()).toBe('175|-3');
    expect(Big.ZERO.toCompact()).toBe('0');
    expect(Big.fromCompact('175|2').toString()).toBe('1.75e2');
    expect(Big.fromCompact('0').zero).toBe(true);
  });
  it('fromWire / fromCompact validation', () => {
    const bad: unknown[] = [
      { m: '0', e: '0', zero: false },
      { m: '1.0.0', e: '1', zero: false },
      { m: '12', e: '1', zero: false },
      { m: '1.', e: '1', zero: false },
      { m: '1.' + '1'.repeat(34), e: '1', zero: false },
      { m: '1', e: '1.5', zero: false },
      { m: '1', e: '1'.repeat(4097), zero: false },
      { m: '1', e: '', zero: false },
      { m: '-1', e: '1', zero: false },
      { m: '1', e: '0', zero: true },
      { m: 1, e: '0', zero: false },
      { m: '1', e: '0' },
      null,
      'x',
    ];
    for (const w of bad) expectNumericError(() => Big.fromWire(w as never), 'INVALID');
    expect(Big.fromWire({ m: '1', e: '-' + '9'.repeat(4096), zero: false }).e).toBe(-(10n ** 4096n - 1n));
    for (const s of ['', '1', '|1', '01|1', '1|', '1|1.5', '1'.repeat(35) + '|1', 'a|b']) expectNumericError(() => Big.fromCompact(s), 'INVALID');
  });
});

describe('huge values (PRD §11.3 validation horizon)', () => {
  it('values above 1e10000 and 1e1000000 serialize/parse/compare/rank without Infinity/NaN', () => {
    const r10000 = B('1.18').powInt(200000); // ~2.5e14376
    const huge = B('7.1').powInt(1200000); // ~1.04e1021510
    expect(r10000.gt(B('1e10000'))).toBe(true);
    expect(huge.gt(B('1e1000000'))).toBe(true);
    expect(huge.gt(r10000)).toBe(true);
    for (const x of [r10000, huge, B('1e10000'), B('1e1000000')]) {
      const s = x.toString();
      expect(s).not.toMatch(/Infinity|NaN/);
      expect(Big.from(s).eq(x)).toBe(true);
      expect(Big.fromWire(x.toWire()).eq(x)).toBe(true);
      expect(Big.fromCompact(x.toCompact()).eq(x)).toBe(true);
      expect(Number.isFinite(x.log10())).toBe(true);
      expect(x.toNumber()).toBe(Infinity); // display-only float view is allowed to overflow
    }
    expect(huge.log10()).toBeCloseTo(1021510.0184, 3);
    const ranked = [huge, B('1e10000'), r10000, B('1e1000000')].sort((a, b) => b.cmp(a));
    expect(ranked.map((x) => x.toString())).toEqual([huge, B('1e1000000'), r10000, B('1e10000')].map((x) => x.toString()));
    expect(r10000.ratio(r10000.mul(B(2)))).toBeCloseTo(0.5, 12);
    expect(B('1e100000').ratio(B('1e100000'))).toBe(1);
    expect(huge.ratio(B(1))).toBe(1e308);
    expect(B(1).ratio(huge)).toBe(0);
  });
  it('arbitrary exponents far beyond 1e1000000 still work', () => {
    const x = Big.fromParts(10n ** 33n, 10n ** 18n);
    expect(x.mul(x).e).toBe(2n * 10n ** 18n);
    expect(x.div(x).eq(Big.ONE)).toBe(true);
    expect(x.add(Big.ONE).eq(x)).toBe(true);
    expect(Number.isFinite(x.log10())).toBe(true);
  });
});

describe('float views and integer views', () => {
  it('log10', () => {
    expect(Big.ZERO.log10()).toBe(-Infinity);
    expect(B(1000).log10()).toBe(3);
    expect(B('2.5e-7').log10()).toBeCloseTo(Math.log10(2.5e-7), 12);
    expect(Number.isNaN(Big.fromParts(1n, 10n ** 400n).log10())).toBe(false);
  });
  it('toNumber', () => {
    expect(B('163.27').toNumber()).toBe(163.27);
    expect(B('1e400').toNumber()).toBe(Infinity);
    expect(B('1e-500').toNumber()).toBe(0);
    expect(Big.ZERO.toNumber()).toBe(0);
    expect(Object.is(Big.ZERO.toNumber(), -0)).toBe(false);
  });
  it('ratio', () => {
    expect(B(3).ratio(B(4))).toBe(0.75);
    expect(B(3).ratio(Big.ZERO)).toBe(Infinity);
    expect(Big.ZERO.ratio(Big.ZERO)).toBe(0);
    expect(Big.ZERO.ratio(B(3))).toBe(0);
    expect(B('1e100000').ratio(B('2e100000'))).toBe(0.5);
    expect(B('1e400').ratio(B(1))).toBe(1e308);
  });
  it('floorInt and isInteger', () => {
    expect(B('535.9375').floorInt()).toBe(535n);
    expect(B('535.9375').isInteger()).toBe(false);
    expect(B('0.999').floorInt()).toBe(0n);
    expect(B('1e-40').floorInt()).toBe(0n);
    expect(B('1e40').floorInt()).toBe(10n ** 40n);
    expect(B('1.5e40').isInteger()).toBe(true);
    expect(B('0.5').isInteger()).toBe(false);
    expect(Big.ZERO.isInteger()).toBe(true);
    expect(Big.ZERO.isZero()).toBe(true);
    expect(B(343).isInteger()).toBe(true);
    expect(B('1e1000').floorInt().toString().length).toBe(1001);
    expectNumericError(() => B('1e100000000').floorInt(), 'RANGE');
  });
});
