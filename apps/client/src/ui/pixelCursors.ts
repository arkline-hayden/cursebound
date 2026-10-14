import { PAL as P, Px, fromMap, skinCursor } from './pixelSkin';

// Pixel-art cursors over the game canvas (drawn procedurally like the rest of the skin, served as CSS data URLs at 2x):
//   default  an iron gauntlet pointer with a bronze cuff (walk here)
//   attack   the skin's sword (a foe is under the cursor: click to attack-move)
//   grab     a bronze gauntlet hand, finger raised (a pickup, legendary loot or a door: click to walk onto it)
// Built lazily on first use (needs a DOM canvas), cached per kind.

export type GameCursor = 'default' | 'attack' | 'grab';

function inset(src: Px, size = 16): Px {
  const px = new Px(size, size);
  px.blit(src, 1, 1);
  return px.outline(P.K);
}

/** Gauntlet pointer: steel arrow, lit top-left edge, dark right edge, bronze cuff. Hotspot (1, 1). */
function pointer(): Px {
  return inset(fromMap([
    'w',
    'ww',
    'wsd',
    'wssd',
    'wsssd',
    'wssssd',
    'wsssssd',
    'wssssssd',
    'wsssssssd',
    'wsssbbbbbB',
    'wssBsd',
    'wsB.bsd',
    'wB...bsd',
    '......bsd',
    '.......BB',
  ], { w: P.bo4, s: P.fe5, d: P.fe3, b: P.br4, B: P.br2 }));
}

/** Gauntlet hand with the index finger raised. Hotspot at the fingertip (5, 1). */
function hand(): Px {
  return inset(fromMap([
    '....hm',
    '....hm',
    '....hm',
    '....hmhm',
    '....hmhmhm',
    '..h.hmhmhmd',
    '.hmhmmmmmmd',
    '.hmmmmmmmmd',
    '.hmmmmmmmmd',
    '..mmmmmmmmd',
    '..hmmmmmmd',
    '...mmmmmmd',
    '...dddddd',
    '...eeeeee',
  ], { h: P.br5, m: P.br4, d: P.br2, e: P.fe4 }));
}

/** The cursor's pixels at 1x (environment-agnostic; previews and tests can read `.d`). */
export function cursorPx(kind: GameCursor): Px {
  return kind === 'attack' ? skinCursor() : kind === 'grab' ? hand() : pointer();
}

const cache = new Map<GameCursor, string>();

/** CSS `cursor` value for the game canvas. */
export function gameCursor(kind: GameCursor): string {
  let v = cache.get(kind);
  if (v) return v;
  try {
    const hot = kind === 'grab' ? '10 2' : '2 2';
    v = `${cursorPx(kind).url(2)} ${hot}, ${kind === 'attack' ? 'crosshair' : kind === 'grab' ? 'pointer' : 'default'}`;
  } catch {
    v = kind === 'attack' ? 'crosshair' : kind === 'grab' ? 'pointer' : 'default';
  }
  cache.set(kind, v);
  return v;
}
