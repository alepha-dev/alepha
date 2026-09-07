import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import {
  $action,
  BadRequestError,
  NotFoundError,
  okSchema,
} from "alepha/server";

import {
  type NotificationInboxEntity,
  notificationInboxEntity,
} from "../entities/notificationInboxEntity.ts";
import { notificationInboxCountSchema } from "../schemas/notificationInboxCountSchema.ts";
import { notificationInboxPageSchema } from "../schemas/notificationInboxPageSchema.ts";
import type { NotificationInboxQuery } from "../schemas/notificationInboxQuerySchema.ts";
import { notificationInboxQuerySchema } from "../schemas/notificationInboxQuerySchema.ts";

/**
 * The read side of the inbox: list it, count it, mark it read.
 *
 * In the framework rather than in each app, because an app that
 * reimplements paging and read-state over someone else's table is an app
 * that gets the security wrong once.
 *
 * ## The whole gate is `$secure()`, bare
 *
 * Authenticated, with no permission. An inbox is not an admin surface and
 * there is nothing to grant: gating "read your own messages" behind a
 * permission means every realm has to remember it, and the failure mode is a
 * bell that renders empty for users nobody thought to configure.
 * {@link MyProfileController} made this call first and this follows it.
 *
 * That choice is also what lets a client hide the bell without asking:
 * `/api/_links` prunes every `$secure()` action for an anonymous caller, so
 * `countInbox.can()` is false both when this module is absent and when the
 * viewer is signed out, with no request fired either way.
 *
 * ## ⚠️ There is no user id in any signature here
 *
 * Every row is filtered by the session's own, and that is what makes the
 * surface safe to leave un-permissioned. A row belonging to somebody else is
 * a **404, not a 403**, so the endpoint never confirms that an id exists.
 */
export class NotificationInboxController {
  protected readonly url: string = "/inbox";
  protected readonly group: string = "notifications";
  protected readonly repo = $repository(notificationInboxEntity);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * How many messages a page holds when the caller does not say.
   */
  protected readonly defaultLimit = 20;

  public readonly listInbox = $action({
    method: "GET",
    path: this.url,
    group: this.group,
    use: [$secure()],
    description: "Read the caller's own inbox",
    schema: {
      query: notificationInboxQuerySchema,
      response: notificationInboxPageSchema,
    },
    handler: async ({ query, user }) => this.list(user.id, query),
  });

  public readonly countInbox = $action({
    method: "GET",
    path: `${this.url}/count`,
    group: this.group,
    use: [$secure()],
    description: "How many messages the caller has not read",
    schema: {
      query: z.object({ scope: z.text({ maxLength: 64 }).optional() }),
      response: notificationInboxCountSchema,
    },
    handler: async ({ query, user }) => ({
      unread: await this.countUnread(user.id, query.scope),
    }),
  });

  /**
   * Mark every message read, optionally within one scope only.
   *
   * ⚠️ Declared BEFORE {@link markInboxRead}: `POST /inbox/read` and
   * `POST /inbox/:id` are different shapes, but a future rename that made
   * them collide would be decided by registration order, and this is the
   * order that keeps the literal winning.
   */
  public readonly markAllInboxRead = $action({
    method: "POST",
    path: `${this.url}/read`,
    group: this.group,
    use: [$secure()],
    description: "Mark all of the caller's messages as read",
    schema: {
      query: z.object({ scope: z.text({ maxLength: 64 }).optional() }),
      response: okSchema,
    },
    handler: async ({ query, user }) => {
      const updated = await this.repo.updateMany(
        {
          userId: { eq: user.id },
          readAt: { isNull: true },
          ...(query.scope !== undefined ? { scope: { eq: query.scope } } : {}),
        },
        { readAt: this.now() },
      );
      return { ok: true, count: updated.length };
    },
  });

  public readonly markInboxRead = $action({
    method: "POST",
    path: `${this.url}/:id/read`,
    group: this.group,
    use: [$secure()],
    description: "Mark one of the caller's messages as read",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      // Read scoped to the caller, so a row belonging to somebody else is
      // indistinguishable from one that does not exist. A 403 here would
      // confirm the id.
      const row = await this.repo.findOne({
        where: { id: { eq: params.id }, userId: { eq: user.id } },
      });
      if (!row) {
        throw new NotFoundError("Message not found");
      }
      if (!row.readAt) {
        await this.repo.updateById(row.id, { readAt: this.now() });
      }
      return { ok: true, id: row.id };
    },
  });

  /**
   * One page, newest first, plus the unread total.
   *
   * The page reads `limit + 1` rows and hands back at most `limit`: the
   * extra row is how it knows whether there is a next page without a second
   * count over a growing table.
   */
  protected async list(userId: string, query: NotificationInboxQuery) {
    const limit = query.limit ?? this.defaultLimit;

    const rows = await this.repo.findMany({
      where: this.scopeWhere(userId, query),
      orderBy: [
        { column: "createdAt", direction: "desc" },
        // The tie-break, and not decoration: a fan-out over a roster writes
        // several rows in one millisecond, and without a second sort key the
        // cursor below has nothing stable to cut on.
        { column: "id", direction: "desc" },
      ],
      limit: limit + 1,
    });

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];

    return {
      items: page.map((row) => this.toResource(row)),
      unreadCount: await this.countUnread(userId, query.scope),
      nextCursor:
        rows.length > limit && last ? this.encodeCursor(last) : undefined,
    };
  }

  protected async countUnread(userId: string, scope?: string): Promise<number> {
    return await this.repo.count({
      userId: { eq: userId },
      readAt: { isNull: true },
      ...(scope !== undefined ? { scope: { eq: scope } } : {}),
    });
  }

  /**
   * The whole filter, and the only place a user id enters a query.
   */
  protected scopeWhere(userId: string, query: NotificationInboxQuery) {
    const where: Record<string, unknown> = { userId: { eq: userId } };

    // ⚠️ `scope` is an app-owned opaque string. Compared for equality and
    // never parsed: this module does not know what `project:65` means.
    if (query.scope !== undefined) {
      where.scope = { eq: query.scope };
    }
    if (query.unreadOnly) {
      where.readAt = { isNull: true };
    }
    if (query.cursor) {
      const { createdAt, id } = this.decodeCursor(query.cursor);
      // Everything strictly older than the last row of the previous page,
      // plus the rows of the same millisecond that sort after it. Expressed
      // as one `or`, which the query layer already carries, rather than as
      // raw SQL.
      where.or = [
        { createdAt: { lt: createdAt } },
        { createdAt: { eq: createdAt }, id: { lt: id } },
      ] as any;
    }

    return where;
  }

  /**
   * Where to resume, as one opaque token.
   *
   * Composite over `(createdAt, id)` rather than a bare timestamp. The
   * module's only precedent, `auditQuerySchema.after`, is a millisecond ISO
   * stamp and documents its own hole: postgres keeps microseconds, so a row
   * written at `.123456` is not excluded by an `after` of `.123`. This
   * module ships to postgres apps as well as to D1, so inheriting that would
   * be inheriting a bug on three of the four.
   *
   * Opaque so the shape can change without a client change, which is the
   * only reason it is base64 rather than a readable pair.
   */
  protected encodeCursor(row: NotificationInboxEntity): string {
    return Buffer.from(`${row.createdAt}|${row.id}`, "utf8").toString(
      "base64url",
    );
  }

  protected decodeCursor(cursor: string): { createdAt: string; id: string } {
    let decoded: string;
    try {
      decoded = Buffer.from(cursor, "base64url").toString("utf8");
    } catch {
      throw new BadRequestError("Malformed cursor");
    }

    const separator = decoded.indexOf("|");
    if (separator < 0) {
      throw new BadRequestError("Malformed cursor");
    }

    const createdAt = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    if (Number.isNaN(new Date(createdAt).getTime()) || !id) {
      throw new BadRequestError("Malformed cursor");
    }

    return { createdAt, id };
  }

  /**
   * Now, as the column stores it.
   *
   * Through `DateTimeProvider` rather than `new Date()`, so a spec can
   * travel and a read timestamp is something a test can assert on.
   */
  protected now(): string {
    return this.dateTime.nowISOString();
  }

  /**
   * The row as its owner sees it: no `userId`, no `organizationId`.
   *
   * Both are the server's business, and every row in a response already
   * belongs to the caller, so repeating who they are on each one buys
   * nothing.
   */
  protected toResource(row: NotificationInboxEntity) {
    return {
      id: row.id,
      createdAt: row.createdAt,
      scope: row.scope ?? undefined,
      scopeLabel: row.scopeLabel ?? undefined,
      template: row.template,
      category: row.category ?? undefined,
      title: row.title,
      body: row.body ?? undefined,
      href: row.href,
      readAt: row.readAt ?? undefined,
    };
  }
}
