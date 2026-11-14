import { createTestProject } from "@lore/core/testing";
import { createTestQuest } from "@lore/plan/testing";
import { audits } from "alepha/api/audits";
import type { ToolPrimitive } from "alepha/mcp";
import { $repository } from "alepha/orm";
import { describe, it } from "vitest";

import { LoreAiToolset } from "@/assistant/index.ts";

import { bootAssistant } from "./fixtures/bootAssistant.ts";

class AuditRows {
  public readonly audits = $repository(audits);
}

/**
 * The write tools (#Q3210): each pauses on a card, a denial runs nothing, an
 * approval runs the tool through its own action's gate, and every answer is
 * audited under the user and the call's project.
 */
describe("the assistant's write tools", () => {
  const boot = async () => {
    const ctx = await bootAssistant({
      enabled: "1",
      extra: (alepha) => {
        alepha.inject(AuditRows);
      },
    });
    const rows = ctx.alepha.inject(AuditRows);
    const project = await createTestProject(ctx.alepha, { title: "Acme" });
    const owner = await ctx.signIn(project.createdBy);
    const quest = await createTestQuest(ctx.alepha, project, {
      title: "Ship the dock",
    });
    const context = {
      route: "/acme",
      page: "project",
      data: { projectId: project.id, projectTitle: "Acme", language: "en" },
    };
    /**
     * One turn in which the model calls `name` with `input`, paused on the
     * card; returns the conversation and the call.
     */
    const pausedOn = async (name: string, input: Record<string, unknown>) => {
      ctx.ai.script([{ type: "tool_call", id: "call-1", name, input }]);
      const events = await ctx.read(
        await ctx.controller.chat.fetch({
          headers: owner.headers,
          body: { message: "please", context },
        }),
      );
      return {
        events,
        conversationId: events[0].conversationId!,
      };
    };
    const answer = async (
      conversationId: string,
      decision: "approve" | "deny",
    ) => {
      ctx.ai.script([{ type: "text", text: "Done." }]);
      return ctx.read(
        await ctx.controller.resume.fetch({
          headers: owner.headers,
          params: { id: conversationId },
          body: { callId: "call-1", decision, context },
        }),
      );
    };
    return { ...ctx, rows, project, owner, quest, context, pausedOn, answer };
  };

  it("never marks a write tool readOnlyHint: true, so each waits for a card", async ({
    expect,
  }) => {
    const { alepha } = await boot();
    const toolset = alepha.inject(LoreAiToolset);
    expect(toolset.writes.map((entry) => toolset.nameOf(entry))).toEqual([
      "quest_create",
      "quest_comment_add",
      "quest_update",
      "quest_complete",
      "folio_create",
    ]);
    for (const entry of toolset.writes) {
      const tool = entry.tool as ToolPrimitive<any>;
      expect(
        tool.options.annotations?.readOnlyHint,
        toolset.nameOf(entry),
      ).not.toBe(true);
    }
    await alepha.stop();
  });

  it("pauses a write on a confirm event and runs nothing when denied", async ({
    expect,
  }) => {
    const { alepha, entities, project, pausedOn, answer, rows, owner } =
      await boot();
    const before = await entities.quests.count();

    const { events, conversationId } = await pausedOn("quest_create", {
      project: project.id,
      title: "Filed by the assistant",
      area: "api",
    });
    expect(events.find((e) => e.type === "confirm")).toMatchObject({
      name: "quest_create",
    });
    expect(await entities.quests.count()).toBe(before);

    const resumed = await answer(conversationId, "deny");
    expect(resumed.find((e) => e.type === "tool_result")).toMatchObject({
      name: "quest_create",
      isError: true,
    });
    expect(await entities.quests.count()).toBe(before);

    const [row] = await rows.audits.findMany({
      where: { type: { eq: "assistant" } },
    });
    expect(row).toMatchObject({
      action: "deny",
      userId: owner.id,
      scopeType: "project",
      scopeId: String(project.id),
      resourceId: "quest_create",
    });
    await alepha.stop();
  });

  it("runs an approved comment through the tool's own gate and stores it as agent-authored, client lore-ai", async ({
    expect,
  }) => {
    const { alepha, entities, project, quest, pausedOn, answer, rows } =
      await boot();

    const { conversationId } = await pausedOn("quest_comment_add", {
      project: project.id,
      shortId: quest.shortId,
      body: "Looks good to me.",
      as: "lore-ai",
    });
    const resumed = await answer(conversationId, "approve");
    expect(resumed.find((e) => e.type === "tool_result")).toMatchObject({
      name: "quest_comment_add",
      isError: false,
    });

    const [comment] = await entities.questComments.findMany({
      where: { questId: { eq: quest.id } },
    });
    expect(comment.body).toBe("Looks good to me.");
    expect(comment.source).toMatchObject({ kind: "mcp", client: "lore-ai" });

    const [row] = await rows.audits.findMany({
      where: { type: { eq: "assistant" } },
    });
    expect(row).toMatchObject({
      action: "approve",
      scopeId: String(project.id),
      resourceId: "quest_comment_add",
    });
    await alepha.stop();
  });

  it("refuses an approved write the tool's gate does not allow: a project the user is not in", async ({
    expect,
  }) => {
    const { alepha, entities, pausedOn, answer } = await boot();
    const other = await createTestProject(alepha, { title: "Elsewhere" });
    const theirs = await createTestQuest(alepha, other);

    const { conversationId } = await pausedOn("quest_comment_add", {
      project: other.id,
      shortId: theirs.shortId,
      body: "Not mine to say.",
      as: "lore-ai",
    });
    const resumed = await answer(conversationId, "approve");
    expect(resumed.find((e) => e.type === "tool_result")).toMatchObject({
      name: "quest_comment_add",
      isError: true,
    });
    expect(
      await entities.questComments.findMany({
        where: { questId: { eq: theirs.id } },
      }),
    ).toEqual([]);
    await alepha.stop();
  });
});
