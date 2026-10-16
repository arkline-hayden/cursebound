'use client';

import Link from 'next/link';
import { GUIDE_STEPS } from '@cursebound/simulation';
import { netStore, type GameConnection } from '@/lib/net';
import { clearSeat } from '@/lib/profile';
import { keyCap, settingsStore, updateSettings, type Action } from '@/lib/settings';
import { padGlyph, padStore } from '@/lib/gamepad';
import { useStore } from '@/lib/store';
import { useEffect, useRef } from 'react';
import { playUiFile } from './uiCues';

// "First Descent" prompts (simulation tutorialRoom.ts, snapshot `gd`): one short line just below the hero (the
// camera keeps the hero dead centre), with the real bound keys — or controller glyphs while a pad is in use — and
// a tick on each finished part. It advances only when the authority sees the step done; Skip leaves for the title
// and marks the tutorial complete.

const TOTAL = GUIDE_STEPS.length;

export function TutorialGuide({ net }: { net: GameConnection }) {
  const snap = useStore(netStore, (s) => s.hud);
  const phase = useStore(netStore, (s) => s.phase?.phase);
  const keys = useStore(settingsStore, (s) => s.s.keys);
  const scheme = useStore(settingsStore, (s) => s.s.controlScheme);
  const pad = useStore(settingsStore, (s) => s.s.pad);
  const usingPad = useStore(padStore, (s) => s.usingPad);
  const fam = useStore(padStore, (s) => s.family);
  const slot = useStore(netStore, (s) => s.slot);
  const gd = snap?.gd;
  // a step completed: a rising sparkle, once per step (the "Done" flash, or the authority moving straight on)
  const finished = gd ? (gd.d < 0 ? gd.s : gd.s - 1) : null;
  const lastFinished = useRef<number | null>(null);
  useEffect(() => {
    if (finished === null) return;
    const prev = lastFinished.current;
    lastFinished.current = prev === null ? finished : Math.max(prev, finished);
    if (prev !== null && finished > prev) playUiFile('tutorial_step', 'ui_confirm', { priority: 5 });
  }, [finished]);
  if (!gd || (phase !== 'COMBAT' && phase !== 'VOTING') || gd.s >= TOTAL) return null;
  // beside a legendary its quick-compare (GearLayer) takes the centre and does the teaching: step aside
  const me = snap.players[slot];
  if (GUIDE_STEPS[gd.s] === 'loot' && me &&(snap.lt ?? []).some((it) => Math.hypot(it.x - me.x, it.y - me.y) < 2.8)) return null;
  const cap = (a: Action) => (usingPad ? padGlyph(pad[a]?.[0], fam) : keyCap(keys[a]?.[0]));
  const key = (a: Action | null, done = false, label?: string) => <span key={label ?? a ?? ''} className={`kbd${done ? ' tg-done' : ''}`}>{label ?? (a ? cap(a) : '')}</span>;
  const step = GUIDE_STEPS[gd.s];
  const done = gd.d < 0;
  let body: React.ReactNode;
  switch (step) {
    case 'move':
      body = usingPad ? <>Walk to the glowing mark {key(null, false, 'LS')}</>
        : scheme === 'wasd' ? <>Walk to the glowing mark {key('moveUp')}{key('moveLeft')}{key('moveDown')}{key('moveRight')}</>
        : <>Click the ground to walk to the glowing mark {key('attack')}</>;
      break;
    case 'attack':
      body = usingPad || scheme === 'wasd' ? <>Aim at the dummy and strike {key('attack')}</> : <>Click the dummy to strike it {key('attack')}</>;
      break;
    case 'skills':
      body = <>Cast each skill {key('skill1', (gd.d & 1) !== 0)}{key('skill2', (gd.d & 2) !== 0)}{key('skill3', (gd.d & 4) !== 0)}</>;
      break;
    case 'dodge':
      body = <>Red ground marks a coming blow. Dodge through it {key('dodge')}</>;
      break;
    case 'loot':
      body = (gd.d & 1) === 0 ? <>A legendary! Walk over it to wear it</> : <>Stand by the new one to compare it · swap {key('interact')}</>;
      break;
    case 'door':
      body = <>Each door binds a Fate Card: a gift and a price for the rest of the run. Walk through one</>;
      break;
  }
  return (
    <div className={`tg frame inset${done ? ' ok' : ''}`} role="status" aria-live="polite">
      <span className="tg-n">{Math.min(gd.s + 1, TOTAL)}/{TOTAL}</span>
      <span className="tg-t">{done ? <b className="tg-ok">Done</b> : body}</span>
      <Link className="btn small ghost tg-skip" href="/" onClick={() => { updateSettings({ tutorialDone: true }); clearSeat(); net.close(); }}>Skip</Link>
    </div>
  );
}
