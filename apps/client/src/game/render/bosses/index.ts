import type * as Phaser from 'phaser';
import type { SimEvent, SnapEnemy, Snapshot } from '@cursebound/simulation';
import { iso } from '../iso';
import { BOSS_KITS, setBossFxMap, type Beam, type BossFxHost, type BossLayer } from './registry';
// Side-effect imports: each scripted boss registers its kit, hazards and projectiles. One line per boss.
import './corruptCore';
import './ironColossus';

export type { BossFxHost } from './registry';

// Scripted-boss presentation layer (CombatScene owns one): routes sim events of scripted bosses to their kits, lets
// kits touch their sprites every frame, and draws short-lived boss effects (laser beams) on the floor.

const EVENT_OWNER = new Set(['enemy_attack', 'foe_fx', 'death', 'stagger', 'boss_phase', 'spawn']);

export class BossFx implements BossLayer {
  private g: Phaser.GameObjects.Graphics;
  private beams: Beam[] = [];
  private kinds = new Map<number, string>();
  private echoes = new Set<number>();
  private carried = new Map<number, { light: Phaser.GameObjects.Light; seen: number }>();

  constructor(private host: BossFxHost) {
    this.g = host.scene.add.graphics().setDepth(-64);
  }

  beam(b: Omit<Beam, 'born'>) { this.beams.push({ ...b, born: this.host.scene.time.now }); }

  isEcho(id: number): boolean { return this.echoes.has(id); }

  /** Learn which live entities belong to scripted bosses (and which are echoes) from the latest snapshot. */
  sync(snap: Snapshot | null, map: { w: number; h: number; tiles: number[] } | null) {
    setBossFxMap(map);
    if (!snap) return;
    for (const e of snap.enemies) {
      if (!BOSS_KITS[e.k]) continue;
      this.kinds.set(e.i, e.k);
      if (e.echo) this.echoes.add(e.i);
    }
    if (this.kinds.size > 256) { this.kinds.clear(); this.echoes.clear(); }
  }

  /** Present a sim event; true = handled (the scene skips its generic cue). */
  onEvent(e: SimEvent, snap: Snapshot | null): boolean {
    if (!EVENT_OWNER.has(e.t) || !('id' in e)) return false;
    const id = (e as { id: number }).id;
    const kind = this.kinds.get(id) ?? snap?.enemies.find((x) => x.i === id)?.k ?? ((e as { kind?: string }).kind);
    const kit = kind ? BOSS_KITS[kind] : undefined;
    if (!kit?.onEvent) return false;
    try { return kit.onEvent(this.host, this, e, snap); } catch (err) { console.error('[bossfx]', err); return false; }
  }

  /** Per-frame touch on a scripted boss's sprite (after the scene set frame, tint and position). */
  drawEnemy(sprite: Phaser.GameObjects.Sprite, e: SnapEnemy, now: number) {
    const kit = BOSS_KITS[e.k];
    if (!kit || e.st === 'dying') return;
    kit.drawEnemy?.(this.host, sprite, e, now);
    const spec = kit.light?.(e, now);
    const lm = this.host.scene.lights;
    if (!spec || !lm || !this.host.dungeon.lighting) return;
    let l = this.carried.get(e.i);
    if (!l) { l = { light: lm.addLight(sprite.x, sprite.y - spec.dy, spec.radius, spec.color, spec.intensity), seen: now }; this.carried.set(e.i, l); }
    l.light.x = sprite.x; l.light.y = sprite.y - spec.dy;
    l.light.radius = spec.radius; l.light.intensity = spec.intensity;
    l.light.setColor(spec.color);
    l.seen = now;
  }

  /** Draw the transient boss effects for this frame. */
  draw(now: number) {
    // carried lights of bosses no longer drawn go out
    for (const [id, l] of this.carried) if (now - l.seen > 120) { this.host.scene.lights?.removeLight(l.light); this.carried.delete(id); }
    const g = this.g.clear();
    this.beams = this.beams.filter((b) => b.until > now);
    for (const b of this.beams) {
      const k = 1 - (now - b.born) / Math.max(1, b.until - b.born);
      const a = iso.p(b.x0, b.y0), c = iso.p(b.x1, b.y1);
      const w = Math.max(2, iso.ry(b.w) * 1.2);
      g.lineStyle(w, b.color, 0.45 * k).lineBetween(a.x, a.y, c.x, c.y);
      g.lineStyle(Math.max(1, w * 0.45), b.color, 0.9 * k).lineBetween(a.x, a.y, c.x, c.y);
      g.lineStyle(1, b.core, k).lineBetween(a.x, a.y - 1, c.x, c.y - 1);
    }
  }

  destroy() { for (const l of this.carried.values()) this.host.scene.lights?.removeLight(l.light); this.carried.clear(); this.g.destroy(); this.beams = []; this.kinds.clear(); this.echoes.clear(); }
}
