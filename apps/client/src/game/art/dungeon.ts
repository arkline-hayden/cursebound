/**
 * The Sunken Catacombs: Phaser registration for the procedural dungeon terrain (7 themes), props,
 * decals and backdrop. All pixels come from the framework-free generators in dungeonData.ts /
 * dungeonThemes.ts / isoTerrain.ts. Client-only: touches `document` inside functions, never at import time.
 */
import type Phaser from 'phaser';
import { buildDungeonSheets, buildThemeSheets } from './dungeonData';
import { THEME_ART, THEME_IDS, type ThemeId } from './dungeonThemes';
import { buildIsoSheets, isoKeys, normalKey } from './isoTerrain';
import { buildAtmosphere } from './atmosphere';
import { addAnim, addFramedTexture, toCanvas } from './texutil';

export { DECALS, DUNGEON_FRAMES, PROPS, WALL_HEIGHT, pickFloor, pickWall, type PropDef, type PropLight } from './dungeonData';
export { FACE_NOTES, THEME_ART, THEME_IDS, type ThemeArt, type ThemeId } from './dungeonThemes';
export { ISO_FRAMES, ISO_WALL_DETAILS, isoKeys, normalKey, type IsoKeys } from './isoTerrain';

/** Milliseconds the last ensureTheme() build took per theme (diagnostics; absent = not built yet). */
export const themeBuildMs: Partial<Record<ThemeId, number>> = {};

/**
 * Creates `dungeon:floor`, `dungeon:wall`, `dungeon:void` (catacombs, legacy square set), every `prop:*` and
 * `decal:*` texture (+ `prop:*` animations for animated props), `bg:catacombs` and its alias `bg:prismwood`,
 * and the atmosphere textures (fx:shaft, fx:shaftpool, fx:fog, fx:grade). Theme terrain is built lazily
 * by ensureTheme(), which the renderer calls before building each map. Idempotent.
 */
export function buildDungeon(scene: Phaser.Scene): void {
  if (!scene.textures.exists('dungeon:floor')) {
    for (const s of buildDungeonSheets()) {
      addFramedTexture(scene, s.key, s.width, s.height, s.rgba, s.frameW, s.frameH, s.frames);
      if (s.anim) addAnim(scene, s.anim.key, s.key, s.anim.durations, s.anim.loop);
      if (s.key === 'bg:catacombs') {
        // legacy key used by older scenes: same image
        if (scene.textures.exists('bg:prismwood')) scene.textures.remove('bg:prismwood');
        const tex = scene.textures.addCanvas('bg:prismwood', toCanvas(s.width, s.height, s.rgba));
        tex?.setFilter(1);
      }
    }
  }
  if (!scene.textures.exists('fx:shaft')) {
    for (const a of buildAtmosphere()) addFramedTexture(scene, a.key, a.width, a.height, a.rgba, a.width, a.height, 1, !!a.smooth);
  }
}

/**
 * Ensures the native 2:1 isometric set of a theme exists: iso:floor|deco|wall|stub|cliff|void:<theme>, the
 * emissive companions (iso:floorglow / decoglow / wallglow:<theme>) where the theme has them, and the Light2D
 * normal maps (set as the data source of floor / deco / wall / stub, and registered as `<key>:n` so the
 * renderer can bake a matching normal render texture). Cheap no-op when already built. Unknown ids fall
 * back to catacombs. Returns the theme's art description. The legacy square set (dungeon:floor|wall:<theme>)
 * is only built when `opts.square` is set (art tools).
 */
export function ensureTheme(scene: Phaser.Scene, themeId: string, opts: { square?: boolean } = {}): (typeof THEME_ART)[ThemeId] {
  const id: ThemeId = (THEME_IDS as readonly string[]).includes(themeId) ? (themeId as ThemeId) : 'catacombs';
  const art = THEME_ART[id];
  if (opts.square && !scene.textures.exists(art.wallKey)) {
    for (const s of buildThemeSheets(id)) addFramedTexture(scene, s.key, s.width, s.height, s.rgba, s.frameW, s.frameH, s.frames);
  }
  if (!scene.textures.exists(isoKeys(id).wallKey)) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    for (const s of buildIsoSheets(id)) {
      addFramedTexture(scene, s.key, s.width, s.height, s.rgba, s.frameW, s.frameH, s.frames);
      if (!s.normal) continue;
      const canvas = toCanvas(s.width, s.height, s.normal);
      const tex = scene.textures.get(s.key);
      tex.setDataSource(canvas);
      if (!scene.textures.exists(normalKey(s.key))) {
        const nt = scene.textures.addCanvas(normalKey(s.key), canvas);
        if (nt) {
          const cols = Math.max(1, Math.floor(s.width / s.frameW));
          for (let i = 0; i < s.frames; i++) nt.add(i, 0, (i % cols) * s.frameW, Math.floor(i / cols) * s.frameH, s.frameW, s.frameH);
          nt.setFilter(1);
        }
      }
    }
    themeBuildMs[id] = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  }
  return art;
}
