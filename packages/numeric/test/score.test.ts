import { describe, expect, it } from 'vitest';
import { Big, NumericError, compareScoreText, floorMulBig, formatScore, scoreFromText, scoreToText } from '../src/index';

describe('score text (PRD §13.1, Appendix A4)', () => {
  it('Appendix A4 sort fixture: digit length desc, then lexical desc', () => {
    const scores = ['1000', '9', '1000000000000000000000000', '10', '999'];
    const sorted = [...scores].sort((a, b) => compareScoreText(b, a));
    expect(sorted).toEqual(['1000000000000000000000000', '1000', '999', '10', '9']);
    // agrees with BigInt ordering
    const viaBig = [...scores].sort((a, b) => (BigInt(b) > BigInt(a) ? 1 : BigInt(b) < BigInt(a) ? -1 : 0));
    expect(sorted).toEqual(viaBig);
    expect(compareScoreText('0', '0')).toBe(0);
    expect(compareScoreText('0', '1')).toBe(-1);
    expect(compareScoreText('10', '9')).toBe(1);
  });
  it('canonical roundtrip and validation', () => {
    for (const n of [0n, 9n, 10n, 999n, 1000n, 10n ** 24n, 3n ** 500n]) {
      const t = scoreToText(n);
      expect(scoreFromText(t)).toBe(n);
    }
    expect(scoreToText(1000000000000000000000000n)).toBe('1000000000000000000000000');
    for (const bad of ['', '01', '-1', '1.0', '1e3', ' 1', 'abc', '1'.repeat(1_000_001)]) {
      expect(() => scoreFromText(bad)).toThrow(NumericError);
    }
    expect(scoreFromText('1'.repeat(1000)).toString().length).toBe(1000);
    expect(() => scoreToText(-1n)).toThrow(NumericError);
  });
  it('formatScore', () => {
    expect(formatScore('0')).toBe('0');
    expect(formatScore('2125')).toBe('2,125');
    expect(formatScore('1234567')).toBe('1,234,567');
    expect(formatScore('123456789012345678901')).toBe('123,456,789,012,345,678,901');
    expect(formatScore('1234' + '0'.repeat(42))).toBe('1.234e45');
    expect(() => formatScore('012')).toThrow(NumericError);
  });
});

describe('floorMulBig', () => {
  it('worked score fixture (PRD §13.2)', () => {
    expect(floorMulBig(1000n, Big.from(2), 510n, 480n)).toBe(2125n);
    expect(floorMulBig(600n, Big.from(2), 4n, 10n)).toBe(480n);
  });
  it('exact with fractional and huge multipliers', () => {
    expect(floorMulBig(100n, Big.from('1.75'), 1n, 1n)).toBe(175n);
    expect(floorMulBig(3n, Big.from('0.3333333333333333333333333333333333'), 1n, 1n)).toBe(0n);
    expect(floorMulBig(7n, Big.from('1e30'), 1n, 3n)).toBe(2333333333333333333333333333333n);
    expect(floorMulBig(100n, Big.from('1e-40'), 1n, 1n)).toBe(0n);
    expect(floorMulBig(100n, Big.from('1e-1000000000'), 1n, 1n)).toBe(0n);
    expect(floorMulBig(1500n, Big.from('1e1000'), 1n, 1n).toString()).toBe('15' + '0'.repeat(1002));
    expect(floorMulBig(0n, Big.from('1e1000'), 1n, 1n)).toBe(0n);
    expect(floorMulBig(5n, Big.ZERO, 1n, 1n)).toBe(0n);
  });
  it('rejects invalid arguments', () => {
    expect(() => floorMulBig(-1n, Big.ONE, 1n, 1n)).toThrow(NumericError);
    expect(() => floorMulBig(1n, Big.ONE, 1n, 0n)).toThrow(NumericError);
    expect(() => floorMulBig(1n, Big.from('1e100000000'), 1n, 1n)).toThrow(NumericError);
  });
});
