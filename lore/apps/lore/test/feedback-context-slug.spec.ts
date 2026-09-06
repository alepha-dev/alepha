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

/**
 * The feedback request page is the one project surface that lives OUTSIDE the
 * project route layout — it has to stay reachable without membership, so it
 * has no `currentProjectAtom` to read an id from. `feedbackContext` is
 * therefore the only endpoint that takes a slug and hands back the integer id
 * the submit and attachment-upload calls still use.
 */
describe("feedbackContext by slug", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const createProject = async (
    user: { id: string; roles: string[] },
    title: string,
    feedbackOn: boolean,
  ) => {
    const created = await ctx.projectController.createProject.fetch(
      {
        body: {
          title,
          capabilities: feedbackOn ? [{ key: "support" as const }] : [],
        },
      },
      { user },
    );
    return created.data;
  };

  it("resolves the project and returns its id", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createProject(user, "Hello World", true);

    const res = await ctx.feedbackController.feedbackContext.fetch(
      { params: { slug: "hello-world" } },
      { user },
    );

    expect(res.data.projectId).toBe(project.id);
    expect(res.data.title).toBe("Hello World");
  });

  it("answers a non-member, since anyone may submit feedback", async ({
    expect,
  }) => {
    // The whole point of this endpoint: feedback is the one project surface
    // gated on `features.feedback` rather than on membership.
    const owner = await createTestUser(ctx);
    const stranger = await createTestUser(ctx);
    await createProject(owner, "Hello World", true);

    const res = await ctx.feedbackController.feedbackContext.fetch(
      { params: { slug: "hello-world" } },
      { user: stranger },
    );

    expect(res.data.title).toBe("Hello World");
  });

  it("404s on an unknown slug", async ({ expect }) => {
    const user = await createTestUser(ctx);
    await expect(
      ctx.feedbackController.feedbackContext.fetch(
        { params: { slug: "nope" } },
        { user },
      ),
    ).rejects.toThrow(HttpError);
  });

  it("refuses a project with the feedback module off", async ({ expect }) => {
    const user = await createTestUser(ctx);
    await createProject(user, "Quiet Place", false);
    await expect(
      ctx.feedbackController.feedbackContext.fetch(
        { params: { slug: "quiet-place" } },
        { user },
      ),
    ).rejects.toThrow(HttpError);
  });

  it("does not resolve a renamed project by its old slug", async ({
    expect,
  }) => {
    // The rename frees the old slug — the same hard break the settings page
    // warns about, and the reason an external "report a bug" link built from
    // the old URL stops working.
    const user = await createTestUser(ctx);
    const project = await createProject(user, "Hello World", true);

    await ctx.projectController.updateProjectById.fetch(
      { params: { id: project.id }, body: { title: "Elf - Summer" } },
      { user },
    );

    await expect(
      ctx.feedbackController.feedbackContext.fetch(
        { params: { slug: "hello-world" } },
        { user },
      ),
    ).rejects.toThrow(HttpError);

    const res = await ctx.feedbackController.feedbackContext.fetch(
      { params: { slug: "elf-summer" } },
      { user },
    );
    expect(res.data.projectId).toBe(project.id);
  });
});
