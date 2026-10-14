// Online-mode session token (docs/contracts/ONLINE_CONTRACT.md): the cloud bearer token, kept in the desktop app's
// OS-encrypted store (Electron safeStorage via the preload's `window.cursebound.secureStore`) when present, else in
// localStorage. Listeners hear sign-in / sign-out so presence and other online features can (re)connect.

const KEY = 'cursebound.cloud.token';

interface SecureStore { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; del(key: string): Promise<void> }
declare global {
  interface Window { cursebound?: { desktop?: boolean; version?: string; secureStore?: SecureStore; updates?: { onReady(cb: (version: string) => void): void; install(): void; manual?: boolean } } }
}

let token: string | null = null;
let loaded = false;
const subs = new Set<(token: string | null) => void>();

function secure(): SecureStore | null {
  return typeof window !== 'undefined' ? window.cursebound?.secureStore ?? null : null;
}

/** Load the stored token once (async because the desktop store is IPC-backed). */
export async function loadCloudToken(): Promise<string | null> {
  if (loaded) return token;
  loaded = true;
  try {
    const s = secure();
    token = s ? await s.get(KEY) : localStorage.getItem(KEY);
  } catch { token = null; }
  return token;
}

/** Current token (after loadCloudToken resolved). */
export function cloudToken(): string | null {
  return token;
}

export async function setCloudToken(next: string | null): Promise<void> {
  token = next;
  loaded = true;
  try {
    const s = secure();
    if (s) await (next ? s.set(KEY, next) : s.del(KEY));
    else if (next) localStorage.setItem(KEY, next);
    else localStorage.removeItem(KEY);
  } catch { /* storage unavailable: the session lasts for this window only */ }
  subs.forEach((f) => f(next));
}

/** Subscribe to sign-in / sign-out; returns an unsubscribe function. */
export function onCloudToken(fn: (token: string | null) => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}
