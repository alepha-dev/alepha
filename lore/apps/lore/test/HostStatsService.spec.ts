import {
  ProjectAnalytics,
  HostStatsService,
  HostController,
  projectEvents,
} from "@lore/core/api";
import { type Host, hosts, type HostStatsFrame } from "@lore/core/schemas";
import { createTestHost } from "@lore/core/testing/hosts";
import { LoreShipApi } from "@lore/ship/api";
import { DeployTestEntities } from "@lore/ship/testing";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

class HostRepositories {
  hosts = $repository(hosts);
  events = $repository(projectEvents);
}

interface TestContext {
  alepha: Alepha;
  service: HostStatsService;
  analytics: ProjectAnalytics;
  hostApi: HostController;
  repos: HostRepositories;
  entities: DeployTestEntities;
  dateTime: DateTimeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreShipApi);

  const entities = alepha.inject(DeployTestEntities);
  const repos = alepha.inject(HostRepositories);

  await alepha.start();

  return {
    alepha,
    service: alepha.inject(HostStatsService),
    analytics: alepha.inject(ProjectAnalytics),
    hostApi: alepha.inject(HostController),
    repos,
    entities,
    dateTime: alepha.inject(DateTimeProvider),
  };
};

const createOwner = async (ctx: TestContext): Promise<UserAccountToken> => {
  const user = await ctx.entities.users.create({});
  return { id: user.id, roles: ["user"] };
};

/**
 * A host row straight from the repository, with the series switch where
 * the test wants it. The row is what the endpoint hands the service, so the
 * switch is read from the row and nothing else.
 */
const createHost = async (
  ctx: TestContext,
  user: UserAccountToken,
  slug: string,
  collectSeries = false,
): Promise<Host> => {
  const minted = await createTestHost(ctx.alepha, user, { slug });
  await ctx.repos.hosts.updateById(minted.id, { collectSeries });
  return ctx.repos.hosts.getOne({ where: { id: { eq: minted.id } } });
};

const reload = (ctx: TestContext, host: Host): Promise<Host> =>
  ctx.repos.hosts.getOne({ where: { id: { eq: host.id } } });

/**
 * The machine's clock is deliberately far from Lore's, so a stamp copied
 * from the frame would be visible.
 */
const MACHINE_CLOCK = "2001-01-01T00:00:00.000Z";

const frame = (cpuPercent: number, memoryPercent: number): HostStatsFrame => ({
  type: "stats",
  cpuPercent,
  memoryPercent,
  at: MACHINE_CLOCK,
});

/**
 * The dataset's sums for one host, the raw material the mean is made of.
 */
const readSums = async (ctx: TestContext, hostId: string) => {
  const result = await ctx.analytics.hostStats.query({
    since: "2000-01-01",
    where: { hostId: { inArray: [hostId] } },
    select: { cpu: "sum", memory: "sum", samples: "sum" },
  });
  const row = result.rows[0];
  return {
    cpu: Number(row?.cpu ?? 0),
    memory: Number(row?.memory ?? 0),
    samples: Number(row?.samples ?? 0),
  };
};

describe("HostStatsService", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("upserts the gauge onto the row, stamped with Lore's clock rather than the machine's", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const host = await createHost(ctx, owner, "ovh-1");
    expect(host.cpuPercent).toBeUndefined();

    const before = ctx.dateTime.nowMillis();
    await ctx.service.record(host, frame(34.5, 61));
    await ctx.service.record(host, frame(40, 70));
    const after = ctx.dateTime.nowMillis();

    const row = await reload(ctx, host);
    expect(row.cpuPercent).toBe(40);
    expect(row.memoryPercent).toBe(70);
    expect(row.statsAt).not.toBe(MACHINE_CLOCK);
    const statsAt = Date.parse(row.statsAt ?? "");
    expect(statsAt).toBeGreaterThanOrEqual(before);
    expect(statsAt).toBeLessThanOrEqual(after);

    // Two pushes, one row: the gauge is an upsert, never an append.
    const all = await ctx.repos.hosts.findMany({
      where: { ownerUserId: { eq: owner.id } },
    });
    expect(all).toHaveLength(1);
  });

  it("writes nothing to the series while collectSeries is off", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const host = await createHost(ctx, owner, "quiet", false);

    await ctx.service.record(host, frame(34.5, 61));

    expect(await readSums(ctx, host.id)).toEqual({
      cpu: 0,
      memory: 0,
      samples: 0,
    });
  });

  it("writes the series while collectSeries is on, and the gauge keeps updating once it is off", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const host = await createHost(ctx, owner, "watched", true);

    await ctx.service.record(host, frame(30, 50));
    await ctx.service.record(host, frame(50, 70));
    expect(await readSums(ctx, host.id)).toEqual({
      cpu: 80,
      memory: 120,
      samples: 2,
    });

    // The owner turns the series off. The next push is handed over with the
    // row as it now reads, since the endpoint loads it per frame.
    await ctx.repos.hosts.updateById(host.id, { collectSeries: false });
    await ctx.service.record(await reload(ctx, host), frame(70, 90));

    const row = await reload(ctx, host);
    expect(row.cpuPercent).toBe(70);
    expect(row.memoryPercent).toBe(90);
    expect(await readSums(ctx, host.id)).toEqual({
      cpu: 80,
      memory: 120,
      samples: 2,
    });
  });

  it("reads the series back as daily means, with the disclosure attached", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const host = await createHost(ctx, owner, "charted", true);
    const other = await createHost(ctx, owner, "other", true);

    await ctx.service.record(host, frame(20, 10));
    await ctx.service.record(host, frame(40, 20));
    await ctx.service.record(host, frame(60, 30));
    // Another host's push must not leak into this one's mean.
    await ctx.service.record(other, frame(100, 100));

    const series = await ctx.service.series(host.id, "2000-01-01");
    expect(series.points).toHaveLength(1);
    expect(series.points[0]).toMatchObject({
      cpuPercent: 40,
      memoryPercent: 20,
      samples: 3,
    });
    expect(series.points[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The memory backend never samples; the field is there for the one
    // that does, so a renderer cannot take the points without it.
    expect(series.estimated).toBe(false);
  });

  it("buckets the series by hour or minute when asked, and the route picks the grain from its range (#Q4528)", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const host = await createHost(ctx, owner, "ranged", true);

    await ctx.service.record(host, frame(20, 10));
    await ctx.dateTime.travel(2, "hours");
    await ctx.service.record(host, frame(40, 20));

    const hourly = await ctx.service.series(host.id, "2000-01-01", "hour");
    expect(hourly.points).toHaveLength(2);
    expect(hourly.points[0].day).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
    expect(hourly.points.map((it) => it.cpuPercent)).toEqual([20, 40]);

    const answer = async (range: "hour" | "today" | "week" | "month") =>
      await ctx.hostApi.getHostStats(
        { params: { hostId: host.id }, query: { range } },
        { user: owner },
      );
    const lastHour = await answer("hour");
    expect(lastHour.grain).toBe("hour");
    // Only the push made after the jump is inside the last hour.
    expect(lastHour.points.map((it) => it.cpuPercent)).toEqual([40]);
    expect((await answer("today")).grain).toBe("hour");
    expect((await answer("week")).grain).toBe("day");
    const month = await answer("month");
    expect(month.grain).toBe("day");
    expect(month.points.length).toBeGreaterThan(0);
  });

  it("keeps disk and load as their own means, absent on a day no reading carried them", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const host = await createHost(ctx, owner, "disked", true);
    const old = await createHost(ctx, owner, "older-bay", true);

    await ctx.service.record(host, {
      ...frame(20, 10),
      diskPercent: 50,
      load1: 1,
    });
    // A reading without the disk (an older Bay, or a gauge that could not
    // read it) must not drag the disk mean towards zero.
    await ctx.service.record(host, frame(40, 20));
    await ctx.service.record(host, {
      ...frame(60, 30),
      diskPercent: 60,
      load1: 3,
    });
    await ctx.service.record(old, frame(10, 10));

    const series = await ctx.service.series(host.id, "2000-01-01");
    expect(series.points[0]).toMatchObject({
      cpuPercent: 40,
      diskPercent: 55,
      load1: 2,
      samples: 3,
    });
    const older = await ctx.service.series(old.id, "2000-01-01");
    expect(older.points[0].diskPercent).toBeUndefined();
    expect(older.points[0].load1).toBeUndefined();
  });

  it("raises a resource alert once at the threshold and clears it under the margin", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    let host = await createHost(ctx, owner, "full-disk");
    await ctx.repos.hosts.updateById(host.id, { alertDiskPercent: 85 });
    host = await reload(ctx, host);
    const push = async (disk: number) => {
      await ctx.service.record(host, { ...frame(10, 10), diskPercent: disk });
      host = await reload(ctx, host);
    };
    const names = async () =>
      (await ctx.repos.events.findMany({ orderBy: "occurredAt" }))
        .map((event) => event.name)
        .filter((name) => name.startsWith("host.resource_"));

    await push(80);
    expect(await names()).toEqual([]);
    await push(86);
    await push(90);
    // Hovering just under the limit is inside the margin: still raised.
    await push(83);
    expect(await names()).toEqual(["host.resource_high"]);
    expect(host.resourceAlerts?.disk).toBeDefined();
    await push(79);
    expect(await names()).toEqual(["host.resource_high", "host.resource_ok"]);
    expect(host.resourceAlerts?.disk).toBeUndefined();

    const [high] = await ctx.repos.events.findMany({
      where: { name: "host.resource_high" },
    });
    expect(high.fields).toMatchObject({
      host: "full-disk",
      resource: "disk",
      percent: 86,
      limit: 85,
    });
  });

  it("declares the dataset on the host, pinned, with hot retention under the Analytics Engine ceiling", async ({
    expect,
  }) => {
    const dataset = ctx.analytics.hostStats.dataset;
    expect(dataset.name).toBe("host_stats");
    expect(dataset.index).toBe("hostId");
    expect(Object.keys(dataset.dimensions.shape)).toEqual(["hostId"]);
    expect(Object.keys(dataset.measures.shape).sort()).toEqual([
      "cpu",
      "disk",
      "diskSamples",
      "load",
      "loadSamples",
      "memory",
      "samples",
    ]);
    // Append-only: the first three never move, #Q4420's four come after.
    expect(dataset.slots).toEqual({
      dimensions: ["hostId"],
      measures: [
        "cpu",
        "memory",
        "samples",
        "disk",
        "diskSamples",
        "load",
        "loadSamples",
      ],
    });
    // `WaeAnalyticsProvider.assertRetention` refuses anything above roughly
    // 90 days at declaration time, on the one backend the tests never boot.
    // The two-tier form, not a tier chain: a chain has no single `hot`.
    const retention = dataset.retention;
    expect(Array.isArray(retention)).toBe(false);
    const hot = Array.isArray(retention) ? undefined : retention?.hot;
    const hotDays = Number(String(hot).replace(/d$/, ""));
    expect(hotDays).toBeGreaterThan(0);
    expect(hotDays).toBeLessThanOrEqual(90);
  });
});
