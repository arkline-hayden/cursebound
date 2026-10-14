/**
 * Musical stingers: short composed cues in the current song's key. Timing contract (seconds from the call) lives
 * in STINGER_TIMING (sfx.ts) so cutscenes can sync to `hit`. The engine ducks the music for each (STINGER_DUCK).
 */

import { degreeMidi, mtof } from './music';
import type { StingerKind } from './sfx';
import type { Synth } from './synth';

export interface StingerKey {
  root: number;
  scale: readonly number[];
  boss: string | null;
}

/** Music duck per stinger: depth (dB), hold (s), release (s). */
export const STINGER_DUCK: Record<StingerKind, [number, number, number]> = {
  door_open: [-8, 1.2, 1.2],
  portal: [-10, 1.6, 1.4],
  round_start: [-7, 1.0, 1.2],
  boss_reveal: [-16, 4.0, 1.5],
  boss_roar: [-12, 1.6, 1.0],
  round_clear: [-9, 2.0, 1.4],
  legendary: [-6, 1.5, 1.2],
  party_wipe: [-26, 5.0, 1.0],
};

export function playStinger(s: Synth, kind: StingerKind, o: AudioNode, t: number, k: StingerKey): void {
  const deg = (d: number, oct = 0): number => mtof(degreeMidi(k.root + oct, k.scale, d));
  const pc = ((k.root % 12) + 12) % 12;
  const tonic = 48 + pc;                     // C3..B3 register
  switch (kind) {
    case 'door_open': {
      s.noiseHit(o, t, { dur: 0.4, f: 250, f2: 600, q: 2, gain: 0.08, attack: 0.3, brown: true });
      const h = t + 0.35;
      s.drum('taiko', o, h, 1);
      for (const d of [0, 2, 4]) s.choirNote(o, h, deg(d, 12), 1.9, 0.035);
      s.bell(o, h, deg(0, 24), 2.2, 0.05, 0.9);
      s.noiseHit(o, h, { dur: 1.6, type: 'highpass', f: 4000, f2: 9000, gain: 0.02, attack: 0.6 });
      return;
    }
    case 'portal': {
      s.noiseHit(o, t, { dur: 0.9, f: 200, f2: 3000, q: 1.4, gain: 0.12, attack: 0.85 });
      s.tone(o, t, { type: 'triangle', f: mtof(tonic - 12), f2: mtof(tonic + 12), dur: 0.9, gain: 0.06, attack: 0.8, glide: 0.9 });
      const h = t + 0.9;
      s.tone(o, h, { f: 70, f2: 30, dur: 1.4, gain: 0.45 });
      s.bigBell(o, h, mtof(tonic - 12), 3, 0.12);
      [0, 2, 4, 7, 9, 11].forEach((d, i) => s.celesta(o, h + 0.08 + i * 0.07, deg(d, 24), 1.6, 0.04));
      return;
    }
    case 'round_start': {
      s.drum('taiko', o, t + 0.05, 1.3);
      s.drum('timpani', o, t + 0.05, 0.9);
      for (const [m, a] of [[tonic - 12, 0.08], [tonic - 5, 0.06], [tonic, 0.05]] as [number, number][]) s.brass(o, t + 0.05, mtof(m), 1.6, a, 1.2);
      s.noiseHit(o, t + 0.05, { dur: 1.6, type: 'highpass', f: 5000, gain: 0.05, attack: 0.01 });
      return;
    }
    case 'boss_reveal': {
      // 2 s crescendo (tremolo cluster, choir, riser, accelerating frame drum) into a massive impact
      s.tremolo(o, t, mtof(tonic - 12), 2.1, 0.05);
      s.tremolo(o, t, mtof(tonic - 11), 2.1, 0.035);
      s.choirNote(o, t + 0.3, mtof(tonic), 1.8, 0.035);
      s.noiseHit(o, t, { dur: 2.0, f: 300, f2: 5000, q: 1.2, gain: 0.1, attack: 1.9 });
      let gap = 0.25;
      for (let tt = t + 0.4; tt < t + 1.95; tt += gap) { s.drum('frame', o, tt, 0.4 + (tt - t) * 0.3); gap = Math.max(0.05, gap * 0.82); }
      const h = t + 2.0;
      s.tone(o, h, { f: 55, f2: 28, dur: 2.2, gain: 0.55, glide: 1.6 });
      s.drum('taiko', o, h, 1.4);
      s.drum('taiko', o, h + 0.02, 1.2);
      s.crunchHit(o, h, { dur: 0.2, type: 'lowpass', f: 1800, gain: 0.25, drive: 4 });
      s.bigBell(o, h, mtof(tonic - 24), 4, 0.16);
      for (const d of [0, 1, 7]) s.choirNote(o, h, mtof(tonic + d), 3, 0.04);
      s.brass(o, h, mtof(tonic - 12), 2.5, 0.08, 0.9);
      s.brass(o, h, mtof(tonic - 6), 2.5, 0.05, 0.9);
      return;
    }
    case 'boss_roar': {
      const h = t + 0.12;
      for (const d of [0, 1, 6]) s.brass(o, h, mtof(tonic - 12 + d), 1.8, 0.06, 1.1);
      s.drum('timpani', o, h, 1.2);
      s.noiseHit(o, t, { dur: 1.6, f: 600, f2: 300, q: 0.8, gain: 0.08, attack: 0.1 });
      if (k.boss === 'prismstag') for (const f of [1750, 1860, 2480]) s.tone(o, h, { f, f2: f * 0.8, dur: 1.4, gain: 0.02, attack: 0.08, glide: 1.4 });
      else if (k.boss === 'bellroot') s.bigBell(o, h, 65, 3.5, 0.14);
      return;
    }
    case 'round_clear': {
      // grim victory: the tonic's major chord swells under bright tolls
      for (const d of [0, 4, 7, 12]) s.choirNote(o, t, mtof(tonic + d), 2.6, 0.03);
      s.brass(o, t, mtof(tonic - 12), 2.4, 0.05, 0.8);
      s.drum('timpani', o, t, 0.7);
      [24, 28, 31].forEach((d, i) => s.bell(o, t + 0.15 + i * 0.12, mtof(tonic + d), 2.4, 0.04, 1.1));
      return;
    }
    case 'legendary': {
      for (const d of [12, 16, 19, 26]) s.choirNote(o, t, mtof(tonic + d), 2.4, 0.025);
      s.tone(o, t, { f: mtof(tonic - 24), dur: 2.2, gain: 0.12, attack: 0.3 });
      [24, 28, 31, 36, 40].forEach((d, i) => s.bell(o, t + 0.1 + i * 0.06, mtof(tonic + d), 1.6, 0.04, 1.3));
      return;
    }
    case 'party_wipe': {
      // funeral: two tolls, a descending low brass line, a dark choir
      s.bigBell(o, t, mtof(tonic - 12), 5, 0.18);
      s.bigBell(o, t + 2.2, mtof(tonic - 12), 4, 0.14);
      [0, -2, -4, -5].forEach((d, i) => s.brass(o, t + 0.4 + i * 1.0, mtof(tonic - 12 + d), 1.1, 0.07, 0.7));
      for (const d of [0, 3, 7]) s.choirNote(o, t + 0.2, mtof(tonic + d), 4.5, 0.03);
      s.tone(o, t, { f: mtof(tonic - 24), dur: 5, gain: 0.12, attack: 0.5 });
      return;
    }
  }
}
