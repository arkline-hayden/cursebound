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
import { SampleBank, type Take } from './samples';
import { MUSIC_FILES } from './sfxFiles.generated';
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
/** Boss id -> its recorded track's short name (public/audio/song-boss-<name>.mp3). */
const BOSS_SONG: Record<string, string> = { prismstag: 'stag', bellroot: 'golem', corruptcore: 'core', ironcolossus: 'colossus', skydrake: 'wyrm', moonhorror: 'horror' };
/** songs are mastered hot next to the synthesized score; trim so the music fader means the same for both */
const SONG_TRIM = 0.62;
const SONG_FADE = 1.6;
/** per-cue level trims on top of the levelled takes (footsteps sit under the fight) */
const CUE_TRIM: Partial<Record<SfxId, number>> = { footstep: 0.5 };

interface SongVoice { el: HTMLAudioElement; src: MediaElementAudioSourceNode; gain: GainNode; stopTimer: ReturnType<typeof setTimeout> | null }

const UI_SFX = new Set<SfxId>(['ui_click', 'ui_hover', 'ui_confirm', 'ui_error', 'vote_cast', 'vote_lock', 'fate_commit', 'level_up', 'move_click', 'minimap_ping',
  'vessel_shift', 'vessel_locked', 'vessel_roar', 'vessel_pick_vanguard', 'vessel_pick_arcanist', 'vessel_pick_duelist', 'vessel_pick_hexbinder', 'vessel_pick_artificer', 'vessel_pick_templar', 'vessel_pick_berserker', 'vessel_pick_cryomancer', 'vessel_pick_ranger', 'vessel_pick_warden',
  'ui_back', 'ui_tab', 'ui_panel_open', 'ui_panel_close', 'ui_toggle', 'ui_slider', 'ui_type', 'ui_toast', 'press_start', 'ready_up']);

/** Cues with no synthesized recipe: they play only from a recorded file (silent until one exists). */
const FILE_ONLY = new Set<SfxId>(['ui_back', 'ui_tab', 'ui_panel_open', 'ui_panel_close', 'ui_toggle', 'ui_slider', 'ui_type', 'ui_toast', 'press_start', 'ready_up']);

const DEFAULT_PRIORITY: Partial<Record<SfxId, number>> = {
  ui_hover: 0, move_click: 1, footstep: 0, ui_type: 0, ui_slider: 0, ui_toggle: 2, ui_tab: 3, ui_back: 4, ui_panel_open: 4, ui_panel_close: 3, ui_toast: 3, press_start: 8, ready_up: 6,
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
  core_charge: 6, core_laser: 6, core_firewall: 7, core_glitch: 5, core_purge_alarm: 9, core_purge: 8, core_deploy: 5,
  colossus_raise: 6, colossus_hammer: 8, colossus_stomp: 7, colossus_vent: 6, lava_vent: 4, lava_erupt: 6,
  drake_screech: 8, drake_gale: 6, drake_dive: 6, thunder_feather: 4, skyfall: 8, horror_moan: 9, tentacle_burst: 4, gravity_well: 6, void_beam: 7,
  vessel_shift: 3, vessel_locked: 5, vessel_roar: 9,
  vessel_pick_vanguard: 6, vessel_pick_arcanist: 6, vessel_pick_duelist: 6, vessel_pick_hexbinder: 6, vessel_pick_artificer: 6, vessel_pick_templar: 6, vessel_pick_berserker: 6, vessel_pick_cryomancer: 6, vessel_pick_ranger: 6, vessel_pick_warden: 6,
};

/** At most this many simultaneous voices of one cue (oldest is stolen). */
const PER_ID_CAP: Partial<Record<SfxId, number>> = {
  kill: 4, hit_enemy: 4, enemy_death: 3, enemy_shoot: 3, enemy_bite: 3, footstep: 3, crit: 3, swing: 4, heal: 3,
  poisoned: 2, chain_throw: 3, chain_bind: 2, ice_shatter: 3, freeze: 2, web_spit: 3, poison_spit: 3, door_hum: 1,
  telegraph_warn: 4, move_click: 1, minimap_ping: 2, heartbeat: 1,
  thunder_feather: 4, tentacle_burst: 4, void_beam: 1, drake_gale: 1,
  coin_pickup: 3, imp_jingle: 2,   // room events
  vessel_shift: 2, vessel_locked: 1, vessel_roar: 1,
  vessel_pick_vanguard: 1, vessel_pick_arcanist: 1, vessel_pick_duelist: 1, vessel_pick_hexbinder: 1, vessel_pick_artificer: 1, vessel_pick_templar: 1, vessel_pick_berserker: 1, vessel_pick_cryomancer: 1, vessel_pick_ranger: 1, vessel_pick_warden: 1,
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
  core_laser: 2, core_glitch: 3, core_deploy: 2,
  vessel_shift: 0.05,
};

/** Big moments that briefly pull the music down: [dB, hold s, release s]. */
const SFX_DUCK: Partial<Record<SfxId, [number, number, number]>> = {
  boss_ring: [-6, 0.3, 0.8], signature_slam: [-4, 0.15, 0.5], title_boom: [-10, 0.8, 1.5], boss_roar: [-9, 0.8, 1],
  boss_emerge: [-8, 1, 1.2], stag_cry: [-6, 0.8, 1], bell_toll: [-5, 1, 1.5], legendary_drop: [-6, 0.6, 1.2], fate_blessing: [-6, 0.8, 1.2],
  player_downed: [-6, 0.6, 1], portal_enter: [-6, 0.6, 1], boss_phase: [-6, 0.8, 1],
  shrine_activate: [-5, 0.5, 1], altar_pact: [-7, 0.8, 1.2],   // room events
  blast_fire: [-3, 0.1, 0.4], zap_strike: [-3, 0.1, 0.4], smite: [-3, 0.15, 0.5],
  core_purge: [-7, 0.5, 1], colossus_hammer: [-5, 0.2, 0.6],
  drake_screech: [-5, 0.5, 0.8], horror_moan: [-6, 1, 1.2],
  vessel_roar: [-9, 1, 1.4],
};

const MAX_VOICES = 32;
const CAPTION_THROTTLE_MS = 3000;

interface Voice {
  id: SfxId;
  /** recorded file name when played by playFile (merging and caps go by it) */
  key?: string;
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
  /** recorded sound files (public/audio/sfx): played instead of the recipe when a cue has one */
  private readonly samples = new SampleBank();
  private master: GainNode | null = null;
  private groups: Partial<Record<MixGroup, GainNode>> = {};
  private musicDuck: GainNode | null = null;
  private songBus: GainNode | null = null;
  /** recorded tracks by file stem ('song-title', 'song-floor-forge', 'song-boss-core'…) */
  private songs = new Map<string, SongVoice>();
  private song: SongId | null = null;
  private ambLevel: GainNode | null = null;
  private ambDuck: GainNode | null = null;
  private stingerBus: GainNode | null = null;
  private reverbIn: GainNode | null = null;
  private musicRev: GainNode | null = null;
  private ambRev: GainNode | null = null;
  private director: MusicDirector | null = null;
  private bed: AmbienceBed | FileBed | null = null;
  private voices: Voice[] = [];
  private vol: Volumes = { master: 0.8, music: 0.6, combat: 0.8, ui: 0.7, ambience: 0.5 };
  private track: MusicTrack | null = null;
  private themeId: AudioTheme = 'catacombs';
  /** on the training grounds (theme 'courtyard': catacombs music and footsteps, its own ambience loop when recorded) */
  private courtyard = false;
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
    if (typeof window !== 'undefined') this.samples.prefetch();
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
      this.samples.load(ctx);
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
  /** A recorded file exists for this key (tools/audio sound list name), decoded or not. */
  hasFile(key: string): boolean {
    return SampleBank.has(key);
  }

  /**
   * Play a recorded sound by its file name (a per-skill cast, an enemy voice, a boss death…) when that file exists;
   * otherwise play `fallback` (the shared cue, synthesized or recorded), or nothing. Same mixing as play().
   */
  playFile(key: string, fallback: SfxId | null, opts: { pan?: number; priority?: number; volume?: number; dist?: number; ui?: boolean } = {}): void {
    // the stand-in cue only lends its mix group and priority; a pure file (no fallback) mixes as combat, or as
    // interface with `ui` (menu screens: skill tree, results)
    if (SampleBank.has(key)) { this.play(fallback ?? (opts.ui ? 'ui_confirm' : 'hit_enemy'), { ...opts, file: key }); return; }
    if (fallback) this.play(fallback, opts);
  }

  /**
   * Start a recorded loop (a channel, e.g. revive_channel) on the combat bus, faded in. Returns its stop handle (fades
   * out), or null while there is nothing to play: no such file, still decoding, or audio still locked (callers retry).
   */
  loopFile(key: string, opts: { volume?: number } = {}): { stop(): void } | null {
    const ctx = this.ctx, s = this.synth, group = this.groups.combat;
    if (!ctx || ctx.state !== 'running' || !s || !group || !SampleBank.has(key)) return null;
    const take = this.samples.pick(key, () => s.rand());
    if (!take) return null;
    const src = ctx.createBufferSource();
    src.buffer = take.buf;
    src.loop = true;
    src.loopStart = take.offset;
    src.loopEnd = take.buf.duration;
    const out = ctx.createGain();
    const t0 = ctx.currentTime;
    out.gain.setValueAtTime(0, t0);
    out.gain.linearRampToValueAtTime(Math.min(1.5, Math.max(0, opts.volume ?? 1)) * take.gain, t0 + 0.12);
    src.connect(out);
    out.connect(group);
    src.start(t0, take.offset);
    let stopped = false;
    return {
      stop: () => {
        if (stopped) return;
        stopped = true;
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(out.gain.value, t);
        out.gain.linearRampToValueAtTime(0, t + 0.2);
        try { src.stop(t + 0.25); } catch { /* already stopped */ }
        setTimeout(() => { try { src.disconnect(); out.disconnect(); } catch { /* gone */ } }, 400);
      },
    };
  }

  play(id: SfxId, opts: { pan?: number; priority?: number; volume?: number; dist?: number; file?: string } = {}): void {
    const critical = CRITICAL_SFX.includes(id);
    if (!opts.file || opts.file === id) this.caption(id, critical);
    const ctx = this.ctx;
    const s = this.synth;
    if (!ctx || ctx.state !== 'running' || !s) return;
    // a recorded take when the cue has one (footsteps pick the floor's surface set); recipe-less cues stay silent without
    const key = opts.file ?? (id === 'footstep' ? `footstep_${FLOOR_FOR_THEME[this.themeId] ?? 'stone'}` : id);
    const take = this.samples.pick(key, () => s.rand());
    // a named file still decoding: skip rather than play the stand-in cue
    if (!take && (FILE_ONLY.has(id) || opts.file)) return;
    const now = ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
    const priority = critical ? 99 : opts.priority ?? DEFAULT_PRIORITY[id] ?? 3;
    const dist = Math.max(0, Number.isFinite(opts.dist) ? (opts.dist as number) : 0);
    if (!critical) {
      if (dist > 2.6 && priority < 6) return;
      // burst merge: the same cue within its repeat window (30 ms default; MERGE_SEC) becomes one louder voice
      const win = MERGE_SEC[id] ?? 0.03;
      const recent = this.voices.find((v) => (v.key ?? v.id) === (opts.file ?? id) && now - v.start < win);
      if (recent) {
        const g = recent.out.gain;
        g.setValueAtTime(Math.min(1.6, g.value * 1.12), now);
        return;
      }
      const same = this.voices.filter((v) => (v.key ?? v.id) === (opts.file ?? id));
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
    out.gain.value = Math.min(1.5, Math.max(0, opts.volume ?? 1)) * att * (CUE_TRIM[id] ?? 1);
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
    let dur = 0.1;
    if (take) {
      // recorded file: levelled take, a gentler pitch wobble than the recipes (UI cues stay exact), leading silence skipped
      const src = ctx.createBufferSource();
      src.buffer = take.buf;
      const rate = UI_SFX.has(id) ? 1 : 1 + (s.rand() * 2 - 1) * spread * 0.5;
      src.playbackRate.value = rate;
      const lv = ctx.createGain();
      lv.gain.value = take.gain;
      src.connect(lv);
      lv.connect(out);
      chain.unshift(src, lv);
      src.start(now + 0.005, take.offset);
      dur = Math.max(0.05, (take.buf.duration - take.offset) / rate);
      if (id === 'footstep') this.foot++;
    } else {
      s.pv = 1 + (s.rand() * 2 - 1) * spread;
      s.fv = 1 + (s.rand() * 2 - 1) * spread * 0.8;
      try {
        dur = synthSfx(s, id, out, now + 0.005, this.env(id));
      } finally {
        s.pv = 1;
        s.fv = 1;
      }
    }
    const duck = SFX_DUCK[id];
    if (duck) this.duck(duck[0], duck[1], duck[2]);
    this.voices.push({ id, key: opts.file, priority, start: now, end: now + dur + 0.1, out });
    setTimeout(() => {
      for (const n of chain) {
        try { n.disconnect(); } catch { /* already disconnected */ }
      }
    }, (dur + 0.6) * 1000);
  }

  /**
   * Play a cue as soon as audio is unlocked and its recorded file is decoded (up to `maxMs`): for the gesture that
   * unlocks audio ("Press any key"), when the file cannot be ready yet. A cue with a recipe falls back to it on timeout.
   */
  playWhenReady(id: SfxId, opts: { pan?: number; priority?: number; volume?: number; dist?: number } = {}, maxMs = 900): void {
    const t0 = performance.now();
    const tick = (): void => {
      if (this.unlocked && (this.samples.ready(id) || !SampleBank.has(id))) { this.play(id, opts); return; }
      if (performance.now() - t0 > maxMs) { if (this.unlocked && !FILE_ONLY.has(id)) this.play(id, opts); return; }
      setTimeout(tick, 25);
    };
    tick();
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

  /**
   * The recorded track to play now (a file stem under /audio/), or null for the synthesized score: the page's
   * requested song (title, loadout, results; the boss song upgrades to that boss's own track when it exists), else in
   * a run the floor theme's track (song-floor-<theme>, song-training in the Training Grounds) when its file exists.
   */
  private activeSong(): string | null {
    if (this.song === 'boss') {
      const own = this.bossId && BOSS_SONG[this.bossId] ? `song-boss-${BOSS_SONG[this.bossId]}` : null;
      return own && MUSIC_FILES.includes(own) ? own : 'song-boss';
    }
    if (this.song) return `song-${this.song}`;
    if (this.track === 'boss') {
      const own = this.bossId && BOSS_SONG[this.bossId] ? `song-boss-${BOSS_SONG[this.bossId]}` : null;
      if (own && MUSIC_FILES.includes(own)) return own;
    }
    if (this.track === 'combat' || this.track === 'explore') {
      const floor = this.courtyard ? 'song-training' : `song-floor-${this.themeId}`;
      if (MUSIC_FILES.includes(floor)) return floor;
    }
    return null;
  }

  private refreshSongs(): void {
    const ctx = this.ctx;
    if (!ctx || !this.songBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const want = this.activeSong();
    for (const [id, v] of this.songs) {
      if (id === want) continue;
      // fade out, then pause and rewind so the song starts from the top next time
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0, now, SONG_FADE / 4);
      if (!v.stopTimer) v.stopTimer = setTimeout(() => { v.el.pause(); v.el.currentTime = 0; v.stopTimer = null; }, SONG_FADE * 1000 + 400);
    }
    if (!want) return;
    let v = this.songs.get(want);
    if (!v) {
      const el = new Audio(`/audio/${want}.mp3`);
      el.loop = true;
      el.preload = 'auto';
      const src = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain);
      gain.connect(this.songBus);
      v = { el, src, gain, stopTimer: null };
      this.songs.set(want, v);
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

  /** Set the dungeon theme (DUNGEON_THEMES id). Unknown ids fall back to catacombs (the training grounds' 'courtyard'
   *  too, except for its own recorded ambience loop, amb_courtyard, once that exists). */
  setTheme(theme: string | null | undefined): void {
    const id = (AUDIO_THEMES as readonly string[]).includes(theme ?? '') ? (theme as AudioTheme) : 'catacombs';
    const court = theme === 'courtyard';
    if (id === this.themeId && court === this.courtyard) return;
    this.themeId = id;
    this.courtyard = court;
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
    const take = this.samples.pick(`stinger_${kind}`, () => s.rand());
    if (take) {
      // recorded stinger
      const src = ctx.createBufferSource();
      src.buffer = take.buf;
      const g = ctx.createGain();
      g.gain.value = take.gain;
      src.connect(g);
      g.connect(this.stingerBus);
      src.start(now + 0.02, take.offset);
      src.onended = () => { try { g.disconnect(); } catch { /* gone */ } };
    } else {
      playStinger(s, kind, this.stingerBus, now + 0.02, { root: spec.root, scale: spec.scale, boss: this.bossId });
    }
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
    this.refreshSongs();
    const ctx = this.ctx;
    if (!ctx || !this.director || !this.synth || !this.groups.ambience || !this.ambRev) return;
    const now = ctx.currentTime;
    // a recorded song replaces the synthesized score while it plays; the ambience bed keeps going
    const spec = this.track === null || this.activeSong() ? null : this.keySpec();
    const prev = this.director.currentId;
    if (spec && spec.id !== prev && spec.minIntensity !== undefined) this.follower.reset(Math.max(this.follower.value, 0.5));
    this.director.play(spec, now, spec && prev && prev.startsWith('boss:') !== spec.id.startsWith('boss:') ? 1.8 : 2.5);
    this.refreshBed(now);
  }

  /** The ambience bed for the menu or the floor theme: its recorded loop when there is one, else the synthesized bed. */
  private refreshBed(now: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.synth || !this.groups.ambience || !this.ambRev) return;
    // no ambience outside a run: the title screen and menus are music only
    if (this.track === null || this.track === 'menu') {
      this.bed?.stop(now, 1.5);
      this.bed = null;
      return;
    }
    const bedId: BedId = this.themeId;
    const want = this.bedFile();
    const synth = this.synth;
    const take = this.samples.pick(want.key, () => synth.rand());
    const wantFile = !!take;
    if (this.bed?.id === (take ? want.id : bedId) && (this.bed instanceof FileBed) === wantFile) return;
    this.bed?.stop(now);
    this.bed = take ? new FileBed(ctx, this.groups.ambience, want.id, take, now) : new AmbienceBed(this.synth, this.groups.ambience, this.ambRev, bedId, now);
  }

  /** The recorded loop the bed should play: the training grounds' own once decoded, else the floor theme's. */
  private bedFile(): { key: string; id: BedId | 'courtyard' } {
    if (this.courtyard && this.samples.ready('amb_courtyard')) return { key: 'amb_courtyard', id: 'courtyard' };
    return { key: `amb_${this.themeId}`, id: this.themeId };
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
    // the recorded loop finished decoding after the synthesized bed (or the theme's loop, in the training grounds) started: swap to it
    if (this.bed && (this.bed instanceof FileBed ? this.bed.id !== this.bedFile().id : this.samples.ready(this.bedFile().key))) this.refreshBed(now);
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

/** A recorded ambience loop (public/audio/amb): the whole take loops seamlessly, faded in and out like the synth bed. */
class FileBed {
  private readonly src: AudioBufferSourceNode;
  private readonly gain: GainNode;
  constructor(ctx: AudioContext, dest: AudioNode, readonly id: BedId | 'courtyard', take: Take, t: number) {
    this.src = ctx.createBufferSource();
    this.src.buffer = take.buf;
    this.src.loop = true;
    this.src.loopStart = take.offset;
    this.src.loopEnd = take.buf.duration;
    this.gain = ctx.createGain();
    this.gain.gain.setValueAtTime(0, t);
    this.gain.gain.linearRampToValueAtTime(take.gain, t + 2.5);
    this.src.connect(this.gain);
    this.gain.connect(dest);
    this.src.start(t, take.offset);
  }
  tick(_now: number, _ahead: number): void { /* a loop needs no scheduling */ }
  stop(t: number, fade = 3): void {
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(0, t + fade);
    this.src.stop(t + fade + 0.1);
    this.src.onended = () => { try { this.gain.disconnect(); } catch { /* gone */ } };
  }
}
