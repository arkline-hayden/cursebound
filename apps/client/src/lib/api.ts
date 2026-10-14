import { loadCloudToken } from './cloudSession';
import { cloudUrl } from './runtime';

// Thin client for /api/v1 (proxied by Next.js to the local authority). Mutations carry an Idempotency-Key.
// The session cookie (HttpOnly) rides along automatically: the API is same-origin through the proxy.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function request<T>(url: string, method: Method, body: unknown, extra: Record<string, string>, credentials: RequestCredentials, offline: string): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...extra };
  if (method !== 'GET') headers['idempotency-key'] = crypto.randomUUID();
  let r: Response;
  try {
    r = await fetch(url, { method, headers, credentials, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'OFFLINE', offline);
  }
  let j: any = null;
  try { j = await r.json(); } catch { /* ignore */ }
  if (!r.ok) throw new ApiError(r.status, j?.error?.code ?? 'HTTP_' + r.status, j?.error?.message ?? `Request failed (${r.status})`);
  return j as T;
}

export function api<T = any>(method: Method, path: string, body?: unknown): Promise<T> {
  return request<T>(`/api/v1${path}`, method, body, {}, 'same-origin', 'The local game service is not reachable. Is `npm start` running?');
}

/** True when accounts live in the cloud (runtime config `cloudUrl` set): online mode. */
export async function onlineMode(): Promise<boolean> {
  return !!(await cloudUrl());
}

/**
 * Account-scoped calls (auth, account, builds, friends, players, social boards). Online mode sends them to
 * `${cloudUrl}/api/v1` with the bearer token and no cookies; local mode goes to the local authority as before.
 */
export async function accountApi<T = any>(method: Method, path: string, body?: unknown): Promise<T> {
  const base = await cloudUrl();
  if (!base) return api<T>(method, path, body);
  const token = await loadCloudToken();
  return request<T>(`${base}/api/v1${path}`, method, body, token ? { authorization: `Bearer ${token}` } : {}, 'omit', 'The CURSEBOUND online service is not reachable. Check your connection.');
}
