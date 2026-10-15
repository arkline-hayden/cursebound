import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { CLASS_BY_ID, NODES, RULES, SKILL_BY_ID } from '@cursebound/content';
import { buildSnapshot, hitPlayer, stateHash, type SimState } from '@cursebound/simulation';
import { BTN, arena, casts, dist, give, hitsOn, hpLeft, inp, run, spawn } from './tb.helpers';

const B_ = 'berserker';
const hit = (s: SimState, slot: number, amount: Big) => {
  const p = s.players[slot];
  p.iframes = 0;
  return hitPlayer(s, [], p, amount, { attack: 'test', source: 'test', fromX: p.x + 1, fromY: p.y, dtype: 'physical' });
};

describe('berserker content', () => {
  it('no resource pool, purely cooldown-gated skills, and three deep branches', () => {
    const cls = CLASS_BY_ID[B_];
    expect('resource' in cls).toBe(false);
    for (const b of cls.branches) {
      const bn = NODES.filter((n) => n.classId === B_ && n.branch === b.id);
      expect(bn.length).toBeGreaterThanOrEqual(11);
      expect(bn.filter((n) => n.grantsSkill).length).toBe(3);
      expect(bn.filter((n) => n.tier === 4 && n.excludes?.length).length).toBe(2);
      expect(bn.some((n) => n.tier === 2 && n.excludes?.length && !n.grantsSkill)).toBe(true);
    }
    const actives = NODES.filter((n) => n.classId === B_ && n.grantsSkill).map((n) => n.grantsSkill!);
    expect(new Set(actives).size).toBe(9);
    for (const id of actives) expect(SKILL_BY_ID[id]).toBeTruthy();
  });
});

describe('berserker kit', () => {
  it('Rage: connecting chops and health lost cut active cooldowns, never the Avatar', () => {
    const s = arena([B_]);
    const p = s.players[0];
    for (const k of p.skills) { k.charges = 0; k.cooldown = 5; }
    const e = spawn(s, 11.4, 10, { hp: 1e7 });
    const ev = run(s, 60, () => [inp(BTN.ATTACK)]);
    const swings = casts(ev, 'b_chop').length;
    expect(swings).toBeGreaterThanOrEqual(2);
    expect(hitsOn(ev, e.id)).toBeGreaterThanOrEqual(4);                 // two strikes per swing
    // 1s of natural recovery plus 0.1s per connecting swing on the actives; the signature only recovers naturally
    expect(p.skills[0].cooldown).toBeCloseTo(5 - 1 - 0.1 * swings, 1);
    expect(p.skills[3].cooldown).toBeCloseTo(4, 1);
    expect(p.vars.b_frenzy).toBeGreaterThanOrEqual(2);
    expect(buildSnapshot(s).players[0].kv?.frenzy).toBe(p.vars.b_frenzy);
    const c0 = p.skills[1].cooldown;
    hit(s, 0, p.maxHp.mul(Big.from('0.1')));
    expect(p.skills[1].cooldown).toBeCloseTo(c0 - 0.02 * 10 * (100 / 120) * Number(RULES.meleeDamageTakenMult), 3);   // 0.02s per 1% of maximum health lost (after armor 20 and Close Quarters)
    run(s, 60 * 5);
    expect(p.vars.b_frenzy).toBe(0);
  });

  it('Frenzy stacks speed up attacks', () => {
    const swings = (frenzy: boolean) => {
      const s = arena([B_]);
      spawn(s, 11.4, 10, { hp: 1e9 });
      if (!frenzy) { s.players[0].vars.b_frenzy = 0; }
      let n = 0;
      for (let t = 0; t < 600; t++) { if (!frenzy) s.players[0].vars.b_frenzy = 0; n += casts(run(s, 1, () => [inp(BTN.ATTACK)]), 'b_chop').length; }
      return n;
    };
    expect(swings(true)).toBeGreaterThan(swings(false) * 1.15);
  });

  it('Avatar of Carnage lasts 5s, grows with kills and hardens the Berserker', () => {
    const s = arena([B_]);
    const p = s.players[0];
    spawn(s, 11.5, 10, { hp: 1e7 });
   
    const ev = run(s, 1, () => [inp(BTN.SIG)]);
    const c = casts(ev, 'b_avatar')[0];
    expect(c).toBeTruthy();
    expect(c.dx).toBeCloseTo(5, 5);                                        // fixed 5s; kills extend it up to 7s
    expect(p.buffs.some((b) => b.id === 'avatar')).toBe(true);
    expect(s.hazards.some((h) => h.kind === 'b_avatar')).toBe(true);
    const hp0 = p.hp;
    hit(s, 0, Big.from(100));
    expect(hp0.sub(p.hp).toNumber()).toBeCloseTo(100 * (100 / 120) * Number(RULES.meleeDamageTakenMult) * 0.8, 3);   // armor 20, Close Quarters, Avatar x0.8
    const ev2 = run(s, 30, () => [inp(BTN.ATTACK)]);
    expect(casts(ev2, 'b_avatar_whirl').length).toBeGreaterThanOrEqual(1);
  });

  it('Whirlwind pulses around the moving Berserker and drags enemies inward', () => {
    const s = arena([B_]);
    give(s, 0, { b_whirlwind: 1 });
    const p = s.players[0];
   
    const e = spawn(s, 12.3, 10, { hp: 1e7 });
    const d0 = dist(e, p);
    const ev = run(s, 150, (t) => [inp(t === 0 ? BTN.S2 | BTN.ATTACK : BTN.ATTACK)]);
    expect(casts(ev, 'b_whirl_tick').length).toBe(10);                    // 2.5s at 0.25s
    expect(casts(ev, 'b_chop').length).toBe(0);                            // spinning replaces the basic attack
    expect(hitsOn(ev, e.id)).toBeGreaterThanOrEqual(10);
    expect(dist(e, p)).toBeLessThan(d0);
  });

  it('Earthshatter Leap flies untargetable to the aimed point and slams enemies away', () => {
    const s = arena([B_]);
    give(s, 0, { b_leap: 1, b_aftershock: 2 });
    const p = s.players[0];
   
    const e = spawn(s, 15.8, 10.4, { hp: 1e7 });
    run(s, 1, () => [inp(BTN.S3, 5, 0)]);
    expect(p.iframes).toBeGreaterThan(0.4);
    expect(s.hazards.some((h) => h.kind === 'b_leap_mark')).toBe(true);
    const ev = run(s, 60);
    expect(casts(ev, 'b_leap_land').length).toBe(1);
    expect(casts(ev, 'b_aftershock').length).toBe(1);
    expect(p.x).toBeGreaterThan(14.5);
    expect(hpLeft(e).lt(Big.from(1e7))).toBe(true);
    expect(dist(e, p)).toBeGreaterThan(1.2);
  });

  it('Intimidating Shout fears, weakens and rallies allies', () => {
    const s = arena([B_, 'vanguard']);
    give(s, 0, { b_leap: 1, b_iron_hide: 2, b_shout: 1 });
    const p = s.players[0];
   
    const e = spawn(s, 12, 10, { hp: 1e7, speed: 3 });
    const ev = run(s, 1, () => [inp(BTN.S3), null]);
    expect(casts(ev, 'b_shout').length).toBe(1);
    expect(e.vulnFactor).toBe('1.2');
    expect(s.hazards.some((h) => h.kind === 'b_fear' && h.hitSlots[0] === e.id)).toBe(true);
    expect(s.players[1].buffs.some((b) => b.id === 'battle_cry')).toBe(true);
    const d0 = dist(e, p);
    run(s, 60, () => [null, null]);
    expect(dist(e, p)).toBeGreaterThan(d0 + 1);                           // fled
  });

  it('Cataclysm sends three quake rings that stun', () => {
    const s = arena([B_]);
    give(s, 0, { b_leap: 1, b_heavy_landing: 2, b_cataclysm: 1 });
   
    const near = spawn(s, 15.5, 11, { hp: 1e7 });
    const far = spawn(s, 15, 14.2, { hp: 1e7 });
    const ev = run(s, 90, (t) => [inp(t === 0 ? BTN.S3 : 0, 5, 0)]);
    expect(casts(ev, 'b_quake_ring').length).toBe(3);
    expect(hitsOn(ev, near.id)).toBeGreaterThanOrEqual(1);
    expect(hitsOn(ev, far.id)).toBeGreaterThanOrEqual(1);
  });

  it('Executioner\'s Cleave lunges and executes a single wounded enemy', () => {
    const s = arena([B_]);
    give(s, 0, { b_whirlwind: 1, b_brutality: 2, b_executioner: 1 });
   
    const e = spawn(s, 14.5, 10, { hp: 1e9 });
    e.cohort.front = Big.from('8.8e8');                                   // 12% health left
    const ev = run(s, 30, (t) => [inp(t === 0 ? BTN.S2 : 0, 1, 0)]);
    expect(casts(ev, 'b_execute_cleave').length).toBe(1);
    expect(casts(ev, 'b_execute').length).toBe(1);
    expect(e.state).toBe('dying');
  });

  it('Bloodlust lifesteal heals from damage dealt', () => {
    const s = arena([B_]);
    give(s, 0, { b_bloodlust: 1 });
    const p = s.players[0];
   
    p.hp = p.maxHp.mul(Big.from('0.4'));
    spawn(s, 11.4, 10, { hp: 1e9 });
    run(s, 1, () => [inp(BTN.S1)]);
    expect(p.buffs.some((b) => b.id === 'bloodlust')).toBe(true);
    expect(p.vars.b_frenzy).toBe(3);
    run(s, 120, () => [inp(BTN.ATTACK)]);
    expect(p.hp.gt(p.maxHp.mul(Big.from('0.4')))).toBe(true);
  });

  it('Undying Rage and Deathless refuse death', () => {
    const s = arena([B_]);
    give(s, 0, { b_bloodlust: 1, b_savagery: 3, b_red_mist: 1, b_undying: 1 });
    const p = s.players[0];
    hit(s, 0, p.maxHp.mul(Big.from(5)));
    expect(p.lifeState).toBe('alive');
    expect(p.hp.toString()).toBe('1e0');
    expect(p.buffs.some((b) => b.id === 'undying')).toBe(true);
    hit(s, 0, p.maxHp.mul(Big.from(5)));                                   // still Undying: cannot drop below 1
    expect(p.lifeState).toBe('alive');

    const s2 = arena([B_]);
    give(s2, 0, { b_bloodlust: 1, b_savagery: 3, b_red_mist: 3, b_deathless: 1 });
    const q = s2.players[0];
   
    const ev2: Parameters<typeof hitPlayer>[1] = [];
    q.iframes = 0;
    hitPlayer(s2, ev2, q, q.maxHp.mul(Big.from(3)), { attack: 'test', source: 'test', fromX: q.x + 1, fromY: q.y, dtype: 'physical' });
    expect(q.lifeState).toBe('alive');
    expect(casts(ev2, 'b_deathless')[0]?.dx).toBe(40);                    // recharges in 40s
    q.iframes = 0; q.hp = q.maxHp;
    hit(s2, 0, q.maxHp.mul(Big.from(3)));
    expect(q.lifeState).toBe('downed');
  });

  it('Bounding Fury grants a second, harder-landing leap', () => {
    const s = arena([B_]);
    give(s, 0, { b_leap: 1, b_heavy_landing: 2, b_bounding: 1 });
    const p = s.players[0];
    expect(p.skills[2].maxCharges).toBe(2);
   
    run(s, 1, () => [inp(BTN.S3, 3, 0)]);
    expect(p.vars.b_bfEmp).toBe(0);
    run(s, 40);
    run(s, 1, () => [inp(BTN.S3, -3, 0)]);
    expect(p.vars.b_bfEmp).toBe(1);                                         // the second leap within 3s lands for x1.3
    expect(p.skills[2].charges).toBe(0);
  });

  it('is deterministic: same seed and inputs give the same state hash', () => {
    const play = (): SimState => {
      const s = arena([B_, B_], 'BERSERKER_DET');
      give(s, 0, { b_whirlwind: 1, b_rend: 2, b_red_harvest: 0, b_leap: 1 });
      give(s, 1, { b_bloodlust: 1, b_leap: 1, b_cataclysm: 1, b_whirlwind: 1 });
      for (let i = 0; i < 6; i++) spawn(s, 13 + (i % 3), 9 + Math.floor(i / 3) * 2, { hp: 4000, count: 1 + (i % 2), speed: 1 });
      run(s, 300, (t) => [
        inp(BTN.ATTACK | (t % 70 === 10 ? BTN.S2 : 0) | (t === 200 ? BTN.S3 : 0) | (t === 120 ? BTN.SIG : 0), 3, (t % 5) - 2),
        inp(BTN.ATTACK | (t % 90 === 3 ? BTN.S1 : 0) | (t === 60 ? BTN.S3 : 0), 4, 1, t < 120 ? 0.4 : 0, 0),
      ]);
      return s;
    };
    const a = play(), b = play();
    expect(stateHash(a)).toBe(stateHash(b));
    expect(a.scoreText).toBe(b.scoreText);
  });
});

describe('templar + berserker in real runs', () => {
  it('bot-driven co-op run with Vanguard advances rounds without technical failure', async () => {
    const { newRun, runBot } = await import('./run.helpers');
    const s = newRun(['templar', 'berserker', 'vanguard'], 'TB_BOT_RUN');
    runBot(s, { maxTicks: 60 * 60 * 5 });
    expect(s.round).toBeGreaterThan(1);
    expect(JSON.stringify(buildSnapshot(s))).not.toMatch(/NaN|Infinity/);
  });

  it('absurd Fate factors with near-full trees stay finite', async () => {
    const { runBot } = await import('./run.helpers');
    const s = arena(['templar', 'berserker'], 'TB_ABSURD');
    const pick = (cls: string) => {
      const out: Record<string, number> = {};
      const taken = new Set<string>();
      for (const n of NODES.filter((x) => x.classId === cls)) {
        if (n.excludes?.some((x) => taken.has(x))) continue;
        out[n.id] = n.rankLimit; taken.add(n.id);
      }
      return out;
    };
    give(s, 0, pick('templar'));
    give(s, 1, pick('berserker'));
    s.fate.factors['player.attackFrequency'] = Big.from('1e300');
    s.fate.factors['player.damage'] = Big.from('1e500');
    s.fate.factors['player.projectileCount'] = Big.from('1e40');
    s.fate.factors['player.recoveryRate'] = Big.from('1e60');
    s.fate.factors['enemy.damage'] = Big.from('1e400');
    s.stateVersion++;
    for (let i = 0; i < 8; i++) spawn(s, 12 + (i % 4), 9 + Math.floor(i / 4) * 3, { hp: 1e6, count: 1 + i * 100, speed: 2 });
    s.players.forEach((p) => { p.iframes = 0; });
    runBot(s, { maxTicks: 60 * 12 });
    const snap = JSON.stringify(buildSnapshot(s));
    expect(snap).not.toMatch(/NaN|Infinity/);
  });
});
