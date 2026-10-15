import * as Phaser from 'phaser';
import { DODGE, BOSSES, BOSS_BY_ID, ENEMY_BY_ID, affixNames, eliteName, CLASS_BY_ID } from '@cursebound/content';
import { formatBig, Big } from '@cursebound/numeric';
import type { Snapshot, SnapEnemy, SnapPlayer, SimEvent } from '@cursebound/simulation';
import { buildArt, ensureActor } from '../art/generate';
import { ACTOR_IDS, ACTOR_META, animFor, type ActorId, type ActorState, HERO_ACTOR_IDS } from '../art/actors';
import { SKILL_FX, HAZARD_FX, HAZARD_LIGHT, PROJECTILE_FX, KILL_FX } from '../render/fx';
import type { FxCtx, ProjectileLook } from '../render/fx/registry';
import { iso, isoPoly } from '../render/iso';
import { TELEGRAPH_PALETTES } from '../art/palette';
import type { AudioEngine, SfxId } from '../audio/AudioEngine';
import { DungeonRenderer } from '../render/DungeonRenderer';
import { Juice, GORE } from '../render/Juice';
import { LootRenderer } from '../render/LootRenderer';
import { EliteFx, ELITE_COLOR } from '../render/EliteFx';
import { PickupRenderer } from '../render/Pickups';
import { RoomEventRenderer } from '../render/RoomEvents';   // room events: shrines, altar, merchant, treasure imp, coins
import { Outlines } from '../render/Outlines';
import { AfflictionFx, foeActor, heroTint } from '../render/Afflictions';
import { MINIBOSS_COLOR, MINIBOSS_CSS, MINIBOSS_SCALE, ThemeFoeFx, miniBossMechNames, miniBossTint } from '../render/ThemeFoeFx';   // theme foes + named mini-bosses
import { BossFx } from '../render/bosses';
import { DoorRenderer } from '../render/Doors';
import { CinematicDirector } from '../cinematic/Cinematic';
import { getAudio } from '../audio/bus';
import { impactSfx, killSfx, type StingerKind } from '../audio/sfx';
import { DamageNumbers, NUMBER_COLOR } from '../render/DamageNumbers';
import { DeathFx, deathStyle } from '../render/DeathFx';
import { InputController, type Sample } from '@/lib/input';
import { ClickMove, type DriveOut } from '../input/ClickMove';
import { basicReach, pickEnemy, pickGround, type GroundThing } from '../input/targeting';
import { ClickFx } from '../render/ClickFx';
import { GuideMark } from '../render/GuideMark';
import { gameCursor, type GameCursor } from '@/ui/pixelCursors';
import { cinematicHeld, movesIn, netStore, type GameConnection } from '@/lib/net';
import { settingsStore } from '@/lib/settings';
import { CameraRig, type Pt } from '../cameraRig';
import { FONT_WORLD, WORLD_TEXT_PX } from '@/ui/fonts';
import { gfx, particleBudget, reportSlowFrames } from '../gfx';
import { spectateStore } from '@/ui/Spectate';
import { rumble } from '@/lib/gamepad';
import { spectateTarget } from '../spectate';

// Combat presentation (PRD §15, §16, §18): renders authoritative snapshots in a lit isometric dungeon, predicts the
// local avatar, interpolates remote entities, draws shape-coded telegraphs that survive reduced effects, and layers
// cosmetic "juice" (hit-stop, recoil, stagger flinches, death animations, gibs, shockwaves, time dilation on the last kill) that never
// alters authoritative outcomes. Champions/rares (EliteFx) and potions/orbs (PickupRenderer) are drawn here too.


/** Hover-plate health: whole numbers below 100K ("820 / 1000"), compact notation above. */
function hpNum(compact: string): string {
  const b = Big.fromCompact(compact);
  if (b.lt(Big.from(100000))) { const n = b.toNumber(); return String(n > 0 && n < 1 ? 1 : Math.round(n)); }
  return formatBig(b);
}

const BOSS_KINDS = new Set(BOSSES.map((b) => b.id));
/** the view centres this many px above the followed ground point (heroes read better a touch below centre) */
const CAM_LIFT = 22;
/** Kill-streak milestones and their colours (escalating). */
const STREAKS: [number, number][] = [[5, 0xffd890], [10, 0xffa040], [15, 0xff6a3a], [25, 0xff3a5a], [40, 0xd06aff], [60, 0xffffff]];
const ELITE_HAZARD_LIGHT: Record<string, number> = { moltenBlast: 0xff7a2a, frostOrb: 0x8fd8ff, plague: 0x6ab03a, thunder: 0xc8e8ff };
/** Typed hits tint the foe briefly after the white hit flash: shock, poison, frost, scorch, starlight. */
const ELEM_TINT: Record<string, number> = { storm: 0xc4ecff, decay: 0xc4f08a, frost: 0xd0f4ff, ember: 0xffbe8a, astral: 0xe8c4ff };
/** Death burst colours per killing damage type (main, hot core). */
const DEATH_FX: Record<string, [number, number]> = { ember: [0xff7a2a, 0xffe0a0], frost: [0x8fe0ff, 0xffffff], storm: [0x9fd8ff, 0xffffff], decay: [0x8fd14f, 0xe0ffb0], astral: [0xb07aff, 0xf0e0ff] };

interface ActorView {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  bar?: Phaser.GameObjects.Graphics;
  label?: Phaser.GameObjects.Text;
  badge?: Phaser.GameObjects.Text;
  extras: Phaser.GameObjects.Sprite[];
  actor: ActorId;
  animKey: string;
  lastSeen: number;
  dying: boolean;
  recoilX: number; recoilY: number; squash: number;
  lastAfterimage: number; lastStep: number;
  shield?: Phaser.GameObjects.Sprite;
  kind: string;
  /** cosmetic scale (elites are drawn bigger) */
  baseScale: number;
  /** last snapshot health fraction (overkill detection) and elite tier */
  lastHp: number;
  elite: number;
  gibbed?: boolean;
  /** stagger flinch (combat feel pass): when the last hit landed (presentation clock), how hard (0..1), lean side (-1/1) */
  flinchAt?: number; flinchMag?: number; flinchSide?: number;
}

/** Stagger flinch: the foe squashes and leans away from a hit for this long (ms); bigger hits flinch harder. */
const FLINCH_MS = 110;
/** Heavy-weapon heroes: their physical hits use the heavy impact layer (hammers, axes, slams). */
const HEAVY_WEAPON = new Set(['vanguard', 'berserker', 'templar', 'warden']);
/** Rolling-number colour per damage type (crits are gold, NUMBER_COLOR). */
const DMG_COLOR: Record<string, string> = { ember: '#ff9a3a', storm: '#9fd8ff', astral: '#d7a8ff', frost: '#bfeaff', decay: '#a8e070', physical: '#ffffff' };

const SFX_FOR_SKILL: Record<string, SfxId> = {
  v_cleave: 'swing', a_spark: 'attack_spark', v_earthbreaker: 'signature_slam', a_astral_nova: 'signature_nova',
  v_guard_stance: 'skill_guard', v_sweeping_strike: 'skill_sweep', v_rally_cry: 'skill_rally', a_fireline: 'skill_fireline', a_arc_bolt: 'skill_arc', a_phase_step: 'skill_phase',
};

export class CombatScene extends Phaser.Scene {
  net!: GameConnection;
  audio: AudioEngine | null = null;
  input2 = new InputController();
  dungeon!: DungeonRenderer;
  juice!: Juice;
  /** rolling damage numbers and death animations by damage type (combat feel pass) */
  numbers!: DamageNumbers;
  deaths!: DeathFx;
  /** legendary ground loot, beams and perk fx (render/LootRenderer.ts) */
  loot: LootRenderer | null = null;
  elites!: EliteFx;
  pickupsR!: PickupRenderer;
  /** crisp 1px foe outlines (render/Outlines.ts) and hero afflictions / new foe attacks (render/Afflictions.ts) */
  outlines!: Outlines;
  /** theme foe cues and named mini-boss presentation (render/ThemeFoeFx.ts) */
  themeFx!: ThemeFoeFx;
  aff!: AfflictionFx;
  /** scripted bosses' presentation (render/bosses) */
  bossFx!: BossFx;
  /** in-world door vote (render/Doors.ts) */
  doorsR: DoorRenderer | null = null;
  /** room events: shrines, cursed altar, merchant, treasure imp, cursed coins (render/RoomEvents.ts) */
  roomFx: RoomEventRenderer | null = null;
  private actors = new Map<string, ActorView>();
  private projectiles = new Map<number, { s: Phaser.GameObjects.Sprite; glow?: Phaser.GameObjects.Image; last: number; color: number; look?: ProjectileLook; born: number }>();
  private hazardG!: Phaser.GameObjects.Graphics;
  private teleG!: Phaser.GameObjects.Graphics;
  private fxG!: Phaser.GameObjects.Graphics;
  private debugG!: Phaser.GameObjects.Graphics;
  private pipsG!: Phaser.GameObjects.Graphics;
  private debugText: Phaser.GameObjects.Text[] = [];
  private hazardSprites = new Map<number, Phaser.GameObjects.Sprite[]>();
  private hazardLit = new Set<number>();
  private bolts: { pts: { x: number; y: number }[]; until: number; color: number }[] = [];
  private inputAcc = 0;
  private frameTimes: number[] = [];
  /** frame-rate watchdog: seconds of slow frames (decays when fast), last sample, and whether a report waits for a
   *  safe moment (never mid-fight, mid-boss or mid-cutscene); one report per scene */
  private watch = { born: 0, at: 0, slowSec: 0, pending: false, done: false };
  private lastHitSfx = 0;
  private lastCritSfx = 0;
  /** last time a connecting melee swing of ours hit-stopped (throttle: one stop per swing, not per foe) */
  private lastMeleeStop = 0;
  /** world point a locked camera follows: the hero plus a slight aim look-ahead, or the spectated teammate */
  private camTarget = { x: 0, y: 0 };
  /** League of Legends camera (game/cameraRig.ts); a cut / ease back to the hero waits for the next camera step */
  private rig = new CameraRig();
  private camSnap: 'none' | 'cut' | 'ease' = 'none';
  private lastLife: string | null = null;
  /** enemy nameplates: requests gathered while drawing foes this frame, live tags by actor key, and a free pool */
  private nameReq: { key: string; text: string; color: string; x: number; y: number; prio: number; hurt: boolean; hitAt: number; badge?: Phaser.GameObjects.Text }[] = [];
  private nameTags = new Map<string, Phaser.GameObjects.Text>();
  private namePool: Phaser.GameObjects.Text[] = [];
  /** cutscene director (game/cinematic): door walk-through, round intro, boss grand entrance */
  cine: CinematicDirector | null = null;
  private renderSelf = { x: 0, y: 0, init: false };
  private lastPhase = '';
  private combo = 0;
  private comboAt = 0;
  private frozenNow = 0;
  private lanterns = new Map<number, Phaser.GameObjects.Light>();
  private camFree = false;
  private focus: { x: number; y: number; depth: number }[] = [];
  private aimMark: Phaser.GameObjects.Graphics | null = null;
  /** Diablo-style click-to-move (game/input/ClickMove.ts), its ground markers (render/ClickFx.ts) and the canvas cursor */
  private clickMove = new ClickMove();
  private clickFx: ClickFx | null = null;
  /** guided tutorial: the walk mark (render/GuideMark.ts) */
  private guideMark: GuideMark | null = null;
  private clickHover: { enemy: SnapEnemy | null; ground: GroundThing | null; combat: boolean } = { enemy: null, ground: null, combat: false };
  private cursorKind: GameCursor | '' = '';
  private cursorCss = '';
  /** door under the pointer as reported by the door renderer ('cursebound:doorhover'), else null */
  private doorHover: number | null = null;
  private lastClickSfx = 0;
  private postFxOn: boolean | null = null;
  private hoverKey: string | null = null;
  private hoverFx: Phaser.FX.Glow | null = null;
  private hoverSig = '';
  private frameCount = 0;
  /** last player hit on each enemy (screen direction, crit, one-shot, damage type) for death animations, gibs and death bursts */
  private lastHit = new Map<number, { ux: number; uy: number; crit: boolean; big: boolean; at: number; dtype?: string }>();
  /** brief elemental tint on a foe after a typed hit (storm shock, decay poison, frost, ember, astral) */
  private elemTint = new Map<number, { c: number; until: number }>();
  /** one FxCtx reused for every hazard drawn this frame (no per-hazard allocation in the hot path) */
  private hazardCtx: FxCtx | null = null;
  private lastDeath = { x: 0, y: 0 };
  private flourishRound = -1;
  private lastDashAt = 0;
  private lastSurgeFx = 0;
  private pipsFullAt = 0;
  private potionAt = new Map<number, number>();
  private pendingBanners: { id: number; tier: number; until: number }[] = [];
  ready = false;

  constructor() { super('combat'); }

  init(data: { net: GameConnection; audio: AudioEngine | null }) {
    this.net = data.net;
    this.audio = data.audio;
  }

  create() {
    // monsters/companions up front; hero rigs are built on first sight (only the party's classes ever appear)
    buildArt(this, { actors: ACTOR_IDS.filter((a) => !(HERO_ACTOR_IDS as readonly string[]).includes(a)) });
    this.cameras.main.setBackgroundColor('#050303');
    this.cameras.main.setRoundPixels(true);
    // no camera bounds: the hero stays centred like Diablo; the void around the map is simply black
    this.cameras.main.removeBounds();
    // low tier: no Light2D at all (sprites stay on the batched default pipeline); the tier is fixed for this scene,
    // GameCanvas rebuilds the game when it changes
    this.dungeon = new DungeonRenderer(this, { lighting: gfx().lighting, ambient: 0x8a7a8e });
    this.juice = new Juice(this, this.dungeon);
    this.numbers = new DamageNumbers(this, this.juice);
    this.deaths = new DeathFx(this, this.juice, this.dungeon);
    this.loot = new LootRenderer(this);
    this.elites = new EliteFx(this, this.juice, this.dungeon);
    this.outlines = new Outlines(this);
    this.aff = new AfflictionFx(this, this.juice, (id, x, y, priority = 1) => this.sfx(id, x, priority, y));
    this.themeFx = new ThemeFoeFx(this, this.juice, (id, x, y, priority = 1) => this.sfx(id, x, priority, y), (text, tone) => this.banner(text, tone));
    this.bossFx = new BossFx({
      scene: this, juice: this.juice, dungeon: this.dungeon, sfx: (id, x, y, priority = 1) => this.sfx(id as SfxId, x, priority, y),
      banner: (text, tone) => this.banner(text, tone), reduced: () => this.settings().reducedEffects, me: () => netStore.get().slot,
      fxCtx: () => this.hazardFxCtx(),
    });
    this.pickupsR = new PickupRenderer(this, this.juice);
    this.doorsR = new DoorRenderer(this, this.dungeon, (id, x, y, priority = 1) => this.sfx(id, x, priority, y));
    this.roomFx = new RoomEventRenderer(this, this.juice, this.dungeon, this.net, (id, x, y, priority = 1) => this.sfx(id, x, priority, y));
    this.hazardG = this.add.graphics().setDepth(-80);
    this.teleG = this.add.graphics().setDepth(-70);
    this.fxG = this.add.graphics().setDepth(4700);
    this.debugG = this.add.graphics().setDepth(6000);
    this.pipsG = this.add.graphics().setDepth(4502);
    this.input2.attach(this.game.canvas);
    this.input2.onAction = (a) => {
      if (a === 'ledger') window.dispatchEvent(new CustomEvent('cursebound:ledger'));
      if (a === 'pause') window.dispatchEvent(new CustomEvent('cursebound:pause'));
    };
    this.events.once('shutdown', () => this.input2.detach());
    this.events.once('destroy', () => this.input2.detach());
    this.clickFx = new ClickFx(this);
    this.guideMark = new GuideMark(this);
    // contract: any UI (minimap, door panel) can ask the hero to walk somewhere, in world tile coordinates
    const onMoveTo = (e: Event) => { const d = (e as CustomEvent<{ x: number; y: number }>).detail; if (d) this.clickMove.moveTo(Number(d.x), Number(d.y)); };
    const onDoorHover = (e: Event) => { const i = (e as CustomEvent<{ i: number | null }>).detail?.i; this.doorHover = typeof i === 'number' ? i : null; };
    window.addEventListener('cursebound:moveto', onMoveTo);
    window.addEventListener('cursebound:doorhover', onDoorHover);
    const offMove = () => { window.removeEventListener('cursebound:moveto', onMoveTo); window.removeEventListener('cursebound:doorhover', onDoorHover); };
    this.events.once('shutdown', offMove);
    this.events.once('destroy', offMove);
    this.game.canvas.setAttribute('aria-label', 'Combat view. Text status is available in the panel beside the game.');
    this.game.canvas.setAttribute('role', 'img');
    this.cine = new CinematicDirector({
      scene: this, juice: this.juice, dungeon: this.dungeon, net: this.net,
      sfx: (id, x, y, priority = 2) => this.sfx(id as SfxId, x, priority, y),
      stinger: (kind) => { (getAudio() ?? this.audio)?.stinger(kind as StingerKind); },
      follow: () => { const c = this.P(this.camTarget.x, this.camTarget.y); return { x: c.x, y: c.y - CAM_LIFT }; },
      heroActor: (classId) => this.heroActor(classId),
    });
    const endCine = () => { this.cine?.destroy(); this.cine = null; };
    this.events.once('shutdown', endCine);
    this.events.once('destroy', endCine);
    this.applyPostFx();
    this.watch.born = performance.now();
    this.ready = true;
  }

  /**
   * Camera grade: soft bloom on flames and spells, a dark vignette, a touch of contrast. Off below the High tier, with
   * reduced effects, and while frames run slow.
   */
  private applyPostFx() {
    const cam = this.cameras.main;
    const want = gfx().postFx && !this.settings().reducedEffects && !this.juice.low;
    if (!cam.postFX || want === this.postFxOn) return;
    this.postFxOn = want;
    cam.postFX.clear();
    if (!want) return;
    cam.postFX.addBloom(0xffffff, 1, 1, 0.9, 0.55, 3);
    const cm = cam.postFX.addColorMatrix();
    cm.contrast(0.12, true);
    cm.saturate(0.08, true);
    cam.postFX.addVignette(0.5, 0.48, 0.92, 0.42);
  }

  /**
   * Diablo-style mouse-over: the foe under the cursor gets a red rim and its plate in the HUD via 'cursebound:target':
   * { name, hp (0..1), hpText ("820 / 1000"), count (×N text | null), objective, elite (0|1|2), affixes (display names) }.
   */
  private updateHover(s: Snapshot) {
    const cam = this.cameras.main;
    const k = this.game.canvas.clientWidth / this.W || 1;
    const mx = this.input2.pointer.x / k + cam.scrollX, my = this.input2.pointer.y / k + cam.scrollY;
    let best: { key: string; e: SnapEnemy; v: ActorView; depth: number } | null = null;
    if (this.input2.pointer.inside && !this.input2.usingPad) {
      for (const e of s.enemies) {
        if (e.st === 'dying' || e.boss) continue;
        const key = `e${e.i}:${e.g}`;
        const v = this.actors.get(key);
        if (!v) continue;
        const sp = v.sprite, w = sp.width * sp.scaleX * 0.42, h = sp.height * sp.scaleY * sp.originY * 0.9;
        if (mx < sp.x - w || mx > sp.x + w || my < sp.y - h || my > sp.y + 6) continue;
        if (!best || sp.depth > best.depth) best = { key, e, v, depth: sp.depth };
      }
    }
    const key = best?.key ?? null;
    if (key !== this.hoverKey) {
      const old = this.hoverKey ? this.actors.get(this.hoverKey) : undefined;
      if (old && this.hoverFx) old.sprite.preFX?.remove(this.hoverFx);
      this.hoverFx = null;
      if (best?.v.sprite.preFX) this.hoverFx = best.v.sprite.preFX.addGlow(0xff2a2a, 3, 0, false, 0.1, 10);
      this.hoverKey = key;
    }
    const sig = best ? `${key}|${best.e.ht ?? Math.round(best.e.hp * 100)}|${best.e.cnt ?? ''}|${best.e.el ?? 0}` : '';
    if (sig !== this.hoverSig) {
      this.hoverSig = sig;
      let detail: Record<string, unknown> | null = null;
      if (best) {
        const e = best.e;
        const base = ENEMY_BY_ID[e.k]?.name ?? e.k;
        detail = {
          name: e.mb ?? eliteName(base, e.af), hp: e.hp,
          hpText: e.ht !== undefined && e.mt !== undefined ? `${hpNum(e.ht)} / ${hpNum(e.mt)}` : null,
          count: e.cnt ? formatBig(Big.fromCompact(e.cnt)) : null, objective: !!e.obj,
          // a named mini-boss shows with the gold plate and its signature mechanics in the affix line
          elite: e.mb ? 2 : e.el ?? 0, affixes: e.mb ? miniBossMechNames(e.mm).split(' · ').filter(Boolean) : affixNames(e.af),
        };
      }
      window.dispatchEvent(new CustomEvent('cursebound:target', { detail }));
    }
  }

  // ---------------- helpers ----------------

  private palette() { return TELEGRAPH_PALETTES[settingsStore.get().s.palette] ?? TELEGRAPH_PALETTES.default; }
  private settings() { return settingsStore.get().s; }
  /** screen point for a world point */
  private P(x: number, y: number) { return iso.p(x, y); }

  private fxCtx(mine: boolean): FxCtx {
    return {
      scene: this, juice: this.juice, dungeon: this.dungeon,
      P: (x, y) => iso.p(x, y), U: (dx, dy) => iso.unit(dx, dy), rx: iso.rx, ry: iso.ry,
      sfx: (id, x, y, priority = 1) => this.sfx(id, x, priority, y),
      bolt: (x0, y0, x1, y1, color) => this.bolt(x0, y0, x1, y1, color),
      mine, reduced: this.settings().reducedEffects, particles: particleBudget(), now: this.time.now,
      actorSprite: (slot) => this.actors.get(`p${slot}`)?.sprite,
      rank: (slot, node) => netStore.get().phase?.players.find((p) => p.slot === slot)?.ranks[node] ?? 0,
      cls: (slot) => netStore.get().phase?.players.find((p) => p.slot === slot)?.classId,
    };
  }

  /** The shared hazard FxCtx, refreshed (clock, settings, budget) rather than rebuilt for every hazard every frame. */
  private hazardFxCtx(): FxCtx {
    const c = this.hazardCtx ??= this.fxCtx(false);
    c.now = this.time.now; c.reduced = this.settings().reducedEffects; c.particles = particleBudget();
    return c;
  }

  /** Hero sprite for a class (falls back to the Vanguard rig until a class has art). */
  private heroActor(classId: string): ActorId {
    return ((ACTOR_IDS as readonly string[]).includes(classId) ? classId : 'vanguard') as ActorId;
  }
  /** screen x for a world point (audio panning) */
  private sxw(x: number, y: number) { return iso.x(x, y); }
  private get W() { return this.scale.width; }
  private get H() { return this.scale.height; }

  private view(key: string, actor: ActorId, x: number, y: number, kind: string): ActorView {
    let v = this.actors.get(key);
    if (v && v.actor !== actor) { this.destroyView(key); v = undefined; }
    if (!v) {
      const meta = ACTOR_META[actor];
      const shadow = this.add.ellipse(x, y, meta.shadowRadius * 2, meta.shadowRadius * 0.8, 0x000000, 0.55).setDepth(-60);
      ensureActor(this, actor);
      const sprite = this.add.sprite(x, y, `actor:${actor}`).setOrigin(meta.originX, meta.originY);
      this.dungeon.litObject(sprite);
      v = { sprite, shadow, extras: [], actor, animKey: '', lastSeen: 0, dying: false, recoilX: 0, recoilY: 0, squash: 0, lastAfterimage: 0, lastStep: 0, kind, baseScale: 1, lastHp: 1, elite: 0 };
      this.actors.set(key, v);
    }
    return v;
  }

  private destroyView(key: string) {
    const v = this.actors.get(key);
    if (!v) return;
    v.sprite.destroy(); v.shadow.destroy(); v.bar?.destroy(); v.label?.destroy(); v.badge?.destroy(); v.shield?.destroy();
    v.extras.forEach((e) => e.destroy());
    this.actors.delete(key);
  }

  private play(v: ActorView, state: ActorState, dir8: number) {
    const a = animFor(v.actor, state, dir8);
    v.sprite.setFlipX(a.flipX);
    if (v.animKey !== a.key && this.anims.exists(a.key)) {
      v.animKey = a.key;
      v.sprite.play(a.key, true);
    }
  }

  /** 8-way facing on screen for a world-space direction */
  private dirOf(wx: number, wy: number): number {
    const v = iso.dir(wx, wy);
    const x = v.x, y = v.y;
    if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) return 2;
    const T = 0.41421356, ax = Math.abs(x), ay = Math.abs(y);
    if (ay <= ax * T) return x > 0 ? 0 : 4;
    if (ax <= ay * T) return y > 0 ? 2 : 6;
    if (x > 0) return y > 0 ? 1 : 7;
    return y > 0 ? 3 : 5;
  }

  private sfx(id: SfxId, x?: number, priority = 1, y = x) {
    if (!this.audio) return;
    let pan = 0, dist = 0;
    if (x !== undefined) {
      // pan by screen x, attenuate by distance from the camera centre (in 480x270 half-views, independent of zoom)
      const cam = this.cameras.main, wy = y ?? x;
      const dx = (this.sxw(x, wy) - cam.midPoint.x) / 480, dy = (iso.y(x, wy) - cam.midPoint.y) / 270;
      pan = Math.max(-1, Math.min(1, dx));
      dist = Math.hypot(dx, dy);
    }
    this.audio.play(id, { pan, priority, dist });
  }

  /** Live elemental hit tint for an enemy id (0 when none or expired; expired entries are dropped). */
  private elemTintOf(id: number): number {
    const t = this.elemTint.get(id);
    if (!t) return 0;
    if (this.time.now > t.until) { this.elemTint.delete(id); return 0; }
    return t.c;
  }

  private viewFor(kind: 'enemy' | 'player', id: number): ActorView | undefined {
    if (kind === 'player') return this.actors.get(`p${id}`);
    for (const [k, v] of this.actors) if (k.startsWith(`e${id}:`)) return v;
    return undefined;
  }

  /** World position of the local hero as drawn (prediction-smoothed), or null. */
  private mePos(snap: Snapshot | null): { x: number; y: number } | null {
    if (this.renderSelf.init) return { x: this.renderSelf.x, y: this.renderSelf.y };
    const p = snap?.players[netStore.get().slot];
    return p ? { x: p.x, y: p.y } : null;
  }

  private banner(text: string, tone: 'danger' | 'good' | 'info') {
    window.dispatchEvent(new CustomEvent('cursebound:banner', { detail: { text, tone } }));
  }

  // ---------------- events → feel ----------------

  private handleEvents(snap: Snapshot | null) {
    const evs = this.net.events.splice(0, this.net.events.length);
    const me = netStore.get().slot;
    for (const e of evs) this.handleEvent(e, me, snap);
  }

  private handleEvent(e: SimEvent, me: number, snap: Snapshot | null) {
    const pal = this.palette();
    const J = this.juice;
    if (this.themeFx.onEvent(e, me, snap)) return;   // theme foe cues, mini-boss announcements (render/ThemeFoeFx.ts)
    if (this.bossFx.onEvent(e, snap)) return;   // scripted bosses: beams, quakes, glitches, banners (render/bosses)
    if (this.aff.onEvent(e, me, snap)) return;   // afflictions, new foe attacks, idle packs waking (render/Afflictions.ts)
    if (this.roomFx?.onEvent(e, me, snap)) return;   // room events and coin pickups (render/RoomEvents.ts)
    switch (e.t) {
      case 'hit': {
        const amt = Big.fromCompact(e.amount);
        const { x, y } = this.P(e.x, e.y);
        const dx = e.x - (e.sx ?? e.x), dy = e.y - (e.sy ?? e.y);
        const u = Math.hypot(dx, dy) > 1e-6 ? iso.unit(dx, dy) : { x: 0, y: 0 };
        if (e.targetKind === 'enemy') {
          const v = this.viewFor('enemy', e.target);
          if (v && e.sx !== undefined) {   // direct hits only: burn and rot ticks carry no source and never flinch
            v.recoilX = u.x * (e.crit ? 8 : 4); v.recoilY = u.y * (e.crit ? 6 : 3); v.squash = e.crit ? 1 : 0.6;
            // stagger flinch (applyRecoil): squash and lean away from the hit; frac = the hit's share of a unit's health
            const mag = Math.min(1, 0.3 + (e.frac ?? 0.08) * 1.5 + (e.crit ? 0.3 : 0) + (e.kill ? 0.2 : 0));
            const fresh = v.flinchAt === undefined || J.clock - v.flinchAt > FLINCH_MS * 0.6;
            if (fresh || mag > (v.flinchMag ?? 0)) { v.flinchAt = J.clock; v.flinchMag = mag; v.flinchSide = u.x > 0.05 ? 1 : u.x < -0.05 ? -1 : (v.flinchSide ?? 1); }
          }
          if (e.sx !== undefined) this.lastHit.set(e.target, { ux: u.x, uy: u.y, crit: e.crit, big: !!e.kill && (v?.lastHp ?? 0) >= 0.85, at: this.time.now, dtype: e.dtype });
          const big = e.crit || e.kill;
          // one rolling number per foe (crits roll their own, gold), render/DamageNumbers.ts
          if (e.crit) this.numbers.add(`e${e.target}`, 'crit', amt, x, y, NUMBER_COLOR.crit);
          else this.numbers.add(`e${e.target}`, 'dmg', amt, x, y, DMG_COLOR[e.dtype] ?? '#ffffff');
          const kind = v?.kind ?? 'pursuer';
          if (e.dtype === 'physical' || e.dtype === 'storm') J.sparksAt(x, y - 14, e.crit ? 14 : 5, e.dtype === 'storm' ? 0x9fd8ff : 0xffd890);
          if (e.dtype === 'ember') J.embersAt(x, y - 14, e.crit ? 10 : 4);
          // elemental secondaries: shattering frost, crackling shock, poison bubbles, astral stars (tier-scaled)
          else if (e.dtype === 'frost') J.bits('ice', x, y - 14, e.crit ? 8 : 3, 0xbfeaff);
          else if (e.dtype === 'decay') J.bits('bubble', x, y - 12, e.crit ? 5 : 2, 0xa8e070);
          else if (e.dtype === 'astral') J.bits('star', x, y - 14, e.crit ? 6 : 2, 0xd7a8ff);
          if (e.dtype === 'storm') J.bits('zap', x, y - 14, e.crit ? 5 : 2, 0xbfe8ff);
          const et = ELEM_TINT[e.dtype];
          if (et) this.elemTint.set(e.target, { c: et, until: this.time.now + 220 });
          J.bleed(kind, x, y - 14, e.crit ? 12 : 5, u.x, u.y);
          J.impact(x, y - 14, e.crit ? 0xffdc8a : 0xffffff, e.crit ? 1.6 : 0.8);
          if (e.crit) {
            // crit pop: a hot star snaps open behind the big number
            J.starburst(x, y - 14, 0xffe27a, 1.3, 190);
            J.orb(x, y - 14, 0xffb040, 0.6, 170);
            this.dungeon.flashLight(x, y - 14, 90, 0xffdc8a, 1.4, 90);
          }
          if (e.src === me) {
            if (big) J.hitStop(e.crit ? 55 : 35);
            else if (e.dtype === 'physical' && this.time.now - this.lastMeleeStop > 140) {
              // melee weight: a short freeze when our own swing connects (once per swing, however many foes it cleaves)
              const cls = snap?.players.find((pl) => pl.s === me)?.c;
              if (cls && CLASS_BY_ID[cls]?.melee) { this.lastMeleeStop = this.time.now; J.hitStop(28); }
            }
            if (e.crit) J.shake(0.004, 90);
          }
          // layered impact by damage type and weapon weight; a crit stacks its own distinct cue on top (separate throttle)
          if (this.time.now - this.lastHitSfx > 40) {
            this.lastHitSfx = this.time.now;
            const cls = e.src !== undefined ? snap?.players.find((pl) => pl.s === e.src)?.c : undefined;
            this.sfx(impactSfx(e.dtype, !!cls && HEAVY_WEAPON.has(cls)), e.x, 0, e.y);
          }
          if (e.crit && this.time.now - this.lastCritSfx > 70) { this.lastCritSfx = this.time.now; this.sfx('crit', e.x, 1, e.y); }
        } else {
          const frac = e.frac ?? 0.1;
          this.numbers.add(`p${e.target}`, e.target === me ? 'hurt' : 'ally', amt, x, y, e.target === me ? NUMBER_COLOR.hurt : NUMBER_COLOR.ally);
          J.bleed('player', x, y - 16, 6 + Math.round(frac * 20), u.x, u.y);
          const v = this.viewFor('player', e.target);
          if (v) { v.recoilX = u.x * 6; v.recoilY = u.y * 4; v.squash = 1; }
          if (e.target === me) {
            this.sfx('hit_player', e.x, 2, e.y);
            rumble(frac > 0.2 ? 'heavy' : 'hit');
            J.hitStop(40 + Math.round(frac * 120));
            J.shake(0.004 + frac * 0.02, 120 + frac * 200);
            J.flash(0xa01a1a, 80);
          }
        }
        break;
      }
      case 'heal': {
        const p = snap?.players[e.slot];
        if (!p) break;
        const q = this.P(p.x, p.y);
        const potion = this.time.now - (this.potionAt.get(e.slot) ?? -1e9) < 120;
        this.numbers.add(`p${e.slot}`, 'heal', Big.fromCompact(e.amount), q.x, q.y, NUMBER_COLOR.heal);
        J.embersAt(q.x, q.y - 10, potion ? 12 : 6, 0x8fe07a);
        break;
      }
      case 'shield': { const p = snap?.players[e.slot]; if (p && e.slot === me) this.sfx('shield', p.x, 0, p.y); break; }
      case 'pickup': {
        const p = snap?.players[e.slot];
        const pos = e.slot === me ? this.mePos(snap) : p ? { x: p.x, y: p.y } : null;
        const tq = pos ? this.P(pos.x, pos.y) : this.P(e.x, e.y);
        this.pickupsR.collect(e.id, e.kind, e.x, e.y, tq.x, tq.y);
        if (e.kind === 'potion') {
          this.potionAt.set(e.slot, this.time.now);
          J.embersAt(tq.x, tq.y - 18, 14, 0xff3a4a);
          J.ring(tq.x, tq.y, 26, 0xff5a5a, 300);
          this.dungeon.flashLight(tq.x, tq.y - 16, 140, 0xff4a4a, 1.8, 300);
        } else {
          J.embersAt(tq.x, tq.y - 18, 12, 0x6ab4ff);
          J.ring(tq.x, tq.y, 24, 0x6ab4ff, 280);
        }
        this.sfx(e.kind === 'potion' ? 'potion_glug' : 'heal', e.x, e.slot === me ? 2 : 1, e.y);
        break;
      }
      case 'death': this.onDeath(e, me, snap); break;
      case 'spawn': { const { x, y } = this.P(e.x, e.y); J.dust(x, y, 6, 0x2a1e2a); J.ring(x, y, 24, 0x6a3a9a, 260); break; }
      case 'summon_blink': {
        // a summon lost its route and returned to its owner (sim follow.ts leash): the spirit dissolves where it was
        // stuck and reforms at the owner's side
        const tint = e.kind.startsWith('w_') ? 0x9affc8 : e.kind.startsWith('hx_') ? 0xd7a8ff : 0xd8e8ff;
        const f = this.P(e.fx, e.fy), t = this.P(e.x, e.y);
        J.embersAt(f.x, f.y - 12, 8, tint); J.ring(f.x, f.y, 18, tint, 220);
        J.ring(t.x, t.y, 24, tint, 280); J.embersAt(t.x, t.y - 12, 6, tint); J.dust(t.x, t.y, 3, 0x2a3a2a);
        break;
      }
      case 'elite': {
        if (e.fx === 'spawn') this.pendingBanners.push({ id: e.id, tier: e.tier ?? 1, until: this.time.now + 700 });
        const mp = this.mePos(snap);
        this.elites.onEvent(e, {
          sfx: (id, x, y, priority = 1) => this.sfx(id, x, priority, y),
          bolt: (x0, y0, x1, y1, color) => this.bolt(x0, y0, x1, y1, color),
          distMe: (x, y) => (mp ? Math.hypot(x - mp.x, y - mp.y) : Infinity),
          reduced: this.settings().reducedEffects,
        });
        break;
      }
      case 'wave': this.sfx('wave_spawn', undefined, 1); break;
      case 'objective':
        if (e.total > 0 && e.completed >= e.total && this.flourishRound !== (snap?.round ?? -2)) {
          this.flourishRound = snap?.round ?? -2;
          this.waveClearFlourish();
        }
        break;
      case 'cast': {
        const kit = SKILL_FX[e.skill];
        if (kit) { kit(this.fxCtx(e.slot === me), e); break; }
        const sfx = SFX_FOR_SKILL[e.skill];
        if (sfx) this.sfx(sfx, e.x, e.slot === me ? 2 : 1, e.y);
        const u = iso.unit(e.dx, e.dy);
        const ang = Math.atan2(u.y, u.x);
        const base = this.P(e.x, e.y);
        const x = base.x, y = base.y - 14;
        if (e.skill === 'v_cleave' || e.skill === 'v_sweeping_strike') {
          const strong = e.skill === 'v_sweeping_strike';
          J.arc(x + u.x * 16, y + u.y * 16, ang, strong ? 0xff6a5e : 0xfff0c8, strong ? 1.5 : 1);
          if (this.textures.exists('fx:slash') && this.anims.exists('fx:slash') && !this.settings().reducedEffects) {
            const s = this.add.sprite(x + u.x * 26, y + u.y * 26, 'fx:slash').setRotation(ang).setDepth(4660).setScale(strong ? 0.9 : 0.6, strong ? 0.7 : 0.45).setBlendMode(Phaser.BlendModes.ADD);
            s.play('fx:slash'); s.once('animationcomplete', () => s.destroy());
          }
        } else if (e.skill === 'v_earthbreaker') {
          J.ring(x, y + 14, iso.rx(2.6), 0xffd890, 320); J.ring(x, y + 14, iso.rx(1.8), 0xffffff, 200);
          J.dust(x, y + 14, 14, 0x6a5a48); J.sparksAt(x, y + 10, 18);
          this.dungeon.flashLight(x, y, 220, 0xffc070, 2.4, 260);
          if (e.slot === me) J.hitStop(70);
        } else if (e.skill === 'a_astral_nova') {
          J.ring(x, y + 14, iso.rx(3), 0xd7a8ff, 360); J.ring(x, y + 14, iso.rx(2), 0xffffff, 220);
          J.embersAt(x, y, 20, 0xd7a8ff);
          this.dungeon.flashLight(x, y, 260, 0xb07aff, 2.6, 320);
          if (e.slot === me) J.hitStop(60);
        } else if (e.skill === 'v_rally_cry') { J.ring(x, y + 14, iso.rx(4), 0xffd23f, 500); this.dungeon.flashLight(x, y, 200, 0xffd23f, 1.6, 500); }
        else if (e.skill === 'a_arc_bolt') {
          // arc bolt carries its target point in dx/dy
          const t = this.P(e.dx, e.dy);
          this.bolt(e.x, e.y, e.dx, e.dy, pal.storm);
          this.dungeon.flashLight(t.x, t.y - 14, 150, 0x9fd8ff, 2.2, 160); J.sparksAt(t.x, t.y - 14, 10, 0x9fd8ff);
        }
        else if (e.skill === 'a_spark') { J.embersAt(x + u.x * 14, y + u.y * 14, 3); this.dungeon.flashLight(x, y, 70, 0xff9a3a, 0.9, 80); }
        else if (e.skill === 'v_guard_stance') J.sparksAt(x + u.x * 10, y + u.y * 10, 6, 0x9fd8ff);
        break;
      }
      case 'teleport': {
        // every moving skill snaps the local prediction; only the Arcanist rift ('rift' / no style) draws purple rings
        if (e.slot === me) { this.renderSelf.x = e.x; this.renderSelf.y = e.y; this.net.pred.x = e.x; this.net.pred.y = e.y; }
        const f = this.P(e.fx, e.fy), t = this.P(e.x, e.y);
        const riftKit = !e.style || e.style === 'rift' ? SKILL_FX['teleport:rift'] : undefined;
        if (riftKit) riftKit(this.fxCtx(e.slot === me), { slot: e.slot, skill: 'teleport:rift', x: e.x, y: e.y, dx: e.fx, dy: e.fy });
        else if (!e.style || e.style === 'rift') {
          J.ring(f.x, f.y, 26, 0xb07aff, 200); J.ring(t.x, t.y, 32, 0xd7a8ff, 260);
          J.embersAt(t.x, t.y - 14, 12, 0xd7a8ff);
        } else {
          // class kits register SKILL_FX['teleport:<style>']: x/y = destination, dx/dy = origin
          const kit = SKILL_FX[`teleport:${e.style}`];
          if (kit) kit(this.fxCtx(e.slot === me), { slot: e.slot, skill: `teleport:${e.style}`, x: e.x, y: e.y, dx: e.fx, dy: e.fy });
          else { J.dust(f.x, f.y, 5); J.dust(t.x, t.y, 6); }
        }
        break;
      }
      case 'dodge': {
        const p = snap?.players[e.slot];
        const predicted = e.slot === me && this.time.now - this.lastDashAt < 400;
        if (p && !predicted) this.dashFx(p.x, p.y, p.ddx, p.ddy, e.slot === me);
        break;
      }
      case 'enemy_attack': {
        const en = snap?.enemies.find((x) => x.i === e.id);
        if (e.stage === 'windup') {
          if (en?.boss) this.sfx('boss_telegraph', en.x, 3, en.y);
          else if (en) this.sfx('telegraph_warn', en.x, 0, en.y);
        } else if (en) {
          if (en.boss) { this.sfx(e.attack === 'charge' ? 'boss_charge' : e.attack === 'ring' ? 'boss_ring' : 'hit_player', en.x, 2, en.y); this.juice.shake(0.008, 180); rumble('slam'); }
          else if (['shard', 'orb', 'fan', 'lob'].includes(e.attack)) this.sfx('enemy_shoot', en.x, 0, en.y);
          else this.sfx('enemy_bite', en.x, 0, en.y);
          if (e.attack === 'slam' || e.attack === 'lightpool_burst') { const q = this.P(en.x, en.y); J.ring(q.x, q.y, iso.rx(3.6), 0xff8a3a, 300); J.dust(q.x, q.y, 12); }
        }
        break;
      }
      case 'downed': this.sfx('player_downed', undefined, 5); if (e.slot === me) { J.hitStop(160); J.shake(0.02, 300); rumble('downed'); } break;
      case 'revived': { this.sfx('player_revived', undefined, 3); const p = snap?.players[e.slot]; if (p) { const q = this.P(p.x, p.y); J.ring(q.x, q.y, 36, 0xffd890, 400); J.embersAt(q.x, q.y - 14, 16, 0xffd890); } break; }
      case 'boss_phase':
        this.sfx('boss_phase', undefined, 4);
        J.shake(0.02, 450); J.flash(0xffffff, 120);
        this.banner(`Phase ${e.phase + 1}`, 'danger');
        break;
      case 'boss_adds': this.sfx('wave_spawn', undefined, 4); this.banner('Reinforcements!', 'danger'); break;   // summoning circles are the telegraphs
      case 'stagger': this.banner('Staggered!', 'good'); J.hitStop(90); break;
    }
  }

  /**
   * Deaths: the killing blow's damage type picks the body's death animation (render/DeathFx.ts, on the foe's own sprite):
   * burned foes char and crumble to ash, frozen ones shatter, shocked ones flash to a skeleton and crackle out, rotted
   * ones melt into a puddle, astral ones dissolve upward into light, and physical kills topple like a ragdoll and fade
   * into a dim corpse. Physical crits and one-shots (big overkills) burst into gibs; elites and bosses get a bigger
   * flourish. Kill streaks escalate.
   */
  private onDeath(e: Extract<SimEvent, { t: 'death' }>, me: number, snap: Snapshot | null) {
    const J = this.juice;
    const { x, y } = this.P(e.x, e.y);
    this.lastDeath = { x: e.x, y: e.y };
    const boss = BOSS_KINDS.has(e.kind);
    const v = this.viewFor('enemy', e.id);
    const lh = this.lastHit.get(e.id);
    this.lastHit.delete(e.id);
    const recent = !!lh && this.time.now - lh.at < 300;
    const elite = v?.elite ?? 0;
    // the sim names the killing blow's type (burns and rot that finish a foe included); else the last hit we saw
    const dtype = e.dt ?? (recent ? lh!.dtype : undefined);
    const style = deathStyle(dtype);
    const gib = boss || (style === 'topple' && recent && (lh!.crit || lh!.big));
    const gore = GORE[e.kind] ?? GORE.pursuer;
    let handled = false;
    if (gib) {
      J.gib(e.kind, x, y - 10, boss || elite > 0);
      if (v && !boss && !J.reduced) { v.gibbed = true; v.sprite.setVisible(false); v.extras.forEach((s) => s.setVisible(false)); }
    } else {
      if (style === 'topple') {
        J.bleed(e.kind, x, y - 12, recent ? 12 : 8, lh?.ux ?? 0, lh?.uy ?? 0);
        this.dungeon.addDecal(gore.decal, x, y + 6, gore.color, 0.8 + Math.random() * 0.4);
      }
      // the body takes its death animation; a ragdoll topple is motion, so reduced motion keeps the death sprite instead
      if (v && !v.gibbed && v.sprite.visible && (J.motionOn || style !== 'topple')) {
        const tint = foeActor(this, e.kind, false, !!ENEMY_BY_ID[e.kind]).tint;
        const ux = recent ? lh!.ux : 0, uy = recent ? lh!.uy : 0;
        handled = this.deaths.play(v.sprite, style, { x: v.shadow.x, y: v.shadow.y, ux, uy, big: recent && (lh!.crit || lh!.big), elite, scale: v.baseScale, tint });
        if (handled) {
          for (const s of v.extras) if (s.visible) this.deaths.play(s, style, { x: s.x, y: s.y, ux, uy, big: false, elite: 0, scale: s.scaleX, tint, lite: true });
          v.gibbed = true; v.sprite.setVisible(false); v.extras.forEach((s) => s.setVisible(false));
        }
      }
    }
    J.impact(x, y - 12, 0xffffff, boss ? 3 : elite ? 2.2 : 1.4);
    this.elemTint.delete(e.id);
    // typed bursts for bodies DeathFx does not take (bosses, gibs, reduced motion): ember flares and scorches, frost
    // shatters, storm crackles, decay bursts in spores and slime, astral scatters stars (physical keeps the gore above)
    const dfx = !handled && dtype ? DEATH_FX[dtype] : undefined;
    if (dfx) {
      const big = gib || elite > 0 || boss;
      const [col, hot] = dfx;
      J.starburst(x, y - 12, hot, big ? 1.6 : 1, 180);
      J.orb(x, y - 12, col, big ? 1.1 : 0.7, 240);
      switch (dtype) {
        case 'ember': J.embersAt(x, y - 12, big ? 18 : 9, col); J.dust(x, y - 6, big ? 5 : 2, 0x2a1a10); this.dungeon.addDecal('scorch', x, y + 4, 0x1a1008, big ? 1.4 : 0.8); break;
        case 'frost': J.bits('ice', x, y - 14, big ? 16 : 8, 0xd8f6ff); J.bits('star', x, y - 14, big ? 5 : 2, 0xffffff); break;
        case 'storm': J.bits('zap', x, y - 14, big ? 10 : 5, col); J.sparksAt(x, y - 14, big ? 14 : 7, col); break;
        case 'decay': J.bits('bubble', x, y - 10, big ? 10 : 5, col); J.bits('skull', x, y - 18, big ? 2 : 1, 0xd8f0b0); this.dungeon.addDecal('slime', x, y + 6, 0x3a5a1a, big ? 1.3 : 0.8); break;
        case 'astral': J.bits('star', x, y - 14, big ? 12 : 6, col); J.bits('rune', x, y - 14, big ? 4 : 2, hot); break;
      }
    }
    // the killer's class flourish (render/fx/<class>.ts registerKillFx), on top of the shared burst
    if (e.by !== undefined && e.by >= 0) {
      const ctx = this.fxCtx(e.by === me);
      const k = KILL_FX[ctx.cls(e.by) ?? ''];
      if (k) k(ctx, { slot: e.by, kind: e.kind, x: e.x, y: e.y, dtype, crit: recent && lh!.crit, big: gib, elite, boss });
    }
    this.dungeon.flashLight(x, y - 10, boss ? 300 : elite ? 200 : 130, elite ? (ELITE_COLOR[elite]?.main ?? gore.color) : gore.color, boss ? 3 : elite ? 2.4 : 1.6, boss ? 600 : elite ? 420 : 220);
    if (elite) {
      const col = ELITE_COLOR[elite]?.main ?? 0xffffff;
      J.ring(x, y, iso.rx(2.2), col, 420); J.embersAt(x, y - 14, 20, col);
      this.sfx('crit', e.x, 2, e.y);
    }
    this.sfx(killSfx(dtype), e.x, 1, e.y);   // char sizzle, ice shatter, zap, squelch, chime; physical keeps the pop and crack
    if (e.by === me) {
      J.hitStop(boss ? 220 : elite ? 70 : 28 + Math.min(20, this.combo) * 1.2);
      J.shake(boss ? 0.02 : elite ? 0.009 : 0.003, boss ? 500 : elite ? 200 : 80);
      const now = this.time.now;
      this.combo = now - this.comboAt < 2600 ? this.combo + 1 : 1;
      this.comboAt = now;
      window.dispatchEvent(new CustomEvent('cursebound:combo', { detail: this.combo }));
      const tier = STREAKS.findIndex(([n]) => n === this.combo);
      if (tier >= 0) this.streakFx(tier, snap);
      else if (this.combo >= 5) {
        const col = STREAKS[Math.max(0, STREAKS.findIndex(([n]) => n > this.combo) - 1)]?.[1] ?? 0xffd890;
        J.embersAt(x, y - 12, 3 + Math.min(8, Math.floor(this.combo / 5)), col);
      }
    }
  }

  /** Kill-streak milestone: a shockwave in an escalating colour around the hero, a light pop and a callout. */
  private streakFx(tier: number, snap: Snapshot | null) {
    const J = this.juice;
    const pos = this.mePos(snap);
    if (!pos) return;
    const [n, col] = STREAKS[tier];
    const q = this.P(pos.x, pos.y);
    J.ring(q.x, q.y, iso.rx(2 + tier * 0.6), col, 420 + tier * 60);
    if (tier >= 2) J.ring(q.x, q.y, iso.rx(1.2 + tier * 0.3), 0xffffff, 260);
    J.embersAt(q.x, q.y - 16, 10 + tier * 6, col);
    this.dungeon.flashLight(q.x, q.y - 16, 180 + tier * 30, col, 1.8 + tier * 0.3, 380);
    J.number(q.x, q.y - 30, `${n} KILLS`, `#${col.toString(16).padStart(6, '0')}`, 'crit');
    if (tier >= 3) J.shake(0.005, 140);
    this.sfx('combo', undefined, 2);
  }

  /** The last foe falls: hit-stop, a soft flash, a slow-motion beat and a toll. Presentation only. */
  private waveClearFlourish() {
    const J = this.juice;
    const q = this.P(this.lastDeath.x, this.lastDeath.y);
    J.hitStop(150);
    J.dilate(0.3, 900);
    J.flash(0xfff0d0, 160);
    J.ring(q.x, q.y, iso.rx(4.5), 0xffe0a0, 900);
    J.ring(q.x, q.y, iso.rx(2.5), 0xffffff, 600);
    J.embersAt(q.x, q.y - 16, 30, 0xffd890);
    this.dungeon.flashLight(q.x, q.y - 20, 420, 0xffe0a0, 2.6, 900);
    J.shake(0.006, 260);
    this.sfx('round_clear', undefined, 3);
  }

  /** Dash feedback: dust kicked up behind, a quick ring, a whoosh. */
  private dashFx(wx: number, wy: number, dx: number, dy: number, mine: boolean) {
    const J = this.juice;
    const q = this.P(wx, wy);
    const u = iso.unit(-dx, -dy);
    J.dust(q.x + u.x * 6, q.y + u.y * 3, 6, 0x5a4a40);
    J.ring(q.x, q.y, 18, 0xbfe8ff, 200);
    if (!J.low) J.sparksAt(q.x + u.x * 8, q.y - 6, 4, 0xdff4ff);
    if (mine) this.sfx('dodge', undefined, 1);
  }

  /** Jagged lightning between two world points, lifted to chest height. */
  private bolt(x0: number, y0: number, x1: number, y1: number, color: number) {
    const a = this.P(x0, y0), b = this.P(x1, y1);
    const pts: { x: number; y: number }[] = [{ x: a.x, y: a.y - 16 }];
    const n = 8;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      pts.push({ x: Math.round(a.x + (b.x - a.x) * t + (Math.random() - 0.5) * 16), y: Math.round(a.y + (b.y - a.y) * t - 16 + (Math.random() - 0.5) * 12) });
    }
    pts.push({ x: b.x, y: b.y - 14 });
    this.bolts.push({ pts, until: this.time.now + 160, color });
  }

  /**
   * Frame-rate watchdog: once a second, count a second as slow when the average frame runs under 70% of the tier's
   * frame rate (fast seconds pay back two). Twelve slow seconds arm a report, delivered only between fights, with no
   * boss alive and no cutscene playing: on Auto that steps this device down one tier (GameCanvas rebuilds), on a pinned
   * tier it only leaves a suggestion for the settings panel. Never on low (nothing cheaper), never in the first 8 s
   * (texture generation and shader compiles), never while the tab is hidden.
   */
  private watchFrames(realNow: number, avgFrame: number, snap: Snapshot | null) {
    const w = this.watch;
    if (w.done || gfx().tier === 'low' || realNow - w.born < 8000 || realNow - w.at < 1000) return;
    w.at = realNow;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!w.pending) {
      const slow = avgFrame > 0 && avgFrame < 250 && 1000 / avgFrame < gfx().fps * 0.7;
      w.slowSec = slow ? w.slowSec + 1 : Math.max(0, w.slowSec - 2);
      if (w.slowSec >= 12) w.pending = true;
      return;
    }
    const safe = !!snap && snap.phase !== 'COMBAT' && snap.phase !== 'ROUND_SETUP' && !snap.enemies.some((e) => e.boss) && !this.cine?.active;
    if (!safe) return;
    w.done = true;
    reportSlowFrames();
  }

  // ---------------- main loop ----------------

  update(_time: number, delta: number) {
    if (!this.ready) return;
    const set = this.settings();
    const J = this.juice;
    J.reduced = set.reducedEffects; J.shakeOn = set.screenShake; J.flashOn = set.flashes; J.motionOn = !set.reducedMotion && set.hitStop; J.numbersOn = set.damageNumbers;
    const realNow = performance.now();
    this.frameTimes.push(delta);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    // degrade cosmetics first when frames run a third over the tier's budget (22 ms at 60 fps, 45 ms on low's 30)
    const avgFrame = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    J.low = avgFrame > (1000 / gfx().fps) * 1.35;
    if (this.net.map) this.dungeon.build(this.net.map);
    if (!this.camFree) { this.cameras.main.removeBounds(); this.camFree = true; }
    // hit-stop freezes presentation time (authority keeps running; interpolation catches up afterwards)
    if (!J.frozen) this.frozenNow = realNow;
    const now = J.frozen ? this.frozenNow : realNow;
    const ip = this.net.interpolation(now, 100);
    const latest = this.net.snaps[this.net.snaps.length - 1]?.snap ?? null;
    if (latest && latest.phase !== this.lastPhase) {
      this.lastPhase = latest.phase;
      if (latest.phase === 'ROUND_SETUP') {
        for (const k of [...this.actors.keys()]) this.destroyView(k);
        this.renderSelf.init = false; this.combo = 0; this.lastHit.clear(); this.pickupsR.clear(); this.pendingBanners = [];
        this.roomFx?.clear();
        this.numbers.clear(); this.deaths.clear();
        this.clickFx?.clear();
        this.camSnap = 'cut';   // a new round starts the camera on the hero
        this.releaseNames();
      }
    }
    this.sendInputs(delta, latest);
    this.watchFrames(realNow, avgFrame, latest);
    this.loot?.update(latest, this.net.events);   // reads (does not consume) the event queue
    this.cine?.ingest(this.net.events, latest);   // cutscene triggers (reads, does not consume)
    this.bossFx.sync(latest, this.net.map);   // which entities belong to scripted bosses (render/bosses)
    this.handleEvents(latest);
    J.update(delta / 1000);
    this.numbers.update();
    this.deaths.update();
    this.elites.begin(this.time.now);
    this.outlines.begin();
    this.aff.begin(this.time.now);
    this.roomFx?.begin(latest);
    this.themeFx.begin();
    this.bossFx.begin(this.net.map);   // scripted bosses' per-frame hooks (the sky / moon hazard layer)
    this.focus.length = 0;
    if (!ip || !latest) { this.drawFx(); return; }
    const { a, b, t } = ip;
    const me = netStore.get().slot;
    const seen = new Set<string>();
    /** where each hero is drawn this frame (the spectate camera follows a teammate's) */
    const drawnAt = new Map<number, { x: number; y: number }>();
    for (const pb of b.players) {
      const pa = a.players.find((x) => x.s === pb.s) ?? pb;
      let x = pa.x + (pb.x - pa.x) * t, y = pa.y + (pb.y - pa.y) * t;
      if (pb.s === me) {
        const lp = latest.players[me];
        if (this.net.pred.valid && lp.life === 'alive' && movesIn(latest.phase)) {   // COMBAT and the door vote
          const tx = this.net.pred.x, ty = this.net.pred.y;
          if (!this.renderSelf.init || Math.hypot(tx - this.renderSelf.x, ty - this.renderSelf.y) > 1.5) { this.renderSelf.x = tx; this.renderSelf.y = ty; this.renderSelf.init = true; }
          else {
            // dashes move fast: follow the prediction tightly while dashing, smoothly otherwise
            const k = Math.min(1, delta / (this.net.pred.dodgeTimer > 0 ? 16 : 45));
            this.renderSelf.x += (tx - this.renderSelf.x) * k; this.renderSelf.y += (ty - this.renderSelf.y) * k;
          }
          x = this.renderSelf.x; y = this.renderSelf.y;
        } else { x = lp.x; y = lp.y; this.renderSelf = { x, y, init: true }; }
        this.camTarget = { x, y };   // the hero sits dead centre (no aim look-ahead)
        // predicted dash: instant feedback without waiting for the authority's event
        if (this.net.pred.dashAt !== this.lastDashAt && this.net.pred.dashAt > 0) {
          this.lastDashAt = this.net.pred.dashAt;
          this.dashFx(x, y, this.net.pred.dodgeDirX, this.net.pred.dodgeDirY, true);
        }
      }
      const key = `p${pb.s}`;
      seen.add(key);
      drawnAt.set(pb.s, { x, y });
      this.drawPlayer(key, pb.s === me ? latest.players[me] : pb, x, y, pb.s === me, delta);
    }
    // fallen for the round: the camera follows the teammate chosen in the spectate bar (ui/Spectate.tsx)
    const watched = spectateTarget(latest.players, me, spectateStore.get().slot);
    const wp = watched === null ? undefined : drawnAt.get(watched);
    if (wp) this.camTarget = { x: wp.x, y: wp.y };
    // back on your feet (revived, or respawned after spectating): the camera eases back to you
    const myLife = latest.players[me]?.life ?? null;
    if (this.lastLife && this.lastLife !== 'alive' && myLife === 'alive' && this.camSnap === 'none') this.camSnap = 'ease';
    this.lastLife = myLife;
    for (const eb of b.enemies) {
      const ea = a.enemies.find((x) => x.i === eb.i && x.g === eb.g) ?? eb;
      const x = ea.x + (eb.x - ea.x) * t, y = ea.y + (eb.y - ea.y) * t;
      if (this.roomFx?.drawRunner(eb, x, y)) continue;   // the treasure imp has its own sprite (render/RoomEvents.ts)
      const key = `e${eb.i}:${eb.g}`;
      seen.add(key);
      this.drawEnemy(key, eb, x, y, delta);
    }
    this.outlines.end();
    this.themeFx.end();
    {
      // blindness: darkness closes in around the local hero (other heroes show a dark cloud, Afflictions.drawPlayer)
      const lp = latest.players[me];
      this.aff.drawBlind(lp ?? null, this.renderSelf.init ? this.renderSelf.x : lp?.x ?? 0, this.renderSelf.init ? this.renderSelf.y : lp?.y ?? 0, delta);
    }
    for (const [key, v] of this.actors) {
      if (seen.has(key)) continue;
      if (!v.dying) { v.dying = true; v.lastSeen = realNow; }
      v.sprite.setAlpha(Math.max(0, 1 - (realNow - v.lastSeen) / 260));
      v.bar?.clear(); v.badge?.setVisible(false); v.label?.setVisible(false); v.shadow.setAlpha(0);
      if (realNow - v.lastSeen > 260) {
        // the slain stay where they fell (or flew) for the rest of the floor; gibbed foes leave only gore
        if (key.startsWith('e') && !v.gibbed && v.animKey.includes(':death:')) {
          const anim = this.anims.get(v.animKey);
          const last = anim?.frames[anim.frames.length - 1];
          if (last) this.dungeon.stampCorpse(v.sprite.texture.key, last.frame.name, v.sprite.x, v.sprite.y, v.sprite.originX, v.sprite.originY, v.sprite.flipX);
        }
        if (key === this.hoverKey) { this.hoverKey = null; this.hoverFx = null; }
        this.destroyView(key);
      }
    }
    this.flushBanners(latest);
    this.updateHover(latest);
    this.placeNames();
    this.drawClickFx(latest);
    if ((this.frameCount++ & 63) === 0) this.applyPostFx();
    this.drawProjectiles(latest);
    this.aff.drawShots(latest);
    this.drawHazards(latest);
    this.drawTelegraphs(latest);
    this.pickupsR.update(latest.pickups, latest.tick, this.time.now, delta);
    this.aff.drawCaches(latest.pickups);   // cursed caches (render/Afflictions.ts)
    this.roomFx?.update(latest, this.renderSelf.init ? this.renderSelf : null, delta);
    this.guideMark?.update(latest, this.time.now, this.settings().reducedMotion);   // tutorial walk mark
    this.drawDebug(latest);
    this.drawFx();
    this.bossFx.draw(this.time.now);
    this.doorsR?.update(latest, this.renderSelf.init ? this.renderSelf : null, me, delta);
    this.cine?.update(delta, latest, this.focus);
    this.dungeon.update(this.time.now, this.focus);
    this.cine?.applyLights();
    this.bossFx.frame(latest, delta);   // scripted bosses' lair lighting: the Crater Horror's darkness (after the cutscene lights)
    const cam = this.cameras.main;
    const cc = this.cine?.camera();   // a cutscene drives the camera (integer zoom only)
    if (cc) {
      if (cam.zoom !== cc.zoom) cam.setZoom(cc.zoom);
      cam.scrollX = Math.round(cc.x - this.W / 2);
      cam.scrollY = Math.round(cc.y - this.H / 2);
      this.stepCamera(delta, latest, me, watched, drawnAt, { x: cc.x, y: cc.y + CAM_LIFT });   // play resumes from here
      return;
    }
    if (cam.zoom !== 1) cam.setZoom(1);
    const pos = this.stepCamera(delta, latest, me, watched, drawnAt, null);
    if (pos) {
      cam.scrollX = pos.x - this.W / 2;
      cam.scrollY = pos.y - CAM_LIFT - this.H / 2;
    }
  }

  /**
   * League of Legends camera (game/cameraRig.ts): unlocked by default, edge panning and middle-mouse drag, the lock
   * key (Y) follows the hero, Center (C) and F1 / F2-F5 hold the view on you or a teammate, a controller always
   * follows, spectating follows the watched teammate until you pan. Returns the ground point at the view centre.
   */
  private stepCamera(delta: number, s: Snapshot, me: number, watched: number | null, drawnAt: Map<number, Pt>, cine: Pt | null): Pt | null {
    const ci = this.input2.camera();
    const dt = Math.min(0.1, delta / 1000);
    // The play camera is locked to the hero, dead centre: no lock toggle, edge panning or middle-drag (the free
    // League-style camera was dropped by player feedback). F1-F5 still hold the view on you / a teammate.
    const pan = { x: 0, y: 0 };
    const follow = this.P(this.camTarget.x, this.camTarget.y);
    let hold: Pt | null = null;
    if (ci.focus !== null) {
      // F1 = you, F2-F5 = teammates in seat order
      const slot = ci.focus === 0 ? me : s.players.filter((p) => p.s !== me).sort((a, b) => a.s - b.s)[ci.focus - 1]?.s;
      const at = slot === undefined ? undefined : drawnAt.get(slot);
      if (at) hold = this.P(at.x, at.y);
    } else if (ci.center) hold = follow;
    const snap = this.camSnap;
    // a pending cut waits for the hero to be placed this round (the follow point is stale until then)
    if (snap !== 'cut' || this.renderSelf.init) this.camSnap = 'none';
    return this.rig.step({
      dt, follow, subject: `p${watched ?? me}`, spectating: watched !== null, locked: true, forceFollow: this.input2.usingPad,
      // reduced: true = no follow smoothing, so the hero never drifts off centre (renderSelf is already smoothed)
      hold, pan, snap: snap === 'cut' && !this.renderSelf.init ? 'none' : snap, cine, reduced: true,
      map: this.net.map ? { w: this.net.map.w, h: this.net.map.h } : null,
    });
  }

  /**
   * Enemy names above their health bars. Bosses, champions and rares always; ordinary foes when hovered, targeted by
   * a click-to-attack, or hurt by a hit in the last few seconds (only the most recently hit few, capped by graphics
   * tier, so a big pack never turns into a wall of text). Text objects are pooled per foe and only re-rasterised
   * when the name or colour changes.
   */
  private placeNames() {
    const now = this.time.now;
    const order = this.clickMove.order;
    const target = order?.k === 'attack' ? `e${order.i}:${order.g}` : null;
    const cap = { low: 3, medium: 5, high: 8, ultra: 10 }[gfx().tier] ?? 6;
    const shown: typeof this.nameReq = [];
    const hurt: typeof this.nameReq = [];
    for (const r of this.nameReq) {
      if (r.prio > 0 || r.key === this.hoverKey || r.key === target) shown.push(r);
      else if (r.hurt && now - r.hitAt < 5000) hurt.push(r);
    }
    hurt.sort((a, b) => b.hitAt - a.hitAt);
    for (let i = 0; i < hurt.length && i < cap; i++) shown.push(hurt[i]!);
    const live = new Set<string>();
    for (const r of shown) {
      live.add(r.key);
      let t = this.nameTags.get(r.key);
      if (!t) {
        t = this.namePool.pop() ?? this.add.text(0, 0, '', { fontFamily: FONT_WORLD, fontSize: `${WORLD_TEXT_PX.label}px`, color: '#ebe0c8', stroke: '#070505', strokeThickness: 3, resolution: 1 }).setOrigin(0.5, 1).setDepth(4550);
        this.nameTags.set(r.key, t);
      }
      const sig = `${r.color}|${r.text}`;
      if (t.getData('sig') !== sig) { t.setData('sig', sig); t.setColor(r.color).setText(r.text); }
      t.setPosition(Math.round(r.x), Math.round(r.y)).setVisible(true);
      // a cohort count rides above the name
      if (r.badge?.visible) r.badge.setY(Math.round(r.y - WORLD_TEXT_PX.label + 2));
    }
    for (const [key, t] of this.nameTags) {
      if (live.has(key)) continue;
      t.setVisible(false);
      this.nameTags.delete(key);
      this.namePool.push(t);
    }
    this.nameReq.length = 0;
  }

  private releaseNames() {
    for (const t of this.nameTags.values()) { t.setVisible(false); this.namePool.push(t); }
    this.nameTags.clear();
    this.nameReq.length = 0;
  }

  /** Hide / restore a live actor while a cutscene puppet stands in for it (game/cinematic). */
  private cineHide(v: ActorView, hidden: boolean) {
    if (!hidden && !v.sprite.getData('cineHidden')) return;
    v.sprite.setVisible(!hidden); v.shadow.setVisible(!hidden); v.bar?.setVisible(!hidden);
    v.extras.forEach((s) => s.setVisible(!hidden));
    if (hidden) { v.label?.setVisible(false); v.badge?.setVisible(false); v.shield?.setVisible(false); }
    v.sprite.setData('cineHidden', hidden);
  }

  /** Elite spawn callouts once the snapshot knows the elite's name (or a generic one after a moment). */
  private flushBanners(s: Snapshot) {
    if (!this.pendingBanners.length) return;
    const now = this.time.now;
    const keep: { id: number; tier: number; until: number }[] = [];
    let shown = false;
    for (const b of this.pendingBanners) {
      const e = s.enemies.find((x) => x.i === b.id);
      if (!e && now < b.until) { keep.push(b); continue; }
      if (shown) continue;   // one callout per batch
      shown = true;
      const name = e ? eliteName(ENEMY_BY_ID[e.k]?.name ?? e.k, e.af) : null;
      if (b.tier >= 2) this.banner(name ? `Rare: ${name}` : 'A rare foe approaches', 'danger');
      else this.banner(name ? `Champion: ${name}` : 'Champions approach', 'info');
      this.sfx('wave_spawn', e?.x, 2, e?.y);
    }
    this.pendingBanners = keep;
  }

  private sendInputs(delta: number, latest: Snapshot | null) {
    const s = this.input2.sample();
    if (this.roomFx && latest) {
      // room events: Interact near a shrine / altar / merchant, or a click on one (render/RoomEvents.ts)
      const k = this.game.canvas.clientWidth / this.W || 1, cam = this.cameras.main;
      const click = s.primaryEdge && !s.usingPad && this.input2.pointer.inside ? { x: this.input2.pointer.x / k + cam.scrollX, y: this.input2.pointer.y / k + cam.scrollY } : null;
      // a click that used / walks to an event is not also a ground click (the ground under a tall sprite lies behind it)
      if (this.roomFx.input((s.pressed & 64) !== 0, click, this.renderSelf.init ? this.renderSelf : null)) { s.primaryEdge = false; s.primary = false; }
    }
    this.inputAcc += delta;
    if (this.inputAcc > 100) this.inputAcc = 100;
    const out = this.driveInput(s, latest);
    while (this.inputAcc >= 1000 / 60) {
      this.inputAcc -= 1000 / 60;
      this.net.sendInput(out.mx, out.my, out.ax, out.ay, out.buttons);
    }
  }

  /**
   * One frame of intention (world move vector, aim offset, buttons) from the sampled input: click-to-move, the WASD
   * scheme and the gamepad all run through ClickMove (game/input/ClickMove.ts). Also picks what the cursor is over
   * (foe by sprite bounds, pickup / loot / door), sets the pixel cursor and drops click markers.
   */
  private driveInput(s: Sample, latest: Snapshot | null): DriveOut {
    const set = this.settings();
    const lp = latest?.players[netStore.get().slot];
    const self = lp ? (this.net.pred.valid && lp.life === 'alive' ? { x: this.net.pred.x, y: this.net.pred.y } : { x: lp.x, y: lp.y }) : null;
    const cam = this.cameras.main;
    const k = this.game.canvas.clientWidth / this.W || 1;
    const sp = { x: this.input2.pointer.x / k + cam.scrollX, y: this.input2.pointer.y / k + cam.scrollY };
    const over = this.input2.pointer.inside && !s.usingPad;
    // a held click keeps steering while the pointer crosses the HUD; the WASD scheme always aims at the pointer
    const cursor = !s.usingPad && (over || s.primary || set.controlScheme === 'wasd') ? iso.toWorld(sp.x, sp.y) : null;
    const enemies = latest?.enemies ?? [];
    const screenHit = (e: SnapEnemy): number | null => {
      const v = this.actors.get(`e${e.i}:${e.g}`);
      if (!v || v.dying || v.gibbed) return null;
      const spr = v.sprite, w = spr.width * spr.scaleX * 0.42, h = spr.height * spr.scaleY * spr.originY * 0.9;
      if (sp.x < spr.x - w || sp.x > spr.x + w || sp.y < spr.y - h || sp.y > spr.y + 6) return null;
      return spr.depth;
    };
    const combat = latest?.phase === 'COMBAT';
    const hoverEnemy = over && combat ? pickEnemy(enemies, cursor, screenHit) : null;
    const doors = (latest as { doors?: { i?: number; x: number; y: number; nx?: number; ny?: number }[] } | null)?.doors ?? [];
    // the door renderer knows its art's exact bounds: trust its hover first
    const hd = this.doorHover !== null ? doors.find((d, n) => (d.i ?? n) === this.doorHover) : undefined;
    const hoverGround = !over || hoverEnemy || !latest ? null
      : hd ? { kind: 'door' as const, x: hd.x, y: hd.y, r: 1.2, index: this.doorHover! }
      : pickGround(cursor, sp, (x, y) => iso.p(x, y), latest.pickups ?? [], latest.lt ?? [], doors);
    this.clickHover = { enemy: hoverEnemy, ground: hoverGround, combat };
    const out = this.clickMove.update({
      now: performance.now(), scheme: set.controlScheme === 'wasd' ? 'wasd' : 'click', phase: latest?.phase ?? '', blocked: s.blocked || !latest || cinematicHeld(latest),
      life: lp?.life ?? null, self, buffs: lp?.buffs ?? [], tether: (lp as { teth?: [number, number, number] } | undefined)?.teth ?? null,
      skills: lp?.cd.map((c) => c[0]) ?? [], map: this.net.map, enemies, reach: basicReach(lp?.c),
      cursor, hoverEnemy, hoverGround, primary: s.primary, primaryEdge: s.primaryEdge, force: s.force,
      buttons: s.buttons, pressed: s.pressed, keyMove: iso.dirToWorld(s.mx, s.my),
      padAim: s.stickAim ? iso.dirToWorld(s.stickAim.x, s.stickAim.y) : null, usingPad: s.usingPad,
      assist: { autoAttack: set.autoAttack, aimAssist: set.aimAssist },
    });
    const now = performance.now();
    for (const m of this.clickMove.fx.splice(0)) {
      this.clickFx?.mark(m.x, m.y, m.kind);
      // a soft tick on a fresh ground click (not on UI move-to requests or re-paths while held)
      if (m.kind === 'move' && !m.ui && now - this.lastClickSfx > 150) { this.lastClickSfx = now; this.sfx('move_click', undefined, 0); }
    }
    // pixel cursor (re-asserted if another renderer reset it); the browser re-serialises the value, so compare to that
    const kind: GameCursor | '' = !over ? '' : hoverEnemy ? 'attack' : hoverGround ? 'grab' : 'default';
    const style = this.game.canvas.style;
    if (kind !== this.cursorKind || style.cursor !== this.cursorCss) {
      this.cursorKind = kind;
      style.cursor = kind ? gameCursor(kind) : '';
      this.cursorCss = style.cursor;
    }
    return out;
  }

  /** Ground feedback for click-to-move: click markers, the hovered foe / item, the locked attack target. */
  private drawClickFx(s: Snapshot) {
    if (!this.clickFx) return;
    const feet = (i: number, g: number) => { const v = this.actors.get(`e${i}:${g}`); return v && !v.dying ? { x: v.shadow.x, y: v.shadow.y } : null; };
    const h = this.clickHover;
    let hover: { x: number; y: number; r: number; kind: 'enemy' | 'item' } | null = null;
    if (h.enemy) { const f = feet(h.enemy.i, h.enemy.g); if (f) hover = { ...f, r: h.enemy.r, kind: 'enemy' }; }
    else if (h.ground) { const q = this.P(h.ground.x, h.ground.y); hover = { x: q.x, y: q.y, r: h.ground.kind === 'door' ? 0.9 : 0.4, kind: 'item' }; }
    const t = this.clickMove.target;
    const te = t ? s.enemies.find((e) => e.i === t.i && e.g === t.g && e.st !== 'dying') : undefined;
    const tf = te ? feet(te.i, te.g) : null;
    const me = this.mePos(s);
    this.clickFx.update(this.time.now, {
      hover, target: te && tf ? { ...tf, r: te.r } : null,
      path: this.settings().devOverlay && me && this.clickMove.path.length ? [me, ...this.clickMove.path] : null,
      still: this.settings().reducedMotion,
    });
  }

  /**
   * Position/scale/rotation for an actor: recoil, squash, elite scale and the stagger flinch, a ~110 ms squash that
   * leans the body away from the hit (sprites pivot on their feet), harder for bigger hits. The slain are animated by
   * render/DeathFx.ts.
   */
  private applyRecoil(v: ActorView, x: number, y: number, delta: number) {
    const decay = Math.pow(0.0005, delta / 1000);
    v.recoilX *= decay; v.recoilY *= decay; v.squash *= Math.pow(0.002, delta / 1000);
    let sq = v.squash, lean = 0;
    const bs = v.baseScale;
    if (v.flinchAt !== undefined) {
      const k = (this.juice.clock - v.flinchAt) / FLINCH_MS;
      if (k >= 1 || k < 0) v.flinchAt = undefined;
      else if (this.juice.motionOn) {
        // snap into the flinch in the first quarter, ease back out
        const env = k < 0.25 ? k / 0.25 : (1 - (k - 0.25) / 0.75) ** 2;
        const mag = v.flinchMag ?? 0.4;
        lean = (v.flinchSide ?? 1) * 0.24 * mag * env;
        sq = Math.max(sq, mag * env);
      }
    }
    v.sprite.setPosition(Math.round(x + v.recoilX), Math.round(y + v.recoilY)).setRotation(lean).setScale(bs * (1 + sq * 0.18), bs * (1 - sq * 0.14));
    v.shadow.setPosition(Math.round(x), Math.round(y));
  }

  private drawPlayer(key: string, p: SnapPlayer, x: number, y: number, isMe: boolean, delta: number) {
    const actor = this.heroActor(p.c);
    const { x: px, y: py } = this.P(x, y);
    const depth = iso.depth(x, y);
    const v = this.view(key, actor, px, py, 'player');
    v.lastSeen = performance.now(); v.dying = false;
    v.sprite.setAlpha(p.con ? 1 : 0.55).setDepth(depth);
    this.applyRecoil(v, px, py, delta);
    v.shadow.setAlpha(1);
    if (p.life === 'alive') this.focus.push({ x: px, y: py, depth });
    // each hero carries a warm lantern light so the action is always readable
    let lantern = this.lanterns.get(p.s);
    if (!lantern && this.lights && this.dungeon.lighting) { lantern = this.lights.addLight(px, py - 16, isMe ? 260 : 190, isMe ? 0xffd8a0 : 0xffc890, isMe ? 1.25 : 0.9); this.lanterns.set(p.s, lantern); }
    if (lantern) { lantern.x = px; lantern.y = py - 16; lantern.intensity = (p.life === 'alive' ? (isMe ? 1.25 : 0.9) : 0.4) * (0.95 + Math.random() * 0.08); }
    // the local hero dashes on prediction (instant), remote heroes on the snapshot
    const dashing = isMe && this.net.pred.valid && p.life === 'alive' ? this.net.pred.dodgeTimer > 0 : p.anim === 'dodge';
    const anim = dashing ? 'dodge' : p.anim;
    const st: ActorState = anim === 'death' ? 'death' : anim === 'downed' ? 'downed' : anim as ActorState;
    this.play(v, st, this.dirOf(p.ax, p.ay));
    const now = this.time.now;
    if (dashing && now - v.lastAfterimage > 28) { v.lastAfterimage = now; this.juice.afterimage(v.sprite, 0x8fd8ff, 0.5, 240); }
    const surging = isMe ? this.net.pred.surgeTimer > 0 : (p.sg ?? 0) > 0;
    if (!dashing && surging && now - v.lastAfterimage > 70) { v.lastAfterimage = now; this.juice.afterimage(v.sprite, 0xbfe8ff, 0.22, 160); }
    if (isMe && surging && now - this.lastSurgeFx > 120) { this.lastSurgeFx = now; this.juice.dust(px, py, 1, 0x4a3e36); }
    if (anim === 'run' && now - v.lastStep > 280) { v.lastStep = now; this.juice.dust(px, py, 1, 0x4a3e36); this.sfx('footstep', x, isMe ? 1 : 0, y); }
    const set = this.settings();
    const pal = this.palette();
    if (set.allyOutline && v.sprite.preFX && !v.sprite.getData('outline')) { v.sprite.preFX.addGlow(pal.allyOutline, 2, 0, false, 0.1, 8); v.sprite.setData('outline', true); }
    if (!v.label) v.label = this.add.text(0, 0, '', { fontFamily: FONT_WORLD, fontSize: `${WORLD_TEXT_PX.label}px`, color: '#ede3cc', stroke: '#070505', strokeThickness: 3, resolution: 1 }).setOrigin(0.5, 1);
    v.label.setText(isMe ? '' : `${p.n}${p.con ? '' : ' ✕'}`).setPosition(Math.round(px), Math.round(py - 44)).setDepth(4500).setVisible(!isMe);
    if (!v.bar) v.bar = this.add.graphics();
    v.bar.clear().setDepth(4500);
    if (!isMe || p.life !== 'alive') {
      const bx = Math.round(px - 14), by = Math.round(py - 40);
      v.bar.fillStyle(0x070505, 1).fillRect(bx - 1, by - 1, 30, 5);
      v.bar.fillStyle(0xa3192a, 1).fillRect(bx, by, Math.round(28 * p.hp), 3);
      v.bar.fillStyle(0xff6a5e, 1).fillRect(bx, by, Math.round(28 * p.hp), 1);
      if (p.sh > 0) v.bar.fillStyle(0xc8eaff, 1).fillRect(bx, by - 2, Math.round(28 * p.sh), 1);
    }
    if (p.life === 'downed') {
      const prog = p.self > 0 ? 1 - p.self / 5 : p.rev;
      const segs = 12;
      for (let i = 0; i < segs; i++) {
        const ang = -Math.PI / 2 + (i / segs) * Math.PI * 2;
        v.bar.fillStyle(i / segs < prog ? 0xffd23f : 0x3a2a2a, 1).fillRect(Math.round(px + Math.cos(ang) * 22) - 2, Math.round(py + Math.sin(ang) * 11) - 2, 4, 4);
      }
    }
    { const tint = heroTint(p); if (tint !== null) v.sprite.setTint(tint); else v.sprite.clearTint(); }   // frozen / poisoned / chilled heroes
    this.aff.drawPlayer(p, x, y, v.sprite, isMe);
    const u = iso.unit(p.ax, p.ay);
    if (p.guard) {
      if (!v.shield) { v.shield = this.add.sprite(0, 0, 'fx:shield').setBlendMode(Phaser.BlendModes.ADD); if (this.anims.exists('fx:shield')) v.shield.play('fx:shield'); }
      v.shield.setVisible(true).setPosition(px + u.x * 12, py - 16 + u.y * 8).setDepth(depth + 1).setAlpha(0.8);
    } else v.shield?.setVisible(false);
    if (isMe && p.life === 'alive') {
      // aim marker on the ground in front of the hero
      if (!this.aimMark) this.aimMark = this.add.graphics();
      const gx = Math.round(px + u.x * 30), gy = Math.round(py + u.y * 30);
      this.aimMark.clear().setDepth(-55);
      this.aimMark.fillStyle(0x070505, 0.9).fillRect(gx - 4, gy - 2, 9, 5);
      this.aimMark.fillStyle(0xffdc8a, 1).fillRect(gx - 3, gy - 1, 7, 3);
      this.aimMark.fillStyle(0xfff4d0, 1).fillRect(gx - 1, gy - 1, 3, 1);
      this.drawDodgePips(px, py, p);
    } else if (isMe) { this.aimMark?.clear(); this.pipsG.clear(); }
    if (this.cine?.hides(key)) {   // a cutscene puppet stands in for this hero
      this.cineHide(v, true);
      if (lantern) lantern.intensity = 0;
      if (isMe) { this.aimMark?.clear(); this.pipsG.clear(); }
    } else this.cineHide(v, false);
  }

  /** Dash charges under the local hero while any is recharging (fades out shortly after they are full). */
  private drawDodgePips(px: number, py: number, p: SnapPlayer) {
    const g = this.pipsG.clear();
    const max = p.dcm ?? DODGE.charges;
    const have = this.net.pred.valid ? this.net.pred.dodgeCharges : (p.dc ?? max);
    const cd = this.net.pred.valid ? this.net.pred.dodgeCooldown : p.dcd;
    const now = this.time.now;
    if (have < max) this.pipsFullAt = now;
    const alpha = have < max ? 1 : Math.max(0, 1 - (now - this.pipsFullAt) / 450);
    if (alpha <= 0 || max <= 1) return;
    const prog = Math.max(0, Math.min(1, 1 - cd / DODGE.cooldownSec));
    const w = 7, gap = 3, total = max * w + (max - 1) * gap;
    for (let i = 0; i < max; i++) {
      const x = Math.round(px - total / 2 + i * (w + gap)), y = Math.round(py + 9);
      g.fillStyle(0x070505, 0.85 * alpha).fillRect(x - 1, y - 1, w + 2, 4);
      if (i < have) g.fillStyle(0x9fe0ff, alpha).fillRect(x, y, w, 2);
      else if (i === have) { g.fillStyle(0x2a3a48, alpha).fillRect(x, y, w, 2); g.fillStyle(0x5a90b0, alpha).fillRect(x, y, Math.round(w * prog), 2); }
      else g.fillStyle(0x2a3a48, alpha).fillRect(x, y, w, 2);
    }
  }

  private drawEnemy(key: string, e: SnapEnemy, x: number, y: number, delta: number) {
    const look = foeActor(this, e.k, e.boss, !!ENEMY_BY_ID[e.k]);   // a tinted stand-in until a foe has its own sprite
    const actor = look.actor as ActorId;
    const { x: px, y: py } = this.P(x, y);
    const depth = iso.depth(x, y);
    const v = this.view(key, actor, px, py, e.k);
    v.lastSeen = performance.now(); v.dying = false;
    v.elite = e.el ?? 0;
    v.baseScale = e.mb ? MINIBOSS_SCALE : EliteFx.scaleFor(e.el);   // named mini-bosses stand bigger
    if (e.st !== 'dying') v.lastHp = e.hp;
    if (v.gibbed) { v.bar?.clear(); v.badge?.setVisible(false); v.shadow.setAlpha(0); return; }
    const st: ActorState = e.st === 'dying' ? 'death' : e.st === 'windup' ? 'windup' : e.st === 'attack' || e.st === 'recovery' ? 'attack' : e.st === 'stagger' || e.stag ? 'stagger' : e.st === 'move' ? 'run' : 'idle';
    const bl = e.boss ? this.bossFx.look(e, delta) : null;   // a flying boss aloft (render/bosses: the Gale Wyrm)
    this.play(v, bl?.state ?? st, this.dirOf(e.fx, e.fy));
    v.sprite.setDepth(depth).setAlpha(1);
    this.applyRecoil(v, px, py, delta);
    if (bl) { v.sprite.y -= Math.round(bl.lift); v.sprite.setDepth(depth + bl.lift * 2); }
    // white hit flash, then the element tint: driven by the hit event together with the stagger flinch, so it lands on
    // the frame the hit does (bigger hits flash a touch longer); the snapshot flag only covers hits we saw no event for
    const sinceHit = v.flinchAt === undefined ? Infinity : this.juice.clock - v.flinchAt;
    const flashing = this.settings().flashes && (sinceHit < ((v.flinchMag ?? 0) > 0.7 ? 80 : 55) || (e.flash && sinceHit === Infinity));
    if (flashing) v.sprite.setTintFill(0xffffff);
    else if (e.st === 'windup') v.sprite.setTint((Math.floor(this.time.now / 70) % 2) ? 0xff9a8a : 0xffffff);   // readable windup blink
    else if (this.elemTintOf(e.i)) v.sprite.setTint(this.elemTintOf(e.i));   // shock / poison / frost / scorch / starlight after a typed hit
    else if (e.fz) v.sprite.setTint(0x9fe8ff);                 // frozen solid
    else if (e.ch) v.sprite.setTint(0xc4ecff);                 // chilled
    else if (e.burn) v.sprite.setTint(0xffc8a0);
    else if (e.vuln) v.sprite.setTint(0xffb0d0);
    else if (e.mb) v.sprite.setTint(miniBossTint(e.mb));     // a named mini-boss's colour variant
    else if (look.tint !== null) v.sprite.setTint(look.tint);
    else v.sprite.clearTint();
    // frozen foes stop animating; everything else plays at normal speed
    if (e.fz) v.sprite.anims.pause(); else if (v.sprite.anims.isPaused) v.sprite.anims.resume();
    if (e.boss) this.bossFx.drawEnemy(v.sprite, e, this.time.now);   // scripted bosses (e.g. the Core's echoes glitch)
    v.shadow.setAlpha(1).setScale(v.baseScale * (bl?.shadow ?? 1));
    const set = this.settings();
    void set;
    if (v.elite) this.elites.draw(v.sprite, e, x, y, this.time.now);
    if (e.mb) this.themeFx.drawMiniBoss(v.sprite, e, x, y, this.time.now);   // crown, aura, embers
    const count = e.cnt ? Big.fromCompact(e.cnt) : Big.ONE;
    const extras = e.boss ? 0 : Math.min(4, Math.max(0, Math.floor(count.log10() >= 1 ? 4 : count.toNumber() - 1)));
    while (v.extras.length < extras) { const s = this.add.sprite(0, 0, `actor:${actor}`).setOrigin(ACTOR_META[actor].originX, ACTOR_META[actor].originY).setScale(0.8).setAlpha(0.9); this.dungeon.litObject(s); v.extras.push(s); }
    while (v.extras.length > extras) v.extras.pop()!.destroy();
    v.extras.forEach((s, i) => {
      const ang = (i / Math.max(1, extras)) * Math.PI * 2 + 0.6;
      const r = Math.min(e.r, 1.6) * 0.8;
      const wx = x + Math.cos(ang) * r, wy = y + Math.sin(ang) * r;
      const q = this.P(wx, wy);
      s.setPosition(Math.round(q.x), Math.round(q.y)).setDepth(iso.depth(wx, wy)).setFlipX(v.sprite.flipX).setScale(0.8 * v.baseScale);
      if (v.animKey && s.anims.currentAnim?.key !== v.animKey && this.anims.exists(v.animKey)) s.play({ key: v.animKey, startFrame: i % Math.min(2, Math.max(1, this.anims.get(v.animKey).frames.length)) });
      if (look.tint !== null) s.setTint(look.tint);
    });
    // always-on crisp outlines: faint red for every foe, purple-blue for champions, rares and bosses (render/Outlines.ts)
    if (e.st !== 'dying') {
      const strong = !!v.elite || e.boss || !!e.mb;
      this.outlines.sync(v.sprite, strong);
      for (const s of v.extras) this.outlines.sync(s, strong);
    }
    const top = Math.round(v.sprite.height * v.sprite.originY * v.baseScale);
    if (e.cnt) {
      if (!v.badge) v.badge = this.add.text(0, 0, '', { fontFamily: FONT_WORLD, fontSize: `${WORLD_TEXT_PX.label}px`, color: '#ffdc8a', stroke: '#070505', strokeThickness: 3, resolution: 1 }).setOrigin(0.5, 1);
      v.badge.setText(`×${formatBig(count)}`).setPosition(Math.round(px), Math.round(py - (e.boss ? 124 : Math.max(46, top + 8)))).setDepth(4600).setVisible(true);
    } else v.badge?.setVisible(false);
    if (!v.bar) v.bar = this.add.graphics();
    v.bar.clear().setDepth(4500);
    if (!e.boss && e.st !== 'dying' && (e.hp < 0.999 || v.elite || e.mb)) {
      // elites always show a wider bar in their tier colour
      const big = !!v.elite || !!e.mb;   // elites and mini-bosses always show a wider bar
      const w = e.mb ? 40 : v.elite ? 34 : 24;
      const bx = Math.round(px - w / 2), by = Math.round(py - Math.max(40, top + 2));
      v.bar.fillStyle(0x070505, 1).fillRect(bx - 1, by - 1, w + 2, big ? 5 : 4);
      const col = e.mb ? MINIBOSS_COLOR : v.elite ? (ELITE_COLOR[v.elite]?.main ?? 0xd6323c) : e.obj ? 0xd6323c : 0x8a5ad0;
      v.bar.fillStyle(col, 1).fillRect(bx, by, Math.round(w * e.hp), big ? 3 : 2);
      if (big) v.bar.fillStyle(0xffffff, 0.6).fillRect(bx, by, Math.round(w * e.hp), 1);
    }
    if (e.st !== 'dying' && !this.cine?.active) {
      // nameplate request (placed after the frame's hover is known, placeNames): bosses and elites always, others when
      // hovered, targeted or recently hurt
      const base = (e.boss ? BOSS_BY_ID[e.k]?.name : undefined) ?? ENEMY_BY_ID[e.k]?.name ?? e.k;
      const prio = e.boss ? 3 : e.mb ? 2.5 : v.elite ? 2 : 0;
      const color = e.boss ? '#ff6a5e' : e.mb ? MINIBOSS_CSS : v.elite === 2 ? '#ffd36a' : v.elite ? '#7cc0ff' : e.obj ? '#e8c66a' : '#ebe0c8';
      const ny = e.boss ? py - Math.max(64, top + 6) : py - Math.max(40, top + 2) - 2 - (e.mb ? 15 : 0);   // a mini-boss plate clears its crown
      this.nameReq.push({ key, text: e.mb ? e.mb : v.elite ? eliteName(base, e.af) : base, color, x: px, y: ny, prio, hurt: e.hp < 0.999, hitAt: this.lastHit.get(e.i)?.at ?? -1e9, badge: e.cnt ? v.badge : undefined });
    }
    if (e.sh && !(e.af ?? []).includes('shielding')) v.bar.lineStyle(2, 0x9fd8ff, 0.9).strokeEllipse(Math.round(px), Math.round(py - 14), iso.rx(e.r) * 2 + 12, iso.ry(e.r) * 2 + 20);
    if (e.boss && e.stag) { const r = 1.6 + (Math.floor(this.time.now / 100) % 2) * 0.15; v.bar.lineStyle(2, 0xffd23f, 1).strokeEllipse(Math.round(px), Math.round(py), iso.rx(r) * 2, iso.ry(r) * 2); }
    const er = Math.min(e.r, 1.2);
    if (e.fz) {
      // ice block: a pale crystalline outline around the body
      const h = Math.max(24, top);
      v.bar.lineStyle(1, 0xe8fbff, 0.9).strokeRect(Math.round(px - 10), Math.round(py - h), 20, h);
      v.bar.fillStyle(0xbfeeff, 0.18).fillRect(Math.round(px - 10), Math.round(py - h), 20, h);
    }
    if (e.sn) {
      // snare: knotted root ring at the feet
      v.bar.lineStyle(2, 0x6a8a3a, 1).strokeEllipse(Math.round(px), Math.round(py), iso.rx(er) * 2, iso.ry(er) * 2, 16);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; v.bar.fillStyle(0x3e5a22, 1).fillRect(Math.round(px + Math.cos(a) * iso.rx(er)) - 1, Math.round(py + Math.sin(a) * iso.ry(er)) - 2, 3, 4); }
    }
    if (e.mk) {
      // hunter's mark: a red reticle that slowly turns above the head
      const cy = Math.round(py - Math.max(40, top + 2) - 9), rr = 6, t = this.time.now / 400;
      v.bar.lineStyle(1, 0xff3a3a, 1).strokeCircle(Math.round(px), cy, rr);
      for (let i = 0; i < 4; i++) { const a = t + (i * Math.PI) / 2; v.bar.lineBetween(Math.round(px + Math.cos(a) * (rr - 2)), Math.round(cy + Math.sin(a) * (rr - 2)), Math.round(px + Math.cos(a) * (rr + 3)), Math.round(cy + Math.sin(a) * (rr + 3))); }
    }
    this.cineHide(v, !!this.cine?.hides(key));   // the boss reveal puppet stands in for the boss
  }

  private drawProjectiles(s: Snapshot) {
    const age = (performance.now() - (this.net.snaps[this.net.snaps.length - 1]?.at ?? performance.now())) / 1000;
    const seen = new Set<number>();
    const now = this.time.now;
    for (const p of s.projectiles) {
      seen.add(p.i);
      let entry = this.projectiles.get(p.i);
      const look = PROJECTILE_FX[p.k];
      const key = look?.key ?? (p.k === 'spark' ? 'fx:spark' : p.k === 'wave' ? 'fx:wave' : p.k === 'orb' ? 'fx:orb' : p.k === 'lob' ? 'fx:lob' : 'fx:shard');
      const color = look?.color ?? (p.k === 'spark' ? 0xff9a3a : p.k === 'wave' ? 0xffd890 : p.k === 'orb' ? 0xb07aff : p.k === 'lob' ? 0x9ae04a : 0xe8e0d0);
      if (!entry) {
        // player shots default to additive; a kit can force a solid sprite (arrows, axes) with additive: false
        const add = look?.additive ?? p.o === 0;
        const spr = this.add.sprite(0, 0, key).setBlendMode(add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
        if (look?.tint !== undefined) spr.setTint(look.tint);
        if (this.anims.exists(key)) spr.play(key);
        const glow = gfx().softGlow && this.textures.exists('light:soft') ? this.add.image(0, 0, 'light:soft').setBlendMode(Phaser.BlendModes.ADD).setTint(color).setAlpha(0.35).setScale(p.o === 0 ? 0.18 : 0.14).setDepth(4590) : undefined;
        entry = { s: spr, glow, last: 0, color, look, born: now };
        this.projectiles.set(p.i, entry);
      }
      let x = p.x + p.vx * Math.min(age, 0.1), y = p.y + p.vy * Math.min(age, 0.1);
      let lift = 0;
      if (p.lt) { x = p.x; y = p.y; lift = 26; }
      const q = this.P(x, y);
      const sx = Math.round(q.x), sy = Math.round(q.y - 14 - lift);
      const d = iso.dir(p.vx, p.vy);
      const rot = look?.spin ? ((now - entry.born) / 1000) * look.spin * (Math.PI / 180) : Math.atan2(d.y, d.x);
      entry.s.setPosition(sx, sy).setRotation(rot).setDepth(iso.depth(x, y) + 5).setScale((p.w ? 1.3 : 1) * (look?.scale ?? 1));
      entry.glow?.setPosition(sx, sy);
      const trail = look?.trail ?? 'ember';
      if (trail !== 'none' && now - entry.last > (look?.trailMs ?? 45) && !this.juice.low) {
        entry.last = now;
        if (trail === 'ember') this.juice.embersAt(sx, sy, 1, color);
        else this.juice.bits(trail, sx, sy, 1, color, { angle: (Math.atan2(-d.y, -d.x) * 180) / Math.PI, spread: 50, speed: 0.5 });
      }
    }
    for (const [id, e] of this.projectiles) if (!seen.has(id)) {
      // where a shot ends: a flash in its own colour, plus the kit's burst when it has one
      this.juice.impact(e.s.x, e.s.y, e.color, 0.7);
      if (e.look?.end) e.look.end(this.fxCtx(false), e.s.x, e.s.y);
      e.s.destroy(); e.glow?.destroy(); this.projectiles.delete(id);
    }
  }

  /** World-space quad (start point, unit dir, length, width) projected to the screen. */
  private quad(x: number, y: number, dx: number, dy: number, len: number, w: number) {
    const px = -dy * (w / 2), py = dx * (w / 2);
    return isoPoly([
      { x: x + px, y: y + py }, { x: x + dx * len + px, y: y + dy * len + py },
      { x: x + dx * len - px, y: y + dy * len - py }, { x: x - px, y: y - py },
    ]);
  }

  /** World-space circular sector projected to the screen. */
  private sector(x: number, y: number, r: number, a0: number, a1: number) {
    const pts = [{ x, y }];
    const n = Math.max(8, Math.ceil(((a1 - a0) * 180) / Math.PI / 8));
    for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r }); }
    return isoPoly(pts);
  }

  private ellipse(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, fill: number | null, alpha: number, stroke?: number, lw = 2) {
    if (fill !== null) g.fillStyle(fill, alpha).fillEllipse(x, y, iso.rx(r) * 2, iso.ry(r) * 2, 40);
    if (stroke !== undefined) g.lineStyle(lw, stroke, 1).strokeEllipse(x, y, iso.rx(r) * 2, iso.ry(r) * 2, 40);
  }

  private drawHazards(s: Snapshot) {
    const g = this.hazardG.clear();
    const pal = this.palette();
    const seen = new Set<number>();
    const fxOn = !this.settings().reducedEffects;
    const blink = Math.floor(this.time.now / 90) % 2 === 0;
    for (const h of s.hazards) {
      seen.add(h.i);
      const c = this.P(h.x, h.y);
      const x = Math.round(c.x), y = Math.round(c.y);
      if (!this.hazardLit.has(h.i)) {
        this.hazardLit.add(h.i);
        const col = HAZARD_LIGHT[h.k] ?? ELITE_HAZARD_LIGHT[h.k] ?? (h.k === 'fireline' ? 0xff8a2a : h.k === 'pool' ? 0x9a5ad0 : h.k === 'lightpool' ? 0x8fd8ff : h.k === 'tempest' ? 0x9fd8ff : h.k === 'horizon' ? 0xb07aff : 0);
        if (col) this.dungeon.flashLight(x, y, 170, col, 1.6, Math.max(300, (h.u - h.b) * 16));
      }
      const kit = HAZARD_FX[h.k];
      if (kit) { kit(this.hazardFxCtx(), g, h, s.tick); continue; }
      if (this.elites.drawHazard(g, h, s.tick, this.time.now, !fxOn)) continue;
      switch (h.k) {
        case 'fireline': {
          g.fillStyle(pal.burn, 0.25).fillPoints(this.quad(h.x, h.y, h.dx, h.dy, h.len, h.w), true);
          this.hazardSpritesFor(h.i, 'fx:flame', Math.max(1, Math.round(h.len / 0.7)), (i, n) => { const q = this.P(h.x + h.dx * h.len * ((i + 0.5) / n), h.y + h.dy * h.len * ((i + 0.5) / n)); return [q.x, q.y - 6]; }, fxOn);
          if (fxOn && Math.random() < 0.3) { const r = Math.random(); const q = this.P(h.x + h.dx * h.len * r, h.y + h.dy * h.len * r); this.juice.embersAt(q.x, q.y - 8, 1); }
          break;
        }
        case 'pool':
          this.ellipse(g, x, y, h.r, pal.decay, 0.28, pal.danger);
          this.hazardSpritesFor(h.i, 'fx:pool', 1, () => [x, y], fxOn, (iso.rx(h.r) * 2) / 64, 0.5);
          break;
        case 'lightpool': {
          const total = Math.max(1, h.u - h.b), prog = Math.min(1, (s.tick - h.b) / total);
          this.ellipse(g, x, y, h.r, pal.astral, 0.15 + 0.3 * prog, prog > 0.7 && blink ? 0xffffff : pal.danger);
          this.ellipse(g, x, y, h.r * prog, pal.dangerFill, 0.4);
          break;
        }
        case 'ring': {
          const age = (s.tick - h.b) / 60;
          const inner = h.in + h.sp * age, outer = h.out + h.sp * age;
          g.lineStyle(Math.max(2, (outer - inner) * 32), pal.danger, 0.6).strokeEllipse(x, y, iso.rx((inner + outer) / 2) * 2, iso.ry((inner + outer) / 2) * 2, 48);
          g.lineStyle(2, 0xffffff, 0.9).strokeEllipse(x, y, iso.rx(outer) * 2, iso.ry(outer) * 2, 48).strokeEllipse(x, y, iso.rx(inner) * 2, iso.ry(inner) * 2, 48);
          break;
        }
        case 'rootwall': {
          const qd = this.quad(h.x, h.y, h.dx, h.dy, h.len, h.w);
          g.fillStyle(pal.physical, 0.35).fillPoints(qd, true);
          g.lineStyle(2, pal.danger, 1).strokePoints(qd, true);
          this.hazardSpritesFor(h.i, 'fx:root', Math.max(1, Math.round(h.len)), (i, n) => { const q = this.P(h.x + h.dx * h.len * ((i + 0.5) / n), h.y + h.dy * h.len * ((i + 0.5) / n)); return [q.x, q.y]; }, true);
          break;
        }
        case 'tempest':
          this.ellipse(g, x, y, h.r, pal.storm, 0.22, pal.storm);
          this.hazardSpritesFor(h.i, 'fx:field', 1, () => [x, y], fxOn, (iso.rx(h.r) * 2) / 64, 0.5);
          break;
        case 'horizon':
          this.ellipse(g, x, y, h.r, pal.astral, 0.22);
          this.ellipse(g, x, y, h.r * (0.3 + 0.7 * ((this.time.now / 300) % 1)), null, 0, pal.astral);
          break;
        case 'bastion':
          this.ellipse(g, x, y, h.r, pal.shield, 0.16, pal.shield);
          break;
      }
    }
    for (const [id, list] of this.hazardSprites) if (!seen.has(id)) { list.forEach((s2) => s2.destroy()); this.hazardSprites.delete(id); }
    for (const id of this.hazardLit) if (!seen.has(id)) this.hazardLit.delete(id);
  }

  private hazardSpritesFor(id: number, key: string, n: number, pos: (i: number, n: number) => [number, number], show: boolean, scale = 1, squash = 1) {
    let list = this.hazardSprites.get(id);
    if (!list) { list = []; this.hazardSprites.set(id, list); }
    if (!show || !this.textures.exists(key)) { list.forEach((s) => s.setVisible(false)); return; }
    while (list.length < n) { const s = this.add.sprite(0, 0, key).setDepth(-75); if (this.anims.exists(key)) s.play({ key, startFrame: list.length % Math.min(3, Math.max(1, this.anims.get(key).frames.length)) }); list.push(s); }
    list.forEach((s, i) => { const [x, y] = pos(i, n); s.setPosition(Math.round(x), Math.round(y)).setScale(scale, scale * squash).setVisible(true); });
  }

  /** Shape-coded telegraphs on the ground plane: hard outline + filling progress, blinking just before release. */
  private drawTelegraphs(s: Snapshot) {
    const g = this.teleG.clear();
    const pal = this.palette();
    const blink = Math.floor(this.time.now / 70) % 2 === 0;
    for (const t of s.telegraphs) {
      const total = Math.max(1, t.r - t.s);
      const prog = Math.max(0, Math.min(1, (s.tick - t.s) / total));
      const c = this.P(t.x, t.y);
      const x = Math.round(c.x), y = Math.round(c.y);
      const shape = t.shape as { kind: string; radius?: number; range?: number; arcDeg?: number; length?: number; width?: number; outer?: number };
      const edge = prog > 0.75 && blink ? 0xffffff : pal.danger;
      if (shape.kind === 'circle') {
        const R = shape.radius ?? 1;
        this.ellipse(g, x, y, R, pal.dangerFill, 0.16, edge);
        this.ellipse(g, x, y, R * prog, pal.dangerFill, 0.42);
      } else if (shape.kind === 'cone') {
        const R = shape.range ?? 1, half = ((shape.arcDeg ?? 90) * Math.PI) / 360, ang = Math.atan2(t.dy, t.dx);
        const outer = this.sector(t.x, t.y, R, ang - half, ang + half);
        g.fillStyle(pal.dangerFill, 0.16).fillPoints(outer, true);
        g.lineStyle(2, edge, 1).strokePoints(outer, true);
        if (prog > 0.02) g.fillStyle(pal.dangerFill, 0.42).fillPoints(this.sector(t.x, t.y, R * prog, ang - half, ang + half), true);
      } else if (shape.kind === 'line') {
        const len = shape.length ?? 1, w = shape.width ?? 0.5;
        const l = Math.hypot(t.dx, t.dy) || 1;
        const dx = t.dx / l, dy = t.dy / l;
        const qd = this.quad(t.x, t.y, dx, dy, len, w);
        g.fillStyle(pal.dangerFill, 0.15).fillPoints(qd, true);
        g.lineStyle(2, edge, 1).strokePoints(qd, true);
        if (prog > 0.02) g.fillStyle(pal.dangerFill, 0.42).fillPoints(this.quad(t.x, t.y, dx, dy, len * prog, w), true);
      } else if (shape.kind === 'ring') {
        const R = (shape.outer ?? 2) * (0.4 + 0.6 * prog);
        this.ellipse(g, x, y, R, null, 0, edge, 4);
      }
    }
  }

  private drawDebug(s: Snapshot) {
    const g = this.debugG.clear();
    const on = this.settings().devOverlay;
    let i = 0;
    if (on) {
      const map = this.net.map;
      for (const e of s.enemies) {
        if (!e.dbg) continue;
        const { x, y } = this.P(e.x, e.y);
        if (map && e.dbg.path.length) {
          g.lineStyle(1, 0x7fffd4, 0.7).beginPath().moveTo(x, y);
          for (const ti of e.dbg.path) { const q = this.P((ti % map.w) + 0.5, Math.floor(ti / map.w) + 0.5); g.lineTo(q.x, q.y); }
          g.strokePath();
        }
        if (e.dbg.target !== null) { const p = s.players[e.dbg.target]; if (p) { const q = this.P(p.x, p.y); g.lineStyle(1, 0xff7f50, 0.5).lineBetween(x, y, q.x, q.y); } }
        let t = this.debugText[i];
        if (!t) { t = this.add.text(0, 0, '', { fontFamily: FONT_WORLD, fontSize: `${WORLD_TEXT_PX.label}px`, color: '#aaffee', backgroundColor: '#000000aa', resolution: 1 }).setDepth(6001); this.debugText[i] = t; }
        const util = Object.entries(e.dbg.utility).sort((a2, b2) => b2[1] - a2[1]).slice(0, 3).map(([k, v]) => `${k}:${v.toFixed(2)}`).join(' ');
        t.setText(`${e.dbg.action}${e.dbg.attack ? ' [' + e.dbg.attack + ']' : ''}\n${util}`).setPosition(Math.round(x + 14), Math.round(y - 30)).setVisible(true);
        i++;
      }
    }
    for (; i < this.debugText.length; i++) this.debugText[i].setVisible(false);
  }

  private drawFx() {
    const g = this.fxG.clear();
    const now = this.time.now;
    this.bolts = this.bolts.filter((b) => b.until > now);
    for (const b of this.bolts) {
      g.lineStyle(4, b.color, 0.9).strokePoints(b.pts);
      g.lineStyle(2, 0xffffff, 1).strokePoints(b.pts);
    }
  }
}
