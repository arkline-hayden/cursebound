'use client';

import { useEffect, useState } from 'react';

// Desktop app only (docs/contracts/ONLINE_CONTRACT.md "Desktop app"): the shell downloads updates in the background
// and announces a ready one through `window.cursebound.updates`; the player restarts when it suits them. Renders
// nothing in the browser build or until an update is ready. (`window.cursebound` is typed in lib/cloudSession.ts.)
export function UpdateToast() {
  const [version, setVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const updates = window.cursebound?.updates;
    if (!updates) return;
    let live = true;
    updates.onReady((v) => { if (live) { setVersion(String(v)); setDismissed(false); } });
    return () => { live = false; };
  }, []);

  if (!version || dismissed) return null;
  // macOS builds can't replace themselves yet (no Developer ID signature): the button opens the download page
  const manual = !!window.cursebound?.updates?.manual;
  return (
    <div className="update-toast frame ember" role="status" aria-live="polite">
      <div className="update-toast-text">
        <span className="update-toast-title">{manual ? 'A new build is out' : 'A new build is ready'}</span>
        <span className="update-toast-ver">v{version}</span>
      </div>
      <p className="update-toast-note">{manual ? 'Co-op needs matching builds. Download it and install over this one; your progress is kept.' : 'Co-op needs matching builds. Restart so your friends can join you.'}</p>
      <div className="update-toast-actions">
        <button
          type="button"
          className="btn ember small"
          disabled={installing}
          onClick={() => { if (!manual) setInstalling(true); window.cursebound?.updates?.install(); }}
        >
          {manual ? 'Download update' : installing ? 'Restarting…' : 'Restart to update'}
        </button>
        <button type="button" className="btn ghost small" disabled={installing} onClick={() => setDismissed(true)}>Later</button>
      </div>
    </div>
  );
}
