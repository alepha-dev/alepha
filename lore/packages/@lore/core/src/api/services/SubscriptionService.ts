import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ForbiddenError, NotFoundError } from "alepha/server";

import {
  type EventSubscription,
  eventSubscriptions,
} from "../entities/eventSubscriptions.ts";
import { notificationChannels } from "../entities/notificationChannels.ts";
import type { SubscriptionPage } from "../schemas/subscriptionPageSchema.ts";
import type { SubscriptionResource } from "../schemas/subscriptionResourceSchema.ts";
import type { SubscriptionSetBody } from "../schemas/subscriptionSetBodySchema.ts";
import { ProjectEventCatalog } from "./ProjectEventCatalog.ts";
import { ProjectRecipients } from "./ProjectRecipients.ts";

/**
 * Who is told of what (#Q3890), behind the actions, the Notifications page
 * and the MCP tools alike.
 *
 * - `subscription:read` lists every row of the project; without it a member
 *   sees their own.
 * - `subscription:manage` subscribes another member ("notify one member,
 *   not me, when the app is down") and removes anyone's row. Every member
 *   subscribes, mutes and removes their own.
 * - A row is unique by its computed `key`: setting the same event, filter
 *   and member again replaces the channels and unmutes it.
 */
export class SubscriptionService {
  protected readonly rows = $repository(eventSubscriptions);
  protected readonly projectChannels = $repository(notificationChannels);
  protected readonly catalog = $inject(ProjectEventCatalog);
  protected readonly recipients = $inject(ProjectRecipients);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * The identity of a subscription: one row per event, filter and target.
   */
  public key(
    event: string,
    filter: string | undefined,
    target: string,
  ): string {
    return [event, filter ?? "*", target].join("|");
  }

  public async list(
    projectId: number,
    user: UserAccountToken,
  ): Promise<SubscriptionPage> {
    const held = await this.recipients.of(projectId, user);
    const rows = await this.rows.findMany({
      where: {
        projectId,
        ...(held.includes("subscription:read") ? {} : { memberId: user.id }),
      },
      orderBy: "createdAt",
      limit: 1000,
    });
    return { items: rows.map((row) => this.resource(row)) };
  }

  public async set(
    projectId: number,
    user: UserAccountToken,
    body: SubscriptionSetBody,
  ): Promise<SubscriptionResource> {
    const definition = this.catalog.find(body.event);
    if (!definition) throw new BadRequestError(`Unknown event '${body.event}'`);
    if (body.filter && !definition.filter)
      throw new BadRequestError(`'${body.event}' takes no filter`);
    if (body.memberId && body.channelId)
      throw new BadRequestError("Name a member or a channel, not both");
    if (body.notMine && body.channelId)
      throw new BadRequestError(
        "notMine: a channel has no actions of its own to skip",
      );
    const held = await this.recipients.of(projectId, user);
    if (body.channelId) {
      if (!held.includes("subscription:manage"))
        throw new ForbiddenError(
          "Subscribing a channel needs subscription:manage",
        );
      const channel = await this.projectChannels.findOne({
        where: { projectId, id: body.channelId },
      });
      if (!channel)
        throw new BadRequestError("No such channel in this project");
    }
    const memberId = body.channelId ? undefined : (body.memberId ?? user.id);
    if (memberId && memberId !== user.id) {
      if (!held.includes("subscription:manage"))
        throw new ForbiddenError(
          "Subscribing another member needs subscription:manage",
        );
      const refusal = await this.recipients.refusal(
        projectId,
        memberId,
        "project:read",
      );
      if (refusal)
        throw new BadRequestError(`That member cannot be notified: ${refusal}`);
    }
    const channels = memberId ? [...new Set(body.channels ?? [])] : [];
    if (memberId && !channels.length)
      throw new BadRequestError("channels: inbox, email, or both");
    const key = this.key(
      body.event,
      body.filter,
      memberId ? `member:${memberId}` : `channel:${body.channelId}`,
    );
    const existing = await this.rows.findOne({ where: { projectId, key } });
    if (existing)
      return this.resource(
        await this.rows.updateById(existing.id, {
          channels,
          notMine: body.notMine === true,
          notMembers: body.notMembers === true,
          mutedAt: null as never,
        }),
      );
    try {
      return this.resource(
        await this.rows.create({
          projectId,
          key,
          event: body.event,
          filter: body.filter,
          memberId,
          channelId: body.channelId,
          channels,
          notMine: body.notMine === true,
          notMembers: body.notMembers === true,
          createdBy: user.id,
        }),
      );
    } catch (error) {
      // A double click: the other request wrote the row first.
      const raced = await this.rows.findOne({ where: { projectId, key } });
      if (raced) return this.resource(raced);
      throw error;
    }
  }

  /**
   * Mute or unmute one's own row. A manager removes a row; muting is the
   * member's.
   */
  public async mute(
    projectId: number,
    id: string,
    user: UserAccountToken,
    muted: boolean,
  ): Promise<SubscriptionResource> {
    const row = await this.get(projectId, id);
    if (!row.memberId || row.memberId !== user.id)
      throw new ForbiddenError("Only the member it notifies mutes it");
    return this.resource(
      await this.rows.updateById(row.id, {
        mutedAt: (muted ? this.dateTime.nowISOString() : null) as never,
      }),
    );
  }

  public async remove(
    projectId: number,
    id: string,
    user: UserAccountToken,
  ): Promise<void> {
    const row = await this.get(projectId, id);
    if (row.memberId !== user.id) {
      const held = await this.recipients.of(projectId, user);
      if (!held.includes("subscription:manage"))
        throw new ForbiddenError(
          "Removing another member's notification needs subscription:manage",
        );
    }
    await this.rows.deleteById(row.id);
  }

  protected async get(projectId: number, id: string) {
    const row = await this.rows.findOne({ where: { id, projectId } });
    if (!row) throw new NotFoundError("No such notification");
    return row;
  }

  protected resource(row: EventSubscription): SubscriptionResource {
    return {
      id: row.id,
      projectId: row.projectId,
      event: row.event,
      ...(row.filter ? { filter: row.filter } : {}),
      ...(row.memberId ? { memberId: row.memberId } : {}),
      ...(row.channelId ? { channelId: row.channelId } : {}),
      channels: row.channels,
      ...(row.notMine ? { notMine: true } : {}),
      ...(row.notMembers ? { notMembers: true } : {}),
      ...(row.createdBy ? { createdBy: row.createdBy } : {}),
      ...(row.mutedAt ? { mutedAt: row.mutedAt } : {}),
      createdAt: row.createdAt,
    };
  }
}
