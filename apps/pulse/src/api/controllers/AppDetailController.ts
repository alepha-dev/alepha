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
import { BayControlService } from "../services/BayControlService.ts";

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
  protected readonly bay = $inject(BayControlService);

  protected readonly apps = $repository(pulseApps);
  protected readonly errors = $repository(errorGroups);
  protected readonly beats = $repository(heartbeats);
  protected readonly views = $repository(viewsHourly);
  protected readonly uniques = $repository(uniquesDaily);
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

      return {
        views: rows.reduce((sum, r) => sum + r.count, 0),
        uniques: uniques.length,
        topPaths: [...byPath.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([path, count]) => ({ path, count })),
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

    if (kind === "bay") {
      try {
        const app = (await this.bay.listApps()).find((a) => a.name === slug);
        if (app && app.running === false) {
          return "stopped";
        }
      } catch {
        // A Bay we cannot reach says nothing about the app; fall through to
        // what the app itself reported.
      }
    }
    if (!lastSeenAt) return "never reported";
    return fresh ? "up" : "silent";
  }

  protected hoursAgo(hours: number, extraMs = 0): string {
    return new Date(
      this.dateTime.nowMillis() - hours * 3_600_000 - extraMs,
    ).toISOString();
  }
}
