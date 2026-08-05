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
  reports: ProjectReportsController;
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
    reports: alepha.inject(ProjectReportsController),
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
    { body: { title: "Shelf probe" } },
    { user },
  );
  return project.data.id;
};

const createQuest = async (
  ctx: TestContext,
  user: { id: string },
  projectId: number,
  title: string,
  extra: Record<string, unknown> = {},
) => {
  const res = await ctx.quests.createQuest.fetch(
    {
      body: {
        projectId,
        title,
        description: "",
        zone: "ops",
        priority: "low",
        difficulty: 1,
        ...extra,
      },
    },
    { user },
  );
  return res.data;
};

describe("QuestController — shelving", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("shelves a new quest and reports the shelved status", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const cid = await createProject(ctx, user);
    const quest = await createQuest(ctx, user, cid, "Someday maybe");

    const res = await ctx.quests.shelveQuest.fetch(
      { params: { id: quest.id } },
      { user },
    );

    expect(res.data.shelvedAt).toBeTruthy();
    expect(res.data.shelvedBy).toBe(user.id);
    expect(res.data.metadata.status).toBe("shelved");
    expect(res.data.history.at(-1)?.action).toBe("shelved");
  });

  it("refuses to shelve an accepted quest", async ({ expect }) => {
    const user = await createUser(ctx);
    const cid = await createProject(ctx, user);
    const quest = await createQuest(ctx, user, cid, "In flight");
    await ctx.quests.acceptQuest.fetch({ params: { id: quest.id } }, { user });

    await expect(
      ctx.quests.shelveQuest.fetch({ params: { id: quest.id } }, { user }),
    ).rejects.toThrowError();
  });

  it("refuses to shelve a completed quest", async ({ expect }) => {
    const user = await createUser(ctx);
    const cid = await createProject(ctx, user);
    const quest = await createQuest(ctx, user, cid, "Already done");
    await ctx.quests.acceptQuest.fetch({ params: { id: quest.id } }, { user });
    await ctx.quests.completeQuest.fetch(
      { params: { id: quest.id }, body: {} },
      { user },
    );

    await expect(
      ctx.quests.shelveQuest.fetch({ params: { id: quest.id } }, { user }),
    ).rejects.toThrowError();
  });

  it("unshelves back to new", async ({ expect }) => {
    const user = await createUser(ctx);
    const cid = await createProject(ctx, user);
    const quest = await createQuest(ctx, user, cid, "Back from the shelf");
    await ctx.quests.shelveQuest.fetch({ params: { id: quest.id } }, { user });

    const res = await ctx.quests.unshelveQuest.fetch(
      { params: { id: quest.id } },
      { user },
    );

    expect(res.data.shelvedAt).toBeUndefined();
    expect(res.data.metadata.status).toBe("new");
    expect(res.data.history.at(-1)?.action).toBe("unshelved");
  });

  it("accepting a shelved quest takes it off the shelf", async ({ expect }) => {
    const user = await createUser(ctx);
    const cid = await createProject(ctx, user);
    const quest = await createQuest(ctx, user, cid, "Picked back up");
    await ctx.quests.shelveQuest.fetch({ params: { id: quest.id } }, { user });

    const res = await ctx.quests.acceptQuest.fetch(
      { params: { id: quest.id } },
      { user },
    );

    expect(res.data.shelvedAt).toBeUndefined();
    expect(res.data.metadata.status).toBe("accepted");
  });

  it("hides shelved quests from the default list and from status=new", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const cid = await createProject(ctx, user);
    const keep = await createQuest(ctx, user, cid, "Keep me");
    const shelf = await createQuest(ctx, user, cid, "Shelve me");
    await ctx.quests.shelveQuest.fetch({ params: { id: shelf.id } }, { user });

    const all = await ctx.quests.getQuests.fetch(
      { params: { projectId: cid }, query: {} },
      { user },
    );
    expect(all.data.content.map((q) => q.id)).toEqual([keep.id]);

    const news = await ctx.quests.getQuests.fetch(
      { params: { projectId: cid }, query: { status: "new" } },
      { user },
    );
    expect(news.data.content.map((q) => q.id)).toEqual([keep.id]);
  });

  it("returns shelved quests only under status=shelved", async ({ expect }) => {
    const user = await createUser(ctx);
    const cid = await createProject(ctx, user);
    await createQuest(ctx, user, cid, "Keep me");
    const shelf = await createQuest(ctx, user, cid, "Shelve me");
    await ctx.quests.shelveQuest.fetch({ params: { id: shelf.id } }, { user });

    const res = await ctx.quests.getQuests.fetch(
      { params: { projectId: cid }, query: { status: "shelved" } },
      { user },
    );

    expect(res.data.content.map((q) => q.id)).toEqual([shelf.id]);
  });

  it("drops shelved quests out of the project stats denominator", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const cid = await createProject(ctx, user);
    await createQuest(ctx, user, cid, "Counts");
    const shelf = await createQuest(ctx, user, cid, "Does not count");

    const before = await ctx.reports.getReportsOverview.fetch(
      { params: { id: cid } },
      { user },
    );
    expect(before.data.kpis.totalQuests).toBe(2);
    expect(before.data.attention.unassignedQuests).toBe(2);

    await ctx.quests.shelveQuest.fetch({ params: { id: shelf.id } }, { user });

    const after = await ctx.reports.getReportsOverview.fetch(
      { params: { id: cid } },
      { user },
    );
    expect(after.data.kpis.totalQuests).toBe(1);
    expect(after.data.attention.unassignedQuests).toBe(1);
  });
});
