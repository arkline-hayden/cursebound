// Mouse buttons are game inputs, never browser gestures (playtest: "Mouse 4 and 5 move between the menus", "Mouse 3
// turns your mouse into a scroll wheel"). App-wide (ui/MouseGuard.tsx mounts it on every page, InputController again
// for the game view), in the capture phase so no handler further down can let the default through:
//   - the back / forward side buttons (MouseEvent.button 3 / 4): Chromium (and Electron) navigate history on their
//     mouseup unless the page cancels it, so mousedown / mouseup / pointerup / auxclick are all cancelled.
//   - the middle button (1): its mousedown starts the browser's autoscroll (the "scroll wheel" cursor); cancelled
//     everywhere except on a link, where a middle click keeps its meaning (open in a new tab) on the menu pages.
// pointerdown is never cancelled: that would also swallow the compatibility mousedown the keybind capture listens to.
// guardHistory backs that up while a run is on screen: a history step the page could not cancel (Firefox handles the
// side buttons in the browser itself, Alt+Left, a touchpad swipe) is undone instead of leaving the run.

/** Mouse buttons a binding can use (MouseEvent.button): left, middle, right, back (Mouse 4), forward (Mouse 5). */
export const MOUSE_BUTTONS = [0, 1, 2, 3, 4] as const;

/** The binding code for a mouse button ('Mouse0'-'Mouse4'), or null for a button no binding can use. */
export function mouseBindCode(button: number): string | null {
  return (MOUSE_BUTTONS as readonly number[]).includes(button) ? `Mouse${button}` : null;
}

let capturing = false;
/** The Settings keybind capture is waiting for a key or mouse button: the game ignores mouse presses meanwhile (keys
 *  are stopped by the capture itself), so binding a button never also does what that button was bound to. */
export function setBindCapture(on: boolean) { capturing = on; }
export function bindCaptureActive(): boolean { return capturing; }

/** MouseEvent.buttons bit -> MouseEvent.button (the bitmask orders right before middle). */
export const MASK_BUTTON = [0, 2, 1, 3, 4] as const;

const GUARDED = ['mousedown', 'mouseup', 'pointerup', 'auxclick'] as const;

function onLink(t: EventTarget | null): boolean {
  const el = t && typeof (t as Element).closest === 'function' ? (t as Element) : null;
  return !!el?.closest('a[href]');
}

/**
 * Cancel the browser's default for a mouse event when it would navigate (side buttons) or autoscroll (middle). Returns
 * true when it cancelled. Never stops propagation: game and keybind handlers still see every press.
 */
export function suppressBrowserMouse(e: Pick<MouseEvent, 'type' | 'button' | 'target' | 'preventDefault'>): boolean {
  if (e.type === 'pointerdown') return false;
  if (e.button === 3 || e.button === 4) {
    e.preventDefault();
    return true;
  }
  if (e.button === 1 && e.type === 'mousedown' && !onLink(e.target)) {
    e.preventDefault();
    return true;
  }
  return false;
}

/** Install the guard on a window (capture phase). Returns the uninstaller. */
export function installMouseGuard(win: Pick<Window, 'addEventListener' | 'removeEventListener'>): () => void {
  const fn = (e: Event) => { suppressBrowserMouse(e as MouseEvent); };
  for (const ev of GUARDED) win.addEventListener(ev, fn, { capture: true, passive: false });
  return () => { for (const ev of GUARDED) win.removeEventListener(ev, fn, { capture: true }); };
}

/**
 * After the keybind capture takes a mouse button, the rest of that press (its click, auxclick or context menu, which
 * Windows sends after the release) must not also act on what is under the pointer: a left click on the binding's own
 * button opened the capture again. Swallows them until a moment after the release. Returns the early canceller.
 */
export function swallowFollowUp(win: Pick<Window, 'addEventListener' | 'removeEventListener'>, ms = 250): () => void {
  const EVS = ['click', 'auxclick', 'contextmenu'] as const;
  const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const end = () => {
    if (timer) clearTimeout(timer);
    for (const ev of EVS) win.removeEventListener(ev, stop, { capture: true });
    win.removeEventListener('mouseup', released, { capture: true });
  };
  const released = () => { if (timer) clearTimeout(timer); timer = setTimeout(end, ms); };
  for (const ev of EVS) win.addEventListener(ev, stop, { capture: true });
  win.addEventListener('mouseup', released, { capture: true });
  timer = setTimeout(end, 1500);   // a release the page never saw (outside the window)
  return end;
}

/**
 * While a run is on screen, a history step (back / forward) must not leave it: the popstate is stopped before the
 * router sees it (capture listeners on the window run first) and the run's own entry is pushed back. Returns the
 * uninstaller.
 */
export function guardHistory(win: Pick<Window, 'addEventListener' | 'removeEventListener' | 'location' | 'history'>): () => void {
  const url = win.location.href;
  const state: unknown = win.history.state;
  const onPop = (e: Event) => {
    e.stopImmediatePropagation();
    try { win.history.pushState(state, '', url); } catch { /* ignore */ }
  };
  win.addEventListener('popstate', onPop, { capture: true });
  return () => win.removeEventListener('popstate', onPop, { capture: true });
}
