/**
 * Cached powers of ten and integer helpers shared by the numeric package.
 * Everything here is pure bigint arithmetic (deterministic in every engine).
 */

/** Number of eagerly cached powers of ten (10^0 .. 10^(CACHE_SIZE-1)). */
const CACHE_SIZE = 256;

/** P[k] = 10n ** k for k < CACHE_SIZE. */
export const P: readonly bigint[] = (() => {
  const out: bigint[] = new Array<bigint>(CACHE_SIZE);
  let v = 1n;
  for (let i = 0; i < CACHE_SIZE; i++) {
    out[i] = v;
    v *= 10n;
  }
  return out;
})();

/** H[k] = P[k] / 2 (exact for k >= 1; H[0] is unused). */
export const H: readonly bigint[] = P.map((p) => p / 2n);

/** 10^k for any nonnegative integer k (cached for small k). */
export function pow10(k: number): bigint {
  return k < CACHE_SIZE ? P[k]! : 10n ** BigInt(k);
}

/**
 * Number of decimal digits of x (x > 0). Binary search over the cache for typical sizes
 * (no string conversion); falls back to string length only for numbers with >= 256 digits.
 */
export function digitCount(x: bigint): number {
  if (x < P[CACHE_SIZE - 1]!) {
    // smallest k with x < P[k]  => digits = k
    let lo = 1;
    let hi = CACHE_SIZE - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (x < P[mid]!) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }
  return x.toString().length;
}

/** round(x / 10^k) with ties to even; x >= 0, k >= 0. `sticky` = true means the true value is slightly above x. */
export function roundDiv10(x: bigint, k: number, sticky = false): bigint {
  if (k === 0) return x; // exact (sticky can only matter when k > 0; callers guarantee this)
  if (k < CACHE_SIZE) {
    const d = P[k]!;
    const q = x / d;
    const r = x - q * d;
    const h = H[k]!;
    if (r > h || (r === h && (sticky || (q & 1n) === 1n))) return q + 1n;
    return q;
  }
  const d = 10n ** BigInt(k);
  const q = x / d;
  const r = x - q * d;
  const h = d / 2n;
  if (r > h || (r === h && (sticky || (q & 1n) === 1n))) return q + 1n;
  return q;
}

/** Integer square root floor(sqrt(n)) for n >= 0 (Newton iteration, deterministic). */
export function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  // initial guess from digit count: 10^ceil(d/2) >= sqrt(n)
  let x = pow10(Math.ceil(digitCount(n) / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}
