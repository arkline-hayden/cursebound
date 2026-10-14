import { describe, expect, it } from 'vitest';
import { CARDS, CLASSES, MECHANICS, MECHANIC_BY_ID, NODES, STAT_BY_ID, cardRarity, contentHash, mechanicText, sha256Hex, validateCard, validateContent, canonicalJson } from '@cursebound/content';

describe('content', () => {
  it('validates with zero authoring errors', () => {
    expect(validateContent()).toEqual([]);
  });
  it('keeps the 24 stat-for-stat commons and adds rare/mythic mechanic cards with canonical names', () => {
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
    const commons = CARDS.filter((c) => cardRarity(c) === 'common');
    expect(commons).toHaveLength(24);
    for (const c of commons) {
      expect(STAT_BY_ID[c.positive!.stat]).toBeTruthy();
      expect(STAT_BY_ID[c.negative!.stat]).toBeTruthy();
    }
    const rares = CARDS.filter((c) => cardRarity(c) === 'rare');
    const mythics = CARDS.filter((c) => cardRarity(c) === 'mythic');
    expect(rares.length + mythics.length).toBeGreaterThanOrEqual(20);
    expect(mythics.length).toBeGreaterThanOrEqual(6);
    for (const c of [...rares, ...mythics]) {
      expect(c.boon || c.bane || c.negative?.stat === 'encounter.eliteChance').toBeTruthy();
      if (c.positive) expect(STAT_BY_ID[c.positive.stat]).toBeTruthy();
      if (c.negative) expect(STAT_BY_ID[c.negative.stat]).toBeTruthy();
      for (const m of [c.boon, c.bane]) if (m) expect(MECHANIC_BY_ID[m.id]).toBeTruthy();
    }
    for (const c of mythics) { expect(c.boon).toBeTruthy(); expect(c.bane).toBeTruthy(); }
  });
  it('every mechanic is carried by a card and renders its magnitude in short and long copy', () => {
    for (const m of MECHANICS) {
      expect(CARDS.some((c) => c.boon?.id === m.id || c.bane?.id === m.id)).toBe(true);
      const s = mechanicText(m, m.short, '25%');
      expect(s).toContain('25%');
      expect(s).not.toMatch(/\{/);
      expect(mechanicText(m, m.description, '25%')).not.toMatch(/\{/);
    }
    expect(MECHANICS.filter((m) => m.kind === 'boon').length).toBeGreaterThanOrEqual(10);
    expect(MECHANICS.filter((m) => m.kind === 'bane').length).toBeGreaterThanOrEqual(6);
  });
  it('the validator rejects malformed fate cards', () => {
    const base = { id: 'bad', version: 1, name: 'Bad', family: 'blood', applicability: [], icon: '', flavor: '' };
    expect(validateCard({ ...base, rarity: 'common', positive: { stat: 'player.damage', percent: '50' } }).join()).toMatch(/needs a price/);
    expect(validateCard({ ...base, rarity: 'rare', boon: { id: 'blood_moon', magnitude: '0.1' }, negative: { stat: 'enemy.damage', percent: '10' } }).join()).toMatch(/slot holds a bane/);
    expect(validateCard({ ...base, rarity: 'rare', boon: { id: 'echo', magnitude: '1.5' }, negative: { stat: 'enemy.damage', percent: '10' } }).join()).toMatch(/below 1/);
    expect(validateCard({ ...base, rarity: 'mythic', boon: { id: 'echo', magnitude: '0.5' }, negative: { stat: 'enemy.damage', percent: '10' } }).join()).toMatch(/mythic/);
    expect(validateCard({ ...base, rarity: 'rare', boon: { id: 'nope', magnitude: '0.5' }, negative: { stat: 'enemy.damage', percent: '10' } }).join()).toMatch(/unknown mechanic/);
  });
  it('roster includes the playable classes, each with at least 18 nodes', () => {
    const ids = CLASSES.map((c) => c.id);
    for (const id of ['vanguard', 'arcanist', 'duelist', 'artificer', 'hexbinder']) expect(ids).toContain(id);
    for (const c of CLASSES) expect(NODES.filter((n) => n.classId === c.id).length).toBeGreaterThanOrEqual(18);
  });
  it('duelist and artificer: deep branches with evolved actives and keystone choices', () => {
    for (const id of ['duelist', 'artificer']) {
      const cls = CLASSES.find((c) => c.id === id)!;
      for (const b of cls.branches) {
        const bn = NODES.filter((n) => n.classId === id && n.branch === b.id);
        expect(bn.length).toBeGreaterThanOrEqual(10);
        expect(bn.filter((n) => n.grantsSkill).length).toBe(3);            // base active + an evolution choice pair
        expect(bn.filter((n) => n.tier === 4 && n.excludes?.length).length).toBe(2);
        expect(bn.some((n) => n.tier === 2 && n.excludes?.length)).toBe(true);
      }
    }
  });
  it('hexbinder, vanguard and arcanist: 11-node branches, an evolved choice pair at tier 2 and a keystone pair at tier 4', () => {
    for (const id of ['hexbinder', 'vanguard', 'arcanist']) {
      const cls = CLASSES.find((c) => c.id === id)!;
      const grants = new Set<string>();
      for (const b of cls.branches) {
        const bn = NODES.filter((n) => n.classId === id && n.branch === b.id);
        expect(bn.length).toBeGreaterThanOrEqual(10);
        const g = bn.filter((n) => n.grantsSkill);
        expect(g).toHaveLength(3);
        expect(g.filter((n) => n.tier === 2 && n.excludes?.length)).toHaveLength(2);
        expect(bn.filter((n) => n.tier === 4 && n.excludes?.length).length).toBe(2);
        g.forEach((n) => grants.add(n.grantsSkill!));
      }
      expect(grants.size).toBe(9);                                          // 9 distinct actives + basic + signature
    }
  });
  it('sha256 matches known vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
  it('content hash is stable and canonical json sorts keys', () => {
    expect(contentHash()).toBe(contentHash());
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });
});
