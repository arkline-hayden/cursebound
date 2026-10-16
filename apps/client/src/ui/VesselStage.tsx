'use client';

import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from 'react';
import { LINEUP, PARTY, arcPositions, fitStage, lineupBaseline, lineupNeeds, type SlotPos, type StageFit } from '@/game/vessel/layout';
import type { VesselRenderer } from '@/game/vessel/renderer';
import { gfx, particleBudget } from '@/game/gfx';
import { settingsStore } from '@/lib/settings';
import { useStore } from '@/lib/store';
import { runLoop, useReducedMotion } from './motion';

// The Vessel Select stage: the software-rendered lineup (game/vessel) in a canvas scaled by whole device pixels, with
// a DOM layer over it for the hero hit areas (a radio each, so keyboard, controller focus and screen readers work)
// and the readable labels (lock chips, party name plates). The renderer module loads on demand (client only), builds
// its art in short slices, renders at the graphics tier's frame cap and pauses while the tab is hidden.

export interface StageSlotView {
  key: string;
  classId: string;
  locked: boolean;
  /** an open party seat */
  empty?: boolean;
  /** accessible name of the hero's radio */
  label: string;
  /** short name shown over a hovered hero */
  short?: string;
  /** chip over the head (a locked hero's "Lv 6") */
  chip?: string;
  /** name plate over the head (party) */
  name?: string;
  /** party status under the name plate */
  status?: { text: string; tone: 'good' | 'bad' | 'gold' | '' };
  /** highlight the name plate (you) */
  me?: boolean;
}

export interface VesselStageHandle {
  /** confirm flourish: the portal flares and the hero steps in; `done` fires once at the end or on skip */
  flourish(done: () => void): void;
  skip(): void;
  reset(): void;
  flourishing(): boolean;
  focusSelected(): void;
  focusSlot(i: number): void;
}

interface Props {
  variant: 'lineup' | 'party';
  slots: StageSlotView[];
  /** highlighted slot */
  selected: number;
  /** bump to play the selection flourish on `selected` */
  pulse: number;
  /** party: portal power per slot (0..1) and a counter per slot that strikes a pose when it changes */
  powers?: number[];
  poses?: number[];
  /** hero hit areas as a radio group (the lineup) */
  interactive?: boolean;
  disabled?: boolean;
  onPick?: (i: number) => void;
  /** the already-highlighted hero was clicked / activated again (confirm) */
  onActivate?: (i: number) => void;
  onHover?: (i: number | null) => void;
  /** focus the highlighted hero once the stage is laid out */
  autoFocus?: boolean;
  /** CSS px of the stage covered by overlaid UI (the lineup is centred in the band between) */
  insetTop?: number;
  insetBottom?: number;
  labelledBy?: string;
  describedBy?: string;
  stageRef?: Ref<VesselStageHandle>;
  className?: string;
}

/** `k`: local CSS px per art pixel (device zoom over the device pixel ratio and any CSS zoom on an ancestor) */
interface Geo { fit: StageFit; pos: SlotPos[]; dpr: number; base: number; cx: number; k: number }

export function VesselStage({ variant, slots, selected, pulse, powers, poses, interactive = false, disabled = false, onPick, onActivate, onHover, autoFocus = false, insetTop = 0, insetBottom = 0, labelledBy, describedBy, stageRef, className }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const rend = useRef<VesselRenderer | null>(null);
  const img = useRef<ImageData | null>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [gen, setGen] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const reduced = useReducedMotion();
  const tier = useStore(settingsStore, (s) => s.s.graphics);
  const reducedFx = useStore(settingsStore, (s) => s.s.reducedEffects);
  const spec = variant === 'party' ? PARTY : LINEUP;
  const n = slots.length;

  // measure: whole-device-pixel zoom, internal size, plinth positions
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      // the in-game UI may sit under a CSS zoom: measure in real device pixels, lay out in local CSS px
      const z = el.offsetWidth > 0 ? r.width / el.offsetWidth : 1;
      const fit = fitStage({ devW: Math.round(r.width * dpr), devH: Math.round(r.height * dpr), insetTop: insetTop * z * dpr, insetBottom: insetBottom * z * dpr, need: lineupNeeds(Math.max(n, variant === 'party' ? 3 : 1), spec) });
      const base = lineupBaseline(fit, spec), cx = Math.round(fit.w / 2);
      const k = fit.zoom / (dpr * z);
      setGeo((g) => (g && g.fit.w === fit.w && g.fit.h === fit.h && g.fit.zoom === fit.zoom && g.k === k && g.base === base && g.pos.length === n ? g : { fit, pos: arcPositions(n, cx, base, spec), dpr, base, cx, k }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [n, variant, insetTop, insetBottom, spec]);

  // the renderer: loaded on demand, warmed in slices, driven by a throttled rAF loop that pauses while hidden
  useEffect(() => {
    let alive = true, warmT: ReturnType<typeof setTimeout> | null = null, stop: (() => void) | null = null;
    void import('@/game/vessel/renderer').then(({ VesselRenderer }) => {
      if (!alive) return;
      const r = new VesselRenderer(optionsNow(reduced));
      rend.current = r;
      setGen((g) => g + 1);
      const pump = () => { if (!alive) return; const more = r.warm(); if (more) warmT = setTimeout(pump, 12); };
      warmT = setTimeout(pump, 0);
      stop = runLoop((dt) => {
        const c = canvas.current, im = img.current;
        if (!c || !im || im.width !== r.w || im.height !== r.h) return;
        r.step(dt);
        r.render();
        c.getContext('2d')?.putImageData(im, 0, 0);
      }, gfx().fps);
    }).catch(() => undefined);
    return () => { alive = false; if (warmT) clearTimeout(warmT); stop?.(); rend.current = null; img.current = null; };
  }, [tier]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { rend.current?.setOptions(optionsNow(reduced)); }, [reduced, reducedFx, tier, gen]);

  // place the slots whenever the size or the roster changes
  const slotKey = slots.map((s) => `${s.classId}:${s.locked ? 1 : 0}:${s.empty ? 1 : 0}`).join('|');
  useEffect(() => {
    const r = rend.current, c = canvas.current;
    if (!r || !c || !geo) return;
    r.layout(geo.fit.w, geo.fit.h, geo.cx, geo.base, spec.arc, geo.pos, slots.map((s) => ({ classId: s.classId, locked: s.locked, empty: s.empty })));
    if (c.width !== r.w || c.height !== r.h) { c.width = r.w; c.height = r.h; }
    if (!img.current || img.current.data !== r.pixels) img.current = new ImageData(r.pixels, r.w, r.h);
  }, [geo, slotKey, gen]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastPulse = useRef(pulse);
  useEffect(() => {
    const r = rend.current;
    if (!r) return;
    const p = pulse !== lastPulse.current;
    lastPulse.current = pulse;
    r.select(selected, p);
  }, [selected, pulse, gen, slotKey]);

  useEffect(() => { rend.current?.hover(hover); }, [hover, gen]);

  const lastPoses = useRef<number[]>([]);
  useEffect(() => {
    const r = rend.current;
    if (!r) return;
    slots.forEach((_, i) => {
      const pose = poses?.[i] ?? 0;
      const fire = lastPoses.current[i] !== undefined && pose !== lastPoses.current[i];
      r.emphasis(i, powers?.[i] ?? 0, fire);
    });
    lastPoses.current = slots.map((_, i) => poses?.[i] ?? 0);
  }, [powers?.join(','), poses?.join(','), gen, slotKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(stageRef, () => ({
    flourish: (done) => { const r = rend.current; if (r) r.flourish(selected, done); else done(); },
    skip: () => rend.current?.skipFlourish(),
    reset: () => rend.current?.resetFlourish(),
    flourishing: () => !!rend.current?.flourishing,
    focusSelected: () => radios.current[selected]?.focus({ preventScroll: true }),
    focusSlot: (i) => radios.current[i]?.focus({ preventScroll: true }),
  }), [selected]);

  const focused = useRef(false);
  useEffect(() => {
    if (!autoFocus || focused.current || !geo) return;
    focused.current = true;
    radios.current[selected]?.focus({ preventScroll: true });
  }, [geo, autoFocus, selected]);
  const downSel = useRef(false);

  const k = geo ? geo.k : 1;
  const canvasStyle: CSSProperties = geo ? { width: geo.fit.w * k, height: geo.fit.h * k } : { width: '100%', height: '100%' };
  const pick = (i: number) => { if (!disabled) onPick?.(i); };
  const enter = (i: number | null) => { setHover(i); onHover?.(i); };

  return (
    <div ref={wrap} className={`vstage ${variant}${className ? ` ${className}` : ''}`}>
      <canvas ref={canvas} className="vstage-canvas" style={canvasStyle} aria-hidden="true" />
      {geo && (
        <div className="vstage-layer" style={{ '--slot-w': `${Math.round(spec.spacing * k) - 8}px` } as CSSProperties} role={interactive ? 'radiogroup' : undefined} aria-labelledby={interactive ? labelledBy : undefined} aria-describedby={interactive ? describedBy : undefined}
          onMouseLeave={() => enter(null)}>
          {slots.map((s, i) => {
            const p = geo.pos[i];
            if (!p) return null;
            const head = p.y - (s.empty ? 18 : 50) + (i === selected ? 5 : 0);
            const labelStyle: CSSProperties = { left: p.x * k, top: head * k };
            return (
              <div key={s.key}>
                {interactive && !s.empty && (
                  <button ref={(el) => { radios.current[i] = el; }} type="button" role="radio" className="vstage-hit" aria-checked={i === selected} aria-label={s.label}
                    aria-disabled={disabled || undefined} tabIndex={i === selected ? 0 : -1} data-pad-default={i === selected ? '' : undefined}
                    style={{ left: (p.x - 15) * k, top: (p.y - 46) * k, width: 30 * k, height: 62 * k }}
                    onPointerDown={() => { downSel.current = i === selected; }}
                    onClick={(e) => { const again = i === selected && (e.detail === 0 || downSel.current); downSel.current = false; pick(i); if (again && !disabled) onActivate?.(i); }}
                    onFocus={() => pick(i)} onMouseEnter={() => enter(i)} />
                )}
                {s.chip && <span className={`vstage-chip${i === selected ? ' on' : ''}`} style={labelStyle} aria-hidden="true">{s.chip}</span>}
                {s.name && (
                  <span className={`vstage-plate${s.me ? ' me' : ''}${s.empty ? ' empty' : ''}`} style={labelStyle} aria-hidden="true">
                    <b>{s.name}</b>
                    {s.status && <span className={`vstage-status ${s.status.tone}`}>{s.status.text}</span>}
                  </span>
                )}
                {interactive && hover === i && i !== selected && !s.chip && s.short && <span className="vstage-hover" style={labelStyle} aria-hidden="true">{s.short}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function optionsNow(reduced: boolean) {
  const g = gfx();
  const p = particleBudget();
  return { particles: reduced ? Math.min(p, 0.25) : p, reducedMotion: reduced, animatedDecor: g.animatedDecor, decor: g.decorDensity };
}

/** Build the stage art ahead of time in idle slices (call when the title menu settles). Returns a canceller. */
export function prewarmVesselStage(classIds: readonly string[]): () => void {
  let alive = true;
  let t: ReturnType<typeof setTimeout> | null = null;
  const idle = (fn: () => void) => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 1500 }); else t = setTimeout(fn, 60);
  };
  void Promise.all([import('@/game/vessel/chamber'), import('@/game/vessel/sprites'), import('@/game/vessel/palette')]).then(([ch, sp, pal]) => {
    const jobs: (() => void)[] = [() => { ch.chamberArt(); }, ...classIds.filter(pal.isVesselClass).map((c) => () => { sp.heroArt(c); })];
    const next = () => { if (!alive) return; const j = jobs.shift(); if (!j) return; try { j(); } catch { /* art optional */ } idle(next); };
    idle(next);
  }).catch(() => undefined);
  return () => { alive = false; if (t) clearTimeout(t); };
}
