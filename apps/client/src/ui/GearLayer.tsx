'use client';

import { useEffect, useRef, useState } from 'react';
import { CLASS_BY_ID, GEAR_SLOTS, GEAR_SLOT_NAMES, LEGENDARY_BY_ID, LOOT_RULES } from '@cursebound/content';
import { netStore, type GameConnection } from '@/lib/net';
import { keyCap, settingsStore } from '@/lib/settings';
import { useStore } from '@/lib/store';
import type { LegendaryUiEvent } from '@/game/render/LootRenderer';
import { GearPanel } from './GearPanel';
import { ItemIcon } from './itemIcons';
import { ORANGE } from './gearText';

// Legendary overlay layer (mounted once on the play page): the gear panel (key I / 'cursebound:inventory'),
// "LEGENDARY" toasts on drops and equips (fed by LootRenderer's 'cursebound:legendary' window event) and the
// "[G] Equip <item> (replaces <old>)" prompt, derived client-side from the snapshot while standing on loot.

interface Toast { id: number; itemId: string; title: string; sub: string; at: number }
let nextToast = 1;

function useEquipPrompt(): { itemId: string; text: string } | null {
  const snap = useStore(netStore, (s) => s.hud);
  const slot = useStore(netStore, (s) => s.slot);
  const keys = useStore(settingsStore, (s) => s.s.keys);
  if (!snap || snap.phase !== 'COMBAT' || !snap.lt?.length) return null;
  const me = snap.players[slot];
  if (!me || me.life !== 'alive') return null;
  let best: { itemId: string; text: string; d: number } | null = null;
  for (const it of snap.lt) {
    const d = Math.hypot(it.x - me.x, it.y - me.y);
    if (d > LOOT_RULES.pickupRange + 0.05 || (best && best.d <= d)) continue;
    const def = LEGENDARY_BY_ID[it.it];
    if (!def) continue;
    if (def.classId && def.classId !== me.c) {
      best = { itemId: def.id, text: `${def.name} — only a ${CLASS_BY_ID[def.classId]?.name ?? def.classId} can wear this`, d };
      continue;
    }
    const cur = me.gr?.[GEAR_SLOTS.indexOf(def.slot)];
    if (!cur || cur === def.id) continue;   // empty slots auto-equip; identical items cannot be swapped
    best = { itemId: def.id, text: `[${keyCap(keys.interact?.[0] ?? 'KeyG')}] Equip ${def.name} (replaces ${LEGENDARY_BY_ID[cur]?.name ?? cur})`, d };
  }
  return best ? { itemId: best.itemId, text: best.text } : null;
}

export function GearLayer({ net }: { net: GameConnection }) {
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const openRef = useRef(false);
  openRef.current = open;
  const prompt = useEquipPrompt();

  // open / close: inventory key (all phases), the pause menu and pad button ('cursebound:inventory'), Escape closes
  useEffect(() => {
    const toggle = () => setOpen((v) => !v);
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.repeat) return;
      const keys = settingsStore.get().s.keys;
      if (openRef.current && e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
      if ((keys.inventory ?? ['KeyI']).includes(e.code)) { e.preventDefault(); toggle(); }
    };
    window.addEventListener('cursebound:inventory', toggle);
    window.addEventListener('keydown', onKey, true);   // capture: Escape closing the panel must not also open the menu
    return () => { window.removeEventListener('cursebound:inventory', toggle); window.removeEventListener('keydown', onKey, true); };
  }, []);

  // local solo combat pauses while the panel is open (multiplayer keeps running, like the pause menu)
  const pausedByMe = useRef(false);
  useEffect(() => {
    const ph = netStore.get().phase;
    if (open && ph && ph.mode === 'solo' && ph.phase === 'COMBAT') { net.pause(true); pausedByMe.current = true; }
    else if (!open && pausedByMe.current) { net.pause(false); pausedByMe.current = false; }
  }, [open, net]);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as LegendaryUiEvent;
      const def = LEGENDARY_BY_ID[d.itemId];
      if (!def) return;
      let sub = '';
      if (d.kind === 'drop') sub = `${GEAR_SLOT_NAMES[def.slot]} — on the ground`;
      else if (d.kind === 'carry') sub = 'Carried over — it awaits the party';
      else if (d.kind === 'equip') sub = d.mine ? `Equipped${d.replaced ? ` (replaced ${LEGENDARY_BY_ID[d.replaced]?.name ?? d.replaced})` : ''}` : `${d.who ?? 'An ally'} equipped it`;
      const t: Toast = { id: nextToast++, itemId: def.id, title: def.name, sub, at: Date.now() };
      setToasts((ts) => [...ts.slice(-2), t]);
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== t.id)), 4800);
    };
    window.addEventListener('cursebound:legendary', on);
    return () => window.removeEventListener('cursebound:legendary', on);
  }, []);

  return (
    <>
      {toasts.length > 0 && (
        <div role="status" aria-live="polite" className="cine-fade" style={{ position: 'fixed', top: '16%', left: '50%', transform: 'translateX(-50%)', zIndex: 'var(--z-toast)' as unknown as number, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', pointerEvents: 'none' }}>
          {toasts.map((t) => (
            <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '48px auto', gap: 12, alignItems: 'center', padding: '8px 16px 8px 8px', background: 'rgba(11,8,7,0.94)', border: `2px solid ${ORANGE}`, boxShadow: '4px 4px 0 #000', animation: 'fadeIn 0.15s steps(3)' }}>
              <div style={{ width: 48, height: 48, display: 'grid', placeItems: 'center', border: '2px solid #3a1a00', background: '#0b0807' }}><ItemIcon itemId={t.itemId} size={32} /></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontFamily: 'var(--font-label)', fontSize: 'var(--fs-label)', lineHeight: 'var(--lh-label)', color: ORANGE, textShadow: '2px 2px 0 #000' }}>LEGENDARY: {t.title}</span>
                <span style={{ fontSize: 'var(--fs-body)', lineHeight: 'var(--lh-body)', color: 'var(--text-2)' }}>{t.sub}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {prompt && !open && (
        <div aria-live="polite" className="cine-fade" style={{ position: 'fixed', left: '50%', bottom: 'calc(150px * var(--hud-zoom, 1))', transform: 'translateX(-50%)', zIndex: 'var(--z-hint)' as unknown as number, display: 'flex', gap: 8, alignItems: 'center', padding: '4px 12px 4px 4px', background: 'rgba(11,8,7,0.92)', border: `2px solid ${ORANGE}`, boxShadow: '2px 2px 0 #000', pointerEvents: 'none' }}>
          <ItemIcon itemId={prompt.itemId} size={32} />
          <span style={{ fontFamily: 'var(--font-label)', fontSize: 'var(--fs-label)', lineHeight: 'var(--lh-label)', color: ORANGE, textShadow: '2px 2px 0 #000' }}>{prompt.text}</span>
        </div>
      )}
      {open && <GearPanel onClose={() => setOpen(false)} />}
    </>
  );
}
