import { $repository } from "alepha/orm";

import {
  type NotificationSuppressionEntity,
  notificationSuppressionEntity,
} from "../entities/notificationSuppressionEntity.ts";

/**
 * Reads and writes the one list that decides whether a message may go out.
 *
 * The rule, in one sentence: `unsubscribed` blocks non-critical mail in the
 * matching category, `bounced` and `complained` block everything.
 */
export class NotificationSuppressionService {
  protected readonly repo = $repository(notificationSuppressionEntity);

  /**
   * The sentinel meaning "every category". A real value rather than null,
   * because NULLs never collide in a unique index and this column is part of
   * one.
   */
  public static readonly ALL_CATEGORIES = "*";

  /**
   * Record that a contact must not be mailed.
   *
   * The unique index is the concurrency boundary. A racing insert re-reads
   * and returns the row the other writer created, keeping this idempotent.
   */
  public async suppress(options: {
    contact: string;
    channel: string;
    reason: "unsubscribed" | "bounced" | "complained";
    category?: string;
    source: string;
  }): Promise<NotificationSuppressionEntity> {
    const row = {
      contact: this.normalize(options.contact),
      channel: options.channel,
      reason: options.reason,
      category:
        options.category ?? NotificationSuppressionService.ALL_CATEGORIES,
      source: options.source,
    };

    const existing = await this.repo.findOne({
      where: {
        contact: row.contact,
        channel: row.channel,
        reason: row.reason,
        category: row.category,
      },
    });
    if (existing) {
      return existing;
    }

    try {
      return await this.repo.create(row);
    } catch (error) {
      const concurrent = await this.repo.findOne({
        where: {
          contact: row.contact,
          channel: row.channel,
          reason: row.reason,
          category: row.category,
        },
      });
      if (concurrent) {
        return concurrent;
      }
      throw error;
    }
  }

  /**
   * Remove a suppression, re-enabling mail to that contact.
   *
   * The compliance-sensitive half of this service: lifting a `bounced` or
   * `complained` row starts mailing an address that already said no, which
   * is why the admin action behind it needs its own permission rather than
   * sharing one with resend.
   */
  public async lift(id: string): Promise<void> {
    await this.repo.deleteById(id);
  }

  /**
   * Query the list.
   */
  public async list(options: {
    contact?: string;
    channel?: string;
  }): Promise<NotificationSuppressionEntity[]> {
    // Never pass undefined into a where-filter: it throws. Build the filter
    // from the keys that were actually given.
    const where: Record<string, unknown> = {};
    if (options.contact !== undefined) {
      where.contact = this.normalize(options.contact);
    }
    if (options.channel !== undefined) {
      where.channel = options.channel;
    }

    return await this.repo.findMany({ where });
  }

  /**
   * A page of the list for an operator, newest first.
   */
  public async paginate(query: {
    sort?: string;
    page?: number;
    size?: number;
  }) {
    query.sort ??= "-createdAt";
    const where = this.repo.createQueryWhere();
    return await this.repo.paginate(query, { where }, { count: true });
  }

  /**
   * Read one row, so a caller can check tenancy before deleting it.
   */
  public async findById(
    id: string,
  ): Promise<NotificationSuppressionEntity | undefined> {
    return await this.repo.findById(id);
  }

  /**
   * Whether this message must not be sent.
   *
   * A `bounced` or `complained` row blocks everything, `critical` included.
   * An `unsubscribed` row blocks only non-critical mail, and only when its
   * category matches the message's or is the all-categories sentinel.
   */
  public async isSuppressed(options: {
    contact: string;
    channel: string;
    category?: string;
    critical?: boolean;
  }): Promise<boolean> {
    const rows = await this.repo.findMany({
      where: {
        contact: this.normalize(options.contact),
        channel: options.channel,
      },
    });

    return rows.some((row) => this.blocks(row, options));
  }

  protected blocks(
    row: NotificationSuppressionEntity,
    message: { category?: string; critical?: boolean },
  ): boolean {
    if (row.reason !== "unsubscribed") {
      // A dead or hostile address is dead or hostile for every message.
      return true;
    }

    if (message.critical) {
      return false;
    }

    return (
      row.category === NotificationSuppressionService.ALL_CATEGORIES ||
      row.category === message.category
    );
  }

  /**
   * Trim and lower-case, so `" A@Example.COM "` and `"a@example.com"` are one
   * contact. Phone numbers are unaffected by case and keep whatever form the
   * caller stored, which is why this is not an E.164 parser.
   */
  protected normalize(contact: string): string {
    return contact.trim().toLowerCase();
  }
}
