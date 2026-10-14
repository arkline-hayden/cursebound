'use client';

import Link from 'next/link';
import { CLASSES, CLASS_BY_ID } from '@cursebound/content';
import { netStore, type GameConnection } from '@/lib/net';
import { useStore } from '@/lib/store';
import { ActorPortrait, actorFor } from './ClassPortrait';
import { ClassPicker } from './ClassPicker';

// LOBBY (PRD §16.1): invite code, roster, classes, readiness and trust mode. No host privileges.
// A gothic character-select hall sized to fit 1280x720: header with the code tablet, the shared vessel picker beside
// the gathered roster, and a pinned footer so Leave and Ready are always on screen.

export function Lobby({ net }: { net: GameConnection }) {
  const room = useStore(netStore, (s) => s.room);
  const slot = useStore(netStore, (s) => s.slot);
  if (!room) return null;
  const me = room.seats.find((s) => s.you);
  const solo = room.mode === 'solo';
  const title = solo ? (room.challengeId === 'tutorial' ? 'First Descent' : room.challengeId ? 'The Daily Rite' : 'Descend') : 'The Party Gathers';
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
          </div>
          {!solo && (
            <div className="lobby-code">
              <span className="engraved">Invite code</span>
              <span className="code" aria-label={`Invite code ${room.code.split('').join(' ')}`}>{room.code}</span>
              <button className="btn small" onClick={() => navigator.clipboard?.writeText(room.code)}>Copy</button>
            </div>
          )}
        </header>

        <div className="sheet-body lobby-body">
          <section className="lobby-vessel" aria-labelledby="lobby-cls">
            <span className="engraved" id="lobby-cls">{me?.ready ? 'Vessel locked — undo Ready to change' : 'Choose your vessel'}</span>
            <ClassPicker value={myClass} onChange={(id) => net.lobby({ classId: id })} disabled={!!me?.ready} labelledBy="lobby-cls" idPrefix="lobby-vessel" />
          </section>

          <section className="lobby-party" aria-labelledby="lobby-party-h">
            <span className="engraved" id="lobby-party-h">Party {room.seats.length}/{solo ? 1 : 5}</span>
            <ul className="roster" aria-live="polite">
              {room.seats.map((s) => (
                <li key={s.slot} className={`seat ${s.you ? 'you' : ''} ${s.connected ? '' : 'away'}`}>
                  <span className="seat-portrait"><ActorPortrait actor={actorFor(s.classId)} size={96} animate={s.ready && s.connected} /></span>
                  <span className="seat-info">
                    <span className="seat-name">{s.name}{s.you ? ' (you)' : ''}</span>
                    <span className="seat-line">
                      <span className="seat-class">{CLASS_BY_ID[s.classId]?.name ?? s.classId}</span>
                      <span className={`chip ${s.ready ? 'good' : s.connected ? '' : 'bad'}`}>{s.connected ? (s.ready ? 'Ready' : 'Choosing') : 'Offline'}</span>
                    </span>
                  </span>
                </li>
              ))}
              {!solo && room.seats.length < 5 && <li className="seat empty"><span className="seat-portrait" /><span className="seat-info"><span className="seat-name">Open seat</span><span className="seat-class">Share the code to fill it</span></span></li>}
            </ul>
            {!solo && (
              <p className="faint lobby-note">
                {room.lan.enabled ? <>Others on your network open {room.lan.hosts.join(' or ')} and join with the code.</> : <>Open another browser window here and join with the code. LAN sharing is off unless started with --lan.</>}
                {' '}The party size locks when everyone is ready.
              </p>
            )}
          </section>
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
