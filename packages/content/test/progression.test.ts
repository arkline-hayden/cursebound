import { describe, expect, it } from 'vitest';
import {
  BOUNTY_MODIFIERS, CLASSES, CLASS_UNLOCKS, MAX_LEVEL, STARTER_CLASSES, bountyView, classUnlockLevel, describeAward, isClassUnlocked, levelForXp,
  pickBountyModifier, progressFor, scoreLog10, shuffledBountyIds, totalXpForLevel, unlockedClassesAt, validateProgression, xpForRun, xpToNext,
} from '@cursebound/content';

// Player progression (content progression.ts): XP from run scores, the level curve, class unlock tiers; and the
// daily bounty roll helpers (bounties.ts).

describe('XP from a run', () => {
  it('is zero for a run that never cleared or scored anything', () => {
    expect(xpForRun({ scoreText: '0', depth: 0 })).toBe(0);
  });

  it('is monotonic in score and in depth', () => {
    let prev = -1;
    for (let digits = 1; digits <= 400; digits++) {
      for (const lead of ['1', '3', '9']) {
        const score = lead + '0'.repeat(digits - 1);
        const xp = xpForRun({ scoreText: score, depth: 5 });
        expect(xp).toBeGreaterThanOrEqual(prev);
        prev = xp;
      }
    }
    prev = -1;
    for (let d = 0; d <= 200; d++) {
      const xp = xpForRun({ scoreText: '5000', depth: d });
      expect(xp).toBeGreaterThan(prev);
      prev = xp;
    }
  });

  it('reads log10 straight off the decimal text, even for astronomic scores', () => {
    expect(scoreLog10('0')).toBe(0);
    expect(scoreLog10('9')).toBeCloseTo(1, 9);
    expect(scoreLog10('999')).toBeCloseTo(3, 3);
    expect(scoreLog10('1' + '0'.repeat(999))).toBeCloseTo(999, 6);
    expect(scoreLog10('007')).toBe(0);   // non-canonical text earns nothing
    expect(Number.isFinite(xpForRun({ scoreText: '9'.repeat(4000), depth: 900 }))).toBe(true);
  });

  it('grows sublinearly: a 10x score adds a fixed, small amount; huge scores never dwarf a few runs', () => {
    const a = xpForRun({ scoreText: '1000000', depth: 10 }), b = xpForRun({ scoreText: '10000000', depth: 10 });
    expect(b - a).toBe(12);
    const firstRun = xpForRun({ scoreText: '600', depth: 3 });
    const latePush = xpForRun({ scoreText: '3' + '0'.repeat(40), depth: 40 });
    expect(firstRun).toBeGreaterThan(60);
    expect(latePush / firstRun).toBeLessThan(15);
  });
});

describe('level curve', () => {
  it('rises steadily: each level costs 40 XP more than the last', () => {
    for (let l = 1; l < MAX_LEVEL; l++) {
      expect(totalXpForLevel(l + 1) - totalXpForLevel(l)).toBe(xpToNext(l));
      if (l > 1) expect(xpToNext(l) - xpToNext(l - 1)).toBe(40);
    }
    expect(totalXpForLevel(1)).toBe(0);
    expect([2, 3, 6, 10, 15, 20].map(totalXpForLevel)).toEqual([80, 200, 800, 2160, 4760, 8360]);
  });

  it('levelForXp inverts the curve and caps', () => {
    for (let l = 1; l <= MAX_LEVEL; l++) {
      expect(levelForXp(totalXpForLevel(l))).toBe(l);
      if (l > 1) expect(levelForXp(totalXpForLevel(l) - 1)).toBe(l - 1);
    }
    expect(levelForXp(1e12)).toBe(MAX_LEVEL);
    expect(levelForXp(-5)).toBe(1);
  });

  it('a new player unlocks the first locked class within a couple of runs', () => {
    const typicalFirstRuns = [{ scoreText: '700', depth: 3 }, { scoreText: '2000', depth: 4 }];
    const xp = typicalFirstRuns.reduce((s, r) => s + xpForRun(r), 0);
    expect(levelForXp(xp)).toBeGreaterThanOrEqual(CLASS_UNLOCKS[0].level);
  });

  it('progressFor reports the bar and the next unlock', () => {
    expect(progressFor(0)).toEqual({ level: 1, xp: 0, xpIntoLevel: 0, xpForNext: 80, unlockedClasses: [...STARTER_CLASSES], nextUnlock: { classId: 'duelist', level: 3 } });
    const p = progressFor(totalXpForLevel(6) + 10);
    expect(p).toMatchObject({ level: 6, xpIntoLevel: 10, xpForNext: xpToNext(6), nextUnlock: { classId: 'templar', level: 10 } });
    expect(p.unlockedClasses).toEqual([...STARTER_CLASSES, 'duelist', 'artificer']);
    expect(progressFor(totalXpForLevel(20)).nextUnlock).toBeNull();
    expect(progressFor(totalXpForLevel(MAX_LEVEL)).xpForNext).toBe(0);
  });

  it('describes an award: bounty doubling, level change and unlocks', () => {
    const a = describeAward(150, true, 100);
    expect(a).toMatchObject({ xp: 300, baseXp: 150, bounty: true, xpBefore: 100, xpAfter: 400, levelBefore: 2, levelAfter: 4, unlocked: ['duelist'] });
    expect(describeAward(50, false, 0)).toMatchObject({ xp: 50, levelBefore: 1, levelAfter: 1, unlocked: [] });
  });
});

describe('class unlocks', () => {
  it('starts with five classes, a melee and ranged mix, and unlocks the other five at rising tiers', () => {
    expect(STARTER_CLASSES).toHaveLength(5);
    expect(CLASS_UNLOCKS.map((u) => u.level)).toEqual([3, 6, 10, 15, 20]);
    const melee = STARTER_CLASSES.filter((id) => CLASSES.find((c) => c.id === id)?.melee);
    expect(melee.length).toBeGreaterThanOrEqual(2);
    expect(STARTER_CLASSES.length - melee.length).toBeGreaterThanOrEqual(2);
    expect(new Set([...STARTER_CLASSES, ...CLASS_UNLOCKS.map((u) => u.classId)])).toEqual(new Set(CLASSES.map((c) => c.id)));
    expect(validateProgression()).toEqual([]);
  });

  it('gates by level', () => {
    expect(unlockedClassesAt(1)).toEqual([...STARTER_CLASSES]);
    for (const u of CLASS_UNLOCKS) {
      expect(classUnlockLevel(u.classId)).toBe(u.level);
      expect(isClassUnlocked(u.classId, u.level - 1)).toBe(false);
      expect(isClassUnlocked(u.classId, u.level)).toBe(true);
    }
    for (const id of STARTER_CLASSES) expect(isClassUnlocked(id, 1)).toBe(true);
    expect(unlockedClassesAt(MAX_LEVEL)).toHaveLength(CLASSES.length);
  });
});

describe('bounty roll helpers', () => {
  it('never picks the previous modifier and covers the rest', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const prev = BOUNTY_MODIFIERS[i % BOUNTY_MODIFIERS.length].id;
      const r = (i * 0.6180339887) % 1;
      const next = pickBountyModifier(prev, () => r);
      expect(next).not.toBe(prev);
      seen.add(next);
    }
    expect(seen.size).toBe(BOUNTY_MODIFIERS.length);
  });

  it('shuffles every id exactly once', () => {
    let x = 7;
    const ids = shuffledBountyIds(() => ((x = (x * 9301 + 49297) % 233280) / 233280));
    expect([...ids].sort()).toEqual(BOUNTY_MODIFIERS.map((m) => m.id).sort());
  });

  it('views a bounty with its modifier copy', () => {
    const v = bountyView({ id: 'bty_1', modifierId: 'barren', createdAt: 10, expiresAt: 20 }, false, 15);
    expect(v).toMatchObject({ id: 'bty_1', modifier: { id: 'barren', name: 'Barren Halls' }, createdAt: 10, expiresAt: 20, serverNow: 15, completed: false, xpMultiplier: 2 });
  });
});
