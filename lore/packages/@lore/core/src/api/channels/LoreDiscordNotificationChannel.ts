import { DiscordTransport } from "@alepha/discord";
import { $inject, AlephaError, z } from "alepha";
import {
  NotificationChannel,
  type NotificationRendered,
  type NotificationRenderInput,
} from "alepha/api/notifications";

import { ProjectChannelService } from "../services/ProjectChannelService.ts";

/**
 * Posts a notification to one of a project's Discord channels (#Q3615,
 * #Q3891): a project event a channel is subscribed to, rendered by its
 * `lore:project-event:discord` template, or the automation engine's own
 * until #Q3896.
 *
 * The notification names the channel by id (`variables.channelId`), and the
 * project is its scope. At send time the channel's webhook URL is
 * unsealed, after checking the channel belongs to that project; the URL is
 * in no payload, outbox row, snapshot or receipt, which says
 * `discord:<id>`. Retries are the outbox's; Discord takes no idempotency
 * key, so a retried post may arrive twice.
 *
 * The message is cut to Discord's 2000 characters with a visible mark, and
 * pings nobody: `allowed_mentions: { parse: [] }`, so an `@everyone` in a
 * title stays plain text.
 */
export class LoreDiscordNotificationChannel extends NotificationChannel<
  LoreDiscordMessage,
  LoreDiscordRendered
> {
  public static readonly LIMIT = 2000;
  public static readonly MARK = "\n… (truncated)";
  /**
   * What every template posting here carries, whatever else it holds.
   */
  protected static readonly TARGET = z.object({
    channelId: z.string().max(64).optional(),
    scope: z.string(),
  });

  protected readonly transport = $inject(DiscordTransport);
  protected readonly channels = $inject(ProjectChannelService);

  public readonly channel = "discord";
  public readonly addressable = false;

  public async render(
    input: NotificationRenderInput<LoreDiscordMessage>,
  ): Promise<LoreDiscordRendered> {
    const variables = LoreDiscordNotificationChannel.TARGET.parse(
      input.variables,
    );
    const channelId = variables.channelId;
    const projectId = Number(/^project:(\d+)$/.exec(variables.scope)?.[1]);
    if (!channelId || !Number.isSafeInteger(projectId))
      throw new AlephaError("A Discord notification names no channel");
    const body = await input.message.message(
      input.variables as Record<string, unknown>,
    );
    return {
      recipient: `discord:${channelId}`,
      body: this.cut(body),
      projectId,
      channelId,
    };
  }

  public async send(rendered: LoreDiscordRendered) {
    // Unsealed here, at the last moment, and only once the channel is
    // proven to be this project's.
    const webhook = await this.channels.webhook(
      rendered.projectId,
      rendered.channelId,
    );
    await this.transport.post(webhook, {
      content: rendered.body ?? "",
      allowed_mentions: { parse: [] },
    });
    return {};
  }

  protected cut(body: string): string {
    const limit = LoreDiscordNotificationChannel.LIMIT;
    if (body.length <= limit) return body;
    const mark = LoreDiscordNotificationChannel.MARK;
    return `${body.slice(0, limit - mark.length)}${mark}`;
  }
}

export interface LoreDiscordMessage {
  message: (variables: Record<string, unknown>) => string | Promise<string>;
}

export interface LoreDiscordRendered extends NotificationRendered {
  projectId: number;
  channelId: string;
}
