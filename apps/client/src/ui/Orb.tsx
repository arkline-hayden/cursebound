'use client';

import { useEffect, useRef } from 'react';
import { Px } from './pixelSkin';
import { buildOrbSocket, drawOrb, makeOrbState, orbPalette, stepOrb, ORB_H, ORB_W, type OrbKind, type OrbPalette, type OrbState } from './orbArt';
import { runLoop, useReducedMotion } from './motion';

// Health / resource orb canvas. Values flow in through refs; the canvas animates in its own throttled rAF loop
// (paused when the tab is hidden), so the HUD never re-renders per frame. Rendered at 64x64 and scaled 2x in CSS
// with image-rendering: pixelated (3x on large screens via the HUD zoom).

let socketCache: Px | null = null;
const socket = () => (socketCache ??= buildOrbSocket());

/** kind: 'life', a resource style, or a class id; accent derives a liquid for classes without a named palette. */
export function Orb({ kind, accent, value, shield = 0, className = '' }: { kind: OrbKind; accent?: string; value: number; shield?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const val = useRef(value);
  const sh = useRef(shield);
  const pal = orbPalette(kind, accent);
  const palRef = useRef<OrbPalette>(pal);
  const state = useRef<OrbState | null>(null);
  val.current = value; sh.current = shield; palRef.current = pal;
  const reduced = useReducedMotion();

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const g = cv.getContext('2d');
    if (!g) return;
    const out = new Px(ORB_W, ORB_H);
    const img = g.createImageData(ORB_W, ORB_H);
    const s = (state.current ??= makeOrbState(val.current));
    const render = (dt: number, animate: boolean) => {
      if (!animate) { s.level = val.current; s.ghost = val.current; s.shield = sh.current; }
      stepOrb(s, val.current, sh.current, dt);
      drawOrb(out, socket(), s, palRef.current, animate);
      img.data.set(out.d);
      g.putImageData(img, 0, 0);
    };
    if (reduced) { render(0, false); return; }
    return runLoop((dt) => render(dt, true), 30);
  }, [reduced]);

  // reduced motion: repaint only when the values change
  useEffect(() => {
    if (!reduced || !ref.current || !state.current) return;
    const g = ref.current.getContext('2d');
    if (!g) return;
    const s = state.current;
    s.level = value; s.ghost = value; s.shield = shield;
    const out = new Px(ORB_W, ORB_H);
    drawOrb(out, socket(), s, pal, false);
    const img = g.createImageData(ORB_W, ORB_H);
    img.data.set(out.d);
    g.putImageData(img, 0, 0);
  }, [reduced, value, shield, pal]);

  return <canvas ref={ref} width={ORB_W} height={ORB_H} className={`orb-canvas ${className}`} aria-hidden="true" />;
}
