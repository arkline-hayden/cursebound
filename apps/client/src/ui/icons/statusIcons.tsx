/**
 * Player status chips (HUD): ids from SnapPlayer.buffs mapped to a short readable name, a polarity (debuff / buff),
 * a tone colour and a 9x9 pixel glyph. Pure data + one tiny SVG component; unknown ids fall back to a humanised
 * name with an up (buff) or down (debuff) arrow, so new statuses never render blank.
 */
import type React from 'react';

export type StatusKind = 'debuff' | 'buff';
export interface StatusDef { label: string; kind: StatusKind; color: string; glyph: string[] }

// 9x9 glyphs: '#' tone colour, 'h' highlight (light), 'd' shade, 'o' black outline, '.' empty.
const G = {
  frost: ['....h....', '.h..#..h.', '..#.#.#..', '...###...', 'h###h###h', '...###...', '..#.#.#..', '.h..#..h.', '....h....'],
  drop: ['....h....', '...h#....', '...###...', '..#h###..', '..#h####.', '.##h####.', '.#######.', '..##d##..', '...ddd...'],
  chain: ['###......', '#.#......', '#h##.....', '.####....', '..#.#....', '..##h#...', '...####..', '....#.#..', '....###..'],
  flask: ['...ooo...', '...#.#...', '...#.#...', '..#...#..', '.#.....#.', '#.h.h...#', '#hhhhhh.#', '#hhhhhhh#', '.#######.'],
  eye: ['h........', '.h.......', '..#####..', '.##h.##..', '##.#h.##.', '.##..h##.', '..#####h.', '.......h.', '........h'],
  root: ['....#....', '.#..#..#.', '..#.#.#..', '...###...', '....#....', '..#####..', 'hhhhhhhhh', '.d.d.d.d.', 'd.d.d.d.d'],
  mute: ['.#######.', '#.......#', '#.h...h.#', '#..h.h..#', '#...h...#', '#..h.h..#', '#.h...h.#', '.###.###.', '..#......'],
  glass: ['#########', '.#.....#.', '..#hhh#..', '...#h#...', '....#....', '...#.#...', '..#.h.#..', '.#hhhhh#.', '#########'],
  crown: ['.........', 'h...h...h', '#h.###.h#', '#########', '#h#h#h#h#', '#########', '.#######.', '.ddddddd.', '.........'],
  horn: ['.......#.', '......##.', '.##.###h.', '#########', '#hhhhhhh#', '#########', '.##.###h.', '......##.', '.......#.'],
  ankh: ['...###...', '..#...#..', '..#...#..', '...#.#...', '#########', '....#....', '....h....', '....#....', '....#....'],
  cog: ['...#.#...', '.#######.', '.##...##.', '##..h..##', '.#.hhh.#.', '##..h..##', '.##...##.', '.#######.', '...#.#...'],
  star: ['....h....', '....#....', '...###...', 'h#######h', '.#######.', '..#####..', '..##.##..', '.##...##.', '.#.....#.'],
  flag: ['#........', '#######..', '#hhhhh#..', '#h###h##.', '#hhhhh#..', '#######..', '#........', '#........', '#........'],
  blade: ['........h', '.......h#', '......h#.', '.....h#..', '.#..h#...', '..##h....', '..##.....', '.#..#....', '#........'],
  broken: ['###......', '#.#......', '###......', '.........', '...h.h...', '.........', '......###', '......#.#', '......###'],
  up: ['....#....', '...###...', '..##h##..', '.###h###.', '...#h#...', '...#h#...', '...#h#...', '...###...', '.........'],
  down: ['.........', '...###...', '...#h#...', '...#h#...', '...#h#...', '.###h###.', '..##h##..', '...###...', '....#....'],
  // room events: shrine blessings
  flame: ['....h....', '...h#....', '...##h...', '..#h##...', '..##h##..', '.##hh##..', '.#hhhh#..', '.##hh##..', '..#####..'],
  wing: ['........h', '......h##', '....h###.', '..h###...', 'h####h...', '..##h....', '.##h.....', '##.......', '#........'],
  shield: ['#########', '#hhhhhhh#', '#hh###hh#', '#h#####h#', '#h#####h#', '.#h###h#.', '.##h#h##.', '..##h##..', '....#....'],
  coin: ['..#####..', '.#hhhhh#.', '#hh###hd#', '#h#hhh#d#', '#h#h#h#d#', '#h#hhh#d#', '#hh###dd#', '.#ddddd#.', '..#####..'],
} as const;

export const STATUS_DEFS: Record<string, StatusDef> = {
  // debuffs (enemy afflictions)
  frozen: { label: 'Frozen', kind: 'debuff', color: '#9fe0ff', glyph: [...G.frost] },
  chill: { label: 'Chilled', kind: 'debuff', color: '#8ec4ff', glyph: [...G.drop] },
  chained: { label: 'Chained', kind: 'debuff', color: '#b8b0a8', glyph: [...G.chain] },
  poisoned: { label: 'Poisoned', kind: 'debuff', color: '#8fe07a', glyph: [...G.flask] },
  blinded: { label: 'Blinded', kind: 'debuff', color: '#c9a8ff', glyph: [...G.eye] },
  rooted: { label: 'Rooted', kind: 'debuff', color: '#c8a060', glyph: [...G.root] },
  silenced: { label: 'Silenced', kind: 'debuff', color: '#e08aff', glyph: [...G.mute] },
  slowed: { label: 'Slowed', kind: 'debuff', color: '#f2a93a', glyph: [...G.glass] },
  // buffs
  avatar: { label: 'Avatar', kind: 'buff', color: '#ffd36a', glyph: [...G.crown] },
  bloodlust: { label: 'Bloodlust', kind: 'buff', color: '#ff6a5e', glyph: [...G.drop] },
  bloodrush: { label: 'Bloodrush', kind: 'buff', color: '#ff8a6a', glyph: [...G.blade] },
  battle_cry: { label: 'Battle cry', kind: 'buff', color: '#ffc94a', glyph: [...G.horn] },
  unchained: { label: 'Unchained', kind: 'buff', color: '#ffb070', glyph: [...G.broken] },
  undying: { label: 'Undying', kind: 'buff', color: '#fff1c2', glyph: [...G.ankh] },
  af_overclock: { label: 'Overclock', kind: 'buff', color: '#7fe8d4', glyph: [...G.cog] },
  d_perfect_form: { label: 'Perfect form', kind: 'buff', color: '#ffd36a', glyph: [...G.star] },
  rally: { label: 'Rallied', kind: 'buff', color: '#e8c66a', glyph: [...G.flag] },
  // room events (simulation roomEvents.ts): shrine blessings
  shrine_fury: { label: 'Fury', kind: 'buff', color: '#ff6a3a', glyph: [...G.flame] },
  shrine_haste: { label: 'Haste', kind: 'buff', color: '#5ae0ff', glyph: [...G.wing] },
  shrine_warding: { label: 'Warded', kind: 'buff', color: '#9fb4ff', glyph: [...G.shield] },
  shrine_fortune: { label: 'Fortune', kind: 'buff', color: '#ffd23f', glyph: [...G.coin] },
};

const NEG_HINT = /(frozen|chill|slow|root|poison|blind|silence|chain|stun|snare|curse|burn|bleed|weak|vuln|fear|hex|doom|mark)/i;

export const humanizeStatus = (k: string) => k.replace(/^[a-z]{1,2}_/, '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

/** Definition for any status id (unknown ids: humanised label, polarity guessed from the name). */
export function statusDef(id: string): StatusDef {
  const d = STATUS_DEFS[id];
  if (d) return d;
  const neg = NEG_HINT.test(id);
  return { label: humanizeStatus(id), kind: neg ? 'debuff' : 'buff', color: neg ? '#ff6a5e' : '#8fe07a', glyph: [...(neg ? G.down : G.up)] };
}

/** Debuffs first, then buffs; stable within each group. */
export function sortStatuses(ids: string[]): string[] {
  const uniq = ids.filter((b, i, a) => a.indexOf(b) === i);
  return [...uniq.filter((b) => statusDef(b).kind === 'debuff'), ...uniq.filter((b) => statusDef(b).kind === 'buff')];
}

const lighten = (hex: string, t: number) => {
  const v = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((v >> s) & 255) + (255 - ((v >> s) & 255)) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
};
const darken = (hex: string, t: number) => {
  const v = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((v >> s) & 255) * (1 - t));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
};

/** The 9x9 glyph as crisp SVG rects with a 1px black outline (11x11 view box). */
export function StatusIcon({ id, size = 22 }: { id: string; size?: number }): React.JSX.Element {
  const d = statusDef(id);
  const fill: Record<string, string> = { '#': d.color, h: lighten(d.color, 0.6), d: darken(d.color, 0.45), o: '#000' };
  const rects: React.JSX.Element[] = [];
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && y < 9 && x < 9 && d.glyph[y][x] !== '.';
  // outline pass: any empty cell touching a filled one becomes black
  for (let y = -1; y <= 9; y++) for (let x = -1; x <= 9; x++) {
    if (solid(x, y)) continue;
    if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) rects.push(<rect key={`o${x},${y}`} x={x + 1} y={y + 1} width={1} height={1} fill="#000" />);
  }
  d.glyph.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '.') rects.push(<rect key={`${x},${y}`} x={x + 1} y={y + 1} width={1} height={1} fill={fill[c] ?? d.color} />); }));
  return (
    <svg width={size} height={size} viewBox="0 0 11 11" shapeRendering="crispEdges" aria-hidden="true" focusable="false" style={{ imageRendering: 'pixelated', display: 'block', flex: 'none' }}>
      {rects}
    </svg>
  );
}
