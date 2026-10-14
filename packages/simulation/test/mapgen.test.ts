import { describe, expect, it } from 'vitest';
import { ARENA_DESIGNS, BOSS_ARENAS, DUNGEON_LAYOUTS, DUNGEON_THEMES, ROOM_KINDS } from '@cursebound/content';
import { bossForRound, generateDungeon, layoutFor, mapArena, mapBossSpawn, mapRooms, mapVoids, setupRound, spawnWave, themeFor, type MapState } from '@cursebound/simulation';
import { newRun } from './run.helpers';

/** Every floor tile reachable from the first player spawn? */
function connected(m: MapState): boolean {
  const floor = m.tiles.filter((t) => t === 0).length;
  const start = Math.floor(m.playerSpawns[0].y) * m.w + Math.floor(m.playerSpawns[0].x);
  const seen = new Set([start]); const q = [start];
  while (q.length) { const c = q.pop()!; const x = c % m.w, y = (c / m.w) | 0; for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { const n = ny * m.w + nx; if (m.tiles[n] === 0 && !seen.has(n)) { seen.add(n); q.push(n); } } }
  return seen.size === floor;
}

/** A spread of maps: three seeds, thirty rounds each (every fifth is a boss floor). */
const SAMPLE: MapState[] = [];
for (const seed of ['A', 'B', 'C']) for (let r = 1; r <= 30; r++) SAMPLE.push(generateDungeon(seed, r, r % 5 === 0));

describe('procedural dungeon floors', () => {
  it('every round gets a valid, connected map; theme and layout change round to round', () => {
    const layouts = new Set<string>(), themes = new Set<string>();
    for (const seed of ['A', 'B', 'C']) {
      for (let r = 1; r <= 30; r++) {
        const boss = r % 5 === 0;
        const m = generateDungeon(seed, r, boss);
        layouts.add(m.layout); themes.add(m.theme);
        expect(m.enemySpawns.length).toBeGreaterThanOrEqual(4);
        expect(m.playerSpawns).toHaveLength(5);
        expect(connected(m)).toBe(true);
        if (r > 1) {
          expect(themeFor(seed, r)).not.toBe(themeFor(seed, r - 1));
          if (!boss && (r - 1) % 5 !== 0) expect(layoutFor(seed, r, false)).not.toBe(layoutFor(seed, r - 1, false));
        }
      }
    }
    expect(layouts.size).toBeGreaterThanOrEqual(10);
    expect(themes.size).toBe(7);
  });
  it('is deterministic per seed and round (with and without a door theme)', () => {
    expect(generateDungeon('X', 7, false)).toEqual(generateDungeon('X', 7, false));
    expect(generateDungeon('X', 7, false, 'frost')).toEqual(generateDungeon('X', 7, false, 'frost'));
    expect(generateDungeon('X', 10, true)).toEqual(generateDungeon('X', 10, true));
  });
  it('fallback rarely used', () => {
    let fb = 0;
    for (let r = 1; r <= 60; r++) if (generateDungeon('FB', r, r % 5 === 0).fallback) fb++;
    expect(fb).toBeLessThanOrEqual(3);
  });
});

describe('tier 1: layout archetypes', () => {
  it('every ordinary family generates valid, connected, room-typed floors', () => {
    const seen = new Map<string, number>();
    for (let s = 0; s < 6; s++) for (let r = 1; r <= 13; r++) {
      if (r % 5 === 0) continue;
      const m = generateDungeon('LAYOUT' + s, r, false);
      if (m.fallback) continue;
      seen.set(m.layout, (seen.get(m.layout) ?? 0) + 1);
      expect(connected(m)).toBe(true);
      expect(m.rooms!.length).toBeGreaterThan(0);
    }
    for (const l of DUNGEON_LAYOUTS) if (l.id !== 'arena') expect(seen.get(l.id) ?? 0, l.id).toBeGreaterThan(0);
  });
  it('chasm floors drop their middle into the void (walls to the simulation, never floor)', () => {
    let chasms = 0;
    for (const m of SAMPLE) {
      for (const i of m.voids ?? []) expect(m.tiles[i]).toBe(1);
      if (m.layout === 'chasm') { chasms++; expect(m.voids!.length).toBeGreaterThan(20); expect(m.rooms!.some((r) => r.kind === 'bridge')).toBe(true); }
    }
    expect(chasms).toBeGreaterThan(0);
  });
});

describe('tier 2: typed rooms', () => {
  it('every room kind turns up across seeds and themes', () => {
    const kinds = new Set<string>();
    for (const th of DUNGEON_THEMES) for (let s = 0; s < 4; s++) for (let r = 1; r <= 12; r++) {
      const m = generateDungeon('KINDS' + s, r, r % 5 === 0, th.id);
      for (const room of m.rooms ?? []) kinds.add(room.kind);
    }
    for (const k of ROOM_KINDS) expect(kinds.has(k.id), `room kind ${k.id}`).toBe(true);
  });
  it('rooms lie inside the map and hold floor; the theme leans the kinds', () => {
    const count = (theme: string, kind: string) => {
      let n = 0;
      for (let s = 0; s < 5; s++) for (let r = 1; r <= 9; r++) if (r % 5) n += (generateDungeon('LEAN' + s, r, false, theme).rooms ?? []).filter((x) => x.kind === kind).length;
      return n;
    };
    for (const m of SAMPLE) for (const r of m.rooms ?? []) {
      expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(m.w); expect(r.y + r.h).toBeLessThanOrEqual(m.h);
      let floor = 0;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (m.tiles[y * m.w + x] === 0) floor++;
      expect(floor).toBeGreaterThan(3);
    }
    expect(count('flooded', 'cistern')).toBeGreaterThan(count('forge', 'cistern'));
    expect(count('forge', 'forge')).toBeGreaterThan(count('frost', 'forge'));
  });
  it('the room plan survives replication through the topology string', () => {
    for (const m of SAMPLE) {
      const wire = { topology: m.topology };
      expect(mapRooms(wire)).toEqual(m.rooms ?? []);
      expect(mapVoids(wire)).toEqual(m.voids ?? []);
      expect(mapArena(wire)).toBe(m.arena ?? null);
      expect(mapBossSpawn(wire)).toEqual(m.bossSpawn ?? null);
      expect(m.topology.split('|')[0]).toBe(m.layout);
    }
  });
});

describe('boss arenas', () => {
  it('every boss fights in one of its own arena designs, and the arena knows the boss the director spawns', () => {
    const designs = new Map<string, Set<string>>();
    for (let s = 0; s < 14; s++) for (const r of [5, 10, 15]) {
      const seed = 'ARENA' + s;
      const st = newRun(['vanguard'], seed);
      st.round = r;
      setupRound(st, []);
      const boss = st.encounter!.bossId!;
      expect(bossForRound(seed, r)).toBe(boss);
      const m = st.map!;
      expect(m.layout).toBe('arena');
      expect(BOSS_ARENAS[boss]).toContain(m.arena);
      if (!designs.has(boss)) designs.set(boss, new Set());
      designs.get(boss)!.add(m.arena!);
    }
    for (const [boss, set] of designs) expect([...set].sort(), boss).toEqual([...BOSS_ARENAS[boss]].sort());
    expect(new Set([...designs.values()].flatMap((x) => [...x])).size).toBe(ARENA_DESIGNS.length);
  });
  it('arenas have an antechamber approach, a far open dais and room for the grand entrance', () => {
    for (const m of SAMPLE.filter((x) => x.layout === 'arena')) {
      expect(m.fallback).toBe(false);
      const rooms = m.rooms!;
      expect(rooms[0].kind).toBe('approach');
      expect(rooms.some((r) => r.kind === 'arena')).toBe(true);
      const b = m.bossSpawn!;
      expect(b).toBeTruthy();
      // the dais stands in the open: a clear 5x5 for the entrance circle and the first telegraphs
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) expect(m.tiles[(Math.floor(b.y) + dy) * m.w + Math.floor(b.x) + dx]).toBe(0);
      // the party starts in the antechamber, well away from the boss
      const p = m.playerSpawns[0];
      const a = rooms[0];
      expect(p.x >= a.x && p.x < a.x + a.w && p.y >= a.y && p.y < a.y + a.h).toBe(true);
      expect(Math.hypot(b.x - p.x, b.y - p.y)).toBeGreaterThan(14);
    }
  });
  it('the boss rises on the arena dais', () => {
    const st = newRun(['vanguard'], 'ARENA_SPAWN');
    st.round = 5;
    setupRound(st, []);
    spawnWave(st, [], 0);
    const boss = st.enemies.find((e) => e.boss)!;
    expect({ x: boss.x, y: boss.y }).toEqual(st.map!.bossSpawn);
  });
});
