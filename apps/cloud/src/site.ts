import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { CloudConfig } from './config';
import type { CloudLog } from './log';

// Public download site: a pixel-art landing page at `/` and `/download`, which streams the newest Windows installer
// through this service. Visitors only ever talk to this origin: the installer is fetched server-side from the
// release host and relayed byte for byte (never a redirect), so no link or hop exposes where builds are stored.
// The newest release is looked up through the releases API and cached for a few minutes.

const RELEASE_TTL_MS = 5 * 60_000;
const INSTALLER_RE = /^CURSEBOUND-Setup-[0-9][0-9A-Za-z.+-]*\.exe$/;

export interface InstallerInfo { version: string; name: string; size: number; url: string; publishedAt: string }

export interface SiteDeps {
  cfg: Pick<CloudConfig, 'releasesRepo' | 'releasesApi'>;
  log: CloudLog;
  /** injectable for tests */
  fetchImpl?: typeof fetch;
}

export interface Site {
  /** true when the path belongs to the public site (GET/HEAD) */
  handles(path: string): boolean;
  serve(req: IncomingMessage, res: ServerResponse, path: string, requestId: string): Promise<void>;
}

/**
 * The wordmark script (src/siteLogo.ts → the game's fire renderer): prebuilt next to the production bundle
 * (dist/site-logo.js), else bundled once on demand with esbuild (dev and tests run the TypeScript sources).
 */
let logoJs: Promise<string> | null = null;
/** cache-buster for the script URL: changes with every deploy (process start), so browsers never run a stale wordmark */
const LOGO_VERSION = Date.now().toString(36);
function logoScript(): Promise<string> {
  logoJs ??= (async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const built = path.join(here, 'site-logo.js');
    if (existsSync(built)) return readFileSync(built, 'utf8');
    const { build } = await import('esbuild');
    const out = await build({ entryPoints: [path.join(here, 'siteLogo.ts')], bundle: true, platform: 'browser', target: 'es2020', format: 'iife', minify: true, write: false, logLevel: 'silent' });
    return out.outputFiles[0]!.text;
  })();
  return logoJs;
}

export function createSite({ cfg, log, fetchImpl = fetch }: SiteDeps): Site {
  let cached: { at: number; info: InstallerInfo | null } | null = null;
  let inflight: Promise<InstallerInfo | null> | null = null;

  async function latest(): Promise<InstallerInfo | null> {
    if (cached && Date.now() - cached.at < RELEASE_TTL_MS) return cached.info;
    inflight ??= (async () => {
      try {
        const r = await fetchImpl(`${cfg.releasesApi}/repos/${cfg.releasesRepo}/releases/latest`, {
          headers: { accept: 'application/vnd.github+json', 'user-agent': 'cursebound-cloud' },
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) throw new Error(`releases lookup ${r.status}`);
        const j = (await r.json()) as { tag_name?: string; published_at?: string; assets?: { name: string; size: number; browser_download_url: string }[] };
        const a = (j.assets ?? []).find((x) => INSTALLER_RE.test(x.name));
        const info = a ? { version: String(j.tag_name ?? '').replace(/^v/, ''), name: a.name, size: a.size, url: a.browser_download_url, publishedAt: String(j.published_at ?? '') } : null;
        cached = { at: Date.now(), info };
        return info;
      } catch (err) {
        log.warn('site_release_lookup_failed', { err: err as Error });
        // keep serving the last known build while the lookup is failing
        if (cached) { cached.at = Date.now() - RELEASE_TTL_MS + 30_000; return cached.info; }
        return null;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  async function download(req: IncomingMessage, res: ServerResponse, requestId: string) {
    const info = await latest();
    if (!info) return plain(res, 503, 'The download is briefly unavailable. Please try again in a minute.', requestId);
    const abort = new AbortController();
    req.on('close', () => { if (!res.writableEnded) abort.abort(); });
    let up: Response;
    try {
      up = await fetchImpl(info.url, { redirect: 'follow', signal: abort.signal, headers: { 'user-agent': 'cursebound-cloud', accept: 'application/octet-stream' } });
    } catch (err) {
      log.warn('site_download_upstream_failed', { requestId, err: err as Error });
      return plain(res, 502, 'The download could not be started. Please try again.', requestId);
    }
    if (!up.ok || !up.body) {
      log.warn('site_download_upstream_status', { requestId, status: up.status });
      cached = null;
      return plain(res, 502, 'The download could not be started. Please try again.', requestId);
    }
    // no content-length: Cloud Run caps non-streamed responses at 32 MiB, while chunked (streamed) responses are
    // uncapped; the installer is ~100 MB. The browser shows progress without a total.
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${info.name}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-request-id': requestId,
    });
    if (req.method === 'HEAD') { abort.abort(); res.end(); return; }
    log.info('site_download', { requestId, version: info.version });
    const body = Readable.fromWeb(up.body as unknown as WebReadableStream<Uint8Array>);
    body.on('error', () => res.destroy());
    body.pipe(res);
  }

  return {
    handles: (p) => p === '/' || p === '/download' || p === '/favicon.ico' || p === '/site-logo.js',
    async serve(req, res, path, requestId) {
      if (path === '/site-logo.js') {
        let js: string;
        try { js = await logoScript(); } catch (err) { log.error('site_logo_build_failed', { err: err as Error }); return plain(res, 500, '', requestId); }
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', 'x-request-id': requestId });
        res.end(req.method === 'HEAD' ? undefined : js);
        return;
      }
      if (path === '/favicon.ico') { res.writeHead(204, { 'cache-control': 'public, max-age=86400' }); res.end(); return; }
      if (path === '/download') return download(req, res, requestId);
      const info = await latest();
      const nonce = crypto.randomBytes(16).toString('base64');
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-cache',
        'content-security-policy': [
          "default-src 'none'", `script-src 'self' 'nonce-${nonce}'`, `style-src 'nonce-${nonce}' https://fonts.googleapis.com`,
          'font-src https://fonts.gstatic.com', "img-src 'self' data:", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
        ].join('; '),
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'x-frame-options': 'DENY',
        'strict-transport-security': 'max-age=31536000; includeSubDomains',
        'x-request-id': requestId,
      });
      res.end(req.method === 'HEAD' ? undefined : landingPage(info, nonce, LOGO_VERSION));
    },
  };
}

function plain(res: ServerResponse, status: number, text: string, requestId: string) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-request-id': requestId });
  res.end(text);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The landing page: one self-contained document (inline styles and script under a per-request nonce). */
export function landingPage(info: InstallerInfo | null, nonce: string, logoVersion = '1'): string {
  const meta = info ? `v${esc(info.version)} · ${Math.round(info.size / 1048576)} MB · Windows 10/11` : 'Windows 10/11';
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CURSEBOUND</title>
<meta name="description" content="An endless cooperative roguelike. Descend with up to five friends; every Fate compounds.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link nonce="${nonce}" rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@900&family=Jersey+10&family=Jersey+20&display=swap">
<style nonce="${nonce}">
:root { --ink:#050404; --bone:#e9e2d0; --bone2:#b9b09c; --gold:#e8c46a; --gold-hi:#fff0b8; --blood:#7a0b14; --blood-hi:#c81e24; --ice:#bfeef8; --night:#0c1028; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--ink); color: var(--bone); }
body { min-height: 100vh; font-family: 'Jersey 20', ui-monospace, monospace; font-size: 24px; line-height: 1.25; overflow-x: hidden; }
canvas#sky { position: fixed; inset: 0; width: 100vw; height: 100vh; image-rendering: pixelated; z-index: 0; }
main { position: relative; z-index: 1; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px 16px; text-align: center; gap: 28px; }
h1 { margin: 0; line-height: 0; }
#wordmark-canvas { image-rendering: pixelated; display: block; max-width: 100%; }
#wordmark .fallback { font-family: 'Cinzel', serif; font-weight: 900; font-size: clamp(48px, 10vw, 120px); line-height: 1; color: #dfe9f7; text-shadow: 4px 4px 0 var(--night), 8px 8px 0 #2a3f86; }
#wordmark[data-ready="true"] .fallback { display: none; }
#wordmark:not([data-ready="true"]) #wordmark-canvas { position: absolute; visibility: hidden; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.tag { font-family: 'Jersey 10', monospace; font-size: 28px; text-transform: uppercase; color: var(--ice); text-shadow: 2px 2px 0 var(--night); display: flex; gap: 16px; align-items: center; }
.tag::before, .tag::after { content: ''; width: 56px; height: 4px; background: var(--gold); box-shadow: 0 4px 0 #6b4a14; }
.pitch { max-width: 640px; margin: 0; color: var(--bone2); text-shadow: 2px 2px 0 #000; }
.dl { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; padding: 14px 40px 12px; text-decoration: none; cursor: pointer;
  font-family: 'Jersey 10', monospace; font-size: 40px; line-height: 1; color: var(--gold-hi); background: var(--blood); text-shadow: 3px 3px 0 #2a0204;
  box-shadow: 0 0 0 4px #1a0204, 0 0 0 8px var(--gold), 0 0 0 12px #1a0204, 8px 8px 0 12px rgba(0,0,0,.6); image-rendering: pixelated; margin: 12px; }
.dl small { font-family: 'Jersey 20', monospace; font-size: 20px; color: var(--bone); text-shadow: 2px 2px 0 #2a0204; }
.dl:hover, .dl:focus-visible { background: var(--blood-hi); color: #fff; outline: none; }
.dl:active { transform: translateY(3px); box-shadow: 0 0 0 4px #1a0204, 0 0 0 8px var(--gold), 0 0 0 12px #1a0204; }
.note { max-width: 640px; margin: 0; font-size: 19px; color: #8d8574; }
.note kbd { font-family: inherit; color: var(--bone); background: #241b15; padding: 0 6px; box-shadow: 0 2px 0 #000; }
@media (prefers-reduced-motion: reduce) { canvas#sky { display: none; } }
</style></head>
<body>
<canvas id="sky" aria-hidden="true"></canvas>
<main>
  <h1 id="wordmark"><span class="sr-only">CURSEBOUND</span><canvas id="wordmark-canvas" aria-hidden="true"></canvas><span class="fallback" aria-hidden="true">CURSEBOUND</span></h1>
  <div class="tag">A cooperative descent · every fate compounds</div>
  <p class="pitch">An endless roguelike for up to five. After every round your party walks through one of three doors and binds itself to a Fate: a gift and a curse that never leave. Every choice multiplies.</p>
  <a class="dl" href="/download" download>Download for Windows<small>${meta}</small></a>
  <p class="note">Windows may show a SmartScreen notice because the game isn't code-signed yet: choose <kbd>More info</kbd> then <kbd>Run anyway</kbd>.</p>
</main>
<script src="/site-logo.js?v=${logoVersion}" defer></script>
<script nonce="${nonce}">
(() => {
  // pixel sky: a breathing dithered halo behind the title and spirit motes rising, drawn at 1/4 resolution
  const PX = 4, cv = document.getElementById('sky'), g = cv.getContext('2d');
  if (!g || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const B = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
  const dith = (x, y, t) => (B[(y & 3) * 4 + (x & 3)] + 0.5) / 16 < t;
  const BANDS = ['#0b0820', '#130f36', '#181f4e', '#1d3466', '#2a5684'];
  const MOTE = ['#f4feff', '#bff4fc', '#7ad8ee', '#4a9ad4', '#4c5cb4', '#3a2c7a'];
  let W, H, motes = [];
  const size = () => { W = Math.ceil(innerWidth / PX); H = Math.ceil(innerHeight / PX); cv.width = W; cv.height = H; };
  size(); addEventListener('resize', size);
  const spawn = (any) => { const max = 220 + Math.random() * 260; return { x: Math.random() * W, y: any ? Math.random() * H : H * (0.5 + Math.random() * 0.5), vy: -(0.05 + Math.random() * 0.12), life: any ? Math.random() * max : 0, max, ph: Math.random() * 100 }; };
  for (let i = 0; i < (W * H) / 700; i++) motes.push(spawn(true));
  let t = 0;
  const frame = () => {
    t++;
    g.fillStyle = '#050404'; g.fillRect(0, 0, W, H);
    const title = document.querySelector('h1').getBoundingClientRect();
    const cx = (title.left + title.width / 2) / PX, cy = (title.top + title.height / 2) / PX;
    const rx = (title.width / PX) * 0.6, ry = (title.height / PX) * 0.7, br = 1 + Math.sin(t / 90) * 0.06;
    for (let y = Math.max(0, Math.floor(cy - ry * br)); y < Math.min(H, cy + ry * br); y++) for (let x = Math.max(0, Math.floor(cx - rx * br)); x < Math.min(W, cx + rx * br); x++) {
      const dx = (x + 0.5 - cx) / (rx * br), dy = (y + 0.5 - cy) / (ry * br), d = Math.sqrt(dx * dx + dy * dy);
      if (d >= 1) continue;
      const v = (1 - d) * BANDS.length, i = Math.floor(v), band = Math.min(BANDS.length - 1, i + (dith(x, y, v - i) ? 1 : 0));
      if (band <= 0 && !dith(x, y, (v - i) * 0.6)) continue;
      g.fillStyle = BANDS[Math.max(0, band - 1)]; g.fillRect(x, y, 1, 1);
    }
    const want = Math.round((W * H) / 700);
    while (motes.length < want) motes.push(spawn(false));
    for (let i = motes.length - 1; i >= 0; i--) {
      const m = motes[i]; m.life++; m.y += m.vy; m.x += Math.sin((m.life + m.ph) / 40) * 0.12;
      if (m.life > m.max || m.y < -2) { if (motes.length > want) motes.splice(i, 1); else motes[i] = spawn(false); continue; }
      if (Math.sin((m.life + m.ph) / 11) < -0.75) continue;
      g.fillStyle = MOTE[Math.min(MOTE.length - 1, Math.floor((m.life / m.max) * MOTE.length))]; g.fillRect(Math.round(m.x), Math.round(m.y), 1, 1);
    }
    setTimeout(() => requestAnimationFrame(frame), 33);
  };
  frame();
})();
</script>
</body></html>`;
}
