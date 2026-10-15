import { iso } from '../../render/iso';
import { E } from '../timeline';
import { registerEntrance } from './registry';

// THE CORRUPTED CORE boots up: scan rings sweep the vault from its platform, six data beams rise round the dais and
// pull in, the Core flickers into being frame by frame (a bad signal resolving), opens its eye on the party, and the
// glare tears through the vault as it screams.

const CYAN = 0x40e8ff, MAG = 0xff40e0, WHITE = 0xffffff;

registerEntrance('corruptcore', (k) => {
  const { tl, J, x, y, sq, pup, T, REVEAL, ROAR } = k;
  const face = k.dirOf(k.fx, k.fy);
  const lamp = k.light(sq.x, sq.y - 40, 280, CYAN, 0);
  tl.tween(T(0.3), T(1.5), (q) => { if (lamp) lamp.intensity = 2.4 * q; }, E.inQuad);
  // scan rings sweep out from the platform
  for (let i = 0; i < 4; i++) {
    tl.call(T(0.25) + i * T(0.28), (ctx) => {
      if (ctx.skipping) return;
      J.ring(sq.x, sq.y, iso.rx(2 + i * 1.8), i % 2 ? MAG : CYAN, 520);
      if (i === 0) k.sfx(ctx, 'core_charge', 3);
    });
  }
  // data beams rise round the dais and converge on it
  const n = k.reduced ? 3 : 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3;
    tl.call(T(0.7) + i * T(0.1), (ctx) => {
      if (ctx.skipping) return;
      const p = iso.p(x + Math.cos(a) * 3.4, y + Math.sin(a) * 3.4);
      J.beam(p.x, p.y, 120, 14, i % 2 ? MAG : CYAN, 520);
      J.bits('zap', p.x, p.y - 40, k.reduced ? 2 : 6, CYAN);
    });
    tl.call(T(1.45) + i * T(0.04), (ctx) => {
      if (ctx.skipping) return;
      const p = iso.p(x + Math.cos(a) * 1.4, y + Math.sin(a) * 1.4);
      J.beam(p.x, p.y, 140, 10, WHITE, 300);
    });
  }
  // the Core resolves out of static: a flickering signal that locks in at the reveal
  if (pup) {
    pup.play('idle', face);
    tl.tween(T(1.0), REVEAL - T(1.0), (q, ctx) => {
      const on = Math.floor((ctx.skipping ? 1 : q) * 18) % 3 !== 1;
      pup.alpha = on ? 0.25 + 0.6 * q : 0.08;
      pup.setGlow(q < 0.6 ? MAG : CYAN, 0.8 * (1 - q * 0.5));
    }, E.linear, { start: (ctx) => k.sfx(ctx, 'core_glitch', 3) });
    tl.call(REVEAL, (ctx) => {
      pup.alpha = 1; pup.setGlow(WHITE, 0.9);
      if (ctx.skipping) return;
      J.ring(sq.x, sq.y - 60, iso.rx(3), WHITE, 420);
      J.bits('zap', sq.x, sq.y - 60, k.reduced ? 6 : 24, CYAN);
      k.flash(sq.x, sq.y - 60, 320, CYAN, 3, 500);
      k.sfx(ctx, 'boss_emerge', 4);
    });
    tl.tween(REVEAL, T(0.5), (q) => pup.setGlow(WHITE, 0.9 * (1 - q)), E.outQuad, { end: () => pup.setGlow(0, 0) });
    // the eye opens on the party, then the glare
    tl.call(REVEAL + T(0.15), () => pup.play('windup', face, true));
    tl.call(ROAR - T(0.05), () => pup.play('attack', face, true));
    tl.call(T(3.3), () => pup.play('idle', face));
  }
  tl.call(ROAR, (ctx) => {
    if (!ctx.skipping) {
      J.shockwave(sq.x, sq.y, iso.rx(5.5), CYAN, 800);
      J.ring(sq.x, sq.y - 60, iso.rx(3.2), MAG, 600);
      J.flash(0xc8f8ff, 140);
      J.hitStop(80);
      J.dilate(0.4, 700);
      k.flash(sq.x, sq.y - 60, 440, CYAN, 3.4, 800);
    }
    k.sfx(ctx, 'boss_roar', 5);
    k.sfx(ctx, 'core_laser', 3);
    k.zoom(2);
  });
});
