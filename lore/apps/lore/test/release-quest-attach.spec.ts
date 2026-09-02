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

/**
 * A quest in the project, with nothing attached to it.
 */
const aQuest = async (
  ctx: TestContext,
  user: TestUser,
  projectId: number,
  title: string,
  releaseId?: number,
): Promise<{ id: number; shortId: number }> => {
  const created = await ctx.questController.createQuest.fetch(
    {
      body: {
        projectId,
        title,
        area: "orm",
        priority: "high",
        ...(releaseId != null ? { releaseId } : {}),
      },
    },
    { user },
  );
  return { id: created.data.id, shortId: created.data.shortId };
};

describe("Attaching a quest to a release", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    ctx.dt.reset();
    await ctx.alepha.stop();
  });

  const aRelease = async (user: TestUser, projectId: number, tag: string) =>
    await ctx.releaseController.createRelease.fetch(
      { params: { projectId }, body: { tag } },
      { user },
    );

  it("attaches at creation", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await aRelease(user, project.id, "0.28.0");

    const quest = await aQuest(
      ctx,
      user,
      project.id,
      "A hotfix",
      release.data.id,
    );

    const read = await ctx.questController.getQuestById.fetch(
      { params: { id: quest.id } },
      { user },
    );
    expect(read.data.releaseId).toBe(release.data.id);
  });

  it("attaches and detaches through updateQuestById", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await aRelease(user, project.id, "0.28.0");
    const quest = await aQuest(ctx, user, project.id, "A doc pass");

    const attached = await ctx.questController.updateQuestById.fetch(
      { params: { id: quest.id }, body: { releaseId: release.data.id } },
      { user },
    );
    expect(attached.data.releaseId).toBe(release.data.id);

    const detached = await ctx.questController.updateQuestById.fetch(
      { params: { id: quest.id }, body: { releaseId: null } },
      { user },
    );
    expect(detached.data.releaseId).toBeUndefined();
  });

  it("refuses creating straight into a published release", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await aRelease(user, project.id, "0.28.0");
    await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.data.id }, body: {} },
      { user },
    );

    await expect(
      aQuest(ctx, user, project.id, "Too late", release.data.id),
    ).rejects.toThrowError(/published/i);
  });

  it("refuses attaching and detaching on a published release", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const shipped = await aRelease(user, project.id, "0.28.0");
    const inside = await aQuest(ctx, user, project.id, "Shipped in 0.28.0");
    const outside = await aQuest(ctx, user, project.id, "Not in it");

    await ctx.questController.updateQuestById.fetch(
      { params: { id: inside.id }, body: { releaseId: shipped.data.id } },
      { user },
    );
    await ctx.releaseController.publishRelease.fetch(
      { params: { id: shipped.data.id }, body: {} },
      { user },
    );

    await expect(
      ctx.questController.updateQuestById.fetch(
        { params: { id: outside.id }, body: { releaseId: shipped.data.id } },
        { user },
      ),
    ).rejects.toThrowError(/published/i);

    await expect(
      ctx.questController.updateQuestById.fetch(
        { params: { id: inside.id }, body: { releaseId: null } },
        { user },
      ),
    ).rejects.toThrowError(/published/i);
  });

  it("still allows editing a quest that shipped, release untouched", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await aRelease(user, project.id, "0.28.0");
    const quest = await aQuest(ctx, user, project.id, "Shipped");

    await ctx.questController.updateQuestById.fetch(
      { params: { id: quest.id }, body: { releaseId: release.data.id } },
      { user },
    );
    await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.data.id }, body: {} },
      { user },
    );

    // The quest is not frozen by its release, only its MEMBERSHIP is. An
    // edit that leaves `releaseId` alone must go through.
    const renamed = await ctx.questController.updateQuestById.fetch(
      { params: { id: quest.id }, body: { title: "Shipped, renamed" } },
      { user },
    );
    expect(renamed.data.title).toBe("Shipped, renamed");
    expect(renamed.data.releaseId).toBe(release.data.id);
  });

  it("refuses a release from another project", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const mine = await createTestProject(ctx, user, "Mine");
    const theirs = await createTestProject(ctx, user, "Theirs");
    const quest = await aQuest(ctx, user, mine.id, "Mine");
    const foreign = await aRelease(user, theirs.id, "0.28.0");

    await expect(
      ctx.questController.updateQuestById.fetch(
        { params: { id: quest.id }, body: { releaseId: foreign.data.id } },
        { user },
      ),
    ).rejects.toThrowError(/not found/i);
  });

  it("filters the quest list by release", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await aRelease(user, project.id, "0.28.0");

    await aQuest(ctx, user, project.id, "In the release", release.data.id);
    await aQuest(ctx, user, project.id, "Out of it");

    const page = await ctx.questController.getQuests.fetch(
      {
        params: { projectId: project.id },
        // A string, because `releaseId` takes a comma-separated LIST now
        // (`?releaseId=3,4`) and a query param is text on the wire either
        // way. See `getQuests`' schema.
        query: { releaseId: String(release.data.id) },
      },
      { user },
    );
    expect(page.data.content.map((q) => q.title)).toEqual(["In the release"]);
  });

  it("deleting a release detaches its quests and keeps them", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await aRelease(user, project.id, "0.28.0");
    const quest = await aQuest(
      ctx,
      user,
      project.id,
      "Survives",
      release.data.id,
    );

    await ctx.releaseController.deleteRelease.fetch(
      { params: { id: release.data.id } },
      { user },
    );

    const read = await ctx.questController.getQuestById.fetch(
      { params: { id: quest.id } },
      { user },
    );
    expect(read.data.releaseId).toBeUndefined();
    expect(read.data.title).toBe("Survives");
  });

  /**
   * A completed quest's BODY is frozen as an audit record of what was closed.
   * Its release is not part of that body: which release a finished quest
   * ships in is planning metadata, decided after completion at least as often
   * as before it, and a release holds quests by assignment rather than by
   * time window. The gate used to catch `releaseId` along with everything
   * else, so the rail's Release select opened and the choice was refused.
   */
  describe("on a completed quest", () => {
    const aCompletedQuest = async (
      user: TestUser,
      projectId: number,
      title: string,
    ) => {
      const quest = await aQuest(ctx, user, projectId, title);
      await ctx.questController.acceptQuest.fetch(
        { params: { id: quest.id } },
        { user },
      );
      await ctx.questController.completeQuest.fetch(
        { params: { id: quest.id }, body: {} },
        { user },
      );
      return quest;
    };

    it("attaches and detaches", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user, "Completed Attach");
      const release = await aRelease(user, project.id, "0.29.0");
      const quest = await aCompletedQuest(user, project.id, "Shipped");

      const attached = await ctx.questController.updateQuestById.fetch(
        { params: { id: quest.id }, body: { releaseId: release.data.id } },
        { user },
      );
      expect(attached.data.releaseId).toBe(release.data.id);
      expect(attached.data.completedAt).toBeDefined();

      const detached = await ctx.questController.updateQuestById.fetch(
        { params: { id: quest.id }, body: { releaseId: null } },
        { user },
      );
      expect(detached.data.releaseId).toBeUndefined();
    });

    it("keeps the rest of the body frozen", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user, "Completed Frozen");
      const quest = await aCompletedQuest(user, project.id, "Shipped");

      await expect(
        ctx.questController.updateQuestById.fetch(
          { params: { id: quest.id }, body: { title: "Rewritten" } },
          { user },
        ),
      ).rejects.toThrow(/completed quest/);

      const read = await ctx.questController.getQuestById.fetch(
        { params: { id: quest.id } },
        { user },
      );
      expect(read.data.title).toBe("Shipped");
    });

    it("still refuses a published release, in both directions", async ({
      expect,
    }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user, "Completed Published");
      const release = await aRelease(user, project.id, "0.29.0");
      const quest = await aCompletedQuest(user, project.id, "Shipped");

      await ctx.questController.updateQuestById.fetch(
        { params: { id: quest.id }, body: { releaseId: release.data.id } },
        { user },
      );
      await ctx.releaseController.publishRelease.fetch(
        { params: { id: release.data.id }, body: {} },
        { user },
      );

      // Detaching from a published release is the direction this quest makes
      // newly reachable, and the one that would rewrite what a release says
      // it shipped.
      await expect(
        ctx.questController.updateQuestById.fetch(
          { params: { id: quest.id }, body: { releaseId: null } },
          { user },
        ),
      ).rejects.toThrow(/published/);
    });

    it("records the change in the quest's history", async ({ expect }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user, "Completed History");
      const release = await aRelease(user, project.id, "0.29.0");
      const quest = await aCompletedQuest(user, project.id, "Shipped");

      const updated = await ctx.questController.updateQuestById.fetch(
        { params: { id: quest.id }, body: { releaseId: release.data.id } },
        { user },
      );

      // The history rides back on the update itself, the way
      // `quest-history-changes.spec.ts` reads it.
      const history = updated.data.history;
      const changes = history[history.length - 1]?.changes ?? [];
      expect(changes.map((change) => change.field)).toContain("release");
      expect(changes).toContainEqual({ field: "release", to: "0.29.0" });
    });

    it("still writes no history entry for a summary-only edit", async ({
      expect,
    }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user, "Completed Silent");
      const quest = await aCompletedQuest(user, project.id, "Shipped");

      const before = await ctx.questController.getQuestById.fetch(
        { params: { id: quest.id } },
        { user },
      );

      // An "updated" entry carrying no change is noise on a frozen quest,
      // which is why the entry used to be skipped outright. Recording the
      // release move must not bring the noise back with it.
      const after = await ctx.questController.updateQuestById.fetch(
        { params: { id: quest.id }, body: { completionMessage: "Done." } },
        { user },
      );

      expect(after.data.history.length).toBe(before.data.history.length);
      expect(after.data.completionMessage).toBe("Done.");
    });
  });
});
