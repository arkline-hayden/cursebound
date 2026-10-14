import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCloud, type CloudServer } from '../src/server';
import { openPglite } from '../src/sql';

// The public download site: the landing page never exposes where builds are hosted, and /download streams the
// newest installer through this origin (no redirect), with the release lookup cached and failures handled.

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
const INSTALLER = Buffer.alloc(3 * 1024 * 1024, 7);   // 3 MB stand-in for the setup exe
INSTALLER.write('MZ', 0);

let lookups = 0;
let releaseUp = true;
const fakeFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url.endsWith('/repos/acme/game/releases/latest')) {
    lookups++;
    if (!releaseUp) return new Response('down', { status: 503 });
    return Response.json({
      tag_name: 'v0.1.9', published_at: '2026-10-14T18:00:00Z',
      assets: [
        { name: 'latest.yml', size: 300, browser_download_url: 'https://assets.example/latest.yml' },
        { name: 'CURSEBOUND-Setup-0.1.9.exe.blockmap', size: 100, browser_download_url: 'https://assets.example/x.blockmap' },
        { name: 'CURSEBOUND-Setup-0.1.9.exe', size: INSTALLER.length, browser_download_url: 'https://assets.example/CURSEBOUND-Setup-0.1.9.exe' },
      ],
    });
  }
  if (url === 'https://assets.example/CURSEBOUND-Setup-0.1.9.exe') {
    return new Response(INSTALLER, { headers: { 'content-length': String(INSTALLER.length), 'content-type': 'application/octet-stream' } });
  }
  return new Response('nope', { status: 404 });
};

describe('download site', () => {
  let cloud: CloudServer;
  let base: string;
  beforeAll(async () => {
    cloud = await startCloud({
      env: { PORT: '0', HOST: '127.0.0.1', RATE_PER_MINUTE: '100000', RELEASES_REPO: 'acme/game', RELEASES_API: 'https://api.example' },
      sql: await openPglite(), log: silent, fetchImpl: fakeFetch,
      presence: () => ({ connections: () => 0, close: async () => undefined }),
    });
    base = `http://127.0.0.1:${cloud.port}`;
  });
  afterAll(async () => { await cloud?.close(); });

  it('serves a self-contained landing page with the current version and no build-host links', async () => {
    const r = await fetch(`${base}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/^text\/html/);
    const csp = r.headers.get('content-security-policy')!;
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toMatch(/unsafe-inline/);
    const html = await r.text();
    expect(html).toContain('CURSEBOUND');
    expect(html).toContain('href="/download"');
    expect(html).toContain('id="wordmark-canvas"');
    expect(html).toMatch(/src="\/site-logo\.js\?v=[a-z0-9]+"/);
    expect(html).not.toContain('class="steps"');
    expect(html).toContain('v0.1.9');
    expect(html).toContain('3 MB');
    expect(html.toLowerCase()).not.toContain('github');
    expect(html).not.toContain('assets.example');
  });

  it('streams the installer from this origin as an attachment, never redirecting', async () => {
    const r = await fetch(`${base}/download`, { redirect: 'manual' });
    expect(r.status).toBe(200);
    expect(r.headers.get('location')).toBeNull();
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="CURSEBOUND-Setup-0.1.9.exe"');
    expect(r.headers.get('content-type')).toBe('application/octet-stream');
    // streamed (chunked): Cloud Run rejects non-streamed responses over 32 MiB
    expect(r.headers.get('content-length')).toBeNull();
    expect(r.headers.get('transfer-encoding')).toBe('chunked');
    const body = Buffer.from(await r.arrayBuffer());
    expect(body.equals(INSTALLER)).toBe(true);
  });

  it('answers HEAD without a body and caches the release lookup', async () => {
    const before = lookups;
    const r = await fetch(`${base}/download`, { method: 'HEAD' });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toContain('CURSEBOUND-Setup-0.1.9.exe');
    await fetch(`${base}/`);
    expect(lookups).toBe(before);   // both served from the cached lookup
  });

  it('serves the in-game wordmark renderer as a script', async () => {
    const r = await fetch(`${base}/site-logo.js`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/^text\/javascript/);
    const js = await r.text();
    expect(js.length).toBeGreaterThan(1000);
    expect(js).toContain('CURSEBOUND');
  });

  it('keeps the JSON API untouched alongside the site', async () => {
    const r = await fetch(`${base}/api/v1/healthz`);
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(true);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});

describe('download site without a reachable release', () => {
  it('still renders the page and explains a temporarily unavailable download', async () => {
    releaseUp = false;
    const cloud = await startCloud({
      env: { PORT: '0', HOST: '127.0.0.1', RATE_PER_MINUTE: '100000', RELEASES_REPO: 'acme/game', RELEASES_API: 'https://api.example' },
      sql: await openPglite(), log: silent, fetchImpl: fakeFetch,
      presence: () => ({ connections: () => 0, close: async () => undefined }),
    });
    try {
      const base = `http://127.0.0.1:${cloud.port}`;
      const page = await fetch(`${base}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('Download for Windows');
      const dl = await fetch(`${base}/download`);
      expect(dl.status).toBe(503);
      expect(await dl.text()).toMatch(/unavailable/);
    } finally {
      releaseUp = true;
      await cloud.close();
    }
  });
});
