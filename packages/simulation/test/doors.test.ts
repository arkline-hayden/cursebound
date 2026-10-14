import { describe, expect, it } from 'vitest';
import { RULES, TICK_RATE } from '@cursebound/content';
import {
  buildSnapshot, deserializeState, doorHoldTicks, doorSlotOk, effectiveCounts, isWall, killEnemy, serializeState, stateHash, step,
  type Command, type MapState, type PlayerInput, type SimEvent, type SimState,
} from '@cursebound/simulation';
import { newRun } from './run.helpers';

// In-world door vote (doors.ts): placement, themes, proximity / co-op / deadline commits, the next floor's theme,
// determinism and checkpoint/restore equivalence.

/** Drive to the next VOTING with invulnerable heroes and instant clears; explicit locks (card 0) skip earlier votes. */
function toVoting(s: SimState, round = 1): SimState {
  let seq = 1;
  for (let i = 0; i < 200000 && s.phase !== 'RESULTS'; i++) {
    if (s.phase === 'VOTING' && s.round >= round) return s;
    const cmds: Command[] = [];
    if (s.phase === 'LOADOUT_LOCK' || s.phase === 'SKILL_ALLOCATION') for (const p of s.players) if (!p.ready) cmds.push({ type: 'READY', slot: p.slot, ready: true });
    if (s.phase === 'VOTING' && s.offer) for (const p of s.players) if (!s.offer.votes[p.slot].locked) cmds.push({ type: 'VOTE', slot: p.slot, offerId: s.offer.id, seq: seq++, cardSlot: 0, locked: true });
    if (s.awaitingDurable) cmds.push({ type: 'DURABLE', what: s.awaitingDurable });
    if (s.phase === 'COMBAT') {
      for (const p of s.players) p.iframes = 10;
      for (const e of s.enemies) if (e.state !== 'dying') killEnemy(s, [], e, 0);
    }
    step(s, [], cmds);
  }
  return s;
}

/** Finish FATE_COMMIT (durable ack + walk-through) into the next ROUND_SETUP. */
function toNextRound(s: SimState): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < 2000 && s.phase !== 'ROUND_SETUP'; i++) {
    const r = step(s, [], s.awaitingDurable ? [{ type: 'DURABLE', what: s.awaitingDurable }] : []);
    all.push(...r.events);
  }
  return all;
}

function stand(s: SimState, slot: number, door: number) {
  const d = s.doors!.list[door];
  s.players[slot].x = d.x; s.players[slot].y = d.y; s.players[slot].vx = 0; s.players[slot].vy = 0;
}

function reach(map: MapState, sx: number, sy: number): Int32Array {
  const d = new Int32Array(map.w * map.h).fill(-1);
  const q = [sy * map.w + sx];
  d[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h], x = c % map.w, y = (c / map.w) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (isWall(map, nx, ny) || d[ny * map.w + nx] >= 0) continue;
      d[ny * map.w + nx] = d[c] + 1; q.push(ny * map.w + nx);
    }
  }
  return d;
}

const idle = (s: SimState): PlayerInput[] => s.players.map((p) => ({ seq: p.lastInputSeq + 1, moveX: 0, moveY: 0, aimX: 1, aimY: 0, buttons: 0 }));

describe('door placement', () => {
  it('three doors on visible, reachable wall faces, read as one threshold, every round', () => {
    for (const seed of ['DOOR_A', 'DOOR_B', 'DOOR_C', 'DOOR_D', 'DOOR_E']) {
      const s = newRun(seed === 'DOOR_C' ? ['vanguard', 'arcanist', 'vanguard'] : ['vanguard'], seed);
      for (let round = 1; round <= 5; round++) {
        toVoting(s, round);
        expect(s.phase).toBe('VOTING');
        const map = s.map!, doors = s.doors!;
        expect(doors.list).toHaveLength(3);
        expect(doors.list.map((d) => d.i)).toEqual([0, 1, 2]);
        expect(doors.list.map((d) => d.c)).toEqual(s.offer!.cards);
        for (const d of doors.list) {
          // visible faces only: the wall's south face (normal +y) or east face (normal +x)
          expect([[0, 1], [1, 0]]).toContainEqual([d.nx, d.ny]);
          const fx = Math.floor(d.x), fy = Math.floor(d.y);
          expect(d.x - fx).toBe(0.5); expect(d.y - fy).toBe(0.5);
          expect(isWall(map, fx - d.nx, fy - d.ny)).toBe(true);   // set into a wall
          expect(isWall(map, fx, fy)).toBe(false);                // standing room in front
          expect(doorSlotOk(map, fx, fy, d.nx, d.ny, false)).toBe(true);
          // reachable from every living hero
          for (const p of s.players) expect(reach(map, Math.floor(p.x), Math.floor(p.y))[fy * map.w + fx]).toBeGreaterThanOrEqual(0);
          // nobody starts inside a door
          for (const p of s.players) expect(Math.hypot(p.x - d.x, p.y - d.y)).toBeGreaterThan(RULES.doorVoteRadius);
        }
        // a threshold: neighbours 3+ tiles apart, all within one stretch / room, ordered left to right on screen
        for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
          const a = doors.list[i], b = doors.list[j];
          const cheb = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
          expect(cheb).toBeGreaterThanOrEqual(2);
          expect(cheb).toBeLessThanOrEqual(RULES.doorSpacingMax * 2 + 3);
          expect(a.x - a.y).toBeLessThanOrEqual(b.x - b.y);
        }
        expect(doors.boss).toBe((round + 1) % RULES.bossEvery === 0);
      }
    }
  });

  it('door themes are distinct, never the current floor, and match the offer', () => {
    for (const seed of ['TH1', 'TH2', 'TH3', 'TH4']) {
      const s = newRun(['arcanist'], seed);
      for (let round = 1; round <= 4; round++) {
        toVoting(s, round);
        const th = s.offer!.themes!;
        expect(th).toHaveLength(3);
        expect(new Set(th).size).toBe(3);
        expect(th).not.toContain(s.map!.theme);
        expect(s.doors!.list.map((d) => d.th)).toEqual(th);
        const snap = buildSnapshot(s);
        expect(snap.doors!.map((d) => d.th)).toEqual(th);
      }
    }
  });
});

describe('door voting', () => {
  it('solo: standing in a door for doorSoloHoldSec commits that door; walking works, attacks do not', () => {
    const s = toVoting(newRun(['vanguard'], 'SOLO_DOOR'));
    // movement and dodge are live during VOTING, attacks and casts are not
    const x0 = s.players[0].x, y0 = s.players[0].y;
    const evs: SimEvent[] = [];
    for (let k = 0; k < 10; k++) evs.push(...step(s, [{ seq: 100 + k, moveX: 0.5, moveY: 0.5, aimX: 1, aimY: 0, buttons: 1 | 2 | 16 }], []).events);
    expect(Math.hypot(s.players[0].x - x0, s.players[0].y - y0)).toBeGreaterThan(0.05);
    expect(s.players[0].lastInputSeq).toBe(109);
    expect(evs.some((e) => e.t === 'cast' || e.t === 'hit')).toBe(false);
    expect(s.projectiles).toHaveLength(0);
    stand(s, 0, 1);
    const need = doorHoldTicks(s);
    expect(need).toBe(Math.round(RULES.doorSoloHoldSec * TICK_RATE));
    for (let k = 0; k < need - 1; k++) step(s, idle(s), []);
    expect(s.phase).toBe('VOTING');
    const snap = buildSnapshot(s);
    expect(snap.doors![1].v).toEqual([0]);
    expect(snap.doors![1].hold).toBeGreaterThan(0.9);
    expect(snap.doors![0].hold).toBe(0);
    const r = step(s, idle(s), []);
    expect(s.phase).toBe('FATE_COMMIT');
    expect(s.commits[s.commits.length - 1].cardId).toBe(s.offer!.cards[1]);
    const ev = r.events.find((e) => e.t === 'door_chosen');
    expect(ev).toMatchObject({ t: 'door_chosen', i: 1, th: s.offer!.themes![1], c: s.offer!.cards[1], x: s.doors!.list[1].x, y: s.doors!.list[1].y });
    // doors stay in the snapshot through FATE_COMMIT (the walk-through), the chosen one marked
    expect(buildSnapshot(s).doors![1]).toMatchObject({ sel: 1, hold: 1 });
  });

  it('co-op: every living, connected hero in the SAME door for doorCoopHoldSec commits', () => {
    const s = toVoting(newRun(['vanguard', 'arcanist'], 'COOP_DOOR'));
    stand(s, 0, 2); stand(s, 1, 0);
    for (let k = 0; k < 150; k++) step(s, idle(s), []);
    expect(s.phase).toBe('VOTING');                 // split party: no commit
    expect(effectiveCounts(s)).toEqual([1, 0, 1]);
    stand(s, 1, 2);
    const need = doorHoldTicks(s);
    expect(need).toBe(Math.round(RULES.doorCoopHoldSec * TICK_RATE));
    for (let k = 0; k < need - 1; k++) step(s, idle(s), []);
    expect(s.phase).toBe('VOTING');
    step(s, idle(s), []);
    expect(s.phase).toBe('FATE_COMMIT');
    expect(s.commits[s.commits.length - 1].cardId).toBe(s.offer!.cards[2]);
  });

  it('co-op: a member who stepped out resets the hold; disconnected members abstain after their grace', () => {
    const s = toVoting(newRun(['vanguard', 'arcanist', 'vanguard'], 'COOP_DC'));
    step(s, idle(s), [{ type: 'DISCONNECT', slot: 2 }]);
    s.players[2].disconnectedAtTick = s.tick - RULES.reconnectHoldSec * TICK_RATE - 1;   // grace expired
    stand(s, 0, 1); stand(s, 1, 1);
    for (let k = 0; k < 40; k++) step(s, idle(s), []);
    s.players[1].x += 3;                               // steps out: the hold resets
    step(s, idle(s), []);
    expect(s.doors!.holdTicks).toBe(0);
    stand(s, 1, 1);
    for (let k = 0; k < doorHoldTicks(s); k++) step(s, idle(s), []);
    expect(s.phase).toBe('FATE_COMMIT');
    expect(s.commits[s.commits.length - 1].cardId).toBe(s.offer!.cards[1]);
  });

  it('deadline: positional votes override explicit ones, explicit votes count elsewhere', () => {
    const s = toVoting(newRun(['vanguard', 'arcanist', 'vanguard'], 'DEADLINE_DOOR'));
    const id = s.offer!.id;
    step(s, idle(s), [
      { type: 'VOTE', slot: 0, offerId: id, seq: 1, cardSlot: 0, locked: false },   // explicit only
      { type: 'VOTE', slot: 1, offerId: id, seq: 1, cardSlot: 0, locked: false },   // explicit 0, but stands in door 2
    ]);
    stand(s, 1, 2); stand(s, 2, 2);
    expect(effectiveCounts(s)).toEqual([1, 0, 2]);
    s.offer!.deadlineTick = s.tick + 3;
    for (let k = 0; k < 5 && s.phase === 'VOTING'; k++) step(s, idle(s), []);
    expect(s.phase).toBe('FATE_COMMIT');
    const c = s.commits[s.commits.length - 1];
    expect(c.cardSlot).toBe(2);
    expect(c.tie.counts).toEqual([1, 0, 2]);
    expect(c.tie.draw).toBeNull();
  });

  it('explicit locks still resolve early (bots, the Choose button) and a hero in a door overrides their lock', () => {
    const s = toVoting(newRun(['vanguard', 'arcanist'], 'LOCK_DOOR'));
    const id = s.offer!.id;
    stand(s, 1, 2);
    step(s, idle(s), [
      { type: 'VOTE', slot: 0, offerId: id, seq: 1, cardSlot: 2, locked: true },
      { type: 'VOTE', slot: 1, offerId: id, seq: 1, cardSlot: 0, locked: true },
    ]);
    step(s, idle(s), []);
    expect(s.phase).toBe('FATE_COMMIT');
    expect(s.commits[s.commits.length - 1].cardSlot).toBe(2);
  });
});

describe('door consequences', () => {
  it('the next floor is built in the chosen door\'s dungeon; FATE_COMMIT lasts the walk-through', () => {
    const s = toVoting(newRun(['vanguard'], 'NEXT_THEME'));
    const theme = s.offer!.themes![2];
    stand(s, 0, 2);
    for (let k = 0; k < 200 && s.phase === 'VOTING'; k++) step(s, idle(s), []);
    expect(s.phase).toBe('FATE_COMMIT');
    const commitTick = s.tick;
    step(s, [], [{ type: 'DURABLE', what: 'commit' }]);
    expect(s.phase).toBe('FATE_COMMIT');            // durable, but the walk-through is still playing
    toNextRound(s);
    expect(s.tick - commitTick).toBeGreaterThanOrEqual(Math.round(RULES.doorWalkSec * TICK_RATE));
    expect(s.round).toBe(2);
    expect(s.map!.theme).toBe(theme);
    expect(s.doors).toBeNull();
    expect(buildSnapshot(s).doors).toBeUndefined();
  });

  it('a door before a boss round leads to a boss lair (arena layout) in its theme', () => {
    const s = toVoting(newRun(['vanguard'], 'LAIR'), 4);
    expect(s.round).toBe(4);
    expect(s.doors!.boss).toBe(true);
    expect(buildSnapshot(s).doors!.every((d) => d.b === 1)).toBe(true);
    const theme = s.offer!.themes![0];
    stand(s, 0, 0);
    for (let k = 0; k < 200 && s.phase === 'VOTING'; k++) step(s, idle(s), []);
    toNextRound(s);
    expect(s.round).toBe(5);
    expect(s.map!.layout).toBe('arena');
    expect(s.map!.theme).toBe(theme);
  });
});

describe('door determinism', () => {
  const script = (s: SimState, k: number): PlayerInput[] =>
    s.players.map((p, i) => ({ seq: p.lastInputSeq + 1, moveX: Math.round(Math.cos(k / 17 + i) * 127) / 127, moveY: Math.round(Math.sin(k / 23 + i) * 127) / 127, aimX: 1, aimY: 0, buttons: k % 40 === 5 ? 32 : 0 }));

  it('same seed and inputs: identical doors, votes and hashes; checkpoint/restore continues identically', () => {
    const a = toVoting(newRun(['vanguard', 'arcanist'], 'DET_DOOR'));
    const b = toVoting(newRun(['vanguard', 'arcanist'], 'DET_DOOR'));
    expect(a.doors).toEqual(b.doors);
    expect(stateHash(a)).toBe(stateHash(b));
    for (let k = 0; k < 90; k++) { step(a, script(a, k), []); step(b, script(b, k), []); }
    expect(stateHash(a)).toBe(stateHash(b));
    // checkpoint mid-vote (a hold under way), restore, continue both
    stand(a, 0, 1); stand(a, 1, 1);
    for (let k = 0; k < 30; k++) step(a, idle(a), []);
    const c = deserializeState(serializeState(a));
    expect(stateHash(c)).toBe(stateHash(a));
    for (let k = 0; k < 200; k++) {
      const ra = step(a, idle(a), a.awaitingDurable ? [{ type: 'DURABLE', what: 'commit' }] : []);
      const rc = step(c, idle(c), c.awaitingDurable ? [{ type: 'DURABLE', what: 'commit' }] : []);
      expect(JSON.stringify(rc.events)).toBe(JSON.stringify(ra.events));
    }
    expect(stateHash(c)).toBe(stateHash(a));
    expect(a.commits[a.commits.length - 1].cardSlot).toBe(1);
    // checkpoint during FATE_COMMIT (what the authority persists with the commit) restores the chosen theme
    const d = toVoting(newRun(['arcanist'], 'DET_COMMIT'));
    stand(d, 0, 0);
    for (let k = 0; k < 200 && d.phase === 'VOTING'; k++) step(d, idle(d), []);
    const e = deserializeState(serializeState(d));
    toNextRound(d); toNextRound(e);
    expect(e.map).toEqual(d.map);
    expect(stateHash(e)).toBe(stateHash(d));
  });

  it('old checkpoints without door fields still load and vote', () => {
    const s = toVoting(newRun(['vanguard'], 'OLD_CKPT'));
    const raw = JSON.parse(serializeState(s));
    delete raw.doors; delete raw.nextTheme; delete raw.offer.themes;
    const old = deserializeState(JSON.stringify(raw));
    step(old, idle(old), []);
    expect(old.doors!.list).toHaveLength(3);         // placed lazily
    stand(old, 0, 0);
    for (let k = 0; k < 200 && old.phase === 'VOTING'; k++) step(old, idle(old), []);
    expect(old.phase).toBe('FATE_COMMIT');
    toNextRound(old);
    expect(old.round).toBe(2);
  });
});
