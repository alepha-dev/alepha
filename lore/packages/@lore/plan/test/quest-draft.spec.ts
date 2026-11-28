import { CommitReferenceRegistry, ResourceRegistry } from "@lore/core/api";
import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { QuestController, QuestDraftService } from "../src/api/index.ts";
import { LorePlanApi } from "../src/api/index.ts";
import {
  createTestEpic,
  createTestProject,
  createTestQuest,
  WorkTestEntities,
} from "../src/testing/index.ts";

/**
 * A loose quest can be a draft (#Q4372, epic #E178): born one with
 * `draft: true`, or marked one from `todo` with `draftQuest`, and marked
 * ready with `readyQuest`. A draft cannot be accepted, assigned or held,
 * whatever its status reads, and the status filter's `draft` never answers
 * the shelf.
 */

interface TestContext {
  alepha: Alepha;
  controller: QuestController;
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

  return { alepha, controller: alepha.inject(QuestController), repos };
};

const ownerToken = (project: { createdBy: string }): UserAccountToken => ({
  id: project.createdBy,
  roles: ["user"],
});

describe("a loose draft quest", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const create = async (
    project: { id: number; createdBy: string },
    extra: Record<string, unknown> = {},
  ) =>
    await ctx.controller.createQuest(
      {
        body: {
          projectId: project.id,
          title: "Probe",
          area: "general",
          priority: "medium",
          ...extra,
        },
      },
      { user: ownerToken(project) },
    );

  const row = async (quest: { id: number }) =>
    await ctx.repos.quests.getById(quest.id);

  describe("creation", () => {
    it("is born todo unless draft is asked for", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);

      const plain = await create(project);
      const draft = await create(project, { draft: true });

      expect(plain.metadata.status).toBe("todo");
      expect((await row(plain)).draftAt).toBeUndefined();
      expect(draft.metadata.status).toBe("draft");
      expect((await row(draft)).draftAt).toBeDefined();
    });

    it("refuses draft together with accept, for the callers that chain one", ({
      expect,
    }) => {
      const drafts = ctx.alepha.inject(QuestDraftService);

      expect(() =>
        drafts.assertCreatable({ draft: true, accept: true }),
      ).toThrow(
        "Cannot create a quest as a draft and accept it: a draft is not ready to be taken. Nothing was written.",
      );
      expect(() => drafts.assertCreatable({ draft: true })).not.toThrow();
      expect(() => drafts.assertCreatable({ accept: true })).not.toThrow();
    });
  });

  describe("draftQuest and readyQuest", () => {
    it("marks a todo quest draft, then ready, with history and readyAt", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const quest = await createTestQuest(ctx.alepha, project);
      const user = ownerToken(project);

      const drafted = await ctx.controller.draftQuest(
        { params: { id: quest.id } },
        { user },
      );
      expect(drafted.metadata.status).toBe("draft");

      const readied = await ctx.controller.readyQuest(
        { params: { id: quest.id } },
        { user },
      );
      expect(readied.metadata.status).toBe("todo");

      const after = await row(quest);
      expect(after.draftAt).toBeUndefined();
      expect(after.readyAt).toBeDefined();
      expect(after.history.map((it) => it.action)).toEqual([
        "drafted",
        "readied",
      ]);
    });

    it("converges on a retry of either verb", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const quest = await createTestQuest(ctx.alepha, project);
      const user = ownerToken(project);

      await ctx.controller.draftQuest({ params: { id: quest.id } }, { user });
      await ctx.controller.draftQuest({ params: { id: quest.id } }, { user });
      expect((await row(quest)).history).toHaveLength(1);

      await ctx.controller.readyQuest({ params: { id: quest.id } }, { user });
      await ctx.controller.readyQuest({ params: { id: quest.id } }, { user });
      expect((await row(quest)).history).toHaveLength(2);
    });

    it.for([
      ["accepted", { acceptedAt: "2026-11-01T00:00:00.000Z" }, "in_progress"],
      ["held", { heldAt: "2026-11-01T00:00:00.000Z" }, "on_hold"],
      ["shelved", { shelvedAt: "2026-11-01T00:00:00.000Z" }, "shelved"],
      [
        "completed",
        {
          acceptedAt: "2026-11-01T00:00:00.000Z",
          completedAt: "2026-11-02T00:00:00.000Z",
        },
        "completed",
      ],
    ] as const)(
      "refuses to mark a %s quest draft",
      async ([_, columns, status], { expect }) => {
        const project = await createTestProject(ctx.alepha);
        const quest = await createTestQuest(ctx.alepha, project, columns);

        await expect(
          ctx.controller.draftQuest(
            { params: { id: quest.id } },
            { user: ownerToken(project) },
          ),
        ).rejects.toThrow(
          `Cannot mark quest #Q${quest.shortId} draft: it is "${status}". Only a to-do quest nobody has taken can go back to draft.`,
        );
        expect((await row(quest)).draftAt).toBeUndefined();
      },
    );

    it("refuses both verbs on a quest filed under an epic, naming the epic", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "ready",
      });
      const quest = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
      });
      const user = ownerToken(project);

      await expect(
        ctx.controller.draftQuest({ params: { id: quest.id } }, { user }),
      ).rejects.toThrow(
        `Cannot mark quest #Q${quest.shortId} draft: it belongs to Epic #E${epic.number}, whose status decides.`,
      );
      await expect(
        ctx.controller.readyQuest({ params: { id: quest.id } }, { user }),
      ).rejects.toThrow(
        `Cannot mark quest #Q${quest.shortId} ready: it belongs to Epic #E${epic.number}, whose status decides.`,
      );
    });

    it("refuses to mark ready a quest that is not a draft", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const quest = await createTestQuest(ctx.alepha, project, {
        acceptedAt: "2026-11-01T00:00:00.000Z",
      });

      await expect(
        ctx.controller.readyQuest(
          { params: { id: quest.id } },
          { user: ownerToken(project) },
        ),
      ).rejects.toThrow(
        `Cannot mark quest #Q${quest.shortId} ready: it is "in_progress", not a draft.`,
      );
    });
  });

  describe("what a draft refuses", () => {
    it("refuses accept, assign and hold, saying how to make it ready", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const quest = await create(project, { draft: true });
      const user = ownerToken(project);
      const sentence = (verb: string) =>
        `Cannot ${verb} quest #Q${quest.shortId}: it is a draft, not ready to be taken. Mark it ready first`;

      await expect(
        ctx.controller.acceptQuest({ params: { id: quest.id } }, { user }),
      ).rejects.toThrow(sentence("accept"));
      await expect(
        ctx.controller.assignQuest(
          { params: { id: quest.id }, body: { userId: user.id } },
          { user },
        ),
      ).rejects.toThrow(sentence("assign"));
      await expect(
        ctx.controller.holdQuest(
          { params: { id: quest.id }, body: { reason: "waiting" } },
          { user },
        ),
      ).rejects.toThrow(sentence("hold"));

      const after = await row(quest);
      expect(after.acceptedAt).toBeUndefined();
      expect(after.heldAt).toBeUndefined();
    });

    it("refuses to accept a shelved draft, which reads shelved", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const quest = await create(project, { draft: true });
      const user = ownerToken(project);
      await ctx.controller.shelveQuest({ params: { id: quest.id } }, { user });

      await expect(
        ctx.controller.acceptQuest({ params: { id: quest.id } }, { user }),
      ).rejects.toThrow(
        `Cannot accept quest #Q${quest.shortId}: it is a shelved draft. Unshelve it (quest_unshelve), mark it ready (quest_ready), then accept it.`,
      );
      const after = await row(quest);
      expect(after.acceptedAt).toBeUndefined();
      expect(after.shelvedAt).toBeDefined();
    });

    it("comes back as a draft when unshelved", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const quest = await create(project, { draft: true });
      const user = ownerToken(project);

      const shelved = await ctx.controller.shelveQuest(
        { params: { id: quest.id } },
        { user },
      );
      expect(shelved.metadata.status).toBe("shelved");

      const back = await ctx.controller.unshelveQuest(
        { params: { id: quest.id } },
        { user },
      );
      expect(back.metadata.status).toBe("draft");
    });

    it("accepts once marked ready", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const quest = await create(project, { draft: true });
      const user = ownerToken(project);

      await ctx.controller.readyQuest({ params: { id: quest.id } }, { user });
      const accepted = await ctx.controller.acceptQuest(
        { params: { id: quest.id } },
        { user },
      );

      expect(accepted.metadata.status).toBe("in_progress");
    });

    it("answers complete on a draft with what to do", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const quest = await create(project, { draft: true });

      await expect(
        ctx.controller.completeQuest(
          { params: { id: quest.id }, body: {} },
          { user: ownerToken(project) },
        ),
      ).rejects.toThrow(
        `Cannot complete quest #Q${quest.shortId}: it is a draft, not ready to be taken. Mark it ready first, then complete it.`,
      );
    });

    it("answers complete on an epic's draft with its epic, not Mark it ready", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project);
      const quest = await createTestQuest(ctx.alepha, project, {
        epicId: epic.id,
        draftAt: "2026-11-28T00:00:00.000Z",
      });

      await expect(
        ctx.controller.completeQuest(
          { params: { id: quest.id }, body: {} },
          { user: ownerToken(project) },
        ),
      ).rejects.toThrow(
        `Cannot complete quest #Q${quest.shortId}: it is a draft, because its epic is not marked ready yet. Its quests become ready together when the epic is marked ready (epic_set_status, or lore epic set status).`,
      );
    });
  });

  describe("the status filter", () => {
    it("answers drafts for draft, never the shelf, and To do leaves drafts out", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      await create(project, { title: "Plain" });
      await create(project, { title: "Draft", draft: true });
      const parked = await create(project, { title: "Parked" });
      const parkedDraft = await create(project, {
        title: "Parked draft",
        draft: true,
      });
      const user = ownerToken(project);
      await ctx.controller.shelveQuest({ params: { id: parked.id } }, { user });
      await ctx.controller.shelveQuest(
        { params: { id: parkedDraft.id } },
        { user },
      );

      const titles = async (status: string) =>
        (
          await ctx.controller.getQuests(
            { params: { projectId: project.id }, query: { status } },
            { user },
          )
        ).content
          .map((quest) => quest.title)
          .sort();

      expect(await titles("draft")).toEqual(["Draft"]);
      expect(await titles("todo")).toEqual(["Plain"]);
      expect(await titles("shelved")).toEqual(["Parked", "Parked draft"]);
    });
  });

  describe("how another module sees it", () => {
    it("describes a draft as draft, and a commit naming one says so", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const sha = "d".repeat(40);
      const draft = await create(project, { draft: true });
      await ctx.repos.quests.updateById(draft.id, {
        commits: [
          {
            sha,
            at: "2026-11-28T00:00:00.000Z",
            by: project.createdBy,
          },
        ],
      });

      const described = await ctx.alepha
        .inject(ResourceRegistry)
        .describe("quest", project.id, [String(draft.id)]);
      const referenced = await ctx.alepha
        .inject(CommitReferenceRegistry)
        .questsForCommits(project.id, [sha]);

      expect(described.map((ref) => ref.status)).toEqual(["draft"]);
      expect(referenced.get(sha)?.map((it) => it.status)).toEqual(["draft"]);
    });
  });
});
