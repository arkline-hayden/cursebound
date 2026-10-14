// Next.js frontend (PRD §17.1): pages, interface and assets. /api/v1 is forwarded to the authoritative backend;
// the room WebSocket connects directly to the configured room URL (port 2567).
// CURSEBOUND_STATIC_EXPORT=1 builds the static export the desktop app's local authority serves (apps/server/src/static.ts
// sends the same headers and CSP there; keep the two policies in sync).
const API_PORT = process.env.CURSEBOUND_PORT ?? '2567';
const dev = process.env.NODE_ENV !== 'production';
const staticExport = process.env.CURSEBOUND_STATIC_EXPORT === '1';

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  `connect-src 'self' ws://localhost:${API_PORT} ws://127.0.0.1:${API_PORT} ws://*:${API_PORT}${dev ? ' ws://localhost:3000 ws://127.0.0.1:3000' : ''}`,
  "media-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: false,
  poweredByHeader: false,
  transpilePackages: ['@cursebound/content', '@cursebound/numeric', '@cursebound/protocol', '@cursebound/simulation'],
  env: { NEXT_PUBLIC_ROOM_PORT: API_PORT },
  ...(staticExport
    ? {
        // static HTML per route (`/play/` → play/index.html), no server features. With a custom distDir the export is
        // written there directly (apps/client/out), so a running dev server's .next stays untouched.
        output: 'export',
        trailingSlash: true,
        images: { unoptimized: true },
        distDir: 'out',
      }
    : {
        async rewrites() {
          return [{ source: '/api/v1/:path*', destination: `http://127.0.0.1:${API_PORT}/api/v1/:path*` }];
        },
        async headers() {
          return [{
            source: '/:path*',
            headers: [
              { key: 'Content-Security-Policy', value: csp },
              { key: 'X-Content-Type-Options', value: 'nosniff' },
              { key: 'Referrer-Policy', value: 'no-referrer' },
              { key: 'X-Frame-Options', value: 'DENY' },
              { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
            ],
          }];
        },
      }),
};

export default config;
