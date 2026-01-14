import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import type { Page } from "alepha/orm";
import type { SessionEntity } from "../entities/sessions.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";
import type { SessionQuery } from "../schemas/sessionQuerySchema.ts";

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
  ): Promise<Page<SessionEntity>> {
    this.log.trace("Finding sessions", { query: q, userRealmName });
    q.sort ??= "-createdAt";

    const where = this.sessions(userRealmName).createQueryWhere();

    if (q.userId) {
      where.userId = { eq: q.userId };
    }

    const result = await this.sessions(userRealmName).paginate(
      q,
      { where },
      { count: true },
    );

    this.log.debug("Sessions found", {
      count: result.content.length,
      total: result.page.totalElements,
    });

    return result;
  }

  /**
   * Get a session by ID.
   */
  public async getSessionById(
    id: string,
    userRealmName?: string,
  ): Promise<SessionEntity> {
    this.log.trace("Getting session by ID", { id, userRealmName });
    const session = await this.sessions(userRealmName).findById(id);
    this.log.debug("Session retrieved", { id, userId: session.userId });
    return session;
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
}
