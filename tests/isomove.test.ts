import { describe, expect, it } from 'vitest';
import { CLASS_BY_ID, DODGE, RULES } from '@cursebound/content';
import { ACTION, predictMoveTick, type MapState, type MoveBody } from '@cursebound/simulation';
import { ClickMove, type DriveFrame } from '../apps/client/src/game/input/ClickMove';
import type { GridMap, Pt } from '../apps/client/src/game/input/path';
import { iso } from '../apps/client/src/game/render/iso';
import { GameConnection } from '../apps/client/src/lib/net';

// Movement on the 2:1 isometric view (playtest: "diagonal movement on WASD is true diagonal rather than diagonal to
// the grid"; "movement is slower when moving any direction that isn't left or right"). Two movement keys walk along a
// world axis (straight down a corridor, ~26.57° on screen), and the hero covers the same screen pixels per second in
// every direction, for WASD and click-to-move alike, with the prediction matching the authority.

const deg = (r: number) => (r * 180) / Math.PI;
/** screen angle (degrees, y down) of a world direction */
const screenAngle = (w: Pt) => { const s = iso.dir(w.x, w.y); return deg(Math.atan2(s.y, s.x)); };
const screenLen = (dx: number, dy: number) => { const s = iso.dir(dx, dy); return Math.hypot(s.x, s.y); };
const GRID = deg(Math.atan(0.5));   // a world axis on a 2:1 view: 26.565°
const SPEED = CLASS_BY_ID.vanguard.base.moveSpeed * Number(RULES.playerMoveSpeedMult);
/** screen px per second walking sideways (what every direction now covers) */
const SIDEWAYS = SPEED * screenLen(Math.SQRT1_2, -Math.SQRT1_2);

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
const body = (x: number, y: number): MoveBody => ({ x, y, vx: 0, vy: 0, dodgeTimer: 0, dodgeDirX: 1, dodgeDirY: 0, dodgeCharges: DODGE.charges, dodgeCooldown: 0, surgeTimer: 0, guardTimer: 0 });

// the eight key combinations as InputController samples them (screen directions, y down)
const KEYS: Record<string, [number, number]> = {
  W: [0, -1], D: [1, 0], S: [0, 1], A: [-1, 0], 'W+D': [1, -1], 'D+S': [1, 1], 'S+A': [-1, 1], 'A+W': [-1, -1],
};

describe('WASD diagonals follow the isometric grid', () => {
  it('single keys walk straight along the screen, as before', () => {
    expect(screenAngle(iso.keyToWorld(...KEYS.D))).toBeCloseTo(0, 9);
    expect(screenAngle(iso.keyToWorld(...KEYS.S))).toBeCloseTo(90, 9);
    expect(Math.abs(screenAngle(iso.keyToWorld(...KEYS.A)))).toBeCloseTo(180, 9);
    expect(screenAngle(iso.keyToWorld(...KEYS.W))).toBeCloseTo(-90, 9);
    for (const k of ['W', 'D', 'S', 'A']) {
      const a = iso.keyToWorld(...KEYS[k]), b = iso.dirToWorld(...KEYS[k]);
      expect(a.x).toBeCloseTo(b.x, 12);
      expect(a.y).toBeCloseTo(b.y, 12);
    }
  });

  it('two keys walk a world axis: atan(1/2) ~ 26.57° off horizontal, not 45°', () => {
    const want: Record<string, [number, number, number]> = {
      'W+D': [0, -1, -GRID], 'D+S': [1, 0, GRID], 'S+A': [0, 1, 180 - GRID], 'A+W': [-1, 0, -(180 - GRID)],
    };
    for (const [k, [wx, wy, ang]] of Object.entries(want)) {
      const w = iso.keyToWorld(...KEYS[k]);
      expect(w.x, k).toBeCloseTo(wx, 12);
      expect(w.y, k).toBeCloseTo(wy, 12);
      expect(screenAngle(w), k).toBeCloseTo(ang, 9);
      expect(Math.hypot(w.x, w.y)).toBeCloseTo(1, 12);   // full speed, no diagonal bonus
    }
    // the old mapping walked the screen diagonal, cutting across the tile rows
    expect(screenAngle(iso.dirToWorld(...KEYS['W+D']))).toBeCloseTo(-45, 9);
    // the eight key directions are 45° apart on the ground
    const ground = Object.values(KEYS).map(([x, y]) => { const w = iso.keyToWorld(x, y); return deg(Math.atan2(w.y, w.x)); }).sort((a, b) => a - b);
    for (let i = 1; i < ground.length; i++) expect(ground[i] - ground[i - 1]).toBeCloseTo(45, 9);
  });

  it('the analog stick keeps its free screen direction', () => {
    const w = iso.dirToWorld(Math.SQRT1_2, -Math.SQRT1_2);
    expect(screenAngle(w)).toBeCloseTo(-45, 9);
    expect(iso.keyToWorld(0, 0)).toEqual({ x: 0, y: 0 });
    const half = iso.keyToWorld(0.5, 0);                     // partial input keeps its length
    expect(Math.hypot(half.x, half.y)).toBeCloseTo(0.5, 12);
  });
});

describe('the same on-screen speed in every direction', () => {
  /** screen px / s of the hero's steady walk, measured between 0.5 s and 1.5 s */
  function walkPx(drive: (cm: ClickMove, b: MoveBody, now: number, map: GridMap & MapState) => { mx: number; my: number }) {
    const map = open(60, 60);
    const b = body(30, 30);
    const cm = new ClickMove();
    let a: Pt | null = null, z: Pt | null = null;
    for (let t = 0; t <= 100; t++) {
      const now = (t * 1000) / 60;
      const out = drive(cm, b, now, map);
      predictMoveTick(map, b, out.mx, out.my, out.mx, out.my, false, SPEED, 'vanguard', 1);
      if (t === 30) a = { x: b.x, y: b.y };
      if (t === 90) z = { x: b.x, y: b.y };
    }
    return screenLen(z!.x - a!.x, z!.y - a!.y);   // 60 ticks = 1 s
  }

  it('WASD: all eight key directions cover the sideways screen speed', () => {
    for (const [k, [sx, sy]] of Object.entries(KEYS)) {
      const px = walkPx((cm, b, now, map) => cm.update(frame({ map, now, scheme: 'wasd', self: { x: b.x, y: b.y }, keyMove: iso.keyToWorld(sx, sy) })));
      expect(Math.abs(px / SIDEWAYS - 1), k).toBeLessThan(0.015);   // the 1/1024 position grid only (straight up used to be 0.5)
    }
  });

  it('click-to-move: a held click toward 16 screen directions covers the same screen speed', () => {
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      // the pointer held 150 px from the hero on screen, at that angle
      const off = iso.toWorld(Math.cos(a) * 150, Math.sin(a) * 150);
      const px = walkPx((cm, b, now, map) => cm.update(frame({
        map, now, self: { x: b.x, y: b.y }, cursor: { x: b.x + off.x, y: b.y + off.y }, pointer: { x: 400 + Math.cos(a) * 150, y: 300 + Math.sin(a) * 150 },
        primary: true, primaryEdge: now === 0,
      })));
      expect(Math.abs(px / SIDEWAYS - 1), `${(i * 22.5).toFixed(1)}°`).toBeLessThan(0.015);
    }
  });
});

describe('prediction and the authority agree', () => {
  const deliver = (c: GameConnection, m: unknown) => (c as unknown as { onMessage(m: unknown): void }).onMessage(m);
  function snap(tick: number, b: MoveBody) {
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    return {
      tick, phase: 'COMBAT', round: 1, stateVersion: 1, enemies: [], projectiles: [], hazards: [], pickups: [], telegraphs: [],
      players: [{
        s: 0, n: 'Ivy', c: 'vanguard', x: r3(b.x), y: r3(b.y), vx: r3(b.vx), vy: r3(b.vy), ax: 1, ay: 0, f: 0, life: 'alive', anim: 'idle',
        spd: SPEED, dt: r3(b.dodgeTimer), ddx: r3(b.dodgeDirX), ddy: r3(b.dodgeDirY), dcd: r3(b.dodgeCooldown), dc: b.dodgeCharges, dcm: DODGE.charges,
        sg: r3(b.surgeTimer), rr: 1, guard: false, buffs: [], cd: [],
      }],
    };
  }

  it('reconciles WASD grid diagonals, screen verticals and dashes onto the authority (snapshot rounding only)', () => {
    const map = open(80, 80);
    const c = new GameConnection('room', 'tok');
    c.map = map;
    const auth = body(40, 40);
    deliver(c, { t: 'SNAPSHOT', ack: 0, snap: snap(0, auth) });
    const LAG = 4;
    const order = ['W', 'W+D', 'D+S', 'S', 'S+A', 'A+W', 'A', 'D'];
    const sent: { mx: number; my: number; dodge: boolean }[] = [];
    let applied = 0, prevDodge = false, worst = 0;
    for (let tick = 1; tick <= 240; tick++) {
      const w = iso.keyToWorld(...KEYS[order[Math.floor((tick - 1) / 30)]]);
      const dodge = tick % 30 === 12;
      c.sendInput(w.x, w.y, w.x * 2, w.y * 2, dodge ? ACTION.DODGE : 0);
      sent.push({ mx: Math.round(w.x * 127) / 127, my: Math.round(w.y * 127) / 127, dodge });
      if (tick > LAG) {
        const inp = sent[applied++];
        predictMoveTick(map, auth, inp.mx, inp.my, 1, 0, inp.dodge && !prevDodge, SPEED, 'vanguard', 1);
        prevDodge = inp.dodge;
      }
      if (tick % 3 === 0) {
        deliver(c, { t: 'SNAPSHOT', ack: applied, snap: snap(tick, auth) });
        const truth = { ...auth };
        let pd = prevDodge;
        for (const inp of sent.slice(applied)) { predictMoveTick(map, truth, inp.mx, inp.my, 1, 0, inp.dodge && !pd, SPEED, 'vanguard', 1); pd = inp.dodge; }
        worst = Math.max(worst, Math.hypot(c.pred.x - truth.x, c.pred.y - truth.y));
      }
    }
    expect(worst).toBeLessThan(0.01);
  });
});
