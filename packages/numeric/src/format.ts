/**
 * Human display of Big values (PRD §10.1). Pure bigint rounding (half-even); never 'Infinity', 'NaN' or '-0'.
 */
import { Big } from './big';
import { P, pow10, roundDiv10 } from './pow10';
import { groupDigits } from './score';

const SUFFIXES = ['', 'K', 'M', 'B', 'T'] as const;

function clampInt(v: number | undefined, def: number, lo: number, hi: number): number {
  if (v === undefined || !Number.isFinite(v)) return def;
  const t = Math.trunc(v);
  return t < lo ? lo : t > hi ? hi : t;
}

/** Round a nonzero Big to `sig` significant digits: value ≈ q × 10^(e − sig + 1), 10^(sig−1) <= q < 10^sig. */
function roundSig(x: Big, sig: number): { q: bigint; e: bigint } {
  let q = roundDiv10(x.c, 34 - sig);
  let e = x.e;
  if (q === P[sig]) {
    q = P[sig - 1]!;
    e += 1n;
  }
  return { q, e };
}

function sci(q: bigint, e: bigint): string {
  const s = q.toString();
  return s.length === 1 ? `${s}e${e}` : `${s[0]}.${s.slice(1)}e${e}`;
}

/**
 * < 1000: up to `decimals` (default 2) decimals, trailing zeros trimmed ('245', '163.27', '0.05');
 * 1e3..1e15: suffix with `sig` (default 3) significant digits ('1.23K', '45.6M', '850M', '3.40B', '999T');
 * >= 1e15: scientific '1.23e15', '7.10e1000000'; tiny (< 10^-decimals, nonzero): scientific '5.00e-4'; zero: '0'.
 */
export function formatBig(x: Big, opts?: { decimals?: number; sig?: number }): string {
  if (x.zero) return '0';
  const decimals = clampInt(opts?.decimals, 2, 0, 30);
  const sig = clampInt(opts?.sig, 3, 1, 34);

  if (x.e < BigInt(-decimals)) {
    const r = roundSig(x, sig);
    return sci(r.q, r.e);
  }
  if (x.e < 3n) {
    const shift = Number(x.e) - 33 + decimals; // N = round(x × 10^decimals)
    const N = shift >= 0 ? x.c * pow10(shift) : roundDiv10(x.c, -shift);
    if (N < 1000n * pow10(decimals)) {
      if (decimals === 0) return N.toString();
      const s = N.toString().padStart(decimals + 1, '0');
      const intPart = s.slice(0, s.length - decimals);
      let frac = s.slice(s.length - decimals);
      let end = frac.length;
      while (end > 0 && frac.charCodeAt(end - 1) === 48) end--;
      frac = frac.slice(0, end);
      return frac.length > 0 ? `${intPart}.${frac}` : intPart;
    }
    // rounds up to 1000: fall through to suffix form
  }
  let { q, e } = roundSig(x, sig);
  if (e < 3n) {
    q = P[sig - 1]!;
    e = 3n;
  }
  if (e >= 15n) return sci(q, e);
  const en = Number(e);
  const k = Math.floor(en / 3);
  const lead = en - 3 * k; // 0..2 digits before the point minus one
  const s = q.toString();
  let body: string;
  if (lead + 1 >= sig) {
    body = s + '0'.repeat(lead + 1 - sig);
  } else {
    body = `${s.slice(0, lead + 1)}.${s.slice(lead + 1)}`;
  }
  return body + SUFFIXES[k]!;
}

/** Exact grouped text for detail views: '1,234,567' (exact fraction appended if any) for values <= 1e21, else toString(). */
export function formatExact(x: Big): string {
  if (x.zero) return '0';
  if (x.e > 21n || (x.e === 21n && x.c !== P[33])) return x.toString();
  const intText = groupDigits(x.floorInt().toString());
  if (x.isInteger()) return intText;
  const shift = 33 - Number(x.e); // number of fractional coefficient digits (> 0 here)
  let frac = (x.c % pow10(shift)).toString().padStart(shift, '0');
  let end = frac.length;
  while (end > 0 && frac.charCodeAt(end - 1) === 48) end--;
  frac = frac.slice(0, end);
  return `${intText}.${frac}`;
}
