/**
 * Theme boss SFX recipes (recipes.ts calls these): the Gale Wyrm's screech, gale, dive and lightning feathers, the long
 * fall, and the Crater Horror's moan, tentacles, gravity well and void beam. Each returns its duration, or null when
 * the id is not one of these.
 */

import { mtof } from './music';
import type { SfxEnv } from './recipes';
import type { SfxId } from './sfx';
import type { Synth } from './synth';

export function bossSfx(s: Synth, id: SfxId, o: AudioNode, t: number, env: SfxEnv): number | null {
  const r = (): number => s.rand();
  const key = env.root;
  switch (id) {
    case 'drake_screech': {
      // a raptor shriek over a storm-front: two detuned rising whistles that crack into a rasp, wind underneath
      for (const [mul, det, a] of [[1, 0, 0.08], [1.5, 12, 0.04], [2, -18, 0.03]] as [number, number, number][]) {
        s.tone(o, t, { type: 'sawtooth', f: 600 * mul, f2: 2100 * mul, dur: 0.35, gain: a, attack: 0.03, glide: 0.3, filter: 3200, q: 4, detune: det });
        s.tone(o, t + 0.32, { type: 'sawtooth', f: 2100 * mul, f2: 900 * mul, dur: 0.7, gain: a * 0.8, attack: 0.01, glide: 0.7, filter: 2600, q: 3, detune: det });
      }
      s.noiseHit(o, t, { dur: 1.2, f: 900, f2: 2600, q: 0.8, gain: 0.08, attack: 0.2 });
      s.noiseHit(o, t + 0.3, { dur: 0.8, type: 'highpass', f: 4000, gain: 0.04, attack: 0.05 });
      s.tone(o, t, { f: 70, f2: 45, dur: 0.9, gain: 0.18, attack: 0.05 });
      return 1.3;
    }
    case 'drake_gale':
      // a great breath: a roaring band of noise sweeping up then howling away
      s.noiseHit(o, t, { dur: 1.6, f: 300, f2: 1400, q: 0.7, gain: 0.2, attack: 0.25, brown: true });
      s.noiseHit(o, t + 0.2, { dur: 1.4, f: 1200, f2: 600, q: 3, gain: 0.08, attack: 0.3 });
      s.tone(o, t + 0.15, { type: 'triangle', f: 420, f2: 300, dur: 1.2, gain: 0.025, attack: 0.3, glide: 1.1 });
      return 1.8;
    case 'drake_dive':
      // a whoosh that rushes past: rising then falling noise with a doppler drop
      s.noiseHit(o, t, { dur: 0.35, f: 400, f2: 3000, q: 1.4, gain: 0.2, attack: 0.25 });
      s.noiseHit(o, t + 0.33, { dur: 0.45, f: 3000, f2: 300, q: 1.4, gain: 0.16, attack: 0.01 });
      s.tone(o, t + 0.3, { f: 180, f2: 60, dur: 0.5, gain: 0.2 });
      return 0.9;
    case 'thunder_feather':
      // a sharp crack of lightning and a short rolling rumble
      s.crunchHit(o, t, { dur: 0.06, type: 'highpass', f: 2500, gain: 0.3, drive: 6 });
      s.noiseHit(o, t, { dur: 0.12, f: 5000, q: 0.8, gain: 0.16, attack: 0.001 });
      s.noiseHit(o, t + 0.04, { dur: 0.7, type: 'lowpass', f: 400, f2: 120, gain: 0.22, attack: 0.02, brown: true });
      return 0.8;
    case 'skyfall':
      // a long falling whistle, wind, then a thump as the gust sets the hero back down
      s.tone(o, t, { type: 'triangle', f: 1400, f2: 300, dur: 0.6, gain: 0.07, glide: 0.6 });
      s.noiseHit(o, t, { dur: 0.6, f: 2000, f2: 500, q: 1.2, gain: 0.12, attack: 0.05 });
      s.noiseHit(o, t + 0.55, { dur: 0.4, type: 'lowpass', f: 500, gain: 0.18, attack: 0.01 });
      s.tone(o, t + 0.58, { f: 90, f2: 45, dur: 0.25, gain: 0.3 });
      return 1.0;
    case 'horror_moan': {
      // something vast exhales from the pit: a subharmonic groan through vowel formants, a choir gone wrong
      const f0 = mtof(key - 24);
      for (const [mul, det, a] of [[1, 0, 0.16], [1.5, 7, 0.06], [2.01, -9, 0.04]] as [number, number, number][]) {
        s.tone(o, t, { type: 'sawtooth', f: f0 * mul, f2: f0 * mul * 0.82, dur: 2.4, gain: a, attack: 0.5, glide: 2.2, filter: 500, q: 6, detune: det });
      }
      for (const d of [0, 1, 6]) s.choirNote(o, t + 0.3, mtof(key - 12 + d), 2.2, 0.03);
      s.whisper(o, t + 0.2, 2.0, 0.06);
      s.noiseHit(o, t, { dur: 2.4, type: 'lowpass', f: 160, gain: 0.2, attack: 0.6, brown: true });
      return 2.6;
    }
    case 'tentacle_burst':
      // regolith cracking and a wet slap
      s.crunchHit(o, t, { dur: 0.1, type: 'lowpass', f: 1400, gain: 0.22, drive: 4 });
      for (let k = 0; k < 4; k++) s.noiseHit(o, t + 0.02 + r() * 0.08, { dur: 0.04, f: 600 + r() * 900, q: 3, gain: 0.06, brown: true });
      s.tone(o, t + 0.06, { f: 220, f2: 90, dur: 0.18, gain: 0.12, filter: 800, q: 6 });
      return 0.4;
    case 'gravity_well':
      // a deepening hum that bends downward, as if space itself were sagging
      s.tone(o, t, { f: 110, f2: 40, dur: 1.4, gain: 0.22, attack: 0.15, glide: 1.3 });
      s.tone(o, t, { f: 111.5, f2: 41, dur: 1.4, gain: 0.16, attack: 0.15, glide: 1.3 });
      s.noiseHit(o, t, { dur: 1.2, f: 1800, f2: 200, q: 2.5, gain: 0.06, attack: 0.2 });
      return 1.5;
    case 'void_beam':
      // a crystalline drone ignites and sizzles across the basin
      for (const d of [0, 7, 12]) s.tone(o, t, { type: 'square', f: mtof(key + 24 + d), dur: 2.2, gain: 0.018, attack: 0.08, filter: 2400, q: 2 });
      s.tone(o, t, { type: 'sawtooth', f: 55, dur: 2.2, gain: 0.08, attack: 0.1, filter: 300, q: 4 });
      s.noiseHit(o, t + 0.05, { dur: 2.1, type: 'highpass', f: 5000, gain: 0.04, attack: 0.2 });
      return 2.3;
    default:
      return null;
  }
}

/** Per-boss roar for the grand entrance (recipes.ts boss_roar), or null for bosses without one here. */
export function bossRoar(s: Synth, o: AudioNode, t: number, env: SfxEnv): number | null {
  if (env.boss === 'skydrake') {
    s.tone(o, t, { f: 55, f2: 35, dur: 1.4, gain: 0.3, attack: 0.08 });
    return bossSfx(s, 'drake_screech', o, t, env);
  }
  if (env.boss === 'moonhorror') {
    s.crunchHit(o, t, { dur: 0.3, type: 'lowpass', f: 600, gain: 0.25, drive: 5 });
    return bossSfx(s, 'horror_moan', o, t, env);
  }
  return null;
}
