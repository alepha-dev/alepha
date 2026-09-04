import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";
import {
  createTestEpic,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

/**
 * The epic phase gate on the quest transitions (epic #31): a quest can be
 * worked only while its epic is `active`.
 *
 * Five actions open or advance work and all five are gated: accept and
 * complete, which the plan named, and assign, reopen and unshelve, which
 * each open work by another door. Two are deliberately NOT gated, shelve
 * and unassign, because they move a quest toward resolution; a spec pins
 * that too, so nobody "completes the set" later.
 *
 * The WORDING of every refusal is pinned on `EpicWorkflowService.spec.ts`.
 * This file is about the fact of the refusal reaching each handler, and
 * about the order: the epic reason is reported before the questline reason,
 * since it is the one fixed by a single click somewhere else.
 *
 * Rows are seeded through the fixtures rather than the controllers on
 * purpose. An accepted quest inside a planned epic cannot be produced
 * through the API once this gate exists, and a spec that had to walk an
 * epic backwards to build its fixture would break the day the ratchet lands.
 */

interface TestContext {
  alepha: Alepha;
  controller: QuestController;
  repos: TestEntityRepositories;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    // Pinned, like every other lore spec: the ROOT vitest config points
    // DATABASE_URL at Postgres, which this app's SQLite provider rejects.
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreApi);

  const repos = alepha.inject(TestEntityRepositories);
  await alepha.start();

  return { alepha, controller: alepha.inject(QuestController), repos };
};

const ownerToken = (project: { createdBy: string }): UserAccountToken => ({
  id: project.createdBy,
  roles: ["user"],
});

const STAMP = "2026-09-04T00:00:00.000Z";

describe("the epic phase gate on quest transitions", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("accept", () => {
    it("accepts a loose quest, which is most of them", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const quest = await createTestQuest(ctx.alepha, project);

      const accepted = await ctx.controller.acceptQuest(
        { params: { id: quest.id } },
        { user: ownerToken(project) },
      );

      expect(accepted.acceptedAt).toBeDefined();
    });

    it("refuses a planned epic's quest and says to begin the epic", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "planned",
      });
      const quest = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
      });

      await expect(
        ctx.controller.acceptQuest(
          { params: { id: quest.id } },
          { user: ownerToken(project) },
        ),
      ).rejects.toThrow(
        `Cannot accept quest #${quest.shortId}: Epic #${epic.number} is planned. Begin it first.`,
      );
      expect(
        (await ctx.repos.quests.getById(quest.id)).acceptedAt,
      ).toBeUndefined();
    });

    it("accepts an active epic's quest", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "active",
      });
      const quest = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
      });

      const accepted = await ctx.controller.acceptQuest(
        { params: { id: quest.id } },
        { user: ownerToken(project) },
      );

      expect(accepted.acceptedAt).toBeDefined();
    });

    it("refuses a concluded epic's quest and names the successor route", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "done",
      });
      const quest = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
      });

      await expect(
        ctx.controller.acceptQuest(
          { params: { id: quest.id } },
          { user: ownerToken(project) },
        ),
      ).rejects.toThrow(
        `Cannot accept quest #${quest.shortId}: Epic #${epic.number} is concluded. File this in a new epic.`,
      );
    });

    it("reports the epic reason before the questline reason", async ({
      expect,
    }) => {
      // Both gates apply: the epic is planned AND the predecessor is still
      // open. The epic reason wins, because it is fixed by one click.
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "planned",
      });
      const predecessor = await createTestQuest(ctx.alepha, project);
      const quest = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
        dependsOn: predecessor.id,
      });

      await expect(
        ctx.controller.acceptQuest(
          { params: { id: quest.id } },
          { user: ownerToken(project) },
        ),
      ).rejects.toThrow(/is planned. Begin it first/);
    });
  });

  it("assign refuses inside a planned epic before it looks at the assignee", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const epic = await createTestEpic(ctx.alepha, project, {
      status: "planned",
    });
    const quest = await createTestQuest(ctx.alepha, project, {
      epicId: epic.id,
    });

    // A non-member assignee would be refused on its own; the epic reason
    // comes first, so this is the message that reaches the caller.
    await expect(
      ctx.controller.assignQuest(
        { params: { id: quest.id }, body: { userId: crypto.randomUUID() } },
        { user: ownerToken(project) },
      ),
    ).rejects.toThrow(
      `Cannot assign quest #${quest.shortId}: Epic #${epic.number} is planned. Begin it first.`,
    );
  });

  it("complete refuses inside a planned epic and works inside an active one", async ({
    expect,
  }) => {
    // A row that pre-dates the gate: accepted while the epic was planned.
    const project = await createTestProject(ctx.alepha);
    const planned = await createTestEpic(ctx.alepha, project, {
      status: "planned",
    });
    const active = await createTestEpic(ctx.alepha, project, {
      status: "active",
    });
    const parked = await createTestQuest(ctx.alepha, project, {
      epicId: planned.id,
      acceptedAt: STAMP,
      acceptedBy: project.createdBy,
    });
    const live = await createTestQuest(ctx.alepha, project, {
      epicId: active.id,
      acceptedAt: STAMP,
      acceptedBy: project.createdBy,
    });
    const user = ownerToken(project);

    await expect(
      ctx.controller.completeQuest(
        { params: { id: parked.id }, body: {} },
        { user },
      ),
    ).rejects.toThrow(
      `Cannot complete quest #${parked.shortId}: Epic #${planned.number} is planned. Begin it first.`,
    );

    const completed = await ctx.controller.completeQuest(
      { params: { id: live.id }, body: {} },
      { user },
    );
    expect(completed.completedAt).toBeDefined();
  });

  it("reopen refuses inside a concluded epic and works inside an active one", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const done = await createTestEpic(ctx.alepha, project, { status: "done" });
    const active = await createTestEpic(ctx.alepha, project, {
      status: "active",
    });
    const closed = await createTestQuest(ctx.alepha, project, {
      epicId: done.id,
      acceptedAt: STAMP,
      acceptedBy: project.createdBy,
      completedAt: STAMP,
      completedBy: project.createdBy,
    });
    const shipped = await createTestQuest(ctx.alepha, project, {
      epicId: active.id,
      acceptedAt: STAMP,
      acceptedBy: project.createdBy,
      completedAt: STAMP,
      completedBy: project.createdBy,
    });
    const user = ownerToken(project);

    await expect(
      ctx.controller.reopenQuest({ params: { id: closed.id } }, { user }),
    ).rejects.toThrow(
      `Cannot reopen quest #${closed.shortId}: Epic #${done.number} is concluded. File this in a new epic.`,
    );

    const reopened = await ctx.controller.reopenQuest(
      { params: { id: shipped.id } },
      { user },
    );
    expect(reopened.completedAt).toBeUndefined();
  });

  it("unshelve refuses inside a concluded epic and works while planned or active", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const done = await createTestEpic(ctx.alepha, project, { status: "done" });
    const planned = await createTestEpic(ctx.alepha, project, {
      status: "planned",
    });
    const active = await createTestEpic(ctx.alepha, project, {
      status: "active",
    });
    const user = ownerToken(project);
    const shelvedIn = (epicId: number) =>
      createTestQuest(ctx.alepha, project, {
        epicId,
        shelvedAt: STAMP,
        shelvedBy: project.createdBy,
      });

    const sealed = await shelvedIn(done.id);
    await expect(
      ctx.controller.unshelveQuest({ params: { id: sealed.id } }, { user }),
    ).rejects.toThrow(
      `Cannot unshelve quest #${sealed.shortId}: Epic #${done.number} is concluded. File this in a new epic.`,
    );

    // Shelving during planning is an edit to an open plan, and so is
    // bringing the quest back.
    for (const epic of [planned, active]) {
      const quest = await shelvedIn(epic.id);
      const back = await ctx.controller.unshelveQuest(
        { params: { id: quest.id } },
        { user },
      );
      expect(back.shelvedAt).toBeUndefined();
    }
  });

  it("shelve and unassign stay ungated in every phase", async ({ expect }) => {
    // The two exits out of a concluded epic for rows that pre-date the
    // rule. Refusing either would trap the first such row forever.
    const project = await createTestProject(ctx.alepha);
    const done = await createTestEpic(ctx.alepha, project, { status: "done" });
    const stranded = await createTestQuest(ctx.alepha, project, {
      epicId: done.id,
    });
    const held = await createTestQuest(ctx.alepha, project, {
      epicId: done.id,
      acceptedAt: STAMP,
      acceptedBy: project.createdBy,
    });
    const user = ownerToken(project);

    const shelved = await ctx.controller.shelveQuest(
      { params: { id: stranded.id } },
      { user },
    );
    expect(shelved.shelvedAt).toBeDefined();

    const released = await ctx.controller.abandonQuest(
      { params: { id: held.id } },
      { user },
    );
    expect(released.acceptedAt).toBeUndefined();
  });
});
