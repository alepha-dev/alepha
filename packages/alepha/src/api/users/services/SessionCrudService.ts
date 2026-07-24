import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import type { Page } from "alepha/orm";
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

/**
 * Relation map embedding a slim user summary on every session row, so the
 * admin UI can render `user.email`/`user.username` instead of a bare UUID.
 * Left-join (default) so sessions whose owner was deleted still come back
 * with `user: undefined`.
 */
const withUser = {
  user: {
    join: users,
    on: ["userId", users.cols.id] as ["userId", { name: string }],
  },
};

export class SessionCrudService {
  protected readonly log = $logger();
  protected readonly realmProvider = $inject(RealmProvider);

  public sessions(userRealmName?: string) {
    return this.realmProvider.sessionRepository(userRealmName);
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

    const result = await this.sessions(userRealmName).paginate(
      q,
      { where, with: withUser },
      { count: true },
    );

    this.log.debug("Sessions found", {
      count: result.content.length,
      total: result.page.totalElements,
    });

    return {
      ...result,
      content: result.content.map((session) => this.toView(session)),
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
      with: withUser,
    });
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
