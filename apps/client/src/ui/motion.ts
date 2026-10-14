'use client';

import { useEffect, useState } from 'react';
import { settingsStore } from '@/lib/settings';
import { useStore } from '@/lib/store';

// Motion helpers for the small canvas animations (orbs, burning titles): honour the in-game Reduced motion setting
// and the OS prefers-reduced-motion, and pause rAF loops while the tab is hidden.

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return settingsStore.get().s.reducedMotion || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function useReducedMotion(): boolean {
  const setting = useStore(settingsStore, (s) => s.s.reducedMotion);
  const [os, setOs] = useState(false);
  useEffect(() => {
    const m = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!m) return;
    setOs(m.matches);
    const on = () => setOs(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return setting || os;
}

/** requestAnimationFrame loop throttled to `fps`, paused while the document is hidden. Returns a disposer. */
export function runLoop(step: (dt: number) => void, fps = 30): () => void {
  let raf = 0, last = 0, acc = 0, running = false;
  const frame = 1000 / fps;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (!last) { last = now; return; }
    acc += now - last; last = now;
    if (acc < frame) return;
    const dt = Math.min(acc, 250) / 1000;
    acc = 0;
    step(dt);
  };
  const start = () => { if (running) return; running = true; last = 0; acc = 0; raf = requestAnimationFrame(tick); };
  const stop = () => { running = false; cancelAnimationFrame(raf); };
  const onVis = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVis);
  if (!document.hidden) start();
  return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
}
