import { HostCommandService } from "@lore/core/api";
import { EpicController, QuestController } from "@lore/plan/api";
import { createTestQuest } from "@lore/plan/testing";
import { PromptController, PromptRunService } from "@lore/prompts/api";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type AutomationWorld,
  automationWorld,
} from "./fixtures/automationWorld.ts";

/**
 * Project events for runs (#E174, #Q4276): a job that ends raises
 * `agent.job.succeeded` or `agent.job.failed`, which tell a member only
 * through a subscription, the one who started it by hand included (#Q4307);
 * and `epic.created`, `epic.ready` and `pull_request.added`.
 */
describe("prompt run events", () => {
  let w: AutomationWorld;
  beforeEach(async () => {
    w = await automationWorld();
    // A real account, as delivery reads it: enabled, with its roles.
    await w.entities.users.updateById(w.owner.id, {
      roles: ["user"],
      enabled: true,
    } as never);
  });
  afterEach(async () => {
    await w.stop();
  });

  const events = (name: string) =>
    w.repos.events.findMany({
      where: { projectId: { eq: w.projectId }, name: { eq: name } },
    });
  const deliver = () =>
    w.drain(["project-events.deliver", "system.notifications.send"]);
  // A run that starts answers its job; none here waits behind another.
  const end = async (
    jobId: string | undefined,
    status: "done" | "failed" | "timed_out" | "cancelled",
    extra: Record<string, unknown> = {},
  ) => {
    const row = await w.repos.jobs.getOne({
      where: { id: { eq: jobId as string } },
    });
    const commands = w.alepha.inject(HostCommandService);
    await commands.ack(row.hostId, { id: row.commandId!, status: "running" });
    await commands.ack(row.hostId, {
      id: row.commandId!,
      status,
      ...extra,
    });
  };

  it("tells nobody of a run by hand without a subscription, not even its starter, and a subscriber once, linking to the job's page (#Q4307)", async ({
    expect,
  }) => {
    const { jobId } = await w.alepha
      .inject(PromptRunService)
      .run(w.projectId, w.owner, "weekly-status", {});
    await end(jobId, "done", {
      exitCode: 0,
      result: "Shipped two quests.\n\nMore below.",
    });
    const [event] = await events("agent.job.succeeded");
    expect(event?.fields).toMatchObject({
      job_id: jobId,
      prompt: "weekly-status",
      cause: "hand",
      reply: "Shipped two quests.",
      // Still a field, never an implicit recipient.
      starter_id: w.owner.id,
    });
    expect(String(event?.fields.title)).toMatch(/^Weekly status/);
    expect(String(event?.fields.url)).toMatch(new RegExp(`/jobs/${jobId}$`));
    await deliver();
    expect(
      await w.repos.inbox.findMany({ where: { userId: { eq: w.owner.id } } }),
    ).toHaveLength(0);

    // Subscribed: told, once.
    await w.repos.subscriptions.create({
      projectId: w.projectId,
      key: `member:${w.owner.id}:agent.job.failed`,
      event: "agent.job.failed",
      memberId: w.owner.id,
      channels: ["inapp"],
    } as never);
    const second = await w.alepha
      .inject(PromptRunService)
      .run(w.projectId, w.owner, "security-check", {});
    await end(second.jobId, "failed", { exitCode: 1 });
    expect(await events("agent.job.failed")).toHaveLength(1);
    await deliver();
    const inbox = await w.repos.inbox.findMany({
      where: { userId: { eq: w.owner.id } },
    });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.title ?? "").toContain("Security check failed in");
    expect(inbox[0]?.href ?? "").toMatch(new RegExp(`/jobs/${second.jobId}$`));
  });

  it("tells nobody of a triggered run's end unless someone subscribed, and a cancelled job raises nothing", async ({
    expect,
  }) => {
    const { jobId } = await w.alepha
      .inject(PromptRunService)
      .run(w.projectId, w.owner, "weekly-status", {}, { kind: "schedule" });
    await end(jobId, "done", { exitCode: 0 });
    const [event] = await events("agent.job.succeeded");
    expect(event?.fields.starter_id).toBeUndefined();
    expect(event?.fields.cause).toBe("schedule");
    await deliver();
    expect(
      await w.repos.inbox.findMany({ where: { userId: { eq: w.owner.id } } }),
    ).toHaveLength(0);
  });

  it("logs a failed or timed-out job at error level, one stable message per prompt and kind, and nothing for a success or a cancel (#Q4329)", async ({
    expect,
  }) => {
    // Every entry logged at error level: what the app's sigil files in
    // Errors (`SigilServerErrors`).
    const logged: { message: string; data: unknown }[] = [];
    w.alepha.events.on("log:entry", ({ entry }) => {
      if (entry.level === "ERROR")
        logged.push({ message: String(entry.message), data: entry.data });
    });
    const runs = w.alepha.inject(PromptRunService);
    const outcomes = [
      ["done", { exitCode: 0 }],
      ["cancelled", {}],
      ["failed", { exitCode: 1, reason: "exit code 1" }],
      ["timed_out", { reason: "the job ran past its 7200 s timeout" }],
      ["timed_out", {}],
    ] as const;
    const jobIds: string[] = [];
    for (const [status, extra] of outcomes) {
      const { jobId } = await runs.run(
        w.projectId,
        w.owner,
        "weekly-status",
        {},
      );
      jobIds.push(jobId!);
      await end(jobId, status, extra);
    }

    expect(logged.map((it) => it.message)).toEqual([
      "Agent job weekly-status failed",
      "Agent job weekly-status timed out",
      "Agent job weekly-status timed out",
    ]);
    expect(logged[1]?.data).toMatchObject({
      jobId: jobIds[3],
      prompt: "weekly-status",
      status: "timed_out",
      reason: "the job ran past its 7200 s timeout",
    });
  });

  it("raises epic.created, epic.ready, and pull_request.added once per pull request", async ({
    expect,
  }) => {
    const epics = w.alepha.inject(EpicController);
    const epic = await epics.createEpic.run(
      { params: { projectId: w.projectId }, body: { title: "Cart flow" } },
      { user: w.owner },
    );
    const [created] = await events("epic.created");
    expect(created?.fields).toMatchObject({
      shortId: epic.number,
      actor_id: w.owner.id,
    });
    await epics.setEpicStatus.run(
      { params: { id: epic.id }, body: { status: "ready" } },
      { user: w.owner },
    );
    expect(await events("epic.ready")).toHaveLength(1);

    const project = await w.entities.projects.getOne({
      where: { id: { eq: w.projectId } },
    });
    const quest = await createTestQuest(w.alepha, project);
    const url = "https://github.com/acme/web/pull/42";
    const quests = w.alepha.inject(QuestController);
    await quests.addQuestPullRequest.run(
      { params: { id: quest.id }, body: { url } },
      { user: w.owner },
    );
    await epics.addEpicPullRequest.run(
      { params: { id: epic.id }, body: { url } },
      { user: w.owner },
    );
    const added = await events("pull_request.added");
    expect(added).toHaveLength(1);
    expect(added[0]?.fields).toMatchObject({
      number: 42,
      repository: "https://github.com/acme/web",
      pull_request_url: url,
      quest_shortId: quest.shortId,
    });
    expect(added[0]?.subjectId).toBe("42");
    expect(w.alepha.inject(PromptController)).toBeDefined();
  });
});
