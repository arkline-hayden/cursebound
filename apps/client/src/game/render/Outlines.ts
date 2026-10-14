import * as Phaser from 'phaser';

// Crisp 1px pixel outlines for foes (cosmetic). Every ordinary enemy carries a faint but constant red rim; champions,
// rares and bosses a stronger purple-blue one. No shader glow: for each actor texture we pre-render, once, a matching
// silhouette-outline texture `ol:<key>` with the same frames (a pixel is lit when it is transparent and one of its
// four neighbours inside the same frame is opaque). An outline sprite follows its body sprite frame by frame (frame,
// position, origin, scale, flip, rotation, depth just behind), so the rim stays exactly one source pixel wide and
// sharp at every integer zoom. Outline sprites are not lit, so the colour reads the same in the dark.

export const OUTLINE_FOE = { color: 0xc0303a, alpha: 0.6 };
export const OUTLINE_ELITE = { color: 0x8a6cff, alpha: 0.95 };

const ALPHA_MIN = 24;

/** Build (once) the outline texture for a frame-sheet texture. Returns its key, or null if the source is unusable. */
export function outlineTexture(scene: Phaser.Scene, key: string): string | null {
  const olKey = `ol:${key}`;
  if (scene.textures.exists(olKey)) return olKey;
  if (!scene.textures.exists(key) || key === '__MISSING' || key === '__DEFAULT') return null;
  const tex = scene.textures.get(key);
  const src = tex.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const w = src.width, h = src.height;
  if (!w || !h || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src as CanvasImageSource, 0, 0);
  const a = ctx.getImageData(0, 0, w, h).data;
  const out = ctx.createImageData(w, h);
  const o = out.data;
  const names = tex.getFrameNames(false);
  const rects = names.length
    ? names.map((n) => { const f = tex.get(n); return { n, x: f.cutX, y: f.cutY, w: f.cutWidth, h: f.cutHeight }; })
    : [{ n: '__BASE', x: 0, y: 0, w, h }];
  const op = (x: number, y: number) => a[(y * w + x) * 4 + 3] > ALPHA_MIN;
  for (const r of rects) {
    const x1 = Math.min(w, r.x + r.w), y1 = Math.min(h, r.y + r.h);
    for (let y = r.y; y < y1; y++) for (let x = r.x; x < x1; x++) {
      if (op(x, y)) continue;
      if ((x > r.x && op(x - 1, y)) || (x < x1 - 1 && op(x + 1, y)) || (y > r.y && op(x, y - 1)) || (y < y1 - 1 && op(x, y + 1))) {
        const i = (y * w + x) * 4;
        o[i] = 255; o[i + 1] = 255; o[i + 2] = 255; o[i + 3] = 255;
      }
    }
  }
  const ct = scene.textures.createCanvas(olKey, w, h);
  if (!ct) return null;
  ct.context.putImageData(out, 0, 0);
  ct.refresh();
  for (const r of rects) if (r.n !== '__BASE') ct.add(r.n, 0, r.x, r.y, r.w, r.h);
  ct.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return olKey;
}

export class Outlines {
  private bodies = new Map<Phaser.GameObjects.Sprite, Phaser.GameObjects.Sprite>();
  private frame = 0;

  constructor(private scene: Phaser.Scene) {}

  /** Call once per frame before syncing; outlines not synced this frame are hidden by end(). */
  begin() { this.frame++; }

  /** Keep `body`'s outline in step with it this frame. `elite` = champion / rare / boss (purple-blue). */
  sync(body: Phaser.GameObjects.Sprite, elite: boolean) {
    if (!body.active || !body.frame) return;
    const key = outlineTexture(this.scene, body.texture.key);
    if (!key) return;
    let ol = this.bodies.get(body);
    if (!ol) {
      ol = this.scene.add.sprite(body.x, body.y, key, body.frame.name);
      this.bodies.set(body, ol);
      const mine = ol;
      body.once(Phaser.GameObjects.Events.DESTROY, () => { mine.destroy(); this.bodies.delete(body); });
    }
    if (ol.texture.key !== key) ol.setTexture(key, body.frame.name);
    else if (ol.frame.name !== body.frame.name) ol.setFrame(body.frame.name);
    const st = elite ? OUTLINE_ELITE : OUTLINE_FOE;
    ol.setTint(st.color)
      .setAlpha(st.alpha * body.alpha)
      .setVisible(body.visible)
      .setOrigin(body.originX, body.originY)
      .setPosition(body.x, body.y)
      .setScale(body.scaleX, body.scaleY)
      .setRotation(body.rotation)
      .setFlip(body.flipX, body.flipY)
      .setDepth(body.depth - 0.01);
    ol.setData('f', this.frame);
  }

  /** Hide outlines whose body was not synced this frame (the slain, gibbed, off-snapshot). */
  end() {
    for (const ol of this.bodies.values()) if (ol.getData('f') !== this.frame) ol.setVisible(false);
  }
}
