import { describe, expect, it } from 'vitest';
import { CARDS, CLASSES, MECHANICS, MECHANIC_BY_ID, NODES, STAT_BY_ID, cardRarity, contentHash, mechanicText, sha256Hex, validateCard, validateContent, canonicalJson } from '@cursebound/content';

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
  // Nodes whose effect involves the class resource (pools, regen, costs). Their text is owned by the resource
  // removal pass and is exempt from the copy rules until it is rewritten.
  const RESOURCE_NODES = new Set([
    'a_heat_sink', 'a_ash_recovery', 'a_charged_reserve', 'a_tempest', 'a_event_horizon',
    'c_winter_tide', 'c_frozen_momentum',
    'af_quick_fuse', 'af_pressure_valves', 'af_steam_engine', 'af_perpetual_engine',
    'b_bounding', 'b_blood_brothers', 'b_deathless', 'b_endless_storm', 'b_red_harvest', 'b_warmonger',
    'd_momentum_well', 'd_execution', 'd_riposte', 'd_reapers_path',
    'h_blood_price', 'h_sanguine_lance', 'h_crimson_frenzy', 'h_soul_harvest',
    't_momentum',
    'v_guard_stance', 'v_sweeping_strike', 'v_executioner', 'v_rally_cry', 'v_war_banner', 'v_thunder_shout', 'v_warchief',
    'w_spirit_bond',
  ]);
  const copyNodes = NODES.filter((n) => !RESOURCE_NODES.has(n.id));
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
