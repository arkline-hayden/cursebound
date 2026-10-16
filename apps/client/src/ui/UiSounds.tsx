'use client';

import { useEffect } from 'react';
import { sharedAudio } from '@/game/audio/shared';
import type { SfxId } from '@/game/audio/sfx';

// Interface sounds for the whole app, from one set of document listeners (mounted once in the root layout):
//   hover / keyboard or pad focus onto a control -> ui_hover · click -> ui_click, ui_confirm (primary buttons),
//   ui_back (back / close / leave / cancel), ui_tab (tabs), ui_error (disabled) · checkbox -> ui_toggle ·
//   range -> ui_slider (per notch) · typing in a text field -> ui_type · a dialog appearing / leaving ->
//   ui_panel_open / ui_panel_close.
// A control (or any ancestor) can pick its own cue with data-sfx="<cue>", or opt out with data-sfx="none" (the
// vessel lineup, which voices itself). Nothing plays over the game canvas.

const CONTROL = 'button, a[href], [role="button"], [role="tab"], [role="radio"], [role="menuitem"], input[type="checkbox"], input[type="range"], select, summary';
const BACK = /^(back|close|leave|cancel|not ready|resume)\b/i;

function play(id: SfxId, volume?: number) {
  void sharedAudio().then((e) => e?.play(id, volume === undefined ? {} : { volume }));
}

function disabled(el: Element): boolean {
  return el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true';
}

/** The cue a control asks for: data-sfx on it or an ancestor, 'none' silences, null = decide by role. */
function override(el: Element): string | null {
  return el.closest('[data-sfx]')?.getAttribute('data-sfx') ?? null;
}

function clickCue(el: Element): SfxId | null {
  const o = override(el);
  if (o === 'none') return null;
  if (o) return o as SfxId;
  if (el.matches('input[type="checkbox"], input[type="range"], select')) return null;   // change / input handle these
  if (disabled(el)) return 'ui_error';
  if (el.getAttribute('role') === 'tab') return 'ui_tab';
  const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
  if (BACK.test(label)) return 'ui_back';
  if (el.classList.contains('primary') || el.classList.contains('blood')) return 'ui_confirm';
  return 'ui_click';
}

export function UiSounds() {
  useEffect(() => {
    let lastHover: Element | null = null;
    let hoverAt = 0, typeAt = 0, slideAt = 0, panelAt = 0;
    let pointerLast = true;
    const outsideGame = (t: EventTarget | null): Element | null => {
      if (!(t instanceof Element) || t.closest('[data-gameplay="true"], canvas')) return null;
      return t.closest(CONTROL);
    };
    const hover = (el: Element | null) => {
      if (!el || el === lastHover || disabled(el) || override(el) === 'none') { if (!el) lastHover = null; return; }
      lastHover = el;
      const now = performance.now();
      if (now - hoverAt < 45) return;
      hoverAt = now;
      play('ui_hover', 0.6);
    };
    const onOver = (e: PointerEvent) => { if (e.pointerType === 'mouse') { pointerLast = true; hover(outsideGame(e.target)); } };
    const onFocus = (e: FocusEvent) => { if (!pointerLast) hover(outsideGame(e.target)); };
    const onKeyDown = (e: KeyboardEvent) => {
      pointerLast = false;
      const t = e.target;
      if (t instanceof HTMLInputElement && (t.type === 'text' || t.type === 'search' || t.type === 'password') || t instanceof HTMLTextAreaElement) {
        if (e.key.length !== 1 && e.key !== 'Backspace' && e.key !== 'Delete') return;
        const now = performance.now();
        if (now - typeAt < 35) return;
        typeAt = now;
        play('ui_type', 0.7);
      }
    };
    const onPointerDown = () => { pointerLast = true; };
    const onClick = (e: MouseEvent) => {
      const el = outsideGame(e.target);
      if (!el) return;
      const cue = clickCue(el);
      if (cue) play(cue);
    };
    const onChange = (e: Event) => {
      const t = e.target;
      if (!(t instanceof Element) || override(t) === 'none') return;
      if (t instanceof HTMLInputElement && t.type === 'checkbox') play('ui_toggle');
      else if (t instanceof HTMLSelectElement) play('ui_click');
    };
    const onInput = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || t.type !== 'range' || override(t) === 'none') return;
      const now = performance.now();
      if (now - slideAt < 60) return;
      slideAt = now;
      play('ui_slider', 0.8);
    };
    // dialogs coming and going (settings, ledger, gear, pause, friends, vessel select, room event panels…)
    const dialogsIn = (nodes: NodeList): boolean => {
      for (const n of nodes) if (n instanceof Element && (n.matches('[role="dialog"]') || n.querySelector('[role="dialog"]'))) return true;
      return false;
    };
    const mo = new MutationObserver((records) => {
      let opened = false, closed = false;
      for (const r of records) { if (dialogsIn(r.addedNodes)) opened = true; if (dialogsIn(r.removedNodes)) closed = true; }
      if (!opened && !closed) return;
      const now = performance.now();
      if (now - panelAt < 150) return;
      panelAt = now;
      play(opened ? 'ui_panel_open' : 'ui_panel_close');
    });
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('input', onInput, true);
    return () => {
      mo.disconnect();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('input', onInput, true);
    };
  }, []);
  return null;
}
