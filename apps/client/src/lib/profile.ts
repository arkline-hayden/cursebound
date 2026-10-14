import { api } from './api';
import { refreshAuth } from './auth';

// The profile a player plays as. Signed in, it is the account's profile (lib/auth.ts). Signed out, it is a local
// guest identity stored per browser; a per-tab guest can be created for local co-op. A guest profile that has since
// been claimed by an account is never reused while signed out — a fresh guest takes its place.
export interface Profile { id: string; displayName: string; account?: string | null }
const KEY = 'cursebound.profile';

function read(storage: Storage): Profile | null {
  try { const v = storage.getItem(KEY); return v ? (JSON.parse(v) as Profile) : null; } catch { return null; }
}

function write(p: Profile, tabOnly: boolean) {
  try { (tabOnly ? sessionStorage : localStorage).setItem(KEY, JSON.stringify({ id: p.id, displayName: p.displayName })); } catch { /* storage may be unavailable */ }
}

export function cachedProfile(): Profile | null {
  if (typeof window === 'undefined') return null;
  return read(sessionStorage) ?? read(localStorage);
}

/** The local guest profile id, for an account to adopt when it is created in this browser. */
export function guestProfileId(): string | null {
  const p = cachedProfile();
  return p && !p.account ? p.id : null;
}

export async function ensureProfile(name?: string): Promise<Profile> {
  const account = await refreshAuth().catch(() => null);
  if (account) {
    const p: Profile = { id: account.profileId, displayName: account.displayName, account: account.username };
    write(p, false);
    return p;
  }
  const cached = cachedProfile();
  if (cached) {
    try {
      const p = await api<Profile & { requestId: string }>('GET', `/local/profiles/${cached.id}`);
      if (!p.account) return { id: p.id, displayName: p.displayName, account: null };
    } catch { /* recreate below */ }
  }
  return createProfile(name ?? 'Wanderer', false);
}

export async function createProfile(name: string, tabOnly: boolean): Promise<Profile> {
  const p = await api<Profile>('POST', '/local/profiles', { displayName: name });
  write(p, tabOnly);
  return { id: p.id, displayName: p.displayName, account: null };
}

/** After deleting an account, its profile is an ordinary guest again: keep playing as it in this browser. */
export function rememberGuest(id: string, displayName: string) {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  write({ id, displayName }, false);
}

/** After signing out, forget the account's profile so this browser starts a fresh guest. */
export function forgetProfile() {
  try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function setSeat(roomId: string, token: string, slot: number) {
  try { sessionStorage.setItem('cursebound.seat', JSON.stringify({ roomId, token, slot })); } catch { /* ignore */ }
}
export function getSeat(): { roomId: string; token: string; slot: number } | null {
  try { const v = sessionStorage.getItem('cursebound.seat'); return v ? JSON.parse(v) : null; } catch { return null; }
}
export function clearSeat() { try { sessionStorage.removeItem('cursebound.seat'); } catch { /* ignore */ } }
