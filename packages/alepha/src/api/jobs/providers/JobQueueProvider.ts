import { $inject, Alepha, z } from "alepha";
import { $queue } from "alepha/queue";
import { JobDispatcher } from "./JobDispatcher.ts";
import { JobProvider } from "./JobProvider.ts";

/**
 * Queue-backed `JobDispatcher` registered by `AlephaApiJobsQueue`.
 *
 * Extends {@link JobDispatcher} and substitutes the default
 * `DirectJobDispatcher` so that `$job.push()` is delivered through
 * `AlephaQueue` (e.g. Cloudflare Queues, Redis, in-memory) instead of
 * being processed in-process.
 *
 * The class is also kept as a `JobQueueProvider` export name for backwards
 * compatibility — it has always been the queue path's entry point.
 */
export class JobQueueProvider extends JobDispatcher {
  public readonly kind = "queue" as const;
  protected readonly alepha = $inject(Alepha);

  // Lazy to avoid the JobProvider ↔ JobDispatcher injection cycle
  // (JobProvider injects JobDispatcher; the queue consumer needs
  // JobProvider to process). Resolved at message-receive time.
  protected jobProviderRef?: JobProvider;
  protected getJobProvider(): JobProvider {
    if (!this.jobProviderRef) {
      this.jobProviderRef = this.alepha.inject(JobProvider);
    }
    return this.jobProviderRef;
  }

  protected readonly queue = $queue({
    name: "api:jobs:dispatch",
    schema: z.object({ jobName: z.text(), executionId: z.text() }),
    handler: async (msg) => {
      await this.getJobProvider().processExecution(
        msg.payload.jobName,
        msg.payload.executionId,
      );
    },
  });

  public async dispatch(jobName: string, executionId: string): Promise<void> {
    await this.queue.push({ jobName, executionId });
  }

  /**
   * Fan-out to a single variadic `queue.push(...payloads)` call so the
   * underlying queue provider can batch the network round-trips when it
   * supports it (Cloudflare Queues, Redis pipelines).
   */
  public override async dispatchMany(
    items: Array<{ jobName: string; executionId: string }>,
  ): Promise<void> {
    if (items.length === 0) return;
    await this.queue.push(...items);
  }

  /**
   * Backwards-compatible alias for {@link dispatch}. Older code paths called
   * `JobQueueProvider.push(jobName, executionId)` directly; new code should
   * go through the `JobDispatcher.dispatch` API.
   */
  public async push(jobName: string, executionId: string): Promise<void> {
    return this.dispatch(jobName, executionId);
  }
}
