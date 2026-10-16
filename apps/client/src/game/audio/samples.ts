import { SFX_FILES } from './sfxFiles.generated';

// Recorded sound files (public/audio/sfx, listed in sfxFiles.generated.ts). Loaded and decoded once the AudioContext
// exists, a few at a time; each take is levelled to a common loudness and its leading silence skipped, because
// generated takes vary a lot in level and often start late. A cue with files plays a random take (never the same
// take twice in a row); a cue without files (or not decoded yet) falls back to its synthesized recipe.

export interface Take {
  buf: AudioBuffer;
  /** seconds of leading silence to skip */
  offset: number;
  /** gain that brings the take to the common loudness */
  gain: number;
}

const BASE = '/audio/';
/** target RMS of a take's audible part (about -18 dBFS); the engine's per-cue volumes and mix groups sit on top */
const TARGET_RMS = 0.125;
/** a take's peak never goes past this after levelling */
const PEAK_CEIL = 0.95;
/** amplitude that counts as sound when trimming the start */
const GATE = 0.012;

export class SampleBank {
  private readonly takes = new Map<string, Take[]>();
  private readonly last = new Map<string, number>();
  private bytes: Promise<[string, ArrayBuffer | null]>[] | null = null;
  private started = false;

  /** Cue ids that have recorded files (decoded or not). */
  static has(key: string): boolean {
    return !!SFX_FILES[key]?.length;
  }

  /** Start downloading every file (no AudioContext needed), so the first sounds after the unlocking gesture are ready. */
  prefetch(): void {
    if (this.bytes || typeof fetch !== 'function') return;
    const queue = Object.entries(SFX_FILES).flatMap(([key, files]) => files.map((f) => [key, f] as const));
    this.bytes = queue.map(async ([key, file]) => {
      try {
        const res = await fetch(BASE + file);
        return [key, res.ok ? await res.arrayBuffer() : null] as [string, ArrayBuffer | null];
      } catch {
        return [key, null] as [string, ArrayBuffer | null];
      }
    });
  }

  /** Decode the downloaded files (call once the context exists). */
  load(ctx: BaseAudioContext): void {
    if (this.started) return;
    this.started = true;
    this.prefetch();
    for (const p of this.bytes ?? []) {
      void p.then(async ([key, data]) => {
        if (!data) return;
        try {
          const take = level(await ctx.decodeAudioData(data));
          const list = this.takes.get(key) ?? [];
          list.push(take);
          this.takes.set(key, list);
        } catch {
          /* a broken file just keeps the synthesized fallback */
        }
      });
    }
  }

  /** At least one take of the cue is decoded. */
  ready(key: string): boolean {
    return !!this.takes.get(key)?.length;
  }

  /** A decoded take for the cue, or null (no files, or still loading). */
  pick(key: string, rand: () => number): Take | null {
    const list = this.takes.get(key);
    if (!list?.length) return null;
    if (list.length === 1) return list[0]!;
    const prev = this.last.get(key) ?? -1;
    let i = Math.floor(rand() * list.length);
    if (i === prev) i = (i + 1) % list.length;
    this.last.set(key, i);
    return list[i]!;
  }
}

/** Measure a take: skip leading silence, gain to the common RMS, capped by the peak. */
export function level(buf: AudioBuffer): Take {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const data: Float32Array[] = [];
  for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  let start = 0;
  outer: for (; start < n; start++) for (let c = 0; c < ch; c++) if (Math.abs(data[c]![start]!) > GATE) break outer;
  if (start >= n) return { buf, offset: 0, gain: 1 };
  // back off ~4 ms so the attack keeps its transient
  start = Math.max(0, start - Math.round(buf.sampleRate * 0.004));
  let peak = 0, sum = 0, count = 0;
  for (let i = start; i < n; i++) {
    let v = 0;
    for (let c = 0; c < ch; c++) v = Math.max(v, Math.abs(data[c]![i]!));
    if (v > peak) peak = v;
    if (v > GATE) { sum += v * v; count++; }
  }
  const rms = count ? Math.sqrt(sum / count) : 0;
  let gain = rms > 0 ? TARGET_RMS / rms : 1;
  if (peak > 0) gain = Math.min(gain, PEAK_CEIL / peak);
  gain = Math.min(4, Math.max(0.25, gain));
  return { buf, offset: start / buf.sampleRate, gain };
}
