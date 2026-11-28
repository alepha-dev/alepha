import { ProjectController } from "@lore/core/api";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  KanbanController,
  OpenQuestScope,
  QuestController,
  QuestDraftService,
} from "../src/api/index.ts";
import { LorePlanApi } from "../src/api/index.ts";
import { QUEST_STATUSES_WITH_DRAFTS } from "../src/schemas/index.ts";
import { WorkTestEntities } from "../src/testing/index.ts";

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
  drafts: QuestDraftService;
  open: OpenQuestScope;
  fake: FakeProvider;
  repos: WorkTestEntities;
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
  alepha.with(LorePlanApi);

  // Registered before `start()`: epics are written straight through a
  // repository, without the Plan capability's `epics` option.
  const repos = alepha.inject(WorkTestEntities);

  await alepha.start();

  return {
    alepha,
    admin: alepha.inject(AdminUserController),
    projects: alepha.inject(ProjectController),
    quests: alepha.inject(QuestController),
    kanban: alepha.inject(KanbanController),
    drafts: alepha.inject(QuestDraftService),
    open: alepha.inject(OpenQuestScope),
    fake: alepha.inject(FakeProvider),
    repos,
  };
};

/**
 * The parity of the draft status with the backlog gate it replaced (#Q4374,
 * epic #E178): the gate's own fixtures and its own expected rows, read
 * through `draftAt` now, on the quest list, the board and the open count.
 *
 * A quest is filed into a draft epic by a raw write, then stamped by
 * `QuestDraftService.draftEpic`, the one statement that marks an epic's
 * quests draft. The fixtures are what an epic writes, not a `draftAt` set by
 * hand.
 *
 * One difference is expected, and pinned in its own block: the gate hid every
 * quest of a draft epic, completed and shelved ones included, and `draftAt`
 * is never set on a completed quest, while the `shelved` condition does not
 * read it. So a draft epic's completed quest now shows in the default list
 * and under Completed, and its shelved one under Shelved. No count moves:
 * the reports already counted completed quests, and every count leaves
 * shelved ones out.
 */
describe("the draft scope, against the backlog gate's fixtures", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const createOwner = async () => {
    const created = await ctx.admin.createUser.fetch(
      { body: { ...ctx.fake.generate(userDataSchema), roles: ["user"] } },
      { user: adminUser },
    );
    return { id: created.data.id, roles: created.data.roles };
  };

  const createProject = async (
    owner: { id: string; roles: string[] },
    title: string,
  ) =>
    (
      await ctx.projects.createProject.fetch(
        { body: { title } },
        { user: owner },
      )
    ).data.id;

  const makeQuest = async (
    owner: { id: string; roles: string[] },
    projectId: number,
    title: string,
  ) =>
    (
      await ctx.quests.createQuest.fetch(
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
      )
    ).data;

  /**
   * The gate's three quests: one with no epic at all, one parked in a
   * `draft` epic, one released through a `ready` epic. Only the parked one is
   * a draft.
   */
  const setupProject = async () => {
    const owner = await createOwner();
    const projectId = await createProject(owner, "Gate probe");

    const unfiled = await makeQuest(owner, projectId, "Unfiled Quest");
    const parked = await makeQuest(owner, projectId, "Parked Quest");
    const released = await makeQuest(owner, projectId, "Released Quest");

    const draftEpic = await ctx.repos.epics.create({
      projectId,
      number: 1,
      title: "Draft Epic",
      description: "",
      status: "draft",
    });
    const readyEpic = await ctx.repos.epics.create({
      projectId,
      number: 2,
      title: "Ready Epic",
      description: "",
      status: "ready",
    });

    await ctx.repos.quests.updateById(parked.id, { epicId: draftEpic.id });
    await ctx.repos.quests.updateById(released.id, { epicId: readyEpic.id });
    await ctx.drafts.draftEpic(draftEpic.id);

    return { owner, projectId, unfiled, parked, released, draftEpic };
  };

  const list = async (
    c: { owner: { id: string; roles: string[] }; projectId: number },
    query: Record<string, unknown> = {},
  ) =>
    (
      await ctx.quests.getQuests.fetch(
        { params: { projectId: c.projectId }, query },
        { user: c.owner },
      )
    ).data;

  const titlesOf = (quests: Array<{ title: string }>) =>
    quests.map((quest) => quest.title).sort();

  describe("the rows the gate showed", () => {
    it("leaves the draft out of the default list and keeps unfiled quests", async ({
      expect,
    }) => {
      const c = await setupProject();

      const page = await list(c);

      expect(titlesOf(page.content)).toEqual([
        "Released Quest",
        "Unfiled Quest",
      ]);
      // `paginate` counts through a second query built from the same where:
      // a total that disagreed with the page would page users into nothing.
      expect(page.page.totalElements).toBe(2);
    });

    it("leaves the draft out under statusOp not", async ({ expect }) => {
      const c = await setupProject();

      const page = await list(c, { status: "completed", statusOp: "not" });

      expect(titlesOf(page.content)).toEqual([
        "Released Quest",
        "Unfiled Quest",
      ]);
    });

    it("returns the draft when a status names it", async ({ expect }) => {
      const c = await setupProject();

      expect(titlesOf((await list(c, { status: "draft" })).content)).toEqual([
        "Parked Quest",
      ]);
      // Every status still in scope, drafts named: what the pickers ask for.
      expect(
        titlesOf(
          (await list(c, { status: QUEST_STATUSES_WITH_DRAFTS })).content,
        ),
      ).toEqual(["Parked Quest", "Released Quest", "Unfiled Quest"]);
    });

    it("shows everything inside an epic when that epic is addressed directly", async ({
      expect,
    }) => {
      const c = await setupProject();

      // Opening a draft epic must show its contents: left out of the default
      // views never means unreachable.
      expect(
        titlesOf((await list(c, { epic: c.draftEpic.id })).content),
      ).toEqual(["Parked Quest"]);
      expect(
        titlesOf((await list(c, { epicId: String(c.draftEpic.id) })).content),
      ).toEqual(["Parked Quest"]);
      // "No epic" OR the draft epic: the epic keeps its draft.
      expect(
        titlesOf((await list(c, { epicId: `none,${c.draftEpic.id}` })).content),
      ).toEqual(["Parked Quest", "Unfiled Quest"]);
    });

    it("puts the drafts on the Kanban board, read as draft and never as to do", async ({
      expect,
    }) => {
      // The board's Draft column holds them (#Q4376), as the list's Draft
      // filter shows them; To do still holds exactly what the default list
      // does.
      const c = await setupProject();

      const board = await ctx.kanban.getBoard.fetch(
        { params: { projectId: c.projectId } },
        { user: c.owner },
      );

      expect(titlesOf(board.data.quests)).toEqual([
        "Parked Quest",
        "Released Quest",
        "Unfiled Quest",
      ]);
      expect(
        titlesOf(board.data.quests.filter((q) => q.metadata.status === "todo")),
      ).toEqual(titlesOf((await list(c)).content));
      expect(
        board.data.quests
          .filter((q) => q.metadata.status === "draft")
          .map((q) => q.title),
      ).toEqual(["Parked Quest"]);
    });

    it("leaves nothing out once the epic is marked ready", async ({
      expect,
    }) => {
      const c = await setupProject();
      await ctx.repos.epics.updateById(c.draftEpic.id, { status: "ready" });
      await ctx.drafts.releaseEpic(c.draftEpic.id);

      expect((await list(c)).page.totalElements).toBe(3);
    });

    it("counts open quests per project as the gate did, with no leak across projects", async ({
      expect,
    }) => {
      const c = await setupProject();
      const otherId = await createProject(c.owner, "Other probe");
      await makeQuest(c.owner, otherId, "Other Quest");

      const counts = await ctx.open.countByProject([c.projectId, otherId]);

      expect(counts.get(c.projectId)).toBe(2);
      expect(counts.get(otherId)).toBe(1);
    });
  });

  describe("a held draft", () => {
    it("is out of the default list and of On hold, and in its epic", async ({
      expect,
    }) => {
      const c = await setupProject();
      const held = await makeQuest(c.owner, c.projectId, "Held Draft");
      await ctx.repos.quests.updateById(held.id, {
        epicId: c.draftEpic.id,
        heldAt: "2026-11-01T00:00:00.000Z",
      });
      await ctx.drafts.draftEpic(c.draftEpic.id);
      const loneHeld = await makeQuest(c.owner, c.projectId, "Held Quest");
      await ctx.repos.quests.updateById(loneHeld.id, {
        heldAt: "2026-11-01T00:00:00.000Z",
      });

      expect(titlesOf((await list(c)).content)).toEqual([
        "Held Quest",
        "Released Quest",
        "Unfiled Quest",
      ]);
      expect(titlesOf((await list(c, { status: "on_hold" })).content)).toEqual([
        "Held Quest",
      ]);
      expect(
        titlesOf((await list(c, { epic: c.draftEpic.id })).content),
      ).toEqual(["Held Draft", "Parked Quest"]);
      expect(
        (await ctx.open.countByProject([c.projectId])).get(c.projectId),
      ).toBe(3);

      // On the board it is a card, with `draftAt` under its hold, which is
      // what sends it to the Draft column rather than To do.
      const board = await ctx.kanban.getBoard.fetch(
        { params: { projectId: c.projectId } },
        { user: c.owner },
      );
      const card = board.data.quests.find((q) => q.title === "Held Draft");
      expect(card?.metadata.status).toBe("on_hold");
      expect(card?.draftAt).toBeDefined();
    });
  });

  describe("a loose draft", () => {
    it("is out of the default list and of the No epic filter, and named by draft", async ({
      expect,
    }) => {
      const c = await setupProject();
      const loose = await makeQuest(c.owner, c.projectId, "Loose Draft");
      await ctx.quests.draftQuest.fetch(
        { params: { id: loose.id } },
        { user: c.owner },
      );

      expect(titlesOf((await list(c)).content)).toEqual([
        "Released Quest",
        "Unfiled Quest",
      ]);
      expect(titlesOf((await list(c, { epicId: "none" })).content)).toEqual([
        "Unfiled Quest",
      ]);
      expect(titlesOf((await list(c, { status: "draft" })).content)).toEqual([
        "Loose Draft",
        "Parked Quest",
      ]);
    });
  });

  describe("the one expected difference", () => {
    it("shows a draft epic's completed quest in the default list and under Completed, and its shelved one under Shelved", async ({
      expect,
    }) => {
      const c = await setupProject();
      const done = await makeQuest(c.owner, c.projectId, "Finished Quest");
      const shelved = await makeQuest(c.owner, c.projectId, "Shelved Quest");
      await ctx.repos.quests.updateById(done.id, {
        epicId: c.draftEpic.id,
        acceptedAt: "2026-11-01T00:00:00.000Z",
        acceptedBy: c.owner.id,
        completedAt: "2026-11-02T00:00:00.000Z",
        completedBy: c.owner.id,
      });
      await ctx.repos.quests.updateById(shelved.id, {
        epicId: c.draftEpic.id,
        shelvedAt: "2026-11-02T00:00:00.000Z",
      });
      await ctx.drafts.draftEpic(c.draftEpic.id);

      // The gate hid both, whatever the filter. Neither is in a count that
      // moved: the open count leaves completed and shelved quests out.
      expect(titlesOf((await list(c)).content)).toEqual([
        "Finished Quest",
        "Released Quest",
        "Unfiled Quest",
      ]);
      expect(
        titlesOf((await list(c, { status: "completed" })).content),
      ).toEqual(["Finished Quest"]);
      expect(titlesOf((await list(c, { status: "shelved" })).content)).toEqual([
        "Shelved Quest",
      ]);
      expect(
        (await ctx.repos.quests.getById(shelved.id)).draftAt,
      ).toBeDefined();
      expect((await ctx.repos.quests.getById(done.id)).draftAt).toBeUndefined();
      expect(
        (await ctx.open.countByProject([c.projectId])).get(c.projectId),
      ).toBe(2);
    });
  });
});
