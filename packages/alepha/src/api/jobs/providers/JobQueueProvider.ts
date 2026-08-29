import { $hook, $inject, Alepha, type Infer, z } from "alepha";
import { $logger } from "alepha/logger";
import {
  QueueCodec,
  QueueDelayNotSupportedError,
  QueueProvider,
  WorkerProvider,
} from "alepha/queue";

import { JobDispatcher, type JobDispatchOptions } from "./JobDispatcher.ts";
import { JobProvider } from "./JobProvider.ts";

/**
 * Name of the queue `$job` dispatches through.
 *
 * Kept stable — it is the backend key, so changing it strands any message
 * still in flight across a deploy.
 */
export const JOB_DISPATCH_QUEUE = "api:jobs:dispatch";

/**
 * Wire format of a dispatch message.
 */
export const jobDispatchSchema = z.object({
  jobName: z.text(),
  executionId: z.text(),
});

export type JobDispatchMessage = Infer<typeof jobDispatchSchema>;

/**
 * Queue-backed `JobDispatcher` registered by `AlephaApiJobsQueue`.
 *
 * Extends {@link JobDispatcher} and substitutes the default
 * `DirectJobDispatcher` so that `$job.push()` is delivered through
 * `AlephaQueue` (e.g. Cloudflare Queues, Redis, in-memory) instead of
 * being processed in-process.
 *
 * This talks to `QueueProvider` / `WorkerProvider` directly. The queue is an
 * internal transport under `$job`, not something an application declares.
 */
export class JobQueueProvider extends JobDispatcher {
  public readonly kind = "queue" as const;
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly queueProvider = $inject(QueueProvider);
  protected readonly workerProvider = $inject(WorkerProvider);
  protected readonly codec = $inject(QueueCodec);

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

  /**
   * Registered on `start` (default priority) so it lands before
   * `WorkerProvider`'s own `priority: "last"` start hook boots the loop.
   */
  protected readonly registerConsumer = $hook({
    on: "start",
    handler: () => {
      this.workerProvider.register({
        name: JOB_DISPATCH_QUEUE,
        schema: jobDispatchSchema,
        provider: this.queueProvider,
        handler: async (msg) => {
          await this.getJobProvider().processExecution(
            msg.payload.jobName,
            msg.payload.executionId,
          );
        },
      });
    },
  });

  public async dispatch(
    jobName: string,
    executionId: string,
    options?: JobDispatchOptions,
  ): Promise<void> {
    try {
      await this.queueProvider.push(
        JOB_DISPATCH_QUEUE,
        this.encode({ jobName, executionId }),
        options,
      );
    } catch (e) {
      if (this.fellBackToTimer(e, options, [{ jobName, executionId }])) return;
      throw e;
    }
    this.workerProvider.wakeUp();
  }

  /**
   * One `pushMany` call so backends with a native batch send use a single
   * round-trip (Cloudflare Queues `sendBatch`, chunked at 100). Backends
   * without one fall back to `QueueProvider`'s parallel fan-out.
   */
  public override async dispatchMany(
    items: Array<JobDispatchMessage>,
    options?: JobDispatchOptions,
  ): Promise<void> {
    if (items.length === 0) return;
    try {
      await this.queueProvider.pushMany(
        JOB_DISPATCH_QUEUE,
        items.map((item) => this.encode(item)),
        options,
      );
    } catch (e) {
      if (this.fellBackToTimer(e, options, items)) return;
      throw e;
    }
    this.workerProvider.wakeUp();
  }

  /**
   * A backend that declines a delay is not a failure, it is the contract:
   * declining is what it must do instead of delivering now.
   *
   * So catch that one error and arrange the delay the way a broker-less
   * deployment already would, with the local promoting timer. On Node that
   * gives exact backoff in queue mode with **zero** work on the broker's
   * side, which is why the Redis ZSET tier is a scale optimisation rather
   * than a correctness gap. Where even the timer cannot run, the row is
   * still `scheduled` and the sweep is still the backstop.
   *
   * @returns true when the error was a decline and has been handled.
   */
  protected fellBackToTimer(
    error: unknown,
    options: JobDispatchOptions | undefined,
    items: Array<JobDispatchMessage>,
  ): boolean {
    if (!(error instanceof QueueDelayNotSupportedError)) return false;
    const delayMs = Math.max(0, (options?.delaySeconds ?? 0) * 1000);
    this.log.debug(
      `Queue backend declined a ${options?.delaySeconds}s delay for ${items.length} dispatch(es); falling back to the local promoting timer`,
    );
    for (const item of items) {
      this.getJobProvider().scheduleLocalPromotion(
        item.jobName,
        item.executionId,
        delayMs,
      );
    }
    return true;
  }

  /**
   * Backwards-compatible alias for {@link dispatch}. Older code paths called
   * `JobQueueProvider.push(jobName, executionId)` directly; new code should
   * go through the `JobDispatcher.dispatch` API.
   */
  public async push(jobName: string, executionId: string): Promise<void> {
    return this.dispatch(jobName, executionId);
  }

  /**
   * Envelope is owned by {@link QueueCodec} and kept byte-identical to the
   * one the `$queue` primitive used, so messages already sitting in a
   * backend survive the upgrade.
   */
  protected encode(message: JobDispatchMessage): string {
    return this.codec.encode(jobDispatchSchema, message);
  }
}
