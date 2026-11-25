import { AlephaLoreCli } from "@alepha/lore/cli";
import {
  AgentJobs,
  AgentJobsUnavailableError,
  ProjectCapabilityController,
} from "@lore/core/api";
import {
  EpicController,
  FeedbackController,
  QuestController,
} from "@lore/plan/api";
import { createTestEpic, createTestQuest } from "@lore/plan/testing";
import {
  AgentHostController,
  PromptRunService,
  PromptTriggers,
} from "@lore/prompts/api";
import { Alepha } from "alepha";
import { ApiKeyController } from "alepha/api/keys";
import {
  CliProvider,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { MemoryEmailProvider } from "alepha/email";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type AutomationWorld,
  automationWorld,
} from "./fixtures/automationWorld.ts";

/**
 * Prompts is a capability, `prompts`, off by default (#E175, #Q4313).
 * Turning it off keeps every row: the prompts, their triggers and pins, and
 * the jobs; turning it back on finds them as they were. Off means off on the
 * server (#Q4314): no trigger fires, no job starts, the actions, the tools
 * and the CLI refuse, and a job's end tells nobody.
 */
describe("the prompts capability", () => {
  let w: AutomationWorld;
  const clis: Alepha[] = [];
  beforeEach(async () => {
    w = await automationWorld();
  });
  afterEach(async () => {
    for (const cli of clis.splice(0)) await cli.stop();
    await w.stop();
  });

  const setPrompts = (enabled: boolean) =>
    w.alepha.inject(ProjectCapabilityController).setCapability.run(
      {
        params: { projectId: w.projectId, key: "prompts" },
        body: { enabled },
      },
      { user: w.owner },
    );
  const promptRows = () =>
    w.repos.prompts.findMany({
      where: { projectId: { eq: w.projectId } },
      orderBy: [{ column: "name", direction: "asc" }],
    });

  it("keeps the prompts, their triggers and pins, and the jobs, off then on", async ({
    expect,
  }) => {
    const project = await w.entities.projects.getOne({
      where: { id: { eq: w.projectId } },
    });
    const epic = await createTestEpic(w.alepha, project, { status: "ready" });
    await w.controller.createPrompt.run(
      {
        params: { projectId: w.projectId },
        body: { name: "standup", text: "Summarise yesterday." } as never,
      },
      { user: w.owner },
    );
    await w.controller.updatePrompt.run(
      {
        params: { projectId: w.projectId, name: "work-epic" },
        body: {
          on: "daily@7",
          argValues: { epic: String(epic.number) },
        } as never,
      },
      { user: w.owner },
    );
    const before = await promptRows();
    const jobsBefore = await w.repos.jobs.findMany({});
    expect(before.map((it) => it.name)).toEqual(["standup", "work-epic"]);

    await setPrompts(true);
    await setPrompts(false);
    expect(await promptRows()).toEqual(before);
    expect(await w.repos.jobs.findMany({})).toEqual(jobsBefore);

    await setPrompts(true);
    expect(await promptRows()).toEqual(before);
    expect(await w.repos.jobs.findMany({})).toEqual(jobsBefore);
  });

  const off = async () => {
    await setPrompts(false);
  };
  const agentJobs = () =>
    w.repos.jobs.findMany({ where: { kind: { eq: "agent" } } });
  const set = (name: string, body: Record<string, unknown>) =>
    w.controller.updatePrompt.run(
      { params: { projectId: w.projectId, name }, body: body as never },
      { user: w.owner },
    );
  const tokenOf = async () =>
    (
      await w.alepha
        .inject(ApiKeyController)
        .createApiKey.fetch(
          { body: { name: "prompts off" } },
          { user: w.owner },
        )
    ).data.token;
  const toolText = (answer: Awaited<ReturnType<AutomationWorld["mcp"]>>) =>
    answer.error?.message ??
    answer.result?.content?.map((it) => it.text ?? "").join("\n") ??
    "";
  const cliFor = (token: string) => {
    const cli = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: token,
        LORE_URL: w.baseUrl,
        LORE_PROJECT: String(w.projectId),
        HOME: "/nonexistent",
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider })
      .with(AlephaLoreCli);
    clis.push(cli);
    const list = cli
      .primitives<any>("$command")
      .find((it) => it.name === "prompt" && it.hasChildren)
      ?.children.find((it: any) => it.name === "list");
    return () =>
      cli
        .inject(CliProvider)
        .run(list, { argv: ["--output", "json"], root: "/work" })
        .then(
          () => undefined,
          (error: unknown) => error,
        );
  };

  it("refuses every prompt action, a job's start, the tools and the CLI while off, and answers again once on", async ({
    expect,
  }) => {
    const refusal = "does not have Prompts (prompts)";
    const token = await tokenOf();
    const lorePromptList = cliFor(token);
    const project = await w.entities.projects.getOne({
      where: { id: { eq: w.projectId } },
    });
    const quest = await createTestQuest(w.alepha, project, { title: "Off" });
    const epic = await createTestEpic(w.alepha, project, { status: "ready" });
    await w.file();
    await off();

    await expect(
      w.controller.listPrompts.run(
        { params: { projectId: w.projectId } },
        { user: w.owner },
      ),
    ).rejects.toThrow(refusal);
    await expect(
      w.controller.runPrompt.run(
        {
          params: { projectId: w.projectId, name: "weekly-status" },
          body: { args: {} } as never,
        },
        { user: w.owner },
      ),
    ).rejects.toThrow(refusal);
    await expect(
      w.alepha
        .inject(AgentHostController)
        .listProjectAgentHosts.run(
          { params: { projectId: w.projectId } },
          { user: w.owner },
        ),
    ).rejects.toThrow(refusal);

    const agents = w.alepha.inject(AgentJobs);
    expect(await agents.choices(w.projectId)).toEqual([]);
    await expect(
      w.alepha
        .inject(PromptRunService)
        .run(w.projectId, w.owner, "weekly-status", { args: {} }),
    ).rejects.toThrow(AgentJobsUnavailableError);
    expect(await agentJobs()).toHaveLength(0);

    const promptList = await w.mcp(token, "prompt_list", {
      project: w.projectId,
    });
    expect(toolText(promptList)).toContain(refusal);
    const agentHosts = await w.mcp(token, "agent_hosts", {
      project: w.projectId,
    });
    expect(toolText(agentHosts)).toContain(refusal);
    // A job is a host job: its history outlives the switch.
    const jobList = await w.mcp(token, "job_list", { project: w.projectId });
    expect(toolText(jobList)).not.toContain(refusal);
    const cliError = await lorePromptList();
    expect(cliError instanceof Error ? cliError.message : "").toContain(
      refusal,
    );

    // Plan's pages read no agent entry, and still render.
    await w.alepha
      .inject(QuestController)
      .getQuestByShortId.run(
        { params: { projectId: w.projectId, shortId: quest.shortId } },
        { user: w.owner },
      );
    await w.alepha
      .inject(EpicController)
      .getEpicByNumber.run(
        { params: { projectId: w.projectId, number: epic.number } },
        { user: w.owner },
      );
    await w.alepha
      .inject(FeedbackController)
      .listFeedback.run(
        { params: { projectId: w.projectId }, query: {} },
        { user: w.owner },
      );

    await setPrompts(true);
    expect(await agents.choices(w.projectId)).not.toEqual([]);
    expect(
      toolText(await w.mcp(token, "prompt_list", { project: w.projectId })),
    ).not.toContain(refusal);
    expect(await lorePromptList()).toBeUndefined();
    const { jobId } = await w.alepha
      .inject(PromptRunService)
      .run(w.projectId, w.owner, "weekly-status", { args: {} });
    expect(jobId).toBeTruthy();
  });

  it("fires no schedule and no event trigger while off, and fires them once on", async ({
    expect,
  }) => {
    const time = w.alepha.inject(DateTimeProvider);
    time.pause();
    const triggers = w.alepha.inject(PromptTriggers);
    const project = await w.entities.projects.getOne({
      where: { id: { eq: w.projectId } },
    });
    const epic = await createTestEpic(w.alepha, project, { status: "ready" });
    await set("work-epic", {
      on: "daily@7",
      argValues: { epic: String(epic.number) },
    });
    await set("triage", { on: "event:feedback.created", settleSeconds: 0 });
    const row = (name: string) =>
      w.repos.prompts.getOne({
        where: { projectId: { eq: w.projectId }, name: { eq: name } },
      });
    await off();

    const due = (await row("work-epic")).nextRunAt!;
    expect(await triggers.tick(due)).toBe(0);
    // Moved to its next run, so it holds no slot of the tick.
    expect((await row("work-epic")).nextRunAt! > due).toBe(true);
    await w.submit("Off");
    await w.drain();
    expect(await agentJobs()).toHaveLength(0);

    await setPrompts(true);
    expect(await triggers.tick((await row("work-epic")).nextRunAt!)).toBe(1);
    await w.submit("On");
    await w.drain();
    const causes = (await agentJobs())
      .map((it) => it.cause?.kind)
      .sort((a, b) => String(a).localeCompare(String(b)));
    expect(causes).toEqual(["event", "schedule"]);
  });

  it("lets a job running when it is turned off finish, and tells nobody of its end", async ({
    expect,
  }) => {
    await w.entities.users.updateById(w.owner.id, {
      roles: ["user"],
      enabled: true,
      email: "owner@acme.test",
    } as never);
    const ended = () =>
      w.repos.events.findMany({
        where: {
          name: { inArray: ["agent.job.succeeded", "agent.job.failed"] },
        },
      });
    const { jobId } = await w.alepha
      .inject(PromptRunService)
      .run(w.projectId, w.owner, "weekly-status", { args: {} });
    await off();
    await w.finish(jobId, "done");
    await w.drain(["project-events.deliver", "system.notifications.send"]);

    const job = await w.repos.jobs.getOne({ where: { id: { eq: jobId } } });
    expect(job.status).toBe("succeeded");
    expect(await ended()).toHaveLength(0);
    expect(w.alepha.inject(MemoryEmailProvider).records).toHaveLength(0);

    await setPrompts(true);
    const next = await w.alepha
      .inject(PromptRunService)
      .run(w.projectId, w.owner, "weekly-status", { args: {} });
    await w.finish(next.jobId, "done");
    await w.drain(["project-events.deliver", "system.notifications.send"]);
    expect(await ended()).toHaveLength(1);
    expect(
      w.alepha
        .inject(MemoryEmailProvider)
        .records.filter((it) => it.to === "owner@acme.test"),
    ).toHaveLength(1);
  });
});
