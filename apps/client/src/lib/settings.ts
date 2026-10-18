import { api } from './api';
import { createStore } from './store';
import { deviceAutoTier, isTier, type GfxTier } from '../game/gfxProfile';

// Player settings (REQ ACCESS01, PRD §16.2): font scaling, motion/flash controls, palettes, outlines, captions,
// separate volumes, hold/toggle alternatives and complete keyboard/mouse/controller remapping.
// Visual accessibility options never change simulation rules or invalidate scores.

export type Action = 'moveUp' | 'moveDown' | 'moveLeft' | 'moveRight' | 'attack' | 'forceAttack' | 'skill1' | 'skill2' | 'skill3' | 'signature' | 'dodge' | 'ledger' | 'pause' | 'interact' | 'inventory' | 'minimap'
  | 'cameraLock' | 'cameraCenter' | 'cameraSelf' | 'cameraAlly1' | 'cameraAlly2' | 'cameraAlly3' | 'cameraAlly4';
export const ACTIONS: { id: Action; label: string }[] = [
  { id: 'attack', label: 'Basic attack' }, { id: 'forceAttack', label: 'Attack in place (hold)' },
  { id: 'moveUp', label: 'Move up' }, { id: 'moveDown', label: 'Move down' }, { id: 'moveLeft', label: 'Move left' }, { id: 'moveRight', label: 'Move right' },
  { id: 'skill1', label: 'Skill 1' }, { id: 'skill2', label: 'Skill 2' }, { id: 'skill3', label: 'Skill 3' },
  { id: 'signature', label: 'Signature skill' }, { id: 'dodge', label: 'Dodge' }, { id: 'ledger', label: 'Fate Ledger' }, { id: 'pause', label: 'Pause / menu' },
  { id: 'interact', label: 'Interact (swap, shrine, trade)' }, { id: 'inventory', label: 'Legendary gear' }, { id: 'minimap', label: 'Minimap' },
  { id: 'cameraLock', label: 'Camera lock (toggle)' }, { id: 'cameraCenter', label: 'Center camera (hold)' }, { id: 'cameraSelf', label: 'Camera on you (hold)' },
  { id: 'cameraAlly1', label: 'Camera on ally 1 (hold)' }, { id: 'cameraAlly2', label: 'Camera on ally 2 (hold)' }, { id: 'cameraAlly3', label: 'Camera on ally 3 (hold)' }, { id: 'cameraAlly4', label: 'Camera on ally 4 (hold)' },
];
export const ACTION_IDS: Action[] = ACTIONS.map((a) => a.id);
const MOVE_ACTIONS: Action[] = ['moveUp', 'moveDown', 'moveLeft', 'moveRight'];

/**
 * Control scheme (Diablo-style click-to-move by default): 'click' walks / attacks where you click (the attack binding
 * becomes "Move / attack"), arrow keys still step; 'wasd' is the classic keyboard movement with the mouse aiming.
 */
export type ControlScheme = 'click' | 'wasd';
export const CONTROL_SCHEMES: { id: ControlScheme; label: string }[] = [{ id: 'click', label: 'Click to move' }, { id: 'wasd', label: 'Keyboard (WASD)' }];
/** Saves below this revision predate click-to-move and are migrated to it once (with a notice). */
export const CONTROLS_REV = 2;

/** Row label for an action under a control scheme. */
export function actionLabel(id: Action, scheme: ControlScheme): string {
  if (scheme === 'click') {
    if (id === 'attack') return 'Move / attack (click)';
    if (id === 'forceAttack') return 'Attack in place (hold with click)';
    if (MOVE_ACTIONS.includes(id)) return 'Step ' + id.slice(4).toLowerCase() + ' (keyboard)';
  }
  return ACTIONS.find((a) => a.id === id)?.label ?? id;
}

export type PaletteId = 'default' | 'deuteranopia' | 'protanopia' | 'tritanopia' | 'highContrast';

export interface Settings {
  version: 1;
  volumes: { master: number; music: number; combat: number; ui: number; ambience: number };
  fontScale: number;
  reducedMotion: boolean;
  reducedEffects: boolean;
  screenShake: boolean;
  flashes: boolean;
  hitStop: boolean;
  chromatic: boolean;
  palette: PaletteId;
  allyOutline: boolean;
  enemyOutline: boolean;
  captions: boolean;
  damageNumbers: boolean;
  attackMode: 'hold' | 'toggle';
  /** movement scheme (see ControlScheme); controlsRev marks saves migrated to click-to-move, controlsNotice shows the
   *  one-time "Click to move is now the default" hint after that migration */
  controlScheme: ControlScheme;
  controlsRev: number;
  controlsNotice: boolean;
  autoAttack: boolean;
  aimAssist: boolean;
  /** League of Legends camera (game/cameraRig.ts): locked follows the hero, unlocked (default) stays where you leave
   *  it; the pointer at the window edge pans at edgePanSpeed (x the base speed, 0.25-2) */
  camLocked: boolean;
  edgePan: boolean;
  edgePanSpeed: number;
  keys: Record<Action, string[]>;
  pad: Record<Action, number[]>;
  devOverlay: boolean;
  tutorialDone: boolean;
  /** controller vibration on hits, downs and boss slams (lib/gamepad.ts) */
  rumble: boolean;
  /** graphics quality tier in use (game/gfx.ts). With graphicsAuto it follows this device's first-run capability
   *  probe (game/gfxProfile.ts), which the frame-rate watchdog may lower; both stay device-local when profiles sync */
  graphics: GfxTier;
  graphicsAuto: boolean;
}

/**
 * League of Legends camera keys (both layouts). Y toggles the lock, as in LoL. LoL centres on Space, but Space is our
 * Dodge, so Center sits on C (for "centre"): free in both layouts and within reach of the left hand whether it rests
 * on Q W E R or W A S D. F1 holds the camera on you and F2-F5 on teammates, as in LoL.
 */
const KEYS_CAMERA = {
  cameraLock: ['KeyY'], cameraCenter: ['KeyC'], cameraSelf: ['F1'], cameraAlly1: ['F2'], cameraAlly2: ['F3'], cameraAlly3: ['F4'], cameraAlly4: ['F5'],
} satisfies Partial<Record<Action, string[]>>;
export const CAMERA_ACTIONS = Object.keys(KEYS_CAMERA) as Action[];

/** Diablo layout: left click walks / attacks, Shift holds position, Q W E R the hotbar (R and right click: signature). */
export const KEYS_CLICK: Record<Action, string[]> = {
  moveUp: ['ArrowUp'], moveDown: ['ArrowDown'], moveLeft: ['ArrowLeft'], moveRight: ['ArrowRight'],
  attack: ['Mouse0'], forceAttack: ['ShiftLeft', 'ShiftRight'], skill1: ['KeyQ'], skill2: ['KeyW'], skill3: ['KeyE'], signature: ['Mouse2', 'KeyR'],
  dodge: ['Space'], ledger: ['Tab'], pause: ['Escape', 'KeyP'], interact: ['KeyG'], inventory: ['KeyI'], minimap: ['KeyM'], ...KEYS_CAMERA,
};
/** Classic layout: WASD walks, the mouse aims, Q E R skills. */
export const KEYS_WASD: Record<Action, string[]> = {
  moveUp: ['KeyW', 'ArrowUp'], moveDown: ['KeyS', 'ArrowDown'], moveLeft: ['KeyA', 'ArrowLeft'], moveRight: ['KeyD', 'ArrowRight'],
  attack: ['Mouse0'], forceAttack: ['ShiftLeft', 'ShiftRight'], skill1: ['KeyQ'], skill2: ['KeyE'], skill3: ['KeyR'], signature: ['Mouse2', 'KeyF'],
  dodge: ['Space'], ledger: ['Tab'], pause: ['Escape', 'KeyP'], interact: ['KeyG'], inventory: ['KeyI'], minimap: ['KeyM'], ...KEYS_CAMERA,
};
export const SCHEME_KEYS: Record<ControlScheme, Record<Action, string[]>> = { click: KEYS_CLICK, wasd: KEYS_WASD };

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  volumes: { master: 0.8, music: 0.55, combat: 0.8, ui: 0.7, ambience: 0.5 },
  fontScale: 1,
  reducedMotion: false,
  reducedEffects: false,
  screenShake: true,
  flashes: true,
  hitStop: true,
  chromatic: true,
  palette: 'default',
  allyOutline: false,
  enemyOutline: false,
  captions: true,
  damageNumbers: true,
  attackMode: 'hold',
  controlScheme: 'click',
  controlsRev: CONTROLS_REV,
  controlsNotice: false,
  autoAttack: false,
  aimAssist: false,
  camLocked: false,
  edgePan: true,
  edgePanSpeed: 1,
  keys: KEYS_CLICK,
  // Standard gamepad mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 Back, 9 Start
  pad: { moveUp: [12], moveDown: [13], moveLeft: [14], moveRight: [15], attack: [7], forceAttack: [], skill1: [2], skill2: [3], skill3: [1], signature: [5], dodge: [0, 4], ledger: [8], pause: [9], interact: [6], inventory: [], minimap: [],
    cameraLock: [], cameraCenter: [], cameraSelf: [], cameraAlly1: [], cameraAlly2: [], cameraAlly3: [], cameraAlly4: [] },
  devOverlay: false,
  tutorialDone: false,
  rumble: true,
  graphics: 'high',
  graphicsAuto: true,
};

const KEY = 'cursebound.settings';

const sameKeys = (a: readonly string[] | undefined, b: readonly string[]) => !!a && a.length === b.length && a.every((k, i) => k === b[i]);

/**
 * Re-lay keyboard bindings from one scheme's defaults onto another's: actions still on the old default take the new
 * default; actions the player remapped keep their keys (those keys are freed from every other action). Movement
 * always takes the target scheme's keys (click-to-move keeps only the arrow-key step).
 */
export function convertKeys(keys: Partial<Record<Action, string[]>>, from: Record<Action, string[]>, to: Record<Action, string[]>): Record<Action, string[]> {
  const out = Object.fromEntries(ACTION_IDS.map((a) => [a, [...to[a]]])) as Record<Action, string[]>;
  for (const a of ACTION_IDS) {
    if (MOVE_ACTIONS.includes(a)) continue;
    const mine = keys[a];
    if (!mine || sameKeys(mine, from[a])) continue;
    for (const b of ACTION_IDS) if (b !== a) out[b] = out[b].filter((k) => !mine.includes(k));
    out[a] = [...mine];
  }
  // an action a remap left without keys falls back to its previous keys that are still free
  const used = new Set(ACTION_IDS.flatMap((a) => out[a]));
  for (const a of ACTION_IDS) {
    if (out[a].length || MOVE_ACTIONS.includes(a)) continue;
    out[a] = (keys[a] ?? from[a]).filter((k) => !used.has(k));
    for (const k of out[a]) used.add(k);
  }
  return out;
}

/** Fill defaults for missing fields; a save from before click-to-move moves to it once (with a notice). */
export function normalizeSettings(raw: Partial<Settings>): { s: Settings; migrated: boolean } {
  const s: Settings = {
    ...DEFAULT_SETTINGS, ...raw,
    volumes: { ...DEFAULT_SETTINGS.volumes, ...raw.volumes }, keys: { ...DEFAULT_SETTINGS.keys, ...raw.keys }, pad: { ...DEFAULT_SETTINGS.pad, ...raw.pad },
  };
  // graphics arrived after version 1 saves: missing or unknown values fall back to Auto
  if (!isTier(s.graphics)) { s.graphics = DEFAULT_SETTINGS.graphics; s.graphicsAuto = true; }
  if (typeof s.graphicsAuto !== 'boolean') s.graphicsAuto = true;
  if (!(s.edgePanSpeed >= 0.25 && s.edgePanSpeed <= 2)) s.edgePanSpeed = DEFAULT_SETTINGS.edgePanSpeed;
  // actions newer than the save (the camera keys) take their defaults only where the player has not used that key
  if (raw.keys) {
    const fresh = ACTION_IDS.filter((a) => !raw.keys![a]);
    const used = new Set(ACTION_IDS.filter((a) => !fresh.includes(a)).flatMap((a) => s.keys[a]));
    for (const a of fresh) s.keys[a] = s.keys[a].filter((k) => !used.has(k));
  }
  if ((raw.controlsRev ?? 0) >= CONTROLS_REV) {
    if (s.controlScheme !== 'click' && s.controlScheme !== 'wasd') s.controlScheme = 'click';
    return { s, migrated: false };
  }
  // WASD-era save: the stored keys sit on the classic defaults (plus any remaps); take the click layout once
  const legacy = { ...KEYS_WASD, ...(raw.keys ?? {}) };
  return { s: { ...s, keys: convertKeys(legacy, KEYS_WASD, KEYS_CLICK), controlScheme: 'click', controlsRev: CONTROLS_REV, controlsNotice: true }, migrated: true };
}

let hadLocalSave = false;

/** Auto graphics resolves to this device's probed tier (the first run probes once and remembers it per device). */
function withDeviceGraphics(s: Settings): Settings {
  if (!s.graphicsAuto || typeof window === 'undefined') return s;
  const graphics = deviceAutoTier();
  return graphics === s.graphics ? s : { ...s, graphics };
}

function load(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return withDeviceGraphics(DEFAULT_SETTINGS);
    hadLocalSave = true;
    const { s, migrated } = normalizeSettings(JSON.parse(raw) as Partial<Settings>);
    if (migrated) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }
    return withDeviceGraphics(s);
  } catch { return withDeviceGraphics(DEFAULT_SETTINGS); }
}

export const settingsStore = createStore<{ s: Settings; loaded: boolean }>({ s: DEFAULT_SETTINGS, loaded: false });

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let profileId: string | null = null;

export function initSettings(pid?: string) {
  if (settingsStore.get().loaded && pid === profileId) return;
  settingsStore.set({ s: load(), loaded: true });
  applyDocumentSettings(settingsStore.get().s);
  if (pid) {
    profileId = pid;
    api<{ settings: Partial<Settings> | null }>('GET', `/local/settings/${pid}`).then((r) => {
      if (r.settings && typeof r.settings === 'object' && (r.settings as Settings).version === 1) {
        const local = settingsStore.get().s;
        const remote = r.settings;
        let merged = { ...local, ...remote, volumes: { ...local.volumes, ...remote.volumes }, keys: { ...local.keys, ...remote.keys }, pad: { ...local.pad, ...remote.pad } } as Settings;
        const stale = (remote.controlsRev ?? 0) < CONTROLS_REV;
        if (stale) {
          // the profile copy predates click-to-move: move its keys over, but keep a scheme already chosen on this device
          const moved = normalizeSettings(remote).s;
          merged = hadLocalSave
            ? { ...merged, keys: local.controlScheme === 'wasd' ? local.keys : moved.keys, controlScheme: local.controlScheme, controlsRev: CONTROLS_REV, controlsNotice: local.controlsNotice }
            : { ...merged, keys: moved.keys, controlScheme: 'click', controlsRev: CONTROLS_REV, controlsNotice: true };
        } else merged = normalizeSettings(merged).s;
        // graphics belong to the machine, not the profile: a strong desktop's choice must not follow you to a laptop
        merged = { ...merged, graphics: local.graphics, graphicsAuto: local.graphicsAuto };
        settingsStore.set({ s: merged });
        applyDocumentSettings(merged);
        try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* ignore */ }
        if (stale) api('PUT', `/local/settings/${pid}`, { settings: merged }).catch(() => undefined);
      }
    }).catch(() => undefined);
  }
}

export function updateSettings(patch: Partial<Settings>) {
  const s = { ...settingsStore.get().s, ...patch };
  settingsStore.set({ s });
  applyDocumentSettings(s);
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
  if (profileId) {
    if (syncTimer) clearTimeout(syncTimer);
    const pid = profileId;
    syncTimer = setTimeout(() => { api('PUT', `/local/settings/${pid}`, { settings: s }).catch(() => undefined); }, 600);
  }
}

/** Graphics quality: 'auto' follows this device's probe (and the frame-rate watchdog), a tier pins it. */
export function setGraphics(choice: GfxTier | 'auto') {
  if (choice === 'auto') updateSettings({ graphicsAuto: true, graphics: deviceAutoTier() });
  else updateSettings({ graphicsAuto: false, graphics: choice });
}

/** Switch movement scheme: re-lays the keyboard onto the scheme's layout (remapped actions keep their keys). */
export function setControlScheme(scheme: ControlScheme) {
  const s = settingsStore.get().s;
  if (s.controlScheme === scheme) { if (s.controlsNotice) updateSettings({ controlsNotice: false }); return; }
  updateSettings({ controlScheme: scheme, keys: convertKeys(s.keys, SCHEME_KEYS[s.controlScheme], SCHEME_KEYS[scheme]), controlsNotice: false });
}

/**
 * Bind `code` as the `index`-th key of `action`; the code is removed from every other action so one key never does
 * two things. Returns the actions that lost it (for the remap UI's status line).
 */
export function bindKey(keys: Record<Action, string[]>, action: Action, index: number, code: string): { keys: Record<Action, string[]>; displaced: Action[] } {
  const out = { ...keys };
  const displaced: Action[] = [];
  for (const a of ACTION_IDS) {
    if (a === action || !out[a]?.includes(code)) continue;
    out[a] = out[a].filter((k) => k !== code);
    displaced.push(a);
  }
  const mine = (out[action] ?? []).filter((k) => k !== code);
  mine.splice(Math.min(index, mine.length), index < mine.length ? 1 : 0, code);
  out[action] = mine;
  return { keys: out, displaced };
}

export function applyDocumentSettings(s: Settings) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  // pixel fonts only render crisply at integer multiples of their grid, so text size is a tier (0 normal, 1 large,
  // 2 largest) that swaps the whole CSS type scale instead of multiplying it (see the type tokens in globals.css)
  root.dataset.textSize = String(textSizeTier(s.fontScale));
  root.dataset.reducedMotion = s.reducedMotion ? 'true' : 'false';
  root.dataset.palette = s.palette;
}

/** Text size tier from the stored scale (1 → normal, 1.25 → large, 1.5 → largest). */
export function textSizeTier(scale: number): 0 | 1 | 2 {
  return scale >= 1.45 ? 2 : scale >= 1.15 ? 1 : 0;
}
export const TEXT_SIZES: { scale: number; label: string }[] = [{ scale: 1, label: 'Normal' }, { scale: 1.25, label: 'Large' }, { scale: 1.5, label: 'Largest' }];

/** Compact key label for keycaps under HUD sockets (at most 5 characters). */
export function keyCap(code: string | undefined): string {
  if (!code) return '';
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse1') return 'MMB';
  if (code === 'Mouse2') return 'RMB';
  if (/^Mouse\d+$/.test(code)) return 'M' + (Number(code.slice(5)) + 1);   // side buttons: M4, M5
  if (code === 'Escape') return 'Esc';
  const arrows: Record<string, string> = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
  if (arrows[code]) return arrows[code];
  if (code === 'Space') return 'Space';
  if (code.startsWith('Shift')) return 'Shift';
  if (code.startsWith('Control')) return 'Ctrl';
  if (code.startsWith('Alt')) return 'Alt';
  return keyLabel(code).slice(0, 5);
}

/** Readable name of a bound code. Mouse buttons are 'Mouse' + MouseEvent.button: 1 is the middle button, 3 / 4 the
 *  back / forward side buttons, which mice and games call Mouse 4 / Mouse 5. */
export function keyLabel(code: string): string {
  if (code === 'Mouse0') return 'Left click';
  if (code === 'Mouse1') return 'Middle Mouse';
  if (code === 'Mouse2') return 'Right click';
  if (/^Mouse\d+$/.test(code)) return 'Mouse ' + (Number(code.slice(5)) + 1);
  if (code === 'ShiftLeft') return 'Shift';
  if (code === 'ShiftRight') return 'Right Shift';
  if (code === 'ControlLeft') return 'Ctrl';
  if (code === 'ControlRight') return 'Right Ctrl';
  if (code === 'AltLeft') return 'Alt';
  if (code === 'AltRight') return 'Right Alt';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5) + ' arrow';
  return code;
}

export const PAD_LABELS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'D-up', 'D-down', 'D-left', 'D-right', 'Home'];
