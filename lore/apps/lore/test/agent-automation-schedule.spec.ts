import { AgentAutomationSchedule } from "@lore/core/api";
import { QuestService } from "@lore/plan/api";
import { DateTimeProvider } from "alepha/datetime";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type AutomationWorld,
  automationWorld,
} from "./fixtures/automationWorld.ts";

/**
 * The schedule trigger and "only if there is something" (#Q4228): a check
 * of the hourly job on `nextRunAt`, claimed once, and a plain query before
 * any job is queued, so an idle project spends no tokens.
 */
describe("agent automations on a schedule, only if there is something", () => {
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

  const create = (body: Record<string, unknown>) =>
    w.controller.createProjectAutomation.run(
      {
        params: { projectId: w.projectId },
        body: { name: "triage", promptKind: "triage", ...body } as never,
      },
      { user: w.owner },
    );
  const agentJobs = () =>
    w.repos.jobs.findMany({ where: { kind: { eq: "agent" } } });
  const tick = (at: string) => w.alepha.inject(AgentAutomationSchedule).run(at);

  it("runs on the hour in UTC: every hour, every six hours, or a daily hour", ({
    expect,
  }) => {
    const at = new Date("2026-11-24T09:34:00.000Z").getTime();
    const next = (schedule: string, dailyHour?: number) =>
      w.service.nextRunAfter({ schedule, dailyHour } as never, at);
    expect(next("hourly")).toBe("2026-11-24T10:00:00.000Z");
    expect(next("6h")).toBe("2026-11-24T12:00:00.000Z");
    expect(next("daily", 7)).toBe("2026-11-25T07:00:00.000Z");
    expect(next("daily", 22)).toBe("2026-11-24T22:00:00.000Z");
    // On the hour itself, the next one.
    expect(
      w.service.nextRunAfter(
        { schedule: "hourly" } as never,
        new Date("2026-11-24T10:00:00.000Z").getTime(),
      ),
    ).toBe("2026-11-24T11:00:00.000Z");
  });

  it("skips an empty inbox without a job, says why on its row, and runs once there is something", async ({
    expect,
  }) => {
    const automation = await create({
      trigger: "schedule",
      schedule: "hourly",
      onlyIfWork: true,
    });
    expect(automation.nextRunAt).toBeDefined();
    const due = automation.nextRunAt!;

    expect(await tick(due)).toBe(0);
    let row = await w.repos.automations.getById(automation.id);
    expect(row.lastSkippedReason).toBe("Nothing to do");
    expect(row.lastSkippedAt).toBeDefined();
    expect(row.nextRunAt! > due).toBe(true);
    expect(await agentJobs()).toHaveLength(0);

    await w.file();
    expect(await tick(row.nextRunAt!)).toBe(1);
    // Claimed once: the same tick again finds the run moved on.
    expect(await tick(row.nextRunAt!)).toBe(0);
    const jobs = await agentJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      automationId: automation.id,
      startedBy: w.owner.id,
    });
    row = await w.repos.automations.getById(automation.id);
    expect(row.lastJobId).toBe(jobs[0]?.id);
  });

  it("finds a triage's work in a trusted open error, never in an untrusted one", async ({
    expect,
  }) => {
    const automation = await create({ onlyIfWork: true });
    const error = await w.repos.errors.create({
      projectId: w.projectId,
      fingerprint: "f1",
      name: "TypeError",
      message: "x is undefined",
      firstSeenAt: time.nowISOString(),
      lastSeenAt: time.nowISOString(),
    });
    expect(await w.service.hasWork(automation)).toBe(false);
    await w.repos.errors.updateById(error.id, {
      trustedAt: time.nowISOString(),
      trustedBy: w.owner.id,
    });
    expect(await w.service.hasWork(automation)).toBe(true);
  });

  it("applies the check to an event run too", async ({ expect }) => {
    const automation = await create({
      trigger: "event",
      eventKeys: ["quest.created"],
      settleSeconds: 0,
      onlyIfWork: true,
    });
    // A quest a member files: its event reaches the triage, which finds
    // nothing to triage.
    await w.alepha.inject(QuestService).createQuest({
      projectId: w.projectId,
      title: "Tidy the docs",
      description: "",
      area: "docs",
      createdBy: w.owner.id,
    } as never);
    await w.drain();
    expect(await agentJobs()).toHaveLength(0);
    expect(
      (await w.repos.automations.getById(automation.id)).lastSkippedReason,
    ).toBe("Nothing to do");
  });

  it("refuses a schedule without its interval or hour, and the check on a text", async ({
    expect,
  }) => {
    await expect(create({ trigger: "schedule" })).rejects.toThrow(
      "names its interval",
    );
    await expect(
      create({ trigger: "schedule", schedule: "daily" }),
    ).rejects.toThrow("names its hour, in UTC");
    await expect(
      create({ promptKind: "text", promptText: "Hi", onlyIfWork: true }),
    ).rejects.toThrow('no "only if there is something" check');
  });
});
