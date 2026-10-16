'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CLASS_BY_ID, DUNGEON_THEMES, MECHANIC_BY_ID, STAT_BY_ID, TRAINING_THEME, type CardDef } from '@cursebound/content';
import type { SnapDoor } from '@cursebound/simulation';
import { deadlineSeconds, netStore, type GameConnection } from '@/lib/net';
import { settingsStore } from '@/lib/settings';
import { useStore } from '@/lib/store';
import { particleBudget } from '@/game/gfx';
import { ForecastDetail, cardDef, signed } from './FateVote';
import { FateCards, fateCardStyles as fc, type FateCardModel, type FateCeremony, type FateVoter } from './FateCards';
import { fateThemeArt, prewarmFateArt } from './fateArt';
import { BlessingIcon } from './itemIcons';
import { useReducedMotion } from './motion';
import styles from './DoorPanel.module.css';
import { playUiFile, useCountdownTick } from './uiCues';

// VOTING / FATE_COMMIT: the Fate choice (REQ VOTE01 rules unchanged). The party stands in a cleared floor before three
// themed doors; door i binds card i and leads to offer.themes[i] (simulation doors.ts / fate.ts drawDoorThemes, sent
// in the OFFER message and on every SnapDoor as `th`). Two views of the same vote:
//   - the spread (default): the three Fate cards dealt big and centred (ui/FateCards.tsx), each ornamented by the
//     dungeon its door opens. Click / 1 2 3 picks a card (an open vote), click it again / Enter chooses (a sealed vote).
//     Choosing is a ceremony: solo, the card is bound on the spot (the vote goes out at the ceremony's peak, so the
//     walk-through cutscene that follows plays in full); co-op, the card is sealed with its dungeon's wax and the
//     whole party sees the binding ceremony when the vote resolves.
//   - the doors (V / Esc / a click beside the cards): the cards fold into a slim themed strip and the hero walks the
//     floor; standing in a door is a vote (solo: 1 s commits; co-op: everyone in the same door). Click a strip card to
//     walk there, V to bring the cards back.
// Keys: 1 2 3 · Enter chooses · F Forecast · B Bless · V cards / doors · Esc closes the Forecast, then the cards.
// Fate's Blessing: a hero carrying one can bless the selected card (its price is lifted for the commit; simulation
// blessing.ts). FATE_COMMIT otherwise shows nothing heavy: the walk-through cutscene (CINEMA) plays in the world.

const NUMERALS = ['I', 'II', 'III'];
/** the binding ceremony: the vote goes out at its peak (solo), the spread folds away at its end */
const BIND_SEND_MS = 1050;
const BIND_FADE_MS = 1250;
const BIND_END_MS = 1750;

function themeOf(id: string) {
  return DUNGEON_THEMES.find((t) => t.id === id) ?? (id === TRAINING_THEME.id ? TRAINING_THEME : undefined);
}

/** One-line gift / price for the door strip. */
function lines(card: CardDef): { gift: string; price: string } {
  const gift = card.boon ? MECHANIC_BY_ID[card.boon.id]?.name ?? card.boon.id : card.positive ? `${signed(card.positive.percent)} ${STAT_BY_ID[card.positive.stat]?.name ?? card.positive.stat}` : '—';
  const price = card.bane ? MECHANIC_BY_ID[card.bane.id]?.name ?? card.bane.id : card.negative ? `${signed(card.negative.percent)} ${STAT_BY_ID[card.negative.stat]?.name ?? card.negative.stat}` : '—';
  return { gift, price };
}

function walkTo(d: SnapDoor) {
  window.dispatchEvent(new CustomEvent('cursebound:moveto', { detail: { x: d.x, y: d.y } }));
}

type Bind = { cer: NonNullable<FateCeremony>; cards: FateCardModel[]; dealKey: string; send: boolean };

export function DoorPanel({ net, onLedger }: { net: GameConnection; onLedger: () => void }) {
  const offer = useStore(netStore, (s) => s.offer);
  const votes = useStore(netStore, (s) => s.votes);
  const myVote = useStore(netStore, (s) => s.myVote);
  const phase = useStore(netStore, (s) => s.phase);
  const hud = useStore(netStore, (s) => s.hud);
  const slot = useStore(netStore, (s) => s.slot);
  const serverTick = useStore(netStore, (s) => s.serverTick);
  const commit = useStore(netStore, (s) => s.commit);
  const flashes = useStore(settingsStore, (s) => s.s.flashes);
  const reducedFx = useStore(settingsStore, (s) => s.s.reducedEffects);
  const reduced = useReducedMotion();
  useCountdownTick(phase?.phase === 'VOTING' && offer ? deadlineSeconds(offer.deadlineTick, serverTick) : null);
  const [hover, setHover] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [detail, setDetail] = useState<number | null>(null);
  const [cinematic, setCinematic] = useState(false);
  const [stripHover, setStripHover] = useState<number | null>(null);
  const [mode, setMode] = useState<'spread' | 'doors'>('spread');
  const [entrance, setEntrance] = useState<'deal' | 'rise'>('deal');
  const [sel, setSel] = useState<number | null>(null);
  const [bind, setBind] = useState<Bind | null>(null);
  const [bindPhase, setBindPhase] = useState<'on' | 'leaving' | 'done'>('on');
  const bindRef = useRef<Bind | null>(null);
  bindRef.current = bind;
  /** the spread's last header and footer, kept (faded, inert) while the ceremony plays so nothing shifts */
  const chrome = useRef<{ header: React.ReactNode; footer: React.ReactNode } | null>(null);

  useEffect(() => {
    const onHover = (e: Event) => setHover((e as CustomEvent<{ i: number | null }>).detail?.i ?? null);
    const onCine = (e: Event) => setCinematic(!!(e as CustomEvent<{ active: boolean }>).detail?.active);
    window.addEventListener('cursebound:doorhover', onHover);
    window.addEventListener('cursebound:cinematic', onCine);
    return () => { window.removeEventListener('cursebound:doorhover', onHover); window.removeEventListener('cursebound:cinematic', onCine); };
  }, []);
  // a fresh offer: deal the cards again
  useEffect(() => {
    setDetail(null); setPicked(null); setSel(null); setMode('spread'); setEntrance('deal');
    if (!bindRef.current || bindRef.current.dealKey !== offer?.offerId) { setBind(null); setBindPhase('on'); }
    if (offer?.themes) prewarmFateArt(offer.themes);
  }, [offer?.offerId]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const coop = (phase?.players.length ?? 1) > 1;
  const sealed = myVote.locked ? myVote.cardSlot : null;
  const current = sel ?? (myVote.cardSlot !== null ? myVote.cardSlot : null);

  // ---------------------------------------------------------------- the card models (live)
  const nameOf = (s: number) => phase?.players[s]?.name ?? `P${s + 1}`;
  const accentOf = (s: number) => CLASS_BY_ID[phase?.players[s]?.classId ?? '']?.accent ?? '#e8c66a';
  const models: FateCardModel[] = useMemo(() => {
    if (!offer || !phase) return [];
    return offer.cardIds.map((id, i): FateCardModel | null => {
      const card = cardDef(id);
      if (!card) return null;
      const d = doors?.find((x) => x.i === i);
      const theme = d?.th ?? offer.themes?.[i] ?? phase.map?.theme ?? 'catacombs';
      const voters: FateVoter[] = [];
      if (phase.players.length > 1) for (const p of phase.players) {
        const at = doors?.find((x) => x.v.includes(p.slot))?.i;
        const v = votes?.votes.find((x) => x.slot === p.slot);
        const eff = at ?? v?.cardSlot ?? null;
        if (eff !== i) continue;
        voters.push({ slot: p.slot, name: p.name, accent: accentOf(p.slot), locked: !!v?.locked && v.cardSlot === i, standing: at === i, me: p.slot === slot });
      }
      return {
        i, card, fc: offer.forecast.cards[i], theme, themeName: themeOf(theme)?.name ?? theme,
        boss: !!d?.b || !!offer.forecast.nextIsBoss, blessed: !!d?.bl, voters, hold: d?.hold ?? 0,
      };
    }).filter((m): m is FateCardModel => !!m);
  }, [offer, phase, doors, votes, slot]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- choosing
  const choose = (i: number) => {
    if (myVote.locked || bindRef.current || !offer) return;
    setSel(i);
    if (mode !== 'spread') { setEntrance('rise'); setMode('spread'); }
    const secs = deadlineSeconds(offer.deadlineTick, netStore.get().serverTick);
    if (!coop && !reduced && (secs === null || secs > 2.2)) {
      // solo: the ceremony first, the sealed vote at its peak (the commit and the walk-through follow it)
      setBind({ cer: { kind: 'bound', i, at: Date.now() }, cards: models, dealKey: offer.offerId, send: true });
      setBindPhase('on');
    } else {
      net.vote(i, true);
      playUiFile('vote_lock', 'vote_lock', { volume: 0.9 });
    }
  };
  const select = (i: number) => {
    if (myVote.locked || bindRef.current) return;
    setSel(i);
    if (detail !== null) setDetail(i);
    if (voting) net.vote(i, false);   // an open vote: teammates see where you lean (where you stand still counts)
  };
  const blessings = me?.bl ?? 0;
  const canBless = (i: number | null): i is number => {
    if (i === null || blessings < 1 || !voting || !offer || doors?.find((d) => d.i === i)?.bl) return false;
    const c = cardDef(offer.cardIds[i]);
    return !!c && (!!c.negative || !!c.bane);
  };

  // the bound card: a commit while the cards are up plays the ceremony (co-op: everyone sees it)
  const committedSlot: number | null = (() => {
    if (phase?.phase !== 'FATE_COMMIT' && !commit) return null;
    if (commit && (!offer || commit.offerId === offer.offerId)) return commit.cardSlot;
    return doors?.find((d) => d.sel)?.i ?? null;
  })();
  useEffect(() => {
    if (committedSlot === null) return;
    const b = bindRef.current;
    if (b) {
      // our own ceremony is already playing: if the authority bound another card (a tie draw), rebind to it
      if (b.cer.i !== committedSlot) setBind({ ...b, cer: { kind: 'bound', i: committedSlot, at: Date.now() }, send: false });
      return;
    }
    if (mode === 'spread' && models.length && offer) {
      setBind({ cer: { kind: 'bound', i: committedSlot, at: Date.now() }, cards: models, dealKey: offer.offerId, send: false });
      setBindPhase('on');
    }
  }, [committedSlot]); // eslint-disable-line react-hooks/exhaustive-deps
  // the ceremony's clock: send (solo), fade, end. A vote the authority refused hands the cards back.
  useEffect(() => {
    if (!bind) return;
    const t: number[] = [];
    let sent = !bind.send;
    const send = () => {
      if (sent) return;
      sent = true;
      const s = netStore.get();   // only while that vote is still open (a commit may have come by another road)
      if (s.phase?.phase === 'VOTING' && s.offer?.offerId === bind.dealKey && !s.myVote.locked) net.vote(bind.cer.i, true);
    };
    if (bind.send) t.push(window.setTimeout(send, BIND_SEND_MS));
    t.push(window.setTimeout(() => setBindPhase('leaving'), bind.send ? BIND_SEND_MS + 250 : BIND_FADE_MS));
    t.push(window.setTimeout(() => setBindPhase('done'), bind.send ? BIND_SEND_MS + 700 : BIND_END_MS));
    if (bind.send) t.push(window.setTimeout(() => {
      const s = netStore.get();
      if (s.phase?.phase === 'VOTING' && !s.myVote.locked && !s.commit) { setBind(null); setBindPhase('on'); }
    }, BIND_SEND_MS + 2500));
    return () => { t.forEach((x) => window.clearTimeout(x)); send(); };
  }, [bind?.cer.at]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- keys
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!voting || !doors || bindRef.current || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      // a dialog above the cards (Ledger, pause menu, gear) owns the keys
      if (document.querySelector('[aria-modal="true"]:not([aria-label="Choose your Fate"])')) return;
      const spread = mode === 'spread';
      if (['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].includes(e.code)) {
        const i = Number(e.code.slice(-1)) - 1;
        if (spread) { select(i); (document.querySelector(`[data-fate-card="${i}"]`) as HTMLElement | null)?.focus(); }
        else { const d = doors[i]; if (d) { setPicked(i); walkTo(d); if (detail !== null) setDetail(i); } }
      } else if (e.code === 'Escape') {
        if (detail !== null) { setDetail(null); if (spread) e.stopPropagation(); }
        else if (spread) { e.stopPropagation(); setMode('doors'); playUiFile('ui_panel_close', null, { volume: 0.6 }); }
      } else if (e.code === 'KeyV') {
        e.preventDefault();
        if (spread) setMode('doors'); else { setEntrance('rise'); setMode('spread'); if (sel === null && focus !== null) setSel(focus); }
        playUiFile(spread ? 'ui_panel_close' : 'ui_panel_open', null, { volume: 0.6 });
      } else if (e.code === 'KeyF') {
        const i = spread ? current : focus;
        if (i !== null) setDetail(detail === null ? i : null);
      } else if (e.code === 'KeyB') {
        const i = spread ? current : focus;
        if (canBless(i)) { e.preventDefault(); net.bless(i); }
      } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        const cardEl = t?.closest?.('[data-fate-card]') as HTMLElement | null;
        if (cardEl) {
          e.preventDefault();
          const i = Number(cardEl.dataset.fateCard);
          if (current === i) choose(i); else select(i);
        } else if (t?.closest?.('button, summary')) return;
        else if (spread && current !== null) { e.preventDefault(); choose(current); }
        else if (!spread && focus !== null) { e.preventDefault(); setEntrance('rise'); setMode('spread'); setSel(focus); }
      }
    };
    // capture: Escape folds the cards away instead of opening the pause menu (lib/input.ts listens on bubble)
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  });

  // ---------------------------------------------------------------- render
  if (!phase) return null;
  const density = reducedFx ? 0 : particleBudget();
  const noop = () => undefined;
  if (bind && bindPhase !== 'done') {
    // the same FateCards instance as the live spread (same position in the tree), now playing the ceremony
    return (
      <>
        <FateCards cards={bind.cards} dealKey={bind.dealKey} entrance={entrance} selected={bind.cer.i} sealed={null} ceremony={bind.cer} leaving={bindPhase === 'leaving'}
          header={chrome.current?.header ?? null} footer={chrome.current?.footer ?? null} onSelect={noop} onChoose={noop} reduced={reduced} flashes={flashes} density={density} />
        {null}
      </>
    );
  }
  if (cinematic) return null;   // cutscenes own the screen
  if (phase.phase === 'FATE_COMMIT' || (!offer && commit)) {
    const chosen = doors?.find((d) => d.sel);
    const card = commit ? cardDef(commit.cardId) : chosen ? cardDef(chosen.c) : undefined;
    const theme = chosen ? themeOf(chosen.th)?.name : undefined;
    return <span className="sr-only" role="status" aria-live="assertive">{theme ? `The party passes into ${theme}.` : 'The door is chosen.'}{card ? ` Bound: ${card.name}.` : ''}</span>;
  }
  if (!voting || !offer) return <div className={styles.layer}><div className={styles.hint}><span className={styles.sub}>The doors are rising…</span></div></div>;

  const fcst = offer.forecast;
  const secs = deadlineSeconds(offer.deadlineTick, serverTick);
  const lockedCount = votes?.votes.filter((v) => v.locked).length ?? (myVote.locked ? 1 : 0);
  const connected = phase.players.filter((p) => p.connected).length;
  const curModel = current !== null ? models.find((m) => m.i === current) : undefined;
  const detailCard = detail !== null ? cardDef(offer.cardIds[detail]) : undefined;
  const timer = secs !== null && <span className="chip warn" role="timer" aria-label={`${Math.ceil(secs)} seconds left to choose`}>{Math.ceil(secs)}s</span>;
  const blessChip = blessings > 0 && <span className="chip prism-border" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} aria-label={`You carry ${blessings} Fate's Blessing${blessings > 1 ? 's' : ''}`}><BlessingIcon size={16} /> ×{blessings}</span>;

  const drawer = detail !== null && detailCard && fcst.cards[detail] && (
    <div className={styles.drawerLayer}>
      <aside className="frame fate-drawer" role="dialog" aria-modal="false" aria-label={`Forecast for ${detailCard.name}`}>
        <div className="fd-top">
          <div>
            <div className="fd-rarity" style={{ color: fateThemeArt(models.find((m) => m.i === detail)?.theme ?? 'catacombs').glow }}>{models.find((m) => m.i === detail)?.themeName ?? ''}</div>
            <h2 className="fd-title">{detailCard.name}</h2>
          </div>
          <button className="btn small" onClick={() => setDetail(null)}>Close <span className="kbd">Esc</span></button>
        </div>
        <p className="fd-text">{fcst.cards[detail].consequence}</p>
        {fcst.cards[detail].warnings.length > 0 && <ul className="fd-list fd-warn">{fcst.cards[detail].warnings.map((w, k) => <li key={k}>{w}</li>)}</ul>}
        <ForecastDetail c={fcst.cards[detail]} />
      </aside>
    </div>
  );

  if (mode === 'spread') {
    const header = (
      <>
        <h2 className={fc.title}>Choose your Fate</h2>
        <div className={fc.sub}>
          <span>Round {fcst.nextRound}{fcst.nextIsBoss ? ' · a boss lair' : ''} · {coop ? 'the party chooses together' : 'three doors, three dungeons'}</span>
          {coop && <span className={fc.tally} aria-label={`${lockedCount} of ${connected} sealed`}>{lockedCount}/{connected} sealed</span>}
          {timer}{blessChip}
          <button className="btn small" onClick={onLedger}>Ledger</button>
        </div>
      </>
    );
    const footer = (
      <>
        <div className={fc.actions}>
          <button className="btn" aria-expanded={detail !== null} disabled={current === null} onClick={() => current !== null && setDetail(detail === null ? current : null)}>Forecast <span className="kbd">F</span></button>
          {canBless(current) && <button className="btn prism-border" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} onClick={() => net.bless(current)} aria-label={`Bless ${curModel?.card.name ?? 'this card'}: lift its price (${blessings} left)`}><BlessingIcon size={16} /> Bless <span className="kbd">B</span></button>}
          <button className="btn primary big" data-sfx="none" disabled={current === null || myVote.locked} onClick={() => current !== null && choose(current)}>
            {myVote.locked ? (coop ? 'Sealed · waiting for the party' : 'Sealed') : curModel ? <>Choose {curModel.card.name} <span className="kbd">Enter</span></> : 'Pick a card'}
          </button>
          <button className="btn ghost" onClick={() => { setMode('doors'); playUiFile('ui_panel_close', null, { volume: 0.6 }); }}>Walk to the doors <span className="kbd">V</span></button>
        </div>
        <div className={fc.status} role="status" aria-live="polite">
          {coop
            ? <>Ties are broken by a seeded draw · where you stand counts</>
            : myVote.locked ? 'Sealed.' : <>Pick a card, then choose it again to bind it</>}
          <span> · 1 2 3 pick · Enter choose · F forecast · Esc doors</span>
        </div>
      </>
    );
    chrome.current = { header, footer };
    return (
      <>
        <FateCards cards={models} dealKey={offer.offerId} entrance={entrance} selected={current} sealed={sealed} ceremony={null}
          header={header} footer={footer} onSelect={select} onChoose={choose}
          onDismiss={() => { setMode('doors'); playUiFile('ui_panel_close', null, { volume: 0.6 }); }}
          reduced={reduced} flashes={flashes} density={density} />
        {drawer}
      </>
    );
  }

  // the doors: a slim themed strip; the hero walks the floor
  return (
    <div className={styles.layer}>
      <div className={styles.hint}>
        <h2 className={styles.title}>Choose your door</h2>
        <div className={styles.sub}>
          <span>{coop ? 'Gather in one door together' : 'Step into a door'} · round {fcst.nextRound}{fcst.nextIsBoss ? ' (boss lair)' : ''}</span>
          {timer}{blessChip}
          <button className="btn small primary" data-pad-default onClick={() => { setEntrance('rise'); setMode('spread'); if (sel === null && focus !== null) setSel(focus); playUiFile('ui_panel_open', null, { volume: 0.6 }); }}>See the cards <span className="kbd">V</span></button>
          <button className="btn small" onClick={onLedger}>Ledger</button>
        </div>
        {myVote.locked && standing !== null && standing !== myVote.cardSlot && <div className={styles.note}>You stand in another door: where you stand counts.</div>}
      </div>
      {doors && (
        <nav className={styles.strip} aria-label="The three doors">
          {models.map((m) => {
            const d = doors.find((x) => x.i === m.i);
            if (!d) return null;
            const a = fateThemeArt(m.theme);
            const l = lines(m.card);
            const on = focus === m.i;
            return (
              <button key={m.i} className={styles.mini} aria-current={on}
                style={{ ['--fa-frame' as string]: a.frame, ['--fa-panel' as string]: a.panel, ['--fa-panel-hex' as string]: a.panelHex, ['--fa-sigil' as string]: a.sigil, ['--door' as string]: a.glow }}
                onClick={() => { setPicked(m.i); walkTo(d); }}
                onMouseEnter={() => setStripHover(m.i)} onMouseLeave={() => setStripHover(null)}
                onFocus={() => setStripHover(m.i)} onBlur={() => setStripHover(null)}
                aria-label={`Door ${m.i + 1}: ${m.themeName}${m.boss ? ', boss lair' : ''}. ${m.card.name}. Gift: ${l.gift}. Price: ${l.price}. Walk there.`}>
                <span className={styles.entryHead}>
                  <span className="kbd">{m.i + 1}</span>
                  <i className={styles.sigil} aria-hidden="true" />
                  <span className={styles.entryName}>{m.themeName.replace(/^The /, '')}{m.boss ? ' · Boss Lair' : ''}</span>
                  <span className={styles.pips}>{d.v.map((s) => <i key={s} className={styles.pip} style={{ background: accentOf(s) }} title={nameOf(s)} />)}</span>
                </span>
                <span className={styles.cardName}>{NUMERALS[m.i]} · {m.card.name}</span>
                <span className={`${styles.line} ${styles.gift}`}>+ {l.gift}</span>
                <span className={`${styles.line} ${styles.price}`} style={m.blessed ? { textDecoration: 'line-through', opacity: 0.5 } : undefined}>− {l.price}</span>
                {m.blessed && <span className={`${styles.line} prism-text`} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><BlessingIcon size={16} /> Blessed</span>}
                {d.hold > 0 && <span className={styles.hold} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(d.hold * 100)}><i style={{ width: `${d.hold * 100}%` }} /></span>}
              </button>
            );
          })}
        </nav>
      )}
      {drawer}
    </div>
  );
}
