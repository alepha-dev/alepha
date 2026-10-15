import { projects } from "@lore/core/schemas";
import { Alepha } from "alepha";
import { AnalyticsProvider, OrmAnalyticsProvider } from "alepha/api/analytics";
import { UserService } from "alepha/api/users";
import { $repository, AlephaOrm } from "alepha/orm";
import { describe, it } from "vitest";

import { DeployAnalytics } from "../src/api/entities/deployAnalytics.ts";
import { monitors } from "../src/api/entities/monitors.ts";
import { LoreDeployApi } from "../src/api/index.ts";

class Repositories {
  projects = $repository(projects);
  monitors = $repository(monitors);
}

describe("Uptime analytics", () => {
  it("sums individual probes by hour on the relational store and removes history with the monitor", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", LOG_LEVEL: "error" },
    })
      .with({ provide: AnalyticsProvider, use: OrmAnalyticsProvider })
      .with(AlephaOrm)
      .with(LoreDeployApi);
    const repos = alepha.inject(Repositories);
    const analytics = alepha.inject(DeployAnalytics);
    await alepha.start();
    try {
      const owner = await alepha
        .inject(UserService)
        .createUser({ username: "probe-owner" });
      const project = await repos.projects.create({
        title: "Checks",
        createdBy: owner.id,
      });
      const monitor = await repos.monitors.create({
        projectId: project.id,
        name: "Website",
        kind: "http",
        target: "https://example.test",
        statusSince: "2026-10-15T10:00:00Z",
        nextCheckAt: "2026-10-15T10:00:00Z",
      });
      await analytics.probes.record({
        monitorId: monitor.id,
        count: 1,
        up: 1,
        latencyMs: 120,
        hour: "2026-10-15T10",
      });
      await analytics.probes.record({
        monitorId: monitor.id,
        count: 1,
        up: 0,
        latencyMs: 0,
        result: "timeout",
        hour: "2026-10-15T10",
      });
      await analytics.probes.record({
        monitorId: monitor.id,
        count: 1,
        up: 1,
        latencyMs: 80,
        hour: "2026-10-15T11",
      });
      const query = {
        since: "2026-10-15",
        where: { monitorId: monitor.id },
        groupBy: ["hour"],
        select: { count: "sum", up: "sum", latencyMs: "sum" },
        orderBy: { key: "hour", direction: "asc" },
      } as const;
      const result = await analytics.probes.query({
        ...query,
        groupBy: [...query.groupBy],
      });
      expect(result.estimated).toBe(false);
      expect(
        result.rows.map((row) => [row.count, row.up, row.latencyMs]),
      ).toEqual([
        [2, 1, 120],
        [1, 1, 80],
      ]);
      expect(analytics.probes.dataset.slots).toEqual({
        dimensions: ["monitorId", "prober", "result"],
        measures: ["count", "latencyMs", "up"],
      });
      await repos.monitors.deleteById(monitor.id);
      expect(
        (
          await analytics.probes.query({
            ...query,
            groupBy: [...query.groupBy],
          })
        ).rows,
      ).toEqual([]);
    } finally {
      await alepha.stop();
    }
  });
});
