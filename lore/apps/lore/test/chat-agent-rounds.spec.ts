import {
  ChatAgentController,
  ChatAgentRunner,
  ChatMessageController,
  ChatRoomController,
} from "@lore/chat/api";
import { AgentAutomationService } from "@lore/core/api";
import { createTestProject } from "@lore/core/testing";
import { describe, it } from "vitest";

import { bootAssistant } from "./fixtures/bootAssistant.ts";

/**
 * A chat agent's rounds (#Q4236): an agent automation of kind `chat` runs a
 * project chat agent in a room on its trigger, as its owner, in Lore rather
 * than on an Agent host; an answer with nothing to report posts nothing.
 */
describe("a chat agent's rounds", () => {
  const boot = async () => {
    const ctx = await bootAssistant({ enabled: "1" });
    const project = await createTestProject(ctx.alepha, {
      title: "Acme",
      capabilities: [{ key: "plan" }, { key: "chat" }],
    });
    const owner = await ctx.signIn(project.createdBy);
    const room = (
      await ctx.alepha.inject(ChatRoomController).createChatRoom.fetch(
        {
          params: { projectId: project.id },
          body: { name: "ops", private: false },
        },
        { user: owner.user },
      )
    ).data;
    await ctx.alepha.inject(ChatAgentController).createChatAgent.fetch(
      {
        params: { projectId: project.id },
        body: {
          handle: "bruce",
          name: "Bruce",
          prePrompt: "Inspect the project unasked.",
        },
      },
      { user: owner.user },
    );
    const automations = ctx.alepha.inject(AgentAutomationService);
    const create = (body: Record<string, unknown>) =>
      automations.create(project.id, owner.id, {
        name: "rounds",
        promptKind: "chat",
        agent: "bruce",
        room: "ops",
        promptText: "Do the morning rounds.",
        on: "daily@7",
        ...body,
      } as never);
    const answers = async () =>
      (
        await ctx.alepha
          .inject(ChatMessageController)
          .listChatMessages.fetch(
            { params: { projectId: project.id, roomId: room.id }, query: {} },
            { user: owner.user },
          )
      ).data.items.filter((it) => it.agent);
    return {
      ...ctx,
      project,
      owner,
      automations,
      create,
      answers,
      runner: ctx.alepha.inject(ChatAgentRunner),
    };
  };

  it("runs the agent in its room as the owner, on its schedule, with no host", async ({
    expect,
  }) => {
    const ctx = await boot();
    const automation = await ctx.create({});
    ctx.ai.script([{ type: "text", text: "Two errors since yesterday." }]);

    // What the hourly job calls when it is due: no Agent host in the
    // project, and it runs all the same.
    const outcome = await ctx.automations.runTriggered(automation);
    await ctx.runner.settled();

    expect(outcome.skipped).toBeUndefined();
    const [answer] = await ctx.answers();
    expect(answer).toMatchObject({
      agent: "bruce",
      body: "Two errors since yesterday.",
      agentRun: { status: "done", mentionerId: ctx.owner.id },
    });
    // The agent was told its words and that nobody mentioned it.
    const sent = JSON.stringify(ctx.ai.requests[0]);
    expect(sent).toContain("Do the morning rounds.");
    expect(sent).toContain("Nobody mentioned you");
    expect(sent).toContain("Inspect the project unasked.");
  });

  it("posts nothing when the agent has nothing to report", async ({
    expect,
  }) => {
    const ctx = await boot();
    const automation = await ctx.create({});
    ctx.ai.script([{ type: "text", text: "NOTHING TO REPORT" }]);

    await ctx.automations.run(automation, { startedBy: ctx.owner.id });
    await ctx.runner.settled();

    expect(ctx.ai.requests).toHaveLength(1);
    expect(await ctx.answers()).toEqual([]);
  });

  it("skips a room that is gone, and refuses a row that cannot run", async ({
    expect,
  }) => {
    const ctx = await boot();
    const automation = await ctx.create({ room: "nowhere" });

    const outcome = await ctx.automations.runTriggered(automation);

    expect(outcome.skipped).toBe("No room #nowhere");
    await expect(ctx.create({ name: "no-room", room: "" })).rejects.toThrow(
      /names its agent/,
    );
    await expect(
      ctx.create({ name: "hosted", host: "desktop" }),
    ).rejects.toThrow(/no host and no model/);
    await expect(
      ctx.create({ name: "idle", onlyIfWork: true }),
    ).rejects.toThrow(/nothing to report/);
    await expect(
      ctx.automations.create(ctx.project.id, ctx.owner.id, {
        name: "roomy",
        promptKind: "text",
        promptText: "Hi",
        room: "ops",
      } as never),
    ).rejects.toThrow(/Only a chat automation names a room/);
  });
});
