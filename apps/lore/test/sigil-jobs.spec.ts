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
import {
  sigilUniquesDaily,
  UNIQUES_COLLAPSED_HASH,
} from "../src/api/entities/sigilUniquesDaily.ts";
import { LoreApi } from "../src/api/index.ts";
import { SigilJobs } from "../src/api/jobs/SigilJobs.ts";
import { LoreAnalyticsStore } from "../src/api/services/LoreAnalyticsStore.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

class Probe {
  uniques = $repository(sigilUniquesDaily);
}

interface TestContext {
  alepha: Alepha;
  dateTime: DateTimeProvider;
  nowMs: number;
  projectId: number;
  sigilA: string;
  sigilB: string;
  user: { id: string; roles: string[] };
  insights: InsightsController;
  /**
   * `LoreAnalyticsStore` — uniques only. `uniqueVisitors` stays reachable
   * through `insights` too, since Insights still answers it from this same
   * table (see "what Insights reads afterwards" below).
   */
  analytics: LoreAnalyticsStore;
  probe: Probe;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
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

  // Pinned before anything reads the clock: the fixtures and the sweep both
  // derive day strings, and a run crossing UTC midnight between the two would
  // fail for no reason.
  dateTime.pause();

  const admin = alepha.inject(AdminUserController);
  const fake = alepha.inject(FakeProvider);
  const created = await admin.createUser.fetch(
    { body: { ...fake.generate(userDataSchema), roles: ["user"] } },
    { user: adminUser },
  );
  const user = { id: created.data.id, roles: created.data.roles };

  const projects = alepha.inject(ProjectController);
  const project = await projects.createProject.fetch(
    { body: { title: "Retention", features: { sigils: true } } },
    { user },
  );

  const sigilApi = alepha.inject(SigilController);
  const mkSigil = async (name: string) => {
    const res = await sigilApi.createSigil.fetch(
      {
        params: { projectId: project.data.id },
        body: { name, kinds: ["beacon"] },
      },
      { user },
    );
    return res.data.id;
  };

  return {
    alepha,
    dateTime,
    nowMs: dateTime.nowMillis(),
    projectId: project.data.id,
    sigilA: await mkSigil("alpha"),
    sigilB: await mkSigil("beta"),
    user,
    insights: alepha.inject(InsightsController),
    analytics: alepha.inject(LoreAnalyticsStore),
    probe,
  };
};

/** `YYYY-MM-DD`, `daysAgo` days before the pinned instant, UTC. */
const dayUtc = (ctx: TestContext, daysAgo: number): string => {
  const day = new Date(ctx.nowMs);
  day.setUTCDate(day.getUTCDate() - daysAgo);
  return day.toISOString().slice(0, 10);
};

/**
 * `SigilJobs` — the sweep that stops `sigil_uniques_daily` growing without
 * bound.
 *
 * Views used to be swept here too (`collapseViews`); that half was deleted
 * once `sigil_views_hourly` stopped being written or read at all, and
 * retention for its `$analytics()` replacement moved onto
 * `AnalyticsRollupJobs` in `alepha/api/analytics`, exercised by that package's
 * own suite rather than this one.
 *
 * Driven through `DateTimeProvider.travel()` rather than by seeding
 * already-old rows: the sweep's whole contract is "what happens when a bucket
 * crosses the boundary", and moving the clock is the only way to watch a row
 * that was inside the window end up outside it.
 *
 * ⚠️ `travel()` releases every `$job` cron in the container, so the sweep is
 * invoked directly here and the assertions are on end state, never on call
 * counts.
 */
describe("SigilJobs", () => {
  let ctx: TestContext;
  let jobs: SigilJobs;

  beforeEach(async () => {
    ctx = await setup();
    jobs = ctx.alepha.inject(SigilJobs);
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("uniques hash-collapse", () => {
    it("leaves the recent window alone and folds everything past it", async ({
      expect,
    }) => {
      // Today and yesterday are inside the 2-day window; three days back is not.
      await ctx.probe.uniques.createMany([
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 0), visitorHash: "aa" },
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 1), visitorHash: "bb" },
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 3), visitorHash: "cc" },
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 3), visitorHash: "dd" },
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 3), visitorHash: "ee" },
      ]);

      await jobs.collapseAnalytics.run();

      const rows = await ctx.probe.uniques.findMany({});
      const collapsed = rows.filter(
        (r) => r.visitorHash === UNIQUES_COLLAPSED_HASH,
      );
      const hashes = rows.filter(
        (r) => r.visitorHash !== UNIQUES_COLLAPSED_HASH,
      );

      // The three old hashes became one row carrying their count.
      expect(collapsed).toHaveLength(1);
      expect(collapsed[0].day).toBe(dayUtc(ctx, 3));
      expect(collapsed[0].count).toBe(3);

      // The two recent visitors keep their hashes.
      expect(hashes.map((r) => r.visitorHash).sort()).toEqual(["aa", "bb"]);
    });

    it("keeps each sigil's day separate", async ({ expect }) => {
      await ctx.probe.uniques.createMany([
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 5), visitorHash: "aa" },
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 5), visitorHash: "bb" },
        { sigilId: ctx.sigilB, day: dayUtc(ctx, 5), visitorHash: "cc" },
      ]);

      await jobs.collapseAnalytics.run();

      const rows = await ctx.probe.uniques.findMany({});
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.sigilId === ctx.sigilA)?.count).toBe(2);
      expect(rows.find((r) => r.sigilId === ctx.sigilB)?.count).toBe(1);
    });

    it("folds several stale days in one sweep, one row each", async ({
      expect,
    }) => {
      await ctx.probe.uniques.createMany([
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 3), visitorHash: "aa" },
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 3), visitorHash: "bb" },
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 6), visitorHash: "cc" },
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 9), visitorHash: "dd" },
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 9), visitorHash: "ee" },
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 9), visitorHash: "ff" },
      ]);

      await jobs.collapseAnalytics.run();

      const rows = await ctx.probe.uniques.findMany({});
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.visitorHash === UNIQUES_COLLAPSED_HASH)).toBe(
        true,
      );
      const byDay = new Map(rows.map((r) => [r.day, r.count]));
      expect(byDay.get(dayUtc(ctx, 3))).toBe(2);
      expect(byDay.get(dayUtc(ctx, 6))).toBe(1);
      expect(byDay.get(dayUtc(ctx, 9))).toBe(3);
    });

    it("is idempotent — a second sweep does not double the count", async ({
      expect,
    }) => {
      await ctx.probe.uniques.createMany([
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 4), visitorHash: "aa" },
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 4), visitorHash: "bb" },
      ]);

      await jobs.collapseAnalytics.run();
      await jobs.collapseAnalytics.run();

      const rows = await ctx.probe.uniques.findMany({});
      expect(rows).toHaveLength(1);
      expect(rows[0].count).toBe(2);
    });

    it("does no work at all on a day it has already collapsed", async ({
      expect,
    }) => {
      await ctx.probe.uniques.createMany([
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 4), visitorHash: "aa" },
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 4), visitorHash: "bb" },
      ]);

      await jobs.collapseAnalytics.run();
      const [first] = await ctx.probe.uniques.findMany({});

      await jobs.collapseAnalytics.run();
      const [second] = await ctx.probe.uniques.findMany({});

      // The row must be the *same* row, not an identical replacement. The fold
      // deletes a day and re-inserts it, so re-folding mints a new id — which
      // is the only trace it leaves, the totals being unchanged by
      // construction. That invisibility is why this ran unnoticed in
      // production for as long as it did: ~12-13 seconds of D1 round-trips
      // every hour, re-folding 27 already-folded rows to reach the same
      // numbers. Asserting the count here would pass either way.
      expect(second.id).toBe(first.id);
      expect(second.count).toBe(2);
    });

    it("folds a late hash into a day it had already collapsed", async ({
      expect,
    }) => {
      await ctx.probe.uniques.createMany([
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 4), visitorHash: "aa" },
      ]);
      await jobs.collapseAnalytics.run();

      // Arrives after that day was sealed — a retry, or an app whose clock
      // disagreed. Skipping finished days must not mean skipping this: the day
      // carries a real hash again, so it is back in scope.
      await ctx.probe.uniques.create({
        sigilId: ctx.sigilA,
        day: dayUtc(ctx, 4),
        visitorHash: "zz",
      });
      await jobs.collapseAnalytics.run();

      const rows = await ctx.probe.uniques.findMany({});
      expect(rows).toHaveLength(1);
      expect(rows[0].visitorHash).toBe(UNIQUES_COLLAPSED_HASH);
      expect(rows[0].count).toBe(2);
    });

    it("folds a day the clock has just carried out of the window", async ({
      expect,
    }) => {
      // Seeded inside the window, so the first sweep must not touch it.
      await ctx.probe.uniques.createMany([
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 0), visitorHash: "aa" },
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 0), visitorHash: "bb" },
      ]);

      await jobs.collapseAnalytics.run();
      expect(
        (await ctx.probe.uniques.findMany({})).every(
          (r) => r.visitorHash !== UNIQUES_COLLAPSED_HASH,
        ),
      ).toBe(true);

      // Three days on, the same rows are stale.
      await ctx.dateTime.travel(3, "day");
      await jobs.collapseAnalytics.run();

      const rows = await ctx.probe.uniques.findMany({});
      expect(rows).toHaveLength(1);
      expect(rows[0].visitorHash).toBe(UNIQUES_COLLAPSED_HASH);
      expect(rows[0].count).toBe(2);
    });
  });

  describe("what Insights reads afterwards", () => {
    /*
      Insights answers `uniqueVisitors` from `sigil_uniques_daily`, which is
      exactly what `collapseAnalytics` sweeps here — so a fold that mis-summed
      or double-counted across the boundary would show up in what a real
      query returns, not just in the raw rows. `totalViews` moved to
      `$analytics()` in Task 12 and reads no table this sweep touches at all;
      the regression guard for its own rollup lives in `alepha/api/analytics`'s
      own suite.
    */
    it("reports the same unique-visitor total before and after a sweep", async ({
      expect,
    }) => {
      // Well outside the 2-day uniques window, so the sweep folds these.
      await ctx.probe.uniques.createMany([
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 10), visitorHash: "aa" },
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 10), visitorHash: "bb" },
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 11), visitorHash: "cc" },
      ]);

      const read = async () => {
        const res = await ctx.insights.getInsights.fetch(
          { params: { projectId: ctx.projectId }, query: { range: "30d" } },
          { user: ctx.user },
        );
        return res.data;
      };

      const before = await read();
      expect(before.uniqueVisitors).toBe(3);

      await jobs.collapseAnalytics.run();

      const after = await read();
      expect(after.uniqueVisitors).toBe(3);
    });

    it("adds collapsed totals to still-hashed days without double counting", async ({
      expect,
    }) => {
      // One day inside the hash window, one day past it. The reader has to
      // count the first by distinct hash and the second by its stored total.
      await ctx.probe.uniques.createMany([
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 0), visitorHash: "aa" },
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 5), visitorHash: "bb" },
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 5), visitorHash: "cc" },
      ]);

      await jobs.collapseAnalytics.run();

      const res = await ctx.insights.getInsights.fetch(
        { params: { projectId: ctx.projectId }, query: { range: "30d" } },
        { user: ctx.user },
      );
      expect(res.data.uniqueVisitors).toBe(3);
    });
  });
});
