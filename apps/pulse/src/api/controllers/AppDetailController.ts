import { VITALS_BUCKETS, type VitalMetric } from "@alepha/pulse-client/vitals";
import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, HttpError } from "alepha/server";
import { errorGroups } from "../entities/errorGroups.ts";
import { heartbeats } from "../entities/heartbeats.ts";
import { metricsPoints } from "../entities/metricsPoints.ts";
import { pulseApps } from "../entities/pulseApps.ts";
import { uniquesDaily } from "../entities/uniquesDaily.ts";
import { viewsHourly } from "../entities/viewsHourly.ts";
import { vitalsHourly } from "../entities/vitalsHourly.ts";

/** Nothing is returned unbounded, whatever the window asked for. */
const MAX_ROWS = 500;

/**
 * Everything one app's page needs, per tab.
 *
 * Split by tab rather than one fat payload: the errors list is the only part
 * anyone loads constantly, and making it wait on a metrics scan would make the
 * page feel broken on the app that needs it most.
 */
export class AppDetailController {
  protected readonly dateTime = $inject(DateTimeProvider);

  protected readonly apps = $repository(pulseApps);
  protected readonly errors = $repository(errorGroups);
  protected readonly beats = $repository(heartbeats);
  protected readonly views = $repository(viewsHourly);
  protected readonly uniques = $repository(uniquesDaily);
  protected readonly vitals = $repository(vitalsHourly);
  protected readonly metrics = $repository(metricsPoints);

  overview = $action({
    method: "GET",
    path: "/pulse/apps/:slug/overview",
    use: [$secure({ roles: ["admin"] })],
    description: "Status, release and recent error volume for one app",
    schema: {
      params: z.object({ slug: z.text() }),
      response: z.object({
        slug: z.text(),
        name: z.text(),
        kind: z.text(),
        status: z.text(),
        release: z.text().optional(),
        lastSeenAt: z.text().optional(),
        uptimeSec: z.number().optional(),
        errors24h: z.integer(),
        groups: z.integer(),
      }),
    },
    handler: async ({ params }) => {
      const app = await this.bySlug(params.slug);
      const beat = await this.beats.findOne({ where: { appId: app.id } });
      const since = this.hoursAgo(24);
      const groups = await this.errors.findMany({
        where: { appId: app.id },
        limit: MAX_ROWS,
      });

      return {
        slug: app.slug,
        name: app.name,
        kind: app.kind,
        status: await this.statusOf(app.slug, app.kind, beat?.lastSeenAt),
        release: beat?.release,
        lastSeenAt: beat?.lastSeenAt,
        uptimeSec: beat?.uptimeSec,
        errors24h: groups
          .filter((g) => g.lastSeenAt >= since)
          .reduce((sum, g) => sum + g.count, 0),
        groups: groups.length,
      };
    },
  });

  errorList = $action({
    method: "GET",
    path: "/pulse/apps/:slug/errors",
    use: [$secure({ roles: ["admin"] })],
    description: "Distinct failures for one app, most recent first",
    schema: {
      params: z.object({ slug: z.text() }),
      response: z.array(
        z.object({
          fingerprint: z.text(),
          name: z.text(),
          message: z.text(),
          sourceUrl: z.text(),
          origin: z.text(),
          release: z.text().optional(),
          count: z.integer(),
          firstSeenAt: z.text(),
          lastSeenAt: z.text(),
        }),
      ),
    },
    handler: async ({ params }) => {
      const app = await this.bySlug(params.slug);
      return (await this.errors.findMany({
        where: { appId: app.id },
        orderBy: { column: "lastSeenAt", direction: "desc" },
        limit: 100,
      })) as any;
    },
  });

  analytics = $action({
    method: "GET",
    path: "/pulse/apps/:slug/analytics",
    use: [$secure({ roles: ["admin"] })],
    description: "Views, uniques and busiest pages over a window",
    schema: {
      params: z.object({ slug: z.text() }),
      query: z.object({ days: z.integer().default(7) }),
      response: z.object({
        views: z.integer(),
        uniques: z.integer(),
        topPaths: z.array(z.object({ path: z.text(), count: z.integer() })),
        topCountries: z.array(
          z.object({ country: z.text(), count: z.integer() }),
        ),
        /** Views per day, oldest first, with empty days present as zero. */
        timeline: z.array(z.object({ day: z.text(), count: z.integer() })),
        /**
         * p75 per Web Vital, computed from the stored histograms.
         *
         * Absent when nothing was collected for that metric — reported as a
         * missing key rather than as zero, because "fast" and "unmeasured"
         * must not look the same on a performance page.
         */
        vitals: z.record(z.text(), z.number()),
      }),
    },
    handler: async ({ params, query }) => {
      const app = await this.bySlug(params.slug);
      const since = this.hoursAgo(query.days * 24);

      const rows = (
        await this.views.findMany({ where: { appId: app.id }, limit: 5000 })
      ).filter((r) => r.hour >= since.slice(0, 13));

      const byPath = new Map<string, number>();
      for (const row of rows) {
        byPath.set(row.path, (byPath.get(row.path) ?? 0) + row.count);
      }

      const uniques = (
        await this.uniques.findMany({ where: { appId: app.id }, limit: 5000 })
      ).filter((u) => u.day >= since.slice(0, 10));

      const byCountry = new Map<string, number>();
      for (const row of rows) {
        byCountry.set(
          row.country,
          (byCountry.get(row.country) ?? 0) + row.count,
        );
      }

      // Every day in the window, including the empty ones. A bar chart that
      // silently omits a day with no traffic draws a continuous line over an
      // outage, which is the opposite of what someone is looking for.
      const byDay = new Map<string, number>();
      for (let i = query.days - 1; i >= 0; i--) {
        byDay.set(this.hoursAgo(i * 24).slice(0, 10), 0);
      }
      for (const row of rows) {
        const day = row.hour.slice(0, 10);
        if (byDay.has(day)) {
          byDay.set(day, (byDay.get(day) ?? 0) + row.count);
        }
      }

      return {
        views: rows.reduce((sum, r) => sum + r.count, 0),
        uniques: uniques.length,
        topPaths: [...byPath.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([path, count]) => ({ path, count })),
        topCountries: [...byCountry.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([country, count]) => ({ country, count })),
        timeline: [...byDay.entries()].map(([day, count]) => ({ day, count })),
        vitals: await this.vitalsP75(app.id, since),
      };
    },
  });

  metricSeries = $action({
    method: "GET",
    path: "/pulse/apps/:slug/metrics",
    use: [$secure({ roles: ["admin"] })],
    description: "Raw samples of one series over a window",
    schema: {
      params: z.object({ slug: z.text() }),
      query: z.object({
        series: z.text().default("rss"),
        hours: z.integer().default(6),
      }),
      response: z.array(z.object({ at: z.text(), value: z.number() })),
    },
    handler: async ({ params, query }) => {
      const app = await this.bySlug(params.slug);
      const since = this.hoursAgo(query.hours);
      const rows = await this.metrics.findMany({
        where: { appId: app.id, series: query.series as any },
        orderBy: { column: "at", direction: "desc" },
        limit: MAX_ROWS,
      });
      return rows
        .filter((r) => r.at >= since)
        .reverse()
        .map((r) => ({ at: r.at, value: r.value })) as any;
    },
  });

  protected async bySlug(slug: string) {
    const app = await this.apps.findOne({ where: { slug } });
    if (!app) {
      throw new HttpError({ status: 404, message: `No app "${slug}"` });
    }
    return app;
  }

  /**
   * Crosses the heartbeat with what Bay's supervisor says.
   *
   * Silence alone cannot tell a crash from a deliberate stop, and reporting a
   * stopped app as broken is how a monitor teaches its reader to ignore it.
   */
  protected async statusOf(
    slug: string,
    kind: string,
    lastSeenAt: string | undefined,
  ): Promise<string> {
    const fresh = !!lastSeenAt && lastSeenAt >= this.hoursAgo(0, 600_000);

    // Silence is all Pulse has.
    //
    // It used to ask Bay whether the process was actually stopped, which made
    // this app know what a deployment is — and Pulse has to work for something
    // on Cloudflare or Vercel, where there is no supervisor to ask. Whether a
    // process is running is bay-admin's question; whether an app has stopped
    // reporting is this one's, and they are not the same question even when
    // they happen to have the same answer.
    if (!lastSeenAt) return "never reported";
    return fresh ? "up" : "silent";
  }

  protected hoursAgo(hours: number, extraMs = 0): string {
    return new Date(
      this.dateTime.nowMillis() - hours * 3_600_000 - extraMs,
    ).toISOString();
  }

  /**
   * p75 per metric, reconstructed from the stored histograms.
   *
   * Nothing keeps raw samples — a page view produces one increment in one
   * bucket, so storage is bounded by (metric × path × hour) rather than by
   * traffic. The cost is that a percentile is approximate: this returns the
   * UPPER boundary of the bucket the 75th sample falls in, which overstates
   * rather than understates. On a page that says whether a site is fast, that
   * is the right direction to be wrong in.
   *
   * The overflow bucket has no upper boundary, so it reports the last one —
   * the honest reading there is "at least this", and the UI shows it as poor
   * either way.
   */
  protected async vitalsP75(
    appId: string,
    since: string,
  ): Promise<Record<string, number>> {
    const rows = (
      await this.vitals.findMany({ where: { appId }, limit: 5000 })
    ).filter((row) => row.hour >= since.slice(0, 13));

    const totals = new Map<string, number[]>();
    for (const row of rows) {
      const bounds = VITALS_BUCKETS[row.metric as VitalMetric];
      const counts =
        totals.get(row.metric) ?? new Array(bounds.length + 1).fill(0);
      for (const [index, count] of Object.entries(row.bucketCounts)) {
        counts[Number(index)] = (counts[Number(index)] ?? 0) + Number(count);
      }
      totals.set(row.metric, counts);
    }

    const out: Record<string, number> = {};
    for (const [metric, counts] of totals) {
      const samples = counts.reduce((sum, n) => sum + n, 0);
      if (!samples) continue;
      const target = samples * 0.75;
      let seen = 0;
      const bounds = VITALS_BUCKETS[metric as VitalMetric];
      for (let i = 0; i < counts.length; i++) {
        seen += counts[i];
        if (seen >= target) {
          out[metric] = bounds[Math.min(i, bounds.length - 1)];
          break;
        }
      }
    }
    return out;
  }
}
