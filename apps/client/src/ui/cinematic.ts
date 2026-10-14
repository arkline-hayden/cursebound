// Cinematic gate (shared contract): CINEMA dispatches `cursebound:cinematic` { active, kind } on window. While active the
// HUD, minimap and other gameplay overlays fade out. This module keeps the latest state in a tiny store (so
// components mounted mid-cutscene start hidden) and mirrors it on <html data-cinematic="true"> for CSS-only overlays
// (hints, captions, banners, loot labels). The listener installs once, on first import in the browser.

import { createStore, useStore } from '@/lib/store';

export interface CinematicState { active: boolean; kind: string | null }

export const cinematicStore = createStore<CinematicState>({ active: false, kind: null });

let installed = false;
function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('cursebound:cinematic', (e: Event) => {
    const d = ((e as CustomEvent).detail ?? {}) as { active?: boolean; kind?: string };
    const active = !!d.active;
    cinematicStore.set({ active, kind: active ? d.kind ?? null : null });
    if (active) document.documentElement.dataset.cinematic = 'true';
    else delete document.documentElement.dataset.cinematic;
  });
}
install();

/** True while a cutscene is playing. */
export function useCinematic(): boolean {
  install();
  return useStore(cinematicStore, (s) => s.active);
}
