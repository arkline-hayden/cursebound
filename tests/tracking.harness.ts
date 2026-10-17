import { CLASS_BY_ID, ENEMY_BY_ID, RULES } from '@cursebound/content';
import { quantizeInput, type ServerMessage } from '@cursebound/protocol';
import { devSpawn, setupRound, type MapState, type SimState, type Snapshot } from '@cursebound/simulation';
import { RunAuthority, type SeatLink } from '../apps/server/src/authority';
import type { Logger } from '../apps/server/src/persistence/logger';
import type { Store } from '../apps/server/src/persistence/store';
import { ClickMove, InputTicks, type DriveFrame } from '../apps/client/src/game/input/ClickMove';
import type { Pt } from '../apps/client/src/game/input/path';
import { groundAt } from '../apps/client/src/game/input/targeting';
import { iso } from '../apps/client/src/game/render/iso';
import { CAM_LIFT, SelfView, lockedScroll } from '../apps/client/src/game/selfView';
import { GameConnection } from '../apps/client/src/lib/net';
import { newRun } from '../packages/simulation/test/run.helpers';

// End-to-end movement tracking harness: the real client (GameConnection prediction + reconciliation, ClickMove,
// InputTicks, the scene's local-hero view and locked camera) against the real authority (RunAuthority's input queue,
// tick loop and snapshots over the real simulation), over a simulated network (round trip + one-way jitter, in-order
// delivery like a WebSocket) at a chosen frame pacing. Everything runs on one simulated clock. Records, per rendered
// frame, where the hero is predicted / drawn, where the camera is and where the hero lands on screen (Phaser
// roundPixels semantics: sprites at whole pixels, the camera scroll floored), plus the cursor's ground point.

export const VIEW_W = 640, VIEW_H = 360;
/** where the locked camera puts the hero's feet on screen */
export const HERO_SCREEN = { x: Math.floor(VIEW_W / 2), y: Math.floor(VIEW_H / 2) + CAM_LIFT };

export interface PointerState { x: number; y: number; down: boolean }

/** What a frame of the scene draws: the local hero (world tiles) and the camera scroll it sets (view px). */
export interface ViewOut { drawn: Pt; scroll: Pt }

/** The scene's local-hero view and camera, as one strategy (the shipped one by default). */
export interface ViewStrategy {
  frame(c: GameConnection, ticks: InputTicks, dtMs: number): ViewOut;
  /** a teleport / new round: draw at the body again */
  reset(): void;
}

/** The shipped view: CombatScene's SelfView + lockedScroll. */
export function shippedView(): ViewStrategy {
  const v = new SelfView();
  return {
    frame(c, ticks, dtMs) {
      const d = c.drift;
      v.correct(d.x, d.y); d.x = 0; d.y = 0;
      const drawn = v.frame(c.pred, ticks.alpha, dtMs);
      return { drawn, scroll: lockedScroll(iso.p(drawn.x, drawn.y), VIEW_W, VIEW_H) };
    },
    reset() { v.reset(); },
  };
}

export interface FrameRec {
  t: number; dt: number; ticks: number;
  pred: Pt; drawn: Pt; vel: Pt;
  /** camera scroll after Phaser's roundPixels floor */
  scroll: Pt;
  /** the hero sprite's feet on screen (view px) */
  screen: Pt;
  cursor: Pt | null; pointer: PointerState;
  /** walking / attack-move order of the controller, and the move it sent on the frame's first tick */
  goal: Pt | null; move: Pt;
  facing: number;
}

export interface TrackOpts {
  /** round trip in ms (split evenly), plus up to `jitterMs` extra on each one-way trip */
  rttMs: number;
  jitterMs: number;
  /** a network hiccup: everything sent in the first `ms` of every `every` ms waits until it ends (WiFi, a congested link) */
  spike?: { every: number; ms: number };
  /** frame pacing: a fixed rate, 'uneven' (vsync misses and hitches around 60 fps), or the next frame's ms at time t */
  fps: number | 'uneven' | ((t: number) => number);
  secs: number;
  map: MapState;
  start: Pt;
  /** pointer in view px and the move button, per frame (t = ms) */
  pointer: (t: number, f: { pred: Pt; drawn: Pt; scroll: Pt }) => PointerState;
  seed?: number;
  view?: ViewStrategy;
}

export interface TrackResult {
  frames: FrameRec[];
  /** client reconciliation jumps of the predicted body (tiles), one per snapshot */
  corrections: number[];
  /** the corrections that arrived while frames were flowing (not catching up after a client stall) */
  steady: number[];
  /** authority ticks that held the last input through an empty queue; inputs it dropped to an overflow */
  holds: number; dropped: number; maxQueue: number;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** A walled map: '#' wall, anything else floor. */
export function gridMap(rows: string[]): MapState {
  const h = rows.length, w = rows[0].length;
  const tiles: number[] = [];
  for (const r of rows) for (const ch of r) tiles.push(ch === '#' ? 1 : 0);
  return { w, h, tiles, topology: 'test', playerSpawns: [], enemySpawns: [], fallback: false, decorSeed: 0, theme: 'crypt', layout: 'test' } as unknown as MapState;
}

export function openMap(w: number, h: number): MapState {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let r = '';
    for (let x = 0; x < w; x++) r += x === 0 || y === 0 || x === w - 1 || y === h - 1 ? '#' : '.';
    rows.push(r);
  }
  return gridMap(rows);
}

/** A combat round on `map` with the hero at `start` and one inert objective foe walled off in a corner. */
export function combatState(map: MapState, start: Pt): SimState {
  const s = newRun(['vanguard'], 'TRACKING_HARNESS');
  s.round = 1;
  setupRound(s, []);
  s.phase = 'COMBAT';
  const tiles = map.tiles.slice();
  // a sealed cell in the far corner for the foe that keeps the round open
  tiles[1 * map.w + 1] = 0;
  const m = { ...s.map!, ...map, tiles, playerSpawns: [{ x: start.x, y: start.y }], enemySpawns: [{ x: 1.5, y: 1.5 }] } as MapState;
  s.map = m;
  s.enemies = [];
  const enc = s.encounter!;
  enc.groups = [{ id: 99, weight: 1, archetype: 'guardian', wave: 0, spawned: true, defeated: false, countText: '1' }];
  enc.wave = 0; enc.waveCount = 1; enc.objectiveTotal = 1;
  const anchor = devSpawn(s, 'guardian', 1.5, 1.5);
  anchor.objective = true; anchor.groupId = 99; anchor.moveSpeed = 0;
  for (const a of ENEMY_BY_ID[anchor.kind].attacks) anchor.cooldowns[a.id] = 1e9;
  const p = s.players[0];
  p.x = start.x; p.y = start.y; p.vx = 0; p.vy = 0;
  p.connected = true;
  return s;
}

export const quietLog: Logger = { debug() {}, info() {}, warn() {}, error() {}, child() { return quietLog; }, async close() {} };

/** Run one scenario. */
export function track(o: TrackOpts): TrackResult {
  const rand = rng(o.seed ?? 7);
  const state = combatState(o.map, o.start);
  // ---- network: in-order delivery (a WebSocket never reorders), each message delayed by rtt / 2 + jitter
  type Msg = { at: number; run: () => void };
  const up: Msg[] = [], down: Msg[] = [];
  let lastUp = 0, lastDown = 0;
  const oneWay = () => {
    const ph = o.spike ? now % o.spike.every : Infinity;
    return o.rttMs / 2 + rand() * o.jitterMs + (o.spike && ph < o.spike.ms ? o.spike.ms - ph : 0);
  };
  let now = 0;
  const link: SeatLink = {
    slot: 0, connected: true, debug: false, buffered: () => 0,
    send(msg: ServerMessage) {
      const json = JSON.stringify(msg);
      lastDown = Math.max(lastDown, now + oneWay());
      down.push({ at: lastDown, run: () => deliver(JSON.parse(json)) });
    },
  };
  // the authority's input rate limit runs on Date.now: our clock too (restored at the end)
  const realDateNow = Date.now;
  const epoch = realDateNow();
  Date.now = () => epoch + Math.floor(now);
  const auth = new RunAuthority({
    state, store: {} as Store, logger: quietLog, boardKey: 'test', practice: true, training: true,
    host: { links: () => [link], onRunEnded() {}, onStateChange() {} },
  });
  const queues = (auth as unknown as { queues: unknown[][] }).queues;
  (auth as unknown as { lastNow: number }).lastNow = 0;   // its clock is ours

  const c = new GameConnection('room', 'tok');
  c.map = state.map;
  const corrections: number[] = [], steady: number[] = [];
  const deliver = (m: { t: string }) => {
    (c as unknown as { onMessage(m: unknown): void }).onMessage(m);
    if (m.t === 'SNAPSHOT' && c.pred.valid) { corrections.push(c.correction); if (now - lastFrame < 25) steady.push(c.correction); }
  };
  (c as unknown as { ws: unknown }).ws = {
    readyState: 'open', close() {},
    send(json: string) {
      const msg = JSON.parse(json);
      if (msg.t !== 'INPUT') return;
      lastUp = Math.max(lastUp, now + oneWay());
      up.push({
        at: lastUp,
        run: () => {
          const qi = quantizeInput(msg.mx, msg.my, msg.ax, msg.ay);
          auth.submitInput(0, { seq: msg.seq, moveX: qi.mx, moveY: qi.my, aimX: qi.ax, aimY: qi.ay, buttons: msg.b });
        },
      });
    },
  };

  let holds = 0, dropped = 0, maxQueue = 0;
  const origTick = auth.tick.bind(auth);
  auth.tick = () => {
    const q = queues[0];
    if (!q.length && state.phase === 'COMBAT') holds++;
    origTick();
  };
  const origSubmit = auth.submitInput.bind(auth);
  auth.submitInput = (slot, inp) => {
    const before = queues[slot].length;
    const ok = origSubmit(slot, inp);
    const after = queues[slot].length;
    if (after < before) dropped += before + 1 - after;   // an overflowing queue cut back
    if (!ok) dropped++;                                // rate limited (or a duplicate)
    maxQueue = Math.max(maxQueue, after);
    return ok;
  };

  const view = o.view ?? shippedView();
  const cm = new ClickMove();
  const ticks = new InputTicks();
  const frames: FrameRec[] = [];
  let scroll: Pt = lockedScroll(iso.p(o.start.x, o.start.y), VIEW_W, VIEW_H);
  let prevDown = false;
  let drawn: Pt = { ...o.start };
  const end = o.secs * 1000;
  let nextServer = 0, nextFrame = 0, lastFrame = 0;
  const frameDt = () => {
    if (typeof o.fps === 'function') return o.fps(now);
    if (o.fps !== 'uneven') return 1000 / o.fps;
    const r = rand();
    // mostly vsync'd 60 fps with frame-time noise, sometimes a missed vsync, rarely a hitch
    return r < 0.82 ? 1000 / 60 + (rand() - 0.5) * 4 : r < 0.97 ? 2000 / 60 : 45 + rand() * 30;
  };
  // the authority starts first and sends its opening snapshot
  auth.sendSnapshot();
  try {
    while (now < end) {
      const nextMsg = Math.min(up[0]?.at ?? Infinity, down[0]?.at ?? Infinity);
      now = Math.min(nextServer, nextFrame, nextMsg);
      if (now >= end) break;
      while (up.length && up[0].at <= now) up.shift()!.run();
      while (down.length && down[0].at <= now) down.shift()!.run();
      if (now >= nextServer) {
        auth.update(now);
        nextServer = now + 2 + rand() * 1.5;          // rooms.ts: setTimeout(loop, 2)
      }
      if (now >= nextFrame) {
        const dt = frames.length ? now - lastFrame : 1000 / 60;
        lastFrame = now;
        nextFrame = now + frameDt();
        const latest = c.snaps[c.snaps.length - 1]?.snap as Snapshot | undefined;
        if (!latest) continue;
        const lp = latest.players[0];
        const self = c.pred.valid ? { x: c.pred.x, y: c.pred.y } : { x: lp.x, y: lp.y };
        const ptr = o.pointer(now, { pred: self, drawn, scroll });
        // CombatScene.driveFrame: the pointer's ground point through last frame's camera
        const cursor = groundAt(c.map as never, ptr.x + scroll.x, ptr.y + scroll.y, null, self);
        const f: DriveFrame = {
          now, scheme: 'click', phase: latest.phase, blocked: false, life: lp.life as DriveFrame['life'], self, buffs: lp.buffs ?? [], tether: null,
          skills: ['', '', '', ''], map: c.map as never, enemies: [], reach: { ranged: false, range: 1.75 }, cursor, pointer: { x: ptr.x, y: ptr.y },
          hoverEnemy: null, hoverGround: null, primary: ptr.down, primaryEdge: ptr.down && !prevDown, force: false, buttons: 0, pressed: 0,
          keyMove: { x: 0, y: 0 }, padAim: null, usingPad: false, assist: { autoAttack: false, aimAssist: false },
        };
        prevDown = ptr.down;
        let move: Pt | null = null;
        const n = ticks.run(now, cm, f, (out) => {
          if (!move) move = { x: out.mx, y: out.my };
          c.sendInput(out.mx, out.my, out.ax, out.ay, out.buttons);
          return c.pred.valid ? { x: c.pred.x, y: c.pred.y } : null;
        });
        const v = view.frame(c, ticks, dt);
        drawn = v.drawn;
        // Phaser roundPixels: the camera scroll is floored at render, sprites sit at whole pixels (applyRecoil rounds)
        scroll = { x: Math.floor(v.scroll.x), y: Math.floor(v.scroll.y) };
        const sp = iso.p(drawn.x, drawn.y);
        const screen = { x: Math.round(sp.x) - scroll.x, y: Math.round(sp.y) - scroll.y };
        const o2 = cm.order;
        frames.push({
          t: now, dt, ticks: n, pred: { x: c.pred.x, y: c.pred.y }, drawn: { ...drawn }, vel: { x: c.pred.vx, y: c.pred.vy }, scroll, screen,
          cursor, pointer: ptr, goal: o2 ? { x: o2.x, y: o2.y } : null, move: move ?? { x: 0, y: 0 }, facing: iso.facing8(c.pred.ax, c.pred.ay),
        });
      }
    }
  } finally {
    Date.now = realDateNow;
  }
  return { frames, corrections, steady, holds, dropped, maxQueue };
}

// ---------------- metrics ----------------

const ang = (x: number, y: number) => Math.atan2(y, x);
const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
export const pct = (xs: number[], p: number) => { if (!xs.length) return 0; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
export const rad2deg = (r: number) => (r * 180) / Math.PI;

/** How far the hero's sprite strays from its locked spot on screen (px), and how often it moves there at all. */
export function screenJitter(fr: FrameRec[]) {
  let maxOff = 0, moves = 0;
  for (let i = 0; i < fr.length; i++) {
    const s = fr[i].screen;
    maxOff = Math.max(maxOff, Math.abs(s.x - HERO_SCREEN.x), Math.abs(s.y - HERO_SCREEN.y));
    if (i && (s.x !== fr[i - 1].screen.x || s.y !== fr[i - 1].screen.y)) moves++;
  }
  return { maxOff, movesPerSec: moves / ((fr[fr.length - 1].t - fr[0].t) / 1000) };
}

/**
 * Judder: how unevenly the drawn hero advances frame to frame while walking at a steady speed. Each frame's drawn
 * step (screen px) against the steady speed x that frame's duration; RMS and worst, over frames at full speed.
 */
export function judder(fr: FrameRec[], speed: number) {
  const errs: number[] = [];
  for (let i = 2; i < fr.length; i++) {
    const a = fr[i - 1], b = fr[i];
    const v = Math.hypot(b.vel.x, b.vel.y), v0 = Math.hypot(a.vel.x, a.vel.y), v00 = Math.hypot(fr[i - 2].vel.x, fr[i - 2].vel.y);
    if (Math.min(v, v0, v00) < speed * 0.98 || b.dt > 40) continue;     // steady walking only
    const d = iso.dir(b.drawn.x - a.drawn.x, b.drawn.y - a.drawn.y);
    const w = iso.dir((b.vel.x * b.dt) / 1000, (b.vel.y * b.dt) / 1000);
    errs.push(Math.hypot(d.x - w.x, d.y - w.y));
  }
  const rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / Math.max(1, errs.length));
  return { rms, max: errs.length ? Math.max(...errs) : 0, n: errs.length };
}

/** Holding the button: angle between where the hero walks (predicted velocity) and the cursor's ground point. */
export function headingError(fr: FrameRec[], speed: number) {
  const errs: number[] = [];
  for (const f of fr) {
    if (!f.pointer.down || !f.cursor) continue;
    if (Math.hypot(f.vel.x, f.vel.y) < speed * 0.5) continue;
    const dx = f.cursor.x - f.pred.x, dy = f.cursor.y - f.pred.y;
    if (Math.hypot(dx, dy) < 0.6) continue;
    errs.push(rad2deg(angDiff(ang(f.vel.x, f.vel.y), ang(dx, dy))));
  }
  return { mean: errs.reduce((s, e) => s + e, 0) / Math.max(1, errs.length), p95: pct(errs, 0.95), max: errs.length ? Math.max(...errs) : 0, n: errs.length };
}

/** Facing changes per second while the hero is walking (sprite flicker between neighbouring directions). */
export function facingFlips(fr: FrameRec[]) {
  let flips = 0;
  for (let i = 1; i < fr.length; i++) if (fr[i].facing !== fr[i - 1].facing) flips++;
  return flips / ((fr[fr.length - 1].t - fr[0].t) / 1000);
}

/** The Vanguard's ground speed (snapshot `spd`). */
export const SPEED = CLASS_BY_ID.vanguard.base.moveSpeed * Number(RULES.playerMoveSpeedMult);
