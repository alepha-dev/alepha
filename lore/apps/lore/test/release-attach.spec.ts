import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { EpicController } from "../src/api/controllers/EpicController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { ReleaseController } from "../src/api/controllers/ReleaseController.ts";
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
  releaseController: ReleaseController;
  questController: QuestController;
  epicController: EpicController;
  dt: DateTimeProvider;
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
    releaseController: alepha.inject(ReleaseController),
    questController: alepha.inject(QuestController),
    epicController: alepha.inject(EpicController),
    dt: alepha.inject(DateTimeProvider),
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

/**
 * A project's slug is derived from its title and is unique across the whole
 * instance, so a test needing two projects has to name them apart.
 */
const createTestProject = async (
  ctx: TestContext,
  user: TestUser,
  title = "Test Project",
): Promise<{ id: number }> => {
  const created = await ctx.projectController.createProject.fetch(
    { body: { title } },
    { user },
  );
  return { id: created.data.id };
};

describe("Attaching an epic to a release", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    ctx.dt.reset();
    await ctx.alepha.stop();
  });

  const anEpic = async (user: TestUser, projectId: number) =>
    await ctx.epicController.createEpic.fetch(
      { params: { projectId }, body: { title: "Lore Release" } },
      { user },
    );

  const aRelease = async (user: TestUser, projectId: number, tag: string) =>
    await ctx.releaseController.createRelease.fetch(
      { params: { projectId }, body: { tag } },
      { user },
    );

  it("attaches and detaches through updateEpic", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const epic = await anEpic(user, project.id);
    const release = await aRelease(user, project.id, "0.28.0");

    const attached = await ctx.epicController.updateEpic.fetch(
      { params: { id: epic.data.id }, body: { releaseId: release.data.id } },
      { user },
    );
    expect(attached.data.releaseId).toBe(release.data.id);

    const detached = await ctx.epicController.updateEpic.fetch(
      { params: { id: epic.data.id }, body: { releaseId: null } },
      { user },
    );
    expect(detached.data.releaseId).toBeUndefined();
  });

  it("leaves the attachment alone when releaseId is omitted", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const epic = await anEpic(user, project.id);
    const release = await aRelease(user, project.id, "0.28.0");

    await ctx.epicController.updateEpic.fetch(
      { params: { id: epic.data.id }, body: { releaseId: release.data.id } },
      { user },
    );
    // An absent key means "leave alone"; only an explicit `null` detaches.
    const renamed = await ctx.epicController.updateEpic.fetch(
      { params: { id: epic.data.id }, body: { title: "Renamed epic" } },
      { user },
    );
    expect(renamed.data.releaseId).toBe(release.data.id);
  });

  it("deleting a release orphans its epics and keeps their quests", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const epic = await anEpic(user, project.id);
    const release = await aRelease(user, project.id, "0.28.0");

    await ctx.epicController.updateEpic.fetch(
      { params: { id: epic.data.id }, body: { releaseId: release.data.id } },
      { user },
    );
    const quest = await ctx.questController.createQuest.fetch(
      {
        body: {
          projectId: project.id,
          title: "Inside the epic",
          area: "orm",
          priority: "high",
        },
      },
      { user },
    );
    // `questCreateSchema` carries no `epicId`: a quest joins an epic through
    // this action, not at creation.
    await ctx.epicController.attachQuest.fetch(
      { params: { id: epic.data.id }, body: { questId: quest.data.id } },
      { user },
    );

    await ctx.releaseController.deleteRelease.fetch(
      { params: { id: release.data.id } },
      { user },
    );

    // SET NULL, never CASCADE. The epic survives with no release, and its
    // quests are untouched: nothing about them ever referenced the release.
    const survived = await ctx.epicController.getEpicByNumber.fetch(
      { params: { projectId: project.id, number: epic.data.number } },
      { user },
    );
    expect(survived.data.releaseId).toBeUndefined();
    expect(survived.data.title).toBe("Lore Release");

    const stillThere = await ctx.questController.getQuestById.fetch(
      { params: { id: quest.data.id } },
      { user },
    );
    expect(stillThere.data.epicId).toBe(epic.data.id);
  });

  it("refuses attaching to a published release", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const epic = await anEpic(user, project.id);
    const release = await aRelease(user, project.id, "0.28.0");
    await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.data.id }, body: {} },
      { user },
    );

    await expect(
      ctx.epicController.updateEpic.fetch(
        { params: { id: epic.data.id }, body: { releaseId: release.data.id } },
        { user },
      ),
    ).rejects.toThrowError(/published/i);
  });

  it("refuses detaching from a published release", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const epic = await anEpic(user, project.id);
    const release = await aRelease(user, project.id, "0.28.0");

    await ctx.epicController.updateEpic.fetch(
      { params: { id: epic.data.id }, body: { releaseId: release.data.id } },
      { user },
    );
    await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.data.id }, body: {} },
      { user },
    );

    // Both directions, and for the same reason: what 0.28.0 shipped is its
    // record, and detaching would quietly edit it.
    await expect(
      ctx.epicController.updateEpic.fetch(
        { params: { id: epic.data.id }, body: { releaseId: null } },
        { user },
      ),
    ).rejects.toThrowError(/published/i);
  });

  it("allows a no-op update on an epic in a published release", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const epic = await anEpic(user, project.id);
    const release = await aRelease(user, project.id, "0.28.0");

    await ctx.epicController.updateEpic.fetch(
      { params: { id: epic.data.id }, body: { releaseId: release.data.id } },
      { user },
    );
    await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.data.id }, body: {} },
      { user },
    );

    // Resending the SAME releaseId changes nothing about what shipped, so
    // renaming an epic that already shipped must not be refused.
    const renamed = await ctx.epicController.updateEpic.fetch(
      {
        params: { id: epic.data.id },
        body: { title: "Renamed after shipping", releaseId: release.data.id },
      },
      { user },
    );
    expect(renamed.data.title).toBe("Renamed after shipping");
  });

  it("refuses a release from another project", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const mine = await createTestProject(ctx, user, "Mine");
    const theirs = await createTestProject(ctx, user, "Theirs");
    const epic = await anEpic(user, mine.id);
    const foreign = await aRelease(user, theirs.id, "0.28.0");

    await expect(
      ctx.epicController.updateEpic.fetch(
        { params: { id: epic.data.id }, body: { releaseId: foreign.data.id } },
        { user },
      ),
    ).rejects.toThrowError(/not found/i);
  });
});
