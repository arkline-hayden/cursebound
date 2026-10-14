import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/main';
import { loadSqlite } from '../src/persistence/sqlite';

// Online-mode profile linking (docs/contracts/ONLINE_CONTRACT.md "Local profile linking"): a cloud account plays as
// exactly one local profile, created on first link; the host bridge links guests the same way.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursebound-link-'));
const port = 26500 + Math.floor(Math.random() * 300);

async function call<T = any>(method: string, p: string, body?: unknown): Promise<{ status: number; body: T }> {
  const r = await fetch(`http://127.0.0.1:${port}/api/v1${p}`, {
    method, headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as T };
}

describe('local profile linking', () => {
  let srv: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    srv = await startServer({ ...process.env, CURSEBOUND_PORT: String(port), CURSEBOUND_DATA_DIR: dataDir });
    srv.rooms.stop();
  });
  afterAll(async () => { await srv?.shutdown(); });

  it('creates the linked profile once, keeps its id and follows the display name', async () => {
    const a = await call('POST', '/local/profiles/link', { accountId: 'acc_Cloud1', displayName: 'Ivy' });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ displayName: 'Ivy' });
    expect(typeof a.body.id).toBe('string');
    const again = await call('POST', '/local/profiles/link', { accountId: 'acc_Cloud1', displayName: '  Ivy the Bold ' });
    expect(again.body).toMatchObject({ id: a.body.id, displayName: 'Ivy the Bold' });
    expect((await call('GET', `/local/profiles/${a.body.id}`)).body).toMatchObject({ id: a.body.id, displayName: 'Ivy the Bold', account: null });
    const other = await call('POST', '/local/profiles/link', { accountId: 'acc_Cloud2', displayName: 'Ash' });
    expect(other.body.id).not.toBe(a.body.id);
  });

  it('validates the account id and defaults a missing name', async () => {
    expect((await call('POST', '/local/profiles/link', { accountId: '../etc', displayName: 'x' })).status).toBe(400);
    expect((await call('POST', '/local/profiles/link', { displayName: 'x' })).status).toBe(400);
    expect((await call('POST', '/local/profiles/link', { accountId: 'acc_NoName' })).body.displayName).toBe('Wanderer');
  });

  it('lets the linked profile open a room without a local session', async () => {
    const p = (await call('POST', '/local/profiles/link', { accountId: 'acc_Player', displayName: 'Runner' })).body;
    const room = await call('POST', '/rooms', { profileId: p.id, mode: 'coop', classId: 'vanguard' });
    expect(room.status).toBe(200);
    expect(room.body.seatToken).toBeTruthy();
  });

  it('stores the link in profiles.cloud_account_id (migration v3, unique)', async () => {
    const sqlite = await loadSqlite();
    const db = new sqlite.DatabaseSync(path.join(dataDir, 'cursebound.sqlite'), { readOnly: true });
    const rows = db.prepare('SELECT cloud_account_id FROM profiles WHERE cloud_account_id IS NOT NULL ORDER BY cloud_account_id').all() as { cloud_account_id: string }[];
    expect(rows.map((r) => r.cloud_account_id)).toEqual(['acc_Cloud1', 'acc_Cloud2', 'acc_NoName', 'acc_Player']);
    const idx = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'profiles_cloud_account_idx'").get() as { sql: string };
    expect(idx.sql).toMatch(/UNIQUE INDEX/);
    db.close();
  });
});
