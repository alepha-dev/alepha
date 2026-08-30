import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { ReleaseController } from "../src/api/controllers/ReleaseController.ts";
import { quests } from "../src/api/entities/quests.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * Direct row access, so a quest can be attached to a release before the
 * attach endpoint exists (#1553). `quests.releaseId` is the membership the
 * changelog reads; nothing user-facing writes it yet.
 */
class Probe {
  quests = $repository(quests);
}

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
  dt: DateTimeProvider;
  fakeProvider: FakeProvider;
  probe: Probe;
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

  // Injected BEFORE start: the container locks once started, so a service
  // first asked for afterwards cannot be registered.
  const probe = alepha.inject(Probe);

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    releaseController: alepha.inject(ReleaseController),
    questController: alepha.inject(QuestController),
    dt: alepha.inject(DateTimeProvider),
    fakeProvider: alepha.inject(FakeProvider),
    probe,
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

const createTestProject = async (
  ctx: TestContext,
  user: TestUser,
): Promise<{ id: number }> => {
  const created = await ctx.projectController.createProject.fetch(
    { body: { title: "Test Project" } },
    { user },
  );
  return { id: created.data.id };
};

/**
 * Create a quest, accept it and complete it. Completing no longer puts a
 * quest anywhere: `attach` below is what makes it part of a release.
 */
const completeQuest = async (
  ctx: TestContext,
  user: TestUser,
  projectId: number,
  quest: {
    title: string;
    area: string;
    priority: "optional" | "low" | "medium" | "high";
  },
): Promise<{ id: number; shortId: number }> => {
  const created = await ctx.questController.createQuest.fetch(
    {
      body: {
        projectId,
        title: quest.title,
        area: quest.area,
        priority: quest.priority,
      },
    },
    { user },
  );
  await ctx.questController.acceptQuest.fetch(
    { params: { id: created.data.id } },
    { user },
  );
  await ctx.questController.completeQuest.fetch(
    { params: { id: created.data.id }, body: {} },
    { user },
  );
  return { id: created.data.id, shortId: created.data.shortId };
};

/**
 * Put a quest in a release. This is the whole change of model: it used to be
 * "was it completed between the release opening and closing", and it is now
 * "was it assigned".
 */
const attach = async (
  ctx: TestContext,
  questId: number,
  releaseId: number,
): Promise<void> => {
  await ctx.probe.quests.updateById(questId, { releaseId });
};

describe("ReleaseController: publishing is a one-way freeze", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    ctx.dt.reset();
    await ctx.alepha.stop();
  });

  it("defaults the title to the tag", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const release = await ctx.releaseController.createRelease.fetch(
      { params: { projectId: project.id }, body: { tag: "0.28.0" } },
      { user },
    );

    expect(release.data.tag).toBe("0.28.0");
    expect(release.data.title).toBe("0.28.0");
  });

  it("keeps a tag's case, unlike an app name", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const release = await ctx.releaseController.createRelease.fetch(
      { params: { projectId: project.id }, body: { tag: "V2-RC1" } },
      { user },
    );

    // Lowercasing would silently break the join to `artifacts.tag`, which CI
    // derives from a git tag byte for byte.
    expect(release.data.tag).toBe("V2-RC1");
  });

  it("refuses a tag that could not survive a URL segment", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    for (const tag of ["1.0.", "v1.0/beta", "a b", "-nope"]) {
      await expect(
        ctx.releaseController.createRelease.fetch(
          { params: { projectId: project.id }, body: { tag } },
          { user },
        ),
      ).rejects.toThrowError();
    }
  });

  it("accepts the tags people actually write", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    for (const tag of ["0.28.0", "v1.0.0-rc.1", "demo-1", "RC1", "1_0"]) {
      const release = await ctx.releaseController.createRelease.fetch(
        { params: { projectId: project.id }, body: { tag } },
        { user },
      );
      expect(release.data.tag).toBe(tag);
    }
  });

  it("opens several releases at once, which is the normal state", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    for (const tag of ["0.28.0", "1.0.0", "1.1.0"]) {
      await ctx.releaseController.createRelease.fetch(
        { params: { projectId: project.id }, body: { tag } },
        { user },
      );
    }

    const list = await ctx.releaseController.getReleases.fetch(
      { params: { projectId: project.id } },
      { user },
    );
    expect(list.data.filter((r) => !r.releasedAt)).toHaveLength(3);
  });

  it("stamps releasedAt, the changelog and the four counts", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const release = await ctx.releaseController.createRelease.fetch(
      { params: { projectId: project.id }, body: { tag: "0.28.0" } },
      { user },
    );

    const done = await completeQuest(ctx, user, project.id, {
      title: "Shipped",
      area: "orm",
      priority: "high",
    });
    await attach(ctx, done.id, release.data.id);

    const inFlight = await ctx.questController.createQuest.fetch(
      {
        body: {
          projectId: project.id,
          title: "Still going",
          area: "orm",
          priority: "high",
        },
      },
      { user },
    );
    await ctx.questController.acceptQuest.fetch(
      { params: { id: inFlight.data.id } },
      { user },
    );
    await attach(ctx, inFlight.data.id, release.data.id);

    const published = await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.data.id }, body: {} },
      { user },
    );

    expect(published.data.releasedAt).toBeDefined();
    expect(published.data.changelog).toContain("Shipped");
    expect({
      completed: published.data.completed,
      inProgress: published.data.inProgress,
      shelved: published.data.shelved,
      total: published.data.total,
    }).toEqual({ completed: 1, inProgress: 1, shelved: 0, total: 2 });
  });

  it("does NOT recompute the counts after publishing", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const release = await ctx.releaseController.createRelease.fetch(
      { params: { projectId: project.id }, body: { tag: "0.28.0" } },
      { user },
    );

    const late = await ctx.questController.createQuest.fetch(
      {
        body: {
          projectId: project.id,
          title: "Finished a month later",
          area: "orm",
          priority: "high",
        },
      },
      { user },
    );
    await attach(ctx, late.data.id, release.data.id);

    const published = await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.data.id }, body: {} },
      { user },
    );
    expect(published.data.completed).toBe(0);

    // The quest finishes AFTER the release shipped. What 0.28.0 shipped must
    // not change because of it - that is the whole reason the counts are
    // stamped rather than derived.
    await ctx.questController.acceptQuest.fetch(
      { params: { id: late.data.id } },
      { user },
    );
    await ctx.questController.completeQuest.fetch(
      { params: { id: late.data.id }, body: {} },
      { user },
    );

    const list = await ctx.releaseController.getReleases.fetch(
      { params: { projectId: project.id } },
      { user },
    );
    const row = list.data.find((r) => r.id === release.data.id)!;
    expect(row.completed).toBe(0);
    expect(row.changelog).toBe(published.data.changelog);
  });

  it("refuses updateRelease on a published release", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const release = await ctx.releaseController.createRelease.fetch(
      { params: { projectId: project.id }, body: { tag: "0.28.0" } },
      { user },
    );
    await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.data.id }, body: {} },
      { user },
    );

    await expect(
      ctx.releaseController.updateRelease.fetch(
        { params: { id: release.data.id }, body: { title: "Rewritten" } },
        { user },
      ),
    ).rejects.toThrowError(/published/i);
  });

  it("refuses publishing twice", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const release = await ctx.releaseController.createRelease.fetch(
      { params: { projectId: project.id }, body: { tag: "0.28.0" } },
      { user },
    );
    await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.data.id }, body: {} },
      { user },
    );

    await expect(
      ctx.releaseController.publishRelease.fetch(
        { params: { id: release.data.id }, body: {} },
        { user },
      ),
    ).rejects.toThrowError(/published/i);
  });

  it("reopens by clearing releasedAt, the changelog and the counts", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const release = await ctx.releaseController.createRelease.fetch(
      { params: { projectId: project.id }, body: { tag: "0.28.0" } },
      { user },
    );
    const done = await completeQuest(ctx, user, project.id, {
      title: "Shipped",
      area: "orm",
      priority: "high",
    });
    await attach(ctx, done.id, release.data.id);
    await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.data.id }, body: {} },
      { user },
    );

    const reopened = await ctx.releaseController.reopenRelease.fetch(
      { params: { id: release.data.id } },
      { user },
    );

    expect(reopened.data.releasedAt).toBeUndefined();
    expect(reopened.data.changelog).toBeUndefined();
    expect(reopened.data.completed).toBeUndefined();
    expect(reopened.data.total).toBeUndefined();

    // And the release is editable again. The number and the tag survived,
    // which is why reopening exists instead of delete-and-recreate.
    expect(reopened.data.tag).toBe("0.28.0");
    const updated = await ctx.releaseController.updateRelease.fetch(
      { params: { id: release.data.id }, body: { title: "Renamed" } },
      { user },
    );
    expect(updated.data.title).toBe("Renamed");
  });

  it("refuses reopening a release that is already open", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const release = await ctx.releaseController.createRelease.fetch(
      { params: { projectId: project.id }, body: { tag: "0.28.0" } },
      { user },
    );

    await expect(
      ctx.releaseController.reopenRelease.fetch(
        { params: { id: release.data.id } },
        { user },
      ),
    ).rejects.toThrowError(/already open/i);
  });

  it("refuses two releases sharing a tag in one project", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    await ctx.releaseController.createRelease.fetch(
      { params: { projectId: project.id }, body: { tag: "0.28.0" } },
      { user },
    );

    await expect(
      ctx.releaseController.createRelease.fetch(
        { params: { projectId: project.id }, body: { tag: "0.28.0" } },
        { user },
      ),
    ).rejects.toThrowError();
  });
});
