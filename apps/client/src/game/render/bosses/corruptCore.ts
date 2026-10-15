import type * as Phaser from 'phaser';
import type { SimEvent, SnapEnemy, Snapshot } from '@cursebound/simulation';
import { registerHazardFx, registerProjectileFx, type FxCtx, type SnapHazard } from '../fx/registry';
import { iso } from '../iso';
import { floorAt, registerBossKit, type BossFxHost, type BossLayer } from './registry';

// THE CORRUPTED CORE (simulation bosses/corruptCore.ts): laser lanes that fire as beams, firewalls rolling in with
// one open port, squares of corrupted tiles, the purge flood with its safe tiles and countdown ring, glitch jumps,
// data bolts, and the Mirror Split (echoes flicker with a faint glitch now and then; the real tell is the eye).

const CYAN = 0x40e8ff, MAG = 0xff40e0, RED = 0xff3a2a, WHITE = 0xffffff, SAFE = 0x5affb4, EMBER = 0xff8a2a;

/** Screen polygon of a world-space quad: start point, unit direction, length, width. */
function quad(x: number, y: number, dx: number, dy: number, len: number, w: number) {
  const px = -dy * (w / 2), py = dx * (w / 2);
  return [iso.p(x + px, y + py), iso.p(x + dx * len + px, y + dy * len + py), iso.p(x + dx * len - px, y + dy * len - py), iso.p(x - px, y - py)];
}

function tileDiamond(tx: number, ty: number) {
  return [iso.p(tx, ty), iso.p(tx + 1, ty), iso.p(tx + 1, ty + 1), iso.p(tx, ty + 1)];
}

/** The firewall: a wall of magenta data-fire on the floor runs of its line, its port marked by cyan posts. */
function firewall(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const off = Math.max(0, (tick - h.b) / 60) * h.sp;
  const mx = -h.dy, my = h.dx;
  const ox = h.x + mx * off, oy = h.y + my * off;
  const step = 0.5;
  const flick = Math.floor(ctx.now / 70);
  let run0: number | null = null;
  const flush = (s1: number) => {
    if (run0 === null) return;
    const len = s1 - run0;
    if (len > 0.1) {
      const q = quad(ox + h.dx * run0, oy + h.dy * run0, h.dx, h.dy, len, h.w);
      g.fillStyle(MAG, 0.32).fillPoints(q, true);
      g.lineStyle(2, EMBER, 0.95).strokePoints(q, true);
      // the wall itself: flame strokes rising off the line
      for (let s = run0; s < s1; s += 0.25) {
        const p = iso.p(ox + h.dx * s, oy + h.dy * s);
        const hgt = 10 + ((Math.floor(s * 4) * 7 + flick) % 5) * 3;
        g.lineStyle(2, (Math.floor(s * 4) + flick) % 3 ? MAG : EMBER, 0.85).lineBetween(p.x, p.y, p.x, p.y - hgt);
        g.lineStyle(1, WHITE, 0.6).lineBetween(p.x, p.y - 1, p.x, p.y - hgt * 0.45);
      }
    }
    run0 = null;
  };
  for (let s = 0; s <= h.len + 1e-6; s += step) {
    const inPort = s > h.in && s < h.out;
    const open = !inPort && floorAt(ox + h.dx * s, oy + h.dy * s);
    if (open && run0 === null) run0 = s;
    if (!open) flush(s);
  }
  flush(h.len);
  // port posts
  for (const s of [h.in, h.out]) {
    const p = iso.p(ox + h.dx * s, oy + h.dy * s);
    if (!floorAt(ox + h.dx * s, oy + h.dy * s)) continue;
    g.lineStyle(3, CYAN, 1).lineBetween(p.x, p.y, p.x, p.y - 22);
    g.fillStyle(WHITE, 1).fillRect(p.x - 1, p.y - 24, 3, 3);
  }
}

/** Corrupted tiles: a square of floor tiles flickering magenta / cyan, blinking as it runs out. */
function corrupt(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const left = h.u - tick;
  if (left < 50 && Math.floor(ctx.now / 90) % 2) return;
  const x0 = Math.floor(h.x - h.r), x1 = Math.floor(h.x + h.r - 0.01), y0 = Math.floor(h.y - h.r), y1 = Math.floor(h.y + h.r - 0.01);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!floorAt(tx + 0.5, ty + 0.5)) continue;
    const k = (tx * 7 + ty * 13 + Math.floor(tick / 6)) % 5;
    g.fillStyle(k < 2 ? MAG : k < 4 ? 0x7a1070 : CYAN, k === 4 ? 0.3 : 0.38).fillPoints(tileDiamond(tx, ty), true);
    // stray "dead pixels"
    const c = iso.p(tx + 0.5, ty + 0.5);
    if ((k + tx) % 2) g.fillStyle(k % 2 ? CYAN : WHITE, 0.85).fillRect(Math.round(c.x + ((tx * 5 + tick) % 9) - 4), Math.round(c.y + ((ty * 3 + tick) % 5) - 2), 2, 1);
  }
  const outline = [iso.p(x0, y0), iso.p(x1 + 1, y0), iso.p(x1 + 1, y1 + 1), iso.p(x0, y1 + 1)];
  g.lineStyle(2, MAG, 0.9).strokePoints(outline, true);
}

/** A purge safe tile: a bright pad with a pulsing ring (it must read from across the vault). */
function safeTile(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard) {
  const c = iso.p(h.x, h.y);
  const pulse = 0.5 + 0.5 * Math.sin(ctx.now / 110);
  g.fillStyle(SAFE, 0.28 + 0.12 * pulse).fillEllipse(c.x, c.y, iso.rx(h.r) * 2, iso.ry(h.r) * 2, 40);
  g.lineStyle(3, WHITE, 1).strokeEllipse(c.x, c.y, iso.rx(h.r) * 2, iso.ry(h.r) * 2, 40);
  g.lineStyle(2, SAFE, 0.9).strokeEllipse(c.x, c.y, iso.rx(h.r * (0.55 + 0.35 * pulse)) * 2, iso.ry(h.r * (0.55 + 0.35 * pulse)) * 2, 32);
  // a light pillar marks it from afar
  g.fillStyle(SAFE, 0.16).fillRect(c.x - 5, c.y - 70, 10, 70);
  g.fillStyle(WHITE, 0.35).fillRect(c.x - 1, c.y - 70, 2, 70);
}

/** The purge flood: the vault floor pulses red while a white ring closes in on zero. */
function purge(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const fire = h.u - 24;
  const total = Math.max(1, fire - h.b);
  const left = Math.max(0, Math.min(1, (fire - tick) / total));
  const c = iso.p(h.x, h.y);
  const pulse = 0.5 + 0.5 * Math.sin(ctx.now / (60 + 120 * left));
  g.fillStyle(RED, 0.1 + 0.12 * pulse).fillEllipse(c.x, c.y, iso.rx(h.r) * 2, iso.ry(h.r) * 2, 64);
  for (let k = 1; k <= 3; k++) g.lineStyle(1, RED, 0.25).strokeEllipse(c.x, c.y, iso.rx(h.r * k / 4) * 2, iso.ry(h.r * k / 4) * 2, 48);
  g.lineStyle(3, RED, 0.95).strokeEllipse(c.x, c.y, iso.rx(h.r) * 2, iso.ry(h.r) * 2, 64);
  if (left > 0) g.lineStyle(3, WHITE, 0.95).strokeEllipse(c.x, c.y, iso.rx(h.r * left) * 2, iso.ry(h.r * left) * 2, 64);
}

registerHazardFx({ cc_firewall: firewall, cc_corrupt: corrupt, cc_safe: (ctx, g, h) => safeTile(ctx, g, h), cc_purge: purge }, { cc_firewall: MAG, cc_corrupt: MAG, cc_safe: SAFE, cc_purge: RED });

registerProjectileFx({
  cc_bolt: { key: 'fx:spark', color: CYAN, tint: 0xa8f8ff, additive: true, scale: 0.9, trail: 'zap', trailMs: 70 },
});

// ---------------- events ----------------

let splitHintAt = -1e9;
const SFX: Record<string, string> = {
  cc_lasergrid: 'core_charge', cc_firewall: 'core_charge', cc_deploy: 'core_deploy', cc_glitch: 'core_glitch', cc_purge: 'core_purge_alarm', cc_split: 'core_glitch',
};

function onEvent(host: BossFxHost, layer: BossLayer, e: SimEvent, snap: Snapshot | null): boolean {
  const J = host.juice;
  const now = host.scene.time.now;
  const low = host.reduced();
  switch (e.t) {
    case 'enemy_attack': {
      const en = snap?.enemies.find((x) => x.i === e.id);
      const x = en?.x, y = en?.y;
      if (e.stage === 'windup') {
        host.sfx('boss_telegraph', x, y, 3);
        if (SFX[e.attack]) host.sfx(SFX[e.attack]!, x, y, 3);
        if (e.attack === 'cc_purge') host.banner('Purge! Stand on a safe tile', 'danger');
      } else if (e.attack === 'cc_firewall') host.sfx('core_firewall', x, y, 3);
      return true;
    }
    case 'foe_fx': {
      const q = iso.p(e.x, e.y);
      switch (e.fx) {
        case 'cc_laser': {
          layer.beam({ x0: e.x, y0: e.y, x1: e.tx ?? e.x, y1: e.ty ?? e.y, w: e.r ?? 1.6, color: MAG, core: WHITE, until: now + 280 });
          const t = iso.p(e.tx ?? e.x, e.ty ?? e.y);
          if (!low) J.bitsAlong('zap', q.x, q.y - 4, t.x, t.y - 4, 4, 0xffa8f0);
          if ((e.x * 7 + e.y * 3) % 4 < 1) host.dungeon.flashLight((q.x + t.x) / 2, (q.y + t.y) / 2, 160, MAG, 1.6, 220);
          host.sfx('core_laser', e.x, e.y, 2);
          return true;
        }
        case 'cc_glitch': {
          const t = iso.p(e.tx ?? e.x, e.ty ?? e.y);
          J.ring(q.x, q.y, iso.rx(1.4), MAG, 260);
          J.bits('zap', q.x, q.y - 30, low ? 3 : 10, CYAN);
          J.beam(t.x, t.y, 90, 18, CYAN, 260);
          J.ring(t.x, t.y, iso.rx(1.9), CYAN, 320);
          J.bits('zap', t.x, t.y - 30, low ? 3 : 12, 0xffa8f0);
          host.dungeon.flashLight(t.x, t.y - 30, 200, CYAN, 2, 260);
          host.sfx('core_glitch', e.tx ?? e.x, e.ty ?? e.y, 3);
          return true;
        }
        case 'cc_split': {
          const t = iso.p(e.tx ?? e.x, e.ty ?? e.y);
          J.beam(t.x, t.y, 110, 22, MAG, 360);
          J.ring(t.x, t.y, iso.rx(2), MAG, 420);
          if (now - splitHintAt > 1500) {
            splitHintAt = now;
            host.banner('Find the eye that follows you!', 'danger');
            host.sfx('core_glitch', e.x, e.y, 4);
          }
          return true;
        }
        case 'cc_merge': J.ring(q.x, q.y - 30, iso.rx(2.5), CYAN, 420); J.bits('zap', q.x, q.y - 40, low ? 4 : 14, CYAN); host.sfx('core_glitch', e.x, e.y, 2); return true;
        case 'cc_dissolve': J.bits('zap', q.x, q.y - 40, low ? 4 : 16, 0xffa8f0); J.ring(q.x, q.y, iso.rx(1.6), MAG, 300); return true;
        case 'cc_echo_pop': {
          J.ring(q.x, q.y, iso.rx(2.2), MAG, 380); J.ring(q.x, q.y - 40, 40, WHITE, 240);
          J.bits('zap', q.x, q.y - 40, low ? 6 : 22, MAG);
          host.dungeon.flashLight(q.x, q.y - 40, 240, MAG, 2.4, 320);
          host.sfx('core_glitch', e.x, e.y, 4);
          return true;
        }
        case 'cc_deploy': J.ring(q.x, q.y, iso.rx(1), CYAN, 300); J.sparksAt(q.x, q.y - 8, low ? 3 : 10, CYAN); host.sfx('core_deploy', e.x, e.y, 2); return true;
        case 'cc_bolts': host.sfx('enemy_shoot', e.x, e.y, 1); return true;
        case 'cc_purge': {
          J.shockwave(q.x, q.y, iso.rx(e.r ?? 10), RED, 520);
          J.ring(q.x, q.y, iso.rx((e.r ?? 10) * 0.6), WHITE, 380);
          J.flash(0xff4050, 140);
          host.dungeon.flashLight(q.x, q.y - 20, 420, RED, 3, 600);
          host.sfx('core_purge', e.x, e.y, 5);
          return true;
        }
      }
      return false;
    }
    case 'death': {
      if (!layer.isEcho(e.id)) return false;
      // an echo comes apart in static (no boss death flourish: the real Core still stands)
      const q = iso.p(e.x, e.y);
      J.bits('zap', q.x, q.y - 40, low ? 5 : 18, CYAN);
      J.ring(q.x, q.y, iso.rx(1.8), CYAN, 320);
      return true;
    }
  }
  return false;
}

/** Echoes: once in a while a frame slips (a two-pixel jump and a cyan / magenta cast). */
function drawEnemy(_host: BossFxHost, sprite: Phaser.GameObjects.Sprite, e: SnapEnemy, now: number) {
  if (!e.echo) return;
  const ph = (now + e.i * 577) % 1500;
  if (ph >= 110) return;
  sprite.setTint(ph < 55 ? 0x9ff8ff : 0xff9ff0);
  sprite.x += ph < 55 ? 2 : -2;
}

/** The eye's light: cyan at rest, magenta when it winds up or fires, red while staggered (echoes glow the same). */
function light(e: SnapEnemy) {
  const color = e.stag || e.st === 'stagger' ? RED : e.st === 'windup' || e.st === 'attack' ? MAG : CYAN;
  return { color, radius: 230, intensity: e.st === 'attack' ? 1.5 : 1.1, dy: 78 };
}

registerBossKit('corruptcore', { onEvent, drawEnemy, light });
// the Core's adds (drones and turrets) keep the scene's generic cues
