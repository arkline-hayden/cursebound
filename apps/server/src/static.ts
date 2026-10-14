import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { ServerConfig } from './config';

// Static client serving for the desktop app (docs/contracts/ONLINE_CONTRACT.md "Desktop app"): when
// CURSEBOUND_STATIC_DIR is set the authority serves the exported Next.js client from its own origin, so the API and the
// room socket are same-origin. Paths are confined to the export directory; hashed build assets are cached forever.

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  // React Server Component payloads of the static export (the client router accepts text/plain in export mode)
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

/** Origin of a cloud base URL plus its WebSocket form (`https://x` → `wss://x`), or nothing when unset/invalid. */
function cloudSources(cloudUrl: string | null): string[] {
  if (!cloudUrl) return [];
  try {
    const u = new URL(cloudUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return [];
    return [u.origin, `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`];
  } catch { return []; }
}

/**
 * The page CSP: next.config.mjs's production policy (keep the two in sync), with `connect-src` extended for the
 * same-origin room socket, the cloud origin and its wss: form, and STUN/TURN for peer-to-peer co-op.
 */
export function staticCsp(cfg: Pick<ServerConfig, 'port' | 'cloudUrl'>): string {
  const connect = ["'self'", `ws://127.0.0.1:${cfg.port}`, `ws://localhost:${cfg.port}`, ...cloudSources(cfg.cloudUrl), 'stun:', 'turn:', 'turns:'];
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    `connect-src ${connect.join(' ')}`,
    "media-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function staticHeaders(cfg: Pick<ServerConfig, 'port' | 'cloudUrl'>): Record<string, string> {
  return {
    'content-security-policy': staticCsp(cfg),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  };
}

/**
 * Map a request path to a file inside `root`, or null when it escapes the root or is malformed. Directory-style and
 * extensionless routes resolve to the exported page (`/play/` and `/play` → play/index.html, else play.html).
 */
export function resolveStaticPath(root: string, pathname: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  // backslashes and NUL never appear in exported paths; rejecting them closes Windows separator tricks
  if (decoded.includes('\0') || decoded.includes('\\') || !decoded.startsWith('/')) return null;
  if (decoded.split('/').some((seg) => seg === '..')) return null;
  const rel = path.posix.normalize(decoded).replace(/^\/+/, '');
  const base = path.resolve(root);
  const candidates = rel === '' || rel.endsWith('/')
    ? [path.join(rel, 'index.html')]
    : path.posix.extname(rel) ? [rel] : [rel, path.join(rel, 'index.html'), `${rel}.html`];
  for (const c of candidates) {
    const abs = path.resolve(base, c);
    if (abs !== base && !abs.startsWith(base + path.sep)) return null;
    try { if (fs.statSync(abs).isFile()) return abs; } catch { /* try the next candidate */ }
  }
  return null;
}

/** Request handler for the exported client. GET/HEAD only; unknown routes get the export's 404 page. */
export function createStaticHandler(cfg: ServerConfig) {
  const root = path.resolve(cfg.staticDir ?? '.');
  return function serveStatic(req: IncomingMessage, res: ServerResponse): void {
    const headers = staticHeaders(cfg);
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { ...headers, allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
      res.end('method not allowed');
      return;
    }
    const pathname = (req.url ?? '/').split(/[?#]/)[0] || '/';
    let file = resolveStaticPath(root, pathname);
    let status = 200;
    if (!file) {
      status = 404;
      const notFound = path.join(root, '404.html');
      file = fs.existsSync(notFound) ? notFound : null;
    }
    if (!file) {
      res.writeHead(404, { ...headers, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end('not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const hashed = pathname.startsWith('/_next/static/');
    let size: number;
    try { size = fs.statSync(file).size; } catch {
      res.writeHead(404, { ...headers, 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(status, {
      ...headers,
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'content-length': String(size),
      // content-hashed build output never changes under the same name; pages and payloads revalidate every load
      'cache-control': hashed && status === 200 ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (method === 'HEAD') { res.end(); return; }
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  };
}
