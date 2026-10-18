import { describe, expect, it } from 'vitest';
import {
  MAX_VIEW_EDGE, MENU_VIEW, PLAY_VIEW, applyFit, chooseZoom, fitScale, fitView, pointerToWorld, sameFit, sanitizeDpr, targetWidth,
  type ScalableGame, type ViewFit,
} from '../src/game/viewport';

// Canvas fitting for the pixel views (game/viewport.ts): the zoom / view picked across the resolution matrix, the
// zero-size (minimised) guard, pointer mapping after a resize, and the resize reaching the renderer only on change.

const MATRIX: [number, number, number][] = [
  [1280, 720, 1], [1366, 768, 1], [1600, 900, 1], [1920, 1080, 1], [2560, 1440, 1], [3840, 2160, 1],   // 16:9
  [1280, 800, 1], [1920, 1200, 1],                                                                     // 16:10
  [2560, 1080, 1], [3440, 1440, 1], [5120, 1440, 1],                                                   // 21:9, 32:9
  [1024, 768, 1], [800, 600, 1],                                                                       // 4:3
  [900, 1400, 1], [1080, 1920, 1],                                                                     // portrait
  [640, 360, 1], [320, 200, 1],                                                                        // tiny
  [1536, 864, 1.25], [1920, 1080, 1.25], [1280, 720, 1.5], [1440, 900, 2], [1920, 1080, 2], [1707, 960, 1.5],
];

function must(f: ViewFit | null): ViewFit {
  expect(f).not.toBeNull();
  return f!;
}

describe('play view fit', () => {
  it('keeps the classic framings', () => {
    // 1080p: 2.5x -> 768x432; 1440p: 3.5x; 4K: 5.25x; a 720p window: 1.75x
    expect(must(fitView(1920, 1080, 1))).toMatchObject({ zoom: 2.5, w: 768, h: 432 });
    expect(must(fitView(2560, 1440, 1))).toMatchObject({ zoom: 3.5, w: 732, h: 412 });
    expect(must(fitView(3840, 2160, 1)).zoom).toBe(5.25);
    expect(must(fitView(1280, 720, 1)).zoom).toBe(1.75);
  });

  it('chooses the zoom in device pixels (display scaling and browser zoom keep the view)', () => {
    // a 1080p panel at 125% Windows scaling is a 1536x864 CSS window: same 2.5 device px per art px as 100%
    const scaled = must(fitView(1536, 864, 1.25));
    expect(scaled.zoom).toBe(2.5);
    expect(scaled.cssZoom).toBe(2);
    expect([scaled.w, scaled.h]).toEqual([768, 432]);
    // 150%: 1280x720 CSS = 1920x1080 device px
    expect(must(fitView(1280, 720, 1.5))).toMatchObject({ zoom: 2.5, w: 768, h: 432 });
    // retina 1440x900 @2x = 2880x1800: whole 4x
    expect(must(fitView(1440, 900, 2)).zoom).toBe(4);
  });

  it('holds its invariants across the resolution matrix', () => {
    for (const [w, h, dpr] of MATRIX) {
      const f = must(fitView(w, h, dpr));
      const devW = Math.round(w * dpr), devH = Math.round(h * dpr);
      // quarter steps, never below 1 device px per art px
      expect(f.zoom).toBeGreaterThanOrEqual(1);
      expect(f.zoom * 4).toBe(Math.round(f.zoom * 4));
      // the view covers the host, overhanging by less than one art pixel per axis
      expect(f.w * f.zoom).toBeGreaterThanOrEqual(devW);
      expect(f.h * f.zoom).toBeGreaterThanOrEqual(devH);
      expect((f.w - 1) * f.zoom).toBeLessThan(devW);
      expect((f.h - 1) * f.zoom).toBeLessThan(devH);
      // the canvas element sits on whole device pixels, centred (overhang split, never a gap at an edge)
      expect(Math.abs(f.cssW * dpr - Math.round(f.cssW * dpr))).toBeLessThan(1e-6);
      expect(Math.abs(f.left * dpr - Math.round(f.left * dpr))).toBeLessThan(1e-6);
      expect(f.left).toBeLessThanOrEqual(0);
      expect(f.top).toBeLessThanOrEqual(0);
      expect(f.left + f.cssW).toBeGreaterThanOrEqual(w - 1e-6);
      expect(f.top + f.cssH).toBeGreaterThanOrEqual(h - 1e-6);
      expect(f.cssZoom).toBeCloseTo(f.zoom / dpr, 9);
      expect(Math.max(f.w, f.h)).toBeLessThanOrEqual(MAX_VIEW_EDGE);
      // landscape screens big enough show at least the 720x405 framing (the window is never "zoomed in" past it)
      if (devW >= PLAY_VIEW.w && devH >= PLAY_VIEW.h && w >= h * (4 / 3)) {
        expect(f.w).toBeGreaterThanOrEqual(PLAY_VIEW.w);
        expect(f.h).toBeGreaterThanOrEqual(PLAY_VIEW.h);
      }
      // and never shows more than ~2x the framing on an axis (the art is not shrunk to a speck)
      if (devW >= PLAY_VIEW.w * 2 && devH >= PLAY_VIEW.h * 2) {
        expect(f.h).toBeLessThan(PLAY_VIEW.h * 2.3);
      }
    }
  });

  it('shows more world sideways on ultrawide instead of stretching', () => {
    const wide = must(fitView(3440, 1440, 1)), std = must(fitView(2560, 1440, 1));
    expect(wide.zoom).toBe(std.zoom);   // same vertical framing / pixel size as 16:9 of that height
    expect(wide.h).toBe(std.h);
    expect(wide.w).toBeGreaterThan(std.w * 1.3);
    expect(wide.w / wide.h).toBeCloseTo(3440 / 1440, 2);   // aspect follows the window: no stretch
    const superWide = must(fitView(5120, 1440, 1));
    expect(superWide.zoom).toBe(std.zoom);
  });

  it('gives tall windows a sensible pixel size and more world vertically', () => {
    const tall = must(fitView(900, 1400, 1));
    // the width target relaxes to 3/4 for portrait: 1.5x (600 art px across) instead of 1.25x
    expect(targetWidth(PLAY_VIEW, 900 / 1400)).toBeLessThan(PLAY_VIEW.w);
    expect(tall.zoom).toBe(1.5);
    expect(tall.w).toBeGreaterThanOrEqual(540);
    expect(tall.h).toBeGreaterThan(tall.w);
    // 4:3 keeps the full width target
    expect(targetWidth(PLAY_VIEW, 4 / 3)).toBe(PLAY_VIEW.w);
    expect(must(fitView(1024, 768, 1))).toMatchObject({ zoom: 1.25 });
  });

  it('treats a zero-size host (minimised / collapsed) as "keep the last size"', () => {
    for (const [w, h] of [[0, 0], [0, 720], [1280, 0], [0.4, 0.4], [NaN, 720], [Infinity, 720], [-5, 300]]) expect(fitView(w!, h!, 1)).toBeNull();
    // tiny but real windows still get a renderable canvas at 1x
    expect(must(fitView(1, 1, 1))).toMatchObject({ zoom: 1, w: 1, h: 1 });
    expect(must(fitView(320, 200, 1))).toMatchObject({ zoom: 1, w: 320, h: 200 });
  });

  it('guards odd device pixel ratios', () => {
    expect(sanitizeDpr(undefined)).toBe(1);
    expect(sanitizeDpr(0)).toBe(1);
    expect(sanitizeDpr(NaN)).toBe(1);
    expect(sanitizeDpr(1.1)).toBe(1.1);
    expect(sanitizeDpr(40)).toBe(8);
    expect(must(fitView(1920, 1080, NaN)).zoom).toBe(2.5);
  });

  it('menu backdrop keeps whole-step zooms with its slack', () => {
    expect(chooseZoom(1920, 1080, MENU_VIEW)).toBe(2);
    expect(chooseZoom(2560, 1440, MENU_VIEW)).toBe(2);
    expect(chooseZoom(2800, 1580, MENU_VIEW)).toBe(3);   // 2.92 + 0.15 slack
    expect(chooseZoom(3840, 2160, MENU_VIEW)).toBe(4);
    expect(chooseZoom(800, 600, MENU_VIEW)).toBe(1);
  });

  it('sameFit spots no-op refits', () => {
    expect(sameFit(fitView(1920, 1080, 1), fitView(1920, 1080, 1))).toBe(true);
    expect(sameFit(fitView(1920, 1080, 1), fitView(1921, 1080, 1))).toBe(false);
    expect(sameFit(null, fitView(1920, 1080, 1))).toBe(false);
  });
});

describe('pointer mapping after a resize', () => {
  it('maps the canvas centre to the camera centre at every size', () => {
    for (const [w, h, dpr] of MATRIX) {
      const f = must(fitView(w, h, dpr));
      const scrollX = -123, scrollY = 456;
      // the window centre, measured from the canvas element's left / top (which may sit off-screen by < 1 art px)
      const p = pointerToWorld(w / 2 - f.left, h / 2 - f.top, f.cssW, f.w, scrollX, scrollY);
      expect(Math.abs(p.x - (scrollX + f.w / 2))).toBeLessThanOrEqual(0.75);   // within the < 1 art px overhang
      expect(Math.abs(p.y - (scrollY + f.h / 2))).toBeLessThanOrEqual(0.75);
      // the far corner of the canvas element is the far corner of the view
      const q = pointerToWorld(f.cssW, f.cssH, f.cssW, f.w, 0, 0);
      expect(Math.abs(q.x - f.w)).toBeLessThan(0.5);   // the element is snapped to whole device px
      expect(Math.abs(q.y - f.h)).toBeLessThan(0.5);
    }
  });

  it('re-aims a still mouse with the new canvas size (stale size = wrong world point)', () => {
    const before = must(fitView(1920, 1080, 1)), after = must(fitView(1280, 720, 1));
    const mouse = { x: 960, y: 540 };   // never moved; the window shrank around it
    const stale = pointerToWorld(mouse.x, mouse.y, before.cssW, after.w, 0, 0);
    const fresh = pointerToWorld(mouse.x, mouse.y, after.cssW, after.w, 0, 0);
    expect(fresh.x).toBeCloseTo((mouse.x / after.cssW) * after.w, 6);
    expect(Math.abs(stale.x - fresh.x)).toBeGreaterThan(10);
    expect(pointerToWorld(5, 5, 0, 0, 1, 2)).toEqual({ x: 6, y: 7 });   // degenerate sizes never divide by zero
  });
});

/** A stand-in for Phaser's ScaleManager + WebGL renderer: resize() emits like Phaser and render targets follow it. */
function fakeGame(w: number, h: number, zoom: number) {
  const targets = [{ w, h }, { w: Math.round(w / 2), h: Math.round(h / 2) }];
  const log: string[] = [];
  const style: Record<string, string> = {};
  const game = {
    canvas: { style } as unknown as HTMLCanvasElement,
    scale: {
      width: w, height: h, zoom,
      resize(nw: number, nh: number) {
        log.push(`resize ${nw}x${nh}`);
        this.width = nw; this.height = nh;
        // the renderer resizes every auto-resizing render target (full and half frame) with the canvas
        targets[0] = { w: nw, h: nh };
        targets[1] = { w: Math.max(1, Math.round(nw / 2)), h: Math.max(1, Math.round(nh / 2)) };
      },
    },
  } satisfies ScalableGame;
  return { game, targets, log, style };
}

describe('applying a fit', () => {
  it('resizes the renderer and its targets only when the view changes, and places the canvas exactly', () => {
    const first = must(fitView(1920, 1080, 1));
    const g = fakeGame(first.w, first.h, first.cssZoom);
    expect(applyFit(g.game, first)).toBe(false);   // same size: no renderer churn
    expect(g.log).toEqual([]);
    expect(g.style).toMatchObject({ position: 'absolute', width: '1920px', height: '1080px', left: '0px', top: '0px' });

    const wide = must(fitView(3440, 1440, 1));
    expect(applyFit(g.game, wide)).toBe(true);
    expect(g.log).toEqual([`resize ${wide.w}x${wide.h}`]);
    expect(g.game.scale.zoom).toBe(wide.cssZoom);
    expect(g.targets[0]).toEqual({ w: wide.w, h: wide.h });
    expect(g.style.width).toBe(`${wide.cssW}px`);
    expect(g.style.left).toBe(`${wide.left}px`);

    // a DPR change alone (window dragged to a 125% monitor) changes the zoom and the view
    const moved = must(fitView(3440, 1440, 1.25));
    expect(applyFit(g.game, moved)).toBe(true);
    expect(g.game.scale.zoom).toBeCloseTo(moved.zoom / 1.25, 9);
    expect(g.game.scale.width).toBe(moved.w);
  });

  it('never hands the renderer a zero size, whatever the window does', () => {
    const start = must(fitView(1280, 720, 1));
    const g = fakeGame(start.w, start.h, start.cssZoom);
    // minimise (0x0), restore, a collapsed parent, odd DPRs: only real fits are applied
    for (const [w, h, dpr] of [[0, 0, 1], [1280, 720, 1], [0, 720, 1], [800, 0, 1.25], [640, 360, 1], [1, 1, 1], [3840, 2160, 2]]) {
      const f = fitView(w!, h!, dpr!);
      if (f) applyFit(g.game, f);
      for (const t of g.targets) { expect(t.w).toBeGreaterThan(0); expect(t.h).toBeGreaterThan(0); }
      expect(g.game.scale.width).toBeGreaterThan(0);
      expect(g.game.scale.height).toBeGreaterThan(0);
    }
  });
});

describe('DOM block scaling (Fate card row)', () => {
  it('picks the largest pixel-grid step that fits', () => {
    expect(fitScale(1080, 1900)).toBe(1);
    expect(fitScale(1080, 1024)).toBe(1);       // within the flex slack
    expect(fitScale(1008, 884)).toBe(0.75);    // a 900 px window
    expect(fitScale(1008, 624)).toBe(0.5);     // 640x360
    expect(fitScale(1008, 200)).toBe(0.5);     // never below the last step
    expect(fitScale(0, 100)).toBe(1);
    expect(fitScale(100, 0)).toBe(1);
  });
});
