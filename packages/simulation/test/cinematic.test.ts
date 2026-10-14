import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { RULES, TICK_RATE, isBossRound } from '@cursebound/content';
import {
  ACTION, buildSnapshot, deserializeState, inCinematic, killEnemy, makeHazard, serializeState, stateHash, step,
  type Command, type PlayerInput, type SimEvent, type SimState,
} from '@cursebound/simulation';
import { newRun } from './run.helpers';

// Cinematic holds (cinematic.ts): round-intro timing, the boss grand-entrance freeze, determinism and restore.

const BOSS_TICKS = Math.round(RULES.bossIntroSec * TICK_RATE);

/** Intermission commands that move the run along (ready up, vote the first card, acknowledge durability). */
function flowCommands(s: SimState, seq: { n: number }): Command[] {
  const cmds: Command[] = [];
  if (s.phase === 'LOADOUT_LOCK' || s.phase === 'SKILL_ALLOCATION') for (const p of s.players) if (!p.ready) cmds.push({ type: 'READY', slot: p.slot, ready: true });
  if (s.phase === 'VOTING' && s.offer) for (const p of s.players) { const v = s.offer.votes[p.slot]; if (!v?.locked) cmds.push({ type: 'VOTE', slot: p.slot, offerId: s.offer.id, seq: seq.n++, cardSlot: 0, locked: true }); }
  if (s.awaitingDurable) cmds.push({ type: 'DURABLE', what: s.awaitingDurable });
  return cmds;
}

/** Fresh run that enters round `r` on its first ROUND_SETUP (no earlier rounds are played). */
function runAtRound(r: number, classes = ['vanguard', 'arcanist'], seed = 'CINEMA_TEST_01'): SimState {
  const s = newRun(classes, seed);
  s.round = r - 1;
  return s;
}

/** Step until `pred` holds (or fail after `max` ticks). Returns every event seen. */
function stepUntil(s: SimState, pred: (s: SimState) => boolean, max = 20000, inputs: (s: SimState) => (PlayerInput | null)[] = () => []): SimEvent[] {
  const all: SimEvent[] = [];
  const seq = { n: 1 };
  for (let i = 0; i < max && !pred(s); i++) all.push(...step(s, inputs(s), flowCommands(s, seq)).events);
  expect(pred(s)).toBe(true);
  return all;
}

let inputSeq = 1;
const pushing = (s: SimState): PlayerInput[] => s.players.map(() => ({ seq: inputSeq++, moveX: 1, moveY: 0.5, aimX: 2, aimY: 0, buttons: ACTION.ATTACK | ACTION.SKILL1 | ACTION.SIGNATURE }));

describe('round intro (ROUND_SETUP)', () => {
  it('emits round_intro with the floor theme and the boss flag, and lasts RULES.setupSec', () => {
    expect(RULES.setupSec).toBeGreaterThanOrEqual(2.5);
    for (const r of [1, 4, 5]) {
      const s = runAtRound(r);
      const ev = stepUntil(s, (x) => x.phase === 'ROUND_SETUP');
      const intro = ev.filter((e): e is Extract<SimEvent, { t: 'round_intro' }> => e.t === 'round_intro');
      expect(intro).toHaveLength(1);
      expect(intro[0]).toEqual({ t: 'round_intro', round: r, theme: s.map!.theme, boss: isBossRound(r) });
      expect(intro[0].boss).toBe(r === 5);
      // heroes stand frozen at their spawns for the whole intro, whatever they press
      const start = s.tick;
      const spawn = s.players.map((p) => [p.x, p.y]);
      stepUntil(s, (x) => x.phase === 'COMBAT', 1000, pushing);
      const held = s.tick - start;
      expect(held).toBeGreaterThanOrEqual(Math.round(RULES.setupSec * TICK_RATE) - 1);
      expect(held).toBeLessThanOrEqual(Math.round(RULES.setupSec * TICK_RATE) + 1);
      expect(s.players.map((p) => [p.x, p.y])).toEqual(spawn);
    }
  });

  it('ordinary rounds never hold the fight', () => {
    const s = runAtRound(3);
    const ev = stepUntil(s, (x) => x.phase === 'COMBAT');
    expect(ev.some((e) => e.t === 'boss_intro')).toBe(false);
    expect(inCinematic(s)).toBe(false);
    expect(s.cinematicUntilTick).toBeUndefined();
    expect(buildSnapshot(s).cu).toBeUndefined();
  });
});

describe('boss grand entrance (cinematicUntilTick)', () => {
  function atBossSpawn(seed = 'CINEMA_TEST_01') {
    const s = runAtRound(5, ['vanguard', 'arcanist'], seed);
    stepUntil(s, (x) => x.phase === 'ROUND_SETUP');
    const ev = stepUntil(s, (x) => x.phase === 'COMBAT');
    return { s, ev, spawnTick: s.tick - 1 };
  }

  it('emits boss_intro at the spawn and holds for RULES.bossIntroSec', () => {
    const { s, ev, spawnTick } = atBossSpawn();
    const boss = s.enemies.find((e) => e.boss)!;
    expect(boss).toBeTruthy();
    const intro = ev.filter((e) => e.t === 'boss_intro');
    expect(intro).toEqual([{ t: 'boss_intro', id: boss.id, k: boss.kind, x: boss.x, y: boss.y }]);
    expect(s.cinematicUntilTick).toBe(spawnTick + BOSS_TICKS);
    expect(inCinematic(s)).toBe(true);
    expect(buildSnapshot(s).cu).toBe(s.cinematicUntilTick);
  });

  it('freezes damage, movement, AI, projectiles, hazards and timers during the hold, then resumes', () => {
    const { s } = atBossSpawn();
    const boss = s.enemies.find((e) => e.boss)!;
    const p0 = s.players[0];
    // seed in-flight threats right on top of the heroes: a hex pool, a bone needle and a lob already in the air
    s.hazards.push(makeHazard(s, { kind: 'pool', owner: 'enemy', ownerId: boss.id, x: p0.x, y: p0.y, radius: 2, untilTick: s.tick + 300, interval: 10, nextTick: s.tick + 1, damage: Big.from(50), dtype: 'decay' }));
    s.projectiles.push({ id: s.nextId++, kind: 'shard', owner: 'enemy', ownerId: boss.id, x: p0.x - 3, y: p0.y, vx: 6, vy: 0, radius: 0.2, range: 8, damage: Big.from(40), weight: Big.ONE, dtype: 'physical', pierce: 0, hitIds: [], skillId: 'shard', crit: false, lobTarget: null, bornTick: s.tick });
    s.projectiles.push({ id: s.nextId++, kind: 'lob', owner: 'enemy', ownerId: boss.id, x: p0.x + 4, y: p0.y, vx: 0, vy: 0, radius: 0.2, range: 8, damage: Big.from(40), weight: Big.ONE, dtype: 'ember', pierce: 0, hitIds: [], skillId: 'lob', crit: false, lobTarget: { x: p0.x, y: p0.y, radius: 1.2, landTick: s.tick + 30 }, bornTick: s.tick });
    s.telegraphs.push({ id: s.nextId++, ownerId: boss.id, shape: { kind: 'circle', radius: 2 }, x: p0.x, y: p0.y, dx: 1, dy: 0, startTick: s.tick, releaseTick: s.tick + 20, attack: 'slam' });
    const before = {
      hp: s.players.map((p) => p.hp.toString()), pos: s.players.map((p) => [p.x, p.y]), res: s.players.map((p) => p.resource),
      boss: [boss.x, boss.y, boss.state, boss.cohort.spread.toString(), JSON.stringify(boss.cooldowns), boss.patternStep],
      proj: s.projectiles.map((pr) => [pr.x, pr.y, pr.range, pr.lobTarget ? pr.lobTarget.landTick - s.tick : -1]),
      hazLeft: s.hazards.map((h) => [h.untilTick - s.tick, h.nextTick - s.tick]),
      teleLeft: s.telegraphs.map((t) => t.releaseTick - s.tick),
      enc: [s.encounter!.activeTicks, s.encounter!.waveTimer, s.totalActiveTicks],
      ward: s.players.map((p) => p.vars.boon_ward_next),
    };
    const seen: SimEvent[] = [];
    let held = 0;
    while (inCinematic(s)) { seen.push(...step(s, pushing(s), []).events); held++; }
    expect(held).toBe(BOSS_TICKS - 1);   // the spawn tick itself plus these = exactly RULES.bossIntroSec
    expect(seen.filter((e) => e.t === 'hit' || e.t === 'cast' || e.t === 'enemy_attack' || e.t === 'dodge' || e.t === 'downed')).toEqual([]);
    expect(s.players.map((p) => p.hp.toString())).toEqual(before.hp);
    expect(s.players.map((p) => [p.x, p.y])).toEqual(before.pos);
    expect(s.players.map((p) => p.resource)).toEqual(before.res);
    expect([boss.x, boss.y, boss.state, boss.cohort.spread.toString(), JSON.stringify(boss.cooldowns), boss.patternStep]).toEqual(before.boss);
    expect(s.projectiles.map((pr) => [pr.x, pr.y, pr.range, pr.lobTarget ? pr.lobTarget.landTick - s.tick : -1])).toEqual(before.proj);
    expect(s.hazards.map((h) => [h.untilTick - s.tick, h.nextTick - s.tick])).toEqual(before.hazLeft);
    expect(s.telegraphs.map((t) => t.releaseTick - s.tick)).toEqual(before.teleLeft);
    expect([s.encounter!.activeTicks, s.encounter!.waveTimer, s.totalActiveTicks]).toEqual(before.enc);
    // round-start hooks wait for the release (Fate boons arm one second into the real fight)
    expect(s.players.map((p) => p.vars.boon_ward_next)).toEqual(before.ward);
    expect(buildSnapshot(s).cu).toBeUndefined();

    // released: the very next tick is combat again
    const release = s.tick;
    const after: SimEvent[] = [];
    for (let i = 0; i < 90; i++) after.push(...step(s, pushing(s), []).events);
    expect(s.encounter!.activeTicks).toBe(90);
    expect(s.players.every((p) => p.vars.boon_ward_next === release + 60)).toBe(true);
    expect(after.some((e) => e.t === 'hit' && e.targetKind === 'player')).toBe(true);   // the pool / needle / lob land now
    expect(s.players.some((p, i) => p.x !== before.pos[i][0] || p.y !== before.pos[i][1])).toBe(true);
    expect(boss.cooldowns._pause).toBeLessThan(JSON.parse(before.boss[4] as string)._pause);
  });

  it('a boss killed during the hold only counts once the fight resumes', () => {
    const { s } = atBossSpawn();
    const boss = s.enemies.find((e) => e.boss)!;
    killEnemy(s, [], boss, 0);
    for (let i = 0; i < 60; i++) step(s, [], []);
    expect(s.phase).toBe('COMBAT');
    while (inCinematic(s)) step(s, [], []);
    for (let i = 0; i < 5 && s.phase === 'COMBAT'; i++) step(s, [], []);
    expect(s.phase).toBe('ROUND_CLEAR');
  });

  it('is deterministic and checkpoint/restore equivalent mid-hold', () => {
    const run = (seed: string) => {
      const { s } = atBossSpawn(seed);
      for (let i = 0; i < 100; i++) step(s, pushing(s), []);
      return s;
    };
    const a = run('CINEMA_DET'), b = run('CINEMA_DET');
    expect(stateHash(a)).toBe(stateHash(b));
    expect(inCinematic(a)).toBe(true);
    const restored = deserializeState(serializeState(a));
    expect(restored.cinematicUntilTick).toBe(a.cinematicUntilTick);
    expect(stateHash(restored)).toBe(stateHash(a));
    // identical inputs across the release and into the fight
    for (let i = 0; i < 400; i++) {
      const inA = a.players.map((_, slot) => ({ seq: i + 1, moveX: slot ? -1 : 1, moveY: 0, aimX: 1, aimY: 1, buttons: ACTION.ATTACK }));
      step(a, inA, []);
      step(restored, inA.map((x) => ({ ...x })), []);
    }
    expect(inCinematic(a)).toBe(false);
    expect(stateHash(restored)).toBe(stateHash(a));
  });
});
