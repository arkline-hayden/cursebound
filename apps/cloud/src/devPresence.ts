import http from 'node:http';
import { attachPresence, type PresenceIdentity } from './presence';

// DEV ONLY: the presence/signaling hub standalone with fake auth, so two browser tabs on one machine can run the
// real WebRTC co-op flow without the cloud. Tokens are `dev:<accountId>:<displayName>`; every dev account is
// friends with every other dev account seen by this process. Also serves `GET /api/v1/turn` (no ICE servers:
// host candidates only, nothing leaves the machine) and `GET /healthz`.
// Refuses to start when NODE_ENV=production or without the explicit flag (`--dev` or CURSEBOUND_DEV_PRESENCE=1).
//
//   npm run dev:presence -w @cursebound/cloud      (CURSEBOUND_PRESENCE_HOST / CURSEBOUND_PRESENCE_PORT, default 127.0.0.1:8788)
//
// For the full two-tab demo (hub + authority + client wired together) run `node scripts/p2p-demo.mjs`; its header
// has the steps.

const devFlag = process.argv.includes('--dev') || process.env.CURSEBOUND_DEV_PRESENCE === '1';
if (process.env.NODE_ENV === 'production' || !devFlag) {
  console.error('[dev-presence] refusing to start: dev presence needs NODE_ENV != production and --dev (or CURSEBOUND_DEV_PRESENCE=1)');
  process.exit(1);
}

const host = process.env.CURSEBOUND_PRESENCE_HOST ?? '127.0.0.1';
const port = Number(process.env.CURSEBOUND_PRESENCE_PORT ?? 8788);
const TOKEN_RE = /^dev:([A-Za-z0-9_-]{1,40}):(.{1,24})$/;

const known = new Map<string, PresenceIdentity>();
let notify: ((accountId: string) => void) | null = null;

const log = {
  info: (msg: string, f?: Record<string, unknown>) => console.log(`[dev-presence] ${msg}`, f ?? ''),
  warn: (msg: string, f?: Record<string, unknown>) => console.warn(`[dev-presence] ${msg}`, f ?? ''),
  error: (msg: string, f?: Record<string, unknown>) => console.error(`[dev-presence] ${msg}`, f ?? ''),
};

const server = http.createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0];
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type' };
  if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return; }
  if (req.method === 'GET' && path === '/api/v1/turn') { res.writeHead(200, headers); res.end(JSON.stringify({ iceServers: [], ttl: 21600 })); return; }
  if (req.method === 'GET' && path === '/healthz') { res.writeHead(200, headers); res.end(JSON.stringify({ ok: true, build: 'dev-presence', minClientBuild: null, connections: presence.connections() })); return; }
  res.writeHead(404, headers);
  res.end(JSON.stringify({ requestId: 'dev', error: { code: 'NOT_FOUND', message: 'dev presence serves only /api/v1/presence, /api/v1/turn and /healthz' } }));
});

const presence = attachPresence(server, {
  async authenticate(token) {
    const m = TOKEN_RE.exec(token);
    if (!m) return null;
    const who: PresenceIdentity = { accountId: m[1], username: m[1], displayName: m[2], favoriteClass: null };
    const fresh = !known.has(who.accountId);
    known.set(who.accountId, who);
    // a new dev account befriends everyone: refresh the others' friend lists
    if (fresh) setTimeout(() => { for (const id of known.keys()) if (id !== who.accountId) notify?.(id); }, 0);
    return who;
  },
  async friendIds(accountId) { return [...known.keys()].filter((id) => id !== accountId); },
  async identities(ids) { return ids.map((id) => known.get(id)).filter((w): w is PresenceIdentity => !!w); },
  onFriendsChanged(subscribe) { notify = subscribe; },
  log,
});

server.listen(port, host, () => {
  console.log(`[dev-presence] listening on http://${host}:${port}  (ws path /api/v1/presence, tokens "dev:<accountId>:<name>")`);
});

const stop = () => { void presence.close().then(() => server.close(() => process.exit(0))); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
if (process.platform === 'win32') process.on('SIGBREAK', stop);
