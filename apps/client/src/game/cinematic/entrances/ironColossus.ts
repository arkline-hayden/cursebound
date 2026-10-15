import { iso } from '../../render/iso';
import { E } from '../timeline';
import { registerEntrance } from './registry';

// THE IRON COLOSSUS wakes in its casting pit: molten seams crack open round the dais and the furnace light swells, a
// black iron silhouette stands in the glow, the furnace in its chest ignites, it raises the quake hammer and brings it
// down: three molten rings roll out across the foundry.

const EMBER = 0xff8a2a, HOT = 0xffd878, WHITE = 0xffffff;

registerEntrance('ironcolossus', (k) => {
  const { tl, J, x, y, sq, pup, T, REVEAL, ROAR } = k;
  const face = 2;   // front-only sprite: it faces the camera
  // molten seams crack open round the pit; the furnace light swells
  const cracks = k.image('cine:cracks', sq.x, sq.y, -79);
  cracks?.setTint(EMBER).setAlpha(0);
  const lamp = k.light(sq.x, sq.y - 30, 280, EMBER, 0);
  tl.tween(T(0.3), T(1.3), (q, ctx) => {
    cracks?.setFrame(Math.min(7, Math.floor(q * 8))).setAlpha(Math.min(1, q * 1.6));
    if (lamp) lamp.intensity = 2.2 * q;
    if (!ctx.skipping && Math.random() < (k.reduced ? 0.06 : 0.2)) {
      const a = Math.random() * Math.PI * 2, r = 0.8 + q * 2.6;
      const g = iso.p(x + Math.cos(a) * r, y + Math.sin(a) * r);
      J.embersAt(g.x, g.y - 2, 2, EMBER);
    }
  }, E.linear, { start: (ctx) => k.sfx(ctx, 'lava_vent', 2) });
  if (pup) {
    // a black silhouette in the glow...
    pup.play('idle', face);
    tl.tween(T(0.9), REVEAL - T(0.9), (q) => { pup.alpha = q; pup.setGlow(0x140a08, 1 - q * 0.3); }, E.inQuad);
    // ...until the furnace in its chest ignites
    tl.call(REVEAL, (ctx) => {
      pup.alpha = 1;
      pup.setGlow(HOT, 0.85);
      if (ctx.skipping) return;
      J.embersAt(sq.x, sq.y - 90, k.reduced ? 8 : 30, HOT);
      J.ring(sq.x, sq.y - 90, 40, HOT, 360);
      k.flash(sq.x, sq.y - 90, 300, EMBER, 3, 700);
      k.sfx(ctx, 'colossus_vent', 3);
      k.sfx(ctx, 'boss_emerge', 4);
    });
    tl.tween(REVEAL, T(0.6), (q) => pup.setGlow(HOT, 0.85 * (1 - q)), E.outQuad, { end: () => pup.setGlow(0, 0) });
    // the hammer rises, then falls
    tl.call(REVEAL + T(0.2), (ctx) => { pup.play('windup', face, true); k.sfx(ctx, 'colossus_raise', 3); });
    tl.call(ROAR - T(0.08), () => pup.play('attack', face, true));
    tl.call(T(3.3), () => pup.play('idle', face));
  }
  // the slam: three molten rings roll out across the foundry
  [ROAR, ROAR + T(0.2), ROAR + T(0.4)].forEach((at, i) => tl.call(at, (ctx) => {
    if (!ctx.skipping) {
      J.shockwave(sq.x, sq.y, iso.rx(3 + i * 2), i ? EMBER : WHITE, 700 + i * 160);
      if (i === 0) {
        J.flash(0xfff0d0, 130);
        J.hitStop(110);
        J.dilate(0.35, 800);
        J.dust(sq.x, sq.y, k.reduced ? 10 : 30, k.dust);
        J.impact(sq.x, sq.y - 10, HOT, 3);
        k.debris(sq.x, sq.y - 40, 18, 0x6a5a50);
        k.flash(sq.x, sq.y - 40, 440, EMBER, 3.4, 800);
      }
    }
    if (i === 0) {
      k.sfx(ctx, 'colossus_hammer', 5);
      k.sfx(ctx, 'boss_roar', 4);
      k.zoom(2);
    }
  }));
});
