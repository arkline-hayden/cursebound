// Player progression (meta, between runs): an account / local profile earns XP from every finished run, levels up on
// a gently rising curve, and unlocks the five locked vessels at level tiers. Nothing here affects a run's simulation
// (so it is not part of the content manifest); the local authority and the cloud both import these functions so the
// two always agree on the numbers.
//
// XP from a run (xpForRun): run scores grow without bound (big-number strings, packages/numeric), so score is mapped
// through log10, read straight off the decimal text (digit count + leading digits), plus a per-round term for depth:
//   xp = 20 (any progress)  +  15 × depth (first 30 rounds) + 5 × depth beyond 30  +  round(12 × log10(score + 1))
// A score of 10× the previous one is worth just +12 XP, so a deep late-game run is worth a few runs, never hundreds.
//
// Level curve (xpToNext): level L → L+1 costs 80 + 40 × (L − 1) XP; reaching level L takes 80(L−1) + 20(L−1)(L−2).
//   L2 80 · L3 200 · L6 800 · L10 2160 · L15 4760 · L20 8360
// A first run (depth 2–4, a few hundred to a few thousand points) earns ~80–140 XP: the first unlock (level 3) lands
// within a couple of runs, and every later tier is a few more good runs than the one before.

export const MAX_LEVEL = 99;
/** XP multiplier for the first finished run of the day with the daily bounty modifier on (bounties.ts). */
export const BOUNTY_XP_MULTIPLIER = 2;

const XP_BASE = 20;
const XP_PER_DEPTH = 15;
const XP_DEPTH_SOFTCAP = 30;
const XP_PER_DEPTH_LATE = 5;
const XP_PER_DECADE = 12;

/** log10(score + 1) from canonical score text, using only the digit count and up to 6 leading digits. */
export function scoreLog10(scoreText: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(scoreText) || scoreText === '0') return 0;
  const lead = scoreText.slice(0, 6);
  return (scoreText.length - lead.length) + Math.log10(Number(lead) + (scoreText.length <= 6 ? 1 : 0));
}

/** XP earned by one finished run (before any bounty multiplier). 0 for a run that never cleared or scored anything. */
export function xpForRun(r: { scoreText: string; depth: number }): number {
  const depth = Math.max(0, Math.floor(Number.isFinite(r.depth) ? r.depth : 0));
  const log = scoreLog10(r.scoreText);
  if (depth === 0 && log === 0) return 0;
  const depthXp = XP_PER_DEPTH * Math.min(depth, XP_DEPTH_SOFTCAP) + XP_PER_DEPTH_LATE * Math.max(0, depth - XP_DEPTH_SOFTCAP);
  return XP_BASE + depthXp + Math.round(XP_PER_DECADE * log);
}

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return 80 + 40 * (Math.max(1, level) - 1);
}

/** Total XP needed to reach `level` from zero. */
export function totalXpForLevel(level: number): number {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level))) - 1;
  return 80 * l + 20 * l * (l - 1);
}

export function levelForXp(xp: number): number {
  const x = Math.max(0, Math.floor(xp));
  let level = 1;
  while (level < MAX_LEVEL && totalXpForLevel(level + 1) <= x) level++;
  return level;
}

// ---------------- Class unlocks ----------------

/** Unlocked from the first run: two melee bruisers and three ranged casters/hunters. */
export const STARTER_CLASSES: readonly string[] = ['vanguard', 'berserker', 'arcanist', 'ranger', 'cryomancer'];

/** The other five vessels and the level that unlocks each (ascending). */
export const CLASS_UNLOCKS: readonly { classId: string; level: number }[] = [
  { classId: 'duelist', level: 3 },
  { classId: 'artificer', level: 6 },
  { classId: 'templar', level: 10 },
  { classId: 'hexbinder', level: 15 },
  { classId: 'warden', level: 20 },
];

/** Level that unlocks a class (1 = from the start). Unknown ids report 1; validateContent covers every class. */
export function classUnlockLevel(classId: string): number {
  return CLASS_UNLOCKS.find((u) => u.classId === classId)?.level ?? 1;
}

export function isClassUnlocked(classId: string, level: number): boolean {
  return level >= classUnlockLevel(classId);
}

export function unlockedClassesAt(level: number): string[] {
  return [...STARTER_CLASSES, ...CLASS_UNLOCKS.filter((u) => level >= u.level).map((u) => u.classId)];
}

export interface PlayerProgress {
  level: number;
  xp: number;
  /** XP earned inside the current level, and the size of the current level (xpIntoLevel < xpForNext below the cap). */
  xpIntoLevel: number;
  xpForNext: number;
  unlockedClasses: string[];
  nextUnlock: { classId: string; level: number } | null;
}

/** The progress view both servers return (`GET …/progress`). */
export function progressFor(xp: number): PlayerProgress {
  const x = Math.max(0, Math.floor(xp));
  const level = levelForXp(x);
  const atCap = level >= MAX_LEVEL;
  return {
    level, xp: x,
    xpIntoLevel: x - totalXpForLevel(level),
    xpForNext: atCap ? 0 : xpToNext(level),
    unlockedClasses: unlockedClassesAt(level),
    nextUnlock: CLASS_UNLOCKS.find((u) => u.level > level) ?? null,
  };
}

/** One run's XP award: base, the bounty doubling (first bounty run of the day only), and the level change. */
export interface XpAward {
  xp: number;
  baseXp: number;
  bounty: boolean;
  xpBefore: number;
  xpAfter: number;
  levelBefore: number;
  levelAfter: number;
  /** classes this award unlocked */
  unlocked: string[];
}

export function describeAward(baseXp: number, bounty: boolean, xpBefore: number): XpAward {
  const xp = bounty ? baseXp * BOUNTY_XP_MULTIPLIER : baseXp;
  const levelBefore = levelForXp(xpBefore);
  const levelAfter = levelForXp(xpBefore + xp);
  return {
    xp, baseXp, bounty, xpBefore, xpAfter: xpBefore + xp, levelBefore, levelAfter,
    unlocked: CLASS_UNLOCKS.filter((u) => u.level > levelBefore && u.level <= levelAfter).map((u) => u.classId),
  };
}
