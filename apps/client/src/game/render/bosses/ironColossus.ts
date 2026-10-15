import type * as Phaser from 'phaser';
import { slagLava } from '@cursebound/content';
import type { SimEvent, SnapEnemy, Snapshot } from '@cursebound/simulation';
import { registerHazardFx, type FxCtx, type SnapHazard } from '../fx/registry';
import { iso } from '../iso';
import { floorAt, registerBossKit, type BossFxHost, type BossLayer } from './registry';

// THE IRON COLOSSUS (simulation bosses/ironColossus.ts): molten quake rings (each with a dark gap to step through),
// slag cells that glow before they erupt into lava, the furnace heat around it while it is overheated, and the hammer,
// stomp and vent cues. Slag cells use the content slagLava rule, so what is drawn is exactly what burns.

const EMBER = 0xff8a2a, HOT = 0xffd878, LAVA = 0xd8380c, WHITE = 0xffffff, STEAM = 0xd8d0c8;

function tileDiamond(tx: number, ty: number) {
  return [iso.p(tx, ty), iso.p(tx + 1, ty), iso.p(tx + 1, ty + 1), iso.p(tx, ty + 1)];
}

/** A quake ring: a molten band rolling outward, broken by its gap (bright ticks mark the gap's edges). */
function quake(_ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const age = (tick - h.b) / 60;
  if (age < 0) return;
  const r0 = h.in + h.sp * age, r1 = h.out + h.sp * age, rm = (r0 + r1) / 2;
  const c = iso.p(h.x, h.y);
  const gap = Math.atan2(h.dy, h.dx);
  const N = Math.max(24, Math.round(rm * 10));
  const thick = Math.max(3, (iso.ry(r1) - iso.ry(r0)) * 1.6);
  const pt = (a: number, r: number) => {
    const wx = h.x + Math.cos(a) * r, wy = h.y + Math.sin(a) * r;
    return iso.p(wx, wy);
  };
  let run: { x: number; y: number }[] = [];
  const flush = () => {
    if (run.length > 1) {
      g.lineStyle(thick + 2, LAVA, 0.55).strokePoints(run);
      g.lineStyle(thick, EMBER, 0.9).strokePoints(run);
      g.lineStyle(1, HOT, 1).strokePoints(run);
    }
    run = [];
  };
  for (let k = 0; k <= N; k++) {
    const a = gap + (k / N) * Math.PI * 2;
    let d = Math.abs(a - gap) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    const wx = h.x + Math.cos(a) * rm, wy = h.y + Math.sin(a) * rm;
    if (d <= h.w || !floorAt(wx, wy)) { flush(); continue; }
    run.push(pt(a, rm));
  }
  flush();
  // the gap's edges
  for (const s of [-1, 1]) {
    const a = gap + s * h.w;
    if (!floorAt(h.x + Math.cos(a) * rm, h.y + Math.sin(a) * rm)) continue;
    const p0 = pt(a, r0), p1 = pt(a, r1);
    g.lineStyle(2, WHITE, 1).lineBetween(p0.x, p0.y - 1, p1.x, p1.y - 1);
  }
  void c;
}

/** Slag: cells glow (pulsing faster as eruption nears), then burn as lava, then cool and fade. */
function slag(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard, tick: number) {
  const arm = h.b + h.len;
  const pre = tick < arm;
  const cx = Math.floor(h.x), cy = Math.floor(h.y);
  const R = Math.ceil(h.r);
  const toArm = Math.max(0, arm - tick);
  const pulse = 0.5 + 0.5 * Math.sin(ctx.now / (pre ? 40 + toArm * 1.2 : 90));
  const fade = Math.min(1, (h.u - tick) / 40);
  for (let ty = cy - R; ty <= cy + R; ty++) for (let tx = cx - R; tx <= cx + R; tx++) {
    if (!slagLava(h.in, h.out, cx, cy, tx, ty, h.r, h.w, h.sp || 2) || !floorAt(tx + 0.5, ty + 0.5)) continue;
    const d = tileDiamond(tx, ty);
    if (pre) {
      g.fillStyle(EMBER, 0.12 + 0.2 * pulse).fillPoints(d, true);
      g.lineStyle(1, EMBER, 0.7).strokePoints(d, true);
    } else {
      const k = (tx * 5 + ty * 11 + Math.floor(tick / 8)) % 4;
      g.fillStyle(k ? LAVA : EMBER, (0.55 + 0.15 * pulse) * fade).fillPoints(d, true);
      if (k === 1) { const c = iso.p(tx + 0.5, ty + 0.5); g.fillStyle(HOT, 0.9 * fade).fillRect(Math.round(c.x - 3 + ((tx + tick) % 5)), Math.round(c.y - 1), 3, 2); }
    }
  }
}

/** Furnace heat: a shimmering ring round the overheated Colossus. */
function heat(ctx: FxCtx, g: Phaser.GameObjects.Graphics, h: SnapHazard) {
  const c = iso.p(h.x, h.y);
  const pulse = 0.5 + 0.5 * Math.sin(ctx.now / 80);
  g.fillStyle(EMBER, 0.08 + 0.08 * pulse).fillEllipse(c.x, c.y, iso.rx(h.r) * 2, iso.ry(h.r) * 2, 40);
  g.lineStyle(2, HOT, 0.6 + 0.3 * pulse).strokeEllipse(c.x, c.y, iso.rx(h.r) * 2, iso.ry(h.r) * 2, 40);
}

registerHazardFx({ ic_quake: quake, ic_slag: slag, ic_heat: (ctx, g, h) => heat(ctx, g, h) }, { ic_quake: EMBER, ic_heat: EMBER });

// ---------------- events ----------------

let overheatAt = -1e9;

function onEvent(host: BossFxHost, _layer: BossLayer, e: SimEvent, snap: Snapshot | null): boolean {
  const J = host.juice;
  const now = host.scene.time.now;
  const low = host.reduced();
  switch (e.t) {
    case 'enemy_attack': {
      const en = snap?.enemies.find((x) => x.i === e.id);
      const x = en?.x, y = en?.y;
      if (e.stage === 'windup') {
        host.sfx('boss_telegraph', x, y, 3);
        if (e.attack === 'ic_hammer') host.sfx('colossus_raise', x, y, 3);
        else if (e.attack === 'ic_slag') host.sfx('lava_vent', x, y, 3);
        else if (e.attack === 'ic_overheat') host.sfx('colossus_vent', x, y, 3);
      }
      return true;
    }
    case 'foe_fx': {
      const q = iso.p(e.x, e.y);
      switch (e.fx) {
        case 'ic_hammer':
          J.shockwave(q.x, q.y, iso.rx(e.r ?? 2.2), EMBER, 360);
          J.ring(q.x, q.y, iso.rx((e.r ?? 2.2) * 0.6), WHITE, 240);
          J.impact(q.x, q.y - 8, HOT, 2.4);
          J.dust(q.x, q.y, low ? 6 : 18, 0x5a4a40);
          J.sparksAt(q.x, q.y - 6, low ? 6 : 20, EMBER);
          J.hitStop(60);
          host.dungeon.flashLight(q.x, q.y - 20, 260, EMBER, 2.8, 380);
          host.sfx('colossus_hammer', e.x, e.y, 5);
          return true;
        case 'ic_stomp':
          J.shockwave(q.x, q.y, iso.rx(e.r ?? 3.2), 0xd8b090, 320);
          J.dust(q.x, q.y, low ? 6 : 16, 0x5a4a40);
          host.sfx('colossus_stomp', e.x, e.y, 4);
          return true;
        case 'ic_slag':
          J.embersAt(q.x, q.y - 10, low ? 8 : 26, EMBER);
          host.dungeon.flashLight(q.x, q.y, 320, LAVA, 2.2, 600);
          host.sfx('lava_erupt', e.x, e.y, 4);
          return true;
        case 'ic_overheat':
          overheatAt = now;
          J.bits('bubble', q.x, q.y - 70, low ? 4 : 14, STEAM, { angle: -90, spread: 70, speed: 1.4 });
          J.embersAt(q.x, q.y - 60, low ? 6 : 20, HOT);
          host.dungeon.flashLight(q.x, q.y - 60, 280, HOT, 2.6, 900);
          host.banner('Overheated! Hit the glowing vents', 'good');
          return true;
      }
      return false;
    }
    case 'stagger':
      // the vent already announced itself: no second "Staggered!" banner
      return now - overheatAt < 400;
  }
  return false;
}

/** The furnace's light: a steady forge glow, white-hot while it is overheated. */
function light(e: SnapEnemy) {
  const hot = e.stag || e.st === 'stagger';
  return { color: hot ? HOT : EMBER, radius: hot ? 240 : 200, intensity: hot ? 0.85 : 0.55, dy: 92 };
}

registerBossKit('ironcolossus', { onEvent, light });
