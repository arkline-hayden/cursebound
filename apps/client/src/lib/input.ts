import { CAMERA_ACTIONS, settingsStore, type Action } from './settings';
import { MASK_BUTTON, bindCaptureActive, guardHistory, installMouseGuard } from './mouseGuard';

// Input sampling (PRD §5.1, §16.2, §18.3): remappable keyboard + mouse + standard gamepad, hold/toggle attack,
// held input cleared on blur (no stuck movement), escape reliably releases pointer capture.
// Click-to-move (game/input/ClickMove.ts) reads the raw "move / attack" button (the attack binding), its press edge,
// the attack-in-place modifier and the pointer; the WASD scheme keeps the classic attack bit. Gameplay input is
// neutral while a cinematic plays ('cursebound:cinematic' { active }) or a modal panel is open, and pointer presses
// only count when they land on the game canvas itself (HUD buttons and panels never become world clicks).
// Every mouse button is a bindable input ('Mouse0'-'Mouse4': left, middle, right, back = Mouse 4, forward = Mouse 5).
// Presses are read from MouseEvent.buttons on every pointer / mouse event, so a button pressed while another is held
// counts (the browser sends only a pointermove for such a chord, never a pointerdown). Left and right only count on the
// canvas; middle and the side buttons are plain keys and count over the HUD too. Their browser defaults (history
// navigation, autoscroll) are cancelled (lib/mouseGuard.ts), and while the game is mounted a history step is undone.

export const BTN = { ATTACK: 1, SKILL1: 2, SKILL2: 4, SKILL3: 8, SIGNATURE: 16, DODGE: 32, INTERACT: 64 } as const;

export interface Sample {
  /** direct movement (screen directions) from keys or the left stick */
  mx: number; my: number;
  /** mx / my came from the analog left stick (a free screen direction); otherwise from keys or the D-pad, whose
   *  diagonals walk along the isometric grid (render/iso.ts keyToWorld) */
  analog: boolean;
  /** held ACTION bits: skills, dodge, interact; ATTACK from the WASD scheme or a pad */
  buttons: number;
  /** ACTION bits newly pressed since the previous sample */
  pressed: number;
  stickAim: { x: number; y: number } | null;
  usingPad: boolean;
  /** click-to-move: the "move / attack" button (attack binding) held, pressed since the last sample */
  primary: boolean;
  primaryEdge: boolean;
  /** attack-in-place modifier (Shift) held */
  force: boolean;
  /** a cinematic is playing or a modal panel is open: everything above is neutral */
  blocked: boolean;
}

const BIT: Partial<Record<Action, number>> = {
  skill1: BTN.SKILL1, skill2: BTN.SKILL2, skill3: BTN.SKILL3, signature: BTN.SIGNATURE, dodge: BTN.DODGE, interact: BTN.INTERACT,
};

/** Camera intents since the previous camera sample (CombatScene's League of Legends camera, game/cameraRig.ts). */
export interface CameraSample {
  /** the lock toggle was pressed */
  lock: boolean;
  /** Center camera held (or tapped since the last sample) */
  center: boolean;
  /** F1-F5 style focus held: 0 = you, 1-4 = teammates in party order; null when none */
  focus: number | null;
  /** pointer in window CSS px and the window size, when it is over the game view itself (not HUD / panels) */
  edge: { x: number; y: number; w: number; h: number } | null;
}
const FOCUS_ACTIONS: Action[] = ['cameraSelf', 'cameraAlly1', 'cameraAlly2', 'cameraAlly3', 'cameraAlly4'];

export class InputController {
  private down = new Set<string>();
  private edges = new Set<Action>();
  private attackToggled = false;
  private el: HTMLElement | null = null;
  private padPrev: boolean[] = [];
  private prevButtons = 0;
  private modalAt = -1e9;
  private modal = false;
  usingPad = false;
  /** pointer in canvas CSS pixels; `inside` = the pointer is over the canvas itself (not over HUD / panels) */
  pointer = { x: 0, y: 0, inside: false };
  /** pointer in window CSS pixels (edge panning) */
  private client = { x: 0, y: 0 };
  /** camera key presses not yet read by camera() */
  private camEdges = new Set<Action>();
  /** mouse buttons held as of the last pointer / mouse event (MouseEvent.buttons bits) */
  private mouseMask = 0;
  /** a cinematic is playing (CINEMA's 'cursebound:cinematic' event) */
  cinematic = false;
  onAction: ((a: Action) => void) | null = null;
  private handlers: [EventTarget, string, EventListener][] = [];
  private undo: (() => void)[] = [];

  attach(el: HTMLElement) {
    this.el = el;
    // a scene mounted mid-cutscene starts gated (CINEMA mirrors its state on window.__cbCinematic)
    this.cinematic = !!(window as unknown as { __cbCinematic?: { active?: boolean } }).__cbCinematic?.active;
    const on = (t: EventTarget, ev: string, fn: EventListener, opts?: AddEventListenerOptions) => { t.addEventListener(ev, fn, opts); this.handlers.push([t, ev, fn]); };
    on(window, 'keydown', ((e: KeyboardEvent) => this.key(e, true)) as EventListener);
    on(window, 'keyup', ((e: KeyboardEvent) => this.key(e, false)) as EventListener);
    on(el, 'pointerdown', ((e: PointerEvent) => { this.usingPad = false; this.track(e); }) as EventListener);
    // every button change, chords included (a press while another button is held arrives as a pointermove)
    const buttons = ((e: MouseEvent) => this.mouse(e)) as EventListener;
    for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'mouseup']) on(window, ev, buttons);
    // tracked on the window so a held click keeps steering while the pointer crosses the HUD
    on(window, 'pointermove', ((e: PointerEvent) => {
      this.track(e);
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this.usingPad = false;
      this.mouse(e);
    }) as EventListener);
    // side buttons never navigate and the middle button never autoscrolls (also without the app-wide ui/MouseGuard);
    // a history step the browser takes anyway, out of the page's reach, is undone while the game is up
    this.undo.push(installMouseGuard(window));
    if (typeof history !== 'undefined' && typeof location !== 'undefined') this.undo.push(guardHistory(window));
    on(el, 'pointerleave', (() => { this.pointer.inside = false; }) as EventListener);
    on(el, 'contextmenu', ((e: Event) => e.preventDefault()) as EventListener);
    on(window, 'blur', (() => this.clear()) as EventListener);
    on(document, 'visibilitychange', (() => { if (document.hidden) this.clear(); }) as EventListener);
    on(window, 'cursebound:cinematic', ((e: CustomEvent) => {
      const active = !!e.detail?.active;
      if (active && !this.cinematic) this.clear();
      this.cinematic = active;
    }) as EventListener);
  }

  detach() {
    for (const [t, ev, fn] of this.handlers) t.removeEventListener(ev, fn);
    this.handlers = [];
    for (const u of this.undo.splice(0)) u();
    this.clear();
  }

  clear() { this.down.clear(); this.edges.clear(); this.camEdges.clear(); this.mouseMask = 0; this.attackToggled = false; }

  private track(e: PointerEvent) {
    const el = this.el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top, inside: e.target === el };
    this.client = { x: e.clientX, y: e.clientY };
  }

  /**
   * Re-derive the canvas-relative pointer from the last window position: after a resize the canvas moves and changes
   * size under a mouse that has not moved, and the old canvas-relative point would aim at the wrong spot.
   */
  refreshPointer() {
    const el = this.el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    this.pointer = { x: this.client.x - r.left, y: this.client.y - r.top, inside: this.pointer.inside };
  }

  private isTextTarget(e: Event) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  /**
   * Mouse buttons from MouseEvent.buttons, diffed against the last event: presses and releases of every button,
   * including one pressed while another is held and a release outside the window (the next event shows it).
   */
  private mouse(e: MouseEvent) {
    const mask = (e.buttons ?? 0) & 31;
    const changed = mask ^ this.mouseMask;
    if (!changed) return;
    this.mouseMask = mask;
    for (let bit = 0; bit < MASK_BUTTON.length; bit++) {
      if (!(changed & (1 << bit))) continue;
      const code = `Mouse${MASK_BUTTON[bit]}`;
      if (!(mask & (1 << bit))) this.press(code, false);
      else if (this.mayPress(e, MASK_BUTTON[bit], code)) { this.usingPad = false; this.press(code, true); }
    }
  }

  /** Whether a mouse button going down counts. Left / right: only on the canvas (HUD clicks never reach the world). */
  private mayPress(e: MouseEvent, button: number, code: string): boolean {
    if (this.cinematic || bindCaptureActive()) return false;
    if (this.el && e.target === this.el) return true;
    if (button === 0 || button === 2) return false;
    if (this.isTextTarget(e)) return false;
    // a menu open over a live game takes the mouse, except a button bound to the ledger / pause toggles (as keys)
    if (typeof document !== 'undefined' && document.querySelector('[role="dialog"][aria-modal="true"]')) {
      const k = settingsStore.get().s.keys;
      return !!(k.ledger?.includes(code) || k.pause?.includes(code));
    }
    return true;
  }

  private key(e: KeyboardEvent, isDown: boolean) {
    if (this.isTextTarget(e)) return;
    const keys = settingsStore.get().s.keys;
    const bound = (Object.keys(keys) as Action[]).some((a) => keys[a]?.includes(e.code));
    // bound function keys (camera F1-F5) must not open help, search or reload the page
    if (bound && (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || /^F\d{1,2}$/.test(e.code))) e.preventDefault();
    if (isDown && e.repeat) return;
    if (isDown && this.cinematic) return;
    // a menu open over a live (multiplayer) game: keys belong to the menu, except the ledger / pause toggles
    if (isDown && document.querySelector('[role="dialog"][aria-modal="true"]')) {
      const k = settingsStore.get().s.keys;
      if (!k.ledger?.includes(e.code) && !k.pause?.includes(e.code)) return;
    }
    this.usingPad = false;
    this.press(e.code, isDown);
  }

  private press(code: string, isDown: boolean) {
    const s = settingsStore.get().s;
    if (isDown) this.down.add(code); else this.down.delete(code);
    if (!isDown) return;
    for (const a of Object.keys(s.keys) as Action[]) {
      if (!s.keys[a]?.includes(code)) continue;
      this.edges.add(a);
      if (CAMERA_ACTIONS.includes(a)) this.camEdges.add(a);
      if (a === 'attack' && s.attackMode === 'toggle' && s.controlScheme === 'wasd') this.attackToggled = !this.attackToggled;
      if (a === 'ledger' || a === 'pause') this.onAction?.(a);
    }
  }

  private held(a: Action): boolean {
    const keys = settingsStore.get().s.keys[a];
    return !!keys && keys.some((k) => this.down.has(k));
  }

  /** A modal panel (pause menu, ledger, gear) is open: gameplay input pauses. Polled at most every 250 ms. */
  private modalOpen(): boolean {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.modalAt > 250) {
      this.modalAt = now;
      this.modal = typeof document !== 'undefined' && !!document.querySelector('[aria-modal="true"]');
    }
    return this.modal;
  }

  /**
   * Camera intents, polled once per frame after sample(). Neutral while a cinematic plays or a modal panel is open;
   * edge panning only reports while the pointer is over the game view itself (not the HUD or a panel) and the mouse,
   * not a controller, is in use.
   */
  camera(): CameraSample {
    const on = (a: Action) => this.held(a) || this.camEdges.has(a);
    const lock = this.camEdges.has('cameraLock');
    const center = on('cameraCenter');
    const f = FOCUS_ACTIONS.findIndex(on);
    this.camEdges.clear();
    if (this.cinematic || this.modalOpen()) return { lock: false, center: false, focus: null, edge: null };
    const edge = this.pointer.inside && !this.usingPad && typeof window !== 'undefined'
      ? { x: this.client.x, y: this.client.y, w: window.innerWidth, h: window.innerHeight } : null;
    return { lock, center, focus: f < 0 ? null : f, edge };
  }

  /** Poll once per frame. */
  sample(): Sample {
    const s = settingsStore.get().s;
    const blocked = this.cinematic || this.modalOpen();
    // a tap that went down and up between two frames still counts for this frame
    const on = (a: Action) => this.held(a) || this.edges.has(a);
    let mx = (on('moveRight') ? 1 : 0) - (on('moveLeft') ? 1 : 0);
    let my = (on('moveDown') ? 1 : 0) - (on('moveUp') ? 1 : 0);
    let analog = false;
    let buttons = 0;
    const click = s.controlScheme !== 'wasd';
    if (!click) {
      const attackHeld = s.attackMode === 'toggle' ? this.attackToggled : on('attack');
      if (attackHeld) buttons |= BTN.ATTACK;
    }
    for (const a of Object.keys(BIT) as Action[]) if (on(a)) buttons |= BIT[a]!;
    const primary = click && on('attack');
    const primaryEdge = click && this.edges.has('attack');
    const force = on('forceAttack');
    let stickAim: Sample['stickAim'] = null;
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
      const lx = dz(pad.axes[0] ?? 0), ly = dz(pad.axes[1] ?? 0);
      const rx = dz(pad.axes[2] ?? 0), ry = dz(pad.axes[3] ?? 0);
      const pressed = pad.buttons.map((b) => b.pressed || b.value > 0.5);
      if (lx || ly || rx || ry || pressed.some(Boolean)) this.usingPad = true;
      if (lx || ly) { mx = lx; my = ly; analog = true; }
      if (rx || ry) stickAim = { x: rx, y: ry };
      const padHeld = (a: Action) => (s.pad[a] ?? []).some((i) => pressed[i]);
      if ((['moveUp', 'moveDown', 'moveLeft', 'moveRight'] as Action[]).some(padHeld)) analog = false;   // the D-pad steps like keys
      if (padHeld('moveUp')) my = -1; if (padHeld('moveDown')) my = 1; if (padHeld('moveLeft')) mx = -1; if (padHeld('moveRight')) mx = 1;
      if (padHeld('attack')) buttons |= BTN.ATTACK;
      for (const a of Object.keys(BIT) as Action[]) if (padHeld(a)) buttons |= BIT[a]!;
      // gear panel on a pad button (keyboard opens it from the DOM listener in GearLayer)
      const inv = padHeld('inventory');
      if (inv && !this.padPrev[2]) window.dispatchEvent(new CustomEvent('cursebound:inventory'));
      this.padPrev[2] = inv;
      for (const a of ['ledger', 'pause'] as Action[]) {
        const now = padHeld(a);
        const key = a === 'ledger' ? 0 : 1;
        if (now && !this.padPrev[key]) this.onAction?.(a);
        this.padPrev[key] = now;
      }
      break;
    }
    // rising edges since the last sample (taps latched in `edges` included)
    let tapped = 0;
    for (const a of this.edges) tapped |= BIT[a] ?? 0;
    const pressedBits = (buttons & ~this.prevButtons) | tapped;
    this.prevButtons = buttons;
    this.edges.clear();
    if (blocked) {
      return { mx: 0, my: 0, analog: false, buttons: 0, pressed: 0, stickAim: null, usingPad: this.usingPad, primary: false, primaryEdge: false, force: false, blocked: true };
    }
    return { mx, my, analog, buttons, pressed: pressedBits & buttons, stickAim, usingPad: this.usingPad, primary, primaryEdge, force, blocked: false };
  }
}
