// Scripted bosses register themselves on import (sim.ts imports this module once). One line per boss.
import './corruptCore';
import './ironColossus';

export { bossBotHint, bossScript, registerBossScript, type BossScript, type BotHint } from './registry';
