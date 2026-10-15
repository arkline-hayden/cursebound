'use client';

import type { CSSProperties } from 'react';
import { ItemIcon } from './itemIcons';
import { ORANGE } from './gearText';
import { compareSummary, formatFactor, type GearCompare } from './gearCompare';

// Legendary quick-compare tooltip (pixel art, no default widgets): the candidate piece beside the one worn in its
// slot, stat rows as deltas (green ▲ / red ▼, worn → new factor) and both perks side by side. Shown for ground loot
// the hero is near or points at (GearLayer) and for hovered / focused pieces in the gear panel (GearPanel).

const C = { up: 'var(--good)', down: 'var(--bad)', same: 'var(--text-3)' } as const;
const lab: CSSProperties = { fontFamily: 'var(--font-label)', fontSize: 'var(--fs-small)', lineHeight: 'var(--lh-small)', textTransform: 'uppercase', color: 'var(--text-3)' };
const small: CSSProperties = { fontSize: 'var(--fs-small)', lineHeight: 'var(--lh-small)' };

function Head({ tag, name, itemId, dim }: { tag: string; name: string | null; itemId: string | null; dim?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr', gap: 6, alignItems: 'center', minWidth: 0, opacity: dim ? 0.85 : 1 }}>
      <div style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', background: '#0b0807', border: `2px solid ${itemId ? ORANGE : 'var(--stone-3)'}` }}>
        {itemId ? <ItemIcon itemId={itemId} size={32} /> : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={lab}>{tag}</span>
        <span style={{ ...small, fontFamily: 'var(--font-label)', color: name ? ORANGE : 'var(--text-3)', textShadow: '2px 2px 0 #000', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name ?? 'Empty'}</span>
      </div>
    </div>
  );
}

export function GearCompareTip({ c, hint, style }: { c: GearCompare; hint?: string; style?: CSSProperties }) {
  return (
    <div role="tooltip" aria-label={`${c.item.name} versus ${c.equipped?.name ?? 'an empty slot'}: ${compareSummary(c)}`}
      style={{ width: 'min(480px, 92vw)', display: 'flex', flexDirection: 'column', gap: 6, padding: 8, background: 'rgba(11,8,7,0.95)', border: `2px solid ${ORANGE}`, boxShadow: '4px 4px 0 #000', pointerEvents: 'none', ...style }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Head tag={`New · ${c.slotName}`} name={c.item.name} itemId={c.item.id} />
        <Head tag="Worn" name={c.equipped?.name ?? null} itemId={c.equipped?.id ?? null} dim />
      </div>
      {c.rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', columnGap: 10, rowGap: 0, borderTop: '2px solid var(--stone-3)', paddingTop: 4 }}>
          {c.rows.map((r) => (
            <div key={r.stat} style={{ display: 'contents' }}>
              <span style={{ ...small, color: 'var(--text-2)' }}>{r.label}</span>
              <span style={{ ...small, color: 'var(--text-3)', fontFamily: 'var(--font-num)' }}>{formatFactor(r.cur)} → {formatFactor(r.next)}</span>
              <span style={{ ...small, color: C[r.dir], fontFamily: 'var(--font-label)', textAlign: 'right', textShadow: '1px 1px 0 #000' }}>{r.text}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, borderTop: '2px solid var(--stone-3)', paddingTop: 4 }}>
        <span style={{ ...small, color: c.perk.same ? 'var(--text-2)' : 'var(--text)' }}>{c.perk.next}</span>
        <span style={{ ...small, color: 'var(--text-3)' }}>{c.perk.cur ?? '—'}</span>
      </div>
      {(c.note || hint) && <span style={{ ...lab, color: c.wearable ? ORANGE : 'var(--bad)' }}>{[c.note, hint].filter(Boolean).join(' · ')}</span>}
    </div>
  );
}
