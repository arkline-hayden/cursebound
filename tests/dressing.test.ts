import { describe, expect, it } from 'vitest';
import { generateMap } from '@cursebound/simulation';
import { planDressing, trailMarks } from '../apps/client/src/game/render/dressing';
import { PROPS } from '../apps/client/src/game/art/dungeonData';
import { THEME_IDS } from '../apps/client/src/game/art/dungeonThemes';
import { ROOM_FLOOR_NAMES } from '../apps/client/src/game/art/isoRoomFloor';

// The lived-in dressing planner is cosmetic but must be deterministic (co-op clients see the same rooms), keep the
// middle of every room clear for combat, stay within its budgets and never decorate spawn points.

function mapsFor(seed: string) {
  const out: ReturnType<typeof generateMap>[] = [];
  for (let r = 1; r <= 8; r++) out.push(generateMap(seed, r, r === 8));
  return out;
}

describe('lived-in dressing planner', () => {
  const maps = [...mapsFor('dress-a'), ...mapsFor('dress-b'), ...mapsFor('dress-c')];

  it('covers every theme', () => {
    const themes = new Set(maps.map((m) => m.theme));
    for (const t of THEME_IDS) expect(themes.has(t)).toBe(true);
  });

  it('is deterministic from the map', () => {
    for (const m of maps.slice(0, 8)) {
      const a = planDressing(m), b = planDressing({ ...m, tiles: [...m.tiles] });
      a.stats.ms = 0;
      b.stats.ms = 0;
      expect(JSON.stringify(b)).toEqual(JSON.stringify(a));
    }
  });

  it('keeps room middles, walls and spawns clear and stays within budget', () => {
    let vignettes = 0;
    for (const m of maps) {
      const plan = planDressing(m);
      const wall = (x: number, y: number) => x < 0 || y < 0 || x >= m.w || y >= m.h || m.tiles[y * m.w + x] === 1;
      // open tiles with no wall of any kind within two tiles: the combat middle of a room
      const deep = (x: number, y: number) => {
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (wall(x + dx, y + dy)) return false;
        return true;
      };
      for (const sp of plan.sprites) {
        const tx = Math.floor(sp.x), ty = Math.floor(sp.y);
        expect(wall(tx, ty)).toBe(false);
        const def = PROPS[sp.id];
        expect(def).toBeDefined();
        expect(def!.blocks).toBe(false);
        if (sp.layer === 'row' && sp.id !== 'brazier') expect(deep(tx, ty)).toBe(false);
      }
      for (const r of plan.rooms) {
        expect(r.vignettes.length).toBeLessThanOrEqual(3);
        vignettes += r.vignettes.length;
        for (const v of r.vignettes) for (const c of v.cells) expect(deep(c % m.w, Math.floor(c / m.w))).toBe(false);
      }
      for (const s of [...m.playerSpawns, ...m.enemySpawns]) {
        const i = Math.floor(s.y) * m.w + Math.floor(s.x);
        expect(plan.occupied.includes(i)).toBe(false);
      }
      expect(plan.sprites.length).toBeLessThan(140);
      expect(plan.stats.lights).toBeLessThanOrEqual(16);
      expect(plan.low.length + plan.decals.length + plan.edges.length + plan.grime.length).toBeLessThan(900);
      expect(plan.ambient.emitters.length).toBeLessThan(80);
    }
    expect(vignettes).toBeGreaterThan(maps.length);
  });

  it('plans a floor quickly', () => {
    const m = maps[0]!;
    planDressing(m);
    const t0 = performance.now();
    for (let k = 0; k < 10; k++) planDressing(m);
    expect((performance.now() - t0) / 10).toBeLessThan(40);
  });

  it('rasterises trails into faint marks', () => {
    let marks = 0;
    for (const m of maps) for (const t of planDressing(m).trails) {
      const ms = trailMarks(t);
      marks += ms.length;
      for (const k of ms) expect(k.a).toBeLessThanOrEqual(0.7);
    }
    expect(marks).toBeGreaterThan(0);
  });
});

// Tier 3: every typed room is designed from its kind, on every client alike (the plan comes from the replicated
// map fields as well as from a full MapState), chasms draw no masonry and the arenas get their set pieces.
describe('per-room design (map generation tier 3)', () => {
  // what the authority replicates (authority.ts phaseData) and the legacy topology-only form older replays carry
  const wire = (m: ReturnType<typeof generateMap>) => ({ w: m.w, h: m.h, tiles: m.tiles, decorSeed: m.decorSeed, theme: m.theme, topology: m.topology, rooms: m.rooms, voids: m.voids, arena: m.arena, bossSpawn: m.bossSpawn, playerSpawns: m.playerSpawns, enemySpawns: m.enemySpawns });
  const sample: ReturnType<typeof generateMap>[] = [];
  for (const seed of ['room-a', 'room-b', 'room-c', 'room-d']) for (let r = 1; r <= 15; r++) sample.push(generateMap(seed, r, r % 5 === 0));
  const name = (frame: number) => ROOM_FLOOR_NAMES[frame]!;

  it('plans the same rooms from the replicated topology as from the full map', () => {
    for (const m of sample.slice(0, 10)) {
      const a = planDressing(m), b = planDressing(wire(m));
      a.stats.ms = 0; b.stats.ms = 0;
      expect(JSON.stringify(b)).toEqual(JSON.stringify(a));
      expect(a.typed).toEqual(m.rooms);
    }
  });

  it('gives designed kinds their floors and stands props in for the carved furniture', () => {
    const seenFloors = new Set<string>();
    const kinds = new Set<string>();
    for (const m of sample) {
      const plan = planDressing(m);
      for (const f of plan.roomFloor) { seenFloors.add(name(f.frame).replace(/\d+$/, '')); expect(m.tiles[f.y * m.w + f.x]).toBe(0); }
      for (const b of plan.blockers) { expect(m.tiles[b.y * m.w + b.x]).toBe(1); expect(PROPS[b.id], b.id).toBeDefined(); }
      for (const r of m.rooms ?? []) kinds.add(r.kind);
      if ((m.rooms ?? []).some((r) => r.kind === 'library')) expect(plan.roomFloor.some((f) => name(f.frame).startsWith('plank'))).toBe(true);
    }
    for (const base of ['rug', 'plank', 'pool', 'checker', 'sand', 'sigil', 'rose', 'mos', 'bridge']) expect([...seenFloors].some((n) => n.startsWith(base)), base).toBe(true);
    expect(kinds.size).toBeGreaterThan(8);
  });

  it('draws chasms as a drop: no wall pieces, cliffs at the brink', () => {
    let chasms = 0;
    for (const m of sample) {
      if (!m.voids?.length) continue;
      chasms++;
      const plan = planDressing(m);
      const voids = new Set(m.voids);
      for (const w of plan.walls) expect(voids.has(w.y * m.w + w.x)).toBe(false);
      expect(plan.voidCliffs.length).toBeGreaterThan(0);
      for (const c of plan.voidCliffs) expect(m.tiles[c.y * m.w + c.x]).toBe(0);
    }
    expect(chasms).toBeGreaterThan(0);
  });

  it('gives every boss arena its set piece', () => {
    const pieces: Record<string, string> = { ritual: 'sigil', belltower: 'rose', colosseum: 'sand', nave: 'rose', datavault: 'sigil', foundry: 'mos', skyring: 'rose', crater: 'ash' };
    const seen = new Set<string>();
    for (let s = 0; s < 16; s++) {
      const m = generateMap('arena-' + s, 5, true);
      const plan = planDressing(m);
      seen.add(m.arena!);
      expect(plan.roomFloor.some((f) => name(f.frame).startsWith(pieces[m.arena!]!)), m.arena).toBe(true);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('dresses the theme bosses\' lairs: a wind rose on the floating ring, a dusty basin on the moon', () => {
    for (let s = 0; s < 6; s++) for (const [theme, arena, piece] of [['sky', 'skyring', 'rose'], ['moon', 'crater', 'ash']] as const) {
      const m = generateMap('lair-' + s, 5, true, theme);
      expect(m.arena).toBe(arena);
      const plan = planDressing(m);
      expect(plan.roomFloor.some((f) => name(f.frame).startsWith(piece)), `${arena} ${s}`).toBe(true);
    }
  });

  it('scales optional decor with the graphics tier density', () => {
    let lo = 0, hi = 0;
    for (const m of sample) {
      lo += planDressing(m, { density: 0.35 }).sprites.length;
      hi += planDressing(m, { density: 1 }).sprites.length;
    }
    expect(lo).toBeLessThan(hi * 0.8);
  });
});
