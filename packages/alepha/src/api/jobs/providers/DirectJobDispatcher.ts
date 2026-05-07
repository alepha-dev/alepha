import { $inject, Alepha } from "alepha";
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
 * **Cloudflare Workers** — when an `executionCtx.waitUntil` is available
 * in the alepha store at `cloudflare.waitUntil`, the dispatch wraps the
 * background promise with `waitUntil` so the runtime keeps the isolate
 * alive past the HTTP response. Without this, the handler would be
 * terminated when the response is returned and only the next sweep
 * (every 5 min by default) would re-dispatch.
 *
 * **Vercel / single-Node** — on long-running runtimes the event loop
 * keeps the promise alive naturally; no special wiring is required.
 */
export class DirectJobDispatcher extends JobDispatcher {
  public readonly kind = "direct" as const;

  protected readonly alepha = $inject(Alepha);
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
    const promise = this.getJobProvider()
      .processExecution(jobName, executionId)
      .catch((err) => {
        this.log.warn(
          `Direct execution failed for '${jobName}' (sweep will retry)`,
          err,
        );
      });

    // Cloudflare Workers: keep the isolate alive past the HTTP response so
    // the handler actually finishes. Outside CF this read returns undefined
    // and we fall through to plain fire-and-track.
    const waitUntil = this.alepha.store.get("cloudflare.waitUntil") as
      | ((p: Promise<unknown>) => void)
      | undefined;
    if (typeof waitUntil === "function") {
      try {
        waitUntil(promise);
      } catch (e) {
        // The runtime may reject waitUntil if called outside a request scope.
        // Promise still runs; just log.
        this.log.debug(
          "waitUntil rejected — falling back to fire-and-track",
          e,
        );
      }
    }
  }
}
