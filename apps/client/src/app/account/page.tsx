'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CLASSES, CLASS_BY_ID, NODE_BY_ID } from '@cursebound/content';
import { api, ApiError } from '@/lib/api';
import { authStore, login, logout, refreshAuth, register, updateAccount, type Account } from '@/lib/auth';
import { forgetProfile, guestProfileId, rememberGuest } from '@/lib/profile';
import { initSettings } from '@/lib/settings';
import { useStore } from '@/lib/store';
import { score } from '@/lib/format';
import { TopBar } from '@/ui/TopBar';
import { ClassEmblem } from '@/ui/icons';

// ACCOUNT: username + password sign-in and registration; once signed in, the player's profile and lifetime
// statistics, saved builds, friends (requests, player cards) and security (password, sessions, sign out).

interface Stats {
  runs: number; finished: number; bestScoreText: string; bestRunId: string | null; deepestRound: number; totalActiveTicks: number;
  coopRuns: number; dailyRuns: number; byClass: { classId: string; runs: number; bestScoreText: string }[]; lastPlayedAt: number | null;
}
interface Build { id: string; name: string; classId: string; ranks: Record<string, number>; mastery: string | null; notes: string; sourceRunId: string | null; createdAt: number; updatedAt: number }
interface Friend { accountId: string; username: string; displayName: string; profileId: string; favoriteClass: string | null; state: 'friends' | 'incoming' | 'outgoing'; since: number }
interface RunItem { id: string; mode: string; status: string; round: number; scoreText: string; n: number; challengeId: string | null; createdAt: number; completedAt: number | null }
interface Session { label: string; createdAt: number; lastSeenAt: number; current: boolean }
type Tab = 'profile' | 'builds' | 'friends' | 'security';

const className = (id: string | null | undefined) => (id ? CLASS_BY_ID[id]?.name ?? id : '—');
const minutes = (ticks: number) => (ticks < 3600 ? `${Math.round(ticks / 60)}s` : ticks < 216000 ? `${Math.round(ticks / 3600)} min` : `${(ticks / 216000).toFixed(1)} h`);
const date = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const shortDate = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');
const errText = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);

function Emblem({ classId, size = 24 }: { classId: string | null | undefined; size?: number }) {
  return classId && CLASS_BY_ID[classId] ? <ClassEmblem classId={classId} size={size} /> : <span style={{ width: size, display: 'inline-block' }} />;
}

// ---------------------------------------------------------------- signed out
function AuthForms() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [claim, setClaim] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hasGuest = typeof window !== 'undefined' && !!guestProfileId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (mode === 'register' && password !== confirm) { setErr('The two passwords do not match.'); return; }
    setBusy(true);
    try {
      const acc = mode === 'login'
        ? await login(username, password)
        : await register(username, password, { displayName: displayName.trim() || undefined, claimProfileId: claim ? guestProfileId() : null });
      initSettings(acc.profileId);
    } catch (e2) { setErr(errText(e2)); setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <div className="frame ornate crest auth-card">
        <div role="tablist" aria-label="Sign in or register" className="row auth-tabs">
          <button role="tab" aria-selected={mode === 'login'} className={`btn small ${mode === 'login' ? 'teal' : 'ghost'}`} onClick={() => { setMode('login'); setErr(null); }}>Sign in</button>
          <button role="tab" aria-selected={mode === 'register'} className={`btn small ${mode === 'register' ? 'teal' : 'ghost'}`} onClick={() => { setMode('register'); setErr(null); }}>Create account</button>
        </div>
        <form className="col auth-form" onSubmit={submit}>
          <label className="field">
            <span className="engraved">Username</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" maxLength={20} required pattern="[A-Za-z0-9_]{3,20}" title="3–20 letters, digits or underscores" autoFocus />
          </label>
          {mode === 'register' && (
            <label className="field">
              <span className="engraved">Display name <span className="faint">(optional)</span></span>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={24} placeholder="Shown on boards and to your party" />
            </label>
          )}
          <label className="field">
            <span className="engraved">Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 8 : undefined} maxLength={128} required />
          </label>
          {mode === 'register' && (
            <>
              <label className="field">
                <span className="engraved">Confirm password</span>
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required />
              </label>
              <p className="faint auth-hint">At least 8 characters. Passwords are salted and hashed on this machine&apos;s game service; they are never stored as written.</p>
              {hasGuest && (
                <label className="row check-row">
                  <input type="checkbox" checked={claim} onChange={(e) => setClaim(e.target.checked)} />
                  <span>Bring this browser&apos;s guest runs and settings into the new account</span>
                </label>
              )}
            </>
          )}
          {err && <p className="neg" role="alert">{err}</p>}
          <button className="btn big primary" type="submit" disabled={busy}>{busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
      </div>
      <div className="frame auth-why">
        <h3>Why an account?</h3>
        <ul className="why-list">
          <li><b>Your records follow you.</b> Runs, best scores and settings belong to you on any browser that reaches this game service.</li>
          <li><b>Saved builds.</b> Keep the skill paths that worked and plan the next descent.</li>
          <li><b>Friends.</b> Find each other by username and race on friends-only leaderboards.</li>
        </ul>
        <p className="faint">You can always play as a guest — <Link href="/">return to the title</Link>.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- profile & stats
function ProfileTab({ account }: { account: Account }) {
  const [displayName, setDisplayName] = useState(account.displayName);
  const [motto, setMotto] = useState(account.motto);
  const [fav, setFav] = useState(account.favoriteClass ?? '');
  const [stats, setStats] = useState<Stats | null>(null);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    api<{ stats: Stats }>('GET', '/account/stats').then((r) => setStats(r.stats)).catch(() => undefined);
    api<{ runs: RunItem[] }>('GET', '/account/runs?limit=12').then((r) => setRuns(r.runs)).catch(() => undefined);
  }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try { await updateAccount({ displayName, motto, favoriteClass: fav || null }); setMsg({ ok: true, text: 'Saved.' }); } catch (e2) { setMsg({ ok: false, text: errText(e2) }); }
  };
  return (
    <div className="acct-grid">
      <form className="frame col" onSubmit={save}>
        <h3>Profile</h3>
        <label className="field"><span className="engraved">Display name</span><input value={displayName} maxLength={24} onChange={(e) => setDisplayName(e.target.value)} /></label>
        <label className="field"><span className="engraved">Motto</span><input value={motto} maxLength={120} placeholder="A line for your player card" onChange={(e) => setMotto(e.target.value)} /></label>
        <label className="field"><span className="engraved">Favourite vessel</span>
          <select value={fav} onChange={(e) => setFav(e.target.value)}>
            <option value="">None</option>
            {CLASSES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div className="row"><button className="btn primary" type="submit">Save profile</button>{msg && <span className={msg.ok ? 'pos' : 'neg'} role="status">{msg.text}</span>}</div>
        <p className="faint" style={{ margin: 0 }}>Username <b>{account.username}</b> · joined {date(account.createdAt)}</p>
      </form>
      <div className="frame col">
        <h3>Lifetime</h3>
        {!stats ? <p className="muted">Counting your descents…</p> : (
          <>
            <div className="stat-grid">
              <div className="stat"><span>Best score</span><b className="gold-text">{score(stats.bestScoreText)}</b></div>
              <div className="stat"><span>Deepest round</span><b>{stats.deepestRound}</b></div>
              <div className="stat"><span>Runs</span><b>{stats.runs}</b></div>
              <div className="stat"><span>Finished</span><b>{stats.finished}</b></div>
              <div className="stat"><span>In combat</span><b>{minutes(stats.totalActiveTicks)}</b></div>
              <div className="stat"><span>Party runs</span><b>{stats.coopRuns}</b></div>
              <div className="stat"><span>Daily rites</span><b>{stats.dailyRuns}</b></div>
              <div className="stat"><span>Last played</span><b>{shortDate(stats.lastPlayedAt)}</b></div>
            </div>
            {stats.byClass.length > 0 && (
              <table className="data">
                <thead><tr><th>Vessel</th><th className="num">Runs</th><th className="num">Best</th></tr></thead>
                <tbody>{stats.byClass.map((c) => <tr key={c.classId}><td><span className="row" style={{ gap: 8 }}><Emblem classId={c.classId} size={16} />{className(c.classId)}</span></td><td className="num">{c.runs}</td><td className="num gold-text">{score(c.bestScoreText)}</td></tr>)}</tbody>
              </table>
            )}
          </>
        )}
      </div>
      <div className="frame col acct-wide">
        <h3>Recent descents</h3>
        {runs.length === 0 ? <p className="muted">No runs yet. <Link href="/">Descend</Link> and they will be recorded here.</p> : (
          <table className="data">
            <thead><tr><th>Date</th><th>Mode</th><th className="num">Round</th><th className="num">Score</th><th>Status</th></tr></thead>
            <tbody>{runs.map((r) => (
              <tr key={r.id}><td>{date(r.completedAt ?? r.createdAt)}</td><td>{r.n > 1 ? `${r.n}-player party` : 'Solo'}{r.challengeId ? ` · ${r.challengeId}` : ''}</td><td className="num">{r.round}</td><td className="num gold-text">{score(r.scoreText)}</td><td><span className={`chip ${r.status === 'finalized' ? '' : r.status === 'active' ? 'info' : 'warn'}`}>{r.status === 'finalized' ? 'finished' : r.status}</span></td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- builds
function BuildCard({ b, onChange, onDelete }: { b: Build; onChange: (b: Build) => void; onDelete: () => void }) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(b.name);
  const [notes, setNotes] = useState(b.notes);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const cls = CLASS_BY_ID[b.classId];
  const nodes = Object.entries(b.ranks).map(([id, r]) => ({ node: NODE_BY_ID[id], id, r })).filter((x) => x.node);
  const points = nodes.reduce((s, x) => s + x.r * (x.node!.costPerRank ?? 1), 0);
  const branches = cls?.branches.map((br) => ({ br, nodes: nodes.filter((x) => x.node!.branch === br.id).sort((x, y) => x.node!.tier - y.node!.tier) })).filter((g) => g.nodes.length) ?? [];
  const mastery = b.mastery ? (JSON.parse(b.mastery) as { damage: number; health: number; regen: number }) : null;
  const save = async () => {
    setErr(null);
    try { onChange((await api<{ build: Build }>('PUT', `/builds/${b.id}`, { name, notes })).build); setEdit(false); } catch (e) { setErr(errText(e)); }
  };
  return (
    <article className="frame build-card" style={{ ['--accent' as string]: cls?.accent }}>
      <header className="row build-head">
        <Emblem classId={b.classId} size={32} />
        <div className="grow">
          {edit ? <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Build name" /> : <h3 className="build-name">{b.name}</h3>}
          <span className="faint">{cls?.name ?? b.classId} · {points} point{points === 1 ? '' : 's'} · {nodes.length} node{nodes.length === 1 ? '' : 's'}{b.sourceRunId ? ' · from a run' : ''}</span>
        </div>
      </header>
      {branches.length === 0 ? <p className="muted" style={{ margin: 0 }}>Only starting grants — no points spent.</p> : (
        <div className="build-branches">
          {branches.map(({ br, nodes: ns }) => (
            <div key={br.id} className="build-branch">
              <span className="engraved">{br.name}</span>
              <ul>{ns.map((x) => <li key={x.id}><span>{x.node!.name}</span><b>{x.r}/{x.node!.rankLimit}</b></li>)}</ul>
            </div>
          ))}
        </div>
      )}
      {mastery && (mastery.damage + mastery.health + mastery.regen > 0) && <p className="faint" style={{ margin: 0 }}>Mastery: damage {mastery.damage} · health {mastery.health} · regen {mastery.regen}</p>}
      {edit ? (
        <textarea className="input" value={notes} maxLength={500} rows={3} placeholder="Notes: when to take what, which Fates it loves…" onChange={(e) => setNotes(e.target.value)} aria-label="Build notes" />
      ) : b.notes ? <p className="build-notes">{b.notes}</p> : null}
      {err && <p className="neg" role="alert">{err}</p>}
      <footer className="row">
        {edit ? (
          <><button className="btn small primary" onClick={save}>Save</button><button className="btn small ghost" onClick={() => { setEdit(false); setName(b.name); setNotes(b.notes); }}>Cancel</button></>
        ) : (
          <button className="btn small" onClick={() => setEdit(true)}>Rename / notes</button>
        )}
        <span className="grow" />
        {confirmDel ? (
          <><span className="warn-text">Delete for good?</span><button className="btn small danger" onClick={onDelete}>Delete</button><button className="btn small ghost" onClick={() => setConfirmDel(false)}>Keep</button></>
        ) : <button className="btn small ghost" onClick={() => setConfirmDel(true)}>Delete</button>}
      </footer>
    </article>
  );
}

function BuildsTab() {
  const [builds, setBuilds] = useState<Build[] | null>(null);
  const [max, setMax] = useState(60);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const load = useCallback(() => {
    api<{ builds: Build[]; max: number }>('GET', '/builds').then((r) => { setBuilds(r.builds); setMax(r.max); }).catch((e) => setErr(errText(e)));
  }, []);
  useEffect(() => {
    load();
    api<{ runs: RunItem[] }>('GET', '/account/runs?status=finalized&limit=8').then((r) => setRuns(r.runs)).catch(() => undefined);
  }, [load]);
  const fromRun = async (runId: string) => {
    setBusy(runId); setErr(null);
    try { const r = await api<{ build: Build }>('POST', '/builds/from-run', { runId }); setBuilds((bs) => [r.build, ...(bs ?? [])]); } catch (e) { setErr(errText(e)); }
    setBusy(null);
  };
  const del = async (id: string) => {
    try { await api('DELETE', `/builds/${id}`); setBuilds((bs) => (bs ?? []).filter((x) => x.id !== id)); } catch (e) { setErr(errText(e)); }
  };
  const shown = (builds ?? []).filter((b) => !filter || b.classId === filter);
  return (
    <div className="col">
      <div className="frame col">
        <h3>Save a build from a finished run</h3>
        {runs.length === 0 ? <p className="muted" style={{ margin: 0 }}>Finish a run and the skill path you ended with can be kept here. The results screen has a “Save build” button too.</p> : (
          <ul className="run-list">
            {runs.map((r) => (
              <li key={r.id}>
                <span className="run-round">Round {r.round}</span>
                <b className="gold-text run-score">{score(r.scoreText)}</b>
                <span className="faint">{date(r.completedAt)}</span>
                <span className="grow" />
                <button className="btn small" disabled={!!busy || (builds?.length ?? 0) >= max} onClick={() => fromRun(r.id)}>{busy === r.id ? 'Saving…' : 'Save build'}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {err && <div className="frame blood" role="alert">{err}</div>}
      <div className="row">
        <h3 style={{ margin: 0 }}>Saved builds <span className="faint">{builds?.length ?? 0}/{max}</span></h3>
        <span className="grow" />
        <label className="row" style={{ gap: 8 }}><span className="engraved" style={{ margin: 0 }}>Vessel</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All</option>{CLASSES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
      </div>
      {builds === null ? <p className="muted">Unrolling the scrolls…</p> : shown.length === 0 ? <p className="muted">No saved builds{filter ? ' for this vessel' : ''} yet.</p> : (
        <div className="build-grid">{shown.map((b) => <BuildCard key={b.id} b={b} onChange={(nb) => setBuilds((bs) => (bs ?? []).map((x) => (x.id === nb.id ? nb : x)))} onDelete={() => del(b.id)} />)}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- friends
interface PlayerCard { player: Account; stats: Stats; recentRuns: RunItem[]; relation: string }

function CardDialog({ username, onClose }: { username: string; onClose: () => void }) {
  const [card, setCard] = useState<PlayerCard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    api<PlayerCard>('GET', `/players/${encodeURIComponent(username)}`).then(setCard).catch((e) => setErr(errText(e)));
    ref.current?.focus();
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [username, onClose]);
  return (
    <div className="menu-dialog" role="dialog" aria-modal="true" aria-labelledby="card-h" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="frame arcane ornate dialog-panel">
        <div className="panel-head">
          <h2 id="card-h" className="panel-title sm">{card?.player.displayName ?? username}</h2>
          <button ref={ref} className="btn small ghost" onClick={onClose}>Close <span className="kbd">Esc</span></button>
        </div>
        <div className="dialog-body col">
          {err && <p className="neg">{err}</p>}
          {!card && !err && <p className="muted">Summoning their record…</p>}
          {card && (
            <>
              <div className="row"><Emblem classId={card.player.favoriteClass} size={32} /><span className="faint">@{card.player.username} · favours {className(card.player.favoriteClass)} · joined {date(card.player.createdAt)}</span></div>
              {card.player.motto && <p className="card-motto">“{card.player.motto}”</p>}
              <div className="stat-grid">
                <div className="stat"><span>Best score</span><b className="gold-text">{score(card.stats.bestScoreText)}</b></div>
                <div className="stat"><span>Deepest round</span><b>{card.stats.deepestRound}</b></div>
                <div className="stat"><span>Runs</span><b>{card.stats.runs}</b></div>
                <div className="stat"><span>In combat</span><b>{minutes(card.stats.totalActiveTicks)}</b></div>
              </div>
              {card.recentRuns.length > 0 && (
                <table className="data"><thead><tr><th>Date</th><th className="num">Round</th><th className="num">Score</th></tr></thead>
                  <tbody>{card.recentRuns.slice(0, 6).map((r) => <tr key={r.id}><td>{date(r.completedAt)}</td><td className="num">{r.round}</td><td className="num gold-text">{score(r.scoreText)}</td></tr>)}</tbody></table>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FriendsTab() {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const load = useCallback(() => { api<{ friends: Friend[] }>('GET', '/friends').then((r) => setFriends(r.friends)).catch((e) => setMsg({ ok: false, text: errText(e) })); }, []);
  useEffect(() => { load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null);
    try { await fn(); if (ok) setMsg({ ok: true, text: ok }); load(); } catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    void act(async () => {
      const r = await api<{ state: string; friend: string }>('POST', '/friends', { username: n });
      setName('');
      setMsg({ ok: true, text: r.state === 'friends' ? `You and ${r.friend} are now friends.` : `Request sent to ${r.friend}.` });
    });
  };
  const by = (s: Friend['state']) => (friends ?? []).filter((f) => f.state === s);
  const closeCard = useCallback(() => setCard(null), []);
  return (
    <div className="acct-grid">
      <div className="col">
        <form className="frame col" onSubmit={add}>
          <h3>Add a friend</h3>
          <div className="row">
            <input className="grow" value={name} maxLength={20} placeholder="Their username" onChange={(e) => setName(e.target.value)} aria-label="Friend's username" />
            <button className="btn primary" type="submit" disabled={!name.trim()}>Send request</button>
          </div>
          {msg && <p className={msg.ok ? 'pos' : 'neg'} role="status" style={{ margin: 0 }}>{msg.text}</p>}
        </form>
        {by('incoming').length > 0 && (
          <div className="frame ember col">
            <h3>Requests for you</h3>
            <ul className="friend-list">{by('incoming').map((f) => (
              <li key={f.accountId}><Emblem classId={f.favoriteClass} /><span className="grow"><b>{f.displayName}</b> <span className="faint">@{f.username}</span></span>
                <button className="btn small primary" onClick={() => act(() => api('POST', `/friends/${f.accountId}/accept`), `You and ${f.username} are now friends.`)}>Accept</button>
                <button className="btn small ghost" onClick={() => act(() => api('POST', `/friends/${f.accountId}/decline`))}>Decline</button></li>
            ))}</ul>
          </div>
        )}
        {by('outgoing').length > 0 && (
          <div className="frame col">
            <h3>Waiting on</h3>
            <ul className="friend-list">{by('outgoing').map((f) => (
              <li key={f.accountId}><Emblem classId={f.favoriteClass} /><span className="grow"><b>{f.displayName}</b> <span className="faint">@{f.username}</span></span>
                <button className="btn small ghost" onClick={() => act(() => api('DELETE', `/friends/${f.accountId}`))}>Cancel</button></li>
            ))}</ul>
          </div>
        )}
      </div>
      <div className="frame col">
        <h3>Friends <span className="faint">{by('friends').length}</span></h3>
        {friends === null ? <p className="muted">Calling the roll…</p> : by('friends').length === 0 ? <p className="muted" style={{ margin: 0 }}>No friends yet. Add them by username; once they accept, their runs appear on your friends leaderboard in Records.</p> : (
          <ul className="friend-list">{by('friends').map((f) => (
            <li key={f.accountId}><Emblem classId={f.favoriteClass} /><span className="grow"><b>{f.displayName}</b> <span className="faint">@{f.username} · since {date(f.since)}</span></span>
              <button className="btn small" onClick={() => setCard(f.username)}>Card</button>
              <button className="btn small ghost" onClick={() => act(() => api('DELETE', `/friends/${f.accountId}`))}>Remove</button></li>
          ))}</ul>
        )}
        <p className="faint" style={{ margin: 0 }}><Link href="/records?scope=friends">Friends leaderboard →</Link></p>
      </div>
      {card && <CardDialog username={card} onClose={closeCard} />}
    </div>
  );
}

// ---------------------------------------------------------------- security
function SecurityTab() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const load = useCallback(() => { api<{ sessions: Session[] }>('GET', '/auth/sessions').then((r) => setSessions(r.sessions)).catch(() => undefined); }, []);
  useEffect(() => { load(); }, [load]);
  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (next !== confirm) { setMsg({ ok: false, text: 'The new passwords do not match.' }); return; }
    try {
      await api('POST', '/auth/password', { current, next });
      setCurrent(''); setNext(''); setConfirm('');
      setMsg({ ok: true, text: 'Password changed. Every other device has been signed out.' });
      load();
    } catch (e2) { setMsg({ ok: false, text: errText(e2) }); }
  };
  const revoke = async () => { await api('POST', '/auth/sessions/revoke-others').catch(() => undefined); load(); };
  const signOut = async () => { await logout(); forgetProfile(); window.location.href = '/'; };
  const [delOpen, setDelOpen] = useState(false);
  const [delPw, setDelPw] = useState('');
  const [delErr, setDelErr] = useState<string | null>(null);
  const deleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDelErr(null);
    const acc = authStore.get().account;
    try {
      await api('POST', '/account/delete', { password: delPw });
      if (acc) rememberGuest(acc.profileId, acc.displayName); else forgetProfile();
      window.location.href = '/';
    } catch (e2) { setDelErr(errText(e2)); }
  };
  return (
    <div className="acct-grid">
      <form className="frame col" onSubmit={change}>
        <h3>Change password</h3>
        <input type="text" name="username" autoComplete="username" value={authStore.get().account?.username ?? ''} readOnly hidden />
        <label className="field"><span className="engraved">Current password</span><input type="password" value={current} autoComplete="current-password" onChange={(e) => setCurrent(e.target.value)} required /></label>
        <label className="field"><span className="engraved">New password</span><input type="password" value={next} autoComplete="new-password" minLength={8} maxLength={128} onChange={(e) => setNext(e.target.value)} required /></label>
        <label className="field"><span className="engraved">Confirm new password</span><input type="password" value={confirm} autoComplete="new-password" minLength={8} maxLength={128} onChange={(e) => setConfirm(e.target.value)} required /></label>
        <div className="row"><button className="btn primary" type="submit">Change password</button></div>
        {msg && <p className={msg.ok ? 'pos' : 'neg'} role="status" style={{ margin: 0 }}>{msg.text}</p>}
      </form>
      <div className="frame col">
        <h3>Signed-in devices</h3>
        <ul className="friend-list">{sessions.map((s, i) => (
          <li key={i}><span className="grow"><b>{s.label}</b>{s.current && <span className="chip good" style={{ marginLeft: 8 }}>this one</span>}<br /><span className="faint">since {date(s.createdAt)} · last seen {date(s.lastSeenAt)}</span></span></li>
        ))}</ul>
        <div className="row">
          <button className="btn small" disabled={sessions.length < 2} onClick={revoke}>Sign out other devices</button>
          <span className="grow" />
          <button className="btn small danger" onClick={signOut}>Sign out</button>
        </div>
      </div>
      <div className="frame blood col acct-wide">
        <h3>Delete account</h3>
        <p className="muted" style={{ margin: 0 }}>Removes your username, password, saved builds and friends. Finished runs stay on the boards under your display name as a guest profile.</p>
        {delOpen ? (
          <form className="row" onSubmit={deleteAccount}>
            <input type="password" className="grow" value={delPw} autoComplete="current-password" placeholder="Your password" onChange={(e) => setDelPw(e.target.value)} aria-label="Confirm with your password" required />
            <button className="btn danger" type="submit">Delete forever</button>
            <button className="btn ghost" type="button" onClick={() => { setDelOpen(false); setDelPw(''); setDelErr(null); }}>Keep account</button>
          </form>
        ) : <div className="row"><button className="btn small ghost" onClick={() => setDelOpen(true)}>Delete my account…</button></div>}
        {delErr && <p className="neg" role="alert" style={{ margin: 0 }}>{delErr}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page
export default function AccountPage() {
  const auth = useStore(authStore, (s) => s);
  const [tab, setTab] = useState<Tab>('profile');
  useEffect(() => {
    refreshAuth().catch(() => undefined);
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null;
    if (t && ['profile', 'builds', 'friends', 'security'].includes(t)) setTab(t);
  }, []);
  const choose = (t: Tab) => { setTab(t); window.history.replaceState(null, '', `/account?tab=${t}`); };
  const acc = auth.account;
  return (
    <>
      <TopBar current="/account" />
      <main id="main" className="page col">
        <div className="page-head"><span className="torch" aria-hidden="true" /><h1>{acc ? acc.displayName : 'Account'}</h1>{acc && <span className="faint acct-handle">@{acc.username}</span>}</div>
        {auth.status === 'unknown' && <p className="muted">Consulting the ledger…</p>}
        {auth.status === 'signedOut' && <AuthForms />}
        {acc && (
          <>
            <div role="tablist" aria-label="Account sections" className="row">
              {(['profile', 'builds', 'friends', 'security'] as Tab[]).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} className={`btn small ${tab === t ? 'teal' : 'ghost'}`} onClick={() => choose(t)}>
                  {t === 'profile' ? 'Profile & stats' : t === 'builds' ? 'Builds' : t === 'friends' ? 'Friends' : 'Security'}
                </button>
              ))}
            </div>
            <div role="tabpanel">
              {tab === 'profile' && <ProfileTab key={acc.id} account={acc} />}
              {tab === 'builds' && <BuildsTab />}
              {tab === 'friends' && <FriendsTab />}
              {tab === 'security' && <SecurityTab />}
            </div>
          </>
        )}
      </main>
    </>
  );
}
