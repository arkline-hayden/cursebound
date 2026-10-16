/**
 * Recorded-file cues beyond the shared SfxId list (tools/audio/sounds.mjs, tier 2): per-skill casts, enemy voices,
 * boss deaths, shrine variants. Each plays through audio.playFile(key, fallback): the file when it exists in
 * public/audio (sfxFiles.generated.ts), else the shared cue the game used before, so a file is picked up the moment it
 * lands. DOM-free (tests import it).
 */

/**
 * Sim skill id -> its own recorded cast (`skill_<class>_<skill name, snake-cased>`). The file covers the whole cast
 * (wind-up, travel, impact), so a kit plays it INSTEAD of every shared cue it layers (fx/kit3.ts skillSfx / skillLayer).
 * Sub-skills without a file (shards, pulses, pet attacks) keep their shared cues. Moments with their own files that are
 * not casts (turret_shot, grenade_throw, explosion, singularity, aegis_dome, death_knell) are wired in the class fx files.
 */
export const SKILL_FILE: Record<string, string> = {
  // vanguard
  v_cleave: 'skill_vanguard_cleave',
  v_earthbreaker: 'skill_vanguard_earthbreaker',
  v_guard_stance: 'skill_vanguard_guard_stance',
  v_sweeping_strike: 'skill_vanguard_sweeping_strike',
  v_sundering_wave: 'skill_vanguard_sundering_wave',
  v_rally_cry: 'skill_vanguard_rally_cry',
  v_shield_charge: 'skill_vanguard_shield_charge',
  v_retaliate: 'skill_vanguard_retaliate',
  v_whirlwind: 'skill_vanguard_whirlwind',
  v_executioner: 'skill_vanguard_executioners_chop',
  v_war_banner: 'skill_vanguard_war_banner',
  v_thunder_shout: 'skill_vanguard_thunderous_shout',
  // arcanist
  a_spark: 'skill_arcanist_spark',
  a_astral_nova: 'skill_arcanist_astral_nova',
  a_fireline: 'skill_arcanist_fireline',
  a_arc_bolt: 'skill_arcanist_arc_bolt',
  a_tempest_field: 'skill_arcanist_tempest_field',
  a_phase_step: 'skill_arcanist_phase_step',
  a_event_horizon_field: 'skill_arcanist_event_horizon',
  a_meteor: 'skill_arcanist_meteor',
  a_flame_wall: 'skill_arcanist_flame_wall',
  a_overload: 'skill_arcanist_overload',
  a_ball_lightning: 'skill_arcanist_ball_lightning',
  a_blink_strike: 'skill_arcanist_blink_strike',
  a_rift_gate: 'skill_arcanist_rift_gate',
  // duelist
  d_twin_fangs: 'skill_duelist_twin_fangs',
  d_thousand_cuts: 'skill_duelist_thousand_cuts',
  d_rend: 'skill_duelist_rend',
  d_crimson_whirl: 'skill_duelist_crimson_whirl',
  d_execution: 'skill_duelist_execution',
  d_shadowstep: 'skill_duelist_shadowstep',
  d_phantom_rush: 'skill_duelist_phantom_rush',
  d_death_mark: 'skill_duelist_death_mark',
  d_riposte: 'skill_duelist_riposte',
  d_mirror_guard: 'skill_duelist_mirror_guard',
  d_hundred_fangs: 'skill_duelist_hundred_fangs',
  // artificer
  af_repeater: 'skill_artificer_repeater',
  af_mortar_barrage: 'skill_artificer_mortar_barrage',
  af_turret: 'skill_artificer_deploy_turret',
  af_flame_turret: 'skill_artificer_flame_turret',
  af_tesla_coil: 'skill_artificer_tesla_coil',
  af_grenade: 'skill_artificer_steam_grenade',
  af_cluster_charge: 'skill_artificer_cluster_charge',
  af_firebomb: 'skill_artificer_firebomb',
  af_overclock: 'skill_artificer_overclock',
  af_rocket_jump: 'skill_artificer_rocket_jump',
  af_boiler_overdrive: 'skill_artificer_boiler_overdrive',
  af_drone_zap: 'skill_artificer_drone_zap',
  // hexbinder
  h_hex_bolt: 'skill_hexbinder_hex_bolt',
  h_grave_tide: 'skill_hexbinder_grave_tide',
  h_plague_cloud: 'skill_hexbinder_plague_cloud',
  h_blightbloom: 'skill_hexbinder_blightbloom',
  h_locust_swarm: 'skill_hexbinder_locust_swarm',
  h_blood_tether: 'skill_hexbinder_blood_tether',
  h_hemorrhage: 'skill_hexbinder_hemorrhage',
  h_sanguine_lance: 'skill_hexbinder_sanguine_lance',
  h_summon_wraith: 'skill_hexbinder_summon_wraith',
  h_banshee: 'skill_hexbinder_banshee',
  h_grave_legion: 'skill_hexbinder_grave_legion',
  // cryomancer
  c_ice_shard: 'skill_cryomancer_ice_shard',
  c_absolute_zero: 'skill_cryomancer_absolute_zero',
  c_ice_wall: 'skill_cryomancer_ice_wall',
  c_glacial_prison: 'skill_cryomancer_glacial_prison',
  c_frost_effigy: 'skill_cryomancer_frost_effigy',
  c_effigy_burst: 'skill_cryomancer_effigy_burst',
  c_blizzard: 'skill_cryomancer_blizzard',
  c_frozen_orb: 'skill_cryomancer_frozen_orb',
  c_hail: 'skill_cryomancer_hailstone',
  c_comet: 'skill_cryomancer_glacial_comet',
  c_frost_nova: 'skill_cryomancer_frost_nova',
  c_glacial_spike: 'skill_cryomancer_glacial_spike',
  c_cold_snap: 'skill_cryomancer_cold_snap',
  c_shatter: 'skill_cryomancer_shatter',
  // ranger
  r_quick_shot: 'skill_ranger_quick_shot',
  r_rain_of_arrows: 'skill_ranger_rain_of_arrows',
  r_multishot: 'skill_ranger_multishot',
  r_barrage: 'skill_ranger_barrage',
  r_longshot: 'skill_ranger_longshot',
  r_ricochet: 'skill_ranger_ricochet',
  r_explosion: 'skill_ranger_explosive_tip',
  r_hunters_mark: 'skill_ranger_hunters_mark',
  r_power_shot: 'skill_ranger_power_shot',
  r_deadeye: 'skill_ranger_deadeye',
  r_tumble_shot: 'skill_ranger_tumble_shot',
  r_snare_trap: 'skill_ranger_snare_trap',
  r_bait: 'skill_ranger_hunters_bait',
  r_venom_cloud: 'skill_ranger_venom_cloud',
  r_hawk_dive: 'skill_ranger_hawk_dive',
  // templar (the Aegis Charge upgrade shares the Shield Charge take: "Shield / Aegis Charge")
  t_hammer: 'skill_templar_hallowed_hammer',
  t_judgment_day: 'skill_templar_judgment_day',
  t_consecrate: 'skill_templar_consecrate',
  t_dawnbreak: 'skill_templar_dawnbreak',
  t_beacon: 'skill_templar_beacon_of_light',
  t_hammer_throw: 'skill_templar_hammer_of_judgment',
  t_skyfall: 'skill_templar_skyfall_hammer',
  t_smite: 'skill_templar_divine_smite',
  t_shield_charge: 'skill_templar_shield_charge',
  t_aegis_charge: 'skill_templar_shield_charge',
  t_intercession: 'skill_templar_intercession',
  // berserker (Bladestorm shares the Whirlwind take: "Whirlwind / Bladestorm")
  b_chop: 'skill_berserker_twin_chop',
  b_avatar: 'skill_berserker_avatar_of_carnage',
  b_bloodlust: 'skill_berserker_bloodlust',
  b_bloodbath: 'skill_berserker_bloodbath',
  b_unchained: 'skill_berserker_unchained',
  b_whirlwind: 'skill_berserker_whirlwind',
  b_bladestorm: 'skill_berserker_whirlwind',
  b_executioner: 'skill_berserker_executioners_cleave',
  b_leap: 'skill_berserker_earthshatter_leap',
  b_shout: 'skill_berserker_intimidating_shout',
  b_cataclysm: 'skill_berserker_cataclysm',
  // warden
  w_thornspear: 'skill_warden_thornspear',
  w_wild_hunt: 'skill_warden_wild_hunt',
  w_entangle: 'skill_warden_entangle',
  w_verdant_totem: 'skill_warden_verdant_totem',
  w_worldroot: 'skill_warden_worldroot_eruption',
  w_call_pack: 'skill_warden_call_of_the_pack',
  w_ursine_call: 'skill_warden_spirit_of_the_ursa',
  w_alpha_pounce: 'skill_warden_alpha_pounce',
  w_thornburst: 'skill_warden_thornburst',
  w_bramble_wall: 'skill_warden_bramble_wall',
  w_thorn_pod: 'skill_warden_ironthorn_pod',
  w_wolf_bite: 'skill_warden_wolf_bite',
};

/** Enemy id -> its voice set: `<base>_alert` (notices you), `<base>_attack`, `<base>_death`. */
export const FOE_VOICE: Record<string, string> = {
  pursuer: 'foe_ghoul_hound', skirmisher: 'foe_gloom_bat', artillery: 'foe_bile_toad', guardian: 'foe_bonewarden',
  hexer: 'foe_hex_cultist', broodcaller: 'foe_brood_sac', mite: 'foe_carrion_mite', gaoler: 'foe_gaoler',
  rimewraith: 'foe_rime_wraith', gloomshade: 'foe_gloom_shade', webweaver: 'foe_web_weaver', loot_imp: 'foe_treasure_imp',
  harpy: 'foe_harpy_diver', galewisp: 'foe_gale_wisp', stormhawk: 'foe_storm_hawk', cloudgolem: 'foe_cloud_golem',
  mooncrawler: 'foe_moon_crawler', moonleaper: 'foe_lunar_leaper', lunarsentry: 'foe_lunar_sentry', voidshambler: 'foe_void_shambler',
  maintdrone: 'foe_maint_drone', firewall: 'foe_firewall_sentinel', glitchwraith: 'foe_glitch_wraith', malware: 'foe_malware_swarm',
  coredrone: 'foe_watcher_drone', coreturret: 'foe_sentry_turret', craterspawn: 'foe_crater_spawn', galeharpy: 'foe_gale_harpy',
  windelemental: 'foe_wind_elemental',
};

export type FoeVoice = 'alert' | 'attack' | 'death';

/** The voice file of an enemy kind (undefined for kinds without a voice set: bosses, training dummies). */
export function foeVoice(kind: string, voice: FoeVoice): string | undefined {
  const base = FOE_VOICE[kind];
  return base ? `${base}_${voice}` : undefined;
}

/** Boss id -> its death cry (layered on the kill sound when the boss falls). */
export const BOSS_DEATH_FILE: Record<string, string> = {
  prismstag: 'boss_death_stag', bellroot: 'boss_death_golem', corruptcore: 'boss_death_core',
  ironcolossus: 'boss_death_colossus', skydrake: 'boss_death_wyrm', moonhorror: 'boss_death_horror',
};

/** Shrine type (content SHRINES ids) -> its activation sound (fallback shrine_activate). */
export const SHRINE_FILE: Record<string, string> = {
  fury: 'shrine_fury', haste: 'shrine_haste', warding: 'shrine_warding', fortune: 'shrine_fortune', renewal: 'shrine_renewal',
};

/**
 * Per-key time gate for files that can fire from many sources at once (a pack's alerts, one cleave's kill voices):
 * ok() is true when `key` may play now, at most once per `gapMs`. The engine still caps and merges by file on top.
 */
export class CueGate {
  private readonly last = new Map<string, number>();
  ok(key: string, now: number, gapMs: number): boolean {
    if (now - (this.last.get(key) ?? -1e9) < gapMs) return false;
    this.last.set(key, now);
    return true;
  }
}
