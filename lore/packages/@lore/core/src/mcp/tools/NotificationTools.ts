import { $inject, Alepha, z } from "alepha";
import { $tool } from "alepha/mcp";
import { currentUserAtom } from "alepha/security";
import { BadRequestError, UnauthorizedError } from "alepha/server";

import { projectChannelResourceSchema } from "../../api/schemas/projectChannelResourceSchema.ts";
import { projectEventCatalogPageSchema } from "../../api/schemas/projectEventCatalogPageSchema.ts";
import { projectEventPageSchema } from "../../api/schemas/projectEventPageSchema.ts";
import { subscriptionResourceSchema } from "../../api/schemas/subscriptionResourceSchema.ts";
import { ProjectChannelService } from "../../api/services/ProjectChannelService.ts";
import { ProjectEventCatalogService } from "../../api/services/ProjectEventCatalogService.ts";
import { ProjectEventReader } from "../../api/services/ProjectEventReader.ts";
import { SubscriptionService } from "../../api/services/SubscriptionService.ts";
import { eventListParamsSchema } from "../schemas/eventListParamsSchema.ts";
import { projectParamsSchema } from "../schemas/projectParamsSchema.ts";
import { subscriptionSetParamsSchema } from "../schemas/subscriptionSetParamsSchema.ts";
import { ProjectTools } from "./ProjectTools.ts";

/**
 * Project events and notifications over MCP (#Q3895): four tools, each with
 * its `lore` command, doing what Settings > Notifications does and nothing
 * more. Channels are created in the browser only, so a webhook or Discord
 * URL never travels through a tool.
 */
export class NotificationTools {
  /**
   * What every description says, because agents look for automations:
   * what replaced them.
   */
  public static readonly INSTEAD =
    "Lore has no automations: a schedule, a condition or a multi-step reaction is not in Lore. Use a scheduled agent session over MCP, or subscribe a webhook channel and react in whatever it calls.";

  protected readonly alepha = $inject(Alepha);
  protected readonly projects = $inject(ProjectTools);
  protected readonly catalog = $inject(ProjectEventCatalogService);
  protected readonly reader = $inject(ProjectEventReader);
  protected readonly subscriptions = $inject(SubscriptionService);
  protected readonly channels = $inject(ProjectChannelService);

  protected user() {
    const user = this.alepha.store.get(currentUserAtom);
    if (!user) throw new UnauthorizedError("Authentication required");
    return user;
  }
  protected project(input: { project?: number; project_name?: string }) {
    return this.projects.resolveProjectId(input.project, input.project_name);
  }

  event_catalog = $tool({
    description: `The events this project can emit: name, label, resource, the fields each carries, the capability it needs, the permission a reader needs, the field a filter matches, and why an unavailable one is unavailable. Subscribe to one with subscription_set. ${NotificationTools.INSTEAD}`,
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: projectParamsSchema.strict(),
      result: projectEventCatalogPageSchema,
    },
    handler: async ({ params }) => ({
      items: await this.catalog.describe(await this.project(params)),
    }),
  });

  event_list = $tool({
    description: `The recent events of a project, newest first, for "did it fire?": filtered by name or subject, bounded and paginated, kept 30 days. An event is listed only to a caller holding its read permission. ${NotificationTools.INSTEAD}`,
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: { params: eventListParamsSchema, result: projectEventPageSchema },
    handler: async ({ params }) =>
      this.reader.list(await this.project(params), this.user(), {
        ...(params.name ? { name: params.name } : {}),
        ...(params.subject ? { subject: params.subject } : {}),
        ...(params.limit ? { limit: params.limit } : {}),
        ...(params.offset ? { offset: params.offset } : {}),
      }),
  });

  subscription_list = $tool({
    description: `Who is notified of what, on which channel: every subscription with subscription:read, your own otherwise, and the project's channels with their id, kind and name (never a URL or a secret). ${NotificationTools.INSTEAD}`,
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: projectParamsSchema.strict(),
      result: z.object({
        items: z.array(subscriptionResourceSchema),
        channels: z.array(projectChannelResourceSchema),
      }),
    },
    handler: async ({ params }) => {
      const projectId = await this.project(params);
      const user = this.user();
      const page = await this.subscriptions.list(projectId, user);
      const channels = await this.channels
        .list(projectId, user)
        .catch(() => []);
      return {
        items: page.items,
        channels: channels.map((it) => ({
          id: it.id,
          kind: it.kind,
          name: it.name,
          builtIn: it.builtIn,
          ...(it.status ? { status: it.status } : {}),
        })),
      };
    },
  });

  subscription_set = $tool({
    description: `Subscribe a member (yourself by default) or a project channel to an event, with channels and an optional filter; or mute, unmute or remove a subscription by id. Notifying someone else or a channel needs subscription:manage; your own rows need nothing. Channels are created in the browser. ${NotificationTools.INSTEAD}`,
    schema: {
      params: subscriptionSetParamsSchema,
      result: z.object({
        ok: z.boolean(),
        subscription: subscriptionResourceSchema.optional(),
      }),
    },
    handler: async ({ params }) => {
      const projectId = await this.project(params);
      const user = this.user();
      const verb = params.verb ?? "set";
      if (verb !== "set") {
        if (!params.id)
          throw new BadRequestError(`id: needed to ${verb} a subscription`);
        if (verb === "remove") {
          await this.subscriptions.remove(projectId, params.id, user);
          return { ok: true };
        }
        return {
          ok: true,
          subscription: await this.subscriptions.mute(
            projectId,
            params.id,
            user,
            verb === "mute",
          ),
        };
      }
      if (!params.event)
        throw new BadRequestError("event: needed to set a subscription");
      return {
        ok: true,
        subscription: await this.subscriptions.set(projectId, user, {
          event: params.event,
          ...(params.filter ? { filter: params.filter } : {}),
          ...(params.member_id ? { memberId: params.member_id } : {}),
          ...(params.channel_id ? { channelId: params.channel_id } : {}),
          ...(params.channel_id
            ? {}
            : { channels: params.channels ?? ["inapp"] }),
        }),
      };
    },
  });
}
