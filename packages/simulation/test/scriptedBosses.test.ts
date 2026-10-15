import { describe, expect, it } from 'vitest';
import { Big } from '@cursebound/numeric';
import { BOSS_BY_ID, bossesForTheme, slagLava } from '@cursebound/content';
import {
  B, ONE, bossForRound, botInput, buildSnapshot, deserializeState, hitEnemy, isWall, killEnemy, serializeState, setupRound, spawnWave, stateHash, step,
  type EnemyState, type Hazard, type PlayerInput, type SimEvent, type SimState,
} from '@cursebound/simulation';
import { newRun } from './run.helpers';

// The scripted bosses (simulation bosses/*): themed lairs, the Corrupted Core (laser grids, purge safe tiles, the
// Mirror Split and its tell) and the Iron Colossus (quake ring gaps, slag cells, overheat), their phases and
// reinforcement waves, signature loot, and determinism across a checkpoint.

/** COMBAT on a boss floor of `theme`, the grand-entrance hold skipped. */
function lair(theme: string, seed: string, round = 5, classes = ['vanguard']): SimState {
  const s = newRun(classes, seed);
  s.round = round;
  s.nextTheme = { round, theme };
  setupRound(s, []);
  s.phase = 'COMBAT';
  spawnWave(s, [], 0);
  s.cinematicUntilTick = s.tick;
  return s;
}
const realBoss = (s: SimState) => s.enemies.find((e) => e.boss && !e.bvars?.echo)!;
const idle = (s: SimState): PlayerInput[] => s.players.map((p) => ({ seq: p.lastInputSeq + 1, moveX: 0, moveY: 0, aimX: 1, aimY: 0, buttons: 0 }));
function run(s: SimState, ticks: number, each?: (s: SimState) => void): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) { each?.(s); ev.push(...step(s, idle(s), []).events); }
  return ev;
}
const shield = (s: SimState) => { for (const p of s.players) p.iframes = 1e6; };
const setFrac = (e: EnemyState, f: number) => { e.cohort.spread = e.cohort.unitHp.mul(B((1 - f).toFixed(6))); e.cohort.front = Big.ZERO; };
const hpOf = (s: SimState, slot: number) => s.players[slot].hp.toNumber();
const place = (s: SimState, slot: number, x: number, y: number) => { const p = s.players[slot]; p.x = x; p.y = y; p.vx = 0; p.vy = 0; };
/** An open floor point near the boss's home satisfying `ok` (spiral search). */
function findSpot(s: SimState, cx: number, cy: number, ok: (x: number, y: number) => boolean, minD = 2.5, maxD = 8): { x: number; y: number } {
  for (let r = minD; r <= maxD; r += 0.5) for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (!isWall(s.map!, Math.floor(x), Math.floor(y)) && ok(x, y)) return { x, y };
  }
  throw new Error('no spot');
}

describe('themed lairs', () => {
  it('a server floor lairs the Corrupted Core, a forge floor the Iron Colossus; other themes keep the classic pair', () => {
    for (const [theme, id, arena] of [['server', 'corruptcore', 'datavault'], ['forge', 'ironcolossus', 'foundry']] as const) {
      const s = lair(theme, 'LAIR_' + theme);
      expect(s.encounter!.bossId).toBe(id);
      expect(s.map!.arena).toBe(arena);
      expect(bossForRound('LAIR_' + theme, 5, theme)).toBe(id);
      expect(bossesForTheme(theme)).toEqual([id]);
    }
    const seen = new Set<string>();
    for (let k = 0; k < 12; k++) for (const theme of ['catacombs', 'flooded', 'ossuary', 'sanctum', 'fungal', 'frost']) {
      const id = bossForRound('CLASSIC' + k, 5 + 5 * (k % 3), theme)!;
      expect(['prismstag', 'bellroot']).toContain(id);
      seen.add(id);
    }
    expect([...seen].sort()).toEqual(['bellroot', 'prismstag']);
  });

  it('the boss rises on the dais of its own lair, inside the arena, among its furniture', () => {
    for (const theme of ['server', 'forge']) {
      const s = lair(theme, 'SPAWN_' + theme);
      const b = realBoss(s);
      expect({ x: b.x, y: b.y }).toEqual(s.map!.bossSpawn);
      const room = s.map!.rooms!.find((r) => r.kind === 'arena')!;
      expect(b.x >= room.x && b.x < room.x + room.w && b.y >= room.y && b.y < room.y + room.h).toBe(true);
      // free-standing furniture (rack rows and pylons / furnaces and anvils) stands inside the lair
      let blocks = 0;
      for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) {
        if (!isWall(s.map!, x, y)) continue;
        const free = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => !isWall(s.map!, x + dx, y + dy)).length;
        if (free >= 3) blocks++;
      }
      expect(blocks).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('phases and reinforcements', () => {
  it('both scripted bosses change phase at 2/3 and 1/3 and call one reinforcement wave at each', () => {
    for (const theme of ['server', 'forge']) {
      const s = lair(theme, 'PHASE_' + theme);
      const b = realBoss(s);
      run(s, 5, shield);
      setFrac(b, 0.6);
      let ev = run(s, 3, shield);
      expect(ev.filter((e) => e.t === 'boss_phase').map((e) => (e as { phase: number }).phase)).toEqual([1]);
      expect(ev.filter((e) => e.t === 'boss_adds').map((e) => (e as { wave: number }).wave)).toEqual([1]);
      setFrac(b, 0.3);
      ev = run(s, 3, shield);
      expect(ev.filter((e) => e.t === 'boss_phase').map((e) => (e as { phase: number }).phase)).toEqual([2]);
      expect(ev.filter((e) => e.t === 'boss_adds').map((e) => (e as { wave: number }).wave)).toEqual([2]);
      ev = run(s, 150, shield);
      expect(ev.some((e) => e.t === 'boss_adds')).toBe(false);
      expect(s.encounter!.phaseAddsSpawned).toEqual([1, 2]);
      expect(s.enemies.some((e) => !e.boss && e.summonerId === b.id && e.state !== 'dying')).toBe(true);
      expect(b.phaseIndex).toBe(2);
    }
  });
});

describe('the Corrupted Core', () => {
  it('laser grids leave every few lanes dark: a hero in a dark lane is spared, one in a lit lane is hit', () => {
    const s = lair('server', 'LASER_1', 5, ['vanguard', 'templar']);
    const b = realBoss(s);
    b.patternIndex = 0; b.patternStep = 0; b.cooldowns['_pause'] = 0;   // phase 1, pattern 1 opens with the grid
    run(s, 2);
    const lanes = s.telegraphs.filter((t) => t.attack === 'cc_lasergrid');
    expect(lanes.length).toBeGreaterThan(5);
    const inLane = (x: number, y: number) => lanes.some((t) => {
      const sh = t.shape as { length: number; width: number };
      const vx = x - t.x, vy = y - t.y, along = vx * t.dx + vy * t.dy, perp = Math.abs(-vx * t.dy + vy * t.dx);
      return along >= -0.4 && along <= sh.length + 0.4 && perp <= sh.width / 2 + 0.4;
    });
    const hx = b.bvars!.hx, hy = b.bvars!.hy;
    const lit = findSpot(s, hx, hy, (x, y) => inLane(x, y) && lanes.some((t) => {
      const sh = t.shape as { length: number; width: number };
      const vx = x - t.x, vy = y - t.y;
      return Math.abs(-vx * t.dy + vy * t.dx) < 0.2 && vx * t.dx + vy * t.dy > 0.5 && vx * t.dx + vy * t.dy < sh.length - 0.5;
    }));
    const dark = findSpot(s, hx, hy, (x, y) => !inLane(x, y));
    place(s, 0, lit.x, lit.y);
    place(s, 1, dark.x, dark.y);
    const h0 = hpOf(s, 0), h1 = hpOf(s, 1);
    let fired = false;
    for (let i = 0; i < 150 && !fired; i++) {
      place(s, 0, lit.x, lit.y); place(s, 1, dark.x, dark.y);
      fired = step(s, idle(s), []).events.some((e) => e.t === 'foe_fx' && e.fx === 'cc_laser');
    }
    expect(fired).toBe(true);
    expect(hpOf(s, 0)).toBeLessThan(h0);
    expect(hpOf(s, 1)).toBe(h1);
  });

  it('the purge spares heroes standing on a safe tile and hits everyone else', () => {
    const s = lair('server', 'PURGE_1', 5, ['vanguard', 'templar']);
    const b = realBoss(s);
    b.phaseIndex = 2; b.patternIndex = 0; b.patternStep = 0; b.cooldowns['_pause'] = 0;   // the purge phase opens with it
    run(s, 2);
    const safe = s.hazards.filter((h) => h.kind === 'cc_safe');
    expect(safe.length).toBe(3);   // heroes + 1
    expect(s.hazards.some((h) => h.kind === 'cc_purge')).toBe(true);
    const away = findSpot(s, b.bvars!.hx, b.bvars!.hy, (x, y) => safe.every((h) => (x - h.x) ** 2 + (y - h.y) ** 2 > 3 * 3), 1, 9);
    const h0 = hpOf(s, 0), h1 = hpOf(s, 1);
    let purged = false;
    for (let i = 0; i < 260 && !purged; i++) {
      place(s, 0, safe[0].x, safe[0].y); place(s, 1, away.x, away.y);
      purged = step(s, idle(s), []).events.some((e) => e.t === 'foe_fx' && e.fx === 'cc_purge');
    }
    expect(purged).toBe(true);
    expect(hpOf(s, 0)).toBe(h0);
    expect(hpOf(s, 1)).toBeLessThan(h1);
  });

  it('the Mirror Split makes two fragile echoes that copy it rotated about its platform; only the real eye tracks the hero', () => {
    const s = lair('server', 'SPLIT_1');
    const b = realBoss(s);
    b.phaseIndex = 1; b.patternIndex = 0; b.patternStep = 0; b.cooldowns['_pause'] = 0;   // phase 2 opens with the split
    let echoes: EnemyState[] = [];
    for (let i = 0; i < 240 && !echoes.length; i++) { run(s, 1, shield); echoes = s.enemies.filter((e) => e.bvars?.echo && e.state !== 'dying'); }
    expect(echoes).toHaveLength(2);
    for (const c of echoes) {
      expect(c.kind).toBe('corruptcore');
      expect(c.boss).toBe(true);
      expect(c.objective).toBe(false);
      expect(c.summonerId).toBe(b.id);
      expect(c.cohort.unitHp.lt(b.cohort.unitHp.mul(B('0.2')))).toBe(true);
    }
    expect(buildSnapshot(s).enemies.filter((e) => e.echo).map((e) => e.i).sort()).toEqual(echoes.map((e) => e.id).sort());
    expect(buildSnapshot(s).enc!.bossHp).toBeCloseTo(1, 3);   // the boss bar follows the real Core only
    run(s, 40, shield);
    const hx = b.bvars!.hx, hy = b.bvars!.hy;
    const rel = echoes.map((c) => (((Math.atan2(c.y - hy, c.x - hx) - Math.atan2(b.y - hy, b.x - hx)) * 180) / Math.PI + 720) % 360).sort((p, q) => p - q);
    expect(Math.abs(rel[0] - 120)).toBeLessThan(15);
    expect(Math.abs(rel[1] - 240)).toBeLessThan(15);
    // the tell: every echo's facing is the real Core's facing rotated by its angle, i.e. not at the hero
    for (const c of echoes) {
      const r = c.bvars!.rot;
      expect(c.fx).toBeCloseTo(b.fx * Math.cos(r) - b.fy * Math.sin(r), 6);
      expect(c.fy).toBeCloseTo(b.fx * Math.sin(r) + b.fy * Math.cos(r), 6);
      expect(c.state).toBe(b.state);
    }
    // a destroyed echo drops no loot and bursts into corrupted tiles
    const loot = (s.loot ?? []).length;
    const pop = echoes[0];
    killEnemy(s, [], pop, 0);
    expect((s.loot ?? []).length).toBe(loot);
    expect(s.hazards.some((h) => h.kind === 'cc_corrupt' && h.x === Math.floor(pop.x) + 0.5 && h.y === Math.floor(pop.y) + 0.5)).toBe(true);
    // the split runs out: the other echo dissolves back into the Core
    const ev = run(s, 60 * 17, shield);
    expect(ev.some((e) => e.t === 'foe_fx' && e.fx === 'cc_merge')).toBe(true);
    expect(s.enemies.some((e) => e.bvars?.echo && e.state !== 'dying')).toBe(false);
    expect(b.bvars!.spl).toBe(0);
  });

  it('echoes fall with the Core', () => {
    const s = lair('server', 'SPLIT_2');
    const b = realBoss(s);
    b.phaseIndex = 1; b.patternIndex = 0; b.patternStep = 0; b.cooldowns['_pause'] = 0;
    for (let i = 0; i < 240 && !s.enemies.some((e) => e.bvars?.echo); i++) run(s, 1, shield);
    killEnemy(s, [], b, 0);
    expect(s.enemies.filter((e) => e.bvars?.echo).every((e) => e.state === 'dying')).toBe(true);
    expect(s.loot!.filter((it) => it.itemId === BOSS_BY_ID.corruptcore.loot![0]).length).toBe(1);
  });
});

describe('the Iron Colossus', () => {
  it('overheat leaves it standing, vulnerable (x2.2 damage taken) and scalding anyone close', () => {
    const s = lair('forge', 'HEAT_1');
    const b = realBoss(s);
    b.patternIndex = 2; b.patternStep = 1; b.cooldowns['_pause'] = 0;   // phase 1, pattern 3: hammer, then overheat
    const hit = () => hitEnemy(s, [], b, B(1000), ONE, { dtype: 'physical', srcSlot: 99, skillId: 'test', fromX: b.x, fromY: b.y, allowCrit: false }).dealt;
    const cold = hit();
    let ev: SimEvent[] = [];
    for (let i = 0; i < 120 && b.staggerUntil <= s.tick; i++) ev = ev.concat(run(s, 1, shield));
    expect(b.staggerUntil).toBeGreaterThan(s.tick);
    expect(ev.some((e) => e.t === 'foe_fx' && e.fx === 'ic_overheat')).toBe(true);
    expect(s.hazards.some((h) => h.kind === 'ic_heat')).toBe(true);
    const hot = hit();
    expect(hot.div(cold).toNumber()).toBeCloseTo(Number(BOSS_BY_ID.ironcolossus.vulnerableMultiplier), 3);
    const x0 = b.x, y0 = b.y;
    run(s, 60, shield);
    expect([b.x, b.y]).toEqual([x0, y0]);
    expect(b.state).toBe('stagger');
  });

  it('quake rings roll outward from the impact: the gap spares, the band hits', () => {
    const s = lair('forge', 'QUAKE_1', 5, ['vanguard', 'templar']);
    const b = realBoss(s);
    b.cooldowns['_pause'] = 99;
    const cx = b.x, cy = b.y;
    const ring: Hazard = {
      id: s.nextId++, kind: 'ic_quake', owner: 'enemy', ownerId: b.id, x: cx, y: cy, dx: 1, dy: 0, length: 0, width: 0.42, radius: 0,
      inner: 0.5, outer: 1.2, speed: 4, bornTick: s.tick, untilTick: s.tick + 300, nextTick: s.tick, interval: 1, damage: B(40), dtype: 'physical', generation: 0, hitSlots: [],
    };
    s.hazards.push(ring);
    const h0 = hpOf(s, 0), h1 = hpOf(s, 1);
    run(s, 70, (st) => { place(st, 0, cx + 3.5, cy); place(st, 1, cx - 3.5, cy); });
    expect(hpOf(s, 0)).toBe(h0);
    expect(hpOf(s, 1)).toBeLessThan(h1);
    expect(ring.hitSlots).toEqual([1]);
  });

  it('slag burns only the cells its pattern marks, and only once it has erupted', () => {
    const s = lair('forge', 'SLAG_1', 5, ['vanguard', 'templar']);
    const b = realBoss(s);
    b.cooldowns['_pause'] = 99;
    const cx = Math.floor(b.x), cy = Math.floor(b.y);
    const arm = s.tick + 30;
    s.hazards.push({
      id: s.nextId++, kind: 'ic_slag', owner: 'enemy', ownerId: b.id, x: cx + 0.5, y: cy + 0.5, dx: 1, dy: 0, length: 30, width: 1.6, radius: 9,
      inner: 0, outer: 0, speed: 2, bornTick: s.tick, untilTick: arm + 120, nextTick: arm, armTick: arm, interval: 30, damage: B(20), dtype: 'ember', generation: 0, hitSlots: [],
    });
    const lava = findSpot(s, cx + 0.5, cy + 0.5, (x, y) => slagLava(0, 0, cx, cy, Math.floor(x), Math.floor(y), 9, 1.6, 2), 3, 7);
    const clear = findSpot(s, cx + 0.5, cy + 0.5, (x, y) => !slagLava(0, 0, cx, cy, Math.floor(x), Math.floor(y), 9, 1.6, 2), 3, 7);
    const h0 = hpOf(s, 0), h1 = hpOf(s, 1);
    run(s, 25, (st) => { place(st, 0, lava.x, lava.y); place(st, 1, clear.x, clear.y); });
    expect(hpOf(s, 0)).toBe(h0);   // still glowing: no burn yet
    const ev = run(s, 40, (st) => { place(st, 0, lava.x, lava.y); place(st, 1, clear.x, clear.y); });
    expect(ev.some((e) => e.t === 'foe_fx' && e.fx === 'ic_slag')).toBe(true);
    expect(hpOf(s, 0)).toBeLessThan(h0);
    expect(hpOf(s, 1)).toBe(h1);
  });

  it('drops the Heart of the Iron Colossus while nobody wears it', () => {
    const s = lair('forge', 'LOOT_1');
    killEnemy(s, [], realBoss(s), 0);
    expect(s.loot!.some((it) => it.itemId === 'lg_heart_of_the_colossus')).toBe(true);
    const s2 = lair('forge', 'LOOT_2');
    s2.players[0].gear = { chest: 'lg_heart_of_the_colossus' };
    killEnemy(s2, [], realBoss(s2), 0);
    expect(s2.loot!.length).toBe(1);
    expect(s2.loot!.some((it) => it.itemId === 'lg_heart_of_the_colossus')).toBe(false);
  });
});

describe('determinism', () => {
  it('a bot fight against each scripted boss replays identically across a mid-fight checkpoint', () => {
    for (const theme of ['server', 'forge']) {
      const a = lair(theme, 'DET_' + theme, 10, ['vanguard', 'ranger']);
      let b = deserializeState(serializeState(a));
      let sa = 0, sb = 0;
      const kinds = new Set<string>();
      for (let t = 0; t < 1500; t++) {
        const ea = step(a, a.phase === 'COMBAT' ? a.players.map((p) => botInput(a, p.slot, ++sa)) : [], []).events;
        step(b, b.phase === 'COMBAT' ? b.players.map((p) => botInput(b, p.slot, ++sb)) : [], []);
        for (const e of ea) if (e.t === 'foe_fx' || (e.t === 'enemy_attack' && e.stage === 'windup')) kinds.add(e.t === 'foe_fx' ? e.fx : e.attack);
        if (t === 700) b = deserializeState(serializeState(b));
      }
      expect(stateHash(a)).toBe(stateHash(b));
      // the script actually ran its moves
      expect([...kinds].filter((k) => k.startsWith(theme === 'server' ? 'cc_' : 'ic_')).length).toBeGreaterThanOrEqual(3);
    }
  });
});
