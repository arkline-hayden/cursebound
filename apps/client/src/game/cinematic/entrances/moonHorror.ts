import * as Phaser from 'phaser';
import { iso } from '../../render/iso';
import { E } from '../timeline';
import { registerEntrance } from './registry';

// THE CRATER HORROR heaves up out of its pit: the crater glows violet and the regolith trembles, rings of light well up
// from the rim, the Horror rises from the crater, and at the cry its great eye snaps open in a pulse of void light.
// Acts on the boss's real sprite (the puppet). The camera never shakes.

registerEntrance('moonhorror', (a) => {
  const { tl, J, pup, x, y, sq, T, REVEAL, ROAR, glow, dust } = a;
  const pit = a.light(sq.x, sq.y - 10, 240, glow, 0);
  tl.tween(T(0.3), T(1.5), (q, ctx) => {
    if (pit) pit.intensity = 2.4 * q;
    if (!ctx.skipping && !a.reduced && Math.random() < 0.2) {
      const ang = Math.random() * Math.PI * 2, r = 1 + q * 2.4;
      const g = iso.p(x + Math.cos(ang) * r, y + Math.sin(ang) * r);
      J.dust(g.x, g.y, 2, dust);
      J.bits('mote', g.x, g.y - 4, 1, 0xc2f6ff, { angle: -90, spread: 30, speed: 0.6 });
    }
  }, E.linear, { start: (ctx) => a.sfx(ctx, 'gravity_well', 3) });
  // glowing rings welling up out of the pit
  const rings = a.graphics(-58).setBlendMode(Phaser.BlendModes.ADD);
  tl.tween(T(0.5), REVEAL - T(0.5), (q) => {
    rings.clear();
    for (let k = 0; k < 3; k++) {
      const p = (q * 2 + k / 3) % 1;
      rings.lineStyle(2, glow, 0.7 * (1 - p)).strokeEllipse(sq.x, sq.y, iso.rx(0.6 + p * 3) * 2, iso.ry(0.6 + p * 3) * 2);
    }
  }, E.linear, { end: () => rings.clear() });
  if (pup) {
    // the Horror heaves up out of the crater: it grows upward from its feet, wreathed in void light
    pup.play('idle', 2);
    tl.tween(REVEAL - T(0.6), T(0.9), (q) => {
      pup.alpha = Math.min(1, q * 2.5);
      pup.sprite.setScale(1, Math.max(0.05, q));
      pup.setGlow(glow, Math.max(0, 1 - q * 1.2));
    }, E.outBack, {
      start: (ctx) => {
        a.sfx(ctx, 'tentacle_burst', 3);
        a.sfx(ctx, 'boss_emerge', 4);
        if (ctx.skipping) return;
        J.dust(sq.x, sq.y, 26, dust);
        a.debris(sq.x, sq.y - 30, 14, 0x6c6a72);
      },
      end: () => { pup.sprite.setScale(1, 1); pup.setGlow(0, 0); },
    });
    tl.call(ROAR - T(0.3), () => pup.play('windup', 2, true));
    tl.call(ROAR + T(0.15), () => pup.play('attack', 2, true));
    tl.call(T(3.2), () => pup.play('idle', 2));
  }
  // the eye opens: a pulse of void light, the moon's dust lifting, slow motion
  tl.call(ROAR, (ctx) => {
    if (!ctx.skipping) {
      J.shockwave(sq.x, sq.y - 40, iso.rx(5), glow, 900);
      J.ring(sq.x, sq.y - 90, iso.rx(2.2), 0xc2f6ff, 600);
      J.flash(0xc0a8ff, 140);
      J.hitStop(80);
      J.dilate(0.4, 800);
      a.flash(sq.x, sq.y - 90, 440, 0xc2f6ff, 3.4, 900);
    }
    a.sfx(ctx, 'horror_moan', 5);
    a.sfx(ctx, 'boss_roar', 4);
    if (a.motion) a.zoom(2);
  });
}, 70);   // camera lift
