// CURSEBOUND audio inventory: every sound the game plays, as real audio files (ElevenLabs).
// e(file, when, prompt, seconds, { v: variants, loop, tier, kind, id }) -- `file` is the base name (no extension);
// variants > 1 means file_01.mp3 .. file_NN.mp3. `id` = the game's current cue id when it differs from the file name.

export const STYLE = {
  sfx: '16-bit retro dark fantasy game sound effect, gritty lo-fi with a subtle chiptune edge, punchy, clean tail, no music, no voice',
  ui: 'retro 8-bit chiptune UI sound for a dark fantasy game menu, crisp and short, no music',
  vox: 'retro dark fantasy game creature sound, gritty and slightly bit-crushed, no music, no words',
  amb: 'seamless looping ambience for a retro 16-bit dark fantasy dungeon game, lo-fi, no music, no melody, no voices',
  sting: 'short dark 80s chiptune and gothic synth music sting for a Diablo-like dungeon crawler, square and pulse waves with a dark organ edge',
  music: 'instrumental, dark 80s chiptune meets gothic synth, Diablo-inspired dungeon crawler soundtrack, loopable, no vocals',
};

const S = [];
let cur = null;
const sec = (key, title, blurb, kind) => { cur = { key, title, blurb, kind, items: [] }; S.push(cur); };
const e = (file, when, prompt, sec_, o = {}) => cur.items.push({ file, when, prompt, seconds: sec_, variants: o.v ?? 1, loop: !!o.loop, tier: o.tier ?? 1, kind: o.kind ?? cur.kind, id: o.id ?? null, tool: o.tool ?? (cur.kind === 'music' ? 'music' : 'sfx'), note: o.note ?? '' });

// ---------------------------------------------------------------- 1. interface
sec('ui', 'Interface & menus', 'Buttons, panels, the title screen and the lobby. Short and quiet; these play constantly.', 'ui');
e('ui_click', 'Any button press', 'a short crisp menu click, a tiny stone tick with a soft square-wave blip', 0.5, { v: 2 });
e('ui_hover', 'Pointer or controller focus moves onto a button', 'a very soft, quiet cursor blip, barely there', 0.5, { v: 2 });
e('ui_confirm', 'Confirming a choice (Descend, Ready, Save)', 'a satisfying confirm chime, two quick rising square-wave notes with a small metallic ring', 0.7);
e('ui_error', 'Not allowed / invalid action', 'a low dull denied buzz, short and muted', 0.5);
e('ui_back', 'Back / Esc / closing a dialog', 'a soft descending two-note blip, gentle and short', 0.5, { tier: 3 });
e('ui_tab', 'Switching tabs (settings, results breakdown)', 'a quick parchment page flick with a tiny click', 0.5, { tier: 3 });
e('ui_panel_open', 'A panel or drawer opens (gear, ledger, training tools)', 'a heavy leather tome opening with a soft whoosh', 0.6, { tier: 3 });
e('ui_panel_close', 'A panel or drawer closes', 'a leather tome softly closing, a muffled thump', 0.5, { tier: 3 });
e('ui_toggle', 'Flipping a settings toggle', 'a small mechanical switch clack', 0.5, { tier: 3 });
e('ui_slider', 'Dragging a volume or speed slider (plays per notch)', 'a tiny wooden notch tick', 0.5, { tier: 3 });
e('ui_type', 'Typing a name or invite code', 'a soft single typewriter key tap, muted', 0.5, { v: 3, tier: 3 });
e('ui_toast', 'A notice pops up (friend online, camera, errors)', 'a gentle notification chime, a single soft bell blip', 0.6, { tier: 3 });
e('press_start', 'Title screen: "Press any key" pressed', 'a dark ignition whoosh into a low resonant chime, like a torch flaring to life', 1.2, { tier: 2 });
e('title_boom', 'Title wordmark slams in', 'a deep cinematic boom with a dark reverb tail and a faint metallic ring', 2.5);
e('move_click', 'Clicking the ground to walk', 'a soft quick tap, like a pebble set down on stone', 0.5, { v: 2 });
e('minimap_ping', 'Opening or pinging the minimap', 'a small sonar-like ping blip with a short echo', 0.6);
e('ready_up', 'Lobby: a player readies up', 'a sword sliding out of its sheath with a bright ring', 0.8, { tier: 3 });
e('party_join', 'Lobby: a friend joins the party', 'a heavy wooden door thud and a welcoming low chime', 1.0, { tier: 3 });
e('party_leave', 'Lobby: a player leaves', 'a door closing softly with a falling note', 0.8, { tier: 3 });
e('invite_received', 'A friend invites you to a party', 'a raven wing flutter and a bright two-note chime', 1.0, { tier: 3 });
e('countdown_tick', 'Lobby or vote countdown, last seconds', 'a single clock tick with a low metallic tock', 0.5, { tier: 3 });
e('tutorial_step', 'Tutorial: a step completed', 'a small rising sparkle chime, encouraging', 0.8, { tier: 3 });

sec('vessel', 'Class select (Vessel Select)', 'The lineup screen. Each class gets its own sting when picked.', 'ui');
e('vessel_shift', 'Moving the highlight to another hero', 'a soft airy whoosh with a faint stone scrape', 0.5, { v: 2 });
e('vessel_locked', 'Highlighting a locked class', 'a heavy iron padlock rattling against chains, a dull thunk', 0.8);
e('vessel_roar', 'Confirming a hero: the portal swallows them', 'a portal erupting with a deep roar, swirling wind and a bright magical flare', 2.0);
e('vessel_pick_vanguard', 'Vanguard selected', 'a shield slammed down on stone and a steel ring, heroic and heavy', 1.0);
e('vessel_pick_arcanist', 'Arcanist selected', 'a crackle of arcane fire and a shimmering astral chime', 1.0);
e('vessel_pick_duelist', 'Duelist selected', 'two blades crossing with a sharp ring and a quick swish', 1.0);
e('vessel_pick_hexbinder', 'Hexbinder selected', 'a sinister whispering hiss and a sickly bubbling curse', 1.0);
e('vessel_pick_artificer', 'Artificer selected', 'clanking gears, a steam hiss and a tesla zap', 1.0);
e('vessel_pick_templar', 'Templar selected', 'a holy bell strike with a radiant choir-like synth swell', 1.0);
e('vessel_pick_berserker', 'Berserker selected', 'a heavy axe thud into wood and a guttural roar-like rumble', 1.0);
e('vessel_pick_cryomancer', 'Cryomancer selected', 'crystalline ice forming with a cold glassy shimmer', 1.0);
e('vessel_pick_ranger', 'Ranger selected', 'a bowstring drawn taut and released with a wind whoosh', 1.0);
e('vessel_pick_warden', 'Warden selected', 'rustling leaves, creaking roots and a distant spectral wolf howl', 1.2);

sec('progress', 'Results, progression & rewards', 'End-of-run screens, XP, unlocks, the daily bounty.', 'ui');
e('level_up', 'You gain a level', 'a short triumphant fanfare jingle, bright rising square-wave arpeggio with a cymbal shimmer', 1.6);
e('xp_tick', 'Results: XP bar filling (plays repeatedly)', 'a tiny bright coin-like tick', 0.5, { tier: 3 });
e('score_tick', 'Results: score counting up (plays repeatedly)', 'a quick soft ticker click', 0.5, { tier: 3 });
e('new_record', 'Results: a new personal best', 'a gleaming victory chime with sparkles, short and celebratory', 1.5, { tier: 3 });
e('class_unlock', 'A new class is unlocked', 'heavy chains breaking apart, a lock falling, then a bright heroic chime', 2.0, { tier: 2 });
e('bounty_complete', 'Daily bounty completed', 'a wax seal stamped, then a gold coin purse jingle and a short fanfare', 1.6, { tier: 3 });
e('skill_rank_up', 'Spending a skill point', 'a rune etched into stone with a bright magical ping', 0.7, { tier: 2 });
e('skill_refund', 'Refunding skill points', 'a rune fading with a soft reversed shimmer', 0.7, { tier: 3 });
e('ledger_open', 'Opening the Fate Ledger', 'an old book thumped open with a page rustle and a faint ominous hum', 0.8, { tier: 3 });

// ---------------------------------------------------------------- 2. hero basics
sec('hero', 'Hero movement & combat basics', 'The sounds that play the most. Get variations so they never sound repetitive.', 'sfx');
e('footstep_stone', 'Walking on stone floors (catacombs, sanctum, forge)', 'a single armored boot footstep on stone', 0.5, { v: 4 });
e('footstep_wet', 'Walking on flooded floors', 'a single footstep splashing in shallow water', 0.5, { v: 4 });
e('footstep_bone', 'Walking on bone-strewn floors (ossuary)', 'a single footstep crunching on dry bones and gravel', 0.5, { v: 4 });
e('footstep_carpet', 'Walking on rugs and carpets', 'a single soft muffled footstep on a thick rug', 0.5, { v: 4 });
e('footstep_moss', 'Walking on moss and fungus', 'a single soft squishy footstep on moss', 0.5, { v: 4 });
e('footstep_grass', 'Walking on grass (sky island)', 'a single footstep on short grass and soil', 0.5, { v: 4 });
e('footstep_grate', 'Walking on metal grates (server room)', 'a single boot footstep on a metal grate with a light clang', 0.5, { v: 4 });
e('footstep_snow', 'Walking on snow and ice (frost)', 'a single footstep crunching in packed snow', 0.5, { v: 4 });
e('footstep_dust', 'Walking on moon dust', 'a single soft dry footstep in fine powdery dust, muffled', 0.5, { v: 4 });
e('dodge', 'Dodge roll', 'a quick dodge roll, cloth whoosh and a light scuff on the ground', 0.6, { v: 3 });
e('swing', 'Weapon swing (whiff)', 'a fast weapon swing whoosh through the air', 0.5, { v: 4 });
e('attack_melee', 'A melee strike lands', 'a sword strike connecting, a clean meaty slash', 0.5, { v: 3 });
e('hit_player', 'You take a hit', 'a heavy blow against armor, a dull metallic thump with a short crunch', 0.5, { v: 3 });
e('hero_grunt', 'You take a big hit (layered on hit_player)', 'a short pained male warrior grunt, gritty', 0.5, { v: 3, kind: 'vox', tier: 2 });
e('heal', 'Healing received', 'a warm healing shimmer, soft rising chimes with a gentle glow', 1.0);
e('shield', 'A shield or barrier forms on you', 'a magical barrier forming, a humming glassy shell with a bright edge', 0.8);
e('potion_glug', 'Drinking a potion', 'drinking a potion, a cork pop and two quick gulps', 1.0);
e('player_downed', 'A hero is downed', 'a hero collapsing, armor clattering to the ground with a deep falling tone', 1.5);
e('hero_death', 'A hero dies (bleeds out)', 'a final dying warrior gasp, low and grim', 1.2, { kind: 'vox', tier: 2 });
e('player_revived', 'A hero is revived', 'a revival, a rising holy chime and a deep breath of air, hopeful', 1.5);
e('revive_channel', 'Holding to revive an ally (loop while channeling)', 'a soft rising magical hum with sparkles, steady', 3.0, { loop: true, tier: 3 });
e('heartbeat', 'Low health / Bloodlust pulse', 'a single slow heavy heartbeat, a deep double thump', 1.0);
e('combo', 'Combo counter goes up', 'a quick rising blip, a punchy chiptune counter tick', 0.5, { v: 3 });

sec('impact', 'Hits, crits & kills', 'Every damage type sounds different. These are what make combat feel crunchy.', 'sfx');
e('impact_light', 'Light physical hit (daggers, arrows, bolts)', 'a light quick impact, a sharp tick and a short fleshy slap', 0.5, { v: 4 });
e('impact_heavy', 'Heavy physical hit (hammers, axes, slams)', 'a heavy crushing impact, a hard crack over a deep bassy thump', 0.6, { v: 3 });
e('impact_fire', 'Fire damage hit', 'a fiery impact, a whoomp of flame with crackling embers', 0.6, { v: 3 });
e('impact_frost', 'Frost damage hit', 'an icy impact, a glassy crack and a tinkle of frost', 0.6, { v: 3 });
e('impact_storm', 'Lightning damage hit', 'an electric impact, a sharp zap snap with buzzing sparks', 0.6, { v: 3 });
e('impact_decay', 'Poison / decay damage hit', 'a wet sickly impact, a squelching splat with a gurgle', 0.6, { v: 3 });
e('impact_astral', 'Holy / astral damage hit', 'a radiant impact, a bright crystalline ping with a soft thump', 0.6, { v: 3 });
e('hit_enemy', 'Generic hit on an enemy (fallback)', 'a meaty hit on a monster, a fleshy thud', 0.4, { v: 4 });
e('crit', 'Critical hit (layered on top)', 'a big critical hit, a sharp metallic ka-ching crack with a bass punch', 0.7, { v: 2 });
e('kill', 'Enemy killed by physical damage', 'a monster killed, a crunchy bone-breaking burst', 0.6, { v: 3 });
e('kill_burn', 'Enemy killed by fire (chars to ash)', 'a creature burning to ash, a flare and a sizzling hiss with crackles', 0.8, { v: 2 });
e('kill_shatter', 'Enemy killed by frost (shatters)', 'a frozen creature shattering, glass-like ice breaking and shards raining', 0.8, { v: 2 });
e('kill_zap', 'Enemy killed by lightning', 'a creature electrocuted, a loud zap and crackle sputtering out', 0.7, { v: 2 });
e('kill_squelch', 'Enemy killed by poison (melts)', 'a creature melting into goo, a wet splat and popping bubbles', 0.8, { v: 2 });
e('kill_chime', 'Enemy killed by holy / astral', 'a creature dissolving into light, a soft thump and a rising holy chime', 0.9, { v: 2 });
e('enemy_death', 'Generic enemy death (fallback)', 'a monster dying, a gurgling collapse', 0.8, { v: 3 });
e('knockback', 'An enemy is knocked back', 'a quick heavy whoosh and a body sliding on stone', 0.5, { v: 2, tier: 3 });

// ---------------------------------------------------------------- 3. classes
const cls = (key, name, blurb) => sec(`class_${key}`, `Class: ${name}`, blurb, 'sfx');
const k = (cl, slug, skill, prompt, s = 0.8, o = {}) => e(`skill_${cl}_${slug}`, skill, prompt, s, { tier: 2, ...o });

cls('vanguard', 'Vanguard', 'Steel, shields and earth. Heavy and grounded.');
k('vanguard', 'cleave', 'Cleave (basic attack)', 'a heavy sword cleave, a big swoosh ending in a meaty chop', 0.6, { v: 3 });
k('vanguard', 'earthbreaker', 'Earthbreaker (signature): slam that cracks the ground', 'a massive ground slam, rock cracking open with rubble and a deep boom', 1.5, { id: 'signature_slam' });
k('vanguard', 'guard_stance', 'Guard Stance', 'a heavy shield raised and locked into place, a solid steel clank', 0.7, { id: 'skill_guard' });
k('vanguard', 'sweeping_strike', 'Sweeping Strike', 'a wide heavy sword sweep, a long powerful whoosh', 0.8, { id: 'skill_sweep' });
k('vanguard', 'sundering_wave', 'Sundering Wave: a ground shockwave rolls forward', 'a rolling shockwave tearing along the ground, rumbling rocks', 1.2);
k('vanguard', 'rally_cry', 'Rally Cry', 'a rousing battle horn blast with a metallic shield clash', 1.2, { id: 'skill_rally' });
k('vanguard', 'shield_charge', 'Shield Charge', 'a charging rush of armored footsteps ending in a heavy shield bash', 1.0);
k('vanguard', 'retaliate', 'Retaliate: braced counter blast', 'a braced shield absorbing blows then bursting outward with a metallic boom', 1.0);
k('vanguard', 'whirlwind', 'Whirlwind (spin)', 'a spinning sword whirlwind, rhythmic whooshing blades', 1.5, { loop: true });
k('vanguard', 'executioners_chop', "Executioner's Chop", 'a brutal overhead chop, a huge blade slamming down with a crunch', 0.8);
k('vanguard', 'war_banner', 'War Banner planted', 'a war banner thrown and planted into stone, cloth snapping and a horn note', 1.2);
k('vanguard', 'thunderous_shout', 'Thunderous Shout', 'a thunderous war shout shockwave, a deep roaring boom with thunder crackle', 1.5);

cls('arcanist', 'Arcanist', 'Fire, lightning and astral rifts. Flashy and zappy.');
k('arcanist', 'spark', 'Spark (basic attack): small fire bolt', 'a small magic fire bolt firing, a zippy crackling fizz', 0.5, { v: 3, id: 'attack_spark' });
k('arcanist', 'astral_nova', 'Astral Nova (signature): starburst explosion', 'a huge astral nova explosion, a shimmering starburst with a deep whoomp', 1.5, { id: 'signature_nova' });
k('arcanist', 'fireline', 'Fireline: a line of fire ignites', 'a line of fire igniting across the ground with a whoosh and crackling flames', 1.2, { id: 'skill_fireline' });
k('arcanist', 'arc_bolt', 'Arc Bolt: chain lightning', 'chain lightning arcing between targets, sharp electric zaps', 0.8, { id: 'skill_arc' });
k('arcanist', 'tempest_field', 'Tempest Field (storm zone)', 'a crackling storm field, buzzing static and intermittent zaps', 3.0, { loop: true });
k('arcanist', 'phase_step', 'Phase Step (teleport)', 'a short magical teleport, a reversed whoosh and a sparkling pop', 0.6, { id: 'skill_phase' });
k('arcanist', 'event_horizon', 'Event Horizon (gravity well)', 'a gravity well forming, a deep warping hum sucking inward', 2.0);
k('arcanist', 'meteor', 'Meteor', 'a meteor falling from the sky with a rising whistle then a massive fiery explosion', 2.0);
k('arcanist', 'flame_wall', 'Flame Wall', 'a wall of fire erupting upward, roaring flames', 1.5);
k('arcanist', 'overload', 'Overload (chain detonation)', 'an overloaded chain of lightning ending in a big electric blast', 1.2);
k('arcanist', 'ball_lightning', 'Ball Lightning (rolling orb)', 'a buzzing orb of ball lightning, humming and crackling', 2.0, { loop: true });
k('arcanist', 'blink_strike', 'Blink Strike', 'a blink teleport followed by an astral strike, a pop and a bright impact', 0.8);
k('arcanist', 'rift_gate', 'Rift Gate', 'a dimensional rift tearing open, a swirling void hum', 1.5);
k('arcanist', 'singularity', 'Singularity collapse', 'a black hole collapsing, a deep imploding whomp then a blast', 2.0);

cls('duelist', 'Duelist', 'Fast blades and shadows. Sharp, quick, crimson.');
k('duelist', 'twin_fangs', 'Twin Fangs (basic attack)', 'two quick dagger slashes, crisp and sharp', 0.5, { v: 3 });
k('duelist', 'thousand_cuts', 'Thousand Cuts (signature)', 'a blur of countless rapid blade slashes ending in a sharp finale strike', 2.0);
k('duelist', 'rend', 'Rend', 'a vicious tearing blade slash with a wet rip', 0.6);
k('duelist', 'crimson_whirl', 'Crimson Whirl', 'a spinning flurry of blades, three fast whooshes', 0.8);
k('duelist', 'execution', 'Execution (lunge finisher)', 'a lightning-fast lunge and a decisive piercing stab', 0.8);
k('duelist', 'shadowstep', 'Shadowstep', 'a shadowy teleport, a dark whoosh and a soft smoky puff', 0.6, { id: 'blink' });
k('duelist', 'phantom_rush', 'Phantom Rush', 'a ghostly dash with echoing afterimage whooshes', 0.8);
k('duelist', 'death_mark', 'Death Mark (mark then detonate)', 'an ominous marking hiss followed by a sharp detonation burst', 1.2);
k('duelist', 'riposte', 'Riposte / parry', 'a sharp sword parry clang followed by a quick counter stab', 0.6);
k('duelist', 'mirror_guard', 'Mirror Guard stance', 'a blade raised in guard with a mirror-like glassy shimmer', 0.7);
k('duelist', 'hundred_fangs', 'Hundred Fangs', 'a rapid barrage of small blade strikes, tight and fast', 1.2);

cls('artificer', 'Artificer', 'Brass, steam, gears and tesla. Mechanical and clanky.');
k('artificer', 'repeater', 'Repeater (basic attack): bolt gun', 'a steampunk repeating crossbow firing a bolt, a mechanical clack and twang', 0.5, { v: 3, id: 'gun_shot' });
k('artificer', 'mortar_barrage', 'Mortar Barrage (signature)', 'a series of mortar launches thumping out, then distant whistling shells', 2.5);
k('artificer', 'deploy_turret', 'Deploy Turret', 'a mechanical turret unfolding, gears whirring and locking with a clank', 1.2, { id: 'mech_deploy' });
k('artificer', 'turret_shot', 'Turret firing (plays a lot)', 'a small automated turret firing a bolt, a quick mechanical pew', 0.5, { v: 3 });
k('artificer', 'flame_turret', 'Flame Turret', 'a mechanical flamethrower turret spraying fire, a roaring jet', 1.5, { loop: true });
k('artificer', 'tesla_coil', 'Tesla Coil', 'a tesla coil charging and arcing, buzzing high-voltage zaps', 1.5);
k('artificer', 'steam_grenade', 'Steam Grenade', 'a grenade bouncing then bursting into a big hiss of steam', 1.2);
k('artificer', 'cluster_charge', 'Cluster Charge', 'a cluster bomb popping apart into several small rapid explosions', 1.2);
k('artificer', 'firebomb', 'Firebomb', 'a glass firebomb shattering into a whoosh of flames', 1.0);
k('artificer', 'grenade_throw', 'Throwing a grenade or flask', 'an object thrown with a quick whoosh and a metallic rattle', 0.5, { id: 'throw_whoosh' });
k('artificer', 'overclock', 'Overclock (self buff)', 'machinery overclocking, gears spinning up to a high whine with a steam burst', 1.2);
k('artificer', 'rocket_jump', 'Rocket Jump', 'a rocket blast launching upward with a roaring thrust then a thudding landing', 1.5);
k('artificer', 'boiler_overdrive', 'Boiler Overdrive', 'a boiler venting a massive blast of scalding steam', 1.5, { id: 'steam_vent' });
k('artificer', 'drone_zap', 'Drone Zap', 'a small hovering drone zapping a target with a quick electric pew', 0.5, { v: 2 });
k('artificer', 'explosion', 'Mortar / bomb explosion', 'a punchy explosion with debris and a smoky tail', 1.0, { v: 3 });

cls('hexbinder', 'Hexbinder', 'Curses, plague, blood and spirits. Sickly and sinister.');
k('hexbinder', 'hex_bolt', 'Hex Bolt (basic attack)', 'a cursed bolt firing, a sinister whispering whoosh', 0.5, { v: 3 });
k('hexbinder', 'grave_tide', 'Grave Tide (signature): rolling wave of rot', 'a rolling tide of rot and bones surging forward, wet crashing with ghostly wails', 2.0);
k('hexbinder', 'plague_cloud', 'Plague Cloud', 'a glass flask shattering into a hissing toxic cloud', 1.5);
k('hexbinder', 'blightbloom', 'Blightbloom', 'a sickly plant sprouting then bursting open with a wet pop', 1.2);
k('hexbinder', 'locust_swarm', 'Locust Swarm', 'a swarm of buzzing locusts, a dense droning cloud', 2.0, { loop: true });
k('hexbinder', 'blood_tether', 'Blood Tether', 'a blood tether latching on with a wet snap and a pulsing drain', 1.2);
k('hexbinder', 'hemorrhage', 'Hemorrhage', 'a burst of blood magic, a deep pulsing throb and a splatter', 1.0);
k('hexbinder', 'sanguine_lance', 'Sanguine Lance', 'a blood lance thrust through the air with a sharp wet whoosh', 0.7);
k('hexbinder', 'summon_wraith', 'Summon Wraith', 'a wraith rising from the ground with a ghostly moan and a cold whoosh', 1.2, { id: 'summon_rise' });
k('hexbinder', 'banshee', 'Banshee wail', 'a ghostly banshee shriek, eerie and piercing', 1.5);
k('hexbinder', 'grave_legion', 'Grave Legion', 'skeletons clawing out of the earth, rattling bones and dirt', 1.5);
k('hexbinder', 'death_knell', 'Death Knell', 'a spectral bell tolling slowly with a ghostly reverb', 2.0);

cls('cryomancer', 'Cryomancer', 'Ice, blizzards and shattering. Glassy and cold.');
k('cryomancer', 'ice_shard', 'Ice Shard (basic attack)', 'an ice shard firing, a crisp glassy whoosh', 0.5, { v: 3 });
k('cryomancer', 'absolute_zero', 'Absolute Zero (signature)', 'everything freezing at once, a huge cracking surge of ice then shattering', 2.0);
k('cryomancer', 'ice_wall', 'Ice Wall', 'a wall of ice erupting from the ground, cracking and grinding', 1.2);
k('cryomancer', 'glacial_prison', 'Glacial Prison', 'ice crystals closing into a cage with a crackling lock', 1.2);
k('cryomancer', 'frost_effigy', 'Frost Effigy (summoned ice statue)', 'an ice statue forming with creaking frost and a cold shimmer', 1.2);
k('cryomancer', 'effigy_burst', 'Effigy Burst', 'an ice statue exploding into shards', 1.0);
k('cryomancer', 'blizzard', 'Blizzard (storm zone)', 'a howling blizzard with icy wind and tinkling hail', 3.0, { loop: true });
k('cryomancer', 'frozen_orb', 'Frozen Orb', 'a spinning orb of frost flying, humming with icy whistles', 1.5);
k('cryomancer', 'hailstone', 'Hailstone', 'a heavy hailstone falling and smashing on stone', 0.8, { v: 2 });
k('cryomancer', 'glacial_comet', 'Glacial Comet', 'an ice comet crashing down, a whistling fall and a giant icy impact', 1.8);
k('cryomancer', 'frost_nova', 'Frost Nova', 'a ring of ice bursting outward with a sharp cold crack', 1.0);
k('cryomancer', 'glacial_spike', 'Glacial Spike', 'a towering ice spike erupting, trembling then detonating into shards', 1.5);
k('cryomancer', 'cold_snap', 'Cold Snap', 'a sudden cold snap, a sharp freezing crack across the air', 0.8);
k('cryomancer', 'shatter', 'Shatter (frozen enemy broken)', 'frozen ice smashed apart, a satisfying glassy shatter', 0.8, { id: 'ice_shatter' });

cls('ranger', 'Ranger', 'Bows, traps and the wild. Crisp and windy.');
k('ranger', 'quick_shot', 'Quick Shot (basic attack)', 'a bow firing an arrow, a taut twang and a fast whoosh', 0.5, { v: 3, id: 'bow_shot' });
k('ranger', 'rain_of_arrows', 'Rain of Arrows (signature)', 'a volley of arrows fired skyward then raining down with many thuds', 2.5);
k('ranger', 'multishot', 'Multishot', 'several arrows fired at once, a fanning volley of twangs', 0.8);
k('ranger', 'barrage', 'Barrage', 'a rapid barrage of arrows, quick repeated twangs', 1.2);
k('ranger', 'longshot', 'Longshot', 'a powerful long-range arrow, a heavy twang and a sonic whoosh', 1.0);
k('ranger', 'ricochet', 'Ricochet', 'an arrow ricocheting off targets with metallic pings', 0.8);
k('ranger', 'explosive_tip', 'Explosive Tip', 'an arrow striking and exploding with a small fiery pop', 0.7, { v: 2 });
k('ranger', 'hunters_mark', "Hunter's Mark", 'a target being marked, a sharp lock-on ping with a hunting horn hint', 0.8);
k('ranger', 'power_shot', 'Power Shot', 'a fully drawn bow releasing a massive arrow, a deep twang and a piercing whoosh', 1.0);
k('ranger', 'deadeye', 'Deadeye', 'three precise arrows firing in quick succession with a focused ring', 1.0);
k('ranger', 'tumble_shot', 'Tumble Shot', 'a quick roll followed by an arrow shot', 0.8);
k('ranger', 'snare_trap', 'Snare Trap (snaps shut)', 'a metal bear trap snapping shut', 0.6, { id: 'trap_snap' });
k('ranger', 'hunters_bait', "Hunter's Bait", 'bait tossed down with a lure call, a wooden call whistle', 1.0);
k('ranger', 'venom_cloud', 'Venom Cloud', 'a toxic cloud hissing out', 1.2);
k('ranger', 'hawk_dive', 'Hawk Dive', 'a hawk screeching and diving with a rushing whoosh', 1.2);

cls('templar', 'Templar', 'Holy light, hammers and wards. Radiant and heavy.');
k('templar', 'hallowed_hammer', 'Hallowed Hammer (basic attack)', 'a holy hammer strike, a heavy blow with a bright ringing chime', 0.6, { v: 3 });
k('templar', 'judgment_day', 'Judgment Day (signature)', 'a pillar of holy light crashing down from the heavens, a choir swell and a thunderous boom', 2.5);
k('templar', 'consecrate', 'Consecrate', 'holy ground consecrated, a radiant hum with a soft bell', 1.5, { id: 'cast_holy' });
k('templar', 'dawnbreak', 'Dawnbreak', 'a sunrise burst of holy light, a rising radiant swell', 1.5);
k('templar', 'beacon_of_light', 'Beacon of Light', 'a floating beacon of light igniting with a pure humming tone', 1.5);
k('templar', 'hammer_of_judgment', 'Hammer of Judgment (thrown)', 'a spinning hammer thrown, whirring through the air and striking with a holy clang', 1.2);
k('templar', 'skyfall_hammer', 'Skyfall Hammer', 'a hammer falling from the sky with a whistle and a crushing holy impact', 1.5);
k('templar', 'divine_smite', 'Divine Smite', 'a divine strike from above, a crack of light and a ringing bell', 1.2, { id: 'smite' });
k('templar', 'shield_charge', 'Shield / Aegis Charge', 'an armored charge ending in a holy shield bash', 1.0, { id: 'shield_bash' });
k('templar', 'aegis_dome', 'Aegis dome raised', 'a dome of holy energy forming, a deep glassy hum', 1.2);
k('templar', 'intercession', 'Intercession (angel wings)', 'angelic wings unfurling with a radiant choir shimmer', 1.5);

cls('berserker', 'Berserker', 'Rage, axes and blood. Brutal and loud.');
k('berserker', 'twin_chop', 'Twin Chop (basic attack)', 'two heavy axe chops, brutal and meaty', 0.6, { v: 3 });
k('berserker', 'avatar_of_carnage', 'Avatar of Carnage (signature)', 'a berserker transforming in rage, a deep monstrous roar with flames and a ground slam', 2.0);
k('berserker', 'bloodlust', 'Bloodlust', 'a pounding rage heartbeat and a growl', 1.0);
k('berserker', 'bloodbath', 'Bloodbath', 'a spinning axe frenzy with gory splatter', 1.2);
k('berserker', 'unchained', 'Unchained', 'heavy chains snapping apart', 0.8, { id: 'chain_break' });
k('berserker', 'whirlwind', 'Whirlwind / Bladestorm (spin)', 'spinning axes, a heavy rhythmic whirling', 1.5, { loop: true });
k('berserker', 'executioners_cleave', "Executioner's Cleave", 'a lunging massive axe cleave, a heavy swoosh and a brutal chop', 1.0);
k('berserker', 'earthshatter_leap', 'Earthshatter Leap', 'a mighty leap then a crushing landing, rocks shattering', 1.5, { id: 'slam_heavy' });
k('berserker', 'intimidating_shout', 'Intimidating Shout', 'a terrifying roar that echoes, deep and guttural', 1.5, { id: 'beast_roar' });
k('berserker', 'cataclysm', 'Cataclysm', 'a series of fiery ground ruptures, booming quakes', 2.0);

cls('warden', 'Warden', 'Nature, thorns and spirit beasts. Earthy and wild.');
k('warden', 'thornspear', 'Thornspear (basic attack)', 'a wooden spear thrust with a thorny rustle', 0.5, { v: 3 });
k('warden', 'wild_hunt', 'Wild Hunt (signature): spirit stampede', 'a spectral stampede charging forward, thundering hooves, howls and rushing wind', 2.5);
k('warden', 'entangle', 'Entangle', 'vines erupting from the ground and wrapping tight, creaking and rustling', 1.0);
k('warden', 'verdant_totem', 'Verdant Totem', 'a wooden totem planted with a warm healing nature hum', 1.2);
k('warden', 'worldroot_eruption', 'Worldroot Eruption', 'massive roots bursting through the earth, cracking and rumbling', 1.5);
k('warden', 'call_of_the_pack', 'Call of the Pack (summon wolves)', 'spirit wolves summoned with an echoing howl', 1.5, { id: 'beast_howl' });
k('warden', 'wolf_bite', 'Spirit wolf bites (plays a lot)', 'a wolf snarl and a quick bite snap', 0.5, { v: 3 });
k('warden', 'spirit_of_the_ursa', 'Spirit of the Ursa', 'a spectral bear crashing down with a mighty roar and an impact', 1.5);
k('warden', 'alpha_pounce', 'Alpha Pounce', 'a leaping pounce landing with a growl and a thud', 0.8);
k('warden', 'thornburst', 'Thornburst', 'a burst of thorns exploding outward, sharp rustling', 0.8);
k('warden', 'bramble_wall', 'Bramble Wall', 'a thick wall of brambles growing rapidly, creaking wood', 1.2);
k('warden', 'ironthorn_pod', 'Ironthorn Pod (bursts)', 'a seed pod swelling then bursting into flying thorns', 1.0);
k('warden', 'summon_blink', 'Spirit wolf blinks back to you', 'a ghostly dissolve and reform whoosh', 0.6, { tier: 3 });

sec('fallbacks', 'Shared spell families (fallbacks)', 'Generic cast and blast sounds used when a skill has no file of its own, and by enemies and Fate effects. Make these first, since they cover everything until the per-skill sounds exist.', 'sfx');
e('cast_fire', 'Generic fire cast', 'a fire spell igniting, a rising whoosh of flame with crackles', 0.6);
e('blast_fire', 'Generic fire explosion', 'a fiery explosion, a deep boom and a rolling fireball', 1.0);
e('cast_frost', 'Generic frost cast', 'a frost spell forming, a crystalline icy shimmer', 0.6);
e('blast_frost', 'Generic frost burst', 'an ice burst, a hard crack and a hiss of frost with shards', 0.9);
e('cast_storm', 'Generic lightning cast', 'a lightning spell charging, a rising electric whine and a snap', 0.6);
e('zap_strike', 'Generic lightning strike', 'a lightning bolt striking, a split-second crack and a short thunder roll', 1.0);
e('cast_decay', 'Generic poison / curse cast', 'a dark curse cast, a gurgling whisper and sickly tones', 0.6);
e('blast_decay', 'Generic rot burst', 'a burst of rot, a wet pop and a splattering spray', 0.8);
e('cast_holy', 'Generic holy cast', 'a holy spell, a soft choir-like swell and a bell', 0.8);
e('smite', 'Generic holy strike', 'a holy strike, a thump, a crack of judgement and ringing bells', 1.0);
e('cast_astral', 'Generic astral cast', 'starlight magic, an ascending glittering shimmer', 0.6);
e('bow_shot', 'Generic bow shot', 'a bow twang and an arrow whoosh', 0.5, { v: 2 });
e('gun_shot', 'Generic mechanical shot', 'a mechanical bolt gun firing, a clack and twang', 0.5, { v: 2 });
e('throw_whoosh', 'Generic throw', 'an object thrown with a quick whoosh', 0.5);
e('slam_heavy', 'Generic heavy slam', 'a heavy ground slam, a deep thud with rubble', 1.0);
e('blade_flurry', 'Generic blade flurry', 'a quick flurry of blade slashes', 0.8);
e('shield_bash', 'Generic shield bash', 'a heavy shield bash, a metallic thud', 0.6);
e('summon_rise', 'Generic summon rising', 'something rising from the ground with a dark magical whoosh', 1.2);
e('beast_howl', 'Generic beast howl', 'a wolf howl echoing', 1.5);
e('beast_roar', 'Generic beast roar', 'a deep beast roar', 1.2);
e('mech_deploy', 'Generic mechanical deploy', 'machinery unfolding and locking in place', 1.0);
e('steam_vent', 'Generic steam vent', 'a blast of steam venting', 1.0);
e('trap_snap', 'Generic trap snap', 'a metal trap snapping shut', 0.6);
e('blink', 'Generic blink / teleport', 'a quick magical blink, a pop with a reversed whoosh', 0.6);
e('skill_guard', 'Generic guard / stance', 'a shield raised with a solid clank', 0.6);
e('skill_sweep', 'Generic wide sweep', 'a wide weapon sweep whoosh', 0.7);
e('skill_rally', 'Generic war cry / lure call', 'a short battle horn blast', 1.0);
e('skill_fireline', 'Generic fire line', 'a line of fire igniting along the ground', 1.0);
e('skill_arc', 'Generic arcing lightning', 'arcing lightning zaps', 0.7);
e('skill_phase', 'Generic phase / warp', 'a warping phase shift whoosh', 0.6);
e('signature_slam', 'Generic signature slam', 'a massive ground slam with a deep boom', 1.5);
e('signature_nova', 'Generic signature nova', 'a huge magical nova burst', 1.5);
e('attack_spark', 'Generic magic bolt', 'a small magic bolt firing, a zippy fizz', 0.5, { v: 2 });

// ---------------------------------------------------------------- 4. status effects
sec('status', 'Status effects', 'Chains, freezes, poison, blindness, webs. Players must hear these clearly.', 'sfx');
e('chain_throw', 'An enemy hurls a chain at you', 'a heavy chain whipping through the air', 0.6);
e('chain_bind', 'You are chained in place', 'heavy iron chains clanking tight around you', 0.7);
e('chain_break', 'A chain snaps (you broke free)', 'iron chains snapping apart with a sharp clank', 0.7);
e('freeze_build', 'Chill stacking up on you', 'frost creeping, a cold crackling hiss building', 0.8);
e('freeze', 'You are frozen solid', 'ice locking hard around a body, a sharp freezing crunch', 0.8);
e('ice_shatter', 'Ice shattering (you thaw / frozen foe breaks)', 'ice shattering into glassy shards', 0.8, { v: 2 });
e('poison_spit', 'An enemy spits venom', 'a creature spitting venom, a wet hiss', 0.6);
e('poisoned', 'Poison ticking on you', 'a sickly sizzling burn with a faint bubble', 0.6);
e('blind_burst', 'You are blinded', 'a blinding flash, a bright whump and a high ringing tone', 0.8);
e('web_spit', 'A web is spat at you', 'a sticky web shot, a wet thwip', 0.5);
e('rooted', 'You are webbed / rooted down', 'sticky webbing or roots wrapping tight, stretching creaks', 0.7);
e('silenced', 'You are silenced (no skills)', 'a muffled magical snuff, a dull hushed thump', 0.6);
e('slowed', 'You are slowed', 'a heavy dragging sludge sound, slowing down', 0.6, { tier: 3 });
e('stunned', 'You or a foe is stunned', 'a dizzy ringing with tiny chirping stars', 0.8, { tier: 3 });

// ---------------------------------------------------------------- 5. enemies
sec('enemy', 'Enemies: shared', 'Shared enemy attacks and warnings.', 'sfx');
e('enemy_shoot', 'An enemy fires a projectile', 'a monster spitting a magical projectile, a dark whoosh', 0.5, { v: 3 });
e('enemy_bite', 'An enemy melee attack / bite', 'a monster lunging and biting, a snarl and a snap', 0.5, { v: 3 });
e('telegraph_warn', 'A danger zone appears under you (critical cue)', 'a sharp warning tone, an urgent rising buzz', 0.6);
e('wave_spawn', 'Reinforcements arrive', 'enemies emerging, a dark rumble and a rising screech', 1.5);
e('elite_spawn', 'A champion or rare elite appears', 'an ominous aura flaring, a deep magical hum and a growl', 1.2, { tier: 2 });

sec('foes', 'Enemies: voices', 'Each foe gets an alert sound (it spots you), an attack sound and a death sound. All new; today every enemy shares the same few sounds.', 'vox');
const foe = (slug, name, id, look, alert, attack, death) => {
  e(`foe_${slug}_alert`, `${name}: spots you`, `${look}, ${alert}`, 1.0, { tier: 2, note: `enemy id: ${id}` });
  e(`foe_${slug}_attack`, `${name}: attacks`, `${look}, ${attack}`, 0.7, { tier: 2, v: 2, note: `enemy id: ${id}` });
  e(`foe_${slug}_death`, `${name}: dies`, `${look}, ${death}`, 1.0, { tier: 2, note: `enemy id: ${id}` });
};
foe('ghoul_hound', 'Ghoul Hound', 'pursuer', 'a rotting undead hound', 'a ragged snarling bark', 'a vicious snapping bite', 'a whimpering gurgling collapse');
foe('gloom_bat', 'Gloom Bat', 'skirmisher', 'a giant shadowy bat', 'a high piercing screech with wing flaps', 'a quick shriek and a swooping flutter', 'a fading squeal and a soft thud');
foe('bile_toad', 'Bile Toad', 'artillery', 'a bloated poisonous toad', 'a deep wet croak', 'a gurgling hork as it spits bile', 'a wet bursting splat');
foe('bonewarden', 'Bonewarden', 'guardian', 'a skeletal knight with a tower shield', 'rattling bones and a hollow shield clang', 'a heavy bone-and-steel shield bash', 'a skeleton collapsing into a clattering pile of bones');
foe('hex_cultist', 'Hex Cultist', 'hexer', 'a hooded dark cultist', 'a sinister whispered chant', 'a hissing curse incantation', 'a choking gasp fading into whispers');
foe('brood_sac', 'Brood Sac', 'broodcaller', 'a pulsating egg sac', 'a slimy pulsing throb', 'a wet squelch as it births mites', 'a gooey rupturing burst');
foe('carrion_mite', 'Carrion Mite', 'mite', 'a tiny skittering insect', 'rapid clicking chitters', 'a tiny chittering bite', 'a small crunchy squish');
foe('gaoler', 'Gaoler', 'gaoler', 'a hulking jailer in iron', 'a deep grunting laugh and rattling keys', 'a heavy chain hurled with a grunt', 'a massive armored body crashing down with chains');
foe('rime_wraith', 'Rime Wraith', 'rimewraith', 'an icy ghost', 'a cold hollow moan with frosty wind', 'a freezing hiss and icy whoosh', 'a ghostly wail shattering into ice');
foe('gloom_shade', 'Gloom Shade', 'gloomshade', 'a shadow phantom', 'a breathy shadowy whisper', 'a dark void whoosh', 'a hissing shadow dissipating');
foe('web_weaver', 'Web Weaver', 'webweaver', 'a giant spider', 'clicking mandibles and skittering legs', 'a hiss and a web being spat', 'a high screech and curling legs twitching');
foe('harpy_diver', 'Harpy Diver', 'harpy', 'a screeching harpy', 'a shrill cackling screech', 'a diving screech and slashing talons', 'a falling squawk and a thud');
foe('gale_wisp', 'Gale Wisp', 'galewisp', 'a small spirit of living wind', 'a swirling airy whistle', 'a sudden gust burst', 'a fading puff of wind');
foe('storm_hawk', 'Storm-Hawk', 'stormhawk', 'a crackling lightning hawk', 'a hawk cry crackling with static', 'a static bolt zap and a screech', 'a crackling squawk fizzling out');
foe('cloud_golem', 'Cloud Golem', 'cloudgolem', 'a giant of storm cloud and floating rock', 'a deep rumbling thunder growl', 'a heavy stone slam with crackling hail', 'rocks crumbling and thunder fading');
foe('moon_crawler', 'Moon-spawn Crawler', 'mooncrawler', 'a pale alien grub', 'wet alien chittering', 'an acidic hissing bite', 'a squelching pop');
foe('lunar_leaper', 'Lunar Leaper', 'moonleaper', 'a long-limbed alien hunter', 'an eerie warbling cry', 'a springy leap and a slashing landing', 'a strangled alien gurgle');
foe('lunar_sentry', 'Lunar Sentry', 'lunarsentry', 'an old lander drone', 'robotic beeping and servo whirr', 'a laser zap with a tractor beam hum', 'electronics sparking and powering down with a falling whine');
foe('void_shambler', 'Void-Eyed Shambler', 'voidshambler', 'a corpse in a spacesuit with a void for a face', 'a muffled helmet groan with radio static', 'a void gaze burst, a deep warping whoomp', 'a static-filled death rattle');
foe('maint_drone', 'Maintenance Drone', 'maintdrone', 'a corrupted repair drone', 'a glitchy robotic chirp', 'an arc welder buzz', 'a sparking crash and a powering-down whine');
foe('firewall_sentinel', 'Firewall Sentinel', 'firewall', 'a rack-sized security construct with a burning shield', 'a mechanical alarm hum and a flame whoosh', 'a burning shield bash and a crackle', 'a heavy machine crashing with a fiery fizzle');
foe('glitch_wraith', 'Glitch Wraith', 'glitchwraith', 'a digital ghost', 'a stuttering glitched digital whisper', 'a glitching teleport zap', 'a corrupted digital scream breaking apart');
foe('malware_swarm', 'Malware Swarm', 'malware', 'a swarm of corrupted code-bugs', 'a buzzing digital swarm', 'a quick glitchy bite', 'a fizzling burst of static');
foe('watcher_drone', 'Watcher Drone (Corrupted Core add)', 'coredrone', 'a small hovering security drone', 'a robotic scanning beep', 'a quick laser pew', 'a small electronic pop');
foe('sentry_turret', 'Sentry Turret (Corrupted Core add)', 'coreturret', 'an automated gun turret', 'a target-lock beep and servo whirr', 'rapid mechanical gunfire bursts', 'a sparking explosion');
foe('crater_spawn', 'Crater Spawn (Crater Horror add)', 'craterspawn', 'a small tentacled moon creature', 'a wet gurgling chirp', 'a slimy lunging bite', 'a squishy burst');
foe('gale_harpy', 'Gale Harpy (Gale Wyrm add)', 'galeharpy', 'a storm harpy', 'a shrill whistling screech', 'flinging quills with a whoosh', 'a falling shriek');
foe('wind_elemental', 'Wind Elemental (Gale Wyrm add)', 'windelemental', 'a swirling vortex of wind', 'a howling gust', 'a slowing gust bolt whoosh', 'a vortex collapsing into a sigh of wind');
foe('treasure_imp', 'Treasure Imp', 'loot_imp', 'a cheeky little goblin-like imp carrying a sack of coins', 'a mischievous giggle and coins jingling', 'a taunting cackle', 'a squeal and a burst of spilling coins');

sec('miniboss', 'Mini-bosses', 'Named mini-bosses (one per round, most rounds).', 'sfx');
e('miniboss_awaken', 'A named mini-boss is found ("…awakens!")', 'a deep ominous growl and a heavy metallic drum hit, a dark announcement', 2.0, { tier: 2 });
e('miniboss_enrage', 'Mini-boss enrages', 'a furious bestial roar with a fiery whoosh', 1.5, { tier: 2 });
e('miniboss_shield', 'Mini-boss raises a ward', 'a magical ward slamming up, a deep humming barrier', 1.0, { tier: 2 });
e('miniboss_death', 'Mini-boss dies', 'a big creature collapsing with a final roar, then a gleaming loot chime', 2.0, { tier: 2 });

// ---------------------------------------------------------------- 6. bosses
sec('boss', 'Bosses: shared', 'Shared boss cues and warnings.', 'sfx');
e('boss_telegraph', 'Boss attack incoming (critical cue)', 'an urgent deep warning horn, a menacing rising tone', 1.0);
e('boss_charge', 'Boss charges', 'a massive creature charging, thundering footsteps and a rising roar', 1.2);
e('boss_phase', 'Boss changes phase', 'a dramatic power surge, a deep boom and a rising dark swell', 2.0);
e('boss_rumble', 'Boss arena rumbles before the entrance', 'a deep ground rumble with falling dust and pebbles', 2.5);
e('boss_emerge', 'Boss emerges (entrance cutscene)', 'something massive rising, stone grinding and a deep rumbling swell', 3.0);
e('boss_roar', 'Boss roars', 'a huge monstrous roar with a reverb tail', 2.0);
e('boss_adds', 'Boss summons reinforcements', 'a dark summoning, swirling magic and screeching creatures arriving', 1.5, { tier: 2 });

sec('boss_stag', 'Boss: The Hollow Stag', 'A ghost-fire stag spirit.', 'sfx');
e('stag_cry', 'The Hollow Stag shrieks', 'a haunting ghostly stag bellow, echoing and spectral', 2.0);
e('stag_charge', 'Stag antler charge', 'galloping spectral hooves and a ghostly whoosh', 1.5, { tier: 2 });
e('boss_death_stag', 'The Hollow Stag dies', 'a dying spectral stag cry fading into ghostly wind and a cold chime', 3.0, { tier: 2 });

sec('boss_golem', 'Boss: The Bell Golem', 'A drowned golem with a great bell.', 'sfx');
e('bell_toll', 'The Bell Golem tolls', 'a huge cracked iron bell tolling, deep and doom-laden', 3.0);
e('boss_ring', 'Bell shockwave ring', 'a bell-clang shockwave, a metallic boom rippling outward', 1.5);
e('boss_death_golem', 'The Bell Golem dies', 'a massive stone golem crumbling, a final cracked bell clang', 3.0, { tier: 2 });

sec('boss_core', 'Boss: The Corrupted Core', 'A cursed server AI: lasers, firewalls, glitches.', 'sfx');
e('core_charge', 'Core charging an attack', 'capacitors spinning up, a rising electronic whine with blips', 1.2);
e('core_laser', 'Laser grid fires', 'sweeping laser beams firing, buzzing sci-fi zaps', 1.2);
e('core_firewall', 'Firewall walls close in', 'walls of digital fire roaring and closing in', 2.0, { loop: true });
e('core_glitch', 'Glitch teleport', 'a harsh digital glitch stutter and a static burst', 0.8);
e('core_purge_alarm', 'Purge countdown alarm (find a safe tile)', 'a blaring computer alarm, urgent repeating beeps', 2.0);
e('core_purge', 'System purge detonates', 'a massive electronic purge blast, a whooshing digital explosion', 1.5);
e('core_deploy', 'Drones deploy', 'mechanical hatches opening and drones whirring out', 1.0);
e('core_voice', 'The Core speaks during its entrance', 'a distorted robotic AI voice tone, glitchy and menacing, no words', 2.0, { tier: 3, kind: 'vox' });
e('boss_death_core', 'The Corrupted Core dies', 'a giant machine shutting down, a collapsing electronic whine and sparking explosions', 3.0, { tier: 2 });

sec('boss_colossus', 'Boss: The Iron Colossus', 'A molten iron colossus with a hammer.', 'sfx');
e('colossus_raise', 'Colossus raises its hammer', 'a massive iron hammer creaking upward, grinding metal and hissing steam', 1.2);
e('colossus_hammer', 'Hammer quake slam', 'a colossal hammer smashing the ground, a molten boom and shockwave', 1.8);
e('colossus_stomp', 'Piston stomp', 'a giant iron foot stomping, a heavy metallic thud with a hiss', 1.0);
e('colossus_vent', 'Furnace vents (overheat)', 'a furnace venting scalding steam with a roaring hiss', 2.0);
e('lava_vent', 'Slag bubbles before erupting', 'molten lava bubbling and gurgling', 1.5);
e('lava_erupt', 'Lava erupts', 'lava erupting violently with a fiery whoosh', 1.2);
e('boss_death_colossus', 'The Iron Colossus dies', 'a giant iron machine collapsing, groaning metal and a dying furnace roar', 3.0, { tier: 2 });

sec('boss_wyrm', 'Boss: The Gale Wyrm', 'A sky dragon of wind and lightning.', 'sfx');
e('drake_screech', 'The Wyrm screeches', 'a dragon screech, piercing and wind-torn', 2.0);
e('drake_gale', 'Gale breath blows you toward the edge', 'a howling gale of wind breath, powerful and sustained', 2.5, { loop: true });
e('drake_dive', 'The Wyrm dives', 'a dragon diving, a rushing whoosh of wind and beating wings', 1.5);
e('thunder_feather', 'Lightning feathers strike', 'a lightning strike with a crackling thunderclap', 1.0, { v: 2 });
e('skyfall', 'You are blown off the island', 'falling through the sky with rushing wind, then a magical pull back', 1.5);
e('boss_death_wyrm', 'The Gale Wyrm dies', 'a dragon dying, a final screech fading into wind and distant thunder', 3.0, { tier: 2 });

sec('boss_horror', 'Boss: The Crater Horror', 'A tentacled thing in a moon crater.', 'sfx');
e('horror_moan', 'The Crater Horror moans', 'a deep alien moan, otherworldly and dreadful', 2.5);
e('tentacle_burst', 'Tentacles burst from the ground', 'tentacles bursting out of the ground, wet slithering and cracking rock', 1.0, { v: 2 });
e('gravity_well', 'Gravity well pulls you in', 'a deep warping gravity pull, a low sucking drone', 2.5, { loop: true });
e('void_beam', 'Void beam sweep', 'a humming void beam, a deep resonant laser drone', 2.5, { loop: true });
e('boss_death_horror', 'The Crater Horror dies', 'an alien horror dying, a gurgling wail fading into silence', 3.0, { tier: 2 });

// ---------------------------------------------------------------- 7. loot & events
sec('loot', 'Loot & items', 'Drops, pickups, legendaries.', 'sfx');
e('legendary_drop', 'A legendary drops', 'a legendary item dropping, a radiant shimmer swell and a heavy gleaming clink', 2.0);
e('legendary_equip', 'Equipping a legendary', 'armor buckling on with a powerful magical surge', 1.2);
e('chest_open', 'A cursed cache / chest opens', 'an old chest creaking open with a burst of gold glints', 1.2);
e('coin_pickup', 'Picking up cursed coins', 'gold coins picked up, a bright double chink', 0.5, { v: 3 });
e('coin_drop', 'Coins spill on the floor', 'a small pile of coins scattering on stone', 0.7, { tier: 2 });
e('orb_pickup', 'Picking up a haste or health orb', 'a magical orb absorbed, a bright rising whoop', 0.6, { tier: 2 });
e('item_drop', 'A potion or orb drops', 'a small item landing with a glassy clink', 0.5, { tier: 3 });
e('fate_blessing', "Picking up a Fate's Blessing", 'a prismatic magical shimmer, a rainbow of rising chimes', 1.8);
e('blessing_apply', "Applying a Fate's Blessing to a card", 'a radiant cleansing burst, a curse lifting with a choir shimmer', 1.8, { tier: 2 });

sec('events', 'Room events', 'Shrines, the cursed altar, the merchant and the treasure imp.', 'sfx');
e('shrine_fury', 'Shrine of Fury activated', 'an ancient shrine awakening with a fiery roar of power', 1.5, { tier: 2 });
e('shrine_haste', 'Shrine of Haste activated', 'an ancient shrine awakening with a rushing wind and quick chimes', 1.5, { tier: 2 });
e('shrine_warding', 'Shrine of Warding activated', 'an ancient shrine awakening with a deep protective hum', 1.5, { tier: 2 });
e('shrine_fortune', 'Shrine of Fortune activated', 'an ancient shrine awakening with jingling gold and a bright chime', 1.5, { tier: 2 });
e('shrine_renewal', 'Shrine of Renewal activated', 'an ancient shrine awakening with a warm healing swell', 1.5, { tier: 2 });
e('shrine_activate', 'Any shrine (fallback)', 'an ancient stone shrine awakening, a stone hum swelling into a radiant chord', 1.5);
e('altar_pact', 'Accepting a cursed altar pact', 'an ominous blood pact, a low drone, a heartbeat and a dark whisper', 2.0);
e('merchant_greet', 'Approaching the wandering merchant', 'a hooded merchant chuckling softly with a lantern creak, no words', 1.2, { tier: 2, kind: 'vox' });
e('merchant_buy', 'Buying from the merchant', 'coins poured onto a counter and a pleased little chime', 1.0);
e('imp_jingle', 'A treasure imp appears / runs', 'a sack of coins bouncing and jingling as something runs', 1.0, { v: 2 });
e('imp_portal', 'The treasure imp escapes through a portal', 'a rift tearing open with a rising warble and a sucking pop', 1.5);

sec('world', 'Dungeon, doors & cinematics', 'Round flow, Fate doors, portals and cutscenes.', 'sfx');
e('round_start', 'A round begins', 'a war horn blast echoing through a dungeon', 2.0);
e('round_clear', 'Round cleared', 'a victorious bright chime with a deep resolving drum', 2.0);
e('door_appear', 'Fate doors rise from the floor', 'massive stone doors rising, grinding stone and a magical hum', 2.0);
e('door_hum', 'Standing near a Fate door', 'a magical door humming with a low pulsing resonance', 3.0, { loop: true });
e('door_choose', 'Walking into a chosen door', 'a heavy door choice, a deep boom and a magical swell', 1.2);
e('door_open', 'A Fate door groans open', 'a huge ancient door groaning open, creaking wood and iron', 2.0);
e('portal_open', 'A portal tears open', 'a magical portal tearing open, a swirling roar', 2.0);
e('portal_enter', 'Stepping through a portal', 'being swallowed by a portal, a whooshing rush and a deep thrum', 1.5);
e('vote_cast', 'Casting a Fate vote', 'a wooden token placed on a table with a soft chime', 0.6);
e('vote_lock', 'Fate vote locked', 'a heavy latch locking with a low bell ring', 0.8);
e('fate_commit', 'A Fate card is bound', 'an ominous seal stamping, a deep thud with a dark swell', 1.5);
e('cine_whoosh', 'Cutscene camera / title whoosh', 'a big cinematic whoosh', 1.0);
e('training_dummy', 'Hitting a training dummy', 'a sword thwacking a straw training dummy', 0.5, { v: 2, tier: 3 });

// ---------------------------------------------------------------- 8. ambience
sec('ambience', 'Ambience loops', 'Background beds for each floor theme. Set the length to 20 seconds and turn Loop on if your ElevenLabs version has it; otherwise I will crossfade the loop point.', 'amb');
e('amb_menu', 'Title screen background', 'a vast dark dungeon hall, distant wind, faint fire crackle and deep drones', 20, { loop: true, tier: 1 });
e('amb_catacombs', 'Catacombs floors', 'ancient catacombs, dripping water, distant echoes and faint skittering', 20, { loop: true, tier: 1 });
e('amb_flooded', 'Flooded crypt floors', 'a flooded crypt, lapping water, constant drips and hollow echoes', 20, { loop: true, tier: 1 });
e('amb_ossuary', 'Ossuary floors', 'a bone-filled ossuary, cold wind, settling bones and distant whispers', 20, { loop: true, tier: 1 });
e('amb_sanctum', 'Sanctum floors', 'a ruined holy sanctum, wind through broken stained glass and faint candle flicker', 20, { loop: true, tier: 1 });
e('amb_fungal', 'Fungal cavern floors', 'a damp fungal cavern, bubbling, squelching and soft spore puffs', 20, { loop: true, tier: 1 });
e('amb_forge', 'Forge floors', 'an ancient forge, roaring furnaces, distant hammering and hissing steam', 20, { loop: true, tier: 1 });
e('amb_frost', 'Frost floors', 'a frozen cavern, howling icy wind and creaking ice', 20, { loop: true, tier: 1 });
e('amb_sky', 'Sky island floors', 'a floating island high in the sky, strong wind gusts, flapping cloth and distant birds', 20, { loop: true, tier: 1 });
e('amb_moon', 'Moon floors', 'a desolate moon base, a deep sub-bass rumble, faint radio static and a lonely beacon beep', 20, { loop: true, tier: 1 });
e('amb_server', 'Server room floors', 'a cursed data center, humming servers, whirring fans and occasional glitchy chirps', 20, { loop: true, tier: 1 });
e('amb_courtyard', 'Training Grounds', 'a medieval town courtyard, a trickling fountain, birds and distant townsfolk murmur', 20, { loop: true, tier: 2 });

// ---------------------------------------------------------------- 9. stingers
sec('stingers', 'Music stingers', 'Short musical hits that play over the music at key moments. "Hit at" is when the main accent should land.', 'sting');
e('stinger_door_open', 'Fate doors open (hit at 0.35s)', 'a dark mysterious chord that blooms open', 2.6, { tier: 1 });
e('stinger_portal', 'Portal entered (hit at 0.9s)', 'a rising swirling arpeggio that resolves into a big chord', 3.2, { tier: 1 });
e('stinger_round_start', 'Round starts (hit immediately)', 'a bold heroic call to arms on brass-like square waves', 2.6, { tier: 1 });
e('stinger_boss_reveal', 'Boss revealed (hit at 2.0s)', 'a slow ominous build that crashes into a massive evil chord', 5.5, { tier: 1 });
e('stinger_boss_roar', 'Boss roar accent (hit immediately)', 'a sudden dramatic dark stab with a big drum hit', 2.8, { tier: 1 });
e('stinger_round_clear', 'Round cleared (hit immediately)', 'a triumphant short victory fanfare', 3.4, { tier: 1 });
e('stinger_legendary', 'Legendary found (hit immediately)', 'a shimmering magical treasure fanfare with sparkles', 3.0, { tier: 1 });
e('stinger_party_wipe', 'Party wiped (hit immediately)', 'a slow tragic descending dirge, heavy and final', 6.0, { tier: 1 });

// ---------------------------------------------------------------- 10. music (ElevenLabs Music)
sec('music', 'Music tracks (ElevenLabs Music)', 'Today the floor and boss music is synthesized in code. Make these with ElevenLabs Music (not Sound Effects), instrumental, about 2 to 3 minutes each, so every floor and boss has a real track. The four songs you already gave me stay: song-title, song-loadout, song-boss (now the fallback boss track) and song-results.', 'music');
const mus = (file, when, prompt) => e(file, when, prompt, 150, { loop: true, tier: file === 'music_training' ? 2 : 1, tool: 'music' });
mus('music_catacombs', 'Catacombs floors', 'slow brooding dungeon theme in a minor key, low pulse bass, ghostly square-wave lead, muffled war drums');
mus('music_flooded', 'Flooded crypt floors', 'melancholic watery theme, echoing arpeggios, slow and haunting, gentle dripping percussion');
mus('music_ossuary', 'Ossuary floors', 'eerie bone-rattle theme, xylophone-like chiptune bones, creepy and rhythmic');
mus('music_sanctum', 'Sanctum floors', 'fallen holy sanctum theme, dark organ chords, solemn choir-like synths, tragic');
mus('music_fungal', 'Fungal cavern floors', 'strange alien cavern theme, wobbling synths, bubbling arpeggios, weird and groovy');
mus('music_forge', 'Forge floors', 'driving forge theme, anvil-like metallic percussion, heavy bass, relentless rhythm');
mus('music_frost', 'Frost floors', 'icy cavern theme, crystalline arpeggios, cold sparse melody, slow and wintry');
mus('music_sky', 'Sky island floors', 'soaring sky island theme, airy major-modal melody in 6/8, harp-like chiptune, adventurous but dark');
mus('music_moon', 'Moon floors', 'lonely moon theme, sparse sonar pings, deep drones, unsettling locrian melody');
mus('music_server', 'Server room floors', 'cursed cyber dungeon theme at 112 bpm, pulsing square-wave arpeggios, glitchy percussion');
mus('music_training', 'Training Grounds', 'relaxed medieval town theme, light lute-like chiptune and gentle drums, warm');
mus('music_boss_stag', 'Boss: The Hollow Stag', 'galloping ghost-hunt boss theme in 6/8, theremin-like wailing lead, choir pads, fast tom drums');
mus('music_boss_golem', 'Boss: The Bell Golem', 'doom-laden boss theme built around huge tolling bells, slow heavy drums, dark organ');
mus('music_boss_core', 'Boss: The Corrupted Core', 'aggressive glitch boss theme, fast arpeggiated synths, distorted bass, alarm-like leads');
mus('music_boss_colossus', 'Boss: The Iron Colossus', 'crushing industrial boss theme, hammering metal percussion, slow heavy riffs, molten intensity');
mus('music_boss_wyrm', 'Boss: The Gale Wyrm', 'epic sky dragon boss theme, soaring heroic-dark lead, storm-like drums, fast tempo');
mus('music_boss_horror', 'Boss: The Crater Horror', 'cosmic horror boss theme, dissonant drones, creeping pulses, sudden terrifying stabs');

export const SECTIONS = S;
