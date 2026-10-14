'use client';

import { useEffect, useState } from 'react';
import { netStore } from '@/lib/net';
import { useStore } from '@/lib/store';

// Explicit technical states (PRD §16.1): a technical error must never look like a lost vote.
export function Toasts() {
  const notices = useStore(netStore, (s) => s.notices);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const live = notices.filter((n) => now - n.at < (n.level === 'error' ? 12000 : 6000));
  return (
    <div className="toast-stack" role="log" aria-live="polite">
      {live.map((n) => <div key={n.id} className={`toast ${n.level}`}>{n.text}</div>)}
    </div>
  );
}
