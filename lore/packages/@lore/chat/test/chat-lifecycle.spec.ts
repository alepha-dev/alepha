import { ProjectDeletionService, ProjectMergeService } from "@lore/core/api";
import { UserService } from "alepha/api/users";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  ChatAgentController,
  ChatLifecycle,
  ChatMessageController,
  ChatRoomController,
} from "../src/api/index.ts";
import { ChatRows, ChatTestKit } from "./chatTestKit.ts";

/**
 * What happens to chat when a project is deleted or merged, and when an
 * account is deleted (#E161, #Q3954).
 */
describe("chat lifecycle", () => {
  let kit: ChatTestKit;
  let rooms: ChatRoomController;
  let messages: ChatMessageController;
  let rows: ChatRows;

  beforeEach(async () => {
    kit = await ChatTestKit.boot();
    rooms = kit.alepha.inject(ChatRoomController);
    messages = kit.alepha.inject(ChatMessageController);
    rows = kit.alepha.inject(ChatRows);
  });

  afterEach(async () => {
    await kit.stop();
  });

  const roomsOf = async (projectId: number) =>
    (
      await rooms.listChatRooms.fetch(
        { params: { projectId } },
        { user: kit.owner },
      )
    ).data.items;

  const send = async (
    user: { id: string; roles: string[] },
    projectId: number,
    roomId: string,
    body: string,
  ) =>
    (
      await messages.sendChatMessage.fetch(
        { params: { projectId, roomId }, body: { body } },
        { user },
      )
    ).data;

  /**
   * The project's `general`, a private room, messages in both and a mention.
   */
  const seed = async () => {
    const general = (await roomsOf(kit.projectId)).find(
      (it) => it.name === "general",
    )!;
    const secret = (
      await rooms.createChatRoom.fetch(
        {
          params: { projectId: kit.projectId },
          body: { name: "secret", private: true },
        },
        { user: kit.owner },
      )
    ).data;
    await send(
      kit.member,
      kit.projectId,
      general.id,
      `hi @${kit.owner.username}`,
    );
    await send(kit.owner, kit.projectId, secret.id, "hush");
    return { general, secret };
  };

  it("deletes every chat row of a deleted project, and runs again harmlessly", async ({
    expect,
  }) => {
    await seed();
    await kit.alepha.inject(ChatAgentController).createChatAgent.fetch(
      {
        params: { projectId: kit.projectId },
        body: { handle: "jarvis", name: "Jarvis" },
      },
      { user: kit.owner },
    );
    expect(await rows.mentions.count()).toBe(1);
    expect(await rows.agents.count()).toBe(1);

    await kit.alepha
      .inject(ProjectDeletionService)
      .deleteProject(kit.projectId);

    expect(await rows.rooms.count()).toBe(0);
    expect(await rows.members.count()).toBe(0);
    expect(await rows.messages.count()).toBe(0);
    expect(await rows.mentions.count()).toBe(0);
    expect(await rows.agents.count()).toBe(0);
    // A step that stopped half way is finished by running it again.
    await kit.alepha.inject(ChatLifecycle).deleteProject(kit.projectId);
    expect(await rows.rooms.count()).toBe(0);
  });

  it("moves rooms with a merged project, the merged-in general renamed general (2)", async ({
    expect,
  }) => {
    const { general } = await seed();
    const other = await kit.projects.createProject.fetch(
      { body: { title: "Beta", capabilities: [{ key: "chat" }] } },
      { user: kit.owner },
    );
    const beta = other.data.id;
    const betaGeneral = (await roomsOf(beta)).find(
      (it) => it.name === "general",
    )!;
    await send(kit.owner, beta, betaGeneral.id, "from beta");

    const plan = await kit.alepha
      .inject(ProjectMergeService)
      .merge(beta, kit.projectId);

    const chat = plan.steps.find((step) => step.name === "chat")!;
    expect(chat.moved).toEqual({ chat_rooms: 1, chat_agents: 0 });
    const names = (await roomsOf(kit.projectId)).map((it) => it.name).sort();
    expect(names).toEqual(["general", "general (2)", "secret"]);
    // The messages hang off the room, so they came with it.
    const moved = (await roomsOf(kit.projectId)).find(
      (it) => it.name === "general (2)",
    )!;
    expect(moved.id).toBe(betaGeneral.id);
    const page = await messages.listChatMessages.fetch(
      { params: { projectId: kit.projectId, roomId: moved.id }, query: {} },
      { user: kit.owner },
    );
    expect(page.data.items.map((it) => it.body)).toEqual(["from beta"]);
    expect(general.id).not.toBe(moved.id);
  });

  it("moves a merged project's agents, and refuses two live agents with one handle", async ({
    expect,
  }) => {
    const agents = kit.alepha.inject(ChatAgentController);
    const other = await kit.projects.createProject.fetch(
      { body: { title: "Beta", capabilities: [{ key: "chat" }] } },
      { user: kit.owner },
    );
    const beta = other.data.id;
    const create = (projectId: number, handle: string) =>
      agents.createChatAgent.fetch(
        { params: { projectId }, body: { handle, name: handle } },
        { user: kit.owner },
      );
    await create(kit.projectId, "jarvis");
    const { data: theirs } = await create(beta, "jarvis");
    // A deleted agent of each side has no handle, and never collides.
    const { data: gone } = await create(beta, "gone");
    await agents.deleteChatAgent.fetch(
      { params: { projectId: beta, agentId: gone.id } },
      { user: kit.owner },
    );
    const { data: here } = await create(kit.projectId, "gone");
    await agents.deleteChatAgent.fetch(
      { params: { projectId: kit.projectId, agentId: here.id } },
      { user: kit.owner },
    );
    const merge = kit.alepha.inject(ProjectMergeService);

    await expect(merge.merge(beta, kit.projectId)).rejects.toThrow("jarvis");

    await agents.deleteChatAgent.fetch(
      { params: { projectId: beta, agentId: theirs.id } },
      { user: kit.owner },
    );
    const plan = await merge.merge(beta, kit.projectId);
    const chat = plan.steps.find((step) => step.name === "chat")!;
    expect(chat.moved).toMatchObject({ chat_agents: 2 });
    expect(await rows.agents.count({ projectId: { eq: kit.projectId } })).toBe(
      4,
    );
  });

  it("keeps a deleted account's messages without their author, and drops its memberships and mentions", async ({
    expect,
  }) => {
    const { general } = await seed();
    await send(kit.member, kit.projectId, general.id, "again");
    await send(
      kit.owner,
      kit.projectId,
      general.id,
      `@${kit.member.username} ?`,
    );
    const before = await rows.messages.count();
    const mentioned = { userId: { eq: kit.member.id } };
    expect(await rows.mentions.count(mentioned)).toBe(1);

    await kit.alepha.inject(UserService).deleteUser(kit.member.id);

    expect(await rows.messages.count()).toBe(before);
    const theirs = (
      await rows.messages.findMany({ where: { roomId: { eq: general.id } } })
    ).filter((it) => it.body === "again");
    expect(theirs.map((it) => it.authorId ?? null)).toEqual([null]);
    expect(await rows.members.count(mentioned)).toBe(0);
    expect(await rows.mentions.count(mentioned)).toBe(0);
  });
});
