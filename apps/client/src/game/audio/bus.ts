/**
 * Global access to the live AudioEngine so cutscenes, door renderers and UI can reach it without prop drilling:
 *
 *   import { getAudio } from '@/game/audio/bus';
 *   getAudio()?.stinger('boss_reveal');
 *
 * Returns null until the first user gesture has created the engine (browser autoplay policy) and after dispose.
 * Type-only dependency: importing this never pulls the engine into a bundle.
 */

import type { AudioEngine } from './AudioEngine';

let current: AudioEngine | null = null;

export function getAudio(): AudioEngine | null {
  return current;
}

export function setCurrentAudio(engine: AudioEngine | null): void {
  current = engine;
}
