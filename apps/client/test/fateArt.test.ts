import { describe, expect, it } from 'vitest';
import { DUNGEON_THEMES, TRAINING_THEME } from '@cursebound/content';
import {
  CORNER_FRAMES, FA, FATE_THEMES, THEME_PAL, VISTA_FRAMES, artTheme, backEmblem, backFrameTile, cornerStrip, crestStrip, dissolveEdgeStrip,
  dissolveMaskStrip, footArt, frameTile, fringeArt, medallionStrip, panelTile, sealArt, sigil, tableArt, vistaStrip,
} from '../src/ui/fateArt';

// The Fate cards' procedural pixel art (ui/fateArt.ts): every dungeon a door can lead to has its own ornament, and
// every sprite comes out at the size the CSS (FateCards.module.css) slices and scales it by.

function opaque(px: { d: Uint8ClampedArray }): number {
  let n = 0;
  for (let i = 3; i < px.d.length; i += 4) if (px.d[i]! > 0) n++;
  return n;
}

describe('fate card art', () => {
  it('covers every dungeon theme (and the training grounds)', () => {
    for (const t of DUNGEON_THEMES) expect(FATE_THEMES).toContain(t.id);
    for (const t of [...FATE_THEMES, TRAINING_THEME.id]) expect(THEME_PAL[t]).toBeDefined();
    expect(artTheme('no-such-dungeon')).toBe('catacombs');
  });

  it('draws each theme\'s sprites at their contract sizes, none of them empty', () => {
    for (const t of [...FATE_THEMES, TRAINING_THEME.id]) {
      const sprites = [
        [frameTile(t), FA.TILE, FA.TILE], [panelTile(t), FA.PANEL, FA.PANEL], [sigil(t), FA.SIGIL, FA.SIGIL],
        [cornerStrip(t, 'top'), FA.CORNER * CORNER_FRAMES, FA.CORNER], [cornerStrip(t, 'bottom'), FA.CORNER * CORNER_FRAMES, FA.CORNER],
        [crestStrip(t), FA.CREST_W * CORNER_FRAMES, FA.CREST_H], [footArt(t), FA.FOOT_W, FA.FOOT_H], [sealArt(t), FA.SEAL, FA.SEAL],
        [medallionStrip(t, 'rare'), FA.MEDAL, FA.MEDAL], [medallionStrip(t, 'mythic'), FA.MEDAL * 4, FA.MEDAL],
      ] as const;
      for (const [px, w, h] of sprites) {
        expect([px.w, px.h], t).toEqual([w, h]);
        expect(opaque(px), t).toBeGreaterThan(20);
      }
      const fr = fringeArt(t);
      if (fr) expect([fr.w, fr.h]).toEqual([FA.FRINGE_W, FA.FRINGE_H]);
    }
  });

  it('frames the real door of the destination in every vista', () => {
    for (const t of FATE_THEMES) {
      const v = vistaStrip(t);
      expect([v.w, v.h]).toEqual([FA.VISTA_W * VISTA_FRAMES, FA.VISTA_H]);
      expect(opaque(v)).toBe(v.w * v.h);   // a full illustration, no holes
    }
  });

  it('keeps the card back, the table and the burn-away masks theme-free', () => {
    expect([backFrameTile().w, backEmblem().w, tableArt().w]).toEqual([FA.TILE, FA.EMBLEM_W, 360]);
    const mask = dissolveMaskStrip(), edge = dissolveEdgeStrip();
    expect(mask.w).toBe(edge.w);
    // the burn front only advances: each frame keeps no more of the card than the one before
    const frames = 8, fw = mask.w / frames;
    const kept = Array.from({ length: frames }, (_, f) => {
      let n = 0;
      for (let y = 0; y < mask.h; y++) for (let x = 0; x < fw; x++) if (mask.d[((y * mask.w) + f * fw + x) * 4 + 3]! > 0) n++;
      return n;
    });
    for (let f = 1; f < frames; f++) expect(kept[f]!).toBeLessThanOrEqual(kept[f - 1]!);
    expect(kept[0]).toBe(fw * mask.h);
    expect(kept[frames - 1]).toBe(0);
  });
});
