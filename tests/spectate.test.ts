import { describe, expect, it } from 'vitest';
import { spectateCandidates, spectateTarget, type SpectatePlayer } from '../apps/client/src/game/spectate';

// Spectating a fallen hero's party: only the dead spectate (downed heroes still wait on a revive), standing
// teammates come first, the chosen teammate is kept while they stand, and nobody to watch means your own camera.

const party = (...lives: SpectatePlayer['life'][]): SpectatePlayer[] => lives.map((life, s) => ({ s, life }));

describe('spectate', () => {
  it('follows your own hero unless you have fallen for the round', () => {
    expect(spectateTarget(party('alive', 'alive'), 0, null)).toBeNull();
    expect(spectateTarget(party('downed', 'alive'), 0, null)).toBeNull();
    expect(spectateTarget(party('dead', 'alive'), 0, null)).toBe(1);
  });

  it('prefers standing teammates over downed ones and never watches the dead', () => {
    const p = party('dead', 'downed', 'dead', 'alive');
    expect(spectateCandidates(p, 0).map((x) => x.s)).toEqual([3, 1]);
    expect(spectateTarget(p, 0, null)).toBe(3);
  });

  it('keeps the chosen teammate while they stand and moves on when they fall', () => {
    expect(spectateTarget(party('dead', 'alive', 'alive'), 0, 2)).toBe(2);
    expect(spectateTarget(party('dead', 'alive', 'dead'), 0, 2)).toBe(1);
  });

  it('falls back to your own camera when nobody is left standing (solo, or a wipe)', () => {
    expect(spectateTarget(party('dead'), 0, null)).toBeNull();
    expect(spectateTarget(party('dead', 'dead'), 0, 1)).toBeNull();
  });
});
