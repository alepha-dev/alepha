import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";
import type { RoadmapVisibility } from "../src/api/schemas/roadmapVisibilitySchema.ts";
import { ProjectSecurityService } from "../src/api/services/ProjectSecurityService.ts";

/**
 * The roadmap gate, which is the only rule in Lore that can answer "yes" to a
 * caller with no session.
 *
 * The rest of the project suite proves that membership is required
 * everywhere; nothing there would go red if this one method quietly started
 * saying yes to strangers. That is what these cases are for.
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

describe("roadmap visibility", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * Owner, project, and the visibility already set. Returns everything the
   * cases below branch on.
   */
  const project = async (visibility?: RoadmapVisibility) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Roadmap" } },
      { user: owner },
    );

    if (visibility) {
      await ctx.projectController.updateProjectById.fetch(
        {
          params: { id: created.data.id },
          body: { roadmapVisibility: visibility },
        },
        { user: owner },
      );
    }

    const row = await ctx.security.projects.getOne({
      where: { id: { eq: created.data.id } },
    });

    return { owner, row };
  };

  const member = async (projectId: number) => {
    const user = await createTestUser(ctx);
    await ctx.security.members.create({ userId: user.id, projectId });
    return user;
  };

  it("reads an unset column as off", async ({ expect }) => {
    const { row } = await project();

    expect(row.roadmapVisibility).toBeUndefined();
    expect(ctx.security.roadmapVisibilityOf(row)).toBe("off");
  });

  it("refuses everyone while off, the owner included", async ({ expect }) => {
    const { owner, row } = await project("off");
    const stranger = await createTestUser(ctx);

    expect(await ctx.security.isRoadmapVisible(row)).toBe(false);
    expect(await ctx.security.isRoadmapVisible(row, stranger)).toBe(false);
    // The owner too: `off` means the page does not exist, not "only mine".
    expect(await ctx.security.isRoadmapVisible(row, owner)).toBe(false);
  });

  it("requires membership while members", async ({ expect }) => {
    const { owner, row } = await project("members");
    const stranger = await createTestUser(ctx);
    const invited = await member(row.id);

    expect(await ctx.security.isRoadmapVisible(row)).toBe(false);
    expect(await ctx.security.isRoadmapVisible(row, stranger)).toBe(false);
    expect(await ctx.security.isRoadmapVisible(row, invited)).toBe(true);
    expect(await ctx.security.isRoadmapVisible(row, owner)).toBe(true);
  });

  it("allows an anonymous caller while public", async ({ expect }) => {
    const { row } = await project("public");
    const stranger = await createTestUser(ctx);

    // No user at all: the one place in the app where that is a yes.
    expect(await ctx.security.isRoadmapVisible(row)).toBe(true);
    expect(await ctx.security.isRoadmapVisible(row, stranger)).toBe(true);
  });

  it("clears the column back to off when the owner sends null", async ({
    expect,
  }) => {
    const { owner, row } = await project("public");

    const updated = await ctx.projectController.updateProjectById.fetch(
      { params: { id: row.id }, body: { roadmapVisibility: null } },
      { user: owner },
    );

    expect(updated.data.roadmapVisibility).toBeUndefined();
  });

  it("refuses a non-owner flipping the switch", async ({ expect }) => {
    const { row } = await project();
    const invited = await member(row.id);

    // Member-gated everywhere else in the app; this is project configuration,
    // so it is owner-only like every other settings write.
    await expect(
      ctx.projectController.updateProjectById.fetch(
        { params: { id: row.id }, body: { roadmapVisibility: "public" } },
        { user: invited },
      ),
    ).rejects.toThrow();
  });
});
