import { accountApi, api, onlineMode } from './api';
import { loadCloudToken, setCloudToken } from './cloudSession';
import { createStore } from './store';

// Signed-in account (username + password). A signed-in player always plays as the account's own profile, so runs,
// builds, settings and records follow them. Signed out, the game falls back to a local guest profile (lib/profile.ts).
// Local mode: the local authority holds the account and a session cookie. Online mode (runtime `cloudUrl` set,
// docs/contracts/ONLINE_CONTRACT.md): the cloud holds the account behind a bearer token (lib/cloudSession.ts), and the
// player plays as the local profile linked to the cloud account, so `profileId` is that local profile's id.

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
let linked: { accountId: string; displayName: string; profileId: string } | null = null;

/** Online mode: swap in the local profile linked to the cloud account (created on first sign-in on this machine). */
async function withLocalProfile(account: Account): Promise<Account> {
  if (!(await onlineMode())) return account;
  if (linked?.accountId !== account.id || linked.displayName !== account.displayName) {
    const p = await api<{ id: string }>('POST', '/local/profiles/link', { accountId: account.id, displayName: account.displayName });
    linked = { accountId: account.id, displayName: account.displayName, profileId: p.id };
  }
  return { ...account, profileId: linked.profileId };
}

/**
 * Online mode: tell the local authority the linked account's cloud XP (lib/progress.ts), so its class gate for this
 * profile matches the cloud level (it keeps the larger of local and cloud XP; docs/contracts/ONLINE_CONTRACT.md).
 */
export async function syncLinkedXp(cloudXp: number): Promise<void> {
  if (!linked || !(await onlineMode())) return;
  await api('POST', '/local/profiles/link', { accountId: linked.accountId, displayName: linked.displayName, cloudXp });
}

async function adopt(account: Account | null): Promise<Account | null> {
  const a = account ? await withLocalProfile(account) : null;
  setAccount(a);
  return a;
}

/** Ask the server who we are (deduplicated). Network failure leaves the state unknown rather than signed out. */
export function refreshAuth(): Promise<Account | null> {
  inflight ??= (async () => {
    const online = await onlineMode();
    if (online && !(await loadCloudToken())) return adopt(null);
    const r = await accountApi<{ account: Account | null }>('GET', '/auth/me');
    // an expired or revoked cloud token is forgotten so the next start does not present it again
    if (online && !r.account) await setCloudToken(null);
    return adopt(r.account);
  })().finally(() => { inflight = null; });
  return inflight;
}

export function currentAccount(): Account | null {
  return authStore.get().account;
}

function setAccount(account: Account | null) {
  authStore.set({ status: account ? 'signedIn' : 'signedOut', account });
}

/** register/login: online mode hands back the bearer token, which is stored before the account is adopted. */
async function signedIn(r: { account: Account; token?: string }): Promise<Account> {
  if (r.token) await setCloudToken(r.token);
  return (await adopt(r.account))!;
}

export async function register(username: string, password: string, opts: { displayName?: string; claimProfileId?: string | null } = {}): Promise<Account> {
  // the cloud ignores claimProfileId: local profiles are linked, not claimed
  const claim = (await onlineMode()) ? undefined : opts.claimProfileId ?? undefined;
  return signedIn(await accountApi<{ account: Account; token?: string }>('POST', '/auth/register', { username, password, displayName: opts.displayName, claimProfileId: claim }));
}

export async function login(username: string, password: string): Promise<Account> {
  return signedIn(await accountApi<{ account: Account; token?: string }>('POST', '/auth/login', { username, password }));
}

export async function logout(): Promise<void> {
  try { await accountApi('POST', '/auth/logout'); } finally { await clearSession(); }
}

/** Forget the session on this side (after sign-out or account deletion). */
export async function clearSession(): Promise<void> {
  if (await onlineMode()) await setCloudToken(null);
  linked = null;
  setAccount(null);
}

export async function updateAccount(patch: { displayName?: string; favoriteClass?: string | null; motto?: string }): Promise<Account> {
  const r = await accountApi<{ account: Account }>('PUT', '/account', patch);
  return (await adopt(r.account))!;
}
