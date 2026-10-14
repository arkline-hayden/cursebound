import { sha256Hex } from '@cursebound/content';

// xoshiro128** PRNG. State is four uint32s stored in a plain array so it serializes into checkpoints.
// Independent streams (PRD §8.1, K11): offers, encounter, combat, ai, map and per-offer vote streams are
// seeded separately so moving or delaying a shot can never manipulate the next Fate offer.

export type RngState = [number, number, number, number];

export function seedRng(...parts: (string | number)[]): RngState {
  const hex = sha256Hex(parts.join('|'));
  const s: RngState = [
    parseInt(hex.slice(0, 8), 16) >>> 0,
    parseInt(hex.slice(8, 16), 16) >>> 0,
    parseInt(hex.slice(16, 24), 16) >>> 0,
    parseInt(hex.slice(24, 32), 16) >>> 0,
  ];
  if ((s[0] | s[1] | s[2] | s[3]) === 0) s[0] = 1;
  return s;
}

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

export function nextU32(s: RngState): number {
  const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
  const t = (s[1] << 9) >>> 0;
  s[2] = (s[2] ^ s[0]) >>> 0;
  s[3] = (s[3] ^ s[1]) >>> 0;
  s[1] = (s[1] ^ s[2]) >>> 0;
  s[0] = (s[0] ^ s[3]) >>> 0;
  s[2] = (s[2] ^ t) >>> 0;
  s[3] = rotl(s[3], 11);
  return result;
}

/** Uniform float in [0, 1). */
export function nextFloat(s: RngState): number {
  return nextU32(s) / 4294967296;
}

/** Uniform integer in [0, n). Rejection sampling: no modulo bias. */
export function nextInt(s: RngState, n: number): number {
  if (n <= 1) return 0;
  const limit = Math.floor(4294967296 / n) * n;
  for (;;) {
    const x = nextU32(s);
    if (x < limit) return x % n;
  }
}

export function nextRange(s: RngState, lo: number, hi: number): number {
  return lo + (hi - lo) * nextFloat(s);
}

export function shuffleInPlace<T>(s: RngState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(s, i + 1);
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

/** Draw k distinct items uniformly without replacement. */
export function drawDistinct<T>(s: RngState, items: readonly T[], k: number): T[] {
  const pool = items.slice();
  const out: T[] = [];
  for (let i = 0; i < k && pool.length > 0; i++) {
    const j = nextInt(s, pool.length);
    out.push(pool[j]);
    pool.splice(j, 1);
  }
  return out;
}
