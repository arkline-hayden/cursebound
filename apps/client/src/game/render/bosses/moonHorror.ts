import type * as Phaser from 'phaser';
import { iso } from '../iso';
import { registerBossKit, type BossFxHost } from './registry';
import { beginThemeBossFx, ensureThemeBossTextures } from './skyMoonFx';

// THE CRATER HORROR (simulation bosses/moonHorror.ts): one-shot cues for its tentacle bursts, the gravity well, the void
// beam, low gravity and the brood; its second phase swallows the light: the basin goes dark except near its eye and the
// tentacle lanterns (ambient light dimmed with eye / lantern lights on the lit tiers; a dark veil with soft holes on
// the unlit tier). Heroes keep their own lanterns, and telegraphs and hazards are drawn unlit, so every marked danger
// still reads. This kit also runs the per-frame begin of the sky / moon hazard layer (skyMoonFx.ts), shared with the
// Gale Wyrm. No camera shake.

const VOID = 0x9a6aff;
const VOID_HI = 0xc2f6ff;
const LANTERN = 0x48f0c8;
/** Eye height of the Crater Horror above its feet (screen px; its sprite's eye). */
const EYE_LIFT = 96;

const scaleRgb = (c: number, k: number) => (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k);

/** Per-scene state: the darkness 0..1 and the lights / veil it owns. */
let scene: Phaser.Scene | null = null;
let dark = 0;
let darkApplied = false;
let eyeLight: Phaser.GameObjects.Light | null = null;
const lanterns = new Map<number, Phaser.GameObjects.Light>();
let veil: Phaser.GameObjects.RenderTexture | null = null;
let soft: Phaser.GameObjects.Image | null = null;

function clearLights(host: BossFxHost) {
  const lm = host.scene.lights;
  if (eyeLight) { lm?.removeLight(eyeLight); eyeLight = null; }
  for (const l of lanterns.values()) lm?.removeLight(l);
  lanterns.clear();
}

function reset(host: BossFxHost) {
  clearLights(host);
  veil?.destroy(); veil = null;
  soft?.destroy(); soft = null;
  dark = 0; darkApplied = false;
}

registerBossKit('moonhorror', {
  begin(host, map) {
    if (scene !== host.scene) {
      // a new combat scene: its textures once, no state carried over
      eyeLight = null; lanterns.clear(); veil = null; soft = null; dark = 0; darkApplied = false;
      scene = host.scene;
      ensureThemeBossTextures(host.scene);
    }
    beginThemeBossFx(host.scene, map, dark);
  },

  onEvent(host, _layer, e, snap) {
    const J = host.juice;
    if (e.t === 'boss_phase') {
      const b = snap?.enemies.find((x) => x.i === e.id);
      if (b && e.phase >= 1) { host.sfx('horror_moan', b.x, b.y, 5); host.banner('The light dies...', 'danger'); }
      return false;
    }
    if (e.t === 'enemy_attack' && e.stage === 'release') {
      if (e.attack === 'lash') { const b = snap?.enemies.find((x) => x.i === e.id); if (b) host.sfx('swing', b.x, b.y, 2); }
      return false;
    }
    if (e.t !== 'foe_fx') return false;
    const q = iso.p(e.x, e.y);
    const r = e.r ?? 1.5;
    switch (e.fx) {
      case 'tentacle_burst':
        host.sfx('tentacle_burst', e.x, e.y, 2);
        J.dust(q.x, q.y, 10, 0x5a5862); J.ring(q.x, q.y, iso.rx(r), 0x8e4a86, 260);
        J.bits('bubble', q.x, q.y - 10, 4, 0xa03aa0);
        break;
      case 'gravwell':
        host.sfx('gravity_well', e.x, e.y, 3);
        J.shockwave(q.x, q.y, iso.rx(r), VOID, 500);
        host.dungeon.flashLight(q.x, q.y - 10, 200, VOID, 2, 500);
        break;
      case 'voidbeam':
        host.sfx('void_beam', e.x, e.y, 4);
        host.dungeon.flashLight(q.x, q.y - EYE_LIFT, 300, VOID_HI, 2.8, 2200);
        break;
      case 'lowgrav':
        host.sfx('gravity_well', e.x, e.y, 1);
        break;
      case 'brood_emerge':
        host.sfx('tentacle_burst', e.x, e.y, 1);
        J.dust(q.x, q.y, 8, 0x5a5862); J.bits('bubble', q.x, q.y - 6, 3, 0x8e4a86);
        break;
    }
    return false;   // cues only: the scene's generic handling still runs
  },

  /** The darkness and its lights (after the cutscene director set the lights). */
  frame(host, snap, delta) {
    const horror = snap.enemies.find((e) => e.k === 'moonhorror' && e.boss && e.st !== 'dying');
    const want = horror && (snap.enc?.bossPhase ?? horror.ph) >= 1 ? 1 : 0;
    dark += (want - dark) * Math.min(1, delta / (want ? 900 : 500));
    if (dark < 0.01 && !want) dark = 0;
    const lanternSpots = snap.hazards.filter((h) => h.k === 'tentacle' && snap.tick >= (h.in || h.b));
    const dungeon = host.dungeon;
    if (dungeon.lighting && host.scene.lights) {
      const lm = host.scene.lights;
      if (dark > 0) {
        lm.setAmbientColor(scaleRgb(dungeon.theme.ambient, 1 - 0.8 * dark));
        darkApplied = true;
        if (horror) {
          const p = iso.p(horror.x, horror.y);
          if (!eyeLight) eyeLight = lm.addLight(p.x, p.y - EYE_LIFT, 320, VOID_HI, 0);
          eyeLight.x = p.x; eyeLight.y = p.y - EYE_LIFT;
          eyeLight.intensity = (2.2 + Math.sin(host.scene.time.now / 300) * 0.2) * dark;
        }
        const seen = new Set<number>();
        for (const h of lanternSpots) {
          seen.add(h.i);
          let l = lanterns.get(h.i);
          const p = iso.p(h.x, h.y);
          if (!l) { l = lm.addLight(p.x, p.y - 50, 130, LANTERN, 0); lanterns.set(h.i, l); }
          l.intensity = 1.8 * dark * (0.9 + Math.random() * 0.1);
        }
        for (const [id, l] of lanterns) if (!seen.has(id)) { lm.removeLight(l); lanterns.delete(id); }
      } else if (darkApplied) {
        lm.setAmbientColor(dungeon.theme.ambient);
        darkApplied = false;
        clearLights(host);
      }
      return;
    }
    // unlit tier: a dark veil over the floor with soft holes at the eye, the lanterns and the heroes
    if (dark <= 0) { veil?.setVisible(false); return; }
    const cam = host.scene.cameras.main;
    const W = cam.width + 64, H = cam.height + 64;
    if (!veil) {
      veil = host.scene.add.renderTexture(0, 0, W, H).setOrigin(0, 0).setDepth(4300);
      soft = host.scene.textures.exists('light:soft') ? host.scene.make.image({ key: 'light:soft', add: false }) : null;
    }
    const v = veil.setVisible(true).setPosition(cam.worldView.x - 32, cam.worldView.y - 32).setAlpha(0.62 * dark);
    v.clear().fill(0x05030a, 1);
    const hole = (wx: number, wy: number, lift: number, px: number) => {
      if (!soft) return;
      const p = iso.p(wx, wy);
      soft.setScale(px / 256);   // light:soft is 256 px across
      v.erase(soft, p.x - v.x, p.y - lift - v.y);
    };
    if (horror) hole(horror.x, horror.y, EYE_LIFT * 0.6, 260);
    for (const h of lanternSpots) hole(h.x, h.y, 30, 120);
    for (const p of snap.players) if (p.life !== 'dead') hole(p.x, p.y, 14, 150);
  },

  destroy(host) { reset(host); scene = null; },
});
