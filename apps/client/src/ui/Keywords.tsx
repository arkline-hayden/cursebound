'use client';

import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { keywordSpans, type GlossaryTerm } from '@cursebound/content';

// Skill copy with glossary keywords (content glossary.ts: one definition per status, damage type, rule and class
// mechanic). Each term is a focusable, pixel-underlined word in its keyword colour (the Fate chips' --kw accent); hover
// or focus opens its definition in the shared pixel tooltip frame (--px-tooltip). Keyboard: Tab reaches every term,
// Escape closes; gamepad: the spatial focus layer (lib/gamepad.ts) treats terms as buttons, so the stick lands on them
// and focus opens the definition. The tooltip is as wide as the paragraph and floats above the page (portal, fixed
// position, flipped above the word when there is no room below), so a scrolling or narrow pane never clips it; screen
// readers get the definition through aria-describedby.

interface Open { term: GlossaryTerm; el: HTMLElement }

export function KeywordText({ text, classId, className, as: Tag = 'p' }: { text: string; classId?: string; className?: string; as?: 'p' | 'span' }) {
  const spans = useMemo(() => keywordSpans(text, classId), [text, classId]);
  const [open, setOpen] = useState<Open | null>(null);
  const root = useRef<HTMLElement | null>(null);
  const uid = useId();
  const tipId = (t: GlossaryTerm) => `${uid}kw-${t.id}`;
  const terms = spans.flatMap((s) => (s.term ? [s.term] : []));
  const show = (term: GlossaryTerm, el: HTMLElement) => setOpen({ term, el });
  return (
    <Tag className={`kw-text${className ? ` ${className}` : ''}`} ref={(el: HTMLElement | null) => { root.current = el; }}>
      {spans.map((s, i) => {
        const t = s.term;
        if (!t) return s.text;
        return (
          <button key={i} type="button" className={`kw-term${open?.term.id === t.id ? ' on' : ''}`} data-sfx="none"
            style={{ '--kw': t.color } as CSSProperties} aria-describedby={tipId(t)}
            onMouseEnter={(e) => show(t, e.currentTarget)} onMouseLeave={() => setOpen(null)}
            onFocus={(e) => show(t, e.currentTarget)} onBlur={() => setOpen(null)}
            onClick={(e) => { const el = e.currentTarget; setOpen((cur) => (cur?.term.id === t.id ? null : { term: t, el })); }}
            onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(null); } }}>
            {s.text}
          </button>
        );
      })}
      {terms.map((t) => <span key={t.id} id={tipId(t)} className="sr-only">{t.name}: {t.text}</span>)}
      {open && root.current && <KeywordTip open={open} box={root.current} />}
    </Tag>
  );
}

/** The floating definition: as wide as the paragraph (at least 240px), below the word or flipped above it. */
function KeywordTip({ open, box }: { open: Open; box: HTMLElement }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const word = open.el.getBoundingClientRect(), para = box.getBoundingClientRect();
    const width = Math.min(window.innerWidth - 16, Math.max(240, para.width));
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, para.left));
    if (ref.current) ref.current.style.width = `${width}px`;
    const h = ref.current?.offsetHeight ?? 0;
    const below = word.bottom + 6;
    const top = below + h > window.innerHeight - 8 && word.top - 6 - h >= 8 ? word.top - 6 - h : below;
    setPos({ left, top, width });
  }, [open, box]);
  return createPortal(
    <span ref={ref} className="kw-tip" aria-hidden="true"
      style={{ '--kw': open.term.color, left: pos?.left ?? 0, top: pos?.top ?? 0, width: pos?.width ?? 240, visibility: pos ? 'visible' : 'hidden' } as CSSProperties}>
      <span className="kw-tip-name">{open.term.name}</span>
      <span className="kw-tip-text">{open.term.text}</span>
    </span>,
    document.body,
  );
}
