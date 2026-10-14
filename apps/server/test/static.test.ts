import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { startServer } from '../src/main';
import { resolveStaticPath, staticCsp } from '../src/static';

// Desktop mode (docs/contracts/ONLINE_CONTRACT.md "Desktop app"): the authority listens on a random port and serves
// the exported client itself. Paths stay inside the export, routes fall back to their page, headers match next.config.

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cursebound-static-'));
const root = path.join(tmp, 'client');
const dataDir = path.join(tmp, 'data');

function write(rel: string, body: string) {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
}

/** Raw GET that keeps the path verbatim (fetch/URL would normalise `..` away before it reaches the server). */
function rawGet(port: number, p: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(() => {
  write('index.html', '<!doctype html>title-page');
  write('play/index.html', '<!doctype html>play-page');
  write('play/index.txt', 'rsc-payload');
  write('404.html', '<!doctype html>not-found-page');
  write('_next/static/chunks/app-abc123.js', 'console.log(1)');
  write('_next/static/media/font.woff2', 'wOF2');
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'top-secret');
});

describe('resolveStaticPath', () => {
  it('maps routes to exported pages and blocks traversal', () => {
    expect(resolveStaticPath(root, '/')).toBe(path.join(root, 'index.html'));
    expect(resolveStaticPath(root, '/play/')).toBe(path.join(root, 'play', 'index.html'));
    expect(resolveStaticPath(root, '/play')).toBe(path.join(root, 'play', 'index.html'));
    expect(resolveStaticPath(root, '/play/index.txt')).toBe(path.join(root, 'play', 'index.txt'));
    for (const bad of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/..%5csecret.txt', '/play/../../secret.txt', '/%00', '/%E0%A4%A', 'secret.txt']) {
      expect(resolveStaticPath(root, bad), bad).toBeNull();
    }
    expect(resolveStaticPath(root, '/missing.js')).toBeNull();
  });

  it('extends connect-src for the cloud origin, its wss: form and the same-origin socket', () => {
    const csp = staticCsp({ port: 41234, cloudUrl: 'https://cloud.example.com' });
    const connect = csp.split('; ').find((d) => d.startsWith('connect-src '))!;
    expect(connect).toContain("'self'");
    expect(connect).toContain('ws://127.0.0.1:41234');
    expect(connect).toContain('https://cloud.example.com');
    expect(connect).toContain('wss://cloud.example.com');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('fonts.googleapis.com');
    expect(staticCsp({ port: 1, cloudUrl: 'javascript:alert(1)' })).not.toContain('javascript');
  });
});

describe('desktop authority (port 0 + static client)', () => {
  let srv: Awaited<ReturnType<typeof startServer>>;
  let port = 0;
  beforeAll(async () => {
    srv = await startServer({ ...process.env, CURSEBOUND_PORT: '0', CURSEBOUND_DATA_DIR: dataDir, CURSEBOUND_STATIC_DIR: root, CURSEBOUND_CLOUD_URL: 'https://cloud.example.com/' });
    srv.rooms.stop();
    port = (srv.server.address() as { port: number }).port;
  });
  afterAll(async () => { try { await srv?.shutdown(); } catch { /* ignore */ } });

  it('listens on a random port and allows its own origin', () => {
    expect(port).toBeGreaterThan(0);
    expect(srv.cfg.port).toBe(port);
    expect(srv.cfg.allowedHosts).toEqual(expect.arrayContaining([`127.0.0.1:${port}`, `localhost:${port}`]));
    expect(srv.cfg.allowedOrigins).toEqual(expect.arrayContaining([`http://127.0.0.1:${port}`, `http://localhost:${port}`]));
    expect(srv.cfg.allowedOrigins).not.toContain('http://localhost:3000');
  });

  it('serves pages with security headers and the SPA route fallback', async () => {
    const index = await fetch(`http://127.0.0.1:${port}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await index.text()).toContain('title-page');
    const csp = index.headers.get('content-security-policy')!;
    expect(csp).toContain(`ws://127.0.0.1:${port}`);
    expect(csp).toContain('wss://cloud.example.com');
    expect(index.headers.get('x-content-type-options')).toBe('nosniff');
    expect(index.headers.get('x-frame-options')).toBe('DENY');
    expect(index.headers.get('referrer-policy')).toBe('no-referrer');
    expect(index.headers.get('cache-control')).toBe('no-cache');
    for (const route of ['/play', '/play/', '/play/?code=ABC']) {
      const r = await fetch(`http://127.0.0.1:${port}${route}`);
      expect(r.status, route).toBe(200);
      expect(await r.text()).toContain('play-page');
    }
    const missing = await fetch(`http://127.0.0.1:${port}/nowhere/`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('not-found-page');
    const post = await fetch(`http://127.0.0.1:${port}/play/`, { method: 'POST' });
    expect(post.status).toBe(405);
  });

  it('serves hashed assets immutable with correct MIME types', async () => {
    const js = await fetch(`http://127.0.0.1:${port}/_next/static/chunks/app-abc123.js`);
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const font = await fetch(`http://127.0.0.1:${port}/_next/static/media/font.woff2`);
    expect(font.headers.get('content-type')).toBe('font/woff2');
    const rsc = await fetch(`http://127.0.0.1:${port}/play/index.txt`);
    expect(rsc.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(rsc.headers.get('cache-control')).toBe('no-cache');
  });

  it('blocks path traversal and foreign hosts', async () => {
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/..%5csecret.txt', '/_next/../../secret.txt']) {
      const r = await rawGet(port, p);
      expect(r.status, p).toBe(404);
      expect(r.body).not.toContain('top-secret');
    }
    const rebind = await rawGet(port, '/', { host: `evil.example:${port}` });
    expect(rebind.status).toBe(421);
  });

  it('keeps the API on /api/v1 and reports desktop mode', async () => {
    const cfg = await (await fetch(`http://127.0.0.1:${port}/api/v1/config`)).json();
    expect(cfg).toMatchObject({ cloudUrl: 'https://cloud.example.com', roomWsUrl: null, desktop: true });
    const nope = await fetch(`http://127.0.0.1:${port}/api/v1/nope`);
    expect(nope.status).toBe(404);
    expect((await nope.json()).error.code).toBe('NOT_FOUND');
  });

  it('accepts the same-origin room socket and rejects other origins', async () => {
    const open = (origin: string) => new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/rooms`, { headers: { origin } });
      ws.once('open', () => { ws.close(); resolve(true); });
      ws.once('error', () => resolve(false));
    });
    expect(await open(`http://127.0.0.1:${port}`)).toBe(true);
    expect(await open('http://localhost:3000')).toBe(false);
  });
});

describe('port 0 reporting', () => {
  it('prints one JSON listening line and shuts down on the stdin protocol', async () => {
    const tsxCli = path.resolve(here, '..', '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const child = spawn(process.execPath, [tsxCli, path.resolve(here, '..', 'src', 'main.ts')], {
      env: { ...process.env, CURSEBOUND_PORT: '0', CURSEBOUND_DATA_DIR: path.join(tmp, 'data-proc') },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const port = await new Promise<number>((resolve, reject) => {
      let buf = '';
      const t = setTimeout(() => reject(new Error('no listening line')), 60000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d: string) => {
        buf += d;
        for (const line of buf.split('\n')) {
          if (!line.startsWith('{')) continue;
          const j = JSON.parse(line) as { event?: string; port?: number };
          if (j.event === 'listening') { clearTimeout(t); resolve(j.port!); }
        }
      });
      child.once('exit', (c) => reject(new Error(`exited ${c}`)));
    });
    expect(port).toBeGreaterThan(0);
    const health = await (await fetch(`http://127.0.0.1:${port}/api/v1/health`)).json();
    expect(health.service).toBe('cursebound');
    const code = await new Promise<number | null>((resolve) => { child.once('exit', resolve); child.stdin.write('shutdown\n'); });
    expect(code).toBe(0);
  });
});
