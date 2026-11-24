import { FeedbackController } from "@lore/plan/api";
import { DateTimeProvider } from "alepha/datetime";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type AutomationWorld,
  automationWorld,
} from "./fixtures/automationWorld.ts";

/**
 * The event trigger of an agent automation (#Q4227): a second consumer of
 * project events beside the subscriptions, coalesced (a settle delay, one
 * follow-up run when the job ends), never triggered by its own jobs, and run
 * as its owner with the event's job as its parent.
 */
describe("agent automations on project events", () => {
  let w: AutomationWorld;
  let time: DateTimeProvider;
  beforeEach(async () => {
    w = await automationWorld();
    time = w.alepha.inject(DateTimeProvider);
    time.pause();
  });
  afterEach(async () => {
    await w.stop();
  });

  const listen = (name: string, events: string[], settleSeconds = 60) =>
    w.controller.createProjectAutomation.run(
      {
        params: { projectId: w.projectId },
        body: {
          name,
          promptKind: "triage",
          trigger: "event",
          eventKeys: events,
          settleSeconds,
        },
      },
      { user: w.owner },
    );
  const agentJobs = () =>
    w.repos.jobs.findMany({ where: { kind: { eq: "agent" } } });

  it("hears an event nobody subscribed to, and runs once the burst settled", async ({
    expect,
  }) => {
    const automation = await listen("triage", ["feedback.created"]);
    for (const title of ["One", "Two", "Three", "Four", "Five"]) {
      await w.submit(title);
    }
    await w.drain();

    // One settle job for the five, waiting out its minute.
    expect(await w.waiting()).toHaveLength(1);
    expect(await agentJobs()).toHaveLength(0);
    expect((await w.repos.automations.getById(automation.id)).pending).toBe(
      true,
    );

    await time.travel(61, "seconds");
    await w.drain();
    const jobs = await agentJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      automationId: automation.id,
      startedBy: w.owner.id,
      subjectType: "feedback-inbox",
    });
    // The five items in one prompt.
    expect(jobs[0]?.input.key?.feedbackIds).toHaveLength(5);
    expect((await w.repos.automations.getById(automation.id)).pending).toBe(
      false,
    );
  });

  it("runs one follow-up when the job ends, for what arrived while it ran", async ({
    expect,
  }) => {
    await listen("triage", ["feedback.created"], 0);
    await w.submit("First");
    await w.drain();
    const [first] = await agentJobs();
    expect(first).toBeDefined();

    // Three more while the first job is queued: no second job yet.
    for (const title of ["A", "B", "C"]) await w.submit(title);
    await w.drain();
    expect(await agentJobs()).toHaveLength(1);

    await w.finish(first!.id);
    await w.drain();
    const jobs = await agentJobs();
    expect(jobs).toHaveLength(2);
    // One follow-up over the inbox: the three, and the first item, which
    // the first job left pending.
    expect(
      jobs.find((job) => job.id !== first!.id)?.input.key?.feedbackIds,
    ).toHaveLength(4);

    // Nothing pending: the second job's end starts nothing.
    const second = jobs.find((job) => job.id !== first!.id)!;
    await w.finish(second.id);
    await w.drain();
    expect(await agentJobs()).toHaveLength(2);
  });

  it("is never triggered by its own job's events, and records the job that raised an event", async ({
    expect,
  }) => {
    const self = await w.controller.createProjectAutomation.run(
      {
        params: { projectId: w.projectId },
        body: {
          name: "planner",
          promptKind: "text",
          promptText: "File the quests the week needs.",
          trigger: "event",
          eventKeys: ["quest.created"],
          settleSeconds: 0,
        },
      },
      { user: w.owner },
    );
    const run = await w.controller.runProjectAutomation.run(
      { params: { projectId: w.projectId, automation: "planner" } },
      { user: w.owner },
    );
    const jobId = run.jobIds[0]!;
    const key = await w.keyOf(jobId);

    // The job files a quest through Lore's MCP, with its own key.
    const answer = await w.mcp(key, "quest_create", {
      project: w.projectId,
      title: "Write the release notes",
      description: "For the next release.",
      area: "docs",
      priority: "medium",
    });
    expect(answer.result?.isError).not.toBe(true);
    const [event] = await w.repos.events.findMany({
      where: { name: { eq: "quest.created" } },
    });
    expect(event?.jobId).toBe(jobId);

    // Delivered: the automation heard it, and asked for nothing.
    await w.drain(["project-events.deliver"]);
    expect((await w.repos.automations.getById(self.id)).pending).toBe(false);
    expect(
      await w.repos.executions.findMany({
        where: { jobName: { eq: "agent-automations.settle" } },
      }),
    ).toHaveLength(0);
    await w.finish(jobId);
    await w.drain();
    expect(await agentJobs()).toHaveLength(1);
  });

  it("runs another automation as its owner, the event's job as its parent, which the chain guard reads", async ({
    expect,
  }) => {
    await w.controller.createProjectAutomation.run(
      {
        params: { projectId: w.projectId },
        body: { name: "writer", promptKind: "text", promptText: "Plan." },
      },
      { user: w.owner },
    );
    const listener = await w.controller.createProjectAutomation.run(
      {
        params: { projectId: w.projectId },
        body: {
          name: "follower",
          promptKind: "text",
          promptText: "Look at the new quest.",
          trigger: "event",
          eventKeys: ["quest.created"],
          settleSeconds: 0,
        },
      },
      { user: w.owner },
    );
    const run = await w.controller.runProjectAutomation.run(
      { params: { projectId: w.projectId, automation: "writer" } },
      { user: w.owner },
    );
    const jobId = run.jobIds[0]!;
    await w.mcp(await w.keyOf(jobId), "quest_create", {
      project: w.projectId,
      title: "A quest an agent filed",
      description: "Filed by a job.",
      area: "docs",
      priority: "medium",
    });
    await w.drain(["project-events.deliver"]);
    expect((await w.repos.automations.getById(listener.id)).pendingJobId).toBe(
      jobId,
    );

    await w.drain();
    // An agent job's output never starts another agent job of its chain:
    // the follower was asked, with the writer's job as its parent, and
    // refused.
    expect(await agentJobs()).toHaveLength(1);
    const row = await w.repos.automations.getById(listener.id);
    expect(row.pending).toBe(false);
    expect(row.lastJobId).toBeUndefined();
  });

  it("starts a triage when a member trusts an item written outside the team", async ({
    expect,
  }) => {
    const automation = await listen("triage", ["feedback.trusted"], 0);
    const item = await w.repos.feedback.create({
      projectId: w.projectId,
      shortId: 41,
      title: "Outside report",
      description: "Something is off.",
      status: "pending",
      untrusted: true,
    });
    await w.alepha
      .inject(FeedbackController)
      .trustFeedback.fetch(
        { params: { projectId: w.projectId, feedbackId: item.id } },
        { user: w.owner },
      );
    const [event] = await w.repos.events.findMany({
      where: { name: { eq: "feedback.trusted" } },
    });
    expect(event).toMatchObject({
      subjectId: "41",
      fields: { shortId: 41, reference: "#P41", trusted_by: w.owner.id },
    });
    await w.drain();
    const [job] = await agentJobs();
    expect(job).toMatchObject({ automationId: automation.id });
    expect(job?.input.key?.feedbackIds).toEqual([41]);
  });

  it("refuses an event automation with no event, or an event the catalog lacks", async ({
    expect,
  }) => {
    await expect(listen("none", [])).rejects.toThrow(
      "names the project events it listens to",
    );
    await expect(listen("typo", ["feedback.creatd"])).rejects.toThrow(
      "No project event feedback.creatd",
    );
  });
});
