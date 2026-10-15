import * as Phaser from 'phaser';
import { LEGENDARY_BY_ID, MERCHANT, PACT_BY_ID, ROOM_EVENT_RULES, RUNNER_KIND, SHRINE_BY_ID, TREASURE_IMP, WARE_BY_ID } from '@cursebound/content';
import type { SimEvent, SnapEnemy, SnapRoomEvent, Snapshot } from '@cursebound/simulation';
import { ensureRoomEventArt } from '../art/roomEventArt';
import type { SfxId } from '../audio/AudioEngine';
import { gfx } from '../gfx';
import type { DungeonRenderer } from './DungeonRenderer';
import type { Juice } from './Juice';
import { iso } from './iso';
import { keyCap, settingsStore } from '@/lib/settings';
import type { GameConnection } from '@/lib/net';
import { FONT_WORLD, WORLD_TEXT_PX } from '@/ui/fonts';

// Room events presentation (cosmetic only; simulation roomEvents.ts / coins.ts are the authority):
//   shrines   glowing carved obelisks (one colour per type) with a Light2D pool; spent shrines stand cold and dark
//   altar     a blood altar with guttering candles and a red pool of light; spent = candles out
//   merchant  a hooded pack-merchant breathing at his post, lantern swaying (door vote, or the training yard)
//   imp       the treasure imp (enemy kind RUNNER_KIND) is drawn here instead of the actor rigs: a sparkly sprite with a
//             gold glow and trail, a name and escape bar, the violet rift while it channels its escape
//   coins     cursed coin heaps (pickups of kind 'coin') that glint, drift to heroes and chink when collected
// Interact (key / pad) or a click on an event in reach uses it: a shrine sends EVENT at once; the altar and the
// merchant open their pixel panels (ui/RoomEvents.tsx) through the 'cursebound:roomevent' window event. A click out
// of reach walks there first ('cursebound:moveto') and uses it on arrival. The 'room_event' cues get bursts, banners
// (window 'cursebound:banner') and sounds. Never shakes the camera.

export type RoomSfx = (id: SfxId, x?: number, y?: number, priority?: number) => void;

/** 'cursebound:roomevent' window event: open the altar / merchant panel for event `id`. */
export interface RoomEventOpen { kind: 'altar' | 'merchant'; id: number }

const SHRINE_GLOW: Record<string, number> = { fury: 0xff6a3a, haste: 0x5ae0ff, warding: 0x9fb4ff, fortune: 0xffd23f, renewal: 0x6aff8a };
const GOLD = 0xffd23f;
const VIOLET = 0x9a5aff;
const BLOOD = 0xc0182a;
/** client prompt reach (a little inside the authority's useRange, so prediction drift never shows a dead prompt) */
const PROMPT_R = ROOM_EVENT_RULES.useRange - 0.25;

interface EvView {
  k: SnapRoomEvent['k']; t: string; x: number; y: number; used: boolean;
  spr: Phaser.GameObjects.Sprite; shadow: Phaser.GameObjects.Ellipse;
  glow: Phaser.GameObjects.Image | null; light: Phaser.GameObjects.Light | null; lastMote: number;
}

interface ImpView {
  spr: Phaser.GameObjects.Sprite; shadow: Phaser.GameObjects.Ellipse; glow: Phaser.GameObjects.Image | null;
  portal: Phaser.GameObjects.Sprite | null; label: Phaser.GameObjects.Text; bar: Phaser.GameObjects.Graphics;
  light: Phaser.GameObjects.Light | null; x: number; y: number; seen: number; lastSpark: number; lastJingle: number; anim: string;
}

interface CoinView { spr: Phaser.GameObjects.Sprite; shadow: Phaser.GameObjects.Ellipse; x: number; y: number; seen: number; value: number; lastGlint: number }

export function usableEvent(e: SnapRoomEvent, phase: string): boolean {
  if (e.k === 'shrine') return !e.u && phase === 'COMBAT';
  if (e.k === 'altar') return !e.u && (phase === 'COMBAT' || phase === 'VOTING');
  if (e.k === 'merchant') return phase === 'COMBAT' || phase === 'VOTING';
  return false;
}

export function eventName(e: Pick<SnapRoomEvent, 'k' | 't'>): string {
  if (e.k === 'shrine') return SHRINE_BY_ID[e.t]?.name ?? 'Shrine';
  if (e.k === 'altar') return 'Cursed Altar';
  if (e.k === 'merchant') return MERCHANT.name;
  return TREASURE_IMP.name;
}

export class RoomEventRenderer {
  private views = new Map<number, EvView>();
  private imps = new Map<number, ImpView>();
  private coins = new Map<number, CoinView>();
  private collected = new Set<number>();
  private rev = new Map<number, SnapRoomEvent>();
  private phase = '';
  private frame = 0;
  private prompt: Phaser.GameObjects.Text;
  private near: SnapRoomEvent | null = null;
  /** clicked out of reach: walk there and use it on arrival (event id, ms deadline) */
  private pending: { id: number; until: number } | null = null;
  private lastCoinSfx = 0;

  constructor(private scene: Phaser.Scene, private juice: Juice, private dungeon: DungeonRenderer, private net: GameConnection, private sfx: RoomSfx) {
    ensureRoomEventArt(scene);
    this.prompt = scene.add.text(0, 0, '', { fontFamily: FONT_WORLD, fontSize: `${WORLD_TEXT_PX.label}px`, color: '#ffe8b0', stroke: '#070505', strokeThickness: 3, resolution: 1 })
      .setOrigin(0.5, 1).setDepth(4850).setVisible(false);
  }

  // ---------------- per frame ----------------

  /** Before the foes are drawn: index this snapshot's events (drawRunner reads the imps' timers). */
  begin(snap: Snapshot | null) {
    this.frame++;
    this.rev.clear();
    for (const e of snap?.rev ?? []) this.rev.set(e.i, e);
    this.phase = snap?.phase ?? '';
  }

  /** Draw a treasure imp in place of the actor rig. Returns false for every other foe. */
  drawRunner(e: SnapEnemy, x: number, y: number): boolean {
    if (e.k !== RUNNER_KIND) return false;
    const s = this.scene;
    let v = this.imps.get(e.i);
    if (!v) {
      const spr = s.add.sprite(0, 0, 'rev:imp:idle').setOrigin(0.5, 26 / 28);
      this.dungeon.litObject(spr);
      const glow = gfx().softGlow && s.textures.exists('light:soft') ? s.add.image(0, 0, 'light:soft').setBlendMode(Phaser.BlendModes.ADD).setTint(GOLD).setAlpha(0.35).setScale(0.22, 0.17) : null;
      const label = s.add.text(0, 0, TREASURE_IMP.name, { fontFamily: FONT_WORLD, fontSize: `${WORLD_TEXT_PX.label}px`, color: '#ffd36a', stroke: '#070505', strokeThickness: 3, resolution: 1 }).setOrigin(0.5, 1).setDepth(4600);
      const light = this.dungeon.lighting && s.lights ? s.lights.addLight(0, 0, 90, GOLD, 1.4) : null;
      v = { spr, shadow: s.add.ellipse(0, 0, 14, 5, 0x000000, 0.5).setDepth(-58), glow, portal: null, label, bar: s.add.graphics().setDepth(4600), light, x, y, seen: 0, lastSpark: 0, lastJingle: 0, anim: '' };
      this.imps.set(e.i, v);
    }
    v.seen = this.frame; v.x = x; v.y = y;
    const now = s.time.now;
    const info = this.rev.get(e.i);
    const q = iso.p(x, y);
    const px = Math.round(q.x), py = Math.round(q.y);
    const depth = iso.depth(x, y);
    const anim = info?.p ? 'rev:imp:portal' : e.st === 'move' ? 'rev:imp:run' : 'rev:imp:idle';
    if (v.anim !== anim && s.anims.exists(anim)) { v.anim = anim; v.spr.play({ key: anim, repeat: -1 }); }
    const sx = iso.dir(e.fx, e.fy).x;
    if (Math.abs(sx) > 0.05) v.spr.setFlipX(sx < 0);
    v.spr.setPosition(px, py).setDepth(depth).setVisible(e.st !== 'dying');
    if (e.flash && settingsStore.get().s.flashes) v.spr.setTintFill(0xffffff); else v.spr.clearTint();
    v.shadow.setPosition(px, py);
    v.glow?.setPosition(px, py - 12).setDepth(depth - 0.2).setAlpha(0.28 + 0.1 * Math.sin(now / 120));
    v.light?.setPosition(px, py - 10);
    // the rift opens behind it while it channels
    if (info?.p && !v.portal) {
      v.portal = s.add.sprite(px, py + 4, 'rev:portal').setOrigin(0.5, 1).setAlpha(0).setScale(0.3);
      if (s.anims.exists('rev:portal')) v.portal.play({ key: 'rev:portal', repeat: -1 });
      s.tweens.add({ targets: v.portal, alpha: 0.95, scale: 1, duration: 600, ease: 'Back.easeOut' });
    }
    v.portal?.setPosition(px + (v.spr.flipX ? 8 : -8), py + 4).setDepth(depth - 0.5);
    // name and escape timer
    const left = info?.l ?? 0;
    v.label.setPosition(px, py - 34).setVisible(e.st !== 'dying');
    v.bar.clear();
    if (e.st !== 'dying') {
      const w = 30, bx = px - w / 2, by = py - 33;
      v.bar.fillStyle(0x070505, 1).fillRect(bx - 1, by - 1, w + 2, 5);
      v.bar.fillStyle(0x3a2a10, 1).fillRect(bx, by, w, 3);
      v.bar.fillStyle(info?.p ? VIOLET : GOLD, 1).fillRect(bx, by, Math.round(w * (info?.p ? 1 : Math.min(1, left / ROOM_EVENT_RULES.runnerEscapeSec))), 2);
      v.bar.fillStyle(0xd6323c, 1).fillRect(bx, by + 2, Math.round(w * e.hp), 1);
    }
    // a trail of gold sparkles and a jingle as it runs
    if (!this.juice.low && now - v.lastSpark > (e.st === 'move' ? 70 : 200)) {
      v.lastSpark = now;
      this.juice.embersAt(px + (Math.random() - 0.5) * 10, py - 10 - Math.random() * 8, 1, Math.random() < 0.7 ? GOLD : 0xfff6c0);
    }
    if (e.st === 'move' && now - v.lastJingle > 1100) { v.lastJingle = now; this.sfx('imp_jingle', x, y, 1); }
    return true;
  }

  /** After the foes: room event props, coin heaps, the Interact prompt and walk-and-use. */
  update(snap: Snapshot | null, self: { x: number; y: number } | null, delta: number) {
    const s = this.scene;
    const now = s.time.now;
    // drop imps that left the snapshot (escaped or slain): fade the leftovers
    for (const [id, v] of this.imps) if (v.seen !== this.frame) { this.destroyImp(v); this.imps.delete(id); }
    if (!snap) { this.prompt.setVisible(false); return; }
    const live = new Set<number>();
    for (const e of snap.rev ?? []) {
      if (e.k === 'runner') continue;
      live.add(e.i);
      let v = this.views.get(e.i);
      const used = !!e.u;
      if (v && v.used !== used) { this.destroyView(v); this.views.delete(e.i); v = undefined; }
      if (!v) { v = this.makeView(e); this.views.set(e.i, v); }
      const dim = e.k === 'shrine' && snap.phase !== 'COMBAT' && !used;   // a shrine's power wanes once the fight is over
      v.spr.setAlpha(1);
      if (v.light) v.light.intensity = dim ? 0.5 : (v.k === 'merchant' ? 1.2 : 1.6) * (0.9 + 0.12 * Math.sin(now / 260 + e.i));
      v.glow?.setAlpha((dim ? 0.12 : 0.3) + 0.08 * Math.sin(now / 300 + e.i));
      if (!used && !dim && !this.juice.low && now - v.lastMote > 360) {
        v.lastMote = now;
        const q = iso.p(v.x, v.y);
        const col = v.k === 'shrine' ? SHRINE_GLOW[v.t] ?? GOLD : v.k === 'altar' ? BLOOD : 0xffc060;
        if (v.k !== 'merchant') this.juice.embersAt(q.x + (Math.random() - 0.5) * 12, q.y - (v.k === 'shrine' ? 40 : 18), 1, col);
      }
    }
    for (const [id, v] of this.views) if (!live.has(id)) { this.destroyView(v); this.views.delete(id); }
    this.drawCoins(snap, now, delta);
    // the nearest usable event in reach gets the Interact prompt
    this.near = null;
    if (self) {
      let bd = PROMPT_R * PROMPT_R;
      for (const e of snap.rev ?? []) {
        if (!usableEvent(e, snap.phase)) continue;
        const d2 = (e.x - self.x) ** 2 + (e.y - self.y) ** 2;
        if (d2 <= bd) { bd = d2; this.near = e; }
      }
    }
    const n = this.near;
    if (n) {
      const q = iso.p(n.x, n.y);
      const key = keyCap(settingsStore.get().s.keys.interact?.[0] ?? 'KeyG');
      const verb = n.k === 'merchant' ? 'Trade' : n.k === 'altar' ? 'Cursed Altar' : eventName(n);
      this.prompt.setText(`[${key}] ${verb}`).setPosition(Math.round(q.x), Math.round(q.y - (n.k === 'shrine' ? 58 : n.k === 'merchant' ? 58 : 44))).setVisible(true);
    } else this.prompt.setVisible(false);
    // walk-and-use: arrived in reach of the clicked event
    if (this.pending) {
      if (now > this.pending.until) this.pending = null;
      else if (n && n.i === this.pending.id) { this.pending = null; this.use(n); }
    }
  }

  /** Input from the scene's sampler: Interact pressed this frame, and a fresh primary click at a scene point. */
  input(interactPressed: boolean, click: { x: number; y: number } | null, self: { x: number; y: number } | null) {
    if (interactPressed && this.near) { this.use(this.near); return; }
    if (!click) return;
    // a click on an event's sprite: use it in reach, else walk there first
    for (const [id, v] of this.views) {
      const e = this.rev.get(id);
      if (!e || !usableEvent(e, this.phase)) continue;
      const b = v.spr.getBounds();
      if (click.x < b.x - 2 || click.x > b.right + 2 || click.y < b.y - 2 || click.y > b.bottom + 2) continue;
      if (self && (e.x - self.x) ** 2 + (e.y - self.y) ** 2 <= PROMPT_R * PROMPT_R) this.use(e);
      else {
        this.pending = { id, until: this.scene.time.now + 6000 };
        window.dispatchEvent(new CustomEvent('cursebound:moveto', { detail: { x: e.x, y: e.y } }));
      }
      return;
    }
  }

  private use(e: SnapRoomEvent) {
    if (e.k === 'shrine') this.net.roomEvent('shrine', e.i);
    else if (e.k === 'altar' || e.k === 'merchant') window.dispatchEvent(new CustomEvent<RoomEventOpen>('cursebound:roomevent', { detail: { kind: e.k, id: e.i } }));
  }

  // ---------------- events ----------------

  /** Cues this renderer owns ('room_event', coin pickups). Returns true when handled. */
  onEvent(e: SimEvent, me: number, snap: Snapshot | null): boolean {
    const J = this.juice;
    if (e.t === 'pickup' && e.kind === 'coin') {
      const p = snap?.players[e.slot];
      const tq = iso.p(p?.x ?? e.x, p?.y ?? e.y);
      const v = this.coins.get(e.id);
      const from = v ? { x: v.spr.x, y: v.spr.y - 4 } : (() => { const q = iso.p(e.x, e.y); return { x: q.x, y: q.y - 6 }; })();
      J.sparksAt(from.x, from.y, 6, GOLD);
      if (!J.reduced && this.scene.textures.exists('pfx:ember')) {
        const m = this.scene.add.image(from.x, from.y, 'pfx:ember').setTint(GOLD).setBlendMode(Phaser.BlendModes.ADD).setDepth(4700).setScale(1.4);
        this.scene.tweens.add({ targets: m, x: tq.x, y: tq.y - 20, scale: 0.4, duration: 240, ease: 'Cubic.easeIn', onComplete: () => m.destroy() });
      }
      const value = v?.value ?? 1;
      if (e.slot === me) J.number(tq.x, tq.y - 34, `+${value}`, '#ffd36a', 'sm');
      if (v) { this.destroyCoin(v); this.coins.delete(e.id); }
      this.collected.add(e.id);
      const now = this.scene.time.now;
      if (now - this.lastCoinSfx > 70) { this.lastCoinSfx = now; this.sfx('coin_pickup', e.x, e.y, e.slot === me ? 2 : 1); }
      return true;
    }
    if (e.t !== 'room_event') return false;
    const q = iso.p(e.x, e.y);
    const mine = e.slot === me;
    const who = e.slot >= 0 ? snap?.players[e.slot]?.n : undefined;
    switch (e.op) {
      case 'shrine': {
        const def = SHRINE_BY_ID[e.k ?? ''];
        const col = SHRINE_GLOW[e.k ?? ''] ?? GOLD;
        J.beam(q.x, q.y, 120, 18, col, 520);
        J.shockwave(q.x, q.y, iso.rx(3.2), col, 520);
        J.glyph(q.x, q.y, iso.rx(1.4), col, 700);
        J.embersAt(q.x, q.y - 40, 22, col);
        this.dungeon.flashLight(q.x, q.y - 30, 260, col, 2.6, 700);
        // every living hero lights up with the blessing
        for (const p of snap?.players ?? []) {
          if (p.life !== 'alive') continue;
          const pq = iso.p(p.x, p.y);
          J.orb(pq.x, pq.y - 18, col, 0.9, 360);
          J.ring(pq.x, pq.y, 22, col, 360);
        }
        this.banner(def?.name ?? 'Shrine', `${def?.short ?? ''}${who && !mine ? ` · ${who}` : ''}`, 'good');
        this.sfx('shrine_activate', e.x, e.y, 3);
        return true;
      }
      case 'altar': {
        const pact = PACT_BY_ID[e.k ?? ''];
        J.shockwave(q.x, q.y, iso.rx(2.6), BLOOD, 620);
        J.embersAt(q.x, q.y - 16, 26, 0xff3a2a);
        J.bits('skull', q.x, q.y - 22, 3, 0xe8d8c0);
        this.dungeon.flashLight(q.x, q.y - 16, 220, BLOOD, 2.8, 900);
        const p = snap?.players[e.slot];
        if (p) { const pq = iso.p(p.x, p.y); J.orb(pq.x, pq.y - 18, BLOOD, 1.1, 480); J.bleed('pursuer', pq.x, pq.y - 14, 8); }
        this.banner(pact?.name ?? 'A pact is sealed', who && !mine ? `${who} made a pact` : 'Bound for the run', 'danger');
        this.sfx('altar_pact', e.x, e.y, 3);
        return true;
      }
      case 'buy': {
        J.sparksAt(q.x, q.y - 24, 12, GOLD);
        J.ring(q.x, q.y, 24, GOLD, 300);
        if (mine) {
          const item = e.k ? LEGENDARY_BY_ID[e.k] : undefined;
          J.number(q.x, q.y - 54, item ? item.name : WARE_BY_ID[e.k ?? '']?.name ?? 'Bought', '#ffd36a', 'sm');
        }
        this.sfx('merchant_buy', e.x, e.y, mine ? 3 : 1);
        return true;
      }
      case 'merchant':
        J.dust(q.x, q.y, 6, 0x4a3a30);
        J.ring(q.x, q.y, 26, 0xffc060, 360);
        this.banner(MERCHANT.name, 'Wares for cursed coins — walk up and trade', 'info');
        this.sfx('merchant_buy', e.x, e.y, 1);
        return true;
      case 'runner':
        J.ring(q.x, q.y, 30, GOLD, 420);
        J.sparksAt(q.x, q.y - 12, 16, GOLD);
        this.banner('A Treasure Imp!', 'Catch it before it escapes', 'good');
        this.sfx('imp_jingle', e.x, e.y, 4);
        window.dispatchEvent(new CustomEvent('cursebound:caption', { detail: 'Treasure imp spotted' }));
        return true;
      case 'portal':
        J.glyph(q.x, q.y, iso.rx(1.1), VIOLET, 900);
        this.sfx('imp_portal', e.x, e.y, 3);
        return true;
      case 'escape':
        J.shockwave(q.x, q.y, iso.rx(1.6), VIOLET, 380);
        J.bits('star', q.x, q.y - 16, 10, 0xd8b8ff);
        J.orb(q.x, q.y - 16, VIOLET, 1.2, 300, 0.2);
        this.banner('The imp escaped', 'Its treasure is gone', 'info');
        this.sfx('portal_enter', e.x, e.y, 2);
        return true;
      case 'shower':
        J.beam(q.x, q.y, 110, 16, GOLD, 600);
        J.starburst(q.x, q.y - 14, 0xfff6c0, 1.8, 260);
        J.sparksAt(q.x, q.y - 14, 26, GOLD);
        J.bits('star', q.x, q.y - 18, 14, GOLD);
        this.dungeon.flashLight(q.x, q.y - 14, 260, GOLD, 2.6, 700);
        this.banner('Treasure!', who ? `${who} caught the imp` : 'The imp bursts open', 'good');
        this.sfx('chest_open', e.x, e.y, 3);
        return true;
    }
    return false;
  }

  private banner(text: string, sub: string, tone: 'good' | 'danger' | 'info') {
    window.dispatchEvent(new CustomEvent('cursebound:banner', { detail: { text, sub, tone } }));
  }

  // ---------------- views ----------------

  private makeView(e: SnapRoomEvent): EvView {
    const s = this.scene;
    const q = iso.p(e.x, e.y);
    const used = !!e.u;
    const key = e.k === 'shrine' ? `rev:shrine:${s.textures.exists(`rev:shrine:${e.t}`) ? e.t : 'fury'}${used ? ':dark' : ''}` : e.k === 'altar' ? `rev:altar${used ? ':dark' : ''}` : 'rev:merchant';
    const oy = e.k === 'altar' ? 37 / 40 : 49 / 52;
    const spr = s.add.sprite(Math.round(q.x), Math.round(q.y), key).setOrigin(0.5, oy).setDepth(iso.depth(e.x, e.y));
    if (s.anims.exists(key)) spr.play({ key, repeat: -1, startFrame: e.i % 4 });
    this.dungeon.litObject(spr);
    if (e.k === 'merchant') spr.setFlipX(false);
    const col = e.k === 'shrine' ? SHRINE_GLOW[e.t] ?? GOLD : e.k === 'altar' ? BLOOD : 0xffb040;
    const glow = !used && gfx().softGlow && s.textures.exists('light:soft')
      ? s.add.image(Math.round(q.x), Math.round(q.y) - (e.k === 'shrine' ? 40 : e.k === 'altar' ? 14 : 30), 'light:soft').setBlendMode(Phaser.BlendModes.ADD).setTint(col).setAlpha(0.3).setScale(e.k === 'altar' ? 0.3 : 0.24, e.k === 'altar' ? 0.2 : 0.2).setDepth(iso.depth(e.x, e.y) + 0.1)
      : null;
    const light = !used && this.dungeon.lighting && s.lights ? s.lights.addLight(Math.round(q.x), Math.round(q.y) - 26, e.k === 'merchant' ? 120 : 150, col, 1.6) : null;
    const shadow = s.add.ellipse(Math.round(q.x), Math.round(q.y), e.k === 'altar' ? 36 : 24, e.k === 'altar' ? 12 : 9, 0x000000, 0.45).setDepth(-58);
    return { k: e.k, t: e.t, x: e.x, y: e.y, used, spr, shadow, glow, light, lastMote: 0 };
  }

  private drawCoins(snap: Snapshot, now: number, delta: number) {
    const seen = new Set<number>();
    for (const pk of snap.pickups ?? []) {
      if (pk.k !== 'coin' || this.collected.has(pk.i)) continue;
      seen.add(pk.i);
      let v = this.coins.get(pk.i);
      if (!v) {
        const spr = this.scene.add.sprite(0, 0, 'rev:coin').setOrigin(0.5, 0.8);
        if (this.scene.anims.exists('rev:coin')) spr.play({ key: 'rev:coin', repeat: -1, startFrame: pk.i % 4 });
        v = { spr, shadow: this.scene.add.ellipse(0, 0, 12, 4, 0x000000, 0.45).setDepth(-58), x: pk.x, y: pk.y, seen: now, value: pk.t, lastGlint: now };
        this.coins.set(pk.i, v);
      }
      v.value = pk.t;
      const k = Math.min(1, delta / 55);
      v.x += (pk.x - v.x) * k; v.y += (pk.y - v.y) * k;
      const q = iso.p(v.x, v.y);
      const age = now - v.seen;
      const pop = age < 300 ? Math.sin((age / 300) * Math.PI) * 14 : 0;
      const scale = pk.t >= 5 ? 1.3 : pk.t >= 3 ? 1.1 : 0.85;
      v.spr.setPosition(Math.round(q.x), Math.round(q.y - 2 - pop)).setDepth(iso.depth(v.x, v.y) + 2).setScale(scale);
      v.shadow.setPosition(Math.round(q.x), Math.round(q.y)).setScale(scale);
      if (!this.juice.low && now - v.lastGlint > 900 + (pk.i % 5) * 120) { v.lastGlint = now; this.juice.embersAt(q.x, q.y - 6, 1, 0xfff0a0); }
    }
    for (const [id, v] of this.coins) if (!seen.has(id)) { this.destroyCoin(v); this.coins.delete(id); }
    for (const id of this.collected) if (!(snap.pickups ?? []).some((p) => p.i === id)) this.collected.delete(id);
  }

  private destroyView(v: EvView) {
    v.spr.destroy(); v.shadow.destroy(); v.glow?.destroy();
    if (v.light) this.scene.lights?.removeLight(v.light);
  }

  private destroyImp(v: ImpView) {
    v.spr.destroy(); v.shadow.destroy(); v.glow?.destroy(); v.label.destroy(); v.bar.destroy();
    if (v.portal) { const pt = v.portal; this.scene.tweens.add({ targets: pt, scale: 0, alpha: 0, duration: 260, onComplete: () => pt.destroy() }); }
    if (v.light) this.scene.lights?.removeLight(v.light);
  }

  private destroyCoin(v: CoinView) { v.spr.destroy(); v.shadow.destroy(); }

  /** A new floor: everything of the last one goes. */
  clear() {
    for (const v of this.views.values()) this.destroyView(v);
    for (const v of this.imps.values()) this.destroyImp(v);
    for (const v of this.coins.values()) this.destroyCoin(v);
    this.views.clear(); this.imps.clear(); this.coins.clear(); this.collected.clear();
    this.pending = null; this.near = null;
    this.prompt.setVisible(false);
  }
}
