// Cutscene timeline: steps placed on a seconds axis, each with an easing curve. Framework-free.
// The director advances it with real (undilated) time so a scene always ends exactly when the authority's hold
// ends, even while hit-stop or slow motion bend the presentation clock. `seek` fast-forwards (late join, skip):
// steps fire in order with `skipping` set so they can suppress particles and sounds.

export type Ease = (t: number) => number;

const clamp01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t);

export const E = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; },
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  /** quantised ease: snaps to n visible steps (pixel-art fades) */
  steps: (n: number, base: Ease = (t) => t): Ease => (t) => Math.round(base(t) * n) / n,
} as const;

export interface TimelineCtx {
  /** true while fast-forwarding (skip / late join): skip particles and sounds, apply end states only */
  skipping: boolean;
}

interface Step {
  at: number;
  dur: number;
  ease: Ease;
  run?: (k: number, ctx: TimelineCtx) => void;
  start?: (ctx: TimelineCtx) => void;
  end?: (ctx: TimelineCtx) => void;
  started: boolean;
  done: boolean;
}

export class Timeline {
  t = 0;
  private steps: Step[] = [];
  private sorted = true;
  private ctx: TimelineCtx = { skipping: false };

  constructor(public readonly length: number) {}

  /** Tween over [at, at + dur]: `run(k)` with eased k in 0..1 every frame (first and last frames guaranteed). */
  tween(at: number, dur: number, run: (k: number, ctx: TimelineCtx) => void, ease: Ease = E.inOutCubic, hooks: { start?: (ctx: TimelineCtx) => void; end?: (ctx: TimelineCtx) => void } = {}): this {
    this.steps.push({ at, dur: Math.max(0, dur), ease, run, start: hooks.start, end: hooks.end, started: false, done: false });
    this.sorted = false;
    return this;
  }

  /** One-shot at `at`. */
  call(at: number, fn: (ctx: TimelineCtx) => void): this {
    this.steps.push({ at, dur: 0, ease: E.linear, start: fn, started: false, done: false });
    this.sorted = false;
    return this;
  }

  get finished() { return this.t >= this.length; }

  /** Advance by `dt` seconds. */
  update(dt: number) { this.advance(this.t + Math.max(0, dt), false); }

  /** Jump forward to `t` (never backwards), firing every step on the way with ctx.skipping = true. */
  seek(t: number) { if (t > this.t) this.advance(t, true); }

  private advance(to: number, skipping: boolean) {
    this.ctx.skipping = skipping;
    this.t = to;
    // stable order: by start time, then insertion (Array.prototype.sort is stable)
    if (!this.sorted) { this.steps.sort((a, b) => a.at - b.at); this.sorted = true; }
    for (const s of this.steps) {
      if (s.done || to < s.at) continue;
      if (!s.started) { s.started = true; s.start?.(this.ctx); }
      const k = s.dur <= 0 ? 1 : clamp01((to - s.at) / s.dur);
      if (s.run && (!skipping || k >= 1)) s.run(s.ease(k), this.ctx);
      if (k >= 1) { s.done = true; s.end?.(this.ctx); }
    }
    this.ctx.skipping = false;
  }
}

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
