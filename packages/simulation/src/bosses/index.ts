// Scripted bosses register themselves on import (sim.ts imports this module once). One line per boss.
import './corruptCore';    // the Corrupted Core (server)
import './ironColossus';   // the Iron Colossus (forge)
import './skyDrake';       // the Gale Wyrm (sky)
import './moonHorror';     // the Crater Horror (moon)

export { bossAltitude, bossBotHint, bossImmune, bossScript, registerBossScript, type BossScript, type BotHint } from './registry';
export { closestFloor, isVoidAt, pushHero, solidGround, voidFall } from './chasm';
export { voidBeamDir } from './moonHorror';
