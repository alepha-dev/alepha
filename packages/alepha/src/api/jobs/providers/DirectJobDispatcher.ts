import { $inject, Alepha } from "alepha";
import { BackgroundTaskProvider } from "alepha/background";
import { $logger } from "alepha/logger";
import { jobConfig } from "../schemas/jobConfigAtom.ts";
import { JobDispatcher } from "./JobDispatcher.ts";
import { JobProvider } from "./JobProvider.ts";

/**
 * Default `JobDispatcher` for environments without `AlephaApiJobsQueue`.
 *
 * Runs `JobProvider.processExecution` in the background - the caller's
 * `push()` returns immediately while the handler continues to completion
 * in the same process. The DB outbox row is the durability guarantee:
 * if the process dies before the handler finishes, the next sweep tick
 * picks the row up and re-dispatches.
 *
 * Keeping the isolate alive past the HTTP response (Cloudflare Workers) vs.
 * relying on the event loop (Node/Vercel) is delegated to
 * {@link BackgroundTaskProvider.defer} - this dispatcher stays
 * platform-agnostic. The DB outbox row remains the durability guarantee: if
 * the process dies mid-handler, the next sweep re-dispatches.
 */
export class DirectJobDispatcher extends JobDispatcher {
  public readonly kind = "direct" as const;

  protected readonly alepha = $inject(Alepha);
  protected readonly background = $inject(BackgroundTaskProvider);
  protected readonly log = $logger();

  // Lazy: resolved on first dispatch to break the JobProvider ↔ Dispatcher
  // injection cycle (JobProvider injects JobDispatcher to dispatch; we need
  // JobProvider to actually run executions).
  protected jobProviderRef?: JobProvider;
  protected getJobProvider(): JobProvider {
    if (!this.jobProviderRef) {
      this.jobProviderRef = this.alepha.inject(JobProvider);
    }
    return this.jobProviderRef;
  }

  /**
   * Executions accepted but not started yet.
   *
   * Unbounded on purpose: an entry is two strings, and dropping one would lose
   * a dispatch the caller was told had been accepted. The bound that matters is
   * on *concurrency*, below. If the process dies with items still queued, the
   * outbox rows are untouched and the next sweep re-dispatches them — which is
   * the same guarantee that already covered a handler dying mid-run.
   */
  protected readonly pending: Array<[jobName: string, executionId: string]> =
    [];

  /** Workers currently pulling from {@link pending}. */
  protected active = 0;

  /**
   * Accept an execution and return immediately.
   *
   * Previously this deferred `processExecution` per call with nothing in
   * between, so a `pushMany` of a few thousand notifications started a few
   * thousand handlers at once and took the database pool down with it. Now the
   * work is queued and drained by a bounded pool.
   */
  public async dispatch(jobName: string, executionId: string): Promise<void> {
    this.pending.push([jobName, executionId]);
    this.ensureWorkers();
  }

  /**
   * Top the pool up to what the queue currently justifies.
   *
   * Called on every dispatch rather than once per drain cycle: a `pushMany`
   * enqueues one at a time, so a pool sized from the queue length at the first
   * dispatch would be a pool of one, and the whole blast would run serially —
   * bounded, but pointlessly slow.
   */
  protected ensureWorkers(): void {
    const limit = Math.max(
      1,
      this.alepha.store.get(jobConfig).directMaxConcurrency,
    );
    while (this.active < Math.min(limit, this.pending.length)) {
      this.active++;
      // One deferred task per worker, so at most `limit` of them — not one per
      // execution. On Cloudflare the isolate is held open by `waitUntil`, and
      // handing it thousands of separate promises is its own problem.
      this.background.defer(() => this.worker());
    }
  }

  /** Pulls until the queue is empty. Never rejects — a failed run is logged. */
  protected async worker(): Promise<void> {
    try {
      for (;;) {
        const next = this.pending.shift();
        if (!next) {
          return;
        }
        const [jobName, executionId] = next;
        try {
          await this.getJobProvider().processExecution(jobName, executionId);
        } catch (err) {
          this.log.warn(
            `Direct execution failed for '${jobName}' (sweep will retry)`,
            err,
          );
        }
      }
    } finally {
      this.active--;
      // A dispatch that landed between this worker's last empty `shift()` and
      // here would otherwise wait for the next unrelated dispatch to revive
      // the pool.
      if (this.pending.length > 0) {
        this.ensureWorkers();
      }
    }
  }
}
