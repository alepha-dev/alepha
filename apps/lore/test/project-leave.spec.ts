import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

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

describe("ProjectController leaveProject", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("rejects the owner with 403", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Owned" } },
      { user: owner },
    );

    await expect(
      ctx.projectController.leaveProject.fetch(
        { params: { id: created.data.id } },
        { user: owner },
      ),
    ).rejects.toThrow(HttpError);
  });

  it("is a no-op when the user is not a member", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const stranger = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Stranger danger" } },
      { user: owner },
    );

    const result = await ctx.projectController.leaveProject.fetch(
      { params: { id: created.data.id } },
      { user: stranger },
    );

    expect(result.data.ok).toBe(true);
  });

  it("removes the membership so the project drops out of getMyProjects", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const member = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Leaving party" } },
      { user: owner },
    );

    // Direct repo insert — the standard membership path is through
    // invitations, which is more plumbing than this test needs. Reach into
    // the controller's repository to seed a non-owner character.
    const membersRepo = (ctx.projectController as any).members;
    await membersRepo.create({
      userId: member.id,
      projectId: created.data.id,
      owner: false,
    });

    // Sanity: project is visible to the member before leaving.
    const before = await ctx.projectController.getMyProjects.fetch(
      { query: { size: 50, sort: "-updatedAt" } },
      { user: member },
    );
    expect(before.data.some((c) => c.id === created.data.id)).toBe(true);

    await ctx.projectController.leaveProject.fetch(
      { params: { id: created.data.id } },
      { user: member },
    );

    const after = await ctx.projectController.getMyProjects.fetch(
      { query: { size: 50, sort: "-updatedAt" } },
      { user: member },
    );
    expect(after.data.some((c) => c.id === created.data.id)).toBe(false);
  });
});

/**
 * The mirror of `leaveProject`, and deliberately a separate action rather
 * than a `userId` parameter on it: leaving is something any member may do to
 * themselves, removing is something only the owner may do to somebody else.
 */
describe("ProjectController removeMember", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * An owner, a member, and the project they share. Membership goes in
   * through the repository for the reason the leave test gives: the standard
   * path is an invitation, which is more plumbing than these need.
   */
  const world = async () => {
    const owner = await createTestUser(ctx);
    const member = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: `Removal ${Math.random().toString(36).slice(2, 8)}` } },
      { user: owner },
    );
    const membersRepo = (ctx.projectController as any).members;
    await membersRepo.create({
      userId: member.id,
      projectId: created.data.id,
      owner: false,
    });
    return { owner, member, projectId: created.data.id };
  };

  const belongs = async (
    user: { id: string; roles: string[] },
    projectId: number,
  ) => {
    const page = await ctx.projectController.getMyProjects.fetch(
      { query: { size: 50, sort: "-updatedAt" } },
      { user },
    );
    return page.data.some((project) => project.id === projectId);
  };

  it("removes the membership", async ({ expect }) => {
    const { owner, member, projectId } = await world();
    expect(await belongs(member, projectId)).toBe(true);

    await ctx.projectController.removeMember.fetch(
      { params: { id: projectId, userId: member.id } },
      { user: owner },
    );

    expect(await belongs(member, projectId)).toBe(false);
  });

  it("refuses a member removing somebody else", async ({ expect }) => {
    const { member, projectId } = await world();
    const other = await createTestUser(ctx);

    await expect(
      ctx.projectController.removeMember.fetch(
        { params: { id: projectId, userId: other.id } },
        { user: member },
      ),
    ).rejects.toThrow(HttpError);
  });

  it("refuses removing the owner", async ({ expect }) => {
    // A project with no owner has nobody who can delete it, rename it, or
    // let anybody back in.
    const { owner, projectId } = await world();

    await expect(
      ctx.projectController.removeMember.fetch(
        { params: { id: projectId, userId: owner.id } },
        { user: owner },
      ),
    ).rejects.toThrow(HttpError);

    expect(await belongs(owner, projectId)).toBe(true);
  });

  it("is idempotent for somebody who is not a member", async ({ expect }) => {
    const { owner, projectId } = await world();
    const stranger = await createTestUser(ctx);

    const result = await ctx.projectController.removeMember.fetch(
      { params: { id: projectId, userId: stranger.id } },
      { user: owner },
    );

    expect(result.data.ok).toBe(true);
  });

  it("returns their unfinished quests to the pool and leaves the finished ones attributed", async ({
    expect,
  }) => {
    const { owner, member, projectId } = await world();
    const quests = ctx.alepha.inject(QuestController);

    const create = async (title: string) =>
      (
        await quests.createQuest.fetch(
          { body: { projectId, title, area: "orm", priority: "medium" } },
          { user: owner },
        )
      ).data;

    const inFlight = await create("Half done");
    const shipped = await create("All done");

    for (const quest of [inFlight, shipped]) {
      await quests.acceptQuest.fetch(
        { params: { id: quest.id } },
        {
          user: member,
        },
      );
    }
    await quests.completeQuest.fetch(
      { params: { id: shipped.id }, body: {} },
      { user: member },
    );

    await ctx.projectController.removeMember.fetch(
      { params: { id: projectId, userId: member.id } },
      { user: owner },
    );

    const read = async (id: number) =>
      (await quests.getQuestById.fetch({ params: { id } }, { user: owner }))
        .data;

    // Back to the pool, so somebody else can pick it up.
    expect((await read(inFlight.id)).acceptedBy).toBeUndefined();
    // `acceptedBy` on a finished quest is a record of who did it, not a
    // claim on it.
    expect((await read(shipped.id)).acceptedBy).toBe(member.id);
  });
});
