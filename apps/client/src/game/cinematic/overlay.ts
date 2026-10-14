// DOM overlay controller for cutscenes: letterbox bars, the fade curtain, title cards and the boss bar sweep.
// Framework-free: the director (Phaser side) drives it every frame; ui/CinematicOverlay.tsx renders the elements
// and registers them here. Per-frame values (bars, fade, boss bar) are written straight to element styles; only
// title-card changes notify React.

export interface TitleCard {
  /** small caps line above the title */
  kicker?: string;
  /** the big line */
  title: string;
  /** second line (theme name, epithet) */
  sub?: string;
  /** body line (fates bound, gift and price) */
  line?: string;
  /** colour family: gold (default), blood (boss / ominous), theme (accent colour) */
  tone?: 'gold' | 'blood' | 'theme';
  /** CSS colour used by the theme tone and the sub line */
  accent?: string;
  /** show the boss health bar under the card (filled by setBossFill) */
  bossBar?: boolean;
  /** larger title (boss names) */
  huge?: boolean;
  /** 'high' upper third / 'low' lower third (keep the action in the middle visible); default centred */
  pos?: 'center' | 'high' | 'low';
}

export interface OverlaySnapshot {
  title: (TitleCard & { id: number }) | null;
  out: boolean;
  skip: boolean;
}

interface Els { root?: HTMLElement | null; top?: HTMLElement | null; bottom?: HTMLElement | null; fade?: HTMLElement | null; bar?: HTMLElement | null }

/** Letterbox bar height as a fraction of the view (each bar) when fully in. */
const BAR_FRAC = 0.12;

class OverlayController {
  private els: Els = {};
  private bars = 0;
  private fade = 0;
  private fadeColor = '#000';
  private boss = 0;
  private snap: OverlaySnapshot = { title: null, out: false, skip: false };
  private subs = new Set<() => void>();
  private nextId = 1;

  attach(els: Els) { this.els = els; this.applyBars(); this.applyFade(); this.applyBoss(); }
  detach() { this.els = {}; }

  subscribe = (fn: () => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };
  getSnapshot = (): OverlaySnapshot => this.snap;
  private notify(patch: Partial<OverlaySnapshot>) { this.snap = { ...this.snap, ...patch }; for (const fn of this.subs) fn(); }

  /** 0 = no bars, 1 = full cinematic letterbox. */
  setBars(k: number) {
    k = Math.max(0, Math.min(1, k));
    if (Math.abs(k - this.bars) < 1e-4) return;
    this.bars = k;
    this.applyBars();
  }
  get barsValue() { return this.bars; }

  /** Curtain over the game view: 0 clear .. 1 opaque. */
  setFade(k: number, color = '#000') {
    k = Math.max(0, Math.min(1, k));
    if (Math.abs(k - this.fade) < 1e-4 && color === this.fadeColor) return;
    this.fade = k; this.fadeColor = color;
    this.applyFade();
  }
  get fadeValue() { return this.fade; }

  showTitle(card: TitleCard) { this.boss = 0; this.applyBoss(); this.notify({ title: { ...card, id: this.nextId++ }, out: false }); }
  /** Fade the card out (instant = remove now). */
  hideTitle(instant = false) {
    if (!this.snap.title) return;
    if (instant) this.notify({ title: null, out: false });
    else if (!this.snap.out) this.notify({ out: true });
  }
  get hasTitle() { return !!this.snap.title && !this.snap.out; }

  /** Boss bar fill 0..1 (sweeps in under the boss name card). */
  setBossFill(k: number) { this.boss = Math.max(0, Math.min(1, k)); this.applyBoss(); }

  setSkipHint(on: boolean) { if (on !== this.snap.skip) this.notify({ skip: on }); }

  /** Everything off (scene end / unmount safety). */
  clear() { this.setBars(0); this.setFade(0); this.hideTitle(true); this.setSkipHint(false); }

  private applyBars() {
    const { root, top, bottom } = this.els;
    if (!root || !top || !bottom) return;
    // whole 4-px steps: the bars move like pixel art, not like a CSS transition
    const h = Math.round((root.clientHeight * BAR_FRAC * this.bars) / 4) * 4;
    top.style.height = `${h}px`;
    bottom.style.height = `${h}px`;
    top.style.visibility = bottom.style.visibility = h > 0 ? 'visible' : 'hidden';
  }

  private applyFade() {
    const f = this.els.fade;
    if (!f) return;
    // twelve visible levels, like a palette fade
    f.style.opacity = String(Math.round(this.fade * 12) / 12);
    f.style.background = this.fadeColor;
    f.style.visibility = this.fade > 0 ? 'visible' : 'hidden';
  }

  private applyBoss() {
    const b = this.els.bar;
    if (b) b.style.width = `${Math.round(this.boss * 100)}%`;
  }
}

export const cineOverlay = new OverlayController();
