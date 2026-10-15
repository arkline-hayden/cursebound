import { describe, expect, it } from 'vitest';
import {
  BOSS_SONGS, GENERIC_BOSS_SONG, IntensityFollower, MENU_SONG, THEME_SONGS, STEMS,
  computeIntensity, degreeMidi, patternHit, rngAt, stemLevel, type IntensitySnapshot, type SongSpec,
} from '../apps/client/src/game/audio/music';
import { AUDIO_THEMES, SFX_CAPTIONS, SFX_IDS, STINGER_KINDS, STINGER_TIMING } from '../apps/client/src/game/audio/sfx';
import { THEME_IDS } from '../apps/client/src/game/art/dungeonThemes';

// Adaptive music data and the intensity model are pure and deterministic; WebAudio rendering is not tested here.

const ALL_SONGS: SongSpec[] = [...Object.values(THEME_SONGS), MENU_SONG, ...Object.values(BOSS_SONGS), GENERIC_BOSS_SONG];

describe('music specs', () => {
  it('cover every dungeon theme and both bosses', () => {
    expect([...AUDIO_THEMES].sort()).toEqual([...THEME_IDS].sort());
    for (const t of AUDIO_THEMES) expect(THEME_SONGS[t].id).toBe(t);
    expect(Object.keys(BOSS_SONGS).sort()).toEqual(['bellroot', 'corruptcore', 'ironcolossus', 'prismstag']);
  });

  it('are internally consistent', () => {
    for (const s of ALL_SONGS) {
      expect(s.scale.length, s.id).toBe(7);
      expect(s.bpm, s.id).toBeGreaterThan(40);
      expect(s.progressions.length, s.id).toBeGreaterThan(0);
      for (const p of s.progressions) expect(p.length, s.id).toBeGreaterThan(0);
      for (const [step, , len] of [...s.motifA, ...s.motifB]) {
        expect(step, s.id).toBeGreaterThanOrEqual(0);
        expect(step, s.id).toBeLessThan(s.steps);
        expect(len, s.id).toBeGreaterThan(0);
      }
      expect(s.bassPattern.length % s.steps === 0 || s.steps % s.bassPattern.length === 0, s.id).toBe(true);
      for (const line of Object.values(s.perc)) {
        for (const p of [line?.calm, line?.combat, line?.heavy]) if (p) expect(p.length, `${s.id} perc`).toBe(s.steps);
      }
      if (s.fill) expect(s.fill.length, `${s.id} fill`).toBe(s.steps);
      for (const st of s.leadSteps) expect(st).toBeLessThan(s.steps);
    }
  });

  it('give each theme a distinct identity (key/mode/tempo/timbre)', () => {
    const sig = AUDIO_THEMES.map((t) => { const s = THEME_SONGS[t]; return `${s.root % 12}:${s.scale.join('')}:${s.bpm}:${s.drone}:${s.motif}`; });
    expect(new Set(sig).size).toBe(AUDIO_THEMES.length);
    expect(new Set(AUDIO_THEMES.map((t) => THEME_SONGS[t].drone)).size).toBe(AUDIO_THEMES.length);
  });

  it('map scale degrees across octaves', () => {
    const aeolian = [0, 2, 3, 5, 7, 8, 10];
    expect(degreeMidi(50, aeolian, 0)).toBe(50);
    expect(degreeMidi(50, aeolian, 7)).toBe(62);
    expect(degreeMidi(50, aeolian, -1)).toBe(48);
    expect(degreeMidi(50, aeolian, 9)).toBe(65);
  });
});

describe('stems and variation', () => {
  it('layer in as intensity rises', () => {
    expect(stemLevel('perc', 0.1)).toBe(0);
    expect(stemLevel('bass', 0.1)).toBe(0);
    expect(stemLevel('heavy', 0.5)).toBe(0);
    expect(stemLevel('perc', 0.5)).toBe(1);
    expect(stemLevel('heavy', 0.9)).toBe(1);
    for (const st of STEMS) for (let i = 0; i <= 10; i++) {
      const v = stemLevel(st, i / 10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('seeded per bar: deterministic, varied, in [0,1)', () => {
    const a = Array.from({ length: 64 }, (_, b) => rngAt(1234, b, 1));
    const b = Array.from({ length: 64 }, (_, k) => rngAt(1234, k, 1));
    expect(a).toEqual(b);
    expect(new Set(a.map((x) => Math.floor(x * 10))).size).toBeGreaterThan(6);
    for (const x of a) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
    expect(rngAt(1234, 3, 1)).not.toBe(rngAt(1234, 3, 2));
  });

  it('reads pattern hits and gates ghosts', () => {
    expect(patternHit('x.o.g...', 0, 0.9)).toBe(1);
    expect(patternHit('x.o.g...', 2, 0.9)).toBe(0.65);
    expect(patternHit('x.o.g...', 4, 0.1)).toBe(0.35);
    expect(patternHit('x.o.g...', 4, 0.9)).toBe(0);
    expect(patternHit('x.o.g...', 1, 0)).toBe(0);
  });
});

function snap(enemies: IntensitySnapshot['enemies'], hp = 1, phase = 'COMBAT'): IntensitySnapshot {
  return { phase, players: [{ s: 0, x: 0, y: 0, hp, life: 'alive' }], enemies, enc: { boss: false } };
}
const foe = (x: number, st = 'move', el?: number) => ({ x, y: 0, st, boss: false, el });

describe('intensity', () => {
  it('is calm out of combat or with only dormant / distant foes', () => {
    expect(computeIntensity(null, 0)).toBe(0);
    expect(computeIntensity(snap([foe(2)], 1, 'VOTING'), 0)).toBe(0);
    expect(computeIntensity(snap([foe(30), foe(40, 'idle'), foe(9, 'idle')]), 0)).toBe(0);
  });

  it('rises with engaged foes, elites, bosses and low health', () => {
    const few = computeIntensity(snap([foe(3), foe(4)]), 0);
    const many = computeIntensity(snap(Array.from({ length: 12 }, (_, i) => foe(2 + (i % 4)))), 0);
    expect(few).toBeGreaterThan(0.2);
    expect(many).toBeGreaterThan(few);
    expect(computeIntensity(snap([foe(3), foe(4, 'move', 2)]), 0)).toBeGreaterThan(few);
    expect(computeIntensity(snap([foe(3), foe(4)], 0.15), 0)).toBeGreaterThan(few);
    expect(computeIntensity(snap([{ x: 10, y: 0, st: 'idle', boss: true }]), 0)).toBeGreaterThanOrEqual(0.72);
    expect(many).toBeLessThanOrEqual(1);
  });

  it('follower has hysteresis: rises fast, falls only after a sustained lull, does not flap', () => {
    const f = new IntensityFollower(4, 6);
    for (let i = 0; i < 8; i++) f.update(0.55, 0.25);
    expect(f.level).toBe(1);
    // brief dips (enemies dying between waves) do not drop the level
    for (let k = 0; k < 10; k++) {
      f.update(0.05, 0.25);
      f.update(0.05, 0.25);
      f.update(0.5, 0.25);
    }
    expect(f.level).toBe(1);
    // a sustained lull does
    for (let i = 0; i < 40; i++) f.update(0.02, 0.25);
    expect(f.level).toBe(0);
    expect(f.value).toBeLessThanOrEqual(0.24);
    for (let i = 0; i < 6; i++) f.update(0.95, 0.25);
    expect(f.level).toBe(2);
    expect(f.value).toBeGreaterThanOrEqual(0.76);
  });
});

describe('sfx table', () => {
  it('lists unique ids, stinger timings and captions for the new cues', () => {
    expect(new Set(SFX_IDS).size).toBe(SFX_IDS.length);
    for (const id of ['chain_throw', 'freeze', 'door_open', 'portal_enter', 'boss_roar', 'stag_cry', 'bell_toll', 'chest_open', 'move_click', 'minimap_ping', 'potion_glug'] as const) expect(SFX_IDS).toContain(id);
    for (const id of ['chain_bind', 'freeze', 'ice_shatter', 'poisoned', 'rooted', 'silenced', 'boss_roar', 'bell_toll'] as const) expect(SFX_CAPTIONS[id]).toBeTruthy();
    for (const k of STINGER_KINDS) {
      expect(STINGER_TIMING[k].duration).toBeGreaterThan(STINGER_TIMING[k].hit);
    }
  });
});
