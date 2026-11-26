import type {
  ChatAgentController,
  ChatAgentResource,
  ChatMessageController,
  ChatRoomController,
} from "@lore/chat/api";
import { $inject, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $client } from "alepha/server/links";
import { FileSystemProvider } from "alepha/system";

import { AttachmentUploader } from "../services/AttachmentUploader.ts";
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
 * `chat_message_send`, and since #E170 (#Q4200) of the `chat_agent_*`
 * tools, `lore chat agent ...`, which also uploads an agent's avatar: MCP
 * carries no file.
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
  protected readonly agents = $client<ChatAgentController>(this.client.scope());
  protected readonly uploader = $inject(AttachmentUploader);
  protected readonly fs = $inject(FileSystemProvider);

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
          author:
            message.agentName ??
            message.agent ??
            message.authorId ??
            "a removed member",
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
      "Post a message as you. @name notifies a member; @lore or an agent's handle asks that agent, with your rights",
    args: z.tuple([
      z.text({ title: "room", description: "The room's name: general." }),
      // A message, not a label: a bare `z.text()` caps at 255 (#Q4334).
      z.text({
        title: "text",
        description: "The message, in Markdown.",
        size: "rich",
      }),
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

  protected static readonly HANDLE_ARG = z.text({
    title: "handle",
    description: "The agent's handle: jarvis.",
  });

  protected static readonly AGENT_FLAGS = {
    name: z.text({ description: "The display name: Jarvis." }).optional(),
    "pre-prompt": z
      .text({
        size: "rich",
        atFile: true,
        description:
          "The persona and its playbook, in Markdown: inline, @playbook.md for a file, or @- for stdin.",
      })
      .optional(),
    model: z
      .text({
        description:
          "A model id; empty is the instance default. The AI budget counts tokens whatever the model.",
      })
      .optional(),
    tool: z
      .array(z.text())
      .describe(
        "A tool it uses, repeated for each: a run then sends those definitions alone. REPLACES the whole list; '[]' is every tool the member may be offered. lore chat agent list --output json names them.",
      )
      .optional(),
    avatar: z
      .text({ description: "An image to upload as its avatar, 2 MB at most." })
      .optional(),
  };

  public readonly agentList = $command({
    name: "list",
    description:
      "The agents a message can mention here: lore and the project's own",
    flags: z.object({ ...ChatCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const page = await this.agents.listChatAgents({
          params: { projectId },
        });
        const rows = page.items.map((agent) => this.toAgent(agent));
        if (flags.output === "json") {
          this.render.json(print, {
            agents: rows,
            enabled: page.enabled,
            tools: page.tools,
          });
          return;
        }
        if (!page.enabled) {
          print("AI is off on this Lore: no agent answers until it is on.");
        }
        this.render.list(
          print,
          rows.map((agent) => ({
            handle: `@${agent.handle}`,
            title: agent.name,
            fields: [
              agent.builtin ? "built-in" : (agent.model ?? "default model"),
            ],
          })),
          undefined,
          "No agent here.",
        );
      });
    },
  });

  public readonly agentGet = $command({
    name: "get",
    description: "One agent, its persona and playbook included",
    args: ChatCommand.HANDLE_ARG,
    flags: z.object({ ...ChatCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId, agentId } = await this.resolveAgent(
          args,
          flags.project,
          context,
        );
        const agent = this.toAgent(
          await this.agents.getChatAgent({ params: { projectId, agentId } }),
        );
        if (flags.output === "json") {
          this.render.json(print, agent);
          return;
        }
        print(`@${agent.handle}  ${agent.name}`);
        print(`model: ${agent.model ?? "the instance default"}`);
        print(
          `tools: ${agent.tools?.join(", ") ?? "every tool the member may be offered"}`,
        );
        print("");
        print(agent.pre_prompt ?? "");
      });
    },
  });

  public readonly agentCreate = $command({
    name: "create",
    description:
      "Create an agent (needs chat:agent): its handle, name, playbook, model, tools and avatar",
    flags: z.object({
      ...ChatCommand.PROJECT_FLAG,
      handle: z.text({
        description:
          "What a message mentions: 2 to 32 lowercase letters, digits or dashes.",
      }),
      ...ChatCommand.AGENT_FLAGS,
      name: z.text({ description: "The display name: Jarvis." }),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print, root }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const avatar = flags.avatar
          ? await this.upload(projectId, root, flags.avatar)
          : undefined;
        const agent = await this.agents.createChatAgent({
          params: { projectId },
          body: {
            handle: flags.handle,
            name: flags.name,
            prePrompt: flags["pre-prompt"] ?? "",
            ...(flags.model ? { model: flags.model } : {}),
            ...(flags.tool ? { tools: flags.tool } : {}),
            ...(avatar ? { avatar } : {}),
          },
        });
        this.render.written(
          print,
          flags.output,
          this.toAgent(agent),
          `Created @${agent.handle}`,
        );
      });
    },
  });

  public readonly agentUpdate = $command({
    name: "update",
    description:
      "Edit an agent (needs chat:agent): only the flags given change",
    args: ChatCommand.HANDLE_ARG,
    flags: z.object({
      ...ChatCommand.PROJECT_FLAG,
      "new-handle": z.text({ description: "Its new handle." }).optional(),
      ...ChatCommand.AGENT_FLAGS,
      "no-avatar": z
        .boolean()
        .describe("Remove its avatar: initials on a colour instead.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print, root }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        if (flags.avatar && flags["no-avatar"]) {
          throw new AlephaError("Pass --avatar or --no-avatar, not both.");
        }
        const { projectId, agentId } = await this.resolveAgent(
          args,
          flags.project,
          context,
        );
        const avatar = flags.avatar
          ? await this.upload(projectId, root, flags.avatar)
          : flags["no-avatar"]
            ? null
            : undefined;
        const agent = await this.agents.updateChatAgent({
          params: { projectId, agentId },
          body: {
            ...(flags["new-handle"] ? { handle: flags["new-handle"] } : {}),
            ...(flags.name ? { name: flags.name } : {}),
            ...(flags["pre-prompt"] !== undefined
              ? { prePrompt: flags["pre-prompt"] }
              : {}),
            ...(flags.model !== undefined
              ? { model: flags.model.trim() ? flags.model : null }
              : {}),
            ...(flags.tool !== undefined ? { tools: flags.tool } : {}),
            ...(avatar !== undefined ? { avatar } : {}),
          },
        });
        this.render.written(
          print,
          flags.output,
          this.toAgent(agent),
          `Updated @${agent.handle}`,
        );
      });
    },
  });

  public readonly agentDelete = $command({
    name: "delete",
    description:
      "Delete an agent (needs chat:agent): its past answers stay, its handle is freed",
    args: ChatCommand.HANDLE_ARG,
    flags: z.object({ ...ChatCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId, agentId } = await this.resolveAgent(
          args,
          flags.project,
          context,
        );
        await this.agents.deleteChatAgent({ params: { projectId, agentId } });
        this.render.written(
          print,
          flags.output,
          { ok: true },
          `Deleted @${args.replace(/^@/, "")}`,
        );
      });
    },
  });

  protected toAgent(agent: ChatAgentResource) {
    return {
      handle: agent.handle,
      name: agent.name,
      builtin: agent.builtin,
      ...(agent.model ? { model: agent.model } : {}),
      avatar: !!agent.avatarId,
      ...(agent.tools?.length ? { tools: agent.tools } : {}),
      ...(agent.prePrompt !== undefined ? { pre_prompt: agent.prePrompt } : {}),
    };
  }

  protected async upload(
    projectId: number,
    root: string,
    path: string,
  ): Promise<string> {
    const { fileId } = await this.uploader.pushChatAgentAvatar({
      projectId,
      filePath: this.fs.resolve(root, path),
    });
    return fileId;
  }

  /**
   * A project's own agent by its handle; the built-in lore is not one.
   */
  protected async resolveAgent(
    handle: string,
    project: string | undefined,
    context: LoreRefusalContext,
  ): Promise<{ projectId: number; agentId: string }> {
    const { projectId } = await this.projects.named(project, context);
    const wanted = handle.replace(/^@/, "").toLowerCase();
    const page = await this.agents.listChatAgents({ params: { projectId } });
    const agent = page.items.find((it) => !it.builtin && it.handle === wanted);
    if (!agent) {
      throw new AlephaError(
        `No agent @${wanted} in this project: lore chat agent list gives their handles.`,
      );
    }
    return { projectId, agentId: agent.id };
  }

  public readonly agent = $command({
    name: "agent",
    description: "A project's chat agents: list, read, create, edit, delete",
    children: [
      this.agentList,
      this.agentGet,
      this.agentCreate,
      this.agentUpdate,
      this.agentDelete,
    ],
    handler: async ({ help }) => {
      help();
    },
  });

  public readonly chat = $command({
    name: "chat",
    description: "A project's chat: rooms, messages and agents",
    children: [this.room, this.message, this.agent],
    handler: async ({ help }) => {
      help();
    },
  });
}
