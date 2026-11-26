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
 * The tools a project's chat agent declares (#Q4430).
 *
 * Every model call of a run resends the assistant's tool definitions: 76 KB
 * for the whole toolset (#Q4427). An agent that names the tools its playbook
 * uses sends those alone, which is what gives a run more than two rounds on
 * a vendor with no prompt cache (`chat-agent-rounds.spec.ts` holds the two
 * rounds of an agent that declares nothing).
 *
 * The list narrows what the mentioner is offered and never widens it, a name
 * the assistant does not have is refused when the agent is saved, and a
 * resume offers what the paused turn did.
 */
describe("the tools a chat agent declares", () => {
  type Capability = "plan" | "remember" | "ship" | "chat" | "prompts";

  const EVERYTHING: Capability[] = [
    "plan",
    "remember",
    "ship",
    "chat",
    "prompts",
  ];

  const boot = async (
    options: { capabilities?: Capability[]; enabled?: string } = {},
  ) => {
    const ctx = await bootAssistant({
      enabled: options.enabled ?? "1",
      extra: (alepha) => {
        alepha.with({ provide: AiProvider, use: MeteredAiProvider });
      },
    });
    const project = await createTestProject(ctx.alepha, {
      title: "Acme",
      capabilities: (options.capabilities ?? EVERYTHING).map((key) => ({
        key,
      })),
    });
    const owner = await ctx.signIn(project.createdBy);
    const waiting = (
      await ctx.alepha.inject(QuestController).createQuest.fetch(
        {
          body: {
            projectId: project.id,
            title: "Which storage for the importer?",
            area: "web",
            priority: "medium",
            tags: ["needs-human"],
          },
        },
        { user: owner.user },
      )
    ).data;
    const room = (
      await ctx.alepha.inject(ChatRoomController).createChatRoom.fetch(
        {
          params: { projectId: project.id },
          body: { name: "general", private: false },
        },
        { user: owner.user },
      )
    ).data;
    const agents = ctx.alepha.inject(ChatAgentController);
    const create = (tools?: string[]) =>
      agents.createChatAgent.fetch(
        {
          params: { projectId: project.id },
          body: {
            handle: "berry",
            name: "Berry",
            prePrompt:
              "List the open quests tagged needs-answer, then those tagged needs-human, then read the first one's discussion with quest_get.",
            ...(tools ? { tools } : {}),
          },
        },
        { user: owner.user },
      );
    const ai = ctx.ai as MeteredAiProvider;
    const messages = ctx.alepha.inject(ChatMessageController);
    const answer = async () =>
      (
        await messages.listChatMessages.fetch(
          { params: { projectId: project.id, roomId: room.id }, query: {} },
          { user: owner.user },
        )
      ).data.items.find((it) => it.agent);
    const ask = async (body: string) => {
      await messages.sendChatMessage.fetch(
        { params: { projectId: project.id, roomId: room.id }, body: { body } },
        { user: owner.user },
      );
      await ctx.alepha.inject(ChatAgentRunner).settled();
      return answer();
    };
    /**
     * The tool names of the model call at `index`, as the vendor got them.
     */
    const sent = (index: number) =>
      (ai.requests[index]!.tools ?? []).map((tool) => tool.name);
    return {
      ...ctx,
      ai,
      project,
      owner,
      room,
      agents,
      messages,
      create,
      ask,
      answer,
      sent,
      waiting,
    };
  };

  it("sends the two definitions an agent declares, and no other", async ({
    expect,
  }) => {
    const ctx = await boot();
    const berry = (await ctx.create(["quest_get", "quest_list"])).data;
    ctx.ai.script([{ type: "text", text: "Nothing waits." }]);

    await ctx.ask("@berry any news?");

    expect(berry.tools).toEqual(["quest_get", "quest_list"]);
    // The assistant's own order, so the vendor caches one stable prefix.
    expect(ctx.sent(0)).toEqual(["quest_list", "quest_get"]);
    // Two definitions and the system prompt, against 27k for the toolset.
    expect(ctx.ai.prefixes[0]).toBeLessThan(8_000);
  });

  it("runs list, list, get to the third call on a vendor with no prompt cache", async ({
    expect,
  }) => {
    const ctx = await boot();
    ctx.ai.caching = false;
    await ctx.create(["quest_list", "quest_get"]);
    const list = (id: string, tag: string) =>
      ctx.ai.script([
        {
          type: "tool_call",
          id,
          name: "quest_list",
          input: { project: ctx.project.id, tag, status: "todo" },
        },
      ]);
    list("c1", "needs-answer");
    list("c2", "needs-human");
    ctx.ai.script([
      {
        type: "tool_call",
        id: "c3",
        name: "quest_get",
        input: { project: ctx.project.id, shortId: ctx.waiting.shortId },
      },
    ]);
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
    const results = ctx.ai.requests
      .at(-1)!
      .messages.filter((it) => it.role === "tool");
    expect(results).toHaveLength(3);
    expect(results[2]!.content).toContain("Which storage for the importer?");
    // Nothing told the model to stop reading: four full-price calls fit.
    expect(results.some((it) => it.content.includes(AI_TURN_WRAP_UP))).toBe(
      false,
    );
    expect(ctx.ai.requests.every((it) => it.tools?.length === 2)).toBe(true);
  });

  it("never offers a declared tool the member may not be offered", async ({
    expect,
  }) => {
    // Remember is off: no member of this project is offered a folio tool.
    const ctx = await boot({ capabilities: ["plan", "chat"] });
    await ctx.create(["quest_list", "folio_search"]);
    ctx.ai.script([
      {
        type: "tool_call",
        id: "c1",
        name: "folio_search",
        input: { project: ctx.project.id, query: "storage" },
      },
    ]);
    ctx.ai.script([{ type: "text", text: "I cannot search folios here." }]);

    const answer = await ctx.ask("@berry any news?");

    expect(ctx.sent(0)).toEqual(["quest_list"]);
    // Called anyway, it is not run.
    expect(answer?.agentRun?.tools).toMatchObject([
      { name: "folio_search", state: "failed" },
    ]);
  });

  it("offers no tool, not all of them, when every declared one is refused", async ({
    expect,
  }) => {
    const ctx = await boot({ capabilities: ["plan", "chat"] });
    await ctx.create(["folio_search", "folio_get"]);
    ctx.ai.script([{ type: "text", text: "I have nothing to read with." }]);

    await ctx.ask("@berry any news?");

    expect(ctx.sent(0)).toEqual([]);
  });

  it("refuses a name the assistant does not have, on create and on update", async ({
    expect,
  }) => {
    const ctx = await boot();

    await expect(ctx.create(["quest_list", "quest_lst"])).rejects.toThrow(
      "No tool is named 'quest_lst'",
    );
    const berry = (await ctx.create(["quest_list"])).data;
    await expect(
      ctx.agents.updateChatAgent.fetch(
        {
          params: { projectId: ctx.project.id, agentId: berry.id },
          // An MCP tool the assistant is not offered is no tool of an agent.
          body: { tools: ["deploy_start"] },
        },
        { user: ctx.owner.user },
      ),
    ).rejects.toThrow("An agent may declare: project_info, quest_list");

    // The names an agent may declare are read with the agents.
    const page = (
      await ctx.agents.listChatAgents.fetch(
        { params: { projectId: ctx.project.id } },
        { user: ctx.owner.user },
      )
    ).data;
    expect(page.tools).toContain("quest_get");
    expect(page.tools).not.toContain("deploy_start");
    expect(page.tools.length).toBeGreaterThan(30);
    expect(page.items.find((it) => it.id === berry.id)?.tools).toEqual([
      "quest_list",
    ]);
  });

  it("checks the names with AI off too, where an agent is still written", async ({
    expect,
  }) => {
    const ctx = await boot({ enabled: "0" });

    await expect(ctx.create(["quest_lst"])).rejects.toThrow(
      "No tool is named 'quest_lst'",
    );
    expect((await ctx.create(["quest_list"])).data.tools).toEqual([
      "quest_list",
    ]);
  });

  it("goes back to every tool the member may be offered on an empty list", async ({
    expect,
  }) => {
    const ctx = await boot();
    const berry = (await ctx.create(["quest_list"])).data;

    const updated = (
      await ctx.agents.updateChatAgent.fetch(
        {
          params: { projectId: ctx.project.id, agentId: berry.id },
          body: { tools: [] },
        },
        { user: ctx.owner.user },
      )
    ).data;
    ctx.ai.script([{ type: "text", text: "Nothing waits." }]);
    await ctx.ask("@berry any news?");

    expect(updated.tools).toBeUndefined();
    expect(ctx.sent(0).length).toBeGreaterThan(30);
  });

  it("offers the same tools when a paused write is approved", async ({
    expect,
  }) => {
    const ctx = await boot();
    await ctx.create(["quest_create", "quest_list"]);
    ctx.ai.script([
      {
        type: "tool_call",
        id: "c1",
        name: "quest_create",
        input: {
          project: ctx.project.id,
          title: "From Berry",
          description: "Filed from the room.",
          area: "web",
          priority: "medium",
        },
      },
    ]);
    const paused = await ctx.ask("@berry file it");
    expect(paused?.agentRun).toMatchObject({
      status: "paused",
      tool: "quest_create",
    });

    ctx.ai.script([{ type: "text", text: "Filed." }]);
    await ctx.messages.decideChatAgentCall.fetch(
      {
        params: {
          projectId: ctx.project.id,
          roomId: ctx.room.id,
          messageId: paused!.id,
        },
        body: { decision: "approve" },
      },
      { user: ctx.owner.user },
    );
    await ctx.alepha.inject(ChatAgentRunner).settled();

    // The approved call ran, and the resumed call was sent the same two.
    expect(ctx.sent(1)).toEqual(["quest_list", "quest_create"]);
    expect(await ctx.answer()).toMatchObject({
      body: "Filed.",
      agentRun: {
        status: "done",
        tools: [{ name: "quest_create", state: "done" }],
      },
    });
  });
});
