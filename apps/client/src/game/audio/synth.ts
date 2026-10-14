/**
 * WebAudio synthesis kit shared by SFX, music and ambience. Works on any BaseAudioContext (so pages can render
 * offline with OfflineAudioContext for inspection). Every node is one-shot: sources stop themselves and the graph
 * is garbage collected; persistent music voices (Drone, Pad) stop on stop().
 *
 * pv / fv are a per-voice pitch and filter multiplier set by the engine around SFX synthesis so repeats are never
 * identical. Music leaves them at 1.
 */

import type { ClickKind, DrumKind, DroneKind, PadKind } from './music';

export interface ToneOpts {
  type?: OscillatorType; f: number; f2?: number; dur: number; gain?: number; attack?: number; detune?: number;
  filter?: number; ftype?: BiquadFilterType; q?: number; glide?: number;
}
export interface NoiseOpts {
  dur: number; gain?: number; type?: BiquadFilterType; f: number; f2?: number; q?: number; attack?: number; brown?: boolean;
}

const NYQ = 20000;
const cf = (f: number): number => Math.min(NYQ, Math.max(20, f));

export class Synth {
  readonly ctx: BaseAudioContext;
  readonly white: AudioBuffer;
  readonly brown: AudioBuffer;
  /** soft-clip curve for crunch / growl */
  readonly crunch: Float32Array<ArrayBuffer>;
  pv = 1;
  fv = 1;
  private seed = 1;

  constructor(ctx: BaseAudioContext, seed = 1) {
    this.ctx = ctx;
    this.seed = seed;
    const sr = ctx.sampleRate;
    const wl = Math.floor(sr * 2);
    this.white = ctx.createBuffer(1, wl, sr);
    const w = this.white.getChannelData(0);
    let s = 1234567;
    for (let i = 0; i < wl; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      w[i] = (s / 0x7fffffff) * 2 - 1;
    }
    const bl = Math.floor(sr * 4);
    this.brown = ctx.createBuffer(1, bl, sr);
    const b = this.brown.getChannelData(0);
    let last = 0;
    let peak = 0;
    for (let i = 0; i < bl; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      last = (last + 0.02 * ((s / 0x7fffffff) * 2 - 1)) / 1.02;
      b[i] = last;
      peak = Math.max(peak, Math.abs(last));
    }
    // normalise and crossfade the loop seam
    const fade = Math.floor(sr * 0.05);
    for (let i = 0; i < bl; i++) b[i] = (b[i] as number) / (peak || 1);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      b[i] = (b[i] as number) * k + (b[bl - fade + i] as number) * (1 - k);
    }
    const n = 1024;
    this.crunch = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      this.crunch[i] = Math.tanh(x * 3.2) / Math.tanh(3.2);
    }
  }

  rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** Percussive envelope (attack, exponential decay). Returns its length. */
  env(g: AudioParam, t: number, peak: number, attack: number, decay: number): number {
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return attack + decay;
  }

  /** Sustained envelope: attack, hold (with a slight sag), release tail. Returns total length. */
  sus(g: AudioParam, t: number, peak: number, attack: number, hold: number, release: number, sag = 0.85): number {
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.setTargetAtTime(peak * sag, t + attack, Math.max(0.05, hold / 3));
    g.setTargetAtTime(0.0001, t + attack + hold, Math.max(0.01, release / 4));
    return attack + hold + release;
  }

  private osc(type: OscillatorType, f: number, t: number, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(cf(f), t);
    if (detune) o.detune.setValueAtTime(detune, t);
    return o;
  }

  private filt(type: BiquadFilterType, f: number, q = 0.7, t = 0): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.setValueAtTime(cf(f), t);
    b.Q.setValueAtTime(q, t);
    return b;
  }

  private gain(v = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  tone(out: AudioNode, t: number, o: ToneOpts): number {
    const f = o.f * this.pv;
    const osc = this.osc(o.type ?? 'sine', f, t, o.detune ?? 0);
    if (o.f2 !== undefined) osc.frequency.exponentialRampToValueAtTime(cf(o.f2 * this.pv), t + (o.glide ?? o.dur));
    const g = this.gain();
    const len = this.env(g.gain, t, o.gain ?? 0.3, o.attack ?? 0.005, o.dur);
    let last: AudioNode = osc;
    if (o.filter) {
      const fl = this.filt(o.ftype ?? 'lowpass', o.filter * this.fv, o.q ?? 0.7, t);
      osc.connect(fl);
      last = fl;
    }
    last.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + len + 0.05);
    return len;
  }

  noiseHit(out: AudioNode, t: number, o: NoiseOpts): number {
    const src = this.ctx.createBufferSource();
    src.buffer = o.brown ? this.brown : this.white;
    const m = this.pv * this.fv;
    const fl = this.filt(o.type ?? 'bandpass', o.f * m, o.q ?? 1, t);
    if (o.f2 !== undefined) fl.frequency.exponentialRampToValueAtTime(cf(o.f2 * m), t + o.dur);
    const g = this.gain();
    const len = this.env(g.gain, t, o.gain ?? 0.3, o.attack ?? 0.004, o.dur);
    src.connect(fl);
    fl.connect(g);
    g.connect(out);
    const bl = src.buffer.duration;
    src.start(t, this.rand() * Math.max(0, bl - len - 0.1));
    src.stop(t + len + 0.05);
    return len;
  }

  /** Noise through a waveshaper: gritty crunch transients. */
  crunchHit(out: AudioNode, t: number, o: NoiseOpts & { drive?: number }): number {
    const ws = this.ctx.createWaveShaper();
    ws.curve = this.crunch;
    const pre = this.gain(o.drive ?? 4);
    const post = this.gain(0.5);
    pre.connect(ws);
    ws.connect(post);
    post.connect(out);
    return this.noiseHit(pre, t, o);
  }

  /** Glassy bell: inharmonic partials with independent decays. */
  bell(out: AudioNode, t: number, f: number, dur: number, gain = 0.2, bright = 1): number {
    const partials: [number, number, number][] = [
      [1, 1, 1],
      [2.76, 0.45 * bright, 0.6],
      [5.4, 0.25 * bright, 0.35],
      [8.93, 0.12 * bright, 0.2],
    ];
    let len = 0;
    for (const [ratio, amp, dk] of partials) {
      if (f * ratio * this.pv > NYQ) continue;
      len = Math.max(len, this.tone(out, t, { f: f * ratio, dur: dur * dk, gain: gain * amp, attack: 0.002 }));
    }
    return len;
  }

  /** Church / golem bell: hum, strike, tierce and nominal partials, long decay. */
  bigBell(out: AudioNode, t: number, f: number, dur: number, gain = 0.25): number {
    const partials: [number, number, number][] = [
      [0.5, 0.6, 1],
      [1, 1, 0.8],
      [1.2, 0.5, 0.6],
      [1.5, 0.35, 0.5],
      [2, 0.45, 0.45],
      [2.74, 0.2, 0.3],
      [3.76, 0.12, 0.2],
    ];
    for (const [r, a, dk] of partials) {
      if (gain * a < 0.006 || f * r * this.pv > NYQ) continue;
      this.tone(out, t, { f: f * r, dur: dur * dk, gain: gain * a, attack: 0.003, detune: (this.rand() - 0.5) * 6 });
    }
    this.noiseHit(out, t, { dur: 0.08, f: f * 6, q: 2, gain: gain * 0.5 });
    return dur;
  }

  /** Marimba/glass pluck. */
  pluck(out: AudioNode, t: number, f: number, dur: number, gain = 0.15): number {
    this.tone(out, t, { f: f * 4, dur: dur * 0.15, gain: gain * 0.35, attack: 0.001 });
    return this.tone(out, t, { type: 'triangle', f, dur, gain, attack: 0.002 });
  }

  // ------------------------------------------------------------------ melodic one-shots

  /** Bowed string (cello / viola): detuned saws, opening filter, delayed vibrato. */
  bowed(out: AudioNode, t: number, f: number, dur: number, gain: number, bright = 1): number {
    const ctx = this.ctx;
    const lp = this.filt('lowpass', f * 2, 1.2, t);
    lp.frequency.linearRampToValueAtTime(cf(f * 5 * bright), t + Math.min(0.4, dur * 0.4));
    const g = this.gain();
    const len = this.sus(g.gain, t, gain, Math.min(0.25, dur * 0.3), Math.max(0.05, dur - 0.25), 0.4);
    const vib = this.osc('sine', 5.2 + this.rand() * 0.6, t);
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(9, t + Math.min(0.6, dur * 0.6));
    vib.connect(vg);
    for (const det of [-6, 6]) {
      const o = this.osc('sawtooth', f, t, det);
      vg.connect(o.detune);
      o.connect(lp);
      o.start(t);
      o.stop(t + len + 0.05);
    }
    lp.connect(g);
    g.connect(out);
    vib.start(t);
    vib.stop(t + len + 0.05);
    return len;
  }

  /** Low brass: saws through a filter that blooms then settles. */
  brass(out: AudioNode, t: number, f: number, dur: number, gain: number, bright = 1): number {
    const lp = this.filt('lowpass', f * 1.2, 1.5, t);
    lp.frequency.linearRampToValueAtTime(cf(f * 6 * bright), t + 0.09);
    lp.frequency.setTargetAtTime(cf(f * 3 * bright), t + 0.1, 0.25);
    const g = this.gain();
    const len = this.sus(g.gain, t, gain, 0.06, Math.max(0.05, dur - 0.06), 0.3);
    for (const det of [-5, 5]) {
      const o = this.osc('sawtooth', f, t, det + (this.rand() - 0.5) * 3);
      o.connect(lp);
      o.start(t);
      o.stop(t + len + 0.05);
    }
    lp.connect(g);
    g.connect(out);
    return len;
  }

  /** Breathy flute; `twin` adds a detuned partner for the eerie fungal woodwinds. */
  flute(out: AudioNode, t: number, f: number, dur: number, gain: number, twin = 0): number {
    const g = this.gain();
    const len = this.sus(g.gain, t, gain, 0.08, Math.max(0.05, dur - 0.08), 0.25, 0.9);
    const vib = this.osc('sine', 4.8 + this.rand(), t);
    const vg = this.ctx.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(14, t + Math.min(0.5, dur * 0.5));
    vib.connect(vg);
    const voices: [OscillatorType, number, number, number][] = [['sine', 1, 0, 1], ['triangle', 2, 0, 0.12]];
    if (twin) voices.push(['sine', 1, twin, 0.7]);
    for (const [type, mul, det, amp] of voices) {
      const o = this.osc(type, f * mul, t, det - 30);
      o.detune.linearRampToValueAtTime(det, t + 0.09);   // pitch scoop
      vg.connect(o.detune);
      const a = this.gain(amp);
      o.connect(a);
      a.connect(g);
      o.start(t);
      o.stop(t + len + 0.05);
    }
    this.noiseHit(g, t, { dur: Math.min(0.25, dur), f: f * 2, q: 4, gain: 0.25, attack: 0.03 });
    g.connect(out);
    vib.start(t);
    vib.stop(t + len + 0.05);
    return len;
  }

  /** Reed (clarinet-ish): square through a lowpass. */
  reed(out: AudioNode, t: number, f: number, dur: number, gain: number, detune = 0): number {
    const lp = this.filt('lowpass', f * 3.5, 2, t);
    const g = this.gain();
    const len = this.sus(g.gain, t, gain, 0.05, Math.max(0.04, dur - 0.05), 0.15, 0.9);
    const o = this.osc('square', f, t, detune);
    o.connect(lp);
    lp.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + len + 0.05);
    return len;
  }

  /** Celesta / music box: sine, octave tine and a soft bell partial. */
  celesta(out: AudioNode, t: number, f: number, dur: number, gain: number): number {
    this.tone(out, t, { f: f * 4, dur: 0.08, gain: gain * 0.25, attack: 0.001 });
    this.tone(out, t, { f: f * 2, dur: dur * 0.5, gain: gain * 0.3, attack: 0.002 });
    return this.tone(out, t, { f, dur, gain, attack: 0.002 });
  }

  /** Wavering ghost-fire wail: sine glides from `from`, deep vibrato. */
  theremin(out: AudioNode, t: number, f: number, dur: number, gain: number, from?: number): number {
    const g = this.gain();
    const len = this.sus(g.gain, t, gain, 0.12, Math.max(0.05, dur - 0.12), 0.35, 0.9);
    const vib = this.osc('sine', 6.2, t);
    const vg = this.gain(22);
    vib.connect(vg);
    for (const [type, mul, amp] of [['sine', 1, 1], ['triangle', 2, 0.18]] as [OscillatorType, number, number][]) {
      const o = this.osc(type, (from ?? f) * mul, t);
      if (from) o.frequency.exponentialRampToValueAtTime(cf(f * mul), t + 0.14);
      vg.connect(o.detune);
      const a = this.gain(amp);
      o.connect(a);
      a.connect(g);
      o.start(t);
      o.stop(t + len + 0.05);
    }
    g.connect(out);
    vib.start(t);
    vib.stop(t + len + 0.05);
    return len;
  }

  /** Bone marimba: woody fundamental, hollow 4th partial, click. */
  marimba(out: AudioNode, t: number, f: number, dur: number, gain: number): number {
    this.noiseHit(out, t, { dur: 0.012, f: f * 6, q: 3, gain: gain * 0.6, attack: 0.001 });
    this.tone(out, t, { f: f * 3.9, dur: dur * 0.18, gain: gain * 0.35, attack: 0.001 });
    return this.tone(out, t, { f, dur, gain, attack: 0.002, filter: f * 3, q: 3 });
  }

  /** Harp: plucked triangle with a fading octave. */
  harp(out: AudioNode, t: number, f: number, dur: number, gain: number): number {
    this.tone(out, t, { f: f * 2, dur: dur * 0.4, gain: gain * 0.3, attack: 0.002 });
    return this.tone(out, t, { type: 'triangle', f, dur, gain, attack: 0.003, filter: f * 6 });
  }

  /** Short choir chord tone (heavy lead): saws through two vowel formants. */
  choirNote(out: AudioNode, t: number, f: number, dur: number, gain: number): number {
    const g = this.gain();
    const len = this.sus(g.gain, t, gain, 0.25, Math.max(0.05, dur - 0.25), 0.5);
    const mix = this.gain(1);
    for (const [fq, q, amp] of [[700, 6, 2.2], [1150, 8, 1.2]] as [number, number, number][]) {
      const bp = this.filt('bandpass', fq, q, t);
      const a = this.gain(amp);
      mix.connect(bp);
      bp.connect(a);
      a.connect(g);
    }
    for (const det of [-8, 7]) {
      const o = this.osc('sawtooth', f, t, det);
      o.connect(mix);
      o.start(t);
      o.stop(t + len + 0.05);
    }
    g.connect(out);
    return len;
  }

  /** Tremolo strings: saws, fast amplitude flutter. */
  tremolo(out: AudioNode, t: number, f: number, dur: number, gain: number): number {
    const g = this.gain();
    const len = this.sus(g.gain, t, gain, 0.3, Math.max(0.05, dur - 0.3), 0.4);
    const trem = this.gain(1);
    const lfo = this.osc('sine', 9 + this.rand() * 2, t);
    const lg = this.gain(0.45);
    lfo.connect(lg);
    lg.connect(trem.gain);
    const lp = this.filt('lowpass', f * 4, 0.8, t);
    for (const det of [-7, 7]) {
      const o = this.osc('sawtooth', f, t, det);
      o.connect(lp);
      o.start(t);
      o.stop(t + len + 0.05);
    }
    lp.connect(trem);
    trem.connect(g);
    g.connect(out);
    lfo.start(t);
    lfo.stop(t + len + 0.05);
    return len;
  }

  /** Distorted saw bass with a sine sub. */
  distBass(out: AudioNode, t: number, f: number, dur: number, gain: number): number {
    const ws = this.ctx.createWaveShaper();
    ws.curve = this.crunch;
    const pre = this.gain(2.5);
    const lp = this.filt('lowpass', 520, 1.4, t);
    lp.frequency.setTargetAtTime(260, t + 0.02, dur * 0.4);
    const g = this.gain();
    const len = this.env(g.gain, t, gain, 0.004, dur);
    const o = this.osc('sawtooth', f, t);
    o.connect(pre);
    pre.connect(ws);
    ws.connect(lp);
    lp.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + len + 0.05);
    this.tone(out, t, { f, dur, gain: gain * 0.7 });
    return len;
  }

  // ------------------------------------------------------------------ percussion

  drum(kind: DrumKind, out: AudioNode, t: number, vel: number): void {
    const v = vel;
    switch (kind) {
      case 'taiko':
        this.tone(out, t, { f: 95, f2: 42, dur: 0.42, gain: 0.36 * v, glide: 0.25 });
        this.noiseHit(out, t, { dur: 0.09, type: 'lowpass', f: 700, gain: 0.17 * v });
        this.noiseHit(out, t, { dur: 0.03, f: 2200, q: 1.5, gain: 0.05 * v });
        return;
      case 'muffled':
        this.tone(out, t, { f: 78, f2: 44, dur: 0.38, gain: 0.34 * v, filter: 260 });
        this.noiseHit(out, t, { dur: 0.12, type: 'lowpass', f: 320, gain: 0.16 * v, brown: true });
        return;
      case 'frame':
        this.tone(out, t, { f: 150, f2: 92, dur: 0.18, gain: 0.2 * v, glide: 0.12 });
        this.noiseHit(out, t, { dur: 0.06, f: 950, q: 1.2, gain: 0.12 * v });
        return;
      case 'timpani':
        this.tone(out, t, { f: 82, f2: 76, dur: 1.2, gain: 0.32 * v, glide: 0.4 });
        this.tone(out, t, { f: 82 * 1.5, dur: 0.6, gain: 0.08 * v });
        this.noiseHit(out, t, { dur: 0.1, type: 'lowpass', f: 900, gain: 0.12 * v });
        return;
      case 'log':
        this.tone(out, t, { f: 230, f2: 205, dur: 0.18, gain: 0.2 * v, filter: 900, q: 4 });
        this.tone(out, t, { type: 'triangle', f: 460, dur: 0.06, gain: 0.06 * v });
        this.noiseHit(out, t, { dur: 0.015, f: 1800, q: 3, gain: 0.08 * v, attack: 0.001 });
        return;
      case 'tom':
        this.tone(out, t, { f: 170, f2: 82, dur: 0.26, gain: 0.26 * v, glide: 0.18 });
        this.noiseHit(out, t, { dur: 0.07, type: 'lowpass', f: 1300, gain: 0.12 * v });
        return;
      case 'iceDrum':
        this.tone(out, t, { f: 112, f2: 58, dur: 0.32, gain: 0.3 * v, glide: 0.2 });
        this.noiseHit(out, t, { dur: 0.04, type: 'highpass', f: 6500, gain: 0.06 * v });
        return;
      case 'hoof':
        this.tone(out, t, { f: 620, f2: 430, dur: 0.05, gain: 0.12 * v, filter: 1600, q: 3 });
        this.tone(out, t, { f: 120, f2: 70, dur: 0.09, gain: 0.18 * v });
        this.noiseHit(out, t, { dur: 0.03, f: 1500, q: 2, gain: 0.08 * v });
        return;
    }
  }

  click(kind: ClickKind, out: AudioNode, t: number, vel: number): void {
    const v = vel;
    switch (kind) {
      case 'chain':
        for (let k = 0; k < 2; k++) {
          const tt = t + k * (0.03 + this.rand() * 0.03);
          this.noiseHit(out, tt, { dur: 0.035, f: 3000 + this.rand() * 1200, q: 6, gain: 0.07 * v });
          this.tone(out, tt, { f: 1300 + this.rand() * 400, dur: 0.18, gain: 0.02 * v });
        }
        return;
      case 'drip': {
        const f = 1300 + this.rand() * 1300;
        this.tone(out, t, { f, f2: f * 0.5, dur: 0.08, gain: 0.07 * v, glide: 0.05 });
        return;
      }
      case 'bone':
        this.noiseHit(out, t, { dur: 0.008, f: 2400, q: 4, gain: 0.14 * v, attack: 0.001 });
        this.tone(out, t, { type: 'triangle', f: 1150 + this.rand() * 200, f2: 900, dur: 0.045, gain: 0.08 * v });
        return;
      case 'bell':
        this.bell(out, t, 1150 + this.rand() * 300, 0.9, 0.04 * v, 0.8);
        return;
      case 'bloop':
        this.tone(out, t, { f: 260 + this.rand() * 80, f2: 900, dur: 0.09, gain: 0.1 * v, glide: 0.07, filter: 1400, q: 6 });
        return;
      case 'anvil':
        this.noiseHit(out, t, { dur: 0.02, f: 4200, q: 8, gain: 0.12 * v, attack: 0.001 });
        this.bell(out, t, 820 + this.rand() * 60, 0.7, 0.06 * v, 1.6);
        this.tone(out, t, { f: 140, f2: 80, dur: 0.08, gain: 0.08 * v });
        return;
      case 'glass':
        this.bell(out, t, 2100 + this.rand() * 900, 0.6, 0.03 * v, 1.5);
        return;
      case 'shaker':
        this.noiseHit(out, t, { dur: 0.05, type: 'highpass', f: 5200, gain: 0.04 * v, attack: 0.012 });
        return;
      case 'rattle':
        for (let k = 0; k < 4; k++) this.noiseHit(out, t + k * (0.014 + this.rand() * 0.012), { dur: 0.008, f: 1800 + this.rand() * 1400, q: 5, gain: 0.07 * v, attack: 0.001 });
        return;
      case 'insect':
        for (let k = 0; k < 3; k++) this.tone(out, t + k * 0.022, { f: 4600 + this.rand() * 1200, dur: 0.012, gain: 0.012 * v, attack: 0.002 });
        return;
      case 'hat':
        this.noiseHit(out, t, { dur: 0.04, type: 'highpass', f: 7000, gain: 0.035 * v });
        return;
      case 'ice':
        this.noiseHit(out, t, { dur: 0.02, type: 'highpass', f: 8000, gain: 0.03 * v });
        this.tone(out, t, { f: 4800 + this.rand() * 1500, dur: 0.04, gain: 0.01 * v });
        return;
      case 'whisper':
        this.whisper(out, t, 0.5, 0.05 * v);
        return;
    }
  }

  /** Breathy whisper: noise through two random vowel formants with a fluttering envelope. */
  whisper(out: AudioNode, t: number, dur: number, gain: number): number {
    const vowels: [number, number][] = [[300, 870], [400, 2000], [650, 1100], [500, 1700], [350, 2300]];
    const [f1, f2] = vowels[Math.floor(this.rand() * vowels.length)] as [number, number];
    const g = this.gain();
    const len = this.sus(g.gain, t, gain, dur * 0.3, dur * 0.4, dur * 0.3, 0.7);
    const src = this.ctx.createBufferSource();
    src.buffer = this.white;
    for (const [fq, amp] of [[f1, 1], [f2, 0.6]] as [number, number][]) {
      const bp = this.filt('bandpass', fq * (0.9 + this.rand() * 0.2), 8, t);
      const a = this.gain(amp * 3);
      src.connect(bp);
      bp.connect(a);
      a.connect(g);
    }
    g.connect(out);
    src.start(t, this.rand());
    src.stop(t + len + 0.05);
    return len;
  }
}

// ------------------------------------------------------------------ persistent music voices

/** A held drone that retunes on chord changes; one per song. */
export class Drone {
  private readonly oscs: { o: OscillatorNode; mul: number }[] = [];
  private readonly extra: AudioScheduledSourceNode[] = [];
  private readonly out: GainNode;

  constructor(private readonly s: Synth, dest: AudioNode, kind: DroneKind, f: number, t: number, level: number) {
    const ctx = s.ctx;
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0.0001, t);
    this.out.gain.linearRampToValueAtTime(level, t + 2.5);
    this.out.connect(dest);
    const add = (type: OscillatorType, mul: number, amp: number, into: AudioNode, det = 0): OscillatorNode => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(cf(f * mul), t);
      o.detune.setValueAtTime(det, t);
      const a = ctx.createGain();
      a.gain.value = amp;
      o.connect(a);
      a.connect(into);
      o.start(t);
      this.oscs.push({ o, mul });
      return o;
    };
    const lfo = (rate: number, depth: number, target: AudioParam): void => {
      const l = ctx.createOscillator();
      l.frequency.value = rate;
      const lg = ctx.createGain();
      lg.gain.value = depth;
      l.connect(lg);
      lg.connect(target);
      l.start(t);
      this.extra.push(l);
    };
    const filter = (type: BiquadFilterType, fq: number, q: number): BiquadFilterNode => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = fq;
      b.Q.value = q;
      return b;
    };
    switch (kind) {
      case 'cello': {
        const lp = filter('lowpass', 360, 1);
        lp.connect(this.out);
        lfo(0.11, 130, lp.frequency);
        const a = add('sawtooth', 1, 0.5, lp, -7);
        const b = add('sawtooth', 1, 0.5, lp, 7);
        add('sawtooth', 1.5, 0.18, lp);
        add('square', 0.5, 0.16, lp);
        lfo(4.9, 5, a.detune);
        lfo(5.3, 5, b.detune);
        break;
      }
      case 'water': {
        const lp = filter('lowpass', 520, 3.5);
        lp.connect(this.out);
        lfo(0.17, 300, lp.frequency);
        add('triangle', 1, 0.7, lp);
        add('sine', 2, 0.25, lp, 4);
        add('sine', 1.5, 0.2, lp, -3);
        break;
      }
      case 'hollow': {
        const bp = filter('bandpass', 380, 2.5);
        bp.connect(this.out);
        lfo(0.07, 90, bp.frequency);
        add('square', 1, 1.1, bp);
        add('square', 1, 0.6, bp, 9);
        add('sine', 0.5, 0.35, this.out);
        break;
      }
      case 'organ': {
        const trem = ctx.createGain();
        trem.gain.value = 1;
        trem.connect(this.out);
        lfo(5.6, 0.06, trem.gain);
        add('sine', 1, 0.5, trem);
        add('sine', 2, 0.28, trem, 2);
        add('sine', 3, 0.16, trem);
        add('sine', 4, 0.1, trem, -2);
        add('sine', 0.5, 0.3, trem);
        break;
      }
      case 'reed': {
        const lp = filter('lowpass', 700, 2);
        lp.connect(this.out);
        const a = add('square', 1, 0.3, lp, -18);
        const b = add('square', 1, 0.3, lp, 18);
        lfo(0.07, 10, a.detune);
        lfo(0.09, -12, b.detune);
        add('sine', 0.5, 0.3, this.out);
        break;
      }
      case 'growl': {
        const ws = ctx.createWaveShaper();
        ws.curve = s.crunch;
        const pre = ctx.createGain();
        pre.gain.value = 1.8;
        const lp = filter('lowpass', 260, 1.2);
        lfo(0.31, 80, lp.frequency);
        pre.connect(ws);
        ws.connect(lp);
        lp.connect(this.out);
        add('sawtooth', 1, 0.5, pre, -5);
        add('sawtooth', 0.5, 0.5, pre, 5);
        break;
      }
      case 'air': {
        const hp = filter('highpass', 150, 0.7);
        hp.connect(this.out);
        add('sine', 1, 0.35, hp);
        add('sine', 2, 0.25, hp, 3);
        add('sine', 3, 0.14, hp, -3);
        add('sine', 4.01, 0.06, hp);
        const n = ctx.createBufferSource();
        n.buffer = s.brown;
        n.loop = true;
        const bp = filter('bandpass', 1800, 1.2);
        lfo(0.05, 700, bp.frequency);
        const ng = ctx.createGain();
        ng.gain.value = 0.35;
        n.connect(bp);
        bp.connect(ng);
        ng.connect(this.out);
        n.start(t, s.rand() * 2);
        this.extra.push(n);
        break;
      }
      case 'ghost': {
        const lp = filter('lowpass', 1600, 0.8);
        lp.connect(this.out);
        const a = add('triangle', 1, 0.45, lp);
        lfo(0.3, 12, a.detune);
        add('sine', 2.01, 0.2, lp);
        const low = filter('lowpass', 220, 1);
        low.connect(this.out);
        add('sawtooth', 0.5, 0.4, low);
        break;
      }
    }
  }

  setNote(f: number, t: number, glide = 0.4): void {
    for (const { o, mul } of this.oscs) o.frequency.setTargetAtTime(cf(f * mul), t, glide / 3);
  }

  stop(t: number, fade = 2): void {
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0.0001, t, fade / 4);
    for (const { o } of this.oscs) o.stop(t + fade + 0.1);
    for (const e of this.extra) e.stop(t + fade + 0.1);
  }
}

/** Held chord pad (3-4 voices) that voice-leads between chords, sharing one filter chain per song. */
export class Pad {
  private readonly voices: { oscs: { o: OscillatorNode; mul: number }[]; f: number }[] = [];
  private readonly extra: AudioScheduledSourceNode[] = [];
  private readonly out: GainNode;
  private readonly glide: number;

  constructor(s: Synth, dest: AudioNode, kind: PadKind, freqs: readonly number[], t: number, level: number) {
    const ctx = s.ctx;
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0.0001, t);
    this.out.gain.linearRampToValueAtTime(level, t + 3);
    this.out.connect(dest);
    this.glide = kind === 'organ' ? 0.03 : kind === 'glass' ? 0.4 : 0.15;
    const filter = (type: BiquadFilterType, fq: number, q: number): BiquadFilterNode => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = fq;
      b.Q.value = q;
      return b;
    };
    const lfo = (rate: number, depth: number): GainNode => {
      const l = ctx.createOscillator();
      l.frequency.value = rate;
      const lg = ctx.createGain();
      lg.gain.value = depth;
      l.connect(lg);
      l.start(t);
      this.extra.push(l);
      return lg;
    };
    // shared input chain per kind
    let input: AudioNode = this.out;
    let vib: GainNode | null = null;
    let layers: [OscillatorType, number, number, number][] = [];
    switch (kind) {
      case 'choir':
      case 'whisperChoir': {
        const mix = ctx.createGain();
        const lp = filter('lowpass', kind === 'choir' ? 2800 : 1800, 0.7);
        lp.connect(this.out);
        const formants: [number, number, number][] = kind === 'choir' ? [[700, 7, 2.2], [1150, 9, 1.2], [2600, 10, 0.4]] : [[320, 6, 2.4], [870, 8, 1.4], [2240, 10, 0.5]];
        for (const [fq, q, amp] of formants) {
          const bp = filter('bandpass', fq, q);
          const a = ctx.createGain();
          a.gain.value = amp;
          mix.connect(bp);
          bp.connect(a);
          a.connect(lp);
        }
        input = mix;
        vib = lfo(4.8, 5);
        layers = [['sawtooth', 1, -8, 0.5], ['sawtooth', 1, 7, 0.5]];
        if (kind === 'whisperChoir') {
          const n = ctx.createBufferSource();
          n.buffer = s.white;
          n.loop = true;
          const ng = ctx.createGain();
          ng.gain.value = 0.18;
          lfo(0.13, 0.12).connect(ng.gain);
          n.connect(ng);
          ng.connect(mix);
          n.start(t, s.rand());
          this.extra.push(n);
        }
        break;
      }
      case 'softTri': {
        const trem = ctx.createGain();
        trem.gain.value = 1;
        lfo(3, 0.18).connect(trem.gain);
        const lp = filter('lowpass', 1300, 0.8);
        lp.connect(trem);
        trem.connect(this.out);
        input = lp;
        layers = [['triangle', 1, 0, 0.6], ['sine', 2, 3, 0.15]];
        break;
      }
      case 'organ':
        layers = [['sine', 1, 0, 0.45], ['sine', 2, 2, 0.25], ['sine', 4, -2, 0.08]];
        break;
      case 'woodwind': {
        const lp = filter('lowpass', 2000, 0.7);
        lp.connect(this.out);
        input = lp;
        vib = lfo(0.09, 12);
        layers = [['sine', 1, 0, 0.5], ['triangle', 1, 15, 0.3]];
        break;
      }
      case 'lowBrass': {
        const lp = filter('lowpass', 620, 1);
        lfo(0.2, 160).connect(lp.frequency);
        lp.connect(this.out);
        input = lp;
        layers = [['sawtooth', 1, -5, 0.4], ['sawtooth', 1, 5, 0.4]];
        break;
      }
      case 'glass': {
        const shimmer = ctx.createGain();
        shimmer.gain.value = 1;
        lfo(0.5, 0.3).connect(shimmer.gain);
        const hp = filter('highpass', 380, 0.7);
        hp.connect(shimmer);
        shimmer.connect(this.out);
        input = hp;
        layers = [['sine', 2, 0, 0.5], ['sine', 4, 4, 0.12], ['sine', 2, -6, 0.25]];
        break;
      }
    }
    for (const f of freqs) {
      const oscs: { o: OscillatorNode; mul: number }[] = [];
      for (const [type, mul, det, amp] of layers) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(cf(f * mul), t);
        o.detune.setValueAtTime(det + (s.rand() - 0.5) * 4, t);
        if (vib) vib.connect(o.detune);
        const a = ctx.createGain();
        a.gain.value = amp / Math.max(1, freqs.length * 0.6);
        o.connect(a);
        a.connect(input);
        o.start(t);
        oscs.push({ o, mul });
      }
      this.voices.push({ oscs, f });
    }
  }

  /** Move to a new chord: voices are paired with chord tones in pitch order (simple voice leading). */
  setChord(freqs: readonly number[], t: number): void {
    const sorted = [...freqs].sort((a, b) => a - b);
    const vs = [...this.voices].sort((a, b) => a.f - b.f);
    vs.forEach((v, i) => {
      const f = sorted[Math.min(i, sorted.length - 1)] as number;
      v.f = f;
      for (const { o, mul } of v.oscs) o.frequency.setTargetAtTime(cf(f * mul), t, this.glide / 3);
    });
  }

  stop(t: number, fade = 2.5): void {
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0.0001, t, fade / 4);
    for (const v of this.voices) for (const { o } of v.oscs) o.stop(t + fade + 0.1);
    for (const e of this.extra) e.stop(t + fade + 0.1);
  }
}

/** Synthetic stone-hall impulse response: stereo, decorrelated, exponentially decaying, darkening noise. */
export function makeImpulse(ctx: BaseAudioContext, seconds = 2.6, decay = 3): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  let s = 987654321;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const x = (s / 0x7fffffff) * 2 - 1;
      const k = i / len;
      // high frequencies die faster: one-pole lowpass whose cutoff falls over the tail
      const a = 0.25 + 0.7 * k;
      lp = lp * a + x * (1 - a);
      const early = i < sr * 0.08 && (i % Math.floor(sr * (0.011 + ch * 0.004))) < 2 ? 0.6 : 0;
      d[i] = (lp * 1.6 + early * x) * Math.pow(1 - k, decay);
    }
  }
  return buf;
}
