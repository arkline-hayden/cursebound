import { describe, expect, it } from 'vitest';
import { CLASS_UNLOCKS, STARTER_CLASSES, progressFor, totalXpForLevel } from '@cursebound/content';
import { classUnlocked, countdownText } from '../apps/client/src/lib/progress';

// Client-side class gate (apps/client/src/lib/progress.ts): the class picker and the peer-to-peer join check use it;
// a guest seated by a friend's host relies on it, since the host's machine cannot see the guest's cloud level.

describe('client class gate', () => {
  it('locks classes above the player level and opens them at their tier', () => {
    const fresh = progressFor(0);
    for (const id of STARTER_CLASSES) expect(classUnlocked(id, fresh)).toBe(true);
    for (const u of CLASS_UNLOCKS) {
      expect(classUnlocked(u.classId, fresh)).toBe(false);
      expect(classUnlocked(u.classId, progressFor(totalXpForLevel(u.level) - 1))).toBe(false);
      expect(classUnlocked(u.classId, progressFor(totalXpForLevel(u.level)))).toBe(true);
    }
  });

  it('locks nothing while progress is unknown (the authority still refuses locked classes)', () => {
    for (const u of CLASS_UNLOCKS) expect(classUnlocked(u.classId, null)).toBe(true);
  });

  it('formats the bounty countdown', () => {
    expect(countdownText(0)).toBe('00:00:00');
    expect(countdownText(-5)).toBe('00:00:00');
    expect(countdownText((23 * 3600 + 4 * 60 + 5) * 1000 + 999)).toBe('23:04:05');
  });
});
