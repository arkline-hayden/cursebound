import * as Phaser from 'phaser';
import type { SfxId } from '../../audio/AudioEngine';
import { SKILL_FILE } from '../../audio/fileCues';
import { isoPoly } from '../iso';
import type { FxCtx } from './registry';

// Shared cosmetic helpers for the Vanguard, Arcanist and Hexbinder fx files. Presentation only.

const lastSfx = new Map<string, number>();
/** Throttled positional sound (avoids machine-gun repeats from high-frequency sim events). */
export function sfx(ctx: FxCtx, id: SfxId, x: number, y: number, minGapMs = 40, priority = 1) {
  const t = lastSfx.get(id) ?? -1e9;
  if (ctx.now - t < minGapMs) return;
  lastSfx.set(id, ctx.now);
  ctx.sfx(id, x, y, priority);
}

/**
 * A skill's own recorded cast (audio/fileCues SKILL_FILE) when its file exists, else the shared cue `id` (throttled per
 * file or cue). Use it for the skill's main sound; every other shared cue the same skill layers goes through
 * skillLayer, so a skill never plays both its file and the shared cues it replaces.
 */
export function skillSfx(ctx: FxCtx, skill: string, id: SfxId, x: number, y: number, minGapMs = 40, priority = 1) {
  const file = SKILL_FILE[skill];
  if (!file || !ctx.hasFile(file)) { sfx(ctx, id, x, y, minGapMs, priority); return; }
  const t = lastSfx.get(file) ?? -1e9;
  if (ctx.now - t < minGapMs) return;
  lastSfx.set(file, ctx.now);
  ctx.sfxFile(file, id, x, y, priority);
}

/** A secondary shared cue of a skill (impact, whoosh, landing): silent once the skill has its own file, which covers the whole cast. */
export function skillLayer(ctx: FxCtx, skill: string, id: SfxId, x: number, y: number, minGapMs = 40, priority = 1) {
  const file = SKILL_FILE[skill];
  if (file && ctx.hasFile(file)) return;
  sfx(ctx, id, x, y, minGapMs, priority);
}

/** A named recorded file (turret_shot, explosion…) when it exists, else the shared cue `id`; throttled per key. */
export function fileSfx(ctx: FxCtx, file: string, id: SfxId | null, x: number, y: number, minGapMs = 40, priority = 1) {
  const key = ctx.hasFile(file) || !id ? file : id;
  const t = lastSfx.get(key) ?? -1e9;
  if (ctx.now - t < minGapMs) return;
  lastSfx.set(key, ctx.now);
  ctx.sfxFile(file, id, x, y, priority);
}

/** Chest-height screen point of a world point. */
export function chest(ctx: FxCtx, x: number, y: number, lift = 14) {
  const p = ctx.P(x, y);
  return { x: p.x, y: p.y - lift };
}

/** Fading additive streak between two world points at chest height. */
export function streak(ctx: FxCtx, x0: number, y0: number, x1: number, y1: number, color: number, width: number, ms = 220) {
  if (ctx.reduced) return;
  const a = chest(ctx, x0, y0), b = chest(ctx, x1, y1);
  const g = ctx.scene.add.graphics().setDepth(4645).setBlendMode(Phaser.BlendModes.ADD);
  g.lineStyle(width, color, 0.9).lineBetween(a.x, a.y, b.x, b.y);
  g.lineStyle(Math.max(1, width / 3), 0xffffff, 1).lineBetween(a.x, a.y, b.x, b.y);
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
}

/** Parabolic arc (lobbed flask, leap) drawn as a fading trail between two world points. */
export function arcTrail(ctx: FxCtx, x0: number, y0: number, x1: number, y1: number, color: number, height: number, ms = 320) {
  if (ctx.reduced) return;
  const a = chest(ctx, x0, y0), b = chest(ctx, x1, y1);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * height });
  }
  const g = ctx.scene.add.graphics().setDepth(4645).setBlendMode(Phaser.BlendModes.ADD);
  g.lineStyle(4, color, 0.75).strokePoints(pts);
  g.lineStyle(1.5, 0xffffff, 0.9).strokePoints(pts);
  ctx.scene.tweens.add({ targets: g, alpha: 0, duration: ms, ease: 'Quad.easeIn', onComplete: () => g.destroy() });
}

/**
 * Radial burst: a thick shockwave at the true radius, a hot inner ring, a starburst and bloom, sparks, an impact flash
 * and a light; `strong` adds a trailing second wave and hit-stop for the caster (never camera shake).
 */
export function burst(ctx: FxCtx, x: number, y: number, R: number, color: number, inner: number, strong: boolean) {
  const J = ctx.juice;
  const p = ctx.P(x, y);
  J.shockwave(p.x, p.y, ctx.rx(R), color, 320);
  J.ring(p.x, p.y, ctx.rx(R * 0.6), inner, 220);
  J.starburst(p.x, p.y - 12, inner, strong ? 1.6 : 1);
  J.orb(p.x, p.y - 10, color, strong ? 1.1 : 0.7, 220);
  J.sparksAt(p.x, p.y - 12, strong ? 22 : 10, color);
  J.impact(p.x, p.y - 14, inner, strong ? 2.2 : 1.3);
  ctx.dungeon.flashLight(p.x, p.y - 10, Math.max(120, ctx.rx(R) * 2.2), color, strong ? 2.6 : 1.8, strong ? 320 : 200);
  if (strong) { J.shockwave(p.x, p.y, ctx.rx(R * 1.15), inner, 420, 70); if (ctx.mine) J.hitStop(70); }
}

/** Lightning striking down from above onto a world point. */
export function skyBolt(ctx: FxCtx, x: number, y: number, color: number, height = 220) {
  const p = ctx.P(x, y);
  if (!ctx.reduced) {
    const pts: { x: number; y: number }[] = [];
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push({ x: p.x + (i === 0 || i === n ? 0 : (Math.random() - 0.5) * 22), y: p.y - height * (1 - t) - 8 });
    }
    const g = ctx.scene.add.graphics().setDepth(4660).setBlendMode(Phaser.BlendModes.ADD);
    g.lineStyle(5, color, 0.85).strokePoints(pts);
    g.lineStyle(2, 0xffffff, 1).strokePoints(pts);
    ctx.scene.tweens.add({ targets: g, alpha: 0, duration: 180, onComplete: () => g.destroy() });
  }
  ctx.juice.impact(p.x, p.y - 10, 0xffffff, 1.4);
  ctx.juice.sparksAt(p.x, p.y - 6, 10, color);
  ctx.dungeon.flashLight(p.x, p.y - 30, 170, color, 2.4, 150);
}

/** Filled / stroked ground ellipse for a world circle. */
export function groundCircle(ctx: FxCtx, g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, fill: number | null, alpha: number, stroke?: number, lw = 2, strokeAlpha = 1) {
  const p = ctx.P(x, y);
  if (fill !== null) g.fillStyle(fill, alpha).fillEllipse(p.x, p.y, ctx.rx(r) * 2, ctx.ry(r) * 2, 36);
  if (stroke !== undefined) g.lineStyle(lw, stroke, strokeAlpha).strokeEllipse(p.x, p.y, ctx.rx(r) * 2, ctx.ry(r) * 2, 36);
}

/** World-space oriented rectangle (start, unit dir, length, width) projected to the screen. */
export function groundQuad(x: number, y: number, dx: number, dy: number, len: number, w: number) {
  const px = -dy * (w / 2), py = dx * (w / 2);
  return isoPoly([
    { x: x + px, y: y + py }, { x: x + dx * len + px, y: y + dy * len + py },
    { x: x + dx * len - px, y: y + dy * len - py }, { x: x - px, y: y - py },
  ]);
}

/** A floating spirit body (teardrop + eyes) at chest height; `t` animates the bob. */
export function ghost(ctx: FxCtx, g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, body: number, eye: number, alpha: number, t: number, facing = 1) {
  const p = ctx.P(x, y);
  const bob = Math.sin(t * 0.12) * 3;
  const cx = p.x, cy = p.y - 22 * size + bob;
  g.fillStyle(0x000000, 0.25).fillEllipse(p.x, p.y, 20 * size, 8 * size, 16);
  g.fillStyle(body, alpha * 0.35).fillEllipse(cx, cy, 30 * size, 36 * size, 20);
  g.fillStyle(body, alpha).fillEllipse(cx, cy - 2 * size, 18 * size, 22 * size, 20);
  g.fillTriangle(cx - 8 * size, cy + 4 * size, cx + 8 * size, cy + 4 * size, cx - facing * 4 * size, cy + 22 * size + Math.sin(t * 0.3) * 3);
  g.fillStyle(eye, 1).fillCircle(cx - 3.5 * size, cy - 4 * size, 1.8 * size).fillCircle(cx + 3.5 * size, cy - 4 * size, 1.8 * size);
}

/** Expanding pulse ring that repeats every `period` ticks while a hazard lives. */
export function pulseRing(ctx: FxCtx, g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, color: number, tick: number, born: number, period: number) {
  const f = ((tick - born) % period) / period;
  groundCircle(ctx, g, x, y, r * f, null, 0, color, 2, Math.max(0, 1 - f));
}
