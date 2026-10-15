/**
 * Adaptive music: schedules SongSpecs ahead of time (lookahead), cross-fades songs, and cross-fades each song's
 * stems by intensity. Persistent Drone/Pad voices keep CPU low (they retune instead of re-spawning), one-shot
 * notes are capped (MAX_NOTES) with ghosts/ticks dropped first. Variation is seeded per bar from the song id, so
 * it never loops identically yet co-op clients hear the same music.
 *
 * tick(now, ahead) takes explicit times so OfflineAudioContext renders can drive it synchronously.
 */

import { Drone, Pad, type Synth } from './synth';
import {
  DRUM_KINDS, STEMS, degreeMidi, hash32, mtof, patternHit, rngAt, stemLevel,
  type MotifNote, type PercVoice, type SongSpec, type Stem,
} from './music';

const MAX_NOTES = 40;

const DRONE_LEVEL: Record<SongSpec['drone'], number> = { cello: 0.07, water: 0.08, hollow: 0.05, organ: 0.07, reed: 0.06, growl: 0.075, air: 0.06, ghost: 0.07, wind: 0.065, void: 0.08, hum: 0.05 };
const PAD_LEVEL: Record<SongSpec['pad'], number> = { choir: 0.05, whisperChoir: 0.045, softTri: 0.07, organ: 0.06, woodwind: 0.05, lowBrass: 0.05, glass: 0.05 };
const STEM_TRIM: Record<Stem, number> = { bed: 1, motif: 1, bass: 1, perc: 0.85, heavy: 0.9 };

interface BarPlan {
  chord: number;
  motif: { step: number; deg: number; len: number }[];
  octave: number;
  double: boolean;
  gates: Record<PercVoice, number>;
  fill: boolean;
  leadOn: number;
}

interface Song {
  spec: SongSpec;
  seed: number;
  out: GainNode;
  stems: Record<Stem, GainNode>;
  levels: Record<Stem, number>;
  drone: Drone | null;
  pad: Pad | null;
  step: number;
  nextTime: number;
  stopping: boolean;
  plan: BarPlan | null;
  sectionProg: readonly number[];
  lastMotifF: number;
  started: number;
}

const wrap = (m: number, lo: number, hi: number): number => {
  let x = m;
  while (x < lo) x += 12;
  while (x >= hi) x -= 12;
  return x;
};

export class MusicDirector {
  private songs: Song[] = [];
  private notes: number[] = [];
  private intensity = 0;
  private readonly echoIn: GainNode;
  private readonly echoDelay: DelayNode;

  constructor(private readonly s: Synth, private readonly dest: AudioNode, private readonly reverb: AudioNode) {
    const ctx = s.ctx;
    // shared tempo-synced echo (dripping delays for flooded / frost / fungal motifs)
    this.echoIn = ctx.createGain();
    this.echoDelay = ctx.createDelay(2);
    this.echoDelay.delayTime.value = 0.45;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.echoIn.connect(this.echoDelay);
    this.echoDelay.connect(lp);
    lp.connect(fb);
    fb.connect(this.echoDelay);
    lp.connect(wet);
    wet.connect(dest);
    wet.connect(reverb);
  }

  get currentId(): string | null {
    const live = this.songs.find((x) => !x.stopping);
    return live ? live.spec.id : null;
  }

  /** Cross-fade to a song (no-op if it is already playing); null fades everything out. */
  play(spec: SongSpec | null, now: number, fade = 2.5): void {
    if (spec && this.currentId === spec.id) return;
    for (const song of this.songs) if (!song.stopping) this.stopSong(song, now, fade);
    if (!spec) return;
    const ctx = this.s.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.linearRampToValueAtTime(spec.level, now + fade);
    out.connect(this.dest);
    const send = ctx.createGain();
    send.gain.value = spec.reverb;
    out.connect(send);
    send.connect(this.reverb);
    const stems = {} as Record<Stem, GainNode>;
    const levels = {} as Record<Stem, number>;
    const I = this.effective(spec, 0);
    for (const st of STEMS) {
      const g = ctx.createGain();
      const lv = stemLevel(st, I);
      g.gain.value = lv * STEM_TRIM[st];
      g.connect(out);
      stems[st] = g;
      levels[st] = lv;
    }
    if (spec.echo > 0) {
      const es = ctx.createGain();
      es.gain.value = spec.echo;
      stems.motif.connect(es);
      es.connect(this.echoIn);
    }
    this.echoDelay.delayTime.setTargetAtTime((60 / spec.bpm) * 0.75, now, 0.1);
    const seed = hash32(spec.id);
    const song: Song = {
      spec, seed, out, stems, levels, drone: null, pad: null, step: 0, nextTime: now + 0.1, stopping: false, plan: null,
      sectionProg: spec.progressions[0] as readonly number[], lastMotifF: 0, started: now,
    };
    this.songs.push(song);
  }

  /** Smoothed 0..1 intensity (the engine applies hysteresis). */
  setIntensity(I: number): void {
    this.intensity = Math.min(1, Math.max(0, I));
  }

  private effective(spec: SongSpec, bar: number): number {
    if (spec.id === 'menu') return 0;
    if (spec.minIntensity !== undefined && bar >= (spec.introBars ?? 0)) return Math.max(spec.minIntensity, this.intensity);
    if (spec.minIntensity !== undefined) return Math.min(this.intensity, 0.2);
    return this.intensity;
  }

  private stopSong(song: Song, now: number, fade: number): void {
    song.stopping = true;
    song.out.gain.cancelScheduledValues(now);
    song.out.gain.setValueAtTime(Math.max(0.0001, song.out.gain.value), now);
    song.out.gain.linearRampToValueAtTime(0.0001, now + fade);
    song.drone?.stop(now, fade);
    song.pad?.stop(now, fade);
    const out = song.out;
    setTimeout(() => {
      try { out.disconnect(); } catch { /* gone */ }
      this.songs = this.songs.filter((x) => x !== song);
    }, (fade + 0.5) * 1000);
  }

  stopAll(now: number): void {
    for (const song of this.songs) if (!song.stopping) this.stopSong(song, now, 0.5);
  }

  tick(now: number, ahead: number): void {
    this.notes = this.notes.filter((e) => e > now);
    for (const song of this.songs) {
      if (song.stopping) continue;
      const spec = song.spec;
      const sd = 60 / spec.bpm / 4;
      // throttled tab: skip forward instead of bursting a backlog of notes
      if (song.nextTime < now - 0.25) {
        const skip = Math.ceil((now - song.nextTime) / sd);
        song.step += skip;
        song.nextTime += skip * sd;
      }
      const bar = Math.floor(song.step / spec.steps);
      const I = this.effective(spec, bar);
      for (const st of STEMS) {
        const lv = stemLevel(st, I);
        if (Math.abs(lv - song.levels[st]) > 0.01) {
          song.levels[st] = lv;
          song.stems[st].gain.setTargetAtTime(lv * STEM_TRIM[st], now, st === 'heavy' || st === 'perc' ? 0.8 : 1.5);
        }
      }
      while (song.nextTime < ahead) {
        this.step(song, song.step, song.nextTime, sd);
        song.step++;
        song.nextTime += sd;
      }
    }
  }

  // ------------------------------------------------------------------ scheduling

  private room(priority: number): boolean {
    const cap = priority >= 2 ? MAX_NOTES + 8 : priority >= 1 ? MAX_NOTES : MAX_NOTES * 0.7;
    return this.notes.length < cap;
  }

  private note(t: number, len: number): void {
    this.notes.push(t + len);
  }

  private planBar(song: Song, bar: number): BarPlan {
    const { spec, seed } = song;
    const r = (salt: number): number => rngAt(seed, bar, salt);
    if (bar % 8 === 0) {
      // new 8-bar section: pick a progression, never the same one twice in a row
      const n = spec.progressions.length;
      let idx = Math.floor(rngAt(seed, Math.floor(bar / 8), 99) * n);
      const prev = spec.progressions.indexOf(song.sectionProg);
      if (n > 1 && idx === prev) idx = (idx + 1) % n;
      if (bar === 0) idx = 0;
      song.sectionProg = spec.progressions[idx] as readonly number[];
    }
    const prog = song.sectionProg;
    const chord = prog[bar % prog.length] as number;
    const I = this.effective(spec, bar);
    const density = I < 0.3 ? (spec.calmDensity ?? 0.5) : I < 0.7 ? 0.85 : 1;
    let motif: BarPlan['motif'] = [];
    if (r(1) < density) {
      const src: readonly MotifNote[] = bar % 2 === 0 ? spec.motifA : spec.motifB;
      const invert = r(2) < 0.15;
      const shift = r(3) < 0.12 ? 2 : 0;
      const first = src[0]?.[1] ?? 0;
      motif = src
        .filter((_n, i) => i === 0 || r(10 + i) > 0.12)
        .map(([step, deg, len]) => ({ step: Math.min(spec.steps - 1, step + shift), deg: invert ? first - (deg - first) : deg, len }));
      if (r(4) < 0.12 && motif.length && (motif[0] as { step: number }).step > 0) {
        const m0 = motif[0] as { step: number; deg: number };
        motif.unshift({ step: m0.step - 1, deg: m0.deg + 1, len: 1 });
      }
      // at phrase ends answer with a held note on the chord root
      if (bar % 4 === 3 && r(5) < 0.35) motif = motif.slice(0, 2).concat([{ step: Math.floor(spec.steps / 2), deg: 0, len: Math.floor(spec.steps / 2) }]);
    }
    return {
      chord,
      motif,
      octave: r(6) < 0.18 ? 12 : 0,
      double: I > 0.7 && r(7) < 0.6,
      gates: { low: r(20), mid: r(21), accent: r(22), tick: r(23) },
      fill: bar % 4 === 3 && r(8) < 0.75,
      leadOn: r(9),
    };
  }

  private chordMidis(spec: SongSpec, chordDeg: number, base: number): number[] {
    const degs = spec.sevenths ? [0, 2, 4, 6] : [0, 2, 4];
    return degs.map((d) => wrap(degreeMidi(spec.root, spec.scale, chordDeg + d), base, base + 12)).sort((a, b) => a - b);
  }

  private step(song: Song, step: number, t: number, sd: number): void {
    const spec = song.spec;
    const sIn = step % spec.steps;
    const bar = Math.floor(step / spec.steps);
    const s = this.s;
    if (sIn === 0 || !song.plan) {
      song.plan = this.planBar(song, bar);
      const chordRoot = degreeMidi(spec.root, spec.scale, song.plan.chord);
      const droneF = mtof(wrap(chordRoot - 12, 33, 45));
      const padBase = spec.pad === 'lowBrass' ? spec.root - 2 : spec.root + 7;
      const pad = this.chordMidis(spec, song.plan.chord, padBase).map(mtof);
      if (!song.drone) song.drone = new Drone(s, song.stems.bed, spec.drone, droneF, t, DRONE_LEVEL[spec.drone]);
      else song.drone.setNote(droneF, t, 0.35);
      if (!song.pad) song.pad = new Pad(s, song.stems.bed, spec.pad, pad, t, PAD_LEVEL[spec.pad]);
      else song.pad.setChord(pad, t);
    }
    const plan = song.plan;
    const I = this.effective(spec, bar);
    const lv = song.levels;
    const chordRoot = degreeMidi(spec.root, spec.scale, plan.chord);

    // percussion: calm -> bed, combat -> perc, heavy -> heavy
    for (const voice of ['low', 'mid', 'accent', 'tick'] as PercVoice[]) {
      const line = spec.perc[voice];
      if (!line) continue;
      const gate = plan.gates[voice];
      const pri = voice === 'low' ? 2 : voice === 'tick' ? 0 : 1;
      const hitOn = (stem: Stem, pattern: string | undefined, vel: number): void => {
        if (lv[stem] < 0.02 || !pattern) return;
        const v = patternHit(pattern, sIn, gate);
        if (v <= 0 || !this.room(pri)) return;
        this.perc(line.kind, song.stems[stem], t, v * vel);
      };
      hitOn('bed', line.calm, 0.7);
      const filling = voice === 'mid' && plan.fill && spec.fill && sIn >= spec.steps * 0.75 && lv.perc > 0.02;
      if (filling) {
        const v = patternHit(spec.fill, sIn, gate);
        if (v > 0 && this.room(1)) this.perc(line.kind, song.stems.perc, t, v);
      } else hitOn('perc', line.combat, 1);
      hitOn('heavy', line.heavy, 0.9);
    }
    if (plan.fill && spec.fill && !spec.perc.mid && lv.perc > 0.02 && sIn >= spec.steps * 0.75) {
      const v = patternHit(spec.fill, sIn, plan.gates.mid);
      if (v > 0 && this.room(1)) this.perc('tom', song.stems.perc, t, v * 0.8);
    }

    // bass ostinato
    if (lv.bass > 0.02) {
      const c = spec.bassPattern[sIn % spec.bassPattern.length];
      if (c && c !== '.' && this.room(2)) {
        const deg = plan.chord + (c === 'o' ? 4 : c === 'h' ? 7 : 0);
        const m = wrap(degreeMidi(spec.root, spec.scale, deg), 31, 45);
        let len = 1;
        while (len < 4 && spec.bassPattern[(sIn + len) % spec.bassPattern.length] === '.') len++;
        this.bassNote(spec, song.stems.bass, t, mtof(m), sd * len * 1.1);
      }
    }

    // motif
    if (lv.motif > 0.02) {
      for (const n of plan.motif) {
        if (n.step !== sIn || !this.room(2)) continue;
        const m = degreeMidi(spec.root + (spec.motifOct ?? 12) + plan.octave, spec.scale, plan.chord + n.deg);
        const f = mtof(Math.min(96, m));
        const dur = n.len * sd;
        this.motifNote(song, song.stems.motif, t, f, dur, 1);
        if (plan.double && lv.heavy > 0.1 && this.room(1)) this.motifNote(song, song.stems.heavy, t, f / 2, dur, 0.6);
        song.lastMotifF = f;
      }
    }

    // heavy lead
    if (lv.heavy > 0.02 && spec.leadSteps.includes(sIn) && plan.leadOn < 0.75 && this.room(1)) {
      const idx = spec.leadSteps.indexOf(sIn);
      const next = spec.leadSteps[idx + 1] ?? spec.steps;
      const dur = (next - sIn) * sd;
      const tones = [0, 2, 4];
      const pick = tones[Math.floor(rngAt(song.seed, bar * 31 + sIn, 7) * 3)] as number;
      const m = wrap(degreeMidi(spec.root, spec.scale, plan.chord + pick), 45, 59);
      this.leadNote(spec, song.stems.heavy, t, mtof(m), dur, I);
    }

    // boss songs toll a low bell on every 4th bar downbeat
    if (spec.id.startsWith('boss:') && sIn === 0 && bar % 4 === 0 && this.room(2)) {
      this.note(t, 4);
      s.bigBell(song.stems.bed, t, mtof(wrap(chordRoot - 12, 36, 48)), 4, 0.06);
    }
    // menu: a distant toll every other bar
    if (spec.id === 'menu' && sIn === 8 && bar % 2 === 1 && this.room(2)) {
      this.note(t, 2.6);
      s.bell(song.stems.motif, t, mtof(chordRoot + 24), 2.6, 0.03, 0.7);
    }
  }

  private perc(kind: string, out: AudioNode, t: number, vel: number): void {
    if ((DRUM_KINDS as readonly string[]).includes(kind)) {
      this.s.drum(kind as Parameters<Synth['drum']>[0], out, t, vel);
      this.note(t, kind === 'timpani' ? 1.2 : 0.4);
    } else {
      this.s.click(kind as Parameters<Synth['click']>[0], out, t, vel);
      this.note(t, kind === 'bell' || kind === 'glass' || kind === 'anvil' ? 0.8 : 0.15);
    }
  }

  private bassNote(spec: SongSpec, out: AudioNode, t: number, f: number, dur: number): void {
    const s = this.s;
    let len = dur;
    switch (spec.bass) {
      case 'tri': len = s.tone(out, t, { type: 'triangle', f, dur, gain: 0.15, attack: 0.004, filter: 600 }); break;
      case 'sub': len = s.tone(out, t, { f, dur: dur * 1.3, gain: 0.2, attack: 0.02 }); break;
      case 'marimba': len = s.marimba(out, t, f * 2, Math.min(0.5, dur), 0.14); break;
      case 'pedal':
        s.tone(out, t, { f, dur: dur * 1.2, gain: 0.12, attack: 0.08 });
        len = s.tone(out, t, { f: f * 2, dur: dur * 1.2, gain: 0.06, attack: 0.08 });
        break;
      case 'reed': len = s.reed(out, t, f, Math.min(dur, 0.35), 0.07); break;
      case 'dist': len = s.distBass(out, t, f, Math.min(dur, 0.5), 0.12); break;
    }
    this.note(t, len);
  }

  private motifNote(song: Song, out: AudioNode, t: number, f: number, dur: number, vel: number): void {
    const s = this.s;
    const spec = song.spec;
    let len = dur;
    switch (spec.motif) {
      case 'cello': len = s.bowed(out, t, f, Math.max(0.3, dur), 0.07 * vel); break;
      case 'pluckEcho':
        len = s.pluck(out, t, f, 0.6, 0.07 * vel);
        break;
      case 'boneMarimba': len = s.marimba(out, t, f, 0.35, 0.09 * vel); break;
      case 'bells': len = s.bell(out, t, f, Math.max(2, dur * 1.5), 0.05 * vel, 0.8); s.tone(out, t, { f: f / 2, dur: 1.5, gain: 0.02 * vel }); break;
      case 'flute': len = s.flute(out, t, f, Math.max(0.25, dur), 0.05 * vel, 22); break;
      case 'brassStab': len = s.brass(out, t, f / 2, Math.min(0.45, dur), 0.06 * vel, 1.2); s.click('anvil', out, t, 0.4 * vel); break;
      case 'celesta': len = s.celesta(out, t, f, 1.6, 0.05 * vel); break;
      case 'harp': len = s.harp(out, t, f, 1.4, 0.06 * vel); break;
      case 'theremin': len = s.theremin(out, t, f, Math.max(0.3, dur), 0.05 * vel, song.lastMotifF || undefined); break;
      case 'tollBell': len = s.bigBell(out, t, f / 2, 2.6, 0.07 * vel); break;
      // the moon: a sonar ping, a pure sine with a soft fifth that rings out into the echo
      case 'sonar':
        len = s.tone(out, t, { f, dur: Math.max(1.6, dur), gain: 0.06 * vel, attack: 0.004 });
        s.tone(out, t + 0.02, { f: f * 1.5, dur: 0.9, gain: 0.015 * vel });
        break;
      // the server room: a filtered square-wave arpeggio note, tight and digital
      case 'arp': len = s.tone(out, t, { type: 'square', f, dur: Math.min(0.16, dur), gain: 0.035 * vel, attack: 0.002, filter: 2400, q: 2 }); break;
    }
    this.note(t, len);
  }

  private leadNote(spec: SongSpec, out: AudioNode, t: number, f: number, dur: number, I: number): void {
    const s = this.s;
    const v = 0.6 + 0.4 * I;
    let len = dur;
    switch (spec.lead) {
      case 'brass':
        len = s.brass(out, t, f, dur, 0.045 * v);
        s.brass(out, t, f / 2, dur, 0.035 * v, 0.8);
        break;
      case 'bowed': len = s.bowed(out, t, f, dur, 0.06 * v, 0.8); break;
      case 'choirFull':
        len = s.choirNote(out, t, f, dur, 0.04 * v);
        s.choirNote(out, t, f * 1.5, dur, 0.03 * v);
        break;
      case 'reedDist':
        len = s.reed(out, t, f, dur, 0.04 * v, -14);
        s.reed(out, t, f, dur, 0.04 * v, 14);
        break;
      case 'tremolo': len = s.tremolo(out, t, f * 2, dur, 0.04 * v); break;
    }
    this.note(t, len);
  }
}
