'use client';

import { useEffect, useRef } from 'react';
import { gfx } from '@/game/gfx';
import { runLoop, useReducedMotion } from './motion';
import { dither } from './pixelSkin';

// Ethereal backlight for the title wordmark, drawn as pixel art on a low-resolution canvas (1 canvas px = PX screen px,
// scaled nearest-neighbour) sized to its parent: a slowly breathing elliptical aura quantised into ordered-dithered
// bands (never a smooth gradient), faint light shafts falling from above and swaying, and spirit wisps orbiting the
// letters with short trails. Decorative only; static under reduced motion, wisps dropped on the lowest tier.

const PX = 3;
// aura bands, outermost first: deep indigo → violet → spectral cyan → pale core
const BANDS = ['#0b0820', '#130f36', '#181f4e', '#1d3466', '#2a5684'];
/** '#rrggbb' → little-endian ABGR word for a Uint32Array view over ImageData */
const abgr = (hex: string) => (0xff000000 | (parseInt(hex.slice(5, 7), 16) << 16) | (parseInt(hex.slice(3, 5), 16) << 8) | parseInt(hex.slice(1, 3), 16)) >>> 0;
const BAND_WORDS = BANDS.map(abgr);
const SHAFT = '#9fe2f4';
const WISP = ['#eefeff', '#aef0fa', '#6ad2ea', '#3a8ec8', '#2c4c9c'];

interface Wisp { a: number; r: number; speed: number; tilt: number; phase: number; trail: { x: number; y: number }[] }

export function SpectralHalo() {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const cv = ref.current;
    const host = cv?.parentElement;
    if (!cv || !host) return;
    const g = cv.getContext('2d');
    if (!g) return;
    let W = 0, H = 0;
    let img: ImageData | null = null;
    let px: Uint32Array | null = null;
    const size = () => {
      const r = host.getBoundingClientRect();
      // the halo spills well past the wordmark on every side
      W = Math.max(40, Math.ceil((r.width * 1.5) / PX));
      H = Math.max(30, Math.ceil((r.height * 2.6) / PX));
      cv.width = W; cv.height = H;
      img = g.createImageData(W, H);
      px = new Uint32Array(img.data.buffer);
      cv.style.width = `${W * PX}px`;
      cv.style.height = `${H * PX}px`;
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(host);
    const wispCount = gfx().tier === 'low' ? 0 : gfx().tier === 'medium' ? 3 : 6;
    const wisps: Wisp[] = Array.from({ length: wispCount }, (_, i) => ({
      a: (i / Math.max(1, wispCount)) * Math.PI * 2, r: 0.78 + Math.random() * 0.22, speed: (0.004 + Math.random() * 0.004) * (i % 2 ? 1 : -1),
      tilt: 0.32 + Math.random() * 0.1, phase: Math.random() * 6, trail: [],
    }));

    const draw = (t: number) => {
      if (!img || !px) return;
      const cx = W / 2, cy = H * 0.52;
      const rx = W * 0.4, ry = H * 0.27;
      const breathe = 1 + Math.sin(t / 90) * 0.06;
      // aura: elliptical falloff quantised into dithered bands, written straight into the pixel buffer
      px.fill(0);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const dx = (x + 0.5 - cx) / (rx * breathe), dy = (y + 0.5 - cy) / (ry * breathe);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= 1) continue;
        const v = (1 - d) * BANDS.length;              // 0 at the rim → BANDS.length at the centre
        const i = Math.floor(v), f = v - i;
        const band = Math.min(BANDS.length - 1, i + (dither(x, y, f) ? 1 : 0));
        if (band <= 0 && !dither(x, y, f * 0.6)) continue; // the outer rim is a sparse dither, so the edge never reads as a shape
        px[y * W + x] = BAND_WORDS[Math.max(0, band - 1)]!;
      }
      g.putImageData(img, 0, 0);
      // light shafts: thin slanted columns from the top, faint (sparse dither), swaying slowly
      g.fillStyle = SHAFT;
      for (let k = 0; k < 5; k++) {
        const base = cx + (k - 2) * W * 0.11 + Math.sin(t / 160 + k * 1.7) * W * 0.02;
        const lean = (k - 2) * 0.18;
        const strength = 0.045 + 0.03 * Math.sin(t / 70 + k * 2.3);
        for (let y = 0; y < cy; y++) {
          const fade = strength * (1 - y / cy) * 1.6;
          const x0 = Math.round(base + lean * (cy - y));
          if (dither(x0, y, fade)) g.fillRect(x0, y, 1, 1);
        }
      }
      // wisps: orbit the wordmark on a tilted ellipse, leaving a cooling trail; they dip "behind" (dimmer) on the far side
      for (const w of wisps) {
        w.a += w.speed;
        const x = cx + Math.cos(w.a) * rx * w.r;
        const y = cy + Math.sin(w.a) * ry * w.r * w.tilt * 2 + Math.sin(t / 30 + w.phase) * 1.2;
        w.trail.unshift({ x, y });
        if (w.trail.length > WISP.length * 2) w.trail.pop();
        const far = Math.sin(w.a) < 0;
        w.trail.forEach((p, j) => {
          const c = WISP[Math.min(WISP.length - 1, Math.floor(j / 2) + (far ? 1 : 0))]!;
          g.fillStyle = c;
          g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
        });
        if (!far) { g.fillStyle = WISP[0]!; g.fillRect(Math.round(x) - 1, Math.round(y), 3, 1); g.fillRect(Math.round(x), Math.round(y) - 1, 1, 3); }
      }
    };

    if (reduced) { draw(0); return () => ro.disconnect(); }
    let t = 0;
    const stop = runLoop(() => { t++; draw(t); }, 20);
    return () => { stop(); ro.disconnect(); };
  }, [reduced]);
  return <canvas ref={ref} className="spectral-halo" aria-hidden="true" />;
}
