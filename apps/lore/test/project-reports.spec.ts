import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { ProjectReportsController } from "../src/api/controllers/ProjectReportsController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";
import { TestEntityRepositories } from "./fixtures/entities.ts";

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
  repos: TestEntityRepositories;
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

  // Registered before `start()` so the backlog-gate tests below can write
  // `epics` rows directly — there is no EpicController yet.
  const repos = alepha.inject(TestEntityRepositories);

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    questController: alepha.inject(QuestController),
    reportsController: alepha.inject(ProjectReportsController),
    fakeProvider: alepha.inject(FakeProvider),
    repos,
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
        res.data.funnel.new +
          res.data.funnel.accepted +
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
   * The Reports gate is hand-written SQL (`questInScope`), not the
   * repository where-object every other surface uses, so it re-implements
   * both traps by hand and gets neither for free. Every other spec in this
   * file runs with zero epics, which exercises only the branch that emits
   * no clause at all — these two cover the branch that does.
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
      // The shelved-quest exemption `liveQuest` relies on does NOT carry
      // over here: only a `new` quest can be shelved, so a shelved quest is
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

      // Same two quests, both still `new` — the gate filters, it never
      // touches a quest's lifecycle state.
      expect(res.data.funnel.new).toBe(2);
      expect(res.data.funnel.accepted).toBe(0);
      expect(res.data.funnel.completed).toBe(0);
    });
  });
});
