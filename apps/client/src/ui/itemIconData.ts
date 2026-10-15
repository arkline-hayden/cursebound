import { FATES_BLESSING, LEGENDARY_BY_ID, type GearSlot } from '@cursebound/content';

// Procedural 16×16 pixel icons for legendary items (DOM-free: used by the React UI and by Phaser textures).
// One hand-drawn silhouette per gear slot (weapons have a sword and a mace variant), recoloured per item: the
// item's accent colour lights the gem / enchantment and tints the base material, so every legendary reads as its
// own piece while staying on the same pixel grid. The art agent may replace the silhouettes later.
//
// Legend: '.' empty · o outline · d leather/dark · m material · l material highlight · g gold trim · a accent · A accent glow

const SPRITES: Record<string, string[]> = {
  sword: [
    '..............oo',
    '.............olo',
    '............olmo',
    '...........olmo.',
    '..........olmo..',
    '.........olmo...',
    '........olmo....',
    '..oo...olmo.....',
    '..ogo.olmo......',
    '...ogolmo.......',
    '....oggo........',
    '...odgogo.......',
    '..odo.ogo.......',
    '.odo...oo.......',
    '.oAo............',
    '..o.............',
  ],
  mace: [
    '.........oooo...',
    '........ommmmo..',
    '.......omaAamo..',
    '.......omAaamo..',
    '........ommmmo..',
    '.......olooooo..',
    '......olo.......',
    '.....olo........',
    '....olo.........',
    '...ogo..........',
    '..odo...........',
    '..odo...........',
    '.odo............',
    '.oao............',
    '..o.............',
    '................',
  ],
  helm: [
    '................',
    '......oaao......',
    '.....oaAaao.....',
    '....oooooooo....',
    '...ommlllllmo...',
    '..omllmmmmllmo..',
    '..omlmmmmmmmlmo.',
    '..omoooooooomo..',
    '..omoAAooAAomo..',
    '..omoooooooomo..',
    '..ommoooooommo..',
    '..ommmmggmmmmo..',
    '...ommmggmmmo...',
    '....oommmmoo....',
    '......oooo......',
    '................',
  ],
  chest: [
    '................',
    '...oo......oo...',
    '..omgo....ogmo..',
    '..ommgoooogmmo..',
    '.ommmmglgmmmmo..',
    '.ommmmmammmmmo..',
    '.ommmmaAammmmo..',
    '..ommmmammmmo...',
    '..omlmmmmmmlmo..',
    '..omlmmmmmmlmo..',
    '..ommmmmmmmmmo..',
    '..oggggggggggo..',
    '..ommmmmmmmmmo..',
    '...ommmmmmmmo...',
    '....oooooooo....',
    '................',
  ],
  gloves: [
    '................',
    '.....o.o.o......',
    '....omomomo.....',
    '....omomomoo....',
    '....omomomomo...',
    '....omlmlmlmo...',
    '....ommmmmmmo.o.',
    '....ommmmmmmoomo',
    '....ommaAammmmo.',
    '....ommmammmmo..',
    '....ommmmmmmo...',
    '....oggggggggo..',
    '....odddddddo...',
    '....odddddddo...',
    '....ooooooooo...',
    '................',
  ],
  boots: [
    '................',
    '....ooooooo.....',
    '....odddddo.....',
    '....ogggggo.....',
    '....ommmmmo.....',
    '....omlmmmo.....',
    '....omlmmmo.....',
    '....omlmmmo.....',
    '....omlmmmoo....',
    '....omlmmmmmoo..',
    '....ommmaAmmmmo.',
    '....ommmmammmmo.',
    '...oddddddddddo.',
    '...oooooooooooo.',
    '................',
    '................',
  ],
  amulet: [
    '..oo........oo..',
    '..og........go..',
    '...og......go...',
    '...og......go...',
    '....og....go....',
    '....og....go....',
    '.....og..go.....',
    '......oggo......',
    '.....oggggo.....',
    '....ogaaaago....',
    '...ogaAAaaago...',
    '...ogaAaaaago...',
    '...ogaaaaaago...',
    '....ogaaaago....',
    '.....oggggo.....',
    '......oooo......',
  ],
  ring: [
    '................',
    '................',
    '......oooo......',
    '.....oaAaao.....',
    '....oaAaaaao....',
    '....oaaaaaao....',
    '.....oaaaao.....',
    '....oggooggo....',
    '...ogo....ogo...',
    '..ogo......ogo..',
    '..og........go..',
    '..og........go..',
    '..ogo......ogo..',
    '...ogo....ogo...',
    '....oggggggo....',
    '.....oooooo.....',
  ],
};

const MATERIAL: Record<GearSlot, [string, string]> = {
  weapon: ['#8a847c', '#e0ddd5'],
  helm: ['#7d746d', '#c8c0b4'],
  chest: ['#6e5a48', '#a08468'],
  gloves: ['#7d746d', '#b8b0a8'],
  boots: ['#5a4030', '#8a6a50'],
  amulet: ['#8a847c', '#d0c8bc'],
  ring: ['#8a847c', '#d0c8bc'],
};

const OUTLINE = '#0b0807';
const LEATHER = '#3b2a20';
const GOLD = '#e8a33a';
/** Legendary orange (frames, names, beams). */
export const LEGENDARY_ORANGE = '#ff8a1e';

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hex(a), [r2, g2, b2] = hex(b);
  const f = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${f(r1, r2)}${f(g1, g2)}${f(b1, b2)}`;
}
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export type IconPixels = (string | null)[][];
const cache = new Map<string, IconPixels>();

function render(sprite: string[], pal: Record<string, string>): IconPixels {
  const out: IconPixels = [];
  for (let y = 0; y < 16; y++) {
    const row = (sprite[y] ?? '').padEnd(16, '.').slice(0, 16);
    out.push([...row].map((ch) => (ch === '.' ? null : pal[ch] ?? null)));
  }
  return out;
}

/** 16×16 colour grid for a legendary item (null = transparent). Unknown ids fall back to a plain ring. */
export function itemIconPixels(itemId: string): IconPixels {
  const hit = cache.get(itemId);
  if (hit) return hit;
  if (itemId === FATES_BLESSING.id) { const px = blessingPixels(0); cache.set(itemId, px); return px; }
  const def = LEGENDARY_BY_ID[itemId];
  const slot: GearSlot = def?.slot ?? 'ring';
  const accent = def?.accent ?? LEGENDARY_ORANGE;
  const h = hash(itemId);
  const sprite = slot === 'weapon' ? (h % 2 ? SPRITES.mace : SPRITES.sword) : SPRITES[slot];
  const [m0, l0] = MATERIAL[slot];
  const pal = {
    o: OUTLINE, d: LEATHER, g: mix(GOLD, accent, 0.15),
    m: mix(m0, accent, 0.18 + ((h >> 3) % 3) * 0.04), l: mix(l0, accent, 0.12),
    a: accent, A: mix(accent, '#ffffff', 0.55),
  };
  const px = render(sprite, pal);
  cache.set(itemId, px);
  return px;
}

/** HSV (h in turns, s / v in 0..1) to #rrggbb. */
export function hsvHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

/**
 * Fate's Blessing: a prismatic four-pointed star (an astroid) whose colour wheels around its centre, white-hot at the
 * heart, with four pin sparkles. `phase` (turns) rotates the hue, so animated renderers can cycle it in steps.
 */
export function blessingPixels(phase: number): IconPixels {
  const out: IconPixels = [];
  const inside = (x: number, y: number) => Math.sqrt(Math.abs(x - 7.5)) + Math.sqrt(Math.abs(y - 7.5)) <= 2.75;
  for (let y = 0; y < 16; y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < 16; x++) {
      if (inside(x, y)) {
        const dx = x - 7.5, dy = y - 7.5, r = Math.hypot(dx, dy);
        const h = ((Math.atan2(dy, dx) / (Math.PI * 2) + phase) % 1 + 1) % 1;
        row.push(r < 1.3 ? '#ffffff' : r < 2.4 ? hsvHex(h, 0.35, 1) : hsvHex(h, 0.85, 1 - Math.min(0.25, r / 40)));
      } else {
        const edge = inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1);
        row.push(edge ? OUTLINE : null);
      }
    }
    out.push(row);
  }
  for (const [sx, sy, k] of [[2, 2, 0.1], [13, 2, 0.35], [2, 13, 0.6], [13, 13, 0.85]] as const) {
    const c = hsvHex((k + phase) % 1, 0.5, 1);
    out[sy]![sx] = '#ffffff';
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!out[sy + oy]![sx + ox]) out[sy + oy]![sx + ox] = c;
  }
  return out;
}

/** Dim silhouette for an empty gear slot. */
export function slotIconPixels(slot: GearSlot): IconPixels {
  const key = `slot:${slot}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const s = '#2c241e', t = '#3b3028';
  const px = render(slot === 'weapon' ? SPRITES.sword : SPRITES[slot], { o: s, d: s, g: t, m: t, l: t, a: t, A: t });
  cache.set(key, px);
  return px;
}

/** Horizontal runs per row (fewer DOM nodes for SVG): [x, y, width, colour]. */
export function pixelRuns(px: IconPixels): [number, number, number, string][] {
  const runs: [number, number, number, string][] = [];
  px.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      if (!c) { x++; continue; }
      let w = 1;
      while (x + w < row.length && row[x + w] === c) w++;
      runs.push([x, y, w, c]);
      x += w;
    }
  });
  return runs;
}
