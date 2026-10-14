'use client';

import { useEffect, useRef, useState } from 'react';
import type { GameConnection } from '@/lib/net';
import type { AudioEngine } from './audio/AudioEngine';
import { CANVAS_FONT_SPECS } from '@/ui/fonts';
import { settingsStore } from '@/lib/settings';
import { useStore } from '@/lib/store';
import { GFX_PRESETS, type GfxKnobs } from './gfxProfile';

// Client-only Phaser host (PRD §17.1): instantiated after mount, disposed on route changes; high-frequency
// state never routes through React. Rendering uses an integer pixel zoom so every art pixel is a crisp square;
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

export const BASE_W = 960;
export const BASE_H = 540;

export function pixelZoom(w: number, h: number) {
  return Math.max(1, Math.floor(Math.min(w / BASE_W, h / BASE_H) + 0.15));
}

/**
 * Play camera: a tighter Diablo-style framing than the menu backdrop. The logical view targets ~640x360
 * (3x at 1080p, 4x at 1440p, 2x on ~1280-1600 px windows), always an integer zoom so pixels stay square.
 */
export const PLAY_BASE_W = 640;
export const PLAY_BASE_H = 360;
export function playZoom(w: number, h: number) {
  return Math.max(1, Math.floor(Math.min(w / PLAY_BASE_W, h / PLAY_BASE_H) + 0.15));
}

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
    const onResize = () => {
      if (!game || !ref.current) return;
      const w = ref.current.clientWidth, h = ref.current.clientHeight;
      const z = playZoom(w, h);
      game.scale.resize(Math.ceil(w / z), Math.ceil(h / z));
      game.scale.setZoom(z);
    };
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
        const w = ref.current.clientWidth, h = ref.current.clientHeight;
        const z = playZoom(w, h);
        game = new Phaser.Game({
          type: Phaser.WEBGL,
          parent: ref.current,
          width: Math.ceil(w / z),
          height: Math.ceil(h / z),
          zoom: z,
          pixelArt: true,
          roundPixels: true,
          antialias: false,
          backgroundColor: '#050303',
          scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.CENTER_BOTH },
          ...tierRenderConfig(knobs),
          audio: { noAudio: true },
          input: { keyboard: false, mouse: false, touch: false, gamepad: false },
          banner: false,
        } as Phaser.Types.Core.GameConfig);
        game.scene.add('combat', CombatScene, true, { net, audio });
        window.addEventListener('resize', onResize);
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
      window.removeEventListener('resize', onResize);
      game?.destroy(true);
    };
  }, [net, audio, tier]);
  return (
    <div className="game-canvas" ref={ref}>
      {error && <div className="frame blood" role="alert" style={{ position: 'absolute', maxWidth: 520 }}>{error}</div>}
    </div>
  );
}
