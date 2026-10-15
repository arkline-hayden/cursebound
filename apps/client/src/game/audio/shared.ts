import type { AudioEngine } from './AudioEngine';
import { settingsStore } from '@/lib/settings';

// One AudioEngine for the whole app (title screen, menus and the game), so music carries across client-side
// navigation: the title song cross-fades into the loadout song instead of cutting out. Created lazily (the engine
// module is only loaded in the browser) and unlocked by the first pointer or key press anywhere (autoplay policy),
// or at once when the page already had a user gesture (navigating from the title screen into the game).

let engine: Promise<AudioEngine | null> | null = null;
let armed = false;

/** The shared engine (created on first call; null if WebAudio is unavailable). */
export function sharedAudio(): Promise<AudioEngine | null> {
  engine ??= (async () => {
    try {
      const { AudioEngine } = await import('./AudioEngine');
      const eng = new AudioEngine((text) => {
        if (settingsStore.get().s.captions) window.dispatchEvent(new CustomEvent('cursebound:caption', { detail: text }));
      });
      eng.setVolumes(settingsStore.get().s.volumes);
      // keep the engine's faders on the player's settings wherever they change (settings page, pause menu)
      let last = settingsStore.get().s.volumes;
      settingsStore.subscribe(() => {
        const v = settingsStore.get().s.volumes;
        if (v !== last) { last = v; eng.setVolumes(v); }
      });
      armUnlock(eng);
      return eng;
    } catch {
      return null;   // audio is optional
    }
  })();
  return engine;
}

function armUnlock(eng: AudioEngine) {
  if (armed) return;
  armed = true;
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (activation?.hasBeenActive) void eng.unlock();
  const unlock = () => { void eng.unlock(); if (eng.unlocked) { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); } };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}
