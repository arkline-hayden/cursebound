import { Big } from './big';
import { NumericError } from './errors';

const PERCENT_RE = /^([+-]?)(\d+)(?:\.(\d+))?$/;

/**
 * Factor for "X_new = X_old × (1 + p/100)". p is a decimal string like '75', '-30', '1000', '-50', '12.5'.
 * Exact (rounded to 34 digits only if p itself has more digits). Throws NumericError('INVALID') if the factor <= 0.
 */
export function percentToFactor(p: string): Big {
  if (typeof p !== 'string') throw new NumericError('INVALID', 'percent must be a decimal string');
  const m = PERCENT_RE.exec(p);
  if (m === null) throw new NumericError('INVALID', `bad percent: ${JSON.stringify(p.slice(0, 64))}`);
  const frac = m[3] ?? '';
  const mag = BigInt(m[2]! + frac); // |p| × 10^f
  const f = frac.length;
  // factor = (100 × 10^f ± mag) × 10^-(f+2)
  const num = 100n * 10n ** BigInt(f) + (m[1] === '-' ? -mag : mag);
  if (num <= 0n) throw new NumericError('INVALID', `percent ${p} gives a factor <= 0`);
  return Big.fromParts(num, 33n - BigInt(f + 2));
}
