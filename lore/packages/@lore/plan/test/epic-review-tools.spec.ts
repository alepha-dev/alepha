import { ProjectController } from "@lore/core/api";
import { Alepha } from "alepha";
import { AuditService } from "alepha/api/audits";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake } from "alepha/testing/faker";
import { describe, it } from "vitest";

import { EpicController, LorePlanApi } from "../src/api/index.ts";
import { EpicTools, LorePlanMcp } from "../src/mcp/index.ts";

/**
 * `epic_review_create`, `epic_review_answer` and the `review` block on
 * `epic_get` (#E121): the agent's half of epic reviews, and the Activity
 * rows each write leaves on the epic.
 */

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(AlephaMcp);
  alepha.with(LorePlanApi);
  alepha.with(LorePlanMcp);

  const tools = alepha.inject(EpicTools);
  const epics = alepha.inject(EpicController);
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  const audits = alepha.inject(AuditService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });

  const asOwner = <R>(fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: owner.id, roles: ["user"] });
      return fn();
    });
  const call = (tool: any, params: Record<string, unknown>) =>
    asOwner(() => tool.execute(params));

  const project = await asOwner(() =>
    projectApi.createProject({ body: { title: "Test" } }),
  );
  const epic = await asOwner(() =>
    epics.createEpic({
      params: { projectId: project.id },
      body: { title: "Epic reviews" },
    }),
  );

  return { alepha, tools, epics, audits, project, epic, owner, call, asOwner };
};

const items = [
  {
    kind: "question",
    title: "Which table holds it?",
    context: "The spec says one, the code two.",
    suggestions: [
      { label: "One table", cost: "a rebuild" },
      { label: "Two tables", cost: "a join" },
    ],
    recommended: 1,
  },
  { kind: "question", title: "Notify the owner?" },
  { kind: "decision", title: "Keep the name.", context: "It shipped." },
  {
    kind: "change",
    title: "Sharpened the first quest.",
    target: { kind: "quest", number: 1 },
  },
];

describe("epic review tools", () => {
  it("files a review in one call and returns each item's number", async ({
    expect,
  }) => {
    const ctx = await setup();

    const result = await ctx.call(ctx.tools.epic_review_create, {
      project: ctx.project.id,
      number: ctx.epic.number,
      summary: "Two questions.",
      items,
    });

    expect(result.items).toEqual([
      { number: 1, kind: "question", title: "Which table holds it?" },
      { number: 2, kind: "question", title: "Notify the owner?" },
      { number: 3, kind: "decision", title: "Keep the name." },
      { number: 4, kind: "change", title: "Sharpened the first quest." },
    ]);

    const second = await ctx.call(ctx.tools.epic_review_create, {
      project: ctx.project.id,
      number: ctx.epic.number,
      items: [],
    });
    expect(second.items).toEqual([]);
  });

  it("inlines the open questions and the decision log on epic_get", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.call(ctx.tools.epic_review_create, {
      project: ctx.project.id,
      number: ctx.epic.number,
      items,
    });
    await ctx.call(ctx.tools.epic_review_answer, {
      project: ctx.project.id,
      number: ctx.epic.number,
      item: 1,
      suggestion: 1,
    });

    const epic = await ctx.call(ctx.tools.epic_get, {
      project: ctx.project.id,
      number: ctx.epic.number,
    });

    expect(epic.review.openQuestions.map((q: any) => q.number)).toEqual([2]);
    expect(epic.review.log).toEqual([
      "1. question: Which table holds it? Answer: Two tables",
      "3. decision: Keep the name.",
    ]);
    expect(epic.review.logOmitted).toBeUndefined();
  });

  it("puts the oldest log entries behind a count past thirty", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.call(ctx.tools.epic_review_create, {
      project: ctx.project.id,
      number: ctx.epic.number,
      items: Array.from({ length: 33 }, (_, i) => ({
        kind: "decision",
        title: `Decision ${i + 1}.`,
      })),
    });

    const epic = await ctx.call(ctx.tools.epic_get, {
      project: ctx.project.id,
      number: ctx.epic.number,
    });

    expect(epic.review.log).toHaveLength(30);
    expect(epic.review.log[0]).toBe("4. decision: Decision 4.");
    expect(epic.review.logOmitted).toBe(3);
  });

  it("answers, waives and overturns by item number", async ({ expect }) => {
    const ctx = await setup();
    await ctx.call(ctx.tools.epic_review_create, {
      project: ctx.project.id,
      number: ctx.epic.number,
      items,
    });
    const ref = { project: ctx.project.id, number: ctx.epic.number };

    expect(
      await ctx.call(ctx.tools.epic_review_answer, {
        ...ref,
        item: 1,
        answer: "Neither.",
      }),
    ).toEqual({ item: 1, outcome: "answered", answer: "Neither." });
    expect(
      await ctx.call(ctx.tools.epic_review_answer, {
        ...ref,
        item: 2,
        waive: true,
      }),
    ).toEqual({ item: 2, outcome: "waived" });
    expect(
      await ctx.call(ctx.tools.epic_review_answer, {
        ...ref,
        item: 3,
        answer: "Rename it.",
      }),
    ).toEqual({
      item: 3,
      outcome: "overturned",
      answer: "Rename it.",
      replacement: 5,
    });
  });

  it("marks an epic ready with questions open, and reports the count", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.call(ctx.tools.epic_review_create, {
      project: ctx.project.id,
      number: ctx.epic.number,
      items,
    });

    const ready = await ctx.call(ctx.tools.epic_set_status, {
      project: ctx.project.id,
      number: ctx.epic.number,
      status: "ready",
    });

    expect(ready.status).toBe("ready");
    expect(ready.openQuestions).toBe(2);

    const back = await ctx.call(ctx.tools.epic_set_status, {
      project: ctx.project.id,
      number: ctx.epic.number,
      status: "draft",
    });
    expect(back.status).toBe("draft");
    expect(back.openQuestions).toBe(2);
  });

  it("refuses both tools once the epic is in progress", async ({ expect }) => {
    const ctx = await setup();
    await ctx.call(ctx.tools.epic_review_create, {
      project: ctx.project.id,
      number: ctx.epic.number,
      items,
    });
    const repo = ctx.alepha.inject(EpicController).epics;
    await repo.updateById(ctx.epic.id, { status: "in_progress" });

    await expect(
      ctx.call(ctx.tools.epic_review_create, {
        project: ctx.project.id,
        number: ctx.epic.number,
        items: [],
      }),
    ).rejects.toThrow(
      `Cannot file a review: Epic #E${ctx.epic.number} is in progress`,
    );
    await expect(
      ctx.call(ctx.tools.epic_review_answer, {
        project: ctx.project.id,
        number: ctx.epic.number,
        item: 1,
        waive: true,
      }),
    ).rejects.toThrow(`Cannot answer item 1: Epic #E${ctx.epic.number}`);
  });

  it("leaves a review row and an answer row on the epic's Activity", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.call(ctx.tools.epic_review_create, {
      project: ctx.project.id,
      number: ctx.epic.number,
      items,
    });
    await ctx.call(ctx.tools.epic_review_answer, {
      project: ctx.project.id,
      number: ctx.epic.number,
      item: 1,
      suggestion: 0,
    });
    await ctx.call(ctx.tools.epic_review_answer, {
      project: ctx.project.id,
      number: ctx.epic.number,
      item: 2,
      answer: "No.",
    });

    const page = await ctx.audits.find({ type: "epic" });
    const rows = (page.content as unknown as Array<Record<string, any>>).filter(
      (row) => row.resourceId === String(ctx.epic.number),
    );
    const reviews = rows.filter((row) => row.action === "review");
    const answers = rows.filter((row) => row.action === "answer");

    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.userId).toBe(ctx.owner.id);
    expect(reviews[0]!.metadata).toMatchObject({
      questions: 2,
      decisions: 1,
      changes: 1,
      items: [1, 2, 3, 4],
    });
    // Two answers, two rows: an answer never coalesces into the last one.
    expect(answers).toHaveLength(2);
    expect(
      answers.map((row) => row.metadata.item).sort((a, b) => a - b),
    ).toEqual([1, 2]);
    expect(
      answers.find((row) => row.metadata.item === 1)!.metadata,
    ).toMatchObject({ outcome: "answered", suggestion: 0 });
  });
});
