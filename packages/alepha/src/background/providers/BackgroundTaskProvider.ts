import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";

/**
 * Runs fire-and-forget work that should outlive the request that scheduled it
 * (sending a welcome email, an audit write, a webhook) without blocking the
 * response.
 *
 * On a long-lived runtime (Node, Vercel) the event loop keeps the promise
 * alive, so the only job here is to detach the task from the caller and never
 * leak an unhandled rejection. On serverless/edge runtimes that freeze the
 * isolate once the response is returned (Cloudflare Workers) the
 * {@link WorkerdBackgroundTaskProvider} variant additionally wraps the task in
 * `executionCtx.waitUntil` - call sites stay platform-agnostic and only ever
 * call {@link defer}.
 *
 * In-flight tasks are tracked and awaited on shutdown (`flush`), so graceful
 * stop, `run({ once })`, and unit tests don't silently drop work.
 */
export class BackgroundTaskProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();

  /** In-flight deferred tasks, awaited on stop. */
  protected readonly pending = new Set<Promise<void>>();

  /**
   * Schedule `task` to run in the background. Returns immediately — the task is
   * detached onto a microtask, so the caller (e.g. an HTTP handler) is never
   * blocked and a synchronous throw inside `task` can't escape into it. Errors
   * are caught and logged.
   */
  public defer(task: () => unknown): void {
    const promise = Promise.resolve()
      .then(task)
      .then(
        () => undefined,
        (error: unknown) => {
          this.log.warn("Background task failed", error as Error);
        },
      );

    this.pending.add(promise);
    void promise.finally(() => {
      this.pending.delete(promise);
    });

    this.keepAlive(promise);
  }

  /**
   * Hook for platform variants to keep the runtime alive until `promise`
   * settles. No-op on long-lived runtimes (the event loop already does). The
   * Cloudflare variant overrides this with `executionCtx.waitUntil`.
   */
  protected keepAlive(_promise: Promise<void>): void {}

  /**
   * Await all in-flight tasks (best-effort). Called on `stop` so shutdown and
   * tests don't drop deferred work.
   */
  public async flush(): Promise<void> {
    await Promise.allSettled(this.pending);
  }

  protected readonly onStop = $hook({
    on: "stop",
    handler: () => this.flush(),
  });
}
