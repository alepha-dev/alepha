import { HostCommandService } from "@lore/core/api";
import { createTestQuest } from "@lore/plan/testing";
import { PromptRunService } from "@lore/prompts/api";
import { DateTimeProvider } from "alepha/datetime";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type AutomationWorld,
  automationWorld,
} from "./fixtures/automationWorld.ts";

/**
 * A job that ends unfinished says so on its quests (#Q4341): each quest it
 * accepted and left open gets a comment naming the job and how it ended,
 * and stays in progress for a rerun to continue.
 */
describe("an agent job that ends unfinished", () => {
  let w: AutomationWorld;
  beforeEach(async () => {
    w = await automationWorld();
  });
  afterEach(async () => {
    await w.stop();
  });

  const start = async () => {
    const { jobId } = await w.alepha
      .inject(PromptRunService)
      .run(w.projectId, w.owner, "work-loose-quests", {});
    const row = await w.repos.jobs.getOne({ where: { id: { eq: jobId } } });
    await w.alepha
      .inject(HostCommandService)
      .ack(row.hostId, { id: row.commandId!, status: "running" });
    return w.repos.jobs.getOne({ where: { id: { eq: jobId } } });
  };
  const end = async (
    jobId: string,
    status: "done" | "timed_out" | "failed" | "cancelled",
  ) => {
    const row = await w.repos.jobs.getOne({ where: { id: { eq: jobId } } });
    await w.alepha.inject(HostCommandService).ack(row.hostId, {
      id: row.commandId!,
      status,
      ...(status === "done" ? { exitCode: 0 } : {}),
      ...(status === "timed_out"
        ? { warning: "kept acme/job-1, 3 uncommitted change(s)" }
        : {}),
    });
  };
  // A quest the job's key accepted: in progress, its `quest.assigned` event
  // carrying the job's id, as `ProjectEvents` records it.
  const acceptedBy = async (jobId: string | undefined, done = false) => {
    const project = await w.entities.projects.getOne({
      where: { id: { eq: w.projectId } },
    });
    const now = new Date(
      w.alepha.inject(DateTimeProvider).nowMillis() + 1000,
    ).toISOString();
    const quest = await createTestQuest(w.alepha, project, {
      acceptedAt: now,
      acceptedBy: w.owner.id,
      ...(done ? { completedAt: now } : {}),
    });
    if (jobId) {
      await w.repos.events.create({
        projectId: w.projectId,
        name: "quest.assigned",
        subjectKind: "quest",
        subjectId: String(quest.shortId),
        fields: {},
        actorId: w.owner.id,
        jobId,
        occurredAt: now,
      });
    }
    return quest;
  };
  const commentsOn = (questId: number) =>
    w.repos.comments.findMany({
      where: { subjectType: { eq: "quest" }, subjectId: { eq: questId } },
    });

  it("comments on each quest a timed-out job accepted and left open, and on no other", async ({
    expect,
  }) => {
    const job = await start();
    const open = await acceptedBy(job.id);
    const completed = await acceptedBy(job.id, true);
    const byHand = await acceptedBy(undefined);
    await end(job.id, "timed_out");

    const [comment, ...more] = await commentsOn(open.id);
    expect(more).toEqual([]);
    expect(comment).toMatchObject({
      authorId: w.owner.id,
      source: { kind: "mcp", client: "lore-jobs" },
    });
    expect(comment?.body).toContain(
      `Job \`${job.id.slice(0, 8)}\`, the work-loose-quests job that accepted this quest, timed out`,
    );
    expect(comment?.body).toContain("kept acme/job-1, 3 uncommitted change(s)");
    expect(comment?.body).toContain("stays in progress");
    const quest = await w.repos.quests.getOne({
      where: { id: { eq: open.id } },
    });
    expect(quest.acceptedAt).toBeDefined();
    expect(quest.completedAt).toBeUndefined();
    expect(await commentsOn(completed.id)).toEqual([]);
    expect(await commentsOn(byHand.id)).toEqual([]);
  });

  it("says nothing when the job succeeded", async ({ expect }) => {
    const job = await start();
    const open = await acceptedBy(job.id);
    await end(job.id, "done");
    expect(await commentsOn(open.id)).toEqual([]);
  });

  it("names a cancel and a failure", async ({ expect }) => {
    const cancelled = await start();
    const first = await acceptedBy(cancelled.id);
    await end(cancelled.id, "cancelled");
    expect((await commentsOn(first.id))[0]?.body).toContain("was cancelled");

    const failed = await start();
    const second = await acceptedBy(failed.id);
    await end(failed.id, "failed");
    expect((await commentsOn(second.id))[0]?.body).toContain(", failed");
  });
});
