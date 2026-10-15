'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BOUNTY_BY_ID, DERIVED_NODES, LEGENDARY_BY_ID, MECHANIC_BY_ID, NODE_BY_ID, STAT_BY_ID, cardById } from '@cursebound/content';
import type { LedgerMechanic, LedgerStat } from '@cursebound/simulation';
import { netStore, type GameConnection } from '@/lib/net';
import { useStore } from '@/lib/store';
import { big, exact, fmt, score } from '@/lib/format';
import { CardIcon, StatIcon } from './icons';

// Fate Ledger (REQ LEDGER01, PRD §10.1): bound rules (boons and banes with copies and effective magnitude), six
// readable stat groups, party overview and per-player tabs, ordered calculation nodes per stat, source cards,
// timeline, dependency cascade and search. Labels whether a value is a static calculation, a current measured rate
// or a scenario estimate. Fonts use the type tokens only.

const GROUP_ICON: Record<string, string> = { party_damage: 'damage', health_recovery: 'health', enemy_health: 'enemy_health', enemy_offense: 'enemy_offense', mobility_projectiles: 'mobility', score_growth: 'score' };
// daily bounty effects are recorded as card 'bounty:<modifier>' (simulation bounty.ts)
const cardName = (id: string) => cardById(id)?.name ?? (id.startsWith('bounty:') ? `Bounty: ${BOUNTY_BY_ID[id.slice(7)]?.name ?? id.slice(7)}` : id);

function LogBar({ value }: { value: string }) {
  // normalized log-scale bar alongside the absolute value (explicitly labelled)
  const l = big(value).log10();
  const w = Number.isFinite(l) ? Math.max(2, Math.min(100, ((l + 2) / 12) * 100)) : 0;
  return <span title="log scale" className="logbar"><span style={{ width: `${w}%` }} /></span>;
}

function magnitudeText(id: string, m: string) {
  const def = MECHANIC_BY_ID[id];
  if (!def) return m;
  return def.unit === 'multiplier' ? `×${m}` : `${+(Number(m) * 100).toFixed(2)}%`;
}

function MechanicRow({ m }: { m: LedgerMechanic }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`lg-mech ${m.kind}`} style={{ ['--kw' as string]: m.color }}>
      <button onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="fv-kw"><span className="fv-kw-name">{m.name}</span>{m.stacks > 1 && <span className="fv-stack">×{m.stacks}</span>}</span>
        <span className="lg-mech-val">{m.value}</span>
        <span className="lg-mech-short">{m.short}</span>
        <span aria-hidden="true" className="gold-text">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="lg-detail">
          <p>{m.text}</p>
          <p className="faint">Applies to: {m.applicability}</p>
          <p className="faint">Stacking: {m.stacking} {m.stacks} cop{m.stacks === 1 ? 'y' : 'ies'} bound.</p>
          <div className="lg-sources">Sources: {m.sources.map((s) => (
            <span key={s.cardId + s.magnitude} className="chip"><CardIcon cardId={s.cardId} size={16} /> {cardName(s.cardId)} ×{s.count} at {magnitudeText(m.id, s.magnitude)}</span>
          ))}</div>
        </div>
      )}
    </li>
  );
}

function StatRow({ s, tab, onTrace }: { s: LedgerStat; tab: number | 'party'; onTrace: (stat: string) => void }) {
  const [open, setOpen] = useState(false);
  const pp = tab === 'party' ? s.perPlayer : s.perPlayer.filter((x) => x.slot === tab);
  return (
    <li className="stat-row">
      <button onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="grow"><b>{s.name}</b> <span className="faint">{s.scope}</span></span>
        <span className="num">Fate ×{fmt(s.fateFactor, 3)}</span>
        {pp.length > 0 && <span className="num lg-wide">{pp.map((p) => fmt(p.result)).join(' / ')}</span>}
        {s.representative && <span className="num lg-wide">{fmt(s.representative.value)}<LogBar value={s.representative.value} /></span>}
        <span aria-hidden="true" className="gold-text">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="lg-detail">
          <p className="muted">{s.semantics} <span className="chip">static calculation</span></p>
          <p className="faint">Applies to: {s.applicability}</p>
          {pp.map((p) => (
            <div key={p.slot} className="num">
              <b>P{p.slot + 1}</b>: base {exact(p.base)} → tree ×{fmt(p.tree, 4)} → mastery ×{fmt(p.mastery, 4)}{p.gear && p.gear !== '1' ? <> → gear ×{fmt(p.gear, 4)}</> : null} → Fate ×{fmt(p.fate, 4)} = <b>{fmt(p.result)}</b> <span className="faint">({exact(p.result)})</span>
              {p.gearSources && p.gearSources.length > 0 && <div className="faint" style={{ color: '#ff8a1e' }}>Gear: {p.gearSources.map((g) => `${LEGENDARY_BY_ID[g.item]?.name ?? g.item} (×${g.factor})`).join(', ')}</div>}
              {p.treeSources.length > 0 && <div className="faint">Tree: {p.treeSources.map((t) => `${NODE_BY_ID[t.node]?.name ?? t.node} r${t.rank} (×${t.factor}/rank)`).join(', ')}</div>}
            </div>
          ))}
          {s.representative && <div>{s.representative.label}: <b>{fmt(s.representative.value)}</b> <span className="faint">({exact(s.representative.value)})</span></div>}
          {s.sources.length > 0 ? (
            <div className="lg-sources">Sources: {s.sources.map((src) => <span key={src.cardId} className="chip"><CardIcon cardId={src.cardId} size={16} /> {cardName(src.cardId)} ×{src.count} → ×{shortFactor(src.factor)}</span>)}</div>
          ) : <div className="faint">No Fate sources yet.</div>}
          <button className="btn small ghost" onClick={() => onTrace(s.stat)}>Trace consequences</button>
        </div>
      )}
    </li>
  );
}

function shortFactor(f: string) {
  // canonical 'm e x' text → readable factor
  const m = /^([0-9.]+)e(-?\d+)$/.exec(f);
  if (!m) return f;
  const e = Number(m[2]);
  if (Math.abs(e) < 6) return String(Math.round(Number(m[1]) * 10 ** e * 10000) / 10000);
  return `${m[1]}e${m[2]}`;
}

export function Ledger({ net, onClose }: { net: GameConnection; onClose: () => void }) {
  const view = useStore(netStore, (s) => s.ledger);
  const phase = useStore(netStore, (s) => s.phase);
  const [tab, setTab] = useState<number | 'party'>('party');
  const [q, setQ] = useState('');
  const [trace, setTrace] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => { net.requestLedger(page); }, [page, net]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const cascade = useMemo(() => {
    if (!trace || !view) return [];
    const out: string[][] = [];
    const walk = (node: string, path: string[]) => {
      const next = view.graph.filter((g) => g.from === node).map((g) => g.to);
      const nexts = next.length ? next : (DERIVED_NODES[node]?.affects ?? []);
      if (!nexts.length || path.length > 6) { out.push(path); return; }
      for (const n of nexts) walk(n, [...path, n]);
    };
    walk(trace, [trace]);
    return out.slice(0, 12);
  }, [trace, view]);
  // one timeline: stat effects of this page plus the rule bindings in the same span
  const timeline = useMemo(() => {
    if (!view) return [];
    const stats = view.timeline.map((t) => ({ seq: t.seq, round: t.round, cardId: t.cardId, label: STAT_BY_ID[t.stat]?.name ?? t.stat, value: `${t.percent.startsWith('-') ? t.percent : '+' + t.percent}% (×${shortFactor(t.factor)})`, good: !t.percent.startsWith('-') === !(t.stat.startsWith('enemy') || t.stat.startsWith('encounter')) }));
    const minSeq = page === 0 || !stats.length ? -1 : Math.min(...stats.map((s) => s.seq));
    const maxSeq = page === 0 || !stats.length ? Infinity : Math.max(...stats.map((s) => s.seq));
    const mechs = (view.mechanicTimeline ?? []).filter((m) => m.seq >= minSeq && m.seq <= maxSeq).map((m) => ({
      seq: m.seq, round: m.round, cardId: m.cardId, label: MECHANIC_BY_ID[m.mechanic]?.name ?? m.mechanic, value: `${m.kind} ${magnitudeText(m.mechanic, m.magnitude)}`, good: m.kind === 'boon',
    }));
    return [...stats, ...mechs].sort((a, b) => a.seq - b.seq);
  }, [view, page]);
  const label = (id: string) => STAT_BY_ID[id]?.name ?? DERIVED_NODES[id]?.name ?? id;
  const ql = q.toLowerCase();
  const mechanics = (view?.mechanics ?? []).filter((m) => !q || m.name.toLowerCase().includes(ql) || m.short.toLowerCase().includes(ql) || m.sources.some((s) => cardName(s.cardId).toLowerCase().includes(ql)));
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="ledger-h" style={{ zIndex: 'var(--z-ledger)' }}>
      <div className="frame sheet fit ornate crest ledger-sheet">
        <div className="panel-head">
          <div>
            <h2 id="ledger-h" className="panel-title sm">Fate Ledger</h2>
            {view && <div className="lg-sub">Round {view.round} · {view.mode} · party of {view.n} · seed <code>{view.seed}</code> · score {score(view.scoreText)} · pressure ×{fmt(view.pressure)}</div>}
          </div>
          <button ref={closeRef} className="btn" onClick={onClose}>Close <span className="kbd">Esc</span></button>
        </div>
        {!view ? <p role="status">Loading ledger…</p> : (
          <div className="sheet-body lg-body">
            <div className="row">
              <div role="tablist" aria-label="View" className="row" style={{ gap: 8 }}>
                <button role="tab" aria-selected={tab === 'party'} className={`btn small ${tab === 'party' ? 'teal' : ''}`} onClick={() => setTab('party')}>Party</button>
                {phase?.players.map((p) => <button key={p.slot} role="tab" aria-selected={tab === p.slot} className={`btn small ${tab === p.slot ? 'teal' : ''}`} onClick={() => setTab(p.slot)}>{p.name}</button>)}
              </div>
              <label className="sr-only" htmlFor="lq">Search</label>
              <input id="lq" placeholder="Search card, rule, effect or stat" value={q} onChange={(e) => setQ(e.target.value)} className="grow" style={{ minWidth: 200 }} />
            </div>
            <section className="well lg-rules" aria-labelledby="lg-rules-h">
              <h3 id="lg-rules-h" className="lg-h">Bound rules <span className="faint">({(view.mechanics ?? []).length})</span></h3>
              {mechanics.length ? (
                <ul className="lg-mech-list">{mechanics.map((m) => <MechanicRow key={m.id} m={m} />)}</ul>
              ) : <p className="faint">{(view.mechanics ?? []).length ? 'No bound rule matches the search.' : 'No boons or banes bound yet. Rare and mythic Fate Cards bind new rules; each copy multiplies its strength.'}</p>}
            </section>
            <div className="ledger-groups">
              {view.groups.map((g) => {
                const stats = g.stats.filter((s) => !q || s.name.toLowerCase().includes(ql) || s.sources.some((src) => cardName(src.cardId).toLowerCase().includes(ql)));
                if (!stats.length) return null;
                return (
                  <section key={g.id} className="well" aria-labelledby={`lg-${g.id}`}>
                    <h3 id={`lg-${g.id}`} className="lg-h"><StatIcon stat={GROUP_ICON[g.id]} size={24} /> {g.name}</h3>
                    <ul className="lg-list">{stats.map((s) => <StatRow key={s.stat} s={s} tab={tab} onTrace={setTrace} />)}</ul>
                  </section>
                );
              })}
            </div>
            {trace && (
              <section className="well gold" aria-labelledby="trace-h">
                <h3 id="trace-h" className="lg-h">Consequence trace: {label(trace)}</h3>
                <p className="faint">Directed calculation graph (versioned). Loops resolve through explicit time steps, never recursion.</p>
                <ul className="lg-plain">{cascade.map((path, i) => <li key={i}>{path.map(label).join(' → ')}</li>)}</ul>
                <button className="btn small ghost" onClick={() => setTrace(null)}>Close trace</button>
              </section>
            )}
            <section className="well" aria-labelledby="tl-h">
              <h3 id="tl-h" className="lg-h">Timeline ({view.timelineTotal + (view.mechanicTimeline?.length ?? 0)} effects)</h3>
              <ol className="lg-timeline">
                {timeline.map((t) => <li key={t.seq}><span className="faint">after R{t.round}</span> {cardName(t.cardId)}: {t.label} <b className={t.good ? 'pos' : 'neg'}>{t.value}</b></li>)}
              </ol>
              {view.timelineTotal > 50 && (
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn small" disabled={(page + 1) * 50 >= view.timelineTotal} onClick={() => setPage(page + 1)}>Older</button>
                  <button className="btn small" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))}>Newer</button>
                </div>
              )}
            </section>
            <section className="well">
              <h3 className="lg-h">Measured damage (current measured rate)</h3>
              <ul className="lg-plain">{view.measured.map((m) => <li key={m.slot}>{phase?.players[m.slot]?.name}: {m.sampleSec ? `${fmt(m.dps)} DPS over the last ${m.sampleSec}s` : 'insufficient combat sample'}</li>)}</ul>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
