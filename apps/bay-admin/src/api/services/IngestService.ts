import type { TelemetryEnvelope } from "@alepha/telemetry/envelope";
import { telemetryFingerprintSource } from "@alepha/telemetry/fingerprint";
import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, sql } from "alepha/orm";
import { errorGroups } from "../entities/errorGroups.ts";
import { heartbeats } from "../entities/heartbeats.ts";
import { metricsPoints } from "../entities/metricsPoints.ts";
import type { PulseApp } from "../entities/pulseApps.ts";
import { uniquesDaily } from "../entities/uniquesDaily.ts";
import { viewsHourly } from "../entities/viewsHourly.ts";
import { vitalsHourly } from "../entities/vitalsHourly.ts";

/**
 * Turns one telemetry envelope into rows.
 *
 * Everything here is an upsert into a bucket, never an append of an event. That
 * is the whole storage strategy: what an operator asks of this data is always
 * an aggregate ("how many", "how often", "how bad"), and computing aggregates
 * from retained events costs more every day the app succeeds.
 *
 * The one exception is metrics, kept raw — see `metricsPoints` for why.
 */
export class IngestService {
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly crypto = $inject(CryptoProvider);

  protected readonly errors = $repository(errorGroups);
  protected readonly views = $repository(viewsHourly);
  protected readonly uniques = $repository(uniquesDaily);
  protected readonly vitals = $repository(vitalsHourly);
  protected readonly metrics = $repository(metricsPoints);
  protected readonly beats = $repository(heartbeats);

  /**
   * Absorbs one batch. Each section is independent: a malformed vitals array
   * must not cost the errors that arrived with it.
   */
  async absorb(
    app: PulseApp,
    envelope: TelemetryEnvelope & { country?: string; visitor?: string },
  ): Promise<{ accepted: Record<string, number> }> {
    const now = new Date(this.dateTime.nowMillis()).toISOString();
    const accepted: Record<string, number> = {};

    if (envelope.errors?.length) {
      accepted.errors = await this.absorbErrors(app, envelope.errors, now);
    }
    if (envelope.views?.length) {
      accepted.views = await this.absorbViews(
        app,
        envelope.views,
        envelope.country,
        envelope.visitor,
        now,
      );
    }
    if (envelope.vitals?.length) {
      accepted.vitals = await this.absorbVitals(app, envelope.vitals, now);
    }
    if (envelope.metrics?.length) {
      accepted.metrics = await this.absorbMetrics(app, envelope.metrics);
    }
    if (envelope.heartbeat) {
      await this.absorbHeartbeat(app, envelope.heartbeat, now);
      accepted.heartbeat = 1;
    }

    return { accepted };
  }

  /**
   * Merges errors into their groups.
   *
   * `count` comes from the sender, which has already collapsed a window's worth
   * of identical failures. Adding it rather than incrementing by one is what
   * keeps a crash loop's real magnitude visible without storing it.
   */
  protected async absorbErrors(
    app: PulseApp,
    errors: NonNullable<TelemetryEnvelope["errors"]>,
    now: string,
  ): Promise<number> {
    for (const error of errors) {
      const fingerprint = this.crypto.hash(
        telemetryFingerprintSource(error.name, error.stack),
      );
      const seen = error.count ?? 1;

      await this.errors.upsert(
        {
          appId: app.id,
          fingerprint,
          name: error.name,
          message: error.message,
          stackSample: error.stack,
          sourceUrl: error.sourceUrl,
          origin: error.origin ?? "client",
          firstSeenAt: now,
          lastSeenAt: now,
          count: seen,
        },
        {
          target: ["appId", "fingerprint"],
          // Only the count and the last sighting move. `stackSample` and
          // `firstSeenAt` deliberately do not: the newest sample of a recurring
          // error is rarely the informative one, and letting it drift means the
          // stored stack stops matching the stored first sighting.
          set: {
            count: sql`${this.errors.table.count} + ${seen}`,
            lastSeenAt: now,
          },
        },
      );
    }
    return errors.length;
  }

  protected async absorbViews(
    app: PulseApp,
    views: NonNullable<TelemetryEnvelope["views"]>,
    country: string | undefined,
    visitor: string | undefined,
    now: string,
  ): Promise<number> {
    const hour = this.hourBucket(now);
    const day = this.dayBucket(now);

    for (const view of views) {
      // `INSERT … ON CONFLICT DO UPDATE count = count + 1`, in one statement.
      // Reading then writing would lose views under concurrency, which is
      // exactly the load this table exists to measure.
      await this.views.upsert(
        {
          appId: app.id,
          hour,
          path: this.normalizePath(view.path),
          country: country ?? "ZZ",
          count: 1,
        },
        {
          target: ["appId", "hour", "path", "country"],
          set: { count: sql`${this.views.table.count} + 1` },
        },
      );
    }

    // One row per visitor per day. Recorded once per batch rather than per
    // view: the same person loading ten pages is one unique.
    if (visitor) {
      // The conflict IS the expected case — a returning visitor. Upserting with
      // no `set` makes it a no-op instead of an error.
      await this.uniques.upsert(
        { appId: app.id, day, visitorHash: visitor },
        { target: ["appId", "day", "visitorHash"], set: { day } },
      );
    }

    return views.length;
  }

  protected async absorbVitals(
    app: PulseApp,
    vitals: NonNullable<TelemetryEnvelope["vitals"]>,
    now: string,
  ): Promise<number> {
    const hour = this.hourBucket(now);
    for (const vital of vitals) {
      const path = this.normalizePath(vital.path);
      const bucket = String(this.bucketFor(vital.metric, vital.value));

      // Read-modify-write, unlike the other buckets: the histogram lives inside
      // a JSON column, so there is no column to increment. Two samples for the
      // same (hour, metric, path) landing together can lose one — acceptable
      // for a distribution, where one sample in a bucket of many changes
      // nothing an operator would read differently.
      const existing = await this.vitals.findOne({
        where: { appId: app.id, hour, metric: vital.metric, path },
      });
      const counts = {
        ...((existing?.bucketCounts ?? {}) as Record<string, number>),
      };
      counts[bucket] = (counts[bucket] ?? 0) + 1;

      await this.vitals.upsert(
        {
          appId: app.id,
          hour,
          metric: vital.metric,
          path,
          bucketCounts: counts,
        },
        {
          target: ["appId", "hour", "metric", "path"],
          set: { bucketCounts: counts },
        },
      );
    }
    return vitals.length;
  }

  protected async absorbMetrics(
    app: PulseApp,
    metrics: NonNullable<TelemetryEnvelope["metrics"]>,
  ): Promise<number> {
    await this.metrics.createMany(
      metrics.map((metric) => ({
        appId: app.id,
        series: metric.series,
        at: new Date(metric.at).toISOString(),
        value: metric.value,
      })),
    );
    return metrics.length;
  }

  protected async absorbHeartbeat(
    app: PulseApp,
    heartbeat: NonNullable<TelemetryEnvelope["heartbeat"]>,
    now: string,
  ): Promise<void> {
    const row = {
      lastSeenAt: now,
      release: heartbeat.release,
      uptimeSec: heartbeat.uptimeSec,
      idle: heartbeat.idle,
    };
    // One row per app, overwritten: whether it was up an hour ago is answered
    // by the metrics series, not by a pile of heartbeats.
    await this.beats.upsert(
      { appId: app.id, ...row },
      { target: ["appId"], set: row },
    );
  }

  /**
   * Which histogram bucket a vitals value falls in.
   *
   * Boundaries are the Web Vitals "good / needs improvement / poor" thresholds,
   * so a chart drawn from these buckets says the same thing Chrome does.
   */
  protected bucketFor(metric: string, value: number): number {
    const thresholds: Record<string, [number, number]> = {
      lcp: [2500, 4000],
      cls: [0.1, 0.25],
      inp: [200, 500],
      fcp: [1800, 3000],
      ttfb: [800, 1800],
    };
    const [good, poor] = thresholds[metric] ?? [0, 0];
    if (value <= good) return 0;
    if (value <= poor) return 1;
    return 2;
  }

  /**
   * Strips query and fragment.
   *
   * Without it, `/search?q=…` makes every distinct query its own row, and the
   * table's storage stops being bounded by page cardinality — which is the
   * property that makes rolling up on write affordable.
   */
  protected normalizePath(path: string): string {
    return path.split(/[?#]/)[0].slice(0, 1024) || "/";
  }

  /** `YYYY-MM-DDTHH`, UTC. */
  protected hourBucket(at: string): string {
    return at.slice(0, 13);
  }

  /** `YYYY-MM-DD`, UTC. */
  protected dayBucket(at: string): string {
    return at.slice(0, 10);
  }
}
