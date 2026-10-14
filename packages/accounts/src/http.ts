import type { IncomingMessage } from 'node:http';
import type { Account } from './types';

// The routing contract shared by the local authority and the cloud service: route handlers receive the path match,
// the request, the parsed URL and a per-request context; they return a JSON-able body or throw an HttpError.

export const MAX_BODY = 64 * 1024;

export class HttpError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

/** The signed-in account behind a request, with the hash of the session token it presented. */
export interface AuthState { account: Account; sessionHash: string }

/** Per-request context: response headers to add (Set-Cookie) and the lazily resolved signed-in account. */
export interface RouteCtx {
  headers: Record<string, string | string[]>;
  auth(): Promise<AuthState | null>;
  requireAuth(): Promise<AuthState>;
}
export type RouteFn = (m: RegExpMatchArray, req: IncomingMessage, url: URL, ctx: RouteCtx) => Promise<unknown>;

/** Registers a handler; `path` is relative to /api/v1 and may contain `:name` segments (captured in order). */
export type RouteRegistrar = (method: string, path: string, fn: RouteFn) => void;

/** Compiles a route path into the regular expression both servers match against `URL.pathname`. */
export function routePattern(path: string, prefix = '/api/v1'): RegExp {
  return new RegExp('^' + prefix + path.replace(/:([a-z]+)/g, '([^/]+)') + '$');
}

/**
 * Parse a JSON body of at most `limit` bytes. An oversized body is rejected with 413 at once; the rest is discarded
 * (not buffered) so the error response still reaches the client, and the server closes the connection after it.
 */
export function readBody(req: IncomingMessage, limit = MAX_BODY): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      if (over) return;
      size += c.length;
      if (size > limit) { over = true; chunks.length = 0; reject(new HttpError(413, 'TOO_LARGE', 'request body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (over) return;
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'INVALID_INPUT', 'invalid JSON body')); }
    });
    req.on('error', reject);
  });
}
