import { ProjectController } from "@lore/core/api";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { $repository } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import { FeedbackController, QuestController } from "../src/api/index.ts";
import { LorePlanApi } from "../src/api/index.ts";
import { feedback, quests } from "../src/schemas/index.ts";

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
  alepha.with(LorePlanApi);
  alepha.inject(Rows);

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    feedbackController: alepha.inject(FeedbackController),
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
      body: {
        title: "Untrusted Test",
        capabilities: [{ key: "plan" as const, options: { feedback: true } }],
      },
    },
    { user },
  );
  return created.data.id;
};

const submit = (
  ctx: TestContext,
  projectId: number,
  user: { id: string; roles: string[] },
  n: number,
) =>
  ctx.feedbackController.submitFeedback.fetch(
    {
      params: { projectId },
      body: { title: `Bug ${n}`, description: "Something broke" },
    },
    { user },
  );

class Rows {
  feedback = $repository(feedback);
  quests = $repository(quests);
}

/**
 * Feedback written outside the team is marked untrusted at submit, never
 * cleared, and the marker reaches the quest born of it (#Q3987).
 */
describe("untrusted feedback", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const rowOf = (id: number) =>
    ctx.alepha.inject(Rows).feedback.getOne({ where: { id: { eq: id } } });

  it("marks a non-member's feedback untrusted and a member's trusted", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const outsider = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    const theirs = await submit(ctx, projectId, outsider, 1);
    const ours = await submit(ctx, projectId, owner, 2);

    expect((await rowOf(theirs.data.id)).untrusted).toBe(true);
    expect((await rowOf(ours.data.id)).untrusted).toBe(false);
  });

  it("keeps the marker through an accept, and puts it on a quest created from it", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const outsider = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const filed = await submit(ctx, projectId, outsider, 1);

    await ctx.feedbackController.acceptFeedback.fetch(
      { params: { projectId, feedbackId: filed.data.shortId } },
      { user: owner },
    );
    expect((await rowOf(filed.data.id)).untrusted).toBe(true);

    const created = await ctx.alepha.inject(QuestController).createQuest.fetch(
      {
        body: {
          projectId,
          title: "Fix the bug",
          area: "web",
          priority: "medium",
          feedbackId: filed.data.id,
        },
      },
      { user: owner },
    );
    const quest = await ctx.alepha
      .inject(Rows)
      .quests.getOne({ where: { id: { eq: created.data.id } } });
    expect(quest.untrusted).toBe(true);
    expect(quest.untrustedConfirmedAt).toBeFalsy();

    const plain = await ctx.alepha.inject(QuestController).createQuest.fetch(
      {
        body: {
          projectId,
          title: "Unrelated",
          area: "web",
          priority: "medium",
        },
      },
      { user: owner },
    );
    const trusted = await ctx.alepha
      .inject(Rows)
      .quests.getOne({ where: { id: { eq: plain.data.id } } });
    expect(trusted.untrusted).toBe(false);
  });
});
