import { $inject, t } from "alepha";
import { $queue } from "alepha/queue";
import { JobProvider } from "./JobProvider.ts";

/**
 * Plumbs outbox-style dispatch through `AlephaQueue`.
 *
 * Registered only when the app imports `AlephaApiJobsQueue`. Sets
 * `JobProvider.queueDispatch` eagerly at instantiation so queue-mode jobs
 * can dispatch regardless of start-hook ordering.
 */
export class JobQueueProvider {
  protected readonly jobProvider = $inject(JobProvider);

  protected readonly queue = $queue({
    name: "api:jobs:dispatch",
    schema: t.object({ jobName: t.text(), executionId: t.text() }),
    handler: async (msg) => {
      await this.jobProvider.processExecution(
        msg.payload.jobName,
        msg.payload.executionId,
      );
    },
  });

  constructor() {
    // Install the dispatcher immediately — before any start hook runs,
    // so JobProvider can validate presence and queue-mode push works
    // from any lifecycle point.
    this.wireDispatcher();
  }

  protected wireDispatcher(): void {
    // `$inject` is resolved by the time constructor runs; assignment is safe.
    this.jobProvider.queueDispatch = (jobName, executionId) =>
      this.push(jobName, executionId);
  }

  public async push(jobName: string, executionId: string): Promise<void> {
    await this.queue.push({ jobName, executionId });
  }
}
