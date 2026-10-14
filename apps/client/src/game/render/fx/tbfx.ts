import * as Phaser from 'phaser';
import type { SfxId } from '../../audio/AudioEngine';
import type { FxCtx } from './registry';

// Shared cosmetic helpers for the Templar and Berserker fx files (presentation only, never fed back to the sim).

const lastSfx = new Map<string, number>();
/** Throttled positional sound (high-frequency sim events would otherwise machine-gun). */
export function sfx(ctx: FxCtx, id: SfxId, x: number, y: number, minGapMs = 40, priority = 1) {
  const t = lastSfx.get(id) ?? -1e9;
  if (ctx.now - t < minGapMs) return;
  lastSfx.set(id, ctx.now);
  ctx.sfx(id, x, y, priority);
}

export function chest(ctx: FxCtx, x: number, y: number, lift = 14) {
  const p = ctx.P(x, y);
  return { x: p.x, y: p.y - lift };
}

export function aimAngle(ctx: FxCtx, dx: number, dy: number) {
  const u = ctx.U(dx, dy);
  return Math.atan2(u.y, u.x);
}

/** Fading additive streak between two world points at chest height. */
export function streak(ctx: FxCtx, x0: number, y0: number, x1: number, y1: number, color: number, width: number, ms = 220, lift = 14) {
  if (ctx.reduced) return;
  const a = chest(ctx, x0, y0, lift), b = chest(ctx, x1, y1, lift);
  const g = ctx.scene.add.graphics().setDepth(4645).setBlendMode(Phaser.BlendModes.ADD);
  g.lineStyle(width, color, 0.85).lineBetween(a.x, a.y, b.x, b.y);
  g.lineStyle(Math.max(1, width / 3), 0xffffff, 1).lineBetween(a.x, a.y, b.x, b.y);
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
}

/** Parabolic trail between two world points (leaps). */
export function arcTrail(ctx: FxCtx, x0: number, y0: number, x1: number, y1: number, color: number, height: number, ms = 420) {
  if (ctx.reduced) return;
  const a = chest(ctx, x0, y0), b = chest(ctx, x1, y1);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * height });
  }
  const g = ctx.scene.add.graphics().setDepth(4645).setBlendMode(Phaser.BlendModes.ADD);
  g.lineStyle(6, color, 0.55).strokePoints(pts);
  g.lineStyle(2, 0xffffff, 0.85).strokePoints(pts);
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, ease: 'Quad.easeIn', onComplete: () => g.destroy() });
}

/** Radial burst: ground rings, sparks, flash and light. `strong` shakes (and hit-stops for the caster). */
export function burst(ctx: FxCtx, x: number, y: number, R: number, color: number, inner: number, strong: boolean, sparks = 14) {
  const J = ctx.juice;
  const p = ctx.P(x, y);
  J.ring(p.x, p.y, ctx.rx(R), color, 340);
  J.ring(p.x, p.y, ctx.rx(R * 0.6), inner, 230);
  J.sparksAt(p.x, p.y - 12, strong ? sparks + 8 : sparks, color);
  J.impact(p.x, p.y - 14, inner, strong ? 2.2 : 1.3);
  ctx.dungeon.flashLight(p.x, p.y - 10, Math.max(120, ctx.rx(R) * 2.2), color, strong ? 2.6 : 1.8, strong ? 320 : 200);
  if (strong) { J.shake(0.012, 220); if (ctx.mine) J.hitStop(70); }
}

/** A column of light crashing down onto a world point. */
export function pillar(ctx: FxCtx, x: number, y: number, color: number, width: number, height = 240, ms = 380) {
  const p = ctx.P(x, y);
  ctx.dungeon.flashLight(p.x, p.y - 40, Math.max(160, width * 4), color, 2.8, ms);
  if (ctx.reduced) return;
  const g = ctx.scene.add.graphics().setDepth(4662).setBlendMode(Phaser.BlendModes.ADD);
  for (let i = 0; i < 4; i++) {
    const w = width * (1 - i * 0.22);
    g.fillStyle(i === 3 ? 0xffffff : color, 0.18 + i * 0.12).fillRect(p.x - w / 2, p.y - height, w, height);
  }
  g.fillStyle(0xffffff, 0.8).fillEllipse(p.x, p.y, width * 1.6, width * 0.6, 24);
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, ease: 'Cubic.easeIn', onComplete: () => g.destroy() });
}

export function groundCircle(ctx: FxCtx, g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, fill: number | null, alpha: number, stroke?: number, lw = 2, strokeAlpha = 1) {
  const p = ctx.P(x, y);
  if (fill !== null) g.fillStyle(fill, alpha).fillEllipse(p.x, p.y, ctx.rx(r) * 2, ctx.ry(r) * 2, 36);
  if (stroke !== undefined) g.lineStyle(lw, stroke, strokeAlpha).strokeEllipse(p.x, p.y, ctx.rx(r) * 2, ctx.ry(r) * 2, 36);
}

/** Ring of rune marks on the ground plane rotating with `phase` (radians). */
export function runeRing(ctx: FxCtx, g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, color: number, alpha: number, phase: number, n = 8) {
  g.lineStyle(2, color, alpha);
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const a2 = a + (Math.PI * 2) / n * 0.45;
    const p0 = ctx.P(x + Math.cos(a) * r, y + Math.sin(a) * r);
    const p1 = ctx.P(x + Math.cos(a2) * r * 0.86, y + Math.sin(a2) * r * 0.86);
    const p2 = ctx.P(x + Math.cos(a2) * r, y + Math.sin(a2) * r);
    g.lineBetween(p0.x, p0.y, p1.x, p1.y).lineBetween(p1.x, p1.y, p2.x, p2.y);
  }
}

/** Jagged radial cracks, stable per `seed` (hazard id). */
export function cracks(ctx: FxCtx, g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, seed: number, color: number, alpha: number, n = 7, lw = 2) {
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  g.lineStyle(lw, color, alpha);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 + rnd() * 0.6;
    let px = x, py = y;
    const segs = 4;
    for (let k = 1; k <= segs; k++) {
      const rr = (r * k) / segs;
      const a = a0 + (rnd() - 0.5) * 0.5;
      const nx = x + Math.cos(a) * rr, ny = y + Math.sin(a) * rr;
      const p0 = ctx.P(px, py), p1 = ctx.P(nx, ny);
      g.lineBetween(p0.x, p0.y, p1.x, p1.y);
      px = nx; py = ny;
    }
  }
}

/** Expanding pulse ring repeating every `periodMs` while a hazard lives (wall-clock driven, smooth at any snapshot rate). */
export function pulseRing(ctx: FxCtx, g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, color: number, periodMs: number, offset = 0) {
  const f = (((ctx.now + offset) % periodMs) + periodMs) % periodMs / periodMs;
  groundCircle(ctx, g, x, y, r * f, null, 0, color, 2, Math.max(0, 1 - f));
}

// ---------------- persistent per-hazard objects ----------------

type Kept = { obj: Phaser.GameObjects.Components.Visible & Phaser.GameObjects.GameObject; seen: number };
const kept = new Map<string, Kept>();
const scaled = new Map<Phaser.GameObjects.Sprite, number>();
const hooked = new WeakSet<Phaser.Scene>();

const firstSeen = new Map<string, { at: number; seen: number }>();

/** Milliseconds since a hazard (key) was first drawn: smooth wall-clock animation independent of the snapshot rate. */
export function age(ctx: FxCtx, key: string): number {
  hook(ctx.scene);
  const now = performance.now();
  let v = firstSeen.get(key);
  if (!v) { v = { at: now, seen: now }; firstSeen.set(key, v); }
  v.seen = now;
  return now - v.at;
}

function sweep() {
  const now = performance.now();
  for (const [k, v] of firstSeen) if (now - v.seen > 500) firstSeen.delete(k);
  for (const [k, v] of kept) if (now - v.seen > 160) { v.obj.destroy(); kept.delete(k); }
  for (const [s, sc] of scaled) {
    if (!s.active) { scaled.delete(s); continue; }
    // the hero scene resets scale every frame; if nobody did, undo our enlargement once the effect is gone
    if (now - (s.getData('tbScaledAt') as number ?? 0) > 160) { if (Math.abs(s.scaleX - sc) < 1e-6) s.setScale(1); scaled.delete(s); }
  }
}

function hook(scene: Phaser.Scene) {
  if (hooked.has(scene)) return;
  hooked.add(scene);
  scene.events.on('postupdate', sweep);
  scene.events.once('shutdown', () => { for (const v of kept.values()) v.obj.destroy(); kept.clear(); scaled.clear(); hooked.delete(scene); scene.events.off('postupdate', sweep); });
}

/** A game object that lives while its hazard keeps being drawn (destroyed ~160ms after the hazard disappears). */
export function keep<T extends Phaser.GameObjects.Components.Visible & Phaser.GameObjects.GameObject>(ctx: FxCtx, key: string, make: () => T): T {
  hook(ctx.scene);
  let v = kept.get(key);
  if (!v || !v.obj.active) { v = { obj: make(), seen: 0 }; kept.set(key, v); }
  v.seen = performance.now();
  return v.obj as T;
}

/** The hero sprite of a player slot, when the combat scene exposes it (falls back to null). */
export function heroSprite(ctx: FxCtx, slot: number): Phaser.GameObjects.Sprite | null {
  const s = ctx.actorSprite?.(slot);
  return s && s.active ? s : null;
}

/** Enlarge a hero sprite for this frame (the scene re-applies its own scale each frame before hazards draw). */
export function enlargeHero(ctx: FxCtx, s: Phaser.GameObjects.Sprite, k: number) {
  hook(ctx.scene);
  const last = scaled.get(s);
  if (last !== undefined && Math.abs(s.scaleX - last) < 1e-6) { s.setData('tbScaledAt', performance.now()); return; }   // not reset: don't compound
  s.setScale(s.scaleX * k, s.scaleY * k);
  scaled.set(s, s.scaleX);
  s.setData('tbScaledAt', performance.now());
}
