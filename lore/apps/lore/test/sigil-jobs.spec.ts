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
import { sigilViewsHourly } from "../src/api/entities/sigilViewsHourly.ts";
import { LoreApi } from "../src/api/index.ts";
import { SigilJobs } from "../src/api/jobs/SigilJobs.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

class Probe {
  views = $repository(sigilViewsHourly);
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
    probe,
  };
};

/** `YYYY-MM-DD`, `daysAgo` days before the pinned instant, UTC. */
const dayUtc = (ctx: TestContext, daysAgo: number): string => {
  const day = new Date(ctx.nowMs);
  day.setUTCDate(day.getUTCDate() - daysAgo);
  return day.toISOString().slice(0, 10);
};

const hourUtc = (ctx: TestContext, daysAgo: number, hour: number): string =>
  `${dayUtc(ctx, daysAgo)}T${String(hour).padStart(2, "0")}`;

/**
 * `SigilJobs` — the sweep that stops the three analytics tables growing
 * without bound.
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

  describe("views hourly-to-daily collapse", () => {
    it("keeps the 30-day window hourly and folds what is past it", async ({
      expect,
    }) => {
      await ctx.probe.views.createMany([
        // Inside the window — two distinct hours must survive as two rows.
        { sigilId: ctx.sigilA, hour: hourUtc(ctx, 1, 9), path: "/", count: 4 },
        { sigilId: ctx.sigilA, hour: hourUtc(ctx, 1, 14), path: "/", count: 6 },
        // Past it — same day, same path, three hours to fold into one.
        { sigilId: ctx.sigilA, hour: hourUtc(ctx, 40, 1), path: "/", count: 2 },
        { sigilId: ctx.sigilA, hour: hourUtc(ctx, 40, 5), path: "/", count: 3 },
        {
          sigilId: ctx.sigilA,
          hour: hourUtc(ctx, 40, 23),
          path: "/",
          count: 5,
        },
      ]);

      await jobs.collapseAnalytics.run();

      const rows = await ctx.probe.views.findMany({});
      const old = rows.filter((r) => r.hour.startsWith(dayUtc(ctx, 40)));
      const recent = rows.filter((r) => r.hour.startsWith(dayUtc(ctx, 1)));

      expect(old).toHaveLength(1);
      expect(old[0].hour).toBe(`${dayUtc(ctx, 40)}T00`);
      expect(old[0].count).toBe(10);
      expect(recent).toHaveLength(2);
    });

    it("does not merge different paths or countries into one bucket", async ({
      expect,
    }) => {
      await ctx.probe.views.createMany([
        {
          sigilId: ctx.sigilA,
          hour: hourUtc(ctx, 40, 1),
          path: "/a",
          country: "FR",
          count: 1,
        },
        {
          sigilId: ctx.sigilA,
          hour: hourUtc(ctx, 40, 2),
          path: "/b",
          country: "FR",
          count: 1,
        },
        {
          sigilId: ctx.sigilA,
          hour: hourUtc(ctx, 40, 3),
          path: "/a",
          country: "DE",
          count: 1,
        },
      ]);

      await jobs.collapseAnalytics.run();

      const rows = await ctx.probe.views.findMany({});
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.hour === `${dayUtc(ctx, 40)}T00`)).toBe(true);
    });
  });

  describe("what Insights reads afterwards", () => {
    it("reports the same totals before and after a sweep", async ({
      expect,
    }) => {
      // A 30-day window, entirely inside the views window but well outside the
      // 2-day uniques window, so the sweep touches the uniques and not the views.
      await ctx.probe.uniques.createMany([
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 10), visitorHash: "aa" },
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 10), visitorHash: "bb" },
        { sigilId: ctx.sigilA, day: dayUtc(ctx, 11), visitorHash: "cc" },
      ]);
      await ctx.probe.views.createMany([
        { sigilId: ctx.sigilA, hour: hourUtc(ctx, 10, 9), path: "/", count: 7 },
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
      expect(before.totalViews).toBe(7);

      await jobs.collapseAnalytics.run();

      const after = await read();
      expect(after.uniqueVisitors).toBe(3);
      expect(after.totalViews).toBe(7);
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
