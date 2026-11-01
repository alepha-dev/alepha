import { ProjectController } from "@lore/core/api";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectReportsController, QuestController } from "../src/api/index.ts";
import { LoreWorkApi } from "../src/api/index.ts";
import { WorkTestEntities } from "../src/testing/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  questController: QuestController;
  reportsController: ProjectReportsController;
  fakeProvider: FakeProvider;
  repos: WorkTestEntities;
  now: () => number;
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
  alepha.with(LoreWorkApi);

  // Registered before `start()` so the backlog-gate tests below can write
  // `epics` rows directly — there is no EpicController yet.
  const repos = alepha.inject(WorkTestEntities);

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    questController: alepha.inject(QuestController),
    reportsController: alepha.inject(ProjectReportsController),
    fakeProvider: alepha.inject(FakeProvider),
    repos,
    now: () => alepha.inject(DateTimeProvider).nowMillis(),
  };
};

async function createTestUser(
  ctx: TestContext,
  roles: string[] = ["user"],
): Promise<{ id: string; roles: string[] }> {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
}

async function createTestProject(
  ctx: TestContext,
  user: { id: string; roles: string[] },
): Promise<{ id: number; title: string }> {
  const response = await ctx.projectController.createProject.fetch(
    { body: { title: "Test Project" } },
    { user },
  );
  return { id: response.data.id, title: response.data.title };
}

async function createTestQuest(
  ctx: TestContext,
  user: { id: string; roles: string[] },
  projectId: number,
  overrides: Partial<{
    title: string;
    area: string;
    priority: "optional" | "low" | "medium" | "high";
    tags: string[];
  }> = {},
) {
  const response = await ctx.questController.createQuest.fetch(
    {
      body: {
        title: overrides.title ?? "Test Quest",
        description: "<p>Test description</p>",
        area: overrides.area ?? "core",
        priority: overrides.priority ?? "medium",
        tags: overrides.tags ?? [],
        projectId,
        objectives: [],
      },
    },
    { user },
  );
  return response.data;
}

describe("ProjectReportsController", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("getReportsOverview", () => {
    /**
     * Builds a project with quests in mixed lifecycle states: one
     * completed (accepted + completed), one accepted-only, one brand-new.
     * Reports is unlocked by `createTestProject`.
     */
    const setupReportsProject = async () => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);

      // Completed quest — accepted then completed.
      const done = await createTestQuest(ctx, owner, project.id, {
        title: "Completed Quest",
        area: "core",
      });
      await ctx.questController.acceptQuest.fetch(
        { params: { id: done.id } },
        { user: owner },
      );
      await ctx.questController.completeQuest.fetch(
        { params: { id: done.id }, body: {} },
        { user: owner },
      );

      // Accepted-only quest.
      const accepted = await createTestQuest(ctx, owner, project.id, {
        title: "Accepted Quest",
        area: "core",
      });
      await ctx.questController.acceptQuest.fetch(
        { params: { id: accepted.id } },
        { user: owner },
      );

      // Brand-new quest.
      await createTestQuest(ctx, owner, project.id, {
        title: "New Quest",
        area: "frontend",
      });

      return {
        projectId: project.id,
        owner,
        controller: ctx.reportsController,
      };
    };

    it("getReportsOverview returns KPIs, burn-up and attention counts", async ({
      expect,
    }) => {
      const c = await setupReportsProject();
      const res = await c.controller.getReportsOverview.fetch(
        { params: { id: c.projectId } },
        { user: c.owner },
      );
      expect(res.data.kpis.totalQuests).toBeGreaterThanOrEqual(3);
      expect(res.data.kpis.openQuests).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.data.burnup)).toBe(true);
      expect(res.data.attention).toHaveProperty("staleQuests");
    });

    it("getReportsQuests returns the funnel, breakdowns and aging list", async ({
      expect,
    }) => {
      const ctx = await setupReportsProject();
      const res = await ctx.controller.getReportsQuests.fetch(
        { params: { id: ctx.projectId } },
        { user: ctx.owner },
      );
      expect(
        res.data.funnel.todo +
          res.data.funnel.inProgress +
          res.data.funnel.completed,
      ).toBeGreaterThanOrEqual(3);
      expect(Array.isArray(res.data.byArea)).toBe(true);
      expect(Array.isArray(res.data.aging)).toBe(true);
    });

    /**
     * The tag breakdown (#Q2083), and the property that separates it from
     * every other breakdown on the page.
     *
     * ⚠️ A quest carries SEVERAL tags, so it is counted once per tag and the
     * rows do not sum to the project's quest count. `byArea` and
     * `byPriority` partition the project; this one deliberately does not,
     * which is why the section says so under its heading.
     */
    it("getReportsQuests counts a quest under each of its tags", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);

      const both = await createTestQuest(ctx, owner, project.id, {
        title: "Tagged twice",
        area: "core",
        tags: ["bug", "regression"],
      });
      await ctx.questController.acceptQuest.fetch(
        { params: { id: both.id } },
        { user: owner },
      );
      await ctx.questController.completeQuest.fetch(
        { params: { id: both.id }, body: {} },
        { user: owner },
      );

      await createTestQuest(ctx, owner, project.id, {
        title: "Still open",
        area: "core",
        tags: ["bug"],
      });

      // No tags at all: it must not become an "Unassigned" bar the way an
      // area does. A quest with no tag belongs to no tag.
      await createTestQuest(ctx, owner, project.id, {
        title: "Untagged",
        area: "core",
      });

      const res = await ctx.reportsController.getReportsQuests.fetch(
        { params: { id: project.id } },
        { user: owner },
      );

      const byTag = Object.fromEntries(
        res.data.byTag.map((row) => [row.tag, row]),
      );

      // The completed quest is counted under BOTH of its tags.
      expect(byTag.bug).toEqual({ tag: "bug", completed: 1, remaining: 1 });
      expect(byTag.regression).toEqual({
        tag: "regression",
        completed: 1,
        remaining: 0,
      });
      // Three quests, four tag-counts: the overlap this axis is for.
      expect(res.data.byTag).toHaveLength(2);
      const counted = res.data.byTag.reduce(
        (sum, row) => sum + row.completed + row.remaining,
        0,
      );
      expect(counted).toBe(3);
    });

    it("getReportsMembers returns the leaderboard and contribution series", async ({
      expect,
    }) => {
      const ctx = await setupReportsProject();
      const res = await ctx.controller.getReportsMembers.fetch(
        { params: { id: ctx.projectId } },
        { user: ctx.owner },
      );
      expect(Array.isArray(res.data.leaderboard)).toBe(true);
      expect(Array.isArray(res.data.contributors)).toBe(true);
      expect(Array.isArray(res.data.contribution)).toBe(true);
    });
  });

  /**
   * The figures #Q2994 corrected: each one counted something other than what
   * its label said, and the dashboard showed the same numbers.
   */
  describe("what the figures count", () => {
    const hour = 3_600_000;
    const day = 24 * hour;

    const finished = async (
      owner: { id: string; roles: string[] },
      projectId: number,
      title: string,
    ) => {
      const quest = await createTestQuest(ctx, owner, projectId, { title });
      await ctx.questController.acceptQuest.fetch(
        { params: { id: quest.id } },
        { user: owner },
      );
      await ctx.questController.completeQuest.fetch(
        { params: { id: quest.id }, body: {} },
        { user: owner },
      );
      return quest;
    };

    const overview = async (
      owner: { id: string; roles: string[] },
      projectId: number,
    ) =>
      (
        await ctx.reportsController.getReportsOverview.fetch(
          { params: { id: projectId } },
          { user: owner },
        )
      ).data;

    it("active members are the ones who touched a quest, not the organization", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      const row = await ctx.repos.projects.getOne({
        where: { id: { eq: project.id } },
      });
      const idle = await createTestUser(ctx);
      await ctx.repos.organizationMembers.create({
        organizationId: row.organizationId!,
        userId: idle.id,
        rank: "member",
      });

      await createTestQuest(ctx, owner, project.id);

      expect((await overview(owner, project.id)).kpis.activeMembers).toBe(1);
    });

    it("a held quest is neither in progress, stale nor aging", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      const held = await createTestQuest(ctx, owner, project.id);
      await ctx.repos.quests.updateById(held.id, {
        acceptedAt: new Date(ctx.now() - 30 * day).toISOString(),
        acceptedBy: owner.id,
        heldAt: new Date(ctx.now() - day).toISOString(),
        heldBy: owner.id,
      });

      const data = await overview(owner, project.id);
      expect(data.kpis.openQuests).toBe(0);
      expect(data.kpis.heldQuests).toBe(1);
      expect(data.attention.staleQuests).toBe(0);

      const quests = await ctx.reportsController.getReportsQuests.fetch(
        { params: { id: project.id } },
        { user: owner },
      );
      expect(quests.data.funnel).toMatchObject({
        todo: 0,
        inProgress: 0,
        held: 1,
      });
      expect(quests.data.aging).toEqual([]);
    });

    it("a held to-do quest is not counted as not started", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      await createTestQuest(ctx, owner, project.id);
      const held = await createTestQuest(ctx, owner, project.id);
      await ctx.repos.quests.updateById(held.id, {
        heldAt: new Date(ctx.now()).toISOString(),
        heldBy: owner.id,
      });

      const data = await overview(owner, project.id);
      expect(data.attention.notStartedQuests).toBe(1);
    });

    it("cycle time is a median with p85 beside it, one old quest moves only p85", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      const now = ctx.now();
      for (const hours of [10, 10, 10, 1000]) {
        const quest = await finished(owner, project.id, `${hours}h`);
        await ctx.repos.quests.updateById(quest.id, {
          acceptedAt: new Date(now - hours * hour).toISOString(),
          completedAt: new Date(now).toISOString(),
        });
      }

      const { kpis } = await overview(owner, project.id);
      expect(kpis.medianCycleTimeHours).toBeCloseTo(10);
      expect(kpis.p85CycleTimeHours).toBeCloseTo(1000);
    });

    it("hold time is out of cycle time", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      const now = ctx.now();
      const quest = await finished(owner, project.id, "Waited");
      const at = (ago: number) => new Date(now - ago * hour).toISOString();
      await ctx.repos.quests.updateById(quest.id, {
        acceptedAt: at(100),
        completedAt: at(0),
        history: [
          { at: at(90), by: owner.id, action: "held" },
          { at: at(30), by: owner.id, action: "unheld" },
        ],
      });

      const { kpis } = await overview(owner, project.id);
      expect(kpis.medianCycleTimeHours).toBeCloseTo(40);
    });

    it("the burn-up is 90 calendar days, zero-filled, carrying older totals", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      const quest = await finished(owner, project.id, "Long ago");
      const at = new Date(ctx.now() - 200 * day).toISOString();
      await ctx.repos.quests.updateById(quest.id, { completedAt: at });

      const { burnup } = await overview(owner, project.id);
      expect(burnup).toHaveLength(90);
      expect(burnup[0]?.completed).toBe(1);
      expect(burnup.at(-1)?.completed).toBe(1);
      const dates = burnup.map((point) => Date.parse(point.date));
      for (let index = 1; index < dates.length; index++) {
        expect(dates[index]! - dates[index - 1]!).toBe(day);
      }
    });

    it("draws nothing for a project with no quest", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);

      expect((await overview(owner, project.id)).burnup).toEqual([]);
    });
  });

  /**
   * The Flow tab's report (#Q3000).
   */
  describe("getReportsFlow", () => {
    const day = 86_400_000;
    const hour = 3_600_000;

    const seed = async () => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      const now = ctx.now();
      const iso = (ago: number) => new Date(now - ago).toISOString();
      const done = async (title: string, leadHours: number, hours: number) => {
        const quest = await createTestQuest(ctx, owner, project.id, { title });
        await ctx.questController.acceptQuest.fetch(
          { params: { id: quest.id } },
          { user: owner },
        );
        await ctx.questController.completeQuest.fetch(
          { params: { id: quest.id }, body: {} },
          { user: owner },
        );
        await ctx.repos.quests.updateById(quest.id, {
          acceptedAt: iso(hours * hour),
          completedAt: iso(0),
        });
      };
      await done("short", 1, 2);
      await done("long", 1, 100);
      const open = await createTestQuest(ctx, owner, project.id);
      await ctx.repos.quests.updateById(open.id, {
        acceptedAt: iso(30 * day),
        acceptedBy: owner.id,
      });
      return { owner, projectId: project.id, iso };
    };

    it("draws a dot per completed quest with its percentiles", async ({
      expect,
    }) => {
      const { owner, projectId, iso } = await seed();

      const res = await ctx.reportsController.getReportsFlow.fetch(
        { params: { id: projectId }, query: { from: iso(7 * day) } },
        { user: owner },
      );

      expect(res.data.scatter).toHaveLength(2);
      expect(res.data.cycleP50Hours).toBeCloseTo(51);
      expect(res.data.cycleP85Hours).toBeCloseTo(100);
      expect(res.data.period.completed).toBe(2);
    });

    it("buckets cycle time, each quest in one bucket", async ({ expect }) => {
      const { owner, projectId, iso } = await seed();

      const { data } = await ctx.reportsController.getReportsFlow.fetch(
        { params: { id: projectId }, query: { from: iso(7 * day) } },
        { user: owner },
      );

      const counts = Object.fromEntries(
        data.cycleHistogram.map((row) => [row.key, row.count]),
      );
      expect(counts.under4h).toBe(1);
      expect(counts.under1w).toBe(1);
      expect(data.cycleHistogram.reduce((n, row) => n + row.count, 0)).toBe(2);
    });

    it("places an open quest against the completed percentiles", async ({
      expect,
    }) => {
      const { owner, projectId, iso } = await seed();

      const { data } = await ctx.reportsController.getReportsFlow.fetch(
        { params: { id: projectId }, query: { from: iso(7 * day) } },
        { user: owner },
      );

      expect(data.aging[0]?.band).toBe("over_p85");
      expect(data.aging[0]?.ageDays).toBeCloseTo(30);
    });

    it("draws the cumulative flow at the grain, today's state last", async ({
      expect,
    }) => {
      const { owner, projectId, iso } = await seed();

      const { data } = await ctx.reportsController.getReportsFlow.fetch(
        {
          params: { id: projectId },
          query: { from: iso(7 * day), grain: "day" },
        },
        { user: owner },
      );

      expect(data.cumulative.at(-1)).toMatchObject({
        done: 2,
        inProgress: 1,
        exact: false,
      });
      expect(data.throughput.at(-1)?.completed).toBe(2);
    });
  });

  /**
   * The query every report takes (#Q2995).
   */
  describe("a period, filters and thresholds", () => {
    const day = 24 * 3_600_000;

    const seed = async () => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      const now = ctx.now();
      const iso = (ago: number) => new Date(now - ago * day).toISOString();
      const done = async (
        title: string,
        ago: number,
        hours: number,
        overrides: Parameters<typeof createTestQuest>[3] = {},
      ) => {
        const quest = await createTestQuest(ctx, owner, project.id, {
          title,
          ...overrides,
        });
        await ctx.questController.acceptQuest.fetch(
          { params: { id: quest.id } },
          { user: owner },
        );
        await ctx.questController.completeQuest.fetch(
          { params: { id: quest.id }, body: {} },
          { user: owner },
        );
        await ctx.repos.quests.updateById(quest.id, {
          acceptedAt: new Date(
            now - ago * day - hours * 3_600_000,
          ).toISOString(),
          completedAt: iso(ago),
        });
        return quest;
      };
      await done("recent", 2, 10, { area: "api", tags: ["bug"] });
      await done("recent too", 3, 20, { area: "ui", priority: "high" });
      await done("before", 12, 100, { area: "api" });
      await done("long ago", 200, 500, { area: "api" });
      return { owner, projectId: project.id, iso };
    };

    it("narrows every period figure to the period", async ({ expect }) => {
      const { owner, projectId, iso } = await seed();

      const res = await ctx.reportsController.getReportsOverview.fetch(
        { params: { id: projectId }, query: { from: iso(7), to: iso(0) } },
        { user: owner },
      );

      expect(res.data.period.completed).toBe(2);
      expect(res.data.period.medianCycleTimeHours).toBeCloseTo(15);
      // A snapshot, not a period figure.
      expect(res.data.kpis.completedQuests).toBe(4);
      expect(res.data.previous).toBeUndefined();
    });

    it("compare returns the period of the same length before it", async ({
      expect,
    }) => {
      const { owner, projectId, iso } = await seed();

      const res = await ctx.reportsController.getReportsOverview.fetch(
        {
          params: { id: projectId },
          query: { from: iso(7), to: iso(0), compare: true },
        },
        { user: owner },
      );

      expect(res.data.previous?.completed).toBe(1);

      const wider = await ctx.reportsController.getReportsOverview.fetch(
        {
          params: { id: projectId },
          query: { from: iso(10), to: iso(0), compare: true },
        },
        { user: owner },
      );
      expect(wider.data.previous?.completed).toBe(1);
      expect(wider.data.previous?.medianCycleTimeHours).toBeCloseTo(100);

      const quests = await ctx.reportsController.getReportsQuests.fetch(
        {
          params: { id: projectId },
          query: { from: iso(10), to: iso(0), compare: true },
        },
        { user: owner },
      );
      expect(quests.data.previous?.completed).toBe(1);
    });

    it("has nothing to compare with when the period has no start", async ({
      expect,
    }) => {
      const { owner, projectId } = await seed();

      const res = await ctx.reportsController.getReportsOverview.fetch(
        { params: { id: projectId }, query: { compare: true } },
        { user: owner },
      );

      expect(res.data.previous).toBeUndefined();
    });

    it("applies the Work filters, a tag included", async ({ expect }) => {
      const { owner, projectId } = await seed();
      const fetch = async (query: Record<string, unknown>) =>
        (
          await ctx.reportsController.getReportsOverview.fetch(
            { params: { id: projectId }, query },
            { user: owner },
          )
        ).data.kpis.completedQuests;

      expect(await fetch({ area: "api" })).toBe(3);
      expect(await fetch({ tag: "bug" })).toBe(1);
      expect(await fetch({ priority: "high" })).toBe(1);
      expect(await fetch({ memberId: owner.id })).toBe(4);
      expect(await fetch({ memberId: crypto.randomUUID() })).toBe(0);
    });

    it("keeps the filters beside the backlog gate", async ({ expect }) => {
      const { owner, projectId } = await seed();
      const parked = await createTestQuest(ctx, owner, projectId);
      const draft = await ctx.repos.epics.create({
        projectId,
        number: 1,
        title: "Draft",
        description: "",
        status: "draft",
      });
      await ctx.repos.quests.updateById(parked.id, {
        epicId: draft.id,
        acceptedBy: owner.id,
      });

      const res = await ctx.reportsController.getReportsOverview.fetch(
        { params: { id: projectId }, query: { memberId: owner.id } },
        { user: owner },
      );

      expect(res.data.kpis.totalQuests).toBe(4);
    });

    it("draws the burn-up at the grain asked for", async ({ expect }) => {
      const { owner, projectId, iso } = await seed();

      const res = await ctx.reportsController.getReportsOverview.fetch(
        {
          params: { id: projectId },
          query: { from: iso(70), to: iso(0), grain: "week" },
        },
        { user: owner },
      );

      expect(res.data.burnup.length).toBeLessThanOrEqual(12);
      expect(res.data.burnup.at(-1)?.completed).toBe(4);
    });

    it("reads thresholds from the query", async ({ expect }) => {
      const { owner, projectId, iso } = await seed();
      const open = await createTestQuest(ctx, owner, projectId);
      await ctx.repos.quests.updateById(open.id, {
        acceptedAt: iso(5),
        acceptedBy: owner.id,
      });

      const stale = async (staleDays?: number) =>
        (
          await ctx.reportsController.getReportsOverview.fetch(
            {
              params: { id: projectId },
              query: staleDays ? { staleDays } : {},
            },
            { user: owner },
          )
        ).data.attention.staleQuests;

      expect(await stale()).toBe(0);
      expect(await stale(3)).toBe(1);

      const report = await ctx.reportsController.getReportsQuests.fetch(
        { params: { id: projectId }, query: { top: 1, agingLimit: 1 } },
        { user: owner },
      );
      expect(report.data.byArea).toHaveLength(1);
      expect(report.data.aging).toHaveLength(1);
    });
  });

  /**
   * The Reports gate (`questScope`) re-implements both traps of the backlog
   * gate. Every other spec in this file runs with zero epics, which exercises
   * only the branch that emits no clause at all: these cover the branch that
   * does.
   */
  describe("the backlog gate", () => {
    const setupEpicProject = async () => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);

      const unfiled = await createTestQuest(ctx, owner, project.id, {
        title: "Unfiled Quest",
      });
      const parked = await createTestQuest(ctx, owner, project.id, {
        title: "Parked Quest",
      });
      const released = await createTestQuest(ctx, owner, project.id, {
        title: "Released Quest",
      });

      const draftEpic = await ctx.repos.epics.create({
        projectId: project.id,
        number: 1,
        title: "Draft Epic",
        description: "",
        status: "draft",
      });
      const activeEpic = await ctx.repos.epics.create({
        projectId: project.id,
        number: 2,
        title: "Ready Epic",
        description: "",
        status: "ready",
      });

      await ctx.repos.quests.updateById(parked.id, { epicId: draftEpic.id });
      await ctx.repos.quests.updateById(released.id, { epicId: activeEpic.id });

      return { projectId: project.id, owner, unfiled, released };
    };

    it("excludes draft-epic quests from the KPI totals without hiding unfiled ones", async ({
      expect,
    }) => {
      const c = await setupEpicProject();

      const res = await ctx.reportsController.getReportsOverview.fetch(
        { params: { id: c.projectId } },
        { user: c.owner },
      );

      // Three quests exist; exactly one sits in a draft epic. The unfiled
      // one is the trap: `epic_id NOT IN (1)` is SQL NULL for it, and a NULL
      // predicate excludes the row — a bare NOT IN would report 1, not 2.
      expect(res.data.kpis.totalQuests).toBe(2);
    });

    it("still counts a completed quest whose epic was parked back to draft", async ({
      expect,
    }) => {
      // Completed work is history. Nothing stops an owner flipping a `done`
      // epic back to `draft`, and if the gate applied to finished quests
      // that flip would retroactively erase them from member credit and from
      // the burn-up — rewriting the record of work that actually happened.
      //
      // The shelved-quest exemption `questScope` relies on does NOT carry
      // over here: only a `todo` quest can be shelved, so a shelved quest is
      // never a completed one, whereas a completed quest can sit in a
      // draft epic quite happily.
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);

      const done = await createTestQuest(ctx, owner, project.id, {
        title: "Finished Quest",
      });
      await ctx.questController.acceptQuest.fetch(
        { params: { id: done.id } },
        { user: owner },
      );
      await ctx.questController.completeQuest.fetch(
        { params: { id: done.id }, body: {} },
        { user: owner },
      );

      const parkedEpic = await ctx.repos.epics.create({
        projectId: project.id,
        number: 1,
        title: "Redrafted Epic",
        description: "",
        status: "draft",
      });
      await ctx.repos.quests.updateById(done.id, { epicId: parkedEpic.id });

      const overview = await ctx.reportsController.getReportsOverview.fetch(
        { params: { id: project.id } },
        { user: owner },
      );

      expect(overview.data.kpis.completedQuests).toBe(1);
      // The burn-up is cumulative, so the last point carries the total.
      const last = overview.data.burnup[overview.data.burnup.length - 1];
      expect(last?.completed).toBe(1);

      const members = await ctx.reportsController.getReportsMembers.fetch(
        { params: { id: project.id } },
        { user: owner },
      );

      const credit = members.data.leaderboard.find(
        (row) => row.userId === owner.id,
      );
      expect(credit?.questsCompleted).toBe(1);
    });

    it("keeps the funnel consistent with the KPI totals", async ({
      expect,
    }) => {
      const c = await setupEpicProject();

      const res = await ctx.reportsController.getReportsQuests.fetch(
        { params: { id: c.projectId } },
        { user: c.owner },
      );

      // Same two quests, both still `todo` — the gate filters, it never
      // touches a quest's lifecycle state.
      expect(res.data.funnel.todo).toBe(2);
      expect(res.data.funnel.inProgress).toBe(0);
      expect(res.data.funnel.completed).toBe(0);
    });
  });
});
