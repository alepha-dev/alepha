import { type Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

/**
 * Waits out the uptime tick a spec's `travel()` fired.
 *
 * The tick saves `lastCheckedAt` midway, then opens or closes the incident
 * and sends its alerts, all under its run lock. A spec that advances the
 * clock as soon as `lastCheckedAt` moves can land the next minute on that
 * lock, and the cron skips that minute for good: on SQLite the tail took
 * microseconds, on a loaded runner against Postgres it did not.
 *
 * Attach it before `alepha.start()`, and call {@link settled} with the
 * spec's clock after each wait on `lastCheckedAt`.
 */
export class UptimeTickWatch {
  protected static readonly watches = new WeakMap<
    DateTimeProvider,
    UptimeTickWatch
  >();

  protected readonly running = new Set<string>();

  public static attach(alepha: Alepha): UptimeTickWatch {
    const watch = new UptimeTickWatch();
    alepha.events.on("job:begin", ({ name, executionId }) => {
      if (name === "uptime.tick") watch.running.add(executionId);
    });
    alepha.events.on("job:end", ({ name, executionId }) => {
      if (name === "uptime.tick") watch.running.delete(executionId);
    });
    UptimeTickWatch.watches.set(alepha.inject(DateTimeProvider), watch);
    return watch;
  }

  /**
   * Resolves once no tick runs on `clock`'s container and the last one
   * released its lock, which happens a few microtasks after `job:end`.
   */
  public static async settled(clock: DateTimeProvider): Promise<void> {
    const watch = UptimeTickWatch.watches.get(clock);
    if (!watch) {
      throw new AlephaError("UptimeTickWatch.attach(alepha) was not called");
    }
    for (;;) {
      if (watch.running.size === 0) {
        await new Promise((resolve) => setImmediate(resolve));
        if (watch.running.size === 0) return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}
