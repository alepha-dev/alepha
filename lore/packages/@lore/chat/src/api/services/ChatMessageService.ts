import { ProjectRoster, ProjectSecurityService } from "@lore/core/api";
import { $inject, Alepha, z } from "alepha";
import { FileService } from "alepha/api/files";
import { BackgroundTaskProvider } from "alepha/background";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DatabaseProvider, sql } from "alepha/orm";
import { $rateLimit } from "alepha/rate-limit";
import type { UserAccountToken } from "alepha/security";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
} from "alepha/server";

import { chatMentions } from "../entities/chatMentions.ts";
import { type ChatMessage, chatMessages } from "../entities/chatMessages.ts";
import { chatReactions } from "../entities/chatReactions.ts";
import { chatRoomMembers } from "../entities/chatRoomMembers.ts";
import { type ChatRoom, chatRooms } from "../entities/chatRooms.ts";
import type { ChatMessageResource } from "../schemas/chatMessageResourceSchema.ts";
import { ChatAgentRunner } from "./ChatAgentRunner.ts";
import { ChatAudience } from "./ChatAudience.ts";
import { ChatBuckets } from "./ChatBuckets.ts";
import { ChatLive } from "./ChatLive.ts";
import { ChatMentionNotifier } from "./ChatMentionNotifier.ts";
import { ChatMentionParser } from "./ChatMentionParser.ts";
import { ChatResponderRegistry } from "./ChatResponderRegistry.ts";
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

  /**
   * How long the work after a send (frames, the agent's start) may take,
   * once the sender has their answer.
   */
  protected static readonly AFTER_SEND_MS = 30_000;

  protected readonly messages = $repository(chatMessages);
  protected readonly mentions = $repository(chatMentions);
  protected readonly reactions = $repository(chatReactions);
  protected readonly files = $inject(FileService);
  protected readonly alepha = $inject(Alepha);
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
  protected readonly background = $inject(BackgroundTaskProvider);

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
    attachments: string[] = [],
    user?: UserAccountToken,
  ): Promise<{ message: ChatMessageResource; mentioned: string[] }> {
    const room = await this.rooms.visibleRoom(projectId, roomId, userId);
    this.assertOpenForWrites(room);
    if (!body.trim() && attachments.length === 0) {
      throw new BadRequestError("A message needs words or a file");
    }
    await this.assertOwnUploads(attachments, userId);

    // Read at once (#Q4112): on Workers each await is a round trip to D1
    // or to a Durable Object, and the sender waits for every one of them.
    const [limited, membership, audience, roster] = await Promise.all([
      this.sendLimit.consume(userId),
      this.rooms.membershipOf(room.id, userId),
      this.audience.of(room),
      this.roster.of(room.projectId),
    ]);
    if (!limited.allowed) {
      throw new TooManyRequestsError(
        "Too many messages: at most 30 a minute. Wait a moment and send again.",
      );
    }

    const parsed = this.parseFor(body, audience, roster);
    const message = await this.messages.create({
      roomId: room.id,
      authorId: userId,
      body,
      references: parsed.references,
      ...(attachments.length ? { attachments } : {}),
    });
    await Promise.all([
      this.mentions.createMany([
        ...parsed.userIds.map((mentioned) => ({
          messageId: message.id,
          roomId: message.roomId,
          userId: mentioned,
        })),
        ...parsed.agents.map((agent) => ({
          messageId: message.id,
          roomId: message.roomId,
          agent,
        })),
      ]),
      // Writing in an open room joins it, and the author has read what they
      // wrote: the read state and the notify level live on the membership
      // row. A private room's writer is already in it.
      membership
        ? !membership.lastReadMessageId ||
          membership.lastReadMessageId < message.id
          ? this.roomMembers.updateById(membership.id, {
              lastReadMessageId: message.id,
            })
          : undefined
        : this.roomMembers.create({
            roomId: room.id,
            userId,
            lastReadMessageId: message.id,
          }),
    ]);

    const [resource] = await this.decorate([message]);
    // The sender's answer is the stored message. The frames to every reader
    // (one Durable Object call per member on Workers, seconds in all) and
    // the `@lore` run (#Q3930) go after the response, in this order, so the
    // agent's answer never reaches a reader before the message it answers.
    // Own signal: the request's is aborted when the sender's tab closes,
    // and the room must hear of a message that was stored.
    const joined = !membership;
    this.background.defer(() =>
      this.alepha.context.run(
        async () => {
          if (joined) {
            await this.live.send(audience, {
              type: "room.changed",
              projectId,
              roomId: room.id,
            });
          }
          await this.live.send(audience, {
            type: "message.created",
            projectId,
            roomId: room.id,
            message: resource!,
          });
          // Only a member's message starts a run: an agent's never reaches
          // `send`.
          if (user && parsed.agents.length > 0) {
            await this.alepha
              .inject(ChatAgentRunner)
              .start(room, message, user, parsed.agents[0]!);
          }
        },
        { signal: AbortSignal.timeout(ChatMessageService.AFTER_SEND_MS) },
      ),
    );
    // Who was named and is away hears of it (#Q3931).
    this.alepha
      .inject(ChatMentionNotifier)
      .notify(room, message, userId, parsed.userIds);
    return { message: resource!, mentioned: parsed.userIds };
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
    return {
      items: await this.decorate(page),
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

    const [resource] = await this.decorate([updated]);
    await this.live.send(await this.audience.of(room), {
      type: "message.updated",
      projectId,
      roomId: room.id,
      message: resource!,
    });
    const added = parsed.userIds.filter((id) => !before.has(id));
    // An edit tells only the members it names for the first time.
    this.alepha
      .inject(ChatMentionNotifier)
      .notify(room, updated, userId, added);
    return { message: resource!, mentioned: added };
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
      attachments: [],
      deletedAt: this.dateTime.nowISOString(),
    });
    await this.mentions.deleteMany({ messageId: { eq: message.id } });
    await this.reactions.deleteMany({ messageId: { eq: message.id } });
    // Its files go with its words: nobody can open them any more.
    if (message.attachments?.length) {
      await this.files.deleteFiles(message.attachments, {
        bucket: ChatBuckets.ATTACHMENT_BUCKET,
      });
    }
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
  ): Promise<
    Array<{
      roomId: string;
      unread: number;
      mentions: number;
      notifyLevel: "mentions" | "muted";
    }>
  > {
    const member = this.roomMembers.table;
    const message = this.messages.table;
    const mention = this.mentions.table;
    const room = this.roomRows.table;
    const rows = await this.database.run(
      sql`
        SELECT ${member.roomId} AS room_id,
          ${member.notifyLevel} AS notify_level,
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
        GROUP BY ${member.roomId}, ${member.notifyLevel}
      `,
      z.object({
        room_id: z.text(),
        notify_level: z.text(),
        unread: z.any(),
        mentions: z.any(),
      }),
    );
    return rows.map((row) => ({
      roomId: String(row.room_id),
      unread: Number(row.unread),
      mentions: Number(row.mentions),
      notifyLevel: row.notify_level === "muted" ? "muted" : "mentions",
    }));
  }

  /**
   * Add or take back one emoji of the member under a message (#Q3939),
   * and send the message as it now reads to everyone in the room.
   */
  public async toggleReaction(
    projectId: number,
    roomId: string,
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<ChatMessageResource> {
    const room = await this.rooms.visibleRoom(projectId, roomId, userId);
    this.assertOpenForWrites(room);
    const message = await this.messageIn(room, messageId);
    if (message.deletedAt) {
      throw new ConflictError("A deleted message takes no reaction");
    }
    const mine = await this.reactions.findOne({
      where: {
        messageId: { eq: message.id },
        userId: { eq: userId },
        emoji: { eq: emoji },
      },
    });
    if (mine) {
      await this.reactions.deleteById(mine.id);
    } else {
      await this.reactions.create({
        messageId: message.id,
        roomId: room.id,
        userId,
        emoji,
      });
    }
    const [resource] = await this.decorate([message]);
    await this.live.send(await this.audience.of(room), {
      type: "message.updated",
      projectId,
      roomId: room.id,
      message: resource!,
    });
    return resource!;
  }

  /**
   * Messages as the API answers them: their mentions, files and reactions
   * read in one query each for the whole page, never one per message.
   */
  public async decorate(page: ChatMessage[]): Promise<ChatMessageResource[]> {
    if (page.length === 0) {
      return [];
    }
    const ids = page.map((it) => it.id);
    const fileIds = page.flatMap((it) => it.attachments ?? []);
    const [mentions, reactions, files] = await Promise.all([
      this.mentions.findMany({ where: { messageId: { inArray: ids } } }),
      this.reactions.findMany({
        where: { messageId: { inArray: ids } },
        orderBy: [{ column: "createdAt", direction: "asc" }],
      }),
      fileIds.length
        ? this.files.fileRepository.findMany({
            where: { id: { inArray: fileIds } },
          })
        : Promise.resolve([]),
    ]);
    const fileById = new Map(files.map((file) => [file.id, file]));
    return page.map((message) => {
      const emoji = new Map<string, string[]>();
      for (const reaction of reactions) {
        if (reaction.messageId !== message.id) continue;
        emoji.set(reaction.emoji, [
          ...(emoji.get(reaction.emoji) ?? []),
          reaction.userId,
        ]);
      }
      return this.toResource(message, {
        mentions: mentions
          .filter((it) => it.messageId === message.id && it.userId)
          .map((it) => it.userId!),
        reactions: [...emoji].map(([key, userIds]) => ({
          emoji: key,
          userIds,
        })),
        attachments: (message.attachments ?? []).flatMap((id) => {
          const file = fileById.get(id);
          return file
            ? [
                {
                  id,
                  name: file.name,
                  mimeType: file.mimeType,
                  size: file.size,
                  url: `/api/files/${id}`,
                },
              ]
            : [];
        }),
      });
    });
  }

  public toResource(
    message: ChatMessage,
    extras: Pick<ChatMessageResource, "mentions" | "reactions" | "attachments">,
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
      ...(message.agentRun
        ? {
            agentRun: {
              status: message.agentRun.status,
              mentionerId: message.agentRun.mentionerId,
              ...(message.agentRun.tool ? { tool: message.agentRun.tool } : {}),
              ...(message.agentRun.input
                ? { input: message.agentRun.input }
                : {}),
              ...(message.agentRun.tools
                ? { tools: message.agentRun.tools }
                : {}),
            },
          }
        : {}),
      mentions: message.deletedAt ? [] : extras.mentions,
      reactions: message.deletedAt ? [] : extras.reactions,
      attachments: message.deletedAt ? [] : extras.attachments,
    };
  }

  protected async parse(room: ChatRoom, body: string) {
    const [audience, roster] = await Promise.all([
      this.audience.of(room),
      this.roster.of(room.projectId),
    ]);
    return this.parseFor(body, audience, roster);
  }

  /**
   * Resolve a body's mentions against the members who can see the room.
   */
  protected parseFor(
    body: string,
    audience: string[],
    roster: Awaited<ReturnType<ProjectRoster["of"]>>,
  ) {
    const allowed = new Set(audience);
    return this.parser.parse(
      body,
      roster.filter((it) => allowed.has(it.userId)),
      this.alepha.inject(ChatResponderRegistry).names(),
    );
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

  /**
   * A message carries only files its author uploaded to chat: never somebody
   * else's, nor one from another bucket, whose reader rule would differ.
   */
  protected async assertOwnUploads(
    fileIds: string[],
    userId: string,
  ): Promise<void> {
    if (fileIds.length === 0) return;
    const owned = await this.files.fileRepository.findMany({
      where: {
        id: { inArray: fileIds },
        creator: { eq: userId },
        bucket: { eq: ChatBuckets.ATTACHMENT_BUCKET },
      },
      columns: ["id"],
    });
    if (owned.length !== new Set(fileIds).size) {
      throw new BadRequestError(
        "A message can only carry files you uploaded to chat",
      );
    }
  }

  protected assertOpenForWrites(room: ChatRoom): void {
    if (room.archivedAt) {
      throw new ConflictError(
        "This room is archived: it stays readable and takes no new message",
      );
    }
  }
}
