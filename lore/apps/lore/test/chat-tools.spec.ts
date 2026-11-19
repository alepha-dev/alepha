import { ChatRoomController } from "@lore/chat/api";
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
  const boot = async () => {
    const ctx = await bootAssistant({ enabled: "0" });
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
});
