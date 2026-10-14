'use client';

import { useEffect, useRef } from 'react';
import { BASE_H, BASE_W, pixelZoom, tierRenderConfig } from './GameCanvas';
import { settingsStore } from '@/lib/settings';
import { useStore } from '@/lib/store';
import { GFX_PRESETS } from './gfxProfile';

// Attract-mode backdrop for the main menu: a lit isometric dungeon rendered by the same renderer as
// combat, with the chosen hero idling by torchlight and the dead shuffling in the dark. Purely decorative.
// Graphics tier: low skips the second WebGL game entirely and shows a static dark vignette; medium draws the
// scene without bloom; lights and the frame cap follow the tier like the combat view.

export default function MenuBackdrop({ classId }: { classId: string }) {
  const tier = useStore(settingsStore, (x) => x.s.graphics);
  const knobs = GFX_PRESETS[tier] ?? GFX_PRESETS.high;
  if (!knobs.menuBackdrop) return <div className="menu-backdrop-static" aria-hidden="true" />;
  return <LiveBackdrop classId={classId} tier={tier} />;
}

function LiveBackdrop({ classId, tier }: { classId: string; tier: keyof typeof GFX_PRESETS }) {
  const ref = useRef<HTMLDivElement>(null);
  const heroRef = useRef<((c: string) => void) | null>(null);
  const classRef = useRef(classId);
  classRef.current = classId;
  useEffect(() => { heroRef.current?.(classId); }, [classId]);
  useEffect(() => {
    let game: import('phaser').Game | null = null;
    let cancelled = false;
    const knobs = GFX_PRESETS[tier];
    const lit = knobs.lighting;
    (async () => {
      const PhaserMod = await import('phaser'); const Phaser = ((PhaserMod as unknown as { default?: typeof PhaserMod }).default ?? PhaserMod) as typeof import('phaser');
      const { buildArt, ensureActor } = await import('./art/generate');
      const { animFor, ACTOR_IDS } = await import('./art/actors');
      type ActorId = import('./art/actors').ActorId;
      const { DungeonRenderer } = await import('./render/DungeonRenderer');
      const { generateMap } = await import('@cursebound/simulation');
      if (cancelled || !ref.current) return;
      const probe = document.createElement('canvas');
      if (!probe.getContext('webgl2') && !probe.getContext('webgl')) return;
      const initialClass = classRef.current;
      class MenuScene extends Phaser.Scene {
        hero!: Phaser.GameObjects.Sprite;
        create() {
          buildArt(this, { actors: ['pursuer', 'guardian', 'hexer', 'artillery', 'skirmisher'] });
          const map = generateMap('menu-' + Math.floor(Math.random() * 1e6), 1 + Math.floor(Math.random() * 7), false);
          const d = new DungeonRenderer(this, { lighting: lit });
          d.build(map);
          const P = (x: number, y: number) => ({ x: (x - y) * 32, y: (x + y) * 16 });
          // pick an open spot near the middle of the largest room
          const cx = map.w * 0.5, cy = map.h * 0.5;
          const spot = (x: number, y: number) => { let best = [x, y]; let bd = 1e9; for (let yy = 1; yy < map.h - 1; yy++) for (let xx = 1; xx < map.w - 1; xx++) { if (map.tiles[yy * map.w + xx]) continue; const dd = (xx - x) ** 2 + (yy - y) ** 2; if (dd < bd) { bd = dd; best = [xx + 0.5, yy + 0.5]; } } return best; };
          const [hx, hy] = spot(cx, cy);
          const hp = P(hx, hy);
          this.add.ellipse(hp.x, hp.y, 26, 10, 0x000000, 0.55).setDepth(-60);
          this.hero = d.litObject(this.add.sprite(hp.x, hp.y, '__WHITE').setOrigin(0.5, 0.9).setDepth((hx + hy) * 10));
          const playHero = (c: string) => {
            const id = ((ACTOR_IDS as readonly string[]).includes(c) ? c : 'vanguard') as ActorId;
            ensureActor(this, id);
            const a = animFor(id, 'idle', 1);
            this.hero.setTexture(`actor:${id}`);
            this.hero.setFlipX(a.flipX);
            if (this.anims.exists(a.key)) this.hero.play(a.key);
          };
          playHero(initialClass);
          heroRef.current = playHero;
          if (lit) this.lights.addLight(hp.x, hp.y - 20, 220, 0xffb060, 1.4);
          const foes = ['pursuer', 'guardian', 'hexer', 'artillery', 'skirmisher'] as const;
          foes.forEach((k, i) => {
            const [fx, fy] = spot(hx + 3 + (i % 3) * 1.6, hy + 2.5 + i * 1.1 - 2);
            const fp = P(fx, fy);
            this.add.ellipse(fp.x, fp.y, 22, 8, 0x000000, 0.5).setDepth(-60);
            const s = d.litObject(this.add.sprite(fp.x, fp.y, `actor:${k}`).setOrigin(0.5, 0.9).setDepth((fx + fy) * 10));
            const a = animFor(k, 'idle', 5);
            if (this.anims.exists(a.key)) s.play({ key: a.key, startFrame: i % 3 });
            s.setFlipX(a.flipX);
            this.tweens.add({ targets: s, x: s.x - 6, y: s.y - 3, duration: 2400 + i * 300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
          });
          const cam = this.cameras.main;
          cam.setRoundPixels(true);
          if (knobs.postFx && cam.postFX && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) { cam.postFX.addBloom(0xffffff, 1, 1, 0.9, 0.55, 3); cam.postFX.addVignette(0.5, 0.5, 0.9, 0.4); }
          cam.centerOn(hp.x + 40, hp.y - 30);   // hero framed in the open centre between the menu columns
          this.tweens.add({ targets: cam, scrollX: cam.scrollX + 48, scrollY: cam.scrollY + 12, duration: 16000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
          this.events.on('update', (t: number) => d.update(t, null));
        }
      }
      const w = ref.current.clientWidth, h = ref.current.clientHeight;
      const z = pixelZoom(w, h);
      game = new Phaser.Game({
        type: Phaser.WEBGL, parent: ref.current, width: Math.ceil(w / z), height: Math.ceil(h / z), zoom: z,
        pixelArt: true, roundPixels: true, antialias: false, backgroundColor: '#050303', ...tierRenderConfig(knobs),
        scale: { mode: Phaser.Scale.NONE }, audio: { noAudio: true }, banner: false,
        input: { keyboard: false, mouse: false, touch: false, gamepad: false }, scene: MenuScene,
      } as Phaser.Types.Core.GameConfig);
      void BASE_W; void BASE_H;
    })().catch(() => undefined);
    return () => { cancelled = true; heroRef.current = null; game?.destroy(true); };
  }, [tier]);
  return <div ref={ref} aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden' }} />;
}
