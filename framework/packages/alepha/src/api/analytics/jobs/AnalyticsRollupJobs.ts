import { $inject, Alepha, z } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

import { AnalyticsBuckets } from "../planner/AnalyticsBuckets.ts";
import { AnalyticsTiers } from "../planner/AnalyticsTiers.ts";
import { EventLogPlan } from "../planner/EventLogPlan.ts";
import { $analytics } from "../primitives/$analytics.ts";
import { $eventLog } from "../primitives/$eventLog.ts";
import { AnalyticsProvider } from "../providers/AnalyticsProvider.ts";
import { EventLogProvider } from "../providers/EventLogProvider.ts";
import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";
import type { AnalyticsEventLog } from "../schemas/eventLogSchema.ts";

/**
 * Keeps every declared dataset inside its retention window.
 *
 * Folds each tier's buckets past its `keep` into the next tier of the
 * retention chain, finest first, then deletes the last tier's rows past its
 * own `keep`. Folding **collapses rather than deletes**, so no total the UI
 * shows ever changes, only the resolution of the time axis does.
 *
 * Modelled on Lore's `SigilJobs` (github.com/alepha-dev/lore), the
 * Worker-tested prior art for this
 * exact shape (hourly sweep, capped backlog, fold-not-delete). It cannot
 * reuse that class's mechanism directly, though: `SigilJobs` holds
 * `$repository` handles onto two known tables and scans them with SQL this
 * job has no equivalent for, datasets here are declared at arbitrary call
 * sites, and the only surface this job is allowed to use is the abstract
 * {@link AnalyticsProvider} seam, which deliberately hides where a row
 * lives (see that class's own doc). Its resume point comes from
 * `oldestBucket(dataset, tier)`, which every provider answers cheaply
 * (relationally, an indexed `MIN`).
 *
 * The per-sweep cap ({@link MAX_BUCKETS_PER_SWEEP}) is not tuning. Neither
 * shipped provider's `rollup()` self-limits by how far back `before` reaches:
 * `OrmAnalyticsProvider.rollup()` is one `INSERT … SELECT … GROUP BY` over
 * every row older than the boundary it is given, and
 * `MemoryAnalyticsProvider.rollup()` is one pass over its whole array, so a
 * table nobody has ever pruned could otherwise hand either implementation an
 * arbitrary backlog to fold in a single call. This runs on a Worker with a
 * wall-clock and a memory ceiling. (`WaeAnalyticsProvider` bounds its own
 * forward on top of this, in rows: see its `maxForwardRows`.)
 * Chewing through history over several sweeps costs nothing because the fold
 * is idempotent: the next sweep simply resumes from whatever is still oldest.
 */
export class AnalyticsRollupJobs {
  /**
   * Most source-tier buckets one sweep folds, per tier of a dataset. See the
   * class doc for why this is a correctness bound, not a performance knob.
   *
   * Counted in the source tier's buckets, because the rows a fold moves are
   * buckets times distinct keys, whatever the resolution. Measured in the
   * #Q2751 benchmark on Postgres with a device hub's two datasets at 10k
   * devices (about 73k keys a bucket): a fold costs about 0.24 s a bucket
   * for both datasets together, so 36 buckets on each of two backlogged
   * tiers stays under half the job's 30 s timeout. The old cap, 336, took
   * 81 s on the 5-minute tier alone. A sweep folds whole buckets of the next
   * tier, so 36 five-minute buckets fold three hours, and an hour tier
   * folds a day: still faster than real time on every tier.
   */
  public static readonly MAX_BUCKETS_PER_SWEEP = 36;

  /**
   * Most expired rows one sweep deletes from one event log. A log past its
   * window by a day of heavy traffic needs a few sweeps; each stays one
   * bounded `DELETE`, oldest first, so every sweep makes progress.
   */
  public static MAX_EVENT_ROWS_PER_SWEEP = 10_000;

  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly provider = $inject(AnalyticsProvider);
  protected readonly events = $inject(EventLogProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Hourly, matching the cadence `SigilJobs.collapseAnalytics` already
   * proved on a Worker. Neither the rollup nor the prune pass is
   * time-critical to the hour.
   *
   * It only hands each dataset to {@link sweepOne}, one queued execution per
   * dataset (#Q3690). Sweeping them all in this run put every dataset under
   * one 30 s timeout: at Lore's 00:00 UTC run, where every other hourly and
   * daily job of the scheduled event hits D1 at once, the first dataset's
   * cold-forward insert stalled 16 s until D1 timed it out, and the 30 s ran
   * out three datasets later. Apart, a stalled dataset costs its own run and
   * no other's.
   */
  public readonly sweep = $job({
    name: "system.analytics.rollup",
    cron: "0 * * * *",
    description:
      "Queues one sweep per analytics dataset, which folds each tier's buckets past its window into the next tier, then deletes the last tier's rows past its window.",
    timeout: [30, "seconds"],
    handler: () => this.enqueueSweeps(),
  });

  /**
   * One dataset's sweep, with its own 30 s (#Q3690). A name that no longer
   * matches a declared dataset (a deploy that removed it while the
   * execution waited) is skipped.
   */
  public readonly sweepOne = $job({
    name: "system.analytics.rollup-dataset",
    schema: z.object({ dataset: z.text() }),
    description:
      "Folds one analytics dataset's tiers past their window into the next tier, then deletes its last tier's rows past its window.",
    timeout: [30, "seconds"],
    handler: async ({ payload }) => {
      const primitive = this.alepha
        .primitives($analytics)
        .find((it) => it.dataset.name === payload.dataset);
      if (!primitive) return;
      await this.sweepDataset(primitive.dataset, this.dateTime.nowMillis());
    },
  });

  /**
   * One event log's expiry: deletes its rows older than `keep`, at most
   * {@link MAX_EVENT_ROWS_PER_SWEEP}, oldest first. The next hour resumes.
   */
  public readonly expireOne = $job({
    name: "system.analytics.expire-event-log",
    schema: z.object({ log: z.text() }),
    description:
      "Deletes one event log's rows older than its keep window, oldest first, capped per run.",
    timeout: [30, "seconds"],
    handler: async ({ payload }) => {
      const primitive = this.alepha
        .primitives($eventLog)
        .find((it) => it.eventLog.name === payload.log);
      if (!primitive) return;
      await this.expireEventLog(primitive.eventLog, this.dateTime.nowMillis());
    },
  });

  /**
   * The hourly cron's work: one queued {@link sweepOne} per dataset that
   * has anything to keep in a window, and one {@link expireOne} per event
   * log, each in one batched push.
   */
  public async enqueueSweeps(): Promise<void> {
    const names = this.alepha
      .primitives($analytics)
      .filter((primitive) => AnalyticsTiers.of(primitive.dataset)[0].keep)
      .map((primitive) => primitive.dataset.name);
    if (names.length > 0) {
      await this.sweepOne.pushMany(
        names.map((dataset) => ({ payload: { dataset } })),
      );
    }
    const logs = this.alepha
      .primitives($eventLog)
      .map((primitive) => primitive.eventLog.name);
    if (logs.length > 0) {
      await this.expireOne.pushMany(logs.map((log) => ({ payload: { log } })));
    }
  }

  /**
   * Deletes one capped batch of `log`'s rows past its keep window, and
   * answers how many went. Public so tests run it under a paused clock.
   */
  public async expireEventLog(
    log: AnalyticsEventLog,
    now: number,
  ): Promise<number> {
    const before = now - EventLogPlan.keepMillis(log);
    const started = this.dateTime.nowMillis();
    const deleted = await this.events.prune(
      log,
      before,
      AnalyticsRollupJobs.MAX_EVENT_ROWS_PER_SWEEP,
    );
    this.log.info(`Event log expiry of '${log.name}': ${deleted} rows`, {
      log: log.name,
      deleted,
      ms: this.dateTime.nowMillis() - started,
    });
    return deleted;
  }

  /**
   * Sweeps every dataset declared anywhere in the container.
   *
   * `this.alepha.primitives($analytics)`, the primitive **factory**, not
   * the `AnalyticsPrimitive` class, is how every other module enumerates
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
   * after it. The sweep is self-healing regardless, a failed dataset simply
   * gets retried next hour, so the only thing a failure here should cost is
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
    for (const primitive of this.alepha.primitives($eventLog)) {
      try {
        await this.expireEventLog(primitive.eventLog, now);
      } catch (error) {
        this.log.error(
          `Expiry failed for event log '${primitive.eventLog.name}'`,
          error,
        );
      }
    }
  }

  /**
   * Folds every tier past its window into the next, finest first, then
   * prunes the last tier past its own.
   *
   * A dataset whose finest tier has no window (no `retention`, or the
   * original shape without `hot`) is skipped entirely: nothing to fold, and
   * nothing to prune either. The last tier's window is independently
   * optional: without one, folded rows are kept forever.
   *
   * The cron stays hourly whatever the finest resolution: a minute tier can
   * only fold whole hours into an hour tier, so a faster sweep would fold
   * nothing more.
   */
  protected async sweepDataset(
    dataset: AnalyticsDataset,
    now: number,
  ): Promise<void> {
    const tiers = AnalyticsTiers.of(dataset);
    if (!tiers[0].keep) return;
    const started = this.dateTime.nowMillis();

    for (let index = 0; index < tiers.length - 1; index++) {
      const keep = tiers[index].keep;
      if (!keep) break;
      await this.timed(dataset, `rollup tier ${index}`, async () => {
        const boundary = await this.rollupBoundary(
          dataset,
          index,
          now - AnalyticsBuckets.parseWindow(keep),
        );
        if (!boundary) return "nothing to fold";
        await this.provider.rollup(dataset, index, boundary);
        return `before ${boundary}`;
      });
    }

    const last = tiers[tiers.length - 1];
    const lastKeep = last.keep;
    if (lastKeep) {
      await this.timed(dataset, "prune", async () => {
        const cutoff = AnalyticsBuckets.bucket(
          now - AnalyticsBuckets.parseWindow(lastKeep),
          last.resolution,
        );
        await this.provider.prune(dataset, cutoff);
        return `before ${cutoff}`;
      });
    }

    this.log.info(`Analytics sweep of '${dataset.name}' done`, {
      dataset: dataset.name,
      step: "total",
      ms: this.dateTime.nowMillis() - started,
    });
  }

  /**
   * Runs one step of a dataset's sweep, then logs at info the dataset, the
   * step and how long it took.
   *
   * The job runs under a 30 s timeout, and Lore's 00:00 UTC run hit it two
   * nights running (#Q2938) with nothing in the logs to say which step ate
   * the time: a fold of which tier, or the prune. One line per step, logged
   * as each one finishes, is what lets a run that times out still show how
   * far it got and what every finished step cost. Read through
   * `DateTimeProvider` like every clock in the framework, so a paused test
   * clock reads 0 ms.
   */
  protected async timed(
    dataset: AnalyticsDataset,
    step: string,
    run: () => Promise<string>,
  ): Promise<void> {
    const started = this.dateTime.nowMillis();
    const detail = await run();
    this.log.info(`Analytics sweep of '${dataset.name}': ${step}, ${detail}`, {
      dataset: dataset.name,
      step,
      ms: this.dateTime.nowMillis() - started,
    });
  }

  /**
   * Where this sweep should fold tier `index` up to, as a key of the next
   * tier, or `undefined` if there is nothing to fold.
   *
   * Only whole buckets of the next tier fold, so the boundary is the next
   * tier's bucket holding `cutoff`. It resumes from the oldest bucket still
   * in the source tier, never from the oldest overall: an already-folded
   * bucket never goes away short of the prune pass, which is optional, so
   * resuming from it would compute the same capped boundary on every sweep
   * once the first {@link MAX_BUCKETS_PER_SWEEP} were folded, and real data
   * would sit unfolded forever. A capped boundary always moves at least one
   * target bucket, or a cap shorter than one target bucket would never
   * progress.
   */
  protected async rollupBoundary(
    dataset: AnalyticsDataset,
    index: number,
    cutoff: number,
  ): Promise<string | undefined> {
    const tiers = AnalyticsTiers.of(dataset);
    const source = tiers[index].resolution;
    const target = tiers[index + 1].resolution;

    const oldest = await this.provider.oldestBucket(dataset, index);
    if (!oldest) return undefined;

    const limit = AnalyticsBuckets.bucket(cutoff, target);
    const oldestTarget = AnalyticsBuckets.truncate(oldest, target);
    if (oldestTarget >= limit) return undefined;

    const sourceStep = AnalyticsBuckets.minutesOf(source) * 60_000;
    let capped = AnalyticsBuckets.bucket(
      AnalyticsBuckets.startOf(oldest) +
        AnalyticsRollupJobs.MAX_BUCKETS_PER_SWEEP * sourceStep,
      target,
    );
    if (capped <= oldestTarget) {
      capped = AnalyticsBuckets.bucket(
        AnalyticsBuckets.startOf(oldestTarget) +
          AnalyticsBuckets.minutesOf(target) * 60_000,
        target,
      );
    }
    return capped < limit ? capped : limit;
  }
}
