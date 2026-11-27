import { ProjectSecurityService } from "@lore/core/api";
import { createTestMember, createTestProject } from "@lore/core/testing";
import { RankService } from "alepha/api/organizations";
import type { ToolPrimitive } from "alepha/mcp";
import type { ActionPrimitive } from "alepha/server";
import { describe, it } from "vitest";

import {
  LoreAiAssistant,
  LoreAiToolAccess,
  LoreAiToolset,
} from "@/assistant/index.ts";

import { bootAssistant } from "./fixtures/bootAssistant.ts";

const WRITE_SET = [
  "quest_create",
  "quest_comment_add",
  "quest_update",
  "quest_complete",
  "folio_create",
  "quest_accept",
  "quest_shelve",
  "quest_delete",
  "epic_create",
  "release_publish",
  "feedback_accept",
  "feedback_reject",
  "folio_delete",
  "dashboard_card_add",
  "dashboard_card_update",
  "feedback_submit",
  "prompt_run",
  "folio_update",
];

const READ_SET = [
  "project_info",
  "quest_list",
  "quest_get",
  "getEpicRefs",
  "epic_get",
  "folio_search",
  "folio_get",
  "release_list",
  "release_get",
  "feedback_list",
  "feedback_get",
  "feedback_targets",
  "search",
  "searchDocs",
  "dashboard_list",
  "dashboard_metric_catalog",
  "dashboard_card_list",
  "monitor_list",
  "monitor_get",
  "error_list",
  "job_list",
  "job_get",
  "deploy_status",
  "stack_list",
  "stack_get",
];

/**
 * The read tools (#Q3209): Lore's own MCP tools, plus its search action,
 * offered only when the user's effective permissions in the context's project
 * grant them, and still gated by their own action when they run.
 */
describe("the assistant's read tools", () => {
  const boot = async () => {
    const ctx = await bootAssistant({ enabled: "1" });
    const project = await createTestProject(ctx.alepha, { title: "Acme" });
    const owner = await ctx.signIn(project.createdBy);
    const context = (projectId: number) => ({
      route: "/acme",
      page: "project",
      data: { projectId, projectTitle: "Acme", language: "en" },
    });
    return { ...ctx, project, owner, context };
  };

  /**
   * A rank holding every read permission but `feedback:read`.
   */
  const createReaderRank = async (
    alepha: Awaited<ReturnType<typeof boot>>["alepha"],
    projectId: number,
    ownerId: string,
  ) => {
    const organizationId = await alepha
      .inject(ProjectSecurityService)
      .organizationIdOf(projectId);
    await alepha.context.run(() =>
      alepha.inject(RankService).save(
        organizationId,
        {
          key: "reader",
          name: "Reader",
          permissions: [
            "project:read",
            "quest:read",
            "epic:read",
            "folio:read",
            "release:read",
          ],
        },
        { id: ownerId },
      ),
    );
  };

  it("declares the read tools in a stable order, the epic index and search as $actions", async ({
    expect,
  }) => {
    const { alepha } = await boot();
    const toolset = alepha.inject(LoreAiToolset);
    expect(toolset.inProject.map((entry) => toolset.nameOf(entry))).toEqual(
      READ_SET,
    );
    for (const name of ["getEpicRefs", "search", "searchDocs"]) {
      const action = toolset.inProject.find(
        (entry) => toolset.nameOf(entry) === name,
      )!.tool as ActionPrimitive<any>;
      expect(action.method, name).toBe("GET");
    }
    await alepha.stop();
  });

  it("offers every tool in declaration order, reads then writes, to the vendor", async ({
    expect,
  }) => {
    const { alepha } = await boot();
    const toolset = alepha.inject(LoreAiToolset);
    const assistant = alepha.inject(LoreAiAssistant).assistant;
    expect(assistant.definitions.map((tool) => tool.name)).toEqual([
      ...READ_SET,
      ...WRITE_SET,
    ]);
    expect(toolset.tools.map((tool) => tool.name)).toEqual([
      ...READ_SET,
      ...WRITE_SET,
    ]);
    await alepha.stop();
  });

  it("builds its tables once, on first read, and keeps them (#Q3398)", async ({
    expect,
  }) => {
    const { alepha } = await boot();
    const toolset = alepha.inject(LoreAiToolset);
    expect(toolset.inProject).toBe(toolset.inProject);
    expect(toolset.writes).toBe(toolset.writes);
    await alepha.stop();
  });

  it("asks for no confirmation: every read $tool declares readOnlyHint", async ({
    expect,
  }) => {
    const { alepha } = await boot();
    const toolset = alepha.inject(LoreAiToolset);
    for (const entry of toolset.inProject) {
      const tool = entry.tool as ToolPrimitive<any>;
      if (typeof tool.execute === "function") {
        expect(
          tool.options.annotations?.readOnlyHint,
          toolset.nameOf(entry),
        ).toBe(true);
      }
    }
    await alepha.stop();
  });

  it("holds the permission table to each tool's own gate", async ({
    expect,
  }) => {
    const { alepha } = await boot();
    const toolset = alepha.inject(LoreAiToolset);
    for (const entry of toolset.projectScoped) {
      expect(entry.gate, toolset.nameOf(entry)).toBeDefined();
      const required = new Set(
        entry
          .gate!.middlewares.flatMap((mw) =>
            (mw?.meta?.permissions ?? "").split(","),
          )
          .map((it) => it.trim())
          .filter(Boolean),
      );
      expect([...required].sort(), toolset.nameOf(entry)).toEqual(
        [...entry.permissions].sort(),
      );
    }
    await alepha.stop();
  });

  it("offers an owner the whole read and write set on their project", async ({
    expect,
  }) => {
    const { alepha, controller, owner, project, context, read, ai } =
      await boot();
    ai.script([{ type: "text", text: "Hi." }]);
    await read(
      await controller.chat.fetch({
        headers: owner.headers,
        body: { message: "hi", context: context(project.id) },
      }),
    );
    expect(ai.last!.tools?.map((t) => t.name)).toEqual([
      ...READ_SET,
      ...WRITE_SET,
    ]);
    await alepha.stop();
  });

  it("never offers feedback_list or feedback_get to a rank without feedback:read", async ({
    expect,
  }) => {
    const { alepha, project, owner, signIn, entities } = await boot();
    await createReaderRank(alepha, project.id, owner.id);
    const account = await entities.users.create({ roles: ["user"] });
    await createTestMember(alepha, project, account.id, { rank: "reader" });
    const reader = await signIn(account.id);

    const offered = await alepha.inject(LoreAiToolAccess).offered({
      user: reader.user,
      context: { data: { projectId: project.id } },
    });
    expect(offered).not.toContain("feedback_list");
    expect(offered).not.toContain("feedback_get");
    expect(offered).toContain("quest_list");
    await alepha.stop();
  });

  it("offers feedback_submit and feedback_targets whatever the room's rank or its Feedback option: their gate is sign-in, not the room (#Q3971)", async ({
    expect,
  }) => {
    const { alepha, project, owner, signIn, entities } = await boot();
    const toolset = alepha.inject(LoreAiToolset);
    const submit = toolset.writes.find(
      (entry) => toolset.nameOf(entry) === "feedback_submit",
    )!;
    // No `$ownsProject` on the gate: nothing in it reads a project param.
    expect(
      submit.gate!.middlewares.some((mw) => mw?.meta?.param !== undefined),
    ).toBe(false);
    expect(submit.permissions).toEqual([]);

    await createReaderRank(alepha, project.id, owner.id);
    const account = await entities.users.create({ roles: ["user"] });
    await createTestMember(alepha, project, account.id, { rank: "reader" });
    const reader = await signIn(account.id);
    const offeredReader = await alepha.inject(LoreAiToolAccess).offered({
      user: reader.user,
      context: { data: { projectId: project.id } },
    });
    expect(offeredReader).toContain("feedback_submit");
    expect(offeredReader).toContain("feedback_targets");

    const workOnly = await createTestProject(alepha, {
      capabilities: [{ key: "plan" }, { key: "remember" }],
    });
    const workOwner = await signIn(workOnly.createdBy);
    const offeredWorkOnly = await alepha.inject(LoreAiToolAccess).offered({
      user: workOwner.user,
      context: { data: { projectId: workOnly.id } },
    });
    expect(offeredWorkOnly).toContain("feedback_submit");
    await alepha.stop();
  });

  it("offers prompt_run only to a rank holding host:read, on a project with Prompts on (#Q4512)", async ({
    expect,
  }) => {
    const { alepha, project, owner, signIn, entities } = await boot();
    const access = alepha.inject(LoreAiToolAccess);
    expect(
      await access.offered({
        user: owner.user,
        context: { data: { projectId: project.id } },
      }),
    ).toContain("prompt_run");

    await createReaderRank(alepha, project.id, owner.id);
    const account = await entities.users.create({ roles: ["user"] });
    await createTestMember(alepha, project, account.id, { rank: "reader" });
    const reader = await signIn(account.id);
    expect(
      await access.offered({
        user: reader.user,
        context: { data: { projectId: project.id } },
      }),
    ).not.toContain("prompt_run");

    const workOnly = await createTestProject(alepha, {
      capabilities: [{ key: "plan" }, { key: "remember" }],
    });
    const workOwner = await signIn(workOnly.createdBy);
    expect(
      await access.offered({
        user: workOwner.user,
        context: { data: { projectId: workOnly.id } },
      }),
    ).not.toContain("prompt_run");
    await alepha.stop();
  });

  it("never offers feedback_list or feedback_get on a project with Feedback off", async ({
    expect,
  }) => {
    const { alepha, signIn } = await boot();
    const workOnly = await createTestProject(alepha, {
      capabilities: [{ key: "plan" }, { key: "remember" }],
    });
    const owner = await signIn(workOnly.createdBy);
    const offered = await alepha.inject(LoreAiToolAccess).offered({
      user: owner.user,
      context: { data: { projectId: workOnly.id } },
    });
    expect(offered).not.toContain("feedback_list");
    expect(offered).not.toContain("feedback_get");
    expect(offered).toContain("folio_get");
    await alepha.stop();
  });

  it("offers nothing project-scoped in a project the user is not a member of", async ({
    expect,
  }) => {
    const { alepha, signIn } = await boot();
    const stranger = await signIn();
    const other = await createTestProject(alepha, { title: "Other" });
    const offered = await alepha.inject(LoreAiToolAccess).offered({
      user: stranger.user,
      context: { data: { projectId: other.id } },
    });
    expect(offered).toEqual([]);
    await alepha.stop();
  });

  it("runs a $tool through its action's $ownsProject: a call on a project the user is not in is refused", async ({
    expect,
  }) => {
    const { alepha, controller, owner, project, context, read, ai } =
      await boot();
    const other = await createTestProject(alepha, { title: "Elsewhere" });
    ai.script([
      {
        type: "tool_call",
        id: "call-1",
        name: "quest_list",
        input: { project: other.id },
      },
    ]);
    ai.script([{ type: "text", text: "Not found." }]);

    const events = await read(
      await controller.chat.fetch({
        headers: owner.headers,
        body: { message: "list quests", context: context(project.id) },
      }),
    );
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({
      name: "quest_list",
      isError: true,
    });
    const toolMessage = ai.last!.messages.find((m) => m.role === "tool")!;
    expect(toolMessage.content).toMatch(/not found|forbidden|denied/i);
    await alepha.stop();
  });

  it("runs a read tool as the turn's user on their own project", async ({
    expect,
  }) => {
    const { alepha, controller, owner, project, context, read, ai } =
      await boot();
    ai.script([
      {
        type: "tool_call",
        id: "call-1",
        name: "project_info",
        input: { project: project.id },
      },
    ]);
    ai.script([{ type: "text", text: "It is Acme." }]);
    const events = await read(
      await controller.chat.fetch({
        headers: owner.headers,
        body: { message: "which project?", context: context(project.id) },
      }),
    );
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({
      name: "project_info",
      isError: false,
    });
    const toolMessage = ai.last!.messages.find((m) => m.role === "tool")!;
    expect(toolMessage.content).toContain("Acme");
    await alepha.stop();
  });
});
