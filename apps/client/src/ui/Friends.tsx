'use client';

import { useEffect, useRef, useState } from 'react';
import { CLASSES } from '@cursebound/content';
import { hostStore } from '@/lib/p2p/host';
import { dismissInvite, invite, presenceStore, type Friend, type Invite, type PeerId } from '@/lib/p2p/presence';
import { runtimeConfigSync } from '@/lib/runtime';
import { useStore } from '@/lib/store';
import { ClassEmblem } from './icons';
import { playUiFile } from './uiCues';

// Online-mode social bits (docs/contracts/ONLINE_CONTRACT.md): the friends plate on the title screen (who is online,
// what they are doing, Join), incoming party invites as pixel toasts, and the lobby's "Invite friends" picker.
// Lean on purpose: one line of state per friend, one action.

/** "In party · Round 4 · 2/5", "In menu", "Solo run", "Offline" */
export function friendLine(f: Friend): string {
  if (!f.online) return 'Offline';
  const s = f.status;
  if (!s || s.state === 'menu') return 'In menu';
  if (s.state === 'away') return 'Away';
  if (s.mode === 'solo') return 'Solo run';
  const seats = s.seats !== undefined && s.maxSeats ? ` · ${s.seats}/${s.maxSeats}` : '';
  return `In party · ${s.state === 'lobby' ? 'Gathering' : `Round ${s.round ?? 1}`}${seats}`;
}

type JoinState = { kind: 'join'; code: string } | { kind: 'update' } | { kind: 'full' } | { kind: 'none' };

export function joinState(f: Friend, myBuild: string | null): JoinState {
  const s = f.status;
  if (!f.online || !s || s.mode !== 'coop' || !s.roomCode) return { kind: 'none' };
  if (s.seats !== undefined && s.maxSeats !== undefined && s.seats >= s.maxSeats) return { kind: 'full' };
  if (!s.joinable) return { kind: 'none' };
  if (myBuild && s.build !== myBuild) return { kind: 'update' };
  return { kind: 'join', code: s.roomCode };
}

const fallbackClass = CLASSES[0]?.id ?? 'vanguard';

export function FriendsPanel({ busy, onJoin }: { busy: boolean; onJoin: (host: PeerId, code: string) => void }) {
  const friends = useStore(presenceStore, (s) => s.friends);
  const conn = useStore(presenceStore, (s) => s.conn);
  const [open, setOpen] = useState(true);
  const build = runtimeConfigSync()?.build ?? null;
  const online = friends.filter((f) => f.online).length;
  return (
    <aside className="friends-panel frame inset" aria-label="Friends">
      <div className="fp-head">
        <span className="engraved fp-title">Friends <small className="faint">{online}/{friends.length}</small></span>
        <button className="btn small ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (conn !== 'online' ? (
        <p className="faint fp-note" role="status">{conn === 'retrying' ? 'Reconnecting…' : 'Connecting…'}</p>
      ) : friends.length === 0 ? (
        <p className="faint fp-note">No friends yet. Add them from your account page.</p>
      ) : (
        <ul className="friends-list">
          {friends.map((f) => {
            const j = joinState(f, build);
            return (
              <li key={f.accountId} className={`friend-row${f.online ? '' : ' offline'}`}>
                <span className="fr-emblem" aria-hidden="true"><ClassEmblem classId={f.favoriteClass ?? fallbackClass} size={24} /></span>
                <span className="fr-who">
                  <b className="fr-name">{f.displayName}</b>
                  <span className={`fr-state${j.kind === 'join' ? ' joinable' : ''}`}>{friendLine(f)}</span>
                </span>
                {j.kind === 'join' && <button className="btn small arcane" disabled={busy} onClick={() => onJoin(f, j.code)}>Join</button>}
                {j.kind === 'update' && <span className="chip warn fr-tag" title="You and this friend run different builds">Update to join</span>}
                {j.kind === 'full' && <span className="chip fr-tag">Full</span>}
              </li>
            );
          })}
        </ul>
      ))}
    </aside>
  );
}

export function InviteToasts({ busy, onJoin }: { busy: boolean; onJoin: (inv: Invite) => void }) {
  const invites = useStore(presenceStore, (s) => s.invites);
  // invites fade after a minute: the host's party may have filled or started by then
  useEffect(() => {
    if (!invites.length) return;
    const id = setInterval(() => { for (const i of presenceStore.get().invites) if (Date.now() - i.at > 60_000) dismissInvite(i.id); }, 5000);
    return () => clearInterval(id);
  }, [invites.length]);
  // a fresh invite: raven wings and a chime (invites already up when the toasts mount stay quiet; a re-sent invite
  // from the same party is a new arrival)
  const latest = invites.reduce((a, i) => Math.max(a, i.at), 0);
  const heardAt = useRef<number | null>(null);
  useEffect(() => {
    const prev = heardAt.current;
    heardAt.current = Math.max(prev ?? 0, latest);
    if (prev !== null && latest > prev && Date.now() - latest < 5000) playUiFile('invite_received', 'ui_toast', { priority: 5 });
  }, [latest]);
  if (!invites.length) return null;
  return (
    <div className="invite-toasts" aria-live="polite">
      {invites.map((i) => (
        <div key={i.id} className="toast invite-toast" role="alert">
          <span className="it-text"><b className="gold-text">{i.from.displayName}</b> calls you to their party</span>
          <button className="btn small arcane" disabled={busy} onClick={() => { dismissInvite(i.id); onJoin(i); }}>Join</button>
          <button className="btn small ghost" onClick={() => dismissInvite(i.id)}>Dismiss</button>
        </div>
      ))}
    </div>
  );
}

/** Lobby control for the host of a co-op room: online friends not already in a party, one Invite each. */
export function InviteFriends() {
  const conn = useStore(presenceStore, (s) => s.conn);
  const friends = useStore(presenceStore, (s) => s.friends);
  const hosting = useStore(hostStore, (s) => s.room);
  const guests = useStore(hostStore, (s) => s.guests);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<Record<string, number>>({});
  if (conn !== 'online' || !hosting) return null;
  const busyElsewhere = (f: Friend) => f.status?.mode === 'coop' && (f.status.state === 'lobby' || f.status.state === 'run');
  const candidates = friends.filter((f) => f.online && !guests.some((g) => g.accountId === f.accountId) && !busyElsewhere(f));
  return (
    <div className="invite-friends">
      <button className="btn small arcane" aria-expanded={open} onClick={() => setOpen((v) => !v)}>Invite friends</button>
      {open && (
        <div className="invite-pop frame inset" role="dialog" aria-label="Invite friends">
          {candidates.length === 0 ? <p className="faint fp-note">No friends free to invite right now.</p> : (
            <ul className="friends-list">
              {candidates.map((f) => {
                const done = (sent[f.accountId] ?? 0) > Date.now() - 15_000;
                return (
                  <li key={f.accountId} className="friend-row">
                    <span className="fr-emblem" aria-hidden="true"><ClassEmblem classId={f.favoriteClass ?? fallbackClass} size={24} /></span>
                    <span className="fr-who"><b className="fr-name">{f.displayName}</b><span className="fr-state">{friendLine(f)}</span></span>
                    <button className="btn small" disabled={done} onClick={() => { if (invite(f.accountId)) setSent((s) => ({ ...s, [f.accountId]: Date.now() })); }}>{done ? 'Sent' : 'Invite'}</button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
