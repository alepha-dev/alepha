import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { ProjectPromptController } from "../src/api/controllers/ProjectPromptController.ts";
import { LoreApi } from "../src/api/index.ts";
import { ProjectSecurityService } from "../src/api/services/ProjectSecurityService.ts";

/**
 * The storage half of the agent prompts: one row per customised kind,
 * absence meaning the built-in default.
 *
 * Runs against a real database rather than a stub, because most of what is
 * being asserted here is the database's own work: the unique index that
 * makes "one row per kind" true, the cascade on the project, and the bounds
 * on the column.
 */

const adminUser = {
  id: crypto.randomUUID(),
  roles: ["admin"],
  realm: "default",
};

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  promptController: ProjectPromptController;
  security: ProjectSecurityService;
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
    promptController: alepha.inject(ProjectPromptController),
    security: alepha.inject(ProjectSecurityService),
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
  owner: { id: string; roles: string[] },
): Promise<number> => {
  const created = await ctx.projectController.createProject.fetch(
    { body: { title: `Prompts ${crypto.randomUUID().slice(0, 8)}` } },
    { user: owner },
  );
  return created.data.id;
};

/**
 * A member who is not the owner. Written straight into `members` rather than
 * driven through the invitation flow: the read-versus-write split is what is
 * under test, and an invitation round-trip would only add ways for this
 * setup to fail for unrelated reasons.
 */
const addMember = async (
  ctx: TestContext,
  projectId: number,
  userId: string,
): Promise<void> => {
  await ctx.security.members.create({ projectId, userId, owner: false });
};

describe("Project agent prompts", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("answers nothing for a project that has customised nothing", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    const response = await ctx.promptController.getProjectPrompts.fetch(
      { params: { projectId } },
      { user: owner },
    );

    // Absence is the default, so an untouched project is an empty list and
    // not four rows carrying the shipped text.
    expect(response.data).toEqual([]);
  });

  it("upserts: writing the same kind twice leaves one row", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    await ctx.promptController.setProjectPrompt.fetch(
      {
        params: { projectId, kind: "questWork" },
        body: { template: "first" },
      },
      { user: owner },
    );
    await ctx.promptController.setProjectPrompt.fetch(
      {
        params: { projectId, kind: "questWork" },
        body: { template: "second" },
      },
      { user: owner },
    );

    const response = await ctx.promptController.getProjectPrompts.fetch(
      { params: { projectId } },
      { user: owner },
    );
    expect(response.data).toEqual([{ kind: "questWork", template: "second" }]);
  });

  it("keeps the four kinds apart", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    for (const kind of [
      "epicReview",
      "epicActivate",
      "questWork",
      "feedbackWork",
    ] as const) {
      await ctx.promptController.setProjectPrompt.fetch(
        { params: { projectId, kind }, body: { template: `t-${kind}` } },
        { user: owner },
      );
    }

    const response = await ctx.promptController.getProjectPrompts.fetch(
      { params: { projectId } },
      { user: owner },
    );
    expect(
      response.data.map((it) => it.kind).sort((a, b) => a.localeCompare(b)),
    ).toEqual(["epicActivate", "epicReview", "feedbackWork", "questWork"]);
  });

  it("resets by deleting the row, not by writing a default into it", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    await ctx.promptController.setProjectPrompt.fetch(
      {
        params: { projectId, kind: "epicReview" },
        body: { template: "mine" },
      },
      { user: owner },
    );
    await ctx.promptController.resetProjectPrompt.fetch(
      { params: { projectId, kind: "epicReview" } },
      { user: owner },
    );

    const response = await ctx.promptController.getProjectPrompts.fetch(
      { params: { projectId } },
      { user: owner },
    );
    // Empty, not a row holding today's shipped text: that is what lets a
    // reset project keep following the default as it improves.
    expect(response.data).toEqual([]);
  });

  it("treats resetting a kind that was never customised as a success", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    const response = await ctx.promptController.resetProjectPrompt.fetch(
      { params: { projectId, kind: "feedbackWork" } },
      { user: owner },
    );
    // The caller asked for a state that already holds. A 404 here would make
    // a Reset button that is safe to click twice into one that is not.
    expect(response.data).toEqual({ kind: "feedbackWork" });
  });

  it("lets a member read the templates", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const member = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    await addMember(ctx, projectId, member.id);

    await ctx.promptController.setProjectPrompt.fetch(
      {
        params: { projectId, kind: "questWork" },
        body: { template: "shared" },
      },
      { user: owner },
    );

    const response = await ctx.promptController.getProjectPrompts.fetch(
      { params: { projectId } },
      { user: member },
    );
    expect(response.data).toEqual([{ kind: "questWork", template: "shared" }]);
  });

  it("refuses a member writing a template", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const member = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    await addMember(ctx, projectId, member.id);

    await expect(
      ctx.promptController.setProjectPrompt.fetch(
        {
          params: { projectId, kind: "questWork" },
          body: { template: "not yours" },
        },
        { user: member },
      ),
      // The OWNER gate, named: a bare `.toThrow()` would also pass if the
      // action broke for an unrelated reason.
    ).rejects.toThrow(/Only the project owner/);
  });

  it("refuses a member resetting a template", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const member = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);
    await addMember(ctx, projectId, member.id);

    await expect(
      ctx.promptController.resetProjectPrompt.fetch(
        { params: { projectId, kind: "questWork" } },
        { user: member },
      ),
    ).rejects.toThrow(/Only the project owner/);
  });

  it("refuses a non-member reading the templates", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const stranger = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    await expect(
      ctx.promptController.getProjectPrompts.fetch(
        { params: { projectId } },
        { user: stranger },
      ),
    ).rejects.toThrow();
  });

  it("refuses an unknown kind rather than storing it", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    await expect(
      ctx.promptController.setProjectPrompt.fetch(
        {
          // @ts-expect-error the enum is closed, and that is what is under test
          params: { projectId, kind: "epicRevue" },
          body: { template: "typo" },
        },
        { user: owner },
      ),
    ).rejects.toThrow();

    const response = await ctx.promptController.getProjectPrompts.fetch(
      { params: { projectId } },
      { user: owner },
    );
    expect(response.data).toEqual([]);
  });

  it("refuses an empty template", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    await expect(
      ctx.promptController.setProjectPrompt.fetch(
        { params: { projectId, kind: "questWork" }, body: { template: "" } },
        { user: owner },
      ),
    ).rejects.toThrow();
  });

  /**
   * ⚠️ The bound matters because the column is `z.string()` and not
   * `z.text()`. A row past the cap would decode fine on the way in and fail
   * on the way out, which on a response schema is a blank screen rather than
   * a truncated field.
   */
  it("accepts 20 000 characters and refuses 20 001", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const projectId = await createProject(ctx, owner);

    const atCap = "x".repeat(20_000);
    const written = await ctx.promptController.setProjectPrompt.fetch(
      {
        params: { projectId, kind: "epicActivate" },
        body: { template: atCap },
      },
      { user: owner },
    );
    expect(written.data.template.length).toBe(20_000);

    // And it survives the read path, which is the half a cap on the response
    // schema would break silently.
    const read = await ctx.promptController.getProjectPrompts.fetch(
      { params: { projectId } },
      { user: owner },
    );
    expect(read.data[0]?.template.length).toBe(20_000);

    await expect(
      ctx.promptController.setProjectPrompt.fetch(
        {
          params: { projectId, kind: "epicActivate" },
          body: { template: "x".repeat(20_001) },
        },
        { user: owner },
      ),
    ).rejects.toThrow();
  });

  it("keeps one project's templates out of another's", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const first = await createProject(ctx, owner);
    const second = await createProject(ctx, owner);

    await ctx.promptController.setProjectPrompt.fetch(
      {
        params: { projectId: first, kind: "questWork" },
        body: { template: "a" },
      },
      { user: owner },
    );

    const response = await ctx.promptController.getProjectPrompts.fetch(
      { params: { projectId: second } },
      { user: owner },
    );
    expect(response.data).toEqual([]);
  });
});
