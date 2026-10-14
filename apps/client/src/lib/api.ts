// Thin client for /api/v1 (proxied by Next.js to the local authority). Mutations carry an Idempotency-Key.
// The session cookie (HttpOnly) rides along automatically: the API is same-origin through the proxy.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function api<T = any>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (method !== 'GET') headers['idempotency-key'] = crypto.randomUUID();
  let r: Response;
  try {
    r = await fetch(`/api/v1${path}`, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'OFFLINE', 'The local game service is not reachable. Is `npm start` running?');
  }
  let j: any = null;
  try { j = await r.json(); } catch { /* ignore */ }
  if (!r.ok) throw new ApiError(r.status, j?.error?.code ?? 'HTTP_' + r.status, j?.error?.message ?? `Request failed (${r.status})`);
  return j as T;
}
