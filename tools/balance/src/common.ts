import { CLASSES, contentHash } from '@cursebound/content';
import { botCommands, botInput, createRun, killEnemy, step, type SimEvent, type SimState } from '@cursebound/simulation';

// Shared drivers for the balance tools (harness.ts, stress.ts, replayVerify.ts). Every run is seeded and botted by
// the reference player (simulation bot.ts), so two runs of a tool on the same build print identical numbers.

export const CLASS_IDS = CLASSES.map((c) => c.id);

/** A seeded bot run; `bounty` applies a daily bounty modifier (content bounties.ts). */
export function newRun(classes: string[], seed: string, bounty: string | null = null): SimState {
  return createRun({
    runId: 'bal_' + seed.replace(/[^A-Za-z0-9]/g, '').slice(0, 24), seed, mode: classes.length > 1 ? 'coop' : 'solo', trust: 'local', contentHash: contentHash(),
    roster: classes.map((c, i) => ({ slot: i, profileId: 'p' + i, name: 'P' + i, classId: c })), bounty,
  });
}

/** One tick of the bot party: intermission commands, combat inputs. */
export function botTick(state: SimState, ctx: { seq: number; voteSeq: number }): SimEvent[] {
  const cmds = state.players.flatMap((p) => botCommands(state, p.slot, ctx.voteSeq, () => 0));
  if (cmds.some((c) => c.type === 'VOTE')) ctx.voteSeq++;
  const inputs = state.phase === 'COMBAT' ? state.players.map((p) => botInput(state, p.slot, ++ctx.seq)) : [];
  return step(state, inputs, cmds).events;
}

/**
 * Skip ahead to the COMBAT phase of `round` with instant clears (heroes invulnerable, foes killed outright), the
 * bots still allocating points and voting, so the party arrives with a normal build and Fate history.
 */
export function skipTo(state: SimState, round: number, ctx: { seq: number; voteSeq: number }, theme: string | null = null) {
  for (let i = 0; i < 2_000_000 && state.phase !== 'RESULTS'; i++) {
    if (state.round === round && state.phase === 'COMBAT') break;
    if (theme && state.round < round) state.nextTheme = { round, theme };   // force the target floor's theme (its boss)
    if (state.phase === 'COMBAT') {
      for (const p of state.players) p.iframes = 10;
      for (const e of state.enemies) if (e.state !== 'dying') killEnemy(state, [], e, 0);
    }
    botTick(state, ctx);
  }
  for (const p of state.players) { p.iframes = 0; p.hp = p.maxHp; }
}

export function arg(name: string, def: string): string {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

export const pct = (x: number) => (x * 100).toFixed(0) + '%';
export const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');
export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
