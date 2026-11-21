import type {
  ProjectChannelController,
  SubscriptionController,
} from "@lore/core/api";
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
 * `lore subscription list` and `lore subscription set` (#Q3895): who is
 * notified of what, on which channel. Channels are created in the browser,
 * so a webhook or Discord URL never lands in a shell history.
 */
export class SubscriptionCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly api = $client<SubscriptionController>(this.client.scope());
  protected readonly channelApi = $client<ProjectChannelController>(
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

  public readonly list = $command({
    name: "list",
    description:
      "Who is notified of what, on which channel, and the project's channels (never a URL)",
    flags: z.object({
      ...SubscriptionCommand.PROJECT_FLAG,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const page = await this.api.listSubscriptions({
          params: { projectId },
        });
        const channels = await this.channelApi
          .listProjectChannels({ params: { projectId } })
          .then((it) =>
            it.items.map((channel) => ({
              id: channel.id,
              kind: channel.kind,
              name: channel.name,
              builtIn: channel.builtIn,
            })),
          )
          .catch(() => []);
        if (flags.output === "json") {
          this.render.json(print, { items: page.items, channels });
          return;
        }
        this.render.list(
          print,
          page.items.map((row) => ({
            handle: row.id,
            title: row.event,
            fields: [
              row.channelId
                ? `channel ${channels.find((it) => it.id === row.channelId)?.name ?? row.channelId}`
                : `member ${row.memberId}`,
              ...(row.filter ? [`filter ${row.filter}`] : []),
              ...(row.channels.length ? [row.channels.join(", ")] : []),
              ...(row.notMine ? ["not mine"] : []),
              ...(row.notMembers ? ["not members"] : []),
              ...(row.mutedAt ? ["muted"] : []),
            ],
          })),
          undefined,
          "Nobody is notified of anything.",
        );
      });
    },
  });

  public readonly set = $command({
    name: "set",
    description:
      "Subscribe a member (you by default) or a channel to an event; with --verb mute, unmute or remove, act on a subscription by id",
    args: z
      .text({
        title: "id",
        description: "The subscription, for mute, unmute and remove.",
      })
      .optional(),
    flags: z.object({
      ...SubscriptionCommand.PROJECT_FLAG,
      verb: z
        .enum(["set", "mute", "unmute", "remove"])
        .describe("set (the default), mute, unmute or remove.")
        .optional(),
      event: z
        .text({ description: "The event, from lore event catalog." })
        .optional(),
      filter: z
        .text({ description: "Only this host, app or monitor." })
        .optional(),
      member: z
        .text({
          description: "The member notified, by user id; you by default.",
        })
        .optional(),
      channel: z
        .text({ description: "A project channel notified instead, by id." })
        .optional(),
      channels: z
        .text({ description: "inapp, email, or inapp,email (default inapp)." })
        .optional(),
      "not-mine": z
        .boolean()
        .describe(
          "Skip the events the member caused, such as a report they filed.",
        )
        .optional(),
      "not-members": z
        .boolean()
        .describe(
          "Skip the events a project member caused: only outside reporters' feedback.",
        )
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const verb = flags.verb ?? "set";
        if (verb !== "set") {
          if (!args)
            throw new AlephaError(`Give the subscription id to ${verb}`);
          if (verb === "remove") {
            await this.api.deleteSubscription({
              params: { projectId, id: args },
            });
            print(`Removed ${args}`);
            return;
          }
          const row = await this.api.muteSubscription({
            params: { projectId, id: args },
            body: { muted: verb === "mute" },
          });
          if (flags.output === "json") this.render.json(print, row);
          else print(`${verb === "mute" ? "Muted" : "Unmuted"} ${row.id}`);
          return;
        }
        if (!flags.event)
          throw new AlephaError("Give the --event to notify of");
        const channels = (flags.channels ?? "inapp")
          .split(",")
          .map((it) => it.trim())
          .filter(
            (it): it is "inapp" | "email" => it === "inapp" || it === "email",
          );
        const row = await this.api.setSubscription({
          params: { projectId },
          body: {
            event: flags.event,
            ...(flags.filter ? { filter: flags.filter } : {}),
            ...(flags.member ? { memberId: flags.member } : {}),
            ...(flags.channel ? { channelId: flags.channel } : { channels }),
            ...(flags["not-mine"] ? { notMine: true } : {}),
            ...(flags["not-members"] ? { notMembers: true } : {}),
          },
        });
        if (flags.output === "json") this.render.json(print, row);
        else print(`Notifying of ${row.event}: ${row.id}`);
      });
    },
  });

  public readonly subscription = $command({
    name: "subscription",
    description:
      "Who is notified of what: list and set a project's notifications",
    children: [this.list, this.set],
    handler: async ({ help }) => {
      help();
    },
  });
}
