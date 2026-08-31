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
import { TestEntityRepositories } from "./fixtures/entities.ts";

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
  repos: TestEntityRepositories;
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

  const repos = alepha.inject(TestEntityRepositories);
  await alepha.start();

  return {
    alepha,
    admin: alepha.inject(AdminUserController),
    projects: alepha.inject(ProjectController),
    quests: alepha.inject(QuestController),
    fake: alepha.inject(FakeProvider),
    repos,
  };
};

/**
 * `getQuestline` — what the `/quests/:shortId/graph` route reads (quest #1336).
 *
 * It answers two things in one call because the page's whole job is the fork
 * between them: a quest inside an epic is redirected to that epic's Flow tab,
 * a quest outside one draws its own component here.
 */
describe("a quest's questline", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const setupProject = async () => {
    const fakeUser = ctx.fake.generate(userDataSchema);
    const created = await ctx.admin.createUser.fetch(
      { body: { ...fakeUser, roles: ["user"] } },
      { user: adminUser },
    );
    const owner = { id: created.data.id, roles: created.data.roles };

    const project = await ctx.projects.createProject.fetch(
      { body: { title: "Questline probe" } },
      { user: owner },
    );
    const projectId = project.data.id;

    const makeQuest = async (
      title: string,
      body: Record<string, unknown> = {},
    ) => {
      const res = await ctx.quests.createQuest.fetch(
        {
          body: {
            title,
            description: "<p>x</p>",
            area: "core",
            priority: "medium",
            projectId,
            objectives: [],
            ...body,
          },
        },
        { user: owner },
      );
      return res.data;
    };

    return { owner, projectId, makeQuest };
  };

  const questlineOf = async (
    c: { owner: { id: string; roles: string[] }; projectId: number },
    shortId: number,
  ) => {
    const res = await ctx.quests.getQuestline.fetch(
      { params: { projectId: c.projectId, shortId } },
      { user: c.owner },
    );
    return res.data;
  };

  const titlesOf = (quests: Array<{ title: string }>) =>
    quests.map((quest) => quest.title).sort();

  describe("a quest that belongs to an epic", () => {
    /**
     * The redirect the page makes is decided here, and by the epic's per-project
     * `number` rather than its id, because `/epics/:epicNumber` is what the
     * route is addressed by. A client resolving this itself would have only
     * `epicId` and would need the whole epic list to turn it into a URL.
     */
    it("names the epic by its number, and builds no component", async ({
      expect,
    }) => {
      const c = await setupProject();
      const quest = await c.makeQuest("Filed Quest");
      const epic = await ctx.repos.epics.create({
        projectId: c.projectId,
        number: 7,
        title: "The Epic",
        description: "",
        status: "active",
      });
      await ctx.repos.quests.updateById(quest.id, { epicId: epic.id });

      const questline = await questlineOf(c, quest.shortId);

      expect(questline.epic).toEqual({ number: 7, title: "The Epic" });
      // Empty on purpose: the caller is about to navigate away, so walking
      // the component would be work thrown away.
      expect(questline.quests).toEqual([]);
    });
  });

  describe("a quest that belongs to no epic", () => {
    /**
     * ⚠️ The walk is UNDIRECTED. Following only `dependsOn` would draw the
     * chain above the quest and hide everything the quest itself unblocks,
     * which is half the questline the reader came to see.
     */
    it("returns everything reachable in either direction", async ({
      expect,
    }) => {
      const c = await setupProject();
      const first = await c.makeQuest("First");
      const middle = await c.makeQuest("Middle", { dependsOn: first.id });
      const last = await c.makeQuest("Last", { dependsOn: middle.id });
      await c.makeQuest("Unrelated");

      // Asked from the MIDDLE, so both directions have to be walked to see
      // the other two.
      const questline = await questlineOf(c, middle.shortId);

      expect(questline.epic).toBeUndefined();
      expect(titlesOf(questline.quests)).toEqual(["First", "Last", "Middle"]);
      const byId = (a: number, b: number) => a - b;
      expect(questline.quests.map((q) => q.id).sort(byId)).toEqual(
        [first.id, middle.id, last.id].sort(byId),
      );
    });

    it("follows a fork, where one quest unblocks several", async ({
      expect,
    }) => {
      const c = await setupProject();
      const root = await c.makeQuest("Root");
      await c.makeQuest("Branch A", { dependsOn: root.id });
      await c.makeQuest("Branch B", { dependsOn: root.id });

      const questline = await questlineOf(c, root.shortId);

      expect(titlesOf(questline.quests)).toEqual([
        "Branch A",
        "Branch B",
        "Root",
      ]);
    });

    /**
     * A quest with no relations comes back alone rather than empty, so the
     * page can tell "there is no questline" from "the read failed". The page
     * is what decides to show an empty state for it.
     */
    it("returns a lone quest as itself", async ({ expect }) => {
      const c = await setupProject();
      const alone = await c.makeQuest("Alone");
      await c.makeQuest("Somebody else");

      const questline = await questlineOf(c, alone.shortId);

      expect(titlesOf(questline.quests)).toEqual(["Alone"]);
    });

    /**
     * The rows are full `QuestResource`s, not the `{ id, shortId, title,
     * status, dependsOn }` the retired `getDependencyGraph` returned.
     * `Questline` reads `area` and `metadata` and `QuestlineDialog` renders a
     * whole `QuestView`, so a thinner row meant a second fetch per card.
     */
    it("returns full quest resources, not an edge list", async ({ expect }) => {
      const c = await setupProject();
      const root = await c.makeQuest("Root");
      await c.makeQuest("Next", { dependsOn: root.id });

      const questline = await questlineOf(c, root.shortId);
      const first = questline.quests[0];

      expect(first.area).toBe("core");
      expect(first.priority).toBe("medium");
      expect(first.metadata.status).toBeDefined();
    });
  });

  it("refuses a caller who is not a member of the project", async ({
    expect,
  }) => {
    const c = await setupProject();
    const quest = await c.makeQuest("Private");

    const outsiderData = ctx.fake.generate(userDataSchema);
    const outsiderRow = await ctx.admin.createUser.fetch(
      { body: { ...outsiderData, roles: ["user"] } },
      { user: adminUser },
    );
    const outsider = {
      id: outsiderRow.data.id,
      roles: outsiderRow.data.roles,
    };

    await expect(
      ctx.quests.getQuestline.fetch(
        { params: { projectId: c.projectId, shortId: quest.shortId } },
        { user: outsider },
      ),
    ).rejects.toThrowError();
  });
});
