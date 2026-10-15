import { CAMERA_ACTIONS, settingsStore, type Action } from './settings';

// Input sampling (PRD §5.1, §16.2, §18.3): remappable keyboard + mouse + standard gamepad, hold/toggle attack,
// held input cleared on blur (no stuck movement), escape reliably releases pointer capture.
// Click-to-move (game/input/ClickMove.ts) reads the raw "move / attack" button (the attack binding), its press edge,
// the attack-in-place modifier and the pointer; the WASD scheme keeps the classic attack bit. Gameplay input is
// neutral while a cinematic plays ('cursebound:cinematic' { active }) or a modal panel is open, and pointer presses
// only count when they land on the game canvas itself (HUD buttons and panels never become world clicks).

export const BTN = { ATTACK: 1, SKILL1: 2, SKILL2: 4, SKILL3: 8, SIGNATURE: 16, DODGE: 32, INTERACT: 64 } as const;

export interface Sample {
  /** direct movement (screen directions) from keys or the left stick */
  mx: number; my: number;
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
  /** middle-mouse drag since the last sample, in CSS px */
  drag: { x: number; y: number };
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
  /** camera key presses not yet read by camera(), and the middle-mouse drag (accumulated CSS px) */
  private camEdges = new Set<Action>();
  private drag = { active: false, x: 0, y: 0, ax: 0, ay: 0 };
  /** a cinematic is playing (CINEMA's 'cursebound:cinematic' event) */
  cinematic = false;
  onAction: ((a: Action) => void) | null = null;
  private handlers: [EventTarget, string, EventListener][] = [];

  attach(el: HTMLElement) {
    this.el = el;
    // a scene mounted mid-cutscene starts gated (CINEMA mirrors its state on window.__cbCinematic)
    this.cinematic = !!(window as unknown as { __cbCinematic?: { active?: boolean } }).__cbCinematic?.active;
    const on = (t: EventTarget, ev: string, fn: EventListener, opts?: AddEventListenerOptions) => { t.addEventListener(ev, fn, opts); this.handlers.push([t, ev, fn]); };
    on(window, 'keydown', ((e: KeyboardEvent) => this.key(e, true)) as EventListener);
    on(window, 'keyup', ((e: KeyboardEvent) => this.key(e, false)) as EventListener);
    on(el, 'pointerdown', ((e: PointerEvent) => {
      this.usingPad = false;
      this.track(e);
      if (this.cinematic) return;
      // middle-mouse drag pans the camera (and never starts the browser's autoscroll)
      if (e.button === 1) { e.preventDefault(); this.drag = { active: true, x: e.clientX, y: e.clientY, ax: 0, ay: 0 }; }
      this.press(`Mouse${e.button}`, true);
    }) as EventListener);
    on(el, 'mousedown', ((e: MouseEvent) => { if (e.button === 1) e.preventDefault(); }) as EventListener);
    on(window, 'pointerup', ((e: PointerEvent) => {
      if (e.button === 1) this.drag.active = false;
      this.press(`Mouse${e.button}`, false);
    }) as EventListener);
    // tracked on the window so a held click keeps steering while the pointer crosses the HUD
    on(window, 'pointermove', ((e: PointerEvent) => {
      this.track(e);
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this.usingPad = false;
      if (this.drag.active) {
        if (!(e.buttons & 4)) this.drag.active = false;   // released outside the window
        else { this.drag.ax += e.clientX - this.drag.x; this.drag.ay += e.clientY - this.drag.y; this.drag.x = e.clientX; this.drag.y = e.clientY; }
      }
    }) as EventListener);
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
    this.clear();
  }

  clear() { this.down.clear(); this.edges.clear(); this.camEdges.clear(); this.drag.active = false; this.attackToggled = false; }

  private track(e: PointerEvent) {
    const el = this.el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top, inside: e.target === el };
    this.client = { x: e.clientX, y: e.clientY };
  }

  private isTextTarget(e: Event) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  private key(e: KeyboardEvent, isDown: boolean) {
    if (this.isTextTarget(e)) return;
    const keys = settingsStore.get().s.keys;
    const bound = (Object.keys(keys) as Action[]).some((a) => keys[a]?.includes(e.code));
    // bound function keys (camera F1-F5) must not open help, search or reload the page
    if (bound && (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || /^F\d{1,2}$/.test(e.code))) e.preventDefault();
    if (isDown && e.repeat) return;
    if (isDown && this.cinematic) return;
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
    const drag = { x: this.drag.ax, y: this.drag.ay };
    this.drag.ax = 0; this.drag.ay = 0;
    this.camEdges.clear();
    if (this.cinematic || this.modalOpen()) return { lock: false, center: false, focus: null, drag: { x: 0, y: 0 }, edge: null };
    const edge = this.pointer.inside && !this.usingPad && typeof window !== 'undefined'
      ? { x: this.client.x, y: this.client.y, w: window.innerWidth, h: window.innerHeight } : null;
    return { lock, center, focus: f < 0 ? null : f, drag, edge };
  }

  /** Poll once per frame. */
  sample(): Sample {
    const s = settingsStore.get().s;
    const blocked = this.cinematic || this.modalOpen();
    // a tap that went down and up between two frames still counts for this frame
    const on = (a: Action) => this.held(a) || this.edges.has(a);
    let mx = (on('moveRight') ? 1 : 0) - (on('moveLeft') ? 1 : 0);
    let my = (on('moveDown') ? 1 : 0) - (on('moveUp') ? 1 : 0);
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
      if (lx || ly) { mx = lx; my = ly; }
      if (rx || ry) stickAim = { x: rx, y: ry };
      const padHeld = (a: Action) => (s.pad[a] ?? []).some((i) => pressed[i]);
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
      return { mx: 0, my: 0, buttons: 0, pressed: 0, stickAim: null, usingPad: this.usingPad, primary: false, primaryEdge: false, force: false, blocked: true };
    }
    return { mx, my, buttons, pressed: pressedBits & buttons, stickAim, usingPad: this.usingPad, primary, primaryEdge, force, blocked: false };
  }
}
