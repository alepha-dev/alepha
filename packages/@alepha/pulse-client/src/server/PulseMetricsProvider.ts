import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { PulseSinkProvider } from "./PulseSinkProvider.ts";

/**
 * Samples what the process knows about itself, on the sink's interval.
 *
 * Five series, chosen because every runtime can produce them and none of them
 * needs to know what the app does: memory, event-loop health, and how much work
 * is going through. Custom series are deliberately absent — each one would need
 * a unit, a meaning and a retention policy, which is a metrics product rather
 * than a heartbeat.
 *
 * **Sampled on request, not on a timer.** A `setInterval` does not survive a
 * request on workerd, and on a server it would keep a process alive that was
 * trying to exit. Checking the clock when a request comes through costs
 * nothing, and an app with no traffic has nothing to report anyway — its
 * silence is what tells the sink it is idle.
 */
export class PulseMetricsProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly sink = $inject(PulseSinkProvider);

  protected startedAt = 0;
  protected lastSampleAt = 0;
  /** Requests since the last sample, and their durations. */
  protected reqCount = 0;
  protected durations: number[] = [];
  /**
   * When each in-flight request began.
   *
   * A `WeakMap` because the key is the request object itself: nothing here
   * keeps a request alive past its response, which a `Map` keyed by id would.
   * `ServerRequest` carries no timestamp of its own.
   */
  protected readonly requestStarts = new WeakMap<object, number>();

  protected readonly boot = $hook({
    on: "start",
    handler: () => {
      this.startedAt = this.dateTime.nowMillis();
      this.lastSampleAt = this.startedAt;
    },
  });

  protected readonly onRequest = $hook({
    on: "server:onRequest",
    handler: ({ request }) => {
      this.requestStarts.set(request as object, this.dateTime.nowMillis());
    },
  });

  /**
   * Counts one request and, when the interval has elapsed, hands a batch to
   * the sink provider.
   */
  protected readonly onResponse = $hook({
    on: "server:onResponse",
    handler: async ({ request }) => {
      if (this.alepha.isBrowser()) return;

      this.reqCount++;
      const started = this.requestStarts.get(request as object);
      if (started !== undefined) {
        this.durations.push(this.dateTime.nowMillis() - started);
        this.requestStarts.delete(request as object);
      }

      // Refreshed here, not only when something is ingested. An app with no
      // errors and no browser traffic never calls `ingest`, so it would never
      // learn its appetite — and since metrics are what would trigger the
      // ingest, it would stay on the default forever. The fetch is TTL-guarded,
      // so this costs one request a minute at most.
      await this.sink.refreshConfig();

      const now = this.dateTime.nowMillis();
      if (now - this.lastSampleAt < this.sink.metricsIntervalSec() * 1000) {
        return;
      }
      this.lastSampleAt = now;
      await this.sample(now);
    },
  });

  /**
   * Builds one batch and resets the window.
   *
   * Percentiles are computed over the window rather than kept as a running
   * average: an average request duration hides exactly the requests worth
   * seeing.
   */
  protected async sample(now: number): Promise<void> {
    const memory = process.memoryUsage?.();
    const at = now;
    const metrics = [
      ...(memory
        ? [
            { series: "rss" as const, value: memory.rss, at },
            { series: "heapUsed" as const, value: memory.heapUsed, at },
          ]
        : []),
      { series: "reqCount" as const, value: this.reqCount, at },
      {
        series: "reqDurationP95" as const,
        value: percentile(this.durations, 0.95),
        at,
      },
    ];

    this.reqCount = 0;
    this.durations = [];

    await this.sink.ingest({
      metrics,
      heartbeat: {
        uptimeSec: Math.round((now - this.startedAt) / 1000),
      },
    });
  }
}

/**
 * Nearest-rank percentile. Returns 0 for an empty window, which reads correctly
 * as "no requests" on a chart.
 */
const percentile = (values: number[], p: number): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, index)];
};
