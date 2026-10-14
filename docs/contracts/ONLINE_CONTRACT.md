# Online contract: cloud accounts, presence, peer-to-peer co-op, desktop app

Goal: friends install a desktop app, see which friends are online and joinable, and click **Join**. No ports, VPNs or
setup. Cheap: the cloud never carries gameplay except relayed (TURN) connections.

```
 ┌──────────── Desktop app (Electron) ─────────────┐        ┌────────── GCP ──────────┐
 │ renderer (static Next export)                   │ HTTPS  │ Cloud Run: apps/cloud    │
 │   ├─ accounts/friends/builds/boards ────────────┼───────►│  accounts, friends,      │
 │   ├─ presence + signaling (WebSocket) ──────────┼───────►│  builds, run summaries,  │
 │   └─ WebRTC data channel ◄──── peer ────► other │        │  boards, presence,       │
 │        players' apps (STUN direct, else TURN)   │        │  signaling, TURN creds   │
 │ local authority (apps/server, utilityProcess)   │        │ Cloud SQL Postgres       │
 │   rooms, simulation, runs, replays (SQLite)     │        │ coturn VM (TURN relay)   │
 └─────────────────────────────────────────────────┘        └──────────────────────────┘
```

Two account modes, chosen at runtime by `cloudUrl` (see Runtime config):
- **Online** (`cloudUrl` set): auth, account, builds, friends, players, social boards go to the cloud with
  `Authorization: Bearer <token>`.
- **Local** (`cloudUrl` null, e.g. plain `npm start` web dev): the existing local accounts (cookie) keep working unchanged.

The simulation stays local to the host in both modes. Runs, checkpoints and replays live in the host's SQLite.

## Runtime config (`apps/client/src/lib/runtime.ts`, local server `GET /api/v1/config`)
`GET /api/v1/config` → `{ cloudUrl: string | null, roomWsUrl: string | null, build: string, desktop: boolean }`.
- `cloudUrl` comes from env `CURSEBOUND_CLOUD_URL` (no trailing slash) on the local server.
- `roomWsUrl` is null unless overridden. Clients derive the room socket URL: same origin as the page when the page is
  served by the authority (desktop, `desktop: true`), else `ws://<host>:<NEXT_PUBLIC_ROOM_PORT>/rooms` (web dev).
- Client code must call `runtimeConfig()` (cached) / `roomWsUrl()` / `cloudUrl()` from `lib/runtime.ts`. Never hard-code
  ports or hosts elsewhere.

## Cloud HTTP API (`apps/cloud`, base `${cloudUrl}/api/v1`)
Same route shapes and JSON as the local server's account API (`apps/server/src/accountRoutes.ts`), so the client only
switches base URL and auth header:
`POST /auth/register|login|logout|password`, `GET /auth/me|sessions`, `POST /auth/sessions/revoke-others`,
`PUT /account`, `POST /account/delete`, `GET /account/stats|runs`, `GET /players/:username`,
`GET|POST /builds`, `PUT|DELETE /builds/:id`, `POST /builds/from-run`, `GET|POST /friends`,
`POST /friends/:id/accept|decline`, `DELETE /friends/:id`.
Differences in online mode:
- register/login respond `{ account, token }`. Clients send `Authorization: Bearer <token>`; no cookies. Tokens are
  32 random bytes, base64url, stored server-side as SHA-256 only, 30-day sliding expiry (as the local sessions).
- `claimProfileId` is ignored (local profiles are linked, not claimed. See Local profile linking).
- `/builds/from-run` takes the summary in the body: `{ name?, summary: { runId, round, players: [{ slot, classId, ranks, mastery? , accountId? }] } }`
  and saves the caller's player (matched by `accountId`, else the only player).
- Run summaries: `POST /runs` `{ runId, boardKey, scoreText, depth, activeTicks, mode, n, challengeId, practice,
  participants: [{ accountId|null, name, classId }], summary }`. Accepted from any signed-in participant;
  idempotent on `(hostAccountId, runId)`. Trust is always `client-reported`. `GET /account/stats|runs` aggregate these.
- Boards: `GET /boards?key=&scope=all|friends|mine&limit=&cursor=` and `GET /boards/keys` with the local server's response shape
  (rows include `accounts: string[]` usernames).
- `GET /turn` → `{ iceServers: RTCIceServer[], ttl }`: Google STUN plus, when configured, our coturn with time-limited
  credentials (coturn `use-auth-secret`): `username = "<unixExpiry>:<accountId>"`,
  `credential = base64(HMAC-SHA1(TURN_SECRET, username))`, ttl 6 h.
- `GET /healthz` → `{ ok, build, minClientBuild }`.
Errors: `{ requestId, error: { code, message } }`, same codes as local.

## Presence and signaling (WebSocket `${cloudUrl → ws(s)}/api/v1/presence`)
First client message MUST be `{t:'auth', token}` within 10 s, or the socket closes. The token never goes in the URL.
Client → cloud:
- `{t:'status', state:'menu'|'lobby'|'run'|'away', build, joinable, roomCode?, mode?, seats?, maxSeats?, round?, theme?}`
- `{t:'invite', to: accountId}` (friends only)
- `{t:'resolve', code}` → reply `{t:'resolved', code, host: {accountId, username, displayName} | null}` (any signed-in user; only matches a host currently advertising that code with `joinable: true`)
- `{t:'signal', to: accountId, session: string, data: {kind:'offer'|'answer'|'ice'|'bye', sdp?, candidate?}}`
  Allowed between friends, or toward a host whose code the sender resolved in the last 10 min (and the host's replies back).
- `{t:'ping'}`
Cloud → client:
- `{t:'ready', you: {accountId, username, displayName}}`
- `{t:'friends', list: [{accountId, username, displayName, favoriteClass, online, status|null}]}` on connect and on friend-list change
- `{t:'presence', accountId, online, status|null}` when a friend changes
- `{t:'invite', from: {accountId, username, displayName}, roomCode}`
- `{t:'signal', from: {accountId, username, displayName}, session, data}`, where `from` is verified by the cloud
- `{t:'error', code, message}`, `{t:'pong'}`
Liveness: clients ping every 20 s; the server drops a socket after 45 s silent and broadcasts offline. Cloud Run closes
WebSockets after ≤60 min, so clients reconnect with jittered backoff (1→30 s) and re-send `auth` + last `status`.
Scale note: presence is in-memory, so the Cloud Run service runs with `max-instances=1` (enough for thousands of
sockets). The scale-out path is Postgres LISTEN/NOTIFY fan-out, not needed now.
Module boundary: `apps/cloud/src/presence.ts` exports
`attachPresence(server: http.Server, deps: { authenticate(token): Promise<{accountId, username, displayName, favoriteClass} | null>; friendIds(accountId): Promise<string[]>; onFriendsChanged?: (subscribe: (accountId: string) => void) => void; log })`.

## Peer-to-peer co-op (WebRTC, `apps/client/src/lib/p2p/`)
Host = the player whose local authority runs the room. Guests connect to it over one RTCDataChannel (`label 'cb'`, ordered, reliable).
1. The guest gets ICE servers from `GET /turn`, creates the RTCPeerConnection and channel, and sends an offer via `signal`
   (`session` = random id). Trickle ICE.
2. The host's **bridge** (a module singleton in the host's renderer that survives client-side route changes) answers.
3. The channel opens and the guest sends `{rpc:'join', classId}`. The host bridge:
   a. links a local profile for the guest's **cloud-verified** accountId (from the signal's `from`):
      `POST /api/v1/local/profiles/link {accountId, displayName}` → `{id, displayName}`;
   b. `POST /api/v1/rooms/:code/join {profileId, classId}` → seat;
   c. opens `WebSocket(roomWsUrl())` to its own authority for this guest;
   d. replies `{rpc:'joined', roomId, seatToken, slot, code}`, then pipes channel ⇄ socket verbatim (game protocol unchanged;
      the guest sends `HELLO` with its seat token itself).
   Errors reply `{rpc:'error', code, message}`.
4. Guest `GameConnection` uses a transport interface (`send`, `onmessage`, `close`, `readyState`) with WebSocket and
   DataChannel implementations. Reconnect re-signals and reuses the stored seat token.
Joinable = host status `joinable` (coop room in LOBBY or RUN with an open seat) **and** equal `build`; otherwise the UI shows
"Update to join" / "Full" / "Solo run".

## Local profile linking (local server)
Migration v3: `profiles.cloud_account_id TEXT NULL UNIQUE`. `POST /api/v1/local/profiles/link {accountId, displayName}`
returns the profile linked to that cloud account, creating it if absent and updating its display name. Online mode: the client calls it
for itself after sign-in and plays as that profile. The host bridge calls it for each guest.

## Desktop app (`apps/desktop`)
- Electron main starts the local authority bundle in a `utilityProcess` with `CURSEBOUND_PORT=0` (random free port, reported
  back on stdout as JSON `{"event":"listening","port":N}`), `CURSEBOUND_DATA_DIR=<userData>/data`,
  `CURSEBOUND_STATIC_DIR=<resources>/client`, `CURSEBOUND_CLOUD_URL` (baked at build from env), and allows origin
  `http://127.0.0.1:N`. The window loads `http://127.0.0.1:N/`.
- The local server serves the static export (when `CURSEBOUND_STATIC_DIR` is set) with the same security headers/CSP as
  next.config, plus `connect-src` for the cloud origin, its `wss:` URL and STUN/TURN. SPA fallback per exported route (`/play/` etc.).
- Fonts are bundled (`@fontsource/*`), with no Google Fonts requests in the desktop build.
- Preload exposes `window.cursebound = { desktop: true, version, secureStore: {get,set,del}, updates: {onReady(cb), install()} }`.
  Online-mode bearer tokens use `secureStore` (Electron `safeStorage`) when present, else `localStorage`.
- electron-builder: Windows NSIS, macOS dmg (unsigned until a cert exists), Linux AppImage. `electron-updater` with the GitHub
  provider `arkline-hayden/cursebound`. The app checks on launch and every 30 min, downloads in the background, and offers
  "Restart to update".

## Environments and names (defaults; override in infra/gcp/env.sh)
GCP region `us-central1`; Cloud Run service `cursebound-cloud`; Artifact Registry repo `cursebound`; Cloud SQL instance
`cursebound-pg` (Postgres 16, db-f1-micro), database `cursebound`; secrets `cb-database-url`, `cb-turn-secret`; coturn VM
`cursebound-turn` (e2-micro, static IP, UDP/TCP 3478 + 49160-49200). GitHub → GCP deploys use Workload Identity Federation
(no keys).

## As built (deviations recorded at integration)
- **Desktop port:** the first launch uses `CURSEBOUND_PORT=0`; later launches request the remembered port and fall back to
  0 when it is taken, keeping the page origin stable (local profile ids and settings live in that origin's storage).
- **Desktop shutdown:** a `utilityProcess` has no stdin, so the desktop main process sends `shutdown` as a process
  message; the server handles both forms.
- **Joinable = lobby only:** the authority locks the roster when a run starts, so hosts advertise coop rooms as joinable
  only in LOBBY (`MID_RUN_JOIN = false` in `lib/p2p/host.ts`). Flip it when the authority can seat players mid-run.
- **Cloud identity:** in the cloud an account is its own profile (`profileId == accountId`).
- **Public access:** Cloud Run runs with `--no-invoker-iam-check` (public without an `allUsers` IAM binding), because the
  Workspace organization's domain-restricted sharing forbids `allUsers`.
- **Presence deps** include optional `identities(ids)` so offline friends are listed by name.
