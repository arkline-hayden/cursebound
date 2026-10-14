'use client';

import { useEffect, useState } from 'react';
import { netStore } from '@/lib/net';
import { settingsStore, keyLabel, setControlScheme, updateSettings } from '@/lib/settings';
import { useStore } from '@/lib/store';

// First-run teaching (PRD §16.3): short contextual hints, never several dismissals while enemies attack.
export function TutorialHints() {
  const phase = useStore(netStore, (s) => s.phase);
  const hud = useStore(netStore, (s) => s.hud);
  const keys = useStore(settingsStore, (s) => s.s.keys);
  const scheme = useStore(settingsStore, (s) => s.s.controlScheme);
  const notice = useStore(settingsStore, (s) => s.s.controlsNotice);
  const [hidden, setHidden] = useState(false);
  useEffect(() => setHidden(false), [phase?.phase]);
  if (!phase) return null;
  // one-time notice after a WASD-era save moved to click-to-move
  if (notice && phase.phase !== 'COMBAT') {
    return (
      <div role="note" style={{ bottom: 'calc(var(--ov-pad) + 112px)' }} className="hint frame ember ornate">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <span><b className="hint-title">Controls</b><span className="hint-text">Click to move is now the default: click the ground to walk, click a foe to attack it. Skills moved to {keyLabel(keys.skill1[0] ?? 'KeyQ')} {keyLabel(keys.skill2[0] ?? 'KeyW')} {keyLabel(keys.skill3[0] ?? 'KeyE')} {keyLabel(keys.signature[1] ?? keys.signature[0] ?? 'KeyR')}. Keyboard (WASD) stays available in Settings › Controls.</span></span>
          <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
            <button className="btn small ghost" onClick={() => setControlScheme('wasd')}>Use WASD</button>
            <button className="btn small" onClick={() => updateSettings({ controlsNotice: false })}>Got it</button>
          </span>
        </div>
      </div>
    );
  }
  if (hidden) return null;
  let text = '';
  if (phase.phase === 'LOADOUT_LOCK') text = 'Pick one node to equip your first active skill (for example Guard Stance or Arc Bolt), then begin round 1.';
  else if (phase.phase === 'COMBAT' && phase.round === 1) {
    const telegraph = (hud?.telegraphs.length ?? 0) > 0;
    text = telegraph
      ? `Red shapes are enemy attacks about to land. Step out — or dodge with ${keyLabel(keys.dodge[0])} for brief invulnerability.`
      : scheme === 'wasd'
        ? `Move with ${keys.moveUp.map(keyLabel)[0]}${keys.moveLeft.map(keyLabel)[0]}${keys.moveDown.map(keyLabel)[0]}${keys.moveRight.map(keyLabel)[0]}, aim with the mouse, hold ${keyLabel(keys.attack[0])} to attack. ${keyLabel(keys.skill1[0])}/${keyLabel(keys.skill2[0])}/${keyLabel(keys.skill3[0])} cast skills, ${keyLabel(keys.signature[0])} your signature.`
        : `${keyLabel(keys.attack[0] ?? 'Mouse0')} the ground to walk, or a foe to attack it (hold to keep going). Hold ${keyLabel(keys.forceAttack[0] ?? 'ShiftLeft')} to attack in place. ${keyLabel(keys.skill1[0])}/${keyLabel(keys.skill2[0])}/${keyLabel(keys.skill3[0])} cast skills at the cursor, ${keyLabel(keys.signature[0])} your signature, ${keyLabel(keys.dodge[0])} dodges toward the cursor.`;
  } else if (phase.phase === 'VOTING' && phase.round === 1) text = 'Fate Cards multiply: +100% damage means ×2 your current damage, and every negative compounds too. Open the full forecast to see exactly what changes, then lock your vote.';
  else if (phase.phase === 'SKILL_ALLOCATION' && phase.round === 1) text = 'You earn 1 skill point per round (2 after a boss). Spend before each Fate offer.';
  else if (phase.phase === 'COMBAT' && phase.round === 2) text = `Press ${keyLabel(keys.ledger[0])} any time to open the Fate Ledger. Can you find why enemy health changed?`;
  if (!text) return null;
  // in combat, sit below the party plates (about 80px each, scaled with the HUD zoom); on intermission screens, dock
  // bottom-left above the pinned footer so the sheet header and primary actions stay visible
  const party = hud?.players.length ?? phase.players.length;
  const pos = phase.phase === 'COMBAT' ? { top: `calc(${party * 80 + 24}px * var(--hud-zoom))` } : { bottom: 'calc(var(--ov-pad) + 112px)' };
  return (
    <div role="note" style={pos} className="hint frame ember ornate">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <span><b className="hint-title">Tutorial</b><span className="hint-text">{text}</span></span>
        <button className="btn small ghost" onClick={() => setHidden(true)} aria-label="Hide tip">Hide</button>
      </div>
    </div>
  );
}
