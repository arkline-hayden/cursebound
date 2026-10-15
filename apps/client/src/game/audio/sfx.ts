/**
 * SFX identifiers, captions and critical-cue list. DOM-free so Node tooling (asset manifest
 * validation) can import it; AudioEngine re-exports everything here.
 */

export type SfxId =
  | 'ui_click'
  | 'ui_hover'
  | 'ui_confirm'
  | 'ui_error'
  | 'vote_cast'
  | 'vote_lock'
  | 'fate_commit'
  | 'attack_melee'
  | 'attack_spark'
  | 'skill_guard'
  | 'skill_sweep'
  | 'skill_rally'
  | 'skill_fireline'
  | 'skill_arc'
  | 'skill_phase'
  | 'signature_slam'
  | 'signature_nova'
  | 'dodge'
  | 'hit_enemy'
  | 'hit_player'
  | 'crit'
  | 'enemy_death'
  | 'boss_telegraph'
  | 'boss_charge'
  | 'boss_ring'
  | 'boss_phase'
  | 'player_downed'
  | 'player_revived'
  | 'round_clear'
  | 'wave_spawn'
  | 'telegraph_warn'
  | 'heal'
  | 'shield'
  | 'level_up'
  | 'enemy_shoot'
  | 'enemy_bite'
  | 'heartbeat'
  | 'kill'
  | 'combo'
  | 'swing'
  | 'footstep'
  | 'legendary_drop'
  | 'legendary_equip'
  /** Fate's Blessing found or spent (prismatic chime) */
  | 'fate_blessing'
  // afflictions (FOES)
  | 'chain_throw'
  | 'chain_bind'
  | 'chain_break'
  | 'freeze_build'
  | 'freeze'
  | 'ice_shatter'
  | 'poison_spit'
  | 'poisoned'
  | 'blind_burst'
  | 'web_spit'
  | 'rooted'
  | 'silenced'
  // doors (DOORS)
  | 'door_appear'
  | 'door_hum'
  | 'door_open'
  | 'door_choose'
  | 'portal_open'
  | 'portal_enter'
  // cutscenes (CINEMA)
  | 'cine_whoosh'
  | 'title_boom'
  | 'round_start'
  | 'boss_rumble'
  | 'boss_emerge'
  | 'boss_roar'
  | 'stag_cry'
  | 'bell_toll'
  // movement / ui
  | 'move_click'
  | 'minimap_ping'
  | 'chest_open'
  | 'potion_glug'
  // room events (render/RoomEvents.ts)
  | 'coin_pickup'
  | 'shrine_activate'
  | 'altar_pact'
  | 'merchant_buy'
  | 'imp_jingle'
  | 'imp_portal';

export type MixGroup = 'music' | 'combat' | 'ui' | 'ambience';

/**
 * menu    lobby / loadout theme
 * explore the current dungeon theme's song held at exploration intensity (door walk, intermissions)
 * combat  the current dungeon theme's song, intensity-driven
 * boss    the current boss's song (setBoss), falling back to a generic boss song
 */
export type MusicTrack = 'menu' | 'explore' | 'combat' | 'boss';

/** Dungeon themes with their own music, ambience bed and footstep surface (DUNGEON_THEMES ids). */
export type AudioTheme = 'catacombs' | 'flooded' | 'ossuary' | 'sanctum' | 'fungal' | 'forge' | 'frost' | 'sky' | 'moon' | 'server';
export const AUDIO_THEMES: readonly AudioTheme[] = ['catacombs', 'flooded', 'ossuary', 'sanctum', 'fungal', 'forge', 'frost', 'sky', 'moon', 'server'];

/** Musical stingers (audio.stinger). Each ducks the music briefly. */
export type StingerKind = 'door_open' | 'portal' | 'round_start' | 'boss_reveal' | 'boss_roar' | 'round_clear' | 'legendary' | 'party_wipe';
export const STINGER_KINDS: readonly StingerKind[] = ['door_open', 'portal', 'round_start', 'boss_reveal', 'boss_roar', 'round_clear', 'legendary', 'party_wipe'];

/**
 * Stinger timing in seconds from the call: `hit` is the accent/impact moment (sync visuals to it), `duration`
 * is when the tail has died away and the music duck has fully released.
 */
export const STINGER_TIMING: Record<StingerKind, { hit: number; duration: number }> = {
  door_open: { hit: 0.35, duration: 2.6 },
  portal: { hit: 0.9, duration: 3.2 },
  round_start: { hit: 0.05, duration: 2.6 },
  boss_reveal: { hit: 2.0, duration: 5.5 },
  boss_roar: { hit: 0.12, duration: 2.8 },
  round_clear: { hit: 0.0, duration: 3.4 },
  legendary: { hit: 0.0, duration: 3.0 },
  party_wipe: { hit: 0.0, duration: 6.0 },
};

export const SFX_IDS: readonly SfxId[] = [
  'ui_click',
  'ui_hover',
  'ui_confirm',
  'ui_error',
  'vote_cast',
  'vote_lock',
  'fate_commit',
  'attack_melee',
  'attack_spark',
  'skill_guard',
  'skill_sweep',
  'skill_rally',
  'skill_fireline',
  'skill_arc',
  'skill_phase',
  'signature_slam',
  'signature_nova',
  'dodge',
  'hit_enemy',
  'hit_player',
  'crit',
  'enemy_death',
  'boss_telegraph',
  'boss_charge',
  'boss_ring',
  'boss_phase',
  'player_downed',
  'player_revived',
  'round_clear',
  'wave_spawn',
  'telegraph_warn',
  'heal',
  'shield',
  'level_up',
  'enemy_shoot',
  'enemy_bite',
  'heartbeat',
  'kill',
  'combo',
  'swing',
  'footstep',
  'legendary_drop',
  'legendary_equip',
  'fate_blessing',
  'chain_throw',
  'chain_bind',
  'chain_break',
  'freeze_build',
  'freeze',
  'ice_shatter',
  'poison_spit',
  'poisoned',
  'blind_burst',
  'web_spit',
  'rooted',
  'silenced',
  'door_appear',
  'door_hum',
  'door_open',
  'door_choose',
  'portal_open',
  'portal_enter',
  'cine_whoosh',
  'title_boom',
  'round_start',
  'boss_rumble',
  'boss_emerge',
  'boss_roar',
  'stag_cry',
  'bell_toll',
  'move_click',
  'minimap_ping',
  'chest_open',
  'potion_glug',
  'coin_pickup',
  'shrine_activate',
  'altar_pact',
  'merchant_buy',
  'imp_jingle',
  'imp_portal',
];

/** Cues that are never voice-stolen and always produce a caption. */
export const CRITICAL_SFX: readonly SfxId[] = ['boss_telegraph', 'telegraph_warn', 'player_downed'];

/** Human-readable captions for notable cues (critical ones always fire). */
export const SFX_CAPTIONS: Partial<Record<SfxId, string>> = {
  boss_telegraph: 'Boss attack incoming',
  telegraph_warn: 'Danger zone',
  player_downed: 'Ally downed',
  player_revived: 'Ally revived',
  boss_charge: 'Boss charging',
  boss_ring: 'Bell shockwave',
  boss_phase: 'Boss phase change',
  wave_spawn: 'Enemies incoming',
  round_clear: 'Round clear',
  vote_lock: 'Vote locked',
  fate_commit: 'Fate committed',
  legendary_drop: 'Legendary item dropped',
  legendary_equip: 'Legendary equipped',
  fate_blessing: 'Fate’s Blessing',
  chain_throw: '[chain whips]',
  chain_bind: '[chain clanks]',
  chain_break: '[chain snaps]',
  freeze_build: '[frost creeps]',
  freeze: '[ice locks]',
  ice_shatter: '[ice shatters]',
  poison_spit: '[venom spat]',
  poisoned: '[poison burns]',
  blind_burst: '[blinding flash]',
  web_spit: '[web spat]',
  rooted: '[webbed down]',
  silenced: '[silenced]',
  door_appear: '[doors rise]',
  door_open: '[door groans open]',
  portal_open: '[a portal tears open]',
  door_choose: '[door chosen]',
  portal_enter: '[portal swallows]',
  title_boom: '[deep boom]',
  round_start: '[war horn]',
  boss_rumble: '[ground rumbles]',
  boss_emerge: '[something emerges]',
  boss_roar: '[boss roars]',
  stag_cry: '[stag shrieks]',
  bell_toll: '[bell tolls]',
  chest_open: '[chest creaks open]',
  shrine_activate: '[shrine awakens]',
  altar_pact: '[the altar drinks]',
  imp_jingle: '[coins jingle]',
  imp_portal: '[a rift tears open]',
};
