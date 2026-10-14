'use client';

import { useEffect, useRef, useState } from 'react';
import { CLASS_BY_ID, GEAR_SLOTS, GEAR_SLOT_NAMES } from '@cursebound/content';
import { netStore } from '@/lib/net';
import { keyCap, settingsStore } from '@/lib/settings';
import { useStore } from '@/lib/store';
import { ItemIcon, SlotIcon } from './itemIcons';
import { ORANGE, classTag, gearFromSnap, modifierLines } from './gearText';

// Legendary gear panel (key I, or Menu → Legendary gear): the seven equipment slots of a party member with item
// icons, names in legendary orange, the unique perk, ×factor stat modifiers and lore. Pixel-art styling: hard
// 2px borders, no gradients or rounded corners, pixel fonts at integer sizes.

const box = (filled: boolean): React.CSSProperties => ({
  display: 'grid', gridTemplateColumns: '56px 1fr', gap: 12, alignItems: 'start', padding: 8,
  background: 'var(--stone-0)', border: `2px solid ${filled ? ORANGE : 'var(--stone-4)'}`, boxShadow: '2px 2px 0 #000',
});
const socket = (filled: boolean): React.CSSProperties => ({
  width: 56, height: 56, display: 'grid', placeItems: 'center', background: '#0b0807',
  border: `2px solid ${filled ? ORANGE : 'var(--stone-3)'}`, boxShadow: filled ? `0 0 0 2px #3a1a00` : undefined,
});
const label: React.CSSProperties = { fontFamily: 'var(--font-label)', fontSize: 'var(--fs-label)', lineHeight: 'var(--lh-label)', textTransform: 'uppercase', color: 'var(--text-3)' };

export function GearPanel({ onClose }: { onClose: () => void }) {
  const snap = useStore(netStore, (s) => s.hud);
  const mySlot = useStore(netStore, (s) => s.slot);
  const keys = useStore(settingsStore, (s) => s.s.keys);
  const [view, setView] = useState(mySlot);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  const players = snap?.players ?? [];
  const who = players[view] ?? players[mySlot];
  const gear = gearFromSnap(who);
  const count = Object.keys(gear).length;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="gear-h" style={{ zIndex: 'var(--z-modal)' as unknown as number }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="frame ornate" style={{ width: 'min(980px, 100%)', maxHeight: '92vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h2 id="gear-h" className="panel-title" style={{ fontSize: 'var(--fs-goth-lg)', color: ORANGE }}>Legendary Gear</h2>
          <div className="row" style={{ gap: 8 }}>
            <span style={label}>{count}/7 equipped</span>
            <button ref={closeRef} className="btn small" onClick={onClose}>Close <span className="kbd">{keyCap(keys.inventory?.[0] ?? 'KeyI')}</span></button>
          </div>
        </div>
        {players.length > 1 && (
          <div className="row" role="tablist" style={{ gap: 8, flexWrap: 'wrap' }}>
            {players.map((p) => (
              <button key={p.s} role="tab" aria-selected={p.s === view} className={`btn small ${p.s === view ? 'primary' : ''}`} onClick={() => setView(p.s)}>
                {p.n}{p.s === mySlot ? ' (you)' : ''} · {CLASS_BY_ID[p.c]?.name ?? p.c}
              </button>
            ))}
          </div>
        )}
        <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 'var(--fs-body)', lineHeight: 'var(--lh-body)' }}>
          Legendaries drop rarely from foes, more often from champions and rares, and always from bosses. Walk over one to wear it in an empty slot;
          press <span className="kbd">{keyCap(keys.interact?.[0] ?? 'KeyG')}</span> on it to swap (your old piece drops at your feet). Gear lasts the whole run.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 8 }}>
          {GEAR_SLOTS.map((slot) => {
            const def = gear[slot];
            return (
              <div key={slot} style={box(!!def)}>
                <div style={socket(!!def)}>{def ? <ItemIcon itemId={def.id} size={48} label={def.name} /> : <SlotIcon slot={slot} size={48} />}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <span style={label}>{GEAR_SLOT_NAMES[slot]}{def && classTag(def) ? ` · ${classTag(def)}` : ''}</span>
                  {def ? (
                    <>
                      <span style={{ fontFamily: 'var(--font-gothic)', fontSize: 'var(--fs-goth)', lineHeight: 'var(--fs-goth)', color: ORANGE, textShadow: '2px 2px 0 #000' }}>{def.name}</span>
                      <span style={{ fontSize: 'var(--fs-body)', lineHeight: 'var(--lh-body)', color: 'var(--text)' }}>{def.perk.description}</span>
                      <span style={{ fontFamily: 'var(--font-label)', fontSize: 'var(--fs-label)', lineHeight: 'var(--lh-label)', color: 'var(--good)' }}>{modifierLines(def).join(' · ')}</span>
                      <span style={{ fontSize: 'var(--fs-body)', lineHeight: 'var(--lh-body)', color: 'var(--text-3)' }}>“{def.flavor}”</span>
                    </>
                  ) : (
                    <span style={{ fontSize: 'var(--fs-body)', lineHeight: 'var(--lh-body)', color: 'var(--text-3)' }}>Empty</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
