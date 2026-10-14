/**
 * SFX recipes: one function per SfxId, each returning its duration. Layered transients (click + body + crunch +
 * tail) give impacts weight; the engine wraps every call in a random pitch/filter offset (Synth.pv / fv).
 * `env` carries context: the current floor surface (footsteps), the music key (tonal cues stay in key) and the boss.
 */

import { mtof } from './music';
import type { SfxId } from './sfx';
import type { Synth } from './synth';

export type Floor = 'stone' | 'wet' | 'bone' | 'carpet' | 'moss' | 'grate' | 'snow';

export interface SfxEnv {
  floor: Floor;
  /** tonic of the current song (MIDI) */
  root: number;
  boss: string | null;
  /** alternates per footstep */
  foot: number;
}

export const FLOOR_FOR_THEME: Record<string, Floor> = {
  catacombs: 'stone', flooded: 'wet', ossuary: 'bone', sanctum: 'carpet', fungal: 'moss', forge: 'grate', frost: 'snow',
};

/** Pitch randomisation spread per cue (fraction); UI and big cinematic cues barely vary. */
export function pitchSpread(id: SfxId): number {
  if (id.startsWith('ui_') || id === 'move_click' || id === 'minimap_ping' || id.startsWith('vote_') || id === 'fate_commit') return 0.01;
  if (id === 'footstep') return 0.12;
  if (id === 'hit_enemy' || id === 'kill' || id === 'enemy_death' || id === 'swing' || id === 'enemy_bite') return 0.09;
  if (id.startsWith('boss_') || id.startsWith('cine_') || id === 'title_boom' || id === 'round_start' || id === 'stag_cry' || id === 'bell_toll' || id.startsWith('legendary')) return 0.015;
  if (id === 'round_clear' || id === 'level_up' || id === 'combo' || id === 'player_revived' || id === 'player_downed') return 0;
  return 0.05;
}

function footstep(s: Synth, o: AudioNode, t: number, env: SfxEnv): number {
  const r = (): number => s.rand();
  const side = env.foot % 2 ? 1.04 : 0.97;
  switch (env.floor) {
    case 'stone':
      s.noiseHit(o, t, { dur: 0.045, type: 'lowpass', f: 480 * side, gain: 0.1 });
      s.noiseHit(o, t + 0.008, { dur: 0.05, f: 2200 + r() * 600, q: 1.5, gain: 0.03 });
      return s.tone(o, t, { f: 88 * side, f2: 55, dur: 0.05, gain: 0.08 });
    case 'wet':
      s.tone(o, t, { f: 220 * side, f2: 120, dur: 0.07, gain: 0.05, filter: 900, q: 3 });
      s.noiseHit(o, t, { dur: 0.09, f: 1800 + r() * 800, q: 1.2, gain: 0.06, attack: 0.006 });
      for (let k = 0; k < 3; k++) s.click('drip', o, t + 0.04 + r() * 0.08, 0.35);
      return 0.16;
    case 'bone':
      for (let k = 0; k < 3; k++) s.noiseHit(o, t + k * (0.008 + r() * 0.01), { dur: 0.01, f: 2400 + r() * 1600, q: 4, gain: 0.05, attack: 0.001 });
      s.tone(o, t, { type: 'triangle', f: 700 * side, f2: 520, dur: 0.035, gain: 0.04 });
      return s.tone(o, t, { f: 90, f2: 60, dur: 0.04, gain: 0.05 });
    case 'carpet':
      s.noiseHit(o, t, { dur: 0.06, type: 'lowpass', f: 380 * side, gain: 0.08, attack: 0.008 });
      return s.tone(o, t, { f: 70, f2: 50, dur: 0.05, gain: 0.05 });
    case 'moss':
      s.noiseHit(o, t, { dur: 0.08, type: 'lowpass', f: 900 * side, f2: 300, q: 3, gain: 0.07, attack: 0.01 });
      return s.tone(o, t + 0.01, { f: 160, f2: 90, dur: 0.06, gain: 0.04, filter: 500, q: 4 });
    case 'grate':
      s.bell(o, t, (420 + r() * 80) * side, 0.18, 0.025, 1.4);
      s.noiseHit(o, t, { dur: 0.03, f: 3200, q: 3, gain: 0.04 });
      return s.tone(o, t, { f: 110, f2: 70, dur: 0.05, gain: 0.07 });
    case 'snow':
      for (let k = 0; k < 6; k++) s.noiseHit(o, t + k * (0.008 + r() * 0.012), { dur: 0.012, f: 3000 + r() * 2500, q: 2, gain: 0.025, attack: 0.001 });
      s.noiseHit(o, t, { dur: 0.08, type: 'lowpass', f: 600, gain: 0.05, attack: 0.01 });
      return 0.12;
  }
}

export function synthSfx(s: Synth, id: SfxId, o: AudioNode, t: number, env: SfxEnv): number {
  const r = (): number => s.rand();
  const key = env.root;
  switch (id) {
    // ---------------------------------------------------------------- UI
    case 'ui_click':
      s.tone(o, t, { type: 'square', f: 1400, f2: 900, dur: 0.035, gain: 0.07, filter: 3000 });
      return s.tone(o, t, { f: 2200, dur: 0.03, gain: 0.08 });
    case 'ui_hover':
      return s.tone(o, t, { f: 1900, dur: 0.03, gain: 0.04 });
    case 'ui_confirm':
      s.bell(o, t, 880, 0.35, 0.12);
      return 0.07 + s.bell(o, t + 0.07, 1320, 0.45, 0.12);
    case 'ui_error':
      s.tone(o, t, { type: 'square', f: 240, f2: 190, dur: 0.11, gain: 0.08, filter: 1200 });
      return 0.13 + s.tone(o, t + 0.13, { type: 'square', f: 200, f2: 160, dur: 0.14, gain: 0.08, filter: 1000 });
    case 'vote_cast':
      s.bell(o, t, 1047, 0.5, 0.12);
      return 0.06 + s.bell(o, t + 0.06, 1568, 0.6, 0.1);
    case 'vote_lock':
      s.tone(o, t, { f: 110, f2: 60, dur: 0.18, gain: 0.3 });
      s.noiseHit(o, t, { dur: 0.08, f: 900, gain: 0.12 });
      for (const [k, m] of [72, 76, 79, 84].entries()) s.bell(o, t + k * 0.03, mtof(m), 0.9, 0.08);
      return 1;
    case 'fate_commit': {
      [60, 64, 67, 72, 76, 79].forEach((m, k) => s.bell(o, t + k * 0.07, mtof(m + 12), 0.9, 0.09));
      s.noiseHit(o, t, { dur: 0.7, type: 'highpass', f: 3000, f2: 9000, gain: 0.05, attack: 0.3 });
      return 1.3;
    }
    case 'move_click':
      s.noiseHit(o, t, { dur: 0.012, type: 'highpass', f: 4000, gain: 0.012, attack: 0.001 });
      return s.tone(o, t, { f: 1700, f2: 1500, dur: 0.025, gain: 0.022, attack: 0.001 });
    case 'minimap_ping':
      s.tone(o, t, { f: 1320, dur: 0.4, gain: 0.05, attack: 0.003 });
      s.tone(o, t, { f: 1980, dur: 0.25, gain: 0.015, attack: 0.003 });
      return 0.2 + s.tone(o, t + 0.2, { f: 1320, dur: 0.35, gain: 0.018, attack: 0.003 });
    case 'level_up':
      [60, 64, 67, 72, 76].forEach((m, k) => s.bell(o, t + k * 0.06, mtof(m + 12), 0.7, 0.09));
      return 1.0;

    // ---------------------------------------------------------------- player attacks
    case 'swing':
      // two-stage whoosh: body sweep + airy tail + a faint low woof
      s.noiseHit(o, t, { dur: 0.17, f: 380, f2: 2400, q: 1.6, gain: 0.22, attack: 0.045 });
      s.noiseHit(o, t + 0.03, { dur: 0.14, type: 'highpass', f: 4500, gain: 0.05, attack: 0.05 });
      return s.tone(o, t, { f: 95, f2: 60, dur: 0.12, gain: 0.05, attack: 0.03 });
    case 'attack_melee':
      s.noiseHit(o, t, { dur: 0.14, f: 600, f2: 2600, q: 1.4, gain: 0.28, attack: 0.02 });
      s.noiseHit(o, t + 0.05, { dur: 0.004, type: 'highpass', f: 3000, gain: 0.12, attack: 0.0005 });
      return s.tone(o, t + 0.05, { f: 130, f2: 70, dur: 0.1, gain: 0.25 });
    case 'attack_spark':
      s.tone(o, t, { type: 'triangle', f: 900, f2: 1900, dur: 0.12, gain: 0.12 });
      return s.noiseHit(o, t, { dur: 0.1, type: 'highpass', f: 4000, gain: 0.08 });
    case 'skill_guard':
      s.bell(o, t, 320, 0.6, 0.12, 1.4);
      s.bell(o, t, 467, 0.5, 0.08, 1.2);
      return s.noiseHit(o, t, { dur: 0.08, f: 2500, gain: 0.15 });
    case 'skill_sweep':
      s.noiseHit(o, t, { dur: 0.32, f: 400, f2: 3200, q: 1.2, gain: 0.35, attack: 0.06 });
      return s.tone(o, t + 0.12, { f: 150, f2: 60, dur: 0.18, gain: 0.25 });
    case 'skill_rally':
      for (const m of [55, 59, 62, 67]) s.tone(o, t, { type: 'sawtooth', f: mtof(m), dur: 0.7, gain: 0.05, attack: 0.05, filter: 1400, detune: (r() - 0.5) * 12 });
      return s.bell(o, t + 0.1, mtof(79), 0.8, 0.08);
    case 'skill_fireline':
      s.noiseHit(o, t, { dur: 0.7, type: 'lowpass', f: 600, f2: 200, gain: 0.35, attack: 0.05 });
      for (let k = 0; k < 6; k++) s.noiseHit(o, t + r() * 0.5, { dur: 0.03, type: 'highpass', f: 3000, gain: 0.08 });
      return 0.75;
    case 'skill_arc':
      for (let k = 0; k < 5; k++) s.tone(o, t + k * 0.045, { type: 'square', f: 600 + r() * 1400, f2: 300 + r() * 400, dur: 0.05, gain: 0.07, filter: 5000 });
      return s.noiseHit(o, t, { dur: 0.28, type: 'highpass', f: 5000, gain: 0.08 });
    case 'skill_phase':
      s.tone(o, t, { f: 1600, f2: 260, dur: 0.35, gain: 0.12 });
      return s.tone(o, t, { type: 'triangle', f: 800, f2: 130, dur: 0.38, gain: 0.08, detune: 15 });
    case 'signature_slam':
      s.tone(o, t, { f: 95, f2: 38, dur: 0.7, gain: 0.55 });
      s.crunchHit(o, t, { dur: 0.12, f: 1400, q: 0.8, gain: 0.25 });
      s.noiseHit(o, t, { dur: 0.6, type: 'lowpass', f: 900, f2: 120, gain: 0.4 });
      s.bell(o, t, 210, 0.8, 0.1, 1.3);
      return 0.85;
    case 'signature_nova':
      for (const [k, m] of [76, 81, 83, 88, 91].entries()) s.bell(o, t + k * 0.04, mtof(m), 1.0, 0.07);
      s.tone(o, t, { type: 'sawtooth', f: 200, f2: 1600, dur: 0.5, gain: 0.06, filter: 2500, glide: 0.4 });
      s.noiseHit(o, t + 0.3, { dur: 0.6, f: 2000, f2: 6000, gain: 0.12 });
      return 1.1;
    case 'dodge':
      s.noiseHit(o, t, { dur: 0.13, type: 'highpass', f: 1800, f2: 5000, gain: 0.16, attack: 0.03 });
      return s.noiseHit(o, t, { dur: 0.1, f: 500, f2: 1400, q: 1.2, gain: 0.06, attack: 0.02 });

    // ---------------------------------------------------------------- impacts
    case 'hit_enemy':
      // click + body thump + crunch + meat + pitch-down tail
      s.noiseHit(o, t, { dur: 0.005, type: 'highpass', f: 3500, gain: 0.2, attack: 0.0005 });
      s.tone(o, t, { f: 150, f2: 48, dur: 0.14, gain: 0.46, glide: 0.1 });
      s.crunchHit(o, t + 0.002, { dur: 0.07, f: 1700, q: 0.8, gain: 0.22, drive: 5 });
      s.noiseHit(o, t + 0.004, { dur: 0.09, type: 'lowpass', f: 900, gain: 0.16 });
      return s.tone(o, t + 0.02, { type: 'triangle', f: 460 + r() * 80, f2: 110, dur: 0.16, gain: 0.1 });
    case 'hit_player':
      s.tone(o, t, { f: 120, f2: 40, dur: 0.22, gain: 0.6, glide: 0.16 });
      s.crunchHit(o, t, { dur: 0.09, f: 1100, q: 0.7, gain: 0.2 });
      s.noiseHit(o, t, { dur: 0.16, type: 'lowpass', f: 1400, f2: 300, gain: 0.32 });
      return s.tone(o, t, { type: 'square', f: 220, f2: 70, dur: 0.18, gain: 0.07, filter: 900 });
    case 'crit':
      // heavy punch + crunch + the bright "ching"
      s.noiseHit(o, t, { dur: 0.004, type: 'highpass', f: 4000, gain: 0.25, attack: 0.0005 });
      s.tone(o, t, { f: 170, f2: 42, dur: 0.2, gain: 0.65, glide: 0.14 });
      s.crunchHit(o, t, { dur: 0.09, f: 2200, q: 0.7, gain: 0.3, drive: 6 });
      s.tone(o, t + 0.008, { f: 2637, dur: 0.5, gain: 0.09, attack: 0.001 });
      s.tone(o, t + 0.008, { f: 3951, dur: 0.35, gain: 0.05, attack: 0.001 });
      s.bell(o, t + 0.012, 1760, 0.65, 0.12, 1.5);
      s.noiseHit(o, t + 0.01, { dur: 0.25, type: 'highpass', f: 7000, gain: 0.04 });
      return 0.7;
    case 'enemy_death':
      s.noiseHit(o, t, { dur: 0.3, type: 'lowpass', f: 1100, f2: 200, gain: 0.36 });
      s.noiseHit(o, t + 0.02, { dur: 0.22, f: 700, f2: 180, q: 3, gain: 0.22 });
      for (let k = 0; k < 5; k++) s.click('bone', o, t + 0.05 + r() * 0.25, 0.5 + r() * 0.4);
      s.tone(o, t, { f: 110, f2: 40, dur: 0.2, gain: 0.32 });
      return 0.45;
    case 'kill':
      // pop + wet squelch + bone crack
      s.noiseHit(o, t, { dur: 0.006, type: 'highpass', f: 3000, gain: 0.18, attack: 0.0005 });
      s.tone(o, t, { f: 95, f2: 36, dur: 0.3, gain: 0.62, glide: 0.22 });
      s.crunchHit(o, t, { dur: 0.16, type: 'lowpass', f: 1600, f2: 250, gain: 0.3, drive: 3 });
      s.noiseHit(o, t + 0.035, { dur: 0.25, f: 900, f2: 160, q: 4, gain: 0.26 });
      s.tone(o, t + 0.01, { f: 520 + r() * 140, f2: 180, dur: 0.06, gain: 0.07, filter: 1400, q: 5 });
      s.click('bone', o, t + 0.02 + r() * 0.03, 0.8);
      return 0.36;
    case 'combo': {
      const base = key + 24 + [0, 3, 7][Math.floor(r() * 3)]!;
      [0, 4, 7, 12].forEach((d, k) => s.bell(o, t + k * 0.045, mtof(base + d), 0.5, 0.08));
      return 0.7;
    }
    case 'heartbeat':
      s.tone(o, t, { f: 62, f2: 44, dur: 0.14, gain: 0.55, filter: 200 });
      s.noiseHit(o, t, { dur: 0.06, type: 'lowpass', f: 160, gain: 0.2 });
      return 0.2 + s.tone(o, t + 0.2, { f: 56, f2: 40, dur: 0.16, gain: 0.38, filter: 180 });
    case 'footstep':
      return footstep(s, o, t, env);

    // ---------------------------------------------------------------- enemies & boss
    case 'enemy_shoot':
      s.noiseHit(o, t, { dur: 0.05, f: 2000, q: 2, gain: 0.05 });
      return s.tone(o, t, { type: 'square', f: 760, f2: 280, dur: 0.1, gain: 0.06, filter: 2200 });
    case 'enemy_bite':
      s.crunchHit(o, t, { dur: 0.05, f: 1600, q: 2, gain: 0.16 });
      return s.tone(o, t, { f: 220, f2: 110, dur: 0.06, gain: 0.15 });
    case 'boss_telegraph':
      s.tone(o, t, { type: 'sawtooth', f: mtof(45), dur: 0.8, gain: 0.12, filter: 500, q: 4, attack: 0.05 });
      s.tone(o, t + 0.2, { type: 'sawtooth', f: mtof(46), dur: 0.7, gain: 0.12, filter: 600, q: 4, attack: 0.05 });
      s.bell(o, t, mtof(93), 0.4, 0.1);
      return 0.25 + s.bell(o, t + 0.25, mtof(93), 0.5, 0.1);
    case 'boss_charge':
      s.noiseHit(o, t, { dur: 0.85, f: 300, f2: 2400, q: 2, gain: 0.25, attack: 0.6 });
      return s.tone(o, t, { type: 'sawtooth', f: 70, f2: 420, dur: 0.85, gain: 0.1, filter: 1200, glide: 0.8, attack: 0.5 });
    case 'boss_ring':
      s.noiseHit(o, t, { dur: 0.1, f: 1500, gain: 0.3 });
      s.bell(o, t, 98, 2.8, 0.35, 1.2);
      return s.bell(o, t, 147, 2.2, 0.15, 1);
    case 'boss_phase':
      s.tone(o, t, { type: 'sawtooth', f: mtof(33), dur: 1.4, gain: 0.15, filter: 400, attack: 0.4 });
      for (const [k, m] of [84, 80, 77, 72].entries()) s.bell(o, t + 0.2 + k * 0.12, mtof(m), 1.0, 0.08);
      return 1.5;
    case 'player_downed':
      for (const [k, m] of [76, 72, 67].entries()) s.tone(o, t + k * 0.14, { type: 'triangle', f: mtof(m), dur: 0.35, gain: 0.18 });
      s.tone(o, t + 0.4, { f: 110, f2: 55, dur: 0.4, gain: 0.3 });
      return 0.85;
    case 'player_revived':
      for (const [k, m] of [67, 72, 76, 79].entries()) s.bell(o, t + k * 0.08, mtof(m + 12), 0.8, 0.1);
      s.noiseHit(o, t + 0.1, { dur: 0.6, type: 'highpass', f: 5000, gain: 0.05, attack: 0.2 });
      return 1.0;
    case 'round_clear': {
      // in the song's key, resolving to its major (Picardy) chord
      const k0 = 60 + ((key % 12) + 12) % 12;
      [0, 4, 7, 12].forEach((d, k) => s.pluck(o, t + k * 0.1, mtof(k0 + d), 0.5, 0.16));
      for (const d of [0, 4, 7]) s.tone(o, t + 0.42, { type: 'triangle', f: mtof(k0 + d), dur: 0.9, gain: 0.07, attack: 0.02 });
      return 1.35;
    }
    case 'wave_spawn':
      s.noiseHit(o, t, { dur: 0.6, f: 200, f2: 1800, q: 3, gain: 0.22, attack: 0.3 });
      return s.tone(o, t, { type: 'triangle', f: 90, f2: 160, dur: 0.6, gain: 0.15 });
    case 'telegraph_warn':
      s.tone(o, t, { type: 'square', f: 1760, dur: 0.07, gain: 0.07, filter: 4000 });
      return 0.12 + s.tone(o, t + 0.12, { type: 'square', f: 1760, dur: 0.09, gain: 0.07, filter: 4000 });
    case 'heal':
      s.tone(o, t, { f: 784, f2: 1175, dur: 0.3, gain: 0.1 });
      return s.bell(o, t + 0.08, 1568, 0.4, 0.06);
    case 'shield':
      s.tone(o, t, { type: 'triangle', f: 600, f2: 900, dur: 0.35, gain: 0.1 });
      return s.tone(o, t, { type: 'triangle', f: 606, f2: 909, dur: 0.35, gain: 0.08, detune: 20 });
    case 'potion_glug': {
      // cork pop, three glugs, a warm shimmer
      s.tone(o, t, { f: 600, f2: 1500, dur: 0.03, gain: 0.08, glide: 0.02 });
      s.noiseHit(o, t, { dur: 0.01, f: 2500, q: 2, gain: 0.08, attack: 0.001 });
      for (let k = 0; k < 3; k++) {
        const tt = t + 0.09 + k * 0.11;
        s.tone(o, tt, { f: 170 + k * 25, f2: 420 + k * 40, dur: 0.07, gain: 0.12, filter: 900, q: 6, glide: 0.06 });
        s.noiseHit(o, tt, { dur: 0.05, type: 'lowpass', f: 500, gain: 0.05 });
      }
      s.tone(o, t + 0.42, { f: 784, f2: 1175, dur: 0.3, gain: 0.05 });
      s.bell(o, t + 0.46, 1568, 0.5, 0.04);
      return 0.95;
    }
    case 'legendary_drop': {
      // pillar-of-light whoomp, then the shimmering bell arpeggio in key and an airy sparkle tail
      const pc = ((key % 12) + 12) % 12;
      const k0 = 72 + pc - (pc > 5 ? 12 : 0);
      s.noiseHit(o, t, { dur: 0.35, f: 200, f2: 1200, q: 1, gain: 0.08, attack: 0.25 });
      s.tone(o, t, { type: 'triangle', f: mtof(k0 - 36), f2: mtof(k0 - 29), dur: 1.2, gain: 0.16, attack: 0.02, glide: 0.5 });
      [0, 4, 7, 12, 16, 19].forEach((d, k) => {
        s.bell(o, t + 0.05 + k * 0.075, mtof(k0 + d), 1.4 - k * 0.1, 0.08, 1.3);
        s.tone(o, t + 0.05 + k * 0.075, { f: mtof(k0 + d) * 1.004, dur: 0.9, gain: 0.022, detune: 9 });
      });
      for (let k = 0; k < 6; k++) s.tone(o, t + 0.5 + k * 0.09, { f: mtof(k0 + 24 + (k % 3) * 2), dur: 0.25, gain: 0.028 });
      s.noiseHit(o, t + 0.1, { dur: 1.1, type: 'highpass', f: 6000, f2: 10000, gain: 0.05, attack: 0.35 });
      return 1.8;
    }
    case 'legendary_equip':
      s.tone(o, t, { f: 140, f2: 70, dur: 0.25, gain: 0.25 });
      s.noiseHit(o, t, { dur: 0.12, f: 1800, gain: 0.12 });
      [79, 83, 86, 91].forEach((m, k) => s.bell(o, t + 0.06 + k * 0.05, mtof(m), 0.8, 0.08, 1.2));
      return 1.0;
    case 'chest_open':
      // hinge creak, latch, wooden thump, coins
      s.tone(o, t, { type: 'sawtooth', f: 180, f2: 260, dur: 0.4, gain: 0.05, filter: 700, q: 12, glide: 0.35, attack: 0.05 });
      s.noiseHit(o, t, { dur: 0.012, f: 2000, q: 3, gain: 0.1, attack: 0.001 });
      s.drum('log', o, t + 0.38, 0.7);
      for (let k = 0; k < 7; k++) s.bell(o, t + 0.42 + r() * 0.35, 2600 + r() * 1800, 0.25, 0.018, 1.2);
      return 0.95;

    // ---------------------------------------------------------------- afflictions
    case 'chain_throw':
      s.noiseHit(o, t, { dur: 0.25, f: 600, f2: 3000, q: 1.5, gain: 0.14, attack: 0.08 });
      for (let k = 0; k < 5; k++) s.click('chain', o, t + k * 0.05, 0.9);
      return s.tone(o, t, { f: 1800, f2: 900, dur: 0.25, gain: 0.025 });
    case 'chain_bind':
      s.tone(o, t, { f: 120, f2: 60, dur: 0.2, gain: 0.3 });
      s.bell(o, t, 620, 0.5, 0.06, 1.5);
      s.bell(o, t + 0.04, 910, 0.4, 0.04, 1.5);
      for (let k = 0; k < 6; k++) s.click('chain', o, t + 0.02 + k * (0.035 + r() * 0.03), 0.8);
      return 0.6;
    case 'chain_break':
      s.crunchHit(o, t, { dur: 0.04, type: 'highpass', f: 3000, gain: 0.25, drive: 6 });
      s.bell(o, t, 1300, 0.5, 0.06, 1.4);
      for (let k = 0; k < 6; k++) s.click('chain', o, t + 0.04 + k * 0.05 + r() * 0.03, 0.7 - k * 0.08);
      return 0.55;
    case 'freeze_build':
      s.noiseHit(o, t, { dur: 0.8, type: 'highpass', f: 2000, f2: 8000, gain: 0.07, attack: 0.6 });
      for (let k = 0; k < 6; k++) s.click('ice', o, t + 0.1 + r() * 0.65, 0.8);
      for (let k = 0; k < 3; k++) s.tone(o, t + k * 0.2, { f: 2400 + k * 600, f2: 3600 + k * 600, dur: 0.3, gain: 0.015, attack: 0.1 });
      return 0.85;
    case 'freeze':
      s.crunchHit(o, t, { dur: 0.08, f: 2500, q: 1, gain: 0.2 });
      s.tone(o, t, { f: 140, f2: 70, dur: 0.15, gain: 0.2 });
      for (const f of [1800, 2400, 3200]) s.bell(o, t + 0.01, f, 1.0, 0.035, 1.5);
      s.noiseHit(o, t, { dur: 0.5, type: 'highpass', f: 6000, gain: 0.04, attack: 0.02 });
      return 1.0;
    case 'ice_shatter':
      s.crunchHit(o, t, { dur: 0.1, type: 'highpass', f: 1800, gain: 0.28, drive: 6 });
      s.noiseHit(o, t, { dur: 0.35, type: 'highpass', f: 5000, gain: 0.08 });
      for (let k = 0; k < 8; k++) s.bell(o, t + r() * 0.3, 2200 + r() * 3000, 0.25, 0.03, 1.6);
      return s.tone(o, t, { f: 110, f2: 60, dur: 0.12, gain: 0.18 });
    case 'poison_spit':
      s.noiseHit(o, t, { dur: 0.1, f: 1200, f2: 600, q: 3, gain: 0.16 });
      s.click('bloop', o, t + 0.02, 1);
      return s.noiseHit(o, t + 0.05, { dur: 0.3, type: 'highpass', f: 4000, gain: 0.04, attack: 0.02 });
    case 'poisoned':
      for (let k = 0; k < 3; k++) s.tone(o, t + k * 0.09, { f: 420 - k * 70, f2: 220 - k * 30, dur: 0.08, gain: 0.07, filter: 900, q: 6 });
      s.tone(o, t, { type: 'triangle', f: 180, dur: 0.5, gain: 0.04, attack: 0.05 });
      s.tone(o, t, { type: 'triangle', f: 187, dur: 0.5, gain: 0.04, attack: 0.05 });
      return s.noiseHit(o, t + 0.1, { dur: 0.4, type: 'highpass', f: 3500, gain: 0.02, attack: 0.1 });
    case 'blind_burst':
      s.noiseHit(o, t, { dur: 0.25, type: 'highpass', f: 4000, f2: 10000, gain: 0.14 });
      s.tone(o, t, { f: 3000, f2: 6000, dur: 0.2, gain: 0.04 });
      s.tone(o, t, { f: 80, f2: 40, dur: 0.3, gain: 0.3 });
      return s.tone(o, t + 0.05, { f: 4200, dur: 0.9, gain: 0.012, attack: 0.05 });
    case 'web_spit':
      s.noiseHit(o, t, { dur: 0.12, f: 2000, f2: 800, q: 2, gain: 0.12 });
      return s.tone(o, t, { f: 900, f2: 300, dur: 0.1, gain: 0.05 });
    case 'rooted':
      s.tone(o, t, { type: 'sawtooth', f: 120, f2: 90, dur: 0.35, gain: 0.06, filter: 600, q: 8 });
      s.pluck(o, t + 0.05, 220, 0.4, 0.04);
      s.pluck(o, t + 0.09, 207, 0.4, 0.035);
      return s.noiseHit(o, t, { dur: 0.3, f: 1500, q: 1, gain: 0.05, attack: 0.05 });
    case 'silenced':
      s.noiseHit(o, t, { dur: 0.5, type: 'lowpass', f: 3000, f2: 200, gain: 0.1, attack: 0.02 });
      s.tone(o, t, { f: 90, f2: 50, dur: 0.4, gain: 0.15, attack: 0.05 });
      return s.noiseHit(o, t + 0.05, { dur: 0.45, type: 'highpass', f: 3500, gain: 0.03, attack: 0.15 });

    // ---------------------------------------------------------------- doors & portals
    case 'door_appear':
      s.noiseHit(o, t, { dur: 1.3, type: 'lowpass', f: 140, f2: 260, gain: 0.12, attack: 0.6, brown: true });
      for (let k = 0; k < 9; k++) s.noiseHit(o, t + 0.1 + r() * 1.0, { dur: 0.05, f: 380 + r() * 200, q: 3, gain: 0.05 });
      s.bell(o, t + 1.15, mtof(key + 12), 2, 0.05, 0.9);
      s.bell(o, t + 1.2, mtof(key + 19), 1.8, 0.03, 0.9);
      return 2.8;
    case 'door_hum':
      for (const [f, a] of [[110, 0.05], [111, 0.04], [165, 0.025], [220.5, 0.015]] as [number, number][]) s.tone(o, t, { f, dur: 1.2, gain: a, attack: 0.4 });
      return s.noiseHit(o, t + 0.2, { dur: 1, type: 'highpass', f: 5000, gain: 0.01, attack: 0.4 });
    case 'door_open':
      s.tone(o, t, { type: 'sawtooth', f: 80, f2: 58, dur: 1.1, gain: 0.07, filter: 450, q: 10, glide: 1, attack: 0.15 });
      s.noiseHit(o, t, { dur: 1.0, f: 300, f2: 700, q: 2.5, gain: 0.08, attack: 0.3, brown: true });
      s.drum('taiko', o, t + 1.05, 0.8);
      s.noiseHit(o, t + 1.0, { dur: 0.8, f: 400, f2: 2000, q: 1, gain: 0.06, attack: 0.2 });
      return 1.9;
    case 'door_choose':
      s.bigBell(o, t, mtof(key), 2.2, 0.12);
      [12, 19, 24].forEach((d, k) => s.bell(o, t + 0.08 + k * 0.08, mtof(key + 12 + d), 1.2, 0.05, 1.2));
      s.tone(o, t, { f: 70, f2: 40, dur: 0.6, gain: 0.25 });
      return 2.2;
    case 'portal_enter':
      s.noiseHit(o, t, { dur: 0.5, f: 200, f2: 4000, q: 1.5, gain: 0.14, attack: 0.4 });
      s.noiseHit(o, t + 0.5, { dur: 0.6, f: 4000, f2: 200, q: 1.5, gain: 0.12, attack: 0.01 });
      s.tone(o, t, { f: 120, f2: 30, dur: 1.1, gain: 0.3, glide: 1, attack: 0.3 });
      s.tone(o, t + 0.55, { f: 55, f2: 30, dur: 0.9, gain: 0.35 });
      return 1.6;

    // ---------------------------------------------------------------- cinematics
    case 'cine_whoosh':
      s.noiseHit(o, t, { dur: 0.35, f: 300, f2: 2500, q: 1.2, gain: 0.18, attack: 0.25 });
      s.noiseHit(o, t + 0.3, { dur: 0.35, f: 2500, f2: 400, q: 1.2, gain: 0.12, attack: 0.01 });
      return s.tone(o, t + 0.1, { f: 90, f2: 50, dur: 0.4, gain: 0.1, attack: 0.15 });
    case 'title_boom':
      s.tone(o, t, { f: 60, f2: 28, dur: 1.8, gain: 0.6, glide: 1.4 });
      s.crunchHit(o, t, { dur: 0.15, type: 'lowpass', f: 2000, gain: 0.3, drive: 4 });
      s.noiseHit(o, t, { dur: 1.2, type: 'lowpass', f: 800, f2: 100, gain: 0.35 });
      s.bigBell(o, t + 0.02, 55, 3.5, 0.1);
      return 3.2;
    case 'round_start':
      // war horn over a drum and a rattle of chains
      s.brass(o, t, mtof(key - 12), 1.3, 0.12, 1.2);
      s.brass(o, t, mtof(key - 5), 1.3, 0.07, 1);
      s.drum('taiko', o, t, 1.2);
      for (let k = 0; k < 4; k++) s.click('chain', o, t + 0.1 + k * 0.06, 0.7);
      return 1.8;
    case 'boss_rumble':
      s.noiseHit(o, t, { dur: 2.5, type: 'lowpass', f: 90, q: 1.5, gain: 0.3, attack: 1.0, brown: true });
      s.tone(o, t, { f: 34, f2: 40, dur: 2.4, gain: 0.25, attack: 0.8, glide: 2.4 });
      for (let k = 0; k < 10; k++) s.click('bone', o, t + 0.4 + r() * 2, 0.3 + r() * 0.3);
      return 2.6;
    case 'boss_emerge':
      s.noiseHit(o, t, { dur: 1.3, f: 200, f2: 1200, q: 1.5, gain: 0.18, attack: 1.1 });
      s.tone(o, t, { f: 30, f2: 62, dur: 1.3, gain: 0.3, attack: 1, glide: 1.2 });
      s.crunchHit(o, t + 1.2, { dur: 0.25, f: 900, q: 0.8, gain: 0.3, drive: 5 });
      for (const d of [0, 1, 6]) s.choirNote(o, t + 0.6, mtof(key + d), 1.8, 0.04);
      return 2.6;
    case 'boss_roar': {
      // growl: distorted saw through vowel formants with jitter, plus roaring noise
      if (env.boss === 'prismstag') {
        s.noiseHit(o, t, { dur: 1.2, f: 900, q: 1, gain: 0.1, attack: 0.1 });
        s.tone(o, t, { f: 50, f2: 35, dur: 1.4, gain: 0.25, attack: 0.1 });
        return synthSfx(s, 'stag_cry', o, t, env);
      }
      const ctx = s.ctx;
      const ws = ctx.createWaveShaper();
      ws.curve = s.crunch;
      const pre = ctx.createGain();
      pre.gain.value = 3;
      const g = ctx.createGain();
      const len = s.sus(g.gain, t, 0.25, 0.1, 1.1, 0.5);
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(95 * s.pv, t);
      osc.frequency.linearRampToValueAtTime(120 * s.pv, t + 0.3);
      osc.frequency.linearRampToValueAtTime(70 * s.pv, t + 1.6);
      const jit = ctx.createOscillator();
      jit.frequency.value = 28;
      const jg = ctx.createGain();
      jg.gain.value = 18;
      jit.connect(jg);
      jg.connect(osc.frequency);
      osc.connect(pre);
      pre.connect(ws);
      for (const [fq, q, a] of [[650, 4, 1], [1100, 5, 0.6], [2500, 6, 0.2]] as [number, number, number][]) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = fq;
        bp.Q.value = q;
        const ag = ctx.createGain();
        ag.gain.value = a;
        ws.connect(bp);
        bp.connect(ag);
        ag.connect(g);
      }
      g.connect(o);
      osc.start(t);
      jit.start(t);
      osc.stop(t + len + 0.05);
      jit.stop(t + len + 0.05);
      s.noiseHit(o, t, { dur: 1.4, f: 800, f2: 400, q: 0.8, gain: 0.14, attack: 0.15 });
      s.tone(o, t, { f: 50, f2: 35, dur: 1.5, gain: 0.3, attack: 0.1 });
      if (env.boss === 'bellroot') { s.bigBell(o, t + 0.05, 65, 3, 0.12); return Math.max(len, 3.1); }
      return Math.max(len, 1.7);
    }
    case 'stag_cry': {
      // The Hollow Stag: a rising ghostly bugle that breaks into grunts, doubled by a detuned spectre
      for (const [mul, det, a] of [[1, 0, 0.09], [2, 8, 0.025], [1, -22, 0.05]] as [number, number, number][]) {
        s.tone(o, t, { f: 420 * mul, f2: 1700 * mul, dur: 0.5, gain: a, attack: 0.1, glide: 0.45, detune: det });
        s.tone(o, t + 0.45, { f: 1700 * mul, f2: 1150 * mul, dur: 0.75, gain: a * 0.9, attack: 0.02, glide: 0.7, detune: det });
      }
      s.whisper(o, t + 0.1, 1.0, 0.05);
      for (let k = 0; k < 2; k++) s.tone(o, t + 1.25 + k * 0.22, { type: 'sawtooth', f: 160, f2: 95, dur: 0.14, gain: 0.08, filter: 700, q: 3 });
      s.noiseHit(o, t + 0.2, { dur: 1.2, type: 'highpass', f: 6000, gain: 0.03, attack: 0.4 });
      return 1.8;
    }
    case 'bell_toll':
      s.bigBell(o, t, 98, 4.5, 0.28);
      s.tone(o, t, { f: 49, dur: 3, gain: 0.12, attack: 0.02 });
      return 4.5;
    default:
      return 0.1;
  }
}
