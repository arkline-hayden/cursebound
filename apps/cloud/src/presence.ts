import type http from 'node:http';

// Presence + signaling WebSocket (docs/contracts/ONLINE_CONTRACT.md "Presence and signaling").
// STUB: the interface is fixed here; the implementation lands with the peer-to-peer work.

export interface PresenceIdentity { accountId: string; username: string; displayName: string; favoriteClass: string | null }

export interface PresenceDeps {
  /** resolve a bearer token to the signed-in account, or null */
  authenticate(token: string): Promise<PresenceIdentity | null>;
  /** accepted friends of an account */
  friendIds(accountId: string): Promise<string[]>;
  /** the HTTP side calls the registered function when an account's friend list changes (request accepted, removed…) */
  onFriendsChanged?: (subscribe: (accountId: string) => void) => void;
  log: { info(msg: string, f?: Record<string, unknown>): void; warn(msg: string, f?: Record<string, unknown>): void; error(msg: string, f?: Record<string, unknown>): void };
}

export interface PresenceHandle {
  /** live socket count, for /healthz and metrics */
  connections(): number;
  close(): Promise<void>;
}

/** Attach the presence WebSocket endpoint (`/api/v1/presence`) to the cloud HTTP server. */
export function attachPresence(_server: http.Server, _deps: PresenceDeps): PresenceHandle {
  return { connections: () => 0, close: async () => undefined };
}
