/**
 * Canonical arbitrary precision nonnegative integer score text (PRD §13.1, §20.2, Appendix A4).
 */
import { Big, MAX_INT_EXPAND_DIGITS } from './big';
import { NumericError } from './errors';
import { digitCount, pow10 } from './pow10';

const SCORE_RE = /^(?:0|[1-9]\d*)$/;
export const MAX_SCORE_DIGITS = 1_000_000;

/** Canonical decimal text of a nonnegative integer (no leading zeros except '0'). */
export function scoreToText(n: bigint): string {
  if (typeof n !== 'bigint') throw new NumericError('INVALID', 'score must be a bigint');
  if (n < 0n) throw new NumericError('INVALID', 'score must be >= 0');
  return n.toString();
}

/** Parse canonical score text /^(0|[1-9]\d*)$/ with at most 1,000,000 digits. */
export function scoreFromText(s: string): bigint {
  if (typeof s !== 'string' || s.length === 0 || s.length > MAX_SCORE_DIGITS || !SCORE_RE.test(s)) {
    throw new NumericError('INVALID', `non-canonical score text: ${JSON.stringify(String(s).slice(0, 64))}`);
  }
  return BigInt(s);
}

/** Ascending numeric comparison of canonical score texts: digit count first, then lexical (no BigInt conversion). */
export function compareScoreText(a: string, b: string): -1 | 0 | 1 {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Comma grouping of a digit string: '1234567' -> '1,234,567'. */
export function groupDigits(digits: string): string {
  const head = digits.length % 3 || 3;
  let out = digits.slice(0, head);
  for (let i = head; i < digits.length; i += 3) out += ',' + digits.slice(i, i + 3);
  return out;
}

/** Grouped with commas up to 21 digits ('1,234,567'), else '1.234e45' (truncated to 4 significant digits). */
export function formatScore(s: string): string {
  if (typeof s !== 'string' || !SCORE_RE.test(s)) throw new NumericError('INVALID', 'non-canonical score text');
  if (s.length <= 21) return groupDigits(s);
  return `${s[0]}.${s.slice(1, 4)}e${s.length - 1}`;
}

/** floor(b × M × num / den) exactly. b >= 0, num >= 0, den > 0. M may have a huge exponent. */
export function floorMulBig(b: bigint, M: Big, num: bigint, den: bigint): bigint {
  if (typeof b !== 'bigint' || typeof num !== 'bigint' || typeof den !== 'bigint') {
    throw new NumericError('INVALID', 'floorMulBig expects bigint b/num/den');
  }
  if (b < 0n || num < 0n) throw new NumericError('INVALID', 'floorMulBig expects b >= 0 and num >= 0');
  if (den <= 0n) throw new NumericError('DIV_ZERO', 'floorMulBig expects den > 0');
  if (M.zero || b === 0n || num === 0n) return 0n;
  const X = b * M.c * num;
  const shift = M.e - 33n; // M = c × 10^shift
  if (shift >= 0n) {
    if (shift > BigInt(MAX_INT_EXPAND_DIGITS)) throw new NumericError('RANGE', 'floorMulBig result too large to materialize');
    return (X * pow10(Number(shift))) / den;
  }
  const k = -shift;
  if (k > BigInt(digitCount(X))) return 0n; // X < 10^k <= den × 10^k
  return X / (den * pow10(Number(k)));
}
