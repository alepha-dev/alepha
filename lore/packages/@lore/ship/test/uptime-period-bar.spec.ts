import { projects } from "@lore/core/schemas";
import { Alepha } from "alepha";
import { AnalyticsProvider, OrmAnalyticsProvider } from "alepha/api/analytics";
import { UserService } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, AlephaOrm } from "alepha/orm";
import { describe, it } from "vitest";

import { DeployAnalytics } from "../src/api/entities/deployAnalytics.ts";
import { monitors } from "../src/api/entities/monitors.ts";
import { LoreShipApi } from "../src/api/index.ts";
import { UptimeReadService } from "../src/api/services/UptimeReadService.ts";

class Repositories {
  projects = $repository(projects);
  monitors = $repository(monitors);
}

/**
 * The Uptime page's check bar covers the selected window (#Q4009), where it
 * drew the last 50 checks whatever the window said.
 */
describe("Uptime check bar", () => {
  it("spans 7 days in 42 four-hour slices: failed, passed, or nothing ran", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", LOG_LEVEL: "error" },
    })
      .with({ provide: AnalyticsProvider, use: OrmAnalyticsProvider })
      .with(AlephaOrm)
      .with(LoreShipApi);
    const repos = alepha.inject(Repositories);
    const analytics = alepha.inject(DeployAnalytics);
    const reads = alepha.inject(UptimeReadService);
    const clock = alepha.inject(DateTimeProvider);
    await alepha.start();
    try {
      const owner = await alepha
        .inject(UserService)
        .createUser({ username: "bar-owner" });
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
      const hourAgo = (hours: number) =>
        new Date(clock.nowMillis() - hours * 3_600_000)
          .toISOString()
          .slice(0, 13);
      // Two checks in the current hour, both up; one failure three days ago;
      // nothing else in the week.
      await analytics.probes.record({
        monitorId: monitor.id,
        count: 2,
        up: 2,
        latencyMs: 200,
        hour: hourAgo(0),
      });
      await analytics.probes.record({
        monitorId: monitor.id,
        count: 1,
        up: 0,
        latencyMs: 0,
        result: "timeout",
        hour: hourAgo(72),
      });

      const detail = await reads.detail(monitor, "7d");

      expect(detail.window).toBe("7d");
      expect(detail.bar).toHaveLength(42);
      const last = detail.bar.at(-1)!;
      expect(last).toMatchObject({ checks: 2, failures: 0 });
      expect(Date.parse(last.to) - Date.parse(last.from)).toBe(4 * 3_600_000);
      expect(detail.bar.filter((it) => it.failures > 0)).toHaveLength(1);
      expect(detail.bar.filter((it) => it.checks === 0)).toHaveLength(40);
      // The window ends with the current hour.
      expect(Date.parse(last.to)).toBeGreaterThan(clock.nowMillis());

      const day = await reads.detail(monitor, "24h");
      expect(day.bar).toHaveLength(24);
      expect(day.bar.filter((it) => it.failures > 0)).toHaveLength(0);
    } finally {
      await alepha.stop();
    }
  });
});
