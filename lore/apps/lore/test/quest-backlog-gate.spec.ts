import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { KanbanController } from "../src/api/controllers/KanbanController.ts";
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
  kanban: KanbanController;
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

  // Registered before `start()` — there is no EpicController yet, so epics
  // are written straight through a repository.
  const repos = alepha.inject(TestEntityRepositories);

  await alepha.start();

  return {
    alepha,
    admin: alepha.inject(AdminUserController),
    projects: alepha.inject(ProjectController),
    quests: alepha.inject(QuestController),
    kanban: alepha.inject(KanbanController),
    fake: alepha.inject(FakeProvider),
    repos,
  };
};

describe("the backlog gate on the listing surfaces", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * Three quests: one with no epic at all, one parked in a `planned` epic,
   * one released through an `active` epic. Only the parked one is gated.
   */
  const setupProject = async () => {
    const fakeUser = ctx.fake.generate(userDataSchema);
    const created = await ctx.admin.createUser.fetch(
      { body: { ...fakeUser, roles: ["user"] } },
      { user: adminUser },
    );
    const owner = { id: created.data.id, roles: created.data.roles };

    const project = await ctx.projects.createProject.fetch(
      { body: { title: "Gate probe" } },
      { user: owner },
    );
    const projectId = project.data.id;

    const makeQuest = async (title: string) => {
      const res = await ctx.quests.createQuest.fetch(
        {
          body: {
            title,
            description: "<p>x</p>",
            area: "core",
            priority: "medium",
            projectId,
            objectives: [],
          },
        },
        { user: owner },
      );
      return res.data;
    };

    const unfiled = await makeQuest("Unfiled Quest");
    const parked = await makeQuest("Parked Quest");
    const released = await makeQuest("Released Quest");

    const plannedEpic = await ctx.repos.epics.create({
      projectId,
      number: 1,
      title: "Planned Epic",
      description: "",
      status: "planned",
    });
    const activeEpic = await ctx.repos.epics.create({
      projectId,
      number: 2,
      title: "Active Epic",
      description: "",
      status: "active",
    });

    await ctx.repos.quests.updateById(parked.id, { epicId: plannedEpic.id });
    await ctx.repos.quests.updateById(released.id, { epicId: activeEpic.id });

    return {
      owner,
      projectId,
      unfiled,
      parked,
      released,
      plannedEpic,
    };
  };

  const titlesOf = (quests: Array<{ title: string }>) =>
    quests.map((quest) => quest.title).sort();

  it("hides planned-epic quests from the quest list and keeps unfiled ones", async ({
    expect,
  }) => {
    const c = await setupProject();

    const res = await ctx.quests.getQuests.fetch(
      { params: { projectId: c.projectId }, query: {} },
      { user: c.owner },
    );

    expect(titlesOf(res.data.content)).toEqual([
      "Released Quest",
      "Unfiled Quest",
    ]);
    // `paginate` counts through a second query built from the same where —
    // a total that disagreed with the page would page users into nothing.
    expect(res.data.page.totalElements).toBe(2);
  });

  it("shows the parked quest again when the caller opts out", async ({
    expect,
  }) => {
    const c = await setupProject();

    const res = await ctx.quests.getQuests.fetch(
      { params: { projectId: c.projectId }, query: { includePlanned: true } },
      { user: c.owner },
    );

    expect(titlesOf(res.data.content)).toEqual([
      "Parked Quest",
      "Released Quest",
      "Unfiled Quest",
    ]);
    expect(res.data.page.totalElements).toBe(3);
  });

  it("shows everything inside an epic when that epic is addressed directly", async ({
    expect,
  }) => {
    const c = await setupProject();

    const res = await ctx.quests.getQuests.fetch(
      { params: { projectId: c.projectId }, query: { epic: c.plannedEpic.id } },
      { user: c.owner },
    );

    // Opening a planned epic must show its contents — hidden never means
    // unreachable (spec §5.3).
    expect(titlesOf(res.data.content)).toEqual(["Parked Quest"]);
  });

  it("keeps the Kanban board in agreement with the quest list", async ({
    expect,
  }) => {
    const c = await setupProject();

    const board = await ctx.kanban.getBoard.fetch(
      { params: { projectId: c.projectId } },
      { user: c.owner },
    );

    expect(titlesOf(board.data.quests)).toEqual([
      "Released Quest",
      "Unfiled Quest",
    ]);
  });

  it("does not gate a project whose epics are all active", async ({
    expect,
  }) => {
    // The zero-planned-epics path is the normal case and the one that
    // throws on `notInArray: []`, so it is asserted through the real
    // controller and not only through the service.
    const c = await setupProject();
    await ctx.repos.epics.updateById(c.plannedEpic.id, { status: "active" });

    const res = await ctx.quests.getQuests.fetch(
      { params: { projectId: c.projectId }, query: {} },
      { user: c.owner },
    );

    expect(res.data.page.totalElements).toBe(3);
  });
});
