import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { SKILL_BY_ID } from '@cursebound/content';
import { addDot, canAllocate, hitPlayer, killEnemy, stateHash, type EnemyState, type SimState } from '@cursebound/simulation';
import { ACTION, aimAt, casts, damaged, dead, dist, hp, kit, run, spawn } from './kits3.helpers';
import { newRun, runBot } from './run.helpers';

const BULWARK8 = ['v_guard_stance', 'v_reinforced', 'v_reinforced', 'v_reinforced', 'v_recovery_pulse', 'v_recovery_pulse', 'v_shield_reach', 'v_shared_shelter'];
const CLEAVER8 = ['v_sweeping_strike', 'v_heavy_edge', 'v_heavy_edge', 'v_heavy_edge', 'v_deep_cut', 'v_deep_cut', 'v_fracture', 'v_follow_through'];
const RALLY8 = ['v_rally_cry', 'v_endurance', 'v_endurance', 'v_endurance', 'v_second_wind', 'v_second_wind', 'v_rescue_pace', 'v_unbroken_rhythm'];
const EMBER8 = ['a_fireline', 'a_kindling', 'a_kindling', 'a_kindling', 'a_heat_sink', 'a_heat_sink', 'a_ash_recovery', 'a_meteor'];
const STORM8 = ['a_arc_bolt', 'a_conductivity', 'a_conductivity', 'a_conductivity', 'a_charged_reserve', 'a_charged_reserve', 'a_static_shell', 'a_fork'];
const RIFT8 = ['a_phase_step', 'a_rift_focus', 'a_rift_focus', 'a_rift_focus', 'a_quickening', 'a_quickening', 'a_temporal_reserve', 'a_return_mark'];
const lost = (e: EnemyState) => e.cohort.unitHp.mul(e.cohort.count.isZero() ? Big.ONE : e.cohort.count).sub(hp(e));
const hazards = (s: SimState, kind: string) => s.hazards.filter((h) => h.kind === kind);

describe('vanguard: Bulwark', () => {
  it('Shield Charge (evolution) dashes 5 units behind the shield, hurling enemies aside', () => {
    const k = kit('vanguard', ['v_guard_stance', 'v_reinforced', 'v_reinforced', 'v_shield_charge']);
    const p = k.s.players[0];
    expect(p.skills[0].skillId).toBe('v_shield_charge');
    const e = spawn(k, 'pursuer', 2.5, 0, '1000');
    const start = { x: p.x, y: p.y };
    const perp0 = Math.abs((e.x - start.x) * k.dir[1] - (e.y - start.y) * k.dir[0]);
    run(k, 1, ACTION.SKILL1);
    expect(p.guardTimer).toBeGreaterThan(1);
    run(k, 24);
    expect(dist(p, start)).toBeGreaterThan(3.5);
    expect(damaged(e)).toBe(true);
    expect(Math.abs((e.x - start.x) * k.dir[1] - (e.y - start.y) * k.dir[0])).toBeGreaterThan(perp0 + 0.5);
  });

  it('Retaliate (evolution) braces, absorbs, then detonates with the absorbed damage', () => {
    const k = kit('vanguard', ['v_guard_stance', 'v_reinforced', 'v_reinforced', 'v_retaliate']);
    const p = k.s.players[0];
    const e = spawn(k, 'pursuer', 2, 0, '1000');
    run(k, 1, ACTION.SKILL1);
    p.iframes = 0;
    expect(hitPlayer(k.s, k.events, p, Big.from(400), { attack: 'test', source: 'test', fromX: e.x, fromY: e.y, dtype: 'physical' }).isZero()).toBe(true);
    expect(p.guardAbsorbed.isZero()).toBe(false);
    const d0 = dist(e, p);
    run(k, 100);
    expect(casts(k, 'v_retaliate_blast')).toHaveLength(1);
    expect(damaged(e)).toBe(true);
    expect(dist(e, p)).toBeGreaterThan(d0 + 0.5);
  });

  it('Unbreakable guards from every direction for 3 seconds; Provoke taunts and exposes', () => {
    const k = kit('vanguard', [...BULWARK8, 'v_provoke', 'v_unbreakable']);
    const p = k.s.players[0];
    const e = spawn(k, 'pursuer', 3, 0, '1000');
    e.targetSlot = null;
    run(k, 1, ACTION.SKILL1);
    expect(p.guardTimer).toBeGreaterThan(2.9);
    expect(e.targetSlot).toBe(0);
    expect(e.vulnUntil).toBeGreaterThan(k.s.tick);
    expect(casts(k, 'v_provoke')).toHaveLength(1);
    p.iframes = 0;
    const behind = { x: p.x - p.aimX * 2, y: p.y - p.aimY * 2 };
    expect(hitPlayer(k.s, k.events, p, Big.from(300), { attack: 'test', source: 'test', fromX: behind.x, fromY: behind.y, dtype: 'physical' }).isZero()).toBe(true);
    expect(p.guardAbsorbed.isZero()).toBe(false);
  });

  it('Iron Maelstrom pulses damage and drags enemies in while guarding', () => {
    const k = kit('vanguard', [...BULWARK8, 'v_iron_maelstrom']);
    const p = k.s.players[0];
    const e = spawn(k, 'pursuer', 2.3, 0, '1000');
    const d0 = dist(e, p);
    run(k, 1, ACTION.SKILL1);
    run(k, 40);
    expect(casts(k, 'v_maelstrom').length).toBeGreaterThanOrEqual(2);
    expect(dist(e, p)).toBeLessThan(d0);
    expect(damaged(e)).toBe(true);
  });
});

describe('vanguard: Cleaver', () => {
  it('Whirlwind (evolution) spins 4 units forward cutting everything along the path', () => {
    const k = kit('vanguard', ['v_sweeping_strike', 'v_heavy_edge', 'v_heavy_edge', 'v_whirlwind']);
    const p = k.s.players[0];
    expect(p.skills[1].skillId).toBe('v_whirlwind');
    const a = spawn(k, 'pursuer', 2, 0, '1000');
    const b = spawn(k, 'pursuer', 4.5, 15, '1000');
    const start = { x: p.x, y: p.y };
    run(k, 1, ACTION.SKILL2);
    run(k, 24);
    expect(dist(p, start)).toBeGreaterThan(3);
    expect(damaged(a) && damaged(b)).toBe(true);
  });

  it("Executioner's Chop executes wounded enemies for x2.5 and refunds Resolve on execution kills", () => {
    const k = kit('vanguard', ['v_sweeping_strike', 'v_heavy_edge', 'v_heavy_edge', 'v_executioner']);
    const full = spawn(k, 'pursuer', 1.6, -15, '100000');
    const low = spawn(k, 'pursuer', 1.6, 15, '100000');
    low.cohort.front = low.cohort.unitHp.mul(Big.from('0.7'));
    const low0 = lost(low);
    run(k, 1, ACTION.SKILL2);
    expect(casts(k, 'v_execute')).toHaveLength(1);
    expect(lost(low).sub(low0).gt(lost(full))).toBe(true);
    const k2 = kit('vanguard', ['v_sweeping_strike', 'v_heavy_edge', 'v_heavy_edge', 'v_executioner']);
    const p2 = k2.s.players[0];
    const victim = spawn(k2, 'pursuer', 1.6, 0, '1');
    victim.cohort.front = victim.cohort.unitHp.mul(Big.from('0.9'));
   
    run(k2, 1, ACTION.SKILL2);
    expect(dead(victim)).toBe(true);
    expect(p2.skills[1].cooldown).toBeLessThan(SKILL_BY_ID['v_executioner'].cooldownSec - 1.5 + 1e-6);   // execution kill: -1.5s
  });

  it('Follow Through really restores the Sweeping Strike charge after an instant kill', () => {
    const k = kit('vanguard', ['v_sweeping_strike', 'v_heavy_edge', 'v_heavy_edge', 'v_follow_through']);
    const p = k.s.players[0];
    const e = spawn(k, 'pursuer', 1.5, 0, '0.0001');
    run(k, 1, ACTION.SKILL2);
    expect(dead(e)).toBe(true);
    expect(p.skills[1].charges).toBe(p.skills[1].maxCharges);
  });

  it('Aftershock erupts 0.5s after Sweeping Strike', () => {
    const k = kit('vanguard', ['v_sweeping_strike', 'v_heavy_edge', 'v_heavy_edge', 'v_heavy_edge', 'v_deep_cut', 'v_aftershock']);
    const e = spawn(k, 'pursuer', 1.5, 0, '1000');
    run(k, 1, ACTION.SKILL2);
    const after1 = lost(e);
    run(k, 35);
    expect(casts(k, 'v_aftershock')).toHaveLength(1);
    expect(lost(e).gt(after1)).toBe(true);
  });

  it("Warlord's Leap vaults Earthbreaker to the aimed point and slams on landing", () => {
    const k = kit('vanguard', [...CLEAVER8, 'v_warlord_leap']);
    const p = k.s.players[0];
    const start = { x: p.x, y: p.y };
    const e = spawn(k, 'pursuer', 5, 0, '1000');
    run(k, 1, ACTION.SIGNATURE, 1, [k.dir[0] * 5, k.dir[1] * 5]);
    expect(casts(k, 'v_leap')).toHaveLength(1);
    expect(damaged(e)).toBe(false);
    run(k, 30);
    expect(dist(p, start)).toBeGreaterThan(4);
    expect(casts(k, 'v_earthbreaker')).toHaveLength(1);
    expect(damaged(e)).toBe(true);
  });

  it('Rampage stacks on kills and speeds up attacks', () => {
    const k = kit('vanguard', [...CLEAVER8, 'v_rampage']);
    const p = k.s.players[0];
    for (let i = 0; i < 3; i++) spawn(k, 'pursuer', 1.3, (i - 1) * 25, '0.0001');
    run(k, 1, ACTION.SKILL2);
    expect(p.vars.vg_rmp).toBe(3);
  });
});

describe('vanguard: Rally', () => {
  it('War Banner (evolution) plants a banner that pulses Rally and damage', () => {
    const k = kit('vanguard', ['v_rally_cry', 'v_endurance', 'v_endurance', 'v_war_banner']);
    const p = k.s.players[0];
    expect(p.skills[2].skillId).toBe('v_war_banner');
    const e = spawn(k, 'pursuer', 3, 0, '1000');
    run(k, 1, ACTION.SKILL3, 1, [k.dir[0] * 2, k.dir[1] * 2]);
    expect(hazards(k.s, 'v_banner')).toHaveLength(1);
    run(k, 70);
    expect(p.buffs.some((b) => b.id === 'rally')).toBe(true);
    expect(damaged(e)).toBe(true);
  });

  it('Thunderous Shout (evolution) blasts enemies back and exposes them', () => {
    const k = kit('vanguard', ['v_rally_cry', 'v_endurance', 'v_endurance', 'v_thunder_shout']);
    const p = k.s.players[0];
    const e = spawn(k, 'pursuer', 2.5, 0, '1000');
    const d0 = dist(e, p);
    run(k, 1, ACTION.SKILL3);
    expect(dist(e, p)).toBeGreaterThan(d0 + 1.2);
    expect(e.vulnFactor).toBe('1.2');
    expect(p.buffs.some((b) => b.id === 'rally')).toBe(true);
  });

  it('Valor heals and restores dodge charges on Rally Cry', () => {
    const k = kit('vanguard', ['v_rally_cry', 'v_endurance', 'v_endurance', 'v_endurance', 'v_second_wind', 'v_valor']);
    const p = k.s.players[0];
    p.hp = p.maxHp.mul(Big.from('0.5'));
    p.dodgeCharges = 0;
    run(k, 1, ACTION.SKILL3);
    expect(p.hp.ratio(p.maxHp)).toBeGreaterThan(0.57);
    expect(p.dodgeCharges).toBeGreaterThanOrEqual(2);
  });

  it('Last Stand turns one lethal hit per round into 1 health, 2s untouchable and a shield', () => {
    const k = kit('vanguard', [...RALLY8, 'v_last_stand']);
    const p = k.s.players[0];
    run(k, 1);
    p.iframes = 0;
    hitPlayer(k.s, k.events, p, Big.from('1e9'), { attack: 'test', source: 'test', fromX: p.x + 1, fromY: p.y, dtype: 'physical' });
    expect(p.lifeState).toBe('alive');
    expect(p.hp.toNumber()).toBeCloseTo(1, 6);
    expect(p.iframes).toBeGreaterThanOrEqual(2);
    expect(p.shield.isZero()).toBe(false);
    p.iframes = 0; p.shield = Big.ZERO;
    hitPlayer(k.s, k.events, p, Big.from('1e9'), { attack: 'test', source: 'test', fromX: p.x + 1, fromY: p.y, dtype: 'physical' });
    expect(p.lifeState).not.toBe('alive');
  });

  it('Warchief radiates Rally permanently', () => {
    const k = kit('vanguard', [...RALLY8, 'v_warchief']);
    run(k, 31);
    expect(k.s.players[0].buffs.some((b) => b.id === 'rally')).toBe(true);
  });
});

describe('arcanist: Ember', () => {
  it('Meteor (evolution) falls 0.7s later, knocks back and leaves a burning crater', () => {
    const k = kit('arcanist', ['a_fireline', 'a_kindling', 'a_kindling', 'a_meteor']);
    expect(k.s.players[0].skills[0].skillId).toBe('a_meteor');
    const e = spawn(k, 'pursuer', 5, 0, '1000');
    run(k, 1, ACTION.SKILL1, 1, aimAt(k, e));
    expect(hazards(k.s, 'a_meteor')).toHaveLength(1);
    run(k, 30);
    expect(damaged(e)).toBe(false);
    run(k, 15);
    expect(damaged(e)).toBe(true);
    expect(e.burning).toBe(true);
    expect(casts(k, 'a_meteor_impact')).toHaveLength(1);
    expect(hazards(k.s, 'a_crater')).toHaveLength(1);
  });

  it('Flame Wall (evolution) burns and shoves enemies back from the wall', () => {
    const k = kit('arcanist', ['a_fireline', 'a_kindling', 'a_kindling', 'a_flame_wall']);
    const p = k.s.players[0];
    const e = spawn(k, 'pursuer', 4.2, 0, '1000');
    const d0 = dist(e, p);
    run(k, 1, ACTION.SKILL1, 1, [k.dir[0] * 4, k.dir[1] * 4]);
    expect(hazards(k.s, 'a_flamewall')).toHaveLength(1);
    run(k, 50);
    expect(damaged(e)).toBe(true);
    expect(e.burning).toBe(true);
    expect(dist(e, p)).toBeGreaterThan(d0 + 0.3);
  });

  it('Combustion: burning enemies explode on death and ignite their neighbours', () => {
    const k = kit('arcanist', ['a_fireline', 'a_kindling', 'a_kindling', 'a_kindling', 'a_heat_sink', 'a_combustion']);
    const victim = spawn(k, 'pursuer', 4, 0, '1000');
    const n = spawn(k, 'pursuer', 5, 10, '1000');
    addDot(k.s, victim, 0, 'ember', Big.from(10), 3);
    killEnemy(k.s, k.events, victim, 0);
    run(k, 15);
    expect(casts(k, 'a_combustion')).toHaveLength(1);
    expect(damaged(n)).toBe(true);
    expect(n.burning).toBe(true);
  });

  it('Pyroclasm makes Astral Nova erupt as fire with 8 sparks; it excludes Singularity', () => {
    const k = kit('arcanist', [...EMBER8, 'a_pyroclasm']);
    const p = k.s.players[0];
    const e = spawn(k, 'pursuer', 2, 0, '1000');
    run(k, 1, ACTION.SIGNATURE);
    expect(casts(k, 'a_pyroclasm')).toHaveLength(1);
    expect(k.s.projectiles.filter((x) => x.kind === 'spark').length).toBeGreaterThanOrEqual(7);
    expect(damaged(e) && e.burning).toBe(true);
    p.skillPoints = 99;
    for (const id of ['a_rift_focus', 'a_singularity']) p.ranks[id] = p.ranks[id] ?? 0;
    p.spentByBranch.rift = 8; p.ranks.a_phase_step = 1; p.ranks.a_return_mark = 1;
    expect(canAllocate(k.s, p, 'a_singularity')).toEqual({ ok: false, code: 'EXCLUSIVE' });
  });

  it('Conflagration: Spark pierces an extra enemy and exposes burning targets', () => {
    const k = kit('arcanist', [...EMBER8, 'a_conflagration']);
    const a = spawn(k, 'pursuer', 2.5, 0, '1000');
    const b = spawn(k, 'pursuer', 4, 0, '1000');
    run(k, 120, ACTION.ATTACK, 120, aimAt(k, b));
    expect(damaged(a) && damaged(b)).toBe(true);
    expect(a.vulnFactor).toBe('1.12');
  });
});

describe('arcanist: Storm', () => {
  it('base Arc Bolt still chains inline', () => {
    const k = kit('arcanist', ['a_arc_bolt']);
    const es = [3, 4.5, 6].map((d) => spawn(k, 'pursuer', d, 0, '1000'));
    run(k, 1, ACTION.SKILL2, 1, aimAt(k, es[0]));
    expect(casts(k, 'a_arc_bolt')).toHaveLength(1);
    expect(es.every(damaged)).toBe(true);
  });

  it('Overload (evolution) chains and overloads the last target in a storm burst', () => {
    const k = kit('arcanist', ['a_arc_bolt', 'a_conductivity', 'a_conductivity', 'a_overload']);
    const es = [3, 4.5, 6, 7.5].map((d, i) => spawn(k, 'pursuer', d, i % 2 ? 6 : -6, '1000'));
    run(k, 1, ACTION.SKILL2, 1, aimAt(k, es[0]));
    expect(es.every(damaged)).toBe(true);
    expect(casts(k, 'a_overload_burst')).toHaveLength(1);
    expect(casts(k, 'a_chain_link').length).toBeGreaterThanOrEqual(3);
  });

  it('Ball Lightning (evolution) drifts forward zapping nearby enemies', () => {
    const k = kit('arcanist', ['a_arc_bolt', 'a_conductivity', 'a_conductivity', 'a_ball_lightning']);
    const a = spawn(k, 'pursuer', 3, 30, '1000');
    const b = spawn(k, 'pursuer', 5, -25, '1000');
    run(k, 1, ACTION.SKILL2);
    expect(hazards(k.s, 'a_ball')).toHaveLength(1);
    run(k, 120);
    expect(casts(k, 'a_ball_zap').length).toBeGreaterThan(4);
    expect(damaged(a) && damaged(b)).toBe(true);
  });

  it('Thunderstrike calls lightning on critical storm hits', () => {
    const k = kit('arcanist', ['a_arc_bolt', 'a_conductivity', 'a_conductivity', 'a_conductivity', 'a_charged_reserve', 'a_thunderstrike']);
    k.s.fate.factors['player.critTendency'] = Big.from('1e12');
    k.s.stateVersion++;
    const e = spawn(k, 'pursuer', 3, 0, '1000');
    run(k, 1, ACTION.SKILL2, 1, aimAt(k, e));
    expect(casts(k, 'a_thunderstrike').length).toBeGreaterThanOrEqual(1);
  });

  it('Stormcaller strikes a random nearby enemy every 1.2s', () => {
    const k = kit('arcanist', [...STORM8, 'a_stormcaller']);
    const e = spawn(k, 'pursuer', 4, 0, '1000');
    run(k, 150);
    expect(casts(k, 'a_stormcaller').length).toBeGreaterThanOrEqual(2);
    expect(damaged(e)).toBe(true);
  });

  it('Elemental Attunement: an ember skill empowers the next storm skill (x1.6, +2 chains)', () => {
    const plain = kit('arcanist', [...STORM8, 'a_stormcaller', 'a_fireline'], 'ATTUNE');
    const att = kit('arcanist', [...STORM8, 'a_attunement', 'a_fireline'], 'ATTUNE');
    const hits: number[] = [];
    for (const k of [plain, att]) {
      const es = [2.5, 3.8, 5.1, 6.4, 7.7, 9, 10.3, 11.6].map((d, i) => spawn(k, 'pursuer', Math.min(d, 11.5), i % 2 ? 4 : -4, '1000'));
      run(k, 1, ACTION.SKILL1, 1, [-k.dir[0] * 2, -k.dir[1] * 2]);   // Fireline away from the pack
      run(k, 1, ACTION.SKILL2, 1, aimAt(k, es[0]));
      hits.push(es.filter(damaged).length);
    }
    expect(casts(att, 'a_attune').length).toBeGreaterThanOrEqual(1);
    expect(hits[1]).toBeGreaterThan(hits[0]);
  });
});

describe('arcanist: Rift', () => {
  it('Blink Strike (evolution) bursts at departure and arrival', () => {
    const k = kit('arcanist', ['a_phase_step', 'a_rift_focus', 'a_rift_focus', 'a_blink_strike']);
    const p = k.s.players[0];
    expect(p.skills[2].skillId).toBe('a_blink_strike');
    const near = spawn(k, 'pursuer', 1.2, 90, '1000');
    const far = spawn(k, 'pursuer', 5.5, 10, '1000');
    const start = { x: p.x, y: p.y };
    run(k, 1, ACTION.SKILL3, 1, [k.dir[0] * 5, k.dir[1] * 5]);
    expect(k.events.some((e) => e.t === 'teleport')).toBe(true);
    expect(dist(p, start)).toBeGreaterThan(3);
    expect(damaged(near) && damaged(far)).toBe(true);
  });

  it('Rift Gate (evolution) links two gates; an ally stepping into one emerges from the other', () => {
    const k = kit('arcanist', ['a_phase_step', 'a_rift_focus', 'a_rift_focus', 'a_rift_gate'], 'GATE', ['vanguard']);
    const [p, ally] = k.s.players;
    const start = { x: p.x, y: p.y };
    run(k, 1, ACTION.SKILL3, 1, [k.dir[0] * 6, k.dir[1] * 6]);
    const gates = hazards(k.s, 'a_gate');
    expect(gates).toHaveLength(2);
    expect(dist(p, start)).toBeGreaterThan(5);
    run(k, 2);
    expect(dist(ally, gates[1])).toBeLessThan(1.5);
  });

  it('Astral Echo detonates where you vanished; Riftwalker adds charges and a shard ring', () => {
    const k = kit('arcanist', ['a_phase_step', 'a_rift_focus', 'a_rift_focus', 'a_rift_focus', 'a_quickening', 'a_astral_echo']);
    const e = spawn(k, 'pursuer', 1.2, 180, '1000');
    run(k, 1, ACTION.SKILL3, 1, [k.dir[0] * 4, k.dir[1] * 4]);
    run(k, 50);
    expect(casts(k, 'a_echo_burst')).toHaveLength(1);
    expect(damaged(e)).toBe(true);
    const k2 = kit('arcanist', [...RIFT8, 'a_riftwalker']);
    expect(k2.s.players[0].skills[2].maxCharges).toBe(4);
    run(k2, 1, ACTION.SKILL3, 1, [k2.dir[0] * 4, k2.dir[1] * 4]);
    expect(k2.s.projectiles.filter((x) => x.kind === 'a_shard')).toHaveLength(6);
  });

  it('Singularity replaces Astral Nova: a black hole that drags enemies in and collapses', () => {
    const k = kit('arcanist', [...RIFT8, 'a_singularity']);
    const p = k.s.players[0];
    const cx = p.x + k.dir[0] * 5, cy = p.y + k.dir[1] * 5;
    const e = spawn(k, 'pursuer', 5, 25, '1000');
    const d0 = dist(e, { x: cx, y: cy });
    run(k, 1, ACTION.SIGNATURE, 1, [k.dir[0] * 5, k.dir[1] * 5]);
    expect(hazards(k.s, 'a_singularity')).toHaveLength(1);
    run(k, 95);
    expect(dist(e, { x: cx, y: cy })).toBeLessThan(d0);
    expect(casts(k, 'a_singularity_collapse')).toHaveLength(1);
    expect(damaged(e)).toBe(true);
  });
});

describe('vanguard + arcanist + hexbinder: determinism', () => {
  function scripted(): string {
    const k = kit('vanguard', [...CLEAVER8, 'v_warlord_leap', 'v_rally_cry'], 'VA_DET', ['arcanist']);
    const es = [2, 3.5, 5].map((d, i) => spawn(k, 'pursuer', d, i * 20, i === 0 ? '0.01' : '30'));
    run(k, 1, ACTION.SKILL2, 1, aimAt(k, es[0]));
    run(k, 1, ACTION.SIGNATURE, 1, aimAt(k, es[2]));
    run(k, 240, ACTION.ATTACK, 240, aimAt(k, es[1]));
    return stateHash(k.s);
  }
  it('a scripted Vanguard fight reproduces the same state hash', () => {
    expect(scripted()).toBe(scripted());
  });
  it('a botted Vanguard + Arcanist + Hexbinder co-op run progresses and is deterministic', () => {
    const a = runBot(newRun(['vanguard', 'arcanist', 'hexbinder'], 'TRIO'), { maxTicks: 60 * 240 });
    const b = runBot(newRun(['vanguard', 'arcanist', 'hexbinder'], 'TRIO'), { maxTicks: 60 * 240 });
    expect(a.round).toBeGreaterThan(1);
    expect(stateHash(a)).toBe(stateHash(b));
  });
});
