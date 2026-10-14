/**
 * Deterministic sampling helper used by combat compression (PRD §12.1).
 */
import { Big } from './big';
import { NumericError } from './errors';
import { P, isqrt, roundDiv10 } from './pow10';

export const BINOMIAL_EXACT_MAX = 64;
export const BINOMIAL_APPROX_VERSION = 'binom-normal-v1';

const TWO53 = 9007199254740992; // 2^53
const BIG64 = Big.from(BINOMIAL_EXACT_MAX);
/** Below this k the normal approximation runs in floats (k exactly representable); above it in Big arithmetic. */
const FLOAT_K_LIMIT_E = 15n; // k < 1e15 < 2^53

function checkDraw(u: number): number {
  if (typeof u !== 'number' || !(u >= 0 && u < 1)) throw new NumericError('INVALID', `next() must return a number in [0,1): ${String(u)}`);
  return u;
}

/** Exact test u < num/den for a double u in [0,1). T = ceil(num × 2^53 / den) is the fast threshold for u ∈ 2^-53 ℤ. */
function below(u: number, num: bigint, den: bigint, T: number): boolean {
  const s = u * TWO53;
  if (Number.isInteger(s)) return s < T;
  // u has bits finer than 2^-53: exact rational comparison (doubling is exact in binary floating point).
  let m = s;
  let exp = 53;
  while (!Number.isInteger(m)) {
    m *= 2;
    exp++;
  }
  return BigInt(m) * den < num << BigInt(exp);
}

/** Deterministic cos(2πu) for u in [0,1) using only + − × (no Math.cos), |error| < 1e-14. */
function cos2pi(u: number): number {
  let v = u;
  if (v > 0.5) v = 1 - v; // exact (Sterbenz)
  let sign = 1;
  if (v > 0.25) {
    v = 0.5 - v; // exact (Sterbenz)
    sign = -1;
  }
  const x = 2 * Math.PI * v; // [0, π/2]
  const x2 = x * x;
  // Taylor series of cos up to x^20 via Horner; coefficients (−1)^n/(2n)!
  let r = 1 / 2432902008176640000; // 1/20!
  r = -1 / 6402373705728000 + x2 * r; // 1/18!
  r = 1 / 20922789888000 + x2 * r; // 1/16!
  r = -1 / 87178291200 + x2 * r; // 1/14!
  r = 1 / 479001600 + x2 * r; // 1/12!
  r = -1 / 3628800 + x2 * r; // 1/10!
  r = 1 / 40320 + x2 * r; // 1/8!
  r = -1 / 720 + x2 * r; // 1/6!
  r = 1 / 24 + x2 * r; // 1/4!
  r = -1 / 2 + x2 * r; // 1/2!
  r = 1 + x2 * r;
  return sign * r;
}

function roundHalfEvenFloat(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Round a Big to the nearest integer, ties to even. */
function roundIntHalfEven(x: Big): Big {
  if (x.zero || x.e >= 33n) return x;
  const shift = 33n - x.e;
  if (shift > 34n) return Big.ZERO;
  const q = roundDiv10(x.c, Number(shift));
  return q === 0n ? Big.ZERO : Big.fromParts(q, 33n);
}

/** Deterministic approximate square root (floor of the 34-35 digit integer root, then rounded). */
function sqrtBig(v: Big): Big {
  if (v.zero) return Big.ZERO;
  let t = v.e - 33n; // v = c × 10^t
  let C: bigint;
  if ((t & 1n) !== 0n) {
    C = v.c * P[35]!;
    t -= 35n;
  } else {
    C = v.c * P[34]!;
    t -= 34n;
  }
  return Big.fromParts(isqrt(C), t / 2n + 33n);
}

/**
 * Deterministic binomial sample of k trials with success probability q = qNum/qDen.
 * - k <= 64: exactly k Bernoulli trials consuming exactly k draws; trial succeeds when next() < q (exact rational test).
 * - k > 64: 'binom-normal-v1': consumes exactly 2 draws u1, u2; z = sqrt(−2 ln(1 − u1)) × cos(2π u2) (deterministic polynomial cos);
 *   result = roundHalfEven(k·q + z·sqrt(k·q·(1−q))) clamped to [0, k]. Floats for k < 1e15, Big arithmetic beyond.
 * Returns the success count as an integer Big.
 */
export function sampleBinomial(k: Big, qNum: bigint, qDen: bigint, next: () => number): Big {
  if (!(k instanceof Big) || !k.isInteger()) throw new NumericError('INVALID', 'k must be an integer Big');
  if (typeof qNum !== 'bigint' || typeof qDen !== 'bigint' || qDen <= 0n || qNum < 0n || qNum > qDen) {
    throw new NumericError('INVALID', 'q must satisfy 0 <= qNum <= qDen, qDen > 0');
  }
  if (k.zero) return Big.ZERO;

  if (k.lte(BIG64)) {
    const n = Number(k.floorInt());
    const num = (qNum << 53n) + qDen - 1n;
    const T = Number(num / qDen); // ceil(qNum × 2^53 / qDen) <= 2^53, exact as a double
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (below(checkDraw(next()), qNum, qDen, T)) count++;
    }
    return count === 0 ? Big.ZERO : Big.from(count);
  }

  const u1 = checkDraw(next());
  const u2 = checkDraw(next());
  if (qNum === 0n) return Big.ZERO;
  if (qNum === qDen) return k;
  const z = Math.sqrt(-2 * Math.log(1 - u1)) * cos2pi(u2);

  if (k.e < FLOAT_K_LIMIT_E) {
    const kf = Number(k.floorInt());
    const qf = Number((qNum << 53n) / qDen) / TWO53;
    const mean = kf * qf;
    const sd = Math.sqrt(kf * qf * (1 - qf));
    let r = roundHalfEvenFloat(mean + sd * z);
    if (!(r > 0)) r = 0; // also maps -0 / NaN to 0
    if (r > kf) r = kf;
    return r === 0 ? Big.ZERO : Big.from(BigInt(r));
  }

  const qB = Big.fromParts(qNum, 33n).div(Big.fromParts(qDen, 33n));
  const pB = Big.fromParts(qDen - qNum, 33n).div(Big.fromParts(qDen, 33n));
  const mean = k.mul(qB);
  const sd = sqrtBig(mean.mul(pB));
  const az = Math.abs(z);
  const off = az === 0 ? Big.ZERO : sd.mul(Big.from(az));
  const x = z >= 0 ? mean.add(off) : mean.sub(off);
  return Big.min(roundIntHalfEven(x), k);
}
