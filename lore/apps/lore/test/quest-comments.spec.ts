import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestCommentController } from "../src/api/controllers/QuestCommentController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { members } from "../src/api/entities/members.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * Membership rows have no endpoint that takes a user id directly — joining a
 * project goes through an emailed invitation. Writing the row is what these
 * tests actually need, so they write it.
 */
class Probe {
  members = $repository(members);
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
  comments: QuestCommentController;
  probe: Probe;
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
  // Injected before `start()`: the container locks on boot, and `Probe` is
  // not part of any module.
  const probe = alepha.inject(Probe);
  await alepha.start();
  return {
    alepha,
    probe,
    admin: alepha.inject(AdminUserController),
    projects: alepha.inject(ProjectController),
    quests: alepha.inject(QuestController),
    comments: alepha.inject(QuestCommentController),
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
    { body: { title: "Discussion probe" } },
    { user },
  );
  return project.data.id;
};

const createQuest = async (
  ctx: TestContext,
  user: { id: string },
  projectId: number,
) => {
  const res = await ctx.quests.createQuest.fetch(
    {
      body: {
        projectId,
        title: "Something to talk about",
        description: "",
        area: "ops",
        priority: "low",
      },
    },
    { user },
  );
  return res.data;
};

describe("QuestCommentController", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("posts a comment and lists it back in reading order", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const projectId = await createProject(ctx, user);
    const quest = await createQuest(ctx, user, projectId);

    await ctx.comments.createQuestComment.fetch(
      { params: { id: quest.id }, body: { body: "First" } },
      { user },
    );
    await ctx.comments.createQuestComment.fetch(
      { params: { id: quest.id }, body: { body: "Second" } },
      { user },
    );

    const listed = await ctx.comments.listQuestComments.fetch(
      { params: { id: quest.id }, query: {} },
      { user },
    );

    // Oldest first: a conversation reads downwards, even though the query
    // takes the most recent N.
    expect(listed.data.map((c) => c.body)).toEqual(["First", "Second"]);
    expect(listed.data[0].authorId).toBe(user.id);
    expect(listed.data[0].editedAt).toBeUndefined();
  });

  it("stamps editedAt on an edit, so the feed can say so honestly", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const projectId = await createProject(ctx, user);
    const quest = await createQuest(ctx, user, projectId);

    const created = await ctx.comments.createQuestComment.fetch(
      { params: { id: quest.id }, body: { body: "Draft" } },
      { user },
    );

    const updated = await ctx.comments.updateQuestComment.fetch(
      { params: { id: created.data.id }, body: { body: "Considered" } },
      { user },
    );

    expect(updated.data.body).toBe("Considered");
    expect(updated.data.editedAt).toBeTruthy();
  });

  it("refuses a non-member on every endpoint", async ({ expect }) => {
    const owner = await createUser(ctx);
    const stranger = await createUser(ctx);
    const projectId = await createProject(ctx, owner);
    const quest = await createQuest(ctx, owner, projectId);

    const mine = await ctx.comments.createQuestComment.fetch(
      { params: { id: quest.id }, body: { body: "Members only" } },
      { user: owner },
    );

    await expect(
      ctx.comments.listQuestComments.fetch(
        { params: { id: quest.id }, query: {} },
        { user: stranger },
      ),
    ).rejects.toThrow();

    await expect(
      ctx.comments.createQuestComment.fetch(
        { params: { id: quest.id }, body: { body: "Let me in" } },
        { user: stranger },
      ),
    ).rejects.toThrow();

    await expect(
      ctx.comments.deleteQuestComment.fetch(
        { params: { id: mine.data.id } },
        { user: stranger },
      ),
    ).rejects.toThrow();
  });

  it("lets only the author edit, even when the other member is the project owner", async ({
    expect,
  }) => {
    const owner = await createUser(ctx);
    const member = await createUser(ctx);
    const projectId = await createProject(ctx, owner);
    await ctx.probe.members.create({ userId: member.id, projectId });
    const quest = await createQuest(ctx, owner, projectId);

    const theirs = await ctx.comments.createQuestComment.fetch(
      { params: { id: quest.id }, body: { body: "My take" } },
      { user: member },
    );

    // An owner rewriting what someone else said, under their name, is a
    // different feature from moderation and not one anybody asked for.
    await expect(
      ctx.comments.updateQuestComment.fetch(
        { params: { id: theirs.data.id }, body: { body: "Actually…" } },
        { user: owner },
      ),
    ).rejects.toThrow();
  });

  it("lets the project owner delete someone else's comment", async ({
    expect,
  }) => {
    const owner = await createUser(ctx);
    const member = await createUser(ctx);
    const projectId = await createProject(ctx, owner);
    await ctx.probe.members.create({ userId: member.id, projectId });
    const quest = await createQuest(ctx, owner, projectId);

    const theirs = await ctx.comments.createQuestComment.fetch(
      { params: { id: quest.id }, body: { body: "Off topic" } },
      { user: member },
    );

    // Deleting IS moderation, so the owner may.
    await ctx.comments.deleteQuestComment.fetch(
      { params: { id: theirs.data.id } },
      { user: owner },
    );

    const listed = await ctx.comments.listQuestComments.fetch(
      { params: { id: quest.id }, query: {} },
      { user: owner },
    );
    expect(listed.data).toHaveLength(0);
  });

  it("takes the discussion with the quest when the quest is deleted", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const projectId = await createProject(ctx, user);
    const quest = await createQuest(ctx, user, projectId);

    await ctx.comments.createQuestComment.fetch(
      { params: { id: quest.id }, body: { body: "Doomed" } },
      { user },
    );

    await ctx.quests.deleteQuest.fetch({ params: { id: quest.id } }, { user });

    // The cascade is what makes `quests` a cascade parent — which is why
    // #1254's DROP COLUMN had to land before this table existed.
    await expect(
      ctx.comments.listQuestComments.fetch(
        { params: { id: quest.id }, query: {} },
        { user },
      ),
    ).rejects.toThrow();
  });
});
