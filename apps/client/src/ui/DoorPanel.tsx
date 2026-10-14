'use client';

import { useEffect, useMemo, useState } from 'react';
import { CLASS_BY_ID, DUNGEON_THEMES, MECHANIC_BY_ID, RARITIES, STAT_BY_ID, cardRarity, type CardDef } from '@cursebound/content';
import type { SnapDoor } from '@cursebound/simulation';
import { deadlineSeconds, netStore, type GameConnection } from '@/lib/net';
import { useStore } from '@/lib/store';
import { doorColors } from '@/game/art/doors';
import { ForecastDetail, MechLine, StatLine, cardDef, signed } from './FateVote';
import { CardIcon } from './icons';
import styles from './DoorPanel.module.css';

// VOTING / FATE_COMMIT: the in-world door vote (REQ VOTE01 rules unchanged). The party walks the cleared floor to
// three themed doors; standing in one is a vote (solo: 1 s commits; co-op: everyone in the same door). This overlay
// stays out of the way: a title strip, a compact panel for the door you are near or pointing at (dungeon, GIFT,
// PRICE, who stands there, Forecast, Choose), and a slim bottom strip comparing all three doors (click to walk there).
// Keys: 1 2 3 walk to a door · Enter chooses the door in the panel · F toggles its Forecast · Esc closes it.
// FATE_COMMIT shows nothing heavy: the walk-through cutscene (CINEMA) plays in the world.

const NUMERALS = ['I', 'II', 'III'];
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function themeOf(id: string) {
  return DUNGEON_THEMES.find((t) => t.id === id);
}

/** One-line gift / price for the comparison strip. */
function lines(card: CardDef): { gift: string; price: string } {
  const gift = card.boon ? MECHANIC_BY_ID[card.boon.id]?.name ?? card.boon.id : card.positive ? `${signed(card.positive.percent)} ${STAT_BY_ID[card.positive.stat]?.name ?? card.positive.stat}` : '—';
  const price = card.bane ? MECHANIC_BY_ID[card.bane.id]?.name ?? card.bane.id : card.negative ? `${signed(card.negative.percent)} ${STAT_BY_ID[card.negative.stat]?.name ?? card.negative.stat}` : '—';
  return { gift, price };
}

function walkTo(d: SnapDoor) {
  window.dispatchEvent(new CustomEvent('cursebound:moveto', { detail: { x: d.x, y: d.y } }));
}

export function DoorPanel({ net, onLedger }: { net: GameConnection; onLedger: () => void }) {
  const offer = useStore(netStore, (s) => s.offer);
  const myVote = useStore(netStore, (s) => s.myVote);
  const phase = useStore(netStore, (s) => s.phase);
  const hud = useStore(netStore, (s) => s.hud);
  const slot = useStore(netStore, (s) => s.slot);
  const serverTick = useStore(netStore, (s) => s.serverTick);
  const commit = useStore(netStore, (s) => s.commit);
  const [hover, setHover] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [detail, setDetail] = useState<number | null>(null);
  const [cinematic, setCinematic] = useState(false);
  const [stripHover, setStripHover] = useState<number | null>(null);

  useEffect(() => {
    const onHover = (e: Event) => setHover((e as CustomEvent<{ i: number | null }>).detail?.i ?? null);
    const onCine = (e: Event) => setCinematic(!!(e as CustomEvent<{ active: boolean }>).detail?.active);
    window.addEventListener('cursebound:doorhover', onHover);
    window.addEventListener('cursebound:cinematic', onCine);
    return () => { window.removeEventListener('cursebound:doorhover', onHover); window.removeEventListener('cursebound:cinematic', onCine); };
  }, []);
  useEffect(() => { setDetail(null); setPicked(null); }, [offer?.offerId]);

  const doors = hud?.phase === 'VOTING' || hud?.phase === 'FATE_COMMIT' ? hud.doors ?? null : null;
  const me = hud?.players[slot];
  const standing = doors?.find((d) => d.v.includes(slot))?.i ?? null;
  const near = useMemo(() => {
    if (!doors || !me) return null;
    let best: number | null = null, bd = 3.4 * 3.4;
    for (const d of doors) { const dd = (d.x - me.x) ** 2 + (d.y - me.y) ** 2; if (dd < bd) { bd = dd; best = d.i; } }
    return best;
  }, [doors, me]);
  const focus = stripHover ?? hover ?? standing ?? near ?? picked;
  const voting = phase?.phase === 'VOTING' && !!offer;

  const choose = (i: number) => { if (!myVote.locked && !myVote.pending) net.vote(i, true); };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!voting || !doors) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].includes(e.code)) {
        const i = Number(e.code.slice(-1)) - 1;
        const d = doors[i];
        if (d) { setPicked(i); walkTo(d); if (detail !== null) setDetail(i); }
      } else if (e.code === 'Escape' && detail !== null) setDetail(null);
      else if (e.code === 'KeyF' && focus !== null) setDetail(detail === null ? focus : null);
      else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && focus !== null && !t?.closest?.('button, summary')) { e.preventDefault(); choose(focus); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  if (!phase || cinematic) return null;   // cutscenes own the screen
  if (phase.phase === 'FATE_COMMIT' || (!offer && commit)) {
    const chosen = doors?.find((d) => d.sel);
    const card = commit ? cardDef(commit.cardId) : chosen ? cardDef(chosen.c) : undefined;
    const theme = chosen ? themeOf(chosen.th)?.name : undefined;
    return <span className="sr-only" role="status" aria-live="assertive">{theme ? `The party passes into ${theme}.` : 'The door is chosen.'}{card ? ` Bound: ${card.name}.` : ''}</span>;
  }
  if (!voting || !offer) return <div className={styles.layer}><div className={styles.hint}><span className={styles.sub}>The doors are rising…</span></div></div>;

  const fc = offer.forecast;
  const secs = deadlineSeconds(offer.deadlineTick, serverTick);
  const nameOf = (s: number) => phase.players[s]?.name ?? `P${s + 1}`;
  const accentOf = (s: number) => CLASS_BY_ID[phase.players[s]?.classId ?? '']?.accent ?? '#e8c66a';
  const coop = phase.players.length > 1;
  const focusDoor = focus !== null ? doors?.find((d) => d.i === focus) : undefined;
  const focusCard = focus !== null ? cardDef(offer.cardIds[focus]) : undefined;
  const focusFc = focus !== null ? fc.cards[focus] : undefined;
  const focusTheme = focusDoor?.th ?? offer.themes?.[focus ?? -1];
  const detailCard = detail !== null ? cardDef(offer.cardIds[detail]) : undefined;

  return (
    <div className={styles.layer}>
      <div className={styles.hint}>
        <h2 className={styles.title}>Choose your door</h2>
        <div className={styles.sub}>
          <span>{coop ? 'Gather in one door together' : 'Step into a door'} · next: round {fc.nextRound}{fc.nextIsBoss ? ' (boss lair)' : ''}</span>
          {secs !== null && <span className="chip warn" role="timer" aria-label={`${Math.ceil(secs)} seconds left to choose`}>{Math.ceil(secs)}s</span>}
          <button className="btn small" onClick={onLedger}>Ledger</button>
        </div>
      </div>

      {focus !== null && focusCard && focusFc && focusTheme && (
        <section className={`frame ${styles.panel}`} style={{ ['--door' as string]: hex(doorColors(focusTheme).glow) }} aria-label={`Door ${NUMERALS[focus]}: ${themeOf(focusTheme)?.name ?? focusTheme}`}>
          <div className={styles.head}>
            <span className={styles.numeral}>{NUMERALS[focus]}</span>
            <div className={styles.names}>
              <span className={styles.dungeon}>{themeOf(focusTheme)?.name ?? focusTheme}</span>
              {focusDoor?.b && <span className={styles.lair}>Boss Lair</span>}
              <span className={styles.desc}>{themeOf(focusTheme)?.description}</span>
            </div>
          </div>
          <div className={styles.card}>
            <CardIcon cardId={focusCard.id} size={32} />
            <span className={styles.cardName}>{focusCard.name}</span>
            <span className={styles.rarity} style={{ color: RARITIES[cardRarity(focusCard)].color }}>{RARITIES[cardRarity(focusCard)].name}</span>
          </div>
          <div className="fv-section gift">
            <span className="fv-label">Gift</span>
            {focusCard.boon && <MechLine eff={focusCard.boon} side="gift" mf={focusFc.mechanics.find((m) => m.side === 'gift')} />}
            {focusCard.positive && <StatLine eff={focusCard.positive} side="gift" na={focusFc.positive ? !focusFc.positive.applicable : false} />}
          </div>
          <div className="fv-section price">
            <span className="fv-label">Price</span>
            {focusCard.bane && <MechLine eff={focusCard.bane} side="price" mf={focusFc.mechanics.find((m) => m.side === 'price')} />}
            {focusCard.negative && <StatLine eff={focusCard.negative} side="price" />}
          </div>
          {focusFc.warnings.length > 0 && <div className={styles.warn}>! {focusFc.warnings[0]}</div>}
          <div className={styles.who}>
            {focusDoor && focusDoor.v.length > 0
              ? <>Standing here: {focusDoor.v.map((s) => <span key={s} className="chip" style={{ color: accentOf(s) }}>{nameOf(s)}</span>)}</>
              : <span className={styles.note}>Nobody stands here yet.</span>}
          </div>
          {focusDoor && focusDoor.hold > 0 && <div className={styles.hold} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(focusDoor.hold * 100)}><i style={{ width: `${focusDoor.hold * 100}%` }} /></div>}
          <div className={styles.actions}>
            <button className="btn" aria-expanded={detail !== null} onClick={() => setDetail(detail === null ? focus : null)}>Forecast <span className="kbd">F</span></button>
            <button className="btn primary" disabled={myVote.locked || myVote.pending} onClick={() => choose(focus)}>
              {myVote.locked ? (myVote.cardSlot === focus ? 'Chosen ✦' : 'Vote sealed') : <>Choose <span className="kbd">Enter</span></>}
            </button>
          </div>
          <div className={styles.note}>
            {myVote.locked && standing !== null && standing !== myVote.cardSlot ? 'You stand in another door: where you stand counts.' : coop ? 'Ties are broken by a seeded draw when the timer runs out.' : 'Stand in the door for a moment, or press Choose.'}
          </div>
        </section>
      )}

      {doors && (
        <nav className={styles.strip} aria-label="The three doors">
          {doors.map((d) => {
            const card = cardDef(d.c);
            if (!card) return null;
            const l = lines(card);
            return (
              <button key={d.i} className={`frame inset ${styles.entry}`} aria-current={focus === d.i}
                style={{ ['--door' as string]: hex(doorColors(d.th).glow) }}
                onClick={() => { setPicked(d.i); walkTo(d); }}
                onMouseEnter={() => setStripHover(d.i)} onMouseLeave={() => setStripHover(null)}
                onFocus={() => setStripHover(d.i)} onBlur={() => setStripHover(null)}
                aria-label={`Door ${d.i + 1}: ${themeOf(d.th)?.name ?? d.th}${d.b ? ', boss lair' : ''}. ${card.name}. Gift: ${l.gift}. Price: ${l.price}. Walk there.`}>
                <span className={styles.entryHead}>
                  <span className="kbd">{d.i + 1}</span>
                  <span className={styles.entryName}>{themeOf(d.th)?.name.replace(/^The /, '') ?? d.th}{d.b ? ' · Boss Lair' : ''}</span>
                  <span className={styles.pips}>{d.v.map((s) => <i key={s} className={styles.pip} style={{ background: accentOf(s) }} title={nameOf(s)} />)}</span>
                </span>
                <span className={`${styles.line} ${styles.gift}`}>+ {l.gift}</span>
                <span className={`${styles.line} ${styles.price}`}>− {l.price}</span>
              </button>
            );
          })}
        </nav>
      )}

      {detail !== null && detailCard && fc.cards[detail] && (
        <aside className="frame fate-drawer" role="dialog" aria-modal="false" aria-label={`Forecast for ${detailCard.name}`}>
          <div className="fd-top">
            <div>
              <div className="fd-rarity" style={{ color: RARITIES[cardRarity(detailCard)].color }}>{themeOf(offer.themes?.[detail] ?? '')?.name ?? RARITIES[cardRarity(detailCard)].name}</div>
              <h2 className="fd-title">{detailCard.name}</h2>
            </div>
            <button className="btn small" onClick={() => setDetail(null)}>Close <span className="kbd">Esc</span></button>
          </div>
          <p className="fd-text">{fc.cards[detail].consequence}</p>
          {fc.cards[detail].warnings.length > 0 && <ul className="fd-list fd-warn">{fc.cards[detail].warnings.map((w, k) => <li key={k}>{w}</li>)}</ul>}
          <ForecastDetail c={fc.cards[detail]} />
        </aside>
      )}
    </div>
  );
}
