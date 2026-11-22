import {
  ProjectCapabilityHooks,
  ProjectRoster,
  ProjectSecurityService,
} from "@lore/core/api";
import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "alepha/server";

import { type ChatMessage, chatMessages } from "../entities/chatMessages.ts";
import { chatRoomMembers } from "../entities/chatRoomMembers.ts";
import { type ChatRoom, chatRooms } from "../entities/chatRooms.ts";
import {
  CHAT_PREVIEW_LENGTH,
  type ChatRoomResource,
} from "../schemas/chatRoomResourceSchema.ts";
import { ChatAudience } from "./ChatAudience.ts";
import { ChatLive } from "./ChatLive.ts";

/**
 * The room model of Chat (#E161, #Q3925), and its one privacy rule: a private
 * room does not exist for anyone outside it. Every read that names a room
 * goes through {@link visibleRoom}, which answers a 404 for a room that does
 * not exist, one in another project, and a private one the caller is not in,
 * so the three cannot be told apart.
 *
 * Who may do what, beyond the action's `chat:read` / `chat:write` gate:
 *
 * - rename, archive, unarchive: `chat:manage`, or the room's creator;
 * - invite and remove, on a private room: its members with `chat:write`
 *   invite, `chat:manage` or the creator removes;
 * - join, on an open room: `chat:write` (a Viewer reads open rooms and joins
 *   nothing); leave: any member.
 *
 * No transaction, no CASCADE relied on: each write is one row, and a lost
 * race leaves a state the next call reads correctly.
 */
export class ChatRoomService {
  /**
   * The room every project with chat gets, created by the capability hook.
   */
  public static readonly GENERAL = "general";

  protected readonly rooms = $repository(chatRooms);
  protected readonly members = $repository(chatRoomMembers);
  protected readonly messages = $repository(chatMessages);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly roster = $inject(ProjectRoster);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly alepha = $inject(Alepha);

  constructor() {
    // `general`, once, when chat is turned on: in the wizard or in Settings.
    // Turning chat off and on again finds it and creates nothing.
    $inject(ProjectCapabilityHooks).register({
      key: "chat",
      name: "chat.general",
      enabled: async ({ projectId, userId }) => {
        await this.ensureGeneral(projectId, userId);
      },
    });
  }

  public async ensureGeneral(
    projectId: number,
    userId?: string,
  ): Promise<ChatRoom> {
    const existing = await this.rooms.findOne({
      where: {
        projectId: { eq: projectId },
        name: { eq: ChatRoomService.GENERAL },
      },
    });
    if (existing) {
      return existing;
    }
    return this.rooms.create({
      projectId,
      name: ChatRoomService.GENERAL,
      private: false,
      ...(userId ? { createdBy: userId } : {}),
    });
  }

  /**
   * Every room the user can see in the project: the open ones, and the
   * private ones they are a member of. Archived rooms included, flagged.
   */
  public async visibleRooms(
    projectId: number,
    userId: string,
  ): Promise<ChatRoomResource[]> {
    const rooms = await this.rooms.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [{ column: "name", direction: "asc" }],
    });
    if (rooms.length === 0) {
      return [];
    }
    const memberships = await this.members.findMany({
      where: { roomId: { inArray: rooms.map((room) => room.id) } },
    });
    const visible = rooms.flatMap((room) => {
      const roomMembers = memberships.filter((it) => it.roomId === room.id);
      const mine = roomMembers.find((it) => it.userId === userId);
      if (room.private && !mine) {
        return [];
      }
      return [this.toResource(room, roomMembers.length, mine)];
    });
    // One indexed read per room, `(room_id, id)` backwards, at the same
    // time: a project has tens of rooms, not thousands.
    const latest = await Promise.all(
      visible.map((room) =>
        this.messages.findMany({
          where: { roomId: { eq: room.id } },
          orderBy: [{ column: "id", direction: "desc" }],
          limit: 1,
        }),
      ),
    );
    return visible.map((room, index) => {
      const message = latest[index]?.[0];
      return message ? { ...room, lastMessage: this.previewOf(message) } : room;
    });
  }

  protected previewOf(
    message: ChatMessage,
  ): NonNullable<ChatRoomResource["lastMessage"]> {
    const line = message.body.split("\n").find((it) => it.trim()) ?? "";
    return {
      id: message.id,
      createdAt: message.createdAt,
      ...(message.authorId ? { authorId: message.authorId } : {}),
      ...(message.agent ? { agent: message.agent } : {}),
      preview: line.trim().slice(0, CHAT_PREVIEW_LENGTH),
      ...(message.deletedAt ? { deleted: true } : {}),
    };
  }

  /**
   * One room, if the user can see it, or a 404: never a 403, which would
   * confirm that a private room exists.
   */
  public async visibleRoom(
    projectId: number,
    roomId: string,
    userId: string,
  ): Promise<ChatRoom> {
    const room = await this.rooms.findOne({ where: { id: { eq: roomId } } });
    if (!room || room.projectId !== projectId) {
      throw new NotFoundError("Room not found");
    }
    if (room.private && !(await this.membershipOf(room.id, userId))) {
      throw new NotFoundError("Room not found");
    }
    return room;
  }

  /**
   * A room by its id, whatever its privacy: for a caller that checks the
   * reader itself, as the file access rule does.
   */
  public async roomById(roomId: string): Promise<ChatRoom | undefined> {
    return (
      (await this.rooms.findOne({ where: { id: { eq: roomId } } })) ?? undefined
    );
  }

  public async resource(
    room: ChatRoom,
    userId: string,
  ): Promise<ChatRoomResource> {
    const roomMembers = await this.members.findMany({
      where: { roomId: { eq: room.id } },
    });
    return this.toResource(
      room,
      roomMembers.length,
      roomMembers.find((it) => it.userId === userId),
    );
  }

  public async create(
    projectId: number,
    userId: string,
    input: { name: string; private: boolean },
  ): Promise<ChatRoom> {
    await this.assertNameFree(projectId, input.name);
    const room = await this.rooms.create({
      projectId,
      name: input.name,
      private: input.private,
      createdBy: userId,
    });
    // The creator is the first member, of an open room as of a private one.
    await this.members.create({ roomId: room.id, userId });
    await this.changed(room);
    return room;
  }

  public async rename(
    projectId: number,
    roomId: string,
    userId: string,
    name: string,
  ): Promise<ChatRoom> {
    const room = await this.visibleRoom(projectId, roomId, userId);
    await this.assertManages(room, userId);
    if (room.name === name) {
      return room;
    }
    await this.assertNameFree(projectId, name);
    const renamed = await this.rooms.updateById(room.id, { name });
    await this.changed(renamed);
    return renamed;
  }

  public async setArchived(
    projectId: number,
    roomId: string,
    userId: string,
    archived: boolean,
  ): Promise<ChatRoom> {
    const room = await this.visibleRoom(projectId, roomId, userId);
    await this.assertManages(room, userId);
    const updated = await this.rooms.updateById(room.id, {
      archivedAt: archived ? this.dateTime.nowISOString() : null,
    } as never);
    await this.changed(updated);
    return updated;
  }

  public async join(
    projectId: number,
    roomId: string,
    userId: string,
  ): Promise<ChatRoom> {
    const room = await this.visibleRoom(projectId, roomId, userId);
    if (room.private) {
      // Only reachable by a member, who is already in.
      return room;
    }
    if (!(await this.membershipOf(room.id, userId))) {
      await this.members.create({ roomId: room.id, userId });
      await this.changed(room);
    }
    return room;
  }

  public async leave(
    projectId: number,
    roomId: string,
    userId: string,
  ): Promise<void> {
    const room = await this.visibleRoom(projectId, roomId, userId);
    await this.members.deleteMany({
      roomId: { eq: room.id },
      userId: { eq: userId },
    });
    // The one who left is told too: their list drops the private room.
    await this.changed(room, [userId]);
  }

  public async invite(
    projectId: number,
    roomId: string,
    userId: string,
    inviteeId: string,
  ): Promise<void> {
    const room = await this.visibleRoom(projectId, roomId, userId);
    if (!room.private) {
      throw new BadRequestError(
        "An open room needs no invite: every project member can join it",
      );
    }
    // Somebody who cannot read chat in this project cannot be put in a room:
    // the same 404 as an unknown user, so the call reveals nobody.
    if (!(await this.security.holds(projectId, inviteeId, "chat:read"))) {
      throw new NotFoundError("Member not found");
    }
    if (!(await this.membershipOf(room.id, inviteeId))) {
      await this.members.create({ roomId: room.id, userId: inviteeId });
      await this.changed(room);
    }
  }

  public async remove(
    projectId: number,
    roomId: string,
    userId: string,
    memberId: string,
  ): Promise<void> {
    const room = await this.visibleRoom(projectId, roomId, userId);
    if (!room.private) {
      throw new BadRequestError(
        "Nobody is removed from an open room: a member leaves it",
      );
    }
    await this.assertManages(room, userId);
    await this.members.deleteMany({
      roomId: { eq: room.id },
      userId: { eq: memberId },
    });
    await this.changed(room, [memberId]);
  }

  /**
   * Tell the people who see the room, and `also` those who just stopped
   * seeing it, that its list entry or its members changed: their pages
   * read the room list again. A hint, as every frame.
   */
  protected async changed(room: ChatRoom, also: string[] = []): Promise<void> {
    const audience = await this.alepha.inject(ChatAudience).of(room);
    await this.alepha.inject(ChatLive).send([...audience, ...also], {
      type: "room.changed",
      projectId: room.projectId,
      roomId: room.id,
    });
  }

  public async membersOf(
    projectId: number,
    roomId: string,
    userId: string,
  ): Promise<
    Array<{ userId: string; joinedAt: string; name?: string; label?: string }>
  > {
    const room = await this.visibleRoom(projectId, roomId, userId);
    const [rows, roster] = await Promise.all([
      this.members.findMany({
        where: { roomId: { eq: room.id } },
        orderBy: [{ column: "joinedAt", direction: "asc" }],
      }),
      this.roster.of(projectId),
    ]);
    return rows.map((row) => {
      const entry = roster.find((it) => it.userId === row.userId);
      return {
        userId: row.userId,
        joinedAt: row.joinedAt,
        ...(entry ? { name: entry.name, label: entry.label } : {}),
      };
    });
  }

  /**
   * A member who leaves the project leaves every room of it.
   */
  public async leaveProject(projectId: number, userId: string): Promise<void> {
    const rooms = await this.rooms.findMany({
      where: { projectId: { eq: projectId } },
      columns: ["id"],
    });
    if (rooms.length === 0) {
      return;
    }
    await this.members.deleteMany({
      roomId: { inArray: rooms.map((room) => room.id) },
      userId: { eq: userId },
    });
  }

  public async membershipOf(roomId: string, userId: string) {
    return this.members.findOne({
      where: { roomId: { eq: roomId }, userId: { eq: userId } },
    });
  }

  /**
   * `chat:manage`, or the room's creator. A 403 is safe here: the caller
   * already sees the room, so it confirms nothing.
   */
  /**
   * Order the project's rooms (#E161): each listed room takes its index as
   * its position. The action is gated on chat:manage. A room the caller
   * cannot see (a private room they are not in) is not theirs to place, so
   * an id outside the project's visible rooms is refused, not guessed at.
   */
  public async reorder(
    projectId: number,
    userId: string,
    roomIds: string[],
  ): Promise<void> {
    const visible = new Set(
      (await this.visibleRooms(projectId, userId)).map((room) => room.id),
    );
    if (new Set(roomIds).size !== roomIds.length) {
      throw new BadRequestError("A room is listed twice");
    }
    const unknown = roomIds.find((id) => !visible.has(id));
    if (unknown) {
      throw new NotFoundError(`No room '${unknown}' in this project`);
    }
    // One write per room: a project has tens of rooms. In order, so a write
    // that fails leaves a prefix placed and the rest where they were.
    for (const [position, id] of roomIds.entries()) {
      // In the project: every id was checked against its visible rooms.
      await this.rooms.updateById(id, { position });
    }
  }

  protected async assertManages(room: ChatRoom, userId: string): Promise<void> {
    if (room.createdBy === userId) {
      return;
    }
    if (await this.security.holds(room.projectId, userId, "chat:manage")) {
      return;
    }
    throw new ForbiddenError(
      "Only the room's creator, or a rank with chat:manage, can do this",
    );
  }

  protected async assertNameFree(
    projectId: number,
    name: string,
  ): Promise<void> {
    const taken = await this.rooms.findOne({
      where: { projectId: { eq: projectId }, name: { eq: name } },
    });
    if (taken) {
      throw new ConflictError(`A room named '${name}' already exists`);
    }
  }

  protected toResource(
    room: ChatRoom,
    memberCount: number,
    mine?: { notifyLevel: "mentions" | "muted" },
  ): ChatRoomResource {
    return {
      id: room.id,
      projectId: room.projectId,
      name: room.name,
      private: room.private,
      ...(room.archivedAt ? { archivedAt: room.archivedAt } : {}),
      ...(room.createdBy ? { createdBy: room.createdBy } : {}),
      createdAt: room.createdAt,
      ...(room.position !== undefined ? { position: room.position } : {}),
      memberCount,
      joined: !!mine,
      ...(mine ? { notifyLevel: mine.notifyLevel } : {}),
    };
  }
}
