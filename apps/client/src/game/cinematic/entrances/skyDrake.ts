import * as Phaser from 'phaser';
import { iso } from '../../render/iso';
import { dirOf } from '../puppet';
import { E } from '../timeline';
import { registerEntrance } from './registry';

// THE GALE WYRM drops out of the storm: a vast shadow sweeps over the ring, the Wyrm glides down in a long stoop onto
// its dais, lands in a gust that flattens the dust, rears and screeches while lightning forks around it. Acts on the
// boss's real sprite (the puppet). The camera never shakes; slow motion, flashes and rings carry the impact.

registerEntrance('skydrake', (a) => {
  const { tl, J, pup, x, y, sq, T, REVEAL, ROAR, glow, dust } = a;
  const lamp = a.light(sq.x, sq.y - 40, 280, glow, 0);
  tl.tween(T(0.3), T(1.2), (q) => { if (lamp) lamp.intensity = 2.2 * q; }, E.inQuad, { start: (ctx) => a.sfx(ctx, 'drake_gale', 3) });
  // feathers and leaves racing across the ring on the rising wind
  tl.tween(T(0.2), T(1.8), (_q, ctx) => {
    if (ctx.skipping || a.reduced || Math.random() > 0.35) return;
    const g = iso.p(x + (Math.random() - 0.5) * 9, y + (Math.random() - 0.5) * 9);
    J.bits(Math.random() < 0.5 ? 'feather' : 'leaf', g.x, g.y - 20, 1, 0xe8f6ff, { angle: 200, spread: 20, speed: 3 });
  }, E.linear);
  // the shadow of something vast passes over the ring
  const shade = a.graphics(-59);
  tl.tween(T(0.5), T(1.1), (q) => {
    shade.clear();
    if (q >= 1) return;
    const sx = sq.x + 240 - q * 480, sy = sq.y - 30 + q * 50;
    shade.fillStyle(0x000000, 0.35 * Math.sin(q * Math.PI)).fillEllipse(sx, sy, 150, 46);
  }, E.inOutSine, { start: (ctx) => a.sfx(ctx, 'drake_dive', 3) });
  if (pup) {
    // the stoop: a long glide down out of the sky onto the dais, flapping, then the landing gust
    const from = { x: x + 7, y: y - 7 };
    tl.tween(REVEAL - T(0.7), T(0.7), (q) => {
      pup.alpha = Math.min(1, q * 3);
      pup.x = from.x + (x - from.x) * q; pup.y = from.y + (y - from.y) * q;
      pup.lift = 240 * (1 - q) * (1 - q);
    }, E.outQuad, {
      start: (ctx) => { pup.play('run', dirOf(x - from.x, y - from.y)); a.sfx(ctx, 'cine_whoosh', 2); },
      end: (ctx) => {
        pup.lift = 0; pup.x = x; pup.y = y;
        pup.play('idle', dirOf(a.fx, a.fy));
        if (ctx.skipping) return;
        J.shockwave(sq.x, sq.y, iso.rx(4.5), glow, 600);
        J.ring(sq.x, sq.y, iso.rx(2.6), 0xffffff, 380);
        J.dust(sq.x, sq.y, 30, dust);
        J.bits('feather', sq.x, sq.y - 30, 16, 0xe8f6ff, { angle: -90, spread: 120, speed: 3 });
        J.hitStop(90);
        a.sfx(ctx, 'boss_emerge', 4);
      },
    });
    tl.call(ROAR - T(0.35), () => pup.play('windup', dirOf(a.fx, a.fy), true));
    tl.call(T(3.2), () => pup.play('idle', dirOf(a.fx, a.fy)));
  }
  // the screech: forked lightning all round, a white flash, slow motion
  tl.call(ROAR, (ctx) => {
    if (!ctx.skipping) {
      for (let k = 0; k < (a.reduced ? 2 : 5); k++) {
        const ang = (k / 5) * Math.PI * 2 + 0.4;
        const g = iso.p(x + Math.cos(ang) * 3.2, y + Math.sin(ang) * 3.2);
        const gfx = a.graphics(4650).setBlendMode(Phaser.BlendModes.ADD);
        let cx = g.x, cy = g.y - 170;
        gfx.lineStyle(5, 0xfff7a8, 0.6);
        for (let s = 0; s < 6; s++) { const nx = g.x + (s % 2 ? 8 : -8) * (1 - s / 6), ny = cy + 28; gfx.lineBetween(cx, cy, nx, ny); cx = nx; cy = ny; }
        gfx.scene.tweens.add({ targets: gfx, alpha: 0, duration: Math.round(T(0.4) * 1000), ease: 'Quad.easeOut' });
        J.sparksAt(g.x, g.y - 6, 8, 0xfff7a8);
      }
      J.ring(sq.x, sq.y, iso.rx(5), glow, 900);
      J.flash(0xe8f6ff, 140);
      J.dilate(0.4, 700);
      a.flash(sq.x, sq.y - 60, 420, glow, 3.4, 800);
    }
    a.sfx(ctx, 'drake_screech', 5);
    a.sfx(ctx, 'boss_roar', 4);
    if (a.motion) a.zoom(2);
  });
}, 60);   // camera lift
