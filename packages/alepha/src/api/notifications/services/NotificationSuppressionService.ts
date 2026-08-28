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
   * Find-then-insert rather than a bare insert: the unique index cannot
   * dedupe rows whose `organizationId` is null, which is every row in a
   * single-tenant app, so the check has to happen here too.
   */
  public async suppress(options: {
    contact: string;
    channel: "email" | "sms";
    reason: "unsubscribed" | "bounced" | "complained";
    category?: string;
    source: string;
    organizationId?: string;
  }): Promise<NotificationSuppressionEntity> {
    const row = {
      organizationId: options.organizationId ?? null,
      contact: this.normalize(options.contact),
      channel: options.channel,
      reason: options.reason,
      category:
        options.category ?? NotificationSuppressionService.ALL_CATEGORIES,
      source: options.source,
    };

    const existing = await this.repo.findOne({
      where: {
        ...this.tenantFilter(options.organizationId),
        contact: row.contact,
        channel: row.channel,
        reason: row.reason,
        category: row.category,
      },
    });
    if (existing) {
      return existing;
    }

    return await this.repo.create(row);
  }

  /**
   * Match one tenant's rows, or the tenant-less ones in a single-tenant app.
   *
   * A bare `{ organizationId: null }` is refused by the query layer, because
   * a null condition would be dropped from the WHERE clause and the query
   * would silently match every tenant. `isNull` is how you actually ask for
   * the rows that have no owner.
   */
  protected tenantFilter(organizationId?: string) {
    return organizationId
      ? { organizationId }
      : { organizationId: { isNull: true } };
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
   *
   * ⚠️ Omitting `organizationId` lists **across every tenant**, which is what
   * an operator's unscoped view wants and never what a send wants. The gate
   * uses {@link isSuppressed}, which scopes to exactly one tenant (or to the
   * tenant-less rows) instead.
   */
  public async list(options: {
    organizationId?: string;
    contact?: string;
    channel?: "email" | "sms";
  }): Promise<NotificationSuppressionEntity[]> {
    // Never pass undefined into a where-filter: it throws. Build the filter
    // from the keys that were actually given.
    const where: Record<string, unknown> = {};
    if (options.organizationId !== undefined) {
      where.organizationId = options.organizationId;
    }
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
   *
   * `organizationId` here is the acting tenant, or undefined in a
   * single-tenant app where every row belongs to this app anyway. It is the
   * same shape the notification outbox listing uses, so the two tabs of the
   * admin page behave identically.
   */
  public async paginate(
    query: { sort?: string; page?: number; size?: number },
    options: { organizationId?: string } = {},
  ) {
    query.sort ??= "-createdAt";
    const where = this.repo.createQueryWhere();
    if (options.organizationId) {
      where.organizationId = { eq: options.organizationId };
    }
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
    channel: "email" | "sms";
    organizationId?: string;
    category?: string;
    critical?: boolean;
  }): Promise<boolean> {
    // Deliberately not `list()`: an absent tenant must mean "the rows with no
    // tenant", not "every tenant's rows". Getting that backwards would let
    // one club's unsubscribe silence another club's mail.
    const rows = await this.repo.findMany({
      where: {
        ...this.tenantFilter(options.organizationId),
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
