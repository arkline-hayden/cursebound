'use client';

import { useEffect, useRef, useState } from 'react';
import { FAMILIES, MECHANIC_BY_ID, RARITIES, STAT_BY_ID, cardById, cardRarity, mechanicText, type CardDef, type CardEffect, type MechanicEffect } from '@cursebound/content';
import { B, formatMechanicValue, type CardForecast, type FValue, type MechanicForecast } from '@cursebound/simulation';
import { deadlineSeconds, netStore, type GameConnection } from '@/lib/net';
import { useStore } from '@/lib/store';
import { changeLabel, fmt, pct, score, seconds } from '@/lib/format';
import { CardIcon, ClassEmblem } from './icons';

// Card faces, keyword chips and the Forecast detail are shared with the in-world door vote (DoorPanel.tsx), which
// replaced this full-screen vote in the main flow; FateVote stays as a fallback / reference screen.
// FATE_OFFER / VOTING (REQ VOTE01, LEDGER01, PRD §4.2, §10.2, §16.1): three cards that read at a glance — rarity
// frame (silver / gold / prismatic crimson), a GIFT and a PRICE section with big numbers and keyword chips, the
// per-card Forecast one key away (F). Warnings never disable a selection control. Keys: 1 2 3 choose, Enter seals,
// F toggles the forecast, Esc closes it. Fonts use the type tokens only (integer pixel sizes).

export const cardDef = (id: string): CardDef | undefined => cardById(id);
export const signed = (p: string) => (p.startsWith('-') ? `−${p.slice(1)}%` : `+${p}%`);
const NUMERALS = ['I', 'II', 'III'];

function Delta({ v, invert = false, kind }: { v: FValue; invert?: boolean; kind?: 'sec' }) {
  const label = changeLabel(v.after, v.before);
  const up = label.startsWith('×') && parseFloat(label.slice(1)) > 1;
  const down = label.startsWith('×') && parseFloat(label.slice(1)) < 1;
  const good = invert ? down : up;
  const bad = invert ? up : down;
  const f = kind === 'sec' ? seconds : (x: string) => fmt(x);
  return (
    <span className="fd-delta">
      {f(v.before)} → <b>{f(v.after)}</b>{' '}
      <span className={good ? 'pos' : bad ? 'neg' : 'faint'}>{label}{good ? ' ▲' : bad ? ' ▼' : ''}</span>
      {v.kind === 'estimate' && <span className="faint"> est.</span>}
    </span>
  );
}

// ---------------- card face ----------------

export function StatLine({ eff, side, na }: { eff: CardEffect; side: 'gift' | 'price'; na?: boolean }) {
  return (
    <span className={`fv-stat ${side}`}>
      <span className="fv-num">{signed(eff.percent)}</span>
      <span className="fv-what">{STAT_BY_ID[eff.stat]?.name ?? eff.stat}{na && <span className="fv-na">no effect on your build</span>}</span>
    </span>
  );
}

export function MechLine({ eff, side, mf }: { eff: MechanicEffect; side: 'gift' | 'price'; mf?: MechanicForecast }) {
  const def = MECHANIC_BY_ID[eff.id];
  if (!def) return null;
  const value = mf?.value.after ?? formatMechanicValue(def, B(eff.magnitude));
  const short = mf?.short ?? mechanicText(def, def.short, value);
  return (
    <span className={`fv-mech ${side}`} style={{ ['--kw' as string]: def.color }}>
      <span className="fv-kwrow">
        <span className="fv-kw">
          <span className="fv-kw-name">{def.name}</span>
          {mf && mf.stacks.after > 1 && <span className="fv-stack" title={`${mf.stacks.after} copies, stacked multiplicatively`}>×{mf.stacks.after}</span>}
        </span>
        {mf && mf.value.before && <span className="fv-was">was {mf.value.before}</span>}
        {mf && !mf.applicable && <span className="fv-na">no effect yet</span>}
      </span>
      <span className="fv-line">{short}</span>
    </span>
  );
}

export function CardFace({ card, fc, index, children }: { card: CardDef; fc?: CardForecast; index?: number; children?: React.ReactNode }) {
  const rarity = cardRarity(card);
  const mf = (side: 'gift' | 'price') => fc?.mechanics.find((m) => m.side === side);
  return (
    <>
      {rarity === 'mythic' && <span className="fv-aura" aria-hidden="true">{Array.from({ length: 10 }, (_, k) => <i key={k} />)}</span>}
      <span className="fv-head">
        <span className="fv-icon"><CardIcon cardId={card.id} size={48} /></span>
        <span className="fv-title">
          <span className="fv-name">{card.name}</span>
          <span className="fv-rarity">{index !== undefined ? `${NUMERALS[index]} · ` : ''}{RARITIES[rarity].name}{fc && fc.warnings.length > 0 && <span className="fv-danger" title={fc.warnings[0]}> ! danger</span>}</span>
        </span>
        {index !== undefined && <span className="kbd fv-key">{index + 1}</span>}
      </span>
      <span className="fv-section gift">
        <span className="fv-label">Gift</span>
        {card.boon && <MechLine eff={card.boon} side="gift" mf={mf('gift')} />}
        {card.positive && <StatLine eff={card.positive} side="gift" na={fc?.positive ? !fc.positive.applicable : false} />}
      </span>
      <span className="fv-section price">
        <span className="fv-label">Price</span>
        {card.bane && <MechLine eff={card.bane} side="price" mf={mf('price')} />}
        {card.negative && <StatLine eff={card.negative} side="price" />}
      </span>
      {fc && fc.warnings.length > 0 && <span className="fv-warn">! {fc.warnings[0]}</span>}
      <span className="fv-flavor">{card.flavor}</span>
      {children}
    </>
  );
}

function ariaFor(card: CardDef, i: number, fc: CardForecast): string {
  const parts = [`Card ${i + 1}: ${card.name}, ${RARITIES[cardRarity(card)].name}.`, 'Gift:'];
  for (const m of fc.mechanics.filter((x) => x.side === 'gift')) parts.push(`${m.name}: ${m.short}.`);
  if (card.positive) parts.push(`${signed(card.positive.percent)} ${STAT_BY_ID[card.positive.stat]?.name}.`);
  parts.push('Price:');
  for (const m of fc.mechanics.filter((x) => x.side === 'price')) parts.push(`${m.name}: ${m.short}.`);
  if (card.negative) parts.push(`${signed(card.negative.percent)} ${STAT_BY_ID[card.negative.stat]?.name}.`);
  parts.push(fc.consequence);
  return parts.join(' ');
}

// ---------------- forecast drawer ----------------

function RulesForecast({ c }: { c: CardForecast }) {
  if (!c.mechanics.length) return null;
  return (
    <section className="fd-sec">
      <h3 className="fd-h">Rules this card binds</h3>
      {c.mechanics.map((m) => (
        <div key={m.id + m.side} className={`fd-rule ${m.side}`} style={{ ['--kw' as string]: m.color }}>
          <div className="fd-rule-head">
            <span className="fv-kw"><span className="fv-kw-name">{m.name}</span></span>
            <span className={m.side === 'gift' ? 'pos' : 'neg'}>{m.side === 'gift' ? 'boon' : 'bane'}</span>
            <span className="fd-change">{m.change}{m.stacks.after > 1 ? '' : ` · ${m.value.after}`}</span>
          </div>
          <p className="fd-text">{m.text}</p>
          {m.details.length > 0 && <ul className="fd-list">{m.details.map((d, k) => <li key={k}>{d}</li>)}</ul>}
          {!m.applicable && <p className="fd-text faint">{m.applicability}</p>}
          <p className="fd-text faint">Stacking: {m.stacking}</p>
        </div>
      ))}
    </section>
  );
}

export function ForecastDetail({ c }: { c: CardForecast }) {
  return (
    <div className="fd-body">
      <RulesForecast c={c} />
      {c.factorChanges.length > 0 && (
        <section className="fd-sec">
          <h3 className="fd-h">Fate factors</h3>
          {c.factorChanges.map((f) => <div key={f.stat}>{f.name}: <Delta v={{ before: f.before, after: f.after, kind: 'static' }} invert={f.stat.startsWith('enemy') || f.stat.startsWith('encounter')} /></div>)}
        </section>
      )}
      <section className="fd-sec">
        <h3 className="fd-h">Per player (exact static unless marked est.)</h3>
        <table className="data">
          <thead><tr><th>Player</th><th>Max health</th><th>Raw DPS</th><th>Hits to down</th></tr></thead>
          <tbody>{c.players.map((p) => (
            <tr key={p.slot}>
              <td><ClassEmblem classId={p.classId as 'vanguard'} size={16} /> {p.name}</td>
              <td><Delta v={p.maxHp} /></td>
              <td><Delta v={p.rawDps} /></td>
              <td><Delta v={p.hitsToDown} /></td>
            </tr>
          ))}</tbody>
        </table>
        {c.players.map((p) => (
          <details key={p.slot}>
            <summary>{p.name}: more values</summary>
            <ul className="fd-list">
              <li>Current health: <Delta v={p.hp} /></li>
              <li>Incoming hit: <Delta v={p.incomingHit} invert /></li>
              <li>Damage per hit: <Delta v={p.hitDamage} /> · expected <Delta v={p.expectedHit} /></li>
              <li>Attack frequency: <Delta v={p.attackFreq} /> /s · critical chance {pct(p.critChance.before)} → <b>{pct(p.critChance.after)}</b></li>
              <li>Armor: <Delta v={p.armor} /> · healing factor <Delta v={p.healing} /></li>
              <li>Movement speed: <Delta v={p.moveSpeed} /> · signature cooldown <Delta v={p.cooldownSec} kind="sec" invert /></li>
              <li>Cooldown recovery: ×<Delta v={p.recoveryRate} /></li>
              <li>Survival without healing: <Delta v={p.survivalSec} kind="sec" /></li>
              <li>{p.measuredDps ? <>Measured DPS (last {p.measuredDps.sampleSec}s): {fmt(p.measuredDps.value)}{p.estimatedDps && <> → est. <b>{fmt(p.estimatedDps.after)}</b></>}</> : <>Insufficient combat sample — static model only.</>}</li>
            </ul>
          </details>
        ))}
      </section>
      <section className="fd-sec">
        <h3 className="fd-h">Next round: {c.enemy.reference}</h3>
        <ul className="fd-list">
          <li>Enemy health: <Delta v={c.enemy.health} invert /></li>
          <li>Regeneration per second: <Delta v={c.enemy.regenPerSec} invert /></li>
          <li>Damage taken factor (armor): <Delta v={c.enemy.armorFactor} /></li>
          <li>Telegraph window: <Delta v={c.enemy.telegraphSec} kind="sec" /></li>
          <li>Logical enemy count: <Delta v={c.enemy.logicalCount} invert /></li>
          <li>Party net DPS vs reference: {c.enemy.noNetProgress.after ? <b className="neg">model predicts no net progress</b> : <Delta v={c.enemy.netPartyDps} />}</li>
          <li>Idealized kill time: {c.enemy.noNetProgress.after ? <b className="neg">no net progress</b> : <Delta v={c.enemy.killTimeSec} kind="sec" invert />}</li>
          <li>Next round points: <Delta v={c.score.nextRoundPoints} /> (pressure ×{fmt(c.score.pressure.after)})</li>
        </ul>
      </section>
      <details>
        <summary>Assumptions and limits</summary>
        <ul className="fd-list faint">{c.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
      </details>
    </div>
  );
}

// ---------------- screen ----------------

export function FateVote({ net, onLedger }: { net: GameConnection; onLedger: () => void }) {
  const offer = useStore(netStore, (s) => s.offer);
  const votes = useStore(netStore, (s) => s.votes);
  const myVote = useStore(netStore, (s) => s.myVote);
  const phase = useStore(netStore, (s) => s.phase);
  const commit = useStore(netStore, (s) => s.commit);
  const slot = useStore(netStore, (s) => s.slot);
  const serverTick = useStore(netStore, (s) => s.serverTick);
  const [detail, setDetail] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const lockRef = useRef<HTMLButtonElement | null>(null);
  const [, setNow] = useState(0);
  useEffect(() => { const t = setInterval(() => setNow((x) => x + 1), 250); return () => clearInterval(t); }, []);
  useEffect(() => { setSelected(myVote.cardSlot); }, [myVote.cardSlot, offer?.offerId]);
  useEffect(() => { setDetail(null); }, [offer?.offerId]);
  useEffect(() => { if (offer && !myVote.locked) setTimeout(() => cardRefs.current[0]?.focus(), 450); }, [offer?.offerId]); // eslint-disable-line react-hooks/exhaustive-deps
  const castSelect = (i: number) => { setSelected(i); if (!myVote.locked) net.vote(i, false); };
  const lock = () => { if (selected !== null && !myVote.locked) net.vote(selected, true); };
  useEffect(() => {
    // 1/2/3 choose, Enter seals, F toggles the forecast, Escape closes it
    const on = (e: KeyboardEvent) => {
      if (!offer || phase?.phase !== 'VOTING') return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].includes(e.code)) {
        const i = Number(e.code.slice(-1)) - 1;
        castSelect(i); cardRefs.current[i]?.focus();
        if (detail !== null) setDetail(i);
      } else if (e.code === 'Escape' && detail !== null) setDetail(null);
      else if (e.code === 'KeyF' && selected !== null) setDetail(detail === null ? selected : null);
      else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && selected !== null && !(e.target as HTMLElement)?.closest?.('.fate-card, button, summary')) { e.preventDefault(); lock(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });
  if (!phase) return null;
  if (phase.phase === 'FATE_COMMIT' || (!offer && commit)) {
    const card = commit ? cardDef(commit.cardId) : undefined;
    const tie = commit?.tieEvidence as { draw: number | null; zeroVotes: boolean } | undefined;
    return (
      <div className="fate-screen" role="status" aria-live="assertive">
        {card ? (
          <>
            <div className="fate-bound-label">The party is bound to</div>
            <div className={`fate-slot r-${cardRarity(card)}`} style={{ ['--fam' as string]: FAMILIES[card.family]?.color ?? '#e8b64a', ['--rar' as string]: RARITIES[cardRarity(card)].color }}>
              <div className={`fate-card bound r-${cardRarity(card)}`} aria-checked="true">
                <CardFace card={card} />
              </div>
            </div>
            {tie && tie.draw !== null && <p className="fate-note warn">{tie.zeroVotes ? 'No votes cast: fate chose by the seeded draw' : 'Tied vote: broken by the seeded draw'}</p>}
            <p className="fate-note">Sealed. It takes hold next round.</p>
          </>
        ) : <p className="fate-title">The threads are woven…</p>}
      </div>
    );
  }
  if (!offer) return <div className="fate-screen" role="status"><p className="fate-title">Drawing three Fates…</p></div>;
  const fc = offer.forecast;
  const secs = deadlineSeconds(offer.deadlineTick, serverTick);
  const voters = votes?.votes ?? [];
  const nameOfSlot = (s: number) => phase.players[s]?.name ?? `P${s + 1}`;
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); cardRefs.current[(i + 1) % 3]?.focus(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); cardRefs.current[(i + 2) % 3]?.focus(); }
    if (e.key === 'Enter' && selected === i) { e.preventDefault(); lock(); }
  };
  const lockedCount = voters.filter((v) => v.locked).length;
  const selCard = selected !== null ? cardDef(offer.cardIds[selected]) : undefined;
  const detailCard = detail !== null ? cardDef(offer.cardIds[detail]) : undefined;
  return (
    <div className="fate-screen">
      <div className="fate-head">
        <h2 className="fate-title">Choose your Fate</h2>
        <div className="fate-sub">
          <span>after round {offer.round} · takes hold in round {fc.nextRound}{fc.nextIsBoss ? ' (boss)' : ''}</span>
          {secs !== null ? <span className="chip warn" role="timer" aria-label={`${Math.ceil(secs)} seconds left to vote`}>{Math.ceil(secs)}s</span> : <span className="chip">no timer</span>}
          <span className="chip gold">score {score(phase.scoreText)}</span>
          <button className="btn small" onClick={onLedger}>Ledger</button>
        </div>
      </div>

      <div className="fate-row" role="radiogroup" aria-label="Fate Cards">
        {offer.cardIds.map((id, i) => {
          const card = cardDef(id);
          const c = fc.cards[i];
          if (!card || !c) return null;
          const rarity = cardRarity(card);
          const who = voters.filter((v) => v.cardSlot === i);
          return (
            <div key={id + i} className={`fate-slot r-${rarity}`} style={{ ['--fam' as string]: FAMILIES[card.family]?.color ?? '#e8b64a', ['--rar' as string]: RARITIES[rarity].color, animation: `cardIn 0.5s steps(8) ${i * 0.12}s both` }}>
              <button ref={(el) => { cardRefs.current[i] = el; }} role="radio" aria-checked={selected === i} className={`fate-card r-${rarity}`}
                onKeyDown={(e) => onKey(e, i)} onClick={() => castSelect(i)} aria-label={ariaFor(card, i, c)}>
                <CardFace card={card} fc={c} index={i}>
                  <span className="fate-seals">
                    {who.map((v) => <span key={v.slot} className={`seal ${v.locked ? 'locked' : ''}`}>{nameOfSlot(v.slot)}{v.locked ? ' ✦' : ''}</span>)}
                  </span>
                </CardFace>
              </button>
            </div>
          );
        })}
      </div>

      <div className="fate-actions">
        <div className="fate-buttons">
          <button className="btn" aria-expanded={detail !== null} disabled={selected === null} onClick={() => selected !== null && setDetail(detail === null ? selected : null)}>
            Forecast <span className="kbd">F</span>
          </button>
          <button ref={lockRef} className="btn primary big fate-seal" disabled={selected === null || myVote.locked || myVote.pending} onClick={lock}>
            {myVote.locked ? 'Fate sealed ✦' : selCard ? `Seal ${selCard.name}` : 'Choose a card'}
          </button>
        </div>
        <div className="fate-status" role="status" aria-live="polite">
          {myVote.locked ? 'Your vote is locked and accepted by the authority.' : myVote.pending ? 'Sending vote…' : 'Every card stays selectable, however dangerous.'}
          {phase.players.length > 1 && <span> · {lockedCount}/{phase.players.filter((p) => p.connected).length} sealed · ties use a seeded draw</span>}
          <span className="faint"> · 1 2 3 choose · Enter seals · F forecast</span>
        </div>
      </div>

      {detail !== null && detailCard && fc.cards[detail] && (
        <aside className="frame fate-drawer" role="dialog" aria-modal="false" aria-label={`Forecast for ${detailCard.name}`}>
          <div className="fd-top">
            <div>
              <div className="fd-rarity" style={{ color: RARITIES[cardRarity(detailCard)].color }}>{RARITIES[cardRarity(detailCard)].name}</div>
              <h2 className="fd-title">{detailCard.name}</h2>
            </div>
            <button className="btn small" onClick={() => setDetail(null)}>Close <span className="kbd">Esc</span></button>
          </div>
          <p className="fd-text">{fc.cards[detail].consequence}</p>
          {fc.cards[detail].warnings.length > 0 && <ul className="fd-list fd-warn">{fc.cards[detail].warnings.map((w, k) => <li key={k}>{w}</li>)}</ul>}
          <ForecastDetail c={fc.cards[detail]} />
        </aside>
      )}
      <span className="sr-only">Your seat {slot + 1}</span>
    </div>
  );
}
