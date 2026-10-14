import { describe, expect, it } from 'vitest';
import { newRun, runBot } from './run.helpers';

describe('smoke', () => {
  it('runs a solo vanguard run through several rounds', () => {
    const s = newRun(['vanguard']);
    const phases: string[] = [];
    const t0 = Date.now();
    runBot(s, { maxTicks: 60 * 60 * 12, onEvents: (ev) => { for (const e of ev) if (e.t === 'phase') phases.push(`${e.round}:${e.phase}`); } });
    console.log('round', s.round, 'phase', s.phase, 'score', s.scoreText, 'ticks', s.tick, 'ms', Date.now() - t0, 'fate', s.fate.entries.map((e) => e.cardId).join(','));
    console.log(phases.slice(0, 40).join(' '));
    expect(s.round).toBeGreaterThan(1);
  });
});
