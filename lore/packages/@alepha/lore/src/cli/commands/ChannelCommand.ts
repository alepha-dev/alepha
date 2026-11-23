import type { ProjectChannelController } from "@lore/core/api";
import { $inject, AlephaError, z } from "alepha";
import { $command, UsageError } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore channel` (#Q3914): a project's Discord and webhook channels, what
 * the Channels tab of Settings > Notifications does.
 *
 * A channel's URL is its credential, so it never goes on the command line,
 * where a shell history and `ps` would keep it: it is read from stdin
 * (`--url-stdin`), as `lore registry add` reads its token. A webhook's
 * signing secret comes back once, from `add` and `rotate`, and is never
 * shown again.
 */
export class ChannelCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly api = $client<ProjectChannelController>(
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

  protected static readonly ID_ARG = z.text({
    title: "id",
    description: "The channel, by id (lore channel list).",
  });

  protected static readonly URL_STDIN = {
    "url-stdin": z
      .boolean()
      .describe(
        "Read the URL from stdin: `echo $URL | lore channel add ... --url-stdin`. Never typed inline.",
      )
      .optional(),
  };

  public readonly list = $command({
    name: "list",
    description:
      "The project's channels: Inbox and Email, then its Discord and webhook channels (never a Discord URL)",
    flags: z.object({
      ...ChannelCommand.PROJECT_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const page = await this.api.listProjectChannels({
          params: { projectId },
        });
        if (flags.output === "json") {
          this.render.json(print, page);
          return;
        }
        this.render.list(
          print,
          page.items.map((channel) => ({
            handle: channel.id,
            title: channel.name,
            fields: [
              channel.kind,
              ...(channel.builtIn ? ["built in"] : []),
              ...(channel.url ? [channel.url] : []),
              ...(channel.status && channel.status !== "active"
                ? [channel.status]
                : []),
            ],
          })),
        );
      });
    },
  });

  public readonly add = $command({
    name: "add",
    description:
      "Add a Discord or webhook channel, its URL read from stdin (a webhook's signing secret is printed once), or a chat room by --room",
    flags: z.object({
      ...ChannelCommand.PROJECT_FLAG,
      kind: z
        .enum(["discord", "webhook", "chat"])
        .describe(
          "discord (the default), webhook, or chat (a room, by --room).",
        )
        .optional(),
      room: z
        .text({
          description:
            "For --kind chat: the id of an open room of the project.",
        })
        .optional(),
      name: z
        .text({
          description:
            "The channel's name, as the page lists it. Not for --kind chat: a room channel is named after its room (Room #general).",
        })
        .optional(),
      ...ChannelCommand.URL_STDIN,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const chat = flags.kind === "chat";
      if (chat && !flags.room) throw new UsageError("--kind chat needs --room");
      if (!chat && !flags.name)
        throw new UsageError("--name is needed, except for --kind chat");
      const url = chat ? undefined : await this.url(flags["url-stdin"], true);
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const channel = await this.api.createProjectChannel({
          params: { projectId },
          body: {
            ...(flags.kind ? { kind: flags.kind } : {}),
            ...(chat ? {} : { name: flags.name }),
            ...(chat ? { roomId: flags.room } : { url: url! }),
          },
        });
        this.created(print, flags.output, "Added", channel);
      });
    },
  });

  public readonly update = $command({
    name: "update",
    description:
      "Rename a channel, or replace its URL from stdin with --url-stdin",
    args: ChannelCommand.ID_ARG,
    flags: z.object({
      ...ChannelCommand.PROJECT_FLAG,
      name: z.text({ description: "A new name." }).optional(),
      ...ChannelCommand.URL_STDIN,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const url = await this.url(flags["url-stdin"], false);
      if (flags.name === undefined && url === undefined)
        throw new UsageError("Give --name, --url-stdin, or both");
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const channel = await this.api.updateProjectChannel({
          params: { projectId, id: args },
          body: {
            ...(flags.name !== undefined ? { name: flags.name } : {}),
            ...(url !== undefined ? { url } : {}),
          },
        });
        if (flags.output === "json") this.render.json(print, channel);
        else print(`Updated ${channel.name} (${channel.id})`);
      });
    },
  });

  public readonly delete = $command({
    name: "delete",
    description:
      "Delete a channel and every notification sent to it; this cannot be undone",
    args: ChannelCommand.ID_ARG,
    flags: z.object({
      ...ChannelCommand.PROJECT_FLAG,
      yes: z
        .boolean()
        .describe("Required: a delete cannot be undone.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      if (!flags.yes)
        throw new UsageError(
          `Nothing deleted: ${args} and its notifications would go for good. Pass --yes to delete it.`,
        );
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        await this.api.deleteProjectChannel({
          params: { projectId, id: args },
        });
        if (flags.output === "json") this.render.json(print, { ok: true });
        else print(`Deleted ${args}`);
      });
    },
  });

  public readonly rotate = $command({
    name: "rotate",
    description:
      "Give a webhook channel a new signing secret, printed once; the old one keeps signing for 24 hours",
    args: ChannelCommand.ID_ARG,
    flags: z.object({
      ...ChannelCommand.PROJECT_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const channel = await this.api.rotateProjectChannelSecret({
          params: { projectId, id: args },
        });
        this.created(print, flags.output, "Rotated", channel);
      });
    },
  });

  public readonly channel = $command({
    name: "channel",
    description:
      "A project's notification channels: list, add, update, delete, and rotate a webhook's secret",
    children: [this.list, this.add, this.update, this.delete, this.rotate],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * The URL from stdin, trimmed: required on add, optional on update.
   */
  protected async url(
    fromStdin: boolean | undefined,
    required: boolean,
  ): Promise<string | undefined> {
    if (!fromStdin) {
      if (required)
        throw new UsageError(
          "No URL given. Pipe it in: `echo $URL | lore channel add --name alerts --url-stdin`.",
        );
      return undefined;
    }
    const url = (await this.readStdin()).trim();
    if (!url) throw new AlephaError("stdin was empty: no URL to read");
    return url;
  }

  protected created(
    print: (message?: string) => void,
    output: string,
    verb: string,
    channel: { id: string; name: string; secret?: string },
  ): void {
    if (output === "json") {
      this.render.json(print, channel);
      return;
    }
    print(`${verb} ${channel.name} (${channel.id})`);
    if (channel.secret) {
      print(`Signing secret, shown once: ${channel.secret}`);
      print(
        "The receiver checks each call's webhook-signature with it (Standard Webhooks).",
      );
    }
  }

  /**
   * All of stdin, as text. Protected so a spec substitutes it.
   */
  protected async readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
}
