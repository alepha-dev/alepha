import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  EpicProgressService,
  LorePlanApi,
  QuestController,
  ReleaseContentService,
  ReleaseController,
} from "../src/api/index.ts";
import {
  createTestEpic,
  createTestProject,
  createTestQuest,
  WorkTestEntities,
} from "../src/testing/index.ts";

/**
 * A draft shown as what it is where a quest is drawn by its status (#Q4380,
 * epic #E178): the quest waiting on a draft says so on accept and in its
 * questline, a release counts a draft in its open bucket and carries its
 * `draftAt` for the chip, and an epic's progress counts it as open work.
 */

interface TestContext {
  alepha: Alepha;
  controller: QuestController;
  releases: ReleaseController;
  contents: ReleaseContentService;
  progress: EpicProgressService;
  repos: WorkTestEntities;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LorePlanApi);

  const repos = alepha.inject(WorkTestEntities);
  await alepha.start();

  return {
    alepha,
    controller: alepha.inject(QuestController),
    releases: alepha.inject(ReleaseController),
    contents: alepha.inject(ReleaseContentService),
    progress: alepha.inject(EpicProgressService),
    repos,
  };
};

const ownerToken = (project: { createdBy: string }): UserAccountToken => ({
  id: project.createdBy,
  roles: ["user"],
});

const AT = "2026-11-28T10:00:00.000Z";

describe("a draft as a predecessor, in a release and in an epic", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("the accept refusal on its dependent", () => {
    it("names a loose draft predecessor as a draft, and says how it is made ready", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const first = await createTestQuest(ctx.alepha, project, {
        draftAt: AT,
      });
      const next = await createTestQuest(ctx.alepha, project, {
        dependsOn: first.id,
      });

      await expect(
        ctx.controller.acceptQuest(
          { params: { id: next.id } },
          { user: ownerToken(project) },
        ),
      ).rejects.toThrow(
        `Cannot accept quest: blocked by #Q${first.shortId}, a draft. It cannot be taken until it is marked ready (quest_ready, lore quest ready, or Mark as ready on its page).`,
      );
    });

    it("names the epic when the predecessor is a draft because its epic is", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "draft",
      });
      const first = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
        draftAt: AT,
      });
      const next = await createTestQuest(ctx.alepha, project, {
        dependsOn: first.id,
      });

      await expect(
        ctx.controller.acceptQuest(
          { params: { id: next.id } },
          { user: ownerToken(project) },
        ),
      ).rejects.toThrow(
        `Cannot accept quest: blocked by #Q${first.shortId}, a draft because Epic #E${epic.number} is. Nothing in it can be taken until Epic #E${epic.number} is marked ready (epic_set_status, or lore epic set status).`,
      );
    });

    it("keeps the plain sentence for a to-do predecessor and a shelved draft", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const todo = await createTestQuest(ctx.alepha, project);
      const shelved = await createTestQuest(ctx.alepha, project, {
        draftAt: AT,
        shelvedAt: AT,
      });
      const afterTodo = await createTestQuest(ctx.alepha, project, {
        dependsOn: todo.id,
      });
      const afterShelved = await createTestQuest(ctx.alepha, project, {
        dependsOn: shelved.id,
      });
      const user = ownerToken(project);

      for (const [quest, blocker] of [
        [afterTodo, todo],
        [afterShelved, shelved],
      ] as const) {
        const refusal = await ctx.controller
          .acceptQuest({ params: { id: quest.id } }, { user })
          .then(
            () => "",
            (error: unknown) =>
              error instanceof Error ? error.message : String(error),
          );
        expect(refusal).toBe(
          `Cannot accept quest: blocked by #Q${blocker.shortId}`,
        );
      }
    });
  });

  describe("the questline", () => {
    it("carries draftAt on the predecessor and the dependents", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const first = await createTestQuest(ctx.alepha, project, {
        draftAt: AT,
      });
      const middle = await createTestQuest(ctx.alepha, project, {
        dependsOn: first.id,
      });
      const last = await createTestQuest(ctx.alepha, project, {
        dependsOn: middle.id,
        draftAt: AT,
      });

      const line = await ctx.controller.getQuestLine(
        { params: { id: middle.id } },
        { user: ownerToken(project) },
      );

      expect(line.predecessor?.id).toBe(first.id);
      expect(line.predecessor?.draftAt).toBeDefined();
      expect(line.dependents.map((d) => [d.id, !!d.draftAt])).toEqual([
        [last.id, true],
      ]);
    });
  });

  describe("a release", () => {
    it("counts a draft in its open remainder, ratio unchanged, and gives its row draftAt", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const user = ownerToken(project);
      const release = await ctx.releases.createRelease(
        { params: { projectId: project.id }, body: { tag: "1.0.0" } },
        { user },
      );
      const done = await createTestQuest(ctx.alepha, project, {
        releaseId: release.id,
        acceptedAt: AT,
        completedAt: AT,
      });
      const todo = await createTestQuest(ctx.alepha, project, {
        releaseId: release.id,
      });
      const draft = await createTestQuest(ctx.alepha, project, {
        releaseId: release.id,
        draftAt: AT,
      });

      const row = await ctx.repos.releases.getById(release.id);
      const progress = ctx.contents.progressOf(
        row,
        await ctx.contents.contentsOf(row),
      );
      // Four buckets, no fifth: the draft is in `total` and in neither
      // `completed` nor `inProgress`, so it is part of the open remainder.
      expect(progress).toEqual({
        completed: 1,
        inProgress: 0,
        shelved: 0,
        total: 3,
      });

      const contents = await ctx.releases.getReleaseContents(
        { params: { id: release.id } },
        { user },
      );
      const rows = new Map(contents.looseQuests.map((q) => [q.id, q]));
      expect(rows.get(draft.id)?.draftAt).toBeDefined();
      expect(rows.get(todo.id)?.draftAt).toBeUndefined();
      expect(rows.get(done.id)?.completedAt).toBeDefined();
    });
  });

  describe("an epic's progress", () => {
    it("counts a draft as open work, as it counts a to-do quest", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "draft",
      });
      await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
        draftAt: AT,
      });
      await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
        draftAt: AT,
      });
      await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
        acceptedAt: AT,
        completedAt: AT,
      });

      const progress = (await ctx.progress.computeProgressOf([epic.id])).get(
        epic.id,
      );

      expect(progress).toEqual({
        completed: 1,
        inProgress: 0,
        shelved: 0,
        shelvedWithEpic: 0,
        total: 3,
      });
    });
  });
});
