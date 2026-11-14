import { projects } from "@lore/core/schemas";
import { Alepha } from "alepha";
import { AnalyticsProvider, OrmAnalyticsProvider } from "alepha/api/analytics";
import { UserService } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, AlephaOrm } from "alepha/orm";
import { describe, it } from "vitest";

import { DeployAnalytics } from "../src/api/entities/deployAnalytics.ts";
import { monitorIncidents } from "../src/api/entities/monitorIncidents.ts";
import { monitors } from "../src/api/entities/monitors.ts";
import { projectErrors } from "../src/api/entities/projectErrors.ts";
import { LoreShipApi } from "../src/api/index.ts";
import { ProjectReliabilityReportService } from "../src/api/services/ProjectReliabilityReportService.ts";

class Repositories {
  projects = $repository(projects);
  projectErrors = $repository(projectErrors);
  monitors = $repository(monitors);
  incidents = $repository(monitorIncidents);
}

/**
 * The Delivery tab's reliability half (#Q3009), on the relational analytics
 * store. Production's is Analytics Engine: `group by monitorId` has only run
 * here.
 */
describe("ProjectReliabilityReportService", () => {
  const day = 86_400_000;

  const setup = async () => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", LOG_LEVEL: "error" },
    })
      .with({ provide: AnalyticsProvider, use: OrmAnalyticsProvider })
      .with(AlephaOrm)
      .with(LoreShipApi);
    const repos = alepha.inject(Repositories);
    const analytics = alepha.inject(DeployAnalytics);
    await alepha.start();
    const owner = await alepha
      .inject(UserService)
      .createUser({ username: "report-owner" });
    const project = await repos.projects.create({
      title: "Reliability",
      createdBy: owner.id,
    });
    const now = alepha.inject(DateTimeProvider).nowMillis();
    const iso = (ago: number) => new Date(now - ago * day).toISOString();
    let fingerprint = 0;
    return {
      alepha,
      repos,
      analytics,
      project,
      iso,
      projectError: (patch: object) =>
        repos.projectErrors.create({
          projectId: project.id,
          fingerprint: `f${++fingerprint}`,
          name: "TypeError",
          message: "boom",
          firstSeenAt: iso(3),
          lastSeenAt: iso(3),
          ...patch,
        }),
      report: () =>
        alepha
          .inject(ProjectReliabilityReportService)
          .report(project.id, { grain: "day" }, iso(7), iso(0)),
    };
  };

  it("counts new, resolved and open per day, a forwarded error as gone", async ({
    expect,
  }) => {
    const ctx = await setup();
    try {
      await ctx.projectError({ count: 2 });
      await ctx.projectError({
        count: 9,
        status: "resolved",
        lastSeenAt: ctx.iso(1),
      });
      await ctx.projectError({ status: "quest:12", lastSeenAt: ctx.iso(1) });

      const report = await ctx.report();

      const threeDaysAgo = ctx.iso(3).slice(0, 10);
      const row = report.projectErrors.find((it) => it.date === threeDaysAgo);
      expect(row).toMatchObject({ opened: 3, resolved: 0, open: 3 });
      expect(report.projectErrors.at(-1)).toMatchObject({ open: 1 });
      expect(report.topErrors[0]).toMatchObject({
        count: 9,
        status: "resolved",
      });
      expect(report.topErrors.map((it) => it.status)).toContain("forwarded");
    } finally {
      await ctx.alepha.stop();
    }
  });

  it("reads uptime from the probes, and a monitor with none has no figure", async ({
    expect,
  }) => {
    const ctx = await setup();
    try {
      const monitor = (name: string) =>
        ctx.repos.monitors.create({
          projectId: ctx.project.id,
          name,
          kind: "http",
          target: "https://example.test",
          statusSince: ctx.iso(7),
          nextCheckAt: ctx.iso(0),
        });
      const probed = await monitor("Probed");
      await monitor("Silent");
      const hour = ctx.iso(1).slice(0, 13);
      await ctx.analytics.probes.record({
        monitorId: probed.id,
        count: 3,
        up: 3,
        latencyMs: 30,
        hour,
      });
      await ctx.analytics.probes.record({
        monitorId: probed.id,
        count: 1,
        up: 0,
        latencyMs: 0,
        result: "timeout",
        hour,
      });
      await ctx.repos.incidents.create({
        monitorId: probed.id,
        startedAt: ctx.iso(1),
        endedAt: new Date(Date.parse(ctx.iso(1)) + 30 * 60_000).toISOString(),
        cause: "timeout",
      });

      const { monitors: rows } = await ctx.report();

      const byName = new Map(rows.map((row) => [row.name, row]));
      expect(byName.get("Probed")?.uptime).toBeCloseTo(75);
      expect(byName.get("Probed")?.incidents).toBe(1);
      expect(byName.get("Probed")?.mttrMinutes).toBeCloseTo(30);
      expect(byName.get("Silent")?.uptime).toBeUndefined();
    } finally {
      await ctx.alepha.stop();
    }
  });
});
