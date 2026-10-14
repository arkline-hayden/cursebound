import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { AFFLICTION_RULES as AR, AFFIX_RULES, ENEMY_BY_ID, RULES, contentHash, validateContent } from '@cursebound/content';
import {
  ACTION, addChill, afflict, buildSnapshot, createEnemy, createRun, devSpawn, healPlayer, hasStatus, inflictHit, killEnemy, moveLimitsOf, moveSpeedOf,
  nearestFloor, packCountFor, packSites, predictMoveTick, rayDistance, seedRng, setupRound, spawnWave, stateHash, step,
  type EnemyState, type MoveBody, type PlayerInput, type Projectile, type SimEvent, type SimState,
} from '@cursebound/simulation';
import { makeElite } from '../src/elites';
import { newRun, runBot } from './run.helpers';

// Foes: Diablo-style population (director.ts), idle packs, hero afflictions (afflictions.ts) and their prediction parity.

const T = (sec: number) => Math.round(sec * 60);

/** A combat round with an inert, far-away objective anchor so the round stays open while we test. */
function arena(round = 3, seed = 'FOES_ARENA', classId = 'vanguard'): SimState {
  const s = newRun([classId], seed);
  s.round = round;
  setupRound(s, []);
  s.phase = 'COMBAT';
  s.enemies = []; s.pendingSpawns = [];
  const enc = s.encounter!;
  enc.groups = [{ id: 99, weight: 1, archetype: 'guardian', wave: 0, spawned: true, defeated: false, countText: '1' }];
  enc.wave = 0; enc.waveCount = 1; enc.objectiveTotal = 1;
  const p = s.players[0];
  let fx = p.x, fy = p.y, fd = -1;
  const map = s.map!;
  for (let i = 0; i < map.tiles.length; i++) {
    if (map.tiles[i] !== 0) continue;
    const x = (i % map.w) + 0.5, y = Math.floor(i / map.w) + 0.5;
    const d = (x - p.x) ** 2 + (y - p.y) ** 2;
    if (d > fd) { fd = d; fx = x; fy = y; }
  }
  const anchor = devSpawn(s, 'guardian', fx, fy);
  anchor.objective = true; anchor.groupId = 99; anchor.staggerUntil = 1e12;
  return s;
}

/** The most open of 8 directions from the hero. */
function openDir(s: SimState): [number, number] {
  const p = s.players[0];
  let best: [number, number] = [1, 0]; let bd = -1;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const dx = Math.round(Math.cos(a) * 1e6) / 1e6, dy = Math.round(Math.sin(a) * 1e6) / 1e6;
    const d = rayDistance(s.map!, p.x, p.y, dx, dy, 12);
    if (d > bd + 1e-9) { bd = d; best = [dx, dy]; }
  }
  return best;
}

function inp(seq: number, mx = 0, my = 0, buttons = 0): PlayerInput {
  return { seq, moveX: Math.round(mx * 127) / 127, moveY: Math.round(my * 127) / 127, aimX: 1, aimY: 0, buttons };
}

function run(s: SimState, ticks: number, input?: (i: number) => PlayerInput | null): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks && s.phase === 'COMBAT'; i++) all.push(...step(s, [input ? input(i) : null]).events);
  return all;
}

/** An inert foe near the hero (attacks on long cooldowns, never moves on its own). */
function foe(s: SimState, kind: string, dx: number, dy: number): EnemyState {
  const p = s.players[0];
  const [x, y] = nearestFloor(s.map!, p.x + dx, p.y + dy);
  const e = devSpawn(s, kind, x, y);
  for (const a of ENEMY_BY_ID[kind].attacks) e.cooldowns[a.id] = 9999;
  e.moveSpeed = 0;
  return e;
}

function enemyShot(s: SimState, owner: EnemyState, kind: string, skillId: string, x: number, y: number, vx: number, vy: number, lob?: { x: number; y: number }): Projectile {
  const pr: Projectile = {
    id: s.nextId++, kind, owner: 'enemy', ownerId: owner.id, x, y, vx, vy, radius: 0.28, range: 9, damage: Big.from(5), weight: Big.ONE,
    dtype: 'physical', pierce: 0, hitIds: [], skillId, crit: false, lobTarget: lob ? { x: lob.x, y: lob.y, radius: 1.2, landTick: s.tick + 2 } : null, bornTick: s.tick,
  };
  s.projectiles.push(pr);
  return pr;
}

const afflicts = (ev: SimEvent[], status?: string) => ev.filter((e): e is Extract<SimEvent, { t: 'afflict' }> => e.t === 'afflict' && (!status || e.s === status));

describe('content', () => {
  it('validates, with the four impeding archetypes, pack tables and an affliction per boss', () => {
    expect(validateContent()).toEqual([]);
    for (const id of ['gaoler', 'rimewraith', 'gloomshade', 'webweaver']) expect(ENEMY_BY_ID[id]).toBeTruthy();
    expect(ENEMY_BY_ID.gaoler.attacks.find((a) => a.id === 'hook')!.inflict!.status).toBe('chained');
    expect(ENEMY_BY_ID.rimewraith.attacks[0].inflict!.status).toBe('chill');
    expect(ENEMY_BY_ID.gloomshade.attacks.find((a) => a.kind === 'burst')!.inflict!.status).toBe('blinded');
    expect(ENEMY_BY_ID.webweaver.attacks.find((a) => a.kind === 'lob')!.inflict!.status).toBe('rooted');
    expect(ENEMY_BY_ID.artillery.attacks[0].inflict!.status).toBe('poisoned');
    expect(ENEMY_BY_ID.hexer.attacks.find((a) => a.id === 'orb')!.inflict!.status).toBe('silenced');
  });
});

describe('afflictions', () => {
  it('chain: a hook chains the hero to the ground where it hit; the chain holds within its radius and runs out', () => {
    const s = arena();
    const p = s.players[0];
    const [dx, dy] = openDir(s);
    const g = foe(s, 'gaoler', -dx * 3, -dy * 3);
    enemyShot(s, g, 'hook', 'hook', p.x - dx * 1.2, p.y - dy * 1.2, dx * 11, dy * 11);
    const ev = run(s, 6);
    expect(hasStatus(s, p, 'chained')).toBe(true);
    const lim = moveLimitsOf(s, p);
    expect(lim.teth).toBeTruthy();
    const [ax, ay, r] = lim.teth!;
    expect(r).toBe(AR.chainRadius);
    expect(afflicts(ev, 'chained')).toHaveLength(1);
    const sp = buildSnapshot(s).players[0];
    expect(sp.buffs).toContain('chained');
    expect(sp.teth![2]).toBe(AR.chainRadius);
    // walk directly away (toward open floor): never beyond the chain
    let seq = 100;
    let maxD = 0;
    for (let i = 0; i < T(1.8); i++) { run(s, 1, () => inp(++seq, dx, dy)); if (hasStatus(s, p, 'chained')) maxD = Math.max(maxD, Math.hypot(p.x - ax, p.y - ay)); }
    expect(maxD).toBeLessThanOrEqual(r + 1e-6);
    expect(maxD).toBeGreaterThan(r - 0.2);   // it did pull taut
    const ev2 = run(s, T(AR.chainSec), () => inp(++seq, dx, dy));
    expect(hasStatus(s, p, 'chained')).toBe(false);
    expect(afflicts(ev2, 'chain_break').length).toBeGreaterThanOrEqual(1);
    expect(Math.hypot(p.x - ax, p.y - ay)).toBeGreaterThan(r + 0.5);   // free again
  });

  it('chain counterplay: dodge i-frames let the hook pass; a dash breaks a chain', () => {
    const s = arena(3, 'FOES_CHAIN2');
    const p = s.players[0];
    const [dx, dy] = openDir(s);
    const g = foe(s, 'gaoler', dx * 5, dy * 5);
    p.iframes = 0.5;
    enemyShot(s, g, 'hook', 'hook', p.x + dx * 1.2, p.y + dy * 1.2, -dx * 11, -dy * 11);
    run(s, 6);
    expect(hasStatus(s, p, 'chained')).toBe(false);
    run(s, 60);
    p.iframes = 0;
    enemyShot(s, g, 'hook', 'hook', p.x + dx * 1.2, p.y + dy * 1.2, -dx * 11, -dy * 11);
    run(s, 6);
    expect(hasStatus(s, p, 'chained')).toBe(true);
    const ev = run(s, 3, (i) => inp(500 + i, -dx, -dy, i === 1 ? ACTION.DODGE : 0));
    expect(hasStatus(s, p, 'chained')).toBe(false);
    expect(afflicts(ev, 'chain_break')).toHaveLength(1);
  });

  it('freeze: three chills within the window freeze (no move, attack or cast), then a short freeze immunity', () => {
    const s = arena(3, 'FOES_FREEZE');
    const p = s.players[0];
    const ev: SimEvent[] = [];
    const w = foe(s, 'rimewraith', 4, 0);
    inflictHit(s, ev, p, 'frostbolt', { srcId: w.id });
    expect(hasStatus(s, p, 'chill')).toBe(true);
    expect(buildSnapshot(s).players[0].chs).toBe(1);
    run(s, 30);
    inflictHit(s, ev, p, 'frostbolt', { srcId: w.id });
    expect(hasStatus(s, p, 'frozen')).toBe(false);
    run(s, 30);
    inflictHit(s, ev, p, 'frostbolt', { srcId: w.id });
    expect(hasStatus(s, p, 'frozen')).toBe(true);
    expect(afflicts(ev, 'frozen')[0].sec).toBe(AR.freezeSec);
    const x0 = p.x, y0 = p.y;
    const evs = run(s, T(AR.freezeSec) - 2, (i) => inp(600 + i, 1, 0, ACTION.ATTACK | ACTION.SIGNATURE | (i === 5 ? ACTION.DODGE : 0)));
    expect(p.x).toBe(x0); expect(p.y).toBe(y0);
    expect(evs.filter((e) => e.t === 'cast' || e.t === 'dodge')).toHaveLength(0);
    run(s, 4);
    expect(hasStatus(s, p, 'frozen')).toBe(false);
    // freeze immunity: three more chills right away only slow
    for (let i = 0; i < 3; i++) inflictHit(s, ev, p, 'frostbolt', { srcId: w.id });
    expect(hasStatus(s, p, 'frozen')).toBe(false);
    expect(hasStatus(s, p, 'chill')).toBe(true);
    // stacks lapse after the window
    const s2 = arena(3, 'FOES_FREEZE2');
    const p2 = s2.players[0];
    const e2: SimEvent[] = [];
    addChill(s2, e2, p2, 0.3, 2, 1); addChill(s2, e2, p2, 0.3, 2, 1);
    run(s2, T(AR.freezeStackWindowSec) + 5);
    addChill(s2, e2, p2, 0.3, 2, 1);
    expect(hasStatus(s2, p2, 'frozen')).toBe(false);
  });

  it('poison: damage over time and halved healing from every heal while it lasts', () => {
    const s = arena(3, 'FOES_POISON');
    const p = s.players[0];
    p.hp = p.maxHp.div(Big.from(2));
    const ev: SimEvent[] = [];
    const base = p.hp;
    healPlayer(s, ev, p, Big.from(100));
    const clean = p.hp.sub(base).toNumber();
    p.hp = base;
    expect(afflict(s, ev, p, 'poisoned', AR.poisonSec, { dps: Big.from(40), source: 'Bile Toad', attack: 'Bile Glob' })).toBeGreaterThan(0);
    healPlayer(s, ev, p, Big.from(100));
    expect(p.hp.sub(base).toNumber()).toBeCloseTo(clean * Number(AR.poisonHealFactor), 6);
    const hp1 = p.hp;
    const evs = run(s, T(AR.poisonSec) + 10);
    const ticks = evs.filter((e) => e.t === 'hit' && e.targetKind === 'player');
    expect(ticks.length).toBeGreaterThanOrEqual(Math.round(AR.poisonSec / AR.poisonTickSec) - 1);
    expect(ticks.length).toBeLessThanOrEqual(Math.round(AR.poisonSec / AR.poisonTickSec));
    expect(p.hp.lt(hp1)).toBe(true);
    expect(hasStatus(s, p, 'poisoned')).toBe(false);
    // the Bile Toad glob poisons and leaves a venom puddle
    const t = foe(s, 'artillery', 5, 0);
    enemyShot(s, t, 'lob', 'lob', t.x, t.y, 0, 0, { x: p.x, y: p.y });
    run(s, 4);
    expect(hasStatus(s, p, 'poisoned')).toBe(true);
    expect(s.hazards.some((h) => h.kind === 'venom')).toBe(true);
  });

  it('blind: the Gloom Shade burst blinds heroes inside its marked circle; i-frames avoid it', () => {
    const s = arena(3, 'FOES_BLIND');
    const p = s.players[0];
    const g = foe(s, 'gloomshade', 3, 0);
    const burst = () => {
      g.attack = { attackId: 'shadowburst', stage: 'windup', timer: 0.01, ox: p.x, oy: p.y, dx: -1, dy: 0, tx: p.x, ty: p.y, hitSlots: [], telegraphId: -1 };
      g.state = 'windup'; g.staggerUntil = 0;
    };
    burst();
    const ev = run(s, 2);
    expect(ev.some((e) => e.t === 'foe_fx' && e.fx === 'shadowburst')).toBe(true);
    expect(hasStatus(s, p, 'blinded')).toBe(true);
    expect(buildSnapshot(s).players[0].buffs).toContain('blinded');
    run(s, T(AR.blindSec) + 2);
    expect(hasStatus(s, p, 'blinded')).toBe(false);
    g.cooldowns.shadowburst = 0;
    p.iframes = 0.5;
    burst();
    run(s, 2);
    expect(hasStatus(s, p, 'blinded')).toBe(false);
  });

  it('root: a web glob roots (no move, no dodge) but attacks still work; the web lingers and slows', () => {
    const s = arena(3, 'FOES_ROOT');
    const p = s.players[0];
    const [dx, dy] = openDir(s);
    const wv = foe(s, 'webweaver', -dx * 4, -dy * 4);
    enemyShot(s, wv, 'web', 'webglob', wv.x, wv.y, 0, 0, { x: p.x, y: p.y });
    run(s, 4);
    expect(hasStatus(s, p, 'rooted')).toBe(true);
    expect(s.hazards.some((h) => h.kind === 'web')).toBe(true);
    const x0 = p.x, y0 = p.y;
    const ev = run(s, 30, (i) => inp(700 + i, dx, dy, ACTION.ATTACK | (i === 3 ? ACTION.DODGE : 0)));
    expect(p.x).toBe(x0); expect(p.y).toBe(y0);
    expect(ev.some((e) => e.t === 'dodge')).toBe(false);
    expect(ev.some((e) => e.t === 'cast' && e.slot === 0)).toBe(true);   // basic attacks continue
    run(s, T(AR.rootSec));
    expect(hasStatus(s, p, 'rooted')).toBe(false);
    expect(hasStatus(s, p, 'slowed')).toBe(true);   // still standing in the web
    expect(moveSpeedOf(s, p)).toBeLessThan(moveSpeedOf({ ...s, tick: s.tick + 1e6 } as SimState, p));
  });

  it('silence: the curse orb silences skills; basic attacks still work', () => {
    const s = arena(3, 'FOES_SILENCE');
    const p = s.players[0];
    const [dx, dy] = openDir(s);
    const h = foe(s, 'hexer', dx * 5, dy * 5);
    enemyShot(s, h, 'orb', 'orb', p.x + dx * 1.2, p.y + dy * 1.2, -dx * 6, -dy * 6);
    run(s, 12);
    expect(hasStatus(s, p, 'silenced')).toBe(true);
    const sig = p.skills[p.skills.length - 1].skillId;
    p.resource = 999;
    const ev = run(s, 45, (i) => inp(800 + i, 0, 0, ACTION.ATTACK | ACTION.SIGNATURE));
    expect(ev.some((e) => e.t === 'cast' && e.skill === sig)).toBe(false);
    expect(ev.some((e) => e.t === 'cast' && e.slot === 0)).toBe(true);
    run(s, T(AR.silenceSec));
    expect(hasStatus(s, p, 'silenced')).toBe(false);
    p.resource = 999;
    const ev2 = run(s, 4, (i) => inp(900 + i, 0, 0, ACTION.SIGNATURE));
    expect(ev2.some((e) => e.t === 'cast' && e.skill === sig)).toBe(true);
  });

  it('diminishing returns per family: half within the window, then ignored; full again after it', () => {
    const s = arena(3, 'FOES_DR');
    const p = s.players[0];
    const ev: SimEvent[] = [];
    expect(afflict(s, ev, p, 'rooted', 1.5)).toBe(1.5);
    expect(afflict(s, ev, p, 'chained', 2.5)).toBe(1.25);       // same family (immobilize): half
    expect(afflict(s, ev, p, 'frozen', 1)).toBe(0);             // third: ignored
    expect(afflicts(ev, 'frozen')[0].sec).toBe(0);              // shown as resisted
    expect(afflict(s, ev, p, 'silenced', 2)).toBe(2);           // other families unaffected
    expect(afflict(s, ev, p, 'blinded', 2.5)).toBe(2.5);
    run(s, T(AR.drWindowSec) + 2);
    expect(afflict(s, ev, p, 'rooted', 1.5)).toBe(1.5);
  });

  it('nothing lands while a boss-intro cinematic holds the fight; poison does not tick', () => {
    const s = arena(3, 'FOES_CINE');
    const p = s.players[0];
    const ev: SimEvent[] = [];
    afflict(s, ev, p, 'poisoned', 3, { dps: Big.from(50) });
    s.cinematicUntilTick = s.tick + 120;
    expect(afflict(s, ev, p, 'rooted', 1.5)).toBe(0);
    addChill(s, ev, p, 0.3, 2, 3);
    expect(hasStatus(s, p, 'frozen')).toBe(false);
    const hp = p.hp;
    for (let i = 0; i < 100; i++) step(s, [null]);
    expect(p.hp.eq(hp)).toBe(true);
  });
});

describe('boss afflictions', () => {
  it('the Bell Golem chain lash chains whoever it catches', () => {
    const s = arena(5, 'FOES_BELL');
    const p = s.players[0];
    const [dx, dy] = openDir(s);
    const [bx, by] = nearestFloor(s.map!, p.x + dx * 3, p.y + dy * 3);
    const b = createEnemy(s, 'bellroot', bx, by, Big.ONE, { boss: true, objective: false, groupId: -1, summonerId: null });
    s.enemies.push(b);
    const ldx = p.x - b.x, ldy = p.y - b.y, l = Math.hypot(ldx, ldy);
    s.telegraphs.push({ id: s.nextId++, ownerId: b.id, shape: { kind: 'line', length: 10, width: 0.9 }, x: b.x, y: b.y, dx: ldx / l, dy: ldy / l, startTick: s.tick, releaseTick: s.tick + 1, attack: 'rootwall' });
    b.attack = { attackId: 'rootwall', stage: 'windup', timer: 0.01, ox: b.x, oy: b.y, dx: ldx / l, dy: ldy / l, tx: p.x, ty: p.y, hitSlots: [], telegraphId: -1 };
    b.state = 'windup';
    const ev = run(s, 2);
    expect(hasStatus(s, p, 'chained')).toBe(true);
    expect(afflicts(ev, 'chained')[0].sec).toBe(2);
  });

  it('the Hollow Stag ghost-fire bursts blind', () => {
    const s = arena(5, 'FOES_STAG');
    const p = s.players[0];
    const [bx, by] = nearestFloor(s.map!, p.x + 3, p.y);
    const b = createEnemy(s, 'prismstag', bx, by, Big.ONE, { boss: true, objective: false, groupId: -1, summonerId: null });
    b.staggerUntil = 1e12;
    s.enemies.push(b);
    s.hazards.push({ id: s.nextId++, kind: 'lightpool', owner: 'enemy', ownerId: b.id, x: p.x, y: p.y, dx: 1, dy: 0, length: 0, width: 0, radius: 1.3, inner: 0, outer: 0, speed: 0, bornTick: s.tick, untilTick: s.tick + 2, nextTick: s.tick, interval: 99999, damage: Big.from(5), dtype: 'astral', generation: 2, hitSlots: [] });
    run(s, 3);
    expect(hasStatus(s, p, 'blinded')).toBe(true);
  });
});

describe('elite afflictions', () => {
  it('jailer marks a lane then hooks; glacial freezes lingering heroes; venomous trails poison; blinding bursts', () => {
    const s = arena(4, 'FOES_AFFIX');
    const p = s.players[0];
    const ev: SimEvent[] = [];
    const [dx, dy] = openDir(s);
    const j = foe(s, 'pursuer', dx * 4, dy * 4);
    makeElite(s, ev, j, 1, seedRng('jailer'), ['jailer']);
    j.avars!.jlAt = s.tick;
    run(s, 2);
    expect(s.telegraphs.some((t) => t.attack === 'affix_hook')).toBe(true);
    run(s, T(AFFIX_RULES.jailerWarn) + 2);
    expect(s.projectiles.some((pr) => pr.kind === 'hook' && pr.skillId === 'affix_hook')).toBe(true);
    run(s, 40);
    expect(hasStatus(s, p, 'chained')).toBe(true);
    killEnemy(s, ev, j, 0);
    // glacial aura
    const s2 = arena(4, 'FOES_GLACIAL');
    const p2 = s2.players[0];
    const gl = foe(s2, 'guardian', 1.2, 0);
    makeElite(s2, [], gl, 1, seedRng('g'), ['glacial']);
    run(s2, T(AFFIX_RULES.glacialEvery * 3) + 4);
    expect(hasStatus(s2, p2, 'frozen')).toBe(true);
    // venomous trail
    const s3 = arena(4, 'FOES_VENOM');
    const p3 = s3.players[0];
    const vn = foe(s3, 'pursuer', 0.6, 0);
    makeElite(s3, [], vn, 1, seedRng('v'), ['venomous']);
    vn.x = p3.x; vn.y = p3.y; vn.avars!.vnX = p3.x + 1; vn.avars!.vnY = p3.y;
    run(s3, 40);
    expect(s3.hazards.some((h) => h.kind === 'venom')).toBe(true);
    expect(hasStatus(s3, p3, 'poisoned')).toBe(true);
    // blinding burst (telegraphed circle around the elite)
    const s4 = arena(4, 'FOES_BLINDING');
    const p4 = s4.players[0];
    const bl = foe(s4, 'hexer', 1.0, 0);
    makeElite(s4, [], bl, 1, seedRng('b'), ['blinding']);
    bl.avars!.blAt = s4.tick;
    run(s4, 2);
    expect(s4.telegraphs.some((t) => t.attack === 'affix_blindBurst')).toBe(true);
    run(s4, T(AFFIX_RULES.blindWarn) + 2);
    expect(hasStatus(s4, p4, 'blinded')).toBe(true);
  });
});

describe('prediction parity under afflictions', () => {
  function parity(s: SimState, apply: (s: SimState) => void, script: (i: number) => [number, number, boolean], ticks = 150) {
    const p = s.players[0];
    apply(s);
    const sp = buildSnapshot(s).players[0];
    const lim = moveLimitsOf(s, p);
    // the snapshot carries exactly the limits the authority applies (anchor rounded for bandwidth)
    expect(sp.lk ?? 0).toBe(Math.max(0, lim.lock));
    expect(sp.tk ?? 0).toBe(lim.teth ? lim.tethT : 0);
    if (lim.teth) for (let k = 0; k < 3; k++) expect(Math.abs(sp.teth![k] - lim.teth[k])).toBeLessThan(1e-3);
    const b: MoveBody = {
      x: p.x, y: p.y, vx: p.vx, vy: p.vy, dodgeTimer: p.dodgeTimer, dodgeDirX: p.dodgeDirX, dodgeDirY: p.dodgeDirY, dodgeCharges: p.dodgeCharges,
      dodgeCooldown: p.dodgeCooldown, surgeTimer: p.surgeTimer, guardTimer: 0, lock: sp.lk ?? 0, teth: lim.teth, tethT: sp.tk ?? 0,
    };
    let prev = false;
    let moved = 0;
    for (let i = 0; i < ticks; i++) {
      const [mx, my, d] = script(i);
      predictMoveTick(s.map, b, mx, my, 1, 0, d && !prev, moveSpeedOf(s, p), p.classId, 1);
      prev = d;
      const x0 = p.x, y0 = p.y;
      step(s, [inp(1000 + i, mx, my, d ? ACTION.DODGE : 0)]);
      moved += Math.hypot(p.x - x0, p.y - y0);
      expect(b.x).toBe(p.x);
      expect(b.y).toBe(p.y);
    }
    return moved;
  }
  const q = (v: number) => Math.round(v * 127) / 127;
  const wander = (i: number): [number, number, boolean] => [q(Math.cos(i * 0.09)), q(Math.sin(i * 0.09)), i % 41 === 7 || i % 41 === 13];

  it('frozen and rooted heroes stand still on both sides, then move identically when it ends', () => {
    const s = arena(3, 'FOES_PAR1');
    const moved = parity(s, (st) => { afflict(st, [], st.players[0], 'frozen', 1); }, wander);
    expect(moved).toBeGreaterThan(1);
    const s2 = arena(3, 'FOES_PAR2');
    parity(s2, (st) => { afflict(st, [], st.players[0], 'rooted', 1.5); }, wander);
  });

  it('a chained hero is held to the same circle by prediction and authority; a dash breaks it on both', () => {
    const s = arena(3, 'FOES_PAR3');
    const [dx, dy] = openDir(s);
    parity(s, (st) => { afflict(st, [], st.players[0], 'chained', 2.5, { value: 1.5 }); }, (i) => [q(dx), q(dy), false], 170);
    const s2 = arena(3, 'FOES_PAR4');
    const [ex, ey] = openDir(s2);
    parity(s2, (st) => { afflict(st, [], st.players[0], 'chained', 2.5, { value: 1.5 }); }, (i) => [q(ex), q(ey), i === 60], 120);
    expect(hasStatus(s2, s2.players[0], 'chained')).toBe(false);
  });
});

describe('population (Diablo-style packs)', () => {
  function layout(seed: string, round: number, n = 1) {
    const s = newRun(Array.from({ length: n }, () => 'vanguard'), seed);
    s.round = round;
    setupRound(s, []);
    return s;
  }

  it('packs spread through every region of the floor, never near the hero spawn', () => {
    let regions = 0, covered = 0, packs = 0, near = 0;
    for (let k = 0; k < 10; k++) {
      const s = layout('POP_SPREAD_' + k, 1 + (k % 4));
      const map = s.map!;
      const pop = s.encounter!.groups.filter((g) => g.wave === 0 && g.x !== undefined);
      expect(pop.length).toBeGreaterThan(8);
      expect(pop.every((g) => g.dormant)).toBe(true);
      const sp = map.playerSpawns[0];
      for (const g of pop) {
        packs++;
        if (Math.hypot(g.x! - sp.x, g.y! - sp.y) < RULES.packSafeRadius - 1.5) near++;
        expect(Math.hypot(g.x! - sp.x, g.y! - sp.y)).toBeGreaterThan(4);
      }
      // coarse 8x8 regions holding enough open floor away from the spawn: a pack stands within 6 tiles
      for (let ry = 0; ry < map.h; ry += 8) for (let rx = 0; rx < map.w; rx += 8) {
        const tiles: [number, number][] = [];
        for (let y = ry; y < Math.min(map.h, ry + 8); y++) for (let x = rx; x < Math.min(map.w, rx + 8); x++) {
          if (map.tiles[y * map.w + x] === 0 && Math.hypot(x + 0.5 - sp.x, y + 0.5 - sp.y) > RULES.packSafeRadius + 2) tiles.push([x + 0.5, y + 0.5]);
        }
        if (tiles.length < 16) continue;
        regions++;
        if (tiles.some(([x, y]) => pop.some((g) => Math.hypot(g.x! - x, g.y! - y) < 4))) covered++;
      }
    }
    expect(covered / regions).toBeGreaterThan(0.85);
    expect(near / packs).toBeLessThan(0.05);
  });

  it('pack count scales with floor area, round and party size; more foes in total, individually weaker', () => {
    expect(packCountFor(600, 1, 1)).toBeGreaterThan(packCountFor(350, 1, 1));
    expect(packCountFor(480, 9, 1)).toBeGreaterThan(packCountFor(480, 1, 1));
    expect(packCountFor(480, 1, 4)).toBeGreaterThan(packCountFor(480, 1, 1));
    const units = (s: SimState) => s.encounter!.groups.reduce((t, g) => t + Number(g.countText), 0);
    let r1 = 0, r7 = 0, solo = 0, trio = 0;
    for (let k = 0; k < 6; k++) {
      r1 += units(layout('POP_SCALE_' + k, 1)); r7 += units(layout('POP_SCALE_' + k, 7));
      solo += units(layout('POP_PARTY_' + k, 2, 1)); trio += units(layout('POP_PARTY_' + k, 2, 3));
    }
    expect(r7).toBeGreaterThan(r1);
    expect(trio).toBeGreaterThan(solo);
    expect(r1 / 6).toBeGreaterThan(14);   // the old director fielded ~7 foes in round 1
    expect(ENEMY_BY_ID.pursuer.baseHealth).toBeLessThan(300);
    expect(ENEMY_BY_ID.pursuer.baseDamage).toBeLessThan(60);
    // nearby sites are spread: farthest-point sampling
    const s = layout('POP_SITES', 3);
    const sites = packSites(s.map!, seedRng('sites'), 10);
    for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) expect(Math.hypot(sites[i].x - sites[j].x, sites[i].y - sites[j].y)).toBeGreaterThan(3);
  });

  it('is deterministic per seed and round (plan, spawn and elite rolls)', () => {
    const plan = (seed: string) => {
      const s = layout(seed, 6, 2);
      s.fate.factors['encounter.eliteChance'] = Big.from('1e9');
      s.phase = 'COMBAT';
      spawnWave(s, [], 0);
      return { groups: JSON.stringify(s.encounter!.groups), hash: stateHash(s) };
    };
    expect(plan('POP_DET')).toEqual(plan('POP_DET'));
    expect(plan('POP_DET').groups).not.toEqual(plan('POP_DET_B').groups);
  });

  it('only pack leads roll champions or rares', () => {
    const s = layout('POP_ELITE', 6, 1);
    s.fate.factors['encounter.eliteChance'] = Big.from('1e9');
    s.phase = 'COMBAT';
    spawnWave(s, [], 0);
    const elites = s.enemies.filter((e) => e.elite);
    expect(elites.length).toBeGreaterThan(0);
    expect(elites.length).toBeLessThanOrEqual(RULES.maxElitesPerWave);
    for (const e of elites) expect(s.encounter!.groups.find((g) => g.pack === e.pack)!.id).toBe(e.groupId);
  });

  it('idle packs stay put until a hero comes close, then wake and call nearby packs', () => {
    const s = createRun({ runId: 'r_idle', seed: 'POP_IDLE', mode: 'solo', trust: 'local', contentHash: contentHash(), roster: [{ slot: 0, profileId: 'p0', name: 'P0', classId: 'vanguard' }] });
    step(s, [], [{ type: 'READY', slot: 0, ready: true }]);
    for (let i = 0; i < 400 && s.phase !== 'COMBAT'; i++) step(s, []);
    expect(s.phase).toBe('COMBAT');
    const p = s.players[0];
    p.iframes = 1e9;
    const at = s.enemies.map((e) => [e.x, e.y]);
    for (let i = 0; i < 120; i++) step(s, [null]);
    const idle = s.enemies.filter((e) => e.dormant);
    expect(idle.length).toBe(s.enemies.length);
    expect(s.enemies.every((e, i) => e.x === at[i][0] && e.y === at[i][1])).toBe(true);
    // walk the hero onto a pack
    const target = s.enemies[0];
    p.x = target.x + 0.5; p.y = target.y;
    [p.x, p.y] = nearestFloor(s.map!, p.x, p.y);
    const ev: SimEvent[] = [];
    for (let i = 0; i < RULES.aggroCheckTicks + 2; i++) ev.push(...step(s, [null]).events);
    expect(ev.some((e) => e.t === 'aggro')).toBe(true);
    expect(s.enemies.filter((e) => e.pack === target.pack).every((e) => !e.dormant)).toBe(true);
    expect(s.enemies.some((e) => e.dormant)).toBe(true);   // far packs keep idling
    const snap = buildSnapshot(s);
    expect(snap.enc!.packs).toBe(s.encounter!.packCount);
    expect(snap.enc!.packsLeft).toBe(snap.enc!.packs);
  });

  it('the round clears once every pack and reinforcement is dead; HUD counters count down', () => {
    const s = createRun({ runId: 'r_clear', seed: 'POP_CLEAR', mode: 'solo', trust: 'local', contentHash: contentHash(), roster: [{ slot: 0, profileId: 'p0', name: 'P0', classId: 'arcanist' }] });
    step(s, [], [{ type: 'READY', slot: 0, ready: true }]);
    for (let i = 0; i < 400 && s.phase !== 'COMBAT'; i++) step(s, []);
    const total = s.encounter!.packCount!;
    let lastLeft = total;
    let waves = new Set<number>();
    for (let k = 0; k < 40 && s.phase === 'COMBAT'; k++) {
      const ev: SimEvent[] = [];
      for (const e of s.enemies) if (e.state !== 'dying') killEnemy(s, ev, e, 0);
      for (let i = 0; i < 45 && s.phase === 'COMBAT'; i++) for (const x of step(s, [null]).events) if (x.t === 'wave') waves.add(x.wave);
      if (s.phase === 'COMBAT') {
        const left = buildSnapshot(s).enc!.packsLeft!;
        expect(left).toBeLessThanOrEqual(lastLeft);
        lastLeft = left;
      }
    }
    expect(s.phase).toBe('ROUND_CLEAR');
    expect(waves.size).toBe(RULES.waveCount - 1);
  });

  it('bot runs with the population stay deterministic and progress', () => {
    const a = runBot(newRun(['vanguard'], 'POP_BOT'), { maxTicks: 60 * 150 });
    const b = runBot(newRun(['vanguard'], 'POP_BOT'), { maxTicks: 60 * 150 });
    expect(stateHash(a)).toBe(stateHash(b));
    expect(a.round).toBeGreaterThanOrEqual(2);
  });
});

describe('cursed caches', () => {
  it('ordinary floors hide a few caches far from the spawn; walking into one spills potions and an orb', () => {
    const s = createRun({ runId: 'r_cache', seed: 'CACHE_1', mode: 'solo', trust: 'local', contentHash: contentHash(), roster: [{ slot: 0, profileId: 'p0', name: 'P0', classId: 'vanguard' }] });
    step(s, [], [{ type: 'READY', slot: 0, ready: true }]);
    for (let i = 0; i < 400 && s.phase !== 'COMBAT'; i++) step(s, []);
    const caches = s.pickups.filter((k) => k.kind === 'cache');
    expect(caches.length).toBeGreaterThanOrEqual(2);
    const sp = s.map!.playerSpawns[0];
    for (const c of caches) expect(Math.hypot(c.x - sp.x, c.y - sp.y)).toBeGreaterThan(5);
    expect(caches.every((c) => c.untilTick === 0)).toBe(true);   // never expire
    const p = s.players[0];
    p.iframes = 1e9;
    for (const e of s.enemies) e.dormant = true;
    p.x = caches[0].x; p.y = caches[0].y;
    const ev = step(s, [null]).events;
    expect(ev.some((e) => e.t === 'pickup' && e.kind === 'cache')).toBe(true);
    expect(s.pickups.some((k) => k.id === caches[0].id)).toBe(false);
    expect(s.pickups.filter((k) => k.kind === 'potion').length).toBeGreaterThanOrEqual(1);
    expect(s.pickups.filter((k) => k.kind === 'orb').length).toBe(1);
    // placement is deterministic and only uses its own stream
    const again = createRun({ runId: 'r_cache', seed: 'CACHE_1', mode: 'solo', trust: 'local', contentHash: contentHash(), roster: [{ slot: 0, profileId: 'p0', name: 'P0', classId: 'vanguard' }] });
    step(again, [], [{ type: 'READY', slot: 0, ready: true }]);
    for (let i = 0; i < 400 && again.phase !== 'COMBAT'; i++) step(again, []);
    expect(again.pickups.filter((k) => k.kind === 'cache').map((k) => [k.x, k.y])).toEqual(caches.map((k) => [k.x, k.y]));
  });
});
