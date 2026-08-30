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
import { ReleaseContentService } from "../src/api/services/ReleaseContentService.ts";

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
  contents: ReleaseContentService;
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
  const contents = alepha.inject(ReleaseContentService);

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    releaseController: alepha.inject(ReleaseController),
    questController: alepha.inject(QuestController),
    epicController: alepha.inject(EpicController),
    contents,
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

describe("ReleaseContentService.contentsOf", () => {
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

  const aQuest = async (
    user: TestUser,
    projectId: number,
    title: string,
    extra: { releaseId?: number } = {},
  ) =>
    (
      await ctx.questController.createQuest.fetch(
        {
          body: {
            projectId,
            title,
            area: "orm",
            priority: "high",
            ...extra,
          },
        },
        { user },
      )
    ).data;

  const attachEpicToRelease = async (
    user: TestUser,
    epicId: number,
    releaseId: number,
  ) =>
    await ctx.epicController.updateEpic.fetch(
      { params: { id: epicId }, body: { releaseId } },
      { user },
    );

  const attachQuestToEpic = async (
    user: TestUser,
    epicId: number,
    questId: number,
  ) =>
    await ctx.epicController.attachQuest.fetch(
      { params: { id: epicId }, body: { questId } },
      { user },
    );

  it("returns three empty arrays for an empty release", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await aRelease(user, project.id, "0.28.0");

    const result = await ctx.contents.contentsOf(release);

    expect(result).toEqual({
      epics: [],
      quests: [],
      looseQuests: [],
      shelvedQuests: [],
    });
  });

  it("does not throw when no epic is attached", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await aRelease(user, project.id, "0.28.0");
    const loose = await aQuest(user, project.id, "Loose", {
      releaseId: release.id,
    });

    // The `inArray: []` trap: an empty epic list has to omit the branch
    // entirely, because `IN ()` is a SQL syntax error. A release with no
    // epics is the normal case, so this is the path most reads take.
    const result = await ctx.contents.contentsOf(release);

    expect(result.quests.map((q) => q.id)).toEqual([loose.id]);
    expect(result.looseQuests.map((q) => q.id)).toEqual([loose.id]);
  });

  it("counts an epic's quests in the release, and shelves separately", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await aRelease(user, project.id, "0.28.0");
    const epic = await anEpic(user, project.id, "The big feature");
    await attachEpicToRelease(user, epic.id, release.id);

    const kept = await aQuest(user, project.id, "Doing it");
    await attachQuestToEpic(user, epic.id, kept.id);
    const declined = await aQuest(user, project.id, "Out of scope");
    await attachQuestToEpic(user, epic.id, declined.id);
    await ctx.questController.shelveQuest.fetch(
      { params: { id: declined.id } },
      { user },
    );

    const result = await ctx.contents.contentsOf(release);

    // The shelve reaches the release through the EPIC, not through a direct
    // attachment, which is the path a `releaseId`-only query would miss.
    expect(result.quests.map((q) => q.id)).toEqual([kept.id]);
    expect(result.shelvedQuests.map((q) => q.id)).toEqual([declined.id]);
  });

  it("gathers the quests of attached epics", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await aRelease(user, project.id, "0.28.0");
    const epic = await anEpic(user, project.id, "The big feature");
    await attachEpicToRelease(user, epic.id, release.id);

    const inEpic = await aQuest(user, project.id, "Inside the epic");
    await attachQuestToEpic(user, epic.id, inEpic.id);
    const loose = await aQuest(user, project.id, "A hotfix", {
      releaseId: release.id,
    });

    const result = await ctx.contents.contentsOf(release);

    expect(result.epics.map((e) => e.id)).toEqual([epic.id]);
    const byId = (a: number, b: number) => a - b;
    expect(result.quests.map((q) => q.id).sort(byId)).toEqual(
      [inEpic.id, loose.id].sort(byId),
    );
    expect(result.looseQuests.map((q) => q.id)).toEqual([loose.id]);
  });

  it("counts a quest reachable both ways once, as an epic quest", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await aRelease(user, project.id, "0.28.0");
    const epic = await anEpic(user, project.id, "The big feature");
    await attachEpicToRelease(user, epic.id, release.id);

    // Attached to the release directly AND a member of one of its epics.
    const both = await aQuest(user, project.id, "Both ways", {
      releaseId: release.id,
    });
    await attachQuestToEpic(user, epic.id, both.id);

    const result = await ctx.contents.contentsOf(release);

    expect(result.quests).toHaveLength(1);
    // Not loose: it reaches the release through its epic, and the partition
    // tests epic membership first so it cannot be counted on both sides.
    expect(result.looseQuests).toEqual([]);
  });

  it("puts a cross-release quest in the release it names", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const first = await aRelease(user, project.id, "0.28.0");
    const second = await aRelease(user, project.id, "1.0.0");
    const epic = await anEpic(user, project.id, "Spans a boundary");
    await attachEpicToRelease(user, epic.id, first.id);

    // Its epic ships in 0.28.0; the quest itself names 1.0.0. A real state,
    // not an error: it belongs to the release it names.
    const crossing = await aQuest(user, project.id, "Slips to 1.0.0", {
      releaseId: second.id,
    });
    await attachQuestToEpic(user, epic.id, crossing.id);

    const inFirst = await ctx.contents.contentsOf(first);
    const inSecond = await ctx.contents.contentsOf(second);

    // The explicit attachment WINS. It belongs to the release it names and
    // is absent from its epic's release entirely - otherwise it would sit in
    // two denominators at once and "the progress of 0.28.0" would count work
    // that ships in 1.0.0.
    expect(inFirst.quests).toEqual([]);
    expect(inSecond.quests.map((q) => q.id)).toEqual([crossing.id]);
    expect(inSecond.looseQuests.map((q) => q.id)).toEqual([crossing.id]);
  });

  it("excludes shelved quests", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await aRelease(user, project.id, "0.28.0");
    const kept = await aQuest(user, project.id, "Kept", {
      releaseId: release.id,
    });
    const shelved = await aQuest(user, project.id, "Set aside", {
      releaseId: release.id,
    });
    await ctx.questController.shelveQuest.fetch(
      { params: { id: shelved.id } },
      { user },
    );

    const result = await ctx.contents.contentsOf(release);

    // Out of the denominator, but not out of the answer: `shelvedQuests` is
    // what lets the progress rollup report declined work as its own bucket
    // instead of folding it into the untouched remainder.
    expect(result.quests.map((q) => q.id)).toEqual([kept.id]);
    expect(result.shelvedQuests.map((q) => q.id)).toEqual([shelved.id]);
  });

  it("excludes soft-deleted quests without a hand-written filter", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await aRelease(user, project.id, "0.28.0");
    const kept = await aQuest(user, project.id, "Kept", {
      releaseId: release.id,
    });
    const gone = await aQuest(user, project.id, "Deleted", {
      releaseId: release.id,
    });
    await ctx.questController.deleteQuest.fetch(
      { params: { id: gone.id } },
      { user },
    );

    // `Repository.withDeletedAt` wraps the whole where in an `and`, so the
    // service's top-level `or` is nested inside it rather than flattened
    // beside it. This is the assertion that would fail if the `or` escaped.
    const result = await ctx.contents.contentsOf(release);

    expect(result.quests.map((q) => q.id)).toEqual([kept.id]);
    expect(result.shelvedQuests).toEqual([]);
  });

  it("ignores another project's quests", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const mine = await createTestProject(ctx, user, "Mine");
    const theirs = await createTestProject(ctx, user, "Theirs");
    const release = await aRelease(user, mine.id, "0.28.0");
    const kept = await aQuest(user, mine.id, "Mine", { releaseId: release.id });
    await aQuest(user, theirs.id, "Not mine");

    const result = await ctx.contents.contentsOf(release);

    expect(result.quests.map((q) => q.id)).toEqual([kept.id]);
  });
});
