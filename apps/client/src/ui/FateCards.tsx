'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RARITIES, STAT_BY_ID, cardRarity, type CardDef } from '@cursebound/content';
import type { CardForecast } from '@cursebound/simulation';
import { sharedAudio } from '@/game/audio/shared';
import { fitScale } from '@/game/viewport';
import type { SfxId } from '@/game/audio/sfx';
import { CardIcon } from './icons';
import { BlessingIcon } from './itemIcons';
import { MechLine, StatLine, signed } from './FateVote';
import { fateMedalArt, fateThemeArt, installFateArt, type FateThemeArt } from './fateArt';
import { FateFx } from './fateFx';
import { prefersReducedMotion } from './motion';
import { playUiFile } from './uiCues';
import styles from './FateCards.module.css';

// The Fate card spread (the door vote's card view, ui/DoorPanel.tsx; also the fallback FateVote screen). Three big
// playing cards, centred, all one size, each wearing the ornament of the dungeon its door leads to (ui/fateArt.ts).
// The deal: each card is tossed face down onto the table from close to the camera, lands with a THUD (a heavy
// squash, its shadow slamming in under it, dust puffing out from under its edges, impact_heavy), then turns face up
// with one smooth rotateY. At rest the cards tilt toward the cursor with their dungeon's particles around them
// (ui/fateFx.ts). Choosing is an event: the card is sealed with its dungeon's wax; when the party is bound to it, it
// rises to the centre in its theme's light while the others burn away, with a flash and a burst of its motes.
// Presentational: the parent owns votes, keys and the network; this owns layout, fitting, animation, tilt, particles
// and sounds.

export interface FateVoter { slot: number; name: string; accent: string; locked: boolean; standing: boolean; me: boolean }

export interface FateCardModel {
  i: number;
  card: CardDef;
  fc?: CardForecast;
  /** the dungeon theme behind this card's door (offer.themes[i] / SnapDoor.th) */
  theme: string;
  themeName: string;
  boss: boolean;
  blessed: boolean;
  voters: FateVoter[];
  /** commit progress of the party standing in this door, 0..1 */
  hold: number;
}

/** 'bound': the party is bound to card i (the full ceremony). `at` re-keys the flash. */
export type FateCeremony = { kind: 'bound'; i: number; at: number } | null;

export interface FateCardsProps {
  cards: FateCardModel[];
  /** a new key deals the cards again (the offer id) */
  dealKey: string;
  /** 'deal' = from the deck with the 3D flip; 'rise' = back up from the door strip (no flip) */
  entrance: 'deal' | 'rise';
  selected: number | null;
  /** my sealed (locked) vote: the wax seal shows on that card */
  sealed: number | null;
  ceremony: FateCeremony;
  /** the spread is fading out (the parent unmounts it afterwards) */
  leaving?: boolean;
  header: React.ReactNode;
  footer: React.ReactNode;
  onSelect: (i: number) => void;
  onChoose: (i: number) => void;
  /** a click on the backdrop: put the cards away (walk to the doors) */
  onDismiss?: () => void;
  reduced: boolean;
  flashes: boolean;
  /** particle density 0..1 (reduced effects: 0.5) */
  density: number;
}

/** card width in art px (FateCards.module.css --cw) */
const CARD_W = 180;
/** art window floors (art px): the window shrinks to VISTA_FULL before the type tightens, to VISTA_TIGHT before any
 *  card drops its quote or warning, and never below VISTA_MIN */
const VISTA_FULL = 40, VISTA_TIGHT = 28, VISTA_MIN = 22;
/** the deal, in ms (FateCards.module.css fcDrop / fcShadow / fcTurn): card k is tossed at TOSS + k * STAGGER, lands
 *  LAND later (76 % of the 0.5 s fall), turns face up TURN after landing (front visible half way through 0.56 s) */
const TOSS = 120, STAGGER = 360, LAND = 380, TURN = 220, DEAL_MS = 2250;
const TOSS_TILT = [-14, 9, 17];

function play(id: SfxId, volume?: number) {
  void sharedAudio().then((e) => e?.play(id, volume === undefined ? {} : { volume }));
}

function ariaFor(m: FateCardModel): string {
  const { card, fc } = m;
  const parts = [`Card ${m.i + 1}: ${card.name}, ${RARITIES[cardRarity(card)].name}. Leads to ${m.themeName}${m.boss ? ', a boss lair' : ''}.`, 'Gift:'];
  if (fc) for (const x of fc.mechanics.filter((y) => y.side === 'gift')) parts.push(`${x.name}: ${x.short}.`);
  if (card.positive) parts.push(`${signed(card.positive.percent)} ${STAT_BY_ID[card.positive.stat]?.name}.`);
  parts.push(m.blessed ? 'Price, lifted by a Fate’s Blessing:' : 'Price:');
  if (fc) for (const x of fc.mechanics.filter((y) => y.side === 'price')) parts.push(`${x.name}: ${x.short}.`);
  if (card.negative) parts.push(`${signed(card.negative.percent)} ${STAT_BY_ID[card.negative.stat]?.name}.`);
  if (fc) parts.push(fc.consequence);
  if (m.voters.length) parts.push(`Votes: ${m.voters.map((v) => `${v.name}${v.locked ? ' (sealed)' : ''}`).join(', ')}.`);
  return parts.join(' ');
}

type SlotState = 'idle' | 'chosen' | 'lost';

export function FateCards(props: FateCardsProps) {
  const { cards, dealKey, entrance, selected, sealed, ceremony, leaving, flashes, density } = props;
  // the OS preference read synchronously too (the shared hook only learns it after the first render, too late for
  // a deal that starts on mount)
  const reduced = props.reduced || (typeof window !== 'undefined' && prefersReducedMotion());
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const bodyRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const placeRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const fxRef = useRef<FateFx | null>(null);
  const [phase, setPhase] = useState<'deal' | 'rise' | 'idle'>(entrance);
  const revealed = useRef<boolean[]>([]);
  const hover = useRef<number | null>(null);
  const live = useRef(props);
  live.current = props;

  useMemo(() => installFateArt(), []);
  const themeKey = cards.map((c) => c.theme).join('|');
  const art = useMemo<FateThemeArt[]>(() => cards.map((c) => fateThemeArt(c.theme)), [themeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const rarityKey = cards.map((c) => `${c.theme}:${cardRarity(c.card)}`).join('|');
  const medals = useMemo(() => cards.map((c) => fateMedalArt(c.theme, cardRarity(c.card))), [rarityKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- layout: deck / centre offsets, the height cap
  const measure = () => {
    const stage = stageRef.current, root = rootRef.current;
    if (!stage || !root) return;
    const u = parseFloat(getComputedStyle(root).getPropertyValue('--ps')) || 2;
    const sr = stage.getBoundingClientRect(), st = getComputedStyle(stage);
    const row = stage.querySelector<HTMLElement>('[role="radiogroup"]');
    const column = !!row && getComputedStyle(row).flexDirection === 'column';
    // narrow windows (a snapped half screen, 800x600, a portrait window): the three cards are scaled down together
    // (0.75 / 0.5: the 2x art lands on a 1.5x / 1x grid) instead of running off the right edge or stacking into a
    // scrolling column; the cards keep their size in art px, so the text fit below is unchanged
    const n = slotRefs.current.length;
    const rowCs = row ? getComputedStyle(row) : null;
    const overlap = slotRefs.current[1] ? parseFloat(getComputedStyle(slotRefs.current[1]).marginLeft) || 0 : 0;
    const natural = n * CARD_W * u + Math.max(0, n - 1) * ((parseFloat(rowCs?.columnGap ?? '') || 0) + overlap);
    const fit = fitScale(natural, sr.width - 16);
    root.style.setProperty('--fit', String(fit));
    if (fit < 1) root.dataset.scaled = ''; else delete root.dataset.scaled;
    // every card the same size: CARD_W art px wide, as tall as the stage allows, up to a 2:3 playing card
    const cardW = fit < 1 ? CARD_W * u : slotRefs.current[0]?.offsetWidth || CARD_W * u;
    const inner = (sr.height - parseFloat(st.paddingTop) - parseFloat(st.paddingBottom)) / fit;
    const tall = Math.round((cardW * 1.5) / u);
    const cardH = (column ? tall : Math.max(150, Math.min(Math.floor(inner / u), tall))) * u;
    root.style.setProperty('--card-h', `${cardH}px`);
    // fit the text (every card the same size, everything inside it): the art window shrinks first (one height for
    // all three); then all three bodies take the tighter type together; then card by card, only where that card
    // still overflows, the quote drops and lines clamp, then the warning drops, then the spacing tightens.
    // Chrome = frame 24 + body rule and padding 14 + margin 3 + slack 2 art px, plus the plaque less its 9 px overlap.
    const place = Math.max(0, ...placeRefs.current.map((el) => el?.offsetHeight ?? 0));
    const chrome = (24 + 14 + 3 + 2 - 9) * u + place;
    const room = (vmin: number) => cardH - chrome - vmin * u;
    const tallest = () => Math.max(0, ...bodyRefs.current.map((el) => el?.offsetHeight ?? 0));
    slotRefs.current.forEach((el) => el?.setAttribute('data-trim', '0'));
    root.dataset.fit = '0';
    if (tallest() > room(VISTA_FULL)) {
      root.dataset.fit = '1';
      if (tallest() > room(VISTA_TIGHT)) {
        bodyRefs.current.forEach((b, k) => {
          for (let t = 1; b && t <= 3 && b.offsetHeight > room(VISTA_MIN); t++) slotRefs.current[k]?.setAttribute('data-trim', String(t));
        });
      }
    }
    const vista = Math.max(VISTA_MIN, Math.min(112, Math.floor((cardH - chrome - tallest()) / u)));
    root.style.setProperty('--vista-h', `${vista * u}px`);
    if (vista <= 40) root.dataset.thin = ''; else delete root.dataset.thin;
    // the toss: each card starts above the screen, close to the camera, tilted; the ceremony's centre offset
    // (screen offsets measured on the scaled row are divided back into the row's own px)
    slotRefs.current.forEach((el, k) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + (cardH * fit) / 2;
      el.style.setProperty('--fx', `${Math.round((k - (n - 1) / 2) * cardW * 0.32)}px`);
      el.style.setProperty('--fy', `${Math.round(-(cy / fit + cardH * 0.35))}px`);
      el.style.setProperty('--r0', `${TOSS_TILT[k % TOSS_TILT.length]}deg`);
      el.style.setProperty('--cx', `${Math.round((sr.left + sr.width / 2 - cx) / fit)}px`);
      el.style.setProperty('--lost-rot', `${k === 0 ? -4 : k === 2 ? 4 : 2}deg`);
    });
    fxRef.current?.setScale(u);
  };
  useLayoutEffect(() => {
    measure();
    const on = () => measure();
    window.addEventListener('resize', on);
    // text that grows or shrinks (votes, a blessing, fonts landing) re-balances the windows
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(on) : null;
    for (const el of bodyRefs.current) if (el) ro?.observe(el);
    return () => { window.removeEventListener('resize', on); ro?.disconnect(); };
  }, [dealKey, cards.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- particles
  useEffect(() => {
    if (reduced || !backRef.current || !frontRef.current) return;
    const fx = new FateFx(backRef.current, frontRef.current);
    fxRef.current = fx;
    fx.density = density;
    const u = parseFloat(getComputedStyle(rootRef.current!).getPropertyValue('--ps')) || 2;
    fx.setScale(u);
    fx.start();
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __fateFx?: FateFx }).__fateFx = fx;   // dev: /dev/fate frame captures
    const feed = () => {
      const p = live.current;
      fx.setEmitters(p.cards.map((c, k) => {
        const el = cardRefs.current[k];
        const r = el?.getBoundingClientRect() ?? { left: -999, top: -999, width: 0, height: 0 };
        const cer = p.ceremony;
        const shown = revealed.current[k] !== false;
        const power = !shown ? 0 : cer ? (cer.i === c.i ? 2.6 : 0) : p.selected === c.i ? 1.8 : hover.current === c.i ? 1.4 : p.sealed !== null && p.sealed !== c.i ? 0.5 : 1;
        return { theme: c.theme, rect: r, power };
      }));
    };
    feed();
    const t = window.setInterval(feed, 200);
    return () => { window.clearInterval(t); fx.dispose(); fxRef.current = null; };
  }, [reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (fxRef.current) fxRef.current.density = density; }, [density]);

  // ---------------------------------------------------------------- the deal (sounds and reveal bursts on the CSS timeline)
  useEffect(() => {
    setPhase(entrance);
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    if (entrance === 'deal' && !reduced) {
      revealed.current = cards.map(() => false);
      cards.forEach((c, k) => {
        const t0 = TOSS + k * STAGGER;
        at(t0 + 60, () => playUiFile('throw_whoosh', null, { volume: 0.28 }));
        // THUD: the card slaps onto the table; dust puffs out from under its edges
        at(t0 + LAND, () => {
          playUiFile('impact_heavy', 'impact_heavy', { volume: 0.8 });
          const el = slotRefs.current[k];
          if (el) fxRef.current?.dust(c.theme, el.getBoundingClientRect());
        });
        at(t0 + LAND + TURN, () => playUiFile('throw_whoosh', null, { volume: 0.16 }));
        // face up: a few motes of its dungeon catch the light
        at(t0 + LAND + TURN + 300, () => {
          revealed.current[k] = true;
          const el = cardRefs.current[k];
          if (el) fxRef.current?.burst(c.theme, el.getBoundingClientRect(), 16, 0, 36);
        });
      });
    } else revealed.current = cards.map(() => true);
    // (dev: /dev/fate?scrub holds the deal open so a frame can be inspected)
    const hold = process.env.NODE_ENV !== 'production' && !!(window as unknown as { __fateHold?: boolean }).__fateHold;
    if (!reduced) { if (!hold) at(entrance === 'deal' ? DEAL_MS : 700, () => setPhase('idle')); }
    else setPhase('idle');
    // focus the first card once it can be read (keyboard and pad users land on the choice)
    at(entrance === 'deal' && !reduced ? TOSS + LAND + TURN + 300 : 120, () => {
      const p = live.current;
      if (p.ceremony || p.sealed !== null) return;
      const k = p.selected ?? 0;
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body || !rootRef.current?.contains(active)) cardRefs.current[k]?.focus({ preventScroll: true });
    });
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [dealKey, entrance, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- my seal: a stamp, a small burst
  const lastSealed = useRef<number | null>(sealed);
  useEffect(() => {
    if (sealed !== null && lastSealed.current === null && !ceremony) {
      const el = cardRefs.current[sealed], c = cards.find((x) => x.i === sealed);
      if (el && c) window.setTimeout(() => fxRef.current?.burst(c.theme, el.getBoundingClientRect(), 46, 0, 80), 230);
    }
    lastSealed.current = sealed;
  }, [sealed]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- the binding ceremony
  useEffect(() => {
    if (!ceremony) return;
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const chosen = cards.find((c) => c.i === ceremony.i);
    if (!reduced) {
      playUiFile('kill_burn', null, { volume: 0.4 });
      for (const step of [80, 260, 440, 620]) at(step, () => cards.forEach((c, k) => {
        if (c.i === ceremony.i) return;
        const el = cardRefs.current[k];
        if (el) fxRef.current?.burn(c.theme, el.getBoundingClientRect(), 16);
      }));
      at(380, () => {
        play('fate_commit');
        const k = cards.findIndex((c) => c.i === ceremony.i);
        const el = cardRefs.current[k];
        if (el && chosen) fxRef.current?.burst(chosen.theme, el.getBoundingClientRect(), 160, 0, 130);
      });
      at(520, () => play('vote_lock', 0.8));
    } else play('fate_commit');
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [ceremony?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- cursor tilt (one rAF per move)
  const tiltRaf = useRef(0);
  const onMove = (k: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (reduced || live.current.ceremony || e.pointerType !== 'mouse') return;
    const el = slotRefs.current[k];
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    cancelAnimationFrame(tiltRaf.current);
    tiltRaf.current = requestAnimationFrame(() => {
      el.style.setProperty('--ry', `${((x - 0.5) * 14).toFixed(2)}deg`);
      el.style.setProperty('--rx', `${((0.5 - y) * 10).toFixed(2)}deg`);
      el.style.setProperty('--gx', `${Math.round(x * 100)}%`);
      el.style.setProperty('--gy', `${Math.round(y * 100)}%`);
    });
  };
  const onLeave = (k: number) => {
    hover.current = null;
    cancelAnimationFrame(tiltRaf.current);
    const el = slotRefs.current[k];
    if (el) { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); }
  };

  const stateOf = (i: number): SlotState => (ceremony ? (ceremony.i === i ? 'chosen' : 'lost') : 'idle');
  const click = (i: number) => {
    const p = live.current;
    if (p.ceremony || p.sealed !== null) return;
    if (p.selected === i) p.onChoose(i); else p.onSelect(i);
  };
  const onKey = (e: React.KeyboardEvent, k: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const n = cards.length, j = (k + (e.key === 'ArrowRight' ? 1 : n - 1)) % n;
    cardRefs.current[j]?.focus();
    if (live.current.sealed === null && !live.current.ceremony) props.onSelect(cards[j]!.i);
  };

  return (
    <div ref={rootRef} className={styles.spread} role="dialog" aria-modal="true" aria-label="Choose your Fate"
      data-entrance={phase} data-ceremony={ceremony ? 'bound' : undefined} data-leaving={leaving ? '' : undefined} data-reduced={reduced ? '' : undefined}>
      <div className={styles.backdrop} onClick={() => props.onDismiss?.()} aria-hidden="true" />
      <header className={styles.head}>{props.header}</header>
      <div ref={stageRef} className={styles.stage}>
        <i className={styles.table} aria-hidden="true" />
        {/* behind the cards, over the table: ambient motes and the landing dust (it shows once it clears a card) */}
        <canvas ref={backRef} className={styles.fxBack} aria-hidden="true" />
        <div className={styles.row} role="radiogroup" aria-label="Fate Cards">
          {cards.map((m, k) => {
            const a = art[k]!;
            const rarity = cardRarity(m.card);
            const st = stateOf(m.i);
            const sel = selected === m.i && !ceremony;
            const showSeal = (ceremony ? ceremony.i === m.i : sealed === m.i);
            const mf = (side: 'gift' | 'price') => m.fc?.mechanics.find((x) => x.side === side);
            const vars = {
              '--i': k, '--glow': a.glow, '--glow2': a.glow2, '--rar': RARITIES[rarity].color,
              '--fa-frame': a.frame, '--fa-panel': a.panel, '--fa-panel-hex': a.panelHex, '--fa-window': a.window, '--fa-vista': a.vista,
              '--fa-corner-top': a.cornerTop, '--fa-corner-bottom': a.cornerBottom, '--fa-crest': a.crest, '--fa-foot': a.foot,
              '--fa-fringe': a.fringe ?? 'none', '--fa-seal': a.seal, '--fa-sigil': a.sigil, '--fa-medal': medals[k],
              '--fa-rule': rarity === 'mythic' ? 'var(--fa-rule-m0)' : `var(--fa-rule-${rarity})`,
              '--seal-delay': ceremony ? '0.42s' : '0s',
            } as React.CSSProperties;
            return (
              <div key={`${dealKey}:${m.i}`} ref={(el) => { slotRefs.current[k] = el; }} className={`${styles.slot} ${styles[`r-${rarity}`] ?? ''}`} style={vars}
                data-state={st} data-sel={sel ? '' : undefined}
                onPointerEnter={() => { hover.current = m.i; }} onPointerMove={(e) => onMove(k, e)} onPointerLeave={() => onLeave(k)}>
                <i className={styles.rays} aria-hidden="true" />
                <i className={styles.shadow} aria-hidden="true" />
                <div className={styles.fly}>
                    <div className={styles.lift}>
                      <div className={styles.tilt}>
                        <div className={styles.flip}>
                          <div className={styles.front}>
                            <div className={styles.cardBox}>
                              <button ref={(el) => { cardRefs.current[k] = el; }} type="button" role="radio" aria-checked={selected === m.i}
                                className={styles.card} data-fate-card={m.i} data-sfx={sealed !== null || ceremony ? 'none' : selected === m.i ? 'none' : 'vote_cast'}
                                aria-label={ariaFor(m)} onClick={() => click(m.i)} onDoubleClick={() => { if (!live.current.ceremony && live.current.sealed === null) props.onChoose(m.i); }}
                                onKeyDown={(e) => onKey(e, k)}>
                                <span className={styles.vista} aria-hidden="true">
                                  {a.fringe && <i className={styles.fringe} />}
                                  {m.boss && <b className={styles.lair}>Boss lair</b>}
                                </span>
                                <span ref={(el) => { placeRefs.current[k] = el; }} className={styles.place}><i aria-hidden="true" /><b>{m.themeName}</b></span>
                                <span className={styles.body}>
                                  <span ref={(el) => { bodyRefs.current[k] = el; }} className={styles.bodyIn}>
                                  <span className={styles.cardHead}>
                                    <span className={styles.icon}><CardIcon cardId={m.card.id} size={32} /></span>
                                    <span className={styles.names}>
                                      <span className={styles.name}>{m.card.name}</span>
                                      <span className={styles.rarity}>
                                        {RARITIES[rarity].name}
                                        {m.fc && m.fc.warnings.length > 0 && <span style={{ color: 'var(--warn)' }}> · ! danger</span>}
                                      </span>
                                    </span>
                                  </span>
                                  {m.blessed && <span className={`${styles.blessed} prism-text`}><BlessingIcon size={16} /> Blessed: price lifted</span>}
                                  <span className="fv-section gift">
                                    <span className="fv-label">Gift</span>
                                    {m.card.boon && <MechLine eff={m.card.boon} side="gift" mf={mf('gift')} />}
                                    {m.card.positive && <StatLine eff={m.card.positive} side="gift" na={m.fc?.positive ? !m.fc.positive.applicable : false} />}
                                  </span>
                                  <span className={`fv-section price ${m.blessed ? styles.struck : ''}`}>
                                    <span className="fv-label">{m.blessed ? 'Price · lifted' : 'Price'}</span>
                                    {m.card.bane && <MechLine eff={m.card.bane} side="price" mf={mf('price')} />}
                                    {m.card.negative && <StatLine eff={m.card.negative} side="price" />}
                                  </span>
                                  {m.fc && m.fc.warnings.length > 0 && <span className={styles.warn}>! {m.fc.warnings[0]}</span>}
                                  <span className={styles.flavor}>{m.card.flavor}</span>
                                  <span className={styles.voters}>
                                    {m.voters.map((v) => (
                                      <span key={v.slot} className={styles.vote} style={{ ['--acc' as string]: v.accent }} data-locked={v.locked ? '' : undefined} data-me={v.me ? '' : undefined}
                                        title={v.locked ? `${v.name} sealed this card` : v.standing ? `${v.name} stands in this door` : `${v.name} leans to this card`}>
                                        {v.locked && <i aria-hidden="true" />}{v.name}{v.standing ? ' ⌂' : ''}
                                      </span>
                                    ))}
                                  </span>
                                  {m.hold > 0 && <span className={styles.hold} role="progressbar" aria-label="The party gathers in this door" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(m.hold * 100)}><i style={{ width: `${m.hold * 100}%` }} /></span>}
                                  </span>
                                </span>
                                <span className={styles.shine} aria-hidden="true"><i className={styles.sheen} /><i className={styles.glare} /></span>
                              </button>
                              <i className={`${styles.orn} ${styles.corner} ${styles.tl}`} aria-hidden="true" />
                              <i className={`${styles.orn} ${styles.corner} ${styles.tr}`} aria-hidden="true" />
                              <i className={`${styles.orn} ${styles.corner} ${styles.bl}`} aria-hidden="true" />
                              <i className={`${styles.orn} ${styles.corner} ${styles.br}`} aria-hidden="true" />
                              <span className={styles.crestBox} aria-hidden="true"><i className={styles.crest} /></span>
                              <i className={styles.medal} aria-hidden="true" />
                              <i className={`${styles.orn} ${styles.footOrn}`} aria-hidden="true" />
                              <span className={styles.key} aria-hidden="true">{m.i + 1}</span>
                              {showSeal && <span key={ceremony ? 'bound' : 'sealed'} className={styles.seal} aria-hidden="true"><i /><b>{ceremony ? 'Bound' : 'Sealed'}</b></span>}
                            </div>
                            <i className={styles.burnEdge} aria-hidden="true" />
                          </div>
                          <div className={styles.back} aria-hidden="true"><i className={styles.emblem} /></div>
                        </div>
                      </div>
                    </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <footer className={styles.foot}>{props.footer}</footer>
      <canvas ref={frontRef} className={styles.fxFront} aria-hidden="true" />
      {ceremony && flashes && !reduced && <div key={ceremony.at} className={styles.flash} style={{ ['--glow' as string]: art[cards.findIndex((c) => c.i === ceremony.i)]?.glow ?? '#fff' }} aria-hidden="true" />}
    </div>
  );
}

export const fateCardStyles = styles;
