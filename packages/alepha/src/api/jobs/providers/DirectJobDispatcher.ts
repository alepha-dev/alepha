import { $inject, Alepha } from "alepha";
import { BackgroundTaskProvider } from "alepha/background";
import { $logger } from "alepha/logger";
import { JobDispatcher } from "./JobDispatcher.ts";
import { JobProvider } from "./JobProvider.ts";

/**
 * Default `JobDispatcher` for environments without `AlephaApiJobsQueue`.
 *
 * Runs `JobProvider.processExecution` in the background — the caller's
 * `push()` returns immediately while the handler continues to completion
 * in the same process. The DB outbox row is the durability guarantee:
 * if the process dies before the handler finishes, the next sweep tick
 * picks the row up and re-dispatches.
 *
 * Keeping the isolate alive past the HTTP response (Cloudflare Workers) vs.
 * relying on the event loop (Node/Vercel) is delegated to
 * {@link BackgroundTaskProvider.defer} — this dispatcher stays
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

  public async dispatch(jobName: string, executionId: string): Promise<void> {
    this.background.defer(() =>
      this.getJobProvider()
        .processExecution(jobName, executionId)
        .catch((err) => {
          this.log.warn(
            `Direct execution failed for '${jobName}' (sweep will retry)`,
            err,
          );
        }),
    );
  }
}
