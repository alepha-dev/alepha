import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import {
  type NotificationDeliveryEntity,
  notificationDeliveryEntity,
} from "../entities/notificationDeliveryEntity.ts";

/**
 * Writes and updates the receipt that says what happened to a notification.
 *
 * Two writers feed it. The sender writes one at send time, on all three
 * outcomes, and that receipt is the only thing that knows which tenant a
 * provider `messageId` belongs to. Provider events arrive later on the
 * `notification:delivery` hook and update it in place.
 */
export class NotificationDeliveryService {
  protected readonly alepha = $inject(Alepha);
  protected readonly repo = $repository(notificationDeliveryEntity);
  protected readonly log = $logger();

  /**
   * Write or update the receipt for one job execution.
   *
   * Upsert on `executionId`, so three attempts settle one row rather than
   * three, and the row reflects the latest attempt.
   */
  public async record(receipt: NotificationDeliveryRecord): Promise<void> {
    const existing = await this.repo.findOne({
      where: { executionId: receipt.executionId },
    });

    if (existing) {
      await this.repo.updateById(existing.id, receipt);
      return;
    }

    await this.repo.create(receipt);
  }

  public async list(options: {
    organizationId?: string;
    messageId?: string;
  }): Promise<NotificationDeliveryEntity[]> {
    const where: Record<string, unknown> = {};
    if (options.organizationId !== undefined) {
      where.organizationId = options.organizationId;
    }
    if (options.messageId !== undefined) {
      where.messageId = options.messageId;
    }
    return await this.repo.findMany({ where });
  }

  public async findById(
    id: string,
  ): Promise<NotificationDeliveryEntity | undefined> {
    return await this.repo.findById(id);
  }

  /**
   * Delete receipts by id, confined to one tenant when there is one.
   *
   * Only the receipt goes: the outbox row it points at is on its own,
   * shorter clock and the purge sweep owns it.
   */
  public async deleteMany(
    ids: string[],
    options: { organizationId?: string } = {},
  ): Promise<string[]> {
    const deleted = await this.repo.deleteMany({
      id: { inArray: ids },
      ...(options.organizationId
        ? { organizationId: { eq: options.organizationId } }
        : {}),
    });
    return deleted.map(String);
  }

  public async findByExecutionId(
    executionId: string,
  ): Promise<NotificationDeliveryEntity | undefined> {
    return await this.repo.findOne({ where: { executionId } });
  }

  /**
   * The receipt a provider event is about, or undefined.
   *
   * Most recent wins: a `messageId` is the provider's and is guaranteed
   * unique neither across providers nor over time, so this is a best-effort
   * match and never an identity lookup.
   */
  public async findByMessageId(
    messageId: string,
  ): Promise<NotificationDeliveryEntity | undefined> {
    const rows = await this.repo.findMany({
      where: { messageId },
      orderBy: { column: "createdAt", direction: "desc" },
      limit: 1,
    });
    return rows[0];
  }

  /**
   * Page the receipts, narrowed by whatever the operator asked for.
   *
   * Every filter is applied by ADDING a key, never by assigning `undefined`:
   * a `where` carrying an undefined value throws, and used to be dropped
   * silently, which produced a query with no `WHERE` at all.
   */
  public async paginate(
    query: {
      sort?: string;
      page?: number;
      size?: number;
      status?: NotificationDeliveryRecord["status"];
      search?: string;
      template?: string;
      channel?: NotificationDeliveryRecord["channel"];
      category?: string;
      hasError?: boolean;
      createdAfter?: string;
      createdBefore?: string;
    },
    options: { organizationId?: string } = {},
  ) {
    query.sort ??= "-createdAt";
    const where = this.repo.createQueryWhere();
    if (options.organizationId) {
      where.organizationId = { eq: options.organizationId };
    }
    if (query.status) {
      where.status = { eq: query.status };
    }
    if (query.search) {
      where.contact = { ilike: `%${query.search}%` };
    }
    if (query.template) {
      where.template = { eq: query.template };
    }
    if (query.channel) {
      where.channel = { eq: query.channel };
    }
    if (query.category) {
      where.category = { eq: query.category };
    }
    if (query.hasError !== undefined) {
      where.error = query.hasError ? { isNotNull: true } : { isNull: true };
    }
    // One object carrying both bounds. Two separate assignments would have
    // the second overwrite the first, turning a range into a half-open
    // filter that still looks right in a test exercising one bound at a time.
    if (query.createdAfter || query.createdBefore) {
      where.createdAt = {
        ...(query.createdAfter ? { gte: query.createdAfter } : {}),
        ...(query.createdBefore ? { lte: query.createdBefore } : {}),
      };
    }
    return await this.repo.paginate(query, { where }, { count: true });
  }

  /**
   * Apply a provider event to the receipt it names.
   *
   * An event with no matching receipt is logged and dropped rather than
   * stored: it belongs to a message sent before this feature existed, or to
   * another app sharing the sending domain, and inventing a receipt for it
   * would put a row in the operator's list that no send ever produced.
   */
  protected readonly onDeliveryEvent = $hook({
    on: "notification:delivery",
    handler: async (event) => {
      const receipt = await this.findByMessageId(event.messageId);
      if (!receipt) {
        this.log.debug("Delivery event has no matching receipt", {
          provider: event.provider,
          messageId: event.messageId,
        });
        return;
      }

      await this.repo.updateById(receipt.id, {
        status: event.status,
        lastEventAt: event.occurredAt,
        smtpStatusCode: event.smtpStatusCode ?? receipt.smtpStatusCode ?? null,
      });
    },
  });

  /**
   * Delete receipts older than the retention window, in one batch.
   *
   * Its own clock, deliberately longer than the outbox's: a complaint can
   * arrive weeks after the send, and the outbox row is gone at 7 days.
   */
  public async purge(cutoff: string, limit = 5_000): Promise<number> {
    const expired = await this.repo.findMany({
      where: { createdAt: { lt: cutoff } },
      columns: ["id"] as any,
      limit,
    });

    if (expired.length === 0) {
      return 0;
    }

    await this.repo.deleteMany({ id: { inArray: expired.map((r) => r.id) } });
    return expired.length;
  }
}

export interface NotificationDeliveryRecord {
  executionId: string;
  organizationId?: string | null;
  messageId?: string | null;
  provider: string;
  channel: "email" | "sms";
  contact: string;
  template: string;
  category?: string | null;
  critical?: boolean;
  status:
    | "sent"
    | "delivered"
    | "deferred"
    | "bounced"
    | "complained"
    | "failed"
    | "rejected"
    | "skipped";
  skipReason?: "suppressed" | "declined" | null;
  subject?: string | null;
  body?: string | null;
  error?: string | null;
}
