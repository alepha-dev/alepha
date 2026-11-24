import { AgentJobService } from "@lore/core/api";
import { PlanAutomationKinds, QuestService } from "@lore/plan/api";
import { DateTimeProvider } from "alepha/datetime";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type AutomationWorld,
  automationWorld,
} from "./fixtures/automationWorld.ts";

/**
 * A build automation (#Q4229): every quest a triage filed that does not ask
 * for a human becomes one build job, which accepts it and opens a pull
 * request; and the chain rule's one hop, a triage's quest built once.
 */
describe("build automations", () => {
  let w: AutomationWorld;
  beforeEach(async () => {
    w = await automationWorld();
    w.alepha.inject(DateTimeProvider).pause();
  });
  afterEach(async () => {
    await w.stop();
  });

  const build = (body: Record<string, unknown> = {}) =>
    w.controller.createProjectAutomation.run(
      {
        params: { projectId: w.projectId },
        body: { name: "build", promptKind: "build", ...body } as never,
      },
      { user: w.owner },
    );
  const run = (name = "build") =>
    w.controller.runProjectAutomation.run(
      { params: { projectId: w.projectId, automation: name } },
      { user: w.owner },
    );
  const quest = async (title: string, patch: Record<string, unknown> = {}) => {
    const created = await w.alepha.inject(QuestService).createQuest({
      projectId: w.projectId,
      title,
      description: `${title}.`,
      area: "web",
      createdBy: w.owner.id,
    } as never);
    if (Object.keys(patch).length) {
      await w.repos.quests.updateById(created.id, patch as never);
    }
    return w.repos.quests.getOne({ where: { id: { eq: created.id } } });
  };
  const agentJobs = () =>
    w.repos.jobs.findMany({ where: { kind: { eq: "agent" } } });

  it("builds the oldest todo quest no human was asked for, and never the same quest twice", async ({
    expect,
  }) => {
    const now = new Date().toISOString();
    const first = await quest("Fix the save button");
    await quest("Rotate the signing keys", { tags: ["needs-human"] });
    await quest("Outside idea", { untrusted: true });
    await quest("Parked", { heldAt: now, heldBy: w.owner.id });
    await quest("Taken", { acceptedAt: now, acceptedBy: w.owner.id });
    await quest("After the first", { dependsOn: first.id });
    const automation = await build();

    const out = await run();
    expect(out.jobIds).toHaveLength(1);
    const [job] = await agentJobs();
    expect(job).toMatchObject({
      automationId: automation.id,
      subjectType: "quest",
      subjectId: String(first.shortId),
    });
    expect(job?.input.workspace).toBe(`q${first.shortId}`);
    expect(job?.input.key).toEqual({ questId: first.shortId });
    expect(job?.input.prompt).toContain("`quest_accept`");
    expect(job?.input.prompt).toContain(
      "Turn auto-merge on only when the repository's instructions ask for it",
    );

    // A failed build is retried by hand, never by the rule.
    await w.finish(job!.id, "failed");
    const again = await run();
    expect(again).toEqual({ jobIds: [], skipped: "No quest to build" });
    expect(await w.service.hasWork(automation)).toBe(false);
  });

  it("builds a confirmed untrusted quest, and asks for auto-merge when the automation does", async ({
    expect,
  }) => {
    const confirmed = await quest("Outside, confirmed", {
      untrusted: true,
      untrustedConfirmedAt: new Date().toISOString(),
      untrustedConfirmedBy: w.owner.id,
    });
    const automation = await build({ autoMerge: true });
    expect(await w.service.hasWork(automation)).toBe(true);
    await run();
    const [job] = await agentJobs();
    expect(job?.subjectId).toBe(String(confirmed.shortId));
    expect(job?.input.prompt).toContain("`gh pr merge --auto`");
  });

  it("runs as many builds as its concurrency, one quest per job, and refuses a concurrency on any other kind", async ({
    expect,
  }) => {
    for (const title of ["One", "Two", "Three", "Four"]) await quest(title);
    await build({ concurrency: 3 });
    const out = await run();
    expect(out.jobIds).toHaveLength(3);
    const jobs = await agentJobs();
    expect(new Set(jobs.map((job) => job.subjectId)).size).toBe(3);
    // No free slot: nothing more until one ends.
    expect((await run()).jobIds).toHaveLength(0);
    await w.finish(jobs[0]!.id);
    expect((await run()).jobIds).toHaveLength(1);

    await expect(
      w.controller.createProjectAutomation.run(
        {
          params: { projectId: w.projectId },
          body: { name: "triage", promptKind: "triage", concurrency: 2 },
        },
        { user: w.owner },
      ),
    ).rejects.toThrow("Only a build automation runs several jobs at once");
  });

  it("builds the quest a triage job filed, once: the chain's one hop", async ({
    expect,
  }) => {
    await w.file();
    await w.controller.createProjectAutomation.run(
      {
        params: { projectId: w.projectId },
        body: { name: "triage", promptKind: "triage" },
      },
      { user: w.owner },
    );
    const builder = await build({
      trigger: "event",
      eventKeys: ["quest.created"],
      settleSeconds: 0,
    });
    const triage = await run("triage");
    const triageJob = triage.jobIds[0]!;

    // The triage job files a quest with its own key.
    const filed = await w.mcp(await w.keyOf(triageJob), "quest_create", {
      project: w.projectId,
      title: "Fix the reported crash",
      description: "From the triage.",
      area: "web",
      priority: "high",
    });
    expect(filed.result?.isError).not.toBe(true);
    await w.drain();
    const build_ = (await agentJobs()).find(
      (job) => job.automationId === builder.id,
    );
    expect(build_).toMatchObject({ startedByJobId: triageJob });

    // The build job's own quest: its event is the automation's own, and
    // starts nothing.
    await w.mcp(await w.keyOf(build_!.id), "quest_create", {
      project: w.projectId,
      title: "A follow-up the build found",
      description: "From the build.",
      area: "web",
      priority: "low",
    });
    // The host runs one job at a time: the triage ends, the build runs.
    await w.finish(triageJob);
    await w.finish(build_!.id);
    await w.drain();
    expect(
      (await agentJobs()).filter((job) => job.automationId === builder.id),
    ).toHaveLength(1);
  });

  it("opens the chain one hop and no further, for an automation's build only", async ({
    expect,
  }) => {
    const service = w.alepha.inject(AgentJobService);
    const job = (patch: Record<string, unknown>) =>
      w.repos.jobs.create({
        projectId: w.projectId,
        hostId: w.hostId,
        kind: "agent",
        status: "succeeded",
        input: { timeoutSeconds: 60 },
        queuedAt: new Date().toISOString(),
        ...patch,
      } as never);
    const triage = await job({ subjectType: "feedback-inbox" });
    const build = await job({ subjectType: "quest", subjectId: "1" });
    const text = await job({ subjectType: "prompt" });
    const nested = await job({
      subjectType: "feedback-inbox",
      startedByJobId: text.id,
    });
    const automationBuild = { build: true, automationId: "a" };

    expect(await service.chainAllows(triage.id, automationBuild)).toBe(true);
    // A build job's output starts nothing.
    expect(await service.chainAllows(build.id, automationBuild)).toBe(false);
    // Every other chain is refused: a text job's, a triage that has an
    // agent parent, and a build no automation starts.
    expect(await service.chainAllows(text.id, automationBuild)).toBe(false);
    expect(await service.chainAllows(nested.id, automationBuild)).toBe(false);
    expect(await service.chainAllows(triage.id, { build: true })).toBe(false);
    expect(await service.chainAllows(triage.id, {})).toBe(false);
  });

  it("tells the triage to tag what an agent should not build alone", async ({
    expect,
  }) => {
    await w.file();
    await w.controller.createProjectAutomation.run(
      {
        params: { projectId: w.projectId },
        body: { name: "triage", promptKind: "triage" },
      },
      { user: w.owner },
    );
    const [jobId] = (await run("triage")).jobIds;
    const job = await w.repos.jobs.getOne({ where: { id: { eq: jobId } } });
    expect(job.input.prompt).toContain("Tag a quest `needs-human`");
    expect(PlanAutomationKinds.NEEDS_HUMAN).toBe("needs-human");
  });
});
