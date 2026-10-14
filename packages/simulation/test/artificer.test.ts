import { describe, expect, it } from 'vitest';
import { stateHash, step } from '@cursebound/simulation';
import { ACTION, aimAt, arena, casts, damaged, run, spawnAt } from './classkit.helpers';
import { newRun, runBot } from './run.helpers';

const TURRET_T2 = ['af_turret', 'af_calibrated', 'af_calibrated'];
const ORD_T2 = ['af_grenade', 'af_blasting_powder', 'af_blasting_powder'];
const CLOCK_T2 = ['af_overclock', 'af_pressure_valves', 'af_pressure_valves'];

describe('artificer: Repeater', () => {
  it('fires brass bolts that hit', () => {
    const a = arena('artificer', []);
    const e = spawnAt(a, 'guardian', 5, 0, 4);
    run(a, 30, ACTION.ATTACK, 30, aimAt(a, e));
    expect(a.s.projectiles.some((p) => p.kind === 'af_bolt' && p.owner === 'player')).toBe(true);
    run(a, 60, ACTION.ATTACK, 60, aimAt(a, e));
    expect(casts(a, 'af_repeater').length).toBeGreaterThanOrEqual(2);
    expect(damaged(e)).toBe(true);
  });
});

describe('artificer: Turrets', () => {
  it('Deploy Turret places an auto-turret that shoots the nearest enemy', () => {
    const a = arena('artificer', ['af_turret']);
    const p = a.s.players[0];
    const e = spawnAt(a, 'guardian', 6, 0, 6);
    run(a, 2, ACTION.SKILL1, 1, [a.dir[0] * 3, a.dir[1] * 3]);
    const t = a.s.hazards.find((h) => h.kind === 'af_turret');
    expect(t).toBeTruthy();
    expect(Math.hypot(t!.x - p.x, t!.y - p.y)).toBeGreaterThan(2);
    run(a, 120);
    expect(casts(a, 'af_fx_turret_shot').length).toBeGreaterThanOrEqual(3);
    expect(damaged(e)).toBe(true);
    expect(p.vars.ui_turrets).toBe(1);
  });
  it('only two turrets stand at once; the oldest is replaced', () => {
    const a = arena('artificer', ['af_turret']);
    const s = a.s.players[0].skills[0];
    for (let i = 0; i < 3; i++) { s.charges = 1; s.cooldown = 0; a.s.players[0].resource = 100; run(a, 2, ACTION.SKILL1, 1, [a.dir[0] * (1 + i), a.dir[1] * (1 + i)]); }
    expect(a.s.hazards.filter((h) => h.kind === 'af_turret').length).toBe(2);
  });
  it('Flame Turret evolution sprays fire that burns', () => {
    const a = arena('artificer', [...TURRET_T2, 'af_flame_turret']);
    expect(a.s.players[0].skills[0].skillId).toBe('af_flame_turret');
    const e = spawnAt(a, 'guardian', 5, 0, 6);
    run(a, 2, ACTION.SKILL1, 1, [a.dir[0] * 3, a.dir[1] * 3]);
    expect(a.s.hazards.some((h) => h.kind === 'af_flame_turret')).toBe(true);
    run(a, 60);
    expect(casts(a, 'af_fx_flame').length).toBeGreaterThanOrEqual(3);
    expect(e.burning).toBe(true);
  });
  it('Tesla Coil evolution chains lightning between enemies', () => {
    const a = arena('artificer', [...TURRET_T2, 'af_tesla_coil']);
    const es = [spawnAt(a, 'guardian', 5, 0, 4), spawnAt(a, 'guardian', 6.5, 10, 4), spawnAt(a, 'guardian', 6, -12, 4)];
    run(a, 2, ACTION.SKILL1, 1, [a.dir[0] * 3, a.dir[1] * 3]);
    run(a, 60);
    expect(casts(a, 'af_fx_zap').length).toBeGreaterThanOrEqual(3);
    for (const e of es) expect(damaged(e)).toBe(true);
  });
  it('Self-Destruct detonates expiring turrets', () => {
    const a = arena('artificer', ['af_turret', 'af_extended_service', 'af_tinkerer', 'af_tinkerer', 'af_tinkerer', 'af_self_destruct']);
    spawnAt(a, 'guardian', 4, 0, 4);
    run(a, 2, ACTION.SKILL1, 1, [a.dir[0] * 3, a.dir[1] * 3]);
    const t = a.s.hazards.find((h) => h.kind === 'af_turret')!;
    t.untilTick = a.s.tick + 3;
    run(a, 5);
    expect(casts(a, 'af_fx_blast').some((c) => c.dy === 3)).toBe(true);
  });
});

describe('artificer: Ordnance', () => {
  it('Steam Grenade lands, explodes and knocks back', () => {
    const a = arena('artificer', ['af_grenade']);
    const e = spawnAt(a, 'guardian', 4, 0, 4);
    const x0 = e.x, y0 = e.y;
    run(a, 2, ACTION.SKILL2, 1, aimAt(a, e));
    expect(a.s.hazards.some((h) => h.kind === 'af_grenade')).toBe(true);
    run(a, 40);
    expect(casts(a, 'af_fx_blast').length).toBe(1);
    expect(damaged(e)).toBe(true);
    expect(Math.hypot(e.x - x0, e.y - y0)).toBeGreaterThan(0.1);
    expect(a.s.players[0].skills[1].maxCharges).toBe(2);
  });
  it('Cluster Charge scatters bomblets', () => {
    const a = arena('artificer', [...ORD_T2, 'af_cluster_charge']);
    const e = spawnAt(a, 'guardian', 4, 0, 6);
    run(a, 30, ACTION.SKILL2, 1, aimAt(a, e));
    expect(a.s.hazards.filter((h) => h.kind === 'af_bomblet').length + casts(a, 'af_fx_blast').filter((c) => c.dy === 1).length).toBeGreaterThanOrEqual(4);
    run(a, 30);
    expect(casts(a, 'af_fx_blast').filter((c) => c.dy === 1).length).toBe(5);   // the charge + 4 bomblets
  });
  it('Firebomb leaves burning ground', () => {
    const a = arena('artificer', [...ORD_T2, 'af_firebomb']);
    const e = spawnAt(a, 'guardian', 4, 0, 6);
    run(a, 40, ACTION.SKILL2, 1, aimAt(a, e));
    expect(a.s.hazards.some((h) => h.kind === 'af_fire')).toBe(true);
    expect(e.burning).toBe(true);
  });
  it('Proximity Mines arm on empty ground and trigger on approach', () => {
    const a = arena('artificer', [...ORD_T2, 'af_proximity_mines']);
    run(a, 40, ACTION.SKILL2, 1, [a.dir[0] * 4, a.dir[1] * 4]);
    const mine = a.s.hazards.find((h) => h.kind === 'af_mine');
    expect(mine).toBeTruthy();
    const e = spawnAt(a, 'guardian', 4, 0, 4);
    e.x = mine!.x; e.y = mine!.y;
    run(a, 30);
    expect(a.s.hazards.some((h) => h.kind === 'af_mine')).toBe(false);
    expect(damaged(e)).toBe(true);
  });
  it('Carpet Bomber throws three grenades', () => {
    const a = arena('artificer', ['af_grenade', 'af_blasting_powder', 'af_blasting_powder', 'af_blasting_powder', 'af_wide_payload', 'af_wide_payload', 'af_quick_fuse', 'af_quick_fuse', 'af_carpet_bomber']);
    run(a, 2, ACTION.SKILL2, 1);
    expect(a.s.hazards.filter((h) => h.kind === 'af_grenade').length).toBe(3);
    expect(a.s.players[0].skills[1].maxCharges).toBe(3);
  });
});

describe('artificer: Clockwork', () => {
  it('Overclock vents steam and speeds up the repeater', () => {
    const base = arena('artificer', ['af_overclock']);
    const eb = spawnAt(base, 'guardian', 5, 0, 8);
    run(base, 120, ACTION.ATTACK, 120, aimAt(base, eb));
    const plain = casts(base, 'af_repeater').length;

    const a = arena('artificer', ['af_overclock']);
    const near = spawnAt(a, 'guardian', 1.5, 90, 4);
    const e = spawnAt(a, 'guardian', 5, 0, 8);
    run(a, 1, ACTION.SKILL3, 1, aimAt(a, e));
    expect(a.s.players[0].buffs.some((b) => b.id === 'af_overclock')).toBe(true);
    expect(damaged(near)).toBe(true);
    run(a, 120, ACTION.ATTACK, 120, aimAt(a, e));
    expect(casts(a, 'af_repeater').length).toBeGreaterThan(plain * 1.3);
  });
  it('Clockwork Drone orbits and zaps', () => {
    const a = arena('artificer', ['af_overclock', 'af_drone']);
    const e = spawnAt(a, 'guardian', 3, 0, 6);
    run(a, 90);
    expect(a.s.hazards.some((h) => h.kind === 'af_drone')).toBe(true);
    expect(casts(a, 'af_fx_zap').length).toBeGreaterThanOrEqual(1);
    expect(damaged(e)).toBe(true);
  });
  it('Rocket Jump evolution launches the player and blasts on landing', () => {
    const a = arena('artificer', [...CLOCK_T2, 'af_rocket_jump']);
    const p = a.s.players[0];
    expect(p.skills[2].skillId).toBe('af_rocket_jump');
    const x0 = p.x, y0 = p.y;
    run(a, 20, ACTION.SKILL3, 1, [a.dir[0] * 4, a.dir[1] * 4]);
    expect(Math.hypot(p.x - x0, p.y - y0)).toBeGreaterThan(3);
    expect(casts(a, 'af_fx_blast').some((c) => c.dy === 7)).toBe(true);
  });
  it('Boiler Overdrive cloud follows the player and scalds', () => {
    const a = arena('artificer', [...CLOCK_T2, 'af_boiler_overdrive']);
    const e = spawnAt(a, 'guardian', 1.6, 0, 6);
    run(a, 30, ACTION.SKILL3, 1);
    const cloud = a.s.hazards.find((h) => h.kind === 'af_boiler');
    expect(cloud).toBeTruthy();
    expect(Math.hypot(cloud!.x - a.s.players[0].x, cloud!.y - a.s.players[0].y)).toBeLessThan(1e-6);
    expect(damaged(e)).toBe(true);
  });
});

describe('artificer: Mortar Barrage', () => {
  it('calls down eight shells around the aimed point', () => {
    const a = arena('artificer', []);
    const es = [spawnAt(a, 'guardian', 5, 0, 4), spawnAt(a, 'guardian', 6, 15, 4)];
    run(a, 2, ACTION.SIGNATURE, 1, [a.dir[0] * 5, a.dir[1] * 5]);
    expect(a.s.hazards.filter((h) => h.kind === 'af_shell').length).toBe(8);
    run(a, 120);
    expect(casts(a, 'af_fx_blast').filter((c) => c.dy === 2).length).toBe(8);
    for (const e of es) expect(damaged(e)).toBe(true);
  });
});

describe('artificer: determinism', () => {
  function scripted(seed: string) {
    const a = arena('artificer', ['af_turret', 'af_calibrated', 'af_calibrated', 'af_tesla_coil', 'af_grenade', 'af_blasting_powder', 'af_blasting_powder', 'af_cluster_charge', 'af_overclock', 'af_drone'], seed);
    for (let i = 0; i < 6; i++) spawnAt(a, i % 2 ? 'pursuer' : 'guardian', 3 + i * 0.7, i * 45 - 110, 2 + (i % 3), i % 2 === 0);
    const order = [ACTION.ATTACK, ACTION.SKILL1, ACTION.SKILL2, ACTION.SIGNATURE, ACTION.SKILL3, ACTION.ATTACK];
    for (let i = 0; i < 480; i++) {
      const b = order[Math.floor(i / 60) % order.length];
      const ang = i * 0.04;
      const r = step(a.s, [{ seq: a.seq++, moveX: Math.cos(ang) * 0.4, moveY: Math.sin(ang) * 0.4, aimX: Math.cos(ang * 0.6) * 5, aimY: Math.sin(ang * 0.6) * 5, buttons: b | (i % 3 ? ACTION.ATTACK : 0) }]);
      a.events.push(...r.events);
    }
    return a;
  }
  it('same seed and inputs give the same state hash', () => {
    const x = scripted('ART_DET');
    const y = scripted('ART_DET');
    expect(stateHash(x.s)).toBe(stateHash(y.s));
    expect(x.events.length).toBe(y.events.length);
    expect(x.s.players[0].stats.damageDealt.isZero()).toBe(false);
  });
  it('a mixed duelist + artificer botted run is deterministic', () => {
    const x = runBot(newRun(['duelist', 'artificer'], 'MIX_BOT'), { maxTicks: 60 * 90 });
    const y = runBot(newRun(['duelist', 'artificer'], 'MIX_BOT'), { maxTicks: 60 * 90 });
    expect(stateHash(x)).toBe(stateHash(y));
    expect(x.scoreText).toBe(y.scoreText);
  });
});
