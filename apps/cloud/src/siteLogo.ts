// Browser entry for the download site's wordmark (bundled to an IIFE: build.mjs → dist/site-logo.js, or on the fly in
// dev). It is the game's own burning title (apps/client/src/ui/FireTitle.tsx + fireSim.ts) with the same font, mask
// rules, ghost-fire palette and moonlit metal, so the landing page shows exactly the in-game wordmark.
import { FireTitleSim } from '../../client/src/ui/fireSim';

const TEXT = 'CURSEBOUND';
const FONT_PX = 40;
const FONT = `900 ${FONT_PX}px "Cinzel"`;

async function start() {
  const host = document.getElementById('wordmark');
  const cv = document.getElementById('wordmark-canvas') as HTMLCanvasElement | null;
  if (!host || !cv) return;
  try { await Promise.race([document.fonts.load(FONT), new Promise((r) => setTimeout(r, 2500))]); } catch { /* font optional */ }
  // the glyph mask, exactly as FireTitle builds it
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) return;
  probe.font = FONT;
  const m = probe.measureText(TEXT);
  const asc = Math.ceil(m.actualBoundingBoxAscent || FONT_PX * 0.75), desc = Math.ceil(m.actualBoundingBoxDescent || FONT_PX * 0.2);
  const left = Math.ceil(m.actualBoundingBoxLeft || 0), right = Math.ceil(m.actualBoundingBoxRight || m.width);
  const padX = 8, fireH = Math.round(FONT_PX * 0.62), padB = 5;
  const W = left + right + padX * 2, H = fireH + asc + desc + padB;
  const mc = document.createElement('canvas');
  mc.width = W; mc.height = H;
  const mg = mc.getContext('2d');
  if (!mg) return;
  mg.font = FONT; mg.fillStyle = '#fff'; mg.textBaseline = 'alphabetic';
  mg.fillText(TEXT, padX + left, fireH + asc);
  const md = mg.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  let any = false;
  for (let i = 0; i < W * H; i++) if (md[i * 4 + 3] > 110) { mask[i] = 1; any = true; }
  if (!any) return;
  cv.width = W; cv.height = H;
  // integer scale only (crisp pixels): as large as fits, 2x..4x like the game's title stage
  const fit = () => {
    const s = Math.max(2, Math.min(4, Math.floor((window.innerWidth * 0.86) / W)));
    cv.style.width = `${W * s}px`;
    cv.style.height = `${H * s}px`;
  };
  fit();
  window.addEventListener('resize', fit);
  const g = cv.getContext('2d');
  if (!g) return;
  const sim = new FireTitleSim(mask, W, H, fireH, asc + desc, fireH, 'spirit', 'moon');
  const img = g.createImageData(W, H);
  const paint = () => { sim.render(img.data); g.putImageData(img, 0, 0); };
  // pre-warm so the first frame already burns (the fire field starts empty and takes ~1 s to climb)
  for (let i = 0; i < 30; i++) sim.step();
  paint();
  host.setAttribute('data-ready', 'true');
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { for (let i = 0; i < 18; i++) sim.step(); paint(); return; }
  let last = 0;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    if (now - last < 1000 / 24) return;   // the game steps the fire at 24 fps
    last = now;
    sim.step(); paint();
  };
  requestAnimationFrame(frame);
}

void start();
