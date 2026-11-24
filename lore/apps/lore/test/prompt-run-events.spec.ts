import {
  HostCommandService,
  PromptController,
  PromptRunService,
} from "@lore/core/api";
import { EpicController, QuestController } from "@lore/plan/api";
import { createTestQuest } from "@lore/plan/testing";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type AutomationWorld,
  automationWorld,
} from "./fixtures/automationWorld.ts";

/**
 * Project events for runs (#E174, #Q4276): a job that ends raises
 * `agent.job.succeeded` or `agent.job.failed`, tells the member who started
 * it by hand in-app with no subscription, and nobody else unless they
 * subscribed; and `epic.created`, `epic.ready` and `pull_request.added`.
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
  const end = async (
    jobId: string,
    status: "done" | "failed",
    extra: Record<string, unknown> = {},
  ) => {
    const row = await w.repos.jobs.getOne({ where: { id: { eq: jobId } } });
    const commands = w.alepha.inject(HostCommandService);
    await commands.ack(row.hostId, { id: row.commandId!, status: "running" });
    await commands.ack(row.hostId, {
      id: row.commandId!,
      status,
      ...extra,
    });
  };

  it("tells the member who started a run by hand when it ends, once, and links to the job's page", async ({
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
      starter_id: w.owner.id,
      title: "Weekly status",
    });
    expect(String(event?.fields.url)).toMatch(new RegExp(`/jobs/${jobId}$`));
    await deliver();
    const inbox = await w.repos.inbox.findMany({
      where: { userId: { eq: w.owner.id } },
    });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.title ?? "").toContain("Weekly status succeeded in");

    // Also subscribed: still told once.
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
    expect(
      await w.repos.inbox.findMany({ where: { userId: { eq: w.owner.id } } }),
    ).toHaveLength(2);
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
