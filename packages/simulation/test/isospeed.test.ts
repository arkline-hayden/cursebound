import { describe, expect, it } from 'vitest';
import { DODGE, ENEMY_BY_ID, RULES, TICK_SEC } from '@cursebound/content';
import {
  ACTION, devSpawn, isoDot, isoSpeedScale, moveSpeedOf, predictMoveTick, setupRound, step,
  type EnemyState, type MoveBody, type PlayerInput, type SimState,
} from '@cursebound/simulation';
import { newRun } from './run.helpers';

// Screen-uniform hero speed (playtest: "movement is slower in every direction but left / right"). The 2:1 isometric
// view draws a world unit 64 px wide but only 32 px tall, so a constant ground speed crawled up and down the screen.
// The shared movement step (authority and prediction) scales walking and dashing by direction so the hero covers
// the same screen pixels per second whichever way it goes, as fast as it already went sideways.

/** The client projection (apps/client/src/game/render/iso.ts: HW 32, HH 16) of a world vector, in screen px. */
const screen = (dx: number, dy: number) => ({ x: (dx - dy) * 32, y: (dx + dy) * 16 });
const slen = (dx: number, dy: number) => { const s = screen(dx, dy); return Math.hypot(s.x, s.y); };
/** world unit direction for a screen angle (degrees, y down) */
const worldFor = (deg: number) => {
  const a = (deg * Math.PI) / 180, sx = Math.cos(a), sy = Math.sin(a);
  const wx = (sx / 32 + sy / 16) / 2, wy = (sy / 16 - sx / 32) / 2, l = Math.hypot(wx, wy);
  return { x: wx / l, y: wy / l };
};
const SPEED = 4.6 * Number(RULES.playerMoveSpeedMult);
/** what walking sideways (screen left / right) has always covered: the speed along world (1, -1) / sqrt(2) */
const SIDEWAYS_PX = SPEED * slen(Math.SQRT1_2, -Math.SQRT1_2);
const body = (dx = 1, dy = 0): MoveBody => ({ x: 0, y: 0, vx: 0, vy: 0, dodgeTimer: 0, dodgeDirX: dx, dodgeDirY: dy, dodgeCharges: DODGE.charges, dodgeCooldown: 0, surgeTimer: 0, guardTimer: 0 });
const ANGLES = Array.from({ length: 16 }, (_, i) => i * 22.5);

describe('isoSpeedScale', () => {
  it('is 1 sideways on screen, 2 straight up / down, sqrt(1.6) along a world axis, never below 1', () => {
    expect(isoSpeedScale(1, -1)).toBeCloseTo(1, 12);
    expect(isoSpeedScale(-3, 3)).toBeCloseTo(1, 12);
    expect(isoSpeedScale(1, 1)).toBeCloseTo(2, 12);
    expect(isoSpeedScale(-0.2, -0.2)).toBeCloseTo(2, 12);
    expect(isoSpeedScale(1, 0)).toBeCloseTo(Math.sqrt(1.6), 12);
    expect(isoSpeedScale(0, -1)).toBeCloseTo(Math.sqrt(1.6), 12);
    expect(isoSpeedScale(0, 0)).toBe(1);
    for (let a = 0; a < 360; a += 7.3) {
      const r = (a * Math.PI) / 180, k = isoSpeedScale(Math.cos(r), Math.sin(r));
      expect(k).toBeGreaterThanOrEqual(1 - 1e-12);
      expect(k).toBeLessThanOrEqual(2 + 1e-12);
      // the scaled unit step always projects to the sideways length on screen
      expect(slen(Math.cos(r) * k, Math.sin(r) * k)).toBeCloseTo(slen(Math.SQRT1_2, -Math.SQRT1_2), 9);
      // isoDot measures on screen: a scaled velocity's screen size is the plain speed
      expect(isoDot(Math.cos(r) * k, Math.sin(r) * k, Math.cos(r) * k, Math.sin(r) * k)).toBeCloseTo(1, 9);
    }
  });
});

describe('screen-uniform walking and dashing (shared movement step)', () => {
  it('walks at the same on-screen speed in 16 screen directions, as fast as sideways always was', () => {
    for (const deg of ANGLES) {
      const d = worldFor(deg);
      const b = body();
      for (let i = 0; i < 60; i++) predictMoveTick(null, b, d.x, d.y, d.x, d.y, false, SPEED, 'vanguard', 1);
      expect(slen(b.vx, b.vy) / SIDEWAYS_PX, `${deg}°`).toBeCloseTo(1, 6);
      // still heading where it was asked to go
      expect(Math.abs(Math.atan2(b.vy, b.vx) - Math.atan2(d.y, d.x)) % (2 * Math.PI)).toBeLessThan(1e-9);
    }
    // sideways is untouched; straight up the screen covers twice the ground it used to (same pixels as sideways)
    const side = body(), up = body();
    for (let i = 0; i < 60; i++) {
      predictMoveTick(null, side, 1, -1, 1, -1, false, SPEED, 'vanguard', 1);
      predictMoveTick(null, up, -1, -1, -1, -1, false, SPEED, 'vanguard', 1);
    }
    expect(Math.hypot(side.vx, side.vy)).toBeCloseTo(SPEED, 9);
    expect(Math.hypot(up.vx, up.vy)).toBeCloseTo(SPEED * 2, 9);
  });

  it('keeps momentum turns as quick in every direction (the blend compares speeds as drawn)', () => {
    // a turn from straight up to sideways is not a slow-down on screen: it takes the acceleration blend
    const turn = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const b = body();
      for (let i = 0; i < 60; i++) predictMoveTick(null, b, from.x, from.y, 0, 0, false, SPEED, 'vanguard', 1);
      let n = 0;
      while (n < 60) { predictMoveTick(null, b, to.x, to.y, 0, 0, false, SPEED, 'vanguard', 1); n++; if (b.vx === to.x * SPEED * isoSpeedScale(to.x, to.y) && b.vy === to.y * SPEED * isoSpeedScale(to.x, to.y)) break; }
      return n;
    };
    const up = worldFor(270), right = worldFor(0), down = worldFor(90);
    expect(turn(up, right)).toBe(turn(right, up));
    expect(turn(down, right)).toBe(turn(right, down));
  });

  it('dashes cover the same screen distance in 8 directions (sideways as long as before)', () => {
    const dist: number[] = [];
    for (let k = 0; k < 8; k++) {
      const d = worldFor(k * 45);
      const b = body(d.x, d.y);
      let sx = 0, sy = 0;
      predictMoveTick(null, b, d.x, d.y, d.x, d.y, true, SPEED, 'vanguard', 1);
      sx += b.vx * TICK_SEC; sy += b.vy * TICK_SEC;
      while (b.dodgeTimer > 0) { predictMoveTick(null, b, 0, 0, d.x, d.y, false, SPEED, 'vanguard', 1); if (b.dodgeTimer > 0) { sx += b.vx * TICK_SEC; sy += b.vy * TICK_SEC; } }
      dist.push(slen(sx, sy));
    }
    for (const d of dist) expect(d / dist[0]).toBeCloseTo(1, 6);
    // sideways (factor 1): the dash's ground travel is what it always was
    expect(dist[0] / slen(Math.SQRT1_2, -Math.SQRT1_2)).toBeGreaterThan(DODGE.travel * 0.9);
    expect(dist[0] / slen(Math.SQRT1_2, -Math.SQRT1_2)).toBeLessThan(DODGE.travel * 1.35);
  });
});

/** A combat round with one inert, far-away objective so the round stays open. */
function arena(seed: string): SimState {
  const s = newRun(['vanguard'], seed);
  s.round = 4;
  setupRound(s, []);
  s.phase = 'COMBAT';
  const enc = s.encounter!;
  enc.groups = [{ id: 99, weight: 1, archetype: 'guardian', wave: 0, spawned: true, defeated: false, countText: '1' }];
  enc.wave = 0; enc.waveCount = 1; enc.objectiveTotal = 1;
  const p = s.players[0];
  let far = s.map!.enemySpawns[0];
  for (const sp of s.map!.enemySpawns) if ((sp.x - p.x) ** 2 + (sp.y - p.y) ** 2 > (far.x - p.x) ** 2 + (far.y - p.y) ** 2) far = sp;
  const anchor = devSpawn(s, 'guardian', far.x, far.y);
  anchor.objective = true; anchor.groupId = 99;
  inert(anchor);
  return s;
}
function inert(e: EnemyState) {
  for (const a of ENEMY_BY_ID[e.kind].attacks) e.cooldowns[a.id] = 9999;
  e.moveSpeed = 0;
}

describe('authority and prediction agree on the scaled movement', () => {
  it('replays screen-vertical, grid-diagonal and dash inputs tick for tick (walls included)', () => {
    const s = arena('ISO_PRED');
    const p = s.players[0];
    const b: MoveBody = { x: p.x, y: p.y, vx: p.vx, vy: p.vy, dodgeTimer: p.dodgeTimer, dodgeDirX: p.dodgeDirX, dodgeDirY: p.dodgeDirY, dodgeCharges: p.dodgeCharges, dodgeCooldown: p.dodgeCooldown, surgeTimer: p.surgeTimer, guardTimer: 0 };
    // straight up the screen, W+D (world north), straight down, A+S (world south), screen right, a sweep, with dashes
    const dirs: [number, number][] = [[-1, -1], [0, -1], [1, 1], [0, 1], [1, -1], [-1, 0], [1, 0]];
    let prev = false, ticks = 0, vertical = 0;
    for (let i = 0; i < 420; i++) {
      const [ux, uy] = i < 350 ? dirs[Math.floor(i / 50)] : [Math.cos(i * 0.09), Math.sin(i * 0.09)];
      const l = Math.hypot(ux, uy);
      const mx = Math.round((ux / l) * 127) / 127, my = Math.round((uy / l) * 127) / 127;   // the wire's quantization
      const dodge = i % 50 === 20;
      predictMoveTick(s.map, b, mx, my, 1, 0, dodge && !prev, moveSpeedOf(s, p), p.classId, 1);
      prev = dodge;
      const input: PlayerInput = { seq: i + 1, moveX: mx, moveY: my, aimX: 1, aimY: 0, buttons: dodge ? ACTION.DODGE : 0 };
      for (const e of s.enemies) if (e.state !== 'dying') inert(e);
      const ox = p.x, oy = p.y;
      step(s, [input]);
      if (s.phase !== 'COMBAT') break;
      expect(b.x).toBe(p.x);
      expect(b.y).toBe(p.y);
      expect(b.dodgeCharges).toBe(p.dodgeCharges);
      ticks++;
      if (i < 50 && Math.hypot(p.x - ox, p.y - oy) > 0) vertical = Math.max(vertical, Math.hypot(p.x - ox, p.y - oy));
    }
    expect(ticks).toBeGreaterThan(300);
    // the authority really walked the scaled speed straight up the screen (twice the ground of sideways, less walls)
    expect(vertical).toBeGreaterThan(moveSpeedOf(s, p) * TICK_SEC * 1.5);
  });
});
