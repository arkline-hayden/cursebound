'use client';

import Link from 'next/link';
import { BOUNTY_BY_ID, CLASSES, CLASS_BY_ID } from '@cursebound/content';
import { netStore, type GameConnection } from '@/lib/net';
import { presenceStore } from '@/lib/p2p/presence';
import { progressStore, refreshProgress } from '@/lib/progress';
import { authStore } from '@/lib/auth';
import { cachedProfile } from '@/lib/profile';
import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { LobbyVessels } from './VesselSelect';
import { InviteFriends } from './Friends';

// LOBBY (PRD §16.1): invite code, roster, classes, readiness and trust mode. No host privileges.
// A gothic character-select hall sized to fit 1280x720: header with the code tablet, the party stage (every member's
// hero on a portal plinth with their name over it, yours in the centre; ui/VesselSelect.tsx) above the class strip,
// and a pinned footer so Leave and Ready are always on screen.
// Online, the host of a co-op room also gets "Invite friends" beside the code (friends join peer-to-peer).

export function Lobby({ net }: { net: GameConnection }) {
  const room = useStore(netStore, (s) => s.room);
  const slot = useStore(netStore, (s) => s.slot);
  const online = useStore(presenceStore, (s) => s.conn === 'online');
  const level = useStore(progressStore, (s) => s.progress?.level ?? null);   // locked classes (progression)
  useEffect(() => { if (!progressStore.get().progress) void refreshProgress(authStore.get().account?.profileId ?? cachedProfile()?.id ?? null); }, []);
  if (!room) return null;
  const me = room.seats.find((s) => s.you);
  const solo = room.mode === 'solo';
  const title = solo ? (room.challengeId === 'tutorial' ? 'First Descent' : room.challengeId ? 'The Daily Rite' : room.bounty ? 'The Daily Bounty' : 'Descend') : 'The Party Gathers';
  const bounty = room.bounty ? BOUNTY_BY_ID[room.bounty] : null;
  const ready = room.seats.filter((s) => s.ready).length;
  const myClass = me?.classId ?? CLASSES[0]?.id ?? 'vanguard';
  return (
    <div className="overlay">
      <div className="frame ornate crest sheet fit lobby-sheet" role="region" aria-labelledby="lobby-h">
        <header className="lobby-head">
          <div className="lobby-title">
            <span className="torch" aria-hidden="true" />
            <h2 id="lobby-h" className="lobby-h">{title}</h2>
            <span className="torch" aria-hidden="true" />
          </div>
          <div className="lobby-meta">
            <span className="chip">{room.trust === 'lan' ? 'LAN · local records' : 'Local records'}</span>
            {room.challengeId && <span className="chip gold">{room.challengeId}</span>}
            {bounty && <span className="chip warn" data-tip={bounty.description}>Bounty · {bounty.name}</span>}
          </div>
          {!solo && (
            <div className="lobby-code">
              <span className="engraved">Invite code</span>
              <span className="code" aria-label={`Invite code ${room.code.split('').join(' ')}`}>{room.code}</span>
              <button className="btn small" onClick={() => navigator.clipboard?.writeText(room.code)}>Copy</button>
              <InviteFriends />
            </div>
          )}
        </header>

        <div className="sheet-body lobby-body">
          <span className="engraved" id="lobby-party-h">Party {room.seats.length}/{solo ? 1 : 5}</span>
          <ul className="sr-only" aria-labelledby="lobby-party-h" aria-live="polite">
            {room.seats.map((s) => <li key={s.slot}>{s.name}{s.you ? ' (you)' : ''}: {CLASS_BY_ID[s.classId]?.name ?? s.classId}, {s.connected ? (s.ready ? 'ready' : 'choosing') : 'offline'}</li>)}
          </ul>
          <LobbyVessels seats={room.seats} maxSeats={solo ? 1 : 5} myClass={myClass} level={level} disabled={!!me?.ready} onChoose={(id) => net.lobby({ classId: id })} labelledBy="lobby-cls"
            pickHeading={<span className="engraved" id="lobby-cls">{me?.ready ? 'Vessel locked — undo Ready to change' : 'Choose your vessel'}</span>} />
          {!solo && (
            <p className="faint lobby-note">
              {online ? <>Friends join from their friends list, or anywhere with the code.</> : room.lan.enabled ? <>Others on your network open {room.lan.hosts.join(' or ')} and join with the code.</> : <>Open another browser window here and join with the code. LAN sharing is off unless started with --lan.</>}
              {' '}The party size locks when everyone is ready.
            </p>
          )}
        </div>

        <footer className="sheet-foot lobby-foot">
          <Link className="btn ghost" href="/">Leave</Link>
          <span className="grow" />
          {!solo && <span className="foot-note">{ready}/{room.seats.length} ready</span>}
          <button className={`btn big ${me?.ready ? '' : 'primary'}`} onClick={() => net.lobby({ ready: !me?.ready })}>
            {me?.ready ? 'Not ready' : solo ? 'To the loadout' : 'Ready'}
          </button>
        </footer>
        <span className="sr-only">You are seat {slot + 1}</span>
      </div>
    </div>
  );
}
