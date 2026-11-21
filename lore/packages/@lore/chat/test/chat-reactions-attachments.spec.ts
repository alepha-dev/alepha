import { FileAccessRegistry } from "@lore/core/api";
import { SchemaValidationError } from "alepha";
import { FileService } from "alepha/api/files";
import { HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  ChatBuckets,
  ChatMessageController,
  ChatRoomController,
} from "../src/api/index.ts";
import { ChatTestKit, RecordingChatLive } from "./chatTestKit.ts";

/**
 * Reactions and attachments of Chat (#E161, #Q3939): one emoji per member
 * toggled under a message and sent live, files a message carries, read by
 * whoever reads the room, and gone with the message.
 */
describe("chat reactions and attachments", () => {
  let kit: ChatTestKit;
  let rooms: ChatRoomController;
  let messages: ChatMessageController;

  beforeEach(async () => {
    kit = await ChatTestKit.boot();
    rooms = kit.alepha.inject(ChatRoomController);
    messages = kit.alepha.inject(ChatMessageController);
  });

  afterEach(async () => {
    await kit.stop();
  });

  const png = (name = "shot.png") =>
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, {
      type: "image/png",
    });

  const general = async () =>
    (
      await rooms.listChatRooms.fetch(
        { params: { projectId: kit.projectId } },
        { user: kit.owner },
      )
    ).data.items.find((it) => it.name === "general")!;

  const upload = async (user: { id: string; roles: string[] }) =>
    (
      await messages.uploadChatAttachment.fetch(
        { params: { projectId: kit.projectId }, body: { file: png() } },
        { user },
      )
    ).data;

  const rule = () =>
    kit.alepha.inject(FileAccessRegistry).rule(ChatBuckets.ATTACHMENT_BUCKET)!;

  const status = async (call: () => Promise<unknown>): Promise<number> => {
    try {
      await call();
      return 200;
    } catch (error) {
      if (error instanceof HttpError) return error.status;
      // A body the schema refuses never reaches the handler: a 400.
      if (error instanceof SchemaValidationError) return 400;
      throw error;
    }
  };

  it("toggles one emoji per member, counts who reacted, and sends it live", async ({
    expect,
  }) => {
    const room = await general();
    const sent = await messages.sendChatMessage.fetch(
      {
        params: { projectId: kit.projectId, roomId: room.id },
        body: { body: "ship it?" },
      },
      { user: kit.member },
    );
    // The send's own frame goes after its response (#Q4112).
    await kit.alepha.inject(RecordingChatLive).created(sent.data.id);
    const params = {
      projectId: kit.projectId,
      roomId: room.id,
      messageId: sent.data.id,
    };
    const react = (user: { id: string; roles: string[] }, emoji: "👍" | "🎉") =>
      messages.toggleChatReaction.fetch({ params, body: { emoji } }, { user });

    await react(kit.owner, "👍");
    const both = await react(kit.member, "👍");
    expect(both.data.reactions).toEqual([
      { emoji: "👍", userIds: [kit.owner.id, kit.member.id] },
    ]);
    const frames = kit.alepha.inject(RecordingChatLive).frames;
    expect(frames.at(-1)!.message.type).toBe("message.updated");

    // A second click takes it back.
    const back = await react(kit.owner, "👍");
    expect(back.data.reactions).toEqual([
      { emoji: "👍", userIds: [kit.member.id] },
    ]);
    // An emoji outside the fixed set is refused.
    expect(
      await status(() =>
        messages.toggleChatReaction.fetch(
          { params, body: { emoji: "🦄" as never } },
          { user: kit.owner },
        ),
      ),
    ).toBe(400);
  });

  it("sends files with a message, readable by the room, gone with the message", async ({
    expect,
  }) => {
    const room = await general();
    const file = await upload(kit.member);
    const sent = await messages.sendChatMessage.fetch(
      {
        params: { projectId: kit.projectId, roomId: room.id },
        body: { attachments: [file.id] },
      },
      { user: kit.member },
    );
    expect(sent.data.attachments).toEqual([
      expect.objectContaining({
        id: file.id,
        name: "shot.png",
        url: `/api/files/${file.id}`,
      }),
    ]);
    expect(await rule()(file.id, { id: kit.viewer.id })).toEqual({
      projectId: kit.projectId,
      permission: "chat:read",
    });

    await messages.deleteChatMessage.fetch(
      {
        params: {
          projectId: kit.projectId,
          roomId: room.id,
          messageId: sent.data.id,
        },
      },
      { user: kit.member },
    );
    expect(
      await kit.alepha.inject(FileService).fileRepository.findOne({
        where: { id: { eq: file.id } },
      }),
    ).toBeUndefined();
  });

  it("answers a private room's file 404 to a non-member, whatever their rank", async ({
    expect,
  }) => {
    const secret = await rooms.createChatRoom.fetch(
      {
        params: { projectId: kit.projectId },
        body: { name: "secret", private: true },
      },
      { user: kit.member },
    );
    const file = await upload(kit.member);
    await messages.sendChatMessage.fetch(
      {
        params: { projectId: kit.projectId, roomId: secret.data.id },
        body: { body: "plans", attachments: [file.id] },
      },
      { user: kit.member },
    );

    // The owner holds chat:read, and every other permission: not a member.
    expect(await status(() => rule()(file.id, { id: kit.owner.id }))).toBe(404);
    expect(await rule()(file.id, { id: kit.member.id })).toEqual({
      projectId: kit.projectId,
      permission: "chat:read",
    });
  });

  it("carries only the sender's own chat uploads, and refuses an empty message", async ({
    expect,
  }) => {
    const room = await general();
    const theirs = await upload(kit.owner);
    const params = { projectId: kit.projectId, roomId: room.id };

    expect(
      await status(() =>
        messages.sendChatMessage.fetch(
          { params, body: { body: "look", attachments: [theirs.id] } },
          { user: kit.member },
        ),
      ),
    ).toBe(400);
    expect(
      await status(() =>
        messages.sendChatMessage.fetch(
          { params, body: {} },
          { user: kit.member },
        ),
      ),
    ).toBe(400);
  });
});
