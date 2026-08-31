import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import type { Page } from "alepha/orm";
import { NotFoundError } from "alepha/server";

import type { SessionEntity } from "../entities/sessions.ts";
import { users } from "../entities/users.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";
import type { SessionQuery } from "../schemas/sessionQuerySchema.ts";

/**
 * Admin-safe view of a session: everything except the refresh token, which
 * is a long-lived bearer credential (holding it means full impersonation of
 * the session's user).
 */
export type SessionView = Omit<SessionEntity, "refreshToken">;

export class SessionCrudService {
  /**
   * Relation map embedding a slim user summary on every session row, so the
   * admin UI can render `user.email`/`user.username` instead of a bare UUID.
   * Left-join (default) so sessions whose owner was deleted still come back
   * with `user: undefined`.
   */
  protected readonly withUser = {
    user: {
      join: users,
      on: ["userId", users.cols.id] as ["userId", { name: string }],
    },
  };

  protected readonly log = $logger();
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * How many owners a search resolves before it stops widening the session
   * query. A bound rather than a page: an admin typing `@` should not turn
   * one listing into an `IN` over every user in the realm.
   */
  protected readonly searchOwnerLimit = 200;

  /**
   * A uuid no user can hold, used to express "this search matched no owner".
   * `inArray: []` throws rather than matching nothing, so an empty result set
   * needs a value instead of an empty list.
   */
  protected readonly noSuchUser = "00000000-0000-0000-0000-000000000000";

  public sessions(userRealmName?: string) {
    return this.realmProvider.sessionRepository(userRealmName);
  }

  /**
   * The country codes actually present on sessions, for the admin filter.
   *
   * Read from the rows rather than a country list, the same way the audit log
   * builds its resource-type facet: an offer of 249 codes where three have
   * ever been seen is a worse control than three.
   */
  public async getSessionCountries(userRealmName?: string): Promise<string[]> {
    const rows = await this.sessions(userRealmName).findMany({
      distinct: ["country"],
    });
    return rows
      .map((row) => row.country)
      .filter((code): code is string => typeof code === "string" && !!code)
      .sort();
  }

  /**
   * Find sessions with pagination and filtering.
   */
  public async findSessions(
    q: SessionQuery = {},
    userRealmName?: string,
  ): Promise<Page<SessionView>> {
    this.log.trace("Finding sessions", { query: q, userRealmName });
    q.sort ??= "-createdAt";

    const where = this.sessions(userRealmName).createQueryWhere();

    if (q.userId) {
      where.userId = { eq: q.userId };
    }

    if (q.country) {
      where.country = { eq: q.country.toUpperCase() };
    }

    if (q.status) {
      const now = new Date(this.dateTime.nowMillis()).toISOString();
      where.expiresAt = q.status === "active" ? { gt: now } : { lte: now };
    }

    if (q.lastUsedWithinHours) {
      // A session that has never been used is not "recently active", so the
      // `gte` excludes the nulls rather than a separate isNotNull.
      const since = new Date(
        this.dateTime.nowMillis() - q.lastUsedWithinHours * 3_600_000,
      ).toISOString();
      where.lastUsedAt = { gte: since };
    }

    if (q.search?.trim()) {
      const needle = q.search.trim();
      // The owner lives in a JOINed table, and this repository cannot filter
      // a paginated COUNT on a joined column (see the realm note below, which
      // is the same limitation). So the users are resolved to ids first and
      // the session query stays entirely on its own table.
      //
      // An IP is matched on the session row directly, and the two are OR'd:
      // an admin looking a session up has one string in hand and should not
      // have to say which kind it is.
      const owners = await this.realmProvider
        .userRepository(userRealmName)
        .findMany({
          columns: ["id"],
          where: {
            or: [
              { email: { ilike: `%${needle}%` } },
              { username: { ilike: `%${needle}%` } },
            ],
          },
          limit: this.searchOwnerLimit,
        });

      const ids = owners.map((owner) => owner.id);
      where.or = [
        { ip: { ilike: `%${needle}%` } },
        // `inArray: []` throws, so an unmatched search has to say "no owner"
        // some other way. A userId that cannot exist is the honest one: it
        // narrows to the IP branch and matches no owner at all.
        { userId: ids.length ? { inArray: ids } : { eq: this.noSuchUser } },
      ];
    }

    const result = await this.sessions(userRealmName).paginate(
      q,
      { where, with: this.withUser },
      { count: true },
    );

    this.log.debug("Sessions found", {
      count: result.content.length,
      total: result.page.totalElements,
    });

    // The listing joins the owner; rows of other realms' users are dropped
    // here rather than in SQL, because the paginated count cannot filter on
    // a joined column yet.
    const realm = this.realmProvider.getRealm(userRealmName);
    return {
      ...result,
      content: result.content
        .filter(
          (session) =>
            (session as { user?: { realm?: string } }).user?.realm ===
            realm.name,
        )
        .map((session) => this.toView(session)),
    };
  }

  /**
   * Get a session by ID.
   */
  public async getSessionById(
    id: string,
    userRealmName?: string,
  ): Promise<SessionView> {
    this.log.trace("Getting session by ID", { id, userRealmName });
    const session = await this.sessions(userRealmName).getOne({
      where: { id: { eq: id } },
      with: this.withUser,
    });
    // Sessions carry no realm column; the owner's realm decides. A session
    // of another realm's user is not this admin's to read or revoke.
    const realm = this.realmProvider.getRealm(userRealmName);
    if ((session as { user?: { realm?: string } }).user?.realm !== realm.name) {
      throw new NotFoundError(`Session '${id}' not found`);
    }
    this.log.debug("Session retrieved", { id, userId: session.userId });
    return this.toView(session);
  }

  protected toView(session: SessionEntity): SessionView {
    const { refreshToken, ...view } = session;
    return view;
  }

  /**
   * Delete a session by ID.
   */
  public async deleteSession(
    id: string,
    userRealmName?: string,
  ): Promise<void> {
    this.log.trace("Deleting session", { id, userRealmName });

    // Verify session exists
    await this.getSessionById(id, userRealmName);

    await this.sessions(userRealmName).deleteById(id);
    this.log.info("Session deleted", { id });
  }

  /**
   * Delete many sessions by ID in one repository call.
   */
  public async deleteSessions(
    ids: string[],
    userRealmName?: string,
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    this.log.trace("Deleting sessions", { count: ids.length, userRealmName });
    const deleted = await this.sessions(userRealmName).deleteMany({
      id: { inArray: ids },
    });
    this.log.info("Sessions deleted", { count: deleted.length });
    return deleted.map(String);
  }
}
