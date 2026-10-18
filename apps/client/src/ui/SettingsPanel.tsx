'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { padGlyph, padStore } from '@/lib/gamepad';
import { ACTIONS, CONTROL_SCHEMES, DEFAULT_SETTINGS, SCHEME_KEYS, TEXT_SIZES, actionLabel, bindKey, keyLabel, setControlScheme, setGraphics, settingsStore, textSizeTier, updateSettings, type Action, type PaletteId, type Settings } from '@/lib/settings';
import { useStore } from '@/lib/store';
import { mouseBindCode, setBindCapture, swallowFollowUp } from '@/lib/mouseGuard';
import { GFX_LABELS, GFX_TIERS, slowHint, stepDown, type GfxTier } from '@/game/gfx';

// Settings (REQ ACCESS01): semantic, labelled controls; complete remapping including mouse actions and gamepad.
// Tabbed (WAI-ARIA tabs: arrow keys / Home / End move between tabs) so each group fits a 1280x720 screen; the last
// tab is remembered for the session (and in ?tab= on the settings page). Shared by /settings and the pause menu.

const TABS = [
  { id: 'graphics', label: 'Graphics' },
  { id: 'gameplay', label: 'Gameplay' },
  { id: 'controls', label: 'Controls' },
  { id: 'audio', label: 'Audio' },
  { id: 'access', label: 'Accessibility' },
] as const;
type TabId = (typeof TABS)[number]['id'];
const TAB_KEY = 'cursebound.settings.tab';
const isTab = (v: unknown): v is TabId => TABS.some((t) => t.id === v);

function Toggle({ k, label, hint }: { k: keyof Settings; label: string; hint?: string }) {
  const s = useStore(settingsStore, (x) => x.s);
  return (
    <label className="set-row">
      <span>{label}{hint && <span className="hint-text">{hint}</span>}</span>
      <input type="checkbox" checked={!!s[k]} onChange={(e) => updateSettings({ [k]: e.target.checked } as Partial<Settings>)} />
    </label>
  );
}

/** Segmented pixel buttons (radio group) for a small set of choices. */
function Seg<T extends string | number>({ labelId, options, value, onPick, className = '' }: { labelId: string; options: { id: T; label: string; title?: string }[]; value: T | null; onPick: (id: T) => void; className?: string }) {
  return (
    <span className={`seg ${className}`} role="radiogroup" aria-labelledby={labelId}>
      {options.map((o) => {
        const on = o.id === value;
        return <button key={String(o.id)} type="button" role="radio" aria-checked={on} title={o.title} className={on ? 'btn small' : 'btn small ghost'} onClick={() => onPick(o.id)}>{o.label}</button>;
      })}
    </span>
  );
}

export function SettingsPanel({ compact = false }: { compact?: boolean }) {
  const s = useStore(settingsStore, (x) => x.s);
  const uid = useId();
  const [tab, setTabState] = useState<TabId>('graphics');
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [capture, setCapture] = useState<{ action: Action; kind: 'key' | 'pad'; index: number } | null>(null);
  const pad = useStore(padStore, (x) => x);
  const [bindNote, setBindNote] = useState<string | null>(null);
  // device-local slow-frame report (localStorage, so read after mount to keep hydration stable)
  const [slow, setSlow] = useState<GfxTier | null>(null);
  useEffect(() => { setSlow(slowHint()?.tier ?? null); }, [s.graphics]);

  // restore the last tab: ?tab= on the settings page wins, then this session's last pick
  useEffect(() => {
    try {
      const fromUrl = compact ? null : new URLSearchParams(window.location.search).get('tab');
      const saved = isTab(fromUrl) ? fromUrl : sessionStorage.getItem(TAB_KEY);
      if (isTab(saved)) setTabState(saved);
    } catch { /* storage blocked: start on Graphics */ }
  }, [compact]);
  const setTab = (id: TabId, focus = false) => {
    setTabState(id);
    setCapture(null);
    if (focus) tabRefs.current[id]?.focus();
    try {
      sessionStorage.setItem(TAB_KEY, id);
      if (!compact) {
        const url = new URL(window.location.href);
        url.searchParams.set('tab', id);
        window.history.replaceState(window.history.state, '', url);
      }
    } catch { /* ignore */ }
  };
  const onTabKey = (e: ReactKeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i - 1 + TABS.length) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next].id, true);
  };

  useEffect(() => {
    if (!capture) return;
    const done = (code: string | number) => {
      if (capture.kind === 'key') {
        // one key, one job: a key taken from another action is cleared there (and said so)
        const { keys, displaced } = bindKey(s.keys, capture.action, capture.index, code as string);
        updateSettings({ keys });
        setBindNote(displaced.length ? `${keyLabel(code as string)} moved from ${displaced.map((a) => actionLabel(a, s.controlScheme)).join(', ')} to ${actionLabel(capture.action, s.controlScheme)}.` : null);
      } else {
        const pad = { ...s.pad, [capture.action]: [...s.pad[capture.action]] };
        pad[capture.action][capture.index] = code as number;
        updateSettings({ pad });
      }
      setCapture(null);
    };
    const onKey = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); if (e.code === 'Escape' && capture.kind === 'key' && capture.action !== 'pause') { setCapture(null); return; } done(e.code); };
    // any mouse button binds: left, right, middle and the back / forward side buttons (Mouse 4 / Mouse 5; their history
    // navigation is cancelled app-wide, lib/mouseGuard.ts). Armed a moment after opening so the activating click is not
    // taken; the rest of the captured press (click, context menu) is swallowed so it cannot reopen the capture.
    let armed = false;
    const arm = setTimeout(() => { armed = true; }, 50);
    const onMouse = (e: MouseEvent) => {
      if (capture.kind !== 'key' || !armed) return;
      const code = mouseBindCode(e.button);
      if (!code) return;
      e.preventDefault(); e.stopPropagation();
      swallowFollowUp(window);
      done(code);
    };
    // the game under the pause menu must not act on the press being bound (a side button bound to Pause closed the menu)
    if (capture.kind === 'key') setBindCapture(true);
    let raf = 0;
    const pollPad = () => {
      if (capture.kind === 'pad') {
        for (const p of navigator.getGamepads?.() ?? []) {
          if (!p) continue;
          const i = p.buttons.findIndex((b) => b.pressed);
          if (i >= 0) { done(i); return; }
        }
      }
      raf = requestAnimationFrame(pollPad);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    raf = requestAnimationFrame(pollPad);
    return () => { clearTimeout(arm); setBindCapture(false); window.removeEventListener('keydown', onKey, true); window.removeEventListener('mousedown', onMouse, true); cancelAnimationFrame(raf); };
  }, [capture, s.keys, s.pad, s.controlScheme]);

  const vol = (k: keyof Settings['volumes'], label: string) => (
    <label className="set-row">
      <span>{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={s.volumes[k]} onChange={(e) => updateSettings({ volumes: { ...s.volumes, [k]: Number(e.target.value) } })} aria-valuetext={`${Math.round(s.volumes[k] * 100)} percent`} />
    </label>
  );

  const bindRow = (a: (typeof ACTIONS)[number]) => (
    <tr key={a.id}>
      <td>{actionLabel(a.id, s.controlScheme)}</td>
      <td><span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>{[0, 1].map((i) => (
        <button key={i} className="btn small" onClick={() => setCapture({ action: a.id, kind: 'key', index: i })} aria-label={`${actionLabel(a.id, s.controlScheme)} binding ${i + 1}: ${s.keys[a.id][i] ? keyLabel(s.keys[a.id][i]) : 'unbound'}. Activate to rebind.`}>
          {s.keys[a.id][i] ? keyLabel(s.keys[a.id][i]) : '—'}
        </button>
      ))}</span></td>
      <td><button className="btn small" onClick={() => setCapture({ action: a.id, kind: 'pad', index: 0 })} aria-label={`${actionLabel(a.id, s.controlScheme)} gamepad: ${s.pad[a.id][0] !== undefined ? padGlyph(s.pad[a.id][0], pad.family) : 'unbound'}. Activate to rebind.`}>{s.pad[a.id][0] !== undefined ? padGlyph(s.pad[a.id][0], pad.family) : '—'}</button></td>
    </tr>
  );
  const bindTable = (rows: (typeof ACTIONS)[number][]) => (
    <table className="data">
      <thead><tr><th>Action</th><th>Keys / mouse</th><th>Pad</th></tr></thead>
      <tbody>{rows.map(bindRow)}</tbody>
    </table>
  );
  // the play camera always stays centred on your hero, so the lock toggle and centre keys are not offered
  const binds = ACTIONS.filter((a) => a.id !== 'cameraLock' && a.id !== 'cameraCenter');
  const half = Math.ceil(binds.length / 2);

  const panels: Record<TabId, ReactNode> = {
    graphics: (
      <>
        <div className="set-row">
          <span id={`${uid}-gfx`}>Graphics quality<span className="hint-text">
            {s.graphicsAuto ? `Auto picked ${GFX_LABELS[s.graphics].label} for this device and steps down between fights if frames run slow. ` : ''}
            {GFX_LABELS[s.graphics].blurb}{compact ? ' Changing it redraws the view.' : ''}
          </span></span>
          <Seg labelId={`${uid}-gfx`} className="gfx-seg" value={s.graphicsAuto ? 'auto' : s.graphics}
            options={[{ id: 'auto' as const, label: 'Auto', title: 'Pick a tier from this device\'s hardware' }, ...GFX_TIERS.map((t) => ({ id: t, label: GFX_LABELS[t].label, title: GFX_LABELS[t].blurb }))]}
            onPick={(t) => { setGraphics(t); setSlow(null); }} />
        </div>
        {slow && !s.graphicsAuto && s.graphics !== 'low' && <p role="status" className="chip warn" style={{ alignSelf: 'flex-start', margin: '8px 0' }}>Frames ran slow on {GFX_LABELS[slow].label} last time. Try {GFX_LABELS[stepDown(slow)].label} or Auto.</p>}
        <p className="set-note">Attack shapes, telegraphs, projectiles, outlines and damage numbers look the same on every tier.</p>
        <Toggle k="hitStop" label="Hit stop" hint="A few frames' pause on heavy hits." />
        <Toggle k="chromatic" label="Chromatic distortion" />
      </>
    ),
    gameplay: (
      <>
        <Toggle k="damageNumbers" label="Floating damage numbers" />
        <Toggle k="autoAttack" label="Auto attack" hint="Attacks and aims at the nearest enemy automatically." />
        <Toggle k="aimAssist" label="Aim assist" hint="Snaps aim to the nearest enemy within 8 units." />
        <label className="set-row">
          <span>Basic attack input{s.controlScheme === 'click' && <span className="hint-text">Applies to the Keyboard (WASD) scheme.</span>}</span>
          <select value={s.attackMode} onChange={(e) => updateSettings({ attackMode: e.target.value as 'hold' | 'toggle' })}>
            <option value="hold">Hold</option><option value="toggle">Toggle</option>
          </select>
        </label>
        {!compact && <Toggle k="devOverlay" label="Developer AI overlay (Shift+F3)" hint="Shows enemy utility scores, paths, targets and attack phases." />}
      </>
    ),
    controls: (
      <>
        <div className="set-row">
          <span id={`${uid}-scheme`}>Movement<span className="hint-text">{s.controlScheme === 'click'
            ? 'Click the ground to walk, click a foe to attack it, hold Shift to attack in place. Arrow keys still step.'
            : 'Move with WASD and aim with the mouse.'} Switching re-lays the keyboard; your own remaps stay.</span></span>
          <Seg labelId={`${uid}-scheme`} value={s.controlScheme} options={CONTROL_SCHEMES} onPick={(c) => { setBindNote(null); setControlScheme(c); }} />
        </div>
        {s.controlScheme === 'click' && !s.keys.attack.some((k) => k.startsWith('Mouse')) && <p role="alert" className="chip warn" style={{ alignSelf: 'flex-start', margin: '8px 0' }}>Move / attack has no mouse button, so clicks will not walk. Bind Left click to it.</p>}
        {bindNote && !capture && <p role="status" className="chip" style={{ alignSelf: 'flex-start', margin: '8px 0' }}>{bindNote}</p>}
        {capture && <p role="status" className="chip warn" style={{ alignSelf: 'flex-start', margin: '8px 0' }}>Press a {capture.kind === 'key' ? 'key or mouse button' : 'gamepad button'} for “{actionLabel(capture.action, s.controlScheme)}”…</p>}
        <div className="set-row">
          <span>Controller<span className="hint-text">{pad.connected ? `${pad.name || 'Controller'} · ${pad.family === 'playstation' ? 'PlayStation' : pad.family === 'xbox' ? 'Xbox' : 'standard'} layout. The D-pad or left stick moves through menus, ${padGlyph(0, pad.family)} selects, ${padGlyph(1, pad.family)} goes back, ${padGlyph(4, pad.family)} / ${padGlyph(5, pad.family)} switch tabs.` : 'None connected. Plug in or pair an Xbox, PlayStation or other standard controller and press a button.'}</span></span>
          <span className={`chip ${pad.connected ? 'good' : ''}`}>{pad.connected ? 'Connected' : 'Not found'}</span>
        </div>
        <Toggle k="rumble" label="Controller rumble" hint="Vibrates on hits you take, going down and boss slams (controllers that support it)." />
        <div className="bind-grid">{bindTable(binds.slice(0, half))}{bindTable(binds.slice(half))}</div>
        <button className="btn small ghost" style={{ alignSelf: 'flex-start', marginTop: 12 }} onClick={() => { setBindNote(null); updateSettings({ keys: SCHEME_KEYS[s.controlScheme], pad: DEFAULT_SETTINGS.pad }); }}>Reset controls</button>
      </>
    ),
    audio: <>{vol('master', 'Master')}{vol('music', 'Music')}{vol('combat', 'Combat')}{vol('ui', 'Interface')}{vol('ambience', 'Ambience')}</>,
    access: (
      <>
        <div className="set-row">
          <span id={`${uid}-text`}>Interface text size<span className="hint-text">Whole-step sizes keep the pixel fonts crisp.</span></span>
          <Seg labelId={`${uid}-text`} value={textSizeTier(s.fontScale)} options={TEXT_SIZES.map((t) => ({ id: textSizeTier(t.scale), label: t.label }))} onPick={(tier) => updateSettings({ fontScale: TEXT_SIZES.find((t) => textSizeTier(t.scale) === tier)!.scale })} />
        </div>
        <label className="set-row">
          <span>Color vision palette</span>
          <select value={s.palette} onChange={(e) => updateSettings({ palette: e.target.value as PaletteId })}>
            <option value="default">Default</option><option value="deuteranopia">Deuteranopia</option><option value="protanopia">Protanopia</option><option value="tritanopia">Tritanopia</option><option value="highContrast">High contrast</option>
          </select>
        </label>
        <Toggle k="reducedMotion" label="Reduced motion" hint="Removes camera easing and UI animation." />
        <Toggle k="reducedEffects" label="Reduced effects" hint="Removes particles, impact sprites and bloom on any graphics tier. Attack shapes, timing and projectiles always remain." />
        <Toggle k="flashes" label="Flashes" hint="Photosensitivity: disable hit flashes." />
        <Toggle k="allyOutline" label="Ally outlines" />
        <Toggle k="captions" label="Captions for critical audio cues" />
      </>
    ),
  };

  return (
    <div className={`col settings-panel${compact ? ' compact' : ''}`}>
      <div role="tablist" aria-label="Settings" className="row settings-tabs" onKeyDown={onTabKey}>
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <button key={t.id} ref={(el) => { tabRefs.current[t.id] = el; }} id={`${uid}-tab-${t.id}`} type="button" role="tab" aria-selected={on} aria-controls={`${uid}-panel`}
              tabIndex={on ? 0 : -1} className={`btn small ${on ? 'teal' : 'ghost'}`} onClick={() => setTab(t.id)}>{t.label}</button>
          );
        })}
      </div>
      <section id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${tab}`} className="col settings-tabpanel" tabIndex={0}>
        {panels[tab]}
      </section>
    </div>
  );
}
