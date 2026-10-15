import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import {
  actMul, applyChill, applyFreeze, buildSnapshot, createEnemy, hitEnemy, hitPlayer, isChilled, isFrozen, moveMul, stateHash,
  type EnemyState,
} from '@cursebound/simulation';
import { ACTION, aimAt, arena, casts, damaged, hp, run, spawnAt, type Arena } from './frosthunt.helpers';
import { newRun, runBot } from './run.helpers';

const NOVA = ['c_frost_nova'];
const SHATTER_T2 = ['c_frost_nova', 'c_glacial_focus', 'c_glacial_focus'];
const BLIZZ_T2 = ['c_blizzard', 'c_bitter_cold', 'c_bitter_cold'];
const WALL_T2 = ['c_ice_wall', 'c_hoarfrost', 'c_hoarfrost'];

/** Make an enemy effectively unkillable so multi-hit chains can be observed. */
function tough(e: EnemyState) { e.cohort.unitHp = Big.from(1e7); return e; }
/** Reset charges / cooldown / resource of hotbar slot i. */
function ready(a: Arena, i: number) { const s = a.s.players[0].skills[i]; s.charges = s.maxCharges; s.cooldown = 0; }
function boss(a: Arena, dist: number): EnemyState {
  const p = a.s.players[0];
  const e = createEnemy(a.s, 'prismstag', p.x + a.dir[0] * dist, p.y + a.dir[1] * dist, Big.ONE, { boss: true, objective: false, groupId: -1, summonerId: null });
  a.s.enemies.push(e);
  return e;
}

describe('cryomancer: chill and freeze rules', () => {
  it('Chill slows movement and attack timers; bosses suffer half; strongest chill wins', () => {
    const a = arena('cryomancer', []);
    const e = spawnAt(a, 'pursuer', 5, 0, 1, false);
    applyChill(a.s, e, 0.3, 2);
    applyChill(a.s, e, 0.5, 1);
    expect(isChilled(a.s, e)).toBe(true);
    expect(moveMul(a.s, e)).toBeCloseTo(0.5, 6);
    expect(actMul(a.s, e)).toBeCloseTo(0.5, 6);
    applyChill(a.s, e, 0.95, 1);
    expect(moveMul(a.s, e)).toBeCloseTo(0.3, 6);           // capped at 70% slow
    const b = boss(a, 6);
    applyChill(a.s, b, 0.5, 2);
    expect(moveMul(a.s, b)).toBeCloseTo(0.75, 6);
    run(a, 125);
    expect(isChilled(a.s, e)).toBe(false);
    expect(moveMul(a.s, e)).toBe(1);
  });

  it('a chilled enemy covers about half the ground of an unchilled one', () => {
    const travel = (chill: boolean) => {
      const a = arena('cryomancer', [], 'CHILL_MOVE');
      const e = spawnAt(a, 'pursuer', 7, 0, 1, false);
      const p = a.s.players[0];
      const d0 = Math.hypot(e.x - p.x, e.y - p.y);
      for (let i = 0; i < 40; i++) { if (chill) applyChill(a.s, e, 0.5, 0.5); run(a, 1); }
      return d0 - Math.hypot(e.x - p.x, e.y - p.y);
    };
    const free = travel(false), slowed = travel(true);
    expect(free).toBeGreaterThan(1);
    expect(slowed / free).toBeGreaterThan(0.35);
    expect(slowed / free).toBeLessThan(0.65);
  });

  it('Freeze has diminishing returns (full, half, quarter, then converted to a 70% chill) and recovers', () => {
    const a = arena('cryomancer', []);
    const e = spawnAt(a, 'pursuer', 4, 0, 1, false);
    const ev: never[] = [];
    expect(applyFreeze(a.s, ev, e, 1.2)).toBeCloseTo(1.2, 6);
    expect(isFrozen(a.s, e)).toBe(true);
    expect(applyFreeze(a.s, ev, e, 1.2)).toBeCloseTo(0.6, 6);
    expect(applyFreeze(a.s, ev, e, 1.2)).toBeCloseTo(0.3, 6);
    expect(applyFreeze(a.s, ev, e, 1.2)).toBe(0);
    expect(moveMul(a.s, e)).toBe(0);                         // still frozen from the first application
    run(a, 80);
    expect(isFrozen(a.s, e)).toBe(false);
    expect(moveMul(a.s, e)).toBeCloseTo(0.3, 6);             // the resisted freeze became a deep chill
    run(a, 260);                                             // past the 4s control-resistance window
    expect(applyFreeze(a.s, ev, e, 1.2)).toBeCloseTo(1.2, 6);
  });

  it('frozen enemies cannot act, lose their attack and take x1.15 damage from any player', () => {
    const a = arena('cryomancer', []);
    const e = tough(spawnAt(a, 'pursuer', 1.0, 0, 1, false));
    run(a, 40);
    const ev: never[] = [];
    applyFreeze(a.s, ev, e, 1.5);
    expect(e.attack).toBeNull();
    const x0 = e.x, y0 = e.y;
    run(a, 60);
    expect(Math.hypot(e.x - x0, e.y - y0)).toBeLessThan(0.05);
    expect(e.attack).toBeNull();
    const twin = tough(spawnAt(a, 'pursuer', 6, 90, 1, true));
    const f = tough(spawnAt(a, 'pursuer', 6, -90, 1, true));
    applyFreeze(a.s, ev, f, 2);
    const d = Big.from(100);
    const r1 = hitEnemy(a.s, [], twin, d, Big.ONE, { dtype: 'frost', srcSlot: 0, skillId: 'test', fromX: 0, fromY: 0, allowCrit: false });
    const r2 = hitEnemy(a.s, [], f, d, Big.ONE, { dtype: 'frost', srcSlot: 0, skillId: 'test', fromX: 0, fromY: 0, allowCrit: false });
    expect(r2.dealt.ratio(r1.dealt)).toBeCloseTo(1.15, 6);
  });

  it('bosses resist freeze: it converts to stagger and a half-strength chill', () => {
    const a = arena('cryomancer', []);
    const b = boss(a, 5);
    expect(applyFreeze(a.s, [], b, 2)).toBe(0);
    expect(isFrozen(a.s, b)).toBe(false);
    expect(b.stagger).toBe(120);
    expect(moveMul(a.s, b)).toBeCloseTo(0.75, 6);
  });

  it('snapshot exposes ch / fz flags for the client', () => {
    const a = arena('cryomancer', []);
    const e = spawnAt(a, 'pursuer', 4, 0, 1, false);
    applyFreeze(a.s, [], e, 1);
    applyChill(a.s, e, 0.4, 2);
    const se = buildSnapshot(a.s).enemies.find((x) => x.i === e.id)!;
    expect(se.fz).toBe(1);
    expect(se.ch).toBe(1);
  });
});

describe('cryomancer: Ice Shard and Absolute Zero', () => {
  it('Ice Shard pierces and Chills by 30%', () => {
    const a = arena('cryomancer', []);
    const e1 = tough(spawnAt(a, 'pursuer', 3, 0, 1));
    const e2 = tough(spawnAt(a, 'pursuer', 5, 0, 1));
    run(a, 50, ACTION.ATTACK, 50, aimAt(a, e1));
    expect(a.s.projectiles.some((p) => p.kind === 'cryo_shard') || casts(a, 'c_ice_shard').length > 0).toBe(true);
    expect(damaged(e1)).toBe(true);
    expect(damaged(e2)).toBe(true);                         // passed through the first enemy
    expect(isChilled(a.s, e1)).toBe(true);
    expect(moveMul(a.s, e1)).toBeCloseTo(0.7, 6);
  });

  it('Absolute Zero freezes everything around, shatters the already frozen, staggers bosses and leaves permafrost', () => {
    const a = arena('cryomancer', []);
    const es = [tough(spawnAt(a, 'pursuer', 2, 0)), tough(spawnAt(a, 'pursuer', 3, 120)), tough(spawnAt(a, 'pursuer', 3.5, -120))];
    applyFreeze(a.s, [], es[0], 1);
    a.s.enemies.forEach((e) => { if (e !== es[0]) e.ccResistUntil = 0; });
    const b = boss(a, 3);
    run(a, 2, ACTION.SIGNATURE, 1);
    expect(casts(a, 'c_absolute_zero')).toHaveLength(1);
    expect(casts(a, 'c_shatter')).toHaveLength(1);
    for (const e of es) { expect(damaged(e)).toBe(true); expect(isFrozen(a.s, e)).toBe(true); }
    expect(b.stagger + (b.staggerUntil > a.s.tick ? 1000 : 0)).toBeGreaterThanOrEqual(200);
    expect(a.s.hazards.some((h) => h.kind === 'cryo_permafrost')).toBe(true);
  });
});

describe('cryomancer: Glacier', () => {
  it('Ice Wall stops a charging enemy on its side, chills and damages it', () => {
    const a = arena('cryomancer', ['c_ice_wall']);
    const e = spawnAt(a, 'pursuer', 6, 0, 1, false);
    tough(e);
    run(a, 2, ACTION.SKILL1, 1, aimAt(a, e));
    const w = a.s.hazards.find((h) => h.kind === 'cryo_wall')!;
    expect(w).toBeTruthy();
    const side = (x: number, y: number) => Math.sign((x - w.x) * -w.dy + (y - w.y) * w.dx);
    const p = a.s.players[0];
    const enemySide = side(e.x, e.y);
    expect(enemySide).not.toBe(side(p.x, p.y));
    let crossed = false;
    for (let i = 0; i < 150; i++) { run(a, 1); if (side(e.x, e.y) !== enemySide) crossed = true; }
    expect(crossed).toBe(false);
    expect(damaged(e)).toBe(true);
    expect(isChilled(a.s, e)).toBe(true);
  });

  it('Glacial Bulwark walls destroy enemy projectiles', () => {
    const a = arena('cryomancer', [...WALL_T2, 'c_glacial_bulwark']);
    const p = a.s.players[0];
    run(a, 2, ACTION.SKILL1, 1);
    const w = a.s.hazards.find((h) => h.kind === 'cryo_wall')!;
    const cx = w.x + w.dx * w.length / 2, cy = w.y + w.dy * w.length / 2;
    a.s.projectiles.push({ id: a.s.nextId++, kind: 'shard', owner: 'enemy', ownerId: 0, x: cx + a.dir[0] * 2, y: cy + a.dir[1] * 2, vx: -a.dir[0] * 9, vy: -a.dir[1] * 9,
      radius: 0.15, range: 8, damage: Big.from(50), weight: Big.ONE, dtype: 'physical', pierce: 0, hitIds: [], skillId: 'shard', crit: false, lobTarget: null, bornTick: a.s.tick });
    run(a, 30);
    expect(a.s.projectiles.some((pr) => pr.owner === 'enemy')).toBe(false);
    expect(casts(a, 'c_wall_block').length).toBeGreaterThan(0);
    expect(p.hp.eq(p.maxHp)).toBe(true);
  });

  it('Glacial Prison freezes enemies inside when it forms and keeps them in', () => {
    const a = arena('cryomancer', [...WALL_T2, 'c_glacial_prison']);
    expect(a.s.players[0].skills[0].skillId).toBe('c_glacial_prison');
    const e = tough(spawnAt(a, 'pursuer', 4, 0, 1, false));
    run(a, 2, ACTION.SKILL1, 1, aimAt(a, e));
    const h = a.s.hazards.find((x) => x.kind === 'cryo_prison')!;
    expect(isFrozen(a.s, e)).toBe(true);
    run(a, 150);
    expect(Math.hypot(e.x - h.x, e.y - h.y)).toBeLessThan(h.radius);
  });

  it('Frost Effigy lures enemies, glides the caster back and bursts into a freeze', () => {
    const a = arena('cryomancer', [...WALL_T2, 'c_frost_effigy']);
    const p = a.s.players[0];
    const e = tough(spawnAt(a, 'pursuer', 7, 25, 1, false));
    const x0 = p.x, y0 = p.y;
    run(a, 2, ACTION.SKILL1, 1);
    const eff = a.s.hazards.find((h) => h.kind === 'cryo_effigy')!;
    expect(eff).toBeTruthy();
    run(a, 20);
    expect(p.vars.glT).toBe(0);                              // the 0.25s glide ran (map walls may shorten it)
    expect(Math.hypot(p.x - x0, p.y - y0)).toBeGreaterThan(1);
    expect(e.ccVars?.luU ?? 0).toBeGreaterThan(a.s.tick);
    eff.untilTick = a.s.tick + 2;
    run(a, 3);
    expect(casts(a, 'c_effigy_burst')).toHaveLength(1);
  });

  it('Heart of Winter cheats death once and freezes nearby enemies', () => {
    const a = arena('cryomancer', ['c_ice_wall', 'c_glacial_bulk', 'c_glacial_bulk', 'c_glacial_bulk', 'c_hoarfrost', 'c_hoarfrost', 'c_hoarfrost', 'c_thick_ice', 'c_heart_of_winter']);
    const p = a.s.players[0];
    const e = tough(spawnAt(a, 'pursuer', 2, 0, 1, false));
    p.iframes = 0;
    hitPlayer(a.s, [], p, p.maxHp.mul(Big.from(50)), { attack: 'test', source: 'test', fromX: e.x, fromY: e.y, dtype: 'physical' });
    expect(p.lifeState).toBe('alive');
    expect(p.hp.toString()).toBe('1e0');
    expect(isFrozen(a.s, e)).toBe(true);
    expect(p.iframes).toBeGreaterThanOrEqual(2.5);
    p.iframes = 0; p.shield = Big.ZERO;
    hitPlayer(a.s, [], p, p.maxHp.mul(Big.from(50)), { attack: 'test', source: 'test', fromX: e.x, fromY: e.y, dtype: 'physical' });
    expect(p.lifeState).not.toBe('alive');                  // once per 60s
  });
});

describe('cryomancer: Blizzard', () => {
  it('Blizzard pulses damage and chills enemies inside', () => {
    const a = arena('cryomancer', ['c_blizzard']);
    const e = tough(spawnAt(a, 'pursuer', 4, 0, 1));
    run(a, 2, ACTION.SKILL2, 1, aimAt(a, e));
    expect(a.s.hazards.some((h) => h.kind === 'cryo_storm')).toBe(true);
    const before = hp(e);
    run(a, 120);
    expect(hp(e).lt(before)).toBe(true);
    expect(isChilled(a.s, e)).toBe(true);
  });

  it('Whiteout freezes enemies after 4 pulses', () => {
    const a = arena('cryomancer', [...BLIZZ_T2, 'c_whiteout']);
    expect(a.s.players[0].skills[1].skillId).toBe('c_whiteout');
    const e = tough(spawnAt(a, 'pursuer', 4, 0, 1));
    run(a, 2, ACTION.SKILL2, 1, aimAt(a, e));
    let froze = false;
    for (let i = 0; i < 160; i++) { run(a, 1); if (isFrozen(a.s, e)) froze = true; }
    expect(froze).toBe(true);
  });

  it('Frozen Orb sprays a spiral of shards and bursts at the end of its path', () => {
    const a = arena('cryomancer', [...BLIZZ_T2, 'c_frozen_orb']);
    const e = tough(spawnAt(a, 'pursuer', 3, 0, 1));
    run(a, 2, ACTION.SKILL2, 1, aimAt(a, e));
    expect(a.s.hazards.some((h) => h.kind === 'cryo_orb')).toBe(true);
    let shards = 0;
    for (let i = 0; i < 160; i++) { run(a, 1); shards = Math.max(shards, a.s.projectiles.filter((p) => p.skillId === 'c_orb_shard').length); }
    expect(shards).toBeGreaterThan(3);
    expect(casts(a, 'c_orb_burst')).toHaveLength(1);
    expect(damaged(e)).toBe(true);
  });

  it('Eye of the Storm makes the storm follow the caster; Twin Storms adds a charge', () => {
    const a = arena('cryomancer', [...BLIZZ_T2, 'c_eye_of_the_storm', 'c_winter_tide', 'c_twin_storms']);
    const p = a.s.players[0];
    expect(p.skills[1].maxCharges).toBe(2);
    run(a, 2, ACTION.SKILL2, 1);
    const h = a.s.hazards.find((x) => x.kind === 'cryo_storm')!;
    p.x += 0.5;
    run(a, 2);
    expect(h.x).toBeCloseTo(p.x, 3);
  });
});

describe('cryomancer: Shatter', () => {
  it('Frost Nova freezes, a second cast shatters the frozen', () => {
    const a = arena('cryomancer', NOVA);
    const es = [tough(spawnAt(a, 'pursuer', 2, 0)), tough(spawnAt(a, 'pursuer', 2, 90))];
    run(a, 2, ACTION.SKILL3, 1);
    for (const e of es) expect(isFrozen(a.s, e)).toBe(true);
    ready(a, 2);
    run(a, 2, ACTION.SKILL3, 1);
    expect(casts(a, 'c_shatter')).toHaveLength(2);
  });

  it('Chain Reaction chains through frozen enemies, capped at 3 links', () => {
    const a = arena('cryomancer', [...SHATTER_T2, 'c_chain_reaction']);
    const es = [0, 1, 2, 3, 4].map((i) => tough(spawnAt(a, 'pursuer', 2 + i * 1.7, 0)));
    for (const e of es) { e.ccResistUntil = 0; applyFreeze(a.s, [], e, 3); e.ccResistUntil = 0; }
    run(a, 2, ACTION.SKILL3, 1, aimAt(a, es[0]));
    expect(casts(a, 'c_shatter')).toHaveLength(3);
    expect(isFrozen(a.s, es[3])).toBe(true);
    expect(isFrozen(a.s, es[4])).toBe(true);
  });

  it('Cold Snap freezes every chilled enemy in range and spares the rest', () => {
    const a = arena('cryomancer', [...SHATTER_T2, 'c_cold_snap']);
    const chilled = tough(spawnAt(a, 'pursuer', 7, 0));
    const warm = tough(spawnAt(a, 'pursuer', 7, 90));
    applyChill(a.s, chilled, 0.3, 3);
    run(a, 2, ACTION.SKILL3, 1);
    expect(isFrozen(a.s, chilled)).toBe(true);
    expect(isFrozen(a.s, warm)).toBe(false);
    expect(damaged(chilled)).toBe(true);
    expect(damaged(warm)).toBe(false);
  });

  it('Glacial Spike freezes then detonates and shatters', () => {
    const a = arena('cryomancer', [...SHATTER_T2, 'c_glacial_spike']);
    const e = tough(spawnAt(a, 'pursuer', 5, 0));
    run(a, 2, ACTION.SKILL3, 1, aimAt(a, e));
    expect(isFrozen(a.s, e)).toBe(true);
    run(a, 45);
    expect(casts(a, 'c_spike_burst')).toHaveLength(1);
    expect(casts(a, 'c_shatter')).toHaveLength(1);
  });

  it('Shatterpoint makes hits against frozen enemies critical', () => {
    const nodes = [...SHATTER_T2, 'c_glacial_focus', 'c_razor_ice', 'c_razor_ice', 'c_razor_ice', 'c_deep_freeze', 'c_crystallize', 'c_shatterpoint'];
    const a = arena('cryomancer', nodes);
    const e = tough(spawnAt(a, 'pursuer', 2, 0));
    applyFreeze(a.s, [], e, 3);
    a.events = [];
    run(a, 1, ACTION.SKILL3, 1);
    const hits = a.events.filter((x) => x.t === 'hit' && x.target === e.id) as { crit: boolean }[];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.crit)).toBe(true);
  });
});

describe('cryomancer: on-kill shards and turrets', () => {
  it('Ice Bloom: a chilled enemy killed by an Ice Shard bursts into 5 shards (spawned mid projectile step)', () => {
    const a = arena('cryomancer', [...SHATTER_T2, 'c_razor_ice', 'c_razor_ice', 'c_ice_bloom']);
    const e = spawnAt(a, 'pursuer', 4, 0);
    e.cohort.unitHp = Big.from(10);
    applyChill(a.s, e, 0.3, 10);
    let bloom = 0;
    for (let i = 0; i < 70; i++) { run(a, 1, ACTION.ATTACK, 1, aimAt(a, e)); bloom = Math.max(bloom, a.s.projectiles.filter((p) => p.skillId === 'c_bloom_shard').length); }
    expect(e.cohort.count.isZero()).toBe(true);
    expect(bloom).toBe(5);
  });

  it('Living Glacier walls last twice as long and fire ice shards at nearby enemies', () => {
    const a = arena('cryomancer', ['c_ice_wall', 'c_glacial_bulk', 'c_glacial_bulk', 'c_glacial_bulk', 'c_hoarfrost', 'c_hoarfrost', 'c_hoarfrost', 'c_thick_ice', 'c_living_glacier']);
    const e = tough(spawnAt(a, 'pursuer', 6, 0));
    run(a, 2, ACTION.SKILL1, 1, aimAt(a, e));
    const w = a.s.hazards.find((h) => h.kind === 'cryo_wall')!;
    expect(w.untilTick - w.bornTick).toBe(600);             // (4s + 1s Thick Ice) x2
    let shots = 0;
    for (let i = 0; i < 130; i++) { run(a, 1); shots = Math.max(shots, a.s.projectiles.filter((p) => p.skillId === 'c_glacier_shard').length); }
    expect(shots).toBeGreaterThan(0);
    expect(damaged(e)).toBe(true);
  });
});

describe('cryomancer: determinism', () => {
  it('two identical bot runs produce the same state hash', () => {
    const go = () => { const s = newRun(['cryomancer'], 'CRYO_DET'); runBot(s, { maxTicks: 60 * 60 * 3 }); return s; };
    const a = go(), b = go();
    expect(a.round).toBeGreaterThanOrEqual(1);
    expect(stateHash(a)).toBe(stateHash(b));
  });
  it('co-op with a Ranger stays deterministic', () => {
    const go = () => { const s = newRun(['cryomancer', 'ranger'], 'CRYO_RANGER'); runBot(s, { maxTicks: 60 * 60 * 2 }); return stateHash(s); };
    expect(go()).toBe(go());
  });
});
