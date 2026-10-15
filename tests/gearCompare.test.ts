import { describe, expect, it } from 'vitest';
import { LEGENDARIES, LEGENDARY_BY_ID, type LegendaryDef } from '@cursebound/content';
import { compareLegendary, compareSummary, formatDelta, formatFactor, lowerIsBetter } from '../apps/client/src/ui/gearCompare';

// Legendary quick-compare: stat deltas of a candidate against the worn piece (green ▲ / red ▼), perks side by side.

const fake = (id: string, slot: LegendaryDef['slot'], mods: [string, string][], perk = 'p', classId?: string): LegendaryDef => ({
  id, name: id, slot, modifiers: mods.map(([stat, factorPerRank]) => ({ stat, factorPerRank })), perk: { id: perk, magnitude: '1', description: `${perk} perk` },
  flavor: '', icon: '', accent: '#ffffff', ...(classId ? { classId } : {}),
});

describe('formatDelta', () => {
  it('formats signed percentages with arrows and sensible precision', () => {
    expect(formatDelta(0.037)).toEqual({ text: '▲ +3.7%', dir: 'up' });
    expect(formatDelta(0.12)).toEqual({ text: '▲ +12%', dir: 'up' });
    expect(formatDelta(-0.08)).toEqual({ text: '▼ −8%', dir: 'down' });
    expect(formatDelta(-0.125)).toEqual({ text: '▼ −13%', dir: 'down' });
    expect(formatDelta(0.05)).toEqual({ text: '▲ +5%', dir: 'up' });
    expect(formatDelta(0)).toEqual({ text: '=', dir: 'same' });
    expect(formatDelta(0.0001)).toEqual({ text: '=', dir: 'same' });
    expect(formatDelta(Number.NaN)).toEqual({ text: '=', dir: 'same' });
  });
  it('flips the colour for stats where smaller is better', () => {
    expect(lowerIsBetter('skill.a_fireline.cooldown')).toBe(true);
    expect(lowerIsBetter('player.damage')).toBe(false);
    expect(formatDelta(-0.1, true)).toEqual({ text: '▲ −10%', dir: 'up' });
    expect(formatDelta(0.1, true)).toEqual({ text: '▼ +10%', dir: 'down' });
  });
  it('formats factors', () => {
    expect(formatFactor(1)).toBe('—');
    expect(formatFactor(1.12)).toBe('×1.12');
    expect(formatFactor(1.1 * 1.05)).toBe('×1.155');
  });
});

describe('compareLegendary', () => {
  it('computes per-stat deltas over the union of both pieces', () => {
    const worn = fake('a', 'weapon', [['player.damage', '1.10'], ['player.armor', '1.2']], 'old');
    const cand = fake('b', 'weapon', [['player.damage', '1.21'], ['player.maxHealth', '1.08']], 'new');
    const c = compareLegendary(cand, worn, 'vanguard');
    expect(c.rows.map((r) => r.stat)).toEqual(['player.damage', 'player.maxHealth', 'player.armor']);
    const [dmg, hp, arm] = c.rows;
    expect(dmg.delta).toBeCloseTo(0.1, 9);
    expect(dmg.text).toBe('▲ +10%');
    expect(hp).toMatchObject({ cur: 1, next: 1.08, dir: 'up', text: '▲ +8%' });
    expect(arm.dir).toBe('down');
    expect(arm.delta).toBeCloseTo(1 / 1.2 - 1, 9);
    expect(arm.text).toBe('▼ −17%');
    expect(c.perk).toEqual({ next: 'new perk', cur: 'old perk', same: false });
    expect(c.identical).toBe(false);
    expect(c.wearable).toBe(true);
    expect(c.note).toBeNull();
    expect(compareSummary(c)).toBe('2 better, 1 worse stats');
  });
  it('against an empty slot every modifier is a gain', () => {
    const cand = fake('b', 'ring', [['player.recoveryRate', '1.15']]);
    const c = compareLegendary(cand, null);
    expect(c.equipped).toBeNull();
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0]).toMatchObject({ dir: 'up', text: '▲ +15%', cur: 1 });
    expect(c.perk.cur).toBeNull();
    expect(c.note).toMatch(/Empty slot/);
  });
  it('ignores a worn piece from another slot, flags identical items and class-only pieces', () => {
    const ring = fake('r', 'ring', [['player.damage', '1.1']]);
    const helm = fake('h', 'helm', [['player.damage', '1.5']]);
    expect(compareLegendary(ring, helm).equipped).toBeNull();
    const same = compareLegendary(ring, ring);
    expect(same.identical).toBe(true);
    expect(same.rows.every((r) => r.dir === 'same')).toBe(true);
    expect(compareSummary(same)).toBe('identical to what you wear');
    const classOnly = fake('c', 'weapon', [], 'x', 'arcanist');
    const c = compareLegendary(classOnly, null, 'vanguard');
    expect(c.wearable).toBe(false);
    expect(c.note).toMatch(/Only a/);
  });
  it('handles every shipped legendary against every other piece of its slot', () => {
    for (const a of LEGENDARIES) for (const b of LEGENDARIES.filter((x) => x.slot === a.slot)) {
      const c = compareLegendary(a, b);
      for (const r of c.rows) { expect(Number.isFinite(r.delta)).toBe(true); expect(r.text.length).toBeGreaterThan(0); }
    }
    const x = LEGENDARY_BY_ID.lg_grandfathers_thunder;
    expect(compareLegendary(x, x).identical).toBe(true);
  });
});
