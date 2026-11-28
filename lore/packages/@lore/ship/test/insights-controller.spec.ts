import { VITALS_BUCKETS } from "@alepha/lore/sigil";
import type { SigilForwarded } from "@alepha/lore/sigil";
import { ProjectController } from "@lore/core/api";
import { $inject, Alepha, z } from "alepha";
import { organizationMembers as members } from "alepha/api/organizations";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  AppController,
  InsightsController,
  SigilController,
  DeployAnalytics,
  SigilIngestService,
} from "../src/api/index.ts";
import { LoreShipApi } from "../src/api/index.ts";
import { type Sigil, sigilErrorGroups, sigils } from "../src/schemas/index.ts";
import { createTestMemberByProjectId } from "../src/testing/index.ts";

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
 * `DeployAnalytics`'s class doc).
 *
 * Going through the ingest endpoint would only ever produce rows in the current
 * hour, and every assertion here is about a window.
 */
class Probe {
  members = $repository(members);
  errorGroups = $repository(sigilErrorGroups);
  /**
   * Enrolled apps, written straight to the table.
   *
   * `SigilController.createSigil` is the honest door and every other test in
   * this file uses it. The D1-ceiling cases need a hundred-odd apps in one
   * project, and minting a hundred credentials proves nothing those cases are
   * about: they are about the shape of the READ.
   */
  sigils = $repository(sigils);
  datasets = $inject(DeployAnalytics);

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
       * `user` | `anon`, or `""` for a row written before the dimension
       * existed. Optional and defaulted like the rest, so every fixture that
       * predates it keeps reading as it did.
       */
      auth?: string;
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
  alepha.with(LoreShipApi);

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
    {
      body: {
        title: `Insights ${projectSeq}`,
        capabilities: [{ key: "ship", options: { track: true } }],
      },
    },
    { user },
  );
  return created.data.id;
};

/**
 * An app instance and the sigil that reports for it. Since Apps v3 the
 * credential hangs off a deployed copy, so the instance comes first; `name` is
 * read as the app and the env is `production`.
 */
const createSigil = async (
  ctx: TestContext,
  projectId: number,
  name: string,
  user: { id: string; roles: string[] },
): Promise<string> => {
  await ctx.alepha
    .inject(AppController)
    .createApp.fetch(
      { params: { projectId }, body: { app: name, env: "production" } },
      { user },
    );
  const created = await ctx.sigilController.createSigil.fetch(
    {
      params: { projectId },
      body: { app: name, env: "production", kinds: ["beacon", "vitals"] },
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

  describe("v2: visitors, visits and views over any window", () => {
    /**
     * Three visits through the real ingest: two visitors, one of whom comes
     * back, one visit entering on /pricing and leaving on /docs.
     */
    const seed = async () => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const sigilId = await createSigil(ctx, projectId, "lore-prod", owner);
      const sigil = (await ctx.probe.sigils.findById(sigilId)) as Sigil;
      const ingest = ctx.alepha.inject(SigilIngestService);
      const send = (
        visitor: string,
        views: Array<[string, number]>,
        extra = {},
      ) =>
        ingest.absorb(sigil, {
          visitor,
          visitorPeriod: new Date(ctx.nowMs).toISOString().slice(0, 7),
          country: "FR",
          traffic: "human",
          views: views.map(([path, minutesAgo], index) => ({
            path,
            ts: ctx.nowMs - minutesAgo * 60_000,
            entry: index === 0,
          })),
          ...extra,
        } as SigilForwarded);
      await send(
        "alice",
        [
          ["/pricing", 50],
          ["/docs", 49],
        ],
        {
          network: { number: 64512, name: "Example Net" },
        },
      );
      await send("alice", [["/", 5]]);
      await send("bob", [["/docs", 3]]);
      return { owner, projectId, sigilId };
    };

    it("answers the v2 totals, timeline and flags over a preset, with every leaderboard", async ({
      expect,
    }) => {
      const { owner, projectId } = await seed();
      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d", traffic: "humans" } },
        { user: owner },
      );
      expect(res.data.totals).toMatchObject({
        visitors: 2,
        visits: 3,
        views: 4,
      });
      expect(res.data.totals.bounceRate).toBeCloseTo(2 / 3);
      expect(res.data.grain).toBe("day");
      expect(res.data.timeline).toHaveLength(7);
      expect(res.data.visitorsSpanApps).toBe(false);
      expect(res.data.peopleOnly).toBe(false);
      expect(res.data.leaderboards.exit.map((row) => row.value)).toEqual([
        "/docs",
        "/",
      ]);
      expect(res.data.leaderboards.network).toEqual([
        { value: "AS64512 Example Net", visitors: 1, views: 2 },
      ]);
      expect("uniqueVisitorsIgnores" in res.data).toBe(false);
    });

    it("takes a custom window and a grain, and the 90d, 12mo and calendar presets", async ({
      expect,
    }) => {
      const { owner, projectId } = await seed();
      const today = new Date(ctx.nowMs).toISOString().slice(0, 10);
      const custom = await ctx.insightsController.getInsights.fetch(
        {
          params: { projectId },
          query: { from: today, to: today, grain: "hour" },
        },
        { user: owner },
      );
      expect(custom.data.range).toBe("custom");
      expect(custom.data.grain).toBe("hour");
      expect(custom.data.timeline).toHaveLength(24);
      expect(custom.data.totals.views).toBe(4);

      // An end past today stops at the end of today.
      const ahead = await ctx.insightsController.getInsights.fetch(
        {
          params: { projectId },
          query: { from: today, to: "2999-12-31", grain: "day" },
        },
        { user: owner },
      );
      expect(ahead.data.until).toBe(today);
      expect(ahead.data.timeline).toHaveLength(1);

      for (const range of [
        "90d",
        "12mo",
        "thisMonth",
        "lastMonth",
        "thisYear",
      ] as const) {
        const res = await ctx.insightsController.getInsights.fetch(
          { params: { projectId }, query: { range } },
          { user: owner },
        );
        expect(res.data.range).toBe(range);
        expect(Date.parse(res.data.from)).toBeLessThan(Date.parse(res.data.to));
      }
      const year = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "12mo" } },
        { user: owner },
      );
      expect(year.data.grain).toBe("month");

      await expect(
        ctx.insightsController.getInsights.fetch(
          { params: { projectId }, query: { range: "30d", grain: "hour" } },
          { user: owner },
        ),
      ).rejects.toThrow(/7 days/);
    });

    it("narrows visitors and visits, not only views, under a path filter", async ({
      expect,
    }) => {
      const { owner, projectId } = await seed();
      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d", path: "/docs" } },
        { user: owner },
      );
      expect(res.data.totals).toMatchObject({
        visitors: 2,
        visits: 2,
        views: 2,
      });
    });

    it("returns visitors and views per value from the dimension endpoint, exit pages and networks too", async ({
      expect,
    }) => {
      const { owner, projectId } = await seed();
      const exit = await ctx.insightsController.getInsightsDimension.fetch(
        { params: { projectId, dimension: "exit" }, query: { range: "7d" } },
        { user: owner },
      );
      expect(exit.data.rows[0]).toMatchObject({ value: "/docs", visitors: 2 });
      const network = await ctx.insightsController.getInsightsDimension.fetch(
        { params: { projectId, dimension: "network" }, query: { range: "7d" } },
        { user: owner },
      );
      expect(network.data.rows).toEqual([
        {
          value: "AS64512 Example Net",
          visitors: 1,
          views: 2,
          percentage: 50,
        },
      ]);
    });

    it("compares with the window before, and answers null where it is older than the data kept", async ({
      expect,
    }) => {
      const { owner, projectId } = await seed();
      const recent = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d", compare: true } },
        { user: owner },
      );
      // The week before holds no session: views only, visitors not counted.
      expect(recent.data.previous?.totals).toMatchObject({
        visitors: null,
        views: 0,
      });
      expect(recent.data.previous?.to).toBe(recent.data.from);

      const from = new Date(ctx.nowMs - 300 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const old = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { from, compare: true } },
        { user: owner },
      );
      expect(old.data.previous?.totals).toEqual({
        visitors: null,
        visits: null,
        views: null,
        bounceRate: null,
        engagedRate: null,
        avgVisitSeconds: null,
        pagesPerVisit: null,
      });
    });
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

      // One fingerprint, both apps. The Errors inbox folds these into a single
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
        // The label is the `"<app>/<env>"` mirror since Apps v3, which is what
        // makes it unique when one app has two deployed copies.
        sigilLabel: "lore-staging/production",
        fingerprint: "fp-shared",
        name: "TypeError",
        message: "boom",
        count: 11,
      });
      expect(res.data.errorGroups[1]).toMatchObject({
        sigilId: prod,
        sigilLabel: "lore-prod/production",
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
    await createTestMemberByProjectId(ctx.alepha, projectId, member.id);

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

  describe("insights sampling disclosure", () => {
    /*
      `estimated` / `sampleInterval` exist so a UI can label a number as a
      sample rather than a measurement. The relational backend this suite
      runs against never samples, so `false` is the only value it can ever
      pin, but the field has to reach the wire before Task 13's UI can read
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
      ).rejects.toThrow();
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
      ).rejects.toThrow();
    });
  });
  /*
    ⚠️ **In-memory SQLite does not enforce D1's hundred-parameter ceiling**, so
    none of these can fail by hitting it. They assert the SHAPE that keeps a
    project-wide read under it, and they are only meaningful read together with
    the reason recorded on `InsightsController.SIGIL_CHUNK` and
    `LoreAnalyticsStore.scope`: D1 refuses a statement carrying more than 100
    bound parameters (folio #F1173, probed: 100 ok, 101 fails), and a
    project-wide read binds one per app.

    Two D1 reads carry a project-wide app set, and each is bounded a different
    way because a distinct count cannot be chunked and merged. Views, vitals
    and the error series are `$analytics()` datasets and are not in this band
    at all.
  */
  describe("a project with more apps than D1 will bind", () => {
    /**
     * `count` apps in `projectId`, written straight to the table.
     *
     * The names are zero-padded so a lexicographic read of the ids is not
     * mistaken for the insertion order anywhere in the assertions.
     */
    const enrolApps = async (
      projectId: number,
      count: number,
    ): Promise<string[]> => {
      const rows = Array.from({ length: count }, (_, index) => ({
        id: crypto.randomUUID(),
        projectId,
        name: `app-${String(index).padStart(3, "0")}`,
        tokenHash: `hash-${index}`,
        tokenPrefix: `sg_${index}`,
        kinds: ["beacon", "vitals"],
      }));
      await ctx.probe.sigils.createMany(rows);
      return rows.map((row) => row.id);
    };

    it("returns the worst error groups in the project, not the worst of one chunk", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const appIds = await enrolApps(projectId, 200);

      // One group per app, `count` rising with the index, so at a chunk size
      // of 90 every one of the twenty worst sits in the LAST chunk. A read
      // that concatenates the chunks and slices without re-sorting answers
      // with the first chunk's twenty, which are the mildest failures in the
      // project.
      await ctx.probe.errorGroups.createMany(
        appIds.map((sigilId, index) => ({
          sigilId,
          fingerprint: `fp-${index}`,
          name: "TypeError",
          message: `boom ${index}`,
          stackSample: "TypeError: boom",
          sourceUrl: "https://demo.example.com/cart",
          firstSeenAt: instantUtc(ctx, 3),
          lastSeenAt: instantUtc(ctx, 1),
          count: index + 1,
        })),
      );

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(res.data.errorGroups.map((group) => group.count)).toEqual(
        Array.from({ length: 20 }, (_, index) => 200 - index),
      );
    });

    it("cuts a project-wide app set into chunks D1 can bind", async ({
      expect,
    }) => {
      // The shape assertion the two cases above cannot make, because the
      // database they run against binds a thousand parameters happily.
      //
      // ⚠️ Reached by a cast rather than by the repo's TestProvider subclass
      // pattern, and for a reason worth stating: `$action` names are global to
      // a container, so injecting a second `InsightsController` — even a
      // subclass whose only addition is a bound method — is a duplicate-name
      // boot failure. `chunked` is protected, which is a compile-time claim
      // about who calls it, not a runtime one.
      const controller = ctx.insightsController as unknown as {
        chunked(ids: string[]): string[][];
      };
      const ids = Array.from({ length: 250 }, () => crypto.randomUUID());

      const chunks = controller.chunked(ids);

      expect(chunks.flat()).toEqual(ids);
      expect(
        Math.max(...chunks.map((chunk) => chunk.length)),
      ).toBeLessThanOrEqual(90);
      // An empty set asks nothing rather than asking `IN ()`: the repository
      // throws an `AlephaError` on an empty `inArray`, so a chunk of nothing
      // is a failure and not an empty answer.
      expect(controller.chunked([])).toEqual([]);
    });
  });
});
