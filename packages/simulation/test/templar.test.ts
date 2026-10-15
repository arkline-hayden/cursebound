import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { CLASS_BY_ID, NODES, RULES, SKILL_BY_ID } from '@cursebound/content';
import { hitPlayer, stateHash, type SimState } from '@cursebound/simulation';
import { BTN, arena, casts, dist, give, hitsOn, hpLeft, inp, run, spawn } from './tb.helpers';

const T = 'templar';

describe('templar content', () => {
  it('three deep branches with evolution choices and keystone pairs', () => {
    const cls = CLASS_BY_ID[T];
    expect('resource' in cls).toBe(false);
    for (const b of cls.branches) {
      const bn = NODES.filter((n) => n.classId === T && n.branch === b.id);
      expect(bn.length).toBeGreaterThanOrEqual(11);
      expect(bn.filter((n) => n.grantsSkill).length).toBe(3);
      expect(bn.filter((n) => n.tier === 4 && n.excludes?.length).length).toBe(2);
      expect(bn.some((n) => n.tier === 2 && n.excludes?.length && !n.grantsSkill)).toBe(true);
    }
    const actives = NODES.filter((n) => n.classId === T && n.grantsSkill).map((n) => n.grantsSkill!);
    expect(new Set(actives).size).toBe(9);
    for (const id of actives) expect(SKILL_BY_ID[id]).toBeTruthy();
  });
});

describe('templar kit', () => {
  it('every third hammer swing releases a radiant shockwave', () => {
    const s = arena([T]);
    const e = spawn(s, 11.5, 10, { hp: 1e7 });
   
    const ev = run(s, 150, () => [inp(BTN.ATTACK, 1, 0)]);
    const swings = casts(ev, 't_hammer').length;
    expect(swings).toBeGreaterThanOrEqual(3);
    expect(casts(ev, 't_shockwave').length).toBe(Math.floor(swings / 3));
    expect(hpLeft(e).lt(Big.from(1e7))).toBe(true);
  });

  it('Judgment Day pulls, damages and stuns, then consecrates the ground', () => {
    const s = arena([T]);
    const a = spawn(s, 16.5, 10, { hp: 1e7 });
    const b = spawn(s, 14, 12.5, { hp: 1e7 });
    const before = dist(a, b);
    run(s, 1, () => [inp(BTN.SIG, 5, 0)]);
    expect(s.hazards.some((h) => h.kind === 't_judgment')).toBe(true);
    const ev = run(s, 30, () => [inp(0, 5, 0)]);
    expect(casts(ev, 't_judgment_land').length).toBe(1);
    expect(dist(a, b)).toBeLessThan(before);
    expect(a.staggerUntil).toBeGreaterThan(s.tick);
    expect(hpLeft(a).lt(Big.from(1e7))).toBe(true);
    expect(s.hazards.some((h) => h.kind === 't_consecration')).toBe(true);
  });

  it('Consecrate burns enemies inside and heals allies inside', () => {
    const s = arena([T]);
    give(s, 0, { t_consecrate: 1 });
    const e = spawn(s, 11.5, 10, { hp: 1e7 });
    const p = s.players[0];
    p.hp = p.maxHp.mul(Big.from('0.5'));
    run(s, 1, () => [inp(BTN.S1)]);
    const g = s.hazards.find((h) => h.kind === 't_consecration');
    expect(g).toBeTruthy();
    const ev = run(s, 90);
    expect(hitsOn(ev, e.id)).toBeGreaterThanOrEqual(3);
    expect(p.hp.gt(p.maxHp.mul(Big.from('0.5')))).toBe(true);
  });

  it('Sanctuary consecration follows the Templar; Blinding Light stuns on cast', () => {
    const s = arena([T]);
    give(s, 0, { t_consecrate: 1, t_hallowed_ground: 2, t_sanctuary: 1 });
    run(s, 1, () => [inp(BTN.S1)]);
    run(s, 40, () => [inp(0, 1, 0, 0, 1)]);
    const g = s.hazards.find((h) => h.kind === 't_consecration')!;
    expect(dist(g, s.players[0])).toBeLessThan(0.01);
    const s2 = arena([T]);
    give(s2, 0, { t_consecrate: 1, t_hallowed_ground: 2, t_blinding_light: 1 });
    const e = spawn(s2, 11.5, 10, { hp: 1e7 });
    run(s2, 1, () => [inp(BTN.S1)]);
    expect(e.staggerUntil).toBeGreaterThan(s2.tick);
    expect(e.vulnFactor).toBe('1.15');
  });

  it('Hammer of Judgment flies out, returns and strikes on both legs', () => {
    const s = arena([T]);
    give(s, 0, { t_hammer_throw: 1 });
    const e = spawn(s, 13, 10, { hp: 1e7 });
    run(s, 1, () => [inp(BTN.S2, 6, 0)]);
    expect(s.projectiles.some((pr) => pr.kind === 't_hammer')).toBe(true);
    let sawReturn = false;
    const ev: ReturnType<typeof run> = [];
    for (let i = 0; i < 120; i++) { ev.push(...run(s, 1)); if (s.projectiles.some((pr) => pr.kind === 't_hammer_r')) sawReturn = true; }
    expect(sawReturn).toBe(true);
    expect(hitsOn(ev, e.id)).toBeGreaterThanOrEqual(2);          // outbound and return strikes
    expect(casts(ev, 't_hammer_catch').length).toBe(1);
    expect(s.projectiles.filter((pr) => pr.ownerId === 0 && pr.kind.startsWith('t_hammer')).length).toBe(0);
  });

  it('Condemnation marks on hammer hits and basic swings detonate the mark', () => {
    const s = arena([T]);
    give(s, 0, { t_hammer_throw: 1, t_condemnation: 2 });
    const e = spawn(s, 12, 10, { hp: 1e7 });
    run(s, 1, () => [inp(BTN.S2, 6, 0)]);
    run(s, 6);
    expect(s.hazards.some((h) => h.kind === 't_condemn' && h.hitSlots[0] === e.id)).toBe(true);
    const ev = run(s, 90, () => [inp(BTN.ATTACK, 1, 0)]);
    expect(casts(ev, 't_condemn_burst').length).toBeGreaterThanOrEqual(1);
  });

  it('Skyfall smites where the hammer stops; Divine Smite strikes up to three enemies', () => {
    const s = arena([T]);
    give(s, 0, { t_hammer_throw: 1, t_weighted_head: 2, t_skyfall: 1 });
    expect(s.players[0].skills[1].skillId).toBe('t_skyfall');
    spawn(s, 14, 10, { hp: 1e7 });
    run(s, 1, () => [inp(BTN.S2, 4, 0)]);
    const ev = run(s, 40);
    expect(casts(ev, 't_skyfall_smite').length).toBe(1);

    const s2 = arena([T]);
    give(s2, 0, { t_hammer_throw: 1, t_weighted_head: 2, t_smite: 1 });
    const es = [spawn(s2, 16, 10, { hp: 1e7 }), spawn(s2, 16, 12, { hp: 1e7 }), spawn(s2, 16, 8, { hp: 1e7 }), spawn(s2, 17, 10.5, { hp: 1e7 })];
    const ev2 = run(s2, 1, () => [inp(BTN.S2, 6, 0)]);
    expect(casts(ev2, 't_smite_hit').length).toBe(3);
    expect(es.filter((e) => e.staggerUntil > s2.tick).length).toBeGreaterThanOrEqual(3);
    expect(s2.players[0].skills[1].charges).toBe(1);   // two charges
  });

  it('Shield Charge carries the Templar 5 units and hurls enemies aside', () => {
    const s = arena([T]);
    give(s, 0, { t_shield_charge: 1 });
    const e = spawn(s, 12.5, 10.1, { hp: 1e7 });
    const x0 = s.players[0].x;
    const ev = run(s, 30, (t) => [inp(t === 0 ? BTN.S3 : 0, 1, 0)]);
    expect(s.players[0].x - x0).toBeGreaterThan(4.5);
    expect(hitsOn(ev, e.id)).toBeGreaterThanOrEqual(1);
    expect(Math.abs(e.y - 10.1)).toBeGreaterThan(0.5);
    expect(casts(ev, 't_charge_end').length).toBe(1);
  });

  it('Aegis Charge raises a dome that blocks projectiles and softens blows', () => {
    const s = arena([T, 'vanguard']);
    give(s, 0, { t_shield_charge: 1, t_bulwark_of_faith: 2, t_aegis_charge: 1 });
    run(s, 30, (t) => [inp(t === 0 ? BTN.S3 : 0, 1, 0), null]);
    const dome = s.hazards.find((h) => h.kind === 't_dome')!;
    expect(dome).toBeTruthy();
    // an enemy bolt flying into the dome is destroyed
    s.projectiles.push({ id: 99999, kind: 'shard', owner: 'enemy', ownerId: -1, x: dome.x + 2, y: dome.y, vx: -6, vy: 0, radius: 0.2, range: 9, damage: Big.from(10), weight: Big.ONE, dtype: 'physical', pierce: 0, hitIds: [], skillId: 'x', crit: false, lobTarget: null, bornTick: s.tick });
    const ev = run(s, 2, () => [null, null]);
    expect(s.projectiles.some((pr) => pr.id === 99999)).toBe(false);
    expect(casts(ev, 't_dome_block').length).toBe(1);
    // the ally standing in the dome takes x0.6
    const ally = s.players[1];
    ally.x = dome.x; ally.y = dome.y; ally.iframes = 0; ally.shield = Big.ZERO;
    const hp0 = ally.hp;
    hitPlayer(s, [], ally, Big.from(100), { attack: 'test', source: 'test', fromX: ally.x + 1, fromY: ally.y, dtype: 'physical' });
    const lost = hp0.sub(ally.hp).toNumber();
    const VA = CLASS_BY_ID.vanguard.base.armor;
    const full = 100 * (100 / (100 + VA)) * Number(RULES.meleeDamageTakenMult);     // vanguard armor, Close Quarters (melee)
    expect(lost).toBeCloseTo(full * 0.6, 3);
  });

  it('Intercession leaps to an ally and binds both with Vows that burst when broken', () => {
    const s = arena([T, 'vanguard']);
    give(s, 0, { t_shield_charge: 1, t_steadfast: 2, t_intercession: 1 });
    const ally = s.players[1];
    ally.x = 16; ally.y = 10;
    const e = spawn(s, 16.5, 11, { hp: 1e7 });
    const ev = run(s, 40, (t) => [inp(t === 0 ? BTN.S3 : 0, 6, 0), null]);
    expect(dist(s.players[0], ally)).toBeLessThan(1.5);
    expect(casts(ev, 't_intercession_land').length).toBe(1);
    expect(hitsOn(ev, e.id)).toBeGreaterThanOrEqual(1);
    expect(s.hazards.filter((h) => h.kind === 't_vow').length).toBe(2);
    expect(ally.shield.isZero()).toBe(false);
    ally.iframes = 0;
    const ev2: ReturnType<typeof run> = [];
    hitPlayer(s, ev2, ally, ally.shield.mul(Big.from(10)), { attack: 'test', source: 'test', fromX: ally.x + 1, fromY: ally.y, dtype: 'physical' });
    expect(casts(ev2, 't_vow_burst').length).toBe(1);
  });

  it('Divine Intervention saves a lethal blow once per round', () => {
    const s = arena([T, 'vanguard']);
    give(s, 0, { t_shield_charge: 1, t_bulwark_of_faith: 3, t_steadfast: 1, t_divine_intervention: 1 });
    const ally = s.players[1];
    ally.iframes = 0;
    hitPlayer(s, [], ally, ally.maxHp.mul(Big.from(10)), { attack: 'test', source: 'test', fromX: ally.x + 1, fromY: ally.y, dtype: 'physical' });
    expect(ally.lifeState).toBe('alive');
    expect(ally.hp.ratio(ally.maxHp)).toBeCloseTo(0.3, 3);
    expect(ally.iframes).toBeGreaterThanOrEqual(2);
    ally.iframes = 0;
    hitPlayer(s, [], ally, ally.maxHp.mul(Big.from(10)), { attack: 'test', source: 'test', fromX: ally.x + 1, fromY: ally.y, dtype: 'physical' });
    expect(ally.lifeState).toBe('downed');
  });

  it('Holy Sanctum: allies in holy ground take x0.8 damage; Living Bastion redirects a quarter', () => {
    const s = arena([T, 'vanguard']);
    give(s, 0, { t_consecrate: 1, t_hallowed_ground: 3, t_benediction: 3, t_sanctum: 1 });
    run(s, 1, () => [inp(BTN.S1), null]);
    const ally = s.players[1];
    ally.x = s.players[0].x + 1; ally.y = s.players[0].y; ally.iframes = 0;
    const hp0 = ally.hp;
    hitPlayer(s, [], ally, Big.from(100), { attack: 'test', source: 'test', fromX: ally.x + 1, fromY: ally.y, dtype: 'physical' });
    expect(hp0.sub(ally.hp).toNumber()).toBeCloseTo(100 * (100 / (100 + CLASS_BY_ID.vanguard.base.armor)) * Number(RULES.meleeDamageTakenMult) * 0.8, 3);   // vanguard armor, Close Quarters

    const s2 = arena([T, 'vanguard']);
    give(s2, 0, { t_shield_charge: 1, t_bulwark_of_faith: 3, t_steadfast: 3, t_shield_slam: 1, t_living_bastion: 1 });
    const t = s2.players[0], a = s2.players[1];
    t.iframes = 0; a.iframes = 0;
    const th0 = t.hp, ah0 = a.hp;
    hitPlayer(s2, [], a, Big.from(100), { attack: 'test', source: 'test', fromX: a.x + 1, fromY: a.y, dtype: 'physical' });
    expect(ah0.sub(a.hp).toNumber()).toBeCloseTo(100 * (100 / (100 + CLASS_BY_ID.vanguard.base.armor)) * Number(RULES.meleeDamageTakenMult) * 0.75, 3);
    expect(t.hp.lt(th0)).toBe(true);
  });

  it('is deterministic: same seed and inputs give the same state hash', () => {
    const play = (): SimState => {
      const s = arena([T, T], 'TEMPLAR_DET');
      give(s, 0, { t_hammer_throw: 1, t_condemnation: 2, t_heavens_call: 0 });
      give(s, 1, { t_consecrate: 1, t_beacon: 1, t_shield_charge: 1 });
      for (let i = 0; i < 6; i++) spawn(s, 14 + (i % 3), 9 + Math.floor(i / 3) * 2, { hp: 5000, count: 1 + (i % 2) });
      run(s, 240, (t) => [
        inp(BTN.ATTACK | (t % 50 === 0 ? BTN.S2 : 0) | (t === 30 ? BTN.SIG : 0), 4, (t % 7) - 3),
        inp(BTN.ATTACK | (t % 60 === 5 ? BTN.S1 : 0) | (t === 90 ? BTN.S3 : 0), 3, 1, t < 100 ? 0.5 : 0, 0),
      ]);
      return s;
    };
    const a = play(), b = play();
    expect(stateHash(a)).toBe(stateHash(b));
  });
});
