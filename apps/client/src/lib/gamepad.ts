import { settingsStore } from './settings';
import { createStore } from './store';

// Controllers (Xbox, PlayStation and other "standard"-mapping pads through the Gamepad API). Three jobs:
//   1. Recognise the family from the pad's id, so prompts show the right glyphs (A / ✕, LB / L1, …).
//   2. Drive every menu and panel: when a menu, dialog or overlay is up (or no game is running), the D-pad / left
//      stick move focus spatially, A activates, X presses Enter (e.g. spend a skill point), B backs out (Escape),
//      LB / RB switch tabs, the right stick scrolls. In combat (no overlay) the pad belongs to the game
//      (lib/input.ts) and this layer stands aside.
//   3. Rumble on hits, downs and boss slams (when the pad supports it and the setting is on).
// Standard mapping: 0 A/✕, 1 B/○, 2 X/□, 3 Y/△, 4 LB/L1, 5 RB/R1, 6 LT/L2, 7 RT/R2, 8 View/Create, 9 Menu/Options,
// 10 L3, 11 R3, 12-15 D-pad up/down/left/right, 16 Home/PS.

export type PadFamily = 'xbox' | 'playstation' | 'generic';

export interface PadState {
  connected: boolean;
  family: PadFamily;
  /** the player's last input came from a pad (prompts switch to pad glyphs; the mouse cursor hides) */
  usingPad: boolean;
  name: string;
}

export const padStore = createStore<PadState>({ connected: false, family: 'generic', usingPad: false, name: '' });

/** Family from the Gamepad API id ("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e …)", "DualSense Wireless Controller", "054c-0ce6-…"). */
export function padFamily(id: string): PadFamily {
  if (/054c|dualsense|dualshock|playstation|sony|wireless controller \(standard gamepad vendor: 054c/i.test(id)) return 'playstation';
  if (/045e|xbox|xinput/i.test(id)) return 'xbox';
  return 'generic';
}

const GLYPHS: Record<PadFamily, readonly string[]> = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D↑', 'D↓', 'D←', 'D→', 'Xbox'],
  playstation: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'D↑', 'D↓', 'D←', 'D→', 'PS'],
  generic: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'D↑', 'D↓', 'D←', 'D→', 'Home'],
};

/** The glyph for a standard-mapping button index on the given (default: current) controller family. */
export function padGlyph(index: number | undefined, family: PadFamily = padStore.get().family): string {
  if (index === undefined) return '';
  return GLYPHS[family][index] ?? `B${index}`;
}

// ------------------------------------------------------------------------------------------------ rumble

export type RumbleKind = 'hit' | 'heavy' | 'downed' | 'slam';
const RUMBLE: Record<RumbleKind, { duration: number; strongMagnitude: number; weakMagnitude: number }> = {
  hit: { duration: 90, strongMagnitude: 0.15, weakMagnitude: 0.45 },
  heavy: { duration: 180, strongMagnitude: 0.55, weakMagnitude: 0.7 },
  slam: { duration: 260, strongMagnitude: 0.8, weakMagnitude: 0.5 },
  downed: { duration: 420, strongMagnitude: 1, weakMagnitude: 0.6 },
};

/** Rumble the active controller (no-op without a pad, without haptics support, or with rumble turned off). */
export function rumble(kind: RumbleKind): void {
  if (!settingsStore.get().s.rumble || !padStore.get().usingPad) return;
  const pad = activePad();
  const act = (pad as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null)?.vibrationActuator;
  try { void act?.playEffect?.('dual-rumble', { startDelay: 0, ...RUMBLE[kind] })?.catch(() => undefined); } catch { /* unsupported */ }
}

function activePad(): Gamepad | null {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) if (p && p.connected) return p;
  return null;
}

// ------------------------------------------------------------------------------------------------ menu navigation

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [role="radio"], [role="tab"]';
const SCOPE = '[aria-modal="true"], .menu-dialog, .overlay';
const REPEAT_FIRST = 380, REPEAT_NEXT = 130;

let started = false;

/** Start the app-wide controller layer (idempotent; call once from the root layout). */
export function startGamepad(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const root = document.documentElement;
  const setUsing = (v: boolean) => {
    if (padStore.get().usingPad !== v) padStore.set({ usingPad: v });
    root.classList.toggle('pad-nav', v);
  };
  window.addEventListener('gamepadconnected', (e) => {
    const g = (e as GamepadEvent).gamepad;
    padStore.set({ connected: true, family: padFamily(g.id), name: g.id.replace(/\s*\(.*$/, '').slice(0, 60) });
  });
  window.addEventListener('gamepaddisconnected', () => { if (!activePad()) { padStore.set({ connected: false }); setUsing(false); } });
  // the mouse or keyboard takes over again
  window.addEventListener('pointermove', (e) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 3) setUsing(false); });
  window.addEventListener('pointerdown', () => setUsing(false));
  window.addEventListener('keydown', (e) => { if (e.isTrusted) setUsing(false); });

  let prev: boolean[] = [];
  let held: { dir: string; next: number } | null = null;
  const loop = () => {
    requestAnimationFrame(loop);
    const pad = activePad();
    if (!pad) { prev = []; held = null; return; }
    if (!padStore.get().connected) padStore.set({ connected: true, family: padFamily(pad.id), name: pad.id.replace(/\s*\(.*$/, '').slice(0, 60) });
    const pressed = pad.buttons.map((b) => b.pressed || b.value > 0.5);
    const dz = (v: number | undefined) => (Math.abs(v ?? 0) < 0.35 ? 0 : v ?? 0);
    const lx = dz(pad.axes[0]), ly = dz(pad.axes[1]), ry = dz(pad.axes[3]);
    const active = pressed.some(Boolean) || lx !== 0 || ly !== 0 || ry !== 0;
    if (active) setUsing(true);
    const last = prev;
    const edge = (i: number) => !!pressed[i] && !last[i];
    prev = pressed;
    if (!navActive()) { held = null; return; }
    // "press any button" prompts (the title screen) react to any face, shoulder or Start button
    const anyEdge = pressed.some((p, i) => p && !last[i] && i <= 9);
    const any = anyEdge ? document.querySelector<HTMLElement>('[data-pad-any]') : null;
    if (any && visible(any)) { any.click(); return; }

    // direction (D-pad or left stick) with key-repeat timing
    const dir = pressed[12] || ly < -0.5 ? 'up' : pressed[13] || ly > 0.5 ? 'down' : pressed[14] || lx < -0.5 ? 'left' : pressed[15] || lx > 0.5 ? 'right' : null;
    const now = performance.now();
    if (!dir) held = null;
    else if (!held || held.dir !== dir) { held = { dir, next: now + REPEAT_FIRST }; move(dir); }
    else if (now >= held.next) { held.next = now + REPEAT_NEXT; move(dir); }

    if (edge(0)) activate();
    if (edge(2)) key('Enter');
    if (edge(1)) key('Escape');
    if (edge(4) || edge(5)) cycleTab(edge(5) ? 1 : -1);
    if (ry) scrollFocused(ry * 18);
  };
  requestAnimationFrame(loop);
}

/** Menus own the pad unless a game is running with nothing over it (combat, the door walk). */
function navActive(): boolean {
  if (document.querySelector(SCOPE)) return true;
  return !document.querySelector('[data-gameplay="true"]');
}

/** The topmost open dialog / overlay, else the page. */
function scope(): ParentNode {
  const all = Array.from(document.querySelectorAll<HTMLElement>(SCOPE)).filter(visible);
  return all[all.length - 1] ?? document;
}

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none' && !el.closest('[aria-hidden="true"]:not(.hud)');
}

function focusables(): HTMLElement[] {
  return Array.from(scope().querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => visible(el) && !el.closest('[inert]'));
}

function focus(el: HTMLElement) {
  (el.focus as (o?: FocusOptions & { focusVisible?: boolean }) => void)({ preventScroll: false, focusVisible: true });
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

/** First thing to land on in a fresh scope: an explicit default, the menu's first plaque, a primary button, else the first. */
function entry(list: HTMLElement[]): HTMLElement | undefined {
  return list.find((e) => e.hasAttribute('data-pad-default')) ?? list.find((e) => e.classList.contains('menu-item'))
    ?? list.find((e) => e.getAttribute('aria-checked') === 'true') ?? list.find((e) => e.classList.contains('primary')) ?? list[0];
}

function move(dir: string) {
  const list = focusables();
  if (!list.length) return;
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !list.includes(cur)) { const e = entry(list); if (e) focus(e); return; }
  // native controls that use arrows themselves keep them (range sliders, selects)
  if (cur instanceof HTMLInputElement && cur.type === 'range' && (dir === 'left' || dir === 'right')) { key(dir === 'left' ? 'ArrowLeft' : 'ArrowRight'); return; }
  const target = spatialNext(cur, list, dir);
  if (target) focus(target);
}

/** Nearest focusable in a direction: distance along the axis plus a penalty for drifting off it. */
export function spatialNext<T extends { getBoundingClientRect(): { left: number; top: number; width: number; height: number } }>(cur: T, list: readonly T[], dir: string): T | undefined {
  const c = center(cur.getBoundingClientRect());
  const v = dir === 'up' ? [0, -1] : dir === 'down' ? [0, 1] : dir === 'left' ? [-1, 0] : [1, 0];
  let best: T | undefined, bestScore = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const p = center(el.getBoundingClientRect());
    const dx = p.x - c.x, dy = p.y - c.y;
    const along = dx * v[0]! + dy * v[1]!;
    if (along <= 4) continue;
    const across = Math.abs(dx * v[1]! - dy * v[0]!);
    const score = along + across * 2.2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

function center(r: { left: number; top: number; width: number; height: number }) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function activate() {
  const list = focusables();
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !list.includes(cur)) { const e = entry(list); if (e) focus(e); return; }
  if (cur instanceof HTMLInputElement && (cur.type === 'text' || cur.type === 'password' || !cur.type)) { cur.select(); return; }
  if (cur instanceof HTMLSelectElement) { cur.selectedIndex = (cur.selectedIndex + 1) % Math.max(1, cur.options.length); cur.dispatchEvent(new Event('change', { bubbles: true })); return; }
  cur.click();
}

/** Synthesize a key on the focused element (bubbles to window listeners: Escape closes dialogs, Enter spends). */
function key(k: 'Enter' | 'Escape' | 'ArrowLeft' | 'ArrowRight') {
  const t = (document.activeElement as HTMLElement | null) ?? document.body;
  t.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true }));
}

function cycleTab(step: 1 | -1) {
  const tabs = Array.from(scope().querySelectorAll<HTMLElement>('[role="tab"]')).filter(visible);
  if (tabs.length < 2) return;
  const i = Math.max(0, tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true'));
  const next = tabs[(i + step + tabs.length) % tabs.length]!;
  next.click();
  focus(next);
}

function scrollFocused(dy: number) {
  let el = document.activeElement as HTMLElement | null;
  while (el && el !== document.body) {
    if (el.scrollHeight > el.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) { el.scrollBy(0, dy); return; }
    el = el.parentElement;
  }
  window.scrollBy(0, dy);
}
