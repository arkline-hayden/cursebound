'use client';

import { useEffect, useRef } from 'react';
import { gfx } from '@/game/gfx';
import { runLoop, useReducedMotion } from './motion';

// Title-screen embers: sparks rising from below on a low-resolution canvas (1 canvas px = `PX` screen px, scaled
// nearest-neighbour), drifting on a slow wind and cooling from white-gold through orange to blood red. Purely
// decorative; the count follows the graphics tier and it stays off under reduced motion.

const PX = 4;
const COLORS = ['#fff4c8', '#ffd36a', '#f39a2a', '#d8581c', '#9c2a14', '#5a140c'];

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; big: boolean }

export function EmberField({ intensity = 1 }: { intensity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const cv = ref.current;
    if (!cv || reduced) return;
    const g = cv.getContext('2d');
    if (!g) return;
    let W = 0, H = 0;
    const size = () => { W = Math.ceil(window.innerWidth / PX); H = Math.ceil(window.innerHeight / PX); cv.width = W; cv.height = H; };
    size();
    window.addEventListener('resize', size);
    const sparks: Spark[] = [];
    const target = () => Math.round((W * H) / 900 * gfx().particles * intensity);
    const spawn = (anywhere: boolean): Spark => {
      const max = 90 + Math.random() * 160;
      return {
        x: Math.random() * W, y: anywhere ? Math.random() * H : H + Math.random() * 6,
        vx: (Math.random() - 0.35) * 0.18, vy: -(0.12 + Math.random() * 0.35),
        life: anywhere ? Math.random() * max : 0, max, big: Math.random() < 0.12,
      };
    };
    for (let i = 0; i < target(); i++) sparks.push(spawn(true));
    let t = 0;
    const stop = runLoop(() => {
      t++;
      const wind = Math.sin(t / 140) * 0.08;
      g.clearRect(0, 0, W, H);
      const want = target();
      while (sparks.length < want) sparks.push(spawn(false));
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        s.life++;
        s.x += s.vx + wind + Math.sin((s.life + i * 13) / 9) * 0.06;
        s.y += s.vy;
        if (s.life > s.max || s.y < -2) { if (sparks.length > want) sparks.splice(i, 1); else sparks[i] = spawn(false); continue; }
        const k = s.life / s.max;
        const c = COLORS[Math.min(COLORS.length - 1, Math.floor(k * COLORS.length))]!;
        // flicker: occasionally skip a frame late in life
        if (k > 0.7 && ((s.life + i) & 3) === 0) continue;
        g.fillStyle = c;
        const x = Math.round(s.x), y = Math.round(s.y);
        g.fillRect(x, y, 1, 1);
        if (s.big && k < 0.5) { g.fillRect(x, y + 1, 1, 1); g.globalAlpha = 0.5; g.fillRect(x - 1, y, 1, 1); g.fillRect(x + 1, y, 1, 1); g.globalAlpha = 1; }
      }
    }, 30);
    return () => { stop(); window.removeEventListener('resize', size); };
  }, [reduced, intensity]);
  if (reduced) return null;
  return <canvas ref={ref} className="ember-field" aria-hidden="true" />;
}
