import { VITALS_BUCKETS } from "@alepha/lore/sigil";
import { $inject, Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { InsightsController } from "../src/api/controllers/InsightsController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { SigilController } from "../src/api/controllers/SigilController.ts";
import { LoreAnalytics } from "../src/api/entities/loreAnalytics.ts";
import { members } from "../src/api/entities/members.ts";
import { sigilErrorGroups } from "../src/api/entities/sigilErrorGroups.ts";
import { sigilUniquesDaily } from "../src/api/entities/sigilUniquesDaily.ts";
import { LoreApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

/**
 * Feeds fixtures straight into whatever `InsightsController` reads.
 *
 * Views and vitals are written into the `sigil_views` / `sigil_vitals`
 * `$analytics()` datasets — what the controller has read since Task 12.
 * Unique visitors and error groups stay on the legacy aggregate tables,
 * because those two questions stayed on `LoreAnalyticsStore` (a distinct
 * count cannot survive sampling or a rollup, and an error group keeps the
 * *first* stack sample, which needs a read before every write — see
 * `LoreAnalytics`'s class doc).
 *
 * Going through the ingest endpoint would only ever produce rows in the current
 * hour, and every assertion here is about a window.
 */
class Probe {
  members = $repository(members);
  uniques = $repository(sigilUniquesDaily);
  errorGroups = $repository(sigilErrorGroups);
  datasets = $inject(LoreAnalytics);

  views = {
    /**
     * One `sigil_views` row: the dimensions (`sigilId`, `path`, `country`,
     * `referrer`) plus the `count` measure, stamped at `hour` rather than the
     * clock — every fixture in this file backdates into a specific window.
     *
     * `referrer` is optional here and defaults on the dataset, so the fixtures
     * that predate it keep reading as they did: they are about paths and
     * countries, and spelling `referrer: "direct"` in each would be noise.
     */
    create: async (sample: {
      sigilId: string;
      hour: string;
      path: string;
      country: string;
      referrer?: string;
      campaign?: string;
      device?: string;
      browser?: string;
      os?: string;
      /**
       * `human` | `bot`, or `""` to stand in for a row written before the
       * dimension existed. Optional and defaulted on the dataset, like
       * `referrer`, so every fixture that predates the traffic filter keeps
       * reading as it did.
       */
      traffic?: string;
      count?: number;
      engaged?: number;
      entries?: number;
    }): Promise<void> => {
      await this.datasets.views.record(sample);
    },
  };

  vitals = {
    /**
     * One `sigil_vitals` histogram, from the same `b0`..`b6` bucket-count
     * shorthand the old `sigil_vitals_hourly` columns used — one dataset row
     * per bucket actually passed, `bucket` taken from the column name.
     */
    create: async (sample: {
      sigilId: string;
      hour: string;
      metric: string;
      path: string;
      b0?: number;
      b1?: number;
      b2?: number;
      b3?: number;
      b4?: number;
      b5?: number;
      b6?: number;
    }): Promise<void> => {
      const { sigilId, hour, metric, path, ...buckets } = sample;
      const rows = Object.entries(buckets)
        .filter(
          (entry): entry is [string, number] => typeof entry[1] === "number",
        )
        .map(([column, samples]) => ({
          sigilId,
          hour,
          metric,
          path,
          bucket: Number(column.slice(1)),
          samples,
        }));
      if (rows.length > 0) {
        await this.datasets.vitals.recordMany(rows);
      }
    },
  };

  errors = {
    /**
     * One `sigil_errors` occurrence bucket.
     *
     * ⚠️ A different table from `errorGroups` above, and deliberately so.
     * That one holds a running ALL-TIME total per fingerprint and cannot
     * carry a series; this dataset is append-only and is the only thing that
     * can say WHEN. A fixture written here is invisible to `errorGroups` and
     * vice versa, which is exactly the separation the assertions rely on.
     */
    create: async (sample: {
      sigilId: string;
      hour: string;
      origin?: string;
      fingerprint?: string;
      count: number;
    }): Promise<void> => {
      await this.datasets.errors.record(sample);
    },
  };
}

interface TestContext {
  alepha: Alepha;
  /**
   * The instant the whole test is pinned to.
   *
   * Every window in this file is derived twice — once by the fixtures, once by
   * the controller — and they used to be derived from two different clocks:
   * `new Date()` here, `DateTimeProvider.nowMillis()` there. A run that crossed
   * UTC midnight between seeding and asserting moved the controller's window
   * off the fixtures' days and failed for no reason. `pause()` makes it one
   * clock, and this is the value both sides read.
   */
  nowMs: number;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  sigilController: SigilController;
  insightsController: InsightsController;
  probe: Probe;
  fakeProvider: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  const probe = alepha.inject(Probe);
  const dateTime = alepha.inject(DateTimeProvider);
  await alepha.start();

  // Freeze before anything reads the clock, so the fixtures and the controller
  // cannot disagree about what day it is.
  dateTime.pause();

  return {
    alepha,
    nowMs: dateTime.nowMillis(),
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    sigilController: alepha.inject(SigilController),
    insightsController: alepha.inject(InsightsController),
    probe,
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (
  ctx: TestContext,
): Promise<{ id: string; roles: string[] }> => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

/**
 * Project titles derive a globally unique URL slug, so two projects cannot
 * share one — the cross-project isolation tests below create a second project.
 * A counter rather than a timestamp keeps the titles deterministic.
 */
let projectSeq = 0;

const createProject = async (
  ctx: TestContext,
  user: { id: string; roles: string[] },
): Promise<number> => {
  projectSeq += 1;
  // `sigils` is the only flag this suite needs: the retired `beacon` project
  // flag this fixture used to set is read by nothing since capabilities moved
  // onto each sigil's own `kinds`, and the insights endpoints carry no feature
  // check of their own — they are member-gated like any other project read.
  const created = await ctx.projectController.createProject.fetch(
    { body: { title: `Insights ${projectSeq}`, features: { sigils: true } } },
    { user },
  );
  return created.data.id;
};

const createSigil = async (
  ctx: TestContext,
  projectId: number,
  name: string,
  user: { id: string; roles: string[] },
): Promise<string> => {
  const created = await ctx.sigilController.createSigil.fetch(
    {
      params: { projectId },
      body: { name, kinds: ["beacon", "vitals"] },
    },
    { user },
  );
  return created.data.id;
};

/**
 * `YYYY-MM-DD` for `daysAgo` days before the pinned instant, UTC.
 */
const dayUtc = (ctx: TestContext, daysAgo: number): string => {
  const day = new Date(ctx.nowMs);
  day.setUTCDate(day.getUTCDate() - daysAgo);
  return day.toISOString().slice(0, 10);
};

/**
 * `YYYY-MM-DDTHH` for a given UTC hour of a day `daysAgo` back.
 */
const hourUtc = (ctx: TestContext, daysAgo: number, hour: number): string =>
  `${dayUtc(ctx, daysAgo)}T${String(hour).padStart(2, "0")}`;

/**
 * A full ISO instant `daysAgo` days before the pinned one.
 *
 * Error groups store real timestamps, not bucket keys — the window filter
 * compares them lexicographically against a `YYYY-MM-DD` `since`, which is what
 * these fixtures exercise.
 */
const instantUtc = (ctx: TestContext, daysAgo: number): string => {
  const at = new Date(ctx.nowMs);
  at.setUTCDate(at.getUTCDate() - daysAgo);
  return at.toISOString();
};

describe("InsightsController", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("totals views and unique visitors over the window", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);

    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 9),
      path: "/",
      country: "FR",
      count: 10,
    });
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 2, 13),
      path: "/about",
      country: "US",
      count: 5,
    });
    for (const visitorHash of ["h1", "h2"]) {
      await ctx.probe.uniques.create({
        sigilId,
        day: dayUtc(ctx, 0),
        visitorHash,
      });
    }
    await ctx.probe.uniques.create({
      sigilId,
      day: dayUtc(ctx, 2),
      visitorHash: "h3",
    });

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { range: "7d" } },
      { user: owner },
    );

    expect(res.data.totalViews).toBe(15);
    expect(res.data.uniqueVisitors).toBe(3);
  });

  it("excludes rows outside the window", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);

    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 1),
      path: "/",
      country: "FR",
      count: 4,
    });
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 20, 1),
      path: "/old",
      country: "FR",
      count: 99,
    });
    await ctx.probe.uniques.create({
      sigilId,
      day: dayUtc(ctx, 0),
      visitorHash: "h1",
    });
    await ctx.probe.uniques.create({
      sigilId,
      day: dayUtc(ctx, 20),
      visitorHash: "old",
    });

    const week = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { range: "7d" } },
      { user: owner },
    );
    expect(week.data.totalViews).toBe(4);
    expect(week.data.uniqueVisitors).toBe(1);

    const month = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { range: "30d" } },
      { user: owner },
    );
    expect(month.data.totalViews).toBe(103);
    expect(month.data.uniqueVisitors).toBe(2);
  });

  it("orders top countries by views, descending", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);

    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 8),
      path: "/",
      country: "FR",
      count: 3,
    });
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 8),
      path: "/",
      country: "US",
      count: 12,
    });
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 1, 8),
      path: "/x",
      country: "FR",
      count: 4,
    });

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { range: "30d" } },
      { user: owner },
    );

    expect(res.data.topCountries[0]).toEqual({ country: "US", count: 12 });
    expect(res.data.topCountries[1]).toEqual({ country: "FR", count: 7 });
  });

  it("gives each top path a count and a share of the total", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);

    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 8),
      path: "/",
      country: "FR",
      count: 30,
    });
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 8),
      path: "/about",
      country: "US",
      count: 10,
    });

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { range: "30d" } },
      { user: owner },
    );

    expect(res.data.topPaths[0]).toEqual({
      path: "/",
      count: 30,
      percentage: 75,
    });
    expect(res.data.topPaths[1].percentage).toBe(25);
  });

  it("ranks referrer hosts and keeps `direct` on the same leaderboard", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);

    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 8),
      path: "/",
      country: "FR",
      referrer: "direct",
      count: 60,
    });
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 8),
      path: "/",
      country: "US",
      referrer: "news.ycombinator.com",
      count: 30,
    });
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 8),
      path: "/",
      country: "US",
      referrer: "www.google.com",
      count: 10,
    });

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { range: "30d" } },
      { user: owner },
    );

    // `direct` stays in, and stays first. It is the denominator: dropping it
    // would make Hacker News read as 75% of traffic instead of 30%.
    expect(res.data.topReferrers).toEqual([
      { referrer: "direct", count: 60, percentage: 60 },
      { referrer: "news.ycombinator.com", count: 30, percentage: 30 },
      { referrer: "www.google.com", count: 10, percentage: 10 },
    ]);
  });

  it("separates arrivals from total views, and ranks landing pages", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);

    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 8),
      path: "/",
      country: "FR",
      count: 30,
      entries: 8,
    });
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 8),
      path: "/docs",
      country: "FR",
      count: 20,
      entries: 2,
    });

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { range: "30d" } },
      { user: owner },
    );

    expect(res.data.totalViews).toBe(50);
    expect(res.data.entries).toBe(10);
    // `/docs` is 40% of views but only 20% of arrivals — the distinction
    // `topPaths` alone cannot make.
    expect(res.data.topEntryPaths).toEqual([
      { path: "/", count: 8, percentage: 80 },
      { path: "/docs", count: 2, percentage: 20 },
    ]);
  });

  it("reports engagement as a share of views", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);

    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 8),
      path: "/",
      country: "FR",
      count: 200,
      entries: 200,
    });
    // Engagement arrives on its own row with `count: 0` — append-only.
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 9),
      path: "/",
      country: "FR",
      count: 0,
      engaged: 20,
    });

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { range: "30d" } },
      { user: owner },
    );

    // The engagement row must not be counted as traffic.
    expect(res.data.totalViews).toBe(200);
    expect(res.data.engagedViews).toBe(20);
    expect(res.data.engagementRate).toBe(10);
  });

  it("ranks campaigns by arrivals, not by how much each visitor read", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);

    // One visitor from HN who read ten pages, five who arrived untagged and
    // bounced. Summing `count` would rank HN first and say nothing true.
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 8),
      path: "/",
      country: "FR",
      campaign: "hn",
      count: 10,
      entries: 1,
    });
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 8),
      path: "/",
      country: "FR",
      campaign: "none",
      count: 5,
      entries: 5,
    });

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { range: "30d" } },
      { user: owner },
    );

    expect(res.data.topCampaigns).toEqual([
      { campaign: "none", count: 5 },
      { campaign: "hn", count: 1 },
    ]);
  });

  it("breaks views down by device", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);

    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 8),
      path: "/",
      country: "FR",
      device: "desktop",
      count: 12,
    });
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 8),
      path: "/",
      country: "FR",
      device: "mobile",
      count: 7,
    });

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { range: "30d" } },
      { user: owner },
    );

    expect(res.data.topDevices).toEqual([
      { device: "desktop", count: 12 },
      { device: "mobile", count: 7 },
    ]);
  });

  it("narrows every view number to one traffic population", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const sigilId = await createSigil(ctx, projectId, "docs-prod", owner);

    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 8),
      path: "/guides",
      country: "FR",
      traffic: "human",
      count: 3,
      entries: 1,
      engaged: 2,
    });
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 8),
      path: "/reference",
      country: "US",
      traffic: "bot",
      count: 7,
      entries: 7,
      engaged: 0,
    });

    const query = { range: "30d" } as const;
    const all = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query },
      { user: owner },
    );
    const humans = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { ...query, traffic: "humans" } },
      { user: owner },
    );
    const bots = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { ...query, traffic: "bots" } },
      { user: owner },
    );

    expect(all.data.totalViews).toBe(10);
    expect(humans.data.totalViews).toBe(3);
    expect(bots.data.totalViews).toBe(7);

    // Not just the headline: the filter rides on the shared `where`, so the
    // leaderboards and the derived rates move with it. A page that filtered
    // the total and not the top-pages list would be worse than no filter.
    expect(humans.data.topPaths.map((p) => p.path)).toEqual(["/guides"]);
    expect(bots.data.topPaths.map((p) => p.path)).toEqual(["/reference"]);
    expect(humans.data.entries).toBe(1);
    expect(bots.data.engagementRate).toBe(0);

    // Echoed back, because the page renders the caveat from the payload.
    expect(all.data.traffic).toBe("all");
    expect(humans.data.traffic).toBe("humans");
  });

  it("counts a view recorded before the dimension existed as human", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const sigilId = await createSigil(ctx, projectId, "docs-prod", owner);

    // What a row written before `traffic` shipped actually holds. The
    // dimension's default fills a column on write; it does not reach back.
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 8),
      path: "/",
      country: "FR",
      traffic: "",
      count: 5,
    });

    const humans = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { range: "30d", traffic: "humans" } },
      { user: owner },
    );
    const bots = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { range: "30d", traffic: "bots" } },
      { user: owner },
    );

    // Dropping history out of the humans view would read as the traffic
    // collapsing on the deploy date.
    expect(humans.data.totalViews).toBe(5);
    expect(bots.data.totalViews).toBe(0);
  });

  it("narrows the unique-visitor count too", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const sigilId = await createSigil(ctx, projectId, "docs-prod", owner);

    const day = dayUtc(ctx, 0);
    await ctx.probe.uniques.create({
      sigilId,
      day,
      visitorHash: "hash-reader",
      traffic: "human",
    });
    await ctx.probe.uniques.create({
      sigilId,
      day,
      visitorHash: "hash-crawler",
      traffic: "bot",
    });

    const query = { range: "30d" } as const;
    const all = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query },
      { user: owner },
    );
    const humans = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { ...query, traffic: "humans" } },
      { user: owner },
    );
    const bots = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { ...query, traffic: "bots" } },
      { user: owner },
    );

    // The headline the page leads with. Leaving it unfiltered while every
    // number beside it moved was the whole reason this was worth doing: two
    // populations rendered side by side look comparable and are not.
    expect(all.data.uniqueVisitors).toBe(2);
    expect(humans.data.uniqueVisitors).toBe(1);
    expect(bots.data.uniqueVisitors).toBe(1);
  });

  it("counts a visitor recorded before the column existed as human", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const sigilId = await createSigil(ctx, projectId, "docs-prod", owner);

    // The column default is what every pre-existing row was backfilled to, so
    // this is what production's 219 rows look like the moment the migration
    // lands. Written without a `traffic` to prove the default carries it.
    await ctx.probe.uniques.create({
      sigilId,
      day: dayUtc(ctx, 0),
      visitorHash: "hash-legacy",
    });

    const humans = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { range: "30d", traffic: "humans" } },
      { user: owner },
    );
    const bots = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { range: "30d", traffic: "bots" } },
      { user: owner },
    );

    expect(humans.data.uniqueVisitors).toBe(1);
    expect(bots.data.uniqueVisitors).toBe(0);
  });

  it("folds hour buckets into a zero-filled daily timeline", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);

    // Two hours of the same day — the day point is their sum, which is the one
    // thing a `substr(hour, 1, 10)` group has to get right.
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 9),
      path: "/",
      country: "FR",
      count: 6,
    });
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 0, 17),
      path: "/",
      country: "FR",
      count: 4,
    });
    await ctx.probe.views.create({
      sigilId,
      hour: hourUtc(ctx, 3, 12),
      path: "/",
      country: "US",
      count: 2,
    });

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { range: "7d" } },
      { user: owner },
    );

    expect(res.data.timeline).toHaveLength(7);
    const byDate = new Map(res.data.timeline.map((p) => [p.date, p.views]));
    expect(byDate.get(dayUtc(ctx, 0))).toBe(10);
    expect(byDate.get(dayUtc(ctx, 3))).toBe(2);
    expect(byDate.get(dayUtc(ctx, 1))).toBe(0);
  });

  it("counts a visitor seen in two apps on one day once", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const prod = await createSigil(ctx, projectId, "lore-prod", owner);
    const staging = await createSigil(ctx, projectId, "lore-staging", owner);

    await ctx.probe.uniques.create({
      sigilId: prod,
      day: dayUtc(ctx, 0),
      visitorHash: "shared",
    });
    await ctx.probe.uniques.create({
      sigilId: staging,
      day: dayUtc(ctx, 0),
      visitorHash: "shared",
    });
    await ctx.probe.uniques.create({
      sigilId: staging,
      day: dayUtc(ctx, 0),
      visitorHash: "other",
    });

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { range: "7d" } },
      { user: owner },
    );

    expect(res.data.uniqueVisitors).toBe(2);
  });

  it("returns an empty snapshot for a project with no sigils", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { range: "7d" } },
      { user: owner },
    );

    expect(res.data.totalViews).toBe(0);
    expect(res.data.topPaths).toEqual([]);
    expect(res.data.topReferrers).toEqual([]);
    expect(res.data.entries).toBe(0);
    expect(res.data.engagedViews).toBe(0);
    expect(res.data.engagementRate).toBe(0);
    expect(res.data.topEntryPaths).toEqual([]);
    expect(res.data.topCampaigns).toEqual([]);
    expect(res.data.topDevices).toEqual([]);
    expect(res.data.timeline).toHaveLength(7);
    // Present with zero samples rather than absent: "no apps" and "no samples
    // yet" render the same, so the tab does not branch on which nothing it got.
    expect(res.data.vitals.lcp.samples).toBe(0);
    expect(res.data.vitals.lcp.p75Bucket).toBeNull();
    expect(res.data.vitals.lcp.buckets).toHaveLength(
      VITALS_BUCKETS.lcp.length + 1,
    );
    expect(res.data.errorGroups).toEqual([]);
  });

  describe("error budget", () => {
    /*
      `sigil_error_groups` was written on every accepted error and read by
      nothing outside `test/` — the per-app error budget the delete
      confirmation warns you about losing had no surface that could show it.
      These pin the surface that now does.
    */
    it("reports each app's groups separately, worst first", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const prod = await createSigil(ctx, projectId, "lore-prod", owner);
      const staging = await createSigil(ctx, projectId, "lore-staging", owner);

      // One fingerprint, both apps. The Blights inbox folds these into a single
      // row on purpose; the budget must not, or "is it still happening over
      // there" has no answer.
      await ctx.probe.errorGroups.create({
        sigilId: prod,
        fingerprint: "fp-shared",
        name: "TypeError",
        message: "boom",
        stackSample: "TypeError: boom",
        sourceUrl: "https://demo.example.com/cart",
        firstSeenAt: instantUtc(ctx, 3),
        lastSeenAt: instantUtc(ctx, 0),
        count: 4,
      });
      await ctx.probe.errorGroups.create({
        sigilId: staging,
        fingerprint: "fp-shared",
        name: "TypeError",
        message: "boom",
        stackSample: "TypeError: boom",
        sourceUrl: "https://demo.example.com/cart",
        firstSeenAt: instantUtc(ctx, 2),
        lastSeenAt: instantUtc(ctx, 0),
        count: 11,
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(res.data.errorGroups).toHaveLength(2);
      expect(res.data.errorGroups[0]).toMatchObject({
        sigilId: staging,
        sigilLabel: "lore-staging",
        fingerprint: "fp-shared",
        name: "TypeError",
        message: "boom",
        count: 11,
      });
      expect(res.data.errorGroups[1]).toMatchObject({
        sigilId: prod,
        sigilLabel: "lore-prod",
        count: 4,
      });
    });

    it("drops a group that stopped happening before the window", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);

      // Filtered on `lastSeenAt`, not `firstSeenAt`: an old bug that fired an
      // hour ago is in the budget, and one that stopped last month is not —
      // even though it started inside the window's reach.
      await ctx.probe.errorGroups.create({
        sigilId,
        fingerprint: "fp-old",
        name: "RangeError",
        message: "stale",
        stackSample: "RangeError: stale",
        sourceUrl: "",
        firstSeenAt: instantUtc(ctx, 40),
        lastSeenAt: instantUtc(ctx, 20),
        count: 99,
      });
      await ctx.probe.errorGroups.create({
        sigilId,
        fingerprint: "fp-live",
        name: "TypeError",
        message: "fresh",
        stackSample: "TypeError: fresh",
        sourceUrl: "",
        firstSeenAt: instantUtc(ctx, 40),
        lastSeenAt: instantUtc(ctx, 1),
        count: 2,
      });

      const week = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );
      expect(week.data.errorGroups.map((g) => g.fingerprint)).toEqual([
        "fp-live",
      ]);

      const month = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "30d" } },
        { user: owner },
      );
      expect(month.data.errorGroups.map((g) => g.fingerprint).sort()).toEqual([
        "fp-live",
        "fp-old",
      ]);
    });

    it("never shows another project's groups", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const stranger = await createTestUser(ctx);
      const mine = await createProject(ctx, owner);
      const theirs = await createProject(ctx, stranger);
      const myScope = await createSigil(ctx, mine, "lore-prod", owner);
      const theirScope = await createSigil(ctx, theirs, "lore-prod", stranger);

      for (const [sigilId, fingerprint] of [
        [myScope, "fp-mine"],
        [theirScope, "fp-theirs"],
      ] as const) {
        await ctx.probe.errorGroups.create({
          sigilId,
          fingerprint,
          name: "TypeError",
          message: "boom",
          stackSample: "TypeError: boom",
          sourceUrl: "",
          firstSeenAt: instantUtc(ctx, 1),
          lastSeenAt: instantUtc(ctx, 0),
          count: 1,
        });
      }

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId: mine }, query: { range: "7d" } },
        { user: owner },
      );

      expect(res.data.errorGroups.map((g) => g.fingerprint)).toEqual([
        "fp-mine",
      ]);
    });

    /**
     * `origin` has been on the row since the table existed and was never
     * mapped onto the wire, so the browser/server split the report asked for
     * (feedback #2085) was a schema field away the whole time.
     */
    it("carries each group's origin", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);

      for (const [fingerprint, origin, count] of [
        ["fp-client", "client", 3],
        ["fp-server", "server", 9],
      ] as const) {
        await ctx.probe.errorGroups.create({
          sigilId,
          fingerprint,
          name: "TypeError",
          message: "boom",
          stackSample: "TypeError: boom",
          sourceUrl: "",
          origin,
          firstSeenAt: instantUtc(ctx, 1),
          lastSeenAt: instantUtc(ctx, 0),
          count,
        });
      }

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(
        res.data.errorGroups.map((g) => [g.fingerprint, g.origin]),
      ).toEqual([
        ["fp-server", "server"],
        ["fp-client", "client"],
      ]);
    });
  });

  /**
   * The series, which is a different table from the groups above and exists
   * because that one structurally cannot hold one: it keeps a running
   * all-time total per fingerprint, never the occurrences.
   */
  describe("error series", () => {
    it("splits the window by day and by origin", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);

      await ctx.probe.errors.create({
        sigilId,
        hour: hourUtc(ctx, 2, 9),
        origin: "client",
        fingerprint: "fp-a",
        count: 3,
      });
      // Same day, same origin, a second bucket: the two have to sum.
      await ctx.probe.errors.create({
        sigilId,
        hour: hourUtc(ctx, 2, 14),
        origin: "client",
        fingerprint: "fp-b",
        count: 4,
      });
      await ctx.probe.errors.create({
        sigilId,
        hour: hourUtc(ctx, 2, 14),
        origin: "server",
        fingerprint: "fp-c",
        count: 5,
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );

      const day = res.data.errorSeries.find((p) => p.date === dayUtc(ctx, 2));
      expect(day).toMatchObject({ client: 7, server: 5 });
    });

    it("zeroes every day in the window, so a quiet week is not a short one", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);

      await ctx.probe.errors.create({
        sigilId,
        hour: hourUtc(ctx, 1, 9),
        origin: "server",
        count: 2,
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );

      // Seven days, every one present, and the six with nothing at zero.
      expect(res.data.errorSeries).toHaveLength(7);
      expect(
        res.data.errorSeries.every(
          (p) => typeof p.client === "number" && typeof p.server === "number",
        ),
      ).toBe(true);
      expect(
        res.data.errorSeries.reduce((n, p) => n + p.client + p.server, 0),
      ).toBe(2);
    });

    /**
     * The whole reason this dataset exists. `errorGroups[].count` is a
     * running ALL-TIME total on a row filtered by `lastSeenAt`, so a group
     * that has fired 99 times over a year and once yesterday reports 99 in a
     * 7-day window. Plotting that would be wrong in a way no reader could
     * detect, which is what the series avoids.
     */
    it("does not take its numbers from the groups' all-time counts", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);

      await ctx.probe.errorGroups.create({
        sigilId,
        fingerprint: "fp-ancient",
        name: "TypeError",
        message: "boom",
        stackSample: "TypeError: boom",
        sourceUrl: "",
        firstSeenAt: instantUtc(ctx, 300),
        lastSeenAt: instantUtc(ctx, 1),
        count: 99,
      });
      await ctx.probe.errors.create({
        sigilId,
        hour: hourUtc(ctx, 1, 9),
        origin: "client",
        fingerprint: "fp-ancient",
        count: 1,
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );

      // The group still reports its lifetime figure, and the series reports
      // the window. Both are true; only one of them may be drawn.
      expect(res.data.errorGroups[0]?.count).toBe(99);
      expect(
        res.data.errorSeries.reduce((n, p) => n + p.client + p.server, 0),
      ).toBe(1);
    });

    it("never counts another project's errors", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const stranger = await createTestUser(ctx);
      const mine = await createProject(ctx, owner);
      const theirs = await createProject(ctx, stranger);
      const myScope = await createSigil(ctx, mine, "lore-prod", owner);
      const theirScope = await createSigil(ctx, theirs, "lore-prod", stranger);

      await ctx.probe.errors.create({
        sigilId: myScope,
        hour: hourUtc(ctx, 1, 9),
        origin: "client",
        count: 1,
      });
      await ctx.probe.errors.create({
        sigilId: theirScope,
        hour: hourUtc(ctx, 1, 9),
        origin: "client",
        count: 50,
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId: mine }, query: { range: "7d" } },
        { user: owner },
      );

      expect(
        res.data.errorSeries.reduce((n, p) => n + p.client + p.server, 0),
      ).toBe(1);
    });
  });

  describe("per-app filter", () => {
    /*
      `?sigilId=` is what the per-app page reads. It narrows the same set the
      project-wide answer is built from, so the two cannot disagree — and it is
      the one place a caller-supplied id reaches the query, which is why the
      cross-project case is pinned as hard as the happy path.
    */
    it("narrows every segment to the app asked for", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const prod = await createSigil(ctx, projectId, "lore-prod", owner);
      const staging = await createSigil(ctx, projectId, "lore-staging", owner);

      await ctx.probe.views.create({
        sigilId: prod,
        hour: hourUtc(ctx, 0, 9),
        path: "/",
        country: "FR",
        count: 10,
      });
      await ctx.probe.views.create({
        sigilId: staging,
        hour: hourUtc(ctx, 0, 9),
        path: "/staging",
        country: "FR",
        count: 3,
      });
      await ctx.probe.uniques.create({
        sigilId: prod,
        day: dayUtc(ctx, 0),
        visitorHash: "h1",
      });
      await ctx.probe.uniques.create({
        sigilId: staging,
        day: dayUtc(ctx, 0),
        visitorHash: "h2",
      });
      await ctx.probe.errorGroups.create({
        sigilId: staging,
        fingerprint: "fp-staging",
        name: "TypeError",
        message: "boom",
        stackSample: "TypeError: boom",
        sourceUrl: "",
        firstSeenAt: instantUtc(ctx, 1),
        lastSeenAt: instantUtc(ctx, 0),
        count: 2,
      });

      const scoped = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d", sigilId: prod } },
        { user: owner },
      );

      expect(scoped.data.totalViews).toBe(10);
      expect(scoped.data.uniqueVisitors).toBe(1);
      expect(scoped.data.topPaths.map((p) => p.path)).toEqual(["/"]);
      expect(scoped.data.errorGroups).toEqual([]);

      // Omitted, the same call still answers for the whole project — the
      // per-app page must not have changed what everything else reads.
      const whole = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );
      expect(whole.data.totalViews).toBe(13);
      expect(whole.data.uniqueVisitors).toBe(2);
      expect(whole.data.errorGroups).toHaveLength(1);
    });

    it("merges vitals for one app only", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const fast = await createSigil(ctx, projectId, "lore-prod", owner);
      const slow = await createSigil(ctx, projectId, "lore-staging", owner);

      await ctx.probe.vitals.create({
        sigilId: fast,
        hour: hourUtc(ctx, 0, 10),
        metric: "lcp",
        path: "/",
        b0: 3,
      });
      await ctx.probe.vitals.create({
        sigilId: slow,
        hour: hourUtc(ctx, 0, 11),
        metric: "lcp",
        path: "/",
        b6: 3,
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d", sigilId: fast } },
        { user: owner },
      );

      // Only the fast app's histogram — the slow one's overflow samples would
      // drag the merged p75 into the overflow bucket.
      expect(res.data.vitals.lcp.p75Bucket).toBe(0);
      expect(res.data.vitals.lcp.p75Upper).toBe(VITALS_BUCKETS.lcp[0]);
    });

    it("refuses a sigil id from another project", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const stranger = await createTestUser(ctx);
      const mine = await createProject(ctx, owner);
      const theirs = await createProject(ctx, stranger);
      await createSigil(ctx, mine, "lore-prod", owner);
      const theirSigil = await createSigil(ctx, theirs, "lore-prod", stranger);

      await ctx.probe.views.create({
        sigilId: theirSigil,
        hour: hourUtc(ctx, 0, 9),
        path: "/secret",
        country: "FR",
        count: 99,
      });

      // The membership check is on the project in the path, so the id in the
      // query has to be proved to belong to it — otherwise a member of any
      // project could read any other project's rows by pasting a sigil id.
      await expect(
        ctx.insightsController.getInsights.fetch(
          {
            params: { projectId: mine },
            query: { range: "7d", sigilId: theirSigil },
          },
          { user: owner },
        ),
      ).rejects.toThrow(/not found/i);
    });

    it("refuses a sigil id that exists nowhere", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      await createSigil(ctx, projectId, "lore-prod", owner);

      await expect(
        ctx.insightsController.getInsights.fetch(
          {
            params: { projectId },
            query: {
              range: "7d",
              sigilId: "00000000-0000-4000-8000-000000000000",
            },
          },
          { user: owner },
        ),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("vitals p75", () => {
    it("walks the stored histogram to a p75 boundary", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);

      // 1 sample in bucket 0, 2 in bucket 2, 1 in the overflow bucket.
      // Total 4, target = ceil(0.75 × 4) = 3. Cumulative reaches 3 at bucket 2,
      // whose upper boundary is 2500.
      await ctx.probe.vitals.create({
        sigilId,
        hour: hourUtc(ctx, 0, 10),
        metric: "lcp",
        path: "/",
        b0: 1,
        b2: 2,
        b6: 1,
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(VITALS_BUCKETS.lcp[2]).toBe(2500);
      // The RANGE the p75 falls in, not its ceiling wearing a millisecond
      // suffix: 1800 to 2500, which is the width the four samples support.
      expect(res.data.vitals.lcp.p75Bucket).toBe(2);
      expect(res.data.vitals.lcp.p75Lower).toBe(1800);
      expect(res.data.vitals.lcp.p75Upper).toBe(2500);
      expect(res.data.vitals.lcp.samples).toBe(4);
      // The shape, including the overflow tail a single number hid entirely.
      expect(res.data.vitals.lcp.buckets).toEqual([1, 0, 2, 0, 0, 0, 1]);
    });

    it("merges histograms across sigils rather than averaging percentiles", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const prod = await createSigil(ctx, projectId, "lore-prod", owner);
      const staging = await createSigil(ctx, projectId, "lore-staging", owner);

      // Fast app: 3 samples in bucket 0. Slow one: 1 sample in the
      // overflow bucket. Merged, 4 samples with target 3 → still bucket 0's
      // boundary. Averaging the two p75s would have said otherwise.
      await ctx.probe.vitals.create({
        sigilId: prod,
        hour: hourUtc(ctx, 0, 10),
        metric: "lcp",
        path: "/",
        b0: 3,
      });
      await ctx.probe.vitals.create({
        sigilId: staging,
        hour: hourUtc(ctx, 0, 11),
        metric: "lcp",
        path: "/",
        b6: 1,
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(VITALS_BUCKETS.lcp[0]).toBe(1000);
      expect(res.data.vitals.lcp.p75Bucket).toBe(0);
      // The first bucket runs from zero: "0 to 1000 ms" is its honest width,
      // and the old point estimate reported the pessimistic end of it.
      expect(res.data.vitals.lcp.p75Lower).toBe(0);
      expect(res.data.vitals.lcp.p75Upper).toBe(1000);
    });

    it("returns an empty distribution for a metric with no sample in the window", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);

      await ctx.probe.vitals.create({
        sigilId,
        hour: hourUtc(ctx, 20, 10),
        metric: "lcp",
        path: "/",
        b0: 5,
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );

      for (const metric of ["lcp", "cls", "inp", "fcp", "ttfb"] as const) {
        expect(res.data.vitals[metric].samples).toBe(0);
        expect(res.data.vitals[metric].p75Bucket).toBeNull();
        expect(res.data.vitals[metric].p75Lower).toBeNull();
        expect(res.data.vitals[metric].p75Upper).toBeNull();
      }
    });

    /**
     * The overflow bucket is a real answer, not a clamp. The old walk returned
     * the last boundary for it, which read as "exactly 6000 ms" and hid the
     * fact that every sample was worse than that.
     */
    it("names no ceiling for a p75 in the overflow bucket", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);

      await ctx.probe.vitals.create({
        sigilId,
        hour: hourUtc(ctx, 0, 10),
        metric: "lcp",
        path: "/",
        b6: 4,
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(res.data.vitals.lcp.p75Bucket).toBe(VITALS_BUCKETS.lcp.length);
      expect(res.data.vitals.lcp.p75Lower).toBe(6000);
      expect(res.data.vitals.lcp.p75Upper).toBeNull();
    });

    /**
     * The number that decides whether any of the rest is worth reading. Two
     * production apps rated an LCP off 7 samples and off 1, and their cards
     * looked exactly like the one built on 346.
     */
    it("reports the sample count behind every metric", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);

      await ctx.probe.vitals.create({
        sigilId,
        hour: hourUtc(ctx, 0, 10),
        metric: "lcp",
        path: "/",
        b0: 5,
        b3: 2,
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(res.data.vitals.lcp.samples).toBe(7);
      expect(res.data.vitals.inp.samples).toBe(0);
    });

    it("reports CLS as the real score, not the ×1000 integer", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);

      // CLS is bucketed on the collector's ×1000 integer, so the boundary is
      // 50 and the score is 0.05. Undoing the scaling is the controller's job,
      // not the chart's.
      await ctx.probe.vitals.create({
        sigilId,
        hour: hourUtc(ctx, 0, 10),
        metric: "cls",
        path: "/",
        b0: 1,
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(res.data.vitals.cls.p75Upper).toBeCloseTo(
        VITALS_BUCKETS.cls[0] / 1000,
        10,
      );
      // The boundaries travel with the counts, un-scaled, so a chart labels
      // itself from the same values the counts were bucketed with.
      expect(res.data.vitals.cls.boundaries).toEqual([
        0.05, 0.1, 0.15, 0.25, 0.4, 0.6,
      ]);
    });
  });

  it("lets a member read, and refuses a stranger", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const member = await createTestUser(ctx);
    const stranger = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    await createSigil(ctx, projectId, "lore-prod", owner);
    await ctx.probe.members.create({ userId: member.id, projectId });

    const res = await ctx.insightsController.getInsights.fetch(
      { params: { projectId }, query: { range: "7d" } },
      { user: member },
    );
    expect(res.data.range).toBe("7d");

    await expect(
      ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: stranger },
      ),
    ).rejects.toThrow();
  });

  describe("complete-day window and comparison", () => {
    /**
     * The reason this mode exists. `range: "1d"` means today-so-far, so
     * measuring it against a full day reads as a collapse every morning and
     * recovers by dinner — the number moves because the clock moved.
     */
    it("means yesterday, not today-so-far", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "docs", owner);

      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 0, 2),
        path: "/",
        country: "FR",
        count: 3,
      });
      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 1, 23),
        path: "/",
        country: "FR",
        count: 40,
      });
      await ctx.probe.uniques.create({
        sigilId,
        day: dayUtc(ctx, 0),
        visitorHash: "today",
      });
      for (const visitorHash of ["y1", "y2"]) {
        await ctx.probe.uniques.create({
          sigilId,
          day: dayUtc(ctx, 1),
          visitorHash,
        });
      }

      const res = await ctx.insightsController.getInsights.fetch(
        {
          params: { projectId },
          query: { range: "1d", until: "lastCompleteDay" },
        },
        { user: owner },
      );

      expect(res.data.since).toBe(dayUtc(ctx, 1));
      expect(res.data.until).toBe(dayUtc(ctx, 1));
      // The 23:00 row is the point: `until` names a DAY, and every hour of it
      // is inside the window.
      expect(res.data.totalViews).toBe(40);
      expect(res.data.uniqueVisitors).toBe(2);
    });

    it("returns the preceding window alongside, measured the same way", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "docs", owner);

      for (const visitorHash of ["a", "b", "c", "d", "e"]) {
        await ctx.probe.uniques.create({
          sigilId,
          day: dayUtc(ctx, 1),
          visitorHash,
        });
      }
      for (const visitorHash of ["p", "q", "r", "s"]) {
        await ctx.probe.uniques.create({
          sigilId,
          day: dayUtc(ctx, 2),
          visitorHash,
        });
      }

      const res = await ctx.insightsController.getInsights.fetch(
        {
          params: { projectId },
          query: { range: "1d", until: "lastCompleteDay", compare: true },
        },
        { user: owner },
      );

      expect(res.data.uniqueVisitors).toBe(5);
      expect(res.data.previous).toMatchObject({
        since: dayUtc(ctx, 2),
        until: dayUtc(ctx, 2),
        uniqueVisitors: 4,
      });
      expect(res.data.uniqueVisitorsDelta).toBe(25);
    });

    it("puts the previous window immediately before this one, without overlap", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "docs", owner);

      // One visitor on the boundary day of the CURRENT window. If the two
      // windows overlapped, this hash would be counted in both.
      await ctx.probe.uniques.create({
        sigilId,
        day: dayUtc(ctx, 7),
        visitorHash: "edge",
      });

      const res = await ctx.insightsController.getInsights.fetch(
        {
          params: { projectId },
          query: { range: "7d", until: "lastCompleteDay", compare: true },
        },
        { user: owner },
      );

      expect(res.data.since).toBe(dayUtc(ctx, 7));
      expect(res.data.until).toBe(dayUtc(ctx, 1));
      expect(res.data.previous?.since).toBe(dayUtc(ctx, 14));
      expect(res.data.previous?.until).toBe(dayUtc(ctx, 8));
      expect(res.data.uniqueVisitors).toBe(1);
      expect(res.data.previous?.uniqueVisitors).toBe(0);
    });

    it("says nothing rather than +100% when the previous window was empty", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "docs", owner);

      await ctx.probe.uniques.create({
        sigilId,
        day: dayUtc(ctx, 1),
        visitorHash: "first-ever",
      });

      const res = await ctx.insightsController.getInsights.fetch(
        {
          params: { projectId },
          query: { range: "1d", until: "lastCompleteDay", compare: true },
        },
        { user: owner },
      );

      expect(res.data.previous?.uniqueVisitors).toBe(0);
      expect(res.data.uniqueVisitorsDelta).toBeUndefined();
    });

    it("leaves existing 1d / 7d / 30d callers on today-anchored windows with no comparison", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "docs", owner);

      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 0, 2),
        path: "/",
        country: "FR",
        count: 3,
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "1d" } },
        { user: owner },
      );

      expect(res.data.since).toBe(dayUtc(ctx, 0));
      expect(res.data.until).toBe(dayUtc(ctx, 0));
      expect(res.data.totalViews).toBe(3);
      expect(res.data.previous).toBeUndefined();
      expect(res.data.uniqueVisitorsDelta).toBeUndefined();
    });

    it("bounds the timeline and the error budget by the same day", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "docs", owner);

      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 0, 5),
        path: "/",
        country: "FR",
        count: 7,
      });
      await ctx.probe.errorGroups.create({
        sigilId,
        fingerprint: "fp-today",
        name: "TypeError",
        message: "only seen today",
        stackSample: "",
        sourceUrl: "",
        firstSeenAt: instantUtc(ctx, 0),
        lastSeenAt: instantUtc(ctx, 0),
        count: 1,
      });
      await ctx.probe.errorGroups.create({
        sigilId,
        fingerprint: "fp-yesterday",
        name: "TypeError",
        message: "last seen yesterday",
        stackSample: "",
        sourceUrl: "",
        firstSeenAt: instantUtc(ctx, 1),
        lastSeenAt: instantUtc(ctx, 1),
        count: 1,
      });

      const res = await ctx.insightsController.getInsights.fetch(
        {
          params: { projectId },
          query: { range: "7d", until: "lastCompleteDay" },
        },
        { user: owner },
      );

      // Every field in the payload describes the same window — a response that
      // claimed `since..until` while some of its numbers ran through today
      // would be a silent lie.
      expect(res.data.timeline.at(-1)?.date).toBe(dayUtc(ctx, 1));
      expect(res.data.timeline.some((point) => point.views === 7)).toBe(false);
      expect(res.data.errorGroups.map((group) => group.fingerprint)).toEqual([
        "fp-yesterday",
      ]);
    });

    it("answers the comparison even for a project with no apps", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);

      const res = await ctx.insightsController.getInsights.fetch(
        {
          params: { projectId },
          query: { range: "1d", until: "lastCompleteDay", compare: true },
        },
        { user: owner },
      );

      // "Not compared" and "compared, and it was zero" are different answers.
      expect(res.data.previous).toEqual({
        since: dayUtc(ctx, 2),
        until: dayUtc(ctx, 2),
        uniqueVisitors: 0,
        totalViews: 0,
      });
      expect(res.data.until).toBe(dayUtc(ctx, 1));
    });
  });

  describe("insights sampling disclosure", () => {
    /*
      `estimated` / `sampleInterval` exist so a UI can label a number as a
      sample rather than a measurement. The relational backend this suite
      runs against never samples, so `false` is the only value it can ever
      pin — but the field has to reach the wire before Task 13's UI can read
      it at all, and a field absent from `schema.response` is silently
      dropped no matter what the handler returns.
    */
    it("reports whether the numbers are estimated", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      await createSigil(ctx, projectId, "lore-prod", owner);

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "30d" } },
        { user: owner },
      );

      expect(res.data.estimated).toBe(false);
    });
  });

  describe("dimension filters", () => {
    /**
     * Four views over two countries and two devices, so every assertion below
     * can tell "filtered" apart from "happened to be the only row".
     */
    const seed = async (projectId: number, sigilId: string) => {
      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 0, 8),
        path: "/pricing",
        country: "FR",
        device: "mobile",
        referrer: "news.ycombinator.com",
        campaign: "launch",
        count: 3,
        entries: 3,
      });
      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 0, 9),
        path: "/pricing",
        country: "US",
        device: "desktop",
        referrer: "direct",
        campaign: "none",
        count: 5,
        entries: 5,
      });
      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 1, 9),
        path: "/docs",
        country: "FR",
        device: "desktop",
        referrer: "direct",
        campaign: "none",
        count: 7,
        entries: 7,
      });
      return { projectId, sigilId };
    };

    it("narrows every view number to one value of one dimension", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "shop-prod", owner);
      await seed(projectId, sigilId);

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "30d", country: "FR" } },
        { user: owner },
      );

      expect(res.data.totalViews).toBe(10);
      expect(res.data.topPaths.map((p) => p.path).sort()).toEqual([
        "/docs",
        "/pricing",
      ]);
      expect(res.data.topCountries).toEqual([{ country: "FR", count: 10 }]);
    });

    it("composes two filters into one where, not two answers", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "shop-prod", owner);
      await seed(projectId, sigilId);

      const res = await ctx.insightsController.getInsights.fetch(
        {
          params: { projectId },
          query: { range: "30d", country: "FR", device: "desktop" },
        },
        { user: owner },
      );

      expect(res.data.totalViews).toBe(7);
      expect(res.data.topPaths.map((p) => p.path)).toEqual(["/docs"]);
    });

    /**
     * The Vitals tab is the thing this can break. `sigil_vitals` declares
     * `sigilId`, `metric`, `path` and `bucket`, so `path` is legal against it
     * and `country` is not, and a filter naming a dimension a dataset does not
     * declare is a rejected query rather than a wider answer. This exact
     * failure already happened once, when `traffic` was added to views only
     * and one `where` was shared by both datasets.
     */
    it("does not send a views-only filter to the vitals dataset", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "shop-prod", owner);
      await seed(projectId, sigilId);
      // Four samples in bucket 2, whose upper boundary is 2500.
      await ctx.probe.vitals.create({
        sigilId,
        hour: hourUtc(ctx, 0, 8),
        metric: "lcp",
        path: "/pricing",
        b2: 4,
      });

      // Every filter at once, including the four vitals cannot answer.
      const res = await ctx.insightsController.getInsights.fetch(
        {
          params: { projectId },
          query: {
            range: "30d",
            country: "FR",
            device: "mobile",
            referrer: "news.ycombinator.com",
            campaign: "launch",
            path: "/pricing",
          },
        },
        { user: owner },
      );

      // Answered rather than 500, and the one filter vitals DOES declare was
      // applied: the sample sits on /pricing.
      expect(res.data.vitals.lcp.p75Upper).toBe(2500);
      expect(res.data.totalViews).toBe(3);
    });

    it("filters the comparison window identically", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "shop-prod", owner);

      // Two days back is inside a 1d window's PREVIOUS window when the
      // window ends yesterday.
      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 1, 8),
        path: "/a",
        country: "FR",
        count: 4,
      });
      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 2, 8),
        path: "/a",
        country: "FR",
        count: 6,
      });
      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 2, 9),
        path: "/a",
        country: "US",
        count: 100,
      });

      const res = await ctx.insightsController.getInsights.fetch(
        {
          params: { projectId },
          query: {
            range: "1d",
            until: "lastCompleteDay",
            compare: true,
            country: "FR",
          },
        },
        { user: owner },
      );

      expect(res.data.totalViews).toBe(4);
      // 6, not 106. A delta between two windows measured on different
      // populations is not a delta.
      expect(res.data.previous?.totalViews).toBe(6);
    });

    it("matches legacy rows when filtering on a dimension's default", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "shop-prod", owner);

      // What a row written before `device` existed actually holds: the empty
      // string, not the default. A default fills a column on write.
      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 0, 8),
        path: "/old",
        country: "FR",
        device: "",
        count: 9,
      });
      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 0, 9),
        path: "/new",
        country: "FR",
        device: "desktop",
        count: 2,
      });
      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 0, 10),
        path: "/phone",
        country: "FR",
        device: "mobile",
        count: 100,
      });

      const desktop = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "30d", device: "desktop" } },
        { user: owner },
      );
      const mobile = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "30d", device: "mobile" } },
        { user: owner },
      );

      // The unclassified row joins the default bucket, so a 30-day window
      // straddling the deploy does not read as traffic collapsing that day.
      expect(desktop.data.totalViews).toBe(11);
      // But only the default bucket: nothing ever said those rows were mobile.
      expect(mobile.data.totalViews).toBe(100);
    });

    it("names the filters the visitor count could not honour", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "shop-prod", owner);
      await seed(projectId, sigilId);
      await ctx.probe.uniques.create({
        sigilId,
        day: dayUtc(ctx, 0),
        visitorHash: "h1",
      });

      const plain = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "30d" } },
        { user: owner },
      );
      const filtered = await ctx.insightsController.getInsights.fetch(
        {
          params: { projectId },
          query: { range: "30d", country: "FR", device: "mobile" },
        },
        { user: owner },
      );

      // `sigilId` and `traffic` are the two the uniques table can narrow by,
      // so an unfiltered read has nothing to declare.
      expect(plain.data.uniqueVisitorsIgnores).toEqual([]);
      // The count is unchanged under the filter, which is exactly the danger:
      // without this list a page would show it beside filtered views with
      // nothing on screen saying it is wider.
      expect(filtered.data.uniqueVisitors).toBe(plain.data.uniqueVisitors);
      expect(filtered.data.uniqueVisitorsIgnores.sort()).toEqual([
        "country",
        "device",
      ]);
    });
  });

  describe("browser and system leaderboards", () => {
    it("ranks browsers and systems by views", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "docs-prod", owner);

      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 0, 8),
        path: "/",
        country: "FR",
        browser: "chrome",
        os: "windows",
        count: 7,
      });
      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 0, 9),
        path: "/",
        country: "FR",
        browser: "safari",
        os: "macos",
        count: 3,
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "30d" } },
        { user: owner },
      );

      expect(res.data.topBrowsers).toEqual([
        { browser: "chrome", count: 7 },
        { browser: "safari", count: 3 },
      ]);
      expect(res.data.topSystems).toEqual([
        { os: "windows", count: 7 },
        { os: "macos", count: 3 },
      ]);
    });

    /**
     * A row written before either dimension existed carries `""` - a default
     * fills a column on write, it does not rewrite stored rows. Left alone
     * that is a nameless bucket in a leaderboard; excluded, the shares would
     * describe less traffic than the page around them claims. Both readings
     * are "we cannot name it", so they merge.
     */
    it("folds a legacy empty bucket into other rather than showing it", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "docs-prod", owner);

      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 0, 8),
        path: "/",
        country: "FR",
        browser: "",
        os: "",
        count: 4,
      });
      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 0, 9),
        path: "/",
        country: "FR",
        browser: "other",
        os: "other",
        count: 2,
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "30d" } },
        { user: owner },
      );

      // One row, not two, and the whole six views: the totals stay describing
      // the traffic the rest of the page describes.
      expect(res.data.topBrowsers).toEqual([{ browser: "other", count: 6 }]);
      expect(res.data.topSystems).toEqual([{ os: "other", count: 6 }]);
    });

    it("narrows the page by browser like any other dimension", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "docs-prod", owner);

      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 0, 8),
        path: "/chrome-only",
        country: "FR",
        browser: "chrome",
        count: 5,
      });
      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 0, 9),
        path: "/safari-only",
        country: "FR",
        browser: "safari",
        count: 9,
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "30d", browser: "chrome" } },
        { user: owner },
      );

      expect(res.data.totalViews).toBe(5);
      expect(res.data.topPaths.map((p) => p.path)).toEqual(["/chrome-only"]);
    });
  });

  describe("vitals by path", () => {
    it("groups the vitals dataset by path, which nothing else does", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "docs-prod", owner);

      // Two pages. `/slow` is entirely in the overflow bucket, `/fast` in the
      // first one, and both clear the sample floor.
      await ctx.probe.vitals.create({
        sigilId,
        hour: hourUtc(ctx, 0, 10),
        metric: "lcp",
        path: "/slow",
        b6: 40,
      });
      await ctx.probe.vitals.create({
        sigilId,
        hour: hourUtc(ctx, 0, 10),
        metric: "lcp",
        path: "/fast",
        b0: 60,
      });

      const res = await ctx.insightsController.getVitalsPaths.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(res.data.rows.map((row) => row.path)).toEqual(["/slow", "/fast"]);
      expect(res.data.rows[0]?.samples).toBe(40);
      expect(res.data.rows[0]?.metrics.lcp?.p75Upper).toBeNull();
      expect(res.data.rows[1]?.metrics.lcp?.p75Upper).toBe(1000);
    });

    /**
     * The ranking key is the tail share and not the p75, and this is the case
     * that separates them: both paths land in the same bucket, so their p75s
     * are identical and any p75-based order between them is arbitrary. The one
     * with more of its traffic in a poor bucket is the problem page.
     */
    it("ranks by the share of samples in poor buckets, not by the p75", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "docs-prod", owner);

      // Both p75s land in bucket 0 (75% of samples are there), so the two
      // pages are indistinguishable by p75. `/tail` has a quarter of its
      // traffic in the overflow bucket; `/clean` has a tenth.
      await ctx.probe.vitals.create({
        sigilId,
        hour: hourUtc(ctx, 0, 10),
        metric: "lcp",
        path: "/tail",
        b0: 75,
        b6: 25,
      });
      await ctx.probe.vitals.create({
        sigilId,
        hour: hourUtc(ctx, 0, 10),
        metric: "lcp",
        path: "/clean",
        b0: 90,
        b6: 10,
      });

      const res = await ctx.insightsController.getVitalsPaths.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(res.data.rows[0]?.metrics.lcp?.p75Upper).toBe(
        res.data.rows[1]?.metrics.lcp?.p75Upper,
      );
      expect(res.data.rows.map((row) => row.path)).toEqual(["/tail", "/clean"]);
      expect(res.data.rows[0]?.tailShare).toBe(25);
      expect(res.data.rows[1]?.tailShare).toBe(10);
    });

    it("never lets a path under the sample floor top the list", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "docs-prod", owner);

      // Three samples, all terrible. Without a floor this would be the worst
      // page on the site on the strength of three measurements.
      await ctx.probe.vitals.create({
        sigilId,
        hour: hourUtc(ctx, 0, 10),
        metric: "lcp",
        path: "/rare",
        b6: 3,
      });
      await ctx.probe.vitals.create({
        sigilId,
        hour: hourUtc(ctx, 0, 10),
        metric: "lcp",
        path: "/busy",
        b0: 90,
        b6: 10,
      });

      const res = await ctx.insightsController.getVitalsPaths.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );

      // Ranked below, and still on the list: "not enough data about this page"
      // is an answer, and dropping it silently is not.
      expect(res.data.rows.map((row) => row.path)).toEqual(["/busy", "/rare"]);
      expect(res.data.rows[1]?.confident).toBe(false);
      expect(res.data.rows[0]?.confident).toBe(true);
      expect(res.data.minSamples).toBe(30);
    });

    it("narrows to one page, the only view filter vitals declares", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "docs-prod", owner);

      for (const path of ["/a", "/b"]) {
        await ctx.probe.vitals.create({
          sigilId,
          hour: hourUtc(ctx, 0, 10),
          metric: "lcp",
          path,
          b0: 40,
        });
      }

      const res = await ctx.insightsController.getVitalsPaths.fetch(
        { params: { projectId }, query: { range: "7d", path: "/a" } },
        { user: owner },
      );

      expect(res.data.rows.map((row) => row.path)).toEqual(["/a"]);
    });

    it("returns an empty answer for a project with no apps", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);

      const res = await ctx.insightsController.getVitalsPaths.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(res.data.rows).toEqual([]);
      // The boundaries travel even when nothing does, so a table can label its
      // columns before it has a row to put in them.
      expect(res.data.boundaries.lcp).toEqual(VITALS_BUCKETS.lcp);
    });
  });

  describe("single-dimension listing", () => {
    const seedPaths = async (sigilId: string, count: number) => {
      for (let i = 0; i < count; i++) {
        await ctx.probe.views.create({
          sigilId,
          hour: hourUtc(ctx, 0, 8),
          path: `/p${String(i).padStart(3, "0")}`,
          country: "FR",
          // Descending rank matches ascending index, so a page can be
          // asserted by name rather than by shape.
          count: count - i,
          entries: count - i,
        });
      }
    };

    it("pages a leaderboard past the overview's top ten", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "docs-prod", owner);
      await seedPaths(sigilId, 25);

      const overview = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "30d" } },
        { user: owner },
      );
      // The overview does not widen: the long list is a separate question.
      expect(overview.data.topPaths).toHaveLength(10);

      const first = await ctx.insightsController.getInsightsDimension.fetch(
        {
          params: { projectId, dimension: "path" },
          query: { range: "30d", limit: 10 },
        },
        { user: owner },
      );
      const second = await ctx.insightsController.getInsightsDimension.fetch(
        {
          params: { projectId, dimension: "path" },
          query: { range: "30d", limit: 10, offset: 10 },
        },
        { user: owner },
      );
      const last = await ctx.insightsController.getInsightsDimension.fetch(
        {
          params: { projectId, dimension: "path" },
          query: { range: "30d", limit: 10, offset: 20 },
        },
        { user: owner },
      );

      expect(first.data.rows[0]?.value).toBe("/p000");
      expect(first.data.hasMore).toBe(true);
      expect(second.data.rows[0]?.value).toBe("/p010");
      expect(second.data.hasMore).toBe(true);
      expect(last.data.rows).toHaveLength(5);
      expect(last.data.hasMore).toBe(false);
    });

    it("shares each row out of the whole window, not out of the page", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "docs-prod", owner);
      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 0, 8),
        path: "/a",
        country: "FR",
        count: 25,
      });
      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 0, 9),
        path: "/b",
        country: "FR",
        count: 75,
      });

      const res = await ctx.insightsController.getInsightsDimension.fetch(
        {
          params: { projectId, dimension: "path" },
          query: { range: "30d", limit: 1 },
        },
        { user: owner },
      );

      expect(res.data.total).toBe(100);
      // 75 of 100, not 75 of 75.
      expect(res.data.rows).toEqual([
        { value: "/b", count: 75, percentage: 75 },
      ]);
    });

    it("ranks entry paths by arrivals and says which measure it used", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "docs-prod", owner);
      // Read a lot, arrived at once.
      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 0, 8),
        path: "/home",
        country: "FR",
        count: 40,
        entries: 1,
      });
      // Read once, arrived at often. A landing page.
      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 0, 9),
        path: "/launch",
        country: "FR",
        count: 5,
        entries: 5,
      });

      const byViews = await ctx.insightsController.getInsightsDimension.fetch(
        {
          params: { projectId, dimension: "path" },
          query: { range: "30d" },
        },
        { user: owner },
      );
      const byEntries = await ctx.insightsController.getInsightsDimension.fetch(
        {
          params: { projectId, dimension: "entryPath" },
          query: { range: "30d" },
        },
        { user: owner },
      );

      expect(byViews.data.measure).toBe("count");
      expect(byViews.data.rows[0]?.value).toBe("/home");
      expect(byEntries.data.measure).toBe("entries");
      expect(byEntries.data.rows[0]?.value).toBe("/launch");
    });

    it("carries the same dimension filters as the overview", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "docs-prod", owner);
      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 0, 8),
        path: "/fr",
        country: "FR",
        count: 4,
      });
      await ctx.probe.views.create({
        sigilId,
        hour: hourUtc(ctx, 0, 9),
        path: "/us",
        country: "US",
        count: 9,
      });

      const res = await ctx.insightsController.getInsightsDimension.fetch(
        {
          params: { projectId, dimension: "path" },
          query: { range: "30d", country: "FR" },
        },
        { user: owner },
      );

      expect(res.data.total).toBe(4);
      expect(res.data.rows.map((r) => r.value)).toEqual(["/fr"]);
    });

    it("refuses a page past the depth cap rather than clamping it", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      await createSigil(ctx, projectId, "docs-prod", owner);

      await expect(
        ctx.insightsController.getInsightsDimension.fetch(
          {
            params: { projectId, dimension: "path" },
            query: { range: "30d", limit: 50, offset: 100_000 },
          },
          { user: owner },
        ),
      ).rejects.toThrowError();
    });

    it("refuses a sigil id from another project", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      await createSigil(ctx, projectId, "docs-prod", owner);
      const stranger = await createTestUser(ctx);
      const otherProjectId = await createProject(ctx, stranger);
      const otherSigilId = await createSigil(
        ctx,
        otherProjectId,
        "other-prod",
        stranger,
      );

      await expect(
        ctx.insightsController.getInsightsDimension.fetch(
          {
            params: { projectId, dimension: "path" },
            query: { range: "30d", sigilId: otherSigilId },
          },
          { user: owner },
        ),
      ).rejects.toThrowError();
    });
  });
});
