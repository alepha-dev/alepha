import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { FeedbackController } from "../src/api/controllers/FeedbackController.ts";
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
  adminUserController: AdminUserController;
  projectController: ProjectController;
  feedbackController: FeedbackController;
  questController: QuestController;
  fakeProvider: FakeProvider;
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
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    feedbackController: alepha.inject(FeedbackController),
    questController: alepha.inject(QuestController),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (
  ctx: TestContext,
): Promise<{ id: string; roles: string[] }> => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

const createProject = async (
  ctx: TestContext,
  user: { id: string; roles: string[] },
): Promise<number> => {
  const created = await ctx.projectController.createProject.fetch(
    {
      body: { title: "Link Test", capabilities: [{ key: "support" as const }] },
    },
    { user },
  );
  return created.data.id;
};

const submitFeedback = async (
  ctx: TestContext,
  projectId: number,
  user: { id: string; roles: string[] },
): Promise<number> => {
  const created = await ctx.feedbackController.submitFeedback.fetch(
    {
      params: { projectId },
      body: { title: "Reported bug", description: "It broke" },
    },
    { user },
  );
  return created.data.id;
};

const createQuest = async (
  ctx: TestContext,
  projectId: number,
  user: { id: string; roles: string[] },
  feedbackId?: number,
): Promise<{ id: number }> => {
  const created = await ctx.questController.createQuest.fetch(
    {
      body: {
        projectId,
        title: "Fix the bug",
        description: "Investigate and fix",
        area: "Bugs",
        priority: "medium",
        feedbackId,
      },
    },
    { user },
  );
  return { id: created.data.id };
};

const linkedQuestIds = async (
  ctx: TestContext,
  projectId: number,
  feedbackId: number,
  user: { id: string; roles: string[] },
): Promise<number[]> => {
  const detail = await ctx.feedbackController.getFeedback.fetch(
    { params: { projectId, feedbackId } },
    { user },
  );
  return (detail.data.linkedQuests ?? []).map((q) => q.id);
};

describe("quest ↔ feedback linking", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("updateQuestById links an existing quest to an accepted feedback", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const feedbackId = await submitFeedback(ctx, projectId, owner);
    await ctx.feedbackController.acceptFeedback.fetch(
      { params: { projectId, feedbackId } },
      { user: owner },
    );
    const quest = await createQuest(ctx, projectId, owner);

    // Not linked yet.
    expect(await linkedQuestIds(ctx, projectId, feedbackId, owner)).toEqual([]);

    await ctx.questController.updateQuestById.fetch(
      { params: { id: quest.id }, body: { feedbackId } },
      { user: owner },
    );

    expect(await linkedQuestIds(ctx, projectId, feedbackId, owner)).toContain(
      quest.id,
    );
  });

  it("updateQuestById sets and clears dependsOn (the picker's save path)", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const predecessor = await createQuest(ctx, projectId, owner);
    const follower = await createQuest(ctx, projectId, owner);

    // Set the dependency (what the edit-form picker submits).
    const linked = await ctx.questController.updateQuestById.fetch(
      {
        params: { id: follower.id },
        body: { dependsOn: predecessor.id },
      },
      { user: owner },
    );
    expect(linked.data.dependsOn).toBe(predecessor.id);

    // Clear it (the picker's "No dependency" / X path → null).
    const cleared = await ctx.questController.updateQuestById.fetch(
      {
        params: { id: follower.id },
        body: { dependsOn: null },
      },
      { user: owner },
    );
    expect(cleared.data.dependsOn ?? null).toBeNull();
  });

  it("passing feedbackId: null unlinks the quest", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const feedbackId = await submitFeedback(ctx, projectId, owner);
    await ctx.feedbackController.acceptFeedback.fetch(
      { params: { projectId, feedbackId } },
      { user: owner },
    );
    // Linked at creation.
    const quest = await createQuest(ctx, projectId, owner, feedbackId);
    expect(await linkedQuestIds(ctx, projectId, feedbackId, owner)).toContain(
      quest.id,
    );

    await ctx.questController.updateQuestById.fetch(
      { params: { id: quest.id }, body: { feedbackId: null } },
      { user: owner },
    );

    expect(await linkedQuestIds(ctx, projectId, feedbackId, owner)).toEqual([]);
  });

  it("rejects linking to a feedback item that is not accepted", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const feedbackId = await submitFeedback(ctx, projectId, owner); // stays pending
    const quest = await createQuest(ctx, projectId, owner);

    const error = await ctx.questController.updateQuestById
      .fetch(
        { params: { id: quest.id }, body: { feedbackId } },
        { user: owner },
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(400);
  });

  it("rejects a non-owner trying to link a quest to a feedback item", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const outsider = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const feedbackId = await submitFeedback(ctx, projectId, owner);
    await ctx.feedbackController.acceptFeedback.fetch(
      { params: { projectId, feedbackId } },
      { user: owner },
    );
    const quest = await createQuest(ctx, projectId, owner);

    // An outsider (non-member, non-owner) cannot link the quest — the edit is
    // gated to the quest creator / project owner.
    const error = await ctx.questController.updateQuestById
      .fetch(
        { params: { id: quest.id }, body: { feedbackId } },
        { user: outsider },
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect([403, 404]).toContain((error as HttpError).status);
  });
});
