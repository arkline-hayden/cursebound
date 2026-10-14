import { describe, expect, it } from 'vitest';
import { Big, formatBig, formatExact } from '../src/index';
import { mulberry32, randomBig } from './helpers';

const f = (s: string, opts?: { decimals?: number; sig?: number }) => formatBig(Big.from(s), opts);

describe('formatBig (PRD §10.1)', () => {
  it('small values: up to 2 decimals, trailing zeros trimmed', () => {
    expect(f('0')).toBe('0');
    expect(f('245')).toBe('245');
    expect(f('163.27')).toBe('163.27');
    expect(f('163.2749')).toBe('163.27');
    expect(f('163.275')).toBe('163.28'); // tie -> even (8)
    expect(f('163.265')).toBe('163.26'); // tie -> even (6)
    expect(f('0.05')).toBe('0.05');
    expect(f('0.5')).toBe('0.5');
    expect(f('1.10')).toBe('1.1');
    expect(f('999.99')).toBe('999.99');
    expect(f('12.3456', { decimals: 3 })).toBe('12.346');
    expect(f('12.6', { decimals: 0 })).toBe('13');
  });
  it('suffix range 1e3..1e15 with 3 significant digits', () => {
    expect(f('1234')).toBe('1.23K');
    expect(f('45600000')).toBe('45.6M');
    expect(f('850000000')).toBe('850M');
    expect(f('3400000000')).toBe('3.40B');
    expect(f('1540000000000')).toBe('1.54T');
    expect(f('999000000000000')).toBe('999T');
    expect(f('1000')).toBe('1.00K');
    expect(f('999.996')).toBe('1.00K'); // rounds up out of the small range
    expect(f('999600')).toBe('1.00M'); // carries into the next suffix
    expect(f('999999999999999')).toBe('1.00e15'); // carries into scientific
  });
  it('scientific for >= 1e15 and tiny values', () => {
    expect(f('1.23e15')).toBe('1.23e15');
    expect(f('1.54e450')).toBe('1.54e450');
    expect(f('7.1e1000000')).toBe('7.10e1000000');
    expect(f('0.0005')).toBe('5.00e-4');
    expect(f('0.009999')).toBe('1.00e-2');
    expect(f('1.2345e-999999')).toBe('1.23e-999999');
    expect(f('1.23e15', { sig: 5 })).toBe('1.2300e15');
    expect(f('5e20', { sig: 1 })).toBe('5e20');
  });
  it('never returns Infinity / NaN / -0 across extreme inputs', () => {
    const rnd = mulberry32(2026);
    const xs = [
      Big.ZERO,
      Big.ONE,
      Big.from('1e-1000000'),
      Big.from('9.999999999999999999999999999999999e999999999999'),
      Big.fromParts(1n, -(10n ** 30n)),
      Big.fromParts(1n, 10n ** 30n),
      Big.from(Number.MAX_VALUE),
      Big.from(Number.MIN_VALUE),
      Big.from('0.004999'),
      Big.from('0.005'),
      Big.from('999.995'),
    ];
    for (let i = 0; i < 3000; i++) xs.push(randomBig(rnd, 10n ** 9n));
    for (const x of xs) {
      for (const opts of [undefined, { decimals: 0 }, { decimals: 4, sig: 1 }, { sig: 34 }, { decimals: NaN, sig: Infinity }]) {
        const s = formatBig(x, opts);
        expect(s).not.toMatch(/Infinity|NaN|^-/);
        expect(s.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('formatExact', () => {
  it('groups integers up to 1e21, exact fractions, canonical beyond', () => {
    expect(formatExact(Big.from(1234567))).toBe('1,234,567');
    expect(formatExact(Big.ZERO)).toBe('0');
    expect(formatExact(Big.from(999))).toBe('999');
    expect(formatExact(Big.from('1e21'))).toBe('1,000,000,000,000,000,000,000');
    expect(formatExact(Big.from('1.000000000000000000000000000000001e21'))).toBe('1.000000000000000000000000000000001e21');
    expect(formatExact(Big.from('1e450'))).toBe('1e450');
    expect(formatExact(Big.from('535.9375'))).toBe('535.9375');
    expect(formatExact(Big.from('1234.5'))).toBe('1,234.5');
    expect(formatExact(Big.from('0.05'))).toBe('0.05');
    expect(formatExact(Big.from('1.5e-40'))).toBe('0.00000000000000000000000000000000000000015');
  });
});
