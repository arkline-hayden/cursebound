# @cursebound/numeric — API contract (REQ NUM01, PRD §11.2)

Pure TypeScript, zero dependencies, no Node/browser APIs. Must behave identically in V8, SpiderMonkey, JSC.
All arithmetic is BigInt based. JavaScript `number` is never used for canonical values.

## Representation
A nonzero `Big` value = `c × 10^(e − 33)` where
- `c: bigint` is the 34-significant-digit coefficient, normalized `10n**33n <= c < 10n**34n`
- `e: bigint` is the decimal exponent of the leading digit (so `1 <= m < 10`, value = m × 10^e)
- zero has `zero === true`, `c === 0n`, `e === 0n`.
- Only nonnegative values exist (game quantities). Subtraction floors at zero.
- Rounding: round-half-even to 34 significant digits on every operation.

## Exports (src/index.ts)

```ts
export const PRECISION = 34;
export const NUMERIC_VERSION = 'num-1.0.0';

export interface BigWire { m: string; e: string; zero: boolean }  // e.g. {m:'1.2345', e:'450', zero:false}; zero -> {m:'0', e:'0', zero:true}

export class Big {
  readonly c: bigint; readonly e: bigint; readonly zero: boolean;
  static readonly ZERO: Big; static readonly ONE: Big;
  static from(x: number | string | bigint | BigWire | Big): Big;
     // number: must be finite and >= 0 (throw NumericError otherwise); converted via its shortest round-trip decimal string (String(x)), never via binary bits
     // string: decimal like '123', '1.75', '0.05', '1e450', '1.2345e-7', '2.5E+10'; throw on negative/NaN/Infinity/garbage
     // bigint: >= 0
  static fromParts(c: bigint, e: bigint): Big; // normalizes any positive c (any number of digits) with exponent meaning value = c × 10^(e-33)
  mul(b: Big): Big; div(b: Big): Big /* throw NumericError on divide by zero */;
  add(b: Big): Big; sub(b: Big): Big /* floor at zero */;
  cmp(b: Big): -1 | 0 | 1;  eq, lt, lte, gt, gte (b: Big): boolean;
  static min(a: Big, b: Big): Big; static max(a: Big, b: Big): Big;
  powInt(n: number | bigint): Big;   // n may be negative (reciprocal) or 0 (ONE); exponentiation by squaring, rounding each step (deterministic)
  mulNum(x: number): Big;            // convenience = mul(Big.from(x))
  log10(): number;                   // approximate; -Infinity for zero; for huge e returns Number(e) + log10(mantissa) (may lose precision but never NaN)
  toNumber(): number;                // may be Infinity / 0 for out of float range; ONLY for display/ratios
  ratio(b: Big): number;             // this/b as a float in [0, +big]; computed via exponent difference so it works when both are 1e100000; b zero -> Infinity if this nonzero else 0. Result clamped to [0, 1e308].
  floorInt(): bigint;                // integer part (exact; may be huge)
  isZero(): boolean;
  isInteger(): boolean;
  toWire(): BigWire;                 // m: shortest decimal for the coefficient (trailing zeros trimmed, e.g. '1.75', '2'); e: decimal string
  static fromWire(w: BigWire): Big;  // validates: m matches /^[1-9](\.\d{1,33})?$/ when nonzero, e matches /^-?\d{1,4096}$/ (length limit is a transport safeguard); throws NumericError
  toString(): string;                // canonical exact: '0', or `${m}e${e}` e.g. '1.75e2'
  toCompact(): string;               // compact wire string `${mantissaDigitsTrimmed}|${e}` for snapshots e.g. '175|2'; parse with Big.fromCompact
  static fromCompact(s: string): Big;
  absorbs(b: Big): boolean;          // true if this.add(b) === this (b too small to change this at 34 digits) — used to quantify loss
}

export class NumericError extends Error { code: 'INVALID' | 'DIV_ZERO' | 'RANGE' }

/** X_new = X_old × (1 + p/100). p is a decimal string like '75', '-30', '1000', '-50'. Exact. Throws if result factor <= 0 (authoring validation). */
export function percentToFactor(p: string): Big;

/** Human display (PRD §10.1): never 'Infinity', 'NaN', '-0'.
 *  < 1000: up to `decimals` (default 2) decimals, trailing zeros trimmed (e.g. '245', '163.27', '0.05');
 *  1e3..1e15: suffix with 3 significant digits: '1.23K', '45.6M', '850M', '3.40B', '1.54T', '999T';
 *  >= 1e15: scientific '1.23e15', '1.54e450', exponent may be huge ('7.10e1000000');
 *  tiny (< 0.01, nonzero): scientific '5.00e-4'. zero: '0'. */
export function formatBig(x: Big, opts?: { decimals?: number; sig?: number }): string;
/** Exact grouped integer text for detail views: '1,234,567' for <= 1e21 else canonical toString(). */
export function formatExact(x: Big): string;

// ---- Canonical arbitrary precision nonnegative integer score text (PRD §13.1, §20.2, Appendix A4) ----
export function scoreToText(n: bigint): string;          // canonical: no leading zeros except '0'; throws on negative
export function scoreFromText(s: string): bigint;        // validates canonical form /^(0|[1-9]\d*)$/ (max 1,000,000 digits)
export function compareScoreText(a: string, b: string): -1 | 0 | 1; // by digit count then lexical — no BigInt conversion needed
export function formatScore(s: string): string;          // grouped with commas up to 21 digits, else '1.234e45' style (still exact in detail views via raw text)
/** floor(b × M × num / den) exactly, where M is a Big (may have huge exponent). All other args bigint. Result bigint >= 0. */
export function floorMulBig(b: bigint, M: Big, num: bigint, den: bigint): bigint;

// ---- Deterministic sampling helper used by combat compression (PRD §12.1) ----
/** Deterministic binomial sample of k trials with probability q (q = num/den as bigints for exactness), using a caller supplied
 *  uniform generator next(): number in [0,1) (from the simulation's seeded PRNG).
 *  - k <= 64 (as Big integer): exactly k Bernoulli trials, consuming exactly k draws, trial i succeeds when next() < q.
 *  - k > 64: versioned approximation 'binom-normal-v1': mean k·q, sd sqrt(k·q·(1−q)), consumes exactly 2 draws (Box-Muller using
 *    deterministic polynomial/sqrt only via Math.sqrt and Math.log which are acceptable since only the server is authoritative),
 *    result rounded half-even and clamped to [0, k]; for k beyond float range compute via Big: k·q ± sd using Big arithmetic.
 *  Returns successes as Big (integer). */
export function sampleBinomial(k: Big, qNum: bigint, qDen: bigint, next: () => number): Big;
```

Every operation result is normalized. Comparisons compare exponent first, then coefficient (zero smallest).

## Tests required (packages/numeric/test/*.test.ts, vitest)
- percent semantics: +75% -> 1.75; +300% -> 4; -30% -> 0.7; two +100% -> x4; three -50% -> 0.125 exactly
- Blood Pact ×3: 100 × 1.75^3 = 535.9375 exactly; 1000 × 0.7^3 = 343 exactly
- 1.18^9999 deterministic & matches reference (Python Decimal oracle output committed as fixture), values above 1e10000 and 1e1000000 serialize/parse/compare/rank without Infinity/NaN
- round half even cases at the 34th digit
- wire & compact roundtrip property test (random values incl. huge exponents)
- commutativity of mul (property test), monotonic compare, sub floors at zero, absorbs() for 1e40 + 1
- score text: '9','10','999','1000','1000000000000000000000000' sort fixture (Appendix A4); floorMulBig(1000n, 2, 510n, 480n) === 2125n
- formatBig never returns Infinity/NaN/-0 across extreme inputs
- sampleBinomial: k<=64 equals sequential Bernoulli with same draws (grouped/ungrouped equivalence); k huge returns integer in [0,k]

Also write `tools/balance/oracle/numeric_oracle.py` (Python 3, stdlib decimal with getcontext().prec=34, Emax/Emin enlarged to 10**18,
ROUND_HALF_EVEN) that prints JSON fixtures for a list of operations, and commit its output to `tests/fixtures/numeric_oracle.json`;
a vitest test compares the TS implementation against that JSON. Run it with `py -I tools/balance/oracle/numeric_oracle.py > tests/fixtures/numeric_oracle.json`.
