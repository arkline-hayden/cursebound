import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/main';
import { hashPassword, passwordProblem, verifyPassword } from '../src/auth';

// Accounts over real HTTP + SQLite: registration, sessions (cookie), lockout, profile ownership, saved builds,
// friends and friend-scoped boards.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursebound-auth-'));
const port = 26100 + Math.floor(Math.random() * 300);

/** Minimal cookie-jar client: one per simulated browser. */
class Browser {
  cookie = '';
  async call<T = any>(method: string, p: string, body?: unknown): Promise<{ status: number; body: T }> {
    const headers: Record<string, string> = { 'content-type': 'application/json', origin: 'http://localhost:3000' };
    if (this.cookie) headers.cookie = this.cookie;
    const r = await fetch(`http://127.0.0.1:${port}/api/v1${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie');
    if (set) {
      const v = /cb_session=([^;]*)/.exec(set)?.[1] ?? '';
      this.cookie = v ? `cb_session=${v}` : '';
    }
    return { status: r.status, body: (await r.json()) as T };
  }
  async ok<T = any>(method: string, p: string, body?: unknown): Promise<T> {
    const r = await this.call<T>(method, p, body);
    if (r.status !== 200) throw new Error(`${method} ${p} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
}

describe('password hashing', () => {
  it('round-trips scrypt hashes with unique salts and rejects wrong passwords', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('correct horse batter', a)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
  it('enforces a basic password policy', () => {
    expect(passwordProblem('short', 'ivy')).toMatch(/at least/);
    expect(passwordProblem('ivy_the_bold', 'Ivy_The_Bold')).toMatch(/differ/);
    expect(passwordProblem('password123', 'ivy')).toMatch(/common/);
    expect(passwordProblem('aaaaaaaaaa', 'ivy')).toMatch(/repeated/);
    expect(passwordProblem('a lantern in the deep', 'ivy')).toBeNull();
  });
});

describe('accounts over HTTP', () => {
  let srv: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    srv = await startServer({ ...process.env, CURSEBOUND_PORT: String(port), CURSEBOUND_DATA_DIR: dataDir, CURSEBOUND_REGISTER_PER_HOUR: '1000' });
    srv.rooms.stop();
  });
  afterAll(async () => { await srv?.shutdown(); });

  it('registers (claiming the local profile), keeps a session, signs out and back in', async () => {
    const b = new Browser();
    const guest = await b.ok('POST', '/local/profiles', { displayName: 'Ivy' });
    const reg = await b.ok('POST', '/auth/register', { username: 'Ivy_Bold', password: 'lantern-in-the-deep', claimProfileId: guest.id, displayName: 'Ivy the Bold' });
    expect(reg.account).toMatchObject({ username: 'Ivy_Bold', profileId: guest.id, displayName: 'Ivy the Bold' });
    expect(reg.account.passwordHash).toBeUndefined();
    expect(b.cookie).toMatch(/^cb_session=/);
    expect((await b.ok('GET', '/auth/me')).account.username).toBe('Ivy_Bold');
    expect((await b.ok('GET', `/local/profiles/${guest.id}`)).account).toBe('Ivy_Bold');

    // usernames are unique case-insensitively
    const dup = await new Browser().call('POST', '/auth/register', { username: 'ivy_bold', password: 'another-long-one' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('USERNAME_TAKEN');

    await b.ok('POST', '/auth/logout');
    expect(b.cookie).toBe('');
    expect((await b.ok('GET', '/auth/me')).account).toBeNull();

    const bad = await b.call('POST', '/auth/login', { username: 'Ivy_Bold', password: 'wrong-password' });
    expect(bad.status).toBe(401);
    const unknown = await b.call('POST', '/auth/login', { username: 'Nobody_Here', password: 'wrong-password' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(bad.body.error.message); // no username enumeration

    await b.ok('POST', '/auth/login', { username: 'ivy_bold', password: 'lantern-in-the-deep' });
    expect((await b.ok('GET', '/auth/me')).account.username).toBe('Ivy_Bold');
  });

  it('rejects weak passwords and malformed usernames', async () => {
    const b = new Browser();
    expect((await b.call('POST', '/auth/register', { username: 'ok_name', password: 'short' })).body.error.code).toBe('WEAK_PASSWORD');
    expect((await b.call('POST', '/auth/register', { username: 'no spaces!', password: 'long-enough-pass' })).status).toBe(400);
    expect((await b.call('POST', '/auth/register', { username: 'ab', password: 'long-enough-pass' })).status).toBe(400);
  });

  it('locks an account after repeated failures', async () => {
    const owner = new Browser();
    await owner.ok('POST', '/auth/register', { username: 'Locksmith', password: 'iron-keys-and-bolts' });
    const attacker = new Browser();
    let last = 0;
    for (let i = 0; i < 9; i++) last = (await attacker.call('POST', '/auth/login', { username: 'Locksmith', password: `guess-${i}-xxxx` })).status;
    expect([423, 429]).toContain(last);
    // the right password is refused while locked
    const during = await new Browser().call('POST', '/auth/login', { username: 'Locksmith', password: 'iron-keys-and-bolts' });
    expect([423, 429]).toContain(during.status);
    // the existing session is unaffected
    expect((await owner.ok('GET', '/auth/me')).account.username).toBe('Locksmith');
  });

  it('only lets the owning account play, resume or configure a claimed profile', async () => {
    const owner = new Browser();
    const acc = (await owner.ok('POST', '/auth/register', { username: 'Warden_Ash', password: 'ashes-to-embers' })).account;
    const stranger = new Browser();
    const r = await stranger.call('POST', '/rooms', { profileId: acc.profileId, mode: 'solo', classId: 'vanguard' });
    expect(r.status).toBe(403);
    expect((await stranger.call('PUT', `/local/settings/${acc.profileId}`, { settings: { x: 1 } })).status).toBe(403);
    expect((await owner.ok('POST', '/rooms', { profileId: acc.profileId, mode: 'solo', classId: 'vanguard' })).seatToken).toBeTruthy();
    await owner.ok('PUT', `/local/settings/${acc.profileId}`, { settings: { x: 1 } });
    // unclaimed guest profiles stay usable without signing in
    const guest = await stranger.ok('POST', '/local/profiles', { displayName: 'Guest' });
    expect((await stranger.ok('POST', '/rooms', { profileId: guest.id, mode: 'solo', classId: 'vanguard' })).seatToken).toBeTruthy();
  });

  it('changes the password and revokes other sessions', async () => {
    const a = new Browser();
    await a.ok('POST', '/auth/register', { username: 'Two_Faces', password: 'first-secret-word' });
    const b = new Browser();
    await b.ok('POST', '/auth/login', { username: 'Two_Faces', password: 'first-secret-word' });
    expect((await a.ok('GET', '/auth/sessions')).sessions).toHaveLength(2);
    expect((await a.call('POST', '/auth/password', { current: 'nope-nope-nope', next: 'second-secret-word' })).status).toBe(401);
    await a.ok('POST', '/auth/password', { current: 'first-secret-word', next: 'second-secret-word' });
    expect((await b.ok('GET', '/auth/me')).account).toBeNull();
    expect((await a.ok('GET', '/auth/me')).account.username).toBe('Two_Faces');
    expect((await new Browser().call('POST', '/auth/login', { username: 'Two_Faces', password: 'first-secret-word' })).status).toBe(401);
  });

  it('saves, edits, validates and deletes builds per account', async () => {
    const a = new Browser();
    await a.ok('POST', '/auth/register', { username: 'Builder', password: 'stone-upon-stone' });
    expect((await new Browser().call('GET', '/builds')).status).toBe(401);
    const { NODES, CLASSES } = await import('@cursebound/content');
    const cls = CLASSES[0]!;
    const node = NODES.find((n) => n.classId === cls.id && !n.starting)!;
    const other = NODES.find((n) => n.classId !== cls.id)!;
    const saved = (await a.ok('POST', '/builds', { name: 'Glass cannon', classId: cls.id, ranks: { [node.id]: 1 }, notes: 'all in' })).build;
    expect(saved).toMatchObject({ name: 'Glass cannon', classId: cls.id, ranks: { [node.id]: 1 }, notes: 'all in' });
    expect((await a.call('POST', '/builds', { name: 'Bad', classId: cls.id, ranks: { [other.id]: 1 } })).status).toBe(400);
    expect((await a.call('POST', '/builds', { name: 'Bad', classId: cls.id, ranks: { [node.id]: node.rankLimit + 1 } })).status).toBe(400);
    const edited = (await a.ok('PUT', `/builds/${saved.id}`, { name: 'Glass cannon II' })).build;
    expect(edited).toMatchObject({ id: saved.id, name: 'Glass cannon II', ranks: { [node.id]: 1 } });
    // another account cannot see, edit or delete it
    const b = new Browser();
    await b.ok('POST', '/auth/register', { username: 'Thief', password: 'sticky-fingers-9' });
    expect((await b.ok('GET', '/builds')).builds).toHaveLength(0);
    expect((await b.call('PUT', `/builds/${saved.id}`, { name: 'mine now' })).status).toBe(404);
    expect((await b.call('DELETE', `/builds/${saved.id}`)).status).toBe(404);
    await a.ok('DELETE', `/builds/${saved.id}`);
    expect((await a.ok('GET', '/builds')).builds).toHaveLength(0);
  });

  it('deletes an account (password-confirmed) and frees its profile as a guest', async () => {
    const a = new Browser();
    const acc = (await a.ok('POST', '/auth/register', { username: 'Short_Lived', password: 'mayfly-wings-01' })).account;
    await a.ok('POST', '/builds', { name: 'gone', classId: 'vanguard', ranks: {} });
    expect((await a.call('POST', '/account/delete', { password: 'wrong-one-here' })).status).toBe(401);
    await a.ok('POST', '/account/delete', { password: 'mayfly-wings-01' });
    expect((await a.ok('GET', '/auth/me')).account).toBeNull();
    expect((await a.call('POST', '/auth/login', { username: 'Short_Lived', password: 'mayfly-wings-01' })).status).toBe(401);
    expect((await a.ok('GET', `/local/profiles/${acc.profileId}`)).account).toBeNull();
    // the username can be registered again
    await new Browser().ok('POST', '/auth/register', { username: 'Short_Lived', password: 'mayfly-wings-02' });
  });

  it('runs the friend request lifecycle and scopes boards to friends', async () => {
    const a = new Browser();
    const b = new Browser();
    const c = new Browser();
    const A = (await a.ok('POST', '/auth/register', { username: 'Friend_A', password: 'hand-in-hand-1' })).account;
    const B = (await b.ok('POST', '/auth/register', { username: 'Friend_B', password: 'hand-in-hand-2' })).account;
    await c.ok('POST', '/auth/register', { username: 'Friend_C', password: 'hand-in-hand-3' });
    expect((await a.ok('POST', '/friends', { username: 'friend_b' })).state).toBe('outgoing');
    expect((await b.ok('GET', '/friends')).friends).toMatchObject([{ username: 'Friend_A', state: 'incoming' }]);
    expect((await a.call('POST', `/friends/${B.id}/accept`)).status).toBe(404); // the requester cannot accept their own request
    await b.ok('POST', `/friends/${A.id}/accept`);
    expect((await a.ok('GET', '/friends')).friends).toMatchObject([{ username: 'Friend_B', state: 'friends' }]);
    expect((await a.call('POST', '/friends', { username: 'Nobody_Real' })).status).toBe(404);
    // a mutual request auto-accepts
    await c.ok('POST', '/friends', { username: 'Friend_A' });
    expect((await a.ok('POST', '/friends', { username: 'Friend_C' })).state).toBe('friends');
    await a.ok('DELETE', `/friends/${B.id}`);
    expect((await b.ok('GET', '/friends')).friends).toHaveLength(0);

    const card = await a.ok('GET', '/players/Friend_C');
    expect(card).toMatchObject({ player: { username: 'Friend_C' }, relation: 'friends', stats: { runs: 0 } });
    expect((await a.ok('GET', '/account/stats')).stats.runs).toBe(0);

    const keys = await a.ok('GET', '/boards/keys');
    const key = keys.keys[0]?.boardKey ?? 'none';
    expect((await new Browser().call('GET', `/boards?key=${encodeURIComponent(key)}&scope=friends`)).status).toBe(401);
    const fb = await a.ok('GET', `/boards?key=${encodeURIComponent(key)}&scope=friends`);
    expect(Array.isArray(fb.rows)).toBe(true);
  });
});
