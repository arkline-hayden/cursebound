import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { ENEMY_BY_ID, KNOCKBACK_RULES, SKILL_BY_ID } from '@cursebound/content';
import {
  deserializeState, devSpawn, hitEnemy, impactKnock, impactPush, isWall, knockScale, knockback, nearestFloor, seedRng, serializeState,
  setupRound, stateHash, step, stepKnock, type EnemyState, type MapState, type SimState,
} from '@cursebound/simulation';
import { makeElite } from '../src/elites';
import { newRun } from './run.helpers';

// Knockback (rules 1.6, knock.ts): heavy hits, slams, blasts and crits shove ordinary foes as a short slide swept
// against walls and chasm voids; champions and rares are pushed less, bosses never. Deterministic and replay-safe.

const K = KNOCKBACK_RULES;
const B = (v: string | number) => Big.from(v);

/** A combat round with every population foe removed: the hero alone with whatever the test spawns. */
function arena(seed = 'KNOCK_ARENA'): SimState {
  const s = newRun(['vanguard'], seed);
  s.round = 4;
  setupRound(s, []);
  s.phase = 'COMBAT';
  s.enemies = [];
  const enc = s.encounter!;
  enc.groups = [{ id: 99, weight: 1, archetype: 'guardian', wave: 0, spawned: true, defeated: false, countText: '1' }];
  enc.wave = 0; enc.waveCount = 1; enc.objectiveTotal = 1;
  return s;
}

/** A foe that stands still and never attacks, so only the knockback moves it. */
function dummy(s: SimState, kind: string, x: number, y: number): EnemyState {
  const e = devSpawn(s, kind, x, y);
  e.objective = true; e.groupId = 99;
  e.moveSpeed = 0;
  for (const a of ENEMY_BY_ID[e.kind].attacks) e.cooldowns[a.id] = 9999;
  return e;
}

/** An open floor point with free floor `clear` tiles around it, `dx` tiles east of the hero spawn when possible. */
function openSpot(s: SimState, clear = 3): [number, number] {
  const m = s.map!;
  const p = s.players[0];
  let best: [number, number] | null = null; let bd = Infinity;
  for (let ty = clear; ty < m.h - clear; ty++) for (let tx = clear; tx < m.w - clear; tx++) {
    let ok = true;
    for (let y = ty - clear; y <= ty + clear && ok; y++) for (let x = tx - clear; x <= tx + clear && ok; x++) if (isWall(m, x, y)) ok = false;
    if (!ok) continue;
    const d = (tx + 0.5 - p.x) ** 2 + (ty + 0.5 - p.y) ** 2;
    if (d > 9 && d < bd) { bd = d; best = [tx + 0.5, ty + 0.5]; }
  }
  if (!best) throw new Error('no open spot');
  return best;
}

function slide(s: SimState, e: EnemyState, ticks = 40) {
  for (let i = 0; i < ticks; i++) stepKnock(s, e);
}

describe('impact push rule (content KNOCKBACK_RULES)', () => {
  const hp = B(1000);
  it('light basic hits do not push; crits push a modest share of the damage type distance', () => {
    expect(impactPush('v_cleave', 'physical', false, B(100), hp)).toBe(0);
    expect(impactPush('v_cleave', 'physical', true, B(100), hp)).toBeCloseTo(K.byDamageType.physical! * K.critOnlyFactor, 9);
    expect(impactPush('c_ice_shard', 'frost', true, B(100), hp)).toBeCloseTo(K.byDamageType.frost! * K.critOnlyFactor, 9);
    // procs and pets' nips (below critMinCoef or unknown) do not crit-push
    expect(impactPush('w_wolf_bite', 'physical', true, B(100), hp)).toBe(0);
    expect(impactPush('some_proc', 'physical', true, B(100), hp)).toBe(0);
  });

  it('channelled auras never push, so a whirlwind keeps what it holds', () => {
    expect(SKILL_BY_ID.b_whirlwind!.shape.kind).toBe('aura');
    expect(impactPush('b_whirlwind', 'physical', true, B(900), hp)).toBe(0);
    expect(impactPush('c_blizzard', 'frost', true, B(900), hp)).toBe(0);
  });

  it('heavy skills (by coefficient), circle slams and blasts push by damage type; heavy crits push further', () => {
    expect(Number(SKILL_BY_ID.v_executioner!.damageCoef)).toBeGreaterThanOrEqual(K.heavyCoef);
    expect(impactPush('v_executioner', 'physical', false, B(100), hp)).toBeCloseTo(K.byDamageType.physical!, 9);
    expect(impactPush('v_executioner', 'physical', true, B(100), hp)).toBeCloseTo(K.byDamageType.physical! * K.critMult, 9);
    expect(SKILL_BY_ID.w_thornburst!.shape.kind).toBe('circle');
    expect(impactPush('w_thornburst', 'physical', false, B(100), hp)).toBeCloseTo(K.byDamageType.physical!, 9);
    expect(impactPush('c_comet', 'frost', false, B(100), hp)).toBe(K.bySkill.c_comet);
  });

  it('one hit taking half a unit\'s health is heavy whatever the skill', () => {
    expect(impactPush('a_spark', 'ember', false, B(499), hp)).toBe(0);
    expect(impactPush('a_spark', 'ember', false, B(500), hp)).toBeCloseTo(K.byDamageType.ember!, 9);
    expect(impactPush('some_proc', 'storm', false, B(600), hp)).toBeCloseTo(K.byDamageType.storm!, 9);
  });

  it('kits with an authored knockback and controls that hold foes in place never get an impact push', () => {
    expect(SKILL_BY_ID.v_earthbreaker!.knockback).toBeGreaterThan(0);
    expect(impactPush('v_earthbreaker', 'physical', true, B(5000), hp)).toBe(0);
    for (const id of ['r_snare_trap', 'r_bait', 'w_entangle', 'c_absolute_zero']) expect(impactPush(id, SKILL_BY_ID[id]!.damageType, true, B(5000), hp)).toBe(0);
  });

  it('is capped and never negative', () => {
    for (const s of Object.values(SKILL_BY_ID)) for (const crit of [false, true]) {
      const d = impactPush(s.id, s.damageType, crit, B(1e6), hp);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(K.maxPush);
    }
  });
});

describe('knockback slide', () => {
  it('slides an ordinary foe the full distance away from the source, over a few ticks', () => {
    const s = arena();
    const [x, y] = openSpot(s);
    const e = dummy(s, 'pursuer', x, y);
    impactKnock(s, e, x - 1, y, 0.4);
    stepKnock(s, e);
    expect(e.x - x).toBeGreaterThan(0.05);   // moving after one tick, not teleported
    expect(e.x - x).toBeLessThan(0.3);
    slide(s, e);
    expect(e.x - x).toBeGreaterThan(0.37);
    expect(e.x - x).toBeLessThan(0.41);
    expect(Math.abs(e.y - y)).toBeLessThan(1e-3);
    expect(e.knockX).toBe(0); expect(e.knockY).toBe(0);   // spent
  });

  it('champions and rares slide eliteFactor of the distance; bosses are immune', () => {
    const dist = (tier: 0 | 1 | 2) => {
      const s = arena();
      const [x, y] = openSpot(s);
      const e = dummy(s, 'pursuer', x, y);
      if (tier) makeElite(s, [], e, tier, seedRng('knock-elite'), []);
      e.x = x; e.y = y;
      impactKnock(s, e, x, y - 1, 0.5);
      slide(s, e);
      return e.y - y;
    };
    const d0 = dist(0), d1 = dist(1), d2 = dist(2);
    expect(d0).toBeGreaterThan(0.45);
    expect(d1 / d0).toBeCloseTo(K.eliteFactor[1]!, 1);
    expect(d2 / d0).toBeCloseTo(K.eliteFactor[2]!, 1);
    expect(d2).toBeLessThan(d1);

    const s = arena();
    const [x, y] = openSpot(s);
    const boss = dummy(s, 'pursuer', x, y);
    boss.boss = true;
    expect(knockScale(boss)).toBe(0);
    impactKnock(s, boss, x - 1, y, 0.8);
    expect(boss.knockX).toBe(0);
    knockback(s, boss, x - 1, y, 2);
    slide(s, boss);
    expect(boss.x).toBe(x); expect(boss.y).toBe(y);
  });

  it('elites are also pushed less by authored skill knockback', () => {
    const push = (tier: 0 | 1) => {
      const s = arena();
      const [x, y] = openSpot(s);
      const e = dummy(s, 'pursuer', x, y);
      if (tier) makeElite(s, [], e, tier, seedRng('knock-elite'), []);
      e.x = x; e.y = y;
      knockback(s, e, x - 1, y, 1);
      return e.x - x;
    };
    expect(push(1) / push(0)).toBeCloseTo(K.eliteFactor[1]!, 1);
  });

  it('a stronger push replaces a weaker one; an authored knockback cancels the slide (no double shove)', () => {
    const s = arena();
    const [x, y] = openSpot(s);
    const e = dummy(s, 'pursuer', x, y);
    impactKnock(s, e, x - 1, y, 0.5);
    const kx = e.knockX;
    impactKnock(s, e, x, y - 1, 0.2);       // weaker: ignored
    expect(e.knockX).toBe(kx);
    expect(e.knockY).toBe(0);
    knockback(s, e, x - 1, y, 1);           // the skill's own push wins
    expect(e.knockX).toBe(0);
    const after = e.x;
    impactKnock(s, e, x - 1, y, 0.5);       // same tick as an authored knockback: skipped
    slide(s, e);
    expect(e.x).toBe(after);
  });

  it('never pushes a foe into a wall', () => {
    const s = arena('KNOCK_WALLS');
    const m = s.map!;
    let tested = 0;
    // every floor tile next to a wall: shove the foe straight at the wall as hard as anything can
    for (let ty = 1; ty < m.h - 1 && tested < 60; ty++) for (let tx = 1; tx < m.w - 1 && tested < 60; tx++) {
      if (isWall(m, tx, ty)) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (!isWall(m, tx + dx, ty + dy)) continue;
        const e = dummy(s, 'pursuer', tx + 0.5, ty + 0.5);
        impactKnock(s, e, e.x - dx, e.y - dy, K.maxPush);
        slide(s, e);
        knockback(s, e, e.x - dx, e.y - dy, 2);
        const r = Math.min(e.radius, 0.6);
        expect(isWall(m, Math.floor(e.x), Math.floor(e.y))).toBe(false);
        // the body's circle stays clear of every wall tile around it
        for (let y = Math.floor(e.y - r); y <= Math.floor(e.y + r); y++) for (let x = Math.floor(e.x - r); x <= Math.floor(e.x + r); x++) {
          if (!isWall(m, x, y)) continue;
          const cx = Math.max(x, Math.min(e.x, x + 1)), cy = Math.max(y, Math.min(e.y, y + 1));
          expect(Math.hypot(e.x - cx, e.y - cy)).toBeGreaterThan(r - 0.01);
        }
        s.enemies = s.enemies.filter((o) => o !== e);
        tested++;
        break;
      }
    }
    expect(tested).toBeGreaterThan(20);
  });

  it('treats chasm voids as walls: a foe on a ledge is never shoved over it', () => {
    // a 9x5 ledge: floor on the left, a chasm (wall tiles marked as voids) from x = 5
    const w = 9, h = 5;
    const tiles: number[] = [];
    const voids: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || y === h - 1;
      const chasm = x >= 5;
      tiles.push(edge || chasm ? 1 : 0);
      if (chasm && !edge) voids.push(y * w + x);
    }
    const s = arena();
    s.map = { ...(s.map as MapState), w, h, tiles, voids };
    const e = dummy(s, 'pursuer', 4.5, 2.5);
    impactKnock(s, e, 3.5, 2.5, K.maxPush);
    slide(s, e);
    knockback(s, e, 3.5, 2.5, 3);
    expect(e.x).toBeLessThanOrEqual(5 - Math.min(e.radius, 0.6) + 1e-6);
    expect(isWall(s.map, Math.floor(e.x), Math.floor(e.y))).toBe(false);
  });
});

describe('knockback in the simulation', () => {
  /** A scripted fight: the hero crits a foe with a heavy skill hit, then the world steps. */
  function fight(seed: string, checkpointAt = -1): { s: SimState; e: EnemyState; hash: string } {
    let s = arena(seed);
    const p = s.players[0];
    const [fx, fy] = nearestFloor(s.map!, p.x + 1.2, p.y);
    let e = dummy(s, 'guardian', fx, fy);
    e.cohort.unitHp = e.cohort.unitHp.mul(B(50));   // survives the hit
    hitEnemy(s, [], e, B(10), B(1), { dtype: 'physical', srcSlot: 0, skillId: 'v_executioner', fromX: p.x, fromY: p.y, allowCrit: true });
    for (let i = 0; i < 30; i++) {
      if (i === checkpointAt) { s = deserializeState(serializeState(s)); e = s.enemies.find((o) => o.id === e.id)!; }
      step(s, [null]);
    }
    return { s, e, hash: stateHash(s) };
  }

  it('a heavy hit shoves the surviving foe away from the hero', () => {
    const s = arena('KNOCK_SIM');
    const p = s.players[0];
    const [fx, fy] = nearestFloor(s.map!, p.x + 1.2, p.y);
    const e = dummy(s, 'guardian', fx, fy);
    e.cohort.unitHp = e.cohort.unitHp.mul(B(50));
    const d0 = Math.hypot(e.x - p.x, e.y - p.y);
    hitEnemy(s, [], e, B(10), B(1), { dtype: 'physical', srcSlot: 0, skillId: 'v_executioner', fromX: p.x, fromY: p.y, allowCrit: false });
    expect(Math.hypot(e.knockX, e.knockY)).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) step(s, [null]);
    expect(Math.hypot(e.x - p.x, e.y - p.y)).toBeGreaterThan(d0 + 0.2);
  });

  it('is deterministic and survives a checkpoint taken mid-slide', () => {
    const a = fight('KNOCK_DET'), b = fight('KNOCK_DET'), c = fight('KNOCK_DET', 2);
    expect(b.hash).toBe(a.hash);
    expect(c.hash).toBe(a.hash);
    expect([b.e.x, b.e.y]).toEqual([a.e.x, a.e.y]);
  });
});
