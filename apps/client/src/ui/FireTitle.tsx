'use client';

import { useEffect, useRef, useState } from 'react';
import { FireTitleSim, type FirePaletteId, type MetalId } from './fireSim';
import { runLoop, useReducedMotion } from './motion';

// Burning title (main-menu logo, "You Have Fallen"): the text is rasterised once in a pixel font to a 1-bit
// mask, then rendered as molten metal with flames on a small canvas, CSS-scaled by an integer with pixelated
// rendering. Decorative only: callers keep the real text in the accessible heading.

interface Props {
  text: string;
  /** canvas font size; use multiples of the font's pixel grid (Jersey 10 → 20/30/40) for crisp glyphs */
  fontPx?: number;
  family?: string;
  /** CSS font weight (e.g. 900 for the Cinzel wordmark) */
  weight?: number;
  scale?: number;
  fire?: FirePaletteId;
  metal?: MetalId;
  className?: string;
  /** shown (styled text) until the canvas is ready, or if canvas text is unavailable */
  fallbackClassName?: string;
}

export function FireTitle({ text, fontPx = 30, family = '"Jersey 10"', weight = 400, scale = 2, fire = 'ember', metal = 'bronze', className = '', fallbackClassName = '' }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | null = null;
    (async () => {
      try {
        await Promise.race([document.fonts.load(`${weight} ${fontPx}px ${family}`), new Promise((r) => setTimeout(r, 2500))]);
      } catch { /* font optional */ }
      const cv = ref.current;
      if (disposed || !cv) return;
      const font = `${weight} ${fontPx}px ${family}`;
      const probe = document.createElement('canvas').getContext('2d');
      if (!probe) return;
      probe.font = font;
      const m = probe.measureText(text);
      const asc = Math.ceil(m.actualBoundingBoxAscent || fontPx * 0.75), desc = Math.ceil(m.actualBoundingBoxDescent || fontPx * 0.2);
      const left = Math.ceil(m.actualBoundingBoxLeft || 0), right = Math.ceil(m.actualBoundingBoxRight || m.width);
      const padX = 8, fireH = Math.round(fontPx * 0.62), padB = 5;
      const W = left + right + padX * 2, H = fireH + asc + desc + padB;
      const mc = document.createElement('canvas');
      mc.width = W; mc.height = H;
      const mg = mc.getContext('2d');
      if (!mg) return;
      mg.font = font; mg.fillStyle = '#fff'; mg.textBaseline = 'alphabetic';
      mg.fillText(text, padX + left, fireH + asc);
      const md = mg.getImageData(0, 0, W, H).data;
      const mask = new Uint8Array(W * H);
      let any = false;
      for (let i = 0; i < W * H; i++) if (md[i * 4 + 3] > 110) { mask[i] = 1; any = true; }
      if (!any) return;
      cv.width = W; cv.height = H;
      cv.style.width = `${W * scale}px`;
      cv.style.height = `${H * scale}px`;
      const g = cv.getContext('2d');
      if (!g) return;
      const sim = new FireTitleSim(mask, W, H, fireH, asc + desc, fireH, fire, metal);
      const img = g.createImageData(W, H);
      const paint = () => { sim.render(img.data); g.putImageData(img, 0, 0); };
      setReady(true);
      if (reduced) { for (let i = 0; i < 48; i++) sim.step(); paint(); return; }
      stop = runLoop(() => { sim.step(); paint(); }, 24);
    })();
    return () => { disposed = true; stop?.(); };
  }, [text, fontPx, family, weight, scale, fire, metal, reduced]);

  return (
    <span className={`fire-title ${className}`} data-ready={ready ? 'true' : 'false'}>
      <canvas ref={ref} aria-hidden="true" className="fire-title-canvas" />
      {!ready && <span className={fallbackClassName} aria-hidden="true">{text}</span>}
    </span>
  );
}
