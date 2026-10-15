'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { netStore, type GameConnection } from '@/lib/net';
import { useStore } from '@/lib/store';
import { SettingsPanel } from './SettingsPanel';

// Pause / menu (PRD §3.3): retirement is always available. Solo confirms once; multiplayer needs a majority of
// the frozen roster (disconnected players abstain; a tie continues). Local solo pauses; multiplayer continues.
// Presented as a Diablo-style escape menu: a carved panel with large stone plaques. The body scrolls inside the
// panel (settings can be long) so the panel always fits the screen.

export function PauseMenu({ net, onClose, onLedger }: { net: GameConnection; onClose: () => void; onLedger: () => void }) {
  const phase = useStore(netStore, (s) => s.phase);
  const slot = useStore(netStore, (s) => s.slot);
  const [confirm, setConfirm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  if (!phase) return null;
  const solo = phase.mode === 'solo';
  const myRetire = phase.retire.includes(slot);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="pause-h" style={{ zIndex: 'var(--z-modal)' }}>
      <div className={`frame sheet fit ornate crest pause-panel ${showSettings ? 'wide' : ''}`}>
        <header>
          <h2 id="pause-h" className="panel-title pause-title">{solo ? 'Paused' : 'Menu'}</h2>
          {!solo && <p className="warn-line">Multiplayer combat continues while this menu is open.</p>}
        </header>
        <div className="sheet-body">
          <button ref={first} className="menu-item blood" onClick={onClose}>Resume</button>
          <button className="menu-item" onClick={onLedger}>Fate Ledger</button>
        <button className="menu-item" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('cursebound:inventory')); }}>Legendary Gear</button>
          <button className="menu-item" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>Settings</button>
          {showSettings && <div className="well" style={{ textAlign: 'left' }}><SettingsPanel compact /></div>}
          <hr className="rule" />
          {phase.training ? (
            // training grounds: nothing to retire or bank, just leave (the room is discarded, never recorded)
            <Link className="btn danger" href="/">Leave the training grounds</Link>
          ) : !confirm ? (
            <button className="btn danger" onClick={() => setConfirm(true)}>{solo ? 'Retire run…' : myRetire ? 'Withdraw retire vote' : 'Vote to retire…'}</button>
          ) : (
            <div className="well col" style={{ textAlign: 'left' }}>
              <p>Retiring banks every cleared round and any finished objectives this round. It never counts as a victory or a defeat.</p>
              {!solo && <p className="muted">Needs a majority of the {phase.n}-player roster. Current retire votes: {phase.retire.length}.</p>}
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="btn danger" onClick={() => { net.retire(!myRetire); setConfirm(false); if (solo) onClose(); }}>{myRetire ? 'Withdraw' : 'Confirm retire'}</button>
                <button className="btn" onClick={() => setConfirm(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
        <footer className="sheet-foot pause-foot">
          <span>Seed <code>{phase.seed}</code> · {phase.trust === 'lan' ? 'LAN' : 'Local'} records{phase.practice ? ' · practice attempt' : ''}{phase.resumed ? ' · resumed' : ''}</span>
        </footer>
      </div>
    </div>
  );
}
