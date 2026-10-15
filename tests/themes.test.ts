import { describe, expect, it } from 'vitest';
import { DUNGEON_THEMES, THEME_PACKS, THEME_ROOM_WEIGHTS } from '@cursebound/content';
import { generateMap } from '@cursebound/simulation';
import { PROPS } from '../apps/client/src/game/art/dungeonData';
import { STYLES, THEME_ART, THEME_IDS, VARIANT_THEMES } from '../apps/client/src/game/art/dungeonThemes';
import { FLOOR_MATS } from '../apps/client/src/game/art/isoFloor';
import { ISO_WALL_DETAILS, validateIso } from '../apps/client/src/game/art/isoTerrain';
import { buildRoomFloorFrames } from '../apps/client/src/game/art/isoRoomFloor';
import { DOOR_FRAMES, buildDoorSheets, doorArtTheme } from '../apps/client/src/game/art/doors';
import { THEME_DRESSING } from '../apps/client/src/game/art/vignettes';
import { SKY_H, SKY_W, moonBackdrop, skyBackdrop, skyCloud, skyIslet, skyUnderside } from '../apps/client/src/game/art/skyArt';
import { THEME_EXTRA_PROP_SPECS } from '../apps/client/src/game/art/themeProps';
import { renderTheme } from '../apps/client/src/game/render/themes';
import { planDressing } from '../apps/client/src/game/render/dressing';
import { THEME_SONGS } from '../apps/client/src/game/audio/music';
import { AUDIO_THEMES } from '../apps/client/src/game/audio/sfx';
import { FLOOR_FOR_THEME } from '../apps/client/src/game/audio/recipes';
import { themeGlow } from '../apps/client/src/game/cinematic/text';

// Every dungeon theme the simulation can roll (DUNGEON_THEMES) has its full presentation on the client: terrain,
// props, dressing, doors, lighting, music, ambience surface and accents. The sky island, moon and server room add
// their own: the sky shard's void edges, the moon's starfield, the server room's rack furniture.

const NEW_THEMES = ['sky', 'moon', 'server'] as const;

describe('every dungeon theme is dressed end to end', () => {
  it('the client knows exactly the themes the simulation rolls', () => {
    expect([...THEME_IDS].sort()).toEqual(DUNGEON_THEMES.map((t) => t.id).sort());
    expect([...AUDIO_THEMES].sort()).toEqual([...THEME_IDS].sort());
    for (const t of THEME_IDS) {
      expect(THEME_ROOM_WEIGHTS[t], t).toBeDefined();
      expect(THEME_PACKS[t], t).toBeDefined();
    }
  });

  it('has art, lighting, dressing, doors, music and a footstep surface for every theme', () => {
    for (const t of THEME_IDS) {
      const art = THEME_ART[t];
      expect(art, t).toBeDefined();
      for (const id of [art.torchProp, art.pillarProp, ...art.props.map((p) => p.id), ...art.wallProps.map((p) => p.id)]) expect(PROPS[id], `${t}: ${id}`).toBeDefined();
      expect(PROPS[art.torchProp]!.light, `${t} torch light`).toBeDefined();
      expect(PROPS[art.pillarProp]!.blocks, `${t} pillar blocks`).toBe(true);
      if (t !== 'catacombs') expect(STYLES[t as (typeof VARIANT_THEMES)[number]], t).toBeDefined();
      expect(FLOOR_MATS[t], t).toBeDefined();
      expect(ISO_WALL_DETAILS[t], t).toHaveLength(8);
      expect(renderTheme(t).particles, t).toBe(art.particles);
      expect(THEME_DRESSING[t], t).toBeDefined();
      expect(doorArtTheme(t), t).toBe(t);
      expect(THEME_SONGS[t]?.id, t).toBe(t);
      expect(FLOOR_FOR_THEME[t], t).toBeDefined();
      expect(themeGlow(t), t).toBeGreaterThan(0);
    }
  });

  it('every swap points at a real prop of the same placement', () => {
    for (const t of THEME_IDS) {
      const d = THEME_DRESSING[t];
      for (const [from, to] of [...Object.entries(d.swap), ...Object.entries(d.rooms ?? {})]) {
        expect(PROPS[to], `${t}: ${from} -> ${to}`).toBeDefined();
        const a = PROPS[from];
        if (a) expect(PROPS[to]!.placement === 'wallFace', `${t}: ${from} -> ${to} keeps its placement`).toBe(a.placement === 'wallFace');
      }
    }
    for (const [id, s] of Object.entries(THEME_EXTRA_PROP_SPECS)) {
      expect(s.key, id).toBe(`prop:${id}`);
      if (s.hug) expect(s.w, id).toBeLessThanOrEqual(48);
    }
  });
});

describe('sky island, moon and server room art', () => {
  it('build a valid isometric terrain set (diamond masks, solid blocks, cliffs below the tile)', () => {
    expect(validateIso([...NEW_THEMES])).toEqual([]);
  });

  it('build their room floors and door sheets', () => {
    for (const t of NEW_THEMES) {
      expect(buildRoomFloorFrames(t).length).toBeGreaterThan(100);
      const sheets = buildDoorSheets(t);
      expect(sheets.find((s) => s.key === `door:${t}:L:portal`)?.frames).toBe(DOOR_FRAMES.portal);
      expect(sheets.find((s) => s.key === `door:${t}:R:glow`)?.frames).toBe(DOOR_FRAMES.glow);
      // the frame is painted: a solid arch, not an empty sheet
      const frame = sheets.find((s) => s.key === `door:${t}:L:frame`)!;
      let opaque = 0;
      for (let i = 3; i < frame.rgba.length; i += 4) if (frame.rgba[i]! > 0) opaque++;
      expect(opaque, t).toBeGreaterThan(1500);
    }
  });

  it('paint the sky and starfield backdrops and the shard underside', () => {
    for (const b of [skyBackdrop(), moonBackdrop()]) {
      expect([b.w, b.h]).toEqual([SKY_W, SKY_H]);
      for (let i = 0; i < b.data.length; i++) expect(b.data[i]! >>> 24).toBe(255);
    }
    for (let i = 0; i < 4; i++) {
      const u = skyUnderside(i);
      expect(u.alpha(24, 2)).toBe(255);   // the top meets the brink
      expect(u.alpha(1, 70)).toBe(0);     // and it tapers away below
      expect(skyCloud(i).data.some((c) => c >>> 24 === 255)).toBe(true);
    }
    for (let i = 0; i < 3; i++) expect(skyIslet(i).data.some((c) => c >>> 24 === 255)).toBe(true);
  });

  it('open the sky floors onto the void: cliffs hang from the brink and the rim, no wall stands over the drop', () => {
    let maps = 0;
    for (const seed of ['SKYDRESS-A', 'SKYDRESS-B']) for (let r = 1; r <= 6; r++) {
      const m = generateMap(seed, r, r === 5, 'sky');
      const plan = planDressing(m);
      maps++;
      const voids = new Set(m.voids ?? []);
      expect(voids.size).toBeGreaterThan(0);
      for (const w of plan.walls) expect(voids.has(w.y * m.w + w.x)).toBe(false);
      expect(plan.voidCliffs.length).toBeGreaterThan(10);
      // the rim's walls standing on the brink hang their slab face into the void too
      expect(plan.cliffs.some((c) => voids.has((c.y + 1) * m.w + c.x) || voids.has(c.y * m.w + c.x + 1))).toBe(true);
      expect(renderTheme(m.theme).lowWalls).toBe(true);
      expect(renderTheme(m.theme).backdrop).toBe('sky');
    }
    expect(maps).toBe(12);
    expect(renderTheme('moon').backdrop).toBe('stars');
    expect(renderTheme('server').backdrop).toBeUndefined();
  });

  it('re-dress the rooms in each theme: server archives stand rack rows, the moon its monoliths', () => {
    const blockersOf = (theme: string): Set<string> => {
      const ids = new Set<string>();
      for (let s = 0; s < 6; s++) for (let r = 1; r <= 9; r++) {
        if (r % 5 === 0) continue;
        for (const b of planDressing(generateMap('REDRESS' + s, r, false, theme)).blockers) ids.add(b.id);
      }
      return ids;
    };
    const server = blockersOf('server');
    expect(server.has('rack_free')).toBe(true);
    expect(server.has('bookcase_free')).toBe(false);
    const moon = blockersOf('moon');
    expect(moon.has('guardian')).toBe(false);
    const sky = blockersOf('sky');
    expect(sky.has('bookcase_free')).toBe(false);
  });

  it('dress deterministically from the map', () => {
    for (const t of NEW_THEMES) {
      const m = generateMap('DRESSDET', 3, false, t);
      const a = planDressing(m), b = planDressing({ ...m, tiles: [...m.tiles] });
      a.stats.ms = 0;
      b.stats.ms = 0;
      expect(JSON.stringify(b)).toEqual(JSON.stringify(a));
    }
  });
});
