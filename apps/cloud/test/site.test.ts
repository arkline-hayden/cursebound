import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseManifest } from '../src/site';
import { startCloud, type CloudServer } from '../src/server';
import { openPglite } from '../src/sql';

// The public download site: the landing page never exposes where builds are hosted, and /download?os=… streams the
// newest build for each platform through this origin (no redirect), with the release lookups cached and failures handled.

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
const blob = (mb: number, magic: string) => { const b = Buffer.alloc(mb * 1024 * 1024, 7); b.write(magic, 0); return b; };
const FILES: Record<string, Buffer> = {
  'CURSEBOUND-Setup-0.1.9.exe': blob(3, 'MZ'),
  'CURSEBOUND-0.1.9-arm64.dmg': blob(2, 'koly'),
  'CURSEBOUND-0.1.9-x64.dmg': blob(2, 'koly'),
  'CURSEBOUND-0.1.9-x86_64.AppImage': blob(1, '\x7fELF'),
};
const WEB = 'https://web.example/acme/game/releases';

// electron-builder update manifests, in the shape each platform's build publishes
const MANIFESTS: Record<string, string> = {
  'latest.yml': [
    'version: 0.1.9', 'files:', '  - url: CURSEBOUND-Setup-0.1.9.exe', '    sha512: abc==', `    size: ${FILES['CURSEBOUND-Setup-0.1.9.exe']!.length}`,
    'path: CURSEBOUND-Setup-0.1.9.exe', 'sha512: abc==', "releaseDate: '2026-10-14T18:00:00.000Z'", '',
  ].join('\n'),
  'latest-mac.yml': [
    'version: 0.1.9', 'files:',
    '  - url: CURSEBOUND-0.1.9-arm64.zip', '    sha512: a==', '    size: 1000',
    '  - url: CURSEBOUND-0.1.9-x64.zip', '    sha512: b==', '    size: 1001',
    '  - url: CURSEBOUND-0.1.9-arm64.dmg', '    sha512: c==', `    size: ${FILES['CURSEBOUND-0.1.9-arm64.dmg']!.length}`,
    '  - url: CURSEBOUND-0.1.9-x64.dmg', '    sha512: d==', `    size: ${FILES['CURSEBOUND-0.1.9-x64.dmg']!.length}`,
    'path: CURSEBOUND-0.1.9-arm64.zip', 'sha512: a==', "releaseDate: '2026-10-14T18:00:00.000Z'", '',
  ].join('\n'),
  'latest-linux.yml': [
    'version: 0.1.9', 'files:', '  - url: CURSEBOUND-0.1.9-x86_64.AppImage', '    sha512: e==', `    size: ${FILES['CURSEBOUND-0.1.9-x86_64.AppImage']!.length}`, '    blockMapSize: 1',
    'path: CURSEBOUND-0.1.9-x86_64.AppImage', 'sha512: e==', "releaseDate: '2026-10-14T18:00:00.000Z'", '',
  ].join('\n'),
};

let lookups = 0;
let releaseUp = true;
let linuxBuilt = true;
const fakeFetch: typeof fetch = async (input) => {
  const url = String(input);
  const m = /\/latest\/download\/(latest(?:-mac|-linux)?\.yml)$/.exec(url);
  if (url.startsWith(WEB) && m) {
    lookups++;
    if (!releaseUp) return new Response('down', { status: 503 });
    if (m[1] === 'latest-linux.yml' && !linuxBuilt) return new Response('Not Found', { status: 404 });
    return new Response(MANIFESTS[m[1]!]!);
  }
  const d = /\/download\/v0\.1\.9\/(.+)$/.exec(url);
  const file = d && FILES[decodeURIComponent(d[1]!)];
  if (url.startsWith(WEB) && file) return new Response(new Uint8Array(file), { headers: { 'content-length': String(file.length), 'content-type': 'application/octet-stream' } });
  return new Response('nope', { status: 404 });
};

async function boot() {
  return startCloud({
    env: { PORT: '0', HOST: '127.0.0.1', RATE_PER_MINUTE: '100000', RELEASES_REPO: 'acme/game', RELEASES_WEB: 'https://web.example' },
    sql: await openPglite(), log: silent, fetchImpl: fakeFetch,
    presence: () => ({ connections: () => 0, close: async () => undefined }),
  });
}

describe('release manifests', () => {
  it('reads each platform build out of its manifest', () => {
    expect(parseManifest('win', MANIFESTS['latest.yml']!, WEB)).toMatchObject({ version: '0.1.9', name: 'CURSEBOUND-Setup-0.1.9.exe', size: 3 * 1048576 });
    expect(parseManifest('mac-arm64', MANIFESTS['latest-mac.yml']!, WEB)).toMatchObject({ name: 'CURSEBOUND-0.1.9-arm64.dmg', size: 2 * 1048576 });
    expect(parseManifest('mac-x64', MANIFESTS['latest-mac.yml']!, WEB)).toMatchObject({ name: 'CURSEBOUND-0.1.9-x64.dmg', url: `${WEB}/download/v0.1.9/CURSEBOUND-0.1.9-x64.dmg` });
    expect(parseManifest('linux', MANIFESTS['latest-linux.yml']!, WEB)).toMatchObject({ name: 'CURSEBOUND-0.1.9-x86_64.AppImage', size: 1048576 });
    // a manifest whose file doesn't look like ours is refused
    expect(parseManifest('win', 'version: 1.0.0\npath: evil.bat\n', WEB)).toBeNull();
  });
});

describe('download site', () => {
  let cloud: CloudServer;
  let base: string;
  beforeAll(async () => { cloud = await boot(); base = `http://127.0.0.1:${cloud.port}`; });
  afterAll(async () => { await cloud?.close(); });

  it('serves a self-contained landing page for every platform with no build-host links', async () => {
    const r = await fetch(`${base}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/^text\/html/);
    const csp = r.headers.get('content-security-policy')!;
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toMatch(/unsafe-inline/);
    const html = await r.text();
    expect(html).toContain('id="wordmark-canvas"');
    expect(html).toMatch(/src="\/site-logo\.js\?v=[a-z0-9]+"/);
    expect(html).not.toContain('class="steps"');
    expect(html).toContain('href="/download?os=win"');
    for (const p of ['mac-arm64', 'mac-x64', 'linux']) expect(html).toContain(`href="/download?os=${p}"`);
    expect(html).toContain('v0.1.9');
    expect(html).toContain('3 MB');
    expect(html).toContain('Open Anyway');
    expect(html.toLowerCase()).not.toContain('github');
    expect(html).not.toContain('web.example');
  });

  it('streams each platform build from this origin as an attachment, never redirecting', async () => {
    for (const [os, name] of [['win', 'CURSEBOUND-Setup-0.1.9.exe'], ['mac-arm64', 'CURSEBOUND-0.1.9-arm64.dmg'], ['mac-x64', 'CURSEBOUND-0.1.9-x64.dmg'], ['linux', 'CURSEBOUND-0.1.9-x86_64.AppImage']] as const) {
      const r = await fetch(`${base}/download?os=${os}`, { redirect: 'manual' });
      expect(r.status, os).toBe(200);
      expect(r.headers.get('location')).toBeNull();
      expect(r.headers.get('content-disposition')).toBe(`attachment; filename="${name}"`);
      // streamed (chunked): Cloud Run rejects non-streamed responses over 32 MiB
      expect(r.headers.get('content-length')).toBeNull();
      expect(Buffer.from(await r.arrayBuffer()).equals(FILES[name]!)).toBe(true);
    }
    // the bare link stays the Windows installer
    expect((await fetch(`${base}/download`, { method: 'HEAD' })).headers.get('content-disposition')).toContain('Setup-0.1.9.exe');
  });

  it('rejects unknown platforms and caches the release lookups', async () => {
    expect((await fetch(`${base}/download?os=amiga`)).status).toBe(400);
    const before = lookups;
    await fetch(`${base}/download?os=mac-arm64`, { method: 'HEAD' });
    await fetch(`${base}/`);
    expect(lookups).toBe(before);
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

describe('download site with missing or unreachable builds', () => {
  it('leaves out a platform the release did not build', async () => {
    linuxBuilt = false;
    const cloud = await boot();
    try {
      const base = `http://127.0.0.1:${cloud.port}`;
      const html = await (await fetch(`${base}/`)).text();
      expect(html).not.toContain('href="/download?os=linux"');
      expect(html).toContain('href="/download?os=mac-arm64"');
      expect((await fetch(`${base}/download?os=linux`)).status).toBe(503);
      expect((await fetch(`${base}/download?os=win`, { method: 'HEAD' })).status).toBe(200);
    } finally {
      linuxBuilt = true;
      await cloud.close();
    }
  });

  it('still renders the page and explains a temporarily unavailable download', async () => {
    releaseUp = false;
    const cloud = await boot();
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
