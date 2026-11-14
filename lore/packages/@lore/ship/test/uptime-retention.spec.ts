import { LoreCoreApi } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { Alepha } from "alepha";
import { UserService } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, AlephaOrm } from "alepha/orm";
import { describe, it } from "vitest";

import { monitorHeartbeats } from "../src/api/entities/monitorHeartbeats.ts";
import { monitorIncidents } from "../src/api/entities/monitorIncidents.ts";
import { monitors } from "../src/api/entities/monitors.ts";
import { UptimeRetentionJobs } from "../src/api/jobs/UptimeRetentionJobs.ts";

class Repositories {
  projects = $repository(projects);
  monitors = $repository(monitors);
  incidents = $repository(monitorIncidents);
  beats = $repository(monitorHeartbeats);
}

describe("Uptime retention", () => {
  it("retains the newest 100 per monitor after the daily cron and cascades deletion", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", LOG_LEVEL: "error" },
    })
      .with(AlephaOrm)
      .with(LoreCoreApi);
    const repos = alepha.inject(Repositories);
    alepha.inject(UptimeRetentionJobs);
    const clock = alepha.inject(DateTimeProvider);
    clock.pause();
    await alepha.start();
    try {
      const owner = await alepha
        .inject(UserService)
        .createUser({ username: "uptime-owner" });
      const project = await repos.projects.create({
        title: "Uptime",
        createdBy: owner.id,
      });
      const now = clock.nowISOString();
      const first = await repos.monitors.create({
        projectId: project.id,
        name: "First",
        kind: "http",
        target: "https://example.test",
        statusSince: now,
        nextCheckAt: now,
      });
      const second = await repos.monitors.create({
        projectId: project.id,
        name: "Second",
        kind: "push",
        target: "",
        statusSince: now,
        nextCheckAt: now,
        active: false,
      });
      for (const monitor of [first, second]) {
        for (let index = 0; index < 105; index++) {
          await repos.beats.create({
            monitorId: monitor.id,
            at: new Date(clock.nowMillis() + index * 1000).toISOString(),
            ok: true,
            latencyMs: index,
          });
        }
      }
      const incident = await repos.incidents.create({
        monitorId: first.id,
        startedAt: now,
        cause: "connection",
      });
      expect(incident.endedAt).toBeUndefined();
      await clock.travel(1, "day");
      await expect.poll(() => repos.beats.count()).toBe(200);
      for (const monitor of [first, second]) {
        const beats = await repos.beats.findMany({
          where: { monitorId: monitor.id },
          orderBy: [{ column: "at", direction: "asc" }],
        });
        expect(beats).toHaveLength(100);
        expect(beats[0]?.latencyMs).toBe(5);
      }
      await repos.monitors.deleteById(first.id);
      expect(await repos.beats.count()).toBe(100);
      expect(await repos.incidents.count()).toBe(0);
      await repos.projects.deleteById(project.id, { force: true });
      expect(await repos.monitors.count()).toBe(0);
      expect(await repos.beats.count()).toBe(0);
    } finally {
      await alepha.stop();
    }
  });
});
