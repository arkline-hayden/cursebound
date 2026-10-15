import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { SKILL_BY_ID } from '@cursebound/content';
import { addDot, killEnemy, stateHash, type SimState } from '@cursebound/simulation';
import { ACTION, aimAt, casts, damaged, dead, dist, kit, run, spawn } from './kits3.helpers';
import { newRun, runBot } from './run.helpers';

const PEST8 = ['h_plague_cloud', 'h_virulence', 'h_virulence', 'h_virulence', 'h_lingering_rot', 'h_lingering_rot', 'h_fetid_reach', 'h_fetid_reach'];
const BLOOD8 = ['h_blood_tether', 'h_crimson_vigor', 'h_crimson_vigor', 'h_crimson_vigor', 'h_thirst', 'h_thirst', 'h_blood_price', 'h_blood_ward'];
const WRAITH8 = ['h_summon_wraith', 'h_grave_strength', 'h_grave_strength', 'h_grave_strength', 'h_soul_harvest', 'h_soul_harvest', 'h_spectral_haste', 'h_spectral_haste'];
const rot = (s: SimState, e: { dots: { src: number; type: string; until: number }[] }) => e.dots.filter((d) => d.src === 0 && d.type === 'decay' && d.until > s.tick);
const hazards = (s: SimState, kind: string) => s.hazards.filter((h) => h.kind === kind);

describe('hexbinder: basic and signature', () => {
  it('Hex Bolt flies as an hx_bolt projectile and stacks rot on its target', () => {
    const k = kit('hexbinder', []);
    const e = spawn(k, 'pursuer', 3, 0, '1000');
    let bolts = 0;
    for (let i = 0; i < 150; i++) { run(k, 1, ACTION.ATTACK, 1, aimAt(k, e)); bolts = Math.max(bolts, k.s.projectiles.filter((p) => p.kind === 'hx_bolt').length); }
    expect(bolts).toBeGreaterThan(0);
    expect(casts(k, 'h_hex_bolt').length).toBeGreaterThan(2);
    expect(damaged(e)).toBe(true);
    expect(rot(k.s, e).length).toBeGreaterThanOrEqual(2);
  });

  it('Grave Tide rolls forward, rots and shoves what it hits, and the slain rise as homing spirits', () => {
    const k = kit('hexbinder', []);
    const a = spawn(k, 'pursuer', 2.5, 0, '1000');
    const b = spawn(k, 'pursuer', 4.5, 8, '1000');
    const weak = spawn(k, 'pursuer', 3.5, -8, '0.0001');
    const p = k.s.players[0];
    const d0 = dist(a, p);
    let spirits = 0;
    for (let i = 0; i < 90; i++) {
      run(k, 1, i === 0 ? ACTION.SIGNATURE : 0);
      spirits = Math.max(spirits, k.s.projectiles.filter((x) => x.kind === 'hx_spirit').length);
    }
    expect(casts(k, 'h_grave_tide')).toHaveLength(1);
    expect(damaged(a) && damaged(b)).toBe(true);
    expect(dist(a, p)).toBeGreaterThan(d0 + 0.3);
    expect(rot(k.s, a).length).toBeGreaterThan(0);
    expect(dead(weak)).toBe(true);
    expect(spirits).toBeGreaterThanOrEqual(1);
  });
});

describe('hexbinder: Pestilence', () => {
  it('Plague Cloud lands at the aimed point and pulses decay damage and rot', () => {
    const k = kit('hexbinder', ['h_plague_cloud']);
    const e = spawn(k, 'pursuer', 4, 0, '1000');
    run(k, 1, ACTION.SKILL1, 1, aimAt(k, e));
    const cloud = hazards(k.s, 'hx_plague')[0];
    expect(cloud).toBeTruthy();
    expect(dist(cloud, e)).toBeLessThan(1);
    run(k, 60, 0, 0, aimAt(k, e));
    expect(damaged(e)).toBe(true);
    expect(rot(k.s, e).length).toBeGreaterThan(0);
  });

  it('Blightbloom (evolution) replaces Plague Cloud, spits homing seeds and bursts when it withers', () => {
    const k = kit('hexbinder', ['h_plague_cloud', 'h_virulence', 'h_virulence', 'h_blightbloom']);
    expect(k.s.players[0].skills[0].skillId).toBe('h_blightbloom');
    const e1 = spawn(k, 'pursuer', 4, 0, '1000');
    const e2 = spawn(k, 'pursuer', 5, 25, '1000');
    run(k, 1, ACTION.SKILL1, 1, aimAt(k, e1));
    expect(hazards(k.s, 'hx_bloom')).toHaveLength(1);
    let seeds = 0;
    for (let i = 0; i < 380; i++) { run(k, 1, 0, 0, aimAt(k, e1)); seeds = Math.max(seeds, k.s.projectiles.filter((x) => x.kind === 'hx_seed').length); }
    expect(seeds).toBeGreaterThanOrEqual(1);
    expect(damaged(e1) && damaged(e2)).toBe(true);
    expect(casts(k, 'h_blightbloom_burst')).toHaveLength(1);
  });

  it('Locust Swarm sweeps out and hunts, shredding enemies with rot', () => {
    const k = kit('hexbinder', ['h_plague_cloud', 'h_virulence', 'h_virulence', 'h_locust_swarm']);
    const e = spawn(k, 'pursuer', 6, 0, '1000');
    run(k, 1, ACTION.SKILL1, 1, [k.dir[0] * 3, k.dir[1] * 3]);
    const sw = hazards(k.s, 'hx_swarm')[0];
    expect(sw).toBeTruthy();
    run(k, 120);
    expect(dist(sw, e)).toBeLessThan(1.5);
    expect(damaged(e)).toBe(true);
    expect(rot(k.s, e).length).toBeGreaterThan(0);
  });

  it('Contagion spreads remaining rot on death and Corpse Bloom bursts the corpse', () => {
    const k = kit('hexbinder', ['h_plague_cloud', 'h_virulence', 'h_virulence', 'h_virulence', 'h_lingering_rot', 'h_contagion', 'h_corpse_bloom']);
    const victim = spawn(k, 'pursuer', 4, 0, '1000');
    const n1 = spawn(k, 'pursuer', 5.2, 8, '1000');
    const n2 = spawn(k, 'pursuer', 5.2, -8, '1000');
    addDot(k.s, victim, 0, 'decay', Big.from(200), 4);
    killEnemy(k.s, k.events, victim, 1);   // an ally's kill still spreads the plague
    expect(rot(k.s, n1).length).toBe(1);
    expect(rot(k.s, n2).length).toBe(1);
    expect(casts(k, 'h_contagion')).toHaveLength(2);
    expect(hazards(k.s, 'hx_corpse')).toHaveLength(1);
    run(k, 20);
    expect(casts(k, 'h_corpse_bloom')).toHaveLength(1);
    expect(damaged(n1) && damaged(n2)).toBe(true);
  });

  it('Rupture detonates 5+ rot stacks and consumes them', () => {
    const k = kit('hexbinder', [...PEST8, 'h_rupture']);
    const e = spawn(k, 'pursuer', 3, 0, '100000');
    run(k, 240, ACTION.ATTACK, 240, aimAt(k, e));
    expect(casts(k, 'h_rupture').length).toBeGreaterThanOrEqual(1);
    expect(rot(k.s, e).length).toBeLessThan(6);
  });

  it('Black Death infects the nearest clean enemy every second', () => {
    const k = kit('hexbinder', [...PEST8, 'h_black_death']);
    const a = spawn(k, 'pursuer', 4, 0, '1000');
    const b = spawn(k, 'pursuer', 5.5, 0, '1000');
    addDot(k.s, a, 0, 'decay', Big.from(50), 6);
    run(k, 62);
    expect(rot(k.s, b).length).toBeGreaterThan(0);
    expect(casts(k, 'h_contagion').length).toBeGreaterThan(0);
  });
});

describe('hexbinder: Sanguine', () => {
  it('Blood Tether latches the aimed enemy, drains it and heals you', () => {
    const k = kit('hexbinder', ['h_blood_tether']);
    const p = k.s.players[0];
    const e = spawn(k, 'pursuer', 3, 0, '1000');
    p.hp = p.maxHp.mul(Big.from('0.5'));
    run(k, 1, ACTION.SKILL2, 1, aimAt(k, e));
    expect(hazards(k.s, 'hx_tether')).toHaveLength(1);
    const hp0 = p.hp;
    run(k, 120, 0, 0, aimAt(k, e));
    expect(damaged(e)).toBe(true);
    expect(p.hp.gt(hp0)).toBe(true);
  });

  it('Blood Price pays 3% health per cast for a x0.7 cooldown, never below 35%', () => {
    const k = kit('hexbinder', ['h_blood_tether', 'h_blood_price']);
    const p = k.s.players[0];
    const e = spawn(k, 'pursuer', 3, 0, '1000');
    const slot = p.skills.findIndex((x) => x.skillId === 'h_blood_tether');
    run(k, 1, ACTION.SKILL2, 1, aimAt(k, e));
    expect(casts(k, 'h_blood_tether')).toHaveLength(1);
    expect(casts(k, 'h_blood_price')).toHaveLength(1);
    expect(p.hp.ratio(p.maxHp)).toBeCloseTo(0.97, 6);
    expect(p.skills[slot].cooldown).toBeCloseTo(SKILL_BY_ID['h_blood_tether'].cooldownSec * 0.7, 6);
    // at 37% health paying would cross 35%: the cast goes through unpaid, with the full cooldown
    const k2 = kit('hexbinder', ['h_blood_tether', 'h_blood_price']);
    const p2 = k2.s.players[0];
    const e2 = spawn(k2, 'pursuer', 3, 0, '1000');
    p2.hp = p2.maxHp.mul(Big.from('0.37'));
    run(k2, 1, ACTION.SKILL2, 1, aimAt(k2, e2));
    expect(casts(k2, 'h_blood_tether')).toHaveLength(1);
    expect(casts(k2, 'h_blood_price')).toHaveLength(0);
    expect(p2.hp.ratio(p2.maxHp)).toBeCloseTo(0.37, 6);
    expect(p2.skills[slot].cooldown).toBeCloseTo(SKILL_BY_ID['h_blood_tether'].cooldownSec, 6);
  });

  it('Hemorrhage (evolution) rips and drags nearby enemies toward you and heals', () => {
    const k = kit('hexbinder', ['h_blood_tether', 'h_crimson_vigor', 'h_crimson_vigor', 'h_hemorrhage']);
    const p = k.s.players[0];
    expect(p.skills[1].skillId).toBe('h_hemorrhage');
    const a = spawn(k, 'pursuer', 3.5, 0, '1000');
    const b = spawn(k, 'pursuer', 3.5, 60, '1000');
    const da = dist(a, p), db = dist(b, p);
    p.hp = p.maxHp.mul(Big.from('0.5'));
    const hp0 = p.hp;
    run(k, 1, ACTION.SKILL2);
    expect(casts(k, 'h_hemorrhage_t')).toHaveLength(2);
    expect(dist(a, p)).toBeLessThan(da - 0.5);
    expect(dist(b, p)).toBeLessThan(db - 0.5);
    expect(damaged(a) && damaged(b)).toBe(true);
    expect(p.hp.gt(hp0)).toBe(true);
  });

  it('Sanguine Lance (evolution) pierces a line, healing and restoring Blood per enemy', () => {
    const k = kit('hexbinder', ['h_blood_tether', 'h_crimson_vigor', 'h_crimson_vigor', 'h_sanguine_lance']);
    const p = k.s.players[0];
    const es = [2, 4, 6].map((d) => spawn(k, 'pursuer', d, 0, '1000'));
    p.hp = p.maxHp.mul(Big.from('0.5'));
    run(k, 1, ACTION.SKILL2);
    expect(k.s.projectiles.some((x) => x.kind === 'hx_lance')).toBe(true);
    const hp0 = p.hp;
    run(k, 40);
    for (const e of es) expect(damaged(e)).toBe(true);
    expect(p.hp.gt(hp0)).toBe(true);
  });

  it('Blood Sacrament sacrifices health for Bloodlust and never goes below 30%', () => {
    const k = kit('hexbinder', [...BLOOD8, 'h_blood_sacrament']);
    const p = k.s.players[0];
    const e = spawn(k, 'pursuer', 3, 0, '1000');
    run(k, 1, ACTION.SKILL2, 1, aimAt(k, e));
    expect(p.hp.ratio(p.maxHp)).toBeCloseTo(0.97 * 0.92, 6);   // Blood Price (3%) then the Sacrament (8% of current)
    expect(p.vars.hx_lust).toBe(1);
    run(k, 200, 0, 0, aimAt(k, e));          // let the tether (and its healing) run out
    p.hp = p.maxHp.mul(Big.from('0.31'));
    run(k, 1, ACTION.SIGNATURE, 1, aimAt(k, e));
    expect(p.vars.hx_lust).toBe(2);
    expect(p.hp.ratio(p.maxHp)).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(p.hp.ratio(p.maxHp)).toBeLessThan(0.31);
  });

  it('Crimson Covenant turns Blood skill damage into a blood shield', () => {
    const k = kit('hexbinder', [...BLOOD8, 'h_crimson_covenant']);
    const p = k.s.players[0];
    const e = spawn(k, 'pursuer', 3, 0, '1000');
    run(k, 1, ACTION.SKILL2, 1, aimAt(k, e));
    run(k, 60, 0, 0, aimAt(k, e));
    expect(p.shield.isZero()).toBe(false);
  });
});

describe('hexbinder: Wraithcall', () => {
  it('Summon Wraith hunts the nearest enemy and slashes it with rot', () => {
    const k = kit('hexbinder', ['h_summon_wraith']);
    const e = spawn(k, 'pursuer', 5, 0, '1000');
    run(k, 1, ACTION.SKILL3);
    const w = hazards(k.s, 'hx_wraith')[0];
    expect(w).toBeTruthy();
    run(k, 120);
    expect(dist(w, e)).toBeLessThan(2);
    expect(damaged(e)).toBe(true);
    expect(rot(k.s, e).length).toBeGreaterThan(0);
  });

  it('Banshee (evolution) shrieks and blasts enemies back; Grave Legion raises three', () => {
    const k = kit('hexbinder', ['h_summon_wraith', 'h_grave_strength', 'h_grave_strength', 'h_banshee']);
    const e = spawn(k, 'pursuer', 2, 0, '1000');
    const p = k.s.players[0];
    run(k, 1, ACTION.SKILL3);
    const d0 = dist(e, p);
    run(k, 90);
    expect(casts(k, 'h_banshee_shriek').length).toBeGreaterThanOrEqual(1);
    expect(dist(e, p)).toBeGreaterThan(d0);
    expect(damaged(e)).toBe(true);
    const k2 = kit('hexbinder', ['h_summon_wraith', 'h_grave_strength', 'h_grave_strength', 'h_grave_legion']);
    run(k2, 1, ACTION.SKILL3);
    expect(hazards(k2.s, 'hx_legion')).toHaveLength(3);
  });

  it('Soul Harvest tears out orbiting Souls and cuts cooldowns; Death Knell detonates fading wraiths', () => {
    const k = kit('hexbinder', ['h_summon_wraith', 'h_grave_strength', 'h_grave_strength', 'h_grave_strength', 'h_soul_harvest', 'h_death_knell']);
    const p = k.s.players[0];
    const weak = [3, 3.5].map((d, i) => spawn(k, 'pursuer', d, i * 20, '0.0001'));
    run(k, 1, ACTION.SKILL3);
    p.skills[3].charges = 0; p.skills[3].cooldown = 50;
    run(k, 90, ACTION.ATTACK, 90, aimAt(k, weak[0]));
    expect(weak.every(dead)).toBe(true);
    expect(hazards(k.s, 'hx_soul').length).toBe(2);
    expect(p.skills[3].cooldown).toBeLessThan(50 - 1.5 - 2 * 0.15 + 1e-6);   // 0.15s per kill (rank 1) on top of 1.5s recovery
    run(k, 8 * 60);
    expect(casts(k, 'h_death_knell')).toHaveLength(1);
  });

  it('Legion of the Damned raises a lesser wraith from every kill', () => {
    const k = kit('hexbinder', [...WRAITH8, 'h_legion_of_the_damned']);
    const e = spawn(k, 'pursuer', 3, 0, '0.0001');
    run(k, 60, ACTION.ATTACK, 60, aimAt(k, e));
    expect(dead(e)).toBe(true);
    expect(casts(k, 'h_lesser_wraith').length).toBe(1);
  });
});

describe('hexbinder: determinism', () => {
  function scenario(): string {
    const k = kit('hexbinder', [...PEST8, 'h_rupture', 'h_blood_tether', 'h_summon_wraith', 'h_soul_harvest'], 'HEX_DET');
    const es = [3, 4, 5].map((d, i) => spawn(k, 'pursuer', d, i * 15, i === 0 ? '0.001' : '50'));
    run(k, 1, ACTION.SKILL1, 1, aimAt(k, es[1]));
    run(k, 1, ACTION.SKILL3);
    run(k, 1, ACTION.SKILL2, 1, aimAt(k, es[2]));
    run(k, 1, ACTION.SIGNATURE);
    run(k, 300, ACTION.ATTACK, 300, aimAt(k, es[2]));
    return stateHash(k.s);
  }
  it('the same scripted Hexbinder fight produces the same state hash', () => {
    expect(scenario()).toBe(scenario());
  });
  it('a botted Hexbinder run progresses and is deterministic', () => {
    const a = runBot(newRun(['hexbinder'], 'HEX_BOT'), { maxTicks: 60 * 150 });
    const b = runBot(newRun(['hexbinder'], 'HEX_BOT'), { maxTicks: 60 * 150 });
    expect(a.round).toBeGreaterThan(1);
    expect(stateHash(a)).toBe(stateHash(b));
  });
});
