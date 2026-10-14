import { Big, formatBig, formatExact, formatScore } from '@cursebound/numeric';

// Display helpers (PRD §10.1): never Infinity/NaN/-0; scientific notation beyond suffixes; exact detail on demand.
export function big(compact: string | null | undefined): Big {
  if (!compact) return Big.ZERO;
  try { return Big.fromCompact(compact); } catch { return Big.ZERO; }
}
export const fmt = (compact: string | null | undefined, decimals = 2) => formatBig(big(compact), { decimals });
export const exact = (compact: string | null | undefined) => formatExact(big(compact));
/** Values below this display as whole numbers; at or above it they switch to compact suffix form (1.23M, 4.5e21). */
export const WHOLE_LIMIT = 100_000;
/** Stat readouts (life, shields, damage, tallies): whole numbers below 100,000 ("820", "12,345"), compact above.
 *  Fractions are floored, except a positive value below 1 shows "1" so a living thing never reads as 0. */
export function whole(compact: string | null | undefined): string {
  const b = big(compact);
  if (b.isZero()) return '0';
  const n = b.toNumber();
  if (Number.isFinite(n) && Math.abs(n) < WHOLE_LIMIT) return wholeNum(n);
  return formatBig(b);
}
/** Same rule for plain JS numbers (resource pools, counts). */
export function wholeNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= WHOLE_LIMIT) return formatBig(Big.from(String(Math.floor(n))));
  const v = n > 0 && n < 1 ? 1 : Math.floor(n);
  return Math.abs(v) >= 10_000 ? v.toLocaleString('en-US') : String(v);
}
export const score = (text: string | null | undefined) => formatScore(text || '0');
export function ratio(after: string, before: string): number {
  const b = big(before);
  if (b.isZero()) return big(after).isZero() ? 1 : Infinity;
  return big(after).ratio(b);
}
export function changeLabel(after: string, before: string): string {
  const r = ratio(after, before);
  if (!Number.isFinite(r)) return 'from zero';
  if (Math.abs(r - 1) < 1e-9) return 'unchanged';
  if (r >= 1) return r < 1000 ? `×${trim(r)}` : `×${r.toExponential(2)}`;
  return `×${r < 0.001 ? r.toExponential(2) : trim(r)}`;
}
function trim(r: number) { return r.toFixed(r >= 10 ? 1 : 3).replace(/\.?0+$/, ''); }
export const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 2 : 1).replace(/\.0+$/, '')}%`;
export function seconds(compact: string): string {
  const b = big(compact);
  if (b.isZero()) return '—';
  const n = b.toNumber();
  if (!Number.isFinite(n) || n > 1e7) return `${formatBig(b)} s`;
  if (n < 1) return `${(n * 1000).toFixed(0)} ms`;
  if (n < 120) return `${n.toFixed(n < 10 ? 2 : 1)} s`;
  return `${(n / 60).toFixed(1)} min`;
}
