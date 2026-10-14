import { api } from './api';
import { createStore } from './store';

// Signed-in account (username + password, session cookie set by the server). A signed-in player always plays as
// the account's own profile, so runs, builds, settings and records follow them to any browser. Signed out, the
// game falls back to a local guest profile (lib/profile.ts).

export interface Account {
  id: string;
  username: string;
  displayName: string;
  profileId: string;
  favoriteClass: string | null;
  motto: string;
  createdAt: number;
}

export interface AuthState { status: 'unknown' | 'signedOut' | 'signedIn'; account: Account | null }

export const authStore = createStore<AuthState>({ status: 'unknown', account: null });

let inflight: Promise<Account | null> | null = null;

/** Ask the server who we are (deduplicated). Network failure leaves the state unknown rather than signed out. */
export function refreshAuth(): Promise<Account | null> {
  inflight ??= api<{ account: Account | null }>('GET', '/auth/me')
    .then((r) => { setAccount(r.account); return r.account; })
    .finally(() => { inflight = null; });
  return inflight;
}

export function currentAccount(): Account | null {
  return authStore.get().account;
}

function setAccount(account: Account | null) {
  authStore.set({ status: account ? 'signedIn' : 'signedOut', account });
}

export async function register(username: string, password: string, opts: { displayName?: string; claimProfileId?: string | null } = {}): Promise<Account> {
  const r = await api<{ account: Account }>('POST', '/auth/register', { username, password, displayName: opts.displayName, claimProfileId: opts.claimProfileId ?? undefined });
  setAccount(r.account);
  return r.account;
}

export async function login(username: string, password: string): Promise<Account> {
  const r = await api<{ account: Account }>('POST', '/auth/login', { username, password });
  setAccount(r.account);
  return r.account;
}

export async function logout(): Promise<void> {
  try { await api('POST', '/auth/logout'); } finally { setAccount(null); }
}

export async function updateAccount(patch: { displayName?: string; favoriteClass?: string | null; motto?: string }): Promise<Account> {
  const r = await api<{ account: Account }>('PUT', '/account', patch);
  setAccount(r.account);
  return r.account;
}
