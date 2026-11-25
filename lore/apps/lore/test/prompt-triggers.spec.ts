import { HostCommandService } from "@lore/core/api";
import { EpicController, QuestController } from "@lore/plan/api";
import { createTestEpic, createTestQuest } from "@lore/plan/testing";
import { PromptTriggers } from "@lore/prompts/api";
import { DateTimeProvider } from "alepha/datetime";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type AutomationWorld,
  automationWorld,
} from "./fixtures/automationWorld.ts";

/**
 * Triggers on a prompt (#E174, #Q4277), E172's automations moved onto the
 * prompt: events that fill an arg (one run per item) or start one at once,
 * queued behind a running one (#Q4354),
 * a schedule, `check`, the pause and the ceilings, self-disable, and the
 * guards (its own job's events, needs-human, outside text, accepted
 * statuses).
 */
describe("prompt triggers", () => {
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

  const set = (name: string, body: Record<string, unknown>) =>
    w.controller.updatePrompt.run(
      { params: { projectId: w.projectId, name }, body: body as never },
      { user: w.owner },
    );
  const agentJobs = () =>
    w.repos.jobs.findMany({ where: { kind: { eq: "agent" } } });
  const row = (name: string) =>
    w.repos.prompts.getOne({
      where: { projectId: { eq: w.projectId }, name: { eq: name } },
    });
  const project = () =>
    w.entities.projects.getOne({ where: { id: { eq: w.projectId } } });
  const endJob = async (jobId: string, status: "done" | "failed") => {
    const job = await w.repos.jobs.getOne({ where: { id: { eq: jobId } } });
    const commands = w.alepha.inject(HostCommandService);
    await commands.ack(job.hostId, { id: job.commandId!, status: "running" });
    await commands.ack(job.hostId, {
      id: job.commandId!,
      status,
      exitCode: status === "done" ? 0 : 1,
    });
  };

  it("parses the one trigger word, events and a schedule together, and reads it back", ({
    expect,
  }) => {
    const triggers = w.alepha.inject(PromptTriggers);
    expect(
      triggers.parseOn("event:quest.created,feedback.created,weekly@mon@7"),
    ).toEqual({
      eventKeys: ["quest.created", "feedback.created"],
      schedule: "weekly",
      weekday: 1,
      dailyHour: 7,
    });
    expect(triggers.parseOn("daily@7")).toEqual({
      schedule: "daily",
      dailyHour: 7,
    });
    expect(triggers.parseOn("manual")).toEqual({});
    expect(() => triggers.parseOn("weekly@fun@7")).toThrow("A weekday");
    expect(() => triggers.parseOn("sometimes")).toThrow("is no trigger");
    expect(
      triggers.onOf({
        eventKeys: ["epic.ready"],
        schedule: "weekly",
        weekday: 1,
        dailyHour: 7,
      }),
    ).toBe("event:epic.ready,weekly@mon@7");
    // Monday 2026-11-23 07:00 UTC, from a Sunday.
    expect(
      triggers.nextRunAfter(
        { schedule: "weekly", weekday: 1, dailyHour: 7 },
        Date.parse("2026-11-22T10:30:00.000Z"),
      ),
    ).toBe("2026-11-23T07:00:00.000Z");
  });

  it("refuses a trigger that would leave an arg empty, and an unknown event", async ({
    expect,
  }) => {
    await expect(set("work-quest", { on: "daily@7" })).rejects.toThrow(
      "A schedule leaves the arg 'quest' (quest) empty",
    );
    await expect(set("work-quest", { on: "event:epic.ready" })).rejects.toThrow(
      `The event "epic.ready" leaves the arg 'quest' (quest) empty`,
    );
    await expect(
      set("triage", { on: "event:nothing.happened" }),
    ).rejects.toThrow('Unknown event "nothing.happened"');
    const done = await set("work-quest", { on: "event:quest.created" });
    expect(done.on).toBe("event:quest.created");
    // A built-in's trigger is writable: its row exists now.
    expect((await row("work-quest")).builtin).toBe(true);
  });

  it("fills a quest arg from quest.created and runs once per quest, skipping a quest tagged needs-human", async ({
    expect,
  }) => {
    await set("work-quest", { on: "event:quest.created" });
    const quests = w.alepha.inject(QuestController);
    for (const [title, tags] of [
      ["Fix the cart", []],
      ["Fix the login", []],
      ["Decide the pricing", ["needs-human"]],
    ] as const) {
      await quests.createQuest.run(
        {
          body: {
            projectId: w.projectId,
            title,
            description: title,
            area: "general",
            priority: "medium",
            tags: [...tags],
          } as never,
        },
        { user: w.owner },
      );
    }
    await w.drain();
    const jobs = await agentJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs.map((it) => it.cause)).toEqual([
      { kind: "event", event: "quest.created" },
      { kind: "event", event: "quest.created" },
    ]);
    expect(
      jobs
        .map((it) => it.args?.[0]?.title ?? "")
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(["Fix the cart", "Fix the login"]);
    expect((await row("work-quest")).lastSkippedReason).toContain(
      "is tagged needs-human",
    );
  });

  it("starts a prompt without args at once, and queues a burst during its run as one follow-up", async ({
    expect,
  }) => {
    await set("triage", { on: "event:feedback.created" });
    await w.submit("One");
    await w.drain();
    const [first] = await agentJobs();
    expect(first?.input.key?.feedbackIds).toHaveLength(1);
    expect(first?.cause).toEqual({ kind: "event", event: "feedback.created" });

    for (const title of ["Two", "Three", "Four"]) await w.submit(title);
    await w.drain();
    expect(await agentJobs()).toHaveLength(1);
    expect(await w.waiting()).toHaveLength(1);

    await endJob(first!.id, "done");
    await w.drain();
    const jobs = await agentJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs.find((it) => it.id !== first!.id)?.cause).toEqual({
      kind: "event",
      event: "feedback.created",
    });
    expect(await w.waiting()).toHaveLength(0);
  });

  it("runs on its schedule from the hourly check, with its stored arg, claimed once", async ({
    expect,
  }) => {
    const epic = await createTestEpic(w.alepha, await project(), {
      status: "ready",
    });
    await set("work-epic", {
      on: "daily@7",
      argValues: { epic: String(epic.number) },
    });
    const due = (await row("work-epic")).nextRunAt!;
    const triggers = w.alepha.inject(PromptTriggers);
    expect(await triggers.tick(due)).toBe(1);
    expect(await triggers.tick(due)).toBe(0);
    const [job] = await agentJobs();
    expect(job).toMatchObject({
      prompt: "work-epic",
      cause: { kind: "schedule" },
      args: [expect.objectContaining({ value: String(epic.number) })],
    });
    expect((await row("work-epic")).nextRunAt! > due).toBe(true);
  });

  it("runs a choice arg on its first option from a schedule, which stores no value for it (#Q4415)", async ({
    expect,
  }) => {
    await w.controller.createPrompt.run(
      {
        params: { projectId: w.projectId },
        body: {
          name: "release",
          text: "Release with a {{bump.value}} bump.",
          args: [
            {
              name: "bump",
              type: "choice",
              accepts: ["minor", "patch", "major"],
            },
          ],
        } as never,
      },
      { user: w.owner },
    );
    await set("release", { on: "daily@7" });
    const due = (await row("release")).nextRunAt!;
    expect(await w.alepha.inject(PromptTriggers).tick(due)).toBe(1);
    const [job] = await agentJobs();
    expect(job).toMatchObject({
      prompt: "release",
      cause: { kind: "schedule" },
      args: [expect.objectContaining({ name: "bump", value: "minor" })],
    });

    // A stored value outside the options is refused when the trigger is set.
    await expect(
      set("release", { on: "daily@7", argValues: { bump: "huge" } }),
    ).rejects.toThrow("is one of minor, patch, major, not 'huge'");
  });

  it("runs a choice arg on its first option from an event, beside the item the event fills (#Q4415)", async ({
    expect,
  }) => {
    await w.controller.createPrompt.run(
      {
        params: { projectId: w.projectId },
        body: {
          name: "size-feedback",
          text: "Size {{feedback.reference}} as {{size.value}}.",
          args: [
            { name: "feedback", type: "feedback" },
            { name: "size", type: "choice", accepts: ["small", "large"] },
          ],
        } as never,
      },
      { user: w.owner },
    );
    await set("size-feedback", { on: "event:feedback.created" });
    await w.submit("One");
    await w.drain();
    const [job] = await agentJobs();
    expect(job).toMatchObject({
      prompt: "size-feedback",
      cause: { kind: "event", event: "feedback.created" },
    });
    expect(job?.args).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "size", value: "small" }),
      ]),
    );
  });

  it("checks for work first, and skips while paused, recording why", async ({
    expect,
  }) => {
    await set("work-loose-quests", { on: "hourly", check: ["quests"] });
    const triggers = w.alepha.inject(PromptTriggers);
    const due = (await row("work-loose-quests")).nextRunAt!;
    expect(await triggers.tick(due)).toBe(0);
    expect((await row("work-loose-quests")).lastSkippedReason).toBe(
      "Nothing to do",
    );

    await createTestQuest(w.alepha, await project(), { title: "Loose" });
    await w.controller.setPromptsPaused.run(
      { params: { projectId: w.projectId }, body: { paused: true } },
      { user: w.owner },
    );
    const next = (await row("work-loose-quests")).nextRunAt!;
    expect(await triggers.tick(next)).toBe(0);
    expect((await row("work-loose-quests")).lastSkippedReason).toContain(
      "paused",
    );
    await w.controller.setPromptsPaused.run(
      { params: { projectId: w.projectId }, body: { paused: false } },
      { user: w.owner },
    );
    const then = (await row("work-loose-quests")).nextRunAt!;
    expect(await triggers.tick(then)).toBe(1);
  });

  it("stops at its ceiling with prompt.ceiling.reached once, and disables itself after three failed runs in a row", async ({
    expect,
  }) => {
    await set("security-check", { on: "hourly", maxRunsPerHour: 1 });
    const triggers = w.alepha.inject(PromptTriggers);
    const events = (name: string) =>
      w.repos.events.findMany({ where: { name: { eq: name } } });
    const tick = async () =>
      triggers.tick((await row("security-check")).nextRunAt!);

    expect(await tick()).toBe(1);
    const [first] = await agentJobs();
    await endJob(first!.id, "failed");
    expect(await tick()).toBe(0);
    expect(await tick()).toBe(0);
    expect(await events("prompt.ceiling.reached")).toHaveLength(1);

    await set("security-check", { maxRunsPerHour: 60 });
    for (let i = 0; i < 2; i++) {
      expect(await tick()).toBe(1);
      const running = (await agentJobs()).find(
        (it) => it.status === "queued" || it.status === "running",
      );
      await endJob(running!.id, "failed");
    }
    const disabled = await row("security-check");
    expect(disabled.enabled).toBe(false);
    expect(disabled.consecutiveFailures).toBe(3);
    expect(disabled.lastSkippedReason).toContain(
      "Disabled after 3 failed runs",
    );
    expect(await events("prompt.disabled")).toHaveLength(1);
    expect(await tick()).toBe(0);
  });

  it("records a skip for an item its arg does not accept, never a run", async ({
    expect,
  }) => {
    await set("review-epic", { on: "event:epic.ready" });
    const epics = w.alepha.inject(EpicController);
    const epic = await epics.createEpic.run(
      { params: { projectId: w.projectId }, body: { title: "Cart flow" } },
      { user: w.owner },
    );
    await epics.setEpicStatus.run(
      { params: { id: epic.id }, body: { status: "ready" } },
      { user: w.owner },
    );
    await w.drain();
    // review-epic accepts a draft or ready epic: a ready one runs.
    expect(await agentJobs()).toHaveLength(1);

    await set("work-epic", { on: "event:epic.created" });
    await epics.createEpic.run(
      { params: { projectId: w.projectId }, body: { title: "Second" } },
      { user: w.owner },
    );
    await w.drain();
    // work-epic does not accept a draft: a recorded skip.
    expect(await agentJobs()).toHaveLength(1);
    expect((await row("work-epic")).lastSkippedReason).toContain(
      "accepts a epic ready or in_progress",
    );
  });
});
