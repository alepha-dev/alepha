import { ReadCounter } from "@lore/core/testing";
import { EpicController } from "@lore/work/api";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestEpic,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

interface TestContext {
  alepha: Alepha;
  controller: EpicController;
  repos: TestEntityRepositories;
}

/**
 * Pinned to SQLite for the reason `EpicController.spec.ts` gives: the root
 * vitest config points `DATABASE_URL` at Postgres.
 */
const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  bootLore(alepha);
  alepha.with(ReadCounter);
  const repos = alepha.inject(TestEntityRepositories);
  await alepha.start();
  return { alepha, controller: alepha.inject(EpicController), repos };
};

const ownerToken = (project: { createdBy: string }): UserAccountToken => ({
  id: project.createdBy,
  roles: ["user"],
});

const STAMP = "2026-10-01T00:00:00.000Z";

/**
 * Epic shelving (#E78, #Q2670, folio #1365): what `shelveEpic` and
 * `unshelveEpic` do to the quests, and which ones they leave alone.
 */
describe("shelveEpic and unshelveEpic", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * One epic holding a quest in every state, the shape every test starts
   * from: three open (to do, accepted, held), one completed, and one
   * shelved by hand before the epic was.
   */
  const seed = async (status: "ready" | "in_progress") => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const epic = await createTestEpic(ctx.alepha, project, {
      status,
      ...(status === "in_progress" ? { startedAt: STAMP } : {}),
    });
    const filed = { epicId: epic.id };
    const todo = await createTestQuest(ctx.alepha, project, filed);
    const accepted = await createTestQuest(ctx.alepha, project, {
      ...filed,
      acceptedAt: STAMP,
      acceptedBy: project.createdBy,
      kanbanColumn: "doing",
    });
    const held = await createTestQuest(ctx.alepha, project, {
      ...filed,
      heldAt: STAMP,
      heldBy: project.createdBy,
    });
    const completed = await createTestQuest(ctx.alepha, project, {
      ...filed,
      acceptedAt: STAMP,
      completedAt: STAMP,
    });
    const shelvedBefore = await createTestQuest(ctx.alepha, project, {
      ...filed,
      shelvedAt: STAMP,
    });
    return {
      project,
      user,
      epic,
      open: [todo, accepted, held],
      completed,
      shelvedBefore,
    };
  };

  it("shelves every open quest through todo, marks them, and never completes the epic", async ({
    expect,
  }) => {
    const { user, epic, open, completed, shelvedBefore } =
      await seed("in_progress");

    const result = await ctx.controller.shelveEpic(
      { params: { id: epic.id } },
      { user },
    );

    expect(result.status).toBe("shelved");
    expect(result.movedQuests).toBe(3);
    expect((await ctx.repos.epics.getById(epic.id)).status).toBe("shelved");
    for (const quest of open) {
      const row = await ctx.repos.quests.getById(quest.id);
      expect(row.shelvedAt).toBeDefined();
      expect(row.shelvedWithEpic).toBe(true);
      // Handed back to todo first: `shelvedAt` is only ever on a todo quest.
      expect(row.acceptedAt).toBeUndefined();
      expect(row.heldAt).toBeUndefined();
      expect(row.kanbanColumn).toBeUndefined();
      expect(row.history.at(-1)?.action).toBe("shelved");
    }
    const accepted = await ctx.repos.quests.getById(open[1]!.id);
    expect(accepted.history.map((h) => h.action)).toEqual([
      "unassigned",
      "shelved",
    ]);
    const held = await ctx.repos.quests.getById(open[2]!.id);
    expect(held.history.map((h) => h.action)).toEqual(["unheld", "shelved"]);

    const done = await ctx.repos.quests.getById(completed.id);
    expect(done.shelvedAt).toBeUndefined();
    expect(done.completedAt).toBe(STAMP);
    const before = await ctx.repos.quests.getById(shelvedBefore.id);
    expect(before.shelvedWithEpic).toBeUndefined();
  });

  it("unshelves only the quests it marked, back to in progress for a started epic", async ({
    expect,
  }) => {
    const { user, epic, open, shelvedBefore } = await seed("in_progress");
    await ctx.controller.shelveEpic({ params: { id: epic.id } }, { user });

    const result = await ctx.controller.unshelveEpic(
      { params: { id: epic.id } },
      { user },
    );

    expect(result.movedQuests).toBe(3);
    expect(result.status).toBe("in_progress");
    for (const quest of open) {
      const row = await ctx.repos.quests.getById(quest.id);
      expect(row.shelvedAt).toBeUndefined();
      expect(row.shelvedWithEpic).toBeUndefined();
      // Back as todo: the assignment was handed back on the way out.
      expect(row.acceptedAt).toBeUndefined();
    }
    // Shelved by hand before the epic was: it stays shelved.
    expect((await ctx.repos.quests.getById(shelvedBefore.id)).shelvedAt).toBe(
      STAMP,
    );
  });

  it("returns an epic that never started to ready", async ({ expect }) => {
    const { user, epic } = await seed("ready");
    await ctx.controller.shelveEpic({ params: { id: epic.id } }, { user });

    const result = await ctx.controller.unshelveEpic(
      { params: { id: epic.id } },
      { user },
    );

    expect(result.status).toBe("ready");
  });

  it("shelves a draft epic and brings it back ready, as the epic description says", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const epic = await createTestEpic(ctx.alepha, project, { status: "draft" });
    await createTestQuest(ctx.alepha, project, { epicId: epic.id });

    const shelved = await ctx.controller.shelveEpic(
      { params: { id: epic.id } },
      { user },
    );
    expect(shelved.movedQuests).toBe(1);

    const back = await ctx.controller.unshelveEpic(
      { params: { id: epic.id } },
      { user },
    );
    expect(back.status).toBe("ready");
  });

  it("finishes a shelve that failed halfway when called again", async ({
    expect,
  }) => {
    // The epic write lands first, so a failure halfway leaves a shelved
    // epic with a quest still open. A second call is the retry.
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const epic = await createTestEpic(ctx.alepha, project, {
      status: "shelved",
    });
    const straggler = await createTestQuest(ctx.alepha, project, {
      epicId: epic.id,
    });

    const result = await ctx.controller.shelveEpic(
      { params: { id: epic.id } },
      { user },
    );

    expect(result.movedQuests).toBe(1);
    expect((await ctx.repos.quests.getById(straggler.id)).shelvedWithEpic).toBe(
      true,
    );
  });

  it("completes a started epic on unshelve when nothing is left open", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const epic = await createTestEpic(ctx.alepha, project, {
      status: "shelved",
      startedAt: STAMP,
    });
    await createTestQuest(ctx.alepha, project, {
      epicId: epic.id,
      acceptedAt: STAMP,
      completedAt: STAMP,
    });

    const result = await ctx.controller.unshelveEpic(
      { params: { id: epic.id } },
      { user },
    );

    expect(result.status).toBe("completed");
  });

  it("refuses a completed epic and leaves its quests untouched", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const epic = await createTestEpic(ctx.alepha, project, {
      status: "completed",
    });
    const quest = await createTestQuest(ctx.alepha, project, {
      epicId: epic.id,
      acceptedAt: STAMP,
      completedAt: STAMP,
    });

    await expect(
      ctx.controller.shelveEpic({ params: { id: epic.id } }, { user }),
    ).rejects.toThrow(
      `Cannot shelve Epic #E${epic.number}: it is completed. Completed is terminal.`,
    );
    const row = await ctx.repos.quests.getById(quest.id);
    expect(row.shelvedAt).toBeUndefined();
    expect((await ctx.repos.epics.getById(epic.id)).status).toBe("completed");
  });

  it("refuses to unshelve an epic that is not shelved, naming it", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const epic = await createTestEpic(ctx.alepha, project, {
      status: "in_progress",
    });

    await expect(
      ctx.controller.unshelveEpic({ params: { id: epic.id } }, { user }),
    ).rejects.toThrow(
      `Cannot unshelve Epic #E${epic.number}: it is in progress, not shelved.`,
    );
  });
});
