import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { EpicController } from "../src/api/controllers/EpicController.ts";
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
  epicController: EpicController;
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
    epicController: alepha.inject(EpicController),
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

describe("ReleaseController.getReleaseChangelog", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    ctx.dt.reset();
    await ctx.alepha.stop();
  });

  const aRelease = async (user: TestUser, projectId: number, tag: string) =>
    (
      await ctx.releaseController.createRelease.fetch(
        { params: { projectId }, body: { tag } },
        { user },
      )
    ).data;

  const anEpic = async (user: TestUser, projectId: number, title: string) =>
    (
      await ctx.epicController.createEpic.fetch(
        { params: { projectId }, body: { title } },
        { user },
      )
    ).data;

  it("groups by epic first, then by area for the loose work", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await aRelease(user, project.id, "0.28.0");
    const epic = await anEpic(user, project.id, "The big feature");
    await ctx.epicController.updateEpic.fetch(
      { params: { id: epic.id }, body: { releaseId: release.id } },
      { user },
    );

    const inEpic = await completeQuest(ctx, user, project.id, {
      title: "Part of the feature",
      area: "orm",
      priority: "high",
    });
    await ctx.epicController.attachQuest.fetch(
      { params: { id: epic.id }, body: { questId: inEpic.id } },
      { user },
    );

    const loose = await completeQuest(ctx, user, project.id, {
      title: "A doc pass",
      area: "docs",
      priority: "low",
    });
    await attach(ctx, loose.id, release.id);

    const result = await ctx.releaseController.getReleaseChangelog.fetch(
      { params: { id: release.id } },
      { user },
    );

    // An epic is a headline, a loose quest is a line item.
    expect(result.data.groups.map((g) => [g.kind, g.name])).toEqual([
      ["epic", "The big feature"],
      ["area", "docs"],
    ]);
    expect(result.data.groups[0].ref).toBe(epic.number);
    expect(result.data.groups[0].quests[0].shortId).toBe(inEpic.shortId);
    expect(result.data.groups[1].quests[0].shortId).toBe(loose.shortId);
  });

  it("never lists a quest under both an epic and an area", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await aRelease(user, project.id, "0.28.0");
    const epic = await anEpic(user, project.id, "The big feature");
    await ctx.epicController.updateEpic.fetch(
      { params: { id: epic.id }, body: { releaseId: release.id } },
      { user },
    );

    // Attached to the release directly AND a member of one of its epics.
    const both = await completeQuest(ctx, user, project.id, {
      title: "Reachable twice",
      area: "orm",
      priority: "high",
    });
    await attach(ctx, both.id, release.id);
    await ctx.epicController.attachQuest.fetch(
      { params: { id: epic.id }, body: { questId: both.id } },
      { user },
    );

    const result = await ctx.releaseController.getReleaseChangelog.fetch(
      { params: { id: release.id } },
      { user },
    );

    expect(result.data.groups).toHaveLength(1);
    expect(result.data.groups[0].kind).toBe("epic");
    expect(result.data.stats.questCount).toBe(1);
  });

  it("agrees with the markdown on grouping and totals", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await aRelease(user, project.id, "0.28.0");

    const a = await completeQuest(ctx, user, project.id, {
      title: "Streaming multipart uploads",
      area: "server",
      priority: "high",
    });
    const b = await completeQuest(ctx, user, project.id, {
      title: "Router transition progress bar",
      area: "react",
      priority: "low",
    });
    await attach(ctx, a.id, release.id);
    await attach(ctx, b.id, release.id);

    const result = await ctx.releaseController.getReleaseChangelog.fetch(
      { params: { id: release.id } },
      { user },
    );

    for (const group of result.data.groups) {
      expect(result.data.markdown).toContain(`## ${group.name}`);
      for (const quest of group.quests) {
        expect(result.data.markdown).toContain(`- ${quest.title}`);
      }
    }

    const totalFromGroups = result.data.groups.reduce(
      (sum, group) => sum + group.questCount,
      0,
    );
    expect(totalFromGroups).toBe(result.data.stats.questCount);
  });

  it("freezes BOTH projections on a published release", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await aRelease(user, project.id, "0.28.0");

    const quest = await completeQuest(ctx, user, project.id, {
      title: "Original title",
      area: "orm",
      priority: "high",
    });
    await attach(ctx, quest.id, release.id);

    const published = await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.id }, body: {} },
      { user },
    );
    expect(published.data.changelog).toContain("Original title");
    expect(published.data.changelogGroups?.[0].quests[0].title).toBe(
      "Original title",
    );

    // The recorder froze the markdown and RECOMPUTED the rows, so an edit
    // after the close showed one title in the page and another in the `.md`.
    // Both are frozen now.
    await ctx.questController.updateQuestById.fetch(
      { params: { id: quest.id }, body: { completionMessage: "touched" } },
      { user },
    );

    const result = await ctx.releaseController.getReleaseChangelog.fetch(
      { params: { id: release.id } },
      { user },
    );
    expect(result.data.markdown).toBe(published.data.changelog);
    expect(result.data.groups[0].quests[0].title).toBe("Original title");
  });

  it("goes back to live on a reopened release", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await aRelease(user, project.id, "0.28.0");

    await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.id }, body: {} },
      { user },
    );
    await ctx.releaseController.reopenRelease.fetch(
      { params: { id: release.id } },
      { user },
    );

    const late = await completeQuest(ctx, user, project.id, {
      title: "Added after reopening",
      area: "orm",
      priority: "high",
    });
    await attach(ctx, late.id, release.id);

    const result = await ctx.releaseController.getReleaseChangelog.fetch(
      { params: { id: release.id } },
      { user },
    );

    // Reopening clears the snapshot, so the changelog is computed again -
    // otherwise the release would keep a frozen copy nothing agrees with.
    expect(result.data.groups[0].quests[0].title).toBe("Added after reopening");
  });

  it("returns no groups when nothing attached has shipped", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await aRelease(user, project.id, "0.28.0");

    const open = await ctx.questController.createQuest.fetch(
      {
        body: {
          projectId: project.id,
          title: "Still in flight",
          area: "orm",
          priority: "high",
        },
      },
      { user },
    );
    await attach(ctx, open.data.id, release.id);

    const result = await ctx.releaseController.getReleaseChangelog.fetch(
      { params: { id: release.id } },
      { user },
    );

    // A changelog reports what SHIPPED. Planned work is in the release
    // without being in its changelog; the progress rollup counts both sides.
    expect(result.data.groups).toEqual([]);
    expect(result.data.stats.questCount).toBe(0);
  });

  it("ignores a completed quest that was never attached", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await aRelease(user, project.id, "0.28.0");

    const attached = await completeQuest(ctx, user, project.id, {
      title: "Put in the release",
      area: "orm",
      priority: "high",
    });
    await attach(ctx, attached.id, release.id);

    // Same project, completed at the same moment, attached to nothing. The
    // old window would have swept this in; membership is an assignment now.
    await completeQuest(ctx, user, project.id, {
      title: "Left out of the release",
      area: "orm",
      priority: "high",
    });

    const result = await ctx.releaseController.getReleaseChangelog.fetch(
      { params: { id: release.id } },
      { user },
    );

    const titles = result.data.groups.flatMap((group) =>
      group.quests.map((quest) => quest.title),
    );
    expect(titles).toEqual(["Put in the release"]);
  });
});
