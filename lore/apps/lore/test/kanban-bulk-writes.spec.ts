import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import type { Project } from "../src/api/entities/projects.ts";
import { LoreApi } from "../src/api/index.ts";
import {
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

interface TestContext {
  alepha: Alepha;
  projects: ProjectController;
  quests: QuestController;
  repos: TestEntityRepositories;
}

/**
 * Pinned `DATABASE_URL`, like every other lore spec: the ROOT vitest config
 * points it at Postgres, which this app's SQLite provider refuses outright.
 */
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

  const repos = alepha.inject(TestEntityRepositories);
  await alepha.start();

  return {
    alepha,
    projects: alepha.inject(ProjectController),
    quests: alepha.inject(QuestController),
    repos,
  };
};

const ownerToken = (project: { createdBy: string }): UserAccountToken => ({
  id: project.createdBy,
  roles: ["user"],
});

/**
 * The two kanban write paths that used to update one quest per statement.
 *
 * Neither had any coverage, and both are the shape where a rewrite fails
 * silently: a cascade that stops cascading leaves stale rows nothing reads
 * back, and the dependents clear has already been a no-op once — it wrote
 * `undefined`, which the repository strips from an update.
 */
describe("kanban writes that fan out over quests", () => {
  let ctx: TestContext;
  let project: Project;

  beforeEach(async () => {
    ctx = await setup();
    project = await createTestProject(ctx.alepha, {
      kanbanColumns: ["Todo", "Doing", "Done"],
    });
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("carries every quest in a column across a rename", async ({ expect }) => {
    for (let i = 0; i < 5; i += 1) {
      await createTestQuest(ctx.alepha, project, { kanbanColumn: "Doing" });
    }
    const untouched = await createTestQuest(ctx.alepha, project, {
      kanbanColumn: "Todo",
    });

    const columns = await ctx.projects.renameKanbanColumn(
      {
        params: { id: project.id },
        body: { oldName: "Doing", newName: "In Progress" },
      },
      { user: ownerToken(project) },
    );

    expect(columns).toEqual(["Todo", "In Progress", "Done"]);

    // Every quest moved, and only those. A cascade that silently stops
    // leaves rows pointing at a column name the project no longer lists,
    // which renders as an empty board lane rather than as an error.
    const moved = await ctx.repos.quests.findMany({
      where: {
        projectId: { eq: project.id },
        kanbanColumn: { eq: "In Progress" },
      },
    });
    expect(moved).toHaveLength(5);

    expect(
      await ctx.repos.quests.count({
        projectId: { eq: project.id },
        kanbanColumn: { eq: "Doing" },
      }),
    ).toBe(0);

    const after = await ctx.repos.quests.getById(untouched.id);
    expect(after.kanbanColumn).toBe("Todo");
  });

  it("leaves another project's identically named column alone", async ({
    expect,
  }) => {
    const other = await createTestProject(ctx.alepha, {
      kanbanColumns: ["Todo", "Doing", "Done"],
    });
    const stranger = await createTestQuest(ctx.alepha, other, {
      kanbanColumn: "Doing",
    });
    await createTestQuest(ctx.alepha, project, { kanbanColumn: "Doing" });

    await ctx.projects.renameKanbanColumn(
      {
        params: { id: project.id },
        body: { oldName: "Doing", newName: "In Progress" },
      },
      { user: ownerToken(project) },
    );

    // The `projectId` conjunct is the whole tenancy story of this statement
    // now that it is one UPDATE rather than a filtered read followed by
    // per-id writes.
    const after = await ctx.repos.quests.getById(stranger.id);
    expect(after.kanbanColumn).toBe("Doing");
  });

  it("clears every dependent's dependsOn when a quest is deleted", async ({
    expect,
  }) => {
    const root = await createTestQuest(ctx.alepha, project);
    const dependents = [];
    for (let i = 0; i < 4; i += 1) {
      dependents.push(
        await createTestQuest(ctx.alepha, project, { dependsOn: root.id }),
      );
    }
    const unrelated = await createTestQuest(ctx.alepha, project, {
      dependsOn: dependents[0].id,
    });

    await ctx.quests.deleteQuest(
      { params: { id: root.id } },
      { user: ownerToken(project) },
    );

    // `null`, not `undefined` — the repository strips undefined keys from
    // an update, which made this a no-op once already. An edge left
    // pointing at a deleted quest draws a questline node that 404s.
    for (const dep of dependents) {
      const after = await ctx.repos.quests.getById(dep.id);
      expect(after.dependsOn).toBeUndefined();
    }

    const other = await ctx.repos.quests.getById(unrelated.id);
    expect(other.dependsOn).toBe(dependents[0].id);
  });
});
