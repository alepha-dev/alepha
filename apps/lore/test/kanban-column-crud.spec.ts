import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * The four column endpoints the board drives since #1511, and the one they
 * had a bug in.
 *
 * ⚠️ **The bug, and why it needed a live board to find.** `deleteKanbanColumn`
 * and `renameKanbanColumn` both wrote
 * `kanbanColumnConfig: Object.keys(map).length ? map : undefined`. An
 * undefined patch value means "leave unchanged" to `updateById`, so emptying
 * the map wrote nothing at all: the last configured column's settings
 * survived its deletion, and adding a column back with that name resurrected
 * them. That is verbatim the outcome the handler's own comment says it exists
 * to prevent, and every test passed while it happened, because no test had
 * ever emptied the map.
 */
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

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    questController: alepha.inject(QuestController),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

describe("kanban columns, created and edited from the board", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const world = async () => {
    const fake = ctx.fakeProvider.generate(userDataSchema);
    const created = await ctx.adminUserController.createUser.fetch(
      { body: { ...fake, roles: ["user"] } },
      { user: adminUser },
    );
    const user = { id: created.data.id, roles: created.data.roles };
    const project = (
      await ctx.projectController.createProject.fetch(
        {
          body: {
            title: `Columns ${Math.random().toString(36).slice(2, 8)}`,
          },
        },
        { user },
      )
    ).data;
    return { user, projectId: project.id };
  };

  const read = async (
    user: { id: string; roles: string[] },
    projectId: number,
  ) =>
    (
      await ctx.projectController.getProjectById.fetch(
        { params: { id: projectId } },
        { user },
      )
    ).data;

  const setColor = (
    user: { id: string; roles: string[] },
    projectId: number,
    config: Record<string, { color?: "violet" | "amber" }>,
  ) =>
    ctx.projectController.updateProjectById.fetch(
      { params: { id: projectId }, body: { kanbanColumnConfig: config } },
      { user },
    );

  it("adds a column from nothing", async ({ expect }) => {
    const { user, projectId } = await world();

    const columns = (
      await ctx.projectController.addKanbanColumn.fetch(
        { params: { id: projectId }, body: { name: "Review" } },
        { user },
      )
    ).data;

    expect(columns).toContain("Review");
  });

  it("carries a colour across a rename", async ({ expect }) => {
    const { user, projectId } = await world();
    await ctx.projectController.addKanbanColumn.fetch(
      { params: { id: projectId }, body: { name: "Review" } },
      { user },
    );
    await setColor(user, projectId, { Review: { color: "violet" } });

    await ctx.projectController.renameKanbanColumn.fetch(
      { params: { id: projectId }, body: { oldName: "Review", newName: "QA" } },
      { user },
    );

    const project = await read(user, projectId);
    expect(project.kanbanColumns).toContain("QA");
    // The map is keyed by name, so a rename that did not carry the entry
    // would silently reset the column's tint.
    expect(project.kanbanColumnConfig).toEqual({ QA: { color: "violet" } });
  });

  it("drops a deleted column's settings, so re-creating the name does not resurrect them", async ({
    expect,
  }) => {
    // The regression this file exists for.
    const { user, projectId } = await world();
    await ctx.projectController.addKanbanColumn.fetch(
      { params: { id: projectId }, body: { name: "Review" } },
      { user },
    );
    await setColor(user, projectId, { Review: { color: "violet" } });

    await ctx.projectController.deleteKanbanColumn.fetch(
      { params: { id: projectId }, body: { name: "Review" } },
      { user },
    );

    // Emptying the map has to WRITE the empty state. Before the fix this
    // still read `{ Review: { color: "violet" } }`.
    const afterDelete = await read(user, projectId);
    expect(afterDelete.kanbanColumnConfig ?? null).toBeNull();

    await ctx.projectController.addKanbanColumn.fetch(
      { params: { id: projectId }, body: { name: "Review" } },
      { user },
    );
    const afterReadd = await read(user, projectId);
    expect(afterReadd.kanbanColumns).toContain("Review");
    expect(afterReadd.kanbanColumnConfig ?? null).toBeNull();
  });

  it("keeps the OTHER columns' settings when one is deleted", async ({
    expect,
  }) => {
    // The half the `null` fix must not break: only an EMPTIED map is written
    // as null.
    const { user, projectId } = await world();
    for (const name of ["Review", "QA"]) {
      await ctx.projectController.addKanbanColumn.fetch(
        { params: { id: projectId }, body: { name } },
        { user },
      );
    }
    await setColor(user, projectId, {
      Review: { color: "violet" },
      QA: { color: "amber" },
    });

    await ctx.projectController.deleteKanbanColumn.fetch(
      { params: { id: projectId }, body: { name: "Review" } },
      { user },
    );

    expect((await read(user, projectId)).kanbanColumnConfig).toEqual({
      QA: { color: "amber" },
    });
  });

  it("refuses to delete a column that still holds quests", async ({
    expect,
  }) => {
    const { user, projectId } = await world();
    await ctx.projectController.addKanbanColumn.fetch(
      { params: { id: projectId }, body: { name: "Review" } },
      { user },
    );

    const quest = (
      await ctx.questController.createQuest.fetch(
        {
          body: {
            projectId,
            title: "Sitting in Review",
            area: "ui",
            priority: "medium",
          },
        },
        { user },
      )
    ).data;
    await ctx.questController.acceptQuest.fetch(
      { params: { id: quest.id } },
      { user },
    );
    // `setQuestKanbanColumn`, not `updateQuestById`: the column is not part
    // of the quest body, and the update path silently ignores it.
    await ctx.questController.setQuestKanbanColumn.fetch(
      { params: { id: quest.id }, body: { kanbanColumn: "Review" } },
      { user },
    );

    // The board's confirmation says the column has to be empty first, and
    // this is what makes that promise true rather than optimistic.
    await expect(
      ctx.projectController.deleteKanbanColumn.fetch(
        { params: { id: projectId }, body: { name: "Review" } },
        { user },
      ),
    ).rejects.toThrow(/quests in this column/);
  });
});
