import { ChatAgentRunner, ChatRoomController } from "@lore/chat/api";
import { ChatTools } from "@lore/chat/mcp";
import {
  createTestMemberByProjectId,
  createTestProject,
} from "@lore/core/testing";
import { currentUserAtom } from "alepha/security";
import { describe, it } from "vitest";

import { bootAssistant } from "./fixtures/bootAssistant.ts";

/**
 * Chat over MCP (#E161, #Q3933): the rooms, a room's messages, a message
 * sent as the caller. The API's rules are the tools' rules: a private room
 * the caller is not in does not exist for them.
 */
describe("chat tools", () => {
  const boot = async (enabled = "0") => {
    const ctx = await bootAssistant({ enabled });
    const project = await createTestProject(ctx.alepha, {
      title: "Acme",
      capabilities: [{ key: "plan" }, { key: "chat" }],
    });
    const owner = await ctx.signIn(project.createdBy);
    const member = await ctx.signIn();
    await createTestMemberByProjectId(ctx.alepha, project.id, member.id);
    const rooms = ctx.alepha.inject(ChatRoomController);
    for (const [name, isPrivate] of [
      ["general", false],
      ["secret", true],
    ] as const) {
      await rooms.createChatRoom.fetch(
        {
          params: { projectId: project.id },
          body: { name, private: isPrivate },
        },
        { user: owner.user as never },
      );
    }
    const tools = ctx.alepha.inject(ChatTools);
    // As the transport runs a tool: the caller is in the request context.
    const call = <R>(userId: string, fn: () => R): R =>
      ctx.alepha.context.run(() => {
        ctx.alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] });
        return fn();
      });
    return { ...ctx, project, owner, member, tools, call };
  };

  it("lists the rooms the caller can see, private ones only to their members", async ({
    expect,
  }) => {
    const ctx = await boot();
    const names = async (userId: string) =>
      (
        await ctx.call(userId, () =>
          ctx.tools.chat_room_list.execute({ project: ctx.project.id }),
        )
      ).rooms
        .map((room: { name: string }) => room.name)
        .sort();

    expect(await names(ctx.owner.id)).toEqual(["general", "secret"]);
    expect(await names(ctx.member.id)).toEqual(["general"]);
  });

  it("sends as the caller and reads it back, and finds no private room it is not in", async ({
    expect,
  }) => {
    const ctx = await boot();

    const sent = await ctx.call(ctx.member.id, () =>
      ctx.tools.chat_message_send.execute({
        project: ctx.project.id,
        room: "#general",
        body: "Deployed from CI.",
      }),
    );
    const page = await ctx.call(ctx.owner.id, () =>
      ctx.tools.chat_message_list.execute({
        project: ctx.project.id,
        room: "general",
      }),
    );
    expect(page.messages[0]).toMatchObject({
      id: sent.id,
      author: ctx.member.id,
      body: "Deployed from CI.",
    });

    await expect(
      ctx.call(ctx.member.id, () =>
        ctx.tools.chat_message_send.execute({
          project: ctx.project.id,
          room: "secret",
          body: "let me in",
        }),
      ),
    ).rejects.toThrow(/No room named "secret"/);
  });

  it("reads back a message longer than 255 characters (#Q4334)", async ({
    expect,
  }) => {
    const ctx = await boot();
    const long = `${"A long agent answer. ".repeat(30)}End.`;

    await ctx.call(ctx.member.id, () =>
      ctx.tools.chat_message_send.execute({
        project: ctx.project.id,
        room: "#general",
        body: long,
      }),
    );
    const page = await ctx.call(ctx.owner.id, () =>
      ctx.tools.chat_message_list.execute({
        project: ctx.project.id,
        room: "general",
      }),
    );
    expect(long.length).toBeGreaterThan(255);
    expect(page.messages[0]?.body).toBe(long);
  });

  it("creates, reads, edits and deletes an agent, as chat:agent only", async ({
    expect,
  }) => {
    const ctx = await boot();
    const as = (userId: string) => ({
      run: <R>(fn: () => R) => ctx.call(userId, fn),
    });
    const owner = as(ctx.owner.id);
    // A real playbook runs past z.text()'s 255 characters (#Q4232).
    const playbook = "Check the feedback, then the monitors. "
      .repeat(20)
      .trim();

    await expect(
      as(ctx.member.id).run(() =>
        ctx.tools.chat_agent_create.execute({
          project: ctx.project.id,
          handle: "jarvis",
          name: "Jarvis",
        }),
      ),
    ).rejects.toThrow();
    const created = await owner.run(() =>
      ctx.tools.chat_agent_create.execute({
        project: ctx.project.id,
        handle: "jarvis",
        name: "Jarvis",
        pre_prompt: playbook,
        model: "claude-haiku-5-5",
      }),
    );
    expect(created).toMatchObject({
      handle: "jarvis",
      model: "claude-haiku-5-5",
      avatar: false,
    });

    // Every chat reader reads the playbook.
    const read = await as(ctx.member.id).run(() =>
      ctx.tools.chat_agent_get.execute({
        project: ctx.project.id,
        handle: "@jarvis",
      }),
    );
    expect(read.pre_prompt).toBe(playbook);

    const updated = await owner.run(() =>
      ctx.tools.chat_agent_update.execute({
        project: ctx.project.id,
        handle: "jarvis",
        new_handle: "friday",
        model: "",
      }),
    );
    expect(updated.handle).toBe("friday");
    expect(updated.model).toBeUndefined();

    await owner.run(() =>
      ctx.tools.chat_agent_delete.execute({
        project: ctx.project.id,
        handle: "friday",
      }),
    );
    const listed = await owner.run(() =>
      ctx.tools.chat_agent_list.execute({ project: ctx.project.id }),
    );
    expect(listed).toEqual({ agents: [], enabled: false });
  });

  it("starts the agent's run from a message sent over MCP", async ({
    expect,
  }) => {
    const ctx = await boot("1");
    await ctx.call(ctx.owner.id, () =>
      ctx.tools.chat_agent_create.execute({
        project: ctx.project.id,
        handle: "jarvis",
        name: "Jarvis",
        pre_prompt: "Answer as Jarvis.",
      }),
    );
    ctx.ai.script([{ type: "text", text: "At your service." }]);

    await ctx.call(ctx.member.id, () =>
      ctx.tools.chat_message_send.execute({
        project: ctx.project.id,
        room: "general",
        body: "@jarvis time to check",
      }),
    );
    await ctx.alepha.inject(ChatAgentRunner).settled();

    const page = await ctx.call(ctx.member.id, () =>
      ctx.tools.chat_message_list.execute({
        project: ctx.project.id,
        room: "general",
      }),
    );
    expect(page.messages[0]).toMatchObject({
      author: "Jarvis",
      body: "At your service.",
    });
  });
});
