import { $hook, $inject, Alepha, type Infer, z } from "alepha";
import { QueueCodec, QueueProvider, WorkerProvider } from "alepha/queue";
import { JobDispatcher } from "./JobDispatcher.ts";
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

  public async dispatch(jobName: string, executionId: string): Promise<void> {
    await this.queueProvider.push(
      JOB_DISPATCH_QUEUE,
      this.encode({ jobName, executionId }),
    );
    this.workerProvider.wakeUp();
  }

  /**
   * One `pushMany` call so backends with a native batch send use a single
   * round-trip (Cloudflare Queues `sendBatch`, chunked at 100). Backends
   * without one fall back to `QueueProvider`'s parallel fan-out.
   */
  public override async dispatchMany(
    items: Array<JobDispatchMessage>,
  ): Promise<void> {
    if (items.length === 0) return;
    await this.queueProvider.pushMany(
      JOB_DISPATCH_QUEUE,
      items.map((item) => this.encode(item)),
    );
    this.workerProvider.wakeUp();
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
