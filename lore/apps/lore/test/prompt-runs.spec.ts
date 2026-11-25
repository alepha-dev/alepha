import { HostCommandService } from "@lore/core/api";
import { createTestMember } from "@lore/core/testing";
import { createTestEpic, createTestQuest } from "@lore/plan/testing";
import { PromptController } from "@lore/prompts/api";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type AutomationWorld,
  automationWorld,
} from "./fixtures/automationWorld.ts";

/**
 * Run a prompt on an Agent host (#E174, #Q4275): one path by name, a value
 * per arg, the prompt's own source, one run per prompt and arg value, and a
 * job recording the prompt, its args, its cause and the agent's reply.
 */
describe("prompt runs", () => {
  let w: AutomationWorld;
  let prompts: PromptController;
  beforeEach(async () => {
    w = await automationWorld();
    prompts = w.alepha.inject(PromptController);
  });
  afterEach(async () => {
    await w.stop();
  });

  const project = () =>
    w.entities.projects.getOne({ where: { id: { eq: w.projectId } } });
  const run = (
    name: string,
    body: Record<string, unknown> = {},
    user: UserAccountToken = w.owner,
  ) =>
    prompts.runPrompt.run(
      { params: { projectId: w.projectId, name }, body: body as never },
      { user },
    );
  const job = (id: string) =>
    w.repos.jobs.getOne({ where: { id: { eq: id } } });

  it("runs a built-in with its arg, recording the prompt, its args, its cause and a session of its own", async ({
    expect,
  }) => {
    const quest = await createTestQuest(w.alepha, await project(), {
      title: "Fix the cart",
    });
    const out = await run("work-quest", {
      args: { quest: `#Q${quest.shortId}` },
    });
    const row = await job(out.jobId);
    expect(row).toMatchObject({
      kind: "agent",
      startedBy: w.owner.id,
      subjectType: "prompt",
      subjectId: "work-quest",
      prompt: "work-quest",
      args: [
        {
          name: "quest",
          type: "quest",
          value: String(quest.shortId),
          reference: `#Q${quest.shortId}`,
          title: "Fix the cart",
        },
      ],
      cause: { kind: "hand" },
    });
    expect(row.automationId).toBeUndefined();
    expect(row.input).toMatchObject({
      workspace: `q${quest.shortId}`,
      timeoutSeconds: 3600,
      key: { questId: quest.shortId },
    });
    expect(row.input.session?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.input.session?.resume).toBeUndefined();
    expect(row.input.prompt).toContain(`Work on quest #Q${quest.shortId}`);
    expect(row.input.prompt).toContain("## Where things are");
  });

  it("refuses an item its arg does not accept, a second run of the same arg, and a starter without the prompt's permission", async ({
    expect,
  }) => {
    const p = await project();
    const done = await createTestQuest(w.alepha, p, {
      acceptedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    await expect(
      run("work-quest", { args: { quest: String(done.shortId) } }),
    ).rejects.toThrow("accepts a quest todo or in_progress");

    const open = await createTestQuest(w.alepha, p);
    const first = await run("work-quest", {
      args: { quest: String(open.shortId) },
    });
    await expect(
      run("work-quest", { args: { quest: String(open.shortId) } }),
    ).rejects.toThrow(`: job ${first.jobId}`);
    const other = await createTestQuest(w.alepha, p);
    await run("work-quest", { args: { quest: String(other.shortId) } });

    const user = await w.entities.users.create({});
    await createTestMember(w.alepha, p, user.id, { rank: "member" });
    const member: UserAccountToken = { id: user.id, roles: ["user"] };
    // A custom prompt runs under host:update, which a Member lacks.
    await prompts.createPrompt.run(
      {
        params: { projectId: w.projectId },
        body: { name: "nightly", text: "List the open quests." },
      },
      { user: w.owner },
    );
    await expect(run("nightly", {}, member)).rejects.toThrow(
      "A run of nightly needs the host:update permission",
    );
  });

  it("runs with the prompt's own source, never a run's", async ({ expect }) => {
    await w.repos.hosts.updateById(w.hostId, { jobsSources: true });
    await w.entities.projects.updateById(w.projectId, {
      repositoryUrl: "https://github.com/acme/web",
    });
    const read = await job((await run("security-check")).jobId);
    expect(read.input.source).toEqual({ mode: "read" });
    await w.repos.jobs.updateById(read.id, { status: "succeeded" });

    await prompts.updatePrompt.run(
      {
        params: { projectId: w.projectId, name: "security-check" },
        body: { source: "none" },
      },
      { user: w.owner },
    );
    const none = await job((await run("security-check")).jobId);
    expect(none.input.source).toEqual({ mode: "none" });
  });

  it("runs a custom prompt under host:update, its args rendered, for 30 minutes", async ({
    expect,
  }) => {
    const epic = await createTestEpic(w.alepha, await project(), {
      title: "Cart",
      status: "ready",
    });
    await prompts.createPrompt.run(
      {
        params: { projectId: w.projectId },
        body: {
          name: "crash",
          text: "Investigate {{epic.reference}} {{epic.title}} in {{project}}.",
          args: [{ name: "epic", type: "epic" }],
          source: "none",
        },
      },
      { user: w.owner },
    );
    const row = await job(
      (await run("crash", { args: { epic: String(epic.number) } })).jobId,
    );
    expect(row.input.prompt).toContain(`Investigate #E${epic.number} Cart in `);
    expect(row.input.timeoutSeconds).toBe(1800);
    expect(row.prompt).toBe("crash");
  });

  it("runs for the time the project set on a prompt, custom or built-in, and back to the default once cleared", async ({
    expect,
  }) => {
    const update = (name: string, body: Record<string, unknown>) =>
      prompts.updatePrompt.run(
        { params: { projectId: w.projectId, name }, body: body as never },
        { user: w.owner },
      );
    const created = await prompts.createPrompt.run(
      {
        params: { projectId: w.projectId },
        body: { name: "npm-update", text: "Bump.", timeoutSeconds: 5400 },
      },
      { user: w.owner },
    );
    expect(created.timeoutSeconds).toBe(5400);
    const first = await job((await run("npm-update")).jobId);
    expect(first.input.timeoutSeconds).toBe(5400);
    await w.repos.jobs.updateById(first.id, { status: "succeeded" });

    // Triage plans its own time; a time the project set wins over it.
    expect(
      (await update("triage", { timeoutSeconds: 7200 })).timeoutSeconds,
    ).toBe(7200);
    const triage = await job((await run("triage")).jobId);
    expect(triage.input.timeoutSeconds).toBe(7200);

    expect(
      (await update("npm-update", { timeoutSeconds: null })).timeoutSeconds,
    ).toBe(1800);
    expect((await run("npm-update")).jobId).toBeDefined();
    await expect(
      update("npm-update", { timeoutSeconds: 30 * 3600 }),
    ).rejects.toThrow();
  });

  it("takes the host's first agent when it reports several and the run names none", async ({
    expect,
  }) => {
    await w.repos.hosts.updateById(w.hostId, {
      jobsTools: [
        { name: "claude", kind: "agent", found: true, version: "2" },
        { name: "gemini", kind: "agent", found: true, version: "1" },
      ],
    });
    const row = await job((await run("weekly-status")).jobId);
    expect(row.input.agent).toBe("claude");
    expect(row.input.workspace).toBe("status");
    const named = await job(
      (await run("security-check", { agent: "gemini" })).jobId,
    );
    expect(named.input.agent).toBe("gemini");
  });

  it("gives each built-in its key pin, workspace and time", async ({
    expect,
  }) => {
    const p = await project();
    const draft = await createTestEpic(w.alepha, p, { status: "draft" });
    const ready = await createTestEpic(w.alepha, p, { status: "ready" });
    const item = await w.file();
    const review = await job(
      (await run("review-epic", { args: { epic: String(draft.number) } }))
        .jobId,
    );
    expect(review.input).toMatchObject({
      workspace: "review",
      key: { epicId: draft.number },
    });
    expect(review.input.prompt).toContain("This run's rules");
    const work = await job(
      (await run("work-epic", { args: { epic: String(ready.number) } })).jobId,
    );
    expect(work.input).toMatchObject({
      key: { epicId: ready.number },
      timeoutSeconds: 14_400,
    });
    const feedback = await job(
      (await run("work-feedback", { args: { feedback: String(item.shortId) } }))
        .jobId,
    );
    expect(feedback.input.key).toMatchObject({ feedbackId: item.shortId });
    const triage = await run("triage");
    const triaged = await job(triage.jobId);
    expect(triaged.input).toMatchObject({
      workspace: "triage",
      key: { feedbackIds: [item.shortId] },
    });
    expect(triaged.input.prompt).toContain("Triage the whole feedback inbox");
    // A pull request's review reads its head: the repository is needed.
    await w.repos.hosts.updateById(w.hostId, { jobsSources: true });
    await w.entities.projects.updateById(w.projectId, {
      repositoryUrl: "https://github.com/acme/web",
    });
    const pr = await job(
      (await run("review-pr", { args: { pullRequest: "42" }, fix: true }))
        .jobId,
    );
    expect(pr.input).toMatchObject({
      workspace: "pr-42",
      timeoutSeconds: 7200,
    });
    await expect(run("work-quest", { fix: true })).rejects.toThrow(
      "Only review-pr takes fix and trust",
    );
    const loose = await job((await run("work-loose-quests")).jobId);
    expect(loose.input.timeoutSeconds).toBe(14_400);
  });

  it("keeps the agent's final reply on the job, from the terminal ack", async ({
    expect,
  }) => {
    const out = await run("weekly-status");
    const row = await job(out.jobId);
    const commands = w.alepha.inject(HostCommandService);
    await commands.ack(row.hostId, { id: row.commandId!, status: "running" });
    await commands.ack(row.hostId, {
      id: row.commandId!,
      status: "done",
      exitCode: 0,
      result: "## The week\n\nShipped two quests.",
      resultTruncated: true,
    });
    const ended = await job(out.jobId);
    expect(ended).toMatchObject({
      status: "succeeded",
      result: "## The week\n\nShipped two quests.",
      resultTruncated: true,
    });
  });
});
