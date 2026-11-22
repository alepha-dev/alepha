import { ResourceRegistry } from "@lore/core/api";
import { createTestMemberByProjectId } from "@lore/core/testing";
import { SchemaValidationError } from "alepha";
import { HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ChatRoomController } from "../src/api/index.ts";
import { ChatTestKit } from "./chatTestKit.ts";

/**
 * The room model of Chat (#E161, #Q3925): `general` once, open rooms for
 * every reader, private rooms for their members only, a 404 for anyone else
 * on every action, and the ranks: Viewer reads, Member writes, the creator
 * or `chat:manage` manages.
 */
describe("chat rooms", () => {
  let kit: ChatTestKit;
  let rooms: ChatRoomController;

  beforeEach(async () => {
    kit = await ChatTestKit.boot();
    rooms = kit.alepha.inject(ChatRoomController);
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
      // A body the schema refuses is a 400 over HTTP; `fetch` throws it
      // before the request is sent.
      if (error instanceof SchemaValidationError) return 400;
      throw error;
    }
  };

  const list = async (user: { id: string; roles: string[] }) =>
    (
      await rooms.listChatRooms.fetch(
        { params: { projectId: kit.projectId } },
        { user },
      )
    ).data.items.map((it) => it.name);

  const create = async (
    user: { id: string; roles: string[] },
    name: string,
    isPrivate = false,
  ) =>
    (
      await rooms.createChatRoom.fetch(
        {
          params: { projectId: kit.projectId },
          body: { name, private: isPrivate },
        },
        { user },
      )
    ).data;

  it("gives a project with chat one general room, never a second", async ({
    expect,
  }) => {
    expect(await list(kit.owner)).toEqual(["general"]);

    for (const enabled of [false, true]) {
      await kit.capabilities.setCapability.fetch(
        {
          params: { projectId: kit.projectId, key: "chat" },
          body: { enabled },
        },
        { user: kit.owner },
      );
    }

    expect(await list(kit.owner)).toEqual(["general"]);
  });

  it("lists an open room to every reader and a private one to its members only", async ({
    expect,
  }) => {
    await create(kit.member, "design");
    await create(kit.member, "secret", true);

    expect(await list(kit.member)).toEqual(["design", "general", "secret"]);
    expect(await list(kit.viewer)).toEqual(["design", "general"]);
    expect(await list(kit.owner)).toEqual(["design", "general"]);
    expect(await status(list(kit.stranger))).toBe(403);
  });

  it("answers 404 on every action for a private room the caller is not in", async ({
    expect,
  }) => {
    const secret = await create(kit.member, "secret", true);
    const params = { projectId: kit.projectId, roomId: secret.id };
    const user = { user: kit.owner };

    const calls = [
      () => rooms.getChatRoom.fetch({ params }, user),
      () =>
        rooms.renameChatRoom.fetch({ params, body: { name: "renamed" } }, user),
      () => rooms.archiveChatRoom.fetch({ params }, user),
      () => rooms.unarchiveChatRoom.fetch({ params }, user),
      () => rooms.joinChatRoom.fetch({ params }, user),
      () => rooms.leaveChatRoom.fetch({ params }, user),
      () => rooms.listChatRoomMembers.fetch({ params }, user),
      () =>
        rooms.inviteChatRoomMember.fetch(
          { params, body: { userId: kit.owner.id } },
          user,
        ),
      () =>
        rooms.removeChatRoomMember.fetch(
          { params: { ...params, userId: kit.member.id } },
          user,
        ),
    ];
    for (const call of calls) {
      expect(await status(call())).toBe(404);
    }
    // The same answer as a room that does not exist at all.
    expect(
      await status(
        rooms.getChatRoom.fetch(
          { params: { ...params, roomId: crypto.randomUUID() } },
          user,
        ),
      ),
    ).toBe(404);
  });

  it("lets a member invite into a private room, and the creator remove", async ({
    expect,
  }) => {
    const secret = await create(kit.member, "secret", true);
    const params = { projectId: kit.projectId, roomId: secret.id };

    await rooms.inviteChatRoomMember.fetch(
      { params, body: { userId: kit.owner.id } },
      { user: kit.member },
    );
    expect(await list(kit.owner)).toContain("secret");
    const members = await rooms.listChatRoomMembers.fetch(
      { params },
      { user: kit.owner },
    );
    expect(members.data.items.map((it) => it.userId).sort()).toEqual(
      [kit.member.id, kit.owner.id].sort(),
    );

    // Nobody outside the project can be put in, and the answer reveals
    // nothing about them.
    expect(
      await status(
        rooms.inviteChatRoomMember.fetch(
          { params, body: { userId: kit.stranger.id } },
          { user: kit.member },
        ),
      ),
    ).toBe(404);

    await rooms.removeChatRoomMember.fetch(
      { params: { ...params, userId: kit.owner.id } },
      { user: kit.member },
    );
    expect(await list(kit.owner)).not.toContain("secret");
    expect(
      await status(rooms.getChatRoom.fetch({ params }, { user: kit.owner })),
    ).toBe(404);
  });

  it("refuses a second room of the same name, whatever its case", async ({
    expect,
  }) => {
    await create(kit.member, "design");

    expect(await status(create(kit.owner, "Design"))).toBe(409);
    expect(await status(create(kit.owner, "not a name!"))).toBe(400);
  });

  it("lets the creator or chat:manage rename and archive, and nobody else", async ({
    expect,
  }) => {
    const room = await create(kit.member, "design");
    const params = { projectId: kit.projectId, roomId: room.id };

    // The owner holds chat:manage; a second member does not.
    const other = await kit.user();
    await createTestMemberByProjectId(kit.alepha, kit.projectId, other.id);

    expect(
      await status(
        rooms.renameChatRoom.fetch(
          { params, body: { name: "nope" } },
          { user: other },
        ),
      ),
    ).toBe(403);
    const renamed = await rooms.renameChatRoom.fetch(
      { params, body: { name: "design-review" } },
      { user: kit.member },
    );
    expect(renamed.data.name).toBe("design-review");

    const archived = await rooms.archiveChatRoom.fetch(
      { params },
      { user: kit.owner },
    );
    expect(archived.data.archivedAt).toBeDefined();
    const back = await rooms.unarchiveChatRoom.fetch(
      { params },
      { user: kit.member },
    );
    expect(back.data.archivedAt).toBeUndefined();
  });

  it("orders the room list for everyone, by chat:manage only", async ({
    expect,
  }) => {
    const design = await create(kit.member, "design");
    const releases = await create(kit.member, "releases");
    const general = (
      await rooms.listChatRooms.fetch(
        { params: { projectId: kit.projectId } },
        { user: kit.owner },
      )
    ).data.items.find((it) => it.name === "general")!;
    const order = [releases.id, general.id, design.id];
    const params = { projectId: kit.projectId };

    // A member, even the rooms' creator, may not order the list.
    expect(
      await status(
        rooms.reorderChatRooms.fetch(
          { params, body: { roomIds: order } },
          { user: kit.member },
        ),
      ),
    ).toBe(403);

    await rooms.reorderChatRooms.fetch(
      { params, body: { roomIds: order } },
      { user: kit.owner },
    );
    // Every reader sees the positions the owner set.
    const seen = (
      await rooms.listChatRooms.fetch({ params }, { user: kit.viewer })
    ).data.items;
    const positionOf = (id: string) =>
      seen.find((it) => it.id === id)?.position;
    expect([releases.id, general.id, design.id].map(positionOf)).toEqual([
      0, 1, 2,
    ]);

    // A room twice, or one the caller cannot see, is refused, not guessed at.
    const secret = await create(kit.member, "secret", true);
    expect(
      await status(
        rooms.reorderChatRooms.fetch(
          { params, body: { roomIds: [design.id, design.id] } },
          { user: kit.owner },
        ),
      ),
    ).toBe(400);
    expect(
      await status(
        rooms.reorderChatRooms.fetch(
          { params, body: { roomIds: [secret.id] } },
          { user: kit.owner },
        ),
      ),
    ).toBe(404);
  });

  it("lets a Viewer read open rooms, and join, create or invite nothing", async ({
    expect,
  }) => {
    const room = await create(kit.member, "design");
    const params = { projectId: kit.projectId, roomId: room.id };

    expect(
      (await rooms.getChatRoom.fetch({ params }, { user: kit.viewer })).data
        .name,
    ).toBe("design");
    expect(
      await status(rooms.joinChatRoom.fetch({ params }, { user: kit.viewer })),
    ).toBe(403);
    expect(await status(create(kit.viewer, "mine"))).toBe(403);

    // A member joins and leaves an open room.
    const joined = await rooms.joinChatRoom.fetch(
      { params },
      { user: kit.owner },
    );
    expect(joined.data.joined).toBe(true);
    await rooms.leaveChatRoom.fetch({ params }, { user: kit.owner });
    expect(
      (await rooms.getChatRoom.fetch({ params }, { user: kit.owner })).data
        .joined,
    ).toBe(false);
  });

  it("takes a member who leaves the project out of its rooms", async ({
    expect,
  }) => {
    const secret = await create(kit.member, "secret", true);
    await rooms.inviteChatRoomMember.fetch(
      {
        params: { projectId: kit.projectId, roomId: secret.id },
        body: { userId: kit.owner.id },
      },
      { user: kit.member },
    );

    await kit.projects.removeMember.fetch(
      { params: { id: kit.projectId, userId: kit.member.id } },
      { user: kit.owner },
    );

    const members = await rooms.listChatRoomMembers.fetch(
      { params: { projectId: kit.projectId, roomId: secret.id } },
      { user: kit.owner },
    );
    expect(members.data.items.map((it) => it.userId)).toEqual([kit.owner.id]);
  });

  it("adds no source to the spotlight search, which never learns who asks", async ({
    expect,
  }) => {
    // Core's search sources get the project and the needle, never the user,
    // and the same search is an agent tool: a room source there would list
    // private rooms to anyone (#Q3955). Rooms are found by the jump list.
    const kinds = kit.alepha.inject(ResourceRegistry).all();

    expect(
      kinds.filter((kind) => kind.kind.startsWith("chat") || kind.search),
    ).toEqual([]);
  });
});
