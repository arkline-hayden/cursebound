'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { CLASSES, SKILL_BY_ID, classUnlockLevel, type ClassDef } from '@cursebound/content';
import { announceText, lockInfo, partyOrder, stepIndex, type LockInfo } from '@/game/vessel/layout';
import { vesselPickSfx, type SfxId } from '@/game/audio/sfx';
import { sharedAudio } from '@/game/audio/shared';
import { wholeNum } from '@/lib/format';
import { padGlyph, padStore } from '@/lib/gamepad';
import { useStore } from '@/lib/store';
import { ClassPortrait } from './ClassPortrait';
import { readableAccent } from './classTheme';
import { ClassEmblem, NodeIcon } from './icons';
import { VesselStage, type StageSlotView, type VesselStageHandle } from './VesselStage';

// VESSEL SELECT. The title's character select ("Choose your vessel", the Daily Rite, the bounty and First Descent)
// is a full-screen hall: every class stands on a plinth in an isometric portal chamber (VesselStage), locked ones
// as chained silhouettes on dormant plinths. The highlight walks the lineup (click a hero, arrows or A / D, the
// controller's D-pad); the chosen hero steps into the spotlight while their portal erupts with their class's magic.
// Confirm (Enter, the button, clicking the chosen hero again, A on a controller) flares the portal and the hero steps
// down into it before the run starts (any key or click skips). The co-op lobby uses the same stage as a party
// line-up: each member's hero on their own plinth with their name above, yours in the centre.

const N = CLASSES.length;
const indexOf = (id: string) => Math.max(0, CLASSES.findIndex((c) => c.id === id));
const lockOf = (c: ClassDef, level: number | null) => lockInfo(classUnlockLevel(c.id), level);

/** Vessel Select sounds: a whoosh as the highlight moves, the class's sting (throttled while scrolling) or a locked thunk. */
function useVesselSfx() {
  const last = useRef(0);
  return useMemo(() => {
    const play = (id: SfxId, pan?: number) => { void sharedAudio().then((e) => e?.play(id, pan === undefined ? {} : { pan })); };
    return {
      move(classId: string, locked: boolean, pan: number) {
        play('vessel_shift', pan);
        if (locked) { play('vessel_locked', pan); return; }
        const now = performance.now();
        if (now - last.current > 140) { last.current = now; play(vesselPickSfx(classId), pan); }
      },
      hover: () => play('ui_hover'),
      roar: () => play('vessel_roar'),
      denied: (pan: number) => play('vessel_locked', pan),
    };
  }, []);
}

const panOf = (i: number, n: number) => (n > 1 ? ((i - (n - 1) / 2) / ((n - 1) / 2)) * 0.45 : 0);

// ------------------------------------------------------------------------------------------------ info panel

/** The highlighted class: name, role, lock or "Your vessel", starting skills with icons, life and armor. */
export function VesselInfo({ id, cls, lock, chosen, compact = false }: { id?: string; cls: ClassDef; lock: LockInfo; chosen: boolean; compact?: boolean }) {
  const skills = [SKILL_BY_ID[cls.basicSkill], SKILL_BY_ID[cls.signatureSkill]].filter((s) => !!s);
  return (
    <section id={id} className={`vinfo frame inset${lock.locked ? ' locked' : ''}${compact ? ' compact' : ''}`} style={{ '--accent': readableAccent(cls.accent) } as CSSProperties} aria-label={`${cls.name} details`}>
      <div className="vi-id">
        <span className="vi-emblem" aria-hidden="true"><ClassEmblem classId={cls.id} size={compact ? 32 : 48} /></span>
        <div className="vi-title">
          <h3 className="vi-name">{cls.name}</h3>
          <span className="vi-role">{cls.role}</span>
          {lock.locked
            ? <span className="vi-tag locked">{lock.line}<span className="vi-prog">{lock.progress}</span></span>
            : <span className="vi-tag">{chosen ? 'Your vessel' : 'Preview'}</span>}
        </div>
      </div>
      <ul className="vi-skills" aria-label="Starting skills">
        {skills.map((s) => (
          <li key={s.id}>
            <NodeIcon nodeId={s.id} size={32} />
            <span><b>{s.name}</b><small>{s.slot === 'basic' ? 'Basic' : 'Signature'}</small></span>
          </li>
        ))}
      </ul>
      <dl className="vi-stats">
        <div><dt>Life</dt><dd>{wholeNum(cls.base.maxHealth)}</dd></div>
        <div><dt>Armor</dt><dd>{wholeNum(cls.base.armor)}</dd></div>
      </dl>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ title hall

export interface VesselHallProps {
  title: string;
  /** a line under the title (the tutorial's promise, today's bounty) */
  intro?: ReactNode;
  value: string;
  onChange: (id: string) => void;
  /** the player's level (null = unknown: nothing shown locked) */
  level: number | null;
  /** the name field, or who is signed in */
  who?: ReactNode;
  /** confirm button verb ("Descend", "Begin the tutorial"): reads "<go> as <Class>" */
  goLabel: string;
  busyLabel: string;
  busy: boolean;
  disabled: boolean;
  err: string | null;
  onConfirm: () => void;
  onBack: () => void;
}

export function VesselHall({ title, intro, value, onChange, level, who, goLabel, busyLabel, busy, disabled, err, onConfirm, onBack }: VesselHallProps) {
  const [sel, setSel] = useState(() => indexOf(value));
  const [pulse, setPulse] = useState(0);
  const [live, setLive] = useState('');
  const [flourish, setFlourish] = useState(false);
  const [insets, setInsets] = useState({ top: 72, bottom: 200 });
  const flRef = useRef(false);
  const stage = useRef<VesselStageHandle>(null);
  const top = useRef<HTMLElement>(null);
  const bottom = useRef<HTMLElement>(null);
  const sfx = useVesselSfx();
  const usingPad = useStore(padStore, (s) => s.usingPad);
  const cls = CLASSES[sel] ?? CLASSES[0]!;
  const lock = lockOf(cls, level);

  // follow outside changes of the chosen vessel (a remembered class that turned out to be locked falls back)
  useEffect(() => { setSel(indexOf(value)); }, [value]);

  // the lineup centres in the band between the title strip and the bottom panels
  useEffect(() => {
    const measure = () => setInsets({ top: (top.current?.offsetHeight ?? 64) + 8, bottom: (bottom.current?.offsetHeight ?? 180) + 8 });
    measure();
    const ro = new ResizeObserver(measure);
    if (top.current) ro.observe(top.current);
    if (bottom.current) ro.observe(bottom.current);
    return () => ro.disconnect();
  }, []);

  // focus returns to whatever opened the hall
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    return () => { prev?.focus?.({ preventScroll: true }); };
  }, []);

  const views: StageSlotView[] = useMemo(() => CLASSES.map((c) => {
    const lk = lockOf(c, level);
    return { key: c.id, classId: c.id, locked: lk.locked, label: lk.locked ? `${c.name}: locked, ${lk.line.toLowerCase()}` : `${c.name}: ${c.role}`, short: c.name, chip: lk.locked ? lk.chip : undefined };
  }), [level]);

  const selRef = useRef(sel);
  selRef.current = sel;
  const move = (to: number, focus: boolean) => {
    if (flRef.current) return;
    const j = stepIndex(to, 0, N);
    if (j !== selRef.current) {
      selRef.current = j;
      setSel(j);
      setPulse((p) => p + 1);
      const c = CLASSES[j]!, lk = lockOf(c, level);
      sfx.move(c.id, lk.locked, panOf(j, N));
      setLive(announceText(c.name, c.role, lk));
      if (!lk.locked) onChange(c.id);
    }
    if (focus) stage.current?.focusSlot(j);   // focusing the radio calls move again: already selected, a no-op
  };

  const confirm = () => {
    if (flRef.current || busy) return;
    if (lock.locked) { sfx.denied(panOf(sel, N)); setPulse((p) => p + 1); setLive(announceText(cls.name, cls.role, lock)); return; }
    if (disabled) return;
    flRef.current = true;
    setFlourish(true);
    sfx.roar();
    const done = () => { flRef.current = false; setFlourish(false); onConfirm(); };
    if (stage.current) stage.current.flourish(done); else done();
  };

  // a run that failed to start brings the hero back up out of the portal
  const prevBusy = useRef(busy);
  useEffect(() => { if (prevBusy.current && !busy) stage.current?.reset(); prevBusy.current = busy; }, [busy]);

  // keys anywhere in the hall (controller buttons arrive as Enter / Escape on the focused element)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented && e.key !== 'Escape') return;
    if (flRef.current) { e.preventDefault(); stage.current?.skip(); return; }
    const t = e.target as HTMLElement | null;
    const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
    const radio = t?.getAttribute?.('role') === 'radio';
    if (e.key === 'Escape') { e.preventDefault(); onBack(); return; }
    if (e.key === 'Enter') {
      if (!typing && !radio && t?.closest?.('button, a')) return;   // other buttons and links activate themselves
      e.preventDefault();
      confirm();
      return;
    }
    if (typing || e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    const delta = k === 'ArrowLeft' || k === 'a' || k === 'A' ? -1 : k === 'ArrowRight' || k === 'd' || k === 'D' ? 1 : 0;
    if (delta) { e.preventDefault(); move(stepIndex(selRef.current, delta, N), radio); return; }
    if (k === 'Home' || k === 'End') { e.preventDefault(); move(k === 'Home' ? 0 : N - 1, radio); }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const glyph = (i: number, key: string) => (usingPad ? padGlyph(i) : key);
  return (
    <div className="vessel-hall" role="dialog" aria-modal="true" aria-labelledby="vh-title" onPointerDownCapture={() => { if (flRef.current) stage.current?.skip(); }}>
      <VesselStage variant="lineup" slots={views} selected={sel} pulse={pulse} interactive disabled={flourish} autoFocus stageRef={stage}
        onPick={(i) => move(i, false)} onActivate={() => confirm()} onHover={(i) => { if (i !== null && i !== sel) sfx.hover(); }}
        insetTop={insets.top} insetBottom={insets.bottom} labelledBy="vh-title" describedBy="vh-info" />
      <header ref={top} className="vh-top">
        <div className="vh-heading">
          <h2 id="vh-title" className="vh-title">{title}</h2>
          {intro && <p className="vh-intro">{intro}</p>}
        </div>
        <button className="btn small ghost" onClick={onBack}>Back <span className="kbd">{glyph(1, 'Esc')}</span></button>
      </header>
      <footer ref={bottom} className="vh-bottom">
        <VesselInfo id="vh-info" cls={cls} lock={lock} chosen={cls.id === value} />
        <div className="vh-go frame inset">
          {who}
          {err && <p className="neg vh-err" role="alert">{err}</p>}
          <button className="btn big primary vh-confirm" data-sfx="none" disabled={disabled || busy || flourish || lock.locked} onClick={confirm}>
            {busy ? busyLabel : lock.locked ? `Locked until level ${classUnlockLevel(cls.id)}` : `${goLabel} as ${cls.name}`}
            {!busy && !lock.locked && <span className="kbd">{glyph(0, 'Enter')}</span>}
          </button>
          <span className="vh-hint" aria-hidden="true">{usingPad ? `${padGlyph(14)} ${padGlyph(15)} choose` : '← → or A D to choose'}</span>
        </div>
      </footer>
      <p className="sr-only" aria-live="polite">{live}</p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ lobby

export interface LobbySeat { slot: number; name: string; classId: string; ready: boolean; connected: boolean; you: boolean }

/**
 * The co-op lobby's vessel area: the party stage (each member's hero on a plinth with their name and readiness over
 * it, yours in the centre, open seats as dormant plinths) above a compact class strip and the info panel.
 */
export function LobbyVessels({ seats, maxSeats, myClass, level, disabled, onChoose, labelledBy, pickHeading }: {
  seats: LobbySeat[]; maxSeats: number; myClass: string; level: number | null; disabled: boolean; onChoose: (id: string) => void; labelledBy: string; pickHeading?: ReactNode;
}) {
  const order = partyOrder(seats, maxSeats);
  const mine = Math.max(0, order.findIndex((s) => s?.you));
  const [pulse, setPulse] = useState(0);
  const sfx = useVesselSfx();
  // a burst on your plinth whenever your vessel changes
  const lastClass = useRef(myClass);
  useEffect(() => { if (lastClass.current !== myClass) { lastClass.current = myClass; setPulse((p) => p + 1); } }, [myClass]);
  // members strike a pose when they ready up
  const readyCount = useRef(new Map<number, number>());
  const wasReady = useRef(new Map<number, boolean>());
  for (const s of seats) {
    if (s.ready && !wasReady.current.get(s.slot)) readyCount.current.set(s.slot, (readyCount.current.get(s.slot) ?? 0) + 1);
    wasReady.current.set(s.slot, s.ready);
  }
  const views: StageSlotView[] = order.map((s, i) => s
    ? { key: `seat-${s.slot}`, classId: s.classId, locked: false, label: s.name, name: s.you ? `${s.name} (you)` : s.name, me: s.you,
        status: { text: s.connected ? (s.ready ? 'Ready' : 'Choosing') : 'Offline', tone: s.connected ? (s.ready ? 'good' : '') : 'bad' } }
    : { key: `open-${i}`, classId: '', locked: false, empty: true, label: 'Open seat', name: 'Open seat' });
  const powers = order.map((s) => (s && !s.you ? (s.ready ? 0.75 : 0.4) : 0));
  const poses = order.map((s) => (s ? readyCount.current.get(s.slot) ?? 0 : 0));
  return (
    <div className="lobby-vessels">
      <VesselStage variant="party" slots={views} selected={mine} pulse={pulse} powers={powers} poses={poses} className="lobby-stage" insetTop={48} />
      {pickHeading}
      <VesselStrip value={myClass} level={level} disabled={disabled} labelledBy={labelledBy}
        onChoose={(id, locked) => { const i = indexOf(id); sfx.move(id, locked, panOf(i, N)); if (!locked) onChoose(id); }} />
    </div>
  );
}

/** Compact class strip (a radio group of portrait tiles; arrows move and choose) beside the info panel. */
function VesselStrip({ value, level, disabled, labelledBy, onChoose }: { value: string; level: number | null; disabled: boolean; labelledBy: string; onChoose: (id: string, locked: boolean) => void }) {
  const [peek, setPeek] = useState<string | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = indexOf(value);
  const shown = CLASSES.find((c) => c.id === (peek ?? value)) ?? CLASSES[current]!;
  const pick = (i: number) => {
    const c = CLASSES[i]!;
    if (disabled || c.id === value) return;
    onChoose(c.id, lockOf(c, level).locked);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    let j = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = stepIndex(i, 1, N);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = stepIndex(i, -1, N);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = N - 1;
    else return;
    e.preventDefault();
    refs.current[j]?.focus();
  };
  return (
    <div className="lobby-pick">
      <div role="radiogroup" aria-labelledby={labelledBy} aria-describedby="lobby-vinfo" className="vstrip" onMouseLeave={() => setPeek(null)}>
        {CLASSES.map((c, i) => {
          const lk = lockOf(c, level);
          const sel = c.id === value;
          return (
            <button key={c.id} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" data-sfx="none" aria-checked={sel} aria-disabled={disabled || lk.locked || undefined}
              aria-label={lk.locked ? `${c.name}: locked, ${lk.line.toLowerCase()}` : `${c.name}: ${c.role}`} tabIndex={i === current ? 0 : -1}
              className={`vessel-tile${lk.locked ? ' locked' : ''}`} style={{ '--accent': readableAccent(c.accent) } as CSSProperties}
              onClick={() => pick(i)} onFocus={() => { setPeek(c.id); if (!lk.locked) pick(i); }} onBlur={() => setPeek(null)} onMouseEnter={() => setPeek(c.id)} onKeyDown={(e) => onKey(e, i)}>
              <span className="vt-frame"><ClassPortrait classId={c.id} size={96} animate={sel && !lk.locked} />{lk.locked && <span className="vt-lock" aria-hidden="true"><b>{lk.chip}</b></span>}</span>
              <span className="vt-name">{c.name}</span>
            </button>
          );
        })}
      </div>
      <VesselInfo id="lobby-vinfo" cls={shown} lock={lockOf(shown, level)} chosen={shown.id === value} />
    </div>
  );
}
