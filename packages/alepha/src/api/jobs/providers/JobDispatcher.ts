/**
 * Abstract dispatcher for queued/direct job executions.
 *
 * The default implementation, {@link DirectJobDispatcher}, runs the handler
 * in-process after the caller's `push()` returns - fast and dependency-free.
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
  public abstract dispatch(
    jobName: string,
    executionId: string,
    options?: JobDispatchOptions,
  ): Promise<void>;

  /**
   * Optional batch dispatch. The default implementation loops, but
   * dispatchers backed by a real queue should override this to use the
   * provider's batch send (e.g. Cloudflare Queues `sendBatch`).
   *
   * `options` applies to the whole batch. `pushMany` groups by delay before
   * calling, so a batch is never a mix.
   */
  public async dispatchMany(
    items: Array<{ jobName: string; executionId: string }>,
    options?: JobDispatchOptions,
  ): Promise<void> {
    for (const item of items) {
      await this.dispatch(item.jobName, item.executionId, options);
    }
  }
}

/**
 * Per-dispatch options.
 */
export interface JobDispatchOptions {
  /**
   * Do not deliver this execution before `delaySeconds` from now.
   *
   * > `delaySeconds` is an optimisation. The outbox row's `scheduledAt` is
   * > the truth, and the sweep is the backstop. A backend that cannot honour
   * > a delay must **decline to enqueue** rather than enqueue immediately.
   *
   * That rule is the entire reason three backends at three capability levels
   * can share one interface with no `supports()` check anywhere in `$job`.
   *
   * "Decline" is not the same as "ignore". For a push transport, ignoring a
   * delay means **delivering now**, and for a retry that is strictly worse
   * than declining: declining leaves the row `scheduled` for the sweep,
   * while delivering now means zero backoff against a downstream that has
   * just failed.
   *
   * What each dispatcher does with it:
   *
   * - `DirectJobDispatcher` arms a local timer that promotes the row and
   *   then dispatches it. Exact on Node. **On Cloudflare Workers a timer
   *   armed after the response never fires**, so direct mode there cannot
   *   honour a delay at all and the retry keeps sweep granularity. Load
   *   `AlephaApiJobsQueue` if that matters.
   * - `JobQueueProvider` passes it to the backend, and falls back to the
   *   same local timer when the backend declines.
   *
   * Whatever happens, the row is `scheduled` with its own `scheduledAt`, so
   * nothing here can lose an execution: the worst case is that it waits for
   * the next sweep tick.
   */
  delaySeconds?: number;
}
