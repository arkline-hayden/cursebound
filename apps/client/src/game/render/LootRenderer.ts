import * as Phaser from 'phaser';
import { CARD_BY_ID, FATES_BLESSING, LEGENDARY_BY_ID } from '@cursebound/content';
import type { SimEvent, Snapshot } from '@cursebound/simulation';
import { iso } from './iso';
import type { DungeonRenderer } from './DungeonRenderer';
import type { Juice } from './Juice';
import { registerHazardFx } from './fx/registry';
import type { AudioEngine, SfxId } from '../audio/AudioEngine';
import { blessingPixels, itemIconPixels } from '@/ui/itemIconData';
import { PrismSparkles, prismColor, prismRing } from './prismatic';
import { gfx } from '../gfx';
import { netStore } from '@/lib/net';
import { FONT_WORLD, WORLD_TEXT_PX } from '@/ui/fonts';

// Legendary loot presentation (cosmetic only). CombatScene constructs one in create() and calls
// update(latestSnapshot, net.events) once per frame BEFORE it consumes the event queue (read-only here).
// Ground items: a tall additive orange light beam (Diablo legendary pillar), a bobbing pixel icon, a Light2D glow
// and an orange pixel-font name label. Drops chime; equips burst; perk procs get small rings/bolts. React overlays
// (toasts, the Interact prompt) listen to the 'cursebound:legendary' window event dispatched from here.
// Fate's Blessing (the legendary consumable) lies in a prismatic beam instead: hue-cycling pillar and halo, a
// stepped-rainbow icon, a turning rainbow ring, rising pixel sparkles and a colour-wheeling light; picking it up and
// blessing a card burst in rainbow ('cursebound:blessing' window event for the React toasts).
// The pointer over a ground item is announced as 'cursebound:loothover' { id | null } (GearLayer's quick-compare).

const ORANGE = 0xff8a1e;
const ORANGE_HI = 0xffc070;

export interface LootHost extends Phaser.Scene {
  dungeon: DungeonRenderer;
  juice: Juice;
  audio: AudioEngine | null;
}

interface LootView {
  id: number; itemId: string; x: number; y: number;
  beam: Phaser.GameObjects.Image; halo: Phaser.GameObjects.Image; icon: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse; label: Phaser.GameObjects.Text; light: Phaser.GameObjects.Light | null; born: number;
  /** Fate's Blessing: prismatic presentation (core beam, rainbow ring, sparkles) */
  prism: boolean; core: Phaser.GameObjects.Image | null;
}

/** 'cursebound:blessing' window event: a hero took a blessing, or blessed a card (who = their name). */
export interface BlessingUiEvent { kind: 'pickup' | 'apply'; slot: number; mine: boolean; who?: string; card?: string }

export interface LegendaryUiEvent { kind: 'drop' | 'equip' | 'carry'; itemId: string; slot?: number; replaced?: string; mine: boolean; who?: string }

const PERK_COLOR: Record<string, number> = {
  fifth_shockwave: 0xffd23f, bell_toll: 0xd8b070, thorns_nova: 0x8ad05a, gravity_well: 0x9a7aff, orbiting_blades: 0xe0e0ff,
  pyre_explosion: 0xff6a2a, dodge_shade: 0xb08aff, signature_meteor: 0xff8a3a, aegis_release: 0xffc860, arc_thunderclap: 0x9fd8ff,
  phase_burst: 0xd7a8ff, crit_lightning: 0x9fd8ff, cheat_death: 0xffe8a0, phantom_sweep: 0xff8a7a, last_stand_banner: 0xffd23f,
  plague_spread: 0x9ac040, potion_plus: 0xff7a6a, dodge_ward: 0xc8eaff, signature_refresh: 0xf0c060, free_charge: 0xc0c0ff,
  empowered_ready: 0xffe08a, empowered_skill: 0xffe08a, meteor_call: 0xff8a3a,
};

const PERK_SFX: Record<string, SfxId> = {
  fifth_shockwave: 'signature_slam', bell_toll: 'skill_guard', crit_lightning: 'skill_arc', cheat_death: 'player_revived', signature_meteor: 'signature_slam',
  dodge_shade: 'signature_nova', aegis_release: 'signature_slam', arc_thunderclap: 'skill_arc', phase_burst: 'signature_nova', empowered_ready: 'level_up',
  gravity_well: 'skill_phase', last_stand_banner: 'skill_rally', thorns_nova: 'skill_sweep',
};

// Hazard looks for the delayed perk effects (gear.ts 'lg_*' hazards).
registerHazardFx({
  lg_shade: (ctx, g, h, tick) => {
    const c = ctx.P(h.x, h.y);
    const prog = Math.max(0, Math.min(1, (tick - h.b) / Math.max(1, h.u - 1 - h.b)));
    const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
    g.fillStyle(0x6a4ad0, 0.12 + 0.18 * prog).fillEllipse(Math.round(c.x), Math.round(c.y), rx * 2, ry * 2);
    g.lineStyle(2, 0xd7a8ff, 0.5 + 0.5 * prog).strokeEllipse(Math.round(c.x), Math.round(c.y), rx * 2 * prog, ry * 2 * prog);
    // the shade itself: a dark figure flickering on the spot
    g.fillStyle(0x1a1030, 0.75).fillRect(Math.round(c.x) - 4, Math.round(c.y) - 26, 8, 22);
    g.fillStyle(0xb08aff, 0.9).fillRect(Math.round(c.x) - 2, Math.round(c.y) - 22, 1, 1).fillRect(Math.round(c.x) + 1, Math.round(c.y) - 22, 1, 1);
  },
  lg_meteor: (ctx, g, h, tick) => {
    const c = ctx.P(h.x, h.y);
    const prog = Math.max(0, Math.min(1, (tick - h.b) / Math.max(1, h.u - 1 - h.b)));
    const rx = ctx.rx(h.r), ry = ctx.ry(h.r);
    g.fillStyle(0xff5a1a, 0.12 + 0.2 * prog).fillEllipse(Math.round(c.x), Math.round(c.y), rx * 2, ry * 2);
    g.lineStyle(2, 0xffc070, 0.9).strokeEllipse(Math.round(c.x), Math.round(c.y), rx * 2, ry * 2);
    g.lineStyle(2, 0xff8a3a, 0.9).strokeEllipse(Math.round(c.x), Math.round(c.y), rx * 2 * (1 - prog), ry * 2 * (1 - prog));
    // falling rock
    const fy = Math.round(c.y - 220 * (1 - prog));
    g.fillStyle(0xffc070, 1).fillRect(Math.round(c.x) - 4, fy - 4, 8, 8);
    g.fillStyle(0xff5a1a, 0.8).fillRect(Math.round(c.x) - 2, fy - 16, 4, 12);
  },
  lg_phantom: () => undefined,
}, { lg_shade: 0x8a6aff, lg_meteor: 0xff8a3a });

export class LootRenderer {
  private views = new Map<number, LootView>();
  private fx: Phaser.GameObjects.Graphics;
  private bolts: { pts: { x: number; y: number }[]; until: number; color: number }[] = [];
  private blades = new Map<number, { x: number; y: number }>();
  private sparks = new PrismSparkles();
  private ringG: Phaser.GameObjects.Graphics;
  private lastNow = 0;
  private sparkAt = 0;
  /** ground blessings this frame: two rainbow ribbons wind up their pillar (drawn over actors in drawFx) */
  private helix: { x: number; y: number; h: number }[] = [];
  private pointer = { x: 0, y: 0, inside: false };
  private hoverId: number | null = null;
  private handlers: [EventTarget, string, EventListener][] = [];

  constructor(private scene: LootHost) {
    this.ensureTextures();
    this.fx = scene.add.graphics().setDepth(4720);
    this.ringG = scene.add.graphics().setDepth(-57);
    const el = scene.game?.canvas;
    if (el) {
      const on = (t: EventTarget, ev: string, fn: EventListener) => { t.addEventListener(ev, fn); this.handlers.push([t, ev, fn]); };
      on(el, 'pointermove', ((e: PointerEvent) => { const r = el.getBoundingClientRect(); this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top, inside: true }; }) as EventListener);
      on(el, 'pointerleave', (() => { this.pointer.inside = false; }) as EventListener);
    }
  }

  private ensureTextures() {
    const tx = this.scene.textures;
    if (!tx.exists('lg:beam')) {
      // stepped (pixel) falloff: bright core, two softer side bands, fading upward in 8px bands
      const w = 24, h = 200;
      const c = tx.createCanvas('lg:beam', w, h)!;
      const g = c.getContext();
      const cols: [number, number, number][] = [[10, 4, 1], [7, 10, 0.5], [3, 18, 0.22]];
      for (let y = 0; y < h; y += 8) {
        const fade = Math.min(1, (y / h) * 1.6);   // top transparent -> bottom bright
        for (const [x0, cw, a] of cols.slice().reverse()) {
          g.fillStyle = `rgba(255,255,255,${(a * fade).toFixed(3)})`;
          g.fillRect(x0, y, cw, 8);
        }
      }
      c.refresh();
    }
    if (!tx.exists('lg:halo')) {
      const c = tx.createCanvas('lg:halo', 48, 24)!;
      const g = c.getContext();
      for (const [rx, ry, a] of [[24, 12, 0.18], [17, 8, 0.32], [10, 5, 0.6]] as const) {
        g.fillStyle = `rgba(255,255,255,${a})`;
        g.beginPath(); g.ellipse(24, 12, rx, ry, 0, 0, Math.PI * 2); g.fill();
      }
      c.refresh();
    }
  }

  /** Fate's Blessing icon: 12 frames of the prismatic star, hue rotated a step per frame. */
  private prismIconKey(): string {
    const key = 'lgicon:fates_blessing:prism';
    if (this.scene.textures.exists(key)) return key;
    const N = 12;
    const c = this.scene.textures.createCanvas(key, 16 * N, 16)!;
    const g = c.getContext();
    for (let f = 0; f < N; f++) blessingPixels(f / N).forEach((row, y) => row.forEach((col, x) => { if (col) { g.fillStyle = col; g.fillRect(f * 16 + x, y, 1, 1); } }));
    c.refresh();
    for (let f = 0; f < N; f++) c.add(f, 0, f * 16, 0, 16, 16);
    return key;
  }

  private iconKey(itemId: string): string {
    const key = `lgicon:${itemId}`;
    if (this.scene.textures.exists(key)) return key;
    const c = this.scene.textures.createCanvas(key, 16, 16)!;
    const g = c.getContext();
    itemIconPixels(itemId).forEach((row, y) => row.forEach((col, x) => { if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); } }));
    c.refresh();
    return key;
  }

  /** `file`: a recorded file (audio/fileCues) played instead of `id` when it exists */
  private sfx(id: SfxId, x: number, y: number, priority = 1, file?: string) {
    const a = this.scene.audio;
    if (!a) return;
    const cam = this.scene.cameras.main;
    const pan = Math.max(-1, Math.min(1, (iso.x(x, y) - cam.midPoint.x) / (this.scene.scale.width / 2)));
    if (file) a.playFile(file, id, { pan, priority });
    else a.play(id, { pan, priority });
  }

  private make(id: number, itemId: string, x: number, y: number): LootView {
    const s = this.scene;
    const p = iso.p(x, y);
    const prism = itemId === FATES_BLESSING.id;
    const name = prism ? FATES_BLESSING.name : LEGENDARY_BY_ID[itemId]?.name ?? itemId;
    const beam = s.add.image(p.x, p.y, 'lg:beam').setOrigin(0.5, 1).setBlendMode(prism ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD).setTint(ORANGE).setAlpha(0.7);
    const halo = s.add.image(p.x, p.y, 'lg:halo').setBlendMode(Phaser.BlendModes.ADD).setTint(ORANGE).setAlpha(0.8);
    const shadow = s.add.ellipse(p.x, p.y, 18, 7, 0x000000, 0.5).setDepth(-58);
    const icon = s.add.image(p.x, p.y - 14, prism ? this.prismIconKey() : this.iconKey(itemId), 0).setScale(2).setOrigin(0.5, 1);
    const label = s.add.text(p.x, p.y - 52, name, { fontFamily: FONT_WORLD, fontSize: `${WORLD_TEXT_PX.label}px`, color: '#ff8a1e', stroke: '#070505', strokeThickness: 3, resolution: 1 }).setOrigin(0.5, 1).setDepth(4800);
    // the blessing's pillar has a narrow white-hot core inside the wheeling colour
    const core = prism ? s.add.image(p.x, p.y, 'lg:beam').setOrigin(0.5, 1).setBlendMode(Phaser.BlendModes.ADD).setScale(0.45, 1).setAlpha(0.6) : null;
    let light: Phaser.GameObjects.Light | null = null;
    if (this.scene.dungeon.lighting && this.scene.lights && (this.views.size < 4 || prism)) light = this.scene.lights.addLight(p.x, p.y - 20, prism ? 170 : 130, ORANGE, prism ? 2 : 1.7);
    return { id, itemId, x, y, beam, halo, icon, shadow, label, light, born: s.time.now, prism, core };
  }

  private destroyView(v: LootView) {
    v.beam.destroy(); v.halo.destroy(); v.icon.destroy(); v.shadow.destroy(); v.label.destroy(); v.core?.destroy();
    if (v.light) this.scene.lights?.removeLight(v.light);
    if (v.prism) this.sparks.forget(v.id);
  }

  private emitUi(detail: LegendaryUiEvent) {
    window.dispatchEvent(new CustomEvent('cursebound:legendary', { detail }));
  }

  private onEvent(e: SimEvent, snap: Snapshot | null, me: number) {
    const J = this.scene.juice;
    if (e.t === 'blessing') { this.blessingFx(e, snap, me); return; }
    if (e.t === 'loot' && e.itemId === FATES_BLESSING.id && e.src !== 'carry') {
      // a blessing drops: a rainbow pop instead of the orange one
      const p = iso.p(e.x, e.y);
      this.sfx('fate_blessing', e.x, e.y, 9);
      for (let k = 0; k < 3; k++) J.ring(p.x, p.y, iso.rx(0.7 + k * 0.6), prismColor(this.scene.time.now, k / 3), 420 + k * 120);
      this.sparks.burst(p.x, p.y - 14, 40, 22, 60);
      this.scene.dungeon.flashLight(p.x, p.y - 20, 280, prismColor(this.scene.time.now), 2.8, 800);
      this.emitUi({ kind: 'drop', itemId: e.itemId, mine: false });
      return;
    }
    if (e.t === 'loot') {
      const p = iso.p(e.x, e.y);
      if (e.src === 'carry') {
        J.ring(p.x, p.y, 28, ORANGE, 260);
        this.emitUi({ kind: 'carry', itemId: e.itemId, mine: false });
        return;
      }
      this.sfx('legendary_drop', e.x, e.y, 9);
      J.ring(p.x, p.y, iso.rx(1.6), ORANGE, 520);
      J.ring(p.x, p.y, iso.rx(0.8), ORANGE_HI, 320);
      J.embersAt(p.x, p.y - 10, 18, ORANGE);
      J.sparksAt(p.x, p.y - 16, 12, ORANGE_HI);
      this.scene.dungeon.flashLight(p.x, p.y - 20, 260, ORANGE, 2.6, 700);
      if (e.src === 'boss') J.shake(0.006, 160);
      this.emitUi({ kind: 'drop', itemId: e.itemId, mine: false });
    } else if (e.t === 'equip') {
      const pl = snap?.players[e.slot];
      const x = pl?.x ?? e.x, y = pl?.y ?? e.y;
      const p = iso.p(x, y);
      this.sfx('legendary_equip', x, y, e.slot === me ? 7 : 3);
      J.ring(p.x, p.y, iso.rx(1.4), ORANGE, 420);
      J.embersAt(p.x, p.y - 16, 22, ORANGE);
      J.sparksAt(p.x, p.y - 20, 10, ORANGE_HI);
      this.scene.dungeon.flashLight(p.x, p.y - 20, 200, ORANGE, 2.2, 500);
      this.emitUi({ kind: 'equip', itemId: e.itemId, slot: e.slot, replaced: e.replaced, mine: e.slot === me, who: pl?.n });
    } else if (e.t === 'perk') {
      this.perkFx(e, me);
    }
  }

  /** Fate's Blessing taken (rainbow burst at the hero) or spent on a card (at its door; Doors.ts adds the shimmer). */
  private blessingFx(e: Extract<SimEvent, { t: 'blessing' }>, snap: Snapshot | null, me: number) {
    const J = this.scene.juice;
    const now = this.scene.time.now;
    const pl = snap?.players[e.slot];
    const mine = e.slot === me;
    const at = e.op === 'pickup' && pl ? iso.p(pl.x, pl.y) : iso.p(e.x, e.y);
    this.sfx('fate_blessing', e.x, e.y, mine ? 8 : 4, e.op === 'apply' ? 'blessing_apply' : undefined);   // lifting a card's curse has its own take
    const rings = e.op === 'apply' ? 5 : 3;
    for (let k = 0; k < rings; k++) J.ring(at.x, at.y, iso.rx(0.6 + k * 0.55), prismColor(now, k / rings), 360 + k * 110);
    this.sparks.burst(at.x, at.y - (e.op === 'apply' ? 40 : 16), e.op === 'apply' ? 70 : 34, e.op === 'apply' ? 30 : 16, e.op === 'apply' ? 80 : 50);
    this.scene.dungeon.flashLight(at.x, at.y - 24, e.op === 'apply' ? 320 : 200, prismColor(now, 0.3), e.op === 'apply' ? 3 : 2.2, e.op === 'apply' ? 1000 : 500);
    if (mine && e.op === 'apply') J.flash(0xffffff, 90);
    const offer = netStore.get().offer;
    const card = e.card !== undefined ? CARD_BY_ID[offer?.cardIds[e.card] ?? '']?.name : undefined;
    window.dispatchEvent(new CustomEvent('cursebound:blessing', { detail: { kind: e.op, slot: e.slot, mine, who: pl?.n, card } satisfies BlessingUiEvent }));
  }

  private perkFx(e: Extract<SimEvent, { t: 'perk' }>, me: number) {
    const J = this.scene.juice;
    const col = PERK_COLOR[e.perk] ?? ORANGE;
    const p = iso.p(e.x, e.y);
    const mine = e.slot === me;
    const sfx = PERK_SFX[e.perk];
    if (sfx && (mine || e.perk === 'cheat_death')) this.sfx(sfx, e.x, e.y, mine ? 3 : 1);
    switch (e.perk) {
      case 'crit_lightning': {
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i <= 6; i++) pts.push({ x: Math.round(p.x + (i === 0 || i === 6 ? 0 : (Math.random() - 0.5) * 14)), y: Math.round(p.y - 14 - 180 * (1 - i / 6)) });
        this.bolts.push({ pts, until: this.scene.time.now + 140, color: col });
        J.sparksAt(p.x, p.y - 14, 10, col);
        if (e.r) J.ring(p.x, p.y, iso.rx(e.r), col, 200);
        this.scene.dungeon.flashLight(p.x, p.y - 40, 180, col, 2.4, 160);
        break;
      }
      case 'plague_spread': {
        if (e.tx === undefined || e.ty === undefined) break;
        const t = iso.p(e.tx, e.ty);
        this.bolts.push({ pts: [{ x: p.x, y: p.y - 10 }, { x: (p.x + t.x) / 2, y: Math.min(p.y, t.y) - 24 }, { x: t.x, y: t.y - 10 }], until: this.scene.time.now + 260, color: col });
        break;
      }
      case 'meteor_call':
        break;   // the target circle is the lg_meteor hazard
      case 'phantom_sweep': {
        if (e.tx === undefined || e.ty === undefined) break;
        const u = iso.unit(e.tx - e.x, e.ty - e.y);
        J.arc(p.x + u.x * 20, p.y - 14 + u.y * 20, Math.atan2(u.y, u.x), col, 1.6);
        break;
      }
      case 'orbiting_blades':
        J.sparksAt(p.x, p.y - 12, 4, col);
        break;
      case 'empowered_ready': case 'empowered_skill': case 'free_charge': case 'dodge_ward': case 'potion_plus': case 'signature_refresh':
        J.embersAt(p.x, p.y - 16, 10, col);
        J.ring(p.x, p.y, 22, col, 260);
        break;
      case 'cheat_death':
        J.ring(p.x, p.y, iso.rx(2.2), col, 600);
        J.ring(p.x, p.y, iso.rx(1.2), 0xffffff, 380);
        J.embersAt(p.x, p.y - 16, 30, col);
        this.scene.dungeon.flashLight(p.x, p.y - 20, 260, col, 3, 700);
        if (mine) {
          J.flash(0xffe8a0, 120);
          window.dispatchEvent(new CustomEvent('cursebound:banner', { detail: { text: 'Deathless Vow', tone: 'good' } }));
        }
        break;
      default: {
        // novas: a ground shockwave sized to the effect radius
        const r = e.r ?? 2;
        J.ring(p.x, p.y, iso.rx(r), col, 360);
        J.ring(p.x, p.y, iso.rx(r * 0.6), 0xffffff, 220);
        if (e.perk === 'pyre_explosion' || e.perk === 'signature_meteor') { J.embersAt(p.x, p.y - 10, 24, col); J.dust(p.x, p.y, 10, 0x5a3a2a); }
        else J.sparksAt(p.x, p.y - 12, 10, col);
        this.scene.dungeon.flashLight(p.x, p.y - 16, Math.max(120, iso.rx(r) * 2), col, 2, 260);
        if (mine && (e.perk === 'signature_meteor' || e.perk === 'aegis_release' || e.perk === 'fifth_shockwave')) J.shake(0.006, 120);
      }
    }
  }

  /** Call once per frame with the newest snapshot and the not-yet-consumed event queue (read-only). */
  update(snap: Snapshot | null, events: readonly SimEvent[]) {
    const me = netStore.get().slot;
    for (const e of events) if (e.t === 'loot' || e.t === 'equip' || e.t === 'perk' || e.t === 'blessing') this.onEvent(e, snap, me);
    const now = this.scene.time.now;
    const dtMs = Math.min(100, Math.max(0, now - (this.lastNow || now)));
    this.lastNow = now;
    this.ringG.clear();
    const list = snap?.lt ?? [];
    const seen = new Set<number>();
    for (const it of list) {
      seen.add(it.i);
      let v = this.views.get(it.i);
      if (!v) { v = this.make(it.i, it.it, it.x, it.y); this.views.set(it.i, v); }
      const p = iso.p(it.x, it.y);
      const px = Math.round(p.x), py = Math.round(p.y);
      const depth = iso.depth(it.x, it.y);
      const age = (now - v.born) / 1000;
      const grow = Math.min(1, age * 3);
      const pulse = 0.5 + 0.5 * Math.sin(now / 260 + it.i);
      v.beam.setPosition(px, py).setDepth(depth + 2).setAlpha(0.55 + 0.25 * pulse).setScale(1 + 0.08 * pulse, grow);
      v.halo.setPosition(px, py).setDepth(depth + 1).setAlpha(0.6 + 0.3 * pulse);
      v.shadow.setPosition(px, py);
      v.icon.setPosition(px, py - 10 - Math.round(3 + 3 * Math.sin(now / 320 + it.i))).setDepth(depth + 3);
      v.label.setPosition(px, py - 44 - Math.round(2 * Math.sin(now / 320 + it.i)));
      if (v.light) { v.light.x = px; v.light.y = py - 20; v.light.intensity = 1.4 + 0.5 * pulse; }
      if (v.prism) this.prismFrame(v, px, py, now, dtMs, grow, pulse);
    }
    this.updateHover(list);
    for (const [id, v] of this.views) if (!seen.has(id)) { this.destroyView(v); this.views.delete(id); }
    this.drawFx(snap, now);
  }

  /** Per frame for a ground blessing: wheel the beam, halo, light and name through the hues; ring and sparkles. */
  private prismFrame(v: LootView, px: number, py: number, now: number, dtMs: number, grow: number, pulse: number) {
    const c0 = prismColor(now, 0), c1 = prismColor(now, 0.33), c2 = prismColor(now, 0.66);
    const s0 = prismColor(now, 0, 1), s2 = prismColor(now, 0.5, 1);
    v.beam.setTint(s0, s0, s2, s2).setAlpha(0.5 + 0.2 * pulse);
    v.halo.setTint(c1).setAlpha(0.75 + 0.25 * pulse);
    // a puddle of wheeling colour round its feet (normal blend, so it reads on bright cobbles) and two turning rings
    const g = this.ringG;
    for (let k = 0; k < 3; k++) {
      const sc = 1 - k * 0.28;
      g.fillStyle(prismColor(now, k * 0.22, 0.9), 0.22 + k * 0.1).fillEllipse(px, py, iso.rx(0.95 * sc) * 2, iso.ry(0.95 * sc) * 2);
    }
    prismRing(g, px, py, iso.rx(1.02 + 0.05 * pulse), iso.ry(1.02 + 0.05 * pulse), now, 0.95, 3, 24);
    prismRing(g, px, py, iso.rx(0.6), iso.ry(0.6), -now, 0.8, 2, 12);
    this.helix.push({ x: px, y: py, h: 70 * grow });
    if (v.core) v.core.setPosition(px, py).setDepth(v.beam.depth + 0.1).setScale(0.45, grow).setAlpha(0.45 + 0.3 * pulse);
    v.icon.setFrame(Math.floor(now / 110) % 12);
    const hex = `#${c0.toString(16).padStart(6, '0')}`;
    if (v.label.style.color !== hex) v.label.setColor(hex);
    if (v.light) { v.light.setColor(c2); v.light.intensity = 1.8 + 0.7 * pulse; }
    this.sparks.stream(v.id, px, py - 24, gfx().softGlow ? 40 : 18, dtMs / 1000, 10);
  }

  /** Which ground item the pointer is over (its beam, icon or the spot at its feet), announced for the quick-compare. */
  private updateHover(list: readonly { i: number; x: number; y: number }[]) {
    let hit: number | null = null;
    if (this.pointer.inside && list.length) {
      const cam = this.scene.cameras.main;
      const k = this.scene.game.canvas.clientWidth / this.scene.scale.width || 1;
      const mx = this.pointer.x / k + cam.scrollX, my = this.pointer.y / k + cam.scrollY;
      let bd = Infinity;
      for (const it of list) {
        const p = iso.p(it.x, it.y);
        const onIcon = Math.abs(mx - p.x) <= 14 && my <= p.y + 8 && my >= p.y - 56;
        const onSpot = ((mx - p.x) / iso.rx(0.7)) ** 2 + ((my - p.y) / iso.ry(0.7)) ** 2 <= 1;
        const d = Math.abs(mx - p.x) + Math.abs(my - p.y + 20);
        if ((onIcon || onSpot) && d < bd) { bd = d; hit = it.i; }
      }
    }
    if (hit !== this.hoverId) {
      this.hoverId = hit;
      window.dispatchEvent(new CustomEvent('cursebound:loothover', { detail: { id: hit } }));
    }
  }

  private drawFx(snap: Snapshot | null, now: number) {
    const g = this.fx.clear();
    for (const hx of this.helix) for (let k = 0; k < 14; k++) for (const strand of [0, Math.PI]) {
      const t = k / 14, a = now / 260 + t * Math.PI * 3 + strand;
      const x = Math.round(hx.x + Math.cos(a) * (9 - t * 4)), y = Math.round(hx.y - 6 - t * hx.h);
      g.fillStyle(prismColor(now, t + strand / 6.28, 0.85), Math.sin(a) > 0 ? 0.95 : 0.45).fillRect(x, y, 2, 2);
    }
    this.helix = [];
    this.sparks.draw(g, now, Math.min(100, Math.max(0, now - (this.sparkAt || now))));
    this.sparkAt = now;
    this.bolts = this.bolts.filter((b) => b.until > now);
    for (const b of this.bolts) {
      g.lineStyle(3, b.color, 0.5);
      g.strokePoints(b.pts, false);
      g.lineStyle(1, 0xffffff, 1);
      g.strokePoints(b.pts, false);
    }
    // Cuirass of Seven Blades: three spectral blades circling the wearer
    const seen = new Set<number>();
    for (const pl of snap?.players ?? []) {
      if (pl.life !== 'alive' || !pl.gr?.includes('lg_cuirass_of_seven_blades')) continue;
      seen.add(pl.s);
      const prev = this.blades.get(pl.s) ?? { x: pl.x, y: pl.y };
      const k = 0.35;
      const cur = { x: prev.x + (pl.x - prev.x) * k, y: prev.y + (pl.y - prev.y) * k };
      this.blades.set(pl.s, cur);
      const c = iso.p(cur.x, cur.y);
      for (let i = 0; i < 3; i++) {
        const a = now / 280 + (i * Math.PI * 2) / 3;
        const bx = Math.round(c.x + Math.cos(a) * iso.rx(1.2)), by = Math.round(c.y - 12 + Math.sin(a) * iso.ry(1.2));
        g.fillStyle(0xe0e0ff, 0.85).fillRect(bx - 1, by - 3, 2, 6);
        g.fillStyle(0xffffff, 1).fillRect(bx, by - 3, 1, 2);
      }
    }
    for (const s of [...this.blades.keys()]) if (!seen.has(s)) this.blades.delete(s);
  }

  destroy() {
    for (const v of this.views.values()) this.destroyView(v);
    this.views.clear();
    this.fx.destroy();
    this.ringG.destroy();
    for (const [t, ev, fn] of this.handlers) t.removeEventListener(ev, fn);
    this.handlers = [];
    if (this.hoverId !== null) window.dispatchEvent(new CustomEvent('cursebound:loothover', { detail: { id: null } }));
  }
}
