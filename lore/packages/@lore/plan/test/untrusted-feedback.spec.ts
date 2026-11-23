import { ProjectController } from "@lore/core/api";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { $repository } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
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
 * cleared, and the marker reaches the quest born of it (#Q3987). A member
 * trusts it by hand, from a signed-in session only (#Q4216).
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
      { params: { projectId, feedbackId: filed.data.id } },
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
  describe("trust (#Q4216)", () => {
    const trust = (
      projectId: number,
      feedbackId: number,
      user: Record<string, unknown>,
    ) =>
      ctx.feedbackController.trustFeedback.fetch(
        { params: { projectId, feedbackId } },
        { user: user as { id: string; roles: string[] } },
      );

    it("records who trusted an untrusted item and when, and keeps the marker", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const outsider = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const filed = await submit(ctx, projectId, outsider, 1);

      const out = await trust(projectId, filed.data.id, owner);
      expect(out.data.trustedBy).toBe(owner.id);
      const row = await rowOf(filed.data.id);
      expect(row.untrusted).toBe(true);
      expect(row.trustedAt).toBeTruthy();
      expect(row.trustedBy).toBe(owner.id);

      const read = await ctx.feedbackController.getFeedback.fetch(
        { params: { projectId, feedbackId: filed.data.id } },
        { user: owner },
      );
      expect(read.data.truster?.id).toBe(owner.id);
    });

    it("refuses an API key, a job key and an MCP token: a person trusts, never a machine", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const outsider = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const filed = await submit(ctx, projectId, outsider, 1);

      // A job key is an API key; the MCP authenticates by API key or by an
      // OAuth access token.
      for (const credential of [
        { type: "api-key", id: "key-1" },
        { type: "oauth", clientId: "mcp-client" },
      ]) {
        // `run`, not `fetch`: the user is handed over as it is, credential
        // and all, where `fetch` signs a session token from it.
        await expect(
          ctx.feedbackController.trustFeedback.run(
            { params: { projectId, feedbackId: filed.data.id } },
            {
              user: { ...owner, credential } as UserAccountToken,
            },
          ),
        ).rejects.toThrow(/signed-in session/);
      }
      expect((await rowOf(filed.data.id)).trustedAt).toBeFalsy();
    });

    it("refuses a reporter outside the team, and an item the team wrote", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const outsider = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const theirs = await submit(ctx, projectId, outsider, 1);
      const ours = await submit(ctx, projectId, owner, 2);

      await expect(
        trust(projectId, theirs.data.id, outsider),
      ).rejects.toMatchObject({ status: 403 });
      await expect(trust(projectId, ours.data.id, owner)).rejects.toMatchObject(
        { status: 400 },
      );
    });

    it("counts the pending items that wait for a confirmation", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const outsider = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const a = await submit(ctx, projectId, outsider, 1);
      await submit(ctx, projectId, outsider, 2);
      await submit(ctx, projectId, owner, 3);

      const count = () =>
        ctx.feedbackController.countFeedback.fetch(
          { params: { projectId }, query: { status: "pending" } },
          { user: owner },
        );
      expect((await count()).data).toEqual({ count: 3, awaitingTrust: 2 });
      await trust(projectId, a.data.id, owner);
      expect((await count()).data).toEqual({ count: 3, awaitingTrust: 1 });
    });

    it("gives a quest created from a trusted item its confirmation, no second one asked", async ({
      expect,
    }) => {
      const owner = await createTestUser(ctx);
      const outsider = await createTestUser(ctx);
      const projectId = await createProject(ctx, owner);
      const filed = await submit(ctx, projectId, outsider, 1);
      await trust(projectId, filed.data.id, owner);
      await ctx.feedbackController.acceptFeedback.fetch(
        { params: { projectId, feedbackId: filed.data.id } },
        { user: owner },
      );

      const created = await ctx.alepha
        .inject(QuestController)
        .createQuest.fetch(
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
      expect(quest.untrustedConfirmedAt).toBeTruthy();
      expect(quest.untrustedConfirmedBy).toBe(owner.id);
    });
  });
});
