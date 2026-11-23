import {
  ChatAgentController,
  ChatAgentRunner,
  ChatMessageController,
  ChatRoomController,
  ChatRoomService,
} from "@lore/chat/api";
import { createTestProject } from "@lore/core/testing";
import {
  type AiChatRequest,
  type AiEvent,
  AiProvider,
  MemoryAiProvider,
} from "alepha/ai";
import { describe, it } from "vitest";

import { bootAssistant } from "./fixtures/bootAssistant.ts";

/**
 * A model id no vendor knows, refused the way a vendor refuses one: the
 * call throws before a token arrives.
 */
class RefusingAiProvider extends MemoryAiProvider {
  public override async *chat(request: AiChatRequest): AsyncIterable<AiEvent> {
    if (request.model === "no-such-model") {
      throw new Error("model 'no-such-model' does not exist");
    }
    yield* super.chat(request);
  }
}

/**
 * A project's agent in a room (#E170, #Q4197): its pre-prompt appended after
 * Lore's system prompt, its model or the instance default, both kept on a
 * resume, its own conversation per member and room, and its name, not
 * Lore's, on what the room reads.
 */
describe("a project's chat agent in a room", () => {
  const boot = async () => {
    const ctx = await bootAssistant({
      enabled: "1",
      extra: (alepha) => {
        alepha.with({ provide: AiProvider, use: RefusingAiProvider });
      },
    });
    const project = await createTestProject(ctx.alepha, {
      title: "Acme",
      capabilities: [{ key: "plan" }, { key: "chat" }],
    });
    const owner = await ctx.signIn(project.createdBy);
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
    const messages = ctx.alepha.inject(ChatMessageController);
    const runner = ctx.alepha.inject(ChatAgentRunner);
    const create = async (body: {
      handle: string;
      name: string;
      prePrompt: string;
      model?: string;
    }) =>
      (
        await agents.createChatAgent.fetch(
          { params: { projectId: project.id }, body },
          { user: owner.user },
        )
      ).data;
    const ask = async (body: string) => {
      await messages.sendChatMessage.fetch(
        { params: { projectId: project.id, roomId: room.id }, body: { body } },
        { user: owner.user },
      );
      await runner.settled();
    };
    // Newest first.
    const answers = async () =>
      (
        await messages.listChatMessages.fetch(
          { params: { projectId: project.id, roomId: room.id }, query: {} },
          { user: owner.user },
        )
      ).data.items.filter((it) => it.agent);
    const requests = () =>
      ctx.ai.requests as Array<{ system?: string; model?: string }>;
    return {
      ...ctx,
      project,
      owner,
      room,
      agents,
      messages,
      create,
      ask,
      answers,
      requests,
    };
  };

  it("appends the agent's pre-prompt after Lore's system prompt, and runs it on its model", async ({
    expect,
  }) => {
    const ctx = await boot();
    await ctx.create({
      handle: "jarvis",
      name: "Jarvis",
      prePrompt: "Checking means: triage the feedback, then the errors.",
      model: "claude-haiku-5-5",
    });
    ctx.ai.script([{ type: "text", text: "Checked." }]);
    ctx.ai.script([{ type: "text", text: "Hello." }]);

    await ctx.ask("@jarvis time to check");
    await ctx.ask("@lore hello");

    const [jarvis, lore] = ctx.requests();
    expect(jarvis!.model).toBe("claude-haiku-5-5");
    // Lore's prompt first, whole, then the playbook in its own section.
    expect(jarvis!.system!.startsWith(lore!.system!)).toBe(true);
    expect(jarvis!.system).toContain("## You are Jarvis");
    expect(jarvis!.system).toMatch(
      /<persona-and-playbook>\nChecking means: triage the feedback, then the errors.\n<\/persona-and-playbook>$/,
    );
    expect(jarvis!.system).toContain("Every rule above still binds you");
    // `@lore` has no playbook, and the instance default model.
    expect(lore!.system).not.toContain("persona-and-playbook");
    expect(lore!.model).toBe("@cf/mistralai/mistral-small-3.1-24b-instruct");
  });

  it("runs an agent with no model on the instance default", async ({
    expect,
  }) => {
    const ctx = await boot();
    await ctx.create({
      handle: "friday",
      name: "Friday",
      prePrompt: "Be brief.",
    });
    ctx.ai.script([{ type: "text", text: "Ok." }]);

    await ctx.ask("@friday hi");

    expect(ctx.requests()[0]!.model).toBe(
      "@cf/mistralai/mistral-small-3.1-24b-instruct",
    );
  });

  it("keeps the agent's playbook and model when a paused write is approved", async ({
    expect,
  }) => {
    const ctx = await boot();
    const jarvis = await ctx.create({
      handle: "jarvis",
      name: "Jarvis",
      prePrompt: "File what you find.",
      model: "claude-haiku-5-5",
    });
    ctx.ai.script([
      {
        type: "tool_call",
        id: "call-1",
        name: "quest_create",
        input: { project: ctx.project.id, title: "From Jarvis", area: "web" },
      },
    ]);
    await ctx.ask("@jarvis file it");
    const [paused] = await ctx.answers();
    expect(paused).toMatchObject({
      agentId: jarvis.id,
      agentRun: { status: "paused", tool: "quest_create" },
    });

    // Renamed while it waits: the resume is still the same agent.
    await ctx.agents.updateChatAgent.fetch(
      {
        params: { projectId: ctx.project.id, agentId: jarvis.id },
        body: { name: "J.A.R.V.I.S." },
      },
      { user: ctx.owner.user },
    );
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

    const resumed = ctx.requests()[1]!;
    expect(resumed.model).toBe("claude-haiku-5-5");
    expect(resumed.system).toContain("File what you find.");
    expect((await ctx.answers())[0]).toMatchObject({
      id: paused!.id,
      body: "Filed.",
      agentRun: { status: "done" },
    });
  });

  it("keeps one conversation per member, room and agent", async ({
    expect,
  }) => {
    const ctx = await boot();
    const jarvis = await ctx.create({
      handle: "jarvis",
      name: "Jarvis",
      prePrompt: "Be Jarvis.",
    });
    ctx.ai.script([{ type: "text", text: "a" }]);
    ctx.ai.script([{ type: "text", text: "b" }]);
    ctx.ai.script([{ type: "text", text: "c" }]);

    await ctx.ask("@lore one");
    await ctx.ask("@jarvis two");
    await ctx.ask("@jarvis three");

    const membership = await ctx.alepha
      .inject(ChatRoomService)
      .membershipOf(ctx.room.id, ctx.owner.id);
    const threads = membership!.aiConversations!;
    expect(Object.keys(threads).sort()).toEqual([jarvis.id, "lore"].sort());
    expect(threads[jarvis.id]).not.toBe(threads.lore);
    // Jarvis's second turn continued its own thread, never Lore's: the
    // model reads Jarvis's earlier answer as its own turn, not Lore's.
    const third = ctx.ai.requests[2]!.messages;
    expect(
      third.filter((it) => it.role === "assistant").map((it) => it.content),
    ).toEqual(["b"]);
  });

  it("names the agent, not Lore, when its run fails on a model the vendor refuses", async ({
    expect,
  }) => {
    const ctx = await boot();
    await ctx.create({
      handle: "jarvis",
      name: "Jarvis",
      prePrompt: "Be Jarvis.",
      model: "no-such-model",
    });

    await ctx.ask("@jarvis hello?");

    const [answer] = await ctx.answers();
    expect(answer?.agentRun?.status).toBe("failed");
    expect(answer?.body).toContain("Jarvis could not finish");
    expect(answer?.body).toContain("no-such-model");
  });
});
