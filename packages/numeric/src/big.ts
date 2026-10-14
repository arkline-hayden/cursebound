/**
 * Canonical large nonnegative decimal quantity (REQ NUM01, PRD §11.2).
 *
 * A nonzero value is `c × 10^(e − 33)` with `10^33 <= c < 10^34` (34 significant digits), so `e` is the
 * decimal exponent of the leading digit. Zero is `c = 0n, e = 0n, zero = true`.
 * Every operation rounds its exact result to 34 significant digits with round-half-even.
 * Hot-path operations (mul/div/add/sub/cmp) work purely on bigint coefficients/exponents (no strings).
 */
import { NumericError } from './errors';
import { P, digitCount, pow10, roundDiv10 } from './pow10';

export const PRECISION = 34;
export const NUMERIC_VERSION = 'num-1.0.0';

/** Wire form: e.g. {m:'1.2345', e:'450', zero:false}; zero -> {m:'0', e:'0', zero:true}. */
export interface BigWire {
  m: string;
  e: string;
  zero: boolean;
}

const C_MIN = P[33]!; // 10^33: coefficient of an exact power of ten
const C_LIMIT = P[34]!; // 10^34: exclusive upper bound of the coefficient
const P67 = P[67]!;
const P35 = P[35]!;
/** Exponent difference at/after which the smaller operand cannot change the larger at 34 digits (add and sub). */
const ABSORB_DIFF = 36n;
/** Largest number of trailing zeros floorInt()/floorMulBig() will materialize (transport/memory safeguard). */
export const MAX_INT_EXPAND_DIGITS = 10_000_000;

const DECIMAL_RE = /^(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;
const WIRE_M_RE = /^[1-9](?:\.\d{1,33})?$/;
const WIRE_E_RE = /^-?\d{1,4096}$/;
const COMPACT_RE = /^([1-9]\d{0,33})\|(-?\d{1,4096})$/;

// Internal factory (assigned in the class static block so module helpers can bypass validation).
let mk: (c: bigint, e: bigint) => Big;

/**
 * Normalize value = C × 10^(E − 33) for any positive bigint C (any number of digits).
 * `sticky` signals that the true value is strictly greater than C × 10^(E−33) (used by division).
 */
function norm(C: bigint, E: bigint, sticky = false): Big {
  const d = digitCount(C);
  if (d === 34) return mk(C, E);
  if (d < 34) return mk(C * P[34 - d]!, E + BigInt(d - 34));
  const k = d - 34;
  let q = roundDiv10(C, k, sticky);
  let e = E + BigInt(k);
  if (q === C_LIMIT) {
    q = C_MIN;
    e += 1n;
  }
  return mk(q, e);
}

function trimmedDigits(c: bigint): string {
  const s = c.toString();
  let end = s.length;
  while (end > 1 && s.charCodeAt(end - 1) === 48 /* '0' */) end--;
  return s.slice(0, end);
}

function parseDecimal(s: string): Big {
  const m = DECIMAL_RE.exec(s);
  if (m === null) throw new NumericError('INVALID', `not a nonnegative decimal: ${JSON.stringify(s.slice(0, 64))}`);
  const intPart = m[1] ?? '';
  const frac = m[2] ?? m[3] ?? '';
  let digits = intPart + frac;
  let i = 0;
  while (i < digits.length - 1 && digits.charCodeAt(i) === 48) i++;
  digits = digits.slice(i);
  const exp = m[4] !== undefined ? BigInt(m[4]) : 0n;
  if (digits === '0' || digits === '') return Big.ZERO;
  return norm(BigInt(digits), exp - BigInt(frac.length) + 33n);
}

export class Big {
  /** 34-digit coefficient (0n for zero). */
  readonly c: bigint;
  /** Decimal exponent of the leading digit (0n for zero). */
  readonly e: bigint;
  /** Explicit zero tag. */
  readonly zero: boolean;

  static readonly ZERO: Big = new Big(0n, 0n);
  static readonly ONE: Big = new Big(C_MIN, 0n);

  static {
    mk = (c: bigint, e: bigint) => new Big(c, e);
  }

  private constructor(c: bigint, e: bigint) {
    this.c = c;
    this.e = e;
    this.zero = c === 0n;
    Object.freeze(this);
  }

  // ---------------------------------------------------------------- construction

  /** number (finite, >= 0, via String(x)), decimal string, bigint (>= 0), BigWire or Big. */
  static from(x: number | string | bigint | BigWire | Big): Big {
    if (x instanceof Big) return x;
    switch (typeof x) {
      case 'number':
        if (!Number.isFinite(x) || x < 0) throw new NumericError('INVALID', `number must be finite and >= 0: ${String(x)}`);
        if (x === 0) return Big.ZERO;
        return parseDecimal(String(x));
      case 'string':
        return parseDecimal(x);
      case 'bigint':
        if (x < 0n) throw new NumericError('INVALID', 'bigint must be >= 0');
        if (x === 0n) return Big.ZERO;
        return norm(x, 33n);
      case 'object':
        if (x !== null) return Big.fromWire(x);
        break;
      default:
        break;
    }
    throw new NumericError('INVALID', `unsupported input type: ${x === null ? 'null' : typeof x}`);
  }

  /** value = c × 10^(e − 33) for any nonnegative c (any number of digits); rounds half-even to 34 digits. */
  static fromParts(c: bigint, e: bigint): Big {
    if (typeof c !== 'bigint' || typeof e !== 'bigint') throw new NumericError('INVALID', 'fromParts expects bigints');
    if (c < 0n) throw new NumericError('INVALID', 'coefficient must be >= 0');
    if (c === 0n) return Big.ZERO;
    return norm(c, e);
  }

  // ---------------------------------------------------------------- arithmetic (hot paths)

  mul(b: Big): Big {
    if (this.zero || b.zero) return Big.ZERO;
    const ac = this.c;
    const bc = b.c;
    if (ac === C_MIN) return this.e === 0n ? b : mk(bc, this.e + b.e);
    if (bc === C_MIN) return b.e === 0n ? this : mk(ac, this.e + b.e);
    const C = ac * bc; // in [10^66, 10^68)
    let e = this.e + b.e;
    let q: bigint;
    if (C >= P67) {
      q = roundDiv10(C, 34);
      e += 1n;
    } else {
      q = roundDiv10(C, 33);
    }
    if (q === C_LIMIT) {
      q = C_MIN;
      e += 1n;
    }
    return mk(q, e);
  }

  div(b: Big): Big {
    if (b.zero) throw new NumericError('DIV_ZERO', 'division by zero');
    if (this.zero) return Big.ZERO;
    if (b.c === C_MIN) return b.e === 0n ? this : mk(this.c, this.e - b.e);
    const N = this.c * P35;
    const q = N / b.c; // in (10^34, 10^36): always >= 35 digits, so rounding happens in norm()
    const r = N - q * b.c;
    return norm(q, this.e - b.e - 2n, r !== 0n);
  }

  add(b: Big): Big {
    if (b.zero) return this;
    if (this.zero) return b;
    let x: Big = this;
    let y: Big = b;
    if (x.e < y.e) {
      x = b;
      y = this;
    }
    const diff = x.e - y.e;
    if (diff >= ABSORB_DIFF) return x;
    const dn = Number(diff);
    const C = dn === 0 ? x.c + y.c : x.c * P[dn]! + y.c; // 34+dn or 35+dn digits
    let e = x.e;
    let q: bigint;
    if (C >= P[34 + dn]!) {
      q = roundDiv10(C, dn + 1);
      e += 1n;
    } else {
      q = roundDiv10(C, dn);
    }
    if (q === C_LIMIT) {
      q = C_MIN;
      e += 1n;
    }
    return mk(q, e);
  }

  /** this − b, floored at zero. */
  sub(b: Big): Big {
    if (b.zero) return this;
    if (this.zero || this.e < b.e) return Big.ZERO;
    const diff = this.e - b.e;
    if (diff >= ABSORB_DIFF) return this;
    const dn = Number(diff);
    const C = dn === 0 ? this.c - b.c : this.c * P[dn]! - b.c;
    if (C <= 0n) return Big.ZERO;
    return norm(C, b.e);
  }

  // ---------------------------------------------------------------- comparison

  cmp(b: Big): -1 | 0 | 1 {
    if (this.zero) return b.zero ? 0 : -1;
    if (b.zero) return 1;
    if (this.e !== b.e) return this.e > b.e ? 1 : -1;
    if (this.c !== b.c) return this.c > b.c ? 1 : -1;
    return 0;
  }
  eq(b: Big): boolean {
    return this.e === b.e && this.c === b.c;
  }
  lt(b: Big): boolean {
    return this.cmp(b) < 0;
  }
  lte(b: Big): boolean {
    return this.cmp(b) <= 0;
  }
  gt(b: Big): boolean {
    return this.cmp(b) > 0;
  }
  gte(b: Big): boolean {
    return this.cmp(b) >= 0;
  }
  static min(a: Big, b: Big): Big {
    return a.cmp(b) <= 0 ? a : b;
  }
  static max(a: Big, b: Big): Big {
    return a.cmp(b) >= 0 ? a : b;
  }

  // ---------------------------------------------------------------- powers & conveniences

  /**
   * Integer power by right-to-left binary exponentiation, rounding every multiplication (deterministic):
   *   result = 1; base = x; loop { if (n & 1) result *= base; n >>= 1; if (n == 0) break; base *= base }
   * For negative n the positive power is computed first, then result = 1 / result (one more rounding).
   */
  powInt(n: number | bigint): Big {
    let nb: bigint;
    if (typeof n === 'number') {
      if (!Number.isSafeInteger(n)) throw new NumericError('INVALID', `powInt exponent must be a safe integer: ${n}`);
      nb = BigInt(n);
    } else if (typeof n === 'bigint') {
      nb = n;
    } else {
      throw new NumericError('INVALID', 'powInt exponent must be number or bigint');
    }
    if (nb === 0n) return Big.ONE;
    const neg = nb < 0n;
    if (neg) nb = -nb;
    if (this.zero) {
      if (neg) throw new NumericError('DIV_ZERO', 'zero to a negative power');
      return Big.ZERO;
    }
    if (this.c === C_MIN) return mk(C_MIN, neg ? -(this.e * nb) : this.e * nb); // exact power of ten
    let result: Big = Big.ONE;
    let base: Big = this;
    for (;;) {
      if ((nb & 1n) === 1n) result = result.mul(base);
      nb >>= 1n;
      if (nb === 0n) break;
      base = base.mul(base);
    }
    return neg ? Big.ONE.div(result) : result;
  }

  /** Convenience: this.mul(Big.from(x)). */
  mulNum(x: number): Big {
    return this.mul(Big.from(x));
  }

  /** this + b === this at 34 digits (b is lost entirely). */
  absorbs(b: Big): boolean {
    if (b.zero) return true;
    if (this.zero) return false;
    return this.add(b).eq(this);
  }

  // ---------------------------------------------------------------- float views (display / ratios only)

  /** Approximate log10; -Infinity for zero; never NaN. */
  log10(): number {
    if (this.zero) return -Infinity;
    return Number(this.e) + Math.log10(Number(this.c) / 1e33);
  }

  /** Nearest float; Infinity / 0 outside float range. Display and ratios only. */
  toNumber(): number {
    if (this.zero) return 0;
    if (this.e > 308n) return Infinity;
    if (this.e < -400n) return 0;
    return Number.parseFloat(`${this.c}e${this.e - 33n}`);
  }

  /** this / b as a float computed from the exponent difference; clamped to [0, 1e308]. b zero: Infinity (this nonzero) or 0. */
  ratio(b: Big): number {
    if (b.zero) return this.zero ? 0 : Infinity;
    if (this.zero) return 0;
    const d = this.e - b.e;
    if (d > 310n) return 1e308;
    if (d < -340n) return 0;
    const r = (Number(this.c) / Number(b.c)) * 10 ** Number(d);
    return r > 1e308 ? 1e308 : r;
  }

  // ---------------------------------------------------------------- integer views

  /** Exact integer part (may be huge). Throws RANGE when it would need more than MAX_INT_EXPAND_DIGITS trailing zeros. */
  floorInt(): bigint {
    if (this.zero) return 0n;
    const shift = this.e - 33n;
    if (shift >= 0n) {
      if (shift > BigInt(MAX_INT_EXPAND_DIGITS)) throw new NumericError('RANGE', 'integer too large to materialize');
      return this.c * pow10(Number(shift));
    }
    if (shift <= -34n) return 0n;
    return this.c / P[Number(-shift)]!;
  }

  isZero(): boolean {
    return this.zero;
  }

  isInteger(): boolean {
    if (this.zero || this.e >= 33n) return true;
    if (this.e < 0n) return false;
    return this.c % P[33 - Number(this.e)]! === 0n;
  }

  // ---------------------------------------------------------------- serialization

  toWire(): BigWire {
    if (this.zero) return { m: '0', e: '0', zero: true };
    const d = trimmedDigits(this.c);
    return { m: d.length === 1 ? d : `${d[0]}.${d.slice(1)}`, e: this.e.toString(), zero: false };
  }

  static fromWire(w: BigWire): Big {
    if (w === null || typeof w !== 'object') throw new NumericError('INVALID', 'wire value must be an object');
    const { m, e, zero } = w as { m: unknown; e: unknown; zero: unknown };
    if (typeof m !== 'string' || typeof e !== 'string' || typeof zero !== 'boolean') {
      throw new NumericError('INVALID', 'wire value must be {m:string, e:string, zero:boolean}');
    }
    if (zero) {
      if (m !== '0' || e !== '0') throw new NumericError('INVALID', 'zero wire value must be {m:"0", e:"0"}');
      return Big.ZERO;
    }
    if (!WIRE_M_RE.test(m)) throw new NumericError('INVALID', `bad wire mantissa: ${JSON.stringify(m.slice(0, 64))}`);
    if (!WIRE_E_RE.test(e)) throw new NumericError('INVALID', `bad wire exponent: ${JSON.stringify(e.slice(0, 64))}`);
    const digits = m.length === 1 ? m : m[0] + m.slice(2);
    return mk(BigInt(digits) * P[34 - digits.length]!, BigInt(e));
  }

  /** Canonical exact text: '0' or `${m}e${e}` e.g. '1.75e2'. */
  toString(): string {
    if (this.zero) return '0';
    const d = trimmedDigits(this.c);
    return `${d.length === 1 ? d : `${d[0]}.${d.slice(1)}`}e${this.e}`;
  }

  /** Compact snapshot text `${digits}|${e}` e.g. '175|2'; zero is '0'. */
  toCompact(): string {
    if (this.zero) return '0';
    return `${trimmedDigits(this.c)}|${this.e}`;
  }

  static fromCompact(s: string): Big {
    if (typeof s !== 'string') throw new NumericError('INVALID', 'compact value must be a string');
    if (s === '0' || s === '0|0') return Big.ZERO;
    const m = COMPACT_RE.exec(s);
    if (m === null) throw new NumericError('INVALID', `bad compact value: ${JSON.stringify(s.slice(0, 64))}`);
    const digits = m[1]!;
    return mk(BigInt(digits) * P[34 - digits.length]!, BigInt(m[2]!));
  }

  toJSON(): BigWire {
    return this.toWire();
  }
}
