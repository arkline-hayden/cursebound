import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { contentHash } from '@cursebound/content';
import { PROTOCOL_VERSION, BUILD_ID, parseClientMessage, type ServerMessage } from '@cursebound/protocol';
import { startServer } from '../src/main';

// Room events over the wire: the EVENT message is shape-checked by the protocol, carried seat-scoped to the
// simulation (which validates phase, range, stock and funds) and acknowledged; room_event cues reach the clients.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursebound-events-'));
let port = 26500 + Math.floor(Math.random() * 300);

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

const tickle = () => new Promise((r) => setTimeout(r, 5));

describe('room events over the wire', () => {
  let srv: Awaited<ReturnType<typeof startServer>> | null = null;
  afterAll(async () => { try { await srv?.shutdown(); } catch { /* ignore */ } fs.rmSync(dataDir, { recursive: true, force: true }); });

  it('the protocol validates EVENT shapes and TRAIN event, at protocol 4', () => {
    expect(PROTOCOL_VERSION).toBe(4);
    expect(parseClientMessage(JSON.stringify({ t: 'EVENT', op: 'shrine', id: 12, requestId: 'r1' })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ t: 'EVENT', op: 'buy', id: 12, choice: 3, requestId: 'r1' })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ t: 'EVENT', op: 'steal', id: 12, requestId: 'r1' })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ t: 'EVENT', op: 'altar', id: -1, choice: 0, requestId: 'r1' })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ t: 'EVENT', op: 'altar', id: 4, choice: 99, requestId: 'r1' })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ t: 'TRAIN', op: 'event', arg: 'shrine_fury', requestId: 'r2' })).ok).toBe(true);
  });

  it('spawns events in a training room and validates purchases and shrines through the authority', async () => {
    port++;
    srv = await startServer({ ...process.env, CURSEBOUND_PORT: String(port), CURSEBOUND_DATA_DIR: dataDir });
    srv.rooms.stop();   // manual ticking
    const prof = await api('POST', '/local/profiles', { displayName: 'Shopper' });
    const room = await api('POST', '/rooms', { profileId: prof.id, mode: 'solo', classId: 'vanguard', training: true });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/rooms`, { headers: { origin: 'http://localhost:3000' } });
    const msgs: ServerMessage[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    const ack = (id: string) => msgs.find((m) => m.t === 'ACK' && m.requestId === id) as Extract<ServerMessage, { t: 'ACK' }> | undefined;
    send({ t: 'HELLO', protocol: PROTOCOL_VERSION, build: BUILD_ID, contentHash: contentHash(), roomId: room.roomId, seatToken: room.seatToken });
    await until(() => msgs.some((m) => m.t === 'WELCOME'));
    send({ t: 'LOBBY', ready: true });
    await until(() => !!srv!.rooms.rooms.get(room.roomId)?.authority);
    const a = srv.rooms.rooms.get(room.roomId)!.authority!;
    for (let i = 0; i < 400 && a.state.phase !== 'COMBAT'; i++) { a.tick(); if (i % 20 === 0) await tickle(); }
    expect(a.state.phase).toBe('COMBAT');
    const step = async (n = 3) => { await tickle(); for (let i = 0; i < n; i++) { a.tick(); await tickle(); } };
    send({ t: 'TRAIN', op: 'event', arg: 'merchant', requestId: 'm1' });
    send({ t: 'TRAIN', op: 'event', arg: 'shrine_fury', requestId: 'm2' });
    await step();
    await until(() => !!ack('m2'));
    expect(ack('m1')?.ok).toBe(true);
    const merchant = a.state.roomEvents!.list.find((e) => e.kind === 'merchant')!;
    const shrine = a.state.roomEvents!.list.find((e) => e.kind === 'shrine')!;
    const p = a.state.players[0];
    p.x = merchant.x; p.y = merchant.y;
    send({ t: 'EVENT', op: 'buy', id: merchant.id, choice: 0, requestId: 'b1' });
    await step();
    await until(() => !!ack('b1'));
    expect(ack('b1')).toMatchObject({ ok: false, code: 'NO_FUNDS' });
    p.coins = 50;
    send({ t: 'EVENT', op: 'buy', id: merchant.id, choice: 0, requestId: 'b2' });
    send({ t: 'EVENT', op: 'shrine', id: shrine.id, requestId: 's1' });   // too far from the shrine (it stands elsewhere)
    await step();
    await until(() => !!ack('s1'));
    expect(ack('b2')?.ok).toBe(true);
    expect(a.state.players[0].coins).toBe(50 - merchant.stock![0].price);
    const dist = Math.hypot(shrine.x - p.x, shrine.y - p.y);
    expect(ack('s1')?.ok).toBe(dist <= 1.8);
    p.x = shrine.x; p.y = shrine.y;
    send({ t: 'EVENT', op: 'shrine', id: shrine.id, requestId: 's2' });
    await step(25);   // past the next snapshot / event batch
    await until(() => !!ack('s2'));
    if (dist > 1.8) expect(ack('s2')?.ok).toBe(true);
    const cues = msgs.filter((m) => m.t === 'EVENTS').flatMap((m) => (m as Extract<ServerMessage, { t: 'EVENTS' }>).events as { t: string; op?: string }[]);
    expect(cues.some((e) => e.t === 'room_event' && e.op === 'buy')).toBe(true);
    expect(cues.some((e) => e.t === 'room_event' && e.op === 'shrine')).toBe(true);
    ws.close();
  });
});
