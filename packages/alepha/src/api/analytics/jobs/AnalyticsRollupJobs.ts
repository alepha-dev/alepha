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
 * Modelled on Lore's `SigilJobs` (github.com/alepha-dev/lore), the
 * Worker-tested prior art for this
 * exact shape (hourly sweep, capped backlog, fold-not-delete). It cannot
 * reuse that class's mechanism directly, though: `SigilJobs` holds
 * `$repository` handles onto two known tables and scans them with SQL this
 * job has no equivalent for — datasets here are declared at arbitrary call
 * sites, and the only surface this job is allowed to use is the abstract
 * {@link AnalyticsProvider} seam, which deliberately hides where a row
 * lives (see that class's own doc). Its resume point comes from
 * `oldestBucket(dataset, "raw")`, which every provider answers cheaply
 * (relationally, an indexed `MIN`).
 *
 * The per-sweep cap ({@link MAX_DAYS_PER_SWEEP}) is not tuning. Neither
 * shipped provider's `rollup()` self-limits by how far back `before` reaches
 * — `OrmAnalyticsProvider.rollup()` is one `INSERT … SELECT … GROUP BY` over
 * every row older than the boundary it is given, and
 * `MemoryAnalyticsProvider.rollup()` is one pass over its whole array — so a
 * table nobody has ever pruned could otherwise hand either implementation an
 * arbitrary backlog to fold in a single call. This runs on a Worker with a
 * wall-clock and a memory ceiling. (`WaeAnalyticsProvider` bounds its own
 * forward on top of this, in rows: see its `maxForwardRows`.)
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
    name: "system.analytics.rollup",
    cron: "0 * * * *",
    description:
      "Folds hourly analytics buckets past the hot window into daily ones, then deletes rolled rows past the cold window.",
    timeout: [30, "seconds"],
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
   * Resumes from the oldest bucket still in the raw tier, never from the
   * oldest bucket overall: an already-rolled day never goes away short of the
   * prune pass, which is optional, so resuming from it would compute the same
   * capped boundary on every sweep once the first {@link MAX_DAYS_PER_SWEEP}
   * days were folded, and real data would sit unrolled forever.
   */
  protected async rollupBoundary(
    dataset: AnalyticsDataset,
    hotCutoff: string,
  ): Promise<string | undefined> {
    const oldestRaw = await this.provider.oldestBucket(dataset, "raw");
    if (!oldestRaw) return undefined;

    const oldestDay = AnalyticsBuckets.day(oldestRaw);
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
