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
  fake: FakeProvider;
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
  await alepha.start();
  return {
    alepha,
    admin: alepha.inject(AdminUserController),
    projects: alepha.inject(ProjectController),
    quests: alepha.inject(QuestController),
    fake: alepha.inject(FakeProvider),
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

const createProject = async (ctx: TestContext, user: { id: string }) => {
  const project = await ctx.projects.createProject.fetch(
    { body: { title: "Transition probe" } },
    { user },
  );
  return project.data.id;
};

const createQuest = async (
  ctx: TestContext,
  user: { id: string },
  projectId: number,
  title: string,
) => {
  const res = await ctx.quests.createQuest.fetch(
    {
      body: {
        projectId,
        title,
        description: "",
        area: "ops",
        priority: "low",
      },
    },
    { user },
  );
  return res.data;
};

/**
 * Every quest lifecycle transition used to encode its precondition in the
 * `getOne` where-clause, so a quest in the wrong state was indistinguishable
 * from a row that does not exist and surfaced as the ORM's
 * `DbEntityNotFoundError` — "Entity from 'quests' was not found".
 *
 * These are regression guards: a precondition failure must name the actual
 * status and never claim the quest is missing.
 */
describe("QuestController — transition preconditions", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("refuses to complete a quest that was never accepted, saying so", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const cid = await createProject(ctx, user);
    const quest = await createQuest(ctx, user, cid, "Not started");

    const call = ctx.quests.completeQuest.fetch(
      { params: { id: quest.id }, body: {} },
      { user },
    );

    await expect(call).rejects.toThrow(/accepted/i);
    await expect(call).rejects.not.toThrow(/was not found/i);
  });

  it("refuses to complete an already-completed quest, saying so", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const cid = await createProject(ctx, user);
    const quest = await createQuest(ctx, user, cid, "Done already");
    await ctx.quests.acceptQuest.fetch({ params: { id: quest.id } }, { user });
    await ctx.quests.completeQuest.fetch(
      { params: { id: quest.id }, body: {} },
      { user },
    );

    const call = ctx.quests.completeQuest.fetch(
      { params: { id: quest.id }, body: {} },
      { user },
    );

    await expect(call).rejects.toThrow(/completed/i);
    await expect(call).rejects.not.toThrow(/was not found/i);
  });

  it("refuses to accept an already-accepted quest, saying so", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const cid = await createProject(ctx, user);
    const quest = await createQuest(ctx, user, cid, "In flight");
    await ctx.quests.acceptQuest.fetch({ params: { id: quest.id } }, { user });

    const call = ctx.quests.acceptQuest.fetch(
      { params: { id: quest.id } },
      { user },
    );

    await expect(call).rejects.toThrow(/accepted/i);
    await expect(call).rejects.not.toThrow(/was not found/i);
  });

  it("refuses to abandon a quest nobody accepted, saying so", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const cid = await createProject(ctx, user);
    const quest = await createQuest(ctx, user, cid, "Untouched");

    const call = ctx.quests.abandonQuest.fetch(
      { params: { id: quest.id } },
      { user },
    );

    await expect(call).rejects.toThrow(/new/i);
    await expect(call).rejects.not.toThrow(/was not found/i);
  });

  it("refuses to unshelve a quest that is not shelved, saying so", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const cid = await createProject(ctx, user);
    const quest = await createQuest(ctx, user, cid, "On the board");

    const call = ctx.quests.unshelveQuest.fetch(
      { params: { id: quest.id } },
      { user },
    );

    await expect(call).rejects.toThrow(/shelved/i);
    await expect(call).rejects.not.toThrow(/was not found/i);
  });

  it("refuses to start a timer on an unaccepted quest, saying so", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const cid = await createProject(ctx, user);
    const quest = await createQuest(ctx, user, cid, "No timer yet");

    const call = ctx.quests.startTimer.fetch(
      { params: { id: quest.id } },
      { user },
    );

    await expect(call).rejects.toThrow(/accepted/i);
    await expect(call).rejects.not.toThrow(/was not found/i);
  });

  it("still reports a genuinely missing quest as not found", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    await createProject(ctx, user);

    await expect(
      ctx.quests.completeQuest.fetch(
        { params: { id: 987654 }, body: {} },
        { user },
      ),
    ).rejects.toThrow(/not found/i);
  });
});
