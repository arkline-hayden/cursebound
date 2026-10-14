/**
 * Phaser registration layer for the procedural art. All pixels come from the framework-free
 * generators (actors / tiles / effects / dungeon); this module only uploads them as textures and
 * creates the animations. Client-only: touches `document` inside functions, never at import time.
 */
import type Phaser from 'phaser';
import { ACTOR_IDS, actorTextureKey, buildActorSheet, type ActorId } from './actors';
import { buildDungeon } from './dungeon';
import { buildEffects } from './effects';
import { addAnim, addFramedTexture } from './texutil';
import { buildTileset } from './tiles';

/** Milliseconds the last buildArt() call took (diagnostics). */
export let lastArtBuildMs = 0;

/**
 * Builds one actor's sheet + animations if missing (cheap no-op when present). Scenes that pass
 * `buildArt(scene, { actors })` can call this lazily for actors that appear later (e.g. a summon).
 */
export function ensureActor(scene: Phaser.Scene, actor: ActorId): void {
  const key = actorTextureKey(actor);
  if (scene.textures.exists(key)) return;
  const sheet = buildActorSheet(actor);
  addFramedTexture(scene, key, sheet.width, sheet.height, sheet.rgba, sheet.frameW, sheet.frameH, sheet.frameCount);
  for (const a of sheet.anims) {
    if (scene.anims.exists(a.key)) continue;
    scene.anims.create({
      key: a.key,
      frames: a.frames.map((f) => ({ key, frame: f.frame, duration: f.duration })),
      repeat: a.repeat ? -1 : 0,
    });
  }
}

/**
 * Creates every texture + animation exactly once (safe to call from several scenes). Optional
 * `opts.actors` limits the eager actor set (default: all ACTOR_IDS); build the rest with ensureActor().
 */
export function buildArt(scene: Phaser.Scene, opts: { actors?: readonly ActorId[] } = {}): void {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

  for (const actor of opts.actors ?? ACTOR_IDS) ensureActor(scene, actor);

  // The Sunken Catacombs terrain, props, decals and backdrop (also registers bg:prismwood as an alias).
  buildDungeon(scene);

  // Legacy Prismwood tileset kept so older scenes keep working.
  if (!scene.textures.exists('tiles:prismwood')) {
    const ts = buildTileset();
    addFramedTexture(scene, ts.key, ts.width, ts.height, ts.rgba, ts.frameW, ts.frameH, ts.frameCount);
  }

  if (!scene.textures.exists('fx:spark')) {
    for (const fx of buildEffects()) {
      if (scene.textures.exists(fx.key)) continue;
      const smooth = fx.key.startsWith('light:');
      addFramedTexture(scene, fx.key, fx.width, fx.height, fx.rgba, fx.frameW, fx.frameH, fx.frames, smooth);
      if (fx.anim) addAnim(scene, fx.key, fx.key, fx.durations, fx.loop);
    }
  }

  lastArtBuildMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
}
