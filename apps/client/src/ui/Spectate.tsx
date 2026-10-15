'use client';

import { useEffect } from 'react';
import { CLASS_BY_ID } from '@cursebound/content';
import { createStore, useStore } from '@/lib/store';
import { netStore } from '@/lib/net';
import { spectateCandidates, spectateTarget } from '@/game/spectate';
import { ClassEmblem } from './icons';

// SPECTATE: once your hero has fallen for the round (dead, not merely downed and waiting on a revive), the camera
// follows a teammate who is still standing. The HUD bar names who you are watching; ◀ ▶ or Q / E (also the arrow
// keys) cycle between them. The scene (CombatScene) reads `spectateStore` for its camera target.

export const spectateStore = createStore<{ slot: number | null }>({ slot: null });

type HudPlayer = { s: number; n: string; c: string; life: 'alive' | 'downed' | 'dead'; con: boolean };

export function SpectateBar() {
  const snap = useStore(netStore, (s) => s.hud);
  const me = useStore(netStore, (s) => s.slot);
  const chosen = useStore(spectateStore, (s) => s.slot);
  const players = (snap?.players ?? []) as HudPlayer[];
  const target = spectateTarget(players, me, chosen);
  const cands = spectateCandidates(players, me);

  const cycle = (dir: 1 | -1) => {
    if (!cands.length) return;
    const i = Math.max(0, cands.findIndex((p) => p.s === target));
    spectateStore.set({ slot: cands[(i + dir + cands.length) % cands.length]!.s });
  };
  const cycleRef = { current: cycle };
  cycleRef.current = cycle;

  useEffect(() => {
    if (target === null) return;
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'KeyQ' || e.code === 'ArrowLeft') { e.preventDefault(); cycleRef.current(-1); }
      else if (e.code === 'KeyE' || e.code === 'ArrowRight') { e.preventDefault(); cycleRef.current(1); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });
  // a new round (or a revive) puts the camera back on your own hero
  useEffect(() => { if (target === null && chosen !== null) spectateStore.set({ slot: null }); }, [target, chosen]);

  const mine = players.find((p) => p.s === me);
  if (mine?.life !== 'dead') return null;
  const watched = players.find((p) => p.s === target);
  if (!watched) return <div className="hud-msg dead">Fallen until the round is won</div>;
  return (
    <div className="spectate-bar frame inset" role="status" aria-live="polite">
      <span className="spectate-label">Fallen · spectating</span>
      <div className="spectate-row">
        <button type="button" className="btn small ghost" onClick={() => cycle(-1)} disabled={cands.length < 2} aria-label="Previous teammate">◀ <span className="kbd">Q</span></button>
        <span className="spectate-who">
          <ClassEmblem classId={watched.c} size={20} />
          <b>{watched.n}</b>
          <span className="faint">{CLASS_BY_ID[watched.c]?.name ?? ''}{watched.life === 'downed' ? ' · downed' : ''}</span>
        </span>
        <button type="button" className="btn small ghost" onClick={() => cycle(1)} disabled={cands.length < 2} aria-label="Next teammate"><span className="kbd">E</span> ▶</button>
      </div>
    </div>
  );
}
