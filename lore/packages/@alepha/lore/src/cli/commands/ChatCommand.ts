import type { ChatMessageController, ChatRoomController } from "@lore/chat/api";
import { $inject, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore chat` (#E161, #Q3933): a project's chat rooms from a terminal or a
 * script. The pairs of `chat_room_list`, `chat_message_list` and
 * `chat_message_send`.
 */
export class ChatCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);
  protected readonly rooms = $client<ChatRoomController>(this.client.scope());
  protected readonly messages = $client<ChatMessageController>(
    this.client.scope(),
  );

  protected static readonly PROJECT_FLAG = {
    project: z
      .text({
        aliases: ["p"],
        description: "The project, by slug or id. Defaults to LORE_PROJECT.",
      })
      .optional(),
  };

  public readonly roomList = $command({
    name: "list",
    description:
      "The rooms you can see, open and private, with what is unread in each",
    flags: z.object({ ...ChatCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const [rooms, unread] = await Promise.all([
          this.rooms.listChatRooms({ params: { projectId } }),
          this.messages.getChatUnreadCounts({ params: { projectId } }),
        ]);
        const counts = new Map(unread.items.map((row) => [row.roomId, row]));
        const rows = rooms.items.map((room) => ({
          name: room.name,
          private: room.private,
          archived: !!room.archivedAt,
          joined: room.joined,
          unread: counts.get(room.id)?.unread ?? 0,
          mentions: counts.get(room.id)?.mentions ?? 0,
        }));
        if (flags.output === "json") {
          this.render.json(print, { rooms: rows });
          return;
        }
        this.render.list(
          print,
          rows.map((room) => ({
            handle: `#${room.name}`,
            title: room.private ? "private" : "open",
            fields: [
              room.unread ? `${room.unread} unread` : undefined,
              room.mentions ? `${room.mentions} mentioning you` : undefined,
            ],
          })),
          undefined,
          "No room you can see.",
        );
      });
    },
  });

  public readonly messageList = $command({
    name: "list",
    description: "A room's latest messages, newest first",
    args: z.text({ title: "room", description: "The room's name: general." }),
    flags: z.object({
      ...ChatCommand.PROJECT_FLAG,
      before: z
        .text({ description: "A message id: the messages older than it." })
        .optional(),
      limit: z
        .integer()
        .min(1)
        .max(100)
        .describe("How many, 50 by default, 100 at most.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId, roomId } = await this.resolveRoom(
          args,
          flags.project,
          context,
        );
        const page = await this.messages.listChatMessages({
          params: { projectId, roomId },
          query: {
            ...(flags.before ? { before: flags.before } : {}),
            ...(flags.limit ? { limit: flags.limit } : {}),
          },
        });
        const rows = page.items.map((message) => ({
          id: message.id,
          author: message.agent ?? message.authorId ?? "a removed member",
          body: message.body,
          createdAt: message.createdAt,
          edited: !!message.editedAt,
          deleted: !!message.deletedAt,
        }));
        if (flags.output === "json") {
          this.render.json(print, { messages: rows, hasMore: page.hasMore });
          return;
        }
        for (const row of rows.toReversed()) {
          print(
            `${row.createdAt}  ${row.author}: ${row.deleted ? "(deleted)" : row.body}`,
          );
        }
        if (page.hasMore) {
          print(`Older: --before ${rows.at(-1)?.id}`);
        }
      });
    },
  });

  public readonly messageSend = $command({
    name: "send",
    description:
      "Post a message as you. @name notifies a member; @lore asks the agent, with your rights",
    args: z.tuple([
      z.text({ title: "room", description: "The room's name: general." }),
      z.text({ title: "text", description: "The message, in Markdown." }),
    ]),
    flags: z.object({ ...ChatCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const [room, text] = args;
        const { projectId, roomId } = await this.resolveRoom(
          room,
          flags.project,
          context,
        );
        const sent = await this.messages.sendChatMessage({
          params: { projectId, roomId },
          body: { body: text },
        });
        this.render.written(
          print,
          flags.output,
          { id: sent.id },
          `Sent to #${room}`,
        );
      });
    },
  });

  /**
   * A room by its name, among those the caller can see: a private room they
   * are not in is as unknown here as in the app.
   */
  protected async resolveRoom(
    name: string,
    project: string | undefined,
    context: LoreRefusalContext,
  ): Promise<{ projectId: number; roomId: string }> {
    const { projectId } = await this.projects.named(project, context);
    const rooms = await this.rooms.listChatRooms({ params: { projectId } });
    const wanted = name.replace(/^#/, "").toLowerCase();
    const room = rooms.items.find((it) => it.name === wanted);
    if (!room) {
      throw new AlephaError(
        `No room named "${name}" here that you can see: lore chat room list gives their names.`,
      );
    }
    return { projectId, roomId: room.id };
  }

  public readonly room = $command({
    name: "room",
    description: "A project's chat rooms: list them",
    children: [this.roomList],
    handler: async ({ help }) => {
      help();
    },
  });

  public readonly message = $command({
    name: "message",
    description: "A room's messages: read them, send one",
    children: [this.messageList, this.messageSend],
    handler: async ({ help }) => {
      help();
    },
  });

  public readonly chat = $command({
    name: "chat",
    description: "A project's chat: rooms and messages",
    children: [this.room, this.message],
    handler: async ({ help }) => {
      help();
    },
  });
}
