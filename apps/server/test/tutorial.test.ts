import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { contentHash } from '@cursebound/content';
import { PROTOCOL_VERSION, BUILD_ID, type ServerMessage } from '@cursebound/protocol';
import { GUIDE_STEPS } from '@cursebound/simulation';
import { startServer } from '../src/main';

// "First Descent" over the wire: a tutorial room runs the guided crypt (simulation tutorialRoom.ts), its steps
// advance from real inputs, the Fate door commits without storage, and nothing is ever written: no run record,
// events, replay, board entry or Records row.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursebound-tut-'));
let port = 26500 + Math.floor(Math.random() * 300);

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
  last<T extends ServerMessage['t']>(t: T) { return [...this.msgs].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined; }
  close() { this.ws.close(); }
}

const tickle = () => new Promise((r) => setTimeout(r, 5));

describe('tutorial rooms', () => {
  let srv: Awaited<ReturnType<typeof boot>>;
  afterAll(async () => { try { await srv?.shutdown(); } catch { /* ignore */ } });

  it('plays the guided crypt to the Fate doors and never records a run, board or replay', async () => {
    srv = await boot();
    const prof = await api('POST', '/local/profiles', { displayName: 'Novice' });
    const room = await api('POST', '/rooms', { profileId: prof.id, mode: 'solo', classId: 'vanguard', tutorial: true });
    const c = new Client(room.roomId, room.seatToken);
    await c.open();
    expect(c.last('WELCOME')?.tutorial).toBe(true);
    c.send({ t: 'LOBBY', ready: true });
    await until(() => !!srv.rooms.rooms.get(room.roomId)?.authority);
    const a = srv.rooms.rooms.get(room.roomId)!.authority!;
    expect(a.guided).toBe(true);
    expect(a.ephemeral).toBe(true);
    expect(a.state.guide).toBeTruthy();
    for (let i = 0; i < 400 && a.state.phase !== 'COMBAT'; i++) { a.tick(); if (i % 20 === 0) await tickle(); }
    expect(a.state.phase).toBe('COMBAT');
    expect(a.state.map?.layout).toBe('tutorial');
    const phase = c.last('PHASE')!.data as { guided?: boolean; tutorial: boolean };
    expect(phase.guided).toBe(true);
    // the prompt state rides on every snapshot
    a.sendSnapshot();
    await until(() => !!(c.last('SNAPSHOT')?.snap as { gd?: unknown })?.gd);
    expect((c.last('SNAPSHOT')!.snap as { gd: { s: number } }).gd.s).toBe(0);

    // drive the hero over the wire (inputs are intentions; the steps advance only from what the hero does)
    let seq = 1;
    const drive = async (x: number | null, y: number | null, b = 0, stop = 0.3) => {
      const p = a.state.players[0];
      let mx = 0, my = 0, ax = p.aimX * 3, ay = p.aimY * 3;
      if (x !== null && y !== null) {
        const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
        if (d > 1e-6) { ax = (dx / d) * 3; ay = (dy / d) * 3; }
        if (d > stop) { mx = dx / d; my = dy / d; }
      }
      (a as unknown as { buckets: { tokens: number }[] }).buckets[0].tokens = 12;   // manual ticking outpaces the real-time input rate limit
      a.submitInput(0, { seq: seq++, moveX: Math.round(mx * 127) / 127, moveY: Math.round(my * 127) / 127, aimX: Math.round(ax * 64) / 64, aimY: Math.round(ay * 64) / 64, buttons: b });
      a.tick();
      if (seq % 40 === 0) await tickle();
    };
    const step = () => GUIDE_STEPS[a.state.guide!.step];
    for (let i = 0; i < 60 * 20 && step() === 'move'; i++) await drive(a.state.guide!.mx!, a.state.guide!.my!);
    expect(step()).toBe('attack');
    for (let i = 0; i < 60 * 30 && step() === 'attack'; i++) {
      const d = a.state.enemies.find((e) => a.state.guide!.ids.includes(e.id) && e.state !== 'dying');
      await drive(d?.x ?? null, d?.y ?? null, 1, 1.0);
    }
    expect(step()).toBe('skills');
    const bits = [2, 4, 8];
    for (let i = 0; i < 60 * 10 && step() === 'skills'; i++) {
      const d = a.state.enemies.find((e) => a.state.guide!.ids.includes(e.id) && e.state !== 'dying');
      await drive(d?.x ?? null, d?.y ?? null, i % 20 < 2 ? bits[Math.floor(i / 20) % 3] : 0, 1.6);
    }
    expect(step()).toBe('dodge');
    // the toad's globs: hold the hero untouchable and dash while one is on its way (a dash during the threat counts)
    for (let i = 0; i < 60 * 40 && step() === 'dodge'; i++) {
      const toad = a.state.enemies.find((e) => a.state.guide!.ids.includes(e.id));
      const threat = a.state.telegraphs.some((t) => t.ownerId === toad?.id);
      a.state.players[0].iframes = Math.max(a.state.players[0].iframes, 0.5);
      await drive(20.5, 11.5 + (i % 120 < 60 ? -2 : 2), threat && i % 6 === 0 ? 32 : 0, 0.2);
    }
    expect(step()).toBe('loot');
    const [itemA, itemB] = a.state.guide!.items!;
    const item = (id: string) => (a.state.loot ?? []).find((it) => it.itemId === id);
    for (let i = 0; i < 60 * 10 && !(a.state.guide!.done & 1); i++) { const it = item(itemA); await drive(it?.x ?? null, it?.y ?? null, 0, 0.1); }
    for (let i = 0; i < 60 * 10 && step() === 'loot'; i++) { const it = item(itemB); await drive(it?.x ?? null, it?.y ?? null, 0, 1.2); }
    for (let i = 0; i < 60 * 10 && a.state.phase !== 'VOTING'; i++) await drive(null, null);
    expect(a.state.phase).toBe('VOTING');
    await until(() => !!c.last('OFFER'));
    const door = a.state.doors!.list[1];
    for (let i = 0; i < 60 * 20 && a.state.phase === 'VOTING'; i++) await drive(door.x, door.y, 0, 0.2);
    // committed without storage: COMMIT broadcast, durable ack, then "You're ready" (RESULTS) with no round 2
    for (let i = 0; i < 60 * 8 && a.state.phase !== 'RESULTS'; i++) { a.tick(); if (i % 20 === 0) await tickle(); }
    expect(a.state.phase).toBe('RESULTS');
    expect(a.state.round).toBe(1);
    await until(() => !!c.last('RESULTS'));
    expect(c.last('COMMIT')?.durable).toBe(true);
    const summary = c.last('RESULTS')!.summary as { guided?: boolean; practice: boolean; breakdown?: { v: number } };
    expect(summary.guided).toBe(true);
    expect(summary.practice).toBe(true);
    await a.flush();
    const runId = a.state.runId;
    expect(await srv.store.getRun(runId)).toBeFalsy();
    await expect(api('GET', `/runs/${runId}`)).rejects.toMatchObject({ status: 404 });
    expect((await api('GET', `/runs?profileId=${prof.id}&limit=20`)).runs).toHaveLength(0);
    for (const k of (await api('GET', '/boards/keys')).keys as { boardKey: string }[]) {
      const board = await api('GET', `/boards?key=${encodeURIComponent(k.boardKey)}&practice=1`);
      expect((board.rows as { runId: string }[]).some((x) => x.runId === runId)).toBe(false);
    }
    c.close();
  });

  it('skipping (leaving the room) records nothing either', async () => {
    srv ??= await boot();
    const prof = await api('POST', '/local/profiles', { displayName: 'Skipper' });
    const room = await api('POST', '/rooms', { profileId: prof.id, mode: 'solo', classId: 'ranger', tutorial: true });
    const c = new Client(room.roomId, room.seatToken);
    await c.open();
    c.send({ t: 'LOBBY', ready: true });
    await until(() => !!srv.rooms.rooms.get(room.roomId)?.authority);
    const a = srv.rooms.rooms.get(room.roomId)!.authority!;
    for (let i = 0; i < 300; i++) { a.tick(); if (i % 20 === 0) await tickle(); }
    c.close();
    await tickle();
    await a.flush();
    expect(await srv.store.getRun(a.state.runId)).toBeFalsy();
    expect((await api('GET', `/runs?profileId=${prof.id}&limit=20`)).runs).toHaveLength(0);
  });
});
