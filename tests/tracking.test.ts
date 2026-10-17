import { describe, expect, it } from 'vitest';
import { LIMITS, type ServerMessage } from '@cursebound/protocol';
import { ACTION, predictMoveTick, type MoveBody } from '@cursebound/simulation';
import { DODGE } from '@cursebound/content';
import { RunAuthority, type SeatLink } from '../apps/server/src/authority';
import type { Store } from '../apps/server/src/persistence/store';
import { CLICK, ClickMove, type DriveFrame } from '../apps/client/src/game/input/ClickMove';
import { iso } from '../apps/client/src/game/render/iso';
import { CAM_LIFT, SELF_VIEW, SelfView, lockedScroll } from '../apps/client/src/game/selfView';
import { GameConnection } from '../apps/client/src/lib/net';
import {
  HERO_SCREEN, SPEED, VIEW_H, VIEW_W, combatState, headingError, judder, openMap, quietLog, screenJitter, track, type TrackOpts,
} from './tracking.harness';

// Movement tracking end to end (tests/tracking.harness.ts drives the real client against the real authority over a
// simulated network): the hero sprite holds its pixel under the locked camera, glides evenly at any frame pacing,
// steers straight at a held cursor, and reconciliation stays quiet through network jitter and frame stalls.

const OPEN = { map: openMap(80, 80), start: { x: 40, y: 40 } };
/** hold the button and sweep the pointer round the hero (one turn every 2 s) */
const circles: TrackOpts['pointer'] = (t) => {
  const a = (t / 2000) * Math.PI * 2;
  return { x: HERO_SCREEN.x + Math.cos(a) * 110, y: HERO_SCREEN.y + Math.sin(a) * 70, down: true };
};
/** hold the button with the pointer resting down-right of the hero: a straight walk */
const straight: TrackOpts['pointer'] = () => ({ x: HERO_SCREEN.x + 100, y: HERO_SCREEN.y + 50, down: true });
const NETS = [{ rttMs: 0, jitterMs: 0 }, { rttMs: 50, jitterMs: 10 }, { rttMs: 120, jitterMs: 30 }];
const PACINGS = [60, 144, 'uneven'] as const;

describe('locked camera', () => {
  it('puts the hero on the same screen pixel every frame (no shimmer against the floor while walking)', () => {
    for (const net of NETS) {
      for (const fps of PACINGS) {
        const r = track({ ...net, fps, secs: 4, ...OPEN, pointer: circles });
        const j = screenJitter(r.frames);
        // a camera on the unrounded point (floored by Phaser) against the rounded sprite: 1 px off ~45 times a second
        expect(j.maxOff).toBe(0);
        expect(j.movesPerSec).toBe(0);
      }
    }
  });

  it('scrolls in whole pixels rounded exactly like the sprite', () => {
    for (let x = -3; x < 3; x += 0.037) {
      for (const y of [0.13, 0.5, 2.71, -1.49]) {
        const p = iso.p(x, y);
        const s = lockedScroll(p, VIEW_W, VIEW_H);
        expect(Number.isInteger(s.x) && Number.isInteger(s.y)).toBe(true);
        // sprite at Math.round (CombatScene.applyRecoil) minus the scroll Phaser renders with (floored: a no-op here)
        expect(Math.round(p.x) - Math.floor(s.x)).toBe(Math.floor(VIEW_W / 2));
        expect(Math.round(p.y) - Math.floor(s.y)).toBe(Math.floor(VIEW_H / 2) + CAM_LIFT);
      }
    }
    expect(lockedScroll({ x: 10, y: 10 }, 641, 361)).toEqual({ x: 10 - 320, y: 10 - CAM_LIFT - 180 });
  });
});

describe('drawn motion', () => {
  it('advances evenly frame to frame at 60 Hz, 144 Hz and on uneven frames', () => {
    const worst: Record<string, number> = {};
    for (const fps of PACINGS) {
      for (const net of NETS) {
        const r = track({ ...net, fps, secs: 4, ...OPEN, pointer: straight });
        const jd = judder(r.frames, SPEED);
        expect(jd.n).toBeGreaterThan(100);
        worst[fps] = Math.max(worst[fps] ?? 0, jd.rms);
        // a frame never steps more than a pixel off its share of the walk (the stepped body lurched 2-4 px)
        expect(jd.max).toBeLessThan(fps === 'uneven' ? 1 : 0.35);
      }
    }
    // the old low-pass on the tick-stepped body: 0.15 px RMS at 144 Hz, 0.7-0.8 px on uneven frames
    expect(worst[144]).toBeLessThan(0.06);
    expect(worst[60]).toBeLessThan(0.06);
    expect(worst.uneven).toBeLessThan(0.3);
  });

  it('draws the hero along the latest tick by the clock, so a 144 Hz frame without a tick still moves it', () => {
    const v = new SelfView();
    const body = { qx: 10, qy: 10, px: 10, py: 10 };
    const xs: number[] = [];
    let alpha = 0;
    for (let f = 0; f < 60; f++) {
      alpha += (1000 / 144) / (1000 / 60);
      while (alpha >= 1) { alpha -= 1; body.px = body.qx; body.qx += 0.07; }   // a 60 Hz tick moves the body 0.07 tiles
      xs.push(v.frame(body, alpha, 1000 / 144).x);
    }
    const steps = xs.slice(1).map((x, i) => x - xs[i]);
    for (const s of steps.slice(2)) expect(s).toBeCloseTo(0.07 * (60 / 144), 6);
  });

  it('blends a reconciliation correction out over a few frames, and snaps a teleport', () => {
    const v = new SelfView();
    const body = { qx: 5, qy: 5, px: 5, py: 5 };
    v.frame(body, 0, 16);
    // a snapshot moves the predicted body 0.2 tiles: the hero stays where it is drawn, then slides over
    body.qx += 0.2; body.px += 0.2;
    v.correct(0.2, 0);
    const xs = [v.frame(body, 0, 0).x];
    expect(xs[0]).toBeCloseTo(5, 6);
    for (let i = 0; i < 12; i++) xs.push(v.frame(body, 0, 1000 / 60).x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    expect(xs[12]).toBeGreaterThan(5.19);                           // ~200 ms: all but a sliver
    expect(Math.exp(-200 / SELF_VIEW.blendMs)).toBeLessThan(0.05);
    // a jump past snapTiles (a teleport, a resync) is drawn at once
    body.qx += 3; body.px += 3;
    v.correct(3, 0);
    expect(v.frame(body, 0, 16).x).toBeCloseTo(8.2, 6);
  });
});

describe('hold to steer', () => {
  it('walks straight at the held cursor while it sweeps around the hero', () => {
    for (const net of NETS) {
      for (const fps of PACINGS) {
        const he = headingError(track({ ...net, fps, secs: 6, ...OPEN, pointer: circles }).frames, SPEED);
        expect(he.n).toBeGreaterThan(200);
        // a goal re-pathed only ~7 times a second: 14-16° mean, 26-29° p95
        expect(he.mean).toBeLessThan(2);
        expect(he.p95).toBeLessThan(4);
      }
    }
  });

  it('turns after a swung cursor within a few ticks of momentum', () => {
    for (const net of NETS) {
      for (const fps of PACINGS) {
        const r = track({ ...net, fps, secs: 2.5, ...OPEN, pointer: (t) => (
          t < 1200 ? { x: HERO_SCREEN.x + 120, y: HERO_SCREEN.y, down: true } : { x: HERO_SCREEN.x - 60, y: HERO_SCREEN.y + 90, down: true }) });
        let turned = Infinity;
        for (const f of r.frames) {
          if (f.t < 1200 || !f.cursor) continue;
          const want = Math.atan2(f.cursor.y - f.pred.y, f.cursor.x - f.pred.x), got = Math.atan2(f.vel.y, f.vel.x);
          if (Math.abs(Math.atan2(Math.sin(want - got), Math.cos(want - got))) < (15 * Math.PI) / 180 && Math.hypot(f.vel.x, f.vel.y) > SPEED * 0.9) { turned = f.t - 1200; break; }
        }
        // a stale goal held the old heading for up to CLICK.holdRepathMs: 83-215 ms
        expect(turned).toBeLessThan(85);
      }
    }
  });

  it('moves the walk leg to the cursor on the very next tick, without waiting for a re-path', () => {
    const map = openMap(40, 40);
    const cm = new ClickMove();
    const f = (over: Partial<DriveFrame>): DriveFrame => ({
      now: 0, scheme: 'click', phase: 'COMBAT', blocked: false, life: 'alive', self: { x: 20, y: 20 }, buffs: [], tether: null,
      skills: ['', '', '', ''], map, enemies: [], reach: { ranged: false, range: 1.75 }, cursor: null, pointer: null, hoverEnemy: null, hoverGround: null,
      primary: true, primaryEdge: false, force: false, buttons: 0, pressed: 0, keyMove: { x: 0, y: 0 }, padAim: null, usingPad: false,
      assist: { autoAttack: false, aimAssist: false }, ...over,
    });
    cm.update(f({ now: 0, cursor: { x: 24, y: 20 }, pointer: { x: 300, y: 200 }, primaryEdge: true }));
    cm.update(f({ now: CLICK.holdMs + 10, cursor: { x: 24, y: 20 }, pointer: { x: 300, y: 200 } }));   // steering now
    // the cursor swings to straight south, 30 ms after the last re-path: the very next tick heads there
    const out = cm.update(f({ now: CLICK.holdMs + 40, cursor: { x: 20, y: 23 }, pointer: { x: 300, y: 200 } }));
    expect(out.mx).toBeCloseTo(0, 6);
    expect(out.my).toBeCloseTo(1, 6);
    // a cursor just past the hero's feet keeps it walking (it stopped dead at a stale goal it reached first)
    let stops = 0;
    for (let i = 0, now = CLICK.holdMs + 60, y = 20; i < 40; i++, now += 1000 / 60, y += SPEED / 60) {
      const o = cm.update(f({ now, self: { x: 20, y }, cursor: { x: 20, y: y + 0.6 }, pointer: { x: 300, y: 200 } }));
      if (Math.hypot(o.mx, o.my) < 0.99) stops++;
    }
    expect(stops).toBe(0);
  });
});

describe('reconciliation through jitter and stalls', () => {
  it('stays quiet on a steady walk through network jitter and uneven frames', () => {
    for (const net of NETS) {
      for (const fps of PACINGS) {
        const r = track({ ...net, fps, secs: 6, ...OPEN, start: { x: 10, y: 40 }, pointer: straight });
        expect(r.dropped).toBe(0);
        // every hiccup came back as a ~1-2 tick forward correction (0.07-0.14 tiles) before the authority took late
        // inputs as done by the ticks it held them through and told the client how many
        expect(Math.max(0, ...r.steady)).toBeLessThan(0.01);
      }
    }
  });

  it('a frame stall sends its ticks late, the authority takes them as its held ticks: no queue, no correction', () => {
    // 60 fps with a 150 ms stall every 1.5 s
    const fps = (t: number) => (t % 1500 > 1480 ? 150 : 1000 / 60);
    for (const net of NETS) {
      const r = track({ ...net, fps, secs: 7, ...OPEN, start: { x: 10, y: 40 }, pointer: straight });
      expect(r.dropped).toBe(0);
      expect(r.maxQueue).toBeLessThanOrEqual(LIMITS.lateTicks + 3);
      expect(Math.max(0, ...r.steady)).toBeLessThan(0.01);
      // the walk kept its pace through the stalls: the authority and the prediction agree where the hero is
      const last = r.frames[r.frames.length - 1];
      expect(last.pred.x).toBeGreaterThan(10 + 7 * SPEED * 0.6);
    }
  });
});

describe('authority input queue', () => {
  function authority() {
    const state = combatState(openMap(40, 40), { x: 10, y: 20 });
    const sent: ServerMessage[] = [];
    const link: SeatLink = { slot: 0, connected: true, debug: false, buffered: () => 0, send: (m) => { sent.push(m); } };
    const auth = new RunAuthority({ state, store: {} as Store, logger: quietLog, boardKey: 't', practice: true, training: true, host: { links: () => [link], onRunEnded() {}, onStateChange() {} } });
    return { state, auth, sent };
  }
  const walk = (seq: number, buttons = 0) => ({ seq, moveX: 1, moveY: 0, aimX: 1, aimY: 0, buttons });

  it('takes late inputs as done by the ticks it held, keeping their presses, and tells the client how many are held', () => {
    const { state, auth, sent } = authority();
    const p = state.players[0];
    auth.submitInput(0, walk(1));
    auth.tick();
    const x1 = p.x;
    // three ticks with nothing queued: the last input is held (the hero keeps walking)
    for (let i = 0; i < 3; i++) auth.tick();
    const step = (p.x - x1) / 3;
    expect(step).toBeGreaterThan(0.05);
    auth.sendSnapshot();
    expect((sent[sent.length - 1] as { held?: number }).held).toBe(3);
    // the three late inputs and the next one arrive together (one carries a dodge press)
    auth.submitInput(0, walk(2));
    auth.submitInput(0, walk(3, ACTION.DODGE));
    auth.submitInput(0, walk(4));
    auth.submitInput(0, walk(5));
    const before = p.x;
    auth.tick();
    // one tick, one step: the three held ticks stood in for inputs 2-4 (applying them too walked the hero twice and
    // left them queued as lag); the dodge press carried along fires on this tick
    expect(p.lastInputSeq).toBe(5);
    expect(p.dodgeTimer).toBeGreaterThan(0);
    expect(p.x - before).toBeGreaterThan(step);                   // dashing
    auth.sendSnapshot();
    expect((sent[sent.length - 1] as { held?: number }).held).toBeUndefined();
    expect((auth as unknown as { queues: unknown[][] }).queues[0]).toHaveLength(0);
  });

  it('holds at most LIMITS.lateTicks ticks against late inputs (a longer stall is not paid back)', () => {
    const { auth } = authority();
    auth.submitInput(0, walk(1));
    for (let i = 0; i < 40; i++) auth.tick();
    expect((auth as unknown as { held: number[] }).held[0]).toBe(LIMITS.lateTicks);
  });
});

describe('client replay of held ticks', () => {
  const deliver = (c: GameConnection, m: unknown) => (c as unknown as { onMessage(m: unknown): void }).onMessage(m);
  const body = (x: number, y: number): MoveBody => ({ x, y, vx: 0, vy: 0, dodgeTimer: 0, dodgeDirX: 1, dodgeDirY: 0, dodgeCharges: DODGE.charges, dodgeCooldown: 0, surgeTimer: 0, guardTimer: 0 });
  function snap(tick: number, b: MoveBody) {
    return {
      tick, phase: 'COMBAT', round: 1, stateVersion: 1, enemies: [], projectiles: [], hazards: [], pickups: [], telegraphs: [],
      players: [{ s: 0, n: 'Ivy', c: 'vanguard', x: b.x, y: b.y, vx: b.vx, vy: b.vy, ax: 1, ay: 0, f: 0, life: 'alive', anim: 'run', spd: SPEED, dt: 0, ddx: 1, ddy: 0, dcd: 0, dc: DODGE.charges, dcm: DODGE.charges, sg: 0, rr: 1, guard: false, buffs: [], cd: [] }],
    };
  }

  it('skips the inputs the authority will take as done, and does not predict inputs its held ticks already stood in for', () => {
    const map = openMap(60, 20);
    const c = new GameConnection('room', 'tok');
    c.map = map;
    deliver(c, { t: 'SNAPSHOT', ack: 0, snap: snap(0, body(5, 10)) });
    for (let i = 0; i < 3; i++) c.sendInput(1, 0, 2, 0, 0);          // inputs 1-3 in flight
    // the authority applied input 1, then held it for 4 ticks (inputs 2-3 and the next two are late)
    const auth = body(5, 10);
    for (let i = 0; i < 5; i++) predictMoveTick(map, auth, 1, 0, 2, 0, false, SPEED, 'vanguard', 1);
    deliver(c, { t: 'SNAPSHOT', ack: 1, held: 4, snap: snap(5, auth) });
    // inputs 2-3 are taken as done: the prediction is the authority's body as it stands
    expect(c.pred.x).toBeCloseTo(auth.x, 9);
    // the next two inputs are the ones the held ticks stood in for: the body stays; the one after moves on
    c.sendInput(1, 0, 2, 0, 0);
    c.sendInput(1, 0, 2, 0, 0);
    expect(c.pred.x).toBeCloseTo(auth.x, 9);
    c.sendInput(1, 0, 2, 0, 0);
    expect(c.pred.x).toBeGreaterThan(auth.x + 0.05);
  });
});
