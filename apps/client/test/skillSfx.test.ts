import { describe, expect, it, vi } from 'vitest';
import { fileSfx, skillLayer, skillSfx } from '../src/game/render/fx/kit3';
import type { FxCtx } from '../src/game/render/fx/registry';

vi.mock('phaser', () => ({}));   // kit3's drawing helpers are not exercised here

// The class kits' recorded-file helpers (render/fx/kit3.ts): a skill plays its own file (audio/fileCues SKILL_FILE)
// when it exists and none of the shared cues it replaces, else exactly the shared cues it played before.

/** A fake FxCtx recording what would play; `files` = the recorded files that exist. */
function fake(files: string[]) {
  const played: string[] = [];
  const ctx = {
    now: 0,
    hasFile: (k: string) => files.includes(k),
    sfx: (id: string) => played.push(`cue:${id}`),
    sfxFile: (k: string, fb: string | null) => played.push(files.includes(k) ? `file:${k}` : fb ? `cue:${fb}` : 'none'),
  } as unknown as FxCtx;
  return { ctx, played };
}

describe('skill sound helpers', () => {
  it('play the skill file instead of every shared cue it layers', () => {
    const on = fake(['skill_arcanist_meteor']);
    skillSfx(on.ctx, 'a_meteor', 'cast_fire', 0, 0, 0);
    skillLayer(on.ctx, 'a_meteor', 'blast_fire', 0, 0, 0);
    expect(on.played).toEqual(['file:skill_arcanist_meteor']);
  });

  it('keep the shared cues until the file lands', () => {
    const off = fake([]);
    skillSfx(off.ctx, 'a_meteor', 'cast_fire', 0, 0, 0);
    skillLayer(off.ctx, 'a_meteor', 'blast_fire', 0, 0, 0);
    expect(off.played).toEqual(['cue:cast_fire', 'cue:blast_fire']);
  });

  it('a skill without a file of its own keeps its cue', () => {
    const t = fake(['skill_arcanist_meteor']);
    skillSfx(t.ctx, 'c_orb_shard', 'impact_frost', 0, 0, 0);
    skillLayer(t.ctx, 'c_orb_shard', 'freeze', 0, 0, 0);
    expect(t.played).toEqual(['cue:impact_frost', 'cue:freeze']);
  });

  it('a named file falls back to its cue or stays silent, and repeats are throttled per key', () => {
    const t = fake(['skill_warden_wolf_bite']);
    fileSfx(t.ctx, 'skill_artificer_turret_shot', 'gun_shot', 0, 0, 100);
    fileSfx(t.ctx, 'skill_artificer_turret_shot', 'gun_shot', 0, 0, 100);   // same instant: throttled
    fileSfx(t.ctx, 'skill_warden_wolf_bite', null, 0, 0, 100);
    fileSfx(t.ctx, 'skill_warden_wolf_bite', null, 0, 0, 100);
    fileSfx(t.ctx, 'skill_hexbinder_death_knell', null, 0, 0, 100);   // no file, no fallback: silent
    expect(t.played).toEqual(['cue:gun_shot', 'file:skill_warden_wolf_bite', 'none']);
  });
});
