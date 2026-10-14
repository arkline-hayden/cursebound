'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CARD_BY_ID, CLASS_BY_ID, NODE_BY_ID, TUTORIAL_CARD } from '@cursebound/content';
import { netStore, type GameConnection } from '@/lib/net';
import { clearSeat } from '@/lib/profile';
import { useStore } from '@/lib/store';
import { api } from '@/lib/api';
import { authStore, refreshAuth } from '@/lib/auth';
import { fmt, score, whole } from '@/lib/format';
import { CardIcon, ClassEmblem } from './icons';
import { FireTitle } from './FireTitle';
import { ItemIcon } from './itemIcons';
import { LEGENDARY_BY_ID } from '@cursebound/content';

// RESULTS (PRD §16.1, §13): collective score, clear depth, end reason, builds, Fate timeline, score breakdown
// and death recap. Local records are labelled Local and never presented as verified competition.

const END_LABEL: Record<string, string> = {
  wipe: 'Party wipe', retired: 'Retired', aborted_infrastructure: 'Aborted — infrastructure failure (not a defeat)', invalidated: 'Invalidated run',
};

export function Results({ net }: { net: GameConnection }) {
  const results = useStore(netStore, (s) => s.results);
  const phase = useStore(netStore, (s) => s.phase);
  const [verify, setVerify] = useState<{ ok: boolean; reason: string; ms: number } | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | string>('idle');
  const signedIn = useStore(authStore, (s) => s.status === 'signedIn');
  useEffect(() => { if (authStore.get().status === 'unknown') refreshAuth().catch(() => undefined); }, []);
  useEffect(() => {
    if (!results) return;
    api<{ rows: { runId: string; rank: number }[] }>('GET', `/boards?key=${encodeURIComponent(results.boardKey)}&limit=100&practice=1`).then((b) => {
      const r = b.rows.find((x) => x.runId === results.runId); if (r) setRank(r.rank);
    }).catch(() => undefined);
  }, [results]);
  if (!results) {
    return <div className="overlay"><div className="frame ornate notice-panel" role="status">{phase?.storagePending ? 'Saving the final summary is pending — the result will appear once storage recovers.' : 'Recording the final run summary…'}</div></div>;
  }
  const r = results;
  const doVerify = async () => {
    setVerify(null);
    try { setVerify(await api('POST', `/runs/${r.runId}/verify`)); } catch (e) { setVerify({ ok: false, reason: (e as Error).message, ms: 0 }); }
  };
  const exportReplay = async () => {
    const data = await api('GET', `/runs/${r.runId}/replay`);
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cursebound-${r.runId}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const saveBuild = async () => {
    setSaved('saving');
    try { await api('POST', '/builds/from-run', { runId: r.runId }); setSaved('saved'); } catch (e) { setSaved((e as Error).message); }
  };
  const lastRecap = (r.deathRecaps as any[]).slice(-3);
  const headline = r.endReason === 'wipe' ? 'You Have Fallen' : r.endReason === 'retired' ? 'You Withdrew' : 'The Run Ends';
  return (
    <div className="overlay">
      <div className={`frame ${r.endReason === 'wipe' ? 'blood dire' : 'ember'} sheet fit ornate crest res-sheet`} role="region" aria-labelledby="res-h">
        <div className="res-head">
          <div>
            <div className="res-title">
              <span className="sr-only">{headline}</span>
              <FireTitle text={headline} family='"Jersey 10"' fontPx={30} scale={2} fire={r.endReason === 'wipe' ? 'blood' : 'ember'} metal={r.endReason === 'wipe' ? 'blood' : 'bone'} fallbackClassName="fire-fallback" />
            </div>
            <h2 id="res-h" className="res-score">{score(r.scoreText)}</h2>
            <div className="panel-sub">{END_LABEL[r.endReason] ?? r.endReason} · depth {r.depth} · {Math.round(r.activeTicks / 60)}s of combat · party of {r.n}</div>
          </div>
          <div className="res-chips">
            <span className="chip">{r.trustLabel}</span>
            {r.practice && <span className="chip warn">Practice attempt (not ranked)</span>}
            {r.resumed && <span className="chip info">Resumed from checkpoint</span>}
            {rank !== null && !r.practice && <span className="chip gold">Local board rank #{rank}</span>}
          </div>
        </div>
        <div className="sheet-body"><div className="res-grid">
          <section className="well">
            <h3>Score breakdown</h3>
            <table className="data">
              <thead><tr><th>Round</th><th className="num">Base</th><th className="num">Pressure</th><th className="num">Speed</th><th className="num">Points</th></tr></thead>
              <tbody>{(r.rounds as any[]).slice(-25).map((x) => (
                <tr key={x.round + (x.cleared ? 'c' : 'p')}>
                  <td>{x.round}{x.cleared ? '' : ` (partial ${x.completedWeight}/${x.objectiveTotal})`}</td>
                  <td className="num">{x.basePoints}</td>
                  <td className="num">×{fmt(x.pressure.replace(/^([0-9.]+)e(-?\d+)$/, (_m: string, a: string, b: string) => `${a.replace('.', '')}|${b}`), 3)}</td>
                  <td className="num">{x.cleared ? `×${(Number(x.speedNum) / Number(x.speedDen)).toFixed(4)}` : '—'}</td>
                  <td className="num"><b>{score(x.awarded)}</b></td>
                </tr>
              ))}</tbody>
            </table>
            <p className="res-note">Points come only from cleared objectives: b = 100×round (+500 on bosses) × pressure × (1 + speed bonus ≤ 25%). Partial credit on the final round has no speed bonus.</p>
          </section>
          <section className="well">
            <h3>Fate timeline</h3>
            <ol>
              {(r.fate as any[]).map((f, i) => <li key={i}><CardIcon cardId={f.cardId} size={32} /> after R{f.round}: <b>{f.cardId === TUTORIAL_CARD.id ? TUTORIAL_CARD.name : CARD_BY_ID[f.cardId]?.name ?? f.cardId}</b>{f.tie?.draw !== null && f.tie?.draw !== undefined ? <span className="faint"> (seeded tie draw)</span> : null}</li>)}
            </ol>
            {r.fate.length === 0 && <p className="faint">No Fate Cards were chosen.</p>}
          </section>
          <section className="well">
            <h3>Party</h3>
            {(r.players as any[]).map((p) => (
              <div key={p.slot} className="res-player">
                <div className="row" style={{ gap: 8 }}><ClassEmblem classId={p.classId} size={32} /> <b>{p.name}</b> <span className="faint">{CLASS_BY_ID[p.classId]?.name}</span></div>
                <div className="faint">{Object.entries(p.ranks as Record<string, number>).map(([id, rk]) => `${NODE_BY_ID[id]?.name ?? id}${rk > 1 ? ' ' + rk : ''}`).join(' · ') || 'No nodes'}</div>
                <div>Damage {whole(p.stats.damageDealt)} · taken {whole(p.stats.damageTaken)} · healed {whole(p.stats.healing)} · prevented {whole(p.stats.prevented)} · revives {p.stats.revives} · downs {p.stats.downs}</div>
              </div>
            ))}
            <p className="res-note">Contribution statistics are for learning only; the score is shared by the whole party.</p>
          </section>
          {((r.legendaries as { itemId: string; round: number; source: string }[] | undefined) ?? []).length > 0 && (
            <section className="well">
              <h3>Legendaries found</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(r.legendaries as { itemId: string; round: number; source: string }[]).map((l, i) => {
                  const def = LEGENDARY_BY_ID[l.itemId];
                  const owner = (r.players as any[]).find((p) => Object.values((p.gear ?? {}) as Record<string, string>).includes(l.itemId));
                  return (
                    <div key={i} className="row" style={{ gap: 8, padding: 4, border: '2px solid #ff8a1e', background: 'var(--stone-0)' }} data-tip={def?.perk.description}>
                      <ItemIcon itemId={l.itemId} size={32} />
                      <span style={{ color: '#ff8a1e' }}>{def?.name ?? l.itemId}</span>
                      <span className="faint">round {l.round}{l.source === 'boss' ? ' · boss' : l.source === 'elite' ? ' · elite' : ''}{owner ? ` · ${owner.name}` : ''}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {lastRecap.length > 0 && (
            <section className="well">
              <h3>Death recap</h3>
              <ul>{lastRecap.map((d: any, i: number) => (
                <li key={i}>
                  {(r.players as any[])[d.slot]?.name}: {d.final ? 'killed' : 'downed'} by <b>{d.source}</b> — {d.attack}, {whole(d.amountText)} damage at {(d.hpFracBefore * 100).toFixed(0)}% health (round {d.round}){d.disconnected ? ' while disconnected' : ''}.
                  {d.contributingFactors.length > 0 && <div className="faint">Contributing Fate factors: {d.contributingFactors.join(', ')}</div>}
                </li>
              ))}</ul>
            </section>
          )}
        </div></div>
        <footer className="sheet-foot" style={{ justifyContent: 'space-between' }}>
          <div className="row">
            <button className="btn small" onClick={doVerify}>Replay check</button>
            <button className="btn small ghost" onClick={exportReplay}>Export replay</button>
            {signedIn && <button className="btn small" disabled={saved === 'saving' || saved === 'saved'} onClick={saveBuild}>{saved === 'saved' ? 'Build saved' : saved === 'saving' ? 'Saving…' : 'Save build'}</button>}
            {saved !== 'idle' && saved !== 'saving' && saved !== 'saved' && <span className="chip bad" role="status">{saved}</span>}
            {verify && <span className={`chip ${verify.ok ? 'good' : 'bad'}`} role="status">{verify.ok ? `Replay reproduced the score exactly (${verify.ms} ms)` : `Replay check: ${verify.reason}`}</span>}
          </div>
          <div className="row">
            <Link className="btn" href="/records">Local records</Link>
            <Link className="btn primary big" href="/" onClick={() => { clearSeat(); net.close(); }}>Play again</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
