import { ProjectController } from "@lore/core/api";
import { $hook, Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import { KanbanController, QuestController } from "../src/api/index.ts";
import { LoreWorkApi } from "../src/api/index.ts";
import { WorkTestEntities } from "../src/testing/index.ts";

/**
 * Lands a second request between the first one's gate read and its write:
 * the D1 interleaving, made deterministic. Armed with the request to run; it
 * fires on the next read of a quest row, once.
 */
class Interleave {
  public next?: () => Promise<unknown>;

  onRead = $hook({
    on: "repository:read:after",
    handler: async ({ tableName }) => {
      if (tableName !== "quests" || !this.next) return;
      const run = this.next;
      this.next = undefined;
      await run();
    },
  });
}

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  admin: AdminUserController;
  projects: ProjectController;
  quests: QuestController;
  kanban: KanbanController;
  fake: FakeProvider;
  interleave: Interleave;
  repos: WorkTestEntities;
}

const setup = async (): Promise<TestContext> => {
  // Transactions off, as on D1: only the version stands between the two.
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      DATABASE_TRANSACTIONS: false,
    },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreWorkApi);
  const interleave = alepha.inject(Interleave);
  const repos = alepha.inject(WorkTestEntities);
  await alepha.start();
  return {
    alepha,
    admin: alepha.inject(AdminUserController),
    projects: alepha.inject(ProjectController),
    quests: alepha.inject(QuestController),
    kanban: alepha.inject(KanbanController),
    fake: alepha.inject(FakeProvider),
    interleave,
    repos,
  };
};

const createUser = async (ctx: TestContext) => {
  const fake = ctx.fake.generate(userDataSchema);
  const response = await ctx.admin.createUser.fetch(
    { body: { ...fake, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

const acceptedQuest = async (ctx: TestContext) => {
  const user = await createUser(ctx);
  const project = await ctx.projects.createProject.fetch(
    { body: { title: "Version races" } },
    { user },
  );
  const quest = await ctx.quests.createQuest.fetch(
    {
      body: {
        projectId: project.data.id,
        title: "Raced",
        description: "",
        area: "ops",
        priority: "low",
      },
    },
    { user },
  );
  await ctx.quests.acceptQuest.fetch(
    { params: { id: quest.data.id } },
    { user },
  );
  return { user, id: quest.data.id };
};

describe("quests.version (#Q2546)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("an unassign racing a completion answers 409 and keeps completedAt", async ({
    expect,
  }) => {
    const { user, id } = await acceptedQuest(ctx);

    ctx.interleave.next = () =>
      ctx.quests.completeQuest.fetch({ params: { id }, body: {} }, { user });

    await expect(
      ctx.quests.unassignQuest.fetch({ params: { id } }, { user }),
    ).rejects.toMatchObject({ status: 409 });

    const row = await ctx.repos.quests.getById(id);
    expect(row.completedAt).toBeDefined();
    expect(row.acceptedBy).toBe(user.id);
  });

  it("a stale expectedUpdatedAt racing a write answers 409", async ({
    expect,
  }) => {
    const { user, id } = await acceptedQuest(ctx);
    const { updatedAt } = await ctx.repos.quests.getById(id);

    ctx.interleave.next = () =>
      ctx.quests.updateQuestById.fetch(
        { params: { id }, body: { title: "Concurrent" } },
        { user },
      );

    await expect(
      ctx.quests.updateQuestById.fetch(
        {
          params: { id },
          body: { description: "mine", expectedUpdatedAt: updatedAt },
        },
        { user },
      ),
    ).rejects.toMatchObject({ status: 409 });

    const row = await ctx.repos.quests.getById(id);
    expect(row.title).toBe("Concurrent");
    expect(row.description).toBe("");
  });

  it("a board move never reverts a concurrent edit", async ({ expect }) => {
    const { user, id } = await acceptedQuest(ctx);

    ctx.interleave.next = () =>
      ctx.quests.updateQuestById.fetch(
        { params: { id }, body: { title: "Renamed mid-drag" } },
        { user },
      );

    await ctx.kanban.moveQuestOnBoard.fetch(
      { params: { id }, body: {} },
      { user },
    );

    const row = await ctx.repos.quests.getById(id);
    expect(row.title).toBe("Renamed mid-drag");
    expect(row.boardRank).toBeTruthy();
  });
});
