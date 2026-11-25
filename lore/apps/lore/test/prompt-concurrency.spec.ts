import { HostCommandService } from "@lore/core/api";
import { PromptController } from "@lore/prompts/api";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type AutomationWorld,
  automationWorld,
} from "./fixtures/automationWorld.ts";

/**
 * A prompt's concurrency (#Q4354): a second run of the same prompt and arg
 * values while one runs waits behind it as ONE run when the prompt says
 * `queue` (triage, loose quests, a custom prompt by default), and is refused
 * when it says `unique` (work on an epic or a quest, the reviews).
 */
describe("prompt concurrency", () => {
  let w: AutomationWorld;
  let prompts: PromptController;
  beforeEach(async () => {
    w = await automationWorld();
    prompts = w.alepha.inject(PromptController);
  });
  afterEach(async () => {
    await w.stop();
  });

  const run = (name: string, body: Record<string, unknown> = {}) =>
    prompts.runPrompt.run(
      { params: { projectId: w.projectId, name }, body: body as never },
      { user: w.owner },
    );
  const get = (name: string) =>
    prompts.getPrompt.run(
      { params: { projectId: w.projectId, name } },
      { user: w.owner },
    );
  const create = (body: Record<string, unknown>) =>
    prompts.createPrompt.run(
      { params: { projectId: w.projectId }, body: body as never },
      { user: w.owner },
    );
  const agentJobs = () =>
    w.repos.jobs.findMany({
      where: { kind: { eq: "agent" } },
      orderBy: [{ column: "queuedAt", direction: "asc" }],
    });
  const endJob = async (jobId: string) => {
    const job = await w.repos.jobs.getOne({ where: { id: { eq: jobId } } });
    const commands = w.alepha.inject(HostCommandService);
    await commands.ack(job.hostId, { id: job.commandId!, status: "running" });
    await commands.ack(job.hostId, {
      id: job.commandId!,
      status: "done",
      exitCode: 0,
    });
  };

  it("queues a second run of triage behind the running one, as one, and starts it as its asker when the job ends", async ({
    expect,
  }) => {
    await w.submit("One");
    const first = await run("triage");
    expect(first.jobId).toBeDefined();

    const second = await run("triage");
    expect(second).toEqual({ queuedBehind: first.jobId, skipped: [] });
    const third = await run("triage");
    expect(third.queuedBehind).toBe(first.jobId);
    expect(await w.waiting()).toHaveLength(1);
    expect(await agentJobs()).toHaveLength(1);

    await endJob(first.jobId!);
    await w.drain(["prompts.dequeue"]);
    const jobs = await agentJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[1]).toMatchObject({
      prompt: "triage",
      startedBy: w.owner.id,
      cause: { kind: "hand" },
    });
    expect(await w.waiting()).toHaveLength(0);

    // Its end starts nothing more: nothing waited behind it.
    await endJob(jobs[1]!.id);
    await w.drain(["prompts.dequeue"]);
    expect(await agentJobs()).toHaveLength(2);
  });

  it("reads each built-in's mode, and refuses one written on a built-in", async ({
    expect,
  }) => {
    expect((await get("triage")).concurrency).toBe("queue");
    expect((await get("work-loose-quests")).concurrency).toBe("queue");
    expect((await get("work-quest")).concurrency).toBe("unique");
    await expect(
      prompts.updatePrompt.run(
        {
          params: { projectId: w.projectId, name: "triage" },
          body: { concurrency: "unique" },
        },
        { user: w.owner },
      ),
    ).rejects.toThrow("its concurrency cannot change");
  });

  it("queues a custom prompt by default, and refuses a second run of one that says unique", async ({
    expect,
  }) => {
    const queued = await create({ name: "sweep", text: "Sweep the inbox." });
    expect(queued.concurrency).toBe("queue");
    const first = await run("sweep");
    expect((await run("sweep")).queuedBehind).toBe(first.jobId);

    const unique = await create({
      name: "audit",
      text: "Audit the project.",
      concurrency: "unique",
    });
    expect(unique.concurrency).toBe("unique");
    const audit = await run("audit");
    await expect(run("audit")).rejects.toThrow(
      `is already queued: job ${audit.jobId}`,
    );
    expect(await w.waiting()).toHaveLength(1);
  });
});
