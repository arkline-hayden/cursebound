// Side-effect imports: each kit registers its cast/hazard/projectile presentation. Import once from CombatScene.
// Add `import './<class>';` here when a class gets its own fx file.
import './duelist';
import './artificer';
import './warden';
import './fate';      // Fate mechanics (boons/banes): blasts, bolts, curse circles, the Reaper
import './hexbinder';
import './vanguard';
import './arcanist';
import './cryomancer';
import './ranger';
import './templar';
import './berserker';
export { SKILL_FX, HAZARD_FX, HAZARD_LIGHT, PROJECTILE_FX, KILL_FX } from './registry';
