'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CLASSES, CLASS_BY_ID } from '@cursebound/content';
import { api, ApiError } from '@/lib/api';
import { authStore } from '@/lib/auth';
import { createProfile, ensureProfile, setSeat, type Profile } from '@/lib/profile';
import { initSettings, settingsStore } from '@/lib/settings';
import { useStore } from '@/lib/store';
import { score } from '@/lib/format';
import { clearGuestSession, joinViaHost } from '@/lib/p2p/guest';
import { markHosting, stopHostBridge } from '@/lib/p2p/host';
import { presenceOnline, presenceStore, resolveCode, setStatus, startPresence, type PeerId } from '@/lib/p2p/presence';
import { ClassPicker } from '@/ui/ClassPicker';
import { EmberField } from '@/ui/EmberField';
import { FireTitle } from '@/ui/FireTitle';
import { SpectralHalo } from '@/ui/SpectralHalo';
import { sharedAudio } from '@/game/audio/shared';
import { FriendsPanel, InviteToasts } from '@/ui/Friends';
import { ClassEmblem } from '@/ui/icons';

// HOME (PRD §16.1) as a proper title screen over the live isometric attract-mode dungeon:
//   1. TITLE — the burning wordmark alone, centred, with a blinking "press any key" plate.
//   2. MENU  — the wordmark rises and a single centred column of carved plaques takes its place.
//   3. VESSEL — choosing to play opens the character select (name + class) as its own carved dialog.
// The account plate (top-right) shows who is signed in; the footer carries the build and authority status.
// Online (cloud signed in), a slim friends plate sits under the account plate: who is online, what they are doing,
// and Join for open co-op parties (peer-to-peer, lib/p2p). Party invites arrive as toasts.
// The title stage is shown once per tab; returning from another page lands on the menu.

const MenuBackdrop = dynamic(() => import('@/game/MenuBackdrop'), { ssr: false });

interface RunItem { id: string; mode: string; status: string; round: number; scoreText: string; resumed: boolean; createdAt: number; challengeId: string | null }
type Intent = 'solo' | 'daily' | 'tutorial';
type Pane = 'none' | 'party' | 'continue' | 'vessel';
type Stage = 'title' | 'menu';

const STAGE_KEY = 'cursebound.title-seen';
const VESSEL_KEY = 'cursebound.vessel';

const INTENT_COPY: Record<Intent, { title: string; go: string; busy: string }> = {
  solo: { title: 'Choose your vessel', go: 'Descend', busy: 'Descending…' },
  daily: { title: 'The Daily Rite', go: 'Begin the rite', busy: 'Descending…' },
  tutorial: { title: 'First Descent', go: 'Begin the tutorial', busy: 'Descending…' },
};

/** Integer logo scale: 2x up to 1080p-class screens, 3x when there is room for it. */
function useLogoScale() {
  const [s, setS] = useState(2);
  useEffect(() => {
    const on = () => setS(window.innerWidth >= 1500 && window.innerHeight >= 900 ? 3 : 2);
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return s;
}

function Dialog({ title, tone, wide, onClose, children }: { title: string; tone: 'arcane' | 'ember'; wide?: boolean; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('.dialog-body input, .dialog-body button, .dialog-body a')?.focus();
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', on);
    return () => { window.removeEventListener('keydown', on); prev?.focus?.(); };
  }, []);
  return (
    <div className="menu-dialog" role="dialog" aria-modal="true" aria-labelledby="menu-dialog-h" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`frame ${tone} ornate dialog-panel${wide ? ' wide' : ''}`}>
        <div className="panel-head">
          <h2 id="menu-dialog-h" className="panel-title sm">{title}</h2>
          <button className="btn small ghost" onClick={onClose}>Back <span className="kbd">Esc</span></button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('title');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [classId, setClassId] = useState(CLASSES[0]?.id ?? 'vanguard');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [health, setHealth] = useState<'checking' | 'ok' | 'down'>('checking');
  const [build, setBuild] = useState<string>('');
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [code, setCode] = useState('');
  const [pane, setPane] = useState<Pane>('none');
  const [intent, setIntent] = useState<Intent>('solo');
  const [lan, setLan] = useState<{ enabled: boolean; hosts: string[]; note: string } | null>(null);
  const settings = useStore(settingsStore, (s) => s.s);
  const auth = useStore(authStore, (s) => s);
  const presence = useStore(presenceStore, (s) => s.conn);
  const logoScale = useLogoScale();
  const menuRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    try { if (sessionStorage.getItem(STAGE_KEY)) setStage('menu'); } catch { /* ignore */ }
    try { const v = localStorage.getItem(VESSEL_KEY); if (v && CLASS_BY_ID[v]) setClassId(v); } catch { /* ignore */ }
    initSettings();
    // the title theme (starts on the first key/click: "press any key" doubles as the browser's audio unlock)
    void sharedAudio().then((eng) => { eng?.setMusic(null); eng?.setSong('title'); });
    // back on the title screen means out of any party this tab hosted; friends see us in the menu
    stopHostBridge();
    startPresence();
    setStatus({ state: 'menu', joinable: false });
    api<{ build: string }>('GET', '/health').then((h) => { setHealth('ok'); setBuild(h.build); }).catch(() => setHealth('down'));
    api('GET', '/lan').then(setLan).catch(() => undefined);
    ensureProfile().then((p) => {
      setProfile(p); setName(p.displayName); initSettings(p.id);
      api<{ runs: RunItem[] }>('GET', `/runs?profileId=${p.id}&limit=20`).then((r) => setRuns(r.runs)).catch(() => undefined);
      const fav = authStore.get().account?.favoriteClass;
      if (fav && CLASS_BY_ID[fav] && !localStorage.getItem(VESSEL_KEY)) setClassId(fav);
    }).catch((e: ApiError) => setErr(e.message));
  }, []);

  // TITLE: any key (except bare navigation/modifier keys) or a click wakes the menu
  useEffect(() => {
    if (stage !== 'title') return;
    const wake = () => { setStage('menu'); try { sessionStorage.setItem(STAGE_KEY, '1'); } catch { /* ignore */ } };
    const onKey = (e: KeyboardEvent) => { if (['Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return; e.preventDefault(); wake(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', wake);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', wake); };
  }, [stage]);

  // MENU: focus the first plaque when the menu appears (keyboard players land on it)
  useEffect(() => {
    if (stage === 'menu' && pane === 'none') menuRef.current?.querySelector<HTMLElement>('.menu-item')?.focus({ preventScroll: true });
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseClass = (id: string) => { setClassId(id); try { localStorage.setItem(VESSEL_KEY, id); } catch { /* ignore */ } };

  const signedIn = auth.status === 'signedIn' && !!auth.account;

  const rename = async () => {
    if (!profile) throw new Error('Local profile unavailable — is the game service running?');
    if (signedIn || !name.trim() || name === profile.displayName) return profile;
    const p = await createProfile(name.trim(), false);
    setProfile(p); initSettings(p.id);
    return p;
  };

  const start = async (kind: 'solo' | 'daily' | 'tutorial' | 'coop') => {
    setBusy(kind); setErr(null);
    try {
      const p = await rename();
      const r = await api<{ roomId: string; code: string; seatToken: string; slot: number }>('POST', '/rooms', {
        profileId: p.id, mode: kind === 'coop' ? 'coop' : 'solo', classId, challenge: kind === 'daily' ? 'daily' : 'random', tutorial: kind === 'tutorial',
      });
      clearGuestSession();
      setSeat(r.roomId, r.seatToken, r.slot);
      // this tab hosts the co-op room: /play starts the peer-to-peer bridge for friends who join
      if (kind === 'coop') markHosting(r.roomId, r.code);
      router.push('/play');
    } catch (e) { setErr((e as Error).message); setBusy(null); }
  };

  /** Join a friend's (or a resolved code's) host over peer-to-peer. */
  const joinPeer = async (host: PeerId, roomCode: string) => {
    setBusy('join'); setErr(null);
    try {
      const seat = await joinViaHost(host, roomCode, classId);
      setSeat(seat.roomId, seat.seatToken, seat.slot);
      router.push('/play');
    } catch (e) { setErr((e as Error).message); setBusy(null); }
  };

  const join = async (asGuest = false) => {
    setBusy('join'); setErr(null);
    try {
      // online: a code first resolves to a host anywhere (peer-to-peer); unknown codes fall back to this authority / LAN
      if (!asGuest && presenceOnline()) {
        const host = await resolveCode(code);
        if (host) { await joinPeer(host, code.trim().toUpperCase()); return; }
      }
      clearGuestSession();
      let p = await rename();
      if (asGuest) p = await createProfile(`${(signedIn ? auth.account!.displayName : name) || 'Guest'} ${Math.floor(Math.random() * 90 + 10)}`, true);
      const r = await api<{ roomId: string; seatToken: string; slot: number }>('POST', `/rooms/${encodeURIComponent(code.trim().toUpperCase())}/join`, { profileId: p.id, classId });
      setSeat(r.roomId, r.seatToken, r.slot);
      router.push('/play');
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.code === 'DUPLICATE_PROFILE' ? 'This browser already holds a seat in that party. Use “Join as guest” to take a second seat from this browser.' : ae.message);
      setBusy(null);
    }
  };

  const resume = async (runId: string) => {
    setBusy(runId); setErr(null);
    try {
      const r = await api<{ roomId: string; seatToken: string; slot: number }>('POST', `/runs/${runId}/resume`, { profileId: profile!.id });
      clearGuestSession();
      setSeat(r.roomId, r.seatToken, r.slot);
      router.push('/play');
    } catch (e) { setErr((e as Error).message); setBusy(null); }
  };

  const openVessel = (i: Intent) => { setIntent(i); setErr(null); setPane('vessel'); };
  const go = () => { void start(intent); };

  const active = runs.filter((r) => r.status === 'active' && r.mode === 'solo' && r.round > 0);
  const offline = health !== 'ok';
  const best = runs.filter((r) => r.status !== 'active').reduce<RunItem | null>((b, r) => (!b || BigInt(r.scoreText) > BigInt(b.scoreText) ? r : b), null);
  const close = () => { setPane('none'); setErr(null); };
  const copy = INTENT_COPY[intent];
  const cls = CLASS_BY_ID[classId];

  // arrow keys walk the plaques; Home/End jump
  const onMenuKey = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('.menu-item') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    let j = -1;
    if (e.key === 'ArrowDown') j = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') j = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = items.length - 1;
    if (j < 0) return;
    e.preventDefault();
    items[j]?.focus();
  };

  return (
    <div className={`menu-root title-root stage-${stage}`}>
      <MenuBackdrop classId={classId} />
      <div className="vignette-screen" aria-hidden="true" />
      <EmberField intensity={stage === 'title' ? 1.4 : 0.8} spirit={stage === 'title' ? 0.65 : 0.5} />
      <div className="title-letterbox top" aria-hidden="true" />
      <div className="title-letterbox bottom" aria-hidden="true" />

      <div className="account-plate frame inset">
        {signedIn ? (
          <>
            <span className="ap-emblem" aria-hidden="true"><ClassEmblem classId={auth.account!.favoriteClass ?? classId} size={24} /></span>
            <span className="ap-who"><span className="ap-label">Signed in</span><b>{auth.account!.displayName}</b></span>
            <Link className="btn small ghost" href="/account">Account</Link>
          </>
        ) : (
          <>
            <span className="ap-who"><span className="ap-label">{auth.status === 'unknown' ? 'Checking…' : 'Guest'}</span><b>{profile?.displayName ?? 'Wanderer'}</b></span>
            <Link className="btn small" href="/account">Sign in</Link>
          </>
        )}
      </div>
      {stage === 'menu' && presence !== 'off' && <FriendsPanel busy={!!busy} onJoin={(host, roomCode) => { void joinPeer(host, roomCode); }} />}
      {presence !== 'off' && <InviteToasts busy={!!busy} onJoin={(i) => { void joinPeer(i.from, i.roomCode); }} />}

      <main id="main" className="title-main">
        <header className="title-logo">
          <SpectralHalo />
          <div className="menu-logo-row">
            <span className="torch" aria-hidden="true" />
            <h1>
              <span className="sr-only">Cursebound</span>
              <FireTitle text="CURSEBOUND" family='"Cinzel"' weight={900} fontPx={40} scale={stage === 'title' ? Math.min(4, logoScale + 1) : logoScale} fire="spirit" metal="moon" fallbackClassName="fire-fallback" />
            </h1>
            <span className="torch" aria-hidden="true" />
          </div>
          <div className="menu-tagline">A cooperative descent · every fate compounds</div>
          <hr className="rule title-rule" aria-hidden="true" />
        </header>

        {stage === 'title' ? (
          <button className="press-start" data-pad-any onClick={() => { setStage('menu'); try { sessionStorage.setItem(STAGE_KEY, '1'); } catch { /* ignore */ } }}>
            Press any key
          </button>
        ) : (
          <nav aria-label="Main menu" className="title-menu">
            <ul className="menu-list" ref={menuRef} onKeyDown={onMenuKey}>
              <li><button className="menu-item blood" aria-disabled={offline || !!busy} aria-haspopup="dialog" onClick={() => !offline && !busy && openVessel('solo')}>Descend <small>solo</small></button></li>
              <li><button className="menu-item" aria-disabled={offline || !!busy} aria-haspopup="dialog" onClick={() => !offline && !busy && openVessel('daily')}>Daily Rite <small>shared seed</small></button></li>
              <li><button className="menu-item" aria-haspopup="dialog" aria-expanded={pane === 'party'} onClick={() => setPane('party')}>Gather a Party <small>1–5</small></button></li>
              {active.length > 0 && <li><button className="menu-item" aria-haspopup="dialog" aria-expanded={pane === 'continue'} onClick={() => setPane('continue')}>Continue <small>{active.length} waiting</small></button></li>}
              {!settings.tutorialDone && <li><button className="menu-item" aria-disabled={offline || !!busy} aria-haspopup="dialog" onClick={() => !offline && !busy && openVessel('tutorial')}>First Descent <small>start here</small></button></li>}
              <li><Link className="menu-item" href="/account">{signedIn ? 'Account' : 'Sign In'}</Link></li>
            </ul>
            <div className="title-links">
              <Link className="btn small ghost" href="/records">Records</Link>
              <Link className="btn small ghost" href="/howto">Rules</Link>
              {settings.tutorialDone && <button className="btn small ghost" disabled={offline || !!busy} onClick={() => openVessel('tutorial')}>Tutorial</button>}
              <Link className="btn small ghost" href="/settings">Settings</Link>
            </div>
            {err && pane === 'none' && <div className="frame blood menu-error" role="alert">{err}</div>}
          </nav>
        )}

        <footer className="title-foot">
          <span className={`chip ${health === 'ok' ? 'good' : health === 'down' ? 'bad' : ''}`} role="status">{health === 'ok' ? 'Authority online' : health === 'down' ? 'Authority offline — run npm start' : 'Waking the authority…'}</span>
          {best && <span className="chip gold">Best {score(best.scoreText)}</span>}
          <span className="grow" />
          <span className="title-build">{build ? `v${build.replace(/^cursebound-/, '')}` : 'Cursebound'} · local-first</span>
        </footer>
      </main>

      {pane === 'vessel' && (
        <Dialog title={copy.title} tone="ember" wide onClose={close}>
          <div className="col vessel-select">
            {signedIn ? (
              <p className="muted vs-who">Descending as <b className="gold-text">{auth.account!.displayName}</b> <span className="faint">({auth.account!.username})</span> — this run is saved to your account.</p>
            ) : (
              <label className="name-row">
                <span className="engraved">Your name</span>
                <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} aria-label="Your name" />
                <Link className="faint vs-signin" href="/account">Sign in to keep your runs</Link>
              </label>
            )}
            <span className="engraved" id="cls-label">Choose your vessel</span>
            <ClassPicker value={classId} onChange={chooseClass} labelledBy="cls-label" idPrefix="title-vessel" />
            {err && <p className="neg" role="alert">{err}</p>}
            <div className="row vs-foot">
              <span className="grow" />
              <button className="btn big primary" disabled={offline || !!busy} onClick={go}>{busy ? copy.busy : `${copy.go} as ${cls?.name ?? 'vessel'}`}</button>
            </div>
          </div>
        </Dialog>
      )}

      {pane === 'party' && (
        <Dialog title="Gather a party" tone="arcane" onClose={close}>
          <div className="col">
            <p className="muted">Everyone shares every Fate vote. You choose vessels together in the party hall.</p>
            {!signedIn && (
              <label className="name-row">
                <span className="engraved">Your name</span>
                <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} aria-label="Your name" />
              </label>
            )}
            <button className="btn arcane" disabled={offline || !!busy} onClick={() => start('coop')}>{busy === 'coop' ? 'Opening…' : 'Open an invite room'}</button>
            <span className="engraved">Join with a code</span>
            <form className="row" onSubmit={(e) => { e.preventDefault(); if (code.length >= 6) void join(false); }}>
              <label className="sr-only" htmlFor="code">Room code</label>
              <input id="code" className="code-input" placeholder="CODE" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} />
              <button className="btn" type="submit" disabled={code.length < 6 || !!busy}>{busy === 'join' ? 'Joining…' : 'Join'}</button>
              <button className="btn ghost" type="button" disabled={code.length < 6 || !!busy} onClick={() => join(true)}>Join as guest</button>
            </form>
            {lan?.note && <p className="faint">{lan.note}</p>}
            {lan?.enabled && lan.hosts.length > 0 && <p>Friends open {lan.hosts.map((h) => <code key={h} className="host">{h}</code>)}</p>}
            {err && <p className="neg" role="alert">{err}</p>}
          </div>
        </Dialog>
      )}

      {pane === 'continue' && (
        <Dialog title="Unfinished descents" tone="ember" onClose={close}>
          <div className="col">
            <p className="muted">Runs resume from their last safe intermission (after a Fate commit).</p>
            <ul className="run-list">
              {active.slice(0, 6).map((r) => (
                <li key={r.id}>
                  <span className="run-round">Round {r.round}</span>
                  <b className="gold-text run-score">{score(r.scoreText)}</b>
                  {r.challengeId && <span className="chip gold">{r.challengeId}</span>}
                  <span className="grow" />
                  <button className="btn small" disabled={!!busy} onClick={() => resume(r.id)}>{busy === r.id ? 'Resuming…' : 'Resume'}</button>
                </li>
              ))}
            </ul>
            {err && <p className="neg" role="alert">{err}</p>}
          </div>
        </Dialog>
      )}
    </div>
  );
}
