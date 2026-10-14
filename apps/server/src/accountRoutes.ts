import { cookieTransport, registerAccountRoutes as registerSharedAccountRoutes, type RouteRegistrar } from '@cursebound/accounts';
import { clientAddress } from './auth';
import { HttpError } from './http';
import type { Logger } from './persistence/logger';
import type { Store } from './persistence/types';

// Account API (/api/v1/auth, /account, /players, /builds, /friends): the shared route set from @cursebound/accounts
// with cookie sessions, the SQLite store and finished runs read from the local run history.

interface Deps {
  route: RouteRegistrar;
  store: Store;
  log: Logger;
  assertId: (v: string, what: string) => string;
  registerPerHour: number;
}

export function registerAccountRoutes({ route, store, log, assertId, registerPerHour }: Deps) {
  registerSharedAccountRoutes({
    route, store, log, assertId, registerPerHour,
    transport: cookieTransport,
    clientAddress,
    claimProfiles: true,
    // own runs only: the caller's profile must be a member of the run
    buildFromRun: async (a, b) => {
      const run = await store.getRun(assertId(String(b.runId ?? ''), 'run'));
      if (!run || !run.summaryJson) throw new HttpError(404, 'NOT_FOUND', 'finished run not found');
      const mine = run.members.find((x) => x.profileId === a.account.profileId);
      if (!mine) throw new HttpError(403, 'UNAUTHORIZED', 'you can only save builds from your own runs');
      const slot = typeof b.slot === 'number' ? b.slot : mine.slot;
      const sum = JSON.parse(run.summaryJson) as { players?: { slot: number; classId: string; ranks: Record<string, number>; mastery?: unknown }[]; round?: number };
      const p = sum.players?.find((x) => x.slot === slot);
      if (!p) throw new HttpError(404, 'NOT_FOUND', 'no such player in that run');
      return { player: p, round: sum.round ?? run.round, sourceRunId: run.id };
    },
  });
}
