import {
  ChatAgentController,
  ChatAgentRunner,
  ChatMessageController,
  ChatRoomController,
} from "@lore/chat/api";
import { createTestProject } from "@lore/core/testing";
import { QuestController } from "@lore/plan/api";
import { AI_TURN_WRAP_UP, AiProvider } from "alepha/ai";
import { describe, it } from "vitest";

import { bootAssistant } from "./fixtures/bootAssistant.ts";
import { MeteredAiProvider } from "./fixtures/MeteredAiProvider.ts";

/**
 * How many rounds of tool calls a chat agent gets for one message (#Q4427).
 *
 * Every model call of a run resends the assistant's tool definitions and
 * system prompt: about 80 KB, so 27k tokens at three bytes a token. Counted
 * at full price against the 100k of `turnTokens`, a run was told to answer
 * after its second round, whatever the rounds read. The bound now counts a
 * cache read at a tenth, as the AI budget does, so on a vendor that caches
 * the prefix a run pays it once.
 *
 * ⚠️ The first spec also guards the toolset's size: a first call past a
 * third of `turnTokens` leaves a run on a cold cache one round, and fails it.
 */
describe("a chat agent's rounds of tool calls", () => {
  const boot = async () => {
    const ctx = await bootAssistant({
      enabled: "1",
      extra: (alepha) => {
        alepha.with({ provide: AiProvider, use: MeteredAiProvider });
      },
    });
    // Every capability on, as in a project that uses all of Lore: the
    // agent is offered the whole toolset.
    const project = await createTestProject(ctx.alepha, {
      title: "Acme",
      capabilities: [
        { key: "plan" },
        { key: "remember" },
        { key: "ship" },
        { key: "chat" },
        { key: "prompts" },
      ],
    });
    const owner = await ctx.signIn(project.createdBy);
    const quests = ctx.alepha.inject(QuestController);
    const file = async (title: string, tag: string) =>
      (
        await quests.createQuest.fetch(
          {
            body: {
              projectId: project.id,
              title,
              area: "web",
              priority: "medium",
              tags: [tag],
            },
          },
          { user: owner.user },
        )
      ).data;
    const waiting = await file(
      "Which storage for the importer?",
      "needs-human",
    );
    await file("Rename the export button?", "needs-human");
    const room = (
      await ctx.alepha.inject(ChatRoomController).createChatRoom.fetch(
        {
          params: { projectId: project.id },
          body: { name: "general", private: false },
        },
        { user: owner.user },
      )
    ).data;
    await ctx.alepha.inject(ChatAgentController).createChatAgent.fetch(
      {
        params: { projectId: project.id },
        body: {
          handle: "berry",
          name: "Berry",
          prePrompt:
            "List the open quests tagged needs-answer, then those tagged needs-human, then read the first one's discussion with quest_get.",
        },
      },
      { user: owner.user },
    );
    const ai = ctx.ai as MeteredAiProvider;
    const messages = ctx.alepha.inject(ChatMessageController);
    const ask = async (body: string) => {
      await messages.sendChatMessage.fetch(
        { params: { projectId: project.id, roomId: room.id }, body: { body } },
        { user: owner.user },
      );
      await ctx.alepha.inject(ChatAgentRunner).settled();
      return (
        await messages.listChatMessages.fetch(
          { params: { projectId: project.id, roomId: room.id }, query: {} },
          { user: owner.user },
        )
      ).data.items.find((it) => it.agent);
    };
    /**
     * The playbook's three reads, one a round, then one more of each.
     */
    const script = () => {
      const list = (id: string, tag: string) =>
        ai.script([
          {
            type: "tool_call",
            id,
            name: "quest_list",
            input: { project: project.id, tag, status: "todo" },
          },
        ]);
      const get = (id: string, shortId: number) =>
        ai.script([
          {
            type: "tool_call",
            id,
            name: "quest_get",
            input: { project: project.id, shortId },
          },
        ]);
      list("c1", "needs-answer");
      list("c2", "needs-human");
      get("c3", waiting.shortId);
      return { list, get };
    };
    const toolResults = () =>
      ai.requests[ai.requests.length - 1]!.messages.filter(
        (it) => it.role === "tool",
      );
    return { ...ctx, ai, ask, script, toolResults, waiting };
  };

  it("runs three sequential reads (list, list, get) and answers from the third", async ({
    expect,
  }) => {
    const ctx = await boot();
    ctx.script();
    ctx.ai.script([{ type: "text", text: "It asks which storage to use." }]);

    const answer = await ctx.ask("@berry any news?");

    expect(answer?.agentRun).toMatchObject({
      status: "done",
      tools: [
        { name: "quest_list", state: "done" },
        { name: "quest_list", state: "done" },
        { name: "quest_get", state: "done" },
      ],
    });
    expect(answer?.body).toBe("It asks which storage to use.");
    // The third call ran, and nothing told the model to stop reading.
    const results = ctx.toolResults();
    expect(results).toHaveLength(3);
    expect(results[2]!.content).toContain("Which storage for the importer?");
    expect(results.some((it) => it.content.includes(AI_TURN_WRAP_UP))).toBe(
      false,
    );
    // What the bound was counting four times over: the prefix of every call.
    expect(ctx.ai.prefixes[0]).toBeGreaterThan(20_000);
  });

  it("still ends a run at the bound on a vendor with no prompt cache", async ({
    expect,
  }) => {
    const ctx = await boot();
    ctx.ai.caching = false;
    const { list, get } = ctx.script();
    list("c4", "regression");
    get("c5", ctx.waiting.shortId + 1);
    list("c6", "bug");

    const answer = await ctx.ask("@berry any news?");

    // Four full-price calls of the prefix are past 100k: the run was told
    // to answer before that, and the call it asked for anyway did not run.
    expect(ctx.ai.requests.length).toBeLessThanOrEqual(4);
    expect(
      ctx.toolResults().some((it) => it.content.includes(AI_TURN_WRAP_UP)),
    ).toBe(true);
    expect(answer?.agentRun?.tools?.at(-1)).toMatchObject({ state: "failed" });
  });
});
