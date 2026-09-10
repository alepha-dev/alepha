import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, BadRequestError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "../../../test/fixtures/entities.ts";
import { questComments } from "../entities/questComments.ts";
import { LoreApi } from "../index.ts";
import { QuestController } from "./QuestController.ts";

/**
 * The comment table, registered before `start()` for the reason
 * `TestEntityRepositories` documents: `quest_comments.questId` refs
 * `quests`, and a table first reached after boot fails at BOOT with
 * "Referenced table not found", nowhere near the call that needed it.
 *
 * ⚠️ A SIBLING of `TestEntityRepositories`, never a subclass. The
 * `createTest*` fixtures inject that class by identity, and a subclass is a
 * different key: registering only the subclass leaves the base unregistered
 * and every fixture call fails with `ContainerLockedError` after `start()`.
 */
class QuestCommentRepositories {
  comments = $repository(questComments);
}

interface TestContext {
  alepha: Alepha;
  controller: QuestController;
  repos: QuestCommentRepositories;
  dt: DateTimeProvider;
}

/**
 * Pinned, like every other lore spec: the ROOT vitest config — the one CI
 * runs — sets `DATABASE_URL` to a Postgres URL, which this app's SQLite
 * provider rejects outright. A bare `Alepha.create()` passes under
 * `yarn w lore test` and fails under `yarn test`.
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
  alepha.with(LoreApi);

  // Both, before `start()`: the fixtures reach for the first by identity.
  alepha.inject(TestEntityRepositories);
  const repos = alepha.inject(QuestCommentRepositories);

  await alepha.start();

  return {
    alepha,
    controller: alepha.inject(QuestController),
    repos,
    dt: alepha.inject(DateTimeProvider),
  };
};

const ownerToken = (project: { createdBy: string }): UserAccountToken => ({
  id: project.createdBy,
  roles: ["user"],
});

describe("QuestController hold", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("the transition matrix", () => {
    it("holds a new quest and reports it as held", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      const quest = await createTestQuest(ctx.alepha, project);

      const held = await ctx.controller.holdQuest(
        { params: { id: quest.id }, body: { reason: "Waiting on the key" } },
        { user },
      );

      expect(held.metadata.status).toBe("held");
      expect(held.heldAt).toBeDefined();
      expect(held.heldBy).toBe(user.id);
    });

    it("holds an accepted quest WITHOUT clearing its assignee", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      const quest = await createTestQuest(ctx.alepha, project);
      await ctx.controller.acceptQuest({ params: { id: quest.id } }, { user });

      const held = await ctx.controller.holdQuest(
        { params: { id: quest.id }, body: { reason: "Blocked on legal" } },
        { user },
      );

      // The whole mechanism: `acceptedAt` survives underneath the hold, so
      // nothing has to record where the hold came from.
      expect(held.metadata.status).toBe("held");
      expect(held.acceptedAt).toBeDefined();
      expect(held.acceptedBy).toBe(user.id);
    });

    it("gives an accepted quest its assignee back on unhold", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      const quest = await createTestQuest(ctx.alepha, project);
      await ctx.controller.acceptQuest({ params: { id: quest.id } }, { user });
      await ctx.controller.holdQuest(
        { params: { id: quest.id }, body: { reason: "Blocked" } },
        { user },
      );

      const lifted = await ctx.controller.unholdQuest(
        { params: { id: quest.id } },
        { user },
      );

      expect(lifted.metadata.status).toBe("accepted");
      expect(lifted.acceptedBy).toBe(user.id);
      expect(lifted.heldAt).toBeUndefined();
      expect(lifted.heldBy).toBeUndefined();
    });

    it("returns a held new quest to `new` on unhold", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      const quest = await createTestQuest(ctx.alepha, project);
      await ctx.controller.holdQuest(
        { params: { id: quest.id }, body: { reason: "Blocked" } },
        { user },
      );

      const lifted = await ctx.controller.unholdQuest(
        { params: { id: quest.id } },
        { user },
      );

      expect(lifted.metadata.status).toBe("new");
    });

    it("refuses to accept a held quest, and names the fix", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      const quest = await createTestQuest(ctx.alepha, project);
      await ctx.controller.holdQuest(
        { params: { id: quest.id }, body: { reason: "Blocked" } },
        { user },
      );

      await expect(
        ctx.controller.acceptQuest({ params: { id: quest.id } }, { user }),
      ).rejects.toThrow(/on hold/);
    });

    it("refuses to complete a held quest", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      const quest = await createTestQuest(ctx.alepha, project);
      await ctx.controller.acceptQuest({ params: { id: quest.id } }, { user });
      await ctx.controller.holdQuest(
        { params: { id: quest.id }, body: { reason: "Blocked" } },
        { user },
      );

      await expect(
        ctx.controller.completeQuest(
          { params: { id: quest.id }, body: {} },
          { user },
        ),
      ).rejects.toThrow(/on hold/);
    });

    it("refuses to shelve a held quest rather than clearing the hold", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      const quest = await createTestQuest(ctx.alepha, project);
      await ctx.controller.holdQuest(
        { params: { id: quest.id }, body: { reason: "Blocked" } },
        { user },
      );

      await expect(
        ctx.controller.shelveQuest({ params: { id: quest.id } }, { user }),
      ).rejects.toThrow(/on hold/);
    });

    it("ALLOWS abandoning a held accepted quest, and keeps it held", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      const quest = await createTestQuest(ctx.alepha, project);
      await ctx.controller.acceptQuest({ params: { id: quest.id } }, { user });
      await ctx.controller.holdQuest(
        { params: { id: quest.id }, body: { reason: "Blocked" } },
        { user },
      );

      const abandoned = await ctx.controller.abandonQuest(
        { params: { id: quest.id } },
        { user },
      );

      // Handing back a blocked quest must not silently unblock it.
      expect(abandoned.acceptedBy).toBeUndefined();
      expect(abandoned.metadata.status).toBe("held");
    });

    it("refuses to abandon a held quest nobody accepted", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      const quest = await createTestQuest(ctx.alepha, project);
      await ctx.controller.holdQuest(
        { params: { id: quest.id }, body: { reason: "Blocked" } },
        { user },
      );

      await expect(
        ctx.controller.abandonQuest({ params: { id: quest.id } }, { user }),
      ).rejects.toThrow(BadRequestError);
    });

    it("refuses a second hold rather than discarding the new reason", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      const quest = await createTestQuest(ctx.alepha, project);
      await ctx.controller.holdQuest(
        { params: { id: quest.id }, body: { reason: "First reason" } },
        { user },
      );

      await expect(
        ctx.controller.holdQuest(
          { params: { id: quest.id }, body: { reason: "Second reason" } },
          { user },
        ),
      ).rejects.toThrow(/already on hold/);
    });

    it("refuses to unhold a quest that is not held", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      const quest = await createTestQuest(ctx.alepha, project);

      await expect(
        ctx.controller.unholdQuest({ params: { id: quest.id } }, { user }),
      ).rejects.toThrow(BadRequestError);
    });

    it("refuses to hold a completed quest", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      const quest = await createTestQuest(ctx.alepha, project);
      await ctx.controller.acceptQuest({ params: { id: quest.id } }, { user });
      await ctx.controller.completeQuest(
        { params: { id: quest.id }, body: {} },
        { user },
      );

      await expect(
        ctx.controller.holdQuest(
          { params: { id: quest.id }, body: { reason: "Too late" } },
          { user },
        ),
      ).rejects.toThrow(BadRequestError);
    });

    it("lets a running timer be stopped while the quest is held", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      const quest = await createTestQuest(ctx.alepha, project);
      await ctx.controller.acceptQuest({ params: { id: quest.id } }, { user });
      await ctx.controller.startTimer({ params: { id: quest.id } }, { user });
      await ctx.controller.holdQuest(
        { params: { id: quest.id }, body: { reason: "Blocked" } },
        { user },
      );

      // Without this the hold would bill the blocker to the assignee: the
      // timer keeps running and nothing can stop it until somebody unholds.
      const stopped = await ctx.controller.stopTimer(
        { params: { id: quest.id } },
        { user },
      );

      const last = stopped.timerSessions.at(-1);
      expect(last?.stoppedAt).toBeDefined();
    });
  });

  describe("the reason", () => {
    it("posts the reason as a comment authored by whoever held it", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      const quest = await createTestQuest(ctx.alepha, project);

      await ctx.controller.holdQuest(
        {
          params: { id: quest.id },
          body: { reason: "Waiting on @fabrice for the API key" },
        },
        { user },
      );

      const comments = await ctx.repos.comments.findMany({
        where: { questId: { eq: quest.id } },
      });

      expect(comments).toHaveLength(1);
      expect(comments[0].body).toContain("@fabrice");
      expect(comments[0].authorId).toBe(user.id);
      // `source` means "a machine wrote this". A person clicking Hold did
      // not, and neither did `quest_hold`, which is a hold and not a comment
      // posted by an agent in its own voice.
      expect(comments[0].source).toBeUndefined();
    });

    it("records held and unheld on the quest's own history", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      const quest = await createTestQuest(ctx.alepha, project);

      await ctx.controller.holdQuest(
        { params: { id: quest.id }, body: { reason: "Blocked" } },
        { user },
      );
      const lifted = await ctx.controller.unholdQuest(
        { params: { id: quest.id } },
        { user },
      );

      const actions = lifted.history.map((entry) => entry.action);
      expect(actions).toContain("held");
      expect(actions).toContain("unheld");
    });

    it("writes no comment when the hold is refused", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      const quest = await createTestQuest(ctx.alepha, project);
      await ctx.controller.holdQuest(
        { params: { id: quest.id }, body: { reason: "First" } },
        { user },
      );

      await expect(
        ctx.controller.holdQuest(
          { params: { id: quest.id }, body: { reason: "Second" } },
          { user },
        ),
      ).rejects.toThrow();

      const comments = await ctx.repos.comments.findMany({
        where: { questId: { eq: quest.id } },
      });
      expect(comments).toHaveLength(1);
    });
  });

  describe("the status filter", () => {
    it("keeps held quests out of the `new` and `accepted` buckets", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      const plain = await createTestQuest(ctx.alepha, project);
      const blocked = await createTestQuest(ctx.alepha, project);
      await ctx.controller.holdQuest(
        { params: { id: blocked.id }, body: { reason: "Blocked" } },
        { user },
      );

      const newOnes = await ctx.controller.getQuests(
        {
          params: { projectId: project.id },
          query: { status: "new" } as never,
        },
        { user },
      );

      // Without the `heldAt IS NULL` conjunct this returns both, and the
      // table renders one of them with a "Held" badge under a "New" filter.
      const ids = newOnes.content.map((q: { id: number }) => q.id);
      expect(ids).toContain(plain.id);
      expect(ids).not.toContain(blocked.id);
    });

    it("returns held quests under the `held` filter", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      await createTestQuest(ctx.alepha, project);
      const blocked = await createTestQuest(ctx.alepha, project);
      await ctx.controller.holdQuest(
        { params: { id: blocked.id }, body: { reason: "Blocked" } },
        { user },
      );

      const held = await ctx.controller.getQuests(
        {
          params: { projectId: project.id },
          query: { status: "held" } as never,
        },
        { user },
      );

      expect(held.content.map((q: { id: number }) => q.id)).toEqual([
        blocked.id,
      ]);
    });

    it("still shows held quests when no status filter is given", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      const blocked = await createTestQuest(ctx.alepha, project);
      await ctx.controller.holdQuest(
        { params: { id: blocked.id }, body: { reason: "Blocked" } },
        { user },
      );

      const all = await ctx.controller.getQuests(
        { params: { projectId: project.id }, query: {} as never },
        { user },
      );

      // The asymmetry with shelved is the decision: shelved means out of
      // scope, held means blocked and still wanted.
      expect(all.content.map((q: { id: number }) => q.id)).toContain(
        blocked.id,
      );
    });
  });
});
