import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";

/**
 * Runs fire-and-forget work that should outlive the request that scheduled it
 * (sending a welcome email, an audit write, a webhook) without blocking the
 * response.
 *
 * On a long-lived runtime (Node, Bun) the event loop keeps the promise
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

  /**
   * In-flight deferred tasks, awaited on stop.
   */
  protected readonly pending = new Set<Promise<void>>();

  /**
   * Schedule `task` to run in the background. Returns immediately: the task is
   * detached onto a microtask, so it starts at the caller's next `await`, often
   * before the response is sent, and a synchronous throw inside `task` can't
   * escape into the caller. It shares the thread with everything else, so CPU
   * work in `task` blocks until it yields. Errors are caught and logged.
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
   * How many rounds one {@link flush} call waits through. A task may defer a
   * follow-up, which may defer another: each round awaits what is pending at
   * that moment. The bound is per call, not per chain of tasks: tasks deferred
   * by anything else while `flush` waits use up rounds too.
   *
   * A count of rounds, not a deadline: `stop` already gives its hooks one,
   * and `flush` called directly has never cut a slow task short. What is left
   * to guard against is a task that defers itself again every time.
   */
  protected readonly maxFlushRounds: number = 10;

  /**
   * Await all in-flight tasks (best-effort), those deferred by a task that was
   * itself being awaited included. Called on `stop` so shutdown and tests don't
   * drop deferred work.
   *
   * Each call gives up after {@link maxFlushRounds} rounds, with a warning,
   * when tasks are still being deferred, by a chain that never ends or by
   * steady traffic on a live server: stop must end.
   */
  public async flush(): Promise<void> {
    for (let round = 0; this.pending.size > 0; round++) {
      if (round >= this.maxFlushRounds) {
        this.log.warn(
          `Background tasks were still being deferred after ${this.maxFlushRounds} rounds, ${this.pending.size} not awaited`,
        );
        return;
      }
      await Promise.allSettled(this.pending);
    }
  }

  protected readonly onStop = $hook({
    on: "stop",
    handler: () => this.flush(),
  });
}
