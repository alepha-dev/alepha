import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { FeedbackController } from "../src/api/controllers/FeedbackController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
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
  fakeProvider: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      SERVER_HOST: "127.0.0.1",
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

type TestUser = { id: string; roles: string[] };

const createTestUser = async (ctx: TestContext): Promise<TestUser> => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

const createProject = async (
  ctx: TestContext,
  user: TestUser,
): Promise<number> => {
  const created = await ctx.projectController.createProject.fetch(
    { body: { title: "Feedback", features: { feedback: true } } },
    { user },
  );
  return created.data.id;
};

const submit = async (
  ctx: TestContext,
  projectId: number,
  user: TestUser,
  body: { title: string; description: string; tags?: string[] },
): Promise<number> => {
  const res = await ctx.feedbackController.submitFeedback.fetch(
    { params: { projectId }, body },
    { user },
  );
  return res.data.id;
};

describe("FeedbackController — reporter-scoped /me endpoints", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("lists only the caller's own feedback", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const reporter = await createTestUser(ctx);
    const other = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    await submit(ctx, projectId, reporter, {
      title: "Mine 1",
      description: "first",
    });
    await submit(ctx, projectId, reporter, {
      title: "Mine 2",
      description: "second",
    });
    await submit(ctx, projectId, other, {
      title: "Theirs",
      description: "not mine",
    });

    const res = await ctx.feedbackController.listMyFeedback.fetch(
      { query: {} },
      { user: reporter },
    );

    expect(res.data.content.length).toBe(2);
    const titles = res.data.content.map((p) => p.title).sort();
    expect(titles).toEqual(["Mine 1", "Mine 2"]);
    // Each row carries its owning project.
    expect(res.data.content[0].project.id).toBe(projectId);
  });

  it("filters the list by status", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const reporter = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    await submit(ctx, projectId, reporter, { title: "P", description: "d" });

    const pending = await ctx.feedbackController.listMyFeedback.fetch(
      { query: { status: "pending" } },
      { user: reporter },
    );
    expect(pending.data.content.length).toBe(1);

    const accepted = await ctx.feedbackController.listMyFeedback.fetch(
      { query: { status: "accepted" } },
      { user: reporter },
    );
    expect(accepted.data.content.length).toBe(0);
  });

  it("edits a pending feedback (title, description, tags)", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const reporter = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const id = await submit(ctx, projectId, reporter, {
      title: "Old",
      description: "old body",
    });

    const updated = await ctx.feedbackController.updateMyFeedback.fetch(
      {
        params: { feedbackId: id },
        body: { title: "New", description: "new body", tags: ["bug"] },
      },
      { user: reporter },
    );

    expect(updated.data.title).toBe("New");
    expect(updated.data.description).toBe("new body");
    expect(updated.data.tags).toEqual(["bug"]);
  });

  it("rejects editing a feedback item the caller does not own (404)", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const reporter = await createTestUser(ctx);
    const intruder = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const id = await submit(ctx, projectId, reporter, {
      title: "Mine",
      description: "d",
    });

    await expect(
      ctx.feedbackController.updateMyFeedback.fetch(
        {
          params: { feedbackId: id },
          body: { title: "hijack", description: "hijack" },
        },
        { user: intruder },
      ),
    ).rejects.toThrow();
  });

  it("soft-deletes a pending feedback so it leaves the list", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const reporter = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    const id = await submit(ctx, projectId, reporter, {
      title: "Bye",
      description: "d",
    });

    await ctx.feedbackController.deleteMyFeedback.fetch(
      { params: { feedbackId: id } },
      { user: reporter },
    );

    const res = await ctx.feedbackController.listMyFeedback.fetch(
      { query: {} },
      { user: reporter },
    );
    expect(res.data.content.length).toBe(0);
  });

  it("lists the distinct projects the caller has feedback in", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const reporter = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    await submit(ctx, projectId, reporter, { title: "A", description: "d" });
    await submit(ctx, projectId, reporter, { title: "B", description: "d" });

    const res = await ctx.feedbackController.listMyFeedbackProjects.fetch(
      {},
      { user: reporter },
    );
    expect(res.data.items.length).toBe(1);
    expect(res.data.items[0].id).toBe(projectId);
  });
});
