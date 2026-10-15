'use client';

import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { CLASSES, CLASS_BY_ID, FUTURE_CLASSES, type ClassDef } from '@cursebound/content';
import { wholeNum } from '@/lib/format';
import { ClassPortrait } from './ClassPortrait';
import { readableAccent } from './classTheme';

// Vessel (class) picker shared by the title screen and the lobby: a 5-column grid of carved portrait tiles built
// generically from CLASSES (ten heroes fit in two rows at 1280x720), plus a detail pane for the hovered or chosen
// class. A radio group with roving focus: arrow keys move and choose, Home/End jump.

const COLS = 5;

export function ClassPicker({ value, onChange, disabled = false, labelledBy, idPrefix = 'vessel' }: {
  value: string; onChange: (id: string) => void; disabled?: boolean; labelledBy: string; idPrefix?: string;
}) {
  const [peek, setPeek] = useState<string | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const shown = CLASS_BY_ID[peek ?? value] ?? CLASS_BY_ID[value] ?? CLASSES[0];
  const current = Math.max(0, CLASSES.findIndex((c) => c.id === value));
  const future = FUTURE_CLASSES.filter((f) => !CLASS_BY_ID[f.id]).slice(0, Math.max(0, 10 - CLASSES.length));
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = CLASSES.length;
    let j = i;
    if (e.key === 'ArrowRight') j = (i + 1) % n;
    else if (e.key === 'ArrowLeft') j = (i - 1 + n) % n;
    else if (e.key === 'ArrowDown') j = i + COLS < n ? i + COLS : i;
    else if (e.key === 'ArrowUp') j = i - COLS >= 0 ? i - COLS : i;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = n - 1;
    else return;
    e.preventDefault();
    refs.current[j]?.focus();
    if (!disabled) onChange(CLASSES[j].id);
  };
  const detailId = `${idPrefix}-detail`;
  return (
    <div className="vessel">
      <div role="radiogroup" aria-labelledby={labelledBy} aria-describedby={detailId} className="vessel-grid" onMouseLeave={() => setPeek(null)}>
        {CLASSES.map((c, i) => {
          const sel = c.id === value;
          return (
            <button key={c.id} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={sel} aria-disabled={disabled || undefined}
              aria-label={`${c.name}: ${c.role}`} tabIndex={i === current ? 0 : -1}
              className="vessel-tile" style={{ '--accent': readableAccent(c.accent) } as CSSProperties}
              onClick={() => { if (!disabled) onChange(c.id); }} onMouseEnter={() => setPeek(c.id)} onFocus={() => setPeek(c.id)} onBlur={() => setPeek(null)}
              onKeyDown={(e) => onKey(e, i)}>
              <span className="vt-frame"><ClassPortrait classId={c.id} size={96} animate={sel} /></span>
              <span className="vt-name">{c.name}</span>
            </button>
          );
        })}
        {future.map((f) => (
          <span key={f.id} className="vessel-tile sealed" aria-hidden="true" title={`${f.name}: coming later`}>
            <span className="vt-frame" />
            <span className="vt-name">{f.name}</span>
          </span>
        ))}
      </div>
      <VesselDetail id={detailId} cls={shown} chosen={shown.id === value} />
    </div>
  );
}

function VesselDetail({ id, cls, chosen }: { id: string; cls: ClassDef; chosen: boolean }) {
  return (
    <div id={id} className={`vessel-detail ${chosen ? 'chosen' : ''}`} style={{ '--accent': readableAccent(cls.accent) } as CSSProperties}>
      <div className="vd-head">
        <span className="vd-portrait"><ClassPortrait classId={cls.id} size={96} animate /></span>
        <div className="vd-title">
          <span className="vd-name">{cls.name}</span>
          <span className="vd-role">{cls.role}</span>
          <span className="vd-tag">{chosen ? 'Your vessel' : 'Preview'}</span>
        </div>
      </div>
      <ul className="vd-branches" aria-label="Skill branches">
        {cls.branches.map((b) => <li key={b.id}><b>{b.name}</b><span>{b.theme}</span></li>)}
      </ul>
      <dl className="vd-stats">
        <div><dt>Life</dt><dd>{wholeNum(cls.base.maxHealth)}</dd></div>
        <div><dt>Armor</dt><dd>{wholeNum(cls.base.armor)}</dd></div>
      </dl>
    </div>
  );
}
