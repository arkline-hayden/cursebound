# Releasing the CURSEBOUND desktop app

The desktop app (`apps/desktop`) is an Electron shell around the local authority and the static client. Friends
install it once. After that, updates arrive by themselves from this repository's GitHub Releases. There is no Steam or
store. Spec: `docs/contracts/ONLINE_CONTRACT.md` ("Desktop app").

## How the app is put together

```
CURSEBOUND.exe (Electron main, dist/main.cjs)
 ├─ utilityProcess: resources/server/server.mjs   local authority (apps/server bundled with esbuild)
 │    ├─ worker thread: worker-entry.mjs → worker.js   the isolated SQLite writer (node:sqlite)
 │    └─ serves resources/client (the static Next export) + /api/v1 + /rooms on http://127.0.0.1:<port>
 └─ BrowserWindow → http://127.0.0.1:<port>/  (sandboxed renderer, preload exposes window.cursebound)
```

- **Port.** The first launch asks for a random free port (`CURSEBOUND_PORT=0`). The authority reports it as one JSON
  line on stdout (`{"event":"listening","port":N}`) and the shell remembers it in `authority-port.json`. Later launches
  ask for the same port again and pick a fresh one only if it is taken. The page origin includes the port, and
  localStorage (local profile ids, settings) belongs to that origin, so a stable port keeps a player's local data.
- **Data.** Everything lives in the per-user app data folder (`%APPDATA%\CURSEBOUND` on Windows,
  `~/Library/Application Support/CURSEBOUND` on macOS, `~/.config/CURSEBOUND` on Linux):
  `data/` (SQLite, replays, backups, server logs), `logs/desktop.log` (shell, authority output, renderer warnings),
  `secure-store.json` (the online-mode token, encrypted with the OS keychain via `safeStorage`), `window-state.json`.
  Uninstalling keeps this folder.
- **Cloud.** `CLOUD_URL` is baked into the main process at build time and passed to the authority as
  `CURSEBOUND_CLOUD_URL`. Empty means local accounts only. The release workflow reads the repository variable
  `vars.CLOUD_URL` (Settings → Secrets and variables → Actions → Variables).
- **Lifecycle.** One instance at a time (a second launch focuses the first). Closing the window sends the authority
  `shutdown` (over the utilityProcess message port) and waits for it to flush pending saves. If the authority crashes,
  the shell restarts it and reloads the page. It gives up after 5 crashes in 2 minutes.

## Building locally

| Command | What it does |
| --- | --- |
| `npm run desktop:build` | Static client export → bundles → icon → electron-builder for the current OS. Output: `apps/desktop/release/` (installer, `latest*.yml`, and the unpacked app in `win-unpacked/`, `mac*/` or `linux-unpacked/`). |
| `npm run desktop:build -- --dir` | Unpacked app only (faster; no installer, no update feed). |
| `npm run desktop:dev` | Same build steps (reusing an existing client export unless `--fresh`), then runs Electron on the unpackaged app. Update checks are off; `CURSEBOUND_FAKE_UPDATE=0.9.9` shows the update toast. |
| `npm run client:static` | Just the static client export (`apps/client/out`). |

Useful environment variables for the shell: `CLOUD_URL` (build time), `CURSEBOUND_USER_DATA=<dir>` (use a separate
profile, for example for testing), `CURSEBOUND_LOG_RENDERER=1` (log every renderer console line, not only warnings),
`CURSEBOUND_NO_UPDATES=1` (packaged build without update checks).

The packaged app ships no `node_modules`: the authority, the persistence worker, the main process (including
`electron-updater`) and the preload are esbuild bundles. Electron 44 bundles Node 24, which has `node:sqlite`.

## Releases

`.github/workflows/release.yml` makes every release the same way: typecheck and tests first (a red build never
ships), then a draft GitHub Release, then Windows, macOS and Linux builds in parallel that upload their installers and
update feeds into the draft, and finally it publishes the release once all three succeed. If anything fails, the
release stays a draft and nothing reaches players. Release notes list the commits since the previous release tag.
Releases run one at a time in push order (concurrency group `desktop-release`). When several pushes land while a
release is building, the newest one waits and the older waiting ones are skipped.

### Automatic releases from `main` (the normal path)

Every push to `main` that touches what the app ships (`apps/client`, `apps/server`, `apps/desktop`, `packages`,
`package.json`, `package-lock.json` or the workflow itself) releases automatically. The version is
`<major>.<minor>` from `apps/desktop/package.json` plus the workflow run number as the patch, for example `0.1.57`, so
each release is strictly newer than the last and installed apps update to it. The tag `v0.1.57` is created on that
commit when the release is published. Pushes that only touch docs, infra or the cloud service do not release.
You can also start a release by hand: Actions → Release → **Run workflow** (on a branch it gets an automatic version).

### Named versions (manual tags)

For a milestone, bump `major.minor` and tag it:

1. `npm version 0.2.0 --no-git-tag-version -w apps/desktop`, commit, push to `main`. (That push releases `0.2.<run>`
   automatically. Skip the tag if that is enough.)
2. To release exactly `0.2.0` instead: `git tag v0.2.0 && git push origin v0.2.0`. The tag is the version; path
   filters do not apply to tags.
3. Tags with a suffix (`v0.3.0-beta.1`) become pre-releases.

Keep the tags ordered: a manual tag must be newer than the latest automatic release, or installed apps skip it.
For example, after `0.1.57` shipped, tag `v0.2.0`, not `v0.1.5`. After a manual `v0.2.0`, raise `package.json` to
`0.2.x` or higher so later automatic releases (`0.2.<run>`) are newer again. Never re-use a version number: installed
apps compare versions and ignore a re-uploaded file with the same version.

## How friends install

Send them the release page: `https://github.com/arkline-hayden/cursebound/releases/latest`.

- **Windows:** download `CURSEBOUND-Setup-<version>.exe` and run it. It installs per user (no admin prompt) and opens
  the game. The build is unsigned, so Windows SmartScreen shows "Windows protected your PC". Click **More info** →
  **Run anyway**. This happens once per download.
- **macOS:** download the `.dmg` for your Mac (`arm64` for Apple silicon, `x64` for Intel) and drag CURSEBOUND to
  Applications. The app is unsigned, so the first launch needs right-click → **Open** → **Open** (or System Settings →
  Privacy & Security → **Open Anyway**). If macOS says the app "is damaged", run
  `xattr -cr /Applications/CURSEBOUND.app` in Terminal once (that clears the download quarantine flag).
- **Linux:** download the `.AppImage`, `chmod +x` it, and run it.

## How updates arrive

- The app checks GitHub Releases on launch and every 30 minutes, and downloads a newer version in the background.
  On Windows only the changed blocks are downloaded (differential update via the `.blockmap` files).
- The launch check runs before the title menu loads. It waits at most 4 seconds, so an offline launch is not held up.
  A newer build starts downloading right away, and the toast appears as soon as the download is ready.
- When the download finishes, a toast offers **Restart to update**. Choosing **Later** installs it the next time the
  game is closed.
- Co-op needs the same build on both sides (the join button shows "Update to join" otherwise), so everyone should
  restart when the toast appears.
- **macOS:** auto-update only works for a signed and notarized app (Squirrel.Mac verifies the code signature). Until
  there is an Apple Developer ID, mac players download each new dmg by hand. To enable it: get a Developer ID
  Application certificate, add `CSC_LINK`/`CSC_KEY_PASSWORD` and `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/
  `APPLE_TEAM_ID` secrets, remove `identity: null` from `apps/desktop/electron-builder.yml`, and set `notarize: true`
  under `mac`.
- **Repository visibility:** the GitHub update provider reads public releases without a token. If this repository is
  private, installed apps cannot see releases (the check fails with 404, logged in `desktop.log`). Either make the
  repository public, or publish releases to a separate public repository: change `publish.owner`/`publish.repo` in
  `electron-builder.yml` and give the workflow a token with write access to that repository.
- Code signing on Windows (removes the SmartScreen warning) needs a code signing certificate: set `CSC_LINK` and
  `CSC_KEY_PASSWORD` secrets. electron-builder signs automatically when they are present.

## Troubleshooting

- Ask for `logs/desktop.log` from the app data folder. It has the authority's output, update checks and renderer
  errors (CSP violations, failed loads).
- "The game server could not start": usually a broken data folder or antivirus blocking the app. The log says which.
  The database is in `data/`, and `npm run db:backup`/`db:restore` (with `CURSEBOUND_DATA_DIR` pointed at it) work on
  it from a dev checkout.
