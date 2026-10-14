# Art, animation and audio contract (PRD §15, F11, REQ ACCESS01)

No external image/audio files exist. All sprites, tiles, effects, icons and audio are generated procedurally at runtime by code
(deterministic: same input -> same pixels). This is the "asset pipeline": the generator source is the editable source asset, and
`apps/client/src/game/art/manifest.ts` lists every asset ID with provenance/license/version/tags/reviewStatus (PRD §15.3).

Visual direction (§15.1): colorful, imaginative, pixel-art-esque, saturated jewel palettes, playful impossible architecture,
clear material contrast. Three-quarter top-down view on a flat ground plane. 8-direction characters with grounded shadows
(the renderer draws shadows; sprites must NOT include a shadow). 1px dark outline (not pure black — deep indigo #1a1030 style) around
sprites for readability. Player silhouettes, enemy roles and damaging shapes must be identifiable when five players share an arena.
Logical presentation is 960x540 scaled to the viewport with nearest-neighbor sampling (pixelArt: true).
Biome for MVP: **Prismwood Canopy** — luminous foliage, crystal/glass trees, glass beasts, teal/violet/magenta/gold glow.

## Files (all under `apps/client/src/game/`)
- `art/palette.ts` — named palettes. Export `PALETTES` for classes/enemies/biome AND `TELEGRAPH_PALETTES: Record<'default'|'deuteranopia'|'protanopia'|'tritanopia'|'highContrast', { danger: number; dangerFill: number; ally: number; enemyOutline: number; allyOutline: number; heal: number; shield: number; burn: number; storm: number; astral: number; decay: number; physical: number; frost: number }>` (0xRRGGBB numbers). Colorblind palettes must keep danger distinct from ally/heal.
- `art/generate.ts` — `export function buildArt(scene: Phaser.Scene): void` creates every texture + animation below exactly once (guard with `scene.textures.exists`). Must complete in < 1.5 s on a mid laptop. Use offscreen `<canvas>` + `ImageData`/`fillRect` pixel drawing, then `scene.textures.addSpriteSheet(key, canvas, { frameWidth, frameHeight })` (or addCanvas + add frames).
- `art/actors.ts` — exports below helpers + `ACTOR_META`.
- `art/tiles.ts` — tileset generation + autotile picker.
- `art/effects.ts` — effect textures.
- `art/manifest.ts` — asset manifest array.
- `audio/AudioEngine.ts` — WebAudio synthesized SFX + music.
- `../ui/icons/` (i.e. `apps/client/src/ui/icons/`) — React SVG pixel icons for DOM UI.

Phaser version is 3.90.0 (`import Phaser from 'phaser'`). Code must be safe to import only on the client (no top-level `window` access at module load — access inside functions).
TypeScript strict. Do not add npm dependencies.

## Directions
`dir8` integer: 0=E, 1=SE, 2=S, 3=SW, 4=W, 5=NW, 6=N, 7=NE (screen space, +y down).
Characters (players) author 5 directions: `e, se, s, ne, n`; W-side uses flipX of the E-side counterpart (sw=se flipped, w=e flipped, nw=ne flipped).
Ordinary enemies author 3 directions: `e, s, n` (diagonals pick nearest: se/ne->e, sw/nw->e flipped, w->e flipped).
Bosses: `prismstag` authors `e, s, n`; `bellroot` is non-directional (`s` only).

```ts
export type ActorId = 'vanguard' | 'arcanist' | 'pursuer' | 'skirmisher' | 'artillery' | 'guardian' | 'hexer' | 'broodcaller' | 'mite' | 'prismstag' | 'bellroot';
export type ActorState = 'idle' | 'run' | 'attack' | 'cast' | 'dodge' | 'hit' | 'downed' | 'revive' | 'death' | 'windup' | 'stagger';
export const ACTOR_META: Record<ActorId, { frameW: number; frameH: number; originX: number; originY: number /* feet */; shadowRadius: number /* px */; states: ActorState[] }>;
/** Returns the animation key and flip for an actor/state/dir8. Falls back to 'idle' if the state is not authored for that actor. */
export function animFor(actor: ActorId, state: ActorState, dir8: number): { key: string; flipX: boolean };
```
Animation key format: `${actor}:${state}:${dir}` e.g. `vanguard:run:se`. Texture key: `actor:${actor}`.

### Actors & required states (frame counts are minimums; use per-frame durations, not one global rate)
| actor | size | states (frames) | look |
|---|---|---|---|
| vanguard (player class) | 48x48 | idle 4, run 8 (loop), attack 6, cast 6, dodge 4, hit 2, downed 2 (loop), revive 4, death 6 | armored knight, broad pauldrons, tower shield + cleaver blade, warm gold/teal plate, crimson cape. Big readable silhouette |
| arcanist (player class) | 48x48 | same as vanguard | robed mage, tall pointed hood/hat with floating prism, staff with glowing ember crystal, violet/cyan robes |
| pursuer | 48x48 | idle 4, run 6, windup 4, attack 4, hit 2, death 6 | glass hound: low quadruped, faceted crystal body, cyan/white, glowing eyes |
| skirmisher | 48x48 | same | prism darter: agile bird/dragonfly, magenta/gold wings |
| artillery | 48x48 | same | lantern toad: squat, glowing throat sac lantern (orange), mossy green |
| guardian | 48x48 | same | shellback sentinel: turtle golem with big FRONT shield plate (shield must read as frontal), blue/silver |
| hexer | 48x48 | same | thorn witchlight: floating wisp-witch with thorny crown, toxic lime/purple |
| broodcaller | 48x48 | same | hive bloom: bulbous flower pod on root legs, pink/yellow, pods on body |
| mite | 32x32 | idle 2, run 4, windup 2, attack 2, hit 1, death 4 | tiny glass beetle summon, pale pink |
| prismstag (boss) | 128x128 | idle 4, run 6, windup 4, attack 6, stagger 3, death 8 | giant crystal stag, enormous branching prism antlers emitting light, white/cyan/rainbow refractions |
| bellroot (boss) | 160x160 | idle 4, windup 4, attack 6, stagger 3, death 8 (dir `s` only; `run` may alias idle) | towering root colossus with a giant bronze bell for a torso and a glowing core (core visibly exposed in `stagger`), roots, moss, amber glow |

Animation principles: anticipation in windup/attack, squash/stretch-ish pixel shifts, leg cycles in run, weapon trail frames in attack, dodge = roll/blur pose, hit = white flash frame tint baked into frame 1, death = shatter/dissolve into crystal shards.
Weapon/silhouette must stay consistent across directions.

## Tiles (`tiles.ts`)
Texture key `tiles:prismwood`, 32x32 frames. Export:
```ts
export const TILE_SIZE = 32;
export function pickTile(isWall: (x: number, y: number) => boolean, x: number, y: number, hash: number): number; // frame index; walls whose south neighbor is floor show a "face" tile (3/4 view) with top cap, interior walls show canopy top; floors pick among >= 6 variants (moss glass, crystal flecks, glowing roots, petals) with hash
export function decorFrames(): number[]; // non-colliding decoration frames (glow mushrooms, crystal shards, flowers) the renderer may scatter on floors
```
Floor must be calm and darker than actors (action plane less noisy than backgrounds); walls are luminous crystal trees/foliage.
Also generate a `bg:prismwood` 480x270 parallax/backdrop texture (deep gradient sky with floating crystal motes) drawn behind the map.

## Effects (`effects.ts`) — texture keys
- `fx:spark` 12x12 ember bolt (2 frames), `fx:arc` 16x16 lightning node, `fx:shard` 10x10 enemy glass shard projectile, `fx:lob` 14x14 artillery glob,
  `fx:orb` 12x12 enemy magic orb, `fx:wave` 24x24 sundering wave, `fx:slash` 64x64 slash arc sheet (5 frames), `fx:slam` 96x96 ground slam ring (6 frames),
  `fx:nova` 96x96 astral burst (6 frames), `fx:hit` 24x24 impact star (4 frames), `fx:crit` 32x32 crit burst (4 frames), `fx:heal` 16x16 heal sparkle (4 frames),
  `fx:shield` 48x48 shield bubble (4 frames loop), `fx:burn` 8x8 flame particle (3 frames), `fx:mote` 4x4 glow particle, `fx:revive` 48x48 revive ring (4 frames),
  `fx:teleport` 48x48 rift (5 frames), `fx:spawn` 48x48 spawn portal (6 frames), `fx:death` 32x32 shard burst (6 frames), `fx:pool` 64x64 hex pool (3 frames loop),
  `fx:lightpool` 64x64 prism light pool (3 frames loop), `fx:root` 32x32 root wall segment, `fx:flame` 32x32 ground flame (4 frames loop), `fx:field` 64x64 storm field (4 frames loop).
Register looping/one-shot animations with key `fx:<name>` (same as texture key).
Telegraphs are NOT textures — the renderer draws them with Phaser Graphics (shape-coded outlines + fills) so they stay crisp.

## Icons (`apps/client/src/ui/icons/index.tsx`)
React components rendering crisp pixel-art inline SVG (`shape-rendering="crispEdges"`, rects on a 16x16 grid scaled by `size`), with `aria-hidden` by default (the surrounding UI labels them):
```tsx
export function CardIcon(props: { cardId: string; size?: number }): JSX.Element;   // family motif + per-card accent
export function NodeIcon(props: { nodeId: string; size?: number }): JSX.Element;
export function ClassEmblem(props: { classId: 'vanguard' | 'arcanist'; size?: number }): JSX.Element;
export function StatIcon(props: { stat: string; size?: number }): JSX.Element;      // for Ledger groups
```
Card IDs and families (family -> two cards):
blood: blood_pact, red_horizon · glass: glass_cathedral, shattered_crown · tempo: rapid_evolution, chasing_thunder · growth: immortal_ambition, deep_renewal ·
horde: endless_horde, thousand_footsteps · gold: golden_catastrophe, gilded_ruin · titan: colossal_bargain, titan_offering · time: temporal_collapse, borrowed_tomorrow ·
mirror: mirrorstorm, prism_rain · decay: plague_bloom, rotting_garden · transit: wild_transit, comet_walk · thorn: thorn_covenant, iron_orchard.
Node IDs: vanguard — v_guard_stance v_reinforced v_recovery_pulse v_shield_reach v_shared_shelter v_bastion v_sweeping_strike v_heavy_edge v_deep_cut v_follow_through v_fracture v_sundering_path v_rally_cry v_endurance v_second_wind v_rescue_pace v_unbroken_rhythm v_standard_bearer v_earthbreaker v_cleave (basic);
arcanist — a_spark a_kindling a_heat_sink a_fireline a_ash_recovery a_inferno a_arc_bolt a_conductivity a_charged_reserve a_fork a_static_shell a_tempest a_phase_step a_rift_focus a_quickening a_return_mark a_temporal_reserve a_event_horizon a_astral_nova;
shared — dodge, mastery_damage, mastery_health, mastery_regen. Unknown IDs render a generic rune icon (never throw).
Stat icon names: damage, health, recovery, enemy_health, enemy_offense, mobility, projectiles, score, armor, crit, healing, shield, resource, regen.

## Audio (`audio/AudioEngine.ts`)
```ts
export type SfxId = 'ui_click'|'ui_hover'|'ui_confirm'|'ui_error'|'vote_cast'|'vote_lock'|'fate_commit'|'attack_melee'|'attack_spark'|'skill_guard'|'skill_sweep'|'skill_rally'|'skill_fireline'|'skill_arc'|'skill_phase'|'signature_slam'|'signature_nova'|'dodge'|'hit_enemy'|'hit_player'|'crit'|'enemy_death'|'boss_telegraph'|'boss_charge'|'boss_ring'|'boss_phase'|'player_downed'|'player_revived'|'round_clear'|'wave_spawn'|'telegraph_warn'|'heal'|'shield'|'level_up'|'enemy_shoot'|'enemy_bite';
export type MixGroup = 'music'|'combat'|'ui'|'ambience';
export class AudioEngine {
  constructor(onCaption?: (text: string, sfx: SfxId) => void);
  unlock(): Promise<void>;                   // create/resume AudioContext after an explicit user gesture (browser autoplay policy)
  get unlocked(): boolean;
  setVolumes(v: { master: number; music: number; combat: number; ui: number; ambience: number }): void; // 0..1 each, separate gain nodes
  play(id: SfxId, opts?: { pan?: number /* -1..1 */; priority?: number; volume?: number }): void; // voice limiting: max 24 simultaneous cosmetic voices, lowest priority/oldest stolen first; boss_telegraph/telegraph_warn/player_downed are never stolen and always fire onCaption
  setMusic(track: 'menu' | 'combat' | 'boss' | null): void;  // procedurally sequenced loops (Prismwood: bright glassy arps, marimba/glass bells, soft pads); crossfade
  setIntensity(x: number): void;             // 0..1 adds layers (percussion, bass, lead) to the combat loop
  dispose(): void;
}
```
Synthesize everything with oscillators, noise buffers, filters and envelopes. Captions: provide human text for critical cues ("Boss attack incoming", "Danger zone", "Ally downed"). Never make information audio-only.

## Manifest (`art/manifest.ts`)
`export const ASSET_MANIFEST: { id: string; kind: 'sprite'|'tileset'|'effect'|'icon'|'audio'; source: string /* generator module path */; provenance: 'procedural'; author: 'CURSEBOUND procedural generator'; license: 'Project-owned (generated)'; version: string; tags: string[]; reviewStatus: 'draft'|'reviewed'; states?: string[] }[]`
plus `export function validateManifest(): string[]` returning problems (missing states vs ACTOR_META, missing card/node icons, duplicate IDs). `tools/assets/src/validate.ts` (Node, run with tsx) should import the manifest + content IDs and print problems, exiting 1 if any — keep that tool free of Phaser/browser imports (manifest.ts must not import Phaser).
