/**
 * CURSEBOUND audio: sound effects, ambience and the in-dungeon music are synthesized with WebAudio (oscillators,
 * noise buffers, filters, envelopes). The four theme SONGS (title, loadout, boss, results) are recorded tracks streamed
 * from /audio/*.mp3 (setSong). Safe to import during SSR: nothing touches `window` until unlock().
 *
 * Mixer:  music -> duck -> master        (songs + their post-fader reverb send)
 *         stingers -> master             (follow the music volume, never ducked)
 *         combat, ui -> master           (combat has a small reverb send)
 *         ambience -> level -> duck -> master
 *         shared stone-hall convolver -> master
 *         master -> glue compressor -> brick-wall limiter -> speakers
 *
 * Music:     setMusic(track) + setTheme(theme) + setBoss(id): per-theme adaptive songs whose stems cross-fade by
 *            intensity (setIntensity, smoothed with hysteresis). See music.ts / MusicDirector.ts.
 * Songs:     setSong('title' | 'loadout' | 'boss' | 'results' | null): a recorded track streamed through the music
 *            duck stage (stingers still dip it) and the music fader; while one plays the synthesized music rests,
 *            and songs cross-fade into each other and back into the synthesized music.
 * Stingers:  stinger(kind) plays a composed cue in the current key and ducks the music (stingers.ts).
 * Ambience:  one bed per theme (ambience.ts), cross-faded on theme change, softened as combat heats up.
 * SFX:       play(id, { pan, dist, priority, volume }); recipes.ts. Random pitch/filter per voice, distance
 *            attenuation + air absorption, burst merging, per-cue caps and priority voice stealing.
 * Critical cues (boss_telegraph, telegraph_warn, player_downed) are never stolen and always caption,
 * even while audio is locked or muted (information is never audio-only).
 */

import { AmbienceBed, type BedId } from './ambience';
import { getAudio, setCurrentAudio } from './bus';
import { MusicDirector } from './MusicDirector';
import { BOSS_SONGS, GENERIC_BOSS_SONG, IntensityFollower, MENU_SONG, THEME_SONGS, type SongSpec } from './music';
import { FLOOR_FOR_THEME, pitchSpread, synthSfx, type SfxEnv } from './recipes';
import { AUDIO_THEMES, CRITICAL_SFX, SFX_CAPTIONS, STINGER_TIMING, type AudioTheme, type MixGroup, type MusicTrack, type SfxId, type StingerKind } from './sfx';
import { STINGER_DUCK, playStinger } from './stingers';
import { Synth, makeImpulse } from './synth';

export { SFX_IDS, CRITICAL_SFX, SFX_CAPTIONS, AUDIO_THEMES, STINGER_KINDS, STINGER_TIMING } from './sfx';
export type { SfxId, MixGroup, MusicTrack, AudioTheme, StingerKind } from './sfx';
export { computeIntensity } from './music';
export { getAudio } from './bus';

/** Recorded theme songs (apps/client/public/audio). */
export type SongId = 'title' | 'loadout' | 'boss' | 'results';
const SONG_URL: Record<SongId, string> = {
  title: '/audio/song-title.mp3',
  loadout: '/audio/song-loadout.mp3',
  boss: '/audio/song-boss.mp3',
  results: '/audio/song-results.mp3',
};
/** songs are mastered hot next to the synthesized score; trim so the music fader means the same for both */
const SONG_TRIM = 0.62;
const SONG_FADE = 1.6;

interface SongVoice { el: HTMLAudioElement; src: MediaElementAudioSourceNode; gain: GainNode; stopTimer: ReturnType<typeof setTimeout> | null }

const UI_SFX = new Set<SfxId>(['ui_click', 'ui_hover', 'ui_confirm', 'ui_error', 'vote_cast', 'vote_lock', 'fate_commit', 'level_up', 'move_click', 'minimap_ping']);

const DEFAULT_PRIORITY: Partial<Record<SfxId, number>> = {
  ui_hover: 0, move_click: 1, footstep: 0,
  hit_enemy: 1, enemy_shoot: 1, enemy_bite: 2, swing: 2, kill: 4, combo: 5, heartbeat: 9,
  attack_melee: 2, attack_spark: 2, dodge: 2, heal: 2, shield: 2, enemy_death: 3, crit: 3, hit_player: 4,
  ui_click: 4, skill_guard: 4, skill_sweep: 4, skill_rally: 4, skill_fireline: 4, skill_arc: 4, skill_phase: 4,
  signature_slam: 6, signature_nova: 6, wave_spawn: 6, boss_charge: 7, boss_ring: 7, boss_phase: 8,
  player_revived: 8, round_clear: 8, level_up: 6, ui_confirm: 5, ui_error: 5, vote_cast: 6, vote_lock: 7, fate_commit: 8,
  legendary_drop: 9, legendary_equip: 7, fate_blessing: 9, potion_glug: 5, chest_open: 5, minimap_ping: 3,
  chain_throw: 3, chain_bind: 5, chain_break: 5, freeze_build: 3, freeze: 6, ice_shatter: 5, poison_spit: 2, poisoned: 4,
  blind_burst: 6, web_spit: 2, rooted: 5, silenced: 6,
  door_appear: 6, door_hum: 2, door_open: 7, door_choose: 7, portal_open: 8, portal_enter: 8,
  cine_whoosh: 7, title_boom: 9, round_start: 8, boss_rumble: 8, boss_emerge: 9, boss_roar: 9, stag_cry: 9, bell_toll: 8,
  coin_pickup: 2, shrine_activate: 8, altar_pact: 8, merchant_buy: 6, imp_jingle: 5, imp_portal: 7,   // room events
  // combat feel pass: impacts sit with hit_enemy, typed kills with kill, ability cues with the skills they replace
  impact_light: 1, impact_heavy: 2, impact_fire: 1, impact_frost: 1, impact_storm: 1, impact_decay: 1, impact_astral: 1,
  kill_burn: 4, kill_shatter: 4, kill_zap: 4, kill_squelch: 4, kill_chime: 4,
  cast_fire: 3, cast_frost: 3, cast_storm: 3, cast_decay: 3, cast_holy: 4, cast_astral: 3, blink: 3,
  blast_fire: 5, blast_frost: 5, zap_strike: 5, blast_decay: 5, smite: 5, slam_heavy: 5,
  bow_shot: 2, gun_shot: 2, throw_whoosh: 2, blade_flurry: 3, shield_bash: 4, trap_snap: 4,
  summon_rise: 4, beast_howl: 4, beast_roar: 4, mech_deploy: 4, steam_vent: 4,
};

/** At most this many simultaneous voices of one cue (oldest is stolen). */
const PER_ID_CAP: Partial<Record<SfxId, number>> = {
  kill: 4, hit_enemy: 4, enemy_death: 3, enemy_shoot: 3, enemy_bite: 3, footstep: 3, crit: 3, swing: 4, heal: 3,
  poisoned: 2, chain_throw: 3, chain_bind: 2, ice_shatter: 3, freeze: 2, web_spit: 3, poison_spit: 3, door_hum: 1,
  telegraph_warn: 4, move_click: 1, minimap_ping: 2, heartbeat: 1,
  coin_pickup: 3, imp_jingle: 2,   // room events
  impact_light: 4, impact_heavy: 3, impact_fire: 4, impact_frost: 4, impact_storm: 4, impact_decay: 4, impact_astral: 3,
  kill_burn: 3, kill_shatter: 3, kill_zap: 3, kill_squelch: 3, kill_chime: 2,
  bow_shot: 4, gun_shot: 4, blade_flurry: 3, blast_fire: 3, blast_frost: 3, zap_strike: 3, blast_decay: 3, smite: 2, slam_heavy: 3,
};

/**
 * Repeat window per cue (seconds, default 0.03): a repeat inside it folds into the playing voice (slightly louder)
 * instead of starting another, so a pack-clearing AoE or a fast multi-hit never machine-guns the same layered impact.
 */
const MERGE_SEC: Partial<Record<SfxId, number>> = {
  impact_light: 0.035, impact_heavy: 0.05, impact_fire: 0.04, impact_frost: 0.04, impact_storm: 0.04, impact_decay: 0.04, impact_astral: 0.05,
  kill: 0.04, kill_burn: 0.05, kill_shatter: 0.05, kill_zap: 0.05, kill_squelch: 0.05, kill_chime: 0.08, crit: 0.06,
  gun_shot: 0.045, bow_shot: 0.04, blade_flurry: 0.06,
};

/** Big moments that briefly pull the music down: [dB, hold s, release s]. */
const SFX_DUCK: Partial<Record<SfxId, [number, number, number]>> = {
  boss_ring: [-6, 0.3, 0.8], signature_slam: [-4, 0.15, 0.5], title_boom: [-10, 0.8, 1.5], boss_roar: [-9, 0.8, 1],
  boss_emerge: [-8, 1, 1.2], stag_cry: [-6, 0.8, 1], bell_toll: [-5, 1, 1.5], legendary_drop: [-6, 0.6, 1.2], fate_blessing: [-6, 0.8, 1.2],
  player_downed: [-6, 0.6, 1], portal_enter: [-6, 0.6, 1], boss_phase: [-6, 0.8, 1],
  shrine_activate: [-5, 0.5, 1], altar_pact: [-7, 0.8, 1.2],   // room events
  blast_fire: [-3, 0.1, 0.4], zap_strike: [-3, 0.1, 0.4], smite: [-3, 0.15, 0.5],
};

const MAX_VOICES = 32;
const CAPTION_THROTTLE_MS = 3000;

interface Voice {
  id: SfxId;
  priority: number;
  start: number;
  end: number;
  out: GainNode;
}

type Volumes = { master: number; music: number; combat: number; ui: number; ambience: number };

type AudioCtor = new () => AudioContext;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private synth: Synth | null = null;
  private master: GainNode | null = null;
  private groups: Partial<Record<MixGroup, GainNode>> = {};
  private musicDuck: GainNode | null = null;
  private songBus: GainNode | null = null;
  private songs = new Map<SongId, SongVoice>();
  private song: SongId | null = null;
  private ambLevel: GainNode | null = null;
  private ambDuck: GainNode | null = null;
  private stingerBus: GainNode | null = null;
  private reverbIn: GainNode | null = null;
  private musicRev: GainNode | null = null;
  private ambRev: GainNode | null = null;
  private director: MusicDirector | null = null;
  private bed: AmbienceBed | null = null;
  private voices: Voice[] = [];
  private vol: Volumes = { master: 0.8, music: 0.6, combat: 0.8, ui: 0.7, ambience: 0.5 };
  private track: MusicTrack | null = null;
  private themeId: AudioTheme = 'catacombs';
  private bossId: string | null = null;
  private raw = 0;
  private readonly follower = new IntensityFollower();
  private lastTick = 0;
  private ambSet = 1;
  private duckState = { depth: 1, until: 0 };
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastCaption = new Map<SfxId, number>();
  private lastStinger = new Map<StingerKind, number>();
  private foot = 0;
  private readonly onCaption?: (text: string, sfx: SfxId) => void;

  constructor(onCaption?: (text: string, sfx: SfxId) => void) {
    this.onCaption = onCaption;
    setCurrentAudio(this);
  }

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Current dungeon theme (drives music, ambience bed and footstep surface). */
  get theme(): AudioTheme {
    return this.themeId;
  }

  get music(): MusicTrack | null {
    return this.track;
  }

  /** Smoothed music intensity 0..1 after hysteresis. */
  get intensity(): number {
    return this.follower.value;
  }

  /** Create/resume the AudioContext. Call from an explicit user gesture (autoplay policy). */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const g = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
      const Ctor = g.AudioContext ?? g.webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.build(ctx);
      this.applyVolumes();
    }
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* ignore: will retry on next gesture */
      }
    }
    if (!this.timer && this.ctx) {
      this.lastTick = this.ctx.currentTime;
      this.timer = setInterval(() => this.tick(), 40);
    }
    // music requested before the gesture starts now
    this.refreshSongs();
    this.refreshMusic();
  }

  private build(ctx: AudioContext): void {
    const gain = (v = 1): GainNode => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    const master = gain();
    // glue compression (keeps the established loudness), then a brick-wall limiter so mass deaths never clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    master.connect(comp);
    comp.connect(limiter);
    limiter.connect(ctx.destination);
    this.master = master;
    for (const name of ['music', 'combat', 'ui', 'ambience'] as MixGroup[]) this.groups[name] = gain();
    this.musicDuck = gain();
    this.groups.music!.connect(this.musicDuck);
    this.musicDuck.connect(master);
    this.songBus = gain();
    this.songBus.connect(this.musicDuck);
    this.groups.combat!.connect(master);
    this.groups.ui!.connect(master);
    this.ambLevel = gain();
    this.ambDuck = gain();
    this.groups.ambience!.connect(this.ambLevel);
    this.ambLevel.connect(this.ambDuck);
    this.ambDuck.connect(master);
    this.stingerBus = gain();
    this.stingerBus.connect(master);
    // shared reverb with post-fader sends
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, 2.8, 2.6);
    const ret = gain(0.3);
    conv.connect(ret);
    ret.connect(master);
    this.reverbIn = gain();
    this.reverbIn.connect(conv);
    this.musicRev = gain();
    this.musicRev.connect(this.reverbIn);
    this.ambRev = gain();
    this.ambRev.connect(this.reverbIn);
    const combatSend = gain(0.12);
    this.groups.combat!.connect(combatSend);
    combatSend.connect(this.reverbIn);
    const stingerSend = gain(0.4);
    this.stingerBus.connect(stingerSend);
    stingerSend.connect(this.reverbIn);
    this.synth = new Synth(ctx, 1);
    this.director = new MusicDirector(this.synth, this.groups.music!, this.musicRev);
  }

  setVolumes(v: Volumes): void {
    const c = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
    this.vol = { master: c(v.master), music: c(v.music), combat: c(v.combat), ui: c(v.ui), ambience: c(v.ambience) };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const set = (g: GainNode | null | undefined, v: number): void => {
      if (!g) return;
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(v, t, 0.03);
    };
    // perceptual (squared) faders, same curve and trims as before
    const sq = (x: number): number => x * x;
    set(this.master, sq(this.vol.master));
    set(this.groups.music, sq(this.vol.music * 0.55));
    set(this.songBus, sq(this.vol.music * SONG_TRIM));
    set(this.musicRev, sq(this.vol.music * 0.55));
    set(this.stingerBus, sq(this.vol.music * 1.1));
    set(this.groups.combat, sq(this.vol.combat));
    set(this.groups.ui, sq(this.vol.ui * 0.8));
    set(this.groups.ambience, sq(this.vol.ambience * 0.6));
    set(this.ambRev, sq(this.vol.ambience * 0.6));
  }

  // ------------------------------------------------------------------ SFX

  private caption(id: SfxId, critical: boolean): void {
    const text = SFX_CAPTIONS[id];
    if (!text || !this.onCaption) return;
    const now = Date.now();
    if (!critical && now - (this.lastCaption.get(id) ?? 0) < CAPTION_THROTTLE_MS) return;
    this.lastCaption.set(id, now);
    this.onCaption(text, id);
  }

  private kill(v: Voice, now: number): void {
    v.out.gain.cancelScheduledValues(now);
    v.out.gain.setTargetAtTime(0, now, 0.01);
    v.end = now;
    const out = v.out;
    setTimeout(() => {
      try { out.disconnect(); } catch { /* gone */ }
    }, 80);
    this.voices = this.voices.filter((x) => x !== v);
  }

  /**
   * Play a cue. pan -1..1 (screen x), dist = distance from the camera centre in half-screens (0 centre, ~1 screen
   * edge): quieter and duller with distance, culled far off-screen unless important.
   */
  play(id: SfxId, opts: { pan?: number; priority?: number; volume?: number; dist?: number } = {}): void {
    const critical = CRITICAL_SFX.includes(id);
    this.caption(id, critical);
    const ctx = this.ctx;
    const s = this.synth;
    if (!ctx || ctx.state !== 'running' || !s) return;
    const now = ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
    const priority = critical ? 99 : opts.priority ?? DEFAULT_PRIORITY[id] ?? 3;
    const dist = Math.max(0, Number.isFinite(opts.dist) ? (opts.dist as number) : 0);
    if (!critical) {
      if (dist > 2.6 && priority < 6) return;
      // burst merge: the same cue within its repeat window (30 ms default; MERGE_SEC) becomes one louder voice
      const win = MERGE_SEC[id] ?? 0.03;
      const recent = this.voices.find((v) => v.id === id && now - v.start < win);
      if (recent) {
        const g = recent.out.gain;
        g.setValueAtTime(Math.min(1.6, g.value * 1.12), now);
        return;
      }
      const same = this.voices.filter((v) => v.id === id);
      const cap = PER_ID_CAP[id] ?? 6;
      if (same.length >= cap) {
        const oldest = same.reduce((a, b) => (a.start <= b.start ? a : b));
        this.kill(oldest, now);
      }
      const cosmetic = this.voices.filter((v) => v.priority < 99);
      if (cosmetic.length >= MAX_VOICES) {
        let victim: Voice | null = null;
        for (const v of cosmetic) {
          if (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.start < victim.start)) victim = v;
        }
        if (!victim || victim.priority > priority) return;
        this.kill(victim, now);
      }
    }
    const group = this.groups[UI_SFX.has(id) ? 'ui' : 'combat'];
    if (!group) return;
    const out = ctx.createGain();
    const att = critical ? 1 : 1 / (1 + 0.9 * Math.max(0, dist - 0.35) ** 2);
    out.gain.value = Math.min(1.5, Math.max(0, opts.volume ?? 1)) * att;
    const chain: AudioNode[] = [out];
    if (dist > 0.6 && !critical) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(1800, 16000 / (1 + 3.5 * (dist - 0.6)));
      chain.push(lp);
    }
    if (opts.pan !== undefined && typeof ctx.createStereoPanner === 'function') {
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.min(1, Math.max(-1, opts.pan));
      chain.push(pan);
    }
    for (let i = 0; i < chain.length - 1; i++) (chain[i] as AudioNode).connect(chain[i + 1] as AudioNode);
    (chain[chain.length - 1] as AudioNode).connect(group);
    const spread = pitchSpread(id);
    s.pv = 1 + (s.rand() * 2 - 1) * spread;
    s.fv = 1 + (s.rand() * 2 - 1) * spread * 0.8;
    let dur = 0.1;
    try {
      dur = synthSfx(s, id, out, now + 0.005, this.env(id));
    } finally {
      s.pv = 1;
      s.fv = 1;
    }
    const duck = SFX_DUCK[id];
    if (duck) this.duck(duck[0], duck[1], duck[2]);
    this.voices.push({ id, priority, start: now, end: now + dur + 0.1, out });
    setTimeout(() => {
      for (const n of chain) {
        try { n.disconnect(); } catch { /* already disconnected */ }
      }
    }, (dur + 0.6) * 1000);
  }

  private env(id: SfxId): SfxEnv {
    if (id === 'footstep') this.foot++;
    return { floor: FLOOR_FOR_THEME[this.themeId] ?? 'stone', root: this.keySpec().root, boss: this.bossId, foot: this.foot };
  }

  // ------------------------------------------------------------------ music API

  /** Current recorded song, if one is playing (or requested before unlock). */
  get currentSong(): SongId | null {
    return this.song;
  }

  /**
   * Play a recorded theme song (looping), cross-fading from whatever plays now; null returns to the synthesized
   * music. Requested before unlock(), it starts on unlock.
   */
  setSong(id: SongId | null): void {
    if (id === this.song) return;
    this.song = id;
    this.refreshSongs();
    this.refreshMusic();
  }

  private refreshSongs(): void {
    const ctx = this.ctx;
    if (!ctx || !this.songBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    for (const [id, v] of this.songs) {
      if (id === this.song) continue;
      // fade out, then pause and rewind so the song starts from the top next time
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0, now, SONG_FADE / 4);
      if (!v.stopTimer) v.stopTimer = setTimeout(() => { v.el.pause(); v.el.currentTime = 0; v.stopTimer = null; }, SONG_FADE * 1000 + 400);
    }
    if (!this.song) return;
    let v = this.songs.get(this.song);
    if (!v) {
      const el = new Audio(SONG_URL[this.song]);
      el.loop = true;
      el.preload = 'auto';
      const src = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain);
      gain.connect(this.songBus);
      v = { el, src, gain, stopTimer: null };
      this.songs.set(this.song, v);
    }
    if (v.stopTimer) { clearTimeout(v.stopTimer); v.stopTimer = null; }
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setTargetAtTime(1, now, SONG_FADE / 4);
    if (v.el.paused) void v.el.play().catch(() => { /* blocked until a gesture; unlock() retries */ });
  }

  /** Select the music track; 'combat' / 'explore' play the current theme's song, 'boss' the current boss's. */
  setMusic(track: MusicTrack | null): void {
    if (track === this.track) return;
    this.track = track;
    this.refreshMusic();
  }

  /** Set the dungeon theme (DUNGEON_THEMES id). Unknown ids fall back to catacombs. */
  setTheme(theme: string | null | undefined): void {
    const id = (AUDIO_THEMES as readonly string[]).includes(theme ?? '') ? (theme as AudioTheme) : 'catacombs';
    if (id === this.themeId) return;
    this.themeId = id;
    this.refreshMusic();
  }

  /** Boss id for the boss track ('prismstag' = The Hollow Stag, 'bellroot' = The Bell Golem). */
  setBoss(bossId: string | null | undefined): void {
    const id = bossId ?? null;
    if (id === this.bossId) return;
    this.bossId = id;
    if (this.track === 'boss') this.refreshMusic();
  }

  /** Raw 0..1 combat intensity (~4 Hz). Smoothed with hysteresis internally; see computeIntensity(). */
  setIntensity(x: number): void {
    this.raw = Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
  }

  /**
   * Play a musical stinger in the current key and duck the music. Returns its timing (seconds from now):
   * `hit` = accent to sync visuals to, `duration` = fully finished. Works (returns timing) even while locked.
   */
  stinger(kind: StingerKind): { hit: number; duration: number } {
    const timing = STINGER_TIMING[kind];
    if (!timing) return { hit: 0, duration: 0 };   // unknown kind from an untyped caller
    const ctx = this.ctx;
    const s = this.synth;
    if (!ctx || ctx.state !== 'running' || !s || !this.stingerBus) return timing;
    const now = ctx.currentTime;
    if (now - (this.lastStinger.get(kind) ?? -10) < 1.2) return timing;
    this.lastStinger.set(kind, now);
    const [db, hold, rel] = STINGER_DUCK[kind];
    this.duck(db, hold, rel);
    const spec = this.keySpec();
    playStinger(s, kind, this.stingerBus, now + 0.02, { root: spec.root, scale: spec.scale, boss: this.bossId });
    return timing;
  }

  /** Sidechain-style music dip: down to `db` in 50 ms, held, then released. Overlapping ducks combine. */
  duck(db: number, hold: number, release: number): void {
    const ctx = this.ctx;
    const g = this.musicDuck?.gain;
    if (!ctx || !g) return;
    const now = ctx.currentTime;
    const active = now < this.duckState.until;
    const depth = Math.min(active ? this.duckState.depth : 1, Math.pow(10, db / 20));
    const until = Math.max(active ? this.duckState.until : 0, now + 0.05 + hold);
    this.duckState = { depth, until };
    for (const [param, d] of [[g, depth], [this.ambDuck?.gain, Math.sqrt(depth)]] as [AudioParam | undefined, number][]) {
      if (!param) continue;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(d, now + 0.05);
      param.setValueAtTime(d, until);
      param.linearRampToValueAtTime(1, until + release);
    }
  }

  private keySpec(): SongSpec {
    if (this.track === 'menu' || this.track === null) return this.track === 'menu' ? MENU_SONG : THEME_SONGS[this.themeId];
    if (this.track === 'boss') return (this.bossId && BOSS_SONGS[this.bossId]) || GENERIC_BOSS_SONG;
    return THEME_SONGS[this.themeId];
  }

  private refreshMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.director || !this.synth || !this.groups.ambience || !this.ambRev) return;
    const now = ctx.currentTime;
    // a recorded song replaces the synthesized score while it plays; the ambience bed keeps going
    const spec = this.track === null || this.song ? null : this.keySpec();
    const prev = this.director.currentId;
    if (spec && spec.id !== prev && spec.minIntensity !== undefined) this.follower.reset(Math.max(this.follower.value, 0.5));
    this.director.play(spec, now, spec && prev && prev.startsWith('boss:') !== spec.id.startsWith('boss:') ? 1.8 : 2.5);
    const bedId: BedId = this.track === 'menu' ? 'menu' : this.themeId;
    if (this.bed?.id !== bedId) {
      this.bed?.stop(now);
      this.bed = new AmbienceBed(this.synth, this.groups.ambience, this.ambRev, bedId, now);
    }
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const dt = Math.min(1, Math.max(0, now - this.lastTick));
    this.lastTick = now;
    const smoothed = this.follower.update(this.raw, dt);
    const I = this.track === 'combat' || this.track === 'boss' ? smoothed : this.track === 'explore' ? Math.min(smoothed, 0.18) : 0;
    const doc = (globalThis as { document?: { hidden?: boolean } }).document;
    const ahead = now + (doc?.hidden ? 1.1 : 0.3);
    if (this.director) {
      this.director.setIntensity(I);
      this.director.tick(now, ahead);
    }
    this.bed?.tick(now, ahead);
    // ambience steps back as the fight heats up
    const amb = 1 - 0.45 * I;
    if (this.ambLevel && Math.abs(amb - this.ambSet) > 0.02) {
      this.ambSet = amb;
      this.ambLevel.gain.setTargetAtTime(amb, now, 1.2);
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.voices = [];
    const ctx = this.ctx;
    if (ctx) {
      this.director?.stopAll(ctx.currentTime);
      this.bed?.stop(ctx.currentTime, 0.2);
    }
    for (const v of this.songs.values()) { if (v.stopTimer) clearTimeout(v.stopTimer); v.el.pause(); }
    this.songs.clear();
    this.songBus = null;
    this.director = null;
    this.bed = null;
    this.synth = null;
    this.ctx = null;
    this.master = null;
    this.groups = {};
    if (ctx) void ctx.close().catch(() => undefined);
    if (getAudio() === this) setCurrentAudio(null);
  }
}
