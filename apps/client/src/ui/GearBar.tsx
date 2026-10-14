'use client';

import { GEAR_SLOTS, GEAR_SLOT_NAMES, LEGENDARY_BY_ID } from '@cursebound/content';
import { netStore } from '@/lib/net';
import { useStore } from '@/lib/store';
import { ItemIcon } from './itemIcons';
import { ORANGE } from './gearText';

// Compact equipped-legendary row for the combat HUD (sits above the action bar). Only filled slots are shown;
// timed perks darken from the top while recharging (snapshot `gp`). Click opens the gear panel.

export function GearBar() {
  const snap = useStore(netStore, (s) => s.hud);
  const slot = useStore(netStore, (s) => s.slot);
  const me = snap?.players[slot];
  const gr = me?.gr;
  if (!gr || !gr.some(Boolean)) return null;
  return (
    <div className="gear-bar" style={{ display: 'flex', gap: 4, pointerEvents: 'auto' }} aria-label="Equipped legendaries">
      {GEAR_SLOTS.map((s, i) => {
        const id = gr[i];
        const def = id ? LEGENDARY_BY_ID[id] : undefined;
        if (!def) return null;
        const ready = me?.gp?.[i] ?? 1;
        return (
          <button
            key={s}
            type="button"
            data-tip={`${def.name} · ${GEAR_SLOT_NAMES[s]}`}
            aria-label={`${def.name}: ${def.perk.description}`}
            onClick={() => window.dispatchEvent(new CustomEvent('cursebound:inventory'))}
            style={{ position: 'relative', width: 36, height: 36, padding: 0, display: 'grid', placeItems: 'center', background: '#0b0807', border: `2px solid ${ORANGE}`, boxShadow: '2px 2px 0 #000', cursor: 'pointer' }}
          >
            <ItemIcon itemId={def.id} size={32} />
            {ready < 1 && <span aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: `${Math.round((1 - ready) * 32)}px`, background: 'rgba(5,4,4,0.7)' }} />}
          </button>
        );
      })}
    </div>
  );
}
