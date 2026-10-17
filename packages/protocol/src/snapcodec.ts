// Delta snapshots (wire only; the Snapshot schema itself is unchanged). A client that says HELLO with `snap: SNAP_CODEC`
// acknowledges each snapshot it decoded (SACK); the authority then encodes the next one against the newest snapshot that
// seat acknowledged, so a dropped or reordered delta never breaks the chain (the next one is still against a base the
// client holds). Entity lists send only entities that changed, and of those only the fields that changed: a dormant
// pack, a burning pool or a coin on the floor costs nothing once the client has it. Without an acknowledged base the
// authority sends the full snapshot (keyframe), exactly as before.

/** codec version a client announces in HELLO (`snap`) and the authority echoes in WELCOME when it will send deltas */
export const SNAP_CODEC = 1;

/** Entity lists of a Snapshot and the field that identifies an entity within its list. */
export const SNAP_LISTS: Readonly<Record<string, string>> = {
  players: 's', enemies: 'i', projectiles: 'i', hazards: 'i', telegraphs: 'i', pickups: 'i', lt: 'i', rev: 'i', doors: 'i',
};

type Obj = Record<string, unknown>;
type Id = string | number;

/** One entity list's changes: u = changed or new entities (new ones whole; changed ones the id plus changed fields,
 *  `_x` naming fields that disappeared), r = ids removed, o = the full id order when it is not base-minus-removed
 *  followed by the new ones in `u` order. */
export interface ListDelta { u?: Obj[]; r?: Id[]; o?: Id[] }

/** A snapshot as changes against the snapshot at tick `b`: s = top-level values set, x = top-level keys removed,
 *  l = entity list changes. Every other top-level value is the base's. */
export interface SnapDelta { b: number; tick: number; s?: Obj; x?: string[]; l?: Record<string, ListDelta>; /** shallow patches of plain-object values (changed keys, `_x` = removed) */ p?: Record<string, Obj> }

/** Structural equality for snapshot values (JSON data: primitives, arrays, plain objects). */
export function snapEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!snapEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ao = a as Obj, bo = b as Obj;
  let n = 0;
  for (const k in ao) {
    if (ao[k] === undefined) continue;
    n++;
    if (!snapEqual(ao[k], bo[k])) return false;
  }
  for (const k in bo) if (bo[k] !== undefined) n--;
  return n === 0;
}

/** id -> entity, or null when the list cannot be keyed (not objects, a missing id, a duplicate id) */
function keyed(list: unknown[], key: string): Map<Id, Obj> | null {
  const m = new Map<Id, Obj>();
  for (const e of list) {
    if (!e || typeof e !== 'object') return null;
    const id = (e as Obj)[key];
    if ((typeof id !== 'number' && typeof id !== 'string') || m.has(id)) return null;
    m.set(id, e as Obj);
  }
  return m;
}

/**
 * Element patch for two arrays of the same length (a hero's cooldown tuples, gear perk readiness, ...): a flat list of
 * index, change pairs, where a change is `[value]` (the element replaced) or, when both elements are arrays of one
 * length, `{ "<j>": value }` (only those positions of the element changed). Null when a whole replacement is as small.
 */
function arrayPatch(base: unknown[], cur: unknown[]): unknown[] | null {
  const out: unknown[] = [];
  for (let i = 0; i < cur.length; i++) {
    const a = base[i], b = cur[i];
    if (snapEqual(a, b)) continue;
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      const sub: Obj = {};
      for (let j = 0; j < b.length; j++) if (!snapEqual(a[j], b[j])) sub[j] = b[j];
      out.push(i, sub);
    } else out.push(i, [b]);
  }
  return out.length && out.length < cur.length * 2 ? out : null;
}

function applyArrayPatch(base: unknown[], patch: unknown[]): unknown[] {
  const out = base.slice();
  for (let k = 0; k + 1 < patch.length; k += 2) {
    const i = patch[k] as number, c = patch[k + 1];
    if (Array.isArray(c)) { out[i] = c[0]; continue; }
    const el = (out[i] as unknown[]).slice();
    for (const j in c as Obj) el[Number(j)] = (c as Obj)[j];
    out[i] = el;
  }
  return out;
}

/** entity changes against its base: null when nothing changed. `_x` names fields that disappeared, `_a` holds element
 *  patches for array fields that kept their length (arrayPatch). */
function entityDelta(base: Obj, cur: Obj, key: string): Obj | null {
  let out: Obj | null = null;
  for (const k in cur) {
    const v = cur[k];
    const bv = base[k];
    if (v === undefined || snapEqual(v, bv)) continue;
    if (Array.isArray(v) && Array.isArray(bv) && v.length === bv.length) {
      const p = arrayPatch(bv, v);
      if (p && JSON.stringify(p).length < JSON.stringify(v).length) {
        out ??= { [key]: cur[key] };
        ((out._a ??= {}) as Obj)[k] = p;
        continue;
      }
    }
    (out ??= { [key]: cur[key] })[k] = v;
  }
  let gone: string[] | null = null;
  for (const k in base) if (base[k] !== undefined && cur[k] === undefined) (gone ??= []).push(k);
  if (gone) (out ??= { [key]: cur[key] })._x = gone;
  return out;
}

/** shallow changes of a plain object value (the encounter header): changed keys, `_x` = keys removed; null = same */
function objectDelta(base: Obj, cur: Obj): Obj | null {
  let out: Obj | null = null;
  for (const k in cur) if (cur[k] !== undefined && !snapEqual(cur[k], base[k])) (out ??= {})[k] = cur[k];
  let gone: string[] | null = null;
  for (const k in base) if (base[k] !== undefined && cur[k] === undefined) (gone ??= []).push(k);
  if (gone) (out ??= {})._x = gone;
  return out;
}

const isPlain = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** list changes, or null when unchanged, or 'whole' when the list cannot be diffed */
function listDelta(base: unknown[], cur: unknown[], key: string): ListDelta | null | 'whole' {
  const bm = keyed(base, key);
  const cm = keyed(cur, key);
  if (!bm || !cm) return 'whole';
  const d: ListDelta = {};
  const removed: Id[] = [];
  for (const id of bm.keys()) if (!cm.has(id)) removed.push(id);
  const updates: Obj[] = [];
  const added: Id[] = [];
  for (const [id, e] of cm) {
    const b = bm.get(id);
    if (!b) { updates.push(e); added.push(id); continue; }
    const ed = entityDelta(b, e, key);
    if (ed) updates.push(ed);
  }
  // the order the decoder rebuilds: base minus removed, then new entities in update order
  let natural = true;
  let j = 0;
  const curIds = [...cm.keys()];
  const gone = new Set(removed);
  for (const id of bm.keys()) {
    if (gone.has(id)) continue;
    if (curIds[j++] !== id) { natural = false; break; }
  }
  if (natural) for (const id of added) if (curIds[j++] !== id) { natural = false; break; }
  if (updates.length) d.u = updates;
  if (removed.length) d.r = removed;
  if (!natural) d.o = curIds;
  return d.u || d.r || d.o ? d : null;
}

/** Encode snapshot `cur` against `base` (both plain snapshot objects; neither is modified). */
export function encodeSnapDelta(base: Obj, cur: Obj): SnapDelta {
  const d: SnapDelta = { b: base.tick as number, tick: cur.tick as number };
  for (const k in cur) {
    const v = cur[k];
    if (v === undefined || k === 'tick') continue;   // the header carries it
    const bv = base[k];
    const key = SNAP_LISTS[k];
    if (key && Array.isArray(v) && Array.isArray(bv)) {
      const ld = listDelta(bv, v, key);
      if (ld === 'whole') (d.s ??= {})[k] = v;
      else if (ld) (d.l ??= {})[k] = ld;
      continue;
    }
    if (isPlain(v) && isPlain(bv)) {
      const od = objectDelta(bv, v);
      if (od) (d.p ??= {})[k] = od;
      continue;
    }
    if (!snapEqual(v, bv)) (d.s ??= {})[k] = v;
  }
  for (const k in base) if (base[k] !== undefined && cur[k] === undefined) (d.x ??= []).push(k);
  return d;
}

/** Rebuild the full snapshot from its base and a delta. Unchanged values and entities are shared with the base (treat
 *  decoded snapshots as read-only). */
export function applySnapDelta(base: Obj, d: SnapDelta): Obj {
  const out: Obj = { ...base };
  if (d.s) for (const k in d.s) out[k] = d.s[k];
  if (d.x) for (const k of d.x) delete out[k];
  if (d.p) {
    for (const k in d.p) {
      const patch = d.p[k];
      const o: Obj = { ...(isPlain(base[k]) ? base[k] : {}) };
      for (const f in patch) if (f !== '_x') o[f] = patch[f];
      if (patch._x) for (const f of patch._x as string[]) delete o[f];
      out[k] = o;
    }
  }
  if (d.l) {
    for (const k in d.l) {
      const key = SNAP_LISTS[k] ?? 'i';
      const ld = d.l[k];
      const prev = Array.isArray(base[k]) ? (base[k] as Obj[]) : [];
      const byId = new Map<Id, Obj>();
      for (const e of prev) byId.set(e[key] as Id, e);
      if (ld.r) for (const id of ld.r) byId.delete(id);
      const order: Id[] = [];
      if (!ld.o) for (const e of prev) if (byId.has(e[key] as Id)) order.push(e[key] as Id);
      if (ld.u) {
        for (const u of ld.u) {
          const id = u[key] as Id;
          const b = byId.get(id);
          let e: Obj;
          if (b) {
            e = { ...b, ...u };
            const gone = u._x as string[] | undefined;
            if (gone) { delete e._x; for (const f of gone) delete e[f]; }
            const patches = u._a as Record<string, unknown[]> | undefined;
            if (patches) { delete e._a; for (const f in patches) e[f] = applyArrayPatch(b[f] as unknown[], patches[f]); }
          } else {
            e = u;
            if (!ld.o) order.push(id);
          }
          byId.set(id, e);
        }
      }
      const ids = ld.o ?? order;
      const list: Obj[] = [];
      for (const id of ids) { const e = byId.get(id); if (e) list.push(e); }
      out[k] = list;
    }
  }
  out.tick = d.tick;
  return out;
}

/** An event batch without repeated keys: s = schemas ([type, ...keys], one per distinct type + key set), e = rows
 *  ([schema index, ...values in schema key order]), in the batch's order. Sent to delta seats (same codec gate). */
export interface PackedEvents { s: [string, ...string[]][]; e: unknown[][] }

export function packEvents(events: readonly unknown[]): PackedEvents {
  const s: [string, ...string[]][] = [];
  const ids = new Map<string, number>();
  const e: unknown[][] = [];
  for (const ev of events) {
    const o = ev as Obj;
    const keys: string[] = [];
    for (const k in o) if (k !== 't' && o[k] !== undefined) keys.push(k);
    const sig = `${String(o.t)}|${keys.join(',')}`;
    let id = ids.get(sig);
    if (id === undefined) { id = s.length; ids.set(sig, id); s.push([String(o.t), ...keys]); }
    const row: unknown[] = [id];
    for (const k of keys) row.push(o[k]);
    e.push(row);
  }
  return { s, e };
}

export function unpackEvents(p: PackedEvents): Obj[] {
  const out: Obj[] = [];
  for (const row of p.e) {
    const sc = p.s[row[0] as number];
    if (!sc) continue;
    const o: Obj = { t: sc[0] };
    for (let k = 1; k < sc.length; k++) o[sc[k]] = row[k];
    out.push(o);
  }
  return out;
}

/**
 * Client side: keeps the recently decoded snapshots by tick (delta bases) and turns SNAPSHOT messages into full
 * snapshots. Returns null for a delta whose base it no longer holds, or for a snapshot older than the newest one
 * (an unordered channel may deliver late): both are dropped, the next delta is against a newer acknowledged base.
 */
export class SnapDecoder {
  private bases = new Map<number, Obj>();
  newest = -1;
  /** drop snapshots older than the newest (set once the authority confirmed the codec: snapshots may then ride an
   *  unordered channel); off, every full snapshot is taken as it comes, as before */
  ordered = false;
  constructor(private keep = 64) {}

  reset() { this.bases.clear(); this.newest = -1; this.ordered = false; }

  decode(m: { snap?: unknown; delta?: unknown }): Obj | null {
    let snap: Obj;
    if (m.delta) {
      const d = m.delta as SnapDelta;
      const base = this.bases.get(d.b);
      if (!base) return null;
      snap = applySnapDelta(base, d);
    } else if (m.snap && typeof m.snap === 'object') {
      snap = m.snap as Obj;
    } else return null;
    const tick = snap.tick as number;
    if (this.ordered && tick < this.newest) return null;
    this.newest = tick;
    this.bases.set(tick, snap);
    if (this.bases.size > this.keep) {
      for (const t of this.bases.keys()) { if (this.bases.size <= this.keep) break; this.bases.delete(t); }
    }
    return snap;
  }
}

/** Authority side: the recent snapshots by tick (bases for the seats' acknowledged ticks). */
export class SnapHistory {
  private ring = new Map<number, Obj>();
  constructor(private keep = 64) {}
  add(snap: Obj) {
    this.ring.delete(snap.tick as number);
    this.ring.set(snap.tick as number, snap);
    while (this.ring.size > this.keep) this.ring.delete(this.ring.keys().next().value as number);
  }
  get(tick: number): Obj | undefined { return this.ring.get(tick); }
  clear() { this.ring.clear(); }
}
