// Runtime configuration (docs/contracts/ONLINE_CONTRACT.md): where the cloud lives and how to reach the room socket.
// Served by the local authority at /api/v1/config so one static client build works in web dev and the desktop app.
// Never hard-code hosts or ports elsewhere; ask here.

export interface RuntimeConfig {
  cloudUrl: string | null;
  roomWsUrl: string | null;
  build: string;
  desktop: boolean;
}

const FALLBACK: RuntimeConfig = { cloudUrl: null, roomWsUrl: null, build: 'unknown', desktop: false };
let cached: RuntimeConfig | null = null;
let inflight: Promise<RuntimeConfig> | null = null;

/** Fetch (once) and cache the runtime config; falls back to local-only defaults if the authority is unreachable. */
export function runtimeConfig(): Promise<RuntimeConfig> {
  if (cached) return Promise.resolve(cached);
  inflight ??= fetch('/api/v1/config', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : FALLBACK))
    .then((j: Partial<RuntimeConfig>) => (cached = { ...FALLBACK, ...j }))
    .catch(() => FALLBACK)
    .finally(() => { inflight = null; });
  return inflight;
}

/** Synchronous read after runtimeConfig() resolved (null before). */
export function runtimeConfigSync(): RuntimeConfig | null {
  return cached;
}

export async function cloudUrl(): Promise<string | null> {
  return (await runtimeConfig()).cloudUrl;
}

/** Room WebSocket URL: explicit override, else same origin when the authority serves the page, else the dev port. */
export async function roomWsUrl(): Promise<string> {
  const c = await runtimeConfig();
  if (c.roomWsUrl) return c.roomWsUrl;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (c.desktop) return `${proto}//${location.host}/rooms`;
  const port = process.env.NEXT_PUBLIC_ROOM_PORT ?? '2567';
  return `${proto}//${location.hostname}:${port}/rooms`;
}
