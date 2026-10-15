import * as Phaser from 'phaser';
import { RULES, TICK_RATE, isBossRound } from '@cursebound/content';
import type { SimEvent, Snapshot, SnapPlayer } from '@cursebound/simulation';
import { netStore, type GameConnection, type PhaseData } from '@/lib/net';
import { settingsStore } from '@/lib/settings';
import { ACTOR_IDS, type ActorId } from '../art/actors';
import { circleFree, findPath, type Pt } from '../input/path';
import type { DungeonRenderer } from '../render/DungeonRenderer';
import type { Juice } from '../render/Juice';
import { iso } from '../render/iso';
import { ensureCineArt } from './art';
import { cinematicEnd, cinematicRebroadcast, cinematicStart, type CinematicKind } from './gate';
import { cineOverlay } from './overlay';
import { Puppet, dirOf } from './puppet';
import { BOSS_CINE, bossEpithet, bossName, cardLine, fatesLine, hexCss, themeGlow, themeName } from './text';
import { BOSS_ENTRANCES, ENTRANCE_LIFT } from './entrances';
import { E, Timeline, lerp, type Ease, type TimelineCtx } from './timeline';

// Cutscene director. Every scene is driven by authoritative sim events / phases, so all co-op clients play the same
// scene at the same time, and each scene's length equals the authority's hold window:
//   door walk   FATE_COMMIT   (door_chosen + doors snapshot)  RULES.doorWalkSec, then holds on black + title
//   round start ROUND_SETUP   (phase / round_intro)           RULES.setupSec; the letterbox opens as COMBAT begins
//   boss reveal COMBAT hold   (boss_intro / snapshot cu)      RULES.bossIntroSec (SimState.cinematicUntilTick)
// Heroes and bosses act through puppets built from their real sprites; the real actors are hidden meanwhile and
// shown again in the exact spot the puppet ends on. Esc / click skips the visuals locally (sim timing is unchanged).
// Reduced motion: cuts and fades instead of pans and zooms. Reduced effects: fewer particles. Flashes follow the
// flash setting (Juice). The camera never shakes.

export interface CineHost {
  scene: Phaser.Scene;
  juice: Juice;
  dungeon: DungeonRenderer;
  net: GameConnection;
  sfx: (id: string, wx?: number, wy?: number, priority?: number) => void;
  stinger: (kind: string) => void;
  /** screen-space point the normal camera follow centres on (the local hero) */
  follow: () => Pt;
  heroActor: (classId: string) => ActorId;
}

interface Cine {
  kind: CinematicKind;
  key: string;
  tl: Timeline;
  puppets: Puppet[];
  objs: Phaser.GameObjects.GameObject[];
  lights: Phaser.GameObjects.Light[];
  startedAt: number;
  /** after the timeline, keep the overlay (black + title) until the next scene takes over */
  hold: boolean;
  holdSince: number;
  /** boss rounds: the round intro hands its letterbox straight to the boss reveal */
  keepBars: boolean;
  skipped: boolean;
  /** boss reveals: the authoritative end of the intro hold (snapshot cu), once seen */
  holdEnd?: number;
}

type DoorInfo = { i: number; x: number; y: number; nx: number; ny: number; th: string; c: string; b?: number };

const BOSS_TICKS = () => Math.round(((RULES as { bossIntroSec?: number }).bossIntroSec ?? 4) * TICK_RATE);
/** A boss reveal still playing this long after the authority's hold ended is skipped to its end (background tab). */
const BOSS_LATE_TICKS = Math.round(1 * TICK_RATE);
const DOOR_SEC = () => (RULES as { doorWalkSec?: number }).doorWalkSec ?? 2.6;
const TERMINAL = new Set(['RESULTS', 'FINALIZE', 'RECOVERY', 'PARTY_WIPE', 'RETIRE_REQUEST']);

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const mixWhite = (c: number, k: number) => {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return (Math.round(r + (255 - r) * k) << 16) | (Math.round(g + (255 - g) * k) << 8) | Math.round(b + (255 - b) * k);
};
const scaleRgb = (c: number, k: number) => (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k);

export class CinematicDirector {
  private cur: Cine | null = null;
  private played = new Set<string>();
  private hidden = new Set<string>();
  private hiddenPrefix: string[] = [];
  private cam: Pt | null = null;
  private zoom = 1;
  private dim = 1;
  private amb = 1;
  private mine = new Set<Phaser.GameObjects.Light>();
  private track = new Map<Phaser.GameObjects.Light, { base: number; written: number }>();
  private latest: Snapshot | null = null;
  private introInfo = new Map<number, { theme: string; boss: boolean }>();
  private roundWaitSince = 0;
  /** boss rounds: the gate stays closed between the round intro and the boss reveal (no HUD flash) */
  private awaitBossUntil = 0;
  private debris: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private warned = false;

  constructor(private host: CineHost) {
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('pointerdown', this.onPointer, true);
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('pointerdown', this.onPointer, true);
    if (this.cur) this.finish(this.cur, 'clear');
    this.debris?.destroy();
    this.debris = null;
    cineOverlay.clear();
    cinematicEnd();
  }

  // ---------------- CombatScene hooks ----------------

  /** A cutscene bug must never stall the game: log once, drop the scene, hand everything back. */
  private failed(where: string, err: unknown) {
    if (!this.warned) { this.warned = true; console.error(`[cinematic] ${where} failed; skipping the cutscene`, err); }
    try { if (this.cur) this.finish(this.cur, 'clear'); } catch { this.cur = null; }
    this.hidden.clear(); this.hiddenPrefix = []; this.cam = null; this.dim = 1; this.amb = 1;
    cineOverlay.clear();
    cinematicEnd();
  }

  /** Read (never consume) this frame's sim events. Call before the scene's own event handling splices them. */
  ingest(events: readonly SimEvent[], latest: Snapshot | null) {
    try { this.ingestInner(events, latest); } catch (err) { this.failed('ingest', err); }
  }

  private ingestInner(events: readonly SimEvent[], latest: Snapshot | null) {
    if (latest) this.latest = latest;
    for (const ev of events) {
      const e = ev as { t: string } & Record<string, unknown>;
      if (e.t === 'round_intro') this.introInfo.set(e.round as number, { theme: e.theme as string, boss: !!e.boss });
      else if (e.t === 'boss_intro') this.startBoss(e.id as number, e.k as string, e.x as number, e.y as number, null);
      else if (e.t === 'door_chosen') this.startDoor(e as unknown as DoorInfo);
    }
  }

  /** Advance the active scene. Puppets add themselves to `focus` so walls in front of them fade like for heroes. */
  update(deltaMs: number, latest: Snapshot | null, focus: { x: number; y: number; depth: number }[]) {
    try { this.updateInner(deltaMs, latest, focus); } catch (err) { this.failed('update', err); }
  }

  private updateInner(deltaMs: number, latest: Snapshot | null, focus: { x: number; y: number; depth: number }[]) {
    if (latest) this.latest = latest;
    const ph = netStore.get().phase;
    const now = performance.now();
    this.triggers(latest, ph, now);
    if (!this.cur && this.awaitBossUntil && now > this.awaitBossUntil) {
      this.awaitBossUntil = 0;
      cineOverlay.setBars(0);
      cinematicEnd();
    }
    const sc = this.cur;
    if (!sc) return;
    if (ph && TERMINAL.has(ph.phase)) { this.finish(sc, 'clear'); return; }
    if (sc.kind === 'boss' && latest) {
      if (latest.cu !== undefined) sc.holdEnd = latest.cu;
      // the authority's hold ended a while ago but the visuals fell behind (a hidden tab stops frames while the server
      // fights on): jump to the end so the boss is never an invisible puppet while it attacks
      if (sc.holdEnd !== undefined && !sc.tl.finished && !sc.skipped && latest.tick > sc.holdEnd + BOSS_LATE_TICKS) { this.skipInner(); return; }
    }
    if (!sc.tl.finished) sc.tl.update(Math.min(0.1, Math.max(0, deltaMs) / 1000));
    for (const p of sc.puppets) {
      p.sync();
      if (p.alpha > 0.05) { const q = p.screen; focus.push({ x: q.x, y: q.y, depth: iso.depth(p.x, p.y) }); }
    }
    if (!sc.tl.finished) return;
    if (sc.hold) {
      if (!sc.holdSince) sc.holdSince = now;
      if (now - sc.holdSince > 8000) this.finish(sc, 'clear');   // nothing took over (left the run): lift the curtain
      return;
    }
    if (sc.keepBars && !sc.skipped) {
      this.awaitBossUntil = now + 1500;
      this.finish(sc, 'keepBars', true);
    } else this.finish(sc, 'clear');
  }

  /** Scale scene lights after the dungeon set this frame's torch flicker (dimming for the boss reveal). */
  applyLights() {
    try { this.applyLightsInner(); } catch (err) { this.dim = 1; this.amb = 1; this.track.clear(); this.failed('lights', err); }
  }

  private applyLightsInner() {
    const lm = this.host.scene.lights;
    if (!this.host.dungeon.lighting || !lm) return;
    const k = this.dim;
    const idle = k >= 0.999 && this.amb >= 0.999;
    if (idle && this.track.size === 0) return;
    const next = new Map<Phaser.GameObjects.Light, { base: number; written: number }>();
    for (const l of lm.lights) {
      if (this.mine.has(l)) continue;
      let t = this.track.get(l);
      // someone set this light since we last scaled it: that value is the new base
      if (!t || Math.abs(l.intensity - t.written) > 1e-6) t = { base: l.intensity, written: l.intensity };
      t.written = t.base * k;
      l.intensity = t.written;
      next.set(l, t);
    }
    this.track = idle ? new Map() : next;
    lm.setAmbientColor(scaleRgb(this.host.dungeon.theme.ambient, idle ? 1 : this.amb));
  }

  /** Camera override (screen-space centre and integer zoom) while a scene runs, else null. */
  camera(): { x: number; y: number; zoom: number } | null {
    if (!this.cur || !this.cam) return null;
    // close-ups were framed for a ~960px-wide view; the tighter play camera is already close enough
    const zoom = this.host.scene.scale.width >= 900 ? this.zoom : 1;
    return { x: this.cam.x, y: this.cam.y, zoom };
  }

  /** True when the live actor `key` ('p<slot>' / 'e<id>:<gen>') is stood in for by a puppet. */
  hides(key: string): boolean {
    if (this.hidden.has(key)) return true;
    for (const p of this.hiddenPrefix) if (key.startsWith(p)) return true;
    return false;
  }

  get active() { return !!this.cur; }

  // ---------------- triggers ----------------

  private triggers(latest: Snapshot | null, ph: PhaseData | null, now: number) {
    // round start: the phase itself (the round_intro event only adds theme / boss detail)
    if (ph?.phase === 'ROUND_SETUP' && !this.played.has(`round:${ph.round}`)) {
      const ready = !!latest && latest.phase === 'ROUND_SETUP' && latest.round === ph.round;
      if (!this.roundWaitSince) this.roundWaitSince = now;
      if (ready || now - this.roundWaitSince > 600) {
        this.roundWaitSince = 0;
        const info = this.introInfo.get(ph.round);
        this.startRound(ph.round, info?.theme ?? ph.map?.theme ?? 'catacombs', info?.boss ?? isBossRound(ph.round), latest, ph.tick - 1);
      }
    } else this.roundWaitSince = 0;
    if (!latest) return;
    // boss reveal for clients that missed the event (late join / reconnect mid-hold)
    if (latest.cu !== undefined && latest.tick < latest.cu) {
      const b = latest.enemies.find((e) => e.boss);
      if (b && !this.played.has(`boss:${b.i}`)) this.startBoss(b.i, b.k, b.x, b.y, latest.cu - BOSS_TICKS());
    }
    // door walk from the snapshot's committed door (the event is the usual trigger)
    if (latest.phase === 'FATE_COMMIT' && latest.doors) {
      const d = latest.doors.find((x) => (x as { sel?: number }).sel);
      if (d) this.startDoor(d as DoorInfo);
    }
  }

  // ---------------- scene plumbing ----------------

  private settings() { return settingsStore.get().s; }

  private serverTick(): number | null {
    const s = this.host.net.snaps[this.host.net.snaps.length - 1];
    if (!s) return null;
    return s.snap.tick + (performance.now() - s.at) * (TICK_RATE / 1000);
  }

  /** Seconds the scene is already late (the hold began at `startTick`). */
  private lateBy(startTick: number | null, len: number): number {
    if (startTick === null || !Number.isFinite(startTick)) return 0;
    const t = this.serverTick();
    if (t === null) return 0;
    return clamp((t - startTick) / TICK_RATE, 0, Math.max(0, len - 0.05));
  }

  private camCentre(): Pt {
    const cam = this.host.scene.cameras.main;
    return { x: cam.scrollX + cam.width / 2, y: cam.scrollY + cam.height / 2 };
  }

  private begin(kind: CinematicKind, key: string, len: number): Cine {
    if (this.cur) this.finish(this.cur, 'keep', true);
    this.awaitBossUntil = 0;
    this.played.add(key);
    ensureCineArt(this.host.scene);
    const sc: Cine = { kind, key, tl: new Timeline(len), puppets: [], objs: [], lights: [], startedAt: performance.now(), hold: false, holdSince: 0, keepBars: false, skipped: false };
    this.cur = sc;
    this.cam = this.camCentre();
    this.zoom = 1;
    cinematicStart(kind);
    sc.tl.call(0.15, () => cinematicRebroadcast());
    sc.tl.call(Math.min(0.5, len * 0.2), (ctx) => { if (!ctx.skipping) cineOverlay.setSkipHint(true); });
    return sc;
  }

  /** End a scene: drop puppets, props and lights, show the real actors again, hand the camera back. */
  private finish(sc: Cine, overlay: 'clear' | 'keep' | 'keepBars', chained = false) {
    for (const p of sc.puppets) p.destroy();
    for (const o of sc.objs) { this.host.scene.tweens.killTweensOf(o); o.destroy(); }
    for (const l of sc.lights) { this.host.scene.lights?.removeLight(l); this.mine.delete(l); }
    sc.puppets = []; sc.objs = []; sc.lights = [];
    this.hidden.clear();
    this.hiddenPrefix = [];
    this.dim = 1; this.amb = 1;
    try { this.applyLightsInner(); } catch { this.track.clear(); }
    this.zoom = 1;
    const cam = this.host.scene.cameras.main;
    if (cam.zoom !== 1) cam.setZoom(1);
    this.cam = null;
    if (this.cur === sc) this.cur = null;
    cineOverlay.setSkipHint(false);
    if (overlay === 'clear') { cineOverlay.setBars(0); cineOverlay.setFade(0); cineOverlay.hideTitle(sc.skipped); }
    if (overlay === 'keepBars') { cineOverlay.setFade(0); }
    if (!chained) cinematicEnd();
  }

  private skippable(): boolean {
    const sc = this.cur;
    return !!sc && !sc.skipped && !sc.tl.finished && performance.now() - sc.startedAt > 450;
  }

  /** Jump the visuals to the scene's end state; the authority's timing is untouched. */
  private skip() {
    try { this.skipInner(); } catch (err) { this.failed('skip', err); }
  }

  private skipInner() {
    const sc = this.cur;
    if (!sc) return;
    sc.skipped = true;
    cineOverlay.setSkipHint(false);
    sc.tl.seek(sc.tl.length);
    for (const p of sc.puppets) p.sync();
    if (!sc.hold) this.finish(sc, 'clear');
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Escape' || !this.skippable()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.skip();
  };

  private onPointer = (e: PointerEvent) => {
    if (!this.skippable()) return;
    const t = e.target as HTMLElement | null;
    if (!t || typeof t.closest !== 'function' || !t.closest('.game-canvas, .cine-root')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.skip();
  };

  // ---------------- building blocks ----------------

  private light(sc: Cine, x: number, y: number, radius: number, color: number, intensity: number): Phaser.GameObjects.Light | null {
    const lm = this.host.scene.lights;
    if (!this.host.dungeon.lighting || !lm) return null;
    const l = lm.addLight(x, y, radius, color, intensity);
    sc.lights.push(l);
    this.mine.add(l);
    return l;
  }

  private flash(x: number, y: number, radius: number, color: number, intensity: number, ms: number) {
    this.host.dungeon.flashLight(x, y, radius, color, intensity, ms);
  }

  private image(sc: Cine, key: string, x: number, y: number, depth: number): Phaser.GameObjects.Image | null {
    if (!this.host.scene.textures.exists(key)) return null;
    const img = this.host.scene.add.image(Math.round(x), Math.round(y), key).setDepth(depth);
    sc.objs.push(img);
    return img;
  }

  private sprite(sc: Cine, key: string, x: number, y: number, depth: number): Phaser.GameObjects.Sprite | null {
    if (!this.host.scene.textures.exists(key)) return null;
    const s = this.host.scene.add.sprite(Math.round(x), Math.round(y), key).setDepth(depth);
    if (this.host.scene.anims.exists(key)) s.play(key);
    sc.objs.push(s);
    return s;
  }

  private sfx(ctx: TimelineCtx, id: string, w?: Pt, priority = 2) {
    if (!ctx.skipping) this.host.sfx(id, w?.x, w?.y, priority);
  }

  private stinger(ctx: TimelineCtx, kind: string) { if (!ctx.skipping) this.host.stinger(kind); }

  private barsTo(sc: Cine, at: number, dur: number, to: number) {
    let from = 0;
    sc.tl.tween(at, dur, (k) => cineOverlay.setBars(lerp(from, to, k)), E.inOutQuad, { start: () => { from = cineOverlay.barsValue; } });
  }

  private fadeTo(sc: Cine, at: number, dur: number, to: number, ease: Ease = E.inOutQuad) {
    let from = 0;
    sc.tl.tween(at, dur, (k) => cineOverlay.setFade(lerp(from, to, k)), ease, { start: () => { from = cineOverlay.fadeValue; } });
  }

  /** Camera move: an eased pan, or (reduced motion) a dip to black with a cut in the middle of the window. */
  private move(sc: Cine, at: number, dur: number, to: () => Pt, ease: Ease = E.inOutCubic) {
    if (this.settings().reducedMotion) {
      const mid = at + dur / 2;
      let base = 0;
      sc.tl.tween(mid - 0.12, 0.12, (k) => cineOverlay.setFade(Math.max(base, k)), E.linear, { start: () => { base = cineOverlay.fadeValue; } });
      sc.tl.call(mid, () => { this.cam = to(); });
      sc.tl.tween(mid, 0.14, (k) => cineOverlay.setFade(Math.max(base, 1 - k)), E.linear);
      return;
    }
    let from: Pt = { x: 0, y: 0 };
    sc.tl.tween(at, dur, (k) => { const t = to(); this.cam = { x: lerp(from.x, t.x, k), y: lerp(from.y, t.y, k) }; }, ease, { start: () => { from = this.cam ?? this.camCentre(); } });
  }

  /** Walkable route between two world points (client A*, string-pulled); straight line as a last resort. */
  private route(from: Pt, to: Pt): Pt[] {
    const map = this.host.net.map;
    let pts: Pt[] = [];
    if (map) { try { pts = findPath(map, from.x, from.y, to.x, to.y); } catch { pts = []; } }
    if (!pts.length) return [to];
    const last = pts[pts.length - 1];
    if (Math.hypot(last.x - to.x, last.y - to.y) > 0.05) pts.push(to);
    return pts;
  }

  private floorAt(x: number, y: number, r = 0.25): boolean {
    const map = this.host.net.map;
    return !!map && circleFree(map, x, y, r);
  }

  private particlesLow() { return this.settings().reducedEffects || this.host.juice.low; }

  private debrisAt(x: number, y: number, n: number, tint: number) {
    if (this.particlesLow()) n = Math.ceil(n / 3);
    if (n <= 0 || this.settings().reducedEffects) return;
    const s = this.host.scene;
    if (!this.debris) {
      const tex = s.textures.exists('pfx:shard') ? 'pfx:shard' : '__WHITE';
      this.debris = s.add.particles(0, 0, tex, {
        emitting: false, lifespan: { min: 700, max: 1100 }, speedX: { min: -30, max: 30 }, speedY: { min: 40, max: 140 }, gravityY: 520,
        rotate: { start: 0, end: 360 }, scale: { min: 0.7, max: 1.5 }, alpha: { start: 1, end: 0.7 },
      }).setDepth(4590);
    }
    this.debris.setParticleTint(tint);
    this.debris.emitParticleAt(x, y, n);
  }

  // ---------------- a) door walk-through (FATE_COMMIT) ----------------

  private startDoor(d: DoorInfo) {
    const ph = netStore.get().phase;
    const snap = this.latest;
    const round = ph?.round ?? snap?.round ?? 0;
    const key = `door:${round}`;
    if (this.played.has(key) || !snap) return;
    if (ph && ph.phase !== 'FATE_COMMIT' && ph.phase !== 'VOTING' && snap.phase !== 'FATE_COMMIT') return;
    const len = DOOR_SEC();
    const T = (x: number) => (x * len) / 2.6;
    const startTick = ph?.phase === 'FATE_COMMIT' ? ph.tick - 1 : null;
    const sc = this.begin('door', key, len);
    sc.hold = true;
    const J = this.host.juice;
    const nl = Math.hypot(d.nx, d.ny) || 1;
    const n = { x: d.nx / nl, y: d.ny / nl }, side = { x: -n.y, y: n.x };
    const F = { x: d.x, y: d.y };
    const thr = { x: F.x - n.x * 0.35, y: F.y - n.y * 0.35 };
    const inside = { x: F.x - n.x * 0.95, y: F.y - n.y * 0.95 };
    const glow = themeGlow(d.th), pale = mixWhite(glow, 0.55);
    const fq = iso.p(F.x, F.y), oq = iso.p(inside.x, inside.y);
    const card = cardLine(d.c);
    const boss = d.b ?? snap.doors?.find((x) => x.i === d.i)?.b;

    for (const p of snap.players) this.hidden.add(`p${p.s}`);
    const alive = snap.players.filter((p) => p.life === 'alive').sort((a, b) => Math.hypot(a.x - F.x, a.y - F.y) - Math.hypot(b.x - F.x, b.y - F.y));
    const party = alive.length ? { x: alive.reduce((s, p) => s + p.x, 0) / alive.length, y: alive.reduce((s, p) => s + p.y, 0) / alive.length } : F;

    // letterbox in, camera to the door
    this.barsTo(sc, 0, T(0.35), 1);
    const z = { x: lerp(party.x, F.x, 0.65), y: lerp(party.y, F.y, 0.65) };
    const zq = iso.p(z.x, z.y);
    this.move(sc, 0, T(0.8), () => ({ x: zq.x, y: zq.y - 30 }));
    if (!this.settings().reducedMotion) this.move(sc, T(1.0), len - T(1.0) - 0.1, () => ({ x: lerp(zq.x, oq.x, 0.6), y: lerp(zq.y, oq.y, 0.6) - 36 }), E.inOutSine);
    sc.tl.call(0, (ctx) => this.sfx(ctx, 'cine_whoosh'));

    // the party walks up in a short staggered line
    const enterGap = Math.min(T(0.16), Math.max(0.06, (len - T(1.3) - 1.1) / Math.max(1, alive.length - 1)));
    alive.forEach((p, k) => {
      const lane = k === 0 ? 0 : (k % 2 ? 1 : -1) * 0.4;
      let S = { x: F.x + n.x * (0.5 + 0.55 * k) + side.x * lane, y: F.y + n.y * (0.5 + 0.55 * k) + side.y * lane };
      if (!this.floorAt(S.x, S.y)) S = { x: F.x + n.x * (0.5 + 0.55 * k), y: F.y + n.y * (0.5 + 0.55 * k) };
      if (!this.floorAt(S.x, S.y)) S = { ...F };
      const pup = new Puppet(this.host.scene, this.host.heroActor(p.c), p.x, p.y, this.host.dungeon);
      pup.play('idle', dirOf(p.ax, p.ay));
      pup.onStep = (x, y) => J.dust(x, y, 1, 0x4a3e36);
      sc.puppets.push(pup);
      pup.setPath(this.route({ x: p.x, y: p.y }, S));
      const walkAt = T(0.12) + k * 0.07;
      const walkDur = clamp(pup.pathLength / 4.6, 0.2, Math.max(0.2, T(1.2) - k * 0.07));
      if (pup.pathLength > 0.05) sc.tl.tween(walkAt, walkDur, (q) => pup.setProgress(q), E.inOutSine, { end: () => pup.play('idle', dirOf(-n.x, -n.y)) });
      else sc.tl.call(walkAt, () => pup.play('idle', dirOf(-n.x, -n.y)));
      // ... and steps into the light, one by one
      const enterAt = T(1.3) + k * enterGap;
      sc.tl.tween(enterAt, 0.5, (q) => {
        pup.setProgress(q, 'run');
        pup.setGlow(pale, q < 0.4 ? 0 : (q - 0.4) / 0.6);
        pup.alpha = q < 0.65 ? 1 : 1 - (q - 0.65) / 0.35;
      }, E.inQuad, {
        start: () => { pup.setPath([thr, inside]); },
        end: (ctx) => {
          pup.alpha = 0; pup.setGlow(pale, 0);
          if (ctx.skipping) return;
          J.embersAt(oq.x, oq.y - 24, 14, glow);
          this.flash(oq.x, oq.y - 24, 160, glow, 2.2, 320);
          this.host.sfx('portal_enter', inside.x, inside.y, 1);
        },
      });
    });

    // the door flares in its theme colour
    const shaft = this.image(sc, 'cine:shaft', oq.x, oq.y + 4, iso.depth(inside.x, inside.y) - 2);
    shaft?.setOrigin(0.5, 1).setTint(glow).setBlendMode(Phaser.BlendModes.ADD).setScale(2, 1.1).setAlpha(0);
    const pool = this.image(sc, 'light:soft', fq.x, fq.y, -79);
    pool?.setTint(glow).setBlendMode(Phaser.BlendModes.ADD).setScale(0.55, 0.28).setAlpha(0);
    const lamp = this.light(sc, oq.x, oq.y - 30, 300, glow, 0);
    sc.tl.call(0, (ctx) => this.stinger(ctx, 'door_open'));   // its accent (0.35 s) is the flare below
    sc.tl.tween(0.35, T(0.35), (q) => { shaft?.setAlpha(0.9 * q); pool?.setAlpha(0.7 * q); if (lamp) lamp.intensity = 3.2 * q; }, E.outQuad, {
      start: (ctx) => {
        if (ctx.skipping) return;
        J.ring(fq.x, fq.y, iso.rx(1.6), glow, 520);
        J.embersAt(oq.x, oq.y - 30, 18, glow);
        this.flash(oq.x, oq.y - 30, 280, glow, 3, 500);
        // (the door renderer, render/Doors.ts, plays the door_open grind itself); the rift tears open behind it
        this.host.sfx('portal_open', inside.x, inside.y, 2);
      },
    });
    // the 'portal' cue's accent (0.9 s) lands as the first hero dissolves into the light
    sc.tl.call(Math.max(0, T(1.3) + 0.4 - 0.9), (ctx) => this.stinger(ctx, 'portal'));
    let lastMote = 0;
    sc.tl.tween(0.7, len - 0.7, (q, ctx) => {
      const t = sc.tl.t;
      shaft?.setAlpha(0.78 + 0.14 * Math.sin(t * 9));
      if (ctx.skipping || t - lastMote < 0.08) return;
      lastMote = t;
      J.embersAt(oq.x + (Math.random() - 0.5) * 28, oq.y - Math.random() * 50, 1, pale);
    }, E.linear);

    // fade to black; the destination's name and the bound fate
    this.fadeTo(sc, len - 0.62, 0.5, 1, E.inQuad);
    sc.tl.call(len - 0.5, (ctx) => {
      cineOverlay.showTitle({
        kicker: card ? `${card.name} is bound` : 'Beyond the door',
        title: themeName(d.th).toUpperCase(),
        sub: boss ? 'A boss lair waits beyond' : undefined,
        line: card?.line,
        tone: 'theme', accent: hexCss(mixWhite(glow, 0.35)),
      });
      this.sfx(ctx, 'title_boom');
    });
    const late = this.lateBy(startTick, len);
    if (late > 0.05) sc.tl.seek(late);
  }

  // ---------------- b) round start (ROUND_SETUP) ----------------

  private startRound(round: number, theme: string, boss: boolean, snap: Snapshot | null, startTick: number | null) {
    const len = RULES.setupSec;
    const T = (x: number) => (x * len) / 3;
    const sc = this.begin('round', `round:${round}`, len);
    sc.keepBars = boss;
    const J = this.host.juice;
    const glow = themeGlow(theme), pale = mixWhite(glow, 0.6);
    const players: SnapPlayer[] = snap && snap.phase === 'ROUND_SETUP' && snap.round === round ? snap.players : [];
    const heroes = players.filter((p) => p.life !== 'dead');
    const map = this.host.net.map;

    // straight onto black: the new floor fades in under the letterbox
    cineOverlay.setFade(1);
    cineOverlay.setBars(1);
    cineOverlay.hideTitle();

    const C = heroes.length ? { x: heroes.reduce((s, p) => s + p.x, 0) / heroes.length, y: heroes.reduce((s, p) => s + p.y, 0) / heroes.length } : null;
    if (!C) {
      // no positions yet: a plain fade and the title card
      this.fadeTo(sc, 0, T(0.6), 0, E.outQuad);
    } else {
      for (const p of players) this.hidden.add(`p${p.s}`);
      // entry portal a little behind the party (away from the middle of the floor), with a clear walk to every spawn
      const M = map ? { x: map.w / 2, y: map.h / 2 } : { x: C.x + 1, y: C.y + 1 };
      let ux = C.x - M.x, uy = C.y - M.y;
      const ul = Math.hypot(ux, uy);
      if (ul < 1e-3) { ux = -Math.SQRT1_2; uy = -Math.SQRT1_2; } else { ux /= ul; uy /= ul; }
      let P = { ...C };
      for (const dd of [2.2, 1.8, 1.4, 1.0, 0.6]) {
        const q = { x: C.x + ux * dd, y: C.y + uy * dd };
        if (this.floorAt(q.x, q.y, 0.3) && heroes.every((h) => this.route(q, h).length <= 2)) { P = q; break; }
      }
      const pq = iso.p(P.x, P.y);
      const cq = iso.p(C.x, C.y);
      this.cam = { x: Math.round((pq.x + cq.x) / 2), y: Math.round((pq.y + cq.y) / 2) - 26 };

      this.fadeTo(sc, 0, T(0.55), 0, E.outQuad);
      const portal = this.sprite(sc, 'cine:portal', pq.x, pq.y + 3, iso.depth(P.x, P.y) - 1);
      portal?.setOrigin(0.5, 1).setTint(glow).setBlendMode(Phaser.BlendModes.ADD).setScale(1, 0).setAlpha(0);
      const pool = this.image(sc, 'light:soft', pq.x, pq.y, -79);
      pool?.setTint(glow).setBlendMode(Phaser.BlendModes.ADD).setScale(0.45, 0.22).setAlpha(0);
      const lamp = this.light(sc, pq.x, pq.y - 26, 230, glow, 0);
      sc.tl.tween(T(0.08), T(0.3), (q) => { portal?.setScale(1, q).setAlpha(Math.min(1, q * 1.4)); pool?.setAlpha(0.65 * q); if (lamp) lamp.intensity = 2.4 * q; }, E.outBack, {
        start: (ctx) => {
          if (ctx.skipping) return;
          J.ring(pq.x, pq.y, iso.rx(1.2), glow, 420);
          this.flash(pq.x, pq.y - 26, 200, glow, 2.4, 400);
          this.sfx(ctx, 'portal_enter', P, 2);
        },
      });

      // heroes step out of the light one by one and walk to their places
      const gap = Math.min(T(0.22), T(0.9) / Math.max(1, heroes.length));
      heroes.forEach((h, i) => {
        const pup = new Puppet(this.host.scene, this.host.heroActor(h.c), P.x, P.y, this.host.dungeon);
        pup.alpha = 0;
        pup.onStep = (x, y) => J.dust(x, y, 1, 0x4a3e36);
        pup.setPath(this.route(P, { x: h.x, y: h.y }));
        pup.play('idle', dirOf(h.x - P.x, h.y - P.y));
        sc.puppets.push(pup);
        const at = T(0.42) + i * gap;
        const walk = clamp(pup.pathLength / 4.2, 0.3, T(0.85));
        sc.tl.tween(at, 0.2, (q) => { pup.alpha = q; }, E.outQuad, {
          start: (ctx) => {
            if (ctx.skipping) return;
            J.dust(pq.x, pq.y, 4, 0x3a3048);
            J.embersAt(pq.x, pq.y - 22, 8, glow);
            this.flash(pq.x, pq.y - 22, 120, glow, 1.6, 260);
          },
        });
        sc.tl.tween(at, 0.5, (q) => pup.setGlow(pale, 1 - q), E.inQuad, { end: () => pup.setGlow(pale, 0) });
        if (pup.pathLength > 0.05) sc.tl.tween(at + 0.08, walk, (q) => pup.setProgress(q), E.inOutSine, { end: () => pup.play('idle', dirOf(h.ax, h.ay)) });
        else sc.tl.call(at + 0.08, () => pup.play('idle', dirOf(h.ax, h.ay)));
      });

      // the portal seals behind them
      sc.tl.tween(len - T(0.95), T(0.3), (q) => { portal?.setScale(1 - 0.4 * q, 1 - q).setAlpha(1 - q); pool?.setAlpha(0.65 * (1 - q)); if (lamp) lamp.intensity = 2.4 * (1 - q); }, E.inQuad, {
        end: (ctx) => { if (!ctx.skipping) { J.impact(pq.x, pq.y - 24, glow, 1.4); J.embersAt(pq.x, pq.y - 24, 10, pale); } },
      });
      // the camera settles on the local hero
      this.move(sc, len - T(1.25), T(0.8), () => this.host.follow());
    }

    // title card: DUNGEON 7 / theme / fates bound (BOSS LAIR in red on boss rounds)
    const fates = netStore.get().phase?.fate.length ?? 0;
    sc.tl.call(T(0.72), (ctx) => {
      cineOverlay.showTitle(boss
        ? { kicker: `Dungeon ${round}`, title: 'BOSS LAIR', sub: themeName(theme), line: `${fatesLine(fates)} · Something vast stirs below`, tone: 'blood', pos: 'high' }
        : { kicker: fates > 0 ? undefined : 'The descent begins', title: `DUNGEON ${round}`, sub: themeName(theme), line: fatesLine(fates), tone: 'gold', accent: hexCss(mixWhite(glow, 0.5)), pos: 'high' });
      this.sfx(ctx, 'title_boom', undefined, 3);
      this.sfx(ctx, 'round_start', undefined, 2);
      this.stinger(ctx, 'round_start');
    });
    sc.tl.call(len - T(0.75), () => cineOverlay.hideTitle());
    // the letterbox opens exactly as the authority enters COMBAT (boss rounds hand it to the reveal)
    if (!boss) this.barsTo(sc, len - 0.45, 0.45, 0);
    const late = this.lateBy(startTick, len);
    if (late > 0.05) sc.tl.seek(late);
  }

  // ---------------- c) boss grand entrance (COMBAT hold) ----------------

  private startBoss(id: number, kind: string, x: number, y: number, startTick: number | null) {
    const key = `boss:${id}`;
    if (this.played.has(key)) return;
    const len = (RULES as { bossIntroSec?: number }).bossIntroSec ?? 4;
    const T = (v: number) => (v * len) / 4;
    const snap = this.latest;
    if (startTick === null && snap?.cu !== undefined) startTick = snap.cu - BOSS_TICKS();
    const sc = this.begin('boss', key, len);
    const J = this.host.juice;
    const info = BOSS_CINE[kind] ?? { epithet: '', glow: 0xff5a5a, css: '#ff8a7a', dust: 0x5a4a40 };
    const stag = kind === 'prismstag', bell = kind === 'bellroot';
    const spot = { x, y };
    const sq = iso.p(x, y);
    const heroes = (snap?.players ?? []).filter((p) => p.life === 'alive');
    const party = heroes.length ? { x: heroes.reduce((s, p) => s + p.x, 0) / heroes.length, y: heroes.reduce((s, p) => s + p.y, 0) / heroes.length } : { x: x - 3, y: y - 3 };
    let fx = party.x - x, fy = party.y - y;
    const fl = Math.hypot(fx, fy) || 1; fx /= fl; fy /= fl;
    const actor = (ACTOR_IDS as readonly string[]).includes(kind) ? (kind as ActorId) : null;
    const lift = bell ? 64 : stag ? 46 : ENTRANCE_LIFT[kind] ?? 40;   // camera lift to frame the boss (entrances register theirs)
    const reduced = this.settings().reducedEffects;
    const motion = !this.settings().reducedMotion;

    if (actor) this.hiddenPrefix.push(`e${id}:`);
    const pup = actor ? new Puppet(this.host.scene, actor, x, y, this.host.dungeon) : null;
    if (pup) { pup.alpha = 0; pup.play('idle', dirOf(fx, fy)); sc.puppets.push(pup); }

    // letterbox, lights down, rumble, camera to the lair
    this.barsTo(sc, 0, 0.35, 1);
    sc.tl.tween(0, T(1.0), (q) => { this.dim = lerp(1, 0.3, q); this.amb = lerp(1, 0.42, q); }, E.inOutQuad);
    // boss_reveal cue: fired at 0, its accent (2.0 s) is the emergence; boss_roar's accent (0.12 s) is the cry / toll
    const REVEAL = T(2.0), ROAR = T(2.72);
    sc.tl.call(0, (ctx) => { this.sfx(ctx, 'boss_rumble', spot, 4); this.stinger(ctx, 'boss_reveal'); });
    sc.tl.call(Math.max(0, ROAR - 0.12), (ctx) => this.stinger(ctx, 'boss_roar'));
    this.move(sc, T(0.12), T(0.95), () => ({ x: sq.x, y: sq.y - lift }));
    let lastRumble = -1;
    sc.tl.tween(T(0.2), T(1.75), (_q, ctx) => {
      const t = sc.tl.t;
      if (ctx.skipping || t - lastRumble < (reduced ? 0.3 : 0.11)) return;
      lastRumble = t;
      const a = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * 3.2;
      const g = iso.p(x + Math.cos(a) * r, y + Math.sin(a) * r);
      J.dust(g.x, g.y, 2, info.dust);
      const cam = this.host.scene.cameras.main;
      this.debrisAt(g.x + (Math.random() - 0.5) * 60, cam.scrollY + 10 + Math.random() * 30, 2, 0x8a7a68);
    }, E.linear);

    if (stag) {
      // a ghost-fire summoning circle draws itself, blue flames rise, the Stag walks out of them
      const circle = this.image(sc, 'cine:circle', sq.x, sq.y, -79);
      circle?.setTint(info.glow).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
      const lamp = this.light(sc, sq.x, sq.y - 30, 260, info.glow, 0);
      sc.tl.tween(T(0.45), T(0.9), (q) => { circle?.setFrame(Math.min(7, Math.floor(q * 8))).setAlpha(Math.min(1, q * 2)); }, E.linear, {
        start: (ctx) => { if (!ctx.skipping) J.embersAt(sq.x, sq.y - 6, 12, info.glow); },
      });
      sc.tl.tween(T(0.45), T(1.1), (q) => { if (lamp) lamp.intensity = 2.8 * q; }, E.inQuad);
      const ring = reduced ? 4 : 8;
      for (let i = 0; i < ring; i++) {
        const a = (i / ring) * Math.PI * 2;
        const w = { x: x + Math.cos(a) * 1.55, y: y + Math.sin(a) * 1.55 };
        const q = iso.p(w.x, w.y);
        const f = this.sprite(sc, 'fx:flame', q.x, q.y - 6, iso.depth(w.x, w.y));
        f?.setTint(info.glow).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
        sc.tl.tween(T(0.95) + i * 0.05, 0.2, (k) => f?.setAlpha(k), E.outQuad, { start: (ctx) => { if (!ctx.skipping) J.embersAt(q.x, q.y - 8, 3, info.glow); } });
        sc.tl.tween(T(3.0), T(0.6), (k) => f?.setAlpha(1 - k), E.linear);
      }
      const core = [0, 1, 2].map((i) => {
        const s = this.sprite(sc, 'fx:flame', sq.x + (i - 1) * 18, sq.y - 10 - (i === 1 ? 6 : 0), iso.depth(x, y) + 1);
        s?.setTint(mixWhite(info.glow, 0.3)).setBlendMode(Phaser.BlendModes.ADD).setScale(2).setAlpha(0);
        return s;
      });
      sc.tl.tween(REVEAL - T(0.25), T(0.25), (k) => core.forEach((s) => s?.setAlpha(k)), E.outQuad, {
        start: (ctx) => { if (!ctx.skipping) { this.flash(sq.x, sq.y - 40, 260, info.glow, 3, 500); J.ring(sq.x, sq.y, iso.rx(2), info.glow, 500); } },
      });
      sc.tl.tween(REVEAL + T(0.3), T(0.6), (k) => core.forEach((s) => s?.setAlpha(1 - k)), E.inQuad);
      if (pup) {
        let b0 = { x: x - fx * 1.3, y: y - fy * 1.3 };
        if (!this.floorAt(b0.x, b0.y, 0.4)) b0 = { x: x - fx * 0.6, y: y - fy * 0.6 };
        if (!this.floorAt(b0.x, b0.y, 0.4)) b0 = { ...spot };
        sc.tl.tween(REVEAL - T(0.4), T(0.8), (q) => { pup.setProgress(q); pup.alpha = Math.min(1, q * 2.2); pup.setGlow(0xdff6ff, 1 - q); }, E.outQuad, {
          start: (ctx) => {
            pup.x = b0.x; pup.y = b0.y; pup.setPath([spot]);
            if (ctx.skipping) return;
            J.embersAt(sq.x, sq.y - 30, 24, info.glow);
            this.sfx(ctx, 'boss_emerge', spot, 4);
          },
          end: () => { pup.setGlow(0, 0); pup.play('idle', dirOf(fx, fy)); },
        });
        // the cry: rear up, a pulse of cold fire, slow motion
        sc.tl.call(ROAR - T(0.4), () => pup.play('windup', dirOf(fx, fy), true));
        sc.tl.call(T(3.2), () => pup.play('idle', dirOf(fx, fy)));
      }
      sc.tl.call(ROAR, (ctx) => {
        if (!ctx.skipping) {
          J.ring(sq.x, sq.y, iso.rx(4.5), info.glow, 900);
          J.ring(sq.x, sq.y, iso.rx(2.6), 0xffffff, 600);
          J.embersAt(sq.x, sq.y - 50, 30, info.glow);
          J.flash(mixWhite(info.glow, 0.5), 140);
          J.hitStop(80);
          J.dilate(0.4, 700);
          this.flash(sq.x, sq.y - 50, 420, info.glow, 3.4, 800);
        }
        this.sfx(ctx, 'stag_cry', spot, 5);
        this.sfx(ctx, 'boss_roar', spot, 4);
        if (motion) this.zoom = 2;
      });
    } else if (bell) {
      // the ground cracks open, molten light wells up, the Golem drops from the dark and tolls
      const cracks = this.image(sc, 'cine:cracks', sq.x, sq.y, -79);
      cracks?.setAlpha(0);
      const lamp = this.light(sc, sq.x, sq.y - 10, 260, 0xff8a3a, 0);
      sc.tl.tween(T(0.35), T(1.1), (q, ctx) => {
        cracks?.setFrame(Math.min(7, Math.floor(q * 8))).setAlpha(1);
        if (lamp) lamp.intensity = 2.2 * q;
        if (!ctx.skipping && Math.random() < 0.18) {
          const a = Math.random() * Math.PI * 2, r = q * 2.6;
          const g = iso.p(x + Math.cos(a) * r, y + Math.sin(a) * r);
          J.dust(g.x, g.y, 2, info.dust);
          J.embersAt(g.x, g.y - 2, 2, 0xff8a3a);
        }
      }, E.linear, { start: (ctx) => this.sfx(ctx, 'bell_toll', spot, 1) });
      if (pup) {
        sc.tl.tween(REVEAL - 0.34, 0.34, (q) => { pup.alpha = 1; pup.lift = 260 * (1 - q); }, E.inQuad, {
          start: (ctx) => { pup.lift = 260; pup.alpha = 1; this.sfx(ctx, 'cine_whoosh', spot, 2); },
          end: (ctx) => {
            pup.lift = 0;
            if (ctx.skipping) return;
            J.flash(0xffffff, 110);
            J.hitStop(110);
            J.dilate(0.35, 800);
            J.ring(sq.x, sq.y, iso.rx(5), 0xffd890, 900);
            J.ring(sq.x, sq.y, iso.rx(3.2), 0xffffff, 600);
            J.dust(sq.x, sq.y, 30, info.dust);
            J.impact(sq.x, sq.y - 30, 0xffd890, 3);
            this.debrisAt(sq.x, sq.y - 40, 18, 0x8a7a68);
            this.flash(sq.x, sq.y - 40, 420, 0xffc070, 3.4, 700);
            const slam = this.sprite(sc, 'fx:slam', sq.x, sq.y, iso.depth(x, y) + 2);
            slam?.setBlendMode(Phaser.BlendModes.ADD).setTint(0xffd890).setScale(2);
            this.host.sfx('signature_slam', x, y, 5);
            this.host.sfx('boss_emerge', x, y, 4);
          },
        });
        sc.tl.call(REVEAL + T(0.3), () => pup.play('windup', 2, true));
        sc.tl.call(ROAR - T(0.15), () => pup.play('attack', 2, true));
        sc.tl.call(T(3.2), () => pup.play('idle', 2));
      }
      // the toll: three shock rings, a white flash, slow motion
      [ROAR, ROAR + T(0.18), ROAR + T(0.36)].forEach((at, i) => sc.tl.call(at, (ctx) => {
        if (!ctx.skipping) {
          J.ring(sq.x, sq.y - 40, iso.rx(3 + i * 1.6), i ? 0xffd890 : 0xffffff, 700 + i * 150);
          if (i === 0) { J.flash(0xfff0d0, 140); J.hitStop(90); J.dilate(0.4, 700); this.flash(sq.x, sq.y - 60, 420, 0xffd890, 3.2, 800); }
        }
        if (i === 0) {
          this.sfx(ctx, 'bell_toll', spot, 5);
          this.sfx(ctx, 'boss_roar', spot, 4);
          if (motion) this.zoom = 2;
        }
      }));
    } else if (BOSS_ENTRANCES[kind]) {
      // bosses that stage their own emergence (cinematic/entrances)
      BOSS_ENTRANCES[kind]!({
        tl: sc.tl, J, x, y, sq, fx, fy, pup, glow: info.glow, dust: info.dust, T, REVEAL, ROAR, reduced, motion, dirOf,
        sfx: (ctx, id, priority = 2) => this.sfx(ctx, id, spot, priority),
        image: (k2, ix, iy, depth) => this.image(sc, k2, ix, iy, depth),
        sprite: (k2, ix, iy, depth) => this.sprite(sc, k2, ix, iy, depth),
        light: (lx, ly, radius, color, intensity) => this.light(sc, lx, ly, radius, color, intensity),
        flash: (fx2, fy2, radius, color, intensity, ms) => this.flash(fx2, fy2, radius, color, intensity, ms),
        debris: (dx2, dy2, n, tint) => this.debrisAt(dx2, dy2, n, tint),
        zoom: (z) => { if (motion) this.zoom = z; },
        graphics: (depth) => { const g = this.host.scene.add.graphics().setDepth(depth); sc.objs.push(g); return g; },
      });
    } else {
      // any other boss: rises out of a flare of its colour
      const lamp = this.light(sc, sq.x, sq.y - 30, 260, info.glow, 0);
      sc.tl.tween(T(0.6), T(0.9), (q) => { if (lamp) lamp.intensity = 2.6 * q; }, E.inQuad);
      if (pup) sc.tl.tween(REVEAL - T(0.4), T(0.8), (q) => { pup.alpha = q; pup.setGlow(mixWhite(info.glow, 0.5), 1 - q); }, E.outQuad, {
        start: (ctx) => { if (!ctx.skipping) { J.ring(sq.x, sq.y, iso.rx(3), info.glow, 600); this.sfx(ctx, 'boss_emerge', spot, 4); } },
        end: () => pup.setGlow(0, 0),
      });
      sc.tl.call(ROAR, (ctx) => {
        if (!ctx.skipping) { J.ring(sq.x, sq.y, iso.rx(4.5), info.glow, 900); J.flash(0xffffff, 120); J.dilate(0.4, 700); }
        this.sfx(ctx, 'boss_roar', spot, 5);
        if (motion) this.zoom = 2;
      });
    }

    // the name card and the health bar sweeping in
    sc.tl.call(T(2.85), (ctx) => {
      cineOverlay.showTitle({ kicker: 'The lair awakens', title: bossName(kind).toUpperCase(), sub: bossEpithet(kind), tone: 'blood', accent: info.css, huge: true, bossBar: true, pos: 'low' });
      this.sfx(ctx, 'title_boom', undefined, 4);
    });
    sc.tl.tween(T(3.0), T(0.5), (q) => cineOverlay.setBossFill(q), E.outCubic, {
      start: () => window.dispatchEvent(new CustomEvent('cursebound:bossbar', { detail: { id, kind, name: bossName(kind), title: bossEpithet(kind), sweepMs: Math.round(T(0.5) * 1000) } })),
    });
    sc.tl.call(T(3.6), () => cineOverlay.hideTitle());
    // back to the party; the fight begins when the authority's hold ends
    sc.tl.call(T(3.3), () => { this.zoom = 1; });
    this.move(sc, T(3.3), T(0.5), () => this.host.follow());
    sc.tl.tween(T(3.35), T(0.55), (q) => { this.dim = lerp(0.3, 1, q); this.amb = lerp(0.42, 1, q); }, E.inOutQuad);
    this.barsTo(sc, len - 0.45, 0.45, 0);
    const late = this.lateBy(startTick, len);
    if (late > 0.05) sc.tl.seek(late);
  }
}
