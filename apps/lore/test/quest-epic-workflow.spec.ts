import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { QuestController } from "../src/api/controllers/QuestController.ts";
import type { Project } from "../src/api/entities/projects.ts";
import { LoreApi } from "../src/api/index.ts";
import {
  createTestEpic,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

/**
 * The epic phase gate on the quest transitions, and the two epic moves those
 * transitions now make on their own (#Q2223).
 *
 * A quest is worked only while its epic is `ready` or `in_progress`. The
 * actions that open or advance work are gated: accept and complete, and
 * assign and unshelve, which each open work by another door. Shelve and
 * unassign are deliberately NOT gated, because they move a quest toward
 * resolution; a spec pins that too, so nobody "completes the set" later.
 *
 * The first quest of a `ready` epic to be accepted or assigned moves the
 * epic to `in_progress`, and the request that resolves its last open quest
 * moves it to `completed`. Both used to be clicks (Begin, Conclude) that the
 * agent was told to make itself.
 *
 * The WORDING of every refusal is pinned on `EpicWorkflowService.spec.ts`.
 * This file is about the fact of the refusal reaching each handler, the
 * order of the gates, and the epic ending up where the rule says.
 *
 * Rows are seeded through the fixtures rather than the controllers on
 * purpose: an accepted quest inside a draft epic cannot be produced
 * through the API once this gate exists.
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

  const statusOf = async (epic: { id: number }) =>
    (await ctx.repos.epics.getById(epic.id)).status;

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

    it("refuses a draft epic's quest and leaves it untouched", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "draft",
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
        `Cannot accept quest #Q${quest.shortId}: Epic #E${epic.number} is a draft, and not ready for development yet.`,
      );
      expect(
        (await ctx.repos.quests.getById(quest.id)).acceptedAt,
      ).toBeUndefined();
      expect(await statusOf(epic)).toBe("draft");
    });

    it("starts a ready epic with its first accepted quest", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "ready",
      });
      const quest = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
      });
      await createTestQuest(ctx.alepha, project, { epicId: epic.id });

      const accepted = await ctx.controller.acceptQuest(
        { params: { id: quest.id } },
        { user: ownerToken(project) },
      );

      expect(accepted.acceptedAt).toBeDefined();
      const after = await ctx.repos.epics.getById(epic.id);
      expect(after.status).toBe("in_progress");
      expect(after.startedAt).toBeDefined();
    });

    it("accepts an in-progress epic's quest and leaves its start date alone", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "in_progress",
        startedAt: STAMP,
      });
      const quest = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
      });

      await ctx.controller.acceptQuest(
        { params: { id: quest.id } },
        { user: ownerToken(project) },
      );

      expect((await ctx.repos.epics.getById(epic.id)).startedAt).toBe(STAMP);
    });

    it("refuses a completed epic's quest", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "completed",
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
        `Cannot accept quest #Q${quest.shortId}: Epic #E${epic.number} is completed. File this in a new epic.`,
      );
    });

    it("refuses to start a ready epic whose predecessor is not completed", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const first = await createTestEpic(ctx.alepha, project, {
        status: "in_progress",
      });
      const second = await createTestEpic(ctx.alepha, project, {
        status: "ready",
        dependsOn: first.id,
      });
      const quest = await createTestQuest(ctx.alepha, project, {
        epicId: second.id,
      });

      await expect(
        ctx.controller.acceptQuest(
          { params: { id: quest.id } },
          { user: ownerToken(project) },
        ),
      ).rejects.toThrow(/depends on Epic #E\d+, which is not completed/);
      expect(await statusOf(second)).toBe("ready");
    });

    it("reports the epic reason before the questline reason", async ({
      expect,
    }) => {
      // Both gates apply: the epic is a draft AND the predecessor quest is
      // still open. The epic reason wins.
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "draft",
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
      ).rejects.toThrow(/is a draft, and not ready for development yet/);
    });

    it("does not start the epic when a later gate refuses the accept", async ({
      expect,
    }) => {
      // The epic is written AFTER the quest, so a questline refusal leaves
      // a ready epic ready rather than started with nothing accepted in it.
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "ready",
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
      ).rejects.toThrow(/blocked by/);
      expect(await statusOf(epic)).toBe("ready");
    });
  });

  describe("assign", () => {
    it("refuses inside a draft epic before it looks at the assignee", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "draft",
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
        `Cannot assign quest #Q${quest.shortId}: Epic #E${epic.number} is a draft, and not ready for development yet.`,
      );
    });

    it("starts a ready epic, like accepting does", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "ready",
      });
      const quest = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
      });

      await ctx.controller.assignQuest(
        { params: { id: quest.id }, body: { userId: project.createdBy } },
        { user: ownerToken(project) },
      );

      expect(await statusOf(epic)).toBe("in_progress");
    });
  });

  describe("complete", () => {
    it("refuses inside a draft epic", async ({ expect }) => {
      // A row that pre-dates the gate: accepted while the epic was a draft.
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "draft",
      });
      const parked = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
        acceptedAt: STAMP,
        acceptedBy: project.createdBy,
      });

      await expect(
        ctx.controller.completeQuest(
          { params: { id: parked.id }, body: {} },
          { user: ownerToken(project) },
        ),
      ).rejects.toThrow(
        `Cannot complete quest #Q${parked.shortId}: Epic #E${epic.number} is a draft, and not ready for development yet.`,
      );
    });

    it("completes the epic with its last open quest, and only then", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "in_progress",
        startedAt: STAMP,
      });
      const first = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
        acceptedAt: STAMP,
        acceptedBy: project.createdBy,
      });
      const second = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
        acceptedAt: STAMP,
        acceptedBy: project.createdBy,
      });
      // Resolved already, so it does not hold the epic open.
      await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
        shelvedAt: STAMP,
      });

      await ctx.controller.completeQuest(
        { params: { id: first.id }, body: {} },
        { user },
      );
      expect(await statusOf(epic)).toBe("in_progress");

      await ctx.controller.completeQuest(
        { params: { id: second.id }, body: {} },
        { user },
      );
      const after = await ctx.repos.epics.getById(epic.id);
      expect(after.status).toBe("completed");
      expect(after.completedAt).toBeDefined();
    });
  });

  describe("shelve", () => {
    it("completes an in-progress epic when the last open quest is shelved", async ({
      expect,
    }) => {
      // Shelving is the epic-level equivalent of waiving an objective.
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "in_progress",
      });
      await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
        acceptedAt: STAMP,
        completedAt: STAMP,
      });
      const declined = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
      });

      await ctx.controller.shelveQuest(
        { params: { id: declined.id } },
        { user: ownerToken(project) },
      );

      expect(await statusOf(epic)).toBe("completed");
    });

    it("leaves a ready epic ready, even with every quest shelved", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "ready",
      });
      const only = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
      });

      await ctx.controller.shelveQuest(
        { params: { id: only.id } },
        { user: ownerToken(project) },
      );

      expect(await statusOf(epic)).toBe("ready");
    });
  });

  /**
   * The default release (#E48) is taken when the epic STARTS, which is where
   * Begin used to take it. Ported from `EpicController.spec.ts` with the
   * Begin click replaced by the first accept.
   */
  describe("the default release on start", () => {
    const withDefault = async (project: Project) =>
      ctx.repos.releases.create({
        projectId: project.id,
        number: 1,
        tag: "0.30.0",
        title: "0.30.0",
        description: "",
        defaultSince: new Date().toISOString(),
      });

    it("takes the default release, and the epic's release-less quests follow", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const release = await withDefault(project);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "ready",
      });
      const accepted = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
      });
      const follower = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
      });

      const result = await ctx.controller.acceptQuest(
        { params: { id: accepted.id } },
        { user: ownerToken(project) },
      );

      // One shape for "an epic has a release": the epic's row and its
      // quests' rows all name it, the one just accepted included, and the
      // response is not stale about it.
      expect((await ctx.repos.epics.getById(epic.id)).releaseId).toBe(
        release.id,
      );
      expect(result.releaseId).toBe(release.id);
      const after = await ctx.repos.quests.getById(follower.id);
      expect(after.releaseId).toBe(release.id);
      // The carve-out is one COLUMN. Nothing about the quest's status moved.
      expect(after.acceptedAt).toBeUndefined();
      expect(after.shelvedAt).toBeUndefined();
      expect(after.kanbanColumn).toBeUndefined();
    });

    it("keeps a quest that named its own release while the epic was a draft", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const fallback = await withDefault(project);
      const own = await ctx.repos.releases.create({
        projectId: project.id,
        number: 2,
        tag: "1.0.0",
        title: "1.0.0",
        description: "",
      });
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "ready",
      });
      const accepted = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
      });
      const crossRelease = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
        releaseId: own.id,
      });

      await ctx.controller.acceptQuest(
        { params: { id: accepted.id } },
        { user: ownerToken(project) },
      );

      expect((await ctx.repos.quests.getById(accepted.id)).releaseId).toBe(
        fallback.id,
      );
      expect((await ctx.repos.quests.getById(crossRelease.id)).releaseId).toBe(
        own.id,
      );
    });

    it("leaves an epic that already names a release, and its quests, untouched", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      await withDefault(project);
      const own = await ctx.repos.releases.create({
        projectId: project.id,
        number: 2,
        tag: "1.0.0",
        title: "1.0.0",
        description: "",
      });
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "ready",
        releaseId: own.id,
      });
      const accepted = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
      });
      const other = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
      });
      const before = (await ctx.repos.quests.getById(other.id)).updatedAt;

      await ctx.controller.acceptQuest(
        { params: { id: accepted.id } },
        { user: ownerToken(project) },
      );

      // The attach only ever fills a blank. An epic that answered the
      // question is not second-guessed, and no cascade runs at all.
      expect((await ctx.repos.epics.getById(epic.id)).releaseId).toBe(own.id);
      expect((await ctx.repos.quests.getById(other.id)).updatedAt).toEqual(
        before,
      );
    });
  });

  it("has no way to reopen a completed quest at all", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const epic = await createTestEpic(ctx.alepha, project, {
      status: "in_progress",
    });
    const shipped = await createTestQuest(ctx.alepha, project, {
      epicId: epic.id,
      acceptedAt: STAMP,
      acceptedBy: project.createdBy,
      completedAt: STAMP,
      completedBy: project.createdBy,
    });
    const user = ownerToken(project);

    // Epic #E48 deleted reopen: a quest is immutable, and follow-up work is
    // a NEW quest linked to the old one.
    expect(
      (ctx.controller as unknown as Record<string, unknown>).reopenQuest,
    ).toBeUndefined();

    // And the one write path that is left cannot undo a completion: whether
    // `updateQuestById` refuses the field or drops it, `completedAt` is still
    // there afterwards. Asserting the END STATE rather than a throw is the
    // point.
    await ctx.controller
      .updateQuestById(
        { params: { id: shipped.id }, body: { completedAt: null } as never },
        { user },
      )
      .catch(() => undefined);
    expect((await ctx.repos.quests.getById(shipped.id)).completedAt).toBe(
      STAMP,
    );
  });

  it("unshelve refuses inside a completed epic and works in every other status", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const user = ownerToken(project);
    const shelvedIn = (epicId: number) =>
      createTestQuest(ctx.alepha, project, {
        epicId,
        shelvedAt: STAMP,
        shelvedBy: project.createdBy,
      });

    const completed = await createTestEpic(ctx.alepha, project, {
      status: "completed",
    });
    const sealed = await shelvedIn(completed.id);
    await expect(
      ctx.controller.unshelveQuest({ params: { id: sealed.id } }, { user }),
    ).rejects.toThrow(
      `Cannot unshelve quest #Q${sealed.shortId}: Epic #E${completed.number} is completed. File this in a new epic.`,
    );

    // Bringing a quest back into an open plan is an edit to it, and starts
    // nothing: a ready epic stays ready.
    for (const status of ["draft", "ready", "in_progress"] as const) {
      const epic = await createTestEpic(ctx.alepha, project, { status });
      const quest = await shelvedIn(epic.id);
      const back = await ctx.controller.unshelveQuest(
        { params: { id: quest.id } },
        { user },
      );
      expect(back.shelvedAt).toBeUndefined();
      expect(await statusOf(epic)).toBe(status);
    }
  });

  describe("delete", () => {
    it("deletes a loose quest and a draft or ready epic's quest", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const draft = await createTestEpic(ctx.alepha, project, {
        status: "draft",
      });
      const ready = await createTestEpic(ctx.alepha, project, {
        status: "ready",
      });
      const user = ownerToken(project);

      for (const quest of [
        await createTestQuest(ctx.alepha, project),
        await createTestQuest(ctx.alepha, project, { epicId: draft.id }),
        await createTestQuest(ctx.alepha, project, { epicId: ready.id }),
      ]) {
        const result = await ctx.controller.deleteQuest(
          { params: { id: quest.id } },
          { user },
        );
        expect(result.ok).toBe(true);
      }
    });

    it("refuses inside an in-progress or completed epic, naming shelve", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const started = await createTestEpic(ctx.alepha, project, {
        status: "in_progress",
      });
      const completed = await createTestEpic(ctx.alepha, project, {
        status: "completed",
      });
      const held = await createTestQuest(ctx.alepha, project, {
        epicId: started.id,
      });
      const sealed = await createTestQuest(ctx.alepha, project, {
        epicId: completed.id,
      });
      const user = ownerToken(project);

      await expect(
        ctx.controller.deleteQuest({ params: { id: held.id } }, { user }),
      ).rejects.toThrow(
        `Cannot delete quest #Q${held.shortId}: Epic #E${started.number} is in progress. Its plan is frozen. Shelve it instead.`,
      );
      await expect(
        ctx.controller.deleteQuest({ params: { id: sealed.id } }, { user }),
      ).rejects.toThrow(
        `Cannot delete quest #Q${sealed.shortId}: Epic #E${completed.number} is completed.`,
      );
      // Both rows survive.
      expect((await ctx.repos.quests.getById(held.id)).id).toBe(held.id);
      expect((await ctx.repos.quests.getById(sealed.id)).id).toBe(sealed.id);
    });
  });

  it("shelve and unassign stay ungated in every status", async ({ expect }) => {
    // The two exits out of a completed epic for rows that pre-date the
    // rule. Refusing either would trap the first such row forever.
    const project = await createTestProject(ctx.alepha);
    const completed = await createTestEpic(ctx.alepha, project, {
      status: "completed",
    });
    const stranded = await createTestQuest(ctx.alepha, project, {
      epicId: completed.id,
    });
    const held = await createTestQuest(ctx.alepha, project, {
      epicId: completed.id,
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
