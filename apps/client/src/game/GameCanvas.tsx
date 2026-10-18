'use client';

import { useEffect, useRef, useState } from 'react';
import type { GameConnection } from '@/lib/net';
import type { AudioEngine } from './audio/AudioEngine';
import { CANVAS_FONT_SPECS } from '@/ui/fonts';
import { settingsStore } from '@/lib/settings';
import { useStore } from '@/lib/store';
import { GFX_PRESETS, type GfxKnobs } from './gfxProfile';
import { PLAY_VIEW, applyFit, initialFit, watchViewport } from './viewport';

// Client-only Phaser host (PRD §17.1): instantiated after mount, disposed on route changes; high-frequency
// state never routes through React. Rendering uses a device-pixel zoom (game/viewport.ts) so art pixels stay crisp;
// the logical view grows with the window instead of stretching. The graphics tier (game/gfx.ts) sets the light
// count compiled into the Light2D shader and the frame cap, so changing tiers rebuilds the game; the scene redraws
// from the connection's latest snapshots, so the run itself is untouched.

/** Renderer config that depends on the graphics tier (shared with the menu backdrop). */
export function tierRenderConfig(k: GfxKnobs) {
  return {
    // the shader's light array needs at least one slot; low never binds Light2D, so the one slot costs nothing
    maxLights: Math.max(1, k.maxLights),
    // low caps at 30 fps (a real limit, not just a smoothing hint) so weak laptops spend half the frames
    fps: k.fps < 60 ? { target: k.fps, limit: k.fps } : { target: 60 },
  };
}

/**
 * Play camera: a tighter Diablo-style framing than the menu backdrop. The logical view targets ~720x405 (a little
 * wider than the old 640x360). The zoom is chosen in DEVICE pixels and snaps down to quarter steps (2.5x at 1080p =
 * 768x432, 3.5x at 1440p, 2.5x for a 1080p screen at 125% Windows scaling), so the nearest-neighbour pixel pattern
 * stays regular; ultrawide shows more world sideways, tall windows more above and below. See game/viewport.ts.
 */
export const PLAY_BASE_W = PLAY_VIEW.w;
export const PLAY_BASE_H = PLAY_VIEW.h;

export async function waitForPixelFonts() {
  try {
    await Promise.race([
      Promise.all(CANVAS_FONT_SPECS.map((f) => document.fonts.load(f))),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch { /* fonts optional */ }
}

export default function GameCanvas({ net, audio }: { net: GameConnection; audio: AudioEngine | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const tier = useStore(settingsStore, (x) => x.s.graphics);
  useEffect(() => {
    const knobs = GFX_PRESETS[tier] ?? GFX_PRESETS.high;
    let game: import('phaser').Game | null = null;
    let cancelled = false;
    let unwatch: (() => void) | null = null;
    (async () => {
      try {
        const PhaserMod = await import('phaser'); const Phaser = ((PhaserMod as unknown as { default?: typeof PhaserMod }).default ?? PhaserMod) as typeof import('phaser');
        const { CombatScene } = await import('./scene/CombatScene');
        await waitForPixelFonts();
        if (cancelled || !ref.current) return;
        const probe = document.createElement('canvas');
        if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
          setError('Your browser does not provide WebGL, which CURSEBOUND needs. Try current Chrome, Edge or Firefox with hardware acceleration enabled.');
          return;
        }
        // never 0x0, even before layout or in a minimised window (zero-size render targets are incomplete framebuffers)
        const fit = initialFit(ref.current, PLAY_VIEW);
        const g = game = new Phaser.Game({
          type: Phaser.WEBGL,
          parent: ref.current,
          width: fit.w,
          height: fit.h,
          zoom: fit.cssZoom,
          pixelArt: true,
          roundPixels: true,
          antialias: false,
          backgroundColor: '#050303',
          // sizing and placement are ours (game/viewport.ts): device-pixel exact, never resized to 0x0
          scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.NO_CENTER },
          ...tierRenderConfig(knobs),
          audio: { noAudio: true },
          input: { keyboard: false, mouse: false, touch: false, gamepad: false },
          banner: false,
        } as Phaser.Types.Core.GameConfig);
        game.scene.add('combat', CombatScene, true, { net, audio });
        // dev builds only: a handle for headless resize / resolution checks (never in production bundles)
        if (process.env.NODE_ENV !== 'production') (window as unknown as { __cbGame?: unknown }).__cbGame = game;
        applyFit(g, fit);
        // live resizes (window, maximise / restore, fullscreen, another monitor or browser zoom), coalesced per frame:
        // only the backing canvas, the renderer's targets and the cameras change size; the run never restarts and the
        // scene re-centres on the hero on its next frame
        unwatch = watchViewport(ref.current, PLAY_VIEW, (f) => applyFit(g, f));
        game.canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          setError('The graphics context was lost. The run continues on the authority; it will redraw when the browser restores graphics.');
        });
        game.canvas.addEventListener('webglcontextrestored', () => setError(null));
      } catch (err) {
        setError(`Could not start the renderer: ${(err as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
      unwatch?.();
      game?.destroy(true);
    };
  }, [net, audio, tier]);
  return (
    // data-gameplay: while nothing is open over the game, the controller drives the hero, not the menus (lib/gamepad.ts)
    <div className="game-canvas" ref={ref} data-gameplay="true">
      {error && <div className="frame blood" role="alert" style={{ position: 'absolute', maxWidth: 520 }}>{error}</div>}
    </div>
  );
}
