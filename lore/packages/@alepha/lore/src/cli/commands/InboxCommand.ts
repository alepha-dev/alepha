import type { NotificationPreferenceController } from "@lore/core/api";
import { $inject, z } from "alepha";
import type { NotificationInboxController } from "alepha/api/notifications";
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
 * `lore inbox` and `lore notifications` (#Q3914): the caller's own inbox,
 * what the bell shows, and the caller's own notification preferences. A
 * preference is changed with `lore login`'s token or a session; an API key
 * is refused by the server.
 *
 * Neither reads `LORE_PROJECT`: the inbox spans every project, and narrows
 * to one only when `--project` names it.
 */
export class InboxCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly inboxApi = $client<NotificationInboxController>(
    this.client.scope(),
  );
  protected readonly preferenceApi = $client<NotificationPreferenceController>(
    this.client.scope(),
  );

  protected static readonly PROJECT_FLAG = {
    project: z
      .text({
        aliases: ["p"],
        description:
          "Only this project, by slug or id. Every project by default.",
      })
      .optional(),
  };

  public readonly list = $command({
    name: "list",
    description:
      "Your inbox, newest first, across every project or one: title, project, when, and whether you read it",
    flags: z.object({
      ...InboxCommand.PROJECT_FLAG,
      unread: z.boolean().describe("Only what you have not read.").optional(),
      limit: z
        .integer()
        .min(1)
        .max(100)
        .describe("How many, 1 to 100 (default 20).")
        .optional(),
      cursor: z
        .text({ description: "The next page, as the previous one printed it." })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const scope = await this.scope(flags.project);
        const page = await this.inboxApi.listInbox({
          query: {
            ...(scope ? { scope } : {}),
            ...(flags.unread ? { unreadOnly: true } : {}),
            ...(flags.limit ? { limit: flags.limit } : {}),
            ...(flags.cursor ? { cursor: flags.cursor } : {}),
          },
        });
        if (flags.output === "json") {
          this.render.json(print, page);
          return;
        }
        this.render.list(
          print,
          page.items.map((item) => ({
            handle: item.id,
            title: item.title,
            fields: [
              ...(item.scopeLabel ? [item.scopeLabel] : []),
              item.createdAt,
              item.readAt ? "read" : "unread",
            ],
          })),
          undefined,
          "Nothing in your inbox.",
        );
        print(`${page.unreadCount} unread`);
        if (page.nextCursor) print(`More: --cursor ${page.nextCursor}`);
      });
    },
  });

  public readonly read = $command({
    name: "read",
    description:
      "Mark one message read, by id, or all of them (in one project with --project) with --all",
    args: z
      .text({ title: "id", description: "The message, from lore inbox list." })
      .optional(),
    flags: z.object({
      ...InboxCommand.PROJECT_FLAG,
      all: z.boolean().describe("Mark every message read.").optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      if (!args && !flags.all)
        throw new UsageError("Give a message id, or --all");
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        if (args) {
          await this.inboxApi.markInboxRead({ params: { id: args } });
          if (flags.output === "json") this.render.json(print, { ok: true });
          else print(`Read ${args}`);
          return;
        }
        const scope = await this.scope(flags.project);
        const result = (await this.inboxApi.markAllInboxRead({
          query: scope ? { scope } : {},
        })) as { ok: boolean; count?: number };
        if (flags.output === "json") this.render.json(print, result);
        else print(`Marked ${result.count ?? 0} read`);
      });
    },
  });

  public readonly inbox = $command({
    name: "inbox",
    description: "Your inbox, what the bell shows: list it and mark it read",
    children: [this.list, this.read],
    handler: async ({ help }) => {
      help();
    },
  });

  public readonly preferencesGet = $command({
    name: "get",
    description:
      "Your notification preferences: whether email is on, and the kinds of message you muted",
    flags: z.object({ ...LoreOutput.FLAGS }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const prefs = await this.preferenceApi.getMyNotificationPreferences({});
        if (flags.output === "json") {
          this.render.json(print, prefs);
          return;
        }
        print(`Email: ${prefs.emailEnabled ? "on" : "off"}`);
        for (const category of prefs.categories ?? [])
          print(
            `${prefs.mutedCategories.includes(category) ? "muted" : "on   "}  ${category}`,
          );
      });
    },
  });

  public readonly preferencesSet = $command({
    name: "set",
    description:
      "Turn email on or off, or mute and unmute kinds of message, for you in every project",
    flags: z.object({
      email: z
        .enum(["on", "off"])
        .describe("on or off: everything mailed to you, security mail aside.")
        .optional(),
      mute: z
        .text({
          description:
            "Kinds of message to mute, comma separated (lore notifications get lists them).",
        })
        .optional(),
      unmute: z
        .text({ description: "Kinds of message to unmute, comma separated." })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      if (!flags.email && !flags.mute && !flags.unmute)
        throw new UsageError("Give --email, --mute or --unmute");
      const list = (raw?: string) =>
        (raw ?? "")
          .split(",")
          .map((it) => it.trim())
          .filter(Boolean);
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const current = await this.preferenceApi.getMyNotificationPreferences(
          {},
        );
        const unknown = [...list(flags.mute), ...list(flags.unmute)].filter(
          (it) => !(current.categories ?? []).includes(it),
        );
        if (unknown.length)
          throw new UsageError(
            `Unknown kind: ${unknown.join(", ")}. Kinds: ${(current.categories ?? []).join(", ")}`,
          );
        const muted = new Set(current.mutedCategories);
        for (const it of list(flags.mute)) muted.add(it);
        for (const it of list(flags.unmute)) muted.delete(it);
        const prefs = await this.preferenceApi.updateMyNotificationPreferences({
          body: {
            ...(flags.email ? { emailEnabled: flags.email === "on" } : {}),
            ...(flags.mute || flags.unmute
              ? { mutedCategories: [...muted] }
              : {}),
          },
        });
        if (flags.output === "json") this.render.json(print, prefs);
        else
          print(
            `Email: ${prefs.emailEnabled ? "on" : "off"}; muted: ${prefs.mutedCategories.join(", ") || "nothing"}`,
          );
      });
    },
  });

  public readonly notifications = $command({
    name: "notifications",
    description:
      "Your own notification preferences, in every project: read and change them",
    children: [this.preferencesGet, this.preferencesSet],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * `project:<id>`, the scope Lore files a project's messages under, when
   * `--project` names one.
   */
  protected async scope(project: string | undefined) {
    if (!project) return undefined;
    return `project:${await this.projects.resolve(project)}`;
  }
}
