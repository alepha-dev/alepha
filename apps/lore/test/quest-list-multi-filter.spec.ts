import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
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
  admin: AdminUserController;
  projects: ProjectController;
  quests: QuestController;
  fake: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
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
    admin: alepha.inject(AdminUserController),
    projects: alepha.inject(ProjectController),
    quests: alepha.inject(QuestController),
    fake: alepha.inject(FakeProvider),
  };
};

/**
 * `getQuests` taking several values per filter (quest #1644).
 *
 * The Quests table used to be single-select where the board had always taken
 * lists, so "new or in progress" was not expressible. What matters on the
 * server is the reading each list gets: OR within a filter, AND between
 * filters, and empty meaning ALL rather than NONE.
 *
 * The degradation cases carry as much weight as the happy ones. This page is
 * reachable by hand-edited link and by stale bookmark, so an unknown status
 * or a non-numeric release id has to land on the unfiltered list rather than
 * on an error.
 */
describe("getQuests with multi-value filters", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * Four quests, one per status, plus two areas and two tags spread across
   * them so every filter has something to separate.
   */
  const setupProject = async () => {
    const fakeUser = ctx.fake.generate(userDataSchema);
    const created = await ctx.admin.createUser.fetch(
      { body: { ...fakeUser, roles: ["user"] } },
      { user: adminUser },
    );
    const owner = { id: created.data.id, roles: created.data.roles };

    const project = await ctx.projects.createProject.fetch(
      { body: { title: "Filter probe" } },
      { user: owner },
    );
    const projectId = project.data.id;

    const makeQuest = async (title: string, area: string, tags: string[]) => {
      const res = await ctx.quests.createQuest.fetch(
        {
          body: {
            title,
            description: "<p>x</p>",
            area,
            priority: "medium",
            projectId,
            objectives: [],
            tags,
          },
        },
        { user: owner },
      );
      return res.data;
    };

    const fresh = await makeQuest("Fresh", "core", ["alpha"]);
    const running = await makeQuest("Running", "core", ["beta"]);
    const done = await makeQuest("Done", "ui", ["alpha"]);
    const parked = await makeQuest("Parked", "ui", ["beta"]);

    await ctx.quests.acceptQuest.fetch(
      { params: { id: running.id } },
      { user: owner },
    );
    await ctx.quests.acceptQuest.fetch(
      { params: { id: done.id } },
      { user: owner },
    );
    await ctx.quests.completeQuest.fetch(
      { params: { id: done.id }, body: {} },
      { user: owner },
    );
    await ctx.quests.shelveQuest.fetch(
      { params: { id: parked.id } },
      { user: owner },
    );

    const titles = async (query: Record<string, unknown>) => {
      const page = await ctx.quests.getQuests.fetch(
        { params: { projectId }, query: query as never },
        { user: owner },
      );
      return page.data.content.map((quest) => quest.title).sort();
    };

    return { owner, projectId, titles, fresh };
  };

  it("reads several statuses as a union", async ({ expect }) => {
    const { titles } = await setupProject();
    expect(await titles({ status: "new,accepted" })).toEqual([
      "Fresh",
      "Running",
    ]);
  });

  it("still reads a single status the way it always did", async ({
    expect,
  }) => {
    const { titles } = await setupProject();
    expect(await titles({ status: "completed" })).toEqual(["Done"]);
    expect(await titles({ status: "shelved" })).toEqual(["Parked"]);
  });

  it("treats an empty status list as all, minus the shelved", async ({
    expect,
  }) => {
    const { titles } = await setupProject();
    // Shelved stays out of an unfiltered list, which is the pre-existing
    // rule and is NOT what "empty means all" is about: selecting nothing
    // must not mean showing nothing.
    const unfiltered = ["Done", "Fresh", "Running"];
    expect(await titles({})).toEqual(unfiltered);
    expect(await titles({ status: "" })).toEqual(unfiltered);
    expect(await titles({ status: "," })).toEqual(unfiltered);
  });

  it("reads all four statuses as the same question as none", async ({
    expect,
  }) => {
    const { titles } = await setupProject();
    expect(await titles({ status: "new,accepted,completed,shelved" })).toEqual([
      "Done",
      "Fresh",
      "Parked",
      "Running",
    ]);
  });

  it("unions areas and unions tags", async ({ expect }) => {
    const { titles } = await setupProject();
    expect(await titles({ area: "core,ui", status: "new,accepted" })).toEqual([
      "Fresh",
      "Running",
    ]);
    expect(
      await titles({ area: "ui", status: "new,accepted,completed" }),
    ).toEqual(["Done"]);
    expect(await titles({ tag: "alpha,beta", status: "new" })).toEqual([
      "Fresh",
    ]);
  });

  it("ANDs one filter against another", async ({ expect }) => {
    const { titles } = await setupProject();
    // (new or accepted) AND (area core) AND (tag beta) is only Running, even
    // though each clause on its own matches more.
    expect(
      await titles({ status: "new,accepted", area: "core", tag: "beta" }),
    ).toEqual(["Running"]);
  });

  it("drops an unknown status instead of failing", async ({ expect }) => {
    const { titles } = await setupProject();
    // A stale bookmark, or a value from a later version of the page. The
    // known half of the list still applies.
    expect(await titles({ status: "new,banana" })).toEqual(["Fresh"]);
    // And a list of nothing but unknowns reads as no filter at all, rather
    // than as a filter matching nothing.
    expect(await titles({ status: "banana,kiwi" })).toEqual([
      "Done",
      "Fresh",
      "Running",
    ]);
  });

  it("drops a non-numeric release id instead of failing", async ({
    expect,
  }) => {
    const { titles } = await setupProject();
    expect(await titles({ releaseId: "abc" })).toEqual([
      "Done",
      "Fresh",
      "Running",
    ]);
  });

  it("trims whitespace and collapses duplicates", async ({ expect }) => {
    const { titles } = await setupProject();
    expect(await titles({ status: " new , new ,accepted" })).toEqual([
      "Fresh",
      "Running",
    ]);
  });
});
