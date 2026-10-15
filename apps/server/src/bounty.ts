import { BOUNTY_PERIOD_MS, BOUNTY_POLL_MS, shuffledBountyIds } from '@cursebound/content';
import type { Logger } from './persistence/logger';
import type { DailyBounty, Store } from './persistence/store';

// Local daily bounty (offline / local mode; the cloud runs the same job against Postgres, apps/cloud/src/bounty.ts).
// A polled job checks the latest daily_bounties row every BOUNTY_POLL_MS and, once it is BOUNTY_PERIOD_MS old, rolls a
// new random modifier that is never the previous one. Reads run the same check lazily, so the bounty is fresh even
// right after the machine wakes. The roll is one transaction in the single SQLite writer (store.ensureBounty), so two
// checks can never double-roll.

export interface BountyServiceOptions {
  now?: () => number;
  random?: () => number;
  periodMs?: number;
  pollMs?: number;
}

export class BountyService {
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly periodMs: number;
  private readonly pollMs: number;

  constructor(private readonly store: Store, private readonly log: Logger, o: BountyServiceOptions = {}) {
    this.now = o.now ?? Date.now;
    this.random = o.random ?? Math.random;
    this.periodMs = o.periodMs ?? BOUNTY_PERIOD_MS;
    this.pollMs = o.pollMs ?? BOUNTY_POLL_MS;
  }

  /** The polled job: check now, then every pollMs (unref'd, so it never holds the process open). */
  start() {
    if (this.timer) return;
    void this.check().catch((err) => this.log.warn('bounty_check_failed', { err: err as Error }));
    this.timer = setInterval(() => { void this.check().catch((err) => this.log.warn('bounty_check_failed', { err: err as Error })); }, this.pollMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Roll a new bounty if the latest is due (or none exists); returns the current one. */
  async check(): Promise<{ bounty: DailyBounty; rolled: boolean }> {
    const r = await this.store.ensureBounty({ now: this.now(), periodMs: this.periodMs, candidates: shuffledBountyIds(this.random) });
    if (r.rolled) this.log.info('bounty_rolled', { bountyId: r.bounty.id, modifier: r.bounty.modifierId });
    return r;
  }

  /** The current bounty, checked lazily on every read. */
  async current(): Promise<DailyBounty> {
    return (await this.check()).bounty;
  }

  clock(): number {
    return this.now();
  }
}
