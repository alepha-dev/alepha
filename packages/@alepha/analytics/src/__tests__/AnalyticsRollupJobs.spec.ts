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
  AlephaAnalyticsRollup,
  type AnalyticsDataset,
  AnalyticsProvider,
  AnalyticsRollupJobs,
  MemoryAnalyticsProvider,
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
 *
 * A caller-supplied `provider` substitution has to be applied *before*
 * `.with(AlephaAnalyticsRollup)`, not after: that call eagerly injects
 * `AnalyticsRollupJobs`, whose own `$inject(AnalyticsProvider)` field
 * triggers `AlephaAnalytics`'s own (optional) `AnalyticsProvider` binding —
 * so by the time `.with(AlephaAnalyticsRollup)` returns, `AnalyticsProvider`
 * is already substituted, and a *non*-optional `.with()` after that point
 * throws `TooLateSubstitutionError`.
 */
const makeApp = (provider?: new () => AnalyticsProvider) => {
  let alepha = Alepha.create().with(AlephaOrmPostgres);
  if (provider) {
    alepha = alepha.with({ provide: AnalyticsProvider, use: provider });
  }
  return alepha.with(AlephaAnalyticsRollup);
};

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
    retention: { hot: "1d" },
  });

  public readonly ok = $analytics({
    index: "app",
    dimensions: z.object({ app: z.string() }),
    measures: z.object({ count: z.number() }),
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
    before: string,
  ): Promise<void> {
    if (dataset.name === "broken") {
      throw new AlephaError("simulated rollup failure");
    }
    return super.rollup(dataset, before);
  }
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

  it("warns at boot when a dataset declares retention but AlephaAnalyticsRollup is not imported", async () => {
    // Deliberately no `.with(AlephaAnalyticsRollup)` here — `AnalyticsRetentionGuard`
    // is wired into `AlephaAnalytics` unconditionally, so declaring `Views`
    // (retention.hot set) alone is enough to exercise the check.
    const alepha = Alepha.create();
    alepha.inject(Views);
    await alepha.start();

    const destination = alepha.inject(MemoryDestinationProvider);
    const warned = destination.logs.some(
      (entry) =>
        entry.level === "WARN" &&
        entry.message.includes("views") &&
        entry.message.includes("AlephaAnalyticsRollup"),
    );
    expect(warned).toBe(true);
  });

  it("does not warn once AlephaAnalyticsRollup is imported", async () => {
    const alepha = makeApp();
    alepha.inject(Views);
    await alepha.start();

    const destination = alepha.inject(MemoryDestinationProvider);
    const warned = destination.logs.some(
      (entry) =>
        entry.level === "WARN" &&
        entry.message.includes("AlephaAnalyticsRollup"),
    );
    expect(warned).toBe(false);
  });
});
