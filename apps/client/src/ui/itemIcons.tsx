'use client';

import { memo } from 'react';
import type { GearSlot } from '@cursebound/content';
import { itemIconPixels, pixelRuns, slotIconPixels, type IconPixels } from './itemIconData';

// Pixel icons for legendary gear: crisp SVG rects on the 16×16 grid. Use integer multiples of 16 for `size`.

function Pixels({ px, size, label }: { px: IconPixels; size: number; label?: string }) {
  const runs = pixelRuns(px);
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={{ display: 'block', imageRendering: 'pixelated' }}>
      {runs.map(([x, y, w, c], i) => <rect key={i} x={x} y={y} width={w} height={1} fill={c} />)}
    </svg>
  );
}

export const ItemIcon = memo(function ItemIcon({ itemId, size = 32, label }: { itemId: string; size?: number; label?: string }) {
  return <Pixels px={itemIconPixels(itemId)} size={size} label={label} />;
});

export const SlotIcon = memo(function SlotIcon({ slot, size = 32 }: { slot: GearSlot; size?: number }) {
  return <Pixels px={slotIconPixels(slot)} size={size} />;
});

/** Fate's Blessing, animated: the prismatic star with its hue cycling in hard steps (globals.css .prism-cycle). */
export const BlessingIcon = memo(function BlessingIcon({ size = 32, label }: { size?: number; label?: string }) {
  return <span className="prism-cycle" style={{ display: 'inline-block', lineHeight: 0 }}><ItemIcon itemId="fates_blessing" size={size} label={label} /></span>;
});
