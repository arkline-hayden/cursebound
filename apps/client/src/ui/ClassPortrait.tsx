'use client';

import { useEffect, useRef, useState } from 'react';
import { ACTOR_IDS, ACTOR_META, buildActorSheet, type ActorId, type ActorSheet } from '@/game/art/actors';

// Animated pixel portrait drawn straight from the procedural sprite generator (no CSS imagery). Sheets are built
// lazily, one per task, so a class picker with ten heroes never blocks the main thread in one long frame.
const cache = new Map<string, { sheet: ActorSheet; canvas: HTMLCanvasElement }>();
const queue: { actor: ActorId; done: () => void }[] = [];
let pumping = false;

function build(actor: ActorId) {
  let c = cache.get(actor);
  if (!c) {
    const sheet = buildActorSheet(actor);
    const canvas = document.createElement('canvas');
    canvas.width = sheet.width; canvas.height = sheet.height;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(sheet.rgba), sheet.width, sheet.height), 0, 0);
    c = { sheet, canvas };
    cache.set(actor, c);
  }
  return c;
}

function pump() {
  if (pumping) return;
  pumping = true;
  const step = () => {
    const job = queue.shift();
    if (!job) { pumping = false; return; }
    try { build(job.actor); } catch { /* art optional */ }
    job.done();
    setTimeout(step, 0);
  };
  setTimeout(step, 0);
}

function whenBuilt(actor: ActorId, done: () => void) {
  if (cache.has(actor)) { done(); return () => undefined; }
  const job = { actor, done };
  queue.push(job);
  pump();
  return () => { const i = queue.indexOf(job); if (i >= 0) queue.splice(i, 1); };
}

/** Map any id (class id, actor id) to a drawable actor; unknown heroes fall back to the Vanguard sprite. */
export function actorFor(id: string): ActorId {
  return ((ACTOR_IDS as readonly string[]).includes(id) ? id : 'vanguard') as ActorId;
}

export function ActorPortrait({ actor, state = 'idle', dir = 's', size = 96, animate = true, flip = false }: { actor: ActorId; state?: string; dir?: string; size?: number; animate?: boolean; flip?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(() => cache.has(actor));
  useEffect(() => {
    if (cache.has(actor)) { setReady(true); return; }
    setReady(false);
    return whenBuilt(actor, () => setReady(true));
  }, [actor]);
  useEffect(() => {
    if (!ready) return;
    const entry = cache.get(actor);
    const el = ref.current;
    if (!entry || !el) return;
    const { sheet, canvas } = entry;
    const anim = sheet.anims.find((a) => a.state === state && a.dir === dir) ?? sheet.anims.find((a) => a.state === 'idle' && a.dir === dir) ?? sheet.anims[0];
    if (!anim) return;
    const g = el.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    let i = 0, t = 0, raf = 0, last = performance.now();
    const cols = Math.floor(sheet.width / sheet.frameW);
    const draw = () => {
      const f = anim.frames[i % anim.frames.length].frame;
      g.clearRect(0, 0, el.width, el.height);
      g.save();
      if (flip) { g.translate(el.width, 0); g.scale(-1, 1); }
      g.drawImage(canvas, (f % cols) * sheet.frameW, Math.floor(f / cols) * sheet.frameH, sheet.frameW, sheet.frameH, 0, 0, el.width, el.height);
      g.restore();
    };
    const loop = (now: number) => {
      t += now - last; last = now;
      const dur = anim.frames[i % anim.frames.length].duration || 120;
      if (t >= dur) { t = 0; i++; draw(); }
      raf = requestAnimationFrame(loop);
    };
    draw();
    if (animate) raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [actor, state, dir, animate, flip, ready]);
  const meta = ACTOR_META[actor] ?? { frameW: 48, frameH: 48 };
  const scale = Math.max(1, Math.round(size / meta.frameW));
  const w = meta.frameW * scale, h = meta.frameH * scale;
  return <canvas ref={ref} width={w} height={h} aria-hidden="true" style={{ imageRendering: 'pixelated', width: w, height: h, display: 'block', margin: '0 auto' }} />;
}

export function ClassPortrait({ classId, size = 96, animate = true, state = 'idle' }: { classId: string; size?: number; animate?: boolean; state?: string }) {
  return <ActorPortrait actor={actorFor(classId)} size={size} animate={animate} state={state} />;
}
