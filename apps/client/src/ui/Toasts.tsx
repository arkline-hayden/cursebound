'use client';

import { useEffect, useRef, useState } from 'react';
import { sharedAudio } from '@/game/audio/shared';
import { netStore } from '@/lib/net';
import { useStore } from '@/lib/store';

// Explicit technical states (PRD §16.1): a technical error must never look like a lost vote.
export function Toasts() {
  const notices = useStore(netStore, (s) => s.notices);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const live = notices.filter((n) => now - n.at < (n.level === 'error' ? 12000 : 6000));
  // a soft chime for each new notice (errors use the denied buzz)
  const heard = useRef<Set<string | number> | null>(null);
  useEffect(() => {
    const seen = heard.current;
    heard.current = new Set(notices.map((n) => n.id));
    if (!seen) return;   // notices already up when the stack mounted stay quiet
    const fresh = notices.filter((n) => !seen.has(n.id) && Date.now() - n.at < 2000);
    if (fresh.length) void sharedAudio().then((e) => e?.play(fresh.some((n) => n.level === 'error') ? 'ui_error' : 'ui_toast'));
  }, [notices]);
  return (
    <div className="toast-stack" role="log" aria-live="polite">
      {live.map((n) => <div key={n.id} className={`toast ${n.level}`}>{n.text}</div>)}
    </div>
  );
}
