import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { buildSnapshot, stateHash, step, type Projectile } from '@cursebound/simulation';
import { ACTION, aimAt, arena, casts, damaged, hp, run, spawnAt } from './classkit.helpers';
import { newRun, runBot } from './run.helpers';

const EDGE_T3 = ['d_rend', 'd_keen_edge', 'd_keen_edge', 'd_keen_edge', 'd_serrated'];
const SHADOW_T3 = ['d_shadowstep', 'd_fleet', 'd_fleet', 'd_fleet', 'd_umbral_edge'];
const TEMPO_T3 = ['d_riposte', 'd_flow', 'd_flow', 'd_flow', 'd_momentum_well'];

describe('duelist: basic attack', () => {
  it('Twin Fangs flurry hits, builds Momentum and Combo, and lands a Fang Finisher every 4th swing', () => {
    const a = arena('duelist', []);
    const p = a.s.players[0];
    const e = spawnAt(a, 'guardian', 1.2, 0, 6);
    p.resource = 0;
    run(a, 75, ACTION.ATTACK, 75, aimAt(a, e));
    expect(damaged(e)).toBe(true);
    const swings = casts(a, 'd_twin_fangs').length + casts(a, 'd_fang_finisher').length;
    expect(swings).toBeGreaterThanOrEqual(3);            // 3.2 attacks per second
    expect(casts(a, 'd_fang_finisher').length).toBeGreaterThanOrEqual(1);
    expect(p.resource).toBeGreaterThan(7 * 1.25 + 4);      // regen alone gives ~8.75; hits add 2-4 per swing
    expect(p.vars.ui_combo).toBeGreaterThanOrEqual(3);
    expect(buildSnapshot(a.s).players[0].kv?.combo).toBe(p.vars.ui_combo);
  });
});

describe('duelist: Edge', () => {
  it('Rend X-slashes a cone and applies a bleed', () => {
    const a = arena('duelist', ['d_rend']);
    const e = spawnAt(a, 'guardian', 1.5, 0, 4);
    run(a, 2, ACTION.SKILL1, 1, aimAt(a, e));
    expect(casts(a, 'd_rend')).toHaveLength(1);
    expect(damaged(e)).toBe(true);
    expect(e.dots.some((d) => d.src === 0 && d.type === 'physical')).toBe(true);
  });
  it('Exsanguinate consumes the bleed for instant damage', () => {
    const a = arena('duelist', ['d_rend', 'd_keen_edge', 'd_keen_edge', 'd_exsanguinate']);
    const e = spawnAt(a, 'guardian', 1.5, 0, 6);
    run(a, 10, ACTION.SKILL1, 1, aimAt(a, e));
    const s1 = a.s.players[0].skills[0];
    s1.charges = s1.maxCharges; s1.cooldown = 0;
    run(a, 2, ACTION.SKILL1, 1, aimAt(a, e));
    expect(casts(a, 'd_fx_exsang').length).toBe(1);
    expect(e.dots.some((d) => d.src === 0 && d.type === 'physical')).toBe(true);   // the fresh bleed
  });
  it('choice nodes are exclusive', () => {
    const a = arena('duelist', ['d_rend', 'd_keen_edge', 'd_keen_edge', 'd_exsanguinate']);
    a.s.phase = 'SKILL_ALLOCATION';
    const r = step(a.s, [], [{ type: 'ALLOCATE', slot: 0, nodeId: 'd_open_veins' }]);
    expect(r.outcomes[0]).toMatchObject({ ok: false, code: 'EXCLUSIVE' });
  });
  it('Crimson Whirl evolution replaces Rend and spins three times', () => {
    const a = arena('duelist', [...EDGE_T3, 'd_crimson_whirl']);
    expect(a.s.players[0].skills[0].skillId).toBe('d_crimson_whirl');
    const e1 = spawnAt(a, 'guardian', 1.5, 0, 4);
    const e2 = spawnAt(a, 'guardian', 1.5, 180, 4);
    run(a, 40, ACTION.SKILL1, 1);
    expect(casts(a, 'd_fx_whirl')).toHaveLength(3);
    expect(damaged(e1) && damaged(e2)).toBe(true);
  });
  it('Execution lunges and runs the target through', () => {
    const a = arena('duelist', [...EDGE_T3, 'd_execution']);
    const p = a.s.players[0];
    const e = spawnAt(a, 'guardian', 3, 0, 4);
    const x0 = p.x, y0 = p.y;
    const before = hp(e);
    run(a, 2, ACTION.SKILL1, 1, aimAt(a, e));
    expect(Math.hypot(p.x - x0, p.y - y0)).toBeGreaterThan(1.5);
    expect(hp(e).lt(before)).toBe(true);
  });
  it('Thousand Wounds: every hit bleeds', () => {
    const a = arena('duelist', ['d_rend', 'd_keen_edge', 'd_keen_edge', 'd_keen_edge', 'd_serrated', 'd_serrated', 'd_serrated', 'd_honed_rend', 'd_thousand_wounds']);
    const e = spawnAt(a, 'guardian', 1.2, 0, 6);
    run(a, 20, ACTION.ATTACK, 20, aimAt(a, e));
    expect(e.dots.some((d) => d.src === 0 && d.type === 'physical')).toBe(true);
  });
});

describe('duelist: Shadow', () => {
  it('Shadowstep blinks behind the target and strikes it', () => {
    const a = arena('duelist', ['d_shadowstep']);
    const p = a.s.players[0];
    const e = spawnAt(a, 'guardian', 4, 0, 4);
    const x0 = p.x, y0 = p.y;
    run(a, 2, ACTION.SKILL2, 1, aimAt(a, e));
    const along = (p.x - x0) * a.dir[0] + (p.y - y0) * a.dir[1];
    expect(along).toBeGreaterThan(4);                        // landed past the target
    expect(damaged(e)).toBe(true);
    const ev = casts(a, 'd_shadowstep')[0];
    expect(Math.hypot(ev.dx - ev.x, ev.dy - ev.y)).toBeGreaterThan(4);   // departure -> arrival
  });
  it('Phantom Rush chains blinks through several enemies', () => {
    const a = arena('duelist', [...SHADOW_T3, 'd_phantom_rush']);
    expect(a.s.players[0].skills[1].skillId).toBe('d_phantom_rush');
    const es = [spawnAt(a, 'guardian', 2.5, -30, 3), spawnAt(a, 'guardian', 4, 0, 3), spawnAt(a, 'guardian', 2.5, 30, 3)];
    run(a, 40, ACTION.SKILL2, 1);
    expect(casts(a, 'd_fx_blink').length).toBeGreaterThanOrEqual(3);
    for (const e of es) expect(damaged(e)).toBe(true);
  });
  it('Death Mark detonates for a share of the damage dealt while marked', () => {
    const a = arena('duelist', [...SHADOW_T3, 'd_death_mark']);
    const e = spawnAt(a, 'guardian', 3, 0, 8);
    run(a, 2, ACTION.SKILL2, 1, aimAt(a, e));
    expect(a.s.hazards.some((h) => h.kind === 'd_mark' && h.inner === e.id)).toBe(true);
    run(a, 60, ACTION.ATTACK, 60, aimAt(a, e));
    const mark = a.s.hazards.find((h) => h.kind === 'd_mark');
    expect(mark && !mark.damage.isZero()).toBe(true);
    run(a, 120);
    expect(casts(a, 'd_fx_mark_burst')).toHaveLength(1);
  });
  it('Shadow Clone mirrors basic attacks; Reaper\'s Path is free but costs health', () => {
    const a = arena('duelist', ['d_shadowstep', 'd_fleet', 'd_fleet', 'd_fleet', 'd_twin_shadows', 'd_umbral_edge', 'd_umbral_edge', 'd_umbral_edge', 'd_shadow_clone', 'd_reapers_path']);
    const p = a.s.players[0];
    const e = spawnAt(a, 'guardian', 3, 0, 6);
    const res0 = p.resource, hp0 = p.hp;
    run(a, 2, ACTION.SKILL2, 1, aimAt(a, e));
    expect(p.resource).toBeGreaterThanOrEqual(res0 - 1e-9);
    expect(p.hp.lt(hp0)).toBe(true);
    expect(a.s.hazards.some((h) => h.kind === 'd_clone')).toBe(true);
    run(a, 30, ACTION.ATTACK, 30, aimAt(a, e));
    expect(casts(a, 'd_clone_slash').length).toBeGreaterThan(0);
  });
  it('Phantom Dash slashes along the dodge path', () => {
    const a = arena('duelist', ['d_shadowstep', 'd_fleet', 'd_fleet', 'd_phantom_dash']);
    const e = spawnAt(a, 'guardian', 1.2, 0, 4);
    for (let i = 0; i < 3; i++) {
      const r = step(a.s, [{ seq: a.seq++, moveX: a.dir[0], moveY: a.dir[1], aimX: a.dir[0], aimY: a.dir[1], buttons: i === 0 ? ACTION.DODGE : 0 }]);
      a.events.push(...r.events);
    }
    expect(casts(a, 'd_fx_phantom')).toHaveLength(1);
    expect(damaged(e)).toBe(true);
  });
});

describe('duelist: Tempo', () => {
  it('Riposte parries a melee windup: counter, stun, Momentum and Combo', () => {
    const a = arena('duelist', ['d_riposte']);
    const p = a.s.players[0];
    const e = spawnAt(a, 'pursuer', 1.0, 0, 4, false);
    e.cohort.unitHp = Big.from(600);   // sturdy test foe, independent of enemy tuning
    e.attack = { attackId: 'bite', stage: 'windup', timer: 0.2, ox: e.x, oy: e.y, dx: -a.dir[0], dy: -a.dir[1], tx: p.x, ty: p.y, hitSlots: [], telegraphId: 0 };
    e.state = 'windup';
    p.resource = 40;
    run(a, 2, ACTION.SKILL3, 1, aimAt(a, e));
    expect(casts(a, 'd_fx_parry')).toHaveLength(1);
    expect(damaged(e)).toBe(true);
    expect(e.staggerUntil).toBeGreaterThan(a.s.tick);
    expect(e.attack).toBeNull();
    expect(p.resource).toBeGreaterThan(40 - 15 + 19);
    expect(p.vars.ui_combo).toBeGreaterThanOrEqual(3);
  });
  it('Riposte reflects an incoming projectile', () => {
    const a = arena('duelist', ['d_riposte']);
    const p = a.s.players[0];
    const shooter = spawnAt(a, 'skirmisher', 6, 0, 1);
    const pr: Projectile = {
      id: a.s.nextId++, kind: 'shard', owner: 'enemy', ownerId: shooter.id, x: p.x + a.dir[0] * 1.0, y: p.y + a.dir[1] * 1.0,
      vx: -a.dir[0] * 9, vy: -a.dir[1] * 9, radius: 0.15, range: 6, damage: Big.from(50), weight: Big.ONE, dtype: 'physical',
      pierce: 0, hitIds: [], skillId: 'shard', crit: false, lobTarget: null, bornTick: a.s.tick,
    };
    a.s.projectiles.push(pr);
    run(a, 1, ACTION.SKILL3, 1);
    expect(pr.owner).toBe('player');
    expect(pr.kind).toBe('d_reflect');
    run(a, 40);
    expect(damaged(shooter)).toBe(true);
  });
  it('an unused Riposte ends in a thrust', () => {
    const a = arena('duelist', ['d_riposte']);
    const e = spawnAt(a, 'guardian', 1.5, 0, 4);
    run(a, 40, ACTION.SKILL3, 1, aimAt(a, e));
    expect(casts(a, 'd_fx_thrust')).toHaveLength(1);
    expect(damaged(e)).toBe(true);
  });
  it('Hundred Fangs spends Combo on a flurry of slashes', () => {
    const a = arena('duelist', [...TEMPO_T3, 'd_hundred_fangs']);
    const p = a.s.players[0];
    expect(p.skills[2].skillId).toBe('d_hundred_fangs');
    const e = spawnAt(a, 'guardian', 1.5, 0, 8);
    p.vars.combo = 10; p.vars.ui_combo = 10; p.vars.comboT = a.s.tick;
    run(a, 90, ACTION.SKILL3, 1, aimAt(a, e));
    expect(casts(a, 'd_fx_fang_slash')).toHaveLength(11);   // 6 + 10/2
    expect(damaged(e)).toBe(true);
  });
  it('Mirror Guard reflects several projectiles in one stance', () => {
    const a = arena('duelist', [...TEMPO_T3, 'd_mirror_guard']);
    const p = a.s.players[0];
    const shooter = spawnAt(a, 'skirmisher', 6, 0, 1);
    const mk = (deg: number): Projectile => {
      const r = (deg * Math.PI) / 180;
      const dx = a.dir[0] * Math.cos(r) - a.dir[1] * Math.sin(r), dy = a.dir[0] * Math.sin(r) + a.dir[1] * Math.cos(r);
      return { id: a.s.nextId++, kind: 'shard', owner: 'enemy', ownerId: shooter.id, x: p.x + dx * 1.2, y: p.y + dy * 1.2, vx: -dx * 6, vy: -dy * 6,
        radius: 0.15, range: 6, damage: Big.from(50), weight: Big.ONE, dtype: 'physical', pierce: 0, hitIds: [], skillId: 'shard', crit: false, lobTarget: null, bornTick: a.s.tick };
    };
    const prs = [mk(0), mk(90), mk(-90)];
    a.s.projectiles.push(...prs);
    run(a, 1, ACTION.SKILL3, 1);
    for (const pr of prs) expect(pr.owner).toBe('player');
  });
});

describe('duelist: Thousand Cuts', () => {
  it('blinks through every nearby enemy and ends in a burst', () => {
    const a = arena('duelist', []);
    const p = a.s.players[0];
    const es = [spawnAt(a, 'guardian', 2, 0, 3), spawnAt(a, 'guardian', 3.5, 40, 3), spawnAt(a, 'guardian', 3, -40, 3)];
    run(a, 45, ACTION.SIGNATURE, 1);
    expect(casts(a, 'd_thousand_cuts')).toHaveLength(1);
    expect(casts(a, 'd_fx_blink')).toHaveLength(5);
    expect(casts(a, 'd_fx_cuts_burst')).toHaveLength(1);
    for (const e of es) expect(damaged(e)).toBe(true);
    expect(p.skills[3].charges).toBe(0);
  });
});

describe('duelist: determinism', () => {
  function scripted(seed: string) {
    const a = arena('duelist', ['d_rend', 'd_keen_edge', 'd_keen_edge', 'd_open_veins', 'd_shadowstep', 'd_riposte'], seed);
    for (let i = 0; i < 6; i++) spawnAt(a, i % 2 ? 'pursuer' : 'guardian', 2 + i * 0.6, i * 50 - 120, 2 + (i % 3), i % 2 === 0);
    const order = [ACTION.ATTACK, ACTION.SKILL1, ACTION.ATTACK, ACTION.SKILL2, ACTION.SIGNATURE, ACTION.SKILL3, ACTION.ATTACK];
    for (let i = 0; i < 420; i++) {
      const b = order[Math.floor(i / 60) % order.length];
      const ang = i * 0.05;
      const r = step(a.s, [{ seq: a.seq++, moveX: Math.cos(ang) * 0.5, moveY: Math.sin(ang) * 0.5, aimX: Math.cos(ang * 0.7) * 3, aimY: Math.sin(ang * 0.7) * 3, buttons: b | (i % 2 ? ACTION.ATTACK : 0) }]);
      a.events.push(...r.events);
    }
    return a;
  }
  it('same seed and inputs give the same state hash', () => {
    const x = scripted('DUEL_DET');
    const y = scripted('DUEL_DET');
    expect(stateHash(x.s)).toBe(stateHash(y.s));
    expect(x.events.length).toBe(y.events.length);
    expect(x.s.players[0].stats.damageDealt.isZero()).toBe(false);
  });
  it('a botted duelist run is deterministic', () => {
    const x = runBot(newRun(['duelist'], 'DUEL_BOT'), { maxTicks: 60 * 75 });
    const y = runBot(newRun(['duelist'], 'DUEL_BOT'), { maxTicks: 60 * 75 });
    expect(stateHash(x)).toBe(stateHash(y));
    expect(x.round).toBeGreaterThanOrEqual(1);
  });
});
