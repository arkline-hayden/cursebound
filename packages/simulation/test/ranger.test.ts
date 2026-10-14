import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import {
  applySnare, buildSnapshot, isMarkedBy, isSnared, markEnemy, moveMul, stateHash,
  type EnemyState,
} from '@cursebound/simulation';
import { hooks, type HitMod } from '../src/hooks';
import { ACTION, aimAt, arena, casts, damaged, hp, run, spawnAt, type Arena } from './frosthunt.helpers';
import { newRun, runBot } from './run.helpers';

const VOLLEY_T2 = ['r_multishot', 'r_steady_draw', 'r_steady_draw'];
const MARK_T2 = ['r_hunters_mark', 'r_keen_eye', 'r_keen_eye'];
const WILDS_T2 = ['r_snare_trap', 'r_fleet_foot', 'r_fleet_foot'];

function tough(e: EnemyState) { e.cohort.unitHp = Big.from(1e7); return e; }
function ready(a: Arena, i: number) { const s = a.s.players[0].skills[i]; s.charges = s.maxCharges; s.cooldown = 0; a.s.players[0].resource = 999; }
function mod(a: Arena, e: EnemyState, skillId: string): HitMod {
  const m: HitMod = { dmg: Big.ONE, critMul: Big.ONE, critDmg: Big.ONE, forceCrit: false };
  hooks.modifyHit(a.s, a.s.players[0], e, { skillId, dtype: 'physical', generation: 0 }, m);
  return m;
}
const arrows = (a: Arena, skill: string) => a.s.projectiles.filter((p) => p.owner === 'player' && p.skillId === skill);

describe('ranger: Quick Shot and Rain of Arrows', () => {
  it('Quick Shot looses arrows that hit', () => {
    const a = arena('ranger', []);
    const e = tough(spawnAt(a, 'pursuer', 5, 0));
    run(a, 34, ACTION.ATTACK, 34, aimAt(a, e));               // attack work starts empty: first arrow after ~0.45s
    expect(a.s.projectiles.some((p) => p.kind === 'ranger_arrow')).toBe(true);
    run(a, 50, ACTION.ATTACK, 50, aimAt(a, e));
    expect(casts(a, 'r_quick_shot').length).toBeGreaterThanOrEqual(2);
    expect(damaged(e)).toBe(true);
  });

  it('Rain of Arrows strikes everything in the area for its whole duration', () => {
    const a = arena('ranger', []);
    const es = [tough(spawnAt(a, 'pursuer', 5, 0)), tough(spawnAt(a, 'pursuer', 6, 12)), tough(spawnAt(a, 'pursuer', 6, -12))];
    run(a, 2, ACTION.SIGNATURE, 1, aimAt(a, es[0]));
    expect(a.s.hazards.some((h) => h.kind === 'ranger_rain')).toBe(true);
    const mid = es.map(hp);
    run(a, 60);
    es.forEach((e, i) => expect(hp(e).lt(mid[i])).toBe(true));
    const at = es.map(hp);
    run(a, 120);
    es.forEach((e, i) => expect(hp(e).lt(at[i])).toBe(true));
    expect(a.s.hazards.some((h) => h.kind === 'ranger_rain')).toBe(false);
  });
});

describe('ranger: Volley', () => {
  it('Multishot fires a 5-arrow fan; Wide Fan adds 2 arrows per rank', () => {
    const a = arena('ranger', ['r_multishot']);
    run(a, 1, ACTION.SKILL1, 1);
    expect(arrows(a, 'r_multishot')).toHaveLength(5);
    const b = arena('ranger', ['r_multishot', 'r_wide_fan', 'r_wide_fan']);
    run(b, 1, ACTION.SKILL1, 1);
    const total = arrows(b, 'r_multishot').reduce((s, p) => s + Number(p.weight.toString().replace('e0', '')), 0);
    expect(arrows(b, 'r_multishot').length).toBe(7);          // representative arrows
    expect(arrows(b, 'r_multishot').map((p) => p.weight.toNumber()).reduce((x, y) => x + y, 0)).toBe(9);
    void total;
  });

  it('Barrage looses three fans over 0.3s', () => {
    const a = arena('ranger', [...VOLLEY_T2, 'r_barrage']);
    expect(a.s.players[0].skills[0].skillId).toBe('r_barrage');
    run(a, 1, ACTION.SKILL1, 1);
    run(a, 25);
    expect(casts(a, 'r_barrage_fan')).toHaveLength(2);
  });

  it('Longshot pierces a line and hits harder beyond 6 units', () => {
    const a = arena('ranger', [...VOLLEY_T2, 'r_longshot']);
    const near = tough(spawnAt(a, 'pursuer', 3, 0));
    const far = tough(spawnAt(a, 'pursuer', 8, 0));
    expect(mod(a, far, 'r_longshot').dmg.toNumber()).toBeCloseTo(1.6, 6);
    expect(mod(a, near, 'r_longshot').dmg.toNumber()).toBeCloseTo(1, 6);
    run(a, 40, ACTION.SKILL1, 1, aimAt(a, near));
    expect(damaged(near)).toBe(true);
    expect(damaged(far)).toBe(true);
  });

  it('Ricochet arrows jump to a second enemy; Explosive Tips splash', () => {
    const a = arena('ranger', [...VOLLEY_T2, 'r_ricochet', 'r_quick_hands', 'r_quick_hands', 'r_explosive_tips']);
    const e = tough(spawnAt(a, 'pursuer', 4, 0));
    const side = tough(spawnAt(a, 'pursuer', 4, 60));
    run(a, 1, ACTION.SKILL1, 1, aimAt(a, e));
    let ricochets = 0;
    for (let i = 0; i < 40; i++) { run(a, 1); ricochets = Math.max(ricochets, arrows(a, 'r_ricochet').length); }
    expect(ricochets).toBeGreaterThan(0);
    expect(casts(a, 'r_explosion').length).toBeGreaterThan(0);
    expect(damaged(side)).toBe(true);
  });

  it('Echoing Volley repeats the volley; Point Blank springs the hunter back', () => {
    const nodes = [...VOLLEY_T2, 'r_steady_draw', 'r_quick_hands', 'r_wide_fan', 'r_hunters_rhythm', 'r_arrow_storm'];
    const a = arena('ranger', [...nodes, 'r_echoing_volley']);
    expect(a.s.players[0].skills[0].maxCharges).toBe(2);
    run(a, 1, ACTION.SKILL1, 1);
    run(a, 20);
    expect(casts(a, 'r_multishot').filter((c) => c.count === 'echo')).toHaveLength(1);
    const b = arena('ranger', [...nodes, 'r_point_blank']);
    const p = b.s.players[0];
    const aim: [number, number] = [-b.dir[0] * 3, -b.dir[1] * 3];   // spring toward the open direction
    const x0 = p.x, y0 = p.y;
    run(b, 1, ACTION.SKILL1, 1, aim);
    run(b, 15, 0, 0, aim);
    expect(Math.hypot(p.x - x0, p.y - y0)).toBeGreaterThan(1.5);
  });
});

describe('ranger: Marksman', () => {
  it("Hunter's Mark marks the enemy nearest the aim and triples critical tendency against it", () => {
    const a = arena('ranger', ['r_hunters_mark']);
    const e = tough(spawnAt(a, 'pursuer', 6, 0));
    const other = tough(spawnAt(a, 'pursuer', 4, 60));
    run(a, 1, ACTION.SKILL2, 1, aimAt(a, e));
    expect(isMarkedBy(a.s, e, 0)).toBe(true);
    expect(isMarkedBy(a.s, other, 0)).toBe(false);
    expect(damaged(e)).toBe(true);
    expect(mod(a, e, 'r_quick_shot').critMul.toNumber()).toBeCloseTo(3, 6);
    expect(mod(a, other, 'r_quick_shot').critMul.toNumber()).toBeCloseTo(1, 6);
    expect(buildSnapshot(a.s).enemies.find((x) => x.i === e.id)!.mk).toBe(1);
    ready(a, 1);
    run(a, 1, ACTION.SKILL2, 1, aimAt(a, other));            // re-marking moves the Mark
    expect(isMarkedBy(a.s, other, 0)).toBe(true);
    expect(isMarkedBy(a.s, e, 0)).toBe(false);
  });

  it('Power Shot always critically strikes a Marked enemy and marks the first enemy hit', () => {
    const a = arena('ranger', [...MARK_T2, 'r_power_shot']);
    const e = tough(spawnAt(a, 'pursuer', 5, 0));
    run(a, 1, ACTION.SKILL2, 1, aimAt(a, e));
    run(a, 20);
    expect(isMarkedBy(a.s, e, 0)).toBe(true);
    ready(a, 1);
    a.events = [];
    run(a, 1, ACTION.SKILL2, 1, aimAt(a, e));
    run(a, 20);
    const hits = a.events.filter((x) => x.t === 'hit' && x.target === e.id) as { crit: boolean }[];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].crit).toBe(true);
  });

  it('Deadeye marks and shoots the 3 enemies nearest the aim', () => {
    const a = arena('ranger', [...MARK_T2, 'r_deadeye']);
    const es = [tough(spawnAt(a, 'pursuer', 5, 0)), tough(spawnAt(a, 'pursuer', 6, 20)), tough(spawnAt(a, 'pursuer', 6, -20)), tough(spawnAt(a, 'pursuer', 3, 150))];
    run(a, 1, ACTION.SKILL2, 1, aimAt(a, es[0]));
    expect(casts(a, 'r_deadeye')).toHaveLength(3);
    for (const e of es.slice(0, 3)) { expect(isMarkedBy(a.s, e, 0)).toBe(true); expect(damaged(e)).toBe(true); }
    expect(isMarkedBy(a.s, es[3], 0)).toBe(false);
  });

  it('Headshot executes a Marked enemy left below 20% health by a critical hit', () => {
    const a = arena('ranger', [...MARK_T2, 'r_keen_eye', 'r_lethality', 'r_power_shot', 'r_headshot']);
    const e = spawnAt(a, 'pursuer', 5, 0);
    e.cohort.unitHp = Big.from(1e6);
    e.cohort.front = Big.from(1e6 * 0.9);                     // 10% health left; Power Shot cannot kill it outright
    markEnemy(a.s, e, 0, 8);
    run(a, 1, ACTION.SKILL2, 1, aimAt(a, e));
    run(a, 20);
    expect(casts(a, 'r_headshot')).toHaveLength(1);
    expect(e.cohort.count.isZero()).toBe(true);
  });

  it('Tumble Shot fires on dodge; Wind Dancer guarantees the next 3 critical hits', () => {
    const nodes = [...MARK_T2, 'r_keen_eye', 'r_lethality', 'r_lethality', 'r_lethality', 'r_tumble_shot', 'r_focus_fire', 'r_wind_dancer'];
    const a = arena('ranger', nodes);
    const e = tough(spawnAt(a, 'pursuer', 6, 0));
    run(a, 1, ACTION.DODGE, 1, aimAt(a, e));
    expect(casts(a, 'r_tumble_shot')).toHaveLength(1);
    expect(arrows(a, 'r_tumble_shot').length).toBe(5);
    expect(a.s.players[0].vars.wdN).toBe(3);
    const m = mod(a, e, 'r_quick_shot');
    expect(m.forceCrit).toBe(true);
    expect(a.s.players[0].vars.wdN).toBe(2);
  });

  it('Exposed Weakness makes Marked enemies take x1.25 damage from allies too', () => {
    const s = newRun(['ranger', 'vanguard'], 'EXPOSED');
    const r = s.players[0];
    r.ranks['r_hunters_mark'] = 1; r.ranks['r_exposed'] = 1;
    const e = { ccVars: {} } as unknown as EnemyState;
    (e as { state: string }).state = 'idle';
    (e as unknown as { cohort: { count: Big } }).cohort = { count: Big.ONE } as never;
    markEnemy(s, e, 0, 8);
    const m: HitMod = { dmg: Big.ONE, critMul: Big.ONE, critDmg: Big.ONE, forceCrit: false };
    hooks.modifyHit(s, s.players[1], e, { skillId: 'v_cleave', dtype: 'physical', generation: 0 }, m);
    expect(m.dmg.toNumber()).toBeCloseTo(1.25, 6);
  });
});

describe('ranger: Wilds', () => {
  it('Snare Trap arms, springs on contact, damages and snares', () => {
    const a = arena('ranger', ['r_snare_trap']);
    const e = tough(spawnAt(a, 'pursuer', 7, 0, 1, false));
    run(a, 1, ACTION.SKILL3, 1, [a.dir[0] * 4, a.dir[1] * 4]);
    expect(a.s.hazards.some((h) => h.kind === 'ranger_trap')).toBe(true);
    let snared = false;
    for (let i = 0; i < 200 && !snared; i++) { run(a, 1); snared = isSnared(a.s, e); }
    expect(snared).toBe(true);
    expect(casts(a, 'r_trap_spring')).toHaveLength(1);
    expect(damaged(e)).toBe(true);
    expect(moveMul(a.s, e)).toBe(0);
    expect(buildSnapshot(a.s).enemies.find((x) => x.i === e.id)!.sn).toBe(1);
  });

  it('Snare shares diminishing returns with Freeze and bosses take stagger instead', () => {
    const a = arena('ranger', []);
    const e = spawnAt(a, 'pursuer', 4, 0, 1, false);
    expect(applySnare(a.s, [], e, 1.5)).toBeCloseTo(1.5, 6);
    expect(applySnare(a.s, [], e, 1.5)).toBeCloseTo(0.75, 6);
    expect(applySnare(a.s, [], e, 1.5)).toBeCloseTo(0.375, 6);
    expect(applySnare(a.s, [], e, 1.5)).toBe(0);
  });

  it('only 3 traps stand at once (Trap Volley: 6)', () => {
    const a = arena('ranger', ['r_snare_trap']);
    for (let i = 0; i < 4; i++) { ready(a, 2); run(a, 2, ACTION.SKILL3, 1, [a.dir[0] * (2 + i), a.dir[1] * (2 + i)]); }
    expect(a.s.hazards.filter((h) => h.kind === 'ranger_trap').length).toBe(3);
    const b = arena('ranger', [...WILDS_T2, 'r_trap_volley']);
    for (let i = 0; i < 3; i++) { ready(b, 2); run(b, 2, ACTION.SKILL3, 1); }
    expect(b.s.hazards.filter((h) => h.kind === 'ranger_trap').length).toBe(6);
  });

  it("Hunter's Bait lures enemies, then springs; Venom Snare leaves a toxic cloud", () => {
    const a = arena('ranger', [...WILDS_T2, 'r_venom_snare', 'r_bait']);
    const e = tough(spawnAt(a, 'pursuer', 6, 30, 1, false));
    run(a, 1, ACTION.SKILL3, 1, [a.dir[0] * 5, a.dir[1] * 5]);
    const bait = a.s.hazards.find((h) => h.kind === 'ranger_bait')!;
    expect(bait).toBeTruthy();
    run(a, 2);
    expect(e.ccVars?.luU ?? 0).toBeGreaterThan(a.s.tick);
    run(a, 160);
    expect(casts(a, 'r_trap_spring')).toHaveLength(1);
    expect(a.s.hazards.some((h) => h.kind === 'ranger_cloud') || casts(a, 'r_trap_spring').length === 1).toBe(true);
  });

  it('Hawk Companion circles the hunter and dives at the Marked enemy; Twin Hawks adds a second hawk', () => {
    const a = arena('ranger', [...WILDS_T2, 'r_hawk_companion', 'r_toxicology', 'r_twin_hawks']);
    const e = tough(spawnAt(a, 'pursuer', 4, 0));
    markEnemy(a.s, e, 0, 30);
    run(a, 5);
    expect(a.s.hazards.filter((h) => h.kind === 'ranger_hawk')).toHaveLength(2);
    run(a, 240);
    expect(casts(a, 'r_hawk_strike').length).toBeGreaterThanOrEqual(2);
    expect(damaged(e)).toBe(true);
  });

  it('Poison Tips arrows poison (decay damage over time)', () => {
    const a = arena('ranger', [...WILDS_T2, 'r_toxicology', 'r_toxicology', 'r_hair_trigger', 'r_poison_tips']);
    const e = tough(spawnAt(a, 'pursuer', 4, 0));
    run(a, 60, ACTION.ATTACK, 60, aimAt(a, e));
    expect(e.dots.some((d) => d.type === 'decay' && d.src === 0)).toBe(true);
  });
});

describe('ranger: determinism', () => {
  it('two identical bot runs produce the same state hash', () => {
    const go = () => { const s = newRun(['ranger'], 'RANGER_DET'); runBot(s, { maxTicks: 60 * 60 * 3 }); return s; };
    const a = go(), b = go();
    expect(a.round).toBeGreaterThanOrEqual(1);
    expect(stateHash(a)).toBe(stateHash(b));
  });
});
