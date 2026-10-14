'use client';

import { useEffect, useState } from 'react';
import { contentHash } from '@cursebound/content';
import { accountApi, api, onlineMode } from '@/lib/api';
import { authStore } from '@/lib/auth';
import { useStore } from '@/lib/store';
import { score } from '@/lib/format';
import { TopBar } from '@/ui/TopBar';
import { ClassEmblem } from '@/ui/icons';

// Leaderboards (PRD §13.3, §13.4): divisions by rules/content/score version, starting party size, mode,
// challenge and trust tier. Keyset pagination. This machine's records are always labelled Local; in online mode the
// "Online" source shows the cloud boards (client-reported), which is where the Friends / Mine scopes live.

interface Row { rank: number; runId: string; scoreText: string; depth: number; activeTicks: number; completedAt: number; trust: string; participants: { name: string; classId: string }[]; verification: string; practice: boolean; accounts?: string[] }

function describe(key: string) {
  const [rules, content, scoreV, n, mode, challenge, trust] = key.split('|');
  return { rules, content, scoreV, n: n?.replace('n', ''), mode, challenge, trust };
}

export default function Records() {
  const [keys, setKeys] = useState<{ boardKey: string; count: number }[]>([]);
  const [current, setCurrent] = useState<{ contentHash: string } | null>(null);
  const [key, setKey] = useState<string>('');
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [stack, setStack] = useState<(string | null)[]>([]);
  const [practice, setPractice] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [scope, setScope] = useState<'all' | 'friends' | 'mine'>('all');
  const signedIn = useStore(authStore, (s) => s.status === 'signedIn');
  const [online, setOnline] = useState(false);
  const [source, setSource] = useState<'local' | 'online'>('local');
  const fromCloud = source === 'online';
  const get = fromCloud ? accountApi : api;
  // scopes need the account where the board lives: the cloud in online mode, the local authority otherwise
  const scoped = signedIn && (fromCloud || !online);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('scope');
    if (q === 'friends' || q === 'mine') setScope(q);
    onlineMode().then((on) => { setOnline(on); if (on) setSource('online'); }).catch(() => undefined);
  }, []);
  useEffect(() => {
    setErr(null); setKeys([]); setRows([]); setCursor(null); setKey('');
    get<{ keys: { boardKey: string; count: number }[]; current: { contentHash: string } }>('GET', '/boards/keys').then((r) => {
      // the cloud is deployed on its own schedule: "current" means this client's content version
      const cur = fromCloud ? { contentHash: contentHash() } : r.current;
      setKeys(r.keys); setCurrent(cur);
      const first = r.keys.find((k) => k.boardKey.includes(cur.contentHash)) ?? r.keys[0];
      if (first) setKey(first.boardKey);
    }).catch((e) => setErr((e as Error).message));
  }, [source]);
  const load = (k: string, c: string | null) => {
    get<{ rows: Row[]; nextCursor: string | null }>('GET', `/boards?key=${encodeURIComponent(k)}&limit=20${c ? `&cursor=${encodeURIComponent(c)}` : ''}${practice ? '&practice=1' : ''}${scope !== 'all' && scoped ? `&scope=${scope}` : ''}`)
      .then((r) => { setRows(r.rows); setCursor(r.nextCursor); }).catch((e) => setErr((e as Error).message));
  };
  useEffect(() => { if (key) { setStack([]); load(key, null); } }, [key, practice, scope, scoped]);
  const d = key ? describe(key) : null;
  return (
    <>
      <TopBar current="/records" />
      <main id="main" className="page col">
        <div className="page-head"><span className="torch" aria-hidden="true" /><h1>{scope === 'friends' && scoped ? 'Friends records' : scope === 'mine' && scoped ? 'Your records' : fromCloud ? 'Online records' : 'Local records'}</h1></div>
        <p className="page-lead">{fromCloud ? <>Online scores are reported by the players&apos; own game clients and are not verified.</> : <>Local scores are editable by this machine&apos;s owner and are never verified global competition.</>} Parties compete only through collective scores; each starting party size is its own division, and incompatible rule versions are archived separately.</p>
        {err && <div className="frame blood" role="alert">{err}</div>}
        <div className="frame row" style={{ alignItems: 'center' }}>
          {online && (
            <div role="radiogroup" aria-label="Which records" className="row records-scope">
              {(['online', 'local'] as const).map((x) => <button key={x} role="radio" aria-checked={source === x} className={`btn small ${source === x ? 'teal' : 'ghost'}`} onClick={() => setSource(x)}>{x === 'online' ? 'Online' : 'This machine'}</button>)}
            </div>
          )}
          <label htmlFor="div" className="engraved" style={{ margin: 0 }}>Division</label>
          <select id="div" value={key} onChange={(e) => setKey(e.target.value)} className="grow">
            {keys.map((k) => {
              const x = describe(k.boardKey);
              const archived = current && x.content !== current.contentHash;
              return <option key={k.boardKey} value={k.boardKey}>{x.n}-player {x.mode} · {x.challenge === 'open' ? 'random seeds' : x.challenge} · {x.trust} · {k.count} runs{archived ? ' · archived version' : ''}</option>;
            })}
          </select>
          {scoped && (
            <div role="radiogroup" aria-label="Whose runs" className="row records-scope">
              {(['all', 'friends', 'mine'] as const).map((s) => <button key={s} role="radio" aria-checked={scope === s} className={`btn small ${scope === s ? 'teal' : 'ghost'}`} onClick={() => setScope(s)}>{s === 'all' ? 'Everyone' : s === 'friends' ? 'Friends' : 'Mine'}</button>)}
            </div>
          )}
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={practice} onChange={(e) => setPractice(e.target.checked)} /> include practice</label>
        </div>
        {d && <p className="faint" style={{ margin: 0 }}>{d.rules} · {d.scoreV} · content {d.content?.slice(0, 10)}…</p>}
        <div className="frame ornate crest" style={{ marginTop: 16 }}>
          <div style={{ overflowX: 'auto' }}>
          <table className="data">
            <caption className="sr-only">Leaderboard ordered by score, then depth, then active combat time</caption>
            <thead><tr><th>#</th><th>Party</th><th className="num">Score</th><th className="num">Depth</th><th className="num">Active time</th><th>Date</th><th>Trust</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.runId}>
                  <td className="gothic gold-text" style={{ fontSize: 'var(--fs-goth)', lineHeight: 1 }}>{r.rank}</td>
                  <td>{r.participants.map((p, i) => <span key={i} className="row" style={{ gap: 8, display: 'inline-flex', marginRight: 16 }}><ClassEmblem classId={p.classId as Parameters<typeof ClassEmblem>[0]['classId']} size={16} />{p.name}</span>)}{r.practice && <span className="chip warn">practice</span>}{!!r.accounts?.length && <div className="acct-names">{r.accounts.map((a) => '@' + a).join(' · ')}</div>}</td>
                  <td className="num"><b className="gold-text">{score(r.scoreText)}</b></td>
                  <td className="num">{r.depth}</td>
                  <td className="num">{Math.round(r.activeTicks / 60)}s</td>
                  <td>{new Date(r.completedAt).toLocaleString()}</td>
                  <td><span className="chip">{fromCloud ? 'Online · client-reported' : `Local · ${r.verification}`}</span></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="muted">{scope === 'friends' && scoped ? 'No runs from you or your friends in this division yet.' : 'No finished runs in this division yet.'}</td></tr>}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn small" disabled={!stack.length} onClick={() => { const s = [...stack]; const prev = s.pop() ?? null; setStack(s); load(key, prev); }}>Previous</button>
            <button className="btn small" disabled={!cursor} onClick={() => { setStack([...stack, null]); load(key, cursor); }}>Next</button>
          </div>
          </div>
        </div>
      </main>
    </>
  );
}
