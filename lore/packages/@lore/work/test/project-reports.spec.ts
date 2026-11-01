import {
  ProjectAnalytics,
  ProjectAnalyticsController,
  ProjectController,
} from "@lore/core/api";
import type { ReportsQuery } from "@lore/core/schemas";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  ProjectReportsController,
  ProjectReportsService,
  QuestController,
} from "../src/api/index.ts";
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

/**
 * The figures the dashboard and Flow share, read off the service: no tab shows
 * them whole any more (#Q3016). Shaped like an action's answer so the specs read
 * the same.
 */
let reports: ProjectReportsService;
const overviewOf = async (
  request: { params: { id: number }; query?: Partial<ReportsQuery> },
  _options?: unknown,
) => ({
  data: await reports.overview(request.params.id, request.query ?? {}),
});
const questsOf = async (
  request: { params: { id: number }; query?: Partial<ReportsQuery> },
  _options?: unknown,
) => ({
  data: await reports.questsReport(request.params.id, request.query ?? {}),
});

describe("ProjectReportsController", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
    reports = ctx.alepha.inject(ProjectReportsService);
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
      const res = await overviewOf(
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
      const res = await questsOf(
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

      const res = await questsOf(
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
      (await overviewOf({ params: { id: projectId } }, { user: owner })).data;

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

      const quests = await questsOf(
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

    it("reads sizes, estimates and due dates against what happened", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      const now = ctx.now();
      const iso = (ago: number) => new Date(now - ago).toISOString();
      const done = async (patch: Record<string, unknown>) => {
        const quest = await createTestQuest(ctx, owner, project.id);
        await ctx.questController.acceptQuest.fetch(
          { params: { id: quest.id } },
          { user: owner },
        );
        await ctx.questController.completeQuest.fetch(
          { params: { id: quest.id }, body: {} },
          { user: owner },
        );
        await ctx.repos.quests.updateById(quest.id, {
          acceptedAt: iso(10 * hour),
          completedAt: iso(0),
          ...patch,
        });
      };
      await done({ size: 1, dueAt: iso(-hour) });
      await done({
        size: 5,
        estimateMinutes: 120,
        dueAt: iso(hour),
        timerSessions: [{ startedAt: iso(4 * hour), stoppedAt: iso(hour) }],
      });
      await done({ size: 5, estimateMinutes: 60 });

      const { data } = await ctx.reportsController.getReportsFlow.fetch(
        { params: { id: project.id }, query: { from: iso(day) } },
        { user: owner },
      );

      expect(data.sizes.map((row) => [row.size, row.quests])).toEqual([
        [1, 1],
        [5, 2],
      ]);
      expect(data.dueDates).toEqual({ withDue: 2, onTime: 1 });
      const estimates = Object.fromEntries(
        data.estimates.map((row) => [row.estimateHours, row]),
      );
      expect(estimates[2]?.tracked).toBe(true);
      expect(estimates[2]?.actualHours).toBeCloseTo(3);
      // No timer: its cycle time stands in, and says so.
      expect(estimates[1]?.tracked).toBe(false);
      expect(estimates[1]?.actualHours).toBeCloseTo(10);
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
   * The Planning tab's report (#Q3003).
   */
  describe("getReportsPlanning", () => {
    const day = 86_400_000;

    const seed = async () => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      const iso = (ago: number) =>
        new Date(ctx.now() - ago * day).toISOString();
      const epic = await ctx.repos.epics.create({
        projectId: project.id,
        number: 7,
        title: "Started epic",
        description: "",
        status: "in_progress",
        startedAt: iso(10),
      });
      await ctx.repos.epics.create({
        projectId: project.id,
        number: 8,
        title: "Draft epic",
        description: "",
        status: "draft",
      });
      const quest = async (patch: Record<string, unknown>) => {
        const row = await createTestQuest(ctx, owner, project.id);
        await ctx.repos.quests.updateById(row.id, {
          epicId: epic.id,
          ...patch,
        });
        return row;
      };
      await ctx.repos.quests.updateById((await quest({})).id, {
        createdAt: iso(20),
      } as never);
      return { owner, projectId: project.id, epic, quest, iso };
    };

    const planning = async (
      owner: { id: string; roles: string[] },
      projectId: number,
      query: Record<string, unknown> = {},
    ) =>
      (
        await ctx.reportsController.getReportsPlanning.fetch(
          { params: { id: projectId }, query },
          { user: owner },
        )
      ).data;

    it("lists started epics only, with their age", async ({ expect }) => {
      const { owner, projectId } = await seed();

      const { epics } = await planning(owner, projectId);

      expect(epics.map((epic) => epic.title)).toEqual(["Started epic"]);
      expect(epics[0]?.daysInProgress).toBeCloseTo(10);
    });

    it("counts a quest filed after the start as scope added", async ({
      expect,
    }) => {
      const { owner, projectId, quest, iso } = await seed();
      // `createTestQuest` stamps now, after `startedAt`.
      await quest({});
      await quest({ shelvedAt: iso(1) });

      const [epic] = (await planning(owner, projectId)).epics;

      expect(epic?.scopeAdded).toBe(2);
      expect(epic?.scopeCut).toBe(1);
      expect(epic?.total).toBe(2);
    });

    it("reads a quest moved out from its history", async ({ expect }) => {
      const { owner, projectId, quest, iso } = await seed();
      const moved = await quest({});
      await ctx.repos.quests.updateById(moved.id, {
        epicId: null,
        history: [
          {
            at: iso(1),
            by: owner.id,
            action: "updated",
            changes: [{ field: "epic", from: "#E7" }],
          },
        ],
      } as never);

      const [epic] = (await planning(owner, projectId)).epics;

      expect(epic?.scopeCut).toBe(1);
    });

    it("gives the burn-up of the epic in progress, its scope beside done", async ({
      expect,
    }) => {
      const { owner, projectId, epic, quest, iso } = await seed();
      await quest({ acceptedAt: iso(2), completedAt: iso(1) });

      const { burnup } = await planning(owner, projectId);

      expect(burnup?.epicId).toBe(epic.id);
      expect(burnup?.points.at(-1)).toMatchObject({ done: 1, scope: 2 });
    });
  });

  /**
   * The Planning tab's releases (#Q3004).
   */
  describe("getReportsPlanning, releases", () => {
    const day = 86_400_000;

    it("reads a published release's slip, size, cadence and carry-over", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      const iso = (ago: number) =>
        new Date(ctx.now() - ago * day).toISOString();
      const release = (number: number, tag: string, patch: object) =>
        ctx.repos.releases.create({
          projectId: project.id,
          number,
          tag,
          title: tag,
          ...patch,
        } as never);
      await release(1, "1.0.0", { releasedAt: iso(30), total: 4 });
      await release(2, "1.1.0", {
        releasedAt: iso(10),
        targetDate: iso(13),
        total: 9,
        inProgress: 2,
      });

      const { data } = await ctx.reportsController.getReportsPlanning.fetch(
        { params: { id: project.id }, query: {} },
        { user: owner },
      );

      const [newest, oldest] = data.releases.published;
      expect(newest?.label).toBe("1.1.0");
      expect(newest?.slipDays).toBeCloseTo(3);
      expect(newest?.carriedOver).toBe(2);
      expect(newest?.cadenceDays).toBeCloseTo(20);
      expect(oldest?.slipDays).toBeUndefined();
      expect(oldest?.cadenceDays).toBeUndefined();
    });

    it("forecasts an open release from recent throughput", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      const release = await ctx.repos.releases.create({
        projectId: project.id,
        number: 1,
        tag: "2.0.0",
        title: "2.0.0",
      } as never);
      const open = await createTestQuest(ctx, owner, project.id);
      await ctx.repos.quests.updateById(open.id, { releaseId: release.id });
      const closed = await createTestQuest(ctx, owner, project.id);
      await ctx.repos.quests.updateById(closed.id, {
        releaseId: release.id,
        acceptedAt: new Date(ctx.now() - day).toISOString(),
        completedAt: new Date(ctx.now()).toISOString(),
      });

      const { data } = await ctx.reportsController.getReportsPlanning.fetch(
        { params: { id: project.id }, query: {} },
        { user: owner },
      );

      const [row] = data.releases.open;
      expect(row).toMatchObject({ done: 1, total: 2 });
      expect(row?.burnup.at(-1)).toMatchObject({ done: 1, scope: 2 });
      expect(row?.forecast).toBeDefined();
      expect((row?.forecast?.p85 ?? "") >= (row?.forecast?.p50 ?? "")).toBe(
        true,
      );
    });
  });

  /**
   * The Support tab's report (#Q3006).
   */
  describe("getReportsTeam", () => {
    it("reports load and contribution per member, by name, folding an empty channel", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);

      const late = await createTestQuest(ctx, owner, project.id);
      await ctx.questController.acceptQuest.fetch(
        { params: { id: late.id } },
        { user: owner },
      );
      await ctx.repos.quests.updateById(late.id, {
        dueAt: "2000-01-01T00:00:00.000Z",
      });

      const activity = ctx.alepha.inject(ProjectAnalytics).activity;
      const day = new Date(ctx.now()).toISOString().slice(0, 10);
      const point = (over: { type: string; action: string; channel: string }) =>
        activity.record({
          project: String(project.id),
          actor: owner.id,
          count: 1,
          ...over,
        });
      await point({ type: "folio", action: "update", channel: "mcp" });
      await point({ type: "feedback", action: "accept", channel: "web" });
      await point({ type: "app", action: "deploy", channel: "" });

      const { data } = await ctx.reportsController.getReportsTeam.fetch(
        { params: { id: project.id }, query: { from: `${day}T00:00:00.000Z` } },
        { user: owner },
      );

      const member = data.members.find((row) => row.userId === owner.id)!;
      expect(member).toMatchObject({
        wip: 1,
        held: 0,
        overdue: 1,
        folioRevisions: 1,
        feedbackTriaged: 1,
        deploys: 1,
        agentWrites: 1,
      });
      // A channel nobody recorded never reads as a person at the keyboard.
      expect(data.channels.map((row) => row.channel)).toContain("unknown");
      expect(Object.keys(member)).not.toContain("rank");

      // The grid counts the same writes, whichever cell the clock lands in.
      expect(data.heatmap).toHaveLength(7);
      expect(
        data.heatmap.flat().reduce((sum, n) => sum + n, 0),
      ).toBeGreaterThan(2);
    });

    it("reads MCP calls per tool for this project alone", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      const calls = ctx.alepha.inject(ProjectAnalytics).mcpCalls;
      const call = (tool: string, outcome: string, target: string) =>
        calls.record({
          tool,
          outcome,
          actor: owner.id,
          project: target,
          count: 1,
        });
      await call("quest_get", "ok", String(project.id));
      await call("quest_get", "refused", String(project.id));
      await call("quest_get", "ok", String(project.id + 1));
      await call("quest_list", "error", "none");

      const { data } = await ctx.reportsController.getReportsTeam.fetch(
        { params: { id: project.id }, query: {} },
        { user: owner },
      );

      expect(data.mcp).toEqual([
        { tool: "quest_get", ok: 1, refused: 1, error: 0 },
      ]);
      expect(data.automations).toMatchObject({ runs: [], broken: [] });
    });

    it("pins the explorer to the project, and refuses a stranger", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const stranger = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      const explorer = ctx.alepha.inject(ProjectAnalyticsController);

      const { data } = await explorer.listProjectDatasets.fetch(
        { params: { projectId: project.id } },
        { user: owner },
      );

      expect(data.map((row) => row.name).toSorted()).toEqual([
        "mcp_calls",
        "project_activity",
      ]);
      for (const dataset of data) {
        expect(Object.keys(dataset.dimensions.properties ?? {})).not.toContain(
          "project",
        );
      }
      await expect(
        explorer.listProjectDatasets.fetch(
          { params: { projectId: project.id } },
          { user: stranger },
        ),
      ).rejects.toThrow();
    });
  });

  describe("getReportsSupport", () => {
    const hour = 3_600_000;
    const day = 24 * hour;

    const seed = async () => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      const iso = (ago: number) => new Date(ctx.now() - ago).toISOString();
      let shortId = 0;
      const report = (patch: object) =>
        ctx.repos.feedback.create({
          projectId: project.id,
          shortId: ++shortId,
          title: "r",
          description: "d",
          status: "pending",
          ...patch,
        } as never);
      return { owner, projectId: project.id, iso, report };
    };

    const support = async (
      owner: { id: string; roles: string[] },
      projectId: number,
    ) =>
      (
        await ctx.reportsController.getReportsSupport.fetch(
          { params: { id: projectId }, query: {} },
          { user: owner },
        )
      ).data;

    it("splits intake by type, an untagged report being other", async ({
      expect,
    }) => {
      const { owner, projectId, report } = await seed();
      await report({ tags: ["type=bug", "severity=high"] });
      await report({ tags: ["type=feature"] });
      await report({ tags: [] });

      const data = await support(owner, projectId);

      expect(data.intake.at(-1)).toMatchObject({
        bug: 1,
        feature: 1,
        other: 1,
      });
      expect(data.severity).toContainEqual({ value: "high", count: 1 });
    });

    it("measures time to triage, and counts what it cannot", async ({
      expect,
    }) => {
      const { owner, projectId, report, iso } = await seed();
      await report({ status: "rejected" });
      const measured = await report({ status: "accepted" });
      await ctx.repos.feedback.updateById(measured.id, {
        triagedAt: new Date(
          Date.parse(measured.createdAt) + 4 * hour,
        ).toISOString(),
      });
      await report({ status: "pending", createdAt: iso(day) });

      const data = await support(owner, projectId);

      expect(data.outcomes).toEqual({ accepted: 1, rejected: 1, pending: 1 });
      expect(data.triage).toMatchObject({ measured: 1, unknown: 1 });
      expect(data.triage.medianHours).toBeCloseTo(4);
    });

    it("ships a report once every quest it became is done", async ({
      expect,
    }) => {
      const { owner, projectId, report, iso } = await seed();
      const row = await report({ status: "accepted" });
      const first = await createTestQuest(ctx, owner, projectId);
      const second = await createTestQuest(ctx, owner, projectId);
      await ctx.repos.quests.updateById(first.id, {
        feedbackId: row.id,
        completedAt: iso(0),
      });
      await ctx.repos.quests.updateById(second.id, { feedbackId: row.id });

      expect((await support(owner, projectId)).conversion).toMatchObject({
        accepted: 1,
        withQuest: 1,
        shipped: 0,
      });

      await ctx.repos.quests.updateById(second.id, { completedAt: iso(0) });

      expect((await support(owner, projectId)).conversion.shipped).toBe(1);
    });

    it("ranks host and path tags, and ages what is pending", async ({
      expect,
    }) => {
      const { owner, projectId, report } = await seed();
      await report({ tags: ["host=a.dev", "path=/x"] });
      await report({ tags: ["host=a.dev"] });

      const data = await support(owner, projectId);

      expect(data.sources[0]).toEqual({ value: "host=a.dev", count: 2 });
      expect(data.pendingAge.find((row) => row.key === "under1w")?.count).toBe(
        2,
      );
    });
  });

  /**
   * The Backlog tab's report (#Q3002).
   */
  describe("getReportsBacklog", () => {
    const day = 86_400_000;
    const backlog = async (
      owner: { id: string; roles: string[] },
      projectId: number,
    ) =>
      (
        await ctx.reportsController.getReportsBacklog.fetch(
          { params: { id: projectId }, query: {} },
          { user: owner },
        )
      ).data;

    it("keeps every value of an axis, stacked by state", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      for (let index = 0; index < 10; index++) {
        await createTestQuest(ctx, owner, project.id, {
          area: `area-${index}`,
        });
      }
      const held = await createTestQuest(ctx, owner, project.id, {
        area: "area-0",
        tags: ["bug", "ui"],
      });
      await ctx.repos.quests.updateById(held.id, {
        heldAt: new Date(ctx.now() - 2 * day).toISOString(),
        heldBy: owner.id,
      });

      const data = await backlog(owner, project.id);

      expect(data.byArea).toHaveLength(10);
      expect(data.byArea[0]).toEqual({
        value: "area-0",
        todo: 1,
        inProgress: 0,
        onHold: 1,
      });
      // One quest, two tags: the rows overlap.
      expect(data.byTag.map((row) => row.value).sort()).toEqual(["bug", "ui"]);
      expect(data.held[0]?.heldBy).toBe(owner.id);
      expect(data.held[0]?.heldDays).toBeCloseTo(2);
    });

    it("groups a blocked chain under the quest at its head", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      const head = await createTestQuest(ctx, owner, project.id, {
        title: "head",
      });
      const middle = await createTestQuest(ctx, owner, project.id);
      const tail = await createTestQuest(ctx, owner, project.id);
      await ctx.repos.quests.updateById(middle.id, { dependsOn: head.id });
      await ctx.repos.quests.updateById(tail.id, { dependsOn: middle.id });

      const { blocked } = await backlog(owner, project.id);

      expect(blocked).toHaveLength(1);
      expect(blocked[0]?.blocker.title).toBe("head");
      expect(blocked[0]?.blocked).toHaveLength(2);
      expect(blocked[0]?.depth).toBe(2);
    });

    it("survives a dependency cycle a past write left", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      const a = await createTestQuest(ctx, owner, project.id);
      const b = await createTestQuest(ctx, owner, project.id);
      await ctx.repos.quests.updateById(a.id, { dependsOn: b.id });
      await ctx.repos.quests.updateById(b.id, { dependsOn: a.id });

      await expect(backlog(owner, project.id)).resolves.toBeDefined();
    });

    it("splits overdue from due soon, and leaves the far future out", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      const due = async (days: number) => {
        const quest = await createTestQuest(ctx, owner, project.id);
        await ctx.repos.quests.updateById(quest.id, {
          dueAt: new Date(ctx.now() + days * day).toISOString(),
        });
      };
      await due(-3);
      await due(3);
      await due(30);

      const data = await backlog(owner, project.id);

      expect(data.overdue).toHaveLength(1);
      expect(data.dueSoon).toHaveLength(1);
    });

    it("lists hygiene gaps, and counts objectives done against waived", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      await createTestQuest(ctx, owner, project.id);
      const done = await createTestQuest(ctx, owner, project.id);
      await ctx.repos.quests.updateById(done.id, {
        completedAt: new Date(ctx.now()).toISOString(),
        objectives: [
          { id: 0, title: "a", completed: true },
          { id: 1, title: "b", completed: false, waivedReason: "no" },
        ],
      });

      const data = await backlog(owner, project.id);

      expect(data.hygiene[0]?.noObjectives).toBe(true);
      expect(data.objectives).toEqual({ completed: 1, waived: 1 });
    });

    it("rates shelved quests over the project", async ({ expect }) => {
      const owner = await createTestUser(ctx);
      const project = await createTestProject(ctx, owner);
      await createTestQuest(ctx, owner, project.id);
      const shelved = await createTestQuest(ctx, owner, project.id);
      await ctx.questController.shelveQuest.fetch(
        { params: { id: shelved.id } },
        { user: owner },
      );

      expect((await backlog(owner, project.id)).shelvedRate).toBe(50);
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

      const res = await overviewOf(
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

      const res = await overviewOf(
        {
          params: { id: projectId },
          query: { from: iso(7), to: iso(0), compare: true },
        },
        { user: owner },
      );

      expect(res.data.previous?.completed).toBe(1);

      const wider = await overviewOf(
        {
          params: { id: projectId },
          query: { from: iso(10), to: iso(0), compare: true },
        },
        { user: owner },
      );
      expect(wider.data.previous?.completed).toBe(1);
      expect(wider.data.previous?.medianCycleTimeHours).toBeCloseTo(100);

      const quests = await questsOf(
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

      const res = await overviewOf(
        { params: { id: projectId }, query: { compare: true } },
        { user: owner },
      );

      expect(res.data.previous).toBeUndefined();
    });

    it("applies the Work filters, a tag included", async ({ expect }) => {
      const { owner, projectId } = await seed();
      const fetch = async (query: Record<string, unknown>) =>
        (
          await overviewOf(
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

      const res = await overviewOf(
        { params: { id: projectId }, query: { memberId: owner.id } },
        { user: owner },
      );

      expect(res.data.kpis.totalQuests).toBe(4);
    });

    it("draws the burn-up at the grain asked for", async ({ expect }) => {
      const { owner, projectId, iso } = await seed();

      const res = await overviewOf(
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
          await overviewOf(
            {
              params: { id: projectId },
              query: staleDays ? { staleDays } : {},
            },
            { user: owner },
          )
        ).data.attention.staleQuests;

      expect(await stale()).toBe(0);
      expect(await stale(3)).toBe(1);

      const report = await questsOf(
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

      const res = await overviewOf(
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

      const overview = await overviewOf(
        { params: { id: project.id } },
        { user: owner },
      );

      expect(overview.data.kpis.completedQuests).toBe(1);
      // The burn-up is cumulative, so the last point carries the total.
      const last = overview.data.burnup[overview.data.burnup.length - 1];
      expect(last?.completed).toBe(1);
    });

    it("keeps the funnel consistent with the KPI totals", async ({
      expect,
    }) => {
      const c = await setupEpicProject();

      const res = await questsOf(
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
