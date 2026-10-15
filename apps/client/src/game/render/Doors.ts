import * as Phaser from 'phaser';
import { CLASS_BY_ID, DUNGEON_THEMES } from '@cursebound/content';
import type { SnapDoor, Snapshot } from '@cursebound/simulation';
import { DOOR_FRAMES, DOOR_GEOM, doorArtTheme, doorColors, doorKey, ensureDoorArt, sigilKey, type DoorLayer, type DoorSide } from '../art/doors';
import type { SfxId } from '../audio/AudioEngine';
import type { DungeonRenderer } from './DungeonRenderer';
import { iso } from './iso';
import { FONT_WORLD, WORLD_TEXT_PX } from '@/ui/fonts';
import { netStore } from '@/lib/net';
import { PrismSparkles, prismColor, prismRing } from './prismatic';

// The in-world Fate vote (doors.ts in the simulation): three themed archways set into one stretch of wall, drawn from
// snapshot.doors during VOTING and FATE_COMMIT. Each door is split into three depth strips (one per wall tile it
// covers) so heroes sort correctly in front of it; frame and leaves are lit by Light2D, the portal sheet and the
// emissive details glow on their own. A coloured Light2D light and a PointLight carry the theme's colour into the
// room; a floor sigil marks the voting spot, with pips for the heroes standing there and a ring that fills as the
// party's hold completes. Doors open when someone approaches; the chosen door opens wide and stays until ROUND_SETUP.
//
// Window events (DOM):
//   'cursebound:doorhover'  detail { i: number | null }        pointer over a door (DoorPanel shows it)
//   'cursebound:moveto'     detail { x, y } (world tiles)      clicking a door walks the hero to its front point
// A door whose card carries a Fate's Blessing (snapshot bl) shimmers in rainbow: its portal sheet, light and spill
// wheel through the hues, a rainbow ring turns round its voting spot and sparkles rise from the opening.

const { FW, TILE_COL, TILE_W, TEX_H } = DOOR_GEOM;
const STRIPS: [number, number][] = [[0, TILE_COL], [TILE_COL, TILE_W], [TILE_COL + TILE_W, FW - TILE_COL - TILE_W]];
const LAYERS: DoorLayer[] = ['frame', 'portal', 'leaves', 'glow'];
const FLAT = -85;
const NEAR = 2.6;        // tiles: a hero this close opens the door
const LOCAL_NEAR = 2.4;  // tiles: the local hero's soft pulse + hum

interface DoorView {
  d: SnapDoor;
  side: DoorSide;
  theme: string;
  ox: number; oy: number;
  depth: number;                       // the door tile strip's depth
  layers: Record<DoorLayer, Phaser.GameObjects.Image[]>;
  sigil: Phaser.GameObjects.Image;
  spill: Phaser.GameObjects.Image | null;
  point: Phaser.GameObjects.PointLight | null;
  light: Phaser.GameObjects.Light | null;
  label: Phaser.GameObjects.Text;
  gfx: Phaser.GameObjects.Graphics;
  open: number;
  alpha: number;
  fade: number;
  born: number;
  hold: number;
  sel: boolean;
  color: number;
  glow: number;
  /** blessed (Fate's Blessing): rainbow shimmer */
  bl: boolean;
}

export class DoorRenderer {
  private views: DoorView[] = [];
  private sig = '';
  private hidden: Phaser.GameObjects.GameObject[] = [];
  private pointer = { x: 0, y: 0, inside: false };
  private hover: number | null = null;
  private lastHum = 0;
  private localDoor: number | null = null;
  private lockedSeen = false;
  private handlers: [EventTarget, string, EventListener][] = [];
  private sparks = new PrismSparkles();
  private sparkG: Phaser.GameObjects.Graphics | null = null;

  constructor(
    private scene: Phaser.Scene,
    private dungeon: DungeonRenderer,
    private sfx: (id: SfxId, x?: number, y?: number, priority?: number) => void = () => undefined,
  ) {
    const el = scene.game.canvas;
    const on = (t: EventTarget, ev: string, fn: EventListener) => { t.addEventListener(ev, fn); this.handlers.push([t, ev, fn]); };
    on(el, 'pointermove', ((e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top, inside: true };
    }) as EventListener);
    on(el, 'pointerleave', (() => { this.pointer.inside = false; }) as EventListener);
    on(el, 'pointerdown', ((e: PointerEvent) => { if (e.button === 0 && this.hover !== null) this.walkTo(this.hover, true); }) as EventListener);
    on(window, 'pointerup', ((e: PointerEvent) => { if (e.button === 0 && this.hover !== null) this.walkTo(this.hover, true); }) as EventListener);
    scene.events.once('shutdown', () => this.destroy());
    scene.events.once('destroy', () => this.destroy());
  }

  /** Walk the local hero to door i's front point (CONTROLS' click-to-move contract). Re-sent next frame so it wins
   *  over a generic click-to-move on the same click. */
  walkTo(i: number, again = false) {
    const v = this.views.find((w) => w.d.i === i);
    if (!v) return;
    const detail = { x: v.d.x, y: v.d.y };
    window.dispatchEvent(new CustomEvent('cursebound:moveto', { detail }));
    if (again) requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('cursebound:moveto', { detail })));
  }

  /** Per frame. `me` = the local hero's drawn world position (prediction-smoothed), `slot` = local seat. */
  update(snap: Snapshot | null, me: { x: number; y: number } | null, slot: number, delta: number) {
    const doors = snap?.doors;
    if (!snap || !doors || !doors.length || (snap.phase !== 'VOTING' && snap.phase !== 'FATE_COMMIT')) {
      if (this.views.length) this.clear();
      return;
    }
    const sig = doors.map((d) => `${d.x},${d.y},${d.nx},${d.ny},${d.th},${d.c}`).join('|');
    if (sig !== this.sig) { this.clear(); this.build(doors); this.sig = sig; }
    const now = this.scene.time.now;
    const dt = Math.min(0.1, delta / 1000);
    const committing = snap.phase === 'FATE_COMMIT';
    const sg = this.sparkG ??= this.scene.add.graphics().setDepth(4650);
    sg.clear();
    // local vote lock: the Choose button (explicit vote) -> the choose chime
    const locked = netStore.get().myVote.locked;
    if (locked && !this.lockedSeen) this.sfx('door_choose', me?.x, me?.y, 2);
    this.lockedSeen = locked;
    this.updateHover();
    let localDoor: number | null = null;
    for (const v of this.views) {
      const d = doors.find((x) => x.i === v.d.i) ?? v.d;
      const prevHold = v.hold;
      v.d = d; v.hold = d.hold;
      const anyNear = snap.players.some((p) => p.life === 'alive' && (p.x - d.x) ** 2 + (p.y - d.y) ** 2 < NEAR * NEAR);
      const localDist = me ? Math.hypot(me.x - d.x, me.y - d.y) : Infinity;
      if (localDist < LOCAL_NEAR && (localDoor === null || localDist < Math.hypot((me!.x - doors[localDoor]!.x), (me!.y - doors[localDoor]!.y)))) localDoor = d.i;
      // sounds: ring complete, door chosen
      if (d.hold >= 0.999 && prevHold < 0.999) this.sfx('door_choose', d.x, d.y, 2);
      if (d.sel && !v.sel) { this.sfx('door_open', d.x, d.y, 3); this.dungeon.flashLight(this.P(d.x, d.y).x, this.P(d.x, d.y).y - 30, 220, v.color, 3, 900); }
      v.sel = !!d.sel;
      if (d.bl && !v.bl) {
        // just blessed: a rainbow flare at the door (LootRenderer plays the chime and the ground burst)
        const o = this.P(d.x - d.nx * 0.5, d.y - d.ny * 0.5);
        this.sparks.burst(o.x, o.y - 40, 60, 26, 70);
        this.dungeon.flashLight(o.x, o.y - 30, 260, prismColor(now), 3, 900);
      }
      v.bl = !!d.bl;
      // opening: the chosen door opens wide, others close while the party passes through
      const target = committing ? (v.sel ? 1 : 0) : anyNear || this.hover === d.i ? 1 : 0;
      const rate = committing && v.sel ? 3.5 : 2.4;
      v.open += Math.max(-rate * dt, Math.min(rate * dt, target - v.open));
      const born = Math.min(1, (now - v.born) / 700);
      // heroes slipping behind a door (a hero north of the wall) see through it like the walls
      let behind = false;
      for (const p of snap.players) {
        const px = p.s === slot && me ? me.x : p.x, py = p.s === slot && me ? me.y : p.y;
        const q = this.P(px, py);
        if ((px + py) * 10 < v.depth - 10 && q.x > v.ox + 4 && q.x < v.ox + FW - 4 && q.y > v.oy + 10 && q.y - 40 < v.oy + TEX_H - 20) { behind = true; break; }
      }
      const dim = committing && !v.sel ? 0.55 : 1;
      const want = (behind ? 0.32 : 1) * dim;
      v.fade += (want - v.fade) * Math.min(1, dt * 8);
      v.alpha = born * v.fade;
      this.applyFrames(v, now, localDist < LOCAL_NEAR);
      this.drawMarks(v, now, localDist < LOCAL_NEAR || this.hover === d.i, snap);
      // lights
      const near = localDist < LOCAL_NEAR ? 0.35 + 0.25 * Math.sin(now / 220) : 0;
      const boost = committing && v.sel ? 1.8 : 0;
      if (v.light) v.light.intensity = (0.9 + v.open * 1.1 + near + boost) * v.alpha;
      if (v.point) { v.point.intensity = (0.05 + v.open * 0.12 + near * 0.08 + boost * 0.1) * v.alpha; v.point.radius = 34 + v.open * 14; }
      if (v.spill) v.spill.setAlpha((0.08 + v.open * 0.22 + near * 0.15 + boost * 0.12) * v.alpha);
      if (v.bl) this.shimmer(v, now, dt);
    }
    this.sparks.draw(sg, now, delta);
    // the local hero's hum while standing near a door (throttled)
    if (localDoor !== null && !committing) {
      if (localDoor !== this.localDoor || now - this.lastHum > 2600) { this.sfx('door_hum', me?.x, me?.y, 1); this.lastHum = now; }
    }
    this.localDoor = localDoor;
  }

  /** Rainbow shimmer of a blessed door: wheeling portal, light and spill colours plus sparkles in the opening. */
  private shimmer(v: DoorView, now: number, dt: number) {
    const c0 = prismColor(now, 0), c1 = prismColor(now, 0.33), c2 = prismColor(now, 0.66);
    for (const img of v.layers.portal) img.setTint(c0, c1, c2, c0);
    for (const img of v.layers.glow) img.setTint(c1);
    if (v.light) v.light.setColor(c2);
    if (v.point) v.point.color.setFromRGB({ r: (c0 >> 16) & 255, g: (c0 >> 8) & 255, b: c0 & 255 });
    if (v.spill) v.spill.setTint(c1);
    if (v.alpha > 0.05) {
      const o = this.P(v.d.x - v.d.nx * 0.5, v.d.y - v.d.ny * 0.5);
      this.sparks.stream(1000 + v.d.i, o.x, o.y - 30, 22, dt, 16);
    }
  }

  /** Door the local hero is near (for tests and the panel), else null. */
  get nearDoor(): number | null { return this.localDoor; }

  private P(x: number, y: number) { return iso.p(x, y); }

  private build(doors: SnapDoor[]) {
    const s = this.scene;
    const now = s.time.now;
    for (const d of doors) {
      const theme = doorArtTheme(d.th);
      ensureDoorArt(s, theme);
      const side: DoorSide = d.ny === 1 ? 'L' : 'R';
      const wx = Math.floor(d.x) - d.nx, wy = Math.floor(d.y) - d.ny;
      const T = iso.p(wx, wy);
      const ox = side === 'L' ? T.x - 44 : T.x - 12, oy = T.y - 94;
      const tiles: [number, number][] = side === 'L' ? [[wx - 1, wy], [wx, wy], [wx + 1, wy]] : [[wx, wy + 1], [wx, wy], [wx, wy - 1]];
      const layers = {} as Record<DoorLayer, Phaser.GameObjects.Image[]>;
      LAYERS.forEach((layer, li) => {
        layers[layer] = STRIPS.map(([c0, cw], si) => {
          const [tx, ty] = tiles[si]!;
          const img = s.add.image(Math.round(ox), Math.round(oy), doorKey(theme, side, layer), 0).setOrigin(0, 0)
            .setDepth((tx + ty + 1) * 10 + 0.5 + li * 0.01).setCrop(c0, 0, cw, TEX_H).setAlpha(0);
          if (layer === 'frame' || layer === 'leaves') this.dungeon.litObject(img);
          return img;
        });
      });
      const { light: color, glow } = doorColors(theme);
      const front = iso.p(d.x, d.y);
      const opening = iso.p(d.x - d.nx * 0.5, d.y - d.ny * 0.5);
      const sigil = s.add.image(front.x, front.y, sigilKey(theme)).setDepth(FLAT).setAlpha(0);
      const spill = s.textures.exists('light:soft')
        ? s.add.image(front.x, front.y - 2, 'light:soft').setBlendMode(Phaser.BlendModes.ADD).setTint(color).setDepth(FLAT + 0.2).setScale(0.75, 0.38).setAlpha(0)
        : null;
      const point = typeof s.add.pointlight === 'function'
        ? s.add.pointlight(opening.x, opening.y - 26, color, 40, 0.05, 0.09).setDepth((wx + wy + 1) * 10 + 0.56)
        : null;
      const light = this.dungeon.lighting ? s.lights.addLight(opening.x, opening.y - 22, 170, color, 0) : null;
      const name = DUNGEON_THEMES.find((t) => t.id === d.th)?.name.replace(/^The /, '') ?? d.th;
      const label = s.add.text(opening.x, oy + 8, d.b ? `${name}\nBoss Lair` : name, {
        fontFamily: FONT_WORLD, fontSize: `${WORLD_TEXT_PX.label}px`, color: `#${glow.toString(16).padStart(6, '0')}`, stroke: '#070505', strokeThickness: 3, align: 'center', resolution: 1,
      }).setOrigin(0.5, 1).setDepth(4600).setAlpha(0);
      const gfx = s.add.graphics().setDepth(FLAT + 0.4);
      this.views.push({ d, side, theme, ox, oy, depth: (wx + wy + 1) * 10 + 0.5, layers, sigil, spill, point, light, label, gfx, open: 0, alpha: 0, fade: 1, born: now, hold: d.hold, sel: !!d.sel, color, glow, bl: !!d.bl });
      this.dungeon.flashLight(opening.x, opening.y - 24, 160, color, 2.2, 700);
    }
    this.hideClutter();
    const mid = doors[1] ?? doors[0]!;
    this.sfx('door_appear', mid.x, mid.y, 2);
  }

  private applyFrames(v: DoorView, now: number, localNear: boolean) {
    const leafF = Math.round(v.open * (DOOR_FRAMES.leaves - 1));
    const portalF = Math.floor(now / 110) % DOOR_FRAMES.portal;
    const glowF = Math.floor(now / 170) % DOOR_FRAMES.glow;
    const pulse = localNear ? 0.85 + 0.15 * Math.sin(now / 200) : 1;
    for (const img of v.layers.frame) img.setAlpha(v.alpha);
    const show = (img: Phaser.GameObjects.Image, f: number, a: number) => { if (String(img.frame.name) !== String(f)) img.setFrame(f); img.setAlpha(a); };
    for (const img of v.layers.leaves) show(img, leafF, v.alpha);
    for (const img of v.layers.portal) show(img, portalF, v.alpha * (0.75 + 0.25 * v.open) * pulse);
    for (const img of v.layers.glow) show(img, glowF, v.alpha);
  }

  private drawMarks(v: DoorView, now: number, focus: boolean, snap: Snapshot) {
    const d = v.d;
    const g = v.gfx;
    g.clear();
    const c = iso.p(d.x, d.y);
    const breathe = 0.6 + 0.4 * Math.sin(now / 260 + d.i);
    v.sigil.setAlpha(v.alpha * (focus ? 0.95 : 0.55 + 0.15 * breathe));
    v.label.setAlpha(v.alpha * (focus ? 1 : 0.72));
    if (v.alpha <= 0.01) return;
    // commit ring (iso ellipse around the voting spot): dim track + filled arc
    const rx = iso.rx(1.05), ry = iso.ry(1.05);
    const ring = (from: number, to: number, color: number, alpha: number, width: number) => {
      if (to <= from) return;
      g.lineStyle(width, color, alpha);
      g.beginPath();
      const n = Math.max(2, Math.ceil((to - from) * 48));
      for (let k = 0; k <= n; k++) {
        const a = -Math.PI / 2 + (from + (to - from) * (k / n)) * Math.PI * 2;
        const x = Math.round(c.x + Math.cos(a) * rx), y = Math.round(c.y + Math.sin(a) * ry);
        if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.strokePath();
    };
    ring(0, 1, 0x000000, 0.45 * v.alpha, 4);
    if (v.bl) prismRing(g, c.x, c.y, rx + 3, ry + 1.5, now, 0.95 * v.alpha, 2, 24);
    else ring(0, 1, v.color, (focus ? 0.4 : 0.22) * v.alpha, 2);
    if (d.hold > 0) ring(0, Math.min(1, d.hold), v.glow, v.alpha, 3);
    // pips: who stands here (class colours), above the sigil
    const n = d.v.length;
    d.v.forEach((s, k) => {
      const p = snap.players.find((x) => x.s === s);
      const col = parseInt((CLASS_BY_ID[p?.c ?? '']?.accent ?? '#e8c66a').replace('#', ''), 16);
      const px = Math.round(c.x + (k - (n - 1) / 2) * 9), py = Math.round(c.y - ry - 6);
      g.fillStyle(0x000000, v.alpha).fillPoints([{ x: px, y: py - 5 }, { x: px + 5, y: py }, { x: px, y: py + 5 }, { x: px - 5, y: py }], true);
      g.fillStyle(col, v.alpha).fillPoints([{ x: px, y: py - 3 }, { x: px + 3, y: py }, { x: px, y: py + 3 }, { x: px - 3, y: py }], true);
    });
  }

  private updateHover() {
    let hit: number | null = null;
    if (this.pointer.inside) {
      const cam = this.scene.cameras.main;
      const k = this.scene.game.canvas.clientWidth / this.scene.scale.width || 1;
      const mx = this.pointer.x / k + cam.scrollX, my = this.pointer.y / k + cam.scrollY;
      for (const v of this.views) {
        if (v.alpha < 0.3) continue;
        const c = iso.p(v.d.x, v.d.y);
        const onDoor = mx > v.ox + 8 && mx < v.ox + FW - 8 && my > v.oy + 20 && my < v.oy + TEX_H - 10;
        const onSpot = ((mx - c.x) / iso.rx(1.1)) ** 2 + ((my - c.y) / iso.ry(1.1)) ** 2 <= 1;
        if (onDoor || onSpot) { hit = v.d.i; break; }
      }
    }
    if (hit !== this.hover) {
      this.hover = hit;
      window.dispatchEvent(new CustomEvent('cursebound:doorhover', { detail: { i: hit } }));   // CONTROLS shows the hand cursor
    }
  }

  /** Free-standing dressing (statues, shelves, wall hangings) that would stand in or cover an opening is hidden. */
  private hideClutter() {
    for (const obj of this.scene.children.list) {
      const o = obj as Phaser.GameObjects.Image;
      if (!o.texture || !o.visible || typeof o.depth !== 'number') continue;
      const key = o.texture.key;
      if (!key.startsWith('prop:') && !key.startsWith('glow:')) continue;
      for (const v of this.views) {
        const front = iso.p(v.d.x, v.d.y);
        const inRect = o.x > v.ox + 2 && o.x < v.ox + FW - 2 && o.y > v.oy + 10 && o.y < front.y + 22;
        if (inRect && o.depth > v.depth - 12 && o.depth < v.depth + 30) { o.setVisible(false); this.hidden.push(o); break; }
      }
    }
  }

  private clear() {
    for (const v of this.views) {
      for (const l of LAYERS) for (const img of v.layers[l]) img.destroy();
      v.sigil.destroy(); v.spill?.destroy(); v.point?.destroy(); v.label.destroy(); v.gfx.destroy();
      if (v.light) this.scene.lights?.removeLight(v.light);
    }
    this.views = [];
    this.sig = '';
    this.sparkG?.clear();
    for (const o of this.hidden) if (o.active) (o as Phaser.GameObjects.Image).setVisible(true);
    this.hidden = [];
    if (this.hover !== null) { this.hover = null; window.dispatchEvent(new CustomEvent('cursebound:doorhover', { detail: { i: null } })); }
    this.localDoor = null;
  }

  destroy() {
    this.clear();
    this.sparkG?.destroy();
    this.sparkG = null;
    for (const [t, ev, fn] of this.handlers) t.removeEventListener(ev, fn);
    this.handlers = [];
  }
}
