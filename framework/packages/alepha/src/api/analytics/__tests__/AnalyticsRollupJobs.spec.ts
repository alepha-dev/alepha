import { Alepha, AlephaError, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { MemoryDestinationProvider } from "alepha/logger";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, expect, it } from "vitest";

// Imported through the module entry, not the primitive/job files directly —
// see the note at the top of `analytics.spec.ts`: `$analytics`'s DI
// auto-wiring depends on `AnalyticsPrimitive` (and, here, `AnalyticsRollupJobs`
// itself) having been tagged with module metadata, which only happens once
// `../index.ts` (where `$module({ ... })` is called) has been evaluated.
import {
  $analytics,
  AlephaApiAnalyticsRollup,
  type AnalyticsDataset,
  AnalyticsProvider,
  AnalyticsRollupJobs,
  MemoryAnalyticsProvider,
} from "../index.ts";

/**
 * `AnalyticsRollupJobs` lives in `AlephaApiAnalyticsRollup`, not
 * `AlephaApiAnalytics` — see the class doc on `AlephaApiAnalyticsRollup` in
 * `../index.ts`. `$job` always needs a real `DatabaseProvider` (job
 * execution tracking is never test-substituted), so — exactly like
 * `$job.spec.ts` and `AuditJobs.spec.ts` — this container attaches
 * `AlephaOrmPostgres` explicitly. `AnalyticsProvider` itself is unaffected:
 * `alepha.isTest()` still selects `MemoryAnalyticsProvider` for the datasets
 * below regardless of which ORM driver is attached.
 *
 * A caller-supplied `provider` substitution has to be applied *before*
 * `.with(AlephaApiAnalyticsRollup)`, not after: that call eagerly injects
 * `AnalyticsRollupJobs`, whose own `$inject(AnalyticsProvider)` field
 * triggers `AlephaApiAnalytics`'s own (optional) `AnalyticsProvider` binding —
 * so by the time `.with(AlephaApiAnalyticsRollup)` returns, `AnalyticsProvider`
 * is already substituted, and a *non*-optional `.with()` after that point
 * throws `TooLateSubstitutionError`.
 */
const makeApp = (provider?: new () => AnalyticsProvider) => {
  let alepha = Alepha.create().with(AlephaOrmPostgres);
  if (provider) {
    alepha = alepha.with({ provide: AnalyticsProvider, use: provider });
  }
  return alepha.with(AlephaApiAnalyticsRollup);
};

class Views {
  public readonly views = $analytics({
    index: "app",
    dimensions: z.object({ app: z.string() }),
    measures: z.object({ count: z.number() }),
    slots: { dimensions: ["app"], measures: ["count"] },
    retention: { hot: "2d", rollup: "day", cold: "5d" },
  });
}

class Untouched {
  public readonly untouched = $analytics({
    index: "app",
    dimensions: z.object({ app: z.string() }),
    measures: z.object({ count: z.number() }),
    slots: { dimensions: ["app"], measures: ["count"] },
  });
}

class Warm {
  public readonly warm = $analytics({
    index: "app",
    dimensions: z.object({ app: z.string() }),
    measures: z.object({ count: z.number() }),
    slots: { dimensions: ["app"], measures: ["count"] },
    retention: { hot: "1d" },
  });
}

class Backlog {
  public readonly backlog = $analytics({
    index: "app",
    dimensions: z.object({ app: z.string() }),
    measures: z.object({ count: z.number() }),
    slots: { dimensions: ["app"], measures: ["count"] },
    retention: { hot: "1d" },
  });
}

/**
 * `broken` declared before `ok` — primitive registration order follows
 * class-field declaration order, and the isolation test needs the failing
 * dataset to be swept *first* to prove it does not block the one after it.
 */
class TwoDatasets {
  public readonly broken = $analytics({
    index: "app",
    dimensions: z.object({ app: z.string() }),
    measures: z.object({ count: z.number() }),
    slots: { dimensions: ["app"], measures: ["count"] },
    retention: { hot: "1d" },
  });

  public readonly ok = $analytics({
    index: "app",
    dimensions: z.object({ app: z.string() }),
    measures: z.object({ count: z.number() }),
    slots: { dimensions: ["app"], measures: ["count"] },
    retention: { hot: "1d" },
  });
}

/**
 * Real `MemoryAnalyticsProvider` behaviour for every dataset except
 * `"broken"`, which always throws from `rollup()` — service substitution
 * standing in for "a provider failure hit this one dataset," rather than
 * `vi.spyOn`.
 */
class FlakyAnalyticsProvider extends MemoryAnalyticsProvider {
  public override async rollup(
    dataset: AnalyticsDataset,
    fromTier: number,
    before: string,
  ): Promise<void> {
    if (dataset.name === "broken") {
      throw new AlephaError("simulated rollup failure");
    }
    return super.rollup(dataset, fromTier, before);
  }
}

class Telemetry {
  public readonly telemetry = $analytics({
    index: "deviceId",
    resolution: "1m",
    dimensions: z.object({ deviceId: z.string() }),
    measures: z.object({ validations: z.number() }),
    slots: { dimensions: ["deviceId"], measures: ["validations"] },
    retention: [
      { resolution: "1m", keep: "2h" },
      { resolution: "1h", keep: "2d" },
      { resolution: "1d", keep: "5d" },
    ],
  });
}

describe("AnalyticsRollupJobs", () => {
  it("folds hours past the hot window into days without changing the total", async () => {
    const alepha = makeApp();
    const app = alepha.inject(Views);
    const jobs = alepha.inject(AnalyticsRollupJobs);
    const dateTime = alepha.inject(DateTimeProvider);
    await alepha.start();

    dateTime.pause();
    // 3 days old: past the 2-day hot window (so it rolls) but inside the
    // 5-day cold window (so it survives the prune pass in the same sweep —
    // a fixed calendar date here would eventually drift past `cold` too and
    // get deleted outright, which is exactly the bug this once had).
    const day = dateTime.now().subtract(3, "day").toISOString().slice(0, 10);
    await app.views.recordMany([
      { app: "a", count: 2, hour: `${day}T10` },
      { app: "a", count: 3, hour: `${day}T11` },
    ]);

    await jobs.sweepNow();

    const total = await app.views.query({
      since: "2000-01-01",
      select: { count: "sum" },
    });
    expect(total.rows).toEqual([{ count: 5 }]);

    const byBucket = await app.views.query({
      since: "2000-01-01",
      groupBy: ["hour"],
      select: { count: "sum" },
    });
    expect(byBucket.rows).toEqual([{ hour: day, count: 5 }]);
  });

  it("walks a minute, hour, day chain finest first, then prunes the last tier", async () => {
    const alepha = makeApp();
    const app = alepha.inject(Telemetry);
    const jobs = alepha.inject(AnalyticsRollupJobs);
    const dateTime = alepha.inject(DateTimeProvider);
    await alepha.start();
    dateTime.pause();

    const at = dateTime.nowMillis() - 30 * 60 * 1000;
    await app.telemetry.recordMany([
      { deviceId: "d1", validations: 2, at },
      { deviceId: "d1", validations: 3, at },
    ]);
    const buckets = async () =>
      (
        await app.telemetry.query({
          since: "2000-01-01",
          groupBy: ["minute"],
          select: { validations: "sum" },
        })
      ).rows;

    // `travel()` also fires the sweep's cron; only the end state is asserted.
    await dateTime.travel(3, "hours");
    await jobs.sweepNow();
    expect(await buckets()).toEqual([
      { minute: new Date(at).toISOString().slice(0, 13), validations: 5 },
    ]);

    await dateTime.travel(3, "days");
    await jobs.sweepNow();
    expect(await buckets()).toEqual([
      { minute: new Date(at).toISOString().slice(0, 10), validations: 5 },
    ]);

    await dateTime.travel(10, "days");
    await jobs.sweepNow();
    expect(await buckets()).toEqual([]);
  });

  it("caps how many source buckets one sweep folds: 36, from the #Q2751 benchmark", () => {
    expect(AnalyticsRollupJobs.MAX_BUCKETS_PER_SWEEP).toBe(36);
  });

  it("leaves a dataset with no retention entirely untouched", async () => {
    const alepha = makeApp();
    const app = alepha.inject(Untouched);
    const jobs = alepha.inject(AnalyticsRollupJobs);
    const dateTime = alepha.inject(DateTimeProvider);
    await alepha.start();

    dateTime.pause();
    await app.untouched.record({
      app: "a",
      count: 1,
      hour: "2020-01-01T10",
    });

    await jobs.sweepNow();

    const byBucket = await app.untouched.query({
      since: "2000-01-01",
      groupBy: ["hour"],
      select: { count: "sum" },
    });
    // Still hour-precision and still present: no `retention.hot` means the
    // sweep skips this dataset entirely, rather than falling back to some
    // default window.
    expect(byBucket.rows).toEqual([{ hour: "2020-01-01T10", count: 1 }]);
  });

  it("rolls up without pruning when a dataset declares hot but no cold", async () => {
    const alepha = makeApp();
    const app = alepha.inject(Warm);
    const jobs = alepha.inject(AnalyticsRollupJobs);
    const dateTime = alepha.inject(DateTimeProvider);
    await alepha.start();

    dateTime.pause();
    await app.warm.record({ app: "a", count: 1, hour: "2020-01-01T10" });

    await jobs.sweepNow();

    const byBucket = await app.warm.query({
      since: "2000-01-01",
      groupBy: ["hour"],
      select: { count: "sum" },
    });
    // Rolled to day precision (proves the hot pass ran) but still present —
    // no `retention.cold` means nothing ever deletes it.
    expect(byBucket.rows).toEqual([{ hour: "2020-01-01", count: 1 }]);
  });

  it("caps a large backlog of an hour tier, finishing over later sweeps", async () => {
    const alepha = makeApp();
    const app = alepha.inject(Backlog);
    const jobs = alepha.inject(AnalyticsRollupJobs);
    const dateTime = alepha.inject(DateTimeProvider);
    await alepha.start();

    dateTime.pause();

    const days = 20;
    await app.backlog.recordMany(
      Array.from({ length: days }, (_, i) => ({
        app: "a",
        count: i + 1,
        hour: `2020-01-${String(i + 1).padStart(2, "0")}T10`,
      })),
    );
    const expectedTotal = ((1 + days) * days) / 2;

    await jobs.sweepNow();

    const afterOne = await app.backlog.query({
      since: "2000-01-01",
      groupBy: ["hour"],
      select: { count: "sum" },
    });
    const rolledAfterOne = afterOne.rows.filter(
      (row) => String(row.hour).length === 10,
    );
    const hourlyAfterOne = afterOne.rows.filter(
      (row) => String(row.hour).length === 13,
    );

    // 36 hours past the oldest bucket (01-01T10) is 01-02T22, floored to
    // whole days: one day folds, although all 20 are past the 1-day window.
    expect(rolledAfterOne.length).toBe(1);
    expect(hourlyAfterOne.length).toBe(days - 1);

    const totalAfterOne = await app.backlog.query({
      since: "2000-01-01",
      select: { count: "sum" },
    });
    // Collapsing, never dropping: the grand total survives an incomplete sweep.
    expect(totalAfterOne.rows).toEqual([{ count: expectedTotal }]);

    // The fold is idempotent, so each later sweep resumes from where the
    // last stopped and the backlog drains without double-counting anything.
    for (let sweep = 1; sweep < days; sweep++) await jobs.sweepNow();

    const drained = await app.backlog.query({
      since: "2000-01-01",
      groupBy: ["hour"],
      select: { count: "sum" },
    });
    expect(drained.rows.every((row) => String(row.hour).length === 10)).toBe(
      true,
    );
    expect(drained.rows).toHaveLength(days);

    const totalDrained = await app.backlog.query({
      since: "2000-01-01",
      select: { count: "sum" },
    });
    expect(totalDrained.rows).toEqual([{ count: expectedTotal }]);
  });

  it("does not let one dataset's failure block the rest of the sweep", async () => {
    const alepha = makeApp(FlakyAnalyticsProvider);
    const app = alepha.inject(TwoDatasets);
    const jobs = alepha.inject(AnalyticsRollupJobs);
    const dateTime = alepha.inject(DateTimeProvider);
    await alepha.start();

    dateTime.pause();
    await app.broken.record({ app: "a", count: 1, hour: "2020-01-01T10" });
    await app.ok.record({ app: "a", count: 1, hour: "2020-01-01T10" });

    // sweepNow() itself must not reject just because one dataset's rollup
    // threw — the try/catch inside the loop absorbs it.
    await expect(jobs.sweepNow()).resolves.toBeUndefined();

    const okResult = await app.ok.query({
      since: "2000-01-01",
      groupBy: ["hour"],
      select: { count: "sum" },
    });
    // "ok" is declared *after* "broken", so this is only rolled if the loop
    // actually continued past the earlier failure.
    expect(okResult.rows).toEqual([{ hour: "2020-01-01", count: 1 }]);

    const brokenResult = await app.broken.query({
      since: "2000-01-01",
      groupBy: ["hour"],
      select: { count: "sum" },
    });
    // Unchanged: the throw happened before any row was touched, and no
    // partial state should leak from a failed attempt either.
    expect(brokenResult.rows).toEqual([{ hour: "2020-01-01T10", count: 1 }]);
  });

  it("warns at boot when a dataset declares retention but AlephaApiAnalyticsRollup is not imported", async () => {
    // Deliberately no `.with(AlephaApiAnalyticsRollup)` here — `AnalyticsRetentionGuard`
    // is wired into `AlephaApiAnalytics` unconditionally, so declaring `Views`
    // (retention.hot set) alone is enough to exercise the check.
    const alepha = Alepha.create();
    alepha.inject(Views);
    await alepha.start();

    const destination = alepha.inject(MemoryDestinationProvider);
    const warned = destination.logs.some(
      (entry) =>
        entry.level === "WARN" &&
        entry.message.includes("views") &&
        entry.message.includes("AlephaApiAnalyticsRollup"),
    );
    expect(warned).toBe(true);
  });

  it("does not warn once AlephaApiAnalyticsRollup is imported", async () => {
    const alepha = makeApp();
    alepha.inject(Views);
    await alepha.start();

    const destination = alepha.inject(MemoryDestinationProvider);
    const warned = destination.logs.some(
      (entry) =>
        entry.level === "WARN" &&
        entry.message.includes("AlephaApiAnalyticsRollup"),
    );
    expect(warned).toBe(false);
  });
});
