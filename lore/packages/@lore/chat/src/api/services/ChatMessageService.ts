import { ProjectRoster, ProjectSecurityService } from "@lore/core/api";
import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DatabaseProvider, sql } from "alepha/orm";
import { $rateLimit } from "alepha/rate-limit";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
} from "alepha/server";

import { chatMentions } from "../entities/chatMentions.ts";
import { type ChatMessage, chatMessages } from "../entities/chatMessages.ts";
import { chatRoomMembers } from "../entities/chatRoomMembers.ts";
import { type ChatRoom, chatRooms } from "../entities/chatRooms.ts";
import type { ChatMessageResource } from "../schemas/chatMessageResourceSchema.ts";
import { ChatAudience } from "./ChatAudience.ts";
import { ChatLive } from "./ChatLive.ts";
import { ChatMentionParser } from "./ChatMentionParser.ts";
import { ChatRoomService } from "./ChatRoomService.ts";

/**
 * The messages of Chat (#E161, #Q3926): write, page, edit, delete, read
 * state, and the live frame each write sends.
 *
 * Every call names a room through {@link ChatRoomService.visibleRoom}, so a
 * private room the caller is not in is a 404 here as everywhere. Frames go
 * to {@link ChatAudience}, read at send time.
 */
export class ChatMessageService {
  /**
   * The newest page a list returns when it asks for no size.
   */
  public static readonly PAGE = 50;

  /**
   * Lower than every UUIDv7, valid as a `uuid` on Postgres.
   */
  protected static readonly NIL = "00000000-0000-0000-0000-000000000000";

  protected readonly messages = $repository(chatMessages);
  protected readonly mentions = $repository(chatMentions);
  protected readonly roomMembers = $repository(chatRoomMembers);
  protected readonly roomRows = $repository(chatRooms);
  protected readonly rooms = $inject(ChatRoomService);
  protected readonly audience = $inject(ChatAudience);
  protected readonly live = $inject(ChatLive);
  protected readonly parser = $inject(ChatMentionParser);
  protected readonly roster = $inject(ProjectRoster);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly database = $inject(DatabaseProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * A person's sends, counted per member: 30 a minute. A conversation never
   * comes near it; a script stuck in a loop does. The agent's messages are
   * written by the server and not counted.
   */
  protected readonly sendLimit = $rateLimit({
    name: "chat:send",
    limit: 30,
    window: [1, "minute"],
    key: (userId: string) => userId,
  });

  public async send(
    projectId: number,
    roomId: string,
    userId: string,
    body: string,
  ): Promise<{ message: ChatMessageResource; mentioned: string[] }> {
    const room = await this.rooms.visibleRoom(projectId, roomId, userId);
    this.assertOpenForWrites(room);

    const limited = await this.sendLimit.consume(userId);
    if (!limited.allowed) {
      throw new TooManyRequestsError(
        "Too many messages: at most 30 a minute. Wait a moment and send again.",
      );
    }

    // Writing in an open room joins it: the read state and the notify level
    // live on the membership row.
    await this.rooms.join(projectId, roomId, userId);

    const parsed = await this.parse(room, body);
    const message = await this.messages.create({
      roomId: room.id,
      authorId: userId,
      body,
      references: parsed.references,
    });
    await this.writeMentions(message, parsed.userIds);
    // The author has read what they wrote.
    await this.markRead(projectId, roomId, userId, message.id);

    const resource = this.toResource(message, parsed.userIds);
    await this.live.send(await this.audience.of(room), {
      type: "message.created",
      projectId,
      roomId: room.id,
      message: resource,
    });
    return { message: resource, mentioned: parsed.userIds };
  }

  /**
   * One page, newest first, older than `before` when given. Keyset on the
   * `(room_id, id)` index: a UUIDv7 is ordered by time.
   */
  public async list(
    projectId: number,
    roomId: string,
    userId: string,
    options: { before?: string; limit?: number } = {},
  ): Promise<{ items: ChatMessageResource[]; hasMore: boolean }> {
    const room = await this.rooms.visibleRoom(projectId, roomId, userId);
    const limit = options.limit ?? ChatMessageService.PAGE;
    const rows = await this.messages.findMany({
      where: {
        roomId: { eq: room.id },
        ...(options.before ? { id: { lt: options.before } } : {}),
      },
      orderBy: [{ column: "id", direction: "desc" }],
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    const mentions = page.length
      ? await this.mentions.findMany({
          where: { messageId: { inArray: page.map((it) => it.id) } },
        })
      : [];
    return {
      items: page.map((message) =>
        this.toResource(
          message,
          mentions
            .filter((it) => it.messageId === message.id && it.userId)
            .map((it) => it.userId!),
        ),
      ),
      hasMore: rows.length > limit,
    };
  }

  /**
   * An author edits their own message. Returns the members the edit
   * mentions for the first time, so a notification is sent once per member.
   */
  public async edit(
    projectId: number,
    roomId: string,
    messageId: string,
    userId: string,
    body: string,
  ): Promise<{ message: ChatMessageResource; mentioned: string[] }> {
    const room = await this.rooms.visibleRoom(projectId, roomId, userId);
    this.assertOpenForWrites(room);
    const message = await this.messageIn(room, messageId);
    if (message.authorId !== userId) {
      throw new ForbiddenError("Only its author edits a message");
    }
    if (message.deletedAt) {
      throw new ConflictError("A deleted message cannot be edited");
    }

    const before = new Set(
      (
        await this.mentions.findMany({
          where: { messageId: { eq: message.id } },
        })
      ).flatMap((it) => (it.userId ? [it.userId] : [])),
    );
    const parsed = await this.parse(room, body);
    const updated = await this.messages.updateById(message.id, {
      body,
      references: parsed.references,
      editedAt: this.dateTime.nowISOString(),
    });
    await this.mentions.deleteMany({ messageId: { eq: message.id } });
    await this.writeMentions(updated, parsed.userIds);

    const resource = this.toResource(updated, parsed.userIds);
    await this.live.send(await this.audience.of(room), {
      type: "message.updated",
      projectId,
      roomId: room.id,
      message: resource,
    });
    return {
      message: resource,
      mentioned: parsed.userIds.filter((id) => !before.has(id)),
    };
  }

  /**
   * An author deletes their own message; `chat:manage` deletes any. The row
   * stays and loses its body, so the conversation does not shift.
   */
  public async remove(
    projectId: number,
    roomId: string,
    messageId: string,
    userId: string,
  ): Promise<void> {
    const room = await this.rooms.visibleRoom(projectId, roomId, userId);
    const message = await this.messageIn(room, messageId);
    if (
      message.authorId !== userId &&
      !(await this.security.holds(projectId, userId, "chat:manage"))
    ) {
      throw new ForbiddenError(
        "Only its author, or a rank with chat:manage, deletes a message",
      );
    }
    if (message.deletedAt) {
      return;
    }
    await this.messages.updateById(message.id, {
      body: "",
      references: [],
      deletedAt: this.dateTime.nowISOString(),
    });
    await this.mentions.deleteMany({ messageId: { eq: message.id } });
    await this.live.send(await this.audience.of(room), {
      type: "message.deleted",
      projectId,
      roomId: room.id,
      messageId: message.id,
    });
  }

  /**
   * Move the member's read state forward to `messageId`, never back. A
   * member who never joined an open room has no state to move.
   */
  public async markRead(
    projectId: number,
    roomId: string,
    userId: string,
    messageId: string,
  ): Promise<void> {
    const room = await this.rooms.visibleRoom(projectId, roomId, userId);
    const membership = await this.rooms.membershipOf(room.id, userId);
    if (!membership) {
      return;
    }
    if (
      membership.lastReadMessageId &&
      membership.lastReadMessageId >= messageId
    ) {
      return;
    }
    await this.roomMembers.updateById(membership.id, {
      lastReadMessageId: messageId,
    });
  }

  public async setNotifyLevel(
    projectId: number,
    roomId: string,
    userId: string,
    level: "mentions" | "muted",
  ): Promise<void> {
    await this.rooms.join(projectId, roomId, userId);
    const membership = await this.rooms.membershipOf(roomId, userId);
    if (membership) {
      await this.roomMembers.updateById(membership.id, { notifyLevel: level });
    }
  }

  /**
   * Unread messages and unread mentions of the caller, for every room of
   * the project they are a member of, in ONE query: messages newer than
   * the member's read state, not their own, not deleted.
   *
   * Plan on SQLite, as D1 runs it (`EXPLAIN QUERY PLAN`, recorded in
   * #F1528): the member's rows by `chat_room_members_user_id_idx`, the room
   * by its key, each room's messages by `chat_messages_room_id_id_idx` as a
   * range (`room_id=? AND id>?`) past the read state, the mention by
   * `chat_mentions_message_id_idx`. No scan of a whole table: the cost is
   * the unread messages themselves.
   *
   * The read state falls back to the nil UUID rather than `IS NULL OR`: an
   * `OR` there turns the range into every message of the room.
   */
  public async unreadCounts(
    projectId: number,
    userId: string,
  ): Promise<Array<{ roomId: string; unread: number; mentions: number }>> {
    const member = this.roomMembers.table;
    const message = this.messages.table;
    const mention = this.mentions.table;
    const room = this.roomRows.table;
    const rows = await this.database.run(
      sql`
        SELECT ${member.roomId} AS room_id,
          COUNT(${message.id}) AS unread,
          COUNT(${mention.id}) AS mentions
        FROM ${member}
        JOIN ${room} ON ${room.id} = ${member.roomId}
        JOIN ${message} ON ${message.roomId} = ${member.roomId}
          AND ${message.id} > COALESCE(${member.lastReadMessageId}, ${ChatMessageService.NIL})
        LEFT JOIN ${mention} ON ${mention.messageId} = ${message.id}
          AND ${mention.userId} = ${member.userId}
        WHERE ${member.userId} = ${userId}
          AND ${room.projectId} = ${projectId}
          AND ${message.deletedAt} IS NULL
          AND (${message.authorId} IS NULL OR ${message.authorId} <> ${member.userId})
        GROUP BY ${member.roomId}
      `,
      z.object({
        room_id: z.text(),
        unread: z.any(),
        mentions: z.any(),
      }),
    );
    return rows.map((row) => ({
      roomId: String(row.room_id),
      unread: Number(row.unread),
      mentions: Number(row.mentions),
    }));
  }

  public toResource(
    message: ChatMessage,
    mentioned: string[],
  ): ChatMessageResource {
    return {
      id: message.id,
      roomId: message.roomId,
      createdAt: message.createdAt,
      ...(message.authorId ? { authorId: message.authorId } : {}),
      ...(message.agent ? { agent: message.agent } : {}),
      body: message.body,
      references: message.references ?? [],
      ...(message.editedAt ? { editedAt: message.editedAt } : {}),
      ...(message.deletedAt ? { deletedAt: message.deletedAt } : {}),
      mentions: message.deletedAt ? [] : mentioned,
    };
  }

  protected async parse(room: ChatRoom, body: string) {
    const audience = new Set(await this.audience.of(room));
    const roster = (await this.roster.of(room.projectId)).filter((it) =>
      audience.has(it.userId),
    );
    return this.parser.parse(body, roster);
  }

  protected async writeMentions(
    message: ChatMessage,
    userIds: string[],
  ): Promise<void> {
    for (const mentioned of userIds) {
      await this.mentions.create({
        messageId: message.id,
        roomId: message.roomId,
        userId: mentioned,
      });
    }
  }

  protected async messageIn(
    room: ChatRoom,
    messageId: string,
  ): Promise<ChatMessage> {
    const message = await this.messages.findOne({
      where: { id: { eq: messageId } },
    });
    if (!message || message.roomId !== room.id) {
      throw new NotFoundError("Message not found");
    }
    return message;
  }

  protected assertOpenForWrites(room: ChatRoom): void {
    if (room.archivedAt) {
      throw new ConflictError(
        "This room is archived: it stays readable and takes no new message",
      );
    }
  }
}
