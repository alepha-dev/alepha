import { createTestQuest } from "@lore/plan/testing";
import { PromptController } from "@lore/prompts/api";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type AutomationWorld,
  automationWorld,
} from "./fixtures/automationWorld.ts";

/**
 * Run again on a job that ended unfinished (#Q4340): the new run continues
 * it on its host, in its workspace and on its branch, Bay told to reuse the
 * worktree it kept, and resumes its agent session when the agent reported
 * one. Starting fresh stays a run without `continue`.
 */
describe("prompt runs that continue a job", () => {
  let w: AutomationWorld;
  let prompts: PromptController;
  beforeEach(async () => {
    w = await automationWorld();
    prompts = w.alepha.inject(PromptController);
    await w.repos.hosts.updateById(w.hostId, { jobsSources: true });
    await w.entities.projects.updateById(w.projectId, {
      repositoryUrl: "https://github.com/acme/web",
    });
  });
  afterEach(async () => {
    await w.stop();
  });

  const run = (name: string, body: Record<string, unknown> = {}) =>
    prompts.runPrompt.run(
      { params: { projectId: w.projectId, name }, body: body as never },
      { user: w.owner },
    );
  // A run that starts answers its job; none here waits behind another.
  const job = (id: string | undefined) =>
    w.repos.jobs.getOne({ where: { id: { eq: id as string } } });
  const sessionStarted = (jobId: string) =>
    w.repos.logs.create({
      jobId,
      stream: "stdout",
      offset: 0,
      data: `${JSON.stringify({ type: "system", subtype: "init", model: "claude-opus-5-5", cwd: "/w" })}\n`,
    });

  it("continues a timed-out write job in its kept workspace and branch, resuming its session", async ({
    expect,
  }) => {
    const first = await job((await run("work-loose-quests")).jobId);
    expect(first.input.source).toMatchObject({ mode: "write" });
    const branch = first.input.source?.branch as string;
    expect(branch).toBe(`lore/${first.input.workspace}`);
    await sessionStarted(first.id);
    await w.repos.jobs.updateById(first.id, {
      status: "timed_out",
      warning: `kept acme/${first.input.workspace}, 3 uncommitted change(s)`,
    });

    const next = await job(
      (await run("work-loose-quests", { continue: first.id })).jobId,
    );
    expect(next.id).not.toBe(first.id);
    expect(next.hostId).toBe(first.hostId);
    expect(next.input.workspace).toBe(first.input.workspace);
    expect(next.input.source).toEqual({ mode: "write", branch, resume: true });
    expect(next.input.session).toEqual({
      id: first.input.session?.id,
      resume: true,
    });
    expect(next.input.prompt).toContain(
      "This run continues an earlier one that ended unfinished",
    );

    // Start fresh is a run without `continue`: a new workspace and branch.
    await w.repos.jobs.updateById(next.id, { status: "failed" });
    const fresh = await job((await run("work-loose-quests")).jobId);
    expect(fresh.input.workspace).not.toBe(first.input.workspace);
    expect(fresh.input.source?.resume).toBeUndefined();
    expect(fresh.input.session?.id).not.toBe(first.input.session?.id);
    expect(fresh.input.prompt).not.toContain("This run continues");
  });

  it("keeps the job's args, and starts a new session when its agent never reported one", async ({
    expect,
  }) => {
    const p = await w.entities.projects.getOne({
      where: { id: { eq: w.projectId } },
    });
    const quest = await createTestQuest(w.alepha, p);
    const first = await job(
      (await run("work-quest", { args: { quest: String(quest.shortId) } }))
        .jobId,
    );
    await w.repos.jobs.updateById(first.id, { status: "cancelled" });

    const next = await job(
      (await run("work-quest", { continue: first.id })).jobId,
    );
    expect(next.args).toEqual(first.args);
    expect(next.input.workspace).toBe(`q${quest.shortId}`);
    expect(next.input.source).toEqual({
      mode: "write",
      branch: `lore/q${quest.shortId}`,
      resume: true,
    });
    expect(next.input.session?.id).not.toBe(first.input.session?.id);
    expect(next.input.session?.resume).toBeUndefined();
  });

  it("refuses to continue a job that succeeded, is still running, or ran another prompt", async ({
    expect,
  }) => {
    const first = await job((await run("work-loose-quests")).jobId);
    await expect(
      run("work-loose-quests", { continue: first.id }),
    ).rejects.toThrow("has not ended");
    await w.repos.jobs.updateById(first.id, { status: "succeeded" });
    await expect(
      run("work-loose-quests", { continue: first.id }),
    ).rejects.toThrow("succeeded: only a job that failed");
    await w.repos.jobs.updateById(first.id, { status: "failed" });
    await expect(run("security-check", { continue: first.id })).rejects.toThrow(
      "is not a run of security-check",
    );
  });
});
