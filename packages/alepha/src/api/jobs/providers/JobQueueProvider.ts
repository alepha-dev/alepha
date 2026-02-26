import { $hook, $inject, t } from "alepha";
import { $queue } from "alepha/queue";
import { JobProvider } from "./JobProvider.ts";

// -----------------------------------------------------------------------------------------------------------------

/**
 * Optional queue-backed dispatch for the job system.
 *
 * When registered, `JobProvider` will push work through this queue instead of
 * executing inline. This is the default for long-running (non-serverless) environments.
 * In serverless environments (Cloudflare Workers, Vercel), this provider is typically
 * omitted so jobs execute inline without requiring an external queue resource.
 */
export class JobQueueProvider {
  protected readonly jobProvider = $inject(JobProvider);

  protected readonly queue = $queue({
    name: "_alepha:jobs:dispatch",
    schema: t.object({ jobName: t.text(), executionId: t.text() }),
    handler: async (msg) => {
      await this.jobProvider.processExecution(
        msg.payload.jobName,
        msg.payload.executionId,
      );
    },
  });

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      this.jobProvider.queueDispatch = (jobName, executionId) =>
        this.push(jobName, executionId);
    },
  });

  /**
   * Push a job execution onto the queue for async processing.
   */
  public async push(jobName: string, executionId: string): Promise<void> {
    await this.queue.push({ jobName, executionId });
  }
}
