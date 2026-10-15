'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { cineOverlay, type OverlaySnapshot } from '@/game/cinematic/overlay';
import { FONT_DISPLAY, FONT_LABEL, FONT_UI } from './fonts';

// Cutscene overlay (game/cinematic): letterbox bars, the black curtain, title cards and the boss bar sweep.
// Sits above the game view and below menus, ledger, toasts and net status. The director drives bars / curtain /
// boss bar imperatively each frame; React only re-renders when a title card appears or leaves.

const CSS = `
.cine-root { position: absolute; inset: 0; z-index: 18; pointer-events: none; overflow: hidden; }
.cine-root > .cine-fade { position: absolute; inset: 0; background: #000; opacity: 0; visibility: hidden; }
.cine-bar { position: absolute; left: 0; right: 0; height: 0; background: #000; visibility: hidden; }
.cine-bar.top { top: 0; box-shadow: 0 2px 0 #1e0d07, 0 4px 0 #0a0403; }
.cine-bar.bottom { bottom: 0; box-shadow: 0 -2px 0 #1e0d07, 0 -4px 0 #0a0403; }
.cine-skip { position: absolute; right: 24px; bottom: 50%; transform: translateY(50%); font-size: 14px; line-height: 16px;
  text-transform: uppercase; color: #8a7a62; text-shadow: 2px 2px 0 #000; white-space: nowrap; animation: cine-blink 1.6s steps(2) infinite; }
.cine-skip b { color: #e8c66a; font-weight: 400; }
.cine-card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -54%); display: flex; flex-direction: column;
  align-items: center; text-align: center; gap: 10px; width: min(1100px, 92vw); animation: cine-in 0.42s steps(6) both; }
.cine-card.out { animation: cine-out 0.36s steps(4) both; }
.cine-card.low { top: 74%; }
.cine-card.high { top: 32%; }
.cine-kicker { font-size: 20px; line-height: 24px; letter-spacing: 3px; text-transform: uppercase; color: #cbbd9f; text-shadow: 2px 2px 0 #000; }
.cine-title { font-size: clamp(56px, 8.4vw, 132px); line-height: 0.95; color: #e8c66a; letter-spacing: 0.04em;
  text-shadow: 4px 4px 0 #000, 8px 8px 0 #3a1a04; animation: cine-track 0.6s steps(6) both; white-space: nowrap; }
.cine-card.huge .cine-title { font-size: clamp(64px, 10vw, 160px); }
.cine-card.blood .cine-title { color: #ff4a3a; text-shadow: 4px 4px 0 #000, 8px 8px 0 #2a0406; }
.cine-rule { width: min(560px, 70vw); height: 22px; image-rendering: pixelated;
  background: var(--px-divider) center / 128px 22px no-repeat, var(--px-rule) 0 50% / 8px 22px repeat-x; }
.cine-sub { font-size: clamp(26px, 2.6vw, 40px); line-height: 1.1; color: #ebe0c8; text-shadow: 3px 3px 0 #000; }
.cine-line { font-size: clamp(20px, 1.7vw, 26px); line-height: 1.25; color: #cbbd9f; text-shadow: 2px 2px 0 #000; max-width: 92vw; }
.cine-line .gift { color: #9cff7a; } .cine-line .price { color: #ff8a7a; } .cine-line .dot { color: #6a5a48; padding: 0 10px; }
.cine-boss { position: relative; width: min(620px, 66vw); height: 20px; margin-top: 8px; background: #140606;
  box-shadow: 0 0 0 2px #000, 0 0 0 4px #7a5a2a, 0 0 0 6px #000; image-rendering: pixelated; }
.cine-boss i { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: #a3192a; box-shadow: inset 0 3px 0 #ff6a5e, inset 0 -3px 0 #5a0a12; }
@keyframes cine-in { from { opacity: 0; transform: translate(-50%, -48%); } to { opacity: 1; transform: translate(-50%, -54%); } }
@keyframes cine-out { from { opacity: 1; } to { opacity: 0; transform: translate(-50%, -58%); } }
@keyframes cine-track { from { letter-spacing: 0.3em; } to { letter-spacing: 0.04em; } }
@keyframes cine-blink { 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) { .cine-card, .cine-card.out, .cine-title { animation-duration: 0.01s; } }
`;

function Line({ text }: { text: string }) {
  // "Gift: ... · Price: ..." gets coloured halves; anything else is plain
  const parts = text.split(' · ');
  return (
    <div className="cine-line" style={{ fontFamily: FONT_UI }}>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="dot">·</span>}
          <span className={p.startsWith('+') || p.startsWith('Gift') ? 'gift' : p.startsWith('−') || p.startsWith('Price') ? 'price' : ''}>{p}</span>
        </span>
      ))}
    </div>
  );
}

export function CinematicOverlay() {
  const root = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const fade = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);
  const snap: OverlaySnapshot = useSyncExternalStore(cineOverlay.subscribe, cineOverlay.getSnapshot, cineOverlay.getSnapshot);
  const card = snap.title;

  useEffect(() => {
    cineOverlay.attach({ root: root.current, top: top.current, bottom: bottom.current, fade: fade.current, bar: bar.current });
    const onResize = () => cineOverlay.attach({ root: root.current, top: top.current, bottom: bottom.current, fade: fade.current, bar: bar.current });
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); cineOverlay.detach(); };
  }, [card?.id, card?.bossBar]);

  const tone = card?.tone ?? 'gold';
  return (
    <div ref={root} className="cine-root">
      <style>{CSS}</style>
      <div ref={fade} className="cine-fade" aria-hidden="true" />
      <div ref={top} className="cine-bar top" aria-hidden="true" />
      <div ref={bottom} className="cine-bar bottom" aria-hidden="true">
        {snap.skip && <span className="cine-skip" style={{ fontFamily: FONT_LABEL }}><b>Esc</b> / click · skip</span>}
      </div>
      {card && (
        <div key={card.id} aria-hidden="true" className={`cine-card ${tone} ${card.huge ? 'huge' : ''} ${card.pos === 'low' || card.pos === 'high' ? card.pos : ''} ${snap.out ? 'out' : ''}`}
          onAnimationEnd={(e) => { if (snap.out && e.currentTarget === e.target) cineOverlay.hideTitle(true); }}>
          {card.kicker && <div className="cine-kicker" style={{ fontFamily: FONT_LABEL }}>{card.kicker}</div>}
          <div className="cine-title" style={{ fontFamily: FONT_DISPLAY, ...(tone === 'theme' && card.accent ? { color: card.accent } : {}) }}>{card.title}</div>
          {(card.sub || card.line) && <div className="cine-rule" />}
          {card.sub && <div className="cine-sub" style={{ fontFamily: FONT_UI, ...(card.accent ? { color: card.accent } : {}) }}>{card.sub}</div>}
          {card.line && <Line text={card.line} />}
          {card.bossBar && <div className="cine-boss"><i ref={bar as React.RefObject<HTMLElement>} /></div>}
        </div>
      )}
      <div className="sr-only" role="status" aria-live="polite">{card && !snap.out ? [card.kicker, card.title, card.sub, card.line].filter(Boolean).join('. ') : ''}</div>
    </div>
  );
}
