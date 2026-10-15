import type { FxSpec } from '../fxPrims';
import { SPECS as ARCANIST } from './arcanist';
import { SPECS as ARTIFICER } from './artificer';
import { SPECS as BERSERKER } from './berserker';
import { SPECS as CRYOMANCER } from './cryomancer';
import { SPECS as DUELIST } from './duelist';
import { SPECS as HEXBINDER } from './hexbinder';
import { SPECS as RANGER } from './ranger';
import { SPECS as TEMPLAR } from './templar';
import { SPECS as VANGUARD } from './vanguard';
import { SPECS as WARDEN } from './warden';

// Per-class procedural effect sheets (projectile sprites, signature shapes). Each class owns its file; effects.ts
// appends them to the shared specs so generate.ts uploads them with nearest filtering like every other effect.

export const CLASS_FX_SPECS: FxSpec[] = [
  ...ARCANIST, ...ARTIFICER, ...BERSERKER, ...CRYOMANCER, ...DUELIST, ...HEXBINDER, ...RANGER, ...TEMPLAR, ...VANGUARD, ...WARDEN,
];
