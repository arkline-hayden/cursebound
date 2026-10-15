// Per-boss grand entrances register themselves on import (Cinematic.ts imports this module). One line per boss.
import './corruptCore';
import './ironColossus';

export { BOSS_ENTRANCES, registerEntrance, type Entrance, type EntranceKit } from './registry';
