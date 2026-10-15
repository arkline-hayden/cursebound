'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CLASS_BY_ID } from '@cursebound/content';
import { api } from '@/lib/api';
import type { GameConnection } from '@/lib/net';
import { clearSeat, ensureProfile, setSeat } from '@/lib/profile';
import { updateSettings } from '@/lib/settings';
import { FireTitle } from './FireTitle';

// The end of "First Descent" (a guided tutorial run; never recorded): a short "You're ready" card instead of the
// results sheet, leading back to the title or straight into a real solo run with the same vessel.

const LEARNED = ['Walk', 'Strike', 'Skills', 'Dodge', 'Loot', 'Fate doors'];

export function TutorialDone({ net, classId }: { net: GameConnection; classId: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const descend = async () => {
    setBusy(true); setErr(null);
    try {
      updateSettings({ tutorialDone: true });
      const p = await ensureProfile();
      const r = await api<{ roomId: string; seatToken: string; slot: number }>('POST', '/rooms', { profileId: p.id, mode: 'solo', classId, challenge: 'random' });
      net.close();
      setSeat(r.roomId, r.seatToken, r.slot);
      window.location.assign('/play');   // a fresh connection for the new room
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <div className="overlay">
      <div className="frame ember ornate crest notice-panel tut-done" role="region" aria-labelledby="tut-done-h">
        <h2 id="tut-done-h" className="res-title"><span className="sr-only">You&apos;re ready</span>
          <FireTitle text="You're Ready" family='"Jersey 10"' fontPx={30} scale={2} fire="ember" metal="bone" fallbackClassName="fire-fallback" />
        </h2>
        <div className="tut-learned">{LEARNED.map((x) => <span key={x} className="chip good done">{x}</span>)}</div>
        <p className="muted">Fate Cards stack for the whole run. The deeper you go, the more they compound.</p>
        {err && <p className="neg" role="alert">{err}</p>}
        <div className="row tut-done-foot">
          <Link className="btn" href="/" onClick={() => { updateSettings({ tutorialDone: true }); clearSeat(); net.close(); }}>Back to title</Link>
          <button className="btn primary big" disabled={busy} onClick={() => void descend()}>{busy ? 'Descending…' : `Descend as ${CLASS_BY_ID[classId]?.name ?? 'your vessel'}`}</button>
        </div>
      </div>
    </div>
  );
}
