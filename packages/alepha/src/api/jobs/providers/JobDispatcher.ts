/**
 * Abstract dispatcher for queued/direct job executions.
 *
 * The default implementation, {@link DirectJobDispatcher}, runs the handler
 * in-process after the caller's `push()` returns — fast and dependency-free.
 *
 * `AlephaApiJobsQueue` substitutes this with `JobQueueProvider`, which
 * publishes the executionId to `AlephaQueue` so a worker pool can consume
 * the work asynchronously.
 *
 * Substitute via DI:
 * ```ts
 * Alepha.create()
 *   .with({ provide: JobDispatcher, use: MyCustomDispatcher })
 *   .with(AlephaApiJobs);
 * ```
 *
 * The `kind` getter is read by the `JobProvider.effectiveMode` accessor
 * and by the admin UI so users can see which dispatcher is currently active.
 */
export abstract class JobDispatcher {
  /**
   * Identifier for this dispatcher's effective mode. Reported to the admin
   * UI so operators can see whether `$job` is running in `queue` or
   * `direct` mode.
   */
  public abstract readonly kind: "queue" | "direct";

  /**
   * Hand off a single execution. The caller's `push()` awaits this so the
   * caller can be sure the dispatch has at least been initiated. Long-running
   * work must NOT be awaited here (use background scheduling instead) — this
   * call should return as quickly as possible.
   */
  public abstract dispatch(jobName: string, executionId: string): Promise<void>;

  /**
   * Optional batch dispatch. The default implementation loops, but
   * dispatchers backed by a real queue should override this to use the
   * provider's batch send (e.g. Cloudflare Queues `sendBatch`).
   */
  public async dispatchMany(
    items: Array<{ jobName: string; executionId: string }>,
  ): Promise<void> {
    for (const item of items) {
      await this.dispatch(item.jobName, item.executionId);
    }
  }
}
