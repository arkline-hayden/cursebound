import { describe, expect, it } from 'vitest';
import {
  CARDS, CLASSES, CROSS_BRANCH_PREREQS, GLOSSARY, GLOSSARY_BY_ID, MECHANICS, MECHANIC_BY_ID, NODES, SKILLS, STAT_BY_ID, cardRarity, contentHash,
  glossaryTermsIn, keywordSpans, mechanicText, sha256Hex, validateCard, validateContent, validateTree, canonicalJson,
} from '@cursebound/content';

describe('content', () => {
  it('validates with zero authoring errors', () => {
    expect(validateContent()).toEqual([]);
  });
  it('keeps the 24 stat-for-stat commons and adds rare/mythic mechanic cards with canonical names', () => {
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
    const commons = CARDS.filter((c) => cardRarity(c) === 'common');
    const plain = commons.filter((c) => !c.boon && !c.bane);
    expect(plain).toHaveLength(24);
    for (const c of plain) {
      expect(STAT_BY_ID[c.positive!.stat]).toBeTruthy();
      expect(STAT_BY_ID[c.negative!.stat]).toBeTruthy();
    }
    // twisted commons: one small rule on one side of the bargain, a stat on the other
    for (const c of commons.filter((x) => x.boon || x.bane)) {
      expect(!!c.boon !== !!c.bane, c.id).toBe(true);
      expect(c.boon ? c.negative : c.positive, c.id).toBeTruthy();
      for (const m of [c.boon, c.bane]) if (m) expect(MECHANIC_BY_ID[m.id]).toBeTruthy();
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
  it('the rule-changer wave keeps card faces terse', () => {
    const wave = ['quickblood', 'restless_feet', 'haunted_spoils', 'lone_shade', 'desperation', 'cracked_mirror', 'shadow_twin', 'necromancers_due', 'last_stand',
      'gravity_well', 'momentum', 'mirror_ward', 'blood_magic', 'pandoras_box', 'lord_of_graves', 'collapsing_star', 'doppelganger', 'deathwish'];
    for (const id of wave) {
      const c = CARDS.find((x) => x.id === id)!;
      expect(c, id).toBeTruthy();
      expect(c.name.length, id).toBeLessThanOrEqual(18);
      expect(c.flavor.length, id).toBeLessThanOrEqual(32);
    }
    for (const id of ['shadow_twin', 'grave_thralls', 'last_stand', 'gravity_well', 'momentum', 'mirror_ward', 'pandora', 'blood_price', 'restless_dead', 'grave_hands', 'shadow_pact', 'pandora_curse']) {
      const m = MECHANIC_BY_ID[id];
      expect(m, id).toBeTruthy();
      expect(m.name.length, id).toBeLessThanOrEqual(18);
      expect(mechanicText(m, m.short, m.unit === 'percent' ? '99.9%' : '×999').length, id).toBeLessThanOrEqual(48);
    }
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

describe('skill tree copy', () => {
  const copyNodes = NODES;
  const expand = (n: (typeof NODES)[number]) => n.description.replace(/\{value\}/g, n.modifiers[0]?.factorPerRank ?? '').replace(/\{rank\}/g, String(n.rankLimit));

  it('every node name fits a socket label (at most 22 characters)', () => {
    for (const n of NODES) expect(n.name.length, n.id).toBeLessThanOrEqual(22);
  });
  it('every description is one short sentence (at most 110 characters once templates expand)', () => {
    for (const n of copyNodes) {
      const d = expand(n);
      expect(d, n.id).not.toMatch(/[{}]/);
      expect(d.length, `${n.id}: ${d}`).toBeLessThanOrEqual(110);
      expect(d, n.id).toMatch(/^[A-Z][^]*\.$/);
      expect(d, `${n.id}: more than one sentence`).not.toMatch(/[.!?]\s/);
      expect(d, `${n.id}: the tree already shows choice/keystone/evolution context`).not.toMatch(/^(Choice|Keystone|Evolution|Evolves?|Equip)\b/);
    }
  });
  it('upgrade nodes are tagged and lead with "Upgrades <skill>:"', () => {
    for (const n of copyNodes) {
      expect(!!n.upgrades, `${n.id}: copy and tag disagree`).toBe(n.description.startsWith('Upgrades '));
      // a node whose only modifiers scale one skill is an upgrade of that skill
      const skills = new Set(n.modifiers.map((m) => (m.stat.startsWith('skill.') ? m.stat.split('.')[1] : '*')));
      if (!n.grantsSkill && skills.size === 1 && !skills.has('*')) expect(n.upgrades, `${n.id} should be an upgrade`).toBeTruthy();
    }
    for (const n of NODES.filter((x) => x.upgrades)) expect(n.description.startsWith('Upgrades '), n.id).toBe(true);
    expect(NODES.filter((n) => n.upgrades).length).toBeGreaterThanOrEqual(80);
  });
  it('keeps the shield wording the Forecast keys on (simulation forecast.ts generatesShields)', () => {
    const shieldNodes = NODES.filter((n) => /\bshields?\b/i.test(n.description)).map((n) => n.id).sort();
    expect(shieldNodes).toEqual([
      'a_static_shell', 'af_aegis_protocol', 'c_heart_of_winter', 'c_rime_armor', 'd_perfect_guard', 'h_blood_ward', 'h_crimson_covenant',
      't_aegis_charge', 't_benediction', 't_guardians_path', 't_intercession', 't_juggernaut', 't_living_bastion', 't_radiant_ward', 't_shield_charge', 't_shield_slam',
      'v_guard_stance', 'v_last_stand', 'v_recovery_pulse', 'v_retaliate', 'v_shared_shelter', 'v_shield_charge', 'v_standard_bearer',
      'w_barkskin', 'w_forest_heart',
    ].sort());
  });
});

describe('skill tree glossary', () => {
  // Jargon the skill and node copy may only use as a defined glossary keyword (glossary.ts). Words that only some
  // classes use as a game term are scoped: Warden "spirit wolves" and Duelist "marks" are plain words there.
  const JARGON: { re: RegExp; classes?: string[] }[] = [
    { re: /\b(burn\w*|ignit\w*|bleed\w*|rend(ed|s)?|rot|rotting|venom\w*|poison\w*|frostbite|chill\w*|freez\w*|frozen|shatter\w*)\b/gi },
    { re: /\b(snare\w*|root\w*|stun\w*|blind\w*|fear\w*|interrupt\w*|taunt\w*|knock\w*|pull\w*|drag\w*|lure\w*)\b/gi },
    { re: /\b(vulnerab\w*|weaken\w*|execut\w*|condemn\w*|stagger\w*|invulnerab\w*|untouchab\w*|untargetab\w*|unkillab\w*)\b/gi },
    { re: /\b(shield\w*|armor|crit\w*|recovery|charges?|attack speed|attack frequency|dodg\w*|downed|going down|reviv\w*|lifesteal|evolution\w*)\b/gi },
    { re: /\b(rall\w*|guard\w*|combo|finisher\w*|parr\w*|counter\w*|clones?|overclock\w*|turrets?|drones?|explosives?|mines?|traps?|souls?)\b/gi },
    { re: /\b(bloodlust|holy ground|consecrat\w*|vows?|thorn armor|thorns|barkskin|beasts?|grove healing|close quarters)\b/gi },
    { re: /\b(cohort\w*|objective\w*|elites?|champions?|rares?|potency|surge|compression\w*)\b/gi },
    { re: /\bspirits?\b/gi, classes: ['hexbinder'] },
    { re: /\bfrenzy\b/gi, classes: ['berserker'] },
    { re: /\bmark\w*/gi, classes: ['ranger'] },
  ];
  const lead = (d: string) => d.replace(/^Upgrades [^:]+: /, '');
  const copy = [
    ...NODES.map((n) => ({ id: n.id, classId: n.classId, text: lead(n.description), node: true })),
    ...SKILLS.map((s) => ({ id: s.id, classId: s.classId, text: s.description, node: false })),
  ];
  /** Character ranges of `text` that are glossary keywords or protected skill / node names. */
  const covered = (text: string, classId: string) => {
    const out: [number, number][] = [];
    let at = 0;
    for (const s of keywordSpans(text, classId, { all: true })) { if (s.term || s.name) out.push([at, at + s.text.length]); at += s.text.length; }
    return (i: number, j: number) => out.some(([a, b]) => i >= a && j <= b);
  };

  it('every jargon word in skill and node copy is a defined keyword', () => {
    const bad: string[] = [];
    for (const c of copy) {
      const ok = covered(c.text, c.classId);
      for (const j of JARGON) {
        if (j.classes && !j.classes.includes(c.classId)) continue;
        for (const m of c.text.matchAll(j.re)) if (!ok(m.index!, m.index! + m[0].length)) bad.push(`${c.id}: "${m[0]}"`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('capitalised terms inside node copy are skill or node names or glossary keywords', () => {
    const bad: string[] = [];
    for (const c of copy.filter((x) => x.node)) {
      const ok = covered(c.text, c.classId);
      for (const m of c.text.matchAll(/(?<=[a-z0-9,;:)%×]\s+)[A-Z][a-zA-Z]+/g)) if (!ok(m.index!, m.index! + m[0].length)) bad.push(`${c.id}: "${m[0]}"`);
    }
    expect(bad).toEqual([]);
  });
  it('every glossary entry is used by the copy of a class it applies to', () => {
    const used = new Set<string>();
    for (const c of copy) for (const s of keywordSpans(c.text, c.classId, { all: true })) if (s.term) used.add(s.term.id);
    expect(GLOSSARY.filter((t) => !used.has(t.id)).map((t) => t.id)).toEqual([]);
  });
  it('entries are well formed: unique ids, one meaning per word per class, short plain text with no templates', () => {
    expect(new Set(GLOSSARY.map((t) => t.id)).size).toBe(GLOSSARY.length);
    for (const t of GLOSSARY) {
      expect(t.forms.length, t.id).toBeGreaterThan(0);
      expect(t.text.length, `${t.id}: ${t.text}`).toBeLessThanOrEqual(200);
      expect(t.text, t.id).toMatch(/^[A-Z][^{}]*\.$/);
      expect(t.text, t.id).not.toMatch(/undefined|NaN|Infinity/);
      expect(t.color, t.id).toMatch(/^#[0-9a-f]{6}$/i);
      for (const c of [...(t.classes ?? []), ...(t.notClasses ?? [])]) expect(CLASSES.some((x) => x.id === c), `${t.id}: class ${c}`).toBe(true);
    }
    for (const cls of CLASSES) {
      const seen = new Map<string, string>();
      for (const t of GLOSSARY.filter((x) => (!x.classes || x.classes.includes(cls.id)) && !x.notClasses?.includes(cls.id))) {
        for (const f of t.forms.map((x) => x.toLowerCase())) {
          expect(seen.get(f), `${cls.id}: "${f}" means both ${seen.get(f)} and ${t.id}`).toBeUndefined();
          seen.set(f, t.id);
        }
      }
    }
  });
  it('keyword spans keep skill names whole and mark only the first mention of a term', () => {
    const spans = keywordSpans('Frozen Orb freezes; frozen enemies stay Frozen.', 'cryomancer');
    expect(spans.filter((s) => s.term).map((s) => [s.text, s.term!.id])).toEqual([['freezes', 'freeze']]);
    expect(spans.find((s) => s.text === 'Frozen Orb')?.name).toBe(true);
    expect(spans.map((s) => s.text).join('')).toBe('Frozen Orb freezes; frozen enemies stay Frozen.');
    // class mechanics only apply to their class; Cryomancer storms are blizzards, not storm damage
    expect(glossaryTermsIn('Rallies allies.', 'vanguard').map((t) => t.id)).toEqual(['rally']);
    expect(glossaryTermsIn('Rallies allies.', 'arcanist')).toEqual([]);
    expect(glossaryTermsIn('storms chill 60%', 'cryomancer').map((t) => t.id)).toEqual(['chill']);
    expect(GLOSSARY_BY_ID.shield.text).toContain('60%');
  });
});

describe('skill tree structure', () => {
  // A tiny synthetic Vanguard tree for the negative cases: two branches, each a base skill plus three 3-rank passives.
  type N = (typeof NODES)[number];
  const mk = (id: string, branch: string, tier: N['tier'], extra: Partial<N> = {}): N => ({
    id, classId: 'vanguard', branch, name: id, rankLimit: tier === 1 ? 3 : 1, costPerRank: tier === 0 ? 0 : 1, tier, prereqs: [],
    modifiers: [], mechanics: [], description: 'X.', icon: '', ...(tier === 0 ? { starting: true } : {}), ...extra,
  });
  const req = (...ids: string[]) => ids.map((node) => ({ node, rank: 1 }));
  const base = (): N[] => [
    mk('a0', 'a', 0, { grantsSkill: 'v_guard_stance' }), mk('a1', 'a', 1), mk('a2', 'a', 1), mk('a3', 'a', 1),
    mk('b0', 'b', 0, { grantsSkill: 'v_sweeping_strike' }), mk('b1', 'b', 1), mk('b2', 'b', 1), mk('b3', 'b', 1),
  ];
  const errsWith = (...extra: N[]) => validateTree([...base(), ...extra]).join('\n');

  it('the shipped trees pass every structural rule', () => {
    expect(validateTree(base())).toEqual([]);
    expect(validateTree(NODES)).toEqual([]);
  });
  it('rejects cycles and prerequisites at the same or a later tier', () => {
    expect(errsWith(mk('x', 'a', 2, { prereqs: req('y') }), mk('y', 'a', 2, { prereqs: req('x') }))).toMatch(/prerequisite cycle/);
    expect(errsWith(mk('x', 'a', 2), mk('y', 'a', 2, { prereqs: req('x') }))).toMatch(/y: prerequisite x must sit at a lower tier/);
  });
  it('rejects prerequisites from another branch unless explicitly listed as cross-branch links', () => {
    expect(errsWith(mk('x', 'b', 2, { prereqs: req('a1') }))).toMatch(/x: prerequisite a1 is in another branch/);
    expect(CROSS_BRANCH_PREREQS).toEqual({});
  });
  it('rejects one-sided, cross-tier and cross-branch choices, and chains that need both sides of a choice', () => {
    expect(errsWith(mk('x', 'a', 2, { excludes: ['y'] }), mk('y', 'a', 2))).toMatch(/x: exclusion with y must be declared on both nodes/);
    expect(errsWith(mk('x', 'a', 2, { excludes: ['y'] }), mk('y', 'a', 3, { excludes: ['x'] }))).toMatch(/a choice pairs nodes of one tier/);
    expect(errsWith(mk('x', 'a', 2, { excludes: ['y'] }), mk('y', 'b', 2, { excludes: ['x'] }))).toMatch(/crosses branches/);
    expect(errsWith(mk('x', 'a', 2, { excludes: ['y'] }), mk('y', 'a', 2, { excludes: ['x'] }), mk('z', 'a', 3, { prereqs: req('x', 'y') }))).toMatch(/z: its prerequisites include both x and y/);
    // two transformations of the same skill may exclude each other across branches (the Astral Nova keystones)
    expect(errsWith(mk('x', 'a', 4, { upgrades: 'v_earthbreaker', excludes: ['y'] }), mk('y', 'b', 4, { upgrades: 'v_earthbreaker', excludes: ['x'] }))).toBe('');
  });
  it('an upgrade requires the node that grants its skill, and an evolution its branch base', () => {
    expect(errsWith(mk('x', 'a', 2, { upgrades: 'v_guard_stance' }))).toMatch(/x: upgrades v_guard_stance but does not require a0/);
    expect(errsWith(mk('x', 'a', 3, { upgrades: 'v_guard_stance', prereqs: req('y') }), mk('y', 'a', 2, { prereqs: req('a0') }))).toBe('');
    expect(errsWith(mk('x', 'a', 2, { grantsSkill: 'v_shield_charge' }))).toMatch(/x: an evolution must require its branch's base skill a0/);
    expect(errsWith(mk('x', 'a', 2, { upgrades: 'v_whirlwind' }))).toMatch(/which no node grants/);
  });
  it('rejects nodes the branch can never reach', () => {
    expect(errsWith(mk('c0', 'c', 0), mk('c4', 'c', 4))).toMatch(/c4: unreachable/);
    expect(errsWith(mk('x', 'a', 2, { prereqs: [{ node: 'a1', rank: 4 }] }))).toMatch(/rank 4 is outside 1..3/);
  });
  it('every prerequisite is drawn: each connector runs down its own branch column to a later tier', () => {
    for (const n of NODES) for (const p of n.prereqs) {
      const pre = NODES.find((x) => x.id === p.node)!;
      expect(pre.branch, `${n.id} <- ${p.node}`).toBe(n.branch);
      expect(pre.tier, `${n.id} <- ${p.node}`).toBeLessThan(n.tier);
    }
  });
});
