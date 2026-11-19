import { afterEach, beforeEach, describe, it } from "vitest";

import { ChatRoomController, ChatTyping } from "../src/api/index.ts";
import { ChatTestKit, RecordingChatLive } from "./chatTestKit.ts";

/**
 * "Is typing" (#E161, #Q3940): relayed to the room's other readers, never
 * back to the sender, never stored, and only for a room the sender may
 * write in.
 */
describe("chat typing", () => {
  let kit: ChatTestKit;
  let frames: RecordingChatLive["frames"];

  beforeEach(async () => {
    kit = await ChatTestKit.boot();
    frames = kit.alepha.inject(RecordingChatLive).frames;
  });

  afterEach(async () => {
    await kit.stop();
  });

  const general = async () =>
    (
      await kit.alepha
        .inject(ChatRoomController)
        .listChatRooms.fetch(
          { params: { projectId: kit.projectId } },
          { user: kit.owner },
        )
    ).data.items.find((it) => it.name === "general")!;

  it("tells the room's other readers, and not the one typing", async ({
    expect,
  }) => {
    const room = await general();
    const before = frames.length;

    await kit.alepha.inject(ChatTyping).relay(kit.member.id, {
      type: "typing",
      projectId: kit.projectId,
      roomId: room.id,
    });

    const sent = frames.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.message).toEqual({
      type: "typing",
      projectId: kit.projectId,
      roomId: room.id,
      userId: kit.member.id,
    });
    expect(sent[0]!.roomIds.sort()).toEqual(
      [kit.owner.id, kit.viewer.id].sort(),
    );
  });

  it("relays nothing from a reader who may not write, nor from a stranger", async ({
    expect,
  }) => {
    const room = await general();
    const before = frames.length;
    const typing = {
      type: "typing" as const,
      projectId: kit.projectId,
      roomId: room.id,
    };

    await kit.alepha.inject(ChatTyping).relay(kit.viewer.id, typing);
    await kit.alepha.inject(ChatTyping).relay(kit.stranger.id, typing);

    expect(frames.length).toBe(before);
  });
});
