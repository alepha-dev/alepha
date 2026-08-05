import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm, RepositoryProvider } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { FeedbackController } from "../src/api/controllers/FeedbackController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { members } from "../src/api/entities/members.ts";
import { LoreApi } from "../src/api/index.ts";
import { FeedbackRateLimiter } from "../src/api/services/FeedbackRateLimiter.ts";

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
  alepha.with(LoreApi);

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
    { body: { title: "Rate Limit Test" } },
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

describe("feedback rate limit", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("rate-limits a non-member past the daily cap with a clean 429 message", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const outsider = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    const limit = ctx.alepha
      .inject(FeedbackRateLimiter)
      .options().maxFeedbackPerUserPerDay;

    // Up to the cap is allowed.
    for (let i = 0; i < limit; i++) {
      await submit(ctx, projectId, outsider, i);
    }

    // One past the cap: a clean 429 (not an opaque 500), with the real message.
    const error = await submit(ctx, projectId, outsider, limit).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(429);
    expect((error as HttpError).message).toMatch(/rate limit/i);
  });

  it("exempts the project owner from the feedback rate limit", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    const limit = ctx.alepha
      .inject(FeedbackRateLimiter)
      .options().maxFeedbackPerUserPerDay;

    // Well beyond the cap — every submit must succeed for the owner.
    for (let i = 0; i < limit + 2; i++) {
      const res = await submit(ctx, projectId, owner, i);
      expect(res.data.id).toBeGreaterThan(0);
    }
  });

  it("exempts a joined member (character row) from the feedback rate limit", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const member = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    // Make `member` a real project member (non-owner membership row).
    const membersRepo = ctx.alepha
      .inject(RepositoryProvider)
      .getRepository(members);
    await membersRepo.create({
      userId: member.id,
      projectId,
      owner: false,
    });

    const limit = ctx.alepha
      .inject(FeedbackRateLimiter)
      .options().maxFeedbackPerUserPerDay;

    for (let i = 0; i < limit + 2; i++) {
      const res = await submit(ctx, projectId, member, i);
      expect(res.data.id).toBeGreaterThan(0);
    }
  });
});
