import { MATERIALS } from '../palette';
import { Painter, PixelBuffer, lighten, mix, rng, sparkle } from '../draw/pixel';
import { crescent, glow, line, ring, type FxSpec } from '../fxPrims';

// Hexbinder effect sheets (projectiles, summons, plague shapes). Framework-free pixel art; keys use the fx:hexbinder:*
// prefix. Projectiles point east (+x). Palette: sickly bile greens, hex violet, blood crimson, pale spirit mint, bone.

const BILE = MATERIALS.bile;
const HEX = MATERIALS.hexViolet;
const BLOOD = MATERIALS.bloodRed;
const CRIMSON = MATERIALS.crimson;
const MINT = MATERIALS.arcane;
const BONE = MATERIALS.boneDry;
const TOAD = [0x1e4a06, 0x3a7a10, 0x6cb82a, 0xb0e060] as const;
const PALE_MINT = [0x0e5a52, 0x1fae92, 0x86f0c6, 0xe0fff0] as const;
const PALE_LILAC = [0x432688, 0x6f44c8, 0xa98af8, 0xece2ff] as const;
const MOSS = MATERIALS.moss;
const ROBE = MATERIALS.plum;
const LILAC = MATERIALS.violet;
const DEEP_MINT = 0x062a26;

/** A wavy translucent tail of pixels trailing left from (x0, cy): strands alternate colours and fade with distance. */
function tail(b: PixelBuffer, x0: number, cy: number, len: number, phase: number, cols: readonly number[], amp = 1.5, strands = 2) {
  for (let s = 0; s < strands; s++) {
    for (let k = 0; k < len; k++) {
      const t = k / len;
      const x = Math.round(x0 - k);
      const y = Math.round(cy + Math.sin(k * 0.85 + phase + s * 2.1) * amp * (0.3 + t));
      const a = Math.round(255 * (1 - t) * (s ? 0.75 : 1));
      if (a < 30) continue;
      b.blend(x, y, cols[(k + s) % cols.length]!, a);
    }
  }
}

/** Ghostly robed body: hood, hollow face, glowing eyes and a tattered hem that ripples with `phase`. */
function spectre(b: PixelBuffer, cx: number, top: number, w: number, h: number, ramp: readonly number[], eye: number, phase: number, outline: number) {
  const p = new Painter(b);
  const hemY = top + h;
  // robe: shoulders -> flared tattered hem
  const pts: number[] = [cx - w * 0.32, top + h * 0.32, cx + w * 0.32, top + h * 0.32];
  const n = 5;
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    const x = cx - w / 2 + t * w;
    const y = hemY - ((i % 2) ? 3 + Math.round(Math.sin(phase + i) * 1.5) : Math.round(Math.cos(phase + i * 1.7)));
    pts.push(x, y);
  }
  p.poly(pts).fill(ramp, { mode: 'emboss', alpha: 225 });
  // arms: wisps reaching forward and down
  p.capsule(cx - w * 0.32, top + h * 0.38, cx - w * 0.5, top + h * 0.6 + Math.sin(phase) * 1.2, 1.4, 0.8).fill(ramp, { alpha: 220 });
  p.capsule(cx + w * 0.32, top + h * 0.38, cx + w * 0.52, top + h * 0.58 + Math.cos(phase) * 1.2, 1.4, 0.8).fill(ramp, { alpha: 220 });
  // hood
  p.ellipse(cx, top + h * 0.2, w * 0.28, h * 0.2).fill(ramp, { mode: 'sphere', light: 0.15 });
  p.finish(outline, 1);
  // hollow face + eyes
  const fy = top + Math.round(h * 0.22);
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x * 0.8 + y * y <= 4.6) b.set(cx + x, fy + y, DEEP_MINT, 255);
  b.set(cx - 1, fy - 1, eye); b.set(cx + 1, fy - 1, eye);
  b.blend(cx - 1, fy - 2, lighten(eye, 0.5), 140); b.blend(cx + 1, fy - 2, lighten(eye, 0.5), 140);
}

export const SPECS: FxSpec[] = [
  // ---- Hex Bolt: a hexfire skull trailing violet and green wisps ----
  {
    key: 'fx:hexbinder:bolt', w: 20, h: 12, frames: 4, durations: [60, 60, 60, 60], loop: true,
    draw: (b, i) => {
      const ph = i * 1.6;
      tail(b, 10, 6, 10, ph, [BILE[2]!, HEX[2]!, BILE[3]!, HEX[3]!], 1.8, 2);
      glow(b, 14, 6, 5.5, HEX[2]!, 150);
      const p = new Painter(b);
      p.circle(14, 6, 3.6).fill(BILE, { mode: 'sphere', glow: BILE[3]!, light: 0.15 });
      p.finish(HEX[0]!, 1);
      // tiny skull face looking forward
      b.set(14, 5, BILE[0]!); b.set(16, 5, BILE[0]!); b.set(15, 7, BILE[0]!);
      b.set(13, 4, 0xffffff);
      sparkle(b, 4 + (i % 2) * 3, 6 + (i % 2 ? -3 : 3), HEX[3]!, 1, 200);
    },
  },
  // ---- homing spirit: a mint wisp with hollow eyes and a rippling tail ----
  {
    key: 'fx:hexbinder:spirit', w: 20, h: 12, frames: 4, durations: [70, 70, 70, 70], loop: true,
    draw: (b, i) => {
      const ph = i * 1.57;
      tail(b, 11, 6, 11, ph, [MINT[3]!, MINT[2]!, MINT[4]!], 2, 3);
      glow(b, 14, 6, 5, MINT[2]!, 120);
      const p = new Painter(b);
      p.ellipse(14, 6, 3.8, 3.4).fill(MINT, { mode: 'sphere', glow: MINT[3]!, light: 0.3 });
      p.finish(DEEP_MINT, 1);
      b.set(14, 5, DEEP_MINT); b.set(16, 5, DEEP_MINT);
      b.set(15, 7, DEEP_MINT); b.set(15, 8, i % 2 ? DEEP_MINT : MINT[1]!);
    },
  },
  // ---- Blightbloom seed: a spinning green pod with violet thorns ----
  {
    key: 'fx:hexbinder:seed', w: 12, h: 12, frames: 4, durations: [55, 55, 55, 55], loop: true,
    draw: (b, i) => {
      glow(b, 6, 6, 5, BILE[2]!, 90);
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + i * Math.PI / 8;
        line(b, 6, 6, 6 + Math.cos(a) * 5, 6 + Math.sin(a) * 5, HEX[2]!, 255, 0);
        b.set(Math.round(6 + Math.cos(a) * 5), Math.round(6 + Math.sin(a) * 5), HEX[3]!);
      }
      const p = new Painter(b);
      p.ellipse(6, 6, 2.6, 2.4).fill(BILE, { mode: 'sphere', glow: BILE[3]!, light: 0.2 });
      p.finish(BILE[0]!, 1);
      b.set(5, 5, 0xffffff);
    },
  },
  // ---- Sanguine Lance: a shard of coagulated blood with a shimmering edge and a drip trail ----
  {
    key: 'fx:hexbinder:lance', w: 30, h: 10, frames: 3, durations: [60, 60, 60], loop: true,
    draw: (b, i) => {
      const r = rng(31 + i);
      for (let k = 0; k < 7; k++) b.blend(Math.round(r() * 7), Math.round(3 + r() * 4), k % 2 ? BLOOD[3]! : CRIMSON[2]!, 120 + Math.round(r() * 100));
      glow(b, 18, 5, 11, CRIMSON[2]!, 70, 4);
      const p = new Painter(b);
      p.poly([4, 5, 12, 2.5, 21, 2, 29, 5, 21, 8, 12, 7.5]).fill(BLOOD, { mode: 'facet', facets: 4, glow: CRIMSON[3]!, light: 0.15 });
      p.finish(BLOOD[0]!, 1);
      // travelling highlight along the spine
      for (let k = 0; k < 3; k++) { const x = 8 + ((k * 7 + i * 3) % 20); b.blend(x, 4, CRIMSON[3]!, 230); b.blend(x + 1, 4, 0xffd0d0, 200); }
      b.set(28, 5, 0xffffff); b.set(27, 5, BLOOD[4]!);
    },
  },
  // ---- Summons ----
  {
    key: 'fx:hexbinder:wraith', w: 24, h: 32, frames: 4, durations: [120, 120, 120, 120], loop: true,
    draw: (b, i) => {
      glow(b, 12, 12, 11, MINT[2]!, 55, 13);
      spectre(b, 12, 2, 18, 28, PALE_MINT, BILE[3]!, i * 1.57, DEEP_MINT);
    },
  },
  {
    key: 'fx:hexbinder:banshee', w: 30, h: 36, frames: 4, durations: [100, 100, 100, 100], loop: true,
    draw: (b, i) => {
      const ph = i * 1.57;
      glow(b, 15, 13, 13, HEX[2]!, 60, 15);
      // streaming hair flowing back to the left
      for (let s = 0; s < 3; s++) for (let k = 0; k < 13; k++) {
        const x = 12 - k, y = Math.round(4 + s * 2 + k * 0.45 + Math.sin(k * 0.7 + ph + s) * (0.6 + k * 0.12));
        b.blend(x, y, s % 2 ? LILAC[3]! : 0xf0e8ff, Math.round(230 * (1 - k / 14)));
      }
      spectre(b, 16, 2, 20, 32, PALE_LILAC, 0xffffff, ph, HEX[0]!);
      // screaming mouth
      b.set(16, 9, 0x0a0418); b.set(16, 10, 0x0a0418); b.set(16, 11, i % 2 ? 0x0a0418 : HEX[1]!);
    },
  },
  {
    key: 'fx:hexbinder:legion', w: 22, h: 30, frames: 4, durations: [90, 90, 90, 90], loop: true,
    draw: (b, i) => {
      const ph = i * 1.57;
      glow(b, 11, 14, 9, BILE[2]!, 50, 12);
      // ghostly green wisp legs
      for (let k = 0; k < 6; k++) {
        const y = 21 + k, x = Math.round(11 + Math.sin(ph + k * 0.9) * (1 + k * 0.3));
        b.blend(x, y, k % 2 ? BILE[2]! : MINT[3]!, 220 - k * 30); b.blend(x + 1, y, BILE[1]!, 160 - k * 22);
      }
      const p = new Painter(b);
      // tattered cloak
      p.poly([4, 10, 18, 10, 19, 22 + (i % 2), 15, 20, 11, 23 - (i % 2), 7, 20, 3, 22]).fill(ROBE, { mode: 'emboss', dither: true });
      // ribcage
      p.rect(9, 11, 5, 8).fill(BONE, { mode: 'cyl' });
      // skull
      p.ellipse(11, 6, 4, 4.2).fill(BONE, { mode: 'sphere', light: 0.1 });
      p.rect(9, 8, 5, 3).fill(BONE, { mode: 'emboss' });
      // scythe arm
      p.capsule(16, 12, 20, 6 + (i % 2), 1, 0.8).fill(BONE);
      p.finish(0x140a10, 1);
      for (let k = 0; k < 3; k++) { b.set(9 + k * 2, 13 + (k % 2), BONE[0]!); b.set(10 + k, 15 + k, BONE[0]!); }
      // burning eyes
      b.set(9, 6, MATERIALS.eyeRed[2]!); b.set(13, 6, MATERIALS.eyeRed[2]!);
      b.blend(9, 5, MATERIALS.eyeRed[3]!, 170); b.blend(13, 5, MATERIALS.eyeRed[3]!, 170);
      b.set(10, 9, BONE[0]!); b.set(12, 9, BONE[0]!);
      // scythe blade
      crescent(b, 18, 9, 4, 1, -2.6, -0.6, MINT[3]!, 1);
    },
  },
  // ---- Blightbloom flower: violet petals around a pulsing bile bulb on a thorned stem ----
  {
    key: 'fx:hexbinder:bloom', w: 28, h: 30, frames: 4, durations: [110, 110, 110, 110], loop: true,
    draw: (b, i) => {
      const pulse = [0, 0.5, 1, 0.5][i]!;
      glow(b, 14, 10, 10 + pulse * 2, BILE[2]!, 70);
      const p = new Painter(b);
      // stem and leaves
      p.capsule(14, 29, 14, 13, 1.3, 1).fill(MOSS, { mode: 'cyl' });
      p.ellipse(9, 22, 4, 1.8).fill(MOSS, { mode: 'emboss' });
      p.ellipse(19, 19, 4, 1.8).fill(MOSS, { mode: 'emboss' });
      // petals
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + i * 0.08;
        const R = 6.5 + pulse;
        p.ellipse(14 + Math.cos(a) * R, 10 + Math.sin(a) * R * 0.72, 3.4, 2.6);
      }
      p.fill(HEX, { mode: 'sphere', light: 0.05 });
      // bulb
      p.circle(14, 10, 3.4 + pulse * 0.6).fill(BILE, { mode: 'sphere', glow: BILE[3]!, light: 0.2 });
      p.finish(0x14081e, 1);
      // thorns + drips + core
      b.set(12, 18, HEX[3]!); b.set(16, 24, HEX[3]!); b.set(12, 26, HEX[3]!);
      b.set(13, 9, 0xffffff); b.set(14, 9, BILE[4]!);
      const dy = (i * 2) % 6;
      b.blend(10, 14 + dy, BILE[3]!, 220); b.blend(18, 15 + ((dy + 3) % 6), BILE[3]!, 200);
    },
  },
  // ---- orbiting Soul: a flickering mint flame wisp ----
  {
    key: 'fx:hexbinder:soul', w: 12, h: 14, frames: 4, durations: [80, 80, 80, 80], loop: true,
    draw: (b, i) => {
      glow(b, 6, 8, 5.5, MINT[2]!, 100);
      const p = new Painter(b);
      const sway = [0, 1, 0, -1][i]!;
      p.poly([6 + sway, 1, 9, 7, 8.5, 10.5, 6, 12, 3.5, 10.5, 3, 7]).fill(MINT, { mode: 'sphere', glow: MINT[3]!, light: 0.35, cy: 9 });
      p.finish(DEEP_MINT, 1);
      b.set(5, 8, DEEP_MINT); b.set(7, 8, DEEP_MINT);
      b.set(6, 10, BILE[3]!);
    },
  },
  // ---- plague miasma puff: overlapping bile blobs with popping bubbles ----
  {
    key: 'fx:hexbinder:miasma', w: 24, h: 16, frames: 4, durations: [140, 140, 140, 140], loop: true,
    draw: (b, i) => {
      const p = new Painter(b);
      const s = [0, 0.6, 1, 0.6][i]!;
      p.ellipse(8, 10, 6 + s * 0.4, 4.5).ellipse(15, 9, 6.5, 5 + s * 0.5).ellipse(12, 6, 5, 4 + s * 0.4).ellipse(19, 11, 4, 3);
      p.fill(TOAD, { mode: 'sphere', dither: true, light: 0.25, alpha: 235 });
      p.finish(BILE[0]!, 0);
      const r = rng(77 + i);
      for (let k = 0; k < 4; k++) {
        const x = 5 + Math.round(r() * 14), y = 4 + Math.round(r() * 8);
        if ((b.get(x, y) >>> 24) < 100) continue;
        b.set(x, y, BILE[3]!); b.blend(x + 1, y, BILE[2]!, 200); b.blend(x, y - 1, 0xffffff, 140);
      }
      // a faint skull grin in the murk
      if (i === 2) { b.set(11, 8, TOAD[0]!); b.set(14, 8, TOAD[0]!); b.set(12, 10, TOAD[0]!); b.set(13, 10, TOAD[0]!); }
    },
  },
  // ---- Grave Tide crest: a curling wave of rot carrying a bobbing skull ----
  {
    key: 'fx:hexbinder:crest', w: 22, h: 22, frames: 4, durations: [80, 80, 80, 80], loop: true,
    draw: (b, i) => {
      const ph = i * 1.57;
      const p = new Painter(b);
      p.ellipse(11, 18, 10, 3.6).fill(TOAD, { mode: 'emboss', dither: true });
      p.finish(BILE[0]!, 0);
      crescent(b, 9 + (i % 2), 15, 8, 2.4, -2.9, -0.7 + Math.sin(ph) * 0.15, BILE[2]!, 1);
      crescent(b, 9 + (i % 2), 15, 5.5, 1.2, -2.6, -0.9, HEX[2]!, 0.8);
      // foam
      const r = rng(9 + i);
      for (let k = 0; k < 6; k++) b.blend(4 + Math.round(r() * 14), 7 + Math.round(r() * 9), k % 2 ? BILE[4]! : MINT[3]!, 220);
      // bobbing skull
      const sy = 12 + Math.round(Math.sin(ph) * 1.5);
      const q = new Painter(b);
      q.ellipse(13, sy, 2.4, 2.2).fill(BONE, { mode: 'sphere' });
      q.finish(0x140a10, 1);
      b.set(12, sy, 0x140a10); b.set(14, sy, 0x140a10);
    },
  },
  // ---- hex sigil: a greyscale (tintable) rune circle with a pentagram, flat on the ground ----
  {
    key: 'fx:hexbinder:sigil', w: 60, h: 30, frames: 1, durations: [100], loop: false, anim: false,
    draw: (b) => {
      ring(b, 30, 15, 28, 13.5, 1.2, 0xc8c8c8, 255, 0xffffff);
      ring(b, 30, 15, 23, 11, 0.8, 0x9a9a9a, 220, 0xe0e0e0);
      const pts: [number, number][] = [];
      for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k * Math.PI * 2) / 5; pts.push([30 + Math.cos(a) * 22, 15 + Math.sin(a) * 10.6]); }
      for (let k = 0; k < 5; k++) { const [x0, y0] = pts[k]!, [x1, y1] = pts[(k + 2) % 5]!; line(b, x0, y0, x1, y1, 0xe8e8e8, 230, 0); }
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = 30 + Math.cos(a) * 25.5, y = 15 + Math.sin(a) * 12.2;
        b.blend(Math.round(x), Math.round(y), 0xffffff, 255);
        if (k % 2) b.blend(Math.round(x + 1), Math.round(y), 0xb0b0b0, 200);
      }
      for (const [x, y] of pts) sparkle(b, Math.round(x), Math.round(y), 0xd0d0d0, 1, 255);
    },
  },
  // ---- Death Knell: a spectral bell that swings once and tolls ----
  {
    key: 'fx:hexbinder:bell', w: 22, h: 24, frames: 6, durations: [60, 70, 70, 80, 90, 110], loop: false,
    draw: (b, i) => {
      const swing = [0, 0.35, -0.3, 0.2, -0.1, 0][i]!;
      const fade = i >= 4 ? (i === 4 ? 200 : 120) : 255;
      glow(b, 11, 12, 10, MINT[2]!, Math.round(fade * 0.45));
      const p = new Painter(b);
      const cx = 11 + Math.round(swing * 6), top = 4;
      p.poly([cx - 3, top + 2, cx + 3, top + 2, cx + 5, top + 11, cx + 8, top + 16, cx - 8, top + 16, cx - 5, top + 11]).fill(MINT, { mode: 'cyl', glow: MINT[3]!, alpha: fade });
      p.circle(cx, top + 1, 1.6).fill(BONE, { alpha: fade });
      p.circle(cx - Math.round(swing * 8), top + 18, 1.8).fill(BONE, { mode: 'sphere', alpha: fade });
      p.finish(DEEP_MINT, 1);
      if (i === 1 || i === 2) for (let k = 0; k < 3; k++) { b.blend(cx - 9 - k, top + 8 + k * 3, MINT[4]!, 200); b.blend(cx + 9 + k, top + 8 + k * 3, MINT[4]!, 200); }
    },
  },
  // ---- blood droplet burst used by Hemorrhage tendril tips (tinted crimson glyph) ----
  {
    key: 'fx:hexbinder:fang', w: 14, h: 10, frames: 3, durations: [50, 60, 80], loop: false,
    draw: (b, i) => {
      const k = [0.6, 1, 0.8][i]!;
      const a = i === 2 ? 150 : 255;
      const p = new Painter(b);
      p.poly([1, 5 - 3 * k, 13, 5, 1, 5 + 3 * k]).fill(CRIMSON, { mode: 'facet', facets: 3, glow: CRIMSON[3]!, alpha: a });
      p.finish(BLOOD[0]!, 1);
      b.set(12, 5, mix(0xffffff, CRIMSON[3]!, 0.3));
    },
  },
];
