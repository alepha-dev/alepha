import { $inject, Alepha } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { AnalyticsBuckets } from "../planner/AnalyticsBuckets.ts";
import { $analytics } from "../primitives/$analytics.ts";
import { AnalyticsProvider } from "../providers/AnalyticsProvider.ts";
import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";

/**
 * Keeps every declared dataset inside its retention window.
 *
 * Folds hour buckets past `retention.hot` into day buckets, then deletes
 * rolled rows past `retention.cold`. Both passes **collapse rather than
 * delete** within the hot-to-rolled step, so no total the UI shows ever
 * changes — only the resolution of the time axis does.
 *
 * Modelled on `apps/lore`'s `SigilJobs`, the Worker-tested prior art for this
 * exact shape (hourly sweep, capped backlog, fold-not-delete). It cannot
 * reuse that class's mechanism directly, though: `SigilJobs` holds
 * `$repository` handles onto two known tables and scans them with SQL this
 * job has no equivalent for — datasets here are declared at arbitrary call
 * sites, and the only surface this job is allowed to use is the abstract
 * {@link AnalyticsProvider} seam (`register`/`record`/`query`/`rollup`/`prune`),
 * which deliberately hides which tier a row lives in (see that class's own
 * doc). {@link rollupBoundary} works around that: a bucket's own string
 * *length* — `"YYYY-MM-DD"` (10 chars, already rolled) vs.
 * `"YYYY-MM-DDTHH"` (13 chars, still raw) — is the one signal `query()`
 * exposes without either provider having to break its tiering abstraction.
 *
 * The per-sweep cap ({@link MAX_DAYS_PER_SWEEP}) is not tuning. Neither
 * shipped provider's `rollup()` self-limits by how far back `before` reaches
 * — `OrmAnalyticsProvider.rollup()` is one `SELECT … GROUP BY` over every row
 * older than the boundary it is given, and `MemoryAnalyticsProvider.rollup()`
 * is one pass over its whole array — so a table nobody has ever pruned could
 * otherwise hand either implementation an arbitrary backlog to fold in a
 * single call. This runs on a Worker with a wall-clock and a memory ceiling.
 * Chewing through history over several sweeps costs nothing because the fold
 * is idempotent: the next sweep simply resumes from whatever is still oldest.
 */
export class AnalyticsRollupJobs {
  /**
   * Most days one sweep will advance the rollup boundary by, for a single
   * dataset. See the class doc for why this is a correctness bound, not a
   * performance knob.
   */
  public static readonly MAX_DAYS_PER_SWEEP = 14;

  /**
   * A `since` boundary older than any real bucket, for the resume-point
   * lookup in {@link rollupBoundary} — the same sentinel
   * `WaeAnalyticsProvider.EPOCH_DAY` uses for its own "from the beginning"
   * query, redeclared here because each class treats it as a private
   * implementation detail rather than a shared export.
   */
  protected static readonly EPOCH_DAY = "1970-01-01";

  /**
   * Widest number of distinct buckets {@link rollupBoundary} scans
   * client-side to find the oldest one still at hour precision.
   *
   * Unlike {@link MAX_DAYS_PER_SWEEP}, this is not a fold-work bound: each
   * row here is one `(bucket, count)` pair out of a `GROUP BY`, a few dozen
   * bytes, never a raw event row, so scanning a thousand of them is a
   * rounding error in memory terms. It exists for a narrower reason — a
   * dataset that declares `retention.hot` with **no** `retention.cold` rolls
   * forever, and nothing ever deletes the already-rolled prefix that piles up
   * ahead of the still-raw tail, so without a cap this scan would walk
   * further back through that prefix on every single sweep, for the rest of
   * that dataset's life. A dataset that keeps rolled data for 1,000+ days
   * before ever pruning it (or never prunes at all) is already well past
   * what this bounded lookup can resolve — a sweep that cannot find its
   * resume point within the cap folds nothing and tries again next hour,
   * same as if there were genuinely nothing left to fold.
   */
  protected static readonly MAX_BUCKET_SCAN = 1000;

  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly provider = $inject(AnalyticsProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Hourly, matching the cadence `SigilJobs.collapseAnalytics` already
   * proved on a Worker. Neither the rollup nor the prune pass is
   * time-critical to the hour.
   */
  public readonly sweep = $job({
    name: "analytics:rollup:sweep",
    cron: "0 * * * *",
    description:
      "Fold hour buckets past retention.hot into day buckets, then delete rolled rows past retention.cold.",
    handler: () => this.sweepNow(),
  });

  /**
   * Sweeps every dataset declared anywhere in the container.
   *
   * `this.alepha.primitives($analytics)` — the primitive **factory**, not
   * the `AnalyticsPrimitive` class — is how every other module enumerates
   * its own declared primitives (`JobService` does the identical
   * `this.alepha.primitives($job)` for jobs, `ServerLinksProvider` the same
   * for `$action`/`$sse`). Passing the class instead silently returns
   * nothing: the container's `primitiveRegistry` is keyed by the factory's
   * `[KIND]`, not by the class itself as a lookup key.
   *
   * Public (not just the `$job` handler) so tests can call it directly under
   * a paused clock without going through `sweep.trigger()`.
   *
   * Each dataset's sweep is isolated in its own `try`/`catch`: a provider
   * failure for one dataset (a transient DB error, a bad row that trips a
   * provider-side assertion) must not starve every dataset that iterates
   * after it. The sweep is self-healing regardless — a failed dataset simply
   * gets retried next hour — so the only thing a failure here should cost is
   * that one dataset's progress for this cycle, never anyone else's.
   */
  public async sweepNow(): Promise<void> {
    const now = this.dateTime.nowMillis();

    for (const primitive of this.alepha.primitives($analytics)) {
      try {
        await this.sweepDataset(primitive.dataset, now);
      } catch (error) {
        this.log.error(
          `Sweep failed for dataset '${primitive.dataset.name}'`,
          error,
        );
      }
    }
  }

  /**
   * Rolls up and prunes one dataset.
   *
   * A dataset with no `retention.hot` is skipped entirely — nothing to fold,
   * and nothing to prune either (pruning past a cold window that outlives an
   * unset hot window has no boundary to measure from). `retention.cold` is
   * independently optional: a dataset can declare `hot` alone to keep
   * folding hourly rows into days forever, with no deletion.
   */
  protected async sweepDataset(
    dataset: AnalyticsDataset,
    now: number,
  ): Promise<void> {
    const retention = dataset.retention;
    if (!retention?.hot) return;

    const hotCutoff = this.dayCutoff(now, retention.hot);
    const boundary = await this.rollupBoundary(dataset, hotCutoff);
    if (boundary) {
      await this.provider.rollup(dataset, boundary);
      this.log.debug(`Rolled up '${dataset.name}' before ${boundary}`);
    }

    if (retention.cold) {
      const coldCutoff = this.dayCutoff(now, retention.cold);
      await this.provider.prune(dataset, coldCutoff);
      this.log.debug(`Pruned '${dataset.name}' before ${coldCutoff}`);
    }
  }

  /**
   * Where this sweep should ask `rollup()` to fold up to, or `undefined` if
   * there is nothing to fold.
   *
   * Finding "the oldest day" is not enough on its own — a day that is
   * already rolled never goes away just because it was folded (nothing
   * deletes it short of {@link sweepDataset}'s own prune pass, which is
   * independently optional), so if this simply resumed from the oldest
   * *existing* day, a dataset with `hot` but no `cold` would compute the
   * exact same capped boundary on every sweep forever, after its first
   * {@link MAX_DAYS_PER_SWEEP} days were folded — real data would sit
   * unrolled indefinitely despite every sweep reporting success. This method
   * instead resumes from the oldest bucket still at **hour** precision.
   *
   * `query()` grouped by `"hour"`, ascending, bounded to
   * {@link MAX_BUCKET_SCAN} rows, returns each dataset's true bucket values —
   * `"YYYY-MM-DD"` for an already-rolled day, `"YYYY-MM-DDTHH"` for a still-raw
   * hour. Day buckets always sort before any hour bucket of the same or a
   * later date (a 10-character prefix sorts before any 13-character string
   * that extends it), so a run of already-rolled days at the front can never
   * hide a still-raw bucket behind it in this ordering — the first
   * 13-character value found (`length > 10`) is genuinely the oldest one
   * left to fold. If every scanned bucket is already 10 characters, either
   * the dataset is fully caught up or the still-raw backlog starts beyond
   * the scan cap; either way there is nothing this sweep can safely act on.
   */
  protected async rollupBoundary(
    dataset: AnalyticsDataset,
    hotCutoff: string,
  ): Promise<string | undefined> {
    // Any declared measure works — `select` cannot be empty, and only each
    // row's `hour` is read, the same trick `coldWatermark` uses. A dataset
    // declaring no measures at all (legal, if unusual) has nothing to
    // aggregate, so it also has nothing to roll.
    const measure = Object.keys(dataset.measures.shape)[0];
    if (!measure) return undefined;

    const scanned = await this.provider.query(dataset, {
      since: AnalyticsRollupJobs.EPOCH_DAY,
      groupBy: ["hour"],
      select: { [measure]: "sum" },
      orderBy: { key: "hour", direction: "asc" },
      limit: AnalyticsRollupJobs.MAX_BUCKET_SCAN,
    });

    const oldestRaw = scanned.rows.find((row) => String(row.hour).length > 10);
    if (!oldestRaw) return undefined;

    const oldestDay = AnalyticsBuckets.day(String(oldestRaw.hour));
    if (oldestDay >= hotCutoff) return undefined;

    const capped = AnalyticsBuckets.shiftDays(
      oldestDay,
      AnalyticsRollupJobs.MAX_DAYS_PER_SWEEP,
    );
    return capped < hotCutoff ? capped : hotCutoff;
  }

  /**
   * The day boundary `window` (e.g. `"60d"`) back from `now`.
   */
  protected dayCutoff(now: number, window: string): string {
    return AnalyticsBuckets.day(
      AnalyticsBuckets.hour(now - AnalyticsBuckets.parseWindow(window)),
    );
  }
}
