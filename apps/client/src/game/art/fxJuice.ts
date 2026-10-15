/**
 * Tintable juice textures for class kits (`pfx:*`): themed particle bits (feathers, leaves, gears, runes, ice, stars,
 * crosses, thorns, skulls, zaps, bubbles) and big flat shapes (thick shockwave, starburst, ground glyph, banded orb,
 * light beam, crisp slash, claw rake). All white/grey so render/Juice.ts tints them per class; hard pixel bands only.
 * Framework-free.
 */
import type { PixelBuffer } from './draw/pixel';
import { band, crescent, fill, line, pix, ring, TINT_PAL, type FxSpec } from './fxPrims';

const P = TINT_PAL;

/** Single- or multi-frame tiny bit from row art, one row-set per frame. */
function bits(key: string, w: number, h: number, frames: readonly (readonly string[])[]): FxSpec {
  return { key, w, h, frames: frames.length, durations: frames.map(() => 100), loop: false, anim: false, draw: (b, i) => pix(b, frames[i] ?? frames[0]!, P) };
}

export const JUICE_SPECS: FxSpec[] = [
  bits('pfx:feather', 4, 9, [
    [' #  ', '.#+ ', '+#+.', '+#+.', '+#o.', 'o#o ', ' #o ', ' #  ', ' o  '],
    ['  # ', ' +#.', '.+#+', '.+#+', '.o#+', ' o#o', ' o# ', '  # ', '  o '],
  ]),
  bits('pfx:leaf', 5, 5, [
    ['   +#', ' +##+', '+#o#+', '#o#+ ', 'o+   '],
    [' +#+ ', '+#o#+', '+#o#+', ' +o+ ', '  o  '],
  ]),
  bits('pfx:gear', 5, 5, [
    [' + + ', '+###+', ' # # ', '+###+', ' + + '],
    [' ### ', '##+##', '#+ +#', '##+##', ' ### '],
    ['#### ', '####+', ' ++  ', ' ++  ', ' o+  '],
  ]),
  bits('pfx:rune', 5, 5, [
    ['  #  ', ' # # ', '#####', ' # # ', '  #  '],
    ['#   #', ' # # ', '  #  ', ' # # ', '#   #'],
    ['#### ', '   # ', ' ### ', '#    ', '#####'],
    [' ### ', '#   #', '# # #', '#   #', ' ### '],
  ]),
  bits('pfx:ice', 3, 7, [
    [' # ', ' #+', '+#+', '+#o', '+#o', ' #o', ' o '],
    ['  #', ' #+', ' #+', '+#o', '+#o', '#o ', 'o  '],
    [' # ', '+#+', '+#o', ' #o', ' o ', '   ', '   '],
  ]),
  bits('pfx:star', 7, 7, [
    ['   #   ', '   #   ', '  +#+  ', '#######', '  +#+  ', '   #   ', '   #   '],
    ['       ', '   .   ', '   #   ', ' .###. ', '   #   ', '   .   ', '       '],
  ]),
  bits('pfx:cross', 5, 5, [[' .#. ', '..#..', '#####', '..#..', ' .#. ']]),
  bits('pfx:thorn', 3, 6, [['#  ', '+# ', ' #+', ' ##', ' #o', 'o# ']]),
  bits('pfx:skull', 5, 5, [[' ### ', '#####', '# # #', '#####', ' # # ']]),
  bits('pfx:zap', 5, 7, [
    ['   # ', '  #  ', ' ### ', '   # ', '  #  ', ' #   ', '#    '],
    [' #   ', '  #  ', ' ### ', ' #   ', '  #  ', '   # ', '    #'],
  ]),
  bits('pfx:bubble', 5, 5, [[' +++ ', '+  #+', '+   +', '+   +', ' +++ ']]),
  {
    // thick shockwave band: hard outer edge, two dimmer inner steps (reads as a wave front, not a thin line)
    key: 'pfx:ringThick', w: 64, h: 64, frames: 1, durations: [100], loop: false, anim: false,
    draw: (b) => fill(b, (x, y) => {
      const d = Math.hypot(x + 0.5 - 32, y + 0.5 - 32);
      if (d > 31 || d < 23) return null;
      if (d > 29) return [0xffffff, 255];
      if (d > 26.5) return [0xe0e0e0, 175];
      return [0xc8c8c8, 80];
    }),
  },
  {
    // eight-point star flash: four long spikes, four short, in three hard bands
    key: 'pfx:starburst', w: 64, h: 64, frames: 1, durations: [100], loop: false, anim: false,
    draw: (b) => fill(b, (x, y) => {
      const dx = x + 0.5 - 32, dy = y + 0.5 - 32;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const edge = 31 * Math.max(0.16, Math.pow(Math.abs(Math.cos(a * 2)), 14), 0.55 * Math.pow(Math.abs(Math.sin(a * 2)), 22));
      if (d > edge) return null;
      const t = d / edge;
      return t < 0.35 ? [0xffffff, 255] : t < 0.7 ? [0xe8e8e8, 220] : [0xc0c0c0, 140];
    }),
  },
  {
    // ground rune circle (squash to 0.5 on screen): double ring, ticks, six glyph marks, inner hexagram
    key: 'pfx:glyph', w: 64, h: 64, frames: 1, durations: [100], loop: false, anim: false,
    draw: (b) => {
      ring(b, 32, 32, 30, 30, 1.2, 0xe8e8e8, 240, 0xffffff);
      ring(b, 32, 32, 23.5, 23.5, 0.8, 0xd0d0d0, 200, 0xffffff);
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const l = k % 4 === 0 ? 3.5 : 1.5;
        line(b, 32 + Math.cos(a) * (29 - l), 32 + Math.sin(a) * (29 - l), 32 + Math.cos(a) * 29, 32 + Math.sin(a) * 29, 0xffffff, 220, 0);
      }
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        const cx = 32 + Math.cos(a) * 26.5, cy = 32 + Math.sin(a) * 26.5;
        line(b, cx - 1.5, cy - 1.5, cx + 1.5, cy + 1.5, 0xffffff, 255, 0);
        line(b, cx - 1.5, cy + 1.5, cx + 1.5, cy - 1.5, 0xffffff, 200, 0);
      }
      for (let t = 0; t < 2; t++) {
        const pts = [0, 1, 2].map((k) => { const a = (k / 3) * Math.PI * 2 + t * Math.PI - Math.PI / 2; return [32 + Math.cos(a) * 22, 32 + Math.sin(a) * 22] as const; });
        for (let k = 0; k < 3; k++) { const p0 = pts[k]!, p1 = pts[(k + 1) % 3]!; line(b, p0[0], p0[1], p1[0], p1[1], 0xd8d8d8, 190, 0); }
      }
      fill(b, (x, y) => (Math.hypot(x + 0.5 - 32, y + 0.5 - 32) < 22 ? [0xffffff, 26] : null));
    },
  },
  {
    // banded glow orb: four hard steps from a faint halo to a white core
    key: 'pfx:orb', w: 32, h: 32, frames: 1, durations: [100], loop: false, anim: false,
    draw: (b) => fill(b, (x, y) => {
      const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 16) / 15.5;
      if (d >= 1) return null;
      const v = band(1 - d, 4);
      return v >= 1 ? [0xffffff, 255] : v >= 0.75 ? [0xf0f0f0, 230] : v >= 0.5 ? [0xd8d8d8, 150] : [0xc0c0c0, 60];
    }),
  },
  {
    // vertical light column (origin at the bottom centre): banded across, stepped fade toward the top
    key: 'pfx:beam', w: 16, h: 64, frames: 1, durations: [100], loop: false, anim: false,
    draw: (b) => fill(b, (x, y) => {
      const dx = Math.abs(x + 0.5 - 8);
      const col = dx < 2 ? 255 : dx < 4 ? 200 : dx < 6 ? 110 : 45;
      const top = y < 6 ? 0.25 : y < 14 ? 0.5 : y < 24 ? 0.75 : 1;
      return [dx < 2 ? 0xffffff : 0xe0e0e0, Math.round(col * top)];
    }),
  },
  {
    // crisp thin crescent (duelist-grade slash), leading edge at the top-right like pfx:slashArc
    key: 'pfx:slashThin', w: 96, h: 96, frames: 1, durations: [100], loop: false, anim: false,
    draw: (b) => crescent(b, 40, 52, 38, 3.4, 2.4, -1.25, 0xe8e8e8),
  },
  {
    // three parallel rakes pointing east, tapered at both ends (claws, talons, fangs)
    key: 'pfx:claw', w: 32, h: 32, frames: 1, durations: [100], loop: false, anim: false,
    draw: (b: PixelBuffer) => {
      for (let k = -1; k <= 1; k++) {
        for (let s = 0; s <= 52; s++) {
          const t = s / 52;
          const x = 3 + t * 26;
          const y = 16 + k * 7 + Math.sin(t * Math.PI) * -2.5 + k * t * 1.5;
          const w = Math.sin(t * Math.PI) * 1.6;
          for (let q = -w; q <= w; q += 0.5) b.blend(Math.round(x), Math.round(y + q), Math.abs(q) < 0.6 ? 0xffffff : 0xd0d0d0, 255);
        }
      }
    },
  },
];
