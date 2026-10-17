import { describe, expect, it } from 'vitest';
import { GLOSSARY_BY_ID } from '@cursebound/content';
import { CHILL_MAX_SLOW, FROZEN_DAMAGE_TAKEN } from '@cursebound/simulation';

// The skill-tree glossary (content glossary.ts) quotes a few rules that live only in the simulation; keep the quoted
// numbers in step with the constants the simulation exports.
describe('skill-tree glossary vs simulation rules', () => {
  it('Chill and Freeze state the simulation numbers', () => {
    expect(GLOSSARY_BY_ID.chill.text).toContain(`at most ${Math.round(CHILL_MAX_SLOW * 100)}%`);
    expect(GLOSSARY_BY_ID.freeze.text).toContain(`×${FROZEN_DAMAGE_TAKEN}`);
  });
});
