import { describe, expect, it } from 'vitest';
import { CLASS_BY_ID, DODGE, RULES } from '@cursebound/content';
import { ACTION, predictMoveTick, type MapState, type MoveBody } from '@cursebound/simulation';
import { animFor } from '../apps/client/src/game/art/actors';
import { VIEW_ANGLE, type View } from '../apps/client/src/game/art/draw/rig';
import { CLICK, ClickMove, InputTicks, STALL_MS, TICK_MS, type DriveFrame, type DriveOut } from '../apps/client/src/game/input/ClickMove';
import type { GridMap, Pt } from '../apps/client/src/game/input/path';
import { iso } from '../apps/client/src/game/render/iso';
import { GameConnection } from '../apps/client/src/lib/net';

// Hero movement feel end to end on the client: the sprite facing for a heading, a click that walks to its point on
// the locked camera, frames turned into input ticks (no double-sent stalls, one steering decision per tick), and the
// prediction replaying exactly what the authority will do.

function open(w: number, h: number): GridMap & MapState {
  const tiles: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) tiles.push(x === 0 || y === 0 || x === w - 1 || y === h - 1 ? 1 : 0);
  return { w, h, tiles, topology: 'test', playerSpawns: [], enemySpawns: [], fallback: false, decorSeed: 0, theme: 'crypt', layout: 'test' };
}

function frame(over: Partial<DriveFrame>): DriveFrame {
  return {
    now: 0, scheme: 'click', phase: 'COMBAT', blocked: false, life: 'alive', self: { x: 2.5, y: 2.5 }, buffs: [], tether: null,
    skills: ['', '', '', ''], map: null, enemies: [], reach: { ranged: false, range: 1.75 }, cursor: null, pointer: null, hoverEnemy: null, hoverGround: null,
    primary: false, primaryEdge: false, force: false, buttons: 0, pressed: 0, keyMove: { x: 0, y: 0 }, padAim: null, usingPad: false,
    assist: { autoAttack: false, aimAssist: false }, ...over,
  };
}

/** The Vanguard's ground speed with the global hero multiplier (what the snapshot's `spd` carries). */
const SPEED = CLASS_BY_ID.vanguard.base.moveSpeed * Number(RULES.playerMoveSpeedMult);
const body = (x: number, y: number): MoveBody => ({ x, y, vx: 0, vy: 0, dodgeTimer: 0, dodgeDirX: 1, dodgeDirY: 0, dodgeCharges: DODGE.charges, dodgeCooldown: 0, surgeTimer: 0, guardTimer: 0 });
const deg = (a: number) => (a * Math.PI) / 180;

describe('hero facing', () => {
  it('bins a heading on the ground plane: each sprite direction owns 45° of world heading', () => {
    // world axes are screen diagonals, world diagonals are screen axes (render/iso.ts)
    expect(iso.facing8(1, 0)).toBe(1);    // world east  -> screen down-right
    expect(iso.facing8(0, 1)).toBe(3);    // world south -> screen down-left
    expect(iso.facing8(-1, 0)).toBe(5);
    expect(iso.facing8(0, -1)).toBe(7);
    expect(iso.facing8(1, -1)).toBe(0);   // screen right
    expect(iso.facing8(1, 1)).toBe(2);    // screen down
    expect(iso.facing8(-1, 1)).toBe(4);
    expect(iso.facing8(-1, -1)).toBe(6);
    // sweep: the nearest of the eight is always picked, so no heading is ever more than 22.5° from its sprite
    for (let a = -180; a < 180; a += 1.7) {
      const want = (((Math.round(a / 45) + 1) % 8) + 8) % 8;
      expect(iso.facing8(Math.cos(deg(a)), Math.sin(deg(a)))).toBe(want);
    }
    // walking a few degrees off a world axis (a corridor) keeps the diagonal sprite; binning the squashed screen
    // vector flipped it to the side-on sprite at 11°
    expect(iso.facing8(Math.cos(deg(-12)), Math.sin(deg(-12)))).toBe(1);
    expect(iso.facing8(Math.cos(deg(170)), Math.sin(deg(170)))).toBe(5);
  });

  it('picks the sprite whose posed facing is nearest the heading as drawn on screen', () => {
    // the rig poses a view at ground angle VIEW_ANGLE (mirrored for the west half) and squashes it 2:1 like the
    // floor; a heading's screen direction is iso.dir. The chosen sprite must be the one closest on the ground.
    const views = Object.keys(VIEW_ANGLE) as View[];
    for (let a = -180; a < 180; a += 3.1) {
      const wx = Math.cos(deg(a)), wy = Math.sin(deg(a));
      const s = iso.dir(wx, wy);
      const ground = Math.atan2(s.y / 0.5, s.x);                      // undo the 2:1 squash
      let best = Infinity;
      for (const v of views) for (const flip of [false, true]) {
        const va = flip ? Math.PI - VIEW_ANGLE[v] : VIEW_ANGLE[v];
        const d = Math.abs(Math.atan2(Math.sin(ground - va), Math.cos(ground - va)));
        best = Math.min(best, d);
      }
      const pick = animFor('vanguard', 'run', iso.facing8(wx, wy));
      const view = pick.key.split(':')[2] as View;
      const va = pick.flipX ? Math.PI - VIEW_ANGLE[view] : VIEW_ANGLE[view];
      const d = Math.abs(Math.atan2(Math.sin(ground - va), Math.cos(ground - va)));
      expect(d).toBeLessThanOrEqual(best + 1e-9);
      expect(d).toBeLessThanOrEqual(deg(22.5) + 1e-9);
    }
  });
});

/**
 * Drive the controller like the scene does on the locked play camera: the view is centred on the drawn hero (the
 * prediction, smoothed), so the ground under a pointer resting on screen is the drawn hero plus a fixed offset.
 */
function lockedCamera(holdMs: number, offset: Pt, secs = 3) {
  const map = open(40, 40);
  const b = body(20, 20);
  const drawn = { x: b.x, y: b.y };
  const cm = new ClickMove();
  const clicked = { x: drawn.x + offset.x, y: drawn.y + offset.y };
  const pointer = { x: 360, y: 200 };                                // resting on screen
  const dist = Math.hypot(offset.x, offset.y);
  let maxPast = -Infinity;
  for (let now = 0; now <= secs * 1000; now += 1000 / 60) {
    const cursor = { x: drawn.x + offset.x, y: drawn.y + offset.y };
    const out = cm.update(frame({ map, now, self: { x: b.x, y: b.y }, cursor, pointer, primary: now < holdMs, primaryEdge: now === 0 }));
    predictMoveTick(map, b, out.mx, out.my, out.ax, out.ay, false, SPEED, 'vanguard', 1);   // 60 fps: one tick a frame
    const k = Math.min(1, (1000 / 60) / 45);                          // CombatScene's render smoothing
    drawn.x += (b.x - drawn.x) * k; drawn.y += (b.y - drawn.y) * k;
    maxPast = Math.max(maxPast, ((b.x - 20) * offset.x + (b.y - 20) * offset.y) / dist - dist);
  }
  return { end: { x: b.x, y: b.y }, clicked, maxPast };
}

describe('click-to-move on the locked camera', () => {
  it('a click walks to the clicked point even while the button stays down for a moment', () => {
    for (const holdMs of [16, 120, 200]) {
      for (const offset of [{ x: 2.5, y: 0 }, { x: -1.2, y: 2.1 }, { x: 0.8, y: -0.9 }]) {
        const r = lockedCamera(holdMs, offset);
        // the ground under the still pointer slid along with the hero; the walk keeps the point that was clicked
        expect(Math.hypot(r.end.x - r.clicked.x, r.end.y - r.clicked.y)).toBeLessThan(CLICK.arriveTol + 0.05);
        expect(r.maxPast).toBeLessThan(0.02);
      }
    }
  });

  it('a press held past CLICK.holdMs walks on after the cursor', () => {
    const r = lockedCamera(1500, { x: 1.5, y: 0 });
    expect(r.end.x - r.clicked.x).toBeGreaterThan(3);
    expect(Math.abs(r.end.y - r.clicked.y)).toBeLessThan(0.05);
  });

  it('dragging the pointer during a press steers after the cursor straight away', () => {
    const map = open(40, 40);
    const cm = new ClickMove();
    cm.update(frame({ map, now: 0, self: { x: 20, y: 20 }, cursor: { x: 23, y: 20 }, pointer: { x: 300, y: 200 }, primary: true, primaryEdge: true }));
    // a pointer that rests (the ground under it slides with the camera) keeps the clicked point
    cm.update(frame({ map, now: 50, self: { x: 20.2, y: 20 }, cursor: { x: 23.2, y: 20 }, pointer: { x: 301, y: 200 }, primary: true }));
    expect(cm.order).toMatchObject({ k: 'walk', x: 23, y: 20 });
    // a deliberate drag on screen is steering
    cm.update(frame({ map, now: 80, self: { x: 20.3, y: 20 }, cursor: { x: 20.3, y: 24 }, pointer: { x: 300, y: 260 }, primary: true }));
    expect(cm.order).toMatchObject({ k: 'walk', x: 20.3, y: 24 });
  });
});

describe('frames to input ticks', () => {
  /** ticks InputTicks hands out for a run of frame durations (ms) */
  function ticksFor(frames: number[]) {
    const t = new InputTicks(), cm = new ClickMove();
    let now = 0, sent = 0;
    const per: number[] = [];
    t.run(now, cm, frame({}), () => null);   // first frame: one tick
    for (const dt of frames) {
      now += dt;
      const n = t.run(now, cm, frame({ now }), () => { sent++; return null; });
      per.push(n);
    }
    return { per, sent };
  }

  it('keeps a 60 Hz input stream at any ordinary frame rate', () => {
    for (const fps of [144, 120, 60, 30, 24]) {
      const { sent } = ticksFor(new Array(fps * 2).fill(1000 / fps));
      expect(Math.abs(sent - 120)).toBeLessThanOrEqual(1);
    }
    expect(ticksFor(new Array(10).fill(1000 / 30)).per.every((n) => n === 2)).toBe(true);
  });

  it('never sends a stall late: the authority already held the last input through it', () => {
    const r = ticksFor([1000 / 60, 1000 / 60, 150, 1000 / 60, 1000 / 60, 1000 / 60]);
    expect(r.per[2]).toBe(1);
    // and the frames after it are not padded with the stall's ticks either (Phaser's smoothed delta did that)
    expect(r.per.slice(3)).toEqual([1, 1, 1]);
    expect(STALL_MS).toBeGreaterThan(1000 / 24);
  });

  it('decides every tick of a slow frame from the prediction, so it never walks past a clicked point', () => {
    for (const ticksPerFrame of [1, 2, 3]) {
      for (const dist of [0.5, 1.03, 2.37, 5.11]) {
        const map = open(40, 40);
        const b = body(20, 20);
        const cm = new ClickMove(), t = new InputTicks();
        const goal = { x: 20 + dist, y: 20 };
        let maxPast = -Infinity;
        for (let f = 0, now = 0; f < 200; f++, now += ticksPerFrame * TICK_MS) {
          t.run(now, cm, frame({ map, now, self: { x: b.x, y: b.y }, cursor: goal, primary: f === 0, primaryEdge: f === 0 }), (out) => {
            predictMoveTick(map, b, out.mx, out.my, out.ax, out.ay, false, SPEED, 'vanguard', 1);
            maxPast = Math.max(maxPast, b.x - goal.x);
            return { x: b.x, y: b.y };
          });
        }
        expect(maxPast).toBeLessThanOrEqual(0);
        expect(goal.x - b.x).toBeLessThan(CLICK.arriveTol);
      }
    }
  });

  it('a dodge pressed on a frame that carries no tick still goes toward the cursor', () => {
    const map = open(20, 20);
    const t = new InputTicks(), cm = new ClickMove();
    const sent: DriveOut[] = [];
    const send = (o: DriveOut) => { sent.push(o); return null; };
    const at = { x: 10, y: 10 };
    t.run(0, cm, frame({ map, self: at }), send);
    // 144 Hz: this frame is too short to carry a tick; Space goes down on it, cursor straight south of the hero
    const press = frame({ map, now: 7, self: at, cursor: { x: 10, y: 14 }, buttons: ACTION.DODGE, pressed: ACTION.DODGE });
    expect(t.run(7, cm, press, send)).toBe(0);
    // next frame: still held, no longer a fresh press in the sample
    expect(t.run(17, cm, frame({ map, now: 17, self: at, cursor: { x: 10, y: 14 }, buttons: ACTION.DODGE }), send)).toBe(1);
    const out = sent[sent.length - 1];
    expect(out.buttons & ACTION.DODGE).toBe(ACTION.DODGE);
    expect(out.my).toBeCloseTo(1);
    expect(out.mx).toBeCloseTo(0);
  });
});

describe('prediction and reconciliation', () => {
  /** a server message delivered as if it came over the socket */
  const deliver = (c: GameConnection, m: unknown) => (c as unknown as { onMessage(m: unknown): void }).onMessage(m);

  /** A snapshot of one hero (slot 0) as the authority sends it (simulation snapshot.ts field names). */
  function snap(tick: number, b: MoveBody, aim: Pt) {
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    return {
      tick, phase: 'COMBAT', round: 1, stateVersion: 1, enemies: [], projectiles: [], hazards: [], pickups: [], telegraphs: [],
      players: [{
        s: 0, n: 'Ivy', c: 'vanguard', x: r3(b.x), y: r3(b.y), vx: r3(b.vx), vy: r3(b.vy), ax: aim.x, ay: aim.y, f: 0, life: 'alive', anim: 'idle',
        spd: SPEED, dt: r3(b.dodgeTimer), ddx: r3(b.dodgeDirX), ddy: r3(b.dodgeDirY), dcd: r3(b.dodgeCooldown), dc: b.dodgeCharges, dcm: DODGE.charges,
        sg: r3(b.surgeTimer), rr: 1, guard: b.guardTimer > 0, buffs: [], cd: [],
      }],
    };
  }

  it('replays the post-dash surge from the authority, so the prediction matches it tick for tick', () => {
    const map = open(60, 20);
    const c = new GameConnection('room', 'tok');
    c.map = map;
    const auth = body(5, 10);
    const aim = { x: 1, y: 0 };
    deliver(c, { t: 'SNAPSHOT', ack: 0, snap: snap(0, auth, aim) });
    // inputs reach the authority 4 ticks after they are sent; it snapshots every 3 ticks
    const LAG = 4;
    const sent: { seq: number; mx: number; my: number; dodge: boolean }[] = [];
    let applied = 0, prevDodge = false, worst = 0;
    for (let tick = 1; tick <= 150; tick++) {
      const dodge = tick === 20 || tick === 60;                      // two dashes, each followed by a surge
      c.sendInput(1, 0.2, 2, 0, dodge ? ACTION.DODGE : 0);
      sent.push({ seq: tick, mx: 1, my: Math.round(0.2 * 127) / 127, dodge });
      if (tick > LAG) {
        const inp = sent[applied++];
        predictMoveTick(map, auth, inp.mx, inp.my, 2, 0, inp.dodge && !prevDodge, SPEED, 'vanguard', 1);
        prevDodge = inp.dodge;
      }
      if (tick % 3 === 0) {
        deliver(c, { t: 'SNAPSHOT', ack: applied, snap: snap(tick, auth, aim) });
        // where the authority will be once it has every input sent so far
        const truth = { ...auth };
        let pd = prevDodge;
        for (const inp of sent.slice(applied)) { predictMoveTick(map, truth, inp.mx, inp.my, 2, 0, inp.dodge && !pd, SPEED, 'vanguard', 1); pd = inp.dodge; }
        worst = Math.max(worst, Math.hypot(c.pred.x - truth.x, c.pred.y - truth.y));
      }
    }
    // only the snapshot's 3-decimal rounding separates them
    expect(worst).toBeLessThan(0.01);
    expect(auth.x).toBeGreaterThan(10);
  });

  it('faces the aim it just sent, not the snapshot aim that trails it', () => {
    const c = new GameConnection('room', 'tok');
    c.map = open(20, 20);
    const b = body(5, 5);
    deliver(c, { t: 'SNAPSHOT', ack: 0, snap: snap(0, b, { x: 1, y: 0 }) });
    expect([c.pred.ax, c.pred.ay]).toEqual([1, 0]);
    c.sendInput(0, 1, 0, 2, 0);                                      // walking south: aim along the walk
    expect([c.pred.ax, c.pred.ay]).toEqual([0, 2]);
    deliver(c, { t: 'SNAPSHOT', ack: 0, snap: snap(3, b, { x: 1, y: 0 }) });    // the authority has not seen it yet
    expect([c.pred.ax, c.pred.ay]).toEqual([0, 2]);
    c.sendInput(0, 0, 0, 0, 0);                                      // standing still keeps the facing (as the authority does)
    expect([c.pred.ax, c.pred.ay]).toEqual([0, 2]);
    // a new round starts the prediction over from the authority's aim
    deliver(c, { t: 'PHASE', data: { phase: 'ROUND_SETUP', map: null } });
    deliver(c, { t: 'SNAPSHOT', ack: 0, snap: snap(9, b, { x: -1, y: 0 }) });
    expect([c.pred.ax, c.pred.ay]).toEqual([-1, 0]);
  });
});
