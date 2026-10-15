import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { contentHash } from '@cursebound/content';
import { PROTOCOL_VERSION, BUILD_ID, parseClientMessage, type ServerMessage } from '@cursebound/protocol';
import { startServer } from '../src/main';

// Training grounds over the wire: TRAIN is seat-scoped and accepted only in training rooms; a training run spawns
// what it is asked to, and never writes a run record, events, a board entry or a record — not even when it ends.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursebound-train-'));
let port = 26100 + Math.floor(Math.random() * 300);

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

async function until(cond: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition not reached in time');
    await new Promise((r) => setTimeout(r, 5));
  }
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
    await until(() => this.msgs.some((m) => m.t === 'WELCOME' || m.t === 'ERROR'));
  }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  ack(requestId: string) { return this.msgs.find((m) => m.t === 'ACK' && m.requestId === requestId) as Extract<ServerMessage, { t: 'ACK' }> | undefined; }
  close() { this.ws.close(); }
}

const tickle = () => new Promise((r) => setTimeout(r, 5));

describe('training rooms', () => {
  let srv: Awaited<ReturnType<typeof boot>>;
  afterAll(async () => { try { await srv?.shutdown(); } catch { /* ignore */ } });

  it('the protocol validates TRAIN and BLESS shapes', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'TRAIN', op: 'spawn', arg: 'hounds', tier: 2, requestId: 'r1' })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ t: 'TRAIN', op: 'nuke', requestId: 'r1' })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ t: 'TRAIN', op: 'spawn', arg: 'Hounds!', requestId: 'r1' })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ t: 'TRAIN', op: 'spawn', tier: 3, requestId: 'r1' })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ t: 'BLESS', offerId: 'run-o1', slot: 1, requestId: 'r2' })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ t: 'BLESS', offerId: 'run-o1', slot: 3, requestId: 'r2' })).ok).toBe(false);
  });

  it('rejects TRAIN in ordinary rooms', async () => {
    srv = await boot();
    const prof = await api('POST', '/local/profiles', { displayName: 'Ordinary' });
    const room = await api('POST', '/rooms', { profileId: prof.id, mode: 'solo', classId: 'vanguard' });
    const c = new Client(room.roomId, room.seatToken);
    await c.open();
    c.send({ t: 'LOBBY', ready: true });
    const r = await (async () => { await until(() => !!srv.rooms.rooms.get(room.roomId)?.authority); return srv.rooms.rooms.get(room.roomId)!; })();
    const a = r.authority!;
    expect(r.training).toBe(false);
    c.send({ t: 'READY', ready: true });
    for (let i = 0; i < 400 && a.state.phase !== 'COMBAT'; i++) { a.tick(); if (i % 20 === 0) await tickle(); }
    expect(a.state.phase).toBe('COMBAT');
    const enemies = a.state.enemies.length;
    for (const [i, op] of (['spawn', 'boss', 'clear', 'heal', 'class'] as const).entries()) {
      c.send({ t: 'TRAIN', op, arg: op === 'spawn' ? 'hounds' : op === 'boss' ? 'bellroot' : op === 'class' ? 'ranger' : undefined, requestId: `t${i}` });
    }
    await until(() => !!c.ack('t4'));
    for (let i = 0; i < 5; i++) { a.tick(); await tickle(); }
    for (let i = 0; i < 5; i++) expect(c.ack(`t${i}`)).toMatchObject({ ok: false, code: 'NOT_TRAINING' });
    expect(a.state.training).toBeUndefined();
    expect(a.state.players[0].classId).toBe('vanguard');
    expect(a.state.enemies.length).toBeLessThanOrEqual(enemies);
    c.close();
  });

  it('runs a training room: spawns on request and never records a run, board or record', async () => {
    const prof = await api('POST', '/local/profiles', { displayName: 'Trainee' });
    const room = await api('POST', '/rooms', { profileId: prof.id, mode: 'solo', classId: 'arcanist', training: true });
    expect(room.training).toBe(true);
    const c = new Client(room.roomId, room.seatToken);
    await c.open();
    c.send({ t: 'LOBBY', ready: true });
    await until(() => !!srv.rooms.rooms.get(room.roomId)?.authority);
    const r = srv.rooms.rooms.get(room.roomId)!;
    const a = r.authority!;
    expect(r.training).toBe(true);
    expect(a.training).toBe(true);
    expect(a.practice).toBe(true);
    // no loadout to confirm: the yard opens by itself
    for (let i = 0; i < 400 && a.state.phase !== 'COMBAT'; i++) { a.tick(); if (i % 20 === 0) await tickle(); }
    expect(a.state.phase).toBe('COMBAT');
    expect(a.state.map?.theme).toBe('courtyard');
    const phase = [...c.msgs].reverse().find((m) => m.t === 'PHASE') as Extract<ServerMessage, { t: 'PHASE' }>;
    expect((phase.data as { training: boolean }).training).toBe(true);
    c.send({ t: 'TRAIN', op: 'spawn', arg: 'gaol', tier: 1, requestId: 'sp1' });
    c.send({ t: 'TRAIN', op: 'boss', arg: 'prismstag', requestId: 'sp2' });
    c.send({ t: 'TRAIN', op: 'ai', arg: 'off', requestId: 'sp3' });
    await tickle();
    for (let i = 0; i < 4; i++) { a.tick(); await tickle(); }
    await until(() => !!c.ack('sp3'));
    expect(c.ack('sp1')?.ok).toBe(true);
    expect(c.ack('sp2')?.ok).toBe(true);
    expect(a.state.enemies.filter((e) => e.boss)).toHaveLength(1);
    expect(a.state.enemies.some((e) => e.elite === 1)).toBe(true);
    expect(a.state.training?.ai).toBe(false);
    // leave by retiring: FINALIZE completes without storage, and nothing was ever written
    c.send({ t: 'RETIRE', yes: true });
    await tickle();
    for (let i = 0; i < 20 && a.state.phase !== 'RESULTS'; i++) { a.tick(); await tickle(); }
    expect(a.state.phase).toBe('RESULTS');
    await a.flush();
    const runId = a.state.runId;
    expect(await srv.store.getRun(runId)).toBeFalsy();
    await expect(api('GET', `/runs/${runId}`)).rejects.toMatchObject({ status: 404 });
    const runs = await api('GET', `/runs?profileId=${prof.id}&limit=20`);
    expect(runs.runs).toHaveLength(0);
    const keys = await api('GET', '/boards/keys');
    for (const k of keys.keys as { boardKey: string }[]) {
      const board = await api('GET', `/boards?key=${encodeURIComponent(k.boardKey)}`);
      expect((board.rows as { runId: string }[]).some((x) => x.runId === runId)).toBe(false);
    }
    c.close();
  });
});
