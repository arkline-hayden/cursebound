import * as Phaser from 'phaser';
import type { MapState, SimEvent, SnapEnemy, Snapshot } from '@cursebound/simulation';
import type { ActorState } from '../art/actors';
import type { SfxId } from '../audio/AudioEngine';
import type { DungeonRenderer } from './DungeonRenderer';
import type { Juice } from './Juice';
import { beginThemeBossFx, ensureThemeBossTextures, skyBolt } from './fx/themebosses';
import type { FxCtx } from './fx/registry';
import { iso } from './iso';

// Theme boss presentation that needs the scene (cosmetic only; the simulation is the authority):
//   - the Gale Wyrm aloft: the snapshot's altitude lifts the sprite, shrinks its shadow and swaps to the flight cycle
//     (enemyLook);
//   - one-shot cues for the kit events (foe_fx: dives, the gale, take-off and landing, feather strikes, the long fall,
//     tentacle bursts, the gravity well, the void beam, the brood) and their sounds;
//   - the Crater Horror's second phase: the basin goes dark except near its eye and the tentacle lanterns (ambient light
//     dimmed with eye / lantern lights on the lit tiers; a dark veil with soft holes on the unlit tier). Heroes keep their
//     own lanterns, and telegraphs and hazards are drawn unlit, so every marked danger still reads.
// No camera shake anywhere (impacts read through flashes, rings and particles).

const SKY = 0xbfe6ff;
const BOLT = 0xfff7a8;
const VOID = 0x9a6aff;
const VOID_HI = 0xc2f6ff;
const LANTERN = 0x48f0c8;

/** Eye height of the Crater Horror above its feet (screen px; its sprite's eye). */
const EYE_LIFT = 96;
/** Screen px the Gale Wyrm climbs at altitude 1. */
const WYRM_CLIMB = 78;

const scaleRgb = (c: number, k: number) => (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k);

export class ThemeBossFx {
  private lift = new Map<number, number>();
  private dark = 0;
  private darkApplied = false;
  private eyeLight: Phaser.GameObjects.Light | null = null;
  private lanterns = new Map<number, Phaser.GameObjects.Light>();
  private veil: Phaser.GameObjects.RenderTexture | null = null;
  private soft: Phaser.GameObjects.Image | null = null;
  private lastWind = 0;

  constructor(private scene: Phaser.Scene, private juice: Juice, private dungeon: DungeonRenderer, private ctx: () => FxCtx, private sfx: (id: SfxId, x?: number, y?: number, priority?: number) => void) {
    ensureThemeBossTextures(scene);
    scene.events.once('shutdown', () => this.destroy());
    scene.events.once('destroy', () => this.destroy());
  }

  /** Start of frame (before hazards draw). */
  begin(map: MapState | null) {
    beginThemeBossFx(this.scene, map, this.dark);
  }

  /** Presentation override for a foe this frame: sprite lift (px), shadow scale and an animation state, or null. */
  enemyLook(e: SnapEnemy, delta: number): { lift: number; shadow: number; state?: ActorState } | null {
    if (e.k !== 'skydrake') return null;
    const want = (e.alt ?? 0) * WYRM_CLIMB;
    const cur = this.lift.get(e.i) ?? want;
    const lift = cur + (want - cur) * Math.min(1, delta / 70);
    this.lift.set(e.i, lift);
    const aloft = (e.alt ?? 0) >= 0.5;
    let state: ActorState | undefined;
    if (e.st !== 'dying' && e.st !== 'stagger' && !e.stag) {
      if (aloft) state = e.st === 'recovery' ? 'attack' : 'run';   // circling: the flight cycle; the stoop: the strike
      else if (e.atk === 'dive' && e.st === 'attack') state = 'attack';
    }
    // wind streaks off the wings while it flies
    if (aloft && !this.juice.reduced && this.scene.time.now - this.lastWind > 90) {
      this.lastWind = this.scene.time.now;
      const p = iso.p(e.x, e.y);
      this.juice.bits('feather', p.x + (Math.random() - 0.5) * 60, p.y - lift - 30, 1, 0xe8f6ff, { angle: 90, spread: 30, speed: 0.8 });
    }
    return { lift, shadow: Math.max(0.35, 1 - (lift / WYRM_CLIMB) * 0.6), state };
  }

  /** Kit cues. Reads every event (never consumes one). */
  onEvent(e: SimEvent, me: number, snap: Snapshot | null) {
    const J = this.juice;
    if (e.t === 'boss_phase') {
      const b = snap?.enemies.find((x) => x.i === e.id);
      if (b?.k === 'moonhorror' && e.phase >= 1) { this.sfx('horror_moan', b.x, b.y, 5); this.banner('The light dies...', 'danger'); }
      if (b?.k === 'skydrake' && e.phase >= 1) { this.sfx('drake_screech', b.x, b.y, 5); this.banner('It takes to the storm!', 'danger'); }
      return;
    }
    if (e.t === 'enemy_attack' && e.stage === 'release') {
      if (e.attack === 'talon' || e.attack === 'lash') { const b = snap?.enemies.find((x) => x.i === e.id); if (b) this.sfx('swing', b.x, b.y, 2); }
      return;
    }
    if (e.t !== 'foe_fx') return;
    const q = iso.p(e.x, e.y);
    const r = e.r ?? 1.5;
    switch (e.fx) {
      case 'drake_takeoff':
        this.sfx('drake_screech', e.x, e.y, 4);
        J.ring(q.x, q.y, iso.rx(3), SKY, 420); J.dust(q.x, q.y, 14, 0x8a8a94);
        J.bits('feather', q.x, q.y - 30, 10, 0xe8f6ff, { angle: -90, spread: 70, speed: 2 });
        break;
      case 'drake_dive':
        this.sfx('drake_dive', e.x, e.y, 3);
        if (e.tx !== undefined && e.ty !== undefined) { const t = iso.p(e.tx, e.ty); J.bitsAlong('feather', q.x, q.y - 30, t.x, t.y - 30, 8, 0xe8f6ff); }
        break;
      case 'drake_gale':
        this.sfx('drake_gale', e.x, e.y, 3);
        if (e.tx !== undefined && e.ty !== undefined) { const t = iso.p(e.tx, e.ty); J.bitsAlong('leaf', q.x, q.y - 20, t.x, t.y - 10, 10, 0xd8f2ff); }
        break;
      case 'drake_land':
        this.sfx('signature_slam', e.x, e.y, 4); this.sfx('drake_screech', e.x, e.y, 3);
        J.shockwave(q.x, q.y, iso.rx(r), SKY, 420); J.ring(q.x, q.y, iso.rx(r * 0.6), 0xffffff, 300);
        J.dust(q.x, q.y, 22, 0x8a8a94); J.impact(q.x, q.y - 20, SKY, 2.4); J.hitStop(70);
        this.dungeon.flashLight(q.x, q.y - 30, 260, SKY, 2.4, 400);
        break;
      case 'feather_strike':
        skyBolt(this.ctx(), e.x, e.y, BOLT);
        this.sfx('thunder_feather', e.x, e.y, 2);
        break;
      case 'void_fall': {
        // blown off the island: the hero tumbles into the sky, then the wind sets them back on the rock (teleport fx)
        this.sfx('skyfall', e.x, e.y, 5);
        J.bits('feather', q.x, q.y - 12, 12, 0xe8f6ff, { angle: 90, spread: 50, speed: 3 });
        const mine = snap?.players.some((p) => p.s === me && Math.hypot(p.x - (e.tx ?? p.x), p.y - (e.ty ?? p.y)) < 0.5);
        if (e.tx !== undefined && e.ty !== undefined) { const t = iso.p(e.tx, e.ty); J.number(t.x, t.y - 44, 'BLOWN OFF!', '#bfe6ff', mine ? 'md' : 'sm'); }
        break;
      }
      case 'tentacle_burst':
        this.sfx('tentacle_burst', e.x, e.y, 2);
        J.dust(q.x, q.y, 10, 0x5a5862); J.ring(q.x, q.y, iso.rx(r), 0x8e4a86, 260);
        J.bits('bubble', q.x, q.y - 10, 4, 0xa03aa0);
        break;
      case 'gravwell':
        this.sfx('gravity_well', e.x, e.y, 3);
        J.shockwave(q.x, q.y, iso.rx(r), VOID, 500);
        this.dungeon.flashLight(q.x, q.y - 10, 200, VOID, 2, 500);
        break;
      case 'voidbeam':
        this.sfx('void_beam', e.x, e.y, 4);
        this.dungeon.flashLight(q.x, q.y - EYE_LIFT, 300, VOID_HI, 2.8, 2200);
        break;
      case 'lowgrav':
        this.sfx('gravity_well', e.x, e.y, 1);
        break;
      case 'brood_emerge':
        this.sfx('tentacle_burst', e.x, e.y, 1);
        J.dust(q.x, q.y, 8, 0x5a5862); J.bits('bubble', q.x, q.y - 6, 3, 0x8e4a86);
        break;
    }
  }

  /** End of frame: the Crater Horror's darkness and its lights (call after the cutscene director set the lights). */
  update(snap: Snapshot, delta: number) {
    const horror = snap.enemies.find((e) => e.k === 'moonhorror' && e.boss && e.st !== 'dying');
    const want = horror && (snap.enc?.bossPhase ?? horror.ph) >= 1 ? 1 : 0;
    this.dark += (want - this.dark) * Math.min(1, delta / (want ? 900 : 500));
    if (this.dark < 0.01 && !want) this.dark = 0;
    const lanternSpots = snap.hazards.filter((h) => h.k === 'tentacle' && snap.tick >= (h.in || h.b));
    if (this.dungeon.lighting && this.scene.lights) {
      const lm = this.scene.lights;
      if (this.dark > 0) {
        lm.setAmbientColor(scaleRgb(this.dungeon.theme.ambient, 1 - 0.8 * this.dark));
        this.darkApplied = true;
        if (horror) {
          const p = iso.p(horror.x, horror.y);
          if (!this.eyeLight) this.eyeLight = lm.addLight(p.x, p.y - EYE_LIFT, 320, VOID_HI, 0);
          this.eyeLight.x = p.x; this.eyeLight.y = p.y - EYE_LIFT;
          this.eyeLight.intensity = (2.2 + Math.sin(this.scene.time.now / 300) * 0.2) * this.dark;
        }
        const seen = new Set<number>();
        for (const h of lanternSpots) {
          seen.add(h.i);
          let l = this.lanterns.get(h.i);
          const p = iso.p(h.x, h.y);
          if (!l) { l = lm.addLight(p.x, p.y - 50, 130, LANTERN, 0); this.lanterns.set(h.i, l); }
          l.intensity = 1.8 * this.dark * (0.9 + Math.random() * 0.1);
        }
        for (const [id, l] of this.lanterns) if (!seen.has(id)) { lm.removeLight(l); this.lanterns.delete(id); }
      } else if (this.darkApplied) {
        lm.setAmbientColor(this.dungeon.theme.ambient);
        this.darkApplied = false;
        this.clearLights();
      }
      return;
    }
    // unlit tier: a dark veil over the floor with soft holes at the eye, the lanterns and the heroes
    if (this.dark <= 0) { this.veil?.setVisible(false); return; }
    const cam = this.scene.cameras.main;
    const W = cam.width + 64, H = cam.height + 64;
    if (!this.veil) {
      this.veil = this.scene.add.renderTexture(0, 0, W, H).setOrigin(0, 0).setDepth(4300);
      this.soft = this.scene.textures.exists('light:soft') ? this.scene.make.image({ key: 'light:soft', add: false }) : null;
    }
    const v = this.veil.setVisible(true).setPosition(cam.worldView.x - 32, cam.worldView.y - 32).setAlpha(0.62 * this.dark);
    v.clear().fill(0x05030a, 1);
    const hole = (wx: number, wy: number, lift: number, px: number) => {
      if (!this.soft) return;
      const p = iso.p(wx, wy);
      this.soft.setScale(px / 256);   // light:soft is 256 px across
      v.erase(this.soft, p.x - v.x, p.y - lift - v.y);
    };
    if (horror) hole(horror.x, horror.y, EYE_LIFT * 0.6, 260);
    for (const h of lanternSpots) hole(h.x, h.y, 30, 120);
    for (const p of snap.players) if (p.life !== 'dead') hole(p.x, p.y, 14, 150);
  }

  private banner(text: string, tone: 'danger' | 'good' | 'info') {
    window.dispatchEvent(new CustomEvent('cursebound:banner', { detail: { text, tone } }));
  }

  private clearLights() {
    const lm = this.scene.lights;
    if (this.eyeLight) { lm?.removeLight(this.eyeLight); this.eyeLight = null; }
    for (const l of this.lanterns.values()) lm?.removeLight(l);
    this.lanterns.clear();
  }

  destroy() {
    this.clearLights();
    this.veil?.destroy(); this.veil = null;
    this.soft?.destroy(); this.soft = null;
  }
}
