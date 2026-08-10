import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, expect, it } from "vitest";
// Imported through the module entry, not the primitive/job files directly —
// see the note at the top of `analytics.spec.ts`: `$analytics`'s DI
// auto-wiring depends on `AnalyticsPrimitive` (and, here, `AnalyticsRollupJobs`
// itself) having been tagged with module metadata, which only happens once
// `../index.ts` (where `$module({ ... })` is called) has been evaluated.
import {
  $analytics,
  AlephaAnalyticsRollup,
  AnalyticsRollupJobs,
} from "../index.ts";

/**
 * `AnalyticsRollupJobs` lives in `AlephaAnalyticsRollup`, not
 * `AlephaAnalytics` — see the class doc on `AlephaAnalyticsRollup` in
 * `../index.ts`. `$job` always needs a real `DatabaseProvider` (job
 * execution tracking is never test-substituted), so — exactly like
 * `$job.spec.ts` and `AuditJobs.spec.ts` — this container attaches
 * `AlephaOrmPostgres` explicitly. `AnalyticsProvider` itself is unaffected:
 * `alepha.isTest()` still selects `MemoryAnalyticsProvider` for the datasets
 * below regardless of which ORM driver is attached.
 */
const makeApp = () =>
  Alepha.create().with(AlephaOrmPostgres).with(AlephaAnalyticsRollup);

class Views {
  public readonly views = $analytics({
    index: "app",
    dimensions: z.object({ app: z.string() }),
    measures: z.object({ count: z.number() }),
    retention: { hot: "2d", rollup: "day", cold: "5d" },
  });
}

class Untouched {
  public readonly untouched = $analytics({
    index: "app",
    dimensions: z.object({ app: z.string() }),
    measures: z.object({ count: z.number() }),
  });
}

class Warm {
  public readonly warm = $analytics({
    index: "app",
    dimensions: z.object({ app: z.string() }),
    measures: z.object({ count: z.number() }),
    retention: { hot: "1d" },
  });
}

class Backlog {
  public readonly backlog = $analytics({
    index: "app",
    dimensions: z.object({ app: z.string() }),
    measures: z.object({ count: z.number() }),
    retention: { hot: "1d" },
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

  it("caps how many days one sweep folds", () => {
    expect(AnalyticsRollupJobs.MAX_DAYS_PER_SWEEP).toBe(14);
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

  it("caps a large backlog to MAX_DAYS_PER_SWEEP days, finishing over a later sweep", async () => {
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

    // At most MAX_DAYS_PER_SWEEP days folded in a single sweep, even though
    // every one of the 20 days is well past the 1-day hot window.
    expect(rolledAfterOne.length).toBe(AnalyticsRollupJobs.MAX_DAYS_PER_SWEEP);
    expect(hourlyAfterOne.length).toBe(
      days - AnalyticsRollupJobs.MAX_DAYS_PER_SWEEP,
    );

    const totalAfterOne = await app.backlog.query({
      since: "2000-01-01",
      select: { count: "sum" },
    });
    // Collapsing, never dropping: the grand total survives an incomplete sweep.
    expect(totalAfterOne.rows).toEqual([{ count: expectedTotal }]);

    // The fold is idempotent, so a second sweep resumes from where the first
    // stopped and finishes the backlog without double-counting anything.
    await jobs.sweepNow();

    const afterTwo = await app.backlog.query({
      since: "2000-01-01",
      groupBy: ["hour"],
      select: { count: "sum" },
    });
    expect(afterTwo.rows.every((row) => String(row.hour).length === 10)).toBe(
      true,
    );
    expect(afterTwo.rows).toHaveLength(days);

    const totalAfterTwo = await app.backlog.query({
      since: "2000-01-01",
      select: { count: "sum" },
    });
    expect(totalAfterTwo.rows).toEqual([{ count: expectedTotal }]);
  });
});
