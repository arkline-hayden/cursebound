// Cinematic gate (shared contract): while a cutscene plays, gameplay input is ignored (CONTROLS) and the HUD and
// minimap hide (UI). Framework-free so React UI can import it without pulling in Phaser.
//
//   window event  'cursebound:cinematic'  detail { active: boolean, kind: 'door' | 'round' | 'boss' }
//   current state  cinematicState()  /  subscribeCinematic(fn)   (for components that mount mid-scene)
//
// Every start is paired with an end. Chained scenes (round intro -> boss entrance) end the first and start the next
// in the same frame, so listeners never see a gap.

export type CinematicKind = 'door' | 'round' | 'boss';
export interface CinematicGate { active: boolean; kind: CinematicKind | null }

let state: CinematicGate = { active: false, kind: null };
const listeners = new Set<(s: CinematicGate) => void>();

export function cinematicState(): CinematicGate { return state; }

export function subscribeCinematic(fn: (s: CinematicGate) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function emit(active: boolean, kind: CinematicKind) {
  state = { active, kind: active ? kind : null };
  if (typeof window !== 'undefined') {
    (window as unknown as { __cbCinematic?: CinematicGate }).__cbCinematic = state;
    window.dispatchEvent(new CustomEvent('cursebound:cinematic', { detail: { active, kind } }));
  }
  for (const fn of listeners) fn(state);
}

export function cinematicStart(kind: CinematicKind) {
  if (state.active && state.kind === kind) return;
  if (state.active && state.kind) emit(false, state.kind);
  emit(true, kind);
}

export function cinematicEnd() {
  if (!state.active || !state.kind) return;
  emit(false, state.kind);
}

/** Re-broadcast the current state (late mounts that missed the edge). */
export function cinematicRebroadcast() {
  if (state.active && state.kind && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cursebound:cinematic', { detail: { active: true, kind: state.kind } }));
  }
}
