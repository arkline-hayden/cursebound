// Per-boss grand entrances register themselves on import (Cinematic.ts imports this module). One line per boss.
import './corruptCore';
import './ironColossus';
import './skyDrake';
import './moonHorror';

export { BOSS_ENTRANCES, ENTRANCE_LIFT, registerEntrance, type Entrance, type EntranceKit } from './registry';
