'use client';

import { netStore } from '@/lib/net';
import { useStore } from '@/lib/store';
import { fmt, score, wholeNum } from '@/lib/format';

// ROUND_CLEAR tally: each score component and the cumulative total (PRD §13.2), presented as a carved tally tablet.
export function ClearSummary() {
  const phase = useStore(netStore, (s) => s.phase);
  if (!phase) return null;
  const r = phase.rounds[phase.rounds.length - 1];
  if (!r) return null;
  const speed = Number(r.speedNum) / Number(r.speedDen);
  const pressure = r.pressure.replace(/^([0-9.]+)e(-?\d+)$/, (_m, a: string, b: string) => `${a.replace('.', '')}|${b}`);
  const boss = r.round % 5 === 0;
  const row = (label: string, value: string, i: number, color = 'var(--bone)') => (
    <div className="tally-row" style={{ animation: `rise 0.2s steps(3) ${0.15 + i * 0.12}s both` }}>
      <span className="tl">{label}</span>
      <span className="tv" style={{ color }}>{value}</span>
    </div>
  );
  return (
    <div className="overlay light">
      <div className="col center" role="status" style={{ gap: 16 }}>
        <div className="row" style={{ alignItems: 'flex-end', gap: 24, flexWrap: 'nowrap' }}>
          <span className="torch" aria-hidden="true" />
          <h2 className={`clear-title ${boss ? 'boss' : ''}`}>{boss ? 'Boss Slain' : 'Round Cleared'}</h2>
          <span className="torch" aria-hidden="true" />
        </div>
        <div className={`frame ornate tally ${boss ? 'blood dire' : ''}`}>
          {row(`Round ${r.round} base`, wholeNum(Number(r.basePoints)), 0)}
          {row('Score pressure', `×${fmt(pressure, 3)}`, 1)}
          {row(`Speed (${(r.activeTicks / 60).toFixed(0)}s / ${(r.referenceTicks / 60).toFixed(0)}s)`, `×${speed.toFixed(3)}`, 2, speed > 1 ? 'var(--good)' : 'var(--bone)')}
          <hr className="rule" />
          {row('Earned', `+${score(r.awarded)}`, 3, 'var(--gold)')}
          {row('Total', score(phase.scoreText), 4, 'var(--ember-hi)')}
        </div>
        <div className="panel-sub">The fallen rise at half health · the living mend a quarter</div>
      </div>
    </div>
  );
}
