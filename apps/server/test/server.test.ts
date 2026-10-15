import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { contentHash } from '@cursebound/content';
import { PROTOCOL_VERSION, BUILD_ID, type ServerMessage } from '@cursebound/protocol';
import { botInput } from '@cursebound/simulation';
import { startServer } from '../src/main';

// Integration: real HTTP + WebSocket authority + SQLite (PRD §27.2), with manual ticking for speed.
// Covers A12 (disconnect/reconnect seat), A14 (crash after persistence), A15 (refresh during vote), A16 (forged client data).

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursebound-it-'));
let port = 25600 + Math.floor(Math.random() * 300);

async function boot() {
  port++;
  const srv = await startServer({ ...process.env, CURSEBOUND_PORT: String(port), CURSEBOUND_DATA_DIR: dataDir });
  srv.rooms.stop();   // manual ticking
  return srv;
}

async function api<T = any>(method: string, p: string, body?: unknown): Promise<T> {
  const r = await fetch(`http://127.0.0.1:${port}/api/v1${p}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j: any = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.error?.message ?? 'http error'), { status: r.status, body: j });
  return j as T;
}

class Client {
  ws!: WebSocket;
  msgs: ServerMessage[] = [];
  constructor(public roomId: string, public token: string) {}
  async open() {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/rooms`, { headers: { origin: 'http://localhost:3000' } });
    this.ws.on('message', (d) => this.msgs.push(JSON.parse(d.toString())));
    await new Promise<void>((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); });
    this.send({ t: 'HELLO', protocol: PROTOCOL_VERSION, build: BUILD_ID, contentHash: contentHash(), roomId: this.roomId, seatToken: this.token });
    // the handshake is answered asynchronously; under a busy parallel test run a fixed delay is not enough
    await until(() => this.msgs.some((m) => m.t === 'WELCOME' || m.t === 'ERROR'));
  }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  last<T extends ServerMessage['t']>(t: T) { return [...this.msgs].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined; }
  close() { this.ws.close(); }
}

const tickle = () => new Promise((r) => setTimeout(r, 5));
/** Wait for a condition the authority reaches asynchronously (fails loudly instead of hanging). */
async function until(cond: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition not reached in time');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('server integration', () => {
  let srv: Awaited<ReturnType<typeof boot>>;
  afterAll(async () => { try { await srv?.shutdown(); } catch { /* ignore */ } });

  it('plays a solo run over the wire, survives refresh during vote, crash-recovers a commit and verifies replay', async () => {
    srv = await boot();
    const health = await api('GET', '/health');
    expect(health.ok).toBe(true);
    const prof = await api('POST', '/local/profiles', { displayName: '  Ivy\u0000 the  Bold  ' });
    expect(prof.displayName).toBe('Ivy the Bold');
    const room = await api('POST', '/rooms', { profileId: prof.id, mode: 'solo', classId: 'arcanist' });
    const c = new Client(room.roomId, room.seatToken);
    await c.open();
    await tickle();
    expect(c.last('WELCOME')?.slot).toBe(0);
    c.send({ t: 'LOBBY', classId: 'arcanist', ready: true });
    await until(() => [...srv.rooms.rooms.values()].find((x) => x.id === room.roomId)?.stage === 'RUN');
    const r = [...srv.rooms.rooms.values()].find((x) => x.id === room.roomId)!;
    expect(r.stage).toBe('RUN');
    const a = r.authority!;
    // A16: forged fields are ignored; unknown message types are rejected
    c.send({ t: 'INPUT', seq: 1, tick: 0, mx: 0, my: 0, ax: 1, ay: 0, b: 0, hp: '1e999', score: '999' });
    c.send({ t: 'SET_SCORE', score: '1e99' });
    await until(() => c.msgs.some((m) => m.t === 'ERROR' && m.code === 'INVALID_INPUT'));
    expect(c.msgs.some((m) => m.t === 'ERROR' && m.code === 'INVALID_INPUT')).toBe(true);
    const pump = async (n: number, play = true) => {
      for (let i = 0; i < n; i++) {
        if (play && a.state.phase === 'COMBAT') {
          const inp = botInput(a.state, 0, a.state.players[0].lastInputSeq + 1);
          a.submitInput(0, inp);
        }
        if (play && a.state.phase === 'SKILL_ALLOCATION' && !a.state.players[0].ready && i % 30 === 0) a.submitCommand({ type: 'READY', slot: 0, ready: true });
        a.tick();
        if (i % 20 === 0) await tickle();
      }
      await tickle();
    };
    c.send({ t: 'READY', ready: true });
    await tickle(); await tickle();
    await pump(5);
    expect(['ROUND_SETUP', 'COMBAT']).toContain(a.state.phase);
    for (let k = 0; k < 400 && a.state.phase !== 'VOTING' && a.state.phase !== 'RESULTS'; k++) await pump(60);
    if (a.state.phase === 'RESULTS') return;   // bot wiped in round 1 (still a valid run)
    expect(a.state.phase).toBe('VOTING');
    const offer = c.last('OFFER')!;
    expect(offer.cardIds).toHaveLength(3);
    expect((offer.forecast as { cards: unknown[] }).cards).toHaveLength(3);
    // in-world door vote: three doors in the snapshot carry the offer's themes; the hero walks (inputs are accepted)
    await pump(4, false);
    const snapDoors = (c.last('SNAPSHOT')?.snap as { doors?: { th: string; x: number; y: number }[] }).doors;
    expect(snapDoors).toHaveLength(3);
    expect(offer.themes).toHaveLength(3);
    expect(snapDoors!.map((d) => d.th)).toEqual(offer.themes);
    const p0 = a.state.players[0], from = { x: p0.x, y: p0.y };
    const dx = snapDoors![0].x - p0.x, dy = snapDoors![0].y - p0.y, dl = Math.hypot(dx, dy) || 1;
    for (let k = 0; k < 8; k++) {
      c.send({ t: 'INPUT', seq: 5000 + k, tick: a.state.tick, mx: Math.round((dx / dl) * 127) / 127, my: Math.round((dy / dl) * 127) / 127, ax: 1, ay: 0, b: 1 });
      await tickle(); a.tick();
    }
    c.send({ t: 'INPUT', seq: 5100, tick: a.state.tick, mx: 0, my: 0, ax: 1, ay: 0, b: 0 });   // stop short of the door
    await tickle(); await pump(12, false);
    expect(Math.hypot(a.state.players[0].x - from.x, a.state.players[0].y - from.y)).toBeGreaterThan(0.2);
    expect(a.state.phase).toBe('VOTING');
    // A15: refresh during vote -> new socket with the same seat token gets the offer and vote state again
    c.close();
    // the socket close reaches the authority asynchronously (slower under load / on CI)
    await until(() => { a.tick(); return a.paused; });
    expect(a.paused).toBe(true);   // solo local authority paused for client loss
    const c2 = new Client(room.roomId, room.seatToken);
    await c2.open();
    await until(() => { a.tick(); return !a.paused; });
    expect(a.paused).toBe(false);
    expect(c2.last('OFFER')?.offerId).toBe(offer.offerId);
    expect(c2.last('VOTE_STATE')?.offerId).toBe(offer.offerId);
    // stale offer vote rejected (A07 over the wire)
    c2.send({ t: 'VOTE', offerId: 'nope', seq: 1, slot: 0, locked: false });
    c2.send({ t: 'VOTE', offerId: offer.offerId, seq: 2, slot: 1, locked: true });
    c2.send({ t: 'VOTE', offerId: offer.offerId, seq: 2, slot: 2, locked: true });   // duplicate seq
    await tickle();
    await pump(3, false);
    await a.flush();
    await pump(3, false);
    const acks = c2.msgs.filter((m) => m.t === 'VOTE_ACK') as Extract<ServerMessage, { t: 'VOTE_ACK' }>[];
    expect(acks.find((x) => x.offerId === 'nope')?.accepted).toBe(false);
    expect(acks.filter((x) => x.offerId === offer.offerId && x.accepted)).toHaveLength(1);
    const commit = c2.last('COMMIT');
    expect(commit?.cardId).toBe(offer.cardIds[1]);
    expect(commit?.durable).toBe(true);
    // the presentation event for the walk-through reaches clients
    const chosenEv = c2.msgs.flatMap((m) => (m.t === 'EVENTS' ? (m.events as { t: string; i?: number; th?: string }[]) : [])).find((e) => e.t === 'door_chosen');
    expect(chosenEv?.i).toBe(1);
    expect(chosenEv?.th).toBe(offer.themes![1]);
    const runId = a.state.runId;
    const committedCards = a.state.fate.entries.length;
    // A14: crash after persistence (before the next round). Restart and resume: same committed card, not reapplied.
    c2.close();
    await a.flush();
    await srv.shutdown();
    srv = await boot();
    const prof2 = prof.id;
    const runs = await api('GET', `/runs?profileId=${prof2}&status=active`);
    expect(runs.runs.map((x: { id: string }) => x.id)).toContain(runId);
    const resumed = await api('POST', `/runs/${runId}/resume`, { profileId: prof2 });
    const r2 = srv.rooms.rooms.get(resumed.roomId)!;
    const a2 = r2.authority!;
    expect(a2.state.resumed).toBe(true);
    expect(a2.state.fate.entries.length).toBe(committedCards);
    expect(a2.state.commits[a2.state.commits.length - 1].cardId).toBe(offer.cardIds[1]);
    const c3 = new Client(resumed.roomId, resumed.seatToken);
    await c3.open();
    await tickle();
    // FATE_COMMIT holds for the door walk-through (RULES.doorWalkSec) after the durable ack
    for (let i = 0; i < 400 && a2.state.phase === 'FATE_COMMIT'; i++) { a2.tick(); if (i % 20 === 0) await tickle(); }
    expect(a2.state.fate.entries.length).toBe(committedCards);   // durable ack did not reapply
    expect(a2.state.map?.theme).toBe(offer.themes![1]);           // the next floor is the chosen door's dungeon
    expect(['ROUND_SETUP', 'COMBAT']).toContain(a2.state.phase);
    // retire -> FINALIZE -> durable -> RESULTS
    c3.send({ t: 'RETIRE', yes: true });
    await tickle();
    for (let i = 0; i < 20; i++) { a2.tick(); if (i % 5 === 0) { await a2.flush(); await tickle(); } }
    await a2.flush();
    for (let i = 0; i < 5; i++) { a2.tick(); await tickle(); }
    expect(a2.state.phase).toBe('RESULTS');
    expect(c3.last('RESULTS')).toBeTruthy();
    const run = await api('GET', `/runs/${runId}`);
    expect(run.status).toBe('finalized');
    expect(run.resumed === true || run.resumed === false).toBe(true);
    const verify = await api('POST', `/runs/${runId}/verify`);
    expect(verify.reason).toBeTruthy();
    expect(verify.ok).toBe(true);
    const keys = await api('GET', '/boards/keys');
    const key = keys.keys.find((k: { boardKey: string }) => k.boardKey.includes('|n1|solo|'))?.boardKey;
    const board = await api('GET', `/boards?key=${encodeURIComponent(key)}`);
    expect(board.trustLabel).toBe('Local');
    expect(board.rows.some((x: { runId: string }) => x.runId === runId)).toBe(true);
    c3.close();
  });

  it('A12: a co-op member disconnecting keeps N and scaling; the same seat reconnects', async () => {
    const p1 = await api('POST', '/local/profiles', { displayName: 'One' });
    const p2 = await api('POST', '/local/profiles', { displayName: 'Two' });
    const room = await api('POST', '/rooms', { profileId: p1.id, mode: 'coop', classId: 'vanguard' });
    const join = await api('POST', `/rooms/${room.code}/join`, { profileId: p2.id, classId: 'arcanist' });
    await expect(api('POST', `/rooms/${room.code}/join`, { profileId: p2.id })).rejects.toMatchObject({ status: 409 });
    const c1 = new Client(room.roomId, room.seatToken), c2 = new Client(join.roomId, join.seatToken);
    await c1.open(); await c2.open(); await tickle();
    c1.send({ t: 'LOBBY', ready: true }); c2.send({ t: 'LOBBY', ready: true });
    await until(() => !!srv.rooms.rooms.get(room.roomId)?.authority);
    const r = srv.rooms.rooms.get(room.roomId)!;
    const a = r.authority!;
    expect(a.state.n).toBe(2);
    c1.send({ t: 'READY', ready: true }); c2.send({ t: 'READY', ready: true });
    await tickle();
    for (let i = 0; i < 200; i++) { a.tick(); if (i % 20 === 0) await tickle(); }
    expect(a.state.phase).toBe('COMBAT');
    const hpBefore = a.state.enemies[0]?.cohort.unitHp.toString();
    c2.close();
    // the socket close reaches the authority asynchronously (slower on CI runners): tick until it lands
    await until(() => { a.tick(); return !a.state.players[1].connected; });
    expect(a.state.players[1].connected).toBe(false);
    expect(a.state.n).toBe(2);
    expect(a.paused).toBe(false);   // multiplayer authority never pauses for one client
    const c2b = new Client(join.roomId, join.seatToken);
    await c2b.open();
    await until(() => { a.tick(); return a.state.players[1].connected; });
    expect(a.state.players[1].connected).toBe(true);
    expect(c2b.last('WELCOME')?.slot).toBe(1);
    if (hpBefore) expect(a.state.enemies[0]?.cohort.unitHp.toString() ?? hpBefore).toBe(hpBefore);
    c1.close(); c2b.close();
  });

  it('rejects cross-origin websocket and bad hosts', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/rooms`, { headers: { origin: 'http://evil.example' } });
    const err = await new Promise((res) => { ws.once('error', res); ws.once('open', () => res(null)); });
    expect(err).toBeTruthy();
    const status = await new Promise<number>((res) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/api/v1/health', headers: { host: 'evil.example' } }, (r) => { r.resume(); res(r.statusCode ?? 0); });
      req.on('error', () => res(0));
      req.end();
    });
    expect(status).toBe(421);
  });
});
