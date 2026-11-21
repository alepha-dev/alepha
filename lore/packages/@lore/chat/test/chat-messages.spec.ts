import { HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ChatMessageController, ChatRoomController } from "../src/api/index.ts";
import { ChatTestKit, RecordingChatLive } from "./chatTestKit.ts";

/**
 * The messages of Chat (#E161, #Q3926): send, page, edit, delete, mentions
 * and references parsed at write, archived rooms closed to writes, the send
 * rate limit, read state in one query, and the frames each write sends to
 * exactly the members who may see the room.
 */
describe("chat messages", () => {
  let kit: ChatTestKit;
  let rooms: ChatRoomController;
  let messages: ChatMessageController;
  let frames: RecordingChatLive["frames"];

  beforeEach(async () => {
    kit = await ChatTestKit.boot();
    rooms = kit.alepha.inject(ChatRoomController);
    messages = kit.alepha.inject(ChatMessageController);
    // Every frame, recorded with who it was addressed to: that list IS the
    // privacy rule, on Node and on Workers alike.
    frames = kit.alepha.inject(RecordingChatLive).frames;
  });

  afterEach(async () => {
    await kit.stop();
  });

  const status = async (call: Promise<unknown>): Promise<number> => {
    try {
      await call;
      return 200;
    } catch (error) {
      if (error instanceof HttpError) return error.status;
      throw error;
    }
  };

  const general = async () =>
    (
      await rooms.listChatRooms.fetch(
        { params: { projectId: kit.projectId } },
        { user: kit.owner },
      )
    ).data.items.find((it) => it.name === "general")!;

  // The frames go after the response (#Q4112): a spec reading them waits
  // for the send's own frame.
  const send = async (
    user: { id: string; roles: string[] },
    roomId: string,
    body: string,
  ) => {
    const { data } = await messages.sendChatMessage.fetch(
      { params: { projectId: kit.projectId, roomId }, body: { body } },
      { user },
    );
    await kit.alepha.inject(RecordingChatLive).created(data.id);
    return data;
  };

  it("answers the sender before the frames reach the room", async ({
    expect,
  }) => {
    const room = await general();
    const live = kit.alepha.inject(RecordingChatLive);
    let release!: () => void;
    live.gate = new Promise((resolve) => {
      release = resolve;
    });

    const sent = await messages.sendChatMessage.fetch(
      {
        params: { projectId: kit.projectId, roomId: room.id },
        body: { body: "quick" },
      },
      { user: kit.member },
    );
    expect(sent.data.body).toBe("quick");
    expect(frames).toEqual([]);

    release();
    await live.created(sent.data.id);
    expect(frames.map((it) => it.message.type)).toContain("message.created");
  });

  it("pages a room backwards from the newest message", async ({ expect }) => {
    const room = await general();
    for (let i = 1; i <= 5; i++) await send(kit.member, room.id, `m${i}`);

    const params = { projectId: kit.projectId, roomId: room.id };
    const first = await messages.listChatMessages.fetch(
      { params, query: { limit: 2 } },
      { user: kit.owner },
    );
    expect(first.data.items.map((it) => it.body)).toEqual(["m5", "m4"]);
    expect(first.data.hasMore).toBe(true);

    const second = await messages.listChatMessages.fetch(
      { params, query: { limit: 2, before: first.data.items[1]!.id } },
      { user: kit.owner },
    );
    expect(second.data.items.map((it) => it.body)).toEqual(["m3", "m2"]);
  });

  it("parses mentions of the people who see the room, and references", async ({
    expect,
  }) => {
    const room = await general();
    const message = await send(
      kit.owner,
      room.id,
      `Hi @${kit.member.username} and @nobody, see #Q12 and [[#F7]], not \`#Q99\``,
    );

    expect(message.mentions).toEqual([kit.member.id]);
    expect([...message.references].sort()).toEqual(["F7", "Q12"]);
  });

  it("does not let a mention reach somebody outside a private room", async ({
    expect,
  }) => {
    const secret = await rooms.createChatRoom.fetch(
      {
        params: { projectId: kit.projectId },
        body: { name: "secret", private: true },
      },
      { user: kit.member },
    );
    const message = await send(
      kit.member,
      secret.data.id,
      `@${kit.owner.username} come here`,
    );

    expect(message.mentions).toEqual([]);
  });

  it("sends each frame to the members who may see the room, and only them", async ({
    expect,
  }) => {
    const room = await general();
    await send(kit.member, room.id, "open");
    const open = frames.at(-1)!;
    expect(open.message.type).toBe("message.created");
    expect(open.roomIds.sort()).toEqual(
      [kit.owner.id, kit.member.id, kit.viewer.id].sort(),
    );
    expect(open.roomIds).not.toContain(kit.stranger.id);

    const secret = await rooms.createChatRoom.fetch(
      {
        params: { projectId: kit.projectId },
        body: { name: "secret", private: true },
      },
      { user: kit.member },
    );
    await send(kit.member, secret.data.id, "hush");
    expect(frames.at(-1)!.roomIds).toEqual([kit.member.id]);

    // Invited, then removed: named while in, not named the moment after.
    const params = { projectId: kit.projectId, roomId: secret.data.id };
    await rooms.inviteChatRoomMember.fetch(
      { params, body: { userId: kit.owner.id } },
      { user: kit.member },
    );
    await send(kit.member, secret.data.id, "welcome");
    expect(frames.at(-1)!.roomIds.sort()).toEqual(
      [kit.member.id, kit.owner.id].sort(),
    );
    await rooms.removeChatRoomMember.fetch(
      { params: { ...params, userId: kit.owner.id } },
      { user: kit.member },
    );
    await send(kit.member, secret.data.id, "after");
    expect(frames.at(-1)!.roomIds).toEqual([kit.member.id]);
  });

  it("lets an author edit and delete their own message, chat:manage delete any", async ({
    expect,
  }) => {
    const room = await general();
    const message = await send(kit.member, room.id, "first");
    const params = {
      projectId: kit.projectId,
      roomId: room.id,
      messageId: message.id,
    };

    expect(
      await status(
        messages.editChatMessage.fetch(
          { params, body: { body: "theirs" } },
          { user: kit.owner },
        ),
      ),
    ).toBe(403);
    const edited = await messages.editChatMessage.fetch(
      { params, body: { body: "second" } },
      { user: kit.member },
    );
    expect(edited.data.body).toBe("second");
    expect(edited.data.editedAt).toBeDefined();
    expect(frames.at(-1)!.message.type).toBe("message.updated");

    // The owner holds chat:manage.
    await messages.deleteChatMessage.fetch({ params }, { user: kit.owner });
    expect(frames.at(-1)!.message).toMatchObject({
      type: "message.deleted",
      messageId: message.id,
    });
    const listed = await messages.listChatMessages.fetch(
      { params: { projectId: kit.projectId, roomId: room.id }, query: {} },
      { user: kit.member },
    );
    expect(listed.data.items[0]).toMatchObject({ id: message.id, body: "" });
    expect(listed.data.items[0]!.deletedAt).toBeDefined();
  });

  it("refuses a message in an archived room, and from a Viewer", async ({
    expect,
  }) => {
    const room = await general();
    expect(await status(send(kit.viewer, room.id, "hi"))).toBe(403);

    await rooms.archiveChatRoom.fetch(
      { params: { projectId: kit.projectId, roomId: room.id } },
      { user: kit.owner },
    );
    expect(await status(send(kit.member, room.id, "hi"))).toBe(409);
  });

  it("caps a member at 30 messages a minute", async ({ expect }) => {
    const room = await general();
    for (let i = 0; i < 30; i++) await send(kit.member, room.id, `m${i}`);

    expect(await status(send(kit.member, room.id, "one too many"))).toBe(429);
    // Another member is counted on their own.
    expect(await status(send(kit.owner, room.id, "me"))).toBe(200);
  });

  it("counts unread messages and mentions for every room in one call, and reads them away", async ({
    expect,
  }) => {
    const room = await general();
    // The owner joins, then two messages arrive, one mentioning them.
    await rooms.joinChatRoom.fetch(
      { params: { projectId: kit.projectId, roomId: room.id } },
      { user: kit.owner },
    );
    await send(kit.member, room.id, "hello");
    const last = await send(kit.member, room.id, `@${kit.owner.username} ?`);
    await send(kit.owner, room.id, "own messages are never unread");

    const counts = async () =>
      (
        await messages.getChatUnreadCounts.fetch(
          { params: { projectId: kit.projectId } },
          { user: kit.owner },
        )
      ).data.items;

    // Writing marked the room read up to the owner's own message.
    expect(await counts()).toEqual([]);

    await send(kit.member, room.id, `@${kit.owner.username} again`);
    expect(await counts()).toEqual([
      { roomId: room.id, unread: 1, mentions: 1, notifyLevel: "mentions" },
    ]);

    const latest = await messages.listChatMessages.fetch(
      {
        params: { projectId: kit.projectId, roomId: room.id },
        query: { limit: 1 },
      },
      { user: kit.owner },
    );
    await messages.markChatRoomRead.fetch(
      {
        params: { projectId: kit.projectId, roomId: room.id },
        body: { messageId: latest.data.items[0]!.id },
      },
      { user: kit.owner },
    );
    expect(await counts()).toEqual([]);
    // Read state never moves back.
    await messages.markChatRoomRead.fetch(
      {
        params: { projectId: kit.projectId, roomId: room.id },
        body: { messageId: last.id },
      },
      { user: kit.owner },
    );
    expect(await counts()).toEqual([]);
  });

  it("keeps a notify level per member and room, mentions by default", async ({
    expect,
  }) => {
    const room = await general();
    const level = async () =>
      (
        await rooms.getChatRoom.fetch(
          { params: { projectId: kit.projectId, roomId: room.id } },
          { user: kit.member },
        )
      ).data.notifyLevel;

    await send(kit.member, room.id, "joined by writing");
    expect(await level()).toBe("mentions");

    await messages.setChatRoomNotifyLevel.fetch(
      {
        params: { projectId: kit.projectId, roomId: room.id },
        body: { level: "muted" },
      },
      { user: kit.member },
    );
    expect(await level()).toBe("muted");
    // Somebody else's level is their own.
    const owner = await rooms.getChatRoom.fetch(
      { params: { projectId: kit.projectId, roomId: room.id } },
      { user: kit.owner },
    );
    expect(owner.data.notifyLevel).not.toBe("muted");
  });
});
