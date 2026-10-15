'use client';

import type { RecapEntry } from '@cursebound/simulation';
import { RECAP_WINDOW_SEC } from '@cursebound/simulation';
import { whole } from '@/lib/format';
import { netStore } from '@/lib/net';
import { useStore } from '@/lib/store';
import { DTYPE_COLOR, DTYPE_WORD, attackName, blowText } from './breakdownText';
import { StatusIcon, statusDef } from './icons/statusIcons';

// A death recap (simulation runStats.ts): "Slain by Gloom Shade's Void Bolt: 312 frost", the hits of the last
// RECAP_WINDOW_SEC seconds as a pixel timeline (one pip per hit, the killing blow largest) with the few hits before
// it listed, and the debuffs active at the fall. Shared by the Results "Deaths" tab and the live spectate card.

export function RecapView({ recap, you, compact }: { recap: RecapEntry; you?: boolean; compact?: boolean }) {
  const verb = recap.final ? (you ? 'You died to' : 'Slain by') : (you ? 'You were downed by' : 'Downed by');
  const before = recap.hits.slice(0, -1).reverse().slice(0, compact ? 3 : 4);
  return (
    <div className="rc">
      <div className="rc-head">
        <span className="rc-verb">{verb}</span> <b className="rc-who">{blowText(recap.src, recap.atk)}</b>
        <span className="rc-amt" style={{ color: DTYPE_COLOR[recap.dt] }}>{whole(recap.amt)} {DTYPE_WORD[recap.dt] ?? recap.dt}</span>
      </div>
      <div className="rc-track" aria-hidden="true">
        {recap.hits.map((h, i) => {
          const last = i === recap.hits.length - 1;
          return <i key={i} className={last ? 'kb' : ''} style={{ left: `${Math.max(0, Math.min(1, 1 + h.t / RECAP_WINDOW_SEC)) * 100}%`, background: DTYPE_COLOR[h.dt] }} />;
        })}
        <span className="rc-t0">-{RECAP_WINDOW_SEC}s</span><span className="rc-t1">0</span>
      </div>
      {before.length > 0 && (
        <ul className="rc-hits">
          {before.map((h, i) => (
            <li key={i}>
              <span className="rc-time">{h.t.toFixed(1)}s</span>
              <span className="rc-atk">{h.atk === h.src ? h.src : `${attackName(h.atk)}`}{h.n && h.n > 1 ? ` ×${h.n}` : ''}{!compact && h.atk !== h.src ? <span className="faint"> · {h.src}</span> : null}</span>
              <span className="rc-hamt" style={{ color: DTYPE_COLOR[h.dt] }}>{whole(h.amt)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="rc-foot">
        {recap.debuffs.map((d) => <span key={d} className="hchip neg" style={{ color: statusDef(d).color }}><StatusIcon id={d} size={18} /><span className="hc-l">{statusDef(d).label}</span></span>)}
        <span className="faint">{whole(recap.total)} taken in {RECAP_WINDOW_SEC}s · {recap.hp > 0 && recap.hp < 0.01 ? '<1' : Math.round(recap.hp * 100)}% life before the blow</span>
      </div>
    </div>
  );
}

/** Live card while spectating (or downed): your latest fall this round. */
export function DeathRecapCard() {
  const recap = useStore(netStore, (s) => s.recap);
  if (!recap) return null;
  return <div className="rc-card frame inset" role="status" aria-live="polite"><RecapView recap={recap} you compact /></div>;
}
