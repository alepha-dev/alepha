import { $hook, Alepha, AlephaError, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { MemoryDestinationProvider } from "alepha/logger";
import { describe, expect, it } from "vitest";

// Through the module entry, so `$analytics` is wired: see `analytics.spec.ts`.
import {
  $analytics,
  type AnalyticsDataset,
  AnalyticsProvider,
  type AnalyticsRow,
  MemoryAnalyticsProvider,
} from "../index.ts";

class Ingest {
  public readonly readings = $analytics({
    index: "deviceId",
    dimensions: z.object({ deviceId: z.string() }),
    measures: z.object({ validations: z.number(), temperature: z.number() }),
    folds: { temperature: ["min", "max", "last"] },
    slots: {
      dimensions: ["deviceId"],
      measures: ["validations", "temperature"],
    },
    buffer: { maxRows: 3, flushMs: 1000 },
  });
}

/**
 * Counts writes, can fail the next `failures` of them, can hold a write
 * open, and tracks how many run at once.
 */
class ProbeAnalyticsProvider extends MemoryAnalyticsProvider {
  public writes: AnalyticsRow[][] = [];
  public failures = 0;
  public inFlight = 0;
  public maxInFlight = 0;
  public hold?: Promise<void>;

  public override async record(
    dataset: AnalyticsDataset,
    rows: AnalyticsRow[],
  ): Promise<void> {
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.hold) await this.hold;
      if (this.failures > 0) {
        this.failures--;
        throw new AlephaError("simulated outage");
      }
      this.writes.push(rows);
      await super.record(dataset, rows);
    } finally {
      this.inFlight--;
    }
  }
}

class FlushEvents {
  public readonly flushed: Array<{ rows: number }> = [];
  public readonly failed: Array<{ rows: number }> = [];

  protected readonly onSuccess = $hook({
    on: "analytics:flush:success",
    handler: (event) => {
      this.flushed.push({ rows: event.rows });
    },
  });

  protected readonly onError = $hook({
    on: "analytics:flush:error",
    handler: (event) => {
      this.failed.push({ rows: event.rows });
    },
  });
}

const boot = async (options: { pause?: boolean } = {}) => {
  const alepha = Alepha.create().with({
    provide: AnalyticsProvider,
    use: ProbeAnalyticsProvider,
  });
  const app = alepha.inject(Ingest);
  const events = alepha.inject(FlushEvents);
  const provider = alepha.inject(ProbeAnalyticsProvider);
  const dateTime = alepha.inject(DateTimeProvider);
  await alepha.start();
  if (options.pause) dateTime.pause();
  const total = async () =>
    (
      await app.readings.query({
        since: "2000-01-01",
        select: { validations: "sum", temperature: ["min", "max", "last"] },
      })
    ).rows;
  return { alepha, app, events, provider, dateTime, total };
};

describe("AnalyticsBuffer", () => {
  it("resolves record() once buffered, and folds every reading of a key across calls", async () => {
    const { app, provider, dateTime, total } = await boot({ pause: true });
    const now = dateTime.nowMillis();

    await app.readings.record({
      deviceId: "d1",
      validations: 1,
      temperature: 20,
      at: now - 1000,
    });
    await app.readings.record({
      deviceId: "d1",
      validations: 2,
      temperature: 25,
      at: now,
    });
    await app.readings.record({ deviceId: "d1", validations: 4, at: now });

    expect(provider.writes).toEqual([]);
    expect(app.readings.bufferDepth()).toBe(1);
    expect(await total()).toEqual([]);

    await app.readings.flush();
    expect(provider.writes).toHaveLength(1);
    expect(provider.writes[0]).toHaveLength(1);
    expect(app.readings.bufferDepth()).toBe(0);
    expect(await total()).toEqual([
      {
        validations: 7,
        temperature_min: 20,
        temperature_max: 25,
        temperature_last: 25,
      },
    ]);
  });

  it("flushes on maxRows distinct keys, not on calls", async () => {
    const { app, provider } = await boot({ pause: true });

    for (const deviceId of ["d1", "d1", "d2", "d2"]) {
      await app.readings.record({ deviceId, validations: 1 });
    }
    expect(provider.writes).toHaveLength(0);

    await app.readings.record({ deviceId: "d3", validations: 1 });
    await app.readings.flush();
    expect(provider.writes.map((rows) => rows.length)).toEqual([3]);
  });

  it("flushes flushMs after the first buffered row", async () => {
    const { app, provider, dateTime } = await boot({ pause: true });

    await app.readings.record({ deviceId: "d1", validations: 1 });
    // Half way: the rest of the timeout is re-armed on the real clock, far
    // longer than the assertion takes.
    await dateTime.travel(500, "milliseconds");
    expect(provider.writes).toHaveLength(0);

    await dateTime.travel(500, "milliseconds");
    await app.readings.flush();
    expect(provider.writes).toHaveLength(1);
  });

  it("flushes what is left on stop", async () => {
    const { alepha, app, provider } = await boot({ pause: true });

    await app.readings.record({ deviceId: "d1", validations: 1 });
    await alepha.stop();

    expect(provider.writes).toHaveLength(1);
  });

  it("never runs two flushes of one dataset at once", async () => {
    const { app, provider } = await boot();
    let release = () => {};
    provider.hold = new Promise((resolve) => {
      release = resolve;
    });

    await app.readings.record({ deviceId: "d1", validations: 1 });
    const first = app.readings.flush();
    // Let the first flush take its rows and reach the held write.
    for (let i = 0; i < 100 && provider.inFlight === 0; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(provider.inFlight).toBe(1);
    await app.readings.record({ deviceId: "d2", validations: 1 });
    const second = app.readings.flush();
    release();
    await Promise.all([first, second]);

    expect(provider.maxInFlight).toBe(1);
    expect(provider.writes.map((rows) => rows.length)).toEqual([1, 1]);
  });

  it("retries a failed flush, then succeeds and emits analytics:flush:success", async () => {
    const { app, provider, events } = await boot();
    provider.failures = 2;

    await app.readings.record({ deviceId: "d1", validations: 1 });
    await app.readings.flush();

    expect(provider.writes).toHaveLength(1);
    expect(events.flushed).toEqual([{ rows: 1 }]);
    expect(events.failed).toEqual([]);
  });

  it("drops a batch after every attempt fails, logs it and never re-merges it", async () => {
    const { alepha, app, provider, events, total } = await boot();
    const logs = alepha.inject(MemoryDestinationProvider);
    provider.failures = 3;

    await app.readings.record({ deviceId: "d1", validations: 1 });
    await app.readings.flush();

    expect(events.failed).toEqual([{ rows: 1 }]);
    expect(
      logs.logs.some(
        (entry) =>
          entry.level === "ERROR" &&
          entry.message.includes("Dropped 1 buffered row(s)"),
      ),
    ).toBe(true);
    expect(app.readings.bufferDepth()).toBe(0);

    await app.readings.record({ deviceId: "d1", validations: 2 });
    await app.readings.flush();
    expect(await total()).toEqual([
      expect.objectContaining({ validations: 2 }),
    ]);
  });

  it("writes straight through, with an info log, on a backend that already batches", async () => {
    class BatchingAnalyticsProvider extends MemoryAnalyticsProvider {
      public override readonly fireAndForget = true;
    }
    const alepha = Alepha.create().with({
      provide: AnalyticsProvider,
      use: BatchingAnalyticsProvider,
    });
    const app = alepha.inject(Ingest);
    const logs = alepha.inject(MemoryDestinationProvider);
    await alepha.start();

    await app.readings.record({ deviceId: "d1", validations: 1 });

    expect(app.readings.bufferDepth()).toBe(0);
    const result = await app.readings.query({
      since: "2000-01-01",
      select: { validations: "sum" },
    });
    expect(result.rows).toEqual([{ validations: 1 }]);
    expect(
      logs.logs.some((entry) => entry.message.includes("buffer, ignored")),
    ).toBe(true);
  });
});
