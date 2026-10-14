import { describe, expect, it } from 'vitest';
import { ACTION, generateMap, moveCircle, type MapState } from '@cursebound/simulation';
import { BODY_RADIUS, blocked, circleFree, findPath, findPathEx, lineClear, smoothPath, type GridMap, type Pt } from '../apps/client/src/game/input/path';
import { attackRange, basicReach, engageDecision, pickEnemy, pickGround, type PickableEnemy } from '../apps/client/src/game/input/targeting';
import { ClickMove, skillStopsWalk, type DriveFrame } from '../apps/client/src/game/input/ClickMove';

// Diablo-style click-to-move (client): A* that never cuts wall corners, line-of-sight smoothing, nearest-reachable
// fallbacks, attack-move reach decisions and the controller's per-frame intentions.

/** '#' wall, '.' floor. */
function grid(rows: string[]): GridMap & MapState {
  const h = rows.length, w = rows[0].length;
  const tiles: number[] = [];
  for (const r of rows) for (const c of r) tiles.push(c === '#' ? 1 : 0);
  return { w, h, tiles, topology: 'test', playerSpawns: [], enemySpawns: [], fallback: false, decorSeed: 0, theme: 'crypt', layout: 'test' };
}

function open(w: number, h: number): GridMap & MapState {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let r = '';
    for (let x = 0; x < w; x++) r += x === 0 || y === 0 || x === w - 1 || y === h - 1 ? '#' : '.';
    rows.push(r);
  }
  return grid(rows);
}

describe('click-to-move pathing', () => {
  it('never cuts a wall corner on a diagonal step', () => {
    const m = grid([
      '#####',
      '#.#.#',
      '#...#',
      '#####',
    ]);
    // (1,1) -> (3,1): a straight diagonal would clip the wall at (2,1); every tile step must keep both orthogonals open
    const res = findPathEx(m, 1.5, 1.5, 3.5, 1.5, { smooth: false });
    expect(res.reached).toBe(true);
    const pts: Pt[] = [{ x: 1.5, y: 1.5 }, ...res.points];
    for (let i = 1; i < pts.length; i++) {
      const ax = Math.floor(pts[i - 1].x), ay = Math.floor(pts[i - 1].y), bx = Math.floor(pts[i].x), by = Math.floor(pts[i].y);
      expect(Math.max(Math.abs(bx - ax), Math.abs(by - ay))).toBeLessThanOrEqual(1);
      if (ax !== bx && ay !== by) {
        expect(blocked(m, bx, ay)).toBe(false);
        expect(blocked(m, ax, by)).toBe(false);
      }
    }
    // smoothed: every leg is walkable by the hero's body
    const smooth = findPath(m, 1.5, 1.5, 3.5, 1.5);
    let p = { x: 1.5, y: 1.5 };
    for (const q of smooth) { expect(lineClear(m, p.x, p.y, q.x, q.y, BODY_RADIUS)).toBe(true); p = q; }
    expect(smooth[smooth.length - 1]).toEqual({ x: 3.5, y: 1.5 });
  });

  it('walks straight across open floor (string pulling removes the staircase)', () => {
    const m = open(14, 10);
    const pts = findPath(m, 1.5, 1.5, 11.5, 6.5);
    expect(pts).toEqual([{ x: 11.5, y: 6.5 }]);
    const raw = findPathEx(m, 1.5, 1.5, 11.5, 6.5, { smooth: false }).points;
    expect(raw.length).toBeGreaterThan(5);
  });

  it('turns only at the corners it needs around an L-shaped corridor', () => {
    const m = grid([
      '##########',
      '#........#',
      '#######..#',
      '#######..#',
      '#######..#',
      '#........#',
      '##########',
    ]);
    const pts = findPath(m, 1.5, 1.5, 1.5, 5.5);
    expect(pts.length).toBeGreaterThanOrEqual(2);
    expect(pts.length).toBeLessThanOrEqual(4);
    let p = { x: 1.5, y: 1.5 };
    for (const q of pts) { expect(lineClear(m, p.x, p.y, q.x, q.y)).toBe(true); p = q; }
    expect(pts[pts.length - 1]).toEqual({ x: 1.5, y: 5.5 });
    // smoothing never invents a shortcut through rock
    const raw = findPathEx(m, 1.5, 1.5, 1.5, 5.5, { smooth: false }).points;
    const again = smoothPath(m, [{ x: 1.5, y: 1.5 }, ...raw]);
    for (let i = 1; i < again.length; i++) expect(lineClear(m, again[i - 1].x, again[i - 1].y, again[i].x, again[i].y)).toBe(true);
  });

  it('walks to the floor in front of a clicked wall', () => {
    const m = open(10, 8);
    const res = findPathEx(m, 2.5, 2.5, 9.6, 3.5);          // the east wall
    expect(res.reached).toBe(true);
    expect(blocked(m, Math.floor(res.goal.x), Math.floor(res.goal.y))).toBe(false);
    expect(circleFree(m, res.goal.x, res.goal.y, BODY_RADIUS)).toBe(true);
    expect(res.goal.x).toBeGreaterThan(8.5);
    expect(Math.abs(res.goal.y - 3.5)).toBeLessThan(0.01);
  });

  it('falls back to the nearest reachable floor for an unreachable click', () => {
    const m = grid([
      '###########',
      '#....#....#',
      '#....#....#',
      '#....#....#',
      '###########',
    ]);
    const res = findPathEx(m, 1.5, 2.5, 8.5, 1.5);
    expect(res.reached).toBe(false);
    // the closest floor of the start room to the click is the tile right against the dividing wall
    expect(Math.floor(res.goal.x)).toBe(4);
    expect(Math.floor(res.goal.y)).toBe(1);
    expect(res.points.length).toBeGreaterThan(0);
    // and nothing to do when already standing there
    const again = findPathEx(m, res.goal.x, res.goal.y, 8.5, 1.5);
    expect(again.points).toEqual([]);
    expect(again.reached).toBe(false);
  });

  it('routes around extra tile costs (crowds) when asked to', () => {
    const m = open(12, 7);
    const direct = findPath(m, 1.5, 3.5, 10.5, 3.5);
    expect(direct).toEqual([{ x: 10.5, y: 3.5 }]);
    const around = findPathEx(m, 1.5, 3.5, 10.5, 3.5, { cost: (tx, ty) => (tx >= 4 && tx <= 7 && ty >= 2 && ty <= 4 ? 50 : 0) });
    expect(around.reached).toBe(true);
    expect(around.points.length).toBeGreaterThan(1);
  });
});

describe('attack-move decisions', () => {
  it('reads basic attack reach from the class content', () => {
    const v = basicReach('vanguard');
    expect(v.ranged).toBe(false);
    expect(v.range).toBeGreaterThan(1);
    expect(v.range).toBeLessThan(3);
    const r = basicReach('ranger');
    expect(r.ranged).toBe(true);
    expect(r.range).toBeGreaterThanOrEqual(8);
    expect(basicReach('nope')).toEqual({ ranged: false, range: 1.6 });
  });

  it('melee stands and swings once the body edge is inside the arc, else closes in', () => {
    const reach = { ranged: false, range: 1.75 };
    const self = { x: 0, y: 0 };
    expect(engageDecision({ self, target: { x: 1.8, y: 0, r: 0.4 }, reach, engaged: false, los: true })).toBe('attack');
    expect(engageDecision({ self, target: { x: 3, y: 0, r: 0.4 }, reach, engaged: false, los: true })).toBe('approach');
    // hysteresis: a target stepping just out of the entry band keeps getting hit
    const edge = attackRange(reach, 0.4, false) + 0.1;
    expect(engageDecision({ self, target: { x: edge, y: 0, r: 0.4 }, reach, engaged: false, los: true })).toBe('approach');
    expect(engageDecision({ self, target: { x: edge, y: 0, r: 0.4 }, reach, engaged: true, los: true })).toBe('attack');
  });

  it('ranged shoots inside projectile range with a clear line, else moves closer', () => {
    const reach = { ranged: true, range: 10 };
    const self = { x: 0, y: 0 };
    expect(engageDecision({ self, target: { x: 7, y: 0, r: 0.4 }, reach, engaged: false, los: true })).toBe('attack');
    expect(engageDecision({ self, target: { x: 7, y: 0, r: 0.4 }, reach, engaged: false, los: false })).toBe('approach');
    expect(engageDecision({ self, target: { x: 9.5, y: 0, r: 0.4 }, reach, engaged: false, los: true })).toBe('approach');
  });

  it('picks the front-most sprite under the cursor, else the nearest body near the ground point', () => {
    const es: PickableEnemy[] = [
      { i: 1, g: 0, x: 5, y: 5, r: 0.4, st: 'idle' },
      { i: 2, g: 0, x: 5.5, y: 5, r: 0.4, st: 'idle' },
      { i: 3, g: 0, x: 5.2, y: 5, r: 0.4, st: 'dying' },
    ];
    expect(pickEnemy(es, { x: 5.4, y: 5 }, null)?.i).toBe(2);
    expect(pickEnemy(es, { x: 9, y: 9 }, null)).toBeNull();
    expect(pickEnemy(es, { x: 9, y: 9 }, (e) => (e.i === 1 ? 10 : e.i === 3 ? 99 : null))?.i).toBe(1);
    expect(pickEnemy(es, null, null)).toBeNull();
  });

  it('finds doors by footprint and pickups / loot in screen space', () => {
    const P = (x: number, y: number) => ({ x: (x - y) * 32, y: (x + y) * 16 });
    const door = pickGround({ x: 10.2, y: 4.8 }, null, P, [], [], [{ x: 10.5, y: 5.5 }]);
    expect(door?.kind).toBe('door');
    const sp = P(3, 3);
    const loot = pickGround({ x: 3, y: 3 }, { x: sp.x, y: sp.y - 40 }, P, [], [{ x: 3, y: 3 }], []);
    expect(loot?.kind).toBe('loot');
    expect(pickGround({ x: 20, y: 20 }, P(20, 20), P, [{ x: 3, y: 3 }], [], [])).toBeNull();
  });

  it('only movement skills and stances stop a walk', () => {
    expect(skillStopsWalk('a_phase_step')).toBe(true);
    expect(skillStopsWalk('a_fireline')).toBe(false);
    expect(skillStopsWalk('')).toBe(false);
  });
});

// ---------------- controller ----------------

function frame(over: Partial<DriveFrame>): DriveFrame {
  return {
    now: 0, scheme: 'click', phase: 'COMBAT', blocked: false, life: 'alive', self: { x: 2.5, y: 2.5 }, buffs: [], tether: null,
    skills: ['', '', '', ''], map: null, enemies: [], reach: { ranged: false, range: 1.75 }, cursor: null, hoverEnemy: null, hoverGround: null,
    primary: false, primaryEdge: false, force: false, buttons: 0, pressed: 0, keyMove: { x: 0, y: 0 }, padAim: null, usingPad: false,
    assist: { autoAttack: false, aimAssist: false }, ...over,
  };
}

/** Drive the controller with a kinematic hero (4.6 tiles/s, wall sliding like the sim) for up to `secs`. */
function run(cm: ClickMove, map: GridMap & MapState, start: Pt, secs: number, per: (t: number, self: Pt) => Partial<DriveFrame>, stopWhen?: (self: Pt, out: ReturnType<ClickMove['update']>) => boolean) {
  const self = { ...start };
  let out = cm.update(frame({ map, self: { ...self }, now: 0, ...per(0, self) }));
  for (let t = 16; t <= secs * 1000; t += 16) {
    let mx = out.mx, my = out.my;
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    const r = moveCircle(map, self.x, self.y, mx * 4.6 * 0.016, my * 4.6 * 0.016, 0.3);
    self.x = r.x; self.y = r.y;
    out = cm.update(frame({ map, self: { ...self }, now: t, ...per(t, self) }));
    if (stopWhen?.(self, out)) break;
  }
  return { self, out };
}

describe('click-to-move controller', () => {
  it('walks to a clicked point and stops there', () => {
    const map = open(14, 10);
    const cm = new ClickMove();
    const { self, out } = run(cm, map, { x: 2.5, y: 2.5 }, 4, (t) => ({ primary: t === 0, primaryEdge: t === 0, cursor: { x: 10.5, y: 7 } }));
    expect(Math.hypot(self.x - 10.5, self.y - 7)).toBeLessThan(0.3);
    expect(cm.order).toBeNull();
    expect(out.mx).toBe(0);
    expect(cm.fx.some((e) => e.kind === 'move')).toBe(true);
  });

  it('walks around a wall instead of into it', () => {
    const map = grid([
      '##########',
      '#........#',
      '#....#...#',
      '#....#...#',
      '#....#...#',
      '#........#',
      '##########',
    ]);
    const cm = new ClickMove();
    const { self } = run(cm, map, { x: 2.5, y: 3.5 }, 6, (t) => ({ primary: t === 0, primaryEdge: t === 0, cursor: { x: 8.5, y: 3.5 } }));
    expect(Math.hypot(self.x - 8.5, self.y - 3.5)).toBeLessThan(0.3);
  });

  it('holding the button keeps walking after the cursor', () => {
    const map = open(20, 10);
    const cm = new ClickMove();
    const { self } = run(cm, map, { x: 2.5, y: 5 }, 3, (t, s) => ({ primary: true, primaryEdge: t === 0, cursor: { x: s.x + 3, y: 5 } }));
    expect(self.x).toBeGreaterThan(11);
    expect(cm.holdMode).toBe('walk');
  });

  it('attack-move closes to melee reach, then stands and swings at the target', () => {
    const map = open(16, 8);
    const cm = new ClickMove();
    const foe: PickableEnemy = { i: 7, g: 1, x: 11, y: 4, r: 0.4, st: 'idle' };
    const { self, out } = run(cm, map, { x: 2, y: 4 }, 4, (t) => ({
      primary: t === 0, primaryEdge: t === 0, enemies: [foe], cursor: { x: 11, y: 4 }, hoverEnemy: t === 0 ? foe : null,
    }), (_s, o) => (o.buttons & ACTION.ATTACK) !== 0);
    expect(out.buttons & ACTION.ATTACK).toBe(ACTION.ATTACK);
    expect(out.mx).toBe(0);
    expect(out.ax).toBeGreaterThan(0);
    const d = Math.hypot(foe.x - self.x, foe.y - self.y);
    expect(d).toBeLessThanOrEqual(1.75 + foe.r);
    expect(d).toBeGreaterThan(1);
    // the target falls: the order ends and the swing stops
    const after = cm.update(frame({ map, self, now: 9000, enemies: [{ ...foe, st: 'dying' }] }));
    expect(after.buttons & ACTION.ATTACK).toBe(0);
    expect(cm.order).toBeNull();
  });

  it('a ranged hero shoots from range instead of walking into melee', () => {
    const map = open(20, 8);
    const cm = new ClickMove();
    const foe: PickableEnemy = { i: 3, g: 0, x: 17, y: 4, r: 0.4, st: 'idle' };
    const { self, out } = run(cm, map, { x: 2, y: 4 }, 4, (t) => ({
      reach: { ranged: true, range: 10 }, primary: t === 0, primaryEdge: t === 0, enemies: [foe], cursor: { x: 17, y: 4 }, hoverEnemy: t === 0 ? foe : null,
    }), (_s, o) => (o.buttons & ACTION.ATTACK) !== 0);
    expect(out.buttons & ACTION.ATTACK).toBe(ACTION.ATTACK);
    expect(foe.x - self.x).toBeGreaterThan(6);
  });

  it('holding on after a kill takes the next foe under the cursor', () => {
    const map = open(16, 8);
    const cm = new ClickMove();
    const a: PickableEnemy = { i: 1, g: 0, x: 4, y: 4, r: 0.4, st: 'idle' };
    const b: PickableEnemy = { i: 2, g: 0, x: 6, y: 5, r: 0.4, st: 'idle' };
    cm.update(frame({ map, self: { x: 2.5, y: 4 }, primary: true, primaryEdge: true, enemies: [a, b], hoverEnemy: a, cursor: a }));
    expect(cm.target?.i).toBe(1);
    cm.update(frame({ map, self: { x: 2.5, y: 4 }, now: 100, primary: true, enemies: [{ ...a, st: 'dying' }, b], hoverEnemy: b, cursor: b }));
    expect(cm.target?.i).toBe(2);
    // nothing under the cursor: keep walking toward it
    cm.update(frame({ map, self: { x: 2.5, y: 4 }, now: 200, primary: true, enemies: [{ ...b, st: 'dying' }], hoverEnemy: null, cursor: { x: 12, y: 4 } }));
    expect(cm.holdMode).toBe('walk');
    expect(cm.order?.k).toBe('walk');
  });

  it('Shift + click attacks in place and never moves', () => {
    const map = open(10, 10);
    const cm = new ClickMove();
    const out = cm.update(frame({ map, primary: true, primaryEdge: true, force: true, cursor: { x: 7, y: 2.5 } }));
    expect(out.buttons & ACTION.ATTACK).toBe(ACTION.ATTACK);
    expect(out.mx).toBe(0);
    expect(out.my).toBe(0);
    expect(out.ax).toBeCloseTo(4.5);
    expect(cm.order).toBeNull();
  });

  it('skills aim at the cursor without cancelling the walk', () => {
    const map = open(14, 10);
    const cm = new ClickMove();
    cm.update(frame({ map, primary: true, primaryEdge: true, cursor: { x: 10, y: 2.5 } }));
    const out = cm.update(frame({ map, now: 16, buttons: ACTION.SKILL1, pressed: ACTION.SKILL1, skills: ['a_fireline', '', '', ''], cursor: { x: 2.5, y: 8 } }));
    expect(out.buttons & ACTION.SKILL1).toBe(ACTION.SKILL1);
    expect(out.mx).toBeGreaterThan(0);
    expect(out.ay).toBeCloseTo(5.5);
    expect(cm.order?.k).toBe('walk');
    // a teleport ends the walk
    cm.update(frame({ map, now: 32, buttons: ACTION.SKILL2, pressed: ACTION.SKILL2, skills: ['a_fireline', 'a_phase_step', '', ''], cursor: { x: 2.5, y: 8 } }));
    expect(cm.order).toBeNull();
  });

  it('dodges toward the cursor', () => {
    const map = open(14, 10);
    const cm = new ClickMove();
    const out = cm.update(frame({ map, buttons: ACTION.DODGE, pressed: ACTION.DODGE, cursor: { x: 2.5, y: 8 } }));
    expect(out.buttons & ACTION.DODGE).toBe(ACTION.DODGE);
    expect(out.my).toBeCloseTo(1);
  });

  it('voting is walk-only: a click on a foe walks there, no attacks or casts', () => {
    const map = open(14, 10);
    const cm = new ClickMove();
    const foe: PickableEnemy = { i: 1, g: 0, x: 8, y: 2.5, r: 0.4, st: 'idle' };
    const out = cm.update(frame({ map, phase: 'VOTING', primary: true, primaryEdge: true, enemies: [foe], hoverEnemy: foe, cursor: { x: 8, y: 2.5 }, buttons: ACTION.SKILL1 | ACTION.DODGE }));
    expect(cm.order?.k).toBe('walk');
    expect(out.mx).toBeGreaterThan(0);
    expect(out.buttons).toBe(ACTION.DODGE);
  });

  it('cinematics, setup phases, open panels and downed heroes send neutral input', () => {
    const map = open(14, 10);
    for (const over of [{ blocked: true }, { phase: 'ROUND_SETUP' }, { phase: 'FATE_COMMIT' }, { life: 'downed' as const }]) {
      const cm = new ClickMove();
      const out = cm.update(frame({ map, primary: true, primaryEdge: true, cursor: { x: 9, y: 5 }, buttons: ACTION.SKILL1, ...over }));
      expect(out).toEqual({ mx: 0, my: 0, ax: 0, ay: 0, buttons: 0 });
      expect(cm.order).toBeNull();
    }
  });

  it('pauses (without giving up) while rooted, and clamps goals inside a chain tether', () => {
    const map = open(20, 10);
    const cm = new ClickMove();
    cm.update(frame({ map, primary: true, primaryEdge: true, cursor: { x: 15, y: 2.5 } }));
    let out = cm.update(frame({ map, now: 16, buffs: ['rooted'] }));
    for (let t = 32; t < 2000; t += 16) out = cm.update(frame({ map, now: t, buffs: ['rooted'] }));
    expect(out.mx).toBe(0);
    expect(cm.order?.k).toBe('walk');
    const chained = new ClickMove();
    chained.update(frame({ map, buffs: ['chained'], tether: [2.5, 2.5, 3], primary: true, primaryEdge: true, cursor: { x: 15, y: 2.5 } }));
    expect(chained.order?.k).toBe('walk');
    const o = chained.order as { x: number; y: number };
    expect(Math.hypot(o.x - 2.5, o.y - 2.5)).toBeLessThanOrEqual(3);
  });

  it('gives up after a few re-paths when blocked in place', () => {
    const map = open(20, 10);
    const cm = new ClickMove();
    cm.update(frame({ map, primary: true, primaryEdge: true, cursor: { x: 15, y: 2.5 } }));
    let t = 16;
    for (; t < 5000 && cm.order; t += 16) cm.update(frame({ map, now: t }));   // the hero never moves
    expect(cm.order).toBeNull();
    expect(t).toBeLessThan(3000);
  });

  it('direct movement keys override click orders; UI move-to requests walk', () => {
    const map = open(20, 10);
    const cm = new ClickMove();
    cm.moveTo(12, 6);
    let out = cm.update(frame({ map }));
    expect(cm.order?.k).toBe('walk');
    expect(cm.fx[cm.fx.length - 1]?.ui).toBe(true);
    expect(out.mx).toBeGreaterThan(0);
    out = cm.update(frame({ map, now: 16, keyMove: { x: 0, y: -1 } }));
    expect(cm.order).toBeNull();
    expect(out.my).toBe(-1);
  });

  it('keeps the WASD scheme: the hero faces the cursor and clicks do not walk', () => {
    const map = open(14, 10);
    const cm = new ClickMove();
    const out = cm.update(frame({ map, scheme: 'wasd', primary: true, primaryEdge: true, buttons: ACTION.ATTACK, cursor: { x: 6.5, y: 2.5 } }));
    expect(cm.order).toBeNull();
    expect(out.buttons & ACTION.ATTACK).toBe(ACTION.ATTACK);
    expect(out.ax).toBeCloseTo(4);
    expect(out.mx).toBe(0);
  });
});

describe('click-to-move on generated dungeons', () => {
  const maps = [generateMap('click-a', 1, false), generateMap('click-b', 3, false), generateMap('click-c', 5, true), generateMap('click-d', 7, false)];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const floorPoint = (m: MapState): Pt => {
    for (;;) {
      const x = Math.floor(rnd() * m.w), y = Math.floor(rnd() * m.h);
      if (m.tiles[y * m.w + x] !== 1 && circleFree(m, x + 0.5, y + 0.5, BODY_RADIUS)) return { x: x + 0.5, y: y + 0.5 };
    }
  };

  it('every smoothed leg is walkable by the hero body', () => {
    for (const m of maps) {
      for (let n = 0; n < 40; n++) {
        const a = floorPoint(m), b = floorPoint(m);
        const res = findPathEx(m, a.x, a.y, b.x, b.y);
        let p = a;
        for (const q of res.points) { expect(lineClear(m, p.x, p.y, q.x, q.y, BODY_RADIUS)).toBe(true); p = q; }
        if (res.points.length) expect(res.points[res.points.length - 1]).toEqual(res.goal);
      }
    }
  });

  it('the controller walks the real collision to clicked floor without getting stuck', () => {
    for (const m of maps) {
      for (let n = 0; n < 6; n++) {
        const a = floorPoint(m), b = floorPoint(m);
        const res = findPathEx(m, a.x, a.y, b.x, b.y);
        if (!res.reached) continue;
        const cm = new ClickMove();
        const { self } = run(cm, m, a, 40, (t) => ({ primary: t === 0, primaryEdge: t === 0, cursor: b }), () => !cm.order);
        expect(Math.hypot(self.x - b.x, self.y - b.y)).toBeLessThan(0.35);
      }
    }
  });
});
