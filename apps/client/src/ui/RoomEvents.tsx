'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { LEGENDARY_BY_ID, MERCHANT, PACT_BY_ID, RELIC_AMPLIFY, ROOM_EVENT_RULES, STAT_BY_ID, WARE_BY_ID } from '@cursebound/content';
import type { SnapRoomEvent } from '@cursebound/simulation';
import { netStore, type GameConnection } from '@/lib/net';
import { useStore } from '@/lib/store';
import type { RoomEventOpen } from '@/game/render/RoomEvents';
import { BlessingIcon, ItemIcon } from './itemIcons';

// Room event panels (simulation roomEvents.ts validates everything): the cursed altar's three pacts and the wandering
// merchant's shelf, opened by the combat scene's 'cursebound:roomevent' window event (Interact / click in reach).
// Compact pixel panels: price and gift lines in red and gold, a coin count, one click per choice. They close on
// Escape, the close button, when the hero walks away or the event is gone. CoinChip is the HUD purse.

const ORANGE = '#ff8a1e';
const GOLD = '#ffd36a';
const RED = '#ff6a5e';
const lab: CSSProperties = { fontFamily: 'var(--font-label)', fontSize: 'var(--fs-small)', lineHeight: 'var(--lh-small)', textTransform: 'uppercase', color: 'var(--text-3)' };
const line: CSSProperties = { fontFamily: 'var(--font-label)', fontSize: 'var(--fs-label)', lineHeight: 1.15 };

/** 7x7 pixel coin (crisp SVG, black outline). */
export function CoinIcon({ size = 16 }: { size?: number }) {
  const g = ['..###..', '.#hhh#.', '#hh##d#', '#h#hhd#', '#hh##d#', '.#ddd#.', '..###..'];
  const fill: Record<string, string> = { '#': '#e0a020', h: '#ffe48a', d: '#9a5a10' };
  return (
    <svg width={size} height={size} viewBox="-1 -1 9 9" shapeRendering="crispEdges" aria-hidden="true" style={{ imageRendering: 'pixelated', display: 'inline-block', verticalAlign: 'middle', flex: 'none' }}>
      <rect x={1} y={-1} width={5} height={9} fill="#000" /><rect x={-1} y={1} width={9} height={5} fill="#000" /><rect x={0} y={0} width={7} height={7} fill="#000" rx={1} />
      {g.flatMap((row, y) => [...row].map((c, x) => (c === '.' ? null : <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={fill[c] ?? '#e0a020'} />)))}
    </svg>
  );
}

/** HUD purse: the local hero's cursed coins (hidden at zero). */
export function CoinChip() {
  const coins = useStore(netStore, (s) => s.hud?.players[s.slot]?.co ?? 0);
  if (!coins) return null;
  return (
    <div aria-label={`${coins} cursed coins`} title="Cursed coins: spend them at the wandering merchant" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-end', padding: '2px 10px', background: 'rgba(5,4,4,0.82)', border: '2px solid #3a2a14', boxShadow: '0 0 0 2px #000' }}>
      <CoinIcon size={20} />
      <b style={{ fontFamily: 'var(--font-gothic)', fontSize: 'var(--hud-goth-sm)', lineHeight: 1, color: GOLD, textShadow: '2px 2px 0 #000' }}>{coins}</b>
    </div>
  );
}

const STAT_SHORT: Record<string, string> = {
  'player.damage': 'damage', 'player.maxHealth': 'max health', 'player.critTendency': 'critical tendency', 'player.critPotency': 'critical damage',
  'player.attackFrequency': 'attack speed', 'player.movementSpeed': 'movement speed', 'player.recoveryRate': 'cooldown recovery', 'player.armor': 'armor',
  'player.healing': 'healing', 'player.shieldCapacity': 'shield capacity', 'player.projectileCount': 'projectiles',
};
const statShort = (id: string) => STAT_SHORT[id] ?? STAT_BY_ID[id]?.name.toLowerCase() ?? id;
const pctText = (factor: number) => `${factor >= 1 ? '+' : '−'}${Math.round(Math.abs(factor - 1) * 1000) / 10}%`;

/** Gift and price lines of an altar offer ('fury', 'relic:<item>', ...). */
export function pactLines(offer: string): { name: string; gifts: string[]; prices: string[]; flavor: string; item?: string } {
  const [id, item] = offer.split(':');
  const def = PACT_BY_ID[id];
  if (!def) return { name: id, gifts: [], prices: [], flavor: '' };
  const gifts = def.gift.map((g) => `${pctText(1 + Number(g.percent) / 100)} ${statShort(g.stat)}`);
  const leg = def.relic && item ? LEGENDARY_BY_ID[item] : undefined;
  if (leg) for (const m of leg.modifiers) if (m.stat.startsWith('player.')) gifts.push(`${pctText(1 + (Number(m.factorPerRank) - 1) * RELIC_AMPLIFY)} ${statShort(m.stat)}`);
  const prices: string[] = [];
  if (def.maxHealth) prices.push(`${pctText(1 + Number(def.maxHealth) / 100)} max health`);
  if (def.bloodFrac) prices.push(`Lose ${Math.round(def.bloodFrac * 100)}% of current health now`);
  return { name: leg ? `${def.name}: ${leg.name}` : def.name, gifts, prices, flavor: def.flavor, ...(leg ? { item: leg.id } : {}) };
}

function Panel({ title, accent, onClose, right, children }: { title: string; accent: string; onClose: () => void; right?: ReactNode; children: ReactNode }) {
  return (
    <div role="dialog" aria-label={title} className="frame" style={{
      position: 'fixed', left: '50%', top: 'calc(110px * var(--hud-zoom, 1))', transform: 'translateX(-50%)', zIndex: 'var(--z-hint)' as unknown as number,
      width: 'min(460px, 94vw)', display: 'flex', flexDirection: 'column', gap: 8, padding: 10, animation: 'fadeIn 0.12s steps(3)',
    }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-gothic)', fontSize: 'var(--fs-goth-sm)', color: accent, textShadow: '2px 2px 0 #000' }}>{title}</span>
        <span className="row" style={{ gap: 8, alignItems: 'center' }}>{right}<button className="btn small ghost" aria-label="Close" onClick={onClose} style={{ padding: '0 8px' }}>×</button></span>
      </div>
      {children}
    </div>
  );
}

function AltarPanel({ ev, net, onClose }: { ev: SnapRoomEvent; net: GameConnection; onClose: () => void }) {
  const offers = ev.o ?? [];
  return (
    <Panel title="Cursed Altar" accent={RED} onClose={onClose}>
      <span style={lab}>Choose one pact. It binds you for the rest of the run.</span>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, offers.length)}, minmax(0, 1fr))`, gap: 6 }}>
        {offers.map((o, i) => {
          const p = pactLines(o);
          return (
            <button key={o} className="btn small" disabled={!!ev.u} onClick={() => { net.roomEvent('altar', ev.i, i); onClose(); }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 4, padding: 6, textAlign: 'left', whiteSpace: 'normal', minWidth: 0, height: '100%' }}>
              <span className="row" style={{ gap: 4, alignItems: 'center' }}>{p.item && <ItemIcon itemId={p.item} size={20} />}<b style={{ ...line, color: '#ebe0c8' }}>{p.name}</b></span>
              {p.prices.map((t) => <span key={t} style={{ ...line, color: RED }}>Price: {t}</span>)}
              {p.gifts.map((t) => <span key={t} style={{ ...line, color: GOLD }}>Gift: {t}</span>)}
              <span style={{ ...lab, textTransform: 'none', fontStyle: 'italic' }}>{p.flavor}</span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function ShopPanel({ ev, net, coins, onClose }: { ev: SnapRoomEvent; net: GameConnection; coins: number; onClose: () => void }) {
  const rows = ev.s ?? [];
  return (
    <Panel title={MERCHANT.name} accent={ORANGE} onClose={onClose} right={<span className="row" style={{ gap: 4, alignItems: 'center' }}><CoinIcon size={16} /><b style={{ ...line, color: GOLD }}>{coins}</b></span>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map(([ware, price, left, item], i) => {
          const w = WARE_BY_ID[ware];
          const leg = item ? LEGENDARY_BY_ID[item] : undefined;
          const name = leg?.name ?? w?.name ?? ware;
          const short = leg ? `${leg.perk.description}` : w?.short ?? '';
          const out = left <= 0, poor = coins < price;
          return (
            <div key={i} className="row" style={{ gap: 6, alignItems: 'center', padding: '2px 4px', background: 'rgba(0,0,0,0.35)', opacity: out ? 0.45 : 1 }}>
              <span style={{ width: 24, display: 'grid', placeItems: 'center', flex: 'none' }}>
                {ware === 'blessing' ? <BlessingIcon size={22} /> : leg ? <ItemIcon itemId={leg.id} size={22} /> : <CoinIcon size={14} />}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                <b style={{ ...line, color: leg ? ORANGE : ware === 'blessing' ? '#e8c8ff' : '#ebe0c8' }}>{name}{left > 1 ? ` ×${left}` : ''}</b>
                <span style={{ ...lab, textTransform: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={short}>{short}</span>
              </span>
              <button className={`btn small ${out || poor ? 'ghost' : 'primary'}`} disabled={out || poor} onClick={() => net.roomEvent('buy', ev.i, i)}
                aria-label={`Buy ${name} for ${price} coins`} style={{ flex: 'none', minWidth: 72, display: 'inline-flex', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
                {out ? 'Sold' : <><CoinIcon size={12} />{price}</>}
              </button>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/** Mounted for the run: opens the altar / merchant panel on request and closes it when it stops making sense. */
export function RoomEventLayer({ net }: { net: GameConnection }) {
  const [open, setOpen] = useState<RoomEventOpen | null>(null);
  const hud = useStore(netStore, (s) => s.hud);
  const slot = useStore(netStore, (s) => s.slot);
  useEffect(() => {
    const on = (e: Event) => setOpen((e as CustomEvent<RoomEventOpen>).detail ?? null);
    const key = (e: KeyboardEvent) => { if (e.code === 'Escape') setOpen((o) => { if (o) { e.preventDefault(); e.stopPropagation(); } return null; }); };
    window.addEventListener('cursebound:roomevent', on);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('cursebound:roomevent', on); window.removeEventListener('keydown', key, true); };
  }, []);
  const ev = open ? hud?.rev?.find((e) => e.i === open.id && e.k === open.kind) : undefined;
  const me = hud?.players[slot];
  const phaseOk = hud?.phase === 'COMBAT' || hud?.phase === 'VOTING';
  const inReach = !!ev && !!me && Math.hypot(ev.x - me.x, ev.y - me.y) <= ROOM_EVENT_RULES.useRange + 1.2;
  const alive = me?.life === 'alive';
  useEffect(() => { if (open && hud && (!ev || !inReach || !phaseOk || !alive || (ev.k === 'altar' && ev.u))) setOpen(null); }, [open, hud, ev, inReach, phaseOk, alive]);
  if (!open || !ev || !me) return null;
  const close = () => setOpen(null);
  return ev.k === 'altar' ? <AltarPanel ev={ev} net={net} onClose={close} /> : <ShopPanel ev={ev} net={net} coins={me.co ?? 0} onClose={close} />;
}
