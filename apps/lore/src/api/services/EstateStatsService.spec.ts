import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { TestEntityRepositories } from "../../../test/fixtures/entities.ts";
import { EstateController } from "../controllers/EstateController.ts";
import { type Estate, estates } from "../entities/estates.ts";
import { LoreAnalytics } from "../entities/loreAnalytics.ts";
import { LoreApi } from "../index.ts";
import type { EstateStatsFrame } from "../schemas/estateStatsFrameSchema.ts";
import { EstateStatsService } from "./EstateStatsService.ts";

class EstateRepositories {
  estates = $repository(estates);
}

interface TestContext {
  alepha: Alepha;
  service: EstateStatsService;
  analytics: LoreAnalytics;
  estateApi: EstateController;
  repos: EstateRepositories;
  entities: TestEntityRepositories;
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
  alepha.with(LoreApi);

  const entities = alepha.inject(TestEntityRepositories);
  const repos = alepha.inject(EstateRepositories);

  await alepha.start();

  return {
    alepha,
    service: alepha.inject(EstateStatsService),
    analytics: alepha.inject(LoreAnalytics),
    estateApi: alepha.inject(EstateController),
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
 * An estate row straight from the repository, with the series switch where
 * the test wants it. The row is what the endpoint hands the service, so the
 * switch is read from the row and nothing else.
 */
const createEstate = async (
  ctx: TestContext,
  user: UserAccountToken,
  slug: string,
  collectSeries = false,
): Promise<Estate> => {
  const minted = await ctx.estateApi.createEstate({ body: { slug } }, { user });
  await ctx.repos.estates.updateById(minted.id, { collectSeries });
  return ctx.repos.estates.getOne({ where: { id: { eq: minted.id } } });
};

const reload = (ctx: TestContext, estate: Estate): Promise<Estate> =>
  ctx.repos.estates.getOne({ where: { id: { eq: estate.id } } });

/**
 * The machine's clock is deliberately far from Lore's, so a stamp copied
 * from the frame would be visible.
 */
const MACHINE_CLOCK = "2001-01-01T00:00:00.000Z";

const frame = (
  cpuPercent: number,
  memoryPercent: number,
): EstateStatsFrame => ({
  type: "stats",
  cpuPercent,
  memoryPercent,
  at: MACHINE_CLOCK,
});

/**
 * The dataset's sums for one estate, the raw material the mean is made of.
 */
const readSums = async (ctx: TestContext, estateId: string) => {
  const result = await ctx.analytics.stats.query({
    since: "2000-01-01",
    where: { estateId: { inArray: [estateId] } },
    select: { cpu: "sum", memory: "sum", samples: "sum" },
  });
  const row = result.rows[0];
  return {
    cpu: Number(row?.cpu ?? 0),
    memory: Number(row?.memory ?? 0),
    samples: Number(row?.samples ?? 0),
  };
};

describe("EstateStatsService", () => {
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
    const estate = await createEstate(ctx, owner, "ovh-1");
    expect(estate.cpuPercent).toBeUndefined();

    const before = ctx.dateTime.nowMillis();
    await ctx.service.record(estate, frame(34.5, 61));
    await ctx.service.record(estate, frame(40, 70));
    const after = ctx.dateTime.nowMillis();

    const row = await reload(ctx, estate);
    expect(row.cpuPercent).toBe(40);
    expect(row.memoryPercent).toBe(70);
    expect(row.statsAt).not.toBe(MACHINE_CLOCK);
    const statsAt = Date.parse(row.statsAt ?? "");
    expect(statsAt).toBeGreaterThanOrEqual(before);
    expect(statsAt).toBeLessThanOrEqual(after);

    // Two pushes, one row: the gauge is an upsert, never an append.
    const all = await ctx.repos.estates.findMany({
      where: { ownerUserId: { eq: owner.id } },
    });
    expect(all).toHaveLength(1);
  });

  it("writes nothing to the series while collectSeries is off", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const estate = await createEstate(ctx, owner, "quiet", false);

    await ctx.service.record(estate, frame(34.5, 61));

    expect(await readSums(ctx, estate.id)).toEqual({
      cpu: 0,
      memory: 0,
      samples: 0,
    });
  });

  it("writes the series while collectSeries is on, and the gauge keeps updating once it is off", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const estate = await createEstate(ctx, owner, "watched", true);

    await ctx.service.record(estate, frame(30, 50));
    await ctx.service.record(estate, frame(50, 70));
    expect(await readSums(ctx, estate.id)).toEqual({
      cpu: 80,
      memory: 120,
      samples: 2,
    });

    // The owner turns the series off. The next push is handed over with the
    // row as it now reads, since the endpoint loads it per frame.
    await ctx.repos.estates.updateById(estate.id, { collectSeries: false });
    await ctx.service.record(await reload(ctx, estate), frame(70, 90));

    const row = await reload(ctx, estate);
    expect(row.cpuPercent).toBe(70);
    expect(row.memoryPercent).toBe(90);
    expect(await readSums(ctx, estate.id)).toEqual({
      cpu: 80,
      memory: 120,
      samples: 2,
    });
  });

  it("reads the series back as daily means, with the disclosure attached", async ({
    expect,
  }) => {
    const owner = await createOwner(ctx);
    const estate = await createEstate(ctx, owner, "charted", true);
    const other = await createEstate(ctx, owner, "other", true);

    await ctx.service.record(estate, frame(20, 10));
    await ctx.service.record(estate, frame(40, 20));
    await ctx.service.record(estate, frame(60, 30));
    // Another estate's push must not leak into this one's mean.
    await ctx.service.record(other, frame(100, 100));

    const series = await ctx.service.series(estate.id, "2000-01-01");
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

  it("declares the dataset on the estate, pinned, with hot retention under the Analytics Engine ceiling", async ({
    expect,
  }) => {
    const dataset = ctx.analytics.stats.dataset;
    expect(dataset.name).toBe("estate_stats");
    expect(dataset.index).toBe("estateId");
    expect(Object.keys(dataset.dimensions.shape)).toEqual(["estateId"]);
    expect(Object.keys(dataset.measures.shape).sort()).toEqual([
      "cpu",
      "memory",
      "samples",
    ]);
    expect(dataset.slots).toEqual({
      dimensions: ["estateId"],
      measures: ["cpu", "memory", "samples"],
    });
    // `WaeAnalyticsProvider.assertRetention` refuses anything above roughly
    // 90 days at declaration time, on the one backend the tests never boot.
    const hotDays = Number(String(dataset.retention?.hot).replace(/d$/, ""));
    expect(hotDays).toBeGreaterThan(0);
    expect(hotDays).toBeLessThanOrEqual(90);
  });
});
