import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
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
import { releases } from "../src/api/entities/releases.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * Direct row access, so a release can be published WITHOUT going through
 * `publishRelease` - which clears `defaultSince` and would therefore hide the
 * very case the open-default guard exists for. The window is small and real:
 * D1 has no transaction, so a concurrent publish can leave a row carrying
 * both `releasedAt` and `defaultSince` for as long as it takes the next
 * completion to read it.
 */
class Probe {
  releases = $repository(releases);
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
 * A project title is globally unique (it derives the slug) and capped at 24
 * characters, so every project in this file gets a short random one.
 */
const createTestProject = async (
  ctx: TestContext,
  user: TestUser,
  title = `P ${crypto.randomUUID().slice(0, 8)}`,
): Promise<{ id: number }> => {
  const created = await ctx.projectController.createProject.fetch(
    { body: { title } },
    { user },
  );
  return { id: created.data.id };
};

const createRelease = async (
  ctx: TestContext,
  user: TestUser,
  projectId: number,
  tag: string,
): Promise<{ id: number; tag?: string }> => {
  const created = await ctx.releaseController.createRelease.fetch(
    { params: { projectId }, body: { tag } },
    { user },
  );
  return { id: created.data.id, tag: created.data.tag };
};

const setDefault = async (
  ctx: TestContext,
  user: TestUser,
  projectId: number,
  releaseId: number | null,
) =>
  (
    await ctx.releaseController.setDefaultRelease.fetch(
      { params: { projectId }, body: { releaseId } },
      { user },
    )
  ).data;

const createQuest = async (
  ctx: TestContext,
  user: TestUser,
  projectId: number,
  title = "A quest",
): Promise<{ id: number }> => {
  const created = await ctx.questController.createQuest.fetch(
    { body: { projectId, title, area: "General", priority: "medium" } },
    { user },
  );
  return { id: created.data.id };
};

const completeQuest = async (
  ctx: TestContext,
  user: TestUser,
  questId: number,
) => {
  await ctx.questController.acceptQuest.fetch(
    { params: { id: questId } },
    { user },
  );
  return (
    await ctx.questController.completeQuest.fetch(
      { params: { id: questId }, body: {} },
      { user },
    )
  ).data;
};

/**
 * The default release is at most one per project, and the swap that keeps it
 * that way is a single statement because D1 has no transaction to make a
 * clear-then-set pair atomic.
 */
describe("ReleaseController: the default release", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("creates every release with no default, and never picks one", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    await createRelease(ctx, user, project.id, "0.28.0");
    const releases = (
      await ctx.releaseController.getReleases.fetch(
        { params: { projectId: project.id } },
        { user },
      )
    ).data;

    // Creating the FIRST release does not make it the default. Pointing
    // intake somewhere is an explicit act.
    expect(releases.map((it) => it.defaultSince)).toEqual([undefined]);
  });

  it("moves the default so exactly one release ever carries it", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const first = await createRelease(ctx, user, project.id, "0.28.0");
    const second = await createRelease(ctx, user, project.id, "0.29.0");

    const afterFirst = await setDefault(ctx, user, project.id, first.id);
    expect(
      afterFirst.filter((it) => it.defaultSince).map((it) => it.tag),
    ).toEqual(["0.28.0"]);

    const afterSecond = await setDefault(ctx, user, project.id, second.id);
    // The whole point of the one-statement swap: the previous default is
    // cleared by the same write that sets the new one.
    expect(
      afterSecond.filter((it) => it.defaultSince).map((it) => it.tag),
    ).toEqual(["0.29.0"]);
  });

  it("clears the default when the release is omitted, and zero is a normal state", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await createRelease(ctx, user, project.id, "0.28.0");

    await setDefault(ctx, user, project.id, release.id);
    const cleared = await setDefault(ctx, user, project.id, null);

    expect(cleared.filter((it) => it.defaultSince)).toEqual([]);
  });

  it("refuses a published release with the reopen-it-first wording", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await createRelease(ctx, user, project.id, "0.28.0");

    await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.id }, body: {} },
      { user },
    );

    await expect(
      setDefault(ctx, user, project.id, release.id),
    ).rejects.toThrowError(/published\. Reopen it first\./);
  });

  it("refuses a release from another project as a 404", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const mine = await createTestProject(ctx, user);
    const theirs = await createTestProject(ctx, user);
    const elsewhere = await createRelease(ctx, user, theirs.id, "9.9.9");

    // Not a 403: the caller is not entitled to learn that an id exists in
    // another project. And never a silent no-op, which is what the
    // statement's own `WHERE project_id` would otherwise make it.
    await expect(
      setDefault(ctx, user, mine.id, elsewhere.id),
    ).rejects.toThrowError(/not found in this project/);
  });

  it("clears the default when the default release is published", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await createRelease(ctx, user, project.id, "0.28.0");

    await setDefault(ctx, user, project.id, release.id);
    await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.id }, body: {} },
      { user },
    );

    const releases = (
      await ctx.releaseController.getReleases.fetch(
        { params: { projectId: project.id } },
        { user },
      )
    ).data;
    // Without this, the next completion would try to attach to a published
    // release, `assertOpen` would refuse, and the quest could not close.
    expect(releases.filter((it) => it.defaultSince)).toEqual([]);
  });

  it("does not restore the default when a release is reopened", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await createRelease(ctx, user, project.id, "0.28.0");

    await setDefault(ctx, user, project.id, release.id);
    await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.id }, body: {} },
      { user },
    );
    await ctx.releaseController.reopenRelease.fetch(
      { params: { id: release.id } },
      { user },
    );

    const releases = (
      await ctx.releaseController.getReleases.fetch(
        { params: { projectId: project.id } },
        { user },
      )
    ).data;
    // Reopening says the record was wrong, not that intake resumes here.
    expect(releases.filter((it) => it.defaultSince)).toEqual([]);
  });
});

/**
 * The point of the epic: a finished quest nobody filed anywhere lands in the
 * project's default release. The condition is the EFFECTIVE release, which is
 * what keeps a published changelog honest.
 */
describe("QuestController: completing into the default release", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("puts a loose quest in the default release, and says so in its history", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await createRelease(ctx, user, project.id, "0.30.0");
    await setDefault(ctx, user, project.id, release.id);

    const quest = await createQuest(ctx, user, project.id);
    const completed = await completeQuest(ctx, user, quest.id);

    expect(completed.releaseId).toBe(release.id);
    // The move has to be VISIBLE: a quest turning up in a changelog nobody
    // put it in is the dishonesty the frozen changelog exists to prevent.
    // Same shape `updateQuestById` writes, release named by TAG.
    expect(
      completed.history
        .flatMap((entry) => entry.changes ?? [])
        .filter((change) => change.field === "release"),
    ).toEqual([{ field: "release", to: "0.30.0" }]);
  });

  it("leaves a quest that inherits its epic's release exactly where it is", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const target = await createRelease(ctx, user, project.id, "1.0.0");
    const fallback = await createRelease(ctx, user, project.id, "0.30.0");
    await setDefault(ctx, user, project.id, fallback.id);

    const epic = (
      await ctx.epicController.createEpic.fetch(
        { params: { projectId: project.id }, body: { title: "The epic" } },
        { user },
      )
    ).data;
    await ctx.epicController.updateEpic.fetch(
      { params: { id: epic.id }, body: { releaseId: target.id } },
      { user },
    );

    const quest = await createQuest(ctx, user, project.id);
    await ctx.epicController.attachQuest.fetch(
      { params: { id: epic.id }, body: { questId: quest.id } },
      { user },
    );
    await ctx.epicController.setEpicStatus.fetch(
      { params: { id: epic.id }, body: { status: "active" } },
      { user },
    );

    const completed = await completeQuest(ctx, user, quest.id);

    // Never `0.30.0`. `ReleaseCascadeService` wrote `1.0.0` onto the quest
    // when it joined the epic, so the completion finds an explicit release
    // and leaves it alone.
    expect(completed.releaseId).toBe(target.id);
  });

  it("leaves a quest alone when the epic inheritance is the only thing naming a release", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const target = await createRelease(ctx, user, project.id, "1.0.0");
    const fallback = await createRelease(ctx, user, project.id, "0.30.0");

    const epic = (
      await ctx.epicController.createEpic.fetch(
        { params: { projectId: project.id }, body: { title: "The epic" } },
        { user },
      )
    ).data;
    const quest = await createQuest(ctx, user, project.id);
    await ctx.epicController.attachQuest.fetch(
      { params: { id: epic.id }, body: { questId: quest.id } },
      { user },
    );
    // The epic gains its release AFTER the quest joined, and the quest is
    // detached from it by hand so it holds a null `releaseId` inside an epic
    // that names one. That is the shape the cascade cannot produce any more
    // and rows written before it still have.
    await ctx.epicController.updateEpic.fetch(
      { params: { id: epic.id }, body: { releaseId: target.id } },
      { user },
    );
    await ctx.questController.updateQuestById.fetch(
      { params: { id: quest.id }, body: { releaseId: null } },
      { user },
    );
    await setDefault(ctx, user, project.id, fallback.id);
    await ctx.epicController.setEpicStatus.fetch(
      { params: { id: epic.id }, body: { status: "active" } },
      { user },
    );

    // The shape the test is about, asserted rather than assumed: without
    // this the case could pass for having no epic at all.
    const before = (
      await ctx.questController.getQuestById.fetch(
        { params: { id: quest.id } },
        { user },
      )
    ).data;
    expect(before.releaseId).toBeUndefined();
    expect(before.epicId).toBe(epic.id);

    const completed = await completeQuest(ctx, user, quest.id);

    // The null is what lets it inherit `1.0.0`. Writing `0.30.0` here would
    // silently move it out.
    expect(completed.releaseId).toBeUndefined();
  });

  it("completes with no release at all when the project has no default", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    await createRelease(ctx, user, project.id, "0.30.0");

    const quest = await createQuest(ctx, user, project.id);
    const completed = await completeQuest(ctx, user, quest.id);

    // Nothing is auto-activated: an open release is not an intake point
    // until somebody says so.
    expect(completed.releaseId).toBeUndefined();
  });

  it("still completes when the default was published from under it", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await createRelease(ctx, user, project.id, "0.30.0");
    await setDefault(ctx, user, project.id, release.id);
    // The race `publishRelease` itself cannot leave behind, written directly:
    // a row that is published AND still flagged default.
    await ctx.probe.releases.updateById(release.id, {
      releasedAt: new Date().toISOString(),
    });

    const quest = await createQuest(ctx, user, project.id);
    const completed = await completeQuest(ctx, user, quest.id);

    // Best effort, never fatal. Attaching to a published release would make
    // its frozen counts disagree with its contents; refusing the completion
    // over a planning convenience is worse than attaching nothing.
    expect(completed.completedAt).toBeTruthy();
    expect(completed.releaseId).toBeUndefined();
  });
});
