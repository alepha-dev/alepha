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

describe("ReleaseController.getReleaseChangelog", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    ctx.dt.reset();
    await ctx.alepha.stop();
  });

  it("returns structured areas alongside the markdown", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const release = await ctx.releaseController.createRelease.fetch(
      { params: { projectId: project.id }, body: { title: "0.1.0" } },
      { user },
    );

    const a = await completeQuest(ctx, user, project.id, {
      title: "Lateral joins on Postgres",
      area: "orm",
      priority: "high",
    });
    const b = await completeQuest(ctx, user, project.id, {
      title: "Typed repository count",
      area: "orm",
      priority: "medium",
    });
    const c = await completeQuest(ctx, user, project.id, {
      title: "Rate limiter for public actions",
      area: "server",
      priority: "low",
    });
    for (const quest of [a, b, c]) {
      await attach(ctx, quest.id, release.data.id);
    }

    const result = await ctx.releaseController.getReleaseChangelog.fetch(
      { params: { id: release.data.id } },
      { user },
    );

    expect(result.data.areas.map((z) => z.name)).toEqual(["orm", "server"]);

    const orm = result.data.areas[0];
    expect(orm.questCount).toBe(2);
    expect(orm.quests).toEqual([
      {
        shortId: a.shortId,
        title: "Lateral joins on Postgres",
        priority: "high",
      },
      {
        shortId: b.shortId,
        title: "Typed repository count",
        priority: "medium",
      },
    ]);

    const server = result.data.areas[1];
    expect(server.quests).toEqual([
      {
        shortId: c.shortId,
        title: "Rate limiter for public actions",
        priority: "low",
      },
    ]);
  });

  it("agrees with the markdown on grouping and totals", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const release = await ctx.releaseController.createRelease.fetch(
      { params: { projectId: project.id }, body: { title: "0.1.0" } },
      { user },
    );

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
    await attach(ctx, a.id, release.data.id);
    await attach(ctx, b.id, release.data.id);

    const result = await ctx.releaseController.getReleaseChangelog.fetch(
      { params: { id: release.data.id } },
      { user },
    );

    // Every area heading in the markdown has a matching structured area,
    // and each area's title list matches line for line.
    for (const area of result.data.areas) {
      expect(result.data.markdown).toContain(`## ${area.name}`);
      for (const quest of area.quests) {
        expect(result.data.markdown).toContain(`- ${quest.title}`);
      }
    }

    const totalFromAreas = result.data.areas.reduce(
      (sum, area) => sum + area.questCount,
      0,
    );
    expect(totalFromAreas).toBe(result.data.stats.questCount);
    expect(result.data.stats.areaCount).toBe(result.data.areas.length);
  });

  it("returns the frozen markdown snapshot for a closed release", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const release = await ctx.releaseController.createRelease.fetch(
      { params: { projectId: project.id }, body: { title: "0.1.0" } },
      { user },
    );

    const a = await completeQuest(ctx, user, project.id, {
      title: "Sequence counter per project",
      area: "orm",
      priority: "high",
    });
    await attach(ctx, a.id, release.data.id);

    const closed = await ctx.releaseController.closeRelease.fetch(
      { params: { id: release.data.id }, body: {} },
      { user },
    );
    expect(closed.data.changelog).toBeDefined();

    const result = await ctx.releaseController.getReleaseChangelog.fetch(
      { params: { id: release.data.id } },
      { user },
    );

    expect(result.data.markdown).toBe(closed.data.changelog);
    // Areas are recomputed rather than frozen — they still describe the same
    // attachments, so the closed release is not returned bare.
    expect(result.data.areas).toHaveLength(1);
    expect(result.data.areas[0].quests[0].title).toBe(
      "Sequence counter per project",
    );
  });

  it("returns no areas when nothing is attached", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const release = await ctx.releaseController.createRelease.fetch(
      { params: { projectId: project.id }, body: { title: "0.1.0" } },
      { user },
    );

    const result = await ctx.releaseController.getReleaseChangelog.fetch(
      { params: { id: release.data.id } },
      { user },
    );

    expect(result.data.areas).toEqual([]);
    expect(result.data.stats.questCount).toBe(0);
    expect(result.data.stats.areaCount).toBe(0);
  });

  it("ignores a completed quest that was never attached", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const release = await ctx.releaseController.createRelease.fetch(
      { params: { projectId: project.id }, body: { title: "0.1.0" } },
      { user },
    );

    const attached = await completeQuest(ctx, user, project.id, {
      title: "Put in the release",
      area: "orm",
      priority: "high",
    });
    await attach(ctx, attached.id, release.data.id);

    // Same project, completed at the same moment, attached to nothing. The
    // old window would have swept this in; membership is an assignment now.
    await completeQuest(ctx, user, project.id, {
      title: "Left out of the release",
      area: "orm",
      priority: "high",
    });

    const result = await ctx.releaseController.getReleaseChangelog.fetch(
      { params: { id: release.data.id } },
      { user },
    );

    const titles = result.data.areas.flatMap((area) =>
      area.quests.map((quest) => quest.title),
    );
    expect(titles).toEqual(["Put in the release"]);
  });

  it("ignores an attached quest that is not completed yet", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const release = await ctx.releaseController.createRelease.fetch(
      { params: { projectId: project.id }, body: { title: "0.1.0" } },
      { user },
    );

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
    await attach(ctx, open.data.id, release.data.id);

    const result = await ctx.releaseController.getReleaseChangelog.fetch(
      { params: { id: release.data.id } },
      { user },
    );

    // A changelog reports what shipped, so planned work is in the release
    // without being in its changelog. The progress rollup (#1555) is what
    // counts both sides.
    expect(result.data.areas).toEqual([]);
    expect(result.data.stats.questCount).toBe(0);
  });
});
