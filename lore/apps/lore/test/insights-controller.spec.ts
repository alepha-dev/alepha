import { VITALS_BUCKETS } from "@alepha/sigil/vitals";
import { Alepha, z } from "alepha";
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
import { members } from "../src/api/entities/members.ts";
import { sigilErrorGroups } from "../src/api/entities/sigilErrorGroups.ts";
import { sigilUniquesDaily } from "../src/api/entities/sigilUniquesDaily.ts";
import { sigilViewsHourly } from "../src/api/entities/sigilViewsHourly.ts";
import { sigilVitalsHourly } from "../src/api/entities/sigilVitalsHourly.ts";
import { LoreApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

/**
 * Writes the aggregate tables directly.
 *
 * Going through the ingest endpoint would only ever produce rows in the current
 * hour, and every assertion here is about a window.
 */
class Probe {
  members = $repository(members);
  views = $repository(sigilViewsHourly);
  uniques = $repository(sigilUniquesDaily);
  vitals = $repository(sigilVitalsHourly);
  errorGroups = $repository(sigilErrorGroups);
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

const createProject = async (
  ctx: TestContext,
  user: { id: string; roles: string[] },
): Promise<number> => {
  const created = await ctx.projectController.createProject.fetch(
    { body: { title: "Insights", features: { beacon: true } } },
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
    expect(res.data.timeline).toHaveLength(7);
    expect(res.data.vitals.lcp).toBeNull();
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
        bucketCounts: { "0": 1, "2": 2, "6": 1 },
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(VITALS_BUCKETS.lcp[2]).toBe(2500);
      expect(res.data.vitals.lcp).toBe(2500);
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
        bucketCounts: { "0": 3 },
      });
      await ctx.probe.vitals.create({
        sigilId: staging,
        hour: hourUtc(ctx, 0, 11),
        metric: "lcp",
        path: "/",
        bucketCounts: { "6": 1 },
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(VITALS_BUCKETS.lcp[0]).toBe(1000);
      expect(res.data.vitals.lcp).toBe(1000);
    });

    it("returns null for a metric with no sample in the window", async ({
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
        bucketCounts: { "0": 5 },
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(res.data.vitals.lcp).toBeNull();
      expect(res.data.vitals.cls).toBeNull();
      expect(res.data.vitals.inp).toBeNull();
      expect(res.data.vitals.fcp).toBeNull();
      expect(res.data.vitals.ttfb).toBeNull();
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
        bucketCounts: { "0": 1 },
      });

      const res = await ctx.insightsController.getInsights.fetch(
        { params: { projectId }, query: { range: "7d" } },
        { user: owner },
      );

      expect(res.data.vitals.cls).toBeCloseTo(VITALS_BUCKETS.cls[0] / 1000, 10);
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
});
