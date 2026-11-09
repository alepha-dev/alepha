import { ProjectSecurityService } from "@lore/core/api";
import { createTestMember, createTestProject } from "@lore/core/testing";
import { RankService } from "alepha/api/organizations";
import type { ToolPrimitive } from "alepha/mcp";
import type { ActionPrimitive } from "alepha/server";
import { describe, it } from "vitest";

import { LoreAiToolAccess, LoreAiToolset } from "@/assistant/index.ts";

import { bootAssistant } from "./fixtures/bootAssistant.ts";

const WRITE_SET = [
  "quest_create",
  "quest_comment_add",
  "quest_update",
  "quest_complete",
  "folio_create",
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
  "search",
  "searchDocs",
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

  it("asks for no confirmation: every read $tool declares readOnlyHint", async ({
    expect,
  }) => {
    const { alepha } = await boot();
    const toolset = alepha.inject(LoreAiToolset);
    for (const entry of [...toolset.offProject, ...toolset.inProject]) {
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

  it("never offers feedback_list or feedback_get on a project with Support off", async ({
    expect,
  }) => {
    const { alepha, signIn } = await boot();
    const workOnly = await createTestProject(alepha, {
      capabilities: [{ key: "work" }, { key: "knowledge" }],
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
