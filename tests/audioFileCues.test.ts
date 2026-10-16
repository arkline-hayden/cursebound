import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BOSSES, ENEMY_BY_ID, SHRINES, SKILL_BY_ID } from '@cursebound/content';
import { BOSS_DEATH_FILE, CueGate, FOE_VOICE, FoeWatch, SHRINE_FILE, SKILL_FILE, countdownSecond, foeVoice, seatDelta } from '../apps/client/src/game/audio/fileCues';

// Recorded-file cues (tools/audio/sounds.mjs tier 2) must each be triggered somewhere in the client: either named
// literally in apps/client/src (playFile / sfxFile / skillSfx / fileSfx call sites and the audio/fileCues.ts tables) or
// produced by the enemy-voice mapping (FOE_VOICE base + _alert / _attack / _death). The skillSfx / skillLayer / fileSfx
// helpers are tested in apps/client/test/skillSfx.test.ts.

interface Entry { file: string; tier: number; kind: string; note: string; when: string }
const SOUND_LIST = '../tools/audio/sounds.mjs';   // untyped .mjs (the generator's data): imported by path
const { SECTIONS } = (await import(SOUND_LIST)) as { SECTIONS: { items: Entry[] }[] };
const ENTRIES: Entry[] = SECTIONS.flatMap((s) => s.items);
const TIER2 = ENTRIES.filter((e) => e.tier === 2);

/**
 * Tier-2 keys deliberately not wired, each with its reason. Keep this short: anything here never plays.
 */
const UNWIRED: Record<string, string> = {
  music_training: 'music is not handled by the recorded-file cues yet (songs stream through AudioEngine.setSong)',
};

const SRC = path.resolve(__dirname, '../apps/client/src');
function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(d.name) && !d.name.endsWith('.generated.ts') ? [p] : [];
  });
}
const CODE = sources(SRC).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const literal = (key: string) => new RegExp(`['"\`]${key}['"\`]`).test(CODE);

const FOE_VOICES = new Set(Object.keys(FOE_VOICE).flatMap((k) => (['alert', 'attack', 'death'] as const).map((v) => foeVoice(k, v)!)));
const T2_KEYS = new Set(TIER2.map((e) => e.file));

describe('tier-2 recorded cues', () => {
  it('are all wired (or allow-listed with a reason)', () => {
    const missing = TIER2.map((e) => e.file).filter((k) => !UNWIRED[k] && !literal(k) && !FOE_VOICES.has(k));
    expect(missing).toEqual([]);
    for (const k of Object.keys(UNWIRED)) expect(T2_KEYS.has(k), `${k} is not a tier-2 entry`).toBe(true);
  });

  it('skill files map real sim skills to their skill_<class>_<snake name> entries', () => {
    const snake = (n: string) => n.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    // upgrades that share their base skill's take (the sound list names both in one entry)
    const shared: Record<string, string> = { t_aegis_charge: 't_shield_charge', b_bladestorm: 'b_whirlwind' };
    for (const [id, key] of Object.entries(SKILL_FILE)) {
      const sk = SKILL_BY_ID[id];
      expect(sk, `${id} is not a skill`).toBeDefined();
      expect(T2_KEYS.has(key), `${key} is not in the sound list`).toBe(true);
      const named = SKILL_BY_ID[shared[id] ?? id]!;
      // a few entries use the list's own short name (Hailstone, Glacial Comet, Explosive Tip...): those must at least
      // stay inside the skill's class
      if (key !== `skill_${named.classId}_${snake(named.name)}`) expect(key.startsWith(`skill_${sk!.classId}_`), `${id} -> ${key}`).toBe(true);
    }
    // every per-skill entry the sound list names is either a skill's take or a named extra moment wired in the fx files
    const extras = TIER2.filter((e) => e.file.startsWith('skill_') && e.kind !== 'ui').map((e) => e.file).filter((k) => !Object.values(SKILL_FILE).includes(k));
    expect(extras.sort()).toEqual([
      'skill_arcanist_singularity', 'skill_artificer_explosion', 'skill_artificer_grenade_throw', 'skill_artificer_turret_shot',
      'skill_hexbinder_death_knell', 'skill_templar_aegis_dome',
    ]);
  });

  it('enemy voices cover every voiced enemy id from the sound list notes', () => {
    for (const e of TIER2.filter((x) => x.file.startsWith('foe_'))) {
      const id = /enemy id: (\S+)/.exec(e.note)?.[1];
      expect(id, e.file).toBeDefined();
      expect(ENEMY_BY_ID[id!], `${id} is not an enemy`).toBeDefined();
      const voice = e.file.slice(e.file.lastIndexOf('_') + 1) as 'alert' | 'attack' | 'death';
      expect(foeVoice(id!, voice)).toBe(e.file);
    }
    for (const v of FOE_VOICES) expect(T2_KEYS.has(v), v).toBe(true);
    expect(foeVoice('prismstag', 'death')).toBeUndefined();   // bosses have their own death takes
  });

  it('boss deaths and shrines cover every boss and shrine type', () => {
    expect(Object.keys(BOSS_DEATH_FILE).sort()).toEqual(BOSSES.map((b) => b.id).sort());
    expect(Object.keys(SHRINE_FILE).sort()).toEqual(SHRINES.map((s) => s.id).sort());
    for (const k of [...Object.values(BOSS_DEATH_FILE), ...Object.values(SHRINE_FILE)]) expect(T2_KEYS.has(k), k).toBe(true);
  });
});

// Tier 3: lobby / social / results / menu moments and combat details (the ui_* panel cues and ready_up are shared
// SfxIds the interface already plays by name). Every tier-3 key must be named somewhere in the client source.
const TIER3 = ENTRIES.filter((e) => e.tier === 3);

describe('tier-3 recorded cues', () => {
  it('are all wired', () => {
    expect(TIER3.length).toBeGreaterThan(0);
    expect(TIER3.map((e) => e.file).filter((k) => !literal(k))).toEqual([]);
  });

  it('include the moments wired by file name', () => {
    const keys = new Set(TIER3.map((e) => e.file));
    for (const k of ['party_join', 'party_leave', 'invite_received', 'countdown_tick', 'tutorial_step', 'xp_tick', 'score_tick',
      'new_record', 'bounty_complete', 'skill_refund', 'ledger_open', 'revive_channel', 'knockback', 'skill_warden_summon_blink',
      'slowed', 'stunned', 'core_voice', 'item_drop', 'training_dummy']) expect(keys.has(k), `${k} is not a tier-3 entry`).toBe(true);
  });
});

describe('tier-3 helpers', () => {
  it('seatDelta counts seats filled and emptied, quiet on first sight', () => {
    expect(seatDelta(null, [0, 1])).toEqual({ joined: 0, left: 0 });
    expect(seatDelta([0], [0, 1])).toEqual({ joined: 1, left: 0 });
    expect(seatDelta([0, 1, 2], [0, 2])).toEqual({ joined: 0, left: 1 });
    expect(seatDelta([0, 1], [0, 2])).toEqual({ joined: 1, left: 1 });
  });

  it('countdownSecond shows only the last five whole seconds', () => {
    expect(countdownSecond(null)).toBeNull();
    expect(countdownSecond(12)).toBeNull();
    expect(countdownSecond(5)).toBe(5);
    expect(countdownSecond(4.2)).toBe(5);
    expect(countdownSecond(0.3)).toBe(1);
    expect(countdownSecond(0)).toBeNull();
  });

  it('FoeWatch reports stuns on the stagger edge and shoves along a fresh hit', () => {
    const w = new FoeWatch();
    const foe = (x: number, stag = false, boss = false) => ({ i: 1, x, y: 0, stag, boss });
    const hit = () => ({ dx: 1, dy: 0 });
    const none = () => undefined;
    const walk = () => 3;
    expect(w.step(0, [foe(0)], hit, walk)).toEqual({ stunned: [], knocked: [] });   // first sight seeds
    // 3 ticks (0.05 s): walking covers 0.15 at most; a 0.3 shove along the hit reads as knockback
    expect(w.step(3, [foe(0.3)], hit, walk).knocked).toHaveLength(1);
    expect(w.step(6, [foe(0.6)], none, walk).knocked).toHaveLength(0);   // no fresh hit: just movement
    expect(w.step(9, [foe(0.7)], hit, walk).knocked).toHaveLength(0);    // walking pace
    expect(w.step(12, [foe(0.4)], hit, walk).knocked).toHaveLength(0);   // toward the hitter
    expect(w.step(12, [foe(2, true)], hit, walk)).toEqual({ stunned: [], knocked: [] });   // same snapshot again: ignored
    expect(w.step(15, [foe(0.4, true)], none, walk).stunned).toHaveLength(1);
    expect(w.step(18, [foe(0.4, true)], none, walk).stunned).toHaveLength(0);   // still stunned: no repeat
    expect(w.step(21, [foe(1.4, false, true)], hit, walk).knocked).toHaveLength(0);   // bosses are never shoved
    w.clear();
    expect(w.step(24, [foe(5, true)], hit, walk)).toEqual({ stunned: [], knocked: [] });   // a new floor seeds again
  });
});

describe('CueGate', () => {
  it('lets a key through once per gap, independently per key', () => {
    const g = new CueGate();
    expect(g.ok('a', 0, 100)).toBe(true);
    expect(g.ok('a', 50, 100)).toBe(false);
    expect(g.ok('b', 50, 100)).toBe(true);
    expect(g.ok('a', 100, 100)).toBe(true);
    expect(g.ok('a', 150, 100)).toBe(false);
  });
});
