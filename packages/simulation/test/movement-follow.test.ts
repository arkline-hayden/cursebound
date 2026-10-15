import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { BOSSES, CLASSES, DODGE, ENEMIES, MECHANIC_BY_ID, RULES } from '@cursebound/content';
import {
  buildSnapshot, createEnemy, deserializeState, dodgeSpeedFor, findPath, makeHazard, moveSpeedOf, predictMoveTick, routeStep, serializeState,
  spreadFrom, stateHash, step, trackStuck, type Hazard, type MoveBody, type SimEvent,
} from '@cursebound/simulation';
import { ACTION, arena, run, type Arena } from './classkit.helpers';
import { newRun } from './run.helpers';

// Rules 1.4: all movement x0.8 (heroes, foes, bosses, summons and pets) and follower routing (follow.ts): summons
// path around walls and chasm voids, detect stalls, and blink back to the owner's side instead of getting stuck.

// ---------------- frozen fixture: movement speeds before rules 1.4 ----------------
const OLD = {
  playerMoveSpeedMult: 1.1,
  enemyMoveSpeedMult: 1,       // bosses did not take it at all
  classBase: { arcanist: 4.6, artificer: 4.6, berserker: 4.8, cryomancer: 4.5, duelist: 5.0, hexbinder: 4.6, ranger: 4.8, templar: 4.4, vanguard: 4.6, warden: 4.6 } as Record<string, number>,
  enemies: { pursuer: 3.3, skirmisher: 3.0, artillery: 1.6, guardian: 1.8, hexer: 2.2, broodcaller: 1.4, mite: 3.7, gaoler: 2.1, rimewraith: 2.7, gloomshade: 3.0, webweaver: 2.3 } as Record<string, number>,
  bosses: { prismstag: 2.6, bellroot: 0.8 } as Record<string, number>,
  /** Warden wolf follow speed when far behind: 7.5 u/s x 1.75 catch-up */
  wolfCatchUp: 7.5 * 1.75,
  reaperSpeed: 1.8,
};
const K = 0.8;

describe('movement x0.8 (rules 1.4)', () => {
  it('hero walking speed is the old speed x0.8 for every class; dodge distance is unchanged', () => {
    for (const c of CLASSES) {
      const s = newRun([c.id], 'MOVE_' + c.id);
      const p = s.players[0];
      expect(OLD.classBase[c.id], `fixture has ${c.id}`).toBeDefined();
      expect(c.base.moveSpeed).toBe(OLD.classBase[c.id]);                      // authored speed untouched...
      const sp = moveSpeedOf(s, p);
      expect(sp).toBeCloseTo(OLD.classBase[c.id] * OLD.playerMoveSpeedMult * K, 9);  // ...the global multiplier carries the cut
      expect(dodgeSpeedFor(sp, c.id)).toBeCloseTo(DODGE.travel / DODGE.durationSec, 9);   // dash travel keeps its feel
    }
  });

  it('every foe and boss spawns at its old speed x0.8', () => {
    const s = newRun(['vanguard'], 'MOVE_FOES');
    for (const d of ENEMIES) {
      const e = createEnemy(s, d.id, 5, 5, Big.ONE, { objective: false, groupId: 0, summonerId: null });
      if (OLD.enemies[d.id] !== undefined) expect(e.moveSpeed).toBeCloseTo(OLD.enemies[d.id] * OLD.enemyMoveSpeedMult * K, 9);
      expect(e.moveSpeed).toBeCloseTo(d.moveSpeed * K, 9);
    }
    for (const b of BOSSES) {
      const e = createEnemy(s, b.id, 5, 5, Big.ONE, { boss: true, objective: true, groupId: 0, summonerId: null });
      if (OLD.bosses[b.id] !== undefined) expect(e.moveSpeed).toBeCloseTo(OLD.bosses[b.id] * K, 9);
      expect(e.moveSpeed).toBeCloseTo(b.moveSpeed * K, 9);
    }
    for (const id of Object.keys(OLD.enemies)) expect(ENEMIES.some((d) => d.id === id)).toBe(true);
  });

  it('summons, pets and the Reaper move x0.8', () => {
    expect(RULES.minionMoveSpeedMult).toBe(K);
    expect(MECHANIC_BY_ID['the_hunt'].params.speed).toBeCloseTo(OLD.reaperSpeed * K, 9);
    // a wolf far behind the Warden on an open floor catches up at 7.5 x 1.75 x 0.8 u/s
    const a = wardenHall();
    const w = wolvesOf(a)[0];
    const p = a.s.players[0];
    place(w, p.x - 8, p.y);
    run(a, 1);
    expect(Math.abs(w.speed - OLD.wolfCatchUp * K)).toBeLessThan(0.1);
  });
});

describe('client prediction stays in sync with the slower authority', () => {
  it('prediction fed the snapshot speed (spd, as net.ts does) reproduces the authority tick for tick', () => {
    const a = arena('vanguard', [], 'MOVE_PRED');
    const s = a.s, p = s.players[0];
    const me = buildSnapshot(s).players[0];
    expect(me.spd).toBeCloseTo(4.6 * 0.88, 9);
    const body: MoveBody = { x: p.x, y: p.y, vx: p.vx, vy: p.vy, dodgeTimer: p.dodgeTimer, dodgeDirX: p.dodgeDirX, dodgeDirY: p.dodgeDirY, dodgeCharges: p.dodgeCharges, dodgeCooldown: p.dodgeCooldown, surgeTimer: p.surgeTimer, guardTimer: 0 };
    let prev = false;
    for (let i = 0; i < 200; i++) {
      const mx = Math.round(Math.cos(i * 0.05) * 127) / 127, my = Math.round(Math.sin(i * 0.05) * 127) / 127;
      const d = i % 41 === 7;
      const spd = buildSnapshot(s).players[0].spd;
      predictMoveTick(s.map, body, mx, my, 1, 0, d && !prev, spd, p.classId, 1);
      prev = d;
      step(s, [{ seq: a.seq++, moveX: mx, moveY: my, aimX: 1, aimY: 0, buttons: d ? ACTION.DODGE : 0 }]);
      expect(body.x).toBe(p.x);
      expect(body.y).toBe(p.y);
    }
  });
});

// ---------------- follower routing ----------------

const H0 = { x0: 2, y0: 2, x1: 44, y1: 34 };   // open hall (tiles), everything else is wall

/** Warden arena repainted as one open hall with `wall(x, y)` tiles drawn as wall (or chasm void); 3 wolves out. */
function wardenHall(wall: (x: number, y: number) => boolean = () => false, chasm = false, hero: [number, number] = [30.5, 18.5], cls = 'warden'): Arena {
  const a = arena(cls, cls === 'warden' ? ['w_call_pack'] : [], 'FOLLOW_' + cls);
  // a fresh test map (the generated floor's size varies): one hall, walls / voids from `wall`
  const w = H0.x1 + 3, h = H0.y1 + 3;
  const tiles: number[] = [];
  const voids: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inHall = x >= H0.x0 && x <= H0.x1 && y >= H0.y0 && y <= H0.y1;
    const solid = !inHall || wall(x, y);
    tiles.push(solid ? 1 : 0);
    if (inHall && solid && chasm) voids.push(y * w + x);
  }
  const { rooms: _rooms, ...rest } = a.s.map!;
  a.s.map = { ...rest, w, h, tiles, voids, playerSpawns: [{ x: hero[0], y: hero[1] }], enemySpawns: [{ x: H0.x1 - 0.5, y: H0.y1 - 0.5 }] };
  const p = a.s.players[0];
  p.x = hero[0]; p.y = hero[1]; p.vx = 0; p.vy = 0;
  for (const e of a.s.enemies) { e.x = H0.x1 - 0.5; e.y = H0.y1 - 0.5; }   // the round's keeper, far from the hero
  if (cls === 'warden') {
    run(a, 2, ACTION.SKILL2, 1, [1, 0]);
    expect(wolvesOf(a)).toHaveLength(3);
  }
  a.events.length = 0;
  return a;
}

const wolvesOf = (a: Arena) => a.s.hazards.filter((h) => h.kind === 'w_wolf' && h.untilTick > a.s.tick);
const dist = (h: { x: number; y: number }, p: { x: number; y: number }) => Math.hypot(h.x - p.x, h.y - p.y);
function place(h: Hazard, x: number, y: number) {
  h.x = x; h.y = y; delete h.route;
  if (h.vars) { h.vars.tgt = 0; h.vars.leap = 0; for (const k of Object.keys(h.vars)) if (k.startsWith('f_')) delete h.vars[k]; }
}
const blinks = (a: Arena, id?: number) => a.events.filter((e): e is Extract<SimEvent, { t: 'summon_blink' }> => e.t === 'summon_blink' && (id === undefined || e.id === id));

/** Run until every wolf is within `r` of the Warden; returns the tick count (or Infinity). */
function ticksUntilHome(a: Arena, max: number, r = 3.5): number {
  const p = a.s.players[0];
  for (let i = 0; i < max; i++) {
    if (wolvesOf(a).every((w) => dist(w, p) < r)) return i;
    run(a, 1, 0, 1, [1, 0]);
  }
  return wolvesOf(a).every((w) => dist(w, p) < r) ? max : Infinity;
}

describe('follower routing: summons never stay stuck', () => {
  // a U-shaped pocket opening away from the hero: straight-line following pins a wolf against its back wall forever
  const pocket = (x: number, y: number) => (x === 24 && y >= 13 && y <= 24) || ((y === 13 || y === 24) && x >= 17 && x <= 24);
  // close enough that the walk around the pocket stays inside the leash range (beyond it a blink is the right call)
  const POCKET_HERO: [number, number] = [27.5, 18.5];

  it('wolves inside a pocket behind a wall path around it and reach the Warden without blinking', () => {
    const a = wardenHall(pocket, false, POCKET_HERO);
    for (const [i, w] of wolvesOf(a).entries()) place(w, 20.5, 16.5 + i * 2);
    const t = ticksUntilHome(a, 360);
    expect(t).toBeLessThan(360);
    expect(blinks(a)).toHaveLength(0);
  });

  it('wolves across a chasm gap blink back to the Warden side within a bounded number of ticks', () => {
    const gap = (_x: number, y: number) => y >= 13 && y <= 15;            // void band across the whole hall
    const a = wardenHall(gap, true, [22.5, 20.5]);
    const p = a.s.players[0];
    for (const [i, w] of wolvesOf(a).entries()) place(w, 20.5 + i * 1.5, 9.5);
    expect(findPath(a.s.map!, 20.5, 9.5, p.x, p.y)).toEqual([]);
    const t = ticksUntilHome(a, 90);
    expect(t).toBeLessThan(90);
    for (const w of wolvesOf(a)) {
      expect(w.y).toBeGreaterThan(16);                                  // on the hero's side of the chasm
      const b = blinks(a, w.id);
      expect(b.length).toBeGreaterThanOrEqual(1);
      expect(b[0].fy).toBeLessThan(13);
      expect(b[0].slot).toBe(0);
      expect(b[0].kind).toBe('w_wolf');
    }
    run(a, 120, 0, 120, [1, 0]);
    expect(blinks(a).length).toBe(3);                                   // settled: no blink loop
  });

  it('a wolf behind a long wall (only a far detour) blinks instead of running the long way round', () => {
    const longWall = (x: number, y: number) => x === 25 && y <= H0.y1 - 3;
    const a = wardenHall(longWall, false, [29.5, 6.5]);
    const [w] = wolvesOf(a);
    place(w, 21.5, 6.5);
    const t = ticksUntilHome(a, 60);
    expect(t).toBeLessThan(60);
    expect(blinks(a, w.id).length).toBe(1);
  });

  it('a wolf far past the leash range blinks home', () => {
    const a = wardenHall();
    const [w] = wolvesOf(a);
    const p = a.s.players[0];
    place(w, p.x - RULES.followBlinkRange - 2, p.y);
    run(a, 1, 0, 1, [1, 0]);
    expect(blinks(a, w.id).length).toBe(1);
    expect(dist(w, p)).toBeLessThan(3.5);
  });

  it('Hexbinder wraiths use the same routing: a wraith across a chasm blinks back', () => {
    const gap = (_x: number, y: number) => y >= 13 && y <= 15;
    const a = wardenHall(gap, true, [22.5, 20.5], 'hexbinder');
    const s = a.s, p = s.players[0];
    const wr = makeHazard(s, {
      kind: 'hx_wraith', owner: 'player', ownerId: 0, x: 22.5, y: 9.5, radius: 1.2, speed: 5.5 * K, untilTick: s.tick + 600,
      nextTick: s.tick, interval: 36, inner: s.tick + 30, outer: 0, damage: Big.ZERO, dtype: 'decay',
    });
    s.hazards.push(wr);
    run(a, 60, 0, 60, [1, 0]);
    expect(blinks(a, wr.id).length).toBe(1);
    expect(wr.y).toBeGreaterThan(16);
    expect(dist(wr, p)).toBeLessThan(2.5);
  });

  it('routeStep reports an unreachable goal; stuck detection strikes after stalled windows', () => {
    const gap = (_x: number, y: number) => y >= 13 && y <= 15;
    const a = wardenHall(gap, true);
    const s = a.s;
    const h = makeHazard(s, { kind: 'test_body', owner: 'player', ownerId: 0, x: 10.5, y: 9.5, untilTick: s.tick + 9999, damage: Big.ZERO, dtype: 'physical' });
    expect(routeStep(s, h, 10.5, 20.5, 0.1, 0.3)).toBe('fail');
    expect(h.x).toBe(10.5);
    // pinned body, fixed goal: strike 1 after one window (route dropped), strike 2 after the next
    const goal: [number, number] = [10.5, 20.5];
    const strikes: number[] = [];
    for (let i = 0; i <= RULES.followStuckTicks * 2 + 1; i++) { strikes.push(trackStuck(s, h, goal[0], goal[1], 11)); s.tick++; }
    expect(strikes[0]).toBe(0);
    expect(strikes[RULES.followStuckTicks - 1]).toBe(0);
    expect(strikes[RULES.followStuckTicks]).toBe(1);
    expect(strikes[RULES.followStuckTicks * 2]).toBe(2);
    // a body that keeps closing in on its goal never strikes
    const m = makeHazard(s, { kind: 'test_body', owner: 'player', ownerId: 0, x: 10.5, y: 4.5, untilTick: s.tick + 9999, damage: Big.ZERO, dtype: 'physical' });
    for (let i = 0; i < RULES.followStuckTicks * 3; i++) {
      m.x += 0.05;
      expect(trackStuck(s, m, 40.5, 4.5, 40.5 - m.x)).toBe(0);
      s.tick++;
    }
  });

  it('stacked followers spread apart instead of body-blocking', () => {
    const a = wardenHall();
    const s = a.s;
    const mk = (x: number) => makeHazard(s, { kind: 'test_body', owner: 'player', ownerId: 0, x, y: 18.5, untilTick: s.tick + 9999, damage: Big.ZERO, dtype: 'physical' });
    const pack = [mk(20.5), mk(20.5), mk(20.6)];
    for (let i = 0; i < 40; i++) for (const h of pack) spreadFrom(s, h, 0.32, pack, () => 0.32);
    for (let i = 0; i < pack.length; i++) for (let j = i + 1; j < pack.length; j++) expect(dist(pack[i], pack[j])).toBeGreaterThan(0.5);
  });

  it('is deterministic: same inputs, same state, also across a checkpoint mid-route', () => {
    const play = (cut: boolean) => {
      const a = wardenHall(pocket, false, POCKET_HERO);
      for (const [i, w] of wolvesOf(a).entries()) place(w, 20.5, 16.5 + i * 2);
      run(a, 30, 0, 30, [1, 0]);
      if (cut) {
        expect(wolvesOf(a).some((w) => w.route && w.route.length > 0)).toBe(true);   // checkpoint while a route is live
        a.s = deserializeState(serializeState(a.s));
      }
      run(a, 150, 0, 150, [1, 0]);
      return stateHash(a.s);
    };
    const h1 = play(false);
    expect(play(false)).toBe(h1);
    expect(play(true)).toBe(h1);
  });
});

