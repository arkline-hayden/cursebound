import { BOUNTY_PERIOD_MS, BOUNTY_POLL_MS, shuffledBountyIds } from '@cursebound/content';
import type { CloudLog } from './log';
import type { CloudBounty, PgAccountStore } from './store';

// The daily bounty's source of truth (online mode). A polled job checks the latest daily_bounties row every
// BOUNTY_POLL_MS and, once it is BOUNTY_PERIOD_MS (24 h) old, rolls a new random modifier that is never the previous
// one. Cloud Run scales to zero (no timer runs while no instance is up), so every bounty read runs the same check
// lazily: the first request after a quiet night still sees a fresh bounty. Every check takes a transaction-scoped
// advisory lock (store.ensureBounty), so the job and concurrent reads, on any number of instances, roll at most once.
// The local authority runs the same job against SQLite for offline play (apps/server/src/bounty.ts).

export interface CloudBountyOptions {
  now?: () => number;
  random?: () => number;
  periodMs?: number;
  pollMs?: number;
}

export class CloudBountyJob {
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly periodMs: number;
  private readonly pollMs: number;

  constructor(private readonly store: PgAccountStore, private readonly log: CloudLog, o: CloudBountyOptions = {}) {
    this.now = o.now ?? Date.now;
    this.random = o.random ?? Math.random;
    this.periodMs = o.periodMs ?? BOUNTY_PERIOD_MS;
    this.pollMs = o.pollMs ?? BOUNTY_POLL_MS;
  }

  /** Start the polled job (check now, then every pollMs; unref'd so it never holds the process open). */
  start() {
    if (this.timer) return;
    const tick = () => { void this.check().catch((err) => this.log.warn('bounty_check_failed', { err: err as Error })); };
    tick();
    this.timer = setInterval(tick, this.pollMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async check(): Promise<{ bounty: CloudBounty; rolled: boolean }> {
    const r = await this.store.ensureBounty({ now: this.now(), periodMs: this.periodMs, candidates: shuffledBountyIds(this.random) });
    if (r.rolled) this.log.info('bounty_rolled', { bountyId: r.bounty.id, modifier: r.bounty.modifierId });
    return r;
  }

  /** The current bounty, checked lazily on every read. */
  async current(): Promise<CloudBounty> {
    return (await this.check()).bounty;
  }

  clock(): number {
    return this.now();
  }
}
