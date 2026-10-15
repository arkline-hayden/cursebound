import type { BitKind } from '../Juice';
import type { FxCtx } from './registry';

// Layered spectacle composites shared by every class kit (presentation only). Each builds on the pooled Juice
// primitives (shockwave, starburst, orb, glyph, beam, slash, claw, bits, pop) so particle counts follow the graphics
// tier and reduced effects strip the cosmetic layers while area-carrying rings stay. No camera shake anywhere: weight
// comes from hit-stop, light, colour and particles. Coordinates are world units unless a name says screen.

/** A class or branch palette: `main` body colour, `hot` near-white core, optional `deep` shadow tone and bit kind. */
export interface Pal { main: number; hot: number; deep?: number; bits?: BitKind }

/** Chest-height screen point of a world point. */
export function chestAt(ctx: FxCtx, x: number, y: number, lift = 14) {
  const p = ctx.P(x, y);
  return { x: p.x, y: p.y - lift };
}

/** Screen-space angle (radians) of a world direction. */
export function screenAngle(ctx: FxCtx, dx: number, dy: number) {
  const u = ctx.U(dx, dy);
  return Math.atan2(u.y, u.x);
}

/**
 * Anticipation / cast flash at the caster: a bloom at the hands, a glyph or ring at the feet, a few rising bits and a
 * light. `size` scales everything (1 = a basic cast, 2+ = signatures).
 */
export function castFlash(ctx: FxCtx, x: number, y: number, pal: Pal, size = 1, opts: { glyph?: boolean; dx?: number; dy?: number } = {}) {
  const J = ctx.juice;
  const p = ctx.P(x, y);
  let hx = p.x, hy = p.y - 16;
  if (opts.dx !== undefined && opts.dy !== undefined) { const u = ctx.U(opts.dx, opts.dy); hx += u.x * 10; hy += u.y * 6; }
  J.orb(hx, hy, pal.main, 0.45 * size, 160 + 40 * size, 1.8);
  J.orb(hx, hy, pal.hot, 0.22 * size, 110, 1.4);
  if (opts.glyph) J.glyph(p.x, p.y, 18 + 10 * size, pal.main, 420 + 120 * size);
  else J.ring(p.x, p.y, 12 + 8 * size, pal.main, 220);
  if (pal.bits) J.bits(pal.bits, hx, hy, 3 + 3 * size, pal.main);
  ctx.dungeon.flashLight(hx, hy, 80 + 40 * size, pal.main, 1 + 0.4 * size, 140 + 40 * size);
}

/**
 * Layered impact for an area hit of world radius R: a thick shockwave at the true radius (readable area), a hot inner
 * ring, a starburst, sparks plus themed bits, dust and a light. power 1 light / 2 heavy / 3 signature (adds a colour
 * pop and a short hit-stop for the caster).
 */
export function impactBurst(ctx: FxCtx, x: number, y: number, R: number, pal: Pal, power: 1 | 2 | 3 = 2, opts: { dust?: number; decal?: 'scorch' | 'blood' | 'ichor' | 'slime'; decalTint?: number } = {}) {
  const J = ctx.juice;
  const p = ctx.P(x, y);
  const rpx = ctx.rx(R);
  J.shockwave(p.x, p.y, rpx, pal.main, 300 + power * 60);
  J.ring(p.x, p.y, rpx * 0.55, pal.hot, 200 + power * 30);
  if (power >= 2) J.shockwave(p.x, p.y, rpx * 1.15, pal.deep ?? pal.main, 420 + power * 60, 70);
  J.starburst(p.x, p.y - 12, pal.hot, 0.8 + power * 0.45);
  J.orb(p.x, p.y - 10, pal.main, 0.6 + power * 0.35, 200 + power * 40);
  J.sparksAt(p.x, p.y - 12, 6 + power * 6, pal.main);
  if (pal.bits) J.bits(pal.bits, p.x, p.y - 10, 4 + power * 5, pal.main);
  if (opts.dust !== 0) J.dust(p.x, p.y, opts.dust ?? 3 + power * 3, 0x4a3e36);
  if (opts.decal) ctx.dungeon.addDecal(opts.decal, p.x, p.y + 2, opts.decalTint ?? (pal.deep ?? 0x1a1010), Math.max(0.6, R * 0.6));
  ctx.dungeon.flashLight(p.x, p.y - 10, Math.max(110, rpx * 2.2), pal.main, 1.6 + power * 0.45, 180 + power * 80);
  if (power >= 3) { J.pop(pal.main, 0.16, 180); if (ctx.mine) J.hitStop(60); }
}

/** A single-target hit spark: starburst + orb + sparks/bits, sized by `power` (crits and finishers go 2-3). */
export function hitSpark(ctx: FxCtx, x: number, y: number, pal: Pal, power = 1) {
  const J = ctx.juice;
  const c = chestAt(ctx, x, y);
  J.starburst(c.x, c.y, pal.hot, 0.6 + power * 0.35, 140);
  J.orb(c.x, c.y, pal.main, 0.35 + power * 0.2, 150);
  J.sparksAt(c.x, c.y, 3 + power * 4, pal.main);
  if (pal.bits) J.bits(pal.bits, c.x, c.y, 2 + power * 3, pal.main);
  ctx.dungeon.flashLight(c.x, c.y, 70 + power * 30, pal.main, 1 + power * 0.4, 120);
}

/**
 * Electric link between two world points: a coloured bolt, a white core bolt, zap bits along the path and a spark at
 * the far end. Used for chains (extra chains from upgrades simply call it more times).
 */
export function zapLink(ctx: FxCtx, x0: number, y0: number, x1: number, y1: number, color: number, core = 0xffffff) {
  ctx.bolt(x0, y0, x1, y1, color);
  if (!ctx.reduced) ctx.bolt(x0, y0, x1, y1, core);
  const a = chestAt(ctx, x0, y0), b = chestAt(ctx, x1, y1);
  ctx.juice.bitsAlong('zap', a.x, a.y, b.x, b.y, 4, color);
  ctx.juice.starburst(b.x, b.y, core, 0.7, 120);
  ctx.juice.sparksAt(b.x, b.y, 5, color);
  ctx.dungeon.flashLight(b.x, b.y, 110, color, 1.8, 120);
}

/** Bits strewn along a world segment at chest height (dash paths, thrown arcs, wind lines). */
export function trailBits(ctx: FxCtx, x0: number, y0: number, x1: number, y1: number, kind: BitKind, n: number, color: number, lift = 14) {
  const a = chestAt(ctx, x0, y0, lift), b = chestAt(ctx, x1, y1, lift);
  ctx.juice.bitsAlong(kind, a.x, a.y, b.x, b.y, n, color);
}

/** A strike from the sky onto a world point: a light beam, a starburst and a shockwave at the true radius R. */
export function skyStrike(ctx: FxCtx, x: number, y: number, R: number, pal: Pal, height = 200) {
  const J = ctx.juice;
  const p = ctx.P(x, y);
  J.beam(p.x, p.y, height, 14 + R * 6, pal.main, 300);
  J.beam(p.x, p.y, height, 5 + R * 2, pal.hot, 220);
  J.starburst(p.x, p.y - 8, pal.hot, 1 + R * 0.3);
  J.shockwave(p.x, p.y, ctx.rx(R), pal.main, 320);
  if (pal.bits) J.bits(pal.bits, p.x, p.y - 8, 6, pal.main);
  ctx.dungeon.flashLight(p.x, p.y - 30, 160 + R * 30, pal.main, 2.4, 200);
}

/** Afterimages trailing a hero sprite along a world direction (dashes, blinks, lunges). */
export function heroGhosts(ctx: FxCtx, slot: number, dx: number, dy: number, tint: number, n = 4, gap = 9) {
  const s = ctx.actorSprite?.(slot);
  if (!s || !s.active) return;
  const u = ctx.U(dx, dy);
  ctx.juice.ghosts(s, n, u.x, u.y, tint, gap);
}

/**
 * How upgraded a skill looks: 1 + 0.25 per owned node among `nodes` (rank-weighted), capped at `max`. Use it to
 * scale counts and sizes of the cosmetic layers only; true hit shapes come from the sim event.
 */
export function upgradeScale(ctx: FxCtx, slot: number, nodes: readonly string[], max = 2) {
  let k = 1;
  for (const n of nodes) k += 0.25 * ctx.rank(slot, n);
  return Math.min(max, k);
}

/** Kill flourish helper: a small burst of class bits and a starburst at a fallen foe, bigger for elites and bosses. */
export function killPop(ctx: FxCtx, x: number, y: number, pal: Pal, big: boolean, elite = 0) {
  const J = ctx.juice;
  const c = chestAt(ctx, x, y, 12);
  const k = big ? 2 : 1;
  J.starburst(c.x, c.y, pal.hot, 0.7 + 0.3 * k + elite * 0.3, 160);
  if (pal.bits) J.bits(pal.bits, c.x, c.y, 4 * k + elite * 4, pal.main);
  J.embersAt(c.x, c.y, 2 * k, pal.main);
}
