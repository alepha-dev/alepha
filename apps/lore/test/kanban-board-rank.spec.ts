import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { KanbanController } from "../src/api/controllers/KanbanController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";
import { TestEntityRepositories } from "./fixtures/entities.ts";

/**
 * `boardRank` (quest #1216) and `moveQuestOnBoard`.
 *
 * The load-bearing claim is the LAZY ranking: `board_rank` shipped as a
 * bare nullable `ADD COLUMN` with no backfill — the only shape that is safe
 * on `quests`, the CASCADE parent of `quest_comments` — so an untouched
 * board has to look exactly as it did, and a column has to rank itself the
 * first time somebody reorders it.
 */

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

describe("board rank", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const setupBoard = async () => {
    const created = await ctx.admin.createUser.fetch(
      { body: { ...ctx.fake.generate(userDataSchema), roles: ["user"] } },
      { user: adminUser },
    );
    const owner = { id: created.data.id, roles: created.data.roles };

    const project = await ctx.projects.createProject.fetch(
      { body: { title: "Rank probe" } },
      { user: owner },
    );
    const projectId = project.data.id;

    // One priority for all three, so the rank assertions below are about
    // ranking and nothing else. Priority ordering has its own spec at the
    // bottom of this file.
    const ids: number[] = [];
    for (let index = 0; index < 3; index++) {
      const res = await ctx.quests.createQuest.fetch(
        {
          body: {
            title: `Quest ${index}`,
            description: "<p>x</p>",
            area: "core",
            priority: "medium",
            projectId,
            objectives: [],
          },
        },
        { user: owner },
      );
      ids.push(res.data.id);
    }

    return { owner, projectId, ids };
  };

  const boardIds = async (owner: { id: string }, projectId: number) => {
    const board = await ctx.kanban.getBoard.fetch(
      { params: { projectId } },
      { user: owner },
    );
    return board.data.quests.map((q) => q.id);
  };

  describe("before anything is ranked", () => {
    it("returns every quest, in a stable order", async () => {
      const { owner, projectId, ids } = await setupBoard();
      const first = await boardIds(owner, projectId);
      const byId = (a: number, b: number) => a - b;
      expect([...first].sort(byId)).toEqual([...ids].sort(byId));
      // Stable across reads: nothing about the unranked fallback may be
      // nondeterministic, or a card would appear to move on its own.
      expect(await boardIds(owner, projectId)).toEqual(first);
    });

    it("leaves every rank empty, so the migration needed no backfill", async () => {
      const { projectId } = await setupBoard();
      const rows = await ctx.repos.quests.findMany({
        where: { projectId: { eq: projectId } },
      });
      expect(rows.every((row) => !row.boardRank)).toBe(true);
    });
  });

  describe("moving a card", () => {
    it("ranks the whole column on the first move", async () => {
      const { owner, projectId, ids } = await setupBoard();

      await ctx.kanban.moveQuestOnBoard.fetch(
        { params: { id: ids[2] }, body: { afterQuestId: ids[0] } },
        { user: owner },
      );

      const rows = await ctx.repos.quests.findMany({
        where: { projectId: { eq: projectId } },
      });
      expect(rows.every((row) => !!row.boardRank)).toBe(true);
    });

    it("puts the last card at the head when dropped above the first", async () => {
      const { owner, projectId } = await setupBoard();
      const [first, second, third] = await boardIds(owner, projectId);

      await ctx.kanban.moveQuestOnBoard.fetch(
        { params: { id: third }, body: { afterQuestId: first } },
        { user: owner },
      );

      expect(await boardIds(owner, projectId)).toEqual([third, first, second]);
    });

    it("puts a card between two others", async () => {
      const { owner, projectId } = await setupBoard();
      const [first, second, third] = await boardIds(owner, projectId);

      await ctx.kanban.moveQuestOnBoard.fetch(
        {
          params: { id: first },
          body: { beforeQuestId: second, afterQuestId: third },
        },
        { user: owner },
      );

      expect(await boardIds(owner, projectId)).toEqual([second, first, third]);
    });

    it("puts a card at the tail when dropped below the last", async () => {
      const { owner, projectId } = await setupBoard();
      const [first, second, third] = await boardIds(owner, projectId);

      await ctx.kanban.moveQuestOnBoard.fetch(
        { params: { id: first }, body: { beforeQuestId: third } },
        { user: owner },
      );

      expect(await boardIds(owner, projectId)).toEqual([second, third, first]);
    });

    it("survives repeated moves into the same gap", async () => {
      const { owner, projectId } = await setupBoard();
      const [first, second, third] = await boardIds(owner, projectId);

      // Shuttle the same card between the same two neighbours. A float
      // rank would collapse here; the order must stay exact.
      for (let i = 0; i < 40; i++) {
        await ctx.kanban.moveQuestOnBoard.fetch(
          {
            params: { id: first },
            body: { beforeQuestId: second, afterQuestId: third },
          },
          { user: owner },
        );
        expect(await boardIds(owner, projectId)).toEqual([
          second,
          first,
          third,
        ]);
      }
    });
  });

  /**
   * Regression guard for a bug that predates this epic and lived in the
   * board from the day it was written.
   *
   * `getBoard` ordered by `priority desc` in SQL, and `quests.priority` is
   * a TEXT enum — so SQLite sorted the LABEL. The labels happen to run
   * `optional > medium > low > high`, which is the exact reverse of
   * severity, so the board showed optional work first and high-priority
   * work last.
   */
  describe("priority ordering", () => {
    const setupPriorities = async () => {
      const created = await ctx.admin.createUser.fetch(
        { body: { ...ctx.fake.generate(userDataSchema), roles: ["user"] } },
        { user: adminUser },
      );
      const owner = { id: created.data.id, roles: created.data.roles };

      const project = await ctx.projects.createProject.fetch(
        { body: { title: "Priority probe" } },
        { user: owner },
      );
      const projectId = project.data.id;

      // Created least-urgent first, so a passing result cannot be creation
      // order in disguise.
      const byPriority: Record<string, number> = {};
      for (const priority of ["optional", "low", "medium", "high"] as const) {
        const res = await ctx.quests.createQuest.fetch(
          {
            body: {
              title: `${priority} quest`,
              description: "<p>x</p>",
              area: "core",
              priority,
              projectId,
              objectives: [],
            },
          },
          { user: owner },
        );
        byPriority[priority] = res.data.id;
      }

      return { owner, projectId, byPriority };
    };

    it("puts the most urgent quest first, not the least", async () => {
      const { owner, projectId, byPriority } = await setupPriorities();

      expect(await boardIds(owner, projectId)).toEqual([
        byPriority.high,
        byPriority.medium,
        byPriority.low,
        byPriority.optional,
      ]);
    });

    it("does not sort by the label, which would invert it", async () => {
      const { owner, projectId, byPriority } = await setupPriorities();
      const order = await boardIds(owner, projectId);

      // The precise inversion the text-enum sort produced.
      expect(order).not.toEqual([
        byPriority.optional,
        byPriority.medium,
        byPriority.low,
        byPriority.high,
      ]);
      expect(order.indexOf(byPriority.high)).toBeLessThan(
        order.indexOf(byPriority.optional),
      );
    });

    it("still lets a manual rank override priority", async () => {
      const { owner, projectId, byPriority } = await setupPriorities();

      // Ranking is the user's explicit choice; priority is only the
      // fallback, so a dragged card must not snap back.
      await ctx.kanban.moveQuestOnBoard.fetch(
        {
          params: { id: byPriority.optional },
          body: { afterQuestId: byPriority.high },
        },
        { user: owner },
      );

      const order = await boardIds(owner, projectId);
      expect(order[0]).toBe(byPriority.optional);
    });
  });

  describe("access", () => {
    it("refuses a non-member", async () => {
      const { projectId, ids } = await setupBoard();
      const outsider = await ctx.admin.createUser.fetch(
        { body: { ...ctx.fake.generate(userDataSchema), roles: ["user"] } },
        { user: adminUser },
      );

      await expect(
        ctx.kanban.moveQuestOnBoard.fetch(
          { params: { id: ids[0] }, body: { afterQuestId: ids[1] } },
          { user: { id: outsider.data.id, roles: outsider.data.roles } },
        ),
      ).rejects.toThrow();

      const rows = await ctx.repos.quests.findMany({
        where: { projectId: { eq: projectId } },
      });
      expect(rows.every((row) => !row.boardRank)).toBe(true);
    });
  });
});
