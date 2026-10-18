// Canvas fitting for the pixel-art views (pure: no Phaser, no DOM; tested in apps/client/test/viewport.test.ts).
//
// The game draws into a small backing canvas (the logical view, one texel per art pixel) that the browser scales up
// with nearest-neighbour sampling (`image-rendering: pixelated`). The zoom is chosen in DEVICE pixels, not CSS px,
// so moving between monitors, Windows display scaling (125% / 150%) and browser zoom keep the same view and the most
// regular pixel pattern: whole device px per art px where the screen allows it, otherwise quarter steps (2.5x at
// 1080p, so every art pixel is 2 or 3 device px in a fixed 4-pixel rhythm, never a drifting 3.125x).
//
//  - Wider than 16:9 (ultrawide) shows more world sideways; the vertical framing stays the same.
//  - Narrower than 4:3 (portrait / tall windows) relaxes the width target down to 3/4 of it, so the hero is not
//    shrunk to a speck to fit the full landscape width; the extra height shows more world above and below.
//  - A zero-size host (minimised window, a collapsed parent, a background tab before layout) yields null: callers
//    keep the last good size instead of resizing the renderer to 0x0 (which left WebGL render targets with
//    zero-size attachments: "Framebuffer Incomplete Attachment").

export interface ViewTarget {
  /** art px the view must at least show across (landscape) */
  w: number;
  /** art px the view must at least show down */
  h: number;
  /** zoom granularity: 4 = quarter steps, 1 = whole steps */
  steps: number;
  /** added before flooring (a 0.15 bias lets a slightly-too-small window keep the next whole zoom) */
  bias?: number;
}

/** Combat: a ~720x405 Diablo-style framing in quarter-step zooms. */
export const PLAY_VIEW: ViewTarget = { w: 720, h: 405, steps: 4 };
/** Menu backdrop: a wider 960x540 framing in whole-step zooms. */
export const MENU_VIEW: ViewTarget = { w: 960, h: 540, steps: 1, bias: 0.15 };

/** Largest backing canvas edge we ever ask for (well inside every WebGL MAX_TEXTURE_SIZE / viewport limit). */
export const MAX_VIEW_EDGE = 4096;

export interface ViewFit {
  /** device px per art px */
  zoom: number;
  /** CSS px per art px (zoom / dpr): Phaser's scale zoom */
  cssZoom: number;
  /** logical view (backing canvas) size in art px; covers the whole host */
  w: number;
  h: number;
  /** canvas element size in CSS px (snapped to whole device px) */
  cssW: number;
  cssH: number;
  /** canvas offset inside the host in CSS px (<= 0: the overflow is split evenly, snapped to whole device px) */
  left: number;
  top: number;
  /** the device pixel ratio the fit was made for */
  dpr: number;
}

/** A usable device pixel ratio (browsers report odd values while zooming; guard NaN / 0 / absurd ones). */
export function sanitizeDpr(dpr: number | undefined): number {
  return typeof dpr === 'number' && Number.isFinite(dpr) && dpr > 0 ? Math.min(8, Math.max(0.25, dpr)) : 1;
}

/** Width target for a host aspect: full width at 4:3 and wider, easing to 3/4 of it at 3:4 and taller. */
export function targetWidth(t: ViewTarget, aspect: number): number {
  const lo = 3 / 4, hi = 4 / 3;
  const k = aspect >= hi ? 1 : aspect <= lo ? 0.75 : 0.75 + 0.25 * ((aspect - lo) / (hi - lo));
  return t.w * k;
}

/** Device px per art px for a host of devW x devH device px. Never below 1 (a tiny window simply sees less). */
export function chooseZoom(devW: number, devH: number, t: ViewTarget): number {
  const raw = Math.min(devW / targetWidth(t, devW / devH), devH / t.h);
  return Math.max(1, Math.floor((raw + (t.bias ?? 0)) * t.steps) / t.steps);
}

/**
 * Fit a pixel view into a cssW x cssH host at a device pixel ratio. Null when the host has no area (keep the last
 * fit). The view always covers the host (it may overhang by less than one art pixel, split between the edges).
 */
export function fitView(cssW: number, cssH: number, dprIn: number | undefined, t: ViewTarget = PLAY_VIEW): ViewFit | null {
  if (!(cssW >= 1 && cssH >= 1) || !Number.isFinite(cssW) || !Number.isFinite(cssH)) return null;
  const dpr = sanitizeDpr(dprIn);
  const devW = Math.round(cssW * dpr), devH = Math.round(cssH * dpr);
  if (devW < 1 || devH < 1) return null;
  let zoom = chooseZoom(devW, devH, t);
  // a gigantic host at zoom 1 (only possible with absurd sizes) still gets a renderable canvas
  while (Math.ceil(devW / zoom) > MAX_VIEW_EDGE || Math.ceil(devH / zoom) > MAX_VIEW_EDGE) zoom += 1 / t.steps;
  const w = Math.max(1, Math.ceil(devW / zoom)), h = Math.max(1, Math.ceil(devH / zoom));
  const canvasDevW = Math.round(w * zoom), canvasDevH = Math.round(h * zoom);
  return {
    zoom, cssZoom: zoom / dpr, w, h,
    cssW: canvasDevW / dpr, cssH: canvasDevH / dpr,
    left: Math.floor((devW - canvasDevW) / 2) / dpr, top: Math.floor((devH - canvasDevH) / 2) / dpr,
    dpr,
  };
}

/** Same logical view and placement (a re-fit that changes nothing is skipped). */
export function sameFit(a: ViewFit | null, b: ViewFit | null): boolean {
  return !!a && !!b && a.w === b.w && a.h === b.h && a.zoom === b.zoom && a.dpr === b.dpr && a.cssW === b.cssW && a.cssH === b.cssH && a.left === b.left && a.top === b.top;
}

/**
 * A pointer at (px, py) CSS px from the canvas element's top-left, to a world point under a camera scrolled to
 * (scrollX, scrollY) with an unzoomed camera. `canvasCssW` / `viewW` is the live CSS-px-per-art-px ratio (measured
 * from the element, so it is right the frame after a resize as well).
 */
export function pointerToWorld(px: number, py: number, canvasCssW: number, viewW: number, scrollX: number, scrollY: number): { x: number; y: number } {
  const k = canvasCssW > 0 && viewW > 0 ? canvasCssW / viewW : 1;
  return { x: px / k + scrollX, y: py / k + scrollY };
}

/**
 * Scale for a DOM block of `natural` px across in `avail` px: the largest of `steps` that fits (the 2x pixel skin on a
 * 2x / 1.5x / 1x grid). At full size a block may be `slack` too wide (its flex items shrink a little on their own).
 */
export function fitScale(natural: number, avail: number, steps: readonly number[] = [1, 0.75, 0.5], slack = 1.08): number {
  if (!(natural > 0) || !(avail > 0)) return 1;
  for (const s of steps) if (natural * s <= avail * (s === 1 ? slack : 1)) return s;
  return steps[steps.length - 1] ?? 1;
}

/** Structural slice of a Phaser.Game this module drives (keeps the module free of a Phaser import). */
export interface ScalableGame {
  canvas: HTMLCanvasElement;
  scale: { width: number; height: number; zoom: number; resize(w: number, h: number): unknown };
}

/**
 * Apply a fit: resize the backing canvas / renderer / cameras only when the logical size or zoom changed (Phaser
 * re-allocates its render targets on a renderer resize), then place the canvas element exactly in device px.
 */
export function applyFit(game: ScalableGame, fit: ViewFit): boolean {
  const s = game.scale;
  const changed = s.width !== fit.w || s.height !== fit.h || s.zoom !== fit.cssZoom;
  if (changed) {
    s.zoom = fit.cssZoom;
    s.resize(fit.w, fit.h);
  }
  const st = game.canvas.style;
  st.position = 'absolute';
  st.margin = '0';
  st.left = `${fit.left}px`;
  st.top = `${fit.top}px`;
  st.width = `${fit.cssW}px`;
  st.height = `${fit.cssH}px`;
  return changed;
}

/**
 * Watch a host element for anything that changes its size or the device pixel ratio: element resizes (window resize,
 * maximise / restore, fullscreen, layout changes), DPR changes (moving to another monitor, browser zoom) and
 * orientation flips. Calls `onFit` coalesced to at most once per animation frame (and at most every `minGapMs`
 * during a continuous drag, with a trailing call so the final size always lands). Zero-size hosts are skipped.
 * Returns a disposer.
 */
export function watchViewport(host: HTMLElement, target: ViewTarget, onFit: (fit: ViewFit) => void, minGapMs = 50): () => void {
  let raf = 0, timer = 0, last = 0, disposed = false;
  let mq: MediaQueryList | null = null;
  const run = () => {
    raf = 0;
    if (disposed) return;
    const now = performance.now();
    if (now - last < minGapMs) { if (!timer) timer = window.setTimeout(() => { timer = 0; schedule(); }, minGapMs - (now - last)); return; }
    last = now;
    const r = host.getBoundingClientRect();
    const fit = fitView(r.width, r.height, window.devicePixelRatio, target);
    if (fit) onFit(fit);
  };
  const schedule = () => { if (!raf && !disposed) raf = requestAnimationFrame(run); };
  const watchDpr = () => {
    mq?.removeEventListener('change', onDpr);
    mq = typeof window.matchMedia === 'function' ? window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`) : null;
    mq?.addEventListener('change', onDpr);
  };
  const onDpr = () => { watchDpr(); schedule(); };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
  ro?.observe(host);
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  document.addEventListener('fullscreenchange', schedule);
  // a hidden tab gets no frames: re-check on return (a minimise / restore may have changed the size meanwhile)
  document.addEventListener('visibilitychange', schedule);
  watchDpr();
  return () => {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    ro?.disconnect();
    mq?.removeEventListener('change', onDpr);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    document.removeEventListener('fullscreenchange', schedule);
    document.removeEventListener('visibilitychange', schedule);
  };
}

/** Initial fit for a host that may not have laid out yet (falls back to the window, then to the target itself). */
export function initialFit(host: HTMLElement, target: ViewTarget): ViewFit {
  const r = host.getBoundingClientRect();
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  return fitView(r.width, r.height, dpr, target)
    ?? (typeof window !== 'undefined' ? fitView(window.innerWidth, window.innerHeight, dpr, target) : null)
    ?? fitView(target.w, target.h, 1, target)!;
}
