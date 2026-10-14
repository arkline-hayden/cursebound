import { Big } from '../src/index';

/** Deterministic test PRNG (mulberry32), returns floats in [0,1) on a 2^-32 grid. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random Big with 1..34 digits and a leading exponent drawn from [-emax, emax]. */
export function randomBig(rnd: () => number, emax: bigint): Big {
  const nd = 1 + Math.floor(rnd() * 34);
  let digits = String(1 + Math.floor(rnd() * 9));
  for (let i = 1; i < nd; i++) digits += String(Math.floor(rnd() * 10));
  // exponent spread: mostly small, sometimes huge
  const r = rnd();
  let e: bigint;
  if (r < 0.5) e = BigInt(Math.floor(rnd() * 81) - 40);
  else {
    const span = Number(emax);
    e = BigInt(Math.floor((rnd() * 2 - 1) * span));
    if (rnd() < 0.2) e = e * 1000003n; // occasionally far beyond float exponents
  }
  return Big.fromParts(BigInt(digits), e + 33n - BigInt(nd - 1));
}
