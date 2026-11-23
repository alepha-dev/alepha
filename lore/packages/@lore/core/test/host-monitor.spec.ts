import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { hosts } from "../src/api/entities/hosts.ts";
import { projectEvents } from "../src/api/entities/projectEvents.ts";
import { LoreCoreApi } from "../src/api/index.ts";
import { HostOfflineJobs } from "../src/api/jobs/HostOfflineJobs.ts";
import { HostStatsService } from "../src/api/services/HostStatsService.ts";
import {
  CoreTestEntities,
  createTestProject,
} from "../src/testing/entities.ts";

class Rows {
  hosts = $repository(hosts);
  events = $repository(projectEvents);
}

/**
 * The monitor role with no Ship at all (#E166, #Q4101): a Bay enrolled only
 * to watch a VPS. Core alone is booted, the host's home project has Plan and
 * Build, and the host still records its stats, keeps a series, and raises
 * its offline alert.
 */
describe("a monitored host without Ship", () => {
  let alepha: Alepha;
  let rows: Rows;
  let dateTime: DateTimeProvider;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", APP_SECRET: "host-monitor-spec" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(LoreCoreApi);
    rows = alepha.inject(Rows);
    alepha.inject(CoreTestEntities);
    await alepha.start();
    dateTime = alepha.inject(DateTimeProvider);
    dateTime.pause();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const ago = (minutes: number) =>
    new Date(dateTime.nowMillis() - minutes * 60_000).toISOString();

  it("records stats, reads its series back and raises host.offline", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha, {
      capabilities: [{ key: "plan" }, { key: "build" }],
    });
    const host = await rows.hosts.create({
      projectId: project.id,
      ownerUserId: project.createdBy!,
      type: "bay",
      slug: "vps-ram",
      collectSeries: true,
      connectedAt: ago(60),
      lastSeenAt: ago(0),
      connectionId: "socket-1",
    });

    const stats = alepha.inject(HostStatsService);
    await stats.record(host, {
      type: "stats",
      cpuPercent: 12,
      memoryPercent: 81,
      at: ago(0),
    });
    const gauge = await rows.hosts.getById(host.id);
    expect(gauge.memoryPercent).toBe(81);
    const series = await stats.series(host.id, ago(60 * 24));
    expect(series.points.at(-1)).toMatchObject({ memoryPercent: 81 });

    // The machine goes quiet past the grace period.
    await rows.hosts.updateById(host.id, {
      lastSeenAt: ago(7),
      disconnectedAt: ago(6),
    });
    expect(await alepha.inject(HostOfflineJobs).sweep()).toEqual({
      offline: 1,
      online: 0,
    });
    const [offline] = await rows.events.findMany({
      where: { name: { eq: "host.offline" } },
    });
    expect(offline?.projectId).toBe(project.id);
    expect(offline?.fields).toMatchObject({ host: "vps-ram", kind: "bay" });
  });
});
