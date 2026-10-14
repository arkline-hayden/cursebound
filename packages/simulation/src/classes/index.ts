// Class kits: each module registers its SimHooks (castSkill, basicAttack, onEnemyHit, ...) for its classId.
// Imported once for its side effects by sim.ts. Vanguard and Arcanist are still implemented inline in
// players.ts/combat.ts; new classes live here, one file per class.
import './duelist';
import './artificer';
import './hexbinder';
import './vanguard';
import './arcanist';
import './warden';
import './cryomancer';
import './ranger';
import './templar';
import './berserker';
export {};
