'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LIMITS } from '@cursebound/protocol';
import { GameConnection, netStore } from '@/lib/net';
import { guestSession, guestTransport } from '@/lib/p2p/guest';
import { MID_RUN_JOIN, hostStore, hostingRecord, startHostBridge } from '@/lib/p2p/host';
import { setStatus, startPresence } from '@/lib/p2p/presence';
import { getSeat, cachedProfile } from '@/lib/profile';
import { initSettings, settingsStore, updateSettings } from '@/lib/settings';
import { useStore } from '@/lib/store';
import { Lobby } from '@/ui/Lobby';
import { Hud } from '@/ui/Hud';
import { SkillTree } from '@/ui/SkillTree';
import { DoorPanel } from '@/ui/DoorPanel';
import { Ledger } from '@/ui/Ledger';
import { Results } from '@/ui/Results';
import { PauseMenu } from '@/ui/PauseMenu';
import { Announcer } from '@/ui/Announcer';
import { Toasts } from '@/ui/Toasts';
import { GearLayer } from '@/ui/GearLayer';
import { ClearSummary } from '@/ui/ClearSummary';
import { TutorialHints } from '@/ui/TutorialHints';
import { Minimap } from '@/ui/Minimap';
import { CinematicOverlay } from '@/ui/CinematicOverlay';
import type { AudioEngine } from '@/game/audio/AudioEngine';
import { computeIntensity } from '@/game/audio/music';

const GameCanvas = dynamic(() => import('@/game/GameCanvas'), { ssr: false });

export default function Play() {
  const [net, setNet] = useState<GameConnection | null>(null);
  const [missing, setMissing] = useState(false);
  const [audio, setAudio] = useState<AudioEngine | null>(null);
  const [showLedger, setShowLedger] = useState(false);
  const [paused, setPaused] = useState(false);
  const [banner, setBanner] = useState<{ text: string; tone: string; id: number; sub?: string } | null>(null);
  const status = useStore(netStore, (s) => s.status);
  const error = useStore(netStore, (s) => s.error);
  const room = useStore(netStore, (s) => s.room);
  const phase = useStore(netStore, (s) => s.phase);
  const results = useStore(netStore, (s) => s.results);
  const serverPaused = useStore(netStore, (s) => s.paused);
  const welcome = useStore(netStore, (s) => s.welcome);
  const settings = useStore(settingsStore, (s) => s.s);
  const hosting = useStore(hostStore, (s) => s.room);
  const audioRef = useRef<AudioEngine | null>(null);

  useEffect(() => {
    const seat = getSeat();
    const p = cachedProfile();
    initSettings(p?.id);
    startPresence();
    if (!seat) { setMissing(true); return; }
    // a peer-to-peer guest reaches the room through the host's bridge; everyone else talks to their own authority
    const g = guestSession();
    const c = new GameConnection(seat.roomId, seat.token, g?.roomId === seat.roomId ? () => guestTransport(seat.roomId) : undefined);
    c.connect();
    setNet(c);
    // the tab that opened this co-op room hosts it for friends (the bridge outlives route changes)
    const h = hostingRecord();
    if (h?.roomId === seat.roomId) startHostBridge({ roomId: h.roomId, code: h.code, maxSeats: LIMITS.maxSeats });
    return () => { c.close(); };
  }, []);

  // presence: friends see the party, and Join while a co-op room this tab hosts has an open seat
  useEffect(() => {
    if (!room) return;
    const maxSeats = room.mode === 'solo' ? 1 : LIMITS.maxSeats;
    const state = room.stage === 'LOBBY' ? 'lobby' : 'run';
    const open = room.mode === 'coop' && room.seats.length < maxSeats && (state === 'lobby' || MID_RUN_JOIN);
    setStatus({
      state, joinable: open && hosting?.roomId === room.roomId, mode: room.mode, seats: room.seats.length, maxSeats,
      ...(room.mode === 'coop' ? { roomCode: room.code } : {}),
      ...(phase && state === 'run' ? { round: phase.round, ...(phase.map?.theme ? { theme: phase.map.theme } : {}) } : {}),
    });
  }, [room, hosting, phase?.round, phase?.map?.theme]); // eslint-disable-line react-hooks/exhaustive-deps

  // audio engine: created lazily, unlocked by the first explicit gesture (browser autoplay policy)
  useEffect(() => {
    let disposed = false;
    const unlock = async () => {
      if (audioRef.current) return;
      try {
        const { AudioEngine } = await import('@/game/audio/AudioEngine');
        if (disposed) return;
        const eng = new AudioEngine((text) => { if (settingsStore.get().s.captions) netStore.get() && window.dispatchEvent(new CustomEvent('cursebound:caption', { detail: text })); });
        await eng.unlock();
        audioRef.current = eng;
        setAudio(eng);
      } catch { /* audio is optional */ }
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => { disposed = true; window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); audioRef.current?.dispose(); };
  }, []);
  useEffect(() => { audio?.setVolumes(settings.volumes); }, [audio, settings.volumes]);
  // music (AUDIO): theme + boss + track per phase; the in-world door walk and intermissions keep the floor's song calm
  useEffect(() => {
    if (!audio) return;
    if (phase?.map?.theme) audio.setTheme(phase.map.theme);
    audio.setBoss(phase?.bossId ?? null);
    const ph = phase?.phase;
    if (!room || room.stage === 'LOBBY' || !phase || ph === 'LOADOUT_LOCK') audio.setMusic('menu');
    else if (ph === 'COMBAT' || ph === 'ROUND_SETUP') audio.setMusic(phase.bossId || phase.round % 5 === 0 ? 'boss' : 'combat');
    else if (ph === 'ROUND_CLEAR' || ph === 'SKILL_ALLOCATION' || ph === 'FATE_OFFER' || ph === 'VOTING' || ph === 'FATE_COMMIT' || ph === 'SAFE_CHECKPOINT') audio.setMusic('explore');
    else if (ph === 'PARTY_WIPE' || ph === 'RETIRE_REQUEST' || ph === 'RESULTS' || ph === 'FINALIZE') audio.setMusic(null);
    else if (ph !== 'RECOVERY') audio.setMusic('menu');
  }, [audio, room?.stage, phase?.phase, phase?.round, phase?.map?.theme, phase?.bossId]);
  // phase-entry stingers (CINEMA fires door_open / portal / round_start / boss_reveal / boss_roar itself)
  useEffect(() => {
    if (phase?.phase === 'ROUND_CLEAR') audio?.stinger('round_clear');
    else if (phase?.phase === 'PARTY_WIPE') audio?.stinger('party_wipe');
  }, [audio, phase?.phase, phase?.round]);
  // combat intensity for the adaptive music, ~4 Hz from the throttled HUD snapshot (engine adds hysteresis)
  useEffect(() => {
    if (!audio) return;
    const id = setInterval(() => { const s = netStore.get(); audio.setIntensity(computeIntensity(s.hud, s.slot)); }, 250);
    return () => clearInterval(id);
  }, [audio]);

  useEffect(() => {
    const onLedger = () => setShowLedger((v) => !v);
    const onPause = () => setPaused((v) => !v);
    const onBanner = (e: Event) => setBanner({ ...(e as CustomEvent).detail, id: Date.now() });
    window.addEventListener('cursebound:ledger', onLedger);
    window.addEventListener('cursebound:pause', onPause);
    window.addEventListener('cursebound:banner', onBanner);
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const keys = settingsStore.get().s.keys;
      // DOM-level shortcuts work during intermissions too (canvas listener only covers combat)
      // the canvas input already handles these while heroes move (combat and the in-world door vote)
      const inWorld = netStore.get().phase?.phase === 'COMBAT' || netStore.get().phase?.phase === 'VOTING';
      if (keys.ledger.includes(e.code) && !inWorld) { e.preventDefault(); setShowLedger((v) => !v); }
      if (keys.pause.includes(e.code) && !inWorld) { setPaused((v) => !v); }
      if (e.code === 'F3') { e.preventDefault(); updateSettings({ devOverlay: !settingsStore.get().s.devOverlay }); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('cursebound:ledger', onLedger);
      window.removeEventListener('cursebound:pause', onPause);
      window.removeEventListener('cursebound:banner', onBanner);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  // the round intro title card is part of the round-start cutscene (game/cinematic, ui/CinematicOverlay)
  useEffect(() => { net?.debug(settings.devOverlay); }, [net, settings.devOverlay, status]);
  useEffect(() => { if (showLedger) net?.requestLedger(0); }, [showLedger, net, phase?.round, phase?.phase]);
  useEffect(() => {
    // local solo pauses the authority while the menu is open; multiplayer combat continues (PRD §3.3)
    if (!net || !phase) return;
    if (phase.mode === 'solo' && phase.phase === 'COMBAT') net.pause(paused || showLedger);
  }, [paused, showLedger, net, phase?.mode, phase?.phase]);
  useEffect(() => {
    if (phase?.tutorial && phase.phase === 'RESULTS' && !settings.tutorialDone) updateSettings({ tutorialDone: true });
  }, [phase?.phase, phase?.tutorial, settings.tutorialDone]);

  const stage = room?.stage ?? 'LOBBY';
  const ph = phase?.phase ?? '';
  // solo: the vessel was already chosen on the title screen, so the lobby is skipped straight to the loadout
  const soloLobby = stage === 'LOBBY' && room?.mode === 'solo';
  const autoReadied = useRef(false);
  useEffect(() => {
    if (!net || !soloLobby || autoReadied.current) return;
    const me = room?.seats.find((x) => x.you);
    if (me && me.connected && !me.ready) { autoReadied.current = true; net.lobby({ ready: true }); }
  }, [net, soloLobby, room]);
  const overlay = useMemo(() => {
    if (!net || !room) return null;
    if (stage === 'LOBBY') return soloLobby ? <div className="overlay"><div className="descending" role="status">Descending…</div></div> : <Lobby net={net} />;
    if (ph === 'RESULTS' || ph === 'FINALIZE') return <Results net={net} />;
    if (ph === 'LOADOUT_LOCK' || ph === 'SKILL_ALLOCATION') return <SkillTree net={net} />;
    // the Fate vote happens in the world: walk through one of three themed doors (DoorPanel + render/Doors.ts)
    if (ph === 'VOTING' || ph === 'FATE_COMMIT' || ph === 'FATE_OFFER') return <DoorPanel net={net} onLedger={() => setShowLedger(true)} />;
    if (ph === 'ROUND_CLEAR') return <ClearSummary />;
    if (ph === 'RECOVERY') return (
      <div className="overlay"><div className="frame ember ornate crest notice-panel" role="alert">
        <h2 className="panel-title">Technical recovery</h2>
        <p>{phase?.incident ?? 'The authority stopped this run safely.'}</p>
        <p className="muted">This is not a party defeat. The run is checkpointed at its last safe intermission and its score evidence is retained; it is marked pending verification.</p>
        <hr className="rule" />
        <Link className="btn primary" href="/">Return home</Link>
      </div></div>
    );
    return null;
  }, [net, room, stage, ph, phase?.incident, soloLobby]);

  if (missing) {
    return (
      <main id="main" className="screen-center">
        <div className="vignette-screen" aria-hidden="true" />
        <div className="frame ornate crest notice-panel">
          <h1 style={{ margin: 0 }}>No seat in this tab</h1>
          <p className="muted">Start or join a run from the home screen first.</p>
          <hr className="rule" />
          <Link className="btn primary" href="/">Go home</Link>
        </div>
      </main>
    );
  }

  return (
    <div className="game-root">
      <h1 className="sr-only">CURSEBOUND {phase ? `round ${phase.round}` : 'lobby'}</h1>
      {net && stage === 'RUN' && <GameCanvas net={net} audio={audio} />}
      {net && stage === 'RUN' && <CinematicOverlay />}
      {net && stage === 'RUN' && (ph === 'COMBAT' || ph === 'ROUND_SETUP') && <Hud net={net} onLedger={() => setShowLedger(true)} onPause={() => setPaused(true)} />}
      {net && stage === 'RUN' && (ph === 'COMBAT' || ph === 'ROUND_SETUP' || ph === 'VOTING' || ph === 'FATE_COMMIT' || ph === 'FATE_OFFER') && <Minimap net={net} audio={audio} />}
      {phase?.tutorial && <TutorialHints />}
      <main id="main">{overlay}</main>
      {showLedger && net && <Ledger net={net} onClose={() => setShowLedger(false)} />}
      {(paused || (serverPaused.paused && serverPaused.reason !== 'client lost' && !showLedger)) && net && stage === 'RUN' && !results && (
        <PauseMenu net={net} onClose={() => { setPaused(false); net.pause(false); }} onLedger={() => { setPaused(false); setShowLedger(true); }} />
      )}
      {banner && <div key={banner.id} className={`banner ${['danger', 'good', 'info'].includes(banner.tone) ? banner.tone : ''} ${banner.sub ? '' : 'callout'}`} aria-hidden="true"><span className="bn-text">{banner.text}</span>{banner.sub && <span className="bn-sub">{banner.sub}</span>}</div>}
      {(status === 'reconnecting' || status === 'connecting') && (
        <div className="toast warn net-toast" role="status">
          {status === 'connecting' ? 'Connecting to the authority…' : 'Connection lost — reconnecting to your seat…'}
        </div>
      )}
      {error && status === 'error' && (
        <div className="overlay" role="alert" style={{ zIndex: 'var(--z-modal)' }}><div className="frame blood ornate dire crest notice-panel">
          <h2 className="panel-title blood-text">Connection closed</h2>
          <p>{error}</p>
          <hr className="rule" />
          <div className="row"><button className="btn primary" onClick={() => location.reload()}>Reload</button><Link className="btn" href="/">Return home</Link></div>
        </div></div>
      )}
      <Announcer />
      <Toasts />
      {net && stage === 'RUN' && <GearLayer net={net} />}
      {welcome && <span className="sr-only">Seat {welcome.slot + 1}</span>}
    </div>
  );
}
