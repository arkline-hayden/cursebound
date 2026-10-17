import { describe, expect, it } from 'vitest';
import {
  BOSS_BODY, bossForRound, circleClear, findPath, isWall, setupRound, spawnWave, stateHash, step,
  type EnemyState, type MapState, type PlayerInput, type SimEvent, type SimState,
} from '@cursebound/simulation';
import { newRun } from './run.helpers';

// Big bosses among pillars (ai.ts BOSS_BODY). The Hollow Stag (prismstag) fights in pillared lairs (arenas.ts nave /
// ritual): it must route round the pillars and only aim its Lane Charge down a lane its body clears, instead of slamming
// into the same stone over and over (every slam was a stagger, and the charge was re-aimed at the same pillar after
// it). A slam it does make is one stagger, then the pattern moves on and a slam immunity window runs. The Bell Golem
// shares the walking rules in its own post-studded lairs (belltower / colosseum).

type Lair = 'nave' | 'ritual' | 'belltower' | 'colosseum';

/** COMBAT on a classic boss floor whose boss is `boss` fighting in `arena`, the grand entrance skipped. */
function bossLair(boss: 'prismstag' | 'bellroot', arena: Lair, k0 = 0): SimState {
  for (let k = k0; k < k0 + 400; k++) {
    const seed = `BOSS_PILLARS_${k}`;
    if (bossForRound(seed, 5, 'catacombs') !== boss) continue;
    const s = newRun(['vanguard'], seed);
    s.round = 5;
    s.nextTheme = { round: 5, theme: 'catacombs' };
    setupRound(s, []);
    if (s.map!.arena !== arena) continue;
    s.phase = 'COMBAT';
    spawnWave(s, [], 0);
    s.cinematicUntilTick = s.tick;
    return s;
  }
  throw new Error(`no ${boss} lair ${arena}`);
}

const theBoss = (s: SimState) => s.enemies.find((e) => e.boss)!;
const idle = (s: SimState): PlayerInput[] => s.players.map((p) => ({ seq: p.lastInputSeq + 1, moveX: 0, moveY: 0, aimX: 1, aimY: 0, buttons: 0 }));
/** Open floor around (x, y) for a body of radius r (every tile the circle's box touches is floor). */
function roomy(m: MapState, x: number, y: number, r: number): boolean {
  for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++) for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) if (isWall(m, tx, ty)) return false;
  return true;
}

/** Pillars of the lair: wall tiles inside the arena room with at least five floor tiles among their eight neighbours. */
function pillars(s: SimState): { x: number; y: number }[] {
  const m = s.map!;
  const arena = m.rooms!.find((r) => r.kind === 'arena')!;
  const out: { x: number; y: number }[] = [];
  for (let y = arena.y; y < arena.y + arena.h; y++) for (let x = arena.x; x < arena.x + arena.w; x++) {
    if (!isWall(m, x, y)) continue;
    let open = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && !isWall(m, x + dx, y + dy)) open++;
    if (open >= 5) out.push({ x: x + 0.5, y: y + 0.5 });
  }
  return out;
}

type Placement = { sx: number; sy: number; hx: number; hy: number };

/** Boss and hero on opposite sides of each pillar, all three in a line (boss `ds` from its centre, hero `dh`). */
function behindPillars(s: SimState, ds: number, dh: number, bossRoom: number): Placement[] {
  const m = s.map!;
  const out: Placement[] = [];
  for (const p of pillars(s)) for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2, c = Math.cos(a), n = Math.sin(a);
    const sx = p.x - c * ds, sy = p.y - n * ds, hx = p.x + c * dh, hy = p.y + n * dh;
    if (roomy(m, sx, sy, bossRoom) && roomy(m, hx, hy, 0.6)) { out.push({ sx, sy, hx, hy }); break; }
  }
  return out;
}

function place(s: SimState, e: EnemyState, at: Placement) {
  const p = s.players[0];
  p.x = at.hx; p.y = at.hy; p.vx = 0; p.vy = 0;
  e.x = at.sx; e.y = at.sy; e.attack = null; e.state = 'idle'; e.path = []; e.stuckTimer = 0;
  e.patternIndex = 0; e.patternStep = 0; e.cooldowns = {};
  s.telegraphs = s.telegraphs.filter((t) => t.ownerId !== e.id);
}

/** Run `ticks` with the hero idle and invulnerable: the boss's staggers, closest approach and longest stall mid-walk. */
function watch(s: SimState, e: EnemyState, ticks: number) {
  let staggers = 0, minD = Infinity, stall = 0, maxStall = 0;
  const evs: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    for (const p of s.players) { p.iframes = 1e6; p.hp = p.maxHp; }
    const ev = step(s, idle(s), []).events;
    evs.push(...ev);
    staggers += ev.filter((x) => x.t === 'stagger' && x.id === e.id).length;
    const p = s.players[0];
    minD = Math.min(minD, Math.hypot(p.x - e.x, p.y - e.y));
    stall = e.state === 'move' && Math.abs(e.vx) + Math.abs(e.vy) < 0.05 ? stall + 1 : 0;
    maxStall = Math.max(maxStall, stall);
  }
  return { staggers, minD, maxStall, evs };
}

const released = (evs: SimEvent[], id: number, attacks: string[]) =>
  evs.some((x) => x.t === 'enemy_attack' && x.id === id && x.stage === 'release' && attacks.includes(x.attack));

describe('the Hollow Stag among the pillars', () => {
  for (const arena of ['nave', 'ritual'] as const) {
    it(`${arena}: with the hero behind a pillar it routes round and engages instead of slamming the stone again and again`, () => {
      let tried = 0;
      for (const k0 of [0, 60, 120]) {
        for (const [ds, dh] of [[3, 2], [4, 2.5], [2.6, 3]] as const) {
          const count = behindPillars(bossLair('prismstag', arena, k0), ds, dh, 1.2).length;
          for (let j = 0; j < Math.min(count, 4); j++) {
            const s = bossLair('prismstag', arena, k0);
            const e = theBoss(s);
            const at = behindPillars(s, ds, dh, 1.2)[j];
            place(s, e, at);
            const r = watch(s, e, 12 * 60);
            const tag = `${arena} seed@${k0} pillar ${j} ${ds}/${dh}`;
            tried++;
            // the old loop slammed the pillar and staggered every ~2.5 s
            expect(r.staggers, `${tag} staggers`).toBeLessThanOrEqual(1);
            // it closed in (the sweep reaches 3.3 + the hero's body) and fought: a charge or sweep was released
            expect(r.minD, `${tag} closest approach`).toBeLessThan(3.6);
            expect(released(r.evs, e.id, ['charge', 'sweep']), `${tag} attacked`).toBe(true);
            // and it never stood grinding into stone mid-walk
            expect(r.maxStall, `${tag} stall ticks`).toBeLessThan(60);
          }
        }
      }
      expect(tried).toBeGreaterThan(6);
    });
  }

  it('aims its charges down clear lanes only: no charge from behind a pillar ever ends in the stone at its start', () => {
    const s = bossLair('prismstag', 'nave');
    const e = theBoss(s);
    const at = behindPillars(s, 3, 2, 1.2)[0];
    place(s, e, at);
    for (let i = 0; i < 6 * 60; i++) {
      for (const p of s.players) p.iframes = 1e6;
      const ev = step(s, idle(s), []).events;
      if (ev.some((x) => x.t === 'enemy_attack' && x.id === e.id && x.attack === 'charge' && x.stage === 'windup')) {
        // at windup the lane from the stag to its hero is clear for the charging body
        const p = s.players[0];
        const d = Math.hypot(p.x - e.x, p.y - e.y) - BOSS_BODY.chargeBody;
        for (let t = 0; t <= d; t += 0.1) {
          expect(circleClear(s.map!, e.x + e.attack!.dx * t, e.y + e.attack!.dy * t, BOSS_BODY.chargeBody - 0.03), `lane at ${t.toFixed(1)}`).toBe(true);
        }
      }
    }
  });

  it('a charge that does slam into a pillar staggers once, the pattern moves on, it backs off the stone and is immune for a while', () => {
    const s = bossLair('prismstag', 'nave');
    const e = theBoss(s);
    // hero between the stag and a pillar: the charge runs through the hero and into the stone behind
    const m = s.map!;
    let at: Placement | null = null;
    for (const p of pillars(s)) for (let k = 0; k < 8 && !at; k++) {
      const a = (k / 8) * Math.PI * 2, c = Math.cos(a), n = Math.sin(a);
      const sx = p.x - c * 6, sy = p.y - n * 6, hx = p.x - c * 2.5, hy = p.y - n * 2.5;
      if (!roomy(m, sx, sy, 1.2) || !roomy(m, hx, hy, 0.6)) continue;
      let clear = true;
      for (let t = 0.2; t < 4.6 && clear; t += 0.2) if (!roomy(m, sx + c * t, sy + n * t, 0.95)) clear = false;
      if (clear) at = { sx, sy, hx, hy };
    }
    expect(at).not.toBeNull();
    place(s, e, at!);
    let slammed = -1, staggers = 0;
    const immuneTicks = Math.round(BOSS_BODY.slamImmuneSec * 60);
    for (let i = 0; slammed < 0 ? i < 6 * 60 : i < slammed + immuneTicks; i++) {
      for (const p of s.players) { p.iframes = 1e6; p.hp = p.maxHp; }
      const ev = step(s, idle(s), []).events;
      const st = ev.filter((x) => x.t === 'stagger' && x.id === e.id).length;
      staggers += st;
      if (st && slammed < 0) {
        slammed = i;
        expect(e.state).toBe('stagger');
        expect(e.attack).toBeNull();
        // the slam ends the charge module: the next one is up once the stagger wears off
        expect(e.patternStep).toBe(1);
        // bounced off the stone: the charging body no longer touches it
        expect(circleClear(m, e.x, e.y, BOSS_BODY.chargeBody)).toBe(true);
        expect(e.cooldowns['_slam']).toBeGreaterThan(0);
      }
    }
    expect(slammed).toBeGreaterThanOrEqual(0);
    expect(staggers).toBe(1);
  });

  it('is deterministic: the same pillar standoff replays to the same state', () => {
    const run = () => {
      const s = bossLair('prismstag', 'ritual');
      const e = theBoss(s);
      place(s, e, behindPillars(s, 3, 2, 1.2)[0]);
      watch(s, e, 8 * 60);
      return stateHash(s);
    };
    expect(run()).toBe(run());
  });

  it('plans big-body paths round one-tile gaps (findPath body), falling back to the plain path when there is none', () => {
    // a 9x7 room split by a wall with a one-tile gap at the top and a two-tile gap at the bottom
    const w = 9, h = 7;
    const tiles = new Array<number>(w * h).fill(0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x === 0 || y === 0 || x === w - 1 || y === h - 1) tiles[y * w + x] = 1;
    for (let y = 1; y < h - 1; y++) if (y !== 1 && y !== 4 && y !== 5) tiles[y * w + 4] = 1;
    const m = { w, h, tiles } as unknown as MapState;
    const thin = findPath(m, 2.5, 1.5, 6.5, 1.5);
    const big = findPath(m, 2.5, 1.5, 6.5, 1.5, undefined, 0.6);
    expect(thin).toContain(1 * w + 4);          // straight through the one-tile gap
    expect(big).not.toContain(1 * w + 4);       // the big body goes round by the two-tile gap
    expect(big.some((i) => i === 4 * w + 4 || i === 5 * w + 4)).toBe(true);
    tiles[4 * w + 4] = 1;                       // close the wide gap: only the narrow one is left
    expect(findPath(m, 2.5, 1.5, 6.5, 1.5, undefined, 0.6)).toEqual(findPath(m, 2.5, 1.5, 6.5, 1.5));
  });
});

describe('the Bell Golem among its posts', () => {
  for (const arena of ['belltower', 'colosseum'] as const) {
    it(`${arena}: walks round a post to reach a hero behind it, and never slams (and staggers) twice in a row`, () => {
      let tried = 0;
      for (const k0 of [0, 60]) {
        const count = behindPillars(bossLair('bellroot', arena, k0), 3, 2, 1.7).length;
        for (let j = 0; j < Math.min(count, 4); j++) {
          const s = bossLair('bellroot', arena, k0);
          const e = theBoss(s);
          place(s, e, behindPillars(s, 3, 2, 1.7)[j]);
          const r = watch(s, e, 20 * 60);
          const tag = `${arena} seed@${k0} post ${j}`;
          tried++;
          // the Bell Slam's reach (3.6) plus the half unit it closes to before swinging
          expect(r.minD, `${tag} closest approach`).toBeLessThanOrEqual(4.1 + 1e-6);
          expect(r.maxStall, `${tag} stall ticks`).toBeLessThan(60);
          // the slam's exposed-core stagger used to cut the module short before the pattern advanced: slam, stagger,
          // slam, stagger... Now another module always comes between two slams.
          const order = r.evs.filter((x): x is Extract<SimEvent, { t: 'enemy_attack' }> => x.t === 'enemy_attack' && x.id === e.id && x.stage === 'release').map((x) => x.attack);
          expect(order.filter((a) => a === 'slam').length, `${tag} slams`).toBeGreaterThan(0);
          for (let i = 1; i < order.length; i++) expect(order[i] === 'slam' && order[i - 1] === 'slam', `${tag} back-to-back slams at ${i}: ${order.join(',')}`).toBe(false);
        }
      }
      expect(tried).toBeGreaterThan(0);
    });
  }
});
