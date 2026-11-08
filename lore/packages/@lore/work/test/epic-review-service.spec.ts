import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  EpicController,
  EpicReviewService,
  LoreWorkApi,
} from "../src/api/index.ts";
import {
  createTestEpic,
  createTestProject,
  WorkTestEntities,
} from "../src/testing/index.ts";

/**
 * Epic reviews (#E121): the service under the two tables. Filing a review in
 * one call, per-epic numbering across reviews, answering, waiving and
 * overturning, the status lock, and an epic's deletion taking its reviews.
 */

interface TestContext {
  alepha: Alepha;
  service: EpicReviewService;
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
  alepha.with(LoreWorkApi);
  const repos = alepha.inject(WorkTestEntities);
  await alepha.start();
  return { alepha, service: alepha.inject(EpicReviewService), repos };
};

const ownerToken = (project: { createdBy: string }): UserAccountToken => ({
  id: project.createdBy,
  roles: ["user"],
});

describe("EpicReviewService", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const review = (title = "Which table?") => ({
    summary: "Two questions and a call.",
    items: [
      {
        kind: "question" as const,
        title,
        context: "The spec says X, the code says Y.",
        suggestions: [
          { label: "Take A", cost: "one table" },
          { label: "Take B", cost: "two tables" },
        ],
        recommended: 0,
      },
      {
        kind: "decision" as const,
        title: "Keep the old name.",
        context: "It ships.",
      },
      {
        kind: "change" as const,
        title: "Sharpened the quest.",
        target: { kind: "quest" as const, number: 12 },
      },
    ],
  });

  describe("create", () => {
    it("files a review with every item in one call, numbered from 1", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project);

      const filed = await ctx.service.create(
        epic,
        ownerToken(project),
        review(),
      );

      expect(filed.review.summary).toBe("Two questions and a call.");
      expect(filed.review.createdBy).toBe(project.createdBy);
      expect(filed.items.map((item) => item.number)).toEqual([1, 2, 3]);
      expect(filed.items.map((item) => item.state)).toEqual([
        "open",
        undefined,
        undefined,
      ]);
      expect(filed.items[2]!.target).toEqual({ kind: "quest", number: 12 });
    });

    it("numbers items per epic, continuing across reviews", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project);
      const other = await createTestEpic(ctx.alepha, project);

      await ctx.service.create(epic, undefined, review());
      const second = await ctx.service.create(epic, undefined, review());
      const elsewhere = await ctx.service.create(other, undefined, review());

      expect(second.items.map((item) => item.number)).toEqual([4, 5, 6]);
      expect(elsewhere.items.map((item) => item.number)).toEqual([1, 2, 3]);
    });

    it("files an empty review", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project, {
        status: "ready",
      });

      const filed = await ctx.service.create(epic, undefined, { items: [] });

      expect(filed.items).toEqual([]);
      expect(await ctx.service.reviewsOf(epic.id)).toHaveLength(1);
    });

    it("refuses a recommendation past the suggestions, writing nothing", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project);

      await expect(
        ctx.service.create(epic, undefined, {
          items: [
            {
              kind: "question",
              title: "Which?",
              suggestions: [{ label: "A" }],
              recommended: 1,
            },
          ],
        }),
      ).rejects.toThrow("Item 1 of the review recommends suggestion 1");
      expect(await ctx.service.reviewsOf(epic.id)).toHaveLength(0);
    });

    it("refuses a target on anything but a change", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project);

      await expect(
        ctx.service.create(epic, undefined, {
          items: [
            {
              kind: "decision",
              title: "Done.",
              target: { kind: "epic", number: 1 },
            },
          ],
        }),
      ).rejects.toThrow("only a change names the quest or epic it touched");
    });
  });

  describe("the status lock", () => {
    for (const status of ["in_progress", "completed", "shelved"] as const) {
      it(`refuses filing and answering on a ${status} epic`, async ({
        expect,
      }) => {
        const project = await createTestProject(ctx.alepha);
        const epic = await createTestEpic(ctx.alepha, project, {
          status: "ready",
        });
        await ctx.service.create(epic, undefined, review());
        const locked = await ctx.repos.epics.updateById(epic.id, { status });

        await expect(
          ctx.service.create(locked, undefined, review()),
        ).rejects.toThrow(
          `Cannot file a review: Epic #E${epic.number} is ${status === "in_progress" ? "in progress" : status}`,
        );
        await expect(
          ctx.service.answer(locked, 1, undefined, { answer: "A" }),
        ).rejects.toThrow(`Cannot answer item 1: Epic #E${epic.number}`);
        expect((await ctx.service.get(locked, 1)).state).toBe("open");
      });
    }
  });

  describe("answer", () => {
    it("answers a question by suggestion, recording who and when", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project);
      await ctx.service.create(epic, undefined, review());

      const result = await ctx.service.answer(epic, 1, ownerToken(project), {
        suggestion: 1,
      });

      expect(result.outcome).toBe("answered");
      expect(result.item.state).toBe("answered");
      expect(result.item.answer).toBe("Take B");
      expect(result.item.answerSuggestion).toBe(1);
      expect(result.item.answeredBy).toBe(project.createdBy);
      expect(result.item.answeredAt).toBeDefined();
      expect(await ctx.service.countOpenQuestions(epic.id)).toBe(0);
    });

    it("answers a question with the owner's own text", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project);
      await ctx.service.create(epic, undefined, review());

      const result = await ctx.service.answer(epic, 1, undefined, {
        answer: "Neither: C.",
      });

      expect(result.item.answer).toBe("Neither: C.");
      expect(result.item.answerSuggestion).toBeUndefined();
    });

    it("waives a question, which leaves the log", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project);
      await ctx.service.create(epic, undefined, review());

      const result = await ctx.service.answer(epic, 1, undefined, {
        waive: true,
      });

      expect(result.outcome).toBe("waived");
      expect(result.item.state).toBe("waived");
      expect((await ctx.service.logOf(epic.id)).map((i) => i.number)).toEqual([
        2,
      ]);
    });

    it("overturns a decision with a new one naming it", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project);
      await ctx.service.create(epic, undefined, review());

      const result = await ctx.service.answer(epic, 2, ownerToken(project), {
        answer: "Rename it.",
      });

      expect(result.outcome).toBe("overturned");
      expect(result.item.replacedBy).toBe(4);
      expect(result.replacement?.number).toBe(4);
      expect(result.replacement?.replaces).toBe(2);
      expect(result.replacement?.title).toBe("Rename it.");
      expect(result.replacement?.createdBy).toBe(project.createdBy);
      expect((await ctx.service.logOf(epic.id)).map((i) => i.number)).toEqual([
        4,
      ]);

      await expect(
        ctx.service.answer(epic, 2, undefined, { answer: "Again." }),
      ).rejects.toThrow("item 4 already replaced it. Overturn item 4 instead.");
    });

    it("refuses to waive a decision or answer a change", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project);
      await ctx.service.create(epic, undefined, review());

      await expect(
        ctx.service.answer(epic, 2, undefined, { waive: true }),
      ).rejects.toThrow("it is a decision");
      await expect(
        ctx.service.answer(epic, 3, undefined, { answer: "No." }),
      ).rejects.toThrow("it is a change the review made");
    });

    it("refuses an answer that is not exactly one thing", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project);
      await ctx.service.create(epic, undefined, review());

      await expect(ctx.service.answer(epic, 1, undefined, {})).rejects.toThrow(
        "exactly one of",
      );
      await expect(
        ctx.service.answer(epic, 1, undefined, { answer: "A", waive: true }),
      ).rejects.toThrow("exactly one of");
      await expect(
        ctx.service.answer(epic, 1, undefined, { suggestion: 5 }),
      ).rejects.toThrow("there is no suggestion 5");
      await expect(
        ctx.service.answer(epic, 99, undefined, { answer: "A" }),
      ).rejects.toThrow(`Epic #E${epic.number} has no review item 99.`);
    });
  });

  describe("counts", () => {
    it("counts open questions per epic of a project in one read", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project);
      const other = await createTestEpic(ctx.alepha, project);
      const quiet = await createTestEpic(ctx.alepha, project);
      await ctx.service.create(epic, undefined, review());
      await ctx.service.create(epic, undefined, review());
      await ctx.service.create(other, undefined, review());
      await ctx.service.answer(other, 1, undefined, { waive: true });

      const counts = await ctx.service.countOpenQuestionsOfProject(project.id);

      expect(counts.get(epic.id)).toBe(2);
      expect(counts.has(other.id)).toBe(false);
      expect(counts.has(quiet.id)).toBe(false);
    });
  });

  describe("deleting an epic", () => {
    it("deletes its reviews and items before the epic", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project);
      const kept = await createTestEpic(ctx.alepha, project);
      await ctx.service.create(epic, undefined, review());
      await ctx.service.create(kept, undefined, review());

      await ctx.alepha
        .inject(EpicController)
        .deleteEpic({ params: { id: epic.id } }, { user: ownerToken(project) });

      expect(
        await ctx.repos.epicReviews.count({ epicId: { eq: epic.id } }),
      ).toBe(0);
      expect(
        await ctx.repos.epicReviewItems.count({ epicId: { eq: epic.id } }),
      ).toBe(0);
      expect(
        await ctx.repos.epicReviewItems.count({ epicId: { eq: kept.id } }),
      ).toBe(3);
    });
  });
});
