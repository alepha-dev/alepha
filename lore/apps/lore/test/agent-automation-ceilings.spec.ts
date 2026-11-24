import { QuestService } from "@lore/plan/api";
import { DateTimeProvider } from "alepha/datetime";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type AutomationWorld,
  automationWorld,
} from "./fixtures/automationWorld.ts";

/**
 * An automation stops by itself when something is wrong (#Q4230): ceilings
 * per automation and per project, self-disable after three failures in a
 * row, the project-wide pause, and a host that cannot take a run, which is
 * a skip and never a failure.
 */
describe("agent automation ceilings and self-disable", () => {
  let w: AutomationWorld;
  beforeEach(async () => {
    w = await automationWorld();
    w.alepha.inject(DateTimeProvider).pause();
  });
  afterEach(async () => {
    await w.stop();
  });

  const text = (body: Record<string, unknown> = {}) =>
    w.controller.createProjectAutomation.run(
      {
        params: { projectId: w.projectId },
        body: {
          name: "notes",
          promptKind: "text",
          promptText: "Summarise.",
          ...body,
        } as never,
      },
      { user: w.owner },
    );
  const row = (id: string) => w.repos.automations.getById(id);
  const events = async (name: string) =>
    w.repos.events.findMany({ where: { name: { eq: name } } });
  const agentJobs = () =>
    w.repos.jobs.findMany({ where: { kind: { eq: "agent" } } });

  it("disables itself after three failed runs in a row, and a success resets the count", async ({
    expect,
  }) => {
    const automation = await text();
    const fail = async (status: "done" | "failed") => {
      const out = await w.service.runTriggered(await row(automation.id));
      await w.finish(out.jobIds[0]!, status);
    };
    await fail("failed");
    await fail("failed");
    await fail("done");
    expect((await row(automation.id)).consecutiveFailures).toBe(0);

    await fail("failed");
    await fail("failed");
    expect((await row(automation.id)).enabled).toBe(true);
    await fail("failed");
    const disabled = await row(automation.id);
    expect(disabled.enabled).toBe(false);
    expect(disabled.consecutiveFailures).toBe(3);
    expect(disabled.lastSkippedReason).toContain(
      "Disabled after 3 failed runs",
    );
    expect(await events("automation.run.failed")).toHaveLength(5);
    const [said] = await events("automation.disabled");
    expect(said?.fields).toMatchObject({
      automation: "notes",
      job_id: disabled.lastJobId,
    });
  });

  it("refuses a run past its hourly ceiling, says so once, and starts again an hour later", async ({
    expect,
  }) => {
    const automation = await text({ maxRunsPerHour: 2 });
    for (let i = 0; i < 2; i++) {
      const out = await w.service.runTriggered(await row(automation.id));
      await w.finish(out.jobIds[0]!);
    }
    const refused = await w.service.runTriggered(await row(automation.id));
    expect(refused).toEqual({
      jobIds: [],
      skipped: "Ceiling reached: 2 runs in the last hour",
    });
    await w.service.runTriggered(await row(automation.id));
    expect(await events("automation.ceiling.reached")).toHaveLength(1);
    expect((await row(automation.id)).lastSkippedReason).toBe(
      "Ceiling reached: 2 runs in the last hour",
    );

    // A run by hand is never refused by a ceiling.
    const byHand = await w.controller.runProjectAutomation.run(
      { params: { projectId: w.projectId, automation: "notes" } },
      { user: w.owner },
    );
    expect(byHand.jobIds).toHaveLength(1);
    await w.finish(byHand.jobIds[0]!);

    await w.alepha.inject(DateTimeProvider).travel(61, "minutes");
    expect(
      (await w.service.runTriggered(await row(automation.id))).jobIds,
    ).toHaveLength(1);
  });

  it("holds the project's builds per day, whatever the automation's concurrency", async ({
    expect,
  }) => {
    for (const title of ["One", "Two", "Three", "Four"]) {
      await w.alepha.inject(QuestService).createQuest({
        projectId: w.projectId,
        title,
        description: `${title}.`,
        area: "web",
        createdBy: w.owner.id,
      } as never);
    }
    const settings = await w.controller.setProjectAutomationSettings.run(
      { params: { projectId: w.projectId }, body: { buildsPerDay: 2 } },
      { user: w.owner },
    );
    expect(settings.buildsPerDay).toBe(2);
    const automation = await w.controller.createProjectAutomation.run(
      {
        params: { projectId: w.projectId },
        body: { name: "build", promptKind: "build", concurrency: 5 },
      },
      { user: w.owner },
    );
    const out = await w.service.runTriggered(await row(automation.id));
    expect(out.jobIds).toHaveLength(2);
    const next = await w.service.runTriggered(await row(automation.id));
    expect(next.skipped).toBe(
      "Ceiling reached: the project's 2 automation builds in the last day",
    );
  });

  it("skips a run whose host is offline or no longer answers, without counting a failure", async ({
    expect,
  }) => {
    const automation = await text();
    await w.repos.hosts.updateById(w.hostId, {
      offlineSince: new Date().toISOString(),
    });
    expect(await w.service.runTriggered(await row(automation.id))).toEqual({
      jobIds: [],
      skipped: 'Host "agent-1" is offline',
    });
    await w.repos.hosts.updateById(w.hostId, {
      offlineSince: null as never,
      agentStatus: "unavailable",
    });
    expect(
      (await w.service.runTriggered(await row(automation.id))).skipped,
    ).toBe('Host "agent-1" is unavailable');
    const after = await row(automation.id);
    expect(after.consecutiveFailures).toBe(0);
    expect(after.enabled).toBe(true);
    expect(await agentJobs()).toHaveLength(0);
  });

  it("pauses every automation of the project, a run by hand still working", async ({
    expect,
  }) => {
    const automation = await text();
    const paused = await w.controller.setProjectAutomationSettings.run(
      { params: { projectId: w.projectId }, body: { paused: true } },
      { user: w.owner },
    );
    expect(paused.pausedAt).toBeDefined();
    expect(
      (await w.service.runTriggered(await row(automation.id))).skipped,
    ).toBe("Automations are paused in this project");
    const byHand = await w.controller.runProjectAutomation.run(
      { params: { projectId: w.projectId, automation: "notes" } },
      { user: w.owner },
    );
    expect(byHand.jobIds).toHaveLength(1);
    const resumed = await w.controller.setProjectAutomationSettings.run(
      { params: { projectId: w.projectId }, body: { paused: false } },
      { user: w.owner },
    );
    expect(resumed.pausedAt).toBeUndefined();
  });
});
