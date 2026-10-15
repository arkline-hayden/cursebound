/**
 * SFX recipes: one function per SfxId, each returning its duration. Layered transients (click + body + crunch +
 * tail) give impacts weight; the engine wraps every call in a random pitch/filter offset (Synth.pv / fv).
 * `env` carries context: the current floor surface (footsteps), the music key (tonal cues stay in key) and the boss.
 */

import { mtof } from './music';
import type { SfxId } from './sfx';
import type { Synth } from './synth';

export type Floor = 'stone' | 'wet' | 'bone' | 'carpet' | 'moss' | 'grate' | 'snow' | 'dust';

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
  sky: 'moss', moon: 'dust', server: 'grate',
};

/** Pitch randomisation spread per cue (fraction); UI and big cinematic cues barely vary. */
export function pitchSpread(id: SfxId): number {
  if (id.startsWith('ui_') || id === 'move_click' || id === 'minimap_ping' || id.startsWith('vote_') || id === 'fate_commit') return 0.01;
  if (id === 'footstep') return 0.12;
  if (id === 'hit_enemy' || id === 'kill' || id === 'enemy_death' || id === 'swing' || id === 'enemy_bite') return 0.09;
  // tonal cues stay in the song's key; layered impacts and typed kills vary enough that a pack's worth never drones
  if (id === 'kill_chime' || id === 'cast_holy' || id === 'smite' || id === 'cast_astral' || id === 'impact_astral') return 0.012;
  if (id.startsWith('impact_')) return 0.08;
  if (id.startsWith('kill_') || id === 'bow_shot' || id === 'gun_shot' || id === 'blade_flurry') return 0.07;
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
    case 'dust':
      // fine regolith: a soft, dry, muffled crunch with almost no ring
      s.noiseHit(o, t, { dur: 0.07, type: 'lowpass', f: 700 * side, gain: 0.07, attack: 0.008 });
      for (let k = 0; k < 3; k++) s.noiseHit(o, t + 0.01 + k * (0.012 + r() * 0.01), { dur: 0.01, f: 1600 + r() * 900, q: 1.5, gain: 0.018, attack: 0.002 });
      return s.tone(o, t, { f: 70, f2: 48, dur: 0.05, gain: 0.04 });
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
      // four layers, distinct from any plain impact: a whip-crack transient, a heavy sub punch with crunch, the
      // two-note "ka-CHING" ring (a fifth apart, 35 ms) and a bright air tail. CombatScene stacks the typed impact under it.
      s.noiseHit(o, t, { dur: 0.004, type: 'highpass', f: 5000, gain: 0.26, attack: 0.0005 });
      s.noiseHit(o, t, { dur: 0.05, f: 1500, f2: 7000, q: 3, gain: 0.07, attack: 0.004 });
      s.tone(o, t, { f: 180, f2: 40, dur: 0.22, gain: 0.62, glide: 0.14 });
      s.crunchHit(o, t, { dur: 0.09, f: 2200, q: 0.7, gain: 0.28, drive: 7 });
      s.bell(o, t + 0.008, 1760, 0.4, 0.08, 1.5);
      s.tone(o, t + 0.043, { f: 2637, dur: 0.5, gain: 0.09, attack: 0.001 });
      s.tone(o, t + 0.043, { f: 3951, dur: 0.35, gain: 0.045, attack: 0.001 });
      s.bell(o, t + 0.045, 2637, 0.6, 0.1, 1.5);
      s.noiseHit(o, t + 0.04, { dur: 0.28, type: 'highpass', f: 7000, gain: 0.04 });
      return 0.75;
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
    case 'fate_blessing': {
      // prismatic: a soft rising swell, then a glassy lydian cascade climbing through every colour, two detuned choir
      // tones under it and a long glittering tail
      const pc = ((key % 12) + 12) % 12;
      const k0 = 74 + pc - (pc > 5 ? 12 : 0);
      s.noiseHit(o, t, { dur: 0.5, type: 'bandpass', f: 800, f2: 5000, q: 1.2, gain: 0.06, attack: 0.4 });
      s.tone(o, t, { type: 'triangle', f: mtof(k0 - 24), dur: 1.6, gain: 0.07, attack: 0.25 });
      s.tone(o, t, { type: 'triangle', f: mtof(k0 - 17), dur: 1.6, gain: 0.05, attack: 0.3, detune: 7 });
      [0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19].forEach((d, k) => {
        const tt = t + 0.12 + k * 0.055;
        s.bell(o, tt, mtof(k0 + d), 1.1 - k * 0.05, 0.05, 1.5);
        s.tone(o, tt, { f: mtof(k0 + d) * 1.006, dur: 0.6, gain: 0.014, detune: 12 });
      });
      for (let k = 0; k < 8; k++) s.bell(o, t + 0.85 + k * 0.07 + r() * 0.03, mtof(k0 + 24 + [0, 4, 7, 11][k % 4]), 0.5, 0.022, 1.6);
      s.noiseHit(o, t + 0.3, { dur: 1.4, type: 'highpass', f: 7000, f2: 11000, gain: 0.045, attack: 0.5 });
      return 2.2;
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
    case 'door_open': {
      // a heavy dungeon door: the iron latch clunks and its chain goes slack...
      s.crunchHit(o, t, { dur: 0.08, type: 'lowpass', f: 1800, gain: 0.25, drive: 3 });
      s.tone(o, t, { f: 90, f2: 48, dur: 0.18, gain: 0.35 });
      for (let k = 0; k < 5; k++) s.click('chain', o, t + 0.05 + k * 0.05 + r() * 0.02, 0.6);
      // ...the slab grinds over stone (a sweeping band of brown noise with the scrape stuttering through it)...
      s.noiseHit(o, t + 0.15, { dur: 1.5, f: 180, f2: 520, q: 3, gain: 0.22, attack: 0.25, brown: true });
      for (let k = 0; k < 14; k++) s.noiseHit(o, t + 0.2 + k * 0.095 + r() * 0.03, { dur: 0.07, f: 300 + r() * 300, q: 4, gain: 0.07 + r() * 0.04, brown: true });
      // ...the hinges groan...
      s.tone(o, t + 0.2, { type: 'sawtooth', f: 210, f2: 140, dur: 1.2, gain: 0.08, filter: 900, q: 14, glide: 1.1, attack: 0.1 });
      s.tone(o, t + 0.25, { type: 'sawtooth', f: 85, f2: 60, dur: 1.3, gain: 0.1, filter: 400, q: 8, glide: 1.2, attack: 0.15 });
      // ...and it bangs fully open while the magic behind it breathes out
      s.drum('taiko', o, t + 1.7, 1);
      s.tone(o, t + 1.7, { f: 55, f2: 32, dur: 0.6, gain: 0.45 });
      s.noiseHit(o, t + 1.65, { dur: 1.0, f: 600, f2: 3000, q: 0.8, gain: 0.1, attack: 0.15 });
      return 2.8;
    }
    case 'portal_open': {
      // a rift tears open: a sub swell under two rising swirls, a shimmer climbing the key, a crack of release,
      // then a low beating hum settles in
      s.tone(o, t, { f: 40, f2: 70, dur: 1.4, gain: 0.35, attack: 0.6, glide: 1.3 });
      s.noiseHit(o, t, { dur: 1.3, f: 250, f2: 3200, q: 2.5, gain: 0.16, attack: 0.9 });
      s.noiseHit(o, t + 0.1, { dur: 1.2, f: 400, f2: 5200, q: 4, gain: 0.08, attack: 0.8 });
      [0, 7, 12, 19, 24, 31].forEach((d, k) => s.tone(o, t + 0.2 + k * 0.12, { type: 'triangle', f: mtof(key + 24 + d), dur: 0.9, gain: 0.03, attack: 0.02 }));
      s.crunchHit(o, t + 1.25, { dur: 0.2, type: 'lowpass', f: 1500, gain: 0.2, drive: 2 });
      s.bigBell(o, t + 1.25, mtof(key - 12), 2.4, 0.08);
      for (const [f, a] of [[mtof(key - 24), 0.08], [mtof(key - 24) * 1.005, 0.06], [mtof(key - 12), 0.03]] as [number, number][]) s.tone(o, t + 1.3, { f, dur: 1.6, gain: a, attack: 0.3 });
      return 3.0;
    }
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
      if (env.boss === 'corruptcore') {
        // a machine scream: a bit-crushed square wail sliding down, torn up by glitches, over a sub drop
        for (const [f, det, g] of [[880, 0, 0.06], [1320, 14, 0.03], [440, -9, 0.05]] as [number, number, number][]) {
          s.tone(o, t, { type: 'square', f, f2: f * 0.35, dur: 1.5, gain: g, filter: 3200, attack: 0.04, glide: 1.4, detune: det });
        }
        for (let k = 0; k < 10; k++) s.click('glitch', o, t + r() * 1.4, 0.7);
        s.tone(o, t, { f: 60, f2: 30, dur: 1.6, gain: 0.3, attack: 0.05 });
        return 1.8;
      }
      if (env.boss === 'ironcolossus') {
        // a steam whistle over grinding iron and a furnace roar
        s.tone(o, t, { f: 760, f2: 690, dur: 1.4, gain: 0.05, attack: 0.08 });
        s.tone(o, t, { f: 1140, f2: 1030, dur: 1.4, gain: 0.025, attack: 0.08 });
        s.noiseHit(o, t, { dur: 1.6, type: 'lowpass', f: 500, gain: 0.25, attack: 0.1, brown: true });
        s.tone(o, t, { type: 'sawtooth', f: 46, f2: 38, dur: 1.6, gain: 0.14, filter: 260, attack: 0.1 });
        for (let k = 0; k < 4; k++) s.click('anvil', o, t + 0.2 + k * 0.3, 0.5);
        return 1.8;
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

    // ---------------------------------------------------------------- room events
    case 'coin_pickup':
      // two bright coin chinks a hair apart
      s.bell(o, t, 2900 + r() * 500, 0.22, 0.05, 1.4);
      s.bell(o, t + 0.045, 3700 + r() * 600, 0.2, 0.035, 1.4);
      return s.noiseHit(o, t, { dur: 0.015, f: 5200, q: 3, gain: 0.03, attack: 0.001 }) + 0.25;
    case 'merchant_buy':
      // a purse emptied onto the counter, then a pleased little chime in key
      for (let k = 0; k < 6; k++) s.bell(o, t + k * 0.035 + r() * 0.02, 2400 + r() * 2200, 0.25, 0.03, 1.3);
      s.drum('log', o, t + 0.02, 0.35);
      [0, 7, 12].forEach((d, k) => s.bell(o, t + 0.28 + k * 0.07, mtof(72 + (((key % 12) + 12) % 12) + d), 0.6, 0.05, 1.2));
      return 0.8;
    case 'imp_jingle':
      // a sack of coins bouncing at a run, with a cheeky little giggle on top
      for (let k = 0; k < 5; k++) s.bell(o, t + k * 0.06 + r() * 0.02, 2600 + r() * 2400, 0.18, 0.03, 1.5);
      s.tone(o, t + 0.05, { type: 'square', f: 880, f2: 1320, dur: 0.07, gain: 0.025, filter: 3000 });
      s.tone(o, t + 0.14, { type: 'square', f: 990, f2: 1480, dur: 0.07, gain: 0.02, filter: 3000 });
      return 0.45;
    case 'imp_portal':
      // a rising violet tear: filtered sweep, warbling fifth and a sucking tail
      s.noiseHit(o, t, { dur: 1.2, type: 'bandpass', f: 300, f2: 3200, q: 2, gain: 0.08, attack: 0.6 });
      s.tone(o, t, { type: 'triangle', f: 220, f2: 660, dur: 1.2, gain: 0.07, attack: 0.3, glide: 1.1 });
      s.tone(o, t, { type: 'triangle', f: 330, f2: 990, dur: 1.2, gain: 0.04, attack: 0.3, glide: 1.1, detune: 14 });
      return 1.3;
    case 'shrine_activate': {
      // a stone hum swelling into a radiant major chord and a shimmer
      const pc = ((key % 12) + 12) % 12;
      const k0 = 67 + pc - (pc > 5 ? 12 : 0);
      s.tone(o, t, { f: 70, f2: 105, dur: 0.6, gain: 0.18, attack: 0.05 });
      s.noiseHit(o, t, { dur: 0.5, type: 'bandpass', f: 600, f2: 4000, q: 1.2, gain: 0.06, attack: 0.3 });
      [0, 4, 7, 12, 16].forEach((d, k) => s.bell(o, t + 0.12 + k * 0.06, mtof(k0 + d), 1.2 - k * 0.1, 0.06, 1.3));
      s.tone(o, t + 0.1, { type: 'triangle', f: mtof(k0 - 12), dur: 1.2, gain: 0.06, attack: 0.15 });
      s.noiseHit(o, t + 0.3, { dur: 0.9, type: 'highpass', f: 6500, gain: 0.035, attack: 0.3 });
      return 1.5;
    }
    case 'altar_pact': {
      // ominous: a low drone, a minor-second cluster, a heartbeat and a whispered bargain
      const pc = ((key % 12) + 12) % 12;
      const k0 = 48 + pc;
      s.tone(o, t, { type: 'sawtooth', f: mtof(k0 - 12), dur: 1.8, gain: 0.08, filter: 420, q: 4, attack: 0.2 });
      s.tone(o, t, { type: 'triangle', f: mtof(k0), dur: 1.6, gain: 0.07, attack: 0.25 });
      s.tone(o, t, { type: 'triangle', f: mtof(k0 + 1), dur: 1.6, gain: 0.05, attack: 0.35, detune: -8 });
      s.drum('muffled', o, t + 0.1, 0.8);
      s.drum('muffled', o, t + 0.32, 0.55);
      s.whisper(o, t + 0.2, 1.1, 0.06);
      s.bell(o, t + 0.5, mtof(k0 + 25), 1.2, 0.03, 0.8);
      return 1.9;
    }
    // ---------------------------------------------------------------- layered impacts (combat feel pass)
    // Every impact stacks a transient click, a body thump and a typed tail; physical splits by weapon weight.
    case 'impact_light':
      // daggers, arrows, bolts: a bright tick, a short slap and a quick tear
      s.noiseHit(o, t, { dur: 0.004, type: 'highpass', f: 4500, gain: 0.18, attack: 0.0005 });
      s.tone(o, t, { f: 210, f2: 70, dur: 0.08, gain: 0.3, glide: 0.06 });
      s.crunchHit(o, t + 0.002, { dur: 0.04, f: 2400, q: 1, gain: 0.14, drive: 4 });
      return s.noiseHit(o, t + 0.004, { dur: 0.07, type: 'lowpass', f: 1200, f2: 400, gain: 0.08 });
    case 'impact_heavy':
      // hammers, axes, slams: a hard crack over a deep thump and sub, gritty crunch, a dull low tail and a bone knock
      s.noiseHit(o, t, { dur: 0.006, type: 'highpass', f: 3000, gain: 0.24, attack: 0.0005 });
      s.tone(o, t, { f: 120, f2: 38, dur: 0.22, gain: 0.58, glide: 0.16 });
      s.tone(o, t, { f: 62, f2: 34, dur: 0.25, gain: 0.26 });
      s.crunchHit(o, t + 0.002, { dur: 0.09, f: 1300, q: 0.8, gain: 0.26, drive: 6 });
      s.click('bone', o, t + 0.012 + r() * 0.01, 0.6);
      return s.noiseHit(o, t + 0.006, { dur: 0.22, type: 'lowpass', f: 700, f2: 150, gain: 0.16, brown: true });
    case 'impact_fire':
      // a hot tick, a whoomp of flame over a thump, then crackling embers
      s.noiseHit(o, t, { dur: 0.004, type: 'highpass', f: 3500, gain: 0.14, attack: 0.0005 });
      s.noiseHit(o, t, { dur: 0.16, type: 'lowpass', f: 900, f2: 180, gain: 0.3, attack: 0.006, brown: true });
      s.tone(o, t, { f: 140, f2: 55, dur: 0.12, gain: 0.28 });
      for (let k = 0; k < 4; k++) s.noiseHit(o, t + 0.03 + r() * 0.18, { dur: 0.008, type: 'highpass', f: 3000 + r() * 3000, gain: 0.05, attack: 0.001 });
      return 0.24;
    case 'impact_frost':
      // a glassy tick, a dull thud through ice, a crack and a little tinkle of rime
      s.noiseHit(o, t, { dur: 0.006, type: 'highpass', f: 6000, gain: 0.12, attack: 0.0005 });
      s.tone(o, t, { type: 'triangle', f: 3200, dur: 0.03, gain: 0.05, attack: 0.001 });
      s.tone(o, t, { f: 160, f2: 70, dur: 0.1, gain: 0.3 });
      s.crunchHit(o, t + 0.003, { dur: 0.03, type: 'highpass', f: 2000, gain: 0.14, drive: 6 });
      for (let k = 0; k < 3; k++) s.bell(o, t + 0.02 + k * 0.03, 2600 + r() * 2400, 0.18, 0.025, 1.6);
      return 0.25;
    case 'impact_storm':
      // an electric snap, a buzzing body and a skitter of sparks
      s.noiseHit(o, t, { dur: 0.005, type: 'highpass', f: 5000, gain: 0.2, attack: 0.0005 });
      s.tone(o, t, { f: 130, f2: 60, dur: 0.1, gain: 0.26 });
      s.tone(o, t, { type: 'square', f: 90 + r() * 20, dur: 0.09, gain: 0.07, filter: 1800 });
      for (let k = 0; k < 3; k++) s.tone(o, t + k * 0.025, { type: 'square', f: 900 + r() * 1600, f2: 400, dur: 0.03, gain: 0.04, filter: 5000 });
      return s.noiseHit(o, t + 0.01, { dur: 0.12, type: 'highpass', f: 4000, gain: 0.05 });
    case 'impact_decay':
      // a wet slap, a squelching body and a gurgle
      s.noiseHit(o, t, { dur: 0.01, f: 1800, q: 1.5, gain: 0.16, attack: 0.001 });
      s.tone(o, t, { f: 180, f2: 70, dur: 0.12, gain: 0.28, filter: 700, q: 3 });
      s.noiseHit(o, t + 0.005, { dur: 0.14, f: 700, f2: 260, q: 4, gain: 0.2 });
      s.click('bloop', o, t + 0.05 + r() * 0.03, 0.6);
      return 0.08 + s.tone(o, t + 0.08, { f: 300, f2: 520, dur: 0.06, gain: 0.04, filter: 900, q: 6 });
    case 'impact_astral': {
      // a bright ping, a soft thump and a shimmer in the song's key
      const pent = [0, 2, 4, 7, 9];
      s.noiseHit(o, t, { dur: 0.004, type: 'highpass', f: 5000, gain: 0.1, attack: 0.0005 });
      s.tone(o, t, { f: 2600, dur: 0.05, gain: 0.045, attack: 0.001 });
      s.tone(o, t, { f: 150, f2: 60, dur: 0.1, gain: 0.26 });
      s.bell(o, t + 0.01, mtof(key + 36 + pent[Math.floor(r() * pent.length)]!), 0.35, 0.04, 1.5);
      s.noiseHit(o, t + 0.02, { dur: 0.2, type: 'highpass', f: 7000, gain: 0.025, attack: 0.02 });
      return 0.36;
    }

    // ---------------------------------------------------------------- kills by damage type
    case 'kill_burn':
      // char sizzle: a whump, a flare, a long hiss with crackles popping through it
      s.noiseHit(o, t, { dur: 0.25, type: 'lowpass', f: 600, f2: 120, gain: 0.3, brown: true });
      s.tone(o, t, { f: 90, f2: 40, dur: 0.25, gain: 0.3 });
      s.noiseHit(o, t + 0.01, { dur: 0.18, f: 1200, f2: 3200, q: 1, gain: 0.12, attack: 0.01 });
      s.noiseHit(o, t + 0.04, { dur: 0.6, type: 'highpass', f: 5000, f2: 2600, gain: 0.06, attack: 0.03 });
      for (let k = 0; k < 8; k++) s.noiseHit(o, t + 0.05 + r() * 0.5, { dur: 0.007, type: 'highpass', f: 2500 + r() * 4000, gain: 0.05 + r() * 0.03, attack: 0.001 });
      return 0.7;
    case 'kill_shatter':
      // ice shatter: a hard crack, a crash of glass and shards raining down
      s.crunchHit(o, t, { dur: 0.08, type: 'highpass', f: 1600, gain: 0.3, drive: 7 });
      s.tone(o, t, { f: 130, f2: 60, dur: 0.12, gain: 0.24 });
      s.noiseHit(o, t, { dur: 0.3, type: 'highpass', f: 4000, gain: 0.1 });
      for (let k = 0; k < 10; k++) s.bell(o, t + 0.01 + r() * 0.35, 2000 + r() * 4000, 0.2 + r() * 0.15, 0.02 + r() * 0.015, 1.6);
      return 0.6;
    case 'kill_zap':
      // zap: a snap, an arcing buzz and a crackle that sputters out downward
      s.noiseHit(o, t, { dur: 0.006, type: 'highpass', f: 5000, gain: 0.24, attack: 0.0005 });
      s.tone(o, t, { f: 120, f2: 45, dur: 0.15, gain: 0.26 });
      s.tone(o, t, { type: 'sawtooth', f: 140, f2: 60, dur: 0.3, gain: 0.06, filter: 2500, q: 2 });
      s.tone(o, t, { type: 'square', f: 220, f2: 80, dur: 0.22, gain: 0.04, filter: 3000 });
      for (let k = 0; k < 7; k++) s.tone(o, t + 0.02 + k * 0.04, { type: 'square', f: 2400 - k * 250 + r() * 400, f2: 300, dur: 0.025, gain: 0.05 - k * 0.005, filter: 6000 });
      return 0.45;
    case 'kill_squelch':
      // squelch: a wet splat over a low drop, a soft crunch and bubbles popping
      s.noiseHit(o, t, { dur: 0.2, f: 900, f2: 250, q: 3, gain: 0.3 });
      s.tone(o, t, { f: 110, f2: 38, dur: 0.25, gain: 0.42, glide: 0.2 });
      s.crunchHit(o, t + 0.01, { dur: 0.1, type: 'lowpass', f: 1400, f2: 300, gain: 0.16, drive: 3 });
      for (let k = 0; k < 4; k++) s.click('bloop', o, t + 0.08 + k * 0.07 + r() * 0.03, 0.5 + r() * 0.3);
      s.tone(o, t + 0.12, { f: 260, f2: 500, dur: 0.05, gain: 0.035, filter: 800, q: 8 });
      return 0.55;
    case 'kill_chime': {
      // holy chime: a soft thump, a rising triad in the song's key and an airy shimmer
      s.tone(o, t, { f: 140, f2: 60, dur: 0.12, gain: 0.2 });
      [0, 4, 7].forEach((d, k) => s.bell(o, t + k * 0.045, mtof(key + 24 + d), 0.7, 0.05, 1.3));
      s.noiseHit(o, t + 0.05, { dur: 0.5, type: 'highpass', f: 6000, f2: 9000, gain: 0.035, attack: 0.08 });
      return 0.8;
    }

    // ---------------------------------------------------------------- ability casts and impacts (class fx)
    case 'cast_fire':
      // ignition: a rising whoosh of flame over a low roar, a few crackles
      s.noiseHit(o, t, { dur: 0.28, f: 300, f2: 2400, q: 1.2, gain: 0.22, attack: 0.08 });
      s.noiseHit(o, t, { dur: 0.3, type: 'lowpass', f: 220, gain: 0.14, attack: 0.05, brown: true });
      s.tone(o, t, { f: 80, f2: 140, dur: 0.2, gain: 0.08, attack: 0.04 });
      for (let k = 0; k < 4; k++) s.noiseHit(o, t + 0.08 + r() * 0.22, { dur: 0.008, type: 'highpass', f: 3000 + r() * 3000, gain: 0.05, attack: 0.001 });
      return 0.35;
    case 'blast_fire':
      // explosion: a deep boom, a gritty blast front, a rolling fireball and falling debris
      s.tone(o, t, { f: 70, f2: 30, dur: 0.5, gain: 0.58, glide: 0.4 });
      s.crunchHit(o, t, { dur: 0.15, type: 'lowpass', f: 2000, f2: 300, gain: 0.28, drive: 4 });
      s.noiseHit(o, t, { dur: 0.55, type: 'lowpass', f: 1200, f2: 150, gain: 0.38, brown: true });
      for (let k = 0; k < 8; k++) s.noiseHit(o, t + 0.06 + r() * 0.45, { dur: 0.008, type: 'highpass', f: 2500 + r() * 3500, gain: 0.05, attack: 0.001 });
      return 0.65;
    case 'cast_frost':
      // crystalline swell: rising air, three glassy partials and a scatter of ice ticks
      s.noiseHit(o, t, { dur: 0.3, type: 'highpass', f: 3000, f2: 8000, gain: 0.06, attack: 0.2 });
      for (let k = 0; k < 3; k++) s.tone(o, t + k * 0.05, { type: 'triangle', f: 1800 + k * 600, f2: 2200 + k * 600, dur: 0.25, gain: 0.022, attack: 0.08 });
      for (let k = 0; k < 4; k++) s.click('ice', o, t + 0.05 + r() * 0.25, 0.6);
      return 0.4;
    case 'blast_frost':
      // ice burst: a thud, a hard crack, a hiss of frost and shards
      s.tone(o, t, { f: 110, f2: 50, dur: 0.25, gain: 0.34 });
      s.crunchHit(o, t, { dur: 0.1, type: 'highpass', f: 1500, gain: 0.26, drive: 6 });
      s.noiseHit(o, t, { dur: 0.4, type: 'highpass', f: 4500, gain: 0.08 });
      for (let k = 0; k < 8; k++) s.bell(o, t + 0.01 + r() * 0.3, 2000 + r() * 3000, 0.22, 0.025, 1.6);
      return 0.55;
    case 'cast_storm':
      // charge: a whine climbing over hissing static, released with a snap
      s.tone(o, t, { type: 'sawtooth', f: 200, f2: 1600, dur: 0.22, gain: 0.04, filter: 3000, glide: 0.2 });
      s.noiseHit(o, t, { dur: 0.2, type: 'highpass', f: 4000, gain: 0.05, attack: 0.12 });
      return 0.2 + s.noiseHit(o, t + 0.2, { dur: 0.006, type: 'highpass', f: 5000, gain: 0.16, attack: 0.0005 });
    case 'zap_strike':
      // lightning strike: a split-second crack, sizzling arcs, then a short thunder roll
      s.noiseHit(o, t, { dur: 0.008, type: 'highpass', f: 3000, gain: 0.3, attack: 0.0005 });
      s.crunchHit(o, t, { dur: 0.05, type: 'highpass', f: 2500, gain: 0.24, drive: 8 });
      for (let k = 0; k < 5; k++) s.tone(o, t + k * 0.03, { type: 'square', f: 700 + r() * 1800, f2: 250 + r() * 300, dur: 0.04, gain: 0.05, filter: 5000 });
      s.noiseHit(o, t + 0.02, { dur: 0.6, type: 'lowpass', f: 300, f2: 80, gain: 0.24, attack: 0.02, brown: true });
      return s.tone(o, t + 0.02, { f: 60, f2: 35, dur: 0.4, gain: 0.24 });
    case 'cast_decay':
      // a gurgling whisper over two sickly detuned tones
      s.whisper(o, t, 0.35, 0.04);
      s.noiseHit(o, t, { dur: 0.3, f: 500, f2: 900, q: 5, gain: 0.1, attack: 0.05 });
      s.tone(o, t, { type: 'triangle', f: 170, dur: 0.3, gain: 0.04, attack: 0.05 });
      s.tone(o, t, { type: 'triangle', f: 176, dur: 0.3, gain: 0.04, attack: 0.05 });
      for (let k = 0; k < 2; k++) s.click('bloop', o, t + 0.08 + k * 0.12, 0.5);
      return 0.4;
    case 'blast_decay':
      // rot burst: a wet pop, a splattering spray and bubbles
      s.tone(o, t, { f: 160, f2: 45, dur: 0.2, gain: 0.38 });
      s.noiseHit(o, t, { dur: 0.25, f: 1100, f2: 300, q: 2, gain: 0.24 });
      s.noiseHit(o, t + 0.02, { dur: 0.35, type: 'highpass', f: 3500, gain: 0.06, attack: 0.02 });
      for (let k = 0; k < 3; k++) s.click('bloop', o, t + 0.06 + k * 0.08, 0.6);
      return 0.45;
    case 'cast_holy':
      // a choir swell on the root and fifth of the song's key, a bell above and a breath of light
      s.choirNote(o, t, mtof(key + 12), 0.6, 0.035);
      s.choirNote(o, t, mtof(key + 19), 0.6, 0.025);
      s.bell(o, t + 0.05, mtof(key + 24), 0.6, 0.05, 1.2);
      s.noiseHit(o, t, { dur: 0.5, type: 'highpass', f: 6000, gain: 0.03, attack: 0.2 });
      return 0.7;
    case 'smite':
      // holy strike: a thump, a crack of judgement and two bells in key ringing out
      s.tone(o, t, { f: 120, f2: 45, dur: 0.25, gain: 0.44 });
      s.crunchHit(o, t, { dur: 0.08, type: 'lowpass', f: 2200, gain: 0.2, drive: 4 });
      s.bell(o, t + 0.01, mtof(key + 24), 1.0, 0.1, 1.3);
      s.bell(o, t + 0.03, mtof(key + 31), 0.8, 0.05, 1.3);
      s.noiseHit(o, t + 0.02, { dur: 0.4, type: 'highpass', f: 5000, gain: 0.05, attack: 0.02 });
      return 1.0;
    case 'cast_astral':
      // starlight: an ascending pentatonic glitter, a soft rising tone and shimmer
      [0, 7, 12, 19].forEach((d, k) => s.bell(o, t + k * 0.03, mtof(key + 24 + d), 0.4, 0.03, 1.5));
      s.tone(o, t, { type: 'triangle', f: 400, f2: 1200, dur: 0.25, gain: 0.04, attack: 0.03 });
      s.noiseHit(o, t, { dur: 0.3, type: 'highpass', f: 5000, gain: 0.04, attack: 0.1 });
      return 0.5;
    case 'bow_shot':
      // a taut twang, the string's thrum and the arrow's whistle
      s.pluck(o, t, 180 + r() * 20, 0.25, 0.12);
      s.tone(o, t, { type: 'triangle', f: 110, dur: 0.12, gain: 0.08 });
      return s.noiseHit(o, t + 0.01, { dur: 0.18, f: 3000, f2: 1800, q: 6, gain: 0.05, attack: 0.02 });
    case 'gun_shot':
      // repeater: a mechanical clack, a compressed pop and a puff of steam
      s.noiseHit(o, t, { dur: 0.012, f: 2500, q: 3, gain: 0.15, attack: 0.001 });
      s.tone(o, t, { f: 300, f2: 90, dur: 0.05, gain: 0.2 });
      return s.noiseHit(o, t + 0.005, { dur: 0.06, type: 'lowpass', f: 1500, gain: 0.1 });
    case 'throw_whoosh':
      // a spinning throw: two overlapping whooshes
      s.noiseHit(o, t, { dur: 0.25, f: 500, f2: 1800, q: 2, gain: 0.15, attack: 0.08 });
      return 0.08 + s.noiseHit(o, t + 0.08, { dur: 0.22, f: 600, f2: 2000, q: 2, gain: 0.1, attack: 0.07 });
    case 'slam_heavy':
      // ground slam (lighter than a signature): a thud, a crunch, a rumble and debris
      s.tone(o, t, { f: 90, f2: 36, dur: 0.4, gain: 0.48 });
      s.crunchHit(o, t, { dur: 0.1, f: 1200, q: 0.8, gain: 0.22 });
      s.noiseHit(o, t, { dur: 0.4, type: 'lowpass', f: 800, f2: 120, gain: 0.28, brown: true });
      for (let k = 0; k < 4; k++) s.click('bone', o, t + 0.05 + r() * 0.25, 0.4 + r() * 0.3);
      return 0.5;
    case 'blade_flurry':
      // three quick slashes and a glint
      for (let k = 0; k < 3; k++) s.noiseHit(o, t + k * 0.055, { dur: 0.06, f: 900, f2: 4000, q: 2, gain: 0.12, attack: 0.01 });
      return 0.11 + s.tone(o, t + 0.11, { f: 3000, dur: 0.12, gain: 0.03, attack: 0.002 });
    case 'shield_bash':
      // a metal clang over a heavy thump
      s.tone(o, t, { f: 110, f2: 45, dur: 0.15, gain: 0.44 });
      s.crunchHit(o, t, { dur: 0.05, f: 1600, gain: 0.18 });
      s.bell(o, t, 380, 0.35, 0.12, 1.2);
      return s.bell(o, t + 0.005, 570, 0.25, 0.06, 1.2);
    case 'summon_rise':
      // a spirit rising: a swelling whoosh, a whisper and a climbing tone
      s.noiseHit(o, t, { dur: 0.5, f: 200, f2: 2000, q: 2, gain: 0.12, attack: 0.35 });
      s.whisper(o, t + 0.05, 0.5, 0.04);
      return s.tone(o, t, { type: 'triangle', f: 110, f2: 330, dur: 0.5, gain: 0.06, attack: 0.2, glide: 0.45 });
    case 'beast_howl':
      // a wolf's howl: a rising, wavering tone through a formant
      s.tone(o, t, { type: 'sawtooth', f: 330, f2: 640, dur: 0.55, gain: 0.05, filter: 1600, q: 3, attack: 0.06, glide: 0.25 });
      s.tone(o, t, { type: 'triangle', f: 336, f2: 650, dur: 0.55, gain: 0.04, attack: 0.08, glide: 0.3, detune: 12 });
      return s.noiseHit(o, t, { dur: 0.5, f: 900, q: 4, gain: 0.03, attack: 0.1 });
    case 'beast_roar':
      // a short growl: a rough saw through a low formant over a sub
      s.tone(o, t, { type: 'sawtooth', f: 90, f2: 70, dur: 0.5, gain: 0.12, filter: 700, q: 4, attack: 0.03 });
      s.noiseHit(o, t, { dur: 0.45, f: 400, f2: 250, q: 1, gain: 0.14, attack: 0.04 });
      return s.tone(o, t, { f: 50, f2: 35, dur: 0.5, gain: 0.24 });
    case 'mech_deploy':
      // a clank, a servo whirr and the lock clicking home
      s.crunchHit(o, t, { dur: 0.03, f: 2000, q: 3, gain: 0.2, drive: 4 });
      s.bell(o, t, 900, 0.2, 0.04, 1.4);
      s.tone(o, t + 0.05, { type: 'square', f: 300, f2: 600, dur: 0.25, gain: 0.03, filter: 1500, glide: 0.2 });
      return 0.28 + s.crunchHit(o, t + 0.28, { dur: 0.03, f: 2400, q: 3, gain: 0.16, drive: 4 });
    case 'steam_vent':
      // a burst of steam: a falling hiss, a thin whistle and a low chug
      s.noiseHit(o, t, { dur: 0.6, type: 'highpass', f: 2500, f2: 1200, gain: 0.14, attack: 0.01 });
      s.tone(o, t, { f: 1800, f2: 1600, dur: 0.4, gain: 0.02, attack: 0.02 });
      s.tone(o, t, { f: 70, dur: 0.2, gain: 0.14 });
      return 0.65;
    case 'trap_snap':
      // steel jaws: a hard snap, a ring and a spring twang
      s.crunchHit(o, t, { dur: 0.03, type: 'highpass', f: 2500, gain: 0.28, drive: 6 });
      s.bell(o, t, 1200, 0.15, 0.05, 1.6);
      s.tone(o, t, { f: 160, f2: 60, dur: 0.08, gain: 0.24 });
      s.pluck(o, t + 0.01, 420, 0.2, 0.05);
      return 0.3;
    case 'blink':
      // a short teleport zip: down out of sight, up into place
      s.tone(o, t, { type: 'triangle', f: 1400, f2: 300, dur: 0.16, gain: 0.08 });
      s.noiseHit(o, t, { dur: 0.12, type: 'highpass', f: 3000, f2: 7000, gain: 0.05, attack: 0.01 });
      return 0.12 + s.tone(o, t + 0.12, { type: 'triangle', f: 300, f2: 1400, dur: 0.1, gain: 0.04 });
    // ---------------------------------------------------------------- the Corrupted Core
    case 'core_charge':
      // capacitors spinning up: a filtered saw sweep over a hiss riser, a stutter of blips on top
      s.tone(o, t, { type: 'sawtooth', f: 180, f2: 1500, dur: 0.95, gain: 0.07, filter: 2400, q: 6, attack: 0.3, glide: 0.9 });
      s.noiseHit(o, t, { dur: 0.9, f: 800, f2: 5000, q: 2, gain: 0.06, attack: 0.7 });
      for (let k = 0; k < 4; k++) s.click('blip', o, t + 0.5 + k * 0.09, 0.6);
      return 1.0;
    case 'core_laser':
      s.tone(o, t, { type: 'square', f: 1900, f2: 320, dur: 0.16, gain: 0.045, filter: 3600 });
      s.noiseHit(o, t, { dur: 0.08, type: 'highpass', f: 4000, gain: 0.05 });
      return s.tone(o, t, { type: 'sawtooth', f: 95, f2: 60, dur: 0.22, gain: 0.06, filter: 600 });
    case 'core_firewall':
      s.noiseHit(o, t, { dur: 1.2, type: 'lowpass', f: 380, f2: 1400, q: 1.5, gain: 0.22, attack: 0.15, brown: true });
      s.tone(o, t, { type: 'sawtooth', f: 62, f2: 74, dur: 1.2, gain: 0.08, filter: 500, attack: 0.1 });
      for (let k = 0; k < 6; k++) s.click('glitch', o, t + r() * 1.0, 0.5);
      return 1.3;
    case 'core_glitch':
      for (let k = 0; k < 6; k++) {
        s.click('glitch', o, t + k * 0.045, 0.8);
        s.tone(o, t + k * 0.045, { type: 'square', f: 300 + r() * 1800, dur: 0.03, gain: 0.035, filter: 4000 });
      }
      return 0.4;
    case 'core_purge_alarm':
      // klaxon: two tones alternating four times over a sub drone
      for (let k = 0; k < 4; k++) s.tone(o, t + k * 0.4, { type: 'square', f: k % 2 ? 660 : 880, dur: 0.34, gain: 0.05, filter: 2200, attack: 0.02 });
      s.tone(o, t, { type: 'sawtooth', f: 41, dur: 1.7, gain: 0.08, filter: 300, attack: 0.2 });
      return 1.8;
    case 'core_purge':
      s.crunchHit(o, t, { dur: 0.35, f: 700, q: 0.7, gain: 0.32, drive: 6 });
      s.tone(o, t, { f: 55, f2: 28, dur: 1.4, gain: 0.32, attack: 0.01 });
      s.noiseHit(o, t + 0.05, { dur: 1.2, f: 3000, f2: 300, q: 1, gain: 0.1, attack: 0.02 });
      for (let k = 0; k < 8; k++) s.click('glitch', o, t + 0.1 + r() * 0.8, 0.6);
      return 1.5;
    case 'core_deploy':
      s.tone(o, t, { type: 'square', f: 420, f2: 1260, dur: 0.12, gain: 0.04, filter: 3000 });
      s.click('anvil', o, t + 0.1, 0.4);
      return s.noiseHit(o, t + 0.1, { dur: 0.25, type: 'highpass', f: 3000, gain: 0.04, attack: 0.02 }) + 0.1;

    // ---------------------------------------------------------------- the Iron Colossus
    case 'colossus_raise':
      // iron groaning up: a slow, detuned saw creak, chains and a hiss of steam
      s.tone(o, t, { type: 'sawtooth', f: 70, f2: 110, dur: 1.1, gain: 0.1, filter: 420, q: 5, attack: 0.25, glide: 1.0 });
      s.tone(o, t, { type: 'sawtooth', f: 73, f2: 115, dur: 1.1, gain: 0.06, filter: 380, q: 4, attack: 0.3, glide: 1.0, detune: 18 });
      for (let k = 0; k < 4; k++) s.click('chain', o, t + 0.15 + k * 0.18, 0.7);
      s.noiseHit(o, t + 0.5, { dur: 0.7, type: 'highpass', f: 3500, gain: 0.05, attack: 0.2 });
      return 1.2;
    case 'colossus_hammer':
      s.crunchHit(o, t, { dur: 0.3, f: 900, q: 0.8, gain: 0.38, drive: 6 });
      s.tone(o, t, { f: 72, f2: 30, dur: 1.2, gain: 0.42, attack: 0.005 });
      s.click('anvil', o, t, 1);
      s.bell(o, t + 0.01, 196, 1.3, 0.08, 0.6);
      s.noiseHit(o, t + 0.04, { dur: 0.9, type: 'lowpass', f: 300, gain: 0.18, attack: 0.02, brown: true });
      return 1.4;
    case 'colossus_stomp':
      s.tone(o, t, { f: 62, f2: 34, dur: 0.45, gain: 0.34, attack: 0.004 });
      return s.noiseHit(o, t, { dur: 0.3, type: 'lowpass', f: 260, gain: 0.2, brown: true });
    case 'colossus_vent':
      s.noiseHit(o, t, { dur: 1.2, type: 'highpass', f: 2600, gain: 0.12, attack: 0.04 });
      s.noiseHit(o, t, { dur: 1.0, f: 900, q: 1.2, gain: 0.06, attack: 0.05 });
      s.tone(o, t + 0.05, { f: 1250, f2: 980, dur: 0.9, gain: 0.03, attack: 0.1 });
      return 1.3;
    case 'lava_vent':
      for (let k = 0; k < 7; k++) s.tone(o, t + k * 0.13 + r() * 0.05, { f: 110 + r() * 90, f2: 70, dur: 0.1, gain: 0.08, filter: 500, q: 3 });
      return 1.0;
    case 'lava_erupt':
      s.noiseHit(o, t, { dur: 0.9, f: 300, f2: 2200, q: 1.2, gain: 0.18, attack: 0.06 });
      s.crunchHit(o, t + 0.05, { dur: 0.25, f: 1200, q: 0.8, gain: 0.16, drive: 4 });
      return s.tone(o, t, { f: 58, f2: 40, dur: 0.8, gain: 0.2 });
    default:
      return 0.1;
  }
}
