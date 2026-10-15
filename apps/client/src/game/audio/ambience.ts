/**
 * Per-theme ambience beds: one or two continuous noise layers (looped buffers through filters whose cutoff/gain
 * wander toward random targets) plus sparse spatialised events from a small fixed pool of panners. One bed plays
 * at a time; switching themes cross-fades beds.
 */

import { mtof } from './music';
import type { AudioTheme } from './sfx';
import type { Synth } from './synth';

export type BedId = AudioTheme | 'menu';

interface Layer {
  src: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  /** wander ranges: [min, max] for cutoff and gain, retarget period [min, max] s */
  fRange: [number, number];
  gRange: [number, number];
  period: [number, number];
  next: number;
}

interface Event {
  next: number;
  every: [number, number];
  fire: (out: AudioNode, t: number) => void;
}

export class AmbienceBed {
  readonly id: BedId;
  private readonly out: GainNode;
  private readonly pans: AudioNode[] = [];
  private readonly layers: Layer[] = [];
  /** steady tonal sources (the server room's mains hum), stopped with the bed */
  private readonly oscs: OscillatorNode[] = [];
  private readonly events: Event[] = [];
  private readonly distant: BiquadFilterNode;
  private stopped = false;

  constructor(private readonly s: Synth, dest: AudioNode, reverb: AudioNode, id: BedId, t: number) {
    this.id = id;
    const ctx = s.ctx;
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0.0001, t);
    this.out.gain.linearRampToValueAtTime(1, t + 3);
    this.out.connect(dest);
    const send = ctx.createGain();
    send.gain.value = 0.5;
    this.out.connect(send);
    send.connect(reverb);
    for (const p of [-0.85, -0.4, 0.4, 0.85]) {
      if (typeof ctx.createStereoPanner === 'function') {
        const sp = ctx.createStereoPanner();
        sp.pan.value = p;
        sp.connect(this.out);
        this.pans.push(sp);
      } else this.pans.push(this.out);
    }
    // far-away events go through a dark filter into the reverb-heavy path
    this.distant = ctx.createBiquadFilter();
    this.distant.type = 'lowpass';
    this.distant.frequency.value = 1800;
    const farSend = ctx.createGain();
    farSend.gain.value = 1.4;
    this.distant.connect(this.out);
    this.distant.connect(farSend);
    farSend.connect(reverb);
    this.build(id, t);
  }

  private pan(): AudioNode {
    return this.pans[Math.floor(this.s.rand() * this.pans.length)] as AudioNode;
  }

  private layer(t: number, o: { brown?: boolean; type: BiquadFilterType; q: number; f: [number, number]; g: [number, number]; period?: [number, number] }): void {
    const ctx = this.s.ctx;
    const src = ctx.createBufferSource();
    src.buffer = o.brown ? this.s.brown : this.s.white;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type;
    filter.Q.value = o.q;
    filter.frequency.value = (o.f[0] + o.f[1]) / 2;
    const gain = ctx.createGain();
    gain.gain.value = (o.g[0] + o.g[1]) / 2;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.out);
    src.start(t, this.s.rand() * 1.5);
    this.layers.push({ src, filter, gain, fRange: o.f, gRange: o.g, period: o.period ?? [2, 5], next: t });
  }

  /** A steady electrical hum: a few harmonics of `f` through a soft lowpass, its level breathing a little. */
  private hum(t: number, f: number, gain: number): void {
    const ctx = this.s.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.value = gain;
    lp.connect(g);
    g.connect(this.out);
    for (const [mul, type, amp] of [[1, 'sine', 1], [2, 'square', 0.18], [3, 'sine', 0.3], [5, 'sine', 0.08]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mul;
      const a = ctx.createGain();
      a.gain.value = amp;
      o.connect(a);
      a.connect(lp);
      o.start(t);
      this.oscs.push(o);
    }
    const l = ctx.createOscillator();
    l.frequency.value = 0.31;
    const lg = ctx.createGain();
    lg.gain.value = gain * 0.25;
    l.connect(lg);
    lg.connect(g.gain);
    l.start(t);
    this.oscs.push(l);
  }

  private every(t: number, min: number, max: number, fire: (out: AudioNode, t: number) => void, firstDelay = 1): void {
    this.events.push({ next: t + firstDelay + this.s.rand() * (max - min), every: [min, max], fire });
  }

  private build(id: BedId, t: number): void {
    const s = this.s;
    const r = (): number => s.rand();
    const drip = (out: AudioNode, tt: number, g = 0.05): void => {
      const f = 1400 + r() * 1400;
      s.tone(out, tt, { f, f2: f * 0.55, dur: 0.09, gain: g, glide: 0.06 });
      if (r() > 0.6) s.tone(out, tt + 0.16, { f: f * 0.9, f2: f * 0.5, dur: 0.07, gain: g * 0.6, glide: 0.05 });
    };
    const chains = (out: AudioNode, tt: number, g = 0.03): void => {
      const n = 3 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const t2 = tt + k * (0.09 + r() * 0.07);
        s.noiseHit(out, t2, { dur: 0.03, f: 3000 + r() * 1800, q: 7, gain: g });
        s.tone(out, t2, { f: 2200 + r() * 900, dur: 0.12, gain: g * 0.27 });
      }
    };
    const rumble = (out: AudioNode, tt: number, g = 0.06, dur = 3): void => {
      s.noiseHit(out, tt, { dur, type: 'lowpass', f: 90, q: 1.2, gain: g, attack: dur * 0.4, brown: true });
    };
    switch (id) {
      case 'menu':
        this.layer(t, { type: 'bandpass', q: 0.7, f: [160, 420], g: [0.02, 0.045], period: [3, 7] });
        this.every(t, 7, 14, (o, tt) => chains(o, tt, 0.02), 4);
        this.every(t, 18, 34, (o, tt) => rumble(this.distant, tt, 0.04));
        break;
      case 'catacombs':
        this.layer(t, { type: 'bandpass', q: 0.7, f: [150, 420], g: [0.025, 0.055], period: [3, 7] });
        this.every(t, 0.8, 3.4, (o, tt) => drip(o, tt), 0.5);
        this.every(t, 6, 13, (o, tt) => chains(o, tt), 4);
        this.every(t, 20, 40, (o, tt) => rumble(this.distant, tt), 10);
        break;
      case 'flooded':
        // lapping water: brown noise whose level rises and falls in slow waves, plus a glinting surface band
        this.layer(t, { brown: true, type: 'lowpass', q: 1.5, f: [280, 650], g: [0.02, 0.09], period: [0.9, 2.2] });
        this.layer(t, { type: 'bandpass', q: 2, f: [600, 1300], g: [0.004, 0.016], period: [1.2, 3] });
        this.every(t, 0.35, 1.6, (o, tt) => drip(o, tt, 0.04 + r() * 0.03), 0.3);
        this.every(t, 5, 11, (o, tt) => {
          // slosh against stone
          s.noiseHit(o, tt, { dur: 1.1, type: 'bandpass', f: 300, f2: 900, q: 1.2, gain: 0.05, attack: 0.4, brown: true });
          s.noiseHit(o, tt + 0.6, { dur: 0.8, type: 'lowpass', f: 900, f2: 250, gain: 0.03, attack: 0.1 });
        }, 3);
        this.every(t, 9, 18, (o, tt) => { for (let k = 0; k < 3; k++) s.tone(o, tt + k * 0.07, { f: 300 + r() * 200, f2: 700, dur: 0.06, gain: 0.03, filter: 1200, q: 5 }); }, 6);
        break;
      case 'ossuary':
        this.layer(t, { brown: true, type: 'bandpass', q: 0.5, f: [140, 320], g: [0.02, 0.04], period: [3, 6] });
        this.every(t, 3, 8, (o, tt) => {
          const n = 4 + Math.floor(r() * 6);
          let tt2 = tt;
          for (let k = 0; k < n; k++) { s.click('bone', o, tt2, 0.25 + r() * 0.25); tt2 += 0.03 + r() * 0.08; }
        }, 2);
        this.every(t, 8, 16, (o, tt) => s.whisper(o, tt, 0.8 + r() * 0.8, 0.025 + r() * 0.02), 5);
        this.every(t, 15, 30, (o, tt) => {
          // a skull tumbling down a pile: knocks speeding up and fading
          let gap = 0.22;
          let tt2 = tt;
          for (let k = 0; k < 6; k++) { s.drum('log', this.distant, tt2, 0.5 - k * 0.07); tt2 += gap; gap *= 0.72; }
        }, 8);
        break;
      case 'sanctum':
        this.layer(t, { brown: true, type: 'lowpass', q: 0.7, f: [200, 380], g: [0.015, 0.03], period: [4, 8] });
        this.every(t, 10, 18, (_o, tt) => {
          // distant monks: a few low chanted notes on the reciting tone
          const base = 50 + (r() < 0.5 ? 0 : -2);
          const seq = [0, 0, 2, 0, -2, 0].slice(0, 3 + Math.floor(r() * 4));
          let tt2 = tt;
          for (const d of seq) {
            const dur = 0.9 + r() * 0.8;
            s.choirNote(this.distant, tt2, mtof(base + d), dur, 0.03);
            s.choirNote(this.distant, tt2, mtof(base + d - 12), dur, 0.02);
            tt2 += dur * 0.92;
          }
        }, 2);
        this.every(t, 25, 45, (_o, tt) => s.bigBell(this.distant, tt, 98, 5, 0.05), 12);
        this.every(t, 1.5, 5, (o, tt) => s.noiseHit(o, tt, { dur: 0.01, type: 'highpass', f: 3000, gain: 0.015, attack: 0.001 }), 1);
        break;
      case 'fungal':
        this.layer(t, { brown: true, type: 'bandpass', q: 0.8, f: [280, 520], g: [0.015, 0.035], period: [3, 6] });
        this.every(t, 2, 6, (o, tt) => {
          // insect chirp train
          const n = 6 + Math.floor(r() * 8);
          const f = 4200 + r() * 1800;
          const gap = 0.05 + r() * 0.04;
          for (let k = 0; k < n; k++) s.tone(o, tt + k * gap, { f: f * (k % 2 ? 1 : 1.03), dur: 0.018, gain: 0.008, attack: 0.003 });
        }, 1);
        this.every(t, 3, 7, (o, tt) => {
          // wet squelch
          s.tone(o, tt, { f: 520 + r() * 200, f2: 140, dur: 0.18, gain: 0.04, filter: 900, q: 8, glide: 0.15 });
          s.noiseHit(o, tt, { dur: 0.12, type: 'lowpass', f: 700, f2: 200, gain: 0.03 });
        }, 2);
        this.every(t, 10, 20, (o, tt) => s.noiseHit(o, tt, { dur: 1.2, type: 'highpass', f: 2500, f2: 5000, gain: 0.015, attack: 0.5 }), 6);
        this.every(t, 1.2, 4, (o, tt) => s.click('drip', o, tt, 0.5), 1);
        break;
      case 'forge':
        // furnace rumble + roaring fire band
        this.layer(t, { brown: true, type: 'lowpass', q: 1, f: [90, 160], g: [0.06, 0.11], period: [0.6, 1.8] });
        this.layer(t, { type: 'bandpass', q: 0.8, f: [320, 650], g: [0.008, 0.02], period: [0.8, 2] });
        this.every(t, 4, 9, (_o, tt) => {
          // distant smith: two to four ringing blows
          const n = 2 + Math.floor(r() * 3);
          for (let k = 0; k < n; k++) s.click('anvil', this.distant, tt + k * (0.42 + r() * 0.08), 0.5);
        }, 2);
        this.every(t, 12, 25, (o, tt) => s.noiseHit(o, tt, { dur: 1.6, type: 'highpass', f: 3000, gain: 0.02, attack: 0.3 }), 8);
        this.every(t, 2.5, 6, (o, tt) => s.tone(o, tt, { f: 90 + r() * 60, f2: 220, dur: 0.12, gain: 0.04, filter: 500, q: 6 }), 1);
        this.every(t, 0.3, 1.4, (o, tt) => s.noiseHit(o, tt, { dur: 0.012, type: 'highpass', f: 2500, gain: 0.012, attack: 0.001 }), 0.2);
        break;
      case 'frost':
        // howling wind: resonant bands wandering in pitch, gusting low layer
        this.layer(t, { type: 'bandpass', q: 7, f: [380, 900], g: [0.008, 0.035], period: [1.8, 4] });
        this.layer(t, { type: 'bandpass', q: 10, f: [900, 1700], g: [0.002, 0.012], period: [2, 5] });
        this.layer(t, { brown: true, type: 'lowpass', q: 0.7, f: [200, 420], g: [0.015, 0.05], period: [2, 4] });
        this.every(t, 6, 14, (o, tt) => {
          // ice creak: stressed crackle
          const n = 5 + Math.floor(r() * 6);
          for (let k = 0; k < n; k++) s.tone(o, tt + k * (0.02 + r() * 0.03), { type: 'sawtooth', f: 70 + r() * 90, dur: 0.03, gain: 0.02, filter: 600, q: 4 });
        }, 3);
        this.every(t, 5, 12, (o, tt) => { const n = 2 + Math.floor(r() * 3); for (let k = 0; k < n; k++) s.click('glass', o, tt + k * (0.08 + r() * 0.1), 0.7); }, 2);
        break;
      case 'sky':
        // open-air wind: a broad gusting band, a whistle over the rim, and the wind-flap of cloth and wings
        this.layer(t, { type: 'bandpass', q: 1.2, f: [250, 700], g: [0.012, 0.05], period: [1.5, 3.5] });
        this.layer(t, { type: 'bandpass', q: 9, f: [1100, 2100], g: [0.0015, 0.008], period: [2, 5] });
        this.layer(t, { brown: true, type: 'lowpass', q: 0.7, f: [120, 260], g: [0.01, 0.03], period: [2.5, 5] });
        this.every(t, 4, 10, (o, tt) => {
          // a bird's call high overhead: two falling chirps
          const f = 2600 + r() * 900;
          s.tone(o, tt, { f, f2: f * 0.7, dur: 0.12, gain: 0.012, glide: 0.1 });
          s.tone(o, tt + 0.18, { f: f * 0.95, f2: f * 0.62, dur: 0.14, gain: 0.01, glide: 0.12 });
        }, 3);
        this.every(t, 7, 15, (o, tt) => {
          // wings or cloth snapping in a gust
          for (let k = 0; k < 3; k++) s.noiseHit(o, tt + k * (0.06 + r() * 0.05), { dur: 0.05, type: 'bandpass', f: 600 + r() * 500, q: 1.5, gain: 0.02, attack: 0.004 });
        }, 5);
        this.every(t, 25, 45, (_o, tt) => rumble(this.distant, tt, 0.035, 4), 14);
        break;
      case 'moon':
        // airless quiet: a sub-bass pressure, a faint high whine in the ears, a distant beacon and radio static
        this.layer(t, { brown: true, type: 'lowpass', q: 0.8, f: [50, 110], g: [0.02, 0.04], period: [4, 9] });
        this.layer(t, { type: 'bandpass', q: 25, f: [5800, 6400], g: [0.0006, 0.0018], period: [5, 10] });
        this.every(t, 6, 12, (o, tt) => s.click('blip', o, tt, 0.6), 2);
        this.every(t, 12, 24, (o, tt) => {
          // a burst of radio static with a voice-like formant buried in it
          s.noiseHit(o, tt, { dur: 0.9, type: 'bandpass', f: 1400, f2: 900, q: 1.4, gain: 0.018, attack: 0.05 });
          s.whisper(o, tt + 0.2, 0.6, 0.012);
        }, 7);
        this.every(t, 18, 34, (o, tt) => {
          // the hull of the outpost ticking as it cools in the shadow
          for (let k = 0; k < 4; k++) s.click('bone', o, tt + k * (0.3 + r() * 0.4), 0.18);
        }, 9);
        break;
      case 'server':
        // mains hum and fan noise, drive clicks, data chirps and the odd glitch through the speakers
        this.hum(t, 60, 0.012);
        this.layer(t, { type: 'bandpass', q: 0.8, f: [900, 2200], g: [0.006, 0.014], period: [3, 6] });
        this.layer(t, { brown: true, type: 'lowpass', q: 0.7, f: [140, 300], g: [0.012, 0.024], period: [3, 6] });
        this.every(t, 0.6, 2.4, (o, tt) => { const n = 1 + Math.floor(r() * 3); for (let k = 0; k < n; k++) s.noiseHit(o, tt + k * 0.03, { dur: 0.006, type: 'highpass', f: 4000, gain: 0.01, attack: 0.001 }); }, 0.5);
        this.every(t, 4, 9, (o, tt) => {
          // a data chirp: a fast square arpeggio
          const base = 900 + r() * 600;
          for (let k = 0; k < 6; k++) s.tone(o, tt + k * 0.035, { type: 'square', f: base * (1 + (k % 3) * 0.25), dur: 0.025, gain: 0.006, filter: 3000 });
        }, 2);
        this.every(t, 10, 20, (o, tt) => s.click('glitch', o, tt, 0.6), 6);
        this.every(t, 22, 40, (_o, tt) => s.whisper(this.distant, tt, 1, 0.02), 12);
        break;
      default: {
        // every theme has a bed: a new AudioTheme without a case is a compile error here
        const missing: never = id;
        void missing;
      }
    }
  }

  tick(now: number, ahead: number): void {
    if (this.stopped) return;
    const r = (): number => this.s.rand();
    for (const L of this.layers) {
      if (now < L.next) continue;
      const span = L.period[0] + r() * (L.period[1] - L.period[0]);
      const f = L.fRange[0] + r() * (L.fRange[1] - L.fRange[0]);
      const g = L.gRange[0] + r() * (L.gRange[1] - L.gRange[0]);
      L.filter.frequency.setTargetAtTime(f, now, span / 3);
      L.gain.gain.setTargetAtTime(g, now, span / 3);
      L.next = now + span;
    }
    for (const e of this.events) {
      if (e.next > ahead) continue;
      e.fire(this.pan(), Math.max(now + 0.02, e.next));
      e.next = Math.max(now, e.next) + e.every[0] + r() * (e.every[1] - e.every[0]);
    }
  }

  stop(t: number, fade = 3): void {
    if (this.stopped) return;
    this.stopped = true;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(Math.max(0.0001, this.out.gain.value), t);
    this.out.gain.linearRampToValueAtTime(0.0001, t + fade);
    for (const L of this.layers) L.src.stop(t + fade + 0.1);
    for (const o of this.oscs) o.stop(t + fade + 0.1);
    const out = this.out;
    setTimeout(() => { try { out.disconnect(); } catch { /* gone */ } }, (fade + 0.5) * 1000);
  }
}
