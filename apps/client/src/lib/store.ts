import { useSyncExternalStore } from 'react';

// Minimal external store: high-frequency game state stays outside React; components subscribe to slices.
export interface Store<T> { get(): T; set(patch: Partial<T> | ((s: T) => Partial<T>)): void; subscribe(fn: () => void): () => void }

export function createStore<T extends object>(init: T): Store<T> {
  let state = init;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? (patch as (s: T) => Partial<T>)(state) : patch;
      state = { ...state, ...p };
      subs.forEach((f) => f());
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

export function useStore<T extends object, S>(store: Store<T>, sel: (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => sel(store.get()), () => sel(store.get()));
}
