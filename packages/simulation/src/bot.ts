import { CLASS_BY_ID, NODE_BY_ID, ROOM_EVENT_RULES, SKILL_BY_ID } from '@cursebound/content';
import { bossBotHint, bossImmune } from './bosses/registry';
import { lineOfSight } from './geometry';
import { canAllocate, hasSpendableNode } from './sim';
import { ACTION, type Command, type EnemyState, type PlayerInput, type PlayerState, type SimState } from './types';

// Scripted reference player for the headless harness, balance sweeps and end-to-end tests (PRD §24.1).
// Uses only visible state (positions, telegraphs) — the same information a human sees.

/**
 * Route to the nearest foe by walking distance when it is out of sight (packs are spread over the whole floor):
 * a BFS over floor tiles from the hero, then the farthest path tile still in line of sight. Pure per tick (no
 * caches), so restored checkpoints keep botting identically.
 */
function route(state: SimState, p: PlayerState, live: EnemyState[]): { target: EnemyState; wx: number; wy: number } | null {
  const map = state.map;
  if (!map || !live.length) return null;
  const { w, h, tiles } = map;
  const start = Math.floor(p.y) * w + Math.floor(p.x);
  if (start < 0 || start >= tiles.length || tiles[start] !== 0) return null;
  const d = new Int32Array(w * h).fill(-1);
  const q = [start];
  d[start] = 0;
  for (let k = 0; k < q.length; k++) {
    const c = q[k], x = c % w, y = (c / w) | 0;
    if (x > 0 && tiles[c - 1] === 0 && d[c - 1] < 0) { d[c - 1] = d[c] + 1; q.push(c - 1); }
    if (x < w - 1 && tiles[c + 1] === 0 && d[c + 1] < 0) { d[c + 1] = d[c] + 1; q.push(c + 1); }
    if (y > 0 && tiles[c - w] === 0 && d[c - w] < 0) { d[c - w] = d[c] + 1; q.push(c - w); }
    if (y < h - 1 && tiles[c + w] === 0 && d[c + w] < 0) { d[c + w] = d[c] + 1; q.push(c + w); }
  }
  let target: EnemyState | null = null, best = Infinity, ti = -1;
  for (const e of live) {
    const i = Math.floor(e.y) * w + Math.floor(e.x);
    const di = i >= 0 && i < d.length ? d[i] : -1;
    if (di < 0) continue;
    if (di < best) { best = di; target = e; ti = i; }
  }
  if (!target) return null;
  const path: number[] = [ti];
  let cur = ti;
  while (d[cur] > 0 && path.length < 400) {
    const x = cur % w;
    const next = [cur - w, cur + w, cur - 1, cur + 1].find((n) => n >= 0 && n < d.length && d[n] === d[cur] - 1 && (n !== cur - 1 || x > 0) && (n !== cur + 1 || x < w - 1));
    if (next === undefined) break;
    path.push(next); cur = next;
  }
  path.reverse();   // hero -> target
  let wx = target.x, wy = target.y;
  for (let k = Math.min(path.length - 1, 14); k >= 1; k--) {
    const cx = (path[k] % w) + 0.5, cy = ((path[k] / w) | 0) + 0.5;
    if (lineOfSight(map, p.x, p.y, cx, cy)) { wx = cx; wy = cy; break; }
    if (k === 1) { wx = cx; wy = cy; }
  }
  return { target, wx, wy };
}

export function botInput(state: SimState, slot: number, seq: number): PlayerInput {
  const p = state.players[slot];
  // a boss out of reach (aloft) is not a target: fight its adds and dodge until it lands (visible state)
  const live = state.enemies.filter((e) => e.state !== 'dying' && !bossImmune(state, e));
  let target = live[0];
  let bd = Infinity;
  for (const e of live) {
    const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (d < bd) { bd = d; target = e; }
  }
  // out of sight: walk the floor toward the nearest foe by path
  let way: { wx: number; wy: number } | null = null;
  if (target && state.map && !lineOfSight(state.map, p.x, p.y, target.x, target.y)) {
    const r = route(state, p, live);
    if (r) { target = r.target; way = r; }
  }
  let moveX = 0, moveY = 0, aimX = 1, aimY = 0, buttons = 0;
  if (target) {
    const dx = target.x - p.x, dy = target.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    aimX = dx; aimY = dy;
    // melee (content `melee` flag, Warden included): close to the basic swing's reach, then stand and swing
    const cls = CLASS_BY_ID[p.classId];
    const basic = SKILL_BY_ID[cls.basicSkill].shape;
    const melee = !!cls.melee;
    const want = melee ? (basic.kind === 'arc' ? basic.range : 1.5) + target.radius - 0.3 : 5;
    if (way) { const wdx = way.wx - p.x, wdy = way.wy - p.y, wl = Math.sqrt(wdx * wdx + wdy * wdy) || 1; moveX = wdx / wl; moveY = wdy / wl; }
    else if (d > want + 0.3) { moveX = dx / d; moveY = dy / d; }
    else if (d < want - 1.5) { moveX = -dx / d; moveY = -dy / d; }
    else { moveX = -dy / d * 0.6; moveY = dx / d * 0.6; }
    buttons |= ACTION.ATTACK;
    // the whole hotbar is owned from round 1 (base skills are starting grants): cast every active on cooldown,
    // except a guard stance (it blocks swinging; melee bots raise it only against a telegraph, below) and a
    // teleport (no blind blinks)
    const bits = [ACTION.SKILL1, ACTION.SKILL2, ACTION.SKILL3];
    if (d < 7) for (let i = 0; i < 3; i++) {
      const sid = p.skills[i]?.skillId;
      const kind = sid ? SKILL_BY_ID[sid].shape.kind : '';
      if (sid && kind !== 'guard' && kind !== 'teleport') buttons |= bits[i];
    }
    if (d < 2.6) buttons |= ACTION.SIGNATURE;
  }
  // dodge out of telegraphs that are about to release
  for (const t of state.telegraphs) {
    if (t.releaseTick - state.tick > 12) continue;
    const dx = p.x - t.x, dy = p.y - t.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    if (d < 3) {
      moveX = dx / d; moveY = dy / d; buttons |= ACTION.DODGE;
      // out of dashes: a melee bot with a guard stance blocks instead
      const g = CLASS_BY_ID[p.classId].melee && p.dodgeCharges <= 0 ? p.skills.findIndex((s, i) => i < 3 && s.skillId && SKILL_BY_ID[s.skillId].shape.kind === 'guard') : -1;
      if (g >= 0) buttons |= [ACTION.SKILL1, ACTION.SKILL2, ACTION.SKILL3][g];
      break;
    }
  }
  // scripted boss mechanics (bosses/*): walk to safe tiles, gaps and clear floor; a telegraph dodge already firing wins
  // unless the hint knows this spot is safe (hold)
  const hint = bossBotHint(state, p);
  if (hint && (hint.dodge || hint.hold || !(buttons & ACTION.DODGE))) {
    const hx = hint.x - p.x, hy = hint.y - p.y, hl = Math.sqrt(hx * hx + hy * hy);
    if (hl > 0.15) { moveX = hx / hl; moveY = hy / hl; } else { moveX = 0; moveY = 0; }
    if (hint.dodge) buttons |= ACTION.DODGE;
    else if (hint.hold) buttons &= ~ACTION.DODGE;
  }
  // revive downed allies
  for (const a of state.players) {
    if (a.lifeState !== 'downed' || a === p) continue;
    const dx = a.x - p.x, dy = a.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1) { moveX = dx / d; moveY = dy / d; } else { moveX = 0; moveY = 0; buttons &= ~ACTION.ATTACK; }
    break;
  }
  const q = (v: number) => Math.round(v * 127) / 127;
  return { seq, moveX: q(moveX), moveY: q(moveY), aimX: Math.round(aimX * 64) / 64, aimY: Math.round(aimY * 64) / 64, buttons };
}

/** Bot intermission decisions: spend points greedily along a fixed preference, then ready / vote. */
export function botCommands(state: SimState, slot: number, voteSeq: number, pick: (cards: string[]) => number = () => 0): Command[] {
  const p = state.players[slot];
  const cmds: Command[] = [];
  if (state.phase === 'LOADOUT_LOCK' || state.phase === 'SKILL_ALLOCATION') {
    if (!p.ready) {
      const cls = CLASS_BY_ID[p.classId];
      const pref = cls.nodes.slice().sort((a, b) => NODE_BY_ID[a].tier - NODE_BY_ID[b].tier);
      let points = p.skillPoints;
      const ranks = { ...p.ranks };
      const sim = { ...p, ranks, skillPoints: points, spentByBranch: { ...p.spentByBranch } };
      for (let guard = 0; guard < 40 && points > 0; guard++) {
        const node = pref.find((id) => canAllocate(state, sim, id).ok);
        if (!node) break;
        cmds.push({ type: 'ALLOCATE', slot, nodeId: node });
        const n = NODE_BY_ID[node];
        ranks[node] = (ranks[node] ?? 0) + 1;
        sim.spentByBranch[n.branch] = (sim.spentByBranch[n.branch] ?? 0) + 1;
        points--; sim.skillPoints = points;
      }
      if (points > 0 && !hasSpendableNode(state, sim)) for (let i = 0; i < points; i++) cmds.push({ type: 'MASTERY', slot, choice: 'damage' });
      cmds.push({ type: 'READY', slot, ready: true });
    }
  } else if (state.phase === 'VOTING' && state.offer) {
    const v = state.offer.votes.find((x) => x.slot === slot);
    if (v && !v.locked) cmds.push({ type: 'VOTE', slot, offerId: state.offer.id, seq: voteSeq, cardSlot: pick(state.offer.cards), locked: true });
  } else if (state.phase === 'COMBAT' && p.lifeState === 'alive' && state.roomEvents?.list.length) {
    // room events (roomEvents.ts): a bot takes any unused shrine it passes
    const R2 = ROOM_EVENT_RULES.useRange ** 2;
    const re = state.roomEvents.list.find((e) => e.kind === 'shrine' && !e.used && (e.x - p.x) ** 2 + (e.y - p.y) ** 2 <= R2);
    if (re) cmds.push({ type: 'EVENT', slot, op: 'shrine', id: re.id });
  } else if (state.awaitingDurable) {
    if (slot === 0) cmds.push({ type: 'DURABLE', what: state.awaitingDurable });
  }
  return cmds;
}
