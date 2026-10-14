import * as Phaser from 'phaser';
import type { PlanAmbient } from './dressing';
import { WALL_H, iso } from './iso';
import { gfx } from '../gfx';

// Ambient life for the dungeon (client-only, cosmetic, never touches the simulation): rats that scurry along the back
// walls and bolt from heroes, bats crossing high overhead, flies over the dead, spiders lowering themselves from
// cobwebs, smoke / steam / spores / embers rising from their sources, drips rippling into puddles and gusts of snow.
// Everything is pooled and capped; offscreen sources do not emit and offscreen critters are not updated. Critters are
// tiny, dark and quick so they never compete with enemies for attention. Graphics tier (game/gfx.ts): critters and gusts
// need ambientLife, source smoke / embers / drips need animatedDecor, and the mote pool and emit rates scale with particles.

type Focus = { x: number; y: number; depth: number }[] | null;

interface Mote {
  img: Phaser.GameObjects.Image;
  on: boolean;
  x: number; y: number; vx: number; vy: number; ay: number;
  age: number; life: number;
  s0: number; s1: number; peak: number; a: number;
  sway: number; phase: number;
  flicker: boolean;
  /** drips: ground line where the drop turns into a ripple */
  ground?: number;
  ripple?: boolean;
}

interface Rat {
  spr: Phaser.GameObjects.Sprite;
  on: boolean;
  run: number; t: number; dir: 1 | -1; speed: number;
  state: 'run' | 'pause' | 'flee' | 'fade';
  timer: number; alpha: number;
}

interface Bat { spr: Phaser.GameObjects.Image; on: boolean; x: number; y: number; vx: number; vy: number; t: number; amp: number; phase: number }
interface Flies { spr: Phaser.GameObjects.Image; x: number; y: number; depth: number; phase: number }
interface Spider { body: Phaser.GameObjects.Image; thread: Phaser.GameObjects.Image; x: number; y: number; state: 'wait' | 'down' | 'hang' | 'up'; t: number; dur: number; drop: number; len: number }
interface Emitter { kind: PlanAmbient['emitters'][number]['kind']; sx: number; sy: number; depth: number; rate: number; acc: number }

const MAX_MOTES = 90;
const MAX_FLIES = 14;
const MAX_SPIDERS = 5;

export class Ambient {
  private motes: Mote[] = [];
  private rats: Rat[] = [];
  private bats: Bat[] = [];
  private flies: Flies[] = [];
  private corpseFlies: Flies[] = [];
  private spiders: Spider[] = [];
  private emitters: Emitter[] = [];
  private drips: { sx: number; sy: number; depth: number; next: number }[] = [];
  private objs: Phaser.GameObjects.GameObject[] = [];
  private last = -1;
  private nextBat = 0;
  private nextGust = 0;
  private sporeTint: number[];
  /** tier budget, fixed per map (the dungeon rebuilds Ambient on every floor) */
  private life: boolean;
  private maxMotes: number;
  private gusts: boolean;

  constructor(private scene: Phaser.Scene, private hints: PlanAmbient, private lighting: boolean) {
    const has = (k: string): boolean => scene.textures.exists(k);
    const k = gfx();
    this.life = k.ambientLife;
    this.gusts = k.ambientLife && hints.gusts;
    this.maxMotes = Math.round(MAX_MOTES * Math.min(1, k.particles));
    this.sporeTint = hints.theme === 'fungal' ? [0x7af0d0, 0xff9ae8, 0x9afff0] : [0xd8c8a8];
    if (k.animatedDecor) {
      const rate = Math.min(1, k.particles);
      for (const e of hints.emitters) {
        const p = iso.p(e.x, e.y);
        this.emitters.push({ kind: e.kind, sx: p.x, sy: p.y - e.z, depth: iso.depth(e.x, e.y) + 4, rate: e.rate * rate, acc: Math.random() });
      }
      for (const d of hints.drips) {
        const p = iso.p(d.x, d.y);
        this.drips.push({ sx: p.x, sy: p.y, depth: iso.depth(d.x, d.y) + 2, next: 500 + Math.random() * 4000 });
      }
    }
    if (!this.life) { this.nextGust = Infinity; return; }
    if (has('critter:rat')) {
      for (let i = 0; i < Math.min(4, hints.ratCount); i++) {
        const spr = this.lit(scene.add.sprite(0, 0, 'critter:rat', 0).setOrigin(0.5, 0.85).setVisible(false));
        this.objs.push(spr);
        this.rats.push({ spr, on: false, run: 0, t: 0, dir: 1, speed: 2, state: 'run', timer: 1500 + i * 2500 + Math.random() * 4000, alpha: 0 });
      }
    }
    if (has('critter:bat') && hints.bats) {
      for (let i = 0; i < 3; i++) {
        const spr = scene.add.image(0, 0, 'critter:bat', 0).setDepth(4790).setVisible(false).setAlpha(0.85);
        this.objs.push(spr);
        this.bats.push({ spr, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, amp: 4, phase: 0 });
      }
      this.nextBat = 6000 + Math.random() * 10000;
    }
    if (has('critter:flies')) {
      for (const f of hints.flies.slice(0, MAX_FLIES)) {
        const p = iso.p(f.x, f.y);
        this.flies.push(this.makeFlies(p.x, p.y - f.z, iso.depth(f.x, f.y) + 6));
      }
    }
    if (has('critter:spider')) {
      for (const w of hints.webs.slice(0, MAX_SPIDERS)) {
        const p = iso.p(w.x, w.y);
        const x = p.x + 3, y = p.y - w.z;
        const thread = this.lit(scene.add.image(x, y, '__WHITE').setOrigin(0.5, 0).setDisplaySize(1, 1).setTint(0xd8d4cc).setAlpha(0.4).setDepth(w.depth + 0.1));
        const body = this.lit(scene.add.image(x, y, 'critter:spider', 0).setOrigin(0.5, 0.2).setDepth(w.depth + 0.2));
        this.objs.push(thread, body);
        this.spiders.push({ body, thread, x, y, state: 'wait', t: 0, dur: 2000 + Math.random() * 8000, drop: 12 + Math.random() * 18, len: 0 });
      }
    }
    this.nextGust = 3000 + Math.random() * 6000;
  }

  private lit<T extends Phaser.GameObjects.Image | Phaser.GameObjects.Sprite>(o: T): T {
    if (this.lighting) o.setPipeline('Light2D');
    return o;
  }

  private makeFlies(x: number, y: number, depth: number): Flies {
    const spr = this.scene.add.image(x, y, 'critter:flies', 0).setOrigin(0.5, 0.5).setDepth(depth).setAlpha(0.9).setVisible(false);
    this.objs.push(spr);
    return { spr, x, y, depth, phase: Math.random() * 1000 };
  }

  /** A fresh body attracts a swarm (screen position of the corpse). */
  addFlies(x: number, y: number): void {
    if (!this.life || !this.scene.textures.exists('critter:flies')) return;
    const w = iso.toWorld(x, y);
    if (this.corpseFlies.length >= 6) {
      const old = this.corpseFlies.shift()!;
      old.spr.destroy();
      this.objs = this.objs.filter((o) => o !== old.spr);
    }
    this.corpseFlies.push(this.makeFlies(x, y - 8, iso.depth(w.x, w.y) + 6));
  }

  // ---------------------------------------------------------------- motes

  private mote(): Mote | null {
    for (const m of this.motes) if (!m.on) return m;
    if (this.motes.length >= this.maxMotes) return null;
    const img = this.scene.add.image(0, 0, 'amb:mote').setVisible(false);
    this.objs.push(img);
    const m: Mote = { img, on: false, x: 0, y: 0, vx: 0, vy: 0, ay: 0, age: 0, life: 1, s0: 1, s1: 1, peak: 1, a: 1, sway: 0, phase: 0, flicker: false };
    this.motes.push(m);
    return m;
  }

  private spawn(key: string, x: number, y: number, depth: number, o: { vx: number; vy: number; ay?: number; life: number; s0: number; s1: number; peak: number; a?: number; sway?: number; tint: number; add?: boolean; lit?: boolean; flicker?: boolean; ground?: number; ripple?: boolean }): Mote | null {
    if (!this.scene.textures.exists(key)) return null;
    const m = this.mote();
    if (!m) return null;
    m.on = true;
    m.x = x; m.y = y; m.vx = o.vx; m.vy = o.vy; m.ay = o.ay ?? 0;
    m.age = 0; m.life = o.life; m.s0 = o.s0; m.s1 = o.s1; m.peak = o.peak; m.a = o.a ?? 0.25;
    m.sway = o.sway ?? 0; m.phase = Math.random() * 6.28; m.flicker = !!o.flicker;
    m.ground = o.ground; m.ripple = o.ripple;
    m.img.setTexture(key).setPosition(x, y).setDepth(depth).setTint(o.tint).setScale(o.s0).setAlpha(0).setVisible(true)
      .setBlendMode(o.add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    if (o.lit && this.lighting) m.img.setPipeline('Light2D');
    else m.img.resetPipeline();
    return m;
  }

  private emit(e: Emitter): void {
    const r = Math.random;
    switch (e.kind) {
      case 'smoke':
        this.spawn('amb:wisp', e.sx + (r() - 0.5) * 4, e.sy, e.depth, { vx: (r() - 0.5) * 6, vy: -16 - r() * 9, life: 2.4 + r(), s0: 0.45, s1: 1.7, peak: 0.42, sway: 5, tint: 0x3a3230, lit: true });
        break;
      case 'wisp':
        this.spawn('amb:wisp', e.sx + (r() - 0.5) * 3, e.sy, e.depth, { vx: (r() - 0.5) * 4, vy: -10 - r() * 6, life: 1.8 + r(), s0: 0.3, s1: 0.9, peak: 0.2, sway: 3, tint: 0x8a8480, lit: true });
        break;
      case 'steam':
        this.spawn('amb:wisp', e.sx + (r() - 0.5) * 8, e.sy, e.depth, { vx: (r() - 0.5) * 6, vy: -22 - r() * 10, life: 1.3 + r() * 0.7, s0: 0.4, s1: 1.4, peak: 0.32, sway: 4, tint: 0xd8e4ec, lit: true });
        break;
      case 'spores': {
        const tint = this.sporeTint[Math.floor(r() * this.sporeTint.length)]!;
        this.spawn('amb:mote', e.sx + (r() - 0.5) * 14, e.sy + (r() - 0.5) * 6, e.depth, { vx: (r() - 0.5) * 5, vy: -5 - r() * 6, life: 3 + r() * 2.5, s0: 1, s1: 0.8, peak: 0.9, a: 0.3, sway: 5, tint, add: true });
        break;
      }
      case 'embers':
        this.spawn('amb:mote', e.sx + (r() - 0.5) * 10, e.sy, e.depth, { vx: (r() - 0.5) * 18, vy: -28 - r() * 22, life: 0.9 + r() * 0.9, s0: 1, s1: 0.5, peak: 1, a: 0.05, sway: 3, tint: r() < 0.5 ? 0xffa040 : 0xff6a1a, add: true, flicker: true });
        break;
    }
  }

  // ---------------------------------------------------------------- update

  update(time: number, focus: Focus): void {
    const dt = this.last < 0 ? 16 : Math.min(50, time - this.last);
    this.last = time;
    const s = dt / 1000;
    const view = this.scene.cameras.main.worldView;
    const vx0 = view.x - 48, vx1 = view.x + view.width + 48, vy0 = view.y - 64, vy1 = view.y + view.height + 64;
    const onScreen = (x: number, y: number): boolean => x > vx0 && x < vx1 && y > vy0 && y < vy1;

    for (const e of this.emitters) {
      if (!onScreen(e.sx, e.sy)) continue;
      e.acc += e.rate * s;
      while (e.acc >= 1) { e.acc -= 1; this.emit(e); }
    }
    for (const d of this.drips) {
      d.next -= dt;
      if (d.next > 0) continue;
      d.next = 1800 + Math.random() * 5200;
      if (!onScreen(d.sx, d.sy)) continue;
      this.spawn('amb:drop', d.sx, d.sy - (WALL_H - 8), d.depth, { vx: 0, vy: 10, ay: 520, life: 2, s0: 1, s1: 1, peak: 0.85, a: 0.01, tint: 0xb8e0ff, ground: d.sy });
    }
    if (this.gusts) {
      this.nextGust -= dt;
      if (this.nextGust <= 0) {
        this.nextGust = 6000 + Math.random() * 7000;
        const n = 12 + Math.floor(Math.random() * 9);
        for (let i = 0; i < n; i++) {
          this.spawn('amb:streak', view.x - 30 + Math.random() * view.width * 0.4, view.y + Math.random() * view.height, 4790, {
            vx: 100 + Math.random() * 70, vy: 10 + Math.random() * 14, life: 1.6 + Math.random(), s0: 1, s1: 1, peak: 0.5, a: 0.2, sway: 2, tint: 0xffffff,
          });
        }
      }
    }
    for (const m of this.motes) {
      if (!m.on) continue;
      m.age += s;
      m.vy += m.ay * s;
      m.x += m.vx * s;
      m.y += m.vy * s;
      if (m.ground !== undefined && !m.ripple && m.y >= m.ground) {
        // the drop lands: turn it into an expanding ripple on the floor
        m.ripple = true;
        m.x = Math.round(m.x); m.y = m.ground; m.vx = 0; m.vy = 0; m.ay = 0; m.age = 0; m.life = 0.75;
        m.s0 = 0.25; m.s1 = 1.15; m.peak = 0.55; m.a = 0.01; m.sway = 0;
        m.img.setTexture('amb:ripple').setDepth(-84).setTint(0x9fd0ff);
      }
      const t = m.age / m.life;
      if (t >= 1) { m.on = false; m.img.setVisible(false); continue; }
      const fadeIn = m.a > 0 ? Math.min(1, t / m.a) : 1;
      let alpha = m.peak * fadeIn * (t < m.a ? 1 : 1 - (t - m.a) / (1 - m.a));
      if (m.flicker) alpha *= 0.65 + Math.random() * 0.35;
      const sx = m.sway ? Math.sin(m.age * 2.2 + m.phase) * m.sway : 0;
      m.img.setPosition(m.x + sx, m.y).setScale(m.s0 + (m.s1 - m.s0) * t).setAlpha(Math.max(0, alpha));
    }

    this.updateRats(time, dt, focus, onScreen);
    this.updateBats(dt, view);
    for (const f of [...this.flies, ...this.corpseFlies]) {
      const vis = onScreen(f.x, f.y);
      f.spr.setVisible(vis);
      if (!vis) continue;
      f.spr.setFrame(Math.floor((time + f.phase) / 70) % 4).setPosition(Math.round(f.x + Math.sin((time + f.phase) * 0.003) * 2), Math.round(f.y + Math.cos((time + f.phase) * 0.0041) * 1.5));
    }
    for (const sp of this.spiders) this.updateSpider(sp, time, dt, onScreen);
  }

  private updateRats(time: number, dt: number, focus: Focus, onScreen: (x: number, y: number) => boolean): void {
    const runs = this.hints.rats;
    if (!runs.length) return;
    const heroes = (focus ?? []).map((f) => iso.toWorld(f.x, f.y));
    const s = dt / 1000;
    for (const r of this.rats) {
      if (!r.on) {
        r.timer -= dt;
        if (r.timer > 0) continue;
        r.timer = 2500 + Math.random() * 6000;
        // emerge from a crack on a visible wall run, away from the party
        for (let tries = 0; tries < 6; tries++) {
          const k = Math.floor(Math.random() * runs.length);
          const run = runs[k]!;
          const mx = (run.x0 + run.x1) / 2, my = (run.y0 + run.y1) / 2;
          const sp = iso.p(mx, my);
          if (!onScreen(sp.x, sp.y)) continue;
          if (heroes.some((h) => Math.hypot(h.x - mx, h.y - my) < 3.5)) continue;
          r.on = true; r.run = k; r.dir = Math.random() < 0.5 ? 1 : -1; r.t = r.dir > 0 ? 0 : 1;
          r.speed = 1.5 + Math.random() * 0.9; r.state = 'run'; r.timer = 0; r.alpha = 0;
          r.spr.setVisible(true).setAlpha(0);
          break;
        }
        continue;
      }
      const run = runs[r.run]!;
      const len = Math.max(0.5, Math.hypot(run.x1 - run.x0, run.y1 - run.y0));
      let wx = run.x0 + (run.x1 - run.x0) * r.t, wy = run.y0 + (run.y1 - run.y0) * r.t;
      // bolt when a hero comes close
      if (r.state !== 'flee' && r.state !== 'fade') {
        const near = heroes.find((h) => Math.hypot(h.x - wx, h.y - wy) < 2.6);
        if (near) {
          const along = (near.x - wx) * (run.x1 - run.x0) + (near.y - wy) * (run.y1 - run.y0);
          r.dir = along > 0 ? -1 : 1;
          r.state = 'flee'; r.timer = 650; r.speed = 5.2;
        }
      }
      if (r.state === 'pause') {
        r.timer -= dt;
        if (r.timer <= 0) r.state = 'run';
      } else if (r.state === 'run' || r.state === 'flee') {
        r.t += (r.dir * r.speed * s) / len;
        if (r.state === 'run' && Math.random() < s * 0.55) { r.state = 'pause'; r.timer = 300 + Math.random() * 800; }
        if (r.state === 'flee') { r.timer -= dt; if (r.timer <= 0) r.state = 'fade'; }
        if (r.t <= 0 || r.t >= 1) { r.t = Math.max(0, Math.min(1, r.t)); r.state = 'fade'; }
      }
      if (r.state === 'fade') {
        r.alpha -= s * 4;
        if (r.state === 'fade' && r.alpha <= 0) { r.on = false; r.spr.setVisible(false); continue; }
        r.t = Math.max(0, Math.min(1, r.t + (r.dir * r.speed * 0.5 * s) / len));
      } else r.alpha = Math.min(1, r.alpha + s * 5);
      wx = run.x0 + (run.x1 - run.x0) * r.t;
      wy = run.y0 + (run.y1 - run.y0) * r.t;
      const p = iso.p(wx, wy);
      // facing: +x runs down-right, -x up-left, +y down-left, -y up-right (art faces left)
      const dx = (run.x1 - run.x0) * r.dir, dy = (run.y1 - run.y0) * r.dir;
      const down = dx > 0.01 || dy > 0.01;
      const flip = dx > 0.01 || dy < -0.01;
      const moving = r.state !== 'pause';
      const frame = moving ? (down ? 0 : 4) + (Math.floor(time / (r.state === 'flee' ? 32 : 55)) % 4) : down ? 8 : 9;
      r.spr.setFrame(frame).setFlipX(flip).setPosition(Math.round(p.x), Math.round(p.y)).setDepth(iso.depth(wx, wy) + 1).setAlpha(r.alpha);
    }
  }

  private updateBats(dt: number, view: Phaser.Geom.Rectangle): void {
    if (!this.bats.length) return;
    this.nextBat -= dt;
    if (this.nextBat <= 0) {
      this.nextBat = 9000 + Math.random() * 14000;
      const n = 1 + Math.floor(Math.random() * 3);
      const fromLeft = Math.random() < 0.5;
      const y0 = view.y + view.height * (0.08 + Math.random() * 0.45);
      let spawned = 0;
      for (const b of this.bats) {
        if (b.on || spawned >= n) continue;
        b.on = true;
        b.x = fromLeft ? view.x - 14 - spawned * 18 : view.x + view.width + 14 + spawned * 18;
        b.y = y0 + (Math.random() - 0.5) * 30;
        b.vx = (fromLeft ? 1 : -1) * (85 + Math.random() * 45);
        b.vy = (Math.random() - 0.5) * 18;
        b.t = Math.random() * 5; b.amp = 3 + Math.random() * 4; b.phase = Math.random() * 6.28;
        b.spr.setVisible(true).setFlipX(!fromLeft);
        spawned++;
      }
    }
    const s = dt / 1000;
    for (const b of this.bats) {
      if (!b.on) continue;
      b.t += s;
      b.x += b.vx * s;
      b.y += b.vy * s;
      b.spr.setPosition(Math.round(b.x), Math.round(b.y + Math.sin(b.t * 11 + b.phase) * b.amp)).setFrame(Math.floor(b.t * 14) % 4);
      if ((b.vx > 0 && b.x > view.x + view.width + 40) || (b.vx < 0 && b.x < view.x - 40)) { b.on = false; b.spr.setVisible(false); }
    }
  }

  private updateSpider(sp: Spider, time: number, dt: number, onScreen: (x: number, y: number) => boolean): void {
    const vis = onScreen(sp.x, sp.y);
    sp.body.setVisible(vis);
    sp.thread.setVisible(vis && sp.len > 1);
    sp.t += dt;
    if (sp.t >= sp.dur) {
      sp.t = 0;
      if (sp.state === 'wait') { sp.state = 'down'; sp.dur = 1500 + Math.random() * 1500; sp.drop = 10 + Math.random() * 20; }
      else if (sp.state === 'down') { sp.state = 'hang'; sp.dur = 2000 + Math.random() * 4000; }
      else if (sp.state === 'hang') { sp.state = 'up'; sp.dur = 1500 + Math.random() * 1200; }
      else { sp.state = 'wait'; sp.dur = 4000 + Math.random() * 9000; }
    }
    if (!vis) return;
    const k = sp.t / sp.dur;
    const ease = (v: number): number => v * v * (3 - 2 * v);
    sp.len = sp.state === 'wait' ? 0 : sp.state === 'down' ? sp.drop * ease(k) : sp.state === 'hang' ? sp.drop + Math.sin(time * 0.004) * 1.2 : sp.drop * (1 - ease(k));
    const moving = sp.state === 'down' || sp.state === 'up';
    sp.body.setPosition(sp.x, Math.round(sp.y + sp.len)).setFrame(moving ? Math.floor(time / 160) % 2 : 0);
    sp.thread.setPosition(sp.x, sp.y).setDisplaySize(1, Math.max(1, Math.round(sp.len)));
  }

  destroy(): void {
    for (const o of this.objs) o.destroy();
    this.objs = [];
    this.motes = []; this.rats = []; this.bats = []; this.flies = []; this.corpseFlies = []; this.spiders = [];
  }
}
