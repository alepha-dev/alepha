import {
  LorePermissions,
  ProjectDeletionService,
  ProjectRankPresets,
} from "@lore/core/api";
import type { AgentAutomationCreate } from "@lore/core/schemas";
import { createTestMember, createTestProject } from "@lore/core/testing";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type AutomationWorld,
  automationWorld,
} from "./fixtures/automationWorld.ts";

/**
 * Agent automations, the row and a run by hand (#E172, #Q4226): a name
 * unique in its project, `prompt:manage` to write and run, `host:read`
 * to read, and one job at a time per automation, each carrying its id.
 */
describe("agent automations", () => {
  let w: AutomationWorld;
  beforeEach(async () => {
    w = await automationWorld();
  });
  afterEach(async () => {
    await w.stop();
  });

  const create = (
    body: AgentAutomationCreate,
    user: UserAccountToken = w.owner,
  ) =>
    w.controller.createProjectAutomation.run(
      { params: { projectId: w.projectId }, body },
      { user },
    );

  it("keeps a name unique in its project, and finds a row by name or id", async ({
    expect,
  }) => {
    const created = await create({
      name: "nightly",
      promptKind: "text",
      promptText: "List the open quests.",
    });
    expect(created).toMatchObject({
      name: "nightly",
      trigger: "manual",
      enabled: true,
      onlyIfWork: false,
      createdBy: w.owner.id,
    });
    await expect(
      create({ name: "nightly", promptKind: "triage" }),
    ).rejects.toThrow('An automation named "nightly" already exists');
    await expect(
      create({ name: "Not A Slug", promptKind: "triage" }),
    ).rejects.toThrow();

    const byName = await w.controller.getProjectAutomation.run(
      { params: { projectId: w.projectId, automation: "nightly" } },
      { user: w.owner },
    );
    expect(byName.id).toBe(created.id);

    const other = await create({ name: "triage", promptKind: "triage" });
    await expect(
      w.controller.updateProjectAutomation.run(
        {
          params: { projectId: w.projectId, automation: other.id },
          body: { name: "nightly" },
        },
        { user: w.owner },
      ),
    ).rejects.toThrow("already exists");
    const renamed = await w.controller.updateProjectAutomation.run(
      {
        params: { projectId: w.projectId, automation: other.id },
        body: { name: "inbox", host: "agent-1" },
      },
      { user: w.owner },
    );
    expect(renamed).toMatchObject({ name: "inbox", host: "agent-1" });

    await w.controller.deleteProjectAutomation.run(
      { params: { projectId: w.projectId, automation: "inbox" } },
      { user: w.owner },
    );
    const { items } = await w.controller.listProjectAutomations.run(
      { params: { projectId: w.projectId } },
      { user: w.owner },
    );
    expect(items.map((it) => it.name)).toEqual(["nightly"]);
  });

  it("refuses a row that cannot run: a text without words, words on a triage, an unknown host", async ({
    expect,
  }) => {
    await expect(create({ name: "empty", promptKind: "text" })).rejects.toThrow(
      "A text automation carries its words",
    );
    await expect(
      create({ name: "worded", promptKind: "triage", promptText: "Hi" }),
    ).rejects.toThrow("only a text automation carries words");
    await expect(
      create({ name: "elsewhere", promptKind: "triage", host: "nope" }),
    ).rejects.toThrow('No Agent host "nope"');
  });

  it("is written and run with prompt:manage, which the Admin holds and a Member does not, and read with host:read", async ({
    expect,
  }) => {
    expect(LorePermissions.OWNER_TODAY).toContain("prompt:manage");
    expect(LorePermissions.MEMBER_DEFAULT).not.toContain("prompt:manage");
    expect(ProjectRankPresets.ADMIN).toContain("prompt:manage");

    await create({ name: "nightly", promptKind: "text", promptText: "Hi" });
    const user = await w.entities.users.create({});
    const project = await w.entities.projects.getOne({
      where: { id: { eq: w.projectId } },
    });
    await createTestMember(w.alepha, project, user.id, { rank: "member" });
    const member: UserAccountToken = { id: user.id, roles: ["user"] };

    const { items } = await w.controller.listProjectAutomations.run(
      { params: { projectId: w.projectId } },
      { user: member },
    );
    expect(items).toHaveLength(1);
    await expect(
      create({ name: "mine", promptKind: "triage" }, member),
    ).rejects.toThrow();
    await expect(
      w.controller.runProjectAutomation.run(
        { params: { projectId: w.projectId, automation: "nightly" } },
        { user: member },
      ),
    ).rejects.toThrow();
    expect(
      await w.repos.jobs.findMany({ where: { kind: { eq: "agent" } } }),
    ).toHaveLength(0);
  });

  it("runs a text automation by hand, enabled or not, one job at a time, the job carrying its id", async ({
    expect,
  }) => {
    const automation = await create({
      name: "notes",
      promptKind: "text",
      promptText: "Summarise the week.",
      enabled: false,
      model: "sonnet",
    });
    const run = () =>
      w.controller.runProjectAutomation.run(
        { params: { projectId: w.projectId, automation: "notes" } },
        { user: w.owner },
      );

    const first = await run();
    expect(first.jobIds).toHaveLength(1);
    const job = await w.repos.jobs.getOne({
      where: { id: { eq: first.jobIds[0] } },
    });
    expect(job).toMatchObject({
      automationId: automation.id,
      startedBy: w.owner.id,
      subjectType: "prompt",
    });
    expect(job.input).toMatchObject({
      agent: "claude",
      model: "sonnet",
      workspace: "auto-notes",
    });
    expect(job.input.prompt).toContain("## Where things are");
    expect(job.input.prompt).toContain("Summarise the week.");

    // A second run while the first is queued or running starts nothing.
    const second = await run();
    expect(second).toEqual({
      jobIds: [],
      skipped: "A run of this automation is already queued or running",
    });

    await w.finish(first.jobIds[0]!);
    const third = await run();
    expect(third.jobIds).toHaveLength(1);
    const row = await w.repos.automations.getOne({
      where: { id: { eq: automation.id } },
    });
    expect(row.lastJobId).toBe(third.jobIds[0]);
    expect(row.lastRunAt).toBeDefined();
  });

  it("runs a triage automation as the inbox's triage, filed under the inbox", async ({
    expect,
  }) => {
    const item = await w.file();
    const automation = await create({ name: "triage", promptKind: "triage" });
    const out = await w.controller.runProjectAutomation.run(
      { params: { projectId: w.projectId, automation: "triage" } },
      { user: w.owner },
    );
    expect(out.jobIds).toHaveLength(1);
    const job = await w.repos.jobs.getOne({
      where: { id: { eq: out.jobIds[0] } },
    });
    expect(job).toMatchObject({
      automationId: automation.id,
      subjectType: "feedback-inbox",
    });
    expect(job.input.key).toEqual({ feedbackIds: [item.shortId] });
  });

  it("runs the dependencies' security check and update as automations (#Q4252)", async ({
    expect,
  }) => {
    for (const [name, kind, subject] of [
      ["audit", "security", "security"],
      ["deps", "dependencies", "dependencies"],
    ] as const) {
      const automation = await create({ name, promptKind: kind });
      const out = await w.controller.runProjectAutomation.run(
        { params: { projectId: w.projectId, automation: name } },
        { user: w.owner },
      );
      expect(out.jobIds).toHaveLength(1);
      const job = await w.repos.jobs.getOne({
        where: { id: { eq: out.jobIds[0] } },
      });
      expect(job).toMatchObject({
        automationId: automation.id,
        subjectType: subject,
      });
    }
  });

  it("goes with its project", async ({ expect }) => {
    // The host's home project refuses deletion: a project of its own.
    const project = await createTestProject(w.alepha, {
      createdBy: w.owner.id,
    });
    await w.repos.automations.create({
      projectId: project.id,
      name: "nightly",
      promptKind: "text",
      promptText: "Hi",
      createdBy: w.owner.id,
    });
    await w.alepha.inject(ProjectDeletionService).deleteProject(project.id);
    expect(
      await w.repos.automations.findMany({
        where: { projectId: { eq: project.id } },
      }),
    ).toHaveLength(0);
  });
});
