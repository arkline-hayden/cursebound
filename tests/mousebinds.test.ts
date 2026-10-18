import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BTN, InputController } from '../apps/client/src/lib/input';
import { bindCaptureActive, guardHistory, installMouseGuard, mouseBindCode, setBindCapture, suppressBrowserMouse, swallowFollowUp } from '../apps/client/src/lib/mouseGuard';
import { DEFAULT_SETTINGS, KEYS_CLICK, KEYS_WASD, bindKey, keyCap, keyLabel, settingsStore, type Settings } from '../apps/client/src/lib/settings';
import { iso } from '../apps/client/src/game/render/iso';

// Mouse buttons as game inputs (playtest: "Mouse 4 and 5 move between the menus, cannot change keybinds to those
// buttons"; "Mouse 3 turns your mouse into a scroll wheel"). The back / forward side buttons and the middle button
// never navigate or autoscroll, bind like keys (Mouse 4, Mouse 5, Middle Mouse) and count in game, chords included.
// Also the WASD sample: keys report digital movement, which walks the iso grid on diagonals.

// ---- a minimal DOM: node's EventTarget, events carrying the MouseEvent fields InputController reads
type Fake = EventTarget & Record<string, unknown>;
let win: Fake, doc: Fake, canvas: Fake, hud: Fake;
let modal = false;
const saved: Record<string, unknown> = {};

function fire(on: EventTarget, type: string, props: Record<string, unknown> = {}): Event {
  const e = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries({ target: on, button: 0, buttons: 0, clientX: 10, clientY: 10, movementX: 0, movementY: 0, ...props })) {
    Object.defineProperty(e, k, { value: v });
  }
  on.dispatchEvent(e);
  return e;
}
/** a pointer / mouse event as the browser delivers it: at its target, then bubbling to the window */
function mouse(type: string, target: Fake, button: number, buttons: number): Event {
  const e = fire(target, type, { button, buttons });
  win.dispatchEvent(e);
  return e;
}
const key = (type: 'keydown' | 'keyup', code: string) => fire(win, type, { code, repeat: false, target: hud });

function setKeys(keys: Settings['keys'], scheme: Settings['controlScheme'] = 'click') {
  settingsStore.set({ s: { ...DEFAULT_SETTINGS, controlScheme: scheme, keys } });
}

beforeEach(() => {
  for (const k of ['window', 'document', 'history', 'location']) saved[k] = (globalThis as Record<string, unknown>)[k];
  modal = false;
  win = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 }) as unknown as Fake;
  const history = { state: { tree: 'run' }, pushed: [] as unknown[][], pushState(...a: unknown[]) { this.pushed.push(a); } };
  const location = { href: 'http://127.0.0.1/play?room=a' };
  Object.assign(win, { history, location });
  doc = Object.assign(new EventTarget(), { hidden: false, querySelector: (q: string) => (modal && q.includes('aria-modal') ? {} : null) }) as unknown as Fake;
  canvas = Object.assign(new EventTarget(), { tagName: 'CANVAS', getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) }) as unknown as Fake;
  hud = Object.assign(new EventTarget(), { tagName: 'DIV', isContentEditable: false, closest: () => null }) as unknown as Fake;
  Object.assign(globalThis, { window: win, document: doc, history, location });
  setKeys(KEYS_CLICK);
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) (globalThis as Record<string, unknown>)[k] = v;
  setBindCapture(false);
  settingsStore.set({ s: DEFAULT_SETTINGS });
});

describe('binding mouse buttons', () => {
  it('labels every mouse button: Middle Mouse, Mouse 4, Mouse 5', () => {
    expect(['Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4'].map(keyLabel)).toEqual(['Left click', 'Middle Mouse', 'Right click', 'Mouse 4', 'Mouse 5']);
    expect(['Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4'].map(keyCap)).toEqual(['LMB', 'MMB', 'RMB', 'M4', 'M5']);
  });

  it('the capture takes left, middle, right and both side buttons, and moves them like keys', () => {
    expect([0, 1, 2, 3, 4].map(mouseBindCode)).toEqual(['Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4']);
    expect(mouseBindCode(5)).toBeNull();
    expect(mouseBindCode(-1)).toBeNull();
    const a = bindKey(KEYS_CLICK, 'dodge', 0, 'Mouse3');
    expect(a.keys.dodge[0]).toBe('Mouse3');
    const b = bindKey(a.keys, 'interact', 0, 'Mouse3');      // one button, one job
    expect(b.keys.interact[0]).toBe('Mouse3');
    expect(b.keys.dodge).not.toContain('Mouse3');
    expect(b.displaced).toEqual(['dodge']);
  });

  it('swallows the rest of a captured press (its click / context menu) so it cannot reopen the capture', () => {
    vi.useFakeTimers();
    try {
      swallowFollowUp(win as unknown as Window);
      expect(fire(win, 'click').defaultPrevented).toBe(true);
      fire(win, 'mouseup', { button: 3 });
      expect(fire(win, 'auxclick', { button: 3 }).defaultPrevented).toBe(true);
      expect(fire(win, 'contextmenu').defaultPrevented).toBe(true);   // Windows sends it after the release
      vi.advanceTimersByTime(300);
      expect(fire(win, 'click').defaultPrevented).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});

describe('browser defaults never fire', () => {
  it('cancels side-button navigation on every event but pointerdown, and middle-click autoscroll except on links', () => {
    const ev = (type: string, button: number, target: unknown = hud) => {
      let prevented = false;
      const r = suppressBrowserMouse({ type, button, target: target as EventTarget, preventDefault: () => { prevented = true; } });
      expect(r).toBe(prevented);
      return prevented;
    };
    for (const b of [3, 4]) {
      for (const t of ['mousedown', 'mouseup', 'pointerup', 'auxclick']) expect(ev(t, b), `${t} ${b}`).toBe(true);
      expect(ev('pointerdown', b)).toBe(false);   // keeps the compatibility mousedown for the keybind capture
    }
    expect(ev('mousedown', 1)).toBe(true);
    expect(ev('mousedown', 1, canvas)).toBe(true);
    expect(ev('mousedown', 1, { closest: (q: string) => (q === 'a[href]' ? {} : null) })).toBe(false);   // open in a new tab
    expect(ev('mousedown', 0)).toBe(false);
    expect(ev('mouseup', 2)).toBe(false);
  });

  it('the app-wide guard runs in the capture phase on the window and uninstalls cleanly', () => {
    const off = installMouseGuard(win as unknown as Window);
    expect(fire(win, 'mouseup', { button: 4 }).defaultPrevented).toBe(true);
    expect(fire(win, 'mousedown', { button: 1, target: hud }).defaultPrevented).toBe(true);
    expect(fire(win, 'mouseup', { button: 0 }).defaultPrevented).toBe(false);
    off();
    expect(fire(win, 'mouseup', { button: 4 }).defaultPrevented).toBe(false);
  });

  it('during a run a history step is undone before the router sees it', () => {
    const router = vi.fn();
    const off = guardHistory(win as unknown as Window);
    win.addEventListener('popstate', router);
    fire(win, 'popstate');
    expect(router).not.toHaveBeenCalled();
    const h = win.history as { pushed: unknown[][] };
    expect(h.pushed).toEqual([[{ tree: 'run' }, '', 'http://127.0.0.1/play?room=a']]);
    off();
    fire(win, 'popstate');
    expect(router).toHaveBeenCalledTimes(1);
  });

  it('the game view installs both guards while attached', () => {
    const input = new InputController();
    input.attach(canvas as unknown as HTMLElement);
    expect(mouse('mouseup', hud, 3, 0).defaultPrevented).toBe(true);
    expect(mouse('mousedown', canvas, 1, 4).defaultPrevented).toBe(true);
    fire(win, 'popstate');
    expect((win.history as { pushed: unknown[] }).pushed).toHaveLength(1);
    input.detach();
    expect(mouse('mouseup', hud, 3, 0).defaultPrevented).toBe(false);
  });
});

describe('mouse buttons in game', () => {
  const attach = () => { const input = new InputController(); input.attach(canvas as unknown as HTMLElement); return input; };

  it('side buttons and the middle button act like keys, over the canvas or the HUD', () => {
    setKeys({ ...KEYS_CLICK, dodge: ['Mouse3'], skill1: ['Mouse4'], skill2: ['Mouse1'] });
    const input = attach();
    mouse('pointerdown', hud, 3, 8);
    let s = input.sample();
    expect(s.pressed & BTN.DODGE).toBe(BTN.DODGE);
    expect(s.buttons & BTN.DODGE).toBe(BTN.DODGE);
    mouse('pointerup', hud, 3, 0);
    expect(input.sample().buttons & BTN.DODGE).toBe(0);
    mouse('pointerdown', canvas, 4, 16);
    expect(input.sample().pressed & BTN.SKILL1).toBe(BTN.SKILL1);
    mouse('pointerup', canvas, 4, 0);
    mouse('pointerdown', canvas, 1, 4);
    s = input.sample();
    expect(s.pressed & BTN.SKILL2).toBe(BTN.SKILL2);
    input.detach();
  });

  it('a side button pressed while walking with the left button held counts (a chord arrives as a pointermove)', () => {
    setKeys({ ...KEYS_CLICK, dodge: ['Mouse3'] });
    const input = attach();
    mouse('pointerdown', canvas, 0, 1);
    let s = input.sample();
    expect(s.primary).toBe(true);
    expect(s.primaryEdge).toBe(true);
    fire(win, 'pointermove', { button: 3, buttons: 1 | 8, target: canvas });
    s = input.sample();
    expect(s.pressed & BTN.DODGE).toBe(BTN.DODGE);
    expect(s.primary).toBe(true);
    // the compatibility mousedown for the same press changes nothing (no double press)
    mouse('mousedown', canvas, 3, 1 | 8);
    expect(input.sample().pressed & BTN.DODGE).toBe(0);
    fire(win, 'pointermove', { button: 3, buttons: 1, target: canvas });
    s = input.sample();
    expect(s.buttons & BTN.DODGE).toBe(0);
    expect(s.primary).toBe(true);
    // a release outside the window shows up on the next event
    fire(win, 'pointermove', { button: -1, buttons: 0, target: hud });
    expect(input.sample().primary).toBe(false);
    input.detach();
  });

  it('left and right clicks on the HUD never reach the world', () => {
    const input = attach();
    mouse('pointerdown', hud, 0, 1);
    expect(input.sample().primary).toBe(false);
    mouse('pointerup', hud, 0, 0);
    mouse('pointerdown', canvas, 0, 1);
    expect(input.sample().primary).toBe(true);
    input.detach();
  });

  it('a menu over the game takes the mouse, except a button bound to pause / ledger', () => {
    setKeys({ ...KEYS_CLICK, dodge: ['Mouse3'], pause: ['Escape', 'Mouse4'] });
    const input = attach();
    const actions: string[] = [];
    input.onAction = (a) => actions.push(a);
    modal = true;
    mouse('pointerdown', hud, 3, 8);
    mouse('pointerup', hud, 3, 0);
    mouse('pointerdown', hud, 4, 16);
    expect(actions).toEqual(['pause']);
    input.detach();
  });

  it('ignores the press the keybind capture is taking', () => {
    setKeys({ ...KEYS_CLICK, pause: ['Escape', 'Mouse4'] });
    const input = attach();
    const actions: string[] = [];
    input.onAction = (a) => actions.push(a);
    setBindCapture(true);
    expect(bindCaptureActive()).toBe(true);
    mouse('pointerdown', hud, 4, 16);
    setBindCapture(false);
    mouse('mousedown', hud, 4, 16);                    // the rest of the same press
    fire(win, 'pointermove', { button: -1, buttons: 16, target: hud });
    expect(actions).toEqual([]);
    input.detach();
  });

  it('the old middle-drag camera pan is gone: the camera sample has no drag', () => {
    const input = attach();
    mouse('pointerdown', canvas, 1, 4);
    fire(win, 'pointermove', { buttons: 4, clientX: 200, clientY: 300, movementX: 190, movementY: 290, target: canvas });
    expect('drag' in input.camera()).toBe(false);
    input.detach();
  });
});

describe('WASD sample', () => {
  it('keys report digital movement; two keys walk along the iso grid', () => {
    setKeys(KEYS_WASD, 'wasd');
    const input = new InputController();
    input.attach(canvas as unknown as HTMLElement);
    key('keydown', 'KeyW'); key('keydown', 'KeyD');
    const s = input.sample();
    expect([s.mx, s.my, s.analog]).toEqual([1, -1, false]);
    const w = iso.keyToWorld(s.mx, s.my);
    expect(w.x).toBeCloseTo(0, 12);
    expect(w.y).toBeCloseTo(-1, 12);                    // world north: screen up-right along the tile rows
    key('keyup', 'KeyW'); key('keyup', 'KeyD');
    input.detach();
  });
});
